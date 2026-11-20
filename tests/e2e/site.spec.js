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
  await expect(page.locator('body')).toContainText(/not found/i);
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

test('hero and nav search share one scoring engine and /?q= is honoured', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('#hero-search');
  const strip = page.locator('#site-search');
  await expect(hero).toBeVisible();
  await expect(strip).toBeVisible();

  await hero.fill('slug');
  await expect(page.locator('#hero-search-results .search-result').first()).toContainText('Text to Slug Converter');
  await expect(strip).toHaveValue('slug');

  await strip.fill('regex');
  await expect(page.locator('#search-results .search-result').first()).toContainText('Regex Tester');
  await expect(hero).toHaveValue('regex');
  await expect(page.locator('#hero-search-results .search-result')).toHaveCount(0);

  await page.goto('/?q=base64');
  await expect(hero).toHaveValue('base64');
  await expect(page.locator('#hero-search-results')).toBeVisible();
  await expect(page.locator('#hero-search-results .search-result').first()).toContainText('Base64');
  await expect(strip).toHaveValue('base64');
  const structured = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structured).toContain('SearchAction');
  expect(structured).toContain('/?q={search_term_string}');

  const wordCounter = registry.bySlug.get('word-counter');
  if (wordCounter) {
    await page.goto(`${wordCounter.pageUrl}?q=json`);
    await expect(page.locator('#search-strip')).toHaveClass(/is-open/);
    await expect(strip).toBeVisible();
    await expect(page.locator('#search-results .search-result').first()).toContainText('JSON Formatter');
  }
});

test('featured homepage tools come from registry metadata with an honest fallback', async ({ page }) => {
  const expected = registry.featuredTools(4);
  await page.goto('/');
  const cards = page.locator('.featured-section .tool-card');
  await expect(cards).toHaveCount(Math.min(4, registry.publishedTools.length));
  const names = (await cards.locator('h3').allInnerTexts()).map(name => name.replace(/New$/, '').trim());
  expect(names).toEqual(expected.map(tool => tool.name));
  if (registry.publishedTools.some(tool => tool.featured)) {
    expect(expected.every(tool => tool.featured)).toBe(true);
  } else {
    expect(expected.length).toBeGreaterThan(0);
  }
});

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function metaContent(html, regex) {
  const match = html.match(regex);
  return match ? decodeEntities(match[1]) : '';
}

test('SEO metadata is unique across all published tools and complete on generated pages', async ({ request }) => {
  const titles = [];
  const descriptions = [];
  const canonicals = [];
  const manifestResponse = await request.get('/js/seo-manifest.js');
  expect(manifestResponse.status(), 'SEO manifest status').toBe(200);
  const manifestText = await manifestResponse.text();
  const manifestMatch = manifestText.match(/window\.LETITEDIT_SEO = ([\s\S]*?);\s*$/);
  expect(manifestMatch, 'SEO manifest payload').toBeTruthy();
  const buildTools = JSON.parse(manifestMatch[1]);
  const generated = buildTools.filter(tool => tool.layout !== 'existing');

  for (const tool of buildTools) {
    const response = await request.get(tool.pageUrl);
    expect(response.status(), `${tool.slug} page status`).toBe(200);
    const html = await response.text();
    const title = metaContent(html, /<title>([\s\S]*?)<\/title>/i);
    const description = metaContent(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
    expect(title, `${tool.slug} title`).toBeTruthy();
    expect(description, `${tool.slug} description`).toBeTruthy();
    titles.push(title);
    descriptions.push(description);

    if (tool.layout === 'existing') continue;

    const canonical = metaContent(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
    const ogTitle = metaContent(html, /<meta\s+property="og:title"\s+content="([^"]*)"/i);
    const ogDescription = metaContent(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i);
    const ogUrl = metaContent(html, /<meta\s+property="og:url"\s+content="([^"]*)"/i);
    expect(title, `${tool.slug} title metadata`).toBe(tool.title);
    expect(description, `${tool.slug} description metadata`).toBe(tool.description);
    expect(canonical, `${tool.slug} canonical`).toBe(`https://letitedit.com${tool.pageUrl}`);
    expect(ogTitle, `${tool.slug} og:title`).toBe(tool.title);
    expect(ogDescription, `${tool.slug} og:description`).toBe(tool.description);
    expect(ogUrl, `${tool.slug} og:url`).toBe(`https://letitedit.com${tool.pageUrl}`);
    expect(html.match(/<h1\b/gi) || [], `${tool.slug} heading structure`).toHaveLength(1);
    expect(html, `${tool.slug} breadcrumbs`).toContain('aria-label="Breadcrumb"');
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    const types = ldMatch ? JSON.parse(ldMatch[1])['@graph'].map(node => node['@type']) : [];
    expect(types, `${tool.slug} structured data`).toContain('SoftwareApplication');
    expect(types, `${tool.slug} breadcrumb structured data`).toContain('BreadcrumbList');
    canonicals.push(canonical);
  }

  expect(new Set(titles).size, 'duplicate tool titles').toBe(buildTools.length);
  expect(new Set(descriptions).size, 'duplicate tool descriptions').toBe(buildTools.length);
  expect(new Set(canonicals).size, 'duplicate tool canonicals').toBe(generated.length);
});

