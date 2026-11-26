/* LetitEdit Audio Converter - page controller.
 *
 * Files are inspected (format, rate, channels, duration) without being fully
 * decoded. During conversion each file is decoded to samples, resampled and
 * mixed with an OfflineAudioContext, then encoded either in a worker
 * (WAV/AIFF/FLAC/MP3) or with WebCodecs through Mediabunny (M4A/OGG).
 * Nothing is uploaded and no audio leaves the tab.
 */

import { decodeAiff } from './audio-codecs.js';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30 * 60;
const SNIFF_BYTES = 256 * 1024;

const FORMATS = {
  mp3: {
    label: 'MP3',
    extension: 'mp3',
    mime: 'audio/mpeg',
    lossy: true,
    rates: [22050, 44100, 48000],
    note: 'MP3 is the safest choice for phones, car stereos and older software. It is lossy, so some detail is discarded during encoding.',
    rateNote: 'MP3 supports 22.05, 44.1 and 48 kHz here. Auto keeps the source rate when it is one of them.'
  },
  wav: {
    label: 'WAV',
    extension: 'wav',
    mime: 'audio/wav',
    lossy: false,
    rates: [22050, 44100, 48000],
    note: 'WAV writes uncompressed 16-bit PCM. The files are large but every editor and video tool can read them.',
    rateNote: 'WAV keeps the chosen sample rate exactly. Resampling to a higher rate does not add detail.'
  },
  flac: {
    label: 'FLAC',
    extension: 'flac',
    mime: 'audio/flac',
    lossy: false,
    rates: [22050, 44100, 48000],
    note: 'FLAC stores the same 16-bit samples as WAV with lossless compression, so files are smaller and nothing is discarded.',
    rateNote: 'FLAC keeps the chosen sample rate exactly. Compression is lossless at every rate.'
  },
  m4a: {
    label: 'M4A',
    extension: 'm4a',
    mime: 'audio/mp4',
    lossy: true,
    rates: [44100, 48000],
    note: 'M4A stores AAC audio in an MP4 container. It is efficient and plays natively on Apple devices and most modern software.',
    rateNote: 'The AAC encoder in this browser accepts 44.1 and 48 kHz. Auto uses 44.1 kHz when the source is 22.05 kHz or lower.'
  },
  ogg: {
    label: 'OGG',
    extension: 'ogg',
    mime: 'audio/ogg',
    lossy: true,
    rates: [48000],
    note: 'OGG here contains Opus audio, an efficient modern codec for voice and streaming. The Opus encoder always produces 48 kHz output.',
    rateNote: 'Opus output is always 48 kHz. The source is resampled once when it uses another rate.'
  },
  aiff: {
    label: 'AIFF',
    extension: 'aiff',
    mime: 'audio/aiff',
    lossy: false,
    rates: [22050, 44100, 48000],
    note: 'AIFF is uncompressed 16-bit PCM in an Apple container. It is a good fit for Apple software and Pro Tools workflows.',
    rateNote: 'AIFF keeps the chosen sample rate exactly. Files are about as large as WAV.'
  }
};

const RATE_LABELS = { 22050: '22.05 kHz', 44100: '44.1 kHz', 48000: '48 kHz' };

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5h3v13H8zM13 5.5h3v13h-3z" fill="currentColor"/></svg>';
const REMOVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const els = {};
const state = {
  files: [],
  converting: false,
  cancelled: false,
  progress: 0,
  worker: null,
  workerJob: null,
  output: null,
  capabilities: { mp3: false, aac: false, opus: false, mp3Probed: false, webcodecsProbed: false },
  statusMessage: '',
  playing: null,
  resultsVisible: false,
  nextId: 1
};

let mediabunnyPromise = null;
let previewContext = null;
let previewNode = null;
let previewFrame = 0;

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

