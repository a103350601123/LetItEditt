const { test, expect } = require('@playwright/test');
const registry = require('../../data/registry');
const content = require('../../data/content');

test('homepage exposes every required nav item and the search icon focuses the field', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('.nav-links');
  for (const label of ['Categories', 'New Tools', 'News', 'Blog', 'All Tools', 'FAQ']) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.locator('#nav-search')).toBeVisible();
  await page.click('#nav-search');
  await expect(page.locator('#site-search')).toBeFocused();
  await expect(page.locator('#search-strip')).toHaveClass(/is-open/);
});

test('active navigation and sidebar states follow the current page', async ({ page }) => {
  await page.goto('/new-tools/');
  await expect(page.locator('.nav-links a[aria-current="page"]')).toHaveText('New Tools');

  await page.goto('/tools/writing-text/');
  const active = page.locator('.sidebar-link.is-active');
  await expect(active).toHaveAttribute('data-sidebar-key', 'writing');
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(active).toHaveClass(/is-active/);
});

test('sidebar counts come from the registry and filter categories and tools', async ({ page }) => {
  await page.goto('/tools/');
  await expect(page.locator('.sidebar-link')).toHaveCount(registry.CATEGORIES.length + 1);
  await expect(page.locator('[data-sidebar-key="all"] .sidebar-count')).toHaveText(String(registry.publishedTools.length));

  for (const category of registry.CATEGORIES) {
    const link = page.locator(`[data-sidebar-key="${category.key}"]`);
    await expect(link).toContainText(category.name);
    await expect(link.locator('.sidebar-count')).toHaveText(String(registry.publishedByCategory(category.key).length));
  }

  await page.fill('#sidebar-filter', 'regex');
  await expect(page.locator('#sidebar-matches')).toBeVisible();
  await expect(page.locator('#sidebar-matches')).toContainText('Regex Tester');
  await expect(page.locator('[data-sidebar-key="all"]')).toBeHidden();
  await page.fill('#sidebar-filter', 'image');
  await expect(page.locator('[data-sidebar-key="image"]')).toBeVisible();
  await page.fill('#sidebar-filter', '');
  await expect(page.locator('#sidebar-matches')).toBeHidden();

  await page.fill('#tool-filter', 'bionic');
  await expect(page.locator('#directory-matched')).toHaveText('1 matching tool');
  await expect(page.locator('.tool-grid .card:visible')).toHaveCount(1);
  await expect(page.locator('.tool-grid')).toContainText('Bionic Reading');
});

test('categories page lists all ten stable categories with dynamic counts', async ({ page }) => {
  await page.goto('/categories/');
  await expect(page.locator('h1')).toHaveText('Categories');
  await expect(page.locator('.category-card')).toHaveCount(registry.CATEGORIES.length);
  for (const category of registry.CATEGORIES) {
    const count = registry.publishedByCategory(category.key).length;
    const card = page.locator(`.category-card[href="${category.path}"]`);
    await expect(card).toContainText(category.name);
    await expect(card.locator('.card-tag')).toHaveText(`${count} tool${count === 1 ? '' : 's'}`);
  }
});

test('every category page has a title, description, count, cards or an honest empty state', async ({ page }) => {
  for (const category of registry.CATEGORIES) {
    await page.goto(category.path);
    await expect(page.locator('h1')).toHaveText(category.label);
    await expect(page.locator('.page-head p')).toContainText(category.intro);
    const count = registry.publishedByCategory(category.key).length;
    await expect(page.locator('.directory-count')).toHaveText(`${count} tool${count === 1 ? '' : 's'}`);
    if (count === 0) {
      await expect(page.locator('.empty-state')).toBeVisible();
      await expect(page.locator('.empty-state')).toContainText('future tools');
    } else {
      await expect(page.locator('#tool-grid .card')).toHaveCount(count);
    }
  }
});

test('New Tools is generated from publication metadata with no duplicate list', async ({ page }) => {
  const expected = registry.newTools();
  await page.goto('/new-tools/');
  const cards = page.locator('.tool-grid .card');
  await expect(cards).toHaveCount(expected.length);
  const names = await cards.locator('h3').allInnerTexts();
  expect(names.map(name => name.replace(/New$/, '').trim())).toEqual(expected.map(tool => tool.name));
  await expect(page.locator('.page-head')).toContainText('No manual list to maintain.');
});

test('News and Blog are real foundations with no fabricated articles', async ({ page }) => {
  for (const [path, heading, emptyText] of [
    ['/news/', 'News', 'No news yet'],
    ['/blog/', 'Blog', 'No articles yet']
  ]) {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveText(heading);
    await expect(page.locator('.empty-state')).toContainText(emptyText);
    await expect(page.locator('.article-card-list')).toHaveCount(0);
  }
  expect(content.news).toEqual([]);
  expect(content.blog).toEqual([]);
});

test('FAQ entries expand by keyboard and expose FAQ structured data', async ({ page }) => {
  await page.goto('/faq/');
  await expect(page.locator('h1')).toHaveText('Frequently Asked Questions');
  await expect(page.locator('.faq-item')).toHaveCount(content.faq.length);
  const first = page.locator('.faq-item').first();
  await expect(first).not.toHaveAttribute('open', '');
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('open', '');
  const structured = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structured).toContain('FAQPage');
});

test('nested content pages load their local CSS and JavaScript', async ({ page, request }) => {
  const paths = ['/categories/', '/news/', '/blog/', '/faq/', '/about/', '/contact/', '/privacy-policy/', '/terms-of-service/'];
  for (const path of paths) {
    await page.goto(path);
    const assets = await page.evaluate(() => ({
      stylesheet: document.querySelector('link[rel="stylesheet"]').getAttribute('href'),
      scripts: Array.from(document.querySelectorAll('script[src]'), el => el.getAttribute('src'))
    }));
    expect(assets.stylesheet, `stylesheet path on ${path}`).toBe('../css/site.css');
    for (const asset of [assets.stylesheet, ...assets.scripts]) {
      const url = new URL(asset, page.url()).toString();
      const response = await request.get(url);
      expect(response.status(), `${asset} on ${path}`).toBe(200);
    }
  }
});

test('SEO support files include published tools and unknown routes return 404', async ({ request, page }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://letitedit.com/sitemap.xml');

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  for (const tool of registry.publishedTools) {
    expect(xml, `${tool.slug} missing from sitemap`).toContain(`https://letitedit.com${tool.pageUrl}`);
  }

  const missing = await request.get('/this-page-does-not-exist/');
  expect(missing.status()).toBe(404);
  await page.goto('/this-page-does-not-exist/');
  await expect(page.locator('body')).toContainText('Not found');
});

test('generated pages contain no copied third-party branding, analytics or ad scripts', async ({ request }) => {
  for (const path of ['/', '/tools/', '/tools/writing-text/text-cleaner/', '/tools/writing-text/word-counter/']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    for (const forbidden of ['WebUtility.io', 'WebUtility', 'G-66D2Z3H7TC', 'googletagmanager', 'grow.me', 'ScriptWrapper', 'LiteSpeed', 'OceanWP']) {
      expect(html, `${path} contains ${forbidden}`).not.toContain(forbidden);
    }
  }
});
