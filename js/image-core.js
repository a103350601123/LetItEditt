/* LetitEdit Image & Photo engines. Pure functions only: no DOM, no network,
 * no side effects. The browser runtime in js/image-runtime.js owns the UI,
 * object URLs and downloads. Barcode module patterns below are published
 * symbology specifications (ISO/IEC 15417 for Code 128), not vendored code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_PIXELS = 40 * 1000 * 1000;
  const MAX_DIMENSION = 8000;
  const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

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

  /* Keep a crop inside the source while forcing a width:height ratio such as
   * 16:9 or 1:1. The rectangle is centred on the requested top-left where
   * possible, then clamped to the image. */
  function cropAspectRect(imageWidth, imageHeight, crop, ratio) {
    const base = cropRect(imageWidth, imageHeight, crop);
    const r = Number(ratio);
    if (!Number.isFinite(r) || r <= 0) return base;
    let w = base.w;
    let h = Math.round(w / r);
    if (h > base.h) { h = base.h; w = Math.round(h * r); }
    w = Math.max(1, Math.min(w, imageWidth - base.x));
    h = Math.max(1, Math.min(h, imageHeight - base.y));
    const x = clampInt(base.x + (base.w - w) / 2, 0, imageWidth - w, base.x);
    const y = clampInt(base.y + (base.h - h) / 2, 0, imageHeight - h, base.y);
    return { x, y, w, h };
  }

  function withinLimits(bytes, width, height) {
    if (Number(bytes) > MAX_FILE_BYTES) return 'That file is larger than the 50 MB limit.';
    if (Number(width) * Number(height) > MAX_PIXELS) return 'That image has more than 40 million pixels.';
    if (Number(width) > MAX_DIMENSION || Number(height) > MAX_DIMENSION) return 'That image exceeds the 8,000 px edge limit.';
    return null;
  }

  /* ---------- HEIC / HEIF container identification ---------- */

  function fourcc(bytes, offset) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) return '';
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  /* ISO BMFF files begin with a size + 'ftyp' box. The major brand and
   * compatible brands tell us whether this really is HEIC/HEIF; extension
   * and MIME type alone are not evidence. */
  function detectHeifBrand(bytes) {
    const result = {
      isHeif: false, brand: '', extension: '', mime: '',
      compatibleBrands: [], reason: ''
    };
    if (!bytes || bytes.length < 12) {
      result.reason = 'File is too small to contain an ISO BMFF ftyp box.';
      return result;
    }
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    if (boxSize < 8 || boxSize > bytes.length) {
      result.reason = 'The ISO BMFF box size is invalid.';
      return result;
    }
    if (fourcc(bytes, 4) !== 'ftyp') {
      result.reason = 'Missing ftyp brand box; this is not an HEIC/HEIF container.';
      return result;
    }
    const major = fourcc(bytes, 8);
    const compatible = [];
    for (let offset = 16; offset + 4 <= Math.min(bytes.length, boxSize); offset += 4) compatible.push(fourcc(bytes, offset));
    const brands = [major].concat(compatible);
    const matched = brands.find(brand => HEIF_BRANDS.indexOf(brand) !== -1);
    result.brand = major;
    result.compatibleBrands = compatible;
    if (!matched) {
      result.reason = major ? 'Brand ' + major + ' is not an HEIC/HEIF brand.' : 'No brand was found.';
      return result;
    }
    result.isHeif = true;
    result.extension = /^(mif1|msf1)$/.test(matched) ? 'heif' : 'heic';
    result.mime = result.extension === 'heif' ? 'image/heif' : 'image/heic';
    result.reason = 'ISO BMFF container with ' + matched + ' brand.';
    return result;
  }

  /* Read a conventional EXIF orientation tag when a file happens to include
   * one. Many HEIC files store rotation in container transforms instead, in
   * which case this returns 1 and the bundled decoder's display path applies
   * it. Returns 1-8 or 1 for missing/invalid metadata. */
  function exifOrientation(bytes) {
    if (!bytes || bytes.length < 24) return 1;
    let marker = -1;
    for (let i = 0; i <= bytes.length - 6; i++) {
      if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 &&
          bytes[i + 3] === 0x66 && bytes[i + 4] === 0x00 && bytes[i + 5] === 0x00) {
        marker = i + 6;
        break;
      }
    }
    if (marker < 0 || marker + 8 > bytes.length) return 1;
    const little = bytes[marker] === 0x49 && bytes[marker + 1] === 0x49;
    const big = bytes[marker] === 0x4d && bytes[marker + 1] === 0x4d;
    if (!little && !big) return 1;
    const uint16 = offset => little
      ? (bytes[offset] | (bytes[offset + 1] << 8))
      : ((bytes[offset] << 8) | bytes[offset + 1]);
    const uint32 = offset => little
      ? ((bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + (bytes[offset + 3] * 0x1000000))
      : (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]);
    if (uint16(marker + 2) !== 42) return 1;
    const ifd = marker + uint32(marker + 4);
    if (ifd + 2 > bytes.length) return 1;
    const entries = uint16(ifd);
    for (let i = 0; i < entries; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      if (uint16(entry) === 0x0112) {
        const orientation = uint16(entry + 8);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    return 1;
  }

  /* ---------- Pixel adjustments used by the editor and thumbnails ---------- */

  function adjustImageData(input, options) {
    const opts = options || {};
    const out = createImageData(input.width, input.height);
    const brightness = clamp(Number(opts.brightness) || 0, -100, 100) * 2.55;
    const contrastValue = clamp(Number(opts.contrast) || 0, -100, 100) * 2.55;
    const contrast = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
    const saturation = 1 + clamp(Number(opts.saturation) || 0, -100, 100) / 100;
    const temperature = clamp(Number(opts.temperature) || 0, -100, 100) / 100;
    const exposure = Math.pow(2, clamp(Number(opts.exposure) || 0, -100, 100) / 50);
    const highlights = clamp(Number(opts.highlights) || 0, -100, 100) / 100;
    const shadows = clamp(Number(opts.shadows) || 0, -100, 100) / 100;
    const gray = clamp(Number(opts.grayscale) || 0, 0, 100) / 100;
    const sepia = clamp(Number(opts.sepia) || 0, 0, 100) / 100;
    const vignette = clamp(Number(opts.vignette) || 0, 0, 100) / 100;
    const cx = (input.width - 1) / 2;
    const cy = (input.height - 1) / 2;
    const maxDistance = Math.sqrt(cx * cx + cy * cy) || 1;

    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const i = (y * input.width + x) * 4;
        let r = input.data[i];
        let g = input.data[i + 1];
        let b = input.data[i + 2];
        const luma = r * 0.299 + g * 0.587 + b * 0.114;

        r = (r - luma) * saturation + luma;
        g = (g - luma) * saturation + luma;
        b = (b - luma) * saturation + luma;
        r += temperature * 45;
        b -= temperature * 45;
        r = (r * exposure + brightness - 128) * contrast + 128;
        g = (g * exposure + brightness - 128) * contrast + 128;
        b = (b * exposure + brightness - 128) * contrast + 128;

        const adjustedLuma = r * 0.299 + g * 0.587 + b * 0.114;
        const highlightShift = highlights * Math.max(0, adjustedLuma - 128) / 2;
        const shadowShift = shadows * Math.max(0, 128 - adjustedLuma) / 2;
        r += highlightShift + shadowShift;
        g += highlightShift + shadowShift;
        b += highlightShift + shadowShift;

        if (gray) {
          const blended = r * 0.299 + g * 0.587 + b * 0.114;
          r = r * (1 - gray) + blended * gray;
          g = g * (1 - gray) + blended * gray;
          b = b * (1 - gray) + blended * gray;
        }
        if (sepia) {
          const sr = r * 0.393 + g * 0.769 + b * 0.189;
          const sg = r * 0.349 + g * 0.686 + b * 0.168;
          const sb = r * 0.272 + g * 0.534 + b * 0.131;
          r = r * (1 - sepia) + sr * sepia;
          g = g * (1 - sepia) + sg * sepia;
          b = b * (1 - sepia) + sb * sepia;
        }
        if (vignette) {
          const distance = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxDistance;
          const factor = 1 - vignette * Math.pow(clamp(distance, 0, 1), 1.7) * 0.85;
          r *= factor; g *= factor; b *= factor;
        }
        out.data[i] = r;
        out.data[i + 1] = g;
        out.data[i + 2] = b;
        out.data[i + 3] = input.data[i + 3];
      }
    }
    return out;
  }

  function sharpen(input, amount) {
    const strength = clamp(Number(amount) || 0, 0, 200) / 100;
    if (!strength) return input;
    const out = createImageData(input.width, input.height);
    const center = 1 + 4 * strength;
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const i = (y * input.width + x) * 4;
        for (let c = 0; c < 4; c++) {
          out.data[i + c] = center * sample(input, x, y, c)
            - strength * (sample(input, x - 1, y, c) + sample(input, x + 1, y, c)
              + sample(input, x, y - 1, c) + sample(input, x, y + 1, c));
        }
      }
    }
    return out;
  }

  function boxBlur(input, radius) {
    const r = clampInt(radius, 0, 12, 0);
    if (!r) return input;
    const w = input.width;
    const h = input.height;
    const horizontal = createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += sample(input, x + k, y, c);
          horizontal.data[i + c] = sum / (2 * r + 1);
        }
      }
    }
    const out = createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += sample(horizontal, x, y + k, c);
          out.data[i + c] = sum / (2 * r + 1);
        }
      }
    }
    return out;
  }

  function rotatedBounds(width, height, degrees) {
    const radians = (Number(degrees) || 0) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    return {
      width: Math.max(1, Math.round(width * cosine + height * sine)),
      height: Math.max(1, Math.round(width * sine + height * cosine))
    };
  }

  function rotateArbitrary(input, degrees, background) {
    const angle = (Number(degrees) || 0) * Math.PI / 180;
    const bounds = rotatedBounds(input.width, input.height, degrees);
    const out = createImageData(bounds.width, bounds.height);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const bg = hexToRgb(background, [0, 0, 0]);
    const transparent = background === null || background === 'transparent';
    const sxCenter = (input.width - 1) / 2;
    const syCenter = (input.height - 1) / 2;

    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const dx = x - (bounds.width - 1) / 2;
        const dy = y - (bounds.height - 1) / 2;
        let sx = dx * cos + dy * sin + sxCenter;
        let sy = -dx * sin + dy * cos + syCenter;
        const i = (y * bounds.width + x) * 4;
        const epsilon = 1e-9;
        if (sx < -epsilon || sy < -epsilon || sx > input.width - 1 + epsilon || sy > input.height - 1 + epsilon) {
          out.data[i] = bg[0]; out.data[i + 1] = bg[1]; out.data[i + 2] = bg[2];
          out.data[i + 3] = transparent ? 0 : 255;
          continue;
        }
        sx = clamp(sx, 0, input.width - 1);
        sy = clamp(sy, 0, input.height - 1);
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;
        for (let c = 0; c < 4; c++) {
          const top = sample(input, x0, y0, c) * (1 - fx) + sample(input, x0 + 1, y0, c) * fx;
          const bottom = sample(input, x0, y0 + 1, c) * (1 - fx) + sample(input, x0 + 1, y0 + 1, c) * fx;
          out.data[i + c] = top * (1 - fy) + bottom * fy;
        }
      }
    }
    return out;
  }

  /* Plain-background removal: compare border pixels with the average corner
   * colour and flood-fill matching regions to transparent. It is deliberately
   * conservative and does not pretend to be segmentation. */
  function removeBackground(input, tolerance, softness) {
    const toleranceValue = clampInt(tolerance, 5, 160, 45);
    const feather = clamp(Number(softness), 0, 100, 40) / 100;
    const w = input.width;
    const h = input.height;
    const out = createImageData(w, h);
    out.data.set(input.data);
    if (!w || !h) return out;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    let r = 0, g = 0, b = 0;
    corners.forEach(point => {
      const i = (point[1] * w + point[0]) * 4;
      r += input.data[i]; g += input.data[i + 1]; b += input.data[i + 2];
    });
    r /= corners.length; g /= corners.length; b /= corners.length;
    const limit = toleranceValue * toleranceValue * 3;
    const visited = new Uint8Array(w * h);
    const stack = [];
    function seed(x, y) { if (x >= 0 && y >= 0 && x < w && y < h) stack.push(y * w + x); }
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const index = stack.pop();
      if (visited[index]) continue;
      visited[index] = 1;
      const i = index * 4;
      const dr = input.data[i] - r;
      const dg = input.data[i + 1] - g;
      const db = input.data[i + 2] - b;
      if (dr * dr + dg * dg + db * db > limit) continue;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db) / (toleranceValue * Math.sqrt(3) || 1);
      out.data[i + 3] = Math.round(input.data[i + 3] * clamp(distance / (feather || 0.01), 0, 1));
      const x = index % w;
      const y = Math.floor(index / w);
      seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
    }
    return out;
  }

  /* ---------- Mosaic / collage layout ---------- */

  function fitBox(sourceWidth, sourceHeight, boxWidth, boxHeight, mode) {
    if (mode === 'stretch' || !sourceWidth || !sourceHeight) {
      return { w: boxWidth, h: boxHeight, sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
    }
    const scale = mode === 'fill'
      ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const w = Math.max(1, Math.min(boxWidth, Math.round(sourceWidth * scale)));
    const h = Math.max(1, Math.min(boxHeight, Math.round(sourceHeight * scale)));
    return {
      w, h,
      sx: Math.floor((sourceWidth - w / scale) / 2),
      sy: Math.floor((sourceHeight - h / scale) / 2),
      sw: Math.max(1, Math.round(w / scale)),
      sh: Math.max(1, Math.round(h / scale))
    };
  }

  function mosaicLayout(items, options) {
    const opts = options || {};
    const count = items.length;
    if (!count) return { width: 0, height: 0, cells: [] };
    const layout = opts.layout === 'grid' || opts.layout === 'custom' ? opts.layout
      : opts.layout === 'vertical' ? 'vertical' : 'horizontal';
    const gap = clampInt(opts.gap, 0, 200, 0);
    const border = clampInt(opts.border, 0, 60, 0);
    const sizeMode = ['equalWidth', 'equalHeight', 'equalFrame', 'custom'].indexOf(opts.sizeMode) !== -1
      ? opts.sizeMode : 'original';
    const maintainAspect = opts.maintainAspect !== false;
    const fitMode = !maintainAspect || opts.fitMode === 'stretch' ? 'stretch'
      : opts.fitMode === 'fill' ? 'fill' : 'fit';
    const columns = Math.max(1, clampInt(opts.columns, 1, 12, Math.min(3, count)));
    const requestedWidth = clampInt(opts.cellWidth, 1, MAX_DIMENSION, 0);
    const requestedHeight = clampInt(opts.cellHeight, 1, MAX_DIMENSION, 0);
    const maxWidth = Math.max.apply(null, items.map(item => item.width));
    const maxHeight = Math.max.apply(null, items.map(item => item.height));
    const cols = layout === 'horizontal' ? count : layout === 'vertical' ? 1 : columns;
    const rows = Math.ceil(count / cols);

    const cells = [];
    for (let index = 0; index < count; index++) {
      const item = items[index];
      let cellWidth = item.width;
      let cellHeight = item.height;
      if (layout === 'grid' || layout === 'custom' || sizeMode === 'equalFrame' || sizeMode === 'custom') {
        cellWidth = requestedWidth || maxWidth;
        cellHeight = requestedHeight || maxHeight;
      } else if (sizeMode === 'equalWidth') {
        cellWidth = requestedWidth || maxWidth;
        cellHeight = maintainAspect ? Math.max(1, Math.round(item.height * cellWidth / item.width)) : (requestedHeight || maxHeight);
      } else if (sizeMode === 'equalHeight') {
        cellHeight = requestedHeight || maxHeight;
        cellWidth = maintainAspect ? Math.max(1, Math.round(item.width * cellHeight / item.height)) : (requestedWidth || maxWidth);
      }
      cells.push({ width: cellWidth, height: cellHeight, source: item, index });
    }

    const columnWidths = [];
    const rowHeights = [];
    for (let column = 0; column < cols; column++) {
      columnWidths[column] = Math.max.apply(null, cells.filter((cell, index) => index % cols === column).map(cell => cell.width));
    }
    for (let row = 0; row < rows; row++) {
      rowHeights[row] = Math.max.apply(null, cells.slice(row * cols, row * cols + cols).map(cell => cell.height));
    }
    const width = border * 2 + columnWidths.reduce((a, b) => a + b, 0) + gap * Math.max(0, cols - 1);
    const height = border * 2 + rowHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows - 1);
    const align = opts.align === 'start' || opts.align === 'end' ? opts.align : 'center';

    cells.forEach((cell, index) => {
      const column = index % cols;
      const row = Math.floor(index / cols);
      const boxWidth = columnWidths[column];
      const boxHeight = rowHeights[row];
      let x = border;
      for (let c = 0; c < column; c++) x += columnWidths[c] + gap;
      let y = border;
      for (let r = 0; r < row; r++) y += rowHeights[r] + gap;
      const fitted = fitBox(cell.source.width, cell.source.height, boxWidth, boxHeight, fitMode);
      let drawX = x;
      let drawY = y;
      if (fitMode !== 'stretch') {
        if (align === 'start') { /* already at top-left */ }
        else if (align === 'end') { drawX = x + boxWidth - fitted.w; drawY = y + boxHeight - fitted.h; }
        else { drawX = x + Math.floor((boxWidth - fitted.w) / 2); drawY = y + Math.floor((boxHeight - fitted.h) / 2); }
      }
      cell.x = x;
      cell.y = y;
      cell.boxWidth = boxWidth;
      cell.boxHeight = boxHeight;
      cell.drawX = drawX;
      cell.drawY = drawY;
      Object.assign(cell, fitted);
    });

    return { width, height, cells, columns: cols, rows };
  }

  /* ---------- Structured QR payloads ---------- */

  function escapeWifi(value) { return String(value || '').replace(/([\\;,:"])/g, '\\$1'); }

  function buildPayload(type, fields) {
    const data = fields || {};
    const value = name => String(data[name] == null ? '' : data[name]).trim();
    const required = (name, message) => {
      const text = value(name);
      if (!text) return { ok: false, message: message };
      return { ok: true, text };
    };
    let result;
    switch (type) {
      case 'url': {
        result = required('url', 'Enter the URL to encode.');
        if (!result.ok) return result;
        if (!/^https?:\/\//i.test(result.text)) result.text = 'https://' + result.text;
        try { new URL(result.text); } catch (error) { return { ok: false, message: 'That URL is not valid.' }; }
        return { ok: true, value: result.text };
      }
      case 'email': {
        result = required('email', 'Enter the recipient email address.');
        if (!result.ok) return result;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.text)) return { ok: false, message: 'Enter a valid email address.' };
        let payload = 'mailto:' + result.text;
        const params = [];
        if (value('subject')) params.push('subject=' + encodeURIComponent(value('subject')));
        if (value('body')) params.push('body=' + encodeURIComponent(value('body')));
        if (params.length) payload += '?' + params.join('&');
        return { ok: true, value: payload };
      }
      case 'phone': {
        result = required('phone', 'Enter the phone number.');
        if (!result.ok) return result;
        return { ok: true, value: 'tel:' + result.text.replace(/\s+/g, '') };
      }
      case 'sms': {
        result = required('phone', 'Enter the phone number for the SMS.');
        if (!result.ok) return result;
        return { ok: true, value: 'SMSTO:' + result.text.replace(/\s+/g, '') + ':' + value('message') };
      }
      case 'wifi': {
        result = required('ssid', 'Enter the Wi-Fi network name.');
        if (!result.ok) return result;
        const hidden = data.hidden ? 'true' : 'false';
        return {
          ok: true,
          value: 'WIFI:T:' + value('encryption') + ';S:' + escapeWifi(result.text) +
            ';P:' + escapeWifi(value('password')) + ';H:' + hidden + ';;'
        };
      }
      case 'vcard': {
        const name = required('name', 'Enter a name for the contact.');
        if (!name.ok) return name;
        const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + name.text];
        if (value('org')) lines.push('ORG:' + value('org'));
        if (value('phone')) lines.push('TEL:' + value('phone'));
        if (value('email')) lines.push('EMAIL:' + value('email'));
        if (value('url')) lines.push('URL:' + value('url'));
        lines.push('END:VCARD');
        return { ok: true, value: lines.join('\n') };
      }
      case 'location': {
        const lat = Number(data.latitude);
        const lon = Number(data.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return { ok: false, message: 'Enter a latitude from -90 to 90 and a longitude from -180 to 180.' };
        }
        return { ok: true, value: 'geo:' + lat + ',' + lon };
      }
      case 'calendar': {
        const title = required('title', 'Enter an event title.');
        if (!title.ok) return title;
        const stamp = text => String(text || '').replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const start = stamp(value('start'));
        const end = stamp(value('end'));
        if (!/^\d{8}T\d{6}Z?$/.test(start) || !/^\d{8}T\d{6}Z?$/.test(end)) {
          return { ok: false, message: 'Enter local start and end times in YYYY-MM-DDTHH:mm format.' };
        }
        const lines = ['BEGIN:VEVENT', 'SUMMARY:' + title.text, 'DTSTART:' + start, 'DTEND:' + end];
        if (value('location')) lines.push('LOCATION:' + value('location'));
        lines.push('END:VEVENT');
        return { ok: true, value: lines.join('\n') };
      }
      case 'whatsapp': {
        result = required('phone', 'Enter the WhatsApp number.');
        if (!result.ok) return result;
        const number = result.text.replace(/[^\d+]/g, '');
        if (number.length < 7) return { ok: false, message: 'Enter a valid international phone number.' };
        return {
          ok: true,
          value: 'https://wa.me/' + number.replace(/^\+/, '') + (value('message') ? '?text=' + encodeURIComponent(value('message')) : '')
        };
      }
      case 'text':
      default: {
        result = required('text', 'Enter the text to encode.');
        if (!result.ok) return result;
        return { ok: true, value: result.text };
      }
    }
  }

  /* ---------- Local 1D barcode encoders ---------- */

  const CODE39 = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
    '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
    '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw',
    C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
    G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
    K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
    O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
    S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
    W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
    '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
    '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn'
  };

  const CODE128_PATTERNS = [
    '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
    '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
    '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
    '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
    '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
    '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
    '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
    '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
    '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
    '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
    '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
    '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
    '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
    '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
    '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
    '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
    '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
    '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
    '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
    '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
    '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
    '11010011100', '1100011101011'
  ];

  const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

  function checkDigit(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (digits.length % 2 === 0 ? (i % 2 === 0 ? 3 : 1) : (i % 2 === 0 ? 1 : 3));
    return (10 - (sum % 10)) % 10;
  }

  function code39Bits(value) {
    const text = String(value || '').toUpperCase();
    if (!text || !/^[0-9A-Z\-.$/+% ]+$/.test(text)) return null;
    let bits = '';
    ('*' + text + '*').split('').forEach((char, charIndex, array) => {
      const pattern = CODE39[char];
      if (!pattern) return;
      for (let i = 0; i < pattern.length; i++) {
        const wide = pattern[i] === 'w';
        bits += (i % 2 === 0 ? (wide ? '111' : '1') : (wide ? '000' : '0'));
      }
      if (charIndex < array.length - 1) bits += '0';
    });
    return { bits: '0'.repeat(10) + bits + '0'.repeat(10), text };
  }

  function code128Bits(value) {
    const text = String(value || '');
    if (!text || /[^\x20-\x7E]/.test(text)) return null;
    let values;
    let set;
    if (/^\d+$/.test(text) && text.length >= 2 && text.length % 2 === 0) {
      set = 'C';
      values = [105];
      for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
    } else {
      set = 'B';
      values = [104];
      for (let i = 0; i < text.length; i++) values.push(text.charCodeAt(i) - 32);
    }
    let total = values[0];
    values.slice(1).forEach((item, index) => { total += item * (index + 1); });
    const check = total % 103;
    const bits = values.concat([check]).map(code => CODE128_PATTERNS[code]).join('') + CODE128_PATTERNS[106];
    return { bits: '0'.repeat(10) + bits + '0'.repeat(10), text, set, check };
  }

  function eanBits(value, type) {
    const text = String(value || '').replace(/[\s-]/g, '');
    const lengths = { ean13: 12, ean8: 7, upca: 11 };
    const length = lengths[type];
    if (!length || !new RegExp('^\\d{' + length + '}$').test(text)) return null;
    const digits = text + String(checkDigit(text));
    let bits = '101';
    if (type === 'ean13') {
      const parity = EAN_PARITY[Number(digits[0])];
      for (let i = 1; i <= 6; i++) bits += EAN_L[Number(digits[i])].split('').map(bit => parity[i - 1] === 'G' ? (bit === '1' ? '0' : '1') : bit).join('');
      bits += '01010';
      for (let i = 7; i <= 12; i++) bits += EAN_R[Number(digits[i])];
    } else if (type === 'ean8') {
      for (let i = 0; i < 4; i++) bits += EAN_L[Number(digits[i])];
      bits += '01010';
      for (let i = 4; i < 8; i++) bits += EAN_R[Number(digits[i])];
    } else {
      for (let i = 0; i < 6; i++) bits += EAN_L[Number(digits[i])];
      bits += '01010';
      for (let i = 6; i < 12; i++) bits += EAN_L[Number(digits[i])];
    }
    return { bits: '0'.repeat(10) + bits + '101' + '0'.repeat(10), text: digits, check: Number(digits[digits.length - 1]) };
  }

  function itfBits(value) {
    const text = String(value || '').replace(/\s/g, '');
    if (!/^\d+$/.test(text) || text.length < 2 || text.length % 2) return null;
    let bits = '1010';
    for (let i = 0; i < text.length; i += 2) {
      const bars = ITF[Number(text[i])];
      const spaces = ITF[Number(text[i + 1])];
      for (let element = 0; element < 5; element++) {
        bits += (bars[element] === 'w' ? '111' : '1') + (spaces[element] === 'w' ? '000' : '0');
      }
    }
    bits += '11101';
    return { bits: '0'.repeat(10) + bits + '0'.repeat(10), text };
  }

  const BARCODE_TYPES = ['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf'];

  /* Returns { ok, bits, text, check, set, reason }. Modules are a bit string
   * where '1' is a dark module; quiet zones are included for direct drawing. */
  function barcodeEncode(type, value) {
    const normalized = String(type || '').toLowerCase();
    if (BARCODE_TYPES.indexOf(normalized) === -1) {
      return { ok: false, reason: 'This barcode format is not available locally.' };
    }
    const encoded = normalized === 'code128' ? code128Bits(value)
      : normalized === 'code39' ? code39Bits(value)
        : normalized === 'itf' ? itfBits(value)
          : eanBits(value, normalized);
    if (!encoded) {
      const hints = {
        code128: 'Code 128 accepts printable ASCII (1–48 characters).',
        code39: 'Code 39 accepts uppercase letters, digits and -.$/+%*.',
        ean13: 'EAN-13 needs 12 digits; the check digit is added for you.',
        ean8: 'EAN-8 needs 7 digits; the check digit is added for you.',
        upca: 'UPC-A needs 11 digits; the check digit is added for you.',
        itf: 'ITF needs an even number of digits (at least two).'
      };
      return { ok: false, reason: hints[normalized] || 'Invalid barcode value.' };
    }
    return Object.assign({ ok: true, type: normalized }, encoded);
  }

  return {
    MAX_FILE_BYTES,
    MAX_PIXELS,
    MAX_DIMENSION,
    HEIF_BRANDS,
    BARCODE_TYPES,
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
    cropAspectRect,
    withinLimits,
    detectHeifBrand,
    exifOrientation,
    adjustImageData,
    sharpen,
    boxBlur,
    rotatedBounds,
    rotateArbitrary,
    removeBackground,
    mosaicLayout,
    buildPayload,
    barcodeEncode
  };
});
