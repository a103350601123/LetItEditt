'use strict';

/* ------------------------------------------------------------------
   Text to Handwriting
   Vanilla canvas renderer. No libraries, no network calls at runtime
   beyond the Google Fonts stylesheet.
------------------------------------------------------------------- */

const MM_TO_PX = 96 / 25.4;
const RENDER_SCALE = 2.25; // 216 DPI output
const MAX_PAGES = 60;

const PAGE_SIZES = {
  a4:     { label: 'A4',     w: 210,   h: 297,   note: '210 × 297 mm' },
  letter: { label: 'Letter', w: 215.9, h: 279.4, note: '8.5 × 11 in' },
  legal:  { label: 'Legal',  w: 215.9, h: 355.6, note: '8.5 × 14 in' }
};

const INKS = {
  blue:  '#1f3f94',
  black: '#191b21',
  red:   '#9c1f26',
  green: '#1d6b3a'
};

const INK_NAMES = { blue: 'Blue', black: 'Black', red: 'Red', green: 'Green', custom: 'Custom' };

const PAPER_NAMES = { plain: 'Plain', ruled: 'Ruled', grid: 'Grid', legal: 'Legal Pad', dotted: 'Dotted' };

const FONT_GROUPS = [
  { label: 'Casual handwriting', fonts: ['Caveat', 'Patrick Hand', 'Shadows Into Light', 'Indie Flower', 'Kalam', 'Gochi Hand', 'Sriracha'] },
  { label: 'Neat & tidy', fonts: ['Architects Daughter', 'Coming Soon', 'Just Another Hand', 'Reenie Beanie', 'Covered By Your Grace'] },
  { label: 'Flowing script', fonts: ['Dancing Script', 'Sacramento', 'Satisfy', 'Great Vibes', 'La Belle Aurore', 'Homemade Apple'] },
  { label: 'Bold & marker', fonts: ['Permanent Marker', 'Rock Salt', 'Amatic SC', 'Zeyada'] }
];

const FONTS = FONT_GROUPS.flatMap(group => group.fonts);

const SAMPLE_TITLE = 'A handwritten note';

const SAMPLE_TEXT = `Dear friend,

This page was written with a little help from a browser and a lot of imagination. Type or paste anything into the panel and watch it appear on the page — in your choice of handwriting.

Change the ink, pick a paper size, then download the finished page as a PNG or a PDF. Everything stays on your device.

Warmly,
Your handwriting tool`;

const state = {
  title: SAMPLE_TITLE,
  text: SAMPLE_TEXT,
  font: 'Caveat',
  fontSize: 24,
  lineHeight: 1.8,
  wobble: 0.6,
  ink: 'blue',
  customInk: '#7c5cff',
  size: 'a4',
  paper: 'ruled',
  margins: { top: 18, bottom: 18, left: 20, right: 20 },
  page: 0
};

const $ = id => document.getElementById(id);

const els = {
  canvas: $('pageCanvas'),
  titleInput: $('titleInput'),
  textInput: $('textInput'),
  textStats: $('textStats'),
  btnSample: $('btnSample'),
  btnClear: $('btnClear'),
  fontSelect: $('fontSelect'),
  fontPreview: $('fontPreview'),
  fontCount: $('fontCount'),
  fontSize: $('fontSize'),
  fontSizeVal: $('fontSizeVal'),
  lineHeight: $('lineHeight'),
  lineHeightVal: $('lineHeightVal'),
  wobble: $('wobble'),
  wobbleVal: $('wobbleVal'),
  inkName: $('inkName'),
  inkCustom: $('inkCustom'),
  customInkVal: $('customInkVal'),
  customInkWrap: $('customInkWrap'),
  pageSize: $('pageSize'),
  pageDim: $('pageDim'),
  paperStyle: $('paperStyle'),
  paperName: $('paperName'),
  summary: $('summary'),
  prevPage: $('prevPage'),
  nextPage: $('nextPage'),
  pageNow: $('pageNow'),
  pageTotal: $('pageTotal'),
  pageMeta: $('pageMeta'),
  renderDpi: $('renderDpi'),
  exportNote: $('exportNote'),
  btnPng: $('btnPng'),
  btnPdf: $('btnPdf'),
  btnPng2: $('btnPng2'),
  btnPdf2: $('btnPdf2'),
  toast: $('toast')
};

