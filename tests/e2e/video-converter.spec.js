'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-converter/';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(300000);
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
  await page.waitForFunction(() => Boolean(window.__videoConverter));
}

async function waitForSupport(page) {
  await page.waitForFunction(() => {
    const state = window.__videoConverter && window.__videoConverter.getState();
    return Boolean(state && (state.supportChecked || state.supportError) && !state.supportPending);
  }, null, { timeout: 30000 });
  const state = await readState(page);
  expect(state.supportError).toBe(false);
  expect(state.supportChecked).toBe(true);
}

async function loadVideo(page, name) {
  await page.setInputFiles('[data-file-input]', fixturePath(name));
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__videoConverter.getState().ready), null, { timeout: 30000 });
  await waitForSupport(page);
}

async function setToolMode(page, mode) {
  await page.evaluate((value) => window.__videoConverter.setToolMode(value), mode);
  await waitForSupport(page);
}

async function setResolution(page, value) {
  await page.evaluate((resolution) => window.__videoConverter.setResolution(resolution), value);
  await waitForSupport(page);
}

async function runExport(page, timeout = 120000) {
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout });
  await expect(page.locator('[data-export]')).toBeEnabled({ timeout: 30000 });
}

async function readState(page) {
  return page.evaluate(() => window.__videoConverter.getState());
}

async function inspectOutput(page) {
  return page.evaluate(async () => {
    const blob = window.__videoConverter.getOutputBlob();
    if (!blob) throw new Error('No output blob was available.');
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      const duration = await input.computeDuration();
      const videoTracks = await input.getVideoTracks();
      const audioTracks = await input.getAudioTracks();
      const video = videoTracks[0] || null;
      const audio = audioTracks[0] || null;
      const result = {
        size: blob.size,
        type: blob.type,
        duration,
        videoCount: videoTracks.length,
        audioCount: audioTracks.length,
        width: video ? await video.getDisplayWidth() : null,
        height: video ? await video.getDisplayHeight() : null,
        videoCodec: video ? await video.getCodec() : null,
        audioCodec: audio ? await audio.getCodec() : null,
        audioSampleRate: audio ? await audio.getSampleRate() : null,
        audioChannels: audio ? await audio.getNumberOfChannels() : null
      };
      return result;
    } finally {
      input.dispose();
    }
  });
}

async function countOutputVideoFrames(page) {
  return page.evaluate(async () => {
    const blob = window.__videoConverter.getOutputBlob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      const sink = new MB.VideoSampleSink(track);
      let count = 0;
      const times = [];
      for await (const sample of sink.samples()) {
        count += 1;
        times.push(Math.round(sample.timestamp * 1000) / 1000);
        sample.close();
      }
      return {
        count,
        first: times.length ? times[0] : null,
        last: times.length ? times[times.length - 1] : null
      };
    } finally {
      input.dispose();
    }
  });
}

async function readOutputAudio(page) {
  return page.evaluate(async () => {
    const blob = window.__videoConverter.getOutputBlob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null;
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
      return {
        firstTimestamp: first,
        duration: frames / sampleRate,
        rms: Math.sqrt(sum / Math.max(1, frames))
      };
    } finally {
      input.dispose();
    }
  });
}

async function sampleOutputPixels(page, points, at = 1) {
  return page.evaluate(async ({ samples, timestamp }) => {
    const blob = window.__videoConverter.getOutputBlob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      const sink = new MB.CanvasSink(track, { fit: 'contain', alpha: false });
      const wrapped = await sink.getCanvas(timestamp);
      if (!wrapped) throw new Error('No output frame was available.');
      const context = wrapped.canvas.getContext('2d');
      return samples.map(([x, y]) =>
        Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3)
      );
    } finally {
      input.dispose();
    }
  }, { samples: points, timestamp: at });
}

function brightness(pixel) {
  return pixel[0] + pixel[1] + pixel[2];
}

async function downloadOutput(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-download]')
  ]);
  const file = await download.path();
  return {
    filename: download.suggestedFilename(),
    size: fs.statSync(file).size
  };
}

test('serves a complete, indexable converter page', async ({ page }) => {
  const errors = collectErrors(page);
  await openPage(page);

  await expect(page).toHaveTitle('Free Online Video Converter – MP4, WebM, MOV, MKV & MP3 | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-converter/'
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Convert video to MP4, WebM, MOV or MKV, or extract MP3 audio/
  );
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Video Converter');
  expect(await page.locator('h2').count()).toBeGreaterThan(8);
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Editing');
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('[data-dropzone]')).toContainText('MP4, WebM, MOV, M4V or MKV');
  await expect(page.locator('[data-dropzone]')).toContainText('2 GB');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  const faq = structured[0]['@graph'].find((item) => item['@type'] === 'FAQPage');
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(8);
  expect(faq.mainEntity.some((entry) => /MP3 bitrate/i.test(entry.name))).toBe(true);

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(errors).toEqual([]);
});

