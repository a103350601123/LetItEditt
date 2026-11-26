/* LetitEdit Audio Merger - local multi-track arrangement, preview and export.
 *
 * Every source file is decoded once with the browser's own audio decoder. The
 * arrangement is rendered with an OfflineAudioContext so gaps, equal-power
 * crossfades, per-track volume, mute and optional RMS matching are applied to
 * one real mix. A local worker writes WAV (16-bit PCM) or MP3 (LAME). Nothing
 * is uploaded and no account is required.
 */

const els = {
  page: document.querySelector('.amg-page'),
  app: document.querySelector('[data-app]'),
  dropzone: document.querySelector('[data-dropzone]'),
  fileInput: document.querySelector('[data-file-input]'),
  browse: document.querySelector('[data-browse]'),
  addMore: document.querySelector('[data-add-more]'),
  clearAll: document.querySelector('[data-clear-all]'),
  support: document.querySelector('[data-support]'),
  supportText: document.querySelector('[data-support-text]'),
  error: document.querySelector('[data-global-error]'),
  status: document.querySelector('[data-status]'),
  loading: document.querySelector('[data-loading]'),
  loadingText: document.querySelector('[data-loading-text]'),
  empty: document.querySelector('[data-empty]'),
  editor: document.querySelector('[data-editor]'),
  summaryTitle: document.querySelector('[data-summary-title]'),
  summaryMeta: document.querySelector('[data-summary-meta]'),
  trackList: document.querySelector('[data-track-list]'),
  trackError: document.querySelector('[data-track-error]'),
  transitions: document.querySelector('[data-transitions]'),
  transitionStatus: document.querySelector('[data-transition-status]'),

  seqPlay: document.querySelector('[data-seq-play]'),
  seqRestart: document.querySelector('[data-seq-restart]'),
  seqCurrent: document.querySelector('[data-seq-current]'),
  seqSeek: document.querySelector('[data-seq-seek]'),
  seqTotal: document.querySelector('[data-seq-total]'),
  seqVolume: document.querySelector('[data-seq-volume]'),
  playStatus: document.querySelector('[data-play-status]'),
  previewBadge: document.querySelector('[data-preview-badge]'),
  timelineScroll: document.querySelector('[data-timeline-scroll]'),
  timelineInner: document.querySelector('[data-timeline-inner]'),
  timeline: document.querySelector('[data-timeline]'),
  timelinePlayhead: document.querySelector('[data-timeline-playhead]'),

  format: document.querySelector('[data-format]'),
  formatNote: document.querySelector('[data-format-note]'),
  bitrateField: document.querySelector('[data-bitrate-field]'),
  bitrate: document.querySelector('[data-bitrate]'),
  rate: document.querySelector('[data-rate]'),
  channels: document.querySelector('[data-channels]'),
  balance: document.querySelector('[data-balance]'),
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
  resultTracks: document.querySelector('[data-result-tracks]'),
  resultSafety: document.querySelector('[data-result-safety]'),
  resultNote: document.querySelector('[data-result-note]'),
  download: document.querySelector('[data-download]'),
  exportAgain: document.querySelector('[data-export-again]'),
  startOver: document.querySelector('[data-start-over]')
};

const MAX_FILES = 20;
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_DURATION = 30 * 60;
const MAX_GAP = 30;
const MIN_CROSSFADE = 0.01;
const PEAK_BUCKETS = 3000;
const TIMELINE_PX_PER_SEC = 38;
const TIMELINE_MAX_WIDTH = 12000;
const MP3_SAMPLE_RATES = new Set([32000, 44100, 48000]);
const GAP_PRESETS = [0, 0.5, 1, 2, 5];
const CROSSFADE_PRESETS = [0.5, 1, 2, 3];
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/></svg>';
const KNOWN_AUDIO = /\.(mp3|wav|wave|m4a|m4b|mp4|aac|ogg|oga|opus|flac|webm|aif|aiff)$/i;
const DRAG_MIME = 'application/x-letitedit-audio-track';

const AudioCtor = window.AudioContext || window.webkitAudioContext;
const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const caps = {
  audio: Boolean(AudioCtor && AudioCtor.prototype.decodeAudioData),
  offline: Boolean(OfflineCtor),
  worker: typeof Worker === 'function'
};

const state = {
  tracks: [],
  transitions: new Map(),
  nextTrackId: 0,
  phase: 'empty',
  supported: true,
  loading: false,
  addToken: 0,
  decodeCount: 0,
  exporting: false,
  exportToken: 0,
  worker: null,
  replaceTarget: null,
  dragTrackId: null,
  dropTargetId: null,
  dropPosition: null,
  pointerDrag: null,
  statusMessage: '',
  trackError: '',
  mp3Probed: false,
  mp3ProbeOk: false,
  mp3Available: false,
  mp3Reason: '',
  audioCtx: null,
  trackGain: null,
  trackSource: null,
  trackPreviewGain: null,
  previewTrackId: null,
  trackPreviewPlaying: false,
  seqPlaying: false,
  seqPreparing: false,
  seqSource: null,
  seqGain: null,
  seqVolume: 0.9,
  seqPlayhead: 0,
  seqStartedAt: 0,
  seqStartOffset: 0,
  seqRaf: 0,
  seqSeeking: false,
  seqRequestToken: 0,
  rendered: null,
  renderPromise: null,
  mixVersion: 0,
  previewDirty: true,
  timelineWidth: 0,
  timelineDrawn: false,
  timelineSegments: 0,
  timelineGaps: 0,
  timelineCrossfades: 0,
  result: null,
  resultUrl: '',
  exportRender: null,
  lastSafety: null
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

function formatDb(value) {
  if (!Number.isFinite(value) || value <= 0) return '-inf dBFS';
  return `${(20 * Math.log10(value)).toFixed(1)} dBFS`;
}

function channelLabel(count) {
  if (count === 1) return 'Mono';
  if (count === 2) return 'Stereo';
  return `${count} channels`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text, length) {
  const value = String(text || '');
  return value.length > length ? `${value.slice(0, Math.max(1, length - 1))}...` : value;
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

function showTrackError(message) {
  state.trackError = message;
  els.trackError.textContent = message;
  els.trackError.hidden = false;
}

function clearTrackError() {
  state.trackError = '';
  els.trackError.hidden = true;
  els.trackError.textContent = '';
}

function setStatus(message) {
  state.statusMessage = message || '';
  els.status.textContent = state.statusMessage;
}

function setPlayStatus(message) {
  els.playStatus.textContent = message;
}

function setLoading(visible, text) {
  state.loading = visible;
  els.loading.hidden = !visible;
  if (text) els.loadingText.textContent = text;
  if (visible) {
    els.empty.hidden = true;
    els.editor.hidden = true;
  } else {
    els.empty.hidden = state.tracks.length > 0;
    els.editor.hidden = state.tracks.length === 0;
  }
  refreshExportState();
}

function setLoadingText(text) {
  els.loadingText.textContent = text;
}

function setTransitionStatus(message) {
  els.transitionStatus.textContent = message || '';
}

function setProgress(value, label) {
  const percent = Math.round(clamp(value, 0, 1) * 100);
  els.progressBar.style.width = `${percent}%`;
  els.progressTrack.setAttribute('aria-valuenow', String(percent));
  els.progressLabel.textContent = label || `Working... ${percent}%`;
}

/* ------------------------------------------------------------------ */
/* Decoding and waveform analysis                                     */
/* ------------------------------------------------------------------ */

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

async function computeAnalysis(buffer, token, onProgress) {
  const buckets = Math.max(1, Math.min(PEAK_BUCKETS, buffer.length));
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  const channels = [];
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index));
  }
  const samplesPerBucket = buffer.length / buckets;
  const step = Math.max(1, Math.floor(samplesPerBucket / 420));
  let peak = 0;
  let sumSquares = 0;
  let sampleCount = 0;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    if (token !== state.addToken) return null;
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
        const abs = Math.abs(value);
        if (abs > peak) peak = abs;
        sumSquares += value * value;
        sampleCount += 1;
      }
    }
    mins[bucket] = min;
    maxs[bucket] = max;
    if (onProgress && (bucket & 511) === 0) {
      onProgress(bucket / buckets);
      if ((bucket & 2047) === 0) await yieldToLoop();
    }
  }

  return {
    peaks: { mins, maxs, buckets },
    peak,
    rms: sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0
  };
}

function decodeErrorMessage(file, error) {
  const detail = error && error.message ? ` (${error.message})` : '';
  return `This browser could not decode "${file.name}"${detail}. The file may be corrupted, use a codec this browser does not support, or be too large for the device. Try a WAV, MP3, M4A, AAC, OGG, FLAC or WebM file that plays in this browser.`;
}

async function decodeTrack(file, token) {
  setLoadingText(`Reading ${file.name}...`);
  const metadata = await withTimeout(probeMetadata(file), 6000, null);
  if (token !== state.addToken) return null;
  setLoadingText(`Decoding ${file.name}...`);
  const data = await file.arrayBuffer();
  if (token !== state.addToken) return null;
  const buffer = await decodeBuffer(data, metadata && metadata.sampleRate);
  if (token !== state.addToken) return null;
  if (!buffer || !buffer.length) throw new Error('the decoded audio is empty');

  setLoadingText(`Building the waveform for ${file.name}...`);
  const analysis = await computeAnalysis(buffer, token, (ratio) => {
    setLoadingText(`Building the waveform for ${file.name}... ${Math.round(ratio * 100)}%`);
  });
  if (!analysis || token !== state.addToken) return null;

  const sourceRate = metadata && metadata.sampleRate ? metadata.sampleRate : null;
  const ratePreserved = Boolean(sourceRate) && sourceRate === buffer.sampleRate;
  state.decodeCount += 1;
  return {
    id: `t${++state.nextTrackId}`,
    file,
    name: file.name,
    size: file.size,
    buffer,
    peaks: analysis.peaks,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    sourceRate,
    ratePreserved,
    metadataChannels: metadata && metadata.channels ? metadata.channels : null,
    channels: buffer.numberOfChannels,
    peak: analysis.peak,
    rms: analysis.rms,
    volume: 1,
    muted: false
  };
}

function isProbablyAudio(file) {
  if (!file) return false;
  const type = String(file.type || '');
  return type.startsWith('audio/') || KNOWN_AUDIO.test(file.name || '');
}

function totalInputBytes() {
  return state.tracks.reduce((sum, track) => sum + track.size, 0);
}

function totalTrackDuration() {
  return state.tracks.reduce((sum, track) => sum + track.duration, 0);
}

/* ------------------------------------------------------------------ */
/* Arrangement                                                        */
/* ------------------------------------------------------------------ */

function transitionKey(from, to) {
  return `${from.id}|${to.id}`;
}

function crossfadeMax(from, to) {
  return Math.max(MIN_CROSSFADE, Math.min(from.duration, to.duration) / 2);
}

function normalizeTransition(transition, from, to) {
  if (transition.mode === 'crossfade') {
    const max = crossfadeMax(from, to);
    const min = Math.min(MIN_CROSSFADE, max);
    transition.duration = clamp(Number(transition.duration) || 0, min, max);
  } else {
    transition.mode = 'gap';
    transition.duration = clamp(Number(transition.duration) || 0, 0, MAX_GAP);
  }
  return transition;
}

