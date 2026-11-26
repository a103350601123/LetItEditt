const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  const r = await page.evaluate(async () => {
    const b = new AudioBuffer({ length: 100, numberOfChannels: 2, sampleRate: 44100 });
    const l = b.getChannelData(0), rr = b.getChannelData(1);
    const shared = l.buffer === rr.buffer;
    let transferred = 'n/a';
    try {
      const w = new Worker(URL.createObjectURL(new Blob([`self.onmessage = (e) => { const [a,b] = e.data; self.postMessage([a.length, b.length, a[10], b[10]]); };`], { type: 'text/javascript' })));
      const out = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage([l, rr], [l.buffer, rr.buffer]); });
      transferred = out;
    } catch (e) { transferred = 'ERR ' + e.message; }
    return { shared, transferred, byteLength: l.byteLength, offset: l.byteOffset };
  });
  console.log(JSON.stringify(r));
  const aac = await page.evaluate(async () => {
    const out = {};
    for (const rate of [22050, 44100, 48000]) {
      for (const ch of [1, 2]) {
        const s = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: ch, bitrate: 128000 });
        out[`aac-${rate}-${ch}`] = s.supported;
      }
    }
    for (const rate of [22050, 44100, 48000]) {
      const s = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: rate, numberOfChannels: 2, bitrate: 128000 });
      out[`opus-${rate}`] = s.supported;
    }
    return out;
  });
  console.log(JSON.stringify(aac));
  await browser.close();
})();
