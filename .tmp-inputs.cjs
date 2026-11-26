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
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
  await page.waitForFunction(() => window.__AC__ && window.__AC__.debug().capabilities.mp3Probed);

  const wav = makeWav();
  await page.setInputFiles('[data-file-input]', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
  await page.waitForFunction(() => window.__AC__.debug().fileCount === 1);

  async function convertAs(format) {
    await page.selectOption('[data-format]', format);
    const dp = page.waitForEvent('download', { timeout: 90000 });
    await page.click('[data-convert]');
    const d = await dp;
    return fs.readFileSync(await d.path());
  }

  const aiffBytes = await convertAs('aiff');
  const mp3Bytes = await convertAs('mp3');
  const flacBytes = await convertAs('flac');
  const m4aBytes = await convertAs('m4a');
  const oggBytes = await convertAs('ogg');
  console.log('fixtures', { aiff: aiffBytes.length, mp3: mp3Bytes.length, flac: flacBytes.length, m4a: m4aBytes.length, ogg: oggBytes.length });

  // Fresh page: feed all generated formats back in and convert them to WAV.
  await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
  await page.waitForFunction(() => window.__AC__ && window.__AC__.debug().capabilities.mp3Probed);
  await page.setInputFiles('[data-file-input]', [
    { name: 'in.mp3', mimeType: 'audio/mpeg', buffer: mp3Bytes },
    { name: 'in.flac', mimeType: 'audio/flac', buffer: flacBytes },
    { name: 'in.m4a', mimeType: 'audio/mp4', buffer: m4aBytes },
    { name: 'in.ogg', mimeType: 'audio/ogg', buffer: oggBytes },
    { name: 'in.aiff', mimeType: 'audio/aiff', buffer: aiffBytes }
  ]);
  await page.waitForFunction(() => window.__AC__.debug().fileCount === 5 && window.__AC__.debug().files.every((f) => f.duration > 0), null, { timeout: 30000 });
  console.log('inputs', JSON.stringify((await page.evaluate(() => window.__AC__.debug())).files.map((f) => [f.name, f.format, f.duration, f.sourceRate, f.channels])));

  await page.selectOption('[data-format]', 'wav');
  await page.click('[data-convert]');
  await page.waitForFunction(() => window.__AC__.debug().files.every((f) => f.status === 'done' || f.status === 'error'), null, { timeout: 120000 });
  const debug = await page.evaluate(() => window.__AC__.debug());
  console.log('results', JSON.stringify(debug.files.map((f) => [f.name, f.status, f.error, f.result && [f.result.name, f.result.size, f.result.sampleRate, f.result.channels]])));
  console.log('zipVisible', debug.zipVisible, 'resultsVisible', debug.resultsVisible);

  const zipPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('[data-download-zip]');
  const zip = await zipPromise;
  const zipPath = 'C:/Users/Ismail/Documents/GitHub/LetItEditt/.tmp-batch.zip';
  await zip.saveAs(zipPath);
  console.log('zip', zip.suggestedFilename(), fs.statSync(zipPath).size);
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