function getTransition(from, to) {
  const key = transitionKey(from, to);
  let transition = state.transitions.get(key);
  if (!transition) {
    transition = { mode: 'gap', duration: 0 };
    state.transitions.set(key, transition);
  }
  return normalizeTransition(transition, from, to);
}

function buildLayout() {
  const segments = [];
  let cursor = 0;
  for (let index = 0; index < state.tracks.length; index += 1) {
    const track = state.tracks[index];
    const previous = index > 0 ? segments[index - 1] : null;
    const previousTransition = previous ? getTransition(previous.track, track) : null;
    const nextTrack = state.tracks[index + 1] || null;
    const nextTransition = nextTrack ? getTransition(track, nextTrack) : null;
    const fadeIn = previousTransition && previousTransition.mode === 'crossfade'
      ? previousTransition.duration
      : 0;
    const start = previous
      ? previousTransition.mode === 'crossfade'
        ? previous.end - previousTransition.duration
        : previous.end + previousTransition.duration
      : 0;
    const segment = {
      track,
      index,
      start,
      end: start + track.duration,
      fadeIn,
      fadeOut: nextTransition && nextTransition.mode === 'crossfade' ? nextTransition.duration : 0,
      nextTransition
    };
    segments.push(segment);
    cursor = segment.end;
  }

  const transitions = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const from = segments[index];
    const to = segments[index + 1];
    const transition = getTransition(from.track, to.track);
    transitions.push({
      from,
      to,
      transition,
      start: transition.mode === 'crossfade' ? to.start : from.end,
      end: transition.mode === 'crossfade' ? from.end : to.start
    });
  }

  return {
    segments,
    transitions,
    totalDuration: Math.max(0, cursor)
  };
}

function resolveOutputRate() {
  if (els.rate.value !== 'auto') return Number(els.rate.value) || 44100;
  if (!state.tracks.length) return 44100;
  return Math.max(...state.tracks.map((track) => track.sampleRate || 44100));
}

function resolveChannels() {
  if (els.channels.value === 'mono') return 1;
  if (els.channels.value === 'stereo') return 2;
  return state.tracks.some((track) => track.channels > 1) ? 2 : 1;
}

function formatSecondsShort(value) {
  return String(Number(Number(value).toFixed(2)));
}

function estimatedBytes(layout) {
  const rate = resolveOutputRate();
  const channels = resolveChannels();
  if (els.format.value === 'mp3') {
    return layout.totalDuration * (Number(els.bitrate.value) * 1000 / 8);
  }
  return layout.totalDuration * rate * channels * 2 + 44;
}

function mixKey() {
  const layout = buildLayout();
  return JSON.stringify({
    tracks: state.tracks.map((track) => [
      track.id,
      track.duration,
      track.sampleRate,
      track.channels,
      track.volume,
      track.muted
    ]),
    transitions: layout.transitions.map((item) => [
      item.from.track.id,
      item.to.track.id,
      item.transition.mode,
      item.transition.duration
    ]),
    rate: resolveOutputRate(),
    channels: resolveChannels(),
    balance: Boolean(els.balance.checked)
  });
}

/* ------------------------------------------------------------------ */
/* MP3 capability and output summary                                  */
/* ------------------------------------------------------------------ */

function mp3SupportReason(rate, channels) {
  if (!state.mp3Probed) return 'Checking the local MP3 encoder...';
  if (!state.mp3ProbeOk) return 'The local MP3 encoder could not start in this browser. WAV export is still available.';
  if (!MP3_SAMPLE_RATES.has(rate)) {
    return `MP3 encoding is not available at ${formatSampleRate(rate)}. Choose 32, 44.1 or 48 kHz, or export WAV.`;
  }
  if (channels > 2) return 'MP3 encoding supports mono or stereo. Export WAV to keep more channels.';
  return '';
}

function updateMp3Availability() {
  const rate = resolveOutputRate();
  const channels = resolveChannels();
  const reason = mp3SupportReason(rate, channels);
  state.mp3Available = !reason && state.mp3ProbeOk && MP3_SAMPLE_RATES.has(rate) && channels <= 2;
  state.mp3Reason = reason;
  const option = els.format.querySelector('option[value="mp3"]');
  if (option) {
    option.disabled = !state.mp3Available;
    option.textContent = state.mp3Available
      ? 'MP3 - compressed, lossy'
      : state.mp3Probed
        ? 'MP3 - not available for this output'
        : 'MP3 - checking...';
  }
  if (!state.mp3Available && els.format.value === 'mp3') {
    els.format.value = 'wav';
  }
}

function updateFormatUi() {
  updateMp3Availability();
  const mp3 = els.format.value === 'mp3';
  els.bitrateField.hidden = !mp3;
  if (mp3 && state.mp3Available) {
    els.formatNote.textContent =
      'MP3 re-encodes the finished mix at the chosen bitrate. It is smaller than WAV but lossy and adds a short amount of encoder padding.';
  } else if (mp3) {
    els.formatNote.textContent = state.mp3Reason || 'MP3 export is not available for this output. Choose WAV.';
  } else {
    const rate = resolveOutputRate();
    const channels = resolveChannels();
    els.formatNote.textContent =
      `WAV writes uncompressed 16-bit PCM at ${formatSampleRate(rate)} in ${channelLabel(channels).toLowerCase()}. ` +
      (state.mp3Available
        ? 'MP3 is smaller but lossy.'
        : (state.mp3Reason || 'MP3 export is not available in this browser.'));
  }
  updateExportSummary();
  refreshExportState();
}

function updateExportSummary() {
  const layout = buildLayout();
  if (!state.tracks.length) {
    els.exportSummary.textContent = 'Add audio files to see the estimated duration and size.';
    return;
  }
  const rate = resolveOutputRate();
  const channels = resolveChannels();
  const format = els.format.value === 'mp3' ? `MP3 - ${els.bitrate.value} kbps` : 'WAV - 16-bit PCM';
  const estimate = estimatedBytes(layout);
  const balance = els.balance.checked ? ' - RMS matching on' : '';
  els.exportSummary.textContent =
    `${format} - ${formatClock(layout.totalDuration)} - ~${formatBytes(estimate)} - ` +
    `${formatSampleRate(rate)} - ${channelLabel(channels)} - ${state.tracks.length} tracks${balance}`;
}

function updateSummary() {
  const layout = buildLayout();
  const rate = resolveOutputRate();
  const channels = resolveChannels();
  els.summaryTitle.textContent = state.tracks.length === 1
    ? '1 track ready'
    : `${state.tracks.length} tracks ready`;
  els.summaryMeta.textContent = state.tracks.length
    ? `${formatClock(layout.totalDuration)} output - ${formatBytes(totalInputBytes())} input - ` +
      `${formatSampleRate(rate)} - ${channelLabel(channels)}` +
      (els.balance.checked ? ' - RMS matching on' : '')
    : '';
  els.seqTotal.textContent = formatClock(layout.totalDuration);
  if (state.seqPlayhead > layout.totalDuration) {
    state.seqPlayhead = layout.totalDuration;
  }
  updateExportSummary();
  updateSeqUi();
}

function updatePreviewBadge() {
  if (!els.previewBadge) return;
  const show = state.previewDirty && state.tracks.length >= 2;
  els.previewBadge.hidden = !show;
  els.previewBadge.textContent = show ? 'Preview not prepared' : 'Preview ready';
}

/* ------------------------------------------------------------------ */
/* Sequence playback state helpers                                    */
/* ------------------------------------------------------------------ */

function updateSeqButton() {
  const playing = String(state.seqPlaying);
  if (els.seqPlay.dataset.playing === playing) return;
  els.seqPlay.dataset.playing = playing;
  els.seqPlay.innerHTML = state.seqPlaying ? PAUSE_ICON : PLAY_ICON;
  els.seqPlay.setAttribute('aria-label', state.seqPlaying ? 'Pause merged sequence' : 'Play merged sequence');
  els.seqPlay.setAttribute('title', state.seqPlaying ? 'Pause merged sequence' : 'Play merged sequence');
}

function updateSeqUi() {
  const layout = buildLayout();
  const total = layout.totalDuration;
  const position = clamp(state.seqPlayhead, 0, total);
  els.seqCurrent.textContent = formatClock(position);
  els.seqTotal.textContent = formatClock(total);
  const ratio = total > 0 ? position / total : 0;
  els.seqSeek.style.setProperty('--amg-progress', `${(ratio * 100).toFixed(2)}%`);
  if (!state.seqSeeking) {
    els.seqSeek.value = String(Math.round(ratio * 1000));
  }
  updateTimelinePlayhead();
  updateSeqButton();
}

function updateTimelinePlayhead() {
  const layout = buildLayout();
  const total = layout.totalDuration;
  const width = state.timelineWidth || els.timelineInner.clientWidth || 1;
  const ratio = total > 0 ? clamp(state.seqPlayhead / total, 0, 1) : 0;
  const x = ratio * width;
  els.timelinePlayhead.style.left = `${x}px`;
  if (state.seqPlaying && width > els.timelineScroll.clientWidth) {
    const margin = 42;
    if (x < els.timelineScroll.scrollLeft + margin) {
      els.timelineScroll.scrollLeft = Math.max(0, x - margin);
    } else if (x > els.timelineScroll.scrollLeft + els.timelineScroll.clientWidth - margin) {
      els.timelineScroll.scrollLeft = Math.min(
        Math.max(0, width - els.timelineScroll.clientWidth),
        x - els.timelineScroll.clientWidth + margin
      );
    }
  }
}

function updateVolumeUi() {
  els.seqVolume.value = String(state.seqVolume);
  els.seqVolume.style.setProperty('--amg-progress', `${Math.round(state.seqVolume * 100)}%`);
}

/* ------------------------------------------------------------------ */
/* Track list rendering                                               */
/* ------------------------------------------------------------------ */

function trackMeta(track) {
  const rate = track.ratePreserved
    ? formatSampleRate(track.sampleRate)
    : track.sourceRate
      ? `${formatSampleRate(track.sampleRate)} decoded`
      : `${formatSampleRate(track.sampleRate)} decoded`;
  return `${formatBytes(track.size)} - ${formatClock(track.duration)} - ${rate} - ` +
    `${channelLabel(track.channels)} - RMS ${formatDb(track.rms)}`;
}

