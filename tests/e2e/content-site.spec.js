const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const keptRoutes = [
  '/',
  '/categories/',
  '/blog/',
  '/news/',
  '/faq/',
  '/about/',
  '/contact/',
  '/privacy-policy/',
  '/terms-of-service/',
  '/categories/image-photo-editing/',
  '/categories/video-editing/',
  '/categories/audio-music-editing/',
  '/categories/pdf-document-editing/',
  '/categories/text-writing-editing/',
  '/categories/graphic-design-creative-editing/',
  '/categories/web-code-editing/',
  '/categories/diagram-presentation-productivity-design/',
  '/categories/qr-barcode-utility-design/',
  '/categories/face-portrait-editing/',
  '/categories/ai-image-enhancement-restoration/',
  '/categories/3d-design-model-editing/',
  '/categories/animation-motion-graphics/',
  '/categories/font-typography-editing/',
  '/categories/color-gradient-tools/',
  '/categories/logo-branding-tools/',
  '/categories/social-media-design-tools/',
  '/categories/screenshot-screen-image-editing/',
  '/categories/data-visualization-infographic-editing/',
  '/categories/ebook-publishing-tools/',
  '/categories/email-newsletter-design/',
  '/categories/sound-effects-voice-design/',
  '/categories/cad-technical-drawing/',
  '/categories/signature-document-annotation/',
  '/categories/ui-ux-website-design-tools/',
  '/categories/print-marketing-material-design/',
  '/categories/metadata-file-information-editing/',
  '/categories/digital-drawing-illustration/'
];

