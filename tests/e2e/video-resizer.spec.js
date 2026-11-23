'use strict';

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-resizer/';

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
    const state = window.__videoResizer?.getState();
    return Boolean(state && state.supportChecked && !state.supportPending);
  }, null, { timeout: 30000 });
}

async function loadVideo(page, name) {
  await page.setInputFiles('[data-file-input]', fixturePath(name));
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__videoResizer?.getState().ready), null, { timeout: 30000 });
  await waitForSupport(page);
}

async function exportVideo(page, timeout = 90000) {
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout });
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
}

async function inspectOutput(page) {
  return page.evaluate(async () => {
    const href = window.__videoResizer.getOutputUrl();
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

async function sampleOutput(page, points, time = 0.5) {
  return page.evaluate(async ({ samples, at }) => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const href = window.__videoResizer.getOutputUrl();
    const blob = await (await fetch(href)).blob();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new MB.CanvasSink(track, { fit: 'contain', alpha: false });
    const wrapped = await sink.getCanvas(at);
    if (!wrapped) {
      input.dispose();
      throw new Error('No output frame was available.');
    }
    const canvas = wrapped.canvas;
    const context = canvas.getContext('2d');
    const pixels = samples.map(([x, y]) =>
      Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3)
    );
    const dims = { width: canvas.width, height: canvas.height };
    input.dispose();
    return { dims, pixels };
  }, { samples: points, at: time });
}

async function audioStats(page) {
  return page.evaluate(async () => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const href = window.__videoResizer.getOutputUrl();
    const blob = await (await fetch(href)).blob();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      input.dispose();
      return null;
    }
    const sink = new MB.AudioSampleSink(track);
    let sum = 0;
    let count = 0;
    let firstTimestamp = null;
    for await (const sample of sink.samples(0, 1)) {
      const frames = sample.numberOfFrames;
      const plane = new Float32Array(frames);
      sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      for (let index = 0; index < frames; index += 1) sum += plane[index] * plane[index];
      count += frames;
      if (firstTimestamp === null) firstTimestamp = sample.timestamp;
      sample.close();
    }
    input.dispose();
    return { rms: Math.sqrt(sum / Math.max(1, count)), firstTimestamp };
  });
}

function colorDistance(first, second) {
  return first.reduce((sum, channel, index) => sum + Math.abs(channel - second[index]), 0);
}

function expectColorNear(pixel, expected, tolerance = 80) {
  expect(colorDistance(pixel, expected)).toBeLessThan(tolerance);
}

async function readState(page) {
  return page.evaluate(() => window.__videoResizer.getState());
}

test('serves a complete, indexable tool page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await expect(page).toHaveTitle('Free Online Video Resizer – Resize Video to Any Resolution | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-resizer/'
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Resize videos online for free/);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Video Resizer');
  await expect(page.locator('h2').first()).toBeVisible();
  expect(await page.locator('h2').count()).toBeGreaterThan(5);
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Editing');
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('[data-dropzone]')).toContainText('Drag and drop your video here');
  await expect(page.locator('[data-dropzone]')).toContainText('MP4, WebM, MOV, M4V or MKV');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  expect(structured.length).toBeGreaterThan(0);
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('exposes labelled controls, a skip link and internal tool links', async ({ page }) => {
  await openPage(page);

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main-content');

  const unnamed = await page.evaluate(() => {
    const scope = document.querySelector('[data-app]');
    return Array.from(scope.querySelectorAll('input, select, button, a[href]'))
      .filter((element) => {
        if (element.type === 'hidden') return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const labels = element.labels
          ? Array.from(element.labels).map((label) => label.textContent.trim()).join(' ')
          : '';
        const name = (
          element.getAttribute('aria-label') ||
          labels ||
          element.textContent ||
          element.getAttribute('title') ||
          ''
        ).trim();
        return name.length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 100));
  });
  expect(unnamed).toEqual([]);

  const related = page.locator('.vr-side-content a');
  await expect(related.filter({ hasText: 'Video Trimmer' })).toHaveAttribute(
    'href',
    '/media-and-motion/video-trimmer/'
  );
  await expect(related.filter({ hasText: 'Video Cropper' })).toHaveAttribute(
    'href',
    '/media-and-motion/video-cropper/'
  );
  await expect(related.filter({ hasText: 'Video Merger' })).toHaveAttribute(
    'href',
    '/media-and-motion/video-merger/'
  );
});

