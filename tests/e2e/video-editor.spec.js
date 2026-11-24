'use strict';

/* End-to-end suite for the rebuilt LetitEdit video editor (V3).
 *
 * The tests drive the real workspace in Chromium: import legal fixtures,
 * edit the timeline, exercise the inspector, restore an autosave, relink
 * missing media, verify mobile layouts at every required width and read
 * exported files back through a <video> element.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-editor/';
const MOBILE_WIDTHS = [320, 360, 375, 390, 430];

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
  await page.waitForFunction(() => window.__videoEditorReady === true, null, { timeout: 30000 });
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

async function projectState(page) {
  return page.evaluate(() => {
    const ed = window.__videoEditor;
    return {
      name: ed.project.name,
      aspect: ed.project.aspect,
      resolution: ed.project.resolution,
      fps: ed.project.fps,
      guides: ed.project.guides,
      subtitles: ed.project.subtitles.items.length,
      tracks: ed.project.tracks.map((track) => ({
        id: track.id,
        kind: track.kind,
        category: track.category,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          kind: clip.kind,
          name: clip.name,
          start: clip.start,
          duration: clip.duration,
          mediaId: clip.mediaId || null,
          volume: clip.volume,
          muted: clip.muted,
          transition: clip.transition?.type || 'none',
          keyframes: Object.fromEntries(
            Object.entries(clip.keyframes || {}).map(([key, list]) => [key, (list || []).length])
          )
        }))
      })),
      selection: [...ed.store.selection],
      playhead: ed.store.playhead
    };
  });
}

async function previewStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#ve-preview-canvas');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    let sum = 0;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4 * 31) {
      const value = data[i] + data[i + 1] + data[i + 2];
      if (value > 24) lit += 1;
      sum += value;
      hash = Math.imul(hash ^ value, 16777619) >>> 0;
    }
    return { lit, sum, hash, width: canvas.width, height: canvas.height };
  });
}

async function addVideo(page, name = 'trim-4s.mp4') {
  await importFiles(page, [name]);
  return page.evaluate((filename) => {
    const ed = window.__videoEditor;
    const asset = ed.media.list().find((item) => item.name === filename);
    const inserted = ed.addAssetToTimeline(asset.id, { start: 0 });
    ed.seek(Math.min(0.6, inserted.clip.duration / 2));
    return { clipId: inserted.clip.id, assetId: asset.id, duration: inserted.clip.duration };
  }, name);
}

async function openInspectorSection(page, title) {
  const handle = await page.evaluateHandle((name) => {
    const sections = [...document.querySelectorAll('#ve-inspector-panel details')];
    return sections.find((section) => section.querySelector('summary')?.textContent.trim().startsWith(name)) || null;
  }, title);
  const element = handle.asElement();
  if (!element) return false;
  await element.evaluate((section) => {
    section.open = true;
    section.scrollIntoView({ block: 'center' });
  });
  return true;
}

async function scrollInspectorTo(page, selector) {
  await page.locator(selector).evaluate((element) => element.scrollIntoView({ block: 'center' }));
}

/* ------------------------------------------------------------------------- */

test('workspace, nine categories and accessibility baseline', async ({ page }) => {
  const errors = await openEditor(page);

  await expect(page).toHaveTitle(/Professional Video Editor/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /multi-track timeline/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/video-editor/'
  );
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Professional Video Editor');
  expect(await page.locator('h2').count()).toBeGreaterThanOrEqual(6);
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

  const initial = await projectState(page);
  expect(initial.aspect).toBe('16:9');
  expect(initial.guides).toEqual({ center: false, safe: false });
  expect(initial.tracks.map((track) => track.category)).toEqual(['text', 'video', 'audio']);
  expect(initial.tracks.every((track) => track.clips.length === 0)).toBe(true);
  expect(initial.subtitles).toBe(0);
  await expect(page.locator('#ve-preview-empty')).toBeVisible();

  const categories = ['media', 'canvas', 'text', 'audio', 'videos', 'images', 'elements', 'subtitles', 'record'];
  const railIds = await page.locator('#ve-rail [data-category]').evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.category)
  );
  expect(railIds).toEqual(categories);

  for (const category of categories) {
    await page.click(`#ve-rail [data-category="${category}"]`);
    await expect(page.locator('#ve-library-panel h2')).not.toHaveText('');
    const heading = (await page.locator('#ve-library-panel h2').textContent())?.trim();
    expect(heading?.length || 0).toBeGreaterThan(2);
  }
  await page.click('#ve-rail [data-category="media"]');

  await page.locator('#ve-project-name').fill('Launch cut');
  await page.locator('#ve-project-name').press('Enter');
  await expect.poll(async () => (await projectState(page)).name).toBe('Launch cut');

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
      } catch {
        return [];
      }
    });
    return rules.some((rule) => rule.conditionText && rule.conditionText.includes('prefers-reduced-motion'));
  });
  expect(reducedMotion).toBe(true);
  expect(errors).toEqual([]);
});

