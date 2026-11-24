const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
const files = ['trim-4s.mp4', 'trim-3s.webm', 'trim-audio-only.m4a', 'trim-mov.mov', 'trim-mkv.mkv', 'trim-pcm.mov', 'trim-ulaw.mov', 'trim-multi-track.mkv', 'trim-44100.mp4'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  for (const file of files) {
    const input = page.locator('#ve-media-input');
    await input.setInputFiles(path.resolve('tests/fixtures', file));
    await page.waitForFunction(() => window.__videoEditor.media.list().length > 0, null, { timeout: 20000 });
    const result = await page.evaluate(async (name) => {
      const ed = window.__videoEditor;
      const asset = ed.media.list().find((a) => a.name === name) || ed.media.list()[ed.media.list().length - 1];
      const buffer = await asset.file.arrayBuffer();
      const ctx = new AudioContext();
      const started = performance.now();
      try {
        const decoded = await ctx.decodeAudioData(buffer);
        const out = {
          name,
          ok: true,
          duration: +decoded.duration.toFixed(2),
          channels: decoded.numberOfChannels,
          rate: decoded.sampleRate,
          ms: Math.round(performance.now() - started),
          bytes: decoded.length * decoded.numberOfChannels * 4
        };
        await ctx.close();
        return out;
      } catch (error) {
        await ctx.close();
        return { name, ok: false, error: error.message, ms: Math.round(performance.now() - started) };
      }
    }, file);
    console.log(JSON.stringify(result));
    await page.evaluate(() => {
      const ed = window.__videoEditor;
      for (const asset of ed.media.list()) ed.media.remove(asset.id);
    });
    await page.waitForTimeout(200);
  }
  await browser.close();
})();
