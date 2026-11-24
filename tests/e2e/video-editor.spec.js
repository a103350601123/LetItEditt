'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-editor/';

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
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__videoEditor), null, { timeout: 30000 });
  await expect(page.locator('#ve-preview-canvas')).toBeVisible();
  return errors;
}

async function importFiles(page, names) {
  const before = await page.evaluate(() => window.__videoEditor.media.list().length);
  await page.setInputFiles('#ve-media-input', names.map(fixturePath));
  await page.waitForFunction(
    (expected) => window.__videoEditor.media.list().length >= expected,
    before + names.length,
    { timeout: 60000 }
  );
}

async function readSnapshot(page) {
  return page.evaluate(() => {
    const ed = window.__videoEditor;
    return {
      name: ed.project.name,
      aspect: ed.project.aspect,
      resolution: ed.project.resolution,
      fps: ed.project.fps,
      masterVolume: ed.project.masterVolume,
      tracks: ed.project.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        kind: track.kind,
        hidden: track.hidden,
        locked: track.locked,
        muted: track.muted,
        volume: track.volume,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          kind: clip.kind,
          start: clip.start,
          duration: clip.duration,
          mediaId: clip.mediaId,
          name: clip.name,
          hidden: clip.hidden,
          locked: clip.locked,
          transition: clip.transition?.type || 'none',
          filter: clip.filter || 'none',
          filterIntensity: clip.filterIntensity,
          scale: clip.scale,
          rotation: clip.rotation,
          x: clip.x,
          y: clip.y,
          speed: clip.speed,
          reverse: clip.reverse,
          volume: clip.volume,
          muted: clip.muted,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          keyframes: clip.keyframes
            ? Object.fromEntries(Object.entries(clip.keyframes).map(([key, list]) => [key, (list || []).length]))
            : {}
        }))
      })),
      subtitles: ed.project.subtitles,
      selection: [...ed.state.selection],
      playhead: ed.state.playhead
    };
  });
}

async function frameStats(page, time) {
  return page.evaluate(async (at) => {
    const ed = window.__videoEditor;
    ed.seek(at);
    await ed.renderPreview();
    const canvas = ed.elements.previewCanvas;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    let sum = 0;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4 * 13) {
      const value = data[i] + data[i + 1] + data[i + 2];
      if (value > 24) lit += 1;
      sum += value;
      hash = Math.imul(hash ^ value, 16777619) >>> 0;
    }
    return { lit, sum, hash, width: canvas.width, height: canvas.height };
  }, time);
}

/* Reads the exported file back through a <video> element, measures it and
 * samples the real decoded frame (including the lower band where text and
 * subtitles live). */
async function exportAndInspect(page, options, inspectTime) {
  return page.evaluate(async ({ settings, at }) => {
    const ed = window.__videoEditor;
    const out = await ed.exportToBlob(settings);
    const url = URL.createObjectURL(out.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('The exported file could not be decoded.'));
      });
      const seekTo = at ?? Math.min(0.6, Math.max(0.05, out.meta.duration / 2));
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = Math.min(seekTo, Math.max(0.01, video.duration - 0.05));
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      let bandLit = 0;
      let bandHash = 2166136261;
      const bandStart = Math.floor(canvas.height * 0.55);
      for (let y = 0; y < canvas.height; y += 3) {
        for (let x = 0; x < canvas.width; x += 3) {
          const i = (y * canvas.width + x) * 4;
          const value = data[i] + data[i + 1] + data[i + 2];
          if (value > 30) lit += 1;
          if (y >= bandStart) {
            if (value > 30) bandLit += 1;
            bandHash = Math.imul(bandHash ^ value, 16777619) >>> 0;
          }
        }
      }
      return {
        size: out.blob.size,
        meta: out.meta,
        playback: {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration
        },
        lit,
        bandLit,
        bandHash
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, { settings: options, at: inspectTime });
}

async function setInputValue(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function blur(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
}

async function addVideoClip(page, name = 'trim-4s.mp4') {
  await importFiles(page, [name]);
  return page.evaluate(() => {
    const ed = window.__videoEditor;
    const asset = ed.media.list().find((item) => item.type === 'video');
    const clip = ed.addAssetToTimeline(asset.id, { start: 0 });
    ed.selectClip(clip.id, { additive: false });
    ed.seek(Math.min(0.6, clip.duration / 2));
    return { clipId: clip.id, assetId: asset.id, duration: clip.duration };
  });
}

async function seek(page, time) {
  await page.evaluate((at) => window.__videoEditor.seek(at), time);
}

async function setClipHidden(page, clipId, hidden) {
  await page.evaluate(({ id, value }) => {
    window.__videoEditor.store.apply((draft) => {
      for (const track of draft.tracks) {
        const clip = track.clips.find((item) => item.id === id);
        if (clip) clip.hidden = value;
      }
    });
  }, { id: clipId, value: hidden });
}

/* ------------------------------------------------------------------------- */

test('page structure, documentation and initial workspace are complete', async ({ page }) => {
  const errors = await openEditor(page);

  await expect(page).toHaveTitle(/Professional Video Editor/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /multi-track timeline/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-editor/'
  );
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Professional Video Editor');
  expect(await page.locator('h2').count()).toBeGreaterThan(6);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();

  const structured = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')]
      .flatMap((script) => {
        const data = JSON.parse(script.textContent);
        return data['@graph'] || [data];
      })
      .map((item) => item['@type'])
  );
  expect(structured).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  const initial = await readSnapshot(page);
  expect(initial.tracks.map((track) => track.kind)).toEqual(['video', 'video', 'audio']);
  expect(initial.tracks.every((track) => track.clips.length === 0)).toBe(true);
  expect(initial.subtitles.items).toHaveLength(0);

  const tabs = await page.locator('#ve-tabs [data-tab]').evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.tab)
  );
  expect(tabs).toEqual([
    'media',
    'text',
    'audio',
    'overlays',
    'transitions',
    'filters',
    'effects',
    'subtitles',
    'layers'
  ]);

  await expect(page.locator('#ve-preview-empty')).toBeVisible();
  await expect(page.locator('#ve-export-open')).toBeEnabled();
  await expect(page.locator('#ve-help')).toHaveCount(1);

  const support = await page.evaluate(() => window.__videoEditor.support());
  expect(support.renderer).toBe(true);
  expect(support.encoder).toBe(true);
  expect(support.decoder).toBe(true);

  /* Every field is labelled and every button has an accessible name. */
  const unlabelled = await page.evaluate(() => {
    const missing = [];
    const text = (element) => (element.textContent || '').trim();
    for (const element of document.querySelectorAll('#ve-app input, #ve-app select, #ve-app textarea')) {
      const aria = element.getAttribute('aria-label');
      const labelledBy = element.getAttribute('aria-labelledby');
      const wrapping = element.closest('label');
      const labelText = wrapping ? text(wrapping) : '';
      const title = element.getAttribute('title') || '';
      if (!aria && !labelledBy && !labelText && !title) {
        missing.push(`${element.tagName.toLowerCase()}#${element.id || ''}[${element.type}]`);
      }
    }
    for (const button of document.querySelectorAll('#ve-app button')) {
      if (!text(button) && !button.getAttribute('aria-label') && !button.getAttribute('title')) {
        missing.push(`button.${button.className}`);
      }
    }
    return missing;
  });
  expect(unlabelled).toEqual([]);

  const reducedMotion = await page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch (error) {
        return [];
      }
    });
    return rules.some((rule) => rule.conditionText && rule.conditionText.includes('prefers-reduced-motion'));
  });
  expect(reducedMotion).toBe(true);

  expect(errors).toEqual([]);
});

