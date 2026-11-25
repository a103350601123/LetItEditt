'use strict';

/* Acceptance suite for the touch-first video editor.
 *
 * Every test drives the real page in Chromium. The suite covers the complete
 * flow (upload, moment, action, save, export), direct manipulation, layers,
 * keyframes, audio, persistence, portability and the required mobile widths.
 */

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-editor/';
const MOBILE_WIDTHS = [320, 360, 375, 390, 430];
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(300000);
  await ensureFixtures(browser, baseURL);
});

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openEditor(page) {
  const errors = collectErrors(page);
  await page.goto(PAGE);
  await page.waitForFunction(() => Boolean(window.__VE__), null, { timeout: 30000 });
  await expect(page.locator('#se-canvas')).toBeVisible();
  return errors;
}

async function uploadVideo(page, name = 'trim-4s.mp4') {
  await page.setInputFiles('#se-file-input', fixturePath(name));
  await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0, null, { timeout: 60000 });
}

async function state(page) {
  return page.evaluate(() => window.__VE__.state());
}

async function clipById(page, id) {
  return page.evaluate((clipId) => {
    const found = window.__VE__.store.trackForClip(clipId);
    return found ? JSON.parse(JSON.stringify(found.clip)) : null;
  }, id);
}

async function addTextThroughUI(page, text) {
  await page.click('[data-tool="text"]');
  await expect(page.locator('.se-sheet')).toBeVisible();
  await page.locator('.se-sheet .se-grid-2 button').first().click();
  const area = page.locator('.se-sheet .se-textarea');
  await area.waitFor();
  await area.fill(text);
  await area.blur();
  await page.locator('.se-sheet-foot .se-btn-primary').click();
  await expect(page.locator('.se-sheet')).toHaveCount(0);
  const current = await state(page);
  return current.selection;
}

async function setRange(page, label, value) {
  await page.evaluate(
    ({ ariaLabel, next }) => {
      const input = [...document.querySelectorAll(`input[type="range"][aria-label="${ariaLabel}"]`)].pop();
      if (!input) throw new Error(`No range named ${ariaLabel}`);
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { ariaLabel: label, next: value }
  );
  await page.waitForTimeout(150);
}

async function dragFrom(page, box, dx, dy) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/* Put the preview below the sticky site header so canvas drags are inside the
 * viewport, exactly as they would be after the person scrolls to the tool.
 * The site stylesheet enables smooth scrolling, so this jump must be instant
 * and the test must wait until the scroll position has settled. */
async function focusStage(page) {
  await page.evaluate(() => {
    window.__seLastScrollY = -1;
    const stage = document.getElementById('se-stage');
    const top = stage.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 180), behavior: 'instant' });
  });
  await page.waitForFunction(() => {
    const current = window.scrollY;
    if (window.__seLastScrollY === current) return true;
    window.__seLastScrollY = current;
    return false;
  }, null, { timeout: 5000 });
}

test('first upload becomes the main video and defines the project', async ({ page }) => {
  const errors = await openEditor(page);
  const empty = await state(page);
  expect(empty.baseClips).toHaveLength(0);
  await expect(page.locator('#se-upload-base')).toBeVisible();

  await uploadVideo(page);
  const loaded = await state(page);
  expect(loaded.baseClips).toHaveLength(1);
  expect(loaded.duration).toBeGreaterThan(3.5);
  expect(loaded.duration).toBeLessThan(4.5);
  expect(loaded.name).toBe('trim-4s');
  expect(loaded.layerCount).toBe(1);
  expect(loaded.tracks.filter((track) => track.kind === 'video')).toHaveLength(1);
  expect(loaded.baseClips[0].mediaId).toBeTruthy();

  await expect(page.locator('.se-layer-row')).toHaveCount(1);
  await expect(page.locator('.se-layer-name')).toContainText('Main video');
  await expect(page.locator('#se-duration')).toContainText('00:04');
  await expect(page.locator('#se-export')).toBeEnabled();
  await expect(page.locator('#se-upload-base')).toBeHidden();
  expect(errors).toEqual([]);
});

