const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.describe('Image & Photo Editor', () => {
  const fixture = name => path.join(__dirname, '..', 'fixtures', name);
  const toolPath = '/media-and-motion/image-photo-editor/';

  async function openFixture(page, name) {
    await page.goto(toolPath);
    await page.locator('[data-file-input]').setInputFiles(fixture(name));
    await expect(page.locator('[data-status-left]')).toContainText('×');
  }

  async function canvasChecksum(page) {
    return page.evaluate(() => {
      const canvas = document.querySelector('[data-canvas]');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 101) sum = (sum * 31 + data[i]) >>> 0;
      return sum;
    });
  }

  test('renders the editor shell with one heading and real controls', async ({ page }) => {
    await page.goto(toolPath);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Image & Photo Editor');
    await expect(page.locator('[data-editor]')).toBeVisible();
    await expect(page.locator('[data-canvas]')).toBeVisible();
    await expect(page.locator('.editor-rail [data-tool]')).toHaveCount(12);
    await expect(page.locator('[data-panel-title]')).toHaveText('Import');
    await expect(page.getByRole('link', { name: 'Image & Photo Editing' }).first()).toBeVisible();
    const structured = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(structured).toContain('SoftwareApplication');
    expect(structured).toContain('FAQPage');
  });

  test('opens the file chooser from the Import button and processes the selection', async ({ page }) => {
    await page.goto(toolPath);
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('.editor-topbar [data-action="browse"]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture('sample.png'));
    await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
    await expect(page.locator('[data-status-left]')).toContainText('PNG');
    await expect(page.locator('[data-file-name]')).toContainText('sample.png');
    await expect(page.locator('[data-toast]')).toContainText('Opened sample.png');
  });

  test('imports a PNG locally and reports its real dimensions', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
    await expect(page.locator('[data-status-left]')).toContainText('PNG');
    await expect(page.locator('[data-file-name]')).toContainText('sample.png');
    await expect(page.locator('[data-panel-title]')).toHaveText('Adjust');
    await expect(page.locator('[data-adjust="brightness"]')).toBeVisible();
  });

  test('accepts a drag-and-drop image', async ({ page }) => {
    await page.goto(toolPath);
    const dataTransfer = await page.evaluateHandle(async () => {
      const response = await fetch('/tests/fixtures/sample.png');
      const blob = await response.blob();
      const file = new File([blob], 'dropped.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      return transfer;
    });
    await page.dispatchEvent('[data-editor]', 'drop', { dataTransfer });
    await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
    await expect(page.locator('[data-status-left]')).toContainText('PNG');
    await expect(page.locator('[data-file-name]')).toContainText('dropped.png');
  });

  test('imports PNG, JPG, WebP, GIF, BMP, SVG and TIFF with real dimensions', async ({ page }) => {
    const cases = [
      ['sample.png', '320 × 200', 'PNG'],
      ['sample.jpg', '320 × 200', 'JPG'],
      ['sample.webp', '40 × 20', 'WebP'],
      ['sample.gif', '8 × 8', 'GIF'],
      ['sample.bmp', '160 × 100', 'BMP'],
      ['sample.svg', '480 × 320', 'SVG'],
      ['sample.tiff', '320 × 200', 'TIFF']
    ];
    await page.goto(toolPath);
    for (const [name, size, type] of cases) {
      await page.locator('[data-file-input]').setInputFiles(fixture(name));
      await expect(page.locator('[data-status-left]')).toContainText(size);
      await expect(page.locator('[data-status-left]')).toContainText(type);
      await expect(page.locator('[data-file-name]')).toContainText(name);
    }
  });

  test('adjusts brightness, undoes it and redoes it', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="adjust"]').click();
    await expect(page.locator('[data-panel-title]')).toHaveText('Adjust');
    const brightness = page.locator('[data-adjust="brightness"]');
    await brightness.evaluate(el => {
      el.value = '35';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('[data-adjust="brightness"]')).toHaveValue('35');
    await page.waitForTimeout(250);
    await page.locator('[data-action="undo"]').click();
    await expect(page.locator('[data-adjust="brightness"]')).toHaveValue('0');
    await page.locator('[data-action="redo"]').click();
    await expect(page.locator('[data-adjust="brightness"]')).toHaveValue('35');
  });

  test('starts the pixel worker and repaints the preview after an adjustment', async ({ page }) => {
    const workerUrls = [];
    page.on('worker', worker => workerUrls.push(worker.url()));
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="adjust"]').click();
    const before = await canvasChecksum(page);
    await page.locator('[data-adjust="brightness"]').evaluate(el => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => canvasChecksum(page), { timeout: 15000 }).not.toBe(before);
    expect(workerUrls.some(url => url.includes('/js/editor-worker.js'))).toBe(true);
  });

  test('crop ratios stay square and rotation swaps the working size', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="crop"]').click();
    await page.locator('[data-aspect="1"]').click();
    const read = async () => page.evaluate(() => {
      const fields = {};
      document.querySelectorAll('[data-crop-field]').forEach(input => { fields[input.getAttribute('data-crop-field')] = Number(input.value); });
      return fields;
    });
    let crop = await read();
    expect(crop.w).toBe(crop.h);
    await page.locator('[data-action="rotate-right"]').click();
    await page.waitForTimeout(200);
    crop = await read();
    expect(crop.w).toBe(200);
    expect(crop.h).toBe(320);
    await expect(page.locator('[data-status-right]')).toContainText('Crop');
  });

  test('adds a text layer and lists it in the layers panel', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="text"]').click();
    await page.locator('[data-action="add-text"]').click();
    await expect(page.locator('[data-text-content]')).toBeVisible();
    await page.locator('[data-text-content]').fill('Hello LetitEdit');
    await page.locator('[data-text-content]').blur();
    await page.locator('.editor-rail [data-tool="layers"]').click();
    await expect(page.locator('[data-layer-row]')).toHaveCount(1);
    const nameInput = page.locator('[data-rename-layer]');
    await nameInput.fill('Headline');
    await nameInput.blur();
    await expect(page.locator('[data-rename-layer]')).toHaveValue('Headline');
    await page.locator('[data-layer-action="duplicate"]').click();
    await expect(page.locator('[data-layer-row]')).toHaveCount(2);
    await page.locator('[data-layer-action="delete"]').first().click();
    await expect(page.locator('[data-layer-row]')).toHaveCount(1);
  });

  test('imports a TIFF with the bundled decoder', async ({ page }) => {
    await openFixture(page, 'sample.tiff');
    await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
    await expect(page.locator('[data-status-left]')).toContainText('TIFF');
  });

  test('imports WebP and the first frame of a GIF', async ({ page }) => {
    await openFixture(page, 'sample.webp');
    await expect(page.locator('[data-status-left]')).toContainText('40 × 20');
    await expect(page.locator('[data-status-left]')).toContainText('WebP');
    await page.locator('[data-file-input]').setInputFiles(fixture('sample.gif'));
    await expect(page.locator('[data-status-left]')).toContainText('8 × 8');
    await expect(page.locator('[data-status-left]')).toContainText('GIF');
  });

  test('applies EXIF orientation when a JPEG is imported', async ({ page }) => {
    await openFixture(page, 'sample-exif6.jpg');
    await expect(page.locator('[data-status-left]')).toContainText('200 × 320');
    await expect(page.locator('[data-status-left]')).toContainText('JPG');
  });

  test('keeps transparent frame padding in PNG and fills it white in JPEG', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="frame"]').click();
    await page.locator('[data-frame-padding]').evaluate(el => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('[data-frame-background]').selectOption('transparent');
    await page.waitForTimeout(300);
    await page.locator('.editor-topbar [data-action="export"]').click();

    const sampleCorner = async (type, name) => {
      await page.locator('[data-export-format]').selectOption(type);
      await page.locator('[data-export-filename]').fill(name);
      const pending = page.waitForEvent('download');
      await page.locator('[data-action="download"]').click();
      const download = await pending;
      const buffer = fs.readFileSync(await download.path());
      return page.evaluate(async ({ base64, mime }) => {
        const image = new Image();
        image.src = 'data:' + mime + ';base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(2, 2, 1, 1).data);
      }, { base64: buffer.toString('base64'), mime: type });
    };

    const png = await sampleCorner('image/png', 'transparent-padding');
    expect(png[3]).toBe(0);
    const jpg = await sampleCorner('image/jpeg', 'white-padding');
    expect(jpg.slice(0, 3)).toEqual([255, 255, 255]);
  });

  test('imports and sanitises SVG without running scripts', async ({ page }) => {
    await page.goto(toolPath);
    await page.locator('[data-file-input]').setInputFiles(fixture('sample-unsafe.svg'));
    await expect(page.locator('[data-status-left]')).toContainText('200 × 120');
    await expect(page.locator('[data-status-left]')).toContainText('SVG');
    const xss = await page.evaluate(() => (window.__svgXss === undefined ? null : window.__svgXss));
    expect(xss).toBeNull();
    await expect(page.locator('[data-toast]')).toContainText('Opened sample-unsafe.svg');
  });

  test('arrow keys nudge the active layer and update the numeric fields', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="text"]').click();
    await page.locator('[data-action="add-text"]').click();
    await page.locator('.editor-rail [data-tool="layers"]').click();
    const xInput = page.locator('[data-layer-field="x"]');
    const before = Number(await xInput.inputValue());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(xInput).toHaveValue(String(before + 12));
  });

  test('applies a filter preset and a frame without losing the image', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="filters"]').click();
    await page.locator('[data-filter="grayscale"]').click();
    await expect(page.locator('[data-filter="grayscale"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(250);
    await page.locator('.editor-rail [data-tool="frame"]').click();
    await page.locator('[data-frame-padding]').evaluate(el => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const size = await page.locator('[data-status-right]').textContent();
    expect(size).toContain('400 × 280');
  });

  test('resizes to a preset and reports the new dimensions', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="resize"]').click();
    await page.locator('[data-resize-preset="1080x1080"]').click();
    await expect(page.locator('[data-resize-field="width"]')).toHaveValue('1080');
    await expect(page.locator('[data-resize-field="height"]')).toHaveValue('1080');
    await expect(page.locator('[data-status-right]')).toContainText('1080 × 1080');
  });

  test('estimates and downloads a real PNG export', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="export"]').click();
    await expect(page.locator('[data-panel-title]')).toHaveText('Export');
    await page.locator('[data-export-format]').selectOption('image/png');
    await page.locator('[data-export-filename]').fill('letitedit-test');
    await page.locator('[data-action="estimate"]').click();
    await expect(page.locator('[data-export-result]')).toContainText('Last encoded size');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('letitedit-test.png');
    const file = await download.path();
    const stat = fs.statSync(file);
    expect(stat.size).toBeGreaterThan(1000);
  });

  test('exports JPEG at a chosen quality and reports the encoded size', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await page.locator('.editor-rail [data-tool="export"]').click();
    await page.locator('[data-export-format]').selectOption('image/jpeg');
    await page.locator('[data-export-quality]').fill('70');
    await page.locator('[data-export-quality]').blur();
    await page.locator('[data-action="estimate"]').click();
    await expect(page.locator('[data-export-result]')).toContainText('Format');
    await expect(page.locator('[data-export-result]')).toContainText('JPG');
    await expect(page.locator('[data-export-result]')).toContainText('Quality');
  });

  test('mobile layout uses the bottom bar and a bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(toolPath);
    await expect(page.locator('.editor-mobilebar')).toBeVisible();
    await expect(page.locator('.editor-rail')).toBeHidden();
    await page.locator('[data-file-input]').setInputFiles(fixture('sample.bmp'));
    await expect(page.locator('[data-status-left]')).toContainText('BMP');
    await page.locator('.editor-mobilebar [data-tool="adjust"]').click();
    await expect(page.locator('[data-panel]')).toHaveClass(/is-open/);
    await expect(page.locator('[data-sheet-backdrop]')).toBeVisible();
    await expect(page.locator('[data-adjust="brightness"]')).toBeVisible();
    await page.locator('[data-panel-close]').click();
    await expect(page.locator('[data-panel]')).not.toHaveClass(/is-open/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const canvasBox = await page.locator('[data-canvas]').boundingBox();
    expect(canvasBox.width).toBeGreaterThan(300);
  });

  test('mobile sheet closes with Escape and export opens from the bottom bar', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(toolPath);
    await page.locator('[data-file-input]').setInputFiles(fixture('sample.png'));
    await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
    await page.locator('.editor-mobilebar [data-tool="filters"]').click();
    await expect(page.locator('[data-panel]')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel]')).not.toHaveClass(/is-open/);
    await page.locator('.editor-mobilebar [data-action="export"]').click();
    await expect(page.locator('[data-panel-title]')).toHaveText('Export');
    await expect(page.locator('[data-export-format]')).toBeVisible();
  });

  test('works without horizontal overflow at 320, 390 and 768 px', async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(toolPath);
      await expect(page.locator('.editor-mobilebar')).toBeVisible();
      await expect(page.locator('.editor-rail')).toBeHidden();
      await page.locator('[data-file-input]').setInputFiles(fixture('sample.png'));
      await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth
      }));
      expect(overflow.doc).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
      await page.locator('.editor-mobilebar [data-tool="filters"]').click();
      await expect(page.locator('[data-panel]')).toHaveClass(/is-open/);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-panel]')).not.toHaveClass(/is-open/);
    }
  });

  test('loads every editor asset, decoder and script exactly once', async ({ page }) => {
    const failures = [];
    const consoleErrors = [];
    const pageErrors = [];
    const decoderRequests = [];
    page.on('response', response => {
      const url = response.url();
      if (response.status() >= 400 && url.startsWith('http://127.0.0.1:4173/')) failures.push(response.status() + ' ' + url);
      if (/\/vendor\/(UTIF|pako|heic2any)/.test(url)) decoderRequests.push(url);
    });
    page.on('requestfailed', request => {
      if (request.url().startsWith('http://127.0.0.1:4173/')) failures.push('failed ' + request.url());
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (/googletagmanager|google-analytics|doubleclick/i.test(message.text())) return;
      consoleErrors.push(message.text());
    });

    await page.goto(toolPath);
    await page.locator('[data-file-input]').setInputFiles(fixture('sample.tiff'));
    await expect(page.locator('[data-status-left]')).toContainText('TIFF');
    await expect.poll(() => decoderRequests.length, { timeout: 10000 }).toBeGreaterThan(0);

    const scripts = await page.evaluate(() => {
      const counts = {};
      document.querySelectorAll('script[src]').forEach(script => {
        const src = script.getAttribute('src');
        counts[src] = (counts[src] || 0) + 1;
      });
      return {
        duplicates: Object.entries(counts).filter(([, count]) => count > 1),
        editor: document.querySelectorAll('script[src$="js/editor.js"]').length,
        workerLoader: document.querySelectorAll('script[src$="js/editor-worker.js"]').length,
        processing: document.querySelectorAll('script[src$="js/image-processing.js"]').length,
        site: document.querySelectorAll('script[src$="js/site.js"]').length,
        search: document.querySelectorAll('script[src$="js/search-index.js"]').length
      };
    });

    expect(failures).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(scripts.duplicates).toEqual([]);
    expect(scripts.editor).toBe(1);
    expect(scripts.workerLoader).toBe(0);
    expect(scripts.processing).toBe(1);
    expect(scripts.site).toBe(1);
    expect(scripts.search).toBe(1);
  });

  test('keeps exactly one GTM container and one gtag bootstrap', async ({ page }) => {
    await page.goto(toolPath);
    const analytics = await page.evaluate(() => ({
      gtmContainers: document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]').length,
      gtagBootstrap: (document.documentElement.innerHTML.match(/gtag\('js', new Date\(\)\)/g) || []).length,
      dataLayerIsArray: Array.isArray(window.dataLayer)
    }));
    expect(analytics.gtmContainers).toBe(1);
    expect(analytics.gtagBootstrap).toBe(1);
    expect(analytics.dataLayerIsArray).toBe(true);
  });
});