test('media import validates files, shows metadata, reuses and removes them', async ({ page }) => {
  const errors = await openEditor(page);

  await importFiles(page, ['trim-4s.mp4', 'sample.png', 'trim-audio-only.m4a']);
  const assets = await page.evaluate(() =>
    window.__videoEditor.media.list().map((asset) => ({
      name: asset.name,
      type: asset.type,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      size: asset.size,
      thumbnail: Boolean(asset.thumbnail)
    }))
  );
  expect(assets).toHaveLength(3);
  const video = assets.find((asset) => asset.name === 'trim-4s.mp4');
  const image = assets.find((asset) => asset.name === 'sample.png');
  const audio = assets.find((asset) => asset.name === 'trim-audio-only.m4a');
  expect(video.type).toBe('video');
  expect(video.width).toBe(640);
  expect(video.height).toBe(360);
  expect(video.duration).toBeGreaterThan(3.5);
  expect(video.thumbnail).toBe(true);
  expect(image.type).toBe('image');
  expect(image.width).toBe(320);
  expect(image.height).toBe(200);
  expect(image.thumbnail).toBe(true);
  expect(audio.type).toBe('audio');
  expect(audio.duration).toBeGreaterThan(0.5);

  await expect(page.locator('.ve-media-card')).toHaveCount(3);
  await expect(page.locator('.ve-media-card', { hasText: 'trim-4s.mp4' })).toContainText('Video');
  await expect(page.locator('.ve-media-card', { hasText: 'sample.png' })).toContainText('320×200');
  await expect(page.locator('.ve-media-card', { hasText: 'trim-audio-only.m4a' })).toContainText('Audio');

  /* Invalid files are rejected with explicit messages and do not break import. */
  await page.setInputFiles('#ve-media-input', [fixturePath('trim-corrupt.mp4'), fixturePath('trim-not-video.avi')]);
  await page.waitForFunction(() => window.__videoEditor.state.importErrors.length >= 2, null, { timeout: 30000 });
  const failures = await page.evaluate(() => window.__videoEditor.state.importErrors);
  expect(failures.join(' ')).toContain('trim-corrupt.mp4');
  expect(failures.join(' ')).toContain('trim-not-video.avi');
  await expect(page.locator('.ve-alert-warn').first()).toBeVisible();

  /* Add the video, then swap its source with the transparent PNG through "Use". */
  const clipId = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const asset = ed.media.list().find((item) => item.name === 'trim-4s.mp4');
    const clip = ed.addAssetToTimeline(asset.id, { start: 0 });
    ed.selectClip(clip.id, { additive: false });
    return clip.id;
  });
  await page.locator('.ve-media-card:has-text("sample.png") [data-media-action="replace"]').click();
  await page.waitForFunction(
    (id) => {
      const clip = window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((item) => item.id === id);
      return Boolean(clip && clip.kind === 'image' && /sample\.png/.test(clip.name));
    },
    clipId,
    { timeout: 30000 }
  );

  /* The properties panel can import a brand new file straight into the clip. */
  await page.locator('#ve-props-body [data-prop-action="replace"]').click();
  await page.setInputFiles('#ve-replace-input', fixturePath('sample-alpha.png'));
  await page.waitForFunction(
    (id) => {
      const clip = window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((item) => item.id === id);
      return Boolean(clip && clip.kind === 'image' && /sample-alpha/.test(clip.name));
    },
    clipId,
    { timeout: 30000 }
  );

  /* Removing unused media is immediate; used media is guarded by a confirm. */
  const used = await page.evaluate(() =>
    window.__videoEditor.project.tracks.flatMap((track) => track.clips).map((clip) => clip.mediaId)
  );
  const unused = await page.evaluate(
    (ids) => window.__videoEditor.media.list().find((asset) => !ids.includes(asset.id)).id,
    used
  );
  await page.evaluate((id) => {
    document.querySelector(`[data-media-id="${id}"] [data-media-action="remove"]`).click();
  }, unused);
  await page.waitForFunction((id) => !window.__videoEditor.media.list().some((asset) => asset.id === id), unused);
  await expect(page.locator('.ve-media-card')).toHaveCount(3);

  expect(errors).toEqual([]);
});

