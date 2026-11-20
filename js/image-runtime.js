/* LetitEdit Image & Photo runtime. Binds the pure engines in image-core.js
 * to generated workspaces. Files stay in browser memory; all object URLs are
 * released when replaced, reset or when the page is hidden. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function $(id) { return document.getElementById(id); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function on(target, event, handler) { if (target) target.addEventListener(event, handler); }

  function status(message, isError) {
    const node = $('image-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError));
  }

  function meta(message) {
    const node = $('image-meta');
    if (node) node.textContent = message || '';
  }

  function setEnabled(id, enabled) {
    const node = $(id);
    if (node) node.disabled = !enabled;
  }

  function clearCanvas(canvas) {
    if (!canvas) return;
    canvas.width = canvas.width || 800;
    canvas.height = canvas.height || 480;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const managedUrls = [];

  function manageUrl(blob) {
    const url = URL.createObjectURL(blob);
    managedUrls.push(url);
    return url;
  }

  function releaseUrl(url) {
    const index = managedUrls.indexOf(url);
    if (index !== -1) managedUrls.splice(index, 1);
    if (url) URL.revokeObjectURL(url);
  }

  function releaseAll() {
    while (managedUrls.length) {
      const url = managedUrls.pop();
      URL.revokeObjectURL(url);
    }
  }

  on(window, 'pagehide', releaseAll);

  function downloadBlob(blob, filename) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function safeName(name, fallback) {
    const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
    return base || fallback || 'image';
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('This browser could not encode that format.'));
        }, mime, quality);
      } catch (error) { reject(error); }
    });
  }

  function readFile(file, mode) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('The file could not be read.')); };
      if (mode === 'dataURL') reader.readAsDataURL(file);
      else reader.readAsArrayBuffer(file);
    });
  }

  function decodeImageFile(file) {
    return new Promise(function (resolve, reject) {
      const limit = ImageCore.withinLimits(file.size, 1, 1);
      if (limit) { reject(new Error(limit)); return; }
      const url = manageUrl(file);
      const image = new Image();
      image.onload = function () {
        const message = ImageCore.withinLimits(file.size, image.naturalWidth, image.naturalHeight);
        if (message) { releaseUrl(url); reject(new Error(message)); return; }
        resolve({ image: image, url: url, file: file });
      };
      image.onerror = function () {
        releaseUrl(url);
        reject(new Error('That file could not be decoded as an image. Check that it is a valid PNG, JPG or WebP.'));
      };
      image.src = url;
    });
  }

  function imageDataFromImage(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function setCanvasImageData(canvas, imageData) {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    const target = ctx.createImageData(imageData.width, imageData.height);
    target.data.set(imageData.data);
    ctx.putImageData(target, 0, 0);
  }

  function imageFromCanvas(canvas) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The edited image could not be prepared.')); };
      image.src = canvas.toDataURL('image/png');
    });
  }

  function canvasFromImageData(imageData) {
    const canvas = document.createElement('canvas');
    setCanvasImageData(canvas, imageData);
    return canvas;
  }

  function copyText(text, successMessage) {
    if (!text) { status('There is nothing to copy yet.', true); return; }
    function fallback() {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); status(successMessage || 'Copied.'); }
      catch (error) { status('Copying is blocked by this browser. Select the text and copy it manually.', true); }
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { status(successMessage || 'Copied.'); }).catch(fallback);
    } else fallback();
  }

  function val(id, fallback) {
    const node = $(id);
    if (!node) return fallback;
    return node.value;
  }

  function isChecked(id) {
    const node = $(id);
    return Boolean(node && node.checked);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function createHistory(limit) {
    const size = limit || 12;
    return {
      entries: [],
      index: -1,
      push(snapshot) {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(snapshot);
        if (this.entries.length > size) this.entries.shift();
        this.index = this.entries.length - 1;
      },
      undo() { return this.index > 0 ? this.entries[--this.index] : null; },
      redo() { return this.index < this.entries.length - 1 ? this.entries[++this.index] : null; },
      get canUndo() { return this.index > 0; },
      get canRedo() { return this.index < this.entries.length - 1; }
    };
  }

  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (paragraph) {
      if (!paragraph.trim()) { lines.push(''); return; }
      let line = '';
      paragraph.trim().split(/\s+/).forEach(function (word) {
        const candidate = line ? line + ' ' + word : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });
      if (line) lines.push(line);
    });
    return lines;
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
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

  function drawTextLayer(ctx, layer, width, height) {
    if (!layer || !layer.text || !String(layer.text).trim()) return;
    const size = Math.max(8, Number(layer.size) || 24);
    const x = (Number(layer.x) || 0) / 100 * width;
    const y = (Number(layer.y) || 0) / 100 * height;
    const rotation = (Number(layer.rotation) || 0) * Math.PI / 180;
    ctx.save();
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.font = (layer.weight || '700') + ' ' + size + 'px ' + (layer.font || 'system-ui, sans-serif');
    ctx.textAlign = layer.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const maxWidth = Math.max(24, width * ((Number(layer.maxWidth) || 86) / 100));
    const lines = wrapLines(ctx, layer.text, maxWidth);
    const lineHeight = size * 1.2;
    const blockHeight = lines.length * lineHeight;
    const firstY = -blockHeight / 2 + lineHeight / 2;
    const alignX = ctx.textAlign === 'left' ? -maxWidth / 2 : ctx.textAlign === 'right' ? maxWidth / 2 : 0;
    if (layer.backing) {
      const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
      const boxW = Math.min(width - 8, widest + size * 0.8);
      const boxH = blockHeight + size * 0.5;
      ctx.fillStyle = 'rgba(15,23,42,.58)';
      roundedRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, size * 0.35);
      ctx.fill();
    }
    if (layer.shadow) {
      ctx.shadowColor = 'rgba(15,23,42,.55)';
      ctx.shadowBlur = size * 0.25;
      ctx.shadowOffsetY = size * 0.08;
    }
    const outline = Number(layer.outlineWidth) || 0;
    if (outline > 0) {
      ctx.lineWidth = Math.max(0.5, size * outline / 100);
      ctx.strokeStyle = layer.outline || '#0f172a';
    }
    ctx.fillStyle = layer.color || '#ffffff';
    lines.forEach(function (line, index) {
      const lineY = firstY + index * lineHeight;
      if (outline > 0) ctx.strokeText(line, alignX, lineY, maxWidth);
      ctx.fillText(line, alignX, lineY, maxWidth);
    });
    ctx.restore();
  }

  function drawShape(ctx, shape, x, y, size, color) {
    if (!shape || shape === 'none') return;
    ctx.save();
    ctx.fillStyle = color || '#2563eb';
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    } else if (shape === 'triangle') {
      ctx.moveTo(x, y - size / 2);
      ctx.lineTo(x + size / 2, y + size / 2);
      ctx.lineTo(x - size / 2, y + size / 2);
      ctx.closePath();
    } else if (shape === 'star' || shape === '★' || shape === '❤' || shape === '✓' || shape === '→' || shape === '🎉' || shape === '🔥') {
      ctx.font = size + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(shape, x, y);
      ctx.restore();
      return;
    } else if (shape === 'heart') {
      ctx.moveTo(x, y + size * 0.35);
      ctx.bezierCurveTo(x - size * 0.75, y - size * 0.15, x - size * 0.35, y - size * 0.7, x, y - size * 0.25);
      ctx.bezierCurveTo(x + size * 0.35, y - size * 0.7, x + size * 0.75, y - size * 0.15, x, y + size * 0.35);
      ctx.closePath();
    } else if (shape === 'arrow') {
      ctx.moveTo(x - size / 2, y);
      ctx.lineTo(x + size / 5, y);
      ctx.lineTo(x + size / 5, y - size / 3);
      ctx.lineTo(x + size / 2, y);
      ctx.lineTo(x + size / 5, y + size / 3);
      ctx.lineTo(x + size / 5, y);
      ctx.closePath();
    } else {
      ctx.rect(x - size / 2, y - size / 2, size, size);
    }
    ctx.fill();
    ctx.restore();
  }

  function imageToDataUrl(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  function loadImageFromDataUrl(src) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The saved edit could not be restored.')); };
      image.src = src;
    });
  }

  function applyExifOrientation(imageData, orientation) {
    let result = imageData;
    if (orientation === 2) result = ImageCore.flip(result, 'horizontal');
    if (orientation === 3) result = ImageCore.rotate90(ImageCore.rotate90(result, 'right'), 'right');
    if (orientation === 4) result = ImageCore.flip(result, 'vertical');
    if (orientation === 5) result = ImageCore.flip(ImageCore.rotate90(result, 'right'), 'horizontal');
    if (orientation === 6) result = ImageCore.rotate90(result, 'right');
    if (orientation === 7) result = ImageCore.flip(ImageCore.rotate90(result, 'left'), 'horizontal');
    if (orientation === 8) result = ImageCore.rotate90(result, 'left');
    return result;
  }

  function bindRangeLabels() {
    all('input[type="range"]').forEach(function (input) {
      const output = $(input.id + '-value');
      if (!output) return;
      const suffix = output.textContent.replace(input.value, '');
      function update() { output.textContent = input.value + suffix; }
      on(input, 'input', update);
      update();
    });
  }

  function bindQualityToggles() {
    [['bw-format', 'bw-quality'], ['fr-format', 'fr-quality'], ['rs-format', 'rs-quality'],
     ['inv-format', 'inv-quality'], ['cmp-format', 'cmp-quality'], ['ie-format', 'ie-quality']]
      .forEach(function (pair) {
        const format = $(pair[0]);
        const quality = $(pair[1]);
        if (!format || !quality) return;
        function update() { quality.disabled = format.value === 'png'; }
        on(format, 'change', update);
        update();
      });
  }

  function bindUpload(onFiles, reset) {
    const input = $('image-file');
    const drop = document.querySelector('.image-drop');
    on(input, 'change', function () { onFiles(Array.prototype.slice.call(input.files || [])); });
    on($('image-change'), 'click', function () { if (input) input.click(); });
    on($('image-reset'), 'click', reset);
    if (drop) {
      on(drop, 'dragover', function (event) { event.preventDefault(); drop.classList.add('is-dragover'); });
      on(drop, 'dragleave', function () { drop.classList.remove('is-dragover'); });
      on(drop, 'drop', function (event) {
        event.preventDefault();
        drop.classList.remove('is-dragover');
        onFiles(Array.prototype.slice.call(event.dataTransfer.files || []));
      });
    }
  }

  function requireFile(files) {
    if (!files.length) { status('Choose a file first.', true); return null; }
    return files[0];
  }

  function simpleTool(options) {
    const state = { image: null, url: null, file: null, source: null, result: null };

    function render() {
      if (!state.image || !state.source) return;
      state.result = options.process(state);
      setCanvasImageData($('image-preview'), state.result);
      setEnabled('image-download', true);
      if (options.afterRender) options.afterRender(state);
    }

    function reset() {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = state.source = state.result = null;
      const input = $('image-file');
      if (input) input.value = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No image loaded');
      status('Reset. Choose an image to start again.');
      if (options.onReset) options.onReset(state);
    }

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = loaded.file;
        state.source = imageDataFromImage(state.image);
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight + ' · ' + ImageCore.formatBytes(file.size));
        status('Image loaded.');
        if (options.onLoad) options.onLoad(state);
        render();
      } catch (error) { status(error.message, true); }
    }, reset);

    on($('image-download'), 'click', async function () {
      if (!state.result) { status('Load an image first.', true); return; }
      try {
        const format = options.format(state);
        const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
        const quality = options.quality ? options.quality(state) : 0.92;
        const blob = await canvasToBlob(canvasFromImageData(state.result), mime, quality);
        downloadBlob(blob, safeName(state.file && state.file.name, 'image') + '.' + (format === 'jpeg' ? 'jpg' : format));
        status('Downloaded ' + format.toUpperCase() + '.');
      } catch (error) { status(error.message, true); }
    });

    if (options.bind) options.bind(render, state, reset);
    return state;
  }

  /* ---------- 01 · Image editor ---------- */
  function imageEditor() {
    const state = {
      image: null, url: null, file: null,
      extraLayers: [], history: createHistory(12)
    };

    function readLayer() {
      const percent = ImageCore.clampInt(val('ie-text-size', 5), 1, 30, 5);
      const width = state.image ? state.image.naturalWidth : 800;
      return {
        id: 'primary',
        text: val('ie-text', ''),
        font: val('ie-text-font', 'system-ui, sans-serif'),
        weight: '700',
        size: Math.max(12, Math.round(width * percent / 100)),
        color: val('ie-text-color', '#ffffff'),
        outline: val('ie-text-outline', '#0f172a'),
        outlineWidth: Number(val('ie-text-outline-w', 6)),
        x: Number(val('ie-text-x', 50)),
        y: Number(val('ie-text-y', 85)),
        rotation: Number(val('ie-text-rotation', 0)),
        backing: isChecked('ie-text-bg')
      };
    }

    function loadLayer(layer) {
      if (!layer) return;
      $('ie-text').value = layer.text || '';
      $('ie-text-font').value = layer.font || 'system-ui, sans-serif';
      if (state.image) {
        $('ie-text-size').value = String(Math.max(1, Math.min(30, Math.round((layer.size || 24) / state.image.naturalWidth * 100))));
      }
      $('ie-text-color').value = layer.color || '#ffffff';
      $('ie-text-outline').value = layer.outline || '#0f172a';
      $('ie-text-outline-w').value = String(layer.outlineWidth == null ? 6 : layer.outlineWidth);
      $('ie-text-x').value = String(layer.x == null ? 50 : layer.x);
      $('ie-text-y').value = String(layer.y == null ? 85 : layer.y);
      $('ie-text-rotation').value = String(layer.rotation || 0);
      $('ie-text-bg').checked = Boolean(layer.backing);
      bindRangeLabels();
      renderLayers();
    }

    function allLayers() { return [readLayer()].concat(state.extraLayers); }

    function renderLayers() {
      const list = $('ie-layers');
      if (!list) return;
      list.textContent = '';
      const layers = [{ id: 'primary', name: 'Main caption (always live)' }].concat(state.extraLayers.map((layer, index) => ({
        id: layer.id, name: (layer.text || layer.name || 'Layer ' + (index + 1)).slice(0, 28)
      })));
      layers.forEach(function (layer, index) {
        const row = document.createElement('div');
        row.className = 'pm-order-row';
        const label = document.createElement('span');
        label.textContent = (index + 1) + '. ' + layer.name;
        row.appendChild(label);
        const actions = document.createElement('div');
        actions.className = 'output-actions';
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'btn btn-secondary btn-small';
        select.textContent = 'Load';
        select.setAttribute('aria-label', 'Load ' + layer.name);
        on(select, 'click', function () {
          if (layer.id === 'primary') { status('The main caption is always edited in the text box.'); return; }
          const found = state.extraLayers.find(item => item.id === layer.id);
          if (found) { loadLayer(found); status('Layer loaded into the text editor.'); }
        });
        actions.appendChild(select);
        if (layer.id !== 'primary') {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'btn btn-secondary btn-small';
          remove.textContent = '✕';
          remove.setAttribute('aria-label', 'Delete ' + layer.name);
          on(remove, 'click', function () {
            state.history.push(snapshot());
            state.extraLayers = state.extraLayers.filter(item => item.id !== layer.id);
            renderLayers(); draw(true); updateHistoryButtons();
            status('Text layer deleted.');
          });
          actions.appendChild(remove);
        }
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    function adjustmentOptions() {
      return {
        brightness: Number(val('ie-brightness', 100)) - 100,
        contrast: Number(val('ie-contrast', 100)) - 100,
        saturation: Number(val('ie-saturation', 100)) - 100,
        exposure: Number(val('ie-exposure', 0)),
        temperature: Number(val('ie-temperature', 0)),
        highlights: Number(val('ie-highlights', 0)),
        shadows: Number(val('ie-shadows', 0)),
        grayscale: Number(val('ie-grayscale', 0)),
        sepia: Number(val('ie-sepia', 0)),
        vignette: Number(val('ie-vignette', 0))
      };
    }

    function draw(includeCropOutline) {
      if (!state.image) return;
      const canvas = $('image-preview');
      const w = state.image.naturalWidth;
      const h = state.image.naturalHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      if (isChecked('ie-bg-enable')) {
        ctx.fillStyle = val('ie-bg-color', '#ffffff');
        ctx.fillRect(0, 0, w, h);
      }
      let data = ImageCore.adjustImageData(imageDataFromImage(state.image), adjustmentOptions());
      const sharpness = ImageCore.clampInt(val('ie-sharpness', 100), 0, 200, 100);
      if (sharpness !== 100) data = ImageCore.sharpen(data, sharpness - 100);
      const blur = ImageCore.clampInt(val('ie-blur', 0), 0, 20, 0);
      ctx.save();
      if (blur) ctx.filter = 'blur(' + blur + 'px)';
      ctx.drawImage(canvasFromImageData(data), 0, 0);
      ctx.restore();

      const border = ImageCore.clampInt(val('ie-border-width', 0), 0, 100, 0);
      if (border) {
        const frame = val('ie-frame', 'none');
        ctx.save();
        ctx.strokeStyle = val('ie-border-color', '#ffffff');
        ctx.lineWidth = border;
        if (frame === 'rounded' || frame === 'polaroid' || frame === 'shadow') {
          roundedRectPath(ctx, border / 2, border / 2, w - border, h - border, Math.min(w, h) * 0.04);
        } else {
          ctx.strokeRect(border / 2, border / 2, w - border, h - border);
        }
        ctx.stroke();
        ctx.restore();
      }
      const shape = val('ie-shape', 'none');
      if (shape !== 'none') {
        const size = w * ImageCore.clampInt(val('ie-shape-size', 12), 1, 60, 12) / 100;
        drawShape(ctx, shape, Number(val('ie-shape-x', 85)) / 100 * w, Number(val('ie-shape-y', 15)) / 100 * h,
          size, val('ie-shape-color', '#2563eb'));
      }
      const watermark = val('ie-watermark-text', '');
      if (watermark.trim()) {
        const pos = val('ie-watermark-pos', 'bottom-right');
        const size = Math.max(10, w * ImageCore.clampInt(val('ie-watermark-size', 4), 1, 15, 4) / 100);
        ctx.save();
        ctx.globalAlpha = Number(val('ie-watermark-opacity', 45)) / 100;
        ctx.font = '700 ' + size + 'px system-ui, sans-serif';
        ctx.fillStyle = val('ie-watermark-color', '#ffffff');
        ctx.textBaseline = 'middle';
        ctx.textAlign = pos.indexOf('left') !== -1 ? 'left' : pos === 'center' ? 'center' : 'right';
        const x = pos.indexOf('left') !== -1 ? size : pos === 'center' ? w / 2 : w - size;
        const y = pos.indexOf('top') !== -1 ? size : pos === 'center' ? h / 2 : h - size;
        ctx.fillText(watermark, x, y, w * 0.8);
        ctx.restore();
      }
      allLayers().forEach(function (layer) { drawTextLayer(ctx, layer, w, h); });
      if (includeCropOutline) {
        const crop = currentCrop();
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = Math.max(1, w / 400);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(crop.x + 0.5, crop.y + 0.5, crop.w - 1, crop.h - 1);
        ctx.restore();
      }
      setEnabled('image-download', true);
    }

    function currentCrop() {
      const raw = ImageCore.cropRect(state.image.naturalWidth, state.image.naturalHeight, {
        x: val('ie-crop-x', 0), y: val('ie-crop-y', 0),
        w: val('ie-crop-w', state.image.naturalWidth), h: val('ie-crop-h', state.image.naturalHeight)
      });
      return ImageCore.cropAspectRect(state.image.naturalWidth, state.image.naturalHeight, raw, val('ie-aspect', 'free'));
    }

    function setCropToFull() {
      if (!state.image) return;
      const w = state.image.naturalWidth;
      const h = state.image.naturalHeight;
      [['ie-crop-x', 0, w - 1, 0], ['ie-crop-y', 0, h - 1, 0],
        ['ie-crop-w', 1, w, w], ['ie-crop-h', 1, h, h],
        ['ie-out-w', 1, 8000, w], ['ie-out-h', 1, 8000, h],
        ['ie-canvas-w', 1, 8000, w], ['ie-canvas-h', 1, 8000, h]].forEach(function (item) {
        const input = $(item[0]);
        if (!input) return;
        input.min = String(item[1]);
        input.max = String(item[2]);
        input.value = String(item[3]);
      });
      bindRangeLabels();
    }

    function resetAdjustments() {
      [['ie-brightness', 100], ['ie-contrast', 100], ['ie-saturation', 100], ['ie-exposure', 0],
        ['ie-temperature', 0], ['ie-highlights', 0], ['ie-shadows', 0], ['ie-sharpness', 100],
        ['ie-blur', 0], ['ie-vignette', 0], ['ie-grayscale', 0], ['ie-sepia', 0],
        ['ie-rotate-angle', 0]].forEach(function (item) { if ($(item[0])) $(item[0]).value = String(item[1]); });
      bindRangeLabels();
    }

    function snapshot() {
      return { src: imageToDataUrl(state.image), extras: clone(state.extraLayers) };
    }

    function updateHistoryButtons() {
      setEnabled('ie-undo', state.history.canUndo);
      setEnabled('ie-redo', state.history.canRedo);
    }

    async function restore(snapshotData) {
      if (!snapshotData) return;
      try {
        const image = await loadImageFromDataUrl(snapshotData.src);
        if (state.url) releaseUrl(state.url);
        state.image = image;
        state.url = null;
        state.extraLayers = clone(snapshotData.extras || []);
        resetAdjustments();
        setCropToFull();
        renderLayers();
        updateHistoryButtons();
        draw(true);
        status('History restored.');
      } catch (error) { status(error.message, true); }
    }

    function cropToCanvas(data, crop) {
      const cropped = document.createElement('canvas');
      cropped.width = crop.w;
      cropped.height = crop.h;
      cropped.getContext('2d').drawImage(canvasFromImageData(data), crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
      return cropped.getContext('2d').getImageData(0, 0, crop.w, crop.h);
    }

    async function bakeBase(kind) {
      if (!state.image) { status('Load an image first.', true); return; }
      try {
        state.history.push(snapshot());
        let data = imageDataFromImage(state.image);
        const w = data.width;
        const h = data.height;
        if (kind === 'left' || kind === 'right') data = ImageCore.rotate90(data, kind);
        if (kind === 'horizontal' || kind === 'vertical') data = ImageCore.flip(data, kind);
        if (kind === 'crop') data = cropToCanvas(data, currentCrop());
        if (kind === 'rotate') {
          const angle = Number(val('ie-rotate-angle', 0));
          if (!angle) { status('Choose an angle first.', true); state.history.undo(); return; }
          const background = isChecked('ie-rotate-expand') ? val('ie-rotate-bg', '#ffffff') : '#ffffff';
          const rotated = ImageCore.rotateArbitrary(data, angle, background);
          if (!isChecked('ie-rotate-expand')) {
            const holder = document.createElement('canvas');
            holder.width = w; holder.height = h;
            holder.getContext('2d').fillStyle = background;
            holder.getContext('2d').fillRect(0, 0, w, h);
            holder.getContext('2d').drawImage(canvasFromImageData(rotated), (w - rotated.width) / 2, (h - rotated.height) / 2);
            data = holder.getContext('2d').getImageData(0, 0, w, h);
          } else data = rotated;
          $('ie-rotate-angle').value = '0';
        }
        if (kind === 'resize') {
          const mode = val('ie-resize-fit', 'fit');
          let dims = ImageCore.fitDimensions(w, h, val('ie-out-w', w), val('ie-out-h', h), isChecked('ie-resize-lock'), mode);
          if (mode === 'fill') {
            const target = ImageCore.fitDimensions(w, h, val('ie-out-w', w), val('ie-out-h', h), false, 'stretch');
            const ratio = target.width / target.height;
            let cropW = w;
            let cropH = Math.round(w / ratio);
            if (cropH > h) { cropH = h; cropW = Math.round(h * ratio); }
            data = cropToCanvas(data, { x: Math.floor((w - cropW) / 2), y: Math.floor((h - cropH) / 2), w: cropW, h: cropH });
            dims = target;
          }
          data = ImageCore.resize(data, dims.width, dims.height);
        }
        if (kind === 'canvas') {
          const cw = ImageCore.clampInt(val('ie-canvas-w', w), 1, 8000, w);
          const ch = ImageCore.clampInt(val('ie-canvas-h', h), 1, 8000, h);
          const limit = ImageCore.withinLimits(0, cw, ch);
          if (limit) { status(limit, true); state.history.undo(); return; }
          const holder = document.createElement('canvas');
          holder.width = cw; holder.height = ch;
          const ctx = holder.getContext('2d');
          ctx.fillStyle = val('ie-canvas-color', '#ffffff');
          ctx.fillRect(0, 0, cw, ch);
          const mode = val('ie-canvas-pos', 'center');
          let x = (cw - w) / 2;
          let y = (ch - h) / 2;
          if (mode === 'top-left' || mode === 'top-right') y = 0;
          if (mode === 'bottom-left' || mode === 'bottom-right') y = ch - h;
          if (mode === 'top-left' || mode === 'bottom-left') x = 0;
          if (mode === 'top-right' || mode === 'bottom-right') x = cw - w;
          ctx.drawImage(canvasFromImageData(data), x, y);
          data = ctx.getImageData(0, 0, cw, ch);
        }
        if (kind === 'bgremove') {
          data = ImageCore.removeBackground(data, Number(val('ie-bgremove-tol', 45)), 40);
          $('ie-bgremove-enable').checked = false;
        }
        const next = await imageFromCanvas(canvasFromImageData(data));
        if (state.url) releaseUrl(state.url);
        state.image = next;
        state.url = null;
        resetAdjustments();
        setCropToFull();
        meta(next.naturalWidth + '×' + next.naturalHeight);
        bindRangeLabels();
        draw(true);
        state.history.push(snapshot());
        updateHistoryButtons();
        status('Edit applied.');
      } catch (error) {
        status(error.message, true);
        if (state.history.canUndo) restore(state.history.undo());
      }
    }

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        state.extraLayers = [];
        state.history.entries = [];
        state.history.index = -1;
        state.history.push(snapshot());
        resetAdjustments();
        setCropToFull();
        renderLayers();
        updateHistoryButtons();
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        status('Image loaded. Adjust the controls and preview on the right.');
        draw(true);
      } catch (error) { status(error.message, true); }
    }, function () {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = null;
      state.extraLayers = [];
      state.history.entries = [];
      state.history.index = -1;
      resetAdjustments();
      [['ie-crop-x', 0], ['ie-crop-y', 0], ['ie-crop-w', 100], ['ie-crop-h', 100],
        ['ie-text', ''], ['ie-text-size', 5], ['ie-text-x', 50], ['ie-text-y', 85],
        ['ie-text-outline-w', 6], ['ie-text-rotation', 0], ['ie-watermark-text', ''],
        ['ie-border-width', 0], ['ie-bgremove-tol', 45]].forEach(function (item) {
        if ($(item[0])) $(item[0]).value = String(item[1]);
      });
      ['ie-text-bg', 'ie-resize-lock', 'ie-rotate-expand', 'ie-transparent'].forEach(function (id) {
        if ($(id)) $(id).checked = id !== 'ie-bgremove-enable';
      });
      if ($('ie-bgremove-enable')) $('ie-bgremove-enable').checked = false;
      if ($('ie-bg-enable')) $('ie-bg-enable').checked = false;
      renderLayers();
      updateHistoryButtons();
      bindRangeLabels();
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No image loaded');
      status('Editor reset.');
    });

    ['ie-brightness', 'ie-contrast', 'ie-saturation', 'ie-blur', 'ie-grayscale', 'ie-sepia',
      'ie-exposure', 'ie-temperature', 'ie-highlights', 'ie-shadows', 'ie-sharpness', 'ie-vignette',
      'ie-text', 'ie-text-size', 'ie-text-color', 'ie-text-font', 'ie-text-outline', 'ie-text-outline-w',
      'ie-text-bg', 'ie-text-x', 'ie-text-y', 'ie-text-rotation',
      'ie-crop-x', 'ie-crop-y', 'ie-crop-w', 'ie-crop-h', 'ie-aspect',
      'ie-shape', 'ie-shape-color', 'ie-shape-size', 'ie-shape-x', 'ie-shape-y',
      'ie-border-width', 'ie-border-color', 'ie-frame', 'ie-bg-enable', 'ie-bg-color',
      'ie-watermark-text', 'ie-watermark-pos', 'ie-watermark-size', 'ie-watermark-opacity', 'ie-watermark-color',
      'ie-bgremove-enable', 'ie-bgremove-tol', 'ie-rotate-angle'
    ].forEach(function (id) {
      if (!$(id)) return;
      on($(id), 'input', function () { draw(true); });
      on($(id), 'change', function () { draw(true); });
    });

    on($('ie-crop-apply'), 'click', function () { bakeBase('crop'); });
    on($('ie-crop-full'), 'click', function () { setCropToFull(); draw(true); status('Crop reset to the full image.'); });
    on($('ie-rot-left'), 'click', function () { bakeBase('left'); });
    on($('ie-rot-right'), 'click', function () { bakeBase('right'); });
    on($('ie-flip-h'), 'click', function () { bakeBase('horizontal'); });
    on($('ie-flip-v'), 'click', function () { bakeBase('vertical'); });
    on($('ie-rotate-apply'), 'click', function () { bakeBase('rotate'); });
    on($('ie-rotate-reset'), 'click', function () { $('ie-rotate-angle').value = '0'; bindRangeLabels(); draw(true); });
    on($('ie-resize-apply'), 'click', function () { bakeBase('resize'); });
    on($('ie-resize-reset'), 'click', function () { setCropToFull(); draw(true); status('Output size reset.'); });
    on($('ie-canvas-apply'), 'click', function () { bakeBase('canvas'); });
    on($('ie-bgremove-apply'), 'click', function () { bakeBase('bgremove'); });
    on($('ie-adjust-reset'), 'click', function () { resetAdjustments(); draw(true); status('Adjustments reset.'); });

    all('#ie-filters [data-value]').forEach(function (chip) {
      on(chip, 'click', function () {
        const presets = {
          none: { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, temperature: 0, vignette: 0 },
          vivid: { brightness: 102, contrast: 118, saturation: 145, grayscale: 0, sepia: 0, temperature: 0, vignette: 0 },
          mono: { brightness: 100, contrast: 125, saturation: 100, grayscale: 100, sepia: 0, temperature: 0, vignette: 0 },
          warm: { brightness: 103, contrast: 108, saturation: 112, grayscale: 0, sepia: 22, temperature: 40, vignette: 0 },
          cool: { brightness: 100, contrast: 110, saturation: 105, grayscale: 0, sepia: 0, temperature: -40, vignette: 0 },
          faded: { brightness: 108, contrast: 78, saturation: 65, grayscale: 0, sepia: 12, temperature: 0, vignette: 20 },
          noir: { brightness: 98, contrast: 155, saturation: 100, grayscale: 100, sepia: 0, temperature: 0, vignette: 35 }
        };
        const preset = presets[chip.dataset.value] || presets.none;
        Object.keys(preset).forEach(function (id) {
          const node = $('ie-' + id);
          if (node) node.value = String(preset[id]);
        });
        all('#ie-filters .chip').forEach(function (other) { other.classList.toggle('is-active', other === chip); });
        bindRangeLabels();
        draw(true);
        status('Filter preset applied: ' + chip.textContent + '.');
      });
    });

    on($('ie-text-add'), 'click', function () {
      if (!state.image) { status('Load an image first.', true); return; }
      state.history.push(snapshot());
      const layer = readLayer();
      layer.id = 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      state.extraLayers.push(layer);
      renderLayers(); updateHistoryButtons(); draw(true);
      status('Text layer added.');
    });
    on($('ie-text-update'), 'click', function () {
      if (!state.extraLayers.length) { status('Add a layer first. The main caption is always live.', true); return; }
      state.history.push(snapshot());
      const selected = $('ie-layers').querySelector('.is-active');
      const target = selected ? state.extraLayers.find(layer => layer.id === selected.dataset.layerId) : state.extraLayers[state.extraLayers.length - 1];
      if (target) Object.assign(target, readLayer(), { id: target.id });
      renderLayers(); updateHistoryButtons(); draw(true);
      status('Text layer updated.');
    });
    on($('ie-undo'), 'click', function () {
      const previous = state.history.undo();
      if (previous) restore(previous); else status('Nothing to undo.', true);
    });
    on($('ie-redo'), 'click', function () {
      const next = state.history.redo();
      if (next) restore(next); else status('Nothing to redo.', true);
    });

    on($('image-download'), 'click', async function () {
      if (!state.image || !$('image-preview').width) { status('Load an image first.', true); return; }
      draw(false);
      const format = val('ie-format', 'png');
      const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
      try {
        let source = $('image-preview');
        const exportW = ImageCore.clampInt(val('ie-export-w', 0), 0, 8000, 0);
        const exportH = ImageCore.clampInt(val('ie-export-h', 0), 0, 8000, 0);
        if (exportW && exportH) {
          const resized = document.createElement('canvas');
          resized.width = exportW; resized.height = exportH;
          resized.getContext('2d').drawImage(source, 0, 0, exportW, exportH);
          source = resized;
        }
        let finalCanvas = source;
        if (format !== 'png' || !isChecked('ie-transparent')) {
          const flattened = document.createElement('canvas');
          flattened.width = source.width; flattened.height = source.height;
          const ctx = flattened.getContext('2d');
          ctx.fillStyle = format !== 'png' ? '#ffffff' : val('ie-bg-color', '#ffffff');
          ctx.fillRect(0, 0, flattened.width, flattened.height);
          ctx.drawImage(source, 0, 0);
          finalCanvas = flattened;
        }
        const blob = await canvasToBlob(finalCanvas, mime, Number(val('ie-quality', 0.92)));
        downloadBlob(blob, safeName(state.file && state.file.name, 'image') + '-edited.' + (format === 'jpeg' ? 'jpg' : format));
        draw(true);
        status('Edited image downloaded.');
      } catch (error) { status(error.message, true); draw(true); }
    });

    renderLayers();
    updateHistoryButtons();
  }

  /* ---------- 02 · HEIC viewer ---------- */
  function heicViewer() {
    const state = { items: [], selected: -1, api: null };

    async function getDecoder() {
      if (state.api) return state.api;
      if (!window.libheif) throw new Error('The local HEIC decoder did not load. Reload the page and try again.');
      state.api = typeof window.libheif === 'function' ? await window.libheif() : window.libheif;
      if (!state.api || !state.api.HeifDecoder) throw new Error('The local HEIC decoder is unavailable in this browser.');
      return state.api;
    }

    function formatInfo() { return $('heic-format') ? $('heic-format').value : 'png'; }

    function updateOutputInfo() {
      const node = $('heic-output-name');
      if (!node) return;
      if (!state.items.length) {
        node.textContent = 'Output: choose a format below. The original file is never modified.';
        return;
      }
      const format = formatInfo().toUpperCase();
      const quality = Number(val('heic-quality', 0.92)).toFixed(2);
      const alpha = format === 'PNG' && isChecked('heic-transparency') ? 'alpha kept' : 'flattened';
      node.textContent = 'Output: ' + state.items.length + ' preview(s) as ' + format +
        ' · quality ' + quality + ' · ' + alpha + '. The original file is never modified.';
    }

    function updateSourceInfo(items) {
      const name = $('heic-original-name');
      const format = $('heic-original-format');
      if (!name || !format) return;
      if (!items.length) {
        name.textContent = '—';
        format.textContent = '—';
        return;
      }
      const names = items.map(item => item.file.name);
      name.textContent = names.length > 1 ? names[0] + ' +' + (names.length - 1) + ' more' : names[0];
      const first = items[0].brand;
      const detail = (first.brand || 'HEIF') + ' · ' + (first.mime || 'image/heif');
      format.textContent = items.length > 1 ? detail + ' +' + (items.length - 1) + ' more' : detail;
    }

    function orientedCanvas(item) {
      const source = item.canvas;
      const orientation = isChecked('heic-orientation') ? item.orientation : 1;
      let data = { width: source.width, height: source.height, data: source.getContext('2d').getImageData(0, 0, source.width, source.height).data };
      if (orientation !== 1) {
        data = applyExifOrientation(data, orientation);
        const rotated = document.createElement('canvas');
        rotated.width = data.width;
        rotated.height = data.height;
        rotated.getContext('2d').putImageData(data, 0, 0);
        return rotated;
      }
      const needsFlatten = formatInfo() === 'jpeg' || !isChecked('heic-transparency');
      if (!needsFlatten) return source;
      const flat = document.createElement('canvas');
      flat.width = source.width;
      flat.height = source.height;
      const ctx = flat.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(source, 0, 0);
      return flat;
    }

    function showSelected(index) {
      const item = state.items[index];
      if (!item) return;
      state.selected = index;
      const source = orientedCanvas(item);
      const canvas = $('image-preview');
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0);
      meta((index + 1) + ' of ' + state.items.length + ' · ' + canvas.width + '×' + canvas.height);
      status('Previewing ' + item.name + '.');
      setEnabled('image-download', true);
      all('#heic-gallery button[data-heic-index]').forEach(function (button) {
        button.classList.toggle('is-active', Number(button.dataset.heicIndex) === index);
      });
      updateOutputInfo();
    }

    function refresh() {
      if (state.selected < 0) { updateOutputInfo(); return; }
      showSelected(state.selected);
    }

    function addGalleryItem(item, index) {
      const gallery = $('heic-gallery');
      if (!gallery) return;
      const card = document.createElement('div');
      card.className = 'heic-card';
      const thumb = document.createElement('canvas');
      const scale = Math.min(1, 180 / item.canvas.width);
      thumb.width = Math.max(1, Math.round(item.canvas.width * scale));
      thumb.height = Math.max(1, Math.round(item.canvas.height * scale));
      thumb.getContext('2d').drawImage(item.canvas, 0, 0, thumb.width, thumb.height);
      card.appendChild(thumb);
      const name = document.createElement('strong');
      name.textContent = item.name;
      card.appendChild(name);
      const detail = document.createElement('span');
      detail.textContent = item.canvas.width + '×' + item.canvas.height + ' · ' + item.brand.brand;
      card.appendChild(detail);
      const actions = document.createElement('div');
      actions.className = 'output-actions';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'btn btn-secondary btn-small';
      preview.textContent = 'Preview';
      preview.dataset.heicIndex = String(index);
      on(preview, 'click', function () { showSelected(index); });
      actions.appendChild(preview);
      card.appendChild(actions);
      gallery.appendChild(card);
    }

    function reset() {
      state.items = [];
      state.selected = -1;
      state.api = null;
      if ($('heic-gallery')) $('heic-gallery').textContent = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      setEnabled('heic-download-all', false);
      const input = $('image-file');
      if (input) input.value = '';
      updateSourceInfo([]);
      updateOutputInfo();
      meta('0 decoded');
      status('HEIC viewer reset.');
    }

    async function displayVariant(image, file, brand, orientation, name) {
      const width = image.get_width();
      const height = image.get_height();
      const limit = ImageCore.withinLimits(file.size, width, height);
      if (limit) throw new Error(limit);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const imageData = ctx.createImageData(width, height);
      await new Promise(function (resolve, reject) {
        image.display(imageData, function (displayData) {
          if (!displayData) { reject(new Error('decoder could not render the image')); return; }
          ctx.putImageData(displayData, 0, 0);
          resolve();
        });
      });
      const oriented = orientation !== 1
        ? applyExifOrientation(ctx.getImageData(0, 0, width, height), orientation)
        : { width: width, height: height, data: ctx.getImageData(0, 0, width, height).data };
      if (oriented.width !== width || oriented.height !== height) {
        canvas.width = oriented.width;
        canvas.height = oriented.height;
        canvas.getContext('2d').putImageData(oriented, 0, 0);
      }
      return { canvas: canvas, name: name, file: file, brand: brand, orientation: orientation };
    }

    bindUpload(async function (files) {
      if (!files.length) { status('Choose one or more HEIC files.', true); return; }
      if (files.length > 12) { status('Please choose no more than 12 files at once.', true); return; }
      reset();
      try {
        const api = await getDecoder();
        const failures = [];
        const brands = [];
        for (const file of files) {
          try {
            if (file.size > ImageCore.MAX_FILE_BYTES) throw new Error('file exceeds the 50 MB limit');
            const bytes = new Uint8Array(await readFile(file));
            const brand = ImageCore.detectHeifBrand(bytes);
            if (!brand.isHeif) throw new Error(brand.reason || 'not a HEIC or HEIF file');
            const decoded = new api.HeifDecoder().decode(bytes);
            if (!decoded || !decoded.length) throw new Error('no image variants found');
            const orientation = ImageCore.exifOrientation(bytes);
            for (let variant = 0; variant < decoded.length; variant++) {
              const name = file.name + (decoded.length > 1 ? ' #' + (variant + 1) : '');
              const item = await displayVariant(decoded[variant], file, brand, orientation, name);
              const index = state.items.push(item) - 1;
              brands.push(item);
              addGalleryItem(item, index);
            }
          } catch (error) { failures.push(file.name + ': ' + error.message); }
        }
        if (!state.items.length) {
          status('No images could be decoded. ' + failures.join('; '), true);
          meta('0 decoded');
          updateSourceInfo([]);
          updateOutputInfo();
          return;
        }
        updateSourceInfo(brands);
        meta(state.items.length + ' decoded');
        showSelected(0);
        status(failures.length ? 'Decoded ' + state.items.length + ' image(s). Failures: ' + failures.join('; ') : 'Decoded ' + state.items.length + ' image(s).', Boolean(failures.length));
        setEnabled('heic-download-all', true);
      } catch (error) { status(error.message, true); }
    }, reset);

    async function downloadItem(item) {
      const format = formatInfo();
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await canvasToBlob(orientedCanvas(item), mime, Number(val('heic-quality', 0.92)));
      downloadBlob(blob, safeName(item.name, 'image') + '.' + (format === 'jpeg' ? 'jpg' : 'png'));
    }

    on($('image-download'), 'click', async function () {
      const item = state.items[state.selected];
      if (!item) { status('Decode an image first.', true); return; }
      try { await downloadItem(item); status('Downloaded selected image.'); }
      catch (error) { status(error.message, true); }
    });

    on($('heic-download-all'), 'click', async function () {
      if (!state.items.length) { status('Decode an image first.', true); return; }
      try {
        for (let i = 0; i < state.items.length; i++) {
          await downloadItem(state.items[i]);
          await new Promise(function (resolve) { window.setTimeout(resolve, 120); });
        }
        status('Downloaded ' + state.items.length + ' image(s).');
      } catch (error) { status(error.message, true); }
    });

    ['heic-format', 'heic-quality', 'heic-orientation', 'heic-transparency'].forEach(function (id) {
      on($(id), 'input', refresh);
      on($(id), 'change', refresh);
    });
  }

  /* ---------- 03 · Border ---------- */
  function borderTool() {
    return simpleTool({
      process: function (state) {
        return ImageCore.composeBorder(state.source, Number($('brd-width').value), $('brd-color').value);
      },
      format: function () { return 'png'; },
      bind: function (render) {
        ['brd-width', 'brd-color'].forEach(function (id) {
          on($(id), 'input', render);
          on($(id), 'change', render);
        });
        all('[data-brd-color]').forEach(function (chip) {
          on(chip, 'click', function () {
            $('brd-color').value = chip.dataset.brdColor;
            all('[data-brd-color]').forEach(function (other) { other.classList.toggle('is-active', other === chip); });
            render();
          });
        });
      }
    });
  }

  /* ---------- 04 · Photo merger ---------- */
  function photoMerger() {
    const state = { items: [] };

    function renderOrder() {
      const list = $('pm-order');
      if (!list) return;
      list.textContent = '';
      if (!state.items.length) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Add images to see their order here.';
        list.appendChild(hint);
        return;
      }
      state.items.forEach(function (item, index) {
        const row = document.createElement('div');
        row.className = 'pm-order-row';
        const thumb = document.createElement('canvas');
        thumb.width = 28;
        thumb.height = 18;
        thumb.className = 'pm-thumb';
        const scale = Math.min(28 / item.image.naturalWidth, 18 / item.image.naturalHeight);
        thumb.width = Math.max(1, Math.round(item.image.naturalWidth * scale));
        thumb.height = Math.max(1, Math.round(item.image.naturalHeight * scale));
        thumb.getContext('2d').drawImage(item.image, 0, 0, thumb.width, thumb.height);
        row.appendChild(thumb);
        const label = document.createElement('span');
        label.textContent = (index + 1) + '. ' + item.file.name;
        row.appendChild(label);
        const actions = document.createElement('div');
        actions.className = 'output-actions';
        [['up', '↑', index === 0], ['down', '↓', index === state.items.length - 1], ['remove', '✕', false]].forEach(function (spec) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-secondary btn-small';
          button.textContent = spec[1];
          button.disabled = spec[2];
          button.setAttribute('aria-label', spec[0] + ' ' + item.file.name);
          on(button, 'click', function () {
            if (spec[0] === 'remove') {
              releaseUrl(item.url);
              state.items.splice(index, 1);
            } else {
              const target = spec[0] === 'up' ? index - 1 : index + 1;
              const moved = state.items.splice(index, 1)[0];
              state.items.splice(target, 0, moved);
            }
            renderOrder();
            render();
          });
          actions.appendChild(button);
        });
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    function layoutOptions() {
      const checked = document.querySelector('input[name="pm-direction"]:checked');
      return {
        layout: checked ? checked.value : 'horizontal',
        gap: val('pm-spacing', 12),
        border: val('pm-border-w', 0),
        sizeMode: val('pm-size-mode', 'original'),
        maintainAspect: isChecked('pm-aspect'),
        fitMode: val('pm-fit', 'fit'),
        columns: val('pm-cols', 2),
        cellWidth: val('pm-cell-w', 0),
        cellHeight: val('pm-cell-h', 0),
        align: val('pm-align', 'center')
      };
    }

    function render() {
      if (!state.items.length) return;
      const opts = layoutOptions();
      const sources = state.items.map(function (item) {
        return {
          image: item.image,
          width: item.image.naturalWidth,
          height: item.image.naturalHeight
        };
      });
      const layout = ImageCore.mosaicLayout(sources, opts);
      const limit = ImageCore.withinLimits(0, layout.width, layout.height);
      if (limit) { status(limit, true); return; }
      const canvas = $('image-preview');
      canvas.width = layout.width;
      canvas.height = layout.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = val('pm-bg', '#ffffff');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      layout.cells.forEach(function (cell) {
        const image = cell.source.image;
        if (opts.fitMode === 'fill' && opts.maintainAspect) {
          const sw = Math.min(image.naturalWidth - cell.sx, cell.sw);
          const sh = Math.min(image.naturalHeight - cell.sy, cell.sh);
          ctx.drawImage(image, cell.sx, cell.sy, Math.max(1, sw), Math.max(1, sh), cell.drawX, cell.drawY, cell.w, cell.h);
        } else {
          ctx.drawImage(image, cell.drawX, cell.drawY, cell.w, cell.h);
        }
        const border = Number(opts.border) || 0;
        if (border > 0) {
          ctx.save();
          ctx.strokeStyle = val('pm-border-color', '#0f172a');
          ctx.lineWidth = border;
          ctx.strokeRect(cell.x + border / 2, cell.y + border / 2, cell.boxWidth - border, cell.boxHeight - border);
          ctx.restore();
        }
      });
      meta(layout.width + '×' + layout.height + ' · ' + state.items.length + ' photo' + (state.items.length === 1 ? '' : 's'));
      setEnabled('image-download', true);
      status('Merged ' + state.items.length + ' photo(s).');
    }

    function reset() {
      state.items.forEach(function (item) { releaseUrl(item.url); });
      state.items = [];
      if ($('image-file')) $('image-file').value = '';
      renderOrder();
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No images loaded');
      status('Merger reset.');
    }

    bindUpload(async function (files) {
      if (!files.length) { status('Choose images first.', true); return; }
      if (files.length > 6) { status('Photo Merger accepts up to six images.', true); return; }
      reset();
      try {
        for (const file of files) {
          const loaded = await decodeImageFile(file);
          state.items.push({ image: loaded.image, url: loaded.url, file: file });
        }
        renderOrder();
        render();
      } catch (error) { status(error.message, true); }
    }, reset);

    all('input[name="pm-direction"]').forEach(function (input) { on(input, 'change', render); });
    ['pm-spacing', 'pm-bg', 'pm-size-mode', 'pm-aspect', 'pm-fit', 'pm-cell-w', 'pm-cell-h', 'pm-cols', 'pm-align', 'pm-border-w', 'pm-border-color']
      .forEach(function (id) {
        on($(id), 'input', render);
        on($(id), 'change', render);
      });
    on($('pm-merge'), 'click', function () {
      if (!state.items.length) { status('Add at least one image first.', true); return; }
      render();
    });
    on($('image-download'), 'click', async function () {
      if (!state.items.length) { status('Merge images first.', true); return; }
      try {
        const blob = await canvasToBlob($('image-preview'), 'image/png');
        downloadBlob(blob, 'merged-photos.png');
        status('Merged PNG downloaded.');
      } catch (error) { status(error.message, true); }
    });
  }

  /* ---------- 05 · Screenshot beautifier ---------- */
  function screenshotBeautifier() {
    const state = { image: null, url: null, file: null };

    function roundedRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    function drawBackground(ctx, width, height) {
      const type = $('sb-bg-type').value;
      if (type === 'transparent') { ctx.clearRect(0, 0, width, height); return; }
      if (type !== 'gradient') {
        ctx.fillStyle = $('sb-color1').value;
        ctx.fillRect(0, 0, width, height);
        if (type === 'pattern') {
          const pattern = $('sb-pattern').value;
          ctx.strokeStyle = $('sb-color2').value;
          ctx.fillStyle = $('sb-color2').value;
          ctx.globalAlpha = 0.35;
          if (pattern === 'dots') {
            for (let y = 10; y < height; y += 24) {
              for (let x = 10; x < width; x += 24) {
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          } else if (pattern === 'grid') {
            for (let x = 0; x < width; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
            for (let y = 0; y < height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
          } else {
            for (let x = -height; x < width; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke(); }
          }
          ctx.globalAlpha = 1;
        }
        return;
      }
      const direction = $('sb-gradient-direction').value;
      let x0 = 0, y0 = 0, x1 = width, y1 = 0;
      if (direction === 'to bottom') { x1 = 0; y1 = height; }
      if (direction === '135deg') { x1 = width; y1 = height; }
      const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
      gradient.addColorStop(0, $('sb-color1').value);
      gradient.addColorStop(1, $('sb-color2').value);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    function render() {
      if (!state.image) return;
      const padding = ImageCore.clampInt($('sb-padding').value, 0, 120, 40);
      const radius = ImageCore.clampInt($('sb-radius').value, 0, 60, 12);
      const blur = ImageCore.clampInt($('sb-shadow-blur').value, 0, 80, 24);
      const shadowX = ImageCore.clampInt($('sb-shadow-x').value, -40, 40, 0);
      const shadowY = ImageCore.clampInt($('sb-shadow-y').value, -40, 60, 12);
      const opacity = Number($('sb-shadow-opacity').value) / 100;
      const title = $('sb-titlebar').checked;
      const titleHeight = title ? 34 : 0;
      const pad = Math.ceil(Math.max(blur + Math.abs(shadowY), Math.abs(shadowX), 4));
      const cardW = state.image.naturalWidth + padding * 2;
      const cardH = state.image.naturalHeight + padding * 2 + titleHeight;
      const canvas = $('image-preview');
      canvas.width = cardW + pad * 2;
      canvas.height = cardH + pad * 2;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(ctx, canvas.width, canvas.height);
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,' + opacity + ')';
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = shadowX;
      ctx.shadowOffsetY = shadowY;
      ctx.fillStyle = '#ffffff';
      roundedRect(ctx, pad, pad, cardW, cardH, radius);
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundedRect(ctx, pad, pad, cardW, cardH, radius);
      ctx.clip();
      const filter = 'brightness(' + $('sb-brightness').value + '%) contrast(' + $('sb-contrast').value + '%) ' +
        'saturate(' + $('sb-saturation').value + '%) blur(' + $('sb-blur').value + 'px)';
      ctx.filter = filter;
      ctx.drawImage(state.image, pad + padding, pad + padding + titleHeight, state.image.naturalWidth, state.image.naturalHeight);
      ctx.filter = 'none';
      if (title) {
        const barY = pad + padding;
        ctx.fillStyle = $('sb-titlebar-bg').value;
        ctx.fillRect(pad, barY, cardW, titleHeight);
        ctx.fillStyle = $('sb-titlebar-text-color').value;
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        if ($('sb-titlebar-style').value === 'mac') {
          [['#ff5f57', 10], ['#febc2e', 28], ['#28c840', 46]].forEach(function (dot) {
            ctx.beginPath();
            ctx.fillStyle = dot[0];
            ctx.arc(pad + 14 + dot[1] - 10, barY + titleHeight / 2, 6, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.fillStyle = $('sb-titlebar-text-color').value;
          ctx.textAlign = 'center';
          ctx.fillText($('sb-titlebar-text').value, pad + cardW / 2, barY + titleHeight / 2, cardW * 0.6);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText($('sb-titlebar-text').value, pad + 14, barY + titleHeight / 2, cardW - 110);
          ctx.textAlign = 'right';
          ctx.fillText('─  □  ×', pad + cardW - 12, barY + titleHeight / 2);
        }
      }
      const overlay = $('sb-overlay-text').value;
      if (overlay) {
        const size = ImageCore.clampInt($('sb-font-size').value, 12, 96, 24);
        const position = $('sb-text-position').value;
        let y = pad + padding + titleHeight + size;
        if (position === 'center') y = pad + cardH / 2;
        if (position === 'bottom') y = pad + cardH - size;
        ctx.font = '800 ' + size + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, size / 10);
        ctx.strokeStyle = 'rgba(15,23,42,.6)';
        ctx.strokeText(overlay, pad + cardW / 2, y, cardW * 0.9);
        ctx.fillStyle = $('sb-text-color').value;
        ctx.fillText(overlay, pad + cardW / 2, y, cardW * 0.9);
      }
      ctx.restore();
      meta(canvas.width + '×' + canvas.height);
      setEnabled('image-download', true);
      status('Style applied.');
    }

    function reset() {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = null;
      $('image-file').value = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No screenshot loaded');
      status('Beautifier reset.');
    }

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        status('Screenshot loaded. Choose a style and click Apply style.');
        render();
      } catch (error) { status(error.message, true); }
    }, reset);

    all('.image-controls input, .image-controls select').forEach(function (control) {
      if (control.type === 'file') return;
      on(control, 'input', function () { if (control.id === 'sb-apply') return; });
      on(control, 'change', function () { if (state.image && control.id !== 'sb-apply') render(); });
    });
    on($('sb-apply'), 'click', function () {
      if (!state.image) { status('Load a screenshot first.', true); return; }
      render();
    });

    const presets = {
      soft: { 'sb-bg-type': 'gradient', 'sb-color1': '#2563eb', 'sb-color2': '#60a5fa', 'sb-padding': '40', 'sb-radius': '12', 'sb-shadow-blur': '24' },
      dark: { 'sb-bg-type': 'solid', 'sb-color1': '#0f172a', 'sb-color2': '#60a5fa', 'sb-padding': '32', 'sb-radius': '18', 'sb-shadow-blur': '32' },
      paper: { 'sb-bg-type': 'pattern', 'sb-color1': '#eff6ff', 'sb-color2': '#93c5fd', 'sb-pattern': 'grid', 'sb-padding': '36', 'sb-radius': '6', 'sb-shadow-blur': '16' }
    };
    all('[data-sb-preset]').forEach(function (chip) {
      on(chip, 'click', function () {
        const preset = presets[chip.dataset.sbPreset];
        if (!preset) return;
        Object.keys(preset).forEach(function (id) { if ($(id)) $(id).value = preset[id]; });
        bindRangeLabels();
        all('[data-sb-preset]').forEach(function (other) { other.classList.toggle('is-active', other === chip); });
        if (state.image) render();
      });
    });

    on($('image-download'), 'click', async function () {
      if (!state.image || !$('image-preview').width) { status('Apply a style first.', true); return; }
      try {
        const blob = await canvasToBlob($('image-preview'), 'image/png');
        downloadBlob(blob, safeName(state.file && state.file.name, 'screenshot') + '-styled.png');
        status('Styled PNG downloaded.');
      } catch (error) { status(error.message, true); }
    });
  }

  /* ---------- 06 · Black and white ---------- */
  function blackAndWhite() {
    return simpleTool({
      process: function (state) {
        if ($('bw-mode').value === 'threshold') return ImageCore.threshold(state.source, $('bw-threshold').value);
        return ImageCore.grayscale(state.source);
      },
      format: function () { return $('bw-format').value; },
      quality: function () { return Number($('bw-quality').value); },
      afterRender: function (state) {
        const thresholdMode = $('bw-mode').value === 'threshold';
        $('bw-threshold').disabled = !thresholdMode;
        if (state.result) setEnabled('image-download', true);
      },
      bind: function (render) {
        ['bw-mode', 'bw-threshold', 'bw-format', 'bw-quality'].forEach(function (id) {
          on($(id), 'input', render);
          on($(id), 'change', render);
        });
      }
    });
  }

  /* ---------- 07 · Flip and rotate ---------- */
  function flipRotate() {
    const state = { image: null, url: null, file: null, result: null };

    function render() {
      if (!state.image) return;
      const source = imageDataFromImage(state.image);
      state.result = source;
      setCanvasImageData($('image-preview'), source);
      meta(source.width + '×' + source.height);
      setEnabled('image-download', true);
    }

    async function transform(kind) {
      if (!state.image) { status('Load an image first.', true); return; }
      try {
        let data = imageDataFromImage(state.image);
        if (kind === 'left') data = ImageCore.rotate90(data, 'left');
        if (kind === 'right') data = ImageCore.rotate90(data, 'right');
        if (kind === 'horizontal') data = ImageCore.flip(data, 'horizontal');
        if (kind === 'vertical') data = ImageCore.flip(data, 'vertical');
        const image = await imageFromCanvas(canvasFromImageData(data));
        if (state.url) releaseUrl(state.url);
        state.image = image;
        state.url = null;
        render();
        status('Orientation updated.');
      } catch (error) { status(error.message, true); }
    }

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        status('Image loaded.');
        render();
      } catch (error) { status(error.message, true); }
    }, function () {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = state.result = null;
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No image loaded');
      status('Orientation tool reset.');
    });

    [['fr-rot-left', 'left'], ['fr-rot-right', 'right'], ['fr-flip-h', 'horizontal'], ['fr-flip-v', 'vertical']].forEach(function (item) {
      on($(item[0]), 'click', function () { transform(item[1]); });
    });

    on($('image-download'), 'click', async function () {
      if (!state.result) { status('Load an image first.', true); return; }
      const format = $('fr-format').value;
      try {
        const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
        const blob = await canvasToBlob(canvasFromImageData(state.result), mime, Number($('fr-quality').value));
        downloadBlob(blob, safeName(state.file && state.file.name, 'image') + '-oriented.' + (format === 'jpeg' ? 'jpg' : format));
        status('Oriented image downloaded.');
      } catch (error) { status(error.message, true); }
    });
  }

  /* ---------- 08 · Resizer ---------- */
  function resizer() {
    const state = { image: null, url: null, file: null, result: null };

    function render() {
      if (!state.image) return;
      const dims = ImageCore.fitDimensions(
        state.image.naturalWidth, state.image.naturalHeight,
        $('rs-width').value, $('rs-height').value,
        $('rs-lock').checked, $('rs-mode').value
      );
      const limit = ImageCore.withinLimits(0, dims.width, dims.height);
      if (limit) { status(limit, true); return; }
      state.result = ImageCore.resize(imageDataFromImage(state.image), dims.width, dims.height);
      setCanvasImageData($('image-preview'), state.result);
      meta(dims.width + '×' + dims.height);
      setEnabled('image-download', true);
      status('Resized to ' + dims.width + '×' + dims.height + '.');
    }

    on($('rs-width'), 'change', function () {
      if (!$('rs-lock').checked || !state.image) return;
      const ratio = state.image.naturalHeight / state.image.naturalWidth;
      $('rs-height').value = String(Math.max(1, Math.round(Number($('rs-width').value) * ratio)));
    });
    on($('rs-height'), 'change', function () {
      if (!$('rs-lock').checked || !state.image) return;
      const ratio = state.image.naturalWidth / state.image.naturalHeight;
      $('rs-width').value = String(Math.max(1, Math.round(Number($('rs-height').value) * ratio)));
    });

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        $('rs-width').value = String(loaded.image.naturalWidth);
        $('rs-height').value = String(loaded.image.naturalHeight);
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        status('Image loaded. Set the target size.');
        render();
      } catch (error) { status(error.message, true); }
    }, function () {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = state.result = null;
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No image loaded');
      status('Resizer reset.');
    });

    on($('rs-apply'), 'click', function () { if (state.image) render(); else status('Load an image first.', true); });
    on($('rs-format'), 'change', function () { $('rs-quality').disabled = $('rs-format').value === 'png'; });

    on($('image-download'), 'click', async function () {
      if (!state.result) { status('Resize an image first.', true); return; }
      const format = $('rs-format').value;
      try {
        const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
        const blob = await canvasToBlob(canvasFromImageData(state.result), mime, Number($('rs-quality').value));
        downloadBlob(blob, safeName(state.file && state.file.name, 'image') + '-resized.' + (format === 'jpeg' ? 'jpg' : format));
        status('Resized image downloaded.');
      } catch (error) { status(error.message, true); }
    });
  }

  /* ---------- 09 · Image to SVG ---------- */
  function imageToSvg() {
    const state = { image: null, url: null, file: null, dataUrl: null };
    const download = $('image-download');
    if (download) download.textContent = 'Download SVG';

    function reset() {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = state.dataUrl = null;
      $('image-file').value = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      $('image-download').textContent = 'Download SVG';
      meta('No image loaded');
      status('SVG wrapper reset.');
    }

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        state.dataUrl = await readFile(file, 'dataURL');
        const canvas = $('image-preview');
        canvas.width = loaded.image.naturalWidth;
        canvas.height = loaded.image.naturalHeight;
        canvas.getContext('2d').drawImage(loaded.image, 0, 0);
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight + ' · raster embedded');
        setEnabled('image-download', true);
        status('SVG wrapper ready. The original pixels are embedded, not vector-traced.');
      } catch (error) { status(error.message, true); }
    }, reset);

    on($('image-download'), 'click', function () {
      if (!state.image || !state.dataUrl) { status('Load an image first.', true); return; }
      const w = state.image.naturalWidth;
      const h = state.image.naturalHeight;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<image width="' + w + '" height="' + h + '" href="' + state.dataUrl + '"/></svg>';
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), safeName(state.file && state.file.name, 'image') + '.svg');
      status('SVG wrapper downloaded.');
    });
  }

  /* ---------- 10 · Inverter ---------- */
  function inverter() {
    return simpleTool({
      process: function (state) { return ImageCore.invert(state.source); },
      format: function () { return $('inv-format').value; },
      quality: function () { return Number($('inv-quality').value); },
      bind: function (render) {
        ['inv-format', 'inv-quality'].forEach(function (id) {
          on($(id), 'input', render);
          on($(id), 'change', render);
        });
      }
    });
  }

  /* ---------- 11 · OCR ---------- */
  function ocrTool() {
    const state = {
      image: null, url: null, file: null, worker: null, workerPromise: null,
      busy: false, processed: null
    };

    function workerUrl(name) { return new URL('/js/vendor/' + name, window.location.origin).href; }

    function getWorker() {
      if (state.worker) return Promise.resolve(state.worker);
      if (state.workerPromise) return state.workerPromise;
      if (!window.Tesseract || !window.Tesseract.createWorker) {
        return Promise.reject(new Error('The local OCR library did not load. Reload the page and try again.'));
      }
      state.workerPromise = window.Tesseract.createWorker('eng', 1, {
        workerPath: workerUrl('tesseract-worker.min.js'),
        langPath: workerUrl(''),
        corePath: workerUrl('tesseract-core-lstm.wasm.js'),
        logger: function (logger) {
          if (!state.busy || !logger || !logger.status) return;
          status(logger.status + (Number.isFinite(logger.progress) ? ' ' + Math.round(logger.progress * 100) + '%' : ''));
        }
      }).then(function (worker) {
        state.worker = worker;
        const node = $('ocr-worker-status');
        if (node) node.textContent = 'OCR engine ready · English data loaded locally.';
        return worker;
      }).catch(function (error) {
        state.workerPromise = null;
        const node = $('ocr-worker-status');
        if (node) node.textContent = 'OCR engine failed to load.';
        throw error;
      });
      return state.workerPromise;
    }

    function enhanceInk(input) {
      const out = createImageDataLike(input);
      for (let i = 0; i < input.data.length; i += 4) {
        const r = input.data[i];
        const g = input.data[i + 1];
        const b = input.data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const luma = r * 0.299 + g * 0.587 + b * 0.114;
        const dark = luma < 200 && max - min > 18 ? 0 : luma < 110 ? 0 : null;
        out.data[i] = dark === null ? r : dark;
        out.data[i + 1] = dark === null ? g : dark;
        out.data[i + 2] = dark === null ? b : dark;
        out.data[i + 3] = input.data[i + 3];
      }
      return out;
    }

    function createImageDataLike(input) {
      return { width: input.width, height: input.height, data: new Uint8ClampedArray(input.data.length) };
    }

    function preprocess() {
      if (!state.image) return null;
      let data = imageDataFromImage(state.image);
      if (isChecked('ocr-gray')) data = ImageCore.grayscale(data);
      if (isChecked('ocr-denoise')) data = ImageCore.boxBlur(data, 1);
      if (isChecked('ocr-contrast')) data = ImageCore.adjustImageData(data, { contrast: 45, brightness: 4 });
      if (isChecked('ocr-ink')) data = enhanceInk(data);
      if (isChecked('ocr-threshold')) data = ImageCore.threshold(data, val('ocr-threshold-level', 150));
      const angle = Number(val('ocr-angle', 0));
      if (angle) data = ImageCore.rotateArbitrary(data, angle, '#ffffff');
      return data;
    }

    function renderProcessed() {
      if (!state.image) return;
      state.processed = preprocess();
      setCanvasImageData($('ocr-preview-processed'), state.processed);
      const previewSize = ImageCore.clampInt(val('ocr-preview-size', 18), 12, 36, 18);
      const preview = $('ocr-text-preview');
      if (preview) preview.style.fontSize = previewSize + 'px';
    }

    function setText(text) {
      const value = text || '';
      $('ocr-output').value = value;
      const preview = $('ocr-text-preview');
      if (preview) preview.textContent = value || 'Extracted text will appear here.';
      setEnabled('ocr-copy', Boolean(value.trim()));
      setEnabled('ocr-download', Boolean(value.trim()));
      if (!value.trim()) {
        const warning = $('ocr-warnings');
        if (warning) warning.hidden = true;
        const confidence = $('ocr-confidence');
        if (confidence) confidence.textContent = 'Confidence: —';
      }
    }

    ['ocr-extract', 'ocr-copy', 'ocr-download'].forEach(function (id) { setEnabled(id, false); });
    getWorker().catch(function (error) { status(error.message, true); });

    on(window, 'pagehide', function () {
      if (state.worker && state.worker.terminate) state.worker.terminate();
    });

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        const canvas = $('image-preview');
        canvas.width = loaded.image.naturalWidth;
        canvas.height = loaded.image.naturalHeight;
        canvas.getContext('2d').drawImage(loaded.image, 0, 0);
        setText('');
        renderProcessed();
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        setEnabled('ocr-extract', true);
        status('Image loaded. Recognition is ready.');
      } catch (error) { status(error.message, true); }
    }, function () {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = state.processed = null;
      if ($('image-file')) $('image-file').value = '';
      setText('');
      clearCanvas($('image-preview'));
      clearCanvas($('ocr-preview-processed'));
      setEnabled('ocr-extract', false);
      meta('No image loaded');
      status('OCR reset.');
    });

    on($('ocr-extract'), 'click', async function () {
      if (!state.image || !state.processed) { status('Load an image first.', true); return; }
      if (state.busy) return;
      state.busy = true;
      setEnabled('ocr-extract', false);
      try {
        const worker = await getWorker();
        const result = await worker.recognize(canvasFromImageData(state.processed));
        const text = (result && result.data && result.data.text ? result.data.text : '').trim();
        setText(text);
        const confidence = Number(result && result.data ? result.data.confidence : NaN);
        const confidenceNode = $('ocr-confidence');
        if (confidenceNode) {
          confidenceNode.textContent = Number.isFinite(confidence)
            ? 'Confidence: ' + confidence.toFixed(1) + '%'
            : 'Confidence: unavailable';
        }
        const warning = $('ocr-warnings');
        if (warning) {
          if (!text) {
            warning.textContent = 'No text was detected. Try larger, higher-contrast text or adjust the preprocessing options.';
            warning.hidden = false;
          } else if (Number.isFinite(confidence) && confidence < 70) {
            warning.textContent = 'Low recognition confidence. Compare every character with the original before using this text.';
            warning.hidden = false;
          } else warning.hidden = true;
        }
        status(text ? 'Recognition finished. Review the text before copying.' : 'Recognition finished, but no text was found.', !text);
      } catch (error) {
        status('Recognition failed: ' + error.message, true);
      }
      state.busy = false;
      setEnabled('ocr-extract', Boolean(state.image));
    });

    on($('ocr-output'), 'input', function () {
      const preview = $('ocr-text-preview');
      if (preview) preview.textContent = $('ocr-output').value || 'Extracted text will appear here.';
      setEnabled('ocr-copy', Boolean($('ocr-output').value.trim()));
      setEnabled('ocr-download', Boolean($('ocr-output').value.trim()));
    });
    on($('ocr-preview-size'), 'input', function () {
      const preview = $('ocr-text-preview');
      if (preview) preview.style.fontSize = ImageCore.clampInt($('ocr-preview-size').value, 12, 36, 18) + 'px';
    });
    ['ocr-gray', 'ocr-contrast', 'ocr-threshold', 'ocr-denoise', 'ocr-deskew', 'ocr-ink',
      'ocr-threshold-level', 'ocr-angle'].forEach(function (id) {
      on($(id), 'input', renderProcessed);
      on($(id), 'change', renderProcessed);
    });
    on($('ocr-language'), 'change', function () {
      const notice = $('ocr-lang-notice');
      if (notice && $('ocr-language').value !== 'eng') notice.hidden = false;
    });

    on($('ocr-copy'), 'click', function () { copyText($('ocr-output').value, 'Extracted text copied.'); });
    on($('ocr-download'), 'click', function () {
      const text = $('ocr-output').value;
      if (!text) { status('There is no text to download.', true); return; }
      downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), safeName(state.file && state.file.name, 'image') + '.txt');
      status('Text file downloaded.');
    });
  }

  /* ---------- 12 · QR code ---------- */
  function qrGenerator() {
    const state = {
      qr: null, canvas: null, svg: null, payload: '', kind: 'qr',
      barcode: null, logo: null, logoData: ''
    };

    const TYPE_NOTES = {
      text: 'Plain text is encoded exactly as typed.',
      url: 'Web addresses are normalised to https:// when needed.',
      email: 'Creates a mailto: link with optional subject and body.',
      phone: 'Creates a tel: link.',
      sms: 'Creates an SMSTO: payload.',
      wifi: 'Creates a WIFI: payload. Special characters are escaped locally.',
      vcard: 'Creates a compact vCard 3.0 contact.',
      location: 'Creates a geo: latitude,longitude payload.',
      calendar: 'Creates a VEVENT with local start and end times.',
      whatsapp: 'Creates a wa.me link with an optional prefilled message.',
      image: 'Small images are embedded as data URLs. Nothing is uploaded.'
    };
    const BARCODE_NOTES = {
      code128: 'Code 128 accepts printable ASCII, including mixed letters and numbers.',
      code39: 'Code 39 accepts uppercase letters, digits and -.$/+%*.',
      ean13: 'EAN-13 needs 12 digits; the check digit is added for you.',
      ean8: 'EAN-8 needs 7 digits; the check digit is added for you.',
      upca: 'UPC-A needs 11 digits; the check digit is added for you.',
      itf: 'ITF needs an even number of digits (at least two).'
    };

    function activeType() {
      const imageRadio = document.querySelector('input[name="qr-mode"][value="image"]');
      if (imageRadio && imageRadio.checked) return 'image';
      return val('qr-type', 'text');
    }

    function showFields(type) {
      all('[id^="qr-fields-"]').forEach(function (node) {
        node.hidden = node.id !== 'qr-fields-' + type;
      });
      const note = $('qr-kind-note');
      if (note) {
        const kind = val('qr-kind', 'qr');
        note.textContent = kind === 'qr'
          ? (TYPE_NOTES[type] || 'QR codes store the payload locally.') +
            ' Barcodes encode short numeric or alphanumeric payloads; choose QR for links, Wi-Fi and contacts.'
          : (BARCODE_NOTES[kind] || '') + ' Choose QR for links, Wi-Fi and contacts.';
      }
    }

    function syncType(type, fromSelect) {
      const select = $('qr-type');
      if (select && fromSelect) select.value = type;
      const imageRadio = document.querySelector('input[name="qr-mode"][value="image"]');
      const textRadio = document.querySelector('input[name="qr-mode"][value="text"]');
      if (imageRadio) imageRadio.checked = type === 'image';
      if (textRadio) textRadio.checked = type !== 'image';
      showFields(type);
    }

    function setValidation(message) {
      const node = $('qr-validation');
      if (!node) return;
      node.textContent = message || '';
      node.hidden = !message;
    }

    function clearResult() {
      state.qr = state.canvas = state.svg = state.barcode = null;
      state.payload = '';
      state.kind = val('qr-kind', 'qr');
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      setEnabled('qr-download-svg', false);
      meta('No QR code generated');
      setValidation('');
    }

    function fieldsFor(type) {
      switch (type) {
        case 'url': return { url: val('qr-url', '') };
        case 'email': return { email: val('qr-email', ''), subject: val('qr-subject', ''), body: val('qr-body', '') };
        case 'phone': return { phone: val('qr-phone', '') };
        case 'sms': return { phone: val('qr-sms-phone', ''), message: val('qr-message', '') };
        case 'wifi': return {
          ssid: val('qr-ssid', ''), encryption: val('qr-encryption', 'WPA'),
          password: val('qr-password', ''), hidden: isChecked('qr-hidden')
        };
        case 'vcard': return {
          name: val('qr-name', ''), org: val('qr-org', ''), phone: val('qr-vcard-phone', ''),
          email: val('qr-vcard-email', ''), url: val('qr-vcard-url', '')
        };
        case 'location': return { latitude: val('qr-latitude', 0), longitude: val('qr-longitude', 0) };
        case 'calendar': return {
          title: val('qr-event-title', ''), location: val('qr-event-location', ''),
          start: val('qr-start', ''), end: val('qr-end', '')
        };
        case 'whatsapp': return { phone: val('qr-whatsapp-phone', ''), message: val('qr-whatsapp-message', '') };
        default: return { text: val('qr-text', '') };
      }
    }

    async function payloadFor(type) {
      if (type === 'image') {
        const file = $('qr-image-file') && $('qr-image-file').files && $('qr-image-file').files[0];
        if (!file) return { ok: false, message: 'Choose an image for image mode, or switch to text mode.' };
        if (file.size > 2 * 1024 * 1024) {
          return {
            ok: false,
            message: 'This image is too large to fit a QR code. Host it at a public URL and use Text or URL mode. LetitEdit does not upload images.'
          };
        }
        return { ok: true, value: await readFile(file, 'dataURL') };
      }
      return ImageCore.buildPayload(type, fieldsFor(type));
    }

    function buildQr(payload, ecc) {
      if (typeof window.qrcode !== 'function') throw new Error('The local QR encoder did not load.');
      const qr = window.qrcode(0, ecc);
      qr.addData(payload);
      qr.make();
      return qr;
    }

    function drawQr(qr) {
      const cell = ImageCore.clampInt(val('qr-size', 8), 2, 16, 8);
      const margin = ImageCore.clampInt(val('qr-margin', 4), 2, 8, 4);
      const count = qr.getModuleCount();
      const size = (count + margin * 2) * cell;
      const canvas = $('image-preview');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = val('qr-background', '#ffffff');
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = val('qr-foreground', '#0f172a');
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) ctx.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
        }
      }
      return { canvas: canvas, cell: cell, margin: margin, count: count };
    }

    function drawBarcode(encoded) {
      const module = Math.max(1, Math.round(ImageCore.clampInt(val('qr-size', 8), 2, 16, 8) / 3));
      const height = ImageCore.clampInt(val('qr-bar-height', 120), 40, 400, 120);
      const width = encoded.bits.length * module;
      const canvas = $('image-preview');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = val('qr-background', '#ffffff');
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = val('qr-foreground', '#0f172a');
      for (let i = 0; i < encoded.bits.length; i++) {
        if (encoded.bits[i] === '1') ctx.fillRect(i * module, 0, module, height);
      }
      return { canvas: canvas, module: module, height: height };
    }

    function drawLogo() {
      if (!state.logo || !state.canvas) return;
      const canvas = state.canvas.canvas;
      const ctx = canvas.getContext('2d');
      const percent = ImageCore.clampInt(val('qr-logo-size', 18), 5, 28, 18);
      const logoSize = Math.max(8, Math.round(canvas.width * percent / 100));
      const x = Math.round((canvas.width - logoSize) / 2);
      const y = Math.round((canvas.height - logoSize) / 2);
      ctx.save();
      ctx.fillStyle = val('qr-background', '#ffffff');
      roundedRectPath(ctx, x - 3, y - 3, logoSize + 6, logoSize + 6, 4);
      ctx.fill();
      ctx.drawImage(state.logo, x, y, logoSize, logoSize);
      ctx.restore();
    }

    function qrSvg(qr, margin) {
      const count = qr.getModuleCount();
      const size = count + margin * 2;
      let path = '';
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) path += 'M' + (col + margin) + ' ' + (row + margin) + 'h1v1h-1z';
        }
      }
      let logo = '';
      if (state.logoData) {
        const percent = ImageCore.clampInt(val('qr-logo-size', 18), 5, 28, 18);
        const logoSize = size * percent / 100;
        const offset = (size - logoSize) / 2;
        logo = '<image x="' + offset + '" y="' + offset + '" width="' + logoSize + '" height="' + logoSize + '" href="' + state.logoData + '"/>';
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
        '<rect width="' + size + '" height="' + size + '" fill="' + val('qr-background', '#ffffff') + '"/>' +
        '<path d="' + path + '" fill="' + val('qr-foreground', '#0f172a') + '"/>' + logo + '</svg>';
    }

    function barcodeSvg(encoded) {
      const module = Math.max(1, Math.round(ImageCore.clampInt(val('qr-size', 8), 2, 16, 8) / 3));
      const height = ImageCore.clampInt(val('qr-bar-height', 120), 40, 400, 120);
      const width = encoded.bits.length * module;
      let path = '';
      for (let i = 0; i < encoded.bits.length; i++) {
        if (encoded.bits[i] === '1') path += 'M' + (i * module) + ' 0h' + module + 'v' + height + 'h-' + module + 'z';
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
        '" viewBox="0 0 ' + width + ' ' + height + '" shape-rendering="crispEdges">' +
        '<rect width="' + width + '" height="' + height + '" fill="' + val('qr-background', '#ffffff') + '"/>' +
        '<path d="' + path + '" fill="' + val('qr-foreground', '#0f172a') + '"/></svg>';
    }

    async function generate(silent) {
      const kind = val('qr-kind', 'qr');
      const type = activeType();
      clearResult();
      state.kind = kind;
      showFields(type);
      try {
        if (kind === 'qr') {
          const payload = await payloadFor(type);
          if (!payload.ok) {
            status(payload.message, true);
            setValidation(payload.message);
            return;
          }
          state.qr = buildQr(payload.value, val('qr-ecc', 'M'));
          state.canvas = drawQr(state.qr);
          state.svg = qrSvg(state.qr, state.canvas.margin);
          state.payload = payload.value;
          meta(state.qr.getModuleCount() + '×' + state.qr.getModuleCount() + ' modules · ' + type.toUpperCase());
        } else {
          if (type === 'image') {
            const message = 'Barcodes cannot encode image data URLs. Choose a text or numeric payload type.';
            status(message, true);
            setValidation(message);
            return;
          }
          const payload = ImageCore.buildPayload(type, fieldsFor(type));
          if (!payload.ok) { status(payload.message, true); setValidation(payload.message); return; }
          const encoded = ImageCore.barcodeEncode(kind, payload.value);
          if (!encoded.ok) { status(encoded.reason, true); setValidation(encoded.reason); return; }
          state.barcode = encoded;
          state.canvas = drawBarcode(encoded);
          state.svg = barcodeSvg(encoded);
          state.payload = encoded.text;
          meta(kind.toUpperCase() + ' · ' + encoded.bits.length + ' modules' + (encoded.check != null ? ' · check ' + encoded.check : ''));
        }
        drawLogo();
        setEnabled('image-download', true);
        setEnabled('qr-download-svg', true);
        if (!silent) {
          status(kind === 'qr'
            ? 'QR code generated. Scan it with your phone before downloading.'
            : encodedName(kind) + ' barcode generated. Scan it with a barcode reader before printing.');
        } else if (state.payload) {
          status(kind === 'qr' ? 'QR preview updated.' : encodedName(kind) + ' preview updated.');
        }
      } catch (error) {
        const message = type === 'image'
          ? 'This image data URL is too large for a QR code at that error-correction level. Host the image at a public URL and use Text or URL mode. LetitEdit never uploads private images.'
          : (kind === 'qr'
            ? 'That payload is too long for a QR code at this error-correction level. Shorten it or choose Low error correction.'
            : error.message);
        clearResult();
        status(message, true);
        setValidation(message);
      }
    }

    function encodedName(kind) {
      return {
        code128: 'Code 128', code39: 'Code 39', ean13: 'EAN-13',
        ean8: 'EAN-8', upca: 'UPC-A', itf: 'ITF'
      }[kind] || kind.toUpperCase();
    }

    function reset() {
      state.logo = null;
      state.logoData = '';
      [
        'qr-text', 'qr-url', 'qr-email', 'qr-subject', 'qr-body', 'qr-phone', 'qr-sms-phone',
        'qr-message', 'qr-ssid', 'qr-password', 'qr-name', 'qr-org', 'qr-vcard-phone',
        'qr-vcard-email', 'qr-vcard-url', 'qr-latitude', 'qr-longitude', 'qr-event-title',
        'qr-event-location', 'qr-start', 'qr-end', 'qr-whatsapp-phone', 'qr-whatsapp-message'
      ].forEach(function (id) { if ($(id)) $(id).value = ''; });
      if ($('qr-latitude')) $('qr-latitude').value = '0';
      if ($('qr-longitude')) $('qr-longitude').value = '0';
      if ($('qr-start')) $('qr-start').value = '2026-12-01T09:00';
      if ($('qr-end')) $('qr-end').value = '2026-12-01T10:00';
      ['qr-image-file', 'qr-logo-file'].forEach(function (id) { if ($(id)) $(id).value = ''; });
      if ($('qr-type')) $('qr-type').value = 'text';
      if ($('qr-kind')) $('qr-kind').value = 'qr';
      if ($('qr-live')) $('qr-live').checked = false;
      syncType('text', false);
      clearResult();
      status('QR generator reset.');
    }

    all('input[name="qr-mode"]').forEach(function (radio) {
      on(radio, 'change', function () {
        if (!radio.checked) return;
        syncType(radio.value === 'image' ? 'image' : val('qr-type', 'text'), true);
        setValidation('');
      });
    });
    on($('qr-type'), 'change', function () { syncType($('qr-type').value, false); setValidation(''); });
    on($('qr-kind'), 'change', function () { showFields(activeType()); setValidation(''); });
    on($('qr-generate'), 'click', function () { generate(false); });

    const liveIds = [
      'qr-text', 'qr-url', 'qr-email', 'qr-subject', 'qr-body', 'qr-phone', 'qr-sms-phone',
      'qr-message', 'qr-ssid', 'qr-encryption', 'qr-password', 'qr-hidden', 'qr-name', 'qr-org',
      'qr-vcard-phone', 'qr-vcard-email', 'qr-vcard-url', 'qr-latitude', 'qr-longitude',
      'qr-event-title', 'qr-event-location', 'qr-start', 'qr-end', 'qr-whatsapp-phone',
      'qr-whatsapp-message', 'qr-kind', 'qr-ecc', 'qr-size', 'qr-bar-height', 'qr-margin',
      'qr-foreground', 'qr-background', 'qr-logo-size'
    ];
    liveIds.forEach(function (id) {
      on($(id), 'input', function () { if (isChecked('qr-live')) generate(true); });
      on($(id), 'change', function () { if (isChecked('qr-live')) generate(true); });
    });
    on($('qr-live'), 'change', function () {
      if (isChecked('qr-live') && state.payload) generate(true);
    });
    on($('qr-image-file'), 'change', function () {
      if (isChecked('qr-live') && activeType() === 'image') generate(true);
    });
    on($('qr-logo-file'), 'change', async function () {
      const file = $('qr-logo-file').files && $('qr-logo-file').files[0];
      state.logo = null;
      state.logoData = '';
      if (!file) { if (state.payload) generate(true); return; }
      if (file.size > 2 * 1024 * 1024) {
        status('Logo images must be under 2 MB. Nothing is uploaded.', true);
        $('qr-logo-file').value = '';
        return;
      }
      try {
        state.logoData = await readFile(file, 'dataURL');
        state.logo = await loadImageFromDataUrl(state.logoData);
        status('Logo loaded. It will be overlaid on generated codes.');
        if (state.payload) generate(true);
      } catch (error) { status(error.message, true); }
    });

    on($('image-download'), 'click', async function () {
      if (!state.canvas) { status('Generate a code first.', true); return; }
      try {
        const blob = await canvasToBlob($('image-preview'), 'image/png');
        downloadBlob(blob, state.kind === 'qr' ? 'letitedit-qr.png' : 'letitedit-barcode.png');
        status(state.kind === 'qr' ? 'QR PNG downloaded.' : 'Barcode PNG downloaded.');
      } catch (error) { status(error.message, true); }
    });

    on($('qr-download-svg'), 'click', function () {
      if (!state.svg) { status('Generate a code first.', true); return; }
      downloadBlob(new Blob([state.svg], { type: 'image/svg+xml' }), state.kind === 'qr' ? 'letitedit-qr.svg' : 'letitedit-barcode.svg');
      status(state.kind === 'qr' ? 'QR SVG downloaded.' : 'Barcode SVG downloaded.');
    });

    on($('qr-verify'), 'click', function () {
      if (!state.canvas) { status('Generate a code first.', true); return; }
      if (state.kind !== 'qr') { status('Barcodes need a barcode scanner; QR verification is available here.', true); return; }
      if (typeof window.jsQR !== 'function') { status('The local QR decoder did not load.', true); return; }
      const canvas = $('image-preview');
      const result = window.jsQR(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      if (!result) { status('Verification failed: no QR code could be read from the preview.', true); return; }
      status(result.data === state.payload
        ? 'QR verified: the preview encodes the expected payload.'
        : 'Verification warning: the decoded payload differs from the original.', result.data !== state.payload);
    });

    on($('qr-print'), 'click', function () {
      if (!state.canvas) { status('Generate a code first.', true); return; }
      const preview = $('image-preview');
      const printWindow = window.open('', '_blank');
      if (!printWindow) { status('Printing was blocked by this browser. Download the PNG instead.', true); return; }
      printWindow.document.write('<!doctype html><title>Print code</title><img src="' + preview.toDataURL('image/png') + '">');
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      status('Print dialog opened.');
    });

    on($('qr-reset'), 'click', reset);
    syncType('text', false);
  }

  /* ---------- 13 · Compressor ---------- */
  function compressor() {
    const state = { image: null, url: null, file: null, blob: null, revision: 0 };

    function render() {
      if (!state.image) return;
      const revision = ++state.revision;
      const max = Number($('cmp-max-dimension').value);
      let width = state.image.naturalWidth;
      let height = state.image.naturalHeight;
      if (Number.isFinite(max) && max > 0) {
        const scale = Math.min(1, max / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(state.image, 0, 0, width, height);
      const format = $('cmp-format').value;
      const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
      canvasToBlob(canvas, mime, Number($('cmp-quality').value)).then(function (blob) {
        if (revision !== state.revision) return;
        state.blob = blob;
        const preview = $('image-preview');
        preview.width = width;
        preview.height = height;
        preview.getContext('2d').drawImage(canvas, 0, 0);
        $('cmp-original-size').textContent = ImageCore.formatBytes(state.file.size);
        $('cmp-result-size').textContent = ImageCore.formatBytes(blob.size);
        meta(width + '×' + height + ' · ' + format.toUpperCase());
        setEnabled('image-download', true);
        if (format === 'webp' && blob.type !== 'image/webp') {
          status('This browser saved PNG instead of WebP. Use JPG for guaranteed lossy compression.', true);
        } else {
          status('Re-encoded locally. Compare the byte sizes before downloading.');
        }
      }).catch(function (error) { status(error.message, true); });
    }

    bindUpload(async function (files) {
      const file = requireFile(files);
      if (!file) return;
      try {
        const loaded = await decodeImageFile(file);
        if (state.url) releaseUrl(state.url);
        state.image = loaded.image;
        state.url = loaded.url;
        state.file = file;
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        status('Image loaded. Compression settings are applied automatically.');
        render();
      } catch (error) { status(error.message, true); }
    }, function () {
      state.revision++;
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = state.blob = null;
      $('image-file').value = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      $('cmp-original-size').textContent = '—';
      $('cmp-result-size').textContent = '—';
      meta('No image loaded');
      status('Compressor reset.');
    });

    ['cmp-format', 'cmp-quality', 'cmp-max-dimension'].forEach(function (id) {
      on($(id), 'input', render);
      on($(id), 'change', render);
    });
    on($('cmp-format'), 'change', function () { $('cmp-quality').disabled = $('cmp-format').value === 'png'; });

    on($('image-download'), 'click', function () {
      if (!state.blob) { status('Load an image first.', true); return; }
      const ext = $('cmp-format').value === 'jpeg' ? 'jpg' : $('cmp-format').value;
      downloadBlob(state.blob, safeName(state.file && state.file.name, 'image') + '-compressed.' + ext);
      status('Compressed image downloaded.');
    });
  }

  /* ---------- 14 · Thumbnail generator ---------- */
  function thumbnailGenerator() {
    const PRESETS = {
      youtube: { width: 1280, height: 720, note: 'YouTube thumbnails are 1280×720 px.' },
      shorts: { width: 1080, height: 1920, note: 'YouTube Shorts use a 1080×1920 vertical canvas.' },
      'instagram-post': { width: 1080, height: 1080, note: 'Instagram feed posts are 1080×1080 px.' },
      'instagram-reel': { width: 1080, height: 1920, note: 'Instagram Reels use 1080×1920 px.' },
      'instagram-story': { width: 1080, height: 1920, note: 'Instagram Stories use 1080×1920 px.' },
      tiktok: { width: 1080, height: 1920, note: 'TikTok videos use 1080×1920 px.' },
      'facebook-post': { width: 1200, height: 630, note: 'Facebook link previews use 1200×630 px.' },
      'facebook-cover': { width: 851, height: 315, note: 'Facebook cover photos use 851×315 px.' },
      'facebook-video': { width: 1280, height: 720, note: 'Facebook video previews use 1280×720 px.' },
      'linkedin-post': { width: 1200, height: 627, note: 'LinkedIn shared images use 1200×627 px.' },
      'linkedin-banner': { width: 1584, height: 396, note: 'LinkedIn banners use 1584×396 px.' },
      'x-post': { width: 1200, height: 675, note: 'X / Twitter cards use 1200×675 px.' },
      pinterest: { width: 1000, height: 1500, note: 'Pinterest Pins use 1000×1500 px.' },
      custom: { width: 1280, height: 720, note: 'Custom size. Each edge is limited to 8,000 px.' }
    };
    const FILTERS = {
      none: {},
      vivid: { contrast: 18, saturation: 35 },
      mono: { grayscale: 100, contrast: 15 },
      warm: { temperature: 35, saturation: 12 },
      cool: { temperature: -35, saturation: 8 }
    };

    const state = {
      images: [], layers: [], selectedId: null, history: createHistory(12), drag: null
    };

    function makeLayer(options) {
      const opts = options || {};
      return Object.assign({
        id: 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
        name: 'Layer', type: 'text', text: '', font: 'system-ui, sans-serif', weight: '700',
        size: 92, color: '#ffffff', outline: '#0f172a', outlineWidth: 5, shadow: true,
        align: 'center', rotation: 0, x: 50, y: 50, w: 70, h: 30, imageIndex: -1
      }, opts);
    }

    function selectedLayer() {
      return state.layers.find(function (layer) { return layer.id === state.selectedId; }) || null;
    }

    function snapshot() {
      return {
        images: state.images.map(function (item) {
          return { name: item.file ? item.file.name : 'image.png', src: imageToDataUrl(item.image) };
        }),
        layers: clone(state.layers),
        selectedId: state.selectedId
      };
    }

    function updateHistoryButtons() {
      setEnabled('tg-undo', state.history.canUndo);
      setEnabled('tg-redo', state.history.canRedo);
    }

    function commit() {
      state.history.push(snapshot());
      updateHistoryButtons();
    }

    function syncLayerControls(layer) {
      if (!layer) return;
      if ($('tg-layer-name')) $('tg-layer-name').value = layer.name || '';
      if ($('tg-layer-type')) $('tg-layer-type').value = layer.type || 'text';
      if ($('tg-text')) $('tg-text').value = layer.text || '';
      if ($('tg-font')) $('tg-font').value = (layer.weight || '700') + ' ' + (layer.font || 'system-ui, sans-serif');
      if ($('tg-font-size')) $('tg-font-size').value = String(layer.size || 92);
      if ($('tg-text-color')) $('tg-text-color').value = layer.color || '#ffffff';
      if ($('tg-outline-color')) $('tg-outline-color').value = layer.outline || '#0f172a';
      if ($('tg-outline-width')) $('tg-outline-width').value = String(layer.outlineWidth == null ? 5 : layer.outlineWidth);
      if ($('tg-text-shadow')) $('tg-text-shadow').checked = Boolean(layer.shadow);
      if ($('tg-align')) $('tg-align').value = layer.align || 'center';
      if ($('tg-layer-rotation')) $('tg-layer-rotation').value = String(layer.rotation || 0);
      [['tg-layer-x', layer.x, 50], ['tg-layer-y', layer.y, 50], ['tg-layer-w', layer.w, 70], ['tg-layer-h', layer.h, 30]].forEach(function (item) {
        if ($(item[0])) $(item[0]).value = String(item[1] == null ? item[2] : item[1]);
      });
      bindRangeLabels();
    }

    function selectLayer(id) {
      state.selectedId = id;
      renderLayerList();
      syncLayerControls(selectedLayer());
    }

    function renderLayerList() {
      const list = $('tg-layers');
      if (!list) return;
      list.textContent = '';
      if (!state.layers.length) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'No extra layers yet.';
        list.appendChild(hint);
        return;
      }
      state.layers.forEach(function (layer, index) {
        const row = document.createElement('div');
        row.className = 'pm-order-row' + (layer.id === state.selectedId ? ' is-active' : '');
        const label = document.createElement('span');
        label.textContent = (index + 1) + '. ' + (layer.name || layer.type) + ' — ' + layer.type;
        row.appendChild(label);
        const actions = document.createElement('div');
        actions.className = 'output-actions';
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'btn btn-secondary btn-small';
        load.textContent = 'Load';
        load.setAttribute('aria-label', 'Load ' + (layer.name || layer.type));
        on(load, 'click', function () { selectLayer(layer.id); status('Layer loaded into the controls.'); });
        actions.appendChild(load);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-secondary btn-small';
        remove.textContent = '✕';
        remove.setAttribute('aria-label', 'Delete ' + (layer.name || layer.type));
        on(remove, 'click', function () {
          state.history.push(snapshot());
          state.layers = state.layers.filter(function (item) { return item.id !== layer.id; });
          if (state.selectedId === layer.id) state.selectedId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
          renderLayerList(); syncLayerControls(selectedLayer()); render(); commit();
          status('Layer deleted.');
        });
        actions.appendChild(remove);
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    function readLayer() {
      const fontValue = val('tg-font', '700 system-ui, sans-serif');
      const weightMatch = fontValue.match(/^(\d+)\s+(.+)$/);
      const current = selectedLayer();
      return {
        id: current ? current.id : makeLayer().id,
        name: val('tg-layer-name', 'Layer') || 'Layer',
        type: val('tg-layer-type', 'text'),
        text: val('tg-text', ''),
        font: weightMatch ? weightMatch[2] : fontValue,
        weight: weightMatch ? weightMatch[1] : '700',
        size: ImageCore.clampInt(val('tg-font-size', 92), 8, 500, 92),
        color: val('tg-text-color', '#ffffff'),
        outline: val('tg-outline-color', '#0f172a'),
        outlineWidth: Number(val('tg-outline-width', 5)),
        shadow: isChecked('tg-text-shadow'),
        align: val('tg-align', 'center'),
        rotation: Number(val('tg-layer-rotation', 0)),
        x: Number(val('tg-layer-x', 50)),
        y: Number(val('tg-layer-y', 50)),
        w: Number(val('tg-layer-w', 70)),
        h: Number(val('tg-layer-h', 30)),
        imageIndex: current ? current.imageIndex : -1
      };
    }

    function adjustedImageCanvas(layer, width, height) {
      const source = state.images[layer.imageIndex];
      if (!source) return null;
      const brightness = Number(val('tg-brightness', 100)) - 100;
      const contrast = Number(val('tg-contrast', 100)) - 100;
      const saturation = Number(val('tg-saturation', 100)) - 100;
      const blur = Math.round(ImageCore.clampInt(val('tg-blur', 0), 0, 12, 0) / 2);
      const filter = FILTERS[val('tg-filter', 'none')] || {};
      const removeBg = isChecked('tg-remove-bg');
      const tolerance = val('tg-bg-tolerance', 45);
      const key = [brightness, contrast, saturation, blur, val('tg-filter', 'none'), removeBg, tolerance].join('|');
      if (layer._cacheKey === key && layer._cacheCanvas) return layer._cacheCanvas;
      let data = ImageCore.adjustImageData(imageDataFromImage(source.image), Object.assign({
        brightness: brightness, contrast: contrast, saturation: saturation
      }, filter));
      if (blur) data = ImageCore.boxBlur(data, blur);
      if (removeBg) data = ImageCore.removeBackground(data, tolerance, 45);
      const canvas = document.createElement('canvas');
      setCanvasImageData(canvas, data);
      layer._cacheKey = key;
      layer._cacheCanvas = canvas;
      return canvas;
    }

    function drawGuides(ctx, width, height) {
      ctx.save();
      ctx.strokeStyle = 'rgba(37,99,235,.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 8]);
      [1 / 3, 2 / 3].forEach(function (part) {
        ctx.beginPath(); ctx.moveTo(width * part, 0); ctx.lineTo(width * part, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, height * part); ctx.lineTo(width, height * part); ctx.stroke();
      });
      ctx.restore();
    }

    function render() {
      const width = ImageCore.clampInt(val('tg-width', 1280), 64, 8000, 1280);
      const height = ImageCore.clampInt(val('tg-height', 720), 64, 8000, 720);
      const limit = ImageCore.withinLimits(0, width, height);
      if (limit) { status(limit, true); return; }
      const canvas = $('image-preview');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      const bgType = val('tg-bg-type', 'gradient');
      if (bgType === 'solid') {
        ctx.fillStyle = val('tg-color1', '#0f172a');
        ctx.fillRect(0, 0, width, height);
      } else if (bgType === 'gradient') {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, val('tg-color1', '#0f172a'));
        gradient.addColorStop(1, val('tg-color2', '#2563eb'));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      const padding = ImageCore.clampInt(val('tg-padding', 40), 0, 200, 40);
      const radius = ImageCore.clampInt(val('tg-radius', 18), 0, 120, 18);
      const shadow = ImageCore.clampInt(val('tg-shadow', 35), 0, 100, 35);

      state.layers.forEach(function (layer) {
        if (layer.type === 'text') {
          drawTextLayer(ctx, Object.assign({}, layer, { maxWidth: layer.w }), width, height);
          return;
        }
        const x = width * Number(layer.x || 0) / 100;
        const y = height * Number(layer.y || 0) / 100;
        const boxW = Math.max(1, width * Number(layer.w || 50) / 100);
        const boxH = Math.max(1, height * Number(layer.h || 30) / 100);
        ctx.save();
        ctx.translate(x, y);
        if (layer.rotation) ctx.rotate(layer.rotation * Math.PI / 180);
        if (layer.shadow && shadow) {
          ctx.shadowColor = 'rgba(15,23,42,' + (shadow / 100) + ')';
          ctx.shadowBlur = shadow / 2;
          ctx.shadowOffsetY = shadow / 10;
        }
        if (layer.type === 'image') {
          const source = adjustedImageCanvas(layer, width, height);
          if (!source) { ctx.restore(); return; }
          const inset = Math.min(padding, boxW / 3, boxH / 3);
          const targetW = Math.max(1, boxW - inset * 2);
          const targetH = Math.max(1, boxH - inset * 2);
          const scale = Math.min(targetW / source.width, targetH / source.height);
          const drawW = source.width * scale;
          const drawH = source.height * scale;
          ctx.save();
          roundedRectPath(ctx, -targetW / 2, -targetH / 2, targetW, targetH, radius);
          ctx.clip();
          ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        } else if (layer.type === 'shape') {
          drawShape(ctx, layer.text || 'rectangle', 0, 0, Math.min(boxW, boxH), layer.color || '#2563eb');
        } else if (layer.type === 'sticker') {
          drawShape(ctx, layer.text || '★', 0, 0, Math.min(boxW, boxH), layer.color || '#ffffff');
        }
        ctx.restore();
      });
      if (isChecked('tg-guides')) drawGuides(ctx, width, height);
      meta(width + '×' + height + ' · ' + state.layers.length + ' layer' + (state.layers.length === 1 ? '' : 's'));
      setEnabled('image-download', true);
    }

    function applyPreset(key) {
      const preset = PRESETS[key] || PRESETS.youtube;
      if ($('tg-width')) $('tg-width').value = String(preset.width);
      if ($('tg-height')) $('tg-height').value = String(preset.height);
      const note = $('tg-preset-note');
      if (note) note.textContent = preset.note;
      render();
      status('Canvas set to ' + preset.width + '×' + preset.height + '.');
    }

    function addTemplate(kind) {
      state.history.push(snapshot());
      if (kind === 'bold') {
        state.layers.push(makeLayer({ name: 'Bold headline', type: 'text', text: 'BOLD\nHEADLINE', size: 110, x: 50, y: 72, w: 88, h: 36, color: '#ffffff' }));
        state.layers.push(makeLayer({ name: 'Accent', type: 'shape', text: 'rectangle', x: 12, y: 18, w: 12, h: 8, color: '#f97316' }));
      } else if (kind === 'quote') {
        state.layers.push(makeLayer({ name: 'Quote', type: 'text', text: '“Your big idea here”', size: 72, x: 50, y: 50, w: 78, h: 32, font: 'Georgia, serif' }));
        state.layers.push(makeLayer({ name: 'Quote mark', type: 'sticker', text: '★', x: 50, y: 18, w: 14, h: 14, color: '#fbbf24' }));
      } else if (kind === 'badge') {
        state.layers.push(makeLayer({ name: 'Sale badge', type: 'shape', text: 'circle', x: 78, y: 24, w: 26, h: 26, color: '#ef4444' }));
        state.layers.push(makeLayer({ name: 'Sale text', type: 'text', text: 'SALE', size: 54, x: 78, y: 24, w: 22, h: 12, color: '#ffffff' }));
      } else if (kind === 'split') {
        if (state.images.length >= 2) {
          state.layers.push(makeLayer({ name: 'Left photo', type: 'image', imageIndex: 0, x: 26, y: 50, w: 48, h: 86 }));
          state.layers.push(makeLayer({ name: 'Right photo', type: 'image', imageIndex: 1, x: 74, y: 50, w: 48, h: 86 }));
        } else {
          state.layers.push(makeLayer({ name: 'Left panel', type: 'shape', text: 'rectangle', x: 26, y: 50, w: 48, h: 86, color: '#1d4ed8' }));
          state.layers.push(makeLayer({ name: 'Right panel', type: 'shape', text: 'rectangle', x: 74, y: 50, w: 48, h: 86, color: '#0f172a' }));
        }
      }
      const newest = state.layers[state.layers.length - 1];
      if (newest) selectLayer(newest.id);
      renderLayerList(); render(); commit();
      status('Template "' + kind + '" applied.');
    }

    function alignSelected(direction) {
      const layer = selectedLayer();
      if (!layer) { status('Select a layer first.', true); return; }
      state.history.push(snapshot());
      if (direction === 'left') layer.x = Math.min(100, Number(layer.w) / 2);
      if (direction === 'center') layer.x = 50;
      if (direction === 'right') layer.x = Math.max(0, 100 - Number(layer.w) / 2);
      if (direction === 'top') layer.y = Math.min(100, Number(layer.h) / 2);
      if (direction === 'middle') layer.y = 50;
      if (direction === 'bottom') layer.y = Math.max(0, 100 - Number(layer.h) / 2);
      syncLayerControls(layer); renderLayerList(); render(); commit();
      status('Layer aligned ' + direction + '.');
    }

    async function restore(data) {
      if (!data) return;
      try {
        state.images.forEach(function (item) { if (item.url) releaseUrl(item.url); });
        const images = [];
        for (const saved of data.images || []) {
          const image = await loadImageFromDataUrl(saved.src);
          images.push({ image: image, url: null, file: { name: saved.name || 'image.png' } });
        }
        state.images = images;
        state.layers = clone(data.layers || []);
        state.selectedId = data.selectedId;
        renderLayerList(); syncLayerControls(selectedLayer()); updateHistoryButtons(); render();
        status('Thumbnail history restored.');
      } catch (error) { status(error.message, true); }
    }

    function clearImages() {
      state.images.forEach(function (item) { if (item.url) releaseUrl(item.url); });
      state.images = [];
      state.layers = state.layers.filter(function (layer) { return layer.type !== 'image'; });
      state.layers.forEach(function (layer) { layer._cacheKey = null; layer._cacheCanvas = null; });
      if (!state.layers.some(function (layer) { return layer.id === state.selectedId; })) state.selectedId = state.layers.length ? state.layers[0].id : null;
    }

    function reset(initial) {
      state.images.forEach(function (item) { if (item.url) releaseUrl(item.url); });
      state.images = [];
      const title = makeLayer({ name: 'Headline', type: 'text', text: 'YOUR HEADLINE', x: 50, y: 78, w: 86, h: 28, size: 96 });
      state.layers = [title];
      state.selectedId = title.id;
      state.history.entries = [];
      state.history.index = -1;
      state.history.push(snapshot());
      if ($('image-file')) $('image-file').value = '';
      if ($('tg-width')) $('tg-width').value = '1280';
      if ($('tg-height')) $('tg-height').value = '720';
      if ($('tg-preset')) $('tg-preset').value = 'youtube';
      const note = $('tg-preset-note');
      if (note) note.textContent = PRESETS.youtube.note;
      renderLayerList(); syncLayerControls(title); updateHistoryButtons(); bindRangeLabels(); render();
      status(initial ? 'Thumbnail generator ready. Add a photo or edit the headline.' : 'Thumbnail reset.');
    }

    bindUpload(async function (files) {
      if (!files.length) { status('Choose an image first.', true); return; }
      if (files.length > 8) { status('Choose up to eight photo layers at once.', true); return; }
      clearImages();
      try {
        for (const file of files) {
          const loaded = await decodeImageFile(file);
          const index = state.images.push({ image: loaded.image, url: loaded.url, file: file }) - 1;
          state.layers.push(makeLayer({
            name: file.name, type: 'image', imageIndex: index, text: file.name, x: 50, y: 50, w: 70, h: 76
          }));
        }
        state.selectedId = state.layers[state.layers.length - 1].id;
        state.history.push(snapshot());
        renderLayerList(); syncLayerControls(selectedLayer()); updateHistoryButtons(); render();
        status('Loaded ' + files.length + ' photo layer' + (files.length === 1 ? '' : 's') + '. Drag them on the preview.');
      } catch (error) { status(error.message, true); }
    }, function () { reset(false); });

    [['tg-layer-add', function () {
      state.history.push(snapshot());
      const layer = readLayer();
      layer.id = makeLayer().id;
      layer.imageIndex = -1;
      state.layers.push(layer);
      selectLayer(layer.id); render(); commit();
      status('Layer added.');
    }], ['tg-layer-update', function () {
      const layer = selectedLayer();
      if (!layer) { status('Select a layer first.', true); return; }
      state.history.push(snapshot());
      const updated = readLayer();
      updated.id = layer.id;
      updated.imageIndex = layer.imageIndex;
      state.layers[state.layers.indexOf(layer)] = updated;
      renderLayerList(); render(); commit();
      status('Layer updated.');
    }], ['tg-layer-duplicate', function () {
      const layer = selectedLayer();
      if (!layer) { status('Select a layer first.', true); return; }
      state.history.push(snapshot());
      const copy = clone(layer);
      copy.id = makeLayer().id;
      copy.name = (layer.name || 'Layer') + ' copy';
      copy.x = Math.min(100, Number(copy.x) + 4);
      copy.y = Math.min(100, Number(copy.y) + 4);
      delete copy._cacheKey; delete copy._cacheCanvas;
      state.layers.push(copy);
      selectLayer(copy.id); render(); commit();
      status('Layer duplicated.');
    }], ['tg-layer-delete', function () {
      const layer = selectedLayer();
      if (!layer) { status('Select a layer first.', true); return; }
      state.history.push(snapshot());
      state.layers = state.layers.filter(function (item) { return item.id !== layer.id; });
      state.selectedId = state.layers.length ? state.layers[state.layers.length - 1].id : null;
      renderLayerList(); syncLayerControls(selectedLayer()); render(); commit();
      status('Layer deleted.');
    }], ['tg-undo', function () {
      const previous = state.history.undo();
      if (previous) restore(previous); else status('Nothing to undo.', true);
    }], ['tg-redo', function () {
      const next = state.history.redo();
      if (next) restore(next); else status('Nothing to redo.', true);
    }]].forEach(function (item) { on($(item[0]), 'click', item[1]); });

    [['tg-align-left', 'left'], ['tg-align-center', 'center'], ['tg-align-right', 'right'],
      ['tg-align-top', 'top'], ['tg-align-middle', 'middle'], ['tg-align-bottom', 'bottom']]
      .forEach(function (item) { on($(item[0]), 'click', function () { alignSelected(item[1]); }); });

    on($('tg-preset'), 'change', function () { applyPreset($('tg-preset').value); });
    all('#tg-preset-chips [data-value]').forEach(function (chip) {
      on(chip, 'click', function () {
        if ($('tg-preset')) $('tg-preset').value = chip.dataset.value;
        applyPreset(chip.dataset.value);
        all('#tg-preset-chips .chip').forEach(function (other) { other.classList.toggle('is-active', other === chip); });
      });
    });
    all('#tg-templates [data-value]').forEach(function (chip) {
      on(chip, 'click', function () { addTemplate(chip.dataset.value); });
    });
    all('#tg-stickers [data-value]').forEach(function (chip) {
      on(chip, 'click', function () {
        state.history.push(snapshot());
        state.layers.push(makeLayer({ name: 'Sticker ' + chip.dataset.value, type: 'sticker', text: chip.dataset.value, x: 80, y: 20, w: 14, h: 14, size: 60 }));
        renderLayerList(); render(); commit();
        status('Sticker added. Drag it into place.');
      });
    });

    const renderControls = ['tg-width', 'tg-height', 'tg-bg-type', 'tg-color1', 'tg-color2', 'tg-padding',
      'tg-radius', 'tg-shadow', 'tg-guides', 'tg-brightness', 'tg-contrast', 'tg-saturation', 'tg-blur',
      'tg-filter', 'tg-remove-bg', 'tg-bg-tolerance'];
    renderControls.forEach(function (id) {
      on($(id), 'input', function () {
        state.layers.forEach(function (layer) { layer._cacheKey = null; layer._cacheCanvas = null; });
        render();
      });
      on($(id), 'change', function () {
        state.layers.forEach(function (layer) { layer._cacheKey = null; layer._cacheCanvas = null; });
        render();
      });
    });
    const layerControls = ['tg-layer-type', 'tg-text', 'tg-font', 'tg-font-size', 'tg-text-color',
      'tg-outline-color', 'tg-outline-width', 'tg-text-shadow', 'tg-align', 'tg-layer-rotation',
      'tg-layer-x', 'tg-layer-y', 'tg-layer-w', 'tg-layer-h'];
    layerControls.forEach(function (id) {
      on($(id), 'input', function () {
        const layer = selectedLayer();
        if (!layer) return;
        const updated = readLayer();
        Object.assign(layer, updated, { id: layer.id, imageIndex: layer.imageIndex });
        if ($('tg-layer-name')) $('tg-layer-name').value = layer.name;
        renderLayerList(); render();
      });
      on($(id), 'change', function () {
        const layer = selectedLayer();
        if (!layer) return;
        const updated = readLayer();
        Object.assign(layer, updated, { id: layer.id, imageIndex: layer.imageIndex });
        renderLayerList(); render();
      });
    });
    on($('tg-layer-name'), 'input', function () {
      const layer = selectedLayer();
      if (layer) { layer.name = $('tg-layer-name').value || 'Layer'; renderLayerList(); }
    });

    const canvas = $('image-preview');
    if (canvas) {
      canvas.style.touchAction = 'none';
      function pointerPosition(event) {
        const rect = canvas.getBoundingClientRect();
        return {
          x: (event.clientX - rect.left) / (rect.width || 1) * canvas.width,
          y: (event.clientY - rect.top) / (rect.height || 1) * canvas.height
        };
      }
      function layerAt(point) {
        for (let i = state.layers.length - 1; i >= 0; i--) {
          const layer = state.layers[i];
          const x = canvas.width * Number(layer.x || 0) / 100;
          const y = canvas.height * Number(layer.y || 0) / 100;
          const w = Math.max(12, canvas.width * Number(layer.w || 10) / 100);
          const h = Math.max(12, canvas.height * Number(layer.h || 10) / 100);
          if (point.x >= x - w / 2 && point.x <= x + w / 2 && point.y >= y - h / 2 && point.y <= y + h / 2) return layer;
        }
        return null;
      }
      on(canvas, 'pointerdown', function (event) {
        const point = pointerPosition(event);
        const layer = layerAt(point);
        if (!layer) return;
        selectLayer(layer.id);
        state.drag = {
          layer: layer,
          offsetX: point.x - canvas.width * Number(layer.x) / 100,
          offsetY: point.y - canvas.height * Number(layer.y) / 100
        };
        if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      on(canvas, 'pointermove', function (event) {
        if (!state.drag) return;
        const point = pointerPosition(event);
        const layer = state.drag.layer;
        layer.x = Math.max(0, Math.min(100, (point.x - state.drag.offsetX) / canvas.width * 100));
        layer.y = Math.max(0, Math.min(100, (point.y - state.drag.offsetY) / canvas.height * 100));
        syncLayerControls(layer); render();
        event.preventDefault();
      });
      function endDrag() { state.drag = null; }
      on(canvas, 'pointerup', endDrag);
      on(canvas, 'pointercancel', endDrag);
      on(canvas, 'lostpointercapture', endDrag);
    }

    on($('image-download'), 'click', async function () {
      if (!$('image-preview').width) { status('Generate a thumbnail first.', true); return; }
      const format = val('tg-format', 'png');
      const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
      try {
        const blob = await canvasToBlob($('image-preview'), mime, Number(val('tg-quality', 0.92)));
        downloadBlob(blob, 'letitedit-thumbnail.' + (format === 'jpeg' ? 'jpg' : format));
        status('Thumbnail downloaded.');
      } catch (error) { status(error.message, true); }
    });

    reset(true);
  }

  const MODULES = {
    'image-editor': imageEditor,
    'heic-viewer': heicViewer,
    'add-border-to-image': borderTool,
    'photo-merger': photoMerger,
    'screenshot-beautifier': screenshotBeautifier,
    'black-and-white-image-converter': blackAndWhite,
    'image-flip-rotate': flipRotate,
    'image-resizer': resizer,
    'image-to-svg': imageToSvg,
    'image-inverter': inverter,
    'image-to-text': ocrTool,
    'qr-code-generator': qrGenerator,
    'thumbnail-generator': thumbnailGenerator,
    'image-compressor': compressor
  };

  ready(function () {
    bindRangeLabels();
    bindQualityToggles();
    const configNode = $('tool-config');
    if (!configNode) return;
    let config = {};
    try { config = JSON.parse(configNode.textContent); }
    catch (error) { status('The tool configuration could not be read.', true); return; }
    const module = config.slug && MODULES[config.slug];
    if (!module) return;
    try { module(); }
    catch (error) { status('The tool could not start: ' + error.message, true); }
  });
})();
