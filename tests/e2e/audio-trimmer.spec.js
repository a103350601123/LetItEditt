'use strict';

const { test, expect } = require('@playwright/test');

const PAGE = '/media-and-motion/audio-trimmer/';
const CATEGORY = '/categories/audio-music-editing/';

/* Build a real PCM WAV in memory so every test decodes genuine samples. */
function makeWav({ seconds = 6, rate = 44100, channels = 2, freq = 440, amplitude = 0.5 } = {}) {
  const frames = Math.round(seconds * rate);
  const blockAlign = channels * 2;
  const dataBytes = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin((2 * Math.PI * freq * frame) / rate) * amplitude;
    for (let channel = 0; channel < channels; channel += 1) {
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
}

async function loadWav(page, options = {}) {
  const { name = 'tone-6s.wav', mimeType = 'audio/wav', ...wav } = options;
  const buffer = makeWav(wav);
  await page.setInputFiles('[data-file-input]', { name, mimeType, buffer });
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => window.__AT__?.debug().phase === 'ready', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__AT__.debug().mp3Probed, null, { timeout: 20000 });
}

async function setSelection(page, start, end) {
  const startInput = page.locator('[data-start-input]');
  const endInput = page.locator('[data-end-input]');
  await startInput.fill(start);
  await startInput.press('Enter');
  await endInput.fill(end);
  await endInput.press('Enter');
}

async function exportSelection(page, format = 'wav') {
  if (format === 'mp3') {
    await page.selectOption('[data-format]', 'mp3');
  }
  await expect(page.locator('[data-export]')).toBeEnabled();
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 60000 });
}

/* Read the actual bytes behind the download link and measure the samples. */
async function inspectWav(page) {
  return page.evaluate(async () => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bits = view.getUint16(34, true);
    const blockAlign = view.getUint16(32, true);
    const dataBytes = view.getUint32(40, true);
    const frames = dataBytes / blockAlign;
    const measured = Math.min(frames, 22050);
    let sum = 0;
    let crossings = 0;
    let previous = 0;
    for (let frame = 0; frame < measured; frame += 1) {
      const sample = view.getInt16(44 + frame * blockAlign, true) / 32768;
      sum += sample * sample;
      if (frame > 0 && (sample >= 0) !== (previous >= 0)) crossings += 1;
      previous = sample;
    }
    return {
      size: bytes.length,
      riff: text(0, 4),
      wave: text(8, 4),
      fmt: text(12, 4),
      data: text(36, 4),
      channels,
      sampleRate,
      bits,
      dataBytes,
      frames,
      duration: frames / sampleRate,
      rms: Math.sqrt(sum / measured),
      frequency: (crossings / 2) / (measured / sampleRate)
    };
  });
}

/* Confirm the exported MP3 starts with a real frame sync and is playable. */
async function inspectMp3(page) {
  return page.evaluate(async () => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    const blob = await (await fetch(href)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const objectUrl = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = objectUrl;
    const duration = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
    URL.revokeObjectURL(objectUrl);
    return {
      size: blob.size,
      type: blob.type,
      sync: bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0,
      duration
    };
  });
}

