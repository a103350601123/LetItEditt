'use strict';

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-merger/';

test.setTimeout(240000);

test.beforeAll(async ({ browser, baseURL }) => {
  await ensureFixtures(browser, baseURL);
});

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await page.evaluate(async () => {
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const blobCache = new Map();

    async function blobFor(source) {
      if (source instanceof Blob) return source;
      const key = String(source);
      if (blobCache.has(key)) return blobCache.get(key);
      const response = await fetch(key);
      if (!response.ok) throw new Error(`Could not fetch ${key}`);
      const blob = await response.blob();
      blobCache.set(key, blob);
      return blob;
    }

    async function openInput(source) {
      return new MB.Input({ source: new MB.BlobSource(await blobFor(source)), formats: MB.ALL_FORMATS });
    }

    async function inspectMedia(source) {
      const input = await openInput(source);
      try {
        const video = await input.getPrimaryVideoTrack();
        const audio = await input.getPrimaryAudioTrack();
        return {
          duration: await input.computeDuration(),
          hasVideo: Boolean(video),
          width: video ? await video.getDisplayWidth() : null,
          height: video ? await video.getDisplayHeight() : null,
          rotation: video ? await video.getRotation() : null,
          videoCodec: video ? await video.getCodec() : null,
          hasAudio: Boolean(audio),
          audioCodec: audio ? await audio.getCodec() : null,
          audioChannels: audio ? await audio.getNumberOfChannels() : null,
          audioSampleRate: audio ? await audio.getSampleRate() : null,
          size: (await blobFor(source)).size
        };
      } finally {
        input.dispose();
      }
    }

    async function renderFrame(source, time, width, height, background, fit) {
      const input = await openInput(source);
      try {
        const video = await input.getPrimaryVideoTrack();
        if (!video) return null;
        const sink = new MB.CanvasSink(video, { width, height, fit, alpha: true, poolSize: 1 });
        const wrapped = await sink.getCanvas(Math.max(0, time));
        if (!wrapped) return null;
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.drawImage(wrapped.canvas, 0, 0, width, height);
        return context.getImageData(0, 0, width, height);
      } finally {
        input.dispose();
      }
    }

    async function frameGrid(source, time, width, height, background, fit) {
      const image = await renderFrame(source, time, width, height, background, fit);
      if (!image) return null;
      const columns = 16;
      const rows = 9;
      const vector = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x0 = Math.floor((column * width) / columns);
          const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * width) / columns));
          const y0 = Math.floor((row * height) / rows);
          const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));
          let r = 0;
          let g = 0;
          let b = 0;
          let count = 0;
          for (let y = y0; y < y1; y += 2) {
            for (let x = x0; x < x1; x += 2) {
              const index = (y * width + x) * 4;
              r += image.data[index];
              g += image.data[index + 1];
              b += image.data[index + 2];
              count += 1;
            }
          }
          vector.push(r / count, g / count, b / count);
        }
      }
      return vector;
    }

    async function pixel(source, time, width, height, x, y, background, fit) {
      const image = await renderFrame(source, time, width, height, background, fit);
      if (!image) return null;
      const index = (y * width + x) * 4;
      return [image.data[index], image.data[index + 1], image.data[index + 2]];
    }

    async function audioStats(source, segments) {
      const input = await openInput(source);
      try {
        const audio = await input.getPrimaryAudioTrack();
        if (!audio) return { hasAudio: false };
        const stats = segments.map(() => ({ sum: [0, 0], count: [0, 0] }));
        const sink = new MB.AudioSampleSink(audio);
        for await (const sample of sink.samples(0, 3600)) {
          const planes = [];
          for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
            const plane = new Float32Array(sample.numberOfFrames);
            sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
            planes.push(plane);
          }
          for (let i = 0; i < sample.numberOfFrames; i += 1) {
            const time = sample.timestamp + i / sample.sampleRate;
            for (let index = 0; index < segments.length; index += 1) {
              if (time >= segments[index][0] && time < segments[index][1]) {
                for (let channel = 0; channel < 2; channel += 1) {
                  const plane = planes[Math.min(channel, planes.length - 1)];
                  stats[index].sum[channel] += plane[i] * plane[i];
                  stats[index].count[channel] += 1;
                }
              }
            }
          }
          sample.close();
        }
        return {
          hasAudio: true,
          channels: await audio.getNumberOfChannels(),
          sampleRate: await audio.getSampleRate(),
          segments: stats.map((entry) =>
            entry.count.map((count, channel) => (count ? Math.sqrt(entry.sum[channel] / count) : null))
          )
        };
      } finally {
        input.dispose();
      }
    }

    function difference(a, b) {
      let total = 0;
      for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
      return total / a.length;
    }

    window.__vmTest = { inspectMedia, frameGrid, pixel, audioStats, difference };
  });
}

