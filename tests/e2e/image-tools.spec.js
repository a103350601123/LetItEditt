const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const registry = require('../../data/registry');

const IMAGE_SLUGS = [
  'image-editor', 'heic-viewer', 'add-border-to-image', 'photo-merger',
  'screenshot-beautifier', 'black-and-white-image-converter', 'image-flip-rotate',
  'image-resizer', 'image-to-svg', 'image-inverter', 'image-to-text',
  'qr-code-generator', 'image-compressor'
];

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function makePng(page, options = {}) {
  const width = options.width || 64;
  const height = options.height || 40;
  const mode = options.mode || 'halves';
  const color = options.color || '#ff0000';
  const dataUrl = await page.evaluate(({ width, height, mode, color }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (mode === 'halves') {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, width, height / 2);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, height / 2, width, height / 2);
    } else if (mode === 'noise') {
      const data = ctx.createImageData(width, height);
      let seed = 123456789;
      for (let i = 0; i < data.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data.data[i] = seed & 255;
        data.data[i + 1] = (seed >>> 8) & 255;
        data.data[i + 2] = (seed >>> 16) & 255;
        data.data[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
    } else if (mode === 'text') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 58px Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('LETITEDIT', 14, height / 2);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
    }
    return canvas.toDataURL('image/png');
  }, { width, height, mode, color });
  return {
    name: options.name || `${mode}-${width}x${height}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  };
}

async function inspectImage(page, buffer, mime, points) {
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  return page.evaluate(async ({ dataUrl, points }) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      pixels: points.map(point => Array.from(ctx.getImageData(point[0], point[1], 1, 1).data))
    };
  }, { dataUrl, points });
}

async function canvasSize(page) {
  return page.locator('#image-preview').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
}

async function expectCanvasSize(page, width, height) {
  await expect.poll(async () => {
    const size = await canvasSize(page);
    return `${size.width}x${size.height}`;
  }, { timeout: 15000 }).toBe(`${width}x${height}`);
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function downloadBuffer(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(selector).click()
  ]);
  const file = await download.path();
  return { name: download.suggestedFilename(), buffer: fs.readFileSync(file) };
}

async function decodeQr(page, buffer) {
  return page.evaluate(async dataUrl => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const result = window.jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    return result && result.data;
  }, `data:image/png;base64,${buffer.toString('base64')}`);
}

async function gotoImageTool(page, slug) {
  await page.goto(`/${slug}/`);
  await expect(page.locator(`[data-image-engine="${slug}"]`)).toHaveCount(1);
}

test('image editor crops, rotates, flips, adjusts, overlays text and resets safely', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoImageTool(page, 'image-editor');
  const source = await makePng(page, { width: 80, height: 40 });
  await page.setInputFiles('#image-file', source);
  await expect(page.locator('#image-download')).toBeEnabled();
  await expectCanvasSize(page, 80, 40);

  await setRange(page, 'ie-crop-x', 10);
  await setRange(page, 'ie-crop-y', 5);
  await setRange(page, 'ie-crop-w', 40);
  await setRange(page, 'ie-crop-h', 20);
  await page.click('#ie-crop-apply');
  await expect(page.locator('#image-status')).toContainText('Edit applied');
  await expectCanvasSize(page, 40, 20);

  await page.click('#ie-rot-right');
  await expectCanvasSize(page, 20, 40);
  await page.click('#ie-flip-h');
  await expectCanvasSize(page, 20, 40);

  await setRange(page, 'ie-brightness', 150);
  await page.fill('#ie-text', 'Hello');
  const download = await downloadBuffer(page, '#image-download');
  expect(download.name).toMatch(/\.png$/);
  const result = await inspectImage(page, download.buffer, 'image/png', [[10, 20]]);
  expect([result.width, result.height]).toEqual([20, 40]);
  expect(result.pixels[0][3]).toBe(255);

  await page.click('#image-reset');
  await expect(page.locator('#image-download')).toBeDisabled();
  await expect(page.locator('#image-status')).toContainText('Editor reset');

  await page.setInputFiles('#image-file', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('#image-status')).toContainText('could not be decoded');
  await expect(page.locator('#image-download')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('image editor caption scales with the image, wraps lines and can be toggled', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoImageTool(page, 'image-editor');
  const white = await makePng(page, { width: 600, height: 200, mode: 'solid', color: '#ffffff' });
  await page.setInputFiles('#image-file', white);

  await page.fill('#ie-text', 'LETITEDIT\nCAPTION');
  await setRange(page, 'ie-text-size', 8);
  await page.locator('#ie-text-color').evaluate(element => {
    element.value = '#ff0000';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#ie-text')).toHaveValue('LETITEDIT\nCAPTION');

  const countRed = () => page.locator('#image-preview').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80) count++;
    }
    return count;
  });
  const withText = await countRed();
  expect(withText).toBeGreaterThan(100);

  const withBacking = await page.locator('#image-preview').evaluate(canvas => canvas.toDataURL());
  await page.uncheck('#ie-text-bg');
  const withoutBacking = await page.locator('#image-preview').evaluate(canvas => canvas.toDataURL());
  expect(withoutBacking).not.toBe(withBacking);
  await page.check('#ie-text-bg');

  await page.fill('#ie-text', '');
  expect(await countRed()).toBe(0);

  await page.fill('#ie-text', 'SALE');
  const download = await downloadBuffer(page, '#image-download');
  const result = await inspectImage(page, download.buffer, 'image/png', [[300, 170]]);
  expect([result.width, result.height]).toEqual([600, 200]);
  expect(errors).toEqual([]);
});

test('HEIC viewer decodes real variants, previews, downloads and reports corrupt files', async ({ page }) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  await gotoImageTool(page, 'heic-viewer');
  const fixture = path.resolve(__dirname, '../fixtures/example.heic');
  await page.setInputFiles('#image-file', [fixture, fixture]);
  await expect(page.locator('#image-status')).toContainText('Decoded 4 image(s)');
  await expect(page.locator('.heic-card')).toHaveCount(4);
  await expect(page.locator('#image-meta')).toContainText('1 of 4');
  await expectCanvasSize(page, 1280, 854);

  const download = await downloadBuffer(page, '#image-download');
  expect(download.name).toMatch(/\.png$/);
  const decoded = await inspectImage(page, download.buffer, 'image/png', [[10, 10]]);
  expect([decoded.width, decoded.height]).toEqual([1280, 854]);

  await page.setInputFiles('#image-file', { name: 'invalid.heic', mimeType: 'image/heic', buffer: Buffer.from('not a heic file') });
  await expect(page.locator('#image-status')).toContainText('No images could be decoded');
  await expect(page.locator('#image-download')).toBeDisabled();

  await page.click('#image-reset');
  await expect(page.locator('#image-meta')).toHaveText('0 decoded');
  expect(errors).toEqual([]);
});

test('border tool exports original pixels plus an exact border and honours presets', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoImageTool(page, 'add-border-to-image');
  const source = await makePng(page, { width: 40, height: 20 });
  await page.setInputFiles('#image-file', source);

  await setRange(page, 'brd-width', 5);
  await page.locator('#brd-color').evaluate(element => {
    element.value = '#2563eb';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectCanvasSize(page, 50, 30);
  const previewPixels = await page.locator('#image-preview').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    return [
      Array.from(ctx.getImageData(0, 0, 1, 1).data),
      Array.from(ctx.getImageData(5, 5, 1, 1).data)
    ];
  });
  expect(previewPixels[0]).toEqual([37, 99, 235, 255]);
  expect(previewPixels[1]).toEqual([255, 0, 0, 255]);

  await page.click('[data-brd-color="#f97316"]');
  await expect(page.locator('#brd-color')).toHaveValue('#f97316');
  const download = await downloadBuffer(page, '#image-download');
  const result = await inspectImage(page, download.buffer, 'image/png', [[0, 0], [5, 5]]);
  expect([result.width, result.height]).toEqual([50, 30]);
  expect(result.pixels[0]).toEqual([249, 115, 22, 255]);
  expect(result.pixels[1]).toEqual([255, 0, 0, 255]);

  await page.click('#image-reset');
  await expect(page.locator('#image-download')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('photo merger honours layout, gap, order, removal and the six-image cap', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoImageTool(page, 'photo-merger');
  const files = await Promise.all([
    makePng(page, { width: 20, height: 10, mode: 'solid', color: '#ff0000', name: 'one.png' }),
    makePng(page, { width: 20, height: 10, mode: 'solid', color: '#00ff00', name: 'two.png' }),
    makePng(page, { width: 20, height: 10, mode: 'solid', color: '#0000ff', name: 'three.png' })
  ]);
  await page.setInputFiles('#image-file', files);
  await setRange(page, 'pm-spacing', 4);
  await expectCanvasSize(page, 68, 10);
  let pixels = await page.locator('#image-preview').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    return [Array.from(ctx.getImageData(1, 5, 1, 1).data), Array.from(ctx.getImageData(25, 5, 1, 1).data)];
  });
  expect(pixels[0]).toEqual([255, 0, 0, 255]);
  expect(pixels[1]).toEqual([0, 255, 0, 255]);

  await page.check('input[name="pm-direction"][value="vertical"]');
  await expectCanvasSize(page, 20, 38);
  await page.locator('.pm-order-row').first().getByRole('button', { name: /down/ }).click();
  pixels = await page.locator('#image-preview').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    return Array.from(ctx.getImageData(10, 1, 1, 1).data);
  });
  expect(pixels).toEqual([0, 255, 0, 255]);

  const download = await downloadBuffer(page, '#image-download');
  const result = await inspectImage(page, download.buffer, 'image/png', [[10, 1]]);
  expect([result.width, result.height]).toEqual([20, 38]);
  expect(result.pixels[0]).toEqual([0, 255, 0, 255]);

  await page.locator('.pm-order-row').first().getByRole('button', { name: /remove/ }).click();
  await expect(page.locator('.pm-order-row')).toHaveCount(2);
  await page.setInputFiles('#image-file', Array.from({ length: 7 }, (_, i) => files[i % 3]));
  await expect(page.locator('#image-status')).toContainText('up to six images');
  expect(errors).toEqual([]);
});

test('screenshot beautifier renders a real styled canvas with presets and title bars', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoImageTool(page, 'screenshot-beautifier');
  const source = await makePng(page, { width: 60, height: 30, mode: 'solid', color: '#ff0000' });
  await page.setInputFiles('#image-file', source);

  await page.selectOption('#sb-bg-type', 'solid');
  await page.locator('#sb-color1').evaluate(element => {
    element.value = '#2563eb';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await setRange(page, 'sb-padding', 10);
  await setRange(page, 'sb-shadow-blur', 8);
  await page.check('#sb-titlebar');
  await page.fill('#sb-overlay-text', 'SHOT');
  await page.click('#sb-apply');
  const styled = await canvasSize(page);
  expect(styled.width).toBeGreaterThan(60);
  expect(styled.height).toBeGreaterThan(30);
  let corner = await page.locator('#image-preview').evaluate(canvas =>
    Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data)
  );
  expect(corner).toEqual([37, 99, 235, 255]);

  await page.click('[data-sb-preset="dark"]');
  corner = await page.locator('#image-preview').evaluate(canvas =>
    Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data)
  );
  expect(corner).toEqual([15, 23, 42, 255]);

  await page.selectOption('#sb-bg-type', 'transparent');
  await page.click('#sb-apply');
  corner = await page.locator('#image-preview').evaluate(canvas =>
    Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data)
  );
  expect(corner[3]).toBe(0);

  const download = await downloadBuffer(page, '#image-download');
  const result = await inspectImage(page, download.buffer, 'image/png', [[2, 2]]);
  expect(result.width).toBeGreaterThan(60);
  expect(result.pixels[0][3]).toBe(0);

  await page.click('#image-reset');
  await expect(page.locator('#image-download')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('black and white, inversion, orientation, resizing and SVG wrapping produce real output', async ({ page }) => {
  const errors = collectErrors(page);
  const source = await makePng(page, { width: 80, height: 40 });

  await gotoImageTool(page, 'black-and-white-image-converter');
  await page.setInputFiles('#image-file', source);
  let pixels = await page.locator('#image-preview').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    return Array.from(ctx.getImageData(2, 2, 1, 1).data);
  });
  expect(pixels[0]).toBe(pixels[1]);
  expect(pixels[1]).toBe(pixels[2]);
  await page.selectOption('#bw-mode', 'threshold');
  await setRange(page, 'bw-threshold', 50);
  pixels = await page.locator('#image-preview').evaluate(canvas =>
    Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data)
  );
  expect([pixels[0], pixels[1], pixels[2]]).toEqual([255, 255, 255]);
  let download = await downloadBuffer(page, '#image-download');
  expect(download.name).toMatch(/\.png$/);
  await page.click('#image-reset');

  await gotoImageTool(page, 'image-inverter');
  await page.setInputFiles('#image-file', source);
  pixels = await page.locator('#image-preview').evaluate(canvas =>
    Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data)
  );
  expect(pixels).toEqual([0, 255, 255, 255]);
  download = await downloadBuffer(page, '#image-download');
  const inverted = await inspectImage(page, download.buffer, 'image/png', [[2, 2]]);
  expect(inverted.pixels[0]).toEqual([0, 255, 255, 255]);
  await page.click('#image-reset');

  await gotoImageTool(page, 'image-flip-rotate');
  await page.setInputFiles('#image-file', source);
  await page.click('#fr-rot-right');
  await expectCanvasSize(page, 40, 80);
  await page.click('#fr-flip-h');
  await expectCanvasSize(page, 40, 80);
  download = await downloadBuffer(page, '#image-download');
  const oriented = await inspectImage(page, download.buffer, 'image/png', [[2, 2]]);
  expect([oriented.width, oriented.height]).toEqual([40, 80]);
  await page.click('#image-reset');

  await gotoImageTool(page, 'image-resizer');
  await page.setInputFiles('#image-file', source);
  await page.uncheck('#rs-lock');
  await page.fill('#rs-width', '30');
  await page.fill('#rs-height', '30');
  await page.click('#rs-apply');
  await expectCanvasSize(page, 30, 30);
  download = await downloadBuffer(page, '#image-download');
  const resized = await inspectImage(page, download.buffer, 'image/png', [[1, 1]]);
  expect([resized.width, resized.height]).toEqual([30, 30]);
  await page.click('#image-reset');

  await gotoImageTool(page, 'image-to-svg');
  await page.setInputFiles('#image-file', source);
  await expect(page.locator('#image-download')).toHaveText('Download SVG');
  download = await downloadBuffer(page, '#image-download');
  const svg = download.buffer.toString('utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('width="80"');
  expect(svg).toContain('height="40"');
  expect(svg).toContain('href="data:image/png;base64,');
  expect(svg).not.toContain('<path');
  expect(errors).toEqual([]);
});

test('QR generator downloads scannable PNG and SVG and refuses oversized private images', async ({ page }) => {
  test.setTimeout(120000);
  const errors = collectErrors(page);
  const uploads = [];
  page.on('request', request => {
    if (request.method() !== 'GET') uploads.push(request.url());
  });
  await gotoImageTool(page, 'qr-code-generator');
  await page.fill('#qr-text', 'https://letitedit.com/image-editor/');
  await page.click('#qr-generate');
  await expect(page.locator('#image-status')).toContainText('QR code generated');

  const png = await downloadBuffer(page, '#image-download');
  await page.addScriptTag({ url: '/js/vendor/jsQR.js' });
  expect(await decodeQr(page, png.buffer)).toBe('https://letitedit.com/image-editor/');

  const svg = await downloadBuffer(page, '#qr-download-svg');
  expect(svg.buffer.toString('utf8')).toContain('<path');

  const smallImage = await makePng(page, { width: 8, height: 8, mode: 'solid', color: '#2563eb' });
  await page.check('input[name="qr-mode"][value="image"]');
  await page.setInputFiles('#qr-image-file', smallImage);
  await page.click('#qr-generate');
  await expect(page.locator('#image-status')).toContainText('QR code generated');
  const imageQr = await downloadBuffer(page, '#image-download');
  expect(await decodeQr(page, imageQr.buffer)).toMatch(/^data:image\/png;base64,/);

  const oversized = { name: 'private.png', mimeType: 'image/png', buffer: Buffer.alloc(3 * 1024 * 1024, 7) };
  await page.check('input[name="qr-mode"][value="image"]');
  await page.setInputFiles('#qr-image-file', oversized);
  await page.click('#qr-generate');
  await expect(page.locator('#image-status')).toContainText('too large to fit a QR code');
  await expect(page.locator('#image-status')).toContainText('does not upload images');
  await expect(page.locator('#image-download')).toBeDisabled();
  expect(uploads).toEqual([]);

  await page.click('#qr-reset');
  await expect(page.locator('#image-meta')).toHaveText('No QR code generated');
  expect(errors).toEqual([]);
});

test('compressor reduces a noisy image, respects the dimension cap and rejects oversized files', async ({ page }) => {
  test.setTimeout(120000);
  const errors = collectErrors(page);
  await gotoImageTool(page, 'image-compressor');
  const source = await makePng(page, { width: 600, height: 400, mode: 'noise' });
  await page.setInputFiles('#image-file', source);
  await page.selectOption('#cmp-format', 'jpeg');
  await setRange(page, 'cmp-quality', 0.35);
  await page.fill('#cmp-max-dimension', '300');
  await expect(page.locator('#cmp-result-size')).not.toHaveText('—', { timeout: 30000 });
  const originalSize = await page.locator('#cmp-original-size').innerText();
  const resultSize = await page.locator('#cmp-result-size').innerText();
  expect(originalSize).toContain('KB');
  expect(parseFloat(resultSize)).toBeLessThan(parseFloat(originalSize));

  const download = await downloadBuffer(page, '#image-download');
  expect(download.name).toMatch(/\.jpg$/);
  const compressed = await inspectImage(page, download.buffer, 'image/jpeg', [[10, 10]]);
  expect([compressed.width, compressed.height]).toEqual([300, 200]);

  await page.selectOption('#cmp-format', 'png');
  await expect(page.locator('#cmp-quality')).toBeDisabled();
  await page.click('#image-reset');
  await expect(page.locator('#cmp-result-size')).toHaveText('—');

  const hugePath = path.join(os.tmpdir(), 'letitedit-oversized.png');
  fs.writeFileSync(hugePath, Buffer.alloc(51 * 1024 * 1024));
  try {
    await page.setInputFiles('#image-file', hugePath);
    await expect(page.locator('#image-status')).toContainText('50 MB limit');
    await expect(page.locator('#image-download')).toBeDisabled();
  } finally {
    fs.unlinkSync(hugePath);
  }
  expect(errors).toEqual([]);
});

test('OCR recognises local English text, downloads it and never uploads the image', async ({ page }) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  const uploads = [];
  page.on('request', request => {
    if (request.method() !== 'GET') uploads.push(request.url());
  });
  await gotoImageTool(page, 'image-to-text');
  await expect(page.locator('#ocr-worker-status')).toContainText('OCR engine ready', { timeout: 180000 });

  const textImage = await makePng(page, { width: 420, height: 110, mode: 'text' });
  await page.setInputFiles('#image-file', textImage);
  await expect(page.locator('#ocr-extract')).toBeEnabled();
  await page.click('#ocr-extract');
  await expect(page.locator('#ocr-output')).toHaveValue(/LETITEDIT/, { timeout: 180000 });
  await expect(page.locator('#ocr-copy')).toBeEnabled();
  await expect(page.locator('#ocr-download')).toBeEnabled();

  const download = await downloadBuffer(page, '#ocr-download');
  expect(download.name).toMatch(/\.txt$/);
  expect(download.buffer.toString('utf8')).toContain('LETITEDIT');

  const blank = await makePng(page, { width: 80, height: 40, mode: 'solid', color: '#ffffff' });
  await page.setInputFiles('#image-file', blank);
  await page.click('#ocr-extract');
  await expect(page.locator('#image-status')).toContainText('no text was found', { timeout: 180000 });
  await expect(page.locator('#ocr-copy')).toBeDisabled();
  await expect(page.locator('#ocr-download')).toBeDisabled();
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});

test('image tool pages expose unique SEO metadata, real guides and no forbidden assets', async ({ request }) => {
  const descriptions = new Set();
  const titles = new Set();
  for (const slug of IMAGE_SLUGS) {
    const tool = registry.bySlug.get(slug);
    expect(tool).toBeTruthy();
    const response = await request.get(`/${slug}/`);
    expect(response.status(), `${slug} route`).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<link rel="canonical" href="https://letitedit.com/${slug}/">`);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('FAQPage');
    expect(html).toContain('id="tool-config"');
    expect(html).toContain('In-depth guide');
    expect(html).toContain('Frequently asked questions');
    expect(html).toContain('Related tools');
    expect(html).toContain('/css/site.css');
    expect(html).toContain('/js/image-core.js');
    expect(html).toContain('/js/image-runtime.js');
    expect(tool.description.length).toBeGreaterThanOrEqual(130);
    expect(tool.description.length).toBeLessThanOrEqual(180);
    expect(tool.article.reduce((count, section) => count + section.paragraphs.join(' ').split(/\s+/).length, 0)).toBeGreaterThanOrEqual(600);
    descriptions.add(tool.description);
    titles.add(tool.title);
    for (const forbidden of ['WebUtility.io', 'WebUtility', 'G-66D2Z3H7TC', 'googletagmanager', 'grow.me', 'ScriptWrapper', 'LiteSpeed', 'OceanWP']) {
      expect(html, `${slug} contains ${forbidden}`).not.toContain(forbidden);
    }
  }
  expect(descriptions.size).toBe(IMAGE_SLUGS.length);
  expect(titles.size).toBe(IMAGE_SLUGS.length);
});

