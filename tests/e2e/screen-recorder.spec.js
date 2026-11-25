'use strict';

const { test, expect } = require('@playwright/test');

const PAGE = '/media-and-motion/screen-recorder/';
const CATEGORY = '/categories/video-editing/';

/**
 * Install deterministic capture stubs.
 *
 * Real getDisplayMedia() opens an operating-system picker, which cannot be
 * automated in a headless browser. The stubs keep the same contract: they
 * return a MediaStream with a live video track (a painted canvas) and,
 * optionally, an audio track (an oscillator). The app is exercised exactly as
 * it would be with a real screen, including MediaRecorder, the AudioContext
 * mix, the webcam canvas composition, the timer and the download.
 */
async function installFakes(page, options = {}) {
  await page.addInitScript((config) => {
    const {
      screenColor = '#16a34a',
      webcamColor = '#d946ef',
      withSystemAudio = true,
      withMic = true,
      denyScreen = false,
      failCamera = false
    } = config;

    window.__FAKE_TRACKS__ = [];
    const register = (stream) => {
      for (const track of stream.getTracks()) window.__FAKE_TRACKS__.push(track);
      return stream;
    };

    const canvasStream = (color, label, width, height, fps) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      let frame = 0;
      const paint = () => {
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
        context.fillStyle = 'rgba(255,255,255,.92)';
        context.font = `${Math.round(height / 12)}px sans-serif`;
        context.fillText(label, Math.round(width * 0.05), Math.round(height * 0.16));
        context.fillStyle = 'rgba(15,23,42,.7)';
        context.fillRect((frame * 9) % width, height - Math.round(height * 0.08), Math.round(width * 0.16), Math.round(height * 0.04));
        frame += 1;
      };
      paint();
      const timer = setInterval(paint, 1000 / fps);
      window.addEventListener('pagehide', () => clearInterval(timer));
      return register(canvas.captureStream(fps));
    };

    const toneStream = (frequency) => {
      const Context = window.AudioContext || window.webkitAudioContext;
      const context = new Context();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.3;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      context.resume().catch(() => {});
      return register(destination.stream);
    };

    const devices = navigator.mediaDevices;
    const originalGetUserMedia = devices.getUserMedia
      ? devices.getUserMedia.bind(devices)
      : null;

    devices.getDisplayMedia = async (constraints) => {
      if (denyScreen) {
        throw new DOMException('Permission denied by the user', 'NotAllowedError');
      }
      const stream = canvasStream(screenColor, 'SCREEN', 1280, 720, 30);
      window.__FAKE_SCREEN_TRACK__ = stream.getVideoTracks()[0];
      window.__FAKE_SCREEN_STREAM__ = stream;
      if (withSystemAudio) {
        const audio = toneStream(880);
        stream.addTrack(audio.getAudioTracks()[0]);
      }
      return stream;
    };

    devices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        if (!withMic) throw new DOMException('Permission denied by the user', 'NotAllowedError');
        return toneStream(440);
      }
      if (constraints && constraints.video) {
        if (failCamera) throw new DOMException('Permission denied by the user', 'NotAllowedError');
        const stream = canvasStream(webcamColor, 'CAM', 640, 480, 30);
        window.__FAKE_WEBCAM_TRACK__ = stream.getVideoTracks()[0];
        return stream;
      }
      if (originalGetUserMedia) return originalGetUserMedia(constraints);
      throw new DOMException('Not supported', 'NotSupportedError');
    };

    devices.enumerateDevices = async () => [
      { deviceId: 'fake-mic', kind: 'audioinput', label: 'Fake microphone', groupId: 'fake' },
      { deviceId: 'fake-cam', kind: 'videoinput', label: 'Fake camera', groupId: 'fake' }
    ];

    devices.addEventListener = devices.addEventListener || (() => {});
  }, options);
}

async function open(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => Boolean(window.__SR__), null, { timeout: 30000 });
  return errors;
}

async function startRecording(page) {
  await page.click('[data-start]');
  await page.waitForFunction(() => window.__SR__.state() === 'recording', null, { timeout: 20000 });
}

async function stopAndWaitForResult(page) {
  await page.click('[data-stop]');
  await page.waitForFunction(() => window.__SR__.state() === 'ready', null, { timeout: 30000 });
  await expect(page.locator('[data-result]')).toBeVisible();
}

