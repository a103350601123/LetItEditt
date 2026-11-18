/* Toolbox PDF Editor — local PDF annotation + flattening.
   pdf.js renders pages, Pointer Events drive every tool, pdf-lib writes the export. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const FONT_STACKS = {
    Helvetica: 'Arial, Helvetica, sans-serif',
    'Helvetica Bold': 'Arial, Helvetica, sans-serif',
    'Times New Roman': '"Times New Roman", Times, serif',
    'Times New Roman Bold': '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace',
    'Courier Bold': '"Courier New", Courier, monospace',
    Unicode: '"Noto Sans", "Segoe UI", Tahoma, Arial, sans-serif',
    'Unicode Bold': '"Noto Sans", "Segoe UI", Tahoma, Arial, sans-serif',
    CJK: '"Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "Yu Gothic", sans-serif',
    'CJK Bold': '"Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "Yu Gothic", sans-serif'
  };
  const BASELINE = {
    Helvetica: 1.0,
    'Helvetica Bold': 1.0,
    'Times New Roman': 0.997,
    'Times New Roman Bold': 0.997,
    Courier: 0.927,
    'Courier Bold': 0.927,
    Unicode: 1.0,
    'Unicode Bold': 1.0,
    CJK: 1.0,
    'CJK Bold': 1.0
  };
  const PDF_FONTS = {
    Helvetica: 'Helvetica',
    'Helvetica Bold': 'HelveticaBold',
    'Times New Roman': 'TimesRoman',
    'Times New Roman Bold': 'TimesRomanBold',
    Courier: 'Courier',
    'Courier Bold': 'CourierBold'
  };
  /* Free, embedded fonts used when a replacement contains characters that the
     standard PDF fonts cannot encode. Loaded only when needed. */
  const CUSTOM_FONT_URLS = {
    Unicode: 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf',
    'Unicode Bold': 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf',
    CJK: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
    'CJK Bold': 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf'
  };
  /* Scripts that need bidi/reshaping, which pdf-lib's drawText cannot do.
     They are exported as crisp transparent text images so the visual result
     still matches the editable browser preview. */
  const COMPLEX_SCRIPT_RE = /[\u0590-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u1000-\u109F\u1780-\u17FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const RTL_SCRIPT_RE = /[\u0590-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const CJK_RE = /[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
  let fontkitRegistered = false;
  const TOOLS = ['select', 'text', 'edittext', 'highlight', 'draw', 'whiteout', 'redact', 'erase'];
  const CANVAS_MARKS = ['highlight', 'draw', 'whiteout', 'redact'];
  const DOC_DEFAULTS = {
    pageNumberStart: '1',
    pageNumberPosition: 'bottom-right',
    pageNumberSize: '12',
    pageNumberColor: '#333333',
    watermarkText: 'DRAFT',
    watermarkOpacity: '18',
    watermarkAngle: '45',
    watermarkSize: '54',
    watermarkColor: '#777777',
    compressQuality: '0.85',
    splitSpec: '1'
  };
  const MAX_PAGE_WIDTH = 1000;
  const MAX_CANVAS_PIXELS = 7.5e6;

  const state = {
    doc: null,
    bytes: null,
    fileName: '',
    pages: [],
    annotations: [],
    selected: null,
    tool: 'select',
    activePage: 0,
    lastWidth: 0,
    past: [],
    future: [],
    busy: false,
    loadSeq: 0,
    textDefaults: { size: 16, color: '#111827', font: 'Helvetica' },
    highlightDefaults: { color: '#ffe14d', snap: true },
    drawDefaults: { color: '#ef4444', width: 3 },
    redactDefaults: { color: '#000000' },
    previewRect: null,
    annEls: new Map(),
    drag: null,
    dragging: false,
    eraseCount: 0,
    thumbFilling: false,
    prefs: { highlightAlpha: 0.38 },
    ocrTexts: [],
    sigPad: { color: '#111827', width: 3, hasMarks: false }
  };

  const els = {
    pdfInput: $('#pdfInput'),
    imageInput: $('#imageInput'),
    uploadBtn: $('#uploadBtn'),
    exportTop: $('#exportBtnTop'),
    fileChip: $('#fileChip'),
    fileChipText: $('#fileChipText'),
    canvasArea: $('#canvasArea'),
    pages: $('#pages'),
    thumbs: $('#thumbs'),
    pageCount: $('#pageCount'),
    pageIndicator: $('#pageIndicator'),
    prevPage: $('#prevPage'),
    nextPage: $('#nextPage'),
    pageJump: $('#pageJump'),
    stageFoot: $('#stageFoot'),
    loading: $('#loading'),
    loadingText: $('#loadingText'),
    loadingBar: $('#loadingBar'),
    toast: $('#toast'),
    annCount: $('#annCount'),
    undoBtn: $('#undoBtn'),
    redoBtn: $('#redoBtn'),
    deleteBtn: $('#deleteBtn'),
    clearPageBtn: $('#clearPageBtn'),
    fontSize: $('#fontSize'),
    fontSizeVal: $('#fontSizeVal'),
    textFont: $('#textFont'),
    textColor: $('#textColor'),
    hlColor: $('#hlColor'),
    snapToggle: $('#snapToggle'),
    brushSize: $('#brushSize'),
    brushSizeVal: $('#brushSizeVal'),
    drawColor: $('#drawColor'),
    imageBtn: $('#imageBtn'),
    toolOptions: $('#toolOptions'),
    thumbsSheet: $('#thumbsSheet'),
    sheetBackdrop: $('#sheetBackdrop'),
    closeThumbs: $('#closeThumbs'),
    pageToolsBtn: $('#pageToolsBtn'),
    pageToolsSheet: $('#pageToolsSheet'),
    closePageTools: $('#closePageTools'),
    pageToolsCount: $('#pageToolsCount'),
    mergePdfInput: $('#mergePdfInput'),
    ocrText: $('#ocrText'),
    sigBackdrop: $('#sigBackdrop'),
    sigModal: $('#sigModal'),
    sigCanvas: $('#sigCanvas'),
    sigClear: $('#sigClear'),
    sigColor: $('#sigColor'),
    sigSize: $('#sigSize'),
    sigSizeVal: $('#sigSizeVal'),
    sigPlace: $('#sigPlace'),
    sigCancel: $('#sigCancel'),
    sigUpload: $('#sigUpload'),
    emptyState: $('#emptyState'),
    emptyError: $('#emptyError'),
    dropzone: $('#dropzone')
  };

  /* ---------- small helpers ---------- */
  let toastTimer = 0;
  function toast(message, type) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.className = 'toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.className = 'toast' + (type === 'error' ? ' error' : '');
    }, 3600);
  }
  function fillRange(input) {
    if (!input) return;
    const min = Number(input.min || 0), max = Number(input.max || 100), val = Number(input.value);
    input.style.setProperty('--fill', ((val - min) / (max - min) || 0) * 100 + '%');
  }
  function setProgress(pct) {
    if (!els.loadingBar) return;
    els.loadingBar.style.width = (pct == null ? 0 : clamp(pct, 0, 100)) + '%';
  }
  function showLoading(text, pct) {
    els.loading.hidden = false;
    els.loadingText.textContent = text || 'Working…';
    setProgress(pct == null ? 0 : pct);
  }
  function hideLoading() {
    els.loading.hidden = true;
    setProgress(0);
  }
  function hexToRgb(hex) {
    let h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  function validHex(hex) {
    return /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? String(hex).toLowerCase() : null;
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function dataUrlToBytes(dataUrl) {
    const base64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The image could not be read.'));
      img.src = src;
    });
  }
  function isCustomFontKey(key) {
    return Object.prototype.hasOwnProperty.call(CUSTOM_FONT_URLS, key);
  }
  function isBoldFontKey(key) {
    return /bold/i.test(String(key || ''));
  }
  function needsUnicodeFont(text) {
    return /[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/.test(String(text || ''));
  }
  function isComplexScript(text) {
    return COMPLEX_SCRIPT_RE.test(String(text || ''));
  }
  function isRtlText(text) {
    return RTL_SCRIPT_RE.test(String(text || ''));
  }
  function effectiveFontKey(a) {
    const base = a && a.font ? a.font : 'Helvetica';
    const text = a && (a.text || a.sourceText) ? (a.text || a.sourceText) : '';
    if (!needsUnicodeFont(text)) return base;
    const bold = isBoldFontKey(base) || !!(a && a.fontBold);
    if (CJK_RE.test(String(text))) return bold ? 'CJK Bold' : 'CJK';
    return bold ? 'Unicode Bold' : 'Unicode';
  }
  function sanitizeForPdf(text, fontKey) {
    let clean = String(text || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\u00A0/g, ' ');
    if (isCustomFontKey(fontKey) || needsUnicodeFont(clean)) return clean;
    return clean
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF\u20AC]/g, '');
  }
  function normalizeHex(color, fallback) {
    return validHex(color) || fallback;
  }
  function mapDetectedFont(info, fontName) {
    const meta = info && typeof info === 'object'
      ? info
      : { family: String(info || ''), name: String(fontName || '') };
    const raw = [meta.family, meta.fallback, meta.name, fontName]
      .filter(Boolean).join(' ').toLowerCase();
    const bold = !!(meta.bold || meta.black) || /bold|heavy|black|semibold/.test(raw);
    if (/courier|mono|typewriter|fixed/.test(raw)) return bold ? 'Courier Bold' : 'Courier';
    if (/sans[\s-]?serif|helvetica|arial|verdana|liberation sans/.test(raw)) {
      return bold ? 'Helvetica Bold' : 'Helvetica';
    }
    if (/times|serif|georgia|palatino|garamond|book|minion/.test(raw)) {
      return bold ? 'Times New Roman Bold' : 'Times New Roman';
    }
    return bold ? 'Helvetica Bold' : 'Helvetica';
  }
  function toHexFromRgb(r, g, b) {
    const part = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return '#' + part(r) + part(g) + part(b);
  }
  /* Find the dominant page colour behind a line and its farthest ink colour.
     This preserves coloured backgrounds and white text on dark backgrounds. */
  function sampleLineColors(p, line) {
    const dark = '#111827';
    const light = '#ffffff';
    if (!p || !p.bg || !p.bg.width || !p.bgRendered) {
      return { text: dark, background: light };
    }
    const scale = Math.max(0.01, (p.scale || 1) * (p.raster || 1));
    const pad = 2;
    const x0 = clamp(Math.floor(line.x * scale) - pad, 0, Math.max(0, p.bg.width - 1));
    const y0 = clamp(Math.floor(line.y * scale) - pad, 0, Math.max(0, p.bg.height - 1));
    const x1 = clamp(Math.ceil((line.x + line.w) * scale) + pad, x0 + 1, p.bg.width);
    const y1 = clamp(Math.ceil((line.y + line.h) * scale) + pad, y0 + 1, p.bg.height);
    try {
      const data = p.bg.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const bins = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        bin.n++; bin.r += r; bin.g += g; bin.b += b;
        bins.set(key, bin);
      }
      let bgBin = null;
      bins.forEach(bin => { if (!bgBin || bin.n > bgBin.n) bgBin = bin; });
      if (!bgBin) return { text: dark, background: light };
      const bg = [bgBin.r / bgBin.n, bgBin.g / bgBin.n, bgBin.b / bgBin.n];
      let farthest = null;
      let bestDist = -1;
      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist > bestDist) {
          bestDist = dist;
          farthest = [data[i], data[i + 1], data[i + 2]];
        }
      }
      const text = bestDist > 900 && farthest
        ? toHexFromRgb(farthest[0], farthest[1], farthest[2])
        : ((bg[0] + bg[1] + bg[2]) < 382 ? light : dark);
      return { text, background: toHexFromRgb(bg[0], bg[1], bg[2]) };
    } catch (e) {
      return { text: dark, background: light };
    }
  }
  let measureCtx = null;
  function textWidthInPageUnits(a) {
    if (!measureCtx) {
      const canvas = document.createElement('canvas');
      measureCtx = canvas.getContext('2d');
    }
    const size = Math.max(1, Number(a.size) || 12);
    const key = effectiveFontKey(a);
    const stack = FONT_STACKS[key] || FONT_STACKS.Helvetica;
    const weight = isBoldFontKey(key) ? 700 : 400;
    measureCtx.font = weight + ' ' + size + 'px ' + stack;
    const width = measureCtx.measureText(String(a.text || ' ')).width;
    return Number.isFinite(width) ? width : String(a.text || '').length * size * 0.55;
  }
  function resizeExistingTextEdit(a, el) {
    if (!a || a.source !== 'existing' || !el) return;
    const p = state.pages[a.page];
    if (!p) return;
    const base = Math.max(20, Number(a.baseW || a.w) + 12);
    const needed = textWidthInPageUnits(a) + 8;
    const maxW = Math.max(base, p.vp1.width - a.x);
    const next = clamp(Math.max(base, needed), 24, maxW);
    if (Math.abs(next - a.w) > 0.5) {
      a.w = next;
      el.style.width = (a.w * p.scale).toFixed(2) + 'px';
    }
  }

  /* ---------- control sync ---------- */
  function customSwatchFor(group) {
    const input = group === 'text' ? els.textColor : group === 'highlight' ? els.hlColor : els.drawColor;
    return input ? input.closest('.swatch.custom') : null;
  }
  function syncSwatches(group, color) {
    let matched = false;
    $$('.swatch[data-group="' + group + '"]').forEach(btn => {
      const on = String(btn.dataset.color || '').toLowerCase() === String(color).toLowerCase();
      btn.setAttribute('aria-pressed', String(on));
      if (on) matched = true;
    });
    const custom = customSwatchFor(group);
    if (custom) {
      const hex = validHex(color);
      if (hex) {
        custom.style.setProperty('--c', hex);
        const input = custom.querySelector('input');
        if (input && input.value.toLowerCase() !== hex) input.value = hex;
      }
      custom.classList.toggle('is-on', !matched);
    }
  }
  function applyTextSize(value, commitChange) {
    const size = clamp(Math.round(Number(value) || 16), 8, 48);
    state.textDefaults.size = size;
    els.fontSize.value = size;
    els.fontSizeVal.textContent = size + ' pt';
    fillRange(els.fontSize);
    const a = state.selected ? annById(state.selected) : null;
    if (a && a.type === 'text' && a.size !== size) {
      a.size = size;
      updateAnnEl(a);
      if (commitChange) commit();
    }
  }
  function applyTextColor(color, commitChange) {
    const hex = normalizeHex(color, '#111827');
    state.textDefaults.color = hex;
    els.textColor.value = hex;
    syncSwatches('text', hex);
    const a = state.selected ? annById(state.selected) : null;
    if (a && a.type === 'text' && a.color !== hex) {
      a.color = hex;
      updateAnnEl(a);
      if (commitChange) commit();
    }
  }
  function applyTextFont(font, commitChange) {
    if (!FONT_STACKS[font]) font = 'Helvetica';
    state.textDefaults.font = font;
    els.textFont.value = font;
    const a = state.selected ? annById(state.selected) : null;
    if (a && a.type === 'text' && a.font !== font) {
      a.font = font;
      updateAnnEl(a);
      if (commitChange) commit();
    }
  }
  function applyHighlightColor(color, commitChange) {
    const hex = normalizeHex(color, '#ffe14d');
    state.highlightDefaults.color = hex;
    els.hlColor.value = hex;
    syncSwatches('highlight', hex);
    const a = state.selected ? annById(state.selected) : null;
    if (a && a.type === 'highlight' && a.color !== hex) {
      a.color = hex;
      renderAllOverlays();
      if (commitChange) commit();
    }
  }
  function applyDrawColor(color, commitChange) {
    const hex = normalizeHex(color, '#ef4444');
    state.drawDefaults.color = hex;
    els.drawColor.value = hex;
    syncSwatches('draw', hex);
    const a = state.selected ? annById(state.selected) : null;
    if (a && a.type === 'draw' && a.color !== hex) {
      a.color = hex;
      renderAllOverlays();
      if (commitChange) commit();
    }
  }
  function applyRedactColor(color, commitChange) {
    const hex = normalizeHex(color, '#000000');
    state.redactDefaults.color = hex;
    syncSwatches('redact', hex);
    const a = state.selected ? annById(state.selected) : null;
    if (a && a.type === 'redact' && a.color !== hex) {
      a.color = hex;
      renderAllOverlays();
      if (commitChange) commit();
    }
  }
  function applyBrushSize(value) {
    const size = clamp(Math.round(Number(value) || 3), 1, 24);
    state.drawDefaults.width = size;
    els.brushSize.value = size;
    els.brushSizeVal.textContent = size + ' pt';
    fillRange(els.brushSize);
  }
  function updateToolUi() {
    $$('.tool-btn[data-tool]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.tool === state.tool));
    });
    $$('.tool-options .opt').forEach(opt => {
      const textToolOption = opt.dataset.for === 'text' && state.tool === 'edittext';
      opt.classList.toggle('is-on', opt.dataset.for === state.tool || textToolOption);
    });
    $$('.tool-options [data-only]').forEach(el => {
      el.hidden = el.dataset.only !== state.tool;
    });
  }
  function setTool(tool) {
    if (tool === 'image') {
      if (!state.doc) { toast('Open a PDF first, then add an image.', 'error'); return; }
      els.imageInput.click();
      return;
    }
    if (TOOLS.indexOf(tool) === -1) tool = 'select';
    if (state.tool === tool) { updateToolUi(); return; }
    if (state.tool === 'text' || state.tool === 'edittext') finalizeTextEdits();
    if (tool !== 'text' && tool !== 'edittext') exitTextEdit();
    state.tool = tool;
    document.body.dataset.tool = tool;
    updateToolUi();
    if (tool !== 'select') selectAnn(null);
    clearPreviews();
    renderAllOverlays();
  }

  /* ---------- page geometry ---------- */
  function canvasPoint(p, ev) {
    const r = p.ov.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / Math.max(1, r.width)) * p.vp1.width;
    const y = ((ev.clientY - r.top) / Math.max(1, r.height)) * p.vp1.height;
    return { x: clamp(x, 0, p.vp1.width), y: clamp(y, 0, p.vp1.height) };
  }
  function sizeCanvases(p) {
    const cssW = Math.max(1, p.vp1.width * p.scale);
    const cssH = Math.max(1, p.vp1.height * p.scale);
    p.inner.style.width = cssW + 'px';
    p.inner.style.height = cssH + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pxW = Math.max(1, Math.round(cssW * dpr));
    let pxH = Math.max(1, Math.round(cssH * dpr));
    if (pxW * pxH > MAX_CANVAS_PIXELS) {
      const f = Math.sqrt(MAX_CANVAS_PIXELS / (pxW * pxH));
      pxW = Math.max(1, Math.round(pxW * f));
      pxH = Math.max(1, Math.round(pxH * f));
    }
    if (p.bg.width !== pxW || p.bg.height !== pxH) {
      p.renderToken++;
      if (p.renderTask) { try { p.renderTask.cancel(); } catch (e) {} p.renderTask = null; }
      p.bg.width = pxW;
      p.bg.height = pxH;
      p.ov.width = pxW;
      p.ov.height = pxH;
      p.bgRendered = false;
    }
    p.raster = pxW / cssW;
  }
  function layoutPages() {
    if (!state.pages.length) return;
    const area = els.canvasArea;
    const width = area.clientWidth;
    if (!width || width === state.lastWidth) return;
    state.lastWidth = width;
    const cs = getComputedStyle(area);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const avail = Math.max(200, width - pad);
    const target = Math.min(avail, MAX_PAGE_WIDTH);
    state.pages.forEach(p => {
      p.scale = target / p.vp1.width;
      sizeCanvases(p);
    });
    repositionAllAnnotations();
    renderAllOverlays();
    renderVisiblePages();
    updateActivePage();
  }
  function renderVisiblePages() {
    if (!state.pages.length) return;
    const ar = els.canvasArea.getBoundingClientRect();
    state.pages.forEach(p => {
      const r = p.wrap.getBoundingClientRect();
      if (r.bottom > ar.top - 700 && r.top < ar.bottom + 700 && !p.bgRendered) renderPageBg(p);
    });
  }
  async function renderPageBg(p) {
    if (!p.page || p.rendering || p.bgRendered) return;
    const token = ++p.renderToken;
    p.rendering = true;
    try {
      const vp = p.page.getViewport({ scale: p.scale });
      const ctx = p.bg.getContext('2d', { alpha: false });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, p.bg.width, p.bg.height);
      const task = p.page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: p.raster === 1 ? null : [p.raster, 0, 0, p.raster, 0, 0]
      });
      p.renderTask = task;
      await task.promise;
      if (token === p.renderToken) p.bgRendered = true;
    } catch (err) {
      if (!err || err.name !== 'RenderingCancelledException') console.warn('[pdf] render failed', err);
    } finally {
      if (token === p.renderToken) {
        p.rendering = false;
        p.renderTask = null;
      }
    }
  }
  function makePageDom(index) {
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.dataset.page = String(index);
    const tag = document.createElement('span');
    tag.className = 'page-tag';
    tag.textContent = 'Page ' + (index + 1);
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    const bg = document.createElement('canvas');
    bg.className = 'page-bg';
    bg.setAttribute('aria-hidden', 'true');
    const ov = document.createElement('canvas');
    ov.className = 'page-ov';
    ov.setAttribute('aria-label', 'Annotation layer for page ' + (index + 1));
    const dom = document.createElement('div');
    dom.className = 'ann-layer';
    inner.append(bg, ov, dom);
    wrap.append(tag, inner);
    return { wrap, inner, bg, ov, dom };
  }

  /* ---------- open / reset ---------- */
  function destroyCurrentDoc() {
    if (state.doc) { try { state.doc.destroy(); } catch (e) {} state.doc = null; }
    resetWorkspace();
  }

  /* Loads bytes into a fresh workspace. Loading UI stays under the caller's
     control so document operations can keep the progress card visible. */
  async function loadPdfBytes(bytes, name, seq, message) {
    if (!window.pdfjsLib) throw new Error('The PDF engine could not be loaded. Check your internet connection and reload the page.');
    state.bytes = bytes;
    state.fileName = name || 'document.pdf';
    const task = window.pdfjsLib.getDocument({ data: state.bytes.slice() });
    let cancelled = false;
    task.onProgress = info => {
      if (info && info.total) setProgress(8 + (info.loaded / info.total) * 52);
    };
    task.onPassword = (updatePassword, reason) => {
      const promptMessage = reason === 1
        ? 'This PDF is password protected. Enter the password to open it:'
        : 'That password was not correct. Try again:';
      const pw = window.prompt(promptMessage);
      if (pw === null) {
        cancelled = true;
        try { task.destroy(); } catch (e) {}
        return;
      }
      updatePassword(pw);
    };
    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      if (cancelled) return false;
      throw err;
    }
    if (seq !== state.loadSeq) { try { doc.destroy(); } catch (e) {} return false; }
    state.doc = doc;
    els.loadingText.textContent = 'Preparing pages…';
    setProgress(62);

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (seq !== state.loadSeq) return false;
      const vp1 = page.getViewport({ scale: 1 });
      const dom = makePageDom(i - 1);
      els.pages.appendChild(dom.wrap);
      const entry = {
        num: i,
        index: i - 1,
        page,
        vp1,
        rotation: ((page.rotate % 360) + 360) % 360,
        scale: 1,
        raster: 1,
        bgRendered: false,
        rendering: false,
        renderTask: null,
        renderToken: 0,
        textRects: null,
        textItems: null,
        textLines: null,
        textDataPromise: null,
        thumbBuilt: false,
        thumbCanvas: null,
        ...dom
      };
      state.pages.push(entry);
      attachPageEvents(entry);
      if (i % 5 === 0) setProgress(62 + (i / doc.numPages) * 20);
    }

    els.emptyState.hidden = true;
    els.stageFoot.hidden = false;
    els.fileChip.classList.add('ready');
    els.fileChip.title = state.fileName;
    els.fileChipText.textContent = state.fileName + ' · ' + doc.numPages + (doc.numPages === 1 ? ' page' : ' pages');
    els.pageCount.textContent = doc.numPages + (doc.numPages === 1 ? ' page' : ' pages');
    state.lastWidth = 0;
    layoutPages();
    setProgress(88);
    const first = state.pages[0];
    if (first) await renderPageBg(first);
    buildThumbnails(seq);
    updateHistoryButtons();
    updateCount();
    updateActivePage();
    if (message) toast(message);
    requestAnimationFrame(() => { layoutPages(); updateActivePage(); });
    return true;
  }

  async function openPdf(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
      toast('Please choose a PDF file.', 'error');
      return;
    }
    if (!window.pdfjsLib) {
      showEmptyError('The PDF engine could not be loaded. Check your internet connection and reload the page.');
      return;
    }
    clearEmptyError();
    showLoading('Reading your PDF…', 8);
    await new Promise(r => setTimeout(r, 30));
    const seq = ++state.loadSeq;
    destroyCurrentDoc();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadPdfBytes(bytes, file.name || 'document.pdf', seq, 'PDF ready — pick a tool and start annotating.');
    } catch (err) {
      if (seq !== state.loadSeq) return;
      console.error(err);
      const name = err && err.name;
      let msg = 'This PDF could not be opened. It may be damaged or unsupported.';
      if (name === 'PasswordException') msg = 'This PDF is password protected and could not be unlocked.';
      if (name === 'InvalidPDFException') msg = 'That file does not look like a valid PDF.';
      if (!state.pages.length) { resetWorkspace(); showEmptyError(msg); }
      toast(msg, 'error');
    } finally {
      if (seq === state.loadSeq) hideLoading();
    }
  }

  /* Structural tools first flatten marks into real PDF content, then load the
     result as the new source of truth. Annotation history resets afterwards. */
  async function replacePdf(bytes, name, message) {
    const seq = ++state.loadSeq;
    destroyCurrentDoc();
    els.loadingText.textContent = 'Loading updated PDF…';
    setProgress(18);
    await new Promise(r => setTimeout(r, 20));
    return loadPdfBytes(bytes, name || state.fileName, seq, message || 'Document updated.');
  }

  function resetWorkspace() {
    state.pages.forEach(p => {
      if (p.renderTask) { try { p.renderTask.cancel(); } catch (e) {} }
      p.wrap.remove();
    });
    state.pages = [];
    state.annotations = [];
    state.selected = null;
    state.activePage = 0;
    state.lastWidth = 0;
    state.previewRect = null;
    state.drag = null;
    state.dragging = false;
    state.annEls.clear();
    state.ocrTexts = [];
    if (els.ocrText) els.ocrText.value = '';
    els.pages.innerHTML = '';
    els.thumbs.innerHTML = '';
    els.emptyState.hidden = false;
    els.stageFoot.hidden = true;
    els.fileChip.classList.remove('ready');
    els.fileChip.removeAttribute('title');
    els.fileChipText.textContent = 'No PDF loaded';
    els.pageCount.textContent = 'No file';
    els.pageIndicator.textContent = 'Page 0 / 0';
    els.exportTop.disabled = true;
    resetHistory();
    updateCount();
    updateActions();
    closeSheet();
  }
  function showEmptyError(message) {
    els.emptyState.hidden = false;
    els.emptyError.hidden = false;
    els.emptyError.textContent = message;
  }
  function clearEmptyError() {
    els.emptyError.hidden = true;
    els.emptyError.textContent = '';
  }

  /* ---------- thumbnails ---------- */
  function buildThumbnails(seq) {
    if (!state.pages.length) return;
    els.thumbs.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.pages.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb' + (i === state.activePage ? ' is-active' : '');
      btn.dataset.page = String(i);
      btn.setAttribute('aria-label', 'Go to page ' + (i + 1));
      const c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      btn.append(c, num);
      btn.addEventListener('click', () => {
        closeSheet();
        scrollToPage(i);
      });
      frag.appendChild(btn);
      p.thumbCanvas = c;
      p.thumbBuilt = false;
    });
    els.thumbs.appendChild(frag);
    if (state.pages.length <= 40) fillThumbnails(seq);
  }
  async function fillThumbnails(seq) {
    if (state.thumbFilling) return;
    state.thumbFilling = true;
    try {
      for (const p of state.pages) {
        if (seq !== state.loadSeq) break;
        p.thumbQueue = true;
        if (p.thumbBuilt || !p.thumbCanvas || !p.page) continue;
        try {
          const targetW = 150;
          const scale = targetW / p.vp1.width;
          const vp = p.page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
          const c = p.thumbCanvas;
          c.width = Math.max(1, Math.round(vp.width * dpr));
          c.height = Math.max(1, Math.round(vp.height * dpr));
          const ctx = c.getContext('2d', { alpha: false });
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          await p.page.render({
            canvasContext: ctx,
            viewport: vp,
            transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
          }).promise;
          p.thumbBuilt = true;
        } catch (e) {
          if (!e || e.name !== 'RenderingCancelledException') console.warn('[pdf] thumb failed', e);
          p.thumbBuilt = true;
        }
        await new Promise(r => setTimeout(r, 0));
      }
    } finally {
      state.thumbFilling = false;
    }
  }
  function scrollToPage(index) {
    const p = state.pages[clamp(index, 0, state.pages.length - 1)];
    if (!p) return;
    const area = els.canvasArea;
    const ar = area.getBoundingClientRect();
    const pr = p.wrap.getBoundingClientRect();
    const top = pr.top - ar.top + area.scrollTop - 6;
    area.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  function markActiveThumb(index) {
    $$('.thumb', els.thumbs).forEach(t => t.classList.toggle('is-active', Number(t.dataset.page) === index));
  }
  function updateActivePage() {
    if (!state.pages.length) {
      els.pageIndicator.textContent = 'Page 0 / 0';
      return;
    }
    const area = els.canvasArea;
    const ar = area.getBoundingClientRect();
    const mid = ar.top + area.clientHeight / 2;
    let best = 0, bestDist = Infinity;
    state.pages.forEach((p, i) => {
      const r = p.wrap.getBoundingClientRect();
      if (r.bottom <= ar.top || r.top >= ar.bottom) return;
      const dist = Math.abs(r.top + r.height / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    state.activePage = best;
    const p = state.pages[best];
    if (p) els.pageIndicator.textContent = 'Page ' + p.num + ' / ' + state.pages.length;
    markActiveThumb(best);
    updateActions();
  }
  function updateCount() {
    const n = state.annotations.length;
    els.annCount.textContent = n + (n === 1 ? ' mark' : ' marks');
  }
  function updateActions() {
    const hasDoc = !!state.doc;
    els.exportTop.disabled = !hasDoc || state.busy;
    if (els.pageToolsBtn) els.pageToolsBtn.disabled = !hasDoc || state.busy;
    els.undoBtn.disabled = state.past.length <= 1;
    els.redoBtn.disabled = state.future.length === 0;
    els.deleteBtn.disabled = !state.selected;
    els.prevPage.disabled = !hasDoc || state.activePage <= 0;
    els.nextPage.disabled = !hasDoc || state.activePage >= state.pages.length - 1;
    els.clearPageBtn.disabled = !hasDoc || !state.annotations.some(a => a.page === state.activePage);
    updatePageToolsUi();
  }
  function updatePageToolsUi() {
    if (!els.pageToolsSheet) return;
    if (els.pageToolsCount) {
      els.pageToolsCount.textContent = state.doc
        ? state.pages.length + (state.pages.length === 1 ? ' page' : ' pages')
        : 'No file';
    }
    $$('[data-page-action]', els.pageToolsSheet).forEach(btn => {
      const action = btn.dataset.pageAction;
      const needsOcr = action === 'copy-ocr' || action === 'add-ocr';
      btn.disabled = !state.doc || state.busy || (needsOcr && !state.ocrTexts.length);
    });
  }
  function setBusy(busy) {
    state.busy = !!busy;
    if (els.exportTop) {
      els.exportTop.classList.toggle('loading', state.busy);
      els.exportTop.setAttribute('aria-busy', String(state.busy));
    }
    updateActions();
    updatePageToolsUi();
  }

  /* ---------- overlay painting ---------- */
  function drawPageOverlay(p) {
    if (!p.ov || !p.scale || !p.ov.width) return;
    const ctx = p.ov.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.ov.width, p.ov.height);
    /* Annotations are stored in PDF-page units; the overlay canvas is
       vp1 * scale * raster pixels, so include the page scale here. */
    ctx.setTransform(p.raster * p.scale, 0, 0, p.raster * p.scale, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* Edited original text is masked before any other marks are painted,
       so highlights and strokes stay visible over the replacement. */
    state.annotations.forEach(a => {
      if (a.page !== p.index || !a.cover) return;
      ctx.globalAlpha = 1;
      ctx.fillStyle = a.cover.color || '#ffffff';
      ctx.fillRect(a.cover.x, a.cover.y, a.cover.w, a.cover.h);
    });

    state.annotations.forEach(a => {
      if (a.page !== p.index || a.type === 'redact') return;
      if (a.type === 'whiteout') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = a.color || '#ffffff';
        ctx.fillRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h);
      } else if (a.type === 'highlight') {
        ctx.globalAlpha = state.prefs.highlightAlpha;
        ctx.fillStyle = a.color;
        a.rects.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));
        ctx.globalAlpha = 1;
      } else if (a.type === 'draw') {
        drawStroke(ctx, a.points, a.color, a.width);
      }
    });
    /* Redactions paint last so nothing can visually cover what will be removed. */
    state.annotations.forEach(a => {
      if (a.page !== p.index || a.type !== 'redact') return;
      ctx.globalAlpha = 1;
      ctx.fillStyle = a.color || '#000000';
      ctx.fillRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h);
    });

    const preview = state.previewRect;
    if (preview && preview.page === p.index) {
      const r = preview;
      if (preview.kind === 'whiteout' || preview.kind === 'redact') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = preview.kind === 'redact' ? state.redactDefaults.color : '#ffffff';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else {
        ctx.globalAlpha = state.prefs.highlightAlpha;
        ctx.fillStyle = state.highlightDefaults.color;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
      const lw = 1.5 / Math.max(p.scale, 0.2);
      ctx.strokeStyle = preview.kind === 'whiteout' || preview.kind === 'redact'
        ? 'rgba(124,92,255,.95)' : 'rgba(59,160,255,.85)';
      ctx.lineWidth = lw;
      ctx.setLineDash([5 / Math.max(p.scale, 0.2), 4 / Math.max(p.scale, 0.2)]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }

    const sel = state.selected ? annById(state.selected) : null;
    if (sel && sel.page === p.index && CANVAS_MARKS.indexOf(sel.type) !== -1) {
      const bb = annBBox(sel);
      if (bb) {
        const lw = 1.5 / Math.max(p.scale, 0.2);
        ctx.strokeStyle = 'rgba(59,160,255,.95)';
        ctx.lineWidth = lw;
        ctx.setLineDash([6 / Math.max(p.scale, 0.2), 4 / Math.max(p.scale, 0.2)]);
        ctx.strokeRect(bb.x - 2, bb.y - 2, bb.w + 4, bb.h + 4);
        ctx.setLineDash([]);
      }
    }
  }
  function drawStroke(ctx, points, color, width) {
    if (!points || !points.length) return;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, Math.max(width / 2, 0.4), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  function renderAllOverlays() {
    state.pages.forEach(p => drawPageOverlay(p));
  }
  function clearPreviews() {
    state.previewRect = null;
  }

  /* ---------- hit testing ---------- */
  function pointInRect(pt, r, pad) {
    const p = pad || 0;
    return pt.x >= r.x - p && pt.x <= r.x + r.w + p && pt.y >= r.y - p && pt.y <= r.y + r.h + p;
  }
  function annBBox(a) {
    if (a.type === 'highlight') {
      if (!a.rects.length) return null;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      a.rects.forEach(r => {
        x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
        x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
      });
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    if (a.type === 'whiteout' || a.type === 'redact') {
      return { x: a.rect.x, y: a.rect.y, w: a.rect.w, h: a.rect.h };
    }
    if (a.type === 'draw') {
      if (!a.points.length) return null;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      a.points.forEach(pt => {
        x1 = Math.min(x1, pt.x); y1 = Math.min(y1, pt.y);
        x2 = Math.max(x2, pt.x); y2 = Math.max(y2, pt.y);
      });
      const pad = a.width / 2;
      return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    }
    if (a.type === 'text' || a.type === 'image') {
      const el = state.annEls.get(a.id);
      const page = state.pages[a.page];
      let h = a.h;
      if (a.type === 'text' && el && page && page.scale) h = el.offsetHeight / page.scale;
      return { x: a.x, y: a.y, w: a.w, h: h || (a.type === 'text' ? (a.size || 16) * 1.4 : 20) };
    }
    return null;
  }
  function segmentDistance(pt, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return Math.hypot(pt.x - a.x, pt.y - a.y);
    const t = clamp(((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
  }
  function strokeHit(a, pt, tol) {
    const limit = a.width / 2 + tol;
    if (a.points.length === 1) return Math.hypot(pt.x - a.points[0].x, pt.y - a.points[0].y) <= limit;
    for (let i = 1; i < a.points.length; i++) {
      if (segmentDistance(pt, a.points[i - 1], a.points[i]) <= limit) return true;
    }
    return false;
  }
  function hitsAnnotation(a, pt, scale) {
    if (!a) return false;
    if (a.type === 'highlight') return a.rects.some(r => pointInRect(pt, r, 1 / scale));
    if (a.type === 'whiteout' || a.type === 'redact') return pointInRect(pt, a.rect, 1 / scale);
    if (a.type === 'draw') return strokeHit(a, pt, 6 / Math.max(scale, 0.2));
    if (a.type === 'text' || a.type === 'image') {
      const bb = annBBox(a);
      return bb ? pointInRect(pt, bb, 2 / Math.max(scale, 0.2)) : false;
    }
    return false;
  }
  function hitCanvasAnn(p, pt) {
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      const a = state.annotations[i];
      if (a.page !== p.index || CANVAS_MARKS.indexOf(a.type) === -1) continue;
      if (hitsAnnotation(a, pt, p.scale)) return a;
    }
    return null;
  }
  function hitAnyAnn(p, pt) {
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      const a = state.annotations[i];
      if (a.page !== p.index) continue;
      if (hitsAnnotation(a, pt, p.scale)) return a;
    }
    return null;
  }

  /* ---------- history ---------- */
  function snapshot() { return JSON.stringify(state.annotations); }
  function resetHistory() {
    state.past = [snapshot()];
    state.future = [];
    updateHistoryButtons();
  }
  function commit() {
    const snap = snapshot();
    if (state.past.length && state.past[state.past.length - 1] === snap) {
      updateHistoryButtons();
      updateCount();
      updateActions();
      return;
    }
    state.past.push(snap);
    if (state.past.length > 60) state.past.shift();
    state.future = [];
    updateHistoryButtons();
    updateCount();
    updateActions();
  }
  function updateHistoryButtons() {
    if (!els.undoBtn) return;
    els.undoBtn.disabled = state.past.length <= 1;
    els.redoBtn.disabled = state.future.length === 0;
    els.deleteBtn.disabled = !state.selected;
  }
  function undo() {
    if (state.past.length <= 1) return;
    exitTextEdit();
    selectAnn(null);
    state.future.push(state.past.pop());
    state.annotations = JSON.parse(state.past[state.past.length - 1]);
    afterHistoryJump();
  }
  function redo() {
    if (!state.future.length) return;
    exitTextEdit();
    selectAnn(null);
    state.past.push(state.future.pop());
    state.annotations = JSON.parse(state.past[state.past.length - 1]);
    afterHistoryJump();
  }
  function afterHistoryJump() {
    exitTextEdit();
    selectAnn(null);
    renderAllAnnotationDom();
    renderAllOverlays();
    updateHistoryButtons();
    updateCount();
    updateActions();
  }

  /* ---------- selection ---------- */
  function annById(id) {
    return state.annotations.find(a => a.id === id) || null;
  }
  function syncTextControls(a) {
    state.textDefaults.size = a.size;
    state.textDefaults.color = a.color;
    state.textDefaults.font = a.font;
    els.fontSize.value = a.size;
    els.fontSizeVal.textContent = a.size + ' pt';
    fillRange(els.fontSize);
    els.textFont.value = a.font;
    els.textColor.value = validHex(a.color) || '#111827';
    syncSwatches('text', a.color);
  }
  function selectAnn(id) {
    if (id && !annById(id)) id = null;
    state.selected = id;
    state.annEls.forEach((el, key) => el.classList.toggle('selected', key === id));
    const a = id ? annById(id) : null;
    if (a && a.type === 'text') syncTextControls(a);
    updateHistoryButtons();
    updateActions();
    renderAllOverlays();
  }

  /* ---------- annotation DOM ---------- */
  function applyTextStyle(a, el) {
    if (!el || !a || a.type !== 'text') return;
    const key = effectiveFontKey(a);
    el.style.fontFamily = FONT_STACKS[key] || FONT_STACKS.Helvetica;
    el.style.fontWeight = isBoldFontKey(key) ? '700' : '400';
    el.style.direction = isRtlText(a.text || '') ? 'rtl' : 'ltr';
  }
  function positionAnnEl(a) {
    const el = state.annEls.get(a.id);
    const p = state.pages[a.page];
    if (!el || !p || !p.scale) return;
    const s = p.scale;
    el.style.left = (a.x * s).toFixed(2) + 'px';
    el.style.top = (a.y * s).toFixed(2) + 'px';
    if (a.type === 'text') {
      el.style.width = (a.w * s).toFixed(2) + 'px';
      el.style.fontSize = (a.size * s).toFixed(2) + 'px';
      el.style.lineHeight = '1.32';
      el.style.color = a.color;
      applyTextStyle(a, el);
    } else if (a.type === 'image') {
      el.style.width = (a.w * s).toFixed(2) + 'px';
      el.style.height = ((a.h || a.w) * s).toFixed(2) + 'px';
    }
  }
  function repositionAllAnnotations() {
    state.annotations.forEach(a => positionAnnEl(a));
  }
  function readText(el) {
    const raw = (el && (el.innerText || el.textContent)) || '';
    return raw.replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n');
  }
  function updateAnnEl(a) {
    positionAnnEl(a);
    if (a.type === 'text') {
      const el = state.annEls.get(a.id);
      if (el && el.contentEditable !== 'true') {
        el.textContent = a.text || '';
        el.classList.toggle('is-empty', !String(a.text || '').trim());
      }
    }
  }
  function makeTextEl(a) {
    const el = document.createElement('div');
    el.className = 'ann-text' + (!String(a.text || '').trim() ? ' is-empty' : '') + (a.source === 'existing' ? ' is-existing' : '');
    el.dataset.id = a.id;
    el.contentEditable = 'false';
    el.spellcheck = false;
    el.textContent = a.text || '';
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', 'Text annotation');
    el.addEventListener('input', () => {
      a.text = readText(el);
      el.classList.toggle('is-empty', !a.text.trim() && !el.textContent.trim());
      applyTextStyle(a, el);
      if (a.source === 'existing') resizeExistingTextEdit(a, el);
      updateCount();
    });
    el.addEventListener('blur', () => onTextBlur(a, el));
    el.addEventListener('pointerdown', ev => onTextPointerDown(ev, a));
    el.addEventListener('dblclick', ev => { ev.preventDefault(); enterTextEdit(a, el); });
    el.addEventListener('keydown', ev => {
      if (a.source === 'existing' && ev.key === 'Enter') ev.preventDefault();
    });
    el.addEventListener('paste', ev => {
      ev.preventDefault();
      let text = (ev.clipboardData || window.clipboardData).getData('text/plain');
      if (a.source === 'existing') text = String(text).replace(/\s*\n+\s*/g, ' ');
      try { document.execCommand('insertText', false, text); } catch (e) {}
    });
    return el;
  }
  function makeImageEl(a) {
    const el = document.createElement('div');
    el.className = 'ann-image';
    el.dataset.id = a.id;
    const img = document.createElement('img');
    img.src = a.dataUrl;
    img.alt = 'Image annotation';
    img.draggable = false;
    const handle = document.createElement('span');
    handle.className = 'img-resize';
    handle.setAttribute('aria-hidden', 'true');
    el.append(img, handle);
    el.addEventListener('pointerdown', ev => onImagePointerDown(ev, a));
    handle.addEventListener('pointerdown', ev => onImageResizeStart(ev, a));
    return el;
  }
  function renderAnnotationElement(a) {
    const p = state.pages[a.page];
    if (!p) return null;
    let el = null;
    if (a.type === 'text') el = makeTextEl(a);
    else if (a.type === 'image') el = makeImageEl(a);
    if (!el) return null;
    p.dom.appendChild(el);
    state.annEls.set(a.id, el);
    positionAnnEl(a);
    return el;
  }
  function renderAllAnnotationDom() {
    state.annEls.clear();
    state.pages.forEach(p => { p.dom.innerHTML = ''; });
    state.annotations.forEach(a => {
      if (a.type === 'text' || a.type === 'image') renderAnnotationElement(a);
    });
  }

  /* ---------- text editing ---------- */
  function enterTextEdit(a, el) {
    if (!el || !el.isConnected) el = state.annEls.get(a.id);
    if (!el) return;
    selectAnn(a.id);
    el.contentEditable = 'true';
    el.classList.add('is-editing');
    el.classList.toggle('is-empty', !String(a.text || '').trim());
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    placeCaretAtEnd(el);
    /* Existing lines are already under the pointer. Scrolling them into view
       would move the page away from the click, so only new text boxes scroll. */
    if (window.innerWidth < 900 && a.source !== 'existing') {
      setTimeout(() => {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      }, 280);
    }
  }
  function exitTextEdit() {
    $$('.ann-text.is-editing').forEach(el => {
      el.classList.remove('is-editing');
      el.contentEditable = 'false';
    });
  }
  function finalizeTextEdits() {
    let changed = false;
    state.annEls.forEach((el, id) => {
      if (!el.classList.contains('ann-text')) return;
      const a = annById(id);
      if (!a) return;
      if (el.contentEditable === 'true' || el.classList.contains('is-editing')) {
        a.text = readText(el);
        el.classList.remove('is-editing');
        el.contentEditable = 'false';
        if (!a.text.trim()) {
          state.annotations = state.annotations.filter(x => x.id !== id);
          state.annEls.delete(id);
          el.remove();
          if (state.selected === id) state.selected = null;
          changed = true;
        } else {
          el.classList.toggle('is-empty', false);
          changed = true;
        }
      }
    });
    if (changed) {
      updateCount();
      updateActions();
      commit();
    }
  }
  function placeCaretAtEnd(el) {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }
  function onTextBlur(a, el) {
    if (!el.isConnected || !annById(a.id)) return;
    el.classList.remove('is-editing');
    el.contentEditable = 'false';
    a.text = readText(el);
    if (!a.text.trim()) {
      state.annotations = state.annotations.filter(x => x.id !== a.id);
      state.annEls.delete(a.id);
      el.remove();
      if (state.selected === a.id) state.selected = null;
      updateCount();
      updateActions();
      commit();
      return;
    }
    el.classList.toggle('is-empty', false);
    commit();
  }

  /* ---------- shared pointer drag engine ---------- */
  function beginWindowDrag(pointerId, onMove, onEnd) {
    state.dragging = true;
    document.body.classList.add('is-dragging');
    let finished = false;
    const move = ev => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) { try { ev.preventDefault(); } catch (e) {} }
      onMove(ev);
    };
    const end = ev => { if (ev.pointerId === pointerId) finish(ev, false); };
    const cancel = ev => { if (ev.pointerId === pointerId) finish(ev, true); };
    const lockTouch = ev => { if (state.dragging && ev.cancelable) ev.preventDefault(); };
    const blurCancel = () => finish(null, true);
    function finish(ev, cancelled) {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blurCancel);
      document.removeEventListener('touchmove', lockTouch);
      state.dragging = false;
      document.body.classList.remove('is-dragging');
      onEnd(ev, cancelled);
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blurCancel);
    document.addEventListener('touchmove', lockTouch, { passive: false });
  }

  /* ---------- text + image dragging ---------- */
  function onTextPointerDown(ev, a) {
    const el = ev.currentTarget;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (state.tool === 'text' || state.tool === 'edittext') {
      ev.stopPropagation();
      ev.preventDefault();
      enterTextEdit(a, el);
      return;
    }
    if (state.tool !== 'select') return;
    ev.stopPropagation();
    if (el.contentEditable === 'true') return;
    const wasSelected = state.selected === a.id;
    selectAnn(a.id);
    ev.preventDefault();
    const p = state.pages[a.page];
    if (!p) return;
    const sx = ev.clientX, sy = ev.clientY, ox = a.x, oy = a.y;
    const pid = ev.pointerId;
    let moved = false;
    try { el.setPointerCapture(pid); } catch (e) {}
    beginWindowDrag(pid, e2 => {
      const dx = (e2.clientX - sx) / p.scale;
      const dy = (e2.clientY - sy) / p.scale;
      if (!moved && (Math.abs(e2.clientX - sx) > 3 || Math.abs(e2.clientY - sy) > 3)) moved = true;
      if (!moved) return;
      a.x = clamp(ox + dx, -a.w * 0.45, p.vp1.width - a.w * 0.45);
      a.y = clamp(oy + dy, -8, p.vp1.height - 10);
      positionAnnEl(a);
    }, (e2, cancelled) => {
      try { el.releasePointerCapture(pid); } catch (e) {}
      if (moved) commit();
      else if (!cancelled && wasSelected) enterTextEdit(a, el);
    });
  }
  function onImagePointerDown(ev, a) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (state.tool !== 'select') return;
    ev.stopPropagation();
    ev.preventDefault();
    selectAnn(a.id);
    const el = ev.currentTarget;
    const p = state.pages[a.page];
    if (!p) return;
    const sx = ev.clientX, sy = ev.clientY, ox = a.x, oy = a.y;
    const pid = ev.pointerId;
    let moved = false;
    try { el.setPointerCapture(pid); } catch (e) {}
    beginWindowDrag(pid, e2 => {
      const dx = (e2.clientX - sx) / p.scale;
      const dy = (e2.clientY - sy) / p.scale;
      if (!moved && (Math.abs(e2.clientX - sx) > 3 || Math.abs(e2.clientY - sy) > 3)) moved = true;
      if (!moved) return;
      a.x = clamp(ox + dx, -a.w * 0.4, p.vp1.width - a.w * 0.6);
      a.y = clamp(oy + dy, -a.h * 0.4, p.vp1.height - a.h * 0.6);
      positionAnnEl(a);
    }, () => {
      try { el.releasePointerCapture(pid); } catch (e) {}
      if (moved) commit();
    });
  }
  function onImageResizeStart(ev, a) {
    if (state.tool !== 'select') return;
    ev.stopPropagation();
    ev.preventDefault();
    selectAnn(a.id);
    const handle = ev.currentTarget;
    const p = state.pages[a.page];
    if (!p) return;
    const sx = ev.clientX, sy = ev.clientY, ow = a.w, oh = a.h;
    const ratio = ow / Math.max(1, oh);
    const pid = ev.pointerId;
    let changed = false;
    try { handle.setPointerCapture(pid); } catch (e) {}
    beginWindowDrag(pid, e2 => {
      const dx = (e2.clientX - sx) / p.scale;
      const dy = (e2.clientY - sy) / p.scale;
      let w = clamp(ow + Math.max(dx, dy * ratio), 24, p.vp1.width - a.x);
      let h = w / ratio;
      if (h > p.vp1.height - a.y) { h = p.vp1.height - a.y; w = h * ratio; }
      if (w < 24 || h < 12) return;
      a.w = w;
      a.h = h;
      changed = true;
      positionAnnEl(a);
    }, () => {
      try { handle.releasePointerCapture(pid); } catch (e) {}
      if (changed) commit();
    });
  }

  /* ---------- create / remove ---------- */
  function addTextAt(p, pt) {
    const w = Math.min(p.vp1.width * 0.55, 340);
    const a = {
      id: uid(), type: 'text', page: p.index,
      x: clamp(pt.x, 4, Math.max(4, p.vp1.width - w - 4)),
      y: clamp(pt.y, 4, Math.max(4, p.vp1.height - 24)),
      w,
      text: '',
      size: state.textDefaults.size,
      color: state.textDefaults.color,
      font: state.textDefaults.font
    };
    state.annotations.push(a);
    const el = renderAnnotationElement(a);
    updateCount();
    updateActions();
    selectAnn(a.id);
    if (el) enterTextEdit(a, el);
    return a;
  }
  function addTextEditAt(p, line) {
    const font = line.font || mapDetectedFont(line.fontMeta || line.fontFamily, line.fontName);
    const size = clamp(Number(line.size) || 12, 4, 200);
    const colors = sampleLineColors(p, line);
    const maxW = Math.max(24, p.vp1.width - line.x);
    const a = {
      id: uid(), type: 'text', page: p.index,
      x: clamp(line.x, 0, p.vp1.width),
      y: clamp(line.y, 0, p.vp1.height),
      w: clamp(line.w + Math.max(16, size * 1.5), 24, maxW),
      text: line.text,
      size,
      color: colors.text,
      font,
      source: 'existing',
      sourceText: line.text,
      baseW: line.w,
      cover: {
        x: line.x - 1, y: line.y - 1, w: line.w + 2, h: line.h + 2,
        color: colors.background
      }
    };
    state.annotations.push(a);
    const el = renderAnnotationElement(a);
    updateCount();
    updateActions();
    selectAnn(a.id);
    if (el) enterTextEdit(a, el);
    return a;
  }
  async function startTextEditAt(p, pt) {
    const line = await findTextLineAt(p, pt);
    if (state.tool !== 'edittext' || state.pages[p.index] !== p) return;
    if (!line) {
      toast('No selectable text there. Try another spot.');
      return;
    }
    addTextEditAt(p, line);
  }
  function addImageAt(p, asset, pt) {
    const maxW = p.vp1.width * 0.45;
    const maxH = p.vp1.height * 0.3;
    let w = maxW;
    let h = w * (asset.h / asset.w);
    if (h > maxH) { h = maxH; w = h * (asset.w / asset.h); }
    const a = {
      id: uid(), type: 'image', page: p.index,
      x: clamp(pt.x - w / 2, 0, Math.max(0, p.vp1.width - w)),
      y: clamp(pt.y - h / 2, 0, Math.max(0, p.vp1.height - h)),
      w, h, dataUrl: asset.dataUrl
    };
    state.annotations.push(a);
    renderAnnotationElement(a);
    updateCount();
    selectAnn(a.id);
    commit();
    return a;
  }
  function removeAnnotation(id, silent) {
    const a = annById(id);
    if (!a) return;
    const el = state.annEls.get(id);
    if (el) {
      el.contentEditable = 'false';
      el.classList.remove('is-editing', 'selected');
      el.remove();
      state.annEls.delete(id);
    }
    state.annotations = state.annotations.filter(x => x.id !== id);
    if (state.selected === id) state.selected = null;
    const p = state.pages[a.page];
    if (p) drawPageOverlay(p);
    updateCount();
    updateActions();
    if (!silent) commit();
  }
  function deleteSelected() {
    if (!state.selected) return;
    exitTextEdit();
    const id = state.selected;
    removeAnnotation(id);
    toast('Mark deleted. Undo restores it.');
  }
  function clearActivePage() {
    if (!state.pages.length) return;
    const idx = state.activePage;
    const count = state.annotations.filter(a => a.page === idx).length;
    if (!count) { toast('There are no marks on this page.'); return; }
    if (!window.confirm('Remove all ' + count + ' mark(s) from page ' + (idx + 1) + '?')) return;
    exitTextEdit();
    selectAnn(null);
    state.annotations = state.annotations.filter(a => a.page !== idx);
    renderAllAnnotationDom();
    renderAllOverlays();
    updateCount();
    commit();
  }

  /* ---------- canvas pointer tools ---------- */
  function attachPageEvents(p) {
    p.ov.addEventListener('pointerdown', ev => onPagePointerDown(ev, p));
    p.ov.addEventListener('contextmenu', ev => ev.preventDefault());
    p.dom.addEventListener('contextmenu', ev => ev.preventDefault());
  }
  function capturePointer(el, pointerId) {
    try { el.setPointerCapture(pointerId); } catch (e) {}
  }
  function releasePointer(el, pointerId) {
    try { el.releasePointerCapture(pointerId); } catch (e) {}
  }
  function onPagePointerDown(ev, p) {
    if (!state.doc || !p.scale) return;
    if (ev.isPrimary === false) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const tool = state.tool;
    const pt = canvasPoint(p, ev);
    const pid = ev.pointerId;

    if (tool === 'select') {
      const hit = hitCanvasAnn(p, pt);
      selectAnn(hit ? hit.id : null);
      return;
    }

    if (tool === 'text') {
      ev.preventDefault();
      finalizeTextEdits();
      addTextAt(p, pt);
      return;
    }

    if (tool === 'edittext') {
      ev.preventDefault();
      finalizeTextEdits();
      startTextEditAt(p, pt);
      return;
    }

    if (tool === 'erase') {
      ev.preventDefault();
      exitTextEdit();
      capturePointer(p.ov, pid);
      state.eraseCount = 0;
      eraseAt(p, pt, true);
      beginWindowDrag(pid, e2 => {
        eraseAt(p, canvasPoint(p, e2), true);
      }, (e2, cancelled) => {
        releasePointer(p.ov, pid);
        if (!cancelled && state.eraseCount > 0) {
          commit();
          toast(state.eraseCount === 1 ? 'Mark erased. Undo restores it.' : state.eraseCount + ' marks erased. Undo restores them.');
        }
        state.eraseCount = 0;
      });
      return;
    }

    if (tool === 'highlight' || tool === 'whiteout' || tool === 'redact') {
      ev.preventDefault();
      exitTextEdit();
      capturePointer(p.ov, pid);
      state.previewRect = { page: p.index, kind: tool, x: pt.x, y: pt.y, w: 0, h: 0 };
      drawPageOverlay(p);
      beginWindowDrag(pid, e2 => {
        const next = canvasPoint(p, e2);
        state.previewRect = { page: p.index, kind: tool, ...normRect(pt, next) };
        drawPageOverlay(p);
      }, (e2, cancelled) => {
        releasePointer(p.ov, pid);
        const r = state.previewRect ? { ...state.previewRect } : null;
        state.previewRect = null;
        drawPageOverlay(p);
        if (cancelled || !r) return;
        const wide = r.w * p.scale > 2;
        const tall = r.h * p.scale > 2;
        if (!wide || !tall) return;
        if (tool === 'whiteout') {
          state.annotations.push({ id: uid(), type: 'whiteout', page: p.index, rect: normRect(r, { x: r.x + r.w, y: r.y + r.h }) });
          commit();
          drawPageOverlay(p);
          toast('Whiteout added — it becomes solid white in the exported PDF.');
        } else if (tool === 'redact') {
          state.annotations.push({
            id: uid(), type: 'redact', page: p.index,
            rect: normRect(r, { x: r.x + r.w, y: r.y + r.h }),
            color: state.redactDefaults.color
          });
          commit();
          drawPageOverlay(p);
          toast('Redaction added — the area is removed from the PDF on export.');
        } else {
          finishHighlight(p, r);
        }
      });
      return;
    }

    if (tool === 'draw') {
      ev.preventDefault();
      exitTextEdit();
      capturePointer(p.ov, pid);
      const points = [pt];
      const color = state.drawDefaults.color;
      const width = state.drawDefaults.width;
      const ctx = p.ov.getContext('2d');
      ctx.setTransform(p.raster * p.scale, 0, 0, p.raster * p.scale, 0, 0);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(width / 2, 0.4), 0, Math.PI * 2);
      ctx.fill();
      beginWindowDrag(pid, e2 => {
        const next = canvasPoint(p, e2);
        const last = points[points.length - 1];
        if (Math.hypot(next.x - last.x, next.y - last.y) * p.scale < 1.1) return;
        points.push(next);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }, (e2, cancelled) => {
        releasePointer(p.ov, pid);
        if (!cancelled && points.length) {
          state.annotations.push({ id: uid(), type: 'draw', page: p.index, points, color, width });
          commit();
        }
        drawPageOverlay(p);
      });
    }
  }
  function normRect(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y)
    };
  }
  function eraseAt(p, pt, silent) {
    const found = hitAnyAnn(p, pt);
    if (!found) return false;
    removeAnnotation(found.id, true);
    state.eraseCount = (state.eraseCount || 0) + 1;
    return true;
  }

  /* ---------- text detection ---------- */
  async function extractTextData(p) {
    const content = await p.page.getTextContent();
    const vp = p.vp1;
    const util = window.pdfjsLib.Util;
    const styles = content.styles || {};
    const items = [];
    content.items.forEach(item => {
      if (!item || !item.transform) return;
      const str = String(item.str || '');
      if (!str.trim()) return;
      const tx = util.transform(vp.transform, item.transform);
      const size = Math.hypot(tx[2], tx[3]);
      const w = item.width * vp.scale;
      const x = tx[4];
      const baseline = tx[5];
      const y = baseline - size;
      if (!(w > 0.5) || !(size > 0.5)) return;
      if (x < -20 || y < -20 || x > vp.width + 20 || y > vp.height + 20) return;
      const style = styles[item.fontName] || {};
      let fontObj = null;
      try {
        fontObj = p.page.commonObjs && typeof p.page.commonObjs.get === 'function'
          ? p.page.commonObjs.get(item.fontName)
          : null;
      } catch (e) {}
      const fontMeta = {
        family: style.fontFamily || (fontObj && fontObj.fallbackName) || '',
        fallback: (fontObj && fontObj.fallbackName) || '',
        name: (fontObj && (fontObj.name || fontObj.loadedName)) || item.fontName || '',
        bold: !!(fontObj && (fontObj.bold || fontObj.black)),
        italic: !!(fontObj && fontObj.italic)
      };
      items.push({
        str,
        dir: item.dir || 'ltr',
        x, y, w, h: size,
        baseline,
        size,
        fontName: item.fontName || '',
        fontFamily: fontMeta.family,
        fontMeta
      });
    });
    return { items, lines: groupTextLines(items) };
  }
  function groupTextLines(items) {
    const sorted = items.slice().sort((a, b) => (a.baseline - b.baseline) || (a.x - b.x));
    const groups = [];
    sorted.forEach(item => {
      if (String(item.dir).toLowerCase() !== 'ltr') return;
      const key = Math.round(item.baseline / 4) + '|' + item.dir;
      let line = null;
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i];
        if (g.key !== key) continue;
        const gap = item.x - g.right;
        if (gap <= Math.max(14, Math.min(g.size, item.size) * 1.1)) { line = g; break; }
      }
      if (!line) {
        line = {
          key, dir: item.dir,
          x: item.x, y: item.y, right: item.x + item.w, bottom: item.y + item.h,
          baseline: item.baseline, size: item.size,
          fontName: item.fontName, fontFamily: item.fontFamily,
          fontMeta: item.fontMeta, fontVotes: new Map(),
          text: ''
        };
        groups.push(line);
      }
      const fontKey = mapDetectedFont(item.fontMeta, item.fontName);
      line.fontVotes.set(fontKey, (line.fontVotes.get(fontKey) || 0) + Math.max(1, item.w));
      const gap = item.x - line.right;
      if (gap > Math.max(1.5, Math.min(line.size, item.size) * 0.18)) line.text += ' ';
      line.text += item.str;
      line.x = Math.min(line.x, item.x);
      line.y = Math.min(line.y, item.y);
      line.right = Math.max(line.right, item.x + item.w);
      line.bottom = Math.max(line.bottom, item.y + item.h);
      line.baseline = Math.max(line.baseline, item.baseline);
    });
    return groups.map(g => {
      const text = String(g.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      let font = mapDetectedFont(g.fontMeta, g.fontName);
      let bestWeight = -1;
      g.fontVotes.forEach((weight, key) => {
        if (weight > bestWeight) { bestWeight = weight; font = key; }
      });
      return {
        text, dir: g.dir,
        x: g.x, y: g.y, w: g.right - g.x, h: g.bottom - g.y,
        baseline: g.baseline, size: g.size,
        fontName: g.fontName, fontFamily: g.fontFamily,
        fontMeta: g.fontMeta, font
      };
    }).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x);
  }
  function ensureTextData(p) {
    if (!p.textDataPromise) {
      p.textDataPromise = extractTextData(p).catch(err => {
        console.warn('[pdf] text extraction failed', err);
        return { items: [], lines: [] };
      });
    }
    return p.textDataPromise;
  }
  async function ensureTextRects(p) {
    if (p.textRects) return p.textRects;
    const data = await ensureTextData(p);
    p.textRects = data.items.map(i => ({ x: i.x, y: i.y, w: i.w, h: i.h }));
    return p.textRects;
  }
  async function ensureTextLines(p) {
    if (p.textLines) return p.textLines;
    const data = await ensureTextData(p);
    p.textLines = data.lines;
    return p.textLines;
  }
  async function findTextLineAt(p, pt) {
    const lines = await ensureTextLines(p);
    if (!lines || !lines.length) return null;
    const pad = Math.max(2, 4 / Math.max(p.scale, 0.2));
    for (let i = lines.length - 1; i >= 0; i--) {
      if (pointInRect(pt, lines[i], pad)) return lines[i];
    }
    return null;
  }

  /* ---------- highlight snapping ---------- */
  function mergeLineRects(items) {
    const map = new Map();
    items.forEach(r => {
      const key = Math.round(r.y / 3);
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { x: r.x, y: r.y, w: r.w, h: r.h });
        return;
      }
      const x1 = Math.min(cur.x, r.x);
      const y1 = Math.min(cur.y, r.y);
      const x2 = Math.max(cur.x + cur.w, r.x + r.w);
      const y2 = Math.max(cur.y + cur.h, r.y + r.h);
      map.set(key, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    });
    return Array.from(map.values()).sort((a, b) => a.y - b.y);
  }
  async function finishHighlight(p, rect) {
    let rects = [normRect(rect, { x: rect.x + rect.w, y: rect.y + rect.h })];
    if (state.highlightDefaults.snap && p.rotation === 0) {
      const all = await ensureTextRects(p);
      if (all && all.length) {
        const hits = all.filter(r => {
          const overlapX = r.x + r.w > rect.x && r.x < rect.x + rect.w;
          const overlapY = r.y + r.h > rect.y && r.y < rect.y + rect.h;
          const centerY = r.y + r.h / 2;
          return overlapX && overlapY && centerY >= rect.y - 4 && centerY <= rect.y + rect.h + 4;
        });
        if (hits.length) {
          /* Align vertically to the detected text line, but keep the
             horizontal span the user actually dragged over. */
          rects = mergeLineRects(hits).map(r => {
            const x1 = Math.max(r.x - 1, rect.x);
            const x2 = Math.min(r.x + r.w + 1, rect.x + rect.w);
            return {
              x: clamp(x1, 0, p.vp1.width),
              y: clamp(r.y - 0.5, 0, p.vp1.height),
              w: Math.max(1, x2 - x1),
              h: r.h + 1
            };
          });
        }
      }
    }
    const clean = rects.filter(r => r.w > 1 && r.h > 1);
    if (!clean.length) { drawPageOverlay(p); return; }
    state.annotations.push({
      id: uid(), type: 'highlight', page: p.index,
      color: state.highlightDefaults.color,
      rects: clean
    });
    commit();
    drawPageOverlay(p);
  }

  /* ---------- image upload ---------- */
  async function handleImageFile(file) {
    if (!file) return;
    if (!state.doc) { toast('Open a PDF first, then add an image.', 'error'); return; }
    if (!file.type || !file.type.startsWith('image/')) {
      toast('Choose an image file (PNG, JPG, GIF, WebP or SVG).', 'error');
      return;
    }
    showLoading('Preparing your image…', 45);
    try {
      const url = URL.createObjectURL(file);
      let img;
      try { img = await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('That image could not be read.');
      const MAX = 1800;
      if (Math.max(w, h) > MAX) {
        const f = MAX / Math.max(w, h);
        w = Math.round(w * f);
        h = Math.round(h * f);
      }
      const c = document.createElement('canvas');
      c.width = Math.max(1, w);
      c.height = Math.max(1, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const asset = { dataUrl: c.toDataURL('image/png'), w, h };
      hideLoading();
      const p = state.pages[state.activePage] || state.pages[0];
      if (!p) { toast('Open a PDF first, then add your image.', 'error'); return; }
      addImageAt(p, asset, { x: p.vp1.width / 2, y: p.vp1.height / 2 });
      setTool('select');
      toast('Image added to page ' + p.num + ' — drag it into place.');
    } catch (err) {
      hideLoading();
      toast(err.message || 'That image could not be loaded.', 'error');
    }
  }

  /* ---------- export ---------- */
  function setExportBusy(busy) {
    setBusy(busy);
  }
  function safeFontWidth(font, text, size) {
    try { return font.widthOfTextAtSize(text, size); } catch (e) { return String(text).length * size * 0.55; }
  }
  function wrapPdfText(text, font, size, maxWidth) {
    const out = [];
    const paragraphs = String(text).replace(/\r/g, '').split('\n');
    paragraphs.forEach(para => {
      if (!para.trim()) { out.push(''); return; }
      let line = '';
      para.split(/\s+/).forEach(word => {
        if (!word) return;
        const test = line ? line + ' ' + word : word;
        if (safeFontWidth(font, test, size) <= maxWidth) { line = test; return; }
        if (line) { out.push(line); line = ''; }
        if (safeFontWidth(font, word, size) <= maxWidth) { line = word; return; }
        let chunk = '';
        for (const ch of word) {
          if (chunk && safeFontWidth(font, chunk + ch, size) > maxWidth) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      });
      out.push(line);
    });
    return out;
  }
  function makeFontLoader(doc) {
    const PDFLib = window.PDFLib;
    const fontCache = new Map();
    return async name => {
      const key = isCustomFontKey(name) ? name : (PDF_FONTS[name] ? name : 'Helvetica');
      if (fontCache.has(key)) return fontCache.get(key);
      let font;
      if (isCustomFontKey(key)) {
        if (!window.fontkit) {
          throw new Error('Multilingual font support could not load. Check your connection and reload.');
        }
        if (!fontkitRegistered) {
          PDFLib.PDFDocument.prototype.registerFontkit(window.fontkit);
          fontkitRegistered = true;
        }
        const res = await fetch(CUSTOM_FONT_URLS[key]);
        if (!res.ok) throw new Error('Multilingual font could not be downloaded (' + res.status + ').');
        font = await doc.embedFont(new Uint8Array(await res.arrayBuffer()), { subset: true });
      } else {
        font = await doc.embedFont(PDFLib.StandardFonts[PDF_FONTS[key]]);
      }
      fontCache.set(key, font);
      return font;
    };
  }

  async function applyAnnotationsToDoc(doc, pages) {
    const getFont = makeFontLoader(doc);
    /* Mask replaced original text first so highlights and ink stay on top. */
    for (const a of state.annotations) {
      if (!a.cover) continue;
      const p = pages[a.page];
      const page = doc.getPage(a.page);
      if (p && page) drawTextCover(page, p, a.cover);
    }
    for (const a of state.annotations) {
      if (CANVAS_MARKS.indexOf(a.type) === -1 || a.type === 'redact') continue;
      const p = pages[a.page];
      const page = doc.getPage(a.page);
      if (!p || !page) continue;
      if (a.type === 'whiteout') drawWhiteoutAnnotation(page, p, a);
      else if (a.type === 'highlight') drawHighlightAnnotation(page, p, a);
      else if (a.type === 'draw') drawStrokeAnnotation(page, p, a);
    }
    for (const a of state.annotations) {
      if (a.type !== 'text' && a.type !== 'image') continue;
      const p = pages[a.page];
      const page = doc.getPage(a.page);
      if (!p || !page) continue;
      if (a.type === 'text') await drawTextAnnotation(doc, page, p, a, getFont);
      else await drawImageAnnotation(doc, page, p, a);
    }
  }

  async function renderPdfjsDoc(bytes) {
    if (!window.pdfjsLib) throw new Error('The PDF engine could not be loaded.');
    return window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  }

  async function renderPageImage(page, scale, maxPixels) {
    let s = scale;
    let vp = page.getViewport({ scale: s });
    if (maxPixels && vp.width * vp.height > maxPixels) {
      s *= Math.sqrt(maxPixels / (vp.width * vp.height));
      vp = page.getViewport({ scale: s });
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas, vp, scale: s };
  }

  /* True redaction: render each affected page, paint over the marked areas,
     and replace the original page with a flat image so hidden text is gone. */
  async function rasterizeRedactions(doc) {
    const byPage = new Map();
    state.annotations.forEach(a => {
      if (a.type !== 'redact') return;
      if (!byPage.has(a.page)) byPage.set(a.page, []);
      byPage.get(a.page).push(a);
    });
    if (!byPage.size) return;
    const intermediate = await doc.save();
    const pdfjsDoc = await renderPdfjsDoc(intermediate);
    try {
      const entries = Array.from(byPage.entries()).sort((a, b) => a[0] - b[0]);
      for (const [index, marks] of entries) {
        const jsPage = await pdfjsDoc.getPage(index + 1);
        const { canvas, vp, scale } = await renderPageImage(jsPage, 2, 9e6);
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.scale(scale, scale);
        marks.forEach(a => {
          ctx.globalAlpha = 1;
          ctx.fillStyle = a.color || '#000000';
          ctx.fillRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h);
        });
        ctx.restore();
        const img = await doc.embedPng(dataUrlToBytes(canvas.toDataURL('image/png')));
        const w = vp.width / scale;
        const h = vp.height / scale;
        const fresh = doc.addPage([w, h]);
        fresh.drawImage(img, { x: 0, y: 0, width: w, height: h });
        doc.removePage(doc.getPageCount() - 1);
        doc.removePage(index);
        doc.insertPage(index, fresh);
      }
    } finally {
      try { await pdfjsDoc.destroy(); } catch (e) {}
    }
  }

  async function prepareWorkingDoc() {
    if (!window.PDFLib) throw new Error('The PDF writer could not be loaded. Check your connection and reload.');
    if (!state.bytes) throw new Error('There is no PDF to work with.');
    finalizeTextEdits();
    const doc = await window.PDFLib.PDFDocument.load(state.bytes, { ignoreEncryption: true });
    await applyAnnotationsToDoc(doc, state.pages);
    await rasterizeRedactions(doc);
    return doc;
  }

  function outputBase() {
    return String(state.fileName || 'document.pdf')
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-') || 'document';
  }

  async function exportPdf() {
    if (!state.doc || !state.bytes || state.busy) return;
    if (!window.PDFLib) {
      toast('The PDF writer could not be loaded. Check your connection and reload.', 'error');
      return;
    }
    setExportBusy(true);
    try {
      const doc = await prepareWorkingDoc();
      const out = await doc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), outputBase() + '-annotated.pdf');
      toast('Done — your flattened PDF has been downloaded.');
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : 'Unknown error';
      toast('Export failed: ' + msg + '. Password-protected PDFs may not be exportable.', 'error');
    } finally {
      setExportBusy(false);
    }
  }
  function renderComplexTextImage(a, text, fontKey) {
    const scale = 4;
    const size = clamp(Number(a.size) || 16, 4, 200);
    const stack = FONT_STACKS[fontKey] || FONT_STACKS.Unicode;
    const weight = isBoldFontKey(fontKey) ? '700' : '400';
    const fontCss = weight + ' ' + Math.round(size * scale) + 'px ' + stack;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = fontCss;
    const metrics = measure.measureText(text);
    const pad = Math.ceil(4 * scale);
    const w = Math.max(1, Math.ceil(metrics.width) + pad * 2);
    const h = Math.max(1, Math.ceil(size * 1.6 * scale) + pad * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.font = fontCss;
    ctx.fillStyle = a.color || '#111827';
    ctx.textBaseline = 'alphabetic';
    const rtl = isRtlText(text);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillText(text, rtl ? w - pad : pad, pad + size * scale);
    const imgW = w / scale;
    const imgH = h / scale;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      x: rtl ? a.x + Math.max(0, (Number(a.w) || imgW) - imgW) : a.x - pad / scale,
      y: a.y - pad / scale,
      w: imgW,
      h: imgH
    };
  }
  async function drawComplexTextImage(doc, page, p, a, text, fontKey) {
    const img = renderComplexTextImage(a, text, fontKey);
    await drawImageAnnotation(doc, page, p, img);
  }
  async function drawTextAnnotation(doc, page, p, a, getFont) {
    const PDFLib = window.PDFLib;
    const fontKey = effectiveFontKey(a);
    const text = sanitizeForPdf(a.text, fontKey);
    if (!text.trim()) return;
    if (isComplexScript(text)) {
      await drawComplexTextImage(doc, page, p, a, text, fontKey);
      return;
    }
    const font = await getFont(fontKey);
    const size = clamp(Number(a.size) || 16, 4, 200);
    /* Existing lines must stay on one line in the exported PDF too. */
    const lines = a.source === 'existing' ? [text] : wrapPdfText(text, font, size, Math.max(12, a.w));
    const lineH = size * 1.32;
    const baseline = size * (BASELINE[fontKey] || 1);
    const rotate = PDFLib.degrees(p.rotation || 0);
    const c = hexToRgb(a.color);
    const color = PDFLib.rgb(c.r, c.g, c.b);
    lines.forEach((line, i) => {
      if (!line) return;
      const pt = p.vp1.convertToPdfPoint(a.x, a.y + baseline + i * lineH);
      page.drawText(line, { x: pt[0], y: pt[1], size, font, color, rotate, lineHeight: lineH });
    });
  }
  function drawHighlightAnnotation(page, p, a) {
    const PDFLib = window.PDFLib;
    const c = hexToRgb(a.color);
    const color = PDFLib.rgb(c.r, c.g, c.b);
    a.rects.forEach(r => {
      const c1 = p.vp1.convertToPdfPoint(r.x, r.y + r.h);
      const c2 = p.vp1.convertToPdfPoint(r.x + r.w, r.y);
      const x = Math.min(c1[0], c2[0]);
      const y = Math.min(c1[1], c2[1]);
      const width = Math.abs(c2[0] - c1[0]);
      const height = Math.abs(c2[1] - c1[1]);
      if (width < 0.4 || height < 0.4) return;
      page.drawRectangle({ x, y, width, height, color, opacity: state.prefs.highlightAlpha, borderWidth: 0 });
    });
  }
  function drawTextCover(page, p, rect) {
    drawWhiteoutAnnotation(page, p, { rect, color: rect.color });
  }
  function drawWhiteoutAnnotation(page, p, a) {
    const PDFLib = window.PDFLib;
    const r = a.rect;
    const c1 = p.vp1.convertToPdfPoint(r.x, r.y + r.h);
    const c2 = p.vp1.convertToPdfPoint(r.x + r.w, r.y);
    const x = Math.min(c1[0], c2[0]);
    const y = Math.min(c1[1], c2[1]);
    const width = Math.abs(c2[0] - c1[0]);
    const height = Math.abs(c2[1] - c1[1]);
    if (width < 0.4 || height < 0.4) return;
    const c = validHex(a.color) ? hexToRgb(a.color) : { r: 1, g: 1, b: 1 };
    page.drawRectangle({
      x, y, width, height,
      color: PDFLib.rgb(c.r, c.g, c.b),
      opacity: 1,
      borderWidth: 0
    });
  }
  function drawStrokeAnnotation(page, p, a) {
    const PDFLib = window.PDFLib;
    const c = hexToRgb(a.color);
    const color = PDFLib.rgb(c.r, c.g, c.b);
    const thickness = clamp(Number(a.width) || 3, 0.4, 80);
    if (a.points.length === 1) {
      const pt = p.vp1.convertToPdfPoint(a.points[0].x, a.points[0].y);
      page.drawCircle({ x: pt[0], y: pt[1], size: thickness / 2, color });
      return;
    }
    for (let i = 1; i < a.points.length; i++) {
      const s = p.vp1.convertToPdfPoint(a.points[i - 1].x, a.points[i - 1].y);
      const e = p.vp1.convertToPdfPoint(a.points[i].x, a.points[i].y);
      page.drawLine({
        start: { x: s[0], y: s[1] },
        end: { x: e[0], y: e[1] },
        thickness,
        color,
        lineCap: PDFLib.LineCapStyle ? PDFLib.LineCapStyle.Round : undefined
      });
    }
  }
  async function drawImageAnnotation(doc, page, p, a) {
    const PDFLib = window.PDFLib;
    const bytes = dataUrlToBytes(a.dataUrl);
    const img = await doc.embedPng(bytes);
    const corner = p.vp1.convertToPdfPoint(a.x, a.y + a.h);
    page.drawImage(img, {
      x: corner[0],
      y: corner[1],
      width: a.w,
      height: a.h,
      rotate: PDFLib.degrees(p.rotation || 0)
    });
  }

  /* ---------- thumbnails sheet ---------- */
  let sheetTimer = 0;
  let sheetReturnFocus = null;
  function openSheet() {
    if (!state.doc) return;
    clearTimeout(sheetTimer);
    sheetReturnFocus = document.activeElement;
    els.thumbsSheet.hidden = false;
    els.sheetBackdrop.hidden = false;
    document.body.classList.add('sheet-open');
    fillThumbnails(state.loadSeq);
    requestAnimationFrame(() => {
      els.thumbsSheet.classList.add('is-open');
      els.sheetBackdrop.classList.add('is-open');
    });
    try { els.closeThumbs.focus({ preventScroll: true }); } catch (e) {}
  }
  function closeSheet() {
    clearTimeout(sheetTimer);
    const wasOpen = !els.thumbsSheet.hidden;
    els.thumbsSheet.classList.remove('is-open');
    els.sheetBackdrop.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    if (!wasOpen) return;
    sheetTimer = setTimeout(() => {
      els.thumbsSheet.hidden = true;
      els.sheetBackdrop.hidden = true;
    }, 220);
    if (sheetReturnFocus && sheetReturnFocus.focus) {
      try { sheetReturnFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    sheetReturnFocus = null;
  }

  /* ---------- shared dialog helpers ---------- */
  function trapFocus(ev, container) {
    if (ev.key !== 'Tab' || !container) return;
    const focusables = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  async function withBusy(label, fn) {
    if (!state.doc || state.busy) return null;
    finalizeTextEdits();
    setBusy(true);
    showLoading(label, 6);
    try {
      const result = await fn(setProgress);
      if (result === false && !state.doc) {
        showEmptyError('No changes were made. Open a PDF to continue.');
      }
      return result;
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : 'That action could not be completed.', 'error');
      return null;
    } finally {
      setBusy(false);
      hideLoading();
    }
  }

  async function replaceWithDoc(doc, name, message) {
    const bytes = await doc.save();
    return replacePdf(bytes, name || state.fileName, message);
  }

  /* ---------- more tools sheet ---------- */
  let pageToolsTimer = 0;
  let pageToolsReturnFocus = null;
  let pageToolsBackdrop = null;

  function ensurePageToolsBackdrop() {
    if (pageToolsBackdrop) return pageToolsBackdrop;
    pageToolsBackdrop = document.createElement('div');
    pageToolsBackdrop.className = 'page-tools-backdrop';
    pageToolsBackdrop.hidden = true;
    /* Keep the backdrop inside the editor host so the sheet can stack above it. */
    (els.pageToolsSheet.parentNode || document.body).appendChild(pageToolsBackdrop);
    pageToolsBackdrop.addEventListener('click', closePageTools);
    return pageToolsBackdrop;
  }

  function openPageTools() {
    if (!state.doc || state.busy || !els.pageToolsSheet || !els.pageToolsSheet.hidden) return;
    clearTimeout(pageToolsTimer);
    pageToolsReturnFocus = document.activeElement;
    updatePageToolsUi();
    const backdrop = ensurePageToolsBackdrop();
    backdrop.hidden = false;
    els.pageToolsSheet.hidden = false;
    document.body.classList.add('page-tools-open');
    requestAnimationFrame(() => {
      els.pageToolsSheet.classList.add('is-open');
      backdrop.classList.add('is-open');
    });
    try { els.closePageTools.focus({ preventScroll: true }); } catch (e) {}
  }

  function closePageTools() {
    if (!els.pageToolsSheet || els.pageToolsSheet.hidden) return;
    clearTimeout(pageToolsTimer);
    const backdrop = ensurePageToolsBackdrop();
    els.pageToolsSheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('page-tools-open');
    pageToolsTimer = setTimeout(() => {
      els.pageToolsSheet.hidden = true;
      backdrop.hidden = true;
    }, 220);
    if (pageToolsReturnFocus && pageToolsReturnFocus.focus) {
      try { pageToolsReturnFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    pageToolsReturnFocus = null;
  }

  /* ---------- signature pad ---------- */
  let sigTimer = 0;
  let sigReturnFocus = null;
  let sigFileInput = null;

  function initSigCanvas() {
    const c = els.sigCanvas;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(Math.max(1, rect.width) * dpr));
    c.height = Math.max(1, Math.round(Math.max(1, rect.height) * dpr));
    state.sigPad.dpr = c.width / Math.max(1, rect.width);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.sigPad.hasMarks = false;
  }

  function sigPoint(ev) {
    const c = els.sigCanvas;
    const r = c.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (c.width / Math.max(1, r.width)),
      y: (ev.clientY - r.top) * (c.height / Math.max(1, r.height))
    };
  }

  function openSigModal() {
    if (!state.doc) { toast('Open a PDF first, then add a signature.', 'error'); return; }
    if (!els.sigModal || !els.sigModal.hidden) return;
    finalizeTextEdits();
    clearTimeout(sigTimer);
    sigReturnFocus = document.activeElement;
    els.sigBackdrop.hidden = false;
    els.sigModal.hidden = false;
    document.body.classList.add('sig-open');
    requestAnimationFrame(() => {
      els.sigModal.classList.add('is-open');
      els.sigBackdrop.classList.add('is-open');
      initSigCanvas();
    });
    try { els.sigSize.focus({ preventScroll: true }); } catch (e) {}
  }

  function closeSigModal() {
    if (!els.sigModal || els.sigModal.hidden) return;
    clearTimeout(sigTimer);
    els.sigModal.classList.remove('is-open');
    els.sigBackdrop.classList.remove('is-open');
    document.body.classList.remove('sig-open');
    sigTimer = setTimeout(() => {
      els.sigModal.hidden = true;
      els.sigBackdrop.hidden = true;
    }, 220);
    if (sigReturnFocus && sigReturnFocus.focus) {
      try { sigReturnFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    sigReturnFocus = null;
  }

  function onSigPointerDown(ev) {
    if (!state.doc || ev.isPrimary === false) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    const c = els.sigCanvas;
    const ctx = c.getContext('2d');
    const pt = sigPoint(ev);
    ctx.strokeStyle = state.sigPad.color;
    ctx.fillStyle = state.sigPad.color;
    ctx.lineWidth = state.sigPad.width * (state.sigPad.dpr || 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.01, pt.y);
    ctx.stroke();
    state.sigPad.hasMarks = true;
    capturePointer(c, ev.pointerId);
    beginWindowDrag(ev.pointerId, e2 => {
      const q = sigPoint(e2);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
    }, () => {
      releasePointer(c, ev.pointerId);
    });
  }

  function signatureAsset() {
    const c = els.sigCanvas;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = Math.round(6 * (state.sigPad.dpr || 1));
    minX = clamp(minX - pad, 0, c.width - 1);
    minY = clamp(minY - pad, 0, c.height - 1);
    maxX = clamp(maxX + pad, minX + 1, c.width - 1);
    maxY = clamp(maxY + pad, minY + 1, c.height - 1);
    const crop = document.createElement('canvas');
    crop.width = maxX - minX;
    crop.height = maxY - minY;
    crop.getContext('2d').drawImage(c, minX, minY, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return { dataUrl: crop.toDataURL('image/png'), w: crop.width, h: crop.height };
  }

  function placeSignature() {
    const asset = signatureAsset();
    if (!asset) { toast('Draw or upload a signature first.', 'error'); return; }
    const p = state.pages[state.activePage] || state.pages[0];
    if (!p) return;
    addImageAt(p, asset, { x: p.vp1.width / 2, y: p.vp1.height * 0.72 });
    setTool('select');
    closeSigModal();
    toast('Signature placed on page ' + p.num + ' — drag it into place.');
  }

  function chooseSignatureImage() {
    if (!sigFileInput) {
      sigFileInput = document.createElement('input');
      sigFileInput.type = 'file';
      sigFileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
      sigFileInput.hidden = true;
      document.body.appendChild(sigFileInput);
      sigFileInput.addEventListener('change', async ev => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        try {
          const url = URL.createObjectURL(file);
          let img;
          try { img = await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
          const c = els.sigCanvas;
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, c.width, c.height);
          const fit = Math.min((c.width * 0.9) / img.naturalWidth, (c.height * 0.8) / img.naturalHeight);
          const w = img.naturalWidth * fit;
          const h = img.naturalHeight * fit;
          ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
          state.sigPad.hasMarks = true;
          toast('Signature image loaded — you can still draw over it.');
        } catch (err) {
          toast('That signature image could not be read.', 'error');
        }
      });
    }
    sigFileInput.value = '';
    sigFileInput.click();
  }

  /* ---------- document-level actions ---------- */
  async function addPageNumbers(progress) {
    const PDFLib = window.PDFLib;
    const start = clamp(parseInt($('#pageNumberStart').value, 10) || 0, 0, 9999);
    const position = $('#pageNumberPosition').value;
    const size = clamp(parseInt($('#pageNumberSize').value, 10) || 12, 8, 72);
    const c = hexToRgb(normalizeHex($('#pageNumberColor').value, '#333333'));
    const doc = await prepareWorkingDoc();
    progress(40);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const color = PDFLib.rgb(c.r, c.g, c.b);
    doc.getPages().forEach((page, i) => {
      const p = state.pages[i];
      if (!p) return;
      const label = String(start + i);
      const textW = font.widthOfTextAtSize(label, size);
      const margin = Math.max(18, size * 1.5);
      let x = margin;
      let y = p.vp1.height - margin - size;
      if (position === 'bottom-right') x = p.vp1.width - margin - textW;
      else if (position === 'bottom-center') x = (p.vp1.width - textW) / 2;
      else if (position === 'top-right') { x = p.vp1.width - margin - textW; y = margin; }
      else if (position === 'top-left') { x = margin; y = margin; }
      else if (position === 'top-center') { x = (p.vp1.width - textW) / 2; y = margin; }
      const pt = p.vp1.convertToPdfPoint(x, y);
      page.drawText(label, {
        x: pt[0], y: pt[1], size, font, color,
        rotate: PDFLib.degrees(p.rotation || 0)
      });
    });
    progress(75);
    return replaceWithDoc(doc, state.fileName, 'Page numbers added.');
  }

  async function addWatermark(progress) {
    const PDFLib = window.PDFLib;
    const text = sanitizeForPdf(String($('#watermarkText').value || '').trim(), 'Helvetica');
    if (!text) { toast('Enter watermark text first.', 'error'); return null; }
    const size = clamp(parseInt($('#watermarkSize').value, 10) || 54, 12, 180);
    const opacity = clamp((parseFloat($('#watermarkOpacity').value) || 18) / 100, 0.05, 0.8);
    const angle = clamp(parseFloat($('#watermarkAngle').value) || 0, -90, 90);
    const c = hexToRgb(normalizeHex($('#watermarkColor').value, '#777777'));
    const doc = await prepareWorkingDoc();
    progress(40);
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const color = PDFLib.rgb(c.r, c.g, c.b);
    doc.getPages().forEach((page, i) => {
      const p = state.pages[i];
      if (!p) return;
      const w = font.widthOfTextAtSize(text, size);
      const h = size;
      const rad = ((p.rotation || 0) + angle) * Math.PI / 180;
      const offX = Math.cos(rad) * w / 2 - Math.sin(rad) * h / 2;
      const offY = Math.sin(rad) * w / 2 + Math.cos(rad) * h / 2;
      const pt = p.vp1.convertToPdfPoint(p.vp1.width / 2 - offX, p.vp1.height / 2 - offY);
      page.drawText(text, {
        x: pt[0], y: pt[1], size, font, color, opacity,
        rotate: PDFLib.degrees((p.rotation || 0) + angle)
      });
    });
    progress(75);
    return replaceWithDoc(doc, state.fileName, 'Watermark added.');
  }

  async function readScans(progress) {
    if (!window.Tesseract) throw new Error('The OCR library could not be loaded. Check your connection and reload.');
    const doc = await prepareWorkingDoc();
    const flat = await doc.save();
    progress(25);
    const pdfjsDoc = await renderPdfjsDoc(flat);
    const results = [];
    try {
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        els.loadingText.textContent = 'Reading page ' + i + ' of ' + pdfjsDoc.numPages + '…';
        const page = await pdfjsDoc.getPage(i);
        const { canvas } = await renderPageImage(page, 2, 9e6);
        const res = await window.Tesseract.recognize(canvas, 'eng', {
          logger: m => {
            if (m && m.status === 'recognizing text' && typeof m.progress === 'number') {
              progress(25 + ((i - 1 + m.progress) / pdfjsDoc.numPages) * 65);
            }
          }
        });
        results.push({ page: i, text: String((res && res.data && res.data.text) || '').trim() });
      }
    } finally {
      try { await pdfjsDoc.destroy(); } catch (e) {}
    }
    state.ocrTexts = results;
    els.ocrText.value = results.map(r => '--- Page ' + r.page + ' ---\n' + r.text).join('\n\n').trim() || 'No text was found.';
    updatePageToolsUi();
    progress(95);
    toast(results.some(r => r.text) ? 'OCR finished — review the text below.' : 'No text found. Try a clearer scan.');
    return true;
  }

  async function addSearchableText(progress) {
    if (!state.ocrTexts.length) return null;
    const PDFLib = window.PDFLib;
    const doc = await prepareWorkingDoc();
    progress(45);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const color = PDFLib.rgb(0, 0, 0);
    state.ocrTexts.forEach(result => {
      const page = doc.getPage(result.page - 1);
      const p = state.pages[result.page - 1];
      if (!page || !p) return;
      const lines = String(result.text).split(/\r?\n/).map(line => sanitizeForPdf(line.trim(), 'Helvetica')).filter(Boolean);
      lines.forEach((line, j) => {
        const pt = p.vp1.convertToPdfPoint(2, 12 + j * 12);
        page.drawText(line, {
          x: pt[0], y: pt[1], size: 8, font, color, opacity: 0,
          rotate: PDFLib.degrees(p.rotation || 0)
        });
      });
    });
    progress(75);
    return replaceWithDoc(doc, state.fileName, 'Invisible searchable text added.');
  }

  async function copyOcrText() {
    const text = state.ocrTexts.map(r => '--- Page ' + r.page + ' ---\n' + r.text).join('\n\n');
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('OCR text copied to clipboard.');
    } catch (e) {
      els.ocrText.focus();
      els.ocrText.select();
      try { document.execCommand('copy'); toast('OCR text copied.'); }
      catch (err) { toast('Select the text and copy it manually.', 'error'); }
    }
  }

  async function compressPdf(progress) {
    const PDFLib = window.PDFLib;
    const quality = clamp(parseFloat($('#compressQuality').value) || 0.85, 0.4, 1);
    const doc = await prepareWorkingDoc();
    const flat = await doc.save();
    const originalLength = state.bytes.length;
    progress(25);
    const pdfjsDoc = await renderPdfjsDoc(flat);
    const out = await PDFLib.PDFDocument.create();
    try {
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        els.loadingText.textContent = 'Compressing page ' + i + ' of ' + pdfjsDoc.numPages + '…';
        const page = await pdfjsDoc.getPage(i);
        const { canvas, vp, scale } = await renderPageImage(page, 1.6, 5e6);
        const img = await out.embedJpg(dataUrlToBytes(canvas.toDataURL('image/jpeg', quality)));
        const w = vp.width / scale;
        const h = vp.height / scale;
        const pg = out.addPage([w, h]);
        pg.drawImage(img, { x: 0, y: 0, width: w, height: h });
        progress(25 + (i / pdfjsDoc.numPages) * 60);
      }
    } finally {
      try { await pdfjsDoc.destroy(); } catch (e) {}
    }
    const result = await out.save();
    if (result.length >= originalLength * 0.98) {
      toast('This PDF is already compact — the original was kept.');
      return false;
    }
    return replacePdf(result, state.fileName, 'PDF compressed. Page text is now an image.');
  }

  async function splitPdf(progress) {
    if (!window.JSZip) throw new Error('The ZIP library could not be loaded. Check your connection and reload.');
    const PDFLib = window.PDFLib;
    const spec = String($('#splitSpec').value || '1').trim();
    const doc = await prepareWorkingDoc();
    const flat = await doc.save();
    const src = await PDFLib.PDFDocument.load(flat, { ignoreEncryption: true });
    const total = src.getPageCount();
    const groups = [];
    if (/^\d+$/.test(spec)) {
      const step = clamp(parseInt(spec, 10) || 1, 1, total);
      for (let i = 0; i < total; i += step) {
        groups.push(Array.from({ length: Math.min(step, total - i) }, (_, k) => i + k));
      }
    } else {
      spec.split(',').forEach(part => {
        const token = part.trim();
        const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
          const a = clamp(parseInt(range[1], 10) - 1, 0, total - 1);
          const b = clamp(parseInt(range[2], 10) - 1, 0, total - 1);
          if (b >= a) groups.push(Array.from({ length: b - a + 1 }, (_, k) => a + k));
        } else if (/^\d+$/.test(token)) {
          const i = parseInt(token, 10) - 1;
          if (i >= 0 && i < total) groups.push([i]);
        }
      });
    }
    if (!groups.length) { toast('Enter a page count or ranges like 1-3,4-6.', 'error'); return null; }
    progress(35);
    const zip = new window.JSZip();
    for (let g = 0; g < groups.length; g++) {
      const out = await PDFLib.PDFDocument.create();
      const copied = await out.copyPages(src, groups[g]);
      copied.forEach(page => out.addPage(page));
      zip.file(outputBase() + '-pages-' + groups[g].map(i => i + 1).join('-') + '.pdf', await out.save());
      progress(35 + ((g + 1) / groups.length) * 55);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, outputBase() + '-split.zip');
    toast(groups.length + ' PDF file' + (groups.length === 1 ? '' : 's') + ' downloaded in a ZIP.');
    return true;
  }

  async function mergePdfs(files, progress) {
    const PDFLib = window.PDFLib;
    const doc = await prepareWorkingDoc();
    let added = 0;
    progress(25);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
        toast('Skipped ' + (file.name || 'a file') + ' — it is not a PDF.', 'error');
        continue;
      }
      const src = await PDFLib.PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true });
      const copied = await doc.copyPages(src, src.getPageIndices());
      copied.forEach(page => doc.addPage(page));
      added += copied.length;
      progress(25 + ((i + 1) / files.length) * 55);
    }
    if (!added) { toast('No PDF pages were added.', 'error'); return null; }
    return replaceWithDoc(doc, state.fileName, 'Added ' + added + ' page' + (added === 1 ? '' : 's') + '.');
  }

  async function insertBlankPage(progress) {
    const doc = await prepareWorkingDoc();
    const p = state.pages[state.activePage] || state.pages[state.pages.length - 1];
    const index = clamp(state.activePage + 1, 0, doc.getPageCount());
    doc.insertPage(index, [p ? p.vp1.width : 612, p ? p.vp1.height : 792]);
    progress(60);
    return replaceWithDoc(doc, state.fileName, 'Blank page inserted after page ' + (state.activePage + 1) + '.');
  }

  async function rotateAllPages(progress) {
    const PDFLib = window.PDFLib;
    const doc = await prepareWorkingDoc();
    doc.getPages().forEach(page => {
      const angle = (((page.getRotation().angle || 0) + 90) % 360 + 360) % 360;
      page.setRotation(PDFLib.degrees(angle));
    });
    progress(65);
    return replaceWithDoc(doc, state.fileName, 'All pages turned right.');
  }

  async function reversePages(progress) {
    const PDFLib = window.PDFLib;
    const doc = await prepareWorkingDoc();
    const total = doc.getPageCount();
    const indices = Array.from({ length: total }, (_, i) => total - 1 - i);
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(doc, indices);
    copied.forEach(page => out.addPage(page));
    progress(70);
    return replaceWithDoc(out, state.fileName, 'Page order reversed.');
  }

  async function savePagePicture(progress) {
    const doc = await prepareWorkingDoc();
    const flat = await doc.save();
    progress(30);
    const pdfjsDoc = await renderPdfjsDoc(flat);
    try {
      const index = state.activePage;
      const page = await pdfjsDoc.getPage(index + 1);
      const { canvas } = await renderPageImage(page, 2, 12e6);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The page image could not be created.');
      downloadBlob(blob, outputBase() + '-page-' + (index + 1) + '.png');
      progress(95);
      toast('Page ' + (index + 1) + ' saved as a PNG image.');
      return true;
    } finally {
      try { await pdfjsDoc.destroy(); } catch (e) {}
    }
  }

  function handlePageAction(action) {
    if (!state.doc || state.busy) return;
    closePageTools();
    if (action === 'sign') { openSigModal(); return; }
    if (action === 'redact') { setTool('redact'); return; }
    if (action === 'copy-ocr') { copyOcrText(); return; }
    if (action === 'merge') {
      els.mergePdfInput.value = '';
      els.mergePdfInput.click();
      return;
    }
    const labels = {
      'page-number': 'Adding page numbers…',
      watermark: 'Adding watermark…',
      ocr: 'Reading text in scan…',
      'add-ocr': 'Adding searchable text…',
      compress: 'Compressing PDF…',
      split: 'Splitting PDF…',
      insert: 'Inserting blank page…',
      rotate: 'Turning pages…',
      reverse: 'Reversing pages…',
      'save-picture': 'Rendering page image…'
    };
    const handlers = {
      'page-number': addPageNumbers,
      watermark: addWatermark,
      ocr: readScans,
      'add-ocr': addSearchableText,
      compress: compressPdf,
      split: splitPdf,
      insert: insertBlankPage,
      rotate: rotateAllPages,
      reverse: reversePages,
      'save-picture': savePagePicture
    };
    const handler = handlers[action];
    if (!handler) return;
    withBusy(labels[action] || 'Working…', progress => handler(progress));
  }

  /* ---------- events ---------- */
  function bindEvents() {
    els.uploadBtn.addEventListener('click', () => els.pdfInput.click());
    els.pdfInput.addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (file) openPdf(file);
    });
    els.exportTop.addEventListener('click', exportPdf);
    els.imageBtn.addEventListener('click', () => els.imageInput.click());
    els.imageInput.addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (file) handleImageFile(file);
    });

    $$('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
    $$('.tool-btn[data-action="image"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.doc) { toast('Open a PDF first, then add an image.', 'error'); return; }
        els.imageInput.click();
      });
    });
    $$('.tool-btn[data-action="sign"]').forEach(btn => {
      btn.addEventListener('click', openSigModal);
    });
    $$('.tool-btn[data-action="pages"]').forEach(btn => {
      btn.addEventListener('click', openPageTools);
    });

    els.fontSize.addEventListener('input', () => applyTextSize(els.fontSize.value, false));
    els.fontSize.addEventListener('change', () => applyTextSize(els.fontSize.value, true));
    els.textFont.addEventListener('change', () => applyTextFont(els.textFont.value, true));
    els.brushSize.addEventListener('input', () => applyBrushSize(els.brushSize.value));
    els.snapToggle.addEventListener('change', () => {
      state.highlightDefaults.snap = els.snapToggle.checked;
    });

    els.textColor.addEventListener('input', () => applyTextColor(els.textColor.value, false));
    els.textColor.addEventListener('change', () => applyTextColor(els.textColor.value, true));
    els.hlColor.addEventListener('input', () => applyHighlightColor(els.hlColor.value, false));
    els.hlColor.addEventListener('change', () => applyHighlightColor(els.hlColor.value, true));
    els.drawColor.addEventListener('input', () => applyDrawColor(els.drawColor.value, false));
    els.drawColor.addEventListener('change', () => applyDrawColor(els.drawColor.value, true));

    $$('.swatch[data-group]').forEach(chip => {
      chip.addEventListener('click', () => {
        const group = chip.dataset.group;
        const color = chip.dataset.color;
        if (group === 'text') applyTextColor(color, true);
        else if (group === 'highlight') applyHighlightColor(color, true);
        else if (group === 'draw') applyDrawColor(color, true);
        else if (group === 'redact') applyRedactColor(color, true);
      });
    });

    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.deleteBtn.addEventListener('click', deleteSelected);
    els.clearPageBtn.addEventListener('click', clearActivePage);

    els.prevPage.addEventListener('click', () => scrollToPage(state.activePage - 1));
    els.nextPage.addEventListener('click', () => scrollToPage(state.activePage + 1));
    els.pageJump.addEventListener('click', openSheet);
    els.closeThumbs.addEventListener('click', closeSheet);
    els.sheetBackdrop.addEventListener('click', closeSheet);

    if (els.pageToolsBtn) els.pageToolsBtn.addEventListener('click', openPageTools);
    if (els.closePageTools) els.closePageTools.addEventListener('click', closePageTools);
    $$('[data-page-action]', els.pageToolsSheet).forEach(btn => {
      btn.addEventListener('click', () => handlePageAction(btn.dataset.pageAction));
    });
    els.mergePdfInput.addEventListener('change', ev => {
      const files = Array.from(ev.target.files || []);
      ev.target.value = '';
      if (!files.length) return;
      withBusy('Adding PDF files…', progress => mergePdfs(files, progress));
    });

    els.sigBackdrop.addEventListener('click', closeSigModal);
    els.sigCancel.addEventListener('click', closeSigModal);
    els.sigClear.addEventListener('click', () => {
      const ctx = els.sigCanvas.getContext('2d');
      ctx.clearRect(0, 0, els.sigCanvas.width, els.sigCanvas.height);
      state.sigPad.hasMarks = false;
    });
    els.sigPlace.addEventListener('click', placeSignature);
    els.sigUpload.addEventListener('click', chooseSignatureImage);
    els.sigSize.addEventListener('input', () => {
      state.sigPad.width = clamp(parseInt(els.sigSize.value, 10) || 3, 1, 12);
      els.sigSizeVal.textContent = state.sigPad.width + ' px';
      fillRange(els.sigSize);
    });
    els.sigColor.addEventListener('input', () => {
      state.sigPad.color = normalizeHex(els.sigColor.value, '#111827');
    });
    els.sigCanvas.addEventListener('pointerdown', onSigPointerDown);
    els.sigCanvas.addEventListener('contextmenu', ev => ev.preventDefault());
    els.sigModal.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); closeSigModal(); return; }
      trapFocus(ev, els.sigModal);
    });
    els.pageToolsSheet.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); closePageTools(); return; }
      trapFocus(ev, els.pageToolsSheet);
    });

    els.dropzone.addEventListener('click', () => els.pdfInput.click());
    els.dropzone.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); els.pdfInput.click(); }
    });
    els.emptyState.addEventListener('click', ev => {
      if (ev.target === els.emptyState) els.pdfInput.click();
    });

    let dragDepth = 0;
    const hasFiles = ev => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf('Files') !== -1;
    document.addEventListener('dragenter', ev => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      dragDepth++;
      els.dropzone.classList.add('dragover');
    });
    document.addEventListener('dragover', ev => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', ev => {
      if (!hasFiles(ev)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) els.dropzone.classList.remove('dragover');
    });
    document.addEventListener('drop', ev => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      dragDepth = 0;
      els.dropzone.classList.remove('dragover');
      const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) openPdf(file);
    });

    let scrollPending = false;
    els.canvasArea.addEventListener('scroll', () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(() => {
        scrollPending = false;
        renderVisiblePages();
        updateActivePage();
      });
    }, { passive: true });

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => layoutPages(), 140);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(() => layoutPages(), 320));
    if (window.ResizeObserver) {
      try { new ResizeObserver(onResize).observe(els.canvasArea); } catch (e) {}
    }

    document.addEventListener('keydown', ev => {
      const target = ev.target;
      const typing = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable
      );
      const mod = ev.ctrlKey || ev.metaKey;
      const key = String(ev.key || '').toLowerCase();

      if (key === 'escape') {
        if (!els.sigModal.hidden) { closeSigModal(); return; }
        if (!els.pageToolsSheet.hidden) { closePageTools(); return; }
        if (!els.thumbsSheet.hidden) { closeSheet(); return; }
        if (typing) { finalizeTextEdits(); exitTextEdit(); selectAnn(null); return; }
        if (state.selected) { selectAnn(null); return; }
        setTool('select');
        return;
      }
      if (mod && !ev.shiftKey && key === 'z') {
        if (typing) return;
        ev.preventDefault();
        undo();
        return;
      }
      if ((mod && key === 'y') || (mod && ev.shiftKey && key === 'z')) {
        if (typing) return;
        ev.preventDefault();
        redo();
        return;
      }
      if ((key === 'delete' || key === 'backspace') && !typing && state.selected) {
        ev.preventDefault();
        deleteSelected();
        return;
      }
      if (typing || mod || ev.altKey) return;
      if (key === 'v') setTool('select');
      else if (key === 't') setTool('text');
      else if (key === 'c') setTool('edittext');
      else if (key === 'h') setTool('highlight');
      else if (key === 'p') setTool('draw');
      else if (key === 'w') setTool('whiteout');
      else if (key === 'r') setTool('redact');
      else if (key === 'e') setTool('erase');
    });
  }

  /* ---------- boot ---------- */
  function init() {
    if (!window.pdfjsLib) {
      showEmptyError('The PDF engine could not be loaded. Please check your internet connection and reload the page.');
    } else {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    if (!window.PDFLib) console.warn('[pdf] pdf-lib is unavailable — export will not work.');

    bindEvents();
    document.body.dataset.tool = 'select';
    state.tool = 'select';
    updateToolUi();
    applyTextSize(state.textDefaults.size, false);
    applyTextColor(state.textDefaults.color, false);
    applyTextFont(state.textDefaults.font, false);
    applyHighlightColor(state.highlightDefaults.color, false);
    applyDrawColor(state.drawDefaults.color, false);
    applyRedactColor(state.redactDefaults.color, false);
    applyBrushSize(state.drawDefaults.width);
    state.highlightDefaults.snap = !!(els.snapToggle && els.snapToggle.checked);
    if (els.sigSize) {
      state.sigPad.width = clamp(parseInt(els.sigSize.value, 10) || 3, 1, 12);
      els.sigSizeVal.textContent = state.sigPad.width + ' px';
      fillRange(els.sigSize);
    }
    if (els.sigColor) state.sigPad.color = normalizeHex(els.sigColor.value, '#111827');
    resetHistory();
    updateCount();
    updateActions();
    updatePageToolsUi();
    const year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  init();
})();