test('exposes labelled controls, mode tabs and internal video links', async ({ page }) => {
  await openPage(page);

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('input[name="cv-tool-mode"]')).toHaveCount(2);
  await expect(page.locator('label.cv-mode-tab').filter({ hasText: 'Video to video' })).toBeVisible();
  await expect(page.locator('label.cv-mode-tab').filter({ hasText: 'Video to audio' })).toBeVisible();
  await expect(page.locator('label[for="cv-audio-quality"]')).toHaveText('Bitrate');
  await expect(page.locator('label[for="cv-audio-format"]')).toHaveText('Output format');
  await expect(page.locator('label[for="cv-format"]')).toHaveText('Container');
  await expect(page.locator('[data-audio-quality] option')).toHaveCount(5);

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
  await expect(related.filter({ hasText: 'Video Compressor' })).toHaveAttribute('href', '/media-and-motion/video-compressor/');
  await expect(related.filter({ hasText: 'Video Trimmer' })).toHaveAttribute('href', '/media-and-motion/video-trimmer/');
  await expect(related.filter({ hasText: 'Video Cropper' })).toHaveAttribute('href', '/media-and-motion/video-cropper/');
  await expect(related.filter({ hasText: 'Video Resizer' })).toHaveAttribute('href', '/media-and-motion/video-resizer/');
  await expect(related.filter({ hasText: 'Video Merger' })).toHaveAttribute('href', '/media-and-motion/video-merger/');
  await expect(page.locator('.vc-article a[href="/media-and-motion/video-compressor/"]')).toHaveCount(1);
});

test('loads the real source metadata and switches between video and audio scope', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');
  await expect(page.locator('[data-file-meta]')).toContainText('240 KB');
  await expect(page.locator('[data-file-meta]')).toContainText('MP4');
  await expect(page.locator('[data-file-meta]')).toContainText('AVC');
  await expect(page.locator('[data-meta-duration]')).toHaveText('00:04.011');
  await expect(page.locator('[data-meta-resolution]')).toHaveText('640 × 360');
  await expect(page.locator('[data-meta-aspect]')).toHaveText('16:9 (1.78:1)');
  await expect(page.locator('[data-meta-fps]')).toHaveText('30 fps');
  await expect(page.locator('[data-meta-video]')).toHaveText('H.264');
  await expect(page.locator('[data-meta-audio]')).toHaveText('AAC · 2 ch · 48 kHz');
  await expect(page.locator('[data-meta-tracks]')).toHaveText('1 track');
  await expect(page.locator('[data-meta-container]')).toHaveText('MP4');
  await expect(page.locator('[data-meta-bitrate]')).toContainText('Mbps video');
  await expect(page.locator('[data-video-settings]')).toBeVisible();
  await expect(page.locator('[data-audio-settings]')).toBeHidden();
  await expect(page.locator('[data-track-note]')).toHaveText('Using Track 1 · UND · 2 ch · 48 kHz · AAC.');

  await setToolMode(page, 'audio');
  await expect(page.locator('[data-video-settings]')).toBeHidden();
  await expect(page.locator('[data-audio-settings]')).toBeVisible();
  await expect(page.locator('[data-export]')).toHaveText('Extract audio');
  await expect(page.locator('[data-export]')).toBeEnabled();
  await expect(page.locator('[data-output-summary]')).toContainText('MP3 · 192 kbps');

  await setToolMode(page, 'video');
  await expect(page.locator('[data-video-settings]')).toBeVisible();
  await expect(page.locator('[data-export]')).toHaveText('Convert video');
  await expect(page.locator('[data-plan-source]')).toContainText('640 × 360');
  await expect(page.locator('[data-plan-output]')).toContainText('MP4 H.264');
});

test('offers only genuinely encodable container and codec combinations', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const readCodecs = () =>
    page.$$eval('[data-codec] option', (options) =>
      options.map((option) => ({ value: option.value, disabled: option.disabled }))
    );

  expect(await readCodecs()).toEqual([
    { value: 'avc', disabled: false },
    { value: 'hevc', disabled: true }
  ]);
  await expect(page.locator('[data-audio-codec]')).toContainText('AAC');
  await expect(page.locator('[data-format-note]')).toContainText('MP4 (H.264)');
  await expect(page.locator('[data-format-note]')).toContainText('WebM (VP9/VP8/AV1)');
  await expect(page.locator('[data-format-note]')).toContainText('MOV (H.264)');
  await expect(page.locator('[data-format-note]')).toContainText('MKV (H.264/VP9/AV1)');
  await expect(page.locator('[data-format] option')).toHaveCount(4);

  await page.selectOption('[data-format]', 'webm');
  expect(await readCodecs()).toEqual([
    { value: 'vp9', disabled: false },
    { value: 'vp8', disabled: false },
    { value: 'av1', disabled: false }
  ]);
  await expect(page.locator('[data-audio-codec]')).toContainText('Opus');
  await expect(page.locator('[data-format]')).toHaveValue('webm');

  await page.selectOption('[data-format]', 'mov');
  expect(await readCodecs()).toEqual([
    { value: 'avc', disabled: false },
    { value: 'hevc', disabled: true }
  ]);

  await page.selectOption('[data-format]', 'mkv');
  expect(await readCodecs()).toEqual([
    { value: 'avc', disabled: false },
    { value: 'hevc', disabled: true },
    { value: 'vp9', disabled: false },
    { value: 'av1', disabled: false }
  ]);

  await page.selectOption('[data-format]', 'mp4');
  await page.selectOption('[data-codec]', 'avc');
  await expect(page.locator('[data-codec]')).toHaveValue('avc');
});

