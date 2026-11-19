import { describe, it, expect } from 'vitest';
import R from '../../js/reference-core.js';

describe('01 — Text Cleaner pipeline', () => {
  const defaults = {
    trim: true, removeLeadingSpaces: true, removeTrailingSpaces: true,
    stripHtmlTags: true, stripEmojis: true,
    multipleSpacesToSingle: true, multipleBlankLinesToSingle: true,
    letterCase: 'noChange'
  };

  it('applies reference defaults in order', () => {
    const result = R.cleanText('  <p>Hello   world 😀</p>  ', defaults);
    expect(result.changed).toBe(true);
    expect(result.text).toBe('Hello world ');
  });

  it('trims the whole string, not each line, and preserves case by default', () => {
    expect(R.cleanText('  a  b\n  c  ', defaults).text).toBe('a b\nc');
    expect(R.cleanText('MiXeD CaSe', defaults).text).toBe('MiXeD CaSe');
  });

  it('supports the remaining character, HTML, link and formatting switches', () => {
    const text = 'b4 Café &lt;b&gt;tag&lt;/b&gt; https://example.com “hi” hello hello';
    const result = R.cleanText(text, {
      removeAccents: true, unescapeHtml: true, stripHtmlTags: true,
      convertUrlsToLinks: true, smartToRegular: true, removeRepeatingWords: true,
      convertShorthand: true
    });
    expect(result.text).toContain('before Cafe tag');
    expect(result.text).toContain('<a href="https://example.com" target="_blank">https://example.com</a>');
    expect(result.text).toContain('"hi"');
  });

  it('adds a space after punctuation when that rule is enabled', () => {
    expect(R.cleanText('Hi,there.', { fixSpacesAfterPunctuation: true }).text).toBe('Hi, there. ');
  });

  it('leaves text unchanged when no rule is selected', () => {
    const source = '  mixed\n\n  text 😀 ';
    expect(R.cleanText(source, { letterCase: 'noChange' })).toEqual({ text: source, changed: false });
  });
});

describe('06 — Word Counter', () => {
  it('counts words, graphemes, letters and sentences', () => {
    const stats = R.wordCounterAnalyze('Hello world. Café 😀!', {});
    expect(stats.words).toBe(3);
    expect(stats.characters).toBe(20);
    expect(stats.charactersNoSpaces).toBe(17);
    expect(stats.sentences).toBe(2);
    expect(stats.paragraphs).toBe(1);
  });

  it('returns a full zero state for empty input', () => {
    const stats = R.wordCounterAnalyze('', {});
    expect(stats.words).toBe(0);
    expect(stats.characters).toBe(0);
    expect(stats.sentences).toBe(0);
    expect(stats.density).toEqual([]);
  });

  it('calculates phrase density and optionally ignores common words', () => {
    const text = 'Text text tools. Text tools help. Tools help writers.';
    const all = R.wordCounterAnalyze(text, { n: 1 });
    const filtered = R.wordCounterAnalyze(text, { n: 1, ignore: true });
    expect(all.density.find(item => item.keyword === 'text').count).toBe(3);
    expect(filtered.density.find(item => item.keyword === 'text')).toBeTruthy();
    expect(filtered.density.find(item => item.keyword === 'tools').count).toBe(3);
  });
});

describe('07 — Lorem Ipsum Generator', () => {
  it('generates an exact word count', () => {
    const text = R.loremGenerate({ unit: 'words', amount: 37, style: 'classic' });
    expect(text.split(/\s+/).filter(Boolean)).toHaveLength(37);
    expect(text).toMatch(/\.$/);
  });

  it('enforces the documented caps rather than claiming unlimited output', () => {
    expect(R.UNIT_LIMITS).toMatchObject({ paragraphs: 100, sentences: 500, words: 5000, list: 100 });
    const text = R.loremGenerate({ unit: 'words', amount: 99999 });
    expect(text.split(/\s+/).filter(Boolean)).toHaveLength(5000);
  });

  it('builds wrapped HTML, Markdown and ordered list output', () => {
    expect(R.loremGenerate({ unit: 'paragraphs', amount: 2, format: 'html' })).toMatch(/^<p>.*<\/p>\n<p>/);
    expect(R.loremGenerate({ unit: 'paragraphs', amount: 1, format: 'html', wrap: false })).not.toMatch(/^<p>/);
    expect(R.loremGenerate({ unit: 'paragraphs', amount: 1, format: 'markdown' })).toMatch(/^Lorem/);
    expect(R.loremGenerate({ unit: 'list', amount: 3, format: 'html', list: 'ol' })).toMatch(/^<ol>/);
  });
});

