/* LetitEdit shared audio codecs.
 *
 * Real encoders for WAV (16-bit PCM), AIFF (16-bit PCM) and FLAC (lossless,
 * fixed predictors + Rice coding), a decoder for AIFF/AIFC because Chrome
 * cannot decode AIFF natively, and a store-only ZIP writer for batch
 * downloads. Everything runs on typed arrays in memory; no audio is uploaded.
 *
 * The FLAC encoder is a genuine FLAC stream, not a renamed WAV: it writes a
 * STREAMINFO block, fixed-predictor subframes, Rice-coded residuals and the
 * frame CRCs. It is simpler than libFLAC, so files are usually a little
 * larger than a desktop encoder's output, but they decode losslessly.
 */

const FLAC_BLOCK = 4096;
const TWO_POW_32 = 4294967296;

/* ------------------------------------------------------------------ */
/* Sample conversion                                                  */
/* ------------------------------------------------------------------ */

export function toInt16(value) {
  const sample = Math.max(-1, Math.min(1, Number(value) || 0));
  return sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
}

function toFloat16(value) {
  const sample = Math.max(-32768, Math.min(32767, value));
  return sample < 0 ? sample / 0x8000 : sample / 0x7fff;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/* ------------------------------------------------------------------ */
/* WAV                                                                */
/* ------------------------------------------------------------------ */

export async function encodeWav(channels, sampleRate, tick) {
  const channelCount = channels.length;
  if (!channelCount) throw new Error('No audio samples were received.');
  const frames = channels[0].length;
  if (!frames) throw new Error('The audio contains no samples.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('The sample rate is invalid.');
  }

  const dataBytes = frames * channelCount * 2;
  if (dataBytes > 0xffffffff - 44) {
    throw new Error('The audio is too long for a WAV file. Convert fewer files at once.');
  }
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const chunkFrames = 32768;
  for (let offset = 0; offset < frames; offset += chunkFrames) {
    const end = Math.min(frames, offset + chunkFrames);
    let byteOffset = 44 + offset * channelCount * 2;
    for (let frame = offset; frame < end; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        view.setInt16(byteOffset, toInt16(channels[channel][frame]), true);
        byteOffset += 2;
      }
    }
    if (tick) await tick(end / frames, 'Writing WAV');
  }
  return buffer;
}

/* ------------------------------------------------------------------ */
/* AIFF / AIFC                                                        */
/* ------------------------------------------------------------------ */

function writeExtended80(view, offset, value) {
  for (let index = 0; index < 10; index += 1) view.setUint8(offset + index, 0);
  if (!(value > 0)) return;
  const exponent = Math.floor(Math.log2(value));
  let mantissa;
  if (Number.isInteger(value) && exponent <= 63) {
    mantissa = BigInt(value) << BigInt(63 - exponent);
  } else {
    mantissa = BigInt(Math.round(value * Math.pow(2, 63 - exponent)));
  }
  view.setUint16(offset, exponent + 16383);
  view.setUint32(offset + 2, Number((mantissa >> 32n) & 0xffffffffn));
  view.setUint32(offset + 6, Number(mantissa & 0xffffffffn));
}

export async function encodeAiff(channels, sampleRate, tick) {
  const channelCount = channels.length;
  if (!channelCount) throw new Error('No audio samples were received.');
  const frames = channels[0].length;
  if (!frames) throw new Error('The audio contains no samples.');
  if (channelCount > 0xffff) throw new Error('AIFF supports at most 65535 channels.');

  const dataBytes = frames * channelCount * 2;
  if (dataBytes > 0xffffffff - 64) {
    throw new Error('The audio is too long for an AIFF file. Convert fewer files at once.');
  }

  const commSize = 18;
  const ssndSize = 8 + dataBytes;
  const formSize = 4 + (8 + commSize) + (8 + ssndSize);
  const buffer = new ArrayBuffer(8 + formSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'FORM');
  view.setUint32(4, formSize, false);
  writeAscii(view, 8, 'AIFF');
  writeAscii(view, 12, 'COMM');
  view.setUint32(16, commSize, false);
  view.setUint16(20, channelCount, false);
  view.setUint32(22, frames, false);
  view.setUint16(26, 16, false);
  writeExtended80(view, 28, sampleRate);
  writeAscii(view, 38, 'SSND');
  view.setUint32(42, ssndSize, false);
  view.setUint32(46, 0, false);
  view.setUint32(50, 0, false);

  const dataOffset = 54;
  const chunkFrames = 32768;
  for (let offset = 0; offset < frames; offset += chunkFrames) {
    const end = Math.min(frames, offset + chunkFrames);
    let byteOffset = dataOffset + offset * channelCount * 2;
    for (let frame = offset; frame < end; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        view.setInt16(byteOffset, toInt16(channels[channel][frame]), false);
        byteOffset += 2;
      }
    }
    if (tick) await tick(end / frames, 'Writing AIFF');
  }
  return buffer;
}

