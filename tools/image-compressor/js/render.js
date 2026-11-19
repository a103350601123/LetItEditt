/* Image Editor — rendering, filters, layers drawing, selection & crop overlays */

function fontString(l) {
  return (l.italic ? 'italic ' : '') + (l.bold ? '700 ' : '400 ') + l.size + 'px ' + l.font;
}

function textSize(l) {
  mctx.font = fontString(l);
  const lines = String(l.text || ' ').split('\n');
  let w = 0;
  for (const ln of lines) w = Math.max(w, mctx.measureText(ln || ' ').width);
  const lineH = l.size * 1.2;
  return { w: Math.max(w, 4), h: Math.max(lineH * lines.length, 4), lineH, lines };
}

function localBounds(l) {
  if (l.type === 'text') { const t = textSize(l); return { x: -t.w / 2, y: -t.h / 2, w: t.w, h: t.h }; }
  if (l.type === 'sticker') return { x: -l.size / 2, y: -l.size / 2, w: l.size, h: l.size };
  if (l.type === 'shape') {
    if (l.shape === 'rect' || l.shape === 'ellipse') return { x: -l.w / 2, y: -l.h / 2, w: l.w, h: l.h };
    const pad = l.strokeWidth / 2 + 2;
    const minX = Math.min(l.x1, l.x2) - pad, maxX = Math.max(l.x1, l.x2) + pad;
    const minY = Math.min(l.y1, l.y2) - pad, maxY = Math.max(l.y1, l.y2) + pad;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (l.type === 'brush') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of l.points) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
    const pad = l.size / 2 + 2;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function localToWorld(l, x, y) {
  if (l.flipX) x = -x;
  if (l.flipY) y = -y;
  const sx = x * l.scale, sy = y * l.scale;
  const c = Math.cos(l.rotation), s = Math.sin(l.rotation);
  return { x: l.cx + sx * c - sy * s, y: l.cy + sx * s + sy * c };
}

function worldToLocal(l, X, Y) {
  const dx = X - l.cx, dy = Y - l.cy;
  const c = Math.cos(-l.rotation), s = Math.sin(-l.rotation);
  let rx = (dx * c - dy * s) / l.scale;
  let ry = (dx * s + dy * c) / l.scale;
  if (l.flipX) rx = -rx;
  if (l.flipY) ry = -ry;
  return { x: rx, y: ry };
}

function drawArrowHead(g, x1, y1, x2, y2, w) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(10, w * 3);
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(x2 - len * Math.cos(a - 0.42), y2 - len * Math.sin(a - 0.42));
  g.lineTo(x2 - len * Math.cos(a + 0.42), y2 - len * Math.sin(a + 0.42));
  g.closePath();
  g.fill();
}

function drawLayer(g, l) {
  g.save();
  g.globalAlpha = l.opacity;
  g.translate(l.cx, l.cy);
  g.rotate(l.rotation);
  g.scale(l.scale, l.scale);
  g.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);

  if (l.type === 'text') {
    const t = textSize(l);
    g.font = fontString(l);
    g.fillStyle = l.color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const totalH = t.lineH * t.lines.length;
    let y = -totalH / 2 + t.lineH / 2;
    for (const ln of t.lines) { g.fillText(ln, 0, y); y += t.lineH; }
  } else if (l.type === 'sticker') {
    g.font = l.size + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(l.emoji, 0, 0);
  } else if (l.type === 'shape') {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (l.shape === 'rect') {
      if (l.fillOn) { g.fillStyle = l.fill; g.fillRect(-l.w / 2, -l.h / 2, l.w, l.h); }
      if (l.strokeWidth > 0) { g.lineWidth = l.strokeWidth; g.strokeStyle = l.stroke; g.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h); }
    } else if (l.shape === 'ellipse') {
      g.beginPath();
      g.ellipse(0, 0, Math.abs(l.w / 2), Math.abs(l.h / 2), 0, 0, Math.PI * 2);
      if (l.fillOn) { g.fillStyle = l.fill; g.fill(); }
      if (l.strokeWidth > 0) { g.lineWidth = l.strokeWidth; g.strokeStyle = l.stroke; g.stroke(); }
    } else if (l.shape === 'line') {
      g.lineWidth = l.strokeWidth;
      g.strokeStyle = l.stroke;
      g.beginPath();
      g.moveTo(l.x1, l.y1);
      g.lineTo(l.x2, l.y2);
      g.stroke();
    } else if (l.shape === 'arrow') {
      g.lineWidth = l.strokeWidth;
      g.strokeStyle = l.stroke;
      g.fillStyle = l.stroke;
      g.beginPath();
      g.moveTo(l.x1, l.y1);
      g.lineTo(l.x2, l.y2);
      g.stroke();
      drawArrowHead(g, l.x1, l.y1, l.x2, l.y2, l.strokeWidth);
    }
  } else if (l.type === 'brush') {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (l.mode === 'highlight') { g.globalCompositeOperation = 'multiply'; g.globalAlpha = l.opacity * 0.42; }
    g.strokeStyle = l.color;
    g.fillStyle = l.color;
    g.lineWidth = l.size;
    const pts = l.points;
    if (pts.length === 1) {
      g.beginPath();
      g.arc(pts[0].x, pts[0].y, l.size / 2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
    }
  }
  g.restore();
}

function cssFilter(a) {
  const p = [];
  if (a.brightness !== 100) p.push('brightness(' + a.brightness + '%)');
  if (a.contrast !== 100) p.push('contrast(' + a.contrast + '%)');
  if (a.saturation !== 100) p.push('saturate(' + a.saturation + '%)');
  if (a.blur > 0) p.push('blur(' + a.blur + 'px)');
  if (a.grayscale > 0) p.push('grayscale(' + a.grayscale + '%)');
  if (a.sepia > 0) p.push('sepia(' + a.sepia + '%)');
  if (a.hue !== 0) p.push('hue-rotate(' + a.hue + 'deg)');
  return p.length ? p.join(' ') : 'none';
}

