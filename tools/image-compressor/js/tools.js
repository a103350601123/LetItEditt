/* Image Editor — tools, pointer interaction, crop and background removal */

function hitLayer(l, p) {
  if (l.visible === false) return false;
  const q = worldToLocal(l, p.x, p.y);
  const b = localBounds(l);
  const pad = 4 / l.scale;
  return q.x >= b.x - pad && q.x <= b.x + b.w + pad && q.y >= b.y - pad && q.y <= b.y + b.h + pad;
}

function topLayerAt(p) {
  for (let i = state.layers.length - 1; i >= 0; i--) if (hitLayer(state.layers[i], p)) return state.layers[i];
  return null;
}

function hitHandle(l, p) {
  const b = localBounds(l);
  const corners = [
    localToWorld(l, b.x, b.y), localToWorld(l, b.x + b.w, b.y),
    localToWorld(l, b.x + b.w, b.y + b.h), localToWorld(l, b.x, b.y + b.h)
  ];
  const r = 11 / state.zoom;
  for (const c of corners) if (Math.hypot(p.x - c.x, p.y - c.y) <= r) return 'scale';
  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const rh = rotateHandlePos(l, topMid);
  if (Math.hypot(p.x - rh.x, p.y - rh.y) <= r) return 'rotate';
  return null;
}

/* ------------------------------ pointer ------------------------------ */
function onDown(e) {
  if (!state.loaded) return;
  const p = toCanvas(e);

  if (state.tool === 'select') {
    const l = selectedLayer();
    if (l) {
      const h = hitHandle(l, p);
      if (h === 'rotate') {
        drag = { mode: 'rotate', l, startAngle: Math.atan2(p.y - l.cy, p.x - l.cx), startRot: l.rotation, dirty: false };
        e.preventDefault(); return;
      }
      if (h === 'scale') {
        drag = { mode: 'scale', l, startDist: Math.max(1, Math.hypot(p.x - l.cx, p.y - l.cy)), startScale: l.scale, dirty: false };
        e.preventDefault(); return;
      }
    }
    const t = topLayerAt(p);
    if (t) {
      state.selectedId = t.id;
      updateSelectionUI(); buildLayers(); render();
      drag = { mode: 'move', l: t, last: p, dirty: false };
      e.preventDefault();
    } else {
      state.selectedId = null;
      updateSelectionUI(); buildLayers(); render();
    }
    return;
  }

  if (state.tool === 'crop') { startCrop(p); e.preventDefault(); return; }
  if (state.tool === 'draw') { startBrush(p); e.preventDefault(); return; }
  if (state.tool === 'text') {
    const t = topLayerAt(p);
    if (t && t.type === 'text') { state.selectedId = t.id; buildLayers(); updateSelectionUI(); render(); }
    else addTextAt(p);
    return;
  }
  if (state.tool === 'shape') { startShape(p); e.preventDefault(); return; }
  if (state.tool === 'sticker') {
    const t = topLayerAt(p);
    if (t && t.type === 'sticker') { state.selectedId = t.id; buildLayers(); updateSelectionUI(); render(); }
    else addStickerAt(p);
    return;
  }
  if (state.tool === 'removebg') { sampleBg(p); return; }
  if (state.tool === 'pan') {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
    wrap.classList.add('panning');
    e.preventDefault();
  }
}

function onMove(e) {
  if (!drag) return;
  const p = toCanvas(e);

  if (drag.mode === 'move') {
    const l = drag.l;
    l.cx += p.x - drag.last.x;
    l.cy += p.y - drag.last.y;
    drag.last = p;
    drag.dirty = true;
    render();
  } else if (drag.mode === 'scale') {
    const l = drag.l;
    const d = Math.hypot(p.x - l.cx, p.y - l.cy);
    l.scale = clamp(drag.startScale * (d / drag.startDist), 0.02, 20);
    drag.dirty = true;
    render(); syncSelUI();
  } else if (drag.mode === 'rotate') {
    const l = drag.l;
    const a = Math.atan2(p.y - l.cy, p.x - l.cx);
    l.rotation = drag.startRot + (a - drag.startAngle);
    drag.dirty = true;
    render(); syncSelUI();
  } else if (drag.mode === 'pan') {
    state.panX = drag.px + (e.clientX - drag.sx);
    state.panY = drag.py + (e.clientY - drag.sy);
    applyView();
  } else if (drag.mode === 'crop') {
    updateCrop(p, e);
  } else if (drag.mode === 'brush') {
    drag.l.points.push({ x: p.x - drag.l.cx, y: p.y - drag.l.cy });
    drag.dirty = true;
    render();
  } else if (drag.mode === 'shape') {
    updateShape(p, e);
  }
}

