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

describe('Image & Photo upgraded engines', () => {
  function hexBytes(hex) { return Uint8Array.from(hex.match(/../g).map(value => parseInt(value, 16))); }

  it('identifies HEIF brands from an ISO BMFF ftyp box instead of the filename', () => {
    const header = hexBytes(
      '0000001c667479706d696631000000006d6966316865696368657663'
    );
    const detected = ImageCore.detectHeifBrand(header);
    expect(detected.isHeif).toBe(true);
    expect(detected.brand).toBe('mif1');
    expect(detected.extension).toBe('heif');
    expect(detected.mime).toBe('image/heif');
    expect(detected.compatibleBrands).toEqual(['mif1', 'heic', 'hevc']);
    expect(detected.reason).toContain('mif1');

    const jpeg = hexBytes('00000014667479706a706567000000006a706567');
    expect(ImageCore.detectHeifBrand(jpeg).isHeif).toBe(false);
    expect(ImageCore.detectHeifBrand(new Uint8Array(4)).isHeif).toBe(false);
  });

  it('reads a conventional EXIF orientation tag when present', () => {
    const bytes = new Uint8Array(30);
    'Exif'.split('').forEach((char, index) => { bytes[index] = char.charCodeAt(0); });
    bytes[6] = 0x49; bytes[7] = 0x49;
    bytes[8] = 42;
    bytes[10] = 8;
    bytes[14] = 1;
    bytes[16] = 0x12; bytes[17] = 0x01;
    bytes[24] = 6;
    expect(ImageCore.exifOrientation(bytes)).toBe(6);
    expect(ImageCore.exifOrientation(new Uint8Array(4))).toBe(1);
  });

  it('forces aspect-ratio crops back inside the source rectangle', () => {
    expect(ImageCore.cropAspectRect(100, 100, { x: 10, y: 10, w: 60, h: 60 }, 2))
      .toEqual({ x: 10, y: 25, w: 60, h: 30 });
    expect(ImageCore.cropAspectRect(100, 100, { x: 10, y: 10, w: 60, h: 60 }, 'free'))
      .toEqual({ x: 10, y: 10, w: 60, h: 60 });
  });

  it('applies pixel adjustments, sharpening and blur without losing alpha', () => {
    const source = image(3, 1, [
      255, 0, 0, 128,
      0, 0, 0, 255,
      0, 0, 255, 64
    ]);
    const gray = ImageCore.adjustImageData(source, { grayscale: 100 });
    expect(pixel(gray.data, 0, 0, 3)[0]).toBe(pixel(gray.data, 0, 0, 3)[1]);
    expect(pixel(gray.data, 0, 0, 3)[2]).toBe(pixel(gray.data, 0, 0, 3)[1]);
    expect(pixel(gray.data, 0, 0, 3)[3]).toBe(128);
    const brighter = ImageCore.adjustImageData(source, { brightness: 20 });
    expect(brighter.data[0]).toBeGreaterThan(source.data[0] - 1);

    const centerOnly = image(3, 3, [
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 50, 50, 50, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255
    ]);
    expect(pixel(ImageCore.sharpen(centerOnly, 50).data, 1, 1, 3)[0]).toBe(150);
    const blurred = ImageCore.boxBlur(image(3, 1, [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]), 1);
    expect(pixel(blurred.data, 0, 0, 3)[0]).toBe(85);
    expect(pixel(blurred.data, 1, 0, 3)[0]).toBe(85);
  });

  it('rotates by arbitrary angles and removes plain edge-connected backgrounds', () => {
    expect(ImageCore.rotatedBounds(40, 20, 90)).toEqual({ width: 20, height: 40 });
    const rotated = ImageCore.rotateArbitrary(image(2, 1, [
      255, 0, 0, 255,
      0, 0, 255, 255
    ]), 90, '#ffffff');
    expect([rotated.width, rotated.height]).toEqual([1, 2]);
    expect(pixel(rotated.data, 0, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(rotated.data, 0, 1, 1)).toEqual([0, 0, 255, 255]);

    const cutout = image(3, 3, [
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ]);
    const removed = ImageCore.removeBackground(cutout, 45, 0);
    expect(pixel(removed.data, 0, 0, 3)[3]).toBe(0);
    expect(pixel(removed.data, 1, 1, 3)).toEqual([255, 0, 0, 255]);
  });

  it('lays out mosaics with exact gaps and cell sizes', () => {
    const items = [
      { width: 20, height: 10 }, { width: 20, height: 10 }, { width: 20, height: 10 }
    ];
    const horizontal = ImageCore.mosaicLayout(items, { layout: 'horizontal', gap: 4 });
    expect([horizontal.width, horizontal.height]).toEqual([68, 10]);
    expect(horizontal.cells.map(cell => cell.x)).toEqual([0, 24, 48]);

    const vertical = ImageCore.mosaicLayout(items, { layout: 'vertical', gap: 4 });
    expect([vertical.width, vertical.height]).toEqual([20, 38]);
    expect(vertical.cells.map(cell => cell.y)).toEqual([0, 14, 28]);

    const grid = ImageCore.mosaicLayout(items, {
      layout: 'grid', gap: 4, columns: 2, sizeMode: 'custom', cellWidth: 20, cellHeight: 10
    });
    expect([grid.width, grid.height, grid.columns, grid.rows]).toEqual([44, 24, 2, 2]);
  });

  it('builds structured QR payloads and validates required fields', () => {
    expect(ImageCore.buildPayload('url', { url: 'example.com/page' })).toEqual({
      ok: true, value: 'https://example.com/page'
    });
    expect(ImageCore.buildPayload('email', { email: 'a@example.com', subject: 'Hi there' }).value)
      .toBe('mailto:a@example.com?subject=Hi%20there');
    expect(ImageCore.buildPayload('wifi', { ssid: 'My;Network', encryption: 'WPA', password: 'p:a' }).value)
      .toBe('WIFI:T:WPA;S:My\\;Network;P:p\\:a;H:false;;');
    expect(ImageCore.buildPayload('url', { url: '' }).ok).toBe(false);
    expect(ImageCore.buildPayload('location', { latitude: 95, longitude: 0 }).ok).toBe(false);
  });

  it('encodes local barcode patterns and rejects invalid values', () => {
    const code128 = ImageCore.barcodeEncode('code128', 'ABC');
    expect(code128.ok).toBe(true);
    expect(code128.set).toBe('B');
    expect(code128.bits).toMatch(/^0{10}[01]+0{10}$/);
    expect(code128.bits.length).toBeGreaterThan(60);

    const ean13 = ImageCore.barcodeEncode('ean13', '590123412345');
    expect(ean13.ok).toBe(true);
    expect(ean13.text).toHaveLength(13);
    expect(ImageCore.barcodeEncode('ean13', '123').ok).toBe(false);
    expect(ImageCore.barcodeEncode('itf', '123').ok).toBe(false);
    expect(ImageCore.barcodeEncode('codabar', '123').ok).toBe(false);
    expect(ImageCore.BARCODE_TYPES).not.toContain('codabar');
  });
});
