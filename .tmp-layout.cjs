const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const [width, height, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('http://127.0.0.1:4173/media-and-motion/audio-converter/');
    await page.waitForFunction(() => window.__AC__);
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      h1: [...document.querySelectorAll('h1')].map((n) => n.textContent),
      h2: document.querySelectorAll('h2').length,
      title: document.title,
      canonical: document.querySelector('link[rel=canonical]').href,
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].length,
      heroVisible: Boolean(document.querySelector('h1')?.offsetParent)
    }));
    console.log(name, JSON.stringify(info));
    console.log('external', requests.filter((u) => !u.startsWith('http://127.0.0.1:4173')));
    await page.screenshot({ path: `.tmp-${name}.png`, fullPage: false });
    await page.close();
  }
  await browser.close();
})();
