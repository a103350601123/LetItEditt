/* Image Size Compressor — browser-only compression.
 *
 * Everything runs on the device: the file is decoded with the browser's own
 * image decoder, drawn at its original dimensions (no resize), and encoded by
 * the browser's own encoder. No network request is made with image data. */
(function () {
  'use strict';

  var MAX_BYTES = 25 * 1024 * 1024;
  var MAX_LABEL = '25 MB';
  var PRESETS = { high: 0.9, balanced: 0.78, max: 0.55 };
  var ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
  var MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  var MIME_LABEL = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/avif': 'AVIF' };
  var EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

  var state = {
    files: [],
    seq: 0,
    processing: false,
    capabilities: { 'image/jpeg': true, 'image/png': true, 'image/webp': true, 'image/avif': false }
  };

  var els = {};
  var worker = null;
  var jobs = new Map();
  var jobSeq = 0;

  /* ---------- Small helpers ---------- */
  function $(selector, root) { return (root || document).querySelector(selector); }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatPercent(value) {
    var number = Number(value) || 0;
    var sign = number < 0 ? '-' : '';
    return sign + Math.abs(number).toFixed(1) + '%';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mimeForFile(file) {
    var type = String(file.type || '').toLowerCase();
    if (ACCEPTED.indexOf(type) !== -1) return type;
    var match = /\.([a-z0-9]+)$/i.exec(file.name || '');
    return match ? (EXT_MIME[match[1].toLowerCase()] || '') : '';
  }

  function extensionFor(mime) {
    return MIME_EXT[mime] || 'img';
  }

  function outputName(item, mime) {
    var base = String(item.name || 'image').replace(/\.[^.]+$/, '');
    base = base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'image';
    return base + '-compressed.' + extensionFor(mime);
  }

  function nextPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    });
  }

  /* ---------- Capability detection ---------- */
  function canEncode(mime) {
    return new Promise(function (resolve) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 4;
        var context = canvas.getContext('2d');
        context.fillStyle = '#2563eb';
        context.fillRect(0, 0, 4, 4);
        canvas.toBlob(function (blob) {
          resolve(!!blob && blob.type === mime);
        }, mime, 0.8);
      } catch (error) {
        resolve(false);
      }
    });
  }

  function detectCapabilities() {
    Promise.all(ACCEPTED.map(function (mime) {
      return canEncode(mime).then(function (ok) { return { mime: mime, ok: ok }; });
    })).then(function (results) {
      results.forEach(function (result) { state.capabilities[result.mime] = result.ok; });
      if (els.avifOption) els.avifOption.hidden = !state.capabilities['image/avif'];
      if (els.webpOption) els.webpOption.hidden = !state.capabilities['image/webp'];
      updateSettingsUI();
    }).catch(function () { /* keep conservative defaults */ });
  }

  /* ---------- Worker ---------- */
  function initWorker() {
    if (!window.Worker || typeof OffscreenCanvas === 'undefined') return;
    try {
      worker = new Worker('../../js/image-compressor-worker.js');
      worker.onmessage = function (event) {
        var message = event.data || {};
        var job = jobs.get(message.id);
        if (!job) return;
        jobs.delete(message.id);
        if (message.ok) job.resolve(message);
        else job.reject(new Error(message.message || 'The image could not be encoded.'));
      };
      worker.onerror = function () {
        var pending = Array.from(jobs.values());
        jobs.clear();
        pending.forEach(function (job) { job.reject(new Error('The compression worker stopped unexpectedly.')); });
        worker = null;
      };
    } catch (error) {
      worker = null;
    }
  }

  function encodeImage(blob, options) {
    if (worker) {
      return new Promise(function (resolve, reject) {
        var id = ++jobSeq;
        jobs.set(id, { resolve: resolve, reject: reject });
        try {
          worker.postMessage({
            id: id,
            blob: blob,
            type: options.type,
            quality: options.quality,
            background: options.background
          });
        } catch (error) {
          jobs.delete(id);
          reject(error);
        }
      });
    }
    return encodeOnMainThread(blob, options);
  }

  function decodeToCanvas(blob) {
    return new Promise(function (resolve, reject) {
      function fallback() {
        var url = URL.createObjectURL(blob);
        var image = new Image();
        image.onload = function () {
          URL.revokeObjectURL(url);
          var canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          resolve(canvas);
        };
        image.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('This image could not be opened.'));
        };
        image.src = url;
      }

      if (typeof createImageBitmap === 'function') {
        createImageBitmap(blob).then(function (bitmap) {
          var canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          if (bitmap.close) bitmap.close();
          resolve(canvas);
        }).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  function encodeOnMainThread(blob, options) {
    return decodeToCanvas(blob).then(function (source) {
      var width = source.width;
      var height = source.height;
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext('2d', { alpha: true });
      if (options.type === 'image/jpeg') {
        context.fillStyle = options.background || '#ffffff';
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(source, 0, 0);

      var hasAlpha = false;
      if (options.type !== 'image/jpeg') {
        try {
          var pixels = context.getImageData(0, 0, width, height).data;
          for (var i = 3; i < pixels.length; i += 4) {
            if (pixels[i] < 255) { hasAlpha = true; break; }
          }
        } catch (error) { hasAlpha = false; }
      }

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (output) {
          if (!output) {
            reject(new Error('The browser returned an empty file.'));
            return;
          }
          resolve({ blob: output, mime: output.type, width: width, height: height, hasAlpha: hasAlpha });
        }, options.type, options.type === 'image/png' ? undefined : options.quality);
      });
    });
  }

  /* ---------- Reading files ---------- */
  function readDimensions(file) {
    return new Promise(function (resolve, reject) {
      function fallback() {
        var url = URL.createObjectURL(file);
        var image = new Image();
        image.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
        };
        image.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('The image could not be decoded.'));
        };
        image.src = url;
      }

      if (typeof createImageBitmap === 'function') {
        createImageBitmap(file).then(function (bitmap) {
          var dims = { width: bitmap.width, height: bitmap.height };
          if (bitmap.close) bitmap.close();
          resolve(dims);
        }).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  async function addFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;
    clearGlobalError();

    for (var i = 0; i < incoming.length; i += 1) {
      await addFile(incoming[i]);
    }
    updateSettingsUI();
    renderList();
  }

  async function addFile(file) {
    var item = {
      id: 'file-' + (++state.seq),
      file: file,
      name: file.name || 'image',
      size: file.size || 0,
      mime: mimeForFile(file),
      width: 0,
      height: 0,
      url: '',
      status: 'reading',
      error: '',
      result: null
    };
    state.files.push(item);
    renderList();

    if (!item.mime) {
      item.status = 'error';
      item.error = 'Unsupported file type. Choose a JPG, PNG, WebP or AVIF image.';
      renderList();
      return;
    }

    if (item.size > MAX_BYTES) {
      item.status = 'error';
      item.error = 'This file is ' + formatBytes(item.size) + '. The limit is ' + MAX_LABEL + ' per image.';
      renderList();
      return;
    }

    try {
      var dims = await readDimensions(file);
      if (!dims.width || !dims.height) throw new Error('Empty image.');
      item.width = dims.width;
      item.height = dims.height;
      item.url = URL.createObjectURL(file);
      item.status = 'ready';
    } catch (error) {
      item.status = 'error';
      item.error = item.mime === 'image/avif'
        ? 'This browser could not decode this AVIF file. Try JPG, PNG or WebP instead.'
        : 'This image could not be opened. The file may be corrupted or use a format this browser cannot decode.';
    }
    renderList();
  }

  function revokeItem(item) {
    if (!item) return;
    if (item.url) { URL.revokeObjectURL(item.url); item.url = ''; }
    if (item.result && item.result.url) { URL.revokeObjectURL(item.result.url); item.result.url = ''; }
  }

  function removeFile(id) {
    if (state.processing) return;
    var index = -1;
    for (var i = 0; i < state.files.length; i += 1) {
      if (state.files[i].id === id) { index = i; break; }
    }
    if (index === -1) return;
    revokeItem(state.files[index]);
    state.files.splice(index, 1);
    if (!state.files.length) {
      els.progress.hidden = true;
      els.progressLabel.textContent = '';
    }
    renderList();
  }

  function revokeAll() {
    state.files.forEach(revokeItem);
    state.files = [];
  }

  /* ---------- Settings ---------- */
  function selectedPreset() {
    var input = $('input[name="cmp-preset"]:checked');
    return input ? input.value : 'balanced';
  }

  function currentQuality() {
    var preset = selectedPreset();
    if (preset === 'custom') return clamp((Number(els.quality.value) || 80) / 100, 0.1, 1);
    return PRESETS[preset] || PRESETS.balanced;
  }

  function hasTransparencyCapableFile() {
    return state.files.some(function (item) {
      return item.mime === 'image/png' || item.mime === 'image/webp' || item.mime === 'image/avif';
    });
  }

  function updateSettingsUI() {
    var preset = selectedPreset();
    els.custom.hidden = preset !== 'custom';
    els.qualityOutput.textContent = Math.round(currentQuality() * 100) + '%';

    var format = els.format.value;
    els.bgField.hidden = format !== 'image/jpeg';
    if (format === 'image/jpeg') {
      els.bgHint.textContent = hasTransparencyCapableFile()
        ? 'JPEG has no transparency. Transparent areas will be filled with this colour.'
        : 'JPEG has no transparency. This colour fills any transparent pixels.';
    }

    var hints = {
      original: 'Each image keeps its own format. Formats this browser cannot re-encode fall back to WebP.',
      'image/jpeg': 'Best compatibility. Lossy compression with no transparency.',
      'image/png': 'Lossless re-encode. No quality setting; transparency is preserved.',
      'image/webp': 'Strong compression with transparency support.',
      'image/avif': 'Smallest files where supported. Encoding depends on the browser.'
    };
    els.formatHint.textContent = hints[format] || '';

    var pngOnly = format === 'image/png' || (format === 'original' && state.files.length > 0 && state.files.every(function (item) {
      return item.mime === 'image/png';
    }));
    els.lossyNote.hidden = !pngOnly;
    els.lossyNote.textContent = 'PNG is lossless, so the quality preset does not change PNG output. Convert to WebP or JPEG if you want a smaller lossy file.';

    updateButtons();
  }

  function markResultsStale() {
    var changed = false;
    state.files.forEach(function (item) {
      if (item.status === 'done') { item.status = 'stale'; changed = true; }
    });
    if (changed) renderList();
  }

  function onSettingsChange() {
    updateSettingsUI();
    markResultsStale();
    renderList();
  }

  function resolveTarget(item) {
    var requested = els.format.value;
    var type = requested === 'original' ? item.mime : requested;
    var note = '';

    if (!state.capabilities[type]) {
      var fallback = type === 'image/avif' ? 'image/webp' : 'image/jpeg';
      if (!state.capabilities[fallback]) fallback = 'image/png';
      if (!state.capabilities[fallback]) {
        throw new Error('This browser does not provide an image encoder for this format.');
      }
      note = (requested === 'original' ? 'This browser cannot re-encode ' + (MIME_LABEL[item.mime] || 'this format') : (MIME_LABEL[type] || 'That format') + ' encoding is unavailable') +
        '; ' + (MIME_LABEL[fallback] || fallback) + ' was used instead.';
      type = fallback;
    }

    var quality = type === 'image/png' ? null : currentQuality();
    return {
      type: type,
      quality: quality,
      background: els.bg.value || '#ffffff',
      note: note
    };
  }

  /* ---------- Compression ---------- */
  function setProgress(value, label) {
    var percent = clamp(Number(value) || 0, 0, 100);
    els.progressBar.style.width = percent + '%';
    els.progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
    if (label) els.progressLabel.textContent = label;
  }

  async function compressAll() {
    if (state.processing) return;
    var queue = state.files.filter(function (item) {
      return item.status === 'ready' || item.status === 'stale';
    });
    if (!queue.length) return;

    state.processing = true;
    clearGlobalError();
    els.progress.hidden = false;
    setProgress(0, 'Preparing images…');
    updateButtons();

    var completed = 0;
    var failed = 0;

    for (var i = 0; i < queue.length; i += 1) {
      var item = queue[i];
      item.status = 'compressing';
      item.error = '';
      renderList();
      setProgress((i / queue.length) * 100, 'Compressing ' + (i + 1) + ' of ' + queue.length + ' — ' + item.name);
      await nextPaint();

      try {
        var target = resolveTarget(item);
        var encoded = await encodeImage(item.file, target);
        var blob = encoded.blob || new Blob([encoded.buffer], { type: encoded.mime });
        if (!blob.size) throw new Error('The encoder returned an empty file.');
        if (encoded.mime && encoded.mime !== target.type) {
          throw new Error('This browser cannot encode ' + (MIME_LABEL[target.type] || target.type) + ' reliably. Choose another format.');
        }

        if (item.result && item.result.url) URL.revokeObjectURL(item.result.url);
        var saved = item.size - blob.size;
        item.result = {
          blob: blob,
          url: URL.createObjectURL(blob),
          size: blob.size,
          mime: blob.type || target.type,
          width: encoded.width || item.width,
          height: encoded.height || item.height,
          hasAlpha: !!encoded.hasAlpha,
          note: target.note,
          saved: saved,
          percent: item.size ? (saved / item.size) * 100 : 0,
          filename: outputName(item, blob.type || target.type)
        };
        item.status = 'done';
        item.error = '';
        completed += 1;
      } catch (error) {
        item.status = 'error';
        item.error = (error && error.message) || 'This image could not be compressed.';
        failed += 1;
      }

      renderList();
      setProgress(((i + 1) / queue.length) * 100, '');
      await nextPaint();
    }

    state.processing = false;
    setProgress(100, 'Finished: ' + completed + ' compressed' + (failed ? ', ' + failed + ' failed' : '') + '.');
    renderList();
  }

  /* ---------- Rendering ---------- */
  function statusInfo(item) {
    if (item.status === 'error') return { tone: 'error', label: 'Could not process' };
    if (item.status === 'compressing') return { tone: 'working', label: 'Compressing…' };
    if (item.status === 'reading') return { tone: 'working', label: 'Reading image…' };
    if (item.status === 'done') {
      return item.result && item.result.saved < 0
        ? { tone: 'warn', label: 'Output is larger than the original' }
        : { tone: 'done', label: 'Compressed' };
    }
    if (item.status === 'stale') return { tone: 'ready', label: 'Settings changed — compress again' };
    return { tone: 'ready', label: 'Ready to compress' };
  }

  function adviceFor(item) {
    var result = item.result;
    if (!result) return '';
    var parts = [];
    if (result.note) parts.push(result.note);
    if (result.saved > 0) {
      parts.push('Dimensions are unchanged at ' + item.width + ' × ' + item.height + ' px.');
      if (result.mime !== 'image/jpeg' && result.hasAlpha) parts.push('Transparency was preserved.');
    } else if (result.saved === 0) {
      parts.push('The output is exactly the same size as the original. Try a different format or a lower quality.');
    } else {
      if (result.mime === 'image/png') {
        parts.push('These settings produced a file ' + formatBytes(Math.abs(result.saved)) + ' larger than the original. PNG is lossless, so try WebP or JPEG, choose Maximum compression, or keep the original file.');
      } else if (result.mime === 'image/jpeg') {
        parts.push('These settings produced a file ' + formatBytes(Math.abs(result.saved)) + ' larger than the original. Try Balanced or Maximum compression, a lower custom quality, or keep the original file.');
      } else {
        parts.push('These settings produced a file ' + formatBytes(Math.abs(result.saved)) + ' larger than the original. Try a lower quality, Maximum compression, or keep the original file.');
      }
    }
    if (result.mime === 'image/jpeg' && hasTransparencyCapableFile()) {
      parts.push('Transparent pixels, if any, were flattened onto ' + (els.bg.value || '#ffffff') + '.');
    }
    return parts.join(' ');
  }

  function rowHtml(item) {
    var status = statusInfo(item);
    var dims = item.width && item.height
      ? item.width + ' × ' + item.height + ' px'
      : (item.status === 'reading' ? 'Reading dimensions…' : 'Dimensions unavailable');
    var meta = dims + ' · ' + (MIME_LABEL[item.mime] || 'Unknown format') + ' · ' + formatBytes(item.size);

    var originalPreview = item.url
      ? '<img src="' + escapeHtml(item.url) + '" alt="Original preview of ' + escapeHtml(item.name) + '" loading="lazy" data-original-preview>'
      : '<span class="cmp-thumb-placeholder">No preview available</span>';

    var compressedPreview = item.result && item.result.url
      ? '<img src="' + escapeHtml(item.result.url) + '" alt="Compressed preview of ' + escapeHtml(item.name) + '" loading="lazy" data-compressed-preview>'
      : '<span class="cmp-thumb-placeholder">Compressed preview appears here</span>';

    var resultHtml = '';
    if (item.result) {
      var negative = item.result.saved < 0;
      var savedClass = item.result.saved > 0 ? ' class="is-positive"' : (negative ? ' class="is-negative"' : '');
      var percentClass = item.result.percent > 0 ? ' class="is-positive"' : (item.result.percent < 0 ? ' class="is-negative"' : '');
      var adviceClass = item.result.saved > 0 ? ' is-positive' : (negative ? ' is-negative' : '');
      var savedText = (negative ? '-' : '') + formatBytes(Math.abs(item.result.saved));
      resultHtml =
        '<div class="cmp-result" data-result>' +
          '<dl class="cmp-stats">' +
            '<div><dt>Original</dt><dd data-stat="original">' + formatBytes(item.size) + '</dd></div>' +
            '<div><dt>Compressed</dt><dd data-stat="compressed">' + formatBytes(item.result.size) + '</dd></div>' +
            '<div><dt>Saved</dt><dd data-stat="saved"' + savedClass + '>' + savedText + '</dd></div>' +
            '<div><dt>Reduction</dt><dd data-stat="percent"' + percentClass + '>' + formatPercent(item.result.percent) + '</dd></div>' +
          '</dl>' +
          '<p class="cmp-advice' + adviceClass + '" data-stat="advice">' + escapeHtml(adviceFor(item)) + '</p>' +
        '</div>';
    }

    var downloadHtml = item.result && item.result.url
      ? '<a class="cmp-btn cmp-btn-small cmp-btn-secondary" href="' + escapeHtml(item.result.url) + '" download="' + escapeHtml(item.result.filename) + '" data-download>Download</a>'
      : '';

    return '<li class="cmp-file" data-file-row data-file-id="' + escapeHtml(item.id) + '">' +
      '<div class="cmp-file-body">' +
        '<div class="cmp-previews">' +
          '<figure class="cmp-preview"><div class="cmp-thumb">' + originalPreview + '</div><figcaption>Original</figcaption></figure>' +
          '<figure class="cmp-preview' + (item.result ? ' is-new' : '') + '"><div class="cmp-thumb">' + compressedPreview + '</div><figcaption>Compressed</figcaption></figure>' +
        '</div>' +
        '<div class="cmp-file-info">' +
          '<p class="cmp-file-name" data-file-name title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</p>' +
          '<p class="cmp-file-meta" data-file-meta>' + escapeHtml(meta) + '</p>' +
          '<p class="cmp-status" data-status data-tone="' + status.tone + '">' + escapeHtml(status.label) + '</p>' +
          (item.error ? '<p class="cmp-file-error" data-file-error>' + escapeHtml(item.error) + '</p>' : '') +
          resultHtml +
          '<div class="cmp-file-actions">' +
            downloadHtml +
            '<button class="cmp-btn cmp-btn-small cmp-btn-ghost" type="button" data-remove="' + escapeHtml(item.id) + '"' + (state.processing ? ' disabled' : '') + '>Remove</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</li>';
  }

  function renderList() {
    if (!state.files.length) {
      els.results.hidden = true;
      els.summary.hidden = true;
      els.list.innerHTML = '';
      els.count.textContent = '0 images';
      updateButtons();
      return;
    }

    els.results.hidden = false;
    els.list.innerHTML = state.files.map(rowHtml).join('');
    els.count.textContent = state.files.length + (state.files.length === 1 ? ' image' : ' images');
    updateSummary();
    updateButtons();
  }

  function updateSummary() {
    var done = state.files.filter(function (item) { return item.status === 'done' && item.result; });
    if (!done.length) {
      els.summary.hidden = true;
      return;
    }

    var original = 0;
    var compressed = 0;
    done.forEach(function (item) {
      original += item.size;
      compressed += item.result.size;
    });
    var saved = original - compressed;
    var percent = original ? (saved / original) * 100 : 0;

    els.summary.hidden = false;
    els.summaryCount.textContent = String(done.length);
    els.summaryOriginal.textContent = formatBytes(original);
    els.summaryCompressed.textContent = formatBytes(compressed);
    els.summarySaved.textContent = (saved < 0 ? '-' : '') + formatBytes(Math.abs(saved));
    els.summaryPercent.textContent = formatPercent(percent);

    [els.summarySaved, els.summaryPercent].forEach(function (node) {
      node.classList.toggle('is-negative', saved < 0);
      node.classList.toggle('is-positive', saved > 0);
    });
  }

  function updateButtons() {
    var eligible = state.files.filter(function (item) {
      return item.status === 'ready' || item.status === 'stale';
    });
    var done = state.files.filter(function (item) { return item.status === 'done' && item.result; });

    els.compress.disabled = state.processing || !eligible.length;
    els.downloadAll.disabled = state.processing || !done.length;
    els.compress.textContent = state.processing
      ? 'Compressing…'
      : (state.files.length === 1 ? 'Compress image' : 'Compress images');
  }

  /* ---------- ZIP (store-only, valid archive) ---------- */
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    var year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function buildZip(entries) {
    var encoder = new TextEncoder();
    var stamp = dosDateTime(new Date());
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var centralSize = 0;

    entries.forEach(function (entry) {
      var name = encoder.encode(entry.name);
      var crc = crc32(entry.data);
      var local = new Uint8Array(30 + name.length);
      var view = new DataView(local.buffer);
      view.setUint32(0, 0x04034B50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, stamp.time, true);
      view.setUint16(12, stamp.date, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, entry.data.length, true);
      view.setUint32(22, entry.data.length, true);
      view.setUint16(26, name.length, true);
      view.setUint16(28, 0, true);
      local.set(name, 30);

      var central = new Uint8Array(46 + name.length);
      var centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014B50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, entry.data.length, true);
      centralView.setUint32(24, entry.data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);

      localParts.push(local, entry.data);
      centralParts.push(central);
      offset += local.length + entry.data.length;
      centralSize += central.length;
    });

    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    return new Blob(localParts.concat(centralParts, [end]), { type: 'application/zip' });
  }

  function uniqueZipName(name, used) {
    if (!used[name]) { used[name] = true; return name; }
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var n = 2;
    while (used[base + '-' + n + ext]) n += 1;
    var next = base + '-' + n + ext;
    used[next] = true;
    return next;
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function downloadAll() {
    var done = state.files.filter(function (item) { return item.status === 'done' && item.result; });
    if (!done.length) return;

    var originalLabel = els.downloadAll.textContent;
    els.downloadAll.disabled = true;
    els.downloadAll.textContent = 'Preparing ZIP…';

    try {
      var entries = [];
      var used = {};
      for (var i = 0; i < done.length; i += 1) {
        var item = done[i];
        var buffer = new Uint8Array(await item.result.blob.arrayBuffer());
        entries.push({ name: uniqueZipName(item.result.filename, used), data: buffer });
      }
      triggerDownload(buildZip(entries), 'letitedit-compressed-images.zip');
    } catch (error) {
      showGlobalError('The ZIP file could not be created. You can still download each image individually.');
    } finally {
      els.downloadAll.textContent = originalLabel;
      updateButtons();
    }
  }

  /* ---------- Errors ---------- */
  function showGlobalError(message) {
    els.globalError.textContent = message;
    els.globalError.hidden = false;
  }

  function clearGlobalError() {
    els.globalError.textContent = '';
    els.globalError.hidden = true;
  }

  /* ---------- Reset ---------- */
  function resetAll() {
    if (state.processing) return;
    revokeAll();
    els.list.innerHTML = '';
    els.results.hidden = true;
    els.summary.hidden = true;
    els.progress.hidden = true;
    els.progressLabel.textContent = '';
    els.progressBar.style.width = '0%';
    els.progressTrack.setAttribute('aria-valuenow', '0');
    els.fileInput.value = '';
    els.format.value = 'original';
    var balanced = $('input[name="cmp-preset"][value="balanced"]');
    if (balanced) balanced.checked = true;
    els.quality.value = '80';
    els.qualityOutput.textContent = '80%';
    els.bg.value = '#ffffff';
    els.bgCode.textContent = '#ffffff';
    clearGlobalError();
    updateSettingsUI();
    renderList();
    els.dropzone.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- Wiring ---------- */
  function cacheElements() {
    els.app = $('[data-compressor]');
    els.dropzone = $('[data-dropzone]');
    els.fileInput = $('[data-file-input]');
    els.browse = $('[data-browse]');
    els.format = $('[data-format]');
    els.formatHint = $('[data-format-hint]');
    els.bgField = $('[data-bg-field]');
    els.bg = $('[data-bg]');
    els.bgCode = $('[data-bg-code]');
    els.bgHint = $('[data-bg-hint]');
    els.custom = $('[data-custom]');
    els.quality = $('[data-quality]');
    els.qualityOutput = $('[data-quality-output]');
    els.lossyNote = $('[data-lossy-note]');
    els.compress = $('[data-compress]');
    els.downloadAll = $('[data-download-all]');
    els.reset = $('[data-reset]');
    els.progress = $('[data-progress]');
    els.progressTrack = $('[data-progress-track]');
    els.progressBar = $('[data-progress-bar]');
    els.progressLabel = $('[data-progress-label]');
    els.results = $('[data-results]');
    els.list = $('[data-file-list]');
    els.count = $('[data-count]');
    els.summary = $('[data-summary]');
    els.summaryCount = $('[data-summary-count]');
    els.summaryOriginal = $('[data-summary-original]');
    els.summaryCompressed = $('[data-summary-compressed]');
    els.summarySaved = $('[data-summary-saved]');
    els.summaryPercent = $('[data-summary-percent]');
    els.globalError = $('[data-global-error]');
    els.avifOption = $('[data-avif-option]');
    els.webpOption = $('[data-webp-option]');
  }

  function bindEvents() {
    els.browse.addEventListener('click', function () { els.fileInput.click(); });

    els.fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(els.fileInput.files || []);
      els.fileInput.value = '';
      addFiles(files);
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        event.stopPropagation();
        els.dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        els.dropzone.classList.remove('is-dragover');
      });
    });
    els.dropzone.addEventListener('drop', function (event) {
      event.preventDefault();
      event.stopPropagation();
      els.dropzone.classList.remove('is-dragover');
      var files = event.dataTransfer ? event.dataTransfer.files : null;
      if (files && files.length) addFiles(files);
    });

    window.addEventListener('dragover', function (event) { event.preventDefault(); });
    window.addEventListener('drop', function (event) { event.preventDefault(); });

    els.list.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove]');
      if (remove) removeFile(remove.getAttribute('data-remove'));
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="cmp-preset"]'), function (input) {
      input.addEventListener('change', onSettingsChange);
    });
    els.quality.addEventListener('input', function () {
      els.qualityOutput.textContent = Math.round(currentQuality() * 100) + '%';
    });
    els.quality.addEventListener('change', onSettingsChange);
    els.format.addEventListener('change', onSettingsChange);
    els.bg.addEventListener('input', function () {
      els.bgCode.textContent = els.bg.value;
      if (state.files.some(function (item) { return item.status === 'done' && item.result; })) renderList();
    });
    els.bg.addEventListener('change', onSettingsChange);

    els.compress.addEventListener('click', compressAll);
    els.downloadAll.addEventListener('click', downloadAll);
    els.reset.addEventListener('click', resetAll);

    window.addEventListener('beforeunload', revokeAll);

    var menuButton = $('.menu-button');
    var primaryLinks = $('#primary-links');
    if (menuButton && primaryLinks) {
      menuButton.addEventListener('click', function () {
        var open = primaryLinks.classList.toggle('is-open');
        menuButton.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && primaryLinks.classList.contains('is-open')) {
          primaryLinks.classList.remove('is-open');
          menuButton.setAttribute('aria-expanded', 'false');
          menuButton.focus();
        }
      });
    }
  }

  function init() {
    if (!$('[data-compressor]')) return;
    cacheElements();
    bindEvents();
    updateSettingsUI();
    detectCapabilities();
    initWorker();
    renderList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