test('playback, seeking and the time readout stay in sync', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);

  await page.click('#se-play');
  await page.waitForTimeout(900);
  let current = await state(page);
  expect(current.playing).toBe(true);
  expect(current.playhead).toBeGreaterThan(0.3);
  await expect(page.locator('#se-time')).not.toHaveText('00:00.0');

  await page.click('#se-play');
  current = await state(page);
  expect(current.playing).toBe(false);
  const pausedAt = current.playhead;

  await page.evaluate(() => window.__VE__.seek(2.4));
  await page.waitForTimeout(300);
  current = await state(page);
  expect(current.playhead).toBeCloseTo(2.4, 1);
  await expect(page.locator('#se-time')).toContainText('00:02.4');
  await expect(page.locator('#se-seek')).toHaveValue(/2\.4/);

  await page.evaluate(() => window.__VE__.seek(999));
  current = await state(page);
  expect(current.playhead).toBeCloseTo(current.duration, 1);
  expect(pausedAt).toBeLessThan(current.duration);
  expect(errors).toEqual([]);
});

test('text can be moved, resized and rotated directly, including keyframes', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  const textId = await addTextThroughUI(page, 'Direct manipulation');
  expect(textId).toBeTruthy();

  await page.evaluate(() => window.__VE__.seek(1));
  await focusStage(page);
  const box = await page.locator('.se-selection-box').boundingBox();
  expect(box).toBeTruthy();
  const before = await clipById(page, textId);

  await dragFrom(page, box, 56, 18);
  let after = await clipById(page, textId);
  expect(after.x).toBeGreaterThan(before.x + 0.01);
  expect(after.y).toBeGreaterThan(before.y + 0.005);
  expect((await state(page)).selection).toBe(textId);

  const handle = await page.locator('.se-handle-se').boundingBox();
  await dragFrom(page, handle, 34, 26);
  after = await clipById(page, textId);
  expect(after.scale).toBeGreaterThan(before.scale + 0.02);

  const rotate = await page.locator('.se-handle-rotate').boundingBox();
  await dragFrom(page, rotate, 60, 70);
  after = await clipById(page, textId);
  expect(Math.abs(after.rotation)).toBeGreaterThan(2);

  await page.evaluate((id) => {
    const found = window.__VE__.store.trackForClip(id);
    found.clip.keyframes.x = [
      { t: 0, v: found.clip.x, ease: 'linear' },
      { t: found.clip.duration, v: found.clip.x, ease: 'linear' }
    ];
    window.__VE__.store.emit('live-drag');
  }, textId);
  await page.evaluate(() => window.__VE__.seek(0.6));
  await page.waitForTimeout(350);
  const animatedBox = await page.locator('.se-selection-box').boundingBox();  const baseX = (await clipById(page, textId)).x;
  await dragFrom(page, animatedBox, 42, 0);
  const animated = await clipById(page, textId);
  expect(animated.keyframes.x.length).toBe(3);
  expect(animated.keyframes.x.some((entry) => Math.abs(entry.t - 0.6) < 0.08)).toBe(true);
  expect(animated.x).toBeCloseTo(baseX, 4);

  expect(errors).toEqual([]);
});

