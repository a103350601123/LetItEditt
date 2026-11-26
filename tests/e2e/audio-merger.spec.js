'use strict';

const fs = require('fs');
const { test, expect } = require('@playwright/test');

const PAGE = '/media-and-motion/audio-merger/';
const CONVERTER = '/media-and-motion/audio-converter/';
const TRIMMER = '/media-and-motion/audio-trimmer/';
const CATEGORY = '/categories/audio-music-editing/';

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
    const value = Math.sin((2 * Math.PI * freq * frame) / rate) * amplitude;
    for (let channel = 0; channel < channels; channel += 1) {
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

function wavFile(name, options = {}) {
  return { name, mimeType: 'audio/wav', buffer: makeWav(options) };
}

/* Build a real AIFF or AIFC file, including 24-bit and little-endian sowt variants. */
function extended80(value) {
  const bytes = Buffer.alloc(10);
  if (!(value > 0)) return bytes;
  const exponent = Math.floor(Math.log2(value));
  const mantissa = Number.isInteger(value) && exponent <= 63
    ? BigInt(value) << BigInt(63 - exponent)
    : BigInt(Math.round(value * Math.pow(2, 63 - exponent)));
  bytes.writeUInt16BE(exponent + 16383, 0);
  bytes.writeUInt32BE(Number((mantissa >> 32n) & 0xffffffffn), 2);
  bytes.writeUInt32BE(Number(mantissa & 0xffffffffn), 6);
  return bytes;
}

function makeAiff({
  seconds = 1,
  rate = 44100,
  channels = 2,
  freq = 440,
  amplitude = 0.4,
  bits = 16,
  aifc = false,
  littleEndian = false
} = {}) {
  const frames = Math.round(seconds * rate);
  const bytesPerSample = bits / 8;
  const dataBytes = frames * channels * bytesPerSample;
  const commSize = aifc ? 22 : 18;
  const ssndSize = 8 + dataBytes;
  const formSize = 4 + (8 + commSize) + (8 + ssndSize);
  const buffer = Buffer.alloc(8 + formSize);
  buffer.write('FORM', 0);
  buffer.writeUInt32BE(formSize, 4);
  buffer.write(aifc ? 'AIFC' : 'AIFF', 8);
  buffer.write('COMM', 12);
  buffer.writeUInt32BE(commSize, 16);
  buffer.writeUInt16BE(channels, 20);
  buffer.writeUInt32BE(frames, 22);
  buffer.writeUInt16BE(bits, 26);
  extended80(rate).copy(buffer, 28);
  if (aifc) buffer.write(littleEndian ? 'sowt' : 'NONE', 38);
  const ssnd = 20 + commSize;
  buffer.write('SSND', ssnd);
  buffer.writeUInt32BE(ssndSize, ssnd + 4);
  buffer.writeUInt32BE(0, ssnd + 8);
  buffer.writeUInt32BE(0, ssnd + 12);
  let offset = ssnd + 16;
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin((2 * Math.PI * freq * frame) / rate) * amplitude;
    for (let channel = 0; channel < channels; channel += 1) {
      if (bits === 16) {
        const sample = Math.round(value * 32767);
        if (littleEndian) buffer.writeInt16LE(sample, offset);
        else buffer.writeInt16BE(sample, offset);
        offset += 2;
      } else if (bits === 24) {
        const sample = Math.round(value * 8388607);
        const unsigned = sample < 0 ? sample + 0x1000000 : sample;
        if (littleEndian) {
          buffer[offset] = unsigned & 0xff;
          buffer[offset + 1] = (unsigned >> 8) & 0xff;
          buffer[offset + 2] = (unsigned >> 16) & 0xff;
        } else {
          buffer[offset] = (unsigned >> 16) & 0xff;
          buffer[offset + 1] = (unsigned >> 8) & 0xff;
          buffer[offset + 2] = unsigned & 0xff;
        }
        offset += 3;
      } else {
        buffer.writeInt8(Math.round(value * 127), offset);
        offset += 1;
      }
    }
  }
  return buffer;
}

function aiffFile(name, options = {}) {
  return { name, mimeType: options.aifc ? 'audio/x-aiff' : 'audio/aiff', buffer: makeAiff(options) };
}

/* Generate real MP3/FLAC/M4A/OGG fixtures with the existing converter tool. */
async function convertFixtures(page, formats) {
  await page.goto(CONVERTER, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__AC__?.debug().capabilities.mp3Probed, null, { timeout: 30000 });
  await page.setInputFiles('[data-file-input]', {
    name: 'fixture-tone.wav',
    mimeType: 'audio/wav',
    buffer: makeWav({ seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 })
  });
  await page.waitForFunction(() => window.__AC__?.debug().fileCount === 1, null, { timeout: 30000 });
  const fixtures = {};
  for (const format of formats) {
    await page.selectOption('[data-format]', format);
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await page.click('[data-convert]');
    const download = await downloadPromise;
    await page.waitForFunction(() => !window.__AC__.debug().converting, null, { timeout: 120000 });
    fixtures[format] = fs.readFileSync(await download.path());
  }
  return fixtures;
}

/* Record a real audio-only WebM/Opus file in the page. */
async function makeWebmAudio(page, seconds = 1) {
  const bytes = await page.evaluate(async (duration) => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 523.25;
    gain.gain.value = 0.4;
    oscillator.connect(gain);
    gain.connect(destination);
    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(destination.stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    oscillator.start();
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    recorder.stop();
    oscillator.stop();
    await stopped;
    await context.close();
    const blob = new Blob(chunks, { type: mimeType });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, seconds);
  return Buffer.from(bytes);
}

/* Encode a real ADTS AAC file with WebCodecs when this Chrome can encode AAC. */
async function makeAdtsAac(page, seconds = 1) {
  const bytes = await page.evaluate(async (duration) => {
    if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return null;
    const rate = 44100;
    const config = { codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: 1, bitrate: 128000 };
    try {
      const support = await AudioEncoder.isConfigSupported(config);
      if (!support.supported) return null;
    } catch (error) {
      return null;
    }
    const frames = Math.round(duration * rate);
    const samples = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / rate) * 0.4;
    }
    const chunks = [];
    let failure = null;
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push(data);
      },
      error: (error) => { failure = error; }
    });
    try {
      encoder.configure(config);
      encoder.encode(new AudioData({
        format: 'f32',
        sampleRate: rate,
        numberOfFrames: frames,
        numberOfChannels: 1,
        timestamp: 0,
        data: samples
      }));
      await encoder.flush();
    } catch (error) {
      try { encoder.close(); } catch (closeError) { /* already closed */ }
      return null;
    }
    encoder.close();
    if (failure || !chunks.length) return null;
    const parts = [];
    for (const payload of chunks) {
      const frameLength = 7 + payload.length;
      const header = new Uint8Array(7);
      header[0] = 0xff;
      header[1] = 0xf1;
      header[2] = (1 << 6) | (4 << 2);
      header[3] = (1 << 6) | ((frameLength >> 11) & 0x03);
      header[4] = (frameLength >> 3) & 0xff;
      header[5] = ((frameLength & 0x07) << 5) | 0x1f;
      header[6] = 0xfc;
      parts.push(header, payload);
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return Array.from(result);
  }, seconds);
  return bytes ? Buffer.from(bytes) : null;
}

function contrastRatio(first, second) {
  const parse = (value) => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    return match[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part));
  };
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const left = parse(first);
  const right = parse(second);
  if (!left || !right) return 0;
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await page.waitForFunction(() => window.__AM__?.debug().mp3Probed, null, { timeout: 25000 });
}

async function loadFiles(page, files) {
  await page.setInputFiles('[data-file-input]', files);
  await page.waitForFunction(
    (count) => {
      const debug = window.__AM__ && window.__AM__.debug();
      return Boolean(debug) && debug.trackCount === count && !debug.loading;
    },
    files.length,
    { timeout: 60000 }
  );
}

async function getDebug(page) {
  return page.evaluate(() => window.__AM__.debug());
}

async function exportMix(page, format) {
  if (format) await page.selectOption('[data-format]', format);
  await expect(page.locator('[data-export]')).toBeEnabled();
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('[data-progress]')).toBeHidden();
}

async function readWav(page, windows = []) {
  return page.evaluate((ranges) => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    return fetch(href)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        const text = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
        const channels = view.getUint16(22, true);
        const sampleRate = view.getUint32(24, true);
        const bits = view.getUint16(34, true);
        const blockAlign = view.getUint16(32, true);
        const dataBytes = view.getUint32(40, true);
        const frames = dataBytes / blockAlign;
        const stats = (start, end, channel = 0) => {
          const first = Math.max(0, Math.floor(start * sampleRate));
          const last = Math.min(frames, Math.ceil(end * sampleRate));
          let sum = 0;
          let peak = 0;
          let crossings = 0;
          let previous = 0;
          let maxDelta = 0;
          let count = 0;
          for (let frame = first; frame < last; frame += 1) {
            const sample = view.getInt16(44 + frame * blockAlign + channel * 2, true) / 32768;
            sum += sample * sample;
            const absolute = Math.abs(sample);
            if (absolute > peak) peak = absolute;
            if (frame > first && (sample >= 0) !== (previous >= 0)) crossings += 1;
            if (frame > first) {
              const delta = Math.abs(sample - previous);
              if (delta > maxDelta) maxDelta = delta;
            }
            previous = sample;
            count += 1;
          }
          return {
            rms: Math.sqrt(sum / Math.max(1, count)),
            peak,
            maxDelta,
            crossings,
            frames: count,
            seconds: count / sampleRate,
            frequency: (crossings / 2) / (count / sampleRate)
          };
        };
        return {
          size: bytes.length,
          riff: text(0, 4),
          wave: text(8, 4),
          fmt: text(12, 4),
          data: text(36, 4),
          channels,
          sampleRate,
          bits,
          blockAlign,
          dataBytes,
          frames,
          duration: frames / sampleRate,
          windows: ranges.map(([start, end, channel]) => stats(start, end, channel || 0))
        };
      });
  }, windows);
}

