const { test, expect } = require('@playwright/test');
const fs = require('fs');

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function gotoThumbnail(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto('/thumbnail-generator/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-image-engine="thumbnail-generator"]')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => Boolean(window.ThumbnailEditor))).toBe(true);
}

async function editorState(page) {
  return page.evaluate(() => window.ThumbnailEditor.state());
}

async function canvasSize(page) {
  return page.locator('#image-preview').evaluate(canvas => ({
    width: canvas.width,
    height: canvas.height
  }));
}

async function setInput(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function makePng(page, color, width = 80, height = 60) {
  const dataUrl = await page.evaluate(({ color, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png');
  }, { color, width, height });
  return {
    name: `${color.replace('#', '')}-${width}x${height}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
  };
}

async function downloadBuffer(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(selector).click()
  ]);
  const file = await download.path();
  return { name: download.suggestedFilename(), buffer: fs.readFileSync(file) };
}

async function inspectImage(page, buffer, mime, points) {
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  return page.evaluate(async ({ dataUrl, points }) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      pixels: points.map(point => Array.from(ctx.getImageData(point[0], point[1], 1, 1).data))
    };
  }, { dataUrl, points });
}

async function canvasPixel(page, x, y) {
  return page.locator('#image-preview').evaluate((canvas, point) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return Array.from(ctx.getImageData(point.x, point.y, 1, 1).data);
  }, { x, y });
}

async function mapCanvasPoint(page, x, y) {
  return page.locator('#tg-overlay').evaluate((overlay, point) => {
    const rect = overlay.getBoundingClientRect();
    return {
      x: rect.left + point.x / overlay.width * rect.width,
      y: rect.top + point.y / overlay.height * rect.height
    };
  }, { x, y });
}

async function handlePoint(page, kind) {
  const state = await editorState(page);
  const layer = state.layers.find(item => item.id === state.selectedId);
  if (!layer) throw new Error('No layer is selected.');
  const box = {
    cx: layer.x / 100 * state.width,
    cy: layer.y / 100 * state.height,
    w: layer.w / 100 * state.width,
    h: layer.h / 100 * state.height,
    rotation: layer.rotation || 0
  };
  const handleSize = Math.max(7, Math.min(18, Math.min(state.width, state.height) / 80));
  const angle = box.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const locals = {
    nw: [-box.w / 2, -box.h / 2],
    ne: [box.w / 2, -box.h / 2],
    se: [box.w / 2, box.h / 2],
    sw: [-box.w / 2, box.h / 2],
    rotate: [0, -box.h / 2 - handleSize * 2]
  };
  const local = locals[kind];
  return mapCanvasPoint(page,
    box.cx + local[0] * cos - local[1] * sin,
    box.cy + local[0] * sin + local[1] * cos);
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

function colorDistance(a, b) {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2])
  );
}

test('thumbnail maker preserves Unicode, detects scripts and resolves bidi direction', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoThumbnail(page);

  const cases = [
    ['العربية اختبار', 'arabic', 'rtl'],
    ['עברית בדיקה', 'hebrew', 'rtl'],
    ['हिन्दी परीक्षण', 'devanagari', 'ltr'],
    ['中文测试', 'han', 'ltr'],
    ['日本語テスト', 'japanese', 'ltr'],
    ['한국어 테스트', 'korean', 'ltr'],
    ['Кириллица тест', 'cyrillic', 'ltr'],
    ['ภาษาไทย', 'thai', 'ltr'],
    ['தமிழ் சோதனை', 'tamil', 'ltr']
  ];

  for (const [text, script, direction] of cases) {
    await page.fill('#tg-text', text);
    await expect.poll(async () => (await editorState(page)).layers[0].text).toBe(text);
    const state = await editorState(page);
    expect(state.layers[0].direction, `${script} direction control`).toBe('auto');
    const fontLabels = (await page.locator('#tg-font option').allTextContents()).join(' ');
    expect(fontLabels, `${script} font suggestion`).toContain(script);
    const resolved = await page.evaluate(({ value, requested }) =>
      window.ThumbnailCore.resolveDirection(value, requested),
    { value: state.layers[0].text, requested: state.layers[0].direction });
    expect(resolved, `${script} resolved direction`).toBe(direction);
  }

  const mixed = 'Offer ٥٠٪ خصم';
  await page.fill('#tg-text', mixed);
  await page.selectOption('#tg-direction', 'rtl');
  let state = await editorState(page);
  expect(state.layers[0].text).toBe(mixed);
  expect(state.layers[0].direction).toBe('rtl');
  expect(await page.evaluate(value => window.ThumbnailCore.resolveDirection(value, 'rtl'), mixed)).toBe('rtl');

  await page.selectOption('#tg-direction', 'ltr');
  state = await editorState(page);
  expect(state.layers[0].text).toBe(mixed);
  expect(state.layers[0].direction).toBe('ltr');
  expect(await page.evaluate(value => window.ThumbnailCore.resolveDirection(value, 'ltr'), mixed)).toBe('ltr');
  expect(errors).toEqual([]);
});

test('thumbnail maker handles multiple uploads, independent layers and pointer transforms', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoThumbnail(page);

  const red = await makePng(page, '#ff0000');
  const blue = await makePng(page, '#0000ff');
  await page.setInputFiles('#image-file', [red, blue]);
  await expect.poll(async () => {
    const state = await editorState(page);
    return `${state.images.length}:${state.layers.length}`;
  }).toBe('2:3');
  let state = await editorState(page);
  expect(state.layers.filter(layer => layer.type === 'image')).toHaveLength(2);
  expect(state.images.map(image => image.name)).toEqual([red.name, blue.name]);

  /* Configure the next layer without editing the currently selected upload. */
  const emptyPoint = await mapCanvasPoint(page, 4, 4);
  await page.mouse.click(emptyPoint.x, emptyPoint.y);
  await expect.poll(async () => (await editorState(page)).selectedId).toBe(null);

  await page.selectOption('#tg-layer-type', 'shape');
  await page.selectOption('#tg-shape', 'star');
  await setInput(page, '#tg-layer-name', 'Star badge');
  await page.click('#tg-layer-add');
  await page.locator('#tg-stickers [data-value="🎉"]').click();
  state = await editorState(page);
  expect(state.layers.map(layer => layer.type)).toEqual(['text', 'image', 'image', 'shape', 'sticker']);
  expect(state.layers.find(layer => layer.name === 'Star badge').shape).toBe('star');

  const beforeDuplicate = state.layers.length;
  await page.click('#tg-layer-duplicate');
  await expect.poll(async () => (await editorState(page)).layers.length).toBe(beforeDuplicate + 1);
  state = await editorState(page);
  const copyId = state.selectedId;
  expect(state.layers.find(layer => layer.id === copyId).name).toBe('Sticker 🎉 copy');

  await page.click('#tg-undo');
  await expect.poll(async () => (await editorState(page)).layers.length).toBe(beforeDuplicate);
  await page.click('#tg-redo');
  await expect.poll(async () => (await editorState(page)).layers.some(layer => layer.id === copyId)).toBe(true);

  await setInput(page, '#tg-layer-opacity', 55);
  state = await editorState(page);
  expect(state.layers.find(layer => layer.id === copyId).opacity).toBeCloseTo(0.55, 2);

  let row = page.locator(`#tg-layers .tg-layer-row[data-layer-id="${copyId}"]`);
  await row.getByRole('button', { name: /^Hide / }).click();
  state = await editorState(page);
  expect(state.layers.find(layer => layer.id === copyId).visible).toBe(false);
  row = page.locator(`#tg-layers .tg-layer-row[data-layer-id="${copyId}"]`);
  await row.getByRole('button', { name: /^Lock / }).click();
  state = await editorState(page);
  expect(state.layers.find(layer => layer.id === copyId).locked).toBe(true);

  const namesBeforeReorder = (await editorState(page)).layers.map(layer => layer.name);
  await page.locator('#tg-layers .tg-layer-row').first()
    .getByRole('button', { name: /^Move .* forward$/ }).click();
  await expect.poll(async () => (await editorState(page)).layers[1].name).toBe(namesBeforeReorder[0]);

  /* Delete the duplicate, not whichever layer a reorder button selected. */
  await page.locator(`#tg-layers .tg-layer-row[data-layer-id="${copyId}"]`)
    .getByRole('button', { name: /^Load / }).click();
  const beforeDelete = (await editorState(page)).layers.length;
  await page.click('#tg-layer-delete');
  await expect.poll(async () => (await editorState(page)).layers.length).toBe(beforeDelete - 1);

  /* Isolate the text layer so pointer hit-testing and handles are unambiguous. */
  state = await editorState(page);
  for (const layer of state.layers) {
    if (layer.name === 'Headline' || layer.visible === false) continue;
    const target = page.locator(`#tg-layers .tg-layer-row[data-layer-id="${layer.id}"]`);
    if (await target.getByRole('button', { name: /^Hide / }).count()) {
      await target.getByRole('button', { name: /^Hide / }).click();
    }
  }
  await page.locator('#tg-layers .tg-layer-row').filter({ hasText: 'Headline' })
    .getByRole('button', { name: /^Load / }).click();

  state = await editorState(page);
  const headline = state.layers.find(layer => layer.name === 'Headline');
  const center = await mapCanvasPoint(page,
    headline.x / 100 * state.width,
    headline.y / 100 * state.height);
  await drag(page, center, { x: center.x + 30, y: center.y + 10 });
  state = await editorState(page);
  const moved = state.layers.find(layer => layer.id === headline.id);
  expect(moved.x).toBeGreaterThan(headline.x + 2);
  expect(moved.y).toBeGreaterThan(headline.y + 1);

  const seBefore = await handlePoint(page, 'se');
  await drag(page, seBefore, { x: seBefore.x - 55, y: seBefore.y - 30 });
  state = await editorState(page);
  const resized = state.layers.find(layer => layer.id === headline.id);
  expect(resized.w).toBeLessThan(moved.w - 1);
  expect(resized.h).toBeLessThan(moved.h - 1);

  const rotateHandle = await handlePoint(page, 'rotate');
  const centerAfter = await mapCanvasPoint(page,
    resized.x / 100 * state.width,
    resized.y / 100 * state.height);
  await drag(page, rotateHandle, { x: centerAfter.x + 150, y: centerAfter.y });
  state = await editorState(page);
  expect(Math.abs(state.layers.find(layer => layer.id === headline.id).rotation)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('thumbnail maker applies every preset, custom sizes and all original templates', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoThumbnail(page);

  const presets = await page.evaluate(() => window.ThumbnailCore.PRESETS.map(preset => ({
    id: preset.id, width: preset.width, height: preset.height
  })));
  const options = await page.locator('#tg-preset option').evaluateAll(nodes => nodes.map(node => node.value));
  expect(options).toEqual(presets.map(preset => preset.id));

  for (const preset of presets) {
    await page.selectOption('#tg-preset', preset.id);
    await expect.poll(async () => {
      const size = await canvasSize(page);
      return `${size.width}x${size.height}`;
    }).toBe(`${preset.width}x${preset.height}`);
    const state = await editorState(page);
    expect(state.preset).toBe(preset.id);
  }

  await page.selectOption('#tg-preset', 'custom');
  await setInput(page, '#tg-width', 936);
  await setInput(page, '#tg-height', 1568);
  await expect.poll(async () => {
    const size = await canvasSize(page);
    return `${size.width}x${size.height}`;
  }).toBe('936x1568');
  expect((await editorState(page)).preset).toBe('custom');

  const red = await makePng(page, '#ff0000');
  const blue = await makePng(page, '#0000ff');
  await page.setInputFiles('#image-file', [red, blue]);
  await expect.poll(async () => (await editorState(page)).images.length).toBe(2);

  for (const name of ['bold', 'quote', 'badge', 'split', 'global']) {
    await page.click(`#tg-templates [data-value="${name}"]`);
    await expect.poll(async () => (await editorState(page)).layers.length).toBeGreaterThan(0);
    const state = await editorState(page);
    expect(state.images, `${name} template keeps uploaded photos`).toHaveLength(2);
    expect(state.layers.some(layer => layer.type === 'text'), `${name} template has editable text`).toBe(true);
  }

  await page.click('#tg-templates [data-value="split"]');
  const split = await editorState(page);
  const imageIds = split.images.map(image => image.id);
  const imageLayers = split.layers.filter(layer => layer.type === 'image');
  expect(imageLayers).toHaveLength(2);
  for (const layer of imageLayers) expect(imageIds).toContain(layer.srcId);
  expect(split.layers.some(layer => layer.name === 'Split title' && layer.type === 'text')).toBe(true);
  expect(errors).toEqual([]);
});

test('thumbnail maker exports PNG, JPG and WebP at native size with preview parity', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoThumbnail(page);

  await page.locator('#tg-layers .tg-layer-row').first()
    .getByRole('button', { name: /^Hide / }).click();
  await setInput(page, '#tg-bg-type', 'solid');
  await setInput(page, '#tg-color1', '#123456');
  await page.check('#tg-guides');
  await page.check('#tg-safe-guides');

  const state = await editorState(page);
  const point = [Math.round(state.width / 3), Math.round(state.height / 2)];
  const previewPixel = await canvasPixel(page, point[0], point[1]);
  expect(previewPixel.slice(0, 3)).toEqual([0x12, 0x34, 0x56]);

  for (const format of ['png', 'jpeg', 'webp']) {
    await page.selectOption('#tg-format', format);
    const download = await downloadBuffer(page, '#image-download');
    const extension = format === 'jpeg' ? 'jpg' : format;
    expect(download.name, `${format} filename`).toMatch(new RegExp(`\\.${extension}$`));
    const inspected = await inspectImage(page, download.buffer, MIME[format], [point, [1, 1]]);
    expect([inspected.width, inspected.height], `${format} dimensions`).toEqual([state.width, state.height]);
    if (format === 'png') {
      expect(inspected.pixels[0], 'lossless PNG matches preview canvas').toEqual(previewPixel);
    } else {
      expect(colorDistance(inspected.pixels[0], previewPixel), `${format} colour parity`).toBeLessThan(24);
    }
  }
  expect(errors).toEqual([]);
});

test.describe('thumbnail maker mobile canvas-first workflow', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });

  test('keeps a large native canvas and switches between preview and controls', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoThumbnail(page);

    const workspace = page.locator('.mw-root');
    await expect(workspace).toHaveAttribute('data-mw-mode', 'preview');
    await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
    await expect(page.locator('.mw-root .mw-controls').first()).toBeHidden();
    const previewHeight = (await page.locator('.mw-root .mw-preview').boundingBox()).height;
    expect(previewHeight).toBeGreaterThan(150);

    const before = await editorState(page);
    await page.locator('.mw-toolbar [data-mw-mode="controls"]').click();
    await expect(workspace).toHaveAttribute('data-mw-mode', 'controls');
    await expect(page.locator('.mw-root .mw-controls').first()).toBeVisible();
    await page.locator('#tg-stickers [data-value="★"]').click();
    let state = await editorState(page);
    expect(state.layers.length).toBe(before.layers.length + 1);

    await page.locator('.mw-toolbar [data-mw-mode="preview"]').click();
    await expect(page.locator('.mw-root .mw-preview')).toBeVisible();
    state = await editorState(page);
    expect([state.width, state.height]).toEqual([before.width, before.height]);

    await page.locator('.mw-toolbar [data-mw-action="zoom-in"]').click();
    await expect.poll(async () => (await editorState(page)).zoom).toBe(1.25);
    expect(await page.locator('#tg-stage-inner').getAttribute('style')).toContain('width: 125%');
    await page.locator('.mw-toolbar [data-mw-action="fit"]').click();
    await expect.poll(async () => (await editorState(page)).zoom).toBe(1);
    expect(await page.locator('#tg-stage-inner').getAttribute('style')).toContain('width: 100%');
    await expect(page.locator('#tg-overlay')).toHaveCSS('touch-action', 'none');

    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