test('serves a complete, indexable tool page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await expect(page).toHaveTitle('Free Online Audio Trimmer – Cut Audio Precisely | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/audio-trimmer/'
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Trim audio in your browser for free/);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Audio Trimmer');
  await expect(page.locator('nav.breadcrumbs')).toContainText('Audio & Music Editing');
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('[data-editor]')).toBeHidden();

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('loads a real WAV, reports metadata, and draws a waveform', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadWav(page);

  await expect(page.locator('[data-file-name]')).toHaveText('tone-6s.wav');
  await expect(page.locator('[data-file-meta]')).toContainText('44.1 kHz');
  await expect(page.locator('[data-file-meta]')).toContainText('Stereo');
  await expect(page.locator('[data-total]')).toHaveText('00:06.0');
  await expect(page.locator('[data-start-input]')).toHaveValue('00:00.000');
  await expect(page.locator('[data-end-input]')).toHaveValue('00:06.000');
  await expect(page.locator('[data-selected-duration]')).toHaveText('00:06.000');
  await expect(page.locator('[data-export]')).toBeEnabled();
  await expect(page.locator('[data-dropzone]')).toBeHidden();

  const state = await page.evaluate(() => window.__AT__.debug());
  expect(state.phase).toBe('ready');
  expect(state.duration).toBeCloseTo(6, 2);
  expect(state.sampleRate).toBe(44100);
  expect(state.sourceRate).toBe(44100);
  expect(state.ratePreserved).toBe(true);
  expect(state.channels).toBe(2);
  expect(state.peaks).toBeGreaterThan(1000);
  expect(state.ticks).toBeGreaterThan(3);
  expect(state.waveformDrawn).toBe(true);

  const canvas = await page.evaluate(() => {
    const element = document.querySelector('[data-waveform]');
    return { width: element.width, height: element.height };
  });
  expect(canvas.width).toBeGreaterThan(300);
  expect(canvas.height).toBeGreaterThan(60);

  const ticks = await page.locator('[data-ticks] .atr-tick').allTextContents();
  expect(ticks.length).toBeGreaterThan(3);
  expect(ticks[0]).toMatch(/0:00|0\.0s/);

  expect(pageErrors).toEqual([]);
});

test('plays, pauses, seeks and scrubs through the audio', async ({ page }) => {
  await openPage(page);
  await loadWav(page);

  await page.click('[data-play]');
  await page.waitForFunction(() => window.__AT__.debug().playing, null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const advanced = await page.evaluate(() => window.__AT__.debug().playhead);
  expect(advanced).toBeGreaterThan(0.2);
  await expect(page.locator('[data-play-status]')).toContainText('Playing from');

  await page.click('[data-play]');
  await page.waitForFunction(() => !window.__AT__.debug().playing, null, { timeout: 5000 });
  const paused = await page.evaluate(() => window.__AT__.debug().playhead);
  expect(paused).toBeGreaterThan(0.2);
  await expect(page.locator('[data-play-status]')).toContainText('Paused at');

  await page.locator('[data-seek]').evaluate((element) => {
    element.value = '500';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__AT__.debug().playhead)).toBeCloseTo(3, 1);
  await expect(page.locator('[data-current]')).toHaveText('00:03.0');

  const box = await page.locator('[data-waveform]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await expect.poll(() => page.evaluate(() => window.__AT__.debug().playhead)).toBeGreaterThan(1.2);
  await expect.poll(() => page.evaluate(() => window.__AT__.debug().playhead)).toBeLessThan(1.8);

  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__AT__.debug().playing, null, { timeout: 5000 });
  await page.keyboard.press('k');
  await page.waitForFunction(() => !window.__AT__.debug().playing, null, { timeout: 5000 });
});

test('validates precise start and end times without fighting the typist', async ({ page }) => {
  await openPage(page);
  await loadWav(page);

  const start = page.locator('[data-start-input]');
  const end = page.locator('[data-end-input]');
  const validation = page.locator('[data-validation]');

  await start.fill('-1');
  await start.press('Enter');
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await expect(validation).toBeVisible();
  await expect(validation).toContainText(/time such as/i);
  await expect(page.locator('[data-export]')).toBeDisabled();

  await start.fill('00:01.000');
  await start.press('Enter');
  await expect(start).not.toHaveAttribute('aria-invalid', 'true');

  await end.fill('00:09.000');
  await end.press('Enter');
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(validation).toContainText(/between 0:00.000 and 00:06.000/i);
  await expect(page.locator('[data-export]')).toBeDisabled();

  await end.fill('00:00.500');
  await end.press('Enter');
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(validation).toContainText(/end time must be later/i);
  await expect(page.locator('[data-export]')).toBeDisabled();

  await end.fill('0:02.5');
  await expect(end).toHaveValue('0:02.5');
  await end.press('Enter');
  await expect(end).not.toHaveAttribute('aria-invalid', 'true');
  await expect(end).toHaveValue('00:02.500');
  await expect(validation).toBeHidden();
  await expect(page.locator('[data-selected-duration]')).toHaveText('00:01.500');
  await expect(page.locator('[data-export]')).toBeEnabled();

  await page.click('[data-reset-selection]');
  await expect(start).toHaveValue('00:00.000');
  await expect(end).toHaveValue('00:06.000');
  await expect(page.locator('[data-selected-duration]')).toHaveText('00:06.000');
});

test('previews and loops the selected section', async ({ page }) => {
  await openPage(page);
  await loadWav(page);
  await setSelection(page, '00:01.000', '00:02.000');

  await page.click('[data-preview]');
  await page.waitForFunction(() => window.__AT__.debug().previewing, null, { timeout: 5000 });
  await expect(page.locator('[data-play-status]')).toContainText('Previewing the selected section');
  await page.waitForFunction(() => !window.__AT__.debug().previewing, null, { timeout: 8000 });
  await expect(page.locator('[data-play-status]')).toContainText('Preview finished');

  await page.locator('[data-loop]').check();
  expect(await page.evaluate(() => window.__AT__.debug().loop)).toBe(true);
  await page.click('[data-preview]');
  await page.waitForFunction(() => window.__AT__.debug().previewing, null, { timeout: 5000 });
  await expect(page.locator('[data-play-status]')).toContainText('Looping the selected section');
  await page.waitForTimeout(1600);
  const looped = await page.evaluate(() => window.__AT__.debug());
  expect(looped.previewing).toBe(true);
  expect(looped.playing).toBe(true);
  expect(looped.playhead).toBeGreaterThanOrEqual(1);
  expect(looped.playhead).toBeLessThanOrEqual(2);

  await page.locator('[data-loop]').uncheck();
  await page.waitForFunction(() => !window.__AT__.debug().previewing, null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__AT__.debug().loop)).toBe(false);
});

