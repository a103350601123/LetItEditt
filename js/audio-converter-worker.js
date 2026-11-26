/* Audio Converter export worker.
 *
 * Receives already resampled Float32 channel arrays from the page, then writes
 * a real WAV, AIFF, FLAC or MP3 file, or packages finished files into a ZIP.
 * Everything happens locally in the worker; no audio is uploaded. The page
 * terminates the worker after each export so encoder state is released.
 */

import { encodeWav, encodeAiff, encodeFlac, buildZip } from './audio-codecs.js';

const MP3_FRAME = 1152;
const MP3_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'probe') {
      await probeMp3();
      return;
    }
    if (message.type === 'encode') {
      await encode(message);
      return;
    }
    if (message.type === 'zip') {
      await zip(message);
      return;
    }
    throw new Error('Unknown export request.');
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error && error.message ? error.message : 'The audio encoder failed.'
    });
  }
};

function postProgress(value, label) {
  const safe = Math.max(0, Math.min(1, Number(value) || 0));
  self.postMessage({ type: 'progress', value: safe, label });
}

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function tick(value, label) {
  postProgress(value, label);
  await yieldToLoop();
}

function checkChannels(channels) {
  if (!Array.isArray(channels) || !channels.length) {
    throw new Error('No audio samples were received.');
  }
  if (channels.length > 2) {
    throw new Error('This encoder supports mono or stereo audio.');
  }
  const frames = channels[0].length;
  if (!frames) throw new Error('The audio contains no samples.');
  return frames;
}

async function probeMp3() {
  try {
    const { Mp3Encoder } = await import('../vendor/lamejs/lamejs.mjs');
    const encoder = new Mp3Encoder(2, 44100, 128);
    encoder.encodeBuffer(new Int16Array(MP3_FRAME), new Int16Array(MP3_FRAME));
    encoder.flush();
    self.postMessage({ type: 'probe', ok: true });
  } catch (error) {
    self.postMessage({
      type: 'probe',
      ok: false,
      message: error && error.message ? error.message : 'MP3 encoder unavailable.'
    });
  }
}

async function encode(message) {
  const format = String(message.format || '');
  const channels = message.channels;
  const sampleRate = Number(message.sampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('The sample rate is invalid.');
  }

  if (format === 'wav') {
    const frames = checkChannels(channels);
    const buffer = await encodeWav(channels, sampleRate, tick);
    finish(buffer, 'audio/wav', 'wav', 'WAV · 16-bit PCM', frames / sampleRate);
    return;
  }

  if (format === 'aiff') {
    const frames = checkChannels(channels);
    const buffer = await encodeAiff(channels, sampleRate, tick);
    finish(buffer, 'audio/aiff', 'aiff', 'AIFF · 16-bit PCM', frames / sampleRate);
    return;
  }

  if (format === 'flac') {
    const frames = checkChannels(channels);
    const buffer = await encodeFlac(channels, sampleRate, tick);
    finish(buffer, 'audio/flac', 'flac', 'FLAC · 16-bit lossless', frames / sampleRate);
    return;
  }

  if (format === 'mp3') {
    await encodeMp3(channels, sampleRate, Number(message.bitrate) || 192000);
    return;
  }

  throw new Error(`The ${format || 'unknown'} encoder is not available in this worker.`);
}

function finish(buffer, mime, extension, formatLabel, duration) {
  postProgress(1, 'Finalizing file…');
  self.postMessage(
    { type: 'done', buffer, mime, extension, formatLabel, duration },
    [buffer]
  );
}

async function encodeMp3(channels, sampleRate, bitrate) {
  const frames = checkChannels(channels);
  if (!MP3_SAMPLE_RATES.has(sampleRate)) {
    throw new Error(`MP3 encoding is not available at ${sampleRate} Hz. Choose another sample rate.`);
  }
  const kbps = Math.max(64, Math.min(320, Math.round(bitrate / 1000)));
  const { Mp3Encoder } = await import('../vendor/lamejs/lamejs.mjs');
  const encoder = new Mp3Encoder(channels.length, sampleRate, kbps);
  const left = new Int16Array(MP3_FRAME);
  const right = new Int16Array(MP3_FRAME);
  const parts = [];
  let processed = 0;
  let lastPercent = -1;

  while (processed < frames) {
    const count = Math.min(MP3_FRAME, frames - processed);
    for (let index = 0; index < count; index += 1) {
      const leftSample = Math.max(-1, Math.min(1, channels[0][processed + index]));
      left[index] = leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7fff;
      if (channels.length > 1) {
        const rightSample = Math.max(-1, Math.min(1, channels[1][processed + index]));
        right[index] = rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7fff;
      }
    }
    const encoded = channels.length > 1
      ? encoder.encodeBuffer(left.subarray(0, count), right.subarray(0, count))
      : encoder.encodeBuffer(left.subarray(0, count));
    if (encoded && encoded.length) parts.push(new Uint8Array(encoded));
    processed += count;
    const percent = Math.round((processed / frames) * 100);
    if (percent !== lastPercent && percent % 2 === 0) {
      lastPercent = percent;
      postProgress((processed / frames) * 0.98, `Encoding MP3 · ${percent}%`);
      await yieldToLoop();
    }
  }

  const tail = encoder.flush();
  if (tail && tail.length) parts.push(new Uint8Array(tail));

  let total = 0;
  for (const part of parts) total += part.length;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }
  finish(buffer, 'audio/mpeg', 'mp3', `MP3 · ${kbps} kbps`, frames / sampleRate);
}

async function zip(message) {
  const entries = Array.isArray(message.entries) ? message.entries : [];
  if (!entries.length) throw new Error('There are no files to pack.');
  const parts = buildZip(entries.map((entry) => ({
    name: String(entry.name || 'audio'),
    data: new Uint8Array(entry.buffer)
  })));
  let total = 0;
  for (const part of parts) total += part.length;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }
  postProgress(1, 'Finalizing ZIP…');
  self.postMessage(
    { type: 'done', buffer, mime: 'application/zip', extension: 'zip', formatLabel: 'ZIP archive' },
    [buffer]
  );
}
