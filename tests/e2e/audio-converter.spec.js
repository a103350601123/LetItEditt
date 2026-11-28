'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const PAGE = '/media-and-motion/audio-converter/';
const CATEGORY = '/categories/audio-music-editing/';
const TRIMMER = '/media-and-motion/audio-trimmer/';
const MERGER = '/media-and-motion/audio-merger/';
const VIDEO_CONVERTER = '/media-and-motion/video-converter/';
const ROOT = path.resolve(__dirname, '..', '..');

/* Build a real PCM WAV in memory so every test decodes genuine samples. */
function makeWav({ seconds = 2, rate = 44100, channels = 2, freq = 440, amplitude = 0.5 } = {}) {
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
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.sin((2 * Math.PI * freq * (channel + 1) * frame) / rate) * amplitude;
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

function wavFile(name, options = {}) {
  return { name, mimeType: 'audio/wav', buffer: makeWav(options) };
}

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await page.waitForFunction(() => window.__AC__?.debug().capabilities.mp3Probed, null, { timeout: 30000 });
}

async function getDebug(page) {
  return page.evaluate(() => window.__AC__.debug());
}

async function loadFiles(page, files) {
  await page.setInputFiles('[data-file-input]', files);
  await page.waitForFunction(
    (count) => {
      const debug = window.__AC__ && window.__AC__.debug();
      const loading = document.querySelector('[data-loading]');
      return Boolean(debug) && debug.fileCount === count && Boolean(loading) && loading.hidden;
    },
    files.length,
    { timeout: 90000 }
  );
}

async function waitForConversion(page, timeout = 120000) {
  await page.waitForFunction(() => !window.__AC__.debug().converting, null, { timeout });
}

async function convertSingle(page, format, options = {}) {
  if (format) await page.selectOption('[data-format]', format);
  if (options.rate) await page.selectOption('[data-rate]', String(options.rate));
  if (options.channels) await page.selectOption('[data-channels]', options.channels);
  if (options.bitrate) {
    await page.selectOption('[data-bitrate]', String(options.bitrate));
    await expect(page.locator('[data-quality]')).toHaveValue('custom');
  }
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.click('[data-convert]');
  const download = await downloadPromise;
  await waitForConversion(page);
  const filePath = await download.path();
  return { download, buffer: fs.readFileSync(filePath) };
}

function readWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const text = (offset, length) => buffer.toString('ascii', offset, offset + length);
  return {
    riff: text(0, 4),
    wave: text(8, 4),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    blockAlign: view.getUint16(32, true),
    dataBytes: view.getUint32(40, true),
    frames: view.getUint32(40, true) / view.getUint16(32, true)
  };
}

function readFlac(buffer) {
  const rate = (buffer[18] << 12) | (buffer[19] << 4) | (buffer[20] >> 4);
  const channels = ((buffer[20] >> 1) & 0x07) + 1;
  const bits = (((buffer[20] & 0x01) << 4) | (buffer[21] >> 4)) + 1;
  const total = (buffer[21] & 0x0f) * 4294967296 + buffer.readUInt32BE(22);
  return { magic: buffer.toString('ascii', 0, 4), rate, channels, bits, total };
}

function readAiff(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  const result = { form: buffer.toString('ascii', 0, 4), type: buffer.toString('ascii', 8, 12) };
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, false);
    if (id === 'COMM') {
      const raw = view.getUint16(offset + 16, false);
      const hi = view.getUint32(offset + 18, false);
      const lo = view.getUint32(offset + 22, false);
      const mantissa = (hi * 4294967296 + lo) / Math.pow(2, 63);
      result.channels = view.getUint16(offset + 8, false);
      result.frames = view.getUint32(offset + 10, false);
      result.bits = view.getUint16(offset + 14, false);
      result.rate = mantissa * Math.pow(2, (raw & 0x7fff) - 16383);
      result.mantissa = mantissa;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return result;
}

function readMp3(buffer) {
  let offset = 0;
  if (buffer.toString('ascii', 0, 3) === 'ID3') {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + size;
  }
  const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  for (let index = offset; index < buffer.length - 4; index += 1) {
    if (buffer[index] !== 0xff) continue;
    const b1 = buffer[index + 1];
    if ((b1 & 0xe0) !== 0xe0) continue;
    const version = (b1 >> 3) & 0x03;
    if (!rates[version]) continue;
    const b2 = buffer[index + 2];
    const rateIndex = (b2 >> 2) & 0x03;
    if (rateIndex === 3) continue;
    const b3 = buffer[index + 3];
    const mode = (b3 >> 6) & 0x03;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    return {
      sync: true,
      rate: rates[version][rateIndex],
      channels: mode === 3 ? 1 : 2,
      bitrateIndex,
      layer: (b1 >> 1) & 0x03
    };
  }
  return { sync: false };
}

