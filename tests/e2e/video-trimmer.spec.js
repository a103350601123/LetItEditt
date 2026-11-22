'use strict';

const { test, expect } = require('@playwright/test');
const { fixturePath, ensureFixtures } = require('../support/fixtures');

const PAGE = '/media-and-motion/video-trimmer/';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(180000);
  await ensureFixtures(browser, baseURL);
});

async function openPage(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-dropzone]')).toBeVisible();
}

async function loadVideo(page, name) {
  await page.setInputFiles('[data-file-input]', fixturePath(name));
  await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    const state = window.__videoTrimmer?.getState();
    return Boolean(state && state.encoderReady && (state.formatSupport.mp4 || state.formatSupport.webm));
  }, null, { timeout: 30000 });
}

async function inspectDownload(page) {
  return page.evaluate(async () => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    const blob = await (await fetch(href)).blob();
    const MB = await import('/vendor/mediabunny/mediabunny.min.mjs');
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    const duration = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      size: blob.size,
      type: blob.type,
      duration,
      width: video ? await video.getDisplayWidth() : null,
      height: video ? await video.getDisplayHeight() : null,
      videoCodec: video ? await video.getCodec() : null,
      audioCodec: audio ? await audio.getCodec() : null
    };
  });
}

async function exportSelection(page, start, end) {
  await page.evaluate(([a, b]) => window.__videoTrimmer.setRange(a, b), [start, end]);
  await expect(page.locator('[data-export]')).toBeEnabled();
  await page.click('[data-export]');
  await expect(page.locator('[data-result]')).toBeVisible({ timeout: 60000 });
}

test('serves a complete, indexable tool page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);

  await expect(page).toHaveTitle('Free Online Video Trimmer – Cut Videos Easily | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://letitedit.com/media-and-motion/video-trimmer/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Trim videos online for free/);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Free Online Video Trimmer');
  await expect(page.locator('nav.breadcrumbs')).toContainText('Video Editing');
  await expect(page.locator('[data-export]')).toBeDisabled();

  const structured = await page.$$eval('script[type="application/ld+json"]', (nodes) => nodes.map((node) => JSON.parse(node.textContent)));
  expect(structured.length).toBeGreaterThan(0);
  const types = structured.flatMap((entry) => (entry['@graph'] || [entry]).map((item) => item['@type']));
  expect(types).toEqual(expect.arrayContaining(['BreadcrumbList', 'SoftwareApplication', 'FAQPage']));

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('loads a real MP4, reports metadata, and renders timeline thumbnails', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  await expect(page.locator('[data-file-name]')).toHaveText('trim-4s.mp4');
  await expect(page.locator('[data-meta-duration]')).toHaveText(/00:00:04\.0/);
  await expect(page.locator('[data-meta-resolution]')).toHaveText('640 × 360');
  await expect(page.locator('[data-meta-fps]')).toHaveText(/30(\.00)? fps/);
  await expect(page.locator('[data-meta-audio]')).toHaveText(/AAC/);
  await expect(page.locator('[data-start-input]')).toHaveValue('00:00:00.000');
  await expect(page.locator('[data-end-input]')).toHaveValue(/00:00:04\./);
  await expect(page.locator('[data-duration-input]')).toHaveValue(/00:00:04\./);
  await expect(page.locator('[data-export]')).toBeEnabled();

  await expect(page.locator('[data-thumbs] canvas').first()).toBeVisible({ timeout: 20000 });
  expect(await page.locator('[data-thumbs] canvas').count()).toBeGreaterThan(3);

  await page.click('label.vtr-mode-option:has-text("Remove selected section")');
  await expect(page.locator('[data-mode-note]')).toContainText('joins the remaining video');
  await expect(page.locator('[data-export-summary]')).toContainText('before');
  await page.click('label.vtr-mode-option:has-text("Keep selected section")');
  await expect(page.locator('[data-export-summary]')).toContainText('audio kept');

  expect(pageErrors).toEqual([]);
});

