/* Image Editor — panel wiring, image operations, export, file loading, init */

const ADJ = [
  ['brightness', 'adjBrightness', 'adjBrightnessVal'],
  ['contrast', 'adjContrast', 'adjContrastVal'],
  ['saturation', 'adjSaturation', 'adjSaturationVal'],
  ['blur', 'adjBlur', 'adjBlurVal'],
  ['grayscale', 'adjGrayscale', 'adjGrayscaleVal'],
  ['sepia', 'adjSepia', 'adjSepiaVal'],
  ['hue', 'adjHue', 'adjHueVal']
];

function segControl(id, onChange) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...el.querySelectorAll('button')].forEach((x) => x.classList.toggle('active', x === b));
    onChange(b.dataset.value, b);
  });
}

function buildStickers() {
  const g = $('stickerGrid');
  g.innerHTML = '';
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    if (em === state.options.sticker.emoji) b.classList.add('active');
    b.addEventListener('click', () => {
      state.options.sticker.emoji = em;
      [...g.children].forEach((c) => c.classList.toggle('active', c === b));
    });
    g.appendChild(b);
  });
}

function highlightPreset(i) {
  [...$('filterPresets').children].forEach((c, idx) => c.classList.toggle('active', idx === i));
}

function buildPresets() {
  const g = $('filterPresets');
  g.innerHTML = '';
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    b.addEventListener('click', () => {
      state.adjustments = Object.assign({}, DEFAULT_ADJ, p.adj);
      syncAdjustUI();
      highlightPreset(i);
      render();
      commit();
    });
    g.appendChild(b);
  });
  highlightPreset(0);
}

function syncAdjustUI() {
  for (const [key, slider, label] of ADJ) {
    $(slider).value = state.adjustments[key];
    $(label).textContent = state.adjustments[key];
  }
}

function currentTextLayer() {
  const l = selectedLayer();
  return l && l.type === 'text' ? l : null;
}

function loadTextFields(l) {
  $('textValue').value = l.text;
  $('textFont').value = l.font;
  $('textSize').value = l.size;
  $('textSizeVal').textContent = l.size;
  $('textColor').value = l.color;
  $('textStyle').querySelector('[data-value="bold"]').classList.toggle('active', !!l.bold);
  $('textStyle').querySelector('[data-value="italic"]').classList.toggle('active', !!l.italic);
}

function updateSelectionUI() {
  const l = selectedLayer();
  const has = !!l;
  $('noSelection').hidden = has;
  $('selFields').hidden = !has;
  if (has) {
    $('selName').value = l.name || '';
    const op = Math.round((l.opacity == null ? 1 : l.opacity) * 100);
    $('selOpacity').value = op;
    $('selOpacityVal').textContent = op;
    const deg = Math.round(rad2deg(l.rotation));
    $('selRot').value = clamp(deg, -180, 180);
    $('selRotVal').textContent = deg;
    if (l.type === 'text') loadTextFields(l);
  }
  updateLayerButtons();
}

function syncSelUI() {
  const l = selectedLayer();
  if (!l) return;
  const op = Math.round((l.opacity == null ? 1 : l.opacity) * 100);
  $('selOpacity').value = op;
  $('selOpacityVal').textContent = op;
  const deg = Math.round(rad2deg(l.rotation));
  $('selRot').value = clamp(deg, -180, 180);
  $('selRotVal').textContent = deg;
}

function moveLayer(dir) {
  const l = selectedLayer();
  if (!l) return;
  const i = state.layers.indexOf(l);
  const j = i + dir;
  if (j < 0 || j >= state.layers.length) return;
  state.layers.splice(i, 1);
  state.layers.splice(j, 0, l);
  buildLayers();
  render();
  commit();
}

function duplicateLayer() {
  const l = selectedLayer();
  if (!l) return;
  const c = deepClone(l);
  c.id = uid();
  c.cx += 18;
  c.cy += 18;
  c.name = (l.name || l.type) + ' copy';
  state.layers.push(c);
  state.selectedId = c.id;
  buildLayers();
  updateSelectionUI();
  render();
  commit();
}

/* ------------------------------ image operations ------------------------------ */
function syncResizeFields() {
  if (!state.loaded) return;
  $('rsW').value = state.width;
  $('rsH').value = state.height;
}

function applyResize() {
  if (!state.loaded) return;
  let w = parseInt($('rsW').value, 10);
  let h = parseInt($('rsH').value, 10);
  if (!w || !h) { toast('Enter a width and height'); return; }
  w = clamp(w, 1, 16000);
  h = clamp(h, 1, 16000);
  const sx = w / state.width, sy = h / state.height;
  const nb = document.createElement('canvas');
  nb.width = w; nb.height = h;
  const g = nb.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(state.base, 0, 0, w, h);
  state.base = nb;
  for (const l of state.layers) { l.cx *= sx; l.cy *= sy; l.scale *= (sx + sy) / 2; }
  state.width = w; state.height = h;
  resizeCanvases();
  render(); commit(); syncResizeFields(); fitView();
  toast('Resized to ' + w + ' × ' + h);
}

