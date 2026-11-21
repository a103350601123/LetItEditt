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
  '/categories/qr-barcode-utility-design/'
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

  test('homepage shows nine categories and no tool links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('clean home');
    await expect(page.locator('.category-card')).toHaveCount(9);
    const toolLinks = await page.locator('a[href*="/tools/"]').count();
    expect(toolLinks).toBe(0);
  });

  test('category page explains the category without tool cards', async ({ page }) => {
    await page.goto('/categories/image-photo-editing/');
    await expect(page.locator('h1')).toHaveText('Image & Photo Editing');
    await expect(page.getByText('No tools are published here yet.')).toBeVisible();
    await expect(page.locator('.tool-card')).toHaveCount(0);
    await expect(page.locator('a[href*="/tools/"]')).toHaveCount(0);
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

  test('mobile menu opens and closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('#primary-links')).toBeVisible();
    await expect(page.locator('#primary-links').getByRole('link', { name: 'Blog' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#primary-links')).toBeHidden();
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
    expect(sitemap).toContain('https://letitedit.com/blog/a-smaller-category-first-letitedit/');
    expect(sitemap).not.toContain('/tools/');
    expect(sitemap).not.toContain('/new-tools/');
  });
});