test('exports a real trimmed WAV with the selected duration, rate and channels', async ({ page }) => {
  await openPage(page);
  await loadWav(page);
  await setSelection(page, '00:01.000', '00:02.000');
  await exportSelection(page, 'wav');

  await expect(page.locator('[data-result-name]')).toHaveText('audio-trimmed.wav');
  await expect(page.locator('[data-result-format]')).toContainText('WAV');
  await expect(page.locator('[data-result-duration]')).toHaveText('00:01.000');
  await expect(page.locator('[data-result-rate]')).toHaveText('44.1 kHz');
  await expect(page.locator('[data-result-channels]')).toHaveText('Stereo');
  await expect(page.locator('[data-result-note]')).toContainText('source sample rate');
  await expect(page.locator('[data-download]')).toHaveAttribute('aria-disabled', 'false');

  const output = await inspectWav(page);
  expect(output.riff).toBe('RIFF');
  expect(output.wave).toBe('WAVE');
  expect(output.fmt).toBe('fmt ');
  expect(output.data).toBe('data');
  expect(output.bits).toBe(16);
  expect(output.channels).toBe(2);
  expect(output.sampleRate).toBe(44100);
  expect(output.frames).toBe(44100);
  expect(output.duration).toBeCloseTo(1, 3);
  expect(output.rms).toBeGreaterThan(0.2);
  expect(output.frequency).toBeGreaterThan(400);
  expect(output.frequency).toBeLessThan(480);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('audio-trimmed.wav');

  const played = await page.evaluate(async () => {
    const audio = document.querySelector('[data-result-audio]');
    if (audio.readyState < 1) {
      await new Promise((resolve) => {
        audio.onloadedmetadata = resolve;
        setTimeout(resolve, 4000);
      });
    }
    return { duration: audio.duration, error: audio.error ? audio.error.code : null };
  });
  expect(played.error).toBeNull();
  expect(played.duration).toBeCloseTo(1, 1);

  await page.click('[data-trim-another]');
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-selected-duration]')).toHaveText('00:06.000');
  expect(await page.evaluate(() => window.__AT__.debug().hasBuffer)).toBe(true);
});