test('timeline trims, splits, duplicates, moves across tracks and manages tracks', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideoClip(page);
  await expect(page.locator('.ve-clip')).toHaveCount(1);

  /* Drag the clip body to the right; its start time changes. */
  await page.locator('.ve-clip').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const clip = page.locator('.ve-clip').first();
  let box = await clip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 94, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  let snapshot = await readSnapshot(page);
  const firstClip = snapshot.tracks.flatMap((track) => track.clips)[0];
  expect(firstClip.start).toBeGreaterThan(0.5);

  /* Right-edge drag trims duration. */
  const trim = await page.locator('.ve-clip .ve-trim-end').first().boundingBox();
  await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2);
  await page.mouse.down();
  await page.mouse.move(trim.x + trim.width / 2 - 80, trim.y + trim.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  snapshot = await readSnapshot(page);
  const trimmed = snapshot.tracks.flatMap((track) => track.clips)[0];
  expect(trimmed.duration).toBeLessThan(firstClip.duration - 0.3);

  /* Keyboard trimming keeps focus and works repeatedly. */
  await page.locator('.ve-clip .ve-trim-start').first().focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(200);
  snapshot = await readSnapshot(page);
  const keyboardTrimmed = snapshot.tracks.flatMap((track) => track.clips)[0];
  expect(keyboardTrimmed.start).toBeGreaterThan(trimmed.start + 0.5);
  expect(keyboardTrimmed.duration).toBeLessThan(trimmed.duration - 0.5);

  /* Split at the playhead through the toolbar, then undo and redo. */
  const mid = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const current = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.selectClip(current.id, { additive: false });
    ed.seek(current.start + current.duration / 2);
    return current.start + current.duration / 2;
  });
  await page.locator('#ve-timeline [data-timeline-action="split"]').click();
  await page.waitForTimeout(250);
  snapshot = await readSnapshot(page);
  let clips = snapshot.tracks.flatMap((track) => track.clips);
  expect(clips).toHaveLength(2);
  expect(Math.abs(clips[0].start + clips[0].duration - mid)).toBeLessThan(0.1);

  await blur(page);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips)).toHaveLength(1);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips)).toHaveLength(2);

  /* Duplicate and delete through the properties panel. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    ed.selectClip(ed.project.tracks.flatMap((track) => track.clips)[0].id, { additive: false });
  });
  await expect(page.locator('#ve-props-body')).toContainText('Timing');
  await page.locator('#ve-props-body [data-prop-action="duplicate"]').click();
  await page.waitForTimeout(250);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips).length).toBeGreaterThanOrEqual(3);
  await page.locator('#ve-props-body [data-prop-action="delete"]').click();
  await page.waitForTimeout(250);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips)).toHaveLength(2);

  /* Move the first clip onto the empty top video layer and check the insert indicator. */
  await page.locator('#ve-timeline').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const moveSetup = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const first = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.selectClip(first.id, { additive: false });
    const top = ed.project.tracks.find((track) => track.kind === 'video');
    return { clipId: first.id, topTrackId: top.id, start: first.start };
  });
  const clipBox = await page.locator(`.ve-clip[data-clip-id="${moveSetup.clipId}"]`).boundingBox();
  const targetRow = await page
    .locator(`[data-track-row][data-track-id="${moveSetup.topTrackId}"]`)
    .boundingBox();
  await page.mouse.move(clipBox.x + 24, clipBox.y + clipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(clipBox.x + 24, targetRow.y + targetRow.height / 2, { steps: 12 });
  await page.waitForTimeout(200);
  const insertVisible = await page.locator('[data-insert].is-visible').count();
  await page.mouse.up();
  await page.waitForTimeout(250);
  const movedSnapshot = await readSnapshot(page);
  const moved = movedSnapshot.tracks.find((track) => track.id === moveSetup.topTrackId);
  expect(insertVisible).toBe(1);
  expect(moved.clips.some((item) => item.id === moveSetup.clipId)).toBe(true);
  expect(movedSnapshot.tracks.flatMap((track) => track.clips)).toHaveLength(2);

  /* Zoom controls and fit. */
  const zoom = await page.evaluate(() => window.__videoEditor.timeline.pxPerSecond);
  await page.locator('[data-timeline-action="zoom-in"]').click();
  const zoomedIn = await page.evaluate(() => window.__videoEditor.timeline.pxPerSecond);
  await page.locator('[data-timeline-action="zoom-out"]').click();
  const zoomedOut = await page.evaluate(() => window.__videoEditor.timeline.pxPerSecond);
  await page.locator('[data-timeline-action="fit"]').click();
  const fitted = await page.evaluate(() => window.__videoEditor.timeline.pxPerSecond);
  expect(zoomedIn).toBeGreaterThan(zoom);
  expect(zoomedOut).toBeLessThan(zoomedIn);
  expect(fitted).toBeGreaterThan(0);
  await setInputValue(page, '[data-zoom-range]', 160);
  expect(await page.evaluate(() => window.__videoEditor.timeline.pxPerSecond)).toBeCloseTo(160, 0);

  /* Snapping toggle is real. */
  const snap = page.locator('[data-snap]');
  expect(await snap.isChecked()).toBe(true);
  await snap.uncheck();
  expect(await page.evaluate(() => window.__videoEditor.timeline.snapping)).toBe(false);
  await snap.check();

  /* Track rename, hide, lock, collapse and restore. */
  await page.locator('.ve-tl-name').first().dblclick();
  await page.fill('.ve-tl-rename', 'Top layer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.locator('[data-track-row]').first().locator('[data-track-action="hide"]').click();
  await page.locator('[data-track-row]').first().locator('[data-track-action="lock"]').click();
  await page.locator('[data-track-row]').first().locator('[data-track-action="collapse"]').click();
  snapshot = await readSnapshot(page);
  expect(snapshot.tracks[0].name).toBe('Top layer');
  expect(snapshot.tracks[0].hidden).toBe(true);
  expect(snapshot.tracks[0].locked).toBe(true);
  await page.locator('[data-track-row]').first().locator('[data-track-action="hide"]').click();
  await page.locator('[data-track-row]').first().locator('[data-track-action="lock"]').click();

  /* Add and remove tracks. */
  const beforeAdd = await readSnapshot(page);
  await page.locator('[data-timeline-action="add-video"]').click();
  await page.locator('[data-timeline-action="add-audio"]').click();
  snapshot = await readSnapshot(page);
  expect(snapshot.tracks.filter((track) => track.kind === 'video').length).toBe(
    beforeAdd.tracks.filter((track) => track.kind === 'video').length + 1
  );
  expect(snapshot.tracks.filter((track) => track.kind === 'audio').length).toBe(
    beforeAdd.tracks.filter((track) => track.kind === 'audio').length + 1
  );
  const deletedAudioId = await page
    .locator('[data-track-row][data-kind="audio"]')
    .last()
    .getAttribute('data-track-id');
  await page.locator('[data-track-row]').last().locator('[data-track-action="delete"]').click();
  await page.waitForTimeout(200);
  expect((await readSnapshot(page)).tracks.filter((track) => track.kind === 'audio').length).toBe(1);
  await expect(page.locator(`[data-track-row][data-track-id="${deletedAudioId}"]`)).toHaveCount(0);

  const remainingAudio = page.locator('[data-track-row][data-kind="audio"]').first();
  const audioId = await remainingAudio.getAttribute('data-track-id');
  await remainingAudio.locator('[data-track-volume]').evaluate((element) => {
    element.value = '0.4';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await remainingAudio.locator('[data-track-action="mute"]').click();
  snapshot = await readSnapshot(page);
  const audioTrack = snapshot.tracks.find((track) => track.id === audioId);
  expect(audioTrack.volume).toBeCloseTo(0.4, 1);
  expect(audioTrack.muted).toBe(true);

  expect(errors).toEqual([]);
});

test('layers stack, reorder and preview handles really change an image overlay', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideoClip(page);
  await importFiles(page, ['sample.png']);
  const ids = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const imageAsset = ed.media.list().find((asset) => asset.name === 'sample.png');
    const imageClip = ed.addAssetToTimeline(imageAsset.id, { start: 0.6 });
    ed.addShapeClip('circle');
    ed.addTextPreset('title');
    ed.seek(0.8);
    return { imageClipId: imageClip.id };
  });
  await page.waitForTimeout(350);

  let snapshot = await readSnapshot(page);
  const videoClip = snapshot.tracks.flatMap((track) => track.clips).find((clip) => clip.kind === 'video');
  const textClip = snapshot.tracks.flatMap((track) => track.clips).find((clip) => clip.kind === 'text');
  expect(videoClip).toBeTruthy();
  expect(textClip).toBeTruthy();

  await page.locator('#ve-tabs [data-tab="layers"]').click();
  await expect(page.locator('#ve-panel')).toContainText('Top of this list renders in front');
  const rows = page.locator('#ve-panel [data-layer-row]');
  expect(await rows.count()).toBe(4);
  expect(await rows.first().getAttribute('data-clip-id')).toBe(textClip.id);

  /* Send the text to the back, up one layer, then to the front. */
  await page.locator(`#ve-panel [data-layer-action="back"][data-clip-id="${textClip.id}"]`).click();
  await page.waitForTimeout(250);
  let order = await page
    .locator('#ve-panel [data-layer-row]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.clipId));
  expect(order[order.length - 1]).toBe(textClip.id);
  await page.locator(`#ve-panel [data-layer-action="up"][data-clip-id="${textClip.id}"]`).click();
  await page.waitForTimeout(200);
  const upOrder = await page
    .locator('#ve-panel [data-layer-row]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.clipId));
  expect(upOrder.indexOf(textClip.id)).toBe(order.indexOf(textClip.id) - 1);
  await page.locator(`#ve-panel [data-layer-action="front"][data-clip-id="${textClip.id}"]`).click();
  await page.waitForTimeout(200);
  expect(await page.locator('#ve-panel [data-layer-row]').first().getAttribute('data-clip-id')).toBe(textClip.id);

  /* Property layer buttons move the selected clip too. */
  await page.locator(`#ve-panel [data-layer-action="select"][data-clip-id="${textClip.id}"]`).click();
  await page.locator('#ve-props-body [data-prop-action="layer-down"]').click();
  await page.waitForTimeout(200);
  expect(await page.locator('#ve-panel [data-layer-row]').first().getAttribute('data-clip-id')).not.toBe(textClip.id);

  /* Hide and lock a layer, then show and unlock it. */
  await page.locator(`#ve-panel [data-layer-action="hide"][data-clip-id="${textClip.id}"]`).click();
  expect(
    (await readSnapshot(page)).tracks.flatMap((track) => track.clips).find((clip) => clip.id === textClip.id).hidden
  ).toBe(true);
  await page.locator(`#ve-panel [data-layer-action="hide"][data-clip-id="${textClip.id}"]`).click();
  await page.locator(`#ve-panel [data-layer-action="lock"][data-clip-id="${textClip.id}"]`).click();
  expect(
    (await readSnapshot(page)).tracks.flatMap((track) => track.clips).find((clip) => clip.id === textClip.id).locked
  ).toBe(true);
  await page.locator(`#ve-panel [data-layer-action="lock"][data-clip-id="${textClip.id}"]`).click();

  /* Direct manipulation of the image overlay: move, scale with the SE handle, rotate. */
  await page.evaluate((id) => {
    const ed = window.__videoEditor;
    ed.selectClip(id, { additive: false });
    ed.seek(1);
  }, ids.imageClipId);
  await page.locator('#ve-preview-shell').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const readImage = () =>
    page.evaluate((id) => {
      const clip = window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((item) => item.id === id);
      return { x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation };
    }, ids.imageClipId);

  const beforeMove = await readImage();
  const moveZone = await page.locator('.ve-select-box [data-handle="move"]').boundingBox();
  await page.mouse.move(moveZone.x + moveZone.width / 2, moveZone.y + moveZone.height / 2);
  await page.mouse.down();
  /* Move up-left so the south-east scale handle stays inside the preview. */
  await page.mouse.move(moveZone.x + moveZone.width / 2 - 48, moveZone.y + moveZone.height / 2 - 18, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterMove = await readImage();
  expect(Math.abs(afterMove.x - beforeMove.x) + Math.abs(afterMove.y - beforeMove.y)).toBeGreaterThan(0.01);

  const beforeScale = (await readImage()).scale;
  const se = await page.locator('.ve-select-box [data-handle="se"]').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 + 40, se.y + se.height / 2 + 24, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterScale = (await readImage()).scale;
  expect(afterScale).toBeGreaterThan(beforeScale + 0.02);

  const beforeRotate = (await readImage()).rotation;
  const rotate = await page.locator('.ve-select-box [data-handle="rotate"]').boundingBox();
  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotate.x + rotate.width / 2 + 36, rotate.y + rotate.height / 2 + 14, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterRotate = (await readImage()).rotation;
  expect(Math.abs(afterRotate - beforeRotate)).toBeGreaterThan(1);

  /* One undo per drag restores the rotation. */
  await blur(page);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const undone = await readImage();
  expect(Math.abs(undone.rotation - beforeRotate)).toBeLessThan(0.5);

  expect(errors).toEqual([]);
});

test('text layers support Unicode, RTL and style controls, and text reaches the export', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openEditor(page);
  const video = await addVideoClip(page, 'trim-4s.mp4');
  const baseline = await frameStats(page, 0.6);

  await page.locator('#ve-tabs [data-tab="text"]').click();
  await expect(page.locator('#ve-panel')).toContainText('Unicode shaping');
  const presets = await page.locator('#ve-panel [data-text-preset]').evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.textPreset)
  );
  expect(presets).toEqual(expect.arrayContaining(['title', 'subtitle', 'lower', 'caption', 'heading', 'quote']));
  await page.locator('#ve-panel [data-text-preset="lower"]').click();
  await page.waitForTimeout(350);

  const styled = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips).find((item) => item.kind === 'text');
    ed.selectClip(clip.id, { additive: false });
    ed.seek(clip.start + Math.min(1, clip.duration / 2));
    return clip.id;
  });
  await expect(page.locator('#ve-props-body')).toContainText('Text');
  const content =
    'مرحبا بالعالم\nनमस्ते दुनिया\n你好世界\nこんにちは\n안녕하세요\nПривет, мир';
  await page.locator('[data-prop="text.content"]').fill(content);
  await page.locator('[data-prop="text.font"]').selectOption('arabic');
  await page.locator('[data-prop="text.direction"]').selectOption('rtl');
  await page.locator('[data-prop="text.size"]').fill('56');
  await page.locator('[data-prop="text.bold"]').check();
  await page.locator('[data-prop="text.align"]').selectOption('right');
  await page.locator('[data-prop="text.color"]').evaluate((element) => {
    element.value = '#ffe066';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await setInputValue(page, '[data-prop="text.outlineWidth"]', 4);
  await setInputValue(page, '[data-prop="text.bgOpacity"]', 0.5);
  await setInputValue(page, '[data-prop="text.lineHeight"]', 1.4);
  await setInputValue(page, '[data-prop="text.letterSpacing"]', 2);
  await page.waitForTimeout(350);

  const textClip = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === id);
    return { text: clip.text, name: clip.name };
  }, styled);
  expect(textClip.text.content).toBe(content);
  expect(textClip.text.font).toBe('arabic');
  expect(textClip.text.direction).toBe('rtl');
  expect(textClip.text.bold).toBe(true);
  expect(textClip.text.outlineWidth).toBe(4);
  expect(textClip.text.color).toBe('#ffe066');
  expect(textClip.text.bgOpacity).toBeCloseTo(0.5, 1);

  const withText = await frameStats(page, 1);
  expect(withText.hash).not.toBe(baseline.hash);

  /* Hide the video: transparent text is the only thing left, and hiding the
   * text leaves a genuinely blank frame. */
  const videoTrackId = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const track = ed.project.tracks.find((item) => item.clips.some((clip) => clip.kind === 'video'));
    ed.store.apply((draft) => {
      const found = draft.tracks.find((item) => item.id === track.id);
      found.hidden = true;
    });
    return track.id;
  });
  await page.waitForTimeout(250);
  const textOnly = await frameStats(page, 1);
  expect(textOnly.lit).toBeGreaterThan(0);
  await setClipHidden(page, styled, true);
  await page.waitForTimeout(200);
  const hiddenText = await frameStats(page, 1);
  expect(hiddenText.lit).toBe(0);
  await setClipHidden(page, styled, false);
  await page.evaluate((id) => {
    window.__videoEditor.store.apply((draft) => {
      draft.tracks.find((item) => item.id === id).hidden = false;
    });
  }, videoTrackId);

  /* The same renderer runs in the export worker: compare the lower band of
   * the exported picture with the text layer shown and hidden. */
  await page.evaluate(({ textId, videoId }) => {
    const ed = window.__videoEditor;
    ed.store.apply((draft) => {
      const text = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === textId);
      text.start = 0;
      text.duration = 1.2;
      text.hidden = false;
      const video = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === videoId);
      video.start = 0;
      video.duration = 1.2;
      video.inPoint = 0;
      video.outPoint = 1.2;
    });
  }, { textId: styled, videoId: video.clipId });

  const exportedWithText = await exportAndInspect(
    page,
    { format: 'mp4', resolution: '360', quality: 'small', aspect: 'project' },
    0.4
  );
  expect(exportedWithText.size).toBeGreaterThan(1000);
  expect(exportedWithText.lit).toBeGreaterThan(5);
  expect(exportedWithText.meta.width).toBe(640);
  expect(exportedWithText.meta.height).toBe(360);
  expect(exportedWithText.playback.duration).toBeGreaterThan(1);

  await setClipHidden(page, styled, true);
  const exportedWithoutText = await exportAndInspect(
    page,
    { format: 'mp4', resolution: '360', quality: 'small', aspect: 'project' },
    0.4
  );
  expect(exportedWithoutText.size).toBeGreaterThan(1000);
  expect(exportedWithText.bandHash).not.toBe(exportedWithoutText.bandHash);

  expect(errors).toEqual([]);
});