/* Confirm an exported MP3 starts with a real frame sync and is playable. */
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

async function setTransition(page, index, mode, value) {
  if (mode) {
    await page.locator('[data-transition-row]').nth(index).locator('[data-transition-mode]').selectOption(mode);
  }
  if (value !== undefined) {
    await page.locator('[data-transition-row]').nth(index).locator('[data-custom-duration]').evaluate((element, next) => {
      element.value = String(next);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
}

async function setVolume(page, index, value) {
  await page.locator('.amg-track').nth(index).locator('[data-track-volume]').evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

function trackNames(page) {
  return page.locator('.amg-track .amg-track-head strong').allTextContents();
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing = [];
    document.querySelectorAll('body *').forEach((element) => {
      if (element.closest('[data-timeline-scroll]')) return;
      if (element.closest('.visually-hidden')) return;
      if (element.classList.contains('skip-link')) return;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1)) {
        overflowing.push(`${element.tagName}.${String(element.className || '')}`);
      }
    });
    return { overflow: doc.scrollWidth - doc.clientWidth, overflowing: overflowing.slice(0, 8) };
  });
}

test('serves a complete, indexable tool page with real SEO structure', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await expect(page).toHaveTitle('Merge Audio Online Free - Combine MP3, WAV & More | LetitEdit');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /Merge audio files online for free.*No upload/
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/audio-merger/'
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Merge Audio Online Free - Combine MP3, WAV & More | LetitEdit'
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://letitedit.com/media-and-motion/audio-merger/'
  );

  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Merge Audio Files Online');
  expect(await page.locator('h2').count()).toBeGreaterThanOrEqual(8);
  const headingLevels = await page.$$eval('h1, h2, h3, h4, h5, h6', (elements) =>
    elements.map((element) => Number(element.tagName.slice(1)))
  );
  expect(headingLevels.filter((level) => level === 1)).toHaveLength(1);
  for (let index = 1; index < headingLevels.length; index += 1) {
    expect(headingLevels[index] - headingLevels[index - 1]).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('nav.breadcrumbs')).toContainText('Audio & Music Editing');
  await expect(page.locator('nav.breadcrumbs [aria-current="page"]')).toHaveText('Audio Merger');

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) =>
    nodes.map((node) => JSON.parse(node.textContent))
  );
  const flattened = structured.flatMap((entry) => entry['@graph'] || [entry]);
  const types = flattened.map((item) => item['@type']);
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));
  const faq = flattened.find((item) => item['@type'] === 'FAQPage');
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(8);
  expect(faq.mainEntity.every((entry) => entry.acceptedAnswer && entry.acceptedAnswer.text)).toBe(true);

  await expect(page.locator('[data-support]')).toBeHidden();
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeDisabled();
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('footer.site-footer')).toBeVisible();

  const layout = await overflowReport(page);
  expect(layout.overflow).toBe(0);
  expect(layout.overflowing).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('decodes multiple files once, reports metadata and draws real waveforms', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await page.evaluate(() => {
    window.__loadingSeen = [];
    const label = document.querySelector('[data-loading-text]');
    const observer = new MutationObserver(() => window.__loadingSeen.push(label.textContent));
    observer.observe(label, { childList: true, subtree: true, characterData: true });
  });

  await loadFiles(page, [
    wavFile('intro-440.wav', { seconds: 1.2, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('voice-660.wav', { seconds: 0.8, rate: 48000, channels: 1, freq: 660, amplitude: 0.25 }),
    wavFile('outro-880.wav', { seconds: 1, rate: 44100, channels: 2, freq: 880, amplitude: 0.3 })
  ]);

  const debug = await getDebug(page);
  expect(debug.phase).toBe('ready');
  expect(debug.trackCount).toBe(3);
  expect(debug.decodeCount).toBe(3);
  expect(debug.totalDuration).toBeCloseTo(3, 2);
  expect(debug.outputRate).toBe(48000);
  expect(debug.channels).toBe(2);
  expect(debug.tracks.map((track) => track.name)).toEqual(['intro-440.wav', 'voice-660.wav', 'outro-880.wav']);
  expect(debug.tracks.map((track) => track.sampleRate)).toEqual([44100, 48000, 44100]);
  expect(debug.tracks.map((track) => track.sourceRate)).toEqual([44100, 48000, 44100]);
  expect(debug.tracks.every((track) => track.ratePreserved)).toBe(true);
  expect(debug.tracks.map((track) => track.channels)).toEqual([2, 1, 2]);
  expect(debug.tracks.every((track) => track.peaks > 1000)).toBe(true);
  expect(debug.tracks.every((track) => track.peak > 0.2 && track.rms > 0.1)).toBe(true);
  expect(debug.trackCanvases).toBe(3);
  expect(debug.timelineDrawn).toBe(true);
  expect(debug.timelineSegments).toBe(3);
  expect(debug.timelineGaps).toBe(0);
  expect(debug.timelineCrossfades).toBe(0);
  expect(debug.timelineWidth).toBeGreaterThan(100);

  await expect(page.locator('[data-summary-title]')).toHaveText('3 tracks ready');
  await expect(page.locator('[data-summary-meta]')).toContainText('00:03.0');
  await expect(page.locator('[data-summary-meta]')).toContainText('48 kHz');
  await expect(page.locator('[data-summary-meta]')).toContainText('Stereo');
  await expect(page.locator('[data-seq-total]')).toHaveText('00:03.0');
  await expect(page.locator('[data-transition-row]')).toHaveCount(2);
  await expect(page.locator('[data-format-note]')).toContainText('48 kHz');
  expect(debug.mp3Available).toBe(true);

  const seen = await page.evaluate(() => window.__loadingSeen);
  expect(seen.some((text) => /Reading|Decoding|Building/.test(text))).toBe(true);

  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-track-wave]')).every((canvas) => canvas.width > 20 && canvas.height > 20)
  );
  const painted = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-track-wave]')).map((canvas) => {
      const context = canvas.getContext('2d');
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let blue = 0;
      for (let index = 0; index < data.length; index += 16) {
        if (data[index + 2] > data[index] && data[index + 2] > 120) blue += 1;
      }
      return blue;
    })
  );
  expect(painted.length).toBe(3);
  expect(painted.every((count) => count > 0)).toBe(true);

  const trackMeta = await page.locator('.amg-track-head span').allTextContents();
  expect(trackMeta[0]).toContain('44.1 kHz');
  expect(trackMeta[0]).toContain('Stereo');
  expect(trackMeta[1]).toContain('48 kHz');
  expect(trackMeta[1]).toContain('Mono');
  expect(trackMeta.every((text) => /RMS -?\d/.test(text))).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('merges two real tracks at a zero gap with exact timing and no silence', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadFiles(page, [
    wavFile('first-440.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('second-880.wav', { seconds: 1, rate: 44100, channels: 2, freq: 880, amplitude: 0.2 })
  ]);

  const debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(2, 3);
  expect(debug.transitions[0].mode).toBe('gap');
  expect(debug.transitions[0].duration).toBe(0);
  expect(debug.segments[1].start).toBeCloseTo(1, 4);

  await exportMix(page, 'wav');
  const wav = await readWav(page, [[0.1, 0.9], [0.98, 1.02], [1.1, 1.9]]);
  expect(wav.riff).toBe('RIFF');
  expect(wav.wave).toBe('WAVE');
  expect(wav.fmt).toBe('fmt ');
  expect(wav.data).toBe('data');
  expect(wav.bits).toBe(16);
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(44100);
  expect(wav.frames).toBe(88200);
  expect(wav.duration).toBeCloseTo(2, 4);

  const [first, boundary, second] = wav.windows;
  expect(first.rms).toBeCloseTo(0.2828, 2);
  expect(second.rms).toBeCloseTo(0.1414, 2);
  expect(boundary.rms).toBeGreaterThan(0.05);
  expect(first.frequency).toBeGreaterThan(425);
  expect(first.frequency).toBeLessThan(455);
  expect(second.frequency).toBeGreaterThan(860);
  expect(second.frequency).toBeLessThan(900);
  expect(first.peak).toBeLessThanOrEqual(0.41);
  expect(second.peak).toBeLessThanOrEqual(0.21);

  await expect(page.locator('[data-result-name]')).toHaveText('letitedit-merged-audio.wav');
  await expect(page.locator('[data-result-format]')).toContainText('WAV');
  await expect(page.locator('[data-result-duration]')).toHaveText('00:02.000');
  await expect(page.locator('[data-result-size]')).not.toHaveText('-');
  await expect(page.locator('[data-result-rate]')).toHaveText('44.1 kHz');
  await expect(page.locator('[data-result-channels]')).toHaveText('Stereo');
  await expect(page.locator('[data-result-tracks]')).toHaveText('2');
  await expect(page.locator('[data-result-safety]')).toHaveText('Not needed');

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('letitedit-merged-audio.wav');

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
  expect(played.duration).toBeCloseTo(2, 1);
  expect(pageErrors).toEqual([]);
});

