const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  const result = await page.evaluate(async () => {
    const asset = window.__videoEditor.media.list()[0];
    const url = window.__videoEditor.media.audioUrl(asset.id);
    const el = new Audio();
    el.preload = 'auto';
    el.src = url;

    const log = [];
    const sample = (label) => log.push({
      label,
      ct: +el.currentTime.toFixed(3),
      ready: el.readyState,
      seeking: el.seeking,
      paused: el.paused,
      err: el.error ? el.error.code : null
    });

    await new Promise((resolve) => {
      if (el.readyState >= 1) return resolve();
      el.addEventListener('loadedmetadata', resolve, { once: true });
    });
    sample('metadata');
    await el.play().catch((e) => log.push({ playError: e.name }));
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      sample('play+' + (i + 1) * 250);
    }
    el.pause();
    // now try a fresh element seeked before playing
    const el2 = new Audio();
    el2.preload = 'auto';
    el2.src = url;
    await new Promise((resolve) => el2.addEventListener('loadedmetadata', resolve, { once: true }));
    const seeked = await new Promise((resolve) => {
      const t = setTimeout(() => resolve('timeout'), 1500);
      el2.addEventListener('seeked', () => { clearTimeout(t); resolve('ok'); }, { once: true });
      el2.currentTime = 0.8;
    });
    log.push({ el2seek: seeked, ct: +el2.currentTime.toFixed(3), ready: el2.readyState, seeking: el2.seeking });
    await el2.play().catch((e) => log.push({ playError2: e.name }));
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      log.push({ el2: 'play+' + (i + 1) * 250, ct: +el2.currentTime.toFixed(3), ready: el2.readyState, seeking: el2.seeking, paused: el2.paused });
    }
    return log;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
