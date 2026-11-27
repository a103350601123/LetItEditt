/* LetitEdit image processing core.
 * Shared by the editor (fallback) and the Web Worker (primary).
 * Pure pixel operations with no DOM dependency.
 */
(function (root) {
  'use strict';

  function clamp(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
  }

  function luma(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastChannel(channel, factor) {
    return (channel - 128) * factor + 128;
  }

  function hash(x, y, seed) {
    let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function applyPreset(r, g, b, preset, t) {
    if (!t || !preset || preset === 'none') return [r, g, b];
    const l = luma(r, g, b);
    let nr = r;
    let ng = g;
    let nb = b;

    switch (preset) {
      case 'bw':
      case 'grayscale':
        nr = ng = nb = l;
        nr = contrastChannel(nr, 1.08);
        ng = contrastChannel(ng, 1.08);
        nb = contrastChannel(nb, 1.08);
        break;
      case 'sepia':
        nr = 0.393 * r + 0.769 * g + 0.189 * b;
        ng = 0.349 * r + 0.686 * g + 0.168 * b;
        nb = 0.272 * r + 0.534 * g + 0.131 * b;
        break;
      case 'vintage':
        nr = 0.36 * r + 0.7 * g + 0.17 * b + 8;
        ng = 0.32 * r + 0.63 * g + 0.15 * b + 5;
        nb = 0.25 * r + 0.49 * g + 0.12 * b + 2;
        nr = contrastChannel(nr, 0.94);
        ng = contrastChannel(ng, 0.94);
        nb = contrastChannel(nb, 0.94);
        break;
      case 'warm':
        nr += 22;
        ng += 6;
        nb -= 20;
        break;
      case 'cool':
        nr -= 20;
        ng += 2;
        nb += 22;
        break;
      case 'cinematic':
        nr = contrastChannel(nr, 1.12);
        ng = contrastChannel(ng, 1.1);
        nb = contrastChannel(nb, 1.1);
        if (l < 110) { nb += 12; ng += 4; } else { nr += 10; ng += 2; }
        break;
      case 'portrait':
        nr += 8;
        ng += 3;
        nr = contrastChannel(nr, 1.04);
        ng = contrastChannel(ng, 1.04);
        nb = contrastChannel(nb, 1.04);
        if (l < 100) { nr += 4; ng += 3; nb += 3; }
        break;
      case 'landscape':
        nr = l + (r - l) * 1.2;
        ng = l + (g - l) * 1.2;
        nb = l + (b - l) * 1.2;
        nr = contrastChannel(nr, 1.08);
        ng = contrastChannel(ng, 1.08);
        nb = contrastChannel(nb, 1.08);
        break;
      case 'dramatic':
        nr = contrastChannel(nr, 1.26);
        ng = contrastChannel(ng, 1.26);
        nb = contrastChannel(nb, 1.26);
        nr = l + (nr - l) * 0.94;
        ng = l + (ng - l) * 0.94;
        nb = l + (nb - l) * 0.94;
        break;
      case 'soft':
        nr = contrastChannel(nr, 0.92) + 5;
        ng = contrastChannel(ng, 0.92) + 5;
        nb = contrastChannel(nb, 0.92) + 5;
        break;
      case 'matte':
        nr = contrastChannel(nr, 0.9) + 10;
        ng = contrastChannel(ng, 0.9) + 10;
        nb = contrastChannel(nb, 0.9) + 10;
        break;
      case 'high-contrast':
        nr = contrastChannel(nr, 1.32);
        ng = contrastChannel(ng, 1.32);
        nb = contrastChannel(nb, 1.32);
        break;
      case 'film':
        nr += 6;
        ng += 3;
        nb -= 2;
        nr = contrastChannel(nr, 1.04) + 3;
        ng = contrastChannel(ng, 1.04) + 3;
        nb = contrastChannel(nb, 1.04) + 3;
        break;
      case 'vivid':
        nr = l + (r - l) * 1.38;
        ng = l + (g - l) * 1.38;
        nb = l + (b - l) * 1.38;
        break;
      case 'noir':
        nr = ng = nb = contrastChannel(l, 1.28);
        break;
      case 'sunset':
        nr += 20;
        ng += 6;
        nb -= 14;
        break;
      case 'arctic':
        nr -= 14;
        ng += 2;
        nb += 20;
        break;
      default:
        return [r, g, b];
    }

    return [
      r + (nr - r) * t,
      g + (ng - g) * t,
      b + (nb - b) * t
    ];
  }

  function processImageData(imageData, settings) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const adjustments = settings.adjustments || {};
    const filter = settings.filter || {};
    const a = {
      brightness: Number(adjustments.brightness) || 0,
      contrast: Number(adjustments.contrast) || 0,
      exposure: Number(adjustments.exposure) || 0,
      saturation: Number(adjustments.saturation) || 0,
      vibrance: Number(adjustments.vibrance) || 0,
      temperature: Number(adjustments.temperature) || 0,
      tint: Number(adjustments.tint) || 0,
      highlights: Number(adjustments.highlights) || 0,
      shadows: Number(adjustments.shadows) || 0,
      whites: Number(adjustments.whites) || 0,
      blacks: Number(adjustments.blacks) || 0,
      gamma: Number(adjustments.gamma) || 1,
      sharpness: Number(adjustments.sharpness) || 0,
      clarity: Number(adjustments.clarity) || 0,
      fade: Number(adjustments.fade) || 0,
      vignette: Number(adjustments.vignette) || 0,
      grain: Number(adjustments.grain) || 0
    };

    const exposure = Math.pow(2, a.exposure / 100);
    const brightness = a.brightness * 2.55;
    const contrastValue = a.contrast * 2.55;
    const contrastFactor = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
    const saturation = 1 + a.saturation / 100;
    const vibrance = a.vibrance / 100;
    const temp = a.temperature / 100;
    const tint = a.tint / 100;
    const highlights = a.highlights / 100;
    const shadows = a.shadows / 100;
    const whites = a.whites / 100;
    const blacks = a.blacks / 100;
    const gamma = a.gamma <= 0 ? 1 : a.gamma;
    const invGamma = 1 / gamma;
    const fade = a.fade / 100;
    const vignette = a.vignette / 100;
    const grain = a.grain / 100;
    const preset = filter.name || 'none';
    const presetIntensity = preset === 'none' ? 0 : Math.max(0, Math.min(1, (Number(filter.intensity) || 0) / 100));
    const needsTone = exposure !== 1 || brightness !== 0 || contrastValue !== 0 || saturation !== 1 ||
      vibrance !== 0 || temp !== 0 || tint !== 0 || highlights !== 0 || shadows !== 0 ||
      whites !== 0 || blacks !== 0 || gamma !== 1 || fade !== 0 || vignette !== 0 ||
      grain !== 0 || presetIntensity !== 0;
    const seed = Number(settings.seed) || 1;

    if (needsTone) {
      for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        if (exposure !== 1) { r *= exposure; g *= exposure; b *= exposure; }
        if (brightness !== 0) { r += brightness; g += brightness; b += brightness; }

        if (temp !== 0) {
          r += temp * 30;
          g += temp * 4;
          b -= temp * 30;
        }
        if (tint !== 0) {
          r += tint * 10;
          g -= tint * 18;
          b += tint * 10;
        }

        if (saturation !== 1) {
          const l = luma(r, g, b);
          r = l + (r - l) * saturation;
          g = l + (g - l) * saturation;
          b = l + (b - l) * saturation;
        }

        if (vibrance !== 0) {
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const amount = vibrance * (1 - (max - min) / 255) * 0.9;
          const l = luma(r, g, b);
          r = l + (r - l) * (1 + amount);
          g = l + (g - l) * (1 + amount);
          b = l + (b - l) * (1 + amount);
        }

        if (contrastValue !== 0) {
          r = contrastChannel(r, contrastFactor);
          g = contrastChannel(g, contrastFactor);
          b = contrastChannel(b, contrastFactor);
        }

        if (highlights !== 0 || shadows !== 0 || whites !== 0 || blacks !== 0) {
          const l = luma(r, g, b) / 255;
          const shadowLift = shadows * Math.pow(1 - l, 2) * 70;
          const highlightLift = highlights * Math.pow(l, 2) * 70;
          const whiteLift = whites * Math.pow(l, 3) * 55;
          const blackLift = blacks * Math.pow(1 - l, 3) * 55;
          const lift = shadowLift + highlightLift + whiteLift + blackLift;
          r += lift;
          g += lift;
          b += lift;
        }

        if (gamma !== 1) {
          r = Math.pow(clamp(r) / 255, invGamma) * 255;
          g = Math.pow(clamp(g) / 255, invGamma) * 255;
          b = Math.pow(clamp(b) / 255, invGamma) * 255;
        }

        if (presetIntensity !== 0) {
          const filtered = applyPreset(r, g, b, preset, presetIntensity);
          r = filtered[0];
          g = filtered[1];
          b = filtered[2];
        }

        if (fade !== 0) {
          r = r * (1 - fade * 0.35) + 255 * fade * 0.16;
          g = g * (1 - fade * 0.35) + 255 * fade * 0.16;
          b = b * (1 - fade * 0.35) + 255 * fade * 0.16;
        }

        if (vignette !== 0) {
          const x = (pixel % width) / width - 0.5;
          const y = Math.floor(pixel / width) / height - 0.5;
          const distance = Math.sqrt(x * x + y * y) / 0.7071;
          const factor = 1 - vignette * 0.82 * Math.pow(Math.min(1, distance), 2.1);
          r *= factor;
          g *= factor;
          b *= factor;
        }

        if (grain !== 0) {
          const x = pixel % width;
          const y = Math.floor(pixel / width);
          const noise = (hash(x, y, seed) - 0.5) * 2;
          const amount = grain * 38 * noise;
          r += amount;
          g += amount;
          b += amount;
        }

        data[i] = clamp(r);
        data[i + 1] = clamp(g);
        data[i + 2] = clamp(b);
      }
    }

    const sharpen = (a.sharpness / 100) * 0.85;
    const clarity = (a.clarity / 100) * 0.55;
    if (sharpen > 0.001 || clarity > 0.001) {
      const amount = sharpen + clarity;
      const source = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          let r = 0;
          let g = 0;
          let b = 0;
          let count = 0;
          for (let oy = -1; oy <= 1; oy += 1) {
            const sy = Math.max(0, Math.min(height - 1, y + oy));
            for (let ox = -1; ox <= 1; ox += 1) {
              const sx = Math.max(0, Math.min(width - 1, x + ox));
              const sIndex = (sy * width + sx) * 4;
              r += source[sIndex];
              g += source[sIndex + 1];
              b += source[sIndex + 2];
              count += 1;
            }
          }
          data[index] = clamp(source[index] + (source[index] - r / count) * amount);
          data[index + 1] = clamp(source[index + 1] + (source[index + 1] - g / count) * amount);
          data[index + 2] = clamp(source[index + 2] + (source[index + 2] - b / count) * amount);
        }
      }
    }

    return imageData;
  }

  root.LetitEditImageProcessing = { processImageData: processImageData };
})(typeof self !== 'undefined' ? self : this);
