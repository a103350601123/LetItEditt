'use strict';

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-cropper/';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(240000);
  await ensureFixtures(browser, baseURL);
});

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
}

async function waitForSupport(page) {
  await page.waitForFunction(() => {
    const state = window.__videoCropper?.getState();
    return Boolean(state && state.supportChecked && !state.supportPending);
  }, null, { timeout: 30000 });
}

async function loadVideo(page, name) {
  await page.setInputFiles('[data-file-input]', fixturePath(name));
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__videoCropper?.getState().ready), null, { timeout: 30000 });
  await waitForSupport(page);
}

async function setCrop(page, crop, ratio = 'free') {
  const applied = await page.evaluate(
    ([value, mode]) => window.__videoCropper.setCrop(value, mode),
    [crop, ratio]
  );
  expect(applied).toBe(true);
}

async function setOutputMode(page, mode) {
  await page.selectOption('[data-output-mode]', mode);
}

async function setFormat(page, format) {
  await page.selectOption('[data-format]', format);
}

async function exportVideo(page, timeout = 90000) {
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout });
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
}

async function inspectOutput(page) {
  return page.evaluate(async () => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    const blob = await (await fetch(href)).blob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const duration = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const result = {
      size: blob.size,
      type: blob.type,
      duration,
      width: video ? await video.getDisplayWidth() : null,
      height: video ? await video.getDisplayHeight() : null,
      rotation: video ? await video.getRotation() : null,
      videoCodec: video ? await video.getCodec() : null,
      audioCodec: audio ? await audio.getCodec() : null,
      audioSampleRate: audio ? await audio.getSampleRate() : null,
      audioChannels: audio ? await audio.getNumberOfChannels() : null
    };
    input.dispose();
    return result;
  });
}

async function outputCenterColor(page, time = 0.5) {
  return page.evaluate(async (at) => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const href = document.querySelector('[data-download]').getAttribute('href');
    const blob = await (await fetch(href)).blob();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new MB.CanvasSink(track, { fit: 'contain', alpha: false });
    const wrapped = await sink.getCanvas(at);
    const canvas = wrapped.canvas;
    const context = canvas.getContext('2d');
    const pixel = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    input.dispose();
    return [pixel[0], pixel[1], pixel[2]];
  }, time);
}

function cropRatio(crop) {
  return crop.w / crop.h;
}

async function sourceCenterColor(page, fixtureName, x, y, time = 0.5) {
  return page.evaluate(async ({ fixtureName, x, y, at }) => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const blob = await (await fetch('/tests/fixtures/' + fixtureName)).blob();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new MB.CanvasSink(track, { fit: 'contain', alpha: false });
    const wrapped = await sink.getCanvas(at);
    const canvas = wrapped.canvas;
    const context = canvas.getContext('2d');
    const pixel = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    input.dispose();
    return [pixel[0], pixel[1], pixel[2]];
  }, { fixtureName, x, y, at: time });
}

function colorDistance(first, second) {
  return first.reduce((sum, channel, index) => sum + Math.abs(channel - second[index]), 0);
}

