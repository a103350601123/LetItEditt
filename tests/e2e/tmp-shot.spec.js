const { test } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

test('inspect text layer', async ({ page, browser, baseURL }) => {
  await ensureFixtures(browser, baseURL);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/media-and-motion/video-editor/');
  await page.waitForFunction(() => Boolean(window.__VE__));
  await page.setInputFiles('#se-file-input', fixturePath('trim-4s.mp4'));
  await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0);
  const id = await page.evaluate(() => window.__VE__.addText('lower'));
  await page.evaluate(() => window.__VE__.seek(1));
  await page.waitForTimeout(600);
  const info = await page.evaluate((clipId) => {
    const found = window.__VE__.store.trackForClip(clipId);
    const box = document.querySelector('.se-selection-box');
    const frame = document.getElementById('se-frame').getBoundingClientRect();
    const r = box ? box.getBoundingClientRect() : null;
    return {
      clip: JSON.parse(JSON.stringify(found.clip)),
      box: r && { x: r.x - frame.x, y: r.y - frame.y, w: r.width, h: r.height },
      frame: { w: frame.width, h: frame.height },
      handles: [...document.querySelectorAll('[data-handle]')].map((n) => n.dataset.handle)
    };
  }, id);
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'test-results/inspect-text.png', clip: { x: 0, y: 150, width: 375, height: 300 } });
});