async function waitForSupport(page) {
  await page.waitForFunction(() => {
    const state = window.__videoMerger?.getState();
    return Boolean(state && state.supportChecked && !state.supportPending);
  }, null, { timeout: 90000 });
}

async function addFixtures(page, files) {
  await page.setInputFiles('[data-file-input]', files);
  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 90000 });
  await page.waitForFunction(
    (count) => window.__videoMerger?.getState().clips.length === count,
    files.length,
    { timeout: 60000 }
  );
  await waitForSupport(page);
}

async function mergeAndWait(page) {
  await expect(page.locator('[data-merge]')).toBeEnabled({ timeout: 30000 });
  await page.click('[data-merge]');
  await expect(page.locator('[data-progress]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 180000 });
}

async function state(page) {
  return page.evaluate(() => window.__videoMerger.getState());
}

async function outputUrl(page) {
  return page.evaluate(() => window.__videoMerger.getOutputUrl());
}

async function clipNames(page) {
  return page.$$eval('[data-clip-list] [data-clip-id] .vm-clip-title strong', (nodes) =>
    nodes.map((node) => node.textContent.trim())
  );
}

async function orderMatches(page, sources) {
  const current = await state(page);
  const url = await outputUrl(page);
  const durations = current.clips.map((clip) => clip.duration);
  return page.evaluate(
    async ({ url, durations, sources }) => {
      const width = 640;
      const height = 360;
      const background = '#0f172a';
      const offsets = [];
      let total = 0;
      for (const duration of durations) {
        offsets.push(total);
        total += duration;
      }
      const result = [];
      for (let index = 0; index < sources.length; index += 1) {
        const local = Math.min(0.5, durations[index] * 0.35);
        const output = await window.__vmTest.frameGrid(
          url,
          offsets[index] + local,
          width,
          height,
          background,
          'contain'
        );
        const scores = [];
        for (let candidate = 0; candidate < sources.length; candidate += 1) {
          const candidateTime = Math.min(0.5, durations[candidate] * 0.35);
          const reference = await window.__vmTest.frameGrid(
            `/tests/fixtures/${sources[candidate]}`,
            candidateTime,
            width,
            height,
            background,
            'contain'
          );
          scores.push(window.__vmTest.difference(output, reference));
        }
        result.push({ best: scores.indexOf(Math.min(...scores)), scores });
      }
      return result;
    },
    { url, durations, sources }
  );
}

test('serves a complete, indexable tool page', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await openPage(page);

  await expect(page).toHaveTitle('Free Online Video Merger – Combine Videos into One | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-merger/'
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Merge multiple videos online for free/
  );
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Video Merger');
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Editing');
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Merger');
  await expect(page.locator('[data-merge]')).toBeDisabled();
  await expect(page.locator('[data-file-input]')).toHaveAttribute('multiple', '');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  expect(structured.length).toBeGreaterThan(0);
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  await expect(page.locator('a[href="/media-and-motion/video-trimmer/"]').first()).toBeVisible();
  await expect(page.locator('a[href="/categories/video-editing/"]').first()).toBeVisible();
  await expect(page.locator('.vm-article h2').first()).toBeVisible();
  await expect(page.locator('.faq-item')).toHaveCount(10);
  await expect(page.locator('body')).toContainText('not a lossless stream copy');

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('loads real clips, reports metadata, and previews the sequence', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await addFixtures(page, [
    fixturePath('trim-4s.mp4'),
    fixturePath('trim-portrait.mp4'),
    fixturePath('trim-2s-mute.mp4'),
    fixturePath('trim-3s.webm')
  ]);

  await expect(page.locator('[data-clip-list] [data-clip-id]')).toHaveCount(4);
  await expect(page.locator('[data-clip-count]')).toHaveText('4');
  await expect(page.locator('[data-total-duration]')).toHaveText(/00:11\./);
  await expect(page.locator('[data-total-size]')).not.toHaveText('0 B');

  const clips = page.locator('[data-clip-list] [data-clip-id]');
  await expect(clips.nth(0)).toContainText('trim-4s.mp4');
  await expect(clips.nth(0)).toContainText('640 × 360');
  await expect(clips.nth(0)).toContainText('30 fps');
  await expect(clips.nth(0)).toContainText(/AAC.*2 ch.*48 kHz/);
  await expect(clips.nth(0).locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);

  await expect(clips.nth(1)).toContainText('270 × 480');
  await expect(clips.nth(1)).toContainText('25 fps');
  await expect(clips.nth(2)).toContainText('No audio');
  await expect(clips.nth(3)).toContainText(/OPUS.*2 ch.*48 kHz/);
  expect(await page.locator('[data-clip-list] img').count()).toBe(4);

  await expect(page.locator('[data-preview-sequence]')).toBeEnabled();
  await expect(page.locator('[data-merge]')).toBeEnabled();

  await clips.nth(0).locator('[data-action="preview"]').click();
  await expect(page.locator('[data-preview]')).toBeVisible();
  await expect(page.locator('[data-preview-title]')).toHaveText('trim-4s.mp4');
  await expect(page.locator('[data-preview-meta]')).toContainText('640 × 360');
  await expect(page.locator('[data-preview-video]')).toHaveAttribute('src', /^blob:/);
  await page.click('[data-preview-close]');
  await expect(page.locator('[data-preview]')).toBeHidden();

  await page.click('[data-preview-sequence]');
  await expect(page.locator('[data-preview-title]')).toHaveText('Sequence preview · Clip 1 of 4');
  await expect(page.locator('[data-preview-status]')).toContainText(/Playing the clips in order/i);
  await page.click('[data-preview-close]');

  expect(pageErrors).toEqual([]);
});

test('accepts drag-and-dropped clips and the Add more picker', async ({ page }) => {
  await openPage(page);
  const payloads = [
    { name: 'trim-4s.mp4', type: 'video/mp4', data: fs.readFileSync(fixturePath('trim-4s.mp4')).toString('base64') },
    {
      name: 'trim-portrait.mp4',
      type: 'video/mp4',
      data: fs.readFileSync(fixturePath('trim-portrait.mp4')).toString('base64')
    }
  ];

  await page.evaluate(({ payloads }) => {
    const transfer = new DataTransfer();
    for (const payload of payloads) {
      const binary = atob(payload.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      transfer.items.add(new File([bytes], payload.name, { type: payload.type }));
    }
    const dropzone = document.querySelector('[data-dropzone]');
    dropzone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { payloads });

  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 90000 });
  await page.waitForFunction(() => window.__videoMerger?.getState().clips.length === 2, null, { timeout: 60000 });
  await waitForSupport(page);
  expect(await clipNames(page)).toEqual(['trim-4s.mp4', 'trim-portrait.mp4']);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.click('[data-add-more]');
  const chooser = await chooserPromise;
  await chooser.setFiles(fixturePath('trim-3s.webm'));
  await page.waitForFunction(() => window.__videoMerger?.getState().clips.length === 3, null, { timeout: 60000 });
  await waitForSupport(page);
  expect(await clipNames(page)).toEqual(['trim-4s.mp4', 'trim-portrait.mp4', 'trim-3s.webm']);
});

test('reorders clips with buttons, keyboard and drag, then removes and clears', async ({ page }) => {
  await openPage(page);
  await addFixtures(page, [
    fixturePath('trim-4s.mp4'),
    fixturePath('trim-portrait.mp4'),
    fixturePath('trim-2s-mute.mp4')
  ]);

  expect(await clipNames(page)).toEqual(['trim-4s.mp4', 'trim-portrait.mp4', 'trim-2s-mute.mp4']);
  await expect(page.locator('[data-clip-list] [data-clip-id]').first().locator('[data-action="up"]')).toBeDisabled();
  await expect(page.locator('[data-clip-list] [data-clip-id]').last().locator('[data-action="down"]')).toBeDisabled();

  await page.locator('[data-clip-list] [data-clip-id]').first().locator('[data-action="down"]').click();
  expect(await clipNames(page)).toEqual(['trim-portrait.mp4', 'trim-4s.mp4', 'trim-2s-mute.mp4']);

  await page.locator('[data-clip-list] [data-clip-id]').last().locator('[data-action="up"]').click();
  expect(await clipNames(page)).toEqual(['trim-portrait.mp4', 'trim-2s-mute.mp4', 'trim-4s.mp4']);

  const first = page.locator('[data-clip-list] [data-clip-id]').first();
  await first.focus();
  await first.press('Alt+ArrowDown');
  expect(await clipNames(page)).toEqual(['trim-2s-mute.mp4', 'trim-portrait.mp4', 'trim-4s.mp4']);

  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-clip-list] [data-clip-id]'));
    const source = items[items.length - 1];
    const target = items[0];
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = target.getBoundingClientRect();
    const clientY = rect.top + 4;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(() => window.__videoMerger.getState().clips[0].name === 'trim-4s.mp4');
  expect(await clipNames(page)).toEqual(['trim-4s.mp4', 'trim-2s-mute.mp4', 'trim-portrait.mp4']);

  await expect(page.locator('[data-clip-list] [data-clip-id]').nth(1)).toHaveAttribute(
    'aria-label',
    'Clip 2: trim-2s-mute.mp4'
  );

  await page.locator('[data-clip-list] [data-clip-id]').nth(1).locator('[data-action="remove"]').click();
  expect(await clipNames(page)).toEqual(['trim-4s.mp4', 'trim-portrait.mp4']);
  await expect(page.locator('[data-clip-count]')).toHaveText('2');

  await page.click('[data-clear-all]');
  await expect(page.locator('[data-clip-list]')).toBeHidden();
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-clip-count]')).toHaveText('0');
  await expect(page.locator('[data-total-duration]')).toHaveText('00:00.000');
  await expect(page.locator('[data-merge]')).toBeDisabled();
});

