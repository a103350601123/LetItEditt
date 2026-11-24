/* LetitEdit Professional Video Editor — filters, colour grading and the
 * transition library.
 *
 * Everything in this module is pure Canvas 2D so the exact same code renders
 * the preview on the page and the final frames inside the export worker.
 */

import { clamp, ease, withAlpha, seededRandom } from './utils.js';

/* -------------------------------------------------------------------------
 * Filters
 * ---------------------------------------------------------------------- */

export const FILTERS = [
  { id: 'none', label: 'Original', css: 'none' },
  { id: 'bw', label: 'Black & White', css: 'grayscale(1) contrast(1.18)' },
  { id: 'grayscale', label: 'Grayscale', css: 'grayscale(1)' },
  { id: 'sepia', label: 'Sepia', css: 'sepia(0.9) contrast(1.05)' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.45) saturate(0.78) contrast(1.12) brightness(0.96)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.22) saturate(1.22) hue-rotate(-9deg) brightness(1.03)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.12) hue-rotate(14deg) brightness(1.02)' },
  { id: 'cinematic', label: 'Cinematic', css: 'contrast(1.28) saturate(0.86) brightness(0.94)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.65) contrast(1.12)' },
  { id: 'faded', label: 'Faded', css: 'saturate(0.68) contrast(0.84) brightness(1.09)' },
  { id: 'dramatic', label: 'Dramatic', css: 'contrast(1.48) saturate(0.92) brightness(0.9)' },
  { id: 'bright', label: 'Bright', css: 'brightness(1.28)' },
  { id: 'dark', label: 'Dark', css: 'brightness(0.72) contrast(1.08)' },
  { id: 'highcontrast', label: 'High Contrast', css: 'contrast(1.55) saturate(1.05)' },
  { id: 'soft', label: 'Soft', css: 'blur(0.7px) brightness(1.06) contrast(0.94)' },
  { id: 'film', label: 'Film Look', css: 'sepia(0.18) contrast(1.16) saturate(1.06) brightness(0.98)' },
  { id: 'retro', label: 'Retro', css: 'sepia(0.34) hue-rotate(-14deg) saturate(1.18) contrast(0.96)' },
  { id: 'monochrome', label: 'Monochrome', css: 'grayscale(1) brightness(1.06) contrast(1.12)' }
];

const FILTER_LOOKUP = new Map(FILTERS.map((filter) => [filter.id, filter]));

export function filterLabel(id) {
  const found = FILTER_LOOKUP.get(id);
  return found ? found.label : 'Original';
}

export function filterCss(id) {
  const found = FILTER_LOOKUP.get(id);
  return found ? found.css : 'none';
}

