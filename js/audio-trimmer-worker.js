/* Audio Trimmer export worker.
 *
 * Receives the selected portion of the decoded audio as Float32 channel
 * arrays, then writes a real WAV (16-bit PCM) or MP3 (LAME) file. Everything
 * happens locally in the worker; no audio is uploaded. The worker is
 * terminated by the page after each export so its buffers are released.
 */

'use strict';

const MP3_FRAME = 1152;
const MP3_SAMPLE_RATES = new Set([32000, 44100, 48000]);

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'probe') {
      await probeMp3();
      return;
    }
    if (message.type === 'wav') {
      await encodeWav(message);
      return;
    }
    if (message.type === 'mp3') {
      await encodeMp3(message);
      return;
    }
    throw new Error('Unknown export format.');
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

async function probeMp3() {
  try {
    const { Mp3Encoder } = await import('../vendor/lamejs/lamejs.mjs');
    const encoder = new Mp3Encoder(2, 44100, 128);
    const left = new Int16Array(MP3_FRAME);
    const right = new Int16Array(MP3_FRAME);
    encoder.encodeBuffer(left, right);
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

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

async function encodeWav(message) {
  const channels = message.channels;
  const sampleRate = Number(message.sampleRate);
  if (!Array.isArray(channels) || !channels.length) throw new Error('No audio samples were received.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('The sample rate is invalid.');

  const channelCount = channels.length;
  const frames = channels[0].length;
  if (!frames) throw new Error('The selected range contains no audio samples.');

  const dataBytes = frames * channelCount * 2;
  if (dataBytes > 0xffffffff - 44) {
    throw new Error('The selected range is too long for a WAV file. Choose a shorter range.');
  }
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const chunkFrames = 32768;
  for (let offset = 0; offset < frames; offset += chunkFrames) {
    const end = Math.min(frames, offset + chunkFrames);
    let byteOffset = 44 + offset * channelCount * 2;
    for (let frame = offset; frame < end; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
        view.setInt16(byteOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        byteOffset += 2;
      }
    }
    const percent = Math.round((end / frames) * 100);
    postProgress((end / frames) * 0.98, `Encoding WAV… ${percent}%`);
    await yieldToLoop();
  }

  postProgress(1, 'Finalizing WAV…');
  self.postMessage(
    {
      type: 'done',
      buffer,
      mime: 'audio/wav',
      extension: 'wav',
      duration: frames / sampleRate,
      formatLabel: 'WAV · 16-bit PCM'
    },
    [buffer]
  );
}

async function encodeMp3(message) {
  const channels = message.channels;
  const sampleRate = Number(message.sampleRate);
  if (!Array.isArray(channels) || !channels.length) throw new Error('No audio samples were received.');
  if (!MP3_SAMPLE_RATES.has(sampleRate)) {
    throw new Error(`MP3 encoding is not available at ${sampleRate} Hz. Export WAV instead.`);
  }
  if (channels.length > 2) {
    throw new Error('MP3 encoding supports mono or stereo audio. Export WAV to keep every channel.');
  }

  const frames = channels[0].length;
  if (!frames) throw new Error('The selected range contains no audio samples.');

  const bitrate = Math.max(128000, Math.min(320000, Number(message.bitrate) || 192000));
  const kbps = Math.round(bitrate / 1000);
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
      postProgress((processed / frames) * 0.98, `Encoding MP3… ${percent}%`);
      await yieldToLoop();
    }
  }

  const tail = encoder.flush();
  if (tail && tail.length) parts.push(new Uint8Array(tail));

  postProgress(1, 'Finalizing MP3…');
  let total = 0;
  for (const part of parts) total += part.length;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }

  self.postMessage(
    {
      type: 'done',
      buffer,
      mime: 'audio/mpeg',
      extension: 'mp3',
      duration: frames / sampleRate,
      formatLabel: `MP3 · ${kbps} kbps`
    },
    [buffer]
  );
}
