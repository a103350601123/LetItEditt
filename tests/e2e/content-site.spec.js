const { test, expect } = require('@playwright/test');

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

  test('homepage shows all 28 categories grouped and no tool links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('clean home');
    await expect(page.locator('.category-tile')).toHaveCount(28);
    await expect(page.locator('.category-group')).toHaveCount(4);
    const toolLinks = await page.locator('a[href*="/tools/"]').count();
    expect(toolLinks).toBe(0);
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
    const routes = ['/', '/categories/', '/categories/face-portrait-editing/', '/faq/'];
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

  test('sitemap contains kept pages and no tool routes', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const sitemap = await response.text();
    expect(sitemap).toContain('https://letitedit.com/categories/');
    expect(sitemap).toContain('https://letitedit.com/categories/image-photo-editing/');
    expect(sitemap).toContain('https://letitedit.com/categories/face-portrait-editing/');
    expect(sitemap).toContain('https://letitedit.com/blog/a-smaller-category-first-letitedit/');
    expect(sitemap).not.toContain('/tools/');
    expect(sitemap).not.toContain('/new-tools/');
  });
});
