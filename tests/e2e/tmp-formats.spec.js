'use strict';

const { test, expect } = require('@playwright/test');
const { fixturePath } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-editor/';
const FILES = ['trim-3s.webm', 'trim-mkv.mkv', 'trim-mov.mov', 'trim-rotated.mp4', 'trim-portrait.mp4', 'trim-short.mp4'];

for (const name of FILES) {
  test(`preview decodes ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

    await page.goto(PAGE);
    await page.waitForFunction(() => Boolean(window.__VE__), null, { timeout: 30000 });
    await page.setInputFiles('#se-file-input', fixturePath(name));
    await page.waitForFunction(() => window.__VE__.state().baseClips.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => window.__VE__.seek(0.4));
    await page.waitForTimeout(1200);

    const sample = await page.evaluate(() => {
      const canvas = document.getElementById('se-canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let min = 255;
      let max = 0;
      for (let index = 0; index < data.length; index += 40) {
        const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const debug = window.__VE__.preview.debug();
      return { range: max - min, min, max, renderMs: debug.renderMs, videoElements: debug.videoElements };
    });
    console.log('FORMAT', name, JSON.stringify(sample));
    expect(sample.range).toBeGreaterThan(10);
    expect(errors).toEqual([]);
  });
}
