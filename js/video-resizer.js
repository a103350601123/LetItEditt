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
    '360': 360,
    '240': 240
  };
  const PRESET_LABELS = {
    '2160': '4K',
    '1440': '1440p',
    '1080': '1080p',
    '720': '720p',
    '480': '480p',
    '360': '360p',
    '240': '240p'
  };
  const RATIOS = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '4:5': 4 / 5
  };
  const AUDIO_BITRATE = { mp4: 128000, webm: 96000 };

  const state = {
    file: null,
    url: null,
    thumbnail: '',
    meta: null,
    preset: 'original',
    aspect: 'original',
    aspectLocked: true,
    width: 0,
    height: 0,
    fit: 'fit',
    backgroundMode: 'black',
    backgroundColor: '#000000',
    format: 'mp4',
    quality: 'balanced',
    bitrateMbps: 8,
    duration: 0,
    loading: false,
    exporting: false,
    canceling: false,
    supportChecked: false,
    supportPending: false,
    supportError: false,
    support: null,
    formatSupport: { mp4: true, webm: true },
    output: null
  };

  const els = {};
  let worker = null;
  let requestId = 0;
  let supportToken = 0;
  let supportTimer = null;
  let previewFrameRequest = 0;
  let lastPreviewDraw = 0;
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
    setupPresets();
    setupSizeFields();
    setupAspect();
    setupFitAndBackground();
    setupFormatAndQuality();
    setupExport();
    updateYear();
    exposeDebugApi();

    window.addEventListener('resize', () => renderOutputPreview());
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
      outputPreviewDims: '[data-output-preview-dims]',
      previewCanvas: '[data-preview-canvas]',
      previewMode: '[data-preview-mode]',
      metaDuration: '[data-meta-duration]',
      metaResolution: '[data-meta-resolution]',
      metaAspect: '[data-meta-aspect]',
      metaFps: '[data-meta-fps]',
      metaAudio: '[data-meta-audio]',
      metaRotation: '[data-meta-rotation]',
      metaSize: '[data-meta-size]',
      presets: '[data-presets]',
      originalLabel: '[data-original-label]',
      width: '[data-width]',
      height: '[data-height]',
      aspectLock: '[data-aspect-lock]',
      sizeNote: '[data-size-note]',
      sizeValidation: '[data-size-validation]',
      ratioButtons: '[data-ratio-buttons]',
      ratioNote: '[data-ratio-note]',
      fitNote: '[data-fit-note]',
      backgroundGroup: '[data-background-group]',
      colorField: '[data-color-field]',
      backgroundColor: '[data-background-color]',
      format: '[data-format]',
      formatNote: '[data-format-note]',
      bitrateField: '[data-bitrate-field]',
      bitrate: '[data-bitrate]',
      bitrateValidation: '[data-bitrate-validation]',
      exportButton: '[data-export]',
      cancel: '[data-cancel]',
      exportNote: '[data-export-note]',
      outputSummary: '[data-output-summary]',
      sizeEstimate: '[data-size-estimate]',
      progress: '[data-progress]',
      progressTrack: '[data-progress-track]',
      progressBar: '[data-progress-bar]',
      progressLabel: '[data-progress-label]',
      result: '[data-result]',
      resultNote: '[data-result-note]',
      resultVideo: '[data-result-video]',
      resultName: '[data-result-name]',
      resultFormat: '[data-result-format]',
      resultDuration: '[data-result-duration]',
      resultSize: '[data-result-size]',
      resultResolution: '[data-result-resolution]',
      resultAudio: '[data-result-audio]',
      download: '[data-download]',
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
      if (!state.exporting) els.fileInput.click();
    });
    els.remove.addEventListener('click', () => {
      if (!state.exporting && !state.loading) removeVideo();
    });

    els.fileInput.addEventListener('change', () => {
      const files = Array.from(els.fileInput.files || []);
      els.fileInput.value = '';
      if (!files.length) return;
      if (files.length > 1) {
        showError('This tool resizes one video at a time. The first file was loaded; remove it before adding another.');
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
        showError('This tool resizes one video at a time. The first file was loaded.');
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
      renderOutputPreview();
    });

    els.video.addEventListener('loadeddata', renderOutputPreview);
    els.video.addEventListener('seeked', () => {
      updateTimeDisplay();
      renderOutputPreview();
    });

    els.video.addEventListener('play', () => {
      els.player.classList.remove('is-paused');
      els.player.classList.add('is-playing');
      updatePlayButton();
      startPreviewLoop();
    });

    els.video.addEventListener('pause', () => {
      els.player.classList.add('is-paused');
      els.player.classList.remove('is-playing');
      updatePlayButton();
      stopPreviewLoop();
    });

    els.video.addEventListener('ended', () => {
      els.player.classList.add('is-paused');
      els.player.classList.remove('is-playing');
      updatePlayButton();
      stopPreviewLoop();
    });

    els.video.addEventListener('timeupdate', () => {
      updateTimeDisplay();
      if (els.video.paused) renderOutputPreview();
    });

    els.video.addEventListener('error', () => {
      if (!state.meta) return;
      els.videoError.hidden = false;
      els.videoError.textContent =
        'This browser cannot play this file directly. Resizing may still work because the exporter uses a separate decoder.';
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

  function setupPresets() {
    els.presets.addEventListener('click', (event) => {
      const button = event.target.closest('[data-preset]');
      if (!button || button.disabled || state.exporting) return;
      applyPreset(button.dataset.preset);
    });
  }

  function setupSizeFields() {
    const fields = [
      [els.width, 'width'],
      [els.height, 'height']
    ];

    for (const [input, axis] of fields) {
      if (!input) continue;
      input.addEventListener('change', () => {
        if (!state.meta || state.exporting) return;
        const value = Number(input.value);
        if (!Number.isFinite(value)) {
          showSizeValidation('Enter a number for this output dimension.');
          syncSizeInputs(true);
          return;
        }
        if (axis === 'width') setWidth(value);
        else setHeight(value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('blur', () => syncSizeInputs(true));
    }

    els.aspectLock.addEventListener('change', () => {
      if (!state.meta || state.exporting) return;
      setAspectLock(els.aspectLock.checked);
    });
  }

  function setupAspect() {
    els.ratioButtons.addEventListener('click', (event) => {
      const button = event.target.closest('[data-ratio]');
      if (!button || button.disabled || state.exporting) return;
      applyAspect(button.dataset.ratio);
    });
  }

  function setupFitAndBackground() {
    document.querySelectorAll('input[name="vr-fit"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || state.exporting) return;
        state.fit = input.value === 'fill' ? 'fill' : 'fit';
        clearResult();
        updateFitUi();
        updateAspectUi();
        updateOutputUi();
        updateExportState();
        renderOutputPreview();
      });
    });

    document.querySelectorAll('input[name="vr-bg"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || state.exporting) return;
        setBackgroundMode(input.value);
      });
    });

    els.backgroundColor.addEventListener('input', () => {
      if (state.exporting) return;
      state.backgroundMode = 'custom';
      state.backgroundColor = normalizeColor(els.backgroundColor.value);
      selectBackgroundRadio('custom');
      updateCustomSwatch();
      clearResult();
      updateFitUi();
      updateOutputUi();
      renderOutputPreview();
    });
  }

  function setupFormatAndQuality() {
    els.format.addEventListener('change', () => {
      if (state.exporting) return;
      state.format = els.format.value === 'webm' ? 'webm' : 'mp4';
      clearResult();
      updateFormatUi();
      updateEstimate();
      updateExportState();
    });

    document.querySelectorAll('input[name="vr-quality"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked || state.exporting) return;
        state.quality = ['high', 'balanced', 'smaller', 'custom'].includes(input.value)
          ? input.value
          : 'balanced';
        clearResult();
        updateQualityUi();
        updateEstimate();
        updateExportState();
      });
    });

    els.bitrate.addEventListener('change', () => {
      if (state.exporting) return;
      setBitrate(els.bitrate.value);
    });
    els.bitrate.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.bitrate.blur();
      }
    });
    els.bitrate.addEventListener('blur', () => syncBitrateInput());
  }

  function setupExport() {
    els.exportButton.addEventListener('click', startExport);
    els.cancel.addEventListener('click', cancelExport);
    els.newVideo.addEventListener('click', removeVideo);

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
        'The resized file was created, but this browser cannot preview it here. Download it and open it in a video app.';
    });
  }

  function updateYear() {
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  async function loadFile(file) {
    if (state.exporting) {
      showError('Wait for the current resize to finish before replacing the video.');
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
    setControlsDisabled(true);
    updateExportState();

    try {
      const payload = await requestWorker('inspect', { file });
      if (!payload || !payload.hasVideo) {
        throw new Error('No video track was found in this file.');
      }
      if (!payload.videoDecodable) {
        throw new Error('This browser cannot decode the video in this file.');
      }
      if (!Number.isFinite(payload.duration) || payload.duration <= 0) {
        throw new Error('This file has no readable video duration.');
      }
      if (payload.hasAudio && !payload.audioDecodable) {
        throw new Error(
          'This browser can decode the video but not its audio. Exporting would drop the sound, so this file is not accepted.'
        );
      }

      replaceCurrentVideo(file, payload);
      clearError();
    } catch (error) {
      showError(`${file.name}: ${friendlyError(error)}`);
    } finally {
      state.loading = false;
      setLoading(false);
      setControlsDisabled(false);
      updateExportState();
    }
  }

  function setControlsDisabled(disabled) {
    const controls = [
      els.replace,
      els.remove,
      els.width,
      els.height,
      els.aspectLock,
      els.backgroundColor,
      els.format,
      els.bitrate
    ];
    for (const control of controls) {
      if (control) control.disabled = disabled;
    }
    els.presets.querySelectorAll('button').forEach((button) => {
      button.disabled = disabled;
    });
    els.ratioButtons.querySelectorAll('button').forEach((button) => {
      button.disabled = disabled;
    });
    document.querySelectorAll('input[name="vr-fit"], input[name="vr-bg"], input[name="vr-quality"]').forEach((input) => {
      input.disabled = disabled;
    });
    els.editor.classList.toggle('is-busy', disabled);
    updateBackgroundDisabled();
  }

  function validateFile(file) {
    if (!file || !file.name) return 'The file could not be read.';
    if (file.size === 0) return 'The file is empty.';
    if (file.size > MAX_FILE_BYTES) return 'The file is larger than the 2 GB limit.';
    const extension = (file.name.split('.').pop() || '').toLowerCase();
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
    state.preset = 'original';
    state.aspect = 'original';
    state.aspectLocked = true;
    state.width = even(payload.width);
    state.height = even(payload.height);
    state.fit = 'fit';
    state.backgroundMode = 'black';
    state.backgroundColor = '#000000';
    state.format = 'mp4';
    state.quality = 'balanced';
    state.bitrateMbps = 8;
    state.output = null;
    state.support = null;
    state.supportChecked = false;
    state.supportPending = false;
    state.supportError = false;
    state.formatSupport = { mp4: true, webm: true };

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

    els.width.value = String(state.width);
    els.height.value = String(state.height);
    els.aspectLock.checked = true;
    els.backgroundColor.value = '#000000';
    els.format.value = 'mp4';
    els.bitrate.value = '8';
    selectBackgroundRadio('black');
    updateCustomSwatch();
    document.querySelectorAll('input[name="vr-fit"]').forEach((input) => {
      input.checked = input.value === 'fit';
    });
    document.querySelectorAll('input[name="vr-quality"]').forEach((input) => {
      input.checked = input.value === 'balanced';
    });

    els.video.volume = 1;
    els.video.muted = false;
    els.volume.value = '1';
    els.seek.value = '0';
    els.current.textContent = '00:00';
    els.total.textContent = formatClock(payload.duration);
    els.player.classList.add('is-paused');
    els.player.classList.remove('is-playing');

    updateAll();
    requestAnimationFrame(() => {
      renderOutputPreview();
      scheduleSupportRefresh(40);
    });
  }

  function releaseCurrentVideo() {
    stopPlayback();
    if (state.url) {
      URL.revokeObjectURL(state.url);
      state.url = null;
    }
    els.video.removeAttribute('src');
    els.video.load();
    clearResult();
  }

  function removeVideo() {
    if (state.exporting) return;
    releaseCurrentVideo();
    state.file = null;
    state.meta = null;
    state.thumbnail = '';
    state.duration = 0;
    state.preset = 'original';
    state.aspect = 'original';
    state.aspectLocked = true;
    state.width = 0;
    state.height = 0;
    state.fit = 'fit';
    state.backgroundMode = 'black';
    state.backgroundColor = '#000000';
    state.format = 'mp4';
    state.quality = 'balanced';
    state.bitrateMbps = 8;
    state.support = null;
    state.supportChecked = false;
    state.supportPending = false;
    state.supportError = false;
    state.formatSupport = { mp4: true, webm: true };

    els.editor.hidden = true;
    els.dropzone.hidden = false;
    els.fileThumb.removeAttribute('src');
    els.fileThumb.hidden = true;
    els.warning.hidden = true;
    els.warning.textContent = '';
    els.videoError.hidden = true;
    clearError();
    clearSizeValidation();
    clearBitrateValidation();
    terminateWorker(true);
    updateExportState();
    els.browse.focus({ preventScroll: true });
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

  function even(value) {
    return Math.max(2, Math.round(value / 2) * 2);
  }

  function sourceAspect() {
    if (!state.meta || !state.meta.height) return 16 / 9;
    return state.meta.width / state.meta.height;
  }

  function activeRatio() {
    if (!state.meta) return 16 / 9;
    if (state.aspect === 'original') return sourceAspect();
    if (state.aspect === 'custom') {
      if (state.width > 0 && state.height > 0) return state.width / state.height;
      return sourceAspect();
    }
    return RATIOS[state.aspect] || sourceAspect();
  }

  function tierForPreset(preset) {
    if (!state.meta) return null;
    if (preset === 'original') return Math.min(state.meta.width, state.meta.height);
    return PRESETS[preset] || null;
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

  function capDims() {
    state.width = Math.max(2, Math.min(MAX_OUTPUT_EDGE, even(state.width)));
    state.height = Math.max(2, Math.min(MAX_OUTPUT_EDGE, even(state.height)));
    if (state.width > MAX_OUTPUT_EDGE || state.height > MAX_OUTPUT_EDGE) {
      const scale = Math.min(MAX_OUTPUT_EDGE / state.width, MAX_OUTPUT_EDGE / state.height);
      state.width = even(state.width * scale);
      state.height = even(state.height * scale);
    }
  }

  function applyPreset(preset) {
    if (!state.meta || state.exporting) return;
    if (preset !== 'original' && preset !== 'custom' && !PRESETS[preset]) return;

    if (preset === 'custom') {
      state.preset = 'custom';
      clearSizeValidation();
      afterDimensionChange();
      return;
    }

    const tier = tierForPreset(preset);
    if (!tier) return;
    const ratio = state.aspect === 'custom'
      ? (state.width > 0 && state.height > 0 ? state.width / state.height : sourceAspect())
      : activeRatio();
    const dims = dimsFromTier(tier, ratio);
    state.preset = preset;
    state.width = dims.width;
    state.height = dims.height;
    clearSizeValidation();
    afterDimensionChange();
  }

  function applyAspect(aspect) {
    if (!state.meta || state.exporting) return;

    if (aspect === 'custom') {
      state.aspect = 'custom';
      state.aspectLocked = false;
      state.preset = 'custom';
      els.aspectLock.checked = false;
      clearSizeValidation();
      afterDimensionChange();
      return;
    }

    if (aspect !== 'original' && !RATIOS[aspect]) return;
    const ratio = aspect === 'original' ? sourceAspect() : RATIOS[aspect];
    state.aspect = aspect;
    state.aspectLocked = true;
    els.aspectLock.checked = true;

    if (state.preset !== 'custom') {
      const tier = tierForPreset(state.preset);
      if (tier) {
        const dims = dimsFromTier(tier, ratio);
        state.width = dims.width;
        state.height = dims.height;
      }
    } else if (state.width > 0 && state.height > 0) {
      if (ratio >= 1) {
        state.height = even(state.width / ratio);
      } else {
        state.width = even(state.height * ratio);
      }
      capDims();
    }

    clearSizeValidation();
    afterDimensionChange();
  }

  function setAspectLock(locked) {
    if (!state.meta || state.exporting) return;
    state.aspectLocked = Boolean(locked);
    if (!state.aspectLocked) {
      state.aspect = 'custom';
      state.preset = 'custom';
    }
    clearSizeValidation();
    afterDimensionChange();
  }

  function setWidth(value) {
    if (!state.meta || state.exporting) return;
    const raw = Number(value);
    if (!Number.isFinite(raw)) {
      showSizeValidation('Enter a number for the output width.');
      syncSizeInputs(true);
      return;
    }
    if (raw < 2 || raw > MAX_OUTPUT_EDGE) {
      showSizeValidation(`Width must be between 2 and ${MAX_OUTPUT_EDGE} px.`);
      syncSizeInputs(true);
      return;
    }

    const width = even(raw);
    let height = state.height;
    if (state.aspectLocked) {
      const ratio = activeRatio();
      if (ratio > 0) height = even(width / ratio);
    }

    if (height < 2) height = 2;
    if (height > MAX_OUTPUT_EDGE) {
      showSizeValidation(
        `A ${width} px width makes the height exceed ${MAX_OUTPUT_EDGE} px. Use a smaller width.`
      );
      syncSizeInputs(true);
      return;
    }

    state.width = width;
    state.height = Math.min(MAX_OUTPUT_EDGE, height);
    state.preset = 'custom';
    if (!state.aspectLocked) state.aspect = 'custom';
    clearSizeValidation();
    afterDimensionChange();
  }

  function setHeight(value) {
    if (!state.meta || state.exporting) return;
    const raw = Number(value);
    if (!Number.isFinite(raw)) {
      showSizeValidation('Enter a number for the output height.');
      syncSizeInputs(true);
      return;
    }
    if (raw < 2 || raw > MAX_OUTPUT_EDGE) {
      showSizeValidation(`Height must be between 2 and ${MAX_OUTPUT_EDGE} px.`);
      syncSizeInputs(true);
      return;
    }

    const height = even(raw);
    let width = state.width;
    if (state.aspectLocked) {
      const ratio = activeRatio();
      if (ratio > 0) width = even(height * ratio);
    }

    if (width < 2) width = 2;
    if (width > MAX_OUTPUT_EDGE) {
      showSizeValidation(
        `A ${height} px height makes the width exceed ${MAX_OUTPUT_EDGE} px. Use a smaller height.`
      );
      syncSizeInputs(true);
      return;
    }

    state.height = height;
    state.width = Math.min(MAX_OUTPUT_EDGE, width);
    state.preset = 'custom';
    if (!state.aspectLocked) state.aspect = 'custom';
    clearSizeValidation();
    afterDimensionChange();
  }

  function setBitrate(value) {
    const mbps = Number(value);
    if (!Number.isFinite(mbps) || mbps < 0.1 || mbps > 100) {
      showBitrateValidation('Enter a video bitrate between 0.1 and 100 Mbps.');
      syncBitrateInput();
      return;
    }
    state.bitrateMbps = Math.round(mbps * 10) / 10;
    clearBitrateValidation();
    syncBitrateInput();
    updateEstimate();
    updateExportState();
  }

  function setBackgroundMode(mode) {
    if (mode === 'custom') {
      state.backgroundMode = 'custom';
      state.backgroundColor = normalizeColor(els.backgroundColor.value);
    } else if (mode === 'white') {
      state.backgroundMode = 'white';
      state.backgroundColor = '#ffffff';
    } else {
      state.backgroundMode = 'black';
      state.backgroundColor = '#000000';
    }
    selectBackgroundRadio(state.backgroundMode);
    updateCustomSwatch();
    clearResult();
    updateFitUi();
    updateOutputUi();
    renderOutputPreview();
  }

  function selectBackgroundRadio(mode) {
    document.querySelectorAll('input[name="vr-bg"]').forEach((input) => {
      input.checked = input.value === mode;
    });
    if (mode === 'custom') els.colorField.hidden = false;
    else els.colorField.hidden = true;
  }

  function updateCustomSwatch() {
    const input = document.querySelector('input[name="vr-bg"][value="custom"]');
    if (!input) return;
    const swatch = input.parentElement.querySelector('span');
    if (swatch) swatch.style.setProperty('--swatch', state.backgroundColor);
  }

  function updateBackgroundDisabled() {
    const disabled = state.exporting || state.loading || state.fit === 'fill';
    els.backgroundGroup.classList.toggle('is-disabled', disabled);
    els.backgroundGroup.setAttribute('aria-disabled', String(disabled));
    els.backgroundGroup.querySelectorAll('input').forEach((input) => {
      input.disabled = disabled;
    });
  }

  function syncSizeInputs(force) {
    if (!state.meta) return;
    if (force || document.activeElement !== els.width) {
      els.width.value = String(state.width || '');
    }
    if (force || document.activeElement !== els.height) {
      els.height.value = String(state.height || '');
    }
  }

  function syncBitrateInput() {
    els.bitrate.value = String(state.bitrateMbps);
  }

  function afterDimensionChange() {
    if (!state.meta) {
      updateExportState();
      return;
    }
    clearResult();
    syncSizeInputs(true);
    updatePresetUi();
    updateAspectUi();
    updateSizeNote();
    updateFitUi();
    updateOutputUi();
    updateEstimate();
    updateWarnings();
    updateExportState();
    renderOutputPreview();
    scheduleSupportRefresh();
  }

  function updateAll() {
    if (!state.meta) {
      updateExportState();
      return;
    }
    updateMetaUi();
    updatePresetUi();
    updateAspectUi();
    updateSizeNote();
    updateFitUi();
    updateOutputUi();
    updateFormatUi();
    updateQualityUi();
    updateEstimate();
    updateWarnings();
    updateExportState();
  }

  function updateMetaUi() {
    const meta = state.meta;
    if (!meta) return;
    els.metaDuration.textContent = formatDuration(meta.duration);
    els.metaResolution.textContent = `${meta.width} × ${meta.height}`;
    els.metaAspect.textContent = aspectLabel(meta.width, meta.height);
    els.metaFps.textContent = formatFps(meta.fps, meta.fpsVariable);
    els.metaAudio.textContent = formatAudio(meta);
    els.metaRotation.textContent = meta.rotation ? `${meta.rotation}°` : 'None';
    els.metaSize.textContent = formatBytes(state.file ? state.file.size : 0);
    els.sourceDims.textContent = `${meta.width} × ${meta.height}`;
    els.originalLabel.textContent = `${meta.width}×${meta.height}`;
  }

  function updatePresetUi() {
    els.presets.querySelectorAll('[data-preset]').forEach((button) => {
      const active = button.dataset.preset === state.preset;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateAspectUi() {
    els.ratioButtons.querySelectorAll('[data-ratio]').forEach((button) => {
      const active = button.dataset.ratio === state.aspect;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (!state.meta) return;
    const source = aspectLabel(state.meta.width, state.meta.height);
    if (state.aspect === 'original') {
      els.ratioNote.textContent =
        `Original ratio (${source}). The output keeps the source shape; Fit and Fill produce the same picture.`;
    } else if (state.aspect === 'custom') {
      els.ratioNote.textContent =
        `Custom ratio (${ratioLabel(activeRatio())}). Aspect lock is off, so width and height can be edited independently.`;
    } else {
      const same = Math.abs(activeRatio() - sourceAspect()) < 0.005;
      const action = same
        ? 'The source already has this shape.'
        : state.fit === 'fill'
          ? 'Fill will crop the source edges to match this shape.'
          : 'Fit will add background padding to match this shape.';
      els.ratioNote.textContent = `Locked to ${state.aspect}. ${action}`;
    }
  }

  function updateSizeNote() {
    if (!state.meta) return;
    const sourceWidth = Math.round(state.meta.width);
    const sourceHeight = Math.round(state.meta.height);
    let note;

    if (state.preset === 'custom') {
      note = state.aspectLocked
        ? 'Custom size. The aspect ratio is locked, so changing one side updates the other.'
        : 'Custom size. Width and height are independent.';
    } else if (state.preset === 'original') {
      if (state.aspect === 'original') {
        note = `Original resolution keeps the source size (${sourceWidth} × ${sourceHeight}) and shape.`;
      } else {
        note = `Original resolution uses the source short edge (${Math.min(sourceWidth, sourceHeight)} px) and adapts the other side to ${ratioLabel(activeRatio())}.`;
      }
    } else {
      const tier = PRESETS[state.preset];
      note = `${PRESET_LABELS[state.preset]} uses a ${tier} px short edge. The other side follows the ${ratioLabel(activeRatio())} ratio.`;
    }

    if (state.width > sourceWidth || state.height > sourceHeight) {
      note += ' This output is larger than the source and cannot add detail.';
    }
    note += ' Output pixels are rounded to even numbers for the encoder.';
    els.sizeNote.textContent = note;
  }

  function updateFitUi() {
    document.querySelectorAll('input[name="vr-fit"]').forEach((input) => {
      input.checked = input.value === state.fit;
    });

    const same = Math.abs((state.width / state.height) - sourceAspect()) < 0.01;
    if (same) {
      els.fitNote.textContent =
        'The output shape matches the source, so Fit and Fill produce the same picture.';
    } else if (state.fit === 'fit') {
      els.fitNote.textContent =
        `Fit keeps the whole video visible and fills the extra ${sourceAspect() > state.width / state.height ? 'top and bottom' : 'left and right'} area with ${backgroundDescription()}.`;
    } else {
      els.fitNote.textContent =
        `Fill scales the video to cover the frame and crops the ${sourceAspect() > state.width / state.height ? 'left and right' : 'top and bottom'} edges. Nothing is stretched, but some of the picture is removed. Use Fit to keep everything.`;
    }

    updateBackgroundDisabled();
    updateCustomSwatch();
  }

  function updateOutputUi() {
    if (!state.meta) return;
    const dims = { width: state.width, height: state.height };
    els.outputPreviewDims.textContent = `${dims.width} × ${dims.height}`;
    els.sourceDims.textContent = `${state.meta.width} × ${state.meta.height}`;

    const same = Math.abs((dims.width / dims.height) - sourceAspect()) < 0.01;
    if (same) {
      els.previewMode.textContent = `Same shape · ${state.fit === 'fit' ? 'Fit' : 'Fill'}`;
    } else if (state.fit === 'fit') {
      els.previewMode.textContent = `Fit · ${backgroundShort()} padding`;
    } else {
      els.previewMode.textContent = 'Fill · crops edges';
    }

    const shapeNote = same
      ? 'Same shape as the source.'
      : state.fit === 'fit'
        ? `Fit adds ${backgroundShort()} padding.`
        : 'Fill crops the source edges.';
    els.outputSummary.textContent =
      `Source ${state.meta.width} × ${state.meta.height} → output ${dims.width} × ${dims.height} (${ratioLabel(activeRatio())}). ${shapeNote}`;
  }

  function updateFormatUi() {
    const dims = { width: state.width, height: state.height };
    const invalid = dims.width < 2 || dims.height < 2;
    const checked = state.supportChecked && state.support;
    const audioNeeded = Boolean(state.meta && state.meta.hasAudio);

    if (checked) {
      for (const format of FORMATS) {
        const entry = state.support[format] || {};
        const videoOk = Boolean(entry.video);
        const audioOk = !audioNeeded || Boolean(entry.audio);
        state.formatSupport[format] = videoOk && audioOk;
      }
    }

    for (const option of els.format.options) {
      const format = option.value;
      option.disabled = checked ? !state.formatSupport[format] : false;
    }

    if (checked && !state.formatSupport[state.format]) {
      const next = Array.from(els.format.options).find((option) => !option.disabled);
      if (next) state.format = next.value;
    }
    els.format.value = state.format;

    if (state.supportPending) {
      els.formatNote.textContent = 'Checking this browser’s encoders for the selected output size…';
    } else if (checked) {
      const available = FORMATS.filter((format) => state.formatSupport[format]);
      if (!available.length) {
        els.formatNote.textContent =
          'This browser cannot encode either MP4 or WebM at this output size. Choose a smaller resolution.';
      } else {
        const labels = available.map((format) => (format === 'webm' ? 'WebM (VP9/Opus)' : 'MP4 (H.264/AAC)'));
        els.formatNote.textContent = `Available at this size: ${labels.join(' and ')}.`;
      }
    } else if (state.supportError) {
      els.formatNote.textContent =
        'Encoder support could not be verified. The export may still work, but it will be checked again before writing the file.';
    } else {
      els.formatNote.textContent =
        'Formats are enabled only when this browser can encode them at the chosen output size.';
    }

    if (invalid) {
      els.formatNote.textContent = 'Choose a valid output size first.';
    }
  }

  function updateQualityUi() {
    document.querySelectorAll('input[name="vr-quality"]').forEach((input) => {
      input.checked = input.value === state.quality;
    });
    els.bitrateField.hidden = state.quality !== 'custom';
    syncBitrateInput();
  }

  function updateEstimate() {
    if (!state.meta || state.quality !== 'custom') {
      els.sizeEstimate.hidden = true;
      els.sizeEstimate.textContent = '';
      return;
    }
    if (!Number.isFinite(state.bitrateMbps) || state.bitrateMbps <= 0) {
      els.sizeEstimate.hidden = true;
      return;
    }
    const videoBps = state.bitrateMbps * 1000000;
    const audioBps = state.meta.hasAudio ? AUDIO_BITRATE[state.format] : 0;
    const bytes = ((videoBps + audioBps) * state.meta.duration) / 8;
    const audioNote = state.meta.hasAudio
      ? ` plus ${Math.round(AUDIO_BITRATE[state.format] / 1000)} kbps audio`
      : ' with no audio track';
    els.sizeEstimate.hidden = false;
    els.sizeEstimate.textContent =
      `Estimated output ≈ ${formatBytes(bytes)} at ${state.bitrateMbps} Mbps video${audioNote}. The actual size is measured after export and may differ.`;
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
        `${formatBytes(state.file.size)} input file. Decoding it can use a lot of memory; close other heavy tabs before exporting.`
      );
    }
    if (state.meta.duration > LONG_VIDEO_SECONDS) {
      messages.push(
        `${formatDuration(state.meta.duration)} video. Export time grows with duration; keep this tab open until it finishes.`
      );
    }
    if (state.width * state.height > 3840 * 2160) {
      messages.push(
        `${state.width} × ${state.height} output is very large. A smaller resolution will export faster and use less memory.`
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

  function updateExportState() {
    if (!els.exportButton) return;
    const invalidSize =
      state.width < 2 ||
      state.height < 2 ||
      state.width > MAX_OUTPUT_EDGE ||
      state.height > MAX_OUTPUT_EDGE;
    const noFormat =
      state.supportChecked && state.support && !FORMATS.some((format) => state.formatSupport[format]);
    const badBitrate =
      state.quality === 'custom' &&
      (!Number.isFinite(state.bitrateMbps) || state.bitrateMbps < 0.1 || state.bitrateMbps > 100);
    const busy = state.exporting || state.loading;
    const ready =
      Boolean(state.meta) &&
      !invalidSize &&
      !noFormat &&
      !busy &&
      !state.supportPending &&
      !badBitrate;

    els.exportButton.disabled = !ready;
    els.cancel.hidden = !state.exporting;

    if (state.exporting) {
      els.exportNote.textContent = state.canceling
        ? 'Canceling the resize and releasing encoder resources…'
        : 'Encoding the resized video and audio in your browser.';
      return;
    }

    if (!state.meta) {
      els.exportNote.textContent = 'Upload a video to enable export.';
    } else if (state.loading) {
      els.exportNote.textContent = 'Reading the video…';
    } else if (invalidSize) {
      els.exportNote.textContent = 'Choose a valid output size.';
    } else if (badBitrate) {
      els.exportNote.textContent = 'Enter a valid custom bitrate between 0.1 and 100 Mbps.';
    } else if (state.supportPending) {
      els.exportNote.textContent = 'Checking encoder support…';
    } else if (noFormat) {
      els.exportNote.textContent = 'No supported output format at this size. Try a smaller resolution.';
    } else if (state.supportError) {
      els.exportNote.textContent = 'Encoder support was not confirmed, but you can still try the export.';
    } else {
      const qualityNote = state.quality === 'custom' ? ` at ${state.bitrateMbps} Mbps` : '';
      els.exportNote.textContent =
        `Ready to export ${state.width} × ${state.height} ${formatLabel(state.format)}${qualityNote}. The file is re-encoded, not losslessly copied.`;
    }
  }

  function scheduleSupportRefresh(delay = 180) {
    clearTimeout(supportTimer);
    if (!state.meta) {
      resetSupport();
      updateExportState();
      return;
    }
    state.supportPending = true;
    state.supportError = false;
    updateFormatUi();
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
    state.formatSupport = { mp4: true, webm: true };
  }

  async function refreshSupport() {
    if (!state.meta) return;
    if (state.exporting) {
      state.supportPending = false;
      updateExportState();
      return;
    }
    if (state.width < 2 || state.height < 2) {
      state.supportPending = false;
      updateExportState();
      return;
    }

    const token = ++supportToken;
    try {
      const result = await requestWorker('support', {
        sizes: [{ key: 'out', width: state.width, height: state.height }],
        needsAudio: Boolean(state.meta.hasAudio)
      });
      if (token !== supportToken) return;
      state.support = {
        mp4: {
          video: Boolean(result && result.mp4 && result.mp4.out),
          audio: Boolean(result && result.mp4 && result.mp4.audio)
        },
        webm: {
          video: Boolean(result && result.webm && result.webm.out),
          audio: Boolean(result && result.webm && result.webm.audio)
        }
      };
      state.supportChecked = true;
      state.supportPending = false;
      state.supportError = false;
      updateFormatUi();
      updateEstimate();
      updateExportState();
    } catch (error) {
      if (token !== supportToken) return;
      state.supportChecked = false;
      state.supportPending = false;
      state.supportError = true;
      state.support = null;
      state.formatSupport = { mp4: true, webm: true };
      updateFormatUi();
      updateExportState();
    }
  }

  function renderOutputPreview() {
    if (!state.meta || !els.previewCanvas || els.editor.hidden) return;

    const ratio = state.width > 0 && state.height > 0 ? state.width / state.height : 16 / 9;
    const longEdge = 720;
    let width;
    let height;
    if (ratio >= 1) {
      width = longEdge;
      height = Math.round(longEdge / ratio);
    } else {
      height = longEdge;
      width = Math.round(longEdge * ratio);
    }
    width = Math.max(2, Math.min(960, width));
    height = Math.max(2, Math.min(960, height));

    const canvas = els.previewCanvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    let context = null;
    try {
      context = canvas.getContext('2d', { alpha: false });
    } catch (error) {
      context = null;
    }
    if (!context) return;

    const background = state.fit === 'fit' ? state.backgroundColor : '#000000';
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const video = els.video;
    const sourceWidth = video.videoWidth || 0;
    const sourceHeight = video.videoHeight || 0;

    if (!sourceWidth || !sourceHeight || video.readyState < 2) {
      const light = luminance(background) > 0.6;
      context.fillStyle = light ? 'rgba(15, 23, 42, 0.62)' : 'rgba(255, 255, 255, 0.78)';
      context.font = `${Math.max(11, Math.round(height * 0.05))}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('Frame preview appears here', width / 2, height / 2);
      return;
    }

    const scale = state.fit === 'fill'
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const drawX = (width - drawWidth) / 2;
    const drawY = (height - drawHeight) / 2;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    try {
      context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
    } catch (error) {
      /* A frame may not be available yet; the next event will retry. */
    }
  }

  function startPreviewLoop() {
    if (previewFrameRequest) return;
    const tick = (now) => {
      if (els.video.paused || els.video.ended) {
        previewFrameRequest = 0;
        renderOutputPreview();
        return;
      }
      if (!lastPreviewDraw || now - lastPreviewDraw >= 40) {
        lastPreviewDraw = now;
        renderOutputPreview();
      }
      previewFrameRequest = requestAnimationFrame(tick);
    };
    previewFrameRequest = requestAnimationFrame(tick);
  }

  function stopPreviewLoop() {
    if (previewFrameRequest) cancelAnimationFrame(previewFrameRequest);
    previewFrameRequest = 0;
    lastPreviewDraw = 0;
    renderOutputPreview();
  }

  async function startExport() {
    if (!state.meta || !state.file || state.exporting) return;

    if (state.width < 2 || state.height < 2) {
      showError('The output size is not valid. Choose a preset or enter a valid custom size.');
      return;
    }
    if (state.width > MAX_OUTPUT_EDGE || state.height > MAX_OUTPUT_EDGE) {
      showError(`The output cannot exceed ${MAX_OUTPUT_EDGE} px on either edge. Choose a smaller resolution.`);
      return;
    }
    if (state.quality === 'custom' && (!Number.isFinite(state.bitrateMbps) || state.bitrateMbps < 0.1 || state.bitrateMbps > 100)) {
      showError('Enter a valid custom bitrate between 0.1 and 100 Mbps.');
      return;
    }

    if (!state.supportChecked || state.supportPending) {
      clearTimeout(supportTimer);
      state.supportPending = false;
      await refreshSupport();
    }
    if (state.supportChecked && state.support && !state.formatSupport[state.format]) {
      showError('This browser cannot encode the selected format at this output size. Choose another format or a smaller resolution.');
      updateExportState();
      return;
    }

    clearTimeout(supportTimer);
    state.supportPending = false;
    state.exporting = true;
    state.canceling = false;
    clearError();
    clearSizeValidation();
    clearBitrateValidation();
    clearResult();
    stopPlayback();
    setControlsDisabled(true);

    els.progress.hidden = false;
    els.result.hidden = true;
    els.progressBar.style.width = '0%';
    els.progressTrack.setAttribute('aria-valuenow', '0');
    els.progressLabel.textContent = 'Preparing the resize…';
    updateExportState();

    try {
      const payload = await requestWorker('export', {
        file: state.file,
        options: {
          width: state.width,
          height: state.height,
          format: state.format,
          quality: state.quality,
          bitrate: state.quality === 'custom' ? Math.round(state.bitrateMbps * 1000000) : undefined,
          fit: state.fit,
          background: state.backgroundColor,
          fps: state.meta.fps || 30
        }
      });

      if (!payload || !payload.buffer) {
        throw new Error('The export did not return a video file.');
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
        fit: payload.fit
      };
      renderResult();
      els.progressBar.style.width = '100%';
      els.progressTrack.setAttribute('aria-valuenow', '100');
      els.progressLabel.textContent = 'Export complete. The file was verified.';
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (state.canceling || /cancel/i.test(message)) {
        showError('Resize canceled. No file was created, and encoder resources were released.');
      } else {
        showError(friendlyError(error));
      }
    } finally {
      state.exporting = false;
      state.canceling = false;
      els.progress.hidden = true;
      setControlsDisabled(false);
      updateExportState();
      renderOutputPreview();
    }
  }

  function cancelExport() {
    if (!state.exporting || state.canceling) return;
    state.canceling = true;
    els.progressLabel.textContent = 'Canceling the resize…';
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
      els.progressLabel.textContent = 'Canceling the resize…';
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
  }

  function renderResult() {
    const output = state.output;
    if (!output) return;
    els.result.hidden = false;
    els.resultNote.textContent =
      `${state.meta.width} × ${state.meta.height} → ${output.width} × ${output.height}. Created locally and verified.`;
    els.resultVideo.src = output.url;
    els.resultVideo.load();
    els.resultName.textContent = output.filename;
    els.resultFormat.textContent = `${formatLabel(output.extension)} · ${output.mimeType}`;
    els.resultDuration.textContent = formatDuration(output.duration);
    els.resultSize.textContent = formatBytes(output.size);
    els.resultResolution.textContent = `${output.width} × ${output.height}`;
    els.resultAudio.textContent = output.hasAudio ? 'Preserved' : 'No audio track';
    els.download.disabled = false;
    els.download.dataset.filename = output.filename;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.result.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
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
  }

  function makeOutputName(extension) {
    const base = state.file
      ? state.file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[\\/:*?"<>|]+/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    return `${base || 'video'}-${state.width}x${state.height}.${extension}`;
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
    stopPreviewLoop();
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

  function normalizeColor(value) {
    const text = String(value || '').trim();
    const long = /^#([0-9a-f]{6})$/i.exec(text);
    if (long) return `#${long[1].toLowerCase()}`;
    const short = /^#([0-9a-f]{3})$/i.exec(text);
    if (short) {
      const [r, g, b] = short[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return '#000000';
  }

  function luminance(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(normalizeColor(hex));
    if (!match) return 0;
    const value = parseInt(match[1], 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  }

  function backgroundDescription() {
    if (state.backgroundMode === 'black') return 'a black background';
    if (state.backgroundMode === 'white') return 'a white background';
    return `the ${state.backgroundColor} background`;
  }

  function backgroundShort() {
    if (state.backgroundMode === 'black') return 'black';
    if (state.backgroundMode === 'white') return 'white';
    return state.backgroundColor;
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

  function aspectLabel(width, height) {
    if (!width || !height) return '—';
    const divisor = gcd(Math.round(width), Math.round(height));
    const w = Math.round(width / divisor);
    const h = Math.round(height / divisor);
    if (w <= 40 && h <= 40) return `${w}:${h}`;
    return `${(width / height).toFixed(2)}:1`;
  }

  function ratioLabel(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return '—';
    for (const [label, value] of Object.entries(RATIOS)) {
      if (Math.abs(ratio - value) < 0.002) return label;
    }
    return `${ratio.toFixed(2)}:1`;
  }

  function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  function formatLabel(format) {
    return format === 'webm' ? 'WebM' : 'MP4';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
    if (/cancel/i.test(message)) return 'Resize canceled. No file was created.';
    if (/could not be read as a supported video|cannot decode|no video track|no readable video duration/i.test(message)) {
      return message;
    }
    if (/memory|allocation|too large|array buffer/i.test(message)) {
      return 'This export ran out of memory. Try a shorter video, a smaller output resolution, or close other memory-heavy tabs.';
    }
    if (/audio/i.test(message) && /decode|encode|support|codec/i.test(message)) return message;
    if (/decode|codec|decodable/i.test(message)) {
      return `This browser cannot decode part of this video. ${message}`;
    }
    if (/format|unsupported|parse|demux|read|container/i.test(message)) {
      return `This file could not be read as a supported video. Try an MP4, WebM, MOV, M4V or MKV file that plays in this browser. ${message}`;
    }
    return message;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./video-resizer-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const error = new Error('The video processing worker stopped. Try reloading the page.');
      rejectPending(error);
      terminateWorker(true);
      showError(error.message);
      state.exporting = false;
      state.canceling = false;
      els.progress.hidden = true;
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
    if (previewFrameRequest) cancelAnimationFrame(previewFrameRequest);
    previewFrameRequest = 0;
    terminateWorker(true);
    if (state.url) URL.revokeObjectURL(state.url);
    if (state.output && state.output.url) URL.revokeObjectURL(state.output.url);
  }

  function exposeDebugApi() {
    window.__videoResizer = {
      getState() {
        return {
          ready: Boolean(state.meta),
          file: state.file
            ? {
                name: state.file.name,
                size: state.file.size,
                type: state.file.type
              }
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
                container: state.meta.container,
                videoCodec: state.meta.videoCodec
              }
            : null,
          preset: state.preset,
          aspect: state.aspect,
          aspectLocked: state.aspectLocked,
          width: state.width,
          height: state.height,
          outputSize: { width: state.width, height: state.height },
          fit: state.fit,
          background: {
            mode: state.backgroundMode,
            color: state.backgroundColor
          },
          format: state.format,
          quality: state.quality,
          bitrateMbps: state.bitrateMbps,
          formatSupport: { ...state.formatSupport },
          supportChecked: state.supportChecked,
          supportPending: state.supportPending,
          supportError: state.supportError,
          exporting: state.exporting,
          output: state.output
            ? {
                filename: state.output.filename,
                mimeType: state.output.mimeType,
                duration: state.output.duration,
                width: state.output.width,
                height: state.output.height,
                hasAudio: state.output.hasAudio,
                size: state.output.size,
                fit: state.output.fit,
                url: state.output.url
              }
            : null,
          preview: {
            width: els.previewCanvas ? els.previewCanvas.width : 0,
            height: els.previewCanvas ? els.previewCanvas.height : 0
          }
        };
      },
      getOutputUrl() {
        return state.output ? state.output.url : null;
      },
      getOutputBlob() {
        return state.output ? state.output.blob : null;
      },
      setPreset(key) {
        applyPreset(key);
      },
      setAspect(key) {
        applyAspect(key);
      },
      setSize(width, height) {
        if (!state.meta) return false;
        const w = Math.round(Number(width));
        const h = Math.round(Number(height));
        if (
          !Number.isFinite(w) ||
          !Number.isFinite(h) ||
          w < 2 ||
          h < 2 ||
          w > MAX_OUTPUT_EDGE ||
          h > MAX_OUTPUT_EDGE
        ) {
          return false;
        }
        state.aspectLocked = false;
        state.aspect = 'custom';
        state.preset = 'custom';
        state.width = even(w);
        state.height = even(h);
        els.aspectLock.checked = false;
        clearSizeValidation();
        afterDimensionChange();
        return true;
      },
      setAspectLock(locked) {
        els.aspectLock.checked = Boolean(locked);
        setAspectLock(Boolean(locked));
      },
      setFit(mode) {
        if (mode !== 'fit' && mode !== 'fill') return;
        state.fit = mode;
        clearResult();
        updateFitUi();
        updateAspectUi();
        updateOutputUi();
        updateExportState();
        renderOutputPreview();
      },
      setBackground(mode, color) {
        if (!['black', 'white', 'custom'].includes(mode)) return;
        if (mode === 'custom' && color) {
          state.backgroundColor = normalizeColor(color);
          els.backgroundColor.value = state.backgroundColor;
        }
        setBackgroundMode(mode);
      },
      setFormat(format) {
        if (format !== 'mp4' && format !== 'webm') return;
        state.format = format;
        els.format.value = format;
        clearResult();
        updateFormatUi();
        updateEstimate();
        updateExportState();
      },
      setQuality(quality) {
        if (!['high', 'balanced', 'smaller', 'custom'].includes(quality)) return;
        state.quality = quality;
        document.querySelectorAll('input[name="vr-quality"]').forEach((input) => {
          input.checked = input.value === quality;
        });
        clearResult();
        updateQualityUi();
        updateEstimate();
        updateExportState();
      },
      setBitrate(mbps) {
        els.bitrate.value = String(mbps);
        setBitrate(mbps);
      },
      startExport() {
        return startExport();
      },
      cancelExport() {
        cancelExport();
      },
      removeVideo() {
        removeVideo();
      },
      renderPreview() {
        renderOutputPreview();
      }
    };
  }
})();
