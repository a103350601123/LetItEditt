/* Video Trimmer — browser-side trimmer.
 * Preview uses the native video element. Inspection, thumbnails and the real
 * export run in video-trimmer-worker.js (Mediabunny + WebCodecs). */

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const LARGE_FILE_BYTES = 500 * 1024 * 1024;
const MIN_SELECTION = 0.05;
const WORKER_URL = new URL('./video-trimmer-worker.js', import.meta.url);

const els = {};
const state = {
  file: null,
  fileURL: null,
  duration: 0,
  width: 0,
  height: 0,
  fps: null,
  fpsVariable: false,
  hasAudio: false,
  audioCodec: null,
  audioChannels: null,
  audioSampleRate: null,
  audioDecodable: true,
  container: '',
  videoCodec: '',
  start: 0,
  end: 0,
  mode: 'keep',
  zoom: 1,
  exporting: false,
  cancelled: false,
  exportId: null,
  outputURL: null,
  outputBlob: null,
  outputName: '',
  inputError: null,
  previewStopAt: null,
  previewSkip: null,
  drag: null,
  scrubbing: false,
  thumbToken: 0,
  thumbTimer: null,
  playheadFrame: null,
  lastVolume: 1,
  formatSupport: { mp4: false, webm: false },
  webCodecsAvailable: false,
  encoderReady: false,
  supportChecked: false
};

let worker = null;
let workerSeq = 0;
const pendingCalls = new Map();

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  const digits = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function formatTimePrecise(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const millis = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatShort(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  if (seconds >= 3600) return formatTimePrecise(seconds);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
}

function parseTime(value) {
  if (typeof value !== 'string') return NaN;
  const text = value.trim().replace(',', '.');
  if (!text) return NaN;
  const parts = text.split(':');
  if (parts.length > 3) return NaN;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  } else if (parts.length === 2) {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  } else {
    seconds = Number(parts[0]);
  }
  if (![hours, minutes, seconds].every(Number.isFinite)) return NaN;
  return hours * 3600 + minutes * 60 + seconds;
}

function isLikelyVideo(file) {
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  return file.type.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm', 'mkv'].includes(extension);
}

function friendlyError(error) {
  const message = error && error.message ? error.message : String(error);
  if (/cancel/i.test(message)) return 'Export canceled. No file was created.';
  if (/decode|decodable|codec/i.test(message)) {
    return `This browser cannot decode part of this video. ${message}`;
  }
  if (/format|unsupported|parse|demux|input/i.test(message)) {
    return 'This file could not be read as a supported video. Try an MP4, WebM, MOV, M4V or MKV file that plays in this browser.';
  }
  return message;
}

function cacheElements() {
  const map = {
    app: '[data-app]',
    panel: '[data-app]',
    dropzone: '[data-dropzone]',
    browse: '[data-browse]',
    fileInput: '[data-file-input]',
    globalError: '[data-global-error]',
    loading: '[data-loading]',
    loadingText: '[data-loading-text]',
    editor: '[data-editor]',
    fileName: '[data-file-name]',
    fileMeta: '[data-file-meta]',
    changeVideo: '[data-change]',
    resetVideo: '[data-reset]',
    player: '[data-player]',
    stage: '[data-stage]',
    video: '[data-video]',
    videoError: '[data-video-error]',
    bigPlay: '[data-big-play]',
    play: '[data-play]',
    current: '[data-current]',
    seek: '[data-seek]',
    total: '[data-total]',
    mute: '[data-mute]',
    volume: '[data-volume]',
    speed: '[data-speed]',
    fullscreen: '[data-fullscreen]',
    metaDuration: '[data-meta-duration]',
    metaResolution: '[data-meta-resolution]',
    metaFps: '[data-meta-fps]',
    metaAudio: '[data-meta-audio]',
    metaFormat: '[data-meta-format]',
    selectionNote: '[data-selection-note]',
    zoomOut: '[data-zoom-out]',
    zoomIn: '[data-zoom-in]',
    zoomFit: '[data-zoom-fit]',
    zoomLabel: '[data-zoom-label]',
    timelineScroll: '[data-timeline-scroll]',
    timeline: '[data-timeline]',
    thumbs: '[data-thumbs]',
    shadeStart: '[data-shade-start]',
    shadeEnd: '[data-shade-end]',
    selection: '[data-selection]',
    handleStart: '[data-handle-start]',
    handleEnd: '[data-handle-end]',
    playhead: '[data-playhead]',
    ticks: '[data-ticks]',
    startInput: '[data-start-input]',
    endInput: '[data-end-input]',
    durationInput: '[data-duration-input]',
    removeSummary: '[data-remove-summary]',
    setStart: '[data-set-start]',
    setEnd: '[data-set-end]',
    preview: '[data-preview]',
    validation: '[data-validation]',
    modeNote: '[data-mode-note]',
    format: '[data-format]',
    formatNote: '[data-format-note]',
    exportButton: '[data-export]',
    cancel: '[data-cancel]',
    exportSummary: '[data-export-summary]',
    progress: '[data-progress]',
    progressTrack: '[data-progress-track]',
    progressBar: '[data-progress-bar]',
    progressLabel: '[data-progress-label]',
    result: '[data-result]',
    resultVideo: '[data-result-video]',
    resultName: '[data-result-name]',
    resultFormat: '[data-result-format]',
    resultDuration: '[data-result-duration]',
    resultSize: '[data-result-size]',
    resultResolution: '[data-result-resolution]',
    resultAudio: '[data-result-audio]',
    resultNote: '[data-result-note]',
    download: '[data-download]',
    trimAnother: '[data-trim-another]'
  };
  for (const [key, selector] of Object.entries(map)) {
    els[key] = $(selector);
  }
  els.modeInputs = $$('input[name="vtr-mode"]');
  els.qualityInputs = $$('input[name="vtr-quality"]');
  els.qualityLabels = $$('label.vtr-quality-option');
}

function init() {
  cacheElements();
  if (!els.app) return;
  setupMenu();
  setupDropzone();
  setupPlayer();
  setupTimeline();
  setupTimeInputs();
  setupMode();
  setupExport();
  setupResult();
  detectInitialSupport();
  window.addEventListener('pagehide', cleanup, { once: true });
  exposeDebugApi();
}

function setupMenu() {
  const button = $('.menu-button');
  const links = $('#primary-links');
  if (!button || !links) return;
  button.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!links.classList.contains('is-open')) return;
    if (links.contains(event.target) || button.contains(event.target)) return;
    links.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  });
}

