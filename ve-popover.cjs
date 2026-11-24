const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.waitForTimeout(300);
  const assetId = await page.evaluate(() => window.__videoEditor.media.list()[0].id);
  await page.evaluate(() => {
    const root = document.querySelector('#ve-library-panel');
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-panel-action]');
      console.log('clicked', b?.dataset.panelAction, b?.dataset.assetId);
    }, true);
  });
  const btn = page.locator(`.ve-asset-card[data-asset-id="${assetId}"] [data-panel-action="asset-menu"]`);
  console.log('btn count', await btn.count());
  await btn.click();
  await page.waitForTimeout(200);
  console.log('popover after click', await page.locator('.ve-popover').count());
  await page.evaluate((id) => {
    const b = document.querySelector(`[data-panel-action="asset-menu"][data-asset-id="${id}"]`);
    window.__videoEditor.handlePanelAction('asset-menu', { assetId: id, element: b });
  }, assetId);
  await page.waitForTimeout(200);
  console.log('popover after direct', await page.locator('.ve-popover').count());
  console.log('menu items', await page.locator('.ve-popover [role="menuitem"]').count());
  await browser.close();
  process.exit(0);
})();