describe('08 — Bionic Reading', () => {
  it('uses the reference fixation ratios and saccade pattern', () => {
    expect(R.BIONIC_RATIO).toEqual([0, 0.2, 0.3, 0.42, 0.55, 0.7]);
    const parts = R.bionicParse('one two three four', { level: 3, sacc: 2 });
    const bold = parts.filter(p => p.t === 1);
    expect(bold).toHaveLength(2);
    expect(bold[0].b).toBe('t');
    expect(bold[1].b).toBe('fo');
  });

  it('does not bold numbers, URLs or email addresses', () => {
    const parts = R.bionicParse('2026 https://example.com jane@example.com', { level: 5, sacc: 1 });
    expect(parts.every(p => p.t === 0)).toBe(true);
  });

  it('escapes source characters while keeping only generated bold tags', () => {
    const html = R.bionicToHtml('<b>& "x"', { level: 3, sacc: 1 });
    expect(html.startsWith('&lt;')).toBe(true);
    expect(html).toContain('<b>b</b>');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('&lt;b&gt;');
    const md = R.bionicToMarkdown('a*b_c', { level: 3, sacc: 1 });
    expect(md).toContain('\\*');
    expect(md).toContain('\\_');
  });

  it('reports bold points and estimated minutes', () => {
    expect(R.bionicStats('one two', { level: 3, sacc: 1 })).toMatchObject({ bold: 2, words: 2, minutes: 1 });
  });
});

describe('09 — AP Case Converter', () => {
  it('title-cases and lowers short words only while title case is on', () => {
    const text = 'the quick brown fox and a dog';
    expect(R.apCaseConvert(text, {})).toBe('The Quick Brown Fox and a Dog');
    expect(R.apCaseConvert(text, { titleCase: false })).toBe('The quick brown fox and a dog');
  });

  it('shortens months, states and single digits', () => {
    const result = R.apCaseConvert('meeting in January in New York on 5', {});
    expect(result).toContain('Jan.');
    expect(result).toContain('N.Y.');
    expect(result).toContain('five');
  });

  it('keeps each rule independently switchable', () => {
    const text = 'January 5';
    expect(R.apCaseConvert(text, { monthAbbreviations: false, numerals: false })).toBe('January 5');
  });
});

describe('10–14 — Focused copy tools', () => {
  it('collapses every whitespace run into one line', () => {
    expect(R.removeExtraSpaces('  a\t b\n\n c  ')).toBe('a b c');
  });

  it('uses literal replace with case sensitivity and live regex without it', () => {
    expect(R.findAndReplace('a.b a.b', 'a.b', 'X', true)).toBe('X X');
    expect(R.findAndReplace('a.b axb', 'a.b', 'X', false)).toBe('X X');
    expect(() => R.findAndReplace('text', '[', 'X', false)).toThrow();
  });

  it('uses the reference emoji ranges and preserves ordinary letters', () => {
    expect(R.removeEmojis('Café 😀❤️ hello')).toBe('Café  hello');
    // Joined emoji keep their zero-width joiner because the reference removes
    // whole pictograph ranges rather than full grapheme clusters.
    expect(R.removeEmojis('a👨‍👩‍👧b')).toContain('\u200d');
    expect(R.removeEmojis('plain text 123')).toBe('plain text 123');
  });

  it('splits lines by default and trims comma/custom items', () => {
    expect(R.textToList('red, blue, green', { split: 'comma' }).text).toBe('• red\n• blue\n• green');
    expect(R.textToList('a|b', { split: 'custom', separator: '|', format: 'numbered' }).text).toBe('1. a\n2. b');
    expect(R.textToList('a\n\nb').items).toEqual(['a', 'b']);
    expect(R.textToList('a', { split: 'custom' }).error).toBe('custom-separator');
  });

  it('removes before highlighting and matches whole words only', () => {
    const segments = R.applyFilter('apple and banana apricot', 'banana', 'apple');
    expect(segments.map(s => s.text).join('')).toBe(' and banana apricot');
    expect(segments.find(s => s.hit)).toMatchObject({ text: 'banana', hit: true });
    expect(R.applyFilter('apple apricot', 'ap', '').some(s => s.hit)).toBe(false);
  });
});

