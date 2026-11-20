const { test, expect } = require('@playwright/test');

const ROUTES = [
  '/thumbnail-generator/',
  '/image-editor/',
  '/photo-merger/',
  '/image-to-text/',
  '/audio-editor/',
  '/video-to-shorts/',
  '/tools/writing-text/word-counter/',
  '/tools/writing-text/html-to-markdown/',
  '/tools/coding-developer/json-formatter/',
  '/tools/video-editor/',
  '/tools/resume-builder/',
  '/tools/pdf-editor/',
  '/tools/image-compressor/',
  '/tools/text-to-handwriting/'
];

const TEXT_FIRST_ROUTES = new Set([
  '/tools/writing-text/word-counter/',
  '/tools/writing-text/html-to-markdown/',
  '/tools/coding-developer/json-formatter/'
]);

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

async function openWorkspace(page, url, size) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  /* The PDF editor keeps its workspace in a launch overlay. Open it before
   * checking the editing surface, exactly as a user would. */
  if (url === '/tools/pdf-editor/') {
    await page.click('#launchEditorBtn');
    await expect(page.locator('#editorHost')).toBeVisible();
  }
  await page.waitForTimeout(120);
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  expect(overflow, `${page.url()} overflowed by ${overflow}px`).toBeLessThanOrEqual(1);
}

test.describe('global mobile preview workspace', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2, viewport: PORTRAIT });

  for (const route of ROUTES) {
    test(`portrait preview is usable at 390x844: ${route}`, async ({ page }) => {
      await openWorkspace(page, route, PORTRAIT);
      await expect(page.locator('.mw-root')).toHaveCount(1);
      await expect(page.locator('.mw-root > .mw-toolbar')).toBeVisible();
      if (TEXT_FIRST_ROUTES.has(route)) {
        /* Text tools keep their primary input visible on arrival. */
        await expect(page.locator('.mw-root .mw-controls').first()).toBeVisible();
        const height = (await page.locator('.mw-root .mw-controls').first().boundingBox()).height;
        expect(height).toBeGreaterThan(150);
        await expect(page.locator('.mw-root .mw-preview')).toBeHidden();
        await page.locator('.mw-toolbar [data-mw-mode="preview"]').click();
        await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
      } else {
        await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
        const height = (await page.locator('.mw-root .mw-preview').boundingBox()).height;
        expect(height).toBeGreaterThan(150);
        await expect(page.locator('.mw-root .mw-controls').first()).toBeHidden();
      }
      await expectNoOverflow(page);
    });

    test(`landscape preview is usable at 844x390: ${route}`, async ({ page }) => {
      await openWorkspace(page, route, LANDSCAPE);
      if (TEXT_FIRST_ROUTES.has(route)) {
        await expect(page.locator('.mw-root .mw-controls').first()).toBeVisible();
        const height = (await page.locator('.mw-root .mw-controls').first().boundingBox()).height;
        expect(height).toBeGreaterThan(110);
      } else {
        await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
        const height = (await page.locator('.mw-root .mw-preview').boundingBox()).height;
        expect(height).toBeGreaterThan(110);
      }
      await expectNoOverflow(page);
    });
  }

  for (const width of [320, 360, 375, 430]) {
    test(`preview survives ${width}px mobile width`, async ({ page }) => {
      await openWorkspace(page, '/image-editor/', { width, height: width < 380 ? 640 : 900 });
      await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
      const box = await page.locator('.mw-root .mw-preview').boundingBox();
      expect(box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThan(140);
      await expectNoOverflow(page);
    });
  }

  test('preview and controls switch, zoom, fit and fullscreen work', async ({ page }) => {
    await openWorkspace(page, '/image-editor/', PORTRAIT);
    const root = page.locator('.mw-root');
    await expect(root).toHaveAttribute('data-mw-mode', 'preview');
    await root.locator('[data-mw-mode="controls"]').click();
    await expect(root).toHaveAttribute('data-mw-mode', 'controls');
    await expect(root.locator('.mw-controls').first()).toBeVisible();
    await expect(root.locator('.mw-preview')).toBeHidden();
    await root.locator('[data-mw-mode="preview"]').click();
    await expect(root.locator('.mw-preview')).toBeVisible();

    await expect(root.locator('.mw-zoom')).toHaveText('100%');
    await root.locator('[data-mw-action="zoom-in"]').click();
    await expect(root.locator('.mw-zoom')).toHaveText('125%');
    const style = await root.locator('.mw-preview canvas').first().getAttribute('style');
    expect(style).toMatch(/zoom|scale/);
    await root.locator('[data-mw-action="fit"]').click();
    await expect(root.locator('.mw-zoom')).toHaveText('100%');

    await root.locator('[data-mw-action="fullscreen"]').click();
    await expect(root.locator('.mw-preview')).toHaveClass(/mw-fullscreen/);
    await page.keyboard.press('Escape');
    await expect(root.locator('.mw-preview')).not.toHaveClass(/mw-fullscreen/);
    await expectNoOverflow(page);
  });

  test('essential action proxies stay reachable and forward clicks', async ({ page }) => {
    await openWorkspace(page, '/image-editor/', PORTRAIT);
    const bar = page.locator('.mw-root > .mw-action-bar');
    await expect(bar).toBeVisible();
    const count = await bar.locator('.mw-action-btn').count();
    expect(count).toBeGreaterThan(0);
    await expect(bar.locator('.mw-action-btn').first()).toBeEnabled();
    const targetId = await bar.locator('.mw-action-btn').first().getAttribute('data-mw-proxy-for');
    await expect(page.locator(`#${targetId}`)).toHaveCount(1);
  });

  test('visual viewport changes keep controls clear of the keyboard', async ({ page }) => {
    await openWorkspace(page, '/image-editor/', PORTRAIT);
    await page.evaluate(() => {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: { height: 420, offsetTop: 0, addEventListener() {}, removeEventListener() {} }
      });
      window.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveClass(/mw-keyboard-open/);
    const offset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--mw-keyboard-offset').trim());
    expect(parseInt(offset, 10)).toBeGreaterThan(100);
  });
});

test.describe('mobile workspace tablet and desktop layout', () => {
  for (const size of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test(`workspace remains intact at ${size.width}x${size.height}`, async ({ page }) => {
      await openWorkspace(page, '/image-editor/', size);
      await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
      await expectNoOverflow(page);
      if (size.width <= 900) {
        await expect(page.locator('.mw-root .mw-controls').first()).toBeHidden();
        await page.locator('.mw-toolbar [data-mw-mode="controls"]').click();
        await expect(page.locator('.mw-root .mw-controls').first()).toBeVisible();
        await page.locator('.mw-toolbar [data-mw-mode="preview"]').click();
      } else {
        await expect(page.locator('.mw-root .mw-controls').first()).toBeVisible();
        await expect(page.locator('.mw-root > .mw-toolbar')).toBeHidden();
      }
    });
  }
});