test('is linked from the video editing category and the sitemap', async ({ page, baseURL }) => {
  const category = await page.request.get(baseURL + '/categories/video-editing/');
  expect(category.ok()).toBe(true);
  const html = await category.text();
  expect(html).toContain('href="/media-and-motion/video-resizer/"');
  expect(html).toContain('Video Resizer');

  const sitemap = await page.request.get(baseURL + '/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('https://letitedit.com/media-and-motion/video-resizer/');
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

  const state = await readState(page);
  expect(state.outputSize).toEqual({ width: 640, height: 360 });
  expect(state.preset).toBe('original');
  expect(state.aspect).toBe('original');
  expect(state.aspectLocked).toBe(true);
  await expect(page.locator('[data-width]')).toHaveValue('640');
  await expect(page.locator('[data-height]')).toHaveValue('360');
  await expect(page.locator('[data-format-note]')).toContainText('Available at this size');
  await expect(page.locator('[data-export]')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('plays the source preview and draws an output frame', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.click('[data-play]');
  await page.waitForFunction(() => {
    const video = document.querySelector('[data-video]');
    return video && !video.paused && video.currentTime > 0.1;
  }, null, { timeout: 15000 });
  await expect(page.locator('[data-player]')).toHaveClass(/is-playing/);
  await page.click('[data-play]');
  await expect(page.locator('[data-player]')).toHaveClass(/is-paused/);

  const preview = await readState(page);
  expect(preview.preview.width).toBeGreaterThan(0);
  expect(preview.preview.height).toBeGreaterThan(0);
  expect(preview.preview.width / preview.preview.height).toBeCloseTo(16 / 9, 2);
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
  await page.waitForFunction(() => Boolean(window.__videoResizer?.getState().ready), null, { timeout: 30000 });
  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');

  await page.click('[data-remove-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoResizer.getState().ready)).toBe(false);
});

test('applies every resolution preset to the source aspect', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const expected = {
    '2160': { width: 3840, height: 2160 },
    '1440': { width: 2560, height: 1440 },
    '1080': { width: 1920, height: 1080 },
    '720': { width: 1280, height: 720 },
    '480': { width: 854, height: 480 },
    '360': { width: 640, height: 360 },
    '240': { width: 426, height: 240 },
    original: { width: 640, height: 360 }
  };

  for (const [preset, dims] of Object.entries(expected)) {
    await page.evaluate((value) => window.__videoResizer.setPreset(value), preset);
    const state = await readState(page);
    expect(state.preset).toBe(preset);
    expect(state.outputSize).toEqual(dims);
    await expect(page.locator(`[data-preset="${preset}"]`)).toHaveAttribute('aria-pressed', 'true');
  }

  await page.click('[data-preset="720"]');
  const state = await readState(page);
  expect(state.outputSize).toEqual({ width: 1280, height: 720 });
  await expect(page.locator('[data-width]')).toHaveValue('1280');
  await expect(page.locator('[data-height]')).toHaveValue('720');
  await expect(page.locator('[data-output-summary]')).toContainText('1280 × 720');
});

test('adapts the short edge to every aspect ratio without stretching', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.evaluate(() => window.__videoResizer.setPreset('1080'));

  const expected = {
    '16:9': { width: 1920, height: 1080 },
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '4:3': { width: 1440, height: 1080 },
    '3:2': { width: 1620, height: 1080 },
    '2:3': { width: 1080, height: 1620 },
    '4:5': { width: 1080, height: 1350 },
    original: { width: 1920, height: 1080 }
  };

  for (const [aspect, dims] of Object.entries(expected)) {
    await page.evaluate((value) => window.__videoResizer.setAspect(value), aspect);
    const state = await readState(page);
    expect(state.aspect).toBe(aspect);
    expect(state.outputSize).toEqual(dims);
    expect(state.aspectLocked).toBe(true);
  }

  await page.evaluate(() => window.__videoResizer.setAspect('9:16'));
  const portrait = await readState(page);
  expect(portrait.preview.height).toBeGreaterThan(portrait.preview.width);

  await page.evaluate(() => window.__videoResizer.setAspect('custom'));
  const custom = await readState(page);
  expect(custom.aspect).toBe('custom');
  expect(custom.aspectLocked).toBe(false);
  await expect(page.locator('[data-aspect-lock]')).not.toBeChecked();

  await page.evaluate(() => window.__videoResizer.setSize(500, 500));
  const sized = await readState(page);
  expect(sized.outputSize).toEqual({ width: 500, height: 500 });
  expect(sized.preset).toBe('custom');
});

test('locks and unlocks the aspect ratio through the size fields', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.fill('[data-width]', '1280');
  await page.press('[data-width]', 'Enter');
  let state = await readState(page);
  expect(state.outputSize).toEqual({ width: 1280, height: 720 });
  await expect(page.locator('[data-height]')).toHaveValue('720');
  await expect(page.locator('[data-aspect-lock]')).toBeChecked();

  await page.uncheck('[data-aspect-lock]');
  await page.fill('[data-height]', '500');
  await page.press('[data-height]', 'Enter');
  state = await readState(page);
  expect(state.outputSize).toEqual({ width: 1280, height: 500 });
  expect(state.aspectLocked).toBe(false);

  await page.fill('[data-width]', '501');
  await page.press('[data-width]', 'Enter');
  state = await readState(page);
  expect(state.outputSize).toEqual({ width: 502, height: 500 });

  await page.fill('[data-width]', '5000');
  await page.press('[data-width]', 'Enter');
  await expect(page.locator('[data-size-validation]')).toBeVisible();
  await expect(page.locator('[data-size-validation]')).toContainText('between 2 and 4096');
  state = await readState(page);
  expect(state.outputSize).toEqual({ width: 502, height: 500 });
});

test('shows an output-size estimate only for an explicit custom bitrate', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await expect(page.locator('[data-size-estimate]')).toBeHidden();
  await page.evaluate(() => window.__videoResizer.setQuality('custom'));
  await expect(page.locator('[data-bitrate-field]')).toBeVisible();
  await expect(page.locator('[data-size-estimate]')).toBeVisible();
  await expect(page.locator('[data-size-estimate]')).toContainText('Estimated output');
  await expect(page.locator('[data-size-estimate]')).toContainText('8 Mbps');

  await page.evaluate(() => window.__videoResizer.setBitrate(4));
  await expect(page.locator('[data-size-estimate]')).toContainText('4 Mbps');

  await page.evaluate(() => window.__videoResizer.setQuality('high'));
  await expect(page.locator('[data-size-estimate]')).toBeHidden();
  await expect(page.locator('[data-bitrate-field]')).toBeHidden();
});

