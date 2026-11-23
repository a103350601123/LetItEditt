'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-compressor/';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(240000);
  await ensureFixtures(browser, baseURL);
});

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__videoCompressor));
}

async function waitForSupport(page) {
  await page.waitForFunction(() => {
    const state = window.__videoCompressor?.getState();
    return Boolean(state && state.supportChecked && !state.supportPending);
  }, null, { timeout: 30000 });
}

async function loadVideo(page, name) {
  await page.setInputFiles('[data-file-input]', fixturePath(name));
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__videoCompressor?.getState().ready), null, { timeout: 30000 });
  await waitForSupport(page);
}

async function setResolution(page, value) {
  await page.evaluate((resolution) => window.__videoCompressor.setResolution(resolution), value);
  await waitForSupport(page);
}

async function exportVideo(page, timeout = 120000) {
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout });
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
}

async function readState(page) {
  return page.evaluate(() => window.__videoCompressor.getState());
}

async function inspectOutput(page) {
  return page.evaluate(async () => {
    const blob = window.__videoCompressor.getOutputBlob();
    if (!blob) throw new Error('No output blob was available.');
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const duration = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const sampleRate = audio ? await audio.getSampleRate() : null;
    const channels = audio ? await audio.getNumberOfChannels() : null;
    const result = {
      size: blob.size,
      type: blob.type,
      duration,
      width: video ? await video.getDisplayWidth() : null,
      height: video ? await video.getDisplayHeight() : null,
      videoCodec: video ? await video.getCodec() : null,
      audioCodec: audio ? await audio.getCodec() : null,
      audioSampleRate: sampleRate,
      audioChannels: channels
    };
    input.dispose();
    return result;
  });
}

async function countOutputVideoFrames(page) {
  return page.evaluate(async () => {
    const blob = window.__videoCompressor.getOutputBlob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new MB.VideoSampleSink(track);
    let count = 0;
    const times = [];
    for await (const sample of sink.samples()) {
      count += 1;
      times.push(Math.round(sample.timestamp * 1000) / 1000);
      sample.close();
    }
    input.dispose();
    return {
      count,
      first: times.length ? times[0] : null,
      last: times.length ? times[times.length - 1] : null,
      times
    };
  });
}

async function readOutputAudio(page) {
  return page.evaluate(async () => {
    const blob = window.__videoCompressor.getOutputBlob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      input.dispose();
      return null;
    }
    const sampleRate = await track.getSampleRate();
    const sink = new MB.AudioSampleSink(track);
    let frames = 0;
    let first = null;
    let sum = 0;
    for await (const sample of sink.samples()) {
      if (first === null) first = sample.timestamp;
      const plane = new Float32Array(sample.numberOfFrames);
      sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      for (const value of plane) sum += value * value;
      frames += sample.numberOfFrames;
      sample.close();
    }
    const result = {
      firstTimestamp: first,
      duration: frames / sampleRate,
      rms: Math.sqrt(sum / Math.max(1, frames))
    };
    input.dispose();
    return result;
  });
}

async function sampleOutputPixels(page, points, at = 2) {
  return page.evaluate(async ({ samples, timestamp }) => {
    const blob = window.__videoCompressor.getOutputBlob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const sink = new MB.CanvasSink(track, { fit: 'contain', alpha: false });
    const wrapped = await sink.getCanvas(timestamp);
    if (!wrapped) throw new Error('No output frame was available.');
    const context = wrapped.canvas.getContext('2d');
    const pixels = samples.map(([x, y]) =>
      Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3)
    );
    input.dispose();
    return pixels;
  }, { samples: points, timestamp: at });
}

function brightness(pixel) {
  return pixel[0] + pixel[1] + pixel[2];
}