test('converts MP4 and reads back the real video and audio streams', async ({ page }) => {
  const errors = collectErrors(page);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await runExport(page);

  const state = await readState(page);
  expect(state.output).toBeTruthy();
  expect(state.output.kind).toBe('video');
  expect(state.output.extension).toBe('mp4');
  expect(state.output.mimeType).toBe('video/mp4');
  expect(state.output.filename).toBe('trim-4s-converted-640x360.mp4');
  expect(state.output.size).toBeGreaterThan(1000);
  expect(state.output.hasAudio).toBe(true);

  const readback = await inspectOutput(page);
  expect(readback.videoCount).toBe(1);
  expect(readback.audioCount).toBe(1);
  expect(readback.videoCodec).toBe('avc');
  expect(readback.audioCodec).toBe('aac');
  expect(readback.width).toBe(640);
  expect(readback.height).toBe(360);
  expect(readback.audioSampleRate).toBe(48000);
  expect(readback.audioChannels).toBe(2);
  expect(Math.abs(readback.duration - 4.01)).toBeLessThan(0.15);

  await expect(page.locator('[data-result-title]')).toHaveText('Your converted video is ready');
  await expect(page.locator('[data-result-meta]')).toContainText('H.264');
  await expect(page.locator('[data-result-meta]')).toContainText('AAC');
  await expect(page.locator('[data-result-meta]')).toContainText('640 × 360');
  await expect(page.locator('[data-result-video]')).toBeVisible();
  await expect(page.locator('[data-result-audio]')).toBeHidden();

  const downloaded = await downloadOutput(page);
  expect(downloaded.filename).toBe('trim-4s-converted-640x360.mp4');
  expect(downloaded.size).toBe(state.output.size);
  expect(errors).toEqual([]);
});

test('converts to WebM with VP9 video and Opus audio', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.selectOption('[data-format]', 'webm');
  await page.selectOption('[data-codec]', 'vp9');
  await page.selectOption('[data-audio-bitrate]', '128');
  await runExport(page);

  const state = await readState(page);
  expect(state.output.extension).toBe('webm');
  expect(state.output.mimeType).toBe('video/webm');
  expect(state.output.codec).toBe('vp9');
  expect(state.output.audioCodec).toBe('opus');
  expect(state.output.filename).toBe('trim-4s-converted-640x360.webm');
  expect(state.output.audioBitrate).toBe(128000);

  const readback = await inspectOutput(page);
  expect(readback.videoCodec).toBe('vp9');
  expect(readback.audioCodec).toBe('opus');
  expect(readback.width).toBe(640);
  expect(readback.height).toBe(360);
  expect(readback.audioSampleRate).toBe(48000);
  expect(readback.audioChannels).toBe(2);
  await expect(page.locator('[data-result-meta]')).toContainText('WebM');
  await expect(page.locator('[data-result-meta]')).toContainText('VP9');
  await expect(page.locator('[data-result-meta]')).toContainText('Opus');
});

test('converts to MOV and MKV with H.264 and AAC', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.selectOption('[data-format]', 'mov');
  await runExport(page);
  let state = await readState(page);
  expect(state.output.extension).toBe('mov');
  expect(state.output.mimeType).toBe('video/quicktime');
  expect(state.output.codec).toBe('avc');
  expect(state.output.audioCodec).toBe('aac');
  let readback = await inspectOutput(page);
  expect(readback.videoCodec).toBe('avc');
  expect(readback.audioCodec).toBe('aac');
  expect(readback.width).toBe(640);
  expect(readback.height).toBe(360);

  await page.selectOption('[data-format]', 'mkv');
  await runExport(page);
  state = await readState(page);
  expect(state.output.extension).toBe('mkv');
  expect(state.output.mimeType).toBe('video/x-matroska');
  expect(state.output.codec).toBe('avc');
  expect(state.output.audioCodec).toBe('aac');
  readback = await inspectOutput(page);
  expect(readback.videoCodec).toBe('avc');
  expect(readback.audioCodec).toBe('aac');
  expect(readback.videoCount).toBe(1);
  expect(readback.audioCount).toBe(1);
});

test('preserves duration, frame count and audio alignment', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await runExport(page);

  const frames = await countOutputVideoFrames(page);
  expect(frames.count).toBeGreaterThanOrEqual(118);
  expect(frames.count).toBeLessThanOrEqual(122);
  expect(frames.first).toBeLessThan(0.05);

  const audio = await readOutputAudio(page);
  expect(audio).toBeTruthy();
  expect(audio.rms).toBeGreaterThan(0.01);
  expect(audio.firstTimestamp).toBeLessThan(0.1);
  expect(Math.abs(audio.duration - 4.01)).toBeLessThan(0.15);

  const state = await readState(page);
  expect(state.output.sourceFrames).toBeGreaterThanOrEqual(118);
  expect(state.output.encodedFrames).toBe(frames.count);
  expect(Math.abs(state.output.duration - 4.01)).toBeLessThan(0.15);
});

