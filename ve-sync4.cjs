const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const audio = window.__videoEditor.preview.audio;
    const seek = audio.seekElement.bind(audio);
    audio.seekElement = (entry, source) => {
      if (source < 0.05) return;
      return seek(entry, source);
    };
  });
  await page.locator('#ve-play').click();
  const rows = [];
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(250);
    rows.push(await page.evaluate(() => {
      const p = window.__videoEditor.preview;
      const entry = [...p.audio.entries.values()][0];
      return entry ? { ph: +p.store.playhead.toFixed(2), ct: +entry.el.currentTime.toFixed(2), seeking: entry.el.seeking, ready: entry.el.readyState } : null;
    }));
  }
  console.log(JSON.stringify(rows));
  await browser.close();
})();
