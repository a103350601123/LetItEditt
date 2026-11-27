const { test, expect } = require('@playwright/test');

const categoryPath = '/categories/video-editing/';
const toolPath = '/media-and-motion/video-trimmer/';
const infoPath = '/about/';

test.describe('sitewide navigation and search', () => {
  test('search index lists every live category and tool with a working path', async ({ page, request }) => {
    await page.goto(categoryPath);
    const data = await page.evaluate(() => window.LETITEDIT_SEARCH);

    expect(data.categories).toHaveLength(28);
    expect(data.tools).toHaveLength(13);

    for (const item of [...data.categories, ...data.tools]) {
      expect(item.path, item.name).toMatch(/^\/(categories|media-and-motion)\//);
      expect(item, item.name).not.toHaveProperty('planned');
      const response = await request.get(item.path);
      expect(response.status(), item.path).toBe(200);
    }
  });

  test('header search matches partial words case-insensitively and navigates', async ({ page }) => {
    await page.goto(categoryPath);
    const openButton = page.locator('.topbar [data-search-open]').first();
    await openButton.click();

    const dialog = page.locator('#search-dialog');
    const input = page.locator('#site-search');
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator('.search-hint')).toHaveText('Search all 28 categories and 13 live tools.');
    await expect(input).toHaveAttribute('placeholder', /compress/);

    await input.fill('COMPR');
    await expect(
      page.locator('#search-results .search-result-title').filter({ hasText: 'Image Size Compressor' })
    ).toBeVisible();
    await expect(
      page.locator('#search-results .search-result-title').filter({ hasText: 'Video Compressor' })
    ).toBeVisible();

    await page
      .locator('#search-results .search-result-link')
      .filter({ hasText: 'Image Size Compressor' })
      .click();
    await expect(page).toHaveURL(/\/media-and-motion\/image-size-compressor\/$/);
  });

  test('empty and no-result searches are helpful and Escape restores focus', async ({ page }) => {
    await page.goto(infoPath);
    const openButton = page.locator('.topbar [data-search-open]').first();
    await openButton.click();

    const dialog = page.locator('#search-dialog');
    const input = page.locator('#site-search');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.search-status')).toContainText('28 categories and 13 live tools');
    await expect(page.locator('.search-group-title')).toHaveText('Popular categories');

    await input.fill('zzzz');
    await expect(page.locator('.search-empty-title')).toContainText('No matches for');
    await expect(page.locator('.search-status')).toContainText('No results for');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(openButton).toBeFocused();
  });

  test('mobile menu opens, closes with Escape and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(categoryPath);

    const button = page.locator('.menu-button');
    const menu = page.locator('#mobile-menu');
    await expect(button).toBeVisible();
    await expect(menu).toBeHidden();

    await button.click();
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.mobile-menu-head .icon-button')).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/overlay-open/);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/overlay-open/);

    await button.click();
    await menu.locator('.mobile-primary a[href="/faq/"]').click();
    await expect(page).toHaveURL(/\/faq\/$/);
  });

  test('tool pages without the drawer use the compact nav menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(toolPath);

    const button = page.locator('.menu-button');
    const nav = page.locator('#primary-links');
    await expect(button).toBeVisible();
    await expect(nav).toBeHidden();

    await button.click();
    await expect(nav).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.locator('a[href="/categories/"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();

    await button.click();
    await nav.locator('a[href="/faq/"]').click();
    await expect(page).toHaveURL(/\/faq\/$/);
  });

  test('image compressor keeps its existing compact menu behaviour', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/media-and-motion/image-size-compressor/');

    const button = page.locator('.menu-button');
    const nav = page.locator('#primary-links');
    await expect(nav).toBeHidden();

    await button.click();
    await expect(nav).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('tool pages using the sitewide script open the compact menu accessibly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/media-and-motion/audio-converter/');

    const button = page.locator('.menu-button');
    const nav = page.locator('#primary-links');
    await expect(nav).toBeHidden();

    await button.click();
    await expect(nav).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.locator('a[href="/categories/"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('desktop navigation is visible on category, tool and info pages', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const path of [categoryPath, toolPath, infoPath]) {
      await page.goto(path);
      await expect(page.locator('.nav-links')).toBeVisible();
      await expect(page.locator('.menu-button')).toBeHidden();
      for (const href of ['/categories/', '/blog/', '/news/', '/faq/']) {
        await expect(page.locator(`.nav-links a[href="${href}"]`)).toBeVisible();
      }
    }
  });

  test('category page fits every target width without overflow', async ({ page }) => {
    const widths = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(categoryPath);

      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth
      }));
      expect(overflow.doc, `document overflow at ${width}px`).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body, `body overflow at ${width}px`).toBeLessThanOrEqual(overflow.viewport + 1);

      if (width <= 720) {
        await expect(page.locator('.menu-button')).toBeVisible();
        await expect(page.locator('.nav-links')).toBeHidden();
        await page.locator('.menu-button').click();
        await expect(page.locator('#mobile-menu')).toBeVisible();
        const panel = await page.locator('.mobile-menu-panel').boundingBox();
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1);
        await page.keyboard.press('Escape');
      } else {
        await expect(page.locator('.menu-button')).toBeHidden();
        await expect(page.locator('.nav-links')).toBeVisible();
      }
    }
  });

  test('tool page inline navigation fits mobile and desktop widths', async ({ page }) => {
    for (const width of [320, 390, 768, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(toolPath);

      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth
      }));
      expect(overflow.doc, `document overflow at ${width}px`).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body, `body overflow at ${width}px`).toBeLessThanOrEqual(overflow.viewport + 1);

      if (width <= 720) {
        const button = page.locator('.menu-button');
        const nav = page.locator('#primary-links');
        await expect(button).toBeVisible();
        await expect(nav).toBeHidden();
        await button.click();
        await expect(nav).toBeVisible();
        const box = await nav.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        await page.keyboard.press('Escape');
      } else {
        await expect(page.locator('.menu-button')).toBeHidden();
        await expect(page.locator('#primary-links')).toBeVisible();
      }
    }
  });

  test('representative pages load without console errors or missing files', async ({ page }) => {
    const problems = [];
    page.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push('console: ' + message.text());
    });
    page.on('response', (response) => {
      if (response.url().startsWith('http://127.0.0.1:4173/') && response.status() === 404) {
        problems.push('404: ' + response.url());
      }
    });

    for (const path of [categoryPath, toolPath, infoPath, '/404.html']) {
      problems.length = 0;
      await page.goto(path);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      expect(problems, path).toEqual([]);
    }
  });

  test('navigation links on representative pages resolve', async ({ page, request }) => {
    const hrefs = new Set();
    for (const path of [categoryPath, toolPath, infoPath]) {
      await page.goto(path);
      const found = await page
        .locator('a[href^="/"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      for (const href of found) {
        if (href) hrefs.add(href.split('#')[0]);
      }
    }

    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test('homepage keeps its own navigation and search implementation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('script[src*="js/home.js"]')).toHaveCount(1);
    await expect(page.locator('script[src*="js/site.js"]')).toHaveCount(0);
    await expect(page.locator('script[src*="js/search-index.js"]')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('[data-nav-toggle]').click();
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await expect(page.locator('[data-nav-toggle]')).toHaveAttribute('aria-expanded', 'true');
  });

  test('mobile drawer search opens, filters and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(infoPath);

    await page.locator('.menu-button').click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    await page.locator('#mobile-menu [data-search-open]').click();

    const dialog = page.locator('#search-dialog');
    const input = page.locator('#site-search');
    await expect(page.locator('#mobile-menu')).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill('pdf');
    await expect(page.locator('#search-results .search-result-title').first()).toBeVisible();
    await expect(page.locator('#search-results')).toContainText('PDF');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('.menu-button')).toBeFocused();
  });

  test('reduced motion keeps the menu and search usable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(categoryPath);

    await page.locator('.menu-button').click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-menu')).toBeHidden();

    await page.locator('.topbar [data-search-open]').first().click();
    await expect(page.locator('#search-dialog')).toBeVisible();
    await page.locator('#site-search').fill('video');
    await expect(page.locator('#search-results .search-result-title').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-dialog')).toBeHidden();
  });

  test('GTM is still loaded once per page', async ({ page }) => {
    await page.goto(infoPath);
    await expect(page.locator('script[src*="googletagmanager.com/gtm.js"]')).toHaveCount(1);
    expect(await page.evaluate(() => Array.isArray(window.dataLayer))).toBe(true);
  });
});