test('merges clips in order and produces a downloadable MP4 with audio', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await openPage(page);
  const sources = ['trim-4s.mp4', 'trim-portrait.mp4', 'trim-44100.mp4'];
  await addFixtures(page, sources.map((name) => fixturePath(name)));
  expect((await state(page)).outputSize).toEqual({ width: 640, height: 360 });

  await mergeAndWait(page);

  await expect(page.locator('[data-result-name]')).toHaveText('trim-4s-merged.mp4');
  await expect(page.locator('[data-result-format]')).toContainText('MP4');
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:07\./);
  await expect(page.locator('[data-result-resolution]')).toHaveText('640 × 360');
  await expect(page.locator('[data-result-audio]')).toHaveText('Audio included');
  await expect(page.locator('[data-download]')).toHaveAttribute('href', /^blob:/);
  expect(Number(await page.locator('[data-progress-track]').getAttribute('aria-valuenow'))).toBeGreaterThan(80);

  const media = await page.evaluate(async () => {
    const url = window.__videoMerger.getOutputUrl();
    const mediaInfo = await window.__vmTest.inspectMedia(url);
    const audio = await window.__vmTest.audioStats(url, [[0.5, 1.5], [5.0, 6.0]]);
    return { media: mediaInfo, audio };
  });
  expect(media.media.hasVideo).toBe(true);
  expect(media.media.width).toBe(640);
  expect(media.media.height).toBe(360);
  expect(media.media.videoCodec).toBe('avc');
  expect(media.media.audioCodec).toBe('aac');
  expect(media.media.audioChannels).toBe(2);
  expect(media.media.audioSampleRate).toBe(48000);
  expect(media.media.duration).toBeGreaterThan(7.4);
  expect(media.media.duration).toBeLessThan(8.3);
  expect(media.audio.segments[0].every((value) => value > 0.02)).toBe(true);
  expect(media.audio.segments[1].every((value) => value > 0.02)).toBe(true);

  const order = await orderMatches(page, sources);
  expect(order.map((entry) => entry.best)).toEqual([0, 1, 2]);

  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('[data-result-video]');
    if (video.readyState < 1) return null;
    return { width: video.videoWidth, height: video.videoHeight, error: video.error?.code ?? null };
  }), { timeout: 20000 }).toEqual({ width: 640, height: 360, error: null });

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trim-4s-merged.mp4');

  await page.click('[data-new-merge]');
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  const reset = await state(page);
  expect(reset.clips).toEqual([]);
  expect(reset.output).toBeNull();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('normalizes a rotated clip and preserves its orientation', async ({ page }) => {
  await openPage(page);
  await addFixtures(page, [fixturePath('trim-rotated.mp4'), fixturePath('trim-4s.mp4')]);

  const initial = await state(page);
  expect(initial.clips[0].width).toBe(360);
  expect(initial.clips[0].height).toBe(640);
  expect(initial.outputSize).toEqual({ width: 360, height: 640 });

  await mergeAndWait(page);
  await expect(page.locator('[data-result-resolution]')).toHaveText('360 × 640');

  const media = await page.evaluate(async () => {
    const url = window.__videoMerger.getOutputUrl();
    return window.__vmTest.inspectMedia(url);
  });
  expect(media.width).toBe(360);
  expect(media.height).toBe(640);
  expect(media.rotation).toBe(0);
  expect(media.duration).toBeGreaterThan(5.6);
  expect(media.duration).toBeLessThan(6.6);

  const urls = await page.evaluate(async () => {
    const current = window.__videoMerger.getState();
    const url = window.__videoMerger.getOutputUrl();
    const offset = current.clips[0].duration;
    const output = await window.__vmTest.frameGrid(url, 0.6, 360, 640, '#0f172a', 'contain');
    const rotated = await window.__vmTest.frameGrid(
      '/tests/fixtures/trim-rotated.mp4',
      0.6,
      360,
      640,
      '#0f172a',
      'contain'
    );
    const landscape = await window.__vmTest.frameGrid(
      '/tests/fixtures/trim-4s.mp4',
      0.6,
      360,
      640,
      '#0f172a',
      'contain'
    );
    const secondOutput = await window.__vmTest.frameGrid(url, offset + 0.6, 360, 640, '#0f172a', 'contain');
    const secondLandscape = await window.__vmTest.frameGrid(
      '/tests/fixtures/trim-4s.mp4',
      0.6,
      360,
      640,
      '#0f172a',
      'contain'
    );
    return {
      firstRotated: window.__vmTest.difference(output, rotated),
      firstLandscape: window.__vmTest.difference(output, landscape),
      secondLandscape: window.__vmTest.difference(secondOutput, secondLandscape)
    };
  });
  expect(urls.firstRotated).toBeLessThan(urls.firstLandscape);
  expect(urls.secondLandscape).toBeLessThan(12);
});

