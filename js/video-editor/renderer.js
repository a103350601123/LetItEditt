/* LetitEdit Professional Video Editor — composition renderer.
 *
 * This module is deliberately DOM-free: the page and the export worker both
 * call renderComposition() with a Canvas 2D context and a frame source.
 * That guarantees the preview and the exported file share one renderer.
 */

import { clamp, ease, isRTLText, withAlpha } from './utils.js';
import { applyGrade, drawTransition } from './effects.js';
import { FONT_STACKS, clipAtTime, clipEnd, previousClip } from './model.js';

const BASE_HEIGHT = 1080;

/* Canvas pool ----------------------------------------------------------- */

const pool = new Map();
let cursor = 0;

function resetPool() {
  cursor = 0;
}

function tempCanvas(width, height) {
  const key = `${width}x${height}`;
  let list = pool.get(key);
  if (!list) {
    list = [];
    pool.set(key, list);
  }
  if (cursor >= list.length) list.push(new OffscreenCanvas(width, height));
  const canvas = list[cursor];
  cursor += 1;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  return canvas;
}

/* Keyframes & animation -------------------------------------------------- */

function interpolateKeyframes(list, time, base) {
  if (!Array.isArray(list) || list.length === 0) return base;
  const sorted = list
    .filter((key) => Number.isFinite(key.t) && Number.isFinite(key.v))
    .sort((a, b) => a.t - b.t);
  if (!sorted.length) return base;
  if (time <= sorted[0].t) return sorted[0].v;
  if (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t || 0.0001;
      const p = ease(b.ease || 'linear', (time - a.t) / span);
      return a.v + (b.v - a.v) * p;
    }
  }
  return base;
}

function keyframeValue(clip, prop, localTime, base) {
  const list = clip.keyframes ? clip.keyframes[prop] : null;
  if (!list || !list.length) return base;
  return interpolateKeyframes(list, localTime, base);
}

export function hasKeyframes(clip, prop) {
  return Boolean(clip && clip.keyframes && clip.keyframes[prop] && clip.keyframes[prop].length);
}

function animationOffset(type, progress) {
  const p = clamp(progress, 0, 1);
  switch (type) {
    case 'fade':
      return { opacity: p, dx: 0, dy: 0, scale: 1, rotate: 0 };
    case 'slide-left':
      return { opacity: p, dx: -1 + p, dy: 0, scale: 1, rotate: 0 };
    case 'slide-right':
      return { opacity: p, dx: 1 - p, dy: 0, scale: 1, rotate: 0 };
    case 'slide-up':
      return { opacity: p, dx: 0, dy: -1 + p, scale: 1, rotate: 0 };
    case 'slide-down':
      return { opacity: p, dx: 0, dy: 1 - p, scale: 1, rotate: 0 };
    case 'zoom':
      return { opacity: p, dx: 0, dy: 0, scale: 0.72 + 0.28 * p, rotate: 0 };
    case 'spin':
      return { opacity: p, dx: 0, dy: 0, scale: 1, rotate: -120 * (1 - p) };
    default:
      return { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0 };
  }
}

export function resolveTransform(clip, localTime) {
  const baseX = clip.x ?? 0.5;
  const baseY = clip.y ?? 0.5;
  let x = keyframeValue(clip, 'x', localTime, baseX);
  let y = keyframeValue(clip, 'y', localTime, baseY);
  let scale = keyframeValue(clip, 'scale', localTime, clip.scale ?? 1);
  let rotation = keyframeValue(clip, 'rotation', localTime, clip.rotation ?? 0);
  let opacity = keyframeValue(clip, 'opacity', localTime, clip.opacity ?? 1);

  const fadeIn = Number(clip.fadeIn) || 0;
  if (fadeIn > 0 && localTime < fadeIn) opacity *= clamp(localTime / fadeIn, 0, 1);
  const fadeOut = Number(clip.fadeOut) || 0;
  const remaining = (clip.duration || 0) - localTime;
  if (fadeOut > 0 && remaining < fadeOut) opacity *= clamp(remaining / fadeOut, 0, 1);

  if (clip.inAnim && clip.inAnim.type && clip.inAnim.type !== 'none') {
    const duration = Math.max(0.05, clip.inAnim.duration || 0.5);
    if (localTime < duration) {
      const anim = animationOffset(clip.inAnim.type, localTime / duration);
      opacity *= anim.opacity;
      x += anim.dx * 0.3;
      y += anim.dy * 0.3;
      scale *= anim.scale;
      rotation += anim.rotate;
    }
  }

  if (clip.outAnim && clip.outAnim.type && clip.outAnim.type !== 'none') {
    const duration = Math.max(0.05, clip.outAnim.duration || 0.5);
    if (remaining < duration) {
      const anim = animationOffset(clip.outAnim.type, remaining / duration);
      opacity *= anim.opacity;
      x -= anim.dx * 0.3;
      y -= anim.dy * 0.3;
      scale *= anim.scale;
      rotation -= anim.rotate;
    }
  }

  return {
    x,
    y,
    scale: Math.max(0.001, scale),
    rotation,
    opacity: clamp(opacity, 0, 1)
  };
}

