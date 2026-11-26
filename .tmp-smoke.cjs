const { chromium } = require('@playwright/test');

function makeWav({ seconds = 2, rate = 44100, channels = 2, freq = 440, amplitude = 0.5 } = {}) {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.sin(2 * Math.PI * freq * (channel + 1) * frame / rate) * amplitude;
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push('PAGEERROR ' + err.message));
  await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
  await page.waitForFunction(() => window.__AC__);
  console.log('initial', JSON.stringify(await page.evaluate(() => window.__AC__.debug())).slice(0, 400));

  await page.setInputFiles('[data-file-input]', {
    name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav()
  });
  await page.waitForFunction(() => window.__AC__.debug().fileCount === 1 && window.__AC__.debug().files[0].duration > 0, null, { timeout: 15000 });
  console.log('after add', JSON.stringify(await page.evaluate(() => window.__AC__.debug().files)));

  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('[data-convert]');
  const download = await downloadPromise;
  const path = await download.path();
  console.log('download', download.suggestedFilename(), require('fs').statSync(path).size);
  const bytes = require('fs').readFileSync(path);
  const result = await page.evaluate(async (b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(raw.buffer.slice(0));
      const l = buf.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < l.length; i++) sum += l[i] * l[i];
      return { ok: true, duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels, rms: Math.sqrt(sum / l.length) };
    } catch (e) { return { ok: false, error: e.message }; }
  }, bytes.toString('base64'));
  console.log('decoded', JSON.stringify(result));
  await page.waitForTimeout(500);
  console.log('final', JSON.stringify(await page.evaluate(() => window.__AC__.debug())).slice(0, 700));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
