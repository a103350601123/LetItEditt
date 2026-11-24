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
    const select = document.querySelector('#ve-inspector-panel select[data-prop="transition.type"]');
    const details = select?.closest('details');
    if (details) details.open = true;
    const rect = select?.getBoundingClientRect();
    const styles = select ? getComputedStyle(select) : null;
    const panel = document.querySelector('#ve-inspector-panel');
    return {
      exists: Boolean(select),
      detailsOpen: details ? details.open : null,
      detailsClass: details ? details.className : null,
      rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
      display: styles?.display,
      visibility: styles?.visibility,
      panelRect: (() => { const r = panel.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      panelDisplay: getComputedStyle(panel).display,
      inspectorDisplay: getComputedStyle(document.querySelector('#ve-inspector')).display,
      html: details ? details.outerHTML.slice(0, 160) : null
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
