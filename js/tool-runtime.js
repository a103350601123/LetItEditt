/* LetitEdit tool runtime — renders controls and runs real browser-side text processing. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var configNode = document.getElementById('tool-config');
    if (!configNode || !window.TextCore) return;

    var config;
    try { config = JSON.parse(configNode.textContent); }
    catch (error) { showFatal('Tool configuration could not be read.'); return; }

    var controlsRoot = document.getElementById('controls');
    var input = document.getElementById('tool-input');
    var left = document.getElementById('tool-input-left');
    var right = document.getElementById('tool-input-right');
    var output = document.getElementById('tool-output');
    var status = document.getElementById('tool-status');
    var copyButton = document.getElementById('copy-output');
    var downloadButton = document.getElementById('download-output');
    var clearButton = document.getElementById('clear-input');
    var generateButton = document.getElementById('generate-output');
    var restoreButton = document.getElementById('restore-output');
    if (!output || !status) return;

    var latest = { text: '', html: '', map: null, error: false };
    var ToolCore = window.TextCore;

    function showFatal(message) {
      var target = document.getElementById('tool-output') || document.body;
      target.textContent = message;
    }

    function escapeHtml(value) {
      return ToolCore.escapeHtml(value);
    }

    function setStatus(message, isError) {
      status.textContent = message || '';
      status.style.color = isError ? '#b91c1c' : '';
      output.classList.toggle('is-error', !!isError);
    }

    function resultText(value) {
      return { mode: 'text', text: value, status: value ? '' : 'Output will appear here.' };
    }

    function resultError(message) {
      return { mode: 'text', text: message, status: message, error: true };
    }

    function statCard(label, value) {
      return '<div class="stat-box"><span class="stat-label">' + escapeHtml(label) + '</span>' +
        '<span class="stat-value">' + escapeHtml(value) + '</span></div>';
    }

    function renderControls() {
      if (!controlsRoot || !Array.isArray(config.controls)) return;
      controlsRoot.innerHTML = '';
      config.controls.forEach(function (control) {
        var id = 'control-' + control.key;
        if (control.type === 'checkbox') {
          var wrap = document.createElement('div');
          wrap.className = 'checkbox-field';
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.id = id;
          box.dataset.key = control.key;
          box.checked = control.default === true;
          var label = document.createElement('label');
          label.htmlFor = id;
          label.textContent = control.label;
          wrap.appendChild(box);
          wrap.appendChild(label);
          controlsRoot.appendChild(wrap);
          return;
        }

        var field = document.createElement('div');
        field.className = 'field';
        var labelEl = document.createElement('label');
        labelEl.htmlFor = id;
        labelEl.textContent = control.label;
        field.appendChild(labelEl);

        var el;
        if (control.type === 'select') {
          el = document.createElement('select');
          (control.options || []).forEach(function (option) {
            var opt = document.createElement('option');
            opt.value = option[0];
            opt.textContent = option[1];
            el.appendChild(opt);
          });
          el.value = control.default;
        } else {
          el = document.createElement('input');
          el.type = control.type === 'number' ? 'number' : 'text';
          if (control.type === 'number') {
            if (control.min !== undefined) el.min = control.min;
            if (control.max !== undefined) el.max = control.max;
          }
          if (control.placeholder) el.placeholder = control.placeholder;
          el.value = control.default === undefined ? '' : control.default;
        }
        el.id = id;
        el.dataset.key = control.key;
        field.appendChild(el);
        controlsRoot.appendChild(field);
      });

      controlsRoot.querySelectorAll('[data-key]').forEach(function (el) {
        el.addEventListener('input', function () { if (config.live !== false) render(); });
        el.addEventListener('change', function () { if (config.live !== false) render(); });
      });
    }

    function options() {
      var values = {};
      document.querySelectorAll('[data-key]').forEach(function (el) {
        values[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
      });
      return values;
    }

    function run(slug, value, cfg) {
      switch (slug) {
        case 'word-counter': {
          var stats = ToolCore.countStats(value, { ignoreStopWords: cfg.ignoreStopWords === true });
          var c = stats.counts;
          var html = '<div class="stats-grid">' +
            statCard('Words', c.words) + statCard('Characters', c.characters) +
            statCard('No spaces', c.charactersNoSpaces) + statCard('Letters', c.letters) +
            statCard('Sentences', c.sentences) + statCard('Paragraphs', c.paragraphs) +
            statCard('Lines', c.lines) + statCard('Reading time', c.readingMinutes + ' min') + '</div>';
          var summary = c.words + ' words · ' + c.characters + ' characters · ' + c.readingMinutes + ' min read';
          if (stats.keywordDensity.length) {
            html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Word</th><th>Count</th><th>Density</th></tr></thead><tbody>' +
              stats.keywordDensity.map(function (row) {
                return '<tr><td>' + escapeHtml(row.word) + '</td><td>' + row.count + '</td><td>' + row.density + '%</td></tr>';
              }).join('') + '</tbody></table></div>';
          }
          return { mode: 'html', html: html, text: summary, status: summary };
        }
        case 'text-cleaner':
          return resultText(ToolCore.cleanText(value, cfg));
        case 'remove-extra-spaces':
          return resultText(ToolCore.removeExtraSpaces(value));
        case 'remove-empty-lines':
          return resultText(ToolCore.removeEmptyLines(value, { preserveParagraphs: cfg.preserveParagraphs === true }));
        case 'remove-emojis':
          return resultText(ToolCore.removeEmojis(value));
        case 'remove-punctuation':
          return resultText(ToolCore.removePunctuation(value, { types: cfg.types, chars: cfg.chars }));
        case 'word-wrap':
          return resultText(ToolCore.wordWrap(value, cfg.width, { breakLongWords: cfg.breakLongWords === true }));
        case 'smart-quotes':
          return resultText(ToolCore.smartQuotes(value));
        case 'text-repeater':
          return resultText(ToolCore.repeatText(value, cfg.count, cfg.separator));
        case 'case-converter':
          return resultText(ToolCore.caseConvert(value, cfg.mode));
        case 'text-reverser':
          return resultText(ToolCore.reverseText(value, cfg.mode));
        case 'find-and-replace': {
          var replaced = ToolCore.findReplace(value, cfg);
          if (!replaced.ok) return resultError(replaced.error);
          return { mode: 'text', text: replaced.text, status: replaced.count + ' replacement' + (replaced.count === 1 ? '' : 's') + ' made.' };
        }
        case 'text-to-slug':
          return resultText(ToolCore.slugify(value, { max: cfg.max }));
        case 'text-to-list':
          return resultText(ToolCore.textToList(value, cfg));
        case 'add-prefix-suffix':
          return resultText(ToolCore.addAffix(value, cfg));
        case 'morse-code':
          return resultText(cfg.mode === 'decode' ? ToolCore.morseDecode(value) : ToolCore.morseEncode(value));
        case 'text-to-binary': {
          var encoded = ToolCore.textToBinary(value, { encoding: cfg.encoding });
          return encoded.ok ? resultText(encoded.text) : resultError(encoded.error);
        }
        case 'binary-to-text': {
          var decoded = ToolCore.binaryToText(value, { encoding: cfg.encoding });
          return decoded.ok ? resultText(decoded.text) : resultError(decoded.error);
        }
        case 'bionic-reading':
          return { mode: 'html', html: ToolCore.bionicReading(value, cfg.strength), text: value, status: 'Bold formatting is shown in the preview.' };
        case 'html-to-markdown':
          return resultText(ToolCore.htmlToMarkdown(value));
        case 'remove-duplicate-lines':
          return resultText(ToolCore.removeDuplicateLines(value, cfg));
        case 'duplicate-word-remover': {
          var deduped = ToolCore.duplicateWordRemover(value, cfg);
          return { mode: 'text', text: deduped.text, status: deduped.removed + ' duplicate word' + (deduped.removed === 1 ? '' : 's') + ' removed.' };
        }
        case 'text-sorter':
          return resultText(ToolCore.textSorter(value, cfg));
        case 'text-splitter':
          return resultText(ToolCore.textSplitter(value, cfg));
        case 'text-comparer': {
          var diff = ToolCore.textDiff(cfg.leftText, cfg.rightText, { unit: cfg.unit });
          return diff.ok
            ? { mode: 'html', html: diff.html, text: diff.html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), status: diff.added + ' added · ' + diff.removed + ' removed' }
            : resultError(diff.error);
        }
        case 'extract-emails':
          return resultText(ToolCore.extractEmails(value));
        case 'extract-urls':
          return resultText(ToolCore.extractUrls(value));
        case 'text-filter': {
          var filtered = ToolCore.textFilter(value, cfg);
          if (!filtered.ok) return resultError(filtered.error);
          return { mode: 'html', html: filtered.html, text: filtered.text, status: filtered.count + ' matching line' + (filtered.count === 1 ? '' : 's') + '.' };
        }
        case 'text-redactor': {
          var redacted = ToolCore.redactText(value, cfg);
          latest.map = redacted.map;
          return { mode: 'text', text: redacted.text, status: 'Review the result before sharing. Restore stays in this tab.' };
        }
        case 'lorem-ipsum-generator':
          return resultText(ToolCore.loremIpsum(cfg));
        default:
          return resultError('No processor is registered for this tool.');
      }
    }

    function paint(response) {
      latest.text = response.text || '';
      latest.html = response.html || '';
      latest.error = !!response.error;
      if (response.mode === 'html') output.innerHTML = response.html;
      else output.textContent = response.text;
      setStatus(response.status, !!response.error);
      if (restoreButton) restoreButton.hidden = config.slug !== 'text-redactor' || !latest.text;
    }

    function render() {
      var cfg = options();
      if (config.slug === 'text-comparer') {
        cfg.leftText = left ? left.value : '';
        cfg.rightText = right ? right.value : '';
        paint(run(config.slug, '', cfg));
        return;
      }
      paint(run(config.slug, input ? input.value : '', cfg));
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise(function (resolve, reject) {
        var temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        try {
          var ok = document.execCommand('copy');
          document.body.removeChild(temp);
          ok ? resolve() : reject(new Error('Copy failed'));
        } catch (error) {
          document.body.removeChild(temp);
          reject(error);
        }
      });
    }

    function copyOutput() {
      var plain = latest.text || (latest.html ? stripMarkup(latest.html) : '');
      if (!plain && !latest.html) {
        setStatus('Nothing to copy yet.', false);
        return;
      }
      var useHtml = config.outputType === 'html' && latest.html && navigator.clipboard && window.ClipboardItem;
      var payload = useHtml
        ? [new window.ClipboardItem({ 'text/html': new Blob([latest.html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]
        : [plain];
      var promise = useHtml ? navigator.clipboard.write(payload) : copyText(payload[0]);
      Promise.resolve(promise).then(function () {
        setStatus(useHtml ? 'Rich HTML copied.' : 'Output copied.', false);
      }).catch(function () {
        setStatus('Copy was blocked by the browser. Select the output and copy manually.', true);
      });
    }

    function stripMarkup(html) {
      return String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    }

    function downloadOutput() {
      var asHtml = config.outputType === 'html' && !!latest.html;
      var content = asHtml ? latest.html : (latest.text || stripMarkup(latest.html));
      if (!content) {
        setStatus('Nothing to download yet.', false);
        return;
      }
      var extension = asHtml ? 'html' : 'txt';
      var blob = new Blob([content], { type: extension === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = config.slug + '-output.' + extension;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus('Output downloaded.', false);
    }

    function clearAll() {
      if (input) input.value = '';
      if (left) left.value = '';
      if (right) right.value = '';
      render();
      if (input) input.focus();
    }

    function restore() {
      if (!latest.map) return;
      var restored = ToolCore.restoreText(latest.text, latest.map);
      paint(resultText(restored));
      setStatus('Original values restored in the output preview.', false);
    }

    renderControls();
    if (copyButton) copyButton.addEventListener('click', copyOutput);
    if (downloadButton) downloadButton.addEventListener('click', downloadOutput);
    if (clearButton) clearButton.addEventListener('click', clearAll);
    if (generateButton) generateButton.addEventListener('click', render);
    if (restoreButton) restoreButton.addEventListener('click', restore);
    if (input) {
      input.addEventListener('input', function () { if (config.live !== false) render(); });
    }
    [left, right].forEach(function (el) {
      if (el) el.addEventListener('input', function () { if (config.live !== false) render(); });
    });

    if (copyButton && config.outputType === 'html') copyButton.textContent = 'Copy rich HTML';
    if (restoreButton) restoreButton.hidden = config.slug !== 'text-redactor';
    render();
  });
})();