test('inserts a real silence gap, clamps invalid durations and releases the old result', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('gap-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('gap-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 880, amplitude: 0.2 })
  ]);

  await page.locator('[data-transition-row]').nth(0).locator('[data-preset-duration="1"]').click();
  let debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(3, 3);
  expect(debug.transitions[0].mode).toBe('gap');
  expect(debug.transitions[0].duration).toBe(1);
  expect(debug.segments[1].start).toBeCloseTo(2, 3);
  await expect(page.locator('[data-transition-status]')).toContainText('silence gap');

  await exportMix(page, 'wav');
  const wav = await readWav(page, [[0.1, 0.9], [1.15, 1.85], [2.1, 2.9]]);
  expect(wav.frames).toBe(132300);
  expect(wav.duration).toBeCloseTo(3, 4);
  expect(wav.windows[0].rms).toBeGreaterThan(0.25);
  expect(wav.windows[1].rms).toBeLessThan(0.003);
  expect(wav.windows[1].peak).toBeLessThan(0.006);
  expect(wav.windows[2].rms).toBeGreaterThan(0.12);
  await expect(page.locator('[data-result-duration]')).toHaveText('00:03.000');

  await setTransition(page, 0, null, 0.5);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(0.5);
  expect(debug.totalDuration).toBeCloseTo(2.5, 3);
  await expect(page.locator('[data-result]')).toBeHidden();

  await setTransition(page, 0, null, -2);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(0);
  expect(debug.totalDuration).toBeCloseTo(2, 3);
  await expect(page.locator('[data-transition-status]')).toContainText(/limited to 0 s/i);

  await setTransition(page, 0, null, 99);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(30);
  expect(debug.totalDuration).toBeCloseTo(32, 3);
  await expect(page.locator('[data-transition-row] [data-custom-duration]')).toHaveAttribute('max', '30');
  await expect(page.locator('[data-transition-status]')).toContainText(/limited to 30 s/i);

  await page.locator('[data-transition-row]').nth(0).locator('[data-preset-duration="0"]').click();
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(0);
  expect(debug.totalDuration).toBeCloseTo(2, 3);
});

test('applies a real equal-power crossfade, caps it at half the shorter track and stays audible', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('fade-a.wav', { seconds: 2, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('fade-b.wav', { seconds: 2, rate: 44100, channels: 2, freq: 880, amplitude: 0.4 })
  ]);

  await setTransition(page, 0, 'crossfade');
  let debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(3, 3);
  expect(debug.transitions[0].mode).toBe('crossfade');
  expect(debug.transitions[0].duration).toBe(1);
  expect(debug.transitions[0].start).toBeCloseTo(1, 3);
  expect(debug.transitions[0].end).toBeCloseTo(2, 3);
  expect(debug.segments[0].fadeOut).toBe(1);
  expect(debug.segments[1].fadeIn).toBe(1);
  expect(debug.timelineCrossfades).toBe(1);
  await expect(page.locator('[data-transition-status]')).toContainText('Crossfade enabled');

  await exportMix(page, 'wav');
  const windows = [[0.2, 0.8], [1, 1.05], [1.45, 1.55], [1.95, 2], [2.2, 2.8]];
  const wav = await readWav(page, windows);
  expect(wav.frames).toBe(132300);
  expect(wav.duration).toBeCloseTo(3, 4);
  expect(wav.windows[0].rms).toBeGreaterThan(0.25);
  expect(wav.windows[2].rms).toBeGreaterThan(0.22);
  expect(wav.windows[1].rms).toBeGreaterThan(0.18);
  expect(wav.windows[3].rms).toBeGreaterThan(0.18);
  expect(wav.windows[4].rms).toBeGreaterThan(0.25);
  expect(wav.windows.every((window) => window.rms > 0.15)).toBe(true);

  await page.click('[data-seq-play]');
  await page.waitForFunction(() => window.__AM__.debug().seqPlaying, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__AM__.debug().seqBufferDuration)).toBeCloseTo(3, 2);
  await page.click('[data-seq-play]');
  await page.waitForFunction(() => !window.__AM__.debug().seqPlaying, null, { timeout: 5000 });

  await setTransition(page, 0, null, 5);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(1);
  expect(debug.totalDuration).toBeCloseTo(3, 3);
  await expect(page.locator('[data-transition-status]')).toContainText(/limited to 1 s/i);
  await expect(page.locator('[data-transition-row] [data-custom-duration]')).toHaveAttribute('max', '1');

  await setTransition(page, 0, null, 0.001);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBeCloseTo(0.01, 4);
  expect(debug.totalDuration).toBeCloseTo(3.99, 3);
  await expect(page.locator('[data-transition-status]')).toContainText(/limited to 0.01 s/i);

  await page.locator('[data-transition-row]').nth(0).locator('[data-preset-duration="0.5"]').click();
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(0.5);
  expect(debug.totalDuration).toBeCloseTo(3.5, 3);
});

test('applies different transitions on different boundaries with exact layout math', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('mix-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('mix-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 }),
    wavFile('mix-c.wav', { seconds: 1, rate: 44100, channels: 2, freq: 880, amplitude: 0.4 })
  ]);

  await setTransition(page, 0, 'crossfade', 0.5);
  await setTransition(page, 1, 'linear', 0.25);
  let debug = await getDebug(page);
  expect(debug.transitions.map((item) => item.mode)).toEqual(['crossfade', 'linear']);
  expect(debug.transitions.map((item) => item.duration)).toEqual([0.5, 0.25]);
  expect(debug.segments.map((item) => item.start)).toEqual([0, 0.5, 1.25]);
  expect(debug.totalDuration).toBeCloseTo(2.25, 3);
  expect(debug.timelineCrossfades).toBe(2);
  expect(debug.timelineGaps).toBe(0);
  await expect(page.locator('[data-transition-row]').nth(0).locator('.amg-transition-note'))
    .toContainText('Equal-power overlap');
  await expect(page.locator('[data-transition-row]').nth(1).locator('.amg-transition-note'))
    .toContainText('Linear overlap');

  await exportMix(page, 'wav');
  const wav = await readWav(page, [[0.1, 0.4], [0.6, 0.9], [1.1, 1.2], [1.6, 2.1]]);
  expect(wav.frames).toBe(Math.round(2.25 * 44100));
  expect(wav.duration).toBeCloseTo(2.25, 3);
  expect(wav.windows.every((window) => window.rms > 0.08)).toBe(true);

  await setTransition(page, 0, 'gap', 0.5);
  await setTransition(page, 1, 'dip', 0.5);
  debug = await getDebug(page);
  expect(debug.transitions.map((item) => item.mode)).toEqual(['gap', 'dip']);
  expect(debug.segments.map((item) => item.start)).toEqual([0, 1.5, 2]);
  expect(debug.totalDuration).toBeCloseTo(3, 3);
  expect(debug.timelineGaps).toBe(1);
  expect(debug.timelineCrossfades).toBe(1);

  await exportMix(page, 'wav');
  const mixed = await readWav(page, [[0.1, 0.8], [1.05, 1.45], [2.1, 2.9]]);
  expect(mixed.duration).toBeCloseTo(3, 3);
  expect(mixed.windows[0].rms).toBeGreaterThan(0.2);
  expect(mixed.windows[1].rms).toBeLessThan(0.003);
  expect(mixed.windows[2].rms).toBeGreaterThan(0.1);
});