function onUp() {
  if (!drag) return;
  const mode = drag.mode;
  if (mode === 'shape') {
    finalizeShape();
    commit();
  } else if (mode === 'brush') {
    if (drag.dirty) commit();
  } else if (mode === 'move' || mode === 'scale' || mode === 'rotate') {
    if (drag.dirty) commit();
  } else if (mode === 'pan') {
    wrap.classList.remove('panning');
  }
  drag = null;
}

wrap.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);

/* ------------------------------ crop ------------------------------ */
function currentRatio() {
  const v = $('cropRatio').value;
  return v === 'free' ? 0 : parseFloat(v);
}

function rectFromDrag(origin, p, ratio, square) {
  let dx = p.x - origin.x, dy = p.y - origin.y;
  let w = Math.abs(dx), h = Math.abs(dy);
  const r = square ? 1 : ratio;
  if (r > 0) {
    if (h === 0 || w / h > r) h = w / r; else w = h * r;
  }
  const x = dx < 0 ? origin.x - w : origin.x;
  const y = dy < 0 ? origin.y - h : origin.y;
  return { x, y, w, h };
}

function cropHandleAt(c, p) {
  const r = 13 / state.zoom;
  for (const [n, x, y] of cropHandlePoints(c)) if (Math.hypot(p.x - x, p.y - y) <= r) return n;
  return null;
}

function startCrop(p) {
  const c = state.crop;
  if (c && c.w > 2 && c.h > 2) {
    const h = cropHandleAt(c, p);
    if (h) { drag = { mode: 'crop', kind: 'resize', handle: h, start: Object.assign({}, c) }; return; }
    if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
      drag = { mode: 'crop', kind: 'move', start: Object.assign({}, c), origin: p };
      return;
    }
  }
  drag = { mode: 'crop', kind: 'new', origin: p, ratio: currentRatio() };
  state.crop = { x: p.x, y: p.y, w: 0, h: 0 };
  renderOverlay();
}

function updateCrop(p, e) {
  if (drag.kind === 'new') {
    state.crop = rectFromDrag(drag.origin, p, drag.ratio, e.shiftKey);
  } else if (drag.kind === 'move') {
    const s = drag.start;
    let x = s.x + (p.x - drag.origin.x);
    let y = s.y + (p.y - drag.origin.y);
    x = clamp(x, 0, state.width - s.w);
    y = clamp(y, 0, state.height - s.h);
    state.crop = { x, y, w: s.w, h: s.h };
  } else {
    const s = drag.start;
    let x = s.x, y = s.y, w = s.w, h = s.h;
    const hd = drag.handle;
    if (hd.indexOf('n') >= 0) { y = p.y; h = s.y + s.h - p.y; }
    if (hd.indexOf('s') >= 0) { h = p.y - s.y; }
    if (hd.indexOf('w') >= 0) { x = p.x; w = s.x + s.w - p.x; }
    if (hd.indexOf('e') >= 0) { w = p.x - s.x; }
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    state.crop = { x, y, w, h };
  }
  renderOverlay();
}

function applyCrop() {
  const c = state.crop;
  if (!c || c.w < 2 || c.h < 2) { toast('Draw a crop box first'); return; }
  const x = Math.round(clamp(c.x, 0, state.width));
  const y = Math.round(clamp(c.y, 0, state.height));
  const w = Math.round(clamp(c.w, 1, state.width - x));
  const h = Math.round(clamp(c.h, 1, state.height - y));
  const nb = document.createElement('canvas');
  nb.width = w; nb.height = h;
  nb.getContext('2d').drawImage(state.base, x, y, w, h, 0, 0, w, h);
  state.base = nb;
  state.width = w; state.height = h;
  for (const l of state.layers) { l.cx -= x; l.cy -= y; }
  state.crop = null;
  resizeCanvases();
  render(); commit();
  toast('Cropped to ' + w + ' × ' + h);
}

/* ------------------------------ creating layers ------------------------------ */
function addTextAt(p) {
  const o = state.options.text;
  const l = {
    id: uid(), type: 'text', name: 'Text', visible: true, opacity: 1,
    cx: p.x, cy: p.y, scale: 1, rotation: 0, flipX: false, flipY: false,
    text: o.value || 'Text', font: o.font, size: o.size, color: o.color, bold: o.bold, italic: o.italic
  };
  state.layers.push(l);
  state.selectedId = l.id;
  buildLayers(); updateSelectionUI(); render(); commit();
}

function addStickerAt(p) {
  const o = state.options.sticker;
  const l = {
    id: uid(), type: 'sticker', name: 'Sticker', visible: true, opacity: 1,
    cx: p.x, cy: p.y, scale: 1, rotation: 0, flipX: false, flipY: false, emoji: o.emoji, size: o.size
  };
  state.layers.push(l);
  state.selectedId = l.id;
  buildLayers(); updateSelectionUI(); render(); commit();
}