test('pads with the chosen color and fills by cropping without stretching', async ({ page }) => {
  await openPage(page);
  await addFixtures(page, [fixturePath('trim-portrait.mp4'), fixturePath('trim-short.mp4')]);
  await page.evaluate(() =>
    window.__videoMerger.setSettings({ aspect: '1:1', resolution: '480', fit: 'contain', background: '#ffffff' })
  );
  await waitForSupport(page);
  await expect(page.locator('[data-output-size]')).toHaveText('480 × 480');
  await mergeAndWait(page);
  await expect(page.locator('[data-result-resolution]')).toHaveText('480 × 480');

  const padded = await page.evaluate(async () => {
    const url = window.__videoMerger.getOutputUrl();
    return {
      bar: await window.__vmTest.pixel(url, 0.5, 480, 480, 20, 240, '#ffffff', 'contain'),
      middle: await window.__vmTest.pixel(url, 0.5, 480, 480, 240, 240, '#ffffff', 'contain'),
      metadata: await window.__vmTest.inspectMedia(url)
    };
  });
  expect(padded.bar.every((value) => value > 245)).toBe(true);
  expect(padded.middle.some((value) => value < 220)).toBe(true);
  expect(padded.metadata.width).toBe(480);
  expect(padded.metadata.height).toBe(480);

  await page.click('[data-new-merge]');
  await addFixtures(page, [fixturePath('trim-portrait.mp4'), fixturePath('trim-short.mp4')]);
  await page.evaluate(() =>
    window.__videoMerger.setSettings({ aspect: '1:1', resolution: '480', fit: 'cover', background: '#0f172a' })
  );
  await waitForSupport(page);
  await mergeAndWait(page);

  const cropped = await page.evaluate(async () => {
    const url = window.__videoMerger.getOutputUrl();
    return {
      left: await window.__vmTest.pixel(url, 0.5, 480, 480, 8, 240, '#0f172a', 'contain'),
      right: await window.__vmTest.pixel(url, 0.5, 480, 480, 472, 240, '#0f172a', 'contain'),
      middle: await window.__vmTest.pixel(url, 0.5, 480, 480, 240, 240, '#0f172a', 'contain')
    };
  });
  for (const sample of [cropped.left, cropped.right, cropped.middle]) {
    expect(sample.some((value) => value < 220)).toBe(true);
  }
});

