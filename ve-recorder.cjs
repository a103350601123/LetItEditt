const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';
const FIXTURE = path.resolve('tests/fixtures/trim-4s.mp4');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

async function open(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  /* 1. Unsupported browser surfaces an honest state. */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true, writable: true });
      if (navigator.mediaDevices) {
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true, writable: true });
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await page.click('[data-category="record"]');
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      panelVisible: !document.querySelector('#ve-library-panel')?.hidden,
      notice: document.querySelector('.ve-notice-warn')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      disabledModes: [...document.querySelectorAll('[data-record-mode]')].map((b) => ({ mode: b.dataset.recordMode, disabled: b.disabled })),
      startDisabled: document.querySelector('[data-record-action="start"]')?.disabled ?? null
    }));
    check('record unsupported notice shown', /unavailable|does not expose/i.test(state.notice), state.notice);
    check('record modes disabled when APIs missing', state.disabledModes.every((m) => m.disabled), state.disabledModes);
    check('record start disabled when unsupported', state.startDisabled === true, state.startDisabled);
    check('record unsupported page has no errors', errors.length === 0, errors);
    await context.close();
  }

  /* 2. Permission denial is reported without fake recording. */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.click('[data-category="record"]');
    await page.waitForTimeout(200);
    await page.click('[data-record-action="start"]');
    await page.waitForFunction(() => /Permission was denied/i.test(document.querySelector('.ve-alert-error')?.textContent || ''), null, { timeout: 10000 });
    const denied = await page.evaluate(() => ({
      alert: document.querySelector('.ve-alert-error')?.textContent?.trim() || '',
      live: Boolean(document.querySelector('.ve-record-live')),
      assets: window.__videoEditor.media.list().length
    }));
    check('permission denial explained', /Permission was denied/i.test(denied.alert), denied.alert);
    check('permission denial leaves no phantom recording', !denied.live && denied.assets === 0, denied);
    check('permission denial page has no errors', errors.length === 0, errors);
    await context.close();
  }

  /* 3. Restore with missing blobs offers relink, then relinking connects clips. */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await page.locator('#ve-media-input').setInputFiles(FIXTURE);
    await page.waitForFunction(() => window.__videoEditor.media.list().length === 1);
    await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
    await page.waitForTimeout(1600);
    const saved = await page.evaluate(async () => {
      const out = await window.__videoEditor.getAutosave();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('letitedit-video-editor-v3');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { clips: out?.snapshot?.project?.tracks?.flatMap((t) => t.clips).length || 0 };
    });
    check('autosave stored clip before relink test', saved.clips >= 1, saved);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__videoEditorReady === true);
    const banner = page.locator('#ve-restore-banner');
    await banner.waitFor({ state: 'visible', timeout: 10000 });
    await page.click('#ve-restore-button');
    await page.waitForFunction(() => document.querySelector('#ve-relink-banner')?.hidden === false, null, { timeout: 15000 });
    const relinkState = await page.evaluate(() => ({
      text: document.querySelector('#ve-relink-text')?.textContent || '',
      missing: window.__videoEditor.project.tracks.flatMap((t) => t.clips).filter((c) => c.mediaId && !window.__videoEditor.media.has(c.mediaId)).length,
      media: window.__videoEditor.media.list().length,
      clips: window.__videoEditor.project.tracks.flatMap((t) => t.clips).length
    }));
    check('restore reports missing media for relink', relinkState.missing === 1 && /need relinking/.test(relinkState.text), relinkState);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#ve-relink-button')
    ]);
    await chooser.setFiles(FIXTURE);
    await page.waitForFunction(() => window.__videoEditor.project.tracks.flatMap((t) => t.clips).every((c) => !c.mediaId || window.__videoEditor.media.has(c.mediaId)), null, { timeout: 20000 });
    const relinked = await page.evaluate(() => ({
      missing: window.__videoEditor.project.tracks.flatMap((t) => t.clips).filter((c) => c.mediaId && !window.__videoEditor.media.has(c.mediaId)).length,
      bannerHidden: document.querySelector('#ve-relink-banner').hidden,
      media: window.__videoEditor.media.list().length,
      sourceReady: window.__videoEditor.media.list().every((asset) => Boolean(asset.file || asset.url))
    }));
    check('relink reconnects the original by name', relinked.missing === 0 && relinked.bannerHidden && relinked.media === 1, relinked);
    check('relinked asset has a usable source', relinked.sourceReady, relinked);
    check('relink flow has no page errors', errors.length === 0, errors);
    await context.close();
  }

  console.log(JSON.stringify({ results, failed: results.filter((r) => !r.ok).length }, null, 2));
  await browser.close();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
})();