test('exports a genuine MP3 when the local encoder supports the file', async ({ page }) => {
  await openPage(page);
  await loadWav(page);

  const mp3Option = page.locator('[data-format] option[value="mp3"]');
  await expect(mp3Option).toBeEnabled();
  await expect(mp3Option).toHaveText(/MP3/);
  expect(await page.evaluate(() => window.__AT__.debug().mp3Available)).toBe(true);

  await setSelection(page, '00:00.500', '00:01.500');
  await exportSelection(page, 'mp3');

  await expect(page.locator('[data-result-name]')).toHaveText('audio-trimmed.mp3');
  await expect(page.locator('[data-result-format]')).toContainText('MP3');
  await expect(page.locator('[data-result-note]')).toContainText('lossy');

  const output = await inspectMp3(page);
  expect(output.type).toBe('audio/mpeg');
  expect(output.size).toBeGreaterThan(4000);
  expect(output.sync).toBe(true);
  expect(output.duration).not.toBeNull();
  expect(output.duration).toBeGreaterThan(0.9);
  expect(output.duration).toBeLessThan(1.2);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('audio-trimmed.mp3');
});

test('preserves a mono 22.05 kHz file and honestly disables MP3', async ({ page }) => {
  await openPage(page);
  await loadWav(page, { name: 'voice-memo-22k.wav', rate: 22050, channels: 1, seconds: 4 });

  await expect(page.locator('[data-file-meta]')).toContainText('22.05 kHz');
  await expect(page.locator('[data-file-meta]')).toContainText('Mono');
  await expect(page.locator('[data-format] option[value="mp3"]')).toBeDisabled();
  await expect(page.locator('[data-format] option[value="mp3"]')).toHaveText(/not available/i);
  await expect(page.locator('[data-format-note]')).toContainText(/22.05 kHz/);
  const state = await page.evaluate(() => window.__AT__.debug());
  expect(state.mp3Available).toBe(false);
  expect(state.sampleRate).toBe(22050);

  await setSelection(page, '00:00.500', '00:02.000');
  await exportSelection(page, 'wav');

  const output = await inspectWav(page);
  expect(output.channels).toBe(1);
  expect(output.sampleRate).toBe(22050);
  expect(output.frames).toBe(Math.round(1.5 * 22050));
  expect(output.duration).toBeCloseTo(1.5, 3);
  expect(output.rms).toBeGreaterThan(0.2);
  expect(output.frequency).toBeGreaterThan(400);
  expect(output.frequency).toBeLessThan(480);
  await expect(page.locator('[data-result-channels]')).toHaveText('Mono');
  await expect(page.locator('[data-result-rate]')).toHaveText('22.05 kHz');
});

test('keeps a 48 kHz file at 48 kHz and reports it truthfully', async ({ page }) => {
  await openPage(page);
  await loadWav(page, { name: 'studio-48k.wav', rate: 48000, channels: 1, seconds: 4 });

  await expect(page.locator('[data-file-meta]')).toContainText('48 kHz');
  await expect(page.locator('[data-file-meta]')).toContainText('Mono');
  await expect(page.locator('[data-format] option[value="mp3"]')).toBeEnabled();
  await expect(page.locator('[data-export-summary]')).toContainText('48 kHz');

  await setSelection(page, '00:01.000', '00:02.250');
  await exportSelection(page, 'wav');

  const output = await inspectWav(page);
  expect(output.channels).toBe(1);
  expect(output.sampleRate).toBe(48000);
  expect(output.frames).toBe(Math.round(1.25 * 48000));
  expect(output.duration).toBeCloseTo(1.25, 3);
  await expect(page.locator('[data-result-rate]')).toHaveText('48 kHz');

  await exportSelection(page, 'mp3');
  await expect(page.locator('[data-result-name]')).toHaveText('audio-trimmed.mp3');
  const monoMp3 = await inspectMp3(page);
  expect(monoMp3.sync).toBe(true);
  expect(monoMp3.size).toBeGreaterThan(3000);
  expect(monoMp3.duration).toBeGreaterThan(1.1);
  expect(monoMp3.duration).toBeLessThan(1.5);
});

