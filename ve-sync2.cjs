const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (msg) => console.log('[console]', msg.text()));
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
      console.log(`SEEK ${source.toFixed(3)} now=${entry.el.currentTime.toFixed(3)} ready=${entry.el.readyState} seeking=${entry.el.seeking}`);
      return seek(entry, source);
    };
    const start = audio.startEntry.bind(audio);
    audio.startEntry = (entry, info) => {
      console.log(`START source=${info.source.toFixed(3)}`);
      return start(entry, info);
    };
    const playEntry = audio.playEntry.bind(audio);
    audio.playEntry = (entry) => {
      console.log(`PLAY paused=${entry.el.paused} seeking=${entry.el.seeking} ready=${entry.el.readyState}`);
      return playEntry(entry);
    };
  });
  await page.locator('#ve-play').click();
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => {
      const p = window.__videoEditor.preview;
      const entry = [...p.audio.entries.values()][0];
      return { playhead: Number(p.store.playhead.toFixed(3)), ct: Number(entry.el.currentTime.toFixed(3)), seeking: entry.el.seeking, ready: entry.el.readyState };
    });
    console.log(JSON.stringify(s));
  }
  await browser.close();
})();
