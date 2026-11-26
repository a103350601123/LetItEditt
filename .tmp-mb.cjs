const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const result = await page.evaluate(async () => {
    const mb = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const makeBuffer = (rate, seconds) => {
      const ctx = new OfflineAudioContext(2, Math.round(rate * seconds), rate);
      const b = ctx.createBuffer(2, Math.round(rate * seconds), rate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * (440 + c * 220) * i / rate) * 0.35;
      }
      return b;
    };
    const out = {};
    for (const [key, codec, fmt, rate] of [['aac', 'aac', 'mp4', 44100], ['aac48', 'aac', 'mp4', 48000], ['opus', 'opus', 'ogg', 48000]]) {
      try {
        const buffer = makeBuffer(rate, 1);
        const format = fmt === 'mp4' ? new mb.Mp4OutputFormat() : new mb.OggOutputFormat();
        const output = new mb.Output({ format, target: new mb.BufferTarget() });
        const source = new mb.AudioBufferSource({ codec, quality: new mb.Quality({ bitrate: 128000 }) });
        output.addAudioTrack(source);
        await output.start();
        await source.add(buffer);
        source.close();
        await output.finalize();
        const bytes = output.target.buffer;
        const ctx = new OfflineAudioContext(1, 1, rate);
        const decoded = await ctx.decodeAudioData(bytes.slice(0));
        const d = decoded.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        out[key] = { ok: true, bytes: bytes.byteLength, duration: decoded.duration, rate: decoded.sampleRate, channels: decoded.numberOfChannels, rms: Math.sqrt(sum / d.length) };
      } catch (e) {
        out[key] = { ok: false, error: String(e && e.message || e) };
      }
    }
    out.audioEncoder = typeof AudioEncoder;
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