function rotateBase(cw) {
  if (!state.loaded) return;
  const W = state.width, H = state.height;
  const nb = document.createElement('canvas');
  nb.width = H; nb.height = W;
  const g = nb.getContext('2d');
  if (cw) { g.translate(H, 0); g.rotate(Math.PI / 2); }
  else { g.translate(0, W); g.rotate(-Math.PI / 2); }
  g.drawImage(state.base, 0, 0);
  state.base = nb;
  for (const l of state.layers) {
    const cx = l.cx;
    if (cw) { l.cx = H - l.cy; l.cy = cx; l.rotation += Math.PI / 2; }
    else { l.cx = l.cy; l.cy = W - cx; l.rotation -= Math.PI / 2; }
  }
  state.width = H; state.height = W;
  resizeCanvases();
  render(); commit(); syncResizeFields(); fitView();
}

function flipBase(horiz) {
  if (!state.loaded) return;
  const W = state.width, H = state.height;
  const nb = document.createElement('canvas');
  nb.width = W; nb.height = H;
  const g = nb.getContext('2d');
  if (horiz) { g.translate(W, 0); g.scale(-1, 1); } else { g.translate(0, H); g.scale(1, -1); }
  g.drawImage(state.base, 0, 0);
  state.base = nb;
  for (const l of state.layers) {
    if (horiz) { l.cx = W - l.cx; l.rotation = -l.rotation; l.flipX = !l.flipX; }
    else { l.cy = H - l.cy; l.rotation = -l.rotation; l.flipY = !l.flipY; }
  }
  render(); commit();
}

function flatten() {
  if (!state.loaded) return;
  const nb = document.createElement('canvas');
  nb.width = state.width; nb.height = state.height;
  const g = nb.getContext('2d');
  g.filter = cssFilter(state.adjustments);
  g.drawImage(state.base, 0, 0);
  g.filter = 'none';
  for (const l of state.layers) if (l.visible !== false) drawLayer(g, l);
  state.base = nb;
  state.adjustments = Object.assign({}, DEFAULT_ADJ);
  state.layers = [];
  state.selectedId = null;
  syncAdjustUI();
  highlightPreset(0);
  buildLayers();
  updateSelectionUI();
  render(); commit();
  toast('Layers flattened');
}

/* ------------------------------ export ------------------------------ */
function download() {
  if (!state.loaded) return;
  const fmt = $('fmt').value;
  const q = parseInt($('quality').value, 10) / 100;
  const nb = document.createElement('canvas');
  nb.width = state.width; nb.height = state.height;
  const g = nb.getContext('2d');
  if (fmt === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, nb.width, nb.height); }
  g.filter = cssFilter(state.adjustments);
  g.drawImage(state.base, 0, 0);
  g.filter = 'none';
  for (const l of state.layers) if (l.visible !== false) drawLayer(g, l);
  nb.toBlob((blob) => {
    if (!blob) { toast('Could not export this image'); return; }
    const ext = fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = baseName(state.name) + '-edited.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Saved ' + ext.toUpperCase() + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB');
  }, fmt, q);
}

/* ------------------------------ files ------------------------------ */
function loadFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name)) {
    toast('That does not look like an image');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); initFromImage(img, file.name); };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not open that image'); };
  img.src = url;
}

function initFromImage(img, name) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) { toast('Could not read that image'); return; }
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  base.getContext('2d').drawImage(img, 0, 0);

  state.original = base;
  state.name = name || 'image';
  state.width = w; state.height = h;
  state.base = base;
  state.adjustments = Object.assign({}, DEFAULT_ADJ);
  state.layers = [];
  state.selectedId = null;
  state.crop = null;
  state.bgSource = null;
  state.history = [];
  state.hIndex = -1;
  state.loaded = true;

  $('emptyState').hidden = true;
  wrap.hidden = false;
  resizeCanvases();
  fitView();
  render();
  syncAdjustUI();
  highlightPreset(0);
  buildLayers();
  updateSelectionUI();
  updateDocMeta();
  syncResizeFields();
  commit();
  updateHistoryButtons();
  $('btnReset').disabled = false;
  $('btnDownload').disabled = false;
  setTool('select');
  toast('Image loaded · ' + w + ' × ' + h);
}

function resetAll() {
  if (!state.original) return;
  initFromImage(state.original, state.name);
  toast('Reset to the original image');
}