function makeCanvas(width, height) {
  return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function copyCanvas(canvas) {
  const copy = makeCanvas(canvas.width, canvas.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  return copy;
}

/* Blend a CSS-filtered copy over the original for intensity control. */
export function applyFilter(canvas, filterId, intensity = 1) {
  const css = filterCss(filterId);
  const amount = clamp(Number(intensity), 0, 1);
  if (css === 'none' || amount <= 0.001) return canvas;

  const base = copyCanvas(canvas);
  const filtered = makeCanvas(canvas.width, canvas.height);
  const fctx = filtered.getContext('2d');
  fctx.filter = css;
  fctx.drawImage(base, 0, 0);

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  ctx.globalAlpha = amount;
  ctx.drawImage(filtered, 0, 0);
  ctx.restore();
  return canvas;
}

/* Colour correction and light grading ---------------------------------- */

function gradeFilterString(color) {
  const brightness = 1 + (Number(color.brightness) || 0) / 130 + (Number(color.exposure) || 0) / 160;
  const contrast = 1 + (Number(color.contrast) || 0) / 130;
  const saturation = Math.max(0, 1 + (Number(color.saturation) || 0) / 100);
  const parts = [];
  if (Math.abs(brightness - 1) > 0.002) parts.push(`brightness(${brightness.toFixed(3)})`);
  if (Math.abs(contrast - 1) > 0.002) parts.push(`contrast(${contrast.toFixed(3)})`);
  if (Math.abs(saturation - 1) > 0.002) parts.push(`saturate(${saturation.toFixed(3)})`);
  return parts.length ? parts.join(' ') : 'none';
}

export function hasGrade(color) {
  if (!color) return false;
  return Object.values(color).some((value) => Math.abs(Number(value) || 0) > 0.001);
}

export function applyGrade(canvas, clip) {
  const color = clip && clip.color ? clip.color : null;
  const filterId = clip ? clip.filter : 'none';
  const filterIntensity = clip ? clip.filterIntensity : 1;
  if (filterId && filterId !== 'none' && filterIntensity > 0) {
    canvas = applyFilter(canvas, filterId, filterIntensity);
  }
  if (!hasGrade(color)) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');

  const css = gradeFilterString(color);
  if (css !== 'none') {
    const base = copyCanvas(canvas);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = css;
    ctx.drawImage(base, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
  }

  const temp = makeCanvas(width, height);
  const tctx = temp.getContext('2d');

  const temperature = Number(color.temperature) || 0;
  if (Math.abs(temperature) > 0.5) {
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'soft-light';
    tctx.fillStyle = temperature > 0
      ? `rgba(255, 138, 40, ${clamp(Math.abs(temperature) / 260, 0, 0.55)})`
      : `rgba(40, 120, 255, ${clamp(Math.abs(temperature) / 260, 0, 0.55)})`;
    tctx.fillRect(0, 0, width, height);
    tctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }

  const tint = Number(color.tint) || 0;
  if (Math.abs(tint) > 0.5) {
    tctx.clearRect(0, 0, width, height);
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'soft-light';
    tctx.fillStyle = tint > 0
      ? `rgba(255, 0, 200, ${clamp(Math.abs(tint) / 320, 0, 0.45)})`
      : `rgba(0, 200, 120, ${clamp(Math.abs(tint) / 320, 0, 0.45)})`;
    tctx.fillRect(0, 0, width, height);
    tctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }

  const highlights = Number(color.highlights) || 0;
  if (Math.abs(highlights) > 0.5) {
    tctx.clearRect(0, 0, width, height);
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = highlights > 0 ? 'screen' : 'multiply';
    const gradient = tctx.createLinearGradient(0, 0, 0, height);
    const alpha = clamp(Math.abs(highlights) / 230, 0, 0.45);
    const colorValue = highlights > 0 ? '255, 255, 255' : '0, 0, 0';
    gradient.addColorStop(0, `rgba(${colorValue}, ${alpha})`);
    gradient.addColorStop(0.55, `rgba(${colorValue}, ${alpha * 0.18})`);
    gradient.addColorStop(1, `rgba(${colorValue}, 0)`);
    tctx.fillStyle = gradient;
    tctx.fillRect(0, 0, width, height);
    tctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }

  const shadows = Number(color.shadows) || 0;
  if (Math.abs(shadows) > 0.5) {
    tctx.clearRect(0, 0, width, height);
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = shadows > 0 ? 'screen' : 'multiply';
    const gradient = tctx.createLinearGradient(0, height, 0, 0);
    const alpha = clamp(Math.abs(shadows) / 240, 0, 0.4);
    const colorValue = shadows > 0 ? '70, 90, 120' : '0, 0, 0';
    gradient.addColorStop(0, `rgba(${colorValue}, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(${colorValue}, ${alpha * 0.15})`);
    gradient.addColorStop(1, `rgba(${colorValue}, 0)`);
    tctx.fillStyle = gradient;
    tctx.fillRect(0, 0, width, height);
    tctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }

  const vignette = Number(color.vignette) || 0;
  if (vignette > 0.5) {
    tctx.clearRect(0, 0, width, height);
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    const radius = Math.hypot(width, height) * 0.62;
    const gradient = tctx.createRadialGradient(width / 2, height / 2, radius * 0.35, width / 2, height / 2, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${clamp(vignette / 130, 0, 0.85)})`);
    tctx.fillStyle = gradient;
    tctx.globalCompositeOperation = 'source-over';
    tctx.fillRect(0, 0, width, height);
    tctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }

  const fade = Number(color.fade) || 0;
  if (fade > 0.5) {
    tctx.clearRect(0, 0, width, height);
    tctx.save();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    tctx.fillStyle = `rgba(255, 250, 240, ${clamp(fade / 260, 0, 0.4)})`;
    tctx.fillRect(0, 0, width, height);
    tctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  }

  const gamma = Number(color.gamma) || 0;
  if (Math.abs(gamma) > 0.5) {
    const exponent = 1 / clamp(1 + gamma / 100, 0.35, 2.6);
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i += 1) lut[i] = Math.round(255 * (i / 255) ** exponent);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
    ctx.putImageData(image, 0, 0);
  }

  const sharpness = Number(color.sharpness) || 0;
  if (sharpness > 0.5) {
    const amount = clamp(sharpness / 100, 0, 1) * 0.9;
    const image = ctx.getImageData(0, 0, width, height);
    const src = new Uint8ClampedArray(image.data);
    const data = image.data;
    const center = 1 + 4 * amount;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const value = center * src[index + channel]
            - amount * (src[index - 4 + channel] + src[index + 4 + channel]
              + src[index - width * 4 + channel] + src[index + width * 4 + channel]);
          data[index + channel] = value;
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  return canvas;
}

/* -------------------------------------------------------------------------
 * Transitions
 * ---------------------------------------------------------------------- */

export const TRANSITION_GROUPS = [
  {
    id: 'basic',
    label: 'Basic',
    items: [
      ['cross-dissolve', 'Cross Dissolve'],
      ['fade-through-black', 'Fade Through Black'],
      ['fade-through-white', 'Fade Through White'],
      ['dip-to-black', 'Dip to Black'],
      ['dip-to-white', 'Dip to White'],
      ['cut', 'Cut'],
      ['smooth-fade', 'Smooth Fade'],
      ['film-fade', 'Film Fade']
    ]
  },
  {
    id: 'slide',
    label: 'Slide & Push',
    items: [
      ['slide-left', 'Slide Left'],
      ['slide-right', 'Slide Right'],
      ['slide-up', 'Slide Up'],
      ['slide-down', 'Slide Down'],
      ['push-left', 'Push Left'],
      ['push-right', 'Push Right'],
      ['push-up', 'Push Up'],
      ['push-down', 'Push Down'],
      ['split-horizontal', 'Split Horizontal'],
      ['split-vertical', 'Split Vertical']
    ]
  },
  {
    id: 'wipe',
    label: 'Wipe & Reveal',
    items: [
      ['wipe-left', 'Wipe Left'],
      ['wipe-right', 'Wipe Right'],
      ['wipe-up', 'Wipe Up'],
      ['wipe-down', 'Wipe Down'],
      ['diagonal-wipe', 'Diagonal Wipe'],
      ['circular-wipe', 'Circular Wipe'],
      ['iris-in', 'Iris In'],
      ['iris-out', 'Iris Out'],
      ['clock-wipe', 'Clock Wipe'],
      ['barn-door', 'Barn Door']
    ]
  },
  {
    id: 'zoom',
    label: 'Zoom',
    items: [
      ['zoom-in', 'Zoom In'],
      ['zoom-out', 'Zoom Out'],
      ['zoom-through', 'Zoom Through'],
      ['zoom-blur', 'Zoom Blur'],
      ['smooth-zoom', 'Smooth Zoom'],
      ['dynamic-zoom', 'Dynamic Zoom']
    ]
  },
  {
    id: 'motion',
    label: 'Motion',
    items: [
      ['rotate-in', 'Rotate In'],
      ['rotate-out', 'Rotate Out'],
      ['spin', 'Spin'],
      ['whip-pan-left', 'Whip Pan Left'],
      ['whip-pan-right', 'Whip Pan Right'],
      ['motion-blur', 'Motion Blur'],
      ['camera-shake', 'Camera Shake'],
      ['pan', 'Pan']
    ]
  },
  {
    id: 'stylised',
    label: 'Stylised',
    items: [
      ['glitch', 'Glitch'],
      ['rgb-split', 'RGB Split'],
      ['pixelate', 'Pixelate'],
      ['mosaic', 'Mosaic'],
      ['blur-dissolve', 'Blur Dissolve'],
      ['light-leak', 'Light Leak'],
      ['flash', 'Flash'],
      ['film-burn', 'Film Burn'],
      ['ripple', 'Ripple'],
      ['wave', 'Wave'],
      ['page-turn', 'Page Turn'],
      ['shatter', 'Shatter'],
      ['swirl', 'Swirl'],
      ['luma-fade', 'Luma Fade']
    ]
  }
];

export const TRANSITIONS = TRANSITION_GROUPS.flatMap((group) =>
  group.items.map(([id, label]) => ({ id, label, group: group.id, groupLabel: group.label }))
);

const TRANSITION_LOOKUP = new Map(TRANSITIONS.map((item) => [item.id, item]));

export function transitionLabel(id) {
  const found = TRANSITION_LOOKUP.get(id);
  return found ? found.label : 'None';
}

function paint(ctx, src, dx = 0, dy = 0, alpha = 1, filter = 'none') {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.globalCompositeOperation = 'source-over';
  if (filter !== 'none') ctx.filter = filter;
  ctx.drawImage(src, dx, dy, W, H);
  ctx.restore();
}

function paintRegion(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh, alpha = 1, filter = 'none') {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (filter !== 'none') ctx.filter = filter;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function paintScaled(ctx, src, scale, rotation = 0, alpha = 1, dx = 0, dy = 0, filter = 'none') {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (filter !== 'none') ctx.filter = filter;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.drawImage(src, -W / 2, -H / 2, W, H);
  ctx.restore();
}

function rectClip(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

function easeInOut(t) {
  return ease('easeInOut', t);
}

function blurredCopy(src, amount) {
  if (amount <= 0.2) return src;
  const canvas = makeCanvas(src.width, src.height);
  const ctx = canvas.getContext('2d');
  ctx.filter = `blur(${amount.toFixed(2)}px)`;
  ctx.drawImage(src, 0, 0);
  return canvas;
}

function pixelatedCopy(src, block) {
  const size = Math.max(2, Math.round(block));
  const small = makeCanvas(Math.max(1, Math.ceil(src.width / size)), Math.max(1, Math.ceil(src.height / size)));
  const sctx = small.getContext('2d');
  sctx.drawImage(src, 0, 0, small.width, small.height);
  const out = makeCanvas(src.width, src.height);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function channelShift(src, dx, tint, alpha) {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  const result = makeCanvas(src.width, src.height);
  const rctx = result.getContext('2d');
  rctx.globalAlpha = alpha;
  rctx.drawImage(out, dx, 0);
  return result;
}

/**
 * Draw a transition from canvas `a` (outgoing) to canvas `b` (incoming).
 * `progress` goes 0 → 1.
 */
export function drawTransition(ctx, a, b, progress, type) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const t = clamp(progress, 0, 1);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, W, H);

  switch (type) {
    /* ---------------- Basic ---------------- */
    case 'cross-dissolve': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
      break;
    }
    case 'fade-through-black': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (t < 0.5) paint(ctx, a, 0, 0, 1 - t * 2);
      else paint(ctx, b, 0, 0, (t - 0.5) * 2);
      break;
    }
    case 'fade-through-white': {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      if (t < 0.5) paint(ctx, a, 0, 0, 1 - t * 2);
      else paint(ctx, b, 0, 0, (t - 0.5) * 2);
      break;
    }
    case 'dip-to-black': {
      if (t < 0.35) {
        paint(ctx, a, 0, 0, 1);
        ctx.fillStyle = `rgba(0,0,0,${(t / 0.35)})`;
        ctx.fillRect(0, 0, W, H);
      } else if (t < 0.65) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
      } else {
        paint(ctx, b, 0, 0, 1);
        ctx.fillStyle = `rgba(0,0,0,${1 - (t - 0.65) / 0.35})`;
        ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case 'dip-to-white': {
      if (t < 0.35) {
        paint(ctx, a, 0, 0, 1);
        ctx.fillStyle = `rgba(255,255,255,${t / 0.35})`;
        ctx.fillRect(0, 0, W, H);
      } else if (t < 0.65) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
      } else {
        paint(ctx, b, 0, 0, 1);
        ctx.fillStyle = `rgba(255,255,255,${1 - (t - 0.65) / 0.35})`;
        ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case 'cut': {
      paint(ctx, t < 0.5 ? a : b, 0, 0, 1);
      break;
    }
    case 'smooth-fade': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, easeInOut(t));
      break;
    }
    case 'film-fade': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, easeInOut(t));
      const random = seededRandom(1337);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      for (let i = 0; i < 90; i += 1) {
        const x = random() * W;
        const y = random() * H;
        const alpha = (random() * 0.5 + 0.15) * (1 - Math.abs(t - 0.5) * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.25})`;
        ctx.fillRect(x, y, 1.4, 1.4);
      }
      ctx.restore();
      break;
    }

    /* ---------------- Slide & Push ---------------- */
    case 'slide-left': {
      paint(ctx, a, -Math.round(W * t), 0, 1);
      paint(ctx, b, Math.round(W * (1 - t)), 0, 1);
      break;
    }
    case 'slide-right': {
      paint(ctx, a, Math.round(W * t), 0, 1);
      paint(ctx, b, -Math.round(W * (1 - t)), 0, 1);
      break;
    }
    case 'slide-up': {
      paint(ctx, a, 0, -Math.round(H * t), 1);
      paint(ctx, b, 0, Math.round(H * (1 - t)), 1);
      break;
    }
    case 'slide-down': {
      paint(ctx, a, 0, Math.round(H * t), 1);
      paint(ctx, b, 0, -Math.round(H * (1 - t)), 1);
      break;
    }
    case 'push-left': {
      const offset = Math.round(W * t);
      paint(ctx, a, -offset, 0, 1);
      paint(ctx, b, W - offset, 0, 1);
      break;
    }
    case 'push-right': {
      const offset = Math.round(W * t);
      paint(ctx, a, offset, 0, 1);
      paint(ctx, b, -W + offset, 0, 1);
      break;
    }
    case 'push-up': {
      const offset = Math.round(H * t);
      paint(ctx, a, 0, -offset, 1);
      paint(ctx, b, 0, H - offset, 1);
      break;
    }
    case 'push-down': {
      const offset = Math.round(H * t);
      paint(ctx, a, 0, offset, 1);
      paint(ctx, b, 0, -H + offset, 1);
      break;
    }
    case 'split-horizontal': {
      paint(ctx, b, 0, 0, 1);
      const shift = Math.round(H * t);
      ctx.save();
      rectClip(ctx, 0, 0, W, H / 2);
      paint(ctx, a, 0, -shift, 1);
      ctx.restore();
      ctx.save();
      rectClip(ctx, 0, H / 2, W, H / 2);
      paint(ctx, a, 0, shift, 1);
      ctx.restore();
      break;
    }
    case 'split-vertical': {
      paint(ctx, b, 0, 0, 1);
      const shift = Math.round(W * t);
      ctx.save();
      rectClip(ctx, 0, 0, W / 2, H);
      paint(ctx, a, -shift, 0, 1);
      ctx.restore();
      ctx.save();
      rectClip(ctx, W / 2, 0, W / 2, H);
      paint(ctx, a, shift, 0, 1);
      ctx.restore();
      break;
    }

    /* ---------------- Wipe & Reveal ---------------- */
    case 'wipe-left': {
      paint(ctx, a, 0, 0, 1);
      ctx.save();
      rectClip(ctx, W * (1 - t), 0, W * t, H);
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'wipe-right': {
      paint(ctx, a, 0, 0, 1);
      ctx.save();
      rectClip(ctx, 0, 0, W * t, H);
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'wipe-up': {
      paint(ctx, a, 0, 0, 1);
      ctx.save();
      rectClip(ctx, 0, H * (1 - t), W, H * t);
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'wipe-down': {
      paint(ctx, a, 0, 0, 1);
      ctx.save();
      rectClip(ctx, 0, 0, W, H * t);
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'diagonal-wipe': {
      paint(ctx, a, 0, 0, 1);
      const edge = W * 0.25;
      const pos = (W + H) * t;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-edge, 0);
      ctx.lineTo(pos - edge, 0);
      ctx.lineTo(pos + H - edge, H);
      ctx.lineTo(-edge, H);
      ctx.closePath();
      ctx.clip();
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'circular-wipe': {
      paint(ctx, a, 0, 0, 1);
      const radius = Math.hypot(W, H) * 0.6 * t;
      const mask = makeCanvas(W, H);
      const mctx = mask.getContext('2d');
      const gradient = mctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(1, radius));
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.82, 'rgba(255,255,255,1)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      mctx.fillStyle = gradient;
      mctx.beginPath();
      mctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
      mctx.fill();
      mctx.globalCompositeOperation = 'source-in';
      mctx.drawImage(b, 0, 0);
      ctx.save();
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
      break;
    }
    case 'iris-in': {
      paint(ctx, a, 0, 0, 1);
      const radius = (Math.hypot(W, H) / 2) * ease('easeOut', t);
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
      ctx.clip();
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'iris-out': {
      paint(ctx, b, 0, 0, 1);
      const radius = (Math.hypot(W, H) / 2) * (1 - ease('easeIn', t));
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
      ctx.clip();
      paint(ctx, a, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'clock-wipe': {
      paint(ctx, a, 0, 0, 1);
      const angle = Math.PI * 2 * t;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + angle);
      ctx.closePath();
      ctx.clip();
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }
    case 'barn-door': {
      paint(ctx, a, 0, 0, 1);
      const half = (W / 2) * t;
      ctx.save();
      rectClip(ctx, W / 2 - half, 0, half * 2, H);
      paint(ctx, b, 0, 0, 1);
      ctx.restore();
      break;
    }

    /* ---------------- Zoom ---------------- */
    case 'zoom-in': {
      paintScaled(ctx, b, 0.55 + 0.45 * ease('easeOut', t), 0, t);
      break;
    }
    case 'zoom-out': {
      paint(ctx, b, 0, 0, 1);
      paintScaled(ctx, a, 1 + 0.6 * t, 0, 1 - t);
      break;
    }
    case 'zoom-through': {
      paintScaled(ctx, a, 1 + 1.1 * t, 0, 1 - ease('easeIn', t));
      paintScaled(ctx, b, 0.4 + 0.6 * ease('easeOut', t), 0, ease('easeOut', t));
      break;
    }
    case 'zoom-blur': {
      paintScaled(ctx, a, 1 + 0.4 * t, 0, 1 - t, 0, 0, `blur(${t * 8}px)`);
      paintScaled(ctx, b, 0.75 + 0.25 * ease('easeOut', t), 0, t, 0, 0, `blur(${(1 - t) * 8}px)`);
      break;
    }
    case 'smooth-zoom': {
      const p = easeInOut(t);
      paintScaled(ctx, b, 0.8 + 0.2 * p, 0, p);
      break;
    }
    case 'dynamic-zoom': {
      const p = easeInOut(t);
      paintScaled(ctx, a, 1 + 0.5 * p, -0.08 * p, 1 - p);
      paintScaled(ctx, b, 0.6 + 0.4 * p, 0.1 * (1 - p), p);
      break;
    }

    /* ---------------- Motion ---------------- */
    case 'rotate-in': {
      paintScaled(ctx, b, 0.85 + 0.15 * ease('easeOut', t), (-0.5 + 0.5 * ease('easeOut', t)) * (Math.PI / 4), t);
      break;
    }
    case 'rotate-out': {
      paint(ctx, b, 0, 0, 1);
      paintScaled(ctx, a, 1 + 0.15 * t, (Math.PI / 4) * t, 1 - t);
      break;
    }
    case 'spin': {
      paintScaled(ctx, a, 1, Math.PI * t, 1 - t);
      paintScaled(ctx, b, 1, -Math.PI * (1 - t), t);
      break;
    }
    case 'whip-pan-left': {
      const offset = W * easeInOut(t);
      paint(ctx, a, -offset * 1.2, 0, 1 - t, `blur(${8 * t}px)`);
      paint(ctx, b, W * 1.2 - offset * 1.2, 0, t, `blur(${8 * (1 - t)}px)`);
      break;
    }
    case 'whip-pan-right': {
      const offset = W * easeInOut(t);
      paint(ctx, a, offset * 1.2, 0, 1 - t, `blur(${8 * t}px)`);
      paint(ctx, b, -W * 1.2 + offset * 1.2, 0, t, `blur(${8 * (1 - t)}px)`);
      break;
    }
    case 'motion-blur': {
      const blur = Math.sin(Math.PI * t) * 14;
      paint(ctx, a, 0, 0, 1, `blur(${blur}px)`);
      paint(ctx, b, 0, 0, t, `blur(${blur}px)`);
      break;
    }
    case 'camera-shake': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
      const shake = (1 - Math.abs(t - 0.5) * 2) * 22;
      const random = seededRandom(Math.floor(t * 60) + 9);
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.drawImage(b, (random() - 0.5) * shake, (random() - 0.5) * shake, W, H);
      ctx.restore();
      break;
    }
    case 'pan': {
      const p = easeInOut(t);
      paintScaled(ctx, a, 1 + 0.2 * p, 0, 1 - p, -W * 0.18 * p, 0);
      paintScaled(ctx, b, 1 + 0.2 * (1 - p), 0, p, W * 0.18 * (1 - p), 0);
      break;
    }

    /* ---------------- Stylised ---------------- */
    case 'glitch': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
      const random = seededRandom(Math.floor(t * 40) + 1);
      const slices = 14;
      ctx.save();
      ctx.globalAlpha = 0.55 * Math.sin(Math.PI * t);
      for (let i = 0; i < slices; i += 1) {
        const y = (i / slices) * H;
        const h = H / slices;
        const dx = (random() - 0.5) * W * 0.25 * (random() > 0.5 ? 1 : -1);
        ctx.drawImage(b, 0, y, W, h, dx, y, W, h);
      }
      ctx.restore();
      break;
    }
    case 'rgb-split': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
      const amount = Math.sin(Math.PI * t) * W * 0.06;
      if (amount > 0.5) {
        const red = channelShift(b, amount, '#ff0000', 0.35 * t);
        const cyan = channelShift(b, -amount, '#00ffff', 0.35 * t);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.7;
        ctx.drawImage(red, 0, 0);
        ctx.drawImage(cyan, 0, 0);
        ctx.restore();
      }
      break;
    }
    case 'pixelate': {
      const peak = Math.sin(Math.PI * t);
      const block = 2 + peak * Math.max(8, Math.min(W, H) / 20);
      const pixelated = pixelatedCopy(b, block);
      paint(ctx, a, 0, 0, 1);
      paint(ctx, pixelated, 0, 0, t);
      break;
    }
    case 'mosaic': {
      paint(ctx, b, 0, 0, 1);
      const cols = 8;
      const rows = 5;
      const random = seededRandom(77);
      const order = [];
      for (let i = 0; i < cols * rows; i += 1) order.push({ i, key: random() });
      order.sort((x, y) => x.key - y.key);
      const reveal = Math.floor(order.length * t);
      ctx.save();
      for (let k = 0; k < reveal; k += 1) {
        const index = order[k].i;
        const cx = index % cols;
        const cy = Math.floor(index / cols);
        const x = (cx / cols) * W;
        const y = (cy / rows) * H;
        ctx.drawImage(b, x, y, W / cols, H / rows, x, y, W / cols, H / rows);
      }
      ctx.restore();
      break;
    }
    case 'blur-dissolve': {
      const blur = Math.sin(Math.PI * t) * 12;
      if (t < 0.5) {
        paint(ctx, a, 0, 0, 1);
        paint(ctx, b, 0, 0, t, `blur(${blur}px)`);
      } else {
        paint(ctx, a, 0, 0, 1 - t, `blur(${blur}px)`);
        paint(ctx, b, 0, 0, 1);
      }
      break;
    }
    case 'light-leak': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, easeInOut(t));
      const x = -W * 0.4 + W * 1.8 * t;
      const gradient = ctx.createRadialGradient(x, H * 0.3, 0, x, H * 0.3, W * 0.7);
      gradient.addColorStop(0, `rgba(255, 190, 120, ${0.55 * Math.sin(Math.PI * t)})`);
      gradient.addColorStop(0.5, `rgba(255, 140, 60, ${0.2 * Math.sin(Math.PI * t)})`);
      gradient.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'flash': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
      const flash = Math.sin(Math.PI * t);
      if (flash > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.9})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      break;
    }
    case 'film-burn': {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
      const radius = (Math.hypot(W, H) / 2) * ease('easeIn', t) * 1.2;
      const gradient = ctx.createRadialGradient(W / 2, H / 2, Math.max(1, radius * 0.45), W / 2, H / 2, Math.max(2, radius));
      gradient.addColorStop(0, 'rgba(255, 200, 90, 0)');
      gradient.addColorStop(0.7, 'rgba(255, 120, 30, 0.35)');
      gradient.addColorStop(1, 'rgba(120, 20, 0, 0.85)');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'ripple': {
      paint(ctx, a, 0, 0, 1);
      const amplitude = Math.sin(Math.PI * t) * H * 0.05;
      const stripes = 60;
      ctx.save();
      ctx.globalAlpha = t;
      for (let i = 0; i < stripes; i += 1) {
        const y = (i / stripes) * H;
        const dx = Math.sin((i / stripes) * Math.PI * 6 + t * Math.PI * 4) * amplitude;
        ctx.drawImage(b, 0, y, W, H / stripes, dx, y, W, H / stripes);
      }
      ctx.restore();
      break;
    }
    case 'wave': {
      paint(ctx, a, 0, 0, 1);
      const amplitude = Math.sin(Math.PI * t) * W * 0.06;
      const stripes = 60;
      ctx.save();
      ctx.globalAlpha = t;
      for (let i = 0; i < stripes; i += 1) {
        const x = (i / stripes) * W;
        const dy = Math.sin((i / stripes) * Math.PI * 6 + t * Math.PI * 4) * amplitude;
        ctx.drawImage(b, x, 0, W / stripes, H, x, dy, W / stripes, H);
      }
      ctx.restore();
      break;
    }
    case 'page-turn': {
      paint(ctx, b, 0, 0, 1);
      const p = easeInOut(t);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W * (1 - p), 0);
      ctx.lineTo(W * (1 - p) - W * 0.12 * p, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(a, 0, 0);
      const gradient = ctx.createLinearGradient(W * (1 - p) - W * 0.12, 0, W * (1 - p), 0);
      gradient.addColorStop(0, 'rgba(0,0,0,0.45)');
      gradient.addColorStop(1, 'rgba(255,255,255,0.2)');
      ctx.fillStyle = gradient;
      ctx.fillRect(W * (1 - p) - W * 0.14, 0, W * 0.14, H);
      ctx.restore();
      break;
    }
    case 'shatter': {
      paint(ctx, b, 0, 0, 1);
      const cols = 7;
      const rows = 4;
      const random = seededRandom(202);
      const p = easeInOut(t);
      ctx.save();
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = (col / cols) * W;
          const y = (row / rows) * H;
          const w = W / cols;
          const h = H / rows;
          const angle = (random() - 0.5) * 1.6;
          const dx = (x + w / 2 - W / 2) * p * 1.6;
          const dy = (y + h / 2 - H / 2) * p * 1.6 + p * p * H * 0.5;
          ctx.save();
          ctx.globalAlpha = 1 - p;
          ctx.translate(x + w / 2 + dx, y + h / 2 + dy);
          ctx.rotate(angle * p);
          ctx.drawImage(a, x, y, w, h, -w / 2, -h / 2, w, h);
          ctx.restore();
        }
      }
      ctx.restore();
      break;
    }
    case 'swirl': {
      paint(ctx, b, 0, 0, 1);
      const wedges = 24;
      const angleStep = (Math.PI * 2) / wedges;
      const p = easeInOut(t);
      ctx.save();
      ctx.globalAlpha = 1 - p * 0.15;
      for (let i = 0; i < wedges; i += 1) {
        const start = i * angleStep + p * Math.PI * 1.4;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(W / 2, H / 2);
        ctx.arc(W / 2, H / 2, Math.hypot(W, H), start, start + angleStep / 2);
        ctx.closePath();
        ctx.clip();
        ctx.globalAlpha = 1 - p;
        ctx.drawImage(a, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      break;
    }
    case 'luma-fade': {
      paint(ctx, a, 0, 0, 1);
      const mask = makeCanvas(W, H);
      const mctx = mask.getContext('2d');
      mctx.drawImage(b, 0, 0);
      mctx.globalCompositeOperation = 'destination-in';
      const span = H * 1.25;
      const offset = -span * 0.15 + span * 1.05 * t;
      const gradient = mctx.createLinearGradient(0, offset - span * 0.5, 0, offset + span * 0.5);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.65)');
      gradient.addColorStop(1, 'rgba(255,255,255,1)');
      mctx.fillStyle = gradient;
      mctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
      break;
    }

    default: {
      paint(ctx, a, 0, 0, 1);
      paint(ctx, b, 0, 0, t);
    }
  }

  ctx.restore();
}