test('validates precise start and end times', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');

  const start = page.locator('[data-start-input]');
  const end = page.locator('[data-end-input]');

  await start.fill('-1');
  await start.press('Enter');
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-validation]')).toContainText('cannot be negative');
  await expect(page.locator('[data-export]')).toBeDisabled();

  await start.fill('00:00:01.000');
  await start.press('Enter');
  await end.fill('00:00:09.000');
  await end.press('Enter');
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-validation]')).toContainText('cannot exceed the video duration');
  await expect(page.locator('[data-export]')).toBeDisabled();

  await end.fill('00:00:00.500');
  await end.press('Enter');
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-validation]')).toContainText('at least');
  await expect(page.locator('[data-export]')).toBeDisabled();

  await end.fill('00:00:02.500');
  await end.press('Enter');
  await expect(end).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-validation]')).toBeHidden();
  await expect(page.locator('[data-export]')).toBeEnabled();
  await expect(page.locator('[data-duration-input]')).toHaveValue('00:00:01.500');

  const duration = page.locator('[data-duration-input]');
  await duration.fill('00:00:01.000');
  await duration.press('Enter');
  await expect(start).toHaveValue('00:00:01.000');
  await expect(end).toHaveValue('00:00:02.000');
  await expect(page.locator('[data-export]')).toBeEnabled();

  await duration.fill('00:00:09.000');
  await duration.press('Enter');
  await expect(duration).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-validation]')).toContainText('remaining video');
  await expect(page.locator('[data-export]')).toBeDisabled();

  await duration.fill('00:00:00.010');
  await duration.press('Enter');
  await expect(duration).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-validation]')).toContainText('at least');
  await expect(page.locator('[data-export]')).toBeDisabled();

  await duration.fill('00:00:01.500');
  await duration.press('Enter');
  await expect(duration).not.toHaveAttribute('aria-invalid', 'true');
  await expect(end).toHaveValue('00:00:02.500');
  await expect(page.locator('[data-export]')).toBeEnabled();
});

test('exports the kept section as a playable, downloadable MP4 with audio', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await exportSelection(page, 1, 2.2);

  await expect(page.locator('[data-result-name]')).toHaveText('trim-4s-trimmed.mp4');
  await expect(page.locator('[data-result-format]')).toContainText('MP4');
  await expect(page.locator('[data-result-audio]')).toHaveText('Audio included');

  const output = await inspectDownload(page);
  expect(output.type).toBe('video/mp4');
  expect(output.videoCodec).toBe('avc');
  expect(output.audioCodec).toBe('aac');
  expect(output.width).toBe(640);
  expect(output.height).toBe(360);
  expect(output.duration).toBeGreaterThan(1.1);
  expect(output.duration).toBeLessThan(1.4);
  expect(output.size).toBeGreaterThan(1000);

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-download]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('trim-4s-trimmed.mp4');

  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('[data-result-video]');
    if (video.readyState < 1) return null;
    return { width: video.videoWidth, height: video.videoHeight, error: video.error?.code ?? null };
  }), { timeout: 15000 }).toEqual({ width: 640, height: 360, error: null });

  await page.click('[data-trim-another]');
  await expect(page.locator('[data-dropzone]')).toBeVisible();
  await expect(page.locator('[data-editor]')).toBeHidden();
  expect(await page.evaluate(() => window.__videoTrimmer.getState().output)).toBeNull();
});

test('removes a middle section and joins the remaining video', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-4s.mp4');
  await page.click('label.vtr-mode-option:has-text("Remove selected section")');
  await exportSelection(page, 1, 2);

  const output = await inspectDownload(page);
  expect(output.type).toBe('video/mp4');
  expect(output.audioCodec).toBe('aac');
  expect(output.duration).toBeGreaterThan(2.85);
  expect(output.duration).toBeLessThan(3.25);
  await expect(page.locator('[data-result-duration]')).toHaveText(/00:00:0[23]\./);
});

