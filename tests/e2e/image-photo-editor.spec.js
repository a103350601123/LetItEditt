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

  async function openTool(page, tool) {
    const mobile = await page.locator('.editor-mobilebar').isVisible();
    await page.locator(`${mobile ? '.editor-mobilebar' : '.editor-rail'} [data-tool="${tool}"]`).click();
    await page.waitForTimeout(200);
  }

  async function closeSettings(page) {
    const mobile = await page.locator('.editor-mobilebar').isVisible();
    await page.locator('[data-panel-close]').click();
    if (mobile) {
      await expect(page.locator('[data-panel]')).not.toHaveClass(/is-open/);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.waitForTimeout(200);
  }

  async function readLayerFields(page) {
    return page.evaluate(() => {
      const fields = {};
      document.querySelectorAll('[data-layer-field]').forEach(input => {
        fields[input.getAttribute('data-layer-field')] = Number(input.value);
      });
      const rotation = document.querySelector('input[data-layer-prop="rotation"]');
      fields.rotation = rotation ? Number(rotation.value) : 0;
      return fields;
    });
  }

  async function readLayerRows(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('[data-layer-row]')).map(row => ({
      id: row.getAttribute('data-layer-row'),
      active: row.classList.contains('is-active')
    })));
  }

  async function layerFieldsSheet(page) {
    await openTool(page, 'layers');
    const fields = await readLayerFields(page);
    await closeSettings(page);
    return fields;
  }

  async function layerFieldsAndRowsSheet(page) {
    await openTool(page, 'layers');
    const fields = await readLayerFields(page);
    const rows = await readLayerRows(page);
    await closeSettings(page);
    return { fields, rows };
  }

  async function layerRowsSheet(page) {
    await openTool(page, 'layers');
    const rows = await readLayerRows(page);
    await closeSettings(page);
    return rows;
  }

  async function canvasMetrics(page) {
    return page.evaluate(() => {
      const canvas = document.querySelector('[data-canvas]');
      const rect = canvas.getBoundingClientRect();
      const text = document.querySelector('[data-status-right]').textContent;
      const size = text.match(/(\d+)\s*×\s*(\d+)/);
      const zoom = text.match(/(\d+)%/);
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        outW: Number(size[1]),
        outH: Number(size[2]),
        scale: Number(zoom[1]) / 100
      };
    });
  }

  function layerCenter(metrics, layer) {
    return {
      x: metrics.rect.x + metrics.rect.width / 2 + (layer.x + layer.w / 2 - metrics.outW / 2) * metrics.scale,
      y: metrics.rect.y + metrics.rect.height / 2 + (layer.y + layer.h / 2 - metrics.outH / 2) * metrics.scale
    };
  }

  function rotateHandlePoint(metrics, layer, mobile) {
    const center = layerCenter(metrics, layer);
    return {
      x: center.x,
      y: center.y - layer.h * metrics.scale / 2 - (mobile ? 32 : 26)
    };
  }

  async function mouseDrag(page, from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }

  async function exportPngStats(page, name, region) {
    await openTool(page, 'export');
    await expect(page.locator('[data-export-format]')).toBeVisible();
    await page.locator('[data-export-format]').selectOption('image/png');
    await page.locator('[data-export-filename]').fill(name);
    const pending = page.waitForEvent('download');
    await page.locator('[data-action="download"]').click();
    const download = await pending;
    const buffer = fs.readFileSync(await download.path());
    return page.evaluate(async ({ base64, region }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let checksum = 0;
      for (let i = 0; i < data.length; i += 101) checksum = (checksum * 31 + data[i]) >>> 0;
      let white = 0;
      if (region) {
        const x0 = Math.max(0, Math.round(region.x - region.radius));
        const y0 = Math.max(0, Math.round(region.y - region.radius));
        const x1 = Math.min(canvas.width, Math.round(region.x + region.radius));
        const y1 = Math.min(canvas.height, Math.round(region.y + region.radius));
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * canvas.width + x) * 4;
            if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white += 1;
          }
        }
      }
      return { checksum, white, width: canvas.width, height: canvas.height };
    }, { base64: buffer.toString('base64'), region });
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

  test('selects a text layer on the canvas, outlines it and moves it with the mouse', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await openTool(page, 'text');
    await page.locator('[data-action="add-text"]').click();
    await openTool(page, 'layers');
    await expect(page.locator('[data-layer-field="x"]')).toBeVisible();

    const fields = await readLayerFields(page);
    const metrics = await canvasMetrics(page);
    const center = layerCenter(metrics, fields);
    const blank = { x: metrics.rect.x + 18, y: metrics.rect.y + metrics.rect.height - 18 };

    await page.mouse.click(blank.x, blank.y);
    await page.waitForTimeout(200);
    const unselected = await canvasChecksum(page);
    expect((await readLayerRows(page)).map(row => row.active)).toEqual([false]);

    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(200);
    expect((await readLayerRows(page)).map(row => row.active)).toEqual([true]);
    const selected = await canvasChecksum(page);
    expect(selected).not.toBe(unselected);

    await mouseDrag(page, center, { x: center.x + 60, y: center.y + 30 });
    const moved = await readLayerFields(page);
    expect(moved.x - fields.x).toBeGreaterThan(15);
    expect(moved.y - fields.y).toBeGreaterThan(8);
    expect(moved.w).toBe(fields.w);
    expect(moved.h).toBe(fields.h);
  });

  test('resizes with corner and edge handles and rotates from the rotation handle', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await openTool(page, 'text');
    await page.locator('[data-action="add-text"]').click();
    await openTool(page, 'layers');

    let fields = await readLayerFields(page);
    let metrics = await canvasMetrics(page);
    let center = layerCenter(metrics, fields);
    let corner = {
      x: center.x + fields.w * metrics.scale / 2,
      y: center.y + fields.h * metrics.scale / 2
    };

    await mouseDrag(page, corner, { x: corner.x + 40, y: corner.y + 30 });
    let after = await readLayerFields(page);
    expect(after.w).toBeGreaterThan(fields.w);
    expect(after.h).toBeGreaterThan(fields.h);

    fields = after;
    metrics = await canvasMetrics(page);
    center = layerCenter(metrics, fields);
    const edge = { x: center.x + fields.w * metrics.scale / 2, y: center.y };
    await mouseDrag(page, edge, { x: edge.x + 32, y: edge.y });
    after = await readLayerFields(page);
    expect(after.w).toBeGreaterThan(fields.w);
    expect(after.h).toBe(fields.h);

    fields = after;
    metrics = await canvasMetrics(page);
    center = layerCenter(metrics, fields);
    const rotate = rotateHandlePoint(metrics, fields, false);
    await mouseDrag(page, rotate, {
      x: center.x + fields.h * metrics.scale / 2 + 26,
      y: center.y
    });
    after = await readLayerFields(page);
    expect(Math.abs(after.rotation)).toBeGreaterThan(45);
  });

  test('undoes and redoes a mouse drag of a layer', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await openTool(page, 'text');
    await page.locator('[data-action="add-text"]').click();
    await openTool(page, 'layers');

    const fields = await readLayerFields(page);
    const metrics = await canvasMetrics(page);
    const center = layerCenter(metrics, fields);
    await mouseDrag(page, center, { x: center.x + 50, y: center.y + 25 });
    const moved = await readLayerFields(page);
    expect(moved.x).not.toBe(fields.x);

    await page.locator('[data-action="undo"]').click();
    await page.waitForTimeout(300);
    const undone = await readLayerFields(page);
    expect(undone.x).toBe(fields.x);
    expect(undone.y).toBe(fields.y);

    await page.locator('[data-action="redo"]').click();
    await page.waitForTimeout(300);
    const redone = await readLayerFields(page);
    expect(redone.x).toBe(moved.x);
    expect(redone.y).toBe(moved.y);
  });

  test('applies layer geometry and rotation to the exported PNG', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await openTool(page, 'text');
    await page.locator('[data-action="add-text"]').click();

    const baseline = await exportPngStats(page, 'baseline');
    expect(baseline.width).toBe(320);
    expect(baseline.height).toBe(200);

    await openTool(page, 'layers');
    let fields = await readLayerFields(page);
    let metrics = await canvasMetrics(page);
    let center = layerCenter(metrics, fields);
    await mouseDrag(page, center, { x: center.x + 80, y: center.y + 60 });

    fields = await readLayerFields(page);
    metrics = await canvasMetrics(page);
    center = layerCenter(metrics, fields);
    const corner = {
      x: center.x + fields.w * metrics.scale / 2,
      y: center.y + fields.h * metrics.scale / 2
    };
    await mouseDrag(page, corner, { x: corner.x + 30, y: corner.y + 25 });

    fields = await readLayerFields(page);
    metrics = await canvasMetrics(page);
    center = layerCenter(metrics, fields);
    const rotate = rotateHandlePoint(metrics, fields, false);
    await mouseDrag(page, rotate, {
      x: center.x + fields.h * metrics.scale / 2 + 26,
      y: center.y
    });

    fields = await readLayerFields(page);
    expect(Math.abs(fields.rotation)).toBeGreaterThan(45);
    const region = { x: fields.x + fields.w / 2, y: fields.y + fields.h / 2, radius: 70 };
    const transformed = await exportPngStats(page, 'transformed', region);
    expect(transformed.width).toBe(320);
    expect(transformed.height).toBe(200);
    expect(transformed.checksum).not.toBe(baseline.checksum);
    expect(transformed.white).toBeGreaterThan(0);
  });

  test.describe('direct manipulation on touch devices', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    async function touchDrag(page, from, to, steps = 10) {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
        for (let i = 1; i <= steps; i += 1) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{
              x: from.x + (to.x - from.x) * i / steps,
              y: from.y + (to.y - from.y) * i / steps
            }]
          });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await cdp.detach();
      }
    }

    test('scrolls the page from the stage margin and holds still while dragging a layer', async ({ page }) => {
      await openFixture(page, 'sample.png');
      const metrics = await canvasMetrics(page);
      const imageTop = metrics.rect.y + (metrics.rect.height - metrics.outH * metrics.scale) / 2;
      const margin = { x: metrics.rect.x + metrics.rect.width / 2, y: imageTop - 50 };
      expect(margin.y).toBeGreaterThan(metrics.rect.y + 10);

      await touchDrag(page, margin, { x: margin.x, y: Math.max(10, margin.y - 260) }, 12);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      await page.locator('.editor-mobilebar [data-tool="text"]').click();
      await page.locator('[data-action="add-text"]').click();
      await closeSettings(page);

      const fields = await layerFieldsSheet(page);
      const afterClose = await canvasMetrics(page);
      const center = layerCenter(afterClose, fields);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      await touchDrag(page, center, { x: center.x + 40, y: center.y - 30 }, 10);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      const moved = await layerFieldsSheet(page);
      expect(moved.x).toBeGreaterThan(fields.x + 10);
      expect(moved.y).toBeLessThan(fields.y - 5);
    });

    test('selects, drags, resizes and rotates a layer with touch', async ({ page }) => {
      await openFixture(page, 'sample.png');
      await page.locator('.editor-mobilebar [data-tool="text"]').click();
      await page.locator('[data-action="add-text"]').click();
      await closeSettings(page);

      let fields = await layerFieldsSheet(page);
      let metrics = await canvasMetrics(page);
      let center = layerCenter(metrics, fields);
      await page.touchscreen.tap(center.x, center.y);
      await page.waitForTimeout(150);

      await touchDrag(page, center, { x: center.x - 30, y: center.y - 24 }, 10);
      await page.waitForTimeout(300);
      fields = await layerFieldsSheet(page);
      expect(fields.x).toBeLessThan(160 - 10);

      metrics = await canvasMetrics(page);
      center = layerCenter(metrics, fields);
      const cornerBefore = fields;
      const corner = {
        x: center.x + fields.w * metrics.scale / 2,
        y: center.y - fields.h * metrics.scale / 2
      };
      await touchDrag(page, corner, { x: corner.x + 20, y: corner.y - 14 }, 10);
      fields = await layerFieldsSheet(page);
      expect(fields.w).toBeGreaterThan(cornerBefore.w);
      expect(fields.h).toBeGreaterThan(cornerBefore.h);

      metrics = await canvasMetrics(page);
      center = layerCenter(metrics, fields);
      const edgeBefore = fields;
      const edge = { x: center.x + fields.w * metrics.scale / 2, y: center.y };
      await touchDrag(page, edge, { x: edge.x + 12, y: edge.y }, 10);
      fields = await layerFieldsSheet(page);
      expect(fields.w).toBeGreaterThan(edgeBefore.w);
      expect(fields.h).toBe(edgeBefore.h);

      metrics = await canvasMetrics(page);
      center = layerCenter(metrics, fields);
      const rotate = rotateHandlePoint(metrics, fields, true);
      await touchDrag(page, rotate, {
        x: center.x + fields.h * metrics.scale / 2 + 32,
        y: center.y
      }, 12);
      fields = await layerFieldsSheet(page);
      expect(Math.abs(fields.rotation)).toBeGreaterThan(45);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('selects between two stacked text layers without reordering them', async ({ page }) => {
      await openFixture(page, 'sample.png');

      await page.locator('.editor-mobilebar [data-tool="text"]').click();
      await page.locator('[data-action="add-text"]').click();
      await closeSettings(page);

      let first = await layerFieldsAndRowsSheet(page);
      let metrics = await canvasMetrics(page);
      let firstCenter = layerCenter(metrics, first.fields);
      await touchDrag(page, firstCenter, { x: firstCenter.x - 100, y: firstCenter.y + 55 }, 12);
      await page.waitForTimeout(300);
      first = await layerFieldsAndRowsSheet(page);
      const firstId = first.rows.find(row => row.active).id;

      await page.locator('.editor-mobilebar [data-tool="text"]').click();
      await page.locator('[data-action="add-text"]').click();
      await closeSettings(page);

      let second = await layerFieldsAndRowsSheet(page);
      const secondId = second.rows.find(row => row.active).id;
      expect(secondId).not.toBe(firstId);
      metrics = await canvasMetrics(page);
      let secondCenter = layerCenter(metrics, second.fields);
      await touchDrag(page, secondCenter, { x: secondCenter.x + 80, y: secondCenter.y }, 12);
      await page.waitForTimeout(300);
      second = await layerFieldsAndRowsSheet(page);
      const order = second.rows.map(row => row.id);

      metrics = await canvasMetrics(page);
      firstCenter = layerCenter(metrics, first.fields);
      await page.touchscreen.tap(firstCenter.x, firstCenter.y);
      let rows = await layerRowsSheet(page);
      expect(rows.find(row => row.active).id).toBe(firstId);
      expect(rows.map(row => row.id)).toEqual(order);

      metrics = await canvasMetrics(page);
      secondCenter = layerCenter(metrics, second.fields);
      await page.touchscreen.tap(secondCenter.x, secondCenter.y);
      rows = await layerRowsSheet(page);
      expect(rows.find(row => row.active).id).toBe(secondId);
      expect(rows.map(row => row.id)).toEqual(order);
    });

    test('manipulates layers with touch at 320, 390 and 768 px without overflow', async ({ page }) => {
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(toolPath);
        await page.locator('[data-file-input]').setInputFiles(fixture('sample.png'));
        await expect(page.locator('[data-status-left]')).toContainText('320 × 200');

        await page.locator('.editor-mobilebar [data-tool="text"]').click();
        await page.locator('[data-action="add-text"]').click();
        await closeSettings(page);

        const fields = await layerFieldsSheet(page);
        let metrics = await canvasMetrics(page);
        let center = layerCenter(metrics, fields);
        if (center.y > 800 || center.y < 70) {
          await page.evaluate(dy => window.scrollBy(0, dy), center.y - 400);
          await page.waitForTimeout(250);
          metrics = await canvasMetrics(page);
          center = layerCenter(metrics, fields);
        }
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await touchDrag(page, center, { x: center.x, y: center.y - 40 }, 10);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

        const moved = await layerFieldsSheet(page);
        expect(moved.y).toBeLessThan(fields.y - 10);

        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: window.innerWidth
        }));
        expect(overflow.doc).toBeLessThanOrEqual(overflow.viewport + 1);
        expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
      }
    });
  });
});
