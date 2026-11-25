'use strict';

/* Focused regressions for the editor audit:
 * - the mobile Tools/Properties dock buttons must toggle their sheet
 * - filters on the very first clip must reach the preview and the export
 * - transitions must only be offered where a previous clip exists
 * - the desktop workspace must not let the transport overlap the timeline
 * - text layers must resize with a mouse and with a finger
 * - mobile page scrolling, timeline scrolling and clip dragging must coexist
 * - browser Back/Forward must follow real page history, not editor state
 */

const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-editor/';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(300000);
  await ensureFixtures(browser, baseURL);
});

async function openEditor(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true, null, { timeout: 30000 });
}

async function importVideo(page, name = 'trim-4s.mp4') {
  const before = await page.evaluate(() => window.__videoEditor.media.list().length);
  await page.setInputFiles('#ve-media-input', fixturePath(name));
  await page.waitForFunction(
    (expected) => window.__videoEditor.media.list().length >= expected,
    before + 1,
    { timeout: 60000 }
  );
  return page.evaluate((filename) => window.__videoEditor.media.list().find((item) => item.name === filename).id, name);
}

async function addClip(page, assetId, start = 0) {
  return page.evaluate(({ id, at }) => {
    const inserted = window.__videoEditor.addAssetToTimeline(id, { start: at });
    return inserted.clip.id;
  }, { id: assetId, at: start });
}

async function openEffects(page) {
  const section = page.locator('#ve-inspector-panel details', { hasText: 'Effects' });
  await section.evaluate((element) => {
    element.open = true;
    element.scrollIntoView({ block: 'center' });
  });
}

async function canvasAverage(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#ve-preview-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    return { r: r / n, g: g / n, b: b / n };
  });
}

async function touchDrag(context, page, start, end, steps = 10) {
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y, id: 1 }]
  });
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        id: 1
      }]
    });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}

test('mobile Tools and Properties dock buttons toggle their sheets', async ({ browser }) => {
  test.setTimeout(120000);
  for (const width of [320, 360, 375, 390, 430, 768]) {
    const context = await browser.newContext({
      viewport: { width, height: 780 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openEditor(page);
    await page.locator('.ve-mobile-dock').scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);

    const tools = page.locator('[data-open-sheet="library"]');
    await tools.click();
    await expect(page.locator('#ve-app')).toHaveAttribute('data-mobile-sheet', 'library');
    await expect(page.locator('#ve-library')).toBeVisible();
    await expect(tools).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(350);

    const geometry = await page.evaluate(() => {
      const sheet = document.querySelector('#ve-library').getBoundingClientRect();
      const dock = document.querySelector('.ve-mobile-dock').getBoundingClientRect();
      const button = document.querySelector('[data-open-sheet="library"]');
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const railHits = [...document.querySelectorAll('#ve-rail [data-category]')].map((item) => {
        const box = item.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return Boolean(hit && hit.closest('#ve-rail [data-category]') === item);
      });
      return {
        sheetBottom: sheet.bottom,
        dockTop: dock.top,
        dockBottom: dock.bottom,
        hitInsideDock: Boolean(top && top.closest('.ve-mobile-dock')),
        hitInsideSheet: Boolean(top && top.closest('#ve-library')),
        railHits,
        scrollY,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
        innerHeight
      };
    });
    expect(geometry.sheetBottom).toBeLessThanOrEqual(geometry.dockTop + 1);
    expect(geometry.dockBottom).toBeGreaterThanOrEqual(geometry.innerHeight - 2);
    expect(geometry.dockBottom).toBeLessThanOrEqual(geometry.innerHeight + 2);
    expect(geometry.railHits.every(Boolean)).toBe(true);
    expect(geometry.hitInsideDock).toBe(true);
    expect(geometry.hitInsideSheet).toBe(false);
    expect(geometry.scrollY).toBe(scrollBefore);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);

    await tools.click();
    await expect(page.locator('#ve-app')).toHaveAttribute('data-mobile-sheet', 'none');
    await expect(page.locator('#ve-library')).toBeHidden();
    await expect(tools).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);

    const properties = page.locator('[data-open-sheet="inspector"]');
    await properties.click();
    await expect(page.locator('#ve-app')).toHaveAttribute('data-mobile-sheet', 'inspector');
    await expect(page.locator('#ve-inspector')).toBeVisible();
    await properties.click();
    await expect(page.locator('#ve-app')).toHaveAttribute('data-mobile-sheet', 'none');

    expect(await page.locator('#ve-app').count()).toBe(1);
    expect(await page.locator('#ve-library').count()).toBe(1);
    expect(await page.locator('#ve-inspector').count()).toBe(1);
    await context.close();
  }
});