test('image workspaces stay within the viewport from 320px through 1440px', async ({ page }) => {
  for (const [width, height] of [[320, 720], [375, 812], [390, 844], [768, 900], [1024, 900], [1280, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const slug of IMAGE_SLUGS) {
      await page.goto(`/${slug}/`);
      await page.waitForSelector('.workspace');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${slug} horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
      const fit = await page.evaluate(() => {
        const workspace = document.querySelector('.workspace').getBoundingClientRect();
        const controls = document.querySelector('.image-controls').getBoundingClientRect();
        const output = document.querySelector('.image-output').getBoundingClientRect();
        return {
          workspaceBottom: workspace.bottom,
          viewportHeight: window.innerHeight,
          controlsHeight: controls.height,
          outputHeight: output.height
        };
      });
      expect(fit.workspaceBottom, `${slug} workspace bottom at ${width}x${height}`).toBeLessThanOrEqual(fit.viewportHeight);
      expect(fit.controlsHeight, `${slug} controls visible at ${width}x${height}`).toBeGreaterThan(120);
      expect(fit.outputHeight, `${slug} preview visible at ${width}x${height}`).toBeGreaterThan(120);
      if (width === 320) {
        const columns = await page.locator('.image-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns);
        expect(columns.split(' ').length, `${slug} single-column layout`).toBe(1);
      }
    }
  }
});
