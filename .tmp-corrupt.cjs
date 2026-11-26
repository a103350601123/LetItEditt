const { chromium } = require('@playwright/test');
function makeWav({ seconds = 1, rate = 44100, channels = 2, freq = 440, amplitude = 0.5 } = {}) {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channels * 2, 28); buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) { buffer.writeInt16LE(Math.round(Math.sin(2*Math.PI*freq*(c+1)*f/rate)*amplitude*32767), o); o += 2; }
  return buffer;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const base = makeWav({ seconds: 1 });
  const cases = {
    truncated: base.subarray(0, 4000),
    filled: (() => { const b = Buffer.from(base); b.fill(0x7f, 60); return b.subarray(0, 4000); })(),
    headerOnly: base.subarray(0, 44),
    tiny: base.subarray(0, 100),
    badFmt: (() => { const b = Buffer.from(base.subarray(0, 4000)); b.writeUInt16LE(0, 20); return b; })(),
    randomBody: (() => { const b = Buffer.from(base.subarray(0, 4000)); for (let i = 44; i < b.length; i++) b[i] = (i * 37) & 0xff; return b; })()
  };
  for (const [name, buf] of Object.entries(cases)) {
    const r = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      try {
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const decoded = await ctx.decodeAudioData(bytes.buffer);
        return { ok: true, duration: decoded.duration, frames: decoded.length };
      } catch (e) { return { ok: false, error: e.message }; }
    }, buf.toString('base64'));
    console.log(name, JSON.stringify(r));
  }
  await browser.close();
})();
