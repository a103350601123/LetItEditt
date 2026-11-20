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
        readFile(file, function (text) { input.value = text; announce(status, 'File loaded. Click “Remove Extra Spaces” to process.'); }, status);
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
      $('fr-apply').addEventListener('click', function () {
        try {
          $('fr-result').value = R.findAndReplace(value('fr-input'), value('fr-find'), value('fr-replace'), checked('fr-case'));
          announce(status, 'Replacement applied.');
        } catch (e) {
          announce(status, 'Invalid regular expression: ' + (e && e.message ? e.message : 'check the Find pattern.'));
        }
      });
      $('fr-copy').addEventListener('click', function () { copyText($('fr-result').value, status, 'Result copied to clipboard.'); });
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
        readFile(file, function (text) {
          input.value = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
          render(input.value);
          announce(status, 'File loaded.');
        }, status);
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
      function render(result) {
        parsed = result;
        $('bk-sum-transactions').textContent = result.rows.length;
        $('bk-sum-in').textContent = result.totalIn.toFixed(2);
        $('bk-sum-out').textContent = result.totalOut.toFixed(2);
        const labels = { ok: 'Balances match', off: 'Balances differ', rows: 'Some rows need a look', none: 'No balances to check' };
        $('bk-sum-check').textContent = labels[result.check] || 'No balances to check';
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
        ['Date', 'Description', 'Amount', 'Balance', 'Check'].forEach(function (label) {
          const th = document.createElement('th'); th.textContent = label; headRow.appendChild(th);
        });
        thead.appendChild(headRow); table.appendChild(thead);
        const tbody = document.createElement('tbody');
        result.rows.forEach(function (row) {
          const tr = document.createElement('tr');
          if (row.check === 'bad') tr.className = 'row-bad';
          [row.date, row.description, row.amount.toFixed(2), row.balance === null ? '—' : row.balance.toFixed(2), row.check === 'bad' ? 'Check' : (row.check === 'ok' ? 'OK' : '—')].forEach(function (text) {
            const td = document.createElement('td'); td.textContent = text; tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); wrap.appendChild(table);
        announce(status, result.rows.length + ' transaction(s) parsed. Always compare them with the original statement.');
      }
      $('bk-parse').addEventListener('click', function () {
        if (!input.value.trim()) { announce(status, 'Paste statement text first.'); return; }
        render(R.parseStatement(input.value, { dateOrder: value('bk-date-order'), kind: value('bk-kind') }));
      });
      $('bk-sample').addEventListener('click', function () { input.value = SAMPLE; render(R.parseStatement(SAMPLE)); });
      $('bk-clear').addEventListener('click', function () { input.value = ''; parsed = null; $('bk-table').textContent = 'Parse a statement to see its transactions.'; $('bk-sum-transactions').textContent = '0'; $('bk-sum-in').textContent = '0.00'; $('bk-sum-out').textContent = '0.00'; $('bk-sum-check').textContent = 'No balances to check'; announce(status, 'Cleared.'); });
      $('bk-upload-btn').addEventListener('click', function () { $('bk-upload').click(); });
      $('bk-upload').addEventListener('change', function (event) {
        const file = event.target.files && event.target.files[0];
        readFile(file, function (text) { input.value = text; render(R.parseStatement(text, { dateOrder: value('bk-date-order') })); }, status);
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

    /* 03 — Handwriting to Font (scoped sampler) */
    if (slug === 'handwriting-to-font-converter') {
      const pad = $('hf-pad');
      const preview = $('hf-preview');
      const status = $('hf-status');
      const ctx = pad.getContext('2d');
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
        ctx.clearRect(0, 0, pad.width, pad.height);
        ctx.save();
        ctx.strokeStyle = '#cbd5e1';
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(90, 40, 340, 260);
        ctx.beginPath(); ctx.moveTo(90, 275); ctx.lineTo(430, 275); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillText('baseline', 20, 279);
        ctx.fillText(current === ' ' ? 'space' : current, 20, 60);
        ctx.restore();
        if (glyphs[current]) {
          const img = new Image();
          img.onload = function () { ctx.drawImage(img, 0, 0); };
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
        img.onload = function () { ctx.clearRect(0, 0, pad.width, pad.height); ctx.drawImage(img, 0, 0); glyphs[current] = pad.toDataURL(); };
        img.src = previous;
      });
      $('hf-clear').addEventListener('click', function () { saveUndo(); drawCurrent(); delete glyphs[current]; announce(status, 'Character cleared.'); });
      $('hf-pen-size').addEventListener('input', function () { $('hf-pen-size-label').textContent = value('hf-pen-size') + 'px'; });
      all('input[name="hf-group"]').forEach(function (el) { el.addEventListener('change', function () { setGroup(radioValue('hf-group')); }); });
      document.addEventListener('keydown', function (event) {
        if (event.target && /INPUT|TEXTAREA/.test(event.target.tagName)) return;
        const groups = radioValue('hf-group') || 'upper';
        const chars = sets[groups] || sets.upper;
        const index = chars.indexOf(current);
        if (event.key === 'ArrowRight' && index < chars.length - 1) { select(chars[index + 1]); }
        if (event.key === 'ArrowLeft' && index > 0) { select(chars[index - 1]); }
      });
      all('[data-hf-phrase]').forEach(function (button) {
        button.addEventListener('click', function () { $('hf-text').value = button.getAttribute('data-hf-phrase'); });
      });
      function buildPreview() {
        const pctx = preview.getContext('2d');
        pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, preview.width, preview.height);
        const text = value('hf-text');
        const size = Number(value('hf-size')) || 44;
        const gap = Number(value('hf-gap')) || 10;
        let x = 24, y = 40, drawn = 0, missing = 0;
        for (let i = 0; i < text.length; i++) {
          const char = text.charAt(i);
          if (char === '\n') { x = 24; y += size + 20; continue; }
          if (char === ' ') { x += size * 0.45 + gap; continue; }
          const data = glyphs[char];
          if (!data) { missing++; x += size * 0.6 + gap; continue; }
          const img = new Image();
          img.src = data;
          // draw lazily when the image is decoded; capture current x/y/size
          img.onload = (function (ix, iy, isz) {
            return function () { pctx.drawImage(img, ix, iy, isz, isz); };
          })(x, y, size);
          x += size + gap; drawn++;
          if (x > preview.width - size) { x = 24; y += size + 20; }
        }
        announce(status, drawn + ' glyph(s) previewed' + (missing ? ', ' + missing + ' not drawn yet' : '') + '. This is a picture preview, not a font file.');
      }
      $('hf-build').addEventListener('click', buildPreview);
      $('hf-download').addEventListener('click', function () {
        buildPreview();
        try {
          const link = document.createElement('a');
          link.download = 'handwriting-preview.png';
          link.href = preview.toDataURL('image/png');
          document.body.appendChild(link); link.click(); document.body.removeChild(link);
          announce(status, 'Preview image downloaded.');
        } catch (e) { announce(status, 'Download is not supported in this browser.'); }
      });
      setGroup('upper');
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
})();