function renderTracks(options = {}) {
  if (!state.tracks.length) {
    els.trackList.innerHTML = '';
    return;
  }
  const focusId = options.focusId || '';
  const focusAction = options.focusAction || '';
  els.trackList.innerHTML = state.tracks.map((track, index) => {
    const isPreviewing = state.previewTrackId === track.id && state.trackPreviewPlaying;
    const previewLabel = isPreviewing ? `Pause preview of ${track.name}` : `Preview ${track.name}`;
    const volumePercent = Math.round(track.volume * 100);
    const upDisabled = index === 0 ? ' disabled' : '';
    const downDisabled = index === state.tracks.length - 1 ? ' disabled' : '';
    return `
      <li class="amg-track" data-track-id="${track.id}" data-muted="${track.muted}" draggable="true">
        <button class="amg-drag-handle" type="button" draggable="true" data-drag
          aria-label="Reorder ${escapeHtml(track.name)}. Press Arrow Up or Arrow Down, or use the Move buttons.">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>
        </button>
        <span class="amg-track-order" aria-hidden="true">${index + 1}</span>
        <div class="amg-track-main">
          <div class="amg-track-head">
            <strong title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</strong>
            <span>${escapeHtml(trackMeta(track))}</span>
          </div>
          <div class="amg-track-wave">
            <canvas data-track-wave role="img" aria-label="Decoded waveform for ${escapeHtml(track.name)}"></canvas>
            <button class="amg-track-preview" type="button" data-preview-track
              aria-label="${escapeHtml(previewLabel)}" aria-pressed="${isPreviewing}" title="${escapeHtml(previewLabel)}">
              ${isPreviewing ? PAUSE_ICON : PLAY_ICON}
            </button>
          </div>
        </div>
        <div class="amg-track-controls">
          <div>
            <label class="amg-volume-label" for="amg-vol-${track.id}">
              <span>Volume</span><output data-volume-out>${volumePercent}%</output>
            </label>
            <input id="amg-vol-${track.id}" class="amg-range" type="range" data-track-volume
              min="0" max="1.5" step="0.01" value="${track.volume}"
              style="--amg-progress:${(track.volume / 1.5) * 100}%"
              aria-label="Volume for ${escapeHtml(track.name)}">
            <div class="amg-track-volume-actions">
              <button class="amg-mini-btn" type="button" data-mute aria-pressed="${track.muted}">${track.muted ? 'Unmute' : 'Mute'}</button>
              <button class="amg-mini-btn" type="button" data-reset-volume>Reset</button>
            </div>
          </div>
        </div>
        <div class="amg-track-actions">
          <button class="amg-mini-btn" type="button" data-move-up${upDisabled} aria-label="Move ${escapeHtml(track.name)} up">Up</button>
          <button class="amg-mini-btn" type="button" data-move-down${downDisabled} aria-label="Move ${escapeHtml(track.name)} down">Down</button>
          <button class="amg-mini-btn" type="button" data-replace aria-label="Replace ${escapeHtml(track.name)}">Replace</button>
          <button class="amg-mini-btn amg-remove" type="button" data-remove aria-label="Remove ${escapeHtml(track.name)}">Remove</button>
        </div>
      </li>
    `;
  }).join('');

  requestAnimationFrame(() => {
    drawTrackWaveforms();
    if (focusId) {
      const card = els.trackList.querySelector(`[data-track-id="${focusId}"]`);
      let target = card
        ? card.querySelector(focusAction === 'down' ? '[data-move-down]' : focusAction === 'handle' ? '[data-drag]' : '[data-move-up]')
        : null;
      if ((!target || target.disabled) && card) target = card.querySelector('[data-drag]');
      if (target) target.focus();
    }
  });
}

function drawTrackWaveforms() {
  for (const track of state.tracks) {
    const card = els.trackList.querySelector(`[data-track-id="${track.id}"]`);
    if (!card) continue;
    const canvas = card.querySelector('[data-track-wave]');
    if (canvas) drawTrackWaveform(track, canvas);
  }
}

function drawTrackWaveform(track, canvas) {
  const cssWidth = Math.max(1, Math.round(canvas.clientWidth || 240));
  const cssHeight = Math.max(1, Math.round(canvas.clientHeight || 44));
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1, 4000 / cssWidth));
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cssWidth, cssHeight);
  const center = cssHeight / 2;
  const amplitude = cssHeight * 0.4;
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, center + 0.5);
  context.lineTo(cssWidth, center + 0.5);
  context.stroke();
  const peaks = track.peaks;
  if (!peaks) return;
  context.fillStyle = '#2563eb';
  for (let x = 0; x < cssWidth; x += 1) {
    const bucket = Math.min(peaks.buckets - 1, Math.floor((x / cssWidth) * peaks.buckets));
    const min = peaks.mins[bucket] || 0;
    const max = peaks.maxs[bucket] || 0;
    const top = center - max * amplitude;
    const bottom = center - min * amplitude;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

/* ------------------------------------------------------------------ */
/* Transition editor                                                  */
/* ------------------------------------------------------------------ */

function renderTransitions() {
  if (state.tracks.length < 2) {
    els.transitions.innerHTML = '<p class="amg-hint">Add at least two tracks to set a gap or crossfade between them.</p>';
    setTransitionStatus('');
    return;
  }
  const layout = buildLayout();
  els.transitions.innerHTML = layout.transitions.map((item, index) => {
    const { from, to, transition } = item;
    const max = transition.mode === 'crossfade'
      ? crossfadeMax(from.track, to.track)
      : MAX_GAP;
    const presets = transition.mode === 'crossfade' ? CROSSFADE_PRESETS : GAP_PRESETS;
    const presetHtml = presets.map((value) => {
      const disabled = value > max + 1e-9 ? ' disabled' : '';
      const active = Math.abs(value - transition.duration) < 0.001 ? ' is-active' : '';
      return `<button class="amg-preset${active}" type="button" data-preset-duration="${value}"${disabled} aria-pressed="${active ? 'true' : 'false'}">${value === 0 ? '0 s' : `${formatSecondsShort(value)} s`}</button>`;
    }).join('');
    const note = transition.mode === 'crossfade'
      ? `Equal-power overlap of ${formatSecondsShort(transition.duration)} s. Maximum ${formatSecondsShort(max)} s for these two tracks.`
      : transition.duration > 0
        ? `${formatSecondsShort(transition.duration)} s of silence between the tracks.`
        : 'Direct join at a sample boundary (zero gap).';
    const warning = transition.mode === 'crossfade' && max < 0.5
      ? ' is-warning'
      : '';
    return `
      <div class="amg-transition" data-transition-row data-from-id="${from.track.id}" data-to-id="${to.track.id}">
        <div class="amg-transition-name">
          <strong title="${escapeHtml(from.track.name)} to ${escapeHtml(to.track.name)}">${index + 1}. ${escapeHtml(truncate(from.track.name, 24))} to ${index + 2}. ${escapeHtml(truncate(to.track.name, 24))}</strong>
          <span>${transition.mode === 'crossfade' ? 'Overlap' : 'Silence'} - ${formatSecondsShort(transition.duration)} s</span>
        </div>
        <select class="amg-select" data-transition-mode aria-label="Transition type between ${escapeHtml(from.track.name)} and ${escapeHtml(to.track.name)}">
          <option value="gap"${transition.mode === 'gap' ? ' selected' : ''}>Silence gap</option>
          <option value="crossfade"${transition.mode === 'crossfade' ? ' selected' : ''}>Equal-power crossfade</option>
        </select>
        <div class="amg-presets" aria-label="Transition duration presets">
          ${presetHtml}
        </div>
        <label class="amg-custom">
          <span class="visually-hidden">Custom duration between ${escapeHtml(from.track.name)} and ${escapeHtml(to.track.name)}</span>
          <input type="number" inputmode="decimal" data-custom-duration min="${transition.mode === 'crossfade' ? Math.min(MIN_CROSSFADE, max) : 0}" max="${max}" step="0.1" value="${formatSecondsShort(transition.duration)}" aria-label="Custom ${transition.mode} duration in seconds">
          <span>s</span>
        </label>
        <p class="amg-transition-note${warning}">${note}</p>
      </div>
    `;
  }).join('');
}

/* ------------------------------------------------------------------ */
/* Mix invalidation                                                   */
/* ------------------------------------------------------------------ */

let invalidateFrame = 0;

function flushPendingInvalidation() {
  if (!invalidateFrame) return;
  cancelAnimationFrame(invalidateFrame);
  invalidateFrame = 0;
  invalidateMix();
}

function invalidateMixSoon() {
  if (invalidateFrame) return;
  invalidateFrame = requestAnimationFrame(() => {
    invalidateFrame = 0;
    invalidateMix();
  });
}

function invalidateMix(message) {
  state.mixVersion += 1;
  state.rendered = null;
  state.renderPromise = null;
  state.previewDirty = true;
  state.lastSafety = null;
  if (state.result) releaseResult();
  stopSequenceSource();
  state.seqPlaying = false;
  const layout = buildLayout();
  state.seqPlayhead = clamp(state.seqPlayhead, 0, layout.totalDuration);
  updatePreviewBadge();
  updateSummary();
  drawTimeline();
  refreshExportState();
  if (message) setStatus(message);
}

/* ------------------------------------------------------------------ */
/* Timeline drawing                                                   */
/* ------------------------------------------------------------------ */

function computeBalanceGains() {
  const gains = new Map();
  for (const track of state.tracks) gains.set(track.id, 1);
  if (!els.balance.checked) return gains;
  const active = state.tracks.filter((track) => !track.muted && track.rms > 0.00001);
  if (active.length < 2) return gains;
  const levels = active.map((track) => track.rms).sort((a, b) => a - b);
  const middle = Math.floor(levels.length / 2);
  const median = levels.length % 2
    ? levels[middle]
    : (levels[middle - 1] + levels[middle]) / 2;
  if (!Number.isFinite(median) || median <= 0) return gains;
  const minGain = Math.pow(10, -12 / 20);
  const maxGain = Math.pow(10, 12 / 20);
  for (const track of active) {
    let gain = clamp(median / track.rms, minGain, maxGain);
    if (track.peak > 0) gain = Math.min(gain, 0.999 / track.peak);
    gains.set(track.id, gain);
  }
  return gains;
}

function sampleTrackPeaks(track, relativeTime) {
  const peaks = track.peaks;
  if (!peaks) return { min: 0, max: 0 };
  const ratio = track.duration > 0 ? clamp(relativeTime / track.duration, 0, 1) : 0;
  const bucket = Math.min(peaks.buckets - 1, Math.floor(ratio * peaks.buckets));
  return { min: peaks.mins[bucket] || 0, max: peaks.maxs[bucket] || 0 };
}

function composeTimelinePeaks(layout, width) {
  const mins = new Float32Array(width);
  const maxs = new Float32Array(width);
  if (!layout.totalDuration) return { mins, maxs };
  const balance = computeBalanceGains();
  for (let x = 0; x < width; x += 1) {
    const time = ((x + 0.5) / width) * layout.totalDuration;
    let min = 0;
    let max = 0;
    for (const segment of layout.segments) {
      const track = segment.track;
      if (track.muted) continue;
      if (time < segment.start || time > segment.end) continue;
      const relative = time - segment.start;
      let envelope = track.volume * (balance.get(track.id) || 1);
      if (segment.fadeIn > 0 && relative < segment.fadeIn) {
        envelope *= Math.sin((relative / segment.fadeIn) * Math.PI / 2);
      }
      if (segment.fadeOut > 0 && relative > track.duration - segment.fadeOut) {
        envelope *= Math.cos(((relative - (track.duration - segment.fadeOut)) / segment.fadeOut) * Math.PI / 2);
      }
      const peaks = sampleTrackPeaks(track, relative);
      min += peaks.min * envelope;
      max += peaks.max * envelope;
    }
    mins[x] = clamp(min, -1, 1);
    maxs[x] = clamp(max, -1, 1);
  }
  return { mins, maxs };
}

function peaksFromBuffer(buffer, width) {
  const mins = new Float32Array(width);
  const maxs = new Float32Array(width);
  const channels = [];
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index));
  }
  const samplesPerBucket = buffer.length / width;
  const step = Math.max(1, Math.floor(samplesPerBucket / 160));
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor(x * samplesPerBucket);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((x + 1) * samplesPerBucket)));
    let min = 0;
    let max = 0;
    for (const data of channels) {
      for (let sample = start; sample < end; sample += step) {
        const value = data[sample];
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    mins[x] = min;
    maxs[x] = max;
  }
  return { mins, maxs };
}