test('implements every transition type with audible, click-free audio', async ({ page }) => {
  test.setTimeout(240000);
  await openPage(page);
  await loadFiles(page, [
    wavFile('types-a.wav', { seconds: 2, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('types-b.wav', { seconds: 2, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
  ]);

  const cases = [
    { mode: 'cut', duration: null, total: 4 },
    { mode: 'gap', duration: 0.5, total: 4.5 },
    { mode: 'crossfade', duration: 0.5, total: 3.5 },
    { mode: 'linear', duration: 0.5, total: 3.5 },
    { mode: 'smooth', duration: 0.5, total: 3.5 },
    { mode: 'dip', duration: 0.5, total: 3.5 },
    { mode: 'fade', duration: 0.5, total: 4 },
    { mode: 'fadein', duration: 0.5, total: 4 },
    { mode: 'fadeout', duration: 0.5, total: 4 }
  ];
  const centerRms = {};
  for (const item of cases) {
    await setTransition(page, 0, item.mode, item.duration === null ? undefined : item.duration);
    const debug = await getDebug(page);
    expect(debug.transitions[0].mode).toBe(item.mode);
    expect(debug.totalDuration).toBeCloseTo(item.total, 3);
    if (item.mode === 'cut') {
      expect(debug.transitions[0].duration).toBe(0);
      expect(debug.timelineCuts).toBe(1);
    } else {
      expect(debug.transitions[0].duration).toBeCloseTo(item.duration, 3);
      if (item.mode === 'gap') expect(debug.timelineGaps).toBe(1);
      else if (['crossfade', 'linear', 'smooth', 'dip'].includes(item.mode)) {
        expect(debug.timelineCrossfades).toBe(1);
      } else {
        expect(debug.timelineFades).toBe(1);
      }
    }

    await exportMix(page, 'wav');
    const windows = [
      [0.2, 0.8],
      [1.7, 1.8],
      [1.98, 2.02],
      [2.6, 3.2],
      [2.05, 2.45],
      [2, 2.05],
      [1.95, 1.995],
      [1.73, 1.77]
    ];
    const wav = await readWav(page, windows);
    expect(wav.duration).toBeCloseTo(item.total, 3);
    expect(wav.windows[0].rms).toBeGreaterThan(0.15);
    expect(wav.windows[0].peak).toBeLessThanOrEqual(0.99);
    expect(wav.windows[2].maxDelta).toBeLessThan(0.2);

    if (item.mode === 'gap') {
      expect(wav.windows[4].rms).toBeLessThan(0.003);
      expect(wav.windows[3].rms).toBeGreaterThan(0.15);
    } else if (item.mode === 'fade') {
      expect(wav.windows[2].rms).toBeLessThan(0.03);
      expect(wav.windows[3].rms).toBeGreaterThan(0.15);
    } else if (item.mode === 'fadein') {
      expect(wav.windows[5].rms).toBeLessThan(0.08);
      expect(wav.windows[3].rms).toBeGreaterThan(0.15);
    } else if (item.mode === 'fadeout') {
      expect(wav.windows[6].rms).toBeLessThan(0.08);
      expect(wav.windows[3].rms).toBeGreaterThan(0.15);
    } else if (item.mode === 'cut') {
      expect(wav.windows[1].rms).toBeGreaterThan(0.15);
      expect(wav.windows[2].rms).toBeGreaterThan(0.15);
      expect(wav.windows[3].rms).toBeGreaterThan(0.15);
    } else {
      expect(wav.windows[1].rms).toBeGreaterThan(0.08);
      expect(wav.windows[2].rms).toBeGreaterThan(0.08);
      expect(wav.windows[3].rms).toBeGreaterThan(0.15);
    }
    centerRms[item.mode] = wav.windows[7].rms;
  }

  expect(centerRms.crossfade).toBeGreaterThan(centerRms.linear + 0.03);
  expect(centerRms.linear).toBeGreaterThan(centerRms.dip + 0.03);
});

test('clamps new transition durations on very short tracks and accepts custom values', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('short-a.wav', { seconds: 0.3, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('short-b.wav', { seconds: 0.3, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
  ]);

  for (const mode of ['crossfade', 'linear', 'smooth', 'dip', 'fade', 'fadein', 'fadeout']) {
    await setTransition(page, 0, mode, 5);
    const debug = await getDebug(page);
    expect(debug.transitions[0].mode).toBe(mode);
    expect(debug.transitions[0].duration).toBeCloseTo(0.15, 4);
    const overlap = ['crossfade', 'linear', 'smooth', 'dip'].includes(mode);
    expect(debug.totalDuration).toBeCloseTo(overlap ? 0.45 : 0.6, 4);
    await expect(page.locator('[data-transition-status]')).toContainText(/limited to 0.15 s/i);
    await expect(page.locator('[data-transition-row] [data-custom-duration]')).toHaveAttribute('max', '0.15');
  }

  await setTransition(page, 0, 'gap', 5);
  let debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(5);
  expect(debug.totalDuration).toBeCloseTo(5.6, 4);
  await setTransition(page, 0, null, 99);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(30);
  expect(debug.totalDuration).toBeCloseTo(30.6, 4);
  await expect(page.locator('[data-transition-status]')).toContainText(/limited to 30 s/i);

  await setTransition(page, 0, 'linear', 0.05);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(0.05);
  expect(debug.totalDuration).toBeCloseTo(0.55, 4);
  await setTransition(page, 0, null, 0);
  debug = await getDebug(page);
  expect(debug.transitions[0].duration).toBe(0.01);
  expect(debug.totalDuration).toBeCloseTo(0.59, 4);
});

test('previews the same non-crossfade transition mix that it exports', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('preview-dip-a.wav', { seconds: 2, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('preview-dip-b.wav', { seconds: 1.5, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);

  await setTransition(page, 0, 'dip', 0.5);
  let debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(3, 3);
  expect(debug.timelineCrossfades).toBe(1);
  expect(debug.timelineFades).toBe(0);

  await page.click('[data-seq-play]');
  await page.waitForFunction(() => window.__AM__.debug().seqPlaying, null, { timeout: 30000 });
  debug = await getDebug(page);
  expect(debug.seqBufferDuration).toBeCloseTo(3, 2);
  await page.click('[data-seq-play]');
  await page.waitForFunction(() => !window.__AM__.debug().seqPlaying, null, { timeout: 5000 });

  await exportMix(page, 'wav');
  debug = await getDebug(page);
  expect(debug.result.duration).toBeCloseTo(3, 3);
  expect(debug.result.duration).toBeCloseTo(debug.totalDuration, 3);
  expect(debug.seqBufferDuration).toBeCloseTo(debug.result.duration, 2);
});

test('changes per-track volume, mute and reset, and scales the master only to stop clipping', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('loud-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.8 }),
    wavFile('loud-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 880, amplitude: 0.8 })
  ]);

  await setVolume(page, 0, 0.5);
  await page.locator('.amg-track').nth(1).locator('[data-mute]').click();
  let debug = await getDebug(page);
  expect(debug.tracks[0].volume).toBe(0.5);
  expect(debug.tracks[1].muted).toBe(true);
  expect(debug.totalDuration).toBeCloseTo(2, 3);
  await expect(page.locator('.amg-track').nth(0).locator('[data-volume-out]')).toHaveText('50%');
  await expect(page.locator('.amg-track').nth(1).locator('[data-mute]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.amg-track').nth(1).locator('[data-mute]')).toHaveText('Unmute');

  await exportMix(page, 'wav');
  let wav = await readWav(page, [[0.1, 0.9], [1.1, 1.9]]);
  expect(wav.windows[0].rms).toBeCloseTo(0.2828, 2);
  expect(wav.windows[1].rms).toBeLessThan(0.001);
  expect(wav.windows[1].peak).toBeLessThan(0.002);
  await expect(page.locator('[data-result-safety]')).toHaveText('Not needed');

  await page.locator('.amg-track').nth(1).locator('[data-mute]').click();
  await page.locator('.amg-track').nth(0).locator('[data-reset-volume]').click();
  await setVolume(page, 0, 1.5);
  await setVolume(page, 1, 1.5);
  debug = await getDebug(page);
  expect(debug.tracks.map((track) => track.volume)).toEqual([1.5, 1.5]);
  expect(debug.tracks[1].muted).toBe(false);
  await expect(page.locator('.amg-track').nth(0).locator('[data-volume-out]')).toHaveText('150%');

  await exportMix(page, 'wav');
  wav = await readWav(page, [[0.1, 1.9]]);
  debug = await getDebug(page);
  expect(debug.safetyScale).toBeLessThan(0.9);
  expect(debug.renderedPeak).toBeGreaterThan(1);
  expect(wav.windows[0].peak).toBeLessThanOrEqual(0.991);
  expect(wav.windows[0].peak).toBeGreaterThan(0.9);
  expect(wav.windows[0].rms).toBeGreaterThan(0.4);
  await expect(page.locator('[data-result-safety]')).toContainText('Scaled');
  await expect(page.locator('[data-result-safety]')).not.toHaveText('Not needed');
});

test('previews tracks and the full sequence with seeks, restart and updated gaps', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('preview-a.wav', { seconds: 2, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('preview-b.wav', { seconds: 1.5, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);

  let debug = await getDebug(page);
  expect(debug.previewDirty).toBe(true);
  await expect(page.locator('[data-preview-badge]')).toBeVisible();
  await expect(page.locator('[data-preview-badge]')).toHaveText('Preview not prepared');

  await page.locator('.amg-track').nth(0).locator('[data-preview-track]').click();
  await page.waitForFunction(() => window.__AM__.debug().trackPreviewPlaying, null, { timeout: 5000 });
  await expect(page.locator('[data-play-status]')).toContainText('Previewing preview-a.wav');
  await page.locator('.amg-track').nth(0).locator('[data-preview-track]').click();
  await page.waitForFunction(() => !window.__AM__.debug().trackPreviewPlaying, null, { timeout: 5000 });

  await page.click('[data-seq-play]');
  await page.waitForFunction(() => window.__AM__.debug().seqPlaying, null, { timeout: 30000 });
  debug = await getDebug(page);
  expect(debug.seqReady).toBe(true);
  expect(debug.seqBufferDuration).toBeCloseTo(3.5, 2);
  expect(debug.seqBufferRate).toBe(44100);
  await expect(page.locator('[data-preview-badge]')).toBeHidden();
  await expect(page.locator('[data-play-status]')).toContainText('Playing the merged sequence');
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.__AM__.debug().seqPlayhead)).toBeGreaterThan(0.2);

  await page.click('[data-seq-play]');
  await page.waitForFunction(() => !window.__AM__.debug().seqPlaying, null, { timeout: 5000 });
  const paused = await page.evaluate(() => window.__AM__.debug().seqPlayhead);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__AM__.debug().seqPlayhead)).toBeCloseTo(paused, 1);
  await expect(page.locator('[data-play-status]')).toContainText('Paused at');

  await page.locator('[data-seq-seek]').evaluate((element) => {
    element.value = '500';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__AM__.debug().seqPlayhead)).toBeCloseTo(1.75, 1);
  await expect(page.locator('[data-seq-current]')).toHaveText(/00:01\.[67]/);

  await page.click('[data-seq-restart]');
  expect(await page.evaluate(() => window.__AM__.debug().seqPlayhead)).toBe(0);
  await expect(page.locator('[data-play-status]')).toContainText('reset to the start');

  const box = await page.locator('[data-timeline]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await expect.poll(() => page.evaluate(() => window.__AM__.debug().seqPlayhead)).toBeCloseTo(0.875, 1);

  await page.locator('[data-seq-volume]').evaluate((element) => {
    element.value = '0.5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__AM__.debug().seqVolume)).toBeCloseTo(0.5, 2);

  await setTransition(page, 0, 'gap', 1);
  debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(4.5, 3);
  expect(debug.previewDirty).toBe(true);
  await expect(page.locator('[data-preview-badge]')).toBeVisible();
  await page.click('[data-seq-play]');
  await page.waitForFunction(() => window.__AM__.debug().seqPlaying, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__AM__.debug().seqBufferDuration)).toBeCloseTo(4.5, 2);
  await page.click('[data-seq-play]');
  await page.waitForFunction(() => !window.__AM__.debug().seqPlaying, null, { timeout: 5000 });
});

test('exports a genuine MP3 with real frames and honest lossy labelling', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('mp3-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('mp3-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);

  const option = page.locator('[data-format] option[value="mp3"]');
  await expect(option).toBeEnabled();
  expect(await page.evaluate(() => window.__AM__.debug().mp3Available)).toBe(true);
  await expect(page.locator('[data-bitrate-field]')).toBeHidden();

  await page.selectOption('[data-format]', 'mp3');
  await expect(page.locator('[data-bitrate-field]')).toBeVisible();
  await page.selectOption('[data-bitrate]', '128');
  await expect(page.locator('[data-format-note]')).toContainText('lossy');

  await exportMix(page, 'mp3');
  const output = await inspectMp3(page);
  expect(output.type).toBe('audio/mpeg');
  expect(output.size).toBeGreaterThan(4000);
  expect(output.sync).toBe(true);
  expect(output.duration).not.toBeNull();
  expect(output.duration).toBeGreaterThan(1.9);
  expect(output.duration).toBeLessThan(2.25);

  await expect(page.locator('[data-result-name]')).toHaveText('letitedit-merged-audio.mp3');
  await expect(page.locator('[data-result-format]')).toContainText('MP3');
  await expect(page.locator('[data-result-format]')).toContainText('128 kbps');
  await expect(page.locator('[data-result-note]')).toContainText('lossy');
  await expect(page.locator('[data-result-note]')).toContainText('padding');

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('letitedit-merged-audio.mp3');

  await page.selectOption('[data-format]', 'wav');
  await expect(page.locator('[data-bitrate-field]')).toBeHidden();
});

test('preserves mono and 22.05 kHz output and disables MP3 honestly', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('voice-a-22k.wav', { seconds: 1.5, rate: 22050, channels: 1, freq: 440, amplitude: 0.4 }),
    wavFile('voice-b-22k.wav', { seconds: 1, rate: 22050, channels: 1, freq: 660, amplitude: 0.3 })
  ]);

  let debug = await getDebug(page);
  expect(debug.outputRate).toBe(22050);
  expect(debug.channels).toBe(1);
  expect(debug.mp3Available).toBe(false);
  await expect(page.locator('[data-format] option[value="mp3"]')).toBeDisabled();
  await expect(page.locator('[data-format] option[value="mp3"]')).toHaveText(/not available/i);
  await expect(page.locator('[data-format-note]')).toContainText('22.05 kHz');

  await exportMix(page, 'wav');
  let wav = await readWav(page, [[0.1, 2.4]]);
  expect(wav.channels).toBe(1);
  expect(wav.sampleRate).toBe(22050);
  expect(wav.frames).toBe(Math.round(2.5 * 22050));
  expect(wav.duration).toBeCloseTo(2.5, 3);
  expect(wav.windows[0].rms).toBeGreaterThan(0.15);
  await expect(page.locator('[data-result-channels]')).toHaveText('Mono');
  await expect(page.locator('[data-result-rate]')).toHaveText('22.05 kHz');

  await page.selectOption('[data-rate]', '48000');
  debug = await getDebug(page);
  expect(debug.outputRate).toBe(48000);
  expect(debug.channels).toBe(1);
  expect(debug.mp3Available).toBe(true);
  expect(debug.decodeCount).toBe(2);
  await expect(page.locator('[data-format] option[value="mp3"]')).toBeEnabled();

  await exportMix(page, 'mp3');
  const mp3 = await inspectMp3(page);
  expect(mp3.sync).toBe(true);
  expect(mp3.size).toBeGreaterThan(3000);
  expect(mp3.duration).toBeGreaterThan(2.4);
  expect(mp3.duration).toBeLessThan(2.8);
  await expect(page.locator('[data-result-channels]')).toHaveText('Mono');
  await expect(page.locator('[data-result-rate]')).toHaveText('48 kHz');
  expect(await page.evaluate(() => window.__AM__.debug().decodeCount)).toBe(2);
});

test('honours explicit sample rate and channel settings without decoding again', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('rate-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('rate-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);
  expect(await page.evaluate(() => window.__AM__.debug().decodeCount)).toBe(2);

  await page.selectOption('[data-rate]', '32000');
  await page.selectOption('[data-channels]', 'mono');
  let debug = await getDebug(page);
  expect(debug.outputRate).toBe(32000);
  expect(debug.channels).toBe(1);
  expect(debug.tracks.map((track) => track.sampleRate)).toEqual([44100, 44100]);
  expect(debug.decodeCount).toBe(2);
  expect(debug.seqReady).toBe(false);

  await exportMix(page, 'wav');
  let wav = await readWav(page, [[0.1, 1.9]]);
  expect(wav.channels).toBe(1);
  expect(wav.sampleRate).toBe(32000);
  expect(wav.frames).toBe(64000);
  expect(wav.duration).toBeCloseTo(2, 4);
  await expect(page.locator('[data-result-rate]')).toHaveText('32 kHz');
  await expect(page.locator('[data-result-channels]')).toHaveText('Mono');

  await page.selectOption('[data-rate]', '48000');
  await page.selectOption('[data-channels]', 'stereo');
  debug = await getDebug(page);
  expect(debug.outputRate).toBe(48000);
  expect(debug.channels).toBe(2);
  expect(debug.decodeCount).toBe(2);
  await expect(page.locator('[data-summary-meta]')).toContainText('48 kHz');
  await expect(page.locator('[data-summary-meta]')).toContainText('Stereo');

  await exportMix(page, 'wav');
  wav = await readWav(page, [[0.1, 1.9]]);
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(48000);
  expect(wav.frames).toBe(96000);
  expect(await page.evaluate(() => window.__AM__.debug().decodeCount)).toBe(2);
});

test('balances quiet and loud tracks with measured RMS matching', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('quiet.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.1 }),
    wavFile('loud.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.5 })
  ]);

  await exportMix(page, 'wav');
  let wav = await readWav(page, [[0.1, 0.9], [1.1, 1.9]]);
  const unbalancedRatio = wav.windows[1].rms / wav.windows[0].rms;
  expect(unbalancedRatio).toBeGreaterThan(4);

  await page.locator('[data-balance]').check();
  const debug = await getDebug(page);
  expect(debug.balance).toBe(true);
  await expect(page.locator('[data-summary-meta]')).toContainText('RMS matching on');

  await exportMix(page, 'wav');
  wav = await readWav(page, [[0.1, 0.9], [1.1, 1.9]]);
  const balancedRatio = wav.windows[1].rms / wav.windows[0].rms;
  expect(balancedRatio).toBeGreaterThan(0.9);
  expect(balancedRatio).toBeLessThan(1.1);
  expect(wav.windows[0].peak).toBeLessThanOrEqual(0.991);
  expect(wav.windows[1].peak).toBeLessThanOrEqual(0.991);
});