function readMp4(buffer) {
  const result = { ftyp: buffer.toString('ascii', 4, 8), rate: 0, codec: '' };
  for (let offset = 0; offset < buffer.length - 12; offset += 1) {
    if (buffer.toString('ascii', offset, offset + 4) === 'mdhd') {
      const version = buffer[offset + 4];
      result.rate = version === 0 ? buffer.readUInt32BE(offset + 16) : buffer.readUInt32BE(offset + 24);
    }
    if (buffer.toString('ascii', offset, offset + 4) === 'mp4a') {
      result.codec = 'mp4a';
    }
  }
  return result;
}

function readOgg(buffer) {
  const result = { magic: buffer.toString('ascii', 0, 4), rate: 0, channels: 0, codec: '' };
  const index = buffer.indexOf('OpusHead');
  if (index >= 0) {
    result.codec = 'Opus';
    result.channels = buffer[index + 9];
    result.rate = buffer.readUInt32LE(index + 12);
  }
  return result;
}

function readZip(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buffer.lastIndexOf(signature);
  if (eocd < 0) throw new Error('ZIP end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid central directory entry');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const size = buffer.readUInt32LE(offset + 24);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, size, data: buffer.subarray(dataStart, dataStart + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function decodeInPage(page, buffer, rate) {
  return page.evaluate(async ({ base64, sampleRate }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const context = new OfflineAudioContext(1, 1, sampleRate);
    const decoded = await context.decodeAudioData(bytes.buffer);
    const channel = decoded.getChannelData(0);
    let sum = 0;
    let peak = 0;
    for (let index = 0; index < channel.length; index += 1) {
      sum += channel[index] * channel[index];
      peak = Math.max(peak, Math.abs(channel[index]));
    }
    return {
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      frames: decoded.length,
      rms: Math.sqrt(sum / channel.length),
      peak
    };
  }, { base64: buffer.toString('base64'), sampleRate: rate });
}

async function decodeAiffInPage(page, buffer) {
  return page.evaluate(async (base64) => {
    const module = await import('/js/audio-codecs.js');
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const decoded = module.decodeAiff(bytes.buffer);
    const channel = decoded.channels[0];
    let sum = 0;
    for (let index = 0; index < channel.length; index += 1) sum += channel[index] * channel[index];
    return {
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels.length,
      frames: decoded.frames,
      rms: Math.sqrt(sum / channel.length)
    };
  }, buffer.toString('base64'));
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const overflowing = [];
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('.acv-table-wrap')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > width + 1 || rect.left < -1)) {
        overflowing.push({
          tag: element.tagName,
          className: String(element.className || '').slice(0, 80),
          right: Math.round(rect.right),
          left: Math.round(rect.left)
        });
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: width,
      overflow: document.documentElement.scrollWidth - width,
      overflowing: overflowing.slice(0, 8)
    };
  });
}

/* ------------------------------------------------------------------ */
/* Page, SEO and structure                                            */
/* ------------------------------------------------------------------ */