test('media library imports, filters, renames and removes files', async ({ page }) => {
  const errors = await openEditor(page);
  await importFiles(page, ['trim-4s.mp4', 'sample.png', 'trim-audio-only.m4a']);

  const assets = await page.evaluate(() =>
    window.__videoEditor.media.list().map((asset) => ({
      id: asset.id,
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
  expect(audio.type).toBe('audio');
  expect(audio.duration).toBeGreaterThan(0.5);

  await expect(page.locator('.ve-asset-card')).toHaveCount(3);
  await expect(page.locator('.ve-asset-card', { hasText: 'trim-4s.mp4' })).toContainText('Video');

  await page.locator('[data-media-search]').fill('trim');
  await expect(page.locator('.ve-asset-card')).toHaveCount(2);
  await page.locator('[data-media-search]').fill('audio-only');
  await expect(page.locator('.ve-asset-card')).toHaveCount(1);
  await page.locator('[data-media-search]').fill('');

  await page.click('[data-media-filter="image"]');
  await expect(page.locator('.ve-asset-card')).toHaveCount(1);
  await page.click('[data-media-filter="all"]');

  await page.locator(`.ve-asset-card[data-asset-id="${video.id}"] [data-panel-action="add-asset"]`).click();
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(1);
  await expect(page.locator(`.ve-asset-card[data-asset-id="${video.id}"]`)).toContainText('1 in timeline');

  await page.click('[data-media-usage="used"]');
  await expect(page.locator('.ve-asset-card')).toHaveCount(1);
  await page.click('[data-media-usage="unused"]');
  await expect(page.locator('.ve-asset-card')).toHaveCount(2);
  await page.click('[data-media-usage="all"]');

  page.once('dialog', (dialog) => dialog.accept('hero-shot.mp4'));
  await page.click(`.ve-asset-card[data-asset-id="${video.id}"] [data-panel-action="asset-menu"]`);
  await page.locator('.ve-popover [role="menuitem"]', { hasText: 'Rename' }).click();
  await expect(page.locator(`.ve-asset-card[data-asset-id="${video.id}"]`)).toContainText('hero-shot.mp4');
  const renamedClip = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.mediaId === id);
    return clip?.name;
  }, video.id);
  expect(renamedClip).toBe('hero-shot.mp4');

  await page.click(`.ve-asset-card[data-asset-id="${image.id}"] [data-panel-action="asset-menu"]`);
  await page.locator('.ve-popover [role="menuitem"]', { hasText: 'Remove from media' }).click();
  await expect(page.locator('#ve-confirm-dialog')).toBeVisible();
  await page.click('#ve-confirm-dialog [data-confirm-ok]');
  await expect(page.locator('.ve-asset-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('preview renders, plays, pauses and steps frames', async ({ page }) => {
  const errors = await openEditor(page);
  const { clipId } = await addVideo(page);
  await page.waitForTimeout(500);

  const stats = await previewStats(page);
  expect(stats.width / stats.height).toBeCloseTo(16 / 9, 1);
  expect(stats.width).toBeGreaterThanOrEqual(640);
  expect(stats.lit).toBeGreaterThan(50);

  await page.click('#ve-play');
  await expect(page.locator('#ve-play')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(700);
  const playing = (await projectState(page)).playhead;
  expect(playing).toBeGreaterThan(0.3);
  await page.click('#ve-play');
  await expect(page.locator('#ve-play')).toHaveAttribute('aria-pressed', 'false');
  const paused = (await projectState(page)).playhead;
  await page.waitForTimeout(300);
  expect(Math.abs((await projectState(page)).playhead - paused)).toBeLessThan(0.02);

  const before = (await projectState(page)).playhead;
  await page.click('#ve-next-frame');
  const next = (await projectState(page)).playhead;
  expect(next - before).toBeCloseTo(1 / 30, 1);
  await page.click('#ve-prev-frame');
  expect((await projectState(page)).playhead).toBeCloseTo(before, 1);

  await page.locator('#ve-scrub').evaluate((element) => {
    element.value = '2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await projectState(page)).playhead).toBeGreaterThan(1.9);

  const selected = (await projectState(page)).selection;
  expect(selected).toContain(clipId);
  expect(errors).toEqual([]);
});

test('timeline drag, trim, split and undo/redo', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideo(page);
  await page.waitForTimeout(300);

  const clip = page.locator('.tl-clip[data-clip-id]').first();
  await clip.scrollIntoViewIfNeeded();
  const box = await clip.boundingBox();
  expect(box && box.width).toBeGreaterThan(20);

  const pps = await page.evaluate(() => window.__videoEditor.store.timelineZoom);
  await page.mouse.move(box.x + 25, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(box.x + 25 + step * 9, box.y + box.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips)[0]?.start || 0).toBeGreaterThan(0.5);
  const movedStart = (await projectState(page)).tracks.flatMap((track) => track.clips)[0].start;
  expect(movedStart).toBeCloseTo(54 / pps, 1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips)[0].start).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips)[0].start).toBeCloseTo(movedStart, 2);

  const clip2 = page.locator('.tl-clip[data-clip-id]').first();
  await clip2.scrollIntoViewIfNeeded();
  const box2 = await clip2.boundingBox();
  const beforeTrim = (await projectState(page)).tracks.flatMap((track) => track.clips)[0].duration;
  await page.mouse.move(box2.x + box2.width - 3, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width - 60, box2.y + box2.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips)[0].duration).toBeLessThan(beforeTrim - 0.2);

  await page.evaluate(() => window.__videoEditor.seek(1.5));
  await page.keyboard.press('s');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(1);
  expect(errors).toEqual([]);
});

test('inspector applies transitions and keyframes and canvas drag moves a layer', async ({ page }) => {
  const errors = await openEditor(page);
  const { clipId } = await addVideo(page);
  await page.waitForTimeout(300);

  await expect(page.locator('#ve-inspector-panel .ve-kind-chip')).toHaveText('video');
  const hasEffects = await openInspectorSection(page, 'Effects');
  expect(hasEffects).toBe(true);

  const transition = page.locator('#ve-inspector-panel select[data-prop="transition.type"]');
  await scrollInspectorTo(page, '#ve-inspector-panel select[data-prop="transition.type"]');
  const optionCount = await transition.evaluate((element) =>
    [...element.options].filter((option) => option.value && option.value !== 'none').length
  );
  expect(optionCount).toBeGreaterThanOrEqual(20);
  await transition.selectOption('cross-dissolve');
  await expect.poll(async () => {
    const clip = await page.evaluate((id) => {
      const found = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
      return found ? found.transition : null;
    }, clipId);
    return clip?.type;
  }).toBe('cross-dissolve');
  await openInspectorSection(page, 'Effects');
  await scrollInspectorTo(page, '#ve-inspector-panel select[data-prop="transition.type"]');
  await transition.selectOption('none');
  await expect.poll(async () => {
    const clip = await page.evaluate((id) => {
      const found = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
      return found ? found.transition : null;
    }, clipId);
    return clip?.type;
  }).toBe('none');

  await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0];
    window.__videoEditor.seek(clip.start + 0.5);
    window.__videoEditor.selectClip(clip.id);
  });
  await openInspectorSection(page, 'Transform');
  const keyframe = page.locator('#ve-inspector-panel [data-inspector-action="keyframe"][data-key-prop="x"]');
  await scrollInspectorTo(page, '#ve-inspector-panel [data-inspector-action="keyframe"][data-key-prop="x"]');
  await keyframe.click();
  await expect.poll(async () => {
    const clip = await page.evaluate((id) => {
      const found = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
      return found?.keyframes?.x?.length || 0;
    }, clipId);
    return clip;
  }).toBe(1);

  const before = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    return { x: clip.x, y: clip.y };
  }, clipId);
  const selection = page.locator('#ve-canvas-overlay .ve-selection-box');
  await expect(selection).toHaveCount(1);
  const selectionBox = await selection.boundingBox();
  expect(selectionBox).not.toBeNull();
  await page.mouse.move(selectionBox.x + selectionBox.width / 2, selectionBox.y + selectionBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(selectionBox.x + selectionBox.width / 2 + 40, selectionBox.y + selectionBox.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    return { x: clip.x, y: clip.y };
  }, clipId);
  expect(Math.abs(after.x - before.x) > 0.01 || Math.abs(after.y - before.y) > 0.01).toBe(true);
  expect(errors).toEqual([]);
});

