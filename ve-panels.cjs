const { chromium } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  const categories = await page.evaluate(() => [...document.querySelectorAll('#ve-rail [data-category]')].map((b) => b.dataset.category));
  const results = [];
  for (const category of categories) {
    await page.evaluate((id) => window.__videoEditor.setCategory(id), category);
    await page.waitForTimeout(250);
    const info = await page.evaluate((id) => {
      const panel = document.querySelector('#ve-library-panel');
      return {
        category: id,
        heading: panel.querySelector('h2')?.textContent.trim(),
        length: panel.innerHTML.length,
        buttons: panel.querySelectorAll('button').length,
        visible: panel.getBoundingClientRect().height > 0
      };
    }, category);
    results.push(info);
  }
  console.log(JSON.stringify(results, null, 2));
  console.log('ERRORS', errors.length);
  for (const error of errors) console.log(error);
  await page.screenshot({ path: 'C:/Users/Ismail/AppData/Local/Temp/opencode/ve-panel-record.png' });
  await browser.close();
})();