function drawTimeline(renderedBuffer) {
  const layout = buildLayout();
  const total = layout.totalDuration;
  const available = Math.max(1, Math.round(els.timelineScroll.clientWidth || 720));
  const width = Math.round(clamp(
    Math.max(available, total * TIMELINE_PX_PER_SEC),
    available,
    TIMELINE_MAX_WIDTH
  ));
  state.timelineWidth = width;
  els.timelineInner.style.width = `${width}px`;
  const cssHeight = Math.max(80, Math.round(els.timelineInner.clientHeight || 162));
  const canvas = els.timeline;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1, 16000 / Math.max(1, width)));
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, cssHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, cssHeight);

  state.timelineSegments = layout.segments.length;
  state.timelineGaps = layout.transitions.filter((item) => item.transition.mode === 'gap' && item.transition.duration > 0).length;
  state.timelineCrossfades = layout.transitions.filter((item) => item.transition.mode === 'crossfade').length;
  state.timelineDrawn = layout.segments.length > 0;

  if (!layout.segments.length || total <= 0) {
    context.fillStyle = '#64748b';
    context.font = '12px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('Add audio files to draw the merged timeline.', width / 2, cssHeight / 2);
    updateTimelinePlayhead();
    return;
  }

  const laneTop = 24;
  const laneBottom = cssHeight - 23;
  const laneHeight = Math.max(20, laneBottom - laneTop);
  const center = laneTop + laneHeight / 2;
  const amplitude = laneHeight * 0.44;
  const timeToX = (time) => (time / total) * width;

  for (const segment of layout.segments) {
    const x1 = timeToX(segment.start);
    const x2 = timeToX(segment.end);
    context.fillStyle = segment.index % 2 === 0 ? '#ffffff' : '#eff6ff';
    context.fillRect(x1, laneTop, Math.max(1, x2 - x1), laneHeight);
    context.strokeStyle = '#e2e8f0';
    context.lineWidth = 1;
    context.strokeRect(x1 + 0.5, laneTop + 0.5, Math.max(1, x2 - x1 - 1), laneHeight - 1);

    context.save();
    context.beginPath();
    context.rect(x1 + 3, 2, Math.max(0, x2 - x1 - 6), 19);
    context.clip();
    context.fillStyle = '#0f172a';
    context.font = '600 10px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const label = `${segment.index + 1}. ${segment.track.name}`;
    context.fillText(label, x1 + 5, 11);
    context.restore();
  }

  for (const item of layout.transitions) {
    const x1 = timeToX(item.start);
    const x2 = timeToX(item.end);
    const regionWidth = Math.max(0, x2 - x1);
    if (regionWidth < 0.5) continue;
    if (item.transition.mode === 'gap') {
      context.fillStyle = 'rgba(239, 246, 255, .96)';
      context.fillRect(x1, laneTop, regionWidth, laneHeight);
      context.strokeStyle = '#60a5fa';
      context.setLineDash([4, 3]);
      context.strokeRect(x1 + 0.5, laneTop + 0.5, Math.max(0, regionWidth - 1), laneHeight - 1);
      context.setLineDash([]);
      if (regionWidth > 42) {
        context.fillStyle = '#2563eb';
        context.font = '600 9px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(`Gap ${formatSecondsShort(item.transition.duration)} s`, x1 + regionWidth / 2, laneTop + 12);
      }
    } else {
      context.fillStyle = 'rgba(96, 165, 250, .32)';
      context.fillRect(x1, laneTop, regionWidth, laneHeight);
      context.strokeStyle = '#2563eb';
      context.setLineDash([3, 3]);
      context.strokeRect(x1 + 0.5, laneTop + 0.5, Math.max(0, regionWidth - 1), laneHeight - 1);
      context.setLineDash([]);
      if (regionWidth > 48) {
        context.fillStyle = '#0f172a';
        context.font = '600 9px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(`XFade ${formatSecondsShort(item.transition.duration)} s`, x1 + regionWidth / 2, laneTop + 12);
      }
    }
  }

  const peaks = renderedBuffer && renderedBuffer.duration > 0
    ? peaksFromBuffer(renderedBuffer, width)
    : composeTimelinePeaks(layout, width);

  context.fillStyle = '#2563eb';
  for (let x = 0; x < width; x += 1) {
    const min = peaks.mins[x] || 0;
    const max = peaks.maxs[x] || 0;
    const top = center - max * amplitude;
    const bottom = center - min * amplitude;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  context.strokeStyle = 'rgba(15, 23, 42, .18)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, center + 0.5);
  context.lineTo(width, center + 0.5);
  context.stroke();

  const tickStep = TICK_STEPS.find((candidate) => (candidate / total) * width >= 68) ||
    Math.max(1, Math.ceil(total / 8));
  context.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (let time = 0; time <= total + 1e-6; time += tickStep) {
    const x = timeToX(time);
    context.strokeStyle = '#e2e8f0';
    context.beginPath();
    context.moveTo(x + 0.5, laneBottom);
    context.lineTo(x + 0.5, laneBottom + 4);
    context.stroke();
    context.fillStyle = '#64748b';
    const label = tickStep < 1 ? `${time.toFixed(1)}s` : formatClock(time).replace(/\.\d$/, '');
    context.fillText(label, clamp(x, 22, width - 22), cssHeight - 7);
  }

  updateTimelinePlayhead();
}

/* ------------------------------------------------------------------ */
/* Offline mix rendering                                              */
/* ------------------------------------------------------------------ */

function scheduleTrackGain(param, segment, base) {
  const duration = segment.track.duration;
  if (duration <= 0) return;
  const fadeIn = Math.min(segment.fadeIn, duration);
  const fadeOut = Math.min(segment.fadeOut, duration);

  if (fadeIn > 0 && fadeOut > 0 && fadeIn + fadeOut >= duration - 1e-6) {
    const points = 257;
    const curve = new Float32Array(points);
    for (let index = 0; index < points; index += 1) {
      const time = (index / (points - 1)) * duration;
      let envelope = 1;
      if (time < fadeIn) envelope *= Math.sin((time / fadeIn) * Math.PI / 2);
      const fadeStart = duration - fadeOut;
      if (time > fadeStart) envelope *= Math.cos(((time - fadeStart) / fadeOut) * Math.PI / 2);
      curve[index] = base * envelope;
    }
    param.setValueCurveAtTime(curve, segment.start, duration);
    return;
  }

  if (fadeIn > 0) {
    const points = 65;
    const curve = new Float32Array(points);
    for (let index = 0; index < points; index += 1) {
      curve[index] = base * Math.sin((index / (points - 1)) * Math.PI / 2);
    }
    param.setValueCurveAtTime(curve, segment.start, fadeIn);
  } else {
    param.setValueAtTime(base, segment.start);
  }

  if (fadeOut > 0) {
    const points = 65;
    const curve = new Float32Array(points);
    for (let index = 0; index < points; index += 1) {
      curve[index] = base * Math.cos((index / (points - 1)) * Math.PI / 2);
    }
    const fadeStart = segment.start + duration - fadeOut;
    param.setValueAtTime(base, fadeStart);
    param.setValueCurveAtTime(curve, fadeStart, fadeOut);
  }
}

async function applyPeakSafety(buffer, onProgress) {
  const channels = [];
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index));
  }
  let peak = 0;
  const chunk = 262144;
  for (let channel = 0; channel < channels.length; channel += 1) {
    const data = channels[channel];
    for (let offset = 0; offset < data.length; offset += chunk) {
      const end = Math.min(data.length, offset + chunk);
      for (let sample = offset; sample < end; sample += 1) {
        const abs = Math.abs(data[sample]);
        if (abs > peak) peak = abs;
      }
      if (onProgress && channel === 0) {
        onProgress(0.5 + (end / data.length) * 0.06, 'Measuring the finished mix...');
      }
      await yieldToLoop();
    }
  }

  let scale = 1;
  if (peak > 0.99) {
    scale = 0.99 / peak;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const data = channels[channel];
      for (let offset = 0; offset < data.length; offset += chunk) {
        const end = Math.min(data.length, offset + chunk);
        for (let sample = offset; sample < end; sample += 1) {
          data[sample] *= scale;
        }
        if (onProgress) {
          onProgress(0.56 + (end / data.length) * 0.06, 'Applying peak safety...');
        }
        await yieldToLoop();
      }
    }
  }
  if (onProgress) onProgress(0.62, 'Mix ready.');
  return { originalPeak: peak, scale };
}

async function renderSequence(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const version = options.version;
  const layout = buildLayout();
  if (!layout.segments.length) throw new Error('Add audio files before rendering a mix.');
  if (layout.totalDuration <= 0) throw new Error('The sequence is empty.');
  const rate = resolveOutputRate();
  const channels = resolveChannels();
  const frames = Math.max(1, Math.ceil(layout.totalDuration * rate));
  if (frames > 2147480000) {
    throw new Error('This sequence is too long for the browser audio renderer. Remove a track or use a lower sample rate.');
  }

  if (onProgress) onProgress(0.05, `Mixing ${state.tracks.length} tracks at ${formatSampleRate(rate)}...`);
  let context;
  try {
    context = new OfflineCtor(channels, frames, rate);
  } catch (error) {
    throw new Error(`This browser cannot render a ${formatSampleRate(rate)} ${channelLabel(channels).toLowerCase()} mix. Try another sample rate or WAV output.`);
  }

  const balance = computeBalanceGains();
  for (const segment of layout.segments) {
    const track = segment.track;
    if (track.muted) continue;
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    const gain = context.createGain();
    const base = track.volume * (balance.get(track.id) || 1);
    scheduleTrackGain(gain.gain, segment, base);
    source.connect(gain);
    gain.connect(context.destination);
    try {
      source.start(segment.start, 0, track.duration);
    } catch (error) {
      throw new Error(`The track "${track.name}" could not be scheduled in the mix. Try removing or replacing it.`);
    }
  }

  if (onProgress) onProgress(0.16, 'Rendering the full sequence...');
  let buffer;
  try {
    buffer = await context.startRendering();
  } catch (error) {
    throw new Error('The browser could not render the full mix. The sequence may be too long for available memory.');
  }
  if (version !== undefined && version !== state.mixVersion) throw new Error('cancelled');
  const safety = await applyPeakSafety(buffer, onProgress);
  if (version !== undefined && version !== state.mixVersion) throw new Error('cancelled');
  return {
    buffer,
    rate,
    channels,
    duration: buffer.duration,
    layoutDuration: layout.totalDuration,
    originalPeak: safety.originalPeak,
    safetyScale: safety.scale,
    balanceGains: Object.fromEntries(balance)
  };
}