test('rejects corrupted, empty and non-audio files and keeps the loaded audio', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadWav(page);
  await setSelection(page, '00:01.000', '00:02.000');
  await expect(page.locator('[data-export]')).toBeEnabled();

  await page.setInputFiles('[data-file-input]', {
    name: 'broken.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('this is not an audio frame at all')
  });
  await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-global-error]')).toContainText(/could not decode/i);
  await expect(page.locator('[data-editor]')).toBeVisible();
  await expect(page.locator('[data-file-name]')).toHaveText('tone-6s.wav');
  await expect(page.locator('[data-export]')).toBeEnabled();

  await page.setInputFiles('[data-file-input]', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not audio')
  });
  await expect(page.locator('[data-global-error]')).toContainText(/Choose an audio file/i);

  await page.setInputFiles('[data-file-input]', {
    name: 'empty.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.alloc(0)
  });
  await expect(page.locator('[data-global-error]')).toContainText(/empty/i);

  await expect(page.locator('[data-editor]')).toBeVisible();
  await expect(page.locator('[data-export]')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('loads another file without a refresh and releases the previous one', async ({ page }) => {
  await openPage(page);
  await loadWav(page);
  await setSelection(page, '00:01.000', '00:02.000');
  await exportSelection(page, 'wav');

  const resultUrl = await page.evaluate(() => window.__AT__.debug().result.url);
  expect(resultUrl).toMatch(/^blob:/);

  await page.setInputFiles('[data-file-input]', {
    name: 'second-take.wav',
    mimeType: 'audio/wav',
    buffer: makeWav({ name: 'second-take.wav', seconds: 3, rate: 48000, channels: 1, freq: 220 })
  });
  await page.waitForFunction(() => window.__AT__.debug().fileName === 'second-take.wav', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__AT__.debug().mp3Probed, null, { timeout: 20000 });

  await expect(page.locator('[data-file-name]')).toHaveText('second-take.wav');
  await expect(page.locator('[data-total]')).toHaveText('00:03.0');
  await expect(page.locator('[data-start-input]')).toHaveValue('00:00.000');
  await expect(page.locator('[data-end-input]')).toHaveValue('00:03.000');
  await expect(page.locator('[data-result]')).toBeHidden();
  const revoked = await page.evaluate((url) => fetch(url).then(() => 'ok', () => 'revoked'), resultUrl);
  expect(revoked).toBe('revoked');

  await page.click('[data-remove]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  const cleared = await page.evaluate(() => window.__AT__.debug());
  expect(cleared.hasBuffer).toBe(false);
  expect(cleared.result).toBeNull();
  expect(cleared.fileName).toBe('');
});

test('drags a selection handle with synthetic touch pointers', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
    await page.setInputFiles('[data-file-input]', {
      name: 'touch-tone.wav',
      mimeType: 'audio/wav',
      buffer: makeWav({ seconds: 6 })
    });
    await page.waitForFunction(() => window.__AT__?.debug().phase === 'ready', null, { timeout: 30000 });

    const touchAction = await page.evaluate(() =>
      getComputedStyle(document.querySelector('[data-handle-start]')).touchAction
    );
    expect(touchAction).toBe('none');

    const geometry = await page.evaluate(() => {
      const handle = document.querySelector('[data-handle-start]');
      const canvas = document.querySelector('[data-waveform]');
      const handleBox = handle.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      return {
        handleX: handleBox.left + handleBox.width / 2,
        handleY: handleBox.top + handleBox.height / 2,
        targetX: canvasBox.left + 14 + (canvasBox.width - 28) * (2.5 / 6)
      };
    });

    await page.evaluate(({ handleX, handleY }) => {
      document.querySelector('[data-handle-start]').dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 11,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          clientX: handleX,
          clientY: handleY
        })
      );
    }, geometry);
    expect(await page.evaluate(() => document.body.classList.contains('is-dragging'))).toBe(true);

    await page.evaluate(({ targetX, handleY }) => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 11,
          pointerType: 'touch',
          isPrimary: true,
          clientX: targetX,
          clientY: handleY
        })
      );
    }, geometry);

    const moved = await page.evaluate(() => window.__AT__.debug().selection.start);
    expect(moved).toBeGreaterThan(2.2);
    expect(moved).toBeLessThan(2.8);

    await page.evaluate(({ targetX, handleY }) => {
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 11,
          pointerType: 'touch',
          isPrimary: true,
          clientX: targetX,
          clientY: handleY
        })
      );
    }, geometry);
    expect(await page.evaluate(() => document.body.classList.contains('is-dragging'))).toBe(false);
    await expect(page.locator('[data-start-input]')).toHaveValue(/00:02\./);

    await page.click('[data-preview]');
    await page.waitForFunction(() => window.__AT__.debug().previewing, null, { timeout: 5000 });
    await page.click('[data-play]');
    await page.waitForFunction(() => !window.__AT__.debug().playing, null, { timeout: 5000 });
  } finally {
    await context.close();
  }
});

