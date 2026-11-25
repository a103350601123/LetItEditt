/* LetitEdit Professional Video Editor — shared utilities.
 * Pure functions with no DOM assumptions so the same code runs on the page
 * and inside the export worker.
 */

export function uid(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export const EASINGS = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2)
};

export function ease(name, t) {
  const fn = EASINGS[name] || EASINGS.linear;
  return fn(clamp(t, 0, 1));
}

export function formatClock(seconds, withFrames = false, fps = 30) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (withFrames) {
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const frames = Math.floor((safe % 1) * fps);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  }
  /* Round to the nearest tenth so a seek to 2.40 s reads 2.4, not 2.3. */
  const totalTenths = Math.round(safe * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatDuration(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  if (minutes) return `${minutes} min ${secs} s`;
  return `${safe.toFixed(1)} s`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export function isRTLText(text) {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(String(text || ''));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return { r: 37, g: 99, b: 235 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function withAlpha(color, alpha) {
  if (!color) return `rgba(0,0,0,${alpha})`;
  if (color.startsWith('#')) return rgba(color, alpha);
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  return color;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function sanitizeFilename(name, fallback = 'video') {
  const base = String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return base || fallback;
}

export function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function parseTimeToken(token) {
  const clean = String(token || '').trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

/* Subtitle parsing ------------------------------------------------------- */

export function parseSubtitleFile(text, extension = 'srt') {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];
  if (extension === 'vtt' || /^WEBVTT/m.test(source)) return parseVtt(source);
  if (extension === 'srt' || /-->/.test(source)) return parseSrt(source);
  return parseSrt(source);
}

function parseSrt(source) {
  const blocks = source.split(/\n{2,}/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (!lines.length) continue;
    let index = 0;
    if (/^\d+$/.test(lines[0].trim())) index = 1;
    const timing = lines[index] || '';
    const match = timing.match(/(.+?)\s*-->\s*(.+)/);
    if (!match) continue;
    const start = parseTimeToken(match[1]);
    const end = parseTimeToken(match[2]);
    if (start === null || end === null) continue;
    const body = lines.slice(index + 1).join('\n').trim();
    if (!body) continue;
    entries.push({ id: uid('sub'), start, end: Math.max(end, start + 0.3), text: body });
  }
  return entries;
}

function parseVtt(source) {
  const lines = source.split('\n');
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || /^WEBVTT/.test(line) || /^NOTE/.test(line)) continue;
    const timing = line.match(/^(.+?)\s*-->\s*(\S+)/);
    if (timing) {
      const start = parseTimeToken(timing[1]);
      const end = parseTimeToken(timing[2]);
      if (start !== null && end !== null) {
        if (current && current.text.trim()) entries.push(finishEntry(current));
        current = { start, end: Math.max(end, start + 0.3), text: '' };
      }
      continue;
    }
    if (current) current.text += (current.text ? '\n' : '') + line.replace(/<[^>]+>/g, '');
  }
  if (current && current.text.trim()) entries.push(finishEntry(current));
  return entries.filter((entry) => entry.text.trim());
}

function finishEntry(current) {
  return { id: uid('sub'), start: current.start, end: current.end, text: current.text.trim() };
}

export function toSrt(entries) {
  return (entries || [])
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((entry, index) => {
      return `${index + 1}\n${srtTime(entry.start)} --> ${srtTime(entry.end)}\n${entry.text}`;
    })
    .join('\n\n');
}

export function toVtt(entries) {
  return `WEBVTT\n\n${(entries || [])
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((entry) => `${srtTime(entry.start)} --> ${srtTime(entry.end)}\n${entry.text}`)
    .join('\n\n')}`;
}

function srtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/* Aspect and resolution helpers ----------------------------------------- */

export const ASPECTS = [
  { id: '16:9', label: '16:9 · Landscape', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 · Portrait', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 · Square', ratio: 1 },
  { id: '4:3', label: '4:3 · Classic', ratio: 4 / 3 },
  { id: '3:4', label: '3:4 · Portrait', ratio: 3 / 4 },
  { id: '4:5', label: '4:5 · Social portrait', ratio: 4 / 5 },
  { id: '3:2', label: '3:2 · Photo', ratio: 3 / 2 },
  { id: 'custom', label: 'Custom', ratio: null }
];

export function aspectRatio(id) {
  const found = ASPECTS.find((entry) => entry.id === id);
  return found && found.ratio ? found.ratio : 16 / 9;
}

export const RESOLUTIONS = [
  { id: '2160', label: '4K · 2160p', longEdge: 3840 },
  { id: '1440', label: '1440p', longEdge: 2560 },
  { id: '1080', label: '1080p', longEdge: 1920 },
  { id: '720', label: '720p', longEdge: 1280 },
  { id: '480', label: '480p', longEdge: 854 },
  { id: '360', label: '360p', longEdge: 640 },
  { id: 'custom', label: 'Custom', longEdge: 0 }
];

export function even(value, min = 2) {
  return Math.max(min, Math.round(Number(value) / 2) * 2);
}

export function dimsForResolution(resolutionId, ratio, customWidth = 1920, customHeight = 1080) {
  if (resolutionId === 'custom') {
    return { width: even(customWidth), height: even(customHeight) };
  }
  const found = RESOLUTIONS.find((entry) => entry.id === resolutionId) || RESOLUTIONS[2];
  let width;
  let height;
  if (ratio >= 1) {
    width = found.longEdge;
    height = found.longEdge / ratio;
  } else {
    height = found.longEdge;
    width = found.longEdge * ratio;
  }
  return { width: even(width), height: even(height) };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Deterministic pseudo-randomness for stylised transitions --------------- */

export function seededRandom(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