test('exports a real resized MP4 with audio and actual dimensions', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await page.evaluate(() => {
    window.__videoResizer.setPreset('720');
    window.__videoResizer.setQuality('balanced');
  });
  await exportVideo(page);

  const output = await inspectOutput(page);
  expect(output.width).toBe(1280);
  expect(output.height).toBe(720);
  expect(output.rotation).toBe(0);
  expect(output.videoCodec).toBe('avc');
  expect(output.audioCodec).toBe('aac');
  expect(output.audioSampleRate).toBe(48000);
  expect(output.audioChannels).toBe(2);
  expect(output.duration).toBeGreaterThan(3.9);
  expect(output.duration).toBeLessThan(4.2);
  expect(output.size).toBeGreaterThan(1000);

  const state = await readState(page);
  expect(state.output.size).toBe(output.size);
  expect(state.output.width).toBe(1280);
  expect(state.output.height).toBe(720);
  expect(state.output.hasAudio).toBe(true);

  await expect(page.locator('[data-result-resolution]')).toHaveText('1280 × 720');
  await expect(page.locator('[data-result-audio]')).toHaveText('Preserved');
  await expect(page.locator('[data-result-size]')).toContainText(/KB|MB/);
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:04\.0/);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trim-4s-1280x720.mp4');
  const downloadPath = await download.path();
  const bytes = fs.readFileSync(downloadPath);
  expect(bytes.length).toBe(output.size);

  const audio = await audioStats(page);
  expect(audio).not.toBeNull();
  expect(audio.rms).toBeGreaterThan(0.02);
  expect(Math.abs(audio.firstTimestamp)).toBeLessThan(0.1);

  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('[data-result-video]');
    if (!video || video.readyState < 1) return null;
    return { width: video.videoWidth, height: video.videoHeight, error: video.error ? video.error.code : null };
  }), { timeout: 15000 }).toEqual({ width: 1280, height: 720, error: null });

  expect(consoleErrors).toEqual([]);
});

