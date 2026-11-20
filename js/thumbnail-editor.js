/* LetitEdit Thumbnail Maker — professional multilingual editor runtime.
 * Loaded after image-runtime.js on the thumbnail-generator page only.
 * The pure document helpers live in js/thumbnail-core.js (window.ThumbnailCore). */
(function (global) {
  'use strict';

  var T = global.ThumbnailCore;
  var Core = global.ImageCore;
  var initialized = false;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function $(id) { return document.getElementById(id); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function on(target, event, handler) { if (target) target.addEventListener(event, handler); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (typeof fallback === 'number' ? fallback : 0);
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, num(value, min))); }
  function val(id, fallback) { var node = $(id); return node ? node.value : fallback; }
  function checked(id) { var node = $(id); return Boolean(node && node.checked); }

  function setVal(id, value, skipIfFocused) {
    var node = $(id);
    if (!node) return;
    if (skipIfFocused && document.activeElement === node) return;
    var text = String(value == null ? '' : value);
    if (node.value !== text) node.value = text;
  }
  function setChecked(id, value) { var node = $(id); if (node) node.checked = Boolean(value); }
  function setText(id, value) { var node = $(id); if (node) node.textContent = String(value == null ? '' : value); }
  function setEnabled(id, enabled) { var node = $(id); if (node) node.disabled = !enabled; }

  function status(message, isError) {
    var node = $('image-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError));
  }
  function meta(message) { var node = $('image-meta'); if (node) node.textContent = message || ''; }

  function downloadBlob(blob, filename) {
    if (!blob) return;
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  var rangeSuffixes = {};
  function captureRangeSuffixes() {
    all('input[type="range"]').forEach(function (input) {
      if (!input.id) return;
      var output = $(input.id + '-value');
      if (output) rangeSuffixes[input.id] = output.textContent.replace(String(input.value), '');
    });
  }
  function updateRangeOutputs() {
    all('input[type="range"]').forEach(function (input) {
      if (!input.id) return;
      var output = $(input.id + '-value');
      if (!output) return;
      if (rangeSuffixes[input.id] == null) {
        rangeSuffixes[input.id] = output.textContent.replace(String(input.value), '');
      }
      output.textContent = String(input.value) + (rangeSuffixes[input.id] || '');
    });
  }

  /* ---------- Document ---------- */

  var DEFAULT_SETTINGS = {
    padding: 40, radius: 18, shadow: 35, removeBg: false, tolerance: 45,
    brightness: 100, contrast: 100, saturation: 100, blur: 0, filter: 'none',
    guides: true, safe: false
  };

  var doc = {
    preset: 'youtube',
    width: 1280,
    height: 720,
    background: { type: 'gradient', color1: '#0f172a', color2: '#2563eb' },
    settings: clone(DEFAULT_SETTINGS),
    layers: [],
    images: new Map(),
    selectedId: null,
    zoom: 1,
    mode: 'preview'
  };

  var managedUrls = new Set();
  var imageCache = new Map();
  var imageSeq = 0;
  var fontOptionScript = null;
  var supportsLetterSpacing = false;

  function createHistory(limit) {
    return {
      entries: [],
      index: -1,
      limit: limit || 20,
      push: function (snapshotData) {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(snapshotData);
        if (this.entries.length > this.limit) this.entries.shift();
        this.index = this.entries.length - 1;
      },
      undo: function () { return this.index > 0 ? this.entries[--this.index] : null; },
      redo: function () { return this.index < this.entries.length - 1 ? this.entries[++this.index] : null; },
      get canUndo() { return this.index > 0; },
      get canRedo() { return this.index < this.entries.length - 1; }
    };
  }
  var history = createHistory(20);

  function imageList() {
    /* Map iterators are not array-like; slice() silently returned an empty
     * list, which lost uploads from the selector, state and history. */
    var entries = [];
    doc.images.forEach(function (entry) { entries.push(entry); });
    return entries;
  }
  function imageById(id) { return doc.images.get(id) || null; }
  function nextImageId() { imageSeq += 1; return 'image-' + (imageSeq - 1); }
  function selectedLayer() { return T.getLayer(doc.layers, doc.selectedId); }

  function imageEntriesForSnapshot() {
    return imageList().map(function (entry) {
      return { id: entry.id, name: entry.name, dataUrl: entry.dataUrl };
    });
  }

  function snapshot() {
    return {
      preset: doc.preset, width: doc.width, height: doc.height,
      background: clone(doc.background), settings: clone(doc.settings),
      layers: clone(doc.layers), selectedId: doc.selectedId,
      images: imageEntriesForSnapshot(), imageSeq: imageSeq
    };
  }

  function commit() {
    history.push(snapshot());
    setEnabled('tg-undo', history.canUndo);
    setEnabled('tg-redo', history.canRedo);
  }

  function updateHistoryButtons() {
    setEnabled('tg-undo', history.canUndo);
    setEnabled('tg-redo', history.canRedo);
  }

  /* ---------- Colour / font helpers ---------- */

  function colorToHex(value, fallback) {
    var text = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      return '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
    }
    var match = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match) {
      return '#' + [1, 2, 3].map(function (index) {
        var part = Math.max(0, Math.min(255, Number(match[index]))).toString(16);
        return part.length === 1 ? '0' + part : part;
      }).join('');
    }
    return fallback || '#000000';
  }

  function splitFontValue(value) {
    var raw = String(value || T.FONT_STACKS.latin[0].value);
    var match = raw.match(/^\s*(\d{3}|bold|normal)\s+([\s\S]+)$/i);
    var family = match ? match[2] : raw;
    var weight = match && /^\d{3}$/.test(match[1]) ? match[1] : '700';
    return { family: family, weight: weight };
  }
  function fontFamilyOf(value) { return splitFontValue(value).family.trim().toLowerCase(); }

  function normalizeAlign(value) {
    if (value === 'left') return 'start';
    if (value === 'right') return 'end';
    if (value === 'start' || value === 'center' || value === 'end') return value;
    return 'center';
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    var r = Math.max(0, Math.min(num(radius, 0), width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ---------- Painting ---------- */

  function paintBackground(ctx, width, height) {
    var background = doc.background || {};
    if (background.type === 'transparent') return;
    if (background.type === 'solid') {
      ctx.fillStyle = background.color1 || '#0f172a';
    } else {
      var gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, background.color1 || '#0f172a');
      gradient.addColorStop(1, background.color2 || '#2563eb');
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, width, height);
  }

  var MANUAL_SPACING_SCRIPTS = ['latin', 'cyrillic', 'greek'];

  function drawSpacedLine(ctx, line, anchor, y, spacing, alignment, outline, maxWidth) {
    var glyphs = T.graphemes(line);
    var textWidth = ctx.measureText(line).width + spacing * Math.max(0, glyphs.length - 1);
    var x = alignment === 'start' ? anchor
      : alignment === 'end' ? anchor + maxWidth - textWidth
        : anchor - textWidth / 2;
    glyphs.forEach(function (glyph) {
      if (outline) ctx.strokeText(glyph, x, y);
      ctx.fillText(glyph, x, y);
      x += ctx.measureText(glyph).width + spacing;
    });
  }

  function drawTextLayer(ctx, layer, boxW, boxH) {
    var text = String(layer.text == null ? '' : layer.text);
    if (!text) return;
    var size = clamp(layer.size == null ? 84 : layer.size, 8, 500);
    var spacing = num(layer.letterSpacing, 0);
    var font = splitFontValue(layer.font);
    var script = T.detectScript(text);
    var direction = T.resolveDirection(text, layer.direction);
    var alignment = normalizeAlign(layer.align);

    ctx.save();
    ctx.font = (layer.italic ? 'italic ' : '') + (layer.weight || font.weight) + ' ' + size + 'px ' + font.family;
    ctx.direction = direction;
    ctx.textAlign = alignment;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (supportsLetterSpacing) ctx.letterSpacing = spacing + 'px';
    var manual = !supportsLetterSpacing && spacing !== 0 && MANUAL_SPACING_SCRIPTS.indexOf(script) !== -1;

    function measure(value) {
      var width = ctx.measureText(value).width;
      if (manual) width += spacing * Math.max(0, T.graphemes(value).length - 1);
      return Math.max(0, width);
    }
    var maxWidth = Math.max(24, boxW);
    var lines = T.wrapText(measure, text, maxWidth, {});
    var lineHeight = size * clamp(layer.lineHeight == null ? 1.15 : layer.lineHeight, 0.5, 4);
    var blockHeight = lines.length * lineHeight;
    var firstY = -blockHeight / 2 + lineHeight / 2;
    var anchor = alignment === 'start' ? -maxWidth / 2 : alignment === 'end' ? maxWidth / 2 : 0;

    if (layer.background && layer.background !== 'transparent') {
      var widest = lines.reduce(function (max, line) { return Math.max(max, measure(line)); }, 0);
      var pillW = Math.min(Math.max(24, boxW), widest + size * 0.7);
      var pillH = blockHeight + size * 0.45;
      ctx.save();
      ctx.fillStyle = layer.background;
      roundedRectPath(ctx, alignment === 'start' ? -maxWidth / 2
        : alignment === 'end' ? maxWidth / 2 - pillW : -pillW / 2,
      -pillH / 2, pillW, pillH, size * 0.35);
      ctx.fill();
      ctx.restore();
    }

    var fill;
    if (layer.gradient) {
      var gradient = ctx.createLinearGradient(-maxWidth / 2, -blockHeight / 2, maxWidth / 2, blockHeight / 2);
      gradient.addColorStop(0, layer.color || '#ffffff');
      gradient.addColorStop(1, layer.color2 || '#60a5fa');
      fill = gradient;
    } else {
      fill = layer.color || '#ffffff';
    }

    if (layer.shadow !== false) {
      ctx.shadowColor = layer.shadowColor || 'rgba(4,10,30,.65)';
      ctx.shadowBlur = Math.max(0, num(layer.shadowBlur, 12));
      ctx.shadowOffsetY = Math.max(1, size * 0.04);
    }
    var outline = Math.max(0, num(layer.outlineWidth, 4));
    if (outline > 0) {
      ctx.strokeStyle = layer.outlineColor || '#0f172a';
      ctx.lineWidth = outline;
    }
    ctx.fillStyle = fill;
    lines.forEach(function (line, index) {
      var y = firstY + index * lineHeight;
      if (manual) {
        drawSpacedLine(ctx, line, anchor, y, spacing, alignment, outline > 0, maxWidth);
      } else {
        if (outline > 0) ctx.strokeText(line, anchor, y, maxWidth);
        ctx.fillText(line, anchor, y, maxWidth);
      }
    });
    ctx.restore();
  }

  function imageDataFromImage(image) {
    var canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width || 1;
    canvas.height = image.naturalHeight || image.height || 1;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  var FILTER_PRESETS = {
    none: {},
    vivid: { contrast: 18, saturation: 35 },
    mono: { grayscale: 100, contrast: 15 },
    warm: { temperature: 35, saturation: 12 },
    cool: { temperature: -35, saturation: 8 }
  };

  function adjustedSource(layer, entry) {
    if (!entry || !entry.image) return null;
    var filterName = layer.filter || doc.settings.filter || 'none';
    var signature = [
      entry.id, entry.version, filterName,
      layer.brightness, layer.contrast, layer.saturation, layer.blur,
      layer.removeBackground, layer.tolerance,
      doc.settings.brightness, doc.settings.contrast, doc.settings.saturation,
      doc.settings.blur, doc.settings.removeBg, doc.settings.tolerance
    ].join('|');
    var cached = imageCache.get(signature);
    if (cached && cached.width && typeof cached.getContext === 'function') return cached;

    var data = imageDataFromImage(entry.image);
    if (!data) return null;
    if (Core && typeof Core.adjustImageData === 'function') {
      var filter = FILTER_PRESETS[filterName] || FILTER_PRESETS.none;
      data = Core.adjustImageData(data, {
        brightness: num(layer.brightness, 100) - 100 + num(doc.settings.brightness, 100) - 100,
        contrast: num(layer.contrast, 100) - 100 + (filter.contrast || 0) + num(doc.settings.contrast, 100) - 100,
        saturation: num(layer.saturation, 100) - 100 + (filter.saturation || 0) + num(doc.settings.saturation, 100) - 100,
        temperature: filter.temperature || 0,
        grayscale: filter.grayscale || 0
      });
    }
    var blur = clamp(num(layer.blur, 0) + num(doc.settings.blur, 0), 0, 12);
    if (blur > 0 && Core && typeof Core.boxBlur === 'function') data = Core.boxBlur(data, Math.round(blur));
    if ((layer.removeBackground || doc.settings.removeBg) && Core && typeof Core.removeBackground === 'function') {
      data = Core.removeBackground(data, num(layer.tolerance, doc.settings.tolerance), 45);
    }
    var canvas = document.createElement('canvas');
    canvas.width = data.width;
    canvas.height = data.height;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var target = ctx.createImageData(data.width, data.height);
    target.data.set(data.data);
    ctx.putImageData(target, 0, 0);
    if (imageCache.size > 24) imageCache.clear();
    imageCache.set(signature, canvas);
    return canvas;
  }

  function resolveImage(layer) {
    var id = layer.srcId;
    if (!id && layer.imageIndex != null) id = 'image-' + layer.imageIndex;
    return imageById(id);
  }

  function drawImageLayer(ctx, layer, boxW, boxH) {
    var entry = resolveImage(layer);
    if (!entry) return;
    var source = adjustedSource(layer, entry);
    if (!source) return;
    var crop = layer.crop || {};
    var left = clamp(crop.left, 0, 90);
    var top = clamp(crop.top, 0, 90);
    var right = clamp(crop.right, 0, 90);
    var bottom = clamp(crop.bottom, 0, 90);
    var sx = source.width * left / 100;
    var sy = source.height * top / 100;
    var sw = Math.max(1, Math.min(source.width - sx, source.width * (1 - (left + right) / 100)));
    var sh = Math.max(1, Math.min(source.height - sy, source.height * (1 - (top + bottom) / 100)));
    var w = Math.max(1, boxW);
    var h = Math.max(1, boxH);
    var radius = num(layer.radius, doc.settings.radius);
    var border = Math.max(0, num(layer.border, 0));

    ctx.save();
    if (layer.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(4,10,30,' + (clamp(doc.settings.shadow, 0, 100) / 100) + ')';
      ctx.shadowBlur = Math.max(4, num(doc.settings.shadow, 35));
      ctx.shadowOffsetY = Math.max(2, num(doc.settings.shadow, 35) / 6);
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, radius);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundedRectPath(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.clip();
    if (layer.flipX) ctx.scale(-1, 1);
    if (layer.flipY) ctx.scale(1, -1);
    var fit = layer.fit || 'contain';
    if (fit === 'stretch') {
      ctx.drawImage(source, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    } else {
      var scale = fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
      var dw = sw * scale;
      var dh = sh * scale;
      ctx.drawImage(source, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
    if (border > 0) {
      ctx.strokeStyle = layer.borderColor || '#ffffff';
      ctx.lineWidth = border;
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  var GLYPHS = ['★', '☆', '❤', '♥', '✓', '→', '←', '↑', '↓', '●', '◆', '■', '▲', '🎉', '🔥', '✨', '👍', '🚀'];
  var GLYPH_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

  function drawGlyph(ctx, glyph, w, h, color) {
    var size = Math.max(8, Math.min(w, h) * 0.92);
    ctx.save();
    ctx.font = size + 'px ' + GLYPH_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color || '#ffffff';
    ctx.fillText(glyph, 0, 0);
    ctx.restore();
  }

  function drawShapeLayer(ctx, layer, boxW, boxH) {
    var glyph = layer.type === 'sticker'
      ? (layer.glyph || (GLYPHS.indexOf(layer.shape) !== -1 ? layer.shape : '★'))
      : (GLYPHS.indexOf(layer.shape) !== -1 ? layer.shape : '');
    if (glyph && GLYPHS.indexOf(glyph) !== -1) {
      drawGlyph(ctx, glyph, boxW, boxH, layer.color || '#ffffff');
      return;
    }
    var kind = layer.type === 'sticker' ? 'glyph' : (layer.shape || 'rect');
    if (kind === 'glyph') { drawGlyph(ctx, '★', boxW, boxH, layer.color || '#ffffff'); return; }
    var w = Math.max(1, boxW);
    var h = Math.max(1, boxH);
    ctx.save();
    ctx.fillStyle = layer.color || '#2563eb';
    ctx.strokeStyle = layer.color || '#2563eb';
    ctx.beginPath();
    if (kind === 'circle') {
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'triangle') {
      ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
      ctx.fill();
    } else if (kind === 'star') {
      for (var i = 0; i < 10; i++) {
        var radius = i % 2 === 0 ? 1 : 0.44;
        var angle = -Math.PI / 2 + i * Math.PI / 5;
        var x = Math.cos(angle) * w / 2 * radius;
        var y = Math.sin(angle) * h / 2 * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'heart') {
      ctx.moveTo(0, h * 0.42);
      ctx.bezierCurveTo(-w * 0.78, -h * 0.14, -w * 0.4, -h * 0.72, 0, -h * 0.26);
      ctx.bezierCurveTo(w * 0.4, -h * 0.72, w * 0.78, -h * 0.14, 0, h * 0.42);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'arrow') {
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 8, 0);
      ctx.lineTo(w / 8, -h / 3); ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 8, h / 3); ctx.lineTo(w / 8, 0);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'line') {
      ctx.lineWidth = Math.max(2, h * 0.18);
      ctx.lineCap = 'round';
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
      ctx.stroke();
    } else {
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, num(layer.radius, 12));
      ctx.fill();
    }
    ctx.restore();
  }

  function layerBox(layer, width, height) {
    return {
      cx: num(layer.x, 50) / 100 * width,
      cy: num(layer.y, 50) / 100 * height,
      w: Math.max(2, num(layer.w, 50) / 100 * width),
      h: Math.max(2, num(layer.h, 30) / 100 * height),
      rotation: num(layer.rotation, 0)
    };
  }

  function paint(ctx, width, height) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    paintBackground(ctx, width, height);
    doc.layers.forEach(function (layer) {
      if (layer.visible === false) return;
      var box = layerBox(layer, width, height);
      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity == null ? 1 : layer.opacity, 0, 1);
      ctx.globalCompositeOperation = layer.blend || 'source-over';
      ctx.translate(box.cx, box.cy);
      if (box.rotation) ctx.rotate(box.rotation * Math.PI / 180);
      if (layer.type === 'text') drawTextLayer(ctx, layer, box.w, box.h);
      else if (layer.type === 'image') drawImageLayer(ctx, layer, box.w, box.h);
      else drawShapeLayer(ctx, layer, box.w, box.h);
      ctx.restore();
    });
  }

  /* ---------- Overlay ---------- */

  function overlayPoint(event, canvas) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / (rect.width || 1) * canvas.width,
      y: (event.clientY - rect.top) / (rect.height || 1) * canvas.height
    };
  }
  function localPoint(point, box) {
    var dx = point.x - box.cx;
    var dy = point.y - box.cy;
    var angle = -box.rotation * Math.PI / 180;
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }
  function handleSize(width, height) { return clamp(Math.min(width, height) / 80, 7, 18); }

  function layerHandles(layer, width, height) {
    var box = layerBox(layer, width, height);
    var angle = box.rotation * Math.PI / 180;
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var offset = handleSize(width, height) * 2;
    function transform(lx, ly) {
      return { x: box.cx + lx * cos - ly * sin, y: box.cy + lx * sin + ly * cos };
    }
    return [
      { kind: 'nw', x: transform(-box.w / 2, -box.h / 2).x, y: transform(-box.w / 2, -box.h / 2).y },
      { kind: 'ne', x: transform(box.w / 2, -box.h / 2).x, y: transform(box.w / 2, -box.h / 2).y },
      { kind: 'se', x: transform(box.w / 2, box.h / 2).x, y: transform(box.w / 2, box.h / 2).y },
      { kind: 'sw', x: transform(-box.w / 2, box.h / 2).x, y: transform(-box.w / 2, box.h / 2).y },
      { kind: 'rotate', x: transform(0, -box.h / 2 - offset).x, y: transform(0, -box.h / 2 - offset).y }
    ];
  }

  function drawOverlay(ctx) {
    if (!ctx) return;
    var width = doc.width;
    var height = doc.height;
    ctx.clearRect(0, 0, width, height);
    if (doc.settings.guides) {
      ctx.save();
      ctx.strokeStyle = 'rgba(37,99,235,.5)';
      ctx.lineWidth = Math.max(1, width / 1200);
      ctx.setLineDash([Math.max(4, width / 160), Math.max(4, width / 200)]);
      [1 / 3, 2 / 3].forEach(function (part) {
        ctx.beginPath(); ctx.moveTo(width * part, 0); ctx.lineTo(width * part, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, height * part); ctx.lineTo(width, height * part); ctx.stroke();
      });
      ctx.restore();
    }
    if (doc.settings.safe) {
      var area = T.safeArea(doc.preset, width, height);
      ctx.save();
      ctx.strokeStyle = 'rgba(249,115,22,.85)';
      ctx.lineWidth = Math.max(1, width / 900);
      ctx.setLineDash([Math.max(6, width / 120), Math.max(4, width / 200)]);
      ctx.strokeRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      ctx.restore();
    }
    var layer = selectedLayer();
    if (!layer || layer.visible === false || layer.locked) return;
    var box = layerBox(layer, width, height);
    var size = handleSize(width, height);
    ctx.save();
    ctx.translate(box.cx, box.cy);
    if (box.rotation) ctx.rotate(box.rotation * Math.PI / 180);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = Math.max(1, width / 900);
    ctx.setLineDash([Math.max(4, width / 180), Math.max(3, width / 260)]);
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.setLineDash([]);
    [-box.w / 2, box.w / 2].forEach(function (x) {
      [-box.h / 2, box.h / 2].forEach(function (y) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      });
    });
    var rotateY = -box.h / 2 - size * 2;
    ctx.beginPath(); ctx.moveTo(0, -box.h / 2); ctx.lineTo(0, rotateY); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, rotateY, size * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function renderPreview() {
    var canvas = $('image-preview');
    if (!canvas) return;
    if (canvas.width !== doc.width) canvas.width = doc.width;
    if (canvas.height !== doc.height) canvas.height = doc.height;
    paint(canvas.getContext('2d'), doc.width, doc.height);
    var overlay = $('tg-overlay');
    if (overlay) {
      if (overlay.width !== doc.width) overlay.width = doc.width;
      if (overlay.height !== doc.height) overlay.height = doc.height;
      drawOverlay(overlay.getContext('2d'));
    }
    meta(doc.width + '×' + doc.height + ' · ' + doc.layers.length + ' layer' + (doc.layers.length === 1 ? '' : 's'));
    setEnabled('image-download', true);
  }

  /* ---------- Controls ---------- */

  function ensureFontOptions(text, layer, announce) {
    var select = $('tg-font');
    if (!select) return;
    var script = T.detectScript(text);
    var fonts = T.fontsForScript(script);
    if (fontOptionScript !== script || select.options.length === 0) {
      select.innerHTML = fonts.map(function (font) {
        return '<option value="' + font.value.replace(/"/g, '&quot;') + '">' + font.label + ' · ' + script + '</option>';
      }).join('');
      fontOptionScript = script;
    }
    if (!layer) return;
    var parts = splitFontValue(layer.font);
    var compatible = fonts.some(function (font) { return fontFamilyOf(font.value) === fontFamilyOf(parts.family); });
    if (!compatible) {
      var suggestion = T.suggestFontForScript(script, parts.family);
      layer.font = suggestion;
      layer.weight = splitFontValue(suggestion).weight;
      if (announce) status('Font updated for ' + script + ' text.');
    }
    var fullValue = (layer.weight || splitFontValue(layer.font).weight) + ' ' + splitFontValue(layer.font).family;
    var exists = Array.prototype.some.call(select.options, function (option) { return option.value === fullValue; });
    if (!exists) {
      var option = document.createElement('option');
      option.value = fullValue;
      option.textContent = 'Current font';
      select.appendChild(option);
    }
    setVal('tg-font', fullValue);
  }

  function syncImageSrcOptions() {
    var select = $('tg-image-src');
    if (!select) return;
    var current = select.value;
    var entries = imageList();
    select.innerHTML = '<option value="">No image uploaded</option>' + entries.map(function (entry) {
      return '<option value="' + entry.id + '">' + String(entry.name).replace(/</g, '&lt;') + '</option>';
    }).join('');
    if (current && doc.images.has(current)) select.value = current;
  }

  function syncLayerControls(layer) {
    if (!layer) return;
    setVal('tg-layer-name', layer.name || layer.type);
    setVal('tg-layer-type', layer.type || 'text');
    setVal('tg-direction', layer.direction || 'auto');
    setVal('tg-font-weight', layer.weight || splitFontValue(layer.font).weight);
    setChecked('tg-italic', Boolean(layer.italic));
    setVal('tg-font-size', Math.round(num(layer.size, 84)));
    setVal('tg-line-height', layer.lineHeight == null ? 1.15 : layer.lineHeight);
    setVal('tg-letter-spacing', layer.letterSpacing == null ? 0 : layer.letterSpacing);
    setVal('tg-text-color', colorToHex(layer.color, '#ffffff'));
    setChecked('tg-gradient', Boolean(layer.gradient));
    setVal('tg-color2', colorToHex(layer.color2 || doc.background.color2, '#2563eb'), true);
    setVal('tg-outline-color', colorToHex(layer.outlineColor, '#0f172a'));
    setVal('tg-outline-width', layer.outlineWidth == null ? 4 : layer.outlineWidth);
    setChecked('tg-text-shadow', layer.shadow !== false);
    setVal('tg-shadow-color', colorToHex(layer.shadowColor, '#0f172a'));
    setVal('tg-shadow-blur', layer.shadowBlur == null ? 12 : layer.shadowBlur);
    setChecked('tg-text-bg', Boolean(layer.background && layer.background !== 'transparent'));
    setVal('tg-align', layer.align || 'center');
    setVal('tg-layer-rotation', Math.round(num(layer.rotation, 0)));
    setVal('tg-layer-x', Math.round(num(layer.x, 50)));
    setVal('tg-layer-y', Math.round(num(layer.y, 50)));
    setVal('tg-layer-w', Math.round(num(layer.w, 50)));
    setVal('tg-layer-h', Math.round(num(layer.h, 30)));
    setVal('tg-layer-opacity', Math.round(clamp(layer.opacity == null ? 1 : layer.opacity, 0, 1) * 100));
    setVal('tg-layer-blend', layer.blend || 'source-over');
    setChecked('tg-layer-visible', layer.visible !== false);
    setChecked('tg-layer-locked', Boolean(layer.locked));
    var text = String(layer.text == null ? '' : layer.text);
    setVal('tg-text', text, true);
    ensureFontOptions(text, layer, false);

    syncImageSrcOptions();
    setVal('tg-image-src', layer.srcId || '');
    setVal('tg-image-fit', layer.fit || 'contain');
    setChecked('tg-image-flip-x', Boolean(layer.flipX));
    setChecked('tg-image-flip-y', Boolean(layer.flipY));
    var crop = layer.crop || {};
    setVal('tg-crop-left', crop.left == null ? 0 : crop.left);
    setVal('tg-crop-top', crop.top == null ? 0 : crop.top);
    setVal('tg-crop-right', crop.right == null ? 0 : crop.right);
    setVal('tg-crop-bottom', crop.bottom == null ? 0 : crop.bottom);
    setVal('tg-image-border', layer.border == null ? 0 : layer.border);
    setVal('tg-image-border-color', colorToHex(layer.borderColor, '#ffffff'));
    setVal('tg-image-radius', layer.radius == null ? 16 : layer.radius);
    setChecked('tg-image-shadow', Boolean(layer.shadow));
    setChecked('tg-image-remove-bg', Boolean(layer.removeBackground));
    setVal('tg-shape', GLYPHS.indexOf(layer.shape) !== -1 ? 'star' : (layer.shape || 'rect'));
    setVal('tg-sticker-glyph', layer.glyph || (GLYPHS.indexOf(layer.shape) !== -1 ? layer.shape : '★'));
    updateRangeOutputs();
  }

  function syncCanvasControls() {
    setVal('tg-preset', doc.preset);
    setVal('tg-width', doc.width);
    setVal('tg-height', doc.height);
    setVal('tg-bg-type', doc.background.type || 'gradient');
    setVal('tg-color1', colorToHex(doc.background.color1, '#0f172a'));
    setVal('tg-color2', colorToHex(doc.background.color2, '#2563eb'));
    setVal('tg-padding', doc.settings.padding);
    setVal('tg-radius', doc.settings.radius);
    setVal('tg-shadow', doc.settings.shadow);
    setChecked('tg-remove-bg', Boolean(doc.settings.removeBg));
    setVal('tg-bg-tolerance', doc.settings.tolerance);
    setChecked('tg-guides', Boolean(doc.settings.guides));
    setChecked('tg-safe-guides', Boolean(doc.settings.safe));
    var note = T.presetById(doc.preset);
    setText('tg-preset-note', presetNote(doc.preset, note));
    var selected = selectedLayer();
    setVal('tg-brightness', selected && selected.type === 'image' ? selected.brightness : doc.settings.brightness);
    setVal('tg-contrast', selected && selected.type === 'image' ? selected.contrast : doc.settings.contrast);
    setVal('tg-saturation', selected && selected.type === 'image' ? selected.saturation : doc.settings.saturation);
    setVal('tg-blur', selected && selected.type === 'image' ? selected.blur : doc.settings.blur);
    setVal('tg-filter', (selected && selected.filter) || doc.settings.filter || 'none');
    updateRangeOutputs();
  }

  function readControls() {
    var type = val('tg-layer-type', 'text');
    var fontValue = val('tg-font', '');
    var parts = fontValue ? splitFontValue(fontValue) : { family: T.FONT_STACKS.latin[0].value, weight: '700' };
    var common = {
      name: val('tg-layer-name', '') || type,
      type: type,
      x: num(val('tg-layer-x', 50), 50),
      y: num(val('tg-layer-y', 50), 50),
      w: num(val('tg-layer-w', 70), 70),
      h: num(val('tg-layer-h', 30), 30),
      rotation: num(val('tg-layer-rotation', 0), 0),
      opacity: clamp(num(val('tg-layer-opacity', 100), 100) / 100, 0, 1),
      visible: checked('tg-layer-visible'),
      locked: checked('tg-layer-locked'),
      blend: val('tg-layer-blend', 'source-over')
    };
    if (type === 'text') {
      Object.assign(common, {
        text: val('tg-text', ''), font: parts.family,
        weight: val('tg-font-weight', parts.weight) || parts.weight,
        italic: checked('tg-italic'),
        direction: val('tg-direction', 'auto'),
        size: clamp(num(val('tg-font-size', 84), 84), 8, 500),
        lineHeight: clamp(num(val('tg-line-height', 1.15), 1.15), 0.5, 4),
        letterSpacing: clamp(num(val('tg-letter-spacing', 0), 0), -20, 40),
        color: val('tg-text-color', '#ffffff'),
        color2: val('tg-color2', '#2563eb'),
        gradient: checked('tg-gradient'),
        outlineColor: val('tg-outline-color', '#0f172a'),
        outlineWidth: num(val('tg-outline-width', 4), 4),
        shadow: checked('tg-text-shadow'),
        shadowColor: val('tg-shadow-color', '#0f172a'),
        shadowBlur: num(val('tg-shadow-blur', 12), 12),
        background: checked('tg-text-bg') ? 'rgba(15,23,42,.66)' : 'transparent',
        align: val('tg-align', 'center')
      });
    } else if (type === 'image') {
      Object.assign(common, {
        srcId: val('tg-image-src', '') || null,
        fit: val('tg-image-fit', 'contain'),
        flipX: checked('tg-image-flip-x'),
        flipY: checked('tg-image-flip-y'),
        crop: {
          left: num(val('tg-crop-left', 0), 0), top: num(val('tg-crop-top', 0), 0),
          right: num(val('tg-crop-right', 0), 0), bottom: num(val('tg-crop-bottom', 0), 0)
        },
        border: num(val('tg-image-border', 0), 0),
        borderColor: val('tg-image-border-color', '#ffffff'),
        radius: num(val('tg-image-radius', 16), 16),
        shadow: checked('tg-image-shadow'),
        removeBackground: checked('tg-image-remove-bg'),
        tolerance: num(val('tg-bg-tolerance', doc.settings.tolerance), doc.settings.tolerance),
        brightness: num(val('tg-brightness', 100), 100),
        contrast: num(val('tg-contrast', 100), 100),
        saturation: num(val('tg-saturation', 100), 100),
        blur: num(val('tg-blur', 0), 0),
        filter: val('tg-filter', 'none')
      });
    } else {
      Object.assign(common, {
        shape: type === 'sticker' ? (val('tg-sticker-glyph', '★') || '★') : val('tg-shape', 'rect'),
        glyph: val('tg-sticker-glyph', '★') || '★',
        color: val('tg-text-color', '#2563eb'),
        radius: num(val('tg-image-radius', 12), 12)
      });
    }
    return common;
  }

  function applyControlsToSelected() {
    var layer = selectedLayer();
    if (!layer) return false;
    Object.assign(layer, readControls(), { id: layer.id });
    return true;
  }

  function readDocumentControls() {
    doc.width = clamp(num(val('tg-width', 1280), 1280), 64, 8000);
    doc.height = clamp(num(val('tg-height', 720), 720), 64, 8000);
    doc.background.type = val('tg-bg-type', 'gradient');
    doc.background.color1 = val('tg-color1', '#0f172a');
    doc.background.color2 = val('tg-color2', '#2563eb');
    doc.settings.padding = num(val('tg-padding', 40), 40);
    doc.settings.radius = num(val('tg-radius', 18), 18);
    doc.settings.shadow = num(val('tg-shadow', 35), 35);
    doc.settings.removeBg = checked('tg-remove-bg');
    doc.settings.tolerance = num(val('tg-bg-tolerance', 45), 45);
    doc.settings.guides = checked('tg-guides');
    doc.settings.safe = checked('tg-safe-guides');
    doc.settings.filter = val('tg-filter', 'none');
    var layer = selectedLayer();
    if (layer && layer.type === 'text') layer.color2 = doc.background.color2;
    ['brightness', 'contrast', 'saturation', 'blur'].forEach(function (key) {
      var id = 'tg-' + key;
      var value = num(val(id, doc.settings[key]), doc.settings[key]);
      if (layer && layer.type === 'image') layer[key] = value;
      else doc.settings[key] = value;
    });
    var matching = T.PRESETS.find(function (preset) {
      return preset.width === doc.width && preset.height === doc.height;
    });
    if (matching) doc.preset = matching.id;
    else doc.preset = 'custom';
    setVal('tg-preset', doc.preset);
    setText('tg-preset-note', presetNote(doc.preset, T.presetById(doc.preset)));
  }

  var NOTE_OVERRIDES = {
    youtube: 'YouTube thumbnails are 1280×720 px.',
    'instagram-post': 'Instagram feed posts are 1080×1080 px.',
    shorts: 'YouTube Shorts use a 1080×1920 vertical canvas.',
    tiktok: 'TikTok videos use a 1080×1920 canvas.'
  };
  function presetNote(id, preset) { return NOTE_OVERRIDES[id] || preset.note; }

  /* ---------- Layer panel and selection ---------- */

  function iconButton(label, glyph, handler) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-small tg-icon-button';
    button.textContent = glyph;
    button.title = label;
    button.setAttribute('aria-label', label);
    on(button, 'click', handler);
    return button;
  }

  function renderLayerList() {
    var list = $('tg-layers');
    if (!list) return;
    list.textContent = '';
    if (!doc.layers.length) {
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'No layers yet. Add a layer from the controls above.';
      list.appendChild(hint);
      return;
    }
    doc.layers.forEach(function (layer, index) {
      var row = document.createElement('div');
      row.className = 'pm-order-row tg-layer-row' + (layer.id === doc.selectedId ? ' is-active' : '');
      row.dataset.layerId = layer.id;
      var label = document.createElement('span');
      label.textContent = (index + 1) + '. ' + (layer.name || layer.type) + ' — ' + layer.type +
        (layer.visible === false ? ' (hidden)' : '') + (layer.locked ? ' (locked)' : '');
      row.appendChild(label);
      var actions = document.createElement('div');
      actions.className = 'output-actions';
      actions.appendChild(iconButton('Load ' + (layer.name || layer.type), 'Load', function () {
        selectLayer(layer.id);
        status('Layer loaded into the controls.');
      }));
      actions.appendChild(iconButton('Move ' + (layer.name || layer.type) + ' forward', '↑', function () {
        if (!T.moveLayer(doc.layers, layer.id, 1)) { status('Already at the top.', true); return; }
        selectLayer(layer.id); commit(); renderPreview(); status('Layer moved forward.');
      }));
      actions.appendChild(iconButton('Move ' + (layer.name || layer.type) + ' back', '↓', function () {
        if (!T.moveLayer(doc.layers, layer.id, -1)) { status('Already at the bottom.', true); return; }
        selectLayer(layer.id); commit(); renderPreview(); status('Layer moved back.');
      }));
      actions.appendChild(iconButton((layer.visible === false ? 'Show ' : 'Hide ') + (layer.name || layer.type),
        layer.visible === false ? '◌' : '◉', function () {
          layer.visible = layer.visible === false;
          commit(); renderLayerList(); renderPreview();
          status(layer.visible ? 'Layer shown.' : 'Layer hidden.');
        }));
      actions.appendChild(iconButton((layer.locked ? 'Unlock ' : 'Lock ') + (layer.name || layer.type),
        layer.locked ? '🔒' : '🔓', function () {
          layer.locked = !layer.locked;
          commit(); renderLayerList(); renderPreview();
          status(layer.locked ? 'Layer locked.' : 'Layer unlocked.');
        }));
      actions.appendChild(iconButton('Duplicate ' + (layer.name || layer.type), '⧉', function () {
        var copy = T.duplicateLayer(doc.layers, layer.id);
        if (!copy) return;
        selectLayer(copy.id); commit(); renderPreview(); status('Layer duplicated.');
      }));
      actions.appendChild(iconButton('Delete ' + (layer.name || layer.type), '✕', function () {
        T.removeLayer(doc.layers, layer.id);
        if (doc.selectedId === layer.id) doc.selectedId = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
        syncLayerControls(selectedLayer()); commit(); renderLayerList(); renderPreview();
        status('Layer deleted.');
      }));
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function selectLayer(id) {
    doc.selectedId = id || null;
    renderLayerList();
    syncLayerControls(selectedLayer());
    renderPreview();
  }

  function addLayer() {
    var layer = T.makeLayer(val('tg-layer-type', 'text'), readControls());
    if (layer.type === 'image' && !resolveImage(layer)) {
      var first = imageList()[0];
      if (first) layer.srcId = first.id;
    }
    if (layer.type === 'text') ensureFontOptions(layer.text, layer, false);
    doc.layers.push(layer);
    doc.selectedId = layer.id;
    renderLayerList(); syncLayerControls(layer); commit(); renderPreview();
    status('Layer added.');
  }

  function updateLayer() {
    var layer = selectedLayer();
    if (!layer) { status('Select a layer first.', true); return; }
    applyControlsToSelected();
    renderLayerList(); commit(); renderPreview();
    status('Layer updated.');
  }

  function duplicateSelected() {
    if (!doc.selectedId) { status('Select a layer first.', true); return; }
    var copy = T.duplicateLayer(doc.layers, doc.selectedId);
    if (!copy) return;
    selectLayer(copy.id); commit(); renderPreview(); status('Layer duplicated.');
  }

  function deleteSelected() {
    if (!doc.selectedId) { status('Select a layer first.', true); return; }
    T.removeLayer(doc.layers, doc.selectedId);
    doc.selectedId = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
    syncLayerControls(selectedLayer()); commit(); renderLayerList(); renderPreview();
    status('Layer deleted.');
  }

  function alignSelected(direction) {
    var layer = selectedLayer();
    if (!layer) { status('Select a layer first.', true); return; }
    var w = num(layer.w, 50);
    var h = num(layer.h, 30);
    if (direction === 'left') layer.x = w / 2;
    if (direction === 'center') layer.x = 50;
    if (direction === 'right') layer.x = 100 - w / 2;
    if (direction === 'top') layer.y = h / 2;
    if (direction === 'middle') layer.y = 50;
    if (direction === 'bottom') layer.y = 100 - h / 2;
    syncLayerControls(layer); commit(); renderPreview();
    status('Layer aligned ' + direction + '.');
  }

  /* ---------- Images ---------- */

  function releaseUrls() {
    managedUrls.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (error) { /* already released */ }
    });
    managedUrls.clear();
  }
  function manageUrl(url) { managedUrls.add(url); return url; }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 50 * 1024 * 1024) { reject(new Error('That file is larger than the 50 MB limit.')); return; }
      var url = manageUrl(URL.createObjectURL(file));
      var image = new Image();
      var dataUrl = null;
      var finished = false;
      function done() {
        if (finished || !dataUrl) return;
        finished = true;
        resolve({ image: image, url: url, dataUrl: dataUrl, name: file.name || 'image.png' });
      }
      function fail(message) {
        if (finished) return;
        finished = true;
        managedUrls.delete(url);
        try { URL.revokeObjectURL(url); } catch (error) { /* ignore */ }
        reject(new Error(message));
      }
      var reader = new FileReader();
      reader.onload = function () { dataUrl = String(reader.result); done(); };
      reader.onerror = function () { fail('The file could not be read.'); };
      reader.readAsDataURL(file);
      image.onload = done;
      image.onerror = function () { fail('That file could not be decoded as an image.'); };
      image.src = url;
    });
  }

  function loadImageFromDataUrl(src, id, name) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve({ id: id, image: image, name: name, dataUrl: src, url: null, version: 1 }); };
      image.onerror = function () { reject(new Error('A saved image could not be restored.')); };
      image.src = src;
    });
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    if (files.length > 8) { status('Choose up to eight photos at once.', true); return; }
    var loaded = [];
    for (var i = 0; i < files.length; i++) {
      try { loaded.push(await loadImageFile(files[i])); }
      catch (error) { status(error.message, true); }
    }
    if (!loaded.length) return;
    loaded.forEach(function (item) {
      var id = nextImageId();
      doc.images.set(id, {
        id: id, image: item.image, name: item.name, url: item.url,
        dataUrl: item.dataUrl, version: 1
      });
      var layer = T.makeLayer('image', { name: item.name, srcId: id, x: 50, y: 50, w: 70, h: 76 });
      doc.layers.push(layer);
      doc.selectedId = layer.id;
    });
    imageCache.clear();
    syncImageSrcOptions();
    renderLayerList(); syncLayerControls(selectedLayer()); commit(); renderPreview();
    status('Loaded ' + loaded.length + ' photo layer' + (loaded.length === 1 ? '' : 's') + '.');
  }

  function bindUpload() {
    var input = $('image-file');
    on(input, 'change', function () {
      handleFiles(Array.prototype.slice.call((input && input.files) || []));
    });
    on($('image-change'), 'click', function () { if (input) input.click(); });
    on($('image-reset'), 'click', function () { resetProject(false); });
    var drop = document.querySelector('.image-drop');
    if (drop) {
      on(drop, 'dragover', function (event) { event.preventDefault(); drop.classList.add('is-dragover'); });
      on(drop, 'dragleave', function () { drop.classList.remove('is-dragover'); });
      on(drop, 'drop', function (event) {
        event.preventDefault();
        drop.classList.remove('is-dragover');
        handleFiles(Array.prototype.slice.call((event.dataTransfer && event.dataTransfer.files) || []));
      });
    }
  }

  /* ---------- Templates, history, projects ---------- */

  function applyTemplate(name) {
    var template = T.applyTemplate(name, doc.images.size);
    doc.layers = template.layers;
    doc.layers.forEach(function (layer) {
      if (layer.type === 'text') ensureFontOptions(layer.text, layer, false);
    });
    doc.selectedId = doc.layers.length ? doc.layers[0].id : null;
    renderLayerList(); syncLayerControls(selectedLayer()); commit(); renderPreview();
    all('#tg-templates .chip').forEach(function (chip) {
      chip.classList.toggle('is-active', chip.dataset.value === name);
    });
    status('Template "' + name + '" applied.');
  }

  function applyPreset(id) {
    var preset = T.presetById(id);
    doc.preset = preset.id;
    doc.width = preset.width;
    doc.height = preset.height;
    setVal('tg-width', preset.width);
    setVal('tg-height', preset.height);
    setText('tg-preset-note', presetNote(preset.id, preset));
    syncCanvasControls(); renderPreview(); commit();
    status('Canvas set to ' + preset.width + '×' + preset.height + '.');
  }

  async function restore(data) {
    if (!data) return;
    try {
      var restored = data.images || [];
      var entries = await Promise.all(restored.map(function (item) {
        return loadImageFromDataUrl(item.dataUrl, item.id, item.name || 'image.png');
      }));
      releaseUrls();
      doc.images = new Map();
      entries.forEach(function (entry) { doc.images.set(entry.id, entry); });
      imageSeq = entries.length;
      doc.preset = data.preset || 'custom';
      doc.width = data.width;
      doc.height = data.height;
      doc.background = clone(data.background || doc.background);
      doc.settings = Object.assign(clone(DEFAULT_SETTINGS), data.settings || {});
      doc.layers = clone(data.layers || []);
      doc.selectedId = data.selectedId && T.getLayer(doc.layers, data.selectedId) ? data.selectedId : null;
      imageCache.clear();
      syncImageSrcOptions(); syncCanvasControls(); syncLayerControls(selectedLayer());
      renderLayerList(); updateHistoryButtons(); renderPreview();
    } catch (error) { status(error.message, true); }
  }

  function undo() {
    var previous = history.undo();
    if (!previous) { status('Nothing to undo.', true); return; }
    restore(previous).then(function () { status('Thumbnail history restored.'); });
  }
  function redo() {
    var next = history.redo();
    if (!next) { status('Nothing to redo.', true); return; }
    restore(next).then(function () { status('Thumbnail history restored.'); });
  }

  function project() {
    var clean = T.sanitizeProject({
      preset: doc.preset, width: doc.width, height: doc.height,
      background: doc.background, settings: doc.settings, layers: doc.layers
    });
    clean.selectedId = doc.selectedId;
    clean.images = imageEntriesForSnapshot();
    return clean;
  }

  function saveProject() {
    try {
      var data = JSON.stringify(project(), null, 2);
      downloadBlob(new Blob([data], { type: 'application/json' }), 'letitedit-thumbnail-project.json');
      status('Project saved as JSON.');
    } catch (error) { status(error.message, true); }
  }

  async function loadProjectFromFile(file) {
    if (!file) return;
    try {
      var text = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(new Error('The project file could not be read.')); };
        reader.readAsText(file);
      });
      var parsed = JSON.parse(text);
      var clean = T.sanitizeProject(parsed);
      clean.images = Array.isArray(parsed.images) ? parsed.images.slice(0, 8) : [];
      clean.selectedId = parsed.selectedId;
      await restore(clean);
      history.entries = []; history.index = -1;
      commit();
      status('Project loaded.');
    } catch (error) { status('Could not load that project: ' + error.message, true); }
  }

  function resetProject(initial) {
    releaseUrls();
    doc.images = new Map();
    imageSeq = 0;
    imageCache.clear();
    var layer = T.makeLayer('text', {
      name: 'Headline', text: 'YOUR HEADLINE', x: 50, y: 78, w: 86, h: 28, size: 96
    });
    doc.layers = [layer];
    doc.selectedId = layer.id;
    doc.preset = 'youtube';
    doc.width = 1280;
    doc.height = 720;
    doc.background = { type: 'gradient', color1: '#0f172a', color2: '#2563eb' };
    doc.settings = clone(DEFAULT_SETTINGS);
    fontOptionScript = null;
    history.entries = []; history.index = -1;
    if ($('image-file')) $('image-file').value = '';
    if ($('tg-project-file')) $('tg-project-file').value = '';
    syncImageSrcOptions(); syncCanvasControls(); syncLayerControls(layer);
    renderLayerList(); commit(); renderPreview(); applyZoom(doc.zoom);
    all('#tg-templates .chip').forEach(function (chip) { chip.classList.remove('is-active'); });
    status(initial ? 'Thumbnail generator ready. Add a photo or edit the headline.' : 'Project reset.');
  }

  /* ---------- Pointer interaction ---------- */

  var drag = null;

  function bindPointer() {
    var overlay = $('tg-overlay');
    var canvas = $('image-preview');
    if (!overlay) return;
    if (overlay.style) overlay.style.touchAction = 'none';

    on(overlay, 'pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      var point = overlayPoint(event, overlay);
      var selected = selectedLayer();
      if (selected && selected.visible !== false && !selected.locked) {
        var handles = layerHandles(selected, doc.width, doc.height);
        var radius = handleSize(doc.width, doc.height) * 1.7;
        for (var i = 0; i < handles.length; i++) {
          var handle = handles[i];
          if (Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius) {
            var box = layerBox(selected, doc.width, doc.height);
            drag = {
              mode: handle.kind === 'rotate' ? 'rotate' : 'resize',
              layer: selected, handle: handle.kind, start: point, startBox: box,
              startAngle: Math.atan2(point.y - box.cy, point.x - box.cx),
              startRotation: num(selected.rotation, 0), changed: false, committed: false
            };
            capture(event, overlay);
            event.preventDefault();
            return;
          }
        }
      }
      var hit = null;
      for (var index = doc.layers.length - 1; index >= 0; index--) {
        var layer = doc.layers[index];
        if (layer.visible === false || layer.locked) continue;
        var layerRect = layerBox(layer, doc.width, doc.height);
        var local = localPoint(point, layerRect);
        if (Math.abs(local.x) <= layerRect.w / 2 + 6 && Math.abs(local.y) <= layerRect.h / 2 + 6) {
          hit = layer; break;
        }
      }
      if (!hit) {
        selectLayer(null);
        event.preventDefault();
        return;
      }
      selectLayer(hit.id);
      var target = layerBox(hit, doc.width, doc.height);
      drag = {
        mode: 'move', layer: hit, start: point, startBox: target,
        offsetX: point.x - target.cx, offsetY: point.y - target.cy,
        changed: false, committed: false
      };
      capture(event, overlay);
      event.preventDefault();
    });

    on(overlay, 'pointermove', function (event) {
      if (!drag) return;
      var point = overlayPoint(event, overlay);
      var layer = drag.layer;
      var box = drag.startBox;
      if (drag.mode === 'move') {
        layer.x = clamp((point.x - drag.offsetX) / doc.width * 100, 0, 100);
        layer.y = clamp((point.y - drag.offsetY) / doc.height * 100, 0, 100);
      } else if (drag.mode === 'resize') {
        var local = localPoint(point, box);
        var sx = drag.handle.indexOf('w') !== -1 ? 1 : -1;
        var sy = drag.handle.indexOf('n') !== -1 ? -1 : 1;
        var opposite = { x: -sx * box.w / 2, y: -sy * box.h / 2 };
        var newW = Math.max(doc.width * 0.02, Math.abs(local.x - opposite.x));
        var newH = Math.max(doc.height * 0.02, Math.abs(local.y - opposite.y));
        var centerLocal = { x: (local.x + opposite.x) / 2, y: (local.y + opposite.y) / 2 };
        var angle = box.rotation * Math.PI / 180;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        layer.w = clamp(newW / doc.width * 100, 2, 100);
        layer.h = clamp(newH / doc.height * 100, 2, 100);
        layer.x = clamp((box.cx + centerLocal.x * cos - centerLocal.y * sin) / doc.width * 100, 0, 100);
        layer.y = clamp((box.cy + centerLocal.x * sin + centerLocal.y * cos) / doc.height * 100, 0, 100);
      } else if (drag.mode === 'rotate') {
        var angleNow = Math.atan2(point.y - box.cy, point.x - box.cx);
        var degrees = drag.startRotation + (angleNow - drag.startAngle) * 180 / Math.PI;
        if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
        layer.rotation = Math.round(degrees);
      }
      drag.changed = true;
      syncLayerControls(layer);
      renderPreview();
      event.preventDefault();
    });

    function endDrag(event) {
      if (!drag) return;
      var current = drag;
      drag = null;
      if (current.changed && !current.committed) {
        current.committed = true;
        commit();
      }
      if (overlay.hasPointerCapture && event && event.pointerId != null) {
        try { overlay.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      }
    }
    on(overlay, 'pointerup', endDrag);
    on(overlay, 'pointercancel', endDrag);
    on(overlay, 'lostpointercapture', endDrag);

    function capture(event, target) {
      if (target.setPointerCapture && event.pointerId != null) {
        try { target.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      }
    }

    function nudge(event) {
      var layer = selectedLayer();
      if (!layer || layer.locked) return;
      var deltas = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
      };
      var delta = deltas[event.key];
      if (!delta) return;
      var step = event.shiftKey ? 10 : 1;
      layer.x = clamp(num(layer.x, 50) + delta[0] * step / doc.width * 100, 0, 100);
      layer.y = clamp(num(layer.y, 50) + delta[1] * step / doc.height * 100, 0, 100);
      syncLayerControls(layer); renderPreview(); commit();
      event.preventDefault();
    }
    on(overlay, 'keydown', nudge);
    on(canvas, 'keydown', nudge);
  }

  /* ---------- Zoom, modes, export ---------- */

  function applyZoom(zoom) {
    /* Change the stage's layout width, not a CSS transform: the frame keeps
     * scrolling and pointer mapping stays correct at every zoom level. */
    var inner = $('tg-stage-inner');
    if (inner) inner.style.width = Math.round(zoom * 100) + '%';
    setVal('tg-zoom-level', Math.round(zoom * 100) + '%');
  }
  function setZoom(zoom) {
    doc.zoom = clamp(zoom, 0.25, 4);
    applyZoom(doc.zoom);
    status('Preview zoom ' + Math.round(doc.zoom * 100) + '%.');
  }

  function setMode(mode) {
    doc.mode = mode === 'preview' ? 'preview' : 'controls';
    var mobile = global.MobileWorkspace;
    var handled = false;
    if (mobile && typeof mobile.setMode === 'function') {
      try { mobile.setMode(doc.mode); handled = true; } catch (error) { handled = false; }
    }
    if (!handled) {
      document.body.classList.toggle('tg-preview-mode', doc.mode === 'preview');
      document.body.classList.toggle('tg-controls-mode', doc.mode === 'controls');
      var workspace = document.querySelector('.image-workspace');
      if (workspace) {
        workspace.classList.toggle('tg-preview-mode', doc.mode === 'preview');
        workspace.classList.toggle('tg-controls-mode', doc.mode === 'controls');
      }
      var controls = document.querySelector('.image-controls');
      if (controls) controls.classList.toggle('tg-controls-hidden', doc.mode === 'preview');
    }
    ['tg-mode-preview', 'tg-mode-controls'].forEach(function (id) {
      var node = $(id);
      if (node) node.classList.toggle('is-active', (id === 'tg-mode-preview') === (doc.mode === 'preview'));
    });
    status(doc.mode === 'preview' ? 'Preview mode.' : 'Editing controls mode.');
  }

  function exportCanvas(format, quality) {
    var requested = String(format || val('tg-format', 'png') || 'png').toLowerCase();
    if (requested === 'jpg') requested = 'jpeg';
    if (requested !== 'jpeg' && requested !== 'webp') requested = 'png';
    var mime = 'image/' + requested;
    var amount = quality == null ? num(val('tg-quality', 0.92), 0.92) : num(quality, 0.92);
    var canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;
    var ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new Error('This browser cannot create an export canvas.'));
    paint(ctx, doc.width, doc.height);
    var target = canvas;
    if (requested === 'jpeg') {
      var flat = document.createElement('canvas');
      flat.width = doc.width;
      flat.height = doc.height;
      var flatCtx = flat.getContext('2d');
      flatCtx.fillStyle = '#ffffff';
      flatCtx.fillRect(0, 0, doc.width, doc.height);
      flatCtx.drawImage(canvas, 0, 0);
      target = flat;
    }
    return new Promise(function (resolve, reject) {
      try {
        target.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('This browser could not encode that format.'));
        }, mime, amount);
      } catch (error) { reject(error); }
    });
  }

  /* ---------- Binding ---------- */

  function bindControls() {
    on($('tg-layer-add'), 'click', addLayer);
    on($('tg-layer-update'), 'click', updateLayer);
    on($('tg-layer-duplicate'), 'click', duplicateSelected);
    on($('tg-layer-delete'), 'click', deleteSelected);
    on($('tg-layer-up'), 'click', function () {
      if (!selectedLayer()) { status('Select a layer first.', true); return; }
      if (!T.moveLayer(doc.layers, doc.selectedId, 1)) { status('Already at the top.', true); return; }
      commit(); renderLayerList(); renderPreview(); status('Layer moved forward.');
    });
    on($('tg-layer-down'), 'click', function () {
      if (!selectedLayer()) { status('Select a layer first.', true); return; }
      if (!T.moveLayer(doc.layers, doc.selectedId, -1)) { status('Already at the bottom.', true); return; }
      commit(); renderLayerList(); renderPreview(); status('Layer moved back.');
    });
    on($('tg-undo'), 'click', undo);
    on($('tg-redo'), 'click', redo);

    [['tg-align-left', 'left'], ['tg-align-center', 'center'], ['tg-align-right', 'right'],
      ['tg-align-top', 'top'], ['tg-align-middle', 'middle'], ['tg-align-bottom', 'bottom']]
      .forEach(function (item) { on($(item[0]), 'click', function () { alignSelected(item[1]); }); });

    on($('tg-text'), 'input', function () {
      var layer = selectedLayer();
      if (!layer || layer.type !== 'text') return;
      layer.text = $('tg-text').value;
      ensureFontOptions(layer.text, layer, true);
      renderLayerList(); renderPreview();
    });
    on($('tg-text'), 'change', function () {
      var layer = selectedLayer();
      if (layer && layer.type === 'text') commit();
    });

    var documentControls = ['tg-width', 'tg-height', 'tg-bg-type', 'tg-color1', 'tg-color2',
      'tg-padding', 'tg-radius', 'tg-shadow', 'tg-remove-bg', 'tg-bg-tolerance',
      'tg-guides', 'tg-safe-guides', 'tg-brightness', 'tg-contrast', 'tg-saturation',
      'tg-blur', 'tg-filter'];
    documentControls.forEach(function (id) {
      var node = $(id);
      on(node, 'input', function () { readDocumentControls(); renderPreview(); });
      on(node, 'change', function () { readDocumentControls(); renderPreview(); commit(); });
    });

    /* Layer type is intentionally excluded: changing it prepares the type for
     * Add layer / Update instead of silently converting the selected layer. */
    var layerControls = ['tg-layer-name', 'tg-direction', 'tg-font', 'tg-font-weight',
      'tg-italic', 'tg-font-size', 'tg-line-height', 'tg-letter-spacing', 'tg-text-color',
      'tg-gradient', 'tg-outline-color', 'tg-outline-width', 'tg-text-shadow', 'tg-shadow-color',
      'tg-shadow-blur', 'tg-text-bg', 'tg-align', 'tg-layer-rotation', 'tg-layer-x', 'tg-layer-y',
      'tg-layer-w', 'tg-layer-h', 'tg-layer-opacity', 'tg-layer-blend', 'tg-layer-visible',
      'tg-layer-locked', 'tg-image-src', 'tg-image-fit', 'tg-image-flip-x', 'tg-image-flip-y',
      'tg-crop-left', 'tg-crop-top', 'tg-crop-right', 'tg-crop-bottom', 'tg-image-border',
      'tg-image-border-color', 'tg-image-radius', 'tg-image-shadow', 'tg-image-remove-bg',
      'tg-shape', 'tg-sticker-glyph'];
    layerControls.forEach(function (id) {
      var node = $(id);
      on(node, 'input', function () {
        if (!applyControlsToSelected()) return;
        var layer = selectedLayer();
        if (layer && layer.type === 'text' && id !== 'tg-text') ensureFontOptions(layer.text, layer, false);
        if (id === 'tg-layer-name' || id === 'tg-layer-type') renderLayerList();
        if (id === 'tg-image-src') imageCache.clear();
        renderPreview();
      });
      on(node, 'change', function () {
        if (!applyControlsToSelected()) return;
        if ($(id) && $(id).id === 'tg-image-src') imageCache.clear();
        renderLayerList(); renderPreview(); commit();
      });
    });

    on($('tg-layer-type'), 'change', function () {
      /* The selected layer keeps its type until Update is clicked; the new type
       * is used by Add layer. */
      status('Layer type set to ' + val('tg-layer-type', 'text') + '. Click Add layer or Update.');
    });

    on($('tg-preset'), 'change', function () { applyPreset(val('tg-preset', 'youtube')); });
    all('#tg-preset-chips [data-value]').forEach(function (chip) {
      on(chip, 'click', function () {
        applyPreset(chip.dataset.value);
        all('#tg-preset-chips .chip').forEach(function (other) { other.classList.toggle('is-active', other === chip); });
      });
    });
    all('#tg-templates [data-value]').forEach(function (chip) {
      on(chip, 'click', function () { applyTemplate(chip.dataset.value); });
    });
    all('#tg-stickers [data-value]').forEach(function (chip) {
      on(chip, 'click', function () {
        var layer = T.makeLayer('sticker', {
          name: 'Sticker ' + chip.dataset.value, glyph: chip.dataset.value,
          shape: chip.dataset.value, x: 80, y: 20, w: 12, h: 16
        });
        doc.layers.push(layer);
        doc.selectedId = layer.id;
        renderLayerList(); syncLayerControls(layer); commit(); renderPreview();
        status('Sticker added. Drag it into place.');
      });
    });

    on($('tg-project-save'), 'click', saveProject);
    on($('tg-project-load'), 'click', function () { var node = $('tg-project-file'); if (node) node.click(); });
    on($('tg-project-file'), 'change', function () {
      var node = $('tg-project-file');
      loadProjectFromFile(node && node.files && node.files[0]);
    });
    on($('tg-reset-project'), 'click', function () { resetProject(false); });

    on($('tg-zoom-in'), 'click', function () { setZoom(doc.zoom * 1.25); });
    on($('tg-zoom-out'), 'click', function () { setZoom(doc.zoom / 1.25); });
    on($('tg-zoom-fit'), 'click', function () { setZoom(1); });
    on($('tg-fullscreen'), 'click', function () {
      var stage = $('tg-stage') || $('image-preview');
      if (!stage) return;
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () { /* ignore */ });
      } else if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(function () { status('Fullscreen was blocked by this browser.', true); });
      } else status('Fullscreen is not supported in this browser.', true);
    });
    on(document, 'fullscreenchange', function () { renderPreview(); applyZoom(doc.zoom); });
    on($('tg-mode-preview'), 'click', function () { setMode('preview'); });
    on($('tg-mode-controls'), 'click', function () { setMode('controls'); });

    on($('tg-format'), 'change', function () {
      var quality = $('tg-quality');
      if (quality) quality.disabled = val('tg-format', 'png') === 'png';
    });

    on($('image-download'), 'click', async function () {
      try {
        var format = val('tg-format', 'png');
        var blob = await exportCanvas(format, num(val('tg-quality', 0.92), 0.92));
        downloadBlob(blob, T.exportName(doc.preset, format));
        status('Thumbnail downloaded.');
      } catch (error) { status(error.message, true); }
    });

    on(global, 'pagehide', releaseUrls);
  }

  /* ---------- Public API ---------- */

  function state() {
    return {
      preset: doc.preset,
      width: doc.width,
      height: doc.height,
      background: clone(doc.background),
      settings: clone(doc.settings),
      layers: clone(doc.layers),
      images: imageList().map(function (entry) { return { id: entry.id, name: entry.name }; }),
      selectedId: doc.selectedId,
      zoom: doc.zoom,
      mode: doc.mode,
      canUndo: history.canUndo,
      canRedo: history.canRedo
    };
  }

  function init() {
    if (initialized) return;
    if (!$('image-preview') || !$('tg-overlay')) return;
    if (!T) {
      status('The thumbnail core did not load. Reload the page and try again.', true);
      return;
    }
    initialized = true;
    captureRangeSuffixes();
    try {
      var probe = document.createElement('canvas').getContext('2d');
      supportsLetterSpacing = Boolean(probe && 'letterSpacing' in probe);
    } catch (error) { supportsLetterSpacing = false; }
    /* Start in preview mode on small screens; the shared workspace controller
     * owns the Preview/Controls switch. */
    setMode('preview');
    syncImageSrcOptions();
    bindUpload();
    bindPointer();
    bindControls();
    resetProject(true);
    var quality = $('tg-quality');
    if (quality) quality.disabled = val('tg-format', 'png') === 'png';
  }

  global.ThumbnailEditor = {
    init: init,
    state: state,
    project: project,
    exportCanvas: exportCanvas,
    setMode: setMode,
    setZoom: setZoom
  };

  ready(init);
})(typeof globalThis !== 'undefined' ? globalThis : this);