test('serves a complete, indexable tool page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await expect(page).toHaveTitle('Free Online Video Cropper – Crop Videos to Any Size | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-cropper/'
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Crop videos online for free/);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Video Cropper');
  await expect(page.locator('h2').first()).toBeVisible();
  expect(await page.locator('h2').count()).toBeGreaterThan(4);
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Editing');
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('[data-dropzone]')).toContainText('Drag and drop your video here');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  expect(structured.length).toBeGreaterThan(0);
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('loads a real MP4 and reports accurate metadata', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');
  await expect(page.locator('[data-file-meta]')).toContainText('MP4');
  await expect(page.locator('[data-meta-duration]')).toHaveText(/00:04\.0/);
  await expect(page.locator('[data-meta-resolution]')).toHaveText('640 × 360');
  await expect(page.locator('[data-meta-aspect]')).toHaveText('16:9');
  await expect(page.locator('[data-meta-fps]')).toHaveText(/30(\.00)? fps/);
  await expect(page.locator('[data-meta-audio]')).toHaveText(/AAC/);
  await expect(page.locator('[data-meta-audio]')).toHaveText(/48 kHz/);
  await expect(page.locator('[data-meta-rotation]')).toHaveText('None');
  await expect(page.locator('[data-meta-size]')).toContainText('KB');

  const state = await page.evaluate(() => window.__videoCropper.getState());
  expect(state.crop).toEqual({ x: 0, y: 0, w: 640, h: 360 });
  expect(state.outputSize).toEqual({ width: 640, height: 360 });
  await expect(page.locator('[data-crop-x]')).toHaveValue('0');
  await expect(page.locator('[data-crop-width]')).toHaveValue('640');
  await expect(page.locator('[data-format-note]')).toContainText('Available at this size');
  await expect(page.locator('[data-export]')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('accepts drag-and-drop and supports removing the video', async ({ page }) => {
  await openPage(page);

  const dataTransfer = await page.evaluateHandle(async () => {
    const response = await fetch('/tests/fixtures/trim-4s.mp4');
    const blob = await response.blob();
    const file = new File([blob], 'trim-4s.mp4', { type: 'video/mp4' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    return transfer;
  });
  await page.dispatchEvent('[data-dropzone]', 'drop', { dataTransfer });
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__videoCropper?.getState().ready), null, { timeout: 30000 });
  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');

  await page.click('[data-remove-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoCropper.getState().ready)).toBe(false);
});

test('moves and resizes the crop frame with a pointer and the keyboard', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await page.locator('[data-frame]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  const initial = await page.evaluate(() => window.__videoCropper.getState().crop);

  const handle = await page.locator('[data-handle="se"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y + handle.height / 2 - 70, { steps: 8 });
  await page.mouse.up();

  const resized = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(resized.w).toBeLessThan(initial.w - 50);
  expect(resized.h).toBeLessThan(initial.h - 20);
  expect(resized.x).toBeGreaterThanOrEqual(0);
  expect(resized.y).toBeGreaterThanOrEqual(0);
  expect(resized.x + resized.w).toBeLessThanOrEqual(640.5);
  expect(resized.y + resized.h).toBeLessThanOrEqual(360.5);

  const box = await page.locator('[data-crop]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();

  const moved = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(moved.x).toBeGreaterThan(resized.x);
  expect(moved.y).toBeGreaterThan(resized.y);
  expect(moved.w).toBeCloseTo(resized.w, 0);
  expect(moved.h).toBeCloseTo(resized.h, 0);

  await page.locator('[data-crop]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const keyed = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(keyed.x).toBeGreaterThan(moved.x);
  expect(keyed.y).toBeGreaterThan(moved.y + 5);
  expect(keyed.w).toBeCloseTo(moved.w, 0);

  await page.locator('[data-handle="w"]').focus();
  await page.keyboard.press('ArrowLeft');
  const handleKeyed = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(handleKeyed.w).toBeGreaterThan(keyed.w + 0.5);
  expect(handleKeyed.x).toBeLessThan(keyed.x - 0.5);
});

test('keeps numeric crop fields synchronized and rejects invalid values', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await page.click('[data-ratio="free"]');

  await setCrop(page, { x: 100, y: 50, w: 300, h: 200 }, 'free');
  await expect(page.locator('[data-crop-x]')).toHaveValue('100');
  await expect(page.locator('[data-crop-y]')).toHaveValue('50');
  await expect(page.locator('[data-crop-width]')).toHaveValue('300');
  await expect(page.locator('[data-crop-height]')).toHaveValue('200');

  const width = page.locator('[data-crop-width]');
  await width.fill('220');
  await width.press('Enter');
  await expect(page.locator('[data-crop-width]')).toHaveValue('220');
  await expect(page.locator('[data-crop-height]')).toHaveValue('200');

  const x = page.locator('[data-crop-x]');
  await x.fill('600');
  await x.press('Enter');
  await expect(page.locator('[data-crop-validation]')).toBeVisible();
  await expect(page.locator('[data-crop-validation]')).toContainText('X must be between 0 and');
  expect(await page.evaluate(() => window.__videoCropper.getState().crop.x)).toBe(100);

  await width.fill('1000');
  await width.press('Enter');
  await expect(page.locator('[data-crop-validation]')).toContainText('Width must be greater than 0 and no more than 640 px');
  expect(await page.evaluate(() => window.__videoCropper.getState().crop.w)).toBe(220);

  await width.fill('0');
  await width.press('Enter');
  await expect(page.locator('[data-crop-validation]')).toContainText('Width must be greater than 0');

  await width.fill('320');
  await width.press('Enter');
  await expect(page.locator('[data-crop-validation]')).toBeHidden();
  await expect(page.locator('[data-crop-width]')).toHaveValue('320');
  expect(await page.evaluate(() => window.__videoCropper.getState().crop.w)).toBe(320);

  await x.fill('100');
  await x.press('Enter');
  await expect(page.locator('[data-crop-validation]')).toBeHidden();
});

test('fits aspect ratio presets to the largest matching region without stretching', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const presets = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '4:5': 4 / 5,
    '5:4': 5 / 4
  };

  for (const [label, ratio] of Object.entries(presets)) {
    await page.click(`[data-ratio="${label}"]`);
    const crop = await page.evaluate(() => window.__videoCropper.getState().crop);
    expect(cropRatio(crop)).toBeCloseTo(ratio, 2);
    expect(crop.x).toBeGreaterThanOrEqual(-0.01);
    expect(crop.y).toBeGreaterThanOrEqual(-0.01);
    expect(crop.x + crop.w).toBeLessThanOrEqual(640.5);
    expect(crop.y + crop.h).toBeLessThanOrEqual(360.5);
    const note = await page.locator('[data-ratio-note]').textContent();
    expect(note).toContain(`Locked to ${label}`);
  }

  await page.click('[data-ratio="source"]');
  await page.click('[data-ratio="1:1"]');
  const square = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(square.w).toBeCloseTo(360, 0);
  expect(square.h).toBeCloseTo(360, 0);
  expect(square.x).toBeCloseTo(140, 0);
  expect(square.y).toBeCloseTo(0, 0);

  await page.click('[data-ratio="source"]');
  await expect(page.locator('[data-ratio-note]')).toContainText('Original ratio (16:9)');
  expect(await page.evaluate(() => window.__videoCropper.getState().crop)).toEqual({ x: 0, y: 0, w: 640, h: 360 });

  await page.click('[data-ratio="free"]');
  await expect(page.locator('[data-ratio-note]')).toContainText('Freeform');
});

test('fits landscape presets inside a portrait source without stretching', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-portrait.mp4');
  await expect(page.locator('[data-meta-resolution]')).toHaveText('270 × 480');

  await page.click('[data-ratio="16:9"]');
  const wide = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(cropRatio(wide)).toBeCloseTo(16 / 9, 2);
  expect(wide.w).toBeCloseTo(270, 0);
  expect(wide.h).toBeCloseTo(151.88, 1);
  await expect(page.locator('[data-ratio-note]')).toContainText('largest matching area');

  await page.click('[data-ratio="9:16"]');
  const tall = await page.evaluate(() => window.__videoCropper.getState().crop);
  expect(cropRatio(tall)).toBeCloseTo(9 / 16, 2);
  expect(tall.w).toBeCloseTo(270, 0);
  expect(tall.h).toBeCloseTo(480, 0);
});

test('previews exactly the crop region and keeps the mapping when resized', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'crop-quadrants.mp4');
  await setCrop(page, { x: 320, y: 180, w: 320, h: 180 }, 'free');
  await page.locator('[data-frame]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);

  await page.click('[data-mode-preview]');
  await expect(page.locator('[data-overlay]')).toBeHidden();
  await expect(page.locator('[data-preview-badge]')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('[data-frame]').getBoundingClientRect();
    const video = document.querySelector('[data-video]').getBoundingClientRect();
    const state = window.__videoCropper.getState();
    return {
      frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
      video: { left: video.left, top: video.top, width: video.width, height: video.height },
      crop: state.crop,
      meta: { width: state.meta.width, height: state.meta.height }
    };
  });
  const scale = geometry.frame.width / geometry.crop.w;
  expect(geometry.frame.width / geometry.frame.height).toBeCloseTo(320 / 180, 2);
  expect(geometry.video.width).toBeCloseTo(geometry.meta.width * scale, 0);
  expect(geometry.video.height).toBeCloseTo(geometry.meta.height * scale, 0);
  expect(geometry.video.left).toBeCloseTo(geometry.frame.left - geometry.crop.x * scale, 0);
  expect(geometry.video.top).toBeCloseTo(geometry.frame.top - geometry.crop.y * scale, 0);

  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(250);
  const resized = await page.evaluate(() => {
    const frame = document.querySelector('[data-frame]').getBoundingClientRect();
    const video = document.querySelector('[data-video]').getBoundingClientRect();
    const state = window.__videoCropper.getState();
    return {
      frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
      video: { left: video.left, top: video.top, width: video.width, height: video.height },
      crop: state.crop,
      meta: { width: state.meta.width, height: state.meta.height }
    };
  });
  const nextScale = resized.frame.width / resized.crop.w;
  expect(resized.video.width).toBeCloseTo(resized.meta.width * nextScale, 0);
  expect(resized.video.left).toBeCloseTo(resized.frame.left - resized.crop.x * nextScale, 0);
  expect(resized.video.top).toBeCloseTo(resized.frame.top - resized.crop.y * nextScale, 0);

  await page.click('[data-mode-edit]');
  await expect(page.locator('[data-overlay]')).toBeVisible();
  await page.waitForTimeout(200);
  const editGeometry = await page.evaluate(() => {
    const frame = document.querySelector('[data-frame]').getBoundingClientRect();
    const crop = document.querySelector('[data-crop]').getBoundingClientRect();
    const state = window.__videoCropper.getState();
    return { frame, crop, state: state.crop };
  });
  const editScale = editGeometry.frame.width / 640;
  expect(editGeometry.crop.left - editGeometry.frame.left).toBeCloseTo(editGeometry.state.x * editScale, 0);
  expect(editGeometry.crop.width).toBeCloseTo(editGeometry.state.w * editScale, 0);
});