test('text layers and subtitle cues import and export', async ({ page }) => {
  const errors = await openEditor(page);
  await page.click('#ve-rail [data-category="text"]');
  await page.click('[data-panel-action="add-text"][data-text-preset="title"]');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).filter((clip) => clip.kind === 'text').length).toBe(1);

  await openInspectorSection(page, 'Timing');
  await scrollInspectorTo(page, '#ve-inspector-panel [data-inspector-action="duplicate-clip"]');
  await page.click('#ve-inspector-panel [data-inspector-action="duplicate-clip"]');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).filter((clip) => clip.kind === 'text').length).toBe(2);
  await openInspectorSection(page, 'Timing');
  await scrollInspectorTo(page, '#ve-inspector-panel [data-inspector-action="delete-clip"]');
  await page.click('#ve-inspector-panel [data-inspector-action="delete-clip"]');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).filter((clip) => clip.kind === 'text').length).toBe(1);

  await page.click('#ve-rail [data-category="subtitles"]');
  await page.click('[data-panel-action="add-subtitle"]');
  await expect.poll(async () => (await projectState(page)).subtitles).toBe(1);
  const cue = page.locator('#ve-inspector-panel textarea[data-subtitle-prop="text"]');
  await cue.fill('Hello from a cue');
  await cue.blur();
  await expect.poll(async () => page.evaluate(() => window.__videoEditor.project.subtitles.items[0].text)).toBe('Hello from a cue');

  await page.click('[data-panel-action="duplicate-subtitle"]');
  await expect.poll(async () => (await projectState(page)).subtitles).toBe(2);
  await page.locator('[data-panel-action="delete-subtitle"]').first().click();
  await expect.poll(async () => (await projectState(page)).subtitles).toBe(1);

  const srtDownload = page.waitForEvent('download');
  await page.click('[data-panel-action="export-srt"]');
  const srt = await srtDownload;
  const srtText = fs.readFileSync(await srt.path(), 'utf8');
  expect(srtText).toMatch(/^1\r?\n00:00:\d{2},\d{3} --> /);
  expect(srtText).toContain('Hello from a cue');

  const vttDownload = page.waitForEvent('download');
  await page.click('[data-panel-action="export-vtt"]');
  const vtt = await vttDownload;
  const vttText = fs.readFileSync(await vtt.path(), 'utf8');
  expect(vttText.startsWith('WEBVTT')).toBe(true);
  expect(vttText).toContain('Hello from a cue');

  const importFile = path.join(os.tmpdir(), `letitedit-cues-${Date.now()}.srt`);
  fs.writeFileSync(
    importFile,
    '1\n00:00:01,000 --> 00:00:02,500\nFirst imported cue\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond imported cue\n'
  );
  await page.setInputFiles('#ve-subtitle-input', importFile);
  await expect.poll(async () => (await projectState(page)).subtitles).toBe(3);
  fs.unlinkSync(importFile);
  expect(errors).toEqual([]);
});