async function ensureRendered(onProgress) {
  flushPendingInvalidation();
  const key = mixKey();
  if (state.rendered && state.rendered.key === key) {
    state.previewDirty = false;
    updatePreviewBadge();
    return state.rendered;
  }
  if (state.renderPromise && state.renderPromise.key === key) {
    return state.renderPromise.promise;
  }

  const version = state.mixVersion;
  let promise;
  promise = (async () => {
    const rendered = await renderSequence({ onProgress, version });
    if (version !== state.mixVersion) throw new Error('cancelled');
    const record = { ...rendered, key };
    state.rendered = record;
    state.previewDirty = false;
    state.lastSafety = { peak: record.originalPeak, scale: record.safetyScale };
    updatePreviewBadge();
    drawTimeline(record.buffer);
    updateSummary();
    refreshExportState();
    return record;
  })();

  state.renderPromise = { key, promise };
  try {
    return await promise;
  } finally {
    if (state.renderPromise && state.renderPromise.promise === promise) {
      state.renderPromise = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shared audio context and preview playback                          */
/* ------------------------------------------------------------------ */

function getAudioContext() {
  if (!caps.audio) throw new Error('The Web Audio API is not available in this browser.');
  if (!state.audioCtx) {
    state.audioCtx = new AudioCtor();
    state.seqGain = state.audioCtx.createGain();
    state.seqGain.gain.value = state.seqVolume;
    state.seqGain.connect(state.audioCtx.destination);
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

function stopSequenceSource() {
  const source = state.seqSource;
  state.seqSource = null;
  if (!source) return;
  source.onended = null;
  try { source.stop(); } catch (error) { /* already stopped */ }
  try { source.disconnect(); } catch (error) { /* already disconnected */ }
}

function stopSequenceTicker() {
  if (state.seqRaf) {
    cancelAnimationFrame(state.seqRaf);
    state.seqRaf = 0;
  }
}

function sequencePosition() {
  if (!state.seqPlaying || !state.audioCtx || !state.rendered) return state.seqPlayhead;
  const elapsed = Math.max(0, state.audioCtx.currentTime - state.seqStartedAt);
  return clamp(state.seqStartOffset + elapsed, 0, state.rendered.layoutDuration);
}

function startSequenceTicker() {
  stopSequenceTicker();
  const tick = () => {
    if (!state.seqPlaying) return;
    state.seqPlayhead = sequencePosition();
    updateSeqUi();
    state.seqRaf = requestAnimationFrame(tick);
  };
  state.seqRaf = requestAnimationFrame(tick);
}

function startSequenceAt(offset) {
  if (!state.rendered) return;
  const rendered = state.rendered;
  const context = getAudioContext();
  let position = clamp(Number(offset) || 0, 0, rendered.layoutDuration);
  if (position >= rendered.buffer.duration - 0.001) position = 0;
  stopSequenceSource();
  const source = context.createBufferSource();
  source.buffer = rendered.buffer;
  source.connect(state.seqGain);
  state.seqSource = source;
  state.seqPlaying = true;
  state.seqStartedAt = context.currentTime;
  state.seqStartOffset = position;
  state.seqPlayhead = position;
  source.onended = () => {
    if (state.seqSource !== source) return;
    state.seqSource = null;
    state.seqPlaying = false;
    stopSequenceTicker();
    state.seqPlayhead = rendered.layoutDuration;
    updateSeqUi();
    setPlayStatus('Reached the end of the merged sequence.');
  };
  try {
    source.start(0, position);
  } catch (error) {
    state.seqSource = null;
    state.seqPlaying = false;
    setPlayStatus('The sequence preview could not start. Try pressing play again.');
    updateSeqButton();
    return;
  }
  startSequenceTicker();
  updateSeqUi();
  setPlayStatus(`Playing the merged sequence from ${formatPrecise(position)}.`);
}

function pauseSequence() {
  if (!state.seqPlaying) return;
  const position = sequencePosition();
  stopSequenceSource();
  state.seqPlaying = false;
  state.seqPlayhead = position;
  stopSequenceTicker();
  updateSeqUi();
  setPlayStatus(`Paused at ${formatPrecise(position)}.`);
}

async function prepareAndPlaySequence() {
  if (state.seqPreparing) {
    setPlayStatus('Still preparing the full mix. Playback starts when rendering finishes.');
    return;
  }
  if (state.tracks.length < 2 || state.loading || state.exporting) return;
  const token = ++state.seqRequestToken;
  state.seqPreparing = true;
  try {
    const context = getAudioContext();
    if (context.state === 'suspended') {
      try { await context.resume(); } catch (error) { /* a later gesture may resume */ }
    }
    const layout = buildLayout();
    if (state.seqPlayhead >= layout.totalDuration - 0.001) state.seqPlayhead = 0;
    setPlayStatus('Preparing the full mix. Gaps, crossfades and volume are included...');
    const rendered = await ensureRendered((value, label) => {
      if (token === state.seqRequestToken) {
        setPlayStatus(label || 'Preparing the full mix...');
      }
    });
    if (token !== state.seqRequestToken) return;
    state.seqPreparing = false;
    startSequenceAt(state.seqPlayhead);
  } catch (error) {
    state.seqPreparing = false;
    if (token !== state.seqRequestToken) return;
    if (error && error.message === 'cancelled') return;
    showError(error && error.message ? error.message : 'The full-sequence preview could not be rendered.');
    setPlayStatus('The preview could not be rendered. The tracks are still loaded.');
  }
}

function toggleSequencePlay() {
  if (state.seqPlaying) {
    pauseSequence();
  } else {
    prepareAndPlaySequence();
  }
}

async function seekSequence(seconds) {
  if (!state.tracks.length) return;
  const layout = buildLayout();
  const wasPlaying = state.seqPlaying;
  const position = clamp(Number(seconds) || 0, 0, layout.totalDuration);
  stopSequenceSource();
  state.seqPlaying = false;
  state.seqPlayhead = position;
  stopSequenceTicker();
  updateSeqUi();
  if (wasPlaying) {
    await prepareAndPlaySequence();
  } else {
    setPlayStatus(`Positioned at ${formatPrecise(position)}. Press play to hear the full mix.`);
  }
}

function restartSequence() {
  if (!state.tracks.length) return;
  const wasPlaying = state.seqPlaying;
  stopSequenceSource();
  state.seqPlaying = false;
  state.seqPlayhead = 0;
  stopSequenceTicker();
  updateSeqUi();
  if (wasPlaying) {
    prepareAndPlaySequence();
  } else {
    setPlayStatus('Sequence playhead reset to the start.');
  }
}

function stopTrackPreview() {
  const source = state.trackSource;
  const previousId = state.previewTrackId;
  state.trackSource = null;
  state.trackPreviewGain = null;
  state.previewTrackId = null;
  state.trackPreviewPlaying = false;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch (error) { /* already stopped */ }
    try { source.disconnect(); } catch (error) { /* already disconnected */ }
  }
  if (previousId) updateTrackPreviewUi(previousId);
}

function updateTrackPreviewUi(trackId) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  const card = els.trackList.querySelector(`[data-track-id="${trackId}"]`);
  if (!card) return;
  const button = card.querySelector('[data-preview-track]');
  if (!button) return;
  const playing = state.previewTrackId === trackId && state.trackPreviewPlaying;
  const label = playing ? `Pause preview of ${track.name}` : `Preview ${track.name}`;
  button.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(playing));
  button.setAttribute('title', label);
  card.classList.toggle('is-previewing', playing);
}

function toggleTrackPreview(trackId) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  if (state.previewTrackId === trackId && state.trackPreviewPlaying) {
    stopTrackPreview();
    setPlayStatus('Track preview stopped.');
    return;
  }
  stopTrackPreview();
  if (state.seqPlaying) {
    stopSequenceSource();
    state.seqPlaying = false;
    stopSequenceTicker();
    updateSeqButton();
  }
  let context;
  try {
    context = getAudioContext();
  } catch (error) {
    showError(error.message);
    return;
  }
  const source = context.createBufferSource();
  source.buffer = track.buffer;
  const gain = context.createGain();
  gain.gain.value = track.muted ? 0 : track.volume;
  source.connect(gain);
  gain.connect(context.destination);
  state.trackSource = source;
  state.trackPreviewGain = gain;
  state.previewTrackId = trackId;
  state.trackPreviewPlaying = true;
  source.onended = () => {
    if (state.trackSource !== source) return;
    state.trackSource = null;
    state.trackPreviewGain = null;
    state.previewTrackId = null;
    state.trackPreviewPlaying = false;
    updateTrackPreviewUi(trackId);
    setPlayStatus(`Track preview finished: ${track.name}.`);
  };
  try {
    source.start(0);
  } catch (error) {
    stopTrackPreview();
    showError('This browser could not preview the track. You can still merge and export.');
    return;
  }
  updateTrackPreviewUi(trackId);
  setPlayStatus(
    track.muted
      ? `Previewing ${track.name} at its current mute setting (silent).`
      : `Previewing ${track.name} at ${Math.round(track.volume * 100)}% volume.`
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function createWorker() {
  return new Worker(new URL('./audio-merger-worker.js', import.meta.url), { type: 'module' });
}

async function probeMp3() {
  if (!caps.worker) {
    state.mp3Probed = true;
    state.mp3ProbeOk = false;
    updateFormatUi();
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
    state.mp3ProbeOk = ok;
  } catch (error) {
    state.mp3ProbeOk = false;
  } finally {
    if (worker) worker.terminate();
    state.mp3Probed = true;
    updateFormatUi();
  }
}

function setExportingUi(exporting) {
  state.exporting = exporting;
  els.exportButton.hidden = exporting;
  els.cancelExport.hidden = !exporting;
  els.progress.hidden = !exporting;
  refreshExportState();
}

function copyRenderedChannels(buffer) {
  const channels = [];
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(buffer.getChannelData(index).slice(0));
  }
  return channels;
}

async function exportAudio() {
  if (state.exporting || state.loading || state.tracks.length < 2) return;
  const format = els.format.value === 'mp3' ? 'mp3' : 'wav';
  if (format === 'mp3' && !state.mp3Available) {
    showError(state.mp3Reason || 'MP3 export is not available for this output. Choose WAV.');
    return;
  }
  clearError();
  clearTrackError();
  releaseResult();
  const token = ++state.exportToken;
  setExportingUi(true);
  setProgress(0.01, 'Preparing the merged mix...');

  try {
    const rendered = await ensureRendered((value, label) => {
      if (token === state.exportToken) {
        setProgress(0.02 + clamp(value, 0, 1) * 0.58, label || 'Preparing the merged mix...');
      }
    });
    if (token !== state.exportToken) return;
    state.exportRender = rendered;
    const channels = copyRenderedChannels(rendered.buffer);
    if (token !== state.exportToken) return;

    if (!caps.worker) {
      if (format === 'wav') {
        await runWavFallback(channels, rendered, token);
      } else {
        failExport(token, 'MP3 export needs Web Workers. Choose WAV instead.');
      }
      return;
    }

    let worker;
    try {
      worker = createWorker();
    } catch (error) {
      if (format === 'wav') {
        await runWavFallback(channels, rendered, token);
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
        setProgress(0.62 + clamp(message.value, 0, 1) * 0.36, message.label);
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

    setProgress(0.62, format === 'mp3' ? 'Starting the MP3 encoder...' : 'Writing the WAV file...');
    worker.postMessage(
      {
        type: format,
        channels,
        sampleRate: rendered.rate,
        bitrate: Number(els.bitrate.value) * 1000
      },
      channels.map((channel) => channel.buffer)
    );
  } catch (error) {
    if (token !== state.exportToken) return;
    if (error && error.message === 'cancelled') return;
    failExport(token, error && error.message ? error.message : 'The merged audio could not be rendered.');
  }
}

async function runWavFallback(channels, rendered, token) {
  try {
    const frames = channels[0].length;
    const channelCount = channels.length;
    const dataBytes = frames * channelCount * 2;
    if (dataBytes > 0xffffffff - 44) {
      throw new Error('The merged audio is too long for a WAV file. Use fewer or shorter tracks.');
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
    view.setUint32(24, rendered.rate, true);
    view.setUint32(28, rendered.rate * channelCount * 2, true);
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
      setProgress(0.62 + (end / frames) * 0.36, `Writing WAV - ${Math.round((end / frames) * 100)}%`);
      await yieldToLoop();
    }
    finishExport(
      {
        buffer,
        mime: 'audio/wav',
        extension: 'wav',
        duration: frames / rendered.rate,
        formatLabel: 'WAV - 16-bit PCM'
      },
      token
    );
  } catch (error) {
    failExport(token, error && error.message ? error.message : 'The WAV encoder failed. Try a shorter sequence.');
  }
}

function finishExport(message, token) {
  if (token !== state.exportToken) return;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  const rendered = state.exportRender || state.rendered;
  try {
    const blob = new Blob([message.buffer], { type: message.mime });
    if (!blob.size) throw new Error('empty output');
    releaseResult();
    const url = URL.createObjectURL(blob);
    const result = {
      blob,
      url,
      name: `letitedit-merged-audio.${message.extension}`,
      mime: message.mime,
      extension: message.extension,
      duration: Number(message.duration) || (rendered ? rendered.duration : 0),
      formatLabel: message.formatLabel,
      sampleRate: rendered ? rendered.rate : resolveOutputRate(),
      channels: rendered ? rendered.channels : resolveChannels(),
      tracks: state.tracks.length,
      safetyScale: rendered ? rendered.safetyScale : 1,
      originalPeak: rendered ? rendered.originalPeak : 0
    };
    state.result = result;
    state.resultUrl = url;
    state.exporting = false;
    state.exportRender = null;
    setExportingUi(false);
    els.progress.hidden = true;
    showResult(result);
  } catch (error) {
    failExport(token, 'The encoded file could not be created. Try a shorter sequence or a different format.');
  }
}

function failExport(token, message) {
  if (token !== state.exportToken) return;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  state.exporting = false;
  state.exportRender = null;
  setExportingUi(false);
  els.progress.hidden = true;
  showError(message);
  setStatus('Export stopped. The tracks and settings are still available.');
}

function cancelExport() {
  if (!state.exporting) return;
  state.exportToken += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  state.exporting = false;
  state.exportRender = null;
  setExportingUi(false);
  els.progress.hidden = true;
  setStatus('Export cancelled. The merged mix was not downloaded.');
}

function showResult(result) {
  els.result.hidden = false;
  els.resultName.textContent = result.name;
  els.resultFormat.textContent = result.formatLabel;
  els.resultDuration.textContent = formatPrecise(result.duration);
  els.resultSize.textContent = formatBytes(result.blob.size);
  els.resultRate.textContent = formatSampleRate(result.sampleRate);
  els.resultChannels.textContent = channelLabel(result.channels);
  els.resultTracks.textContent = String(result.tracks);
  els.resultSafety.textContent = result.safetyScale < 0.9999
    ? `Scaled ${(20 * Math.log10(result.safetyScale)).toFixed(1)} dB`
    : 'Not needed';
  els.resultNote.textContent = result.extension === 'mp3'
    ? 'Created locally as a lossy MP3. MP3 adds a short amount of encoder padding, so its playing time can differ slightly from the arranged duration.'
    : `Created locally as uncompressed 16-bit PCM at ${formatSampleRate(result.sampleRate)} in ${channelLabel(result.channels).toLowerCase()}.`;
  els.resultAudio.src = result.url;
  els.resultAudio.load();
  els.download.href = result.url;
  els.download.download = result.name;
  els.download.setAttribute('aria-disabled', 'false');
  setStatus(`Merged audio ready: ${result.name}. The download is a local blob.`);
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

function exportAgain() {
  releaseResult();
  setStatus('Result closed. Change the arrangement or settings, then export again.');
  els.editor.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------------ */
/* Controls state                                                     */
/* ------------------------------------------------------------------ */

function refreshExportState() {
  const busy = state.loading || state.exporting;
  const canExport = state.tracks.length >= 2 && !busy &&
    !(els.format.value === 'mp3' && !state.mp3Available);
  els.exportButton.disabled = !canExport;
  els.seqPlay.disabled = state.tracks.length < 2 || busy;
  els.seqRestart.disabled = state.tracks.length < 2 || busy;
  els.seqSeek.disabled = state.tracks.length < 2 || busy;
  els.format.disabled = busy || !state.tracks.length;
  els.bitrate.disabled = busy || !state.tracks.length;
  els.rate.disabled = busy || !state.tracks.length;
  els.channels.disabled = busy || !state.tracks.length;
  els.balance.disabled = busy || !state.tracks.length;
  els.addMore.disabled = busy;
  els.clearAll.disabled = busy;
  els.fileInput.disabled = busy;
  els.browse.disabled = busy;
}

/* ------------------------------------------------------------------ */
/* Adding, replacing and removing tracks                              */
/* ------------------------------------------------------------------ */

function renderAll(options = {}) {
  const hasTracks = state.tracks.length > 0;
  els.empty.hidden = hasTracks;
  els.editor.hidden = !hasTracks;
  renderTracks(options);
  renderTransitions();
  updateSummary();
  updateFormatUi();
  updatePreviewBadge();
  drawTimeline(state.rendered ? state.rendered.buffer : null);
  refreshExportState();
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  if (state.loading || state.exporting) {
    showError('Wait for the current audio operation to finish before adding more files.');
    return;
  }
  clearError();
  clearTrackError();
  if (state.tracks.length >= MAX_FILES) {
    showError(`The limit is ${MAX_FILES} tracks. Remove a track before adding another.`);
    return;
  }

  const token = ++state.addToken;
  state.loading = true;
  setLoading(true, `Preparing ${files.length} file${files.length === 1 ? '' : 's'}...`);
  const errors = [];
  let added = 0;

  for (let index = 0; index < files.length; index += 1) {
    if (token !== state.addToken) return;
    const file = files[index];
    if (state.tracks.length >= MAX_FILES) {
      errors.push(`Only ${MAX_FILES} tracks can be loaded. "${file.name}" was not added.`);
      continue;
    }
    if (!isProbablyAudio(file)) {
      errors.push(`"${file.name}" is not an audio file. Choose MP3, WAV, M4A, AAC, OGG, FLAC or WebM.`);
      continue;
    }
    if (!file.size) {
      errors.push(`"${file.name}" is empty. Choose a file with actual sound in it.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`"${file.name}" is ${formatBytes(file.size)}, larger than the 500 MB per-file limit.`);
      continue;
    }
    if (totalInputBytes() + file.size > MAX_TOTAL_BYTES) {
      errors.push(`"${file.name}" would push the input over the 1 GB total limit. Remove a track or choose a smaller file.`);
      continue;
    }

    try {
      setLoadingText(`Reading ${file.name} (${index + 1} of ${files.length})...`);
      const track = await decodeTrack(file, token);
      if (!track) return;
      if (totalTrackDuration() + track.duration > MAX_TOTAL_DURATION + 1e-6) {
        errors.push(`"${file.name}" was skipped because the combined decoded audio would exceed 30 minutes.`);
        continue;
      }
      state.tracks.push(track);
      added += 1;
      setStatus(`Added ${file.name}. ${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'} loaded.`);
    } catch (error) {
      errors.push(decodeErrorMessage(file, error));
    }
  }

  if (token !== state.addToken) return;
  state.loading = false;
  setLoading(false);
  invalidateMix();
  renderAll();
  if (added) {
    setStatus(`Added ${added} track${added === 1 ? '' : 's'}. Arrange the order, then set each transition.`);
    setPlayStatus('Tracks loaded. Press play to render and hear the full sequence.');
  }
  if (errors.length) {
    showError(errors.join(' '));
  }
  els.fileInput.value = '';
}

function beginReplace(trackId) {
  if (state.loading || state.exporting) {
    showTrackError('Wait for the current operation to finish before replacing a track.');
    return;
  }
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  clearTrackError();
  state.replaceTarget = trackId;
  els.fileInput.multiple = true;
  els.fileInput.click();
}

async function replaceTrack(trackId, file) {
  const existing = state.tracks.find((item) => item.id === trackId);
  if (!existing) return;
  clearError();
  clearTrackError();
  if (!isProbablyAudio(file)) {
    showTrackError(`"${file.name}" is not an audio file. The previous track was kept.`);
    return;
  }
  if (!file.size) {
    showTrackError(`"${file.name}" is empty. The previous track was kept.`);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showTrackError(`"${file.name}" is larger than the 500 MB per-file limit. The previous track was kept.`);
    return;
  }
  if (totalInputBytes() - existing.size + file.size > MAX_TOTAL_BYTES) {
    showTrackError('The replacement would push the input over the 1 GB total limit. The previous track was kept.');
    return;
  }

  const token = ++state.addToken;
  state.loading = true;
  setLoading(true, `Replacing ${existing.name} with ${file.name}...`);
  try {
    const replacement = await decodeTrack(file, token);
    if (!replacement) return;
    if (totalTrackDuration() - existing.duration + replacement.duration > MAX_TOTAL_DURATION + 1e-6) {
      throw new Error('the replacement would make the combined decoded audio longer than 30 minutes');
    }
    replacement.id = existing.id;
    replacement.volume = existing.volume;
    replacement.muted = existing.muted;
    const index = state.tracks.indexOf(existing);
    if (index < 0) return;
    state.tracks[index] = replacement;
    if (state.previewTrackId === existing.id) stopTrackPreview();
    state.loading = false;
    setLoading(false);
    invalidateMix();
    renderAll({ focusId: replacement.id, focusAction: 'handle' });
    setStatus(`Replaced the track with ${file.name}.`);
    setPlayStatus('Track replaced. The preview will be rebuilt when you play the sequence.');
  } catch (error) {
    state.loading = false;
    setLoading(false);
    renderAll();
    showTrackError(`${decodeErrorMessage(file, error)} The previous track was kept.`);
  } finally {
    els.fileInput.value = '';
  }
}

function removeTrack(trackId) {
  if (state.loading || state.exporting) {
    showTrackError('Wait for the current operation to finish before removing a track.');
    return;
  }
  const index = state.tracks.findIndex((item) => item.id === trackId);
  if (index < 0) return;
  const [removed] = state.tracks.splice(index, 1);
  if (state.previewTrackId === trackId) stopTrackPreview();
  for (const key of Array.from(state.transitions.keys())) {
    const [fromId, toId] = key.split('|');
    if (fromId === trackId || toId === trackId) state.transitions.delete(key);
  }
  invalidateMix();
  const next = state.tracks[Math.min(index, state.tracks.length - 1)];
  renderAll(next ? { focusId: next.id, focusAction: 'handle' } : {});
  clearTrackError();
  setStatus(`Removed ${removed.name}. ${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'} remain.`);
  if (!state.tracks.length) {
    setPlayStatus('Add at least two audio files to build a sequence.');
    requestAnimationFrame(() => els.browse.focus());
  }
}

function clearAll() {
  if (state.loading || state.exporting) {
    showError('Wait for the current operation to finish before clearing the tracks.');
    return;
  }
  if (invalidateFrame) {
    cancelAnimationFrame(invalidateFrame);
    invalidateFrame = 0;
  }
  state.replaceTarget = null;
  state.addToken += 1;
  state.exportToken += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  releaseResult();
  stopTrackPreview();
  stopSequenceSource();
  state.seqPlaying = false;
  state.seqPreparing = false;
  stopSequenceTicker();
  state.seqPlayhead = 0;
  state.tracks = [];
  state.transitions.clear();
  state.nextTrackId = 0;
  state.mixVersion += 1;
  state.rendered = null;
  state.renderPromise = null;
  state.previewDirty = true;
  state.lastSafety = null;
  state.exportRender = null;
  if (state.audioCtx) {
    try { state.audioCtx.close(); } catch (error) { /* already closed */ }
  }
  state.audioCtx = null;
  state.seqGain = null;
  state.trackPreviewGain = null;
  state.loading = false;
  state.exporting = false;
  clearError();
  clearTrackError();
  setTransitionStatus('');
  setLoading(false);
  renderAll();
  updateVolumeUi();
  setPlayStatus('Add at least two audio files to build a sequence.');
  setStatus('All tracks cleared. The decoded audio and result were released.');
  els.fileInput.value = '';
  els.fileInput.multiple = true;
}

/* ------------------------------------------------------------------ */
/* Reordering                                                         */
/* ------------------------------------------------------------------ */

function moveTrack(trackId, delta) {
  if (state.loading || state.exporting) return;
  const index = state.tracks.findIndex((item) => item.id === trackId);
  if (index < 0) return;
  const target = clamp(index + delta, 0, state.tracks.length - 1);
  if (target === index) return;
  const [track] = state.tracks.splice(index, 1);
  state.tracks.splice(target, 0, track);
  invalidateMix();
  renderAll({ focusId: trackId, focusAction: delta < 0 ? 'up' : 'down' });
  setStatus(`Moved ${track.name} to position ${target + 1}.`);
}

function reorderTrack(trackId, targetId, position) {
  if (state.loading || state.exporting) return;
  if (!trackId || !targetId || trackId === targetId) return;
  const fromIndex = state.tracks.findIndex((item) => item.id === trackId);
  const targetIndex = state.tracks.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || targetIndex < 0) return;
  const [track] = state.tracks.splice(fromIndex, 1);
  let insertAt = state.tracks.findIndex((item) => item.id === targetId);
  if (position === 'after') insertAt += 1;
  state.tracks.splice(insertAt, 0, track);
  invalidateMix();
  renderAll({ focusId: trackId, focusAction: 'handle' });
  setStatus(`Moved ${track.name} to position ${state.tracks.indexOf(track) + 1}.`);
}

function clearDropMarkers() {
  els.trackList.querySelectorAll('.is-drop-before, .is-drop-after, .is-dragging').forEach((card) => {
    card.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging');
  });
}

function finishDragUi() {
  clearDropMarkers();
  els.page.classList.remove('is-reordering');
  state.dragTrackId = null;
  state.dropTargetId = null;
  state.dropPosition = null;
  state.pointerDrag = null;
}

function updateDropTarget(clientY) {
  const cards = Array.from(els.trackList.querySelectorAll('.amg-track'))
    .filter((card) => card.dataset.trackId !== state.dragTrackId);
  if (!cards.length) {
    clearDropMarkers();
    state.dropTargetId = null;
    return;
  }
  let target = null;
  let after = false;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      target = card;
      after = clientY > rect.top + rect.height / 2;
      break;
    }
  }
  if (!target) {
    const first = cards[0];
    const last = cards[cards.length - 1];
    if (clientY < first.getBoundingClientRect().top) {
      target = first;
      after = false;
    } else {
      target = last;
      after = true;
    }
  }
  clearDropMarkers();
  target.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  state.dropTargetId = target.dataset.trackId;
  state.dropPosition = after ? 'after' : 'before';
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                       */
/* ------------------------------------------------------------------ */

function trackById(trackId) {
  return state.tracks.find((track) => track.id === trackId) || null;
}

function transitionRowTargets(row) {
  if (!row) return null;
  const from = trackById(row.dataset.fromId);
  const to = trackById(row.dataset.toId);
  if (!from || !to) return null;
  return { from, to };
}

function focusTransitionControl(fromId, toId, selector) {
  requestAnimationFrame(() => {
    const row = els.transitions.querySelector(`[data-from-id="${fromId}"][data-to-id="${toId}"]`);
    const control = row
      ? row.querySelector(selector || '[data-custom-duration]') || row.querySelector('[data-custom-duration]')
      : null;
    if (control && !control.disabled) control.focus();
  });
}

function setTransitionDuration(from, to, requested, sourceLabel, focusPreset) {
  const transition = getTransition(from, to);
  transition.duration = Number.isFinite(requested) ? requested : 0;
  normalizeTransition(transition, from, to);
  const applied = transition.duration;
  invalidateMix();
  renderTransitions();
  focusTransitionControl(
    from.id,
    to.id,
    focusPreset === undefined ? '[data-custom-duration]' : `[data-preset-duration="${focusPreset}"]`
  );
  if (Math.abs(applied - requested) > 1e-6) {
    setTransitionStatus(
      `${sourceLabel} was limited to ${formatSecondsShort(applied)} s by the available audio ` +
      `or the ${transition.mode === 'crossfade' ? 'crossfade' : 'gap'} limit.`
    );
  } else {
    setTransitionStatus(
      `${sourceLabel} set to ${formatSecondsShort(applied)} s ` +
      `(${transition.mode === 'crossfade' ? 'equal-power crossfade' : 'silence gap'}).`
    );
  }
}

function wireFilePicking() {
  const openPicker = () => {
    state.replaceTarget = null;
    els.fileInput.multiple = true;
    els.fileInput.click();
  };
  els.browse.addEventListener('click', openPicker);
  els.addMore.addEventListener('click', openPicker);
  els.fileInput.addEventListener('change', () => {
    const files = Array.from(els.fileInput.files || []);
    els.fileInput.value = '';
    const replaceTarget = state.replaceTarget;
    state.replaceTarget = null;
    if (replaceTarget) {
      if (files[0]) replaceTrack(replaceTarget, files[0]);
      return;
    }
    if (files.length) addFiles(files);
  });
}

function wireDropZone() {
  const showDrop = () => {
    els.dropzone.classList.add('is-dragover');
    els.app.classList.add('is-dragover');
  };
  const hideDrop = () => {
    els.dropzone.classList.remove('is-dragover');
    els.app.classList.remove('is-dragover');
  };
  els.app.addEventListener('dragenter', (event) => {
    if (state.dragTrackId) return;
    const types = Array.from(event.dataTransfer ? event.dataTransfer.types || [] : []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    showDrop();
  });
  els.app.addEventListener('dragover', (event) => {
    if (state.dragTrackId) return;
    const types = Array.from(event.dataTransfer ? event.dataTransfer.types || [] : []);
    if (!types.includes('Files')) return;
    event.preventDefault();
    showDrop();
  });
  els.app.addEventListener('dragleave', (event) => {
    const next = event.relatedTarget;
    if (next && els.app.contains(next)) return;
    hideDrop();
  });
  els.app.addEventListener('drop', (event) => {
    if (state.dragTrackId) return;
    if (!event.dataTransfer) return;
    event.preventDefault();
    hideDrop();
    state.replaceTarget = null;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) addFiles(files);
  });
}

function wireTrackList() {
  els.trackList.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const card = button.closest('[data-track-id]');
    if (!card) return;
    const trackId = card.dataset.trackId;
    const track = trackById(trackId);
    if (!track) return;

    if (button.matches('[data-preview-track]')) {
      toggleTrackPreview(trackId);
      return;
    }
    if (button.matches('[data-mute]')) {
      if (state.loading || state.exporting) return;
      track.muted = !track.muted;
      card.dataset.muted = String(track.muted);
      button.setAttribute('aria-pressed', String(track.muted));
      button.textContent = track.muted ? 'Unmute' : 'Mute';
      if (state.previewTrackId === trackId && state.trackPreviewGain) {
        state.trackPreviewGain.gain.value = track.muted ? 0 : track.volume;
      }
      invalidateMix();
      setStatus(`${track.name} is now ${track.muted ? 'muted' : 'unmuted'}.`);
      return;
    }
    if (button.matches('[data-reset-volume]')) {
      if (state.loading || state.exporting) return;
      track.volume = 1;
      const input = card.querySelector('[data-track-volume]');
      const output = card.querySelector('[data-volume-out]');
      if (input) {
        input.value = '1';
        input.style.setProperty('--amg-progress', `${(1 / 1.5) * 100}%`);
      }
      if (output) output.textContent = '100%';
      if (state.previewTrackId === trackId && state.trackPreviewGain) {
        state.trackPreviewGain.gain.value = track.muted ? 0 : 1;
      }
      invalidateMix();
      setStatus(`${track.name} volume reset to 100%.`);
      return;
    }
    if (button.matches('[data-move-up]')) {
      moveTrack(trackId, -1);
      return;
    }
    if (button.matches('[data-move-down]')) {
      moveTrack(trackId, 1);
      return;
    }
    if (button.matches('[data-replace]')) {
      beginReplace(trackId);
      return;
    }
    if (button.matches('[data-remove]')) {
      removeTrack(trackId);
    }
  });

  els.trackList.addEventListener('input', (event) => {
    const input = event.target.closest('[data-track-volume]');
    if (!input) return;
    if (state.loading || state.exporting) return;
    const card = input.closest('[data-track-id]');
    const track = card ? trackById(card.dataset.trackId) : null;
    if (!track) return;
    track.volume = clamp(Number(input.value), 0, 1.5);
    input.style.setProperty('--amg-progress', `${(track.volume / 1.5) * 100}%`);
    const output = card.querySelector('[data-volume-out]');
    if (output) output.textContent = `${Math.round(track.volume * 100)}%`;
    if (state.previewTrackId === track.id && state.trackPreviewGain) {
      state.trackPreviewGain.gain.value = track.muted ? 0 : track.volume;
    }
    invalidateMixSoon();
  });

  els.trackList.addEventListener('keydown', (event) => {
    const handle = event.target.closest('[data-drag]');
    if (!handle) return;
    const card = handle.closest('[data-track-id]');
    if (!card) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTrack(card.dataset.trackId, event.key === 'ArrowUp' ? -1 : 1);
    }
  });

  els.trackList.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('[data-drag]');
    if (!handle) {
      event.preventDefault();
      return;
    }
    const card = handle.closest('[data-track-id]');
    if (!card) return;
    state.dragTrackId = card.dataset.trackId;
    card.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData(DRAG_MIME, state.dragTrackId);
        event.dataTransfer.setData('text/plain', state.dragTrackId);
      } catch (error) { /* some browsers restrict custom data */ }
    }
  });

  els.trackList.addEventListener('dragover', (event) => {
    if (!state.dragTrackId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    updateDropTarget(event.clientY);
  });

  els.trackList.addEventListener('drop', (event) => {
    if (!state.dragTrackId) return;
    event.preventDefault();
    event.stopPropagation();
    const trackId = state.dragTrackId;
    const targetId = state.dropTargetId;
    const position = state.dropPosition;
    finishDragUi();
    if (targetId) reorderTrack(trackId, targetId, position);
  });

  els.trackList.addEventListener('dragend', finishDragUi);

  els.trackList.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-drag]');
    if (!handle) return;
    if (event.button !== undefined && event.button !== 0) return;
    const card = handle.closest('[data-track-id]');
    if (!card) return;
    const drag = {
      pointerId: event.pointerId,
      id: card.dataset.trackId,
      startY: event.clientY,
      startX: event.clientX,
      active: false,
      handle
    };
    state.pointerDrag = drag;
    try { handle.setPointerCapture(event.pointerId); } catch (error) { /* synthetic pointers */ }
  });
}

