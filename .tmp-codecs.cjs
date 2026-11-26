const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const result = await page.evaluate(async () => {
    const out = { ua: navigator.userAgent, secure: window.isSecureContext, hasAudioEncoder: typeof AudioEncoder, hasAudioDecoder: typeof AudioDecoder, hasWebCodecs: 'AudioEncoder' in window, enc: {} };
    if (out.hasAudioEncoder === 'function') {
      for (const [name, config] of Object.entries({
        aac: { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 },
        opus: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
        flac: { codec: 'flac', sampleRate: 44100, numberOfChannels: 2 },
        mp3: { codec: 'mp3', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 }
      })) {
        try { out.enc[name] = await AudioEncoder.isConfigSupported(config); } catch (e) { out.enc[name] = String(e); }
      }
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
