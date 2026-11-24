const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

async function clipState(page) {
  return page.evaluate(() => {
    const project = window.__videoEditor.project;
    return project.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      clips: t.clips.map((c) => ({ id: c.id, kind: c.kind, start: +c.start.toFixed(3), duration: +c.duration.toFixed(3), x: c.x, y: c.y, transition: c.transition?.type || null, keyframes: c.keyframes }))
    }));
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(400);

  const pps = await page.evaluate(() => window.__videoEditor.store.timelineZoom);
  const clipEl = page.locator('.tl-clip[data-clip-id]').first();
  await clipEl.scrollIntoViewIfNeeded();
  const box = await clipEl.boundingBox();
  check('timeline clip rendered', Boolean(box && box.width > 10), box);

  // Drag the clip body to the right.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 54, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  let state = await clipState(page);
  const movedClip = state.flatMap((t) => t.clips)[0];
  check('clip drag moved start', Math.abs(movedClip.start - 54 / pps) < 0.12, { pps, start: movedClip.start, expected: 54 / pps });

  // Undo restores position.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  state = await clipState(page);
  check('undo restored start', Math.abs(state.flatMap((t) => t.clips)[0].start) < 0.01, state.flatMap((t) => t.clips)[0].start);

  // Trim the right edge inwards.
  const clip2 = page.locator('.tl-clip[data-clip-id]').first();
  await clip2.scrollIntoViewIfNeeded();
  const box2 = await clip2.boundingBox();
  const beforeTrim = (await clipState(page)).flatMap((t) => t.clips)[0].duration;
  const handle = clip2.locator('[data-trim="right"]');
  const handleBox = await handle.boundingBox();
  const hx = handleBox ? handleBox.x + handleBox.width / 2 : box2.x + box2.width - 2;
  const hy = handleBox ? handleBox.y + handleBox.height / 2 : box2.y + box2.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 40, hy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterTrim = (await clipState(page)).flatMap((t) => t.clips)[0];
  check('trim shortened clip', afterTrim.duration < beforeTrim - 0.2, { beforeTrim, after: afterTrim.duration });

  // Split at 1.5 s.
  await page.evaluate(() => window.__videoEditor.seek(1.5));
  await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips)[0];
    window.__videoEditor.selectClip(clip.id);
  });
  await page.keyboard.press('s');
  await page.waitForTimeout(300);
  state = await clipState(page);
  const videoClips = state.flatMap((t) => t.clips).filter((c) => c.kind === 'video');
  check('split produced two clips', videoClips.length === 2, videoClips.map((c) => [c.start, c.duration]));

  // Undo split.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check('undo split', (await clipState(page)).flatMap((t) => t.clips).filter((c) => c.kind === 'video').length === 1);

  // Transition through the inspector.
  await page.evaluate(() => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips)[0];
    window.__videoEditor.selectClip(clip.id);
  });
  await page.waitForTimeout(200);
  const transitionSelect = page.locator('#ve-inspector-panel select[data-prop="transition.type"]');
  const transitionExists = await transitionSelect.count();
  if (transitionExists) {
    await page.evaluate(() => {
      const select = document.querySelector('#ve-inspector-panel select[data-prop="transition.type"]');
      select.closest('details').open = true;
      select.scrollIntoView({ block: 'center' });
    });
    const options = await transitionSelect.evaluate((el) => [...el.options].map((o) => o.value).filter((v) => v && v !== 'none'));
    await transitionSelect.selectOption(options[0]);
    await page.waitForTimeout(200);
    const clip = (await clipState(page)).flatMap((t) => t.clips)[0];
    check('transition applied', clip.transition === options[0], { options: options.length, applied: clip.transition });
  } else {
    check('transition select present', false);
  }

  // Keyframe at playhead.
  const kfButton = page.locator('#ve-inspector-panel [data-inspector-action="keyframe"][data-key-prop="x"]');
  if (await kfButton.count()) {
    await page.evaluate(() => {
      const button = document.querySelector('#ve-inspector-panel [data-inspector-action="keyframe"][data-key-prop="x"]');
      button.scrollIntoView({ block: 'center' });
    });
    await kfButton.click();
    await page.waitForTimeout(200);
    const clip = (await clipState(page)).flatMap((t) => t.clips)[0];
    check('keyframe added', (clip.keyframes?.x || []).length >= 1, clip.keyframes?.x);
  } else {
    check('keyframe control present', false);
  }

  // Direct canvas manipulation: add a text layer and drag it in the preview.
  await page.evaluate(() => window.__videoEditor.addTextPreset('title'));
  await page.waitForTimeout(300);
  const textClip = await page.evaluate(() => window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text'));
  await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    window.__videoEditor.seek(clip.start + 0.5);
    window.__videoEditor.selectClip(id);
  }, textClip.id);
  await page.waitForTimeout(400);
  const before = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    return { x: clip.x, y: clip.y };
  }, textClip.id);
  const selectionBox = page.locator('#ve-canvas-overlay .ve-selection-box');
  const boxCount = await selectionBox.count();
  if (boxCount) await selectionBox.scrollIntoViewIfNeeded();
  const stageBox2 = boxCount ? await selectionBox.boundingBox() : null;
  const target = stageBox2
    ? { x: stageBox2.x + stageBox2.width / 2, y: stageBox2.y + stageBox2.height / 2 }
    : { x: 0, y: 0 };
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate((id) => {
    const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    return { x: clip.x, y: clip.y, selected: window.__videoEditor.store.selection.has(id) };
  }, textClip.id);
  check('canvas drag moved layer', Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5, { before, after });

  // Subtitles: create, edit text, export SRT.
  await page.evaluate(() => window.__videoEditor.addSubtitle());
  await page.waitForTimeout(300);
  const cue = await page.evaluate(() => window.__videoEditor.project.subtitles.items[0]);
  check('subtitle created', Boolean(cue && cue.id), cue && { start: cue.start, end: cue.end, text: cue.text });
  const srt = await page.evaluate(() => {
    const items = window.__videoEditor.project.subtitles.items;
    items[0].text = 'Hello from the timeline';
    return window.__videoEditor.project.subtitles.items.length;
  });
  const subtitleDownload = await page.evaluate(async () => {
    const app = window.__videoEditor;
    const before = document.querySelectorAll('a[download]').length;
    app.state.emit('change');
    // Directly exercise the serializer the export uses.
    const mod = await import('/js/video-editor/utils.js');
    return { srt: mod.toSrt(app.project.subtitles.items), vtt: mod.toVtt(app.project.subtitles.items), before };
  });
  check('SRT export contains cue', subtitleDownload.srt.includes('Hello from the timeline') && subtitleDownload.srt.includes('-->'), subtitleDownload.srt.slice(0, 120));
  check('VTT export has header', subtitleDownload.vtt.startsWith('WEBVTT'), subtitleDownload.vtt.slice(0, 40));

  // Layer ordering.
  const orderBefore = await page.evaluate(() => window.__videoEditor.project.tracks.flatMap((t) => t.clips).map((c) => c.id));
  await page.evaluate((id) => {
    window.__videoEditor.selectClip(id);
    window.__videoEditor.layerAction('back');
  }, textClip.id);
  const orderAfter = await page.evaluate(() => window.__videoEditor.project.tracks.flatMap((t) => t.clips).map((c) => c.id));
  check('layer order changed', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter), { orderBefore, orderAfter });

  // Autosave round-trip.
  await page.evaluate(() => window.__videoEditor.requestAutosave());
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__videoEditor.getAutosave().then((data) => ({ has: Boolean(data?.snapshot?.project), clips: data?.snapshot?.project?.tracks?.flatMap((t) => t.clips).length || 0, media: data?.snapshot?.mediaManifest?.length || 0 })));
  check('autosave written', saved.has && saved.clips >= 2, saved);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.waitForTimeout(600);
  const restoreVisible = await page.locator('#ve-restore-banner').isVisible();
  check('restore banner shown after reload', restoreVisible);
  if (restoreVisible) {
    await page.locator('#ve-restore-button').click();
    await page.waitForTimeout(800);
    const restored = await page.evaluate(() => window.__videoEditor.project.tracks.flatMap((t) => t.clips).length);
    check('restored project clips', restored >= 2, restored);
  }

  // Workspace sizes persist.
  await page.evaluate(() => {
    const ws = window.__videoEditor.store.workspace;
    ws.libraryWidth = 360;
    window.__videoEditor.saveWorkspace();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  const libWidth = await page.evaluate(() => getComputedStyle(document.querySelector('#ve-app')).getPropertyValue('--ve-library-width').trim());
  check('workspace width persisted', libWidth === '360px', libWidth);

  console.log(JSON.stringify({ results, errors }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`PASS ${results.length - failed.length}/${results.length}`);
  await page.screenshot({ path: 'C:/Users/Ismail/AppData/Local/Temp/opencode/ve-func.png' });
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
