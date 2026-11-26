const { chromium } = require('@playwright/test');
const fs = require('fs');
function makeWav({ seconds = 2, rate = 44100, channels = 2, freq = 440, amplitude = 0.5 } = {}) {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channels * 2, 28); buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) {
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * (c + 1) * f / rate) * amplitude * 32767), offset); offset += 2;
  }
  return buffer;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
  await page.waitForFunction(() => window.__AC__ && window.__AC__.debug().capabilities.mp3Probed);
  await page.setInputFiles('[data-file-input]', { name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav() });
  await page.waitForFunction(() => window.__AC__.debug().fileCount === 1 && window.__AC__.debug().files[0].duration > 0);

  for (const format of ['wav', 'flac', 'aiff', 'm4a', 'ogg']) {
    await page.selectOption('[data-format]', format);
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
    await page.click('[data-convert]');
    const download = await downloadPromise;
    const path = await download.path();
    const bytes = fs.readFileSync(path);
    const decoded = await page.evaluate(async ({ b64, fmt }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      try {
        if (fmt === 'aiff') {
          const mod = await import('/js/audio-codecs.js');
          const d = mod.decodeAiff(raw.buffer);
          let sum = 0; const ch = d.channels[0];
          for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
          return { ok: true, duration: d.duration, rate: d.sampleRate, channels: d.channels.length, rms: Math.sqrt(sum / ch.length) };
        }
        const ctx = new OfflineAudioContext(1, 1, 48000);
        const buf = await ctx.decodeAudioData(raw.buffer.slice(0));
        const ch = buf.getChannelData(0);
        let sum = 0; for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        return { ok: true, duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels, rms: Math.sqrt(sum / ch.length) };
      } catch (e) { return { ok: false, error: e.message }; }
    }, { b64: bytes.toString('base64'), fmt: format });
    const debug = await page.evaluate(() => window.__AC__.debug());
    console.log(format, download.suggestedFilename(), bytes.length, JSON.stringify(decoded), debug.files[0].status, debug.files[0].error);
  }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
