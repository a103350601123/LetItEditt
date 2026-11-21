const { test, expect } = require('@playwright/test');
const devTools = require('../../data/dev-tools.json');

const devPath = slug => `/tools/coding-developer/${slug}/`;

test('JSON formatter validates, formats, minifies and sorts real data', async ({ page }) => {
  await page.goto(devPath('json-formatter'));
  await expect(page.locator('h1')).toHaveText('JSON Formatter & Validator');

  await page.fill('#tool-input', '{"b":2,"a":1,"list":[3,1,2]}');
  await expect(page.locator('#tool-status')).toContainText('Formatted JSON');
  let output = await page.locator('#tool-output').textContent();
  expect(output).toBe('{\n  "b": 2,\n  "a": 1,\n  "list": [\n    3,\n    1,\n    2\n  ]\n}');

  await page.check('#control-sortKeys');
  output = await page.locator('#tool-output').textContent();
  expect(output.indexOf('"a"')).toBeLessThan(output.indexOf('"b"'));
  expect(JSON.parse(output).list).toEqual([3, 1, 2]);

  await page.uncheck('#control-sortKeys');
  await page.selectOption('#control-mode', 'minify');
  expect(await page.locator('#tool-output').textContent()).toBe('{"b":2,"a":1,"list":[3,1,2]}');

  await page.selectOption('#control-mode', 'format');
  await page.selectOption('#control-indent', '4');
  output = await page.locator('#tool-output').textContent();
  expect(output).toContain('    "b": 2');

  await page.fill('#tool-input', '{"a":1,}');
  await expect(page.locator('#tool-output')).toHaveClass(/is-error/);
  await expect(page.locator('#tool-output')).toContainText('Invalid JSON');
  await expect(page.locator('#tool-status')).toContainText('Invalid JSON');

  await page.fill('#tool-input', '');
  expect(await page.locator('#tool-output').textContent()).toBe('');
  await expect(page.locator('#tool-status')).toHaveText('Paste JSON to begin.');
  await expect(page.locator('#tool-output')).not.toHaveClass(/is-error/);
});

test('Base64 tool round-trips UTF-8, URL-safe values and both directions', async ({ page }) => {
  await page.goto(devPath('base64-encoder-decoder'));
  await expect(page.locator('h1')).toHaveText('Base64 Encoder & Decoder');

  await page.fill('#tool-input', 'Café 😀');
  await expect(page.locator('#tool-output')).toHaveText('Q2Fmw6kg8J+YgA==');

  await page.selectOption('#control-mode', 'decode');
  await expect(page.locator('#tool-input-label')).toHaveText('Base64 to decode');
  await page.fill('#tool-input', 'Q2Fmw6kg8J+YgA==');
  await expect(page.locator('#tool-output')).toHaveText('Café 😀');

  await page.selectOption('#control-mode', 'encode');
  await page.check('#control-urlSafe');
  await page.fill('#tool-input', '??>>');
  const urlSafe = await page.locator('#tool-output').textContent();
  expect(urlSafe).toBe('Pz8-Pg');
  expect(urlSafe).not.toMatch(/[+/=]/);

  await page.uncheck('#control-urlSafe');
  await page.fill('#tool-input', 'hello world');
  const encoded = await page.locator('#tool-output').textContent();
  expect(encoded).toBe('aGVsbG8gd29ybGQ=');
  await page.click('#swap-output');
  await expect(page.locator('#control-mode')).toHaveValue('decode');
  await expect(page.locator('#tool-input')).toHaveValue(encoded);
  await expect(page.locator('#tool-output')).toHaveText('hello world');

  await page.fill('#tool-input', '!!!!');
  await expect(page.locator('#tool-output')).toHaveClass(/is-error/);
  await expect(page.locator('#tool-status')).toContainText('Invalid Base64');

  await page.fill('#tool-input', '');
  await expect(page.locator('#tool-status')).toHaveText('Paste Base64 to begin.');

  await page.selectOption('#control-mode', 'encode');
  await page.fill('#tool-input', '');
  await expect(page.locator('#tool-status')).toHaveText('Paste text to begin.');
});

test('regex tester highlights matches, shows groups and previews replacements', async ({ page }) => {
  await page.goto(devPath('regex-tester'));
  await expect(page.locator('h1')).toHaveText('Regex Tester & Match Highlighter');

  await page.fill('#tool-input', 'Contact jane@example.com or sam@site.org');
  await page.fill('#control-pattern', '[\\w.+-]+@[\\w-]+\\.[\\w.]+');
  await expect(page.locator('#tool-status')).toContainText('2 matches found');
  await expect(page.locator('.regex-match')).toHaveCount(2);
  await expect(page.locator('.regex-match').first()).toHaveText('jane@example.com');
  await expect(page.locator('.regex-match').nth(1)).toHaveText('sam@site.org');

  await page.fill('#control-replacement', '<$&>');
  await expect(page.locator('.regex-replacement')).toContainText('<jane@example.com>');
  await expect(page.locator('.regex-replacement')).toContainText('<sam@site.org>');

  await page.fill('#control-pattern', '(\\w+)@(\\w+)');
  await expect(page.locator('.regex-table')).toContainText('$1: jane');
  await expect(page.locator('.regex-table')).toContainText('$2: example');

  await page.fill('#control-pattern', '(');
  await expect(page.locator('#tool-output')).toHaveClass(/is-error/);
  await expect(page.locator('#tool-status')).toContainText('Invalid regular expression');

  await page.fill('#control-pattern', '');
  await expect(page.locator('.regex-empty')).toContainText('Enter a regular expression');

  await page.click('#load-example');
  await expect(page.locator('#control-pattern')).toHaveValue('[\\w.+-]+@[\\w-]+\\.[\\w.]+');
  await expect(page.locator('#tool-input')).toHaveValue('Contact jane@example.com or sam@site.org');
  await expect(page.locator('#tool-status')).toContainText('2 matches found');

  await page.fill('#control-pattern', '^');
  await page.check('#control-multiline');
  await page.fill('#tool-input', 'a\nb');
  await expect(page.locator('.regex-zero')).toHaveCount(2);

  await page.click('#clear-input');
  await expect(page.locator('#tool-input')).toHaveValue('');
  await expect(page.locator('#tool-output')).toContainText('Test string is empty.');
});

