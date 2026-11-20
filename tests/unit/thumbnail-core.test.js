import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../js/thumbnail-core.js');

describe('thumbnail canvas presets', () => {
  it('includes verified dimensions and safe areas for every requested surface', () => {
    const expected = {
      youtube: [1280, 720], shorts: [1080, 1920], 'instagram-post': [1080, 1080],
      'instagram-reel': [1080, 1920], 'instagram-story': [1080, 1920], tiktok: [1080, 1920],
      'facebook-post': [1200, 630], 'facebook-cover': [851, 315], 'facebook-video': [1280, 720],
      'linkedin-post': [1200, 627], 'linkedin-banner': [1584, 396], 'x-post': [1200, 675],
      pinterest: [1000, 1500]
    };
    Object.entries(expected).forEach(([id, size]) => {
      const preset = T.presetById(id);
      expect([preset.width, preset.height]).toEqual(size);
    });
    expect(T.presetById('missing').id).toBe('custom');
    const safe = T.safeArea('tiktok', 1080, 1920);
    expect(safe.top).toBeGreaterThan(300);
    expect(safe.bottom).toBeLessThan(1600);
    expect(T.exportName('youtube', 'jpeg')).toBe('letitedit-youtube-thumbnail.jpg');
    expect(T.exportName('custom', 'webp')).toBe('letitedit-custom-size.webp');
  });
});

describe('multilingual script detection and direction', () => {
  it('recognises the requested language families', () => {
    const cases = [
      ['English launch', 'latin'], ['Urdu زبان', 'arabic'], ['العربية', 'arabic'],
      ['فارسی', 'arabic'], ['Привет мир', 'cyrillic'], ['Україна', 'cyrillic'],
      ['नमस्ते', 'devanagari'], ['নমস্কার', 'bengali'], ['ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'gurmukhi'],
      ['வணக்கம்', 'tamil'], ['你好世界', 'han'], ['こんにちは', 'japanese'],
      ['안녕하세요', 'korean'], ['Español', 'latin'], ['Français', 'latin'],
      ['Deutsch', 'latin'], ['Português', 'latin'], ['Türkçe', 'latin'],
      ['Indonesia', 'latin']
    ];
    cases.forEach(([text, script]) => expect(T.detectScript(text)).toBe(script));
  });

  it('uses Unicode first-strong rules without reversing text', () => {
    expect(T.resolveDirection('مرحبا world', 'auto')).toBe('rtl');
    expect(T.resolveDirection('world مرحبا', 'auto')).toBe('ltr');
    expect(T.resolveDirection('مرحبا', 'ltr')).toBe('ltr');
    expect(T.resolveDirection('English', 'rtl')).toBe('rtl');
    expect(T.isRTLScript('arabic')).toBe(true);
    expect(T.isRTLScript('devanagari')).toBe(false);
  });

  it('offers script-compatible fonts and rejects incompatible ones', () => {
    const arabic = T.fontsForScript('arabic');
    expect(arabic.length).toBeGreaterThan(0);
    expect(arabic.map(font => font.value + ' ' + font.label).join(' ')).toMatch(/Arabic|Nastaliq/);
    expect(T.fontSupportsScript(T.FONT_STACKS.latin[0].value, 'arabic')).toBe(false);
    expect(T.suggestFontForScript('arabic', T.FONT_STACKS.latin[0].value)).toBe(arabic[0].value);
    expect(T.suggestFontForScript('japanese', T.FONT_STACKS.japanese[1].value))
      .toBe(T.FONT_STACKS.japanese[1].value);
    expect(T.fontsForScript('tamil')[0].value).toMatch(/Tamil/);
    expect(T.fontsForScript('gurmukhi')[0].value).toMatch(/Gurmukhi|Punjabi/);
  });

  it('wraps mixed scripts, preserves newlines and keeps grapheme clusters intact', () => {
    const measure = text => Array.from(text).length;
    expect(T.wrapText(measure, ' primeros pasos\nsegunda línea', 12))
      .toEqual(['primeros', 'pasos', 'segunda', 'línea']);
    expect(T.wrapText(measure, '中文文本没有空格但是应该换行', 8))
      .toEqual(['中文文本没有空格', '但是应该换行']);
    const family = '👨‍👩‍👧‍👦 family';
    const wrapped = T.wrapText(text => text.length, family, 20, { keepTrailingBlank: true }).join('');
    expect(wrapped).toContain(family.slice(0, 11));
    expect(Array.from(wrapped)).toEqual(expect.arrayContaining(Array.from(family.slice(0, 11))));
  });
});

describe('layer operations and templates', () => {
  it('moves, duplicates, hides and removes individual layers', () => {
    const a = T.makeLayer('text', { name: 'A' });
    const b = T.makeLayer('image', { name: 'B' });
    const c = T.makeLayer('shape', { name: 'C' });
    const layers = [a, b, c];
    expect(T.moveLayer(layers, a.id, 1)).toBe(true);
    expect(layers.map(layer => layer.name)).toEqual(['B', 'A', 'C']);
    const copy = T.duplicateLayer(layers, b.id);
    expect(copy.id).not.toBe(b.id);
    expect(layers).toHaveLength(4);
    expect(T.getLayer(layers, copy.id).name).toBe('B copy');
    expect(T.removeLayer(layers, copy.id).id).toBe(copy.id);
    expect(layers).toHaveLength(3);
  });

  it('creates original editable templates without flattening text', () => {
    T.TEMPLATE_NAMES.forEach(name => {
      const template = T.applyTemplate(name, 2);
      expect(template.layers.length).toBeGreaterThan(0);
      expect(template.layers.every(layer => layer.id && layer.type)).toBe(true);
      expect(template.layers.some(layer => layer.type === 'text')).toBe(true);
    });
    const split = T.applyTemplate('split', 2);
    expect(split.layers.filter(layer => layer.type === 'image')).toHaveLength(2);
    const global = T.applyTemplate('global', 0);
    expect(global.layers[0].text).toContain('العربية');
  });

  it('sanitizes saved projects without losing valid zero opacity', () => {
    const project = T.sanitizeProject({
      width: 99999, height: 10, preset: 'custom', layers: [
        T.makeLayer('text', { name: 'Hidden', opacity: 0, visible: false }),
        T.makeLayer('shape', { name: 'Solid', opacity: 0.6 })
      ]
    });
    expect(project.width).toBe(8000);
    expect(project.height).toBe(64);
    expect(project.layers[0].opacity).toBe(0);
    expect(project.layers[0].visible).toBe(false);
    expect(project.layers[1].opacity).toBe(0.6);
    expect(() => T.sanitizeProject(null)).toThrow('not valid');
  });
});