const marginInputs = Array.from(document.querySelectorAll('[data-margin]'));

/* ---------- seeded pseudo-random (stable jitter) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtPt = n => (Math.round(n * 1000) / 1000).toString();

/* ---------- text measurement & layout ---------- */
const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

function getInkColor() {
  return state.ink === 'custom' ? state.customInk : (INKS[state.ink] || INKS.blue);
}

function canvasFont(fontPx, weight) {
  return (weight || 400) + ' ' + fontPx + 'px "' + state.font + '", "Segoe Print", "Comic Sans MS", cursive';
}

function wrapText(ctx, text, maxWidth) {
  const out = [];
  const paragraphs = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.replace(/\s+$/, '');
    if (!trimmed.trim()) {
      out.push('');
      continue;
    }

    const words = trimmed.split(/ +/).filter(Boolean);
    let line = '';

    for (let word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        out.push(line);
        line = '';
      }
      while (word.length > 1 && ctx.measureText(word).width > maxWidth) {
        let cut = word.length;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut--;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    if (line) out.push(line);
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function buildLayout() {
  const spec = PAGE_SIZES[state.size];
  const pageW = Math.round(spec.w * MM_TO_PX * RENDER_SCALE);
  const pageH = Math.round(spec.h * MM_TO_PX * RENDER_SCALE);

  const margins = {
    top: state.margins.top * MM_TO_PX * RENDER_SCALE,
    bottom: state.margins.bottom * MM_TO_PX * RENDER_SCALE,
    left: state.margins.left * MM_TO_PX * RENDER_SCALE,
    right: state.margins.right * MM_TO_PX * RENDER_SCALE
  };

  const fontPx = state.fontSize * RENDER_SCALE;
  const lineHeightPx = fontPx * state.lineHeight;
  const contentW = Math.max(40, pageW - margins.left - margins.right);
  const contentH = Math.max(lineHeightPx, pageH - margins.top - margins.bottom);

  const title = String(state.title || '').trim();
  let titlePx = 0;
  let titleBlock = 0;
  if (title) {
    titlePx = fontPx * 1.5;
    measureCtx.font = canvasFont(titlePx);
    const maxTitleW = contentW * 0.92;
    const measured = measureCtx.measureText(title).width;
    if (measured > maxTitleW) {
      titlePx = Math.max(fontPx * 0.9, titlePx * maxTitleW / measured);
    }
    titleBlock = titlePx * 0.95 + fontPx * 0.9;
  }

  const maxLines = Math.max(1, Math.floor((contentH - fontPx * 0.35) / lineHeightPx));
  const firstPageMax = Math.max(1, Math.floor((contentH - titleBlock - fontPx * 0.35) / lineHeightPx));

  measureCtx.font = canvasFont(fontPx);
  const lines = wrapText(measureCtx, state.text, contentW);

  const pages = [];
  let cursor = 0;
  while (cursor < lines.length && pages.length < MAX_PAGES) {
    const capacity = pages.length === 0 ? firstPageMax : maxLines;
    pages.push(lines.slice(cursor, cursor + capacity));
    cursor += capacity;
  }
  if (!pages.length) pages.push([]);

  return {
    spec, pageW, pageH, margins, fontPx, lineHeightPx,
    contentW, contentH, maxLines, firstPageMax, pages,
    title, titlePx, titleBlock,
    truncated: cursor < lines.length
  };
}

function pageOffset(layout, pageIndex) {
  return pageIndex === 0 ? layout.titleBlock : 0;
}

function baselineAt(layout, lineIndex, offset) {
  return layout.margins.top
    + (offset || 0)
    + (layout.lineHeightPx - layout.fontPx) / 2
    + layout.fontPx * 0.8
    + lineIndex * layout.lineHeightPx;
}

/* ---------- paper ---------- */
let paperBase = { key: '', canvas: null };

function getPaperBase(w, h, paper) {
  const key = w + 'x' + h + ':' + paper;
  if (paperBase.key === key && paperBase.canvas) return paperBase.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const legal = paper === 'legal';

  const wash = ctx.createLinearGradient(0, 0, w, h);
  if (legal) {
    wash.addColorStop(0, '#fffbe0');
    wash.addColorStop(0.45, '#fcf4c5');
    wash.addColorStop(1, '#f6e9a8');
  } else {
    wash.addColorStop(0, '#fefdf9');
    wash.addColorStop(0.45, '#fbf9f1');
    wash.addColorStop(1, '#f5f1e6');
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.74);
  vignette.addColorStop(0, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, legal ? 'rgba(146,123,42,.10)' : 'rgba(122,105,72,.07)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  const rnd = mulberry32(0xC0FFEE);
  const dots = Math.min(6000, Math.round((w * h) / 1400));
  for (let i = 0; i < dots; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const size = 0.6 + rnd() * 1.7;
    const alpha = 0.018 + rnd() * 0.045;
    ctx.fillStyle = legal
      ? 'rgba(' + (150 + Math.floor(rnd() * 50)) + ',' + (126 + Math.floor(rnd() * 48)) + ',' + (52 + Math.floor(rnd() * 38)) + ',' + alpha + ')'
      : 'rgba(' + (90 + Math.floor(rnd() * 55)) + ',' + (80 + Math.floor(rnd() * 48)) + ',' + (56 + Math.floor(rnd() * 38)) + ',' + alpha + ')';
    ctx.fillRect(x, y, size, size);
  }

  ctx.lineWidth = 1;
  for (let i = 0; i < 220; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const len = 6 + rnd() * 24;
    ctx.strokeStyle = legal
      ? 'rgba(146,120,50,' + (0.018 + rnd() * 0.03) + ')'
      : 'rgba(118,100,68,' + (0.018 + rnd() * 0.03) + ')';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rnd() - 0.5) * 3);
    ctx.stroke();
  }

  paperBase = { key, canvas };
  return canvas;
}

function bodyBaselineAt(layout, pageIndex, lineIndex) {
  return baselineAt(layout, lineIndex, pageOffset(layout, pageIndex));
}

function invalidatePaperCache() {
  paperBase.key = '';
  paperBase.canvas = null;
}

function drawRules(ctx, layout, pageIndex, paper) {
  if (paper === 'plain') return;

  const { pageW, pageH, margins, lineHeightPx } = layout;
  const left = margins.left;
  const right = pageW - margins.right;
  const bottom = pageH - margins.bottom;
  const mm = MM_TO_PX * RENDER_SCALE;

  ctx.save();

  if (paper === 'grid') {
    const step = 6 * mm;
    ctx.lineWidth = Math.max(1, RENDER_SCALE * 0.45);
    ctx.strokeStyle = 'rgba(112,148,196,.22)';
    ctx.beginPath();
    for (let x = step; x < pageW - 0.5; x += step) {
      const xx = Math.round(x) + 0.5;
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, pageH);
    }
    for (let y = step; y < pageH - 0.5; y += step) {
      const yy = Math.round(y) + 0.5;
      ctx.moveTo(0, yy);
      ctx.lineTo(pageW, yy);
    }
    ctx.stroke();
  } else if (paper === 'dotted') {
    const step = 5 * mm;
    const radius = Math.max(1.2, RENDER_SCALE * 0.8);
    ctx.fillStyle = 'rgba(118,128,146,.42)';
    for (let y = step / 2; y < pageH; y += step) {
      for (let x = step / 2; x < pageW; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    const firstBaseline = bodyBaselineAt(layout, pageIndex, 0);

    ctx.lineWidth = Math.max(1, RENDER_SCALE * 0.5);
    ctx.strokeStyle = paper === 'legal' ? 'rgba(76,116,176,.46)' : 'rgba(96,124,166,.34)';
    ctx.beginPath();
    for (let i = 0; ; i++) {
      const y = firstBaseline + i * lineHeightPx;
      if (y > bottom) break;
      // The rule uses the same baseline value as the text, so the line
      // sits exactly under each row of writing.
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();

    const marginX = Math.round(left - 3.2 * mm) + 0.5;
    if (marginX > 0) {
      ctx.strokeStyle = paper === 'legal' ? 'rgba(196,80,86,.52)' : 'rgba(203,92,96,.42)';
      ctx.beginPath();
      ctx.moveTo(marginX, 0);
      ctx.lineTo(marginX, pageH);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawTitle(ctx, layout, pageIndex) {
  if (pageIndex !== 0 || !layout.title) return;

  const { margins, contentW, titlePx, title } = layout;
  const cx = margins.left + contentW / 2;
  const baseline = margins.top + titlePx * 0.92;
  const ink = getInkColor();

  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = canvasFont(titlePx);
  ctx.fillText(title, cx, baseline);

  const width = ctx.measureText(title).width;
  const underlineY = baseline + titlePx * 0.16;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = Math.max(1.5, RENDER_SCALE * 0.55);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, underlineY);
  ctx.quadraticCurveTo(cx, underlineY + titlePx * 0.04, cx + width / 2, underlineY);
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx, lines, pageIndex, layout) {
  const { margins, fontPx, contentW } = layout;
  const wob = clamp(state.wobble, 0, 1);
  const rnd = mulberry32((0x9e3779b1 * (pageIndex + 7)) >>> 0);
  const offset = pageOffset(layout, pageIndex);

  ctx.save();
  ctx.fillStyle = getInkColor();
  ctx.textBaseline = 'alphabetic';
  ctx.font = canvasFont(fontPx);
  ctx.textAlign = 'left';

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line) {
      rnd(); rnd(); rnd();
      continue;
    }

    const baseline = baselineAt(layout, li, offset);
    // On ruled and legal paper every row must keep the exact baseline that
    // drawRules() prints its rules on, so vertical jitter is disabled there.
    const onRules = state.paper === 'ruled' || state.paper === 'legal';
    const lineShift = onRules ? 0 : (rnd() - 0.5) * fontPx * 0.06 * wob;
    const tilt = onRules ? 0 : (rnd() - 0.5) * fontPx * 0.045 * wob;
    let x = margins.left + (rnd() - 0.5) * fontPx * 0.05 * wob;

    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const width = ctx.measureText(ch).width;

      if (ch !== ' ') {
        const y = baseline + lineShift
          + ((x - margins.left) / Math.max(1, contentW) - 0.5) * tilt;

        if (wob > 0.002) {
          ctx.save();
          ctx.translate(x + width / 2, y);
          ctx.rotate((rnd() - 0.5) * 0.05 * wob);
          ctx.globalAlpha = 0.9 + rnd() * 0.1;
          ctx.fillText(ch, -width / 2, 0);
          ctx.restore();
        } else {
          ctx.fillText(ch, x, y);
        }
      } else {
        rnd();
      }

      x += width + (rnd() - 0.5) * fontPx * 0.012 * wob;
    }
  }

  ctx.restore();
}

function drawPage(ctx, lines, pageIndex, layout) {
  const base = getPaperBase(layout.pageW, layout.pageH, state.paper);
  ctx.clearRect(0, 0, layout.pageW, layout.pageH);
  ctx.drawImage(base, 0, 0);
  drawRules(ctx, layout, pageIndex, state.paper);
  drawTitle(ctx, layout, pageIndex);
  drawText(ctx, lines, pageIndex, layout);
}

/* ---------- rendering state ---------- */
let view = null;
let renderTimer = 0;
let renderToken = 0;
const readyFonts = new Set();

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value);
  const pct = ((value - min) / (max - min)) * 100;
  input.style.setProperty('--fill', pct.toFixed(2) + '%');
}

