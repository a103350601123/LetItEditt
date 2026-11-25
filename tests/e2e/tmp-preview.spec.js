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
  await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0, null, { timeout: 60000 });
}

test('preview stability with video and text overlay', async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await openEditor(page);
  await uploadVideo(page, 'trim-4s.mp4');
  await page.evaluate(() => {
    window.__VE__.addText('title');
    window.__VE__.seek(0);
  });
  await page.waitForTimeout(600);

  const preview = await page.evaluate(async () => {
    const samples = [];
    const canvas = document.getElementById('se-canvas');
    const ctx = canvas.getContext('2d');
    const pixel = (x, y) => {
      try {
        const data = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        return (data[0] + data[1] + data[2]) / 3;
      } catch (error) {
        return -1;
      }
    };
    window.__VE__.play();
    const started = performance.now();
    while (performance.now() - started < 4400) {
      const debug = window.__VE__.preview.debug();
      const w = canvas.width;
      const h = canvas.height;
      samples.push({
        t: Math.round(performance.now() - started),
        head: window.__VE__.store.playhead,
        renderMs: debug.renderMs,
        lag: debug.renderLag,
        inFlight: debug.renderInFlight,
        frameCallbackSeen: debug.frameCallbackSeen,
        videoElements: debug.videoElements,
        brightness:
          (pixel(w * 0.25, h * 0.5) + pixel(w * 0.5, h * 0.5) + pixel(w * 0.75, h * 0.5)) / 3
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.__VE__.pause();
    return samples;
  });

  const black = preview.filter((sample) => sample.brightness >= 0 && sample.brightness < 6);
  const lags = preview.map((sample) => sample.lag).filter((value) => typeof value === 'number');
  const renders = preview.map((sample) => sample.renderMs).filter((value) => typeof value === 'number' && value > 0);
  const summary = {
    samples: preview.length,
    blackFrames: black.length,
    blackAt: black.map((sample) => sample.t),
    maxLag: lags.length ? Math.max(...lags) : null,
    avgLag: lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null,
    avgRenderMs: renders.length ? renders.reduce((a, b) => a + b, 0) / renders.length : null,
    maxRenderMs: renders.length ? Math.max(...renders) : null,
    videoElements: preview[preview.length - 1]?.videoElements,
    frameCallbackSeen: preview[preview.length - 1]?.frameCallbackSeen,
    endPlayhead: preview[preview.length - 1]?.head
  };
  console.log('PREVIEW_STABLE', JSON.stringify(summary));

  // Repeated seeking while playing (scrub stress) and pause/resume.
  const scrub = await page.evaluate(async () => {
    const samples = [];
    const canvas = document.getElementById('se-canvas');
    const ctx = canvas.getContext('2d');
    const pixel = () => {
      try {
        const data = ctx.getImageData(canvas.width * 0.5, canvas.height * 0.5, 1, 1).data;
        return (data[0] + data[1] + data[2]) / 3;
      } catch (error) {
        return -1;
      }
    };
    window.__VE__.play();
    const targets = [3.2, 0.6, 2.4, 1.1, 3.6, 0.2, 2.9, 1.8];
    for (const target of targets) {
      window.__VE__.preview.seek(target, { keepPlaying: true });
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 45));
        samples.push({ brightness: pixel(), head: window.__VE__.store.playhead });
      }
    }
    window.__VE__.pause();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const pausedBrightness = pixel();
    window.__VE__.play();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const resumedBrightness = pixel();
    window.__VE__.pause();
    return { samples, pausedBrightness, resumedBrightness };
  });
  const scrubBlack = scrub.samples.filter((sample) => sample.brightness >= 0 && sample.brightness < 6);
  console.log(
    'PREVIEW_SCRUB',
    JSON.stringify({
      samples: scrub.samples.length,
      blackFrames: scrubBlack.length,
      pausedBrightness: scrub.pausedBrightness,
      resumedBrightness: scrub.resumedBrightness
    })
  );
  console.log('PREVIEW_ERRORS', JSON.stringify(errors));
});
