/* Small shared helpers for the Background Remover. */
export const $ = (selector, root = document) => (root || document).querySelector(selector);
export const $$ = (selector, root = document) => Array.from((root || document).querySelectorAll(selector));

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function copyCanvas(source) {
  const canvas = createCanvas(source.width, source.height);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatMegapixels(width, height) {
  return ((width * height) / 1000000).toFixed(1) + ' MP';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function safeCanvasBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } else {
      resolve(null);
    }
  });
}

export function baseName(filename) {
  return String(filename || 'image').replace(/\.[^.]+$/, '') || 'image';
}
