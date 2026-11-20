const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const toolPath = '/media-and-motion/image-size-compressor/';
const fixture = (name) => path.join(__dirname, '..', 'fixtures', name);
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function openTool(page) {
  await page.goto(toolPath);
  await expect(page.locator('h1')).toHaveText('Image Size Compressor');
}

async function addFile(page, name) {
  await page.locator('[data-file-input]').setInputFiles(fixture(name));
  await expect(page.locator('[data-file-row]')).toHaveCount(1);
  await expect(page.locator('[data-file-meta]')).toContainText('px');
}

async function compressAll(page, expectedRows) {
  await page.locator('[data-compress]').click();
  await expect(page.locator('[data-status]')).toHaveCount(expectedRows);
  await expect.poll(async () => {
    return page.locator('[data-status]').evaluateAll((nodes) =>
      nodes.every((node) => /Compressed|larger than the original|Could not/.test(node.textContent))
    );
  }, { timeout: 60000 }).toBe(true);
}

async function downloadFirst(page) {
  const pending = page.waitForEvent('download');
  await page.locator('[data-download]').first().click();
  const download = await pending;
  return { name: download.suggestedFilename(), buffer: fs.readFileSync(await download.path()) };
}

async function decodePixels(page, buffer, mime, points) {
  return page.evaluate(async ({ base64, mime, points }) => {
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
      pixels: points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data))
    };
  }, { base64: buffer.toString('base64'), mime, points });
}