test('caps the frame rate by dropping frames without duplicating them', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.click('[data-advanced] summary');
  await page.selectOption('[data-fps-cap]', '24');
  await expect(page.locator('[data-fps-note]')).toContainText('24 fps');
  await runExport(page);

  const frames = await countOutputVideoFrames(page);
  expect(frames.count).toBeGreaterThanOrEqual(94);
  expect(frames.count).toBeLessThanOrEqual(98);
  const state = await readState(page);
  expect(state.output.encodedFrames).toBe(frames.count);
  expect(Math.abs(state.output.duration - 4.01)).toBeLessThan(0.15);
  expect(state.output.hasAudio).toBe(true);

  const audio = await readOutputAudio(page);
  expect(audio).toBeTruthy();
  expect(audio.duration).toBeGreaterThan(3.9);
});

test('removes the audio track when requested instead of silently keeping it', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.uncheck('[data-audio-keep]');
  await expect(page.locator('[data-audio-codec]')).toContainText('removed');
  await expect(page.locator('[data-plan-fourth]')).toHaveText('Removed');
  await runExport(page);

  const state = await readState(page);
  expect(state.output.hasAudio).toBe(false);
  expect(state.output.audioCodec).toBeFalsy();
  const readback = await inspectOutput(page);
  expect(readback.videoCount).toBe(1);
  expect(readback.audioCount).toBe(0);
  expect(readback.audioCodec).toBeNull();
  await expect(page.locator('[data-result-meta]')).toContainText('No audio track');
  expect((await readOutputAudio(page))).toBeNull();
});

test('honours an explicit video bitrate', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.click('[data-advanced] summary');
  await expect(page.locator('[data-bitrate-field]')).toBeVisible();
  await expect(page.locator('[data-bitrate]')).toBeDisabled();

  await page.check('[data-bitrate-override]');
  await expect(page.locator('[data-bitrate]')).toBeEnabled();
  await page.fill('[data-bitrate]', '0.2');
  await page.press('[data-bitrate]', 'Enter');
  await waitForSupport(page);
  await expect(page.locator('[data-plan-third]')).toContainText('0.20 Mbps');
  await runExport(page);
  const low = await readState(page);
  expect(low.output.videoBitrate).toBe(200000);
  const lowSize = low.output.size;

  await page.fill('[data-bitrate]', '3');
  await page.press('[data-bitrate]', 'Enter');
  await waitForSupport(page);
  await runExport(page);
  const high = await readState(page);
  expect(high.output.videoBitrate).toBe(3000000);
  expect(high.output.size).toBeGreaterThan(lowSize * 2);

  const readback = await inspectOutput(page);
  expect(readback.videoCodec).toBe('avc');
  expect(readback.audioCodec).toBe('aac');
});

test('honours constant quality and reports CRF in the plan', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await page.click('[data-advanced] summary');
  await page.evaluate(() => {
    window.__videoConverter.setBitrate(2);
    window.__videoConverter.setCrfEnabled(true);
    window.__videoConverter.setCrf(45);
  });
  await waitForSupport(page);
  await expect(page.locator('[data-crf-field]')).toBeVisible();
  await expect(page.locator('[data-plan-third]')).toContainText('CRF 45');
  await runExport(page);
  const coarse = await readState(page);
  expect(coarse.output.modeLabel).toContain('CRF 45');

  await page.evaluate(() => window.__videoConverter.setCrf(10));
  await waitForSupport(page);
  await runExport(page);
  const fine = await readState(page);
  expect(fine.output.modeLabel).toContain('CRF 10');
  expect(fine.output.size).toBeGreaterThan(coarse.output.size * 1.5);

  const readback = await inspectOutput(page);
  expect(readback.videoCodec).toBe('avc');
  expect(readback.audioCodec).toBe('aac');
});

test('extracts MP3 and reports the real codec, bitrate and duration', async ({ page }) => {
  const errors = collectErrors(page);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setToolMode(page, 'audio');
  await runExport(page);

  const state = await readState(page);
  expect(state.output.kind).toBe('audio');
  expect(state.output.extension).toBe('mp3');
  expect(state.output.mimeType).toBe('audio/mpeg');
  expect(state.output.filename).toBe('trim-4s-audio-192kbps.mp3');
  expect(state.output.format).toBe('mp3');
  expect(state.output.codec).toBe('mp3');
  expect(state.output.bitrateKbps).toBe(192);
  expect(state.output.sampleRate).toBe(48000);
  expect(state.output.channels).toBe(2);
  expect(state.output.trackIndex).toBe(0);
  const expectedSize = (192000 * state.output.duration) / 8;
  expect(Math.abs(state.output.size - expectedSize) / expectedSize).toBeLessThan(0.08);
  expect(Math.abs(state.output.measuredBitrate - 192000) / 192000).toBeLessThan(0.06);

  const readback = await inspectOutput(page);
  expect(readback.videoCount).toBe(0);
  expect(readback.audioCount).toBe(1);
  expect(readback.videoCodec).toBeNull();
  expect(readback.audioCodec).toBe('mp3');
  expect(readback.audioSampleRate).toBe(48000);
  expect(readback.audioChannels).toBe(2);
  expect(Math.abs(readback.duration - 4.01)).toBeLessThan(0.15);

  await expect(page.locator('[data-result-title]')).toHaveText('Your audio file is ready');
  await expect(page.locator('[data-result-audio]')).toBeVisible();
  await expect(page.locator('[data-result-video]')).toBeHidden();
  const meta = page.locator('[data-result-meta]');
  await expect(meta).toContainText('MP3 · audio');
  await expect(meta).toContainText('Measured bitrate');
  await expect(meta).toContainText('48 kHz');
  await expect(meta).toContainText('2 ch (stereo)');
  await expect(meta).toContainText('Track 1 of 1');

  const downloaded = await downloadOutput(page);
  expect(downloaded.filename).toBe('trim-4s-audio-192kbps.mp3');
  expect(downloaded.size).toBe(state.output.size);
  expect(errors).toEqual([]);
});

