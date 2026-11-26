const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const flac = require('fs').readFileSync('.tmp-out.flac').toString('base64');
  const result = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      let sum = 0, peak = 0;
      for (let i = 0; i < l.length; i++) { sum += l[i] * l[i]; peak = Math.max(peak, Math.abs(l[i])); }
      return { ok: true, duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels, rms: Math.sqrt(sum / l.length), peak, rmsR: Math.sqrt(r.reduce((a, v) => a + v * v, 0) / r.length) };
    } catch (e) { return { ok: false, error: e.message }; }
  }, flac);
  console.log('chrome flac', JSON.stringify(result));
  const aiff = require('fs').readFileSync('.tmp-out.aiff').toString('base64');
  const aiffResult = await page.evaluate(async (b64) => {
    const mod = await import('/js/audio-codecs.js');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    try {
      const d = mod.decodeAiff(bytes.buffer);
      return { ok: true, rate: d.sampleRate, channels: d.channels.length, duration: d.duration };
    } catch (e) { return { ok: false, error: e.message }; }
  }, aiff);
  console.log('own aiff', JSON.stringify(aiffResult));
  await browser.close();
})();