test('normalizes mixed audio rates and channels while keeping silence', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await openPage(page);
  await addFixtures(page, [
    fixturePath('trim-pcm.mov'),
    fixturePath('trim-44100.mp4'),
    fixturePath('trim-ulaw.mov'),
    fixturePath('trim-2s-mute.mp4')
  ]);

  const before = await state(page);
  expect(before.clips[1].duration).toBeGreaterThan(1.5);
  expect(before.outputSize).toEqual({ width: 320, height: 180 });

  await mergeAndWait(page);
  await expect(page.locator('[data-result-name]')).toHaveText('trim-pcm-merged.mp4');
  await expect(page.locator('[data-result-audio]')).toHaveText('Audio included');
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:06\./);

  const analysis = await page.evaluate(async () => {
    const url = window.__videoMerger.getOutputUrl();
    return {
      media: await window.__vmTest.inspectMedia(url),
      audio: await window.__vmTest.audioStats(url, [
        [0.2, 1.3],
        [1.7, 2.9],
        [3.3, 4.4],
        [5.0, 6.4]
      ])
    };
  });

  expect(analysis.media.audioChannels).toBe(2);
  expect(analysis.media.audioSampleRate).toBe(48000);
  expect(analysis.media.audioCodec).toBe('aac');
  expect(analysis.audio.segments[0].every((value) => value > 0.03)).toBe(true);
  expect(analysis.audio.segments[1].every((value) => value > 0.03)).toBe(true);
  expect(analysis.audio.segments[2].every((value) => value > 0.03)).toBe(true);
  expect(analysis.audio.segments[3].every((value) => value < 0.005)).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test('exports a genuine WebM at a vertical 9:16 size', async ({ page }) => {
  await openPage(page);
  await addFixtures(page, [
    fixturePath('trim-pcm.mov'),
    fixturePath('trim-44100.mp4'),
    fixturePath('trim-3s.webm')
  ]);
  await expect(page.locator('[data-format] option[value="webm"]')).toBeEnabled();
  await page.evaluate(() =>
    window.__videoMerger.setSettings({
      format: 'webm',
      aspect: '9:16',
      resolution: '720',
      fit: 'cover',
      quality: 'low',
      background: '#2563eb'
    })
  );
  await waitForSupport(page);
  await expect(page.locator('[data-output-size]')).toHaveText('720 × 1280');

  await mergeAndWait(page);
  await expect(page.locator('[data-result-name]')).toHaveText('trim-pcm-merged.webm');
  await expect(page.locator('[data-result-format]')).toContainText('WebM');
  await expect(page.locator('[data-result-resolution]')).toHaveText('720 × 1280');

  const media = await page.evaluate(async () => window.__vmTest.inspectMedia(window.__videoMerger.getOutputUrl()));
  expect(media.hasVideo).toBe(true);
  expect(media.videoCodec).toBe('vp9');
  expect(media.audioCodec).toBe('opus');
  expect(media.audioChannels).toBe(2);
  expect(media.audioSampleRate).toBe(48000);
  expect(media.width).toBe(720);
  expect(media.height).toBe(1280);
  expect(media.duration).toBeGreaterThan(5.7);
  expect(media.duration).toBeLessThan(6.6);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trim-pcm-merged.webm');
});

