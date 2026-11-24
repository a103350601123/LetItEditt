const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
const OUT = 'C:/Users/Ismail/AppData/Local/Temp/opencode';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.stack || error.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-app').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/ve-app-empty.png` });

  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(400);
  const afterText = await page.evaluate(() => ({
    clips: window.__videoEditor.project.tracks.reduce((n, t) => n + t.clips.length, 0),
    selection: [...window.__videoEditor.state.selection],
    inspector: document.querySelector('#ve-inspector-panel')?.textContent.trim().slice(0, 120)
  }));
  console.log('after text', JSON.stringify(afterText));
  await page.screenshot({ path: `${OUT}/ve-app-text.png` });

  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const mediaInfo = await page.evaluate(() => window.__videoEditor.media.list().map((a) => ({ id: a.id, type: a.type, duration: a.duration, w: a.width, h: a.height })));
  console.log('media', JSON.stringify(mediaInfo));
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(600);
  const afterVideo = await page.evaluate(() => ({
    clips: window.__videoEditor.project.tracks.reduce((n, t) => n + t.clips.length, 0),
    duration: window.__videoEditor.duration(),
    tracks: window.__videoEditor.project.tracks.map((t) => `${t.name}:${t.clips.length}`)
  }));
  console.log('after video', JSON.stringify(afterVideo));
  await page.screenshot({ path: `${OUT}/ve-app-video.png` });

  const supports = await page.evaluate(() => window.__videoEditor.support());
  console.log('support', JSON.stringify(supports));
  console.log('ERRORS', errors.length);
  for (const error of errors) console.log(error);
  await browser.close();
})();