export function clipSourceTime(clip, localTime) {
  const speed = Math.max(0.05, Number(clip.speed) || 1);
  if (clip.reverse) {
    return (Number(clip.outPoint) || clip.duration || 0) - localTime * speed;
  }
  return (Number(clip.inPoint) || 0) + localTime * speed;
}

/* Drawing helpers -------------------------------------------------------- */

function fitScale(fit, sourceWidth, sourceHeight, width, height) {
  if (!sourceWidth || !sourceHeight) return 1;
  const contain = Math.min(width / sourceWidth, height / sourceHeight);
  if (fit === 'cover') return Math.max(width / sourceWidth, height / sourceHeight);
  return contain;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
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

function gradientForBackground(ctx, background, width, height) {
  const angle = ((Number(background.angle) || 135) * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const length = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
  const dx = (Math.cos(angle) * length) / 2;
  const dy = (Math.sin(angle) * length) / 2;
  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gradient.addColorStop(0, background.color1 || '#0f172a');
  gradient.addColorStop(1, background.color2 || '#2563eb');
  return gradient;
}

/* Text ------------------------------------------------------------------- */

export function textLines(clip, width, height) {
  const text = clip.text || {};
  const scale = 1;
  const unit = height / BASE_HEIGHT;
  const fontSize = Math.max(6, (Number(text.size) || 72) * unit * scale);
  const content = String(text.content || '');
  const maxWidth = Number(text.maxWidth) > 0 ? Number(text.maxWidth) * width : width * 0.9;
  const raw = content.split('\n');
  const lines = [];
  const ctx = new OffscreenCanvas(4, 4).getContext('2d');
  ctx.font = `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : '400 '}${fontSize}px ${FONT_STACKS[text.font] || FONT_STACKS.sans}`;
  for (const paragraph of raw) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    if (maxWidth <= 0) {
      lines.push(paragraph);
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return { lines, fontSize, maxWidth };
}

function drawTextClip(ctx, clip, localTime, width, height, forcedOpacity = null) {
  const transform = resolveTransform(clip, localTime);
  const opacity = forcedOpacity === null ? transform.opacity : forcedOpacity;
  if (opacity <= 0.001) return;

  const text = clip.text || {};
  const { lines, fontSize } = textLines(clip, width, height);
  const unit = height / BASE_HEIGHT;
  const fontStack = FONT_STACKS[text.font] || FONT_STACKS.sans;
  const scaleFactor = transform.scale;
  const size = fontSize * scaleFactor;
  const lineHeight = size * (Number(text.lineHeight) || 1.25);
  const letterSpacing = (Number(text.letterSpacing) || 0) * unit * scaleFactor;
  const padding = size * 0.28;

  const measure = new OffscreenCanvas(4, 4).getContext('2d');
  measure.font = `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : '400 '}${size}px ${fontStack}`;
  try {
    measure.letterSpacing = `${letterSpacing}px`;
  } catch (error) {
    /* not supported */
  }
  let maxLine = 0;
  for (const line of lines) {
    const metrics = measure.measureText(line || ' ');
    maxLine = Math.max(maxLine, metrics.width);
  }

  const boxWidth = maxLine + padding * 2;
  const boxHeight = lines.length * lineHeight + padding * 1.4;
  const centerX = transform.x * width;
  const centerY = transform.y * height;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(centerX, centerY);
  ctx.rotate(((Number(transform.rotation) || 0) * Math.PI) / 180);
  ctx.font = `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : '400 '}${size}px ${fontStack}`;
  ctx.textBaseline = 'top';
  ctx.direction = text.direction === 'rtl' || (text.direction === 'auto' && isRTLText(text.content)) ? 'rtl' : 'ltr';
  try {
    ctx.letterSpacing = `${letterSpacing}px`;
  } catch (error) {
    /* not supported */
  }

  if (Number(text.bgOpacity) > 0) {
    ctx.fillStyle = withAlpha(text.bgColor || '#000000', Number(text.bgOpacity));
    drawRoundedRect(ctx, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, size * 0.18);
    ctx.fill();
  }

  const align = text.align || 'center';
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  const startX = align === 'left' ? -maxLine / 2 : align === 'right' ? maxLine / 2 : 0;
  const startY = -boxHeight / 2 + padding * 0.7;

  if (text.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.62)';
    ctx.shadowBlur = size * 0.28;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = size * 0.06;
  }
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    if (Number(text.outlineWidth) > 0) {
      ctx.strokeStyle = text.outlineColor || '#000000';
      ctx.lineWidth = Math.max(0.5, Number(text.outlineWidth) * scaleFactor);
      ctx.strokeText(line || ' ', startX, y);
    }
    ctx.fillStyle = text.color || '#ffffff';
    ctx.fillText(line || ' ', startX, y);
    if (text.underline) {
      const metrics = ctx.measureText(line || ' ');
      const underlineY = y + size * 1.02;
      const left = align === 'left' ? startX : align === 'right' ? startX - metrics.width : startX - metrics.width / 2;
      ctx.strokeStyle = text.color || '#ffffff';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(left, underlineY);
      ctx.lineTo(left + metrics.width, underlineY);
      ctx.stroke();
    }
  });

  ctx.restore();
}