test('merges silent clips without inventing an audio track', async ({ page }) => {
  await openPage(page);
  const silent = fs.readFileSync(fixturePath('trim-2s-mute.mp4'));
  await page.setInputFiles('[data-file-input]', [
    { name: 'silent-a.mp4', mimeType: 'video/mp4', buffer: silent },
    { name: 'silent-b.mp4', mimeType: 'video/mp4', buffer: silent }
  ]);
  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 90000 });
  await page.waitForFunction(() => window.__videoMerger?.getState().clips.length === 2, null, { timeout: 60000 });
  await waitForSupport(page);

  await mergeAndWait(page);
  await expect(page.locator('[data-result-name]')).toHaveText('silent-a-merged.mp4');
  await expect(page.locator('[data-result-audio]')).toHaveText('No audio track');
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:04\./);

  const media = await page.evaluate(async () => {
    const url = window.__videoMerger.getOutputUrl();
    return window.__vmTest.inspectMedia(url);
  });
  expect(media.width).toBe(480);
  expect(media.height).toBe(270);
  expect(media.hasAudio).toBe(false);
  expect(media.audioCodec).toBeNull();
  expect(media.duration).toBeGreaterThan(3.6);
  expect(media.duration).toBeLessThan(4.4);
});

test('rejects corrupt, unsupported and audio-only files without losing valid clips', async ({ page }) => {
  await openPage(page);

  await page.setInputFiles('[data-file-input]', fixturePath('trim-not-video.avi'));
  await expect(page.locator('[data-global-error]')).toContainText(/trim-not-video\.avi.*Unsupported file type/i);
  await expect(page.locator('[data-loading]')).toBeHidden();
  await expect(page.locator('[data-clip-list]')).toBeHidden();

  await page.setInputFiles('[data-file-input]', fixturePath('trim-corrupt.mp4'));
  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('[data-global-error]')).toContainText(/trim-corrupt\.mp4.*supported video/i);
  await expect(page.locator('[data-clip-list]')).toBeHidden();

  const audioOnly = fs.readFileSync(fixturePath('trim-audio-only.m4a'));
  await page.setInputFiles('[data-file-input]', {
    name: 'audio-only.mp4',
    mimeType: 'video/mp4',
    buffer: audioOnly
  });
  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('[data-global-error]')).toContainText(/audio-only\.mp4.*No video track/i);
  await expect(page.locator('[data-clip-list]')).toBeHidden();

  await page.setInputFiles('[data-file-input]', [fixturePath('trim-4s.mp4'), fixturePath('trim-corrupt.mp4')]);
  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 60000 });
  await page.waitForFunction(() => window.__videoMerger?.getState().clips.length === 1, null, { timeout: 60000 });
  await waitForSupport(page);
  await expect(page.locator('[data-global-error]')).toContainText(/trim-corrupt\.mp4.*supported video/i);
  await expect(page.locator('[data-clip-list] [data-clip-id]')).toHaveCount(1);
  await expect(page.locator('[data-merge]')).toBeDisabled();

  await page.setInputFiles('[data-file-input]', fixturePath('trim-portrait.mp4'));
  await page.waitForFunction(() => window.__videoMerger?.getState().clips.length === 2, null, { timeout: 60000 });
  await waitForSupport(page);
  await expect(page.locator('[data-global-error]')).toBeHidden();
  await expect(page.locator('[data-merge]')).toBeEnabled();
});