test('serves a complete, indexable tool page with real SEO structure', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await expect(page).toHaveTitle('Free Audio Converter - MP3, WAV, FLAC, M4A & OGG | LetitEdit');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Convert audio files in your browser.*No upload/
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/audio-converter/'
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Free Audio Converter - MP3, WAV, FLAC, M4A & OGG | LetitEdit'
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://letitedit.com/media-and-motion/audio-converter/'
  );

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Convert Audio Files Online');
  expect(await page.locator('h2').count()).toBeGreaterThanOrEqual(8);
  const headingLevels = await page.$$eval('h1, h2, h3, h4, h5, h6', (elements) =>
    elements.map((element) => Number(element.tagName.slice(1)))
  );
  expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);
  for (let index = 1; index < headingLevels.length; index += 1) {
    expect(headingLevels[index] - headingLevels[index - 1]).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('nav.breadcrumbs')).toContainText('Audio & Music Editing');
  await expect(page.locator('nav.breadcrumbs [aria-current="page"]')).toHaveText('Audio Converter');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  const flattened = structured.flatMap((entry) => entry['@graph'] || [entry]);
  const types = flattened.map((item) => item['@type']);
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage', 'HowTo']));
  const faq = flattened.find((item) => item['@type'] === 'FAQPage');
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(8);
  expect(faq.mainEntity.every((entry) => entry.acceptedAnswer && entry.acceptedAnswer.text)).toBe(true);

  await expect(page.locator('[data-support]')).toBeHidden();
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  await expect(page.locator('[data-convert]')).toBeDisabled();
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('footer.site-footer')).toBeVisible();
  expect(await page.locator('main img').count()).toBe(0);

  const layout = await overflowReport(page);
  expect(layout.overflow).toBe(0);
  expect(layout.overflowing).toEqual([]);
  expect(pageErrors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Adding, reading and removing files                                 */
/* ------------------------------------------------------------------ */

test('reads real metadata, rejects duplicates and releases object URLs on removal', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await loadFiles(page, [
    wavFile('first.wav', { seconds: 2, rate: 44100, channels: 2 }),
    wavFile('second.wav', { seconds: 1, rate: 22050, channels: 1 })
  ]);

  const debug = await getDebug(page);
  expect(debug.fileCount).toBe(2);
  expect(debug.files[0]).toMatchObject({
    name: 'first.wav',
    format: 'wav',
    status: 'ready',
    sourceRate: 44100,
    channels: 2
  });
  expect(debug.files[0].duration).toBeCloseTo(2, 1);
  expect(debug.files[1]).toMatchObject({
    name: 'second.wav',
    format: 'wav',
    sourceRate: 22050,
    channels: 1
  });
  expect(debug.files[1].duration).toBeCloseTo(1, 1);
  await expect(page.locator('[data-summary-title]')).toHaveText('2 files ready');
  await expect(page.locator('[data-convert]')).toBeEnabled();
  await expect(page.locator('[data-convert]')).toHaveText('Convert 2 files');

  // A duplicate is refused without changing the list.
  await page.setInputFiles('[data-file-input]', [wavFile('first.wav', { seconds: 2, rate: 44100, channels: 2 })]);
  await expect(page.locator('[data-file-error]')).toBeVisible();
  await expect(page.locator('[data-file-error]')).toContainText('already in the list');
  expect((await getDebug(page)).fileCount).toBe(2);

  const sourceUrl = (await getDebug(page)).files[0].sourceUrl;
  await page.locator('[data-remove]').first().click();
  await expect(page.locator('[data-file-list] > li')).toHaveCount(1);
  expect((await getDebug(page)).fileCount).toBe(1);
  const revoked = await page.evaluate(async (url) => {
    try {
      await fetch(url);
      return false;
    } catch (error) {
      return true;
    }
  }, sourceUrl);
  expect(revoked).toBe(true);

  await page.click('[data-clear-all]');
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect((await getDebug(page)).fileCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Genuine encoding                                                   */
/* ------------------------------------------------------------------ */

test('converts WAV to a genuine MP3 with correct rate, channels and duration', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadFiles(page, [wavFile('tone.wav', { seconds: 2, rate: 44100, channels: 2, amplitude: 0.5 })]);

  const { download, buffer } = await convertSingle(page, 'mp3', { bitrate: 192 });
  expect(download.suggestedFilename()).toBe('tone.mp3');
  expect(buffer.length).toBeGreaterThan(20000);
  const frame = readMp3(buffer);
  expect(frame.sync).toBe(true);
  expect(frame.layer).toBe(1);
  expect(frame.rate).toBe(44100);
  expect(frame.channels).toBe(2);

  const decoded = await decodeInPage(page, buffer, 44100);
  expect(decoded.sampleRate).toBe(44100);
  expect(decoded.channels).toBe(2);
  expect(decoded.duration).toBeGreaterThan(1.98);
  expect(decoded.duration).toBeLessThan(2.1);
  expect(decoded.rms).toBeGreaterThan(0.3);
  expect(decoded.rms).toBeLessThan(0.4);

  const debug = await getDebug(page);
  expect(debug.files[0].status).toBe('done');
  expect(debug.files[0].result).toMatchObject({
    name: 'tone.mp3',
    mime: 'audio/mpeg',
    extension: 'mp3',
    sampleRate: 44100,
    channels: 2
  });
  expect(debug.files[0].result.formatLabel).toContain('192 kbps');
  expect(debug.files[0].result.size).toBe(buffer.length);
  await expect(page.locator('[data-download]')).toBeVisible();
  await expect(page.locator('[data-download]')).toHaveAttribute('download', 'tone.mp3');
  expect(pageErrors).toEqual([]);
});

test('writes real WAV, FLAC and AIFF files that decode back to the same audio', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadFiles(page, [wavFile('tone.wav', { seconds: 2, rate: 44100, channels: 2, amplitude: 0.5 })]);

  const wav = await convertSingle(page, 'wav');
  const wavHeader = readWav(wav.buffer);
  expect(wavHeader).toMatchObject({ riff: 'RIFF', wave: 'WAVE', channels: 2, sampleRate: 44100, bits: 16 });
  expect(wavHeader.frames).toBe(88200);
  expect(wav.buffer.length).toBe(44 + 88200 * 4);
  const wavDecoded = await decodeInPage(page, wav.buffer, 44100);
  expect(wavDecoded.rms).toBeCloseTo(0.3536, 2);

  const flac = await convertSingle(page, 'flac');
  const flacHeader = readFlac(flac.buffer);
  expect(flacHeader).toMatchObject({ magic: 'fLaC', rate: 44100, channels: 2, bits: 16, total: 88200 });
  expect(flac.buffer.length).toBeLessThan(wav.buffer.length);
  expect(flac.buffer.length).toBeGreaterThan(1000);
  const flacDecoded = await decodeInPage(page, flac.buffer, 44100);
  expect(flacDecoded.duration).toBeCloseTo(2, 2);
  expect(flacDecoded.channels).toBe(2);
  expect(flacDecoded.rms).toBeCloseTo(0.3536, 2);

  const aiff = await convertSingle(page, 'aiff');
  const aiffHeader = readAiff(aiff.buffer);
  expect(aiffHeader).toMatchObject({ form: 'FORM', type: 'AIFF', channels: 2, frames: 88200, bits: 16 });
  expect(aiffHeader.rate).toBeCloseTo(44100, 3);
  expect(aiff.buffer.length).toBe(54 + 88200 * 4);
  const aiffDecoded = await decodeAiffInPage(page, aiff.buffer);
  expect(aiffDecoded.sampleRate).toBe(44100);
  expect(aiffDecoded.channels).toBe(2);
  expect(aiffDecoded.duration).toBeCloseTo(2, 3);
  expect(aiffDecoded.rms).toBeCloseTo(0.3536, 2);
  expect(pageErrors).toEqual([]);
});

test('writes M4A/AAC and OGG/Opus through WebCodecs when the browser supports them', async ({ page }) => {
  await openPage(page);
  const capabilities = (await getDebug(page)).capabilities;
  await page.waitForFunction(() => window.__AC__.debug().capabilities.webcodecsProbed, null, { timeout: 20000 });
  const probed = (await getDebug(page)).capabilities;
  test.skip(!probed.aac || !probed.opus, 'This browser has no AAC or Opus encoder');

  await loadFiles(page, [wavFile('tone.wav', { seconds: 2, rate: 44100, channels: 2 })]);

  const m4a = await convertSingle(page, 'm4a', { bitrate: 192 });
  const mp4 = readMp4(m4a.buffer);
  expect(mp4.ftyp).toBe('ftyp');
  expect(mp4.codec).toBe('mp4a');
  expect(mp4.rate).toBe(44100);
  const m4aDecoded = await decodeInPage(page, m4a.buffer, 44100);
  expect(m4aDecoded.sampleRate).toBe(44100);
  expect(m4aDecoded.channels).toBe(2);
  expect(m4aDecoded.duration).toBeGreaterThan(1.98);
  expect(m4aDecoded.duration).toBeLessThan(2.1);
  expect(m4aDecoded.rms).toBeGreaterThan(0.3);

  const ogg = await convertSingle(page, 'ogg', { bitrate: 128 });
  const opus = readOgg(ogg.buffer);
  expect(opus).toMatchObject({ magic: 'OggS', codec: 'Opus', channels: 2, rate: 48000 });
  const oggDecoded = await decodeInPage(page, ogg.buffer, 48000);
  expect(oggDecoded.sampleRate).toBe(48000);
  expect(oggDecoded.channels).toBe(2);
  expect(oggDecoded.duration).toBeGreaterThan(1.95);
  expect(oggDecoded.rms).toBeGreaterThan(0.3);

  const debug = await getDebug(page);
  expect(debug.files[0].result.mime).toBe('audio/ogg');
  expect(capabilities.aac).toBe(true);
});

test('honours sample rate, channel and bitrate settings without faking them', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [wavFile('tone.wav', { seconds: 2, rate: 44100, channels: 2 })]);

  const low = await convertSingle(page, 'mp3', { bitrate: 64, rate: 22050, channels: 'mono' });
  const lowFrame = readMp3(low.buffer);
  expect(lowFrame.rate).toBe(22050);
  expect(lowFrame.channels).toBe(1);
  const lowDecoded = await decodeInPage(page, low.buffer, 22050);
  expect(lowDecoded.sampleRate).toBe(22050);
  expect(lowDecoded.channels).toBe(1);
  expect(lowDecoded.duration).toBeGreaterThan(1.95);

  const high = await convertSingle(page, 'mp3', { bitrate: 320 });
  expect(high.buffer.length).toBeGreaterThan(low.buffer.length * 2.5);

  // M4A cannot encode 22.05 kHz in Chrome; the option is disabled instead of lying.
  await page.selectOption('[data-format]', 'm4a');
  await expect(page.locator('[data-rate] option[value="22050"]')).toBeDisabled();
  await expect(page.locator('[data-rate] option[value="48000"]')).toBeEnabled();

  // Opus is always 48 kHz, so the other rates are disabled and auto resolves to 48 kHz.
  await page.selectOption('[data-format]', 'ogg');
  await expect(page.locator('[data-rate] option[value="44100"]')).toBeDisabled();
  await expect(page.locator('[data-rate] option[value="22050"]')).toBeDisabled();
  await expect(page.locator('[data-rate-note]')).toContainText('48 kHz');
});

