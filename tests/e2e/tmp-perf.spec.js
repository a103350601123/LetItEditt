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

test('baseline 1080p mp4 export', async ({ page }) => {
  test.setTimeout(600000);
  await openEditor(page);
  await uploadVideo(page, 'trim-4s.mp4');
  const info = await page.evaluate(() => {
    const asset = window.__VE__.media.list()[0];
    return {
      name: asset.name,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      project: window.__VE__.state().dimensions
    };
  });
  console.log('ASSET', JSON.stringify(info));
  const exported = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.__VE__.exportNow({
      format: 'mp4',
      resolution: 'project',
      quality: 'balanced',
      includeAudio: true
    });
    return { wallMs: performance.now() - started, meta: result.meta, size: result.blob.size };
  });
  console.log('EXPORT', JSON.stringify(exported));
});

test('baseline long asset metadata and 720p export', async ({ page }) => {
  test.setTimeout(600000);
  await openEditor(page);
  await uploadVideo(page, 'trim-long.mp4');
  const info = await page.evaluate(() => {
    const asset = window.__VE__.media.list()[0];
    return {
      name: asset.name,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      project: window.__VE__.state().dimensions
    };
  });
  console.log('LONG_ASSET', JSON.stringify(info));
  const exported = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.__VE__.exportNow({
      format: 'mp4',
      resolution: '720',
      quality: 'balanced',
      includeAudio: true
    });
    return { wallMs: performance.now() - started, meta: result.meta, size: result.blob.size };
  });
  console.log('LONG_EXPORT', JSON.stringify(exported));
});
