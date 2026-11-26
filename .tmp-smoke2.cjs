const { chromium } = require('@playwright/test');
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
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message + '\n' + e.stack));
  await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
  await page.waitForFunction(() => window.__AC__);
  await page.setInputFiles('[data-file-input]', { name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav() });
  await page.waitForTimeout(4000);
  console.log('debug', JSON.stringify(await page.evaluate(() => window.__AC__.debug()), null, 2));
  console.log('logs', logs.join('\n'));
  await browser.close();
})();
