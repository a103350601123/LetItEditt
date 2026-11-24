const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(400);
  const state = () => page.evaluate(() => {
    const select = document.querySelector('#ve-inspector-panel select[data-prop="transition.type"]');
    const details = select?.closest('details');
    const panel = document.querySelector('#ve-inspector-panel');
    const rect = select?.getBoundingClientRect();
    return {
      open: details?.open,
      htmlLength: panel?.innerHTML.length,
      rect: rect ? { w: rect.width, h: rect.height, y: rect.y } : null,
      display: select ? getComputedStyle(select).display : null,
      panelScroll: panel?.scrollTop,
      panelHeight: panel?.clientHeight,
      selected: window.__videoEditor.project.tracks.flatMap((t) => t.clips)[0]?.transition
    };
  });
  console.log('initial', JSON.stringify(await state()));
  await page.evaluate(() => {
    const select = document.querySelector('#ve-inspector-panel select[data-prop="transition.type"]');
    select.closest('details').open = true;
    select.scrollIntoView({ block: 'center' });
  });
  console.log('opened', JSON.stringify(await state()));
  const select = page.locator('#ve-inspector-panel select[data-prop="transition.type"]');
  await select.selectOption('cross-dissolve');
  await page.waitForTimeout(300);
  console.log('after select', JSON.stringify(await state()));
  await page.evaluate(() => {
    const select = document.querySelector('#ve-inspector-panel select[data-prop="transition.type"]');
    select.closest('details').open = true;
    select.scrollIntoView({ block: 'center' });
  });
  console.log('reopened', JSON.stringify(await state()));
  await select.selectOption('none');
  console.log('after none', JSON.stringify(await state()));
  await browser.close();
  process.exit(0);
})();