test('exports the 4K preset at the full 3840 × 2160 size', async ({ page }) => {
  test.setTimeout(240000);
  await openPage(page);
  await loadVideo(page, 'trim-short.mp4');

  await page.evaluate(() => window.__videoResizer.setPreset('2160'));
  await expect(page.locator('[data-output-summary]')).toContainText('3840 × 2160');
  await expect(page.locator('[data-format-note]')).toContainText('Available at this size');
  await exportVideo(page, 180000);

  const output = await inspectOutput(page);
  expect(output.width).toBe(3840);
  expect(output.height).toBe(2160);
  expect(output.videoCodec).toBe('avc');
  expect(output.audioCodec).toBe('aac');
  expect(output.duration).toBeGreaterThan(0.5);
  expect(output.duration).toBeLessThan(0.9);
  await expect(page.locator('[data-result-resolution]')).toHaveText('3840 × 2160');
});

test('pads with the chosen background in Fit mode without stretching', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'crop-quadrants.mp4');

  await page.evaluate(() => {
    window.__videoResizer.setAspect('1:1');
    window.__videoResizer.setPreset('360');
    window.__videoResizer.setFit('fit');
    window.__videoResizer.setBackground('black');
  });
  let state = await readState(page);
  expect(state.outputSize).toEqual({ width: 360, height: 360 });
  expect(state.fit).toBe('fit');

  await exportVideo(page);
  let output = await inspectOutput(page);
  expect(output.width).toBe(360);
  expect(output.height).toBe(360);

  let sample = await sampleOutput(page, [[180, 20], [90, 200]]);
  expect(sample.dims).toEqual({ width: 360, height: 360 });
  expectColorNear(sample.pixels[0], [0, 0, 0], 45);
  expectColorNear(sample.pixels[1], [37, 99, 235], 90);

  await page.evaluate(() => window.__videoResizer.setBackground('white'));
  state = await readState(page);
  expect(state.background).toEqual({ mode: 'white', color: '#ffffff' });
  await exportVideo(page);

  sample = await sampleOutput(page, [[180, 20], [180, 340]]);
  expectColorNear(sample.pixels[0], [255, 255, 255], 40);
  expectColorNear(sample.pixels[1], [255, 255, 255], 40);

  await page.evaluate(() => window.__videoResizer.setBackground('custom', '#2563eb'));
  state = await readState(page);
  expect(state.background).toEqual({ mode: 'custom', color: '#2563eb' });
  await expect(page.locator('[data-background-color]')).toHaveValue('#2563eb');
  await expect(page.locator('[data-preview-mode]')).toContainText('#2563eb');
});