test('canvas presets, guides, background and elements', async ({ page }) => {
  const errors = await openEditor(page);
  await page.click('#ve-rail [data-category="canvas"]');

  const shapes = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4
  };
  for (const [aspect, ratio] of Object.entries(shapes)) {
    await page.click(`[data-panel-action="aspect"][data-aspect="${aspect}"]`);
    await expect.poll(async () => (await projectState(page)).aspect).toBe(aspect);
    const dims = await page.evaluate(() => window.__videoEditor.store.dimensions());
    expect(Math.abs(dims.width / dims.height - ratio)).toBeLessThan(0.02);
  }

  await page.click('[data-panel-action="aspect"][data-aspect="custom"]');
  await expect.poll(async () => (await projectState(page)).aspect).toBe('custom');
  await page.locator('input[data-project-prop="project.customAspectW"]').fill('21');
  await page.locator('input[data-project-prop="project.customAspectH"]').fill('9');
  await page.locator('input[data-project-prop="project.customAspectH"]').blur();
  const custom = await page.evaluate(() => window.__videoEditor.store.dimensions());
  expect(Math.abs(custom.width / custom.height - 21 / 9)).toBeLessThan(0.05);

  await page.locator('input[data-project-boolean="guides.center"]').check();
  await expect.poll(async () => (await projectState(page)).guides.center).toBe(true);
  await page.locator('input[data-project-boolean="guides.safe"]').check();
  await expect.poll(async () => (await projectState(page)).guides.safe).toBe(true);

  await page.locator('input[data-project-prop="background"]').evaluate((element) => {
    element.value = '#123456';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate(() => window.__videoEditor.project.background)).toBe('#123456');

  await page.click('#ve-rail [data-category="elements"]');
  await page.click('[data-panel-action="add-shape"][data-shape="rect"]');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).filter((clip) => clip.kind === 'shape').length).toBe(1);
  await page.click('[data-panel-action="add-emoji"][data-emoji="✨"]');
  await expect.poll(async () => page.evaluate(() =>
    window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.kind === 'text' && clip.text?.content === '✨').length
  )).toBe(1);
  expect(errors).toEqual([]);
});