test('layers stack, reorder, hide, duplicate, delete and undo', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  await addTextThroughUI(page, 'Layer one');

  await page.setInputFiles('#se-file-input', {
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PNG_PIXEL
  });
  await page.waitForFunction(() => window.__VE__.state().layerCount >= 3, null, { timeout: 30000 });
  await page.setInputFiles('#se-file-input', fixturePath('trim-audio-only.m4a'));
  await page.waitForFunction(
    () => window.__VE__.state().tracks.some((track) => track.kind === 'audio' && track.clips.length > 0),
    null,
    { timeout: 30000 }
  );

  let current = await state(page);
  expect(current.layerCount).toBe(4);
  expect(current.tracks.filter((track) => track.kind === 'video').length).toBe(3);
  await expect(page.locator('.se-layer-row')).toHaveCount(4);

  const imageId = await page.evaluate(() => {
    const image = window.__VE__.store.project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.kind === 'image');
    return image.id;
  });
  const visualBefore = await page.evaluate(() =>
    window.__VE__.store.visualTracks().map((track) => track.clips[0]?.kind || 'empty')
  );
  expect(visualBefore[visualBefore.length - 1]).toBe('video');

  await page.evaluate((id) => window.__VE__.select(id), imageId);
  await page.evaluate(() => window.__VE__.open('clip', window.__VE__.store.selectedId));
  await page.waitForSelector('.se-sheet');
  await page.getByRole('button', { name: 'Send to back' }).click();
  await page.locator('.se-sheet-foot .se-btn-primary').click();
  const visualAfter = await page.evaluate(() =>
    window.__VE__.store.visualTracks().map((track) => track.clips[0]?.kind || 'empty')
  );
  expect(visualAfter[visualAfter.length - 1]).toBe('video');
  expect(visualAfter[visualAfter.length - 2]).toBe('image');

  const textRow = page.locator('.se-layer-row[data-kind="text"]');
  if ((await page.locator('#se-layers-toggle').getAttribute('aria-expanded')) !== 'true') {
    await page.locator('#se-layers-toggle').click();
  }
  await textRow.locator('.se-layer-btn[aria-label^="Hide"]').click();
  const hidden = await page.evaluate(() =>
    window.__VE__.store.project.tracks.flatMap((track) => track.clips).find((clip) => clip.kind === 'text').hidden
  );
  expect(hidden).toBe(true);
  await textRow.locator('.se-layer-btn[aria-label^="Show"]').click();

  await page.evaluate(() => window.__VE__.select(window.__VE__.store.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text').id));
  const duplicated = await page.evaluate(() => window.__VE__.duplicate());
  expect(duplicated).toBeTruthy();
  expect((await state(page)).layerCount).toBe(5);

  await page.evaluate((id) => window.__VE__.remove(id), duplicated);
  expect((await state(page)).layerCount).toBe(4);
  await page.evaluate(() => window.__VE__.undo());
  expect((await state(page)).layerCount).toBe(5);
  await page.evaluate(() => window.__VE__.redo());
  expect((await state(page)).layerCount).toBe(4);

  expect(errors).toEqual([]);
});