test('offers every resolution, warns on upscaling and letterboxes custom sizes', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const options = await page.$$eval('[data-resolution] option', (nodes) => nodes.map((node) => node.value));
  expect(options).toEqual(['original', '2160', '1440', '1080', '720', '480', '360', 'custom']);

  await setResolution(page, '720');
  let state = await readState(page);
  expect([state.width, state.height]).toEqual([1280, 720]);
  await expect(page.locator('[data-upscale]')).toBeVisible();
  await expect(page.locator('[data-upscale]')).toContainText('larger than the source');
  await expect(page.locator('[data-size-note]')).toContainText('720p output at 1280 × 720');

  await page.evaluate(() => {
    window.__videoConverter.setResolution('custom');
    window.__videoConverter.setSize(320, 240);
  });
  await waitForSupport(page);
  state = await readState(page);
  expect([state.width, state.height]).toEqual([320, 240]);
  expect(state.aspectLocked).toBe(false);
  await expect(page.locator('[data-size-note]')).toContainText('letterboxed, never stretched');
  await runExport(page);

  const readback = await inspectOutput(page);
  expect(readback.width).toBe(320);
  expect(readback.height).toBe(240);
  const [top, centre] = await sampleOutputPixels(page, [[160, 6], [160, 120]], 1);
  expect(brightness(top)).toBeLessThan(30);
  expect(brightness(centre)).toBeGreaterThan(60);

  await setResolution(page, 'original');
  state = await readState(page);
  expect([state.width, state.height]).toEqual([640, 360]);
  await expect(page.locator('[data-upscale]')).toBeHidden();
});

test('extracts MP3 at every offered bitrate with matching size and filename', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setToolMode(page, 'audio');

  const ladder = [320, 256, 128, 96];
  const sizes = [];
  for (const kbps of ladder) {
    await page.evaluate((value) => window.__videoConverter.setAudioQuality(value), kbps);
    await expect(page.locator('[data-output-summary]')).toContainText(`${kbps} kbps`);
    await runExport(page);

    const state = await readState(page);
    expect(state.output.bitrateKbps).toBe(kbps);
    expect(state.output.filename).toBe(`trim-4s-audio-${kbps}kbps.mp3`);
    const expected = (kbps * 1000 * state.output.duration) / 8;
    expect(Math.abs(state.output.size - expected) / expected).toBeLessThan(0.08);
    expect(Math.abs(state.output.measuredBitrate - kbps * 1000) / (kbps * 1000)).toBeLessThan(0.06);
    sizes.push(state.output.size);

    const readback = await inspectOutput(page);
    expect(readback.videoCount).toBe(0);
    expect(readback.audioCount).toBe(1);
    expect(readback.audioCodec).toBe('mp3');
    expect(readback.audioSampleRate).toBe(48000);
    expect(readback.audioChannels).toBe(2);
  }

  expect(sizes[0]).toBeGreaterThan(sizes[1]);
  expect(sizes[1]).toBeGreaterThan(sizes[2]);
  expect(sizes[2]).toBeGreaterThan(sizes[3]);
});

