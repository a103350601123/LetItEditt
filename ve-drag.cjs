const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(300);

  const inspect = () => page.evaluate(() => ({
    undo: window.__videoEditor.store.undoStack.length,
    redo: window.__videoEditor.store.redoStack.length,
    pending: window.__videoEditor.store.pendingSnapshot !== null,
    pps: window.__videoEditor.store.timelineZoom,
    clips: window.__videoEditor.project.tracks.flatMap((t) => t.clips).map((c) => ({ kind: c.kind, start: c.start, duration: c.duration }))
  }));
  console.log('after add', JSON.stringify(await inspect()));

  const clip = page.locator('.tl-clip[data-clip-id]').first();
  const box = await clip.boundingBox();
  console.log('box', JSON.stringify(box));
  const pps = await page.evaluate(() => window.__videoEditor.store.timelineZoom);
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(box.x + 30 + i * 9, box.y + box.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  console.log('after drag', JSON.stringify(await inspect()), 'expected start', 54 / pps);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  console.log('after undo', JSON.stringify(await inspect()));

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  console.log('after redo', JSON.stringify(await inspect()));
  await browser.close();
})();
