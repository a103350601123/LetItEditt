const { test, expect } = require('@playwright/test');
const registry = require('../../data/registry');

const BASE = 'http://127.0.0.1:4173';
const videoTools = registry.publishedTools.filter(tool => tool.categoryKey === 'video');
const generated = videoTools.filter(tool => tool.layout !== 'existing');

/* A short generated WAV keeps the pure audio path independent of codec support. */
function wavFixture(seconds = 2, rate = 16000) {
  const frames = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const envelope = Math.min(1, i / (rate * 0.1)) * Math.min(1, (frames - i) / (rate * 0.2));
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000 * envelope), 44 + i * 2);
  }
  return buffer;
}

/* A real WebM is recorded from a canvas so no third-party media assets are needed. */
async function webmFixture(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(15);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = types.find(type => MediaRecorder.isTypeSupported(type)) || '';
    const chunks = [];
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 900000 } : undefined);
    recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(200);
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      context.fillStyle = `hsl(${(tick * 24) % 360} 85% 50%)`;
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = '#fff';
      context.font = 'bold 26px sans-serif';
      context.fillText(`Frame ${tick}`, 18, 95);
    }, 60);
    await new Promise(resolve => setTimeout(resolve, 2400));
    clearInterval(timer);
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: mime || 'video/webm' });
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  });
  return Buffer.from(base64, 'base64');
}

async function expectDownload(page, action) {
  const events = [];
  page.on('download', download => events.push(download));
  await action();
  await expect.poll(() => events.length, { timeout: 30000 }).toBeGreaterThan(0);
  const path = await events[0].path();
  const size = require('fs').statSync(path).size;
  expect(size).toBeGreaterThan(100);
  return { name: events[0].suggestedFilename(), size };
}

test('audio editor decodes a real file, applies edits and exports MP3 and WAV', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/audio-editor/index.html');
  await page.setInputFiles('#v-file', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.locator('#v-status')).toContainText('Decoded 00:02');
  await page.locator('#v-gain').fill('80');
  await page.locator('#v-fade-in').fill('100');
  await expect(page.locator('#v-fade-in-value')).toHaveText('100 ms');

  const mp3 = await expectDownload(page, async () => {
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('Ready: letitedit-audio.mp3');
    await page.click('#v-download');
  });
  expect(mp3.name).toBe('letitedit-audio.mp3');

  await page.selectOption('#v-format', 'wav');
  const wav = await expectDownload(page, async () => {
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('Ready: letitedit-audio.wav');
    await page.click('#v-download');
  });
  expect(wav.name).toBe('letitedit-audio.wav');
  expect(errors).toEqual([]);
});

test('video trimmer exports a real WebM clip', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const clip = await webmFixture(page);
  await page.goto('/video-trimmer/index.html');
  await page.setInputFiles('#v-file', { name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.locator('#v-status')).toContainText('Loaded 320×180');
  await page.locator('#v-start').fill('100');
  await page.locator('#v-end').fill('700');

  const download = await expectDownload(page, async () => {
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('Ready: letitedit-trim.webm');
    await page.click('#v-download');
  });
  expect(download.name).toBe('letitedit-trim.webm');
  expect(errors).toEqual([]);
});

test('MP4 to GIF decodes real frames and exports an animated GIF', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const clip = await webmFixture(page);
  await page.goto('/mp4-to-gif/index.html');
  await page.setInputFiles('#v-file', { name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.locator('#v-status')).toContainText('Ready. Choose a short range');
  await page.locator('#v-start').fill('100');
  await page.locator('#v-end').fill('600');

  const download = await expectDownload(page, async () => {
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('Ready: letitedit-animation.gif');
    await page.click('#v-download');
  });
  expect(download.name).toBe('letitedit-animation.gif');
  await expect(page.locator('#v-gif')).toBeVisible();
  expect(errors).toEqual([]);
});

test('watermark remover draws a real frame and exports a masked video', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const clip = await webmFixture(page);
  await page.goto('/watermark-remover/index.html');
  await page.setInputFiles('#v-file', { name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.locator('#v-status')).toContainText('Drag on the frame');
  await expect(page.locator('#v-mask-canvas')).toBeVisible();
  const canvas = page.locator('#v-mask-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#v-w')).not.toHaveValue('25');

  const download = await expectDownload(page, async () => {
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('Ready: letitedit-masked.mp4');
    await page.click('#v-download');
  });
  expect(download.name).toBe('letitedit-masked.mp4');
  expect(errors).toEqual([]);
});