function setupDropzone() {
  if (!els.dropzone || !els.fileInput) return;

  els.browse?.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    handleFiles(els.fileInput.files);
  });

  ['dragenter', 'dragover'].forEach((type) => {
    els.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      els.dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'dragend'].forEach((type) => {
    els.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      if (event.relatedTarget && els.dropzone.contains(event.relatedTarget)) return;
      els.dropzone.classList.remove('is-dragover');
    });
  });
  els.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.dropzone.classList.remove('is-dragover');
    handleFiles(event.dataTransfer?.files);
  });

  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    if (!els.dropzone.contains(event.target)) event.preventDefault();
  });

  els.changeVideo?.addEventListener('click', () => {
    if (state.exporting) {
      showNotice('Cancel the current export before changing the video.');
      return;
    }
    resetAll();
    els.fileInput.click();
  });
  els.resetVideo?.addEventListener('click', () => {
    if (state.exporting) {
      showNotice('Cancel the current export before removing the video.');
      return;
    }
    resetAll();
  });
}

async function handleFiles(fileList) {
  const file = fileList && fileList[0];
  if (!file) return;

  if (state.exporting) {
    showNotice('Wait for the current export to finish, or cancel it, before loading another video.');
    return;
  }
  clearNotice();

  if (!isLikelyVideo(file)) {
    showNotice('That file is not a video. Choose an MP4, WebM, MOV, M4V or MKV file.');
    return;
  }
  if (file.size === 0) {
    showNotice('This file is empty and cannot be read.');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showNotice(`This file is ${formatBytes(file.size)}. The browser-side limit is 2 GB because the video must fit in this device's memory.`);
    return;
  }

  resetToUpload();
  setLoading(true, 'Reading video metadata…');

  try {
    const info = await callWorker('inspect', { file });

    if (!info.hasVideo) {
      throw new Error('No readable video track was found. The file may be corrupted, incomplete, or audio-only.');
    }
    if (!info.videoDecodable) {
      throw new Error(`The video codec (${info.videoCodec || 'unknown'}) cannot be decoded by this browser.`);
    }
    if (info.hasAudio && !info.audioDecodable) {
      throw new Error(`The audio codec (${info.audioCodec || 'unknown'}) cannot be decoded by this browser, so the sound would be lost.`);
    }

    setLoading(true, 'Loading preview…');
    await loadPreview(file);

    const duration = Number.isFinite(info.duration) && info.duration > 0
      ? info.duration
      : els.video.duration;

    if (!Number.isFinite(duration) || duration < 0.1) {
      throw new Error('This video is too short to trim.');
    }

    state.file = file;
    state.duration = duration;
    state.width = info.width;
    state.height = info.height;
    state.fps = info.fps;
    state.fpsVariable = info.fpsVariable;
    state.hasAudio = info.hasAudio;
    state.audioCodec = info.audioCodec;
    state.audioChannels = info.audioChannels;
    state.audioSampleRate = info.audioSampleRate;
    state.audioDecodable = info.audioDecodable;
    state.container = info.container;
    state.videoCodec = info.videoCodec;
    state.start = 0;
    state.end = duration;
    state.mode = 'keep';
    state.zoom = 1;
    state.inputError = null;

    applyFileDetails();
    showEditor();
    updateAll();
    await updateEncoderSupport(info);
    updateAll();
    scheduleThumbnails(true);
    els.video.currentTime = 0;
  } catch (error) {
    resetToUpload();
    showNotice(friendlyError(error));
  } finally {
    setLoading(false);
  }
}

