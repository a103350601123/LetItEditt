const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips)[0];
    window.__videoEditor.selectClip(clip.id);
  });
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const panel = document.querySelector('#ve-inspector-panel');
    const select = document.querySelector('#ve-inspector-panel select[data-prop="transition.type"]');
    select.closest('details').open = true;
    const before = { scrollTop: panel.scrollTop, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight, overflow: getComputedStyle(panel).overflowY, selectY: select.getBoundingClientRect().y };
    panel.scrollTop = 400;
    const after = { scrollTop: panel.scrollTop, selectY: select.getBoundingClientRect().y };
    return { before, after, workspace: document.querySelector('.ve-workspace')?.getBoundingClientRect().height };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
