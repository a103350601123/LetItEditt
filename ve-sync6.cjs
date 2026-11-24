const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

async function readSync(page) {
  return page.evaluate(() => {
    const p = window.__videoEditor.preview;
    const project = p.store.project;
    const active = p.audio.activeClips(project, p.store.playhead);
    return {
      playhead: +p.store.playhead.toFixed(3),
      entries: [...p.audio.entries.values()].map((entry) => {
        const info = active.find((item) => item.clip.id === entry.clipId);
        return {
          ct: +entry.el.currentTime.toFixed(3),
          src: info ? +info.source.toFixed(3) : null,
          drift: info ? +(entry.el.currentTime - info.source).toFixed(3) : null,
          seeking: entry.el.seeking,
          ready: entry.el.readyState,
          paused: entry.el.paused,
          failed: entry.failed
        };
      })
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const file of ['trim-4s.mp4', 'trim-3s.webm', 'trim-audio-only.m4a']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__videoEditorReady === true);
    await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures', file));
    await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
    await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
    await page.waitForTimeout(500);

    await page.locator('#ve-play').click();
    const samples = [];
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(300);
      samples.push(await readSync(page));
    }
    // Seek during playback to 70% of the clip.
    await page.evaluate(() => {
      const p = window.__videoEditor.preview;
      p.pause();
      p.seek(2.4);
      p.play();
    });
    await page.waitForTimeout(1200);
    const afterSeek = await readSync(page);
    await page.evaluate(() => window.__videoEditor.preview.pause());
    await page.waitForTimeout(200);
    const paused = await readSync(page);
    await page.evaluate(() => window.__videoEditor.preview.play());
    await page.waitForTimeout(900);
    const resumed = await readSync(page);

    console.log(file, JSON.stringify({ samples, afterSeek, paused, resumed, errors }));
    await page.close();
  }
  await browser.close();
})();
