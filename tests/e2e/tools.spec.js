const { test, expect } = require('@playwright/test');
const tools = require('../../data/tools.json');

const toolPath = slug => `/tools/writing-text/${slug}/index.html`;
const engineSlugs = new Set(tools.filter(tool => tool.engine).map(tool => tool.slug));
const generatedTools = tools.filter(tool => tool.layout !== 'existing');
const sharedRuntimeTools = generatedTools.filter(tool => !engineSlugs.has(tool.slug));

test('case converter produces real output', async ({ page }) => {
  await page.goto(toolPath('case-converter'));
  await page.fill('#tool-input', 'the quick brown fox');
  await expect(page.locator('#tool-output')).toHaveText('The Quick Brown Fox');
});

test('binary converter shows errors and round-trips Unicode', async ({ page }) => {
  await page.goto(toolPath('binary-to-text'));
  await page.fill('#tool-input', '010 0001');
  await expect(page.locator('#tool-output')).toHaveClass(/is-error/);
  await expect(page.locator('#tool-output')).toContainText('8-bit groups');

  await page.goto(toolPath('text-to-binary'));
  await page.fill('#tool-input', 'Café 😀');
  const binary = await page.locator('#tool-output').textContent();
  expect(binary).toMatch(/^[01 ]+$/);

  await page.goto(toolPath('binary-to-text'));
  await page.fill('#tool-input', binary.trim());
  await expect(page.locator('#tool-output')).toHaveText('Café 😀');
});

test('text comparer renders a real diff', async ({ page }) => {
  await page.goto(toolPath('text-comparer'));
  await page.fill('#tool-input-left', 'The cat sat');
  await page.fill('#tool-input-right', 'The dog sat');
  await expect(page.locator('.diff-remove')).toContainText('- The cat sat');
  await expect(page.locator('.diff-add')).toContainText('+ The dog sat');
  await expect(page.locator('#tool-status')).toContainText('1 added');
});

test('clear and repeated use work in the same page session', async ({ page }) => {
  await page.goto(toolPath('text-reverser'));
  await page.fill('#tool-input', 'abc');
  await expect(page.locator('#tool-output')).toHaveText('cba');
  await page.click('#clear-input');
  await expect(page.locator('#tool-input')).toHaveValue('');
  await page.fill('#tool-input', 'hello world');
  await expect(page.locator('#tool-output')).toHaveText('dlrow olleh');
});

test('site search matches names, descriptions and keywords and navigates to results', async ({ page }) => {
  await page.goto('/');
  await page.fill('#site-search', 'slug');
  await expect(page.locator('.search-result').first()).toContainText('Text to Slug Converter');
  await expect(page.locator('#search-results')).toBeVisible();

  await page.fill('#site-search', 'regex');
  await expect(page.locator('.search-result').first()).toContainText('Regex Tester');

  await page.fill('#site-search', 'bionic');
  await page.click('.search-result');
  await page.waitForURL('**/tools/writing-text/bionic-reading/');
  await expect(page.locator('h1')).toContainText('Bionic');
});

for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
  test(`layout has no horizontal overflow at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto(toolPath('word-counter'));
    await expect(page.locator('h1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);

    if (width <= 680) {
      await page.click('.menu-button');
      await expect(page.locator('.nav-links')).toBeVisible();
    }
  });
}

test('every shared-runtime tool runs without runtime errors', async ({ page }) => {
  const samples = {
    'binary-to-text': '01000001 01000010',
    'html-to-markdown': '<h2>Hello</h2><p><strong>World</strong></p>',
    'extract-emails': 'Contact jane@example.com',
    'extract-urls': 'Visit https://example.com/page.',
    'morse-code': 'SOS',
    'text-sorter': 'banana\napple\ncherry',
    'text-splitter': 'one two three four five six'
  };
  const generic = 'Hello world. Café 😀!';

  for (const tool of sharedRuntimeTools) {
    const errors = [];
    const onError = error => errors.push(error.message);
    page.on('pageerror', onError);
    await page.goto(toolPath(tool.slug));

    if (tool.layout === 'diff') {
      await page.fill('#tool-input-left', 'a\nb');
      await page.fill('#tool-input-right', 'a\nc');
    } else {
      await page.fill('#tool-input', samples[tool.slug] || generic);
    }

    await expect(page.locator('#tool-output'), `${tool.slug} produced empty output`).not.toBeEmpty();
    await expect(page.locator('#tool-output'), `${tool.slug} reported an error`).not.toHaveClass(/is-error/);
    expect(errors, `${tool.slug} threw a browser error`).toEqual([]);
    page.off('pageerror', onError);
  }
});

test('all generated tool pages expose unique SEO metadata', async ({ page }) => {
  const seen = new Set();
  for (const tool of generatedTools) {
    await page.goto(toolPath(tool.slug));
    const title = await page.title();
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(title).toBe(tool.title);
    expect(description).toBe(tool.description);
    expect(canonical).toBe(`https://letitedit.com/tools/writing-text/${tool.slug}/`);
    expect(seen.has(title)).toBe(false);
    seen.add(title);
    await expect(page.locator('nav.breadcrumbs')).toBeVisible();
    await expect(page.locator('.faq-item').first()).toBeVisible();
    await expect(page.locator('h1')).toHaveText(tool.h1);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', tool.title);
  }
  expect(seen.size).toBe(33);
});

test('preserved standalone tools keep their original URLs and still load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/tools/resume-builder/index.html');
  // The app replaces the document title with the active resume name after load.
  await expect(page.locator('.brand-text strong')).toHaveText('Resume Builder');
  await expect(page.locator('body')).toBeVisible();

  await page.goto('/tools/text-to-handwriting/index.html');
  await expect(page.locator('h1')).toHaveText('Text to Handwriting');
  expect(errors).toEqual([]);
});

test('all internal links resolve', async ({ page, request }) => {
  const pages = [
    '/',
    '/tools/',
    '/tools/writing-text/',
    '/categories/',
    '/new-tools/',
    '/news/',
    '/blog/',
    '/faq/',
    '/about/',
    '/contact/',
    '/privacy-policy/',
    '/terms-of-service/',
    '/tools/text-to-handwriting/index.html'
  ];
  tools.forEach(tool => pages.push(tool.url ? `/${tool.url}` : toolPath(tool.slug)));

  const links = new Set();
  for (const target of pages) {
    const response = await request.get(target);
    expect(response.status(), `Page missing: ${target}`).toBe(200);
    const html = await response.text();
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g), match => match[1].replace(/&amp;/g, '&'));
    hrefs.forEach(href => {
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) return;
      const resolved = new URL(href, 'http://127.0.0.1:4173' + target);
      if (resolved.origin !== 'http://127.0.0.1:4173') return;
      links.add(resolved.pathname + resolved.search);
    });
  }

  expect(links.size).toBeGreaterThan(30);
  for (const link of links) {
    const response = await request.get(link);
    expect(response.status(), `Broken link: ${link}`).toBe(200);
  }
});