test('rejects corrupted, empty and non-audio files without losing loaded tracks', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadFiles(page, [
    wavFile('keep-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('keep-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);

  await page.setInputFiles('[data-file-input]', {
    name: 'broken.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('this is not an audio frame at all')
  });
  await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-global-error]')).toContainText(/could not decode/i);
  expect(await page.evaluate(() => window.__AM__.debug().trackCount)).toBe(2);

  await page.setInputFiles('[data-file-input]', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not audio')
  });
  await expect(page.locator('[data-global-error]')).toContainText(/not an audio file/i);

  await page.setInputFiles('[data-file-input]', {
    name: 'empty.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.alloc(0)
  });
  await expect(page.locator('[data-global-error]')).toContainText(/empty/i);

  await expect(page.locator('[data-editor]')).toBeVisible();
  await expect(page.locator('[data-export]')).toBeEnabled();
  expect(await page.evaluate(() => window.__AM__.debug().trackCount)).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('merges real AIFF, AIFC, MP3, FLAC, M4A/AAC, OGG/Opus and WebM inputs', async ({ page }) => {
  test.setTimeout(300000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  const webm = await makeWebmAudio(page, 1);
  const aac = await makeAdtsAac(page, 1);
  const fixtures = await convertFixtures(page, ['mp3', 'flac', 'm4a', 'ogg']);
  const aiff16 = makeAiff({ seconds: 1, bits: 16, freq: 440 });
  const aiff24 = makeAiff({ seconds: 1, bits: 24, freq: 550 });
  const aifcSowt = makeAiff({ seconds: 1, bits: 16, aifc: true, littleEndian: true, freq: 660 });
  const monoLow = makeWav({ seconds: 1, rate: 22050, channels: 1, freq: 330, amplitude: 0.4 });
  const mislabelled = makeAiff({ seconds: 1, bits: 16, freq: 770 });

  const inputs = [
    { name: 'mono-22k.wav', mimeType: 'audio/wav', buffer: monoLow },
    { name: 'tone.aiff', mimeType: 'audio/aiff', buffer: aiff16 },
    { name: 'tone-24bit.aiff', mimeType: 'audio/aiff', buffer: aiff24 },
    { name: 'tone-sowt.aifc', mimeType: 'audio/x-aiff', buffer: aifcSowt },
    { name: 'tone.aif', mimeType: 'audio/aiff', buffer: aiff16 },
    { name: 'mislabelled.wav', mimeType: 'audio/wav', buffer: mislabelled },
    { name: 'tone.mp3', mimeType: 'audio/mpeg', buffer: fixtures.mp3 },
    { name: 'tone.flac', mimeType: 'audio/flac', buffer: fixtures.flac },
    { name: 'tone.m4a', mimeType: 'audio/mp4', buffer: fixtures.m4a },
    { name: 'tone.ogg', mimeType: 'audio/ogg', buffer: fixtures.ogg },
    { name: 'tone.webm', mimeType: 'audio/webm', buffer: webm }
  ];
  if (aac) inputs.push({ name: 'tone.aac', mimeType: 'audio/aac', buffer: aac });

  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__AM__?.debug().mp3Probed, null, { timeout: 25000 });
  await loadFiles(page, inputs);

  let debug = await getDebug(page);
  expect(debug.trackCount).toBe(inputs.length);
  expect(debug.tracks.filter((track) => track.container === 'aiff')).toHaveLength(5);
  expect(debug.tracks.map((track) => track.container)).toEqual(
    expect.arrayContaining(['wav', 'aiff', 'mp3', 'flac', 'mp4', 'ogg', 'webm'])
  );
  if (aac) expect(debug.tracks.some((track) => track.container === 'aac')).toBe(true);
  expect(debug.tracks.every((track) => track.duration >= 0.85 && track.duration < 1.3)).toBe(true);
  expect(debug.tracks[0].sampleRate).toBe(22050);
  expect(debug.tracks[0].channels).toBe(1);
  expect(debug.tracks[1].sampleRate).toBe(44100);
  expect(debug.tracks[1].channels).toBe(2);
  expect(debug.tracks[2].sampleRate).toBe(44100);
  expect(debug.tracks[3].sampleRate).toBe(44100);
  expect(debug.tracks[9].sampleRate).toBe(48000);
  expect(debug.tracks[10].sampleRate).toBe(48000);

  await exportMix(page, 'wav');
  debug = await getDebug(page);
  const windows = debug.segments.map((segment) => [
    segment.start + 0.1,
    Math.max(segment.start + 0.15, Math.min(segment.end - 0.1, segment.start + 0.9))
  ]);
  const wav = await readWav(page, windows);
  expect(wav.sampleRate).toBe(48000);
  expect(wav.channels).toBe(2);
  expect(wav.duration).toBeCloseTo(debug.totalDuration, 2);
  expect(wav.windows.every((window) => window.rms > 0.05)).toBe(true);

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
  expect(played.duration).toBeCloseTo(debug.totalDuration, 1);
  expect(pageErrors).toEqual([]);
});

test('reports WMA and malformed AIFF clearly, and sniffs AIFF content behind a WAV name', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('keep-wma-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('keep-wma-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
  ]);

  await page.setInputFiles('[data-file-input]', {
    name: 'song.wma',
    mimeType: 'audio/x-ms-wma',
    buffer: Buffer.from([0x30, 0x26, 0xb2, 0x75, 0, 0, 0, 0, 0, 0, 0, 0])
  });
  await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-global-error]')).toContainText(/WMA/i);
  expect(await page.evaluate(() => window.__AM__.debug().trackCount)).toBe(2);

  const brokenAiff = Buffer.from(makeAiff({ seconds: 1 }));
  brokenAiff.writeUInt16BE(0, 20);
  await page.setInputFiles('[data-file-input]', {
    name: 'broken.aiff',
    mimeType: 'audio/aiff',
    buffer: brokenAiff
  });
  await expect(page.locator('[data-global-error]')).toContainText(/AIFF/i);
  expect(await page.evaluate(() => window.__AM__.debug().trackCount)).toBe(2);

  await page.setInputFiles('[data-file-input]', {
    name: 'actually-aiff.wav',
    mimeType: 'audio/wav',
    buffer: makeAiff({ seconds: 1, bits: 16, freq: 550 })
  });
  await page.waitForFunction(() => window.__AM__.debug().trackCount === 3, null, { timeout: 30000 });
  const debug = await getDebug(page);
  expect(debug.tracks[2].container).toBe('aiff');
  expect(debug.tracks[2].duration).toBeCloseTo(1, 2);
});

