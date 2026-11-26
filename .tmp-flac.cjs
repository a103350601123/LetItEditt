function crc8(bytes, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}
function crc16(bytes, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
function utf8Number(value) {
  if (value < 0x80) return [value];
  const out = [];
  let v = value;
  let bytes = 1;
  while (v >= (1 << (6 * bytes + (bytes === 1 ? 0 : 1)))) bytes++;
  const total = bytes + 1;
  const lead = (0xff << (8 - total)) & 0xff;
  const arr = new Array(total);
  for (let i = total - 1; i > 0; i--) { arr[i] = 0x80 | (v & 0x3f); v >>= 6; }
  arr[0] = lead | v;
  return arr;
}
function encodeFlac(channels, sampleRate) {
  const frames = channels[0].length;
  const channelCount = channels.length;
  const blockSize = 4096;
  const blocks = [];
  for (let start = 0; start < frames; start += blockSize) blocks.push(Math.min(blockSize, frames - start));
  if (blocks.length > 1 && blocks[blocks.length - 1] < 16) {
    const need = 16 - blocks[blocks.length - 1];
    blocks[blocks.length - 2] -= need;
    blocks[blocks.length - 1] = 16;
  }
  if (blocks[0] < 16) throw new Error('Audio too short for FLAC');
  const minBlock = Math.min(...blocks), maxBlock = Math.max(...blocks);
  const parts = [];
  // streaminfo
  const info = new Uint8Array(34);
  const dv = new DataView(info.buffer);
  dv.setUint16(0, minBlock); dv.setUint16(2, maxBlock);
  dv.setUint32(4, 0); // frame sizes 0 (24-bit each)
  dv.setUint32(7, 0);
  let bitPos = 0;
  const writeBits = (value, bits) => {
    for (let i = bits - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      if (bit) info[10 + (bitPos >> 3)] |= 0x80 >> (bitPos & 7);
      bitPos++;
    }
  };
  writeBits(sampleRate, 20);
  writeBits(channelCount - 1, 3);
  writeBits(15, 5);
  writeBits(frames, 36);
  const header = new Uint8Array(8 + 34);
  header.set([0x66,0x4c,0x61,0x43], 0);
  header[4] = 0x80; header[5] = 0; header[6] = 0; header[7] = 34;
  header.set(info, 8);
  parts.push(header);
  let offset = 0, frameNumber = 0;
  for (const size of blocks) {
    const frameParts = [];
    const h = [];
    h.push(0xff, 0xf8); // sync + reserved + fixed
    // block size code 7, sample rate 0, channel assign, sample size 0
    const b2 = (7 << 4) | 0;
    const b3 = ((channelCount - 1) << 4) | (0 << 1) | 0;
    h.push(b2, b3);
    h.push(...utf8Number(frameNumber));
    h.push((size - 1) >> 8, (size - 1) & 0xff);
    const hb = Uint8Array.from(h);
    const c8 = crc8(hb, 0, hb.length);
    const frameHead = new Uint8Array(hb.length + 1);
    frameHead.set(hb); frameHead[hb.length] = c8;
    frameParts.push(frameHead);
    for (let c = 0; c < channelCount; c++) {
      const sub = new Uint8Array(1 + size * 2);
      sub[0] = 0x02;
      const sdv = new DataView(sub.buffer);
      const data = channels[c];
      for (let i = 0; i < size; i++) {
        let s = Math.max(-1, Math.min(1, data[offset + i]));
        let v = Math.round(s * 32767);
        sdv.setInt16(1 + i * 2, v);
      }
      frameParts.push(sub);
    }
    let total = frameParts.reduce((n, p) => n + p.length, 0);
    const frame = new Uint8Array(total + 2);
    let pos = 0;
    for (const p of frameParts) { frame.set(p, pos); pos += p.length; }
    const c16 = crc16(frame, 0, total);
    frame[total] = c16 >> 8; frame[total + 1] = c16 & 0xff;
    parts.push(frame);
    offset += size; frameNumber++;
  }
  let totalLen = parts.reduce((n,p)=>n+p.length,0);
  const out = new Uint8Array(totalLen); let pos = 0;
  for (const p of parts) { out.set(p,pos); pos += p.length; }
  return out;
}
const rate = 44100, seconds = 1, frames = rate * seconds;
const left = new Float32Array(frames), right = new Float32Array(frames);
for (let i = 0; i < frames; i++) { const v = Math.sin(2*Math.PI*440*i/rate)*0.4; left[i]=v; right[i]=v; }
const flac = encodeFlac([left,right], rate);
require('fs').writeFileSync('.tmp-test.flac', Buffer.from(flac));
console.log('bytes', flac.length, 'head', Buffer.from(flac.slice(0,16)).toString('hex'));
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const b64 = Buffer.from(flac).toString('base64');
  const result = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const ch = buf.getChannelData(0);
      let sum = 0, peak = 0;
      for (let i = 0; i < ch.length; i++) { sum += ch[i]*ch[i]; peak = Math.max(peak, Math.abs(ch[i])); }
      return { duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels, rms: Math.sqrt(sum/ch.length), peak };
    } catch (e) { return 'ERROR ' + e.message; }
  }, b64);
  console.log(result);
  await browser.close();
})();