test('exports a genuine cropped MP4 with audio, and the download matches', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setCrop(page, { x: 100, y: 50, w: 300, h: 200 }, 'free');
  await setOutputMode(page, 'original');
  await exportVideo(page);

  await expect(page.locator('[data-result-name]')).toHaveText('trim-4s-cropped.mp4');
  await expect(page.locator('[data-result-format]')).toContainText('MP4');
  await expect(page.locator('[data-result-resolution]')).toHaveText('300 × 200');
  await expect(page.locator('[data-result-audio]')).toHaveText('Preserved');
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:04\.0/);

  const output = await inspectOutput(page);
  expect(output.type).toBe('video/mp4');
  expect(output.videoCodec).toBe('avc');
  expect(output.audioCodec).toBe('aac');
  expect(output.width).toBe(300);
  expect(output.height).toBe(200);
  expect(output.rotation).toBe(0);
  expect(output.audioSampleRate).toBe(48000);
  expect(output.audioChannels).toBe(2);
  expect(output.duration).toBeGreaterThan(3.9);
  expect(output.duration).toBeLessThan(4.2);
  expect(output.size).toBeGreaterThan(1000);

  const state = await page.evaluate(() => window.__videoCropper.getState());
  expect(state.output.size).toBe(output.size);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trim-4s-cropped.mp4');
  const downloadPath = await download.path();
  const bytes = fs.readFileSync(downloadPath);
  expect(bytes.length).toBe(output.size);

  const parsed = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) array[index] = binary.charCodeAt(index);
    const blob = new Blob([array], { type: 'video/mp4' });
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const result = {
      duration: await input.computeDuration(),
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      rotation: await video.getRotation(),
      videoCodec: await video.getCodec(),
      audioCodec: audio ? await audio.getCodec() : null
    };
    input.dispose();
    return result;
  }, bytes.toString('base64'));
  expect(parsed.width).toBe(300);
  expect(parsed.height).toBe(200);
  expect(parsed.rotation).toBe(0);
  expect(parsed.videoCodec).toBe('avc');
  expect(parsed.audioCodec).toBe('aac');

  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('[data-result-video]');
    if (video.readyState < 1) return null;
    return { width: video.videoWidth, height: video.videoHeight, error: video.error?.code ?? null };
  }), { timeout: 15000 }).toEqual({ width: 300, height: 200, error: null });
  expect(consoleErrors).toEqual([]);
});

