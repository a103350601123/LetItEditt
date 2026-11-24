const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => console.log('[page]', m.type(), m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(300);
  const id = await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text');
    window.__videoEditor.seek(0.5);
    window.__videoEditor.selectClip(clip.id);
    return clip.id;
  });
  await page.waitForTimeout(400);
  const info = await page.evaluate((clipId) => {
    const preview = window.__videoEditor.preview;
    const box = document.querySelector('#ve-canvas-overlay .ve-selection-box');
    const canvas = document.querySelector('#ve-preview-canvas');
    const rect = box?.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const point = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    const originals = { startDrag: preview.startDrag.bind(preview), onPointerDown: preview.onPointerDown.bind(preview), onPointerMove: preview.onPointerMove.bind(preview) };
    preview.onPointerDown = (event) => {
      const p = preview.eventPoint(event);
      console.log('pointerdown', JSON.stringify({ target: event.target.className, p, hit: (() => { const h = preview.selectedVisual(); return h ? h.clip.id : null; })() }));
      return originals.onPointerDown(event);
    };
    preview.startDrag = (...args) => {
      console.log('startDrag', args[2], JSON.stringify(args[3]));
      return originals.startDrag(...args);
    };
    preview.onPointerMove = (event) => {
      if (preview.drag) console.log('move', JSON.stringify(preview.drag.last));
      return originals.onPointerMove(event);
    };
    return {
      box: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
      canvas: { x: canvasRect.x, y: canvasRect.y, w: canvasRect.width, h: canvasRect.height },
      point,
      element: point ? (document.elementFromPoint(point.x, point.y)?.className || null) : null,
      clipBounds: preview.boundsFor(clip),
      overlayPointer: getComputedStyle(document.querySelector('#ve-canvas-overlay')).pointerEvents,
      clip: { x: clip.x, y: clip.y, start: clip.start, duration: clip.duration }
    };
  }, id);
  console.log(JSON.stringify(info, null, 2));
  const p = info.point;
  if (p) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const after = await page.evaluate((clipId) => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    return { x: clip.x, y: clip.y, drag: window.__videoEditor.preview.drag ? 'active' : null };
  }, id);
  console.log('after', JSON.stringify(after));
  await browser.close();
})();