test('extracts genuine WAV, M4A and AAC files with real readback', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setToolMode(page, 'audio');
  await expect(page.locator('[data-audio-format] option')).toHaveCount(4);

  await page.selectOption('[data-audio-format]', 'wav');
  await waitForSupport(page);
  await expect(page.locator('[data-audio-quality-field]')).toBeHidden();
  await expect(page.locator('[data-output-summary]')).toContainText('uncompressed PCM');
  await runExport(page);

  let state = await readState(page);
  expect(state.output.filename).toBe('trim-4s-audio.wav');
  expect(state.output.extension).toBe('wav');
  expect(state.output.mimeType).toBe('audio/wav');
  expect(state.output.format).toBe('wav');
  expect(state.output.codec).toBe('pcm-s16');
  expect(state.output.bitrateKbps).toBeNull();
  const expectedWav = state.output.sampleRate * state.output.channels * 2 * state.output.duration;
  expect(Math.abs(state.output.size - expectedWav)).toBeLessThan(4096);
  let readback = await inspectOutput(page);
  expect(readback.videoCount).toBe(0);
  expect(readback.audioCount).toBe(1);
  expect(readback.audioCodec).toBe('pcm-s16');
  expect(readback.audioSampleRate).toBe(48000);
  expect(readback.audioChannels).toBe(2);
  await expect(page.locator('[data-result-meta]')).toContainText('WAV · audio');
  await expect(page.locator('[data-result-meta]')).toContainText('uncompressed');
  await expect(page.locator('[data-result-meta]')).toContainText('None (PCM)');

  await page.selectOption('[data-audio-format]', 'm4a');
  await waitForSupport(page);
  await expect(page.locator('[data-audio-quality-field]')).toBeVisible();
  await runExport(page);
  state = await readState(page);
  expect(state.output.filename).toBe('trim-4s-audio-192kbps.m4a');
  expect(state.output.extension).toBe('m4a');
  expect(state.output.mimeType).toBe('audio/mp4');
  expect(state.output.codec).toBe('aac');
  expect(state.output.bitrateKbps).toBe(192);
  expect(state.output.measuredBitrate).toBeGreaterThan(150000);
  expect(state.output.measuredBitrate).toBeLessThan(210000);
  readback = await inspectOutput(page);
  expect(readback.audioCodec).toBe('aac');
  expect(readback.audioCount).toBe(1);
  expect(readback.videoCount).toBe(0);
  expect(Math.abs(readback.duration - 4.01)).toBeLessThan(0.15);
  await expect(page.locator('[data-result-meta]')).toContainText('M4A · audio');
  await expect(page.locator('[data-result-meta]')).toContainText('AAC');

  await page.selectOption('[data-audio-format]', 'aac');
  await waitForSupport(page);
  await runExport(page);
  state = await readState(page);
  expect(state.output.filename).toBe('trim-4s-audio-192kbps.aac');
  expect(state.output.extension).toBe('aac');
  expect(state.output.mimeType).toBe('audio/aac');
  expect(state.output.codec).toBe('aac');
  expect(state.output.bitrateKbps).toBe(192);
  readback = await inspectOutput(page);
  expect(readback.audioCodec).toBe('aac');
  expect(readback.audioCount).toBe(1);
  expect(readback.videoCount).toBe(0);
  expect(Math.abs(readback.duration - 4.01)).toBeLessThan(0.15);
  await expect(page.locator('[data-result-meta]')).toContainText('AAC · audio');
});

test('resamples to 44.1 kHz and downmixes stereo to mono', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await setToolMode(page, 'audio');

  await page.evaluate(() => {
    window.__videoConverter.setSampleRate(44100);
    window.__videoConverter.setChannels(1);
  });
  await waitForSupport(page);
  await expect(page.locator('[data-output-summary]')).toContainText('44.1 kHz mono');
  await runExport(page);

  const state = await readState(page);
  expect(state.output.sampleRate).toBe(44100);
  expect(state.output.channels).toBe(1);
  expect(state.output.bitrateKbps).toBe(192);
  const readback = await inspectOutput(page);
  expect(readback.audioCodec).toBe('mp3');
  expect(readback.audioSampleRate).toBe(44100);
  expect(readback.audioChannels).toBe(1);
  expect(Math.abs(readback.duration - 4.01)).toBeLessThan(0.15);

  const meta = page.locator('[data-result-meta]');
  await expect(meta).toContainText('44.1 kHz');
  await expect(meta).toContainText('1 ch (mono)');
  await expect(meta).toContainText('Track 1 of 1');
});

test('extracts the selected audio track from a multi-track file', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-multi-track.mkv');

  expect((await readState(page)).meta.audioTracks.length).toBe(2);
  await expect(page.locator('[data-meta-tracks]')).toHaveText('2 tracks');
  await expect(page.locator('[data-track-field]')).toBeHidden();

  await setToolMode(page, 'audio');
  await expect(page.locator('[data-track-field]')).toBeVisible();
  const trackOptions = await page.$$eval('[data-track] option', (options) =>
    options.map((option) => option.textContent)
  );
  expect(trackOptions).toEqual([
    'Track 1 · UND · 2 ch · 48 kHz · AAC',
    'Track 2 · UND · 1 ch · 44.1 kHz · AAC'
  ]);
  await expect(page.locator('[data-track-note]')).toContainText('2 audio tracks found');

  await runExport(page);
  let state = await readState(page);
  expect(state.output.trackIndex).toBe(0);
  expect(state.output.sampleRate).toBe(48000);
  expect(state.output.channels).toBe(2);
  expect(state.output.duration).toBeGreaterThan(1.85);
  expect(state.output.duration).toBeLessThan(2.3);
  await expect(page.locator('[data-result-meta]')).toContainText('Track 1 of 2');

  await page.selectOption('[data-track]', '1');
  await page.evaluate(() => {
    window.__videoConverter.setSampleRate(44100);
    window.__videoConverter.setChannels(1);
  });
  await waitForSupport(page);
  await runExport(page);

  state = await readState(page);
  expect(state.output.trackIndex).toBe(1);
  expect(state.output.sampleRate).toBe(44100);
  expect(state.output.channels).toBe(1);
  expect(state.output.duration).toBeGreaterThan(0.85);
  expect(state.output.duration).toBeLessThan(1.3);
  const readback = await inspectOutput(page);
  expect(readback.audioCodec).toBe('mp3');
  expect(readback.audioSampleRate).toBe(44100);
  expect(readback.audioChannels).toBe(1);
  expect(readback.duration).toBeGreaterThan(0.85);
  expect(readback.duration).toBeLessThan(1.3);
  await expect(page.locator('[data-result-meta]')).toContainText('Track 2 of 2');
  await expect(page.locator('[data-result-meta]')).toContainText('1 ch (mono)');
  await expect(page.locator('[data-result-meta]')).toContainText('44.1 kHz');
});