function readExtended80(view, offset) {
  const raw = view.getUint16(offset);
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  if (raw === 0 && hi === 0 && lo === 0) return 0;
  const sign = raw & 0x8000 ? -1 : 1;
  const exponent = (raw & 0x7fff) - 16383;
  const mantissa = (hi * TWO_POW_32 + lo) / Math.pow(2, 63);
  return sign * mantissa * Math.pow(2, exponent);
}

export function decodeAiff(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 12) throw new Error('The AIFF file is too short.');
  const form = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  );
  if (form !== 'FORM') throw new Error('The file is not an AIFF file.');
  const formType = String.fromCharCode(
    view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)
  );
  if (formType !== 'AIFF' && formType !== 'AIFC') {
    throw new Error('The FORM file is not AIFF or AIFC audio.');
  }

  let channels = 0;
  let frames = 0;
  let bits = 0;
  let sampleRate = 0;
  let compression = formType === 'AIFC' ? 'NONE' : 'NONE';
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, false);
    const body = offset + 8;
    if (body + size > view.byteLength) {
      if (id === 'SSND') {
        // Some writers overstate the last chunk size; clamp instead of failing.
        dataLength = Math.max(0, view.byteLength - body - 8);
      } else {
        break;
      }
    }
    if (id === 'COMM' && size >= 18) {
      channels = view.getUint16(body, false);
      frames = view.getUint32(body + 2, false);
      bits = view.getUint16(body + 6, false);
      sampleRate = readExtended80(view, body + 8);
      if (formType === 'AIFC' && size >= 22) {
        compression = String.fromCharCode(
          view.getUint8(body + 18), view.getUint8(body + 19),
          view.getUint8(body + 20), view.getUint8(body + 21)
        );
      }
    } else if (id === 'SSND' && size >= 8) {
      const blockOffset = view.getUint32(body, false);
      dataOffset = body + 8 + blockOffset;
      dataLength = size - 8 - blockOffset;
      if (dataOffset + dataLength > view.byteLength) {
        dataLength = Math.max(0, view.byteLength - dataOffset);
      }
    }
    offset = body + size + (size % 2);
  }

  if (!channels || !sampleRate) throw new Error('The AIFF file has no COMM chunk.');
  if (dataOffset < 0 || !dataLength) throw new Error('The AIFF file has no audio data.');
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || sampleRate > 768000) {
    throw new Error(`The AIFF sample rate (${sampleRate}) is not supported.`);
  }

  const isFloat = compression === 'fl32' || compression === 'FL32' ||
    compression === 'fl64' || compression === 'FL64';
  const littleEndian = compression === 'sowt';
  if (!isFloat && compression !== 'NONE' && compression !== 'sowt' && compression !== 'twos') {
    throw new Error(`This AIFF uses the "${compression}" compression, which is not supported.`);
  }
  if (!isFloat && ![8, 16, 24, 32].includes(bits)) {
    throw new Error(`AIFF samples of ${bits} bits are not supported.`);
  }

  const bytesPerSample = isFloat
    ? (compression === 'fl64' || compression === 'FL64' ? 8 : 4)
    : bits / 8;
  const frameBytes = bytesPerSample * channels;
  const available = Math.floor(dataLength / frameBytes);
  const totalFrames = frames > 0 ? Math.min(frames, available) : available;
  if (!totalFrames) throw new Error('The AIFF file contains no complete sample frames.');

  const result = [];
  for (let channel = 0; channel < channels; channel += 1) {
    result.push(new Float32Array(totalFrames));
  }

  for (let frame = 0; frame < totalFrames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const position = dataOffset + frame * frameBytes + channel * bytesPerSample;
      let value;
      if (isFloat) {
        value = bytesPerSample === 8
          ? view.getFloat64(position, littleEndian)
          : view.getFloat32(position, littleEndian);
        value = Math.max(-1, Math.min(1, value));
      } else if (bits === 8) {
        value = view.getInt8(position) / 128;
      } else if (bits === 16) {
        value = view.getInt16(position, littleEndian) / 32768;
      } else if (bits === 24) {
        const b0 = view.getUint8(position + (littleEndian ? 2 : 0));
        const b1 = view.getUint8(position + 1);
        const b2 = view.getUint8(position + (littleEndian ? 0 : 2));
        let int = (b0 << 16) | (b1 << 8) | b2;
        if (int & 0x800000) int -= 0x1000000;
        value = int / 8388608;
      } else {
        value = view.getInt32(position, littleEndian) / 2147483648;
      }
      result[channel][frame] = value;
    }
  }

  return {
    sampleRate: Math.round(sampleRate),
    channels: result,
    frames: totalFrames,
    duration: totalFrames / sampleRate,
    bits,
    compression
  };
}