test('replaces and removes a single track, clears everything and revokes the old result', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('keep-1s.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('replace-2s.wav', { seconds: 2, rate: 44100, channels: 2, freq: 550, amplitude: 0.4 }),
    wavFile('keep-3s.wav', { seconds: 3, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
  ]);

  await setVolume(page, 1, 0.6);
  await page.locator('.amg-track').nth(1).locator('[data-mute]').click();

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.amg-track').nth(1).locator('[data-replace]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(wavFile('replacement-330.wav', {
    seconds: 0.5,
    rate: 44100,
    channels: 2,
    freq: 330,
    amplitude: 0.3
  }));
  await page.waitForFunction(
    () => window.__AM__.debug().tracks[1] && window.__AM__.debug().tracks[1].name === 'replacement-330.wav',
    null,
    { timeout: 30000 }
  );

  let debug = await getDebug(page);
  expect(debug.trackCount).toBe(3);
  expect(debug.tracks.map((track) => track.name)).toEqual(['keep-1s.wav', 'replacement-330.wav', 'keep-3s.wav']);
  expect(debug.tracks[1].volume).toBe(0.6);
  expect(debug.tracks[1].muted).toBe(true);
  expect(debug.totalDuration).toBeCloseTo(4.5, 2);
  await expect(page.locator('[data-transition-row]')).toHaveCount(2);

  await page.locator('.amg-track').nth(1).locator('[data-remove]').click();
  await expect.poll(() => page.evaluate(() => window.__AM__.debug().trackCount)).toBe(2);
  debug = await getDebug(page);
  expect(debug.tracks.map((track) => track.name)).toEqual(['keep-1s.wav', 'keep-3s.wav']);
  expect(debug.totalDuration).toBeCloseTo(4, 2);

  await exportMix(page, 'wav');
  const resultUrl = await page.evaluate(() => window.__AM__.debug().result.url);
  expect(resultUrl).toMatch(/^blob:/);

  await page.click('[data-start-over]');
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  debug = await getDebug(page);
  expect(debug.trackCount).toBe(0);
  expect(debug.result).toBeNull();
  expect(debug.audioContextState).toBe('none');
  expect(debug.trackCanvases).toBe(0);
  const revoked = await page.evaluate((url) => fetch(url).then(() => 'ok', () => 'revoked'), resultUrl);
  expect(revoked).toBe('revoked');
  expect(await page.locator('[data-file-input]').evaluate((element) => element.multiple)).toBe(true);

  await loadFiles(page, [
    wavFile('again-a.wav', { seconds: 0.5, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('again-b.wav', { seconds: 0.5, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
  ]);
  await expect(page.locator('[data-export]')).toBeEnabled();
});

test('reorders with buttons and the keyboard while transitions stay attached to their pairs', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('a-1s.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('b-2s.wav', { seconds: 2, rate: 44100, channels: 2, freq: 550, amplitude: 0.4 }),
    wavFile('c-3s.wav', { seconds: 3, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
  ]);

  await setTransition(page, 0, 'gap', 1);
  expect(await page.evaluate(() => window.__AM__.debug().totalDuration)).toBeCloseTo(7, 2);

  await page.locator('.amg-track').nth(1).locator('[data-move-up]').click();
  expect(await trackNames(page)).toEqual(['b-2s.wav', 'a-1s.wav', 'c-3s.wav']);
  let debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(6, 2);
  expect(debug.transitions.map((item) => item.duration)).toEqual([0, 0]);

  await page.locator('.amg-track').nth(1).locator('[data-drag]').focus();
  await page.keyboard.press('ArrowDown');
  expect(await trackNames(page)).toEqual(['b-2s.wav', 'c-3s.wav', 'a-1s.wav']);
  const focused = await page.evaluate(() => ({
    isHandle: document.activeElement.hasAttribute('data-drag'),
    name: document.activeElement.closest('[data-track-id]')?.querySelector('strong')?.textContent
  }));
  expect(focused.isHandle).toBe(true);
  expect(focused.name).toBe('a-1s.wav');

  await page.locator('.amg-track').nth(2).locator('[data-move-up]').click();
  expect(await trackNames(page)).toEqual(['b-2s.wav', 'a-1s.wav', 'c-3s.wav']);
  await page.locator('.amg-track').nth(0).locator('[data-move-down]').click();
  expect(await trackNames(page)).toEqual(['a-1s.wav', 'b-2s.wav', 'c-3s.wav']);

  debug = await getDebug(page);
  expect(debug.totalDuration).toBeCloseTo(7, 2);
  expect(debug.transitions[0].from).toBe(debug.tracks[0].id);
  expect(debug.transitions[0].to).toBe(debug.tracks[1].id);
  expect(debug.transitions[0].duration).toBe(1);
  await expect(page.locator('[data-transition-row]').nth(0).locator('[data-custom-duration]')).toHaveValue('1');
});

test('reorders with synthetic touch pointers without scrolling the page', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__AM__?.debug().mp3Probed, null, { timeout: 25000 });
    await loadFiles(page, [
      wavFile('touch-a.wav', { seconds: 1, rate: 22050, channels: 1, freq: 440, amplitude: 0.4 }),
      wavFile('touch-b.wav', { seconds: 1, rate: 22050, channels: 1, freq: 550, amplitude: 0.4 }),
      wavFile('touch-c.wav', { seconds: 1, rate: 22050, channels: 1, freq: 660, amplitude: 0.4 })
    ]);
    await page.locator('[data-track-list]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    const touchAction = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.amg-track [data-drag]')).touchAction
    );
    expect(touchAction).toBe('none');

    const geometry = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.amg-track'));
      const handle = cards[0].querySelector('[data-drag]');
      const handleBox = handle.getBoundingClientRect();
      const targetBox = cards[2].getBoundingClientRect();
      return {
        startX: handleBox.left + handleBox.width / 2,
        startY: handleBox.top + handleBox.height / 2,
        targetX: targetBox.left + targetBox.width / 2,
        targetY: targetBox.bottom - 4,
        scrollY: window.scrollY,
        handleWidth: handleBox.width,
        handleHeight: handleBox.height
      };
    });
    expect(geometry.handleWidth).toBeGreaterThanOrEqual(38);
    expect(geometry.handleHeight).toBeGreaterThanOrEqual(44);

    await page.evaluate(({ startX, startY }) => {
      document.querySelector('.amg-track [data-drag]').dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 21,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: startX,
        clientY: startY
      }));
    }, geometry);

    await page.evaluate(({ targetX, targetY }) => {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 21,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 1,
        clientX: targetX,
        clientY: targetY
      }));
    }, geometry);

    expect(await page.evaluate(() => document.body.classList.contains('is-reordering'))).toBe(true);
    expect(await page.locator('.amg-track').nth(2).evaluate((element) => element.classList.contains('is-drop-after'))).toBe(true);

    await page.evaluate(({ targetX, targetY }) => {
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 21,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 0,
        clientX: targetX,
        clientY: targetY
      }));
    }, geometry);

    await expect.poll(() => trackNames(page)).toEqual(['touch-b.wav', 'touch-c.wav', 'touch-a.wav']);
    expect(await page.evaluate(() => document.body.classList.contains('is-reordering'))).toBe(false);
    expect(await page.locator('.is-drop-before, .is-drop-after, .is-dragging').count()).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(geometry.scrollY, 0);

    await page.evaluate(() => window.scrollBy(0, 80));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(geometry.scrollY);

    const sizes = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      return {
        exportHeight: rect('[data-export]').height,
        muteHeight: rect('[data-mute]').height,
        presetHeight: rect('[data-preset-duration]').height,
        playHeight: rect('[data-seq-play]').height
      };
    });
    expect(sizes.exportHeight).toBeGreaterThanOrEqual(52);
    expect(sizes.muteHeight).toBeGreaterThanOrEqual(30);
    expect(sizes.presetHeight).toBeGreaterThanOrEqual(30);
    expect(sizes.playHeight).toBeGreaterThanOrEqual(38);
  } finally {
    await context.close();
  }
});

