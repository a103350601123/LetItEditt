/* Generates small deterministic image fixtures for the editor tests.
 * Run with: node tests/fixtures/make-fixtures.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = __dirname;

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pixel(x, y, width, height) {
  const nx = x / width;
  const ny = y / height;
  let r = Math.round(40 + nx * 190);
  let g = Math.round(60 + ny * 150);
  let b = Math.round(180 - nx * 120 + ny * 40);
  const dx = x - width * 0.62;
  const dy = y - height * 0.42;
  if (dx * dx + dy * dy < Math.pow(Math.min(width, height) * 0.22, 2)) {
    r = 245;
    g = 225;
    b = 60;
  }
  if (Math.floor(x / 24) % 2 === Math.floor(y / 24) % 2 && x < width * 0.32 && y > height * 0.6) {
    r = 255 - r;
    g = 255 - g;
    b = 255 - b;
  }
  return [r, g, b, 255];
}

function makePng(width, height) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y, width, height);
      const offset = y * stride + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function makeBmp(width, height) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelSize = rowSize * height;
  const buffer = Buffer.alloc(54 + pixelSize);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(54 + pixelSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelSize, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, sourceY, width, height);
      const offset = 54 + y * rowSize + x * 3;
      buffer[offset] = b;
      buffer[offset + 1] = g;
      buffer[offset + 2] = r;
    }
  }
  return buffer;
}

function makeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5c2ddd"/>
      <stop offset="1" stop-color="#f2edff"/>
    </linearGradient>
  </defs>
  <rect width="480" height="320" fill="url(#sky)"/>
  <circle cx="350" cy="90" r="52" fill="#ffd84d"/>
  <path d="M0 250 L120 150 L220 230 L320 130 L480 260 L480 320 L0 320 Z" fill="#17123a"/>
  <text x="32" y="62" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">LetitEdit</text>
</svg>
`;
}

function makeMaliciousSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120" onload="window.__svgXss = 'onload'">
  <script>window.__svgXss = 'script';</script>
  <a href="javascript:window.__svgXss='link'"><rect width="200" height="120" fill="#5c2ddd"/></a>
  <foreignObject x="10" y="10" width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
</svg>
`;
}

function makeTiff(width, height, compression) {  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y, width, height);
      const offset = (y * width + x) * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const strip = compression === 8 ? zlib.deflateSync(raw) : raw;
  const tags = 10;
  const ifdOffset = 8;
  const ifdSize = 2 + tags * 12 + 4;
  const bitsOffset = ifdOffset + ifdSize;
  const stripOffset = bitsOffset + 8;
  const buffer = Buffer.alloc(stripOffset + strip.length);
  buffer.write('II', 0, 'ascii');
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(ifdOffset, 4);
  buffer.writeUInt16LE(tags, ifdOffset);
  let entry = ifdOffset + 2;
  const writeEntry = (tag, type, count, value) => {
    buffer.writeUInt16LE(tag, entry);
    buffer.writeUInt16LE(type, entry + 2);
    buffer.writeUInt32LE(count, entry + 4);
    if (type === 3 && count === 1) buffer.writeUInt16LE(value, entry + 8);
    else buffer.writeUInt32LE(value, entry + 8);
    entry += 12;
  };
  writeEntry(256, 4, 1, width);
  writeEntry(257, 4, 1, height);
  writeEntry(258, 3, 4, bitsOffset);
  writeEntry(259, 3, 1, compression);
  writeEntry(262, 3, 1, 2);
  writeEntry(273, 4, 1, stripOffset);
  writeEntry(277, 3, 1, 4);
  writeEntry(278, 4, 1, height);
  writeEntry(279, 4, 1, strip.length);
  writeEntry(338, 3, 1, 2);
  buffer.writeUInt32LE(0, entry);
  [8, 8, 8, 8].forEach((value, index) => buffer.writeUInt16LE(value, bitsOffset + index * 2));
  strip.copy(buffer, stripOffset);
  return buffer;
}

fs.writeFileSync(path.join(outDir, 'sample.png'), makePng(320, 200));
fs.writeFileSync(path.join(outDir, 'sample.bmp'), makeBmp(160, 100));
fs.writeFileSync(path.join(outDir, 'sample.svg'), makeSvg());
fs.writeFileSync(path.join(outDir, 'sample.tiff'), makeTiff(320, 200, 8));
fs.writeFileSync(path.join(outDir, 'sample-unsafe.svg'), makeMaliciousSvg());
console.log('Wrote sample.png, sample.bmp, sample.svg, sample.tiff and sample-unsafe.svg to', outDir);
