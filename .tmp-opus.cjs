const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const r = await page.evaluate(async () => {
    const mb = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const out = {};
    for (const [key, codec, fmt, rate] of [['opus44', 'opus', 'ogg', 44100], ['opus22', 'opus', 'ogg', 22050], ['aac22', 'aac', 'mp4', 22050]]) {
      try {
        const buffer = new AudioBuffer({ length: rate, numberOfChannels: 2, sampleRate: rate });
        for (let c = 0; c < 2; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / rate) * 0.3; }
        const output = new mb.Output({ format: fmt === 'ogg' ? new mb.OggOutputFormat() : new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
        let packets = 0, packetDuration = null;
        const source = new mb.AudioBufferSource({ codec, quality: new mb.Quality({ bitrate: 128000 }), onEncodedPacket: (p) => { packets++; if (packetDuration === null) packetDuration = p.duration; } });
        output.addAudioTrack(source);
        await output.start();
        await source.add(buffer);
        source.close();
        await output.finalize();
        const bytes = output.target.buffer;
        const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.slice(0));
        out[key] = { ok: true, bytes: bytes.byteLength, decodedRate: decoded.sampleRate, duration: decoded.duration, packets, packetDuration };
      } catch (e) { out[key] = { ok: false, error: String(e && e.message || e) }; }
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})();