test('reorders with mouse drag events and shows a drop marker', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('drag-a.wav', { seconds: 1, rate: 22050, channels: 1, freq: 440, amplitude: 0.4 }),
    wavFile('drag-b.wav', { seconds: 1, rate: 22050, channels: 1, freq: 550, amplitude: 0.4 }),
    wavFile('drag-c.wav', { seconds: 1, rate: 22050, channels: 1, freq: 660, amplitude: 0.4 })
  ]);

  const geometry = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.amg-track'));
    const handle = cards[0].querySelector('[data-drag]');
    const handleBox = handle.getBoundingClientRect();
    const targetBox = cards[2].getBoundingClientRect();
    return {
      startX: handleBox.left + handleBox.width / 2,
      startY: handleBox.top + handleBox.height / 2,
      targetX: targetBox.left + targetBox.width / 2,
      targetY: targetBox.bottom - 4
    };
  });

  await page.evaluate(({ startX, startY }) => {
    const handle = document.querySelector('.amg-track [data-drag]');
    window.__AM_DRAG__ = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__AM_DRAG__,
      clientX: startX,
      clientY: startY
    }));
  }, geometry);

  await page.evaluate(({ targetX, targetY }) => {
    const cards = Array.from(document.querySelectorAll('.amg-track'));
    cards[2].dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__AM_DRAG__,
      clientX: targetX,
      clientY: targetY
    }));
  }, geometry);

  expect(await page.locator('.amg-track').nth(2).evaluate((element) => element.classList.contains('is-drop-after'))).toBe(true);

  await page.evaluate(({ targetX, targetY }) => {
    const cards = Array.from(document.querySelectorAll('.amg-track'));
    cards[2].dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__AM_DRAG__,
      clientX: targetX,
      clientY: targetY
    }));
  }, geometry);

  await expect.poll(() => trackNames(page)).toEqual(['drag-b.wav', 'drag-c.wav', 'drag-a.wav']);
  expect(await page.locator('.is-drop-before, .is-drop-after, .is-dragging').count()).toBe(0);
});

test('accepts a real multi-file drag-and-drop with a highlighted drop zone', async ({ page }) => {
  await openPage(page);
  const first = makeWav({ seconds: 0.5, rate: 22050, channels: 1, freq: 440 }).toString('base64');
  const second = makeWav({ seconds: 0.5, rate: 22050, channels: 1, freq: 660 }).toString('base64');

  const highlighted = await page.evaluate(({ one, two }) => {
    const decode = (data) => Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([decode(one)], 'dropped-a.wav', { type: 'audio/wav' }));
    transfer.items.add(new File([decode(two)], 'dropped-b.wav', { type: 'audio/wav' }));
    const app = document.querySelector('[data-app]');
    app.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const active = document.querySelector('[data-dropzone]').classList.contains('is-dragover') &&
      app.classList.contains('is-dragover');
    app.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return active;
  }, { one: first, two: second });

  expect(highlighted).toBe(true);
  await page.waitForFunction(
    () => window.__AM__?.debug().trackCount === 2 && !window.__AM__.debug().loading,
    null,
    { timeout: 40000 }
  );
  expect(await trackNames(page)).toEqual(['dropped-a.wav', 'dropped-b.wav']);
  await expect(page.locator('[data-dropzone]')).toBeHidden();
  await expect(page.locator('[data-editor]')).toBeVisible();
});

for (const width of [320, 360, 375, 390, 430]) {
  test(`fits the merger into a ${width}px mobile viewport with a scrollable timeline`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__AM__?.debug().mp3Probed, null, { timeout: 25000 });
      await loadFiles(page, [
        wavFile('mobile-a.wav', { seconds: 8, rate: 22050, channels: 1, freq: 440, amplitude: 0.4 }),
        wavFile('mobile-b.wav', { seconds: 8, rate: 22050, channels: 1, freq: 660, amplitude: 0.4 })
      ]);

      const report = await overflowReport(page);
      expect(report.overflow, `overflow at ${width}px`).toBe(0);
      expect(report.overflowing, `overflowing elements at ${width}px`).toEqual([]);

      const debug = await getDebug(page);
      expect(debug.timelineScrollable).toBe(true);
      expect(debug.timelineScrollWidth).toBeGreaterThan(debug.timelineClientWidth);

      await expect(page.locator('[data-track-list]')).toBeVisible();
      await expect(page.locator('[data-transition-row]')).toBeVisible();
      await expect(page.locator('[data-seq-play]')).toBeVisible();
      await expect(page.locator('[data-export]')).toBeVisible();

      const sizes = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        return {
          handleWidth: rect('.amg-track [data-drag]').width,
          handleHeight: rect('.amg-track [data-drag]').height,
          exportHeight: rect('[data-export]').height,
          playHeight: rect('[data-seq-play]').height
        };
      });
      expect(sizes.handleWidth).toBeGreaterThanOrEqual(38);
      expect(sizes.handleHeight).toBeGreaterThanOrEqual(44);
      expect(sizes.exportHeight).toBeGreaterThanOrEqual(52);
      expect(sizes.playHeight).toBeGreaterThanOrEqual(38);

      await page.evaluate(() => {
        const scroll = document.querySelector('[data-timeline-scroll]');
        scroll.scrollLeft = 120;
      });
      expect(await page.evaluate(() => document.querySelector('[data-timeline-scroll]').scrollLeft)).toBeGreaterThan(0);

      await page.evaluate(() => window.scrollTo(0, 300));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('fits tablet and desktop viewports without horizontal overflow', async ({ browser, baseURL }) => {
  for (const [width, height] of [[768, 1024], [834, 1112], [1024, 768], [1280, 900], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__AM__?.debug().mp3Probed, null, { timeout: 25000 });
      await loadFiles(page, [
        wavFile('desktop-a.wav', { seconds: 2, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
        wavFile('desktop-b.wav', { seconds: 2, rate: 44100, channels: 2, freq: 660, amplitude: 0.4 })
      ]);

      const report = await overflowReport(page);
      expect(report.overflow, `overflow at ${width}px`).toBe(0);
      expect(report.overflowing, `overflowing elements at ${width}px`).toEqual([]);
      const panel = await page.locator('[data-app]').boundingBox();
      expect(panel.width).toBeLessThanOrEqual(width);
      await expect(page.locator('[data-track-list]')).toBeVisible();
      await expect(page.locator('[data-transition-row]')).toBeVisible();
      await expect(page.locator('[data-export]')).toBeVisible();
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('supports keyboard focus, labels, live statuses, contrast and reduced motion', async ({ page }) => {
  await openPage(page);

  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.classList.contains('skip-link'))).toBe(true);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => location.hash)).toBe('#main-content');

  let reachedBrowse = false;
  for (let index = 0; index < 30; index += 1) {
    if (await page.evaluate(() => document.activeElement?.hasAttribute('data-browse'))) {
      reachedBrowse = true;
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(reachedBrowse).toBe(true);
  await expect(page.locator('[data-browse]')).toBeFocused();
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).not.toBe('0px');

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-browse]').press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles([
    wavFile('keyboard-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('keyboard-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);
  await page.waitForFunction(
    () => window.__AM__?.debug().trackCount === 2 && !window.__AM__.debug().loading,
    null,
    { timeout: 40000 }
  );

  const mute = page.locator('.amg-track').nth(0).locator('[data-mute]');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(mute).toHaveText('Unmute');

  const rangeLabels = await page.locator('input[type="range"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label'))
  );
  expect(rangeLabels.length).toBeGreaterThanOrEqual(3);
  expect(rangeLabels.every(Boolean)).toBe(true);

  const unnamed = await page.locator('.amg-track button').evaluateAll((elements) =>
    elements.filter((element) => !element.getAttribute('aria-label') && !element.textContent.trim()).length
  );
  expect(unnamed).toBe(0);

  await expect(page.locator('[data-status]')).toHaveAttribute('role', 'status');
  await expect(page.locator('[data-status]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-play-status]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-transition-status]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-loading-text]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-progress-label]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('[data-result]')).toHaveAttribute('aria-live', 'polite');

  const colors = await page.evaluate(() => {
    const background = (element) => {
      let node = element;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };
    const meta = document.querySelector('[data-summary-meta]');
    const button = document.querySelector('[data-export]');
    return {
      metaFg: getComputedStyle(meta).color,
      metaBg: background(meta),
      buttonFg: getComputedStyle(button).color,
      buttonBg: background(button)
    };
  });
  expect(contrastRatio(colors.metaFg, colors.metaBg)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.buttonFg, colors.buttonBg)).toBeGreaterThanOrEqual(4.5);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.evaluate(() => ({
    transition: getComputedStyle(document.querySelector('[data-export]')).transitionDuration,
    animation: getComputedStyle(document.querySelector('.amg-spinner')).animationName
  }));
  expect(motion.transition.split(',').every((value) => value.trim() === '0s')).toBe(true);
  expect(motion.animation).toBe('none');

  await page.setInputFiles('[data-file-input]', {
    name: 'bad.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('no audio here')
  });
  await expect(page.locator('[data-global-error]')).toBeVisible();
  await expect(page.locator('[data-global-error]')).toHaveAttribute('role', 'alert');
});