async function blobRms(page) {
  return page.evaluate(async () => {
    const href = document.querySelector('[data-download]').getAttribute('href');
    const buffer = await (await fetch(href)).arrayBuffer();
    const context = new OfflineAudioContext(2, 48000, 48000);
    const audio = await context.decodeAudioData(buffer);
    const data = audio.getChannelData(0);
    let sum = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 24) {
      sum += data[index] * data[index];
      count += 1;
    }
    return { rms: Math.sqrt(sum / Math.max(1, count)), duration: audio.duration, channels: audio.numberOfChannels };
  });
}

async function sampleResultFrame(page, time) {
  return page.evaluate(async (at) => {
    const video = document.querySelector('[data-result-video]');
    if (!video.videoWidth) {
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
    const seek = () => new Promise((resolve) => {
      if (Math.abs(video.currentTime - at) < 0.02) return resolve();
      video.addEventListener('seeked', resolve, { once: true });
      video.currentTime = at;
      setTimeout(resolve, 2000);
    });
    await seek();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const sample = (x, y, size = 24) => {
      const data = context.getImageData(
        Math.max(0, Math.min(canvas.width - size, Math.round(x - size / 2))),
        Math.max(0, Math.min(canvas.height - size, Math.round(y - size / 2))),
        size,
        size
      ).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let index = 0; index < data.length; index += 4) {
        r += data[index];
        g += data[index + 1];
        b += data[index + 2];
      }
      const pixels = data.length / 4;
      return { r: r / pixels, g: g / pixels, b: b / pixels };
    };

    const width = canvas.width;
    const height = canvas.height;
    const size = Math.round(height * 0.28);
    const margin = Math.round(Math.min(width, height) * 0.035);
    return {
      width,
      height,
      center: sample(width / 2, height / 2),
      webcam: sample(width - margin - size / 2, margin + size / 2),
      bottomBand: sample(width * 0.5, height - height * 0.06)
    };
  }, time);
}

/* ------------------------------------------------------------------ */
/* Registration and SEO                                               */
/* ------------------------------------------------------------------ */

