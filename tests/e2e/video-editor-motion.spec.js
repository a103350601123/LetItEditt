'use strict';

/* Motion graphics, keyframes and audio automation regressions.
 *
 * These tests exercise the same data the user edits: keyframes on the clip,
 * entrance/exit animation data, and volume automation. The preview and the
 * exported file are both checked, because the editor promises one renderer
 * for both.
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

async function importMedia(page, name) {
  const before = await page.evaluate(() => window.__videoEditor.media.list().length);
  await page.setInputFiles('#ve-media-input', fixturePath(name));
  await page.waitForFunction(
    (expected) => window.__videoEditor.media.list().length >= expected,
    before + 1,
    { timeout: 60000 }
  );
  return page.evaluate((filename) => window.__videoEditor.media.list().find((item) => item.name === filename).id, name);
}

async function openSection(page, title) {
  const section = page.locator('#ve-inspector-panel details.ve-inspector-section', { hasText: title }).first();
  await section.evaluate((element) => {
    element.open = true;
    element.scrollIntoView({ block: 'center' });
  });
  return section;
}

async function setNumber(page, locator, value) {
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(String(value));
  await locator.press('Tab');
  await page.waitForTimeout(120);
}

async function previewCentroid(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#ve-preview-canvas');
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let sx = 0;
    let count = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        /* The default rectangle is #0080ff, so a blue-dominant pixel is the
           graphic rather than the black canvas background. */
        if (data[i + 2] > 120 && data[i] < 120) {
          sx += x;
          count += 1;
        }
      }
    }
    return { x: count ? sx / count / width : -1, count };
  });
}

async function clipState(page, clipId) {
  return page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    return clip ? JSON.parse(JSON.stringify(clip)) : null;
  }, clipId);
}

async function seek(page, time) {
  await page.evaluate((value) => window.__videoEditor.seek(value), time);
  await page.waitForTimeout(450);
}

