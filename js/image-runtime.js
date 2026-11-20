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
    const state = { image: null, url: null, file: null };

    function wrapLines(ctx, text, maxWidth) {
      const lines = [];
      String(text).split(/\r?\n/).forEach(function (paragraph) {
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

    function filterText() {
      return 'brightness(' + $('ie-brightness').value + '%) contrast(' + $('ie-contrast').value + '%) ' +
        'saturate(' + $('ie-saturation').value + '%) blur(' + $('ie-blur').value + 'px) ' +
        'grayscale(' + $('ie-grayscale').value + '%) sepia(' + $('ie-sepia').value + '%)';
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
      ctx.save();
      ctx.filter = filterText();
      ctx.drawImage(state.image, 0, 0, w, h);
      ctx.restore();
      const text = $('ie-text').value.trim();
      if (text) {
        /* Size is a percentage of the image width so the caption stays
         * readable on both small screenshots and high-resolution photos. */
        const percent = ImageCore.clampInt($('ie-text-size').value, 1, 20, 5);
        const size = Math.max(12, Math.round(w * percent / 100));
        const maxTextWidth = w * 0.86;
        ctx.save();
        ctx.font = '700 ' + size + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const lines = wrapLines(ctx, text, maxTextWidth);
        const lineHeight = size * 1.2;
        const blockHeight = lines.length * lineHeight;
        const x = Number($('ie-text-x').value) / 100 * w;
        const y = Number($('ie-text-y').value) / 100 * h;
        const firstLineY = y - blockHeight / 2 + lineHeight / 2;

        if ($('ie-text-bg').checked) {
          const widest = lines.reduce(function (max, line) {
            return Math.max(max, ctx.measureText(line).width);
          }, 0);
          const boxW = Math.min(w - 8, widest + size * 0.8);
          const boxH = blockHeight + size * 0.5;
          const boxX = Math.min(Math.max(x - boxW / 2, 4), w - boxW - 4);
          const boxY = Math.min(Math.max(y - boxH / 2, 4), h - boxH - 4);
          ctx.fillStyle = 'rgba(15,23,42,.58)';
          roundedRectPath(ctx, boxX, boxY, boxW, boxH, size * 0.35);
          ctx.fill();
        }

        ctx.lineWidth = Math.max(2, size / 10);
        ctx.strokeStyle = 'rgba(15,23,42,.75)';
        ctx.fillStyle = $('ie-text-color').value;
        lines.forEach(function (line, index) {
          const lineY = firstLineY + index * lineHeight;
          ctx.strokeText(line, x, lineY, maxTextWidth);
          ctx.fillText(line, x, lineY, maxTextWidth);
        });
        ctx.restore();
      }
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
      return ImageCore.cropRect(state.image.naturalWidth, state.image.naturalHeight, {
        x: $('ie-crop-x').value, y: $('ie-crop-y').value,
        w: $('ie-crop-w').value, h: $('ie-crop-h').value
      });
    }

    function setCropToFull() {
      const w = state.image.naturalWidth;
      const h = state.image.naturalHeight;
      [['ie-crop-x', 0, w - 1, 0], ['ie-crop-y', 0, h - 1, 0],
       ['ie-crop-w', 1, w, w], ['ie-crop-h', 1, h, h]].forEach(function (item) {
        const input = $(item[0]);
        input.min = String(item[1]);
        input.max = String(item[2]);
        input.value = String(item[3]);
      });
      bindRangeLabels();
    }

    function resetAdjustments() {
      [['ie-brightness', 100], ['ie-contrast', 100], ['ie-saturation', 100], ['ie-blur', 0],
       ['ie-grayscale', 0], ['ie-sepia', 0]].forEach(function (item) { $(item[0]).value = String(item[1]); });
      bindRangeLabels();
    }

    async function bakeBase(transform) {
      if (!state.image) { status('Load an image first.', true); return; }
      const copy = document.createElement('canvas');
      copy.width = state.image.naturalWidth;
      copy.height = state.image.naturalHeight;
      copy.getContext('2d').drawImage(state.image, 0, 0);
      let result = imageDataFromImage(state.image);
      if (transform === 'left') result = ImageCore.rotate90(result, 'left');
      if (transform === 'right') result = ImageCore.rotate90(result, 'right');
      if (transform === 'horizontal') result = ImageCore.flip(result, 'horizontal');
      if (transform === 'vertical') result = ImageCore.flip(result, 'vertical');
      if (transform === 'crop') {
        const crop = currentCrop();
        const cropped = document.createElement('canvas');
        cropped.width = crop.w;
        cropped.height = crop.h;
        cropped.getContext('2d').drawImage(copy, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        result = cropped.getContext('2d').getImageData(0, 0, crop.w, crop.h);
      }
      const next = await imageFromCanvas(canvasFromImageData(result));
      if (state.url) releaseUrl(state.url);
      state.image = next;
      state.url = null;
      resetAdjustments();
      setCropToFull();
      meta(next.naturalWidth + '×' + next.naturalHeight);
      status('Edit applied.');
      draw(true);
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
        resetAdjustments();
        setCropToFull();
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        status('Image loaded. Adjust the crop and controls on the left.');
        draw(true);
      } catch (error) { status(error.message, true); }
    }, function () {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = null;
      resetAdjustments();
      [['ie-crop-x', 0], ['ie-crop-y', 0], ['ie-crop-w', 100], ['ie-crop-h', 100],
       ['ie-text', ''], ['ie-text-size', 5], ['ie-text-x', 50], ['ie-text-y', 85]].forEach(function (item) {
        $(item[0]).value = String(item[1]);
      });
      $('ie-text-bg').checked = true;
      bindRangeLabels();
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      meta('No image loaded');
      status('Editor reset.');
    });

    ['ie-brightness', 'ie-contrast', 'ie-saturation', 'ie-blur', 'ie-grayscale', 'ie-sepia',
     'ie-text', 'ie-text-size', 'ie-text-color', 'ie-text-bg', 'ie-text-x', 'ie-text-y',
     'ie-crop-x', 'ie-crop-y', 'ie-crop-w', 'ie-crop-h'].forEach(function (id) {
      on($(id), 'input', function () { draw(true); });
      on($(id), 'change', function () { draw(true); });
    });

    on($('ie-crop-apply'), 'click', function () { bakeBase('crop'); });
    on($('ie-rot-left'), 'click', function () { bakeBase('left'); });
    on($('ie-rot-right'), 'click', function () { bakeBase('right'); });
    on($('ie-flip-h'), 'click', function () { bakeBase('horizontal'); });
    on($('ie-flip-v'), 'click', function () { bakeBase('vertical'); });
    on($('ie-adjust-reset'), 'click', function () { resetAdjustments(); draw(true); status('Adjustments reset.'); });

    on($('image-download'), 'click', async function () {
      if (!state.image || !$('image-preview').width) { status('Load an image first.', true); return; }
      draw(false);
      const format = $('ie-format').value;
      const mime = 'image/' + (format === 'jpeg' ? 'jpeg' : format);
      try {
        const blob = await canvasToBlob($('image-preview'), mime, Number($('ie-quality').value));
        downloadBlob(blob, safeName(state.file && state.file.name, 'image') + '-edited.' + (format === 'jpeg' ? 'jpg' : format));
        draw(true);
        status('Edited image downloaded.');
      } catch (error) { status(error.message, true); }
    });
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

    function showSelected(index) {
      const item = state.items[index];
      if (!item) return;
      state.selected = index;
      const canvas = $('image-preview');
      canvas.width = item.canvas.width;
      canvas.height = item.canvas.height;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      canvas.getContext('2d').drawImage(item.canvas, 0, 0);
      meta((index + 1) + ' of ' + state.items.length + ' · ' + canvas.width + '×' + canvas.height);
      status('Previewing ' + item.name + '.');
      setEnabled('image-download', true);
      all('#heic-gallery button[data-heic-index]').forEach(function (button) {
        button.classList.toggle('is-active', Number(button.dataset.heicIndex) === index);
      });
    }

    function addGalleryItem(item, index) {
      const gallery = $('heic-gallery');
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
      detail.textContent = item.canvas.width + '×' + item.canvas.height;
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
      $('heic-gallery').textContent = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      setEnabled('heic-download-all', false);
      const input = $('image-file');
      if (input) input.value = '';
      meta('0 decoded');
      status('HEIC viewer reset.');
    }

    bindUpload(async function (files) {
      if (!files.length) { status('Choose one or more HEIC files.', true); return; }
      if (files.length > 12) { status('Please choose no more than 12 files at once.', true); return; }
      reset();
      try {
        const api = await getDecoder();
        const failures = [];
        for (const file of files) {
          const validName = /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
          const validType = !file.type || /heic|heif|image/i.test(file.type);
          if (!validName || !validType) {
            failures.push(file.name + ': not a HEIC or HEIF file');
            continue;
          }
          try {
            if (file.size > ImageCore.MAX_FILE_BYTES) throw new Error('file exceeds the 50 MB limit');
            const bytes = new Uint8Array(await readFile(file));
            const decoded = new api.HeifDecoder().decode(bytes);
            if (!decoded || !decoded.length) throw new Error('no image variants found');
            for (let variant = 0; variant < decoded.length; variant++) {
              const image = decoded[variant];
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
                  ctx.putImageData(imageData, 0, 0);
                  const item = { canvas: canvas, name: file.name + (decoded.length > 1 ? ' #' + (variant + 1) : ''), file: file };
                  const index = state.items.push(item) - 1;
                  addGalleryItem(item, index);
                  resolve();
                });
              });
            }
          } catch (error) { failures.push(file.name + ': ' + error.message); }
        }
        if (!state.items.length) {
          status('No images could be decoded. ' + failures.join('; '), true);
          meta('0 decoded');
          return;
        }
        meta(state.items.length + ' decoded');
        showSelected(0);
        status(failures.length ? 'Decoded ' + state.items.length + ' image(s). Failures: ' + failures.join('; ') : 'Decoded ' + state.items.length + ' image(s).', Boolean(failures.length));
        setEnabled('heic-download-all', true);
      } catch (error) { status(error.message, true); }
    }, reset);

    async function downloadItem(item) {
      const format = $('heic-format').value;
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = 0.92;
      const blob = await canvasToBlob(item.canvas, mime, quality);
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

    function render() {
      if (!state.items.length) return;
      const horizontal = document.querySelector('input[name="pm-direction"]:checked').value === 'horizontal';
      const gap = ImageCore.clampInt($('pm-spacing').value, 0, 100, 12);
      const background = $('pm-bg').value;
      const widths = state.items.map(function (item) { return item.image.naturalWidth; });
      const heights = state.items.map(function (item) { return item.image.naturalHeight; });
      const width = horizontal ? widths.reduce(function (a, b) { return a + b; }, 0) + gap * (state.items.length - 1) : Math.max.apply(null, widths);
      const height = horizontal ? Math.max.apply(null, heights) : heights.reduce(function (a, b) { return a + b; }, 0) + gap * (state.items.length - 1);
      const limit = ImageCore.withinLimits(0, width, height);
      if (limit) { status(limit, true); return; }
      const canvas = $('image-preview');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      let offset = 0;
      state.items.forEach(function (item, index) {
        if (horizontal) {
          const y = Math.round((height - item.image.naturalHeight) / 2);
          ctx.drawImage(item.image, offset, y);
          offset += item.image.naturalWidth + gap;
        } else {
          const x = Math.round((width - item.image.naturalWidth) / 2);
          ctx.drawImage(item.image, x, offset);
          offset += item.image.naturalHeight + gap;
        }
      });
      meta(width + '×' + height + ' · ' + state.items.length + ' photo' + (state.items.length === 1 ? '' : 's'));
      setEnabled('image-download', true);
      status('Merged ' + state.items.length + ' photo(s).');
    }

    function reset() {
      state.items.forEach(function (item) { releaseUrl(item.url); });
      state.items = [];
      $('image-file').value = '';
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
    on($('pm-spacing'), 'input', render);
    on($('pm-bg'), 'input', render);
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
    const state = { image: null, url: null, file: null, worker: null, workerPromise: null, busy: false };

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
        /* Tesseract 5 sends logger events through the worker's postMessage
         * channel. The callback must be part of createWorker options; passing
         * it to recognize() would try to clone a function into the worker. */
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
        $('ocr-output').value = '';
        meta(loaded.image.naturalWidth + '×' + loaded.image.naturalHeight);
        setEnabled('ocr-extract', true);
        status('Image loaded. Recognition is ready.');
      } catch (error) { status(error.message, true); }
    }, function () {
      if (state.url) releaseUrl(state.url);
      state.image = state.url = state.file = null;
      $('image-file').value = '';
      $('ocr-output').value = '';
      clearCanvas($('image-preview'));
      setEnabled('ocr-extract', false);
      meta('No image loaded');
      status('OCR reset.');
    });

    on($('ocr-extract'), 'click', async function () {
      if (!state.image) { status('Load an image first.', true); return; }
      if (state.busy) return;
      state.busy = true;
      setEnabled('ocr-extract', false);
      try {
        const worker = await getWorker();
        const result = await worker.recognize(state.image);
        const text = (result && result.data && result.data.text ? result.data.text : '').trim();
        $('ocr-output').value = text;
        setEnabled('ocr-copy', Boolean(text));
        setEnabled('ocr-download', Boolean(text));
        status(text ? 'Recognition finished. Review the text before copying.' : 'Recognition finished, but no text was found.', !text);
      } catch (error) { status('Recognition failed: ' + error.message, true); }
      state.busy = false;
      setEnabled('ocr-extract', true);
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
    const state = { qr: null, canvas: null, svg: null, payload: '' };

    function reset() {
      state.qr = state.canvas = state.svg = state.payload = null;
      $('qr-text').value = '';
      $('qr-image-file').value = '';
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      setEnabled('qr-download-svg', false);
      meta('No QR code generated');
      status('QR generator reset.');
    }

    function clearResult() {
      state.qr = state.canvas = state.svg = state.payload = null;
      clearCanvas($('image-preview'));
      setEnabled('image-download', false);
      setEnabled('qr-download-svg', false);
      meta('No QR code generated');
    }

    function build(payload, ecc) {
      if (typeof window.qrcode !== 'function') throw new Error('The local QR encoder did not load.');
      const qr = window.qrcode(0, ecc);
      qr.addData(payload);
      qr.make();
      return qr;
    }

    function draw(qr) {
      const cell = ImageCore.clampInt($('qr-size').value, 2, 16, 8);
      const margin = ImageCore.clampInt($('qr-margin').value, 2, 8, 4);
      const count = qr.getModuleCount();
      const size = (count + margin * 2) * cell;
      const canvas = $('image-preview');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = $('qr-background').value;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = $('qr-foreground').value;
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) ctx.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
        }
      }
      return { canvas: canvas, cell: cell, margin: margin, count: count };
    }

    function makeSvg(qr, margin) {
      const foreground = $('qr-foreground').value;
      const background = $('qr-background').value;
      const count = qr.getModuleCount();
      const size = count + margin * 2;
      let path = '';
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) path += 'M' + (col + margin) + ' ' + (row + margin) + 'h1v1h-1z';
        }
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' +
        '<rect width="' + size + '" height="' + size + '" fill="' + background + '"/>' +
        '<path d="' + path + '" fill="' + foreground + '"/></svg>';
    }

    on($('qr-generate'), 'click', async function () {
      const isImage = document.querySelector('input[name="qr-mode"]:checked').value === 'image';
      let payload = '';
      clearResult();
      try {
        if (isImage) {
          const file = $('qr-image-file').files && $('qr-image-file').files[0];
          if (!file) { status('Choose an image for image mode, or switch to text mode.', true); return; }
          if (file.size > 2 * 1024 * 1024) {
            status('This image is too large to fit a QR code. Host it at a public URL and use Text or URL mode. LetitEdit does not upload images.', true);
            return;
          }
          payload = await readFile(file, 'dataURL');
        } else {
          payload = $('qr-text').value.trim();
          if (!payload) { status('Enter the text or URL you want to encode.', true); return; }
        }
        state.qr = build(payload, $('qr-ecc').value);
        state.canvas = draw(state.qr);
        state.svg = makeSvg(state.qr, state.canvas.margin);
        state.payload = payload;
        meta(state.qr.getModuleCount() + '×' + state.qr.getModuleCount() + ' modules');
        setEnabled('image-download', true);
        setEnabled('qr-download-svg', true);
        status('QR code generated. Scan it with your phone before downloading.', Boolean(isImage && payload.length > 1200));
        if (isImage && payload.length > 1200) {
          status('The image data URL is close to QR capacity. Scan carefully or use a hosted URL instead.', true);
        }
      } catch (error) {
        const message = isImage
          ? 'This image data URL is too large for a QR code at that error-correction level. Host the image at a public URL and use Text or URL mode. LetitEdit never uploads private images.'
          : 'That content is too long for a QR code at this error-correction level. Shorten it or choose Low error correction.';
        status(message, true);
        clearResult();
      }
    });

    on($('image-download'), 'click', async function () {
      if (!state.canvas) { status('Generate a QR code first.', true); return; }
      try {
        const blob = await canvasToBlob($('image-preview'), 'image/png');
        downloadBlob(blob, 'letitedit-qr.png');
        status('QR PNG downloaded.');
      } catch (error) { status(error.message, true); }
    });

    on($('qr-download-svg'), 'click', function () {
      if (!state.svg) { status('Generate a QR code first.', true); return; }
      downloadBlob(new Blob([state.svg], { type: 'image/svg+xml' }), 'letitedit-qr.svg');
      status('QR SVG downloaded.');
    });

    on($('qr-reset'), 'click', reset);
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