test('maps each crop quadrant to the correct output pixels', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'crop-quadrants.mp4');

  const quadrants = [
    { name: 'top left', crop: { x: 0, y: 0, w: 320, h: 180 }, test: ([r, g, b]) => r > g + 80 && r > b + 80 },
    { name: 'top right', crop: { x: 320, y: 0, w: 320, h: 180 }, test: ([r, g, b]) => g > r + 80 && g > b + 80 },
    { name: 'bottom left', crop: { x: 0, y: 180, w: 320, h: 180 }, test: ([r, g, b]) => b > r + 80 && b > g + 80 },
    { name: 'bottom right', crop: { x: 320, y: 180, w: 320, h: 180 }, test: ([r, g, b]) => r > 150 && g > 150 && b < 100 }
  ];

  for (const quadrant of quadrants) {
    await setCrop(page, quadrant.crop, 'free');
    await setOutputMode(page, 'original');
    await exportVideo(page);
    const color = await outputCenterColor(page);
    expect(quadrant.test(color), `${quadrant.name} produced ${color}`).toBe(true);
  }
});

test('applies rotation metadata before cropping', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-rotated.mp4');
  await expect(page.locator('[data-meta-resolution]')).toHaveText('360 × 640');
  await expect(page.locator('[data-meta-rotation]')).toHaveText('90°');

  await setCrop(page, { x: 0, y: 0, w: 360, h: 360 }, 'free');
  await setOutputMode(page, 'original');
  await exportVideo(page);
  let output = await inspectOutput(page);
  expect(output.width).toBe(360);
  expect(output.height).toBe(360);
  expect(output.rotation).toBe(0);
  const topColor = await outputCenterColor(page);
  const topSource = await sourceCenterColor(page, 'trim-rotated.mp4', 180, 180);
  expect(colorDistance(topColor, topSource)).toBeLessThan(40);

  await setCrop(page, { x: 0, y: 280, w: 360, h: 360 }, 'free');
  await exportVideo(page);
  output = await inspectOutput(page);
  expect(output.width).toBe(360);
  expect(output.height).toBe(360);
  expect(output.rotation).toBe(0);
  const bottomColor = await outputCenterColor(page);
  const bottomSource = await sourceCenterColor(page, 'trim-rotated.mp4', 180, 460);
  expect(colorDistance(bottomColor, bottomSource)).toBeLessThan(40);
});