test('audio clip exposes waveform, gain, mute and fades', async ({ page }) => {
  const errors = await openEditor(page);
  await importFiles(page, ['trim-audio-only.m4a']);
  const asset = await page.evaluate(() => window.__videoEditor.media.list()[0].id);
  await page.evaluate((id) => window.__videoEditor.addAssetToTimeline(id, { start: 0 }), asset);
  await page.waitForTimeout(500);

  const audioClip = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const found = ed.project.tracks.flatMap((track) => track.clips).find((clip) => clip.kind === 'audio');
    ed.seek(found.start + 0.2);
    ed.selectClip(found.id);
    return { id: found.id, volume: found.volume };
  });
  await expect(page.locator('#ve-inspector-panel .ve-kind-chip')).toHaveText('audio');
  await expect(page.locator('.tl-clip-audio canvas.tl-wave').first()).toBeVisible();

  await openInspectorSection(page, 'Audio');
  const volume = page.locator('#ve-inspector-panel input[data-prop="volume"]');
  await scrollInspectorTo(page, '#ve-inspector-panel input[data-prop="volume"]');
  await volume.evaluate((element) => {
    element.value = '0.25';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    return clip.volume;
  }, audioClip.id)).toBeCloseTo(0.25, 2);

  await page.locator('#ve-inspector-panel input[data-prop="muted"]').check();
  await expect.poll(async () => page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    return clip.muted;
  }, audioClip.id)).toBe(true);

  await page.locator('#ve-inspector-panel input[data-prop="fadeIn"]').fill('0.4');
  await page.locator('#ve-inspector-panel input[data-prop="fadeIn"]').blur();
  await expect.poll(async () => page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    return clip.fadeIn;
  }, audioClip.id)).toBeCloseTo(0.4, 2);
  expect(errors).toEqual([]);
});

test('autosave restores the timeline and relinks evicted media', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideo(page);
  await page.waitForTimeout(1600);
  const saved = await page.evaluate(async () => {
    const data = await window.__videoEditor.getAutosave();
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
    return {
      clips: data?.snapshot?.project?.tracks?.flatMap((track) => track.clips).length || 0,
      name: data?.snapshot?.project?.name
    };
  });
  expect(saved.clips).toBeGreaterThanOrEqual(1);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await expect(page.locator('#ve-restore-banner')).toBeVisible();
  await page.click('#ve-restore-button');
  await expect(page.locator('#ve-relink-banner')).toBeVisible();
  await expect(page.locator('#ve-relink-text')).toContainText('need relinking');

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#ve-relink-button')
  ]);
  await chooser.setFiles(fixturePath('trim-4s.mp4'));
  await expect.poll(async () => page.evaluate(() =>
    window.__videoEditor.project.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.mediaId && !window.__videoEditor.media.has(clip.mediaId)).length
  )).toBe(0);
  await expect(page.locator('#ve-relink-banner')).toBeHidden();
  expect(await page.evaluate(() => window.__videoEditor.media.list().length)).toBe(1);
  expect(errors).toEqual([]);
});

