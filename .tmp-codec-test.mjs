import { writeFileSync } from 'node:fs';
import { encodeWav, encodeAiff, encodeFlac, decodeAiff } from './js/audio-codecs.js';

const rate = 44100;
const frames = rate; // 1 second
const left = new Float32Array(frames);
const right = new Float32Array(frames);
for (let i = 0; i < frames; i += 1) {
  left[i] = Math.sin(2 * Math.PI * 440 * i / rate) * 0.4;
  right[i] = Math.sin(2 * Math.PI * 660 * i / rate) * 0.3;
}

const wav = await encodeWav([left, right], rate);
const aiff = await encodeAiff([left, right], rate);
const flac = await encodeFlac([left, right], rate);
writeFileSync('.tmp-out.wav', Buffer.from(wav));
writeFileSync('.tmp-out.aiff', Buffer.from(aiff));
writeFileSync('.tmp-out.flac', Buffer.from(flac));
console.log('wav', wav.byteLength, 'aiff', aiff.byteLength, 'flac', flac.byteLength);

// Round-trip our own AIFF decoder against the source samples.
const decoded = decodeAiff(aiff);
let maxError = 0;
for (let i = 0; i < frames; i += 1) {
  maxError = Math.max(maxError, Math.abs(decoded.channels[0][i] - left[i]));
}
console.log('aiff decoded', decoded.sampleRate, decoded.channels.length, decoded.duration, 'maxErr', maxError);

// Short edge cases
for (const count of [1, 5, 15, 16, 17, 4095, 4096, 4097]) {
  const a = new Float32Array(count);
  for (let i = 0; i < count; i += 1) a[i] = Math.sin(i / 3) * 0.5;
  const out = await encodeFlac([a], 44100);
  console.log('flac frames', count, 'bytes', out.byteLength);
}