/* ------------------------------------------------------------------ */
/* Batch conversion, ZIP and naming                                   */
/* ------------------------------------------------------------------ */

test('batch converts several files, keeps unique names and builds a valid ZIP', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadFiles(page, [
    wavFile('same.wav', { seconds: 2, rate: 44100, channels: 2 }),
    wavFile('same.wav', { seconds: 1, rate: 44100, channels: 2 }),
    wavFile('third.wav', { seconds: 1.5, rate: 22050, channels: 1 })
  ]);
  expect((await getDebug(page)).fileCount).toBe(3);

  let autoDownloads = 0;
  page.on('download', () => { autoDownloads += 1; });

  await page.selectOption('[data-format]', 'wav');
  await page.click('[data-convert]');
  await waitForConversion(page, 180000);
  await page.waitForTimeout(600);

  expect(autoDownloads).toBe(0);
  const debug = await getDebug(page);
  expect(debug.files.every((file) => file.status === 'done')).toBe(true);
  const names = debug.files.map((file) => file.result.name);
  expect(names[0]).toBe('same.wav');
  expect(names[1]).toBe('same (2).wav');
  expect(names[2]).toBe('third.wav');
  expect(debug.resultsVisible).toBe(true);
  expect(debug.zipVisible).toBe(true);
  await expect(page.locator('[data-download]')).toHaveCount(3);

  const zipPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('[data-download-zip]');
  const zipDownload = await zipPromise;
  expect(zipDownload.suggestedFilename()).toBe('audio-converted.zip');
  const zipBuffer = fs.readFileSync(await zipDownload.path());
  const entries = readZip(zipBuffer);
  expect(entries.map((entry) => entry.name)).toEqual(names);
  expect(entries[0].data.toString('ascii', 0, 4)).toBe('RIFF');
  expect(entries[0].data.toString('ascii', 8, 12)).toBe('WAVE');
  for (let index = 0; index < entries.length; index += 1) {
    expect(entries[index].size).toBe(debug.files[index].result.size);
    expect(readWav(entries[index].data).sampleRate).toBe(debug.files[index].result.sampleRate);
  }
  expect(pageErrors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Cross-format inputs                                                */
/* ------------------------------------------------------------------ */

test('converts real MP3, FLAC, M4A, OGG and AIFF inputs back to WAV and MP3', async ({ page }) => {
  test.setTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadFiles(page, [wavFile('tone.wav', { seconds: 2, rate: 44100, channels: 2, amplitude: 0.5 })]);

  // Produce genuine encoded fixtures with the tool itself.
  const fixtures = {};
  for (const format of ['mp3', 'flac', 'm4a', 'ogg', 'aiff']) {
    const result = await convertSingle(page, format);
    fixtures[format] = result.buffer;
  }
  expect(readMp3(fixtures.mp3).sync).toBe(true);
  expect(readFlac(fixtures.flac).magic).toBe('fLaC');
  expect(readMp4(fixtures.m4a).ftyp).toBe('ftyp');
  expect(readOgg(fixtures.ogg).codec).toBe('Opus');
  expect(readAiff(fixtures.aiff).form).toBe('FORM');

  const inputs = [
    { name: 'from-mp3.mp3', mimeType: 'audio/mpeg', buffer: fixtures.mp3 },
    { name: 'from-flac.flac', mimeType: 'audio/flac', buffer: fixtures.flac },
    { name: 'from-m4a.m4a', mimeType: 'audio/mp4', buffer: fixtures.m4a },
    { name: 'from-ogg.ogg', mimeType: 'audio/ogg', buffer: fixtures.ogg },
    { name: 'from-aiff.aiff', mimeType: 'audio/aiff', buffer: fixtures.aiff }
  ];
  const expectedRate = { 'from-mp3': 44100, 'from-flac': 44100, 'from-m4a': 44100, 'from-ogg': 48000, 'from-aiff': 44100 };

  async function batchTo(format) {
    await openPage(page);
    await loadFiles(page, inputs);
    const debug = await getDebug(page);
    expect(debug.fileCount).toBe(5);
    expect(debug.files.map((file) => file.format).sort()).toEqual(['aiff', 'flac', 'm4a', 'mp3', 'ogg']);
    expect(debug.files.every((file) => file.duration > 1.9 && file.duration < 2.2)).toBe(true);

    await page.selectOption('[data-format]', format);
    await page.click('[data-convert]');
    await waitForConversion(page, 180000);
    const after = await getDebug(page);
    expect(after.files.map((file) => [file.name, file.status, file.error])).toEqual(
      inputs.map((file) => [file.name, 'done', ''])
    );

    const zipPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.click('[data-download-zip]');
    const zipDownload = await zipPromise;
    return readZip(fs.readFileSync(await zipDownload.path()));
  }

  // Every source decodes and re-encodes to a real WAV with the right rate.
  const wavEntries = await batchTo('wav');
  expect(wavEntries.map((entry) => entry.name).sort()).toEqual([
    'from-aiff.wav', 'from-flac.wav', 'from-m4a.wav', 'from-mp3.wav', 'from-ogg.wav'
  ]);
  for (const entry of wavEntries) {
    const header = readWav(entry.data);
    expect(header).toMatchObject({ riff: 'RIFF', wave: 'WAVE', channels: 2, bits: 16 });
    const stem = entry.name.replace(/\.wav$/, '');
    expect(header.sampleRate).toBe(expectedRate[stem]);
    expect(header.frames).toBeGreaterThan(expectedRate[stem] * 1.9);
    expect(header.frames).toBeLessThan(expectedRate[stem] * 2.2);
    const decoded = await decodeInPage(page, entry.data, header.sampleRate);
    expect(decoded.channels).toBe(2);
    expect(decoded.rms).toBeGreaterThan(0.25);
    expect(decoded.rms).toBeLessThan(0.45);
  }

  // Every source also encodes to a real MP3 frame stream at the chosen rate.
  const mp3Entries = await batchTo('mp3');
  expect(mp3Entries.map((entry) => entry.name).sort()).toEqual([
    'from-aiff.mp3', 'from-flac.mp3', 'from-m4a.mp3', 'from-mp3.mp3', 'from-ogg.mp3'
  ]);
  for (const entry of mp3Entries) {
    const frame = readMp3(entry.data);
    expect(frame.sync).toBe(true);
    expect(frame.layer).toBe(1);
    expect(frame.channels).toBe(2);
    const stem = entry.name.replace(/\.mp3$/, '');
    expect(frame.rate).toBe(expectedRate[stem]);
    const decoded = await decodeInPage(page, entry.data, frame.rate);
    expect(decoded.channels).toBe(2);
    expect(decoded.duration).toBeGreaterThan(1.9);
    expect(decoded.duration).toBeLessThan(2.2);
    expect(decoded.rms).toBeGreaterThan(0.25);
  }

  expect(pageErrors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Failures and recovery                                              */
/* ------------------------------------------------------------------ */

test('reports corrupt, empty and unsupported files without losing working ones', async ({ page }) => {
  await openPage(page);
  const corrupt = Buffer.from(makeWav({ seconds: 1 }));
  // Keep the RIFF/WAVE signature so the file is accepted as WAV, but break the
  // fmt chunk so the real decoder rejects it during conversion.
  corrupt.writeUInt16LE(0, 20);
  const broken = corrupt.subarray(0, 4000);

  await page.setInputFiles('[data-file-input]', [
    { name: 'broken.wav', mimeType: 'audio/wav', buffer: broken },
    { name: 'empty.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) },
    { name: 'song.wma', mimeType: 'audio/x-ms-wma', buffer: Buffer.from([0x30, 0x26, 0xb2, 0x75, 0, 0, 0, 0]) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not audio') }
  ]);
  await page.waitForFunction(() => window.__AC__.debug().fileCount === 4, null, { timeout: 30000 });

  const debug = await getDebug(page);
  expect(debug.files[1].error).toContain('empty');
  expect(debug.files[2].error).toContain('WMA');
  expect(debug.files[3].error).toContain('does not look like audio');
  expect(debug.files.filter((file) => file.blocked).length).toBe(3);
  // The corrupt WAV still has a valid header, so it stays queued and fails at
  // decode time rather than being rejected up front.
  await expect(page.locator('[data-convert]')).toBeEnabled();
  await expect(page.locator('[data-convert]')).toHaveText('Convert file');

  await page.setInputFiles('[data-file-input]', wavFile('good.wav', { seconds: 1 }));
  await page.waitForFunction(() => window.__AC__.debug().fileCount === 5, null, { timeout: 30000 });
  await expect(page.locator('[data-convert]')).toBeEnabled();

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('[data-convert]');
  await downloadPromise;
  await waitForConversion(page);

  const after = await getDebug(page);
  expect(after.files[4].status).toBe('done');
  expect(after.files[0].status).toBe('error');
  expect(after.files[0].error.length).toBeGreaterThan(0);
  expect(after.status).toContain('1 file converted');
  await expect(page.locator('[data-file-list] > li').nth(0)).toHaveAttribute('data-status', 'error');
});

test('converts a long file, cancels a second run and recovers without a stuck UI', async ({ page }) => {
  test.setTimeout(240000);
  await openPage(page);
  const long = wavFile('long.wav', { seconds: 180, rate: 44100, channels: 2 });
  await loadFiles(page, [long]);
  const debug = await getDebug(page);
  expect(debug.files[0].duration).toBeCloseTo(180, 0);

  const wavResult = await convertSingle(page, 'wav');
  expect(wavResult.buffer.length).toBe(44 + 180 * 44100 * 4);
  expect(readWav(wavResult.buffer).frames).toBe(180 * 44100);

  // Start a slower lossy run and cancel it immediately.
  await page.selectOption('[data-format]', 'mp3');
  await page.selectOption('[data-bitrate]', '320');
  await page.click('[data-convert]');
  await page.waitForFunction(() => window.__AC__.debug().converting, null, { timeout: 10000 });
  await page.click('[data-cancel]');
  await waitForConversion(page, 60000);
  const cancelled = await getDebug(page);
  expect(cancelled.converting).toBe(false);
  expect(['cancelled', 'error', 'done']).toContain(cancelled.files[0].status);
  await expect(page.locator('[data-convert]')).toBeEnabled();
  await expect(page.locator('[data-progress]')).toBeHidden();

  // Recovery: the same file converts again after the cancellation.
  await page.selectOption('[data-format]', 'mp3');
  await page.selectOption('[data-bitrate]', '128');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.click('[data-convert]');
  const download = await downloadPromise;
  await waitForConversion(page, 120000);
  const recovered = await getDebug(page);
  expect(recovered.files[0].status).toBe('done');
  expect(fs.statSync(await download.path()).size).toBeGreaterThan(100000);
});

test('prevents a second job, enforces the 20-file limit and keeps the workspace usable', async ({ page }) => {
  await openPage(page);
  const files = [];
  for (let index = 0; index < 21; index += 1) {
    files.push(wavFile(`limit-${index}.wav`, { seconds: 0.2, rate: 22050, channels: 1 }));
  }
  await page.setInputFiles('[data-file-input]', files);
  await page.waitForFunction(() => window.__AC__.debug().fileCount >= 20, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const debug = await getDebug(page);
  expect(debug.fileCount).toBe(20);
  await expect(page.locator('[data-file-error]')).toContainText('20');

  // A second convert click while a job runs must not start another job.
  await page.selectOption('[data-format]', 'wav');
  await page.click('[data-convert]');
  await expect(page.locator('[data-convert]')).toBeDisabled();
  await expect(page.locator('[data-cancel]')).toBeVisible();
  await waitForConversion(page, 180000);
  await expect(page.locator('[data-convert]')).toBeEnabled();
  expect((await getDebug(page)).files.filter((file) => file.status === 'done').length).toBe(20);
});

/* ------------------------------------------------------------------ */
/* Playback, progress and capability honesty                          */
/* ------------------------------------------------------------------ */

test('previews a real source file and stops it on a second click', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [wavFile('tone.wav', { seconds: 3, rate: 44100, channels: 2 })]);

  const play = page.locator('[data-play]').first();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(700);
  const playing = await page.evaluate(() => {
    const player = document.querySelector('[data-player]');
    return { paused: player.paused, currentTime: player.currentTime };
  });
  expect(playing.paused).toBe(false);
  expect(playing.currentTime).toBeGreaterThan(0.1);

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  const stopped = await page.evaluate(() => document.querySelector('[data-player]').paused);
  expect(stopped).toBe(true);
});

test('reports real, monotonic conversion progress and hides it afterwards', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [wavFile('progress.wav', { seconds: 20, rate: 44100, channels: 2 })]);

  await page.evaluate(() => {
    window.__progressLog = [];
    const track = document.querySelector('[data-progress-track]');
    new MutationObserver(() => {
      window.__progressLog.push(Number(track.getAttribute('aria-valuenow')));
    }).observe(track, { attributes: true, attributeFilter: ['aria-valuenow'] });
  });

  await convertSingle(page, 'mp3', { bitrate: 320 });
  const log = await page.evaluate(() => window.__progressLog);
  expect(log.length).toBeGreaterThan(2);
  expect(log[0]).toBeLessThan(log[log.length - 1]);
  for (let index = 1; index < log.length; index += 1) {
    expect(log[index]).toBeGreaterThanOrEqual(log[index - 1]);
  }
  expect(log[log.length - 1]).toBe(100);
  await expect(page.locator('[data-progress]')).toBeHidden();
});

test('disables M4A and OGG honestly when WebCodecs is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioEncoder', { value: undefined, configurable: true });
  });
  await openPage(page);
  await page.waitForFunction(() => window.__AC__.debug().capabilities.webcodecsProbed, null, { timeout: 20000 });
  const debug = await getDebug(page);
  expect(debug.capabilities.aac).toBe(false);
  expect(debug.capabilities.opus).toBe(false);
  expect(debug.disabledFormats).toEqual(expect.arrayContaining(['m4a', 'ogg']));
  await expect(page.locator('[data-format] option[value="m4a"]')).toBeDisabled();
  await expect(page.locator('[data-format] option[value="ogg"]')).toBeDisabled();
  await expect(page.locator('[data-format] option[value="mp3"]')).toBeEnabled();
  await expect(page.locator('[data-format] option[value="wav"]')).toBeEnabled();
});