/* Shapes ----------------------------------------------------------------- */

function drawShapeClip(ctx, clip, localTime, width, height, forcedOpacity = null) {
  const transform = resolveTransform(clip, localTime);
  const opacity = forcedOpacity === null ? transform.opacity : forcedOpacity;
  if (opacity <= 0.001) return;
  const shape = clip.shape || {};
  const unit = height / BASE_HEIGHT;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(transform.x * width, transform.y * height);
  ctx.rotate(((Number(transform.rotation) || 0) * Math.PI) / 180);
  const w = Math.max(2, (Number(shape.width) || 0.45) * width * transform.scale);
  const h = Math.max(2, (Number(shape.height) || 0.3) * height * transform.scale);
  const fill = shape.fill || '#2563eb';
  const stroke = shape.stroke || '#ffffff';
  const strokeWidth = Math.max(0, (Number(shape.strokeWidth) || 0) * unit);

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = 'round';

  if (shape.type === 'circle') {
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (fill !== 'transparent') ctx.fill();
    if (strokeWidth > 0) ctx.stroke();
  } else if (shape.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.lineWidth = Math.max(2, (Number(shape.height) || 0.02) * height * transform.scale);
    ctx.strokeStyle = fill;
    ctx.stroke();
  } else if (shape.type === 'arrow') {
    const thickness = Math.max(2, h * 0.28);
    const head = Math.min(w * 0.45, h * 1.2);
    ctx.beginPath();
    ctx.moveTo(-w / 2, -thickness / 2);
    ctx.lineTo(w / 2 - head, -thickness / 2);
    ctx.lineTo(w / 2 - head, -thickness * 1.4);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w / 2 - head, thickness * 1.4);
    ctx.lineTo(w / 2 - head, thickness / 2);
    ctx.lineTo(-w / 2, thickness / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (strokeWidth > 0) ctx.stroke();
  } else {
    drawRoundedRect(ctx, -w / 2, -h / 2, w, h, (Number(shape.radius) || 0) * unit * transform.scale);
    if (fill !== 'transparent') ctx.fill();
    if (strokeWidth > 0) ctx.stroke();
  }
  ctx.restore();
}

/* Backgrounds ------------------------------------------------------------ */

