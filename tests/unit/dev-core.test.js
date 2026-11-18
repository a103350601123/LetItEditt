import { describe, expect, it } from 'vitest';
import DevCore from '../../js/dev-core.js';

describe('JSON formatting and validation', () => {
  it('pretty prints valid JSON with the requested indentation', () => {
    const result = DevCore.formatJson('{"a":1,"b":[2,3]}');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    expect(result.lines).toBe(7);
    expect(result.status).toContain('Formatted JSON');
  });

  it('minifies JSON and can use tabs or four spaces', () => {
    expect(DevCore.formatJson('{ "a": 1, "b": [ 2, 3 ] }', { mode: 'minify' }).text).toBe('{"a":1,"b":[2,3]}');
    expect(DevCore.formatJson('{"a":1}', { indent: 4 }).text).toBe('{\n    "a": 1\n}');
    expect(DevCore.formatJson('{"a":1}', { indent: 'tab' }).text).toBe('{\n\t"a": 1\n}');
  });

  it('sorts object keys recursively without reordering arrays', () => {
    const result = DevCore.formatJson('{"b":1,"a":{"d":2,"c":3},"list":[3,1,2]}', { sortKeys: true });
    expect(result.ok).toBe(true);
    expect(Object.keys(JSON.parse(result.text))).toEqual(['a', 'b', 'list']);
    expect(Object.keys(JSON.parse(result.text).a)).toEqual(['c', 'd']);
    expect(JSON.parse(result.text).list).toEqual([3, 1, 2]);
  });

  it('reports parse errors instead of throwing', () => {
    const result = DevCore.formatJson('{"a":1,}');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid JSON');
    expect(result.text).toBe('');
  });

  it('treats empty input as a neutral starting state', () => {
    const result = DevCore.formatJson('   ');
    expect(result).toMatchObject({ ok: true, text: '', characters: 0, lines: 0 });
    expect(result.status).toBe('Paste JSON to begin.');
  });

  it('preserves Unicode values and large documents', () => {
    const source = JSON.stringify({ city: 'München', emoji: '😀', arabic: 'مرحبا' });
    const result = DevCore.formatJson(source);
    expect(JSON.parse(result.text)).toEqual({ city: 'München', emoji: '😀', arabic: 'مرحبا' });
    const large = JSON.stringify({ items: Array.from({ length: 2000 }, (_, index) => index) });
    expect(DevCore.formatJson(large).ok).toBe(true);
  });
});

describe('Base64 encoding and decoding', () => {
  it('round-trips UTF-8 text including accents and emoji', () => {
    const encoded = DevCore.base64Encode('Café 😀');
    expect(encoded.ok).toBe(true);
    expect(encoded.text).toBe('Q2Fmw6kg8J+YgA==');
    expect(DevCore.base64Decode(encoded.text).text).toBe('Café 😀');
    expect(DevCore.base64Decode(DevCore.base64Encode('مرحبا').text).text).toBe('مرحبا');
  });

  it('produces URL-safe output without padding and decodes it', () => {
    const encoded = DevCore.base64Encode('??>>', { urlSafe: true });
    expect(encoded.text).not.toMatch(/[+/=]/);
    expect(DevCore.base64Decode(encoded.text).text).toBe('??>>');
  });

  it('accepts padded and unpadded standard Base64 plus whitespace', () => {
    expect(DevCore.base64Decode('SGVsbG8=').text).toBe('Hello');
    expect(DevCore.base64Decode('SGVsbG8').text).toBe('Hello');
    expect(DevCore.base64Decode('SGVs\nbG8=').text).toBe('Hello');
  });

  it('rejects non-alphabet characters and impossible lengths', () => {
    expect(DevCore.base64Decode('!!!!').ok).toBe(false);
    expect(DevCore.base64Decode('abcde').ok).toBe(false);
    expect(DevCore.base64Decode('abcde').error).toContain('length');
  });

  it('rejects bytes that are not valid UTF-8 text', () => {
    const result = DevCore.base64Decode('/w==');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('UTF-8');
  });

  it('handles empty input without errors', () => {
    expect(DevCore.base64Encode('').text).toBe('');
    expect(DevCore.base64Decode('').status).toBe('Paste Base64 to begin.');
  });

  it('keeps large payloads intact', () => {
    const source = 'word '.repeat(5000).trim();
    const roundTrip = DevCore.base64Decode(DevCore.base64Encode(source).text);
    expect(roundTrip.text).toBe(source);
  });
});

