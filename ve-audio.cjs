const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(300);
  await page.locator('#ve-play').click();
  await page.waitForTimeout(1200);
  const audio = await page.evaluate(() => ({
    debug: window.__videoEditor.getAudioDebug(),
    playing: window.__videoEditor.state.playing,
    time: window.__videoEditor.state.playhead
  }));
  console.log(JSON.stringify(audio, null, 2));
  await page.waitForTimeout(800);
  const audio2 = await page.evaluate(() => ({ debug: window.__videoEditor.getAudioDebug(), time: window.__videoEditor.state.playhead }));
  console.log(JSON.stringify(audio2, null, 2));
  await page.locator('#ve-play').click();
  console.log('ERRORS', errors.length);
  for (const error of errors) console.log(error);
  await browser.close();
})();