test('cancels an in-progress merge and returns to the workspace', async ({ page }) => {
  await openPage(page);
  const long = fs.readFileSync(fixturePath('trim-long.mp4'));
  await page.setInputFiles('[data-file-input]', [
    { name: 'trim-long.mp4', mimeType: 'video/mp4', buffer: long },
    { name: 'trim-long-2.mp4', mimeType: 'video/mp4', buffer: long }
  ]);
  await expect(page.locator('[data-loading]')).toBeHidden({ timeout: 90000 });
  await page.waitForFunction(() => window.__videoMerger?.getState().clips.length === 2, null, { timeout: 60000 });
  await waitForSupport(page);

  await page.evaluate(() => window.__videoMerger.setSettings({ resolution: '1080', quality: 'high' }));
  await waitForSupport(page);
  await expect(page.locator('[data-merge]')).toBeEnabled();

  await page.click('[data-merge]');
  await expect(page.locator('[data-progress]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-cancel]')).toBeVisible();
  await page.click('[data-cancel]');

  await page.waitForFunction(() => window.__videoMerger.getState().exporting === false, null, { timeout: 90000 });
  await expect(page.locator('[data-global-error]')).toContainText(/Merge canceled/i);
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-clip-list] [data-clip-id]')).toHaveCount(2);
  await expect(page.locator('[data-merge]')).toBeEnabled();
  await expect(page.locator('[data-cancel]')).toBeHidden();
});