test.describe('image size compressor', () => {
  test('renders one H1, SEO metadata and the real compressor controls', async ({ page }) => {
    await openTool(page);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page).toHaveTitle('Image Size Compressor – Reduce Image File Size | LetitEdit');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://letitedit.com/media-and-motion/image-size-compressor/');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Compress JPG, PNG and WebP images in your browser/);
    const seo = await page.evaluate(() => ({
      title: document.title.length,
      description: document.querySelector('meta[name="description"]').content.length
    }));
    expect(seo.title).toBeLessThanOrEqual(65);
    expect(seo.description).toBeLessThanOrEqual(160);
    await expect(page.locator('.breadcrumbs')).toContainText('Image Size Compressor');
    await expect(page.locator('[data-compressor]')).toBeVisible();
    await expect(page.locator('[data-browse]')).toBeVisible();
    await expect(page.locator('input[name="cmp-preset"]')).toHaveCount(4);
    await expect(page.locator('[data-compress]')).toBeDisabled();
    await expect(page.locator('[data-file-row]')).toHaveCount(0);
    await expect(page.locator('[data-results]')).toBeHidden();
  });

  test('compresses a JPG without resizing and reports measured sizes', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample.jpg');
    await expect(page.locator('[data-file-meta]')).toContainText('320 × 200 px');
    await expect(page.locator('[data-file-meta]')).toContainText('6.6 KB');
    await expect(page.locator('[data-compress]')).toBeEnabled();

    await compressAll(page, 1);
    await expect(page.locator('[data-status]')).toHaveText('Compressed');
    await expect(page.locator('[data-stat="original"]')).toHaveText('6.6 KB');
    await expect(page.locator('[data-stat="advice"]')).toContainText('Dimensions are unchanged at 320 × 200 px.');

    const result = await downloadFirst(page);
    expect(result.name).toBe('sample-compressed.jpg');
    expect(result.buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(result.buffer.length).toBeLessThan(fs.statSync(fixture('sample.jpg')).size);
    expect(result.buffer.length).toBeGreaterThan(0);

    const saved = fs.statSync(fixture('sample.jpg')).size - result.buffer.length;
    await expect(page.locator('[data-stat="compressed"]')).toHaveText(formatBytes(result.buffer.length));
    await expect(page.locator('[data-stat="saved"]')).toHaveText(formatBytes(saved));
    await expect(page.locator('[data-stat="percent"]')).toHaveText(((saved / fs.statSync(fixture('sample.jpg')).size) * 100).toFixed(1) + '%');
    await expect(page.locator('[data-summary]')).toContainText('1');
  });

  test('converts to WebP and produces a real WebP file', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample.jpg');
    await page.locator('[data-format]').selectOption('image/webp');
    await compressAll(page, 1);
    const result = await downloadFirst(page);
    expect(result.name).toBe('sample-compressed.webp');
    expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const decoded = await decodePixels(page, result.buffer, 'image/webp', [[0, 0]]);
    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(200);
  });

  test('preserves transparency when PNG output is selected', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample-alpha.png');
    await expect(page.locator('[data-file-meta]')).toContainText('64 × 64 px');
    await page.locator('[data-format]').selectOption('image/png');
    await compressAll(page, 1);

    const result = await downloadFirst(page);
    expect(result.buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
    const decoded = await decodePixels(page, result.buffer, 'image/png', [[2, 2], [32, 32]]);
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
    expect(decoded.pixels[0][3]).toBe(0);
    expect(decoded.pixels[1]).toEqual([220, 40, 80, 255]);
  });

  test('warns about transparency and fills the chosen background for JPEG', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample-alpha.png');
    await page.locator('[data-format]').selectOption('image/jpeg');
    await expect(page.locator('[data-bg-field]')).toBeVisible();
    await expect(page.locator('[data-bg-hint]')).toContainText('JPEG has no transparency');

    await page.locator('[data-bg]').evaluate((input) => {
      input.value = '#ff0000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await compressAll(page, 1);
    await expect(page.locator('[data-stat="advice"]')).toContainText('flattened onto #ff0000');

    const result = await downloadFirst(page);
    expect(result.name).toBe('sample-alpha-compressed.jpg');
    expect(result.buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const decoded = await decodePixels(page, result.buffer, 'image/jpeg', [[2, 2]]);
    expect(decoded.pixels[0][0]).toBeGreaterThan(240);
    expect(decoded.pixels[0][1]).toBeLessThan(20);
    expect(decoded.pixels[0][2]).toBeLessThan(20);
  });

  test('applies EXIF orientation to a JPEG before compression', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample-exif6.jpg');
    await expect(page.locator('[data-file-meta]')).toContainText('200 × 320 px');
    await compressAll(page, 1);
    await expect(page.locator('[data-stat="advice"]')).toContainText('200 × 320 px');

    const result = await downloadFirst(page);
    const original = fs.readFileSync(fixture('sample-exif6.jpg'));
    const comparison = await page.evaluate(async ({ originalBase64, compressedBase64 }) => {
      async function sample(base64) {
        const image = new Image();
        image.src = 'data:image/jpeg;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return {
          size: [canvas.width, canvas.height],
          sun: Array.from(context.getImageData(115, 200, 1, 1).data),
          corner: Array.from(context.getImageData(20, 20, 1, 1).data)
        };
      }
      return { original: await sample(originalBase64), compressed: await sample(compressedBase64) };
    }, { originalBase64: original.toString('base64'), compressedBase64: result.buffer.toString('base64') });

    expect(comparison.compressed.size).toEqual([200, 320]);
    comparison.original.sun.forEach((channel, index) => {
      expect(Math.abs(channel - comparison.compressed.sun[index])).toBeLessThanOrEqual(10);
    });
    comparison.original.corner.forEach((channel, index) => {
      expect(Math.abs(channel - comparison.compressed.corner[index])).toBeLessThanOrEqual(10);
    });
  });

  test('produces different file sizes for the High and Maximum presets', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample.jpg');
    await page.locator('.cmp-preset', { hasText: 'High quality' }).click();
    await compressAll(page, 1);
    const high = await downloadFirst(page);

    await page.locator('[data-reset]').click();
    await addFile(page, 'sample.jpg');
    await page.locator('.cmp-preset', { hasText: 'Maximum compression' }).click();
    await compressAll(page, 1);
    const maximum = await downloadFirst(page);

    expect(maximum.buffer.length).toBeLessThan(high.buffer.length);
    expect(high.buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(maximum.buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  test('preserves transparency in WebP output', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample-alpha.png');
    await page.locator('[data-format]').selectOption('image/webp');
    await compressAll(page, 1);
    const result = await downloadFirst(page);
    expect(result.name).toBe('sample-alpha-compressed.webp');
    expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const decoded = await decodePixels(page, result.buffer, 'image/webp', [[2, 2], [32, 32]]);
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
    expect(decoded.pixels[0][3]).toBe(0);
    expect(decoded.pixels[1][0]).toBeGreaterThan(200);
    expect(decoded.pixels[1][3]).toBe(255);
  });

  test('reports a larger output honestly instead of claiming a saving', async ({ page }) => {
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.locator('[data-file-meta]')).toContainText('1 × 1 px');
    await page.locator('[data-format]').selectOption('image/png');
    await compressAll(page, 1);

    await expect(page.locator('[data-status]')).toHaveText('Output is larger than the original');
    await expect(page.locator('[data-status]')).toHaveAttribute('data-tone', 'warn');
    await expect(page.locator('[data-stat="percent"]')).toHaveClass(/is-negative/);
    await expect(page.locator('[data-stat="saved"]')).toContainText('-');
    await expect(page.locator('[data-stat="advice"]')).toContainText('larger than the original');
    await expect(page.locator('[data-download]')).toBeVisible();
  });

  test('uses a custom quality setting', async ({ page }) => {
    await openTool(page);
    await addFile(page, 'sample.jpg');
    await page.locator('.cmp-preset', { hasText: 'Custom quality' }).click();
    await expect(page.locator('[data-custom]')).toBeVisible();
    await page.locator('[data-quality]').evaluate((input) => {
      input.value = '20';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('[data-quality-output]')).toHaveText('20%');
    await compressAll(page, 1);
    const result = await downloadFirst(page);
    expect(result.buffer.length).toBeLessThan(3000);
    await expect(page.locator('[data-stat="compressed"]')).toHaveText(formatBytes(result.buffer.length));
  });

  test('compresses a batch, downloads a valid ZIP and isolates bad files', async ({ page }) => {
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles([fixture('sample.jpg'), fixture('sample.png')]);
    await expect(page.locator('[data-file-row]')).toHaveCount(2);
    await compressAll(page, 2);
    await expect(page.locator('[data-summary-count]')).toHaveText('2');

    const pending = page.waitForEvent('download');
    await page.locator('[data-download-all]').click();
    const download = await pending;
    const zip = fs.readFileSync(await download.path());
    expect(download.suggestedFilename()).toBe('letitedit-compressed-images.zip');
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.includes(Buffer.from('sample-compressed.jpg'))).toBe(true);
    expect(zip.includes(Buffer.from('sample-compressed.png'))).toBe(true);
    const endOffset = zip.length - 22;
    expect(zip.readUInt32LE(endOffset)).toBe(0x06054b50);
    expect(zip.readUInt16LE(endOffset + 10)).toBe(2);

    await page.locator('[data-file-input]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await expect(page.locator('[data-file-row]')).toHaveCount(3);
    await expect(page.locator('[data-file-error]')).toContainText('Unsupported file type');
    await expect(page.locator('[data-download-all]')).toBeEnabled();
  });

  test('rejects oversized files with a clear message', async ({ page }) => {
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(26 * 1024 * 1024)
    });
    await expect(page.locator('[data-file-row]')).toHaveCount(1);
    await expect(page.locator('[data-file-error]')).toContainText('The limit is 25 MB per image');
    await expect(page.locator('[data-compress]')).toBeDisabled();
  });

  test('removes images, resets the workspace and restores defaults', async ({ page }) => {
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles([fixture('sample.jpg'), fixture('sample.png')]);
    await expect(page.locator('[data-file-row]')).toHaveCount(2);
    await page.locator('[data-remove]').first().click();
    await expect(page.locator('[data-file-row]')).toHaveCount(1);
    await page.locator('[data-reset]').click();
    await expect(page.locator('[data-file-row]')).toHaveCount(0);
    await expect(page.locator('[data-results]')).toBeHidden();
    await expect(page.locator('input[name="cmp-preset"]:checked')).toHaveValue('balanced');
    await expect(page.locator('[data-format]')).toHaveValue('original');
    await expect(page.locator('[data-compress]')).toBeDisabled();
  });

  test('fits mobile, tablet and desktop widths without horizontal overflow', async ({ page }) => {
    await openTool(page);
    for (const width of [320, 360, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
      const browse = await page.locator('[data-browse]').boundingBox();
      expect(browse).not.toBeNull();
      expect(browse.x).toBeGreaterThanOrEqual(0);
      expect(browse.x + browse.width).toBeLessThanOrEqual(width + 0.5);
      await expect(page.locator('[data-format]')).toBeVisible();
    }
  });

  test('accepts a drag-and-dropped image', async ({ page }) => {
    await openTool(page);
    const transfer = await page.evaluateHandle(async () => {
      const response = await fetch('/tests/fixtures/sample.png');
      const blob = await response.blob();
      const file = new File([blob], 'dropped.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      return data;
    });
    await page.dispatchEvent('[data-dropzone]', 'drop', { dataTransfer: transfer });
    await expect(page.locator('[data-file-row]')).toHaveCount(1);
    await expect(page.locator('[data-file-name]')).toContainText('dropped.png');
    await expect(page.locator('[data-file-meta]')).toContainText('320 × 200 px');
    await expect(page.locator('[data-dropzone]')).not.toHaveClass(/is-dragover/);
  });

  test('keeps compressing the batch when one file fails', async ({ page }) => {
    await openTool(page);
    await page.locator('[data-file-input]').setInputFiles([
      { name: 'sample.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(fixture('sample.jpg')) },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') }
    ]);
    await expect(page.locator('[data-file-row]')).toHaveCount(2);
    await expect(page.locator('[data-file-error]')).toContainText('Unsupported file type');

    await compressAll(page, 2);
    const statuses = await page.locator('[data-status]').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
    expect(statuses).toContain('Compressed');
    expect(statuses).toContain('Could not process');
    await expect(page.locator('[data-download]')).toHaveCount(1);
    await expect(page.locator('[data-summary-count]')).toHaveText('1');
  });

  test('does not overflow at 320px with results and a very long filename', async ({ page }) => {
    await openTool(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.locator('[data-file-input]').setInputFiles({
      name: 'this-is-an-extremely-long-file-name-that-should-wrap-and-never-overflow-the-narrow-layout-2026.jpg',
      mimeType: 'image/jpeg',
      buffer: fs.readFileSync(fixture('sample.jpg'))
    });
    await expect(page.locator('[data-file-row]')).toHaveCount(1);
    await compressAll(page, 1);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    const download = await page.locator('[data-download]').boundingBox();
    expect(download).not.toBeNull();
    expect(download.x).toBeGreaterThanOrEqual(0);
    expect(download.x + download.width).toBeLessThanOrEqual(320.5);
  });

  test('mobile menu opens and closes with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTool(page);
    const menu = page.locator('.menu-button');
    await expect(menu).toBeVisible();
    await expect(page.locator('#primary-links')).toBeHidden();
    await menu.click();
    await expect(page.locator('#primary-links')).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#primary-links')).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  test('runs a full flow without console errors or failed requests', async ({ page }) => {
    const problems = [];
    page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
    page.on('console', (message) => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
    page.on('requestfailed', (request) => problems.push('requestfailed: ' + request.url()));

    await openTool(page);
    await addFile(page, 'sample.jpg');
    await compressAll(page, 1);
    await downloadFirst(page);
    expect(problems).toEqual([]);
  });

  test('publishes valid structured data and the explanatory content', async ({ page }) => {
    await openTool(page);
    const graph = await page.locator('script[type="application/ld+json"]').first().evaluate((script) => JSON.parse(script.textContent)['@graph']);
    const types = graph.map((item) => item['@type']);
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('SoftwareApplication');
    expect(types).toContain('FAQPage');
    const faq = graph.find((item) => item['@type'] === 'FAQPage');
    expect(faq.mainEntity.length).toBe(7);
    await expect(page.locator('.cmp-article h2')).toHaveCount(8);
    await expect(page.locator('.faq-item')).toHaveCount(7);
    await expect(page.locator('.cmp-article')).toContainText('Lossy versus lossless compression');
    await expect(page.locator('.cmp-article')).toContainText('Privacy and local processing');
  });

  test('links to the compressor from the category page and the homepage', async ({ page }) => {
    await page.goto('/categories/image-photo-editing/');
    await expect(page.locator('a[href="/media-and-motion/image-size-compressor/"]')).toHaveCount(1);
    await page.goto('/');
    await expect(page.locator('a[href="/media-and-motion/image-size-compressor/"]')).toHaveCount(1);
    await expect(page.locator('section.section-soft .section-head h2')).toHaveText('Two real tools are live');
  });
});