function drawBackgroundClip(ctx, clip, localTime, width, height, forcedOpacity = null) {
  const transform = resolveTransform(clip, localTime);
  const opacity = forcedOpacity === null ? transform.opacity : forcedOpacity;
  if (opacity <= 0.001) return;
  const background = clip.background || {};
  ctx.save();
  ctx.globalAlpha = opacity;
  if (background.type === 'gradient') {
    ctx.fillStyle = gradientForBackground(ctx, background, width, height);
  } else {
    ctx.fillStyle = background.color1 || '#0f172a';
  }
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* Media layers ----------------------------------------------------------- */

async function drawMediaClip(ctx, clip, source, localTime, width, height, options, forcedOpacity = null) {
  const mediaId = clip.mediaId;
  if (!mediaId) return false;
  const transform = resolveTransform(clip, localTime);
  const opacity = forcedOpacity === null ? transform.opacity : forcedOpacity;
  if (opacity <= 0.001) return false;

  let media = null;
  let srcW = 16;
  let srcH = 9;
  if (clip.kind === 'image') {
    media = source.getImage(mediaId);
    if (!media) return false;
    srcW = media.width;
    srcH = media.height;
  } else {
    let sourceTime;
    if (clip.freeze && Number.isFinite(clip.freezeAt)) {
      sourceTime = clip.freezeAt;
    } else {
      sourceTime = clipSourceTime(clip, localTime);
    }
    const previewSize = options.maxDimension || 1280;
    media = await source.getFrame(mediaId, sourceTime, previewSize);
    if (!media) return false;
    srcW = media.width;
    srcH = media.height;
  }

  const layer = tempCanvas(width, height);
  const layerCtx = layer.getContext('2d');

  const crop = clip.crop || { top: 0, right: 0, bottom: 0, left: 0 };
  const left = clamp(Number(crop.left) || 0, 0, 0.45);
  const right = clamp(Number(crop.right) || 0, 0, 0.45);
  const top = clamp(Number(crop.top) || 0, 0, 0.45);
  const bottom = clamp(Number(crop.bottom) || 0, 0, 0.45);
  const sx = srcW * left;
  const sy = srcH * top;
  const sw = Math.max(1, srcW * (1 - left - right));
  const sh = Math.max(1, srcH * (1 - top - bottom));

  const base = fitScale(clip.fit === 'cover' ? 'cover' : 'contain', srcW, srcH, width, height);
  const drawW = sw * base * transform.scale;
  const drawH = sh * base * transform.scale;

  layerCtx.save();
  layerCtx.translate(transform.x * width, transform.y * height);
  layerCtx.rotate(((Number(transform.rotation) || 0) * Math.PI) / 180);
  layerCtx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
  layerCtx.drawImage(media, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
  layerCtx.restore();

  const graded = applyGrade(layer, clip);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(graded, 0, 0);
  ctx.restore();
  return true;
}

/* Subtitles -------------------------------------------------------------- */

export function wrapSubtitle(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawSubtitles(ctx, project, time, width, height) {
  const subtitles = project.subtitles;
  if (!subtitles || subtitles.enabled === false) return;
  const style = subtitles.style || {};
  const active = (subtitles.items || []).filter(
    (item) => time >= item.start - 1e-6 && time < item.end - 1e-6 && String(item.text || '').trim()
  );
  if (!active.length) return;

  const scale = height / BASE_HEIGHT;
  const size = Math.max(8, (Number(style.size) || 44) * scale);
  const fontStack = FONT_STACKS[style.font] || FONT_STACKS.sans;
  const padding = size * 0.4;
  const lineHeight = size * 1.3;
  const maxWidth = width * 0.86;

  ctx.save();
  ctx.font = `${style.bold ? '700 ' : '400 '}${size}px ${fontStack}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.direction = 'ltr';

  for (const item of active) {
    const paragraphs = String(item.text).split('\n');
    const lines = [];
    for (const paragraph of paragraphs) lines.push(...wrapSubtitle(ctx, paragraph, maxWidth));
    const boxHeight = lines.length * lineHeight + padding * 1.3;
    const y = (Number(style.position) || 0.86) * height - boxHeight / 2;
    let maxLine = 0;
    for (const line of lines) maxLine = Math.max(maxLine, ctx.measureText(line).width);
    const boxWidth = maxLine + padding * 2;
    if (Number(style.bgOpacity) > 0) {
      ctx.fillStyle = withAlpha(style.bgColor || '#000000', Number(style.bgOpacity));
      drawRoundedRect(ctx, width / 2 - boxWidth / 2, y, boxWidth, boxHeight, size * 0.22);
      ctx.fill();
    }
    ctx.fillStyle = style.color || '#ffffff';
    lines.forEach((line, index) => {
      if (Number(style.outlineWidth) > 0) {
        ctx.strokeStyle = style.outlineColor || '#000000';
        ctx.lineWidth = Number(style.outlineWidth) * scale;
        ctx.strokeText(line, width / 2, y + padding * 0.6 + index * lineHeight);
      }
      ctx.fillText(line, width / 2, y + padding * 0.6 + index * lineHeight);
    });
  }
  ctx.restore();
}

/* Clip dispatch ---------------------------------------------------------- */

async function drawClipInto(ctx, project, clip, source, localTime, width, height, options, forcedOpacity = null) {
  if (clip.kind === 'text') {
    drawTextClip(ctx, clip, localTime, width, height, forcedOpacity);
  } else if (clip.kind === 'shape') {
    drawShapeClip(ctx, clip, localTime, width, height, forcedOpacity);
  } else if (clip.kind === 'background') {
    drawBackgroundClip(ctx, clip, localTime, width, height, forcedOpacity);
  } else {
    await drawMediaClip(ctx, clip, source, localTime, width, height, options, forcedOpacity);
  }
}

/** Render a single track's contribution to the frame. */
async function renderTrack(ctx, project, track, source, time, width, height, options) {
  if (track.kind !== 'video' || track.hidden) return;
  const clip = clipAtTime(track, time);
  if (!clip || clip.hidden) return;
  const local = time - clip.start;

  const transition = clip.transition;
  const hasTransition = transition && transition.type && transition.type !== 'none' && Number(transition.duration) > 0;
  if (hasTransition && local < Number(transition.duration)) {
    const prev = previousClip(track, clip);
    /* A transition is only valid at a real boundary. At the start of the
       first clip (or after a gap) the outgoing frame is the canvas background,
       so "Transition in" still fades/reveals from black instead of doing
       nothing. */
    const adjacent = prev && !prev.hidden && Math.abs(clip.start - clipEnd(prev)) <= 0.02;
    const progress = clamp(local / Number(transition.duration), 0, 1);
    const outgoing = tempCanvas(width, height);
    const incoming = tempCanvas(width, height);
    if (adjacent) {
      const outgoingTime = Math.max(0, prev.duration - Number(transition.duration)) + local;
      await drawClipInto(
        outgoing.getContext('2d'),
        project,
        prev,
        source,
        clipSourceLocal(prev, outgoingTime),
        width,
        height,
        options,
        1
      );
    } else {
      const outgoingCtx = outgoing.getContext('2d');
      outgoingCtx.fillStyle = '#000';
      outgoingCtx.fillRect(0, 0, width, height);
    }
    await drawClipInto(
      incoming.getContext('2d'),
      project,
      clip,
      source,
      local,
      width,
      height,
      options,
      1
    );
    drawTransition(ctx, outgoing, incoming, transition.reverse ? 1 - progress : progress, transition.type);
    return;
  }

  await drawClipInto(ctx, project, clip, source, local, width, height, options);
}

function clipSourceLocal(clip, local) {
  return clamp(local, 0, Math.max(0, clip.duration));
}

/** Main entry point used by the preview and the export worker. */
export async function renderComposition(ctx, project, source, time, options = {}) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  resetPool();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = project.background || '#000000';
  ctx.fillRect(0, 0, width, height);

  const tracks = project.tracks || [];
  for (let index = tracks.length - 1; index >= 0; index -= 1) {
    const track = tracks[index];
    if (track.kind !== 'video' || track.hidden) continue;
    await renderTrack(ctx, project, track, source, time, width, height, options);
  }

  drawSubtitles(ctx, project, time, width, height);
}

/** Bounds of a visual clip in composition pixels (used for the on-canvas box). */
export function clipBounds(clip, localTime, width, height, sourceWidth, sourceHeight) {
  const transform = resolveTransform(clip, localTime);
  let w;
  let h;
  if (clip.kind === 'text') {
    const { lines, fontSize } = textLines(clip, width, height);
    const measure = new OffscreenCanvas(4, 4).getContext('2d');
    const text = clip.text || {};
    const size = fontSize * transform.scale;
    measure.font = `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : '400 '}${size}px ${FONT_STACKS[text.font] || FONT_STACKS.sans}`;
    let maxLine = 0;
    for (const line of lines) maxLine = Math.max(maxLine, measure.measureText(line || ' ').width);
    w = maxLine + size * 0.56;
    h = lines.length * size * (Number(text.lineHeight) || 1.25) + size * 0.4;
  } else if (clip.kind === 'shape') {
    w = (Number(clip.shape?.width) || 0.45) * width * transform.scale;
    h = (Number(clip.shape?.height) || 0.3) * height * transform.scale;
  } else if (clip.kind === 'background') {
    w = width;
    h = height;
  } else {
    const sw = sourceWidth || 16;
    const sh = sourceHeight || 9;
    const base = fitScale(clip.fit === 'cover' ? 'cover' : 'contain', sw, sh, width, height);
    w = sw * base * transform.scale;
    h = sh * base * transform.scale;
  }
  return {
    x: transform.x * width,
    y: transform.y * height,
    width: w,
    height: h,
    rotation: transform.rotation,
    opacity: transform.opacity
  };
}