test('exports a portrait crop at 720p using the short edge', async ({ page }) => {
  test.setTimeout(120000);
  await openPage(page);
  await loadVideo(page, 'trim-portrait.mp4');
  await setCrop(page, { x: 0, y: 0, w: 270, h: 480 }, 'source');
  await setOutputMode(page, '720');
  await expect(page.locator('[data-output-summary]')).toContainText('720 × 1280');
  await exportVideo(page);

  const output = await inspectOutput(page);
  expect(output.width).toBe(720);
  expect(output.height).toBe(1280);
  expect(output.audioCodec).toBe('aac');
  expect(output.duration).toBeGreaterThan(1.9);
  expect(output.duration).toBeLessThan(2.2);
  await expect(page.locator('[data-result-resolution]')).toHaveText('720 × 1280');
});

test('exports WebM when the browser supports it', async ({ page }) => {
  test.setTimeout(120000);
  await openPage(page);
  await loadVideo(page, 'crop-quadrants.mp4');
  await expect(page.locator('[data-format] option[value="webm"]')).toBeEnabled();

  await setCrop(page, { x: 320, y: 180, w: 320, h: 180 }, 'free');
  await setFormat(page, 'webm');
  await exportVideo(page);

  const output = await inspectOutput(page);
  expect(output.type).toBe('video/webm');
  expect(output.videoCodec).toBe('vp9');
  expect(output.audioCodec).toBeNull();
  expect(output.width).toBe(320);
  expect(output.height).toBe(180);
  await expect(page.locator('[data-result-name]')).toHaveText('crop-quadrants-cropped.webm');
  await expect(page.locator('[data-result-audio]')).toHaveText('No audio track');
});