test('a second video and a shape become overlay layers above the main video', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  await page.setInputFiles('#se-file-input', fixturePath('trim-4s.mp4'));
  await page.waitForFunction(() => window.__VE__.state().layerCount === 2, null, { timeout: 30000 });

  let order = await page.evaluate(() =>
    window.__VE__.store.visualTracks().map((track) => track.clips[0]?.kind || 'empty')
  );
  expect(order).toEqual(['video', 'video']);

  const shapeId = await page.evaluate(() => window.__VE__.addShape('circle'));
  expect(shapeId).toBeTruthy();
  order = await page.evaluate(() =>
    window.__VE__.store.visualTracks().map((track) => track.clips[0]?.kind || 'empty')
  );
  expect(order[0]).toBe('shape');
  expect(order[order.length - 1]).toBe('video');
  expect((await state(page)).layerCount).toBe(3);

  const shape = await clipById(page, shapeId);
  expect(shape.shape.type).toBe('circle');
  expect(shape.duration).toBeGreaterThan(1);
  await expect(page.locator('.se-layer-row')).toHaveCount(3);
  await expect(page.locator('.se-layer-row').first()).toContainText('Circle');

  const stickerId = await page.evaluate(() => window.__VE__.addSticker('⭐'));
  expect(stickerId).toBeTruthy();
  const sticker = await clipById(page, stickerId);
  expect(sticker.kind).toBe('text');
  expect(sticker.text.content).toBe('⭐');

  await page.evaluate(() => window.__VE__.seek(1));
  await page.waitForTimeout(300);
  const pixels = await page.evaluate(() => {
    const canvas = document.getElementById('se-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 40) {
      const value = data[index] + data[index + 1] + data[index + 2];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return max - min;
  });
  expect(pixels).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('split, trim and speed change the real clip timing', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  await page.evaluate(() => window.__VE__.seek(2));

  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.waitForFunction(() => window.__VE__.state().baseClips.length === 2);
  const split = await state(page);
  expect(split.baseClips[0].duration).toBeCloseTo(2, 1);
  expect(split.baseClips[1].start).toBeCloseTo(2, 1);
  expect(split.baseClips[1].duration).toBeCloseTo(split.duration - 2, 1);

  const secondId = split.baseClips[1].id;
  await page.evaluate((id) => {
    window.__VE__.select(id);
    window.__VE__.open('clip', id);
  }, secondId);
  await page.waitForSelector('.se-sheet');
  const before = await clipById(page, secondId);
  await setRange(page, 'Playback speed', 1.5);
  const faster = await clipById(page, secondId);
  expect(faster.speed).toBeCloseTo(1.5, 2);
  expect(faster.duration).toBeLessThan(before.duration);
  expect(faster.outPoint - faster.inPoint).toBeCloseTo(faster.duration * 1.5, 1);

  await page.evaluate(() => window.__VE__.seek(2.5));
  await page.getByRole('button', { name: 'Trim start here' }).click();
  const trimmed = await clipById(page, secondId);
  expect(trimmed.start).toBeCloseTo(2.5, 1);
  expect(trimmed.duration).toBeLessThan(faster.duration);

  await setRange(page, 'Opacity', 0.55);
  expect((await clipById(page, secondId)).opacity).toBeCloseTo(0.55, 2);
  await page.locator('.se-sheet-foot .se-btn-primary').click();

  await page.evaluate(() => window.__VE__.undo());
  await page.evaluate(() => window.__VE__.undo());
  const undone = await state(page);
  expect(undone.baseClips.length).toBe(2);
  expect(undone.baseClips[1].start).toBeCloseTo(2, 1);

  expect(errors).toEqual([]);
});

test('filters, colour, transitions and crop are stored as project data', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);

  await page.click('[data-tool="filter"]');
  await expect(page.locator('.se-filter-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Sepia' }).click();
  await setRange(page, 'Brightness', 18);
  await page.locator('.se-sheet-foot .se-btn-primary').click();

  let base = await page.evaluate(() => window.__VE__.store.baseTrack().clips[0]);
  expect(base.filter).toBe('sepia');
  expect(base.color.brightness).toBeCloseTo(18, 0);

  await page.getByRole('button', { name: 'Transition', exact: true }).click();
  await expect(page.locator('.se-transition-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Cross Dissolve' }).click();
  await page.locator('.se-sheet-foot .se-btn-primary').click();
  base = await page.evaluate(() => window.__VE__.store.baseTrack().clips[0]);
  expect(base.transition.type).toBe('cross-dissolve');

  await page.evaluate(() => window.__VE__.open('clip', window.__VE__.store.baseTrack().clips[0].id));
  await page.waitForSelector('.se-sheet');
  await setRange(page, 'Crop right', 0.12);
  await setRange(page, 'Rotation', 14);
  await setRange(page, 'Horizontal position', 0.44);
  await page.locator('.se-sheet-foot .se-btn-primary').click();
  base = await page.evaluate(() => window.__VE__.store.baseTrack().clips[0]);
  expect(base.crop.right).toBeCloseTo(0.12, 2);
  expect(base.rotation).toBeCloseTo(14, 0);
  expect(base.x).toBeCloseTo(0.44, 2);

  expect(errors).toEqual([]);
});

test('audio layers expose volume, fades, keyframes and preview mute', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  await page.setInputFiles('#se-file-input', fixturePath('trim-audio-only.m4a'));
  await page.waitForFunction(
    () => window.__VE__.state().tracks.some((track) => track.kind === 'audio' && track.clips.length > 0),
    null,
    { timeout: 30000 }
  );
  const audioId = await page.evaluate(() => {
    const clip = window.__VE__.store.project.tracks
      .flatMap((track) => track.clips)
      .find((entry) => entry.kind === 'audio');
    return clip.id;
  });

  await page.click('[data-tool="audio"]');
  await expect(page.locator('.se-sheet')).toBeVisible();
  await setRange(page, 'Volume', 0.42);
  await setRange(page, 'Fade in', 0.5);
  await setRange(page, 'Fade out', 0.4);
  await page.getByRole('button', { name: 'Add at playhead' }).click();
  const audio = await clipById(page, audioId);
  expect(audio.volume).toBeCloseTo(0.42, 2);
  expect(audio.fadeIn).toBeCloseTo(0.5, 1);
  expect(audio.fadeOut).toBeCloseTo(0.4, 1);
  expect(audio.keyframes.volume.length).toBe(1);

  await page.evaluate(() => window.__VE__.seek(1));
  await setRange(page, 'Volume', 0.2);
  const animated = await clipById(page, audioId);
  expect(animated.volume).toBeCloseTo(0.42, 2);
  expect(animated.keyframes.volume.length).toBe(2);
  await page.keyboard.press('Escape');

  await page.click('#se-mute');
  expect((await state(page)).previewDebug.audio.muted).toBe(true);
  await expect(page.locator('#se-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#se-mute');
  expect((await state(page)).previewDebug.audio.muted).toBe(false);

  expect(errors).toEqual([]);
});