test('keyframed graphics are editable, retimeable, and identical in preview and export', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);

  const clipId = await page.evaluate(() => {
    const clip = window.__videoEditor.addShape('rect').clip;
    window.__videoEditor.seek(0);
    window.__videoEditor.selectClip(clip.id);
    return clip.id;
  });
  await page.waitForTimeout(350);

  const addX = page.locator('#ve-inspector-panel [data-inspector-action="keyframe"][data-key-prop="x"]');
  await addX.scrollIntoViewIfNeeded();
  await addX.click();
  const rows = page.locator('#ve-inspector-panel .ve-kf-row[data-kf-prop="x"]');
  await expect(rows).toHaveCount(1);
  await setNumber(page, rows.first().locator('input[data-kf-field="v"]'), 384);

  await seek(page, 2);
  await addX.click();
  await expect(rows).toHaveCount(2);
  await setNumber(page, rows.nth(1).locator('input[data-kf-field="v"]'), 1536);

  let clip = await clipState(page, clipId);
  expect(clip.keyframes.x).toHaveLength(2);
  expect(clip.keyframes.x[0].v).toBeCloseTo(0.2, 2);
  expect(clip.keyframes.x[1].v).toBeCloseTo(0.8, 2);
  expect(clip.keyframes.x[1].t).toBeCloseTo(2, 1);

  /* Ease-in must actually change the midpoint, not just the dropdown value. */
  await seek(page, 1);
  const linearMid = await previewCentroid(page);
  await rows.first().locator('select[data-kf-field="ease"]').selectOption('easeIn');
  await page.waitForTimeout(500);
  const easedMid = await previewCentroid(page);
  expect(easedMid.x).toBeLessThan(linearMid.x - 0.05);
  await rows.first().locator('select[data-kf-field="ease"]').selectOption('linear');
  await page.waitForTimeout(400);

  await seek(page, 0.2);
  const early = await previewCentroid(page);
  await seek(page, 1.8);
  const late = await previewCentroid(page);
  expect(early.count).toBeGreaterThan(100);
  expect(late.x).toBeGreaterThan(early.x + 0.25);

  const exported = await page.evaluate(async () => {
    const out = await window.__videoEditor.exportToBlob({ format: 'mp4', resolution: '480', quality: 'small' });
    const url = URL.createObjectURL(out.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Exported MP4 could not be decoded.'));
    });
    const sample = async (time) => {
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = time;
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sx = 0;
      let count = 0;
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4;
          if (data[i + 2] > 120 && data[i] < 120) {
            sx += x;
            count += 1;
          }
        }
      }
      return { x: count ? sx / count / width : -1, count };
    };
    const earlyFrame = await sample(0.4);
    const lateFrame = await sample(2.4);
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    return { earlyFrame, lateFrame, size: out.blob.size, meta: out.meta };
  });
  expect(exported.size).toBeGreaterThan(4000);
  expect(exported.meta.duration).toBeCloseTo(4, 0);
  expect(exported.lateFrame.x).toBeGreaterThan(exported.earlyFrame.x + 0.25);

  /* Timeline diamonds retime the same keyframe data and move the playhead. */
  const marker = page.locator('.tl-kf[data-kf-prop="x"]').nth(1);
  await marker.scrollIntoViewIfNeeded();
  const box = await marker.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 55, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  clip = await clipState(page, clipId);
  expect(clip.keyframes.x[1].t).toBeLessThan(1.8);
  const debug = await page.evaluate(() => window.__videoEditor.preview.debug());
  expect(Math.abs(debug.time - clip.keyframes.x[1].t)).toBeLessThan(0.15);

  await rows.first().locator('[data-inspector-action="delete-keyframe"]').click();
  await expect(rows).toHaveCount(1);
  await page.evaluate(() => window.__videoEditor.undo());
  await page.waitForTimeout(250);
  clip = await clipState(page, clipId);
  expect(clip.keyframes.x).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('volume keyframes automate preview gain and the exported audio bed', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);

  const assetId = await importMedia(page, 'trim-4s.mp4');
  const clipId = await page.evaluate((id) => {
    const inserted = window.__videoEditor.addAssetToTimeline(id, { start: 0 });
    window.__videoEditor.seek(0);
    window.__videoEditor.selectClip(inserted.clip.id);
    return inserted.clip.id;
  }, assetId);
  await page.waitForTimeout(350);

  await openSection(page, 'Audio');
  const addVolume = page.locator('#ve-inspector-panel [data-inspector-action="keyframe"][data-key-prop="volume"]');
  await addVolume.scrollIntoViewIfNeeded();
  await addVolume.click();
  const rows = page.locator('#ve-inspector-panel .ve-kf-row[data-kf-prop="volume"]');
  await expect(rows).toHaveCount(1);
  await setNumber(page, rows.first().locator('input[data-kf-field="v"]'), 0);

  await seek(page, 2);
  await addVolume.click();
  await expect(rows).toHaveCount(2);
  await setNumber(page, rows.nth(1).locator('input[data-kf-field="v"]'), 100);

  const clip = await clipState(page, clipId);
  expect(clip.keyframes.volume).toHaveLength(2);
  expect(clip.keyframes.volume[0].v).toBeCloseTo(0, 2);
  expect(clip.keyframes.volume[1].v).toBeCloseTo(1, 2);

  /* Editing the animated clip-volume slider must write the keyframe under the
     playhead instead of a hidden base value. */
  await seek(page, 1);
  await page.locator('#ve-inspector-panel input[data-prop="volume"]').evaluate((input) => {
    input.value = '0.4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const animated = await clipState(page, clipId);
  const middleKey = animated.keyframes.volume.find((key) => Math.abs(key.t - 1) < 0.02);
  expect(middleKey).toBeTruthy();
  expect(middleKey.v).toBeCloseTo(0.4, 2);
  expect(animated.volume).toBeCloseTo(1, 2);

  const gains = await page.evaluate(() => {
    const ed = window.__videoEditor;
    const gainAt = (time) => ed.preview.audio.activeClips(ed.project, time)[0]?.gain ?? 0;
    return { start: gainAt(0.1), middle: gainAt(1), end: gainAt(2.5) };
  });
  expect(gains.start).toBeLessThan(gains.middle);
  expect(gains.middle).toBeLessThan(gains.end);
  expect(gains.end).toBeGreaterThan(0.9);

  const audio = await page.evaluate(async () => {
    const out = await window.__videoEditor.exportToBlob({ format: 'mp4', resolution: '480', quality: 'small' });
    const ctx = new AudioContext();
    try {
      const buffer = await ctx.decodeAudioData(await out.blob.arrayBuffer());
      const rms = (from, to) => {
        const start = Math.max(0, Math.floor(from * buffer.sampleRate));
        const end = Math.min(buffer.length, Math.floor(to * buffer.sampleRate));
        let sum = 0;
        let count = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          const data = buffer.getChannelData(channel);
          for (let i = start; i < end; i += 4) {
            sum += data[i] * data[i];
            count += 1;
          }
        }
        return Math.sqrt(sum / Math.max(1, count));
      };
      return {
        early: rms(0.2, 0.6),
        late: rms(2.4, 2.8),
        channels: buffer.numberOfChannels,
        size: out.blob.size,
        hasAudio: out.meta.hasAudio
      };
    } finally {
      await ctx.close();
    }
  });
  expect(audio.hasAudio).toBe(true);
  expect(audio.channels).toBeGreaterThanOrEqual(1);
  expect(audio.late).toBeGreaterThan(0.02);
  expect(audio.late).toBeGreaterThan(audio.early * 2.5);
  expect(errors).toEqual([]);
});