test('keeps a silent video silent and never invents audio', async ({ page }) => {
  test.setTimeout(120000);
  await openPage(page);
  await loadVideo(page, 'trim-2s-mute.mp4');
  await expect(page.locator('[data-meta-audio]')).toHaveText('No audio track');

  await setCrop(page, { x: 0, y: 0, w: 480, h: 270 }, 'source');
  await exportVideo(page);

  const output = await inspectOutput(page);
  expect(output.audioCodec).toBeNull();
  expect(output.width).toBe(480);
  expect(output.height).toBe(270);
  await expect(page.locator('[data-result-audio]')).toHaveText('No audio track');
});

test('computes custom and preset output sizes without stretching the crop', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setCrop(page, { x: 0, y: 0, w: 640, h: 360 }, 'source');

  await setOutputMode(page, 'custom');
  await page.locator('[data-custom-width]').fill('481');
  await page.locator('[data-custom-width]').press('Enter');
  await expect(page.locator('[data-custom-width]')).toHaveValue('482');
  const even = await page.evaluate(() => window.__videoCropper.getState());
  expect(even.custom.width % 2).toBe(0);
  expect(even.custom.height % 2).toBe(0);
  expect(even.outputSize.width).toBe(482);
  expect(even.outputSize.height).toBe(272);

  await page.locator('[data-custom-width]').fill('480');
  await page.locator('[data-custom-width]').press('Enter');
  await expect(page.locator('[data-custom-height]')).toHaveValue('270');
  await exportVideo(page);
  let output = await inspectOutput(page);
  expect(output.width).toBe(480);
  expect(output.height).toBe(270);

  await setOutputMode(page, '480');
  await expect(page.locator('[data-output-summary]')).toContainText('854 × 480');
  await exportVideo(page);
  output = await inspectOutput(page);
  expect(output.width).toBe(854);
  expect(output.height).toBe(480);
});

test('exports a full 1080p crop when requested', async ({ page }) => {
  test.setTimeout(240000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setCrop(page, { x: 0, y: 0, w: 640, h: 360 }, 'source');
  await setOutputMode(page, '1080');
  await expect(page.locator('[data-output-summary]')).toContainText('1920 × 1080');
  await exportVideo(page, 180000);

  const output = await inspectOutput(page);
  expect(output.width).toBe(1920);
  expect(output.height).toBe(1080);
  expect(output.audioCodec).toBe('aac');
  expect(output.duration).toBeGreaterThan(3.9);
});

test('cancels an export without producing a file', async ({ page }) => {
  test.setTimeout(120000);
  await openPage(page);
  await loadVideo(page, 'trim-long.mp4');
  await setCrop(page, { x: 0, y: 0, w: 320, h: 180 }, 'free');
  await setOutputMode(page, '1080');
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });

  await page.evaluate(() => {
    window.__videoCropper.startExport();
    setTimeout(() => window.__videoCropper.cancelExport(), 80);
  });
  await page.waitForFunction(() => !window.__videoCropper.getState().exporting, null, { timeout: 30000 });

  const state = await page.evaluate(() => window.__videoCropper.getState());
  expect(state.output).toBeNull();
  await expect(page.locator('[data-global-error]')).toBeVisible();
  await expect(page.locator('[data-global-error]')).toContainText(/canceled/i);
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-cancel]')).toBeHidden();
  await expect(page.locator('[data-progress]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeEnabled();
});

test('accepts MOV, M4V and MKV inputs and exports MP4', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);

  const inputs = [
    ['trim-sample.m4v', /MP4/i],
    ['trim-mov.mov', /QuickTime|MOV/i],
    ['trim-mkv.mkv', /Matroska|MKV/i]
  ];

  for (const [name, container] of inputs) {
    await loadVideo(page, name);
    await expect(page.locator('[data-file-name]')).toHaveText(name);
    await expect(page.locator('[data-file-meta]')).toContainText(container);
    expect(await page.evaluate(() => window.__videoCropper.getState().ready)).toBe(true);
  }

  await setCrop(page, { x: 0, y: 0, w: 320, h: 180 }, 'free');
  await setFormat(page, 'mp4');
  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.type).toBe('video/mp4');
  expect(output.videoCodec).toBe('avc');
  expect(output.audioCodec).toBe('aac');
  expect(output.width).toBe(320);
  expect(output.height).toBe(180);
  await expect(page.locator('[data-result-name]')).toHaveText('trim-mkv-cropped.mp4');
});