/* ------------------------------------------------------------------ */
/* FLAC                                                               */
/* ------------------------------------------------------------------ */

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.count = 0;
  }

  write(value, bits) {
    if (!bits) return;
    let v;
    if (bits >= 32) v = value >>> 0;
    else v = value & ((1 << bits) - 1);
    this.acc = this.acc * Math.pow(2, bits) + v;
    this.count += bits;
    while (this.count >= 8) {
      this.count -= 8;
      const scale = Math.pow(2, this.count);
      const byte = Math.floor(this.acc / scale) & 0xff;
      this.bytes.push(byte);
      this.acc -= byte * scale;
    }
  }

  writeUnary(quotient) {
    let remaining = quotient;
    while (remaining >= 24) {
      this.write(0, 24);
      remaining -= 24;
    }
    if (remaining > 0) this.write(0, remaining);
    this.write(1, 1);
  }

  align() {
    if (this.count > 0) this.write(0, 8 - this.count);
  }

  toBytes() {
    this.align();
    return Uint8Array.from(this.bytes);
  }
}

function crc8(bytes, start, end) {
  let crc = 0;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function crc16(bytes, start, end) {
  let crc = 0;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function utf8FrameNumber(value) {
  if (value < 0x80) return [value];
  if (value < 0x800) {
    return [0xc0 | (value >> 6), 0x80 | (value & 0x3f)];
  }
  if (value < 0x10000) {
    return [0xe0 | (value >> 12), 0x80 | ((value >> 6) & 0x3f), 0x80 | (value & 0x3f)];
  }
  if (value < 0x200000) {
    return [
      0xf0 | (value >> 18),
      0x80 | ((value >> 12) & 0x3f),
      0x80 | ((value >> 6) & 0x3f),
      0x80 | (value & 0x3f)
    ];
  }
  return [
    0xf8 | (value >> 24),
    0x80 | ((value >> 18) & 0x3f),
    0x80 | ((value >> 12) & 0x3f),
    0x80 | ((value >> 6) & 0x3f),
    0x80 | (value & 0x3f)
  ];
}

function zigzag(value) {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}

function residualAt(samples, offset, index, order) {
  const value = samples[offset + index];
  switch (order) {
    case 0: return value;
    case 1: return value - samples[offset + index - 1];
    case 2: return value - 2 * samples[offset + index - 1] + samples[offset + index - 2];
    case 3: {
      return value - 3 * samples[offset + index - 1] + 3 * samples[offset + index - 2] -
        samples[offset + index - 3];
    }
    default: {
      return value - 4 * samples[offset + index - 1] + 6 * samples[offset + index - 2] -
        4 * samples[offset + index - 3] + samples[offset + index - 4];
    }
  }
}

function chooseOrder(samples, offset, size) {
  const limit = Math.min(size, 2048);
  let bestOrder = 0;
  let bestCost = Infinity;
  for (let order = 0; order <= 4; order += 1) {
    if (limit <= order) break;
    let cost = 0;
    for (let index = order; index < limit; index += 1) {
      cost += Math.abs(residualAt(samples, offset, index, order));
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOrder = order;
    }
  }
  return bestOrder;
}

function bitLength(value) {
  if (value === 0) return 0;
  return 32 - Math.clz32(value);
}

function chooseRice(residuals) {
  const count = residuals.length;
  if (!count) return { k: 0, escape: false, rawBits: 1 };

  let sum = 0;
  let maxAbs = 0;
  for (let index = 0; index < count; index += 1) {
    const residual = residuals[index];
    sum += zigzag(residual);
    const abs = Math.abs(residual);
    if (abs > maxAbs) maxAbs = abs;
  }
  const mean = sum / count;
  const guess = Math.max(0, Math.min(14, mean > 0 ? Math.floor(Math.log2(mean)) : 0));

  let bestK = guess;
  let bestBits = Infinity;
  for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 1); k += 1) {
    let bits = count * (k + 1);
    for (let index = 0; index < count; index += 1) {
      bits += zigzag(residuals[index]) >>> k;
    }
    if (bits < bestBits) {
      bestBits = bits;
      bestK = k;
    }
  }

  const rawBits = Math.max(1, Math.min(32, bitLength(maxAbs) + 1));
  const escapeBits = 5 + count * rawBits;
  if (escapeBits < bestBits) {
    return { k: 15, escape: true, rawBits };
  }
  return { k: bestK, escape: false, rawBits };
}

