const { test } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

test('capture main screens', async ({ page, browser, baseURL }) => {
  await ensureFixtures(browser, baseURL);
  for (const [width, height, name] of [[375, 900, 'phone-top'], [1280, 1000, 'desktop-top']]) {
    await page.setViewportSize({ width, height });
    await page.goto('/media-and-motion/video-editor/');
    await page.waitForFunction(() => Boolean(window.__VE__));
    await page.setInputFiles('#se-file-input', fixturePath('trim-4s.mp4'));
    await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0);
    await page.evaluate(() => window.__VE__.addText('lower'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__VE__.seek(1));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const app = document.getElementById('se-app');
      const top = app.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 4), behavior: 'instant' });
    });
    await page.waitForTimeout(600);
    const metrics = await page.evaluate(() => {
      const f = document.getElementById('se-frame').getBoundingClientRect();
      const c = document.getElementById('se-canvas');
      return {
        frame: { w: f.width, h: f.height, ratio: f.width / f.height },
        canvas: { w: c.width, h: c.height },
        dims: window.__VE__.state().dimensions
      };
    });
    console.log(name, JSON.stringify(metrics));
    await page.screenshot({ path: `test-results/main-${name}.png` });
  }
});