test('acceptance mix: video, music, animated text, animated graphics and a transition export together', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);

  const videoId = await importMedia(page, 'trim-4s.mp4');
  const musicId = await importMedia(page, 'trim-audio-only.m4a');

  const result = await page.evaluate(({ video, music }) => {
    const ed = window.__videoEditor;
    const first = ed.addAssetToTimeline(video, { start: 0 }).clip;
    const second = ed.addAssetToTimeline(video, { start: 4 }).clip;
    ed.addAssetToTimeline(music, { start: 0 });
    const text = ed.addTextPreset('intro').clip;
    text.start = 0.5;
    const shape = ed.addShape('circle').clip;
    shape.start = 1;
    shape.duration = 4;
    shape.keyframes.x = [
      { t: 0, v: 0.2, ease: 'easeInOut' },
      { t: 3, v: 0.8, ease: 'linear' }
    ];
    shape.keyframes.y = [
      { t: 0, v: 0.65, ease: 'linear' },
      { t: 3, v: 0.35, ease: 'linear' }
    ];
    second.transition = { type: 'cross-dissolve', duration: 0.8, reverse: false };
    ed.store.emit('acceptance-setup');
    ed.seek(1);
    return {
      firstId: first.id,
      secondId: second.id,
      textId: text.id,
      shapeId: shape.id,
      duration: Math.max(...ed.project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)))
    };
  }, { video: videoId, music: musicId });
  await page.waitForTimeout(600);

  const project = await page.evaluate(() => JSON.parse(JSON.stringify(window.__videoEditor.project)));
  const allClips = project.tracks.flatMap((track) => track.clips);
  const videoClips = allClips.filter((clip) => clip.kind === 'video');
  const textClip = allClips.find((clip) => clip.id === result.textId);
  const shapeClip = allClips.find((clip) => clip.id === result.shapeId);
  const musicClip = allClips.find((clip) => clip.kind === 'audio' && clip.mediaId);

  expect(videoClips).toHaveLength(2);
  expect(textClip.inAnim.type).toBe('fade');
  expect(textClip.outAnim.type).toBe('fade');
  expect(shapeClip.keyframes.x).toHaveLength(2);
  expect(shapeClip.keyframes.y).toHaveLength(2);
  expect(videoClips.find((clip) => clip.id === result.secondId).transition.type).toBe('cross-dissolve');
  expect(musicClip).toBeTruthy();
  expect(result.duration).toBeGreaterThan(7.5);

  const previewA = await page.evaluate((id) => {
    const ed = window.__videoEditor;
    const clip = ed.project.tracks.flatMap((track) => track.clips).find((item) => item.id === id);
    const at = (time) => {
      ed.seek(time);
      return ed.preview.boundsFor(clip);
    };
    return { early: at(1.2), late: at(3.4) };
  }, result.shapeId);
  expect(previewA.late.x).toBeGreaterThan(previewA.early.x + 50);
  expect(previewA.late.y).toBeLessThan(previewA.early.y - 20);

  const out = await page.evaluate(async () => {
    const result = await window.__videoEditor.exportToBlob({ format: 'mp4', resolution: '480', quality: 'small' });
    return {
      size: result.blob.size,
      type: result.blob.type,
      meta: result.meta
    };
  });
  expect(out.type).toBe('video/mp4');
  expect(out.size).toBeGreaterThan(40000);
  expect(out.meta.hasAudio).toBe(true);
  expect(out.meta.duration).toBeGreaterThan(7.5);
  expect(out.meta.duration).toBeLessThan(9.5);
  expect(errors).toEqual([]);
});

test('text entrance animation renders in preview and in the exported file', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);

  await page.evaluate(() => {
    const clip = window.__videoEditor.addTextPreset('intro').clip;
    clip.text.content = 'MOTION';
    window.__videoEditor.seek(0);
  });
  await page.waitForTimeout(400);

  const countWhite = () => page.evaluate(() => {
    const canvas = document.querySelector('#ve-preview-canvas');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) count += 1;
    }
    return count;
  });

  await page.evaluate(() => window.__videoEditor.seek(0.12));
  await page.waitForTimeout(500);
  const earlyPreview = await countWhite();
  await page.evaluate(() => window.__videoEditor.seek(1.1));
  await page.waitForTimeout(500);
  const latePreview = await countWhite();
  expect(latePreview).toBeGreaterThan(earlyPreview + 100);

  const exported = await page.evaluate(async () => {
    const out = await window.__videoEditor.exportToBlob({ format: 'mp4', resolution: '480', quality: 'small' });
    const url = URL.createObjectURL(out.blob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Exported MP4 could not be decoded.'));
    });
    const sample = async (time) => {
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = time;
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) count += 1;
      }
      return count;
    };
    const early = await sample(0.12);
    const late = await sample(1.1);
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    return { early, late, size: out.blob.size };
  });
  expect(exported.size).toBeGreaterThan(4000);
  expect(exported.late).toBeGreaterThan(exported.early + 50);
  expect(errors).toEqual([]);
});