test('serves a complete, indexable tool page', async ({ page }) => {
  const errors = collectErrors(page);
  await openPage(page);

  await expect(page).toHaveTitle('Free Online Video Compressor \u2013 Reduce Video File Size | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-compressor/'
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Compress MP4, WebM, MOV, M4V and MKV videos/);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Video Compressor');
  expect(await page.locator('h2').count()).toBeGreaterThan(5);
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Editing');
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('[data-dropzone]')).toContainText('MP4, WebM, MOV, M4V or MKV');
  await expect(page.locator('[data-dropzone]')).toContainText('2 GB');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(errors).toEqual([]);
});

test('exposes labelled controls, a skip link and internal video links', async ({ page }) => {
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
        const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent.trim()).join(' ') : '';
        const name = (
          element.getAttribute('aria-label') ||
          labels ||
          element.textContent ||
          element.getAttribute('title') ||
          ''
        ).trim();
        return name.length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });
  expect(unnamed).toEqual([]);

  const related = page.locator('.vc-side-content a');
  await expect(related.filter({ hasText: 'Video Trimmer' })).toHaveAttribute('href', '/media-and-motion/video-trimmer/');
  await expect(related.filter({ hasText: 'Video Cropper' })).toHaveAttribute('href', '/media-and-motion/video-cropper/');
  await expect(related.filter({ hasText: 'Video Resizer' })).toHaveAttribute('href', '/media-and-motion/video-resizer/');
  await expect(related.filter({ hasText: 'Video Merger' })).toHaveAttribute('href', '/media-and-motion/video-merger/');

  const faq = page.locator('details.faq-item, .faq-item');
  expect(await faq.count()).toBeGreaterThan(3);
});

