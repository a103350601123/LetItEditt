const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

async function inspectExport(page, options) {
  return page.evaluate(async (settings) => {
    const ed = window.__videoEditor;
    const started = performance.now();
    const out = await ed.exportToBlob(settings);
    const ms = Math.round(performance.now() - started);
    const url = URL.createObjectURL(out.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('decode failed'));
    });
    const meta = out.meta;
    URL.revokeObjectURL(url);
    return {
      type: out.blob.type,
      size: out.blob.size,
      ms,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: +video.duration.toFixed(2),
      meta: {
        format: meta.format,
        codec: meta.codec,
        audioCodec: meta.audioCodec,
        width: meta.width,
        height: meta.height,
        duration: +Number(meta.duration).toFixed(2),
        hasAudio: meta.hasAudio,
        videoBitrate: meta.videoBitrate,
        bitrate: meta.bitrate
      }
    };
  }, options);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(800);

  const mp4 = await inspectExport(page, { format: 'mp4', resolution: '480', quality: 'small' });
  check('MP4 480p produced a real file', mp4.type === 'video/mp4' && mp4.meta.format === 'mp4' && mp4.size > 50000, mp4);
  check('MP4 480p dimensions', mp4.meta.width === 854 && mp4.meta.height === 480, [mp4.meta.width, mp4.meta.height]);
  check('MP4 480p audio included', mp4.meta.hasAudio && mp4.meta.audioCodec === 'aac', [mp4.meta.hasAudio, mp4.meta.audioCodec]);
  check('MP4 480p duration', Math.abs(mp4.duration - 4.01) < 0.35, mp4.duration);

  await page.evaluate(() => window.__videoEditor.setProjectValue('project.aspect', '9:16'));
  await page.waitForTimeout(600);
  const portrait = await inspectExport(page, { format: 'mp4', resolution: '720', quality: 'small' });
  check('MP4 720p portrait file', portrait.size > 50000 && portrait.meta.format === 'mp4', { size: portrait.size, w: portrait.meta.width, h: portrait.meta.height });
  check('MP4 720p portrait shape', portrait.height === 1280 && Math.abs(portrait.width / portrait.height - 9 / 16) < 0.01, [portrait.width, portrait.height]);
  check('MP4 720p portrait audio', portrait.meta.hasAudio, portrait.meta.hasAudio);

  await page.evaluate(() => window.__videoEditor.setProjectValue('project.aspect', '1:1'));
  await page.waitForTimeout(600);
  const square = await inspectExport(page, { format: 'webm', resolution: '480', quality: 'small' });
  check('WebM square file', square.type === 'video/webm' && square.meta.format === 'webm' && square.size > 30000, square);
  check('WebM square dimensions', square.meta.width === square.meta.height && Math.abs(square.meta.width - 854) <= 2, [square.meta.width, square.meta.height]);

  const silent = await inspectExport(page, { format: 'webm', resolution: '480', quality: 'small', includeAudio: false });
  check('Silent export has no audio', silent.meta.hasAudio === false && !silent.meta.audioCodec, { hasAudio: silent.meta.hasAudio, audioCodec: silent.meta.audioCodec });
  check('Silent export still has picture', silent.size > 20000 && silent.meta.width > 100, { size: silent.size, w: silent.meta.width });

  const noAudioEncoder = await page.evaluate(async () => {
    const original = window.AudioEncoder;
    try {
      Object.defineProperty(window, 'AudioEncoder', { value: undefined, configurable: true, writable: true });
      const ed = window.__videoEditor;
      const caps = ed.exporter.capabilities();
      const out = await ed.exportToBlob({ format: 'webm', resolution: '480', quality: 'small', includeAudio: true });
      return { caps, hasAudio: out.meta.hasAudio, size: out.blob.size, audioCodec: out.meta.audioCodec };
    } finally {
      Object.defineProperty(window, 'AudioEncoder', { value: original, configurable: true, writable: true });
    }
  });
  check('Missing AudioEncoder degrades to silent video', noAudioEncoder.caps.audioEncoder === false && noAudioEncoder.hasAudio === false && noAudioEncoder.size > 20000, noAudioEncoder);

  console.log(JSON.stringify({ results, errors }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`PASS ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();