function writeSubframe(writer, samples, offset, size) {
  const order = chooseOrder(samples, offset, size);
  writer.write(0, 1);
  writer.write(0b001000 | order, 6);
  writer.write(0, 1);
  for (let index = 0; index < order; index += 1) {
    writer.write(samples[offset + index], 16);
  }

  const count = size - order;
  const residuals = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    residuals[index] = residualAt(samples, offset, index + order, order);
  }

  writer.write(0, 2);
  writer.write(0, 4);
  const choice = chooseRice(residuals);
  writer.write(choice.k, 4);
  if (choice.escape) {
    writer.write(choice.rawBits, 5);
    for (let index = 0; index < count; index += 1) {
      writer.write(residuals[index], choice.rawBits);
    }
    return;
  }
  const mask = (1 << choice.k) - 1;
  for (let index = 0; index < count; index += 1) {
    const value = zigzag(residuals[index]);
    writer.writeUnary(value >>> choice.k);
    if (choice.k) writer.write(value & mask, choice.k);
  }
}

export async function encodeFlac(floatChannels, sampleRate, tick) {
  const channelCount = floatChannels.length;
  if (!channelCount) throw new Error('No audio samples were received.');
  if (channelCount > 8) throw new Error('FLAC supports at most 8 channels.');
  const frames = floatChannels[0].length;
  if (!frames) throw new Error('The audio contains no samples.');
  if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 1048575) {
    throw new Error('The sample rate is invalid for FLAC.');
  }

  const channels = floatChannels.map((channel) => {
    const samples = new Int32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      samples[index] = toInt16(channel[index]);
    }
    return samples;
  });

  const blocks = [];
  for (let start = 0; start < frames; start += FLAC_BLOCK) {
    blocks.push(Math.min(FLAC_BLOCK, frames - start));
  }
  if (blocks.length > 1 && blocks[blocks.length - 1] < 16) {
    const need = 16 - blocks[blocks.length - 1];
    blocks[blocks.length - 2] -= need;
    blocks[blocks.length - 1] = 16;
  }

  const minBlock = Math.min(...blocks);
  const maxBlock = Math.max(...blocks);

  const info = new Uint8Array(34);
  const infoView = new DataView(info.buffer);
  infoView.setUint16(0, minBlock, false);
  infoView.setUint16(2, maxBlock, false);
  infoView.setUint32(4, 0, false);
  infoView.setUint32(7, 0, false);

  const packed = new BitWriter();
  packed.write(sampleRate, 20);
  packed.write(channelCount - 1, 3);
  packed.write(15, 5);
  packed.write(Math.floor(frames / TWO_POW_32), 4);
  packed.write(frames >>> 0, 32);
  info.set(packed.toBytes(), 10);

  const header = new Uint8Array(8 + 34);
  header.set([0x66, 0x4c, 0x61, 0x43], 0);
  header[4] = 0x80;
  header[5] = 0;
  header[6] = 0;
  header[7] = 34;
  header.set(info, 8);

  const parts = [header];
  let offset = 0;
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const size = blocks[blockIndex];
    const head = [0xff, 0xf8, (7 << 4) | 0, ((channelCount - 1) << 4) | (4 << 1) | 0];
    const frameNumber = utf8FrameNumber(blockIndex);
    for (let index = 0; index < frameNumber.length; index += 1) {
      head.push(frameNumber[index]);
    }
    head.push((size - 1) >> 8, (size - 1) & 0xff);
    const headBytes = Uint8Array.from(head);

    const writer = new BitWriter();
    for (let channel = 0; channel < channelCount; channel += 1) {
      writeSubframe(writer, channels[channel], offset, size);
    }
    const subframes = writer.toBytes();

    const total = headBytes.length + 1 + subframes.length;
    const frame = new Uint8Array(total + 2);
    frame.set(headBytes, 0);
    frame[headBytes.length] = crc8(headBytes, 0, headBytes.length);
    frame.set(subframes, headBytes.length + 1);
    const checksum = crc16(frame, 0, total);
    frame[total] = checksum >> 8;
    frame[total + 1] = checksum & 0xff;

    parts.push(frame);
    offset += size;
    if (tick) await tick(offset / frames, 'Writing FLAC');
  }

  let length = 0;
  for (const part of parts) length += part.length;
  const output = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return output.buffer;
}

/* ------------------------------------------------------------------ */
/* ZIP (store method, no compression)                                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function buildZip(entries, date) {
  const stamp = dosDateTime(date || new Date());
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  let centralSize = 0;
  for (const central of centrals) centralSize += central.length;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return [...locals, ...centrals, end];
}