test('developer tool pages expose unique SEO metadata and 500+ word guides', async ({ page }) => {
  const seen = new Set();
  for (const tool of devTools) {
    await page.goto(devPath(tool.slug));
    const title = await page.title();
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(title).toBe(tool.title);
    expect(description).toBe(tool.description);
    expect(canonical).toBe(`https://letitedit.com/tools/coding-developer/${tool.slug}/`);
    expect(seen.has(title)).toBe(false);
    seen.add(title);

    await expect(page.locator('h1')).toHaveText(tool.h1);
    await expect(page.locator('nav.breadcrumbs')).toBeVisible();
    await expect(page.locator('nav.breadcrumbs')).toContainText('Web & Code Editing');
    await expect(page.locator('.faq-item').first()).toBeVisible();
    await expect(page.locator('.article-card')).toBeVisible();

    const articleText = await page.locator('.article-card').innerText();
    const words = articleText.split(/\s+/).filter(Boolean).length;
    expect(words, `${tool.slug} should have at least 500 words of visible guidance`).toBeGreaterThanOrEqual(500);

    const related = page.locator('.info-card').last().locator('a.card');
    expect(await related.count()).toBeGreaterThanOrEqual(3);
    const hrefs = await related.evaluateAll(elements => elements.map(el => el.getAttribute('href')));
    hrefs.forEach(href => expect(href).toContain('/tools/'));
  }
  expect(seen.size).toBe(3);
});

test('web and code category page lists all three tools and its planned slots', async ({ page }) => {
  await page.goto('/tools/web-code-editing/');
  await expect(page.locator('h1')).toHaveText('Web & Code Editing');
  await expect(page.locator('#tool-grid a.available-card')).toHaveCount(3);
  await expect(page.locator('#tool-grid .planned-card')).toHaveCount(23);
  await expect(page.locator('#tool-grid')).toContainText('JSON Formatter & Validator');
  await expect(page.locator('#tool-grid')).toContainText('Base64 Encoder & Decoder');
  await expect(page.locator('#tool-grid')).toContainText('Regex Tester & Match Highlighter');
});

test('developer tools have no horizontal overflow on mobile and desktop', async ({ page }) => {
  const samples = {
    'json-formatter': '{"long":"' + 'x'.repeat(600) + '","nested":{"a":[1,2,3]}}',
    'base64-encoder-decoder': 'Long Unicode text: Café 😀 مرحبا ' + 'word '.repeat(60),
    'regex-tester': 'Contact ' + 'a'.repeat(120) + '@example.com for details'
  };

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const tool of devTools) {
      const errors = [];
      const onError = error => errors.push(error.message);
      page.on('pageerror', onError);
      await page.goto(devPath(tool.slug));
      await expect(page.locator('h1')).toBeVisible();
      await page.fill('#tool-input', samples[tool.slug]);
      if (tool.kind === 'regex') {
        await page.fill('#control-pattern', '[\\w.+-]+@[\\w-]+\\.[\\w.]+');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${tool.slug} overflowed at ${width}px`).toBeLessThanOrEqual(1);
      expect(errors, `${tool.slug} threw an error at ${width}px`).toEqual([]);
      page.off('pageerror', onError);

      if (width <= 680) {
        await page.click('.menu-button');
        await expect(page.locator('.nav-links')).toBeVisible();
      }
    }
  }
});

test('developer tool internal links and search results resolve', async ({ page, request }) => {
  const pages = [
    '/',
    '/tools/web-code-editing/',
    devPath('json-formatter'),
    devPath('base64-encoder-decoder'),
    devPath('regex-tester')
  ];
  const links = new Set();
  for (const target of pages) {
    await page.goto(target);
    const hrefs = await page.locator('a[href]').evaluateAll(elements => elements.map(el => el.getAttribute('href')));
    hrefs.forEach(href => {
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) return;
      const resolved = new URL(href, page.url());
      if (resolved.origin !== 'http://127.0.0.1:4173') return;
      links.add(resolved.pathname);
    });
  }
  expect(links.size).toBeGreaterThan(20);
  for (const link of links) {
    const response = await request.get(link);
    expect(response.status(), `Broken link: ${link}`).toBe(200);
  }

  await page.goto('/');
  await page.fill('#site-search', 'json');
  await expect(page.locator('.search-result').first()).toContainText('JSON Formatter');
  await expect(page.locator('.search-result').first()).toContainText('Web & Code Editing');
  await page.fill('#site-search', 'base64');
  await expect(page.locator('.search-result').first()).toContainText('Base64');
  await page.fill('#site-search', 'regex');
  await expect(page.locator('.search-result').first()).toContainText('Regex');
});