test('accepts WebM and exports a genuine WebM file when selected', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-3s.webm');
  await expect(page.locator('[data-file-name]')).toHaveText('trim-3s.webm');
  await expect(page.locator('[data-meta-format]')).toContainText('WebM');

  const webmOption = page.locator('[data-format] option[value="webm"]');
  await expect(webmOption).toBeEnabled();
  await page.selectOption('[data-format]', 'webm');
  await exportSelection(page, 0.5, 1.5);

  const output = await inspectDownload(page);
  expect(output.type).toBe('video/webm');
  expect(output.videoCodec).toBe('vp9');
  expect(output.audioCodec).toBe('opus');
  expect(output.duration).toBeGreaterThan(0.85);
  expect(output.duration).toBeLessThan(1.3);
  await expect(page.locator('[data-result-name]')).toHaveText('trim-3s-trimmed.webm');
});

test('decodes MOV and MKV and explains the MP4 output', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-mov.mov');
  await expect(page.locator('[data-meta-format]')).toContainText('QuickTime');
  await expect(page.locator('[data-format-note]')).toContainText('MOV file is exported as MP4');
  await exportSelection(page, 0.5, 1.5);
  const movOutput = await inspectDownload(page);
  expect(movOutput.type).toBe('video/mp4');
  expect(movOutput.audioCodec).toBe('aac');

  await loadVideo(page, 'trim-mkv.mkv');
  await expect(page.locator('[data-meta-format]')).toContainText('Matroska');
  await expect(page.locator('[data-format-note]')).toContainText('MKV file is exported as MP4');
});

test('keeps a silent video silent and never invents audio', async ({ page }) => {
  await openPage(page);
  await loadVideo(page, 'trim-2s-mute.mp4');
  await expect(page.locator('[data-meta-audio]')).toHaveText('No audio track');
  await exportSelection(page, 0.2, 1.2);

  const output = await inspectDownload(page);
  expect(output.audioCodec).toBeNull();
  await expect(page.locator('[data-result-audio]')).toHaveText('No audio track');
});

test('rejects corrupted and non-video files with clear errors', async ({ page }) => {
  await openPage(page);

  await page.setInputFiles('[data-file-input]', fixturePath('trim-corrupt.mp4'));
  await expect(page.locator('[data-global-error]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-global-error]')).toContainText(/No readable video track|corrupted|supported video/i);
  await expect(page.locator('[data-editor]')).toBeHidden();
  await expect(page.locator('[data-dropzone]')).toBeVisible();

  await page.setInputFiles('[data-file-input]', fixturePath('trim-not-video.avi'));
  await expect(page.locator('[data-global-error]')).toContainText(/could not be read as a supported video/i);
  await expect(page.locator('[data-editor]')).toBeHidden();
});

for (const width of [320, 360, 375, 390, 430]) {
  test(`fits the trimmer into a ${width}px mobile viewport`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(baseURL + PAGE, { waitUntil: 'networkidle' });
      await page.setInputFiles('[data-file-input]', fixturePath('trim-4s.mp4'));
      await expect(page.locator('[data-editor]')).toBeVisible({ timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.__videoTrimmer?.getState().formatSupport.mp4), null, { timeout: 30000 });

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowing = [];
        document.querySelectorAll('body *').forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && (rect.right > doc.clientWidth + 1 || rect.left < -1)) {
            overflowing.push(element.tagName + '.' + String(element.className || ''));
          }
        });
        return { overflow: doc.scrollWidth - doc.clientWidth, overflowing: overflowing.slice(0, 5) };
      });
      expect(layout.overflow).toBe(0);
      expect(layout.overflowing).toEqual([]);

      await expect(page.locator('[data-player]')).toBeVisible();
      await expect(page.locator('[data-timeline]')).toBeVisible();
      await expect(page.locator('[data-start-input]')).toBeVisible();
      await expect(page.locator('[data-export]')).toBeVisible();

      const handleBox = await page.locator('[data-handle-start]').boundingBox();
      expect(handleBox.height).toBeGreaterThan(40);
    } finally {
      await context.close();
    }
  });
}