test('all 56 transitions and all 18 filters render, and colour correction changes frames', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await openEditor(page);
  await addVideoClip(page, 'trim-4s.mp4');

  const ids = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const first = ed.project.tracks.flatMap((track) => track.clips)[0];
    const host = ed.project.tracks.find((track) => track.clips.some((clip) => clip.id === first.id));
    ed.store.apply((draft) => {
      const track = draft.tracks.find((item) => item.id === host.id);
      const source = track.clips[0];
      source.duration = 1.2;
      source.outPoint = 1.2;
      const copy = JSON.parse(JSON.stringify(source));
      copy.id = 'clip_transition_probe';
      copy.start = 1.2;
      copy.duration = 1.2;
      copy.inPoint = 1.2;
      copy.outPoint = 2.4;
      copy.transition = { type: 'none', duration: 0.5, reverse: false };
      track.clips.push(copy);
    });
    ed.selectClip('clip_transition_probe', { additive: false });
    return { count: ed.transitions().length, filterCount: ed.filters().length };
  });
  expect(ids.count).toBe(56);
  expect(ids.filterCount).toBe(18);

  const transitionResult = await page.evaluate(async () => {
    const ed = window.__videoEditor;
    const failures = [];
    const signatures = new Set();
    for (const id of ed.transitions()) {
      try {
        ed.setTransition(id);
        ed.seek(1.35);
        await ed.renderPreview();
        const canvas = ed.elements.previewCanvas;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4 * 53) {
          const value = data[i] + data[i + 1] + data[i + 2];
          if (value > 22) lit += 1;
          hash = Math.imul(hash ^ value, 16777619) >>> 0;
        }
        signatures.add(hash);
        if (lit < 2) failures.push(`${id}: blank frame`);
      } catch (error) {
        failures.push(`${id}: ${error.message || error}`);
      }
    }
    ed.setTransition('none');
    return { failures, distinct: signatures.size };
  });
  expect(transitionResult.failures).toEqual([]);
  expect(transitionResult.distinct).toBeGreaterThan(10);

  await page.locator('#ve-tabs [data-tab="transitions"]').click();
  await expect(page.locator('.ve-transition-group')).toHaveCount(6);
  expect(await page.locator('.ve-transition').count()).toBe(56);
  await page.locator('[data-transition="cross-dissolve"]').click();
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() =>
      window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === 'clip_transition_probe').transition.type
    )
  ).toBe('cross-dissolve');
  await setInputValue(page, '[data-transition-duration]', 0.8);
  const duration = await page.evaluate(() =>
    window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === 'clip_transition_probe').transition.duration
  );
  expect(duration).toBeCloseTo(0.8, 1);
  await page.locator('[data-transition-reverse]').check();
  expect(
    await page.evaluate(() =>
      window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === 'clip_transition_probe').transition.reverse
    )
  ).toBe(true);
  await page.locator('[data-transition="none"]').click();
  expect(
    await page.evaluate(() =>
      window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === 'clip_transition_probe').transition.type
    )
  ).toBe('none');

  /* Filters: each one is selectable, renders, and changes the picture. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    ed.selectClip('clip_transition_probe', { additive: false });
    ed.seek(1.8);
  });
  const baseline = await frameStats(page, 1.8);
  await page.locator('#ve-tabs [data-tab="filters"]').click();
  expect(await page.locator('#ve-panel [data-filter]').count()).toBe(18);
  const filterResult = await page.evaluate(async (baseHash) => {
    const ed = window.__videoEditor;
    const failures = [];
    let changed = 0;
    for (const id of ed.filters()) {
      try {
        ed.setFilter(id);
        await ed.renderPreview();
        const canvas = ed.elements.previewCanvas;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4 * 31) {
          const value = data[i] + data[i + 1] + data[i + 2];
          if (value > 22) lit += 1;
          hash = Math.imul(hash ^ value, 16777619) >>> 0;
        }
        if (id !== 'none' && hash !== baseHash) changed += 1;
        if (lit < 2) failures.push(`${id}: blank`);
      } catch (error) {
        failures.push(`${id}: ${error.message || error}`);
      }
    }
    ed.setFilter('none');
    return { failures, changed };
  }, baseline.hash);
  expect(filterResult.failures).toEqual([]);
  expect(filterResult.changed).toBeGreaterThanOrEqual(16);

  await page.evaluate(() => {
    const ed = window.__videoEditor;
    ed.selectClip('clip_transition_probe', { additive: false });
    ed.seek(1.8);
  });
  await page.locator('#ve-tabs [data-tab="filters"]').click();
  await page.locator('[data-filter="vintage"]').click();
  await expect(page.locator('[data-filter-intensity]')).toBeEnabled();
  await setInputValue(page, '[data-filter-intensity]', 0.4);
  expect(
    await page.evaluate(() =>
      window.__videoEditor.project.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === 'clip_transition_probe').filterIntensity
    )
  ).toBeCloseTo(0.4, 1);

  /* Colour correction and presets. */
  await page.locator('#ve-tabs [data-tab="effects"]').click();
  await page.locator('[data-color-preset="cinematic"]').click();
  await page.waitForTimeout(200);
  const color = await page.evaluate(() =>
    window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === 'clip_transition_probe').color
  );
  expect(color.contrast).not.toBe(0);
  const corrected = await frameStats(page, 1.8);
  expect(corrected.hash).not.toBe(baseline.hash);
  await page.evaluate(() => {
    window.__videoEditor.selectClip('clip_transition_probe', { additive: false });
  });
  await setInputValue(page, '#ve-props-body [data-prop="color.brightness"]', 30);
  await page.waitForTimeout(250);
  const brightened = await frameStats(page, 1.8);
  expect(brightened.hash).not.toBe(corrected.hash);
  await page.locator('#ve-props-body [data-prop-action="reset-color"]').click();

  /* Entrance and exit animations are real and use the animation length. */
  await page.locator('[data-anim="in"]').selectOption('slide-left');
  await page.locator('[data-anim="out"]').selectOption('zoom');
  await page.locator('[data-anim-duration="in"]').fill('0.6');
  const anims = await page.evaluate(() =>
    window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === 'clip_transition_probe')
  );
  expect(anims.inAnim.type).toBe('slide-left');
  expect(anims.outAnim.type).toBe('zoom');
  expect(anims.inAnim.duration).toBeCloseTo(0.6, 1);

  expect(errors).toEqual([]);
});