test('video-to-shorts falls back to motion analysis and exports a vertical clip', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const clip = await webmFixture(page);
  await page.goto('/video-to-shorts/index.html');
  await page.setInputFiles('#v-file', { name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.locator('#v-status')).toContainText('Ready. Analysis uses real audio energy');
  await expectDownload(page, async () => {
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('vertical clips exported locally');
    await page.locator('.clip-row .btn').first().click();
  });
  await expect(page.locator('.clip-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('screen recorder captures real frames, pauses and exports a WebM', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  /* Replace only the browser share prompt. Frames still come from a real
   * canvas stream and are encoded by the page's real MediaRecorder. */
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d');
        let tick = 0;
        const timer = setInterval(() => {
          tick += 1;
          context.fillStyle = `hsl(${(tick * 17) % 360} 80% 48%)`;
          context.fillRect(0, 0, 320, 180);
          context.fillStyle = '#fff';
          context.font = 'bold 24px sans-serif';
          context.fillText(`Capture ${tick}`, 16, 90);
        }, 60);
        const stream = canvas.captureStream(15);
        const track = stream.getVideoTracks()[0];
        const stopTrack = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stopTrack(); };
        window.__captureStream = stream;
        return stream;
      }
    });
  });
  await page.goto('/screen-recorder/index.html');
  await expect(page.locator('#v-stop')).toBeDisabled();
  await page.click('#v-start');
  await expect(page.locator('#v-stop')).toBeEnabled();
  await expect(page.locator('#v-status')).toContainText('Recording.');
  await page.waitForTimeout(900);
  await page.click('#v-pause');
  await expect(page.locator('#v-status')).toContainText('paused');
  await page.click('#v-pause');
  await expect(page.locator('#v-status')).toContainText('resumed');
  await page.waitForTimeout(700);
  await page.click('#v-stop');
  await expect(page.locator('#v-status')).toContainText('Ready: letitedit-recording.webm');
  const tracksStopped = await page.evaluate(() =>
    window.__captureStream.getVideoTracks().every(track => track.readyState === 'ended'));
  expect(tracksStopped).toBe(true);
  const download = await expectDownload(page, async () => { await page.click('#v-download'); });
  expect(download.name).toBe('letitedit-recording.webm');
  expect(errors).toEqual([]);
});

test('local AI tools require explicit opt-in before any model download', async ({ page }) => {
  for (const slug of ['video-background-remover', 'subtitle-generator']) {
    await page.goto(`/${slug}/index.html`);
    await expect(page.locator('#v-ai-consent')).not.toBeChecked();
    await page.click('#v-process');
    await expect(page.locator('#v-status')).toContainText('Opt in to the local');
  }
  await page.goto('/video-to-shorts/index.html');
  await expect(page.locator('#v-ai-consent')).not.toBeChecked();
  await expect(page.locator('label.check-line').filter({ hasText: 'Whisper' })).toBeVisible();
});

test('invalid media and empty input produce clear, non-fatal errors', async ({ page }) => {
  await page.goto('/audio-editor/index.html');
  await page.setInputFiles('#v-file', { name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not a wave file') });
  await expect(page.locator('#v-status')).toHaveClass(/is-error/);
  await expect(page.locator('#v-status')).toContainText('unsupported or unrecognizable format');
  await page.click('#v-process');
  await expect(page.locator('#v-status')).toContainText('Choose an audio file first.');
  await expect(page.locator('#v-download')).toBeDisabled();
});

test('generated video pages have unique SEO metadata and no runtime errors', async ({ page }) => {
  const seen = new Set();
  for (const tool of generated) {
    const errors = [];
    const onError = error => errors.push(error.message);
    page.on('pageerror', onError);
    const response = await page.goto(tool.pageUrl);
    expect(response.status()).toBe(200);
    expect(await page.title()).toBe(tool.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', tool.description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', tool.pageUrl.replace(/^\//, 'https://letitedit.com/'));
    await expect(page.locator('h1')).toHaveText(tool.h1);
    await expect(page.locator('nav.breadcrumbs')).toBeVisible();
    await expect(page.locator('.faq-item').first()).toBeVisible();
    expect(seen.has(tool.title), `${tool.slug} title is duplicated`).toBe(false);
    seen.add(tool.title);
    expect(errors, `${tool.slug} threw a browser error`).toEqual([]);
    page.off('pageerror', onError);
  }
});

test('video workspaces expose touch-sized controls and no overflow on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const tool of generated) {
    await page.goto(tool.pageUrl);
    await expect(page.locator('.workspace')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('.video-controls button, .video-controls input, .video-controls select'));
      const small = controls.filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.height > 0 && rect.height < 32;
      }).map(node => node.id || node.tagName);
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        small
      };
    });
    expect(metrics.overflow, `${tool.slug} overflows at 320px`).toBeLessThanOrEqual(0);
    expect(metrics.small, `${tool.slug} has tiny controls`).toEqual([]);
  }
});