test('local autosave restores the edit and its media after a reload', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  await addTextThroughUI(page, 'Restored title');
  await page.evaluate(() => window.__VE__.open('captions'));
  await page.getByRole('button', { name: 'Add caption at playhead' }).click();
  await page.locator('.se-sheet .se-textarea').fill('Restored caption');
  await page.locator('.se-sheet .se-textarea').blur();
  await page.locator('.se-sheet-foot .se-btn-primary').click();

  const saved = await page.evaluate(() => window.__VE__.saveNow());
  expect(saved.savedAt).toBeGreaterThan(0);
  expect(saved.mediaCount).toBe(1);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__VE__), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0, null, { timeout: 60000 });
  const restored = await state(page);
  expect(restored.layerCount).toBe(2);
  expect(restored.subtitles.items).toHaveLength(1);
  expect(restored.subtitles.items[0].text).toBe('Restored caption');
  expect(restored.missingMedia).toEqual([]);
  expect(restored.mediaCount || 1).toBe(1);
  await expect(page.locator('.se-layer-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('project JSON downloads, reopens and relinks media by filename', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  await addTextThroughUI(page, 'Portable project');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#se-save');
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.letitedit\.json$/);
  const payload = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));
  expect(payload.project.tracks.length).toBeGreaterThan(0);
  expect(payload.media).toHaveLength(1);
  expect(payload.media[0].name).toBe('trim-4s.mp4');
  expect(payload.media[0].file).toBeUndefined();

  await page.evaluate(() => window.__VE__.app.newProject());
  await page.setInputFiles('#se-project-input', downloadedPath);
  await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0, null, { timeout: 30000 });
  let reopened = await state(page);
  expect(reopened.name).toBe('trim-4s');
  expect(reopened.layerCount).toBe(2);
  expect(reopened.missingMedia.length).toBeGreaterThan(0);
  if (await page.locator('.se-sheet').count()) await page.keyboard.press('Escape');

  await page.setInputFiles('#se-file-input', fixturePath('trim-4s.mp4'));
  await page.waitForFunction(() => window.__VE__.state().missingMedia.length === 0, null, { timeout: 30000 });
  reopened = await state(page);
  expect(reopened.layerCount).toBe(2);
  expect(reopened.mediaCount || 1).toBe(1);
  expect(errors).toEqual([]);
});

test('export writes a real file that decodes with the edited duration', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await openEditor(page);
  await uploadVideo(page);
  await addTextThroughUI(page, 'Exported title');
  await page.evaluate(() => window.__VE__.seek(1));
  await page.click('[data-tool="filter"]');
  await page.locator('.se-filter-card', { hasText: 'Vivid' }).click();
  await page.locator('.se-sheet-foot .se-btn-primary').click();

  const projectDuration = (await state(page)).duration;
  await page.click('#se-export');
  await expect(page.locator('.se-sheet-title')).toHaveText('Export video');
  await page.waitForFunction(
    () => {
      const button = document.getElementById('se-export-start');
      return button && !button.disabled;
    },
    null,
    { timeout: 30000 }
  );

  const formats = page.locator('.se-sheet-body .se-seg').first().getByRole('button');
  if (await formats.filter({ hasText: 'WebM' }).isEnabled()) {
    await formats.filter({ hasText: 'WebM' }).click();
  }
  const resolutionSeg = page.locator('.se-sheet-body .se-seg').nth(1);
  await resolutionSeg.getByRole('button', { name: '480p' }).click();
  const qualitySeg = page.locator('.se-sheet-body .se-seg').nth(2);
  await qualitySeg.getByRole('button', { name: 'Small' }).click();
  await page.click('#se-export-start');

  await page.waitForFunction(
    () => {
      const bar = document.querySelector('.se-progress > span');
      return Boolean(bar && /%$/.test(bar.style.width));
    },
    null,
    { timeout: 60000 }
  );
  const phaseText = await page.locator('#se-export-phase').innerText();
  expect(phaseText).toMatch(/%/);

  await expect(page.locator('.se-sheet-title')).toHaveText('Export complete', { timeout: 150000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download video' }).click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(fs.statSync(exportedPath).size).toBeGreaterThan(2000);

  const verification = await page.evaluate(async () => {
    const result = window.__VE__.app.lastExport;
    if (!result) throw new Error('The export result was not stored.');
    const url = URL.createObjectURL(result.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('The exported file did not decode.'));
    });
    video.currentTime = Math.min(0.5, Math.max(0, video.duration / 2));
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      const value = data[index] + data[index + 1] + data[index + 2];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    URL.revokeObjectURL(url);
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      range: max - min,
      meta: result.meta,
      size: result.blob.size
    };
  });

  expect(verification.duration).toBeCloseTo(projectDuration, 0);
  expect(verification.width).toBe(854);
  expect(verification.height).toBe(480);
  expect(verification.range).toBeGreaterThan(12);
  expect(verification.meta.hasAudio).toBe(true);
  expect(verification.meta.size).toBeGreaterThan(2000);
  expect(fs.statSync(exportedPath).size).toBe(verification.size);
  expect(errors).toEqual([]);
});