test('first clip filters and transitions reach preview and export', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openEditor(page);
  const assetId = await importVideo(page);
  const first = await addClip(page, assetId, 0);
  await page.evaluate((id) => {
    window.__videoEditor.selectClip(id);
    window.__videoEditor.seek(0.6);
  }, first);
  await page.waitForTimeout(300);
  await openEffects(page);

  const transition = page.locator('#ve-inspector-panel select[data-prop="transition.type"]');
  const transitionSeconds = page.locator('#ve-inspector-panel input[data-prop="transition.duration"]');
  const filterStrength = page.locator('#ve-inspector-panel input[data-prop="filterIntensity"]');
  await expect(transition).toBeEnabled();
  await expect(transitionSeconds).toBeDisabled();
  await expect(filterStrength).toBeDisabled();

  await page.locator('#ve-inspector-panel select[data-prop="filter"]').selectOption('bw');
  await expect(filterStrength).toBeEnabled();
  await page.waitForTimeout(700);
  const preview = await canvasAverage(page);
  expect(Math.abs(preview.r - preview.g)).toBeLessThan(3);
  expect(Math.abs(preview.g - preview.b)).toBeLessThan(3);

  /* The first clip has no predecessor, so its "Transition in" runs from the
     canvas background rather than silently doing nothing. */
  await transition.selectOption('cross-dissolve');
  await expect(transitionSeconds).toBeEnabled();
  await page.evaluate(() => window.__videoEditor.seek(0.02));
  await page.waitForTimeout(450);
  const transitionStart = await canvasAverage(page);
  expect(transitionStart.r + transitionStart.g + transitionStart.b).toBeLessThan(
    (preview.r + preview.g + preview.b) * 0.6
  );

  const exported = await page.evaluate(async () => {
    const result = await window.__videoEditor.exportToBlob({ format: 'mp4', resolution: '480', quality: 'small' });
    const url = URL.createObjectURL(result.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('MP4 could not be decoded'));
    });
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = 0.6;
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    return { r: r / n, g: g / n, b: b / n, size: result.blob.size, width, height };
  });
  expect(exported.size).toBeGreaterThan(50000);
  expect(exported.width).toBe(854);
  expect(exported.height).toBe(480);
  expect(Math.abs(exported.r - exported.g)).toBeLessThan(4);
  expect(Math.abs(exported.g - exported.b)).toBeLessThan(4);
  expect(Math.abs(exported.r - preview.r)).toBeLessThan(8);

  const second = await addClip(page, assetId, 4.2);
  await page.evaluate((id) => {
    window.__videoEditor.selectClip(id);
    window.__videoEditor.seek(4.7);
  }, second);
  await page.waitForTimeout(300);
  await openEffects(page);
  await expect(transition).toBeEnabled();
  await expect(transitionSeconds).toBeDisabled();
  await transition.selectOption('cross-dissolve');
  await expect(transitionSeconds).toBeEnabled();
  await expect.poll(async () => page.evaluate((id) => {
    return window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === id)?.transition?.type;
  }, second)).toBe('cross-dissolve');
  expect(errors).toEqual([]);
});

test('desktop transport and timeline keep separate rows at short viewport heights', async ({ browser }) => {
  for (const width of [900, 1024, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 780 } });
    const page = await context.newPage();
    await openEditor(page);
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
      };
      return {
        transport: rect('.ve-transport'),
        timeline: rect('.ve-timeline-dock'),
        inspector: rect('#ve-inspector'),
        library: rect('#ve-library'),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth
      };
    });
    expect(geometry.transport.bottom).toBeLessThanOrEqual(geometry.timeline.top + 1);
    expect(geometry.inspector.bottom).toBeLessThanOrEqual(geometry.timeline.top + 1);
    expect(geometry.library.bottom).toBeLessThanOrEqual(geometry.timeline.top + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
    await context.close();
  }
});

test('text layers resize with a mouse and with a finger without scrolling the page', async ({ browser }) => {
  test.setTimeout(120000);
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desktop.newPage();
  await openEditor(page);
  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(500);
  const textId = await page.evaluate(() => window.__videoEditor.store.firstSelected().clip.id);
  const box = await page.locator('#ve-canvas-overlay .ve-selection-box').boundingBox();
  const handle = await page.locator('#ve-canvas-overlay .ve-handle-se').boundingBox();
  expect(box.width).toBeGreaterThan(20);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 70, handle.y + handle.height / 2 + 45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const desktopScale = await page.evaluate((id) => window.__videoEditor.project.tracks
    .flatMap((track) => track.clips).find((clip) => clip.id === id)?.scale, textId);
  expect(desktopScale).toBeGreaterThan(1.2);
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    isMobile: true
  });
  const touchPage = await mobile.newPage();
  await openEditor(touchPage);
  await touchPage.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await touchPage.waitForTimeout(500);
  await touchPage.locator('#ve-preview-canvas').scrollIntoViewIfNeeded();
  await touchPage.waitForTimeout(300);
  const before = await touchPage.evaluate(() => {
    const clip = window.__videoEditor.store.firstSelected().clip;
    const handle = document.querySelector('#ve-canvas-overlay .ve-handle-se').getBoundingClientRect();
    const box = document.querySelector('#ve-canvas-overlay .ve-selection-box').getBoundingClientRect();
    return {
      id: clip.id,
      scale: clip.scale,
      scrollY,
      handle: { x: handle.x, y: handle.y, width: handle.width, height: handle.height },
      box: { width: box.width, height: box.height }
    };
  });
  expect(before.handle.width).toBeGreaterThanOrEqual(16);
  expect(before.handle.height).toBeGreaterThanOrEqual(16);
  await touchDrag(
    mobile,
    touchPage,
    { x: before.handle.x + before.handle.width / 2, y: before.handle.y + before.handle.height / 2 },
    { x: before.handle.x + before.handle.width / 2 + 60, y: before.handle.y + before.handle.height / 2 + 40 }
  );
  const after = await touchPage.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks
      .flatMap((track) => track.clips).find((item) => item.id === id);
    const box = document.querySelector('#ve-canvas-overlay .ve-selection-box').getBoundingClientRect();
    return { scale: clip.scale, scrollY, box: { width: box.width, height: box.height } };
  }, before.id);
  expect(after.scale).toBeGreaterThan(before.scale * 1.2);
  expect(after.box.width).toBeGreaterThan(before.box.width);
  expect(after.scrollY).toBe(before.scrollY);
  await mobile.close();
});