function $(selector) {
  return document.querySelector(selector);
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const secondsText = secs < 10 ? `0${secs.toFixed(1)}` : secs.toFixed(1);
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`;
  return `${minutes}:${secondsText}`;
}

function truncate(text, length) {
  const value = String(text || '');
  return value.length > length ? `${value.slice(0, Math.max(1, length - 1))}...` : value;
}

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function tagAt(view, offset, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function loadMediabunny() {
  if (!mediabunnyPromise) {
    mediabunnyPromise = import('../vendor/mediabunny/mediabunny.min.mjs').catch((error) => {
      mediabunnyPromise = null;
      throw error;
    });
  }
  return mediabunnyPromise;
}

/* ------------------------------------------------------------------ */
/* Messages and progress                                              */
/* ------------------------------------------------------------------ */

function setStatus(message) {
  state.statusMessage = message || '';
  els.status.textContent = state.statusMessage;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = '';
}

function showFileError(message) {
  els.fileError.textContent = message;
  els.fileError.hidden = false;
}

function clearFileError() {
  els.fileError.hidden = true;
  els.fileError.textContent = '';
}

function setProgress(value, label) {
  const safe = Math.max(0, Math.min(1, Number(value) || 0));
  state.progress = safe;
  const percent = Math.round(safe * 100);
  els.progressTrack.setAttribute('aria-valuenow', String(percent));
  els.progressBar.style.width = `${percent}%`;
  if (label) els.progressLabel.textContent = label;
}

/* ------------------------------------------------------------------ */
/* Format detection and header parsing                                */
/* ------------------------------------------------------------------ */

const EXTENSION_FORMATS = {
  mp3: { id: 'mp3', label: 'MP3' },
  wav: { id: 'wav', label: 'WAV' },
  wave: { id: 'wav', label: 'WAV' },
  aif: { id: 'aiff', label: 'AIFF' },
  aiff: { id: 'aiff', label: 'AIFF' },
  aifc: { id: 'aiff', label: 'AIFF' },
  flac: { id: 'flac', label: 'FLAC' },
  m4a: { id: 'm4a', label: 'M4A' },
  m4b: { id: 'm4a', label: 'M4A' },
  mp4: { id: 'm4a', label: 'M4A' },
  aac: { id: 'aac', label: 'AAC' },
  ogg: { id: 'ogg', label: 'OGG' },
  oga: { id: 'ogg', label: 'OGG' },
  opus: { id: 'ogg', label: 'OPUS' },
  webm: { id: 'webm', label: 'WEBM' },
  wma: { id: 'wma', label: 'WMA', unsupported: 'WMA is not supported because no current browser decodes it.' }
};

function extensionOf(name) {
  const match = /\.([^.\\/]+)$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function detectFormat(file, bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;

  if (length >= 12 && tagAt(view, 0, 4) === 'RIFF' && tagAt(view, 8, 4) === 'WAVE') {
    return { id: 'wav', label: 'WAV' };
  }
  if (length >= 12 && tagAt(view, 0, 4) === 'FORM') {
    const type = tagAt(view, 8, 4);
    if (type === 'AIFF' || type === 'AIFC') return { id: 'aiff', label: 'AIFF' };
  }
  if (length >= 4 && tagAt(view, 0, 4) === 'fLaC') return { id: 'flac', label: 'FLAC' };
  if (length >= 4 && tagAt(view, 0, 4) === 'OggS') return { id: 'ogg', label: 'OGG' };
  if (length >= 12 && tagAt(view, 4, 4) === 'ftyp') return { id: 'm4a', label: 'M4A' };
  if (length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { id: 'webm', label: 'WEBM' };
  }
  if (length >= 4 && bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) {
    return { id: 'wma', label: 'WMA', unsupported: 'WMA is not supported because no current browser decodes it.' };
  }
  if (length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { id: 'mp3', label: 'MP3' };
  }
  if (length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    if ((bytes[1] & 0x06) === 0) return { id: 'aac', label: 'AAC' };
    return { id: 'mp3', label: 'MP3' };
  }

  const fromExtension = EXTENSION_FORMATS[extensionOf(file.name)];
  if (fromExtension) return fromExtension;
  if (file.type && /^audio\//.test(file.type)) {
    return { id: 'unknown', label: extensionOf(file.name).toUpperCase() || 'AUDIO' };
  }
  return {
    id: 'unknown',
    label: extensionOf(file.name).toUpperCase() || 'FILE',
    unsupported: 'This file does not look like audio this browser can decode.'
  };
}

function parseWavHeader(view) {
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tagAt(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= view.byteLength) {
      return {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true)
      };
    }
    offset = body + size + (size % 2);
    if (size < 0 || offset <= body) break;
  }
  return {};
}

function parseAiffHeader(view) {
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tagAt(view, offset, 4);
    const size = view.getUint32(offset + 4, false);
    const body = offset + 8;
    if (id === 'COMM' && body + 18 <= view.byteLength) {
      return {
        channels: view.getUint16(body, false),
        frames: view.getUint32(body + 2, false),
        bits: view.getUint16(body + 6, false),
        sampleRate: readExtended80(view, body + 8)
      };
    }
    offset = body + size + (size % 2);
    if (size < 0 || offset <= body) break;
  }
  return {};
}

function readExtended80(view, offset) {
  const raw = view.getUint16(offset);
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  if (raw === 0 && hi === 0 && lo === 0) return 0;
  const exponent = (raw & 0x7fff) - 16383;
  const mantissa = (hi * 4294967296 + lo) / Math.pow(2, 63);
  return mantissa * Math.pow(2, exponent);
}

function parseFlacHeader(view) {
  if (view.byteLength < 42) return {};
  const rate = (view.getUint8(18) << 12) | (view.getUint8(19) << 4) | (view.getUint8(20) >> 4);
  const channels = ((view.getUint8(20) >> 1) & 0x07) + 1;
  const bits = (((view.getUint8(20) & 0x01) << 4) | (view.getUint8(21) >> 4)) + 1;
  const total = ((view.getUint8(21) & 0x0f) * 4294967296) +
    (view.getUint32(22, false) >>> 0);
  return { sampleRate: rate, channels, bits, frames: total };
}

function parseOggHeader(view) {
  const limit = Math.min(view.byteLength - 16, 4096);
  for (let offset = 0; offset < limit; offset += 1) {
    if (tagAt(view, offset, 8) === 'OpusHead') {
      return {
        channels: view.getUint8(offset + 9),
        sampleRate: 48000
      };
    }
    if (tagAt(view, offset, 7) === '\x01vorbis') {
      return {
        channels: view.getUint8(offset + 11),
        sampleRate: view.getUint32(offset + 12, true)
      };
    }
  }
  return {};
}

const MP3_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
};

function parseMp3Header(view) {
  let offset = 0;
  if (view.byteLength > 10 && tagAt(view, 0, 3) === 'ID3') {
    const size = ((view.getUint8(6) & 0x7f) << 21) | ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) | (view.getUint8(9) & 0x7f);
    offset = 10 + size;
  }
  const limit = Math.min(view.byteLength - 4, offset + 65536);
  for (let position = Math.max(0, offset); position < limit; position += 1) {
    if (view.getUint8(position) !== 0xff) continue;
    const b1 = view.getUint8(position + 1);
    if ((b1 & 0xe0) !== 0xe0) continue;
    const version = (b1 >> 3) & 0x03;
    if (version === 1) continue;
    const b2 = view.getUint8(position + 2);
    const rateIndex = (b2 >> 2) & 0x03;
    if (rateIndex === 3) continue;
    const rates = MP3_RATES[version];
    if (!rates) continue;
    const b3 = view.getUint8(position + 3);
    const mode = (b3 >> 6) & 0x03;
    return { sampleRate: rates[rateIndex], channels: mode === 3 ? 1 : 2 };
  }
  return {};
}

function parseMp4Header(view) {
  const limit = view.byteLength - 12;
  for (let offset = 0; offset < limit; offset += 1) {
    if (tagAt(view, offset, 4) !== 'mdhd') continue;
    const version = view.getUint8(offset + 4);
    if (version === 0) return { sampleRate: view.getUint32(offset + 16, false) };
    return { sampleRate: view.getUint32(offset + 24, false) };
  }
  return {};
}

function readHeaderInfo(bytes, formatId) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (formatId === 'wav') return parseWavHeader(view);
    if (formatId === 'aiff') return parseAiffHeader(view);
    if (formatId === 'flac') return parseFlacHeader(view);
    if (formatId === 'ogg') return parseOggHeader(view);
    if (formatId === 'mp3') return parseMp3Header(view);
    if (formatId === 'm4a') return parseMp4Header(view);
  } catch (error) {
    // Header parsing is best-effort; decoding remains the source of truth.
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* Adding files                                                       */
/* ------------------------------------------------------------------ */

function totalInputBytes() {
  return state.files.reduce((sum, entry) => sum + entry.size, 0);
}

function isDuplicate(file) {
  return state.files.some((entry) =>
    entry.file.name === file.name &&
    entry.file.size === file.size
  );
}

function baseName(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

function outputName(name, extension) {
  const base = baseName(name).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'audio';
  return `${base}.${extension}`;
}

function uniqueOutputName(entry, extension) {
  const candidate = outputName(entry.name, extension);
  const used = new Set(
    state.files
      .filter((item) => item !== entry && item.result)
      .map((item) => item.result.name)
  );
  if (!used.has(candidate)) return candidate;
  const stem = baseName(candidate);
  let index = 2;
  while (used.has(`${stem} (${index}).${extension}`)) index += 1;
  return `${stem} (${index}).${extension}`;
}

function readDuration(entry) {
  if (entry.format.id === 'aiff' && entry.header.frames && entry.header.sampleRate) {
    return entry.header.frames / entry.header.sampleRate;
  }
  if (entry.format.id === 'flac' && entry.header.frames && entry.header.sampleRate) {
    return entry.header.frames / entry.header.sampleRate;
  }
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(0), 6000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const value = Number(audio.duration);
      finish(Number.isFinite(value) && value > 0 ? value : 0);
    };
    audio.onerror = () => finish(0);
    audio.src = entry.objectUrl;
  });
}

async function addFiles(fileList) {
  if (state.converting) {
    setStatus('Wait for the current conversion to finish or cancel it before adding files.');
    return;
  }
  const files = Array.from(fileList || []);
  if (!files.length) return;

  clearError();
  clearFileError();
  const rejected = [];

  for (const file of files) {
    if (state.files.length >= MAX_FILES) {
      rejected.push(`${file.name}: the limit is ${MAX_FILES} files per batch.`);
      continue;
    }
    if (isDuplicate(file)) {
      rejected.push(`${file.name}: already in the list.`);
      continue;
    }
    if (file.size === 0) {
      addEntry({
        file,
        format: { id: 'unknown', label: extensionOf(file.name).toUpperCase() || 'FILE' },
        blocked: true,
        error: 'This file is empty.'
      });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      addEntry({
        file,
        format: { id: 'unknown', label: extensionOf(file.name).toUpperCase() || 'FILE' },
        blocked: true,
        error: `This file is larger than ${formatBytes(MAX_FILE_BYTES)}.`
      });
      continue;
    }
    if (totalInputBytes() + file.size > MAX_TOTAL_BYTES) {
      rejected.push(`${file.name}: the batch would exceed ${formatBytes(MAX_TOTAL_BYTES)} in total.`);
      continue;
    }

    els.loading.hidden = false;
    els.loadingText.textContent = `Reading ${truncate(file.name, 48)}...`;
    const bytes = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const format = detectFormat(file, bytes);
    const header = readHeaderInfo(bytes, format.id);
    els.loading.hidden = true;

    if (format.unsupported) {
      addEntry({
        file,
        format,
        blocked: true,
        error: format.unsupported
      });
      continue;
    }

    const entry = {
      id: `file-${state.nextId++}`,
      file,
      name: file.name,
      size: file.size,
      format,
      header,
      objectUrl: URL.createObjectURL(file),
      sourceRate: header.sampleRate || 0,
      channels: header.channels || 0,
      duration: 0,
      status: 'ready',
      message: '',
      error: '',
      progress: 0,
      result: null,
      blocked: false,
      playing: false
    };
    entry.duration = await readDuration(entry);
    state.files.push(entry);
    await yieldToLoop();
  }

  els.loading.hidden = true;
  renderAll();
  if (rejected.length) showFileError(rejected.join(' '));
  setStatus(state.files.length
    ? `${state.files.length} file${state.files.length === 1 ? '' : 's'} ready. Choose an output format and convert.`
    : '');
  updateConvertButton();
}

function addEntry({ file, format, blocked, error }) {
  const entry = {
    id: `file-${state.nextId++}`,
    file,
    name: file.name,
    size: file.size,
    format,
    header: {},
    objectUrl: URL.createObjectURL(file),
    sourceRate: 0,
    channels: 0,
    duration: 0,
    status: 'error',
    message: '',
    error: error || 'This file cannot be converted.',
    progress: 0,
    result: null,
    blocked: Boolean(blocked),
    playing: false
  };
  state.files.push(entry);
}

/* ------------------------------------------------------------------ */
/* File list rendering                                                */
/* ------------------------------------------------------------------ */

function metaText(entry) {
  const parts = [entry.format.label];
  if (entry.duration > 0) parts.push(formatDuration(entry.duration));
  parts.push(formatBytes(entry.size));
  if (entry.sourceRate) parts.push(RATE_LABELS[entry.sourceRate] || `${entry.sourceRate} Hz`);
  if (entry.channels) parts.push(entry.channels === 1 ? 'mono' : `${entry.channels} ch`);
  return parts.join(' Â· ');
}

function statusText(entry) {
  if (entry.status === 'decoding') return 'Decoding audioâ€¦';
  if (entry.status === 'encoding') return entry.message || 'Encodingâ€¦';
  if (entry.status === 'done' && entry.result) {
    return `Done Â· ${formatBytes(entry.result.size)} Â· ${entry.result.formatLabel}`;
  }
  if (entry.status === 'error') return entry.error || 'This file could not be converted.';
  if (entry.status === 'cancelled') return 'Cancelled';
  return 'Ready to convert';
}

function syncRow(entry) {
  const refs = entry.refs;
  if (!refs) return;
  refs.li.dataset.status = entry.status;
  refs.meta.textContent = metaText(entry);
  refs.status.textContent = statusText(entry);
  refs.status.className = 'acv-file-status';
  if (entry.status === 'decoding' || entry.status === 'encoding') refs.status.classList.add('is-working');
  if (entry.status === 'done') refs.status.classList.add('is-done');
  if (entry.status === 'error') refs.status.classList.add('is-error');

  const working = entry.status === 'decoding' || entry.status === 'encoding';
  refs.progress.hidden = !working;
  if (working) refs.bar.style.width = `${Math.round((entry.progress || 0) * 100)}%`;

  refs.download.hidden = !entry.result;
  if (entry.result) {
    refs.download.href = entry.result.url;
    refs.download.download = entry.result.name;
    refs.download.setAttribute('aria-label', `Download ${entry.result.name}`);
  }

  const playable = !entry.blocked && entry.status !== 'error' && entry.status !== 'decoding' && entry.status !== 'encoding';
  refs.play.disabled = !playable;
  refs.play.setAttribute('aria-label', entry.playing ? `Pause ${entry.name}` : `Preview ${entry.name}`);
  refs.play.innerHTML = entry.playing ? PAUSE_ICON : PLAY_ICON;
  refs.play.setAttribute('aria-pressed', entry.playing ? 'true' : 'false');
}

function buildRow(entry, index) {
  const li = make('li', 'acv-file');
  li.dataset.id = entry.id;
  li.dataset.status = entry.status;

  const number = make('span', 'acv-file-index', String(index + 1));
  number.setAttribute('aria-hidden', 'true');

  const badge = make('span', 'acv-file-badge', entry.format.label);
  badge.setAttribute('aria-hidden', 'true');

  const main = make('div', 'acv-file-main');
  const name = make('p', 'acv-file-name', entry.name);
  name.title = entry.name;
  const meta = make('p', 'acv-file-meta', metaText(entry));
  const progress = make('div', 'acv-file-progress');
  progress.hidden = true;
  const bar = make('span');
  progress.append(bar);
  const status = make('p', 'acv-file-status', statusText(entry));
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  main.append(name, meta, progress, status);

  const actions = make('div', 'acv-file-actions');
  const play = make('button', 'acv-icon-btn');
  play.type = 'button';
  play.dataset.play = '';
  play.setAttribute('aria-pressed', 'false');
  play.innerHTML = PLAY_ICON;

  const download = make('a', 'acv-btn acv-btn-secondary acv-btn-small', 'Download');
  download.download = '';
  download.hidden = true;
  download.dataset.download = '';

  const remove = make('button', 'acv-icon-btn');
  remove.type = 'button';
  remove.dataset.remove = '';
  remove.setAttribute('aria-label', `Remove ${entry.name}`);
  remove.title = 'Remove';
  remove.innerHTML = REMOVE_ICON;

  actions.append(play, download, remove);
  li.append(number, badge, main, actions);

  entry.refs = { li, meta, progress, bar, status, play, download, remove };

  play.addEventListener('click', () => togglePlayback(entry));
  remove.addEventListener('click', () => removeEntry(entry));
  return li;
}

function renderList() {
  els.fileList.textContent = '';
  state.files.forEach((entry, index) => {
    els.fileList.append(buildRow(entry, index));
    syncRow(entry);
  });
}

function renderAll() {
  const count = state.files.length;
  els.empty.hidden = count > 0;
  els.editor.hidden = count === 0;
  els.summaryTitle.textContent = `${count} file${count === 1 ? '' : 's'} ready`;
  els.summaryMeta.textContent = count
    ? `${formatBytes(totalInputBytes())} of input Â· output ${FORMATS[els.format.value].label}`
    : '';
  renderList();
  updateFormatUi();
  updateConvertButton();
  updateResultsUi();
}

function updateConvertButton() {
  const usable = state.files.filter((entry) => !entry.blocked).length;
  const label = usable === 1 ? 'Convert file' : `Convert ${usable || 0} files`;
  els.convert.textContent = label;
  els.convert.disabled = state.converting || usable === 0;
  els.cancel.hidden = !state.converting;
  els.addMore.disabled = state.converting;
  els.clearAll.disabled = state.converting;
  els.format.disabled = state.converting;
  els.bitrate.disabled = state.converting || !FORMATS[els.format.value].lossy;
  els.quality.disabled = state.converting || !FORMATS[els.format.value].lossy;
  els.rate.disabled = state.converting;
  els.channels.disabled = state.converting;
}

function updateResultsUi() {
  const finished = state.files.filter((entry) => entry.result);
  els.results.hidden = !finished.length;
  els.downloadZip.hidden = finished.length < 2;
  if (!finished.length) return;
  const total = finished.reduce((sum, entry) => sum + entry.result.size, 0);
  els.resultsTitle.textContent = `${finished.length} file${finished.length === 1 ? '' : 's'} converted`;
  els.resultsSummary.textContent = `${formatBytes(total)} in total Â· ${finished[0].result.formatLabel} output. Download each file below or take the whole batch as a ZIP.`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function resolveRate(entry) {
  const format = els.format.value;
  const allowed = FORMATS[format].rates;
  const selected = els.rate.value;
  if (selected !== 'auto') return Number(selected);
  const source = entry.sourceRate || 0;
  if (!source) return allowed.includes(44100) ? 44100 : allowed[allowed.length - 1];
  if (allowed.includes(source)) return source;
  const above = allowed.find((rate) => rate >= source);
  return above || allowed[allowed.length - 1];
}

function resolveChannels(entry) {
  const selected = els.channels.value;
  if (selected === 'mono') return 1;
  if (selected === 'stereo') return 2;
  return entry.channels === 1 ? 1 : 2;
}

function bitrate() {
  return Number(els.bitrate.value) * 1000;
}

function estimateBytes(entry) {
  const format = els.format.value;
  const rate = resolveRate(entry);
  const channels = resolveChannels(entry);
  const duration = entry.duration || 0;
  if (format === 'wav') return 44 + duration * rate * channels * 2;
  if (format === 'aiff') return 54 + duration * rate * channels * 2;
  if (format === 'flac') return 42 + duration * rate * channels * 2 * 0.62;
  return duration * bitrate() / 8;
}

function updateSummary() {
  const usable = state.files.filter((entry) => !entry.blocked);
  if (!usable.length) {
    els.exportSummary.textContent = 'Add audio files to see the output summary.';
    return;
  }
  const spec = FORMATS[els.format.value];
  const rates = new Set(usable.map(resolveRate));
  const channels = new Set(usable.map(resolveChannels));
  const rateLabel = rates.size === 1 ? RATE_LABELS[[...rates][0]] : 'mixed rates';
  const channelLabel = channels.size === 1 ? ([...channels][0] === 1 ? 'mono' : 'stereo') : 'mixed layouts';
  const parts = [`${usable.length} file${usable.length === 1 ? '' : 's'} â†’ ${spec.label}`];
  if (spec.lossy) parts.push(`${els.bitrate.value} kbps`);
  parts.push(rateLabel, channelLabel);
  const known = usable.every((entry) => entry.duration > 0);
  const total = usable.reduce((sum, entry) => sum + estimateBytes(entry), 0);
  parts.push(known ? `about ${formatBytes(total)}` : 'size available after conversion');
  els.exportSummary.textContent = parts.join(' Â· ');
}

function updateFormatUi() {
  const format = els.format.value;
  const spec = FORMATS[format];
  els.formatNote.textContent = spec.note;
  els.rateNote.textContent = spec.rateNote;
  els.qualityField.hidden = !spec.lossy;
  els.bitrateField.hidden = !spec.lossy;
  for (const option of els.rate.options) {
    if (option.value === 'auto') {
      option.disabled = false;
      continue;
    }
    option.disabled = !spec.rates.includes(Number(option.value));
  }
  if (els.rate.value !== 'auto' && !spec.rates.includes(Number(els.rate.value))) {
    els.rate.value = 'auto';
  }
  els.bitrate.disabled = state.converting || !spec.lossy;
  els.quality.disabled = state.converting || !spec.lossy;
  updateSummary();
}

function updateFormatAvailability() {
  const reasons = {
    m4a: state.capabilities.aac ? '' : 'This browser has no AAC encoder.',
    ogg: state.capabilities.opus ? '' : 'This browser has no Opus encoder.'
  };
  for (const [value, reason] of Object.entries(reasons)) {
    const option = els.format.querySelector(`option[value="${value}"]`);
    if (!option) continue;
    option.disabled = Boolean(reason);
    option.title = reason;
  }
  const mp3Option = els.format.querySelector('option[value="mp3"]');
  if (mp3Option) {
    mp3Option.disabled = state.capabilities.mp3Probed && !state.capabilities.mp3;
    mp3Option.title = state.capabilities.mp3Probed && !state.capabilities.mp3
      ? 'The local MP3 encoder did not start in this browser.'
      : '';
  }
  if (els.format.selectedOptions[0] && els.format.selectedOptions[0].disabled) {
    els.format.value = 'wav';
  }
  updateFormatUi();
}

/* ------------------------------------------------------------------ */
/* Decoding, resampling and encoding                                  */
/* ------------------------------------------------------------------ */

async function decodeEntry(entry) {
  const bytes = await entry.file.arrayBuffer();
  if (entry.format.id === 'aiff') {
    const decoded = decodeAiff(bytes);
    return {
      audioBuffer: null,
      channels: decoded.channels,
      sampleRate: decoded.sampleRate,
      length: decoded.frames,
      duration: decoded.duration
    };
  }
  const rate = entry.sourceRate || 44100;
  let context;
  try {
    context = new OfflineAudioContext(1, 1, rate);
  } catch (error) {
    context = new OfflineAudioContext(1, 1, 44100);
  }
  const audioBuffer = await context.decodeAudioData(bytes);
  return {
    audioBuffer,
    channels: null,
    sampleRate: audioBuffer.sampleRate,
    length: audioBuffer.length,
    duration: audioBuffer.duration
  };
}

async function prepareAudio(decoded, rate, channelCount) {
  const sourceChannels = decoded.audioBuffer
    ? decoded.audioBuffer.numberOfChannels
    : decoded.channels.length;
  if (decoded.sampleRate === rate && sourceChannels === channelCount) {
    return {
      audioBuffer: decoded.audioBuffer,
      channels: decoded.channels,
      sampleRate: rate,
      channelCount,
      length: decoded.length,
      duration: decoded.duration
    };
  }
  const length = Math.max(1, Math.ceil(decoded.length * rate / decoded.sampleRate));
  const context = new OfflineAudioContext(channelCount, length, rate);
  let sourceBuffer = decoded.audioBuffer;
  if (!sourceBuffer) {
    sourceBuffer = new AudioBuffer({
      length: decoded.length,
      numberOfChannels: sourceChannels,
      sampleRate: decoded.sampleRate
    });
    decoded.channels.forEach((channel, index) => sourceBuffer.copyToChannel(channel, index));
  }
  const node = context.createBufferSource();
  node.buffer = sourceBuffer;
  node.connect(context.destination);
  node.start();
  const rendered = await context.startRendering();
  return {
    audioBuffer: rendered,
    channels: null,
    sampleRate: rate,
    channelCount,
    length: rendered.length,
    duration: rendered.duration
  };
}

function channelArrays(audio) {
  if (audio.channels) return audio.channels;
  const arrays = [];
  for (let index = 0; index < audio.channelCount; index += 1) {
    arrays.push(audio.audioBuffer.getChannelData(index));
  }
  return arrays;
}

async function encodeWithWorker(entry, audio, onProgress) {
  const format = els.format.value;
  const channels = channelArrays(audio);
  const message = {
    type: 'encode',
    format,
    channels,
    sampleRate: audio.sampleRate,
    bitrate: bitrate()
  };
  const response = await runWorker(message, channels.map((channel) => channel.buffer), onProgress);
  const spec = FORMATS[format];
  const blob = new Blob([response.buffer], { type: spec.mime });
  return {
    blob,
    url: URL.createObjectURL(blob),
    name: uniqueOutputName(entry, spec.extension),
    mime: spec.mime,
    extension: spec.extension,
    formatLabel: response.formatLabel,
    size: blob.size,
    duration: audio.duration,
    sampleRate: audio.sampleRate,
    channels: audio.channelCount
  };
}

async function encodeWithWebCodecs(entry, audio, onProgress) {
  const format = els.format.value;
  const spec = FORMATS[format];
  const codec = format === 'm4a' ? 'aac' : 'opus';
  const label = format === 'm4a' ? 'M4A' : 'OGG';
  const mediabunny = await loadMediabunny();

  let buffer = audio.audioBuffer;
  if (!buffer) {
    buffer = new AudioBuffer({
      length: audio.length,
      numberOfChannels: audio.channelCount,
      sampleRate: audio.sampleRate
    });
    audio.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  }

  if (typeof AudioEncoder !== 'undefined') {
    let support;
    try {
      support = await AudioEncoder.isConfigSupported({
        codec: format === 'm4a' ? 'mp4a.40.2' : 'opus',
        sampleRate: audio.sampleRate,
        numberOfChannels: audio.channelCount,
        bitrate: bitrate()
      });
    } catch (error) {
      support = { supported: false };
    }
    if (!support || !support.supported) {
      throw new Error(
        `This browser cannot encode ${codec.toUpperCase()} at ${RATE_LABELS[audio.sampleRate] || `${audio.sampleRate} Hz`} with ${audio.channelCount} channel(s). Choose another sample rate or format.`
      );
    }
  }

  const outputFormat = format === 'm4a'
    ? new mediabunny.Mp4OutputFormat()
    : new mediabunny.OggOutputFormat();
  const output = new mediabunny.Output({
    format: outputFormat,
    target: new mediabunny.BufferTarget()
  });

  let encodedSeconds = 0;
  const source = new mediabunny.AudioBufferSource({
    codec,
    quality: new mediabunny.Quality({ bitrate: bitrate() }),
    onEncodedPacket: (packet) => {
      if (typeof packet.duration === 'number') encodedSeconds += packet.duration;
      const ratio = buffer.duration ? Math.min(0.99, encodedSeconds / buffer.duration) : 0;
      onProgress(ratio, `Encoding ${label} Â· ${Math.round(ratio * 100)}%`);
    }
  });
  output.addAudioTrack(source);
  state.output = output;
  await output.start();
  try {
    await source.add(buffer);
    source.close();
    await output.finalize();
  } finally {
    state.output = null;
  }

  const data = output.target.buffer;
  const blob = new Blob([data], { type: spec.mime });
  return {
    blob,
    url: URL.createObjectURL(blob),
    name: uniqueOutputName(entry, spec.extension),
    mime: spec.mime,
    extension: spec.extension,
    formatLabel: `${spec.label} Â· ${Math.round(bitrate() / 1000)} kbps`,
    size: blob.size,
    duration: audio.duration,
    sampleRate: audio.sampleRate,
    channels: audio.channelCount
  };
}

function getWorker() {
  if (!state.worker) {
    state.worker = new Worker(new URL('./audio-converter-worker.js', import.meta.url), { type: 'module' });
  }
  return state.worker;
}

function runWorker(message, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    state.workerJob = { resolve, reject, onProgress };
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'progress') {
        if (state.workerJob && state.workerJob.onProgress) {
          state.workerJob.onProgress(data.value, data.label);
        }
        return;
      }
      if (data.type === 'done') {
        state.workerJob = null;
        resolve(data);
        return;
      }
      if (data.type === 'error') {
        state.workerJob = null;
        reject(new Error(data.message || 'The audio encoder failed.'));
      }
    };
    worker.onerror = (event) => {
      state.workerJob = null;
      reject(new Error(event.message || 'The encoder worker stopped unexpectedly.'));
    };
    worker.postMessage(message, transfer);
  });
}

function terminateWorker() {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  state.workerJob = null;
}

/* ------------------------------------------------------------------ */
/* Conversion                                                         */
/* ------------------------------------------------------------------ */

function setEntryStatus(entry, status, message) {
  entry.status = status;
  if (message) entry.message = message;
  if (status !== 'encoding' && status !== 'decoding') entry.progress = status === 'done' ? 1 : entry.progress;
  syncRow(entry);
}

function setEntryProgress(entry, value, label) {
  entry.progress = Math.max(0, Math.min(1, Number(value) || 0));
  if (entry.refs) {
    entry.refs.progress.hidden = false;
    entry.refs.bar.style.width = `${Math.round(entry.progress * 100)}%`;
    entry.refs.status.textContent = label;
    entry.refs.status.className = 'acv-file-status is-working';
  }
}

function releaseResult(entry) {
  if (entry.result && entry.result.url) URL.revokeObjectURL(entry.result.url);
  entry.result = null;
}

function clearResults() {
  for (const entry of state.files) releaseResult(entry);
  state.resultsVisible = false;
  updateResultsUi();
  renderList();
}

async function startConversion() {
  if (state.converting) return;
  const usable = state.files.filter((entry) => !entry.blocked);
  if (!usable.length) {
    showFileError('Add at least one file that this browser can decode.');
    return;
  }

  clearError();
  clearFileError();
  stopPlayback();
  for (const entry of state.files) {
    releaseResult(entry);
    if (!entry.blocked) {
      entry.status = 'ready';
      entry.error = '';
      entry.progress = 0;
      entry.message = '';
    }
    syncRow(entry);
  }

  state.converting = true;
  state.cancelled = false;
  state.progress = 0;
  els.progress.hidden = false;
  els.results.hidden = true;
  setProgress(0, 'Preparing the conversionâ€¦');
  updateConvertButton();
  updateFormatUi();
  renderList();

  const total = state.files.length;
  let completed = 0;
  let failed = 0;
  let cancelled = false;

  for (let index = 0; index < state.files.length; index += 1) {
    const entry = state.files[index];
    if (entry.blocked) {
      failed += 1;
      continue;
    }
    if (state.cancelled) {
      cancelled = true;
      break;
    }
    const base = index / total;

    try {
      setEntryStatus(entry, 'decoding');
      setEntryProgress(entry, 0.05, 'Decoding audioâ€¦');
      setProgress(base, `Decoding ${truncate(entry.name, 40)} Â· file ${index + 1} of ${total}`);
      const decoded = await decodeEntry(entry);
      if (state.cancelled) {
        cancelled = true;
        break;
      }
      if (decoded.duration > MAX_DURATION_SECONDS) {
        throw new Error(`This file is longer than ${MAX_DURATION_SECONDS / 60} minutes. Split it first or convert a shorter excerpt.`);
      }
      entry.sourceRate = decoded.sampleRate;
      entry.channels = decoded.audioBuffer
        ? decoded.audioBuffer.numberOfChannels
        : decoded.channels.length;
      entry.duration = decoded.duration;

      const rate = resolveRate(entry);
      const channelCount = resolveChannels(entry);
      setEntryProgress(entry, 0.15, 'Preparing audioâ€¦');
      setProgress(base + 0.05 / total, `Resampling ${truncate(entry.name, 40)}`);
      const audio = await prepareAudio(decoded, rate, channelCount);
      if (state.cancelled) {
        cancelled = true;
        break;
      }

      setEntryStatus(entry, 'encoding');
      setEntryProgress(entry, 0.2, 'Encodingâ€¦');
      const onProgress = (value, label) => {
        setEntryProgress(entry, 0.2 + Math.max(0, Math.min(1, value)) * 0.8, label);
        setProgress((index + 0.2 + Math.max(0, Math.min(1, value)) * 0.8) / total, `${label} Â· ${truncate(entry.name, 32)}`);
      };

      const format = els.format.value;
      const result = format === 'm4a' || format === 'ogg'
        ? await encodeWithWebCodecs(entry, audio, onProgress)
        : await encodeWithWorker(entry, audio, onProgress);

      if (state.cancelled) {
        if (result.url) URL.revokeObjectURL(result.url);
        cancelled = true;
        break;
      }
      entry.result = result;
      entry.progress = 1;
      setEntryStatus(entry, 'done', `Done Â· ${formatBytes(result.size)} Â· ${result.formatLabel}`);
      completed += 1;
      setProgress((index + 1) / total, `${completed} of ${total} finished`);
      await yieldToLoop();
    } catch (error) {
      if (state.cancelled) {
        setEntryStatus(entry, 'cancelled', 'Cancelled');
        cancelled = true;
        break;
      }
      failed += 1;
      const message = error && error.message ? error.message : 'This file could not be converted.';
      entry.error = message;
      setEntryStatus(entry, 'error');
      setProgress((index + 1) / total, `${completed} of ${total} finished`);
    }
  }

  state.converting = false;
  terminateWorker();
  if (state.output) {
    try { state.output.cancel(); } catch (error) { /* already finished */ }
    state.output = null;
  }
  els.progress.hidden = true;
  els.cancel.hidden = true;
  updateConvertButton();
  updateFormatUi();
  updateResultsUi();

  if (cancelled) {
    for (const entry of state.files) {
      if (entry.status === 'decoding' || entry.status === 'encoding') {
        entry.status = 'cancelled';
        entry.message = '';
        entry.progress = 0;
      }
    }
    setStatus(`Conversion cancelled. ${completed} file${completed === 1 ? '' : 's'} finished before the stop.`);
    renderList();
    return;
  }

  renderList();
  if (!completed) {
    setStatus('No files were converted. Check the messages in the list.');
    return;
  }
  const summary = failed
    ? `${completed} file${completed === 1 ? '' : 's'} converted, ${failed} failed.`
    : `${completed} file${completed === 1 ? '' : 's'} converted.`;
  setStatus(`${summary} Downloads are ready${completed > 1 ? ', or use the ZIP button for the whole batch' : ''}.`);

  if (completed === 1) {
    const only = state.files.find((entry) => entry.result);
    if (only) triggerDownload(only.result);
  }
}

function cancelConversion() {
  if (!state.converting) return;
  state.cancelled = true;
  setStatus('Cancelling the conversionâ€¦');
  if (state.workerJob) {
    const job = state.workerJob;
    state.workerJob = null;
    try { job.reject(new DOMException('Cancelled', 'AbortError')); } catch (error) { /* noop */ }
  }
  terminateWorker();
  if (state.output) {
    try { state.output.cancel(); } catch (error) { /* noop */ }
    state.output = null;
  }
}

function triggerDownload(result) {
  const anchor = document.createElement('a');
  anchor.href = result.url;
  anchor.download = result.name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function downloadZip() {
  const finished = state.files.filter((entry) => entry.result);
  if (!finished.length) return;
  els.downloadZip.disabled = true;
  setStatus('Building the ZIP archive locallyâ€¦');
  try {
    const entries = [];
    for (const entry of finished) {
      const buffer = await entry.result.blob.arrayBuffer();
      entries.push({ name: entry.result.name, buffer });
    }
    const response = await runWorker(
      { type: 'zip', entries },
      entries.map((entry) => entry.buffer),
      (value, label) => setStatus(label || 'Building the ZIP archiveâ€¦')
    );
    const blob = new Blob([response.buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    triggerDownload({ url, name: 'audio-converted.zip' });
    setStatus(`ZIP archive ready Â· ${formatBytes(blob.size)}. The download is local and was not uploaded.`);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    showError(error && error.message ? error.message : 'The ZIP archive could not be built.');
  } finally {
    els.downloadZip.disabled = false;
    terminateWorker();
  }
}

/* ------------------------------------------------------------------ */
/* Playback                                                           */
/* ------------------------------------------------------------------ */

function setRowPlayback(entry, ratio) {
  if (!entry.refs || state.converting) return;
  entry.refs.progress.hidden = false;
  entry.refs.bar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

function stopPlayback() {
  if (state.playing) {
    const entry = state.playing;
    entry.playing = false;
    if (entry.refs) {
      entry.refs.progress.hidden = true;
      entry.refs.bar.style.width = '0%';
    }
    state.playing = null;
    syncRow(entry);
  }
  if (els.player) {
    els.player.pause();
    els.player.removeAttribute('src');
    els.player.load();
  }
  if (previewNode) {
    try { previewNode.stop(); } catch (error) { /* already stopped */ }
    previewNode = null;
  }
  if (previewFrame) {
    cancelAnimationFrame(previewFrame);
    previewFrame = 0;
  }
}

async function togglePlayback(entry) {
  if (state.playing === entry) {
    stopPlayback();
    return;
  }
  stopPlayback();
  if (!entry.result && entry.format.id === 'aiff') {
    await playAiffPreview(entry);
    return;
  }
  const url = entry.result ? entry.result.url : entry.objectUrl;
  els.player.src = url;
  state.playing = entry;
  entry.playing = true;
  syncRow(entry);
  try {
    await els.player.play();
  } catch (error) {
    stopPlayback();
    setStatus('The browser blocked playback. Press the play button again to allow it.');
  }
}

async function playAiffPreview(entry) {
  setStatus('Decoding the AIFF file for previewâ€¦');
  state.playing = entry;
  entry.playing = true;
  syncRow(entry);
  try {
    const bytes = await entry.file.arrayBuffer();
    if (state.playing !== entry) return;
    const decoded = decodeAiff(bytes);
    if (state.playing !== entry) return;
    if (!previewContext) previewContext = new AudioContext();
    if (previewContext.state === 'suspended') await previewContext.resume();
    if (state.playing !== entry) return;
    const buffer = previewContext.createBuffer(
      decoded.channels.length,
      decoded.frames,
      decoded.sampleRate
    );
    decoded.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
    const node = previewContext.createBufferSource();
    node.buffer = buffer;
    node.connect(previewContext.destination);
    const started = previewContext.currentTime;
    node.start();
    previewNode = node;
    setStatus('');
    const tick = () => {
      if (state.playing !== entry) return;
      const elapsed = previewContext.currentTime - started;
      setRowPlayback(entry, elapsed / decoded.duration);
      if (elapsed < decoded.duration) {
        previewFrame = requestAnimationFrame(tick);
      } else {
        stopPlayback();
      }
    };
    previewFrame = requestAnimationFrame(tick);
  } catch (error) {
    stopPlayback();
    setStatus(error && error.message ? error.message : 'The AIFF file could not be previewed.');
  }
}

/* ------------------------------------------------------------------ */
/* Removal and cleanup                                                */
/* ------------------------------------------------------------------ */

function removeEntry(entry) {
  if (state.converting) return;
  if (state.playing === entry) stopPlayback();
  releaseResult(entry);
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  state.files = state.files.filter((item) => item !== entry);
  renderAll();
  setStatus(state.files.length ? '' : 'The list is empty. Add audio files to convert.');
}

function clearAll() {
  if (state.converting) return;
  stopPlayback();
  for (const entry of state.files) {
    releaseResult(entry);
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  state.files = [];
  state.progress = 0;
  els.progress.hidden = true;
  els.results.hidden = true;
  clearError();
  clearFileError();
  renderAll();
  setStatus('The list is empty. Add audio files to convert.');
}

function cleanupPage() {
  stopPlayback();
  for (const entry of state.files) {
    releaseResult(entry);
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entry.objectUrl = '';
  }
  if (previewContext) {
    previewContext.close().catch(() => {});
    previewContext = null;
  }
  terminateWorker();
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function cacheElements() {
  els.app = $('[data-app]');
  els.dropzone = $('[data-dropzone]');
  els.browse = $('[data-browse]');
  els.fileInput = $('[data-file-input]');
  els.empty = $('[data-empty]');
  els.loading = $('[data-loading]');
  els.loadingText = $('[data-loading-text]');
  els.support = $('[data-support]');
  els.supportText = $('[data-support-text]');
  els.error = $('[data-global-error]');
  els.status = $('[data-status]');
  els.editor = $('[data-editor]');
  els.fileList = $('[data-file-list]');
  els.fileError = $('[data-file-error]');
  els.summaryTitle = $('[data-summary-title]');
  els.summaryMeta = $('[data-summary-meta]');
  els.addMore = $('[data-add-more]');
  els.clearAll = $('[data-clear-all]');
  els.format = $('[data-format]');
  els.formatNote = $('[data-format-note]');
  els.quality = $('[data-quality]');
  els.qualityField = $('[data-quality-field]');
  els.bitrate = $('[data-bitrate]');
  els.bitrateField = $('[data-bitrate-field]');
  els.rate = $('[data-rate]');
  els.rateNote = $('[data-rate-note]');
  els.channels = $('[data-channels]');
  els.exportSummary = $('[data-export-summary]');
  els.convert = $('[data-convert]');
  els.cancel = $('[data-cancel]');
  els.progress = $('[data-progress]');
  els.progressTrack = $('[data-progress-track]');
  els.progressBar = $('[data-progress-bar]');
  els.progressLabel = $('[data-progress-label]');
  els.results = $('[data-results]');
  els.resultsTitle = $('[data-results-title]');
  els.resultsSummary = $('[data-results-summary]');
  els.downloadZip = $('[data-download-zip]');
  els.clearResults = $('[data-clear-results]');
  els.player = $('[data-player]');
}

function wire() {
  els.browse.addEventListener('click', () => els.fileInput.click());
  els.addMore.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    const files = Array.from(els.fileInput.files || []);
    els.fileInput.value = '';
    await addFiles(files);
  });

  els.clearAll.addEventListener('click', clearAll);
  els.clearResults.addEventListener('click', () => {
    clearResults();
    setStatus('Results cleared. The source files are still in the list.');
  });
  els.convert.addEventListener('click', startConversion);
  els.cancel.addEventListener('click', cancelConversion);
  els.downloadZip.addEventListener('click', downloadZip);

  els.format.addEventListener('change', () => {
    updateFormatUi();
    renderAll();
  });
  els.quality.addEventListener('change', () => {
    if (els.quality.value !== 'custom') els.bitrate.value = els.quality.value;
    updateSummary();
  });
  els.bitrate.addEventListener('change', () => {
    els.quality.value = 'custom';
    updateSummary();
  });
  els.rate.addEventListener('change', updateSummary);
  els.channels.addEventListener('change', updateSummary);

  els.player.addEventListener('timeupdate', () => {
    const entry = state.playing;
    if (!entry) return;
    const duration = els.player.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    setRowPlayback(entry, els.player.currentTime / duration);
  });
  els.player.addEventListener('ended', stopPlayback);
  els.player.addEventListener('error', () => {
    if (state.playing) {
      setStatus('This file cannot be previewed in the browser, but it can still be converted.');
      stopPlayback();
    }
  });

  const panel = els.app;
  const setDrag = (active) => {
    panel.classList.toggle('is-dragover', active);
    els.dropzone.classList.toggle('is-dragover', active);
  };
  panel.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDrag(true);
  });
  panel.addEventListener('dragenter', (event) => {
    event.preventDefault();
    setDrag(true);
  });
  panel.addEventListener('dragleave', (event) => {
    if (event.target === panel || !panel.contains(event.relatedTarget)) setDrag(false);
  });
  panel.addEventListener('drop', async (event) => {
    event.preventDefault();
    setDrag(false);
    if (state.converting) {
      setStatus('Wait for the current conversion to finish before dropping new files.');
      return;
    }
    const files = event.dataTransfer ? event.dataTransfer.files : null;
    if (files && files.length) await addFiles(files);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.converting) cancelConversion();
  });

  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) cleanupPage();
  });
}

/* ------------------------------------------------------------------ */
/* Capabilities, debug hook and boot                                  */
/* ------------------------------------------------------------------ */

function checkCapabilities() {
  const hasAudio = typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined';
  const hasOffline = typeof window.OfflineAudioContext !== 'undefined';
  if (hasAudio && hasOffline) {
    els.support.hidden = true;
    return true;
  }
  els.support.hidden = false;
  els.supportText.textContent =
    'This browser does not provide the Web Audio API and OfflineAudioContext, so it cannot decode, resample or convert audio locally. Use a current version of Chrome, Edge, Firefox or Safari.';
  els.browse.disabled = true;
  els.fileInput.disabled = true;
  els.dropzone.classList.add('is-disabled');
  return false;
}

async function probeMp3() {
  try {
    const worker = getWorker();
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 15000);
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.type !== 'probe') return;
        clearTimeout(timer);
        state.capabilities.mp3Probed = true;
        state.capabilities.mp3 = Boolean(data.ok);
        resolve();
      };
      worker.onerror = () => {
        clearTimeout(timer);
        state.capabilities.mp3Probed = true;
        state.capabilities.mp3 = false;
        resolve();
      };
      worker.postMessage({ type: 'probe' });
    });
  } catch (error) {
    state.capabilities.mp3Probed = true;
    state.capabilities.mp3 = false;
  }
  updateFormatAvailability();
}

async function probeWebCodecs() {
  state.capabilities.webcodecsProbed = true;
  if (typeof AudioEncoder === 'undefined') {
    state.capabilities.aac = false;
    state.capabilities.opus = false;
    updateFormatAvailability();
    return;
  }
  try {
    const [aac, opus] = await Promise.all([
      AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 192000 }),
      AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })
    ]);
    state.capabilities.aac = Boolean(aac && aac.supported);
    state.capabilities.opus = Boolean(opus && opus.supported);
  } catch (error) {
    state.capabilities.aac = false;
    state.capabilities.opus = false;
  }
  updateFormatAvailability();
}

function exposeDebug() {
  window.__AC__ = {
    state: () => (state.files.length ? 'ready' : 'empty'),
    debug: () => ({
      fileCount: state.files.length,
      files: state.files.map((entry) => ({
        id: entry.id,
        name: entry.name,
        size: entry.size,
        format: entry.format.id,
        formatLabel: entry.format.label,
        status: entry.status,
        blocked: entry.blocked,
        error: entry.error,
        duration: entry.duration,
        sourceRate: entry.sourceRate,
        channels: entry.channels,
        progress: entry.progress,
        objectUrl: Boolean(entry.objectUrl),
        sourceUrl: entry.objectUrl,
        result: entry.result
          ? {
              name: entry.result.name,
              size: entry.result.size,
              mime: entry.result.mime,
              extension: entry.result.extension,
              formatLabel: entry.result.formatLabel,
              duration: entry.result.duration,
              sampleRate: entry.result.sampleRate,
              channels: entry.result.channels,
              url: entry.result.url
            }
          : null
      })),
      format: els.format.value,
      bitrate: Number(els.bitrate.value),
      quality: els.quality.value,
      rate: els.rate.value,
      channels: els.channels.value,
      converting: state.converting,
      cancelled: state.cancelled,
      progress: state.progress,
      capabilities: { ...state.capabilities },
      disabledFormats: [...els.format.options].filter((option) => option.disabled).map((option) => option.value),
      convertDisabled: els.convert.disabled,
      convertLabel: els.convert.textContent,
      resultsVisible: !els.results.hidden,
      zipVisible: !els.downloadZip.hidden,
      workerActive: Boolean(state.worker),
      audioContextState: previewContext ? previewContext.state : 'none',
      status: state.statusMessage
    })
  };
}

function boot() {
  cacheElements();
  exposeDebug();
  wire();
  const supported = checkCapabilities();
  updateFormatUi();
  renderAll();
  setStatus('');
  if (supported) {
    probeMp3();
    probeWebCodecs();
  } else {
    setStatus('This browser cannot run the local audio converter. Use a current Chrome, Edge, Firefox or Safari.');
  }
}

boot();


