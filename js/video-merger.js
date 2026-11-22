(() => {
  'use strict';

  const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
  const LARGE_TOTAL_BYTES = 500 * 1024 * 1024;
  const MAX_CLIPS = 20;
  const MIN_CLIPS = 2;
  const MAX_OUTPUT_EDGE = 4096;
  const ACCEPTED_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
  const RESOLUTIONS = ['source', '1080', '720', '480'];
  const FORMATS = ['mp4', 'webm'];

  const state = {
    clips: [],
    loading: false,
    exporting: false,
    canceling: false,
    supportChecked: false,
    supportPending: false,
    resolutionSupport: null,
    audioSupport: null,
    formatSupport: { mp4: true, webm: true },
    aspect: 'source',
    resolution: 'source',
    fit: 'contain',
    background: '#0f172a',
    format: 'mp4',
    quality: 'medium',
    previewMode: null,
    previewIndex: 0,
    output: null
  };

  const els = {};
  let worker = null;
  let requestId = 0;
  let supportToken = 0;
  let supportTimer = null;
  let inspectQueue = Promise.resolve();
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
    setupClipList();
    setupSettings();
    setupExport();
    setupPreview();
    updateAll();
    updateYear();
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
      addMore: '[data-add-more]',
      clearAll: '[data-clear-all]',
      clipList: '[data-clip-list]',
      empty: '[data-empty]',
      clipCount: '[data-clip-count]',
      totalDuration: '[data-total-duration]',
      totalSize: '[data-total-size]',
      previewSequence: '[data-preview-sequence]',
      globalError: '[data-global-error]',
      warning: '[data-warning]',
      loading: '[data-loading]',
      loadingText: '[data-loading-text]',
      preview: '[data-preview]',
      previewTitle: '[data-preview-title]',
      previewMeta: '[data-preview-meta]',
      previewVideo: '[data-preview-video]',
      previewStatus: '[data-preview-status]',
      previewClose: '[data-preview-close]',
      settings: '[data-settings]',
      aspect: '[data-aspect]',
      resolution: '[data-resolution]',
      outputSize: '[data-output-size]',
      background: '[data-background]',
      backgroundLabel: '[data-background-label]',
      backgroundNote: '[data-background-note]',
      swatches: '[data-swatches]',
      format: '[data-format]',
      formatNote: '[data-format-note]',
      merge: '[data-merge]',
      cancel: '[data-cancel]',
      actionTitle: '[data-action-title]',
      mergeNote: '[data-merge-note]',
      outputSummary: '[data-output-summary]',
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
      newMerge: '[data-new-merge]'
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
    els.addMore.addEventListener('click', () => els.fileInput.click());

    els.fileInput.addEventListener('change', () => {
      const files = Array.from(els.fileInput.files || []);
      els.fileInput.value = '';
      if (files.length) addFiles(files);
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
      if (files.length) addFiles(files);
    });

    els.dropzone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      els.fileInput.click();
    });
  }

  function setupClipList() {
    els.clearAll.addEventListener('click', clearAll);
    els.previewSequence.addEventListener('click', playSequence);

    els.clipList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const item = button.closest('[data-clip-id]');
      if (!item) return;

      const id = item.dataset.clipId;
      const action = button.dataset.action;
      if (action === 'preview') openClipPreview(id);
      else if (action === 'up') moveClip(id, -1);
      else if (action === 'down') moveClip(id, 1);
      else if (action === 'remove') removeClip(id);
    });

    let dragId = null;

    els.clipList.addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-clip-id]');
      if (!item || state.exporting) {
        event.preventDefault();
        return;
      }
      dragId = item.dataset.clipId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragId);
      item.classList.add('is-dragging');
    });

    els.clipList.addEventListener('dragend', () => {
      dragId = null;
      els.clipList.querySelectorAll('.is-dragging, .is-drop-target').forEach((item) => {
        item.classList.remove('is-dragging', 'is-drop-target');
      });
    });

    els.clipList.addEventListener('dragover', (event) => {
      if (!dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const item = event.target.closest('[data-clip-id]');
      if (!item || item.dataset.clipId === dragId) return;
      els.clipList.querySelectorAll('.is-drop-target').forEach((node) => {
        if (node !== item) node.classList.remove('is-drop-target');
      });
      item.classList.add('is-drop-target');
    });

    els.clipList.addEventListener('dragleave', (event) => {
      const item = event.target.closest('[data-clip-id]');
      if (item && !item.contains(event.relatedTarget)) item.classList.remove('is-drop-target');
    });

    els.clipList.addEventListener('drop', (event) => {
      if (!dragId) return;
      event.preventDefault();
      const sourceId = dragId;
      dragId = null;
      const target = event.target.closest('[data-clip-id]') || els.clipList.lastElementChild;
      if (!target) return;

      const from = state.clips.findIndex((clip) => clip.id === sourceId);
      let to = state.clips.findIndex((clip) => clip.id === target.dataset.clipId);
      if (from < 0 || to < 0 || from === to) return;

      const rect = target.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      if (after) to += 1;
      if (from < to) to -= 1;
      if (from === to) return;

      const [clip] = state.clips.splice(from, 1);
      state.clips.splice(to, 0, clip);
      stopSequencePreview();
      renderClips();
      updateSummary();
      scheduleSupportRefresh();
      updateMergeState();
    });

    els.clipList.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      const item = event.target.closest('[data-clip-id]');
      if (!item) return;
      event.preventDefault();
      moveClip(item.dataset.clipId, event.key === 'ArrowUp' ? -1 : 1);
    });
  }

  function setupSettings() {
    els.aspect.addEventListener('change', () => {
      state.aspect = els.aspect.value;
      scheduleSupportRefresh();
      updateAll();
    });

    els.resolution.addEventListener('change', () => {
      state.resolution = els.resolution.value;
      updateAll();
    });

    document.querySelectorAll('input[name="vm-fit"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.fit = input.value === 'cover' ? 'cover' : 'contain';
        updateAll();
      });
    });

    document.querySelectorAll('input[name="vm-quality"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.quality = input.value === 'high' || input.value === 'low' ? input.value : 'medium';
        updateAll();
      });
    });

    els.background.addEventListener('input', () => {
      state.background = els.background.value;
      updateAll();
    });

    els.swatches.addEventListener('click', (event) => {
      const button = event.target.closest('[data-color]');
      if (!button || button.disabled) return;
      state.background = button.dataset.color;
      els.background.value = state.background;
      updateAll();
    });

    els.format.addEventListener('change', () => {
      state.format = els.format.value === 'webm' ? 'webm' : 'mp4';
      updateFormatOptions();
      updateResolutionOptions();
      updateAll();
    });
  }

  function setupExport() {
    els.merge.addEventListener('click', startMerge);
    els.cancel.addEventListener('click', cancelMerge);
    els.newMerge.addEventListener('click', startNewMerge);

    els.resultVideo.addEventListener('error', () => {
      if (!state.output) return;
      els.resultNote.textContent =
        'The merged file was created, but this browser cannot preview it here. Download it to play it in a video app.';
    });
  }

  function setupPreview() {
    els.previewClose.addEventListener('click', stopPreview);

    els.previewVideo.addEventListener('ended', () => {
      if (state.previewMode === 'sequence' && state.previewIndex < state.clips.length - 1) {
        state.previewIndex += 1;
        loadPreviewClip(true);
        return;
      }
      els.previewStatus.textContent =
        state.previewMode === 'sequence'
          ? 'Sequence finished. This preview plays the clips in order; padding and output settings are applied after merging.'
          : 'Clip preview finished.';
    });

    els.previewVideo.addEventListener('error', () => {
      if (els.preview.hidden) return;
      els.previewStatus.textContent =
        'This browser cannot preview this clip directly. The merger may still decode it during export.';
    });
  }

  function updateYear() {
    const year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function addFiles(files) {
    if (state.exporting) {
      showError('Wait for the current merge to finish before adding more clips.');
      return inspectQueue;
    }
    inspectQueue = inspectQueue
      .then(() => processFiles(files))
      .catch((error) => {
        state.loading = false;
        setLoading(false);
        showError(friendlyError(error));
        updateAll();
      });
    return inspectQueue;
  }

  async function processFiles(files) {
    if (!files.length) return;
    const errors = [];
    let added = 0;
    state.loading = true;
    setLoading(true, 'Reading videos…');
    updateMergeState();

    for (const file of files) {
      if (state.clips.length >= MAX_CLIPS) {
        errors.push(`You can add up to ${MAX_CLIPS} clips in one merge.`);
        break;
      }

      const localError = validateFile(file);
      if (localError) {
        errors.push(`${file.name}: ${localError}`);
        continue;
      }

      setLoading(true, `Reading ${file.name}…`);
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

        const clip = {
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          url: URL.createObjectURL(file),
          thumbnail: payload.thumbnail ? bitmapToDataUrl(payload.thumbnail) : '',
          duration: payload.duration,
          width: payload.width,
          height: payload.height,
          fps: payload.fps,
          fpsVariable: payload.fpsVariable,
          container: payload.container,
          videoCodec: payload.videoCodec,
          hasAudio: payload.hasAudio,
          audioCodec: payload.audioCodec,
          audioChannels: payload.audioChannels,
          audioSampleRate: payload.audioSampleRate,
          audioDecodable: payload.audioDecodable,
          size: file.size
        };

        state.clips.push(clip);
        added += 1;
        renderClips();
        updateSummary();
      } catch (error) {
        errors.push(`${file.name}: ${friendlyError(error)}`);
      }
    }

    state.loading = false;
    setLoading(false);
    updateAll();

    if (added) {
      clearError();
      scheduleSupportRefresh();
    }
    if (errors.length) showError(errors.join(' '));
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

  function renderClips() {
    els.clipList.innerHTML = state.clips.map(clipTemplate).join('');
    els.empty.hidden = state.clips.length > 0;
    els.clipList.hidden = state.clips.length === 0;
    els.clearAll.disabled = state.exporting || state.clips.length === 0;
    els.addMore.disabled = state.exporting || state.clips.length >= MAX_CLIPS;
    els.previewSequence.disabled = state.exporting || state.clips.length === 0;
  }

  function clipTemplate(clip, index) {
    const disabled = state.exporting ? ' disabled' : '';
    const upDisabled = state.exporting || index === 0 ? ' disabled' : '';
    const downDisabled = state.exporting || index === state.clips.length - 1 ? ' disabled' : '';
    const thumb = clip.thumbnail
      ? `<img src="${clip.thumbnail}" alt="">`
      : '<span class="vm-thumb-fallback" aria-hidden="true">Video</span>';
    const audioWarning =
      clip.hasAudio && !clip.audioDecodable
        ? '<p class="vm-clip-warning">This browser cannot decode this clip’s audio. Remove it to continue.</p>'
        : '';

    return `
      <li class="vm-clip" data-clip-id="${clip.id}" draggable="${state.exporting ? 'false' : 'true'}" tabindex="0" aria-label="Clip ${index + 1}: ${escapeHtml(clip.name)}">
        <span class="vm-drag" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
        <div class="vm-thumb">${thumb}<span class="vm-index">${index + 1}</span></div>
        <div class="vm-clip-main">
          <div class="vm-clip-title">
            <strong>${escapeHtml(clip.name)}</strong>
            <span class="vm-clip-order">Clip ${index + 1}</span>
          </div>
          <div class="vm-clip-meta">
            <span>${formatDuration(clip.duration)}</span>
            <span>${formatBytes(clip.size)}</span>
            <span>${clip.width} × ${clip.height}</span>
            <span>${formatFps(clip.fps, clip.fpsVariable)}</span>
            <span>${formatAudio(clip)}</span>
          </div>
          ${audioWarning}
        </div>
        <div class="vm-clip-actions">
          <button type="button" data-action="preview"${disabled}>Preview</button>
          <button type="button" data-action="up" aria-label="Move ${escapeHtml(clip.name)} up"${upDisabled}>Up</button>
          <button type="button" data-action="down" aria-label="Move ${escapeHtml(clip.name)} down"${downDisabled}>Down</button>
          <button type="button" data-action="remove" aria-label="Remove ${escapeHtml(clip.name)}"${disabled}>Remove</button>
        </div>
      </li>
    `;
  }

  function moveClip(id, delta) {
    if (state.exporting) return;
    const from = state.clips.findIndex((clip) => clip.id === id);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= state.clips.length) return;

    const [clip] = state.clips.splice(from, 1);
    state.clips.splice(to, 0, clip);
    stopSequencePreview();
    renderClips();
    updateSummary();
    scheduleSupportRefresh();
    updateMergeState();

    const action = delta < 0 ? 'up' : 'down';
    const item = els.clipList.querySelector(`[data-clip-id="${id}"]`);
    const button = item && item.querySelector(`[data-action="${action}"]`);
    if (button && !button.disabled) button.focus();
    else if (item) item.focus();
  }

  function removeClip(id) {
    if (state.exporting) return;
    const index = state.clips.findIndex((clip) => clip.id === id);
    if (index < 0) return;
    const [clip] = state.clips.splice(index, 1);
    URL.revokeObjectURL(clip.url);

    if (state.previewMode === 'clip') {
      if (state.previewIndex === index) stopPreview();
      else if (state.previewIndex > index) state.previewIndex -= 1;
    }
    if (state.previewMode === 'sequence') stopPreview();

    if (state.clips.length) scheduleSupportRefresh();
    else resetSupport();

    renderClips();
    updateAll();
  }

  function clearAll() {
    if (state.exporting) return;
    stopPreview();
    for (const clip of state.clips) URL.revokeObjectURL(clip.url);
    state.clips = [];
    clearResult();
    resetSupport();
    clearError();
    renderClips();
    updateAll();
  }

  function resetSupport() {
    clearTimeout(supportTimer);
    supportToken += 1;
    state.supportChecked = false;
    state.supportPending = false;
    state.resolutionSupport = null;
    state.audioSupport = null;
    state.formatSupport = { mp4: true, webm: true };
  }

  function scheduleSupportRefresh(delay = 160) {
    clearTimeout(supportTimer);
    if (!state.clips.length) {
      resetSupport();
      updateAll();
      return;
    }
    if (!state.supportPending) {
      state.supportPending = true;
      updateMergeState();
    }
    supportTimer = setTimeout(() => {
      refreshSupport();
    }, delay);
  }

  async function refreshSupport() {
    if (!state.clips.length || state.exporting) return;
    const first = state.clips[0];
    const sizes = [];
    for (const key of RESOLUTIONS) {
      const size = computeOutputSize(key, state.aspect, first);
      if (size) sizes.push({ key, width: size.width, height: size.height });
    }
    if (!sizes.length) return;

    const token = ++supportToken;
    state.supportPending = true;
    updateAll();

    try {
      const result = await requestWorker('support', { sizes });
      if (token !== supportToken) return;

      state.resolutionSupport = {};
      state.audioSupport = {};
      for (const format of FORMATS) {
        state.resolutionSupport[format] = {};
        for (const key of RESOLUTIONS) {
          const size = computeOutputSize(key, state.aspect, first);
          const tooLarge = size && (size.width > MAX_OUTPUT_EDGE || size.height > MAX_OUTPUT_EDGE);
          state.resolutionSupport[format][key] = Boolean(
            result && result[format] && result[format][key] && !tooLarge
          );
        }
        state.audioSupport[format] = Boolean(result && result[format] && result[format].audio);
      }
      state.supportChecked = true;
      state.supportPending = false;
      updateAll();
    } catch (error) {
      if (token !== supportToken) return;
      state.supportChecked = true;
      state.supportPending = false;
      state.resolutionSupport = null;
      state.audioSupport = null;
      state.formatSupport = { mp4: false, webm: false };
      updateAll();
      showError('Encoder support could not be checked: ' + friendlyError(error));
    }
  }

  function updateAll() {
    updateFormatOptions();
    updateResolutionOptions();
    updateSummary();
    updateBackgroundState();
    updateOutputSizeLabel();
    updateMergeState();
  }

  function updateFormatOptions() {
    const ready = state.supportChecked && state.resolutionSupport;
    const audioNeeded = state.clips.some((clip) => clip.hasAudio);

    if (ready) {
      for (const format of FORMATS) {
        const videoOk = Object.values(state.resolutionSupport[format] || {}).some(Boolean);
        const audioOk = !audioNeeded || Boolean(state.audioSupport && state.audioSupport[format]);
        state.formatSupport[format] = videoOk && audioOk;
      }
    }

    for (const option of els.format.options) {
      const format = option.value;
      option.disabled = ready ? !state.formatSupport[format] : false;
    }

    if (ready && !state.formatSupport[state.format]) {
      const next = Array.from(els.format.options).find((option) => !option.disabled);
      if (next) state.format = next.value;
    }
    els.format.value = state.format;
  }

  function updateResolutionOptions() {
    const support = state.resolutionSupport && state.resolutionSupport[state.format];

    for (const option of els.resolution.options) {
      const key = option.value;
      const size = computeOutputSize(key, state.aspect, state.clips[0]);
      const tooLarge = size && (size.width > MAX_OUTPUT_EDGE || size.height > MAX_OUTPUT_EDGE);
      const available = support ? Boolean(support[key]) : !tooLarge;
      option.disabled = !available;
    }

    if (support && !support[state.resolution]) {
      const next = RESOLUTIONS.find((key) => support[key]);
      if (next) state.resolution = next;
    }
    els.resolution.value = state.resolution;
  }

  function updateSummary() {
    const count = state.clips.length;
    const totalBytes = state.clips.reduce((sum, clip) => sum + clip.size, 0);
    els.clipCount.textContent = String(count);
    els.totalDuration.textContent = formatDuration(totalDuration());
    els.totalSize.textContent = formatBytes(totalBytes);
    els.clearAll.disabled = state.exporting || count === 0;
    els.addMore.disabled = state.exporting || count >= MAX_CLIPS;
    els.previewSequence.disabled = state.exporting || count === 0;
    els.empty.hidden = count > 0;
    els.clipList.hidden = count === 0;
    els.dropTitle.textContent = count ? 'Add more videos' : 'Drag and drop your videos here';
    els.dropSub.textContent = count
      ? `Drop more clips here or browse. ${count} of ${MAX_CLIPS} clips added.`
      : 'Select two or more MP4, WebM, MOV, M4V or MKV files. Up to 2 GB each.';

    if (totalBytes > LARGE_TOTAL_BYTES) {
      els.warning.hidden = false;
      els.warning.textContent = `Large merge: ${formatBytes(totalBytes)} of input. Processing uses a lot of memory. If it fails, remove clips or choose a smaller resolution.`;
    } else if (count >= 8) {
      els.warning.hidden = false;
      els.warning.textContent =
        'Many clips are queued. Merging more than eight clips can be slow on phones; keep this tab open and avoid other heavy tabs.';
    } else {
      els.warning.hidden = true;
      els.warning.textContent = '';
    }
  }

  function updateBackgroundState() {
    const cover = state.fit === 'cover';
    const disabled = state.exporting || cover;
    els.background.disabled = disabled;
    els.backgroundLabel.textContent = state.background.toUpperCase();
    els.backgroundNote.textContent = cover
      ? 'The padding color is not used when filling by cropping.'
      : 'Bars around fitted video use this color.';
    els.swatches.querySelectorAll('[data-color]').forEach((button) => {
      button.disabled = disabled;
      button.classList.toggle('is-active', button.dataset.color.toLowerCase() === state.background.toLowerCase());
    });
  }

  function updateOutputSizeLabel() {
    const size = computeOutputSize();
    els.outputSize.textContent = size ? `${size.width} × ${size.height}` : '—';
    if (!state.clips.length) {
      els.outputSummary.textContent = 'Add clips to see the output estimate.';
      return;
    }
    els.outputSummary.textContent = `${state.clips.length} clips · ${formatDuration(totalDuration())} · ${size ? `${size.width} × ${size.height}` : '—'} · ${formatLabel(state.format)} · ${qualityLabel(state.quality)}`;
  }

  function updateMergeState() {
    const blocking = getBlockingMessage();
    const disabled = state.exporting || Boolean(blocking);

    els.merge.disabled = disabled;
    els.merge.textContent = state.exporting ? 'Merging videos…' : 'Merge videos';
    els.cancel.hidden = !state.exporting;
    els.cancel.disabled = state.canceling;
    els.settings.disabled = state.exporting;

    if (state.exporting) {
      els.actionTitle.textContent = state.canceling ? 'Canceling the merge' : 'Merging your clips';
      els.mergeNote.textContent = state.canceling
        ? 'Stopping the encoder and releasing the partial output…'
        : 'The browser is decoding, normalizing and re-encoding the clips. Keep this tab open.';
    } else if (blocking) {
      els.actionTitle.textContent = state.clips.length ? 'Not ready yet' : 'Build your merge';
      els.mergeNote.textContent = blocking;
    } else {
      els.actionTitle.textContent = 'Ready to merge';
      els.mergeNote.textContent = `The output will follow the clip order above and use ${formatLabel(state.format)} at ${els.outputSize.textContent}.`;
    }
  }

  function getBlockingMessage() {
    if (state.exporting) return '';
    if (state.loading) return 'Wait for the clips to finish loading.';
    if (!state.clips.length) return `Add at least ${MIN_CLIPS} video clips to merge.`;
    if (state.clips.length < MIN_CLIPS) return 'Add one more clip. A merge needs at least two videos.';
    if (!state.supportChecked) return 'Checking browser support…';
    if (state.supportPending) return 'Checking encoder support for these settings…';

    const undecodableAudio = state.clips.find((clip) => clip.hasAudio && !clip.audioDecodable);
    if (undecodableAudio) {
      return `The audio in "${undecodableAudio.name}" cannot be decoded by this browser. Remove that clip or use another browser so audio is not silently lost.`;
    }

    const anyAudio = state.clips.some((clip) => clip.hasAudio);
    if (anyAudio && state.audioSupport && !state.audioSupport[state.format]) {
      return `This browser cannot encode ${formatLabel(state.format)} audio. Choose another output format.`;
    }

    if (!state.formatSupport[state.format]) {
      return `This browser cannot encode ${formatLabel(state.format)} for these settings. Choose another format or resolution.`;
    }

    const size = computeOutputSize();
    if (!size) return 'Choose a valid output resolution.';
    if (size.width > MAX_OUTPUT_EDGE || size.height > MAX_OUTPUT_EDGE) {
      return `The output would be larger than ${MAX_OUTPUT_EDGE} px on one edge. Choose a smaller resolution.`;
    }

    const resolutionOk = state.resolutionSupport && state.resolutionSupport[state.format]
      ? state.resolutionSupport[state.format][state.resolution]
      : true;
    if (!resolutionOk) {
      return `This browser cannot encode ${size.width} × ${size.height} ${formatLabel(state.format)}. Choose another resolution.`;
    }

    return '';
  }

  async function startMerge() {
    if (state.exporting) return;
    const blocking = getBlockingMessage();
    if (blocking) {
      showError(blocking);
      return;
    }

    const size = computeOutputSize();
    if (!size) {
      showError('Choose a valid output resolution.');
      return;
    }

    clearError();
    clearResult();
    state.exporting = true;
    state.canceling = false;
    els.progress.hidden = false;
    updateProgress({ progress: 0, phase: 'preparing' });
    renderClips();
    updateAll();
    els.progress.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const payload = await requestWorker('merge', {
        clips: state.clips.map((clip) => ({
          file: clip.file,
          name: clip.name,
          fps: clip.fps
        })),
        options: {
          format: state.format,
          quality: state.quality,
          width: size.width,
          height: size.height,
          fit: state.fit,
          background: state.background
        }
      });

      if (!payload || !payload.buffer) {
        throw new Error('The encoder did not return a merged file.');
      }

      const blob = new Blob([payload.buffer], { type: payload.mimeType });
      if (blob.size !== payload.size) {
        throw new Error('The merged file size did not match the encoder result.');
      }

      const url = URL.createObjectURL(blob);
      const filename = makeOutputName(payload.extension);
      state.output = {
        url,
        blob,
        filename,
        mimeType: payload.mimeType,
        extension: payload.extension,
        duration: payload.duration,
        width: payload.width,
        height: payload.height,
        hasAudio: payload.hasAudio,
        size: blob.size,
        clipCount: payload.clipCount,
        plannedDuration: payload.plannedDuration
      };
      showResult(state.output);
    } catch (error) {
      if (/cancel/i.test(error && error.message ? error.message : '')) {
        showError('Merge canceled. No file was created.');
      } else {
        showError(friendlyError(error));
      }
    } finally {
      state.exporting = false;
      state.canceling = false;
      els.progress.hidden = true;
      renderClips();
      updateAll();
      terminateWorker(true);
    }
  }

  function cancelMerge() {
    if (!state.exporting || state.canceling) return;
    state.canceling = true;
    updateMergeState();
    els.progressLabel.textContent = 'Canceling…';
    if (worker) worker.postMessage({ type: 'cancel' });
  }

  function updateProgress(message) {
    const progress = Number.isFinite(message.progress) ? message.progress : 0;
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    els.progressBar.style.width = `${percent}%`;
    els.progressTrack.setAttribute('aria-valuenow', String(percent));

    if (state.canceling) {
      els.progressLabel.textContent = 'Canceling…';
      return;
    }

    if (message.phase === 'video') {
      els.progressLabel.textContent = `Merging clip ${message.clipIndex} of ${message.clipCount}…`;
    } else if (message.phase === 'audio') {
      els.progressLabel.textContent = `Syncing audio for clip ${message.clipIndex} of ${message.clipCount}…`;
    } else if (message.phase === 'finalizing') {
      els.progressLabel.textContent = 'Finalizing and checking the merged file…';
    } else if (message.phase === 'clip') {
      els.progressLabel.textContent = `Finished clip ${message.clipIndex} of ${message.clipCount}.`;
    } else {
      els.progressLabel.textContent = 'Preparing the merge…';
    }
  }

  function showResult(output) {
    els.progress.hidden = true;
    els.result.hidden = false;
    els.resultVideo.src = output.url;
    els.resultVideo.load();
    els.download.href = output.url;
    els.download.download = output.filename;
    els.download.setAttribute('aria-disabled', 'false');
    els.resultName.textContent = output.filename;
    els.resultFormat.textContent = `${formatLabel(output.extension)} · ${output.mimeType}`;
    els.resultDuration.textContent = formatDuration(output.duration);
    els.resultSize.textContent = formatBytes(output.size);
    els.resultResolution.textContent = `${output.width} × ${output.height}`;
    els.resultAudio.textContent = output.hasAudio ? 'Audio included' : 'No audio track';
    els.resultNote.textContent =
      'Created locally from your clips. The merged file follows the order shown above.';
    requestAnimationFrame(() => {
      els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function clearResult() {
    if (state.output && state.output.url) URL.revokeObjectURL(state.output.url);
    state.output = null;
    els.result.hidden = true;
    els.resultVideo.pause();
    els.resultVideo.removeAttribute('src');
    els.resultVideo.load();
    els.download.removeAttribute('href');
    els.download.removeAttribute('download');
    els.download.setAttribute('aria-disabled', 'true');
    els.resultNote.textContent = 'Created locally. The original files were not uploaded.';
  }

  function startNewMerge() {
    if (state.exporting) return;
    clearResult();
    clearAll();
    clearError();
    els.app.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openClipPreview(id) {
    const index = state.clips.findIndex((clip) => clip.id === id);
    if (index < 0) return;
    state.previewMode = 'clip';
    state.previewIndex = index;
    loadPreviewClip(true);
    els.preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function playSequence() {
    if (!state.clips.length || state.exporting) return;
    state.previewMode = 'sequence';
    state.previewIndex = 0;
    loadPreviewClip(true);
    els.preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function loadPreviewClip(autoplay) {
    const clip = state.clips[state.previewIndex];
    if (!clip) {
      stopPreview();
      return;
    }

    els.preview.hidden = false;
    els.previewVideo.src = clip.url;
    els.previewVideo.load();
    els.previewTitle.textContent =
      state.previewMode === 'sequence'
        ? `Sequence preview · Clip ${state.previewIndex + 1} of ${state.clips.length}`
        : clip.name;
    els.previewMeta.textContent = `${clip.name} · ${formatDuration(clip.duration)} · ${clip.width} × ${clip.height}`;
    els.previewStatus.textContent =
      state.previewMode === 'sequence'
        ? 'Playing the clips in order. Padding and output settings are applied only after merging.'
        : 'Previewing this clip.';

    if (autoplay) {
      const play = els.previewVideo.play();
      if (play && typeof play.catch === 'function') play.catch(() => {
        els.previewStatus.textContent = 'Press play to preview this clip.';
      });
    }
  }

  function stopPreview() {
    state.previewMode = null;
    state.previewIndex = 0;
    els.preview.hidden = true;
    els.previewVideo.pause();
    els.previewVideo.removeAttribute('src');
    els.previewVideo.load();
    els.previewTitle.textContent = 'Preview';
    els.previewMeta.textContent = '';
    els.previewStatus.textContent = '';
  }

  function stopSequencePreview() {
    if (state.previewMode === 'sequence') stopPreview();
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

  function totalDuration() {
    return state.clips.reduce((sum, clip) => sum + (Number(clip.duration) || 0), 0);
  }

  function computeOutputSize(resolution = state.resolution, aspectValue = state.aspect, first = state.clips[0]) {
    if (!first || !first.width || !first.height) return null;

    let aspect;
    if (aspectValue === 'source') {
      aspect = first.width / first.height;
    } else {
      const parts = aspectValue.split(':').map(Number);
      aspect = parts[0] / parts[1];
    }
    if (!Number.isFinite(aspect) || aspect <= 0) return null;

    let width;
    let height;

    if (resolution === 'source') {
      if (aspectValue === 'source') {
        width = first.width;
        height = first.height;
      } else {
        const longEdge = Math.max(first.width, first.height);
        if (aspect >= 1) {
          width = longEdge;
          height = longEdge / aspect;
        } else {
          height = longEdge;
          width = longEdge * aspect;
        }
      }
    } else {
      const shortEdge = resolution === '1080' ? 1080 : resolution === '720' ? 720 : 480;
      if (aspect >= 1) {
        height = shortEdge;
        width = shortEdge * aspect;
      } else {
        width = shortEdge;
        height = shortEdge / aspect;
      }
    }

    return {
      width: Math.max(2, Math.round(width / 2) * 2),
      height: Math.max(2, Math.round(height / 2) * 2)
    };
  }

  function makeOutputName(extension) {
    const first = state.clips[0];
    const base = first
      ? first.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
    return `${base || 'merged-video'}-merged.${extension}`;
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

  function formatFps(fps, variable) {
    if (!Number.isFinite(fps) || fps <= 0) return 'Frame rate not reported';
    const rounded = Math.round(fps * 100) / 100;
    return variable ? `~${rounded} fps (variable)` : `${rounded} fps`;
  }

  function formatAudio(clip) {
    if (!clip.hasAudio) return 'No audio';
    if (!clip.audioDecodable) return 'Audio not decodable';
    const codec = (clip.audioCodec || 'Audio').toUpperCase();
    const channels = clip.audioChannels ? `${clip.audioChannels} ch` : '';
    const rate = clip.audioSampleRate ? `${Math.round(clip.audioSampleRate / 1000)} kHz` : '';
    return [codec, channels, rate].filter(Boolean).join(' · ');
  }

  function formatLabel(format) {
    return format === 'webm' ? 'WebM' : 'MP4';
  }

  function qualityLabel(quality) {
    return quality === 'high' ? 'High quality' : quality === 'low' ? 'Smaller file' : 'Balanced';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      if (character === '&') return '&amp;';
      if (character === '<') return '&lt;';
      if (character === '>') return '&gt;';
      if (character === '"') return '&quot;';
      return '&#39;';
    });
  }

  function friendlyError(error) {
    const message = error && error.message ? error.message : String(error);
    if (/cancel/i.test(message)) return 'Merge canceled. No file was created.';
    if (/could not be read as a supported video|cannot decode|no video track|no readable video duration/i.test(message)) {
      return message;
    }
    if (/memory|allocation|too large|array buffer/i.test(message)) {
      return 'This merge ran out of memory. Try fewer or shorter clips, a smaller resolution, or close other memory-heavy tabs.';
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
    worker = new Worker(new URL('./video-merger-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const error = new Error('The video processing worker stopped. Try reloading the page.');
      rejectPending(error);
      terminateWorker(true);
      showError(error.message);
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
      if (state.exporting) updateProgress(message);
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
    for (const clip of state.clips) URL.revokeObjectURL(clip.url);
    if (state.output && state.output.url) URL.revokeObjectURL(state.output.url);
  }

  function exposeDebugApi() {
    window.__videoMerger = {
      getState() {
        const size = computeOutputSize();
        return {
          clips: state.clips.map((clip) => ({
            id: clip.id,
            name: clip.name,
            duration: clip.duration,
            width: clip.width,
            height: clip.height,
            fps: clip.fps,
            fpsVariable: clip.fpsVariable,
            hasAudio: clip.hasAudio,
            audioDecodable: clip.audioDecodable,
            size: clip.size
          })),
          totalDuration: totalDuration(),
          format: state.format,
          resolution: state.resolution,
          aspect: state.aspect,
          fit: state.fit,
          background: state.background,
          quality: state.quality,
          outputSize: size,
          supportChecked: state.supportChecked,
          supportPending: state.supportPending,
          resolutionSupport: state.resolutionSupport,
          audioSupport: state.audioSupport,
          formatSupport: { ...state.formatSupport },
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
            : null
        };
      },
      getOutputUrl() {
        return state.output ? state.output.url : null;
      },
      getOutputBlob() {
        return state.output ? state.output.blob : null;
      },
      setSettings(settings = {}) {
        if (settings.aspect) state.aspect = settings.aspect;
        if (settings.resolution) state.resolution = settings.resolution;
        if (settings.fit) state.fit = settings.fit === 'cover' ? 'cover' : 'contain';
        if (settings.background) state.background = settings.background;
        if (settings.format) state.format = settings.format === 'webm' ? 'webm' : 'mp4';
        if (settings.quality) {
          state.quality = settings.quality === 'high' || settings.quality === 'low' ? settings.quality : 'medium';
        }
        els.aspect.value = state.aspect;
        els.resolution.value = state.resolution;
        els.background.value = state.background;
        els.format.value = state.format;
        document.querySelectorAll('input[name="vm-fit"]').forEach((input) => {
          input.checked = input.value === state.fit;
        });
        document.querySelectorAll('input[name="vm-quality"]').forEach((input) => {
          input.checked = input.value === state.quality;
        });
        if (settings.aspect) scheduleSupportRefresh();
        updateAll();
      },
      moveClip(id, delta) {
        moveClip(id, delta);
      },
      clearAll() {
        clearAll();
      },
      startMerge() {
        return startMerge();
      }
    };
  }
})();