test('is registered as a separate card in the Video Editing category', async ({ page, baseURL }) => {
  const response = await page.request.get(baseURL + CATEGORY);
  expect(response.ok()).toBe(true);
  const html = await response.text();

  expect(html).toContain('href="/media-and-motion/screen-recorder/"');
  expect(html).toContain('Screen Recorder');
  expect(html).toContain('Record your screen, browser tab, or application window with optional microphone audio and webcam.');

  const sitemap = await page.request.get(baseURL + '/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('https://letitedit.com/media-and-motion/screen-recorder/');

  await page.goto(CATEGORY);
  const card = page.locator('a.tool-card[href="/media-and-motion/screen-recorder/"]');
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Screen Recorder');
  await expect(card.locator('svg')).toBeVisible();

  const otherTools = await page.locator('.tool-card-list a.tool-card').count();
  expect(otherTools).toBe(8);
});

test('the card opens a complete, SEO-friendly dedicated page', async ({ page }) => {
  await page.goto(CATEGORY);
  await page.locator('a.tool-card[href="/media-and-motion/screen-recorder/"]').click();
  await page.waitForURL('**/media-and-motion/screen-recorder/');

  await expect(page).toHaveTitle('Free Online Screen Recorder – Record Screen, Tab or Window | LetitEdit');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://letitedit.com/media-and-motion/screen-recorder/'
  );
  await expect(page.locator('h1')).toHaveText('Free Online Screen Recorder');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Record your screen/);

  for (const heading of [
    'How to record your screen',
    'How to record a browser tab',
    'How to record microphone audio',
    'How to use the webcam overlay',
    'Supported formats and real limitations',
    'Privacy and local processing',
    'Troubleshooting',
    'Frequently asked questions'
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  const structured = await page.evaluate(() => {
    const node = document.querySelector('script[type="application/ld+json"]');
    return JSON.parse(node.textContent);
  });
  const types = structured['@graph'].map((item) => item['@type']);
  expect(types).toContain('BreadcrumbList');
  expect(types).toContain('SoftwareApplication');
  expect(types).toContain('FAQPage');

  const faq = page.locator('details.faq-item');
  await expect(faq).toHaveCount(8);
  await faq.first().locator('summary').click();
  await expect(faq.first()).toHaveAttribute('open', '');

  await expect(page.locator('a[href="/media-and-motion/video-trimmer/"]').first()).toBeVisible();
  await expect(page.locator('a[href="/media-and-motion/video-editor/"]').first()).toBeVisible();
  await expect(page.locator('a[href="/categories/video-editing/"]').first()).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Capability and error paths                                         */
/* ------------------------------------------------------------------ */

test('reports a missing MediaRecorder instead of showing fake controls', async ({ page }) => {
  await page.addInitScript(() => {
    window.MediaRecorder = undefined;
  });
  const errors = await open(page);

  await expect(page.locator('[data-support]')).toBeVisible();
  await expect(page.locator('[data-support]')).toContainText('MediaRecorder');
  await expect(page.locator('[data-start]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('handles denied or cancelled screen access with a recovery message', async ({ page }) => {
  await installFakes(page, { denyScreen: true });
  const errors = await open(page);

  await page.click('[data-start]');
  await expect(page.locator('[data-error]')).toBeVisible();
  await expect(page.locator('[data-error]')).toContainText(/cancelled or denied/i);
  await expect(page.locator('[data-start]')).toBeEnabled();
  expect(await page.evaluate(() => window.__SR__.state())).toBe('idle');
  await expect(page.locator('[data-rec-badge]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('handles a denied microphone and unavailable system audio honestly', async ({ page }) => {
  await installFakes(page, { withSystemAudio: false, withMic: false });
  const errors = await open(page);

  await page.locator('[data-mic]').check();
  await page.click('[data-start]');
  await page.waitForFunction(() => window.__SR__.state() === 'recording', null, { timeout: 20000 });

  const notice = page.locator('[data-notice]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/No system or tab audio/i);
  await expect(notice).toContainText(/Microphone access was denied/i);
  await expect(page.locator('[data-mute-mic]')).toBeHidden();

  await page.waitForTimeout(1700);
  await stopAndWaitForResult(page);
  await expect(page.locator('[data-result-audio]')).toHaveText('None');
  const debug = await page.evaluate(() => window.__SR__.debug());
  expect(debug.audioTracks).toBe(0);
  expect(debug.result.hasAudio).toBe(false);
  expect(debug.result.size).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('handles a denied camera without breaking screen-only recording', async ({ page }) => {
  await installFakes(page, { failCamera: true });
  const errors = await open(page);

  await page.locator('[data-webcam]').click();
  await expect(page.locator('[data-error]')).toBeVisible();
  await expect(page.locator('[data-error]')).toContainText(/Camera access was denied/i);
  await expect(page.locator('[data-webcam]')).not.toBeChecked();

  await page.locator('[data-system-audio]').uncheck();
  await startRecording(page);
  await page.waitForTimeout(1800);
  await stopAndWaitForResult(page);
  expect((await page.evaluate(() => window.__SR__.debug())).result.size).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Real recording flow                                                */
/* ------------------------------------------------------------------ */

test('records, pauses, resumes, stops, previews and downloads a playable file', async ({ page }) => {
  test.setTimeout(120000);
  await installFakes(page, { withSystemAudio: true, withMic: true });
  const errors = await open(page);

  await expect(page.locator('[data-mic-device]')).toContainText('Fake microphone');
  await expect(page.locator('[data-format-note]')).toContainText(/This browser records/i);

  await startRecording(page);
  await expect(page.locator('[data-rec-badge]')).toBeVisible();
  await expect(page.locator('[data-screen-preview]')).toBeVisible();
  await expect(page.locator('[data-captured]')).toContainText(/Captured 1280 × 720/);

  await page.waitForTimeout(1500);
  const beforePause = await page.locator('[data-timer]').textContent();
  expect(beforePause).not.toBe('00:00');

  await page.click('[data-pause]');
  await expect(page.locator('[data-paused-badge]')).toBeVisible();
  const pausedTimer = await page.locator('[data-timer]').textContent();
  await page.waitForTimeout(700);
  expect(await page.locator('[data-timer]').textContent()).toBe(pausedTimer);

  await page.click('[data-resume]');
  await expect(page.locator('[data-paused-badge]')).toBeHidden();
  await page.waitForTimeout(900);

  const downloadPromise = page.waitForEvent('download');
  await stopAndWaitForResult(page);
  await page.click('[data-download]');
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^letitedit-screen-recording-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.(webm|mp4)$/
  );

  await expect(page.locator('[data-result-format]')).toContainText(/WebM|MP4/);
  await expect(page.locator('[data-result-size]')).not.toHaveText('0 B');
  await expect(page.locator('[data-result-resolution]')).toHaveText('1280 × 720');
  await expect(page.locator('[data-result-audio]')).toContainText(/Included/);
  await expect(page.locator('[data-download]')).toHaveAttribute('download', /^letitedit-screen-recording-/);

  await page.waitForFunction(() => {
    const result = window.__SR__.debug().result;
    return Boolean(result && Number.isFinite(result.duration) && result.duration > 0 && result.width > 0);
  }, null, { timeout: 15000 });

  const debug = await page.evaluate(() => window.__SR__.debug());
  expect(debug.result.size).toBeGreaterThan(5000);
  expect(debug.result.width).toBe(1280);
  expect(debug.result.height).toBe(720);
  expect(debug.result.hasAudio).toBe(true);
  expect(debug.result.audioDetected).toBe(true);
  /* Paused time is excluded, so the file is shorter than the wall clock. */
  expect(debug.result.duration).toBeGreaterThan(1.4);
  expect(debug.result.duration).toBeLessThan(4.2);

  const audio = await blobRms(page);
  expect(audio.rms).toBeGreaterThan(0.005);
  expect(audio.duration).toBeGreaterThan(1.2);

  const frame = await page.evaluate(async () => {
    const video = document.querySelector('[data-result-video]');
    if (!video.videoWidth) {
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, 32, 18);
    const data = context.getImageData(0, 0, 32, 18).data;
    let green = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 1] > data[index] + 20 && data[index + 1] > data[index + 2] + 20) green += 1;
    }
    return { green, total: data.length / 4 };
  });
  expect(frame.green / frame.total).toBeGreaterThan(0.4);

  /* Every capture track was released after the recording. */
  const tracks = await page.evaluate(() => window.__FAKE_TRACKS__.map((track) => track.readyState));
  expect(tracks.length).toBeGreaterThan(1);
  expect(tracks.every((readyState) => readyState === 'ended')).toBe(true);

  await expect(page.locator('[data-screen-preview]')).toBeHidden();
  await expect(page.locator('[data-record-again]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the webcam overlay is baked into the downloaded recording', async ({ page }) => {
  test.setTimeout(120000);
  await installFakes(page, { screenColor: '#16a34a', webcamColor: '#d946ef', withSystemAudio: false });
  const errors = await open(page);

  await page.locator('[data-system-audio]').uncheck();
  await page.locator('[data-webcam]').check();
  await expect(page.locator('[data-webcam-preview]')).toBeVisible();
  await expect(page.locator('[data-webcam-preview] video')).toBeVisible();

  await page.locator('[data-webcam-size]').fill('32');
  await page.locator('[data-webcam-size]').dispatchEvent('input');
  await page.locator('[data-webcam-shape]').selectOption('circle');
  await page.locator('[data-position="top-right"]').click();
  await expect(page.locator('[data-position="top-right"]')).toHaveAttribute('aria-pressed', 'true');

  await startRecording(page);
  await expect(page.locator('[data-captured]')).toContainText('with webcam overlay');
  await page.waitForTimeout(1400);
  await stopAndWaitForResult(page);

  const frame = await sampleResultFrame(page, 0.7);
  expect(frame.width).toBe(1280);
  expect(frame.height).toBe(720);
  /* Screen fills the frame: green. */
  expect(frame.center.g).toBeGreaterThan(frame.center.r + 30);
  expect(frame.center.g).toBeGreaterThan(frame.center.b + 30);
  /* The top-right corner contains the magenta camera, not the screen. */
  expect(frame.webcam.r).toBeGreaterThan(120);
  expect(frame.webcam.b).toBeGreaterThan(120);
  expect(frame.webcam.g).toBeLessThan(120);

  const debug = await page.evaluate(() => window.__SR__.debug());
  expect(debug.result.height).toBe(720);
  expect(debug.result.size).toBeGreaterThan(5000);
  expect(errors).toEqual([]);
});

test('mixes microphone and system audio and supports mic mute', async ({ page }) => {
  test.setTimeout(120000);
  await installFakes(page, { withSystemAudio: true, withMic: true });
  const errors = await open(page);

  await page.locator('[data-mic]').check();
  await page.locator('[data-mic-device]').selectOption('fake-mic');
  await page.locator('[data-mic-volume]').fill('80');
  await page.locator('[data-mic-volume]').dispatchEvent('input');
  await expect(page.locator('[data-mic-volume-label]')).toHaveText('80%');

  await startRecording(page);
  await expect(page.locator('[data-mute-mic]')).toBeVisible();
  await expect(page.locator('[data-captured]')).toContainText(/audio detected/);

  await page.click('[data-mute-mic]');
  await expect(page.locator('[data-mute-mic]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-mute-mic]')).toHaveText('Unmute mic');
  await expect(page.locator('[data-status]')).toContainText(/microphone muted/i);
  await page.waitForTimeout(400);
  await page.click('[data-mute-mic]');
  await expect(page.locator('[data-mute-mic]')).toHaveText('Mute mic');

  await page.waitForTimeout(900);
  await stopAndWaitForResult(page);

  const debug = await page.evaluate(() => window.__SR__.debug());
  expect(debug.result.hasAudio).toBe(true);
  expect(debug.result.audioDetected).toBe(true);

  const audio = await blobRms(page);
  expect(audio.rms).toBeGreaterThan(0.005);
  expect(audio.channels).toBe(2);
  expect(errors).toEqual([]);
});

test('stops cleanly and keeps the file when the user ends screen sharing', async ({ page }) => {
  test.setTimeout(120000);
  await installFakes(page);
  const errors = await open(page);

  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const track = window.__FAKE_SCREEN_TRACK__;
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => window.__SR__.state() === 'ready', null, { timeout: 30000 });

  await expect(page.locator('[data-result]')).toBeVisible();
  await expect(page.locator('[data-notice]')).toContainText(/Screen sharing ended/i);
  await expect(page.locator('[data-result-size]')).not.toHaveText('0 B');
  const debug = await page.evaluate(() => window.__SR__.debug());
  expect(debug.result.size).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('cancel discards the take and record again resets the workspace', async ({ page }) => {
  test.setTimeout(120000);
  await installFakes(page);
  const errors = await open(page);

  await startRecording(page);
  await page.waitForTimeout(900);
  await page.click('[data-cancel]');
  await page.waitForFunction(() => window.__SR__.state() === 'idle', null, { timeout: 20000 });

  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-notice]')).toContainText(/discarded/i);
  await expect(page.locator('[data-start]')).toBeEnabled();
  expect(await page.evaluate(() => window.__FAKE_TRACKS__.every((track) => track.readyState === 'ended'))).toBe(true);

  await startRecording(page);
  await page.waitForTimeout(1700);
  await stopAndWaitForResult(page);
  await expect(page.locator('[data-result]')).toBeVisible();
  await page.click('[data-record-again]');
  await expect(page.locator('[data-result]')).toBeHidden();
  await expect(page.locator('[data-start]')).toBeVisible();
  await expect(page.locator('[data-screen-preview]')).toBeHidden();
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Responsive layout                                                  */
/* ------------------------------------------------------------------ */

for (const width of [320, 360, 375, 390, 430]) {
  test(`mobile ${width}px: no horizontal overflow and all controls are usable`, async ({ page }) => {
    await installFakes(page);
    await page.setViewportSize({ width, height: 780 });
    const errors = await open(page);

    const layout = await page.evaluate(() => {
      const stage = document.querySelector('[data-stage]').getBoundingClientRect();
      const start = document.querySelector('[data-start]').getBoundingClientRect();
      const settings = document.querySelector('[data-settings]').getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        stageWidth: stage.width,
        startLeft: start.left,
        startRight: start.right,
        settingsWidth: settings.width
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.stageWidth).toBeGreaterThan(200);
    expect(layout.startLeft).toBeGreaterThanOrEqual(0);
    expect(layout.startRight).toBeLessThanOrEqual(layout.viewport);
    expect(layout.settingsWidth).toBeLessThanOrEqual(layout.viewport);

    await expect(page.locator('[data-start]')).toBeVisible();
    await expect(page.locator('[data-resolution]')).toBeVisible();
    await expect(page.locator('[data-webcam]')).toBeVisible();
    await expect(page.locator('[data-position="top-right"]')).toBeVisible();

    await page.locator('[data-webcam]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('tablet and desktop keep the preview and settings side by side', async ({ page }) => {
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await installFakes(page);
    const errors = await open(page);

    const layout = await page.evaluate(() => {
      const stage = document.querySelector('[data-stage]').getBoundingClientRect();
      const settings = document.querySelector('[data-settings]').getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        sideBySide: settings.left >= stage.right - 1,
        stageWidth: stage.width,
        settingsWidth: settings.width
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    if (width === 1280) {
      expect(layout.sideBySide).toBe(true);
      expect(layout.settingsWidth).toBeGreaterThan(260);
    } else {
      expect(layout.stageWidth).toBeGreaterThan(500);
    }
    expect(errors).toEqual([]);
  }
});
