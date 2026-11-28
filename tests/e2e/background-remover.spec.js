const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

const toolPath = '/media-and-motion/background-remover/';
const categoryPath = '/categories/image-photo-editing/';
const fixture = (name) => path.join(__dirname, '..', 'fixtures', 'background-remover', name);
const sharedFixture = (name) => path.join(__dirname, '..', 'fixtures', name);
const isAnalyticsNoise = (text) => /googletagmanager|google-analytics|gtag|GTM-/i.test(String(text));
const isRuntimeNoise = (text) =>
  isAnalyticsNoise(text) ||
  /onnxruntime|wasm streaming compile failed|falling back to ArrayBuffer/i.test(String(text)) ||
  /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i.test(String(text));

const modelPath = path.join(
  __dirname,
  '..',
  '..',
  'vendor',
  'background-removal',
  'model_fp16.onnx'
);
const modelConfigModule =
  'export const MODEL_CONFIG = Object.freeze(' +
  JSON.stringify({
    url: 'MODEL_URL',
    sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516',
    bytes: 98484532,
    version: 'birefnet-lite-512-fp16-962e679'
  }) +
  ');';

let modelServer;
let modelOrigin;

test.beforeAll(async () => {
  modelServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const cors = pathname !== '/no-cors/model_fp16.onnx';
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable'
    };
    if (cors) headers['Access-Control-Allow-Origin'] = '*';
    if (pathname === '/model_fp16.onnx' || pathname === '/no-cors/model_fp16.onnx') {
      headers['Content-Length'] = String(fs.statSync(modelPath).size);
      response.writeHead(200, headers);
      fs.createReadStream(modelPath).pipe(response);
      return;
    }
    response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
    response.end('Not found');
  });
  await new Promise((resolve, reject) => {
    modelServer.once('error', reject);
    modelServer.listen(0, '127.0.0.1', resolve);
  });
  modelOrigin = 'http://127.0.0.1:' + modelServer.address().port;
});

test.afterAll(async () => {
  if (!modelServer) return;
  await new Promise((resolve) => modelServer.close(resolve));
});

async function pointModelAt(context, url) {
  await context.route('**/js/background-remover/model-config.mjs', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: modelConfigModule.replace('MODEL_URL', () => url)
    })
  );
}

async function openTool(page) {
  await page.goto(toolPath);
  await expect(page.locator('h1')).toHaveText('AI Background Remover');
}

async function loadSynthetic(page, options = { width: 900, height: 700 }) {
  await openTool(page);
  const loaded = await page.evaluate((opts) => window.__bgrTest.loadSynthetic(opts), options);
  expect(loaded).toBe(true);
  await expect(page.locator('[data-empty]')).toBeHidden();
  await expect(page.locator('[data-download]')).toBeEnabled();
}

/* Simulate a returning visitor whose local model is already cached. */
async function useLocal(page) {
  await page.evaluate(() => window.__bgrTest.setLocalAvailable(true));
}

async function chooseBackground(page, value) {
  await page
    .locator(`.bgr-bg-option input[value="${value}"]`)
    .evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function scenePixels(page, points, format = 'image/png') {
  return page.evaluate(
    async ({ format, points }) => {
      const url = window.__bgrTest.exportCanvas(format);
      if (!url) throw new Error('No export available');
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: points.map(([x, y]) =>
          Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data)
        )
      };
    },
    { format, points }
  );
}

async function decodeImageBuffer(page, buffer, mime, points) {
  return page.evaluate(
    async ({ base64, mime, points }) => {
      const image = new Image();
      image.src = 'data:' + mime + ';base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: points.map(([x, y]) =>
          Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data)
        )
      };
    },
    { base64: buffer.toString('base64'), mime, points }
  );
}

async function downloadAndDecode(page, trigger, mime, points) {
  const pending = page.waitForEvent('download');
  await trigger();
  const download = await pending;
  const filename = download.suggestedFilename();
  const buffer = fs.readFileSync(await download.path());
  const decoded = await decodeImageBuffer(page, buffer, mime, points);
  return { filename, buffer, decoded };
}