/* ------------------------------------------------------------------ */
/* Responsive, accessible and local                                   */
/* ------------------------------------------------------------------ */

for (const viewport of [
  { width: 390, height: 844, label: 'phone' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 1440, height: 900, label: 'desktop' }
]) {
  test(`fits the converter into a ${viewport.label} viewport without horizontal overflow`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__AC__?.debug().capabilities.mp3Probed, null, { timeout: 30000 });

    let layout = await overflowReport(page);
    expect(layout.overflow).toBe(0);
    expect(layout.overflowing).toEqual([]);
    await expect(page.locator('[data-dropzone]')).toBeVisible();

    await loadFiles(page, [wavFile('mobile-tone.wav', { seconds: 1, rate: 44100, channels: 2 })]);
    layout = await overflowReport(page);
    expect(layout.overflow).toBe(0);
    expect(layout.overflowing).toEqual([]);

    const sizes = await page.$$eval(
      '[data-convert], [data-cancel], [data-add-more], [data-clear-all], [data-play], [data-remove], [data-format]',
      (elements) => elements.filter((element) => element.offsetParent !== null).map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      })
    );
    for (const size of sizes) {
      expect(size.height).toBeGreaterThanOrEqual(32);
      expect(size.width).toBeGreaterThanOrEqual(28);
    }

    const tableScrolls = await page.evaluate(() => {
      const wrap = document.querySelector('.acv-table-wrap');
      return { scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth };
    });
    if (viewport.width < 700) expect(tableScrolls.scrollWidth).toBeGreaterThan(tableScrolls.clientWidth);
    await context.close();
  });
}

