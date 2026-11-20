/* LetitEdit — pure text-processing functions. No DOM, no network, no side effects. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TextCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STOP_WORDS = new Set(('a an and are as at be but by for from has have if in into is it its of on or our that the their this to was were will with you your').split(' '));

  function str(value) { return value === null || value === undefined ? '' : String(value); }
  function normalizeNewlines(value) { return str(value).replace(/\r\n?/g, '\n'); }

  function graphemes(value) {
    const text = str(value);
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment);
    }
    return Array.from(text);
  }

  function words(value) {
    const text = str(value);
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text))
        .filter(s => s.isWordLike).map(s => s.segment);
    }
    return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
  }

  function sentences(value) {
    const text = str(value).trim();
    if (!text) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text), s => s.segment.trim()).filter(Boolean);
    }
    return text.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u).map(s => s.trim()).filter(Boolean);
  }

  function paragraphs(value) {
    return normalizeNewlines(value).split(/\n[ \t]*\n+/).map(p => p.trim()).filter(Boolean);
  }

  function lines(value) {
    const text = normalizeNewlines(value);
    return text === '' ? [] : text.split('\n');
  }

  function countStats(value, options) {
    const opts = options || {};
    const text = str(value);
    const wordList = words(text);
    const lowerWords = wordList.map(w => w.toLocaleLowerCase());
    const filtered = opts.ignoreStopWords ? lowerWords.filter(w => w && !STOP_WORDS.has(w)) : lowerWords;
    const freq = new Map();
    filtered.forEach(w => { if (w) freq.set(w, (freq.get(w) || 0) + 1); });
    const total = filtered.length || wordList.length;
    const density = Array.from(freq, ([word, count]) => ({ word, count, density: total ? +(count / total * 100).toFixed(2) : 0 }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
      .slice(0, 10);
    const counts = {
      words: wordList.length,
      characters: graphemes(text).length,
      charactersNoSpaces: graphemes(text).filter(g => !/\s/u.test(g)).length,
      letters: Array.from(text).filter(ch => /\p{L}/u.test(ch)).length,
      sentences: sentences(text).length,
      paragraphs: paragraphs(text).length,
      lines: lines(text).length
    };
    counts.readingMinutes = counts.words === 0 ? 0 : Math.max(1, Math.ceil(counts.words / 200));
    return { counts, keywordDensity: density };
  }

  function escapeRegex(value) {
    return str(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function slugify(value, options) {
    const opts = options || {};
    const max = opts.max || 80;
    let out = str(value).normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '');
    if (opts.lowercase === false) out = str(value).trim();
    return out;
  }

  function reverseText(value, mode) {
    const text = str(value);
    if (mode === 'lines') return lines(text).reverse().join('\n');
    if (mode === 'words') {
      const tokens = text.match(/\S+|\s+/g) || [];
      const wordTokens = tokens.filter(t => /\S/.test(t)).reverse();
      let i = 0;
      return tokens.map(t => /\S/.test(t) ? wordTokens[i++] : t).join('');
    }
    return graphemes(text).reverse().join('');
  }

  function removeExtraSpaces(value) {
    return normalizeNewlines(value)
      .split('\n')
      .map(line => line.replace(/[\t ]+/g, ' ').replace(/^ +| +$/g, ''))
      .join('\n');
  }

  function cleanText(value, options) {
    const opts = options || {};
    let text = normalizeNewlines(value);
    if (opts.normalizeUnicode) text = text.normalize('NFC');
    if (opts.zeroWidth) {
      text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '');
    }
    if (opts.tabs) text = text.replace(/\t/g, ' ');
    if (opts.collapseSpaces) text = text.replace(/[ ]{2,}/g, ' ');
    if (opts.trim) text = text.split('\n').map(line => line.trim()).join('\n');
    return text;
  }

  function removeEmptyLines(value, options) {
    const opts = options || {};
    const source = normalizeNewlines(value).split('\n');
    if (!opts.preserveParagraphs) {
      return source.filter(line => line.trim() !== '').join('\n');
    }
    const output = [];
    let previousEmpty = false;
    source.forEach(line => {
      const empty = line.trim() === '';
      if (empty) {
        if (output.length && !previousEmpty) output.push('');
        previousEmpty = true;
      } else {
        output.push(line);
        previousEmpty = false;
      }
    });
    while (output.length && output[output.length - 1] === '') output.pop();
    return output.join('\n');
  }

  function removeEmojis(value) {
    return str(value).replace(/(?:[\uFE0F\u200D]|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator})/gu, '');
  }

  function removePunctuation(value, options) {
    const opts = options || {};
    const mode = opts.types || 'all';
    if (mode === 'custom') {
      const chars = str(opts.chars).replace(/[\\\]^-]/g, '\\$&');
      return chars ? str(value).replace(new RegExp('[' + chars + ']', 'gu'), '') : str(value);
    }
    if (mode === 'common') return str(value).replace(/[.,!?;:'"()\[\]{}]/g, '');
    return str(value).replace(/[\p{P}]/gu, '');
  }

  function wordWrap(value, width, options) {
    const opts = options || {};
    const max = Math.max(10, Math.min(200, Number(width) || 60));
    const breakLong = !!opts.breakLongWords;
    return normalizeNewlines(value).split('\n').map(paragraph => {
      if (!paragraph.trim()) return '';
      const source = paragraph.trim().split(/\s+/);
      const out = [];
      let line = '';
      source.forEach(word => {
        let current = word;
        if (breakLong) {
          while (current.length > max) {
            if (line) { out.push(line); line = ''; }
            out.push(current.slice(0, max));
            current = current.slice(max);
          }
        }
        if (!line) line = current;
        else if (line.length + 1 + current.length <= max) line += ' ' + current;
        else { out.push(line); line = current; }
      });
      if (line) out.push(line);
      return out.join('\n');
    }).join('\n');
  }

  function smartQuotes(value) {
    return str(value)
      .replace(/(^|[\s([{])"([^"\n]*)"/g, '$1“$2”')
      .replace(/(^|[\s([{])'([^'\n]*)'/g, '$1‘$2’')
      .replace(/"/g, '”')
      .replace(/'/g, '’');
  }

  function repeatText(value, count, separator) {
    const n = Math.max(1, Math.min(1000, Number(count) || 1));
    const sep = separator === undefined || separator === null ? '\n' : separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return Array(n).fill(str(value)).join(sep);
  }

  function capitalizeWord(word) {
    return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
  }

  function caseConvert(value, mode) {
    const text = str(value);
    switch (mode) {
      case 'lower': return text.toLocaleLowerCase();
      case 'upper': return text.toLocaleUpperCase();
      case 'title': return text.replace(/[\p{L}\p{N}]+/gu, capitalizeWord);
      case 'sentence': {
        let first = true;
        return text.replace(/[\p{L}\p{N}]+/gu, word => {
          const out = first ? capitalizeWord(word) : word.toLocaleLowerCase();
          first = false;
          return out;
        });
      }
      case 'capital': return text.replace(/[\p{L}\p{N}]+/gu, capitalizeWord);
      case 'alternating': {
        let i = 0;
        return text.replace(/[\p{L}\p{N}]+/gu, word => {
          const out = i % 2 === 0 ? word.toLocaleUpperCase() : word.toLocaleLowerCase();
          i++;
          return out;
        });
      }
      case 'inverse': {
        let i = 0;
        return text.replace(/[\p{L}\p{N}]+/gu, word => {
          const out = i % 2 === 0 ? word.toLocaleLowerCase() : word.toLocaleUpperCase();
          i++;
          return out;
        });
      }
      case 'ap': {
        const minor = new Set(('a an the and but or for nor on at to from by in of as if via with').split(' '));
        const tokens = text.split(/(\s+)/);
        const positions = tokens.map((t, i) => /\S/.test(t) ? i : -1).filter(i => i >= 0);
        positions.forEach((pos, index) => {
          const original = tokens[pos];
          const match = original.match(/[\p{L}\p{N}]+/u);
          if (!match) return;
          const word = match[0];
          const lower = word.toLocaleLowerCase();
          const replacement = (index === 0 || index === positions.length - 1 || !minor.has(lower))
            ? capitalizeWord(word) : lower;
          tokens[pos] = original.replace(word, replacement);
        });
        return tokens.join('');
      }
      default: return text;
    }
  }

  function findReplace(value, options) {
    const opts = options || {};
    const text = str(value);
    const find = str(opts.find);
    if (!find) return { ok: true, text, count: 0, error: '' };
    let pattern = opts.regex ? find : escapeRegex(find);
    if (!opts.regex && opts.wholeWord) {
      pattern = '(?<![\\p{L}\\p{N}_])' + pattern + '(?![\\p{L}\\p{N}_])';
    }
    try {
      const flags = 'gu' + (opts.caseSensitive ? '' : 'i');
      const re = new RegExp(pattern, flags);
      let count = 0;
      const output = text.replace(re, () => { count++; return str(opts.replace); });
      return { ok: true, text: output, count, error: '' };
    } catch (error) {
      return { ok: false, text, count: 0, error: error.message };
    }
  }

  function textToList(value, options) {
    const opts = options || {};
    const text = str(value);
    const delimiter = opts.delimiter === '\\n' ? '\n' : str(opts.delimiter || ',');
    const raw = delimiter === '\n' ? lines(text) : text.split(delimiter);
    const parts = raw.map(p => p.trim()).filter(p => opts.skipEmpty === false || p !== '');
    return parts.map((p, i) => opts.numbered ? (i + 1) + '. ' + p : p).join('\n');
  }

  function addAffix(value, options) {
    const opts = options || {};
    return lines(value).map(line => {
      if (opts.skipEmpty && !line.trim()) return line;
      return str(opts.prefix) + line + str(opts.suffix);
    }).join('\n');
  }

  function textToBinary(value, options) {
    const structured = arguments.length > 1;
    const opts = options || {};
    const text = str(value);
    const encoding = opts.encoding === 'ascii' || opts.encoding === 'utf-16' ? opts.encoding : 'utf-8';
    const finish = (bits, groupSize, error) => structured
      ? { ok: !error, text: error ? '' : bits, error: error || '', groupSize }
      : (error ? '' : bits);
    if (encoding === 'ascii') {
      const bad = Array.from(text).find(ch => ch.codePointAt(0) > 127);
      if (bad) return finish('', 8, 'ASCII supports characters 0–127 only. Remove or switch encoding for: ' + bad);
      return finish(Array.from(text, ch => ch.charCodeAt(0).toString(2).padStart(8, '0')).join(' '), 8, '');
    }
    if (encoding === 'utf-16') {
      const groups = [];
      Array.from(text).forEach(ch => {
        const cp = ch.codePointAt(0);
        if (cp > 0xffff) {
          const high = 0xd800 + ((cp - 0x10000) >> 10);
          const low = 0xdc00 + ((cp - 0x10000) & 0x3ff);
          groups.push(high.toString(2).padStart(16, '0'), low.toString(2).padStart(16, '0'));
        } else {
          groups.push(cp.toString(2).padStart(16, '0'));
        }
      });
      return finish(groups.join(' '), 16, '');
    }
    const bytes = new TextEncoder().encode(text);
    return finish(Array.from(bytes, b => b.toString(2).padStart(8, '0')).join(' '), 8, '');
  }

  function binaryToText(value, options) {
    const opts = options || {};
    const raw = str(value).trim();
    if (!raw) return { ok: true, text: '', error: '' };
    const encoding = opts.encoding === 'ascii' || opts.encoding === 'utf-16' ? opts.encoding : 'utf-8';
    const groupSize = encoding === 'utf-16' ? 16 : 8;
    const parts = raw.split(/\s+/).filter(Boolean);
    const nonBinary = parts.find(part => !/^[01]+$/.test(part));
    if (nonBinary) {
      return { ok: false, text: '', error: 'Invalid binary group. Use only 0 and 1 in each group. Invalid group: ' + nonBinary };
    }
    const bad = parts.find(part => part.length !== groupSize);
    if (bad) {
      return { ok: false, text: '', error: 'Use ' + groupSize + '-bit groups separated by spaces. Invalid group: ' + bad };
    }
    try {
      if (encoding === 'utf-16') {
        const units = parts.map(part => parseInt(part, 2));
        let decodedUtf16 = '';
        for (let i = 0; i < units.length; i += 8192) {
          decodedUtf16 += String.fromCharCode.apply(null, units.slice(i, i + 8192));
        }
        return { ok: true, text: decodedUtf16, error: '' };
      }
      const values = parts.map(part => parseInt(part, 2));
      if (encoding === 'ascii') {
        const invalid = values.find(byte => byte > 127);
        if (invalid !== undefined) {
          return { ok: false, text: '', error: 'ASCII bytes must be 0–127. Received: ' + invalid };
        }
      }
      const bytes = new Uint8Array(values);
      const decoded = new TextDecoder(encoding === 'ascii' ? 'windows-1252' : 'utf-8', { fatal: true }).decode(bytes);
      return { ok: true, text: decoded, error: '' };
    } catch (error) {
      return { ok: false, text: '', error: 'These bytes are not valid ' + (encoding === 'utf-8' ? 'UTF-8' : 'ASCII') + ' text.' };
    }
  }

  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
    '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
  };
  const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

  function morseEncode(value) {
    const words = str(value).toLocaleUpperCase().trim().split(/\s+/).filter(Boolean);
    return words.map(word => graphemes(word).map(ch => MORSE[ch] || '').filter(Boolean).join(' ')).filter(Boolean).join(' / ');
  }

  function morseDecode(value) {
    return str(value).trim().split(/\s*\/\s*/).map(wordGroup =>
      wordGroup.trim().split(/\s+/).filter(Boolean).map(code => MORSE_REVERSE[code] || '').join('')
    ).filter(Boolean).join(' ');
  }

  function escapeHtml(value) {
    return str(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function bionicReading(value, strength) {
    const n = Math.max(1, Math.min(5, Number(strength) || 2));
    return (str(value).match(/\S+|\s+/g) || []).map(token => {
      if (/^\s+$/.test(token)) return escapeHtml(token);
      const letters = Array.from(token);
      let count = 0;
      let splitAt = 0;
      for (let i = 0; i < letters.length; i++) {
        if (/\p{L}/u.test(letters[i])) count++;
        if (count === n) { splitAt = i + 1; break; }
      }
      if (!splitAt) splitAt = Math.min(1, letters.length);
      return '<strong>' + escapeHtml(letters.slice(0, splitAt).join('')) + '</strong>' + escapeHtml(letters.slice(splitAt).join(''));
    }).join('');
  }

  function escapeMarkdownText(text) {
    return str(text).replace(/[\\`*_[\]<>]/g, ch => '\\' + ch).replace(/\r/g, '');
  }

  function htmlToMarkdown(value) {
    const source = str(value);
    if (!source.trim()) return '';
    if (typeof DOMParser === 'undefined') {
      return source
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }
    const doc = new DOMParser().parseFromString(source, 'text/html');

    function inline(node) {
      let out = '';
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
          out += escapeMarkdownText(child.textContent || '');
          return;
        }
        if (child.nodeType !== 1) return;
        const tag = child.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'template'].includes(tag)) return;
        if (tag === 'br') { out += '  \n'; return; }
        if (tag === 'wbr') return;
        const inner = inline(child).replace(/[ \t]+/g, ' ');
        if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
        else if (tag === 'em' || tag === 'i') out += '_' + inner + '_';
        else if (tag === 'del' || tag === 's' || tag === 'strike') out += '~~' + inner + '~~';
        else if (tag === 'code') out += '`' + inner.replace(/`/g, '\\`') + '`';
        else if (tag === 'a') {
          const href = (child.getAttribute('href') || '').replace(/[()\s]/g, encodeURIComponent);
          out += '[' + inner.replace(/\]/g, '\\]') + '](' + href + ')';
        } else if (tag === 'img') {
          const alt = escapeMarkdownText(child.getAttribute('alt') || '');
          const src = (child.getAttribute('src') || '').replace(/\s/g, encodeURIComponent);
          const title = child.getAttribute('title');
          out += '![' + alt + '](' + src + (title ? ' "' + escapeMarkdownText(title) + '"' : '') + ')';
        } else if (tag === 'input' && child.type === 'checkbox') {
          out += child.checked ? '[x] ' : '[ ] ';
        } else out += inner;
      });
      return out.replace(/\n[ \t]+/g, '\n').trim();
    }

    function listMarkdown(list, depth) {
      const ordered = list.tagName.toLowerCase() === 'ol';
      const lines = [];
      let index = Number(list.getAttribute('start')) || 1;
      Array.from(list.children).forEach(child => {
        if (child.tagName.toLowerCase() !== 'li') return;
        const parts = [];
        let checkbox = '';
        child.childNodes.forEach(node => {
          if (node.nodeType === 1 && /^(UL|OL)$/i.test(node.tagName)) {
            parts.push(listMarkdown(node, depth + 1));
          } else if (node.nodeType === 1 && node.querySelector && node.querySelector(':scope > ul, :scope > ol')) {
            const nested = node.querySelector(':scope > ul, :scope > ol');
            const clone = node.cloneNode(true);
            const nestedClone = clone.querySelector(':scope > ul, :scope > ol');
            if (nestedClone) nestedClone.remove();
            parts.push(inline(clone));
            parts.push(listMarkdown(nested, depth + 1));
          } else if (node.nodeType === 1 && node.tagName.toLowerCase() === 'input' && node.type === 'checkbox') {
            checkbox = node.checked ? '[x] ' : '[ ] ';
          } else {
            parts.push(inline(node.nodeType === 1 ? node : { childNodes: [node] }));
          }
        });
        const content = parts.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
        const prefix = '  '.repeat(depth) + (ordered ? index + '. ' : '- ') + checkbox;
        lines.push(content.split('\n').map((line, i) => i === 0 ? prefix + line : '  '.repeat(depth + 1) + line).join('\n'));
        index += 1;
      });
      return lines.join('\n');
    }

    function tableMarkdown(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (!rows.length) return '';
      const cells = row => Array.from(row.children)
        .filter(cell => /^(TH|TD)$/i.test(cell.tagName))
        .map(cell => inline(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || ' ');
      const header = cells(rows[0]);
      if (!header.length) return '';
      const body = rows.slice(1).map(cells);
      return ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |']
        .concat(body.map(row => '| ' + row.join(' | ') + ' |')).join('\n');
    }

    const blocks = [];
    function walk(parent) {
      Array.from(parent.childNodes).forEach(node => {
        if (node.nodeType === 3) {
          const text = node.textContent.trim();
          if (text) blocks.push(escapeMarkdownText(text));
          return;
        }
        if (node.nodeType !== 1) return;
        const tag = node.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'template'].includes(tag)) return;
        if (/^h[1-6]$/.test(tag)) {
          blocks.push('#'.repeat(Number(tag[1])) + ' ' + inline(node));
        } else if (tag === 'pre') {
          const code = (node.textContent || '').replace(/\n$/, '');
          const codeElement = node.querySelector ? node.querySelector(':scope code') : null;
          const language = Array.from(node.classList || []).find(c => /^language-/.test(c))
            || (codeElement && Array.from(codeElement.classList || []).find(c => /^language-/.test(c)));
          blocks.push('```' + (language ? language.slice(9) : '') + '\n' + code + '\n```');
        } else if (tag === 'blockquote') {
          const quoted = [];
          walkInto(node, quoted);
          blocks.push(quoted.join('\n\n').split('\n').map(line => '> ' + line).join('\n'));
        } else if (tag === 'ul' || tag === 'ol') {
          blocks.push(listMarkdown(node, 0));
        } else if (tag === 'table') {
          blocks.push(tableMarkdown(node));
        } else if (tag === 'hr') {
          blocks.push('---');
        } else if (tag === 'img') {
          blocks.push(inline(node));
        } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'figure' || tag === 'header' || tag === 'footer') {
          const direct = inline(node);
          const nestedLists = Array.from(node.querySelectorAll(':scope > ul, :scope > ol, :scope > table, :scope > pre'));
          if (direct) blocks.push(direct);
          nestedLists.forEach(nested => {
            const nestedTag = nested.tagName.toLowerCase();
            blocks.push(nestedTag === 'table' ? tableMarkdown(nested) : nestedTag === 'pre' ? '```\n' + nested.textContent.trim() + '\n```' : listMarkdown(nested, 0));
          });
        } else if (node.children.length && !['a', 'span', 'strong', 'b', 'em', 'i', 'code', 'small', 'label'].includes(tag)) {
          walk(node);
        } else {
          const content = inline(node);
          if (content) blocks.push(content);
        }
      });
    }
    function walkInto(node, target) {
      Array.from(node.childNodes).forEach(child => {
        if (child.nodeType === 3) {
          const text = child.textContent.trim();
          if (text) target.push(escapeMarkdownText(text));
          return;
        }
        if (child.nodeType !== 1) return;
        const tag = child.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'template'].includes(tag)) return;
        if (tag === 'p' || tag === 'div') target.push(inline(child));
        else if (tag === 'ul' || tag === 'ol') target.push(listMarkdown(child, 0));
        else if (tag === 'pre') target.push('```\n' + child.textContent.trim() + '\n```');
        else target.push(inline(child));
      });
    }
    walk(doc.body);
    return blocks.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function removeDuplicateLines(value, options) {
    const opts = options || {};
    const seen = new Set();
    return lines(value).filter(line => {
      const key = (opts.trimLines ? line.trim() : line);
      const valueKey = opts.caseSensitive ? key : key.toLocaleLowerCase();
      if (seen.has(valueKey)) return false;
      seen.add(valueKey);
      return true;
    }).join('\n');
  }

  function duplicateWordRemover(value, options) {
    const opts = options || {};
    const tokens = str(value).match(/\S+|\s+/g) || [];
    const seen = new Set();
    let removed = 0;
    const output = tokens.map(token => {
      if (/^\s+$/.test(token)) return token;
      const match = token.match(/[\p{L}\p{N}]+/u);
      if (!match) return token;
      const key = opts.caseSensitive ? match[0] : match[0].toLocaleLowerCase();
      if (seen.has(key)) { removed++; return ''; }
      seen.add(key);
      return token;
    }).join('');
    return { text: output.replace(/[ \t]{2,}/g, ' '), removed };
  }

  function naturalCompare(a, b, caseInsensitive) {
    const x = caseInsensitive ? a.toLocaleLowerCase() : a;
    const y = caseInsensitive ? b.toLocaleLowerCase() : b;
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
  }

  function textSorter(value, options) {
    const opts = options || {};
    const unit = opts.unit || 'lines';
    let items;
    if (unit === 'words') items = words(value);
    else if (unit === 'chars') items = graphemes(value).filter(g => g.trim());
    else items = lines(value);
    const direction = opts.direction === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      let result;
      if (opts.byLength) result = a.length - b.length;
      else if (opts.natural) result = naturalCompare(a, b, opts.caseInsensitive);
      else {
        const x = opts.caseInsensitive ? a.toLocaleLowerCase() : a;
        const y = opts.caseInsensitive ? b.toLocaleLowerCase() : b;
        result = x < y ? -1 : x > y ? 1 : 0;
      }
      return result * direction;
    });
    return items.join('\n');
  }

  function textSplitter(value, options) {
    const opts = options || {};
    const unit = opts.unit || 'words';
    const mode = opts.mode || 'parts';
    let items;
    if (unit === 'chars') items = graphemes(value);
    else if (unit === 'lines') items = lines(value);
    else items = words(value);
    if (!items.length) return '';
    let size;
    if (mode === 'size') size = Math.max(1, Number(opts.value) || 100);
    else size = Math.ceil(items.length / Math.max(1, Math.min(100, Number(opts.value) || 3)));
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks.map(chunk => chunk.join(unit === 'chars' ? '' : ' ')).join('\n\n---\n\n');
  }

  function textDiff(a, b, options) {
    const opts = options || {};
    const unit = opts.unit || 'lines';
    const left = unit === 'words' ? words(a) : lines(a);
    const right = unit === 'words' ? words(b) : lines(b);
    const max = opts.max || 1200;
    if (left.length > max || right.length > max) {
      return { ok: false, error: 'Comparison is limited to ' + max + ' ' + unit + ' per side to keep your browser fast.', html: '', added: 0, removed: 0 };
    }
    const n = left.length, m = right.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0, added = 0, removed = 0;
    while (i < n && j < m) {
      if (left[i] === right[j]) { ops.push(['equal', left[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['remove', left[i]]); removed++; i++; }
      else { ops.push(['add', right[j]]); added++; j++; }
    }
    while (i < n) { ops.push(['remove', left[i]]); removed++; i++; }
    while (j < m) { ops.push(['add', right[j]]); added++; j++; }
    const html = ops.map(([type, value]) => {
      const prefix = type === 'add' ? '+' : type === 'remove' ? '-' : ' ';
      return '<span class="diff-line diff-' + type + '">' + escapeHtml(prefix + ' ' + value) + '</span>';
    }).join('\n') || '<span class="diff-line diff-equal"> No differences</span>';
    return { ok: true, error: '', html, added, removed };
  }

  function extractEmails(value) {
    const found = str(value).match(/[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/gu) || [];
    return Array.from(new Set(found)).join('\n');
  }

  function trimUrlPunctuation(candidate) {
    let url = candidate;
    let changed = true;
    while (changed && url) {
      changed = false;
      const last = url[url.length - 1];
      if ('.,;:!?\'"'.includes(last)) {
        url = url.slice(0, -1);
        changed = true;
      } else if (last === ')' || last === ']' || last === '}') {
        const open = last === ')' ? '(' : last === ']' ? '[' : '{';
        if ((url.match(new RegExp('\\' + open, 'g')) || []).length < (url.match(new RegExp('\\' + last, 'g')) || []).length) {
          url = url.slice(0, -1);
          changed = true;
        }
      }
    }
    return url;
  }

  function validUrlCandidate(candidate) {
    try {
      const normalized = /^(?:https?:)?\/\//i.test(candidate) ? candidate : 'https://' + candidate.replace(/^www\./i, '');
      const parsed = new URL(normalized);
      if (!/^https?:$/.test(parsed.protocol)) return false;
      const host = parsed.hostname;
      if (!host || host.includes('..') || host.startsWith('.') || host.endsWith('.')) return false;
      if (/^\d+$/.test(host.replace(/\./g, ''))) return false;
      const labels = host.split('.');
      if (labels.length < 2 || labels[labels.length - 1].length < 2) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function extractUrlsDetailed(value) {
    const source = str(value);
    const pattern = /(^|[^\p{L}\p{N}@._-])((?:https?:\/\/|www\.)[^\s<>"'`]+|(?:(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)\.)+(?:[\p{L}]{2,24})(?::\d{1,5})?(?:\/[^\s<>"'`]*)?)/giu;
    const found = [];
    const seen = new Set();
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const url = trimUrlPunctuation(match[2]);
      if (!url || !validUrlCandidate(url) || seen.has(url)) continue;
      seen.add(url);
      found.push(url);
    }
    return { urls: found, count: found.length, text: found.join('\n') };
  }

  function extractUrls(value) {
    return extractUrlsDetailed(value).text;
  }

  function textFilter(value, options) {
    const opts = options || {};
    const query = str(opts.query);
    const text = normalizeNewlines(value);
    if (!query) return { ok: true, text, html: escapeHtml(text).replace(/\n/g, '<br>'), count: 0, error: '' };
    let pattern = opts.regex ? query : escapeRegex(query);
    let re;
    try {
      re = new RegExp(pattern, 'u' + (opts.caseSensitive ? '' : 'i'));
    } catch (error) {
      return { ok: false, text, html: '', count: 0, error: error.message };
    }
    const sourceLines = lines(text);
    const matched = sourceLines.filter(line => re.test(line));
    const kept = opts.mode === 'highlight' ? sourceLines : opts.mode === 'remove'
      ? sourceLines.filter(line => !re.test(line)) : matched;
    const globalRe = new RegExp(pattern, 'gu' + (opts.caseSensitive ? '' : 'i'));
    const html = kept.map(line => escapeHtml(line).replace(globalRe, m => '<mark>' + m + '</mark>')).join('<br>');
    return { ok: true, text: kept.join('\n'), html, count: matched.length, error: '' };
  }

  function redactText(value, options) {
    const opts = options || {};
    const text = str(value);
    const map = {};
    const counters = {};
    let output = text;
    const definitions = [
      ['email', opts.email !== false, /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/gu, 'EMAIL'],
      ['phone', opts.phone !== false, /(?:\+?\d[\d\s().-]{7,}\d)/g, 'PHONE'],
      ['card', opts.card !== false, /\b(?:\d[ -]*?){13,19}\b/g, 'CARD'],
      ['key', opts.key !== false, /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/g, 'KEY']
    ];
    definitions.forEach(([name, enabled, re, label]) => {
      if (!enabled) return;
      output = output.replace(re, match => {
        counters[label] = (counters[label] || 0) + 1;
        const token = '[' + label + '_' + counters[label] + ']';
        map[token] = match;
        return token;
      });
    });
    return { text: output, map };
  }

  function restoreText(value, map) {
    return str(value).replace(/\[(?:EMAIL|PHONE|CARD|KEY)_\d+\]/g, token => map && map[token] ? map[token] : token);
  }

  const LOREM_WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');
  const LOREM_SENTENCES = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
    'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.'
  ];

  function loremIpsum(options) {
    const opts = options || {};
    const mode = opts.mode || 'paragraphs';
    const amount = Math.max(1, Math.min(5000, Number(opts.amount) || 3));
    const classic = opts.classic !== false;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    if (mode === 'words') {
      const out = [];
      if (classic) out.push(...LOREM_WORDS.slice(0, Math.min(4, amount)));
      while (out.length < amount) out.push(pick(LOREM_WORDS));
      return out.slice(0, amount).join(' ') + '.';
    }
    if (mode === 'sentences') {
      const out = [];
      if (classic) out.push(LOREM_SENTENCES[0]);
      while (out.length < amount) out.push(pick(LOREM_SENTENCES));
      return out.slice(0, amount).join(' ');
    }
    if (mode === 'list') {
      const out = [];
      for (let i = 0; i < amount; i++) out.push((i + 1) + '. ' + capitalizeWord(pick(LOREM_WORDS)) + ' ' + pick(LOREM_WORDS));
      return out.join('\n');
    }
    const paragraphs = [];
    for (let i = 0; i < amount; i++) {
      const count = 3 + Math.floor(Math.random() * 4);
      const sentenceList = [];
      if (classic && i === 0) sentenceList.push(LOREM_SENTENCES[0]);
      while (sentenceList.length < count) sentenceList.push(pick(LOREM_SENTENCES.slice(classic && i === 0 ? 1 : 0)));
      paragraphs.push(sentenceList.join(' '));
    }
    return paragraphs.join('\n\n');
  }

  return {
    normalizeNewlines, graphemes, words, sentences, paragraphs, lines, countStats, slugify,
    reverseText, removeExtraSpaces, cleanText, removeEmptyLines, removeEmojis, removePunctuation,
    wordWrap, smartQuotes, repeatText, caseConvert, findReplace, textToList, addAffix,
    textToBinary, binaryToText, morseEncode, morseDecode, escapeHtml, bionicReading,
    htmlToMarkdown, removeDuplicateLines, duplicateWordRemover, textSorter, textSplitter,
    textDiff, extractEmails, extractUrls, extractUrlsDetailed, textFilter, redactText, restoreText, loremIpsum
  };
});