function wirePointerReorder() {
  window.addEventListener('pointermove', (event) => {
    const drag = state.pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const dy = Math.abs(event.clientY - drag.startY);
      const dx = Math.abs(event.clientX - drag.startX);
      if (dy < 6 && dx < 6) return;
      drag.active = true;
      state.dragTrackId = drag.id;
      els.page.classList.add('is-reordering');
      const card = els.trackList.querySelector(`[data-track-id="${drag.id}"]`);
      if (card) card.classList.add('is-dragging');
    }
    event.preventDefault();
    updateDropTarget(event.clientY);
  }, { passive: false });

  const finish = (event) => {
    const drag = state.pointerDrag;
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const active = drag.active;
    const trackId = drag.id;
    const targetId = state.dropTargetId;
    const position = state.dropPosition;
    finishDragUi();
    if (active && targetId) reorderTrack(trackId, targetId, position);
  };
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

function wireTransitions() {
  els.transitions.addEventListener('change', (event) => {
    if (state.loading || state.exporting) return;
    const row = event.target.closest('[data-transition-row]');
    const targets = transitionRowTargets(row);
    if (!targets) return;
    const { from, to } = targets;
    const transition = getTransition(from, to);
    if (event.target.matches('[data-transition-mode]')) {
      transition.mode = event.target.value === 'crossfade' ? 'crossfade' : 'gap';
      transition.duration = transition.mode === 'crossfade'
        ? Math.min(1, crossfadeMax(from, to))
        : 0;
      normalizeTransition(transition, from, to);
      invalidateMix();
      renderTransitions();
      focusTransitionControl(from.id, to.id, '[data-transition-mode]');
      setTransitionStatus(
        transition.mode === 'crossfade'
          ? `Crossfade enabled at ${formatSecondsShort(transition.duration)} s.`
          : 'Silence gap enabled at zero seconds.'
      );
      return;
    }
    if (event.target.matches('[data-custom-duration]')) {
      const requested = Number(event.target.value);
      if (!Number.isFinite(requested)) {
        renderTransitions();
        focusTransitionControl(from.id, to.id, '[data-custom-duration]');
        setTransitionStatus('Enter a duration in seconds.');
        return;
      }
      setTransitionDuration(from, to, requested, 'Custom duration');
    }
  });

  els.transitions.addEventListener('click', (event) => {
    const preset = event.target.closest('[data-preset-duration]');
    if (!preset || state.loading || state.exporting) return;
    const row = preset.closest('[data-transition-row]');
    const targets = transitionRowTargets(row);
    if (!targets) return;
    const requested = Number(preset.dataset.presetDuration);
    setTransitionDuration(
      targets.from,
      targets.to,
      requested,
      `${formatSecondsShort(requested)} s preset`,
      requested
    );
  });
}

