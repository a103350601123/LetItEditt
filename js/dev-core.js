/* LetitEdit developer tools — pure browser-side processing functions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function str(value) { return value === null || value === undefined ? '' : String(value); }

  function escapeHtml(value) {
    return str(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function sortValue(value) {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
    }
    return value;
  }

  function formatJson(value, options) {
    const opts = options || {};
    const source = str(value).trim();
    if (!source) return { ok: true, text: '', error: '', characters: 0, lines: 0, status: 'Paste JSON to begin.' };
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      return { ok: false, text: '', error: 'Invalid JSON: ' + error.message, characters: 0, lines: 0 };
    }
    if (opts.sortKeys) parsed = sortValue(parsed);
    let output;
    if (opts.mode === 'minify') {
      output = JSON.stringify(parsed);
    } else {
      const indent = opts.indent === 'tab' ? '\t' : Math.max(1, Math.min(8, Number(opts.indent) || 2));
      output = JSON.stringify(parsed, null, indent);
    }
    return {
      ok: true,
      text: output,
      error: '',
      characters: output.length,
      lines: output ? output.split('\n').length : 0,
      status: (opts.mode === 'minify' ? 'Minified' : 'Formatted') + ' JSON · ' + output.length + ' characters · ' + (output ? output.split('\n').length : 0) + ' lines'
    };
  }

  function encodeBase64Bytes(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    if (typeof btoa === 'function') return btoa(binary);
    if (typeof Buffer !== 'undefined') return Buffer.from(binary, 'binary').toString('base64');
    throw new Error('Base64 encoding is not available in this browser.');
  }

  function decodeBase64Bytes(value) {
    if (typeof atob === 'function') return atob(value);
    if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('binary');
    throw new Error('Base64 decoding is not available in this browser.');
  }

  function base64Encode(value, options) {
    const opts = options || {};
    try {
      const bytes = new TextEncoder().encode(str(value));
      let output = encodeBase64Bytes(bytes);
      if (opts.urlSafe) output = output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      return { ok: true, text: output, error: '', bytes: bytes.length, status: 'Encoded ' + bytes.length + ' UTF-8 byte' + (bytes.length === 1 ? '' : 's') + '.' };
    } catch (error) {
      return { ok: false, text: '', error: error.message, bytes: 0 };
    }
  }

  function base64Decode(value, options) {
    const opts = options || {};
    const source = str(value).replace(/\s+/g, '');
    if (!source) return { ok: true, text: '', error: '', bytes: 0, status: 'Paste Base64 to begin.' };
    let normalized = source.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
      return { ok: false, text: '', error: 'Invalid Base64: use only A–Z, a–z, 0–9, +, /, - or _ characters.', bytes: 0 };
    }
    if (normalized.length % 4 === 1) {
      return { ok: false, text: '', error: 'Invalid Base64 length. Add or remove characters before decoding.', bytes: 0 };
    }
    normalized += '='.repeat((4 - normalized.length % 4) % 4);
    try {
      const binary = decodeBase64Bytes(normalized);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { ok: true, text, error: '', bytes: bytes.length, status: 'Decoded ' + bytes.length + ' byte' + (bytes.length === 1 ? '' : 's') + ' as UTF-8 text.' };
    } catch (error) {
      return {
        ok: false,
        text: '',
        error: opts.urlSafe ? 'Invalid Base64 data.' : 'Invalid Base64 or the decoded bytes are not valid UTF-8 text.',
        bytes: 0
      };
    }
  }

  function regexFlags(options) {
    const opts = options || {};
    let flags = '';
    if (opts.global !== false) flags += 'g';
    if (opts.ignoreCase) flags += 'i';
    if (opts.multiline) flags += 'm';
    if (opts.dotAll) flags += 's';
    if (opts.unicode) flags += 'u';
    return flags;
  }

  function matchRows(matches) {
    return matches.map((match, index) => {
      const plainGroups = match.slice(1).map(group => group === undefined ? '' : group);
      const namedGroups = match.groups ? Object.entries(match.groups) : [];
      const groupText = [
        ...plainGroups.map((group, groupIndex) => '$' + (groupIndex + 1) + ': ' + group),
        ...namedGroups.map(([name, group]) => name + ': ' + (group === undefined ? '' : group))
      ].filter(Boolean).join(' | ');
      return { index: index + 1, match: match[0], start: match.index, groups: groupText };
    });
  }

  function renderRegexHtml(text, matches, replacement, replaced) {
    let cursor = 0;
    const pieces = [];
    matches.forEach(match => {
      const start = match.index;
      const end = start + match[0].length;
      if (start > cursor) pieces.push(escapeHtml(text.slice(cursor, start)));
      if (end > start) pieces.push('<mark class="regex-match">' + escapeHtml(match[0]) + '</mark>');
      else pieces.push('<span class="regex-zero" title="Zero-length match">∅</span>');
      cursor = end;
    });
    pieces.push(escapeHtml(text.slice(cursor)));
    const rows = matchRows(matches);
    const rowsHtml = rows.length
      ? `<div class="table-wrap"><table class="data-table regex-table"><thead><tr><th>#</th><th>Match</th><th>Start</th><th>Groups</th></tr></thead><tbody>${rows.map(row =>
          '<tr><td>' + row.index + '</td><td><code>' + escapeHtml(row.match) + '</code></td><td>' + row.start + '</td><td>' + (row.groups ? escapeHtml(row.groups) : '—') + '</td></tr>'
        ).join('')}</tbody></table></div>`
      : '<p class="regex-empty">No matches found.</p>';
    const replacementHtml = replacement
      ? `<h3 class="regex-subhead">Replacement output</h3><pre class="regex-replacement">${escapeHtml(replaced)}</pre>`
      : '';
    return `<div class="regex-summary"><strong>${matches.length}</strong> match${matches.length === 1 ? '' : 'es'} found</div>
      <div class="regex-preview">${pieces.join('') || '<span class="regex-empty">Test string is empty.</span>'}</div>
      ${replacementHtml}
      ${rowsHtml}`;
  }

  function testRegex(value, options) {
    const opts = options || {};
    const text = str(value);
    const pattern = str(opts.pattern);
    if (!pattern) return { ok: true, text: '', html: '', count: 0, error: '', status: 'Enter a regular expression to begin.' };
    let regex;
    try {
      regex = new RegExp(pattern, regexFlags(opts));
    } catch (error) {
      return { ok: false, text: '', html: '', count: 0, error: 'Invalid regular expression: ' + error.message };
    }
    if (!text) {
      return {
        ok: true,
        text: '',
        html: '<p class="regex-empty">Test string is empty.</p>',
        count: 0,
        error: '',
        status: 'Test string is empty.'
      };
    }
    const matches = [];
    let match;
    try {
      while ((match = regex.exec(text)) !== null) {
        matches.push(match);
        if (!regex.global) break;
        if (match[0] === '') {
          const codePoint = text.codePointAt(regex.lastIndex);
          regex.lastIndex += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
        }
        if (matches.length >= 1000) break;
      }
    } catch (error) {
      return { ok: false, text: '', html: '', count: 0, error: 'Regular expression failed: ' + error.message };
    }
    const replacement = str(opts.replacement);
    let replaced = '';
    if (replacement) {
      try {
        replaced = text.replace(new RegExp(pattern, regexFlags(opts)), replacement);
      } catch (error) {
        return { ok: false, text: '', html: '', count: 0, error: 'Replacement failed: ' + error.message };
      }
    }
    const html = renderRegexHtml(text, matches, replacement, replaced);
    const textOutput = replacement ? replaced : matches.map(item => item[0]).join('\n');
    const capped = matches.length >= 1000 ? ' Showing the first 1,000 matches.' : '';
    return {
      ok: true,
      text: textOutput,
      html,
      count: matches.length,
      error: '',
      status: matches.length + ' match' + (matches.length === 1 ? '' : 'es') + ' found.' + capped
    };
  }

  return { escapeHtml, formatJson, base64Encode, base64Decode, testRegex, regexFlags };
});
