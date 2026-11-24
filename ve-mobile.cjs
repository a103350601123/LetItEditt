const { chromium } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
const OUT = 'C:/Users/Ismail/AppData/Local/Temp/opencode';
const WIDTHS = [320, 360, 375, 390, 430, 768];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
    page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__videoEditorReady === true);
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const app = document.querySelector('#ve-app');
      const rect = app.getBoundingClientRect();
      const dock = document.querySelector('.ve-mobile-dock');
      const rail = document.querySelector('#ve-rail');
      const canvas = document.querySelector('#ve-preview-canvas').getBoundingClientRect();
      return {
        appWidth: Math.round(rect.width),
        docScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        dockVisible: dock ? getComputedStyle(dock).display !== 'none' : false,
        railScrollWidth: rail.scrollWidth,
        railClientWidth: rail.clientWidth,
        canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
        sheet: app.dataset.mobileSheet
      };
    });
    results.push({ width, ...info, errors });
    await page.screenshot({ path: `${OUT}/ve-mobile-${width}.png`, fullPage: false });
    if (width === 390) {
      await page.locator('[data-open-sheet="library"]').click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/ve-mobile-sheet-tools.png` });
      const sheetInfo = await page.evaluate(() => {
        const lib = document.querySelector('#ve-library');
        const r = lib.getBoundingClientRect();
        return { sheet: document.querySelector('#ve-app').dataset.mobileSheet, top: Math.round(r.top), height: Math.round(r.height), visibility: getComputedStyle(lib).visibility };
      });
      results.push({ width, sheetInfo });
      await page.locator('#ve-library-close').click();
      await page.waitForTimeout(400);
      await page.locator('[data-open-sheet="inspector"]').click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/ve-mobile-sheet-inspector.png` });
    }
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
