/* LetitEdit Audio Trimmer — local waveform trimming and WAV/MP3 export.
 *
 * The file is decoded with the browser's own audio decoder, the waveform is
 * computed from the decoded samples, playback uses the Web Audio API, and the
 * selected range is written by a local worker as WAV (16-bit PCM) or MP3
 * (LAME). Nothing is uploaded and no account is required.
 */

const els = {
  page: document.querySelector('.atr-page'),
  app: document.querySelector('[data-app]'),
  dropzone: document.querySelector('[data-dropzone]'),
  fileInput: document.querySelector('[data-file-input]'),
  browse: document.querySelector('[data-browse]'),
  support: document.querySelector('[data-support]'),
  supportText: document.querySelector('[data-support-text]'),
  error: document.querySelector('[data-global-error]'),
  loading: document.querySelector('[data-loading]'),
  loadingText: document.querySelector('[data-loading-text]'),
  editor: document.querySelector('[data-editor]'),
  fileName: document.querySelector('[data-file-name]'),
  fileMeta: document.querySelector('[data-file-meta]'),
  change: document.querySelector('[data-change]'),
  remove: document.querySelector('[data-remove]'),

  waveScroll: document.querySelector('[data-wave-scroll]'),
  waveInner: document.querySelector('[data-wave-inner]'),
  canvas: document.querySelector('[data-waveform]'),
  shadeStart: document.querySelector('[data-shade-start]'),
  shadeEnd: document.querySelector('[data-shade-end]'),
  selection: document.querySelector('[data-selection]'),
  handleStart: document.querySelector('[data-handle-start]'),
  handleEnd: document.querySelector('[data-handle-end]'),
  playhead: document.querySelector('[data-playhead]'),
  zoomOut: document.querySelector('[data-zoom-out]'),
  zoomIn: document.querySelector('[data-zoom-in]'),
  zoomFit: document.querySelector('[data-zoom-fit]'),
  zoomLabel: document.querySelector('[data-zoom-label]'),
  ticks: document.querySelector('[data-ticks]'),

  play: document.querySelector('[data-play]'),
  current: document.querySelector('[data-current]'),
  total: document.querySelector('[data-total]'),
  seek: document.querySelector('[data-seek]'),
  volume: document.querySelector('[data-volume]'),
  playStatus: document.querySelector('[data-play-status]'),

  startInput: document.querySelector('[data-start-input]'),
  endInput: document.querySelector('[data-end-input]'),
  selectedDuration: document.querySelector('[data-selected-duration]'),
  selectedSeconds: document.querySelector('[data-selected-seconds]'),
  setStart: document.querySelector('[data-set-start]'),
  setEnd: document.querySelector('[data-set-end]'),
  preview: document.querySelector('[data-preview]'),
  loop: document.querySelector('[data-loop]'),
  resetSelection: document.querySelector('[data-reset-selection]'),
  validation: document.querySelector('[data-validation]'),

  format: document.querySelector('[data-format]'),
  formatNote: document.querySelector('[data-format-note]'),
  bitrateField: document.querySelector('[data-bitrate-field]'),
  bitrate: document.querySelector('[data-bitrate]'),
  exportSummary: document.querySelector('[data-export-summary]'),
  exportButton: document.querySelector('[data-export]'),
  cancelExport: document.querySelector('[data-cancel-export]'),
  progress: document.querySelector('[data-progress]'),
  progressTrack: document.querySelector('[data-progress-track]'),
  progressBar: document.querySelector('[data-progress-bar]'),
  progressLabel: document.querySelector('[data-progress-label]'),

  result: document.querySelector('[data-result]'),
  resultAudio: document.querySelector('[data-result-audio]'),
  resultName: document.querySelector('[data-result-name]'),
  resultFormat: document.querySelector('[data-result-format]'),
  resultDuration: document.querySelector('[data-result-duration]'),
  resultSize: document.querySelector('[data-result-size]'),
  resultRate: document.querySelector('[data-result-rate]'),
  resultChannels: document.querySelector('[data-result-channels]'),
  resultNote: document.querySelector('[data-result-note]'),
  download: document.querySelector('[data-download]'),
  trimAnother: document.querySelector('[data-trim-another]'),
  uploadAnother: document.querySelector('[data-upload-another]')
};

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MIN_SELECTION = 0.01;
const PEAK_BUCKETS = 24000;
const TRACK_PAD = 14;
const ZOOM_LEVELS = [1, 2, 4, 8, 16];
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/></svg>';
const KNOWN_AUDIO = /\.(mp3|wav|wave|m4a|m4b|mp4|aac|ogg|oga|opus|flac|webm|aif|aiff)$/i;

const AudioCtor = window.AudioContext || window.webkitAudioContext;
const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const caps = {
  audio: Boolean(AudioCtor && AudioCtor.prototype.decodeAudioData),
  offline: Boolean(OfflineCtor),
  worker: typeof Worker === 'function'
};

const state = {
  phase: 'empty',
  page: document.body,
  file: null,
  buffer: null,
  peaks: null,
  duration: 0,
  sampleRate: 0,
  sourceRate: null,
  ratePreserved: true,
  channels: 0,
  metadataChannels: null,
  selection: { start: 0, end: 0 },
  selectionValid: false,
  manualInvalid: false,
  playhead: 0,
  playing: false,
  previewing: false,
  playIconState: null,
  loop: false,
  zoom: 1,
  waveformWidth: 0,
  waveformDrawn: false,
  ctx: null,
  gain: null,
  source: null,
  startedAt: 0,
  startOffset: 0,
  loopSpan: 0,
  raf: 0,
  volume: 0.9,
  seeking: false,
  loading: false,
  loadToken: 0,
  exporting: false,
  exportToken: 0,
  progress: 0,
  worker: null,
  mp3Available: false,
  mp3Probed: false,
  mp3Reason: '',
  result: null,
  resultUrl: ''
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const tenths = Math.floor(seconds * 10) % 10;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${tenths}`
    : `${pad(minutes)}:${pad(secs)}.${tenths}`;
}

function formatPrecise(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3600000);
  const minutes = Math.floor((millis % 3600000) / 60000);
  const secs = Math.floor((millis % 60000) / 1000);
  const ms = millis % 1000;
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`
    : `${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`;
}

function formatSampleRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return 'Unknown';
  const khz = Number((rate / 1000).toFixed(3));
  return `${khz} kHz`;
}

function channelLabel(count) {
  if (count === 1) return 'Mono';
  if (count === 2) return 'Stereo';
  return `${count} channels`;
}

function parseTime(text) {
  const raw = String(text || '').trim().replace(',', '.');
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length > 3) return null;
  let seconds = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].trim();
    if (!part || !/^\d+(\.\d+)?$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return null;
    seconds = seconds * 60 + value;
  }
  return Number.isFinite(seconds) ? seconds : null;
}

function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let mediabunnyPromise = null;

