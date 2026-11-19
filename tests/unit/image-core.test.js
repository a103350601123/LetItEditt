import { describe, it, expect } from 'vitest';
import ImageCore from '../../js/image-core.js';

function image(width, height, pixels) {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

function pixel(data, x, y, width) {
  const i = (y * width + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

describe('Image & Photo pure engines', () => {
  it('formats byte sizes and parses colours predictably', () => {
    expect(ImageCore.formatBytes(512)).toBe('512 B');
    expect(ImageCore.formatBytes(2048)).toBe('2.0 KB');
    expect(ImageCore.formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
    expect(ImageCore.formatBytes(-1)).toBe('—');
    expect(ImageCore.hexToRgb('#2563eb')).toEqual([37, 99, 235]);
    expect(ImageCore.hexToRgb('fff', [1, 2, 3])).toEqual([255, 255, 255]);
    expect(ImageCore.hexToRgb('not-a-colour', [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('converts to grayscale and high-contrast black and white while keeping alpha', () => {
    const source = image(2, 1, [
      255, 128, 0, 255,
      10, 20, 30, 128
    ]);
    const gray = ImageCore.grayscale(source);
    const expected = Math.round(255 * 0.299 + 128 * 0.587);
    expect(pixel(gray.data, 0, 0, 2)).toEqual([expected, expected, expected, 255]);
    expect(pixel(gray.data, 1, 0, 2)).toEqual([gray.data[4], gray.data[4], gray.data[4], 128]);

    const binary = ImageCore.threshold(source, 128);
    expect(pixel(binary.data, 0, 0, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(binary.data, 1, 0, 2)).toEqual([0, 0, 0, 128]);
  });

  it('inverts RGB values without touching alpha', () => {
    const out = ImageCore.invert(image(1, 1, [10, 200, 255, 64]));
    expect(pixel(out.data, 0, 0, 1)).toEqual([245, 55, 0, 64]);
  });

  it('flips horizontally and vertically', () => {
    const source = image(2, 2, [
      1, 0, 0, 255, 2, 0, 0, 255,
      3, 0, 0, 255, 4, 0, 0, 255
    ]);
    expect(ImageCore.flip(source, 'horizontal').data.filter((v, i) => i % 4 === 0)).toEqual(
      new Uint8ClampedArray([2, 1, 4, 3])
    );
    expect(ImageCore.flip(source, 'vertical').data.filter((v, i) => i % 4 === 0)).toEqual(
      new Uint8ClampedArray([3, 4, 1, 2])
    );
  });

  it('rotates quarter turns and swaps dimensions', () => {
    const source = image(2, 3, [
      1, 0, 0, 255, 2, 0, 0, 255,
      3, 0, 0, 255, 4, 0, 0, 255,
      5, 0, 0, 255, 6, 0, 0, 255
    ]);
    const right = ImageCore.rotate90(source, 'right');
    const left = ImageCore.rotate90(source, 'left');
    expect([right.width, right.height]).toEqual([3, 2]);
    expect([left.width, left.height]).toEqual([3, 2]);
    expect(pixel(right.data, 0, 0, 3)[0]).toBe(5);
    expect(pixel(right.data, 2, 0, 3)[0]).toBe(1);
    expect(pixel(left.data, 0, 0, 3)[0]).toBe(2);
    expect(pixel(left.data, 2, 0, 3)[0]).toBe(6);
  });

  it('resizes with interpolated pixels and respects fit and stretch modes', () => {
    const source = image(2, 2, [
      0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255
    ]);
    const resized = ImageCore.resize(source, 4, 4);
    expect([resized.width, resized.height]).toEqual([4, 4]);
    expect(pixel(resized.data, 0, 0, 4)[0]).toBe(0);
    expect(pixel(resized.data, 3, 3, 4)[0]).toBe(255);
    expect(ImageCore.fitDimensions(800, 400, 400, 400, true, 'fit')).toEqual({ width: 400, height: 200 });
    expect(ImageCore.fitDimensions(800, 400, 400, 400, true, 'stretch')).toEqual({ width: 400, height: 400 });
    expect(ImageCore.fitDimensions(800, 400, 10000, 10000, false, 'fit')).toEqual({ width: 8000, height: 8000 });
  });

  it('composes an opaque border around transparent source pixels', () => {
    const source = image(1, 1, [255, 0, 0, 128]);
    const bordered = ImageCore.composeBorder(source, 2, '#ffffff');
    expect([bordered.width, bordered.height]).toEqual([5, 5]);
    expect(pixel(bordered.data, 0, 0, 5)).toEqual([255, 255, 255, 255]);
    expect(pixel(bordered.data, 2, 2, 5)).toEqual([255, 127, 127, 255]);
  });

  it('clamps crop rectangles to the source image', () => {
    expect(ImageCore.cropRect(40, 20, { x: -5, y: 25, w: 100, h: 100 })).toEqual({ x: 0, y: 19, w: 40, h: 1 });
    expect(ImageCore.cropRect(40, 20, { x: 10, y: 5, w: 20, h: 10 })).toEqual({ x: 10, y: 5, w: 20, h: 10 });
  });

  it('rejects files and dimensions that exceed the documented limits', () => {
    expect(ImageCore.withinLimits(50 * 1024 * 1024, 100, 100)).toBeNull();
    expect(ImageCore.withinLimits(50 * 1024 * 1024 + 1, 100, 100)).toContain('50 MB');
    expect(ImageCore.withinLimits(0, 9000, 100)).toContain('8,000 px');
    expect(ImageCore.withinLimits(0, 8000, 8000)).toContain('40 million');
    expect(ImageCore.clampInt('abc', 1, 10, 5)).toBe(5);
  });
});