test('keyboard shortcuts drive playback, history and selection', async ({ page }) => {
  const errors = await openEditor(page);
  await uploadVideo(page);
  const textId = await addTextThroughUI(page, 'Shortcut layer');

  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  expect((await state(page)).playing).toBe(true);
  await page.keyboard.press('Space');
  expect((await state(page)).playing).toBe(false);

  await page.evaluate(() => window.__VE__.seek(0));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  expect((await state(page)).playhead).toBeGreaterThan(0.5);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(120);
  expect((await state(page)).playhead).toBeGreaterThan(1.5);

  await page.evaluate((id) => window.__VE__.select(id), textId);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  expect((await state(page)).layerCount).toBe(1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  expect((await state(page)).layerCount).toBe(2);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);
  expect((await state(page)).layerCount).toBe(1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  await page.evaluate((id) => window.__VE__.select(id), textId);
  await page.keyboard.press('Escape');
  expect((await state(page)).selection).toBe(null);
  expect(errors).toEqual([]);
});

for (const width of MOBILE_WIDTHS) {
  test(`mobile ${width}px: no overflow, usable targets, scrolling and a fitting sheet`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 740 });
    const errors = await openEditor(page);
    await uploadVideo(page);
    await addTextThroughUI(page, 'Mobile layer');
    if ((await page.locator('#se-layers-toggle').getAttribute('aria-expanded')) !== 'true') {
      await page.locator('#se-layers-toggle').click();
    }

    const layout = await page.evaluate(() => {
      const app = document.getElementById('se-app');
      const visible = (selector) => [...document.querySelectorAll(selector)].filter((node) => node.offsetParent !== null);
      const toolbar = visible('.se-toolbar .se-tool');
      const actions = visible('.se-actions .se-action');
      const icons = visible('.se-icon-btn');
      const layers = visible('.se-layer-btn');
      const rects = (nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        appLeft: app.getBoundingClientRect().left,
        appRight: app.getBoundingClientRect().right,
        toolbar: rects(toolbar),
        actions: rects(actions),
        icons: rects(icons),
        layers: rects(layers),
        actionsScrollable: (() => {
          const row = document.querySelector('.se-actions');
          return row.scrollWidth >= row.clientWidth;
        })()
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(width);
    expect(layout.bodyWidth).toBeLessThanOrEqual(width);
    expect(layout.appLeft).toBeGreaterThanOrEqual(0);
    expect(layout.appRight).toBeLessThanOrEqual(width);
    for (const list of [layout.toolbar, layout.actions, layout.icons, layout.layers]) {
      for (const item of list) {
        expect(item.height).toBeGreaterThanOrEqual(43.5);
        expect(item.width).toBeGreaterThanOrEqual(43.5);
      }
    }

    await focusStage(page);
    const stage = await page.locator('#se-frame').boundingBox();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(400);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBeGreaterThan(scrollBefore + 40);

    await page.evaluate(() => window.__VE__.open('text'));
    await page.waitForSelector('.se-sheet');
    await page.locator('.se-sheet .se-grid-2 button').first().click();
    await page.locator('.se-sheet .se-textarea').waitFor();
    await page.waitForTimeout(300);
    const sheet = await page.locator('.se-sheet').boundingBox();
    const close = await page.locator('.se-sheet-close').boundingBox();
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(741);
    expect(sheet.width).toBeLessThanOrEqual(width);
    expect(close.width).toBeGreaterThanOrEqual(43.5);
    expect(close.height).toBeGreaterThanOrEqual(43.5);

    const sheetMetrics = await page.evaluate(() => {
      const body = document.querySelector('.se-sheet-body');
      const foot = document.querySelector('.se-sheet-foot');
      return {
        scrollable: body.scrollHeight > body.clientHeight,
        bodyHeight: body.clientHeight,
        footHeight: foot ? foot.getBoundingClientRect().height : 0
      };
    });
    expect(sheetMetrics.bodyHeight).toBeGreaterThan(100);
    expect(sheetMetrics.footHeight).toBeGreaterThanOrEqual(44);

    await page.screenshot({ path: `test-results/editor-${width}.png` });
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
}

test('tablet and desktop keep the preview and layers usable side by side', async ({ page }) => {
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const errors = await openEditor(page);
    await uploadVideo(page);
    await addTextThroughUI(page, 'Wide layout');

    const layout = await page.evaluate(() => {
      const stage = document.getElementById('se-stage').getBoundingClientRect();
      const layers = document.getElementById('se-layers').getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        stage: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom, width: stage.width },
        layers: { left: layers.left, right: layers.right, top: layers.top, width: layers.width }
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(width);
    expect(layout.stage.width).toBeGreaterThan(300);
    expect(layout.stage.left).toBeGreaterThanOrEqual(0);
    expect(layout.stage.right).toBeLessThanOrEqual(width);
    expect(layout.layers.left).toBeGreaterThanOrEqual(layout.stage.left - 1);
    expect(layout.layers.top).toBeGreaterThanOrEqual(layout.stage.bottom - 1);
    expect(errors).toEqual([]);
  }
});

test('playback with video, text and a second layer never shows a black frame', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openEditor(page);
  await uploadVideo(page);
  await page.setInputFiles('#se-file-input', fixturePath('trim-2s-mute.mp4'));
  await page.waitForFunction(() => window.__VE__.state().layerCount === 2, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__VE__.addText('title');
    window.__VE__.addShape('circle');
    window.__VE__.seek(0);
  });
  await page.waitForTimeout(700);

  const result = await page.evaluate(async () => {
    const samples = [];
    const canvas = document.getElementById('se-canvas');
    const ctx = canvas.getContext('2d');
    const brightness = () => {
      try {
        const data = ctx.getImageData(canvas.width * 0.5, canvas.height * 0.5, 1, 1).data;
        return (data[0] + data[1] + data[2]) / 3;
      } catch (error) {
        return -1;
      }
    };
    window.__VE__.play();
    const started = performance.now();
    while (performance.now() - started < 3200) {
      const debug = window.__VE__.preview.debug();
      samples.push({
        lag: debug.renderLag,
        brightness: brightness(),
        videoElements: debug.videoElements
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    window.__VE__.pause();
    return samples;
  });

  const black = result.filter((sample) => sample.brightness >= 0 && sample.brightness < 6);
  const lags = result.map((sample) => sample.lag).filter((value) => typeof value === 'number');
  expect(black).toEqual([]);
  expect(Math.max(...lags)).toBeLessThan(0.2);
  expect(result[result.length - 1].videoElements).toBe(2);
  expect(errors).toEqual([]);
});

test('export keeps cuts, text, filters, transitions and audio edits matching the preview', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await openEditor(page);
  await uploadVideo(page);
  await page.setInputFiles('#se-file-input', fixturePath('trim-2s-mute.mp4'));
  await page.waitForFunction(() => window.__VE__.state().layerCount === 2, null, { timeout: 30000 });

  const built = await page.evaluate(() => {
    const ve = window.__VE__;
    ve.addText('title');
    ve.addShape('circle');
    ve.seek(2);
    const baseId = ve.store.baseTrack().clips[0].id;
    ve.select(baseId);
    ve.split(baseId);
    ve.store.apply((project) => {
      const track = project.tracks.find((item) => item.id === project.baseTrackId);
      const first = track.clips.find((clip) => clip.start < 1);
      const second = track.clips.find((clip) => clip.start >= 1.9);
      if (first) {
        first.fadeIn = 1.2;
        first.volume = 0.9;
      }
      if (second) {
        second.transition = { type: 'cross-dissolve', duration: 0.6, reverse: false };
        second.fadeOut = 0.6;
        second.filter = 'vivid';
        second.filterIntensity = 0.8;
      }
      const text = project.tracks
        .flatMap((item) => item.clips)
        .find((clip) => clip.kind === 'text' && clip.text?.content === 'Your title');
      if (text) {
        text.x = 0.3;
        text.y = 0.28;
        text.scale = 0.72;
        text.rotation = -12;
      }
    });
    return { duration: ve.store.duration(), layers: ve.store.layerEntries().length };
  });
  expect(built.layers).toBe(5);

  await page.evaluate(() => window.__VE__.seek(1.2));
  await page.waitForTimeout(600);

  const wallMs = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.__VE__.exportNow({
      format: 'mp4',
      resolution: '720',
      quality: 'balanced',
      includeAudio: true
    });
    window.__VE__.app.lastExportWallMs = performance.now() - started;
    return window.__VE__.app.lastExportWallMs;
  });
  expect(wallMs).toBeGreaterThan(0);

  const comparison = await page.evaluate(async (times) => {
    const result = window.__VE__.app.lastExport;
    const url = URL.createObjectURL(result.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('The exported file did not decode.'));
    });

    const width = 160;
    const height = 90;
    const shot = document.createElement('canvas');
    shot.width = width;
    shot.height = height;
    const shotCtx = shot.getContext('2d');
    const preview = document.getElementById('se-canvas');
    const previewShot = document.createElement('canvas');
    previewShot.width = width;
    previewShot.height = height;
    const previewCtx = previewShot.getContext('2d');

    const differences = [];
    for (const time of times) {
      window.__VE__.seek(time);
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline) {
        const debug = window.__VE__.preview.debug();
        if (
          !debug.renderInFlight &&
          debug.renderedTime !== null &&
          Math.abs(debug.renderedTime - time) < 0.05
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      previewCtx.drawImage(preview, 0, 0, width, height);
      const previewData = previewCtx.getImageData(0, 0, width, height).data;

      let best = Infinity;
      for (const offset of [0, -1 / 30, 1 / 30]) {
        video.currentTime = Math.max(0, Math.min(video.duration - 0.001, time + offset));
        await new Promise((resolve) => {
          video.onseeked = resolve;
        });
        shotCtx.drawImage(video, 0, 0, width, height);
        const exportedData = shotCtx.getImageData(0, 0, width, height).data;
        let sum = 0;
        for (let index = 0; index < exportedData.length; index += 4) {
          sum += Math.abs(exportedData[index] - previewData[index]);
          sum += Math.abs(exportedData[index + 1] - previewData[index + 1]);
          sum += Math.abs(exportedData[index + 2] - previewData[index + 2]);
        }
        best = Math.min(best, sum / ((exportedData.length / 4) * 3));
      }
      differences.push({ time, meanAbs: best });
    }

    const audioBuffer = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(
      await result.blob.arrayBuffer()
    );
    const channel = audioBuffer.getChannelData(0);
    const windowRms = (start, length) => {
      const from = Math.max(0, Math.floor(start * audioBuffer.sampleRate));
      const to = Math.min(channel.length, Math.floor((start + length) * audioBuffer.sampleRate));
      let sum = 0;
      for (let index = from; index < to; index += 1) sum += channel[index] * channel[index];
      return Math.sqrt(sum / Math.max(1, to - from));
    };

    URL.revokeObjectURL(url);
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      differences,
      audio: {
        start: windowRms(0.02, 0.25),
        middle: windowRms(1.6, 0.25),
        end: windowRms(audioBuffer.duration - 0.3, 0.25)
      },
      meta: result.meta
    };
  }, [0.4, 2.25, 3.4]);

  expect(comparison.duration).toBeCloseTo(built.duration, 0);
  expect(comparison.width).toBe(1280);
  expect(comparison.height).toBe(720);
  expect(comparison.meta.hasAudio).toBe(true);
  for (const diff of comparison.differences) expect(diff.meanAbs).toBeLessThan(22);
  expect(comparison.audio.middle).toBeGreaterThan(0.02);
  expect(comparison.audio.start).toBeLessThan(comparison.audio.middle);
  expect(comparison.audio.end).toBeLessThan(comparison.audio.middle);
  expect(errors).toEqual([]);
});