function wireSequence() {
  els.seqPlay.addEventListener('click', toggleSequencePlay);
  els.seqRestart.addEventListener('click', restartSequence);
  els.seqSeek.addEventListener('pointerdown', () => {
    state.seqSeeking = true;
  });
  window.addEventListener('pointerup', () => {
    state.seqSeeking = false;
  });
  els.seqSeek.addEventListener('input', () => {
    const layout = buildLayout();
    seekSequence((Number(els.seqSeek.value) / 1000) * layout.totalDuration);
  });
  els.seqVolume.addEventListener('input', () => {
    state.seqVolume = clamp(Number(els.seqVolume.value), 0, 1);
    if (state.seqGain) state.seqGain.gain.value = state.seqVolume;
    updateVolumeUi();
  });
  els.timeline.addEventListener('click', (event) => {
    const layout = buildLayout();
    if (!layout.totalDuration) return;
    const rect = els.timeline.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    seekSequence(ratio * layout.totalDuration);
  });
}

function wireSettings() {
  els.format.addEventListener('change', () => {
    if (els.format.value === 'mp3' && !state.mp3Available) els.format.value = 'wav';
    updateFormatUi();
  });
  els.bitrate.addEventListener('change', updateExportSummary);
  els.rate.addEventListener('change', () => {
    updateFormatUi();
    invalidateMix(`Output sample rate set to ${formatSampleRate(resolveOutputRate())}.`);
  });
  els.channels.addEventListener('change', () => {
    updateFormatUi();
    invalidateMix(`Output channels set to ${channelLabel(resolveChannels()).toLowerCase()}.`);
  });
  els.balance.addEventListener('change', () => {
    updateSummary();
    invalidateMix(
      els.balance.checked
        ? 'RMS level matching is on. The mix will be rebuilt with measured track gains.'
        : 'RMS level matching is off. Track volumes are used as set.'
    );
  });
}