describe('regular expression testing', () => {
  it('builds flag strings from options', () => {
    expect(DevCore.regexFlags({})).toBe('g');
    expect(DevCore.regexFlags({ global: false })).toBe('');
    expect(DevCore.regexFlags({ ignoreCase: true, multiline: true, dotAll: true, unicode: true }))
      .toBe('gimsu');
  });

  it('finds every global match and highlights it safely', () => {
    const result = DevCore.testRegex('a1 b2', { pattern: '\\w\\d' });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.html).toContain('<mark class="regex-match">a1</mark>');
    expect(result.html).toContain('<mark class="regex-match">b2</mark>');
    expect(result.text).toBe('a1\nb2');
  });

  it('stops after the first match when global is disabled', () => {
    const result = DevCore.testRegex('a a a', { pattern: 'a', global: false });
    expect(result.count).toBe(1);
  });

  it('shows numbered and named capture groups', () => {
    const numbered = DevCore.testRegex('a1', { pattern: '(\\w)(\\d)' });
    expect(numbered.html).toContain('$1: a');
    expect(numbered.html).toContain('$2: 1');
    const named = DevCore.testRegex('a1', { pattern: '(?<letter>\\w)(?<digit>\\d)' });
    expect(named.html).toContain('letter: a');
    expect(named.html).toContain('digit: 1');
  });

  it('previews replacements without modifying the source string', () => {
    const source = 'a1 b2';
    const result = DevCore.testRegex(source, { pattern: '(\\w)(\\d)', replacement: '$2$1' });
    expect(result.text).toBe('1a 2b');
    expect(source).toBe('a1 b2');
    expect(result.html).toContain('regex-replacement');
  });

  it('reports invalid patterns instead of throwing', () => {
    const result = DevCore.testRegex('text', { pattern: '(' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid regular expression');
  });

  it('handles zero-length matches without looping forever', () => {
    const lookahead = DevCore.testRegex('aa', { pattern: '(?=a)' });
    expect(lookahead.count).toBe(2);
    const unicode = DevCore.testRegex('😀😀', { pattern: '(?=😀)' });
    expect(unicode.count).toBe(2);
    const multiline = DevCore.testRegex('a\nb', { pattern: '^', multiline: true });
    expect(multiline.count).toBe(2);
  });

  it('escapes HTML in both the preview and the match table', () => {
    const result = DevCore.testRegex('<script>alert(1)</script>', { pattern: '.+' });
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).not.toContain('<script>');
  });

  it('returns a clear empty state for no pattern, no matches and empty text', () => {
    expect(DevCore.testRegex('anything', {}).status).toBe('Enter a regular expression to begin.');
    const none = DevCore.testRegex('hello', { pattern: 'z+' });
    expect(none.count).toBe(0);
    expect(none.html).toContain('No matches found.');
    expect(DevCore.testRegex('', { pattern: 'a' }).html).toContain('Test string is empty.');
  });

  it('caps very large match sets at one thousand', () => {
    const result = DevCore.testRegex('a'.repeat(1200), { pattern: 'a' });
    expect(result.count).toBe(1000);
    expect(result.status).toContain('1,000');
  });

  it('supports Unicode mode and ignore-case flags', () => {
    expect(DevCore.testRegex('Cat cat', { pattern: 'cat', ignoreCase: true }).count).toBe(2);
    expect(DevCore.testRegex('é', { pattern: '\\p{Letter}', unicode: true }).count).toBe(1);
  });
});