test('rejects unsupported, corrupted, audio-only and empty files with clear errors', async ({ page }) => {
  await openPage(page);

  async function attempt(file, pattern) {
    await page.setInputFiles('[data-file-input]', file);
    await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-global-error]')).toContainText(pattern);
    await expect(page.locator('[data-editor]')).toBeHidden();
    await expect(page.locator('[data-dropzone]')).toBeVisible();
    expect(await page.evaluate(() => window.__videoCropper.getState().ready)).toBe(false);
  }

  await attempt(fixturePath('trim-not-video.avi'), /Unsupported file type/);
  await attempt(fixturePath('trim-corrupt.mp4'), /could not be read as a supported video/i);
  await attempt(fixturePath('trim-audio-only.mp4'), /No video track/i);
  await attempt(fixturePath('trim-audio-only.m4a'), /Unsupported file type/);
  await attempt({ name: 'empty.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) }, /empty/i);
});

test('releases object URLs when removing a video and starting a new crop', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    window.__objectUrls = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      window.__objectUrls.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__objectUrls.revoked.push(url);
      return revoke(url);
    };
  });

  await openPage(page);
  await loadVideo(page, 'crop-quadrants.mp4');
  const sourceUrl = await page.evaluate(() => document.querySelector('[data-video]').getAttribute('src'));
  expect(sourceUrl).toMatch(/^blob:/);

  await page.click('[data-remove-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  expect(await page.evaluate(() => window.__objectUrls.revoked)).toContain(sourceUrl);

  await loadVideo(page, 'crop-quadrants.mp4');
  await setCrop(page, { x: 0, y: 0, w: 320, h: 180 }, 'free');
  await exportVideo(page);
  const outputUrl = await page.evaluate(() => window.__videoCropper.getOutputUrl());
  expect(outputUrl).toMatch(/^blob:/);

  await page.click('[data-new-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-result]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoCropper.getState().output)).toBeNull();
  expect(await page.evaluate(() => window.__objectUrls.revoked)).toContain(outputUrl);
});

for (const width of [320, 360, 375, 390, 430, 768]) {
  test(`fits the cropper into a ${width}px viewport`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      await page.setInputFiles('[data-file-input]', fixturePath('trim-4s.mp4'));
      await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.__videoCropper?.getState().ready), null, { timeout: 30000 });
      await waitForSupport(page);

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowing = [];
        document.querySelectorAll('body *').forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1)) {
            overflowing.push(element.tagName + '.' + String(element.className || ''));
          }
        });
        const frame = document.querySelector('[data-frame]').getBoundingClientRect();
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          overflowing: overflowing.slice(0, 5),
          frameWidth: frame.width,
          frameRight: frame.right
        };
      });
      expect(layout.overflow).toBe(0);
      expect(layout.overflowing).toEqual([]);
      expect(layout.frameWidth).toBeGreaterThan(100);
      expect(layout.frameRight).toBeLessThanOrEqual(width + 1);

      await expect(page.locator('[data-player]')).toBeVisible();
      await expect(page.locator('[data-crop]')).toBeVisible();
      await expect(page.locator('[data-export]')).toBeVisible();
      await expect(page.locator('[data-ratio-buttons] button')).toHaveCount(10);

      if (width === 375) {
        await page.click('[data-ratio="1:1"]');
        await page.locator('[data-frame]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const before = await page.evaluate(() => window.__videoCropper.getState().crop);
        await page.evaluate(() => {
          const crop = document.querySelector('[data-crop]');
          const overlay = document.querySelector('[data-overlay]');
          const rect = crop.getBoundingClientRect();
          const startX = rect.left + rect.width / 2;
          const startY = rect.top + rect.height / 2;
          const options = (x, y) => ({
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: x,
            clientY: y
          });
          crop.dispatchEvent(new PointerEvent('pointerdown', options(startX, startY)));
          overlay.dispatchEvent(new PointerEvent('pointermove', options(startX + 24, startY + 8)));
          overlay.dispatchEvent(new PointerEvent('pointerup', options(startX + 24, startY + 8)));
        });
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => window.__videoCropper.getState().crop);
        expect(after.x).toBeGreaterThan(before.x);
        expect(after.w).toBeCloseTo(before.w, 0);
      }
    } finally {
      await context.close();
    }
  });
}
