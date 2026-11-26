const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
  await page.waitForFunction(() => window.__AC__);
  const wide = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth + 1 && r.width > 0) {
        out.push({ tag: el.tagName, cls: el.className && String(el.className).slice(0, 80), w: Math.round(r.width), left: Math.round(r.left) });
      }
    }
    return out.slice(0, 25);
  });
  console.log(JSON.stringify(wide, null, 2));
  await browser.close();
})();
