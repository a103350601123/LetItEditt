/* LetitEdit — faithful, pure processing engines for the supplied Text & Writing
 * reference tools. No DOM, no network, no side effects. Each function mirrors
 * the authoritative application source; documented limitations are retained
 * rather than silently "improved" so behaviour matches the reference. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReferenceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function str(value) { return value === null || value === undefined ? '' : String(value); }
  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /* ------------------------------------------------------------------ *
   * 07 — Lorem Ipsum Generator
   * ------------------------------------------------------------------ */
  const VOCAB = (
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ' +
    'incididunt ut labore et dolore magna aliqua enim ad minim veniam ' +
    'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
    'commodo consequat duis aute irure in reprehenderit voluptate velit ' +
    'esse cillum eu fugiat nulla pariatur excepteur sint occaecat ' +
    'cupidatat non proident sunt culpa qui officia deserunt mollit ' +
    'anim id est laborum praesent vestibulum curabitur mauris nunc integer ' +
    'pellentesque fusce aenean donec quisque vivamus nam suspendisse phasellus ' +
    'morbi etiam maecenas nullam cras proin aliquam sapien tellus libero metus ' +
    'lacus justo felis eros arcu nibh risus orci ligula tortor turpis massa neque ' +
    'odio purus urna quam erat mi leo dui ante nisl diam augue porta tempus semper ' +
    'feugiat dictum lacinia viverra egestas faucibus posuere iaculis ultrices ' +
    'placerat sodales rutrum blandit convallis mattis molestie pharetra malesuada ' +
    'fermentum scelerisque sollicitudin condimentum vulputate tincidunt accumsan ' +
    'gravida hendrerit luctus interdum facilisis imperdiet dignissim efficitur ' +
    'elementum euismod congue cursus ornare venenatis volutpat suscipit bibendum ' +
    'aliquet varius vehicula porttitor pulvinar rhoncus lobortis auctor ultricies ' +
    'eleifend finibus sagittis lectus vitae nec at vel ac eget sem'
  ).split(' ');
  const PASSAGE = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
    'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ' +
    'ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    'Duis aute irure dolor in reprehenderit in voluptate velit ' +
    'esse cillum dolore eu fugiat nulla pariatur.',
    'Excepteur sint occaecat cupidatat non proident, ' +
    'sunt in culpa qui officia deserunt mollit anim id est laborum.'
  ];
  const OPENER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
  const PARA_LEN = { short: [3, 4], medium: [5, 7], long: [8, 11] };
  const STD_LEN = { short: 2, medium: 4, long: 6 };
  const UNIT_LIMITS = { paragraphs: 100, sentences: 500, words: 5000, list: 100 };

  function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
  function countWords(text) { const m = str(text).match(/\S+/g); return m ? m.length : 0; }

  function classicWords(n) {
    const pool = VOCAB.slice();
    const out = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }

  function classicSentence(min, max) {
    const n = ri(min, max);
    const words = classicWords(n);
    let text = words.map(function (w) { return w; }).join(' ');
    if (n > 7 && Math.random() > 0.35) {
      const at = ri(2, n - 4);
      words[at] += ',';
      text = words.join(' ');
    }
    return capitalize(text) + '.';
  }

  function makeCycle(start) {
    let i = start ? 0 : ri(1, PASSAGE.length - 1);
    return function () { return PASSAGE[i++ % PASSAGE.length]; };
  }

  function wordsToText(words, n) {
    const sliced = words.slice(0, n);
    if (!sliced.length) return '';
    sliced[0] = capitalize(sliced[0]);
    let text = sliced.join(' ').replace(/,$/, '');
    return text + '.';
  }

  function loremItem(next, opts, index) {
    const style = opts.style;
    const length = opts.length;
    if (style === 'standard') {
      const passage = next();
      if (length === 'short') return countWords(passage) <= 5 ? passage : passage.split(/\s+/).slice(0, 5).join(' ');
      if (length === 'long') return passage + ' ' + next();
      return passage;
    }
    if (length === 'short') {
      return Math.random() > 0.5 ? 'Lorem ipsum dolor sit amet' : capitalize(classicWords(ri(2, 5)).join(' ')) + '.';
    }
    if (length === 'medium') return Math.random() > 0.5 ? OPENER : classicSentence(5, 10);
    return (Math.random() > 0.5 ? OPENER : classicSentence(6, 12)) + ' ' + classicSentence(6, 12);
  }

  function loremGenerate(options) {
    const opts = options || {};
    const unit = UNIT_LIMITS[opts.unit] ? opts.unit : 'paragraphs';
    const amount = clamp(opts.amount, 1, UNIT_LIMITS[unit], 3);
    const length = ['short', 'medium', 'long'].indexOf(opts.length) !== -1 ? opts.length : 'medium';
    const style = opts.style === 'standard' ? 'standard' : 'classic';
    const format = ['plain', 'html', 'markdown'].indexOf(opts.format) !== -1 ? opts.format : 'plain';
    const listType = opts.list === 'ol' ? 'ol' : 'ul';
    const start = opts.start !== false;
    const wrap = opts.wrap !== false;
    const next = makeCycle(start);
    let blocks = [];

    if (unit === 'paragraphs') {
      for (let p = 0; p < amount; p++) {
        const sentences = [];
        const range = PARA_LEN[length];
        const count = ri(range[0], range[1]);
        for (let s = 0; s < count; s++) {
          sentences.push(style === 'standard' ? next() : classicSentence(6, 15));
        }
        if (start && p === 0) sentences[0] = OPENER;
        blocks.push(sentences.join(' '));
      }
    } else if (unit === 'sentences') {
      for (let s = 0; s < amount; s++) blocks.push(style === 'standard' ? next() : classicSentence(6, 15));
    } else if (unit === 'words') {
      const words = [];
      if (style === 'standard') {
        while (words.length < amount) words.push.apply(words, next().split(/\s+/));
      } else {
        words.push.apply(words, OPENER.split(' '));
        while (words.length < amount) words.push.apply(words, classicSentence(6, 15).split(' '));
      }
      blocks.push(wordsToText(words, amount));
    } else {
      for (let i = 0; i < amount; i++) blocks.push(loremItem(next, { style: style, length: length }, i));
      if (format === 'html') {
        return '<' + listType + '>\n' + blocks.map(function (b) { return '  <li>' + b + '</li>'; }).join('\n') + '\n</' + listType + '>';
      }
      const marker = format === 'markdown' ? '- ' : (format === 'plain' ? '\u2022 ' : '');
      const numbered = format !== 'html' && listType === 'ol';
      return blocks.map(function (b, i) {
        return (numbered ? (i + 1) + '. ' : marker) + b;
      }).join('\n');
    }

    if (format === 'html') {
      return blocks.map(function (b) { return wrap ? '<p>' + b + '</p>' : b; }).join(wrap ? '\n' : '\n\n');
    }
    return blocks.join('\n\n');
  }

  /* ------------------------------------------------------------------ *
   * 08 — Bionic Reading Converter
   * ------------------------------------------------------------------ */
  const BIONIC_RATIO = [0, 0.2, 0.3, 0.42, 0.55, 0.7];
  const BIONIC_LEVEL_NOTE = ['', 'about 20%', 'about 30%', 'about 40%', 'about 55%', 'about 70%'];
  const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
  const NUM_RE = /^[\p{N}\p{M}]+$/u;
  const URL_RE = /^(https?:\/\/|www\.)/i;
  const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|uk|de|fr|edu|gov|info|biz|dev|app|ai)$/i;
  const APOS_RE = /^['’]$/;
  const VIRAMA_CODES = [0x094D, 0x09CD, 0x0A4D, 0x0ACD, 0x0B4D, 0x0BCD, 0x0C4D, 0x0CCD, 0x0D4D, 0x0DCA, 0x0E3A, 0x1039, 0x17D2];
  const VIRAMA_RE = new RegExp('[' + VIRAMA_CODES.map(function (c) { return '\\u{' + c.toString(16) + '}'; }).join('') + ']$', 'u');

  function graphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function (s) { return s.segment; });
    }
    return Array.from(text);
  }

  function cutAt(word, ratio) {
    const gs = graphemes(word);
    const letters = gs.filter(function (g) { return !APOS_RE.test(g); });
    const wanted = Math.max(1, Math.round(letters.length * ratio));
    let consumed = 0;
    let index = 0;
    for (let i = 0; i < gs.length; i++) {
      if (APOS_RE.test(gs[i])) continue;
      consumed++;
      index += gs[i].length;
      if (consumed >= wanted) {
        while (i + 1 < gs.length && VIRAMA_RE.test(gs[i + 1])) { i++; index += gs[i].length; }
        break;
      }
    }
    return index;
  }

  function bionicParse(text, options) {
    const opts = options || {};
    const level = clamp(opts.level, 1, 5, 3);
    const sacc = clamp(opts.sacc, 1, 3, 1);
    const ratio = BIONIC_RATIO[level];
    const chunks = str(text).match(/\S+/g) || [];
    const out = [];
    let idx = 0;
    chunks.forEach(function (chunk) {
      const isLink = URL_RE.test(chunk) || MAIL_RE.test(chunk) || DOMAIN_RE.test(chunk);
      if (isLink) { out.push({ t: 0, v: chunk }); return; }
      let last = 0;
      const re = new RegExp(WORD_RE.source, 'gu');
      let match;
      while ((match = re.exec(chunk)) !== null) {
        if (match.index > last) out.push({ t: 0, v: chunk.slice(last, match.index) });
        const word = match[0];
        if (NUM_RE.test(word)) {
          out.push({ t: 0, v: word });
        } else {
          idx++;
          if (idx % sacc === 0) {
            const cut = cutAt(word, ratio);
            out.push({ t: 1, b: word.slice(0, cut), r: word.slice(cut) });
          } else {
            out.push({ t: 0, v: word });
          }
        }
        last = match.index + word.length;
      }
      if (last < chunk.length) out.push({ t: 0, v: chunk.slice(last) });
    });
    return out;
  }

  function escapeHtml(text) {
    return str(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function bionicToHtml(text, options) {
    const parts = bionicParse(text, options);
    return parts.map(function (p) {
      return p.t === 1 ? '<b>' + escapeHtml(p.b) + '</b>' + escapeHtml(p.r) : escapeHtml(p.v);
    }).join('');
  }

  function bionicToMarkdown(text, options) {
    const parts = bionicParse(text, options);
    function md(value) { return str(value).replace(/([\\*_`])/g, '\\$1'); }
    return parts.map(function (p) {
      return p.t === 1 ? '**' + md(p.b) + '**' + md(p.r) : md(p.v);
    }).join('');
  }

  function bionicStats(text, options) {
    const parts = bionicParse(text, options);
    const bold = parts.filter(function (p) { return p.t === 1; }).length;
    const words = countWords(text);
    return { bold: bold, words: words, minutes: Math.max(1, Math.ceil(words / 200)) };
  }

  /* ------------------------------------------------------------------ *
   * 09 — AP Case Converter
   * ------------------------------------------------------------------ */
  const AP_SHORT_WORDS = ['a', 'an', 'and', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'];
  const AP_MONTHS = {
    January: 'Jan.', February: 'Feb.', March: 'March', April: 'April', May: 'May', June: 'June',
    July: 'July', August: 'Aug.', September: 'Sept.', October: 'Oct.', November: 'Nov.', December: 'Dec.'
  };
  const AP_STATES = {
    Alabama: 'Ala.', Alaska: 'Alaska', Arizona: 'Ariz.', Arkansas: 'Ark.', California: 'Calif.',
    Colorado: 'Colo.', Connecticut: 'Conn.', Delaware: 'Del.', Florida: 'Fla.', Georgia: 'Ga.',
    Hawaii: 'Hawaii', Idaho: 'Idaho', Illinois: 'Ill.', Indiana: 'Ind.', Iowa: 'Iowa', Kansas: 'Kan.',
    Kentucky: 'Ky.', Louisiana: 'La.', Maine: 'Maine', Maryland: 'Md.', Massachusetts: 'Mass.',
    Michigan: 'Mich.', Minnesota: 'Minn.', Mississippi: 'Miss.', Missouri: 'Mo.', Montana: 'Mont.',
    Nebraska: 'Neb.', Nevada: 'Nev.', 'New Hampshire': 'N.H.', 'New Jersey': 'N.J.', 'New Mexico': 'N.M.',
    'New York': 'N.Y.', 'North Carolina': 'N.C.', 'North Dakota': 'N.D.', Ohio: 'Ohio', Oklahoma: 'Okla.',
    Oregon: 'Ore.', Pennsylvania: 'Pa.', 'Rhode Island': 'R.I.', 'South Carolina': 'S.C.',
    'South Dakota': 'S.D.', Tennessee: 'Tenn.', Texas: 'Texas', Utah: 'Utah', Vermont: 'Vt.',
    Virginia: 'Va.', Washington: 'Wash.', 'West Virginia': 'W.Va.', Wisconsin: 'Wis.', Wyoming: 'Wyo.'
  };
  const AP_NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  function regexEscape(value) { return str(value).replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&'); }

  function apCaseConvert(text, options) {
    const opts = options || {};
    let out = str(text);
    // Rule 1: title-case every ASCII word.
    if (opts.titleCase !== false) {
      out = out.replace(/\w+/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); });
      // Rule 2: lowercase short words (nested inside title case in the reference).
      if (opts.lowercaseShortWords !== false) {
        AP_SHORT_WORDS.forEach(function (word) {
          const re = new RegExp('(?<!^|\\. )\\b' + word + '\\b', 'gi');
          out = out.replace(re, word.toLowerCase());
        });
      }
    }
    // Rule 3: capitalize first word of sentences (period only, as in source).
    if (opts.capitalizeFirstWord !== false) {
      out = out.replace(/(?:^|\.\s+)(.)/g, function (m) { return m.toUpperCase(); });
    }
    // Rule 4: AP month abbreviations.
    if (opts.monthAbbreviations !== false) {
      Object.keys(AP_MONTHS).forEach(function (month) {
        out = out.replace(new RegExp('\\b' + month + '\\b', 'gi'), AP_MONTHS[month]);
      });
    }
    // Rule 5: AP state abbreviations (longest names first so "New York" wins).
    if (opts.stateAbbreviations !== false) {
      Object.keys(AP_STATES).sort(function (a, b) { return b.length - a.length; }).forEach(function (state) {
        out = out.replace(new RegExp('\\b' + regexEscape(state) + '\\b', 'gi'), AP_STATES[state]);
      });
    }
    // Rule 6: AP numeral rule (single digits 0-9 become words).
    if (opts.numerals !== false) {
      out = out.replace(/\b(\d+)\b/g, function (m, n) {
        const value = parseInt(n, 10);
        return value < 10 ? AP_NUMBER_WORDS[value] : m;
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 10 — Remove Extra Spaces
   * ------------------------------------------------------------------ */
  function removeExtraSpaces(text) { return str(text).replace(/\s+/g, ' ').trim(); }

  /* ------------------------------------------------------------------ *
   * 11 — Find and Replace
   * ------------------------------------------------------------------ */
  function findAndReplace(text, find, replace, caseSensitive) {
    const src = str(text);
    const f = str(find);
    const r = str(replace);
    if (caseSensitive) return src.split(f).join(r); // literal, all occurrences
    const re = new RegExp(f, 'gi'); // reference treats Find as a live regex in this mode
    return src.replace(re, r);
  }

  /* ------------------------------------------------------------------ *
   * 12 — Remove Emojis (exact reference Unicode ranges)
   * ------------------------------------------------------------------ */
  const EMOJI_RANGE_SOURCE = [
    [0x1F300, 0x1F5FF], [0x1F600, 0x1F64F], [0x1F680, 0x1F6FF], [0x1F700, 0x1F77F],
    [0x1F780, 0x1F7FF], [0x1F800, 0x1F8FF], [0x1F900, 0x1F9FF], [0x1FA00, 0x1FA6F],
    [0x1FA70, 0x1FAFF], [0x2600, 0x26FF], [0x2700, 0x27BF], [0x2300, 0x23FF],
    [0xFE00, 0xFE0F], [0x1F000, 0x1F02F], [0x1F0A0, 0x1F0FF], [0x1F100, 0x1F64F],
    [0x1FB00, 0x1FBFF], [0x1FC00, 0x1FCFF], [0x1FD00, 0x1FDFF], [0x1FE00, 0x1FEFF],
    [0x1FF00, 0x1FFFF]
  ].map(function (pair) {
    const slash = String.fromCharCode(92);
    return slash + 'u{' + pair[0].toString(16).toUpperCase() + '}-' + slash + 'u{' + pair[1].toString(16).toUpperCase() + '}';
  }).join('');
  const EMOJI_RE = new RegExp('[' + EMOJI_RANGE_SOURCE + ']+', 'gu');
  function removeEmojis(text) { return str(text).replace(EMOJI_RE, ''); }

  /* ------------------------------------------------------------------ *
   * 13 — Text to List Converter
   * ------------------------------------------------------------------ */
  function textToList(text, options) {
    const opts = options || {};
    let input = str(text).trim();
    let items;
    const separator = str(opts.separator);
    if (opts.split === 'comma') {
      items = input.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
    } else if (opts.split === 'custom') {
      if (!separator) return { error: 'custom-separator' };
      items = input.split(separator).map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
    } else {
      items = input.split('\n').filter(function (x) { return x.trim() !== ''; });
    }
    if (!items.length) return { error: 'no-items' };
    const format = opts.format || 'bullet';
    const prefix = str(opts.prefix);
    const lines = items.map(function (item, i) {
      if (format === 'numbered') return (i + 1) + '. ' + item;
      if (format === 'dash') return '- ' + item;
      if (format === 'custom') return prefix + ' ' + item;
      return '\u2022 ' + item; // bullet
    });
    return { text: lines.join('\n'), items: items };
  }

  /* ------------------------------------------------------------------ *
   * 14 — Text Filter (highlight + remove)
   * ------------------------------------------------------------------ */
  function applyFilter(text, highlightWords, removeWords) {
    let output = str(text);
    function list(value) { return str(value).split(',').map(function (w) { return w.trim(); }).filter(function (w) { return w !== ''; }); }
    function pattern(word) { return '\\b' + regexEscape(word) + '\\b'; }
    list(removeWords).forEach(function (word) {
      output = output.replace(new RegExp(pattern(word), 'gi'), '');
    });
    const segments = [{ text: output, hit: false }];
    list(highlightWords).forEach(function (word) {
      const re = new RegExp('(' + pattern(word) + ')', 'gi');
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.hit) continue;
        const pieces = seg.text.split(re);
        const rebuilt = [];
        pieces.forEach(function (piece, index) {
          if (!piece) return;
          rebuilt.push(index % 2 === 1 ? { text: piece, hit: true } : { text: piece, hit: false });
        });
        segments.splice.apply(segments, [i, 1].concat(rebuilt));
        i += rebuilt.length - 1;
      }
    });
    return segments.filter(function (s) { return s.text !== ''; });
  }

  /* ------------------------------------------------------------------ *
   * 01 — Text Cleaner (ordered transform pipeline)
   * ------------------------------------------------------------------ */
  const CLEAN_HTML_ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
  const CLEAN_SHORTHAND = {
    'w/': 'with', 'w/o': 'without', 'b/c': 'because', 'b4': 'before', 'btw': 'between',
    'yr': 'year', 'yrs': 'years', 'u': 'you', 'ur': 'your', 'r': 'are', 'n': 'and',
    'thx': 'thanks', 'pls': 'please'
  };

  function decodeEntitiesSafe(text) {
    return str(text)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&#0*39;/g, "'").replace(/&amp;/g, '&');
  }

  function cleanText(text, options) {
    const opts = options || {};
    let out = str(text);
    const original = out;
    function on(key) { return opts[key] === true; }
    const n = function (key, fallback) { return clamp(opts[key], 0, 1000, fallback); };

    // Whitespace (order mirrors the reference application source).
    if (on('trim')) { out = out.trim(); }
    if (on('removeLeadingSpaces')) out = out.replace(/^[ \t]+/gm, '');
    if (on('removeTrailingSpaces')) out = out.replace(/[ \t]+$/gm, '');
    if (on('replaceSpacesWithTab')) out = out.replace(new RegExp(' '.repeat(n('spacesToTab', 4)), 'g'), '\t');
    if (on('replaceTabWithSpaces')) out = out.replace(/\t/g, ' '.repeat(n('tabToSpaces', 4)));
    if (on('removeBlankLines')) out = out.replace(/^\s*[\r\n]/gm, '');
    if (on('replaceLineBreakWithSpace')) out = out.replace(/\r?\n/g, ' ');
    if (on('multipleSpacesToSingle')) out = out.replace(/[ \t]+/g, ' ');
    if (on('multipleBlankLinesToSingle')) out = out.replace(/\n\s*\n\s*\n/g, '\n\n');
    if (on('removeAllLineBreaks')) out = out.replace(/\r?\n/g, '');

    // Characters.
    if (on('removePunctuation')) out = out.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    if (on('stripEmojis')) out = out.replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '');
    if (on('removeAccents')) out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (on('normalizeUnicode')) out = out.normalize('NFKC');
    if (on('removeReplacement')) out = out.replace(/\uFFFD/g, '');
    if (on('removeNonAscii')) out = out.replace(/[^\x00-\x7F]/g, '');
    if (on('removeNonAlphanumeric')) out = out.replace(/[^a-zA-Z0-9\s]/g, '');

    // HTML and decoding.
    if (on('unescapeHtml')) {
      out = out.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, function (m) { return CLEAN_HTML_ENTITIES[m]; });
    }
    if (on('stripHtmlTags')) out = out.replace(/<[^>]*>/g, '');
    if (on('removeIds')) out = out.replace(/\s+id\s*=\s*["'][^"']*["']/gi, '');
    if (on('removeClasses')) out = out.replace(/\s+class\s*=\s*["'][^"']*["']/gi, '');
    if (on('removeInlineStyles')) out = out.replace(/\s+style\s*=\s*["'][^"']*["']/gi, '');
    if (on('decodeHtmlEntities')) out = decodeEntitiesSafe(out);
    if (on('decodeUrlEncoded')) { try { out = decodeURIComponent(out); } catch (e) { /* leave unchanged */ } }

    // Others & links.
    if (on('stripEmails')) out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');
    if (on('removeBbCode')) out = out.replace(/\[\/?[a-z0-9=\s"',;:()]*\]/gi, '');
    if (on('removeWebUrls')) out = out.replace(/(https?:\/\/[^\s]+)/g, '');
    else if (on('convertUrlsToLinks')) out = out.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');

    // Text formatting.
    const letterCase = opts.letterCase || 'noChange';
    if (letterCase === 'uppercase') out = out.toUpperCase();
    else if (letterCase === 'lowercase') out = out.toLowerCase();
    else if (letterCase === 'sentenceCase') out = out.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, function (m) { return m.toUpperCase(); });
    else if (letterCase === 'capitalizeWords') out = out.replace(/\b\w/g, function (m) { return m.toUpperCase(); });

    if (on('removeDuplicateLines')) out = Array.from(new Set(out.split('\n'))).join('\n');
    if (on('removeRepeatingWords')) out = out.replace(/\b(\w+)\s+\1\b/gi, '$1');
    if (on('trimLeft')) out = out.slice(n('trimLeftChars', 3));
    if (on('trimRight')) out = out.slice(0, -n('trimRightChars', 3));
    if (on('smartToRegular')) out = out.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    if (on('regularToSmart')) out = out.replace(/'/g, '\u2019').replace(/"/g, '\u201D');
    if (on('fixSpacesAfterPunctuation')) out = out.replace(/([.!?;:,])(?![\s\n])/g, '$1 ');
    if (on('convertShorthand')) {
      const keys = Object.keys(CLEAN_SHORTHAND);
      out = out.replace(new RegExp('\\b(' + keys.join('|') + ')\\b', 'gi'), function (m) { return CLEAN_SHORTHAND[m.toLowerCase()] || m; });
    }

    return { text: out, changed: out !== original };
  }

  /* ------------------------------------------------------------------ *
   * 06 — Word Counter (Unicode-aware counting)
   * ------------------------------------------------------------------ */
  const WORDY = /[\p{L}\p{N}]/u;
  const TRIM_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
  const SENT_END = /[.!?…‽。！？।॥؟]+["'”’)\]\»」』）]*$/;
  const HARD_END = /[!?…‽。！？।॥؟]$/;
  const CJK_SPLIT = /([\u3002\uFF01\uFF1F][\u300D\u300F\uFF09\u201D]*)(?=\S)/g;
  const NO_SPACE_SCRIPT = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Thai}|\p{Script=Lao}|\p{Script=Khmer}|\p{Script=Myanmar}/u;
  const ABBR_NEVER = new Set('mr mrs ms dr prof sr jr st mt rev hon gen sen rep gov capt lt col sgt cmdr fr vs v no nos fig figs approx dept vol pp ft e.g i.e cf u.s u.k u.n u.s.a al'.split(' '));
  const ABBR_SOFT = new Set('etc inc ltd co corp llc bros jan feb mar apr jun jul aug sep sept oct nov dec a.m p.m'.split(' '));
  const STOP = new Set(('a about above after again against all almost also am among an and another any are aren\'t around as at be because been before being below between both but by can can\'t cannot could couldn\'t did didn\'t do does doesn\'t doing don\'t down during each few for from further had hadn\'t has hasn\'t have haven\'t having he he\'d he\'ll he\'s her here here\'s hers herself him himself his how how\'s i i\'d i\'ll i\'m i\'ve if in into is isn\'t it it\'s its itself just let\'s me more most mustn\'t my myself no nor not of off on once only or other ought our ours ourselves out over own same shan\'t she she\'d she\'ll she\'s should shouldn\'t so some such than that that\'s the their theirs them themselves then there there\'s these they they\'d they\'ll they\'re they\'ve this those through to too under until up very was wasn\'t we we\'d we\'ll we\'re we\'ve were weren\'t what what\'s when when\'s where where\'s which while who who\'s whom why why\'s with won\'t would wouldn\'t you you\'d you\'ll you\'re you\'ve your yours yourself yourselves').split(' '));

  function graphemeCount(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str(text))).length;
    }
    return Array.from(str(text)).length;
  }

  function normalizeToken(token) {
    return str(token).replace(/[‘’ʼ]/g, "'").replace(TRIM_EDGES, '');
  }

  function rawTokens(text) {
    const result = [];
    str(text).split(/\r\n?|\n/).forEach(function (line) {
      const spaced = line.replace(CJK_SPLIT, '$1 ');
      spaced.split(/\s+/).forEach(function (raw) {
        const token = str(raw).replace(/[‘’ʼ]/g, "'");
        if (token) result.push(token);
      });
    });
    return result;
  }

  function tokenize(text) {
    return rawTokens(text).map(normalizeToken).filter(function (token) { return WORDY.test(token); });
  }

  function endsSentence(token, next) {
    if (!SENT_END.test(token)) return false;
    if (HARD_END.test(token)) return true;
    const base = token.toLowerCase().replace(/[^a-z']/g, '');
    if (ABBR_NEVER.has(base)) return false;
    if (ABBR_SOFT.has(base)) return !!next && /^\p{Lu}/u.test(next);
    return true;
  }

  function countSentences(text) {
    const tokens = rawTokens(text);
    if (!tokens.length) return 0;
    let count = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (endsSentence(tokens[i], tokens[i + 1])) count++;
    }
    return count || 1;
  }

  function wordCounterAnalyze(text, options) {
    const opts = options || {};
    const source = str(text);
    const lines = source.split(/\r\n?|\n/);
    const tokens = tokenize(source);
    const words = tokens.length;
    const lower = tokens.map(function (t) { return t.toLowerCase(); });
    const uniqueWords = new Set(lower).size;
    const letters = (source.match(/\p{L}/gu) || []).length;
    const alnum = (source.match(/[\p{L}\p{N}]/gu) || []).length;
    const noSpace = graphemeCount(source.replace(/\s+/g, ''));
    const paragraphs = lines.filter(function (line) { return WORDY.test(line); }).length;
    const sentences = countSentences(source);
    const avgWordLength = words ? Math.round((alnum / words) * 10) / 10 : 0;
    return {
      words: words,
      characters: graphemeCount(source),
      charactersNoSpaces: noSpace,
      letters: letters,
      uniqueWords: uniqueWords,
      avgWordLength: avgWordLength,
      sentences: sentences,
      paragraphs: paragraphs,
      readingSeconds: words ? Math.max(1, Math.round(words / 238 * 60)) : 0,
      speakingSeconds: words ? Math.max(1, Math.round(words / 150 * 60)) : 0,
      density: keywordDensity(tokens, opts.n || 1, opts.ignore !== false)
    };
  }

  function keywordDensity(tokens, n, ignore) {
    const want = clamp(n, 1, 3, 1);
    const counts = new Map();
    let total = 0;
    for (let i = 0; i + want <= tokens.length; i++) {
      const grams = tokens.slice(i, i + want);
      const first = grams[0].toLowerCase();
      const last = grams[grams.length - 1].toLowerCase();
      if (ignore && (STOP.has(first) || STOP.has(last))) continue;
      if (want === 1 && !/[^0-9.,]/.test(first)) continue;
      const key = grams.join(' ').toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
    const threshold = want > 1 ? 2 : 1;
    const rows = Array.from(counts, function (entry) {
      return { keyword: entry[0], count: entry[1], density: tokens.length ? (entry[1] * want / tokens.length) * 100 : 0 };
    }).filter(function (row) { return row.count >= threshold; })
      .sort(function (a, b) { return b.count - a.count || a.keyword.localeCompare(b.keyword); }).slice(0, 10);
    const top = rows.length ? rows[0].density : 0;
    rows.forEach(function (row) { row.bar = top ? Math.round((row.density / top) * 100) : 0; });
    return rows;
  }

  /* ------------------------------------------------------------------ *
   * 05 — Redact Text (stable labels, custom terms, restore, key export)
   * ------------------------------------------------------------------ */
  const REDACT_TAGS = ['NAME', 'EMAIL', 'PHONE', 'ADDRESS', 'CARD', 'SSN', 'API_KEY', 'TOKEN', 'PASSWORD', 'SECRET', 'IP', 'USER', 'URL', 'DOMAIN', 'DATE', 'TERM'];
  const REDACT_DEFAULT_CATS = { name: true, email: true, phone: true, address: true, money: true, id: true, secret: true, net: true, user: true, url: false, date: false };
  const CAT_OF_TAG = {
    NAME: 'name', EMAIL: 'email', PHONE: 'phone', ADDRESS: 'address',
    CARD: 'money', CVV: 'money', EXPIRY: 'money', IBAN: 'money', ROUTING: 'money', ACCOUNT: 'money',
    SSN: 'id', ID: 'id', DOB: 'id',
    API_KEY: 'secret', TOKEN: 'secret', PRIVATE_KEY: 'secret', PASSWORD: 'secret', SECRET: 'secret',
    IP: 'net', MAC: 'net', USER: 'user', URL: 'url', DOMAIN: 'url', DATE: 'date', TERM: 'term'
  };

  function luhnValid(digits) {
    const d = str(digits).replace(/\D/g, '');
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = parseInt(d.charAt(i), 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function redactDetect(text, options) {
    const opts = options || {};
    const cats = Object.assign({}, REDACT_DEFAULT_CATS, opts.cats || {});
    const found = [];
    function add(tag, match, start) {
      const cat = CAT_OF_TAG[tag] || 'secret';
      if (cats[cat] === false) return;
      found.push({ tag: tag, cat: cat, value: match, start: start, length: match.length, priority: tag === 'TOKEN' || tag === 'PASSWORD' ? 86 : (tag === 'NAME' ? 46 : 60) });
    }
    function scan(re, tag) {
      const rx = new RegExp(re.source, re.flags.indexOf('g') !== -1 ? re.flags : re.flags + 'g');
      let m;
      while ((m = rx.exec(text)) !== null) { add(tag, m[0], m.index); if (m[0].length === 0) rx.lastIndex++; }
    }
    scan(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, 'PRIVATE_KEY');
    scan(/\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, 'API_KEY');
    scan(/\bgh[pousr]_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b|\bxox[abposre]-[A-Za-z0-9-]{10,}\b/g, 'TOKEN');
    scan(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bnpm_[A-Za-z0-9]{20,}\b/g, 'API_KEY');
    scan(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'TOKEN');
    scan(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'EMAIL');
    scan(/\b(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}\b/g, 'PHONE');
    scan(/\b(?:\d[ -]?){13,19}\b/g, 'CARD');
    scan(/\b\d{3}-\d{2}-\d{4}\b/g, 'SSN');
    scan(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP');
    scan(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|uk|de|fr|edu|gov)\b/gi, 'DOMAIN');
    scan(/https?:\/\/[^\s<>"']+/g, 'URL');
    const assignment = /(?:^|[\s,;{])([A-Za-z_][\w.-]*(?:key|token|secret|password|passwd|pwd|auth))["']?\s*[:=]\s*["']?([^\s,;"'}]{4,})/gi;
    let m;
    while ((m = assignment.exec(text)) !== null) add('PASSWORD', m[2], m.index + m[0].indexOf(m[2]));
    found.forEach(function (item) {
      if (item.tag === 'CARD' && !luhnValid(item.value)) item.reject = true;
    });
    const terms = str(opts.words || '').split(/[\n,]/).map(function (w) { return w.trim(); }).filter(Boolean);
    terms.forEach(function (term) {
      const re = new RegExp(term.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&'), 'gi');
      let t;
      while ((t = re.exec(text)) !== null) add('TERM', t[0], t.index);
    });
    return found.filter(function (f) { return !f.reject; });
  }

  function redactBuild(text, options) {
    const opts = options || {};
    const candidates = redactDetect(text, opts);
    candidates.sort(function (a, b) { return b.priority - a.priority || b.length - a.length || a.start - b.start; });
    const taken = [];
    candidates.forEach(function (c) {
      const end = c.start + c.length;
      const overlap = taken.some(function (t) { return c.start < t.end && end > t.start; });
      if (!overlap) taken.push({ start: c.start, end: end, tag: c.tag, value: c.value });
    });
    taken.sort(function (a, b) { return a.start - b.start; });
    const style = opts.style || 'label';
    const counters = {};
    const entries = [];
    const keys = {};
    function normalize(cat, value) {
      if (['EMAIL', 'TERM', 'DOMAIN', 'USER', 'IP', 'URL'].indexOf(cat) !== -1) return value.toLowerCase();
      if (['PHONE', 'CARD', 'SSN'].indexOf(cat) !== -1) return value.replace(/\D/g, '');
      return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    }
    function fakeFor(tag, n) {
      if (tag === 'EMAIL') return 'user' + n + '@example.com';
      if (tag === 'PHONE') return '(555) 555-' + String(1000 + n).slice(-4);
      if (tag === 'NAME') return 'Jordan Blake';
      if (tag === 'CARD') return '4000 0000 0000 ' + String(n).padStart(4, '0').slice(-4);
      if (tag === 'IP') return '192.0.2.' + (n % 255);
      return 'FAKE_' + tag + '_' + n;
    }
    let out = '', cursor = 0;
    taken.forEach(function (item) {
      out += text.slice(cursor, item.start);
      const key = item.tag + '|' + normalize(item.tag, item.value);
      let n = keys[key];
      if (!n) { n = (counters[item.tag] = (counters[item.tag] || 0) + 1); keys[key] = n; }
      const label = '[' + item.tag + '_' + n + ']';
      let replacement;
      if (style === 'bars') replacement = '\u2588\u2588\u2588\u2588\u2588';
      else if (style === 'fake') replacement = fakeFor(item.tag, n);
      else replacement = label;
      entries.push({ label: label, type: item.tag.toLowerCase(), value: item.value, fake: style === 'fake' ? replacement : '' });
      out += replacement;
      cursor = item.end;
    });
    out += text.slice(cursor);
    return { text: out, entries: entries, found: taken.length, style: style };
  }

  function redactRestore(text, entries) {
    if (!Array.isArray(entries)) return { text: str(text), unknown: 0 };
    const source = str(text);
    const byLabel = new Map();
    entries.forEach(function (e) { byLabel.set(e.label, e.value); if (e.fake) byLabel.set(e.fake, e.value); });
    const names = Array.from(new Set(entries.map(function (e) { return e.type.toUpperCase(); })));
    const labelRx = new RegExp('\\[(' + names.join('|') + ')_(\\d+)\\]', 'gi');
    let unknown = 0;
    let out = source.replace(labelRx, function (full) {
      if (byLabel.has(full.toUpperCase())) return byLabel.get(full.toUpperCase());
      if (byLabel.has(full)) return byLabel.get(full);
      unknown++;
      return full;
    });
    entries.forEach(function (e) {
      if (e.fake && out.indexOf(e.fake) !== -1) out = out.split(e.fake).join(e.value);
    });
    const hasBars = out.indexOf('\u2588\u2588\u2588\u2588\u2588') !== -1;
    return { text: out, unknown: unknown, hasBars: hasBars };
  }

  /* ------------------------------------------------------------------ *
   * 04 — Bank Statement Converter (text/CSV statement parsing)
   * ------------------------------------------------------------------ */
  const BANK_DATE_RE = /(?<![\w.,/-])(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})(?![\w]|[.,/-]\d)|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,?\s+\d{4})?/gi;
  const BANK_MONEY_RE = /(?:US\$|C\$|A\$|R\$|[$£€₹]|Rs\.?|INR|USD|EUR|GBP)?\s*-?\(?\d{1,3}(?:[,'\u00a0\u202f]\d{3})+(?:\.\d{2})?\)?(?:\s*(?:CR|DR))?|(?:US\$|C\$|A\$|R\$|[$£€₹]|Rs\.?|INR|USD|EUR|GBP)?\s*-?\(?\d+(?:\.\d{2})?\)?(?:\s*(?:CR|DR))?/gi;

  function parseDateParts(raw, order) {
    const text = str(raw).trim();
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    let m = text.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
    if (m) {
      const month = months[m[1].toLowerCase().slice(0, 3)];
      if (month === undefined) return null;
      const year = m[3] ? parseInt(m[3], 10) : 2026;
      return padDate(year, month + 1, parseInt(m[2], 10));
    }
    m = text.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
    if (!m) return null;
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (m[1].length === 4) { y = a; a = b; b = parseInt(m[3], 10); order = 'ymd'; }
    if (a > 31 || b > 31) return null;
    let month, day;
    if (order === 'dmy') { day = a; month = b; }
    else if (order === 'ymd') { month = b; day = a; }
    else { month = a; day = b; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (y < 70) y += 2000; else if (y < 100) y += 1900;
    if (y < 1990 || y > 2100) return null;
    return padDate(y, month, day);
  }

  function padDate(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

  function parseMoney(raw) {
    let text = str(raw).trim();
    if (!text) return null;
    let negative = false;
    if (/^\(.*\)$/.test(text) || /(?:^|[\s-])DR$/i.test(text)) negative = true;
    text = text.replace(/[$£€₹]|USD|EUR|GBP|Rs\.?|^\(|\)$|\s*(?:CR|DR)$/gi, '').trim();
    let value;
    if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(text)) value = parseFloat(text.replace(/\./g, '').replace(',', '.'));
    else value = parseFloat(text.replace(/['\u00a0\u202f,\s]/g, ''));
    if (!Number.isFinite(value)) return null;
    if (/^-/.test(str(raw).trim())) negative = true;
    return negative ? -Math.abs(value) : value;
  }

  function parseStatement(text, options) {
    const opts = options || {};
    const order = opts.dateOrder || 'auto';
    const lines = str(text).split(/\r\n?|\n/);
    const rows = [];
    let moneyIn = 0, moneyOut = 0;
    const dateRx = new RegExp(BANK_DATE_RE.source, 'gi');
    lines.forEach(function (line, index) {
      const trimmed = line.trim();
      if (!trimmed) return;
      dateRx.lastIndex = 0;
      const dateMatch = dateRx.exec(trimmed);
      if (!dateMatch) return;
      const date = parseDateParts(dateMatch[0], order);
      if (!date) return;
      const rest = trimmed.slice(dateMatch.index + dateMatch[0].length).trim();
      const moneyMatches = rest.match(BANK_MONEY_RE);
      if (!moneyMatches || !moneyMatches.length) return;
      const amounts = moneyMatches.map(parseMoney).filter(function (n) { return n !== null; });
      if (!amounts.length) return;
      let amount, balance = null;
      if (amounts.length >= 2) { amount = amounts[0]; balance = amounts[amounts.length - 1]; }
      else amount = amounts[0];
      const desc = rest.replace(BANK_MONEY_RE, '').replace(/\s+/g, ' ').trim();
      if (amount > 0) moneyIn += amount; else moneyOut += Math.abs(amount);
      rows.push({ id: index + 1, date: date, description: desc || 'Transaction', amount: amount, balance: balance, page: 1 });
    });
    let running = null;
    rows.forEach(function (row) {
      if (row.balance !== null) { row.check = running === null ? null : (Math.abs((running + row.amount) - row.balance) < 0.005 ? 'ok' : 'bad'); running = row.balance; }
      else row.check = null;
    });
    const bad = rows.filter(function (r) { return r.check === 'bad'; }).length;
    return {
      rows: rows, totalIn: moneyIn, totalOut: moneyOut,
      check: !rows.length ? 'none' : (bad ? 'rows' : (running !== null ? 'ok' : 'none')),
      badRows: bad
    };
  }

  function csvEscape(value) {
    let v = str(value == null ? '' : value);
    if (/^[=+@\t\r]/.test(v)) v = "'" + v;
    if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function statementToCsv(rows) {
    const header = 'Date,Description,Amount,Balance';
    const body = rows.map(function (r) {
      return [r.date, r.description, r.amount.toFixed(2), r.balance === null ? '' : r.balance.toFixed(2)].map(csvEscape).join(',');
    });
    return '\uFEFF' + [header].concat(body).join('\r\n') + '\r\n';
  }

  function statementToQif(rows, type) {
    const out = ['!Type:' + (type === 'credit' ? 'CCard' : 'Bank')];
    rows.forEach(function (r) {
      const parts = String(r.date).split('-');
      out.push('D' + parts[1] + '/' + parts[2] + '/' + parts[0]);
      out.push('T' + r.amount.toFixed(2));
      out.push('P' + r.description);
      out.push('^');
    });
    return out.join('\n');
  }

  return {
    str: str,
    clamp: clamp,
    countWords: countWords,
    escapeHtml: escapeHtml,
    regexEscape: regexEscape,
    // 01 text cleaner
    cleanText: cleanText,
    CLEAN_SHORTHAND: CLEAN_SHORTHAND,
    // 07 lorem
    VOCAB: VOCAB,
    PASSAGE: PASSAGE,
    OPENER: OPENER,
    UNIT_LIMITS: UNIT_LIMITS,
    loremGenerate: loremGenerate,
    // 08 bionic
    BIONIC_RATIO: BIONIC_RATIO,
    BIONIC_LEVEL_NOTE: BIONIC_LEVEL_NOTE,
    bionicParse: bionicParse,
    bionicToHtml: bionicToHtml,
    bionicToMarkdown: bionicToMarkdown,
    bionicStats: bionicStats,
    cutAt: cutAt,
    // 09 ap case
    AP_MONTHS: AP_MONTHS,
    AP_STATES: AP_STATES,
    AP_SHORT_WORDS: AP_SHORT_WORDS,
    apCaseConvert: apCaseConvert,
    // 10
    removeExtraSpaces: removeExtraSpaces,
    // 11
    findAndReplace: findAndReplace,
    // 12
    EMOJI_RE: EMOJI_RE,
    removeEmojis: removeEmojis,
    // 13
    textToList: textToList,
    // 14
    applyFilter: applyFilter,
    // 06 word counter
    STOP: STOP,
    graphemeCount: graphemeCount,
    tokenize: tokenize,
    wordCounterAnalyze: wordCounterAnalyze,
    keywordDensity: keywordDensity,
    // 05 redact text
    REDACT_TAGS: REDACT_TAGS,
    REDACT_DEFAULT_CATS: REDACT_DEFAULT_CATS,
    luhnValid: luhnValid,
    redactDetect: redactDetect,
    redactBuild: redactBuild,
    redactRestore: redactRestore,
    // 04 bank statement converter (text/CSV)
    parseStatement: parseStatement,
    parseDateParts: parseDateParts,
    parseMoney: parseMoney,
    statementToCsv: statementToCsv,
    statementToQif: statementToQif
  };
});
