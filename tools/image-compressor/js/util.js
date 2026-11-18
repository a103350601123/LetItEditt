/* Image Editor — utilities, shared state and DOM references */
'use strict';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const uid = () => 'l' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const deepClone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const rad2deg = (r) => (r * 180) / Math.PI;
const deg2rad = (d) => (d * Math.PI) / 180;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2400);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function baseName(name) {
  const n = (name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return n.slice(0, 40) || 'image';
}

/* ------------------------------ shared state ------------------------------ */
const state = {
  loaded: false,
  original: null,        // canvas holding the untouched picture
  name: 'image',
  width: 0,
  height: 0,
  base: null,            // current base pixels (a canvas; replaced, never mutated)
  adjustments: { brightness: 100, contrast: 100, saturation: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0 },
  layers: [],
  selectedId: null,
  tool: 'select',
  zoom: 1,
  panX: 0,
  panY: 0,
  crop: null,
  bgSource: null,
  history: [],
  hIndex: -1,
  options: {
    draw: { mode: 'draw', color: '#ff3b3b', size: 8 },
    text: { value: 'Your text', font: 'Inter', size: 48, color: '#ffffff', bold: false, italic: false },
    shape: { type: 'rect', stroke: '#7c5cff', width: 6, fillOn: false, fill: '#3ba0ff' },
    sticker: { emoji: '😀', size: 96 },
    bg: { color: null, tolerance: 32, fillMode: 'none', fillColor: '#ffffff' }
  }
};

/* ------------------------------ DOM ------------------------------ */
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const wrap = $('canvasWrap');
const mctx = document.createElement('canvas').getContext('2d');

let drag = null;

/* ------------------------------ constants ------------------------------ */
const EMOJIS = ['😀', '😂', '😍', '😎', '🥳', '😢', '😡', '🤔', '👍', '👎', '👏', '🙌',
  '❤️', '🔥', '⭐', '✨', '✅', '❌', '⚠️', '❗', '❓', '💡', '🎉', '🎯',
  '🚀', '📌', '📍', '🔔', '💯', '🌟', '💬', '📷'];

const PRESETS = [
  { name: 'Original', adj: {} },
  { name: 'Vivid', adj: { saturation: 150, contrast: 115 } },
  { name: 'Warm', adj: { sepia: 25, saturation: 120, brightness: 104 } },
  { name: 'Cool', adj: { hue: 18, saturation: 112 } },
  { name: 'Mono', adj: { grayscale: 100 } },
  { name: 'Noir', adj: { grayscale: 100, contrast: 135, brightness: 95 } },
  { name: 'Sepia', adj: { sepia: 80 } },
  { name: 'Fade', adj: { contrast: 86, brightness: 108, saturation: 82 } },
  { name: 'Dramatic', adj: { contrast: 145, brightness: 92, saturation: 95 } }
];

const DEFAULT_ADJ = { brightness: 100, contrast: 100, saturation: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0 };