function wireResult() {
  els.exportButton.addEventListener('click', exportAudio);
  els.cancelExport.addEventListener('click', cancelExport);
  els.exportAgain.addEventListener('click', exportAgain);
  els.startOver.addEventListener('click', clearAll);
  els.clearAll.addEventListener('click', clearAll);
  els.download.addEventListener('click', (event) => {
    if (!state.result) {
      event.preventDefault();
      showError('There is no finished merged file to download yet.');
    }
  });
}

let resizeFrame = 0;

function scheduleResizeRedraw() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    drawTrackWaveforms();
    drawTimeline(state.rendered ? state.rendered.buffer : null);
  });
}

function cleanupPage() {
  if (invalidateFrame) {
    cancelAnimationFrame(invalidateFrame);
    invalidateFrame = 0;
  }
  state.addToken += 1;
  state.exportToken += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  releaseResult();
  stopTrackPreview();
  stopSequenceSource();
  stopSequenceTicker();
  if (state.audioCtx) {
    try { state.audioCtx.close(); } catch (error) { /* already closed */ }
  }
  state.audioCtx = null;
  state.seqGain = null;
  state.rendered = null;
}

function wire() {
  wireFilePicking();
  wireDropZone();
  wireTrackList();
  wirePointerReorder();
  wireTransitions();
  wireSequence();
  wireSettings();
  wireResult();

  window.addEventListener('resize', scheduleResizeRedraw);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(scheduleResizeRedraw);
    observer.observe(els.timelineScroll);
    observer.observe(els.trackList);
  }
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) cleanupPage();
  });
}

/* ------------------------------------------------------------------ */
/* Capability check, debug hook and boot                              */
/* ------------------------------------------------------------------ */

function checkCapabilities() {
  if (caps.audio && caps.offline) {
    els.support.hidden = true;
    return true;
  }
  els.support.hidden = false;
  els.supportText.textContent =
    'This browser does not provide both the Web Audio API and OfflineAudioContext, so it cannot decode, mix or export audio locally. Use a current version of Chrome, Edge, Firefox or Safari.';
  els.browse.disabled = true;
  els.fileInput.disabled = true;
  els.dropzone.classList.add('is-disabled');
  return false;
}

function exposeDebug() {
  window.__AM__ = {
    state: () => (state.tracks.length ? 'ready' : 'empty'),
    debug: () => {
      const layout = buildLayout();
      const rendered = state.rendered;
      return {
        phase: state.tracks.length ? 'ready' : 'empty',
        trackCount: state.tracks.length,
        decodeCount: state.decodeCount,
        tracks: state.tracks.map((track) => ({
          id: track.id,
          name: track.name,
          size: track.size,
          duration: track.duration,
          sampleRate: track.sampleRate,
          sourceRate: track.sourceRate,
          ratePreserved: track.ratePreserved,
          channels: track.channels,
          peaks: track.peaks ? track.peaks.buckets : 0,
          peak: track.peak,
          rms: track.rms,
          volume: track.volume,
          muted: track.muted
        })),
        transitions: layout.transitions.map((item) => ({
          from: item.from.track.id,
          to: item.to.track.id,
          mode: item.transition.mode,
          duration: item.transition.duration,
          start: item.start,
          end: item.end
        })),
        segments: layout.segments.map((segment) => ({
          track: segment.track.id,
          index: segment.index,
          start: segment.start,
          end: segment.end,
          fadeIn: segment.fadeIn,
          fadeOut: segment.fadeOut
        })),
        totalDuration: layout.totalDuration,
        inputBytes: totalInputBytes(),
        outputRate: resolveOutputRate(),
        channels: resolveChannels(),
        balance: Boolean(els.balance.checked),
        format: els.format.value,
        bitrate: els.bitrate.value,
        loading: state.loading,
        exporting: state.exporting,
        progress: Number(els.progressTrack.getAttribute('aria-valuenow')) || 0,
        mp3Probed: state.mp3Probed,
        mp3ProbeOk: state.mp3ProbeOk,
        mp3Available: state.mp3Available,
        mp3Reason: state.mp3Reason,
        mp3OptionDisabled: Boolean(els.format.querySelector('option[value="mp3"]')?.disabled),
        seqPlaying: state.seqPlaying,
        seqPreparing: Boolean(state.seqPreparing),
        seqPlayhead: state.seqPlayhead,
        seqVolume: state.seqVolume,
        seqReady: Boolean(rendered),
        seqBufferDuration: rendered ? rendered.buffer.duration : 0,
        seqBufferRate: rendered ? rendered.rate : 0,
        seqBufferChannels: rendered ? rendered.channels : 0,
        renderedPeak: rendered ? rendered.originalPeak : 0,
        safetyScale: rendered ? rendered.safetyScale : 1,
        previewDirty: state.previewDirty,
        previewTrackId: state.previewTrackId,
        trackPreviewPlaying: state.trackPreviewPlaying,
        timelineWidth: state.timelineWidth,
        timelineScrollWidth: els.timelineScroll.scrollWidth,
        timelineClientWidth: els.timelineScroll.clientWidth,
        timelineDrawn: state.timelineDrawn,
        timelineSegments: state.timelineSegments,
        timelineGaps: state.timelineGaps,
        timelineCrossfades: state.timelineCrossfades,
        timelineScrollable: els.timelineScroll.scrollWidth > els.timelineScroll.clientWidth + 1,
        trackCanvases: els.trackList.querySelectorAll('[data-track-wave]').length,
        result: state.result
          ? {
              name: state.result.name,
              mime: state.result.mime,
              extension: state.result.extension,
              size: state.result.blob.size,
              duration: state.result.duration,
              sampleRate: state.result.sampleRate,
              channels: state.result.channels,
              tracks: state.result.tracks,
              safetyScale: state.result.safetyScale,
              formatLabel: state.result.formatLabel,
              url: state.result.url
            }
          : null,
        workerActive: Boolean(state.worker),
        audioContextState: state.audioCtx ? state.audioCtx.state : 'none',
        exportDisabled: els.exportButton.disabled,
        resultHidden: els.result.hidden,
        status: state.statusMessage
      };
    }
  };
}

function boot() {
  exposeDebug();
  wire();
  const supported = checkCapabilities();
  updateVolumeUi();
  renderAll();
  setPlayStatus('Add at least two audio files to build a merged sequence.');
  if (supported) {
    updateFormatUi();
    probeMp3();
  } else {
    setStatus('This browser cannot run the local audio merger. Use a current Chrome, Edge, Firefox or Safari.');
  }
}

boot();