function updateStats() {
  const chars = state.text.length;
  const words = state.text.trim() ? (state.text.match(/\S+/g) || []).length : 0;
  els.textStats.textContent = words.toLocaleString() + ' ' + (words === 1 ? 'word' : 'words')
    + ' · ' + chars.toLocaleString() + ' ' + (chars === 1 ? 'char' : 'chars');
}

function updatePreviewFont() {
  els.fontPreview.style.fontFamily = '"' + state.font + '", cursive';
}

function updateUI() {
  const spec = PAGE_SIZES[state.size];
  const count = view ? view.pages.length : 1;

  els.pageNow.textContent = String(state.page + 1);
  els.pageTotal.textContent = String(count);
  els.prevPage.disabled = state.page <= 0;
  els.nextPage.disabled = state.page >= count - 1;

  els.summary.textContent = spec.label + ' · ' + count + ' page' + (count === 1 ? '' : 's');
  els.pageMeta.textContent = spec.label + ' · ' + spec.note + ' · ' + state.font;
  els.pageDim.textContent = spec.note;
  els.inkName.textContent = INK_NAMES[state.ink] || 'Blue';
  els.paperName.textContent = PAPER_NAMES[state.paper] || 'Ruled';
  els.customInkVal.textContent = state.customInk.toUpperCase();
  els.customInkWrap.classList.toggle('active', state.ink === 'custom');

  if (view && view.truncated) {
    els.exportNote.textContent = 'This text is very long, so the preview stops at ' + count + ' pages. Try a smaller font.';
  } else if (count > 1) {
    els.exportNote.textContent = 'PNG saves the page you are viewing. PDF includes all ' + count + ' pages.';
  } else {
    els.exportNote.textContent = 'PNG and PDF both save this page.';
  }
}

