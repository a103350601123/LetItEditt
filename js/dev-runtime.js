/* LetitEdit developer tool runtime — renders controls and runs real browser-side processing. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var configNode = document.getElementById('tool-config');
    if (!configNode || !window.DevCore) return;

    var config;
    try { config = JSON.parse(configNode.textContent); }
    catch (error) { showFatal('Tool configuration could not be read.'); return; }

    var Core = window.DevCore;
    var controlsRoot = document.getElementById('controls');
    var input = document.getElementById('tool-input');
    var inputLabel = document.getElementById('tool-input-label');
    var output = document.getElementById('tool-output');
    var status = document.getElementById('tool-status');
    var copyButton = document.getElementById('copy-output');
    var downloadButton = document.getElementById('download-output');
    var clearButton = document.getElementById('clear-input');
    var exampleButton = document.getElementById('load-example');
    var swapButton = document.getElementById('swap-output');
    if (!output || !status) return;

    var latest = { text: '', error: false };

    function showFatal(message) {
      var target = document.getElementById('tool-output') || document.body;
      target.textContent = message;
    }

    function setStatus(message, isError) {
      status.textContent = message || '';
      status.style.color = isError ? '#b91c1c' : '';
      output.classList.toggle('is-error', !!isError);
    }

    function resultText(text, statusMessage) {
      return { mode: 'text', text: text, display: text, status: statusMessage || (text ? '' : 'Output will appear here.') };
    }

    function resultError(message) {
      return { mode: 'text', text: '', display: message, status: message, error: true };
    }

    function control(key) {
      return controlsRoot ? controlsRoot.querySelector('[data-key="' + key + '"]') : null;
    }

    function controlValue(key) {
      var el = control(key);
      if (!el) return undefined;
      return el.type === 'checkbox' ? el.checked : el.value;
    }

    function setControl(key, value) {
      var el = control(key);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = value === true;
      else el.value = value === undefined || value === null ? '' : String(value);
    }

    function renderControls() {
      if (!controlsRoot || !Array.isArray(config.controls)) return;
      controlsRoot.innerHTML = '';
      config.controls.forEach(function (item) {
        var id = 'control-' + item.key;
        if (item.type === 'checkbox') {
          var wrap = document.createElement('div');
          wrap.className = 'checkbox-field';
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.id = id;
          box.dataset.key = item.key;
          box.checked = item.default === true;
          var label = document.createElement('label');
          label.htmlFor = id;
          label.textContent = item.label;
          wrap.appendChild(box);
          wrap.appendChild(label);
          controlsRoot.appendChild(wrap);
          return;
        }

        var field = document.createElement('div');
        field.className = 'field';
        var labelEl = document.createElement('label');
        labelEl.htmlFor = id;
        labelEl.textContent = item.label;
        field.appendChild(labelEl);

        var el;
        if (item.type === 'select') {
          el = document.createElement('select');
          (item.options || []).forEach(function (option) {
            var opt = document.createElement('option');
            opt.value = option[0];
            opt.textContent = option[1];
            el.appendChild(opt);
          });
          el.value = item.default;
        } else {
          el = document.createElement('input');
          el.type = item.type === 'number' ? 'number' : 'text';
          if (item.type === 'number') {
            if (item.min !== undefined) el.min = item.min;
            if (item.max !== undefined) el.max = item.max;
          }
          if (item.placeholder) el.placeholder = item.placeholder;
          el.value = item.default === undefined ? '' : item.default;
        }
        el.id = id;
        el.dataset.key = item.key;
        field.appendChild(el);
        controlsRoot.appendChild(field);
      });

      controlsRoot.querySelectorAll('[data-key]').forEach(function (el) {
        el.addEventListener('input', render);
        el.addEventListener('change', render);
      });
    }

    function updateInputUi() {
      if (!input) return;
      if (config.kind === 'base64') {
        var decoding = controlValue('mode') === 'decode';
        if (inputLabel) inputLabel.textContent = decoding ? 'Base64 to decode' : 'Text to encode';
        input.placeholder = decoding ? 'Paste Base64 here…' : 'Type or paste the text you want to encode…';
      } else if (inputLabel && config.inputLabel) {
        inputLabel.textContent = config.inputLabel;
      }
      if (input.placeholder === undefined || input.placeholder === '') input.placeholder = config.placeholder || '';
    }

    function runJson() {
      var result = Core.formatJson(input ? input.value : '', {
        mode: controlValue('mode'),
        indent: controlValue('indent'),
        sortKeys: controlValue('sortKeys') === true
      });
      if (!result.ok) return resultError(result.error);
      return resultText(result.text, result.status);
    }

    function runBase64() {
      var mode = controlValue('mode') === 'decode' ? 'decode' : 'encode';
      var source = input ? input.value : '';
      if (!source) return resultText('', mode === 'decode' ? 'Paste Base64 to begin.' : 'Paste text to begin.');
      var result = mode === 'decode'
        ? Core.base64Decode(source, { urlSafe: controlValue('urlSafe') === true })
        : Core.base64Encode(source, { urlSafe: controlValue('urlSafe') === true });
      if (!result.ok) return resultError(result.error);
      return resultText(result.text, result.status);
    }

    function runRegex() {
      var pattern = controlValue('pattern') || '';
      if (!pattern) {
        return {
          mode: 'html',
          html: '<p class="regex-empty">Enter a regular expression to see matches.</p>',
          text: '',
          status: 'Enter a regular expression to begin.'
        };
      }
      var result = Core.testRegex(input ? input.value : '', {
        pattern: pattern,
        replacement: controlValue('replacement') || '',
        global: controlValue('global') !== false,
        ignoreCase: controlValue('ignoreCase') === true,
        multiline: controlValue('multiline') === true,
        dotAll: controlValue('dotAll') === true,
        unicode: controlValue('unicode') === true
      });
      if (!result.ok) return resultError(result.error);
      return {
        mode: 'html',
        html: result.html,
        text: result.text,
        status: result.status
      };
    }

    function run() {
      switch (config.kind) {
        case 'json': return runJson();
        case 'base64': return runBase64();
        case 'regex': return runRegex();
        default: return resultError('No processor is registered for this tool.');
      }
    }

    function paint(response) {
      latest.text = response.text || '';
      latest.error = !!response.error;
      if (response.mode === 'html') output.innerHTML = response.html || '';
      else output.textContent = response.display !== undefined ? response.display : (response.text || '');
      setStatus(response.status, !!response.error);
    }

    function render() {
      updateInputUi();
      paint(run());
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
      if (!latest.text) {
        setStatus('There is nothing to copy yet.', true);
        return;
      }
      Promise.resolve(copyText(latest.text)).then(function () {
        setStatus('Output copied.', false);
      }).catch(function () {
        setStatus('Copy was blocked by the browser. Select the output and copy manually.', true);
      });
    }

    function downloadOutput() {
      if (!latest.text) {
        setStatus('There is nothing to download yet.', true);
        return;
      }
      var isJson = config.kind === 'json';
      var extension = isJson ? 'json' : 'txt';
      var type = isJson ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
      var blob = new Blob([latest.text], { type: type });
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

    function loadExample() {
      if (!config.example || !input) return;
      input.value = config.example.input || '';
      if (config.kind === 'regex') {
        setControl('pattern', config.example.pattern || '');
        setControl('replacement', config.example.replacement || '');
      }
      render();
      input.focus();
    }

    function swapDirection() {
      if (config.kind !== 'base64') return;
      var mode = control('mode');
      if (!mode) return;
      if (!latest.text) {
        setStatus('Produce a result before swapping direction.', true);
        return;
      }
      mode.value = mode.value === 'decode' ? 'encode' : 'decode';
      if (input) input.value = latest.text;
      render();
      if (input) input.focus();
    }

    function clearAll() {
      if (!input) return;
      input.value = '';
      render();
      input.focus();
    }

    renderControls();
    if (copyButton) copyButton.addEventListener('click', copyOutput);
    if (downloadButton) downloadButton.addEventListener('click', downloadOutput);
    if (clearButton) clearButton.addEventListener('click', clearAll);
    if (exampleButton) exampleButton.addEventListener('click', loadExample);
    if (swapButton) {
      swapButton.hidden = config.kind !== 'base64';
      swapButton.addEventListener('click', swapDirection);
    }
    if (input) input.addEventListener('input', render);
    if (inputLabel && config.inputLabel) inputLabel.textContent = config.inputLabel;
    render();
  });
})();
