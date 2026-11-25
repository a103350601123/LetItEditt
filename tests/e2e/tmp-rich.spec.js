'use strict';

const { test, expect } = require('@playwright/test');
const { fixturePath } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-editor/';

async function openEditor(page) {
  await page.goto(PAGE);
  await page.waitForFunction(() => Boolean(window.__VE__), null, { timeout: 30000 });
  await expect(page.locator('#se-canvas')).toBeVisible();
}

async function uploadVideo(page, name) {
  await page.setInputFiles('#se-file-input', fixturePath(name));
  await page.waitForTimeout(300);
}

test('rich project export matches preview', async ({ page }) => {
  test.setTimeout(600000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await openEditor(page);
  await uploadVideo(page, 'trim-4s.mp4');
  await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0, null, { timeout: 60000 });
  await page.setInputFiles('#se-file-input', fixturePath('trim-2s-mute.mp4'));
  await page.waitForFunction(() => window.__VE__.state().layerCount === 2, null, { timeout: 30000 });

  const built = await page.evaluate(() => {
    const ve = window.__VE__;
    ve.addText('title');
    ve.addShape('circle');
    ve.seek(2);
    const base = ve.store.baseTrack();
    const baseId = base.clips[0].id;
    ve.select(baseId);
    const secondId = ve.split(baseId);
    ve.store.apply((project) => {
      const track = project.tracks.find((item) => item.id === project.baseTrackId);
      const first = track.clips.find((clip) => clip.start < 1);
      const second = track.clips.find((clip) => clip.start >= 1.9);
      if (first) {
        first.fadeIn = 1.2;
        first.volume = 0.9;
      }
      if (second) {
        second.transition = { type: 'cross-dissolve', duration: 0.6, reverse: false };
        second.fadeOut = 0.6;
        second.filter = 'vivid';
        second.filterIntensity = 0.8;
      }
      const text = project.tracks
        .flatMap((item) => item.clips)
        .find((clip) => clip.kind === 'text' && clip.text?.content === 'Your title');
      if (text) {
        text.x = 0.3;
        text.y = 0.28;
        text.scale = 0.72;
        text.rotation = -12;
      }
    });
    return {
      duration: ve.store.duration(),
      baseId,
      secondId,
      clips: ve.store.baseTrack().clips.map((clip) => ({
        id: clip.id,
        start: clip.start,
        duration: clip.duration,
        transition: clip.transition
      })),
      layers: ve.store.layerEntries().length
    };
  });
  console.log('RICH_BUILT', JSON.stringify(built));
  await page.evaluate(() => window.__VE__.seek(1.2));
  await page.waitForTimeout(600);

  const exported = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.__VE__.exportNow({
      format: 'mp4',
      resolution: '720',
      quality: 'balanced',
      includeAudio: true
    });
    return {
      wallMs: performance.now() - started,
      meta: result.meta,
      size: result.blob.size
    };
  });
  console.log('RICH_EXPORT', JSON.stringify({ wallMs: exported.wallMs, meta: exported.meta, size: exported.size }));

  // Compare exported frames with the preview at the same timestamps.
  const comparison = await page.evaluate(async (times) => {
    const result = window.__VE__.app.lastExport;
    const url = URL.createObjectURL(result.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('export did not decode'));
    });
    const width = 160;
    const height = 90;
    const shot = document.createElement('canvas');
    shot.width = width;
    shot.height = height;
    const shotCtx = shot.getContext('2d');
    const preview = document.getElementById('se-canvas');
    const previewShot = document.createElement('canvas');
    previewShot.width = width;
    previewShot.height = height;
    const previewCtx = previewShot.getContext('2d');

    const differences = [];
    for (const time of times) {
      window.__VE__.seek(time);
      await new Promise((resolve) => setTimeout(resolve, 450));
      previewCtx.drawImage(preview, 0, 0, width, height);
      const previewData = previewCtx.getImageData(0, 0, width, height).data;

      /* A seek lands on a frame boundary, so allow the exported file to be
         one frame either side of the preview before calling it a mismatch. */
      let best = Infinity;
      const candidates = [];
      for (const offset of [0, -1 / 30, 1 / 30]) {
        video.currentTime = Math.max(0, Math.min(video.duration - 0.001, time + offset));
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });
        shotCtx.drawImage(video, 0, 0, width, height);
        const exportedData = shotCtx.getImageData(0, 0, width, height).data;
        let sum = 0;
        let meanR = 0;
        let meanG = 0;
        let meanB = 0;
        for (let index = 0; index < exportedData.length; index += 4) {
          sum += Math.abs(exportedData[index] - previewData[index]);
          sum += Math.abs(exportedData[index + 1] - previewData[index + 1]);
          sum += Math.abs(exportedData[index + 2] - previewData[index + 2]);
          meanR += exportedData[index];
          meanG += exportedData[index + 1];
          meanB += exportedData[index + 2];
        }
        const pixels = exportedData.length / 4;
        candidates.push({
          at: Number(video.currentTime.toFixed(3)),
          diff: sum / (pixels * 3),
          rgb: [meanR / pixels, meanG / pixels, meanB / pixels].map((value) => Math.round(value))
        });
        best = Math.min(best, sum / (pixels * 3));
      }
      let meanR = 0;
      let meanG = 0;
      let meanB = 0;
      for (let index = 0; index < previewData.length; index += 4) {
        meanR += previewData[index];
        meanG += previewData[index + 1];
        meanB += previewData[index + 2];
      }
      const pixels = previewData.length / 4;
      differences.push({
        time,
        meanAbs: best,
        previewRgb: [meanR / pixels, meanG / pixels, meanB / pixels].map((value) => Math.round(value)),
        candidates
      });
    }

    // Decode the exported audio and measure loudness in windows to confirm
    // the volume/fade edits reached the file.
    const audioBuffer = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(
      await result.blob.arrayBuffer()
    );
    const channel = audioBuffer.getChannelData(0);
    const windowRms = (start, length) => {
      const from = Math.max(0, Math.floor(start * audioBuffer.sampleRate));
      const to = Math.min(channel.length, Math.floor((start + length) * audioBuffer.sampleRate));
      let sum = 0;
      for (let index = from; index < to; index += 1) sum += channel[index] * channel[index];
      return Math.sqrt(sum / Math.max(1, to - from));
    };
    const audio = {
      duration: audioBuffer.duration,
      start: windowRms(0.02, 0.25),
      middle: windowRms(1.6, 0.25),
      end: windowRms(audioBuffer.duration - 0.3, 0.25)
    };

    URL.revokeObjectURL(url);
    return {
      videoDuration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      differences,
      audio
    };
  }, [0.4, 1.9, 2.25, 2.6, 3.4]);

  console.log('RICH_COMPARE', JSON.stringify(comparison));
  console.log('RICH_ERRORS', JSON.stringify(errors));

  expect(comparison.videoDuration).toBeCloseTo(built.duration, 0);
  expect(comparison.width).toBe(1280);
  expect(comparison.height).toBe(720);
  for (const diff of comparison.differences) expect(diff.meanAbs).toBeLessThan(28);
  expect(comparison.audio.middle).toBeGreaterThan(0.02);
  expect(comparison.audio.start).toBeLessThan(comparison.audio.middle);
  expect(comparison.audio.end).toBeLessThan(comparison.audio.middle);
  expect(errors).toEqual([]);
});
