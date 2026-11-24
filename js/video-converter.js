/* Video Converter controller.
 * Two modes share one page and one canonical URL:
 *   - Video to Video: decode, re-encode and mux into MP4, WebM, MOV or MKV.
 *   - Video to Audio: decode one audio track and encode MP3, WAV, M4A or AAC.
 * All processing happens in a Web Worker on this device. */

(() => {
  'use strict';

  const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
  const LARGE_FILE_BYTES = 700 * 1024 * 1024;
  const LONG_VIDEO_SECONDS = 10 * 60;
  const MAX_OUTPUT_EDGE = 4096;

  const ACCEPTED_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];

  // Container -> codecs this engine can mux. The worker probes which of these
  // the browser can actually encode at the chosen size before they are offered.
  const VIDEO_FORMATS = {
    mp4: { label: 'MP4', codecs: ['avc', 'hevc'], audioCodec: 'aac', audioLabel: 'AAC', extension: 'mp4' },
    webm: { label: 'WebM', codecs: ['vp9', 'vp8', 'av1'], audioCodec: 'opus', audioLabel: 'Opus', extension: 'webm' },
    mov: { label: 'MOV', codecs: ['avc', 'hevc'], audioCodec: 'aac', audioLabel: 'AAC', extension: 'mov' },
    mkv: { label: 'MKV', codecs: ['avc', 'hevc', 'vp9', 'av1'], audioCodec: 'aac', audioLabel: 'AAC', extension: 'mkv' }
  };

  const AUDIO_FORMATS = {
    mp3: { label: 'MP3', extension: 'mp3', compressed: true, codecLabel: 'MP3' },
    wav: { label: 'WAV', extension: 'wav', compressed: false, codecLabel: 'PCM 16-bit' },
    m4a: { label: 'M4A', extension: 'm4a', compressed: true, codecLabel: 'AAC' },
    aac: { label: 'AAC', extension: 'aac', compressed: true, codecLabel: 'AAC' }
  };

  const CODEC_LABELS = {
    avc: 'H.264',
    hevc: 'HEVC (H.265)',
    vp9: 'VP9',
    vp8: 'VP8',
    av1: 'AV1',
    aac: 'AAC',
    opus: 'Opus',
    mp3: 'MP3',
    'pcm-s16': 'PCM 16-bit'
  };

  const PRESET_LABELS = {
    high: 'High Quality',
    balanced: 'Balanced',
    smaller: 'Smaller File'
  };

  // Bits per pixel per second, plus how much of the source video bitrate a
  // preset may use. Conversion is not promised to shrink a file: Balanced
  // stays near the source bitrate, High Quality may exceed it, and Smaller
  // File deliberately spends less data.
  const PRESET_TARGETS = {
    high: { bpp: 0.14, sourceCap: 1.2, floorBpp: 0.09, audio: 192 },
    balanced: { bpp: 0.1, sourceCap: 0.95, floorBpp: 0.06, audio: 160 },
    smaller: { bpp: 0.065, sourceCap: 0.65, floorBpp: 0.04, audio: 128 }
  };

  const RESOLUTIONS = {
    '2160': 2160,
    '1440': 1440,
    '1080': 1080,
    '720': 720,
    '480': 480,
    '360': 360
  };

  const RESOLUTION_LABELS = {
    '2160': '4K',
    '1440': '1440p',
    '1080': '1080p',
    '720': '720p',
    '480': '480p',
    '360': '360p'
  };

  const state = {
    file: null,
    url: null,
    thumbnail: '',
    meta: null,
    toolMode: 'video',
    preset: 'balanced',
    format: 'mp4',
    codec: 'avc',
    resolution: 'original',
    width: 0,
    height: 0,
    aspectLocked: true,
    fpsCap: 0,
    bitrateOverride: false,
    bitrateMbps: 4,
    crfEnabled: false,
    crf: 28,
    audioKeep: true,
    audioBitrate: 160,
    audioFormat: 'mp3',
    audioQuality: 192,
    sampleRate: 48000,
    channels: 2,
    trackIndex: 0,
    duration: 0,
    loading: false,
    exporting: false,
    canceling: false,
    exportMode: 'video',
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
    setupToolModes();
    setupPresets();
    setupFormatAndCodec();
    setupResolution();
    setupVideoAudio();
    setupAdvanced();
    setupAudioMode();
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
      metaAspect: '[data-meta-aspect]',
      metaFps: '[data-meta-fps]',
      metaVideo: '[data-meta-video]',
      metaAudio: '[data-meta-audio]',
      metaTracks: '[data-meta-tracks]',
      metaContainer: '[data-meta-container]',
      metaSize: '[data-meta-size]',
      metaBitrate: '[data-meta-bitrate]',
      videoSettings: '[data-video-settings]',
      audioSettings: '[data-audio-settings]',
      modeNote: '[data-mode-note]',
      format: '[data-format]',
      formatNote: '[data-format-note]',
      codec: '[data-codec]',
      codecNote: '[data-codec-note]',
      resolution: '[data-resolution]',
      customSize: '[data-custom-size]',
      width: '[data-width]',
      height: '[data-height]',
      aspectLock: '[data-aspect-lock]',
      sizeNote: '[data-size-note]',
      upscale: '[data-upscale]',
      sizeValidation: '[data-size-validation]',
      audioKeep: '[data-audio-keep]',
      audioField: '[data-audio-field]',
      audioBitrate: '[data-audio-bitrate]',
      audioCodec: '[data-audio-codec]',
      advanced: '[data-advanced]',
      bitrateOverride: '[data-bitrate-override]',
      bitrateField: '[data-bitrate-field]',
      bitrate: '[data-bitrate]',
      bitrateValidation: '[data-bitrate-validation]',
      fpsCap: '[data-fps-cap]',
      fpsNote: '[data-fps-note]',
      crfEnabled: '[data-crf-enabled]',
      crfField: '[data-crf-field]',
      crf: '[data-crf]',
      crfNote: '[data-crf-note]',
      advancedNote: '[data-advanced-note]',
      audioMissing: '[data-audio-missing]',
      audioFormat: '[data-audio-format]',
      audioFormatNote: '[data-audio-format-note]',
      audioQualityField: '[data-audio-quality-field]',
      audioQuality: '[data-audio-quality]',
      audioQualityNote: '[data-audio-quality-note]',
      sampleRate: '[data-sample-rate]',
      channels: '[data-channels]',
      trackField: '[data-track-field]',
      track: '[data-track]',
      trackNote: '[data-track-note]',
      audioSupportNote: '[data-audio-support-note]',
      planSource: '[data-plan-source]',
      planOutput: '[data-plan-output]',
      planThird: '[data-plan-third]',
      planThirdLabel: '[data-plan-third-label]',
      planFourth: '[data-plan-fourth]',
      planFourthLabel: '[data-plan-fourth-label]',
      outputSummary: '[data-output-summary]',
      exportButton: '[data-export]',
      cancel: '[data-cancel]',
      exportNote: '[data-export-note]',
      progress: '[data-progress]',
      progressTrack: '[data-progress-track]',
      progressBar: '[data-progress-bar]',
      progressLabel: '[data-progress-label]',
      progressTiming: '[data-progress-timing]',
      result: '[data-result]',
      resultTitle: '[data-result-title]',
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
      resultAudio: '[data-result-audio]',
      resultMeta: '[data-result-meta]',
      download: '[data-download]',
      convertAgain: '[data-convert-again]',
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
        showError('This tool converts one video at a time. The first file was loaded; remove it before adding another.');
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
        showError('This tool converts one video at a time. The first file was loaded.');
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
        'This browser cannot play this file directly. Conversion may still work because the worker uses a separate decoder.';
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

  function setupToolModes() {
    document.querySelectorAll('input[name="cv-tool-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || state.exporting) return;
        setToolMode(input.value);
      });
    });
  }

  function setupPresets() {
    document.querySelectorAll('input[name="cv-preset"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || state.exporting) return;
        setPreset(input.value);
      });
    });
  }

  function setupFormatAndCodec() {
    els.format.addEventListener('change', () => {
      if (state.exporting) return;
      setFormat(els.format.value);
    });

    els.codec.addEventListener('change', () => {
      if (state.exporting) return;
      setCodec(els.codec.value);
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
        state.height = even(state.width / sourceAspect());
        syncDimensionInputs();
        afterDimensionChange();
      }
    });
  }

  function setupVideoAudio() {
    els.audioKeep.addEventListener('change', () => {
      if (state.exporting) return;
      state.audioKeep = els.audioKeep.checked;
      updateAudioUi();
      updateFormatUi();
      updatePlan();
      updateExportState();
    });

    els.audioBitrate.addEventListener('change', () => {
      if (state.exporting) return;
      state.audioBitrate = Number(els.audioBitrate.value) || 160;
      updateAudioUi();
      updatePlan();
      updateExportState();
    });
  }

  function setupAdvanced() {
    els.bitrateOverride.addEventListener('change', () => {
      if (state.exporting) return;
      state.bitrateOverride = els.bitrateOverride.checked;
      if (state.bitrateOverride && !Number.isFinite(Number(els.bitrate.value))) {
        els.bitrate.value = String(state.bitrateMbps);
      }
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
      state.bitrateOverride = true;
      els.bitrateOverride.checked = true;
      clearBitrateValidation();
      updateRateUi();
      updatePlan();
      updateExportState();
    });

    els.bitrate.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.bitrate.blur();
      }
    });

    els.crfEnabled.addEventListener('change', () => {
      if (state.exporting) return;
      state.crfEnabled = els.crfEnabled.checked;
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
      clearCrfValidation();
      updateRateUi();
      updatePlan();
      updateExportState();
    });

    els.fpsCap.addEventListener('change', () => {
      if (state.exporting) return;
      state.fpsCap = Number(els.fpsCap.value) || 0;
      updateFpsNote();
      updatePlan();
      updateExportState();
    });
  }

  function setupAudioMode() {
    els.audioFormat.addEventListener('change', () => {
      if (state.exporting) return;
      setAudioFormat(els.audioFormat.value);
    });

    els.audioQuality.addEventListener('change', () => {
      if (state.exporting) return;
      setAudioQuality(Number(els.audioQuality.value));
    });

    els.sampleRate.addEventListener('change', () => {
      if (state.exporting) return;
      setSampleRate(Number(els.sampleRate.value));
    });

    els.channels.addEventListener('change', () => {
      if (state.exporting) return;
      setChannels(Number(els.channels.value));
    });

    els.track.addEventListener('change', () => {
      if (state.exporting) return;
      setTrackIndex(Number(els.track.value));
    });
  }

  function setupExport() {
    els.exportButton.addEventListener('click', startExport);
    els.cancel.addEventListener('click', cancelExport);
    els.newVideo.addEventListener('click', removeVideo);
    els.convertAgain.addEventListener('click', convertAgain);

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
      if (!state.output || state.output.kind !== 'video') return;
      els.resultNote.textContent =
        'The converted file was created, but this browser cannot preview it here. Download it and open it in a video app.';
    });

    els.resultAudio.addEventListener('error', () => {
      if (!state.output || state.output.kind !== 'audio') return;
      els.resultNote.textContent =
        'The audio file was created, but this browser cannot preview it here. Download it and open it in an audio app.';
    });
  }

  function updateYear() {
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  async function loadFile(file) {
    if (state.exporting) {
      showError('Wait for the current conversion to finish before replacing the video.');
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
        throw new Error(
          'No video track was found in this file. This tool converts videos; use an audio converter for audio-only files.'
        );
      }
      if (!payload.videoDecodable) {
        throw new Error(
          'This browser cannot decode the video in this file, so it cannot be converted here. Try a different file or browser.'
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
      return 'AVI is not decoded by the browser engine used here. Convert the AVI to MP4 or WebM first, then convert it here.';
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
    state.preset = 'balanced';
    state.format = 'mp4';
    state.codec = 'avc';
    state.resolution = 'original';
    state.width = even(payload.width);
    state.height = even(payload.height);
    state.aspectLocked = true;
    state.fpsCap = 0;
    state.bitrateOverride = false;
    state.bitrateMbps = 4;
    state.crfEnabled = false;
    state.crf = 28;
    state.audioKeep = Boolean(payload.hasAudio && payload.audioDecodable);
    state.audioBitrate = PRESET_TARGETS.balanced.audio;
    state.audioFormat = 'mp3';
    state.audioQuality = 192;
    state.sampleRate = 48000;
    state.channels = 2;
    state.trackIndex = Number.isFinite(payload.primaryAudioIndex) ? payload.primaryAudioIndex : 0;
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

    document.querySelectorAll('input[name="cv-preset"]').forEach((input) => {
      input.checked = input.value === 'balanced';
    });
    els.format.value = 'mp4';
    els.resolution.value = 'original';
    els.customSize.hidden = true;
    els.width.value = String(state.width);
    els.height.value = String(state.height);
    els.aspectLock.checked = true;
    els.audioKeep.checked = state.audioKeep;
    els.audioBitrate.value = String(state.audioBitrate);
    els.bitrateOverride.checked = false;
    els.bitrate.value = '4';
    els.crfEnabled.checked = false;
    els.crf.value = '28';
    els.fpsCap.value = '0';
    els.audioFormat.value = 'mp3';
    els.audioQuality.value = '192';
    els.sampleRate.value = '48000';
    els.channels.value = '2';
    populateTracks();

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
    state.preset = 'balanced';
    state.format = 'mp4';
    state.codec = 'avc';
    state.resolution = 'original';
    state.width = 0;
    state.height = 0;
    state.aspectLocked = true;
    state.fpsCap = 0;
    state.bitrateOverride = false;
    state.bitrateMbps = 4;
    state.crfEnabled = false;
    state.crf = 28;
    state.audioKeep = true;
    state.audioBitrate = 160;
    state.audioFormat = 'mp3';
    state.audioQuality = 192;
    state.sampleRate = 48000;
    state.channels = 2;
    state.trackIndex = 0;
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
    els.track.replaceChildren();
    els.trackField.hidden = true;
    clearError();
    clearSizeValidation();
    clearBitrateValidation();
    resetSupport();
    terminateWorker(true);
    updateAll();
    els.browse.focus({ preventScroll: true });
  }

  function convertAgain() {
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

  function hasAudio() {
    return Boolean(state.meta && state.meta.hasAudio && state.meta.audioTracks && state.meta.audioTracks.length);
  }

  function needsAudio() {
    return Boolean(state.toolMode === 'video' && hasAudio() && state.audioKeep);
  }

  function selectedTrack() {
    const tracks = state.meta && state.meta.audioTracks ? state.meta.audioTracks : [];
    return tracks[state.trackIndex] || tracks[0] || null;
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

  function presetVideoBitrate(preset) {
    const config = PRESET_TARGETS[preset] || PRESET_TARGETS.balanced;
    const pixels = Math.max(2, state.width) * Math.max(2, state.height);
    const fps = effectiveFps();
    let bitrate = pixels * fps * config.bpp;
    const source = Number(state.meta && state.meta.videoBitrate);
    if (Number.isFinite(source) && source > 0) {
      bitrate = Math.min(bitrate, source * config.sourceCap);
      bitrate = Math.max(bitrate, Math.min(source, pixels * fps * config.floorBpp));
    }
    return Math.round(clamp(bitrate, 120000, 50000000));
  }

  function activeVideoBitrate() {
    if (state.bitrateOverride) return Math.round(clamp(state.bitrateMbps, 0.02, 100) * 1000000);
    return presetVideoBitrate(state.preset);
  }

  function activeAudioBitrate() {
    if (!needsAudio()) return 0;
    return Math.round(clamp(state.audioBitrate, 64, 320) * 1000);
  }

  function crfMax() {
    return state.codec === 'avc' || state.codec === 'hevc' ? 51 : 63;
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

  function badCrf() {
    return !Number.isFinite(state.crf) || state.crf < 0 || state.crf > crfMax();
  }

  function badAudioQuality() {
    return !Number.isFinite(state.audioQuality) || state.audioQuality < 96 || state.audioQuality > 320;
  }

  function setToolMode(mode) {
    if (mode !== 'video' && mode !== 'audio') return;
    if (state.exporting) return;
    state.toolMode = mode;
    clearResult();
    resetSupport();
    updateModeUi();
    updatePlan();
    updateExportState();
    scheduleSupportRefresh(60);
  }

  function setPreset(preset) {
    if (!PRESET_LABELS[preset] || state.exporting) return;
    state.preset = preset;
    state.audioBitrate = (PRESET_TARGETS[preset] || PRESET_TARGETS.balanced).audio;
    els.audioBitrate.value = String(state.audioBitrate);
    if (!state.bitrateOverride) {
      const suggested = presetVideoBitrate(preset);
      state.bitrateMbps = clamp(Math.round((suggested / 1000000) * 100) / 100, 0.02, 100);
      els.bitrate.value = String(state.bitrateMbps);
    }
    clearResult();
    updatePresetUi();
    updateRateUi();
    updateAudioUi();
    updatePlan();
    updateExportState();
  }

  function defaultCodec(format) {
    return format === 'webm' ? 'vp9' : 'avc';
  }

  function setFormat(format) {
    if (!VIDEO_FORMATS[format] || state.exporting) return;
    state.format = format;
    const allowed = VIDEO_FORMATS[format].codecs;
    if (!allowed.includes(state.codec)) state.codec = defaultCodec(format);
    els.format.value = format;
    clearResult();
    updateFormatUi();
    updateCodecUi();
    updateRateUi();
    updateAudioUi();
    updatePlan();
    updateExportState();
  }

  function setCodec(codec) {
    if (!VIDEO_FORMATS[state.format].codecs.includes(codec) || state.exporting) return;
    state.codec = codec;
    if (state.crf > crfMax()) {
      state.crf = crfMax();
      els.crf.value = String(state.crf);
    }
    clearResult();
    updateCodecUi();
    updateRateUi();
    updatePlan();
    updateExportState();
  }

  function setResolution(value) {
    if (state.exporting) return;
    if (value !== 'original' && value !== 'custom' && !RESOLUTIONS[value]) return;
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
        const dims = dimsFromTier(RESOLUTIONS[value], sourceAspect());
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

  function setAudioKeep(keep) {
    state.audioKeep = Boolean(keep);
    els.audioKeep.checked = state.audioKeep;
    updateAudioUi();
    updateFormatUi();
    updatePlan();
    updateExportState();
  }

  function setAudioBitrate(kbps) {
    const value = Number(kbps);
    if (!Number.isFinite(value) || value <= 0) return;
    state.audioBitrate = value;
    els.audioBitrate.value = String(value);
    updateAudioUi();
    updatePlan();
    updateExportState();
  }

  function setAudioFormat(format) {
    if (!AUDIO_FORMATS[format] || state.exporting) return;
    state.audioFormat = format;
    els.audioFormat.value = format;
    clearResult();
    updateAudioFormatUi();
    updateAudioQualityUi();
    updatePlan();
    updateExportState();
  }

  function setAudioQuality(kbps) {
    const value = Number(kbps);
    if (!Number.isFinite(value) || value <= 0) return;
    state.audioQuality = value;
    els.audioQuality.value = String(value);
    updateAudioQualityUi();
    updatePlan();
    updateExportState();
  }

  function setSampleRate(rate) {
    const value = Number(rate);
    if (value !== 44100 && value !== 48000) return;
    state.sampleRate = value;
    els.sampleRate.value = String(value);
    clearResult();
    updateAudioModeUi();
    updatePlan();
    scheduleSupportRefresh(160);
    updateExportState();
  }

  function setChannels(channels) {
    const value = Number(channels) === 1 ? 1 : 2;
    state.channels = value;
    els.channels.value = String(value);
    clearResult();
    updateAudioModeUi();
    updatePlan();
    scheduleSupportRefresh(160);
    updateExportState();
  }

  function setTrackIndex(index) {
    const tracks = state.meta && state.meta.audioTracks ? state.meta.audioTracks : [];
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0 || value >= tracks.length) return;
    state.trackIndex = Math.round(value);
    els.track.value = String(state.trackIndex);
    clearResult();
    updateAudioModeUi();
    updatePlan();
    updateExportState();
  }

  function setBitrateOverride(enabled) {
    state.bitrateOverride = Boolean(enabled);
    els.bitrateOverride.checked = state.bitrateOverride;
    if (state.bitrateOverride) {
      const suggested = presetVideoBitrate(state.preset);
      state.bitrateMbps = clamp(Math.round((suggested / 1000000) * 100) / 100, 0.02, 100);
      els.bitrate.value = String(state.bitrateMbps);
    }
    clearBitrateValidation();
    updateRateUi();
    updatePlan();
    updateExportState();
  }

  function setBitrate(mbps) {
    const value = Number(mbps);
    if (!Number.isFinite(value) || value <= 0) return;
    state.bitrateMbps = value;
    state.bitrateOverride = true;
    els.bitrateOverride.checked = true;
    els.bitrate.value = String(value);
    clearBitrateValidation();
    updateRateUi();
    updatePlan();
    updateExportState();
  }

  function setCrfEnabled(enabled) {
    state.crfEnabled = Boolean(enabled);
    els.crfEnabled.checked = state.crfEnabled;
    updateRateUi();
    updatePlan();
    updateExportState();
  }

  function setCrf(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    state.crf = Math.round(number);
    els.crf.value = String(state.crf);
    clearCrfValidation();
    updateRateUi();
    updatePlan();
    updateExportState();
  }

  function setFpsCap(fps) {
    const value = Number(fps) || 0;
    if (value < 0 || value > 240) return;
    state.fpsCap = value;
    els.fpsCap.value = String(value);
    updateFpsNote();
    updatePlan();
    updateExportState();
  }

  function updateAll() {
    updateModeUi();
    updatePresetUi();
    updateFormatUi();
    updateCodecUi();
    updateRateUi();
    updateAudioUi();
    updateFpsNote();
    updateMetaUi();
    updateSizeNote();
    updateUpscale();
    updateWarnings();
    updateAudioModeUi();
    updatePlan();
    updateExportState();
  }

  function updateModeUi() {
    document.querySelectorAll('input[name="cv-tool-mode"]').forEach((input) => {
      input.checked = input.value === state.toolMode;
    });
    els.videoSettings.hidden = state.toolMode !== 'video';
    els.audioSettings.hidden = state.toolMode !== 'audio';
    els.exportButton.textContent = state.toolMode === 'audio' ? 'Extract audio' : 'Convert video';
    els.cancel.textContent = state.toolMode === 'audio' ? 'Cancel extraction' : 'Cancel conversion';
    updatePresetUi();
    updateAudioModeUi();
  }

  function updatePresetUi() {
    document.querySelectorAll('input[name="cv-preset"]').forEach((input) => {
      input.checked = input.value === state.preset;
    });
    const notes = {
      high: 'High Quality keeps the most detail with a generous bitrate. The converted file may be larger than the source.',
      balanced: 'Balanced is recommended for most conversions: quality close to the source at a practical bitrate.',
      smaller: 'Smaller File spends less data. Fine texture and fast motion may look softer.'
    };
    els.modeNote.textContent = notes[state.preset] || notes.balanced;
    if (!state.bitrateOverride && state.meta) {
      const suggested = presetVideoBitrate(state.preset);
      state.bitrateMbps = clamp(Math.round((suggested / 1000000) * 100) / 100, 0.02, 100);
      els.bitrate.value = String(state.bitrateMbps);
    }
  }

  function formatSupported(format) {
    if (!VIDEO_FORMATS[format]) return false;
    const config = VIDEO_FORMATS[format];
    const videoOk = config.codecs.some((codec) => codecSupported(format, codec));
    return videoOk && (!needsAudio() || audioSupported(format));
  }

  function codecSupported(format, codec) {
    if (!state.supportChecked || !state.support) return true;
    return Boolean(state.support.video && state.support.video[`${format}:${codec}`]);
  }

  function audioSupported(format) {
    if (!state.supportChecked || !state.support) return true;
    const key = VIDEO_FORMATS[format] && VIDEO_FORMATS[format].audioCodec === 'opus' ? 'webm:opus' : 'mp4:aac';
    return Boolean(state.support.audio && state.support.audio[key]);
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
        if (!VIDEO_FORMATS[next.value].codecs.includes(state.codec)) {
          state.codec = defaultCodec(next.value);
        }
      }
    }
    els.format.value = state.format;

    if (state.supportPending) {
      els.formatNote.textContent = 'Checking this browser’s encoders for the selected output size…';
    } else if (checked) {
      const available = Object.keys(VIDEO_FORMATS).filter((format) => formatSupported(format));
      if (!available.length) {
        els.formatNote.textContent =
          'This browser cannot encode a video container at this output size. Choose a smaller resolution.';
      } else {
        els.formatNote.textContent = `Available at this size: ${available
          .map((format) => `${VIDEO_FORMATS[format].label} (${VIDEO_FORMATS[format].codecs
            .filter((codec) => codecSupported(format, codec))
            .map((codec) => CODEC_LABELS[codec])
            .join('/')})`)
          .join(', ')}.`;
      }
    } else if (state.supportError) {
      els.formatNote.textContent =
        'Encoder support could not be verified. The export will check again before writing the file.';
    } else if (invalidDims()) {
      els.formatNote.textContent = 'Choose a valid output size first.';
    } else {
      els.formatNote.textContent = 'Containers are enabled only when this browser can encode them at the chosen size.';
    }
  }

  function updateCodecUi() {
    if (!els.codec) return;
    const config = VIDEO_FORMATS[state.format];
    const allowed = config.codecs.map((codec) => ({ value: codec, label: CODEC_LABELS[codec] || codec }));

    if (!allowed.some((item) => item.value === state.codec)) {
      state.codec = defaultCodec(state.format);
    }

    els.codec.replaceChildren(
      ...allowed.map((item) => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        if (state.supportChecked && state.support) {
          option.disabled = !codecSupported(state.format, item.value);
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
      const available = allowed.filter((item) => codecSupported(state.format, item.value));
      els.codecNote.textContent = available.length
        ? `Encodable here: ${available.map((item) => item.label).join(', ')}.`
        : 'No codec in this container can be encoded at this size. Choose another container or a smaller resolution.';
    } else {
      els.codecNote.textContent = 'Codecs are limited to the ones this container and browser can genuinely encode.';
    }

    updateCrfNote();
  }

  function updateRateUi() {
    if (!els.bitrateOverride) return;
    els.bitrateOverride.checked = state.bitrateOverride;
    els.crfEnabled.checked = state.crfEnabled;
    els.bitrateField.hidden = false;
    els.bitrate.disabled = state.exporting || !state.bitrateOverride;
    els.crfField.hidden = !state.crfEnabled;
    els.crf.disabled = state.exporting;
    els.bitrate.value = String(state.bitrateMbps);
    els.advancedNote.textContent = state.crfEnabled
      ? 'Constant quality is active. The bitrate value is only a fallback for encoders that do not accept a quantizer.'
      : state.bitrateOverride
        ? 'The bitrate override replaces the preset target for this conversion.'
        : 'The preset target is active. Enable the override to enter an exact bitrate.';
  }

  function updateAudioUi() {
    if (!els.audioKeep) return;
    const meta = state.meta;
    const available = Boolean(meta && meta.hasAudio && meta.audioTracks && meta.audioTracks.length);
    const decodable = Boolean(available && selectedTrack() && selectedTrack().decodable);
    const canKeep = available && decodable;

    if (!canKeep) state.audioKeep = false;
    els.audioKeep.checked = state.audioKeep;
    els.audioKeep.disabled = state.exporting || !canKeep;
    els.audioField.hidden = !state.audioKeep;
    els.audioBitrate.disabled = state.exporting;

    if (!available) {
      els.audioCodec.textContent = 'This video has no audio track. The converted video will be silent.';
    } else if (!decodable) {
      els.audioCodec.textContent =
        'The audio in this file cannot be decoded by this browser, so the converted video will have no audio.';
    } else if (!state.audioKeep) {
      els.audioCodec.textContent = 'Audio will be removed from the converted video.';
    } else {
      const codec = VIDEO_FORMATS[state.format].audioLabel;
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
      hevc: 'Typical HEVC values are 20–30. Higher values mean more compression.',
      vp9: 'Typical VP9 values are 24–40. Higher values mean more compression.',
      vp8: 'Typical VP8 values are 20–35. Higher values mean more compression.',
      av1: 'Typical AV1 values are 24–40. Higher values mean more compression.'
    };
    els.crfNote.classList.remove('is-error');
    els.crfNote.textContent = notes[state.codec] || notes.avc;
  }

  function updateMetaUi() {
    const meta = state.meta;
    if (!meta) {
      els.sourceDims.textContent = '—';
      [
        els.metaDuration,
        els.metaResolution,
        els.metaAspect,
        els.metaFps,
        els.metaVideo,
        els.metaAudio,
        els.metaTracks,
        els.metaContainer,
        els.metaSize,
        els.metaBitrate
      ].forEach((element) => {
        if (element) element.textContent = '—';
      });
      return;
    }
    els.sourceDims.textContent = `${meta.width} × ${meta.height}`;
    els.metaDuration.textContent = formatDuration(meta.duration);
    els.metaResolution.textContent = `${meta.width} × ${meta.height}`;
    els.metaAspect.textContent = formatAspect(meta.width, meta.height);
    els.metaFps.textContent = formatFps(meta.fps, meta.fpsVariable);
    els.metaVideo.textContent = meta.videoCodec ? (CODEC_LABELS[meta.videoCodec] || meta.videoCodec.toUpperCase()) : 'Unknown';
    els.metaAudio.textContent = formatAudio(meta);
    els.metaTracks.textContent = meta.audioTracks && meta.audioTracks.length
      ? `${meta.audioTracks.length} track${meta.audioTracks.length === 1 ? '' : 's'}`
      : 'None';
    els.metaContainer.textContent = meta.container || 'Unknown';
    els.metaSize.textContent = state.file ? formatBytes(state.file.size) : '—';
    els.metaBitrate.textContent =
      Number.isFinite(meta.videoBitrate) && meta.videoBitrate > 0
        ? `${(meta.videoBitrate / 1000000).toFixed(2)} Mbps video`
        : 'Not reported';
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
      els.sizeNote.textContent = `${RESOLUTION_LABELS[state.resolution] || state.resolution} output at ${state.width} × ${state.height}, preserving the source aspect ratio.`;
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
        `${formatBytes(state.file.size)} input file. Decoding it can use a lot of memory; close other heavy tabs before converting.`
      );
    }
    if (state.meta.duration > LONG_VIDEO_SECONDS) {
      messages.push(
        `${formatDuration(state.meta.duration)} video. Conversion time grows with duration; keep this tab open until it finishes.`
      );
    }
    if (state.toolMode === 'video' && state.width * state.height > 3840 * 2160) {
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

  function populateTracks() {
    const tracks = state.meta && state.meta.audioTracks ? state.meta.audioTracks : [];
    els.track.replaceChildren(
      ...tracks.map((track, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = trackLabel(track, index);
        return option;
      })
    );
    const multiple = tracks.length > 1;
    els.trackField.hidden = !multiple;
    els.trackNote.hidden = tracks.length === 0;
    if (tracks.length === 1) {
      els.trackNote.textContent = `Using ${trackLabel(tracks[0], 0)}.`;
    } else if (tracks.length > 1) {
      els.trackNote.textContent = `${tracks.length} audio tracks found. Choose which one to extract.`;
    } else {
      els.trackNote.textContent = '';
    }
    if (tracks.length) {
      state.trackIndex = Math.min(state.trackIndex, tracks.length - 1);
      els.track.value = String(state.trackIndex);
    }
  }

  function updateAudioModeUi() {
    if (!els.audioFormat) return;
    const meta = state.meta;
    const available = Boolean(meta && meta.hasAudio && meta.audioTracks && meta.audioTracks.length);
    const track = selectedTrack();
    const decodable = Boolean(track && track.decodable);

    els.audioMissing.hidden = available && decodable;
    if (!available) {
      els.audioMissing.textContent =
        'This video has no audio track, so there is nothing to extract. Switch to Video to Video or choose a different file.';
    } else if (!decodable) {
      els.audioMissing.textContent =
        'This browser cannot decode the selected audio track, so it cannot be extracted here. Choose another track or browser.';
    } else {
      els.audioMissing.textContent = '';
    }

    populateTracks();
    updateAudioFormatUi();
    updateAudioQualityUi();
    updateAudioSupportNote();
  }

  function audioFormatSupported(format) {
    if (!state.supportChecked || !state.support) return true;
    return Boolean(state.support.audioFormats && state.support.audioFormats[format]);
  }

  function updateAudioFormatUi() {
    if (!els.audioFormat) return;
    const checked = state.supportChecked && Boolean(state.support);
    for (const option of els.audioFormat.options) {
      option.disabled = checked ? !audioFormatSupported(option.value) : false;
    }
    if (checked && !audioFormatSupported(state.audioFormat)) {
      const next = Array.from(els.audioFormat.options).find((option) => !option.disabled);
      if (next) state.audioFormat = next.value;
    }
    els.audioFormat.value = state.audioFormat;

    const format = AUDIO_FORMATS[state.audioFormat];
    if (state.audioFormat === 'mp3') {
      els.audioFormatNote.textContent =
        'MP3 is the most compatible audio format and the recommended choice for sharing and playback.';
    } else if (state.audioFormat === 'wav') {
      els.audioFormatNote.textContent =
        'WAV stores uncompressed PCM audio. It is lossless but much larger than MP3.';
    } else if (state.audioFormat === 'm4a') {
      els.audioFormatNote.textContent =
        'M4A stores AAC audio in an MP4 container. It is efficient and widely supported by Apple devices.';
    } else {
      els.audioFormatNote.textContent =
        'AAC in an ADTS stream is a raw AAC file. Some players prefer M4A instead.';
    }
    if (!format) return;
  }

  function updateAudioQualityUi() {
    if (!els.audioQuality) return;
    const compressed = AUDIO_FORMATS[state.audioFormat].compressed;
    els.audioQualityField.hidden = !compressed;
    els.audioQuality.disabled = state.exporting;
    els.audioQuality.value = String(state.audioQuality);
    if (!compressed) {
      els.audioQualityNote.textContent = 'WAV has no bitrate setting. Its size is set by duration, sample rate and channels.';
    } else if (state.audioFormat === 'mp3') {
      els.audioQualityNote.textContent =
        'MP3 supports 96–320 kbps. 192 kbps is a good default; 320 kbps keeps the most detail.';
    } else {
      els.audioQualityNote.textContent =
        'AAC supports 96–320 kbps. 192 kbps is a good default for music and speech.';
    }
  }

  function updateAudioSupportNote() {
    if (!els.audioSupportNote) return;
    if (state.supportPending) {
      els.audioSupportNote.textContent = 'Checking which audio formats this browser can encode…';
      return;
    }
    if (!state.supportChecked || !state.support) {
      els.audioSupportNote.textContent = 'Audio formats are enabled only when this browser can genuinely encode them.';
      return;
    }
    const formats = Object.keys(AUDIO_FORMATS).filter((format) => audioFormatSupported(format));
    if (!formats.length) {
      els.audioSupportNote.textContent = 'This browser cannot encode any of the available audio formats.';
      return;
    }
    els.audioSupportNote.textContent = `Encodable here: ${formats
      .map((format) => AUDIO_FORMATS[format].label)
      .join(', ')}.`;
  }

  function formatPlanVideo() {
    if (!state.meta) return '—';
    const bitrate = activeVideoBitrate();
    if (!Number.isFinite(bitrate) || bitrate <= 0) return 'Not valid';
    if (state.crfEnabled) return `CRF ${state.crf} · ${formatBitrate(bitrate)} fallback`;
    return formatBitrate(bitrate);
  }

  function formatPlanAudio() {
    if (!hasAudio()) return 'No audio track';
    const track = selectedTrack();
    if (!track || !track.decodable) return 'Removed (cannot decode)';
    if (!state.audioKeep) return 'Removed';
    return `${state.audioBitrate} kbps ${VIDEO_FORMATS[state.format].audioLabel}`;
  }

  function updatePlan() {
    if (!state.meta || !state.file) {
      els.planSource.textContent = '—';
      els.planOutput.textContent = '—';
      els.planThird.textContent = '—';
      els.planFourth.textContent = '—';
      els.outputSummary.textContent =
        state.toolMode === 'audio'
          ? 'Add a video to see the audio extraction plan.'
          : 'Add a video to see the conversion plan.';
      return;
    }

    const source = `${state.meta.width} × ${state.meta.height} · ${formatBytes(state.file.size)} · ${formatDuration(state.meta.duration)}`;

    if (state.toolMode === 'audio') {
      const track = selectedTrack();
      const config = AUDIO_FORMATS[state.audioFormat];
      const rate = formatSampleRate(state.sampleRate);
      const channelLabel = state.channels === 1 ? 'mono' : 'stereo';
      els.planThirdLabel.textContent = 'Track';
      els.planFourthLabel.textContent = 'Details';
      els.planSource.textContent = source;
      els.planOutput.textContent = `${config.label} · ${config.compressed ? `${state.audioQuality} kbps` : 'uncompressed'} · ${rate} ${channelLabel}`;
      els.planThird.textContent = track ? trackLabel(track, state.trackIndex) : 'No audio track';
      els.planFourth.textContent = `${formatDuration((track && track.duration) || state.meta.duration)} · ${state.channels} ch · ${rate}`;
      els.outputSummary.textContent = `${config.label} · ${config.compressed ? `${state.audioQuality} kbps` : 'uncompressed PCM'} · ${rate} ${channelLabel}`;
      return;
    }

    const format = VIDEO_FORMATS[state.format];
    els.planThirdLabel.textContent = 'Video';
    els.planFourthLabel.textContent = 'Audio';
    els.planSource.textContent = source;
    els.planOutput.textContent = `${state.width} × ${state.height} · ${format.label} ${CODEC_LABELS[state.codec]}`;
    els.planThird.textContent = formatPlanVideo();
    els.planFourth.textContent = formatPlanAudio();
    els.outputSummary.textContent =
      `${PRESET_LABELS[state.preset]} · ${state.width} × ${state.height} · ${format.label} ${CODEC_LABELS[state.codec]} · ` +
      `${formatPlanVideo()} video · ${formatPlanAudio()}`;
  }

  function readyToExport() {
    if (!state.meta || !state.file || state.loading || state.exporting) return false;
    if (!state.meta.videoDecodable) return false;
    if (state.supportPending) return false;

    if (state.toolMode === 'audio') {
      if (!hasAudio()) return false;
      const track = selectedTrack();
      if (!track || !track.decodable) return false;
      if (state.supportChecked && state.support && !audioFormatSupported(state.audioFormat)) return false;
      if (AUDIO_FORMATS[state.audioFormat].compressed && badAudioQuality()) return false;
      return true;
    }

    if (invalidDims()) return false;
    if (state.supportChecked && state.support && !codecSupported(state.format, state.codec)) return false;
    if (state.supportChecked && state.support && needsAudio() && !audioSupported(state.format)) return false;
    if (state.bitrateOverride && badBitrate()) return false;
    if (state.crfEnabled && badCrf()) return false;
    return true;
  }

  function updateExportState() {
    if (!els.exportButton) return;
    const ready = readyToExport();
    els.exportButton.disabled = !ready;
    els.cancel.hidden = !state.exporting;

    if (state.exporting) {
      els.exportNote.textContent = state.canceling
        ? 'Canceling and releasing encoder resources…'
        : state.exportMode === 'audio'
          ? 'Decoding the selected audio track and encoding the new file in your browser.'
          : 'Re-encoding the video and audio in your browser.';
      return;
    }

    if (!state.meta) {
      els.exportNote.textContent =
        state.toolMode === 'audio'
          ? 'Upload a video to enable audio extraction.'
          : 'Upload a video to enable conversion.';
      return;
    }
    if (state.loading) {
      els.exportNote.textContent = 'Reading the video…';
      return;
    }

    if (state.toolMode === 'audio') {
      if (!hasAudio()) {
        els.exportNote.textContent = 'This video has no audio track to extract.';
      } else if (!selectedTrack() || !selectedTrack().decodable) {
        els.exportNote.textContent = 'The selected audio track cannot be decoded by this browser.';
      } else if (state.supportPending) {
        els.exportNote.textContent = 'Checking audio encoder support…';
      } else if (state.supportChecked && state.support && !audioFormatSupported(state.audioFormat)) {
        els.exportNote.textContent = 'This browser cannot encode the selected audio format. Choose another format.';
      } else if (AUDIO_FORMATS[state.audioFormat].compressed && badAudioQuality()) {
        els.exportNote.textContent = 'Choose a bitrate between 96 and 320 kbps.';
      } else {
        const config = AUDIO_FORMATS[state.audioFormat];
        const rate = formatSampleRate(state.sampleRate);
        const channelLabel = state.channels === 1 ? 'mono' : 'stereo';
        els.exportNote.textContent = config.compressed
          ? `Ready to extract ${config.label} at ${state.audioQuality} kbps, ${rate} ${channelLabel}. The audio is decoded and re-encoded, not renamed.`
          : `Ready to extract uncompressed WAV at ${rate} ${channelLabel}. The audio is decoded and written as PCM, not renamed.`;
      }
      return;
    }

    if (invalidDims()) {
      els.exportNote.textContent = 'Choose a valid output size.';
    } else if (state.bitrateOverride && badBitrate()) {
      els.exportNote.textContent = 'Enter a video bitrate between 0.02 and 100 Mbps.';
    } else if (state.crfEnabled && badCrf()) {
      els.exportNote.textContent = `Enter a constant-quality value between 0 and ${crfMax()}.`;
    } else if (state.supportPending) {
      els.exportNote.textContent = 'Checking encoder support…';
    } else if (state.supportChecked && state.support && !codecSupported(state.format, state.codec)) {
      els.exportNote.textContent =
        'This browser cannot encode the selected codec at this size. Choose another codec, container or resolution.';
    } else if (state.supportChecked && state.support && needsAudio() && !audioSupported(state.format)) {
      els.exportNote.textContent =
        'This browser cannot encode the selected audio codec. Try another container or remove the audio.';
    } else if (state.supportError) {
      els.exportNote.textContent = 'Encoder support was not confirmed, but you can still try the conversion.';
    } else {
      els.exportNote.textContent =
        `Ready to convert to ${state.width} × ${state.height} ${VIDEO_FORMATS[state.format].label} ` +
        `${CODEC_LABELS[state.codec]}. The video is re-encoded, not copied.`;
    }
  }

  function scheduleSupportRefresh(delay = 180) {
    clearTimeout(supportTimer);
    if (!state.meta) {
      resetSupport();
      updateExportState();
      return;
    }
    if (state.toolMode === 'video' && invalidDims()) {
      state.supportPending = false;
      updateFormatUi();
      updateCodecUi();
      updateExportState();
      return;
    }
    state.supportPending = true;
    state.supportError = false;
    if (state.toolMode === 'video') {
      updateFormatUi();
      updateCodecUi();
    }
    updateAudioSupportNote();
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
    if (state.toolMode === 'video' && invalidDims()) {
      state.supportPending = false;
      updateExportState();
      return;
    }

    const token = ++supportToken;
    try {
      const result = await requestWorker('support', {
        options: {
          mode: state.toolMode,
          width: state.width,
          height: state.height,
          sampleRate: state.sampleRate,
          channels: state.channels
        }
      });
      if (token !== supportToken) return;
      state.support = result || {};
      state.supportChecked = true;
      state.supportPending = false;
      state.supportError = false;
      updateFormatUi();
      updateCodecUi();
      updateAudioUi();
      updateAudioFormatUi();
      updateAudioSupportNote();
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
      updateAudioFormatUi();
      updateAudioSupportNote();
      updateExportState();
    }
  }

  function exportModeLabel() {
    if (state.crfEnabled) return `${PRESET_LABELS[state.preset]} · CRF ${state.crf}`;
    if (state.bitrateOverride) return `${PRESET_LABELS[state.preset]} · ${state.bitrateMbps} Mbps override`;
    return PRESET_LABELS[state.preset];
  }

  async function startExport() {
    if (!state.meta || !state.file || state.exporting) return;

    if (state.toolMode === 'audio') {
      if (!hasAudio()) {
        showError('This video has no audio track to extract.');
        return;
      }
      const track = selectedTrack();
      if (!track || !track.decodable) {
        showError('The selected audio track cannot be decoded by this browser.');
        return;
      }
    } else {
      if (invalidDims()) {
        showError('The output size is not valid. Choose a preset or enter a valid custom size.');
        return;
      }
      if (state.bitrateOverride && badBitrate()) {
        showError('Enter a valid video bitrate between 0.02 and 100 Mbps.');
        return;
      }
      if (state.crfEnabled && badCrf()) {
        showError(`Enter a constant-quality value between 0 and ${crfMax()}.`);
        return;
      }
    }

    if (!state.supportChecked || state.supportPending) {
      clearTimeout(supportTimer);
      state.supportPending = false;
      await refreshSupport();
    }

    if (state.toolMode === 'audio') {
      if (state.supportChecked && state.support && !audioFormatSupported(state.audioFormat)) {
        showError('This browser cannot encode the selected audio format. Choose another format.');
        updateExportState();
        return;
      }
    } else {
      if (state.supportChecked && state.support && !codecSupported(state.format, state.codec)) {
        showError('This browser cannot encode the selected codec at this output size. Choose another codec, container or resolution.');
        updateExportState();
        return;
      }
      if (state.supportChecked && state.support && needsAudio() && !audioSupported(state.format)) {
        showError('This browser cannot encode the selected audio codec. Try another container or remove the audio.');
        updateExportState();
        return;
      }
    }

    clearTimeout(supportTimer);
    state.supportPending = false;
    state.exporting = true;
    state.canceling = false;
    state.exportMode = state.toolMode;
    state.progressStartedAt = performance.now();
    clearError();
    clearSizeValidation();
    clearBitrateValidation();
    clearCrfValidation();
    clearResult();
    stopPlayback();
    setControlsDisabled(true);

    els.progress.hidden = false;
    els.result.hidden = true;
    els.progressBar.style.width = '0%';
    els.progressTrack.setAttribute('aria-valuenow', '0');
    els.progressLabel.textContent =
      state.exportMode === 'audio' ? 'Preparing the audio extraction…' : 'Preparing the conversion…';
    els.progressTiming.textContent = '';
    updateExportState();

    try {
      const payload = state.exportMode === 'audio'
        ? await requestWorker('export', {
            file: state.file,
            options: {
              mode: 'audio',
              format: state.audioFormat,
              bitrate: state.audioQuality,
              sampleRate: state.sampleRate,
              channels: state.channels,
              trackIndex: state.trackIndex
            }
          })
        : await requestWorker('export', {
            file: state.file,
            options: {
              mode: 'video',
              width: state.width,
              height: state.height,
              format: state.format,
              codec: state.codec,
              videoBitrate: Math.round(activeVideoBitrate()),
              audio: needsAudio() ? 'keep' : 'remove',
              audioBitrate: Math.round(activeAudioBitrate()),
              fpsCap: state.fpsCap,
              quantizer: state.crfEnabled ? state.crf : null,
              sourceFps: sourceFps()
            }
          });

      if (!payload || !payload.buffer) {
        throw new Error('The conversion did not return a file.');
      }

      const blob = new Blob([payload.buffer], { type: payload.mimeType });
      const url = URL.createObjectURL(blob);

      if (payload.mode === 'audio' || state.exportMode === 'audio') {
        state.output = {
          kind: 'audio',
          blob,
          url,
          filename: makeAudioName(payload.extension, payload.bitrateKbps),
          mimeType: payload.mimeType,
          extension: payload.extension,
          format: payload.format,
          codec: payload.codec,
          duration: payload.duration,
          size: blob.size,
          bitrateKbps: payload.bitrateKbps,
          measuredBitrate: payload.measuredBitrate,
          sampleRate: payload.sampleRate,
          channels: payload.channels,
          trackIndex: payload.trackIndex
        };
      } else {
        state.output = {
          kind: 'video',
          blob,
          url,
          filename: makeVideoName(payload.extension),
          mimeType: payload.mimeType,
          extension: payload.extension,
          format: payload.format,
          codec: payload.codec,
          audioCodec: payload.audioCodec,
          duration: payload.duration,
          width: payload.width,
          height: payload.height,
          hasAudio: payload.hasAudio,
          audioChannels: payload.audioChannels,
          audioSampleRate: payload.audioSampleRate,
          size: blob.size,
          videoBitrate: payload.videoBitrate,
          audioBitrate: payload.audioBitrate,
          sourceFrames: payload.sourceFrames,
          encodedFrames: payload.encodedFrames,
          preset: state.preset,
          modeLabel: exportModeLabel()
        };
      }

      renderResult();
      els.progressBar.style.width = '100%';
      els.progressTrack.setAttribute('aria-valuenow', '100');
      els.progressLabel.textContent = 'Conversion complete. The file was verified.';
      els.progressTiming.textContent = '';
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (state.canceling || /cancel/i.test(message)) {
        showError('Conversion canceled. No file was created, and encoder resources were released.');
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
    els.progressLabel.textContent = 'Canceling the conversion…';
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
      els.progressLabel.textContent = 'Canceling the conversion…';
      return;
    }
    const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    const percent = Math.round(progress * 100);
    els.progressBar.style.width = `${percent}%`;
    els.progressTrack.setAttribute('aria-valuenow', String(percent));

    if (message.phase === 'finalizing') {
      els.progressLabel.textContent = 'Finalizing and verifying the file…';
    } else if (message.phase === 'audio') {
      els.progressLabel.textContent =
        state.exportMode === 'audio'
          ? `Encoding audio… ${percent}%`
          : `Processing audio… ${percent}%`;
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
    els.resultTitle.textContent = output.kind === 'audio' ? 'Your audio file is ready' : 'Your converted video is ready';
    els.resultNote.textContent =
      output.kind === 'audio'
        ? `Extracted from the ${state.meta.width} × ${state.meta.height} video and encoded on this device.`
        : `${state.meta.width} × ${state.meta.height} → ${output.width} × ${output.height}. Measured after re-encoding on this device.`;

    els.resultVideo.hidden = output.kind !== 'video';
    els.resultAudio.hidden = output.kind !== 'audio';
    if (output.kind === 'video') {
      els.resultAudio.removeAttribute('src');
      try { els.resultAudio.load(); } catch (error) { /* no source */ }
      els.resultVideo.src = output.url;
      els.resultVideo.load();
    } else {
      els.resultVideo.removeAttribute('src');
      try { els.resultVideo.load(); } catch (error) { /* no source */ }
      els.resultAudio.src = output.url;
      els.resultAudio.load();
    }

    els.resultBefore.textContent = formatBytes(before);
    els.resultBeforeDetail.textContent =
      output.kind === 'audio'
        ? `Source video · ${formatDuration(state.meta.duration)}`
        : `${state.meta.width} × ${state.meta.height} · ${formatDuration(state.meta.duration)}`;
    els.resultAfter.textContent = formatBytes(after);
    els.resultAfterDetail.textContent =
      output.kind === 'audio'
        ? `${formatDuration(output.duration)} · ${output.channels} ch`
        : `${output.width} × ${output.height} · ${formatDuration(output.duration)}`;

    if (saved === 0) {
      els.resultSaved.textContent = 'Same size';
      els.resultPercent.textContent = '0.0%';
    } else {
      els.resultSaved.textContent = grew ? `${formatBytes(Math.abs(saved))} increase` : `${formatBytes(saved)} saved`;
      els.resultPercent.textContent = grew ? `+${Math.abs(percent).toFixed(1)}% larger` : `${percent.toFixed(1)}% smaller`;
    }
    els.compare.classList.toggle('is-increase', grew);

    const warning = resultWarning(output, grew, percent, saved);
    els.resultWarning.hidden = !warning;
    els.resultWarning.textContent = warning || '';

    setResultMeta(resultRows(output));
    els.download.disabled = false;
    els.download.textContent = `Download ${output.kind === 'audio' ? AUDIO_FORMATS[output.format].label : VIDEO_FORMATS[output.format].label}`;
    els.download.dataset.filename = output.filename;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.result.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  function resultWarning(output, grew, percent, saved) {
    if (output.kind === 'audio') {
      if (output.format === 'wav') {
        return 'WAV is uncompressed, so its size is set by duration, sample rate and channels rather than a bitrate.';
      }
      if (grew) {
        return `The extracted audio is ${formatBytes(Math.abs(saved))} larger than the source video. This can happen when extracting a high-bitrate audio file from a short, heavily compressed video.`;
      }
      if (saved === 0) return 'The extracted audio is the same size as the source video.';
      return '';
    }
    if (grew && percent > 5) {
      return `The converted video is ${formatBytes(Math.abs(saved))} larger than the source (${Math.abs(percent).toFixed(1)}%). Re-encoding at a higher bitrate or into a different codec adds data; the result is still a real conversion. Try Balanced or Smaller File if size matters.`;
    }
    if (saved === 0) return 'The converted video is the same size as the source.';
    return '';
  }

  function resultRows(output) {
    if (output.kind === 'audio') {
      const config = AUDIO_FORMATS[output.format];
      const measured = Number.isFinite(output.measuredBitrate) && output.measuredBitrate > 0
        ? Math.round(output.measuredBitrate / 1000)
        : null;
      return [
        ['File', output.filename],
        ['Format', `${config.label} · audio`],
        ['Codec', CODEC_LABELS[output.codec] || output.codec || config.codecLabel],
        ['Duration', formatDuration(output.duration)],
        ['File size', formatBytes(output.size)],
        ['Measured bitrate', output.format === 'wav'
          ? `${measured || Math.round((output.sampleRate * output.channels * 16) / 1000)} kbps (uncompressed)`
          : `${measured || output.bitrateKbps} kbps`],
        ['Target bitrate', output.bitrateKbps ? `${output.bitrateKbps} kbps` : 'None (PCM)'],
        ['Sample rate', `${formatSampleRate(output.sampleRate)}`],
        ['Channels', `${output.channels} ch (${output.channels === 1 ? 'mono' : 'stereo'})`],
        ['Source track', `Track ${output.trackIndex + 1} of ${Math.max(1, state.meta.audioTracks.length)}`]
      ];
    }
    return [
      ['File', output.filename],
      ['Format', `${VIDEO_FORMATS[output.format].label} · video`],
      ['Video codec', CODEC_LABELS[output.codec] || output.codec],
      ['Audio codec', output.hasAudio ? (CODEC_LABELS[output.audioCodec] || output.audioCodec || 'Audio') : 'No audio track'],
      ['Resolution', `${output.width} × ${output.height}`],
      ['Duration', formatDuration(output.duration)],
      ['File size', formatBytes(output.size)],
      ['Video bitrate', formatBitrate(output.videoBitrate)],
      ['Audio bitrate', output.hasAudio && output.audioBitrate ? `${Math.round(output.audioBitrate / 1000)} kbps` : '—'],
      ['Audio channels', output.hasAudio && output.audioChannels ? `${output.audioChannels} ch` : '—'],
      ['Audio sample rate', output.hasAudio && output.audioSampleRate ? `${formatSampleRate(output.audioSampleRate)}` : '—'],
      ['Quality', output.modeLabel || PRESET_LABELS[output.preset] || 'Balanced']
    ];
  }

  function setResultMeta(rows) {
    els.resultMeta.replaceChildren(
      ...rows.map(([label, value]) => {
        const wrapper = document.createElement('div');
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        wrapper.append(term, detail);
        return wrapper;
      })
    );
  }

  function clearResult() {
    if (state.output && state.output.url) {
      URL.revokeObjectURL(state.output.url);
    }
    state.output = null;
    if (!els.result) return;
    els.result.hidden = true;
    els.resultVideo.removeAttribute('src');
    els.resultAudio.removeAttribute('src');
    try {
      els.resultVideo.load();
      els.resultAudio.load();
    } catch (error) {
      /* The result elements may not be attached yet. */
    }
    els.resultMeta.replaceChildren();
    els.download.disabled = true;
    delete els.download.dataset.filename;
    if (els.compare) els.compare.classList.remove('is-increase');
  }

  function baseName() {
    return state.file
      ? state.file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[\\/:*?"<>|]+/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  }

  function makeVideoName(extension) {
    return `${baseName() || 'video'}-converted-${state.width}x${state.height}.${extension}`;
  }

  function makeAudioName(extension, bitrateKbps) {
    const suffix = bitrateKbps ? `-${bitrateKbps}kbps` : '';
    return `${baseName() || 'video'}-audio${suffix}.${extension}`;
  }

  function formatBitrate(bitsPerSecond) {
    if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return 'Not reported';
    const mbps = bitsPerSecond / 1000000;
    return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
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

  function formatSampleRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0) return 'Unknown';
    const khz = rate / 1000;
    return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }

  function formatAspect(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'Unknown';
    const ratio = width / height;
    const known = [
      [16 / 9, '16:9'],
      [9 / 16, '9:16'],
      [4 / 3, '4:3'],
      [3 / 4, '3:4'],
      [1, '1:1'],
      [21 / 9, '21:9'],
      [2.39, '2.39:1'],
      [1.85, '1.85:1']
    ];
    const match = known.find(([value]) => Math.abs(ratio - value) < 0.02);
    return match ? `${match[1]} (${ratio.toFixed(2)}:1)` : `${ratio.toFixed(2)}:1`;
  }

  function formatAudio(meta) {
    if (!meta || !meta.hasAudio) return 'No audio track';
    if (!meta.audioDecodable) return 'Audio not decodable';
    const codec = (meta.audioCodec || 'Audio').toUpperCase();
    const channels = meta.audioChannels ? `${meta.audioChannels} ch` : '';
    const rate = meta.audioSampleRate ? `${formatSampleRate(meta.audioSampleRate)}` : '';
    return [codec, channels, rate].filter(Boolean).join(' · ');
  }

  function trackLabel(track, index) {
    if (!track) return `Track ${index + 1}`;
    const parts = [`Track ${index + 1}`];
    if (track.language) parts.push(track.language.toUpperCase());
    if (track.name) parts.push(track.name);
    if (track.channels) parts.push(`${track.channels} ch`);
    if (track.sampleRate) parts.push(`${formatSampleRate(track.sampleRate)}`);
    if (track.codec) parts.push(String(track.codec).toUpperCase());
    if (track.decodable === false) parts.push('not decodable');
    return parts.join(' · ');
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
    } catch (error) {
      return '';
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
    if (/cancel/i.test(message)) return 'Conversion canceled. No file was created.';
    if (
      /could not be read as a supported video|cannot decode|no video track|no readable video duration|does not contain a video|no audio track|audio track/i.test(
        message
      )
    ) {
      return message;
    }
    if (/memory|allocation|too large|array buffer|quota/i.test(message)) {
      return 'This conversion ran out of memory. Try a shorter video, a smaller output resolution, or close other memory-heavy tabs.';
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

  /* ------------------------------------------------------------------------
   * Source player
   * ---------------------------------------------------------------------- */

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
        showError("Fullscreen is not available in this browser. Use the browser's own fullscreen control instead.");
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
    document.querySelectorAll('input[name="cv-tool-mode"]').forEach((input) => {
      input.disabled = disabled;
    });
    if (els.replace) els.replace.disabled = disabled;
    if (els.remove) els.remove.disabled = disabled;
    els.editor.classList.toggle('is-busy', disabled);
    if (!disabled) {
      updateAudioUi();
      updateCodecUi();
      updateAudioFormatUi();
    }
  }

  /* ------------------------------------------------------------------------
   * Worker plumbing
   * ---------------------------------------------------------------------- */

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./video-converter-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const error = new Error('The video processing worker stopped. Try reloading the page.');
      rejectPending(error);
      terminateWorker(true);
      showError(error.message);
      state.exporting = false;
      state.canceling = false;
      state.loading = false;
      state.supportPending = false;
      els.progress.hidden = true;
      setLoading(false);
      setControlsDisabled(false);
      updateExportState();
    };
    return worker;
  }

  function requestWorker(type, payload = {}, transfer = []) {
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

  /* ------------------------------------------------------------------------
   * Debug API (used by automated tests)
   * ---------------------------------------------------------------------- */

  function exposeDebugApi() {
    window.__videoConverter = {
      getState() {
        const output = state.output;
        const before = state.file ? state.file.size : 0;
        const saved = output ? before - output.size : 0;
        const percent = output && before > 0 ? (saved / before) * 100 : 0;
        return {
          ready: Boolean(state.meta),
          file: state.file ? { name: state.file.name, size: state.file.size, type: state.file.type } : null,
          meta: state.meta
            ? {
                width: state.meta.width,
                height: state.meta.height,
                rotation: state.meta.rotation,
                duration: state.meta.duration,
                fps: state.meta.fps,
                fpsVariable: state.meta.fpsVariable,
                hasVideo: state.meta.hasVideo,
                videoDecodable: state.meta.videoDecodable,
                videoCodec: state.meta.videoCodec,
                videoBitrate: state.meta.videoBitrate,
                hasAudio: state.meta.hasAudio,
                audioCodec: state.meta.audioCodec,
                audioChannels: state.meta.audioChannels,
                audioSampleRate: state.meta.audioSampleRate,
                audioBitrate: state.meta.audioBitrate,
                audioDecodable: state.meta.audioDecodable,
                audioTracks: (state.meta.audioTracks || []).map((track) => ({ ...track })),
                primaryAudioIndex: state.meta.primaryAudioIndex,
                container: state.meta.container
              }
            : null,
          toolMode: state.toolMode,
          preset: state.preset,
          format: state.format,
          codec: state.codec,
          resolution: state.resolution,
          width: state.width,
          height: state.height,
          aspectLocked: state.aspectLocked,
          fpsCap: state.fpsCap,
          bitrateOverride: state.bitrateOverride,
          bitrateMbps: state.bitrateMbps,
          crfEnabled: state.crfEnabled,
          crf: state.crf,
          audioKeep: state.audioKeep,
          audioBitrate: state.audioBitrate,
          audioFormat: state.audioFormat,
          audioQuality: state.audioQuality,
          sampleRate: state.sampleRate,
          channels: state.channels,
          trackIndex: state.trackIndex,
          plan: {
            videoBitrate: activeVideoBitrate(),
            audioBitrate: activeAudioBitrate()
          },
          supportChecked: state.supportChecked,
          supportPending: state.supportPending,
          supportError: state.supportError,
          support: state.support
            ? {
                video: { ...(state.support.video || {}) },
                audio: { ...(state.support.audio || {}) },
                audioFormats: { ...(state.support.audioFormats || {}) },
                mp3: Boolean(state.support.mp3)
              }
            : null,
          loading: state.loading,
          exporting: state.exporting,
          canceling: state.canceling,
          exportMode: state.exportMode,
          output: output
            ? {
                kind: output.kind,
                filename: output.filename,
                mimeType: output.mimeType,
                extension: output.extension,
                format: output.format,
                codec: output.codec,
                audioCodec: output.audioCodec,
                duration: output.duration,
                width: output.width,
                height: output.height,
                hasAudio: output.hasAudio,
                size: output.size,
                videoBitrate: output.videoBitrate,
                audioBitrate: output.audioBitrate,
                bitrateKbps: output.bitrateKbps,
                measuredBitrate: output.measuredBitrate,
                sampleRate: output.sampleRate,
                channels: output.channels,
                audioChannels: output.audioChannels,
                audioSampleRate: output.audioSampleRate,
                trackIndex: output.trackIndex,
                sourceFrames: output.sourceFrames,
                encodedFrames: output.encodedFrames,
                modeLabel: output.modeLabel,
                saved,
                percent,
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
      setToolMode(mode) {
        if (mode !== 'video' && mode !== 'audio') return false;
        document.querySelectorAll('input[name="cv-tool-mode"]').forEach((input) => {
          input.checked = input.value === mode;
        });
        setToolMode(mode);
        return true;
      },
      setPreset(preset) {
        if (!PRESET_LABELS[preset]) return false;
        document.querySelectorAll('input[name="cv-preset"]').forEach((input) => {
          input.checked = input.value === preset;
        });
        setPreset(preset);
        return true;
      },
      setFormat(format) {
        if (!VIDEO_FORMATS[format]) return false;
        setFormat(format);
        return true;
      },
      setCodec(codec) {
        if (!VIDEO_FORMATS[state.format].codecs.includes(codec)) return false;
        setCodec(codec);
        return true;
      },
      setResolution(value) {
        if (value !== 'original' && value !== 'custom' && !RESOLUTIONS[value]) return false;
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
      setBitrateOverride(enabled) {
        setBitrateOverride(Boolean(enabled));
        return true;
      },
      setBitrate(mbps) {
        const value = Number(mbps);
        if (!Number.isFinite(value) || value <= 0) return false;
        setBitrate(value);
        return true;
      },
      setCrfEnabled(enabled) {
        setCrfEnabled(Boolean(enabled));
        return true;
      },
      setCrf(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return false;
        setCrf(number);
        return true;
      },
      setFpsCap(fps) {
        const value = Number(fps) || 0;
        if (value < 0 || value > 240) return false;
        setFpsCap(value);
        return true;
      },
      setAudioKeep(keep) {
        setAudioKeep(Boolean(keep));
        return true;
      },
      setAudioBitrate(kbps) {
        const value = Number(kbps);
        if (!Number.isFinite(value) || value <= 0) return false;
        setAudioBitrate(value);
        return true;
      },
      setAudioFormat(format) {
        if (!AUDIO_FORMATS[format]) return false;
        setAudioFormat(format);
        return true;
      },
      setAudioQuality(kbps) {
        const value = Number(kbps);
        if (!Number.isFinite(value) || value <= 0) return false;
        setAudioQuality(value);
        return true;
      },
      setSampleRate(rate) {
        const value = Number(rate);
        if (value !== 44100 && value !== 48000) return false;
        setSampleRate(value);
        return true;
      },
      setChannels(channels) {
        const value = Number(channels) === 1 ? 1 : 2;
        setChannels(value);
        return true;
      },
      setTrackIndex(index) {
        const tracks = state.meta && state.meta.audioTracks ? state.meta.audioTracks : [];
        const value = Number(index);
        if (!Number.isFinite(value) || value < 0 || value >= tracks.length) return false;
        setTrackIndex(value);
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
