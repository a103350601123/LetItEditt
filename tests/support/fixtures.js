'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures');

const FIXTURES = [
  'trim-4s.mp4',
  'crop-quadrants.mp4',
  'trim-2s-mute.mp4',
  'trim-3s.webm',
  'trim-mov.mov',
  'trim-mkv.mkv',
  'trim-multi-track.mkv',
  'trim-sample.m4v',
  'trim-pcm.mov',
  'trim-ulaw.mov',
  'trim-44100.mp4',
  'trim-rotated.mp4',
  'trim-portrait.mp4',
  'trim-long.mp4',
  'trim-short.mp4',
  'trim-odd.mp4',
  'trim-audio-only.m4a',
  'trim-audio-only.mp4',
  'trim-corrupt.mp4',
  'trim-not-video.avi'
];

function fixturePath(name) {
  return path.join(FIXTURE_DIR, name);
}

function fixturesExist() {
  return FIXTURES.every((name) => fs.existsSync(fixturePath(name)));
}

async function ensureFixtures(browser, baseURL) {
  if (fixturesExist()) return;

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const page = await browser.newPage();
  try {
    await page.goto(baseURL + '/tests/support/make-fixtures.html');
    await page.waitForFunction(() => window.fixturesReady === true);
    const generated = await page.evaluate(() => window.makeFixtures());
    for (const fixture of generated) {
      fs.writeFileSync(fixturePath(fixture.name), Buffer.from(fixture.base64, 'base64'));
    }
  } finally {
    await page.close();
  }
}

module.exports = { FIXTURES, fixturePath, fixturesExist, ensureFixtures };