test.describe('content-only site', () => {
  test('serves every kept page without tool UI', async ({ page }) => {
    for (const route of keptRoutes) {
      const response = await page.goto(route);
      expect(response.status(), route).toBe(200);
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('.category-sidebar')).toHaveCount(0);
      await expect(page.locator('#tool-grid')).toHaveCount(0);
      await expect(page.locator('#nav-search')).toHaveCount(0);
    }
  });

  test('homepage shows all 28 categories grouped and only the live tool link', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('clean home');
    await expect(page.locator('.category-tile')).toHaveCount(28);
    await expect(page.locator('.category-group')).toHaveCount(4);
    const toolLinks = await page.locator('a[href*="/tools/"]').count();
    expect(toolLinks).toBe(0);
    await expect(page.locator('a[href="/media-and-motion/image-photo-editor/"]').first()).toBeVisible();
    await expect(page.locator('.tool-card-feature')).toContainText('Image & Photo Editor');
  });

  test('category page explains the category and labels planned tools', async ({ page }) => {
    await page.goto('/categories/face-portrait-editing/');
    await expect(page.locator('h1')).toHaveText('Face & Portrait Editing');
    await expect(page.getByText('No tools are published here yet.')).toBeVisible();
    await expect(page.locator('.tool-chip')).toHaveCount(9);
    await expect(page.locator('.badge').first()).toHaveText('Planned');
    await expect(page.locator('.tool-card')).toHaveCount(0);
    await expect(page.locator('a[href*="/tools/"]')).toHaveCount(0);
  });

  test('planned-tool filter narrows the list', async ({ page }) => {
    await page.goto('/categories/face-portrait-editing/');
    await page.locator('#tool-filter').fill('eye');
    await expect(page.locator('[data-filter-item]:visible')).toHaveCount(1);
    await expect(page.locator('[data-filter-item]:visible')).toContainText('Eye correction');
    await page.locator('#tool-filter').fill('zzzz');
    await expect(page.locator('[data-filter-empty]')).toBeVisible();
  });

  test('category directory filter works and reports the count', async ({ page }) => {
    await page.goto('/categories/');
    await expect(page.locator('[data-category]')).toHaveCount(28);
    await page.locator('#directory-search').fill('portrait');
    await expect(page.locator('[data-category]:visible')).toHaveCount(1);
    await expect(page.locator('[data-directory-status]')).toHaveText('Showing 1 of 28 categories');
    await page.locator('#directory-search').fill('zzzz');
    await expect(page.locator('[data-directory-empty]')).toBeVisible();
    await page.locator('#directory-search').fill('');
    await expect(page.locator('[data-category]:visible')).toHaveCount(28);
  });

  test('global search finds a planned tool and marks it planned', async ({ page }) => {
    await page.goto('/');
    await page.locator('.search-button').click();
    await expect(page.locator('#search-dialog')).toBeVisible();
    await expect(page.locator('#site-search')).toBeFocused();
    await page.locator('#site-search').fill('upscaler');
    await expect(page.locator('.search-result.is-planned').first()).toContainText('Image upscaler');
    await expect(page.locator('.search-result.is-planned .badge').first()).toHaveText('Planned');
    await page.locator('#site-search').fill('zzzz');
    await expect(page.locator('.search-empty')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-dialog')).toBeHidden();
  });

  test('search results link to the category page', async ({ page }) => {
    await page.goto('/categories/');
    await page.locator('.search-button').click();
    await page.locator('#site-search').fill('color gradient');
    const result = page.locator('.search-result-link', { hasText: 'Color & Gradient Tools' }).first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(/\/categories\/color-gradient-tools\/$/);
  });

  test('blog lists the published post and the post page renders', async ({ page }) => {
    await page.goto('/blog/');
    const postLink = page.getByRole('link', { name: 'A smaller, category-first LetitEdit' });
    await expect(postLink).toBeVisible();
    await postLink.click();
    await expect(page.locator('h1')).toHaveText('A smaller, category-first LetitEdit');
    await expect(page.locator('.article-card')).toContainText('What changed');
    await expect(page.locator('.article-card')).toContainText('What comes next');
  });

  test('news shows an honest empty state', async ({ page }) => {
    await page.goto('/news/');
    await expect(page.locator('h1')).toHaveText('News');
    await expect(page.getByText('No news yet')).toBeVisible();
  });

  test('FAQ expands an answer', async ({ page }) => {
    await page.goto('/faq/');
    await expect(page.locator('.faq-item')).toHaveCount(7);
    const first = page.locator('.faq-item').first();
    await first.locator('summary').click();
    await expect(first.locator('p')).toBeVisible();
  });

  test('mobile menu opens, locks scroll and closes with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    await expect(page.locator('#mobile-menu').getByRole('link', { name: 'Blog' })).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/overlay-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-menu')).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/overlay-open/);
  });

  test('mobile menu closes after a category link is chosen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.locator('#mobile-menu summary').filter({ hasText: 'Design & Branding' }).click();
    await page.locator('#mobile-menu').getByRole('link', { name: 'Color & Gradient Tools' }).click();
    await expect(page).toHaveURL(/\/categories\/color-gradient-tools\/$/);
    await expect(page.locator('#mobile-menu')).toBeHidden();
  });

  test('mobile search opens from the header and closes cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('.search-button').click();
    await expect(page.locator('#search-dialog')).toBeVisible();
    await page.locator('#site-search').fill('metadata');
    await expect(page.locator('.search-result').first()).toBeVisible();
    await page.locator('[data-search-close]').last().click();
    await expect(page.locator('#search-dialog')).toBeHidden();
  });

  test('no horizontal overflow at mobile and desktop widths', async ({ page }) => {
    const widths = [320, 360, 375, 390, 430, 768, 1280];
    const routes = ['/', '/categories/', '/categories/face-portrait-editing/', '/faq/', '/media-and-motion/image-photo-editor/'];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('old tool and listing URLs return 404', async ({ page }) => {
    const removedRoutes = [
      '/tools/',
      '/new-tools/',
      '/image-editor/',
      '/image-compressor/',
      '/tools/writing-text/word-counter/',
      '/tools/coding-developer/json-formatter/',
      '/tools/image-photo-editing/'
    ];
    for (const route of removedRoutes) {
      const response = await page.goto(route);
      expect(response.status(), route).toBe(404);
    }
  });

  test('sitemap contains kept pages, the live tool and no legacy tool routes', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const sitemap = await response.text();
    expect(sitemap).toContain('https://letitedit.com/categories/');
    expect(sitemap).toContain('https://letitedit.com/categories/image-photo-editing/');
    expect(sitemap).toContain('https://letitedit.com/categories/face-portrait-editing/');
    expect(sitemap).toContain('https://letitedit.com/blog/a-smaller-category-first-letitedit/');
    expect(sitemap).toContain('https://letitedit.com/media-and-motion/image-photo-editor/');
    expect(sitemap).not.toContain('/tools/');
    expect(sitemap).not.toContain('/new-tools/');
  });
});

test.describe('image and photo editor', () => {
  const fixture = name => path.join(__dirname, '..', 'fixtures', name);
  const toolPath = '/media-and-motion/image-photo-editor/';

  async function openFixture(page, name) {
    await page.goto(toolPath);
    await page.locator('[data-file-input]').setInputFiles(fixture(name));
    await expect(page.locator('[data-status-left]')).toContainText('×');
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

  test('imports a PNG locally and reports its real dimensions', async ({ page }) => {
    await openFixture(page, 'sample.png');
    await expect(page.locator('[data-status-left]')).toContainText('320 × 200');
    await expect(page.locator('[data-status-left]')).toContainText('PNG');
    await expect(page.locator('[data-file-name]')).toContainText('sample.png');
    await expect(page.locator('[data-panel-title]')).toHaveText('Adjust');
    await expect(page.locator('[data-adjust="brightness"]')).toBeVisible();
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
    await page.locator('[data-tool="export"]').last().click();
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
    await page.locator('[data-tool="export"]').last().click();
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
});
