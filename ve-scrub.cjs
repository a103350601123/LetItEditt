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
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const asset = ed.media.list()[0];
    const inserted = ed.addAssetToTimeline(asset.id, { start: 0 });
    ed.seek(Math.min(0.6, inserted.clip.duration / 2));
  });
  await page.waitForTimeout(500);
  const info = () => page.evaluate(() => ({
    playhead: window.__videoEditor.store.playhead,
    duration: window.__videoEditor.duration(),
    clipDur: window.__videoEditor.project.tracks.flatMap((t) => t.clips)[0]?.duration,
    scrubValue: document.querySelector('#ve-scrub').value,
    scrubMax: document.querySelector('#ve-scrub').max
  }));
  console.log('start', JSON.stringify(await info()));
  await page.click('#ve-play');
  await page.waitForTimeout(700);
  await page.click('#ve-play');
  console.log('paused', JSON.stringify(await info()));
  await page.click('#ve-next-frame');
  console.log('next', JSON.stringify(await info()));
  await page.click('#ve-prev-frame');
  console.log('prev', JSON.stringify(await info()));
  await page.locator('#ve-scrub').evaluate((element) => {
    element.value = '2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  console.log('scrub immediate', JSON.stringify(await info()));
  await page.waitForTimeout(400);
  console.log('scrub later', JSON.stringify(await info()));
  await browser.close();
  process.exit(0);
})();