test('is registered in the category, sitemap and related routes, and the trimmer still works', async ({ page, baseURL }) => {
  const category = await page.request.get(baseURL + CATEGORY);
  expect(category.ok()).toBe(true);
  const categoryHtml = await category.text();
  expect(categoryHtml).toContain('/media-and-motion/audio-merger/');
  expect(categoryHtml).toContain('Audio Merger');
  expect(categoryHtml).toContain('Audio Trimmer');
  expect(categoryHtml).not.toContain('No tools are published');

  const sitemap = await page.request.get(baseURL + '/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('<loc>https://letitedit.com/media-and-motion/audio-merger/</loc>');

  await page.goto(CATEGORY, { waitUntil: 'networkidle' });
  const card = page.locator('.tool-card[href="/media-and-motion/audio-merger/"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Audio Merger');
  await card.click();
  await expect(page).toHaveURL(/\/media-and-motion\/audio-merger\/$/);
  await expect(page.locator('h1')).toHaveText('Merge Audio Files Online');

  const related = await page.$$eval('.related-list a', (links) => links.map((link) => link.getAttribute('href')));
  expect(related.length).toBeGreaterThan(0);
  for (const href of related) {
    const response = await page.request.get(baseURL + href);
    expect(response.ok(), `related route ${href}`).toBe(true);
  }

  await page.goto(TRIMMER, { waitUntil: 'networkidle' });
  await page.setInputFiles('[data-file-input]', wavFile('trimmer-regression.wav', {
    seconds: 1,
    rate: 44100,
    channels: 2,
    freq: 440,
    amplitude: 0.5
  }));
  await page.waitForFunction(() => window.__AT__?.debug().phase === 'ready', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__AT__.debug().mp3Probed, null, { timeout: 20000 });
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 60000 });
  const header = await page.evaluate(async () => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    return {
      channels: view.getUint16(22, true),
      rate: view.getUint32(24, true),
      frames: view.getUint32(40, true) / view.getUint16(32, true)
    };
  });
  expect(header.channels).toBe(2);
  expect(header.rate).toBe(44100);
  expect(header.frames).toBe(44100);
});

test('enforces the 20-track limit and keeps the workspace usable afterwards', async ({ page }) => {
  await openPage(page);
  const files = [];
  for (let index = 0; index < 21; index += 1) {
    files.push(wavFile(`limit-${index}.wav`, {
      seconds: 0.1,
      rate: 22050,
      channels: 1,
      freq: 300 + index * 10,
      amplitude: 0.3
    }));
  }

  await page.setInputFiles('[data-file-input]', files);
  await page.waitForFunction(
    () => window.__AM__?.debug().trackCount === 20 && !window.__AM__.debug().loading,
    null,
    { timeout: 90000 }
  );
  await expect(page.locator('[data-global-error]')).toContainText(/20 tracks can be loaded|limit is 20 tracks/i);
  expect(await page.evaluate(() => window.__AM__.debug().decodeCount)).toBe(20);

  await page.locator('.amg-track').nth(19).locator('[data-remove]').click();
  await expect.poll(() => page.evaluate(() => window.__AM__.debug().trackCount)).toBe(19);
  await page.setInputFiles('[data-file-input]', wavFile('limit-extra.wav', {
    seconds: 0.1,
    rate: 22050,
    channels: 1,
    freq: 900,
    amplitude: 0.3
  }));
  await page.waitForFunction(
    () => window.__AM__?.debug().trackCount === 20 && !window.__AM__.debug().loading,
    null,
    { timeout: 40000 }
  );
  await expect(page.locator('[data-global-error]')).toBeHidden();
  expect(await page.evaluate(() => window.__AM__.debug().decodeCount)).toBe(21);

  await page.click('[data-clear-all]');
  await expect.poll(() => page.evaluate(() => window.__AM__.debug().trackCount)).toBe(0);
  await expect(page.locator('[data-dropzone]')).toBeVisible();
});

test('processes the mix locally without uploading audio or contacting external hosts', async ({ page, baseURL }) => {
  const requests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('http')) {
      requests.push({ url, method: request.method(), type: request.resourceType() });
    }
  });

  await openPage(page);
  await loadFiles(page, [
    wavFile('local-a.wav', { seconds: 1, rate: 44100, channels: 2, freq: 440, amplitude: 0.4 }),
    wavFile('local-b.wav', { seconds: 1, rate: 44100, channels: 2, freq: 660, amplitude: 0.3 })
  ]);
  await exportMix(page, 'wav');

  expect(requests.length).toBeGreaterThan(0);
  const origin = new URL(baseURL).origin;
  // The site loads its Google Tag Manager container on every page; that single
  // loader request is expected and carries no audio data. Every other external
  // host still fails this test.
  const analyticsLoader = /^https:\/\/www\.googletagmanager\.com\/gtm\.js\?id=GTM-TRTFBNML$/;
  for (const request of requests.filter((item) => !analyticsLoader.test(item.url))) {
    expect(request.method).toBe('GET');
    expect(new URL(request.url).origin).toBe(origin);
    expect(request.url).not.toMatch(/upload|api\//i);
  }
});

test('reports real export progress, accurate result metadata and releases the blob', async ({ page }) => {
  await openPage(page);
  await loadFiles(page, [
    wavFile('long-a.wav', { seconds: 8, rate: 44100, channels: 2, freq: 440, amplitude: 0.35 }),
    wavFile('long-b.wav', { seconds: 8, rate: 44100, channels: 2, freq: 660, amplitude: 0.35 })
  ]);

  const progress = await page.evaluate(() => new Promise((resolve) => {
    const track = document.querySelector('[data-progress-track]');
    const label = document.querySelector('[data-progress-label]');
    const values = [];
    const texts = [];
    const observer = new MutationObserver(() => {
      values.push(Number(track.getAttribute('aria-valuenow')));
      texts.push(label.textContent);
    });
    observer.observe(track, { attributes: true, attributeFilter: ['aria-valuenow'] });
    observer.observe(label, { childList: true, subtree: true, characterData: true });
    document.querySelector('[data-export]').click();
    const started = Date.now();
    const timer = setInterval(() => {
      const result = document.querySelector('[data-result]');
      if (!result.hidden) {
        clearInterval(timer);
        observer.disconnect();
        resolve({ values, texts, elapsed: Date.now() - started });
      } else if (Date.now() - started > 45000) {
        clearInterval(timer);
        observer.disconnect();
        resolve({ values, texts, elapsed: -1 });
      }
    }, 40);
  }));

  expect(progress.elapsed).toBeGreaterThan(0);
  expect(progress.values.length).toBeGreaterThan(2);
  expect(Math.max(...progress.values)).toBeGreaterThanOrEqual(95);
  expect(progress.values.some((value) => value > 0 && value < 100)).toBe(true);
  expect(progress.texts.join(' ')).toMatch(/Mixing|Rendering|Writing WAV|Finalizing|Preparing/i);

  await expect(page.locator('[data-result]')).toBeVisible();
  await expect(page.locator('[data-progress]')).toBeHidden();
  await expect(page.locator('[data-result-duration]')).toHaveText('00:16.000');
  await expect(page.locator('[data-result-size]')).not.toHaveText('-');
  await expect(page.locator('[data-result-rate]')).toHaveText('44.1 kHz');
  await expect(page.locator('[data-result-channels]')).toHaveText('Stereo');
  await expect(page.locator('[data-result-tracks]')).toHaveText('2');

  const debug = await getDebug(page);
  expect(debug.workerActive).toBe(false);
  expect(debug.result.size).toBeGreaterThan(2 * 1024 * 1024);
  expect(debug.result.duration).toBeCloseTo(16, 2);

  const wav = await readWav(page, [[0.1, 15.9]]);
  expect(wav.frames).toBe(705600);
  expect(wav.duration).toBeCloseTo(16, 4);
  expect(wav.windows[0].rms).toBeGreaterThan(0.15);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('letitedit-merged-audio.wav');

  const resultUrl = debug.result.url;
  await page.click('[data-export-again]');
  await expect(page.locator('[data-result]')).toBeHidden();
  const revoked = await page.evaluate((url) => fetch(url).then(() => 'ok', () => 'revoked'), resultUrl);
  expect(revoked).toBe('revoked');
});