function renderCanvas() {
  if (!view) return;
  const canvas = els.canvas;
  if (canvas.width !== view.pageW || canvas.height !== view.pageH) {
    canvas.width = view.pageW;
    canvas.height = view.pageH;
  }
  const ctx = canvas.getContext('2d');
  drawPage(ctx, view.pages[state.page] || [], state.page, view);
}

async function ensureFont(name) {
  if (!document.fonts || readyFonts.has(name)) return;
  try {
    await Promise.all([
      document.fonts.load('400 48px "' + name + '"'),
      document.fonts.load('700 48px "' + name + '"')
    ]);
    readyFonts.add(name);
  } catch (err) {
    /* fall back to the system cursive stack */
  }
}

async function renderNow() {
  const token = ++renderToken;
  await ensureFont(state.font);
  if (token !== renderToken) return;

  view = buildLayout();
  if (state.page > view.pages.length - 1) state.page = view.pages.length - 1;
  if (state.page < 0) state.page = 0;

  renderCanvas();
  updateUI();
}

function scheduleRender(delay) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, delay == null ? 170 : delay);
}

async function flushRender() {
  clearTimeout(renderTimer);
  await renderNow();
}

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(message, isError) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', Boolean(isError));
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3400);
}

/* ---------- export helpers ---------- */
function dataUrlToBytes(url) {
  const base64 = url.slice(url.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildPdf(images, sizeKey) {
  const spec = PAGE_SIZES[sizeKey];
  const wPt = spec.w * 72 / 25.4;
  const hPt = spec.h * 72 / 25.4;
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let cursor = 0;

  const push = value => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    parts.push(bytes);
    cursor += bytes.length;
  };
  const beginObj = id => { offsets[id] = cursor; push(id + ' 0 obj\n'); };
  const endObj = () => push('\nendobj\n');

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

  const n = images.length;
  const maxId = 2 + n * 3;
  const kids = images.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>');
  endObj();

  beginObj(2);
  push('<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>');
  endObj();

  for (let i = 0; i < n; i++) {
    const pageId = 3 + i * 3;
    const imgId = pageId + 1;
    const contentId = pageId + 2;
    const img = images[i];

    beginObj(pageId);
    push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmtPt(wPt) + ' ' + fmtPt(hPt)
      + '] /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    endObj();

    beginObj(imgId);
    push('<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.bytes.length + ' >>\nstream\n');
    push(img.bytes);
    push('\nendstream');
    endObj();

    const stream = 'q ' + fmtPt(wPt) + ' 0 0 ' + fmtPt(hPt) + ' 0 0 cm /Im0 Do Q\n';
    beginObj(contentId);
    push('<< /Length ' + encoder.encode(stream).length + ' >>\nstream\n' + stream + 'endstream');
    endObj();
  }

  const xrefStart = cursor;
  let xref = 'xref\n0 ' + (maxId + 1) + '\n0000000000 65535 f \n';
  for (let id = 1; id <= maxId; id++) {
    xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  }
  xref += 'trailer\n<< /Size ' + (maxId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
  push(xref);

  return new Blob(parts, { type: 'application/pdf' });
}

function saveBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let exporting = false;
const exportButtons = [els.btnPng, els.btnPdf, els.btnPng2, els.btnPdf2];

function setExporting(active, kind) {
  exporting = active;
  exportButtons.forEach(button => {
    button.disabled = active;
    button.classList.remove('loading');
  });
  if (active && kind) {
    exportButtons.filter(button => button.dataset.export === kind)
      .forEach(button => button.classList.add('loading'));
  }
}

function fileBase() {
  return 'handwriting-' + (slug(state.font) || 'page');
}

async function exportPng() {
  if (exporting) return;
  setExporting(true, 'png');
  try {
    await flushRender();
    const blob = await new Promise((resolve, reject) => {
      els.canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG encoding failed')), 'image/png');
    });
    saveBlob(blob, fileBase() + '-page-' + (state.page + 1) + '.png');
    toast('PNG downloaded — page ' + (state.page + 1) + ' of ' + view.pages.length + '.');
  } catch (err) {
    console.error(err);
    toast('Could not create the PNG. Please try again.', true);
  } finally {
    setExporting(false);
  }
}

async function exportPdf() {
  if (exporting) return;
  setExporting(true, 'pdf');
  try {
    await flushRender();
    const layout = view;
    const spec = PAGE_SIZES[state.size];
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    const doc = JsPDF
      ? new JsPDF({ unit: 'mm', format: [spec.w, spec.h], orientation: 'portrait', compress: true })
      : null;
    const images = [];

    if (doc) {
      doc.setProperties({
        title: state.title || 'Handwriting',
        subject: 'Text to handwriting',
        creator: 'Text to Handwriting'
      });
    }

    for (let i = 0; i < layout.pages.length; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = layout.pageW;
      canvas.height = layout.pageH;
      drawPage(canvas.getContext('2d'), layout.pages[i], i, layout);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.93);

      if (doc) {
        if (i > 0) doc.addPage([spec.w, spec.h], 'portrait');
        doc.addImage(dataUrl, 'JPEG', 0, 0, spec.w, spec.h, undefined, 'FAST');
      } else {
        images.push({
          width: canvas.width,
          height: canvas.height,
          bytes: dataUrlToBytes(dataUrl)
        });
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const blob = doc ? doc.output('blob') : buildPdf(images, state.size);
    saveBlob(blob, fileBase() + '.pdf');
    toast('PDF downloaded — ' + layout.pages.length + ' page' + (layout.pages.length === 1 ? '' : 's') + '.');
  } catch (err) {
    console.error(err);
    toast('Could not create the PDF. Please try again.', true);
  } finally {
    setExporting(false);
  }
}

/* ---------- controls ---------- */
function populateFontOptions() {
  FONT_GROUPS.forEach(group => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    group.fonts.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.style.fontFamily = '"' + name + '", cursive';
      optgroup.appendChild(option);
    });
    els.fontSelect.appendChild(optgroup);
  });
  els.fontSelect.value = state.font;
  els.fontCount.textContent = FONTS.length + ' styles';
}

function syncPaperButtons() {
  els.paperStyle.querySelectorAll('.paper-btn').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.paper === state.paper ? 'true' : 'false');
  });
}