test('publishes category and sitemap discovery links', async ({ page }) => {
  await page.goto('/categories/video-editing/', { waitUntil: 'networkidle' });
  const card = page.locator('a.tool-card[href="/media-and-motion/video-merger/"]').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Video Merger');
  await expect(page.locator('a[href="/media-and-motion/video-merger/"]')).toHaveCount(2);

  const sitemap = await page.evaluate(async () => {
    const response = await fetch('/sitemap.xml');
    return response.text();
  });
  expect(sitemap).toContain('<loc>https://letitedit.com/media-and-motion/video-merger/</loc>');
});

for (const width of [320, 360, 375, 390, 430, 768, 1280]) {
  test(`fits the merger into a ${width}px viewport without overflow`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: width < 500,
      hasTouch: width < 500
    });
    const page = await context.newPage();
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      await addFixtures(page, [fixturePath('trim-4s.mp4'), fixturePath('trim-portrait.mp4')]);

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowing = [];
        document.querySelectorAll('body *').forEach((element) => {
          const style = getComputedStyle(element);
          if (style.position === 'fixed') return;
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1)) {
            overflowing.push(element.tagName + '.' + String(element.className || ''));
          }
        });
        return { overflow: doc.scrollWidth - doc.clientWidth, overflowing: overflowing.slice(0, 8) };
      });
      expect(layout.overflow).toBe(0);
      expect(layout.overflowing).toEqual([]);

      await expect(page.locator('[data-clip-list] [data-clip-id]')).toHaveCount(2);
      await expect(page.locator('[data-dropzone]')).toBeVisible();
      await expect(page.locator('[data-settings]')).toBeVisible();
      await expect(page.locator('[data-merge]')).toBeVisible();
      await expect(page.locator('[data-preview-sequence]')).toBeVisible();

      for (let index = 0; index < 2; index += 1) {
        const item = page.locator('[data-clip-list] [data-clip-id]').nth(index);
        await expect(item.locator('[data-action="preview"]')).toBeVisible();
        await expect(item.locator('[data-action="up"]')).toBeVisible();
        await expect(item.locator('[data-action="down"]')).toBeVisible();
        await expect(item.locator('[data-action="remove"]')).toBeVisible();
        const box = await item.locator('[data-action="up"]').boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(30);
      }
    } finally {
      await context.close();
    }
  });
}
