/* LetitEdit reference-tool runtime. Binds the faithful engines in
 * js/reference-core.js to the per-tool workspaces generated at build time.
 * All user content is written with textContent / DOM nodes — never innerHTML. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function $(id) { return document.getElementById(id); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function announce(node, message) {
    if (!node) return;
    node.textContent = message || '';
  }

  function copyText(text, statusNode, successMessage) {
    if (!text) { announce(statusNode, 'Nothing to copy.'); return; }
    function fallback() {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      announce(statusNode, ok ? (successMessage || 'Copied to clipboard.') : 'Copy was blocked by the browser. Select the output and copy manually.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        announce(statusNode, successMessage || 'Copied to clipboard.');
      }).catch(fallback);
    } else fallback();
  }

  function downloadFile(text, filename, mime, statusNode) {
    try {
      const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      announce(statusNode, 'Download started.');
    } catch (e) {
      announce(statusNode, 'Download is not supported in this browser.');
    }
  }

  function checked(id) { const el = $(id); return !!el && el.checked; }
  function value(id) { const el = $(id); return el ? el.value : ''; }
  function radioValue(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function setRadio(name, val) {
    const el = document.querySelector('input[name="' + name + '"][value="' + val + '"]');
    if (el) el.checked = true;
  }
  function readFile(file, onText, statusNode) {
    if (!file) return;
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) { announce(statusNode, 'File is too large. Choose a file under 5 MB.'); return; }
    const reader = new FileReader();
    reader.onerror = function () { announce(statusNode, 'The file could not be read. Please try another file.'); };
    reader.onload = function (event) { onText(String(event.target.result || '')); };
    reader.readAsText(file);
  }

  const TEXT_EXTENSIONS = /\.(txt|csv|tsv|md|markdown|json|log|xml|eml|yaml|yml|html|htm|ini|cfg|conf|properties|toml|sql|js|ts|py|rb|php|java|go|sh)$/i;

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('The file could not be read. Please try another file.')); };
      reader.onload = function (event) { resolve(event.target.result); };
      reader.readAsArrayBuffer(file);
    });
  }

  function readTextFile(file, maxBytes) {
    return new Promise(function (resolve, reject) {
      if (file.size > maxBytes) { reject(new Error('File is too large. Choose a file under ' + Math.round(maxBytes / (1024 * 1024)) + ' MB.')); return; }
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('The file could not be read. Please try another file.')); };
      reader.onload = function (event) {
        const text = String(event.target.result || '').replace(/^\uFEFF/, '');
        resolve({ name: file.name, kind: 'text', text: text, warning: '' });
      };
      reader.readAsText(file);
    });
  }

  function zipEntry(buffer, wanted) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 66000);
    for (let i = bytes.length - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This .docx file could not be opened as a ZIP archive.');
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    for (let n = 0; n < count && offset + 46 <= bytes.length; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (name === wanted) {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('The .docx archive has an invalid local header.');
        const localName = view.getUint16(localOffset + 26, true);
        const localExtra = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localName + localExtra;
        return { bytes: bytes.subarray(start, start + compressedSize), method: method };
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('The .docx archive does not contain ' + wanted + '.');
  }

  async function inflateEntry(entry) {
    if (entry.method === 0) return entry.bytes;
    if (entry.method !== 8) throw new Error('This .docx uses a compression method this browser cannot read locally.');
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress .docx files locally. Save the document as .txt or .md instead.');
    }
    const stream = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function docxXmlToText(xml) {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length) throw new Error('The .docx document.xml could not be parsed.');
    const paragraphs = parsed.getElementsByTagNameNS('*', 'p');
    if (!paragraphs.length) return '';
    function collect(node) {
      let out = '';
      Array.prototype.forEach.call(node.childNodes || [], function (child) {
        const local = child.localName || '';
        if (child.nodeType === 3) out += child.nodeValue || '';
        else if (local === 'tab') out += '\t';
        else if (local === 'br' || local === 'cr') out += '\n';
        else out += collect(child);
      });
      return out;
    }
    return Array.prototype.map.call(paragraphs, collect).join('\n');
  }

  async function readDocumentFile(file, statusNode, options) {
    if (!file) return null;
    const opts = options || {};
    const name = String(file.name || '');
    const lower = name.toLowerCase();
    const maxBytes = opts.maxBytes || 5 * 1024 * 1024;
    if (/\.pdf$/i.test(lower)) {
      throw new Error('PDF files cannot be parsed reliably in this browser tool. Export the pages as .txt, .csv or .docx first; no formatting would be preserved by a local guess.');
    }
    if (/\.doc$/i.test(lower)) {
      throw new Error('Legacy .doc files are not supported. Save the file as .docx, .txt, .csv or .md first.');
    }
    if (/\.docx$/i.test(lower)) {
      if (file.size > (opts.docxMaxBytes || 20 * 1024 * 1024)) throw new Error('DOCX files must be under 20 MB.');
      announce(statusNode, 'Reading DOCX text in your browser…');
      const buffer = await readArrayBuffer(file);
      const entry = zipEntry(buffer, 'word/document.xml');
      const data = await inflateEntry(entry);
      const xml = new TextDecoder().decode(data);
      const text = docxXmlToText(xml);
      if (!text.trim()) throw new Error('No readable text was found in this .docx file. It may contain only images or tables drawn as shapes.');
      return { name: name, kind: 'docx', text: text, warning: 'Only the text in the DOCX was extracted; tables, columns and styling are not preserved.' };
    }
    if (!TEXT_EXTENSIONS.test(lower)) {
      throw new Error('Unsupported file type. Use .txt, .csv, .md, .json or .docx; PDF and legacy .doc are not supported.');
    }
    return readTextFile(file, maxBytes);
  }

  const SAFE_PREVIEW_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'UL', 'OL', 'LI', 'A', 'IMG', 'BLOCKQUOTE', 'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'DIV', 'SPAN']);
  function safeUrl(value) {
    const text = String(value || '').trim();
    return /^(https?:|mailto:)/i.test(text) ? text : '';
  }
  function appendSafeHtml(source, target) {
    Array.prototype.forEach.call(source.childNodes || [], function (node) {
      if (node.nodeType === 3) { target.appendChild(document.createTextNode(node.nodeValue || '')); return; }
      if (node.nodeType !== 1) return;
      const tag = node.nodeName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED' || tag === 'SVG' || tag === 'FORM') return;
      if (tag === 'INPUT') {
        const type = String(node.getAttribute('type') || '').toLowerCase();
        if (type === 'checkbox') target.appendChild(document.createTextNode(node.hasAttribute('checked') ? '[x] ' : '[ ] '));
        return;
      }
      if (!SAFE_PREVIEW_TAGS.has(tag)) { appendSafeHtml(node, target); return; }
      const copy = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = safeUrl(node.getAttribute('href'));
        if (href) { copy.setAttribute('href', href); copy.setAttribute('rel', 'noopener noreferrer'); }
      } else if (tag === 'IMG') {
        const src = safeUrl(node.getAttribute('src'));
        if (src) copy.setAttribute('src', src);
        copy.setAttribute('alt', String(node.getAttribute('alt') || ''));
      }
      appendSafeHtml(node, copy);
      target.appendChild(copy);
    });
  }
  function renderSafeHtml(container, html) {
    container.textContent = '';
    if (!html || !html.trim()) return;
    const parsed = new DOMParser().parseFromString('<div id="safe-root">' + html + '</div>', 'text/html');
    const root = parsed.getElementById('safe-root');
    if (root) appendSafeHtml(root, container);
    else container.appendChild(document.createTextNode(html));
  }

  ready(function () {
    const configNode = $('tool-config');
    if (!configNode || !window.ReferenceCore) return;
    let config;
    try { config = JSON.parse(configNode.textContent); }
    catch (e) { return; }
    const R = window.ReferenceCore;
    const slug = config.slug;

    /* 07 — Lorem Ipsum Generator */
    if (slug === 'lorem-ipsum-generator') {
      const state = {
        unit: 'paragraphs', amount: 3, length: 'medium', style: 'classic',
        format: 'plain', list: 'ul', start: true, wrap: true, tab: 'preview'
      };
      let generated = '';
      const limits = R.UNIT_LIMITS;
      const amountInput = $('wli-amount');
      const preview = $('wli-preview');
      const source = $('wli-source');
      const status = $('wli-status');

      function maxFor(unit) { return limits[unit] || 100; }
      function syncMax() {
        const max = maxFor(state.unit);
        const amount = Number(amountInput.value);
        amountInput.max = String(max);
        if (!Number.isFinite(amount) || amount < 1) amountInput.value = '1';
        else if (amount > max) amountInput.value = String(max);
      }
      function setText(text) {
        generated = text;
        preview.textContent = text;
        source.textContent = text;
        const words = R.countWords(text);
        $('wli-words').textContent = words + ' word' + (words === 1 ? '' : 's');
        $('wli-chars').textContent = text.length + ' character' + (text.length === 1 ? '' : 's');
        $('wli-paras').textContent = text.split(/\n\s*\n/).filter(Boolean).length + ' paragraph(s)';
      }
      function generate(message) {
        state.amount = R.clamp(amountInput.value, 1, maxFor(state.unit), 3);
        amountInput.value = String(state.amount);
        setText(R.loremGenerate(state));
        if (message) announce(status, message);
      }
      function showTab(tab) {
        state.tab = tab;
        all('.tab').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === tab); });
        preview.hidden = tab !== 'preview';
        source.hidden = tab !== 'source';
      }
      all('.tab').forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
      all('[data-quick]').forEach(function (b) {
        b.addEventListener('click', function () {
          state.unit = b.getAttribute('data-quick');
          setRadio('wli-unit', state.unit);
          amountInput.value = b.getAttribute('data-n');
          syncMax();
          $('wli-length-group').hidden = state.unit === 'sentences' || state.unit === 'words';
          $('wli-list-group').hidden = state.unit !== 'list';
          generate();
        });
      });
      $('wli-minus').addEventListener('click', function () { amountInput.value = String(Math.max(1, Number(amountInput.value) - 1)); generate(); });
      $('wli-plus').addEventListener('click', function () { amountInput.value = String(Math.min(maxFor(state.unit), Number(amountInput.value) + 1)); generate(); });
      amountInput.addEventListener('change', generate);
      all('input[name="wli-unit"]').forEach(function (el) {
        el.addEventListener('change', function () {
          state.unit = radioValue('wli-unit');
          syncMax();
          $('wli-length-group').hidden = state.unit === 'sentences' || state.unit === 'words';
          $('wli-list-group').hidden = state.unit !== 'list';
          generate();
        });
      });
      ['wli-len', 'wli-style', 'wli-format', 'wli-list'].forEach(function (name) {
        all('input[name="' + name + '"]').forEach(function (el) {
          el.addEventListener('change', function () {
            state.length = radioValue('wli-len');
            state.style = radioValue('wli-style');
            state.format = radioValue('wli-format');
            state.list = radioValue('wli-list');
            generate();
          });
        });
      });
      $('wli-start').addEventListener('change', function () { state.start = checked('wli-start'); generate(); });
      $('wli-wrap').addEventListener('change', function () { state.wrap = checked('wli-wrap'); generate(); });
      $('wli-generate').addEventListener('click', function () { generate('Text generated.'); });
      $('wli-regenerate').addEventListener('click', function () { generate('New text generated.'); });
      $('wli-copy').addEventListener('click', function () { copyText(generated, status, 'Text copied to clipboard.'); });
      $('wli-download').addEventListener('click', function () {
        const ext = state.format === 'html' ? 'html' : (state.format === 'markdown' ? 'md' : 'txt');
        const mime = ext === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';
        downloadFile(generated, 'lorem-ipsum.' + ext, mime, status);
      });
      generate();
    }

    /* 08 — Bionic Reading Converter */
    if (slug === 'bionic-reading') {
      const SAMPLE = 'Reading becomes calmer when the most important part of each word is bold. This converter applies fixed fixation points so your eyes can find the shape of a word quickly. Try changing the strength and saccade options to see how the pattern changes.\n\nAll processing happens in your browser. Your text is never uploaded.';
      const KEY = 'wbr_state_v1';
      const state = { text: SAMPLE, level: 3, sacc: 1, fade: 100, font: 'sans', size: 18, lh: 1.7, theme: 'light' };
      const preview = $('br-preview');
      const status = $('br-status');

      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved && typeof saved === 'object') {
          state.text = typeof saved.text === 'string' ? saved.text : state.text;
          state.level = R.clamp(saved.level, 1, 5, 3);
          state.sacc = R.clamp(saved.sacc, 1, 3, 1);
          state.fade = R.clamp(saved.fade, 30, 100, 100);
          state.font = ['sans', 'serif', 'mono'].indexOf(saved.font) !== -1 ? saved.font : 'sans';
          state.size = R.clamp(saved.size, 14, 28, 18);
          state.lh = R.clamp(saved.lh, 1.3, 2.2, 1.7);
          state.theme = ['light', 'sepia', 'dark'].indexOf(saved.theme) !== -1 ? saved.theme : 'light';
        }
      } catch (e) { /* ignore stored state errors */ }

      const textInput = $('br-text');
      textInput.value = state.text;
      $('br-level-note').textContent = R.BIONIC_LEVEL_NOTE[state.level];
      setRadio('br-level', String(state.level));
      setRadio('br-sacc', String(state.sacc));
      setRadio('br-font', state.font);
      setRadio('br-theme', state.theme);
      $('br-fade').value = String(state.fade);
      $('br-size').value = String(state.size);
      $('br-line-height').value = String(state.lh);

      let saveTimer = null;
      function persist() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
          try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage may be blocked */ }
        }, 300);
      }
      function applyStyle(node) {
        node.className = 'bionic-text font-' + state.font + ' theme-' + state.theme;
        node.style.fontSize = state.size + 'px';
        node.style.lineHeight = String(Math.round(state.lh * 10) / 10);
        if (state.fade < 100) node.style.setProperty('--fade-opacity', String(state.fade / 100));
        else node.style.removeProperty('--fade-opacity');
      }
      function render() {
        preview.textContent = '';
        const parts = R.bionicParse(state.text, state);
        const wrapper = document.createElement('div');
        wrapper.className = 'bionic-text-inner';
        parts.forEach(function (p) {
          if (p.t === 1) {
            const b = document.createElement('b');
            b.textContent = p.b;
            wrapper.appendChild(b);
            const rest = document.createTextNode(p.r);
            if (state.fade < 100) {
              const span = document.createElement('span');
              span.className = 'bionic-fade';
              span.appendChild(rest);
              wrapper.appendChild(span);
            } else wrapper.appendChild(rest);
          } else wrapper.appendChild(document.createTextNode(p.v));
        });
        wrapper.style.whiteSpace = 'pre-wrap';
        preview.appendChild(wrapper);
        applyStyle(preview);
        const stats = R.bionicStats(state.text, state);
        $('br-count').textContent = stats.words + ' word' + (stats.words === 1 ? '' : 's');
        $('br-level-note').textContent = R.BIONIC_LEVEL_NOTE[state.level];
        $('br-fade-value').textContent = state.fade === 100 ? 'Off' : state.fade + '%';
        $('br-size-value').textContent = state.size + 'px';
        $('br-line-height-value').textContent = String(Math.round(state.lh * 10) / 10);
        $('br-stats').textContent = stats.bold + ' bold fixation point' + (stats.bold === 1 ? '' : 's') + ' · about ' + stats.minutes + ' min read';
        persist();
      }
      function htmlDocument() {
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Bionic Reading output</title>' +
          '<style>body{font-family:' + (state.font === 'mono' ? 'monospace' : state.font === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif') +
          ';font-size:' + state.size + 'px;line-height:' + Math.round(state.lh * 10) / 10 + ';max-width:760px;margin:40px auto;padding:0 20px;color:#111827}b{font-weight:700}' +
          (state.fade < 100 ? '.bionic-fade{opacity:' + (state.fade / 100) + '}' : '') + '</style></head><body><div>' +
          R.bionicToHtml(state.text, state).replace(/\n/g, '<br>') + '</div></body></html>';
      }
      textInput.addEventListener('input', function () { state.text = textInput.value; render(); });
      $('br-sample').addEventListener('click', function () { state.text = SAMPLE; textInput.value = SAMPLE; render(); });
      $('br-clear').addEventListener('click', function () { state.text = ''; textInput.value = ''; render(); });
      ['br-level', 'br-sacc', 'br-font', 'br-theme'].forEach(function (name) {
        all('input[name="' + name + '"]').forEach(function (el) {
          el.addEventListener('change', function () {
            state.level = R.clamp(radioValue('br-level'), 1, 5, 3);
            state.sacc = R.clamp(radioValue('br-sacc'), 1, 3, 1);
            state.font = radioValue('br-font');
            state.theme = radioValue('br-theme');
            render();
          });
        });
      });
      $('br-fade').addEventListener('input', function () { state.fade = R.clamp(value('br-fade'), 30, 100, 100); render(); });
      $('br-size').addEventListener('input', function () { state.size = R.clamp(value('br-size'), 14, 28, 18); render(); });
      $('br-line-height').addEventListener('input', function () { state.lh = R.clamp(value('br-line-height'), 1.3, 2.2, 1.7); render(); });
      $('br-copy').addEventListener('click', function () {
        if (!state.text) { announce(status, 'Nothing to copy.'); return; }
        copyText(R.bionicToHtml(state.text, state), status, 'Formatted text copied to clipboard.');
      });
      $('br-copy-html').addEventListener('click', function () { copyText(htmlDocument(), status, 'HTML copied to clipboard.'); });
      $('br-copy-md').addEventListener('click', function () { copyText(R.bionicToMarkdown(state.text, state), status, 'Markdown copied to clipboard.'); });
      $('br-download').addEventListener('click', function () { downloadFile(htmlDocument(), 'bionic-reading.html', 'text/html;charset=utf-8', status); });
      $('br-reading').addEventListener('click', function () { openReadingView(state, applyStyle); });
      render();
    }

    /* 09 — AP Case Converter */
    if (slug === 'ap-case-converter') {
      const status = $('ap-status');
      function options() {
        return {
          titleCase: checked('ap-titleCase'),
          lowercaseShortWords: checked('ap-lowercaseShortWords'),
          capitalizeFirstWord: checked('ap-capitalizeFirstWord'),
          monthAbbreviations: checked('ap-monthAbbreviations'),
          stateAbbreviations: checked('ap-stateAbbreviations'),
          numerals: checked('ap-numerals')
        };
      }
      $('ap-convert').addEventListener('click', function () {
        $('ap-output').textContent = R.apCaseConvert(value('ap-input'), options());
        announce(status, 'Converted to AP style.');
      });
      $('ap-clear').addEventListener('click', function () {
        $('ap-input').value = ''; $('ap-output').textContent = ''; announce(status, 'Cleared.');
      });
      $('ap-copy').addEventListener('click', function () { copyText($('ap-output').textContent, status, 'Output copied to clipboard.'); });
    }

    /* 10 — Remove Extra Spaces */
    if (slug === 'remove-extra-spaces') {
      const status = $('spaces-status');
      const input = $('spaces-input');
      const result = $('spaces-result');
      $('spaces-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          announce(status, 'File loaded. Click “Remove Extra Spaces” to process.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      $('spaces-apply').addEventListener('click', function () {
        result.value = R.removeExtraSpaces(input.value);
        announce(status, 'Extra whitespace collapsed into single spaces.');
      });
      $('spaces-copy').addEventListener('click', function () { copyText(result.value, status, 'Output copied to clipboard.'); });
    }

    /* 11 — Find and Replace */
    if (slug === 'find-and-replace') {
      const status = $('fr-status');
      const input = $('fr-input');
      const result = $('fr-result');
      const preview = $('fr-preview');
      const countNode = $('fr-count');
      let original = '';
      let matches = [];
      let active = 0;

      function options() {
        return {
          find: value('fr-find'), replace: value('fr-replace'),
          caseSensitive: checked('fr-case'), wholeWord: checked('fr-whole'),
          // Legacy behaviour stays intact: case-insensitive means live regex.
          // The explicit checkbox can also opt into regex while case-sensitive.
          regex: checked('fr-regex') || !checked('fr-case')
        };
      }
      function refresh(message) {
        const found = R.findMatches(input.value, options());
        matches = found.matches;
        if (active >= matches.length) active = 0;
        if (countNode) countNode.textContent = matches.length + ' match' + (matches.length === 1 ? '' : 'es');
        if (preview) {
          preview.textContent = '';
          R.highlightSegments(input.value, matches, active).forEach(function (segment) {
            if (!segment.hit) { preview.appendChild(document.createTextNode(segment.text)); return; }
            const span = document.createElement('span');
            span.className = 'fr-hit' + (segment.active ? ' is-active' : '');
            span.style.background = segment.active ? '#fde68a' : '#fef3c7';
            span.style.borderBottom = (segment.active ? '2px solid #b45309' : '1px solid #d97706');
            span.style.borderRadius = '3px';
            span.textContent = segment.text;
            preview.appendChild(span);
          });
        }
        if (found.error === 'unsafe') announce(status, found.message);
        else if (found.error === 'invalid') announce(status, 'Invalid regular expression: ' + found.message);
        else if (message) announce(status, message);
        else if (found.error === 'empty') announce(status, 'Enter text to find.');
        else announce(status, matches.length + ' match(es) highlighted in the source text.');
      }
      function replaceAll() {
        const outcome = R.replaceText(input.value, options());
        if (outcome.error === 'unsafe') { announce(status, outcome.message); return; }
        if (outcome.error === 'invalid') { announce(status, 'Invalid regular expression: ' + outcome.message); return; }
        if (!original) original = input.value;
        result.value = outcome.text;
        refresh();
        announce(status, 'Replacement applied. ' + outcome.count + ' occurrence(s) replaced.');
      }
      function selectMatch(delta) {
        if (!matches.length) { announce(status, 'No matches to move through yet.'); return; }
        active = (active + delta + matches.length) % matches.length;
        refresh();
        announce(status, 'Match ' + (active + 1) + ' of ' + matches.length + '.');
        const span = preview && preview.querySelector('.fr-hit.is-active');
        if (span && span.scrollIntoView) span.scrollIntoView({ block: 'nearest' });
      }
      function replaceOne() {
        if (!matches.length) { announce(status, 'No matches to replace yet.'); return; }
        const outcome = R.replaceText(input.value, Object.assign(options(), { onlyIndex: active }));
        if (original !== input.value) original = input.value;
        result.value = outcome.text;
        input.value = outcome.text;
        refresh();
        announce(status, 'Replaced match ' + (active + 1) + '. ' + Math.max(0, matches.length - 1) + ' match(es) remain.');
      }
      function restore() {
        input.value = original;
        result.value = '';
        active = 0;
        refresh();
        announce(status, 'Original text restored.');
      }

      $('fr-apply').addEventListener('click', replaceAll);
      if ($('fr-replace-one')) $('fr-replace-one').addEventListener('click', replaceOne);
      if ($('fr-prev')) $('fr-prev').addEventListener('click', function () { selectMatch(-1); });
      if ($('fr-next')) $('fr-next').addEventListener('click', function () { selectMatch(1); });
      if ($('fr-undo')) $('fr-undo').addEventListener('click', restore);
      if ($('fr-restore')) $('fr-restore').addEventListener('click', restore);
      if ($('fr-copy')) $('fr-copy').addEventListener('click', function () { copyText(result.value, status, 'Output copied to clipboard.'); });
      if ($('fr-download')) $('fr-download').addEventListener('click', function () { downloadFile(result.value, 'find-replace-result.txt', 'text/plain;charset=utf-8', status); });
      if ($('fr-upload')) $('fr-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          original = loaded.text;
          input.value = loaded.text;
          result.value = '';
          active = 0;
          refresh('File loaded. Matches highlighted.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      [input, $('fr-find'), $('fr-replace'), $('fr-case'), $('fr-whole'), $('fr-regex')].forEach(function (el) {
        if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () { refresh(); });
      });
      original = input.value;
      refresh();
    }

    /* 15 — Remove Empty Lines (document-aware engine) */
    if (slug === 'remove-empty-lines') {
      const status = $('tool-status');
      const input = $('tool-input');
      const output = $('tool-output');
      function process(message) {
        output.textContent = R.removeEmptyLines(input.value, { preserveParagraphs: checked('rel-preserve') });
        announce(status, message || 'Empty lines removed. Other formatting on real lines is preserved.');
        return output.textContent;
      }
      if ($('rel-apply')) $('rel-apply').addEventListener('click', function () { process('Empty lines removed.'); });
      if ($('rel-preserve')) $('rel-preserve').addEventListener('change', function () { process(); });
      if ($('clear-input')) $('clear-input').addEventListener('click', function () {
        input.value = ''; process('Input cleared.');
      });
      if ($('copy-output')) $('copy-output').addEventListener('click', function () { copyText(output.textContent, status, 'Output copied to clipboard.'); });
      if ($('download-output')) $('download-output').addEventListener('click', function () {
        downloadFile(output.textContent, 'lines-cleaned.txt', 'text/plain;charset=utf-8', status);
      });
      if ($('rel-upload')) $('rel-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          process('File loaded and cleaned.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      process('Paste text or load a file to remove empty lines.');
    }

    /* 16 — Remove Punctuation (document-aware engine) */
    if (slug === 'remove-punctuation') {
      const status = $('tool-status');
      const input = $('tool-input');
      const output = $('tool-output');
      const types = $('rp-types');
      const chars = $('rp-chars');
      function options() { return { types: types ? types.value : 'all', chars: chars ? chars.value : '' }; }
      function process(message) {
        output.textContent = R.removePunctuation(input.value, options());
        announce(status, message || 'Punctuation removed. Letters, numbers and Unicode characters are preserved.');
        return output.textContent;
      }
      function syncCustom() {
        if (chars) chars.disabled = !types || types.value !== 'custom';
      }
      input.addEventListener('input', function () { process(); });
      if ($('rp-apply')) $('rp-apply').addEventListener('click', function () { process('Punctuation removed.'); });
      if (types) types.addEventListener('change', function () { syncCustom(); process('Punctuation mode changed.'); });
      if (chars) chars.addEventListener('input', function () { process(); });
      if ($('clear-input')) $('clear-input').addEventListener('click', function () { input.value = ''; process('Input cleared.'); });
      if ($('copy-output')) $('copy-output').addEventListener('click', function () { copyText(output.textContent, status, 'Output copied to clipboard.'); });
      if ($('download-output')) $('download-output').addEventListener('click', function () {
        downloadFile(output.textContent, 'punctuation-removed.txt', 'text/plain;charset=utf-8', status);
      });
      if ($('rp-upload')) $('rp-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          process('File loaded and cleaned.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      syncCustom();
      process('Paste text or load a file to remove punctuation.');
    }

    /* 17 — Text Comparer (two-document engine) */
    if (slug === 'text-comparer') {
      const status = $('tool-status');
      const output = $('tool-output');
      const summary = $('cmp-summary');
      const left = $('tool-input-left');
      const right = $('tool-input-right');
      function compare(message) {
        const result = R.compareTexts(left.value, right.value, { unit: radioValue('cmp-unit') || 'lines' });
        output.textContent = '';
        if (!result.ok) {
          if (summary) summary.textContent = 'Limit reached';
          announce(status, result.error);
          return;
        }
        result.ops.forEach(function (op) {
          const line = document.createElement('span');
          const prefix = op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' ';
          line.className = 'diff-line diff-' + op.type;
          line.textContent = prefix + ' ' + op.value;
          output.appendChild(line);
        });
        if (!result.ops.length) {
          const empty = document.createElement('span');
          empty.className = 'diff-line diff-equal';
          empty.textContent = ' No differences';
          output.appendChild(empty);
        }
        if (summary) summary.textContent = result.added + ' added · ' + result.removed + ' removed';
        announce(status, message || (result.added + ' added · ' + result.removed + ' removed. Only extracted text was compared, not formatting.'));
      }
      left.addEventListener('input', function () { compare(); });
      right.addEventListener('input', function () { compare(); });
      if ($('cmp-compare')) $('cmp-compare').addEventListener('click', function () { compare('Text compared. Only extracted text was compared, not formatting.'); });
      if ($('cmp-swap')) $('cmp-swap').addEventListener('click', function () {
        const previous = left.value;
        left.value = right.value;
        right.value = previous;
        compare('Sides swapped and compared.');
      });
      if ($('cmp-clear')) $('cmp-clear').addEventListener('click', function () {
        left.value = ''; right.value = ''; compare('Both sides cleared.');
      });
      all('input[name="cmp-unit"]').forEach(function (el) { el.addEventListener('change', function () { compare(); }); });
      [['cmp-upload-left', left], ['cmp-upload-right', right]].forEach(function (pair) {
        const node = $(pair[0]);
        if (!node) return;
        node.addEventListener('change', function (event) {
          const file = event.target.files && event.target.files[0];
          if (!file) return;
          readDocumentFile(file, status).then(function (loaded) {
            pair[1].value = loaded.text;
            compare('File loaded for the ' + (pair[0] === 'cmp-upload-left' ? 'original' : 'changed') + ' side.' + (loaded.warning ? ' ' + loaded.warning : ''));
          }).catch(function (error) { announce(status, error.message); });
        });
      });
      compare('Paste text on both sides or load text files to compare them.');
    }

    /* 18 — HTML to Markdown */
    if (slug === 'html-to-markdown') {
      const status = $('h2m-status');
      const input = $('h2m-input');
      const source = $('h2m-source');
      const preview = $('h2m-preview');
      const count = $('h2m-count');
      function update(message) {
        const markdown = R.htmlToMarkdown(input.value);
        source.textContent = markdown;
        renderSafeHtml(preview, input.value);
        if (count) count.textContent = markdown.length + ' Markdown character' + (markdown.length === 1 ? '' : 's');
        announce(status, message || (input.value.trim() ? 'Converted to Markdown. Preview uses safe DOM nodes only.' : 'Paste HTML to see Markdown and a rendered preview.'));
        return markdown;
      }
      input.addEventListener('input', function () { update(); });
      if ($('h2m-clear')) $('h2m-clear').addEventListener('click', function () { input.value = ''; update('Cleared.'); });
      if ($('h2m-copy')) $('h2m-copy').addEventListener('click', function () { copyText(source.textContent, status, 'Markdown copied to clipboard.'); });
      if ($('h2m-download')) $('h2m-download').addEventListener('click', function () { downloadFile(source.textContent, 'converted.md', 'text/markdown;charset=utf-8', status); });
      if ($('h2m-upload')) $('h2m-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          update('File loaded and converted.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      update();
    }

    /* 19 — Extract URLs */
    if (slug === 'extract-urls') {
      const status = $('url-status');
      const input = $('url-input');
      const list = $('url-list');
      const count = $('url-count');
      let urls = [];
      function update(message) {
        const result = R.extractUrls(input.value);
        urls = result.urls;
        if (count) count.textContent = result.count + ' unique URL' + (result.count === 1 ? '' : 's');
        list.textContent = '';
        if (!urls.length) {
          const empty = document.createElement('p');
          empty.className = 'hint';
          empty.textContent = 'No valid http, https, www or bare-domain URLs found yet.';
          list.appendChild(empty);
        } else {
          urls.forEach(function (item, index) {
            const row = document.createElement('div');
            row.className = 'url-row';
            const link = document.createElement('a');
            link.textContent = item.value;
            link.href = item.value;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            row.appendChild(document.createTextNode(String(index + 1) + '. '));
            row.appendChild(link);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-small';
            button.textContent = 'Copy';
            button.setAttribute('aria-label', 'Copy URL ' + (index + 1));
            button.addEventListener('click', function () { copyText(item.value, status, 'URL copied to clipboard.'); });
            row.appendChild(button);
            list.appendChild(row);
          });
        }
        announce(status, message || (urls.length ? result.count + ' unique URL(s) extracted in first-seen order.' : 'Paste text containing links.'));
        return result;
      }
      input.addEventListener('input', function () { update(); });
      if ($('url-copy')) $('url-copy').addEventListener('click', function () {
        copyText(urls.map(function (u) { return u.value; }).join('\n'), status, 'All URLs copied to clipboard.');
      });
      if ($('url-download')) $('url-download').addEventListener('click', function () {
        if (!urls.length) { announce(status, 'No URLs to download yet.'); return; }
        downloadFile(urls.map(function (u) { return u.value; }).join('\n'), 'extracted-urls.txt', 'text/plain;charset=utf-8', status);
      });
      if ($('url-clear')) $('url-clear').addEventListener('click', function () { input.value = ''; update('Cleared.'); });
      if ($('url-upload')) $('url-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          update('File loaded and links extracted.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      update();
    }

    /* 20 — Grammar and Spell Checker */
    if (slug === 'grammar-spell-checker') {
      const status = $('gs-status');
      const input = $('gs-input');
      const highlight = $('gs-highlight');
      const list = $('gs-list');
      const count = $('gs-count');
      const corrected = $('gs-corrected');
      const originalView = $('gs-original');
      let analysis = null;
      let accepted = new Set();
      let lastText = '';
      const colours = { spelling: '#fecaca', grammar: '#bfdbfe', punctuation: '#fde68a', repeated: '#fbcfe8', clarity: '#c7d2fe', style: '#d9f99d' };

      function renderHighlight() {
        highlight.textContent = '';
        if (!analysis) return;
        const spans = R.highlightSegments(analysis.original, analysis.suggestions.map(function (s) {
          return { index: s.start, end: s.end, text: s.original };
        }), -1);
        spans.forEach(function (segment) {
          if (!segment.hit) { highlight.appendChild(document.createTextNode(segment.text)); return; }
          const hit = analysis.suggestions.find(function (s) { return s.start === segment.start; });
          const span = document.createElement('span');
          span.className = 'gs-hit';
          span.style.background = colours[hit ? hit.category : 'style'] || '#fef3c7';
          span.style.borderBottom = '2px solid #92400e';
          span.style.borderRadius = '3px';
          span.title = hit ? hit.category + ': ' + hit.explanation : '';
          span.textContent = segment.text;
          highlight.appendChild(span);
        });
      }

      function renderList() {
        list.textContent = '';
        if (!analysis || !analysis.suggestions.length) {
          const empty = document.createElement('p');
          empty.className = 'hint';
          empty.textContent = 'No rule-based suggestions for this text. This checker is English-only and not a full rewrite service.';
          list.appendChild(empty);
          return;
        }
        analysis.suggestions.forEach(function (suggestion) {
          const row = document.createElement('div');
          row.className = 'gs-suggestion';
          row.style.borderBottom = '1px solid var(--border)';
          row.style.padding = '8px 0';
          const head = document.createElement('div');
          const badge = document.createElement('span');
          badge.className = 'pill';
          badge.textContent = suggestion.category;
          head.appendChild(badge);
          const original = document.createElement('strong');
          original.textContent = ' “' + suggestion.original + '”';
          head.appendChild(original);
          row.appendChild(head);
          const explanation = document.createElement('p');
          explanation.className = 'hint';
          explanation.textContent = suggestion.explanation + ' Confidence: ' + Math.round(suggestion.confidence * 100) + '%.';
          row.appendChild(explanation);
          const actions = document.createElement('div');
          actions.className = 'output-actions';
          suggestion.replacements.forEach(function (replacement) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-small';
            button.textContent = 'Use “' + replacement + '”';
            button.addEventListener('click', function () {
              suggestion.replacement = replacement;
              accepted.add(suggestion.id);
              renderList();
              renderCorrected();
              announce(status, 'Suggestion accepted. Apply all selected to update the corrected text.');
            });
            actions.appendChild(button);
          });
          const reject = document.createElement('button');
          reject.type = 'button';
          reject.className = 'btn btn-secondary btn-small';
          reject.textContent = accepted.has(suggestion.id) ? 'Reject selected' : 'Rejected';
          reject.addEventListener('click', function () { accepted.delete(suggestion.id); renderList(); renderCorrected(); });
          actions.appendChild(reject);
          row.appendChild(actions);
          list.appendChild(row);
        });
      }

      function renderCorrected() {
        if (!analysis) { corrected.textContent = ''; if (originalView) originalView.textContent = ''; return; }
        if (originalView) originalView.textContent = analysis.original;
        corrected.textContent = R.applyGrammarSuggestions(analysis.original, analysis.suggestions, Array.from(accepted));
      }

      function update(message) {
        analysis = R.analyzeGrammar(input.value, { style: value('gs-style') });
        accepted = new Set(analysis.selectedIds);
        lastText = R.applyGrammarSuggestions(analysis.original, analysis.suggestions, Array.from(accepted));
        if (count) {
          const total = analysis.suggestions.length;
          count.textContent = total + ' suggestion' + (total === 1 ? '' : 's') + ' · ' + analysis.wordCount + ' words';
        }
        renderHighlight();
        renderList();
        renderCorrected();
        announce(status, message || (analysis.suggestions.length
          ? analysis.suggestions.length + ' local rule-based suggestion(s). Review each one before accepting.'
          : 'No suggestions. This English-only checker uses local rules, not a full NLP or AI rewriting service.'));
      }

      input.addEventListener('input', function () { update(); });
      if ($('gs-style')) $('gs-style').addEventListener('change', function () { update('Style emphasis changed; suggestions refreshed.'); });
      if ($('gs-apply')) $('gs-apply').addEventListener('click', function () {
        if (!analysis) return;
        const result = R.applyGrammarSuggestions(analysis.original, analysis.suggestions, Array.from(accepted));
        corrected.textContent = result;
        lastText = result;
        announce(status, 'Applied ' + accepted.size + ' selected suggestion(s) to the corrected copy. Your original text is unchanged.');
      });
      if ($('gs-select-all')) $('gs-select-all').addEventListener('click', function () {
        accepted = new Set((analysis ? analysis.suggestions : []).map(function (s) { return s.id; }));
        renderList(); renderCorrected(); announce(status, 'All suggestions selected for the corrected copy.');
      });
      if ($('gs-reject-all')) $('gs-reject-all').addEventListener('click', function () {
        accepted = new Set(); renderList(); renderCorrected(); announce(status, 'All suggestions rejected. The corrected copy matches your original.');
      });
      if ($('gs-copy')) $('gs-copy').addEventListener('click', function () { copyText(corrected.textContent || lastText, status, 'Corrected text copied to clipboard.'); });
      if ($('gs-download')) $('gs-download').addEventListener('click', function () {
        downloadFile(corrected.textContent || lastText, 'grammar-corrected.txt', 'text/plain;charset=utf-8', status);
      });
      if ($('gs-clear')) $('gs-clear').addEventListener('click', function () { input.value = ''; update('Cleared.'); });
      if ($('gs-upload')) $('gs-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          update('File loaded and checked.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      update();
    }

    /* 12 — Remove Emojis */
    if (slug === 'remove-emojis') {
      const status = $('emoji-status');
      const input = $('emoji-input');
      const result = $('emoji-result');
      function apply(text) { result.value = R.removeEmojis(text); announce(status, 'Emoji removed.'); }
      $('emoji-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        readFile(file, function (text) { apply(text); announce(status, 'File loaded and processed.'); }, status);
      });
      $('emoji-apply').addEventListener('click', function () { apply(input.value); });
      $('emoji-copy').addEventListener('click', function () { copyText(result.value, status, 'Output copied to clipboard.'); });
    }

    /* 13 — Text to List Converter */
    if (slug === 'text-to-list') {
      const status = $('tl-status');
      const output = $('tl-output');
      let lastText = '';
      function notify(message, isError) {
        announce(status, message);
        status.classList.toggle('is-error', !!isError);
      }
      function syncVisibility() {
        $('tl-separator-wrap').hidden = radioValue('tl-split') !== 'custom';
        $('tl-prefix-wrap').hidden = radioValue('tl-format') !== 'custom';
      }
      all('input[name="tl-split"], input[name="tl-format"]').forEach(function (el) { el.addEventListener('change', syncVisibility); });
      $('tl-convert').addEventListener('click', function () {
        if (!value('tl-input').trim()) { notify('Please enter some text to convert', true); output.textContent = ''; return; }
        const opts = {
          split: radioValue('tl-split'),
          format: radioValue('tl-format'),
          separator: value('tl-separator'),
          prefix: value('tl-prefix')
        };
        const result = R.textToList(value('tl-input'), opts);
        if (result.error === 'custom-separator') { notify('Please enter a custom separator', true); output.textContent = ''; return; }
        if (result.error === 'no-items') { notify('No items found after splitting', true); output.textContent = ''; return; }
        output.textContent = result.text;
        lastText = result.text;
        notify('Conversion completed successfully!', false);
      });
      $('tl-copy').addEventListener('click', function () { copyText(lastText, status, 'Copied to clipboard!'); });
      $('tl-clear').addEventListener('click', function () {
        $('tl-input').value = ''; $('tl-separator').value = ''; $('tl-prefix').value = '';
        output.textContent = ''; lastText = ''; notify('All fields cleared!', false);
      });
      syncVisibility();
    }

    /* 14 — Text Filter */
    if (slug === 'text-filter') {
      const status = $('tf-status');
      const output = $('tf-output');
      let plain = '';
      $('tf-apply').addEventListener('click', function () {
        const segments = R.applyFilter(value('tf-input'), value('tf-highlight'), value('tf-remove'));
        output.textContent = '';
        plain = segments.map(function (s) { return s.text; }).join('');
        segments.forEach(function (s) {
          if (s.hit) {
            const span = document.createElement('span');
            span.className = 'highlight';
            span.textContent = s.text;
            output.appendChild(span);
          } else output.appendChild(document.createTextNode(s.text));
        });
        announce(status, 'Filter applied.');
      });
      $('tf-copy').addEventListener('click', function () { copyText(plain, status, 'Output copied to clipboard.'); });
    }

    /* 01 — Text Cleaner */
    if (slug === 'text-cleaner') {
      const input = $('cln-input');
      const output = $('cln-output');
      const status = $('cln-status');
      const undoBtn = $('cln-undo');
      const wrap = $('cln-wrapLines');
      const checkboxes = all('.engine-workspace[data-engine="text-cleaner"] input[type="checkbox"]');
      const defaults = ['trim', 'removeLeadingSpaces', 'removeTrailingSpaces', 'stripHtmlTags', 'stripEmojis', 'multipleSpacesToSingle', 'multipleBlankLinesToSingle'];
      const history = [];
      let position = -1;

      function syncWrap() { input.style.whiteSpace = wrap.checked ? 'normal' : 'pre'; }
      function options() {
        const opts = {};
        checkboxes.forEach(function (box) { opts[box.id.slice(4)] = box.checked; });
        ['spacesToTab', 'tabToSpaces', 'trimLeftChars', 'trimRightChars'].forEach(function (key) {
          opts[key] = Number(value('cln-' + key)) || 0;
        });
        opts.letterCase = radioValue('cln-letterCase') || 'noChange';
        return opts;
      }
      function remember(text) {
        if (position < history.length - 1) history.splice(position + 1);
        history.push(text);
        position = history.length - 1;
        undoBtn.disabled = position <= 0;
      }
      function run() {
        const original = input.value;
        const result = R.cleanText(original, options());
        if (result.changed) {
          remember(original);
          input.value = result.text;
          output.value = result.text;
          announce(status, 'Text cleaned. Use Undo to restore the previous version.');
        } else {
          output.value = result.text;
          announce(status, 'No changes were needed.');
        }
      }
      function setBoxes(keys) {
        // The reference presets operate on every checkbox, including Wrap lines.
        checkboxes.forEach(function (box) { box.checked = keys === null || keys.indexOf(box.id.slice(4)) !== -1; });
        syncWrap();
      }
      function selectCase(val) {
        const radio = document.querySelector('input[name="cln-letterCase"][value="' + val + '"]');
        if (radio) radio.checked = true;
      }
      $('cln-clean').addEventListener('click', run);
      $('cln-all').addEventListener('click', function () { setBoxes(null); run(); });
      $('cln-none').addEventListener('click', function () {
        setBoxes([]);
        selectCase('noChange');
        run();
      });
      $('cln-default').addEventListener('click', function () {
        setBoxes(defaults);
        selectCase('noChange');
        run();
      });
      undoBtn.addEventListener('click', function () {
        if (position <= 0) return;
        position--;
        input.value = history[position];
        output.value = history[position];
        undoBtn.disabled = position <= 0;
        announce(status, 'Undid the last change.');
      });
      $('cln-copy').addEventListener('click', function () { copyText(input.value, status, 'Text copied to clipboard!'); });
      input.addEventListener('input', function () { if (history.length === 0) remember(this.value); });
      wrap.addEventListener('change', syncWrap);
      checkboxes.forEach(function (box) {
        if (box !== wrap) box.addEventListener('change', run);
      });
      all('.engine-cleaner input[type="radio"], .engine-cleaner input[type="number"]').forEach(function (el) {
        el.addEventListener('change', run);
      });
      syncWrap();
      run();
    }

    /* 06 — Word Counter */
    if (slug === 'word-counter') {
      const input = $('wc-input');
      const status = $('wc-status');
      const SAMPLE = 'Every piece of writing has a number to hit. A college application essay might have a word count limit of 650, a product description about 150 words, and an X post only 280 characters. This word counter keeps track of all of it while you type.\n\nDr. Emma Johnson, a writing coach in Chicago, gives her students a simple checklist before they hit submit: check the word count, check the reading time and look for words you repeat too often. Repeated words are easy to miss when a deadline is close!\n\nTry it now. Select a sentence to count just that part, then scroll down to see your keyword density.';
      let timer = null;

      function duration(seconds) {
        if (!seconds) return '0s';
        if (seconds < 60) return seconds + 's';
        const m = Math.floor(seconds / 60), s = seconds % 60;
        return s ? m + 'm ' + s + 's' : m + 'm';
      }
      function render(text) {
        const stats = R.wordCounterAnalyze(text, { n: Number(radioValue('wc-n')) || 1, ignore: checked('wc-ignore') });
        $('wc-words').textContent = stats.words;
        $('wc-chars').textContent = stats.characters;
        $('wc-sentences').textContent = stats.sentences;
        $('wc-paragraphs').textContent = stats.paragraphs;
        $('wc-chars-nospace').textContent = stats.charactersNoSpaces;
        $('wc-letters').textContent = stats.letters;
        $('wc-unique').textContent = stats.uniqueWords;
        $('wc-avg').textContent = stats.avgWordLength;
        $('wc-reading').textContent = duration(stats.readingSeconds);
        $('wc-speaking').textContent = duration(stats.speakingSeconds);
        const body = $('wc-density');
        body.textContent = '';
        if (!stats.density.length) {
          const row = document.createElement('tr');
          const cell = document.createElement('td');
          cell.colSpan = 4;
          cell.textContent = 'No keywords to show yet.';
          row.appendChild(cell); body.appendChild(row);
        } else {
          stats.density.forEach(function (item, index) {
            const row = document.createElement('tr');
            [String(index + 1), item.keyword, String(item.count), item.density.toFixed(1) + '%'].forEach(function (text) {
              const cell = document.createElement('td');
              cell.textContent = text;
              row.appendChild(cell);
            });
            body.appendChild(row);
          });
        }
        const goal = Number(value('wc-goal'));
        const type = value('wc-goal-type');
        const current = type === 'characters' ? stats.characters : stats.words;
        const fill = $('wc-goal-fill');
        if (goal > 0) {
          const pct = Math.min(100, Math.round(current / goal * 100));
          fill.style.width = pct + '%';
          $('wc-goal-label').textContent = current + ' / ' + goal + ' ' + type + ' (' + pct + '%)';
        } else {
          fill.style.width = '0%';
          $('wc-goal-label').textContent = 'Set a goal to see your progress.';
        }
      }
      function schedule() {
        clearTimeout(timer);
        const size = input.value.length;
        const delay = size > 200000 ? 350 : (size > 20000 ? 140 : 10);
        timer = setTimeout(function () { render(input.value); }, delay);
      }
      input.addEventListener('input', schedule);
      ['wc-n', 'wc-ignore', 'wc-goal', 'wc-goal-type'].forEach(function (id) {
        const el = $(id);
        if (el) el.addEventListener('change', function () { render(input.value); });
      });
      $('wc-sample').addEventListener('click', function () { input.value = SAMPLE; render(SAMPLE); announce(status, 'Sample text loaded.'); });
      $('wc-clear').addEventListener('click', function () { input.value = ''; render(''); announce(status, 'Cleared.'); });
      $('wc-copy').addEventListener('click', function () { copyText(input.value, status, 'Text copied to clipboard.'); });
      $('wc-file').addEventListener('click', function () { $('wc-upload').click(); });
      $('wc-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          render(input.value);
          announce(status, 'File loaded.' + (loaded.warning ? ' ' + loaded.warning : ''));
        }).catch(function (error) { announce(status, error.message); });
      });
      input.addEventListener('select', function () {
        const selected = input.value.substring(input.selectionStart, input.selectionEnd);
        if (selected && selected !== input.value) announce(status, 'Selection: ' + R.countWords(selected) + ' words, ' + R.graphemeCount(selected) + ' characters.');
      });
      input.value = SAMPLE;
      render(SAMPLE);
    }

    /* 05 — Redact Text */
    if (slug === 'text-redactor') {
      const input = $('rdx-input');
      const output = $('rdx-output');
      const status = $('rdx-status');
      const SAMPLE = 'Hi Jordan, please send the report to jordan@example.com or call (555) 123-4567. My card is 4111 1111 1111 1111 and the API key is AKIAIOSFODNN7EXAMPLE.';
      let current = null;

      function options() {
        const cats = {};
        all('.engine-redact input[id^="rdx-"]').forEach(function (box) {
          if (box.type === 'checkbox' && ['name', 'email', 'phone', 'address', 'money', 'id', 'secret', 'net', 'user', 'url', 'date'].indexOf(box.id.slice(4)) !== -1) {
            cats[box.id.slice(4)] = box.checked;
          }
        });
        return { cats: cats, style: radioValue('rdx-style') || 'label', words: value('rdx-words') };
      }
      function apply() {
        current = R.redactBuild(input.value, options());
        output.value = current.text;
        $('rdx-found').textContent = current.found + ' item' + (current.found === 1 ? '' : 's') + ' found';
        announce(status, current.found ? 'Redacted ' + current.found + ' item(s). Review the result before sharing.' : 'No matching values found. Check the result manually.');
      }
      function restore() {
        if (!current) apply();
        const result = R.redactRestore(value('rdx-restore-input'), current.entries);
        $('rdx-restored').value = result.text;
        let message = 'Values restored.';
        if (result.unknown) message += ' ' + result.unknown + ' unknown label(s) were left unchanged.';
        if (result.hasBars) message += ' Black bars cannot be reversed.';
        announce(status, message);
      }
      function saveKey() {
        if (!current || !current.entries.length) { announce(status, 'Nothing to save yet.'); return; }
        const payload = {
          tool: 'LetitEdit Redact Text', version: 1, created: new Date().toISOString(),
          warning: 'This file contains the original values you hid. Keep it private.',
          entries: current.entries
        };
        downloadFile(JSON.stringify(payload, null, 2), 'redaction-key.json', 'application/json;charset=utf-8', status);
      }
      function loadKey(file) {
        readFile(file, function (text) {
          try {
            const data = JSON.parse(text);
            if (!data || !Array.isArray(data.entries)) throw new Error('invalid');
            current = { text: output.value, entries: data.entries, found: data.entries.length };
            announce(status, 'Key loaded. Paste a reply and choose Restore values.');
          } catch (e) { announce(status, 'That file is not a valid redaction key.'); }
        }, status);
      }
      input.addEventListener('input', function () { if (input.value) apply(); });
      all('.engine-redact input[type="checkbox"], .engine-redact input[type="radio"]').forEach(function (el) {
        el.addEventListener('change', function () {
          if (el.id === 'rdx-remember' && el.checked) {
            try { localStorage.setItem('rdx_words_v1', value('rdx-words')); } catch (e) { /* storage blocked */ }
          }
          apply();
        });
      });
      $('rdx-words').addEventListener('input', apply);
      $('rdx-sample').addEventListener('click', function () { input.value = SAMPLE; apply(); });
      $('rdx-clear').addEventListener('click', function () { input.value = ''; output.value = ''; current = null; announce(status, 'Cleared.'); });
      $('rdx-upload-btn').addEventListener('click', function () { $('rdx-upload').click(); });
      $('rdx-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        readFile(file, function (text) { input.value = text; apply(); announce(status, 'File loaded and redacted.'); }, status);
      });
      $('rdx-copy').addEventListener('click', function () { copyText(output.value, status, 'Redacted text copied.'); });
      if ($('rdx-download')) $('rdx-download').addEventListener('click', function () {
        if (!output.value) { announce(status, 'Nothing to download yet.'); return; }
        downloadFile(output.value, 'redacted-text.txt', 'text/plain;charset=utf-8', status);
      });
      $('rdx-save-key').addEventListener('click', saveKey);
      $('rdx-restore').addEventListener('click', restore);
      $('rdx-copy-restored').addEventListener('click', function () { copyText($('rdx-restored').value, status, 'Restored text copied.'); });
      $('rdx-load-key').addEventListener('click', function () { $('rdx-key-file').click(); });
      $('rdx-key-file').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (file) loadKey(file);
      });
      try {
        const remembered = localStorage.getItem('rdx_words_v1');
        if (remembered) { $('rdx-words').value = remembered; $('rdx-remember').checked = true; }
      } catch (e) { /* storage blocked */ }
      input.value = SAMPLE;
      apply();
    }

    /* 04 — Bank Statement Converter */
    if (slug === 'bank-statement-converter') {
      const input = $('bk-input');
      const status = $('bk-status');
      const SAMPLE = '01/15/2026 Coffee Shop 4.50 995.50\n01/16/2026 Salary 1,000.00 1,995.50\n01/17/2026 Rent -650.00 1,345.50\n01/18/2026 Groceries -52.25 1,293.25';
      let parsed = null;
      let editing = false;
      function options() {
        const columns = {};
        ['date', 'description', 'amount', 'balance', 'debit', 'credit'].forEach(function (key) {
          const node = $('bk-col-' + key);
          if (node && node.value !== 'auto') columns[key] = node.value;
        });
        return {
          dateOrder: value('bk-date-order'), kind: value('bk-kind'),
          format: value('bk-format') || 'auto', columns: columns
        };
      }
      function render(result) {
        parsed = result;
        $('bk-sum-transactions').textContent = result.rows.length;
        $('bk-sum-in').textContent = result.totalIn.toFixed(2);
        $('bk-sum-out').textContent = result.totalOut.toFixed(2);
        const labels = { ok: 'Balances match', off: 'Balances differ', rows: 'Some rows need a look', none: 'No balances to check' };
        $('bk-sum-check').textContent = labels[result.check] || 'No balances to check';
        if ($('bk-warnings')) $('bk-warnings').textContent = result.warnings.length ? result.warnings.join(' ') : 'No automatic warnings; review every row against the original statement.';
        const wrap = $('bk-table');
        wrap.textContent = '';
        if (!result.rows.length) {
          const p = document.createElement('p');
          p.className = 'hint';
          p.textContent = 'No transactions were found. Check the sample format or try a plain-text statement.';
          wrap.appendChild(p);
          announce(status, 'No transactions found.');
          return;
        }
        const table = document.createElement('table');
        table.className = 'statement-table';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Date', 'Description', 'Amount', 'Balance', 'Check', 'Confidence'].forEach(function (label) {
          const th = document.createElement('th'); th.textContent = label; headRow.appendChild(th);
        });
        thead.appendChild(headRow); table.appendChild(thead);
        const tbody = document.createElement('tbody');
        result.rows.forEach(function (row) {
          const tr = document.createElement('tr');
          if (row.check === 'bad') tr.className = 'row-bad';
          else if (row.duplicate) tr.className = 'row-warn';
          const values = [row.date, row.description, row.amount.toFixed(2), row.balance === null ? '—' : row.balance.toFixed(2), row.check === 'bad' ? 'Check' : (row.check === 'ok' ? 'OK' : '—'), Math.round((row.confidence === undefined ? 0 : row.confidence) * 100) + '%'];
          values.forEach(function (text, index) {
            const td = document.createElement('td');
            if (editing && index < 4) {
              const field = document.createElement('input');
              field.type = 'text';
              field.value = text === '—' ? '' : text;
              field.setAttribute('aria-label', 'Edit ' + ['date', 'description', 'amount', 'balance'][index] + ' for row ' + row.id);
              field.dataset.row = String(row.id);
              field.dataset.field = ['date', 'description', 'amount', 'balance'][index];
              td.appendChild(field);
            } else td.textContent = text;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); wrap.appendChild(table);
        announce(status, result.rows.length + ' transaction(s) parsed. Always compare them with the original statement.' + (result.duplicates ? ' ' + result.duplicates + ' possible duplicate(s) flagged.' : ''));
      }
      function applyEdits() {
        if (!parsed) { announce(status, 'Parse a statement first.'); return; }
        let changed = 0;
        all('#bk-table input[data-row]').forEach(function (field) {
          const row = parsed.rows.find(function (item) { return String(item.id) === field.dataset.row; });
          if (!row) return;
          const raw = field.value.trim();
          if (field.dataset.field === 'date') {
            const date = R.parseDateParts(raw, value('bk-date-order'));
            if (date && date !== row.date) { row.date = date; changed++; }
          } else if (field.dataset.field === 'amount' || field.dataset.field === 'balance') {
            const amount = raw === '' ? null : R.parseMoney(raw);
            if (amount !== null && amount !== undefined) { row[field.dataset.field] = amount; changed++; }
          } else if (raw !== row.description) { row.description = raw || 'Transaction'; changed++; }
        });
        editing = false;
        render(R.finalizeStatement(parsed.rows, { format: parsed.format }));
        announce(status, changed ? 'Applied ' + changed + ' edited value(s). Values were not rounded.' : 'No edits were applied.');
      }
      $('bk-parse').addEventListener('click', function () {
        if (!input.value.trim()) { announce(status, 'Paste statement text first.'); return; }
        editing = false;
        render(R.parseStatementDocument(input.value, options()));
      });
      $('bk-sample').addEventListener('click', function () { input.value = SAMPLE; editing = false; render(R.parseStatement(SAMPLE)); });
      $('bk-clear').addEventListener('click', function () { input.value = ''; parsed = null; editing = false; $('bk-table').textContent = 'Parse a statement to see its transactions.'; $('bk-sum-transactions').textContent = '0'; $('bk-sum-in').textContent = '0.00'; $('bk-sum-out').textContent = '0.00'; $('bk-sum-check').textContent = 'No balances to check'; if ($('bk-warnings')) $('bk-warnings').textContent = ''; announce(status, 'Cleared.'); });
      if ($('bk-edit')) $('bk-edit').addEventListener('click', function () {
        if (!parsed || !parsed.rows.length) { announce(status, 'Parse a statement first.'); return; }
        editing = true; render(parsed); announce(status, 'Values are editable. Choose Apply edits when finished.');
      });
      if ($('bk-apply-edits')) $('bk-apply-edits').addEventListener('click', applyEdits);
      $('bk-upload-btn').addEventListener('click', function () { $('bk-upload').click(); });
      $('bk-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        readDocumentFile(file, status).then(function (loaded) {
          input.value = loaded.text;
          editing = false;
          render(R.parseStatementDocument(loaded.text, options()));
          if (loaded.warning) announce(status, loaded.warning);
        }).catch(function (error) { announce(status, error.message); });
      });
      $('bk-csv').addEventListener('click', function () {
        if (!parsed || !parsed.rows.length) { announce(status, 'Parse a statement first.'); return; }
        downloadFile(R.statementToCsv(parsed.rows), 'transactions.csv', 'text/csv;charset=utf-8', status);
      });
      $('bk-qif').addEventListener('click', function () {
        if (!parsed || !parsed.rows.length) { announce(status, 'Parse a statement first.'); return; }
        downloadFile(R.statementToQif(parsed.rows, value('bk-kind')), 'transactions.qif', 'text/plain;charset=utf-8', status);
      });
      input.value = SAMPLE;
      render(R.parseStatement(SAMPLE));
    }

    /* 03 — Handwriting to Font (scoped sampler + styled picture preview) */
    if (slug === 'handwriting-to-font-converter') {
      const pad = $('hf-pad');
      const preview = $('hf-preview');
      const status = $('hf-status');
      const loading = $('hf-loading');
      const ctx = pad.getContext('2d');
      const pctx = preview.getContext('2d');
      const scratch = document.createElement('canvas');
      const sets = {
        upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        lower: 'abcdefghijklmnopqrstuvwxyz'.split(''),
        num: '0123456789'.split(''),
        sym: ". , ! ? ' \" - : ; ( ) & @ # $ % * + / = _".split(' ')
      };
      const glyphs = {};
      const undoStack = {};
      let current = 'A';
      let tool = 'pen';
      let drawing = false;
      let last = null;
      let padToken = 0;
      let buildId = 0;
      let liveTimer = null;
      let lastSuccessful = null;

      function setLoading(on) { if (loading) loading.hidden = !on; }
      function guide(context, char) {
        context.save();
        context.strokeStyle = '#cbd5e1';
        context.setLineDash([6, 6]);
        context.strokeRect(90, 40, 340, 260);
        context.beginPath(); context.moveTo(90, 275); context.lineTo(430, 275); context.stroke();
        context.setLineDash([]);
        context.fillStyle = '#94a3b8';
        context.font = '14px system-ui, sans-serif';
        context.fillText('baseline', 20, 279);
        context.fillText(char === ' ' ? 'space' : char, 20, 60);
        context.restore();
      }
      function setGroup(group) {
        const chars = sets[group] || sets.upper;
        current = chars[0];
        const wrap = $('hf-chars');
        wrap.textContent = '';
        chars.forEach(function (char) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'chip' + (char === current ? ' is-active' : '');
          button.textContent = char === ' ' ? 'space' : char;
          button.addEventListener('click', function () { select(char); });
          wrap.appendChild(button);
        });
        drawCurrent();
      }
      function select(char) {
        current = char;
        all('#hf-chars .chip').forEach(function (b) { b.classList.toggle('is-active', b.textContent === char || (char === ' ' && b.textContent === 'space')); });
        drawCurrent();
      }
      function drawCurrent() {
        const token = ++padToken;
        ctx.clearRect(0, 0, pad.width, pad.height);
        guide(ctx, current);
        if (glyphs[current]) {
          const img = new Image();
          img.onload = function () { if (token === padToken) ctx.drawImage(img, 0, 0); };
          img.src = glyphs[current];
        }
      }
      function saveUndo() {
        if (!undoStack[current]) undoStack[current] = [];
        undoStack[current].push(pad.toDataURL());
        if (undoStack[current].length > 12) undoStack[current].shift();
      }
      function point(event) {
        const rect = pad.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * (pad.width / rect.width), y: (event.clientY - rect.top) * (pad.height / rect.height) };
      }
      pad.addEventListener('pointerdown', function (event) {
        saveUndo(); drawing = true; last = point(event); pad.setPointerCapture(event.pointerId);
      });
      pad.addEventListener('pointermove', function (event) {
        if (!drawing) return;
        const p = point(event);
        ctx.save();
        ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = tool === 'eraser' ? Number(value('hf-pen-size')) * 2 : Number(value('hf-pen-size'));
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.restore();
        last = p;
      });
      function finish() {
        if (!drawing) return;
        drawing = false;
        glyphs[current] = pad.toDataURL();
      }
      pad.addEventListener('pointerup', finish);
      pad.addEventListener('pointercancel', finish);
      $('hf-pen').addEventListener('click', function () { tool = 'pen'; announce(status, 'Pen selected.'); });
      $('hf-eraser').addEventListener('click', function () { tool = 'eraser'; announce(status, 'Eraser selected.'); });
      $('hf-undo').addEventListener('click', function () {
        const stack = undoStack[current];
        if (!stack || !stack.length) { announce(status, 'Nothing to undo for this character.'); return; }
        const previous = stack.pop();
        const img = new Image();
        const token = ++padToken;
        img.onload = function () {
          if (token !== padToken) return;
          ctx.clearRect(0, 0, pad.width, pad.height);
          ctx.drawImage(img, 0, 0);
          glyphs[current] = pad.toDataURL();
        };
        img.src = previous;
      });
      $('hf-clear').addEventListener('click', function () {
        saveUndo(); delete glyphs[current]; drawCurrent(); announce(status, 'Character cleared.');
        if (checked('hf-live')) scheduleLive();
      });
      $('hf-pen-size').addEventListener('input', function () { $('hf-pen-size-label').textContent = value('hf-pen-size') + 'px'; });
      all('input[name="hf-group"]').forEach(function (el) { el.addEventListener('change', function () { setGroup(radioValue('hf-group')); }); });
      document.addEventListener('keydown', function (event) {
        if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
        const groups = radioValue('hf-group') || 'upper';
        const chars = sets[groups] || sets.upper;
        const index = chars.indexOf(current);
        if (event.key === 'ArrowRight' && index < chars.length - 1) { select(chars[index + 1]); }
        if (event.key === 'ArrowLeft' && index > 0) { select(chars[index - 1]); }
      });
      all('[data-hf-phrase]').forEach(function (button) {
        button.addEventListener('click', function () {
          $('hf-text').value = button.getAttribute('data-hf-phrase');
          if (checked('hf-live')) scheduleLive();
        });
      });

      function viewOptions() {
        return {
          size: Number(value('hf-size')) || 44,
          gap: Number(value('hf-gap')) || 10,
          lineHeight: Number(value('hf-line-height')) || 1.2,
          zoom: Number(value('hf-zoom')) || 100,
          font: value('hf-font') || 'sans',
          style: value('hf-style') || 'regular',
          color: value('hf-color') || '#0f172a',
          bg: value('hf-bg') || '#ffffff'
        };
      }
      function fontStack(font) {
        if (font === 'serif') return 'Georgia, "Times New Roman", serif';
        if (font === 'mono') return 'ui-monospace, Consolas, monospace';
        if (font === 'script') return '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive';
        return 'system-ui, -apple-system, sans-serif';
      }
      function loadImage(src) {
        return new Promise(function (resolve, reject) {
          const img = new Image();
          img.onload = function () { resolve(img); };
          img.onerror = function () { reject(new Error('One of the drawn glyphs could not be decoded.')); };
          img.src = src;
        });
      }
      function restoreLast() {
        pctx.clearRect(0, 0, preview.width, preview.height);
        if (!lastSuccessful) {
          pctx.fillStyle = '#ffffff';
          pctx.fillRect(0, 0, preview.width, preview.height);
          pctx.fillStyle = '#64748b';
          pctx.font = '16px system-ui, sans-serif';
          pctx.fillText('Draw a glyph, then build a preview.', 20, 32);
        }
      }
      async function buildPreview(options) {
        const opts = options || {};
        const id = ++buildId;
        setLoading(true);
        try {
          const view = viewOptions();
          const scale = view.zoom / 100;
          const size = view.size * scale;
          const gap = view.gap * scale;
          const lineHeight = view.lineHeight;
          if (scratch.width !== preview.width || scratch.height !== preview.height) {
            scratch.width = preview.width; scratch.height = preview.height;
          }
          const sctx = scratch.getContext('2d');
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.globalCompositeOperation = 'source-over';
          sctx.globalAlpha = 1;
          sctx.fillStyle = view.bg;
          sctx.fillRect(0, 0, scratch.width, scratch.height);
          sctx.fillStyle = view.color;
          sctx.textBaseline = 'top';
          const weight = /bold/.test(view.style) ? '700' : '400';
          const italic = /italic/.test(view.style);
          sctx.font = weight + ' ' + Math.max(10, Math.round(size * 0.55)) + 'px ' + fontStack(view.font);
          const text = value('hf-text');
          const sources = {};
          for (let i = 0; i < text.length; i++) {
            const char = text.charAt(i);
            if (glyphs[char] && !sources[char]) sources[char] = glyphs[char];
          }
          const keys = Object.keys(sources);
          const loaded = await Promise.all(keys.map(function (key) {
            return loadImage(sources[key]).then(function (img) { return { key: key, img: img }; })
              .catch(function () { return { key: key, img: null }; });
          }));
          if (id !== buildId) return;
          const images = {};
          loaded.forEach(function (item) { images[item.key] = item.img; });
          let x = 24 * scale, y = 40 * scale, drawn = 0, missing = 0;
          for (let i = 0; i < text.length; i++) {
            const char = text.charAt(i);
            if (char === '\n') { x = 24 * scale; y += size * lineHeight + 20 * scale; continue; }
            if (char === ' ') { x += size * 0.45 + gap; continue; }
            const img = images[char];
            if (!img) {
              missing++;
              sctx.fillText(char, x, y + size * 0.18);
              x += Math.max(size * 0.6, sctx.measureText(char).width) + gap;
            } else {
              sctx.save();
              if (italic) sctx.transform(1, 0, -0.18, 1, 0, 0);
              sctx.drawImage(img, x, y, size, size);
              if (weight === '700') sctx.drawImage(img, x + 1.5 * scale, y, size, size);
              sctx.restore();
              drawn++;
              x += size + gap;
            }
            if (x > preview.width - size * 0.6) { x = 24 * scale; y += size * lineHeight + 20 * scale; }
          }
          if (id !== buildId) return;
          pctx.clearRect(0, 0, preview.width, preview.height);
          pctx.drawImage(scratch, 0, 0);
          lastSuccessful = scratch.toDataURL('image/png');
          if (!opts.silent) {
            announce(status, drawn + ' glyph(s) previewed' + (missing ? ', ' + missing + ' not drawn yet' : '') + '. This is a picture preview, not a font file.');
          }
        } catch (error) {
          if (id !== buildId) return;
          restoreLast();
          announce(status, 'Preview could not be built: ' + (error && error.message ? error.message : 'check your options and try again.'));
        } finally {
          if (id === buildId) setLoading(false);
        }
      }
      function scheduleLive() {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(function () { buildPreview(); }, 140);
      }
      if ($('hf-build')) $('hf-build').addEventListener('click', function () { buildPreview(); });
      $('hf-download').addEventListener('click', function () {
        buildPreview({ silent: true }).then(function () {
          try {
            const link = document.createElement('a');
            link.download = 'handwriting-preview.png';
            link.href = lastSuccessful || preview.toDataURL('image/png');
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            announce(status, 'Preview image downloaded.');
          } catch (e) { announce(status, 'Download is not supported in this browser.'); }
        });
      });
      $('hf-text').addEventListener('input', function () { if (checked('hf-live')) scheduleLive(); });
      if ($('hf-live')) $('hf-live').addEventListener('change', function () {
        if (checked('hf-live')) { scheduleLive(); announce(status, 'Live preview enabled.'); }
        else announce(status, 'Live preview disabled. Use Build preview to refresh.');
      });
      ['hf-size', 'hf-gap', 'hf-line-height', 'hf-zoom', 'hf-font', 'hf-style', 'hf-color', 'hf-bg'].forEach(function (id) {
        const node = $(id);
        if (!node) return;
        node.addEventListener(node.type === 'range' ? 'input' : 'change', function () {
          if (id === 'hf-line-height') $('hf-line-height-label').textContent = value(id);
          if (id === 'hf-zoom') $('hf-zoom-label').textContent = value(id) + '%';
          if (checked('hf-live')) scheduleLive();
        });
      });
      setGroup('upper');
      restoreLast();
      buildPreview({ silent: true });
    }
  });

  /* Reading view overlay for the bionic tool. */
  function openReadingView(state, applyStyle) {
    if (document.getElementById('br-rv')) return;
    const R = window.ReferenceCore;
    const overlay = document.createElement('div');
    overlay.id = 'br-rv';
    overlay.className = 'reading-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Bionic reading view');
    const panel = document.createElement('div');
    panel.className = 'reading-panel';
    const bar = document.createElement('div');
    bar.className = 'reading-bar';
    function button(id, label, handler) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = id; b.textContent = label; b.className = 'btn btn-secondary btn-small';
      b.addEventListener('click', handler);
      return b;
    }
    const content = document.createElement('div');
    content.className = 'output-box bionic-preview';
    function renderContent() {
      content.textContent = '';
      const parts = R.bionicParse(state.text, state);
      const inner = document.createElement('div');
      parts.forEach(function (p) {
        if (p.t === 1) { const b = document.createElement('b'); b.textContent = p.b; inner.appendChild(b); inner.appendChild(document.createTextNode(p.r)); }
        else inner.appendChild(document.createTextNode(p.v));
      });
      inner.style.whiteSpace = 'pre-wrap';
      content.appendChild(inner);
      applyStyle(content);
    }
    renderContent();
    bar.appendChild(button('br-rv-smaller', 'A−', function () { state.size = R.clamp(state.size - 2, 14, 28, 18); renderContent(); }));
    bar.appendChild(button('br-rv-bigger', 'A+', function () { state.size = R.clamp(state.size + 2, 14, 28, 18); renderContent(); }));
    bar.appendChild(button('br-rv-theme', 'Theme: ' + state.theme.charAt(0).toUpperCase() + state.theme.slice(1), function () {
      const themes = ['light', 'sepia', 'dark'];
      state.theme = themes[(themes.indexOf(state.theme) + 1) % themes.length];
      this.textContent = 'Theme: ' + state.theme.charAt(0).toUpperCase() + state.theme.slice(1);
      renderContent();
    }));
    bar.appendChild(button('br-rv-close', 'Close (Esc)', close));
    panel.appendChild(bar);
    panel.appendChild(content);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey); }
    function onKey(event) {
      if (event.key === 'Escape') { close(); return; }
      if (event.key === 'Tab') {
        const focusables = all('.reading-overlay button');
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    $('br-rv-close').focus();
  }

  if (typeof window !== 'undefined') {
    window.ReferenceRuntime = { readDocumentFile: readDocumentFile, renderSafeHtml: renderSafeHtml };
  }
})();