/* Minimal RGBA PNG encoder used to mock the Cloudflare Images response without
 * adding a dependency. The result has a transparent border and an opaque oval. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function makeMaskPng(size = 96) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = y * stride + 1 + x * 4;
      const dx = (x - size / 2) / (size * 0.34);
      const dy = (y - size * 0.55) / (size * 0.42);
      raw[offset] = 240;
      raw[offset + 1] = 120;
      raw[offset + 2] = 60;
      raw[offset + 3] = dx * dx + dy * dy < 1 ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

test.describe('AI background remover', () => {
  test('renders unique SEO metadata, structured data and an accessible empty workspace', async ({ page }) => {
    const problems = [];
    page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !isRuntimeNoise(message.text())) {
        problems.push('console: ' + message.text());
      }
    });

    await openTool(page);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page).toHaveTitle('AI Background Remover – Remove Image Background Free | LetitEdit');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://letitedit.com/media-and-motion/background-remover/'
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /local AI background remover/
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      'https://letitedit.com/media-and-motion/background-remover/'
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image'
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://letitedit.com/assets/og-letitedit.jpg'
    );

    const seoLengths = await page.evaluate(() => ({
      title: document.title.length,
      description: document.querySelector('meta[name="description"]').content.length
    }));
    expect(seoLengths.title).toBeLessThanOrEqual(65);
    expect(seoLengths.description).toBeLessThanOrEqual(160);

    const structured = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => {
      const graph = JSON.parse(nodes[0].textContent)['@graph'];
      return {
        types: graph.map((item) => item['@type']),
        breadcrumb: graph.find((item) => item['@type'] === 'BreadcrumbList').itemListElement,
        application: graph.find((item) => item['@type'] === 'SoftwareApplication'),
        faq: graph.find((item) => item['@type'] === 'FAQPage').mainEntity
      };
    });
    expect(structured.types).toEqual(
      expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'HowTo', 'FAQPage'])
    );
    expect(structured.breadcrumb).toHaveLength(4);
    expect(structured.breadcrumb[2].item).toBe('https://letitedit.com/categories/image-photo-editing/');
    expect(structured.application.offers.price).toBe('0');
    expect(structured.faq.length).toBeGreaterThanOrEqual(6);

    await expect(page.locator('.breadcrumbs')).toContainText('AI Background Remover');
    await expect(page.locator('[data-empty]')).toBeVisible();
    await expect(page.locator('[data-process]')).toBeDisabled();
    await expect(page.locator('[data-download]')).toBeDisabled();
    await expect(page.locator('[data-controls]')).toHaveCount(3);
    await expect(page.locator('[data-controls]').first()).toBeHidden();
    await expect(page.locator('[data-file-input]')).toHaveAttribute(
      'accept',
      /image\/jpeg,image\/png,image\/webp,image\/avif/
    );
    await expect(page.locator('input[name="bgr-background"]')).toHaveCount(9);
    await expect(page.locator('[data-model-note]')).toContainText('94 MB');
    await expect(page.locator('body')).toContainText('images are processed in this browser tab');
    expect(problems).toEqual([]);
  });

  test('is listed once in the category, search index, sitemap and search dialog', async ({ page, request }) => {
    await page.goto(categoryPath);
    const card = page.locator(`.tool-card[href="${toolPath}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('AI Background Remover');
    await expect(card).toContainText('local AI model');

    const entry = await page.evaluate(() => {
      const data = window.LETITEDIT_SEARCH;
      return {
        matches: data.tools.filter((tool) => tool.path === '/media-and-motion/background-remover/'),
        total: data.tools.length
      };
    });
    expect(entry.matches).toHaveLength(1);
    expect(entry.matches[0].name).toBe('AI Background Remover');
    expect(entry.matches[0].keywords).toEqual(
      expect.arrayContaining(['background remover', 'remove background from image'])
    );
    expect(entry.total).toBe(14);

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(
      '<loc>https://letitedit.com/media-and-motion/background-remover/</loc>'
    );

    await page.locator('.topbar [data-search-open]').first().click();
    await page.locator('#site-search').fill('background remover');
    const result = page
      .locator('#search-results .search-result-title')
      .filter({ hasText: 'AI Background Remover' });
    await expect(result).toBeVisible();
    await page
      .locator('#search-results .search-result-link')
      .filter({ hasText: 'AI Background Remover' })
      .click();
    await expect(page).toHaveURL(/\/media-and-motion\/background-remover\/$/);
  });

  test('applies EXIF orientation and rejects unsupported or oversized files', async ({ page }) => {
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample-exif6.jpg'));
    await expect(page.locator('[data-file-meta]')).toContainText('200 × 320 px');
    await expect(page.locator('[data-process]')).toBeEnabled();

    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.bmp'));
    await expect(page.locator('[data-error]')).toBeVisible();
    await expect(page.locator('[data-error-text]')).toContainText('Choose a JPG, PNG, WebP or AVIF image');
    await page.locator('[data-error-close]').click();
    await expect(page.locator('[data-error]')).toBeHidden();

    const oversized = Buffer.alloc(26 * 1024 * 1024, 1);
    await page.locator('[data-file-input]').setInputFiles({
      name: 'oversized.png',
      mimeType: 'image/png',
      buffer: oversized
    });
    await expect(page.locator('[data-error]')).toBeVisible();
    await expect(page.locator('[data-error-text]')).toContainText('The limit is 25 MB');
  });

  test('loads a deterministic matte and exposes compare, zoom, brush and background controls', async ({ page }) => {
    await loadSynthetic(page);
    const state = await page.evaluate(() => window.__bgrTest.getState());
    expect(state.coverage).toBeGreaterThan(0.08);
    expect(state.hasAlpha).toBe(true);
    expect(state.status).toBe('done');

    const pixels = await page.evaluate(() => ({
      centre: window.__bgrTest.alphaAt(450, 350),
      corner: window.__bgrTest.alphaAt(5, 5)
    }));
    expect(pixels.centre).toBeGreaterThan(200);
    expect(pixels.corner).toBeLessThan(5);

    const compare = page.locator('[data-compare]');
    await compare.click();
    await expect(compare).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-compare-badge]')).toBeVisible();
    expect((await page.evaluate(() => window.__bgrTest.getState())).compare).toBe(true);
    await compare.click();
    await expect(compare).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-compare-badge]')).toBeHidden();

    await expect(page.locator('[data-zoom-label]')).toHaveText('100%');
    await page.locator('[data-zoom-in]').first().click();
    await expect(page.locator('[data-zoom-label]')).toHaveText('125%');
    await page.locator('[data-zoom-out]').first().click();
    await expect(page.locator('[data-zoom-label]')).toHaveText('100%');
    await page.locator('[data-zoom-fit]').first().click();
    await expect(page.locator('[data-zoom-label]')).toHaveText('100%');

    await page.locator('[data-canvas]').focus();
    await page.keyboard.press('+');
    await expect(page.locator('[data-zoom-label]')).toHaveText('120%');
    await page.keyboard.press('0');
    await expect(page.locator('[data-zoom-label]')).toHaveText('100%');

    await page.locator('.bgr-toolbar [data-tool="erase"]').click();
    await expect(page.locator('.bgr-toolbar [data-tool="erase"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.bgr-panel [data-tool="erase"]')).toHaveClass(/is-active/);
    await setRange(page, '[data-brush-size]', 120);
    await expect(page.locator('[data-brush-size-value]')).toHaveText('120 px');
    await setRange(page, '[data-brush-softness]', 40);
    await expect(page.locator('[data-brush-softness-value]')).toHaveText('40%');
    const brush = (await page.evaluate(() => window.__bgrTest.getState())).brush;
    expect(brush).toEqual({ size: 120, softness: 40 });

    await chooseBackground(page, 'white');
    expect((await page.evaluate(() => window.__bgrTest.getState())).background).toBe('white');
    await expect(page.locator('[data-bg-panel="color"]')).toBeHidden();

    await chooseBackground(page, 'color');
    await expect(page.locator('[data-bg-panel="color"]')).toBeVisible();
    await setRange(page, '[data-color-hex]', '');
    await page.locator('[data-color-hex]').fill('#112233');
    expect((await page.evaluate(() => window.__bgrTest.getState())).background).toBe('color');
    const colour = await scenePixels(page, [[10, 10]]);
    expect(colour.pixels[0].slice(0, 3)).toEqual([17, 34, 51]);

    await chooseBackground(page, 'gradient');
    await expect(page.locator('[data-bg-panel="gradient"]')).toBeVisible();
    await setRange(page, '[data-gradient-angle]', 45);
    await expect(page.locator('[data-gradient-angle-value]')).toHaveText('45°');

    await chooseBackground(page, 'studio');
    await expect(page.locator('[data-bg-panel="studio"]')).toBeVisible();
    await setRange(page, '[data-shadow-opacity]', 70);
    await expect(page.locator('[data-shadow-opacity-value]')).toHaveText('70%');
    expect((await page.evaluate(() => window.__bgrTest.getState())).studio.shadowOpacity).toBe(70);
    await page.locator('[data-studio-reset]').click();
    await expect(page.locator('[data-shadow-opacity-value]')).toHaveText('38%');

    await chooseBackground(page, 'transparent');
    await expect(page.locator('[data-bg-panel="studio"]')).toBeHidden();
  });

  test('fills black, grey and uploaded backgrounds and blurs only the background', async ({ page }) => {
    await loadSynthetic(page, { width: 600, height: 400 });

    await chooseBackground(page, 'black');
    const black = await scenePixels(page, [[8, 8]]);
    expect(black.pixels[0].slice(0, 3)).toEqual([0, 0, 0]);
    expect(black.pixels[0][3]).toBe(255);

    await chooseBackground(page, 'grey');
    const grey = await scenePixels(page, [[8, 8]]);
    expect(grey.pixels[0].slice(0, 3)).toEqual([226, 232, 240]);

    await chooseBackground(page, 'original');
    await expect(page.locator('[data-blur-wrap]')).toBeVisible();
    await setRange(page, '[data-blur]', 45);
    await expect(page.locator('[data-blur-value]')).toHaveText('45');
    await setRange(page, '[data-depth]', 30);
    await expect(page.locator('[data-depth-value]')).toHaveText('30');
    const blurred = await scenePixels(page, [
      [8, 8],
      [300, 200]
    ]);
    expect(blurred.width).toBe(600);
    expect(blurred.pixels[0][3]).toBe(255);
    expect(blurred.pixels[1][3]).toBe(255);

    await chooseBackground(page, 'image');
    await expect(page.locator('[data-bg-panel="image"]')).toBeVisible();
    await page.locator('[data-bg-image-input]').setInputFiles(sharedFixture('sample.png'));
    await expect(page.locator('[data-bg-image-meta]')).toContainText('sample.png');
    await setRange(page, '[data-blur]', 20);
    const uploaded = await scenePixels(page, [
      [8, 8],
      [300, 200]
    ]);
    expect(uploaded.width).toBe(600);
    expect(uploaded.pixels[0][3]).toBe(255);
    expect(uploaded.pixels[0].slice(0, 3)).not.toEqual([226, 232, 240]);

    await chooseBackground(page, 'transparent');
    await expect(page.locator('[data-blur-wrap]')).toBeHidden();
  });

  test('exports transparent PNG, white JPG and WebP with the effects baked in', async ({ page }) => {
    await loadSynthetic(page, { width: 600, height: 400 });
    await chooseBackground(page, 'transparent');

    const png = await downloadAndDecode(
      page,
      () => page.locator('[data-download]').click(),
      'image/png',
      [
        [5, 5],
        [300, 220]
      ]
    );
    expect(png.filename).toMatch(/-no-background\.png$/);
    expect(png.decoded.width).toBe(600);
    expect(png.decoded.height).toBe(400);
    expect(png.decoded.pixels[0][3]).toBeLessThan(5);
    expect(png.decoded.pixels[1][3]).toBeGreaterThan(200);

    await page.locator('[data-format]').selectOption('image/jpeg');
    await expect(page.locator('[data-quality-wrap]')).toBeVisible();
    const jpg = await downloadAndDecode(
      page,
      () => page.locator('[data-download]').click(),
      'image/jpeg',
      [[5, 5]]
    );
    expect(jpg.filename).toMatch(/-no-background\.jpg$/);
    expect(jpg.decoded.width).toBe(600);
    expect(jpg.decoded.height).toBe(400);
    expect(jpg.decoded.pixels[0].slice(0, 3)).toEqual([255, 255, 255]);
    expect(jpg.decoded.pixels[0][3]).toBe(255);
    await expect(page.locator('[data-export-note]')).toContainText('exported on white');

    await page.locator('[data-format]').selectOption('image/webp');
    await expect(page.locator('[data-quality-wrap]')).toBeVisible();
    const webp = await downloadAndDecode(
      page,
      () => page.locator('[data-download]').click(),
      'image/webp',
      [
        [5, 5],
        [300, 220]
      ]
    );
    expect(webp.filename).toMatch(/-no-background\.webp$/);
    expect(webp.decoded.width).toBe(600);
    expect(webp.decoded.height).toBe(400);
    expect(webp.decoded.pixels[0][3]).toBeLessThan(10);
    expect(webp.decoded.pixels[1][3]).toBeGreaterThan(180);
  });

  test('renders studio contact shadow and floor reflection into the export', async ({ page }) => {
    await loadSynthetic(page, { width: 640, height: 520 });
    await chooseBackground(page, 'studio');
    const bounds = await page.evaluate(() => window.__bgrTest.getState().bounds);
    expect(bounds).toBeTruthy();

    const below = [];
    for (let i = 0; i < 12; i++) {
      below.push([Math.round((bounds.x + bounds.w / 2) * 640), Math.round((bounds.y + bounds.h) * 520) + i * 2]);
    }
    const top = [[8, 8]];

    await page.evaluate(() => window.__bgrTest.setStudio({ shadowOpacity: 0, reflection: 0 }));
    const without = await scenePixels(page, [...top, ...below]);
    await page.evaluate(() => window.__bgrTest.setStudio({ shadowOpacity: 88, reflection: 0 }));
    const shadow = await scenePixels(page, [...top, ...below]);
    await page.evaluate(() =>
      window.__bgrTest.setStudio({ shadowOpacity: 0, reflection: 80, reflectionFade: 55 })
    );
    const reflection = await scenePixels(page, [...top, ...below]);

    expect(without.pixels[0].slice(0, 3)).toEqual([255, 255, 255]);
    const average = (pixels) => {
      const subset = pixels.slice(1);
      return subset.reduce((sum, pixel) => sum + pixel[0] + pixel[1] + pixel[2], 0) / (subset.length * 3);
    };
    expect(average(shadow.pixels)).toBeLessThan(average(without.pixels) - 1);
    expect(average(reflection.pixels)).toBeLessThan(average(without.pixels) - 0.5);
    expect(reflection.pixels[0][3]).toBe(255);
  });

  test('erase, restore, undo, redo and reset work and the canvas never scrolls the page', async ({ page }) => {
    await loadSynthetic(page, { width: 700, height: 500 });
    const initial = (await page.evaluate(() => window.__bgrTest.getState())).coverage;

    await page.evaluate(() => window.__bgrTest.setBrush(220, 85));
    await page.locator('.bgr-toolbar [data-tool="erase"]').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('[data-canvas]').boundingBox();
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(centreX, centreY);
    await page.mouse.wheel(0, 400);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBe(scrollBefore);

    await page.mouse.move(centreX - 40, centreY);
    await page.mouse.down();
    await page.mouse.move(centreX + 40, centreY, { steps: 10 });
    await page.mouse.up();

    const erased = (await page.evaluate(() => window.__bgrTest.getState())).coverage;
    expect(erased).toBeLessThan(initial - 0.005);
    await expect(page.locator('[data-undo]')).toBeEnabled();

    await page.locator('[data-undo]').click();
    const undone = (await page.evaluate(() => window.__bgrTest.getState())).coverage;
    expect(undone).toBeCloseTo(initial, 4);

    await page.locator('[data-redo]').click();
    const redone = (await page.evaluate(() => window.__bgrTest.getState())).coverage;
    expect(redone).toBeLessThan(initial - 0.005);

    await page.locator('[data-reset-mask]').click();
    const reset = (await page.evaluate(() => window.__bgrTest.getState())).coverage;
    expect(reset).toBeCloseTo(initial, 4);

    const beforeRestore = reset;
    await page.evaluate(() => window.__bgrTest.applyBrush('restore', [[0.08, 0.5], [0.09, 0.52]]));
    const restored = (await page.evaluate(() => window.__bgrTest.getState())).coverage;
    expect(restored).toBeGreaterThan(beforeRestore);
    await page.locator('[data-undo]').click();
    const afterUndo = (await page.evaluate(() => window.__bgrTest.getState())).coverage;
    expect(afterUndo).toBeCloseTo(beforeRestore, 4);
  });

  test('preserves full resolution and caps very large exports at 6000 px', async ({ page }) => {
    await loadSynthetic(page, { width: 1800, height: 1200 });
    const full = await downloadAndDecode(
      page,
      () => page.locator('[data-download]').click(),
      'image/png',
      [[10, 10]]
    );
    expect(full.decoded.width).toBe(1800);
    expect(full.decoded.height).toBe(1200);

    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles(fixture('wide-7000.jpg'));
    await expect(page.locator('[data-file-meta]')).toContainText('7000 × 800 px');
    await expect(page.locator('[data-file-meta]')).toContainText('processed at 6000 × 686');
    expect(await page.evaluate(() => window.__bgrTest.applySyntheticMask())).toBe(true);

    const capped = await downloadAndDecode(
      page,
      () => page.locator('[data-download]').click(),
      'image/png',
      [[10, 10]]
    );
    expect(capped.decoded.width).toBe(6000);
    expect(capped.decoded.height).toBe(686);
  });

  test('stays usable on a mobile viewport with touch-safe canvas and compact navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTool(page);

    const menuButton = page.locator('.menu-button');
    const nav = page.locator('#primary-links');
    await expect(menuButton).toBeVisible();
    await expect(nav).toBeHidden();
    await menuButton.click();
    await expect(nav).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await loadSynthetic(page, { width: 600, height: 400 });
    const layout = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      viewport: window.innerWidth,
      touchAction: getComputedStyle(document.querySelector('[data-canvas]')).touchAction
    }));
    expect(layout.doc).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.body).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.touchAction).toBe('none');

    await chooseBackground(page, 'studio');
    await expect(page.locator('[data-bg-panel="studio"]')).toBeVisible();
    await expect(page.locator('[data-download]')).toBeVisible();

    await page.reload();
    await expect(page.locator('h1')).toHaveText('AI Background Remover');
    await expect(page.locator('[data-empty]')).toBeVisible();
  });

  test('cancels a running job without leaving the tool stuck', async ({ page }) => {
    await openTool(page);
    await useLocal(page);
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.locator('[data-file-input]').setInputFiles(fixture('portrait-curls.jpg'));
    await expect(page.locator('[data-file-meta]')).toContainText('1200 × 1800 px');
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-processing]')).toBeVisible();
    await page.locator('[data-cancel]').click();
    await expect(page.locator('[data-processing]')).toBeHidden();
    await expect(page.locator('[data-status]')).toContainText('cancelled');
    await expect(page.locator('[data-download]')).toBeDisabled();
    expect(problems).toEqual([]);
  });

  test('reports a clear, recoverable error when the model cannot load', async ({ page }) => {
    await page.route('**/vendor/background-removal/model_fp16.onnx', (route) => route.abort());
    await openTool(page);
    await useLocal(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await expect(page.locator('[data-process]')).toBeEnabled();
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-error]')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-error-text]')).not.toBeEmpty();
    await expect(page.locator('[data-processing]')).toBeHidden();
    await expect(page.locator('[data-download]')).toBeDisabled();
    await expect(page.locator('[data-process]')).toBeEnabled();
    await expect(page.locator('[data-status]')).toContainText('failed');

    /* The local failure offers Cloudflare as an explicit, consent-gated fallback. */
    await expect(page.locator('[data-fallback-dialog]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-fallback-dialog]')).toBeHidden();

    await page.locator('[data-error-close]').click();
    await page.unroute('**/vendor/background-removal/model_fp16.onnx');
    await page.locator('[data-file-input]').setInputFiles(fixture('portrait-hair.jpg'));
    await expect(page.locator('[data-process]')).toBeEnabled();
  });

  test('removes a real portrait background locally and exports the original size', async ({ page }) => {
    test.setTimeout(300000);
    const problems = [];
    const requests = [];
    let modelDownloads = 0;
    page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !isRuntimeNoise(message.text())) {
        problems.push('console: ' + message.text());
      }
    });
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });
    page.on('response', (response) => {
      if (response.url().endsWith('/vendor/background-removal/model_fp16.onnx')) modelDownloads += 1;
    });

    await openTool(page);
    await useLocal(page);
    await page.locator('[data-file-input]').setInputFiles(fixture('portrait-hair.jpg'));
    await expect(page.locator('[data-file-meta]')).toContainText('1200 × 1800 px');
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-processing]')).toBeVisible();
    await expect(page.locator('[data-consent-dialog]')).toBeHidden();
    await expect(page.locator('[data-download]')).toBeEnabled({ timeout: 270000 });
    await expect(page.locator('[data-processing]')).toBeHidden();
    await expect(page.locator('[data-model-note]')).toContainText('Local AI ready');

    const state = await page.evaluate(() => window.__bgrTest.getState());
    expect(state.hasAlpha).toBe(true);
    expect(state.status).toBe('done');
    expect(state.coverage).toBeGreaterThan(0.2);
    expect(state.coverage).toBeLessThan(0.95);
    expect(['wasm', 'webgpu']).toContain(state.backend);

    const alpha = await page.evaluate(() => ({
      corner: window.__bgrTest.alphaAt(4, 4),
      centre: window.__bgrTest.alphaAt(600, 900)
    }));
    expect(alpha.corner).toBeLessThan(12);
    expect(alpha.centre).toBeGreaterThan(180);
    expect(state.modelVerified).toBe(true);
    await expect(page.locator('[data-model-note]')).toContainText('SHA-256 verified');

    expect(modelDownloads).toBe(1);
    const meaningful = requests.filter((request) => !isAnalyticsNoise(request.url));
    expect(meaningful.filter((request) => ['POST', 'PUT', 'PATCH'].includes(request.method))).toEqual([]);
    expect(meaningful.every((request) => !/upload|multipart/i.test(request.url))).toBe(true);
    const modelRequest = meaningful.filter((request) =>
      request.url.endsWith('/vendor/background-removal/model_fp16.onnx')
    );
    expect(modelRequest).toHaveLength(1);
    expect(modelRequest[0].method).toBe('GET');
    expect(modelRequest[0].url.startsWith('http://127.0.0.1:4173/')).toBe(true);

    const png = await downloadAndDecode(
      page,
      () => page.locator('[data-download]').click(),
      'image/png',
      [
        [4, 4],
        [600, 900]
      ]
    );
    expect(png.filename).toMatch(/-no-background\.png$/);
    expect(png.decoded.width).toBe(1200);
    expect(png.decoded.height).toBe(1800);
    expect(png.decoded.pixels[0][3]).toBeLessThan(12);
    expect(png.decoded.pixels[1][3]).toBeGreaterThan(180);

    await chooseBackground(page, 'studio');
    const studio = await scenePixels(page, [[6, 6]]);
    expect(studio.pixels[0].slice(0, 3)).toEqual([255, 255, 255]);
    expect(problems).toEqual([]);
  });

  test('downloads and verifies the model from a configured cross-origin host', async ({
    page,
    context
  }) => {
    test.setTimeout(300000);
    const modelUrl = modelOrigin + '/model_fp16.onnx';
    await pointModelAt(context, modelUrl);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await openTool(page);
    await useLocal(page);
    await page.locator('[data-file-input]').setInputFiles(fixture('portrait-hair.jpg'));
    await expect(page.locator('[data-process]')).toBeEnabled();
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-download]')).toBeEnabled({ timeout: 270000 });
    await expect(page.locator('[data-processing]')).toBeHidden();

    const state = await page.evaluate(() => window.__bgrTest.getState());
    expect(state.status).toBe('done');
    expect(state.modelVerified).toBe(true);
    expect(['wasm', 'webgpu']).toContain(state.backend);
    expect(requests.filter((url) => url === modelUrl)).toHaveLength(1);
    await expect(page.locator('[data-model-note]')).toContainText('SHA-256 verified');
  });

  test('explains a cross-origin model host that does not allow CORS', async ({ page, context }) => {
    const modelUrl = modelOrigin + '/no-cors/model_fp16.onnx';
    await pointModelAt(context, modelUrl);
    await openTool(page);
    await useLocal(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-error]')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-error-text]')).toContainText(/CORS|could not be reached/i);
    await expect(page.locator('[data-processing]')).toBeHidden();
    await expect(page.locator('[data-process]')).toBeEnabled();
    await expect(page.locator('[data-fallback-dialog]')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('rejects a corrupted model and retries the download once', async ({ page, context }) => {
    const badConfig =
      'export const MODEL_CONFIG = Object.freeze(' +
      JSON.stringify({
        url: '/test-model.onnx',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
        bytes: 16,
        version: 'test-invalid'
      }) +
      ');';
    await context.route('**/js/background-remover/model-config.mjs', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: badConfig })
    );
    let requests = 0;
    await context.route('**/test-model.onnx', (route) => {
      requests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.alloc(16, 7)
      });
    });

    await openTool(page);
    await useLocal(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-error]')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-error-text]')).toContainText(/SHA-256 integrity/i);
    expect(requests).toBe(2);
    await expect(page.locator('[data-processing]')).toBeHidden();
    await expect(page.locator('[data-process]')).toBeEnabled();
    await page.keyboard.press('Escape');
  });

  test('ignores and deletes a corrupted model already stored in Cache Storage', async ({
    page,
    context
  }) => {
    const badConfig =
      'export const MODEL_CONFIG = Object.freeze(' +
      JSON.stringify({
        url: '/test-cached-model.onnx',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
        bytes: 16,
        version: 'test-invalid'
      }) +
      ');';
    await context.route('**/js/background-remover/model-config.mjs', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: badConfig })
    );
    let requests = 0;
    await context.route('**/test-cached-model.onnx', (route) => {
      requests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.alloc(16, 7)
      });
    });

    await openTool(page);
    /* Seed the cache with the wrong bytes under the configured model URL. */
    await page.evaluate(async () => {
      const cache = await caches.open('letitedit-bgr-model-v1');
      await cache.put(
        new URL('/test-cached-model.onnx', location.href).href,
        new Response(new Uint8Array(16).fill(1), {
          headers: { 'content-type': 'application/octet-stream' }
        })
      );
    });
    await useLocal(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-error]')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-error-text]')).toContainText(/SHA-256 integrity/i);
    expect(requests).toBe(2);
    const stillCached = await page.evaluate(async () => {
      const cache = await caches.open('letitedit-bgr-model-v1');
      return !!(await cache.match(new URL('/test-cached-model.onnx', location.href).href));
    });
    expect(stillCached).toBe(false);
    await page.keyboard.press('Escape');
  });

  test('asks for consent on a first visit and does not upload when declined', async ({ page }) => {
    let posts = 0;
    await page.route('**/api/background-removal', (route) => {
      posts += 1;
      return route.fulfill({ status: 200, contentType: 'image/png', body: makeMaskPng() });
    });
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-consent-dialog]')).toBeVisible();
    await expect(page.locator('[data-consent-dialog]')).toContainText('Cloudflare Images');
    await expect(page.locator('[data-consent-dialog]')).toContainText('Send to Cloudflare');
    await page.locator('[data-consent-dialog] button[value="decline"]').click();
    await expect(page.locator('[data-consent-dialog]')).toBeHidden();
    await expect(page.locator('[data-status]')).toContainText('not uploaded');
    await expect(page.locator('[data-download]')).toBeDisabled();
    expect(posts).toBe(0);
  });

  test('processes a first image through Cloudflare after consent', async ({ page }) => {
    test.setTimeout(60000);
    const png = makeMaskPng();
    const requests = [];
    await page.route('**/api/background-removal', (route) => {
      requests.push(route.request().method());
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    /* Do not download the 94 MB model during this cloud-path test. */
    await page.route('**/vendor/background-removal/model_fp16.onnx', (route) => route.abort());

    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-consent-dialog]')).toBeVisible();
    await page.locator('[data-consent-go]').click();
    await expect(page.locator('[data-download]')).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('[data-processing]')).toBeHidden();

    const state = await page.evaluate(() => window.__bgrTest.getState());
    expect(state.lastEngine).toBe('cloud');
    expect(state.backend).toBe('cloudflare');
    expect(state.hasAlpha).toBe(true);
    expect(state.status).toBe('done');
    expect(requests).toEqual(['POST']);
    await expect(page.locator('[data-model-note]')).toContainText(/Cloudflare/i);
  });

  test('handles an exhausted Cloudflare Images free allowance without charging', async ({ page }) => {
    await page.route('**/api/background-removal', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'quota',
          message:
            'The monthly Cloudflare Images free allowance has been used up. No charge was made and no paid fallback was attempted.'
        })
      })
    );
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await page.locator('[data-consent-go]').click();
    await expect(page.locator('[data-error]')).toBeVisible();
    await expect(page.locator('[data-error-text]')).toContainText('free allowance');
    await expect(page.locator('[data-fallback-dialog]')).toBeVisible();
    await expect(page.locator('[data-fallback-dialog]')).toContainText('No charge was made');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-download]')).toBeDisabled();
  });

  test('processes repeated images in one tab with consent for each upload', async ({ page }) => {
    test.setTimeout(60000);
    const png = makeMaskPng();
    let posts = 0;
    await page.route('**/api/background-removal', (route) => {
      posts += 1;
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    await page.route('**/vendor/background-removal/model_fp16.onnx', (route) => route.abort());

    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
    await page.locator('[data-process]').click();
    await page.locator('[data-consent-go]').click();
    await expect(page.locator('[data-download]')).toBeEnabled({ timeout: 30000 });

    await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.jpg'));
    await expect(page.locator('[data-process]')).toBeEnabled();
    await page.locator('[data-process]').click();
    await expect(page.locator('[data-consent-dialog]')).toBeVisible();
    await page.locator('[data-consent-go]').click();
    await expect(page.locator('[data-download]')).toBeEnabled({ timeout: 30000 });

    expect(posts).toBe(2);
    const state = await page.evaluate(() => window.__bgrTest.getState());
    expect(state.lastEngine).toBe('cloud');
    expect(state.status).toBe('done');
  });

  test('keeps consent and upload state separate in two tabs', async ({ context }) => {
    let posts = 0;
    await context.route('**/api/background-removal', (route) => {
      posts += 1;
      return route.fulfill({ status: 200, contentType: 'image/png', body: makeMaskPng() });
    });
    const first = await context.newPage();
    const second = await context.newPage();
    await openTool(first);
    await openTool(second);

    for (const page of [first, second]) {
      await page.locator('[data-file-input]').setInputFiles(sharedFixture('sample.png'));
      await page.locator('[data-process]').click();
      await expect(page.locator('[data-consent-dialog]')).toBeVisible();
    }
    await first.locator('[data-consent-dialog] button[value="decline"]').click();
    await second.locator('[data-consent-dialog] button[value="decline"]').click();
    await expect(first.locator('[data-status]')).toContainText('not uploaded');
    await expect(second.locator('[data-status]')).toContainText('not uploaded');
    expect(posts).toBe(0);
  });

  test('builds a Cloudflare Pages output with no file over 25 MiB', async () => {
    test.setTimeout(120000);
    const root = path.join(__dirname, '..', '..');
    execFileSync(process.execPath, [path.join(root, 'scripts', 'build-pages.js')], {
      cwd: root,
      env: {
        ...process.env,
        BGR_MODEL_URL:
          'https://models.example.invalid/birefnet/962e67969ec6acec9c19fab76acee4f5e22e990c/model_fp16.onnx'
      },
      stdio: 'pipe'
    });
    const output = path.join(root, 'dist');
    const files = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push({ full, size: fs.statSync(full).size });
      }
    };
    walk(output);
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => file.size > 25 * 1024 * 1024)).toEqual([]);
    expect(fs.existsSync(path.join(output, 'vendor', 'background-removal', 'model_fp16.onnx'))).toBe(
      false
    );
    const config = fs.readFileSync(
      path.join(output, 'js', 'background-remover', 'model-config.mjs'),
      'utf8'
    );
    expect(config).toContain('models.example.invalid');
    expect(config).toContain('eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516');

    /* Worker code, Pages Functions and Wrangler config must stay out of the
     * static output. Pages reads `functions/` from the project root instead. */
    expect(fs.existsSync(path.join(output, 'functions'))).toBe(false);
    expect(fs.existsSync(path.join(output, 'workers'))).toBe(false);
    expect(fs.existsSync(path.join(output, 'wrangler.toml'))).toBe(false);
    expect(fs.existsSync(path.join(output, '.env'))).toBe(false);

    const headers = fs.readFileSync(path.join(output, '_headers'), 'utf8');
    expect(headers).toContain('Cross-Origin-Embedder-Policy: credentialless');
    expect(headers).toContain('Content-Security-Policy-Report-Only');
  });

  test('serves the model and runtime licences with the vendored assets', async ({ page, request }) => {
    await openTool(page);
    const model = path.join(__dirname, '..', '..', 'vendor', 'background-removal', 'model_fp16.onnx');
    const runtime = path.join(__dirname, '..', '..', 'vendor', 'onnxruntime', 'ort.wasm.min.mjs');
    expect(fs.statSync(model).size).toBe(98484532);
    expect(fs.statSync(runtime).size).toBeGreaterThan(10000);

    const readme = await request.get('/vendor/background-removal/README.md');
    expect(readme.status()).toBe(200);
    expect(await readme.text()).toContain('MIT');

    const licence = await request.get('/vendor/onnxruntime/LICENSE');
    expect(licence.status()).toBe(200);
    expect(await licence.text()).toContain('MIT License');
  });
});