function startShape(p) {
  const o = state.options.shape;
  const names = { rect: 'Box', ellipse: 'Circle', line: 'Line', arrow: 'Arrow' };
  const l = {
    id: uid(), type: 'shape', shape: o.type, name: names[o.type] || 'Shape', visible: true, opacity: 1,
    cx: p.x, cy: p.y, scale: 1, rotation: 0, flipX: false, flipY: false,
    stroke: o.stroke, strokeWidth: o.width, fillOn: o.fillOn, fill: o.fill,
    x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0
  };
  state.layers.push(l);
  state.selectedId = l.id;
  drag = { mode: 'shape', l, start: p, dirty: false };
  render();
}

function updateShape(p, e) {
  const l = drag.l, s = drag.start;
  if (l.shape === 'rect' || l.shape === 'ellipse') {
    let w = p.x - s.x, h = p.y - s.y;
    if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    l.w = Math.abs(w); l.h = Math.abs(h);
    l.cx = s.x + w / 2; l.cy = s.y + h / 2;
  } else {
    l.x1 = 0; l.y1 = 0;
    l.x2 = p.x - s.x; l.y2 = p.y - s.y;
    l.cx = s.x; l.cy = s.y;
  }
  drag.dirty = true;
  render();
}

function finalizeShape() {
  const l = drag.l;
  if (l.shape === 'rect' || l.shape === 'ellipse') {
    if (l.w < 3 || l.h < 3) removeLayer(l.id, false);
  } else if (Math.hypot(l.x2 - l.x1, l.y2 - l.y1) < 4) {
    removeLayer(l.id, false);
  }
}

function startBrush(p) {
  const o = state.options.draw;
  const l = {
    id: uid(), type: 'brush', name: o.mode === 'highlight' ? 'Highlight' : 'Drawing', visible: true, opacity: 1,
    cx: p.x, cy: p.y, scale: 1, rotation: 0, flipX: false, flipY: false,
    points: [{ x: 0, y: 0 }], color: o.mode === 'highlight' ? '#ffe066' : o.color, size: o.size, mode: o.mode
  };
  state.layers.push(l);
  state.selectedId = l.id;
  drag = { mode: 'brush', l, dirty: false };
  render();
}

/* ------------------------------ background removal ------------------------------ */
function enterRemoveBg() { if (state.loaded) state.bgSource = cloneCanvas(state.base); }
function leaveRemoveBg() { state.bgSource = null; }

function updateBgSwatch() {
  const c = state.options.bg.color;
  const sw = $('bgSwatch');
  sw.style.background = c ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : '';
  $('bgColorText').textContent = c ? 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')' : 'No colour picked';
}

function sampleBg(p) {
  if (!state.bgSource) { toast('Open an image first'); return; }
  const x = Math.floor(clamp(p.x, 0, state.width - 1));
  const y = Math.floor(clamp(p.y, 0, state.height - 1));
  const d = state.bgSource.getContext('2d').getImageData(x, y, 1, 1).data;
  state.options.bg.color = [d[0], d[1], d[2]];
  updateBgSwatch();
  applyBgRemoval();
  commit();
}

function applyBgRemoval() {
  if (!state.bgSource || !state.options.bg.color) return;
  const o = state.options.bg;
  const nb = cloneCanvas(state.bgSource);
  const g = nb.getContext('2d');
  const img = g.getImageData(0, 0, nb.width, nb.height);
  const data = img.data;
  const tr = o.color[0], tg = o.color[1], tb = o.color[2];
  const thr = o.tolerance * 2;
  const fill = hexToRgb(o.fillColor);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb;
    if (Math.sqrt(dr * dr + dg * dg + db * db) <= thr) {
      if (o.fillMode === 'none') { data[i + 3] = 0; }
      else { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255; }
    }
  }
  g.putImageData(img, 0, 0);
  state.base = nb;
  render();
}

/* ------------------------------ tool switching ------------------------------ */
const TOOL_HINTS = {
  select: 'Click an item to select it, drag to move it, and use the round handles to resize or rotate.',
  crop: 'Drag on the image to draw a crop box, adjust its corners, then press Apply crop.',
  draw: 'Drag on the image to draw freehand.',
  text: 'Click the image to place text, or edit the selected text layer on the right.',
  shape: 'Drag on the image to draw a shape. Hold Shift for a square or circle.',
  sticker: 'Pick a sticker below, then click the image to place it.',
  removebg: 'Click the background colour on the image, then tune the tolerance until it is clean.',
  pan: 'Drag to move the view around.'
};

function setTool(t) {
  if (state.tool === 'removebg' && t !== 'removebg') leaveRemoveBg();
  state.tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  document.querySelectorAll('.opt').forEach((o) => { o.hidden = o.dataset.opt !== t; });
  $('toolHint').textContent = TOOL_HINTS[t] || '';
  wrap.className = 'canvas-wrap';
  if (state.loaded) wrap.classList.add(t);
  if (t === 'crop') state.crop = null;
  if (t === 'removebg' && state.loaded) enterRemoveBg();
  render();
}