test('keyframes interpolate, update from the properties panel and can be cleared', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openEditor(page);
  await addVideoClip(page, 'trim-4s.mp4');
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.selectClip(clip.id, { additive: false });
    ed.seek(clip.start + 0.2);
  });
  await page.waitForTimeout(250);
  await expect(page.locator('#ve-props-body .ve-keyframes')).toBeVisible();

  await page.locator('[data-keyframe="x"]').click();
  await setInputValue(page, '[data-prop="x"]', 0.2);
  await page.locator('[data-keyframe="opacity"]').click();
  await setInputValue(page, '[data-prop="opacity"]', 0.3);
  await page.waitForTimeout(250);
  let keys = await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0];
    return clip.keyframes;
  });
  expect(keys.x.length).toBeGreaterThanOrEqual(1);
  expect(keys.x[0].v).toBeCloseTo(0.2, 2);
  expect(keys.opacity[0].v).toBeCloseTo(0.3, 2);

  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.seek(clip.start + 1.4);
  });
  await page.waitForTimeout(250);
  await page.locator('[data-keyframe="x"]').click();
  await setInputValue(page, '[data-prop="x"]', 0.8);
  await page.locator('[data-keyframe="opacity"]').click();
  await setInputValue(page, '[data-prop="opacity"]', 1);
  await page.waitForTimeout(250);

  keys = await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0];
    return clip.keyframes;
  });
  expect(keys.x.length).toBe(2);
  expect(keys.opacity.length).toBe(2);
  expect(keys.x[1].v).toBeCloseTo(0.8, 2);

  /* resolveTransform is the exact function the preview and exporter call. */
  const interpolation = await page.evaluate(async (clipId) => {
    const { resolveTransform } = await import('/js/video-editor/renderer.js');
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
    const linear = resolveTransform(clip, 0.8).x;
    const eased = resolveTransform(
      {
        ...clip,
        keyframes: {
          ...clip.keyframes,
          x: [
            { t: 0, v: 0, ease: 'linear' },
            { t: 2, v: 1, ease: 'easeInOut' }
          ]
        }
      },
      0.5
    ).x;
    return { linear, eased };
  }, await page.evaluate(() => window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0].id));
  expect(interpolation.linear).toBeGreaterThan(0.2);
  expect(interpolation.linear).toBeLessThan(0.8);
  expect(interpolation.eased).toBeLessThan(0.2);

  /* Easing selection is real, then clear all keyframes. */
  await page.locator('[data-key-ease]').selectOption('easeInOut');
  expect(await page.evaluate(() => window.__videoEditor.state.keyEase)).toBe('easeInOut');
  await page.locator('#ve-props-body [data-prop-action="clear-keys"]').click();
  const cleared = await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0];
    return Object.values(clip.keyframes).reduce((sum, list) => sum + list.length, 0);
  });
  expect(cleared).toBe(0);

  expect(errors).toEqual([]);
});