test('redirect tools keep a usable stub and stay out of published indexes', async ({ request }) => {
  const redirects = registry.redirectTools || [];
  test.skip(!redirects.length, 'No redirect metadata in the registry');

  const searchIndex = await (await request.get('/js/search-index.js')).text();
  const sidebarData = await (await request.get('/js/sidebar-data.js')).text();
  const sitemap = await (await request.get('/sitemap.xml')).text();

  for (const tool of redirects) {
    expect(registry.publishedTools.some(published => published.slug === tool.slug), `${tool.slug} published`).toBe(false);
    const response = await request.get(tool.pageUrl);
    expect(response.status(), `${tool.slug} redirect status`).toBe(200);
    const html = await response.text();
    expect(html, `${tool.slug} meta refresh`).toContain('http-equiv="refresh"');
    expect(html, `${tool.slug} refresh target`).toContain(`url=${tool.redirectTo}`);
    expect(html, `${tool.slug} manual link`).toContain(`href="${tool.redirectTo}"`);
    expect(html, `${tool.slug} notice`).toContain('Tool relocated');
    expect(html, `${tool.slug} canonical target`).toContain(`href="https://letitedit.com${tool.redirectTo}"`);
    expect(sitemap, `${tool.slug} in sitemap`).not.toContain(`https://letitedit.com${tool.pageUrl}`);
    expect(searchIndex, `${tool.slug} in search index`).not.toContain(tool.pageUrl);
    expect(sidebarData, `${tool.slug} in sidebar data`).not.toContain(tool.pageUrl);
    const categoryHtml = await (await request.get(tool.category.path)).text();
    expect(categoryHtml, `${tool.slug} in category cards`).not.toContain(`href="${tool.pageUrl}"`);
  }
});

const responsivePaths = ['/', '/categories/', registry.CATEGORIES[0].path].concat(
  ['writing', 'dev', 'image', 'video'].map(key => {
    const tool = registry.publishedTools.find(item => item.categoryKey === key && item.layout !== 'existing');
    return tool ? tool.pageUrl : null;
  }).filter(Boolean)
);

for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
  test(`representative pages have no horizontal overflow at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    for (const path of responsivePaths) {
      await page.goto(path);
      await expect(page.locator('h1').first(), `${path} heading at ${width}px`).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} overflow at ${width}px`).toBeLessThanOrEqual(1);
      if (path === '/') await expect(page.locator('#hero-search'), `hero search at ${width}px`).toBeVisible();
      if (path.startsWith('/tools/') || /^\/[a-z-]+\/$/.test(path)) {
        const outputButton = page.locator('.output-actions .btn').first();
        if (await outputButton.count()) {
          /* Preview-first tools already show their actions. Text-first tools
           * keep the input visible, so reveal the output actions on demand. */
          if (!(await outputButton.isVisible())) {
            const controlsTab = page.locator('.mw-root[data-mw-mode="preview"] [data-mw-mode="controls"]');
            if (await controlsTab.count() && await controlsTab.isVisible()) await controlsTab.click();
          }
          await expect(outputButton, `output action on ${path}`).toBeVisible();
        }
      }
    }
    expect(errors, `page errors at ${width}px`).toEqual([]);
  });
}

test('hero floats stay clear of content and simplify across breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const boxes = await page.evaluate(() => {
    function rect(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }
    return {
      content: ['.hero h1', '.hero-search', '.hero-actions'].map(rect),
      floats: Array.from(document.querySelectorAll('.hero-float')).map(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      })
    };
  });
  for (const float of boxes.floats) {
    for (const content of boxes.content) {
      const overlaps = !(float.right <= content.left || float.left >= content.right ||
        float.bottom <= content.top || float.top >= content.bottom);
      expect(overlaps, 'floating card overlaps hero content').toBe(false);
    }
  }

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/');
  const tabletPosition = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-float-layer')).position);
  expect(tabletPosition).toBe('static');

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const mobileDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-float-layer')).display);
  expect(mobileDisplay).toBe('none');
});

test('mobile menu closes with Escape and reduced motion disables hero animation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.click('.menu-button');
  await expect(page.locator('.nav-links')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nav-links')).toBeHidden();
  await expect(page.locator('.menu-button')).toHaveAttribute('aria-expanded', 'false');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const animation = await page.evaluate(() => {
    const float = document.querySelector('.hero-float');
    return float ? getComputedStyle(float).animationName : 'missing';
  });
  expect(animation).toBe('none');
});