test('keeps silent videos silent and refuses to fake an audio extraction', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-2s-mute.mp4');

  await expect(page.locator('[data-audio-keep]')).not.toBeChecked();
  await expect(page.locator('[data-audio-codec]')).toContainText('no audio track');
  await runExport(page);

  let state = await readState(page);
  expect(state.output.hasAudio).toBe(false);
  let readback = await inspectOutput(page);
  expect(readback.videoCount).toBe(1);
  expect(readback.audioCount).toBe(0);
  expect(readback.audioCodec).toBeNull();

  await setToolMode(page, 'audio');
  await expect(page.locator('[data-audio-missing]')).toBeVisible();
  await expect(page.locator('[data-audio-missing]')).toContainText('nothing to extract');
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('[data-export-note]')).toContainText('no audio track to extract');
  await expect(page.locator('[data-result]')).toBeHidden();

  const output = await page.evaluate(() => window.__videoConverter.getOutputBlob());
  expect(output).toBeNull();
});

test('rejects unsupported, corrupt, audio-only, empty and oversized files', async ({ page }) => {
  await openPage(page);
  const error = page.locator('[data-global-error]');

  await page.setInputFiles('[data-file-input]', fixturePath('trim-not-video.avi'));
  await expect(error).toBeVisible();
  await expect(error).toContainText('AVI is not decoded');

  await page.setInputFiles('[data-file-input]', fixturePath('trim-corrupt.mp4'));
  await expect(error).toContainText('could not be read as a supported video');

  await page.setInputFiles('[data-file-input]', fixturePath('trim-audio-only.mp4'));
  await expect(error).toContainText('No video track was found');

  await page.evaluate(() => {
    const file = new File([], 'empty.mp4', { type: 'video/mp4' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.querySelector('[data-dropzone]').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
  });
  await expect(error).toContainText('The file is empty');

  await page.evaluate(() => {
    const file = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 3000000000 });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.querySelector('[data-dropzone]').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
  });
  await expect(error).toContainText('larger than the 2 GB limit');

  await expect(page.locator('[data-editor]')).toBeHidden();
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeDisabled();
  expect((await readState(page)).ready).toBe(false);
});

test('cancels safely, releases the result and can convert again', async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await openPage(page);
  await loadVideo(page, 'trim-long.mp4');

  await setResolution(page, '2160');
  await expect(page.locator('[data-export]')).toBeEnabled();
  await page.click('[data-export]');
  await expect(page.locator('[data-cancel]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-progress]')).toBeVisible();
  await page.click('[data-cancel]');

  await page.waitForFunction(() => {
    const state = window.__videoConverter.getState();
    return !state.exporting && !state.canceling;
  }, null, { timeout: 120000 });

  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-global-error]')).toContainText('canceled');
  await expect(page.locator('[data-cancel]')).toBeHidden();
  await expect(page.locator('[data-progress]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeEnabled();
  expect(await page.evaluate(() => window.__videoConverter.getOutputBlob())).toBeNull();
  expect(await page.evaluate(() => window.__videoConverter.getOutputUrl())).toBeNull();

  await setResolution(page, 'original');
  await runExport(page);
  let state = await readState(page);
  expect(state.output.filename).toBe('trim-long-converted-320x180.mp4');
  expect(state.output.hasAudio).toBe(true);
  expect(Math.abs(state.output.duration - 12.01)).toBeLessThan(0.2);

  await page.click('[data-remove-video]');
  await expect(page.locator('[data-editor]')).toBeHidden();
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  expect((await readState(page)).ready).toBe(false);
  expect(await page.evaluate(() => window.__videoConverter.getOutputBlob())).toBeNull();
  expect(await page.evaluate(() => window.__videoConverter.getOutputUrl())).toBeNull();

  await loadVideo(page, 'trim-4s.mp4');
  await runExport(page);
  state = await readState(page);
  expect(state.output.filename).toBe('trim-4s-converted-640x360.mp4');
  expect(state.output.size).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('lazy-loads the processing worker only after a file is chosen', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('video-converter-worker.js')) requests.push(request.url());
  });

  await openPage(page);
  expect(requests).toEqual([]);
  await loadVideo(page, 'trim-4s.mp4');
  await expect.poll(() => requests.length).toBe(1);
});

