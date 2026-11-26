const { test, expect } = require('@playwright/test');

const toolRoutes = [
  '/media-and-motion/image-photo-editor/',
  '/media-and-motion/image-size-compressor/',
  '/media-and-motion/audio-trimmer/',
  '/media-and-motion/audio-merger/',
  '/media-and-motion/audio-converter/',
  '/media-and-motion/video-trimmer/',
  '/media-and-motion/video-merger/',
  '/media-and-motion/video-cropper/',
  '/media-and-motion/video-resizer/',
  '/media-and-motion/video-compressor/',
  '/media-and-motion/video-converter/',
  '/media-and-motion/video-editor/',
  '/media-and-motion/screen-recorder/'
];

const categoryRoutes = [
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

test.describe('homepage', () => {
  test('publishes unique metadata, one H1 and valid structured data', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Free Online Tools for Images, Video & Audio | LetitEdit');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toContain('13 live tools');
    expect(description.length).toBeGreaterThan(120);
    expect(description.length).toBeLessThanOrEqual(170);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://letitedit.com/');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Free Online Tools for Images, Video & Audio | LetitEdit');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://letitedit.com/');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('Everything you need');

    const graph = await page
      .locator('script[type="application/ld+json"]')
      .evaluate((script) => JSON.parse(script.textContent)['@graph']);
    const types = graph.map((item) => item['@type']);
    expect(types).toEqual(expect.arrayContaining(['WebSite', 'Organization', 'FAQPage']));
    const faq = graph.find((item) => item['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(7);
    await expect(page.locator('details.hp-faq')).toHaveCount(7);
  });

  test('shows every live tool and category exactly once in their sections', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.hp-tool-grid a.hp-tool-card')).toHaveCount(13);
    for (const route of toolRoutes) {
      await expect(page.locator(`.hp-tool-grid a[href="${route}"]`)).toHaveCount(1);
    }

    await expect(page.locator('.hp-category-grid a.hp-category-card')).toHaveCount(28);
    for (const route of categoryRoutes) {
      await expect(page.locator(`.hp-category-grid a[href="${route}"]`)).toHaveCount(1);
    }

    await expect(page.locator('#tools-title')).toHaveText('Tools you can use right now');
    await expect(page.locator('#categories-title')).toHaveText('Find the right category');
  });

  test('searches real tools and categories from the hero', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#tool-search');
    await input.fill('compress');

    await expect(page.locator('#search-results')).toBeVisible();
    await expect(
      page.locator('#search-results .hp-result-title').filter({ hasText: 'Image Size Compressor' })
    ).toBeVisible();
    await expect(
      page.locator('#search-results .hp-result-title').filter({ hasText: 'Video Compressor' })
    ).toBeVisible();

    await page
      .locator('#search-results .hp-result')
      .filter({ hasText: 'Image Size Compressor' })
      .click();
    await expect(page).toHaveURL(/\/media-and-motion\/image-size-compressor\/$/);
  });

  test('supports Enter, empty states and Escape in search', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#tool-search');

    await input.fill('pdf');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/categories\/pdf-document-editing\/$/);

    await page.goto('/');
    await input.fill('zzzz');
    await expect(page.locator('.hp-search-empty')).toContainText('No tools or categories match');
    await expect(page.locator('[data-search-status]')).toContainText('No results for zzzz');

    await input.press('Escape');
    await expect(page.locator('#search-results')).toBeHidden();
  });

  test('header search control focuses the hero field and shows suggestions', async ({ page }) => {
    await page.goto('/');
    await page.locator('.hp-header [data-search-focus]').click();

    await expect(page.locator('#tool-search')).toBeFocused();
    await expect(page.locator('#search-results')).toBeVisible();
    await expect(page.locator('#search-results .hp-search-heading')).toHaveText('Popular tools');

    await page.keyboard.press('Escape');
    await expect(page.locator('#search-results')).toBeHidden();
  });

  test('opens and closes the mobile menu with keyboard support', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const toggle = page.locator('[data-nav-toggle]');
    const nav = page.locator('#mobile-nav');
    await expect(toggle).toBeVisible();
    await expect(page.locator('.hp-nav')).toBeHidden();

    await toggle.click();
    await expect(nav).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.hp-mobile-head [data-nav-close]')).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/hp-lock/);

    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/hp-lock/);

    await toggle.click();
    await nav.locator('a[href="/categories/"]').click();
    await expect(page).toHaveURL(/\/categories\/$/);
  });

  test('fits every target viewport without horizontal overflow', async ({ page }) => {
    const widths = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.locator('h1')).toBeVisible();

      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth
      }));

      expect(overflow.doc, `document overflow at ${width}px`).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body, `body overflow at ${width}px`).toBeLessThanOrEqual(overflow.viewport + 1);
    }
  });

  test('every internal navigation link resolves', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')))]);
    expect(hrefs.length).toBeGreaterThan(40);

    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test('exposes accessible FAQ details and the real contact route', async ({ page }) => {
    await page.goto('/');

    const first = page.locator('details.hp-faq').first();
    await expect(first).not.toHaveAttribute('open', '');
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
    await expect(first.locator('p')).toBeVisible();

    await expect(page.locator('.hp-footer a[href="mailto:info@letitedit.com"]')).toBeVisible();
    await expect(page.locator('.hp-footer-cats a')).toHaveCount(28);
  });

  test('skip link appears on keyboard focus and anchors clear the sticky header', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');
    await expect(page.locator('.hp-skip')).toBeFocused();
    await page.waitForTimeout(250);
    const skipTop = await page.locator('.hp-skip').evaluate((node) => node.getBoundingClientRect().top);
    expect(skipTop).toBeGreaterThanOrEqual(0);

    await page.locator('.hp-nav a[href="#tools"]').click();
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => ({
      sectionTop: document.querySelector('#tools').getBoundingClientRect().top,
      headerBottom: document.querySelector('.hp-header').getBoundingClientRect().bottom
    }));
    expect(metrics.sectionTop).toBeGreaterThanOrEqual(metrics.headerBottom);
  });

  test('loads without console errors or failed requests', async ({ page }) => {
    const problems = [];
    page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push('console: ' + message.text());
    });
    page.on('requestfailed', (request) => problems.push('requestfailed: ' + request.url()));

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
  });
});