function applyFileDetails() {
  const { file } = state;
  if (!file) return;
  els.fileName.textContent = file.name;
  els.fileName.title = file.name;

  const codecLabel = [state.videoCodec, state.audioCodec].filter(Boolean).map((codec) => codec.toUpperCase()).join(' + ');
  const audioLabel = state.hasAudio ? '' : ' · no audio';
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${state.container || 'video'}${codecLabel ? ` · ${codecLabel}` : ''}${audioLabel}${file.size > LARGE_FILE_BYTES ? ' · large file' : ''}`;

  els.metaDuration.textContent = formatTimePrecise(state.duration);
  els.metaResolution.textContent = `${Math.round(state.width)} × ${Math.round(state.height)}`;
  els.metaFps.textContent = Number.isFinite(state.fps)
    ? `${state.fps.toFixed(state.fps >= 100 ? 0 : 2)} fps${state.fpsVariable ? ' (variable)' : ''}`
    : 'Not reported';
  els.metaAudio.textContent = state.hasAudio
    ? `${(state.audioCodec || 'audio').toUpperCase()} · ${channelLabel(state.audioChannels)} · ${state.audioSampleRate ? `${(state.audioSampleRate / 1000).toFixed(1)} kHz` : 'sample rate unknown'}`
    : 'No audio track';
  els.metaFormat.textContent = `${state.container || 'Video'}${state.videoCodec ? ` · ${state.videoCodec.toUpperCase()}` : ''}`;
}

function channelLabel(channels) {
  if (channels === 1) return 'mono';
  if (channels === 2) return 'stereo';
  if (Number.isFinite(channels)) return `${channels} channels`;
  return 'channels unknown';
}

function loadPreview(file) {
  return new Promise((resolve, reject) => {
    const video = els.video;
    video.pause();
    video.removeAttribute('src');
    video.load();

    if (state.fileURL) {
      URL.revokeObjectURL(state.fileURL);
      state.fileURL = null;
    }

    const url = URL.createObjectURL(file);
    state.fileURL = url;
    let settled = false;
    let timer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('error', onError);
      if (error) {
        URL.revokeObjectURL(url);
        state.fileURL = null;
        reject(error);
      } else {
        resolve();
      }
    };

    const onMetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(new Error('This file has no playable video frames in this browser.'));
        return;
      }
      finish();
    };
    const onError = () => {
      finish(new Error('This browser cannot preview this video container or codec.'));
    };

    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('error', onError);
    timer = setTimeout(() => {
      finish(new Error('The preview took too long to load. The file may be corrupted.'));
    }, 20000);

    video.src = url;
    video.load();
  });
}

function setLoading(show, text) {
  if (!els.loading) return;
  els.loading.hidden = !show;
  if (text && els.loadingText) els.loadingText.textContent = text;
  if (show) {
    els.dropzone.hidden = true;
    els.editor.hidden = true;
  } else if (!state.file) {
    els.dropzone.hidden = false;
  }
}

function showEditor() {
  els.dropzone.hidden = true;
  els.editor.hidden = false;
  els.result.hidden = true;
  els.progress.hidden = true;
  els.app.classList.remove('is-exporting');
  els.app.removeAttribute('aria-busy');
}

function resetToUpload() {
  releaseFile();
  releaseOutput();
  clearPreviewMode();
  clearTimeout(state.thumbTimer);
  state.thumbToken += 1;
  state.file = null;
  state.duration = 0;
  state.width = 0;
  state.height = 0;
  state.fps = null;
  state.fpsVariable = false;
  state.hasAudio = false;
  state.audioCodec = null;
  state.audioChannels = null;
  state.audioSampleRate = null;
  state.container = '';
  state.videoCodec = '';
  state.start = 0;
  state.end = 0;
  state.mode = 'keep';
  state.inputError = null;
  state.formatSupport = { mp4: false, webm: false };
  state.encoderReady = state.webCodecsAvailable;
  state.supportChecked = false;
  state.audioDecodable = true;
  els.editor.hidden = true;
  els.result.hidden = true;
  els.progress.hidden = true;
  els.dropzone.hidden = false;
  els.fileInput.value = '';
  els.thumbs.innerHTML = '';
  els.video.removeAttribute('src');
  els.video.load();
  els.resultVideo.removeAttribute('src');
  els.resultVideo.load();
  els.app.classList.remove('is-exporting');
  els.app.removeAttribute('aria-busy');
  clearNotice();
}

function resetAll() {
  if (state.exporting) {
    state.cancelled = true;
    cancelExport();
  }
  terminateWorker();
  resetToUpload();
  clearForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearForm() {
  if (els.startInput) {
    els.startInput.value = '00:00:00.000';
    els.startInput.removeAttribute('aria-invalid');
  }
  if (els.endInput) {
    els.endInput.value = '00:00:00.000';
    els.endInput.removeAttribute('aria-invalid');
  }
  els.modeInputs.forEach((input) => { input.checked = input.value === 'keep'; });
  els.qualityInputs.forEach((input) => { input.checked = input.value === 'medium'; });
  if (els.format) els.format.value = 'mp4';
  els.validation.hidden = true;
  els.validation.textContent = '';
  els.selectionNote.textContent = 'Drag the handles or type exact times.';
  els.modeNote.textContent = '';
  els.exportSummary.textContent = '';
  if (els.durationInput) {
    els.durationInput.value = '00:00:00.000';
    els.durationInput.removeAttribute('aria-invalid');
  }
  els.removeSummary.textContent = '';
  els.progress.hidden = true;
  els.cancel.hidden = true;
  els.cancel.disabled = false;
  els.cancel.textContent = 'Cancel export';
  els.exportButton.hidden = false;
  els.exportButton.disabled = true;
}

function releaseFile() {
  if (state.fileURL) {
    URL.revokeObjectURL(state.fileURL);
    state.fileURL = null;
  }
}

function releaseOutput() {
  if (state.outputURL) {
    URL.revokeObjectURL(state.outputURL);
    state.outputURL = null;
  }
  state.outputBlob = null;
  state.outputName = '';
  if (els.download) {
    els.download.removeAttribute('href');
    els.download.removeAttribute('download');
    els.download.setAttribute('aria-disabled', 'true');
  }
  if (els.resultVideo) {
    els.resultVideo.removeAttribute('src');
    els.resultVideo.load();
  }
}

function showNotice(message, tone = 'error') {
  if (!els.globalError) return;
  els.globalError.textContent = message;
  els.globalError.dataset.tone = tone;
  els.globalError.hidden = false;
}

function clearNotice() {
  if (!els.globalError) return;
  els.globalError.textContent = '';
  els.globalError.hidden = true;
  delete els.globalError.dataset.tone;
}

function setupPlayer() {
  const video = els.video;
  if (!video) return;

  els.play.addEventListener('click', togglePlay);
  els.bigPlay.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePlay();
  });
  els.stage.addEventListener('click', togglePlay);
  video.addEventListener('play', () => {
    updatePlayState(true);
    startPlayheadLoop();
  });
  video.addEventListener('pause', () => {
    updatePlayState(false);
    updatePlayhead();
  });
  video.addEventListener('ended', () => {
    updatePlayState(false);
    clearPreviewMode();
    updatePlayhead();
  });
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('loadedmetadata', updatePlayerMeta);
  video.addEventListener('volumechange', updateVolumeUI);

  els.seek.addEventListener('input', () => {
    if (!state.duration) return;
    clearPreviewMode();
    setVideoTime((Number(els.seek.value) / 1000) * state.duration);
  });

  els.volume.addEventListener('input', () => {
    const value = Number(els.volume.value);
    video.volume = value;
    video.muted = value === 0;
    if (value > 0) state.lastVolume = value;
    updateVolumeUI();
  });
  els.mute.addEventListener('click', toggleMute);
  els.speed.addEventListener('change', () => {
    const value = Number(els.speed.value);
    if (Number.isFinite(value)) video.playbackRate = value;
  });
  els.fullscreen.addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', (event) => {
    if (!state.file || state.exporting) return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      const tag = target.tagName.toLowerCase();
      if (['input', 'textarea', 'select', 'button', 'a', 'summary'].includes(tag)) return;
    }
    const key = event.key;
    if (key === ' ' || key === 'k' || key === 'K') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      clearPreviewMode();
      setVideoTime((els.video.currentTime || 0) - 5);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      clearPreviewMode();
      setVideoTime((els.video.currentTime || 0) + 5);
    } else if (key === 'j' || key === 'J') {
      event.preventDefault();
      clearPreviewMode();
      setVideoTime((els.video.currentTime || 0) - 10);
    } else if (key === 'l' || key === 'L') {
      event.preventDefault();
      clearPreviewMode();
      setVideoTime((els.video.currentTime || 0) + 10);
    } else if (key === 'm' || key === 'M') {
      event.preventDefault();
      toggleMute();
    } else if (key === 'f' || key === 'F') {
      event.preventDefault();
      toggleFullscreen();
    } else if (key === 'Home') {
      event.preventDefault();
      clearPreviewMode();
      setVideoTime(0);
    } else if (key === 'End') {
      event.preventDefault();
      clearPreviewMode();
      setVideoTime(state.duration);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === els.player;
    els.fullscreen.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    els.fullscreen.title = active ? 'Exit fullscreen' : 'Fullscreen';
  });

  els.videoError.hidden = true;
  updateVolumeUI();
  updatePlayState(false);
}

function togglePlay() {
  if (!state.file) return;
  if (els.video.paused) {
    if (els.video.ended) els.video.currentTime = 0;
    els.video.play().catch(() => {
      showNotice('The browser blocked playback. Click the video again to start it.');
    });
  } else {
    els.video.pause();
  }
}

function updatePlayState(playing) {
  els.play.innerHTML = playing ? ICONS.pause : ICONS.play;
  els.play.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  els.play.title = playing ? 'Pause' : 'Play';
  els.bigPlay.hidden = playing;
  els.stage.classList.toggle('is-playing', playing);
  if (!playing && state.playheadFrame) {
    cancelAnimationFrame(state.playheadFrame);
    state.playheadFrame = null;
  }
}

function setVideoTime(seconds) {
  if (!state.duration) return;
  const target = clamp(seconds, 0, Math.max(0, state.duration - 0.001));
  try {
    els.video.currentTime = target;
  } catch (error) {
    /* Some containers reject seeks before metadata is ready. */
  }
  updatePlayhead();
}

function updatePlayerMeta() {
  els.total.textContent = formatClock(state.duration || els.video.duration || 0);
}

function onTimeUpdate() {
  updatePlayhead();
  const video = els.video;

  if (state.previewSkip && video.currentTime >= state.previewSkip.start && video.currentTime < state.previewSkip.end) {
    setVideoTime(state.previewSkip.end);
    return;
  }
  if (state.previewStopAt !== null && video.currentTime >= state.previewStopAt - 0.04) {
    video.pause();
    clearPreviewMode();
  }
}

function updatePlayhead() {
  if (!state.duration) return;
  const time = clamp(els.video.currentTime || 0, 0, state.duration);
  const percent = (time / state.duration) * 100;
  els.playhead.style.left = `${percent}%`;
  els.seek.value = String(Math.round((time / state.duration) * 1000));
  els.seek.style.setProperty('--vtr-progress', `${(Number(els.seek.value) / 1000) * 100}%`);
  els.current.textContent = formatClock(time);
  els.total.textContent = formatClock(state.duration);
}

function startPlayheadLoop() {
  if (state.playheadFrame) return;
  const tick = () => {
    updatePlayhead();
    if (!els.video.paused && !els.video.ended) {
      state.playheadFrame = requestAnimationFrame(tick);
    } else {
      state.playheadFrame = null;
    }
  };
  state.playheadFrame = requestAnimationFrame(tick);
}

function toggleMute() {
  els.video.muted = !els.video.muted;
  if (!els.video.muted && els.video.volume === 0) {
    els.video.volume = state.lastVolume || 0.8;
    els.volume.value = String(els.video.volume);
  }
  updateVolumeUI();
}

function updateVolumeUI() {
  const muted = els.video.muted || els.video.volume === 0;
  els.mute.innerHTML = muted ? ICONS.muted : ICONS.volume;
  els.mute.setAttribute('aria-label', muted ? 'Unmute video' : 'Mute video');
  els.mute.title = muted ? 'Unmute' : 'Mute';
  els.volume.value = String(els.video.volume);
  els.volume.style.setProperty('--vtr-progress', `${els.video.volume * 100}%`);
}

async function toggleFullscreen() {
  if (!els.player) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await els.player.requestFullscreen();
    }
  } catch (error) {
    showNotice('Fullscreen is not available in this browser.');
  }
}

function clearPreviewMode() {
  state.previewStopAt = null;
  state.previewSkip = null;
}

function previewResult() {
  if (!state.file) return;
  clearPreviewMode();
  if (state.mode === 'keep') {
    setVideoTime(state.start);
    state.previewStopAt = state.end;
  } else {
    setVideoTime(0);
    state.previewStopAt = state.duration;
    state.previewSkip = { start: state.start, end: state.end };
  }
  els.video.play().catch(() => {
    showNotice('The browser blocked playback. Click the video to start it.');
  });
}

function setupTimeline() {
  if (!els.timeline) return;

  els.timeline.addEventListener('pointerdown', (event) => {
    if (!state.file || state.exporting) return;
    if (event.target.closest('.vtr-handle')) return;
    event.preventDefault();
    clearPreviewMode();
    state.scrubbing = true;
    els.timeline.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });
  els.timeline.addEventListener('pointermove', (event) => {
    if (!state.scrubbing) return;
    seekFromPointer(event);
  });
  const stopScrub = (event) => {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    try {
      els.timeline.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* Pointer capture may already be released. */
    }
  };
  els.timeline.addEventListener('pointerup', stopScrub);
  els.timeline.addEventListener('pointercancel', stopScrub);

  setupHandle(els.handleStart, 'start');
  setupHandle(els.handleEnd, 'end');

  els.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.5));
  els.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.5));
  els.zoomFit.addEventListener('click', () => setZoom(1));

  window.addEventListener('resize', () => {
    if (!state.file) return;
    scheduleThumbnails();
    updateTimelineUI();
  });
}

function seekFromPointer(event) {
  const rect = els.timeline.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  setVideoTime(ratio * state.duration);
}

function setupHandle(handle, which) {
  if (!handle) return;

  handle.addEventListener('pointerdown', (event) => {
    if (!state.file || state.exporting) return;
    event.preventDefault();
    event.stopPropagation();
    clearPreviewMode();
    handle.setPointerCapture(event.pointerId);
    const width = els.timeline.getBoundingClientRect().width || 1;
    state.drag = {
      which,
      startX: event.clientX,
      startValue: which === 'start' ? state.start : state.end,
      width
    };
    handle.classList.add('is-dragging');
  });

  handle.addEventListener('pointermove', (event) => {
    if (!state.drag || state.drag.which !== which) return;
    const delta = ((event.clientX - state.drag.startX) / state.drag.width) * state.duration;
    setBoundary(which, state.drag.startValue + delta, { source: 'drag' });
  });

  const stop = (event) => {
    if (!state.drag || state.drag.which !== which) return;
    state.drag = null;
    handle.classList.remove('is-dragging');
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* Ignore. */
    }
    updateAll();
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);

  handle.addEventListener('keydown', (event) => {
    if (!state.file || state.exporting) return;
    const current = which === 'start' ? state.start : state.end;
    const step = event.shiftKey ? 1 : 0.1;
    let next = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + step;
    else if (event.key === 'Home') next = which === 'start' ? 0 : state.start + MIN_SELECTION;
    else if (event.key === 'End') next = which === 'start' ? state.end - MIN_SELECTION : state.duration;
    if (next === null) return;
    event.preventDefault();
    clearPreviewMode();
    setBoundary(which, next, { source: 'keyboard' });
    updateAll();
  });
}

function setBoundary(which, value, options = {}) {
  if (!state.duration) return;
  let next = clamp(value, 0, state.duration);
  next = Math.round(next * 1000) / 1000;

  if (which === 'start') {
    next = clamp(next, 0, Math.max(0, state.end - MIN_SELECTION));
    state.start = next;
  } else {
    next = clamp(next, Math.min(state.duration, state.start + MIN_SELECTION), state.duration);
    state.end = next;
  }

  state.inputError = null;
  els.startInput.removeAttribute('aria-invalid');
  els.endInput.removeAttribute('aria-invalid');
  els.durationInput?.removeAttribute('aria-invalid');
  els.validation.hidden = true;
  updateTimeInputs();
  updateTimelineUI();
  updateExportState();
}

function setZoom(value) {
  const next = clamp(value, 1, 8);
  if (Math.abs(next - state.zoom) < 0.001) return;
  state.zoom = next;
  els.timeline.style.width = `${state.zoom * 100}%`;
  els.zoomLabel.textContent = `${state.zoom.toFixed(state.zoom < 2 ? 1 : 0)}×`;
  updateTimelineUI();
  scheduleThumbnails();
}

function scheduleThumbnails(immediate = false) {
  if (!state.file) return;
  clearTimeout(state.thumbTimer);
  if (immediate) {
    renderThumbnails();
  } else {
    state.thumbTimer = setTimeout(renderThumbnails, 220);
  }
}

async function renderThumbnails() {
  if (!state.file || els.editor.hidden) return;
  const width = els.timeline.clientWidth || els.timelineScroll.clientWidth;
  if (!width) return;
  const count = clamp(Math.round(width / 86), 4, 24);
  const token = ++state.thumbToken;

  try {
    const bitmaps = await callWorker('thumbnails', { file: state.file, count });
    if (token !== state.thumbToken || !state.file) {
      bitmaps.forEach((bitmap) => bitmap?.close?.());
      return;
    }
    els.thumbs.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < bitmaps.length; index += 1) {
      const bitmap = bitmaps[index];
      const wrapper = document.createElement('span');
      wrapper.className = 'vtr-thumb';
      if (bitmap) {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.setAttribute('aria-hidden', 'true');
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        wrapper.appendChild(canvas);
        bitmap.close();
      }
      fragment.appendChild(wrapper);
    }
    els.thumbs.appendChild(fragment);
  } catch (error) {
    if (token !== state.thumbToken) return;
    els.thumbs.innerHTML = '';
  }
}

function updateTimelineUI() {
  if (!state.duration) return;
  const startPercent = (state.start / state.duration) * 100;
  const endPercent = (state.end / state.duration) * 100;
  const widthPercent = Math.max(0, endPercent - startPercent);

  els.selection.style.left = `${startPercent}%`;
  els.selection.style.width = `${widthPercent}%`;
  els.shadeStart.style.width = `${startPercent}%`;
  els.shadeEnd.style.left = `${endPercent}%`;
  els.shadeEnd.style.width = `${Math.max(0, 100 - endPercent)}%`;
  els.handleStart.style.left = `${startPercent}%`;
  els.handleEnd.style.left = `${endPercent}%`;
  els.timeline.classList.toggle('is-remove', state.mode === 'remove');

  els.handleStart.setAttribute('aria-valuemin', '0');
  els.handleStart.setAttribute('aria-valuemax', String(Math.max(0, state.end - MIN_SELECTION)));
  els.handleStart.setAttribute('aria-valuenow', state.start.toFixed(3));
  els.handleStart.setAttribute('aria-valuetext', formatTimePrecise(state.start));
  els.handleEnd.setAttribute('aria-valuemin', String(Math.min(state.duration, state.start + MIN_SELECTION)));
  els.handleEnd.setAttribute('aria-valuemax', String(state.duration));
  els.handleEnd.setAttribute('aria-valuenow', state.end.toFixed(3));
  els.handleEnd.setAttribute('aria-valuetext', formatTimePrecise(state.end));

  renderTicks();
}

function renderTicks() {
  if (!els.ticks) return;
  const count = state.zoom > 2.5 ? 9 : 5;
  els.ticks.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const percent = (index / (count - 1)) * 100;
    const tick = document.createElement('span');
    tick.className = 'vtr-tick';
    tick.style.left = `${percent}%`;
    tick.style.transform = index === 0 ? 'translateX(0)' : index === count - 1 ? 'translateX(-100%)' : 'translateX(-50%)';
    tick.textContent = formatClock((percent / 100) * state.duration);
    fragment.appendChild(tick);
  }
  els.ticks.appendChild(fragment);
}

function setupTimeInputs() {
  if (!els.startInput || !els.endInput) return;

  const wire = (input, which) => {
    input.addEventListener('input', () => {
      clearTimeErrors();
      updateExportState();
    });
    input.addEventListener('change', () => applyTimeInput(which));
    input.addEventListener('blur', () => applyTimeInput(which));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyTimeInput(which);
        input.blur();
      }
    });
    input.addEventListener('focus', () => input.select());
  };

  wire(els.startInput, 'start');
  wire(els.endInput, 'end');

  if (els.durationInput) {
    const input = els.durationInput;
    input.addEventListener('input', () => {
      clearTimeErrors();
      updateExportState();
    });
    input.addEventListener('change', applyDurationInput);
    input.addEventListener('blur', applyDurationInput);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyDurationInput();
        input.blur();
      }
    });
    input.addEventListener('focus', () => input.select());
  }

  els.setStart.addEventListener('click', () => {
    if (!state.file) return;
    clearPreviewMode();
    setBoundary('start', els.video.currentTime || 0);
    updateAll();
  });
  els.setEnd.addEventListener('click', () => {
    if (!state.file) return;
    clearPreviewMode();
    setBoundary('end', els.video.currentTime || 0);
    updateAll();
  });
  els.preview.addEventListener('click', previewResult);
}

function clearTimeErrors() {
  state.inputError = null;
  els.startInput.removeAttribute('aria-invalid');
  els.endInput.removeAttribute('aria-invalid');
  els.durationInput?.removeAttribute('aria-invalid');
  els.validation.hidden = true;
}

function applyTimeInput(which) {
  const input = which === 'start' ? els.startInput : els.endInput;
  const value = parseTime(input.value);

  if (!Number.isFinite(value)) {
    invalidInput(input, which, 'Enter a time as HH:MM:SS.mmm, MM:SS.mmm or seconds.');
    return;
  }
  if (which === 'start' && value < 0) {
    invalidInput(input, which, 'Start time cannot be negative.');
    return;
  }
  if (which === 'end' && value < 0) {
    invalidInput(input, which, 'End time cannot be negative.');
    return;
  }
  if (value > state.duration + 0.0005) {
    invalidInput(input, which, `Time cannot exceed the video duration (${formatTimePrecise(state.duration)}).`);
    return;
  }
  if (which === 'start' && value > state.end - MIN_SELECTION) {
    invalidInput(input, which, `Start time must be at least ${MIN_SELECTION.toFixed(2)} seconds before the end time.`);
    return;
  }
  if (which === 'end' && value < state.start + MIN_SELECTION) {
    invalidInput(input, which, `End time must be at least ${MIN_SELECTION.toFixed(2)} seconds after the start time.`);
    return;
  }

  state.inputError = null;
  input.removeAttribute('aria-invalid');
  setBoundary(which, value, { source: 'input' });
  input.value = formatTimePrecise(which === 'start' ? state.start : state.end);
  updateAll();
}

function invalidInput(input, which, message) {
  state.inputError = message;
  input.setAttribute('aria-invalid', 'true');
  els.validation.textContent = message;
  els.validation.hidden = false;
  updateExportState();
}

function applyDurationInput() {
  if (!state.file || !els.durationInput) return;
  const input = els.durationInput;
  const value = parseTime(input.value);

  if (!Number.isFinite(value)) {
    invalidInput(input, 'duration', 'Enter a duration as HH:MM:SS.mmm, MM:SS.mmm or seconds.');
    return;
  }
  if (value < MIN_SELECTION) {
    invalidInput(input, 'duration', `Duration must be at least ${MIN_SELECTION.toFixed(2)} seconds.`);
    return;
  }
  const remaining = Math.max(0, state.duration - state.start);
  if (value > remaining + 0.0005) {
    invalidInput(input, 'duration', `Duration cannot exceed the remaining video (${formatTimePrecise(remaining)}).`);
    return;
  }

  state.inputError = null;
  input.removeAttribute('aria-invalid');
  state.end = clamp(Math.round((state.start + value) * 1000) / 1000, state.start + MIN_SELECTION, state.duration);
  input.value = formatTimePrecise(state.end - state.start);
  updateAll();
}

function updateTimeInputs() {
  if (document.activeElement !== els.startInput) {
    els.startInput.value = formatTimePrecise(state.start);
    els.startInput.removeAttribute('aria-invalid');
  }
  if (document.activeElement !== els.endInput) {
    els.endInput.value = formatTimePrecise(state.end);
    els.endInput.removeAttribute('aria-invalid');
  }
  if (els.durationInput && document.activeElement !== els.durationInput) {
    els.durationInput.value = formatTimePrecise(Math.max(0, state.end - state.start));
    els.durationInput.removeAttribute('aria-invalid');
  }
}

function setupMode() {
  els.modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.mode = input.value === 'remove' ? 'remove' : 'keep';
      clearPreviewMode();
      updateAll();
    });
  });
}

function updateModeUI() {
  const removing = state.mode === 'remove';
  els.timeline.classList.toggle('is-remove', removing);
  els.selectionNote.textContent = removing
    ? 'The highlighted range will be removed. The parts before and after are joined.'
    : 'Only the highlighted range will be exported.';
  els.modeNote.textContent = removing
    ? 'Remove mode cuts out the highlighted section and joins the remaining video. Cuts land on the nearest decoded frame.'
    : 'Keep mode exports the highlighted section only.';

  if (removing) {
    els.removeSummary.textContent = `Before: ${formatTimePrecise(state.start)} · After: ${formatTimePrecise(Math.max(0, state.duration - state.end))}`;
  } else {
    els.removeSummary.textContent = '';
  }
}

function getValidationErrors() {
  const errors = [];
  if (state.inputError) errors.push(state.inputError);
  if (!state.file) errors.push('Choose a video first.');
  if (!Number.isFinite(state.start) || state.start < 0) errors.push('Start time cannot be negative.');
  if (!Number.isFinite(state.end)) errors.push('Enter a valid end time.');
  if (state.end > state.duration + 0.0005) errors.push('End time cannot exceed the video duration.');
  if (state.end <= state.start) errors.push('End time must be greater than the start time.');

  const selected = state.end - state.start;
  if (state.mode === 'keep' && selected < MIN_SELECTION) {
    errors.push(`Select at least ${MIN_SELECTION.toFixed(2)} seconds to export.`);
  }
  if (state.mode === 'remove') {
    const remaining = state.duration - selected;
    if (state.start <= 0.0005 && state.end >= state.duration - 0.0005) {
      errors.push('Removing the whole video would leave nothing to export.');
    } else if (remaining < MIN_SELECTION) {
      errors.push(`Removing this section would leave less than ${MIN_SELECTION.toFixed(2)} seconds of video.`);
    }
  }
  if (!state.encoderReady) {
    errors.push('This browser cannot encode MP4 or WebM video, so real trimming is unavailable here.');
  }
  if (state.hasAudio && !state.audioDecodable) {
    errors.push('The audio track cannot be decoded, so export would lose sound.');
  }
  return errors;
}

function updateExportState() {
  if (!els.exportButton) return;
  const format = els.format.value;
  const formatReady = Boolean(state.formatSupport[format]);
  const errors = getValidationErrors();
  const supportPending = Boolean(state.file) && !state.supportChecked;
  if (!formatReady && state.file && state.supportChecked) {
    errors.push('Choose an output format supported by this browser.');
  }

  const message = errors[0] || '';
  els.validation.textContent = message;
  els.validation.hidden = !message;

  els.exportButton.disabled = state.exporting || supportPending || errors.length > 0;
  els.exportButton.textContent = state.exporting ? 'Exporting…' : 'Export trimmed video';
  els.exportSummary.textContent = buildExportSummary();

  els.qualityInputs.forEach((input) => {
    input.disabled = state.exporting;
  });
  els.modeInputs.forEach((input) => {
    input.disabled = state.exporting;
  });
  els.format.disabled = state.exporting || !state.encoderReady;
}

function buildExportSummary() {
  if (!state.file) return '';
  const formatLabel = els.format.value === 'webm' ? 'WebM' : 'MP4';
  const selected = Math.max(0, state.end - state.start);
  if (state.mode === 'keep') {
    return `Output: ${formatTimePrecise(selected)} · ${formatLabel}${state.hasAudio ? ' · audio kept' : ' · no audio'}`;
  }
  return `Output: ${formatTimePrecise(Math.max(0, state.duration - selected))} · ${formatLabel} · ${formatTimePrecise(state.start)} before + ${formatTimePrecise(Math.max(0, state.duration - state.end))} after`;
}

function setupExport() {
  els.format.addEventListener('change', () => {
    updateFormatNote();
    updateExportState();
  });
  els.qualityInputs.forEach((input) => {
    input.addEventListener('change', updateExportState);
  });
  els.exportButton.addEventListener('click', exportVideo);
  els.cancel.addEventListener('click', cancelExport);
}

async function detectInitialSupport() {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    state.webCodecsAvailable = false;
    state.encoderReady = false;
    showNotice('This browser does not expose the WebCodecs APIs needed for real video trimming. Use a current version of Chrome, Edge or Safari over HTTPS or localhost.');
    return;
  }
  state.webCodecsAvailable = true;
  state.encoderReady = true;
}

async function updateEncoderSupport(info) {
  const support = { mp4: false, webm: false };
  if (!state.webCodecsAvailable) {
    state.formatSupport = support;
    state.encoderReady = false;
    state.supportChecked = true;
    els.format.querySelectorAll('option').forEach((option) => {
      option.disabled = true;
      option.hidden = true;
    });
    updateExportState();
    return;
  }

  const width = Math.max(2, Math.round(info.width));
  const height = Math.max(2, Math.round(info.height));
  const frameRate = Number.isFinite(info.fps) && info.fps > 0 ? info.fps : 30;
  const videoBitrate = Math.max(800000, Math.min(40000000, width * height * frameRate * 0.12));
  const channels = info.audioChannels || 2;
  const sampleRate = info.audioSampleRate || 48000;

  const videoChecks = {
    mp4: ['avc1.640033', 'avc1.640028', 'avc1.42001f'],
    webm: ['vp09.00.40.08', 'vp09.00.10.08', 'vp8']
  };

  for (const format of ['mp4', 'webm']) {
    let videoSupported = false;
    for (const codec of videoChecks[format]) {
      try {
        const result = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: Math.round(videoBitrate),
          framerate: frameRate
        });
        if (result.supported) {
          videoSupported = true;
          break;
        }
      } catch (error) {
        /* Try the next codec string. */
      }
    }
    let audioSupported = true;
    if (info.hasAudio) {
      try {
        const result = await AudioEncoder.isConfigSupported({
          codec: format === 'webm' ? 'opus' : 'mp4a.40.2',
          sampleRate,
          numberOfChannels: channels,
          bitrate: 128000
        });
        audioSupported = Boolean(result.supported);
      } catch (error) {
        audioSupported = false;
      }
    }
    support[format] = videoSupported && audioSupported;
  }

  state.formatSupport = support;
  els.format.querySelectorAll('option').forEach((option) => {
    const available = Boolean(support[option.value]);
    option.disabled = !available;
    option.hidden = !available;
  });

  const availableFormats = Object.keys(support).filter((format) => support[format]);
  state.supportChecked = true;
  if (!availableFormats.length) {
    state.encoderReady = false;
    showNotice('This browser cannot encode MP4 or WebM video at this resolution, so real trimming is unavailable for this file.');
    updateExportState();
    return;
  }
  state.encoderReady = true;
  if (!support[els.format.value]) els.format.value = availableFormats[0];
  updateFormatNote();
  updateExportState();
}

function updateFormatNote() {
  const format = els.format.value;
  const hasAudio = state.hasAudio;
  const formatLabel = format === 'webm' ? 'WebM' : 'MP4';
  const container = (state.container || '').toLowerCase();
  let note = format === 'webm'
    ? `WebM · VP9 video${hasAudio ? ' + Opus audio' : ''}. Open format; some editors and older devices may not import it.`
    : `MP4 · H.264 video${hasAudio ? ' + AAC audio' : ''}. The most compatible choice for phones, browsers and editors.`;
  if (container.includes('quicktime')) {
    note += ` Your MOV file is exported as ${formatLabel} because this tool writes MP4 and WebM.`;
  } else if (container.includes('matroska') && format !== 'webm') {
    note += ' Your MKV file is exported as MP4 because this tool writes MP4 and WebM.';
  }
  note += ' The video is re-encoded, so the cut is not a lossless stream copy.';
  els.formatNote.textContent = note;
}

async function exportVideo() {
  if (!state.file || state.exporting) return;
  const errors = getValidationErrors();
  if (errors.length) {
    els.validation.textContent = errors[0];
    els.validation.hidden = false;
    return;
  }

  const format = els.format.value;
  if (!state.formatSupport[format]) {
    showNotice('This output format is not supported by the browser encoder.');
    return;
  }

  const quality = els.qualityInputs.find((input) => input.checked)?.value || 'medium';
  const expectedDuration = state.mode === 'keep'
    ? state.end - state.start
    : state.duration - (state.end - state.start);

  clearNotice();
  releaseOutput();
  state.exporting = true;
  state.cancelled = false;
  setExportingUI(true);
  els.progress.hidden = false;
  els.result.hidden = true;
  updateProgress(0, 'Preparing the export…');
  updateExportState();

  const startedAt = performance.now();

  try {
    const { id, promise } = startWorkerCall(
      'export',
      {
        file: state.file,
        mode: state.mode,
        start: state.start,
        end: state.end,
        format,
        quality
      },
      (progress) => {
        const percent = clamp(progress, 0, 1);
        const processed = expectedDuration * percent;
        const label = percent >= 0.999
          ? 'Finalizing the file…'
          : `Encoding ${Math.round(percent * 100)}% · ${formatClock(processed)} of ${formatClock(expectedDuration)} processed`;
        updateProgress(percent, label);
      }
    );
    state.exportId = id;

    const payload = await promise;

    if (state.cancelled) throw new Error('Export canceled.');
    if (!payload || !payload.buffer || payload.buffer.byteLength < 512) {
      throw new Error('The encoder did not produce a valid file.');
    }
    if (state.hasAudio && !payload.hasAudio) {
      throw new Error('Audio was lost during export, so no download was offered.');
    }
    if (!Number.isFinite(payload.duration) || payload.duration <= 0) {
      throw new Error('The exported file has no readable duration.');
    }

    const tolerance = Math.max(0.25, Math.min(1, expectedDuration * 0.02));
    if (Math.abs(payload.duration - expectedDuration) > tolerance) {
      throw new Error(`The exported duration (${formatTimePrecise(payload.duration)}) did not match the selection (${formatTimePrecise(expectedDuration)}). No download was offered.`);
    }
    if (payload.width && state.width && Math.abs(payload.width - state.width) > 2) {
      throw new Error('The exported width did not match the original video. No download was offered.');
    }
    if (payload.height && state.height && Math.abs(payload.height - state.height) > 2) {
      throw new Error('The exported height did not match the original video. No download was offered.');
    }

    const blob = new Blob([payload.buffer], { type: payload.mimeType });
    const filename = `${outputBaseName(state.file.name)}-trimmed.${payload.extension}`;
    const url = URL.createObjectURL(blob);
    state.outputURL = url;
    state.outputBlob = blob;
    state.outputName = filename;

    showResult(payload, blob, url, filename, Math.round(performance.now() - startedAt));
    updateProgress(1, 'Export complete.');
    els.progress.hidden = true;
  } catch (error) {
    els.progress.hidden = true;
    if (state.cancelled || /cancel/i.test(error?.message || '')) {
      showNotice('Export canceled. No file was created or downloaded.', 'info');
    } else {
      showNotice(`Export failed: ${friendlyError(error)} Your original video is unchanged.`);
    }
  } finally {
    state.exporting = false;
    state.exportId = null;
    state.cancelled = false;
    setExportingUI(false);
    updateExportState();
  }
}

function startWorkerCall(type, payload, onProgress) {
  const id = ++workerSeq;
  const promise = new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject, onProgress });
    try {
      ensureWorker().postMessage({ id, type, ...payload });
    } catch (error) {
      pendingCalls.delete(id);
      reject(error);
    }
  });
  return { id, promise };
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'progress') {
      const entry = pendingCalls.get(message.id);
      if (entry?.onProgress) entry.onProgress(message.progress);
      return;
    }
    const entry = pendingCalls.get(message.id);
    if (!entry) return;
    pendingCalls.delete(message.id);
    if (message.type === 'error') {
      const error = new Error(message.message || 'The media worker failed.');
      error.name = message.name || 'Error';
      entry.reject(error);
    } else {
      entry.resolve(message.payload);
    }
  });
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The media worker could not start.');
    pendingCalls.forEach((entry) => entry.reject(error));
    pendingCalls.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function callWorker(type, payload) {
  return startWorkerCall(type, payload).promise;
}

function terminateWorker() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  pendingCalls.forEach((entry) => entry.reject(new Error('The media worker was closed.')));
  pendingCalls.clear();
}

function cancelExport() {
  if (!state.exporting) return;
  state.cancelled = true;
  els.cancel.disabled = true;
  els.cancel.textContent = 'Canceling…';
  try {
    worker?.postMessage({ type: 'cancel' });
  } catch (error) {
    /* The pending call will settle on its own. */
  }
}

function setExportingUI(exporting) {
  els.app.classList.toggle('is-exporting', exporting);
  els.app.setAttribute('aria-busy', String(exporting));
  els.cancel.hidden = !exporting;
  els.cancel.disabled = false;
  els.cancel.textContent = 'Cancel export';
  els.exportButton.hidden = exporting;
  els.exportButton.textContent = exporting ? 'Exporting…' : 'Export trimmed video';
  els.startInput.disabled = exporting;
  els.endInput.disabled = exporting;
  els.setStart.disabled = exporting;
  els.setEnd.disabled = exporting;
  els.preview.disabled = exporting;
  els.zoomIn.disabled = exporting;
  els.zoomOut.disabled = exporting;
  els.zoomFit.disabled = exporting;
  els.qualityInputs.forEach((input) => { input.disabled = exporting; });
  els.modeInputs.forEach((input) => { input.disabled = exporting; });
  els.format.disabled = exporting || !state.encoderReady;
  els.handleStart.setAttribute('aria-disabled', String(exporting));
  els.handleEnd.setAttribute('aria-disabled', String(exporting));
}

function updateProgress(progress, label) {
  const percent = clamp(progress, 0, 1) * 100;
  els.progressBar.style.width = `${percent}%`;
  els.progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
  els.progressLabel.textContent = label;
}

function outputBaseName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim();
  return base || 'video';
}

function showResult(payload, blob, url, filename, elapsedMs) {
  els.result.hidden = false;
  els.resultName.textContent = filename;
  els.resultFormat.textContent = `${payload.extension.toUpperCase()} · ${payload.mimeType}`;
  els.resultDuration.textContent = formatTimePrecise(payload.duration);
  els.resultSize.textContent = formatBytes(blob.size);
  els.resultResolution.textContent = payload.width && payload.height
    ? `${payload.width} × ${payload.height}`
    : `${state.width} × ${state.height}`;
  els.resultAudio.textContent = payload.hasAudio ? 'Audio included' : 'No audio track';
  els.resultNote.textContent = elapsedMs
    ? `Created locally in ${(elapsedMs / 1000).toFixed(1)} s. The original file was not uploaded.`
    : 'Created locally. The original file was not uploaded.';
  els.download.href = url;
  els.download.download = filename;
  els.download.removeAttribute('aria-disabled');
  els.resultVideo.src = url;
  els.resultVideo.load();

  els.resultVideo.onerror = () => {
    els.resultNote.textContent = 'The file is valid and ready to download, but this browser cannot preview it inline.';
  };

  els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setupResult() {
  els.trimAnother.addEventListener('click', () => {
    if (state.exporting) return;
    resetAll();
    els.dropzone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => els.browse?.focus(), 250);
  });

  els.download.addEventListener('click', () => {
    if (!state.outputURL) {
      els.download.setAttribute('aria-disabled', 'true');
    }
  });
}

function updateAll() {
  updateTimeInputs();
  updateTimelineUI();
  updateModeUI();
  updateExportState();
  updatePlayhead();
}

function cleanup() {
  if (state.exporting) {
    state.cancelled = true;
    try {
      worker?.postMessage({ type: 'cancel' });
    } catch (error) {
      /* Ignore. */
    }
  }
  terminateWorker();
  releaseFile();
  releaseOutput();
}

function exposeDebugApi() {
  window.__videoTrimmer = {
    getState() {
      return {
        file: state.file ? { name: state.file.name, size: state.file.size, type: state.file.type } : null,
        duration: state.duration,
        width: state.width,
        height: state.height,
        fps: state.fps,
        fpsVariable: state.fpsVariable,
        hasAudio: state.hasAudio,
        container: state.container,
        start: state.start,
        end: state.end,
        mode: state.mode,
        format: els.format?.value || null,
        formatSupport: { ...state.formatSupport },
        supportChecked: state.supportChecked,
        encoderReady: state.encoderReady,
        zoom: state.zoom,
        exporting: state.exporting,
        output: state.outputBlob ? { name: state.outputName, size: state.outputBlob.size, type: state.outputBlob.type } : null
      };
    },
    setRange(start, end) {
      if (!state.file) return;
      state.inputError = null;
      state.start = clamp(Number(start) || 0, 0, state.duration);
      state.end = clamp(Number(end) || state.duration, state.start + MIN_SELECTION, state.duration);
      els.startInput.removeAttribute('aria-invalid');
      els.endInput.removeAttribute('aria-invalid');
      updateAll();
    },
    setZoom(value) {
      if (!state.file) return;
      setZoom(Number(value) || 1);
    },
    getVideo() {
      return {
        currentTime: els.video?.currentTime || 0,
        duration: els.video?.duration || 0,
        paused: els.video?.paused ?? true
      };
    }
  };
}

init();
