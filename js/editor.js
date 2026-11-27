/* LetitEdit Image & Photo Editor
 * Browser-side editor: import, crop, resize, adjustments, filters, layers,
 * text, shapes, drawing, framing and export.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-editor]');
  if (!root) return;

  var $ = function (selector, scope) { return (scope || root).querySelector(selector); };
  var $$ = function (selector, scope) { return Array.prototype.slice.call((scope || root).querySelectorAll(selector)); };
  var canvas = $('[data-canvas]');
  var screenCtx = canvas ? canvas.getContext('2d') : null;
  if (!canvas || !screenCtx) return;

  var els = {
    canvas: canvas,
    scroll: $('[data-canvas-scroll]'),
    panel: $('[data-panel]'),
    panelBody: $('[data-panel-body]'),
    panelTitle: $('[data-panel-title]'),
    fileName: $('[data-file-name]'),
    statusLeft: $('[data-status-left]'),
    statusRight: $('[data-status-right]'),
    zoomLabel: $('[data-zoom-label]'),
    fileInput: $('[data-file-input]'),
    bgInput: $('[data-bg-input]'),
    layerInput: $('[data-layer-input]'),
    dropOverlay: $('[data-drop-overlay]'),
    toast: $('[data-toast]'),
    progress: $('[data-progress]'),
    progressBar: $('[data-progress-bar]'),
    progressLabel: $('[data-progress-label]'),
    sheetBackdrop: $('[data-sheet-backdrop]'),
    resizer: $('[data-panel-resizer]')
  };

  var DEFAULT_ADJUSTMENTS = {
    brightness: 0, contrast: 0, exposure: 0, saturation: 0, vibrance: 0,
    temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    gamma: 1, sharpness: 0, clarity: 0, fade: 0, vignette: 0, grain: 0
  };
  var DEFAULT_FRAME = {
    padding: 0, background: 'transparent', color: '#ffffff',
    gradientFrom: '#5c2ddd', gradientTo: '#f2edff', gradientAngle: 135,
    image: null, radius: 0, borderWidth: 0, borderColor: '#ffffff', shadow: false
  };
  var DEFAULT_RESIZE = { width: 0, height: 0, lock: true, custom: false, resample: 'smooth' };

  var state = createState();
  var view = { scale: 1, offsetX: 0, offsetY: 0, imageW: 0, imageH: 0, drawW: 0, drawH: 0, fit: 1 };
  var previewCanvas = null;
  var previewToken = 0;
  var previewTimer = null;
  var previewBusy = false;
  var estimateTimer = null;
  var toastTimer = null;
  var interaction = null;
  var pointers = new Map();
  var pinch = null;
  var worker = null;
  var workerSeq = 0;
  var workerJobs = new Map();
  var history = [];
  var historyIndex = -1;
  var supports = { 'image/avif': false, 'image/webp': true };
  var checkerPattern = null;

  var FILTERS = [
    ['none', 'None'], ['bw', 'B&W'], ['grayscale', 'Grayscale'], ['sepia', 'Sepia'],
    ['vintage', 'Vintage'], ['warm', 'Warm'], ['cool', 'Cool'], ['cinematic', 'Cinematic'],
    ['portrait', 'Portrait'], ['landscape', 'Landscape'], ['dramatic', 'Dramatic'],
    ['soft', 'Soft'], ['matte', 'Matte'], ['high-contrast', 'High contrast'],
    ['film', 'Film'], ['vivid', 'Vivid'], ['noir', 'Noir'], ['sunset', 'Sunset'], ['arctic', 'Arctic']
  ];
  var ADJUSTMENT_GROUPS = [
    ['Light', [
      ['brightness', 'Brightness', -100, 100, 1, ''],
      ['contrast', 'Contrast', -100, 100, 1, ''],
      ['exposure', 'Exposure', -100, 100, 1, ''],
      ['highlights', 'Highlights', -100, 100, 1, ''],
      ['shadows', 'Shadows', -100, 100, 1, ''],
      ['whites', 'Whites', -100, 100, 1, ''],
      ['blacks', 'Blacks', -100, 100, 1, ''],
      ['gamma', 'Gamma', 0.2, 3, 0.01, '']
    ]],
    ['Colour', [
      ['saturation', 'Saturation', -100, 100, 1, ''],
      ['vibrance', 'Vibrance', -100, 100, 1, ''],
      ['temperature', 'Temperature', -100, 100, 1, ''],
      ['tint', 'Tint', -100, 100, 1, '']
    ]],
    ['Detail and effects', [
      ['sharpness', 'Sharpness', 0, 100, 1, ''],
      ['clarity', 'Clarity', 0, 100, 1, ''],
      ['fade', 'Fade', 0, 100, 1, ''],
      ['vignette', 'Vignette', 0, 100, 1, ''],
      ['grain', 'Grain', 0, 100, 1, '']
    ]]
  ];
  var CROP_RATIOS = [
    ['Free', 0], ['1:1', 1], ['4:5', 0.8], ['5:4', 1.25], ['3:2', 1.5], ['2:3', 2 / 3],
    ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 0.75]
  ];
  var RESIZE_PRESETS = [
    ['1920 × 1080', 1920, 1080], ['1080 × 1080', 1080, 1080], ['1080 × 1350', 1080, 1350],
    ['1200 × 628', 1200, 628], ['2560 × 1440', 2560, 1440], ['3840 × 2160', 3840, 2160]
  ];
  var FORMATS = [
    ['image/jpeg', 'JPG', 'jpg'], ['image/png', 'PNG', 'png'], ['image/webp', 'WebP', 'webp'],
    ['image/avif', 'AVIF', 'avif'], ['image/bmp', 'BMP', 'bmp']
  ];
  var TEXT_FONTS = [
    ['Arial, Helvetica, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'],
    ['"Times New Roman", Times, serif', 'Times New Roman'], ['"Courier New", monospace', 'Courier New'],
    ['Verdana, Geneva, sans-serif', 'Verdana'], ['Tahoma, Geneva, sans-serif', 'Tahoma'],
    ['"Segoe UI", system-ui, sans-serif', 'Segoe UI'], ['"Noto Sans", Arial, sans-serif', 'Noto Sans'],
    ['"Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif', 'Noto Sans Arabic'],
    ['Amiri, "Times New Roman", serif', 'Amiri']
  ];

  function createState() {
    return {
      source: null,
      base: null,
      transform: { rotation: 0, straighten: 0, flipH: false, flipV: false },
      crop: null,
      cropAspect: 0,
      resize: Object.assign({}, DEFAULT_RESIZE),
      frame: Object.assign({}, DEFAULT_FRAME),
      adjustments: Object.assign({}, DEFAULT_ADJUSTMENTS),
      filter: { name: 'none', intensity: 100 },
      blur: { type: 'none', amount: 12, angle: 0 },
      draw: { color: '#5c2ddd', size: 12, opacity: 100, eraser: false },
      layers: [],
      activeLayerId: null,
      tool: 'import',
      compare: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      export: { format: 'image/jpeg', quality: 92, filename: 'letitedit-image', targetKB: 0, transparency: true, lastResult: null },
      busy: false
    };
  }

  /* ---------- Small utilities ---------- */
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function round(value) { return Math.round(value); }
  function createCanvas(width, height) {
    var element = document.createElement('canvas');
    element.width = Math.max(1, Math.round(width));
    element.height = Math.max(1, Math.round(height));
    return element;
  }
  function cloneCanvas(source) {
    var copy = createCanvas(source.width, source.height);
    copy.getContext('2d').drawImage(source, 0, 0);
    return copy;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function mimeLabel(type) {
    var map = {
      'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF',
      'image/bmp': 'BMP', 'image/tiff': 'TIFF', 'image/avif': 'AVIF', 'image/heic': 'HEIC',
      'image/heif': 'HEIF', 'image/svg+xml': 'SVG'
    };
    return map[type] || (type ? type.replace('image/', '').toUpperCase() : 'Image');
  }
  function extensionFor(type) {
    var found = FORMATS.filter(function (item) { return item[0] === type; })[0];
    return found ? found[2] : 'png';
  }
  function sanitizeFilename(name) {
    return String(name || 'letitedit-image').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'letitedit-image';
  }
  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }
  function activeLayer() {
    return state.layers.filter(function (layer) { return layer.id === state.activeLayerId; })[0] || null;
  }
  function isLayerTool(tool) {
    tool = tool || state.tool;
    return tool === 'text' || tool === 'shapes' || tool === 'layers';
  }
  function uid() { return 'layer-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function nextFrame() { return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); }); }

  function toast(message, isError) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', !!isError);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, isError ? 5200 : 3200);
  }
  function showProgress(label, percent) {
    if (!els.progress) return;
    els.progress.hidden = false;
    if (els.progressLabel) els.progressLabel.textContent = label || 'Working…';
    if (els.progressBar) els.progressBar.style.width = clamp(percent || 0, 0, 100) + '%';
  }
  function hideProgress() {
    if (els.progress) els.progress.hidden = true;
    if (els.progressBar) els.progressBar.style.width = '0%';
  }

  function loadScriptOnce(url) {
    if (loadScriptOnce.cache && loadScriptOnce.cache[url]) return loadScriptOnce.cache[url];
    var promise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-lazy="' + url + '"]');
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else {
          existing.addEventListener('load', function () { resolve(); });
          existing.addEventListener('error', function () { reject(new Error('Could not load ' + url)); });
        }
        return;
      }
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.lazy = url;
      script.onload = function () { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = function () { reject(new Error('Could not load ' + url)); };
      document.head.appendChild(script);
    });
    loadScriptOnce.cache = loadScriptOnce.cache || {};
    loadScriptOnce.cache[url] = promise;
    return promise;
  }

  /* ---------- Worker pixel processing ---------- */
  function getWorker() {
    if (worker) return worker;
    if (!window.Worker) return null;
    try {
      worker = new Worker('../../js/editor-worker.js');
      worker.onmessage = function (event) {
        var message = event.data || {};
        var job = workerJobs.get(message.id);
        if (!job) return;
        workerJobs.delete(message.id);
        if (message.type === 'error') {
          job.reject(new Error(message.message || 'Image processing failed.'));
          return;
        }
        try {
          job.resolve(new ImageData(new Uint8ClampedArray(message.buffer), message.width, message.height));
        } catch (error) {
          job.reject(error);
        }
      };
      worker.onerror = function () {
        workerJobs.forEach(function (job) { job.reject(new Error('The image worker stopped unexpectedly.')); });
        workerJobs.clear();
        worker = null;
      };
    } catch (error) {
      worker = null;
    }
    return worker;
  }

  function processPixels(imageData, settings) {
    var instance = getWorker();
    if (!instance) {
      if (!window.LetitEditImageProcessing) {
        return Promise.reject(new Error('The image processing engine did not load.'));
      }
      try {
        window.LetitEditImageProcessing.processImageData(imageData, settings);
        return Promise.resolve(imageData);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise(function (resolve, reject) {
      var id = ++workerSeq;
      workerJobs.set(id, { resolve: resolve, reject: reject });
      try {
        instance.postMessage({
          type: 'process', id: id, width: imageData.width, height: imageData.height,
          buffer: imageData.data.buffer, settings: settings
        }, [imageData.data.buffer]);
      } catch (error) {
        workerJobs.delete(id);
        reject(error);
      }
    });
  }

  /* ---------- Source and base ---------- */
  function inscribedCrop(baseW, baseH, sourceW, sourceH, angle) {
    if (Math.abs(angle % (Math.PI / 2)) < 1e-6) {
      return { x: 0, y: 0, w: baseW, h: baseH };
    }
    var cos = Math.cos(-angle);
    var sin = Math.sin(-angle);
    var lo = 0;
    var hi = 1;
    for (var i = 0; i < 40; i += 1) {
      var s = (lo + hi) / 2;
      var hw = sourceW * s / 2;
      var hh = sourceH * s / 2;
      var fits = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].every(function (corner) {
        var rx = corner[0] * cos - corner[1] * sin;
        var ry = corner[0] * sin + corner[1] * cos;
        return Math.abs(rx) <= sourceW / 2 + 0.001 && Math.abs(ry) <= sourceH / 2 + 0.001;
      });
      if (fits) lo = s;
      else hi = s;
    }
    var width = Math.max(10, Math.round(sourceW * lo));
    var height = Math.max(10, Math.round(sourceH * lo));
    return {
      x: Math.round((baseW - width) / 2),
      y: Math.round((baseH - height) / 2),
      w: width,
      h: height
    };
  }

  function rebuildBase(resetCrop) {
    if (!state.source) return;
    var source = state.source;
    var transform = state.transform;
    var angle = ((transform.rotation || 0) + (transform.straighten || 0)) * Math.PI / 180;
    var cos = Math.abs(Math.cos(angle));
    var sin = Math.abs(Math.sin(angle));
    var width = Math.max(1, Math.ceil(source.width * cos + source.height * sin - 1e-6));
    var height = Math.max(1, Math.ceil(source.width * sin + source.height * cos - 1e-6));
    var baseCanvas = createCanvas(width, height);
    var ctx = baseCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);
    ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
    ctx.drawImage(source.canvas, -source.width / 2, -source.height / 2, source.width, source.height);
    state.base = { canvas: baseCanvas, width: width, height: height };
    if (resetCrop || !state.crop) {
      state.crop = inscribedCrop(width, height, source.width, source.height, angle);
    } else {
      state.crop = clampCrop(state.crop);
    }
    if (!state.resize.custom) {
      state.resize.width = state.crop.w;
      state.resize.height = state.crop.h;
    }
  }

  function clampCrop(rect) {
    if (!state.base) return rect;
    var maxW = state.base.width;
    var maxH = state.base.height;
    var w = clamp(Math.round(rect.w || maxW), 10, maxW);
    var h = clamp(Math.round(rect.h || maxH), 10, maxH);
    var x = clamp(Math.round(rect.x || 0), 0, maxW - w);
    var y = clamp(Math.round(rect.y || 0), 0, maxH - h);
    return { x: x, y: y, w: w, h: h };
  }

  function getOutputSize() {
    if (!state.base || !state.crop) return { width: 0, height: 0 };
    var width = state.resize.custom ? state.resize.width : state.crop.w;
    var height = state.resize.custom ? state.resize.height : state.crop.h;
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  function getFinalSize() {
    var out = getOutputSize();
    var padding = Math.max(0, Math.round(state.frame.padding || 0));
    return { width: Math.max(1, out.width + padding * 2), height: Math.max(1, out.height + padding * 2) };
  }

  function getSettings() {
    return {
      adjustments: state.adjustments,
      filter: state.filter,
      blur: state.blur,
      seed: 17
    };
  }

  /* ---------- Rendering ---------- */
  function hasToneWork() {
    var a = state.adjustments;
    if (state.filter.name !== 'none' && state.filter.intensity > 0) return true;
    return Object.keys(DEFAULT_ADJUSTMENTS).some(function (key) {
      return Number(a[key]) !== Number(DEFAULT_ADJUSTMENTS[key]);
    });
  }

  function applyBlurEffects(target, renderScale) {
    var blur = state.blur;
    if (!blur || blur.type === 'none' || !blur.amount) return target;
    var width = target.width;
    var height = target.height;
    var amount = Math.max(0, Number(blur.amount) || 0) * (renderScale || 1);
    var output = createCanvas(width, height);
    var ctx = output.getContext('2d');
    if (blur.type === 'gaussian') {
      ctx.filter = 'blur(' + amount + 'px)';
      ctx.drawImage(target, 0, 0);
      return output;
    }
    if (blur.type === 'pixelate') {
      var block = Math.max(2, Math.round(amount / 4));
      var small = createCanvas(Math.max(1, Math.floor(width / block)), Math.max(1, Math.floor(height / block)));
      var smallCtx = small.getContext('2d');
      smallCtx.imageSmoothingEnabled = false;
      smallCtx.drawImage(target, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, width, height);
      return output;
    }
    if (blur.type === 'motion') {
      var angle = (Number(blur.angle) || 0) * Math.PI / 180;
      var distance = amount;
      var steps = 12;
      ctx.globalAlpha = 1 / steps;
      for (var i = 0; i < steps; i += 1) {
        var offset = (i / (steps - 1) - 0.5) * distance;
        ctx.drawImage(target, Math.cos(angle) * offset, Math.sin(angle) * offset);
      }
      ctx.globalAlpha = 1;
      return output;
    }
    return target;
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    var r = Math.min(Math.max(0, radius || 0), width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function fillFrameBackground(ctx, width, height) {
    var frame = state.frame;
    if (frame.background === 'transparent') return;
    if (frame.background === 'color') {
      ctx.fillStyle = frame.color || '#ffffff';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (frame.background === 'gradient') {
      var angle = (Number(frame.gradientAngle) || 0) * Math.PI / 180;
      var cx = width / 2;
      var cy = height / 2;
      var length = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
      var x1 = cx - Math.cos(angle) * length / 2;
      var y1 = cy - Math.sin(angle) * length / 2;
      var x2 = cx + Math.cos(angle) * length / 2;
      var y2 = cy + Math.sin(angle) * length / 2;
      var gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      gradient.addColorStop(0, frame.gradientFrom || '#5c2ddd');
      gradient.addColorStop(1, frame.gradientTo || '#f2edff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (frame.background === 'image' && frame.image) {
      var image = frame.image;
      var scale = Math.max(width / image.width, height / image.height);
      var drawW = image.width * scale;
      var drawH = image.height * scale;
      ctx.drawImage(image, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
    }
  }

  function textFont(text) {
    return (text.italic ? 'italic ' : '') + (text.bold ? '700 ' : '400 ') +
      Math.max(4, Number(text.fontSize) || 32) + 'px ' + (text.fontFamily || 'Arial, sans-serif');
  }

  function wrapLines(ctx, content, maxWidth) {
    var lines = [];
    String(content == null ? '' : content).split('\n').forEach(function (paragraph) {
      if (!paragraph) { lines.push(''); return; }
      var words = paragraph.split(/\s+/);
      var current = '';
      words.forEach(function (word) {
        var candidate = current ? current + ' ' + word : word;
        if (ctx.measureText(candidate).width > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      });
      lines.push(current);
    });
    return lines;
  }

  function textLayerHeight(layer) {
    var text = layer.text || {};
    var measure = createCanvas(8, 8).getContext('2d');
    measure.font = textFont(text);
    var pad = Math.max(4, (Number(text.fontSize) || 32) * 0.12);
    var lines = wrapLines(measure, text.content, Math.max(10, layer.w - pad * 2));
    var lineHeight = Math.max(1, (Number(text.fontSize) || 32) * (Number(text.lineHeight) || 1.2));
    return Math.max(lineHeight + pad * 2, lines.length * lineHeight + pad * 2);
  }

  function drawTextLayer(ctx, layer, scaleX, scaleY, offsetX, offsetY) {
    var text = layer.text;
    if (!text) return;
    var centerX = (layer.x + layer.w / 2) * scaleX + offsetX;
    var centerY = (layer.y + layer.h / 2) * scaleY + offsetY;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.translate(centerX, centerY);
    ctx.rotate((Number(layer.rotation) || 0) * Math.PI / 180);
    ctx.scale(scaleX, scaleY);
    var w = layer.w;
    var h = layer.h;
    var pad = Math.max(4, text.fontSize * 0.12);
    if (text.bgEnabled) {
      ctx.fillStyle = text.bgColor || '#000000';
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, Math.min(12, h / 6));
      ctx.fill();
    }
    ctx.font = textFont(text);
    ctx.textBaseline = 'top';
    ctx.textAlign = text.align || 'center';
    ctx.direction = text.direction === 'auto'
      ? (/[\u0590-\u08FF]/.test(text.content || '') ? 'rtl' : 'ltr')
      : text.direction;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (Number(text.letterSpacing) || 0) + 'px';
    var maxWidth = Math.max(10, w - pad * 2);
    var lines = wrapLines(ctx, text.content, maxWidth);
    var lineHeight = Math.max(1, (Number(text.fontSize) || 32) * (Number(text.lineHeight) || 1.2));
    var totalHeight = lines.length * lineHeight;
    var startY = -totalHeight / 2;
    var x = text.align === 'left' ? -w / 2 + pad : text.align === 'right' ? w / 2 - pad : 0;
    if (text.shadowEnabled) {
      ctx.shadowColor = text.shadowColor || '#000000';
      ctx.shadowBlur = Number(text.shadowBlur) || 0;
      ctx.shadowOffsetX = Number(text.shadowOffsetX) || 0;
      ctx.shadowOffsetY = Number(text.shadowOffsetY) || 0;
    }
    lines.forEach(function (line, index) {
      var y = startY + index * lineHeight + (lineHeight - text.fontSize) / 2;
      if (text.outlineEnabled && text.outlineWidth > 0) {
        ctx.lineWidth = text.outlineWidth;
        ctx.strokeStyle = text.outlineColor || '#000000';
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = text.color || '#ffffff';
      ctx.fillText(line, x, y);
      if (text.underline) {
        var measured = ctx.measureText(line).width;
        var lineX = text.align === 'left' ? x : text.align === 'right' ? x - measured : x - measured / 2;
        ctx.fillRect(lineX, y + text.fontSize + 2, measured, Math.max(1, text.fontSize / 14));
      }
    });
    ctx.restore();
  }

  function drawShapeLayer(ctx, layer, scaleX, scaleY, offsetX, offsetY) {
    var shape = layer.shape;
    if (!shape) return;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.translate((layer.x + layer.w / 2) * scaleX + offsetX, (layer.y + layer.h / 2) * scaleY + offsetY);
    ctx.rotate((Number(layer.rotation) || 0) * Math.PI / 180);
    ctx.scale(scaleX, scaleY);
    var w = layer.w;
    var h = layer.h;
    var halfW = w / 2;
    var halfH = h / 2;
    ctx.beginPath();
    if (shape.kind === 'rectangle') {
      roundedRectPath(ctx, -halfW, -halfH, w, h, 0);
    } else if (shape.kind === 'rounded-rectangle') {
      roundedRectPath(ctx, -halfW, -halfH, w, h, Math.min(Number(shape.radius) || 0, Math.min(w, h) / 2));
    } else if (shape.kind === 'circle' || shape.kind === 'ellipse') {
      ctx.ellipse(0, 0, Math.abs(halfW), Math.abs(halfH), 0, 0, Math.PI * 2);
    } else if (shape.kind === 'line' || shape.kind === 'arrow') {
      ctx.moveTo(-halfW, halfH);
      ctx.lineTo(halfW, -halfH);
    }
    if (shape.fillEnabled && shape.kind !== 'line' && shape.kind !== 'arrow') {
      ctx.fillStyle = shape.fill || '#5c2ddd';
      ctx.fill();
    }
    if (shape.strokeEnabled || shape.kind === 'line' || shape.kind === 'arrow') {
      ctx.strokeStyle = shape.stroke || '#ffffff';
      ctx.lineWidth = Math.max(1, Number(shape.strokeWidth) || 4);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (shape.kind === 'arrow') {
      var angle = Math.atan2(-h, w);
      var head = Math.max(10, (Number(shape.strokeWidth) || 4) * 4);
      ctx.save();
      ctx.translate(halfW, -halfH);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-head, head / 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(-head, -head / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawLayers(ctx, scaleX, scaleY, offsetX, offsetY) {
    state.layers.forEach(function (layer) {
      if (!layer.visible || layer.opacity <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = layer.blend || 'source-over';
      if (layer.type === 'text') {
        drawTextLayer(ctx, layer, scaleX, scaleY, offsetX, offsetY);
      } else if (layer.type === 'shape') {
        drawShapeLayer(ctx, layer, scaleX, scaleY, offsetX, offsetY);
      } else if (layer.canvas) {
        ctx.globalAlpha = clamp(layer.opacity, 0, 1);
        ctx.translate((layer.x + layer.w / 2) * scaleX + offsetX, (layer.y + layer.h / 2) * scaleY + offsetY);
        ctx.rotate((Number(layer.rotation) || 0) * Math.PI / 180);
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(layer.canvas, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
      }
      ctx.restore();
    });
  }

  async function renderComposite(targetW, targetH, scale) {
    var width = Math.max(1, Math.round(targetW));
    var height = Math.max(1, Math.round(targetH));
    var output = createCanvas(width, height);
    var ctx = output.getContext('2d');
    var padding = Math.max(0, Math.round(state.frame.padding * scale));
    var innerW = Math.max(1, width - padding * 2);
    var innerH = Math.max(1, height - padding * 2);
    var radius = Math.max(0, Number(state.frame.radius) * scale);
    fillFrameBackground(ctx, width, height);
    if (state.frame.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.42)';
      ctx.shadowBlur = 24 * scale;
      ctx.shadowOffsetY = 8 * scale;
      ctx.fillStyle = state.frame.background === 'transparent' ? 'rgba(0,0,0,.001)' : (state.frame.color || '#ffffff');
      roundedRectPath(ctx, padding, padding, innerW, innerH, radius);
      ctx.fill();
      ctx.restore();
    }
    var inner = createCanvas(innerW, innerH);
    var innerCtx = inner.getContext('2d');
    if (state.source && state.base && state.crop) {
      innerCtx.imageSmoothingEnabled = state.resize.resample !== 'nearest';
      innerCtx.imageSmoothingQuality = 'high';
      innerCtx.drawImage(state.base.canvas, state.crop.x, state.crop.y, state.crop.w, state.crop.h, 0, 0, innerW, innerH);
      var blurred = applyBlurEffects(inner, scale);
      if (blurred !== inner) {
        innerCtx.clearRect(0, 0, innerW, innerH);
        innerCtx.drawImage(blurred, 0, 0);
      }
      if (hasToneWork()) {
        try {
          var imageData = innerCtx.getImageData(0, 0, innerW, innerH);
          var processed = await processPixels(imageData, getSettings());
          innerCtx.putImageData(processed, 0, 0);
        } catch (error) {
          toast(error.message || 'Adjustments could not be applied.', true);
        }
      }
      var scaleX = innerW / state.crop.w;
      var scaleY = innerH / state.crop.h;
      drawLayers(innerCtx, scaleX, scaleY, -state.crop.x * scaleX, -state.crop.y * scaleY);
    }
    ctx.save();
    roundedRectPath(ctx, padding, padding, innerW, innerH, radius);
    ctx.clip();
    ctx.drawImage(inner, padding, padding);
    ctx.restore();
    var borderWidth = Math.max(0, Number(state.frame.borderWidth) * scale);
    if (borderWidth > 0) {
      ctx.save();
      roundedRectPath(ctx, padding + borderWidth / 2, padding + borderWidth / 2, innerW - borderWidth, innerH - borderWidth, Math.max(0, radius - borderWidth / 2));
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = state.frame.borderColor || '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
    return output;
  }

  /* ---------- Preview and view ---------- */
  function getPreviewScale(finalSize) {
    var max = isMobile() ? 1100 : 1800;
    return Math.min(1, max / Math.max(finalSize.width, finalSize.height));
  }

  function schedulePreview(fast) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      if (previewBusy) {
        schedulePreview(fast);
        return;
      }
      previewBusy = true;
      Promise.resolve(renderPreview(fast)).catch(function () {}).then(function () {
        previewBusy = false;
      });
      if (fast) {
        setTimeout(function () { schedulePreview(false); }, 240);
      }
    }, fast ? 0 : 30);
  }

  async function renderPreview(fast) {
    var token = ++previewToken;
    if (!state.source) {
      previewCanvas = null;
      drawToScreen();
      updateStatus();
      return;
    }
    if (state.compare) {
      previewCanvas = state.source.canvas;
      if (token === previewToken) { drawToScreen(); updateStatus(); }
      return;
    }
    if (state.tool === 'crop' && state.base) {
      previewCanvas = state.base.canvas;
      if (token === previewToken) { drawToScreen(); updateStatus(); }
      return;
    }
    var finalSize = getFinalSize();
    var scale = getPreviewScale(finalSize);
    if (fast) scale = Math.min(scale, 900 / Math.max(finalSize.width, finalSize.height));
    try {
      var rendered = await renderComposite(finalSize.width * scale, finalSize.height * scale, scale);
      if (token !== previewToken) return;
      previewCanvas = rendered;
      drawToScreen();
      updateStatus();
    } catch (error) {
      if (token !== previewToken) return;
      toast(error.message || 'The preview could not be rendered.', true);
    }
  }

  function resizeScreenCanvas() {
    var rect = els.scroll.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var width = Math.max(1, Math.round(rect.width * dpr));
    var height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    return { width: rect.width, height: rect.height, dpr: dpr };
  }

  function canvasPadding() {
    return isMobile() ? 14 : 24;
  }

  function updateCanvasClip(rect) {
    if (!isMobile() || !state.source) {
      canvas.style.clipPath = '';
      return;
    }
    var left = Math.max(0, view.offsetX);
    var top = Math.max(0, view.offsetY);
    var right = Math.max(0, rect.width - (view.offsetX + view.drawW));
    var bottom = Math.max(0, rect.height - (view.offsetY + view.drawH));
    canvas.style.clipPath = 'inset(' + top.toFixed(2) + 'px ' + right.toFixed(2) + 'px ' +
      bottom.toFixed(2) + 'px ' + left.toFixed(2) + 'px)';
  }

  function computeView(imageW, imageH, rect) {
    var padding = canvasPadding();
    var fit = Math.min((rect.width - padding * 2) / imageW, (rect.height - padding * 2) / imageH);
    fit = Math.max(0.01, fit);
    var scale = fit * state.zoom;
    var drawW = imageW * scale;
    var drawH = imageH * scale;
    var margin = 44;
    view = {
      scale: scale,
      fit: fit,
      imageW: imageW,
      imageH: imageH,
      drawW: drawW,
      drawH: drawH,
      offsetX: clamp((rect.width - drawW) / 2 + state.panX, margin - drawW, rect.width - margin),
      offsetY: clamp((rect.height - drawH) / 2 + state.panY, margin - drawH, rect.height - margin)
    };
    return view;
  }

  function getLogicalSize() {
    if (!state.source) return { width: 1, height: 1 };
    if (state.compare) return { width: state.source.width, height: state.source.height };
    if (state.tool === 'crop' && state.base) return { width: state.base.width, height: state.base.height };
    return getFinalSize();
  }

  function ensureChecker() {
    if (checkerPattern) return checkerPattern;
    var tile = createCanvas(16, 16);
    var ctx = tile.getContext('2d');
    ctx.fillStyle = '#c7ccd9';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#f1f3f8';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillRect(8, 8, 8, 8);
    checkerPattern = screenCtx.createPattern(tile, 'repeat');
    return checkerPattern;
  }

  function drawToScreen() {
    var rect = resizeScreenCanvas();
    screenCtx.setTransform(rect.dpr, 0, 0, rect.dpr, 0, 0);
    screenCtx.clearRect(0, 0, rect.width, rect.height);
    var display = state.compare && state.source ? state.source.canvas : previewCanvas;
    if (!display && state.source) display = state.base ? state.base.canvas : state.source.canvas;
    if (!display || !state.source) {
      canvas.style.pointerEvents = 'none';
      canvas.style.clipPath = '';
      screenCtx.fillStyle = '#7f87a5';
      screenCtx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      screenCtx.textAlign = 'center';
      screenCtx.textBaseline = 'middle';
      screenCtx.fillText('Open an image to start editing', rect.width / 2, rect.height / 2 - 8);
      screenCtx.font = '400 11px "Segoe UI", system-ui, sans-serif';
      screenCtx.fillText('Choose a file, drop one here, or paste from the clipboard', rect.width / 2, rect.height / 2 + 14);
      updateZoomLabel();
      return;
    }
    var logical = getLogicalSize();
    computeView(logical.width, logical.height, rect);
    canvas.style.pointerEvents = '';
    updateCanvasClip(rect);
    screenCtx.save();
    screenCtx.translate(view.offsetX, view.offsetY);
    screenCtx.fillStyle = ensureChecker();
    screenCtx.fillRect(0, 0, view.drawW, view.drawH);
    screenCtx.imageSmoothingEnabled = true;
    screenCtx.imageSmoothingQuality = 'high';
    screenCtx.drawImage(display, 0, 0, display.width, display.height, 0, 0, view.drawW, view.drawH);
    screenCtx.restore();
    if (state.tool === 'crop' && !state.compare && state.base) {
      drawCropOverlay();
    } else if (!state.compare) {
      if (interaction && interaction.type === 'draw') drawLiveStroke();
      else if (isLayerTool()) drawLayerSelection();
    }
    updateZoomLabel();
    updateStatus();
  }

  function updateZoomLabel() {
    if (els.zoomLabel) els.zoomLabel.textContent = Math.round(view.scale * 100) + '%';
  }

  function baseToScreen(x, y) {
    if (state.tool === 'crop') {
      return { x: view.offsetX + x * view.scale, y: view.offsetY + y * view.scale };
    }
    var out = getOutputSize();
    if (!state.crop || !out.width) return { x: -9999, y: -9999 };
    var sx = out.width / state.crop.w;
    var sy = out.height / state.crop.h;
    var fx = state.frame.padding + (x - state.crop.x) * sx;
    var fy = state.frame.padding + (y - state.crop.y) * sy;
    return { x: view.offsetX + fx * view.scale, y: view.offsetY + fy * view.scale };
  }

  function baseScale() {
    if (state.tool === 'crop') return view.scale;
    var out = getOutputSize();
    return state.crop ? view.scale * (out.width / state.crop.w) : view.scale;
  }

  function screenToLogical(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.offsetX) / view.scale,
      y: (clientY - rect.top - view.offsetY) / view.scale
    };
  }

  function screenToBase(clientX, clientY) {
    var point = screenToLogical(clientX, clientY);
    if (state.tool === 'crop' || state.compare || !state.crop) return point;
    var out = getOutputSize();
    return {
      x: state.crop.x + (point.x - state.frame.padding) * (state.crop.w / out.width),
      y: state.crop.y + (point.y - state.frame.padding) * (state.crop.h / out.height)
    };
  }

  function cropScreenRect() {
    var x = view.offsetX + state.crop.x * view.scale;
    var y = view.offsetY + state.crop.y * view.scale;
    return { x: x, y: y, w: state.crop.w * view.scale, h: state.crop.h * view.scale };
  }

  function cropHandlePoints(rect) {
    return {
      nw: { x: rect.x, y: rect.y }, n: { x: rect.x + rect.w / 2, y: rect.y }, ne: { x: rect.x + rect.w, y: rect.y },
      e: { x: rect.x + rect.w, y: rect.y + rect.h / 2 }, se: { x: rect.x + rect.w, y: rect.y + rect.h },
      s: { x: rect.x + rect.w / 2, y: rect.y + rect.h }, sw: { x: rect.x, y: rect.y + rect.h },
      w: { x: rect.x, y: rect.y + rect.h / 2 }
    };
  }

  function cropHitTest(clientX, clientY) {
    var rect = cropScreenRect();
    var points = cropHandlePoints(rect);
    var radius = 13;
    var keys = Object.keys(points);
    for (var i = 0; i < keys.length; i += 1) {
      var point = points[keys[i]];
      if (Math.abs(clientX - point.x) <= radius && Math.abs(clientY - point.y) <= radius) return keys[i];
    }
    if (clientX >= rect.x && clientX <= rect.x + rect.w && clientY >= rect.y && clientY <= rect.y + rect.h) return 'move';
    return null;
  }

  function drawCropOverlay() {
    var rect = cropScreenRect();
    var logical = getLogicalSize();
    var full = { x: view.offsetX, y: view.offsetY, w: logical.width * view.scale, h: logical.height * view.scale };
    screenCtx.save();
    screenCtx.fillStyle = 'rgba(5, 7, 15, .52)';
    screenCtx.fillRect(full.x, full.y, full.w, Math.max(0, rect.y - full.y));
    screenCtx.fillRect(full.x, rect.y + rect.h, full.w, Math.max(0, full.y + full.h - (rect.y + rect.h)));
    screenCtx.fillRect(full.x, rect.y, Math.max(0, rect.x - full.x), rect.h);
    screenCtx.fillRect(rect.x + rect.w, rect.y, Math.max(0, full.x + full.w - (rect.x + rect.w)), rect.h);
    screenCtx.strokeStyle = '#ffffff';
    screenCtx.lineWidth = 1.5;
    screenCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    screenCtx.strokeStyle = 'rgba(255,255,255,.35)';
    screenCtx.lineWidth = 1;
    for (var i = 1; i < 3; i += 1) {
      screenCtx.beginPath();
      screenCtx.moveTo(rect.x + rect.w * i / 3, rect.y);
      screenCtx.lineTo(rect.x + rect.w * i / 3, rect.y + rect.h);
      screenCtx.stroke();
      screenCtx.beginPath();
      screenCtx.moveTo(rect.x, rect.y + rect.h * i / 3);
      screenCtx.lineTo(rect.x + rect.w, rect.y + rect.h * i / 3);
      screenCtx.stroke();
    }
    var points = cropHandlePoints(rect);
    screenCtx.fillStyle = '#ffffff';
    screenCtx.strokeStyle = '#5c2ddd';
    screenCtx.lineWidth = 2;
    Object.keys(points).forEach(function (key) {
      var point = points[key];
      screenCtx.beginPath();
      screenCtx.rect(point.x - 5, point.y - 5, 10, 10);
      screenCtx.fill();
      screenCtx.stroke();
    });
    screenCtx.restore();
  }

  function layerScreenScale() {
    if (state.tool === 'crop' || !state.crop) return { x: view.scale, y: view.scale };
    var out = getOutputSize();
    return {
      x: view.scale * (out.width / state.crop.w),
      y: view.scale * (out.height / state.crop.h)
    };
  }

  function layerScreenGeometry(layer) {
    var center = baseToScreen(layer.x + layer.w / 2, layer.y + layer.h / 2);
    var scale = layerScreenScale();
    return {
      cx: center.x, cy: center.y, sx: scale.x, sy: scale.y,
      w: layer.w * scale.x, h: layer.h * scale.y
    };
  }

  function layerHandleSize() {
    return isMobile() ? 7 : 5;
  }

  function layerRotateOffset() {
    return isMobile() ? 32 : 26;
  }

  function layerHandlePoints(layer) {
    var geometry = layerScreenGeometry(layer);
    var angle = (Number(layer.rotation) || 0) * Math.PI / 180;
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    function rotate(x, y) {
      return { x: geometry.cx + x * cos - y * sin, y: geometry.cy + x * sin + y * cos };
    }
    var halfW = geometry.w / 2;
    var halfH = geometry.h / 2;
    return {
      nw: rotate(-halfW, -halfH), n: rotate(0, -halfH), ne: rotate(halfW, -halfH),
      e: rotate(halfW, 0), se: rotate(halfW, halfH), s: rotate(0, halfH),
      sw: rotate(-halfW, halfH), w: rotate(-halfW, 0),
      rotate: rotate(0, -halfH - layerRotateOffset())
    };
  }

  function drawLayerSelection() {
    var layer = activeLayer();
    if (!layer || !layer.visible) return;
    var geometry = layerScreenGeometry(layer);
    var angle = (Number(layer.rotation) || 0) * Math.PI / 180;
    var size = layerHandleSize();
    screenCtx.save();
    screenCtx.translate(geometry.cx, geometry.cy);
    screenCtx.rotate(angle);
    screenCtx.strokeStyle = layer.locked ? '#f59e0b' : '#a78bfa';
    screenCtx.lineWidth = 1.5;
    screenCtx.setLineDash([5, 4]);
    screenCtx.strokeRect(-geometry.w / 2, -geometry.h / 2, geometry.w, geometry.h);
    screenCtx.setLineDash([]);
    screenCtx.beginPath();
    screenCtx.moveTo(0, -geometry.h / 2);
    screenCtx.lineTo(0, -geometry.h / 2 - layerRotateOffset());
    screenCtx.stroke();
    screenCtx.restore();
    var points = layerHandlePoints(layer);
    screenCtx.save();
    screenCtx.fillStyle = '#ffffff';
    screenCtx.strokeStyle = layer.locked ? '#f59e0b' : '#5c2ddd';
    screenCtx.lineWidth = 2;
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function (key) {
      var point = points[key];
      screenCtx.beginPath();
      screenCtx.rect(point.x - size, point.y - size, size * 2, size * 2);
      screenCtx.fill();
      screenCtx.stroke();
    });
    screenCtx.beginPath();
    screenCtx.arc(points.rotate.x, points.rotate.y, size + 1, 0, Math.PI * 2);
    screenCtx.fill();
    screenCtx.stroke();
    screenCtx.restore();
  }

  function hitLayer(clientX, clientY) {
    var basePoint = screenToBase(clientX, clientY);
    for (var i = state.layers.length - 1; i >= 0; i -= 1) {
      var layer = state.layers[i];
      if (!layer.visible) continue;
      var cx = layer.x + layer.w / 2;
      var cy = layer.y + layer.h / 2;
      var angle = -(Number(layer.rotation) || 0) * Math.PI / 180;
      var dx = basePoint.x - cx;
      var dy = basePoint.y - cy;
      var localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      var localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      if (Math.abs(localX) <= layer.w / 2 && Math.abs(localY) <= layer.h / 2) return layer;
    }
    return null;
  }

  function hitLayerHandle(x, y) {
    var layer = activeLayer();
    if (!layer || layer.locked) return null;
    var points = layerHandlePoints(layer);
    var radius = isMobile() ? 14 : 12;
    var keys = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'rotate'];
    for (var i = 0; i < keys.length; i += 1) {
      var point = points[keys[i]];
      if (Math.abs(x - point.x) <= radius && Math.abs(y - point.y) <= radius) return keys[i];
    }
    return null;
  }

  function updateStatus() {
    if (!els.statusLeft || !els.statusRight) return;
    if (!state.source) {
      els.statusLeft.textContent = 'No image open. Choose a file or drop one here.';
      els.statusRight.textContent = 'Local processing';
      if (els.fileName) els.fileName.textContent = 'No image open';
      return;
    }
    var finalSize = getFinalSize();
    var shownSize = state.compare ? { width: state.source.width, height: state.source.height } : finalSize;
    if (els.fileName) els.fileName.textContent = state.source.name;
    els.statusLeft.textContent = state.source.width + ' × ' + state.source.height + ' · ' + mimeLabel(state.source.type) + ' · ' + formatBytes(state.source.size);
    var toolLabel = state.tool.charAt(0).toUpperCase() + state.tool.slice(1);
    els.statusRight.textContent = (state.compare ? 'Before · ' : '') + shownSize.width + ' × ' + shownSize.height + ' · ' + Math.round(view.scale * 100) + '% · ' + toolLabel;
  }

  /* ---------- History ---------- */
  function snapshot() {
    return {
      transform: Object.assign({}, state.transform),
      crop: state.crop ? Object.assign({}, state.crop) : null,
      cropAspect: state.cropAspect,
      resize: Object.assign({}, state.resize),
      frame: Object.assign({}, state.frame),
      adjustments: Object.assign({}, state.adjustments),
      filter: Object.assign({}, state.filter),
      blur: Object.assign({}, state.blur),
      layers: state.layers.map(function (layer) {
        var copy = Object.assign({}, layer);
        if (layer.canvas) copy.canvas = cloneCanvas(layer.canvas);
        if (layer.text) copy.text = Object.assign({}, layer.text);
        if (layer.shape) copy.shape = Object.assign({}, layer.shape);
        return copy;
      }),
      activeLayerId: state.activeLayerId
    };
  }

  function pushHistory() {
    if (!state.source) return;
    invalidateExport();
    if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    if (history.length > 30) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $$('[data-action="undo"]').forEach(function (button) { button.disabled = historyIndex <= 0; });
    $$('[data-action="redo"]').forEach(function (button) { button.disabled = historyIndex >= history.length - 1; });
  }

  function restoreHistory(index) {
    var entry = history[index];
    if (!entry) return;
    state.transform = Object.assign({}, entry.transform);
    state.cropAspect = entry.cropAspect;
    state.resize = Object.assign({}, entry.resize);
    state.frame = Object.assign({}, entry.frame);
    state.adjustments = Object.assign({}, entry.adjustments);
    state.filter = Object.assign({}, entry.filter);
    state.blur = Object.assign({}, entry.blur);
    state.layers = entry.layers.map(function (layer) {
      var copy = Object.assign({}, layer);
      if (layer.canvas) copy.canvas = cloneCanvas(layer.canvas);
      if (layer.text) copy.text = Object.assign({}, layer.text);
      if (layer.shape) copy.shape = Object.assign({}, layer.shape);
      return copy;
    });
    state.activeLayerId = entry.activeLayerId;
    rebuildBase(false);
    state.crop = entry.crop ? clampCrop(entry.crop) : { x: 0, y: 0, w: state.base.width, h: state.base.height };
    historyIndex = index;
    updateHistoryButtons();
    renderPanel(state.tool, true);
    schedulePreview(false);
  }

  function undo() {
    if (historyIndex > 0) restoreHistory(historyIndex - 1);
  }
  function redo() {
    if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1);
  }

  /* ---------- Image import ---------- */
  function fileKind(file) {
    var type = (file.type || '').toLowerCase();
    var name = (file.name || '').toLowerCase();
    if (type.indexOf('svg') !== -1 || /\.svg$/.test(name)) return 'svg';
    if (type === 'image/tiff' || /\.tiff?$/.test(name)) return 'tiff';
    if (type === 'image/heic' || type === 'image/heif' || /\.hei[cf]$/.test(name)) return 'heic';
    if (type === 'image/avif' || /\.avif$/.test(name)) return 'avif';
    return 'native';
  }

  function loadImageElement(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The image could not be decoded.')); };
      image.src = url;
    });
  }

  async function bitmapFromBlob(blob) {
    var bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      var url = URL.createObjectURL(blob);
      try {
        var image = await loadImageElement(url);
        var canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canvas;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    var canvas = createCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return canvas;
  }

  /* The <img> decoder applies EXIF orientation consistently in modern
   * browsers, so JPEGs are decoded through it rather than rotating twice. */
  async function loadJpeg(file) {
    var url = URL.createObjectURL(file);
    try {
      var image = await loadImageElement(url);
      var canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadSvg(file) {
    var text = await file.text();
    var parser = new DOMParser();
    var doc = parser.parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('This SVG file could not be parsed.');
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('This file is not a valid SVG image.');
    Array.prototype.slice.call(doc.querySelectorAll('script, foreignObject, iframe, object, embed, style')).forEach(function (node) {
      node.parentNode.removeChild(node);
    });
    Array.prototype.slice.call(doc.querySelectorAll('*')).forEach(function (element) {
      Array.prototype.slice.call(element.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        var value = attribute.value || '';
        if (name.indexOf('on') === 0) element.removeAttribute(attribute.name);
        if ((name === 'href' || name === 'xlink:href') && !/^data:image\//i.test(value) && value.charAt(0) !== '#') {
          element.removeAttribute(attribute.name);
        }
        if (name === 'style' && /url\s*\(/i.test(value)) element.removeAttribute(attribute.name);
      });
    });
    if (!svg.getAttribute('width') || !svg.getAttribute('height')) {
      var viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
        svg.setAttribute('width', String(viewBox[2]));
        svg.setAttribute('height', String(viewBox[3]));
      }
    }
    var serialized = new XMLSerializer().serializeToString(svg);
    var blob = new Blob([serialized], { type: 'image/svg+xml' });
    return bitmapFromBlob(blob);
  }

  async function loadTiff(file) {
    await loadScriptOnce('../../vendor/pako.min.js');
    await loadScriptOnce('../../vendor/UTIF.js');
    if (!window.UTIF) throw new Error('The TIFF decoder did not load.');
    var buffer = await file.arrayBuffer();
    var ifds = window.UTIF.decode(buffer);
    if (!ifds || !ifds.length) throw new Error('This TIFF file contains no readable image.');
    window.UTIF.decodeImage(buffer, ifds[0]);
    var rgba = window.UTIF.toRGBA8(ifds[0]);
    var width = ifds[0].width;
    var height = ifds[0].height;
    if (!width || !height || !rgba || rgba.length < width * height * 4) {
      throw new Error('This TIFF file uses a compression the decoder cannot read.');
    }
    var output = createCanvas(width, height);
    var ctx = output.getContext('2d');
    var imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    return output;
  }

  async function loadHeic(file) {
    try {
      return await bitmapFromBlob(file);
    } catch (nativeError) {
      await loadScriptOnce('../../vendor/heic2any.min.js');
      if (!window.heic2any) throw new Error('The HEIC decoder did not load.');
      var converted = await window.heic2any({ blob: file, toType: 'image/png', quality: 0.95 });
      var blob = Array.isArray(converted) ? converted[0] : converted;
      return bitmapFromBlob(blob);
    }
  }

  async function decodeFile(file) {
    var kind = fileKind(file);
    if (kind === 'svg') return loadSvg(file);
    if (kind === 'tiff') return loadTiff(file);
    if (kind === 'heic') return loadHeic(file);
    if (kind === 'native' || kind === 'avif') {
      if (mimeForFile(file) === 'image/jpeg') {
        try {
          return await loadJpeg(file);
        } catch (error) {
          throw new Error('This JPEG could not be opened. The file may be corrupted.');
        }
      }
      var buffer = await file.arrayBuffer();
      var blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
      try {
        return await bitmapFromBlob(blob);
      } catch (error) {
        if (kind === 'avif') throw new Error('This browser cannot open AVIF files. Try JPG, PNG or WebP.');
        throw new Error('This image could not be opened. The file may be corrupted or use an unsupported format.');
      }
    }
    throw new Error('Unsupported image format.');
  }

  function mimeForFile(file) {
    if (file.type && /^image\//.test(file.type)) return file.type;
    var name = (file.name || '').toLowerCase();
    if (/\.jpe?g$/.test(name)) return 'image/jpeg';
    if (/\.png$/.test(name)) return 'image/png';
    if (/\.webp$/.test(name)) return 'image/webp';
    if (/\.gif$/.test(name)) return 'image/gif';
    if (/\.bmp$/.test(name)) return 'image/bmp';
    if (/\.tiff?$/.test(name)) return 'image/tiff';
    if (/\.avif$/.test(name)) return 'image/avif';
    if (/\.heic$/.test(name)) return 'image/heic';
    if (/\.heif$/.test(name)) return 'image/heif';
    if (/\.svg$/.test(name)) return 'image/svg+xml';
    return 'image/png';
  }

  async function loadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|bmp|tiff?|avif|hei[cf]|svg)$/i.test(file.name || '')) {
      toast('Please choose an image file.', true);
      return;
    }
    state.busy = true;
    showProgress('Opening ' + file.name + '…', 15);
    try {
      var canvasSource = await decodeFile(file);
      if (!canvasSource || !canvasSource.width || !canvasSource.height) throw new Error('The image has no readable pixels.');
      if (state.source && state.source.canvas && state.source.canvas !== canvasSource) {
        state.source.canvas.width = 0;
        state.source.canvas.height = 0;
      }
      var type = mimeForFile(file);
      state.source = {
        canvas: canvasSource,
        width: canvasSource.width,
        height: canvasSource.height,
        name: file.name || 'pasted-image',
        type: type,
        size: file.size || 0
      };
      state.transform = { rotation: 0, straighten: 0, flipH: false, flipV: false };
      state.cropAspect = 0;
      state.crop = null;
      state.resize = Object.assign({}, DEFAULT_RESIZE, { width: canvasSource.width, height: canvasSource.height });
      state.frame = Object.assign({}, DEFAULT_FRAME);
      state.adjustments = Object.assign({}, DEFAULT_ADJUSTMENTS);
      state.filter = { name: 'none', intensity: 100 };
      state.blur = { type: 'none', amount: 12, angle: 0 };
      state.layers = [];
      state.activeLayerId = null;
      state.compare = false;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.export.filename = sanitizeFilename((file.name || 'image').replace(/\.[^.]+$/, '')) + '-edited';
      state.export.targetKB = 0;
      state.export.lastResult = null;
      rebuildBase(true);
      history = [];
      historyIndex = -1;
      pushHistory();
      state.tool = 'adjust';
      renderPanel('adjust', true);
      if (isMobile()) closeSheet();
      schedulePreview(false);
      updateStatus();
      toast('Opened ' + state.source.name);
      showProgress('Ready', 100);
      setTimeout(hideProgress, 350);
    } catch (error) {
      hideProgress();
      toast(error.message || 'The image could not be opened.', true);
    } finally {
      state.busy = false;
      if (els.fileInput) els.fileInput.value = '';
    }
  }

  function removeImage() {
    if (!state.source) return;
    if (!window.confirm('Remove this image and clear the current project?')) return;
    state.source = null;
    state.base = null;
    state.crop = null;
    state.layers = [];
    state.activeLayerId = null;
    previewCanvas = null;
    history = [];
    historyIndex = -1;
    updateHistoryButtons();
    state.tool = 'import';
    renderPanel('import', true);
    if (isMobile()) closeSheet();
    schedulePreview(false);
    updateStatus();
  }

  function newProject() {
    if (state.source && !window.confirm('Start a new project? Unsaved edits will be lost.')) return;
    state.source = null;
    state.base = null;
    state.crop = null;
    state.layers = [];
    state.activeLayerId = null;
    previewCanvas = null;
    history = [];
    historyIndex = -1;
    state.transform = { rotation: 0, straighten: 0, flipH: false, flipV: false };
    state.adjustments = Object.assign({}, DEFAULT_ADJUSTMENTS);
    state.filter = { name: 'none', intensity: 100 };
    state.blur = { type: 'none', amount: 12, angle: 0 };
    state.frame = Object.assign({}, DEFAULT_FRAME);
    state.resize = Object.assign({}, DEFAULT_RESIZE);
    updateHistoryButtons();
    state.tool = 'import';
    renderPanel('import', true);
    if (isMobile()) closeSheet();
    schedulePreview(false);
    updateStatus();
  }

  function replaceImage() {
    if (els.fileInput) els.fileInput.click();
  }

  /* ---------- Panel framework ---------- */
  var PANEL_TITLES = {
    import: 'Import', crop: 'Crop & rotate', resize: 'Resize', adjust: 'Adjust',
    filters: 'Filters', blur: 'Blur & pixelate', text: 'Text', shapes: 'Shapes',
    draw: 'Draw', frame: 'Frame', layers: 'Layers', export: 'Export'
  };

  function icon(name) {
    return '<svg class="editor-icon" aria-hidden="true"><use href="#ed-icon-' + name + '"></use></svg>';
  }

  function infoRow(label, value) {
    return '<div class="editor-fileinfo-row"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(value) + '</span></div>';
  }

  function rangeRow(id, label, min, max, step, value, attribute, display) {
    return '<div class="editor-range-row">' +
      '<label for="' + id + '">' + escapeHtml(label) + '</label>' +
      '<input class="editor-range" id="' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" ' + attribute + '>' +
      '<output for="' + id + '">' + escapeHtml(display == null ? value : display) + '</output>' +
      '</div>';
  }

  function syncToolButtons() {
    $$('[data-tool]').forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-tool') === state.tool ? 'true' : 'false');
    });
    updateCanvasCursor();
  }

  function updateCanvasCursor() {
    canvas.classList.toggle('is-crop', state.tool === 'crop' && !!state.source && !state.compare);
    canvas.classList.toggle('is-draw', state.tool === 'draw' && !!state.source && !state.compare);
  }

  function openSheet() {
    if (!isMobile()) return;
    if (els.panel) els.panel.classList.add('is-open');
    if (els.sheetBackdrop) els.sheetBackdrop.hidden = false;
  }

  function closeSheet() {
    if (els.panel) els.panel.classList.remove('is-open');
    if (els.sheetBackdrop) els.sheetBackdrop.hidden = true;
  }

  function noImagePanel() {
    return '<div class="editor-empty">' +
      '<button class="editor-dropzone" type="button" data-action="browse">' + icon('open') +
      '<strong>Open an image to start</strong><span>Choose a file or drop one on the canvas. Nothing is uploaded.</span></button>' +
      '<p class="editor-note">The editor needs an image before this tool can be used.</p>' +
      '</div>';
  }

  function fileInfoBlock() {
    if (!state.source) return '';
    var output = getFinalSize();
    return '<div class="editor-fileinfo">' +
      infoRow('File', state.source.name) +
      infoRow('Type', mimeLabel(state.source.type)) +
      infoRow('Original', state.source.width + ' × ' + state.source.height + ' px') +
      infoRow('File size', formatBytes(state.source.size)) +
      infoRow('Export size', output.width + ' × ' + output.height + ' px') +
      '</div>';
  }

  function importPanel() {
    var html = '<div class="editor-empty">' +
      '<button class="editor-dropzone" type="button" data-action="browse">' + icon('open') +
      '<strong>' + (state.source ? 'Open another image' : 'Open an image') + '</strong>' +
      '<span>Drag a file here, paste from the clipboard, or choose a file. It stays on this device.</span></button>';
    if (state.source) {
      html += fileInfoBlock();
      html += '<div class="editor-button-row">' +
        '<button class="editor-button" type="button" data-action="browse">Replace image</button>' +
        '<button class="editor-button editor-button-danger" type="button" data-action="remove">Remove image</button>' +
        '</div>';
    }
    html += '<div><h3>Supported input</h3><ul class="editor-format-list">' +
      ['JPG', 'PNG', 'WebP', 'GIF', 'BMP', 'SVG', 'TIFF', 'HEIC', 'AVIF'].map(function (label) {
        return '<li>' + label + '</li>';
      }).join('') +
      '</ul><p class="editor-hint">JPG, PNG, WebP, GIF, BMP and SVG open in the browser. AVIF depends on browser support. TIFF and HEIC/HEIF use bundled local decoders. Animated GIFs open as their first frame.</p></div>' +
      '<p class="editor-note"><strong>Background removal is not included.</strong> No segmentation model is bundled, so this editor does not offer or fake automatic background removal.</p>' +
      '</div>';
    return html;
  }

  function renderPanel(tool, force) {
    tool = tool || state.tool || 'import';
    state.tool = tool;
    syncToolButtons();
    if (els.panelTitle) els.panelTitle.textContent = PANEL_TITLES[tool] || 'Edit';
    var html;
    if (!state.source && tool !== 'import' && tool !== 'export') {
      html = noImagePanel();
    } else {
      switch (tool) {
        case 'import': html = importPanel(); break;
        case 'crop': html = cropPanel(); break;
        case 'resize': html = resizePanel(); break;
        case 'adjust': html = adjustPanel(); break;
        case 'filters': html = filtersPanel(); break;
        case 'blur': html = blurPanel(); break;
        case 'text': html = textPanel(); break;
        case 'shapes': html = shapesPanel(); break;
        case 'draw': html = drawPanel(); break;
        case 'frame': html = framePanel(); break;
        case 'layers': html = layersPanel(); break;
        case 'export': html = exportPanel(); break;
        default: html = importPanel();
      }
    }
    if (!els.panelBody) return;
    els.panelBody.innerHTML = html;
    els.panelBody.scrollTop = 0;
    switch (tool) {
      case 'adjust': bindAdjustPanel(); break;
      case 'filters': bindFiltersPanel(); break;
      case 'blur': bindBlurPanel(); break;
      case 'crop': bindCropPanel(); break;
      case 'resize': bindResizePanel(); break;
      case 'text': bindTextPanel(); break;
      case 'shapes': bindShapesPanel(); break;
      case 'draw': bindDrawPanel(); break;
      case 'frame': bindFramePanel(); break;
      case 'layers': bindLayersPanel(); break;
      case 'export': bindExportPanel(); break;
      default: break;
    }
    if (tool === 'export') updateExportControls();
  }

  /* ---------- Adjust ---------- */
  function adjustPanel() {
    var groups = ADJUSTMENT_GROUPS.map(function (group) {
      return '<h3>' + escapeHtml(group[0]) + '</h3>' + group[1].map(function (item) {
        var key = item[0];
        var value = state.adjustments[key];
        var display = key === 'gamma' ? Number(value).toFixed(2) : value;
        return rangeRow('adj-' + key, item[1], item[2], item[3], item[4], value, 'data-adjust="' + key + '"', display);
      }).join('');
    }).join('');
    return groups +
      '<div class="editor-button-row">' +
      '<button class="editor-button editor-button-primary" type="button" data-action="auto-enhance">Auto enhance</button>' +
      '<button class="editor-button" type="button" data-action="reset-adjust">Reset adjustments</button>' +
      '</div>' +
      '<p class="editor-hint">Adjustments are applied to the cropped photo before text, shapes and drawings. Auto enhance samples the image and sets brightness, contrast, saturation, gamma, shadows and highlights.</p>';
  }

  function bindAdjustPanel() {
    $$('[data-adjust]', els.panelBody).forEach(function (input) {
      var key = input.getAttribute('data-adjust');
      input.addEventListener('input', function () {
        state.adjustments[key] = Number(input.value);
        var output = input.parentNode.querySelector('output');
        if (output) output.textContent = key === 'gamma' ? Number(input.value).toFixed(2) : input.value;
        invalidateExport();
        schedulePreview(true);
      });
      input.addEventListener('change', function () {
        pushHistory();
        schedulePreview(false);
      });
    });
  }

  function autoEnhance() {
    if (!state.source || !state.base || !state.crop) return;
    var sample = createCanvas(180, 180);
    var context = sample.getContext('2d');
    context.drawImage(state.base.canvas, state.crop.x, state.crop.y, state.crop.w, state.crop.h, 0, 0, 180, 180);
    var data = context.getImageData(0, 0, 180, 180).data;
    var histogram = new Uint32Array(256);
    var sum = 0;
    var sumSq = 0;
    var count = data.length / 4;
    for (var i = 0; i < data.length; i += 4) {
      var l = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      histogram[l] += 1;
      sum += l;
      sumSq += l * l;
    }
    var mean = sum / count;
    var std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    var target = count * 0.02;
    var low = 0;
    var high = 255;
    var acc = 0;
    for (i = 0; i < 256; i += 1) { acc += histogram[i]; if (acc >= target) { low = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i -= 1) { acc += histogram[i]; if (acc >= target) { high = i; break; } }
    var mid = (low + high) / 2;
    var gamma = Math.log(clamp(mid, 2, 253) / 255) / Math.log(0.5);
    state.adjustments.brightness = Math.round(clamp((132 - mean) / 2.6, -30, 30));
    state.adjustments.contrast = Math.round(clamp((58 - std) * 0.9, -20, 30));
    state.adjustments.saturation = Math.round(clamp((36 - std) * 0.6, -15, 25));
    state.adjustments.gamma = Number(clamp(gamma, 0.6, 2.1).toFixed(2));
    state.adjustments.shadows = low < 10 ? 12 : 0;
    state.adjustments.highlights = high > 245 ? -10 : 0;
    state.tool = 'adjust';
    pushHistory();
    invalidateExport();
    renderPanel('adjust', true);
    schedulePreview(false);
    toast('Auto enhance applied. Use Undo to revert it.');
  }

  /* ---------- Filters ---------- */
  function filtersPanel() {
    var grid = FILTERS.map(function (item) {
      return '<button class="editor-filter-button" type="button" data-filter="' + item[0] + '" aria-pressed="' + (state.filter.name === item[0] ? 'true' : 'false') + '">' + escapeHtml(item[1]) + '</button>';
    }).join('');
    return '<div class="editor-filter-grid">' + grid + '</div>' +
      '<h3>Intensity</h3>' +
      rangeRow('filter-intensity', 'Amount', 0, 100, 1, state.filter.intensity, 'data-filter-intensity', state.filter.intensity + '%') +
      '<p class="editor-hint">Filters are applied to the photo before text and other layers. Intensity blends the filter with the original pixels.</p>';
  }

  function bindFiltersPanel() {
    var intensity = $('[data-filter-intensity]', els.panelBody);
    if (intensity) {
      intensity.addEventListener('input', function () {
        state.filter.intensity = Number(intensity.value);
        var output = intensity.parentNode.querySelector('output');
        if (output) output.textContent = intensity.value + '%';
        invalidateExport();
        schedulePreview(true);
      });
      intensity.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
  }

  function setFilter(name) {
    state.filter.name = name;
    if (name !== 'none') state.filter.intensity = 100;
    $$('[data-filter]', els.panelBody).forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-filter') === name ? 'true' : 'false');
    });
    var intensity = $('[data-filter-intensity]', els.panelBody);
    if (intensity) {
      intensity.value = state.filter.intensity;
      var output = intensity.parentNode.querySelector('output');
      if (output) output.textContent = state.filter.intensity + '%';
    }
    pushHistory();
    invalidateExport();
    schedulePreview(false);
  }

  /* ---------- Blur ---------- */
  function blurPanel() {
    var types = [['none', 'None'], ['gaussian', 'Gaussian blur'], ['pixelate', 'Pixelate'], ['motion', 'Motion blur']];
    return '<div class="editor-field"><label for="blur-type">Effect</label>' +
      '<select class="editor-select" id="blur-type" data-blur-type>' +
      types.map(function (item) { return '<option value="' + item[0] + '"' + (state.blur.type === item[0] ? ' selected' : '') + '>' + item[1] + '</option>'; }).join('') +
      '</select></div>' +
      rangeRow('blur-amount', 'Amount', 0, 100, 1, state.blur.amount, 'data-blur-amount', state.blur.amount + '') +
      '<div data-blur-angle-row>' + rangeRow('blur-angle', 'Angle', 0, 180, 1, state.blur.angle, 'data-blur-angle', state.blur.angle + '°') + '</div>' +
      '<div class="editor-button-row"><button class="editor-button" type="button" data-action="reset-blur">Remove blur</button></div>' +
      '<p class="editor-hint">Blur is applied to the photo before text, shapes and drawings, so overlays stay sharp. Pixelate uses square blocks; motion blur uses the angle above.</p>';
  }

  function bindBlurPanel() {
    var type = $('[data-blur-type]', els.panelBody);
    var amount = $('[data-blur-amount]', els.panelBody);
    var angle = $('[data-blur-angle]', els.panelBody);
    function syncRows() {
      var row = $('[data-blur-angle-row]', els.panelBody);
      if (row) row.hidden = state.blur.type !== 'motion';
    }
    if (type) {
      type.addEventListener('change', function () {
        state.blur.type = type.value;
        syncRows();
        pushHistory();
        invalidateExport();
        schedulePreview(false);
      });
    }
    if (amount) {
      amount.addEventListener('input', function () {
        state.blur.amount = Number(amount.value);
        var output = amount.parentNode.querySelector('output');
        if (output) output.textContent = amount.value;
        invalidateExport();
        schedulePreview(true);
      });
      amount.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
    if (angle) {
      angle.addEventListener('input', function () {
        state.blur.angle = Number(angle.value);
        var output = angle.parentNode.querySelector('output');
        if (output) output.textContent = angle.value + '°';
        schedulePreview(true);
      });
      angle.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
    syncRows();
  }

  /* ---------- Crop and transform ---------- */
  function cropPanel() {
    var aspects = CROP_RATIOS.map(function (item) {
      return '<button class="editor-chip" type="button" data-aspect="' + item[1] + '" aria-pressed="' + (Number(state.cropAspect) === Number(item[1]) ? 'true' : 'false') + '">' + escapeHtml(item[0]) + '</button>';
    }).join('');
    var crop = state.crop || { x: 0, y: 0, w: 1, h: 1 };
    return '<h3>Aspect ratio</h3><div class="editor-chip-grid">' + aspects + '</div>' +
      '<h3>Crop rectangle</h3><div class="editor-grid-2">' +
      '<label class="editor-field"><span>X</span><input class="editor-number" type="number" min="0" step="1" value="' + Math.round(crop.x) + '" data-crop-field="x"></label>' +
      '<label class="editor-field"><span>Y</span><input class="editor-number" type="number" min="0" step="1" value="' + Math.round(crop.y) + '" data-crop-field="y"></label>' +
      '<label class="editor-field"><span>Width</span><input class="editor-number" type="number" min="10" step="1" value="' + Math.round(crop.w) + '" data-crop-field="w"></label>' +
      '<label class="editor-field"><span>Height</span><input class="editor-number" type="number" min="10" step="1" value="' + Math.round(crop.h) + '" data-crop-field="h"></label>' +
      '</div>' +
      '<div class="editor-button-row"><button class="editor-button" type="button" data-action="reset-crop">Reset crop</button></div>' +
      '<p class="editor-hint">Drag inside the preview to move the crop, drag a handle to resize it, or drag on the dark area to draw a new crop. Crop is measured in image pixels.</p>' +
      '<h3>Rotate and flip</h3><div class="editor-button-row">' +
      '<button class="editor-button" type="button" data-action="rotate-left">' + icon('rotate-left') + 'Left</button>' +
      '<button class="editor-button" type="button" data-action="rotate-right">' + icon('rotate-right') + 'Right</button>' +
      '<button class="editor-button" type="button" data-action="flip-h">' + icon('flip-h') + 'Horizontal</button>' +
      '<button class="editor-button" type="button" data-action="flip-v">' + icon('flip-v') + 'Vertical</button>' +
      '</div>' +
      '<h3>Straighten</h3>' +
      rangeRow('straighten', 'Angle', -45, 45, 0.5, state.transform.straighten || 0, 'data-straighten', Number(state.transform.straighten || 0).toFixed(1) + '°') +
      '<div class="editor-button-row"><button class="editor-button" type="button" data-action="reset-transform">Reset rotation</button></div>' +
      '<p class="editor-hint">Straighten applies when you release the slider. Empty corners are trimmed automatically. Rotation is applied before crop and resize.</p>';
  }

  function bindCropPanel() {
    ['x', 'y', 'w', 'h'].forEach(function (field) {
      var input = $('[data-crop-field="' + field + '"]', els.panelBody);
      if (!input) return;
      input.addEventListener('change', function () {
        if (!state.base) return;
        var value = Math.round(Number(input.value) || 0);
        var crop = Object.assign({}, state.crop);
        crop[field] = value;
        if (field === 'w' || field === 'h') {
          if (state.cropAspect > 0) {
            if (field === 'w') crop.h = Math.round(crop.w / state.cropAspect);
            else crop.w = Math.round(crop.h * state.cropAspect);
          }
          crop.w = clamp(crop.w, 10, state.base.width);
          crop.h = clamp(crop.h, 10, state.base.height);
        }
        state.crop = clampCrop(crop);
        syncCropInputs();
        drawToScreen();
        updateStatus();
        pushHistory();
        invalidateExport();
        schedulePreview(false);
      });
    });
    var straighten = $('[data-straighten]', els.panelBody);
    if (straighten) {
      straighten.addEventListener('input', function () {
        var output = straighten.parentNode.querySelector('output');
        if (output) output.textContent = Number(straighten.value).toFixed(1) + '°';
      });
      straighten.addEventListener('change', function () {
        state.transform.straighten = Number(straighten.value);
        state.cropAspect = 0;
        rebuildBase(true);
        pushHistory();
        invalidateExport();
        renderPanel('crop', true);
        drawToScreen();
        updateStatus();
        schedulePreview(false);
      });
    }
  }

  function syncCropInputs() {
    if (!state.crop) return;
    ['x', 'y', 'w', 'h'].forEach(function (field) {
      var input = $('[data-crop-field="' + field + '"]', els.panelBody);
      if (input) input.value = Math.round(state.crop[field]);
    });
    $$('[data-aspect]', els.panelBody).forEach(function (button) {
      button.setAttribute('aria-pressed', Number(button.getAttribute('data-aspect')) === Number(state.cropAspect) ? 'true' : 'false');
    });
  }

  function setCropAspect(aspect) {
    if (!state.base) return;
    state.cropAspect = Number(aspect) || 0;
    if (!state.cropAspect) {
      syncCropInputs();
      drawToScreen();
      return;
    }
    var current = state.crop || { x: 0, y: 0, w: state.base.width, h: state.base.height };
    var maxW = state.base.width;
    var maxH = state.base.height;
    var width = maxW;
    var height = width / state.cropAspect;
    if (height > maxH) {
      height = maxH;
      width = height * state.cropAspect;
    }
    var centerX = current.x + current.w / 2;
    var centerY = current.y + current.h / 2;
    state.crop = clampCrop({
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      w: Math.round(width),
      h: Math.round(height)
    });
    syncCropInputs();
    drawToScreen();
    updateStatus();
    pushHistory();
    invalidateExport();
    schedulePreview(false);
  }

  function rotateImage(delta) {
    if (!state.source) return;
    state.transform.rotation = ((Number(state.transform.rotation) || 0) + delta) % 360;
    state.cropAspect = 0;
    rebuildBase(true);
    pushHistory();
    invalidateExport();
    renderPanel('crop', true);
    drawToScreen();
    updateStatus();
    schedulePreview(false);
  }

  function flipImage(axis) {
    if (!state.source) return;
    var oldCrop = state.crop ? Object.assign({}, state.crop) : null;
    state.transform[axis] = !state.transform[axis];
    rebuildBase(false);
    if (oldCrop && state.base) {
      if (axis === 'flipH') {
        oldCrop.x = state.base.width - (oldCrop.x + oldCrop.w);
      } else {
        oldCrop.y = state.base.height - (oldCrop.y + oldCrop.h);
      }
      state.crop = clampCrop(oldCrop);
    }
    pushHistory();
    invalidateExport();
    renderPanel('crop', true);
    drawToScreen();
    updateStatus();
    schedulePreview(false);
  }

  /* ---------- Resize ---------- */
  function resizePanel() {
    var output = getOutputSize();
    var presets = RESIZE_PRESETS.map(function (item) {
      return '<button class="editor-chip" type="button" data-resize-preset="' + item[1] + 'x' + item[2] + '">' + escapeHtml(item[0]) + '</button>';
    }).join('');
    return '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Width (px)</span><input class="editor-number" type="number" min="1" max="20000" step="1" value="' + output.width + '" data-resize-field="width"></label>' +
      '<label class="editor-field"><span>Height (px)</span><input class="editor-number" type="number" min="1" max="20000" step="1" value="' + output.height + '" data-resize-field="height"></label>' +
      '</div>' +
      '<label class="editor-check"><input type="checkbox" data-resize-lock' + (state.resize.lock ? ' checked' : '') + '> Keep aspect ratio</label>' +
      '<h3>Presets</h3><div class="editor-chip-grid">' + presets + '</div>' +
      '<h3>Resampling</h3><div class="editor-field"><label for="resize-resample">Method</label><select class="editor-select" id="resize-resample" data-resize-resample>' +
      '<option value="smooth"' + (state.resize.resample === 'smooth' ? ' selected' : '') + '>Smooth (recommended)</option>' +
      '<option value="nearest"' + (state.resize.resample === 'nearest' ? ' selected' : '') + '>Nearest neighbour (hard edges)</option>' +
      '</select></div>' +
      '<div class="editor-button-row"><button class="editor-button" type="button" data-action="reset-resize">Use crop size</button></div>' +
      '<p class="editor-hint">Resize sets the exported pixel dimensions. The preview is scaled to fit your screen, so use the export size above as the source of truth. Enlarging cannot add real detail.</p>';
  }

  function syncResizeInputs() {
    var output = getOutputSize();
    var width = $('[data-resize-field="width"]', els.panelBody);
    var height = $('[data-resize-field="height"]', els.panelBody);
    if (width) width.value = output.width;
    if (height) height.value = output.height;
  }

  function applyResize(field, value) {
    if (!state.base || !state.crop) return;
    value = clamp(Math.round(Number(value) || 0), 1, 20000);
    var ratio = state.crop.w / state.crop.h;
    if (state.resize.lock) {
      if (field === 'width') state.resize.height = Math.max(1, Math.round(value / ratio));
      else state.resize.width = Math.max(1, Math.round(value * ratio));
    }
    state.resize[field] = value;
    state.resize.custom = true;
    syncResizeInputs();
    pushHistory();
    invalidateExport();
    updateStatus();
    schedulePreview(false);
  }

  function bindResizePanel() {
    ['width', 'height'].forEach(function (field) {
      var input = $('[data-resize-field="' + field + '"]', els.panelBody);
      if (!input) return;
      input.addEventListener('change', function () { applyResize(field, input.value); });
    });
    var lock = $('[data-resize-lock]', els.panelBody);
    if (lock) lock.addEventListener('change', function () { state.resize.lock = lock.checked; });
    var resample = $('[data-resize-resample]', els.panelBody);
    if (resample) {
      resample.addEventListener('change', function () {
        state.resize.resample = resample.value;
        pushHistory();
        schedulePreview(false);
      });
    }
  }

  /* ---------- Layer helpers ---------- */
  var SHAPE_LABELS = {
    'rectangle': 'Rectangle', 'rounded-rectangle': 'Rounded rectangle',
    'ellipse': 'Ellipse', 'line': 'Line', 'arrow': 'Arrow'
  };

  function newLayerBase(type, name) {
    return {
      id: uid(), type: type, kind: type, name: name,
      x: 0, y: 0, w: 10, h: 10, rotation: 0, opacity: 1,
      visible: true, locked: false, blend: 'source-over'
    };
  }

  function createTextLayer() {
    if (!state.crop) return null;
    var crop = state.crop;
    var fontSize = Math.max(18, Math.round(crop.h * 0.08));
    var layer = newLayerBase('text', 'Text');
    layer.x = Math.round(crop.x + crop.w * 0.1);
    layer.y = Math.round(crop.y + crop.h * 0.4);
    layer.w = Math.round(crop.w * 0.8);
    layer.text = {
      content: 'Your text here',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: fontSize,
      color: '#ffffff',
      bold: true,
      italic: false,
      underline: false,
      align: 'center',
      direction: 'auto',
      lineHeight: 1.2,
      letterSpacing: 0,
      bgEnabled: false,
      bgColor: '#000000',
      outlineEnabled: false,
      outlineWidth: Math.max(1, Math.round(fontSize / 18)),
      outlineColor: '#000000',
      shadowEnabled: true,
      shadowColor: 'rgba(0,0,0,.55)',
      shadowBlur: Math.round(fontSize * 0.18),
      shadowOffsetX: 0,
      shadowOffsetY: Math.round(fontSize * 0.06)
    };
    layer.h = Math.round(textLayerHeight(layer));
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    return layer;
  }

  function createShapeLayer(kind) {
    if (!state.crop) return null;
    var crop = state.crop;
    var size = Math.max(24, Math.round(Math.min(crop.w, crop.h) * 0.42));
    var layer = newLayerBase('shape', SHAPE_LABELS[kind] || 'Shape');
    layer.kind = 'shape';
    layer.w = size;
    layer.h = (kind === 'line' || kind === 'arrow') ? Math.max(20, Math.round(size * 0.55)) : size;
    layer.x = Math.round(crop.x + (crop.w - layer.w) / 2);
    layer.y = Math.round(crop.y + (crop.h - layer.h) / 2);
    layer.shape = {
      kind: kind,
      fillEnabled: kind !== 'line' && kind !== 'arrow',
      fill: '#5c2ddd',
      strokeEnabled: true,
      stroke: '#ffffff',
      strokeWidth: Math.max(2, Math.round(size * 0.035)),
      radius: Math.round(size * 0.16)
    };
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    return layer;
  }

  function addImageLayer(sourceCanvas, name) {
    if (!state.crop || !sourceCanvas) return null;
    var crop = state.crop;
    var scale = Math.min((crop.w * 0.62) / sourceCanvas.width, (crop.h * 0.62) / sourceCanvas.height, 1);
    var width = Math.max(1, Math.round(sourceCanvas.width * scale));
    var height = Math.max(1, Math.round(sourceCanvas.height * scale));
    var layer = newLayerBase('raster', name || 'Image');
    layer.kind = 'image';
    layer.canvas = sourceCanvas;
    layer.w = width;
    layer.h = height;
    layer.x = Math.round(crop.x + (crop.w - width) / 2);
    layer.y = Math.round(crop.y + (crop.h - height) / 2);
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    return layer;
  }

  function ensureDrawLayer() {
    var current = activeLayer();
    if (current && current.kind === 'draw' && !current.locked && current.visible) return current;
    if (!state.crop) return null;
    var crop = state.crop;
    var layer = newLayerBase('raster', 'Drawing');
    layer.kind = 'draw';
    layer.canvas = createCanvas(crop.w, crop.h);
    layer.x = crop.x;
    layer.y = crop.y;
    layer.w = crop.w;
    layer.h = crop.h;
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    return layer;
  }

  function layerKindLabel(layer) {
    if (layer.type === 'text') return 'Text';
    if (layer.type === 'shape') return 'Shape';
    if (layer.kind === 'draw') return 'Drawing';
    return 'Image';
  }

  function selectLayer(id) {
    if (!state.layers.some(function (layer) { return layer.id === id; })) return;
    state.activeLayerId = id;
    drawToScreen();
    if (state.tool === 'layers' || state.tool === 'text' || state.tool === 'shapes') {
      renderPanel(state.tool, true);
    }
  }

  function deleteActiveLayer() {
    var layer = activeLayer();
    if (!layer) return;
    state.layers = state.layers.filter(function (item) { return item.id !== layer.id; });
    var next = state.layers[state.layers.length - 1] || null;
    state.activeLayerId = next ? next.id : null;
    pushHistory();
    invalidateExport();
    renderPanel(state.tool, true);
    drawToScreen();
    schedulePreview(false);
  }

  function duplicateActiveLayer() {
    var layer = activeLayer();
    if (!layer) return;
    var copy = Object.assign({}, layer);
    copy.id = uid();
    copy.name = (layer.name || 'Layer') + ' copy';
    copy.x += 24;
    copy.y += 24;
    if (layer.canvas) copy.canvas = cloneCanvas(layer.canvas);
    if (layer.text) copy.text = Object.assign({}, layer.text);
    if (layer.shape) copy.shape = Object.assign({}, layer.shape);
    state.layers.push(copy);
    state.activeLayerId = copy.id;
    pushHistory();
    invalidateExport();
    renderPanel(state.tool, true);
    schedulePreview(false);
  }

  function moveActiveLayer(direction) {
    var layer = activeLayer();
    if (!layer) return;
    var index = state.layers.indexOf(layer);
    var target = index + direction;
    if (target < 0 || target >= state.layers.length) return;
    state.layers.splice(index, 1);
    state.layers.splice(target, 0, layer);
    pushHistory();
    invalidateExport();
    renderPanel(state.tool, true);
    schedulePreview(false);
  }

  function textLayerOptions(selected) {
    return TEXT_FONTS.map(function (font) {
      return '<option value="' + escapeHtml(font[0]) + '"' + (font[0] === selected ? ' selected' : '') + '>' + escapeHtml(font[1]) + '</option>';
    }).join('');
  }

  function textLayerList() {
    var layers = state.layers.filter(function (layer) { return layer.type === 'text'; });
    if (!layers.length) return '';
    return '<h3>Text layers</h3><ul class="editor-layer-list">' + layers.map(function (layer) {
      return '<li class="editor-layer' + (layer.id === state.activeLayerId ? ' is-active' : '') + '">' +
        '<button class="editor-layer-button" type="button" data-select-layer="' + layer.id + '" aria-label="Select ' + escapeHtml(layer.name) + '">' + icon('text') + '</button>' +
        '<span class="editor-layer-kind">' + escapeHtml(layer.text && layer.text.content ? layer.text.content.slice(0, 18) : 'Text') + '</span>' +
        '<input class="editor-layer-name" type="text" value="' + escapeHtml(layer.name) + '" data-rename-layer="' + layer.id + '" aria-label="Layer name">' +
        '<span class="editor-layer-actions"><button class="editor-layer-button" type="button" data-action="delete-layer" data-layer-id="' + layer.id + '" aria-label="Delete text layer">' + icon('trash') + '</button></span>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function textPanel() {
    var active = activeLayer();
    var isText = active && active.type === 'text';
    var html = '<div class="editor-button-row"><button class="editor-button editor-button-primary" type="button" data-action="add-text">Add text layer</button></div>';
    if (!isText) {
      return html + (textLayerList() || '<p class="editor-hint">Add a text layer, then drag it on the canvas. Text is rendered at full resolution on export.</p>');
    }
    var text = active.text;
    return html +
      '<label class="editor-field"><span>Content</span><textarea class="editor-textarea" data-text-content spellcheck="false">' + escapeHtml(text.content) + '</textarea></label>' +
      '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Font</span><select class="editor-select" data-text-font>' + textLayerOptions(text.fontFamily) + '</select></label>' +
      '<label class="editor-field"><span>Size (px)</span><input class="editor-number" type="number" min="4" max="600" step="1" value="' + text.fontSize + '" data-text-size></label>' +
      '</div>' +
      '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Colour</span><input class="editor-color" type="color" value="' + escapeHtml(text.color) + '" data-text-color></label>' +
      '<label class="editor-field"><span>Align</span><select class="editor-select" data-text-align>' +
      ['left', 'center', 'right'].map(function (value) { return '<option value="' + value + '"' + (text.align === value ? ' selected' : '') + '>' + value.charAt(0).toUpperCase() + value.slice(1) + '</option>'; }).join('') +
      '</select></label>' +
      '</div>' +
      '<div class="editor-row" style="flex-wrap:wrap;gap:10px;margin-bottom:10px">' +
      '<label class="editor-check"><input type="checkbox" data-text-bold' + (text.bold ? ' checked' : '') + '> Bold</label>' +
      '<label class="editor-check"><input type="checkbox" data-text-italic' + (text.italic ? ' checked' : '') + '> Italic</label>' +
      '<label class="editor-check"><input type="checkbox" data-text-underline' + (text.underline ? ' checked' : '') + '> Underline</label>' +
      '</div>' +
      '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Line height</span><input class="editor-number" type="number" min="0.8" max="3" step="0.05" value="' + text.lineHeight + '" data-text-line-height></label>' +
      '<label class="editor-field"><span>Letter spacing</span><input class="editor-number" type="number" min="-10" max="40" step="0.5" value="' + (text.letterSpacing || 0) + '" data-text-letter-spacing></label>' +
      '</div>' +
      '<div class="editor-field"><label for="text-direction">Direction</label><select class="editor-select" id="text-direction" data-text-direction>' +
      [['auto', 'Auto (detect Arabic and Hebrew)'], ['ltr', 'Left to right'], ['rtl', 'Right to left']].map(function (item) {
        return '<option value="' + item[0] + '"' + (text.direction === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
      }).join('') + '</select></div>' +
      '<h3>Background box</h3>' +
      '<label class="editor-check"><input type="checkbox" data-text-bg' + (text.bgEnabled ? ' checked' : '') + '> Show background</label>' +
      '<label class="editor-field" style="margin-top:8px"><span>Background colour</span><input class="editor-color" type="color" value="' + escapeHtml(text.bgColor) + '" data-text-bg-color></label>' +
      '<h3>Outline</h3>' +
      '<label class="editor-check"><input type="checkbox" data-text-outline' + (text.outlineEnabled ? ' checked' : '') + '> Show outline</label>' +
      '<div class="editor-grid-2" style="margin-top:8px">' +
      '<label class="editor-field"><span>Width</span><input class="editor-number" type="number" min="1" max="30" step="1" value="' + text.outlineWidth + '" data-text-outline-width></label>' +
      '<label class="editor-field"><span>Colour</span><input class="editor-color" type="color" value="' + escapeHtml(text.outlineColor) + '" data-text-outline-color></label>' +
      '</div>' +
      '<h3>Shadow</h3>' +
      '<label class="editor-check"><input type="checkbox" data-text-shadow' + (text.shadowEnabled ? ' checked' : '') + '> Show shadow</label>' +
      '<div class="editor-grid-2" style="margin-top:8px">' +
      '<label class="editor-field"><span>Blur</span><input class="editor-number" type="number" min="0" max="80" step="1" value="' + text.shadowBlur + '" data-text-shadow-blur></label>' +
      '<label class="editor-field"><span>Colour</span><input class="editor-color" type="color" value="' + escapeHtml(text.shadowColor) + '" data-text-shadow-color></label>' +
      '</div>' +
      '<h3>Layer</h3>' +
      rangeRow('text-opacity', 'Opacity', 0, 100, 1, Math.round(active.opacity * 100), 'data-layer-prop="opacity"', Math.round(active.opacity * 100) + '%') +
      rangeRow('text-rotation', 'Rotation', -180, 180, 1, Math.round(active.rotation || 0), 'data-layer-prop="rotation"', Math.round(active.rotation || 0) + '°') +
      '<div class="editor-button-row">' +
      '<button class="editor-button" type="button" data-action="duplicate-layer">Duplicate</button>' +
      '<button class="editor-button editor-button-danger" type="button" data-action="delete-layer">Delete</button>' +
      '</div>' +
      '<p class="editor-hint">Drag the text on the canvas to move it. Use the corner and edge handles to resize the text box and the round handle to rotate it.</p>';
  }

  function updateTextLayerHeight(layer) {
    layer.h = Math.max(10, Math.round(textLayerHeight(layer)));
  }

  function bindTextPanel() {
    var active = activeLayer();
    if (!active || active.type !== 'text') return;
    var text = active.text;
    function refresh(history, fast) {
      updateTextLayerHeight(active);
      invalidateExport();
      if (history) pushHistory();
      schedulePreview(!!fast);
      drawToScreen();
    }
    var content = $('[data-text-content]', els.panelBody);
    if (content) {
      content.addEventListener('input', function () { text.content = content.value; refresh(false, true); });
      content.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
    var font = $('[data-text-font]', els.panelBody);
    if (font) font.addEventListener('change', function () { text.fontFamily = font.value; refresh(true, false); });
    var size = $('[data-text-size]', els.panelBody);
    if (size) size.addEventListener('change', function () { text.fontSize = clamp(Number(size.value) || 32, 4, 600); refresh(true, false); });
    var color = $('[data-text-color]', els.panelBody);
    if (color) {
      color.addEventListener('input', function () { text.color = color.value; refresh(false, true); });
      color.addEventListener('change', function () { pushHistory(); });
    }
    var align = $('[data-text-align]', els.panelBody);
    if (align) align.addEventListener('change', function () { text.align = align.value; refresh(true, false); });
    [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline']].forEach(function (item) {
      var input = $('[data-text-' + item[0] + ']', els.panelBody);
      if (input) input.addEventListener('change', function () { text[item[1]] = input.checked; refresh(true, false); });
    });
    var lineHeight = $('[data-text-line-height]', els.panelBody);
    if (lineHeight) lineHeight.addEventListener('change', function () { text.lineHeight = clamp(Number(lineHeight.value) || 1.2, 0.8, 3); refresh(true, false); });
    var letterSpacing = $('[data-text-letter-spacing]', els.panelBody);
    if (letterSpacing) letterSpacing.addEventListener('change', function () { text.letterSpacing = clamp(Number(letterSpacing.value) || 0, -10, 40); refresh(true, false); });
    var direction = $('[data-text-direction]', els.panelBody);
    if (direction) direction.addEventListener('change', function () { text.direction = direction.value; refresh(true, false); });
    var bg = $('[data-text-bg]', els.panelBody);
    if (bg) bg.addEventListener('change', function () { text.bgEnabled = bg.checked; refresh(true, false); });
    var bgColor = $('[data-text-bg-color]', els.panelBody);
    if (bgColor) {
      bgColor.addEventListener('input', function () { text.bgColor = bgColor.value; refresh(false, true); });
      bgColor.addEventListener('change', function () { pushHistory(); });
    }
    var outline = $('[data-text-outline]', els.panelBody);
    if (outline) outline.addEventListener('change', function () { text.outlineEnabled = outline.checked; refresh(true, false); });
    var outlineWidth = $('[data-text-outline-width]', els.panelBody);
    if (outlineWidth) outlineWidth.addEventListener('change', function () { text.outlineWidth = clamp(Number(outlineWidth.value) || 1, 1, 30); refresh(true, false); });
    var outlineColor = $('[data-text-outline-color]', els.panelBody);
    if (outlineColor) {
      outlineColor.addEventListener('input', function () { text.outlineColor = outlineColor.value; refresh(false, true); });
      outlineColor.addEventListener('change', function () { pushHistory(); });
    }
    var shadow = $('[data-text-shadow]', els.panelBody);
    if (shadow) shadow.addEventListener('change', function () { text.shadowEnabled = shadow.checked; refresh(true, false); });
    var shadowBlur = $('[data-text-shadow-blur]', els.panelBody);
    if (shadowBlur) shadowBlur.addEventListener('change', function () { text.shadowBlur = clamp(Number(shadowBlur.value) || 0, 0, 80); refresh(true, false); });
    var shadowColor = $('[data-text-shadow-color]', els.panelBody);
    if (shadowColor) {
      shadowColor.addEventListener('input', function () { text.shadowColor = shadowColor.value; refresh(false, true); });
      shadowColor.addEventListener('change', function () { pushHistory(); });
    }
    bindLayerPropertyControls();
  }

  /* ---------- Shapes ---------- */
  function shapesPanel() {
    var buttons = Object.keys(SHAPE_LABELS).map(function (kind) {
      return '<button class="editor-button" type="button" data-add-shape="' + kind + '">' + escapeHtml(SHAPE_LABELS[kind]) + '</button>';
    }).join('');
    var html = '<div class="editor-button-row" style="margin-top:0">' + buttons + '</div>';
    var active = activeLayer();
    if (!active || active.type !== 'shape') {
      return html + '<p class="editor-hint">Add a shape, then drag it on the canvas. Use the corner and edge handles to resize and the round handle to rotate.</p>';
    }
    var shape = active.shape;
    return html +
      '<div class="editor-field"><label for="shape-kind">Shape</label><select class="editor-select" id="shape-kind" data-shape-kind>' +
      Object.keys(SHAPE_LABELS).map(function (kind) {
        return '<option value="' + kind + '"' + (shape.kind === kind ? ' selected' : '') + '>' + escapeHtml(SHAPE_LABELS[kind]) + '</option>';
      }).join('') + '</select></div>' +
      '<label class="editor-check"><input type="checkbox" data-shape-fill' + (shape.fillEnabled ? ' checked' : '') + '> Fill</label>' +
      '<label class="editor-field" style="margin-top:8px"><span>Fill colour</span><input class="editor-color" type="color" value="' + escapeHtml(shape.fill) + '" data-shape-fill-color></label>' +
      '<label class="editor-check"><input type="checkbox" data-shape-stroke' + (shape.strokeEnabled ? ' checked' : '') + '> Stroke</label>' +
      '<div class="editor-grid-2" style="margin-top:8px">' +
      '<label class="editor-field"><span>Stroke width</span><input class="editor-number" type="number" min="1" max="80" step="1" value="' + shape.strokeWidth + '" data-shape-stroke-width></label>' +
      '<label class="editor-field"><span>Stroke colour</span><input class="editor-color" type="color" value="' + escapeHtml(shape.stroke) + '" data-shape-stroke-color></label>' +
      '</div>' +
      '<div class="editor-field"><span>Corner radius</span><input class="editor-number" type="number" min="0" max="400" step="1" value="' + shape.radius + '" data-shape-radius></div>' +
      '<h3>Layer</h3>' +
      rangeRow('shape-opacity', 'Opacity', 0, 100, 1, Math.round(active.opacity * 100), 'data-layer-prop="opacity"', Math.round(active.opacity * 100) + '%') +
      rangeRow('shape-rotation', 'Rotation', -180, 180, 1, Math.round(active.rotation || 0), 'data-layer-prop="rotation"', Math.round(active.rotation || 0) + '°') +
      '<div class="editor-button-row">' +
      '<button class="editor-button" type="button" data-action="duplicate-layer">Duplicate</button>' +
      '<button class="editor-button editor-button-danger" type="button" data-action="delete-layer">Delete</button>' +
      '</div>';
  }

  function bindShapesPanel() {
    var active = activeLayer();
    if (!active || active.type !== 'shape') return;
    var shape = active.shape;
    function refresh(history, fast) {
      invalidateExport();
      if (history) pushHistory();
      schedulePreview(!!fast);
      drawToScreen();
    }
    var kind = $('[data-shape-kind]', els.panelBody);
    if (kind) kind.addEventListener('change', function () {
      shape.kind = kind.value;
      active.name = SHAPE_LABELS[shape.kind] || 'Shape';
      refresh(true, false);
    });
    var fill = $('[data-shape-fill]', els.panelBody);
    if (fill) fill.addEventListener('change', function () { shape.fillEnabled = fill.checked; refresh(true, false); });
    var fillColor = $('[data-shape-fill-color]', els.panelBody);
    if (fillColor) {
      fillColor.addEventListener('input', function () { shape.fill = fillColor.value; refresh(false, true); });
      fillColor.addEventListener('change', function () { pushHistory(); });
    }
    var stroke = $('[data-shape-stroke]', els.panelBody);
    if (stroke) stroke.addEventListener('change', function () { shape.strokeEnabled = stroke.checked; refresh(true, false); });
    var strokeWidth = $('[data-shape-stroke-width]', els.panelBody);
    if (strokeWidth) strokeWidth.addEventListener('change', function () { shape.strokeWidth = clamp(Number(strokeWidth.value) || 1, 1, 80); refresh(true, false); });
    var strokeColor = $('[data-shape-stroke-color]', els.panelBody);
    if (strokeColor) {
      strokeColor.addEventListener('input', function () { shape.stroke = strokeColor.value; refresh(false, true); });
      strokeColor.addEventListener('change', function () { pushHistory(); });
    }
    var radius = $('[data-shape-radius]', els.panelBody);
    if (radius) radius.addEventListener('change', function () { shape.radius = clamp(Number(radius.value) || 0, 0, 400); refresh(true, false); });
    bindLayerPropertyControls();
  }

  function bindLayerPropertyControls() {
    $$('[data-layer-prop]', els.panelBody).forEach(function (input) {
      var property = input.getAttribute('data-layer-prop');
      input.addEventListener('input', function () {
        var layer = activeLayer();
        if (!layer) return;
        if (property === 'opacity') layer.opacity = clamp(Number(input.value) / 100, 0, 1);
        else if (property === 'rotation') layer.rotation = Number(input.value);
        var output = input.parentNode.querySelector('output');
        if (output) output.textContent = property === 'opacity' ? input.value + '%' : input.value + '°';
        invalidateExport();
        schedulePreview(true);
        drawToScreen();
      });
      input.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    });
  }

  /* ---------- Draw ---------- */
  function drawPanel() {
    var active = activeLayer();
    var isDrawing = active && active.kind === 'draw';
    return '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Brush colour</span><input class="editor-color" type="color" value="' + escapeHtml(state.draw.color) + '" data-draw-color></label>' +
      '<label class="editor-field"><span>Brush size</span><input class="editor-number" type="number" min="1" max="300" step="1" value="' + state.draw.size + '" data-draw-size></label>' +
      '</div>' +
      rangeRow('draw-opacity', 'Opacity', 1, 100, 1, state.draw.opacity, 'data-draw-opacity', state.draw.opacity + '%') +
      '<label class="editor-check"><input type="checkbox" data-draw-eraser' + (state.draw.eraser ? ' checked' : '') + '> Eraser</label>' +
      '<div class="editor-button-row">' +
      '<button class="editor-button" type="button" data-action="new-draw-layer">New drawing layer</button>' +
      '<button class="editor-button" type="button" data-action="clear-draw"' + (isDrawing ? '' : ' disabled') + '>Clear drawing</button>' +
      '</div>' +
      '<p class="editor-hint">Draw directly on the preview with a mouse, pen or finger. Each drawing is stored as its own layer, so you can hide, reorder or delete it in Layers. The eraser only affects the active drawing layer.</p>';
  }

  function bindDrawPanel() {
    var color = $('[data-draw-color]', els.panelBody);
    if (color) {
      color.addEventListener('input', function () { state.draw.color = color.value; });
      color.addEventListener('change', function () { state.draw.color = color.value; });
    }
    var size = $('[data-draw-size]', els.panelBody);
    if (size) size.addEventListener('change', function () { state.draw.size = clamp(Number(size.value) || 12, 1, 300); });
    var opacity = $('[data-draw-opacity]', els.panelBody);
    if (opacity) {
      opacity.addEventListener('input', function () {
        state.draw.opacity = clamp(Number(opacity.value) || 100, 1, 100);
        var output = opacity.parentNode.querySelector('output');
        if (output) output.textContent = opacity.value + '%';
      });
    }
    var eraser = $('[data-draw-eraser]', els.panelBody);
    if (eraser) eraser.addEventListener('change', function () { state.draw.eraser = eraser.checked; });
  }

  /* ---------- Frame ---------- */
  function framePanel() {
    var frame = state.frame;
    var backgrounds = [['transparent', 'Transparent'], ['color', 'Solid colour'], ['gradient', 'Gradient'], ['image', 'Image']];
    return rangeRow('frame-padding', 'Padding', 0, 400, 1, frame.padding, 'data-frame-padding', frame.padding + ' px') +
      '<div class="editor-field"><label for="frame-background">Background</label><select class="editor-select" id="frame-background" data-frame-background>' +
      backgrounds.map(function (item) { return '<option value="' + item[0] + '"' + (frame.background === item[0] ? ' selected' : '') + '>' + item[1] + '</option>'; }).join('') +
      '</select></div>' +
      '<div data-frame-color-row><label class="editor-field"><span>Colour</span><input class="editor-color" type="color" value="' + escapeHtml(frame.color) + '" data-frame-color></label></div>' +
      '<div data-frame-gradient-row><div class="editor-grid-2">' +
      '<label class="editor-field"><span>From</span><input class="editor-color" type="color" value="' + escapeHtml(frame.gradientFrom) + '" data-frame-gradient-from></label>' +
      '<label class="editor-field"><span>To</span><input class="editor-color" type="color" value="' + escapeHtml(frame.gradientTo) + '" data-frame-gradient-to></label>' +
      '</div>' + rangeRow('frame-gradient-angle', 'Angle', 0, 360, 1, frame.gradientAngle, 'data-frame-gradient-angle', frame.gradientAngle + '°') + '</div>' +
      '<div data-frame-image-row><div class="editor-button-row" style="margin-top:0">' +
      '<button class="editor-button" type="button" data-action="frame-image">Choose image</button>' +
      '<button class="editor-button" type="button" data-action="clear-frame-image">Clear image</button>' +
      '</div></div>' +
      rangeRow('frame-radius', 'Corner radius', 0, 400, 1, frame.radius, 'data-frame-radius', frame.radius + ' px') +
      '<h3>Border</h3>' +
      '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Width</span><input class="editor-number" type="number" min="0" max="80" step="1" value="' + frame.borderWidth + '" data-frame-border-width></label>' +
      '<label class="editor-field"><span>Colour</span><input class="editor-color" type="color" value="' + escapeHtml(frame.borderColor) + '" data-frame-border-color></label>' +
      '</div>' +
      '<label class="editor-check"><input type="checkbox" data-frame-shadow' + (frame.shadow ? ' checked' : '') + '> Drop shadow</label>' +
      '<p class="editor-hint">Padding adds space around the photo and increases the export size. Transparent padding is kept in PNG, WebP and AVIF; JPG and BMP are filled with white.</p>';
  }

  function updateFrameRows() {
    var type = state.frame.background;
    var colorRow = $('[data-frame-color-row]', els.panelBody);
    var gradientRow = $('[data-frame-gradient-row]', els.panelBody);
    var imageRow = $('[data-frame-image-row]', els.panelBody);
    if (colorRow) colorRow.hidden = type !== 'color';
    if (gradientRow) gradientRow.hidden = type !== 'gradient';
    if (imageRow) imageRow.hidden = type !== 'image';
  }

  function bindFramePanel() {
    var padding = $('[data-frame-padding]', els.panelBody);
    if (padding) {
      padding.addEventListener('input', function () {
        state.frame.padding = clamp(Number(padding.value) || 0, 0, 400);
        var output = padding.parentNode.querySelector('output');
        if (output) output.textContent = padding.value + ' px';
        invalidateExport();
        schedulePreview(true);
      });
      padding.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
    var background = $('[data-frame-background]', els.panelBody);
    if (background) background.addEventListener('change', function () {
      state.frame.background = background.value;
      updateFrameRows();
      pushHistory();
      invalidateExport();
      schedulePreview(false);
    });
    var color = $('[data-frame-color]', els.panelBody);
    if (color) {
      color.addEventListener('input', function () { state.frame.color = color.value; invalidateExport(); schedulePreview(true); });
      color.addEventListener('change', function () { pushHistory(); });
    }
    var gradientFrom = $('[data-frame-gradient-from]', els.panelBody);
    if (gradientFrom) {
      gradientFrom.addEventListener('input', function () { state.frame.gradientFrom = gradientFrom.value; invalidateExport(); schedulePreview(true); });
      gradientFrom.addEventListener('change', function () { pushHistory(); });
    }
    var gradientTo = $('[data-frame-gradient-to]', els.panelBody);
    if (gradientTo) {
      gradientTo.addEventListener('input', function () { state.frame.gradientTo = gradientTo.value; invalidateExport(); schedulePreview(true); });
      gradientTo.addEventListener('change', function () { pushHistory(); });
    }
    var angle = $('[data-frame-gradient-angle]', els.panelBody);
    if (angle) {
      angle.addEventListener('input', function () {
        state.frame.gradientAngle = Number(angle.value);
        var output = angle.parentNode.querySelector('output');
        if (output) output.textContent = angle.value + '°';
        invalidateExport();
        schedulePreview(true);
      });
      angle.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
    var radius = $('[data-frame-radius]', els.panelBody);
    if (radius) {
      radius.addEventListener('input', function () {
        state.frame.radius = Number(radius.value);
        var output = radius.parentNode.querySelector('output');
        if (output) output.textContent = radius.value + ' px';
        invalidateExport();
        schedulePreview(true);
      });
      radius.addEventListener('change', function () { pushHistory(); schedulePreview(false); });
    }
    var borderWidth = $('[data-frame-border-width]', els.panelBody);
    if (borderWidth) borderWidth.addEventListener('change', function () {
      state.frame.borderWidth = clamp(Number(borderWidth.value) || 0, 0, 80);
      pushHistory();
      invalidateExport();
      schedulePreview(false);
    });
    var borderColor = $('[data-frame-border-color]', els.panelBody);
    if (borderColor) {
      borderColor.addEventListener('input', function () { state.frame.borderColor = borderColor.value; invalidateExport(); schedulePreview(true); });
      borderColor.addEventListener('change', function () { pushHistory(); });
    }
    var shadow = $('[data-frame-shadow]', els.panelBody);
    if (shadow) shadow.addEventListener('change', function () {
      state.frame.shadow = shadow.checked;
      pushHistory();
      invalidateExport();
      schedulePreview(false);
    });
    updateFrameRows();
  }

  /* ---------- Layers ---------- */
  function layersPanel() {
    var rows = state.layers.slice().reverse().map(function (layer) {
      var active = layer.id === state.activeLayerId;
      return '<li class="editor-layer' + (active ? ' is-active' : '') + '" data-layer-row="' + layer.id + '">' +
        '<button class="editor-layer-button" type="button" data-layer-action="visible" aria-label="' + (layer.visible ? 'Hide' : 'Show') + ' layer" title="' + (layer.visible ? 'Hide' : 'Show') + '">' + icon(layer.visible ? 'eye' : 'eye-off') + '</button>' +
        '<button class="editor-layer-button" type="button" data-layer-action="lock" aria-label="' + (layer.locked ? 'Unlock' : 'Lock') + ' layer" title="' + (layer.locked ? 'Unlock' : 'Lock') + '">' + icon(layer.locked ? 'lock' : 'unlock') + '</button>' +
        '<span class="editor-layer-main">' +
        '<input class="editor-layer-name" type="text" value="' + escapeHtml(layer.name) + '" data-rename-layer="' + layer.id + '" aria-label="Layer name">' +
        '<span class="editor-layer-kind">' + escapeHtml(layerKindLabel(layer)) + '</span>' +
        '</span>' +
        '<span class="editor-layer-actions">' +
        '<button class="editor-layer-button" type="button" data-layer-action="up" aria-label="Move layer up" title="Move up">' + icon('up') + '</button>' +
        '<button class="editor-layer-button" type="button" data-layer-action="down" aria-label="Move layer down" title="Move down">' + icon('down') + '</button>' +
        '<button class="editor-layer-button" type="button" data-layer-action="duplicate" aria-label="Duplicate layer" title="Duplicate">' + icon('copy') + '</button>' +
        '<button class="editor-layer-button" type="button" data-layer-action="delete" aria-label="Delete layer" title="Delete">' + icon('trash') + '</button>' +
        '</span>' +
        '</li>';
    }).join('');
    var active = activeLayer();
    var html = '<div class="editor-button-row" style="margin-top:0">' +
      '<button class="editor-button" type="button" data-action="add-image-layer">' + icon('image') + 'Add image</button>' +
      '<button class="editor-button" type="button" data-action="add-text">' + icon('text') + 'Add text</button>' +
      '<button class="editor-button" type="button" data-action="new-draw-layer">' + icon('draw') + 'Add drawing</button>' +
      '</div>';
    if (!rows) {
      return html + '<p class="editor-hint">No extra layers yet. Add text, a shape, a drawing or an image. The photo itself stays as the base layer.</p>';
    }
    html += '<ul class="editor-layer-list" data-layer-list>' + rows + '</ul>';
    if (!active) {
      return html + '<p class="editor-hint">Select a layer to edit its position, size, opacity, rotation and blend mode.</p>';
    }
    html += '<h3>Active layer</h3>' +
      '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>X</span><input class="editor-number" type="number" step="1" value="' + Math.round(active.x) + '" data-layer-field="x"></label>' +
      '<label class="editor-field"><span>Y</span><input class="editor-number" type="number" step="1" value="' + Math.round(active.y) + '" data-layer-field="y"></label>' +
      '<label class="editor-field"><span>Width</span><input class="editor-number" type="number" min="1" step="1" value="' + Math.round(active.w) + '" data-layer-field="w"></label>' +
      '<label class="editor-field"><span>Height</span><input class="editor-number" type="number" min="1" step="1" value="' + Math.round(active.h) + '" data-layer-field="h"></label>' +
      '</div>' +
      rangeRow('layer-opacity', 'Opacity', 0, 100, 1, Math.round(active.opacity * 100), 'data-layer-prop="opacity"', Math.round(active.opacity * 100) + '%') +
      rangeRow('layer-rotation', 'Rotation', -180, 180, 1, Math.round(active.rotation || 0), 'data-layer-prop="rotation"', Math.round(active.rotation || 0) + '°') +
      '<div class="editor-field"><label for="layer-blend">Blend mode</label><select class="editor-select" id="layer-blend" data-layer-blend>' +
      ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'hard-light'].map(function (value) {
        var label = value === 'source-over' ? 'Normal' : value.replace(/-/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
        return '<option value="' + value + '"' + ((active.blend || 'source-over') === value ? ' selected' : '') + '>' + label + '</option>';
      }).join('') + '</select></div>' +
      '<div class="editor-button-row">' +
      '<button class="editor-button" type="button" data-action="duplicate-layer">Duplicate</button>' +
      '<button class="editor-button editor-button-danger" type="button" data-action="delete-layer">Delete</button>' +
      '</div>' +
      '<p class="editor-hint">Layers are drawn bottom to top. Move a layer up to place it above the others. The photo base is always below every layer.</p>';
    return html;
  }

  function bindLayersPanel() {
    $$('[data-layer-row]', els.panelBody).forEach(function (row) {
      row.addEventListener('click', function (event) {
        if (event.target.closest('button, input')) return;
        selectLayer(row.getAttribute('data-layer-row'));
      });
    });
    $$('[data-layer-action]', els.panelBody).forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        var row = button.closest('[data-layer-row]');
        if (!row) return;
        handleLayerAction(button.getAttribute('data-layer-action'), row.getAttribute('data-layer-row'));
      });
    });
    $$('[data-layer-field]', els.panelBody).forEach(function (input) {
      input.addEventListener('change', function () {
        var layer = activeLayer();
        if (!layer) return;
        var field = input.getAttribute('data-layer-field');
        var value = Number(input.value);
        if (field === 'x' || field === 'y') layer[field] = Math.round(value);
        else if (field === 'w' || field === 'h') layer[field] = Math.max(1, Math.round(value));
        if (layer.type === 'text' && field === 'w') updateTextLayerHeight(layer);
        pushHistory();
        invalidateExport();
        drawToScreen();
        schedulePreview(false);
      });
    });
    var blend = $('[data-layer-blend]', els.panelBody);
    if (blend) blend.addEventListener('change', function () {
      var layer = activeLayer();
      if (!layer) return;
      layer.blend = blend.value;
      pushHistory();
      invalidateExport();
      schedulePreview(false);
    });
    bindLayerPropertyControls();
  }

  function handleLayerAction(action, id) {
    var layer = state.layers.filter(function (item) { return item.id === id; })[0];
    if (!layer) return;
    state.activeLayerId = id;
    if (action === 'visible') {
      layer.visible = !layer.visible;
    } else if (action === 'lock') {
      layer.locked = !layer.locked;
    } else if (action === 'up' || action === 'down') {
      var index = state.layers.indexOf(layer);
      var target = index + (action === 'up' ? 1 : -1);
      if (target >= 0 && target < state.layers.length) {
        state.layers.splice(index, 1);
        state.layers.splice(target, 0, layer);
      }
    } else if (action === 'duplicate') {
      duplicateActiveLayer();
      return;
    } else if (action === 'delete') {
      deleteActiveLayer();
      return;
    }
    pushHistory();
    invalidateExport();
    renderPanel('layers', true);
    drawToScreen();
    schedulePreview(false);
  }

  function syncLayerGeometryInputs() {
    var layer = activeLayer();
    if (!layer) return;
    ['x', 'y', 'w', 'h'].forEach(function (field) {
      var input = $('[data-layer-field="' + field + '"]', els.panelBody);
      if (input) input.value = Math.round(layer[field]);
    });
    var rotation = $('[data-layer-prop="rotation"]', els.panelBody);
    if (rotation) {
      rotation.value = Math.round(Number(layer.rotation) || 0);
      var output = rotation.parentNode.querySelector('output');
      if (output) output.textContent = rotation.value + '°';
    }
  }

  /* ---------- Export ---------- */
  function supportedFormats() {
    return FORMATS.filter(function (item) {
      return item[0] !== 'image/avif' || supports['image/avif'];
    });
  }

  function qualityFormat(type) {
    return type === 'image/jpeg' || type === 'image/webp' || type === 'image/avif';
  }

  function alphaFormat(type) {
    return type === 'image/png' || type === 'image/webp' || type === 'image/avif';
  }

  function exportPanel() {
    var formats = supportedFormats();
    if (!formats.some(function (item) { return item[0] === state.export.format; })) {
      state.export.format = 'image/jpeg';
    }
    var size = state.source ? getFinalSize() : { width: 0, height: 0 };
    var html = '<div class="editor-grid-2">' +
      '<label class="editor-field"><span>Format</span><select class="editor-select" data-export-format>' +
      formats.map(function (item) {
        return '<option value="' + item[0] + '"' + (state.export.format === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="editor-field" data-export-quality-row><span>Quality</span><input class="editor-number" type="number" min="1" max="100" step="1" value="' + state.export.quality + '" data-export-quality></label>' +
      '</div>' +
      '<label class="editor-field"><span>Filename</span><input class="editor-input" type="text" value="' + escapeHtml(state.export.filename || 'letitedit-image') + '" data-export-filename spellcheck="false"></label>' +
      '<div data-export-target-row><label class="editor-field"><span>Target size (KB, optional)</span><input class="editor-number" type="number" min="1" step="1" value="' + (state.export.targetKB || '') + '" placeholder="For example 500" data-export-target></label></div>' +
      '<label class="editor-check" data-export-transparency-row><input type="checkbox" data-export-transparency' + (state.export.transparency ? ' checked' : '') + '> Keep transparency</label>' +
      '<div class="editor-fileinfo" style="margin-top:12px">' +
      infoRow('Export size', state.source ? size.width + ' × ' + size.height + ' px' : 'No image open') +
      infoRow('Format', mimeLabel(state.export.format)) +
      infoRow('Estimated pixels', state.source ? (size.width * size.height).toLocaleString() : '—') +
      '</div>' +
      '<div class="editor-button-row">' +
      '<button class="editor-button editor-button-primary" type="button" data-action="download"' + (state.source ? '' : ' disabled') + '>' + icon('export') + 'Download</button>' +
      '<button class="editor-button" type="button" data-action="estimate"' + (state.source ? '' : ' disabled') + '>Estimate size</button>' +
      '</div>' +
      '<div class="editor-button-row"><button class="editor-button editor-button-block" type="button" data-action="copy-png"' + (state.source ? '' : ' disabled') + '>Copy PNG to clipboard</button></div>' +
      '<div data-export-result>' + (state.export.lastResult ? exportResultHtml(state.export.lastResult) : '') + '</div>' +
      '<div class="editor-button-row"><button class="editor-button editor-button-danger" type="button" data-action="reset-all"' + (state.source ? '' : ' disabled') + '>Reset all edits</button></div>' +
      '<p class="editor-note"><strong>Exports are encoded on this device.</strong> JPG and WebP use the quality setting. PNG is lossless. BMP is uncompressed. AVIF export appears only when the browser can encode it. A target size is best effort and the real result is always reported.</p>';
    return html;
  }

  function exportResultHtml(result) {
    if (!result) return '';
    var target = result.targetKB ? '<div class="editor-fileinfo-row"><span>Target</span><span>' + escapeHtml(String(result.targetKB)) + ' KB ' + (result.reached ? '· reached' : '· could not be reached') + '</span></div>' : '';
    var quality = qualityFormat(result.type) ? '<div class="editor-fileinfo-row"><span>Quality</span><span>' + Math.round(result.quality * 100) + '</span></div>' : '';
    return '<div class="editor-fileinfo" style="margin-top:12px">' +
      infoRow('Last encoded size', formatBytes(result.blob.size)) +
      infoRow('Dimensions', result.width + ' × ' + result.height + ' px') +
      infoRow('Format', mimeLabel(result.type)) +
      quality + target +
      '</div>';
  }

  function bindExportPanel() {
    var format = $('[data-export-format]', els.panelBody);
    if (format) format.addEventListener('change', function () {
      state.export.format = format.value;
      invalidateExport();
      updateExportControls();
    });
    var quality = $('[data-export-quality]', els.panelBody);
    if (quality) quality.addEventListener('change', function () {
      state.export.quality = clamp(Math.round(Number(quality.value) || 92), 1, 100);
      quality.value = state.export.quality;
      invalidateExport();
    });
    var filename = $('[data-export-filename]', els.panelBody);
    if (filename) filename.addEventListener('change', function () {
      state.export.filename = filename.value;
      invalidateExport();
    });
    var target = $('[data-export-target]', els.panelBody);
    if (target) target.addEventListener('change', function () {
      state.export.targetKB = Math.max(0, Math.round(Number(target.value) || 0));
      invalidateExport();
    });
    var transparency = $('[data-export-transparency]', els.panelBody);
    if (transparency) transparency.addEventListener('change', function () {
      state.export.transparency = transparency.checked;
      invalidateExport();
    });
    updateExportControls();
  }

  function updateExportControls() {
    var type = state.export.format;
    var qualityRow = $('[data-export-quality-row]', els.panelBody);
    var quality = $('[data-export-quality]', els.panelBody);
    var targetRow = $('[data-export-target-row]', els.panelBody);
    var target = $('[data-export-target]', els.panelBody);
    var alphaRow = $('[data-export-transparency-row]', els.panelBody);
    var alpha = $('[data-export-transparency]', els.panelBody);
    var canQuality = qualityFormat(type);
    var canAlpha = alphaFormat(type);
    if (qualityRow) qualityRow.hidden = !canQuality;
    if (quality) quality.disabled = !canQuality;
    if (targetRow) targetRow.hidden = !canQuality;
    if (target) target.disabled = !canQuality;
    if (alphaRow) alphaRow.hidden = !canAlpha;
    if (alpha) alpha.disabled = !canAlpha;
  }

  function invalidateExport() {
    state.export.lastResult = null;
    var box = $('[data-export-result]', els.panelBody);
    if (box) box.innerHTML = '';
  }

  function flattenCanvas(source, color) {
    var output = createCanvas(source.width, source.height);
    var context = output.getContext('2d');
    context.fillStyle = color || '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0);
    return output;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) {
            reject(new Error('The browser could not encode ' + mimeLabel(type) + '. Try another format.'));
            return;
          }
          resolve(blob);
        }, type, quality);
      } catch (error) {
        reject(error);
      }
    });
  }

  function canvasToBmpBlob(canvas) {
    var width = canvas.width;
    var height = canvas.height;
    var data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    var rowSize = Math.floor((24 * width + 31) / 32) * 4;
    var pixelSize = rowSize * height;
    var fileSize = 54 + pixelSize;
    var buffer = new ArrayBuffer(fileSize);
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    bytes[0] = 0x42;
    bytes[1] = 0x4D;
    view.setUint32(2, fileSize, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, pixelSize, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    for (var y = 0; y < height; y += 1) {
      var sourceY = height - 1 - y;
      for (var x = 0; x < width; x += 1) {
        var source = (sourceY * width + x) * 4;
        var destination = 54 + y * rowSize + x * 3;
        bytes[destination] = data[source + 2];
        bytes[destination + 1] = data[source + 1];
        bytes[destination + 2] = data[source];
      }
    }
    return new Blob([buffer], { type: 'image/bmp' });
  }

  async function prepareExport() {
    if (!state.source) {
      toast('Open an image first.', true);
      return null;
    }
    if (state.busy) return null;
    var type = state.export.format;
    if (type === 'image/avif' && !supports['image/avif']) {
      toast('AVIF export is not available in this browser.', true);
      return null;
    }
    var size = getFinalSize();
    if (size.width * size.height > 60000000) {
      toast('This export is too large for the browser canvas. Reduce the size first.', true);
      return null;
    }
    state.busy = true;
    try {
      showProgress('Rendering full resolution…', 20);
      await nextFrame();
      var canvas = await renderComposite(size.width, size.height, 1);
      var keepAlpha = state.export.transparency && alphaFormat(type);
      if (!keepAlpha) canvas = flattenCanvas(canvas, '#ffffff');
      var targetKB = Math.max(0, Number(state.export.targetKB) || 0);
      var quality = clamp(Number(state.export.quality) / 100, 0.05, 1);
      var blob = null;
      var usedQuality = quality;
      var reached = true;
      showProgress('Encoding ' + mimeLabel(type) + '…', 60);
      await nextFrame();
      if (type === 'image/bmp') {
        blob = canvasToBmpBlob(canvas);
      } else if (targetKB > 0 && qualityFormat(type)) {
        var low = 0.05;
        var high = 0.98;
        var best = null;
        var bestQuality = 0;
        for (var i = 0; i < 7; i += 1) {
          var middle = (low + high) / 2;
          var candidate = await canvasToBlob(canvas, type, middle);
          if (candidate.size / 1024 > targetKB) {
            high = middle;
          } else {
            best = candidate;
            bestQuality = middle;
            low = middle;
          }
        }
        if (best) {
          blob = best;
          usedQuality = bestQuality;
          reached = blob.size / 1024 <= targetKB * 1.02;
        } else {
          blob = await canvasToBlob(canvas, type, 0.05);
          usedQuality = 0.05;
          reached = false;
        }
      } else {
        blob = await canvasToBlob(canvas, type, quality);
      }
      if (type === 'image/avif' && blob.type !== 'image/avif') {
        throw new Error('The browser did not produce an AVIF file. Choose JPG, PNG or WebP.');
      }
      var result = {
        blob: blob, type: type, quality: usedQuality, width: size.width, height: size.height,
        targetKB: targetKB, reached: reached
      };
      state.export.lastResult = result;
      showProgress('Ready', 100);
      setTimeout(hideProgress, 300);
      return result;
    } catch (error) {
      hideProgress();
      toast(error.message || 'The export failed.', true);
      return null;
    } finally {
      state.busy = false;
    }
  }

  function exportFilename(type) {
    var base = state.export.filename || (state.source ? state.source.name.replace(/\.[^.]+$/, '') + '-edited' : 'letitedit-image');
    base = sanitizeFilename(base).replace(/\.(jpe?g|png|webp|bmp|avif)$/i, '');
    return (base || 'letitedit-image') + '.' + extensionFor(type);
  }

  async function estimateExport() {
    var result = await prepareExport();
    if (!result) return;
    var box = $('[data-export-result]', els.panelBody);
    if (box) box.innerHTML = exportResultHtml(result);
    toast('Estimated size: ' + formatBytes(result.blob.size) + (result.targetKB && !result.reached ? ' (target not reached)' : ''));
  }

  async function downloadExport() {
    var result = await prepareExport();
    if (!result) return;
    var name = exportFilename(result.type);
    var url = URL.createObjectURL(result.blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    var box = $('[data-export-result]', els.panelBody);
    if (box) box.innerHTML = exportResultHtml(result);
    toast('Downloaded ' + name + ' · ' + formatBytes(result.blob.size));
  }

  async function copyPng() {
    if (!state.source) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('Copying images to the clipboard is not supported in this browser.', true);
      return;
    }
    state.busy = true;
    try {
      showProgress('Preparing PNG for the clipboard…', 35);
      await nextFrame();
      var size = getFinalSize();
      var canvas = await renderComposite(size.width, size.height, 1);
      var blob = await canvasToBlob(canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      hideProgress();
      toast('PNG copied to the clipboard.');
    } catch (error) {
      hideProgress();
      toast(error && error.message ? error.message : 'The browser blocked clipboard access. Use Download instead.', true);
    } finally {
      state.busy = false;
    }
  }

  function resetAllEdits() {
    if (!state.source) return;
    if (!window.confirm('Reset all edits and keep the original image?')) return;
    state.transform = { rotation: 0, straighten: 0, flipH: false, flipV: false };
    state.cropAspect = 0;
    state.resize = Object.assign({}, DEFAULT_RESIZE);
    state.frame = Object.assign({}, DEFAULT_FRAME);
    state.adjustments = Object.assign({}, DEFAULT_ADJUSTMENTS);
    state.filter = { name: 'none', intensity: 100 };
    state.blur = { type: 'none', amount: 12, angle: 0 };
    state.draw = { color: '#5c2ddd', size: 12, opacity: 100, eraser: false };
    state.layers = [];
    state.activeLayerId = null;
    state.compare = false;
    rebuildBase(true);
    pushHistory();
    invalidateExport();
    renderPanel(state.tool, true);
    drawToScreen();
    updateStatus();
    schedulePreview(false);
    toast('All edits reset. The original image is unchanged.');
  }

  /* ---------- Actions ---------- */
  function openExportPanel() {
    root.classList.remove('panel-collapsed');
    state.tool = 'export';
    renderPanel('export', true);
    if (isMobile()) openSheet();
    drawToScreen();
  }

  function selectTool(tool) {
    if (tool === 'crop') {
      state.compare = false;
      $$('[data-action="compare"]').forEach(function (button) { button.setAttribute('aria-pressed', 'false'); });
    }
    if (!state.source && tool !== 'import' && tool !== 'export') {
      toast('Open an image first, then choose a tool.', true);
      state.tool = 'import';
      renderPanel('import', true);
      if (isMobile()) openSheet();
      drawToScreen();
      return;
    }
    root.classList.remove('panel-collapsed');
    state.tool = tool;
    if (tool === 'crop') state.compare = false;
    renderPanel(tool, true);
    if (isMobile()) openSheet();
    drawToScreen();
    schedulePreview(false);
  }

  function addDrawingLayer() {
    if (!state.crop) return;
    var crop = state.crop;
    var layer = newLayerBase('raster', 'Drawing');
    layer.kind = 'draw';
    layer.canvas = createCanvas(crop.w, crop.h);
    layer.x = crop.x;
    layer.y = crop.y;
    layer.w = crop.w;
    layer.h = crop.h;
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    state.tool = 'draw';
    pushHistory();
    invalidateExport();
    renderPanel('draw', true);
    drawToScreen();
    schedulePreview(false);
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast('Use Ctrl+V (or Cmd+V) to paste an image into the editor.', true);
      return;
    }
    try {
      var items = await navigator.clipboard.read();
      for (var i = 0; i < items.length; i += 1) {
        for (var j = 0; j < items[i].types.length; j += 1) {
          if (items[i].types[j].indexOf('image/') === 0) {
            var blob = await items[i].getType(items[i].types[j]);
            var extension = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            await loadFile(new File([blob], 'pasted-image.' + extension, { type: blob.type }));
            return;
          }
        }
      }
      toast('The clipboard does not contain an image.', true);
    } catch (error) {
      toast('Clipboard access was blocked. Use Ctrl+V or choose a file.', true);
    }
  }

  function handleAction(name, button) {
    switch (name) {
      case 'browse':
      case 'replace':
        if (els.fileInput) els.fileInput.click();
        break;
      case 'remove':
        removeImage();
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'export':
        openExportPanel();
        break;
      case 'download':
        downloadExport();
        break;
      case 'estimate':
        estimateExport();
        break;
      case 'copy-png':
        copyPng();
        break;
      case 'reset-all':
        resetAllEdits();
        break;
      case 'auto-enhance':
        autoEnhance();
        break;
      case 'reset-adjust':
        state.adjustments = Object.assign({}, DEFAULT_ADJUSTMENTS);
        pushHistory();
        invalidateExport();
        renderPanel('adjust', true);
        schedulePreview(false);
        break;
      case 'reset-blur':
        state.blur = { type: 'none', amount: 12, angle: 0 };
        pushHistory();
        invalidateExport();
        renderPanel('blur', true);
        schedulePreview(false);
        break;
      case 'reset-crop':
        if (!state.base) break;
        state.crop = { x: 0, y: 0, w: state.base.width, h: state.base.height };
        state.cropAspect = 0;
        pushHistory();
        invalidateExport();
        renderPanel('crop', true);
        drawToScreen();
        updateStatus();
        schedulePreview(false);
        break;
      case 'rotate-left':
        rotateImage(-90);
        break;
      case 'rotate-right':
        rotateImage(90);
        break;
      case 'flip-h':
        flipImage('flipH');
        break;
      case 'flip-v':
        flipImage('flipV');
        break;
      case 'reset-transform':
        state.transform = { rotation: 0, straighten: 0, flipH: false, flipV: false };
        state.cropAspect = 0;
        rebuildBase(true);
        pushHistory();
        invalidateExport();
        renderPanel('crop', true);
        drawToScreen();
        updateStatus();
        schedulePreview(false);
        break;
      case 'reset-resize':
        state.resize = Object.assign({}, DEFAULT_RESIZE);
        if (state.crop) {
          state.resize.width = state.crop.w;
          state.resize.height = state.crop.h;
        }
        pushHistory();
        invalidateExport();
        renderPanel('resize', true);
        updateStatus();
        schedulePreview(false);
        break;
      case 'add-text':
        if (!state.crop) { toast('Open an image first.', true); break; }
        createTextLayer();
        state.tool = 'text';
        pushHistory();
        invalidateExport();
        renderPanel('text', true);
        drawToScreen();
        schedulePreview(false);
        break;
      case 'add-shape':
        if (!state.crop) { toast('Open an image first.', true); break; }
        createShapeLayer(button.getAttribute('data-add-shape') || 'rectangle');
        state.tool = 'shapes';
        pushHistory();
        invalidateExport();
        renderPanel('shapes', true);
        drawToScreen();
        schedulePreview(false);
        break;
      case 'duplicate-layer':
        duplicateActiveLayer();
        break;
      case 'delete-layer':
        deleteActiveLayer();
        break;
      case 'new-draw-layer':
        addDrawingLayer();
        break;
      case 'clear-draw':
        clearActiveDrawing();
        break;
      case 'frame-image':
        if (els.bgInput) els.bgInput.click();
        break;
      case 'clear-frame-image':
        state.frame.image = null;
        if (state.frame.background === 'image') state.frame.background = 'transparent';
        pushHistory();
        invalidateExport();
        renderPanel('frame', true);
        schedulePreview(false);
        break;
      case 'add-image-layer':
        if (els.layerInput) els.layerInput.click();
        break;
      case 'paste':
        pasteFromClipboard();
        break;
      default:
        break;
    }
  }

  function clearActiveDrawing() {
    var layer = activeLayer();
    if (!layer || layer.kind !== 'draw' || !layer.canvas) {
      toast('Select a drawing layer first.', true);
      return;
    }
    layer.canvas.getContext('2d').clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    pushHistory();
    invalidateExport();
    renderPanel('draw', true);
    drawToScreen();
    schedulePreview(false);
  }

  /* ---------- Zoom and pan ---------- */
  function zoomAtPoint(newZoom, clientX, clientY) {
    if (!state.source) return;
    var rect = canvas.getBoundingClientRect();
    var before = screenToLogical(clientX, clientY);
    state.zoom = clamp(newZoom, 0.1, 16);
    var logical = getLogicalSize();
    var pad = canvasPadding() * 2;
    var fit = Math.min((rect.width - pad) / logical.width, (rect.height - pad) / logical.height);
    fit = Math.max(0.0001, fit);
    var scale = fit * state.zoom;
    var baseX = (rect.width - logical.width * scale) / 2;
    var baseY = (rect.height - logical.height * scale) / 2;
    var px = clientX - rect.left;
    var py = clientY - rect.top;
    state.panX = px - before.x * scale - baseX;
    state.panY = py - before.y * scale - baseY;
    drawToScreen();
    updateStatus();
  }

  function zoomBy(factor) {
    var rect = canvas.getBoundingClientRect();
    zoomAtPoint(state.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function fitView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    drawToScreen();
    updateStatus();
  }

  /* ---------- Crop geometry ---------- */
  function resizeCropRect(start, handle, point, aspect) {
    var left = start.x;
    var top = start.y;
    var right = start.x + start.w;
    var bottom = start.y + start.h;
    if (handle.indexOf('w') >= 0) left = point.x;
    if (handle.indexOf('e') >= 0) right = point.x;
    if (handle.indexOf('n') >= 0) top = point.y;
    if (handle.indexOf('s') >= 0) bottom = point.y;
    var rect = {
      x: Math.min(left, right),
      y: Math.min(top, bottom),
      w: Math.abs(right - left),
      h: Math.abs(bottom - top)
    };
    if (aspect > 0) {
      if (handle === 'n' || handle === 's') {
        rect.w = rect.h * aspect;
      } else if (handle === 'e' || handle === 'w') {
        rect.h = rect.w / aspect;
      } else if (rect.w / Math.max(1, rect.h) > aspect) {
        rect.h = rect.w / aspect;
      } else {
        rect.w = rect.h * aspect;
      }
      var anchorX = handle.indexOf('w') >= 0 ? start.x + start.w : handle.indexOf('e') >= 0 ? start.x : start.x + start.w / 2;
      var anchorY = handle.indexOf('n') >= 0 ? start.y + start.h : handle.indexOf('s') >= 0 ? start.y : start.y + start.h / 2;
      rect.x = handle.indexOf('w') >= 0 ? anchorX - rect.w : handle.indexOf('e') >= 0 ? anchorX : anchorX - rect.w / 2;
      rect.y = handle.indexOf('n') >= 0 ? anchorY - rect.h : handle.indexOf('s') >= 0 ? anchorY : anchorY - rect.h / 2;
    }
    return rect;
  }

  function fitCropRect(rect, aspect) {
    if (!state.base) return rect;
    var maxW = state.base.width;
    var maxH = state.base.height;
    rect.w = clamp(rect.w, 10, maxW);
    rect.h = clamp(rect.h, 10, maxH);
    if (aspect > 0) {
      if (rect.w / rect.h > aspect) rect.w = rect.h * aspect;
      else rect.h = rect.w / aspect;
      rect.w = Math.min(rect.w, maxW);
      rect.h = Math.min(rect.h, maxH);
      if (rect.w / rect.h > aspect) rect.w = rect.h * aspect;
      else rect.h = rect.w / aspect;
    }
    rect.x = clamp(rect.x, 0, maxW - rect.w);
    rect.y = clamp(rect.y, 0, maxH - rect.h);
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(10, Math.round(rect.w)),
      h: Math.max(10, Math.round(rect.h))
    };
  }

  /* ---------- Pointer interactions ---------- */
  var spaceHeld = false;
  var pinchState = null;
  var panelResize = null;

  function pointerLocal(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startPan(event) {
    interaction = {
      type: 'pan', startX: event.clientX, startY: event.clientY,
      panX: state.panX, panY: state.panY
    };
    canvas.classList.add('is-panning');
  }

  function startCrop(event) {
    var local = pointerLocal(event);
    var handle = cropHitTest(local.x, local.y);
    var point = screenToLogical(event.clientX, event.clientY);
    if (handle) {
      interaction = {
        type: 'crop', handle: handle, startCrop: Object.assign({}, state.crop),
        startPoint: point, changed: false
      };
      if (handle === 'move') canvas.classList.add('is-move');
    } else {
      interaction = {
        type: 'crop-new', anchor: point, startCrop: Object.assign({}, state.crop), changed: false
      };
    }
  }

  function startDraw(event) {
    var layer = ensureDrawLayer();
    if (!layer) return;
    var point = screenToBase(event.clientX, event.clientY);
    interaction = { type: 'draw', layer: layer, last: point, points: [point], changed: false };
    drawStrokeSegment(layer, point, point);
    interaction.changed = true;
    drawToScreen();
  }

  function startLayerInteraction(event) {
    var local = pointerLocal(event);
    var handle = hitLayerHandle(local.x, local.y);
    if (handle) {
      var current = activeLayer();
      if (!current || current.locked) return true;
      var startPoint = screenToBase(event.clientX, event.clientY);
      var startCenterX = current.x + current.w / 2;
      var startCenterY = current.y + current.h / 2;
      interaction = {
        type: 'layer-transform', handle: handle, layer: current,
        start: {
          x: current.x, y: current.y, w: current.w, h: current.h,
          rotation: Number(current.rotation) || 0,
          angle: Math.atan2(startPoint.y - startCenterY, startPoint.x - startCenterX) * 180 / Math.PI
        },
        startPoint: startPoint,
        changed: false
      };
      return true;
    }
    var hit = hitLayer(event.clientX, event.clientY);
    if (!hit) {
      if (state.activeLayerId) {
        state.activeLayerId = null;
        if (isLayerTool()) renderPanel(state.tool, true);
        drawToScreen();
      }
      return false;
    }
    state.activeLayerId = hit.id;
    if (isLayerTool()) {
      renderPanel(state.tool, true);
    }
    drawToScreen();
    if (hit.locked) return true;
    interaction = {
      type: 'layer-move', layer: hit,
      start: { x: hit.x, y: hit.y },
      startPoint: screenToBase(event.clientX, event.clientY),
      changed: false
    };
    return true;
  }

  function updateCropInteraction(event) {
    var point = screenToLogical(event.clientX, event.clientY);
    if (interaction.type === 'crop-new') {
      var anchor = interaction.anchor;
      var width = Math.abs(point.x - anchor.x);
      var height = Math.abs(point.y - anchor.y);
      if (width < 4 && height < 4) return;
      if (state.cropAspect > 0) {
        if (width / Math.max(1, height) > state.cropAspect) height = width / state.cropAspect;
        else width = height * state.cropAspect;
      }
      var x = point.x < anchor.x ? anchor.x - width : anchor.x;
      var y = point.y < anchor.y ? anchor.y - height : anchor.y;
      state.crop = fitCropRect({ x: x, y: y, w: width, h: height }, state.cropAspect);
    } else if (interaction.handle === 'move') {
      var dx = point.x - interaction.startPoint.x;
      var dy = point.y - interaction.startPoint.y;
      state.crop = clampCrop({
        x: interaction.startCrop.x + dx,
        y: interaction.startCrop.y + dy,
        w: interaction.startCrop.w,
        h: interaction.startCrop.h
      });
    } else {
      var rect = resizeCropRect(interaction.startCrop, interaction.handle, point, state.cropAspect);
      state.crop = fitCropRect(rect, state.cropAspect);
    }
    interaction.changed = true;
    syncCropInputs();
    drawToScreen();
    updateStatus();
  }

  function updateLayerInteraction(event) {
    var layer = interaction.layer;
    var point = screenToBase(event.clientX, event.clientY);
    if (interaction.type === 'layer-move') {
      layer.x = interaction.start.x + (point.x - interaction.startPoint.x);
      layer.y = interaction.start.y + (point.y - interaction.startPoint.y);
    } else if (interaction.handle === 'rotate') {
      var centerX = layer.x + layer.w / 2;
      var centerY = layer.y + layer.h / 2;
      var angle = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI;
      var rotation = interaction.start.rotation + (angle - interaction.start.angle);
      layer.rotation = Math.round(((rotation + 180) % 360 + 360) % 360 - 180);
    } else {
      var startCenterX = interaction.start.x + interaction.start.w / 2;
      var startCenterY = interaction.start.y + interaction.start.h / 2;
      var radians = interaction.start.rotation * Math.PI / 180;
      var dx = point.x - startCenterX;
      var dy = point.y - startCenterY;
      var localX = dx * Math.cos(-radians) - dy * Math.sin(-radians);
      var localY = dx * Math.sin(-radians) + dy * Math.cos(-radians);
      var halfW = Math.max(5, Math.abs(localX));
      var halfH = Math.max(5, Math.abs(localY));
      if (interaction.handle === 'n' || interaction.handle === 's') halfW = interaction.start.w / 2;
      if (interaction.handle === 'e' || interaction.handle === 'w') halfH = interaction.start.h / 2;
      layer.w = Math.round(halfW * 2);
      layer.h = Math.round(halfH * 2);
      layer.x = Math.round(startCenterX - layer.w / 2);
      layer.y = Math.round(startCenterY - layer.h / 2);
    }
    interaction.changed = true;
    schedulePreview(true);
    drawToScreen();
  }

  function drawStrokeSegment(layer, from, to) {
    if (!layer.canvas) return;
    var context = layer.canvas.getContext('2d');
    var scaleX = layer.canvas.width / layer.w;
    var scaleY = layer.canvas.height / layer.h;
    var fromX = (from.x - layer.x) * scaleX;
    var fromY = (from.y - layer.y) * scaleY;
    var toX = (to.x - layer.x) * scaleX;
    var toY = (to.y - layer.y) * scaleY;
    context.save();
    context.globalCompositeOperation = state.draw.eraser ? 'destination-out' : 'source-over';
    context.globalAlpha = clamp(state.draw.opacity / 100, 0.01, 1);
    context.strokeStyle = state.draw.color;
    context.fillStyle = state.draw.color;
    context.lineWidth = Math.max(1, state.draw.size * (scaleX + scaleY) / 2);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
    if (from.x === to.x && from.y === to.y) {
      context.beginPath();
      context.arc(fromX, fromY, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawLiveStroke() {
    if (!interaction || interaction.type !== 'draw' || state.draw.eraser) return;
    var points = interaction.points || [];
    if (!points.length) return;
    var scale = baseScale();
    screenCtx.save();
    screenCtx.globalAlpha = clamp(state.draw.opacity / 100, 0.01, 1);
    screenCtx.strokeStyle = state.draw.color;
    screenCtx.fillStyle = state.draw.color;
    screenCtx.lineWidth = Math.max(1, state.draw.size * scale);
    screenCtx.lineCap = 'round';
    screenCtx.lineJoin = 'round';
    screenCtx.beginPath();
    points.forEach(function (point, index) {
      var screen = baseToScreen(point.x, point.y);
      if (index === 0) screenCtx.moveTo(screen.x, screen.y);
      else screenCtx.lineTo(screen.x, screen.y);
    });
    if (points.length === 1) {
      var first = baseToScreen(points[0].x, points[0].y);
      screenCtx.arc(first.x, first.y, Math.max(1, state.draw.size * scale) / 2, 0, Math.PI * 2);
      screenCtx.fill();
    } else {
      screenCtx.stroke();
    }
    screenCtx.restore();
  }

  function onPointerDown(event) {
    if (!state.source) return;
    if (event.button === 2) event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      var pair = Array.from(pointers.values());
      var distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) || 1;
      pinchState = { distance: distance, zoom: state.zoom };
      interaction = null;
      return;
    }
    if (pointers.size > 2) return;
    if (event.button === 1 || event.button === 2 || spaceHeld || state.compare) {
      startPan(event);
      return;
    }
    if (state.tool === 'crop') {
      startCrop(event);
      return;
    }
    if (state.tool === 'draw') {
      startDraw(event);
      return;
    }
    if (isLayerTool()) {
      if (startLayerInteraction(event)) return;
    }
    startPan(event);
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchState && pointers.size >= 2) {
      var pair = Array.from(pointers.values());
      var distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) || 1;
      var middle = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
      zoomAtPoint(pinchState.zoom * (distance / pinchState.distance), middle.x, middle.y);
      return;
    }
    if (!interaction) return;
    if (interaction.type === 'pan') {
      state.panX = interaction.panX + (event.clientX - interaction.startX);
      state.panY = interaction.panY + (event.clientY - interaction.startY);
      drawToScreen();
      return;
    }
    if (interaction.type === 'crop' || interaction.type === 'crop-new') {
      updateCropInteraction(event);
      return;
    }
    if (interaction.type === 'draw') {
      var point = screenToBase(event.clientX, event.clientY);
      var last = interaction.last || point;
      if (Math.abs(point.x - last.x) < 0.4 && Math.abs(point.y - last.y) < 0.4) return;
      drawStrokeSegment(interaction.layer, last, point);
      interaction.last = point;
      interaction.points.push(point);
      interaction.changed = true;
      if (state.draw.eraser) schedulePreview(true);
      else drawToScreen();
      return;
    }
    if (interaction.type === 'layer-move' || interaction.type === 'layer-transform') {
      updateLayerInteraction(event);
    }
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    if (pinchState) {
      if (pointers.size < 2) pinchState = null;
      if (!interaction) return;
    }
    var finished = interaction;
    interaction = null;
    canvas.classList.remove('is-panning');
    canvas.classList.remove('is-move');
    if (!finished) return;
    if (finished.type === 'crop' || finished.type === 'crop-new') {
      if (finished.changed) {
        pushHistory();
        invalidateExport();
      }
      syncCropInputs();
      drawToScreen();
      updateStatus();
      schedulePreview(false);
      return;
    }
    if (finished.type === 'layer-move' || finished.type === 'layer-transform') {
      if (finished.changed) {
        pushHistory();
        invalidateExport();
      }
      syncLayerGeometryInputs();
      drawToScreen();
      schedulePreview(false);
      return;
    }
    if (finished.type === 'draw') {
      if (finished.changed) {
        pushHistory();
        invalidateExport();
      }
      drawToScreen();
      schedulePreview(false);
      return;
    }
    drawToScreen();
  }

  function cancelInteraction() {
    if (!interaction) return;
    interaction = null;
    pointers.clear();
    pinchState = null;
    canvas.classList.remove('is-panning');
    canvas.classList.remove('is-move');
    drawToScreen();
  }

  /* ---------- Input wiring ---------- */
  function bindInputs() {
    if (els.fileInput) {
      els.fileInput.addEventListener('change', function () {
        var file = els.fileInput.files && els.fileInput.files[0];
        if (file) loadFile(file);
        els.fileInput.value = '';
      });
    }
    if (els.bgInput) {
      els.bgInput.addEventListener('change', async function () {
        var file = els.bgInput.files && els.bgInput.files[0];
        els.bgInput.value = '';
        if (!file) return;
        showProgress('Opening background image…', 30);
        try {
          var canvasSource = await decodeFile(file);
          state.frame.image = canvasSource;
          state.frame.background = 'image';
          pushHistory();
          invalidateExport();
          renderPanel('frame', true);
          schedulePreview(false);
        } catch (error) {
          toast(error.message || 'The background image could not be opened.', true);
        } finally {
          hideProgress();
        }
      });
    }
    if (els.layerInput) {
      els.layerInput.addEventListener('change', async function () {
        var file = els.layerInput.files && els.layerInput.files[0];
        els.layerInput.value = '';
        if (!file) return;
        showProgress('Opening image layer…', 30);
        try {
          var canvasSource = await decodeFile(file);
          addImageLayer(canvasSource, file.name || 'Image');
          state.tool = 'layers';
          pushHistory();
          invalidateExport();
          renderPanel('layers', true);
          drawToScreen();
          schedulePreview(false);
        } catch (error) {
          toast(error.message || 'The image layer could not be opened.', true);
        } finally {
          hideProgress();
        }
      });
    }

    root.addEventListener('click', function (event) {
      var target = event.target;
      var toolButton = target.closest('[data-tool]');
      if (toolButton) {
        selectTool(toolButton.getAttribute('data-tool'));
        return;
      }
      var zoomButton = target.closest('[data-zoom]');
      if (zoomButton) {
        var mode = zoomButton.getAttribute('data-zoom');
        if (mode === 'in') zoomBy(1.25);
        else if (mode === 'out') zoomBy(0.8);
        else fitView();
        return;
      }
      var filterButton = target.closest('[data-filter]');
      if (filterButton) {
        setFilter(filterButton.getAttribute('data-filter'));
        return;
      }
      var aspectButton = target.closest('[data-aspect]');
      if (aspectButton) {
        setCropAspect(Number(aspectButton.getAttribute('data-aspect')) || 0);
        return;
      }
      var presetButton = target.closest('[data-resize-preset]');
      if (presetButton) {
        var parts = presetButton.getAttribute('data-resize-preset').split('x');
        state.resize.width = Number(parts[0]);
        state.resize.height = Number(parts[1]);
        state.resize.custom = true;
        syncResizeInputs();
        pushHistory();
        invalidateExport();
        updateStatus();
        schedulePreview(false);
        return;
      }
      var shapeButton = target.closest('[data-add-shape]');
      if (shapeButton) {
        handleAction('add-shape', shapeButton);
        return;
      }
      var selectLayerButton = target.closest('[data-select-layer]');
      if (selectLayerButton) {
        selectLayer(selectLayerButton.getAttribute('data-select-layer'));
        return;
      }
      var closeButton = target.closest('[data-panel-close]');
      if (closeButton) {
        if (isMobile()) closeSheet();
        else root.classList.add('panel-collapsed');
        return;
      }
      var railButton = target.closest('[data-toggle-rail]');
      if (railButton) {
        var collapsed = root.classList.toggle('rail-collapsed');
        railButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
        requestAnimationFrame(drawToScreen);
        return;
      }
      var actionButton = target.closest('[data-action]');
      if (actionButton) {
        var layerId = actionButton.getAttribute('data-layer-id');
        if (layerId) selectLayer(layerId);
        handleAction(actionButton.getAttribute('data-action'), actionButton);
      }
    });

    root.addEventListener('change', function (event) {
      var input = event.target.closest('[data-rename-layer]');
      if (!input) return;
      var layer = state.layers.filter(function (item) { return item.id === input.getAttribute('data-rename-layer'); })[0];
      if (!layer) return;
      layer.name = input.value.trim() || layerKindLabel(layer);
      input.value = layer.name;
      pushHistory();
      invalidateExport();
      if (state.tool === 'layers') renderPanel('layers', true);
    });

    if (els.sheetBackdrop) els.sheetBackdrop.addEventListener('click', closeSheet);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    canvas.addEventListener('dblclick', function (event) {
      if (!isLayerTool()) return;
      var hit = hitLayer(event.clientX, event.clientY);
      if (hit && hit.type === 'text') {
        state.activeLayerId = hit.id;
        selectTool('text');
      }
    });

    els.scroll.addEventListener('wheel', function (event) {
      if (!state.source) return;
      event.preventDefault();
      var factor = clamp(Math.exp(-event.deltaY * 0.0018), 0.5, 2);
      zoomAtPoint(state.zoom * factor, event.clientX, event.clientY);
    }, { passive: false });

    $$('[data-action="compare"]').forEach(function (button) {
      function enable() {
        if (!state.source) return;
        state.compare = true;
        button.setAttribute('aria-pressed', 'true');
        drawToScreen();
        updateStatus();
      }
      function disable() {
        if (!state.compare) return;
        state.compare = false;
        button.setAttribute('aria-pressed', 'false');
        drawToScreen();
        updateStatus();
        schedulePreview(false);
      }
      button.addEventListener('pointerdown', function (event) { event.preventDefault(); enable(); });
      button.addEventListener('pointerup', disable);
      button.addEventListener('pointerleave', disable);
      button.addEventListener('pointercancel', disable);
      button.addEventListener('blur', disable);
      button.addEventListener('keydown', function (event) {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); enable(); }
      });
      button.addEventListener('keyup', function (event) {
        if (event.key === ' ' || event.key === 'Enter') disable();
      });
    });

    if (els.resizer) {
      els.resizer.addEventListener('pointerdown', function (event) {
        if (isMobile()) return;
        event.preventDefault();
        panelResize = { startX: event.clientX, startWidth: els.panel.getBoundingClientRect().width };
        try { els.resizer.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      });
      els.resizer.addEventListener('pointermove', function (event) {
        if (!panelResize) return;
        var max = Math.min(620, root.getBoundingClientRect().width * 0.55);
        var width = clamp(panelResize.startWidth - (event.clientX - panelResize.startX), 270, max);
        root.style.setProperty('--editor-panel-width', width + 'px');
        drawToScreen();
      });
      els.resizer.addEventListener('pointerup', function (event) {
        if (!panelResize) return;
        panelResize = null;
        try { els.resizer.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        drawToScreen();
      });
      els.resizer.addEventListener('pointercancel', function () { panelResize = null; });
    }

    root.addEventListener('dragover', function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') === -1) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (els.dropOverlay) els.dropOverlay.hidden = false;
    });
    root.addEventListener('dragleave', function (event) {
      if (event.target !== root && root.contains(event.relatedTarget)) return;
      if (els.dropOverlay) els.dropOverlay.hidden = true;
    });
    root.addEventListener('drop', function (event) {
      if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
      event.preventDefault();
      if (els.dropOverlay) els.dropOverlay.hidden = true;
      loadFile(event.dataTransfer.files[0]);
    });
    window.addEventListener('dragover', function (event) {
      if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1) event.preventDefault();
    });
    window.addEventListener('drop', function (event) {
      if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1) event.preventDefault();
    });

    document.addEventListener('paste', function (event) {
      var items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) {
            event.preventDefault();
            loadFile(file);
            return;
          }
        }
      }
    });

    document.addEventListener('keydown', function (event) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
      var interactive = typing || /^(BUTTON|A|SUMMARY)$/.test(event.target.tagName);
      var mod = event.ctrlKey || event.metaKey;
      if (event.key === ' ' && !interactive && state.source) {
        spaceHeld = true;
        event.preventDefault();
        canvas.classList.add('is-panning');
        return;
      }
      if (event.key === 'Escape') {
        if (isMobile()) closeSheet();
        cancelInteraction();
        return;
      }
      if (typing) return;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        openExportPanel();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        zoomBy(1.25);
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        zoomBy(0.8);
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        fitView();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && activeLayer()) {
        event.preventDefault();
        deleteActiveLayer();
        return;
      }
      if (event.key.indexOf('Arrow') === 0 && activeLayer()) {
        event.preventDefault();
        var layer = activeLayer();
        var step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowLeft') layer.x -= step;
        else if (event.key === 'ArrowRight') layer.x += step;
        else if (event.key === 'ArrowUp') layer.y -= step;
        else if (event.key === 'ArrowDown') layer.y += step;
        pushHistory();
        invalidateExport();
        syncLayerGeometryInputs();
        drawToScreen();
        schedulePreview(false);
      }
    });

    document.addEventListener('keyup', function (event) {
      if (event.key === ' ') {
        spaceHeld = false;
        if (!interaction) canvas.classList.remove('is-panning');
      }
    });
  }

  /* ---------- Initialisation ---------- */
  function detectAvif() {
    return new Promise(function (resolve) {
      try {
        var test = createCanvas(4, 4);
        test.toBlob(function (blob) { resolve(!!blob && blob.type === 'image/avif'); }, 'image/avif', 0.7);
      } catch (error) {
        resolve(false);
      }
    });
  }

  function init() {
    if (els.resizer) els.resizer.hidden = isMobile();
    updateHistoryButtons();
    updateStatus();
    drawToScreen();
    renderPanel('import', true);
    bindInputs();
    detectAvif().then(function (supported) {
      supports['image/avif'] = supported;
      if (state.tool === 'export') renderPanel('export', true);
    });
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () {
        requestAnimationFrame(function () { drawToScreen(); });
      });
      observer.observe(els.scroll);
    }
    window.addEventListener('resize', function () {
      if (els.resizer) els.resizer.hidden = isMobile();
      if (!isMobile()) closeSheet();
      requestAnimationFrame(function () { drawToScreen(); });
    });
  }

  init();
})();