test('supports keyboard focus, labels, live statuses, contrast and reduced motion', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__AC__?.debug().capabilities.mp3Probed, null, { timeout: 30000 });

  const labelled = await page.$$eval('select', (selects) => selects.map((select) => {
    const id = select.getAttribute('id');
    const label = id ? document.querySelector(`label[for="${id}"]`) : null;
    return { id, hasLabel: Boolean(label && label.textContent.trim()) };
  }));
  expect(labelled.length).toBeGreaterThanOrEqual(5);
  expect(labelled.every((entry) => entry.hasLabel)).toBe(true);

  const unnamed = await page.$$eval('button', (buttons) => buttons.filter((button) => {
    const text = (button.textContent || '').trim();
    return !text && !button.getAttribute('aria-label') && !button.getAttribute('title');
  }).length);
  expect(unnamed).toBe(0);

  await expect(page.locator('[data-status]')).toHaveAttribute('aria-live', 'polite');
  await page.locator('[data-browse]').focus();
  const outline = await page.locator('[data-browse]').evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(outline.style).not.toBe('none');

  const spinner = await page.locator('.acv-spinner').evaluate((element) => getComputedStyle(element).animationName);
  expect(spinner).toBe('none');

  const contrast = await page.evaluate(() => {
    const parse = (value) => {
      const match = String(value).match(/rgba?\(([^)]+)\)/);
      return match ? match[1].split(',').slice(0, 3).map(Number) : null;
    };
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    const ratio = (first, second) => {
      const a = luminance(parse(first));
      const b = luminance(parse(second));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const button = document.querySelector('[data-convert]');
    const style = getComputedStyle(button);
    const note = document.querySelector('.acv-hint');
    const background = (element) => {
      let node = element;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        const match = String(value).match(/rgba?\(([^)]+)\)/);
        if (match) {
          const parts = match[1].split(',').map(Number);
          if (parts.length < 4 || parts[3] > 0) return value;
        }
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };
    return {
      button: ratio(style.color, style.backgroundColor),
      hint: ratio(getComputedStyle(note).color, background(note))
    };
  });
  expect(contrast.button).toBeGreaterThanOrEqual(4.5);
  expect(contrast.hint).toBeGreaterThanOrEqual(4.5);
  await context.close();
});

