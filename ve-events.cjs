const { chromium } = require('@playwright/test');
const path = require('path');
const BASE = 'http://127.0.0.1:4173/media-and-motion/video-editor/';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (msg) => console.log('[page]', msg.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__videoEditorReady === true);
  await page.locator('#ve-media-input').setInputFiles(path.resolve('tests/fixtures/trim-4s.mp4'));
  await page.waitForFunction(() => window.__videoEditor.media.list().length > 0);
  await page.evaluate(() => window.__videoEditor.addAssetToTimeline(window.__videoEditor.media.list()[0].id, { start: 0 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const audio = window.__videoEditor.preview.audio;
    const t0 = performance.now();
    const stamp = () => Math.round(performance.now() - t0);
    const create = audio.ensureEntry.bind(audio);
    audio.ensureEntry = (info) => {
      const had = audio.entries.get(info.clip.id);
      const entry = create(info);
      if (entry && !had) {
        entry.el.addEventListener('play', () => console.log(stamp(), 'event play'));
        entry.el.addEventListener('playing', () => console.log(stamp(), 'event playing'));
        entry.el.addEventListener('waiting', () => console.log(stamp(), 'event waiting'));
        entry.el.addEventListener('stalled', () => console.log(stamp(), 'event stalled'));
        entry.el.addEventListener('suspend', () => console.log(stamp(), 'event suspend'));
        entry.el.addEventListener('pause', () => console.log(stamp(), 'event pause'));
        entry.el.addEventListener('seeked', () => console.log(stamp(), 'event seeked', entry.el.currentTime.toFixed(3)));
        entry.el.addEventListener('error', () => console.log(stamp(), 'event error', entry.el.error?.code));
        entry.el.addEventListener('timeupdate', () => console.log(stamp(), 'timeupdate', entry.el.currentTime.toFixed(3), 'ready', entry.el.readyState));
      }
      return entry;
    };
    const play = audio.playEntry.bind(audio);
    audio.playEntry = (entry) => {
      console.log(stamp(), 'playEntry called, ct=', entry.el.currentTime.toFixed(3), 'ready=', entry.el.readyState, 'paused=', entry.el.paused);
      play(entry);
      console.log(stamp(), 'playEntry after, paused=', entry.el.paused);
    };
  });
  await page.locator('#ve-play').click();
  await page.waitForTimeout(2500);
  await page.locator('#ve-play').click();
  await page.waitForTimeout(300);
  await browser.close();
})();