for (const width of [320, 360, 375, 390, 430]) {
  test(`fits the trimmer into a ${width}px mobile viewport`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      await page.setInputFiles('[data-file-input]', {
        name: 'mobile-tone.wav',
        mimeType: 'audio/wav',
        buffer: makeWav({ seconds: 4 })
      });
      await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
      await page.waitForFunction(() => window.__AT__?.debug().phase === 'ready', null, { timeout: 30000 });

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowing = [];
        document.querySelectorAll('body *').forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1)) {
            overflowing.push(element.tagName + '.' + String(element.className || ''));
          }
        });
        return { overflow: doc.scrollWidth - doc.clientWidth, overflowing: overflowing.slice(0, 5) };
      });
      expect(layout.overflow).toBe(0);
      expect(layout.overflowing).toEqual([]);

      await expect(page.locator('[data-waveform]')).toBeVisible();
      await expect(page.locator('[data-start-input]')).toBeVisible();
      await expect(page.locator('[data-export]')).toBeVisible();

      const handleBox = await page.locator('[data-handle-start]').boundingBox();
      expect(handleBox.width).toBeGreaterThanOrEqual(18);
      expect(handleBox.height).toBeGreaterThan(40);
    } finally {
      await context.close();
    }
  });
}

test('fits tablet and desktop viewports without overflow', async ({ browser, baseURL }) => {
  for (const [width, height] of [[768, 1024], [834, 1112], [1280, 900], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow, `overflow at ${width}px`).toBe(0);
      await expect(page.locator('[data-browse]')).toBeVisible();
      const card = await page.locator('[data-app]').boundingBox();
      expect(card.width).toBeLessThanOrEqual(width);
    } finally {
      await context.close();
    }
  }
});

test('is registered in the audio category, sitemap and existing related routes', async ({ page, baseURL }) => {
  const category = await page.request.get(baseURL + CATEGORY);
  expect(category.ok()).toBe(true);
  const categoryHtml = await category.text();
  expect(categoryHtml).toContain('/media-and-motion/audio-trimmer/');
  expect(categoryHtml).toContain('Audio Trimmer');
  expect(categoryHtml).not.toContain('No tools are published');

  const sitemap = await page.request.get(baseURL + '/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('<loc>https://letitedit.com/media-and-motion/audio-trimmer/</loc>');

  await page.goto(CATEGORY);
  const card = page.locator('.tool-card[href="/media-and-motion/audio-trimmer/"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Audio Trimmer');
  await card.click();
  await expect(page).toHaveURL(/\/media-and-motion\/audio-trimmer\/$/);
  await expect(page.locator('h1')).toHaveText('Free Online Audio Trimmer');

  const related = await page.$$eval('.related-list a', (links) => links.map((link) => link.getAttribute('href')));
  expect(related.length).toBeGreaterThan(0);
  for (const href of related) {
    const response = await page.request.get(baseURL + href);
    expect(response.ok(), `related route ${href}`).toBe(true);
  }
});