test('audio clips mix, split, fade and export with sound', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await openEditor(page);
  await importFiles(page, ['trim-audio-only.m4a', 'trim-4s.mp4']);

  const setup = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const audioAsset = ed.media.list().find((asset) => asset.type === 'audio');
    const videoAsset = ed.media.list().find((asset) => asset.type === 'video');
    const videoClip = ed.addAssetToTimeline(videoAsset.id, { start: 0 });
    const audioClip = ed.addAssetToTimeline(audioAsset.id, { start: 0 });
    ed.selectClip(audioClip.id, { additive: false });
    ed.seek(0.4);
    return { audioClipId: audioClip.id, videoClipId: videoClip.id, audioTrack: audioClip.trackId };
  });
  expect(setup.audioClipId).toBeTruthy();

  await page.locator('#ve-tabs [data-tab="audio"]').click();
  await expect(page.locator('#ve-panel')).toContainText('Master volume');
  await setInputValue(page, '[data-master-volume]', 0.7);
  expect(await page.evaluate(() => window.__videoEditor.project.masterVolume)).toBeCloseTo(0.7, 1);

  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips).find((item) => item.kind === 'audio');
    ed.selectClip(clip.id, { additive: false });
  });
  await expect(page.locator('#ve-props-body')).toContainText('Audio mix');
  await setInputValue(page, '[data-prop="volume"]', 0.6);
  await page.locator('[data-prop="muted"]').check();
  await setInputValue(page, '[data-prop="fadeIn"]', 0.5);
  await setInputValue(page, '[data-prop="fadeOut"]', 0.4);
  await page.waitForTimeout(200);
  let audio = await page.evaluate(() =>
    window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((clip) => clip.kind === 'audio')
  );
  expect(audio.volume).toBeCloseTo(0.6, 1);
  expect(audio.muted).toBe(true);
  expect(audio.fadeIn).toBeCloseTo(0.5, 1);
  expect(audio.fadeOut).toBeCloseTo(0.4, 1);
  await page.locator('[data-prop="muted"]').uncheck();

  /* Split, then duplicate the audio clip through real actions. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips).find((item) => item.kind === 'audio');
    ed.selectClip(clip.id, { additive: false });
    ed.seek(clip.start + clip.duration / 2);
  });
  await page.locator('#ve-timeline [data-timeline-action="split"]').click();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () => window.__videoEditor.project.tracks.flatMap((track) => track.clips).filter((clip) => clip.kind === 'audio').length
    )
  ).toBe(2);
  await page.locator('#ve-props-body [data-prop-action="duplicate"]').click();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () => window.__videoEditor.project.tracks.flatMap((track) => track.clips).filter((clip) => clip.kind === 'audio').length
    )
  ).toBeGreaterThanOrEqual(3);

  /* Mute and volume in the Audio tab also drive the project. */
  await page.locator('#ve-tabs [data-tab="audio"]').click();
  const mixButton = page.locator('#ve-panel [data-mix-action="mute"]').first();
  await mixButton.click();
  expect(
    await page.evaluate(() => window.__videoEditor.project.tracks.find((track) => track.kind === 'audio').muted)
  ).toBe(true);
  await mixButton.click();
  await setInputValue(page, '#ve-panel [data-track-volume]', 0.5);
  expect(
    await page.evaluate(() => window.__videoEditor.project.tracks.find((track) => track.kind === 'audio').volume)
  ).toBeCloseTo(0.5, 1);

  /* Rebuild a short, clean stereo mix and export it. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const audioAsset = ed.media.list().find((asset) => asset.type === 'audio');
    const videoAsset = ed.media.list().find((asset) => asset.type === 'video');
    ed.store.apply((draft) => {
      for (const track of draft.tracks) track.clips = [];
    });
    ed.addAssetToTimeline(videoAsset.id, { start: 0 });
    ed.addAssetToTimeline(audioAsset.id, { start: 0 });
    ed.store.apply((draft) => {
      for (const track of draft.tracks) {
        for (const clip of track.clips) {
          clip.inPoint = 0;
          clip.duration = Math.min(clip.duration, 1.2);
          clip.outPoint = clip.inPoint + clip.duration;
        }
      }
      draft.masterVolume = 0.7;
    });
  });
  const exported = await exportAndInspect(
    page,
    { format: 'webm', resolution: '360', quality: 'small', aspect: 'project' },
    0.3
  );
  expect(exported.meta.hasAudio).toBe(true);
  expect(exported.meta.audioChannels).toBe(2);
  expect(exported.meta.audioSampleRate).toBe(48000);
  expect(exported.meta.audioCodec).toBe('opus');
  expect(exported.size).toBeGreaterThan(1000);
  expect(exported.lit).toBeGreaterThan(5);

  expect(errors).toEqual([]);
});

test('subtitles can be added, imported, styled, downloaded and burned in', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await openEditor(page);
  await addVideoClip(page, 'trim-short.mp4');
  await seek(page, 0.2);
  await page.locator('#ve-tabs [data-tab="subtitles"]').click();
  await page.locator('[data-sub-action="add"]').click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__videoEditor.project.subtitles.items.length)).toBe(1);

  const itemId = await page.evaluate(() => window.__videoEditor.project.subtitles.items[0].id);
  await page.locator(`[data-sub-field="text"][data-sub-id="${itemId}"]`).fill('First line\nSecond line');
  await page.locator(`[data-sub-field="start"][data-sub-id="${itemId}"]`).fill('0.1');
  await page.locator(`[data-sub-field="end"][data-sub-id="${itemId}"]`).fill('2.5');
  /* The style block is a disclosure; open it only when it is collapsed. */
  const styleDetails = page.locator('#ve-panel details', { hasText: 'Subtitle style' });
  if (!(await styleDetails.evaluate((details) => details.open))) {
    await styleDetails.locator('summary').click();
  }
  await page.locator('[data-sub-style="font"]').selectOption('cjk');
  await page.locator('[data-sub-style="size"]').fill('48');
  await setInputValue(page, '[data-sub-style="position"]', 0.8);
  await setInputValue(page, '[data-sub-style="bgOpacity"]', 0.4);
  await page.locator('[data-sub-style="bold"]').check();
  await page.waitForTimeout(250);

  const subtitle = await page.evaluate(() => window.__videoEditor.project.subtitles);
  expect(subtitle.items[0].text).toBe('First line\nSecond line');
  expect(subtitle.items[0].start).toBeCloseTo(0.1, 1);
  expect(subtitle.items[0].end).toBeCloseTo(2.5, 1);
  expect(subtitle.style.font).toBe('cjk');
  expect(subtitle.style.size).toBe(48);
  expect(subtitle.style.bold).toBe(true);
  expect(subtitle.style.position).toBeCloseTo(0.8, 2);

  /* The cue is actually drawn over the picture. */
  await seek(page, 1);
  expect(await page.evaluate(() => window.__videoEditor.project.subtitles.enabled)).toBe(true);
  const withCue = await frameStats(page, 1);
  await page.locator('[data-sub-enabled]').uncheck();
  const withoutCue = await frameStats(page, 1);
  expect(withCue.hash).not.toBe(withoutCue.hash);
  await page.locator('[data-sub-enabled]').check();

  /* Import SRT and WebVTT files. */
  const srt =
    '1\n00:00:00,500 --> 00:00:02,000\nImported cue one\n\n2\n00:00:02,100 --> 00:00:03,400\nSecond imported cue\n';
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nWebVTT cue\n';
  const srtPath = path.join(os.tmpdir(), 've-import.srt');
  const vttPath = path.join(os.tmpdir(), 've-import.vtt');
  fs.writeFileSync(srtPath, srt, 'utf8');
  fs.writeFileSync(vttPath, vtt, 'utf8');
  const beforeImport = await page.evaluate(() => window.__videoEditor.project.subtitles.items.length);
  await page.setInputFiles('#ve-subtitle-input', srtPath);
  await page.waitForFunction(
    (n) => window.__videoEditor.project.subtitles.items.length >= n,
    beforeImport + 2,
    { timeout: 20000 }
  );
  await page.setInputFiles('#ve-subtitle-input', vttPath);
  await page.waitForFunction(
    (n) => window.__videoEditor.project.subtitles.items.length >= n,
    beforeImport + 3,
    { timeout: 20000 }
  );
  const imported = await page.evaluate(() =>
    window.__videoEditor.project.subtitles.items.map((item) => item.text)
  );
  expect(imported).toEqual(
    expect.arrayContaining(['Imported cue one', 'Second imported cue', 'WebVTT cue'])
  );

  /* Download SRT and verify its content. */
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-sub-action="export-srt"]').click();
  const download = await downloadPromise;
  const downloadPath = path.join(os.tmpdir(), `ve-subs-${Date.now()}.srt`);
  await download.saveAs(downloadPath);
  const saved = fs.readFileSync(downloadPath, 'utf8');
  expect(saved).toContain('Imported cue one');
  expect(saved).toContain('-->');

  /* Burn into export: the decoded lower band differs when subtitles are off. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips).find((item) => item.kind === 'video');
    ed.store.apply((draft) => {
      const found = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id);
      found.start = 0;
      found.duration = 1.5;
      found.inPoint = 0;
      found.outPoint = 1.5;
      draft.subtitles.items = [{ id: 'sub_export', start: 0, end: 1.5, text: 'EXPORTED SUBTITLE' }];
      draft.subtitles.enabled = true;
    });
  });
  const burned = await exportAndInspect(
    page,
    { format: 'mp4', resolution: '360', quality: 'small', aspect: 'project' },
    0.6
  );
  expect(burned.size).toBeGreaterThan(1000);
  expect(burned.lit).toBeGreaterThan(5);

  await page.evaluate(() => {
    window.__videoEditor.store.apply((draft) => {
      draft.subtitles.enabled = false;
    });
  });
  const notBurned = await exportAndInspect(
    page,
    { format: 'mp4', resolution: '360', quality: 'small', aspect: 'project' },
    0.6
  );
  expect(notBurned.lit).toBeGreaterThan(5);
  expect(burned.bandHash).not.toBe(notBurned.bandHash);

  expect(errors).toEqual([]);
});

test('project settings, save/open round trip, autosave restore and clear', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openEditor(page);
  await addVideoClip(page, 'trim-short.mp4');
  await page.locator('#ve-project').click();
  await expect(page.locator('#ve-project-dialog')).toHaveAttribute('open', '');
  await page.fill('#ve-pd-name', 'Layered demo');
  await page.selectOption('#ve-pd-aspect', '9:16');
  await page.selectOption('#ve-pd-resolution', '720');
  await page.selectOption('#ve-pd-fps', '24');
  await page.locator('#ve-pd-apply').click();
  await page.waitForTimeout(300);
  let project = await readSnapshot(page);
  expect(project.name).toBe('Layered demo');
  expect(project.aspect).toBe('9:16');
  expect(project.resolution).toBe('720');
  expect(project.fps).toBe(24);
  await expect(page.locator('#ve-project-name')).toHaveValue('Layered demo');
  await expect(page.locator('#ve-project-meta')).toContainText('9:16');

  /* Download the project JSON and verify its structure. */
  const projectDownload = page.waitForEvent('download');
  await page.locator('#ve-save').click();
  const savedProject = await projectDownload;
  expect(savedProject.suggestedFilename()).toMatch(/\.letitedit\.json$/);
  const jsonPath = path.join(os.tmpdir(), `ve-project-${Date.now()}.json`);
  await savedProject.saveAs(jsonPath);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  expect(data.kind).toBe('letitedit.video-editor');
  expect(data.schema).toBeGreaterThanOrEqual(2);
  expect(data.project.name).toBe('Layered demo');
  expect(data.project.tracks.length).toBeGreaterThan(0);
  expect(Array.isArray(data.media)).toBe(true);
  expect(data.media[0].name).toBe('trim-short.mp4');

  /* Wait for autosave, reload, restore from the banner. */
  await page.waitForFunction(
    () => Boolean(localStorage.getItem('letitedit.video-editor.autosave.v1')),
    null,
    { timeout: 15000 }
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__videoEditor));
  await expect(page.locator('#ve-restore-banner')).toBeVisible();
  await expect(page.locator('#ve-restore-text')).toContainText('Layered demo');
  await page.locator('#ve-restore-button').click();
  await page.waitForTimeout(500);
  project = await readSnapshot(page);
  expect(project.name).toBe('Layered demo');
  expect(project.tracks.flatMap((track) => track.clips).length).toBe(1);
  expect(await page.evaluate(() => window.__videoEditor.media.list().length)).toBe(0);
  await expect(page.locator('#ve-relink-banner')).toBeVisible();
  await expect(page.locator('#ve-relink-text')).toContainText('trim-short.mp4');

  /* Re-import the file and clips relink by name. */
  await page.setInputFiles('#ve-media-input', fixturePath('trim-short.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length === 1, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__videoEditor.state.pendingRelink.length)).toBe(0);
  await expect(page.locator('#ve-relink-banner')).toBeHidden();
  const relinked = await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0];
    return { mediaId: clip.mediaId, libraryId: window.__videoEditor.media.list()[0].id };
  });
  expect(relinked.mediaId).toBe(relinked.libraryId);

  /* Clear the timeline with confirmation; media stays. */
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#ve-project').click();
  await page.locator('#ve-pd-clear').click();
  await page.waitForTimeout(300);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips)).toHaveLength(0);
  expect(await page.evaluate(() => window.__videoEditor.media.list().length)).toBe(1);
  await page.keyboard.press('Escape');

  /* New project clears media and the timeline. */
  await page.locator('#ve-new').click();
  await page.waitForTimeout(300);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips)).toHaveLength(0);
  expect(await page.evaluate(() => window.__videoEditor.media.list().length)).toBe(0);

  expect(errors).toEqual([]);
});