function render() {
  if (!state.loaded) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.filter = cssFilter(state.adjustments);
  ctx.drawImage(state.base, 0, 0);
  ctx.filter = 'none';
  for (const l of state.layers) if (l.visible !== false) drawLayer(ctx, l);
  renderOverlay();
}

function renderOverlay() {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, state.width, state.height);
  if (!state.loaded) return;
  if (state.tool === 'crop') { drawCrop(); return; }
  const l = selectedLayer();
  if (l) drawSelection(l);
}

function rotateHandlePos(l, topMid) {
  let dx = topMid.x - l.cx, dy = topMid.y - l.cy;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  return { x: topMid.x + dx * (26 / state.zoom), y: topMid.y + dy * (26 / state.zoom) };
}

function drawSelection(l) {
  const b = localBounds(l);
  const corners = [
    localToWorld(l, b.x, b.y),
    localToWorld(l, b.x + b.w, b.y),
    localToWorld(l, b.x + b.w, b.y + b.h),
    localToWorld(l, b.x, b.y + b.h)
  ];
  const z = state.zoom;
  octx.save();
  octx.strokeStyle = '#7c5cff';
  octx.lineWidth = 1.5 / z;
  octx.setLineDash([6 / z, 4 / z]);
  octx.beginPath();
  octx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) octx.lineTo(corners[i].x, corners[i].y);
  octx.closePath();
  octx.stroke();
  octx.setLineDash([]);

  const r = 5 / z;
  for (const c of corners) {
    octx.beginPath();
    octx.arc(c.x, c.y, r, 0, Math.PI * 2);
    octx.fillStyle = '#7c5cff';
    octx.fill();
    octx.lineWidth = 1.5 / z;
    octx.strokeStyle = '#fff';
    octx.stroke();
  }
  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const rh = rotateHandlePos(l, topMid);
  octx.beginPath();
  octx.moveTo(topMid.x, topMid.y);
  octx.lineTo(rh.x, rh.y);
  octx.strokeStyle = '#7c5cff';
  octx.lineWidth = 1.5 / z;
  octx.stroke();
  octx.beginPath();
  octx.arc(rh.x, rh.y, 5.5 / z, 0, Math.PI * 2);
  octx.fillStyle = '#3ba0ff';
  octx.fill();
  octx.strokeStyle = '#fff';
  octx.lineWidth = 1.5 / z;
  octx.stroke();
  octx.restore();
}

function cropHandlePoints(c) {
  return [
    ['nw', c.x, c.y], ['n', c.x + c.w / 2, c.y], ['ne', c.x + c.w, c.y],
    ['e', c.x + c.w, c.y + c.h / 2], ['se', c.x + c.w, c.y + c.h],
    ['s', c.x + c.w / 2, c.y + c.h], ['sw', c.x, c.y + c.h], ['w', c.x, c.y + c.h / 2]
  ];
}

function drawCrop() {
  const c = state.crop;
  const z = state.zoom;
  octx.save();
  if (!c || c.w < 1 || c.h < 1) {
    octx.fillStyle = 'rgba(0,0,0,.35)';
    octx.fillRect(0, 0, state.width, state.height);
    octx.restore();
    return;
  }
  octx.fillStyle = 'rgba(0,0,0,.55)';
  octx.fillRect(0, 0, state.width, state.height);
  octx.clearRect(c.x, c.y, c.w, c.h);
  octx.strokeStyle = 'rgba(255,255,255,.9)';
  octx.lineWidth = Math.max(1, 1.5 / z);
  octx.strokeRect(c.x, c.y, c.w, c.h);
  octx.strokeStyle = 'rgba(255,255,255,.35)';
  octx.lineWidth = Math.max(1, 1 / z);
  for (let i = 1; i < 3; i++) {
    const gx = c.x + (c.w * i) / 3, gy = c.y + (c.h * i) / 3;
    octx.beginPath(); octx.moveTo(gx, c.y); octx.lineTo(gx, c.y + c.h); octx.stroke();
    octx.beginPath(); octx.moveTo(c.x, gy); octx.lineTo(c.x + c.w, gy); octx.stroke();
  }
  const r = 6 / z;
  for (const [, x, y] of cropHandlePoints(c)) {
    octx.beginPath();
    octx.arc(x, y, r, 0, Math.PI * 2);
    octx.fillStyle = '#7c5cff';
    octx.fill();
    octx.strokeStyle = '#fff';
    octx.lineWidth = 1.5 / z;
    octx.stroke();
  }
  octx.restore();
}

/* ------------------------------ view ------------------------------ */
function applyView() {
  wrap.style.transform = 'translate(' + state.panX + 'px,' + state.panY + 'px) scale(' + state.zoom + ')';
  $('zoomLbl').textContent = Math.round(state.zoom * 100) + '%';
  $('zRange').value = Math.round(clamp(state.zoom * 100, 5, 400));
}

function fitView() {
  const stage = $('stage');
  if (!state.width || !state.height) return;
  const sw = stage.clientWidth - 60, sh = stage.clientHeight - 60;
  state.zoom = clamp(Math.min(sw / state.width, sh / state.height, 1), 0.05, 4);
  state.panX = 0; state.panY = 0;
  applyView();
}

function setZoom(z) {
  state.zoom = clamp(z, 0.05, 4);
  applyView();
}

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * state.width, y: ((e.clientY - r.top) / r.height) * state.height };
}
