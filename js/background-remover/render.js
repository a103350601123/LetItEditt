import { createCanvas, clamp } from './util.js';

/** Find the visible bounds of an alpha mask. Returns pixel values. */
export function computeBounds(alpha, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    return { x: 0.25, y: 0.25, w: 0.5, h: 0.5, coverage: 0 };
  }
  return {
    x: minX / width,
    y: minY / height,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / height,
    coverage: count / (width * height)
  };
}

function imageSize(image) {
  if (!image) return { width: 0, height: 0 };
  return {
    width: image.naturalWidth || image.videoWidth || image.width || 0,
    height: image.naturalHeight || image.videoHeight || image.height || 0
  };
}

export function drawCover(ctx, image, width, height, padding = 0) {
  const size = imageSize(image);
  if (!size.width || !size.height) return;
  const scale = Math.max(
    (width + padding * 2) / size.width,
    (height + padding * 2) / size.height
  );
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawGradient(ctx, width, height, gradient) {
  const angle = ((Number(gradient.angle) || 0) * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const length = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
  const dx = (Math.cos(angle) * length) / 2;
  const dy = (Math.sin(angle) * length) / 2;
  const fill = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  fill.addColorStop(0, gradient.from || '#eff6ff');
  fill.addColorStop(1, gradient.to || '#2563eb');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
}

function drawPhotoBackground(ctx, source, width, height, background) {
  const blur = Math.max(0, Number(background.blur) || 0);
  const unit = Math.min(width, height) / 800;
  const overscan = blur > 0 ? blur * unit * 3 + 2 : 0;
  ctx.save();
  if (blur > 0) ctx.filter = 'blur(' + (blur * unit).toFixed(2) + 'px)';
  ctx.drawImage(
    source,
    -overscan,
    -overscan,
    width + overscan * 2,
    height + overscan * 2
  );
  ctx.restore();

  const depth = Math.max(0, Number(background.depth) || 0);
  if (depth > 0) {
    const temp = createCanvas(width, height);
    const tempCtx = temp.getContext('2d');
    tempCtx.save();
    tempCtx.filter = 'blur(' + ((blur + depth) * unit).toFixed(2) + 'px)';
    tempCtx.drawImage(
      source,
      -overscan,
      -overscan,
      width + overscan * 2,
      height + overscan * 2
    );
    tempCtx.restore();
    tempCtx.globalCompositeOperation = 'destination-in';
    const mask = tempCtx.createLinearGradient(0, 0, 0, height);
    mask.addColorStop(0, 'rgba(255,255,255,0)');
    mask.addColorStop(0.45, 'rgba(255,255,255,0.2)');
    mask.addColorStop(1, 'rgba(255,255,255,1)');
    tempCtx.fillStyle = mask;
    tempCtx.fillRect(0, 0, width, height);
    ctx.drawImage(temp, 0, 0);
  }
}

function drawImageBackground(ctx, image, width, height, background) {
  const blur = Math.max(0, Number(background.blur) || 0);
  const depth = Math.max(0, Number(background.depth) || 0);
  const unit = Math.min(width, height) / 800;
  if (blur <= 0 && depth <= 0) {
    drawCover(ctx, image, width, height);
    return;
  }
  const pad = (blur + depth) * unit * 3 + 2;
  const temp = createCanvas(width, height);
  const tempCtx = temp.getContext('2d');
  tempCtx.save();
  tempCtx.filter = 'blur(' + (blur * unit).toFixed(2) + 'px)';
  drawCover(tempCtx, image, width, height, pad);
  tempCtx.restore();
  if (depth > 0) {
    const deep = createCanvas(width, height);
    const deepCtx = deep.getContext('2d');
    deepCtx.save();
    deepCtx.filter = 'blur(' + ((blur + depth) * unit).toFixed(2) + 'px)';
    drawCover(deepCtx, image, width, height, pad);
    deepCtx.restore();
    deepCtx.globalCompositeOperation = 'destination-in';
    const mask = deepCtx.createLinearGradient(0, 0, 0, height);
    mask.addColorStop(0, 'rgba(255,255,255,0)');
    mask.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    mask.addColorStop(1, 'rgba(255,255,255,1)');
    deepCtx.fillStyle = mask;
    deepCtx.fillRect(0, 0, width, height);
    tempCtx.drawImage(deep, 0, 0);
  }
  ctx.drawImage(temp, 0, 0);
}

function fillSolid(ctx, width, height, color) {
  ctx.fillStyle = color || '#ffffff';
  ctx.fillRect(0, 0, width, height);
}

function drawStudioBackground(ctx, width, height) {
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(0.7, '#ffffff');
  base.addColorStop(1, '#eef2f7');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const light = ctx.createRadialGradient(
    width * 0.5,
    height * 0.18,
    0,
    width * 0.5,
    height * 0.18,
    Math.max(width, height) * 0.9
  );
  light.addColorStop(0, 'rgba(255,255,255,0)');
  light.addColorStop(0.62, 'rgba(255,255,255,0.12)');
  light.addColorStop(1, 'rgba(203,213,225,0.22)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);
}

function drawEllipseShadow(ctx, cx, cy, rx, ry, opacity, fade, blurPx) {
  if (opacity <= 0 || rx <= 0 || ry <= 0) return;
  ctx.save();
  if (blurPx > 0) ctx.filter = 'blur(' + blurPx.toFixed(2) + 'px)';
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  const inner = clamp(0.1 + (fade / 100) * 0.72, 0.1, 0.84);
  gradient.addColorStop(0, 'rgba(15,23,42,' + (opacity / 100).toFixed(3) + ')');
  gradient.addColorStop(inner, 'rgba(15,23,42,' + ((opacity / 100) * 0.42).toFixed(3) + ')');
  gradient.addColorStop(0.92, 'rgba(15,23,42,' + ((opacity / 100) * 0.08).toFixed(3) + ')');
  gradient.addColorStop(1, 'rgba(15,23,42,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStudioFloor(ctx, width, height, bounds, studio) {
  const b = bounds;
  const unit = Math.min(width, height) / 800;
  const baseY = (b.y + b.h) * height;
  const cx = (b.x + b.w / 2) * width;
  const angle = ((Number(studio.shadowDirection) || 0) * Math.PI) / 180;
  const offset = (Number(studio.shadowOffset) || 0) * unit;
  const blur = (Number(studio.shadowBlur) || 0) * unit;
  const opacity = clamp(Number(studio.shadowOpacity) || 0, 0, 100);
  const fade = clamp(Number(studio.shadowFade) || 0, 0, 100);
  const subjectWidth = Math.max(12, b.w * width);
  const subjectHeight = Math.max(8, b.h * height);

  drawEllipseShadow(
    ctx,
    cx + Math.cos(angle) * offset,
    baseY + Math.sin(angle) * offset * 0.22 + subjectHeight * 0.01,
    Math.max(subjectWidth * 0.78, 24 * unit),
    Math.max(subjectHeight * 0.11 + blur * 0.34, 7 * unit),
    opacity * 0.32,
    fade,
    blur * 0.55
  );

  drawEllipseShadow(
    ctx,
    cx + Math.cos(angle) * offset * 0.6,
    baseY + Math.sin(angle) * offset * 0.14 + subjectHeight * 0.016,
    Math.max(subjectWidth * 0.52, 16 * unit),
    Math.max(subjectHeight * 0.035 + blur * 0.16, 4 * unit),
    opacity,
    fade,
    blur * 0.28
  );
}

function drawReflection(ctx, cutout, width, height, bounds, studio) {
  const intensity = clamp(Number(studio.reflection) || 0, 0, 100) / 100;
  if (intensity <= 0) return;
  const fade = clamp(Number(studio.reflectionFade) || 0, 0, 100);
  const baseY = (bounds.y + bounds.h) * height;
  const subjectHeight = Math.max(24, bounds.h * height);
  const temp = createCanvas(width, height);
  const tempCtx = temp.getContext('2d');
  tempCtx.save();
  tempCtx.translate(0, baseY * 2);
  tempCtx.scale(1, -1);
  tempCtx.drawImage(cutout, 0, 0, width, height);
  tempCtx.restore();

  tempCtx.globalCompositeOperation = 'destination-in';
  const gradientEnd = baseY + Math.max(subjectHeight * 0.85, 18);
  const gradient = tempCtx.createLinearGradient(0, baseY, 0, gradientEnd);
  const mid = clamp(0.16 + (fade / 100) * 0.68, 0.16, 0.84);
  gradient.addColorStop(0, 'rgba(255,255,255,' + intensity.toFixed(3) + ')');
  gradient.addColorStop(mid, 'rgba(255,255,255,' + (intensity * 0.28).toFixed(3) + ')');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  tempCtx.fillStyle = gradient;
  tempCtx.fillRect(0, baseY, width, Math.max(0, height - baseY));
  ctx.drawImage(temp, 0, 0);
}

/**
 * Render a complete background-removal scene.
 * `bounds` is normalised (0..1) and describes the visible subject.
 */
export function renderScene(ctx, width, height, options) {
  const { source, cutout, bounds, background, studio } = options;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  if (background.type === 'studio') {
    drawStudioBackground(ctx, width, height);
  } else if (background.type === 'original') {
    drawPhotoBackground(ctx, source, width, height, background);
  } else if (background.type === 'image' && background.image) {
    drawImageBackground(ctx, background.image, width, height, background);
  } else if (background.type === 'gradient') {
    drawGradient(ctx, width, height, background.gradient || {});
  } else if (background.type === 'color') {
    fillSolid(ctx, width, height, background.color || '#2563eb');
  } else if (background.type === 'white') {
    fillSolid(ctx, width, height, '#ffffff');
  } else if (background.type === 'black') {
    fillSolid(ctx, width, height, '#000000');
  } else if (background.type === 'grey') {
    fillSolid(ctx, width, height, '#e2e8f0');
  }

  if (background.type === 'studio') {
    drawStudioFloor(ctx, width, height, bounds, studio);
    drawReflection(ctx, cutout, width, height, bounds, studio);
  }

  const unit = Math.min(width, height) / 800;
  const shadowOpacity = clamp(Number(studio.shadowOpacity) || 0, 0, 100);
  if (background.type === 'studio' && shadowOpacity > 0) {
    const angle = ((Number(studio.shadowDirection) || 0) * Math.PI) / 180;
    const offset = (Number(studio.shadowOffset) || 0) * unit;
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,' + ((shadowOpacity / 100) * 0.42).toFixed(3) + ')';
    ctx.shadowBlur = (Number(studio.shadowBlur) || 0) * unit * 0.7;
    ctx.shadowOffsetX = Math.cos(angle) * offset;
    ctx.shadowOffsetY = Math.sin(angle) * offset * 0.45;
    ctx.drawImage(cutout, 0, 0, width, height);
    ctx.restore();
  } else {
    ctx.drawImage(cutout, 0, 0, width, height);
  }

  ctx.restore();
}