test('processes audio locally without uploads or third-party requests', async ({ page, baseURL }) => {
  const requests = [];
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  await openPage(page);
  await loadFiles(page, [wavFile('local.wav', { seconds: 1 })]);
  await convertSingle(page, 'mp3');

  const origin = new URL(baseURL).origin;
  // The site loads Google Tag Manager on every page. The container itself
  // requests gtag.js and sends GA4 page-view beacons; those analytics requests
  // are expected and carry no audio data. Every other external request still
  // fails this test.
  const analytics = /^https:\/\/(www\.googletagmanager\.com|www\.google-analytics\.com|analytics\.google\.com|region1\.google-analytics\.com|stats\.g\.doubleclick\.net)\//;
  const external = requests.filter((request) => !request.url.startsWith(origin) && !request.url.startsWith('blob:') && !request.url.startsWith('data:') && !analytics.test(request.url));
  expect(external).toEqual([]);
  expect(requests.filter((request) => !analytics.test(request.url)).every((request) => request.method === 'GET')).toBe(true);
  expect(requests.some((request) => /upload|convert\?/i.test(request.url))).toBe(false);
});

test('uses the approved palette, no tool images and a clean stylesheet', async ({ page }) => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'audio-converter.css'), 'utf8');
  const colours = [...new Set((css.match(/#[0-9a-fA-F]{6}\b/g) || []).map((value) => value.toLowerCase()))].sort();
  expect(colours).toEqual(['#0f172a', '#2563eb', '#60a5fa', '#64748b', '#e2e8f0', '#eff6ff', '#ffffff']);
  expect(css).not.toMatch(/url\((['"]?)(https?:)?\/\//);
  expect(css).not.toMatch(/\.(png|jpe?g|gif|webp|svg)['")]/);

  await openPage(page);
  expect(await page.locator('main img, main picture, main video').count()).toBe(0);
});

/* ------------------------------------------------------------------ */
/* Registration and regressions                                       */
/* ------------------------------------------------------------------ */

test('is registered in the category, sitemap and related routes', async ({ page, baseURL }) => {
  const category = await page.request.get(baseURL + CATEGORY);
  expect(category.ok()).toBe(true);
  const categoryHtml = await category.text();
  expect(categoryHtml).toContain('href="/media-and-motion/audio-converter/"');
  expect(categoryHtml).toContain('Audio Converter');
  expect(categoryHtml).toContain('Open Audio Converter');

  const sitemap = await page.request.get(baseURL + '/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('https://letitedit.com/media-and-motion/audio-converter/');

  await openPage(page);
  await expect(page.locator(`a[href="${TRIMMER}"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="${MERGER}"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="${VIDEO_CONVERTER}"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="${CATEGORY}"]`).first()).toBeVisible();

  // Regression: the trimmer still boots with its own workspace.
  await page.goto(TRIMMER, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
});
