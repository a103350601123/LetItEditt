const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

const sample = (page) => page.evaluate(() => {
  const p = window.__videoEditor.preview;
  const dbg = p.audio.debug();
  return {
    playhead: +p.store.playhead.toFixed(3),
    playing: p.store.playing,
    ctx: dbg.context,
    level: +dbg.level.toFixed(4),
    decoding: dbg.decoding,
    entries: dbg.entries.length
  };
});

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const file of ['trim-4s.mp4', 'trim-3s.webm', 'trim-audio-only.m4a']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__videoEditorReady === true);
    await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures', file));
    await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
    await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
    await page.waitForTimeout(400);

    await page.locator('#ve-play').click();
    const playing = [];
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(250);
      playing.push(await sample(page));
    }

    await page.evaluate(() => window.__videoEditor.preview.seek(2.2, { keepPlaying: true }));
    await page.waitForTimeout(500);
    const afterSeek = await sample(page);

    await page.evaluate(() => {
      const clip = window.__videoEditor.project.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video' || c.kind === 'audio');
      clip.volume = 0.25;
      window.__videoEditor.store.emit('change', { reason: 'volume' });
      window.__videoEditor.preview.audio.refresh();
    });
    await page.waitForTimeout(400);
    const quiet = await sample(page);

    await page.evaluate(() => window.__videoEditor.preview.pause());
    await page.waitForTimeout(400);
    const paused = await sample(page);

    console.log(file, JSON.stringify({ playing, afterSeek, quiet, paused, errors }));
    await page.close();
  }
  await browser.close();
})();