function loadMediabunny() {
  if (!mediabunnyPromise) {
    mediabunnyPromise = import('../vendor/mediabunny/mediabunny.min.mjs').catch((error) => {
      mediabunnyPromise = null;
      throw error;
    });
  }
  return mediabunnyPromise;
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/* Read the source sample rate, channel count and duration without decoding.
 * Mediabunny reads the container metadata only; the actual decode still uses
 * the browser's own audio decoder. */
async function probeMetadata(file) {
  let input = null;
  try {
    const MB = await loadMediabunny();
    input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    let sampleRate = null;
    let channels = null;
    let duration = null;
    try { sampleRate = await track.getSampleRate(); } catch (error) { /* optional */ }
    try { channels = await track.getNumberOfChannels(); } catch (error) { /* optional */ }
    try { duration = await input.computeDuration(); } catch (error) { /* optional */ }
    return {
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : null,
      channels: Number.isFinite(channels) ? channels : null,
      duration: Number.isFinite(duration) ? duration : null
    };
  } catch (error) {
    return null;
  } finally {
    if (input) {
      try { input.dispose(); } catch (error) { /* already released */ }
    }
  }
}

/* decodeAudioData resamples to the context's sample rate. Decode in a short
 * lived OfflineAudioContext at the source rate so WAV export can keep it. */
async function decodeBuffer(data, preferredRate) {
  let context = null;
  if (preferredRate && caps.offline) {
    try {
      context = new OfflineCtor(1, 1, preferredRate);
    } catch (error) {
      context = null;
    }
  }
  if (!context) {
    if (!caps.audio) throw new Error('the Web Audio API is not available');
    context = new AudioCtor();
  }
  try {
    return await context.decodeAudioData(data);
  } finally {
    if (context && typeof context.close === 'function') {
      try { await context.close(); } catch (error) { /* already closed */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Messages and loading                                               */
/* ------------------------------------------------------------------ */

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = '';
}

function setLoading(visible, text) {
  state.loading = visible;
  els.loading.hidden = !visible;
  if (text) els.loadingText.textContent = text;
  if (visible) els.dropzone.hidden = true;
  refreshExportState();
}

function setLoadingText(text) {
  els.loadingText.textContent = text;
}

function showValidation(message) {
  els.validation.textContent = message;
  els.validation.hidden = false;
  refreshExportState();
}

function clearValidation() {
  els.validation.hidden = true;
  els.validation.textContent = '';
  els.startInput.removeAttribute('aria-invalid');
  els.endInput.removeAttribute('aria-invalid');
}

/* ------------------------------------------------------------------ */
/* Audio context and playback                                         */
/* ------------------------------------------------------------------ */

function getContext() {
  if (!caps.audio) throw new Error('The Web Audio API is not available in this browser.');
  if (!state.ctx) {
    try {
      state.ctx = new AudioCtor();
    } catch (error) {
      throw new Error('Audio playback is not available in this browser.');
    }
    state.gain = state.ctx.createGain();
    state.gain.gain.value = state.volume;
    state.gain.connect(state.ctx.destination);
  }
  if (state.ctx.state === 'suspended') {
    state.ctx.resume().catch(() => {});
  }
  return state.ctx;
}

function stopSource() {
  const source = state.source;
  state.source = null;
  if (!source) return;
  source.onended = null;
  try {
    source.stop();
  } catch (error) {
    /* already stopped */
  }
  try {
    source.disconnect();
  } catch (error) {
    /* already disconnected */
  }
}

function stopTicker() {
  if (state.raf) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
}

function currentPosition() {
  if (!state.playing || !state.ctx) return state.playhead;
  const elapsed = Math.max(0, state.ctx.currentTime - state.startedAt);
  if (state.previewing && state.loop && state.loopSpan > 0) {
    return state.startOffset + (elapsed % state.loopSpan);
  }
  return Math.min(state.duration, state.startOffset + elapsed);
}

function startTicker() {
  stopTicker();
  const tick = () => {
    if (!state.playing) return;
    state.playhead = currentPosition();
    updatePlaybackUi();
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function updatePlaybackUi() {
  const position = clamp(state.playhead, 0, state.duration || 0);
  els.current.textContent = formatClock(position);
  if (state.duration > 0) {
    const ratio = clamp(position / state.duration, 0, 1);
    els.seek.style.setProperty('--atr-progress', `${(ratio * 100).toFixed(2)}%`);
    if (!state.seeking) {
      els.seek.value = String(Math.round(ratio * 1000));
    }
  }
  updatePlayhead();
  updatePlayButton();
}

function updateVolumeUi() {
  els.volume.value = String(state.volume);
  els.volume.style.setProperty('--atr-progress', `${Math.round(state.volume * 100)}%`);
}

function updatePlayButton() {
  if (state.playIconState === state.playing) return;
  state.playIconState = state.playing;
  els.play.innerHTML = state.playing ? PAUSE_ICON : PLAY_ICON;
  els.play.setAttribute('aria-label', state.playing ? 'Pause audio' : 'Play audio');
  els.play.setAttribute('title', state.playing ? 'Pause' : 'Play');
}

function setPlayStatus(message) {
  els.playStatus.textContent = message;
}

function ensureContextForPlayback() {
  const context = getContext();
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  return context;
}

function startSourceAt(offset, options = {}) {
  if (!state.buffer) return;
  let context;
  try {
    context = ensureContextForPlayback();
  } catch (error) {
    setPlayStatus('Playback is not available in this browser. You can still trim and export the file.');
    return;
  }
  stopSource();
  const preview = Boolean(options.preview);
  const loop = preview && Boolean(options.loop);
  const selectionStart = state.selection.start;
  const selectionEnd = state.selection.end;
  const startAt = clamp(offset, 0, state.duration);
  if (!preview && startAt >= state.duration - 0.001) {
    state.playhead = 0;
    return startSourceAt(0, options);
  }

  const source = context.createBufferSource();
  source.buffer = state.buffer;
  source.connect(state.gain);
  state.source = source;
  state.playing = true;
  state.previewing = preview;
  state.startedAt = context.currentTime;
  state.startOffset = startAt;
  state.loopSpan = loop ? Math.max(0.001, selectionEnd - selectionStart) : 0;
  state.playhead = startAt;

  if (loop) {
    source.loop = true;
    source.loopStart = selectionStart;
    source.loopEnd = selectionEnd;
  }

  source.onended = () => {
    if (state.source !== source) return;
    state.source = null;
    state.playing = false;
    state.previewing = false;
    stopTicker();
    if (preview && !loop) {
      state.playhead = selectionEnd;
      setPlayStatus('Preview finished. The selection ends at ' + formatPrecise(selectionEnd) + '.');
    } else {
      state.playhead = state.duration;
      setPlayStatus('Reached the end of the audio.');
    }
    updatePlaybackUi();
    updateOverlay();
  };

  try {
    if (preview && !loop) {
      const span = Math.max(0, selectionEnd - startAt);
      if (span <= 0.0005) {
        source.start(0, startAt);
        source.stop(context.currentTime + 0.001);
      } else {
        source.start(0, startAt, span);
      }
    } else {
      source.start(0, startAt);
    }
  } catch (error) {
    state.source = null;
    state.playing = false;
    state.previewing = false;
    setPlayStatus('Playback could not start in this browser.');
    updatePlayButton();
    return;
  }

  startTicker();
  updatePlaybackUi();
  setPlayStatus(
    preview
      ? loop
        ? 'Looping the selected section.'
        : 'Previewing the selected section.'
      : 'Playing from ' + formatPrecise(startAt) + '.'
  );
}

function pausePlayback() {
  if (!state.playing) return;
  const position = currentPosition();
  stopSource();
  state.playing = false;
  state.previewing = false;
  state.playhead = clamp(position, 0, state.duration);
  stopTicker();
  updatePlaybackUi();
  updateOverlay();
  setPlayStatus('Paused at ' + formatPrecise(state.playhead) + '.');
}

function togglePlayback() {
  if (!state.buffer) return;
  if (state.playing) {
    pausePlayback();
  } else {
    startSourceAt(state.playhead, { preview: false });
  }
}

function previewSelection() {
  if (!state.buffer || !canUseSelection()) return;
  if (state.playing && state.previewing) {
    pausePlayback();
    return;
  }
  if (state.selection.end - state.selection.start < 0.005) {
    showValidation('Select at least a few milliseconds of audio to preview.');
    return;
  }
  startSourceAt(state.selection.start, { preview: true, loop: state.loop });
}

function seekTo(seconds) {
  if (!state.buffer) return;
  const position = clamp(Number(seconds) || 0, 0, state.duration);
  const wasPlaying = state.playing;
  stopSource();
  state.playing = false;
  state.previewing = false;
  state.playhead = position;
  stopTicker();
  updatePlaybackUi();
  updateOverlay();
  setPlayStatus('Positioned at ' + formatPrecise(position) + '.');
  if (wasPlaying) {
    startSourceAt(position, { preview: false });
  }
}

function updatePlayhead() {
  if (!state.waveformWidth || !state.duration) {
    els.playhead.style.left = `${TRACK_PAD}px`;
    return;
  }
  const x = timeToX(state.playhead);
  els.playhead.style.left = `${x}px`;
  if (state.playing && state.zoom > 1) {
    const scroll = els.waveScroll;
    const margin = 36;
    if (x < scroll.scrollLeft + margin) {
      scroll.scrollLeft = Math.max(0, x - margin);
    } else if (x > scroll.scrollLeft + scroll.clientWidth - margin) {
      scroll.scrollLeft = Math.min(
        Math.max(0, scroll.scrollWidth - scroll.clientWidth),
        x - scroll.clientWidth + margin
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Waveform                                                           */
/* ------------------------------------------------------------------ */

async function computePeaks(buffer, token, onProgress) {
  const buckets = Math.max(1, Math.min(PEAK_BUCKETS, buffer.length));
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  const channels = [];
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index));
  }
  const samplesPerBucket = buffer.length / buckets;
  const step = Math.max(1, Math.floor(samplesPerBucket / 600));

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    if (token !== state.loadToken) return null;
    const start = Math.floor(bucket * samplesPerBucket);
    const end = Math.min(
      buffer.length,
      Math.max(start + 1, Math.floor((bucket + 1) * samplesPerBucket))
    );
    let min = 0;
    let max = 0;
    for (const data of channels) {
      for (let sample = start; sample < end; sample += step) {
        const value = data[sample];
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    mins[bucket] = min;
    maxs[bucket] = max;
    if (onProgress && (bucket & 1023) === 0) {
      onProgress(bucket / buckets);
      if ((bucket & 4095) === 0) await yieldToLoop();
    }
  }
  return { mins, maxs, buckets };
}

function updateWaveformSize() {
  const base = Math.max(1, els.waveScroll.clientWidth);
  const width = Math.max(1, Math.round(base * state.zoom));
  state.waveformWidth = width;
  els.waveInner.style.width = `${width}px`;
}

function drawWaveform() {
  if (!state.peaks || !state.waveformWidth) return;
  const canvas = els.canvas;
  const cssWidth = state.waveformWidth;
  const cssHeight = Math.max(80, els.waveInner.clientHeight || 180);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cssWidth, cssHeight);

  const trackWidth = Math.max(1, cssWidth - TRACK_PAD * 2);
  const center = cssHeight / 2;
  const amplitude = cssHeight * 0.44;

  context.strokeStyle = '#dbeafe';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(TRACK_PAD, center + 0.5);
  context.lineTo(TRACK_PAD + trackWidth, center + 0.5);
  context.stroke();

  context.fillStyle = '#2563eb';
  const peaks = state.peaks;
  for (let x = 0; x < trackWidth; x += 1) {
    const first = Math.floor((x / trackWidth) * peaks.buckets);
    const last = Math.max(first + 1, Math.ceil(((x + 1) / trackWidth) * peaks.buckets));
    let min = 0;
    let max = 0;
    for (let bucket = first; bucket < last && bucket < peaks.buckets; bucket += 1) {
      if (peaks.mins[bucket] < min) min = peaks.mins[bucket];
      if (peaks.maxs[bucket] > max) max = peaks.maxs[bucket];
    }
    const peak = Math.max(Math.abs(min), Math.abs(max));
    const height = Math.max(1, peak * amplitude * 2);
    context.fillRect(TRACK_PAD + x, center - height / 2, 1, height);
  }

  state.waveformDrawn = true;
  renderTicks();
  updateOverlay();
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

function renderTicks() {
  const ticks = els.ticks;
  if (!ticks) return;
  ticks.textContent = '';
  if (!state.duration || !state.waveformWidth) return;
  const trackWidth = Math.max(1, state.waveformWidth - TRACK_PAD * 2);
  const step = TICK_STEPS.find((candidate) => (candidate / state.duration) * trackWidth >= 74) ||
    Math.max(1, Math.ceil(state.duration / 8));
  const count = Math.floor(state.duration / step);
  if (count > 80) return;
  for (let index = 0; index <= count; index += 1) {
    const time = index * step;
    if (time > state.duration + 1e-6) break;
    const label = document.createElement('span');
    label.className = 'atr-tick';
    label.style.left = `${clamp(timeToX(time), 18, state.waveformWidth - 18)}px`;
    label.textContent = step < 1
      ? `${time.toFixed(1)}s`
      : formatClock(time).replace(/\.\d$/, '');
    ticks.appendChild(label);
  }
}

function scheduleWaveformRedraw() {
  requestAnimationFrame(() => {
    if (!state.buffer) return;
    updateWaveformSize();
    drawWaveform();
    updateOverlay();
  });
}

function timeToX(time) {
  const trackWidth = Math.max(1, state.waveformWidth - TRACK_PAD * 2);
  const ratio = state.duration > 0 ? clamp(time / state.duration, 0, 1) : 0;
  return TRACK_PAD + ratio * trackWidth;
}

function xToTime(clientX) {
  const rect = els.canvas.getBoundingClientRect();
  const trackWidth = Math.max(1, state.waveformWidth - TRACK_PAD * 2);
  const x = clientX - rect.left - TRACK_PAD;
  return clamp(x / trackWidth, 0, 1) * state.duration;
}

function updateOverlay() {
  if (!state.waveformWidth) return;
  const startX = timeToX(state.selection.start);
  const endX = timeToX(state.selection.end);
  const width = state.waveformWidth;
  els.shadeStart.style.width = `${Math.max(0, startX)}px`;
  els.shadeEnd.style.left = `${endX}px`;
  els.shadeEnd.style.width = `${Math.max(0, width - endX)}px`;
  els.selection.style.left = `${startX}px`;
  els.selection.style.width = `${Math.max(1, endX - startX)}px`;
  els.handleStart.style.left = `${startX}px`;
  els.handleEnd.style.left = `${endX}px`;
  els.handleStart.setAttribute('aria-valuemax', String(state.duration));
  els.handleEnd.setAttribute('aria-valuemax', String(state.duration));
  els.handleStart.setAttribute('aria-valuenow', String(state.selection.start));
  els.handleEnd.setAttribute('aria-valuenow', String(state.selection.end));
  els.handleStart.setAttribute('aria-valuetext', formatPrecise(state.selection.start));
  els.handleEnd.setAttribute('aria-valuetext', formatPrecise(state.selection.end));
  updatePlayhead();
}

function updateZoomUi() {
  els.zoomLabel.textContent = `${state.zoom}×`;
  const index = ZOOM_LEVELS.indexOf(state.zoom);
  els.zoomOut.disabled = index <= 0;
  els.zoomIn.disabled = index >= ZOOM_LEVELS.length - 1;
}

function setZoom(next) {
  if (!state.buffer) return;
  const center = state.playhead > 0 && state.playhead < state.duration
    ? state.playhead
    : (state.selection.start + state.selection.end) / 2;
  state.zoom = clamp(Number(next) || 1, 1, 16);
  updateWaveformSize();
  drawWaveform();
  updateOverlay();
  updateZoomUi();
  const x = timeToX(center);
  const maxScroll = Math.max(0, state.waveformWidth - els.waveScroll.clientWidth);
  els.waveScroll.scrollLeft = clamp(x - els.waveScroll.clientWidth / 2, 0, maxScroll);
}

function zoomStep(direction) {
  const index = ZOOM_LEVELS.indexOf(state.zoom);
  const next = ZOOM_LEVELS[clamp(index + direction, 0, ZOOM_LEVELS.length - 1)];
  if (next !== state.zoom) setZoom(next);
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */

function minGap() {
  return Math.min(MIN_SELECTION, state.duration || MIN_SELECTION);
}

function setSelection(start, end, options = {}) {
  if (!state.buffer) return;
  const gap = minGap();
  let nextStart = clamp(Number(start) || 0, 0, Math.max(0, state.duration - gap));
  let nextEnd = clamp(Number(end) || 0, nextStart + gap, state.duration);
  if (state.duration <= gap) {
    nextStart = 0;
    nextEnd = state.duration;
  }
  state.selection = { start: nextStart, end: nextEnd };
  state.selectionValid = nextEnd - nextStart >= gap - 1e-9;
  if (options.updateInputs !== false) {
    els.startInput.value = formatPrecise(nextStart);
    els.endInput.value = formatPrecise(nextEnd);
  }
  if (state.previewing) {
    pausePlayback();
  }
  updateSelectionUi({ inputs: options.updateInputs !== false });
  clearValidation();
  state.manualInvalid = false;
  refreshExportState();
}

function updateSelectionUi(options = {}) {
  const start = state.selection.start;
  const end = state.selection.end;
  const span = Math.max(0, end - start);
  els.selectedDuration.textContent = formatPrecise(span);
  els.selectedSeconds.textContent = `${span.toFixed(3)} seconds`;
  if (options.inputs !== false) {
    els.startInput.value = formatPrecise(start);
    els.endInput.value = formatPrecise(end);
  }
  updateOverlay();
  updateExportSummary();
}

function rateSummary() {
  if (state.ratePreserved) return formatSampleRate(state.sampleRate);
  return `${formatSampleRate(state.sampleRate)} decoded`;
}

function updateExportSummary() {
  const span = Math.max(0, state.selection.end - state.selection.start);
  const formatLabel = els.format.value === 'mp3'
    ? `MP3 · ${els.bitrate.value} kbps`
    : 'WAV · 16-bit PCM';
  els.exportSummary.textContent =
    `${formatLabel} · ${rateSummary()} · ${channelLabel(state.channels)} · ${formatPrecise(span)} (${span.toFixed(3)} s)`;
}

function canUseSelection() {
  return Boolean(state.buffer) &&
    state.selectionValid &&
    !state.manualInvalid &&
    state.selection.end - state.selection.start >= Math.min(MIN_SELECTION, state.duration) - 1e-9;
}

function refreshExportState() {
  const usable = canUseSelection();
  const busy = state.exporting || state.loading;
  els.exportButton.disabled = !usable || busy || (els.format.value === 'mp3' && !state.mp3Available);
  els.preview.disabled = !usable || busy;
  els.setStart.disabled = !state.buffer || busy;
  els.setEnd.disabled = !state.buffer || busy;
  els.resetSelection.disabled = !state.buffer || busy;
  els.startInput.disabled = !state.buffer || busy;
  els.endInput.disabled = !state.buffer || busy;
  els.format.disabled = !state.buffer || busy;
  els.bitrate.disabled = !state.buffer || busy;
  els.handleStart.disabled = !state.buffer || busy;
  els.handleEnd.disabled = !state.buffer || busy;
}

function markManualInvalid(message, input) {
  state.manualInvalid = true;
  if (input) input.setAttribute('aria-invalid', 'true');
  showValidation(message);
  refreshExportState();
}

function commitTimeInput(which) {
  if (!state.buffer) return;
  const input = which === 'start' ? els.startInput : els.endInput;
  const parsed = parseTime(input.value);
  if (parsed === null) {
    markManualInvalid('Enter a time such as 0:12.500, 1:02.300 or 75.2.', input);
    return;
  }
  const gap = minGap();
  const start = which === 'start' ? parsed : state.selection.start;
  const end = which === 'end' ? parsed : state.selection.end;
  if (start < 0 || end > state.duration + 1e-6) {
    markManualInvalid(
      `Times must stay between 0:00.000 and ${formatPrecise(state.duration)}.`,
      input
    );
    return;
  }
  if (end - start < gap - 1e-9) {
    markManualInvalid('The end time must be later than the start time.', input);
    return;
  }
  input.removeAttribute('aria-invalid');
  state.manualInvalid = false;
  clearValidation();
  setSelection(start, end, { updateInputs: false });
  input.value = formatPrecise(which === 'start' ? start : end);
  refreshExportState();
}

function previewTimeInput(which) {
  if (!state.buffer) return;
  const input = which === 'start' ? els.startInput : els.endInput;
  const parsed = parseTime(input.value);
  if (parsed === null) return;
  const gap = minGap();
  const start = which === 'start' ? parsed : state.selection.start;
  const end = which === 'end' ? parsed : state.selection.end;
  if (start < 0 || end > state.duration + 1e-6 || end - start < gap - 1e-9) return;
  state.manualInvalid = false;
  clearValidation();
  input.removeAttribute('aria-invalid');
  setSelection(start, end, { updateInputs: false });
  refreshExportState();
}

function resetSelection() {
  if (!state.buffer) return;
  state.loop = false;
  els.loop.checked = false;
  setSelection(0, state.duration);
  state.playhead = 0;
  state.zoom = 1;
  updateWaveformSize();
  drawWaveform();
  updateOverlay();
  updateZoomUi();
  els.waveScroll.scrollLeft = 0;
  updatePlaybackUi();
  setPlayStatus('Selection reset to the full file. Set new start and end points.');
  clearError();
}

/* ------------------------------------------------------------------ */
/* File loading                                                       */
/* ------------------------------------------------------------------ */

function isProbablyAudio(file) {
  if (!file) return false;
  const type = String(file.type || '');
  return type.startsWith('audio/') || KNOWN_AUDIO.test(file.name || '');
}

function decodeErrorMessage(file, error) {
  const detail = error && error.message ? ` (${error.message})` : '';
  return `This browser could not decode “${file.name}”${detail}. The file may be corrupted, use a codec this browser does not support, or be too large for the device. Try a WAV, MP3, M4A, AAC, OGG, FLAC or WebM file that plays in this browser.`;
}

async function loadFile(file) {
  if (!file) return;
  clearError();
  if (!isProbablyAudio(file)) {
    showError('Choose an audio file such as MP3, WAV, M4A, AAC, OGG, FLAC or WebM.');
    if (!state.buffer) els.dropzone.hidden = false;
    return;
  }
  if (file.size === 0) {
    showError('That file is empty. Choose an audio file with actual sound in it.');
    if (!state.buffer) els.dropzone.hidden = false;
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError(`That file is ${formatBytes(file.size)}, which is larger than the 500 MB limit. Very large files can also exceed device memory. Try a shorter clip or a lower-bitrate copy.`);
    if (!state.buffer) els.dropzone.hidden = false;
    return;
  }

  const token = ++state.loadToken;
  if (state.playing) pausePlayback();
  setLoading(true, `Reading ${file.name}…`);
  try {
    const metadata = await withTimeout(probeMetadata(file), 6000, null);
    if (token !== state.loadToken) return;
    setLoadingText('Decoding the audio…');
    const data = await file.arrayBuffer();
    if (token !== state.loadToken) return;
    const buffer = await decodeBuffer(data, metadata && metadata.sampleRate);
    if (token !== state.loadToken) return;
    if (!buffer || !buffer.length) throw new Error('the decoded audio is empty');

    setLoadingText('Building the waveform…');
    const peaks = await computePeaks(buffer, token, (ratio) => {
      setLoadingText(`Building the waveform… ${Math.round(ratio * 100)}%`);
    });
    if (token !== state.loadToken) return;
    adoptBuffer(file, buffer, peaks, metadata);
  } catch (error) {
    if (token !== state.loadToken) return;
    showError(decodeErrorMessage(file, error));
    if (!state.buffer) {
      els.dropzone.hidden = false;
      els.editor.hidden = true;
    }
  } finally {
    if (token === state.loadToken) setLoading(false);
  }
}

function adoptBuffer(file, buffer, peaks, metadata) {
  releaseResult();
  stopSource();
  state.playing = false;
  state.previewing = false;
  state.playhead = 0;
  stopTicker();

  state.phase = 'ready';
  state.file = file;
  state.buffer = buffer;
  state.peaks = peaks;
  state.duration = buffer.duration;
  state.sampleRate = buffer.sampleRate;
  state.sourceRate = metadata && metadata.sampleRate ? metadata.sampleRate : null;
  state.ratePreserved = Boolean(state.sourceRate) && state.sourceRate === buffer.sampleRate;
  state.channels = buffer.numberOfChannels;
  state.metadataChannels = metadata && metadata.channels ? metadata.channels : null;
  state.selection = { start: 0, end: buffer.duration };
  state.selectionValid = true;
  state.manualInvalid = false;
  state.playhead = 0;
  state.zoom = 1;
  state.loop = false;
  state.waveformDrawn = false;
  state.mp3Available = false;
  state.mp3Probed = false;
  state.mp3Reason = '';
  state.result = null;

  els.loop.checked = false;
  els.fileName.textContent = file.name;
  const rateLabel = state.ratePreserved
    ? formatSampleRate(buffer.sampleRate)
    : `${formatSampleRate(buffer.sampleRate)} decoded`;
  els.fileMeta.textContent =
    `${formatBytes(file.size)} · ${formatClock(buffer.duration)} · ${rateLabel} · ${channelLabel(buffer.numberOfChannels)}`;
  els.total.textContent = formatClock(buffer.duration);
  els.current.textContent = '00:00.0';
  els.seek.value = '0';
  els.dropzone.hidden = true;
  els.editor.hidden = false;
  els.result.hidden = true;
  els.progress.hidden = true;
  els.cancelExport.hidden = true;
  els.exportButton.textContent = 'Trim and download';
  clearValidation();
  clearError();
  updateWaveformSize();
  updateSelectionUi();
  drawWaveform();
  updateOverlay();
  updatePlaybackUi();
  updateZoomUi();
  updatePlayButton();
  setPlayStatus('Ready to play. Drag the handles or type exact times to select a section.');
  refreshExportState();
  els.waveScroll.scrollLeft = 0;
  setMp3Pending();
  probeMp3();
}

/* ------------------------------------------------------------------ */
/* MP3 capability                                                     */
/* ------------------------------------------------------------------ */

function setMp3Pending() {
  state.mp3Probed = false;
  state.mp3Available = false;
  state.mp3Reason = '';
  const option = els.format.querySelector('option[value="mp3"]');
  if (option) {
    option.disabled = true;
    option.textContent = 'MP3 · checking…';
  }
  if (els.format.value === 'mp3') els.format.value = 'wav';
  updateFormatUi();
  refreshExportState();
}

function setMp3Availability(available, reason) {
  state.mp3Probed = true;
  state.mp3Available = available;
  state.mp3Reason = reason || '';
  const option = els.format.querySelector('option[value="mp3"]');
  if (!option) return;
  option.disabled = !available;
  option.textContent = available ? 'MP3 · compressed' : 'MP3 · not available';
  if (!available && els.format.value === 'mp3') {
    els.format.value = 'wav';
  }
  updateFormatUi();
  refreshExportState();
}

async function probeMp3() {
  const token = state.loadToken;
  const rateOk = [32000, 44100, 48000].includes(state.sampleRate);
  const channelsOk = state.channels >= 1 && state.channels <= 2;
  if (!caps.worker) {
    setMp3Availability(false, 'This browser cannot start the local MP3 encoder worker. WAV export is still available.');
    return;
  }
  if (!rateOk) {
    setMp3Availability(false, `MP3 encoding is not available at ${formatSampleRate(state.sampleRate)}. WAV keeps the ${state.ratePreserved ? 'source' : 'decoded'} sample rate.`);
    return;
  }
  if (!channelsOk) {
    setMp3Availability(false, `MP3 encoding supports mono or stereo audio, and this file has ${state.channels} channels. WAV keeps every channel.`);
    return;
  }

  let worker = null;
  try {
    worker = createWorker();
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      worker.onmessage = (event) => {
        if (event.data && event.data.type === 'probe') {
          clearTimeout(timer);
          resolve(Boolean(event.data.ok));
        }
      };
      worker.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      worker.postMessage({ type: 'probe' });
    });
    if (token !== state.loadToken) return;
    if (ok) {
      setMp3Availability(true, '');
    } else {
      setMp3Availability(false, 'The local MP3 encoder could not start in this browser. WAV export is still available.');
    }
  } catch (error) {
    if (token === state.loadToken) {
      setMp3Availability(false, 'The local MP3 encoder could not start in this browser. WAV export is still available.');
    }
  } finally {
    if (worker) worker.terminate();
  }
}

function updateFormatUi() {
  const mp3 = els.format.value === 'mp3';
  els.bitrateField.hidden = !mp3;
  if (!state.buffer) {
    els.formatNote.textContent =
      'WAV writes uncompressed 16-bit PCM. MP3 is smaller but lossy and appears only when the local encoder supports the file.';
    updateExportSummary();
    refreshExportState();
    return;
  }
  if (mp3) {
    els.formatNote.textContent = state.mp3Available
      ? 'MP3 re-encodes the selection at the chosen bitrate. It is smaller than WAV but lossy.'
      : state.mp3Reason || 'MP3 export is not available for this file. WAV is the reliable lossless option.';
  } else {
    const rateText = state.ratePreserved ? 'source sample rate' : 'decoded sample rate';
    els.formatNote.textContent = state.mp3Available
      ? `WAV writes uncompressed 16-bit PCM at the ${rateText} and channel layout. MP3 is smaller but lossy.`
      : `WAV writes uncompressed 16-bit PCM at the ${rateText} and channel layout. ${state.mp3Reason || 'MP3 export is not available in this browser.'}`;
  }
  updateExportSummary();
  refreshExportState();
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function createWorker() {
  return new Worker(new URL('./audio-trimmer-worker.js', import.meta.url), { type: 'module' });
}

function setExportingUi(exporting) {
  state.exporting = exporting;
  els.exportButton.hidden = exporting;
  els.cancelExport.hidden = !exporting;
  els.progress.hidden = !exporting;
  refreshExportState();
}

function updateProgress(value, label) {
  const percent = Math.round(clamp(value, 0, 1) * 100);
  state.progress = percent;
  els.progressBar.style.width = `${percent}%`;
  els.progressTrack.setAttribute('aria-valuenow', String(percent));
  els.progressLabel.textContent = label || `Encoding… ${percent}%`;
}

function selectionSamples() {
  const startSample = Math.max(0, Math.round(state.selection.start * state.sampleRate));
  const endSample = Math.min(state.buffer.length, Math.round(state.selection.end * state.sampleRate));
  return { startSample, endSample, frames: Math.max(0, endSample - startSample) };
}

function copySelectionChannels(startSample, endSample) {
  const channels = [];
  for (let index = 0; index < state.buffer.numberOfChannels; index += 1) {
    channels.push(state.buffer.getChannelData(index).slice(startSample, endSample));
  }
  return channels;
}

async function exportAudio() {
  if (!state.buffer || state.exporting || state.loading) return;
  if (!canUseSelection()) {
    showValidation('Choose a valid start and end time before exporting.');
    return;
  }
  const format = els.format.value === 'mp3' ? 'mp3' : 'wav';
  if (format === 'mp3' && !state.mp3Available) {
    showError(state.mp3Reason || 'MP3 export is not available in this browser. Choose WAV instead.');
    return;
  }

  const { startSample, endSample, frames } = selectionSamples();
  if (frames < 1) {
    showValidation('The selected range is empty. Move the handles or type a longer range.');
    return;
  }

  clearError();
  clearValidation();
  const token = ++state.exportToken;
  setExportingUi(true);
  updateProgress(0, format === 'mp3' ? 'Preparing the MP3 encoder…' : 'Preparing the WAV encoder…');

  let channels;
  try {
    channels = copySelectionChannels(startSample, endSample);
  } catch (error) {
    failExport(token, 'The selected audio could not be copied. Try a shorter range or reload the file.');
    return;
  }

  if (!caps.worker) {
    if (format === 'wav') {
      runWavFallback(channels, token);
    } else {
      failExport(token, 'MP3 export needs a browser with Web Workers. WAV export is available.');
    }
    return;
  }

  let worker;
  try {
    worker = createWorker();
  } catch (error) {
    if (format === 'wav') {
      runWavFallback(channels, token);
    } else {
      failExport(token, 'The MP3 encoder worker could not start. Choose WAV instead.');
    }
    return;
  }

  state.worker = worker;
  worker.onmessage = (event) => {
    if (token !== state.exportToken) return;
    const message = event.data || {};
    if (message.type === 'progress') {
      updateProgress(message.value, message.label);
    } else if (message.type === 'done') {
      finishExport(message, token);
    } else if (message.type === 'error') {
      failExport(token, message.message || 'The audio encoder failed.');
    }
  };
  worker.onerror = () => {
    if (token !== state.exportToken) return;
    failExport(token, 'The local audio encoder stopped unexpectedly. Try WAV or reload the page.');
  };

  try {
    worker.postMessage(
      {
        type: format,
        channels,
        sampleRate: state.sampleRate,
        bitrate: Number(els.bitrate.value) * 1000
      },
      channels.map((channel) => channel.buffer)
    );
  } catch (error) {
    failExport(token, 'The selected audio could not be sent to the encoder. Try a shorter range.');
  }
}

async function runWavFallback(channels, token) {
  try {
    const frames = channels[0].length;
    const channelCount = channels.length;
    const dataBytes = frames * channelCount * 2;
    if (dataBytes > 0xffffffff - 44) {
      throw new Error('The selected range is too long for a WAV file. Choose a shorter range.');
    }
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const write = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, state.sampleRate, true);
    view.setUint32(28, state.sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, dataBytes, true);

    const chunkFrames = 32768;
    for (let offset = 0; offset < frames; offset += chunkFrames) {
      if (token !== state.exportToken) return;
      const end = Math.min(frames, offset + chunkFrames);
      let byteOffset = 44 + offset * channelCount * 2;
      for (let frame = offset; frame < end; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const sample = clamp(channels[channel][frame], -1, 1);
          view.setInt16(byteOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          byteOffset += 2;
        }
      }
      updateProgress((end / frames) * 0.98, `Encoding WAV… ${Math.round((end / frames) * 100)}%`);
      await yieldToLoop();
    }
    updateProgress(1, 'Finalizing WAV…');
    finishExport(
      {
        buffer,
        mime: 'audio/wav',
        extension: 'wav',
        duration: frames / state.sampleRate,
        formatLabel: 'WAV · 16-bit PCM'
      },
      token
    );
  } catch (error) {
    failExport(token, 'The WAV encoder failed. Try a shorter selection or reload the page.');
  }
}

function finishExport(message, token) {
  if (token !== state.exportToken) return;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  try {
    const blob = new Blob([message.buffer], { type: message.mime });
    if (!blob.size) throw new Error('empty output');
    releaseResult();
    const url = URL.createObjectURL(blob);
    const name = `audio-trimmed.${message.extension}`;
    const result = {
      blob,
      url,
      name,
      mime: message.mime,
      extension: message.extension,
      duration: message.duration,
      formatLabel: message.formatLabel,
      sampleRate: state.sampleRate,
      channels: state.channels,
      start: state.selection.start,
      end: state.selection.end
    };
    state.result = result;
    state.resultUrl = url;
    state.exporting = false;
    state.progress = 100;
    setExportingUi(false);
    els.progress.hidden = true;
    showResult(result);
  } catch (error) {
    failExport(token, 'The encoded file could not be created. Try a shorter selection or a different format.');
  }
}

function failExport(token, message) {
  if (token !== state.exportToken) return;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  state.exporting = false;
  setExportingUi(false);
  els.progress.hidden = true;
  showError(message);
}

function cancelExport() {
  if (!state.exporting) return;
  state.exportToken += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  state.exporting = false;
  setExportingUi(false);
  els.progress.hidden = true;
  setPlayStatus('Export cancelled. The audio is still loaded and the selection is unchanged.');
}

function showResult(result) {
  els.result.hidden = false;
  els.resultName.textContent = result.name;
  els.resultFormat.textContent = result.formatLabel;
  els.resultDuration.textContent = formatPrecise(result.duration);
  els.resultSize.textContent = formatBytes(result.blob.size);
  els.resultRate.textContent = result.sampleRate === state.sourceRate || state.ratePreserved
    ? formatSampleRate(result.sampleRate)
    : `${formatSampleRate(result.sampleRate)} decoded`;
  els.resultChannels.textContent = channelLabel(result.channels);
  els.resultNote.textContent = result.extension === 'mp3'
    ? 'Created locally as a lossy MP3. MP3 adds a short amount of encoder padding, so its playing time can differ from the selected duration by a fraction of a second.'
    : state.ratePreserved
      ? 'Created locally as uncompressed 16-bit PCM at the source sample rate and channel layout.'
      : `Created locally as uncompressed 16-bit PCM at ${formatSampleRate(result.sampleRate)}. This browser decoded the source at that rate.`;
  els.resultAudio.src = result.url;
  els.resultAudio.load();
  els.download.href = result.url;
  els.download.download = result.name;
  els.download.setAttribute('aria-disabled', 'false');
  updateExportSummary();
  refreshExportState();
  els.result.scrollIntoView({ block: 'nearest' });
}

function releaseResult() {
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = '';
  }
  state.result = null;
  if (els.resultAudio) {
    els.resultAudio.pause();
    els.resultAudio.removeAttribute('src');
    els.resultAudio.load();
  }
  els.result.hidden = true;
  els.download.removeAttribute('href');
  els.download.removeAttribute('download');
  els.download.setAttribute('aria-disabled', 'true');
}

function trimAnotherSection() {
  releaseResult();
  resetSelection();
  els.editor.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------------ */
/* Reset and cleanup                                                  */
/* ------------------------------------------------------------------ */

function releaseAudio() {
  stopSource();
  stopTicker();
  state.playing = false;
  state.previewing = false;
  state.buffer = null;
  state.peaks = null;
  state.file = null;
  state.duration = 0;
  state.sampleRate = 0;
  state.sourceRate = null;
  state.ratePreserved = true;
  state.channels = 0;
  state.metadataChannels = null;
  state.selection = { start: 0, end: 0 };
  state.selectionValid = false;
  state.manualInvalid = false;
  state.playhead = 0;
  state.zoom = 1;
  state.waveformWidth = 0;
  state.waveformDrawn = false;
  state.playIconState = null;
  state.phase = 'empty';
  state.mp3Available = false;
  state.mp3Probed = false;
  state.mp3Reason = '';
  els.waveInner.style.width = '0px';
  if (els.ticks) els.ticks.textContent = '';
  els.current.textContent = '00:00.0';
  els.total.textContent = '00:00.0';
  els.seek.value = '0';
  els.seek.style.setProperty('--atr-progress', '0%');
  els.fileName.textContent = '';
  els.fileMeta.textContent = '';
  clearValidation();
  updatePlayButton();
}

function clearAll() {
  state.loadToken += 1;
  state.exportToken += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  releaseResult();
  releaseAudio();
  els.editor.hidden = true;
  els.dropzone.hidden = false;
  els.loading.hidden = true;
  els.progress.hidden = true;
  els.cancelExport.hidden = true;
  state.loading = false;
  state.exporting = false;
  els.format.value = 'wav';
  const option = els.format.querySelector('option[value="mp3"]');
  if (option) {
    option.disabled = true;
    option.textContent = 'MP3 · checking…';
  }
  updateFormatUi();
  setPlayStatus('Choose an audio file to begin.');
  refreshExportState();
  clearError();
  els.fileInput.value = '';
}

function cleanupPage() {
  state.loadToken += 1;
  state.exportToken += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  releaseResult();
  stopSource();
  stopTicker();
  if (state.ctx) {
    try {
      state.ctx.close();
    } catch (error) {
      /* already closed */
    }
  }
  state.ctx = null;
  state.gain = null;
}

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                */
/* ------------------------------------------------------------------ */

function beginHandleDrag(which, event) {
  if (!state.buffer || state.exporting || state.loading) return;
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const pointerId = event.pointerId;
  const handle = which === 'start' ? els.handleStart : els.handleEnd;
  state.page.classList.add('is-dragging');
  try {
    handle.setPointerCapture(pointerId);
  } catch (error) {
    /* Synthetic pointers and some browsers do not support capture here. */
  }

  const move = (moveEvent) => {
    if (moveEvent.pointerId !== undefined && moveEvent.pointerId !== pointerId) return;
    moveEvent.preventDefault();
    const time = xToTime(moveEvent.clientX);
    if (which === 'start') {
      const next = Math.min(time, state.selection.end - minGap());
      setSelection(clamp(next, 0, state.duration), state.selection.end);
    } else {
      const next = Math.max(time, state.selection.start + minGap());
      setSelection(state.selection.start, clamp(next, 0, state.duration));
    }
  };

  const finish = (upEvent) => {
    if (upEvent && upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    state.page.classList.remove('is-dragging');
    try {
      handle.releasePointerCapture(pointerId);
    } catch (error) {
      /* nothing to release */
    }
  };

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

function wireWaveformPointer() {
  els.canvas.addEventListener('pointerdown', (event) => {
    if (!state.buffer || state.exporting || state.loading) return;
    if (event.button !== undefined && event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let scrubbing = false;
    let active = true;

    const move = (moveEvent) => {
      if (!active) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!scrubbing && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
        scrubbing = true;
        els.waveScroll.classList.add('is-scrubbing');
        if (state.playing) pausePlayback();
      }
      if (scrubbing) {
        moveEvent.preventDefault();
        seekTo(xToTime(moveEvent.clientX));
      }
    };

    const finish = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      els.waveScroll.classList.remove('is-scrubbing');
      if (!scrubbing) seekTo(xToTime(event.clientX));
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

function wireHandleKeyboard(handle, which) {
  handle.addEventListener('keydown', (event) => {
    if (!state.buffer || state.exporting) return;
    const step = event.shiftKey ? 1 : 0.1;
    let handled = true;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      if (which === 'start') {
        setSelection(clamp(state.selection.start + direction * step, 0, state.selection.end - minGap()), state.selection.end);
      } else {
        setSelection(state.selection.start, clamp(state.selection.end + direction * step, state.selection.start + minGap(), state.duration));
      }
    } else if (event.key === 'Home') {
      if (which === 'start') setSelection(0, state.selection.end);
      else setSelection(state.selection.start, state.selection.start + minGap());
    } else if (event.key === 'End') {
      if (which === 'start') setSelection(state.selection.end - minGap(), state.selection.end);
      else setSelection(state.selection.start, state.duration);
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  });
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function setLoop(value) {
  state.loop = Boolean(value);
  els.loop.checked = state.loop;
  if (state.previewing) {
    startSourceAt(state.selection.start, { preview: true, loop: state.loop });
  }
}

function wireKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (!state.buffer || state.exporting || state.loading) return;
    const target = event.target;
    if (target && target.closest && target.closest('.atr-handle')) return;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if ((event.code === 'Space' || key === 'k') && target && target.closest &&
      target.closest('button, a, summary')) return;
    if (event.code === 'Space' || key === 'k') {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(state.playhead - (event.shiftKey ? 5 : 1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekTo(state.playhead + (event.shiftKey ? 5 : 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seekTo(state.duration);
    } else if (key === 'l') {
      event.preventDefault();
      setLoop(!state.loop);
      setPlayStatus(state.loop ? 'Loop is on for previews.' : 'Loop is off.');
    }
  });
}

function wire() {
  els.browse.addEventListener('click', () => els.fileInput.click());
  els.change.addEventListener('click', () => els.fileInput.click());
  els.remove.addEventListener('click', clearAll);
  els.uploadAnother.addEventListener('click', clearAll);
  els.trimAnother.addEventListener('click', trimAnotherSection);

  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (file) loadFile(file);
    els.fileInput.value = '';
  });

  els.app.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return;
    const types = Array.from(event.dataTransfer.types || []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    els.dropzone.classList.add('is-dragover');
    els.app.classList.add('is-dragover');
  });
  els.app.addEventListener('dragleave', (event) => {
    const next = event.relatedTarget;
    if (next && els.app.contains(next)) return;
    els.dropzone.classList.remove('is-dragover');
    els.app.classList.remove('is-dragover');
  });
  els.app.addEventListener('drop', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    els.dropzone.classList.remove('is-dragover');
    els.app.classList.remove('is-dragover');
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  els.play.addEventListener('click', togglePlayback);
  els.preview.addEventListener('click', previewSelection);
  els.loop.addEventListener('change', () => setLoop(els.loop.checked));

  els.seek.addEventListener('pointerdown', () => {
    state.seeking = true;
    if (state.playing) pausePlayback();
  });
  window.addEventListener('pointerup', () => {
    state.seeking = false;
  });
  els.seek.addEventListener('input', () => {
    seekTo((Number(els.seek.value) / 1000) * state.duration);
  });

  els.volume.addEventListener('input', () => {
    state.volume = clamp(Number(els.volume.value), 0, 1);
    if (state.gain) state.gain.gain.value = state.volume;
    updateVolumeUi();
  });

  els.startInput.addEventListener('input', () => previewTimeInput('start'));
  els.endInput.addEventListener('input', () => previewTimeInput('end'));
  els.startInput.addEventListener('change', () => commitTimeInput('start'));
  els.endInput.addEventListener('change', () => commitTimeInput('end'));
  els.startInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTimeInput('start');
      els.startInput.blur();
    }
  });
  els.endInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTimeInput('end');
      els.endInput.blur();
    }
  });

  els.setStart.addEventListener('click', () => {
    if (!state.buffer) return;
    setSelection(Math.min(state.playhead, state.selection.end - minGap()), state.selection.end);
  });
  els.setEnd.addEventListener('click', () => {
    if (!state.buffer) return;
    setSelection(state.selection.start, Math.max(state.playhead, state.selection.start + minGap()));
  });
  els.resetSelection.addEventListener('click', resetSelection);

  els.zoomOut.addEventListener('click', () => zoomStep(-1));
  els.zoomIn.addEventListener('click', () => zoomStep(1));
  els.zoomFit.addEventListener('click', () => setZoom(1));

  els.handleStart.addEventListener('pointerdown', (event) => beginHandleDrag('start', event));
  els.handleEnd.addEventListener('pointerdown', (event) => beginHandleDrag('end', event));
  wireHandleKeyboard(els.handleStart, 'start');
  wireHandleKeyboard(els.handleEnd, 'end');
  wireWaveformPointer();

  els.format.addEventListener('change', () => {
    if (els.format.value === 'mp3' && !state.mp3Available) {
      els.format.value = 'wav';
    }
    updateFormatUi();
    updateExportSummary();
  });
  els.bitrate.addEventListener('change', updateExportSummary);
  els.exportButton.addEventListener('click', exportAudio);
  els.cancelExport.addEventListener('click', cancelExport);

  els.download.addEventListener('click', (event) => {
    if (!state.result) {
      event.preventDefault();
      showError('There is no finished audio file to download yet.');
    }
  });

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => scheduleWaveformRedraw());
    observer.observe(els.waveScroll);
  } else {
    window.addEventListener('resize', scheduleWaveformRedraw);
  }

  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) cleanupPage();
  });
  wireKeyboard();
}

/* ------------------------------------------------------------------ */
/* Capability check and boot                                          */
/* ------------------------------------------------------------------ */

function checkCapabilities() {
  if (caps.audio) {
    els.support.hidden = true;
    return true;
  }
  els.support.hidden = false;
  els.supportText.textContent =
    'This browser does not provide the Web Audio API, so it cannot decode or trim audio locally. Use a current version of Chrome, Edge, Firefox or Safari.';
  els.browse.disabled = true;
  els.fileInput.disabled = true;
  els.dropzone.classList.add('is-disabled');
  return false;
}

function exposeDebug() {
  window.__AT__ = {
    state: () => state.phase,
    debug: () => ({
      phase: state.phase,
      fileName: state.file ? state.file.name : '',
      fileSize: state.file ? state.file.size : 0,
      duration: state.duration,
      sampleRate: state.sampleRate,
      sourceRate: state.sourceRate,
      ratePreserved: state.ratePreserved,
      channels: state.channels,
      metadataChannels: state.metadataChannels,
      peaks: state.peaks ? state.peaks.buckets : 0,
      ticks: els.ticks ? els.ticks.childElementCount : 0,
      waveformDrawn: state.waveformDrawn,
      waveformWidth: state.waveformWidth,
      zoom: state.zoom,
      selection: { ...state.selection },
      selectionValid: state.selectionValid,
      manualInvalid: state.manualInvalid,
      playhead: state.playhead,
      playing: state.playing,
      previewing: state.previewing,
      loop: state.loop,
      volume: state.volume,
      loading: state.loading,
      exporting: state.exporting,
      progress: state.progress,
      mp3Available: state.mp3Available,
      mp3Probed: state.mp3Probed,
      mp3Reason: state.mp3Reason,
      format: els.format.value,
      bitrate: els.bitrate.value,
      hasBuffer: Boolean(state.buffer),
      bufferChannels: state.buffer ? state.buffer.numberOfChannels : 0,
      contextState: state.ctx ? state.ctx.state : 'none',
      result: state.result
        ? {
            name: state.result.name,
            mime: state.result.mime,
            extension: state.result.extension,
            size: state.result.blob.size,
            duration: state.result.duration,
            sampleRate: state.result.sampleRate,
            channels: state.result.channels,
            formatLabel: state.result.formatLabel,
            url: state.result.url
          }
        : null
    })
  };
}

function boot() {
  exposeDebug();
  wire();
  const supported = checkCapabilities();
  if (supported) {
    refreshExportState();
    updateFormatUi();
    updateVolumeUi();
    setPlayStatus('Choose an audio file to begin.');
  }
}

boot();
