const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.stack || error.message}`));
  await page.goto('http://127.0.0.1:4173/media-and-motion/video-editor/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    ready: window.__videoEditorReady === true,
    app: Boolean(document.querySelector('#ve-app')),
    rail: document.querySelectorAll('#ve-rail [data-category]').length,
    library: document.querySelector('#ve-library-panel')?.innerHTML.length || 0,
    inspector: document.querySelector('#ve-inspector-panel')?.innerHTML.length || 0,
    timeline: document.querySelector('#ve-timeline')?.innerHTML.length || 0,
    fatal: document.querySelector('.ve-fatal')?.textContent || null,
    canvas: (() => { const c = document.querySelector('#ve-preview-canvas'); const r = c?.getBoundingClientRect(); return c ? { w: c.width, h: c.height, rw: Math.round(r.width), rh: Math.round(r.height) } : null; })(),
    debug: Boolean(window.__videoEditor)
  }));
  console.log(JSON.stringify(state, null, 2));
  console.log('ERRORS:', errors.length);
  for (const error of errors) console.log(error);
  await page.screenshot({ path: 'C:/Users/Ismail/AppData/Local/Temp/opencode/ve-desktop.png', fullPage: false });
  await browser.close();
})();

