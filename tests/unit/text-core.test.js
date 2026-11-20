import { describe, expect, it } from 'vitest';
import TextCore from '../../js/text-core.js';

describe('tokenisation and statistics', () => {
  it('normalizes line endings', () => {
    expect(TextCore.normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('counts words, characters, sentences, paragraphs and lines', () => {
    const result = TextCore.countStats('Hello world. This is a test.');
    expect(result.counts.words).toBe(6);
    expect(result.counts.characters).toBe(28);
    expect(result.counts.charactersNoSpaces).toBe(23);
    expect(result.counts.letters).toBe(21);
    expect(result.counts.sentences).toBe(2);
    expect(result.counts.paragraphs).toBe(1);
    expect(result.counts.lines).toBe(1);
    expect(result.counts.readingMinutes).toBe(1);
  });

  it('returns zero reading time for empty text', () => {
    expect(TextCore.countStats('').counts.readingMinutes).toBe(0);
  });

  it('filters stop words from keyword density when requested', () => {
    const text = 'the quick fox and the quick dog';
    const all = TextCore.countStats(text);
    const filtered = TextCore.countStats(text, { ignoreStopWords: true });
    expect(all.keywordDensity[0].word).toBe('quick');
    expect(filtered.keywordDensity.map(row => row.word)).not.toContain('the');
    expect(filtered.keywordDensity[0].word).toBe('quick');
  });

  it('handles Unicode words and grapheme clusters', () => {
    expect(TextCore.words('مرحبا بالعالم')).toEqual(['مرحبا', 'بالعالم']);
    expect(TextCore.graphemes('😀a').length).toBe(2);
  });

  it('splits paragraphs and lines correctly', () => {
    expect(TextCore.paragraphs('a\n\n b \n\n\nc')).toEqual(['a', 'b', 'c']);
    expect(TextCore.lines('a\nb\n')).toEqual(['a', 'b', '']);
  });
});

describe('cleaning tools', () => {
  it('removes extra spaces per line but keeps line breaks', () => {
    expect(TextCore.removeExtraSpaces('  Hello   world\t!  \n  Next  ')).toBe('Hello world !\nNext');
  });

  it('cleans zero-width characters, tabs and repeated spaces', () => {
    expect(TextCore.cleanText('Hello   world\u200b!', {
      normalizeUnicode: true, zeroWidth: true, tabs: true, collapseSpaces: true, trim: true
    })).toBe('Hello world!');
    expect(TextCore.cleanText('a\tb', { tabs: true })).toBe('a b');
  });

  it('removes empty and whitespace-only lines', () => {
    expect(TextCore.removeEmptyLines('one\n\n\ntwo\n   \nthree')).toBe('one\ntwo\nthree');
  });

  it('can preserve paragraph breaks while removing extra empty lines', () => {
    expect(TextCore.removeEmptyLines('one\n\n\ntwo\n   \nthree', { preserveParagraphs: true })).toBe('one\n\ntwo\n\nthree');
  });

  it('removes emoji, modifiers and flags without removing letters', () => {
    expect(TextCore.removeEmojis('Hi 😀 🇺🇸!')).toBe('Hi  !');
    expect(TextCore.removeEmojis('Café')).toBe('Café');
  });

  it('removes Unicode punctuation but keeps symbols', () => {
    expect(TextCore.removePunctuation("Hello, world! How's it going?")).toBe('Hello world Hows it going');
    expect(TextCore.removePunctuation('price €10')).toBe('price €10');
    expect(TextCore.removePunctuation('Hello, world! — really?', { types: 'common' })).toBe('Hello world — really');
    expect(TextCore.removePunctuation('a,b.c', { types: 'custom', chars: ',' })).toBe('ab.c');
  });

  it('wraps text at a width and can break long words', () => {
    expect(TextCore.wordWrap('one two three seven', 10)).toBe('one two\nthree\nseven');
    expect(TextCore.wordWrap('abcdefghijklmnopqrst', 10, { breakLongWords: true })).toBe('abcdefghij\nklmnopqrst');
  });

  it('converts straight quotes to typographic quotes', () => {
    expect(TextCore.smartQuotes('He said "don\'t stop".')).toBe('He said “don’t stop”.');
  });

  it('repeats text with escaped separators', () => {
    expect(TextCore.repeatText('hi', 3, ',')).toBe('hi,hi,hi');
    expect(TextCore.repeatText('hi', 2, '\\n')).toBe('hi\nhi');
  });
});

describe('case, reversal, replacement and formatting', () => {
  it('converts all supported case styles', () => {
    expect(TextCore.caseConvert('Hello WORLD', 'lower')).toBe('hello world');
    expect(TextCore.caseConvert('Hello WORLD', 'upper')).toBe('HELLO WORLD');
    expect(TextCore.caseConvert('hello world', 'title')).toBe('Hello World');
    expect(TextCore.caseConvert('HELLO WORLD', 'sentence')).toBe('Hello world');
    expect(TextCore.caseConvert('hello world', 'alternating')).toBe('HELLO world');
    expect(TextCore.caseConvert('hello world', 'inverse')).toBe('hello WORLD');
    expect(TextCore.caseConvert('the quick brown fox and the dog', 'ap')).toBe('The Quick Brown Fox and the Dog');
  });

  it('reverses characters, words and lines with Unicode safety', () => {
    expect(TextCore.reverseText('Hello world', 'chars')).toBe('dlrow olleH');
    expect(TextCore.reverseText('Hello world', 'words')).toBe('world Hello');
    expect(TextCore.reverseText('a\nb\nc', 'lines')).toBe('c\nb\na');
    expect(TextCore.reverseText('a😀', 'chars')).toBe('😀a');
  });

  it('finds and replaces literal, whole-word and regex matches', () => {
    expect(TextCore.findReplace('Cat cat dog', { find: 'cat', replace: 'dog' })).toMatchObject({ text: 'dog dog dog', count: 2 });
    expect(TextCore.findReplace('cat catalog scatter', { find: 'cat', replace: 'dog', wholeWord: true })).toMatchObject({ text: 'dog catalog scatter', count: 1 });
    expect(TextCore.findReplace('aaa b', { find: 'a+', replace: 'x', regex: true })).toMatchObject({ text: 'x b', count: 1 });
  });

  it('reports invalid regular expressions instead of throwing', () => {
    const result = TextCore.findReplace('text', { find: '(', replace: 'x', regex: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('creates slugs from accented Unicode headlines', () => {
    expect(TextCore.slugify('Hello World! Café & SEO')).toBe('hello-world-cafe-seo');
  });

  it('converts delimited text to a list', () => {
    expect(TextCore.textToList('red, blue, ,green', { delimiter: ',' })).toBe('red\nblue\ngreen');
    expect(TextCore.textToList('a\nb', { delimiter: '\\n', numbered: true })).toBe('1. a\n2. b');
  });

  it('adds prefixes and suffixes only to chosen lines', () => {
    expect(TextCore.addAffix('a\n\nb', { prefix: '> ', skipEmpty: true })).toBe('> a\n\n> b');
    expect(TextCore.addAffix('a\nb', { prefix: '[', suffix: ']' })).toBe('[a]\n[b]');
  });
});

describe('encoding tools', () => {
  it('round-trips UTF-8 text through binary', () => {
    expect(TextCore.textToBinary('A')).toBe('01000001');
    expect(TextCore.binaryToText('01000001 01000010')).toEqual({ ok: true, text: 'AB', error: '' });
    const binary = TextCore.textToBinary('Café 😀');
    expect(TextCore.binaryToText(binary).text).toBe('Café 😀');
  });

  it('rejects invalid binary groups', () => {
    const result = TextCore.binaryToText('010 0001');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('8-bit');
  });

  it('rejects invalid binary characters instead of treating them as separators', () => {
    const result = TextCore.binaryToText('01000001X01000010');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid binary group');
  });

  it('round-trips UTF-16 and validates ASCII', () => {
    const encoded = TextCore.textToBinary('Café 😀', { encoding: 'utf-16' });
    expect(encoded.ok).toBe(true);
    expect(TextCore.binaryToText(encoded.text, { encoding: 'utf-16' }).text).toBe('Café 😀');
    expect(TextCore.textToBinary('é', { encoding: 'ascii' }).ok).toBe(false);
    expect(TextCore.binaryToText('11111111', { encoding: 'ascii' }).ok).toBe(false);
  });

  it('reports invalid UTF-8 byte sequences', () => {
    const result = TextCore.binaryToText('11111111');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not valid UTF-8');
  });

  it('preserves Morse word separators', () => {
    expect(TextCore.morseEncode('SOS')).toBe('... --- ...');
    expect(TextCore.morseDecode('... --- ...')).toBe('SOS');
    expect(TextCore.morseEncode('Hi!')).toBe('.... .. -.-.--');
    const encoded = TextCore.morseEncode('HELLO WORLD');
    expect(encoded).toContain(' / ');
    expect(TextCore.morseDecode(encoded)).toBe('HELLO WORLD');
  });

  it('escapes HTML and builds bionic reading markup', () => {
    expect(TextCore.escapeHtml('<b>&"\'>')).toBe('&lt;b&gt;&amp;&quot;&#39;&gt;');
    expect(TextCore.bionicReading('Read fast', 2)).toBe('<strong>Re</strong>ad <strong>fa</strong>st');
  });

  it('falls back safely when DOMParser is unavailable', () => {
    const result = TextCore.htmlToMarkdown('<h2>Hello</h2><p><strong>World</strong></p>');
    expect(result).not.toContain('<');
    expect(result).toContain('Hello');
  });
});

describe('deduplication, sorting and splitting', () => {
  it('removes duplicate lines with case and trim rules', () => {
    expect(TextCore.removeDuplicateLines('a\nb\na\nB', { caseSensitive: false, trimLines: true })).toBe('a\nb');
    expect(TextCore.removeDuplicateLines('a\nA', { caseSensitive: true })).toBe('a\nA');
  });

  it('removes duplicate words and reports the count', () => {
    expect(TextCore.duplicateWordRemover('this this is is a test')).toEqual({ text: 'this is a test', removed: 2 });
  });

  it('sorts alphabetically and naturally', () => {
    expect(TextCore.textSorter('banana\napple\ncherry')).toBe('apple\nbanana\ncherry');
    expect(TextCore.textSorter('item10\nitem2', { natural: true })).toBe('item2\nitem10');
    expect(TextCore.textSorter('a\nbb\nc', { byLength: true, direction: 'desc' })).toBe('bb\na\nc');
  });

  it('splits into equal parts and fixed-size chunks', () => {
    expect(TextCore.textSplitter('one two three four', { unit: 'words', mode: 'parts', value: 2 })).toBe('one two\n\n---\n\nthree four');
    expect(TextCore.textSplitter('a b c d e', { unit: 'words', mode: 'size', value: 2 })).toBe('a b\n\n---\n\nc d\n\n---\n\ne');
  });
});

describe('comparison, extraction, filtering and generation', () => {
  it('computes an LCS diff with added and removed counts', () => {
    const result = TextCore.textDiff('a\nb', 'a\nc');
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.html).toContain('diff-remove');
    expect(result.html).toContain('diff-add');
  });

  it('refuses oversized comparisons', () => {
    const tooMany = Array(1201).fill('line').join('\n');
    expect(TextCore.textDiff(tooMany, 'line').ok).toBe(false);
  });

  it('extracts unique emails and URLs', () => {
    expect(TextCore.extractEmails('a@b.com; c@d.org; a@b.com')).toBe('a@b.com\nc@d.org');
    expect(TextCore.extractUrls('Visit https://example.com/a, and http://test.org/x.')).toBe('https://example.com/a\nhttp://test.org/x');
  });

  it('extracts realistic URL variants in order without duplicates', () => {
    const input = [
      'See (https://example.com/a/b?q=1&lang=en#top), then www.test.org:8080/path.',
      'Plain example.net/docs and https://example.com/a/b?q=1&lang=en#top again.',
      'Email me at hello@example.com, not a URL by itself.'
    ].join('\n');
    const result = TextCore.extractUrlsDetailed(input);
    expect(result.count).toBe(3);
    expect(result.urls).toEqual([
      'https://example.com/a/b?q=1&lang=en#top',
      'www.test.org:8080/path',
      'example.net/docs'
    ]);
  });

  it('keeps, removes and highlights matching lines safely', () => {
    const source = 'apple\n<script>alert(1)</script>\napricot';
    const kept = TextCore.textFilter(source, { query: 'ap' });
    expect(kept.text).toBe('apple\napricot');
    expect(kept.html).toContain('<mark>ap</mark>');
    expect(kept.html).not.toContain('<script>');
    const removed = TextCore.textFilter(source, { query: 'script', mode: 'remove' });
    expect(removed.text).not.toContain('script');
  });

  it('reports invalid filter patterns', () => {
    expect(TextCore.textFilter('text', { query: '(', regex: true }).ok).toBe(false);
  });

  it('redacts sensitive values and restores them from the in-memory map', () => {
    const original = 'Email jane@example.com or call +1 555 123 4567.';
    const redacted = TextCore.redactText(original);
    expect(redacted.text).toContain('[EMAIL_1]');
    expect(redacted.text).not.toContain('jane@example.com');
    expect(TextCore.restoreText(redacted.text, redacted.map)).toBe(original);
  });

  it('generates an exact number of lorem words', () => {
    const output = TextCore.loremIpsum({ mode: 'words', amount: 5 });
    expect(TextCore.words(output).length).toBe(5);
    expect(output.endsWith('.')).toBe(true);
  });

  it('handles empty input across representative tools', () => {
    expect(TextCore.removeExtraSpaces('')).toBe('');
    expect(TextCore.reverseText('')).toBe('');
    expect(TextCore.textToList('')).toBe('');
    expect(TextCore.extractEmails('')).toBe('');
    expect(TextCore.countStats('').counts.words).toBe(0);
  });

  it('handles large repeated input without changing correctness', () => {
    const large = 'word '.repeat(4000).trim();
    expect(TextCore.countStats(large).counts.words).toBe(4000);
    expect(TextCore.removeDuplicateLines(large.replace(/ /g, '\n'))).toBe('word');
  });
});