test('fills and crops the frame in Fill mode without distortion', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'crop-quadrants.mp4');

  await page.evaluate(() => {
    window.__videoResizer.setAspect('1:1');
    window.__videoResizer.setPreset('360');
    window.__videoResizer.setFit('fill');
  });
  const state = await readState(page);
  expect(state.fit).toBe('fill');
  expect(state.outputSize).toEqual({ width: 360, height: 360 });

  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.width).toBe(360);
  expect(output.height).toBe(360);

  const sample = await sampleOutput(page, [[6, 6], [354, 6], [6, 354], [354, 354]]);
  expectColorNear(sample.pixels[0], [220, 38, 38], 95);
  expectColorNear(sample.pixels[1], [22, 163, 74], 95);
  expectColorNear(sample.pixels[2], [37, 99, 235], 95);
  expectColorNear(sample.pixels[3], [234, 179, 8], 95);
});

test('exports WebM without inventing an audio track', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-2s-mute.mp4');

  await page.evaluate(() => {
    window.__videoResizer.setPreset('360');
    window.__videoResizer.setFormat('webm');
  });
  const state = await readState(page);
  expect(state.outputSize).toEqual({ width: 640, height: 360 });
  expect(state.format).toBe('webm');

  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.type).toBe('video/webm');
  expect(output.width).toBe(640);
  expect(output.height).toBe(360);
  expect(output.videoCodec).toBe('vp9');
  expect(output.audioCodec).toBeNull();
  expect(output.duration).toBeGreaterThan(1.9);
  expect(output.duration).toBeLessThan(2.2);

  await expect(page.locator('[data-result-format]')).toContainText('WebM');
  await expect(page.locator('[data-result-audio]')).toHaveText('No audio track');
  await expect(page.locator('[data-result-name]')).toHaveText('trim-2s-mute-640x360.webm');
  await expect(page.locator('[data-download]')).toBeEnabled();
});

test('preserves variable frame timing instead of forcing a fixed rate', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);

  const base64 = await page.evaluate(async () => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const canvas = new OffscreenCanvas(320, 180);
    const context = canvas.getContext('2d');
    const target = new MB.BufferTarget();
    const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
    const source = new MB.CanvasSource(canvas, { codec: 'avc', quality: new MB.Quality('medium') });
    output.addVideoTrack(source);
    await output.start();
    const stamps = [0, 0.08, 0.2, 0.28, 0.5, 0.9, 1.2, 1.7, 1.75, 2.0];
    for (let index = 0; index < stamps.length; index += 1) {
      context.fillStyle = ['#dc2626', '#16a34a', '#2563eb', '#eab308'][index % 4];
      context.fillRect(0, 0, 320, 180);
      const end = index + 1 < stamps.length ? stamps[index + 1] : 2.3;
      await source.add(stamps[index], end - stamps[index]);
    }
    await output.finalize();
    const bytes = new Uint8Array(target.buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  });

  await page.setInputFiles('[data-file-input]', {
    name: 'vfr-source.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(base64, 'base64')
  });
  await page.waitForFunction(() => Boolean(window.__videoResizer?.getState().ready), null, { timeout: 30000 });
  await waitForSupport(page);

  const state = await readState(page);
  expect(state.meta.fpsVariable).toBe(true);
  expect(state.meta.duration).toBeCloseTo(2.3, 1);

  await exportVideo(page);

  const timestamps = await page.evaluate(async () => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const href = window.__videoResizer.getOutputUrl();
    const blob = await (await fetch(href)).blob();
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new MB.CanvasSink(track);
    const times = [];
    for await (const frame of sink.canvases(0, 3)) {
      times.push(Math.round(frame.timestamp * 1000) / 1000);
    }
    input.dispose();
    return times;
  });

  expect(timestamps).toEqual([0, 0.08, 0.2, 0.28, 0.5, 0.9, 1.2, 1.7, 1.75, 2]);
  const gaps = timestamps.slice(1).map((time, index) => Math.round((time - timestamps[index]) * 1000));
  expect(new Set(gaps).size).toBeGreaterThan(2);
});

