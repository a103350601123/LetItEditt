/* LetitEdit Image & Photo engines. Pure functions only: no DOM, no network,
 * no side effects. The browser runtime in js/image-runtime.js owns the UI,
 * object URLs and downloads. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_PIXELS = 40 * 1000 * 1000;
  const MAX_DIMENSION = 8000;

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function hexToRgb(value, fallback) {
    const hex = String(value || '').trim().replace(/^#/, '');
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback || [0, 0, 0];
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }

  function createImageData(width, height) {
    return { width: width, height: height, data: new Uint8ClampedArray(width * height * 4) };
  }

  function grayscale(input) {
    const out = createImageData(input.width, input.height);
    for (let i = 0; i < input.data.length; i += 4) {
      const luma = Math.round(input.data[i] * 0.299 + input.data[i + 1] * 0.587 + input.data[i + 2] * 0.114);
      out.data[i] = out.data[i + 1] = out.data[i + 2] = luma;
      out.data[i + 3] = input.data[i + 3];
    }
    return out;
  }

  function threshold(input, level) {
    const cut = clampInt(level, 0, 255, 128);
    const out = createImageData(input.width, input.height);
    for (let i = 0; i < input.data.length; i += 4) {
      const luma = input.data[i] * 0.299 + input.data[i + 1] * 0.587 + input.data[i + 2] * 0.114;
      const value = luma >= cut ? 255 : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = value;
      out.data[i + 3] = input.data[i + 3];
    }
    return out;
  }

  function invert(input) {
    const out = createImageData(input.width, input.height);
    for (let i = 0; i < input.data.length; i += 4) {
      out.data[i] = 255 - input.data[i];
      out.data[i + 1] = 255 - input.data[i + 1];
      out.data[i + 2] = 255 - input.data[i + 2];
      out.data[i + 3] = input.data[i + 3];
    }
    return out;
  }

  function flip(input, axis) {
    const out = createImageData(input.width, input.height);
    const w = input.width;
    const h = input.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = axis === 'horizontal' ? w - 1 - x : x;
        const sy = axis === 'vertical' ? h - 1 - y : y;
        const from = (sy * w + sx) * 4;
        const to = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) out.data[to + c] = input.data[from + c];
      }
    }
    return out;
  }

  function rotate90(input, direction) {
    const w = input.width;
    const h = input.height;
    const out = createImageData(h, w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = direction === 'left' ? y : h - 1 - y;
        const ty = direction === 'left' ? w - 1 - x : x;
        const from = (y * w + x) * 4;
        const to = (ty * h + tx) * 4;
        for (let c = 0; c < 4; c++) out.data[to + c] = input.data[from + c];
      }
    }
    return out;
  }

  function sample(input, x, y, channel) {
    const sx = Math.min(input.width - 1, Math.max(0, x));
    const sy = Math.min(input.height - 1, Math.max(0, y));
    return input.data[(sy * input.width + sx) * 4 + channel];
  }

  function resize(input, width, height) {
    const w = clampInt(width, 1, MAX_DIMENSION, input.width);
    const h = clampInt(height, 1, MAX_DIMENSION, input.height);
    const out = createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = (y + 0.5) * input.height / h - 0.5;
      const y0 = Math.floor(sy);
      const y1 = y0 + 1;
      const fy = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = (x + 0.5) * input.width / w - 0.5;
        const x0 = Math.floor(sx);
        const x1 = x0 + 1;
        const fx = sx - x0;
        const to = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          const top = sample(input, x0, y0, c) * (1 - fx) + sample(input, x1, y0, c) * fx;
          const bottom = sample(input, x0, y1, c) * (1 - fx) + sample(input, x1, y1, c) * fx;
          out.data[to + c] = top * (1 - fy) + bottom * fy;
        }
      }
    }
    return out;
  }

  function fitDimensions(sourceWidth, sourceHeight, targetWidth, targetHeight, lock, mode) {
    const tw = clampInt(targetWidth, 1, MAX_DIMENSION, sourceWidth);
    const th = clampInt(targetHeight, 1, MAX_DIMENSION, sourceHeight);
    if (!lock || mode === 'stretch') return { width: tw, height: th };
    const scale = Math.min(tw / sourceWidth, th / sourceHeight);
    return {
      width: Math.max(1, Math.min(MAX_DIMENSION, Math.round(sourceWidth * scale))),
      height: Math.max(1, Math.min(MAX_DIMENSION, Math.round(sourceHeight * scale)))
    };
  }

  function composeBorder(input, width, color) {
    const border = clampInt(width, 0, 500, 0);
    const rgb = hexToRgb(color, [255, 255, 255]);
    const w = input.width + border * 2;
    const h = input.height + border * 2;
    const out = createImageData(w, h);
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = rgb[0];
      out.data[i + 1] = rgb[1];
      out.data[i + 2] = rgb[2];
      out.data[i + 3] = 255;
    }
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const from = (y * input.width + x) * 4;
        const to = ((y + border) * w + (x + border)) * 4;
        const a = input.data[from + 3] / 255;
        for (let c = 0; c < 3; c++) {
          out.data[to + c] = input.data[from + c] * a + rgb[c] * (1 - a);
        }
        out.data[to + 3] = 255;
      }
    }
    return out;
  }

  function cropRect(imageWidth, imageHeight, crop) {
    const x = clampInt(crop.x, 0, imageWidth - 1, 0);
    const y = clampInt(crop.y, 0, imageHeight - 1, 0);
    const w = clampInt(crop.w, 1, imageWidth - x, imageWidth - x);
    const h = clampInt(crop.h, 1, imageHeight - y, imageHeight - y);
    return { x, y, w, h };
  }

  function withinLimits(bytes, width, height) {
    if (Number(bytes) > MAX_FILE_BYTES) return 'That file is larger than the 50 MB limit.';
    if (Number(width) * Number(height) > MAX_PIXELS) return 'That image has more than 40 million pixels.';
    if (Number(width) > MAX_DIMENSION || Number(height) > MAX_DIMENSION) return 'That image exceeds the 8,000 px edge limit.';
    return null;
  }

  return {
    MAX_FILE_BYTES,
    MAX_PIXELS,
    MAX_DIMENSION,
    clampInt,
    formatBytes,
    hexToRgb,
    createImageData,
    grayscale,
    threshold,
    invert,
    flip,
    rotate90,
    resize,
    fitDimensions,
    composeBorder,
    cropRect,
    withinLimits
  };
});
