(() => {
  'use strict';

  const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
  const LARGE_FILE_BYTES = 700 * 1024 * 1024;
  const LONG_VIDEO_SECONDS = 10 * 60;
  const MAX_OUTPUT_EDGE = 4096;
  const MIN_CROP = 24;
  const ACCEPTED_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
  const FORMATS = ['mp4', 'webm'];
  const OUTPUT_MODES = ['original', '1080', '720', '480', 'custom'];
  const RATIOS = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '4:5': 4 / 5,
    '5:4': 5 / 4
  };

  const state = {
    file: null,
    url: null,
    thumbnail: '',
    meta: null,
    crop: { x: 0, y: 0, w: 0, h: 0 },
    ratio: 'source',
    mode: 'edit',
    outputMode: 'original',
    custom: { width: 0, height: 0 },
    format: 'mp4',
    quality: 'medium',
    duration: 0,
    loading: false,
    exporting: false,
    canceling: false,
    supportChecked: false,
    supportPending: false,
    supportError: false,
    support: null,
    formatSupport: { mp4: true, webm: true },
    output: null,
    view: { scale: 1, frameWidth: 0, frameHeight: 0 }
  };

  const els = {};
  let worker = null;
  let requestId = 0;
  let supportToken = 0;
  let supportTimer = null;
  let layoutFrameRequest = 0;
  let drag = null;
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
    setupCrop();
    setupRatioButtons();
    setupNumericFields();
    setupOutputSettings();
    setupExport();
    updateYear();
    exposeDebugApi();

    const observer = new ResizeObserver(scheduleLayout);
    if (els.stage) observer.observe(els.stage);
    window.addEventListener('resize', scheduleLayout);
    document.addEventListener('fullscreenchange', () => {
      scheduleLayout();
      setTimeout(scheduleLayout, 80);
    });

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
      frame: '[data-frame]',
      video: '[data-video]',
      videoError: '[data-video-error]',
      overlay: '[data-overlay]',
      cropBox: '[data-crop]',
      cropSize: '[data-crop-size]',
      previewBadge: '[data-preview-badge]',
      bigPlay: '[data-big-play]',
      play: '[data-play]',
      current: '[data-current]',
      seek: '[data-seek]',
      total: '[data-total]',
      mute: '[data-mute]',
      volume: '[data-volume]',
      fullscreen: '[data-fullscreen]',
      keyhint: '[data-keyhint]',
      metaDuration: '[data-meta-duration]',
      metaResolution: '[data-meta-resolution]',
      metaAspect: '[data-meta-aspect]',
      metaFps: '[data-meta-fps]',
      metaAudio: '[data-meta-audio]',
      metaRotation: '[data-meta-rotation]',
      metaSize: '[data-meta-size]',
      modeEdit: '[data-mode-edit]',
      modePreview: '[data-mode-preview]',
      modeNote: '[data-mode-note]',
      ratioButtons: '[data-ratio-buttons]',
      ratioNote: '[data-ratio-note]',
      cropX: '[data-crop-x]',
      cropY: '[data-crop-y]',
      cropW: '[data-crop-width]',
      cropH: '[data-crop-height]',
      cropValidation: '[data-crop-validation]',
      resetCrop: '[data-reset-crop]',
      outputMode: '[data-output-mode]',
      customSize: '[data-custom-size]',
      customWidth: '[data-custom-width]',
      customHeight: '[data-custom-height]',
      outputNote: '[data-output-note]',
      outputSummary: '[data-output-summary]',
      format: '[data-format]',
      formatNote: '[data-format-note]',
      exportButton: '[data-export]',
      cancel: '[data-cancel]',
      exportNote: '[data-export-note]',
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
        showError('This tool crops one video at a time. The first file was loaded; remove it before adding another.');
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
        showError('This tool crops one video at a time. The first file was loaded.');
      }
      loadFile(files[0]);
    });

    els.dropzone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      els.fileInput.click();
    });
  }

  function setupPlayer() {
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
      scheduleLayout();
      updateTimeDisplay();
    });

    els.video.addEventListener('play', () => {
      els.player.classList.add('is-playing');
      updatePlayButton();
    });

    els.video.addEventListener('pause', () => {
      els.player.classList.remove('is-playing');
      updatePlayButton();
    });

    els.video.addEventListener('timeupdate', updateTimeDisplay);
    els.video.addEventListener('ended', () => {
      els.player.classList.remove('is-playing');
      updatePlayButton();
    });

    els.video.addEventListener('error', () => {
      if (!state.meta) return;
      els.videoError.hidden = false;
      els.videoError.textContent =
        'This browser cannot play this file directly. Cropping may still work because the exporter uses a separate decoder.';
    });

    els.video.addEventListener('volumechange', updateVolumeUi);

    els.stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-crop]')) return;
      els.player.focus({ preventScroll: true });
    });

    els.player.addEventListener('keydown', (event) => {
      if (event.target.closest('input, select, textarea, button, a, [data-crop]')) return;
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

  function setupCrop() {
    els.overlay.addEventListener('pointerdown', onCropPointerDown);
    els.overlay.addEventListener('pointermove', onCropPointerMove);
    els.overlay.addEventListener('pointerup', endCropDrag);
    els.overlay.addEventListener('pointercancel', endCropDrag);

    els.cropBox.addEventListener('keydown', (event) => {
      if (state.mode !== 'edit' || state.exporting) return;
      const step = event.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (event.key === 'ArrowLeft') dx = -step;
      else if (event.key === 'ArrowRight') dx = step;
      else if (event.key === 'ArrowUp') dy = -step;
      else if (event.key === 'ArrowDown') dy = step;
      else return;
      event.preventDefault();
      moveCropBy(dx, dy);
    });

    els.cropBox.querySelectorAll('[data-handle]').forEach((handle) => {
      handle.addEventListener('keydown', (event) => {
        if (state.mode !== 'edit' || state.exporting) return;
        const step = event.shiftKey ? 10 : 1;
        const name = handle.dataset.handle;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        else return;
        event.preventDefault();
        event.stopPropagation();
        applyCrop(resizeCrop(state.crop, name, dx, dy));
      });
    });

    els.resetCrop.addEventListener('click', () => {
      if (!state.meta || state.exporting) return;
      setRatio('source');
      clearCropValidation();
      clearResult();
      updateAll();
    });

    els.modeEdit.addEventListener('click', () => setMode('edit'));
    els.modePreview.addEventListener('click', () => setMode('preview'));

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement !== els.player && els.player.classList.contains('is-fullscreen')) {
        els.player.classList.remove('is-fullscreen');
      }
      if (document.fullscreenElement === els.player) els.player.classList.add('is-fullscreen');
      scheduleLayout();
    });
  }

  function setupRatioButtons() {
    els.ratioButtons.addEventListener('click', (event) => {
      const button = event.target.closest('[data-ratio]');
      if (!button || button.disabled || state.exporting) return;
      setRatio(button.dataset.ratio);
    });
  }

  function setupNumericFields() {
    const fields = [
      [els.cropX, 'x'],
      [els.cropY, 'y'],
      [els.cropW, 'width'],
      [els.cropH, 'height']
    ];

    for (const [input, field] of fields) {
      if (!input) continue;
      input.addEventListener('change', () => {
        if (!state.meta) return;
        const value = Number(input.value);
        if (!Number.isFinite(value)) {
          showCropValidation('Enter a number for this crop value.');
          syncCropInputs(true);
          return;
        }
        applyCropField(field, value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('blur', () => {
        if (!state.meta) return;
        syncCropInputs(true);
      });
    }
  }

  function setupOutputSettings() {
    els.outputMode.addEventListener('change', () => {
      const value = els.outputMode.value;
      state.outputMode = OUTPUT_MODES.includes(value) ? value : 'original';
      if (state.outputMode === 'custom') {
        const dims = outputDimensions();
        state.custom.width = dims.width;
        state.custom.height = dims.height;
        els.customWidth.value = String(dims.width);
        els.customHeight.value = String(dims.height);
      }
      clearResult();
      updateOutputUi();
      scheduleSupportRefresh();
    });

    const customInputs = [
      [els.customWidth, 'width'],
      [els.customHeight, 'height']
    ];

    for (const [input, axis] of customInputs) {
      if (!input) continue;
      input.addEventListener('change', () => {
        if (!state.meta) return;
        const value = Math.round(Number(input.value));
        if (!Number.isFinite(value) || value < 2) {
          syncCustomInputs(true);
          return;
        }
        const aspect = cropAspect();
        if (!aspect) return;
        const clamped = Math.min(MAX_OUTPUT_EDGE, Math.max(2, value));
        if (axis === 'width') {
          state.custom.width = even(clamped);
          state.custom.height = even(state.custom.width / aspect);
        } else {
          state.custom.height = even(clamped);
          state.custom.width = even(state.custom.height * aspect);
        }
        if (state.custom.width > MAX_OUTPUT_EDGE) {
          state.custom.width = MAX_OUTPUT_EDGE;
          state.custom.height = even(state.custom.width / aspect);
        }
        if (state.custom.height > MAX_OUTPUT_EDGE) {
          state.custom.height = MAX_OUTPUT_EDGE;
          state.custom.width = even(state.custom.height * aspect);
        }
        syncCustomInputs(true);
        clearResult();
        updateOutputUi();
        scheduleSupportRefresh();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('blur', () => syncCustomInputs(true));
    }

    els.format.addEventListener('change', () => {
      state.format = els.format.value === 'webm' ? 'webm' : 'mp4';
      clearResult();
      updateFormatUi();
      updateExportState();
    });

    document.querySelectorAll('input[name="vc-quality"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.quality = input.value === 'high' || input.value === 'low' ? input.value : 'medium';
        clearResult();
        updateExportState();
      });
    });
  }

  function setupExport() {
    els.exportButton.addEventListener('click', startExport);
    els.cancel.addEventListener('click', cancelExport);
    els.newVideo.addEventListener('click', removeVideo);

    els.resultVideo.addEventListener('error', () => {
      if (!state.output) return;
      els.resultNote.textContent =
        'The cropped file was created, but this browser cannot preview it here. Download it and open it in a video app.';
    });
  }

  function updateYear() {
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  async function loadFile(file) {
    if (state.exporting) {
      showError('Wait for the current export to finish before replacing the video.');
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
      els.modeEdit,
      els.modePreview,
      els.resetCrop,
      els.outputMode,
      els.customWidth,
      els.customHeight,
      els.format,
      els.replace,
      els.remove,
      els.cropX,
      els.cropY,
      els.cropW,
      els.cropH
    ];
    for (const control of controls) {
      if (control) control.disabled = disabled;
    }
    els.ratioButtons.querySelectorAll('button').forEach((button) => {
      button.disabled = disabled;
    });
    document.querySelectorAll('input[name="vc-quality"]').forEach((input) => {
      input.disabled = disabled;
    });
    els.editor.classList.toggle('is-busy', disabled);
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
    state.crop = { x: 0, y: 0, w: payload.width, h: payload.height };
    state.ratio = 'source';
    state.mode = 'edit';
    state.outputMode = 'original';
    state.custom = { width: 0, height: 0 };
    state.format = 'mp4';
    state.quality = 'medium';
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

    els.outputMode.value = 'original';
    els.format.value = 'mp4';
    els.customWidth.value = '';
    els.customHeight.value = '';
    document.querySelectorAll('input[name="vc-quality"]').forEach((input) => {
      input.checked = input.value === 'medium';
    });

    els.video.volume = 1;
    els.video.muted = false;
    els.volume.value = '1';
    els.seek.value = '0';
    els.current.textContent = '00:00';
    els.total.textContent = formatClock(payload.duration);

    updateAll();
    requestAnimationFrame(() => {
      scheduleLayout();
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
    state.crop = { x: 0, y: 0, w: 0, h: 0 };
    state.ratio = 'source';
    state.mode = 'edit';
    state.outputMode = 'original';
    state.custom = { width: 0, height: 0 };
    state.support = null;
    state.supportChecked = false;
    state.supportPending = false;
    state.supportError = false;
    state.formatSupport = { mp4: true, webm: true };

    els.editor.hidden = true;
    els.dropzone.hidden = false;
    els.fileThumb.removeAttribute('src');
    els.fileThumb.hidden = true;
    els.customSize.hidden = true;
    els.warning.hidden = true;
    els.warning.textContent = '';
    els.videoError.hidden = true;
    clearError();
    clearCropValidation();
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

  function showCropValidation(message) {
    els.cropValidation.textContent = message;
    els.cropValidation.hidden = false;
  }

  function clearCropValidation() {
    els.cropValidation.textContent = '';
    els.cropValidation.hidden = true;
  }

  function scheduleLayout() {
    if (layoutFrameRequest) return;
    layoutFrameRequest = requestAnimationFrame(() => {
      layoutFrameRequest = 0;
      layoutFrame();
    });
  }

  function layoutFrame() {
    if (!state.meta || !els.stage || els.editor.hidden) return;

    const preview = state.mode === 'preview';
    const sourceAspect = state.meta.width / state.meta.height;
    const crop = state.crop;
    if (crop.w <= 0 || crop.h <= 0) return;
    const aspect = preview ? crop.w / crop.h : sourceAspect;
    const availableWidth = Math.max(120, els.stage.clientWidth);
    const fullscreen = document.fullscreenElement === els.player;
    const maxHeight = fullscreen
      ? Math.max(160, window.innerHeight - 150)
      : Math.min(560, Math.max(190, window.innerHeight * 0.56));

    let width = availableWidth;
    let height = width / aspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    if (width > availableWidth) {
      width = availableWidth;
      height = width / aspect;
    }

    width = Math.max(60, width);
    height = Math.max(40, height);

    els.frame.style.width = `${width}px`;
    els.frame.style.height = `${height}px`;
    state.view.frameWidth = width;
    state.view.frameHeight = height;

    if (preview) {
      const scale = width / crop.w;
      state.view.scale = scale;
      els.video.style.width = `${state.meta.width * scale}px`;
      els.video.style.height = `${state.meta.height * scale}px`;
      els.video.style.left = `${-crop.x * scale}px`;
      els.video.style.top = `${-crop.y * scale}px`;
    } else {
      const scale = width / state.meta.width;
      state.view.scale = scale;
      els.video.style.width = '100%';
      els.video.style.height = '100%';
      els.video.style.left = '0px';
      els.video.style.top = '0px';
    }

    renderCropBox();
  }

  function renderCropBox() {
    if (!state.meta) return;
    const scale = state.view.scale || 0;
    const crop = state.crop;
    const left = crop.x * scale;
    const top = crop.y * scale;
    const width = crop.w * scale;
    const height = crop.h * scale;

    els.cropBox.style.left = `${left}px`;
    els.cropBox.style.top = `${top}px`;
    els.cropBox.style.width = `${Math.max(1, width)}px`;
    els.cropBox.style.height = `${Math.max(1, height)}px`;

    if (els.cropSize) {
      els.cropSize.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)} px`;
      els.cropSize.hidden = width < 110 || height < 46;
    }

    els.cropBox.setAttribute(
      'aria-description',
      `Crop at ${Math.round(crop.x)}, ${Math.round(crop.y)}, ${Math.round(crop.w)} by ${Math.round(crop.h)} pixels`
    );

    updateHandleLabels();
  }

  function updateHandleLabels() {
    const crop = state.crop;
    const labels = {
      nw: `Top left corner. Crop starts at ${Math.round(crop.x)}, ${Math.round(crop.y)}.`,
      n: `Top edge. Crop starts at ${Math.round(crop.x)}, ${Math.round(crop.y)}.`,
      ne: `Top right corner. Crop ends at ${Math.round(crop.x + crop.w)}, ${Math.round(crop.y)}.`,
      e: `Right edge. Crop ends at ${Math.round(crop.x + crop.w)}.`,
      se: `Bottom right corner. Crop ends at ${Math.round(crop.x + crop.w)}, ${Math.round(crop.y + crop.h)}.`,
      s: `Bottom edge. Crop ends at ${Math.round(crop.y + crop.h)}.`,
      sw: `Bottom left corner. Crop ends at ${Math.round(crop.x)}, ${Math.round(crop.y + crop.h)}.`,
      w: `Left edge. Crop starts at ${Math.round(crop.x)}.`
    };
    els.cropBox.querySelectorAll('[data-handle]').forEach((handle) => {
      const label = labels[handle.dataset.handle];
      if (label) handle.setAttribute('aria-label', label);
    });
  }

  function setMode(mode) {
    if (!state.meta || state.exporting) return;
    state.mode = mode === 'preview' ? 'preview' : 'edit';
    updateModeUi();
    scheduleLayout();
  }

  function onCropPointerDown(event) {
    if (!state.meta || state.mode !== 'edit' || state.exporting) return;
    if (event.button !== undefined && event.button !== 0) return;
    const cropBox = event.target.closest('[data-crop]');
    if (!cropBox) return;

    const handle = event.target.closest('[data-handle]');
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      handle: handle ? handle.dataset.handle : 'move',
      startX: event.clientX,
      startY: event.clientY,
      crop: { ...state.crop },
      scale: state.view.scale || 1
    };
    try {
      els.overlay.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Pointer capture is a nicety; dragging still works without it. */
    }
    cropBox.focus({ preventScroll: true });
    els.player.classList.add('is-cropping');
  }

  function onCropPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - drag.startX) / drag.scale;
    const dy = (event.clientY - drag.startY) / drag.scale;

    let next;
    if (drag.handle === 'move') {
      next = {
        x: clamp(drag.crop.x + dx, 0, state.meta.width - drag.crop.w),
        y: clamp(drag.crop.y + dy, 0, state.meta.height - drag.crop.h),
        w: drag.crop.w,
        h: drag.crop.h
      };
    } else {
      next = resizeCrop(drag.crop, drag.handle, dx, dy);
    }
    applyCrop(next, { fromDrag: true });
  }

  function endCropDrag(event) {
    if (!drag) return;
    if (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    try {
      els.overlay.releasePointerCapture(drag.pointerId);
    } catch (error) {
      /* The capture may already be released. */
    }
    drag = null;
    els.player.classList.remove('is-cropping');
    clearCropValidation();
    clearResult();
    syncCropInputs(true);
    updateOutputUi();
    scheduleSupportRefresh();
  }

  function moveCropBy(dx, dy) {
    if (!state.meta) return;
    applyCrop({
      x: clamp(state.crop.x + dx, 0, state.meta.width - state.crop.w),
      y: clamp(state.crop.y + dy, 0, state.meta.height - state.crop.h),
      w: state.crop.w,
      h: state.crop.h
    });
    clearCropValidation();
    clearResult();
    updateOutputUi();
    scheduleSupportRefresh();
  }

  function resizeCrop(start, handle, dx, dy) {
    const W = state.meta.width;
    const H = state.meta.height;
    const ratio = lockedRatio();
    const hasW = handle.includes('w');
    const hasE = handle.includes('e');
    const hasN = handle.includes('n');
    const hasS = handle.includes('s');
    const minSize = Math.min(MIN_CROP, Math.max(8, Math.min(W, H) / 4));

    let x = start.x;
    let y = start.y;
    let w = start.w;
    let h = start.h;

    if (!ratio) {
      if (hasW) {
        const nextX = clamp(x + dx, 0, x + w - minSize);
        w += x - nextX;
        x = nextX;
      }
      if (hasE) {
        w = clamp(w + dx, minSize, W - x);
      }
      if (hasN) {
        const nextY = clamp(y + dy, 0, y + h - minSize);
        h += y - nextY;
        y = nextY;
      }
      if (hasS) {
        h = clamp(h + dy, minSize, H - y);
      }
      return { x, y, w, h };
    }

    if ((hasW || hasE) && (hasN || hasS)) {
      const anchorX = hasE ? x : x + w;
      const anchorY = hasS ? y : y + h;
      const availableW = hasE ? W - anchorX : anchorX;
      const availableH = hasS ? H - anchorY : anchorY;
      let nextW;
      if (Math.abs(dx) >= Math.abs(dy)) {
        nextW = hasE ? w + dx : w - dx;
      } else {
        nextW = (hasS ? h + dy : h - dy) * ratio;
      }
      const minW = Math.max(minSize, minSize * ratio);
      const maxW = Math.min(availableW, availableH * ratio);
      nextW = clamp(nextW, Math.min(minW, maxW), maxW);
      const nextH = nextW / ratio;
      return {
        x: hasE ? anchorX : anchorX - nextW,
        y: hasS ? anchorY : anchorY - nextH,
        w: nextW,
        h: nextH
      };
    }

    if (hasW || hasE) {
      const centerY = y + h / 2;
      const maxW = Math.min(
        hasE ? W - x : x + w,
        2 * Math.min(centerY, H - centerY) * ratio
      );
      const minW = Math.max(minSize, minSize * ratio);
      let nextW = hasE ? w + dx : w - dx;
      nextW = clamp(nextW, Math.min(minW, maxW), maxW);
      const nextH = nextW / ratio;
      return {
        x: hasE ? x : x + w - nextW,
        y: centerY - nextH / 2,
        w: nextW,
        h: nextH
      };
    }

    const centerX = x + w / 2;
    const maxH = Math.min(
      hasS ? H - y : y + h,
      2 * Math.min(centerX, W - centerX) / ratio
    );
    const minH = Math.max(minSize, minSize / ratio);
    let nextH = hasS ? h + dy : h - dy;
    nextH = clamp(nextH, Math.min(minH, maxH), maxH);
    const nextW = nextH * ratio;
    return {
      x: centerX - nextW / 2,
      y: hasS ? y : y + h - nextH,
      w: nextW,
      h: nextH
    };
  }

  function applyCrop(crop, options = {}) {
    if (!state.meta) return;
    const W = state.meta.width;
    const H = state.meta.height;
    const width = Math.max(1, Math.min(W, crop.w));
    const height = Math.max(1, Math.min(H, crop.h));
    const x = clamp(crop.x, 0, Math.max(0, W - width));
    const y = clamp(crop.y, 0, Math.max(0, H - height));

    state.crop = { x, y, w: width, h: height };
    renderCropBox();
    if (!options.fromDrag) syncCropInputs(true);
    else syncCropInputs(false);
    updateOutputUi();
    if (state.outputMode === 'custom') syncCustomFromCrop(false);
  }

  function applyCropField(field, value) {
    if (!state.meta) return;
    const W = state.meta.width;
    const H = state.meta.height;
    const ratio = lockedRatio();
    const crop = { ...state.crop };
    const tolerance = 0.51;

    if (field === 'x') {
      if (value < 0 || value + crop.w > W + tolerance) {
        showCropValidation(
          `X must be between 0 and ${Math.max(0, Math.round(W - crop.w))} px for this crop width.`
        );
        return;
      }
      crop.x = value;
    } else if (field === 'y') {
      if (value < 0 || value + crop.h > H + tolerance) {
        showCropValidation(
          `Y must be between 0 and ${Math.max(0, Math.round(H - crop.h))} px for this crop height.`
        );
        return;
      }
      crop.y = value;
    } else if (field === 'width') {
      if (value <= 0 || value > W + tolerance) {
        showCropValidation(`Width must be greater than 0 and no more than ${Math.round(W)} px.`);
        return;
      }
      let nextHeight = crop.h;
      if (ratio) nextHeight = value / ratio;
      if (crop.x + value > W + tolerance) {
        showCropValidation(
          `A ${Math.round(value)} px width would extend past the right edge. Move the crop left or use a smaller width.`
        );
        return;
      }
      if (crop.y + nextHeight > H + tolerance) {
        showCropValidation(
          `This width needs a ${Math.round(nextHeight)} px height, which would extend past the bottom edge. Move the crop up or use a smaller width.`
        );
        return;
      }
      crop.w = value;
      crop.h = nextHeight;
    } else if (field === 'height') {
      if (value <= 0 || value > H + tolerance) {
        showCropValidation(`Height must be greater than 0 and no more than ${Math.round(H)} px.`);
        return;
      }
      let nextWidth = crop.w;
      if (ratio) nextWidth = value * ratio;
      if (crop.y + value > H + tolerance) {
        showCropValidation(
          `A ${Math.round(value)} px height would extend past the bottom edge. Move the crop up or use a smaller height.`
        );
        return;
      }
      if (crop.x + nextWidth > W + tolerance) {
        showCropValidation(
          `This height needs a ${Math.round(nextWidth)} px width, which would extend past the right edge. Move the crop left or use a smaller height.`
        );
        return;
      }
      crop.h = value;
      crop.w = nextWidth;
    }

    clearCropValidation();
    applyCrop(crop);
    clearResult();
    updateOutputUi();
    scheduleSupportRefresh();
  }

  function syncCropInputs(force) {
    if (!state.meta) return;
    const crop = state.crop;
    const values = {
      x: Math.round(crop.x),
      y: Math.round(crop.y),
      width: Math.round(crop.w),
      height: Math.round(crop.h)
    };
    setInputValue(els.cropX, values.x, force);
    setInputValue(els.cropY, values.y, force);
    setInputValue(els.cropW, values.width, force);
    setInputValue(els.cropH, values.height, force);
  }

  function setInputValue(input, value, force) {
    if (!input) return;
    if (!force && document.activeElement === input) return;
    input.value = String(value);
  }

  function syncCustomInputs(force) {
    if (!state.meta) return;
    if (force || document.activeElement !== els.customWidth) {
      els.customWidth.value = String(state.custom.width || '');
    }
    if (force || document.activeElement !== els.customHeight) {
      els.customHeight.value = String(state.custom.height || '');
    }
  }

  function syncCustomFromCrop(force) {
    if (state.outputMode !== 'custom' || !state.meta) return;
    const aspect = cropAspect();
    if (!aspect) return;
    const width = state.custom.width || even(state.crop.w);
    state.custom.width = even(Math.min(MAX_OUTPUT_EDGE, width));
    state.custom.height = even(Math.min(MAX_OUTPUT_EDGE, state.custom.width / aspect));
    syncCustomInputs(force);
  }

  function setRatio(key) {
    if (!state.meta) return;
    state.ratio = key;
    const W = state.meta.width;
    const H = state.meta.height;

    if (key === 'source') {
      state.crop = { x: 0, y: 0, w: W, h: H };
    } else if (key !== 'free') {
      const ratio = RATIOS[key];
      if (!ratio) return;
      const centerX = state.crop.x + state.crop.w / 2;
      const centerY = state.crop.y + state.crop.h / 2;
      let width = Math.min(W, H * ratio);
      let height = width / ratio;
      if (height > H) {
        height = H;
        width = height * ratio;
      }
      const x = clamp(centerX - width / 2, 0, W - width);
      const y = clamp(centerY - height / 2, 0, H - height);
      state.crop = { x, y, w: width, h: height };
    }

    if (state.outputMode === 'custom') syncCustomFromCrop(true);
    clearCropValidation();
    clearResult();
    updateAll();
    scheduleSupportRefresh();
  }

  function lockedRatio() {
    if (state.ratio === 'free' || !state.meta) return null;
    if (state.ratio === 'source') return state.meta.width / state.meta.height;
    return RATIOS[state.ratio] || null;
  }

  function cropAspect() {
    if (!state.crop || state.crop.w <= 0 || state.crop.h <= 0) return null;
    return state.crop.w / state.crop.h;
  }

  function even(value) {
    return Math.max(2, Math.round(value / 2) * 2);
  }

  function outputDimensions() {
    if (!state.meta || state.crop.w <= 0 || state.crop.h <= 0) {
      return { width: 0, height: 0 };
    }
    const aspect = cropAspect();
    let width;
    let height;

    if (state.outputMode === 'original') {
      width = state.crop.w;
      height = state.crop.h;
    } else if (state.outputMode === 'custom') {
      width = state.custom.width || state.crop.w;
      height = state.custom.height || width / aspect;
    } else {
      const shortEdge = state.outputMode === '1080' ? 1080 : state.outputMode === '720' ? 720 : 480;
      if (aspect >= 1) {
        height = shortEdge;
        width = shortEdge * aspect;
      } else {
        width = shortEdge;
        height = shortEdge / aspect;
      }
    }

    return {
      width: Math.max(2, Math.min(MAX_OUTPUT_EDGE, even(width))),
      height: Math.max(2, Math.min(MAX_OUTPUT_EDGE, even(height)))
    };
  }

  function updateAll() {
    if (!state.meta) {
      updateExportState();
      return;
    }
    els.outputMode.value = state.outputMode;
    els.format.value = state.format;
    syncCropInputs(true);
    updateMetaUi();
    updateModeUi();
    updateRatioUi();
    updateOutputUi();
    updateFormatUi();
    updateWarnings();
    updateExportState();
    scheduleLayout();
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
  }

  function updateModeUi() {
    const preview = state.mode === 'preview';
    els.modeEdit.classList.toggle('is-active', !preview);
    els.modeEdit.setAttribute('aria-pressed', String(!preview));
    els.modePreview.classList.toggle('is-active', preview);
    els.modePreview.setAttribute('aria-pressed', String(preview));
    els.overlay.hidden = preview;
    els.previewBadge.hidden = !preview;
    els.player.classList.toggle('is-preview', preview);
    els.modeNote.textContent = preview
      ? 'This is the exact region that will be exported. Switch back to Edit crop to change it.'
      : 'Drag the frame to move it, drag a handle to resize it, or use the precise fields.';
    if (preview) {
      els.previewBadge.textContent = `Crop preview · ${Math.round(state.crop.w)} × ${Math.round(state.crop.h)} px`;
    }
  }

  function updateRatioUi() {
    els.ratioButtons.querySelectorAll('[data-ratio]').forEach((button) => {
      const active = button.dataset.ratio === state.ratio;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (!state.meta) return;
    if (state.ratio === 'source') {
      els.ratioNote.textContent = `Original ratio (${aspectLabel(state.meta.width, state.meta.height)}). The crop starts as the full frame and stays locked to the source shape.`;
    } else if (state.ratio === 'free') {
      els.ratioNote.textContent =
        'Freeform. Drag any edge or corner independently. The crop can never leave the video frame.';
    } else {
      const ratio = RATIOS[state.ratio];
      const sourceAspect = state.meta.width / state.meta.height;
      const fitNote =
        Math.abs(sourceAspect - ratio) > 0.005
          ? ' The source shape is different, so the largest matching area is fitted inside the frame.'
          : '';
      els.ratioNote.textContent = `Locked to ${state.ratio}. Drag the frame to reposition it.${fitNote} Output pixels are rounded to even numbers for the encoder.`;
    }
  }

  function updateOutputUi() {
    if (!state.meta) return;
    const dims = outputDimensions();
    const aspect = cropAspect();
    const custom = state.outputMode === 'custom';
    els.customSize.hidden = !custom;

    if (custom) {
      els.customWidth.max = String(MAX_OUTPUT_EDGE);
      els.customHeight.max = String(MAX_OUTPUT_EDGE);
    }

    if (els.outputSummary) {
      els.outputSummary.textContent = `Output ${dims.width} × ${dims.height} · crop ${Math.round(state.crop.w)} × ${Math.round(state.crop.h)} px`;
    }

    if (!aspect) return;
    const scaleNote = describeScale(dims, state.crop);
    const ratioNote =
      Math.abs(dims.width / dims.height - aspect) > 0.02
        ? ' The output ratio is rounded to the nearest even pixel size.'
        : '';
    els.outputNote.textContent = `${scaleNote}${ratioNote}`;

    els.previewBadge.textContent = `Crop preview · ${Math.round(state.crop.w)} × ${Math.round(state.crop.h)} px`;
    updateWarnings();
  }

  function describeScale(dims, crop) {
    const cropW = Math.max(1, Math.round(crop.w));
    const cropH = Math.max(1, Math.round(crop.h));
    if (dims.width === cropW && dims.height === cropH) {
      return `Same size as the crop (${cropW} × ${cropH}). No upscaling.`;
    }
    if (dims.width > cropW || dims.height > cropH) {
      return `Upscales the crop from ${cropW} × ${cropH} to ${dims.width} × ${dims.height}. Use Original crop size to avoid upscaling.`;
    }
    return `Downscales the crop from ${cropW} × ${cropH} to ${dims.width} × ${dims.height}. The full crop area is kept.`;
  }

  function updateFormatUi() {
    const dims = outputDimensions();
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
          'This browser cannot encode either MP4 or WebM at this output size. Choose a smaller resolution or a different crop.';
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
      els.formatNote.textContent = 'Choose a valid crop and output size first.';
    }
  }

  function updateWarnings() {
    if (!state.meta || !state.file) {
      els.warning.hidden = true;
      els.warning.textContent = '';
      return;
    }
    const dims = outputDimensions();
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
    if (dims.width * dims.height > 3840 * 2160) {
      messages.push(
        `${dims.width} × ${dims.height} output is very large. A smaller resolution will export faster and use less memory.`
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
    const dims = outputDimensions();
    const invalidSize = dims.width < 2 || dims.height < 2 || dims.width > MAX_OUTPUT_EDGE || dims.height > MAX_OUTPUT_EDGE;
    const noFormat = state.supportChecked && state.support && !FORMATS.some((format) => state.formatSupport[format]);
    const busy = state.exporting || state.loading;
    const ready = Boolean(state.meta) && !invalidSize && !noFormat && !busy && !state.supportPending;
    els.exportButton.disabled = !ready;
    els.cancel.hidden = !state.exporting;

    if (state.exporting) {
      els.exportNote.textContent = state.canceling
        ? 'Canceling the export and releasing encoder resources…'
        : 'Encoding the cropped video and audio in your browser.';
      return;
    }

    if (!state.meta) {
      els.exportNote.textContent = 'Upload a video to enable export.';
    } else if (state.loading) {
      els.exportNote.textContent = 'Reading the video…';
    } else if (invalidSize) {
      els.exportNote.textContent = 'Choose a valid output size.';
    } else if (state.supportPending) {
      els.exportNote.textContent = 'Checking encoder support…';
    } else if (noFormat) {
      els.exportNote.textContent = 'No supported output format at this size. Try a smaller resolution.';
    } else if (state.supportError) {
      els.exportNote.textContent = 'Encoder support was not confirmed, but you can still try the export.';
    } else {
      els.exportNote.textContent = `Ready to export ${dims.width} × ${dims.height} ${formatLabel(state.format)}. The file is re-encoded, not losslessly copied.`;
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
    const dims = outputDimensions();
    if (dims.width < 2 || dims.height < 2) return;

    const token = ++supportToken;
    try {
      const result = await requestWorker('support', {
        sizes: [{ key: 'out', width: dims.width, height: dims.height }],
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

  async function startExport() {
    if (!state.meta || !state.file || state.exporting) return;

    const dims = outputDimensions();
    if (dims.width < 2 || dims.height < 2) {
      showError('The output size is not valid. Choose a larger crop or a preset resolution.');
      return;
    }
    if (dims.width > MAX_OUTPUT_EDGE || dims.height > MAX_OUTPUT_EDGE) {
      showError(`The output cannot exceed ${MAX_OUTPUT_EDGE} px on either edge. Choose a smaller resolution.`);
      return;
    }
    const aspect = cropAspect();
    if (!aspect || Math.abs(dims.width / dims.height / aspect - 1) > 0.02) {
      showError('The output size does not match the crop shape. Reset the output size and try again.');
      return;
    }
    if (state.crop.x < 0 || state.crop.y < 0 ||
        state.crop.x + state.crop.w > state.meta.width + 0.5 ||
        state.crop.y + state.crop.h > state.meta.height + 0.5) {
      showError('The crop selection extends outside the video frame. Adjust it before exporting.');
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
    clearCropValidation();
    clearResult();
    stopPlayback();
    setControlsDisabled(true);

    els.progress.hidden = false;
    els.result.hidden = true;
    els.progressBar.style.width = '0%';
    els.progressTrack.setAttribute('aria-valuenow', '0');
    els.progressLabel.textContent = 'Preparing the crop…';
    updateExportState();

    try {
      const payload = await requestWorker('export', {
        file: state.file,
        options: {
          crop: {
            left: state.crop.x,
            top: state.crop.y,
            width: state.crop.w,
            height: state.crop.h
          },
          width: dims.width,
          height: dims.height,
          format: state.format,
          quality: state.quality,
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
        crop: payload.crop
      };
      renderResult();
      els.progressBar.style.width = '100%';
      els.progressTrack.setAttribute('aria-valuenow', '100');
      els.progressLabel.textContent = 'Export complete. The file was verified.';
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (state.canceling || /cancel/i.test(message)) {
        showError('Export canceled. No file was created, and encoder resources were released.');
      } else {
        showError(friendlyError(error));
      }
    } finally {
      state.exporting = false;
      state.canceling = false;
      els.progress.hidden = true;
      setControlsDisabled(false);
      updateExportState();
    }
  }

  function cancelExport() {
    if (!state.exporting || state.canceling) return;
    state.canceling = true;
    els.progressLabel.textContent = 'Canceling the export…';
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
      els.progressLabel.textContent = 'Canceling the export…';
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
    els.resultNote.textContent = 'Created locally and verified. The original video was never uploaded.';
    els.resultVideo.src = output.url;
    els.resultVideo.load();
    els.resultName.textContent = output.filename;
    els.resultFormat.textContent = `${formatLabel(output.extension)} · ${output.mimeType}`;
    els.resultDuration.textContent = formatDuration(output.duration);
    els.resultSize.textContent = formatBytes(output.size);
    els.resultResolution.textContent = `${output.width} × ${output.height}`;
    els.resultAudio.textContent = output.hasAudio ? 'Preserved' : 'No audio track';
    els.download.href = output.url;
    els.download.download = output.filename;
    els.download.setAttribute('aria-disabled', 'false');
    els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    els.download.removeAttribute('href');
    els.download.removeAttribute('download');
    els.download.setAttribute('aria-disabled', 'true');
  }

  function makeOutputName(extension) {
    const base = state.file
      ? state.file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
    return `${base || 'video'}-cropped.${extension}`;
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
    if (/cancel/i.test(message)) return 'Export canceled. No file was created.';
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
    worker = new Worker(new URL('./video-cropper-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const error = new Error('The video processing worker stopped. Try reloading the page.');
      rejectPending(error);
      terminateWorker(true);
      showError(error.message);
      state.exporting = false;
      state.canceling = false;
      els.progress.hidden = true;
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
    cancelAnimationFrame(layoutFrameRequest);
    terminateWorker(true);
    if (state.url) URL.revokeObjectURL(state.url);
    if (state.output && state.output.url) URL.revokeObjectURL(state.output.url);
  }

  function exposeDebugApi() {
    window.__videoCropper = {
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
          crop: { ...state.crop },
          ratio: state.ratio,
          mode: state.mode,
          outputMode: state.outputMode,
          custom: { ...state.custom },
          outputSize: outputDimensions(),
          format: state.format,
          quality: state.quality,
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
                url: state.output.url
              }
            : null,
          layout: {
            scale: state.view.scale,
            frameWidth: state.view.frameWidth,
            frameHeight: state.view.frameHeight
          }
        };
      },
      getOutputUrl() {
        return state.output ? state.output.url : null;
      },
      getOutputBlob() {
        return state.output ? state.output.blob : null;
      },
      setCrop(crop, ratio = 'free') {
        if (!state.meta) return false;
        const next = {
          x: Number(crop.x),
          y: Number(crop.y),
          w: Number(crop.w !== undefined ? crop.w : crop.width),
          h: Number(crop.h !== undefined ? crop.h : crop.height)
        };
        if (![next.x, next.y, next.w, next.h].every(Number.isFinite) || next.w <= 0 || next.h <= 0) {
          return false;
        }
        state.ratio = ratio === 'source' || ratio === 'free' || RATIOS[ratio] ? ratio : 'free';
        applyCrop(next, { fromDrag: true });
        syncCropInputs(true);
        updateAll();
        clearResult();
        scheduleSupportRefresh();
        return true;
      },
      setRatio(key) {
        if (!state.meta) return;
        if (key === 'source' || key === 'free' || RATIOS[key]) setRatio(key);
      },
      setMode(mode) {
        setMode(mode);
      },
      setOutputMode(mode, width, height) {
        if (!OUTPUT_MODES.includes(mode)) return;
        state.outputMode = mode;
        if (mode === 'custom') {
          if (Number.isFinite(Number(width)) && Number.isFinite(Number(height))) {
            state.custom.width = even(Number(width));
            state.custom.height = even(Number(height));
          } else {
            const dims = outputDimensions();
            state.custom.width = dims.width;
            state.custom.height = dims.height;
          }
          syncCustomInputs(true);
        }
        els.outputMode.value = state.outputMode;
        clearResult();
        updateOutputUi();
        scheduleSupportRefresh();
      },
      setFormat(format) {
        if (format !== 'mp4' && format !== 'webm') return;
        state.format = format;
        els.format.value = format;
        clearResult();
        updateFormatUi();
        updateExportState();
      },
      setQuality(quality) {
        if (quality !== 'high' && quality !== 'medium' && quality !== 'low') return;
        state.quality = quality;
        document.querySelectorAll('input[name="vc-quality"]').forEach((input) => {
          input.checked = input.value === quality;
        });
        clearResult();
        updateExportState();
      },
      startExport() {
        return startExport();
      },
      cancelExport() {
        cancelExport();
      },
      resetCrop() {
        if (!state.meta) return;
        setRatio('source');
        updateAll();
      },
      removeVideo() {
        removeVideo();
      }
    };
  }
})();
