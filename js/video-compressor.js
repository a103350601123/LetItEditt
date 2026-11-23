(() => {
  'use strict';

  const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
  const LARGE_FILE_BYTES = 700 * 1024 * 1024;
  const LONG_VIDEO_SECONDS = 10 * 60;
  const MAX_OUTPUT_EDGE = 4096;
  const ACCEPTED_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
  const FORMATS = ['mp4', 'webm'];

  const PRESETS = {
    '2160': 2160,
    '1440': 1440,
    '1080': 1080,
    '720': 720,
    '480': 480,
    '360': 360
  };
  const PRESET_LABELS = {
    '2160': '4K',
    '1440': '1440p',
    '1080': '1080p',
    '720': '720p',
    '480': '480p',
    '360': '360p'
  };

  const MODE_LABELS = {
    high: 'High Quality',
    balanced: 'Balanced',
    smallest: 'Smallest File',
    advanced: 'Advanced'
  };

  // Bits per pixel per second, plus the fraction of the source video bitrate
  // that a mode is allowed to use. A high-bitrate source is compressed hard;
  // an already tiny source is never pushed above its own bitrate by much.
  const MODE_TARGETS = {
    high: { bpp: 0.11, sourceCap: 0.9, audio: 160 },
    balanced: { bpp: 0.07, sourceCap: 0.65, audio: 128 },
    smallest: { bpp: 0.04, sourceCap: 0.45, audio: 96 }
  };

  const CODEC_LABELS = {
    avc: 'H.264',
    vp9: 'VP9',
    vp8: 'VP8',
    aac: 'AAC',
    opus: 'Opus'
  };

  const state = {
    file: null,
    url: null,
    thumbnail: '',
    meta: null,
    mode: 'balanced',
    format: 'mp4',
    codec: 'avc',
    resolution: 'original',
    width: 0,
    height: 0,
    aspectLocked: true,
    rateMode: 'bitrate',
    bitrateMbps: 4,
    targetMB: 20,
    crfEnabled: false,
    crf: 28,
    fpsCap: 0,
    audioKeep: true,
    audioBitrate: 128,
    advancedTouched: false,
    duration: 0,
    loading: false,
    exporting: false,
    canceling: false,
    supportChecked: false,
    supportPending: false,
    supportError: false,
    support: null,
    output: null,
    progressStartedAt: 0
  };

  const els = {};
  let worker = null;
  let requestId = 0;
  let supportToken = 0;
  let supportTimer = null;
  const pending = new Map();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    cacheElements();
    setupMenu();
    setupDropzone();
    setupPlayer();
    setupModes();
    setupFormatAndCodec();
    setupResolution();
    setupRateControl();
    setupAudio();
    setupExport();
    updateYear();
    updateAll();
    exposeDebugApi();

    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) shutdown();
    });
  }

  function cacheElements() {
    const map = {
      app: '[data-app]',
      dropzone: '[data-dropzone]',
      fileInput: '[data-file-input]',
      browse: '[data-browse]',
      dropTitle: '[data-drop-title]',
      dropSub: '[data-drop-sub]',
      editor: '[data-editor]',
      fileThumb: '[data-file-thumb]',
      fileName: '[data-file-name]',
      fileMeta: '[data-file-meta]',
      replace: '[data-replace]',
      remove: '[data-remove-video]',
      globalError: '[data-global-error]',
      warning: '[data-warning]',
      loading: '[data-loading]',
      loadingText: '[data-loading-text]',
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
      fullscreen: '[data-fullscreen]',
      sourceDims: '[data-source-dims]',
      metaDuration: '[data-meta-duration]',
      metaResolution: '[data-meta-resolution]',
      metaFps: '[data-meta-fps]',
      metaVideo: '[data-meta-video]',
      metaAudio: '[data-meta-audio]',
      metaRotation: '[data-meta-rotation]',
      metaSize: '[data-meta-size]',
      metaBitrate: '[data-meta-bitrate]',
      planOriginal: '[data-plan-original]',
      planOutput: '[data-plan-output]',
      planVideo: '[data-plan-video]',
      planAudio: '[data-plan-audio]',
      modeNote: '[data-mode-note]',
      format: '[data-format]',
      formatNote: '[data-format-note]',
      resolution: '[data-resolution]',
      customSize: '[data-custom-size]',
      width: '[data-width]',
      height: '[data-height]',
      aspectLock: '[data-aspect-lock]',
      sizeNote: '[data-size-note]',
      upscale: '[data-upscale]',
      sizeValidation: '[data-size-validation]',
      advanced: '[data-advanced]',
      rateMode: '[data-rate-mode]',
      bitrateField: '[data-bitrate-field]',
      bitrate: '[data-bitrate]',
      bitrateValidation: '[data-bitrate-validation]',
      targetField: '[data-target-field]',
      targetSize: '[data-target-size]',
      targetValidation: '[data-target-validation]',
      crfEnabled: '[data-crf-enabled]',
      crfField: '[data-crf-field]',
      crf: '[data-crf]',
      crfNote: '[data-crf-note]',
      fpsCap: '[data-fps-cap]',
      fpsNote: '[data-fps-note]',
      codec: '[data-codec]',
      codecNote: '[data-codec-note]',
      audioKeep: '[data-audio-keep]',
      audioField: '[data-audio-field]',
      audioBitrate: '[data-audio-bitrate]',
      audioCodec: '[data-audio-codec]',
      advancedNote: '[data-advanced-note]',
      exportButton: '[data-export]',
      cancel: '[data-cancel]',
      exportNote: '[data-export-note]',
      outputSummary: '[data-output-summary]',
      targetHint: '[data-target-hint]',
      progress: '[data-progress]',
      progressTrack: '[data-progress-track]',
      progressBar: '[data-progress-bar]',
      progressLabel: '[data-progress-label]',
      progressTiming: '[data-progress-timing]',
      result: '[data-result]',
      resultNote: '[data-result-note]',
      compare: '[data-compare]',
      resultBefore: '[data-result-before]',
      resultBeforeDetail: '[data-result-before-detail]',
      resultAfter: '[data-result-after]',
      resultAfterDetail: '[data-result-after-detail]',
      resultSaved: '[data-result-saved]',
      resultPercent: '[data-result-percent]',
      resultWarning: '[data-result-warning]',
      resultVideo: '[data-result-video]',
      resultName: '[data-result-name]',
      resultFormat: '[data-result-format]',
      resultResolution: '[data-result-resolution]',
      resultDuration: '[data-result-duration]',
      resultAudio: '[data-result-audio]',
      resultMode: '[data-result-mode]',
      resultSavedBytes: '[data-result-saved-bytes]',
      resultReduction: '[data-result-reduction]',
      download: '[data-download]',
      compressAgain: '[data-compress-again]',
      newVideo: '[data-new-video]'
    };

    for (const [key, selector] of Object.entries(map)) {
      els[key] = document.querySelector(selector);
    }
  }

  function setupMenu() {
    const button = document.querySelector('.menu-button');
    const links = document.querySelector('#primary-links');
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
    els.browse.addEventListener('click', () => els.fileInput.click());
    els.replace.addEventListener('click', () => {
      if (!state.exporting && !state.loading) els.fileInput.click();
    });
    els.remove.addEventListener('click', () => {
      if (!state.exporting && !state.loading) removeVideo();
    });

    els.fileInput.addEventListener('change', () => {
      const files = Array.from(els.fileInput.files || []);
      els.fileInput.value = '';
      if (!files.length) return;
      if (files.length > 1) {
        showError('This tool compresses one video at a time. The first file was loaded; remove it before adding another.');
      }
      loadFile(files[0]);
    });

    ['dragenter', 'dragover'].forEach((type) => {
      els.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        els.dropzone.classList.add('is-dragover');
      });
    });

    els.dropzone.addEventListener('dragleave', (event) => {
      if (event.relatedTarget && els.dropzone.contains(event.relatedTarget)) return;
      els.dropzone.classList.remove('is-dragover');
    });

    els.dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      els.dropzone.classList.remove('is-dragover');
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if (!files.length) return;
      if (files.length > 1) {
        showError('This tool compresses one video at a time. The first file was loaded.');
      }
      loadFile(files[0]);
    });

    els.dropzone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      els.fileInput.click();
    });
  }

  function setupPlayer() {
    els.player.classList.add('is-paused');
    els.play.addEventListener('click', togglePlayback);
    els.bigPlay.addEventListener('click', togglePlayback);

    els.seek.addEventListener('input', () => {
      const duration = playerDuration();
      if (!duration) return;
      const time = (Number(els.seek.value) / 1000) * duration;
      try {
        els.video.currentTime = Math.min(duration, Math.max(0, time));
      } catch (error) {
        /* Seeking can fail before metadata is ready. */
      }
      updateTimeDisplay();
    });

    els.volume.addEventListener('input', () => {
      const value = Math.max(0, Math.min(1, Number(els.volume.value)));
      els.video.volume = value;
      els.video.muted = value === 0;
      updateVolumeUi();
    });

    els.mute.addEventListener('click', () => {
      els.video.muted = !els.video.muted;
      if (!els.video.muted && els.video.volume === 0) {
        els.video.volume = 1;
        els.volume.value = '1';
      }
      updateVolumeUi();
    });

    els.fullscreen.addEventListener('click', toggleFullscreen);

    els.video.addEventListener('loadedmetadata', () => {
      const duration = Number(els.video.duration);
      if (Number.isFinite(duration) && duration > 0) {
        state.duration = duration;
        els.total.textContent = formatClock(duration);
      }
      updateTimeDisplay();
    });

    els.video.addEventListener('seeked', updateTimeDisplay);

    els.video.addEventListener('play', () => {
      els.player.classList.remove('is-paused');
      els.player.classList.add('is-playing');
      updatePlayButton();
    });

    els.video.addEventListener('pause', () => {
      els.player.classList.add('is-paused');
      els.player.classList.remove('is-playing');
      updatePlayButton();
    });

    els.video.addEventListener('ended', () => {
      els.player.classList.add('is-paused');
      els.player.classList.remove('is-playing');
      updatePlayButton();
    });

    els.video.addEventListener('timeupdate', updateTimeDisplay);

    els.video.addEventListener('error', () => {
      if (!state.meta) return;
      els.videoError.hidden = false;
      els.videoError.textContent =
        'This browser cannot play this file directly. Compression may still work because the worker uses a separate decoder.';
    });

    els.video.addEventListener('volumechange', updateVolumeUi);

    els.stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      els.player.focus({ preventScroll: true });
    });

    els.player.addEventListener('keydown', (event) => {
      if (event.target.closest('input, select, textarea, button, a')) return;
      const key = event.key;
      if (key === ' ' || key === 'k' || key === 'K') {
        event.preventDefault();
        togglePlayback();
      } else if (key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(-5);
      } else if (key === 'ArrowRight') {
        event.preventDefault();
        seekBy(5);
      } else if (key === 'j' || key === 'J') {
        event.preventDefault();
        seekBy(-10);
      } else if (key === 'l' || key === 'L') {
        event.preventDefault();
        seekBy(10);
      } else if (key === 'm' || key === 'M') {
        event.preventDefault();
        els.video.muted = !els.video.muted;
        updateVolumeUi();
      } else if (key === 'f' || key === 'F') {
        event.preventDefault();
        toggleFullscreen();
      }
    });

    updateVolumeUi();
    updatePlayButton();
  }

  function setupModes() {
    document.querySelectorAll('input[name="vc-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || state.exporting) return;
        setMode(input.value);
      });
    });
  }

  function setupFormatAndCodec() {
    els.format.addEventListener('change', () => {
      if (state.exporting) return;
      setFormat(els.format.value === 'webm' ? 'webm' : 'mp4');
    });

    els.codec.addEventListener('change', () => {
      if (state.exporting) return;
      const value = ['avc', 'vp9', 'vp8'].includes(els.codec.value) ? els.codec.value : 'avc';
      setCodec(value);
    });
  }

  function setupResolution() {
    els.resolution.addEventListener('change', () => {
      if (!state.meta || state.exporting) return;
      setResolution(els.resolution.value);
    });

    const fields = [
      [els.width, 'width'],
      [els.height, 'height']
    ];

    for (const [input, axis] of fields) {
      if (!input) continue;
      input.addEventListener('change', () => {
        if (!state.meta || state.exporting) return;
        applyDimensionInput(axis, input.value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('blur', () => syncDimensionInputs());
    }

    els.aspectLock.addEventListener('change', () => {
      if (!state.meta || state.exporting) return;
      state.aspectLocked = els.aspectLock.checked;
      if (state.aspectLocked) {
        const ratio = sourceAspect();
        state.height = even(state.width / ratio);
        syncDimensionInputs();
        afterDimensionChange();
      }
    });
  }

  function setupRateControl() {
    els.rateMode.addEventListener('change', () => {
      if (state.exporting) return;
      state.rateMode = els.rateMode.value === 'size' ? 'size' : 'bitrate';
      state.advancedTouched = true;
      updateRateUi();
      updatePlan();
      updateExportState();
    });

    els.bitrate.addEventListener('change', () => {
      if (state.exporting) return;
      const value = Number(els.bitrate.value);
      if (!Number.isFinite(value) || value <= 0) {
        showBitrateValidation('Enter a video bitrate in Mbps.');
        return;
      }
      state.bitrateMbps = value;
      state.advancedTouched = true;
      clearBitrateValidation();
      updatePlan();
      updateExportState();
    });

    els.bitrate.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.bitrate.blur();
      }
    });

    els.targetSize.addEventListener('change', () => {
      if (state.exporting) return;
      const value = Number(els.targetSize.value);
      if (!Number.isFinite(value) || value <= 0) {
        showTargetValidation('Enter a target file size in megabytes.');
        return;
      }
      state.targetMB = value;
      state.advancedTouched = true;
      clearTargetValidation();
      updatePlan();
      updateExportState();
    });

    els.targetSize.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.targetSize.blur();
      }
    });

    els.crfEnabled.addEventListener('change', () => {
      if (state.exporting) return;
      state.crfEnabled = els.crfEnabled.checked;
      state.advancedTouched = true;
      updateRateUi();
      updatePlan();
      updateExportState();
    });

    els.crf.addEventListener('change', () => {
      if (state.exporting) return;
      const value = Number(els.crf.value);
      if (!Number.isFinite(value)) {
        showCrfValidation('Enter a constant-quality value.');
        return;
      }
      state.crf = Math.round(value);
      state.advancedTouched = true;
      clearCrfValidation();
      updatePlan();
      updateExportState();
    });

    els.fpsCap.addEventListener('change', () => {
      if (state.exporting) return;
      state.fpsCap = Number(els.fpsCap.value) || 0;
      state.advancedTouched = true;
      updateFpsNote();
      updatePlan();
      updateExportState();
    });
  }

  function setupAudio() {
    els.audioKeep.addEventListener('change', () => {
      if (state.exporting) return;
      state.audioKeep = els.audioKeep.checked;
      state.advancedTouched = true;
      updateAudioUi();
      updatePlan();
      scheduleSupportRefresh(120);
      updateExportState();
    });

    els.audioBitrate.addEventListener('change', () => {
      if (state.exporting) return;
      state.audioBitrate = Number(els.audioBitrate.value) || 128;
      state.advancedTouched = true;
      updateAudioUi();
      updatePlan();
      updateExportState();
    });
  }

  function setupExport() {
    els.exportButton.addEventListener('click', startExport);
    els.cancel.addEventListener('click', cancelExport);
    els.newVideo.addEventListener('click', removeVideo);
    els.compressAgain.addEventListener('click', compressAgain);

    els.download.addEventListener('click', () => {
      if (!state.output) return;
      const link = document.createElement('a');
      link.href = state.output.url;
      link.download = state.output.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    els.resultVideo.addEventListener('error', () => {
      if (!state.output) return;
      els.resultNote.textContent =
        'The compressed file was created, but this browser cannot preview it here. Download it and open it in a video app.';
    });
  }

  function updateYear() {
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  async function loadFile(file) {
    if (state.exporting) {
      showError('Wait for the current compression to finish before replacing the video.');
      return;
    }

    const localError = validateFile(file);
    if (localError) {
      showError(`${file && file.name ? file.name + ': ' : ''}${localError}`);
      return;
    }

    state.loading = true;
    clearError();
    setLoading(true, `Reading ${file.name}…`);
    updateExportState();

    try {
      const payload = await requestWorker('inspect', { file });
      if (!payload || !payload.hasVideo) {
        throw new Error('No video track was found in this file.');
      }
      if (!payload.videoDecodable) {
        throw new Error(
          'This browser cannot decode the video in this file, so it cannot be compressed here. Try a different file or browser.'
        );
      }
      if (!Number.isFinite(payload.duration) || payload.duration <= 0) {
        throw new Error('This file has no readable video duration.');
      }

      replaceCurrentVideo(file, payload);
      clearError();
    } catch (error) {
      showError(`${file.name}: ${friendlyError(error)}`);
    } finally {
      state.loading = false;
      setLoading(false);
      updateExportState();
    }
  }

  function validateFile(file) {
    if (!file || !file.name) return 'The file could not be read.';
    if (file.size === 0) return 'The file is empty.';
    if (file.size > MAX_FILE_BYTES) return 'The file is larger than the 2 GB limit for browser-side processing.';
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    if (extension === 'avi') {
      return 'AVI is not decoded by the browser engine used here. Convert the AVI to MP4 or WebM first, then compress it.';
    }
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return 'Unsupported file type. Use MP4, M4V, MOV, WebM or MKV.';
    }
    return null;
  }

  function replaceCurrentVideo(file, payload) {
    releaseCurrentVideo();

    state.file = file;
    state.meta = payload;
    state.url = URL.createObjectURL(file);
    state.thumbnail = payload.thumbnail ? bitmapToDataUrl(payload.thumbnail) : '';
    state.duration = payload.duration;
    state.mode = 'balanced';
    state.format = 'mp4';
    state.codec = 'avc';
    state.resolution = 'original';
    state.width = even(payload.width);
    state.height = even(payload.height);
    state.aspectLocked = true;
    state.rateMode = 'bitrate';
    state.bitrateMbps = 4;
    state.targetMB = defaultTargetSize();
    state.crfEnabled = false;
    state.crf = 28;
    state.fpsCap = 0;
    state.audioKeep = Boolean(payload.hasAudio && payload.audioDecodable);
    state.audioBitrate = 128;
    state.advancedTouched = false;
    state.output = null;
    state.support = null;
    state.supportChecked = false;
    state.supportPending = false;
    state.supportError = false;

    els.editor.hidden = false;
    els.dropzone.hidden = true;
    els.videoError.hidden = true;
    els.videoError.textContent = '';
    els.video.src = state.url;
    els.video.load();

    els.fileName.textContent = file.name;
    els.fileMeta.textContent = [
      formatBytes(file.size),
      payload.container,
      payload.videoCodec ? payload.videoCodec.toUpperCase() : '',
      formatDuration(payload.duration)
    ]
      .filter(Boolean)
      .join(' · ');

    if (state.thumbnail) {
      els.fileThumb.src = state.thumbnail;
      els.fileThumb.hidden = false;
    } else {
      els.fileThumb.removeAttribute('src');
      els.fileThumb.hidden = true;
    }

    els.video.volume = 1;
    els.video.muted = false;
    els.volume.value = '1';
    els.seek.value = '0';
    els.current.textContent = '00:00';
    els.total.textContent = formatClock(payload.duration);
    els.player.classList.add('is-paused');
    els.player.classList.remove('is-playing');

    document.querySelectorAll('input[name="vc-mode"]').forEach((input) => {
      input.checked = input.value === 'balanced';
    });
    els.format.value = 'mp4';
    els.resolution.value = 'original';
    els.customSize.hidden = true;
    els.width.value = String(state.width);
    els.height.value = String(state.height);
    els.aspectLock.checked = true;
    els.rateMode.value = 'bitrate';
    els.bitrate.value = '4';
    els.targetSize.value = String(state.targetMB);
    els.crfEnabled.checked = false;
    els.crf.value = '28';
    els.fpsCap.value = '0';
    els.audioKeep.checked = state.audioKeep;
    els.audioBitrate.value = '128';

    updateAll();
    requestAnimationFrame(() => scheduleSupportRefresh(40));
  }

  function releaseCurrentVideo() {
    stopPlayback();
    if (state.url) {
      URL.revokeObjectURL(state.url);
      state.url = null;
    }
    els.video.removeAttribute('src');
    try {
      els.video.load();
    } catch (error) {
      /* The player may not be ready yet. */
    }
    clearResult();
  }

  function removeVideo() {
    if (state.exporting) return;
    releaseCurrentVideo();
    state.file = null;
    state.meta = null;
    state.thumbnail = '';
    state.duration = 0;
    state.mode = 'balanced';
    state.format = 'mp4';
    state.codec = 'avc';
    state.resolution = 'original';
    state.width = 0;
    state.height = 0;
    state.aspectLocked = true;
    state.rateMode = 'bitrate';
    state.bitrateMbps = 4;
    state.targetMB = 20;
    state.crfEnabled = false;
    state.crf = 28;
    state.fpsCap = 0;
    state.audioKeep = true;
    state.audioBitrate = 128;
    state.advancedTouched = false;
    state.support = null;
    state.supportChecked = false;
    state.supportPending = false;
    state.supportError = false;

    els.editor.hidden = true;
    els.dropzone.hidden = false;
    els.fileThumb.removeAttribute('src');
    els.fileThumb.hidden = true;
    els.warning.hidden = true;
    els.warning.textContent = '';
    els.videoError.hidden = true;
    els.customSize.hidden = true;
    els.advanced.hidden = true;
    clearError();
    clearSizeValidation();
    clearBitrateValidation();
    clearTargetValidation();
    clearCrfValidation();
    resetSupport();
    terminateWorker(true);
    updateAll();
    els.browse.focus({ preventScroll: true });
  }

  function compressAgain() {
    if (!state.output || state.exporting) return;
    clearResult();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.app.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    els.exportButton.focus({ preventScroll: true });
  }

  function setLoading(active, text) {
    state.loading = active;
    els.loading.hidden = !active;
    if (text) els.loadingText.textContent = text;
  }

  function showError(message) {
    els.globalError.textContent = message;
    els.globalError.hidden = false;
  }

  function clearError() {
    els.globalError.textContent = '';
    els.globalError.hidden = true;
  }

  function showSizeValidation(message) {
    els.sizeValidation.textContent = message;
    els.sizeValidation.hidden = false;
  }

  function clearSizeValidation() {
    els.sizeValidation.textContent = '';
    els.sizeValidation.hidden = true;
  }

  function showBitrateValidation(message) {
    els.bitrateValidation.textContent = message;
    els.bitrateValidation.hidden = false;
  }

  function clearBitrateValidation() {
    els.bitrateValidation.textContent = '';
    els.bitrateValidation.hidden = true;
  }

  function showTargetValidation(message) {
    els.targetValidation.textContent = message;
    els.targetValidation.hidden = false;
  }

  function clearTargetValidation() {
    els.targetValidation.textContent = '';
    els.targetValidation.hidden = true;
  }

  function showCrfValidation(message) {
    els.crfNote.textContent = message;
    els.crfNote.classList.add('is-error');
  }

  function clearCrfValidation() {
    updateCrfNote();
  }

  function even(value) {
    return Math.max(2, Math.round(value / 2) * 2);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sourceAspect() {
    if (!state.meta || !state.meta.height) return 16 / 9;
    return state.meta.width / state.meta.height;
  }

  function sourceFps() {
    const value = Number(state.meta && state.meta.fps);
    return Number.isFinite(value) && value > 0 ? value : 30;
  }

  function effectiveFps() {
    const source = sourceFps();
    return state.fpsCap > 0 ? Math.min(source, state.fpsCap) : source;
  }

  function needsAudio() {
    return Boolean(state.meta && state.meta.hasAudio && state.meta.audioDecodable && state.audioKeep);
  }

  function dimsFromTier(tier, ratio) {
    if (!Number.isFinite(tier) || tier <= 0 || !Number.isFinite(ratio) || ratio <= 0) {
      return { width: 2, height: 2 };
    }
    let width;
    let height;
    if (ratio >= 1) {
      height = tier;
      width = tier * ratio;
    } else {
      width = tier;
      height = tier / ratio;
    }
    width = even(width);
    height = even(height);

    if (width > MAX_OUTPUT_EDGE) {
      const scale = MAX_OUTPUT_EDGE / width;
      width = MAX_OUTPUT_EDGE;
      height = even(height * scale);
    }
    if (height > MAX_OUTPUT_EDGE) {
      const scale = MAX_OUTPUT_EDGE / height;
      height = MAX_OUTPUT_EDGE;
      width = even(width * scale);
    }

    return {
      width: Math.max(2, Math.min(MAX_OUTPUT_EDGE, width)),
      height: Math.max(2, Math.min(MAX_OUTPUT_EDGE, height))
    };
  }

  function defaultTargetSize() {
    const bytes = state.file ? state.file.size : 0;
    if (!bytes) return 20;
    const megabytes = (bytes * 0.55) / (1024 * 1024);
    return clamp(Math.round(megabytes * 10) / 10, 0.5, 20000);
  }

  function computeModeBitrate(mode) {
    const config = MODE_TARGETS[mode] || MODE_TARGETS.balanced;
    const pixels = Math.max(2, state.width) * Math.max(2, state.height);
    const fps = effectiveFps();
    let bitrate = pixels * fps * config.bpp;
    const source = Number(state.meta && state.meta.videoBitrate);
    if (Number.isFinite(source) && source > 0) {
      bitrate = Math.min(bitrate, source * config.sourceCap);
    }
    return Math.round(clamp(bitrate, 120000, 30000000));
  }

  function advancedVideoBitrate() {
    if (!state.meta) return 0;
    if (state.rateMode === 'size') {
      const duration = Math.max(0.001, state.meta.duration);
      const totalBits = Math.max(0.1, state.targetMB) * 1024 * 1024 * 8;
      const audioBits = needsAudio() ? activeAudioBitrate() * duration : 0;
      return Math.round((totalBits * 0.98 - audioBits) / duration);
    }
    return Math.round(state.bitrateMbps * 1000000);
  }

  function activeVideoBitrate() {
    return state.mode === 'advanced' ? advancedVideoBitrate() : computeModeBitrate(state.mode);
  }

  function activeAudioBitrate() {
    if (!needsAudio()) return 0;
    if (state.mode === 'advanced') return Math.round(clamp(state.audioBitrate, 24, 512) * 1000);
    return (MODE_TARGETS[state.mode] || MODE_TARGETS.balanced).audio * 1000;
  }

  function invalidDims() {
    return (
      !Number.isFinite(state.width) ||
      !Number.isFinite(state.height) ||
      state.width < 2 ||
      state.height < 2 ||
      state.width > MAX_OUTPUT_EDGE ||
      state.height > MAX_OUTPUT_EDGE
    );
  }

  function badBitrate() {
    return !Number.isFinite(state.bitrateMbps) || state.bitrateMbps < 0.02 || state.bitrateMbps > 100;
  }

  function targetVideoBitrate() {
    if (!state.meta) return 0;
    const duration = Math.max(0.001, state.meta.duration);
    const totalBits = state.targetMB * 1024 * 1024 * 8;
    const audioBits = needsAudio() ? activeAudioBitrate() * duration : 0;
    return Math.round((totalBits * 0.98 - audioBits) / duration);
  }

  function badTarget() {
    if (!Number.isFinite(state.targetMB) || state.targetMB < 0.1 || state.targetMB > 20000) return true;
    return targetVideoBitrate() < 20000;
  }

  function crfMax() {
    return state.codec === 'avc' ? 51 : 63;
  }

  function badCrf() {
    return !Number.isFinite(state.crf) || state.crf < 0 || state.crf > crfMax();
  }

  function setMode(mode) {
    if (!MODE_LABELS[mode] || state.exporting) return;
    const previous = state.mode;
    if (mode === 'advanced' && previous !== 'advanced' && !state.advancedTouched) {
      const suggested = computeModeBitrate(previous);
      state.bitrateMbps = clamp(Math.round(suggested / 10000) / 100, 0.02, 100);
      state.audioBitrate = (MODE_TARGETS[previous] || MODE_TARGETS.balanced).audio;
      state.targetMB = defaultTargetSize();
      els.bitrate.value = String(state.bitrateMbps);
      els.audioBitrate.value = String(state.audioBitrate);
      els.targetSize.value = String(state.targetMB);
    }
    state.mode = mode;
    clearResult();
    updateModeUi();
    updateRateUi();
    updatePlan();
    updateExportState();
  }

  function setFormat(format) {
    if (!FORMATS.includes(format) || state.exporting) return;
    state.format = format;
    const allowed = format === 'webm' ? ['vp9', 'vp8'] : ['avc'];
    if (!allowed.includes(state.codec)) state.codec = allowed[0];
    els.format.value = format;
    clearResult();
    updateFormatUi();
    updateCodecUi();
    updateAudioUi();
    updatePlan();
    updateExportState();
  }

  function setCodec(codec) {
    if (!['avc', 'vp9', 'vp8'].includes(codec) || state.exporting) return;
    state.codec = codec;
    clearResult();
    updateCodecUi();
    updatePlan();
    updateExportState();
  }

  function setResolution(value) {
    if (state.exporting) return;
    if (value !== 'original' && value !== 'custom' && !PRESETS[value]) return;
    state.resolution = value;
    els.resolution.value = value;

    if (value === 'custom') {
      els.customSize.hidden = false;
      state.aspectLocked = els.aspectLock.checked;
    } else {
      els.customSize.hidden = true;
      if (value === 'original') {
        state.width = even(state.meta.width);
        state.height = even(state.meta.height);
      } else {
        const dims = dimsFromTier(PRESETS[value], sourceAspect());
        state.width = dims.width;
        state.height = dims.height;
      }
      syncDimensionInputs();
    }

    clearResult();
    updateSizeNote();
    updateUpscale();
    updatePlan();
    scheduleSupportRefresh(140);
    updateExportState();
  }

  function applyDimensionInput(axis, rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      showSizeValidation('Enter a positive number for this dimension.');
      syncDimensionInputs();
      return;
    }
    let dimension = even(value);
    if (dimension > MAX_OUTPUT_EDGE) {
      dimension = MAX_OUTPUT_EDGE;
      showSizeValidation(`The maximum output edge is ${MAX_OUTPUT_EDGE} px.`);
    } else {
      clearSizeValidation();
    }

    state.resolution = 'custom';
    els.resolution.value = 'custom';
    els.customSize.hidden = false;

    if (axis === 'width') {
      state.width = dimension;
      if (state.aspectLocked) {
        state.height = even(dimension / sourceAspect());
      }
    } else {
      state.height = dimension;
      if (state.aspectLocked) {
        state.width = even(dimension * sourceAspect());
      }
    }

    if (state.width > MAX_OUTPUT_EDGE || state.height > MAX_OUTPUT_EDGE) {
      const scale = MAX_OUTPUT_EDGE / Math.max(state.width, state.height);
      state.width = even(state.width * scale);
      state.height = even(state.height * scale);
    }

    syncDimensionInputs();
    afterDimensionChange();
  }

  function syncDimensionInputs() {
    els.width.value = String(state.width);
    els.height.value = String(state.height);
  }

  function afterDimensionChange() {
    updateSizeNote();
    updateUpscale();
    updatePlan();
    scheduleSupportRefresh(220);
    updateExportState();
  }

  function updateAll() {
    updateModeUi();
    updateFormatUi();
    updateCodecUi();
    updateRateUi();
    updateAudioUi();
    updateFpsNote();
    updateMetaUi();
    updateSizeNote();
    updateUpscale();
    updateWarnings();
    updatePlan();
    updateExportState();
  }

  function updateMetaUi() {
    const meta = state.meta;
    if (!meta) {
      els.sourceDims.textContent = '—';
      return;
    }
    els.sourceDims.textContent = `${meta.width} × ${meta.height}`;
    els.metaDuration.textContent = formatDuration(meta.duration);
    els.metaResolution.textContent = `${meta.width} × ${meta.height}`;
    els.metaFps.textContent = formatFps(meta.fps, meta.fpsVariable);
    els.metaVideo.textContent = meta.videoCodec ? meta.videoCodec.toUpperCase() : 'Unknown';
    els.metaAudio.textContent = formatAudio(meta);
    els.metaRotation.textContent = meta.rotation ? `${meta.rotation}°` : 'None';
    els.metaSize.textContent = state.file ? formatBytes(state.file.size) : '—';
    els.metaBitrate.textContent =
      Number.isFinite(meta.videoBitrate) && meta.videoBitrate > 0
        ? `${(meta.videoBitrate / 1000000).toFixed(2)} Mbps video`
        : 'Not reported';
  }

  function updateModeUi() {
    document.querySelectorAll('input[name="vc-mode"]').forEach((input) => {
      input.checked = input.value === state.mode;
    });
    els.advanced.hidden = state.mode !== 'advanced';
    const notes = {
      high: 'High Quality keeps the most detail with a higher bitrate and a larger file.',
      balanced: 'Balanced is recommended for most videos: a practical size with good detail.',
      smallest: 'Smallest File compresses hardest. Fine detail and fast motion may look softer.',
      advanced: 'Advanced uses the exact bitrate, target size, CRF, frame rate, codec and audio settings below.'
    };
    els.modeNote.textContent = notes[state.mode] || notes.balanced;
  }

  function updateFormatUi() {
    if (!els.format) return;
    const checked = state.supportChecked && Boolean(state.support);
    for (const option of els.format.options) {
      option.disabled = checked ? !formatSupported(option.value) : false;
    }

    if (checked && !formatSupported(state.format)) {
      const next = Array.from(els.format.options).find((option) => !option.disabled);
      if (next) {
        state.format = next.value;
        const allowed = next.value === 'webm' ? ['vp9', 'vp8'] : ['avc'];
        if (!allowed.includes(state.codec)) state.codec = allowed[0];
      }
    }
    els.format.value = state.format;

    if (state.supportPending) {
      els.formatNote.textContent = 'Checking this browser’s encoders for the selected output size…';
    } else if (checked) {
      const available = FORMATS.filter((format) => formatSupported(format));
      if (!available.length) {
        els.formatNote.textContent =
          'This browser cannot encode MP4 or WebM at this output size. Choose a smaller resolution.';
      } else {
        const labels = available.map((format) =>
          format === 'webm' ? 'WebM (VP9/VP8 + Opus)' : 'MP4 (H.264 + AAC)'
        );
        els.formatNote.textContent = `Available at this size: ${labels.join(' and ')}.`;
      }
    } else if (state.supportError) {
      els.formatNote.textContent =
        'Encoder support could not be verified. The export will check again before writing the file.';
    } else if (invalidDims()) {
      els.formatNote.textContent = 'Choose a valid output size first.';
    } else {
      els.formatNote.textContent = 'Formats are enabled only when this browser can encode them at the chosen size.';
    }
  }

  function updateCodecUi() {
    if (!els.codec) return;
    const allowed =
      state.format === 'webm'
        ? [
            { value: 'vp9', label: 'VP9' },
            { value: 'vp8', label: 'VP8' }
          ]
        : [{ value: 'avc', label: 'H.264 (AVC)' }];

    if (!allowed.some((item) => item.value === state.codec)) {
      state.codec = allowed[0].value;
    }

    els.codec.replaceChildren(
      ...allowed.map((item) => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        if (state.supportChecked && state.support) {
          option.disabled = !videoSupported(state.format, item.value);
        }
        return option;
      })
    );

    const current = Array.from(els.codec.options).find((option) => option.value === state.codec);
    if (current && current.disabled) {
      const next = Array.from(els.codec.options).find((option) => !option.disabled);
      if (next) state.codec = next.value;
    }
    els.codec.value = state.codec;

    const max = crfMax();
    els.crf.max = String(max);
    if (state.crf > max) {
      state.crf = max;
      els.crf.value = String(max);
    }

    if (state.supportPending) {
      els.codecNote.textContent = 'Checking which video codecs this browser can encode at this size…';
    } else if (state.supportChecked && state.support) {
      const available = allowed.filter((item) => videoSupported(state.format, item.value));
      els.codecNote.textContent = available.length
        ? `Encodable here: ${available.map((item) => item.label).join(' and ')}.`
        : 'No codec in this container can be encoded at this size. Choose another format or a smaller resolution.';
    } else {
      els.codecNote.textContent = 'Codecs are limited to the ones the selected container and browser can encode.';
    }

    updateCrfNote();
  }

  function updateRateUi() {
    const advanced = state.mode === 'advanced';
    els.advanced.hidden = !advanced;
    els.bitrateField.hidden = state.rateMode !== 'bitrate';
    els.targetField.hidden = state.rateMode !== 'size';
    els.crfField.hidden = !state.crfEnabled;
    els.crfEnabled.checked = state.crfEnabled;
    els.rateMode.value = state.rateMode;
    els.advancedNote.textContent = advanced
      ? 'These settings replace the mode presets for this export.'
      : 'Advanced settings override the selected mode.';
  }

  function updateAudioUi() {
    if (!els.audioKeep) return;
    const meta = state.meta;
    const hasAudio = Boolean(meta && meta.hasAudio);
    const decodable = Boolean(meta && meta.audioDecodable);
    const canKeep = hasAudio && decodable;

    if (!canKeep) state.audioKeep = false;
    els.audioKeep.checked = state.audioKeep;
    els.audioKeep.disabled = state.exporting || !canKeep;
    els.audioField.hidden = !state.audioKeep;
    els.audioBitrate.disabled = state.exporting;

    if (!hasAudio) {
      els.audioCodec.textContent = 'This video has no audio track. The compressed file will be silent.';
    } else if (!decodable) {
      els.audioCodec.textContent =
        'The audio in this file cannot be decoded by this browser, so the compressed file will have no audio.';
    } else if (!state.audioKeep) {
      els.audioCodec.textContent = 'Audio will be removed from the compressed file.';
    } else {
      const codec = state.format === 'webm' ? 'Opus' : 'AAC';
      const kbps = Math.round(activeAudioBitrate() / 1000);
      els.audioCodec.textContent = `Audio is encoded as ${codec} at ${kbps} kbps, normalized to 48 kHz stereo.`;
    }
  }

  function updateFpsNote() {
    if (!els.fpsNote) return;
    if (!state.meta) {
      els.fpsNote.textContent = 'Extra frames above the cap are dropped. Frames are never duplicated.';
      return;
    }
    const source = sourceFps();
    if (!state.fpsCap) {
      els.fpsNote.textContent = `Keep the source rate (~${Math.round(source * 100) / 100} fps). Extra frames are never duplicated.`;
    } else if (state.fpsCap >= source - 0.01) {
      els.fpsNote.textContent = `The source is already at or below ${state.fpsCap} fps, so no frames are dropped.`;
    } else {
      els.fpsNote.textContent = `Source ~${Math.round(source * 100) / 100} fps → up to ${state.fpsCap} fps. Extra frames are dropped, never duplicated.`;
    }
  }

  function updateCrfNote() {
    const notes = {
      avc: 'Typical H.264 values are 18–28. Higher values mean more compression.',
      vp9: 'Typical VP9 values are 24–40. Higher values mean more compression.',
      vp8: 'Typical VP8 values are 20–35. Higher values mean more compression.'
    };
    els.crfNote.classList.remove('is-error');
    els.crfNote.textContent = notes[state.codec] || notes.avc;
  }

  function updateSizeNote() {
    if (!state.meta) {
      els.sizeNote.textContent = 'Original resolution keeps the source size.';
      return;
    }
    if (state.resolution === 'original') {
      els.sizeNote.textContent = `Keep the source resolution (${state.meta.width} × ${state.meta.height}).`;
    } else if (state.resolution === 'custom') {
      els.sizeNote.textContent = state.aspectLocked
        ? `Custom ${state.width} × ${state.height}, locked to the source aspect ratio.`
        : `Custom ${state.width} × ${state.height}. A different aspect is letterboxed, never stretched.`;
    } else {
      els.sizeNote.textContent = `${PRESET_LABELS[state.resolution] || state.resolution} output at ${state.width} × ${state.height}, preserving the source aspect ratio.`;
    }
  }

  function updateUpscale() {
    if (!state.meta) {
      els.upscale.hidden = true;
      els.upscale.textContent = '';
      return;
    }
    const sourcePixels = state.meta.width * state.meta.height;
    const targetPixels = state.width * state.height;
    if (targetPixels > sourcePixels * 1.01) {
      els.upscale.hidden = false;
      els.upscale.textContent = `This output is larger than the source (${state.meta.width} × ${state.meta.height}). Upscaling cannot add detail and makes the file larger and slower to encode.`;
    } else {
      els.upscale.hidden = true;
      els.upscale.textContent = '';
    }
  }

  function updateWarnings() {
    if (!state.meta || !state.file) {
      els.warning.hidden = true;
      els.warning.textContent = '';
      return;
    }
    const messages = [];
    if (state.file.size > LARGE_FILE_BYTES) {
      messages.push(
        `${formatBytes(state.file.size)} input file. Decoding it can use a lot of memory; close other heavy tabs before compressing.`
      );
    }
    if (state.meta.duration > LONG_VIDEO_SECONDS) {
      messages.push(
        `${formatDuration(state.meta.duration)} video. Compression time grows with duration; keep this tab open until it finishes.`
      );
    }
    if (state.width * state.height > 3840 * 2160) {
      messages.push(
        `${state.width} × ${state.height} output is very large. A smaller resolution will finish faster and use less memory.`
      );
    }
    if (messages.length) {
      els.warning.hidden = false;
      els.warning.textContent = messages.join(' ');
    } else {
      els.warning.hidden = true;
      els.warning.textContent = '';
    }
  }

  function formatPlanAudio() {
    if (!state.meta) return '—';
    if (!state.meta.hasAudio) return 'No audio track';
    if (!state.meta.audioDecodable) return 'Removed (cannot decode)';
    if (!state.audioKeep) return 'Removed';
    const codec = state.format === 'webm' ? 'Opus' : 'AAC';
    return `${Math.round(activeAudioBitrate() / 1000)} kbps ${codec}`;
  }

  function formatPlanVideo() {
    if (!state.meta) return '—';
    const bitrate = activeVideoBitrate();
    if (!Number.isFinite(bitrate) || bitrate <= 0) return 'Not valid';
    const mbps = (bitrate / 1000000).toFixed(bitrate >= 1000000 ? 2 : 3);
    if (state.mode === 'advanced' && state.crfEnabled) {
      return `CRF ${state.crf} · ${mbps} Mbps fallback`;
    }
    return `${mbps} Mbps`;
  }

  function updatePlan() {
    if (!state.meta || !state.file) {
      els.planOriginal.textContent = '—';
      els.planOutput.textContent = '—';
      els.planVideo.textContent = '—';
      els.planAudio.textContent = '—';
      els.outputSummary.textContent = 'Add a video to see the compression plan.';
      els.targetHint.hidden = true;
      return;
    }

    const codec = CODEC_LABELS[state.codec] || state.codec.toUpperCase();
    els.planOriginal.textContent = `${state.meta.width} × ${state.meta.height} · ${formatBytes(state.file.size)}`;
    els.planOutput.textContent = `${state.width} × ${state.height} · ${formatLabel(state.format)} ${codec}`;
    els.planVideo.textContent = formatPlanVideo();
    els.planAudio.textContent = formatPlanAudio();

    els.outputSummary.textContent =
      `${MODE_LABELS[state.mode]} · ${state.width} × ${state.height} · ${formatLabel(state.format)} ${codec} · ` +
      `${formatPlanVideo()} video · ${formatPlanAudio()}`;

    if (state.mode === 'advanced' && state.rateMode === 'size') {
      const videoBitrate = targetVideoBitrate();
      if (videoBitrate >= 20000) {
        const mbps = (videoBitrate / 1000000).toFixed(videoBitrate >= 1000000 ? 2 : 3);
        els.targetHint.hidden = false;
        els.targetHint.textContent =
          `${state.targetMB} MB target → ${mbps} Mbps video for ${formatDuration(state.meta.duration)} after audio and container overhead. A goal, not a guarantee.`;
      } else {
        els.targetHint.hidden = true;
        els.targetHint.textContent = '';
      }
    } else {
      els.targetHint.hidden = true;
      els.targetHint.textContent = '';
    }
  }

  function videoSupported(format, codec) {
    if (!state.supportChecked || !state.support) return true;
    const video = state.support.video || {};
    return Boolean(video[`${format}:${codec}`]);
  }

  function audioSupported(format) {
    if (!state.supportChecked || !state.support) return true;
    const audio = state.support.audio || {};
    return Boolean(audio[format === 'webm' ? 'opus' : 'aac']);
  }

  function formatSupported(format) {
    if (!FORMATS.includes(format)) return false;
    const codecs = format === 'webm' ? ['vp9', 'vp8'] : ['avc'];
    const videoOk = codecs.some((codec) => videoSupported(format, codec));
    return videoOk && (!needsAudio() || audioSupported(format));
  }

  function readyToExport() {
    if (!state.meta || !state.file || state.loading || state.exporting) return false;
    if (!state.meta.videoDecodable) return false;
    if (invalidDims()) return false;
    if (state.supportPending) return false;
    if (state.supportChecked && state.support && !videoSupported(state.format, state.codec)) return false;
    if (state.supportChecked && state.support && needsAudio() && !audioSupported(state.format)) return false;
    if (state.mode === 'advanced') {
      if (state.rateMode === 'bitrate' && badBitrate()) return false;
      if (state.rateMode === 'size' && badTarget()) return false;
      if (state.crfEnabled && badCrf()) return false;
    }
    return true;
  }

  function updateExportState() {
    if (!els.exportButton) return;
    const ready = readyToExport();
    els.exportButton.disabled = !ready;
    els.cancel.hidden = !state.exporting;

    if (state.exporting) {
      els.exportNote.textContent = state.canceling
        ? 'Canceling the compression and releasing encoder resources…'
        : 'Re-encoding the video and audio in your browser.';
      return;
    }

    if (!state.meta) {
      els.exportNote.textContent = 'Upload a video to enable compression.';
    } else if (state.loading) {
      els.exportNote.textContent = 'Reading the video…';
    } else if (invalidDims()) {
      els.exportNote.textContent = 'Choose a valid output size.';
    } else if (state.mode === 'advanced' && state.rateMode === 'bitrate' && badBitrate()) {
      els.exportNote.textContent = 'Enter a video bitrate between 0.02 and 100 Mbps.';
    } else if (state.mode === 'advanced' && state.rateMode === 'size' && badTarget()) {
      els.exportNote.textContent = 'Enter a target size that leaves room for the video at this duration.';
    } else if (state.mode === 'advanced' && state.crfEnabled && badCrf()) {
      els.exportNote.textContent = `Enter a constant-quality value between 0 and ${crfMax()}.`;
    } else if (state.supportPending) {
      els.exportNote.textContent = 'Checking encoder support…';
    } else if (state.supportChecked && state.support && !videoSupported(state.format, state.codec)) {
      els.exportNote.textContent = 'This browser cannot encode the selected codec at this size. Choose another codec, format or resolution.';
    } else if (state.supportChecked && state.support && needsAudio() && !audioSupported(state.format)) {
      els.exportNote.textContent = 'This browser cannot encode the selected audio codec. Try the other format or remove the audio.';
    } else if (state.supportError) {
      els.exportNote.textContent = 'Encoder support was not confirmed, but you can still try the compression.';
    } else {
      els.exportNote.textContent =
        `Ready to compress to ${state.width} × ${state.height} ${formatLabel(state.format)} ${CODEC_LABELS[state.codec]}. The file is re-encoded, not copied.`;
    }
  }

  function scheduleSupportRefresh(delay = 180) {
    clearTimeout(supportTimer);
    if (!state.meta) {
      resetSupport();
      updateExportState();
      return;
    }
    if (invalidDims()) {
      state.supportPending = false;
      updateFormatUi();
      updateCodecUi();
      updateExportState();
      return;
    }
    state.supportPending = true;
    state.supportError = false;
    updateFormatUi();
    updateCodecUi();
    updateExportState();
    supportTimer = setTimeout(refreshSupport, delay);
  }

  function resetSupport() {
    clearTimeout(supportTimer);
    supportToken += 1;
    state.supportChecked = false;
    state.supportPending = false;
    state.supportError = false;
    state.support = null;
  }

  async function refreshSupport() {
    if (!state.meta) return;
    if (state.exporting) {
      state.supportPending = false;
      updateExportState();
      return;
    }
    if (invalidDims()) {
      state.supportPending = false;
      updateExportState();
      return;
    }

    const token = ++supportToken;
    try {
      const result = await requestWorker('support', {
        options: {
          width: state.width,
          height: state.height,
          needsAudio: needsAudio()
        }
      });
      if (token !== supportToken) return;
      state.support = result || { video: {}, audio: {} };
      state.supportChecked = true;
      state.supportPending = false;
      state.supportError = false;
      updateFormatUi();
      updateCodecUi();
      updateAudioUi();
      updatePlan();
      updateExportState();
    } catch (error) {
      if (token !== supportToken) return;
      state.supportChecked = false;
      state.supportPending = false;
      state.supportError = true;
      state.support = null;
      updateFormatUi();
      updateCodecUi();
      updateExportState();
    }
  }

  async function startExport() {
    if (!state.meta || !state.file || state.exporting) return;

    if (invalidDims()) {
      showError('The output size is not valid. Choose a preset or enter a valid custom size.');
      return;
    }
    if (state.mode === 'advanced' && state.rateMode === 'bitrate' && badBitrate()) {
      showError('Enter a valid video bitrate between 0.02 and 100 Mbps.');
      return;
    }
    if (state.mode === 'advanced' && state.rateMode === 'size' && badTarget()) {
      showError('The target size is too small for this clip and audio bitrate. Increase it or lower the audio bitrate.');
      return;
    }
    if (state.mode === 'advanced' && state.crfEnabled && badCrf()) {
      showError(`Enter a constant-quality value between 0 and ${crfMax()}.`);
      return;
    }

    if (!state.supportChecked || state.supportPending) {
      clearTimeout(supportTimer);
      state.supportPending = false;
      await refreshSupport();
    }
    if (state.supportChecked && state.support && !videoSupported(state.format, state.codec)) {
      showError('This browser cannot encode the selected codec at this output size. Choose another codec, format or resolution.');
      updateExportState();
      return;
    }
    if (state.supportChecked && state.support && needsAudio() && !audioSupported(state.format)) {
      showError('This browser cannot encode the selected audio codec. Try the other format or remove the audio.');
      updateExportState();
      return;
    }

    clearTimeout(supportTimer);
    state.supportPending = false;
    state.exporting = true;
    state.canceling = false;
    state.progressStartedAt = performance.now();
    clearError();
    clearSizeValidation();
    clearBitrateValidation();
    clearTargetValidation();
    clearCrfValidation();
    clearResult();
    stopPlayback();
    setControlsDisabled(true);

    els.progress.hidden = false;
    els.result.hidden = true;
    els.progressBar.style.width = '0%';
    els.progressTrack.setAttribute('aria-valuenow', '0');
    els.progressLabel.textContent = 'Preparing the compression…';
    els.progressTiming.textContent = '';
    updateExportState();

    const quantizer = state.mode === 'advanced' && state.crfEnabled ? state.crf : null;

    try {
      const payload = await requestWorker('export', {
        file: state.file,
        options: {
          width: state.width,
          height: state.height,
          format: state.format,
          codec: state.codec,
          videoBitrate: Math.round(activeVideoBitrate()),
          audio: needsAudio() ? 'keep' : 'remove',
          audioBitrate: Math.round(activeAudioBitrate()),
          fpsCap: state.fpsCap,
          quantizer,
          sourceFps: sourceFps(),
          background: '#000000'
        }
      });

      if (!payload || !payload.buffer) {
        throw new Error('The compression did not return a video file.');
      }

      const blob = new Blob([payload.buffer], { type: payload.mimeType });
      const url = URL.createObjectURL(blob);
      state.output = {
        blob,
        url,
        filename: makeOutputName(payload.extension),
        mimeType: payload.mimeType,
        extension: payload.extension,
        duration: payload.duration,
        width: payload.width,
        height: payload.height,
        hasAudio: payload.hasAudio,
        size: blob.size,
        videoCodec: payload.videoCodec,
        audioCodec: payload.audioCodec,
        sourceFrames: payload.sourceFrames,
        encodedFrames: payload.encodedFrames
      };
      renderResult();
      els.progressBar.style.width = '100%';
      els.progressTrack.setAttribute('aria-valuenow', '100');
      els.progressLabel.textContent = 'Compression complete. The file was verified.';
      els.progressTiming.textContent = '';
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (state.canceling || /cancel/i.test(message)) {
        showError('Compression canceled. No file was created, and encoder resources were released.');
      } else {
        showError(friendlyError(error));
      }
    } finally {
      state.exporting = false;
      state.canceling = false;
      els.progress.hidden = true;
      setControlsDisabled(false);
      updatePlan();
      updateExportState();
    }
  }

  function cancelExport() {
    if (!state.exporting || state.canceling) return;
    state.canceling = true;
    els.progressLabel.textContent = 'Canceling the compression…';
    updateExportState();
    try {
      if (worker) worker.postMessage({ type: 'cancel' });
    } catch (error) {
      /* The worker may already be gone; the pending export will reject. */
    }
  }

  function updateProgress(message) {
    if (!state.exporting) return;
    if (state.canceling) {
      els.progressLabel.textContent = 'Canceling the compression…';
      return;
    }
    const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    const percent = Math.round(progress * 100);
    els.progressBar.style.width = `${percent}%`;
    els.progressTrack.setAttribute('aria-valuenow', String(percent));

    if (message.phase === 'audio') {
      els.progressLabel.textContent = `Processing audio… ${percent}%`;
    } else if (message.phase === 'finalizing') {
      els.progressLabel.textContent = 'Finalizing and verifying the file…';
    } else {
      els.progressLabel.textContent = `Encoding video frames… ${percent}%`;
    }

    const elapsed = (performance.now() - state.progressStartedAt) / 1000;
    let timing = `Elapsed ${formatClock(elapsed)}`;
    if (message.phase === 'video' && progress > 0.05 && progress < 0.85 && elapsed > 3) {
      const totalEstimate = (elapsed * 0.85) / progress;
      const remaining = totalEstimate - elapsed;
      if (remaining > 0 && remaining < 7200) {
        timing += ` · about ${formatClock(Math.ceil(remaining))} remaining (estimated)`;
      }
    }
    els.progressTiming.textContent = timing;
  }

  function renderResult() {
    const output = state.output;
    if (!output || !state.meta || !state.file) return;

    const before = state.file.size;
    const after = output.size;
    const saved = before - after;
    const grew = saved < 0;
    const percent = before > 0 ? (saved / before) * 100 : 0;

    els.result.hidden = false;
    els.resultNote.textContent =
      `${state.meta.width} × ${state.meta.height} → ${output.width} × ${output.height}. Measured after re-encoding on this device.`;
    els.resultVideo.src = output.url;
    els.resultVideo.load();

    els.resultBefore.textContent = formatBytes(before);
    els.resultBeforeDetail.textContent = `${state.meta.width} × ${state.meta.height} · ${formatDuration(state.meta.duration)}`;
    els.resultAfter.textContent = formatBytes(after);
    els.resultAfterDetail.textContent = `${output.width} × ${output.height} · ${formatDuration(output.duration)}`;
    els.resultSaved.textContent = grew
      ? `${formatBytes(Math.abs(saved))} increase`
      : `${formatBytes(saved)} saved`;
    els.resultPercent.textContent = grew
      ? `+${Math.abs(percent).toFixed(1)}% larger`
      : `${percent.toFixed(1)}% smaller`;
    els.compare.classList.toggle('is-increase', grew);

    if (grew) {
      els.resultWarning.hidden = false;
      els.resultWarning.textContent =
        `The compressed file is ${formatBytes(Math.abs(saved))} larger than the source (${Math.abs(percent).toFixed(1)}%). ` +
        'The source was already heavily compressed. Try Smallest File, a lower resolution, a frame-rate cap or Remove audio.';
    } else if (saved === 0) {
      els.resultWarning.hidden = false;
      els.resultWarning.textContent =
        'The compressed file is exactly the same size as the source. Try a lower bitrate, a lower resolution or a frame-rate cap.';
    } else {
      els.resultWarning.hidden = true;
      els.resultWarning.textContent = '';
    }

    els.resultName.textContent = output.filename;
    els.resultFormat.textContent = `${formatLabel(output.extension)} · ${resultFormatDetail(output)}`;
    els.resultResolution.textContent = `${output.width} × ${output.height}`;
    els.resultDuration.textContent = formatDuration(output.duration);
    els.resultAudio.textContent = output.hasAudio
      ? `${CODEC_LABELS[output.audioCodec] || 'Audio'} · preserved`
      : 'No audio track';
    els.resultMode.textContent = resultModeLabel();
    els.resultSavedBytes.textContent = grew
      ? `${formatBytes(Math.abs(saved))} larger`
      : `${formatBytes(saved)} saved`;
    els.resultReduction.textContent = grew
      ? `−${Math.abs(percent).toFixed(1)}%`
      : `${percent.toFixed(1)}%`;

    els.download.disabled = false;
    els.download.dataset.filename = output.filename;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.result.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  function resultModeLabel() {
    if (state.mode === 'advanced') {
      const parts = ['Advanced'];
      if (state.crfEnabled) parts.push(`CRF ${state.crf}`);
      if (state.rateMode === 'size') parts.push(`${state.targetMB} MB target`);
      else parts.push(`${(activeVideoBitrate() / 1000000).toFixed(2)} Mbps`);
      return parts.join(' · ');
    }
    return MODE_LABELS[state.mode] || 'Balanced';
  }

  function resultFormatDetail(output) {
    const video = CODEC_LABELS[output.videoCodec] || (state.codec === 'avc' ? 'H.264' : state.codec.toUpperCase());
    if (!output.hasAudio) return `${video} · no audio`;
    const audio = CODEC_LABELS[output.audioCodec] || (state.format === 'webm' ? 'Opus' : 'AAC');
    return `${video} + ${audio}`;
  }

  function clearResult() {
    if (state.output && state.output.url) {
      URL.revokeObjectURL(state.output.url);
    }
    state.output = null;
    if (!els.result) return;
    els.result.hidden = true;
    els.resultVideo.removeAttribute('src');
    try {
      els.resultVideo.load();
    } catch (error) {
      /* The result video may not be attached yet. */
    }
    els.download.disabled = true;
    delete els.download.dataset.filename;
    if (els.compare) els.compare.classList.remove('is-increase');
  }

  function makeOutputName(extension) {
    const base = state.file
      ? state.file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[\\/:*?"<>|]+/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    return `${base || 'video'}-compressed-${state.width}x${state.height}.${extension}`;
  }

  function togglePlayback() {
    if (!state.meta) return;
    if (els.video.paused || els.video.ended) {
      const playPromise = els.video.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(() => {
          els.videoError.hidden = false;
          els.videoError.textContent = 'Playback was blocked by the browser. Press play again to start the preview.';
        });
      }
    } else {
      els.video.pause();
    }
  }

  function stopPlayback() {
    try {
      els.video.pause();
      els.video.currentTime = 0;
    } catch (error) {
      /* The video may not have a source yet. */
    }
    els.player.classList.add('is-paused');
    els.player.classList.remove('is-playing');
    updatePlayButton();
  }

  function seekBy(seconds) {
    const duration = playerDuration();
    if (!duration) return;
    try {
      els.video.currentTime = clamp(els.video.currentTime + seconds, 0, duration);
    } catch (error) {
      /* Seeking can fail before metadata is ready. */
    }
    updateTimeDisplay();
  }

  function toggleFullscreen() {
    if (!state.meta) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (els.player.requestFullscreen) {
      els.player.requestFullscreen().catch(() => {
        showError('Fullscreen is not available in this browser. Use the browser’s own fullscreen control instead.');
      });
    }
  }

  function playerDuration() {
    const duration = Number(els.video.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    return Number(state.duration) || 0;
  }

  function updateTimeDisplay() {
    const duration = playerDuration();
    const current = Number(els.video.currentTime) || 0;
    els.current.textContent = formatClock(current);
    els.total.textContent = formatClock(duration || state.duration);
    const ratio = duration > 0 ? clamp(current / duration, 0, 1) : 0;
    els.seek.value = String(Math.round(ratio * 1000));
    els.seek.setAttribute('aria-valuetext', `${formatClock(current)} of ${formatClock(duration)}`);
  }

  function updatePlayButton() {
    const playing = !els.video.paused && !els.video.ended;
    const path = playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'
      : '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>';
    els.play.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
    els.play.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
    els.play.setAttribute('title', playing ? 'Pause' : 'Play');
    els.bigPlay.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  }

  function updateVolumeUi() {
    const muted = els.video.muted || els.video.volume === 0;
    els.mute.setAttribute('aria-label', muted ? 'Unmute video' : 'Mute video');
    els.mute.setAttribute('title', muted ? 'Unmute' : 'Mute');
    els.mute.innerHTML = muted
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    if (!els.video.muted) els.volume.value = String(els.video.volume);
  }

  function setControlsDisabled(disabled) {
    if (!els.editor) return;
    els.editor.querySelectorAll('input, select').forEach((control) => {
      control.disabled = disabled;
    });
    if (els.replace) els.replace.disabled = disabled;
    if (els.remove) els.remove.disabled = disabled;
    els.editor.classList.toggle('is-busy', disabled);
    if (!disabled) {
      updateAudioUi();
      updateCodecUi();
    }
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const millis = totalMs % 1000;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const ms = String(millis).padStart(3, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}.${ms}` : `${mm}:${ss}.${ms}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }

  function formatFps(fps, variable) {
    if (!Number.isFinite(fps) || fps <= 0) return 'Not reported';
    const rounded = Math.round(fps * 100) / 100;
    return variable ? `~${rounded} fps (variable)` : `${rounded} fps`;
  }

  function formatAudio(meta) {
    if (!meta.hasAudio) return 'No audio track';
    if (!meta.audioDecodable) return 'Audio not decodable';
    const codec = (meta.audioCodec || 'Audio').toUpperCase();
    const channels = meta.audioChannels ? `${meta.audioChannels} ch` : '';
    const rate = meta.audioSampleRate ? `${Math.round(meta.audioSampleRate / 1000)} kHz` : '';
    return [codec, channels, rate].filter(Boolean).join(' · ');
  }

  function formatLabel(format) {
    return format === 'webm' ? 'WebM' : 'MP4';
  }

  function bitmapToDataUrl(bitmap) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.drawImage(bitmap, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      try {
        bitmap.close();
      } catch (error) {
        /* The bitmap may already be closed. */
      }
    }
  }

  function friendlyError(error) {
    const message = error && error.message ? error.message : String(error);
    if (/cancel/i.test(message)) return 'Compression canceled. No file was created.';
    if (/could not be read as a supported video|cannot decode|no video track|no readable video duration|does not contain a video/i.test(message)) {
      return message;
    }
    if (/memory|allocation|too large|array buffer|quota/i.test(message)) {
      return 'This compression ran out of memory. Try a shorter video, a smaller output resolution, or close other memory-heavy tabs.';
    }
    if (/audio/i.test(message) && /decode|encode|support|codec/i.test(message)) return message;
    if (/decode|codec|decodable|encode/i.test(message)) {
      return `This browser cannot process part of this video. ${message}`;
    }
    if (/format|unsupported|parse|demux|read|container|duration/i.test(message)) {
      return `This file could not be read as a supported video. Try an MP4, WebM, MOV, M4V or MKV file that plays in this browser. ${message}`;
    }
    return message;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./video-compressor-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const error = new Error('The video processing worker stopped. Try reloading the page.');
      rejectPending(error);
      terminateWorker(true);
      showError(error.message);
      state.exporting = false;
      state.canceling = false;
      state.loading = false;
      els.progress.hidden = true;
      setLoading(false);
      setControlsDisabled(false);
      updateExportState();
    };
    return worker;
  }

  function requestWorker(type, payload, transfer = []) {
    const activeWorker = ensureWorker();
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        activeWorker.postMessage({ id, type, ...payload }, transfer);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === 'progress') {
      updateProgress(message);
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);

    if (message.type === 'error') {
      const error = new Error(message.message || 'The video processing worker failed.');
      error.name = message.name || 'Error';
      entry.reject(error);
    } else {
      entry.resolve(message.payload);
    }
  }

  function rejectPending(error) {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }

  function terminateWorker(silent) {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (!silent) rejectPending(new Error('The video processing worker was closed.'));
  }

  function shutdown() {
    clearTimeout(supportTimer);
    terminateWorker(true);
    if (state.url) URL.revokeObjectURL(state.url);
    if (state.output && state.output.url) URL.revokeObjectURL(state.output.url);
  }

  function exposeDebugApi() {
    window.__videoCompressor = {
      getState() {
        const output = state.output;
        const before = state.file ? state.file.size : 0;
        const saved = output ? before - output.size : 0;
        const percent = output && before > 0 ? (saved / before) * 100 : 0;
        return {
          ready: Boolean(state.meta),
          file: state.file
            ? { name: state.file.name, size: state.file.size, type: state.file.type }
            : null,
          meta: state.meta
            ? {
                width: state.meta.width,
                height: state.meta.height,
                rotation: state.meta.rotation,
                duration: state.meta.duration,
                fps: state.meta.fps,
                fpsVariable: state.meta.fpsVariable,
                hasAudio: state.meta.hasAudio,
                audioCodec: state.meta.audioCodec,
                audioChannels: state.meta.audioChannels,
                audioSampleRate: state.meta.audioSampleRate,
                audioBitrate: state.meta.audioBitrate,
                videoBitrate: state.meta.videoBitrate,
                videoDecodable: state.meta.videoDecodable,
                audioDecodable: state.meta.audioDecodable,
                container: state.meta.container,
                videoCodec: state.meta.videoCodec
              }
            : null,
          mode: state.mode,
          format: state.format,
          codec: state.codec,
          resolution: state.resolution,
          width: state.width,
          height: state.height,
          aspectLocked: state.aspectLocked,
          rateMode: state.rateMode,
          bitrateMbps: state.bitrateMbps,
          targetMB: state.targetMB,
          crfEnabled: state.crfEnabled,
          crf: state.crf,
          fpsCap: state.fpsCap,
          audioKeep: state.audioKeep,
          audioBitrate: state.audioBitrate,
          plan: {
            videoBitrate: activeVideoBitrate(),
            audioBitrate: activeAudioBitrate(),
            targetVideoBitrate: state.mode === 'advanced' && state.rateMode === 'size' ? targetVideoBitrate() : null
          },
          supportChecked: state.supportChecked,
          supportPending: state.supportPending,
          supportError: state.supportError,
          support: state.support
            ? {
                video: { ...(state.support.video || {}) },
                audio: { ...(state.support.audio || {}) }
              }
            : null,
          exporting: state.exporting,
          canceling: state.canceling,
          output: output
            ? {
                filename: output.filename,
                mimeType: output.mimeType,
                duration: output.duration,
                width: output.width,
                height: output.height,
                hasAudio: output.hasAudio,
                size: output.size,
                videoCodec: output.videoCodec,
                audioCodec: output.audioCodec,
                sourceFrames: output.sourceFrames,
                encodedFrames: output.encodedFrames,
                saved,
                percent,
                mode: resultModeLabel(),
                url: output.url
              }
            : null
        };
      },
      getOutputUrl() {
        return state.output ? state.output.url : null;
      },
      getOutputBlob() {
        return state.output ? state.output.blob : null;
      },
      setMode(mode) {
        if (!MODE_LABELS[mode]) return false;
        document.querySelectorAll('input[name="vc-mode"]').forEach((input) => {
          input.checked = input.value === mode;
        });
        setMode(mode);
        return true;
      },
      setFormat(format) {
        if (!FORMATS.includes(format)) return false;
        setFormat(format);
        return true;
      },
      setResolution(value) {
        if (value !== 'original' && value !== 'custom' && !PRESETS[value]) return false;
        setResolution(value);
        return true;
      },
      setSize(width, height) {
        if (!state.meta) return false;
        const w = even(Number(width));
        const h = even(Number(height));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2 || w > MAX_OUTPUT_EDGE || h > MAX_OUTPUT_EDGE) {
          return false;
        }
        state.aspectLocked = false;
        state.resolution = 'custom';
        state.width = w;
        state.height = h;
        els.aspectLock.checked = false;
        els.resolution.value = 'custom';
        els.customSize.hidden = false;
        clearSizeValidation();
        syncDimensionInputs();
        afterDimensionChange();
        return true;
      },
      setAspectLock(locked) {
        els.aspectLock.checked = Boolean(locked);
        state.aspectLocked = Boolean(locked);
        if (state.aspectLocked) {
          state.height = even(state.width / sourceAspect());
          syncDimensionInputs();
          afterDimensionChange();
        }
      },
      setRateMode(mode) {
        if (mode !== 'bitrate' && mode !== 'size') return false;
        state.rateMode = mode;
        state.advancedTouched = true;
        updateRateUi();
        updatePlan();
        updateExportState();
        return true;
      },
      setBitrate(mbps) {
        const value = Number(mbps);
        if (!Number.isFinite(value) || value <= 0) return false;
        state.bitrateMbps = value;
        state.advancedTouched = true;
        els.bitrate.value = String(value);
        clearBitrateValidation();
        updatePlan();
        updateExportState();
        return true;
      },
      setTargetSize(mb) {
        const value = Number(mb);
        if (!Number.isFinite(value) || value <= 0) return false;
        state.targetMB = value;
        state.advancedTouched = true;
        els.targetSize.value = String(value);
        clearTargetValidation();
        updatePlan();
        updateExportState();
        return true;
      },
      setCrfEnabled(enabled) {
        state.crfEnabled = Boolean(enabled);
        state.advancedTouched = true;
        updateRateUi();
        updatePlan();
        updateExportState();
        return true;
      },
      setCrf(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return false;
        state.crf = Math.round(number);
        state.advancedTouched = true;
        els.crf.value = String(state.crf);
        clearCrfValidation();
        updatePlan();
        updateExportState();
        return true;
      },
      setFpsCap(fps) {
        const value = Number(fps) || 0;
        if (value < 0 || value > 240) return false;
        state.fpsCap = value;
        state.advancedTouched = true;
        els.fpsCap.value = String(value);
        updateFpsNote();
        updatePlan();
        updateExportState();
        return true;
      },
      setCodec(codec) {
        if (!['avc', 'vp9', 'vp8'].includes(codec)) return false;
        setCodec(codec);
        return true;
      },
      setAudioKeep(keep) {
        state.audioKeep = Boolean(keep);
        state.advancedTouched = true;
        updateAudioUi();
        updatePlan();
        scheduleSupportRefresh(120);
        updateExportState();
        return true;
      },
      setAudioBitrate(kbps) {
        const value = Number(kbps);
        if (!Number.isFinite(value) || value <= 0) return false;
        state.audioBitrate = value;
        state.advancedTouched = true;
        els.audioBitrate.value = String(value);
        updateAudioUi();
        updatePlan();
        updateExportState();
        return true;
      },
      startExport() {
        return startExport();
      },
      cancelExport() {
        cancelExport();
      },
      removeVideo() {
        removeVideo();
      }
    };
  }
})();