test('project JSON downloads and opens with the same edit', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideo(page);
  await page.locator('#ve-project-name').fill('Portable cut');
  await page.locator('#ve-project-name').press('Enter');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#ve-project-menu-button');
  await page.click('[data-project-action="save"]');
  const download = await downloadPromise;
  const savedPath = await download.path();
  const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  expect(saved.project.name).toBe('Portable cut');
  expect(saved.project.tracks.flatMap((track) => track.clips).length).toBe(1);

  await page.click('#ve-project-menu-button');
  await page.click('[data-project-action="new"]');
  await page.click('#ve-confirm-dialog [data-confirm-ok]');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(0);

  await page.setInputFiles('#ve-open-input', savedPath);
  await expect.poll(async () => (await projectState(page)).name).toBe('Portable cut');
  expect((await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(1);
  expect(errors).toEqual([]);
});

test('export writes a real MP4 with audio and a real WebM square', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openEditor(page);
  await addVideo(page);
  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(600);

  const mp4 = await page.evaluate(async () => {
    const ed = window.__videoEditor;
    const out = await ed.exportToBlob({ format: 'mp4', resolution: '480', quality: 'small' });
    const url = URL.createObjectURL(out.blob);
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
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4 * 29) {
      if (data[i] + data[i + 1] + data[i + 2] > 30) lit += 1;
    }
    const result = {
      type: out.blob.type,
      size: out.blob.size,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      lit,
      meta: out.meta
    };
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    return result;
  });
  expect(mp4.type).toBe('video/mp4');
  expect(mp4.size).toBeGreaterThan(50000);
  expect(mp4.width).toBe(854);
  expect(mp4.height).toBe(480);
  expect(mp4.meta.format).toBe('mp4');
  expect(mp4.meta.codec).toBe('avc');
  expect(mp4.meta.audioCodec).toBe('aac');
  expect(mp4.meta.hasAudio).toBe(true);
  expect(mp4.duration).toBeGreaterThan(3.5);
  expect(mp4.duration).toBeLessThan(4.6);
  expect(mp4.lit).toBeGreaterThan(100);

  await page.evaluate(() => window.__videoEditor.setProjectValue('project.aspect', '1:1'));
  await page.waitForTimeout(500);
  const webm = await page.evaluate(async () => {
    const out = await window.__videoEditor.exportToBlob({ format: 'webm', resolution: '480', quality: 'small' });
    return { type: out.blob.type, size: out.blob.size, meta: out.meta };
  });
  expect(webm.type).toBe('video/webm');
  expect(webm.size).toBeGreaterThan(30000);
  expect(webm.meta.format).toBe('webm');
  expect(webm.meta.codec).toBe('vp9');
  expect(webm.meta.width).toBe(webm.meta.height);
  expect(Math.abs(webm.meta.width - 854)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('export dialog reports progress and cancels without a download', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await openEditor(page);
  await addVideo(page);
  await page.waitForTimeout(300);

  await page.click('#ve-export-open');
  await expect(page.locator('#ve-export-dialog')).toBeVisible();
  await expect(page.locator('[data-export-action="start"]')).toBeEnabled();
  await expect(page.locator('#ve-export-dialog')).toContainText('Estimate');
  await page.selectOption('[data-export-setting="format"]', 'webm');
  await page.selectOption('[data-export-setting="resolution"]', '480');
  await page.click('[data-export-action="start"]');
  await expect(page.locator('[data-export-action="cancel"]')).toBeEnabled();
  await page.waitForTimeout(250);
  await page.click('[data-export-action="cancel"]');
  await expect.poll(async () => page.evaluate(() => window.__videoEditor.exporter.state)).toBe('idle');
  await expect(page.locator('[data-export-action="start"]')).toBeEnabled();
  await expect(page.locator('#ve-export-preview')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard shortcuts and help dialog work', async ({ page }) => {
  const errors = await openEditor(page);
  await addVideo(page);
  await page.waitForTimeout(300);

  await page.keyboard.press('Space');
  await expect(page.locator('#ve-play')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('#ve-play')).toHaveAttribute('aria-pressed', 'false');

  await page.click('#ve-help-open');
  await expect(page.locator('#ve-help-dialog')).toBeVisible();
  await expect(page.locator('#ve-help-dialog')).toContainText('Keyboard shortcuts');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ve-help-dialog')).toBeHidden();

  await page.evaluate(() => window.__videoEditor.selectClip(window.__videoEditor.project.tracks.flatMap((track) => track.clips)[0].id));
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(2);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(2);
  expect(errors).toEqual([]);
});

test('record panel reports unsupported capture honestly', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true, writable: true });
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true, writable: true });
    }
  });
  const errors = await openEditor(page);
  await page.click('#ve-rail [data-category="record"]');
  await expect(page.locator('.ve-notice-warn')).toContainText('This mode is unavailable');
  const modes = await page.locator('[data-record-mode]').evaluateAll((nodes) => nodes.map((node) => node.disabled));
  expect(modes.every(Boolean)).toBe(true);
  await expect(page.locator('[data-record-action="start"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

for (const width of MOBILE_WIDTHS) {
  test(`mobile layout at ${width}px keeps preview, all tools and touch targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    const errors = await openEditor(page);

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner + 1);

    const canvasBox = await page.locator('#ve-preview-canvas').boundingBox();
    expect(canvasBox.width).toBeGreaterThan(120);
    expect(canvasBox.height).toBeGreaterThan(60);

    const dock = page.locator('.ve-mobile-dock');
    await expect(dock).toBeVisible();
    const dockTargets = await dock.locator('button').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height)
    );
    expect(dockTargets.every((height) => height >= 44)).toBe(true);

    await page.click('[data-open-sheet="library"]');
    await expect(page.locator('#ve-library')).toBeVisible();
    const railTargets = await page.locator('#ve-rail [data-category]').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height)
    );
    expect(railTargets.every((height) => height >= 44)).toBe(true);
    const headings = {
      media: 'Your media',
      canvas: 'Canvas & project',
      text: 'Add text',
      audio: 'Audio',
      videos: 'Video clips',
      images: 'Image overlays',
      elements: 'Elements',
      subtitles: 'Subtitles',
      record: 'Record'
    };
    for (const [category, heading] of Object.entries(headings)) {
      await page.click(`#ve-rail [data-category="${category}"]`);
      await expect(page.locator('#ve-library-panel h2')).toHaveText(heading);
    }
    await page.click('#ve-library-close');
    await expect(page.locator('#ve-app')).toHaveAttribute('data-mobile-sheet', 'none');

    await page.click('[data-open-sheet="inspector"]');
    await expect(page.locator('#ve-inspector')).toBeVisible();
    await page.click('#ve-inspector-close');
    await expect(page.locator('#ve-app')).toHaveAttribute('data-mobile-sheet', 'none');

    await page.click('#ve-mobile-menu');
    await expect(page.locator('#ve-project-menu')).toBeVisible();
    await expect(page.locator('[data-project-action="undo"]')).toBeVisible();
    await expect(page.locator('[data-project-action="new"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ve-project-menu')).toBeHidden();

    await page.evaluate(() => window.__videoEditor.addTextPreset('plain'));
    await expect.poll(async () => (await projectState(page)).tracks.flatMap((track) => track.clips).length).toBe(1);
    await page.click('#ve-mobile-export');
    await expect(page.locator('#ve-export-dialog')).toBeVisible();
    await page.click('#ve-export-dialog [data-export-action="close"]');
    await expect(page.locator('#ve-export-dialog')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('tablet layout at 768px keeps the desktop dock and sheets usable', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const errors = await openEditor(page);
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner + 1);
  await expect(page.locator('.ve-mobile-dock')).toBeVisible();
  await page.click('[data-open-sheet="library"]');
  await expect(page.locator('#ve-library')).toBeVisible();
  await expect(page.locator('#ve-rail [data-category]')).toHaveCount(9);
  await page.click('#ve-library-close');
  expect(errors).toEqual([]);
});
