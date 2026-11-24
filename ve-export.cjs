const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(500);

  const exportInfo = await page.evaluate(async () => {
    const ed = window.__videoEditor;
    const out = await ed.exportToBlob({ format: 'webm', resolution: '480', quality: 'small', includeAudio: true });
    const url = URL.createObjectURL(out.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('decode failed'));
    });
    await new Promise((resolve) => { video.onseeked = resolve; video.currentTime = 0.6; });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 12) if (data[i] + data[i + 1] + data[i + 2] > 30) lit += 1;
    const result = {
      size: out.blob.size,
      type: out.blob.type,
      meta: out.meta,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      lit
    };
    URL.revokeObjectURL(url);
    return result;
  });
  console.log(JSON.stringify(exportInfo, null, 2));
  console.log('ERRORS', errors.length);
  for (const error of errors) console.log(error);
  await browser.close();
})();