function bindEvents() {
  els.titleInput.addEventListener('input', () => {
    state.title = els.titleInput.value;
    scheduleRender();
  });

  els.textInput.addEventListener('input', () => {
    state.text = els.textInput.value;
    updateStats();
    scheduleRender();
  });

  els.btnSample.addEventListener('click', () => {
    state.title = SAMPLE_TITLE;
    state.text = SAMPLE_TEXT;
    state.page = 0;
    els.titleInput.value = SAMPLE_TITLE;
    els.textInput.value = SAMPLE_TEXT;
    updateStats();
    flushRender();
    toast('Sample text loaded.');
  });

  els.btnClear.addEventListener('click', () => {
    state.title = '';
    state.text = '';
    state.page = 0;
    els.titleInput.value = '';
    els.textInput.value = '';
    updateStats();
    flushRender();
  });

  els.fontSelect.addEventListener('change', () => {
    state.font = els.fontSelect.value;
    updatePreviewFont();
    renderNow();
  });

  els.fontSize.addEventListener('input', () => {
    state.fontSize = Number(els.fontSize.value);
    els.fontSizeVal.textContent = state.fontSize + ' px';
    updateRangeFill(els.fontSize);
    scheduleRender();
  });

  els.lineHeight.addEventListener('input', () => {
    state.lineHeight = Number(els.lineHeight.value);
    els.lineHeightVal.textContent = state.lineHeight.toFixed(2) + '×';
    updateRangeFill(els.lineHeight);
    scheduleRender();
  });

  els.wobble.addEventListener('input', () => {
    state.wobble = Number(els.wobble.value) / 100;
    els.wobbleVal.textContent = Math.round(state.wobble * 100) + '%';
    updateRangeFill(els.wobble);
    scheduleRender();
  });

  document.querySelectorAll('input[name="ink"]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.ink = input.value;
      updateUI();
      scheduleRender(0);
    });
  });

  els.inkCustom.addEventListener('input', () => {
    state.customInk = els.inkCustom.value;
    state.ink = 'custom';
    document.querySelectorAll('input[name="ink"]').forEach(input => { input.checked = false; });
    updateUI();
    scheduleRender(70);
  });

  els.pageSize.addEventListener('change', () => {
    state.size = els.pageSize.value;
    invalidatePaperCache();
    renderNow();
  });

  marginInputs.forEach(input => {
    const key = input.dataset.margin;

    input.addEventListener('input', () => {
      if (input.value === '') return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      state.margins[key] = clamp(value, 0, 60);
      scheduleRender();
    });

    input.addEventListener('change', () => {
      let value = Number(input.value);
      if (!Number.isFinite(value)) value = 0;
      value = clamp(value, 0, 60);
      input.value = String(value);
      state.margins[key] = value;
      scheduleRender(0);
    });
  });

  els.paperStyle.addEventListener('click', event => {
    const button = event.target.closest('.paper-btn');
    if (!button) return;
    state.paper = button.dataset.paper;
    syncPaperButtons();
    // Paper background is cached, so drop it and repaint immediately instead
    // of waiting for the debounced text render.
    invalidatePaperCache();
    clearTimeout(renderTimer);
    renderCanvas();
    updateUI();
    renderNow();
  });

  els.prevPage.addEventListener('click', () => {
    if (!view || state.page <= 0) return;
    state.page--;
    renderCanvas();
    updateUI();
  });

  els.nextPage.addEventListener('click', () => {
    if (!view || state.page >= view.pages.length - 1) return;
    state.page++;
    renderCanvas();
    updateUI();
  });

  exportButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.export === 'pdf') exportPdf();
      else exportPng();
    });
  });
}

function init() {
  populateFontOptions();

  els.titleInput.value = state.title;
  els.textInput.value = state.text;
  els.fontSelect.value = state.font;
  els.fontSize.value = String(state.fontSize);
  els.lineHeight.value = String(state.lineHeight);
  els.wobble.value = String(Math.round(state.wobble * 100));
  els.pageSize.value = state.size;
  els.inkCustom.value = state.customInk;

  els.fontSizeVal.textContent = state.fontSize + ' px';
  els.lineHeightVal.textContent = state.lineHeight.toFixed(2) + '×';
  els.wobbleVal.textContent = Math.round(state.wobble * 100) + '%';
  els.renderDpi.textContent = 'Rendered at ' + Math.round(96 * RENDER_SCALE) + ' DPI';

  [els.fontSize, els.lineHeight, els.wobble].forEach(updateRangeFill);
  syncPaperButtons();
  updatePreviewFont();
  updateStats();
  bindEvents();
  renderNow();
}

init();