test('export dialog produces measured files, honours dimensions and cancels cleanly', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await openEditor(page);
  await addVideoClip(page, 'trim-4s.mp4');
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.store.apply((draft) => {
      const found = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id);
      found.duration = 1.5;
      found.outPoint = 1.5;
    });
    ed.setExportSetting('resolution', '360');
    ed.setExportSetting('quality', 'small');
    ed.setExportSetting('format', 'mp4');
  });
  await page.locator('#ve-export-open').click();
  await expect(page.locator('#ve-export-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#ve-export-summary')).toContainText('640 × 360');
  await expect(page.locator('#ve-export-note')).toContainText('encoded locally');

  const dimensions = await page.evaluate(() => {
    const ed = window.__videoEditor;
    ed.setExportSetting('resolution', '480');
    ed.setExportSetting('aspect', '9:16');
    const portrait = ed.getExportDimensions();
    ed.setExportSetting('aspect', '1:1');
    const square = ed.getExportDimensions();
    ed.setExportSetting('aspect', 'custom');
    ed.setExportSetting('customAspectW', 4);
    ed.setExportSetting('customAspectH', 5);
    const custom = ed.getExportDimensions();
    ed.setExportSetting('resolution', 'custom');
    ed.setExportSetting('customWidth', 320);
    ed.setExportSetting('customHeight', 240);
    const customSize = ed.getExportDimensions();
    ed.setExportSetting('resolution', '360');
    ed.setExportSetting('aspect', 'project');
    return { portrait, square, custom, customSize };
  });
  expect(dimensions.portrait.width).toBe(480);
  expect(dimensions.portrait.height).toBe(854);
  expect(dimensions.portrait.height / dimensions.portrait.width).toBeCloseTo(16 / 9, 1);
  expect(dimensions.square.width).toBe(dimensions.square.height);
  expect(dimensions.custom.width / dimensions.custom.height).toBeCloseTo(4 / 5, 1);
  expect(dimensions.customSize).toEqual({ width: 320, height: 240 });

  /* Run the real dialog export and verify progress plus the measured result. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    ed.setExportSetting('resolution', '360');
    ed.setExportSetting('aspect', 'project');
    ed.setExportSetting('format', 'mp4');
    ed.setExportSetting('quality', 'small');
  });
  await page.locator('#ve-export-start').click();
  await expect(page.locator('#ve-export-progress')).toBeVisible();
  await expect(page.locator('#ve-export-result')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#ve-export-error')).toBeHidden();
  const metaText = await page.locator('#ve-export-meta').innerText();
  expect(metaText).toContain('640 × 360');
  expect(metaText).toMatch(/MP4/i);
  expect(metaText).toMatch(/avc/i);
  expect(metaText).toContain('measured');
  await expect(page.locator('#ve-export-video')).toBeVisible();
  const videoMeta = await page.evaluate(async () => {
    const video = document.querySelector('#ve-export-video');
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });
    }
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  });
  expect(videoMeta.width).toBe(640);
  expect(videoMeta.height).toBe(360);
  expect(videoMeta.duration).toBeGreaterThan(1.2);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#ve-export-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  const exportPath = path.join(os.tmpdir(), `ve-export-${Date.now()}.mp4`);
  await download.saveAs(exportPath);
  expect(fs.statSync(exportPath).size).toBeGreaterThan(1000);

  /* WebM through the dialog. */
  await page.locator('#ve-export-again').click();
  await page.selectOption('#ve-export-format', 'webm');
  await page.locator('#ve-export-start').click();
  await expect(page.locator('#ve-export-result')).toBeVisible({ timeout: 120000 });
  const webmText = await page.locator('#ve-export-meta').innerText();
  expect(webmText).toMatch(/WEBM/i);
  expect(webmText).toMatch(/vp9/i);
  expect(webmText).toMatch(/opus/i);
  await page.locator('#ve-export-close').click();

  /* Cancel a longer 720p export after progress has genuinely advanced. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.store.apply((draft) => {
      const found = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id);
      found.start = 0;
      found.duration = 6;
      found.inPoint = 0;
      found.outPoint = 6;
    });
    ed.setExportSetting('format', 'mp4');
    ed.setExportSetting('resolution', '720');
    ed.setExportSetting('quality', 'high');
    ed.openExportDialog();
  });
  await page.locator('#ve-export-start').click();
  await page.waitForFunction(
    () => {
      const percent = document.querySelector('#ve-export-percent');
      return percent && Number(percent.textContent.replace('%', '')) > 2;
    },
    null,
    { timeout: 30000 }
  );
  const stageText = await page.locator('#ve-export-stage').innerText();
  expect(stageText.length).toBeGreaterThan(3);
  await page.locator('#ve-export-cancel').click();
  await expect(page.locator('#ve-export-error')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#ve-export-error')).toContainText('Export cancelled');
  await expect(page.locator('#ve-export-result')).toBeHidden();
  await expect(page.locator('#ve-export-start')).toBeEnabled();
  await expect(page.locator('#ve-export-cancel')).toBeDisabled();

  expect(errors).toEqual([]);
});

test('mobile layout stays inside the viewport and editing works with touch', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await openEditor(page);

  /* Check the initial mobile state before any media exists. */
  await page.setViewportSize({ width: 320, height: 860 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__videoEditor));
  expect(await page.locator('#ve-app').getAttribute('data-mobile-panel')).toBe('none');
  await expect(page.locator('#ve-preview-canvas')).toBeVisible();
  expect((await page.locator('#ve-preview-canvas').boundingBox()).width).toBeGreaterThan(140);

  const video = await addVideoClip(page, 'trim-4s.mp4');
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    ed.addTextPreset('title');
    ed.addTextPreset('subtitle');
    ed.seek(0.8);
  });
  await page.waitForTimeout(350);

  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    await page.waitForTimeout(350);
    const layout = await page.evaluate(() => {
      const preview = document.querySelector('#ve-preview-canvas').getBoundingClientRect();
      const app = document.querySelector('#ve-app').getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        preview: { width: preview.width, height: preview.height, top: preview.top },
        appWidth: app.width,
        overflow: [...document.querySelectorAll('body *')].filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.right > window.innerWidth + 1.5 &&
            !element.closest('.ve-scroll, .ve-tl-scroll, .ve-tabs, .ve-props')
          );
        }).length
      };
    });
    expect(layout.innerWidth).toBe(width);
    expect(layout.documentWidth).toBeLessThanOrEqual(width);
    expect(layout.overflow).toBe(0);
    expect(layout.preview.width).toBeGreaterThan(140);
  }

  /* Bottom sheets open, select a tab and close. */
  await page.locator('#ve-mobile-bar [data-mobile-panel="tools"]').click();
  await page.waitForTimeout(300);
  expect(await page.locator('#ve-app').getAttribute('data-mobile-panel')).toBe('tools');
  await expect(page.locator('#ve-tabs [data-tab="media"]')).toBeVisible();
  await page.locator('#ve-tabs [data-tab="layers"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('#ve-panel')).toContainText('Top of this list renders in front');
  await page.locator('.ve-side-left [data-mobile-close]').click();
  expect(await page.locator('#ve-app').getAttribute('data-mobile-panel')).toBe('none');

  /* Properties sheet. */
  await page.locator('#ve-mobile-bar [data-mobile-panel="properties"]').click();
  await page.waitForTimeout(250);
  expect(await page.locator('#ve-app').getAttribute('data-mobile-panel')).toBe('properties');
  await expect(page.locator('#ve-props-body')).toContainText('Timing');
  await page.locator('.ve-side-right [data-mobile-close]').click();

  /* Touch-style pointer trim on the timeline. */
  await page.locator(`.ve-clip[data-clip-id="${video.clipId}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const before = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === id);
    return { duration: clip.duration };
  }, video.clipId);
  const trim = await page.locator(`.ve-clip[data-clip-id="${video.clipId}"] .ve-trim-end`).boundingBox();
  await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2);
  await page.mouse.down();
  await page.mouse.move(trim.x + trim.width / 2 - 50, trim.y + trim.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .find((item) => item.id === id);
    return { duration: clip.duration };
  }, video.clipId);
  expect(after.duration).toBeLessThan(before.duration - 0.2);

  /* Layer reorder works in the mobile Layers panel. Move the subtitle clear of
   * the other text layer so the neighbouring layer has room for it. */
  await page.locator('#ve-mobile-bar [data-mobile-panel="tools"]').click();
  await page.locator('#ve-tabs [data-tab="layers"]').click();
  await page.waitForTimeout(250);
  const subtitleId = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const subtitle = ed.project.tracks
      .flatMap((track) => track.clips)
      .filter((item) => item.kind === 'text')
      .slice(-1)[0];
    ed.store.apply((draft) => {
      const found = draft.tracks.flatMap((track) => track.clips).find((item) => item.id === subtitle.id);
      found.start = 7;
    });
    return subtitle.id;
  });
  await page.waitForTimeout(250);
  const orderBefore = await page
    .locator('[data-layer-row]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.clipId));
  await page.locator(`[data-layer-action="down"][data-clip-id="${subtitleId}"]`).click();
  await page.waitForTimeout(250);
  const orderAfter = await page
    .locator('[data-layer-row]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.clipId));
  expect(orderAfter.indexOf(subtitleId)).toBeGreaterThan(orderBefore.indexOf(subtitleId));
  expect(await page.locator('[data-layer-row]').count()).toBeGreaterThanOrEqual(3);

  expect(errors).toEqual([]);
});

test('keyboard shortcuts, frame stepping and non-drag controls are accessible', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideoClip(page, 'trim-4s.mp4');

  /* Frame stepping uses the project frame rate. */
  await seek(page, 1);
  const frameBefore = await page.evaluate(() => window.__videoEditor.state.playhead);
  await page.locator('#ve-next-frame').click();
  const frameAfter = await page.evaluate(() => window.__videoEditor.state.playhead);
  expect(frameAfter - frameBefore).toBeCloseTo(1 / 30, 2);
  await page.locator('#ve-prev-frame').click();
  expect(await page.evaluate(() => window.__videoEditor.state.playhead)).toBeCloseTo(frameBefore, 2);

  /* Play toggles real playback. */
  await page.locator('#ve-play').click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__videoEditor.state.playing)).toBe(true);
  await page.locator('#ve-play').click();
  expect(await page.evaluate(() => window.__videoEditor.state.playing)).toBe(false);

  /* Focused clip moves with arrows, layers with up/down, splits with S. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips)[0];
    ed.selectClip(clip.id, { additive: false });
    ed.seek(clip.start + clip.duration / 2);
    document.querySelector(`[data-clip-id="${clip.id}"]`).focus();
  });
  const startBefore = (await readSnapshot(page)).tracks.flatMap((track) => track.clips)[0].start;
  await page.keyboard.press('ArrowRight');
  const startAfter = (await readSnapshot(page)).tracks.flatMap((track) => track.clips)[0].start;
  expect(startAfter).toBeGreaterThan(startBefore);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  const trackCounts = (await readSnapshot(page)).tracks.map((track) => track.clips.length);
  expect(trackCounts.reduce((sum, count) => sum + count, 0)).toBe(1);

  await page.keyboard.press('s');
  await page.waitForTimeout(200);
  expect((await readSnapshot(page)).tracks.flatMap((track) => track.clips).length).toBe(2);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  /* Enter selects, Shift+Enter adds to a cleared selection. */
  await page.evaluate(() => {
    const ed = window.__videoEditor;
    const clips = ed.project.tracks.flatMap((track) => track.clips);
    ed.selectNone();
    document.querySelector(`[data-clip-id="${clips[0].id}"]`).focus();
  });
  await page.keyboard.press('Shift+Enter');
  expect(await page.evaluate(() => window.__videoEditor.state.selection.size)).toBe(1);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__videoEditor.state.selection.size)).toBe(1);

  /* Trim handles are keyboard reachable separators. */
  const trimRoles = await page
    .locator('.ve-trim')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('role')));
  expect(trimRoles.every((role) => role === 'separator')).toBe(true);
  expect(await page.locator('.ve-trim').first().getAttribute('tabindex')).toBe('0');

  /* Help dialog documents the shortcuts and closes with Escape. */
  await page.locator('#ve-help').click();
  await expect(page.locator('#ve-help-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#ve-help-dialog')).toContainText('Ctrl');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ve-help-dialog')).not.toHaveAttribute('open', '');

  expect(errors).toEqual([]);
});
