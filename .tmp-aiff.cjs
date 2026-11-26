function makeAiff({ seconds = 1, rate = 44100, channels = 2, freq = 440, amplitude = 0.4 } = {}) {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * channels * 2;
  const buf = Buffer.alloc(54 + dataBytes);
  buf.write('FORM', 0); buf.writeUInt32BE(46 + dataBytes, 4); buf.write('AIFF', 8);
  buf.write('COMM', 12); buf.writeUInt32BE(18, 16); buf.writeUInt16BE(channels, 20);
  buf.writeUInt32BE(frames, 22); buf.writeUInt16BE(16, 26);
  // 80-bit extended 44100
  const write80 = (value, offset) => {
    if (value === 0) { buf.writeUInt16BE(0, offset); buf.writeUInt32BE(0, offset+2); buf.writeUInt32BE(0, offset+6); return; }
    const exponent = Math.floor(Math.log2(value));
    const mantissa = value / Math.pow(2, exponent);
    buf.writeUInt16BE(16383 + exponent, offset);
    let m = BigInt(Math.round(mantissa * Math.pow(2, 63)));
    buf.writeBigUInt64BE(m, offset + 2);
  };
  write80(rate, 28);
  buf.write('SSND', 38); buf.writeUInt32BE(8 + dataBytes, 42); buf.writeUInt32BE(0, 46); buf.writeUInt32BE(0, 50);
  let off = 54;
  for (let i = 0; i < frames; i++) {
    const v = Math.sin(2 * Math.PI * freq * i / rate) * amplitude;
    for (let c = 0; c < channels; c++) { buf.writeInt16BE(Math.round(v * 32767), off); off += 2; }
  }
  return buf;
}
const { chromium } = require('@playwright/test');
(async () => {
  const aiff = makeAiff().toString('base64');
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const result = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const out = {};
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      out.aiff = { duration: buffer.duration, rate: buffer.sampleRate, channels: buffer.numberOfChannels };
    } catch (e) { out.aiff = 'ERROR: ' + e.message; }
    const audio = document.createElement('audio');
    out.canPlayAiff = audio.canPlayType('audio/aiff');
    out.canPlayWma = audio.canPlayType('audio/x-ms-wma');
    out.canPlayFlac = audio.canPlayType('audio/flac');
    out.canPlayOpus = audio.canPlayType('audio/ogg; codecs="opus"');
    return out;
  }, aiff);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
