const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
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
    await new Promise((resolve, reject) => { el.onloadedmetadata = resolve; el.onerror = () => reject(new Error('load failed')); });
    const trySeek = async (target) => {
      const start = performance.now();
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ target, result: 'timeout', ready: el.readyState, seeking: el.seeking, ct: el.currentTime, ms: Math.round(performance.now() - start) }), 2000);
        el.addEventListener('seeked', () => { clearTimeout(timer); resolve({ target, result: 'seeked', ready: el.readyState, seeking: el.seeking, ct: el.currentTime, ms: Math.round(performance.now() - start) }); }, { once: true });
        el.currentTime = target;
      });
    };
    const one = await trySeek(0.5);
    const two = await trySeek(0.001);
    const three = await trySeek(1.2);
    return { ready: el.readyState, duration: el.duration, one, two, three };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