test('is linked from the video editing category and the sitemap', async ({ page, baseURL }) => {
  const category = await page.request.get(`${baseURL}/categories/video-editing/`);
  expect(category.ok()).toBe(true);
  const html = await category.text();
  expect(html).toContain('href="/media-and-motion/video-compressor/"');
  expect(html).toContain('Video Compressor');

  const sitemap = await page.request.get(`${baseURL}/sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('https://letitedit.com/media-and-motion/video-compressor/');
});

test('loads a real MP4 and reports accurate metadata and a balanced default', async ({ page }) => {
  const errors = collectErrors(page);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');
  await expect(page.locator('[data-file-meta]')).toContainText('MP4');
  await expect(page.locator('[data-meta-duration]')).toHaveText(/00:04\.0/);
  await expect(page.locator('[data-meta-resolution]')).toHaveText('640 \u00d7 360');
  await expect(page.locator('[data-meta-fps]')).toHaveText(/30(\.00)? fps/);
  await expect(page.locator('[data-meta-video]')).toHaveText('AVC');
  await expect(page.locator('[data-meta-audio]')).toHaveText(/AAC/);
  await expect(page.locator('[data-meta-audio]')).toHaveText(/48 kHz/);
  await expect(page.locator('[data-meta-rotation]')).toHaveText('None');
  await expect(page.locator('[data-meta-size]')).toContainText('KB');
  await expect(page.locator('[data-meta-bitrate]')).toHaveText(/Mbps video/);

  const state = await readState(page);
  expect(state.meta).toMatchObject({ width: 640, height: 360, fps: 30, hasAudio: true, videoDecodable: true });
  expect(state.mode).toBe('balanced');
  expect(state.format).toBe('mp4');
  expect(state.codec).toBe('avc');
  expect(state.resolution).toBe('original');
  expect(state.width).toBe(640);
  expect(state.height).toBe(360);
  expect(state.audioKeep).toBe(true);
  expect(state.support.video['mp4:avc']).toBe(true);
  expect(state.plan.videoBitrate).toBeGreaterThan(0);
  expect(state.plan.videoBitrate).toBeLessThan(state.meta.videoBitrate);

  await expect(page.locator('input[name="vc-mode"][value="balanced"]')).toBeChecked();
  await expect(page.locator('[data-mode-note]')).toContainText('recommended');
  await expect(page.locator('[data-format-note]')).toContainText('Available at this size');
  await expect(page.locator('[data-output-summary]')).toContainText('Balanced');
  await expect(page.locator('[data-export]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('plays the source preview and supports keyboard playback shortcuts', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.click('[data-play]');
  await page.waitForFunction(() => {
    const video = document.querySelector('[data-video]');
    return video && !video.paused && video.currentTime > 0.1;
  }, null, { timeout: 15000 });
  await expect(page.locator('[data-player]')).toHaveClass(/is-playing/);

  await page.locator('[data-player]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-player]')).toHaveClass(/is-paused/);

  await page.keyboard.press('ArrowRight');
  const current = await page.evaluate(() => document.querySelector('[data-video]').currentTime);
  expect(current).toBeGreaterThan(3.5);
  expect(current).toBeLessThanOrEqual(4.02);
  await expect(page.locator('[data-current]')).toHaveText(/00:04/);
});

test('accepts drag-and-drop and removes the loaded video', async ({ page }) => {
  await openPage(page);

  const dataTransfer = await page.evaluateHandle(async () => {
    const response = await fetch('/tests/fixtures/trim-4s.mp4');
    const blob = await response.blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'trim-4s.mp4', { type: 'video/mp4' }));
    return transfer;
  });
  await page.dispatchEvent('[data-dropzone]', 'drop', { dataTransfer });
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__videoCompressor.getState().ready), null, { timeout: 30000 });
  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');

  await page.click('[data-remove-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoCompressor.getState().ready)).toBe(false);
});

test('applies every resolution preset to the source aspect and warns on upscaling', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const expected = {
    '2160': { width: 3840, height: 2160 },
    '1440': { width: 2560, height: 1440 },
    '1080': { width: 1920, height: 1080 },
    '720': { width: 1280, height: 720 },
    '480': { width: 854, height: 480 },
    '360': { width: 640, height: 360 },
    original: { width: 640, height: 360 }
  };

  for (const [preset, dims] of Object.entries(expected)) {
    await setResolution(page, preset);
    const state = await readState(page);
    expect(state.resolution).toBe(preset);
    expect({ width: state.width, height: state.height }).toEqual(dims);
    expect(state.width / state.height).toBeCloseTo(16 / 9, 1);
  }

  await setResolution(page, '1080');
  await expect(page.locator('[data-upscale]')).toBeVisible();
  await expect(page.locator('[data-upscale]')).toContainText('Upscaling cannot add detail');

  await setResolution(page, '360');
  await expect(page.locator('[data-upscale]')).toBeHidden();
  await expect(page.locator('[data-size-note]')).toContainText('preserving the source aspect ratio');
});

test('handles custom dimensions, aspect lock and letterboxing without stretching', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await setResolution(page, '720');
  expect(await page.evaluate(() => window.__videoCompressor.setSize(400, 400))).toBe(true);
  let state = await readState(page);
  expect(state.aspectLocked).toBe(false);
  expect({ width: state.width, height: state.height }).toEqual({ width: 400, height: 400 });
  await expect(page.locator('[data-width]')).toHaveValue('400');
  await expect(page.locator('[data-height]')).toHaveValue('400');
  await expect(page.locator('[data-size-note]')).toContainText('letterboxed, never stretched');

  await page.evaluate(() => window.__videoCompressor.setAspectLock(true));
  state = await readState(page);
  expect(state.aspectLocked).toBe(true);
  expect(state.height).toBe(226);
  await waitForSupport(page);

  await page.evaluate(() => window.__videoCompressor.setSize(320, 320));
  await waitForSupport(page);
  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output).toMatchObject({ width: 320, height: 320 });

  const [top, middle, bottom] = await sampleOutputPixels(page, [[160, 12], [160, 160], [160, 308]], 2);
  expect(brightness(top)).toBeLessThan(30);
  expect(brightness(bottom)).toBeLessThan(30);
  expect(brightness(middle)).toBeGreaterThan(30);
});

test('exposes only genuine container and codec combinations', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const mp4Codecs = await page.$$eval('[data-codec] option', (options) =>
    options.map((option) => ({ value: option.value, text: option.textContent.trim() }))
  );
  expect(mp4Codecs).toEqual([{ value: 'avc', text: 'H.264 (AVC)' }]);

  await page.selectOption('[data-format]', 'webm');
  await waitForSupport(page);
  const webmCodecs = await page.$$eval('[data-codec] option', (options) =>
    options.map((option) => option.value)
  );
  expect(webmCodecs).toEqual(['vp9', 'vp8']);
  await expect(page.locator('[data-format]')).toHaveValue('webm');
  await expect(page.locator('[data-audio-codec]')).toContainText('Opus');

  await page.selectOption('[data-format]', 'mp4');
  await waitForSupport(page);
  await expect(page.locator('[data-audio-codec]')).toContainText('AAC');
  await expect(page.locator('[data-codec]')).toHaveValue('avc');
});

test('mode presets change the planned bitrate in the expected order', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const plan = {};
  for (const mode of ['smallest', 'balanced', 'high']) {
    await page.check(`input[name="vc-mode"][value="${mode}"]`);
    const state = await readState(page);
    expect(state.mode).toBe(mode);
    plan[mode] = state.plan.videoBitrate;
    await expect(page.locator('[data-output-summary]')).toContainText(
      { smallest: 'Smallest File', balanced: 'Balanced', high: 'High Quality' }[mode]
    );
  }
  expect(plan.high).toBeGreaterThan(plan.balanced);
  expect(plan.balanced).toBeGreaterThan(plan.smallest);
  expect(plan.high).toBeLessThanOrEqual(373796 * 0.9 + 1);

  await page.check('input[name="vc-mode"][value="advanced"]');
  await expect(page.locator('[data-advanced]')).toBeVisible();
  const advanced = await readState(page);
  expect(advanced.mode).toBe('advanced');
  // The advanced panel is seeded from the mode that was active before it.
  expect(advanced.bitrateMbps).toBeCloseTo(plan.high / 1000000, 1);
  await expect(page.locator('[data-advanced-note]')).toContainText('replace the mode presets');
});

test('exports a real MP4 with audio, measured sizes, percentages and a working download', async ({ page }) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const before = (await readState(page)).file.size;
  await exportVideo(page);
  const state = await readState(page);
  expect(state.output).toBeTruthy();
  expect(state.output.mimeType).toBe('video/mp4');
  expect(state.output.filename).toMatch(/trim-4s-compressed-640x360\.mp4$/);
  expect(state.output.width).toBe(640);
  expect(state.output.height).toBe(360);
  expect(state.output.hasAudio).toBe(true);
  expect(state.output.videoCodec).toBe('avc');
  expect(state.output.audioCodec).toBe('aac');
  expect(state.output.duration).toBeCloseTo(4.0107, 1);
  expect(state.output.size).toBeLessThan(before);
  expect(state.output.saved).toBe(before - state.output.size);
  expect(state.output.percent).toBeCloseTo(((before - state.output.size) / before) * 100, 3);

  const output = await inspectOutput(page);
  expect(output.size).toBe(state.output.size);
  expect(output.type).toBe('video/mp4');
  expect(output.duration).toBeCloseTo(4.0107, 1);
  expect(output.width).toBe(640);
  expect(output.height).toBe(360);
  expect(output.videoCodec).toBe('avc');
  expect(output.audioCodec).toBe('aac');
  expect(output.audioSampleRate).toBe(48000);
  expect(output.audioChannels).toBe(2);

  // The result panel reports the same measured numbers.
  const percentText = await page.locator('[data-result-percent]').textContent();
  expect(percentText).toMatch(/% smaller/);
  expect(Number.parseFloat(percentText)).toBeCloseTo(state.output.percent, 1);
  await expect(page.locator('[data-result-before]')).toHaveText('240 KB');
  await expect(page.locator('[data-result-after]')).toHaveText(/1[0-9][0-9] KB|\d KB/);
  await expect(page.locator('[data-result-saved]')).toContainText('saved');
  await expect(page.locator('[data-result-format]')).toContainText('H.264 + AAC');
  await expect(page.locator('[data-result-resolution]')).toHaveText('640 \u00d7 360');
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:04/);
  await expect(page.locator('[data-result-audio]')).toContainText('AAC');
  await expect(page.locator('[data-result-mode]')).toHaveText('Balanced');
  await expect(page.locator('[data-result-warning]')).toBeHidden();
  await expect(page.locator('[data-compare]')).not.toHaveClass(/is-increase/);

  // Audio starts at zero and does not drift away from the video duration.
  const audio = await readOutputAudio(page);
  expect(audio).not.toBeNull();
  expect(audio.firstTimestamp).toBeLessThan(0.05);
  expect(audio.duration).toBeCloseTo(state.output.duration, 1);
  expect(audio.rms).toBeGreaterThan(0.001);

  // The compressed file plays in the result element.
  await page.evaluate(() => {
    const video = document.querySelector('[data-result-video]');
    return new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('result video failed')), { once: true });
      setTimeout(() => reject(new Error('result video metadata timeout')), 15000);
    });
  });

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(state.output.filename);
  const target = path.join(os.tmpdir(), `vc-download-${Date.now()}.mp4`);
  await download.saveAs(target);
  expect(fs.statSync(target).size).toBe(state.output.size);
  fs.unlinkSync(target);

  expect(errors).toEqual([]);
});

test('exports WebM VP9 with Opus and can remove the audio track', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.selectOption('[data-format]', 'webm');
  await waitForSupport(page);
  await exportVideo(page);
  let state = await readState(page);
  expect(state.output.mimeType).toBe('video/webm');
  expect(state.output.filename).toMatch(/\.webm$/);
  expect(state.output.videoCodec).toBe('vp9');
  expect(state.output.audioCodec).toBe('opus');
  let output = await inspectOutput(page);
  expect(output.videoCodec).toBe('vp9');
  expect(output.audioCodec).toBe('opus');
  expect(output.audioSampleRate).toBe(48000);
  expect(output.audioChannels).toBe(2);
  expect(output.size).toBe(state.output.size);

  const videoAudio = await readOutputAudio(page);
  expect(videoAudio).not.toBeNull();
  expect(videoAudio.firstTimestamp).toBeLessThan(0.05);

  await page.evaluate(() => window.__videoCompressor.setAudioKeep(false));
  await waitForSupport(page);
  await expect(page.locator('[data-audio-field]')).toBeHidden();
  await expect(page.locator('[data-audio-codec]')).toContainText('removed from the compressed file');

  await exportVideo(page);
  state = await readState(page);
  expect(state.output.hasAudio).toBe(false);
  expect(state.output.audioCodec).toBeNull();
  output = await inspectOutput(page);
  expect(output.audioCodec).toBeNull();
  expect(await readOutputAudio(page)).toBeNull();
  await expect(page.locator('[data-result-audio]')).toHaveText('No audio track');
});

test('encodes a real VP8 file when VP8 is selected', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-2s-mute.mp4');

  await page.check('input[name="vc-mode"][value="advanced"]');
  await page.selectOption('[data-format]', 'webm');
  await waitForSupport(page);
  await page.selectOption('[data-codec]', 'vp8');
  const state = await readState(page);
  expect(state.codec).toBe('vp8');
  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.videoCodec).toBe('vp8');
  expect(output.audioCodec).toBeNull();
  expect(output.width).toBe(480);
  expect(output.height).toBe(270);
});

test('advanced bitrate control genuinely lowers the video bitrate and file size', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.check('input[name="vc-mode"][value="advanced"]');
  await page.evaluate(() => {
    window.__videoCompressor.setRateMode('bitrate');
    window.__videoCompressor.setBitrate(0.2);
  });
  await waitForSupport(page);
  const state = await readState(page);
  expect(state.rateMode).toBe('bitrate');
  expect(state.bitrateMbps).toBe(0.2);
  expect(state.plan.videoBitrate).toBe(200000);
  await expect(page.locator('[data-export-note]')).toContainText('re-encoded, not copied');

  await exportVideo(page);
  const after = await readState(page);
  expect(after.output.size).toBeLessThan(state.file.size);
  expect(after.output.percent).toBeGreaterThan(20);
  expect(after.output.mode).toContain('0.20 Mbps');
  await expect(page.locator('[data-result-mode]')).toContainText('Advanced');

  const output = await inspectOutput(page);
  expect(output.videoCodec).toBe('avc');
  const measuredVideoBitrate = (output.size * 8) / output.duration;
  expect(measuredVideoBitrate).toBeLessThan(after.meta.videoBitrate + 128000);
});

test('advanced target size is treated as a goal and reported honestly', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.check('input[name="vc-mode"][value="advanced"]');
  await page.evaluate(() => {
    window.__videoCompressor.setRateMode('size');
    window.__videoCompressor.setTargetSize(0.15);
  });
  await waitForSupport(page);
  const state = await readState(page);
  expect(state.rateMode).toBe('size');
  expect(state.targetMB).toBe(0.15);
  expect(state.plan.targetVideoBitrate).toBeGreaterThan(0);
  await expect(page.locator('[data-target-hint]')).toBeVisible();
  await expect(page.locator('[data-target-hint]')).toContainText('A goal, not a guarantee');

  await exportVideo(page);
  const after = await readState(page);
  expect(after.output.size).toBeLessThan(after.file.size);
  expect(after.output.size).toBeGreaterThan(0.05 * 1024 * 1024);
  expect(after.output.size).toBeLessThan(0.6 * 1024 * 1024);
  await expect(page.locator('[data-result-mode]')).toContainText('0.15 MB target');
});

test('constant-quality (CRF) advanced export produces a real, playable file', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.check('input[name="vc-mode"][value="advanced"]');
  await page.evaluate(() => {
    window.__videoCompressor.setCrfEnabled(true);
    window.__videoCompressor.setCrf(34);
  });
  await waitForSupport(page);
  await expect(page.locator('[data-crf-field]')).toBeVisible();
  const state = await readState(page);
  expect(state.crfEnabled).toBe(true);
  expect(state.crf).toBe(34);
  await expect(page.locator('[data-plan-video]')).toContainText('CRF 34');

  await exportVideo(page);
  const after = await readState(page);
  expect(after.output.size).toBeGreaterThan(1000);
  expect(after.output.mode).toContain('CRF 34');
  const output = await inspectOutput(page);
  expect(output.width).toBe(640);
  expect(output.height).toBe(360);
  expect(output.videoCodec).toBe('avc');
  expect(output.duration).toBeCloseTo(4.0107, 1);
});

test('a frame-rate cap drops frames without shortening the video', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.check('input[name="vc-mode"][value="advanced"]');
  await page.selectOption('[data-fps-cap]', '24');
  await waitForSupport(page);
  const state = await readState(page);
  expect(state.fpsCap).toBe(24);
  await expect(page.locator('[data-fps-note]')).toContainText('Extra frames are dropped, never duplicated');

  await exportVideo(page);
  const after = await readState(page);
  expect(after.output.sourceFrames).toBeGreaterThan(110);
  expect(after.output.encodedFrames).toBeLessThan(after.output.sourceFrames);
  expect(after.output.encodedFrames).toBeGreaterThan(80);
  expect(after.output.duration).toBeCloseTo(4.0107, 1);

  const frames = await countOutputVideoFrames(page);
  expect(frames.count).toBe(after.output.encodedFrames);
  const fps = (frames.count - 1) / (frames.last - frames.first);
  expect(fps).toBeGreaterThan(23);
  expect(fps).toBeLessThan(26);
});

test('applies rotation metadata and compresses a portrait source without stretching', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-rotated.mp4');

  await expect(page.locator('[data-meta-resolution]')).toHaveText('360 \u00d7 640');
  await expect(page.locator('[data-meta-rotation]')).toHaveText('90\u00b0');

  let state = await readState(page);
  expect(state.resolution).toBe('original');
  expect(state.width).toBe(360);
  expect(state.height).toBe(640);
  await expect(page.locator('[data-output-summary]')).toContainText('360 \u00d7 640');

  await setResolution(page, '360');
  state = await readState(page);
  expect(state.width).toBe(360);
  expect(state.height).toBe(640);
  await expect(page.locator('[data-upscale]')).toBeHidden();

  await exportVideo(page);
  const output = await inspectOutput(page);
  expect(output.width).toBe(360);
  expect(output.height).toBe(640);
  expect(output.duration).toBeGreaterThan(1.9);
  expect(output.duration).toBeLessThan(2.2);
  expect(output.videoCodec).toBe('avc');
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
  await page.waitForFunction(() => Boolean(window.__videoCompressor.getState().ready), null, { timeout: 30000 });
  await waitForSupport(page);

  const state = await readState(page);
  expect(state.meta.fpsVariable).toBe(true);
  expect(state.meta.duration).toBeCloseTo(2.3, 1);

  await exportVideo(page);
  const frames = await countOutputVideoFrames(page);
  expect(frames.times).toEqual([0, 0.08, 0.2, 0.28, 0.5, 0.9, 1.2, 1.7, 1.75, 2]);
  const gaps = frames.times.slice(1).map((time, index) => Math.round((time - frames.times[index]) * 1000));
  expect(new Set(gaps).size).toBeGreaterThan(2);
});

test('rejects audio-only, corrupt, AVI, unsupported and empty files with clear errors', async ({ page }) => {
  await openPage(page);

  await page.setInputFiles('[data-file-input]', fixturePath('trim-audio-only.mp4'));
  await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-global-error]')).toContainText('No video track was found in this file.');

  await page.setInputFiles('[data-file-input]', fixturePath('trim-corrupt.mp4'));
  await expect(page.locator('[data-global-error]')).toContainText(/could not be read as a supported video/i, { timeout: 30000 });

  await page.setInputFiles('[data-file-input]', fixturePath('trim-not-video.avi'));
  await expect(page.locator('[data-global-error]')).toContainText(/AVI is not decoded/i);

  await page.setInputFiles('[data-file-input]', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a video')
  });
  await expect(page.locator('[data-global-error]')).toContainText('Unsupported file type');

  await page.setInputFiles('[data-file-input]', {
    name: 'empty.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(0)
  });
  await expect(page.locator('[data-global-error]')).toContainText('The file is empty.');

  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeDisabled();
});

test('cancels an export safely, releases resources and re-enables the controls', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-long.mp4');

  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
  await page.click('[data-export]');
  await expect(page.locator('[data-progress]')).toBeVisible();
  await expect(page.locator('[data-cancel]')).toBeVisible();
  await expect(page.locator('[data-export]')).toBeDisabled();

  await page.click('[data-cancel]');
  await expect(page.locator('[data-global-error]')).toContainText(/canceled/i, { timeout: 30000 });
  await expect(page.locator('[data-progress]')).toBeHidden();
  await expect(page.locator('[data-cancel]')).toBeHidden();
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeEnabled();

  // The worker still works after a cancel.
  await exportVideo(page);
  expect((await readState(page)).output.size).toBeGreaterThan(1000);
});

test('compresses again and starts a new compression with a different video', async ({ page }) => {
  test.setTimeout(240000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await exportVideo(page);
  const first = await readState(page);
  expect(first.output).toBeTruthy();

  await page.click('[data-compress-again]');
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeEnabled();
  await exportVideo(page);
  expect((await readState(page)).output.size).toBe(first.output.size);

  await page.click('[data-new-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoCompressor.getState().ready)).toBe(false);

  await loadVideo(page, 'trim-2s-mute.mp4');
  expect((await readState(page)).meta.hasAudio).toBe(false);
  await expect(page.locator('[data-audio-keep]')).toBeDisabled();
  await expect(page.locator('[data-audio-codec]')).toContainText('no audio track');
  await exportVideo(page);
  const second = await readState(page);
  expect(second.file.name).toBe('trim-2s-mute.mp4');
  expect(second.output.hasAudio).toBe(false);
  expect(second.output.size).toBeGreaterThan(0);
});

test('releases output blob URLs when compressing again or starting over', async ({ page }) => {
  test.setTimeout(240000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await exportVideo(page);
  const firstUrl = await page.evaluate(() => window.__videoCompressor.getOutputUrl());
  expect(firstUrl).toMatch(/^blob:/);

  await page.click('[data-compress-again]');
  await expect(page.locator('[data-result]')).toBeHidden();
  expect(await page.evaluate(async (url) => {
    try {
      await fetch(url);
      return 'ok';
    } catch (error) {
      return 'revoked';
    }
  }, firstUrl)).toBe('revoked');
  expect(await page.evaluate(() => window.__videoCompressor.getOutputUrl())).toBeNull();

  await exportVideo(page);
  const secondUrl = await page.evaluate(() => window.__videoCompressor.getOutputUrl());
  expect(secondUrl).toMatch(/^blob:/);

  await page.click('[data-new-video]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  expect(await page.evaluate(async (url) => {
    try {
      await fetch(url);
      return 'ok';
    } catch (error) {
      return 'revoked';
    }
  }, secondUrl)).toBe('revoked');
  expect(await page.evaluate(() => window.__videoCompressor.getOutputUrl())).toBeNull();
  await expect(page.locator('[data-video]')).not.toHaveAttribute('src', /blob:/);
});

test('reports an increase honestly when the target is larger than the source', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.check('input[name="vc-mode"][value="advanced"]');
  await page.evaluate(() => {
    window.__videoCompressor.setRateMode('bitrate');
    window.__videoCompressor.setBitrate(5);
  });
  await waitForSupport(page);
  await exportVideo(page);
  const state = await readState(page);
  expect(state.output.size).toBeGreaterThan(state.file.size);
  expect(state.output.saved).toBeLessThan(0);
  expect(state.output.percent).toBeLessThan(0);

  await expect(page.locator('[data-compare]')).toHaveClass(/is-increase/);
  await expect(page.locator('[data-result-percent]')).toContainText('larger');
  await expect(page.locator('[data-result-warning]')).toBeVisible();
  await expect(page.locator('[data-result-warning]')).toContainText('larger than the source');
  await expect(page.locator('[data-result-reduction]')).toContainText('\u2212');
});

test('has no horizontal overflow or clipped controls from 320 px to desktop', async ({ page }) => {
  await openPage(page);

  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `overflow at ${width}px`).toBe(0);
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await loadVideo(page, 'trim-4s.mp4');
  await page.check('input[name="vc-mode"][value="advanced"]');

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  for (const selector of ['[data-export]', '[data-browse]', '[data-width]', '[data-height]', '[data-target-size]', '[data-resolution]']) {
    const locator = page.locator(selector);
    if (await locator.count()) {
      const box = await locator.first().boundingBox();
      if (box) {
        expect(box.x, `${selector} left edge`).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, `${selector} right edge`).toBeLessThanOrEqual(321);
      }
    }
  }

  const touchTargets = await page.evaluate(() => {
    const scope = document.querySelector('[data-app]');
    return Array.from(scope.querySelectorAll('button, select'))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => ({
        label: (element.getAttribute('aria-label') || element.textContent || element.value || '').trim().slice(0, 40),
        height: element.getBoundingClientRect().height
      }))
      .filter((item) => item.height > 0 && item.height < 28);
  });
  expect(touchTargets).toEqual([]);

  await expect(page.locator('[data-export]')).toBeVisible();
  await expect(page.locator('[data-advanced]')).toBeVisible();
});
