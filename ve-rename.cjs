const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  const assetId = await page.evaluate(() => window.__videoEditor.media.list()[0].id);
  const counts = () => page.evaluate(() => ({
    clips: window.__videoEditor.project.tracks.flatMap((t) => t.clips).length,
    name: window.__videoEditor.media.list()[0].name,
    popovers: document.querySelectorAll('.ve-popover').length
  }));
  await page.click(`.ve-asset-card[data-asset-id="${assetId}"] [data-panel-action="asset-menu"]`);
  await page.waitForTimeout(150);
  console.log('after menu', JSON.stringify(await counts()));
  console.log('items', await page.locator('.ve-popover [role="menuitem"]').allTextContents());
  page.once('dialog', async (d) => {
    console.log('DIALOG', d.type(), d.message(), d.defaultValue());
    await d.accept('hero-shot.mp4');
  });
  const rename = page.locator('.ve-popover [role="menuitem"]', { hasText: 'Rename' });
  console.log('rename count', await rename.count());
  await rename.click();
  await page.waitForTimeout(400);
  console.log('after rename', JSON.stringify(await counts()));
  await browser.close();
  process.exit(0);
})();