test('mobile page scroll, timeline scroll and clip dragging coexist', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();
  await openEditor(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const pageStart = await page.evaluate(() => scrollY);
  await touchDrag(context, page, { x: 195, y: 640 }, { x: 195, y: 380 });
  const pageAfter = await page.evaluate(() => scrollY);
  expect(pageAfter).toBeGreaterThan(pageStart + 100);

  const assetId = await importVideo(page);
  const first = await addClip(page, assetId, 0);
  const second = await addClip(page, assetId, 4.2);
  expect(second).not.toBe(first);
  await page.evaluate((id) => {
    window.__videoEditor.selectClip(id);
    window.__videoEditor.seek(0.5);
  }, first);
  await page.locator('#ve-timeline').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const timeline = await page.evaluate(() => {
    const scrollElement = document.querySelector('#ve-tl-scroll');
    const scroll = scrollElement.getBoundingClientRect();
    const blocked = '.tl-clip, .tl-ruler, .tl-playhead, [data-track-head], [data-subtitle-id], [data-trim]';
    let point = null;
    for (let y = scroll.bottom - 12; y > scroll.top + 8 && !point; y -= 12) {
      for (let x = scroll.right - 18; x > scroll.left + 12; x -= 18) {
        const hit = document.elementFromPoint(x, y);
        if (hit && scrollElement.contains(hit) && !hit.closest(blocked)) {
          point = { x, y };
          break;
        }
      }
    }
    return {
      scrollY,
      scrollLeft: scrollElement.scrollLeft,
      point
    };
  });
  expect(timeline.point).not.toBeNull();
  await touchDrag(context, page, timeline.point, { x: timeline.point.x - 120, y: timeline.point.y });
  const scrolled = await page.evaluate(() => ({
    scrollLeft: document.querySelector('#ve-tl-scroll').scrollLeft,
    scrollY
  }));
  expect(scrolled.scrollLeft).toBeGreaterThan(timeline.scrollLeft + 30);
  expect(scrolled.scrollY).toBe(timeline.scrollY);

  await page.evaluate(() => { document.querySelector('#ve-tl-scroll').scrollLeft = 0; });
  await page.waitForTimeout(150);
  const clipBox = await page.locator(`.tl-clip[data-clip-id="${first}"]`).boundingBox();
  const beforeStart = await page.evaluate((id) => window.__videoEditor.project.tracks
    .flatMap((track) => track.clips).find((clip) => clip.id === id)?.start, first);
  await touchDrag(
    context,
    page,
    { x: clipBox.x + 24, y: clipBox.y + clipBox.height / 2 },
    { x: clipBox.x + 24 + 70, y: clipBox.y + clipBox.height / 2 }
  );
  const afterStart = await page.evaluate((id) => window.__videoEditor.project.tracks
    .flatMap((track) => track.clips).find((clip) => clip.id === id)?.start, first);
  expect(afterStart).toBeGreaterThan(beforeStart + 0.2);
  expect(await page.evaluate(() => scrollY)).toBe(timeline.scrollY);
  await context.close();
});

test('browser Back and Forward use page history and editor actions add no entries', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const home = page.url();
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  const editor = page.url();
  const historyLength = await page.evaluate(() => history.length);

  await page.evaluate(() => {
    window.__videoEditor.setCategory('text');
    window.__videoEditor.addTextPreset('plain');
    window.__videoEditor.undo();
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(page.url()).toBe(editor);

  await page.goBack({ waitUntil: 'domcontentloaded' });
  expect(page.url()).toBe(home);
  await page.goForward({ waitUntil: 'domcontentloaded' });
  expect(page.url()).toBe(editor);
});
