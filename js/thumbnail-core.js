/* LetitEdit Thumbnail Maker — pure, DOM-free document helpers.
 * Loaded as a browser global and as a CommonJS module for unit tests.
 * This file never draws to a canvas, uploads files or mutations the DOM. */
(function (global) {
  'use strict';

  var T = {};

  /* Recommended upload sizes for the named surfaces. Platforms change their
   * guidance; the editor shows these as verified presets, not guarantees. */
  T.PRESETS = [
    { id: 'youtube', label: 'YouTube thumbnail', width: 1280, height: 720, note: 'YouTube recommends 1280×720 px.', safe: [0.04, 0.04, 0.04, 0.04] },
    { id: 'shorts', label: 'YouTube Shorts cover', width: 1080, height: 1920, note: 'Vertical Shorts cover: 1080×1920 px.', safe: [0.06, 0.12, 0.06, 0.18] },
    { id: 'instagram-post', label: 'Instagram post', width: 1080, height: 1080, note: 'Instagram feed image: 1080×1080 px.', safe: [0.05, 0.05, 0.05, 0.05] },
    { id: 'instagram-reel', label: 'Instagram Reels cover', width: 1080, height: 1920, note: 'Reels cover: 1080×1920 px.', safe: [0.06, 0.12, 0.06, 0.18] },
    { id: 'instagram-story', label: 'Instagram Story', width: 1080, height: 1920, note: 'Instagram Story: 1080×1920 px.', safe: [0.06, 0.12, 0.06, 0.17] },
    { id: 'tiktok', label: 'TikTok cover', width: 1080, height: 1920, note: 'TikTok profile cover: 1080×1920 px.', safe: [0.06, 0.16, 0.06, 0.2] },
    { id: 'facebook-post', label: 'Facebook post', width: 1200, height: 630, note: 'Facebook link/image post: 1200×630 px.', safe: [0.05, 0.05, 0.05, 0.05] },
    { id: 'facebook-cover', label: 'Facebook cover', width: 851, height: 315, note: 'Facebook Page cover: 851×315 px.', safe: [0.04, 0.04, 0.04, 0.04] },
    { id: 'facebook-video', label: 'Facebook video thumbnail', width: 1280, height: 720, note: 'Facebook video thumbnail: 1280×720 px.', safe: [0.04, 0.04, 0.04, 0.04] },
    { id: 'linkedin-post', label: 'LinkedIn post', width: 1200, height: 627, note: 'LinkedIn shared image: 1200×627 px.', safe: [0.05, 0.05, 0.05, 0.05] },
    { id: 'linkedin-banner', label: 'LinkedIn banner', width: 1584, height: 396, note: 'LinkedIn banner: 1584×396 px.', safe: [0.03, 0.05, 0.03, 0.05] },
    { id: 'x-post', label: 'X / Twitter post', width: 1200, height: 675, note: 'X / Twitter image: 1200×675 px.', safe: [0.05, 0.05, 0.05, 0.05] },
    { id: 'pinterest', label: 'Pinterest Pin', width: 1000, height: 1500, note: 'Pinterest Pin: 1000×1500 px.', safe: [0.05, 0.06, 0.05, 0.1] },
    { id: 'custom', label: 'Custom size', width: 1280, height: 720, note: 'Custom canvas. Output uses exactly these dimensions.', safe: [0.04, 0.04, 0.04, 0.04] }
  ];

  T.presetById = function (id) {
    return T.PRESETS.find(function (preset) { return preset.id === id; })
      || T.PRESETS[T.PRESETS.length - 1];
  };

  T.safeArea = function (presetId, width, height) {
    var preset = T.presetById(presetId);
    var s = preset.safe || [0.04, 0.04, 0.04, 0.04];
    return {
      left: Math.round(width * s[0]),
      top: Math.round(height * s[1]),
      right: Math.round(width - width * s[2]),
      bottom: Math.round(height - height * s[3])
    };
  };

  /* Script ranges are deliberately conservative. The editor uses the result
   * to offer only font stacks with known coverage for the dominant script. */
  var SCRIPT_RANGES = [
    ['arabic', /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/],
    ['hebrew', /[\u0590-\u05FF\uFB1D-\uFB4F]/],
    ['devanagari', /[\u0900-\u097F]/],
    ['bengali', /[\u0980-\u09FF]/],
    ['gurmukhi', /[\u0A00-\u0A7F]/],
    ['tamil', /[\u0B80-\u0BFF]/],
    ['thai', /[\u0E00-\u0E7F]/],
    ['cyrillic', /[\u0400-\u04FF\u0500-\u052F]/],
    ['greek', /[\u0370-\u03FF]/],
    ['korean', /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/],
    ['japanese', /[\u3040-\u30FF]/],
    ['han', /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/],
    ['emoji', /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u],
    ['latin', /[A-Za-z\u00C0-\u024F]/]
  ];
  T.SCRIPT_RANGES = SCRIPT_RANGES;

  T.scriptCounts = function (text) {
    var value = String(text == null ? '' : text);
    var counts = {};
    SCRIPT_RANGES.forEach(function (entry) {
      var matches = value.match(new RegExp(entry[1].source, entry[1].flags.indexOf('u') !== -1 ? 'gu' : 'g'));
      if (matches && matches.length) counts[entry[0]] = matches.length;
    });
    return counts;
  };

  T.detectScript = function (text) {
    var counts = T.scriptCounts(text);
    var best = 'latin';
    var bestCount = 0;
    Object.keys(counts).forEach(function (script) {
      if (script === 'emoji') return;
      if (counts[script] > bestCount) { best = script; bestCount = counts[script]; }
    });
    if (!bestCount && counts.emoji) return 'emoji';
    return best;
  };

  T.isRTLScript = function (script) {
    return script === 'arabic' || script === 'hebrew';
  };

  /* Auto direction follows the first strong directional character, which is
   * how Unicode bidi works. Mixed text is never manually reversed. */
  T.resolveDirection = function (text, requested) {
    if (requested === 'ltr' || requested === 'rtl') return requested;
    var value = String(text == null ? '' : text);
    var rtl = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
    var ltr = /[A-Za-z\u00C0-\u024F\u0370-\u052F\u0900-\u0DFF\u3040-\u9FFF\uAC00-\uD7AF]/;
    var characters = Array.from(value);
    for (var i = 0; i < characters.length; i++) {
      if (rtl.test(characters[i])) return 'rtl';
      if (ltr.test(characters[i])) return 'ltr';
    }
    return 'ltr';
  };

  T.FONT_STACKS = {
    latin: [
      { value: '700 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif', label: 'Sans' },
      { value: '700 Georgia, "Times New Roman", "Noto Serif", serif', label: 'Serif' },
      { value: '900 Impact, "Arial Black", system-ui, sans-serif', label: 'Impact' },
      { value: '700 ui-monospace, Consolas, "Liberation Mono", monospace', label: 'Monospace' }
    ],
    arabic: [
      { value: '700 "Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif', label: 'Arabic sans' },
      { value: '400 "Noto Naskh Arabic", "Traditional Arabic", "Segoe UI", serif', label: 'Arabic naskh' },
      { value: '400 "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Jameel Noori Nastaleeq", serif', label: 'Urdu nastaliq' }
    ],
    hebrew: [
      { value: '700 "Noto Sans Hebrew", "Arial Hebrew", "Segoe UI", sans-serif', label: 'Hebrew sans' },
      { value: '400 "David", "Noto Serif Hebrew", serif', label: 'Hebrew serif' }
    ],
    cyrillic: [
      { value: '700 "Noto Sans", system-ui, "Segoe UI", Arial, sans-serif', label: 'Cyrillic sans' },
      { value: '900 "Arial Black", "Noto Sans", sans-serif', label: 'Cyrillic bold' },
      { value: '700 Georgia, "Noto Serif", serif', label: 'Cyrillic serif' }
    ],
    greek: [
      { value: '700 "Noto Sans", system-ui, "Segoe UI", Arial, sans-serif', label: 'Greek sans' },
      { value: '700 Georgia, "Noto Serif", serif', label: 'Greek serif' }
    ],
    devanagari: [
      { value: '700 "Noto Sans Devanagari", "Nirmala UI", "Mangal", sans-serif', label: 'Devanagari sans' },
      { value: '400 "Noto Serif Devanagari", "Kohinoor Devanagari", serif', label: 'Devanagari serif' }
    ],
    bengali: [
      { value: '700 "Noto Sans Bengali", "Nirmala UI", "Vrinda", sans-serif', label: 'Bengali sans' }
    ],
    gurmukhi: [
      { value: '700 "Noto Sans Gurmukhi", "Nirmala UI", "Raavi", sans-serif', label: 'Punjabi sans' }
    ],
    tamil: [
      { value: '700 "Noto Sans Tamil", "Nirmala UI", "Latha", sans-serif', label: 'Tamil sans' }
    ],
    thai: [
      { value: '700 "Noto Sans Thai", "Segoe UI", "Tahoma", sans-serif', label: 'Thai sans' }
    ],
    han: [
      { value: '700 "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif', label: 'Simplified Chinese' },
      { value: '700 "Noto Sans CJK TC", "Microsoft JhengHei", "PingFang TC", sans-serif', label: 'Traditional Chinese' }
    ],
    japanese: [
      { value: '700 "Noto Sans CJK JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif', label: 'Japanese gothic' },
      { value: '700 "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", serif', label: 'Japanese mincho' }
    ],
    korean: [
      { value: '700 "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', label: 'Korean sans' },
      { value: '700 "Batang", "Noto Serif CJK KR", serif', label: 'Korean serif' }
    ],
    emoji: [
      { value: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif', label: 'Colour emoji' }
    ]
  };

  T.fontsForScript = function (script) {
    var direct = T.FONT_STACKS[script];
    if (direct && direct.length) return direct.slice();
    return T.FONT_STACKS.latin.slice();
  };

  T.fontSupportsScript = function (fontValue, script) {
    return T.fontsForScript(script).some(function (font) { return font.value === fontValue; });
  };

  T.suggestFontForScript = function (script, currentValue) {
    var fonts = T.fontsForScript(script);
    if (T.fontSupportsScript(currentValue, script)) return currentValue;
    return fonts[0].value;
  };

  function graphemes(value) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(value), function (part) { return part.segment; });
    }
    return Array.from(String(value));
  }
  T.graphemes = graphemes;

  function wordTokens(value) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      return Array.from(segmenter.segment(value), function (part) { return part.segment; });
    }
    return String(value).match(/\s+|[^\s]+/g) || [];
  }
  T.wordTokens = wordTokens;

  function splitLongToken(token, measure, maxWidth) {
    var pieces = [];
    var current = '';
    graphemes(token).forEach(function (glyph) {
      var candidate = current + glyph;
      if (current && measure(candidate) > maxWidth) {
        pieces.push(current);
        current = glyph;
      } else {
        current = candidate;
      }
    });
    if (current) pieces.push(current);
    return pieces;
  }

  /* measure(str) is supplied by the canvas renderer, keeping this function
   * pure and unit-testable. No character order is changed here. */
  T.wrapText = function (measure, text, maxWidth, options) {
    var opts = options || {};
    var limit = Math.max(8, Number(maxWidth) || 240);
    var lines = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (paragraph) {
      if (!paragraph) { lines.push(''); return; }
      var line = '';
      wordTokens(paragraph).forEach(function (token) {
        if (!line && /^\s+$/.test(token)) return;
        var candidate = line + token;
        if (measure(candidate) <= limit) { line = candidate; return; }
        if (line) {
          lines.push(line.replace(/\s+$/, ''));
          line = /^\s+$/.test(token) ? '' : token.replace(/^\s+/, '');
        } else {
          line = token;
        }
        if (measure(line) > limit) {
          var pieces = splitLongToken(line, measure, limit);
          lines.push.apply(lines, pieces.slice(0, -1));
          line = pieces[pieces.length - 1] || '';
        }
      });
      lines.push(line.replace(/\s+$/, ''));
    });
    if (!opts.keepTrailingBlank) {
      while (lines.length && !lines[lines.length - 1]) lines.pop();
    }
    return lines.length ? lines : [''];
  };

  var idCounter = 0;
  function nextId(type) {
    idCounter += 1;
    return (type || 'layer') + '-' + Date.now().toString(36) + '-' + idCounter.toString(36);
  }
  T.nextId = nextId;

  T.makeLayer = function (type, overrides) {
    var result = {
      id: nextId(type || 'shape'),
      type: type || 'shape',
      name: '',
      x: 50,
      y: 50,
      w: 60,
      h: 30,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blend: 'source-over'
    };
    if (type === 'text') {
      Object.assign(result, {
        name: 'Text',
        text: '',
        font: T.FONT_STACKS.latin[0].value,
        size: 84,
        weight: '700',
        italic: false,
        direction: 'auto',
        align: 'center',
        lineHeight: 1.15,
        letterSpacing: 0,
        color: '#ffffff',
        background: 'transparent',
        color2: '#60a5fa',
        gradient: false,
        outlineColor: '#0f172a',
        outlineWidth: 4,
        shadow: true,
        shadowColor: 'rgba(4,10,30,.65)',
        shadowBlur: 12,
        backing: false
      });
    } else if (type === 'image') {
      Object.assign(result, {
        name: 'Image',
        srcId: null,
        fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        flipX: false,
        flipY: false,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        blur: 0,
        removeBackground: false,
        border: 0,
        borderColor: '#ffffff',
        shadow: false,
        radius: 16
      });
    } else {
      Object.assign(result, {
        name: type === 'sticker' ? 'Emoji / sticker' : 'Shape',
        shape: 'rect',
        glyph: '★',
        color: '#2563eb',
        radius: 12
      });
    }
    if (overrides) Object.assign(result, overrides);
    return result;
  };

  T.cloneLayer = function (layer) {
    return JSON.parse(JSON.stringify(layer));
  };

  function indexOfLayer(layers, id) {
    return layers.findIndex(function (layer) { return layer && layer.id === id; });
  }
  T.indexOfLayer = indexOfLayer;

  T.moveLayer = function (layers, id, delta) {
    var from = indexOfLayer(layers, id);
    if (from < 0) return false;
    var to = Math.max(0, Math.min(layers.length - 1, from + delta));
    if (to === from) return false;
    var item = layers.splice(from, 1)[0];
    layers.splice(to, 0, item);
    return true;
  };

  T.duplicateLayer = function (layers, id) {
    var index = indexOfLayer(layers, id);
    if (index < 0) return null;
    var copy = T.cloneLayer(layers[index]);
    copy.id = nextId(copy.type);
    copy.name = String(copy.name || copy.type) + ' copy';
    copy.x = Math.min(100, Number(copy.x) + 3);
    copy.y = Math.min(100, Number(copy.y) + 3);
    layers.splice(index + 1, 0, copy);
    return copy;
  };

  T.removeLayer = function (layers, id) {
    var index = indexOfLayer(layers, id);
    if (index < 0) return null;
    return layers.splice(index, 1)[0];
  };

  T.getLayer = function (layers, id) {
    var index = indexOfLayer(layers, id);
    return index < 0 ? null : layers[index];
  };

  T.applyTemplate = function (name, imageCount) {
    var count = Math.max(0, Number(imageCount) || 0);
    var layers = [];
    if (name === 'quote') {
      layers.push(T.makeLayer('shape', { name: 'Accent bar', x: 8, y: 24, w: 2, h: 52, shape: 'rect', color: '#60a5fa' }));
      layers.push(T.makeLayer('text', {
        name: 'Quote', text: 'Small details.\nBig impact.', size: 78, x: 52, y: 50, w: 76, h: 42,
        align: 'start', font: T.FONT_STACKS.latin[1].value, lineHeight: 1.25
      }));
    } else if (name === 'badge') {
      layers.push(T.makeLayer('shape', { name: 'Badge circle', shape: 'circle', x: 50, y: 50, w: 34, h: 58, color: '#dc2626' }));
      layers.push(T.makeLayer('text', { name: 'Badge value', text: '50%\nOFF', size: 74, x: 50, y: 50, w: 30, h: 34, color: '#ffffff', align: 'center' }));
    } else if (name === 'split') {
      layers.push(T.makeLayer('image', { name: 'Left photo', srcId: count > 0 ? 'image-0' : null, x: 26, y: 50, w: 48, h: 90, fit: 'cover' }));
      layers.push(T.makeLayer('image', { name: 'Right photo', srcId: count > 1 ? 'image-1' : null, x: 74, y: 50, w: 48, h: 90, fit: 'cover' }));
      layers.push(T.makeLayer('text', { name: 'Split title', text: 'YOUR STORY', size: 76, x: 50, y: 50, w: 78, h: 24 }));
    } else if (name === 'global') {
      layers.push(T.makeLayer('text', {
        name: 'Global headline', text: '日本語 العربية हिन्दी', size: 66, x: 50, y: 42, w: 84, h: 28,
        font: T.FONT_STACKS.han[0].value, direction: 'auto'
      }));
      layers.push(T.makeLayer('text', { name: 'Latin subtitle', text: 'Multilingual export · مثال · उदाहरण', size: 34, x: 50, y: 68, w: 84, h: 16 }));
    } else {
      layers.push(T.makeLayer('text', { name: 'Headline', text: 'BIG IDEA', size: 96, x: 50, y: 42, w: 84, h: 30 }));
      layers.push(T.makeLayer('text', { name: 'Subtitle', text: 'Add your own words', size: 34, x: 50, y: 66, w: 74, h: 14, color: '#bfdbfe' }));
      layers.push(T.makeLayer('sticker', { name: 'Spark', glyph: '★', shape: '★', x: 84, y: 22, w: 10, h: 16 }));
    }
    return { name: name, layers: layers };
  };

  T.TEMPLATE_NAMES = ['bold', 'quote', 'badge', 'split', 'global'];

  T.exportName = function (presetId, format) {
    var preset = T.presetById(presetId);
    var base = preset.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'thumbnail';
    var extension = format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
    return 'letitedit-' + base + '.' + extension;
  };

  T.sanitizeProject = function (data) {
    if (!data || typeof data !== 'object') throw new Error('That project file is not valid.');
    var w = Math.max(64, Math.min(8000, Math.round(Number(data.width) || 1280)));
    var h = Math.max(64, Math.min(8000, Math.round(Number(data.height) || 720)));
    var layers = Array.isArray(data.layers) ? data.layers.slice(0, 200) : [];
    return {
      format: 'letitedit-thumbnail',
      version: 1,
      preset: data.preset || 'custom',
      width: w,
      height: h,
      background: data.background && typeof data.background === 'object'
        ? data.background
        : { type: 'gradient', color1: '#0f172a', color2: '#2563eb' },
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
      layers: layers.map(function (layer) {
        var clean = T.cloneLayer(layer);
        clean.id = clean.id || nextId(clean.type);
        clean.opacity = clean.opacity == null
          ? 1
          : Math.max(0, Math.min(1, Number(clean.opacity) || 0));
        clean.visible = clean.visible !== false;
        clean.locked = Boolean(clean.locked);
        return clean;
      })
    };
  };

  global.ThumbnailCore = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