test('stays usable without horizontal overflow on small screens', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.cv-mode-tab')).toHaveCount(2);
  const tabBox = await page.locator('.cv-mode-tab').first().boundingBox();
  expect(tabBox.height).toBeGreaterThanOrEqual(40);

  await page.click('[data-advanced] summary');
  await expect(page.locator('[data-bitrate-field]')).toBeVisible();
  const advancedBox = await page.locator('[data-advanced]').boundingBox();
  expect(advancedBox.x).toBeGreaterThanOrEqual(0);
  expect(advancedBox.x + advancedBox.width).toBeLessThanOrEqual(390.5);

  await page.locator('.cv-mode-tab').filter({ hasText: 'Video to audio' }).click();
  await waitForSupport(page);
  await expect(page.locator('[data-audio-settings]')).toBeVisible();
  const exportBox = await page.locator('[data-export]').boundingBox();
  expect(exportBox.x).toBeGreaterThanOrEqual(0);
  expect(exportBox.x + exportBox.width).toBeLessThanOrEqual(390.5);
  await runExport(page);

  await expect(page.locator('[data-result-audio]')).toBeVisible();
  await expect(page.locator('[data-result-video]')).toBeHidden();
  const resultBox = await page.locator('[data-result]').boundingBox();
  expect(resultBox.x).toBeGreaterThanOrEqual(0);
  expect(resultBox.x + resultBox.width).toBeLessThanOrEqual(390.5);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ).toBeLessThanOrEqual(0);
});

test('supports keyboard operation for modes, advanced settings and export', async ({ page }) => {
  test.setTimeout(180000);
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const audioRadio = page.locator('input[name="cv-tool-mode"][value="audio"]');
  await audioRadio.focus();
  await page.keyboard.press('Space');
  await waitForSupport(page);
  expect((await readState(page)).toolMode).toBe('audio');
  await expect(page.locator('[data-audio-settings]')).toBeVisible();

  const videoRadio = page.locator('input[name="cv-tool-mode"][value="video"]');
  await videoRadio.focus();
  await page.keyboard.press('Space');
  await waitForSupport(page);
  await expect(page.locator('[data-video-settings]')).toBeVisible();

  const summary = page.locator('[data-advanced] summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-advanced]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-bitrate-field]')).toBeVisible();

  const format = page.locator('[data-format]');
  await format.focus();
  await page.keyboard.press('ArrowDown');
  expect(await format.inputValue()).toBe('webm');
  await waitForSupport(page);

  const keep = page.locator('[data-audio-keep]');
  await keep.focus();
  await page.keyboard.press('Space');
  expect((await readState(page)).audioKeep).toBe(false);
  await expect(page.locator('[data-plan-fourth]')).toHaveText('Removed');
  await page.keyboard.press('Space');
  expect((await readState(page)).audioKeep).toBe(true);

  await page.locator('[data-export]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 120000 });
  const state = await readState(page);
  expect(state.output.codec).toBe('vp9');
  expect(state.output.hasAudio).toBe(true);
});

test('preserves Unicode filenames through conversion and download', async ({ page }) => {
  const unicodeName = 'vídeo-テスト.mp4';
  await openPage(page);
  expect(await page.locator('[data-file-input]').getAttribute('multiple')).toBeNull();
  await page.setInputFiles('[data-file-input]', {
    name: unicodeName,
    mimeType: 'video/mp4',
    buffer: fs.readFileSync(fixturePath('trim-4s.mp4'))
  });
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => window.__videoConverter.getState().ready, null, { timeout: 30000 });
  await waitForSupport(page);

  await expect(page.locator('[data-file-name]')).toHaveText(unicodeName);
  await runExport(page);
  const state = await readState(page);
  expect(state.output.filename).toBe('vídeo-テスト-converted-640x360.mp4');
  expect(state.output.size).toBeGreaterThan(1000);

  const downloaded = await downloadOutput(page);
  expect(downloaded.filename).toBe('vídeo-テスト-converted-640x360.mp4');
  expect(downloaded.size).toBe(state.output.size);
});

test('documents container compatibility, MP3 bitrates and privacy limits', async ({ page }) => {
  await openPage(page);

  const tables = page.locator('table.cv-table');
  await expect(tables).toHaveCount(2);
  const matrix = tables.first();
  await expect(matrix.locator('caption')).toHaveText('Container and codec combinations exposed by this tool');
  await expect(matrix.locator('tbody tr')).toHaveCount(4);
  await expect(matrix).toContainText('H.264 (AVC), HEVC (H.265) when encodable');
  await expect(matrix).toContainText('VP9, VP8, AV1 when encodable');
  await expect(matrix).toContainText('Opus');
  await expect(matrix).toContainText('AAC');

  const bitrate = tables.nth(1);
  await expect(bitrate.locator('caption')).toHaveText('MP3 bitrate guidance for a one-minute clip');
  await expect(bitrate.locator('tbody tr')).toHaveCount(5);
  for (const value of ['320 kbps', '256 kbps', '192 kbps', '128 kbps', '96 kbps']) {
    await expect(bitrate).toContainText(value);
  }

  await expect(page.locator('.vc-faq details')).toHaveCount(10);
  await expect(page.locator('.vc-faq')).toContainText('never creates a silent MP3');
  await expect(page.locator('h2', { hasText: 'Privacy, performance and file limits' })).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Troubleshooting' })).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Choosing an MP3 bitrate' })).toBeVisible();
});