test('applies rotation metadata and keeps portrait sources un-stretched', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-rotated.mp4');

  await expect(page.locator('[data-meta-resolution]')).toHaveText('360 × 640');
  await expect(page.locator('[data-meta-rotation]')).toHaveText('90°');

  await page.evaluate(() => window.__videoResizer.setPreset('original'));
  let state = await readState(page);
  expect(state.outputSize).toEqual({ width: 360, height: 640 });

  await page.evaluate(() => window.__videoResizer.setSize(180, 320));
  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.width).toBe(180);
  expect(output.height).toBe(320);
  expect(output.rotation).toBe(0);
  expect(output.duration).toBeGreaterThan(1.9);
  expect(output.duration).toBeLessThan(2.2);

  await page.click('[data-remove-video]');
  await loadVideo(page, 'trim-portrait.mp4');
  await page.evaluate(() => window.__videoResizer.setPreset('720'));
  state = await readState(page);
  expect(state.outputSize).toEqual({ width: 720, height: 1280 });
  await expect(page.locator('[data-output-summary]')).toContainText('720 × 1280');
});

test('rejects audio-only, corrupt, unsupported and empty files with clear errors', async ({ page }) => {
  await openPage(page);

  await page.setInputFiles('[data-file-input]', fixturePath('trim-audio-only.mp4'));
  await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-global-error]')).toContainText('No video track was found in this file.');

  await page.setInputFiles('[data-file-input]', fixturePath('trim-corrupt.mp4'));
  await expect(page.locator('[data-global-error]')).toContainText(/could not be read as a supported video/i);

  await page.setInputFiles('[data-file-input]', fixturePath('trim-not-video.avi'));
  await expect(page.locator('[data-global-error]')).toContainText('Unsupported file type');

  await page.setInputFiles('[data-file-input]', {
    name: 'empty.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(0)
  });
  await expect(page.locator('[data-global-error]')).toContainText('The file is empty.');

  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
});

test('cancels an export safely and re-enables the controls', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-long.mp4');

  await page.evaluate(() => window.__videoResizer.setPreset('720'));
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });

  await page.click('[data-export]');
  await expect(page.locator('[data-progress]')).toBeVisible();
  await page.click('[data-cancel]');
  await expect(page.locator('[data-global-error]')).toContainText(/canceled/i, { timeout: 30000 });
  await expect(page.locator('[data-progress]')).toBeHidden();
  await expect(page.locator('[data-cancel]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeEnabled();
  await expect(page.locator('[data-result]')).toBeHidden();

  await page.click('[data-remove-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
});

test('resets and resizes another video after an export', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await page.evaluate(() => window.__videoResizer.setPreset('360'));
  await exportVideo(page);
  expect(await inspectOutput(page)).toMatchObject({ width: 640, height: 360 });

  await page.click('[data-new-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoResizer.getState().ready)).toBe(false);

  await loadVideo(page, 'trim-2s-mute.mp4');
  await page.evaluate(() => window.__videoResizer.setPreset('360'));
  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.width).toBe(640);
  expect(output.height).toBe(360);
  expect(output.audioCodec).toBeNull();
});

test('has no horizontal overflow from 320 px to desktop', async ({ page }) => {
  await openPage(page);

  for (const width of [320, 360, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `overflow at ${width}px`).toBe(0);
  }

  await page.setViewportSize({ width: 360, height: 900 });
  await loadVideo(page, 'trim-4s.mp4');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);

  for (const selector of ['[data-export]', '[data-browse]', '[data-width]', '[data-height]', '[data-download]']) {
    const locator = page.locator(selector);
    if (await locator.count()) {
      const box = await locator.first().boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(361);
      }
    }
  }
  await expect(page.locator('[data-export]')).toBeVisible();
});