describe('05 — Redact Text', () => {
  it('masks values with stable labels and restores them', () => {
    const built = R.redactBuild('Email jane@example.com and again jane@example.com', { style: 'label' });
    expect(built.text).toBe('Email [EMAIL_1] and again [EMAIL_1]');
    expect(built.found).toBe(2);
    // Each occurrence is recorded in the key so restoration is unambiguous.
    expect(built.entries).toHaveLength(2);
    expect(built.entries.every(entry => entry.value === 'jane@example.com')).toBe(true);
    const restored = R.redactRestore('Re: [EMAIL_1]', built.entries);
    expect(restored.text).toBe('Re: jane@example.com');
    expect(restored.unknown).toBe(0);
  });

  it('supports fake values and reports unknown labels', () => {
    const built = R.redactBuild('Call 555-123-4567', { style: 'fake' });
    expect(built.text).toBe('Call (555) 555-1001');
    expect(R.redactRestore(built.text, built.entries).text).toBe('Call 555-123-4567');
    const unknown = R.redactRestore('[EMAIL_9]', [{ label: '[EMAIL_1]', type: 'email', value: 'x@y.com' }]);
    expect(unknown.unknown).toBe(1);
  });

  it('documents that parenthesised phone numbers are not detected', () => {
    expect(R.redactBuild('Call (555) 123-4567', { style: 'label' }).found).toBe(0);
  });

  it('marks black bars as irreversible and keeps original values in the key', () => {
    const built = R.redactBuild('Email jane@example.com', { style: 'bars' });
    expect(built.text).toContain('█████');
    expect(built.entries[0].value).toBe('jane@example.com');
    expect(R.redactRestore(built.text, built.entries).hasBars).toBe(true);
  });

  it('honours custom terms and category switches', () => {
    const built = R.redactBuild('Project Falcon and jane@example.com', {
      words: 'Project Falcon', cats: { email: false }
    });
    expect(built.text).toContain('[TERM_1]');
    expect(built.text).toContain('jane@example.com');
  });
});

describe('04 — Bank Statement Converter', () => {
  const sample = '01/15/2026 Coffee Shop 4.50 995.50\n01/16/2026 Salary 1,000.00 1,995.50\n01/17/2026 Rent -650.00 1,345.50';

  it('parses amounts, descriptions and running balances', () => {
    const result = R.parseStatement(sample);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ date: '2026-01-15', description: 'Coffee Shop', amount: 4.5, balance: 995.5 });
    expect(result.totalIn).toBe(1004.5);
    expect(result.totalOut).toBe(650);
    expect(result.check).toBe('ok');
  });

  it('flags arithmetic that does not reconcile', () => {
    const result = R.parseStatement('01/15/2026 Shop 10.00 100.00\n01/16/2026 Pay 5.00 200.00');
    expect(result.check).toBe('rows');
    expect(result.badRows).toBe(1);
  });

  it('supports month names and explicit day-first order', () => {
    expect(R.parseStatement('January 15, 2026 Shop 2.00 20.00').rows[0].date).toBe('2026-01-15');
    expect(R.parseStatement('03/04/2026 Shop 2.00', { dateOrder: 'dmy' }).rows[0].date).toBe('2026-04-03');
  });

  it('returns an empty state for malformed or balance-free text', () => {
    expect(R.parseStatement('this is not a statement').rows).toEqual([]);
    expect(R.parseStatement('01/15/2026 Shop 2.00').check).toBe('none');
  });

  it('exports safe CSV and QIF text', () => {
    const result = R.parseStatement(sample);
    const csv = R.statementToCsv(result.rows);
    expect(csv.startsWith('\uFEFFDate,Description,Amount,Balance')).toBe(true);
    expect(csv).toContain('1000.00');
    const qif = R.statementToQif(result.rows, 'credit');
    expect(qif).toMatch(/^!Type:CCard/);
    expect(qif).toContain('D01/15/2026');
  });
});