/* ------------------------------ wiring ------------------------------ */
function init() {
  buildStickers();
  buildPresets();
  syncAdjustUI();
  updateSelectionUI();
  updateHistoryButtons();
  updateBgSwatch();
  $('qualityWrap').style.display = $('fmt').value === 'image/png' ? 'none' : '';

  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  document.querySelectorAll('.panel-tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.panel-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    ['tool', 'adjust', 'image', 'layers'].forEach((p) => { $('pane-' + p).hidden = p !== b.dataset.pane; });
  }));

  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnReset').addEventListener('click', resetAll);
  $('btnDownload').addEventListener('click', download);
  $('btnOpen').addEventListener('click', () => $('fileInput').click());
  $('btnPick').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = '';
  });

  $('fmt').addEventListener('change', () => {
    $('qualityWrap').style.display = $('fmt').value === 'image/png' ? 'none' : '';
  });
  $('quality').addEventListener('input', () => { $('qualityVal').textContent = $('quality').value; });

  $('zOut').addEventListener('click', () => setZoom(state.zoom / 1.2));
  $('zIn').addEventListener('click', () => setZoom(state.zoom * 1.2));
  $('zRange').addEventListener('input', () => setZoom(+$('zRange').value / 100));
  $('zFit').addEventListener('click', fitView);
  $('z100').addEventListener('click', () => { state.panX = 0; state.panY = 0; setZoom(1); });

  $('cropApply').addEventListener('click', applyCrop);
  $('cropCancel').addEventListener('click', () => { state.crop = null; renderOverlay(); });

  segControl('drawMode', (v) => { state.options.draw.mode = v; });
  $('drawColor').addEventListener('input', () => { state.options.draw.color = $('drawColor').value; });
  $('drawSize').addEventListener('input', () => {
    state.options.draw.size = +$('drawSize').value;
    $('drawSizeVal').textContent = $('drawSize').value;
  });

  $('textValue').addEventListener('input', () => {
    const v = $('textValue').value;
    state.options.text.value = v;
    const l = currentTextLayer();
    if (l) { l.text = v; render(); }
  });
  $('textValue').addEventListener('change', () => { if (currentTextLayer()) commit(); });
  $('textFont').addEventListener('change', () => {
    const v = $('textFont').value;
    state.options.text.font = v;
    const l = currentTextLayer();
    if (l) { l.font = v; render(); commit(); }
  });
  $('textSize').addEventListener('input', () => {
    const v = +$('textSize').value;
    state.options.text.size = v;
    $('textSizeVal').textContent = v;
    const l = currentTextLayer();
    if (l) { l.size = v; render(); }
  });
  $('textSize').addEventListener('change', () => { if (currentTextLayer()) commit(); });
  $('textColor').addEventListener('input', () => {
    const v = $('textColor').value;
    state.options.text.color = v;
    const l = currentTextLayer();
    if (l) { l.color = v; render(); }
  });
  $('textColor').addEventListener('change', () => { if (currentTextLayer()) commit(); });
  $('textStyle').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.classList.toggle('active');
    const on = b.classList.contains('active');
    const key = b.dataset.value;
    state.options.text[key] = on;
    const l = currentTextLayer();
    if (l) { l[key] = on; render(); commit(); }
  });
  $('btnAddText').addEventListener('click', () => {
    if (!state.loaded) { toast('Open an image first'); return; }
    addTextAt({ x: state.width / 2, y: state.height / 2 });
  });

  segControl('shapeType', (v) => { state.options.shape.type = v; });
  $('shapeStroke').addEventListener('input', () => { state.options.shape.stroke = $('shapeStroke').value; });
  $('shapeWidth').addEventListener('input', () => {
    state.options.shape.width = +$('shapeWidth').value;
    $('shapeWidthVal').textContent = $('shapeWidth').value;
  });
  $('shapeFillOn').addEventListener('change', () => { state.options.shape.fillOn = $('shapeFillOn').checked; });
  $('shapeFill').addEventListener('input', () => { state.options.shape.fill = $('shapeFill').value; });

  $('stickerSize').addEventListener('input', () => {
    state.options.sticker.size = +$('stickerSize').value;
    $('stickerSizeVal').textContent = $('stickerSize').value;
  });

  $('bgTolerance').addEventListener('input', () => {
    state.options.bg.tolerance = +$('bgTolerance').value;
    $('bgToleranceVal').textContent = $('bgTolerance').value;
    applyBgRemoval();
  });
  $('bgTolerance').addEventListener('change', () => { if (state.options.bg.color) commit(); });
  $('bgFillMode').addEventListener('change', () => {
    state.options.bg.fillMode = $('bgFillMode').value;
    applyBgRemoval();
    if (state.options.bg.color) commit();
  });
  $('bgFillColor').addEventListener('input', () => {
    state.options.bg.fillColor = $('bgFillColor').value;
    applyBgRemoval();
  });
  $('bgFillColor').addEventListener('change', () => { if (state.options.bg.color) commit(); });
  $('bgReset').addEventListener('click', () => {
    if (!state.bgSource) return;
    state.base = cloneCanvas(state.bgSource);
    state.options.bg.color = null;
    updateBgSwatch();
    render();
    commit();
  });

  $('panReset').addEventListener('click', () => { state.panX = 0; state.panY = 0; applyView(); });

  for (const [key, slider, label] of ADJ) {
    $(slider).addEventListener('input', () => {
      state.adjustments[key] = +$(slider).value;
      $(label).textContent = $(slider).value;
      highlightPreset(-1);
      render();
    });
    $(slider).addEventListener('change', () => { commit(); });
  }
  $('adjReset').addEventListener('click', () => {
    state.adjustments = Object.assign({}, DEFAULT_ADJ);
    syncAdjustUI();
    highlightPreset(0);
    render();
    commit();
  });

  $('btnResize').addEventListener('click', applyResize);
  $('btnRotL').addEventListener('click', () => rotateBase(false));
  $('btnRotR').addEventListener('click', () => rotateBase(true));
  $('btnFlipH').addEventListener('click', () => flipBase(true));
  $('btnFlipV').addEventListener('click', () => flipBase(false));
  $('btnFlatten').addEventListener('click', flatten);
  $('rsW').addEventListener('input', () => {
    if ($('rsLock').checked && state.loaded) {
      const w = +$('rsW').value;
      if (w > 0) $('rsH').value = Math.max(1, Math.round((w * state.height) / state.width));
    }
  });
  $('rsH').addEventListener('input', () => {
    if ($('rsLock').checked && state.loaded) {
      const h = +$('rsH').value;
      if (h > 0) $('rsW').value = Math.max(1, Math.round((h * state.width) / state.height));
    }
  });

  $('layerUp').addEventListener('click', () => moveLayer(1));
  $('layerDown').addEventListener('click', () => moveLayer(-1));
  $('layerDel').addEventListener('click', () => { const l = selectedLayer(); if (l) removeLayer(l.id); });

  $('selName').addEventListener('input', () => {
    const l = selectedLayer();
    if (l) { l.name = $('selName').value; buildLayers(); }
  });
  $('selOpacity').addEventListener('input', () => {
    const l = selectedLayer();
    if (l) { l.opacity = +$('selOpacity').value / 100; $('selOpacityVal').textContent = $('selOpacity').value; render(); }
  });
  $('selOpacity').addEventListener('change', () => { if (selectedLayer()) commit(); });
  $('selRot').addEventListener('input', () => {
    const l = selectedLayer();
    if (l) { l.rotation = deg2rad(+$('selRot').value); $('selRotVal').textContent = $('selRot').value; render(); }
  });
  $('selRot').addEventListener('change', () => { if (selectedLayer()) commit(); });
  $('selFront').addEventListener('click', () => moveLayer(1));
  $('selBack').addEventListener('click', () => moveLayer(-1));
  $('selDup').addEventListener('click', duplicateLayer);
  $('selDel').addEventListener('click', () => { const l = selectedLayer(); if (l) removeLayer(l.id); });

  /* keyboard */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); download(); return; }
    if (k === 'delete' || k === 'backspace') {
      if (state.selectedId) { e.preventDefault(); removeLayer(state.selectedId); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'v') setTool('select');
    else if (k === 'c') setTool('crop');
    else if (k === 'b') setTool('draw');
    else if (k === 't') setTool('text');
    else if (k === 's') setTool('shape');
    else if (k === 'k') setTool('sticker');
    else if (k === 'w') setTool('removebg');
    else if (k === 'h') setTool('pan');
    else if (k === 'escape') { state.selectedId = null; state.crop = null; updateSelectionUI(); buildLayers(); render(); }
    else if (k === '+' || k === '=') setZoom(state.zoom * 1.2);
    else if (k === '-') setZoom(state.zoom / 1.2);
    else if (k === '0') fitView();
  });

  /* drag & drop + paste */
  ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => {
    e.preventDefault();
    $('dropOverlay').hidden = false;
  }));
  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) $('dropOverlay').hidden = true;
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    $('dropOverlay').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.indexOf('image') === 0) {
        const f = it.getAsFile();
        if (f) { loadFile(f); e.preventDefault(); }
        break;
      }
    }
  });

  wrap.hidden = true;
  updateDocMeta();
  updateCanvasSizeLabel();
  setTool('select');
}

init();
