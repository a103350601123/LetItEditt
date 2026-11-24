/* LetitEdit Professional Video Editor — application controller.
 *
 * Wires the project store, local media library, timeline, preview compositor,
 * properties panel, project persistence and the real WebCodecs exporter.
 */

import {
  ASPECTS,
  RESOLUTIONS,
  aspectRatio,
  clamp,
  debounce,
  deepClone,
  dimsForResolution,
  downloadBlob,
  even,
  escapeHtml,
  formatBytes,
  formatClock,
  formatDuration,
  parseSubtitleFile,
  sanitizeFilename,
  toSrt,
  toVtt,
  uid
} from './utils.js';
import {
  ProjectStore,
  addClipToTrack,
  clipEnd,
  createClip,
  createProject,
  createTrack,
  defaultSubtitleStyle,
  findClip,
  findTrack,
  moveClipToTrack,
  previousClip,
  projectAspectValue,
  projectDimensions,
  projectDuration,
  resolveStart,
  restoreProject,
  serializeProject,
  sortTrack,
  visualTracks
} from './model.js';
import { MediaLibrary, validateFile } from './media.js';
import { TimelineView, applyTrim } from './timeline.js';
import { TABS, renderLibraryPanel, renderTabStrip } from './panels.js';
import { renderProperties } from './properties.js';
import {
  COLOR_PRESETS,
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  PREVIEW_QUALITIES,
  SHAPE_TYPES,
  STICKERS,
  TEXT_PRESETS
} from './presets.js';
import { FILTERS, TRANSITIONS, transitionLabel } from './effects.js';
import {
  clipBounds,
  clipSourceTime,
  renderComposition,
  resolveTransform
} from './renderer.js';

const AUTOSAVE_KEY = 'letitedit.video-editor.autosave.v1';
const MIN_DURATION = 0.2;

const state = {
  activeTab: 'media',
  mobilePanel: 'none',
  selection: new Set(),
  selectedSubtitleId: null,
  playhead: 0,
  playing: false,
  previewRate: 1,
  previewQuality: 'standard',
  keyEase: 'linear',
  transitionDuration: 0.5,
  importErrors: [],
  pendingRelink: [],
  restoreData: null,
  lastExport: null,
  exporting: false,
  replaceTargetId: null,
  autosaveStatus: 'Autosave ready',
  fieldRenderPending: false,
  exportSettings: {
    format: 'mp4',
    resolution: '1080',
    aspect: 'project',
    quality: 'balanced',
    customWidth: 1920,
    customHeight: 1080,
    customAspectW: 16,
    customAspectH: 9
  }
};

const els = {};
let store = null;
let media = null;
let timeline = null;
let previewCtx = null;
let previewToken = 0;
let previewScheduled = false;
let previewBusy = false;
let previewErrorShown = false;
let rafId = 0;
let lastTick = 0;
let activeExport = null;
let vignetteObserver = null;
let appSupport = { renderer: true, encoder: true };

const sourceAdapter = {
  getFrame(id, time, maxDimension) {
    return media.frameAt(id, time, maxDimension);
  },
  getImage(id) {
    return media.getImage(id);
  }
};

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTypingTarget(target) {
  return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isEditingWithin(element) {
  const active = document.activeElement;
  return Boolean(element && active && element.contains(active) && isTypingTarget(active));
}

function toast(message, type = 'info', timeout = 4600) {
  if (!els.toasts) return;
  const item = document.createElement('div');
  item.className = `ve-toast ve-toast-${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 've-toast-close';
  close.setAttribute('aria-label', 'Dismiss message');
  close.textContent = '✕';
  close.addEventListener('click', () => item.remove());
  item.appendChild(close);
  els.toasts.appendChild(item);
  while (els.toasts.children.length > 4) els.toasts.firstElementChild.remove();
  if (timeout > 0) setTimeout(() => item.remove(), timeout);
}

function project() {
  return store.project;
}

function selectedLocations() {
  const found = [];
  for (const track of project().tracks) {
    for (const clip of track.clips) {
      if (state.selection.has(clip.id)) found.push({ track, clip });
    }
  }
  return found;
}

function primaryLocation() {
  return selectedLocations()[0] || null;
}

function primaryVisualLocation() {
  return selectedLocations().find(({ clip }) => clip.kind !== 'audio') || null;
}

function updateSelectionClasses() {
  timeline?.updateSelection();
}

function selectClip(clipId, options = {}) {
  const located = findClip(project(), clipId);
  if (!located) return;
  if (options.additive) {
    if (state.selection.has(clipId)) state.selection.delete(clipId);
    else state.selection.add(clipId);
  } else {
    state.selection.clear();
    state.selection.add(clipId);
  }
  state.selectedSubtitleId = null;
  updateSelectionClasses();
  renderPropertiesPanel();
  renderLibraryIfRelevant(true);
  updateOverlay();
  updateSelectionCount();
}

function selectNone() {
  state.selection.clear();
  state.selectedSubtitleId = null;
  updateSelectionClasses();
  renderPropertiesPanel();
  renderLibraryIfRelevant(true);
  updateOverlay();
  updateSelectionCount();
}

function updateSelectionCount() {
  if (!els.selectionCount) return;
  const count = state.selection.size;
  els.selectionCount.textContent = count === 0 ? 'Nothing selected' : count === 1 ? '1 clip selected' : `${count} clips selected`;
}

function pruneSelection() {
  const ids = [...state.selection];
  for (const id of ids) {
    if (!findClip(project(), id)) state.selection.delete(id);
  }
  if (state.selectedSubtitleId) {
    const items = project().subtitles?.items || [];
    if (!items.some((item) => item.id === state.selectedSubtitleId)) state.selectedSubtitleId = null;
  }
  updateSelectionCount();
}

function syncProjectName() {
  if (els.projectName && document.activeElement !== els.projectName) {
    els.projectName.value = project().name;
  }
}

function updateToolbar() {
  if (els.undo) els.undo.disabled = !store.canUndo();
  if (els.redo) els.redo.disabled = !store.canRedo();
  if (els.autosave) els.autosave.textContent = state.autosaveStatus;
  const duration = projectDuration(project());
  if (els.durationBadge) els.durationBadge.textContent = formatClock(duration);
  if (els.clipCount) els.clipCount.textContent = `${project().tracks.reduce((sum, track) => sum + track.clips.length, 0)} clips`;
  syncProjectName();
}

function updateProjectMeta() {
  if (!els.projectMeta) return;
  const dims = projectDimensions(project());
  els.projectMeta.textContent = `${project().aspect} · ${dims.width}×${dims.height} · ${project().fps} fps · ${formatClock(projectDuration(project()))}`;
  if (els.exportOpen) {
    els.exportOpen.disabled = false;
  }
}

/* -------------------------------------------------------------------------
 * Init
 * ---------------------------------------------------------------------- */

function cacheDom() {
  const map = {
    app: '#ve-app',
    projectName: '#ve-project-name',
    undo: '#ve-undo',
    redo: '#ve-redo',
    projectButton: '#ve-project',
    save: '#ve-save',
    open: '#ve-open',
    newProject: '#ve-new',
    exportOpen: '#ve-export-open',
    help: '#ve-help',
    autosave: '#ve-autosave',
    durationBadge: '#ve-duration-badge',
    clipCount: '#ve-clip-count',
    tabs: '#ve-tabs',
    panel: '#ve-panel',
    properties: '#ve-properties',
    propsBody: '#ve-props-body',
    selectionCount: '#ve-selection-count',
    timeline: '#ve-timeline',
    previewCanvas: '#ve-preview-canvas',
    previewWrap: '#ve-canvas-wrap',
    previewShell: '#ve-preview-shell',
    previewOverlay: '#ve-overlay',
    previewEmpty: '#ve-preview-empty',
    previewMeta: '#ve-project-meta',
    projectMeta: '#ve-project-meta',
    previewQuality: '#ve-preview-quality',
    fullscreen: '#ve-fullscreen',
    play: '#ve-play',
    prevFrame: '#ve-prev-frame',
    nextFrame: '#ve-next-frame',
    scrub: '#ve-scrub',
    time: '#ve-time',
    previewRate: '#ve-preview-rate',
    mediaInput: '#ve-media-input',
    openInput: '#ve-open-input',
    replaceInput: '#ve-replace-input',
    subtitleInput: '#ve-subtitle-input',
    toasts: '#ve-toasts',
    dropveil: '#ve-dropveil',
    mobileBar: '#ve-mobile-bar',
    restoreBanner: '#ve-restore-banner',
    restoreText: '#ve-restore-text',
    restoreButton: '#ve-restore-button',
    restoreDiscard: '#ve-restore-discard',
    relinkBanner: '#ve-relink-banner',
    relinkText: '#ve-relink-text',
    relinkButton: '#ve-relink-button',
    exportDialog: '#ve-export-dialog',
    exportSummary: '#ve-export-summary',
    exportFormat: '#ve-export-format',
    exportResolution: '#ve-export-resolution',
    exportAspect: '#ve-export-aspect',
    exportQuality: '#ve-export-quality',
    exportCustom: '#ve-export-custom',
    exportWidth: '#ve-export-width',
    exportHeight: '#ve-export-height',
    exportAspectCustom: '#ve-export-aspect-custom',
    exportAspectW: '#ve-export-aspect-w',
    exportAspectH: '#ve-export-aspect-h',
    exportEstimate: '#ve-export-estimate',
    exportNote: '#ve-export-note',
    exportStart: '#ve-export-start',
    exportCancel: '#ve-export-cancel',
    exportClose: '#ve-export-close',
    exportProgress: '#ve-export-progress',
    exportBar: '#ve-export-bar',
    exportStage: '#ve-export-stage',
    exportPercent: '#ve-export-percent',
    exportError: '#ve-export-error',
    exportResult: '#ve-export-result',
    exportVideo: '#ve-export-video',
    exportMeta: '#ve-export-meta',
    exportDownload: '#ve-export-download',
    exportAgain: '#ve-export-again',
    projectDialog: '#ve-project-dialog',
    projectDialogForm: '#ve-project-dialog-form',
    pdName: '#ve-pd-name',
    pdAspect: '#ve-pd-aspect',
    pdResolution: '#ve-pd-resolution',
    pdFps: '#ve-pd-fps',
    pdWidth: '#ve-pd-width',
    pdHeight: '#ve-pd-height',
    pdAspectW: '#ve-pd-aspect-w',
    pdAspectH: '#ve-pd-aspect-h',
    pdBackground: '#ve-pd-background',
    pdVolume: '#ve-pd-volume',
    pdCustomWrap: '#ve-pd-custom',
    pdAspectWrap: '#ve-pd-aspect-custom',
    pdClear: '#ve-pd-clear',
    pdApply: '#ve-pd-apply',
    helpDialog: '#ve-help-dialog'
  };
  for (const [key, selector] of Object.entries(map)) {
    els[key] = $(selector);
  }
}

function checkSupport() {
  const hasCanvas = typeof OffscreenCanvas === 'function';
  const hasBitmaps = typeof createImageBitmap === 'function';
  const hasDecoder = typeof window.VideoDecoder === 'function';
  const hasEncoder = typeof window.VideoEncoder === 'function';
  appSupport = {
    renderer: hasCanvas && hasBitmaps,
    encoder: hasEncoder,
    decoder: hasDecoder,
    audioEncoder: typeof window.AudioEncoder === 'function'
  };
  if (!appSupport.renderer) {
    toast('This browser cannot create the offscreen canvases the editor needs. Try a current Chrome, Edge, Firefox or Safari release.', 'error', 0);
  }
  if (!appSupport.encoder) {
    toast('Exporting needs the WebCodecs video encoder, which this browser does not expose. Editing still works, but export is unavailable here. Chrome or Edge is recommended.', 'warn', 0);
  } else if (!appSupport.audioEncoder) {
    toast('This browser can encode video but not audio. Exports will be silent and the export panel will say so.', 'warn', 7000);
  }
}

function init() {
  cacheDom();
  if (!els.app) return;
  checkSupport();

  media = new MediaLibrary();
  store = new ProjectStore(createProject());
  state.playhead = 0;

  previewCtx = els.previewCanvas.getContext('2d', { alpha: false });
  if (!previewCtx) {
    toast('The preview canvas could not be created in this browser.', 'error', 0);
    return;
  }

  timeline = new TimelineView({
    root: els.timeline,
    store,
    media,
    getTime: () => state.playhead,
    getSelection: () => state.selection,
    onSeek: (time, options) => seek(time, { fromScrub: Boolean(options?.scrubbing) }),
    onSelectClip: (id, options) => selectClip(id, options),
    onDropMedia: (mediaId, trackId, start) => addAssetToTimeline(mediaId, { trackId, start }),
    onCommand: handleTimelineCommand,
    onStatus: toast,
    onNeedRender: () => schedulePreview()
  });

  bindToolbar();
  bindTabs();
  bindPanel();
  bindProperties();
  bindTransport();
  bindPreviewInteractions();
  bindGlobalDragDrop();
  bindKeyboard();
  bindDialogs();
  bindMobileBar();
  bindPanelRefreshFlush();

  store.subscribe(onStoreChange);

  renderTabs();
  renderLibrary(true);
  renderPropertiesPanel();
  updateToolbar();
  updateProjectMeta();
  updateSelectionCount();
  updatePreviewSize();
  schedulePreview();
  updateTransport();
  timeline.mount();
  timeline.setTime(state.playhead);
  exposeDebug();
  loadAutosaveBanner();
  updateMobilePanel();
  updatePreviewEmpty();

  if (els.previewQuality) els.previewQuality.value = state.previewQuality;
  new ResizeObserver(() => layoutCanvas()).observe(els.previewShell);
  window.addEventListener('beforeunload', () => {
    media?.clear();
  });
}

function onStoreChange(reason) {
  pruneSelection();
  if (timeline && !timeline.isBusy() && !isEditingWithin(els.timeline)) timeline.render();
  else timeline?.updateSelection();
  updateToolbar();
  updateProjectMeta();
  updateTransport();

  if (reason === 'field') {
    /* A field's change event can fire while the pointer is already down on
     * another control. Rebuilding the panels here would replace the control
     * under the pointer and swallow its click, so defer the refresh. */
    state.fieldRenderPending = true;
    if (!isEditingWithin(els.propsBody)) refreshDerivedReadouts();
  } else if (reason === 'undo' || reason === 'redo' || reason === 'replace' || reason === 'commit') {
    renderPropertiesPanel();
    renderLibraryIfRelevant(false);
    state.playhead = clamp(state.playhead, 0, Math.max(0.01, projectDuration(project())));
    timeline?.setTime(state.playhead);
  } else {
    if (!isEditingWithin(els.propsBody)) {
      // Keep focused inputs intact, but refresh derived values elsewhere.
      refreshDerivedReadouts();
    }
    renderLibraryIfRelevant(false);
  }

  updatePreviewEmpty();
  schedulePreview();
  scheduleAutosave();
  updateMobileBadges();
}

function refreshDerivedReadouts() {
  if (!els.propsBody) return;
  const location = primaryLocation();
  if (!location) return;
  const startField = els.propsBody.querySelector('[data-timing="start"]');
  const durationField = els.propsBody.querySelector('[data-timing="duration"]');
  if (startField && document.activeElement !== startField) startField.value = location.clip.start.toFixed(2);
  if (durationField && document.activeElement !== durationField) durationField.value = location.clip.duration.toFixed(2);
}

function bindPanelRefreshFlush() {
  const flush = () => {
    if (!state.fieldRenderPending) return;
    state.fieldRenderPending = false;
    /* Run after the click that blurred the field, so that click completes on
     * the control the user actually pressed. */
    setTimeout(() => {
      renderPropertiesPanel();
      renderLibraryIfRelevant(false);
    }, 0);
  };
  window.addEventListener('click', flush, true);
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Tab' || event.key === 'Enter') flush();
  }, true);
}

/* -------------------------------------------------------------------------
 * Preview monitor
 * ---------------------------------------------------------------------- */

function previewEdge() {
  return PREVIEW_QUALITIES.find((item) => item.id === state.previewQuality)?.edge || 960;
}

function updatePreviewSize() {
  const dims = projectDimensions(project());
  const ratio = dims.width / dims.height;
  const edge = previewEdge();
  let width;
  let height;
  if (ratio >= 1) {
    width = edge;
    height = edge / ratio;
  } else {
    height = edge;
    width = edge * ratio;
  }
  width = even(width, 16);
  height = even(height, 16);
  if (els.previewCanvas.width !== width || els.previewCanvas.height !== height) {
    els.previewCanvas.width = width;
    els.previewCanvas.height = height;
  }
  els.previewCanvas.dataset.ratio = String(ratio);
  layoutCanvas();
}

function layoutCanvas() {
  if (!els.previewShell || !els.previewWrap) return;
  const rect = els.previewShell.getBoundingClientRect();
  const availableWidth = Math.max(80, rect.width - 20);
  const availableHeight = Math.max(80, rect.height - 20);
  const ratio = els.previewCanvas.width / Math.max(1, els.previewCanvas.height);
  let width = availableWidth;
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }
  els.previewWrap.style.width = `${Math.floor(width)}px`;
  els.previewWrap.style.height = `${Math.floor(height)}px`;
  updateOverlay();
}

async function renderPreview() {
  if (!previewCtx) return;
  const token = ++previewToken;
  previewBusy = true;
  try {
    await renderComposition(
      previewCtx,
      project(),
      sourceAdapter,
      state.playhead,
      { maxDimension: previewEdge() }
    );
    if (token !== previewToken) return;
    updateOverlay();
    updatePreviewEmpty();
    previewErrorShown = false;
  } catch (error) {
    if (token === previewToken && !previewErrorShown) {
      previewErrorShown = true;
      toast(`The preview could not be drawn: ${error.message || error}`, 'error');
    }
  } finally {
    if (token === previewToken) previewBusy = false;
  }
}

function schedulePreview() {
  if (previewScheduled) return;
  previewScheduled = true;
  requestAnimationFrame(() => {
    previewScheduled = false;
    renderPreview();
  });
}

function updatePreviewEmpty() {
  if (!els.previewEmpty) return;
  const duration = projectDuration(project());
  if (duration <= 0) {
    els.previewEmpty.hidden = false;
    els.previewEmpty.textContent = 'Your timeline is empty. Import media or add text to begin.';
    return;
  }
  const active = hasVisibleContentAt(state.playhead);
  els.previewEmpty.hidden = active;
  els.previewEmpty.textContent = active ? '' : 'No layers at this frame.';
}

function hasVisibleContentAt(time) {
  for (const track of project().tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      if (!clip.hidden && time >= clip.start - 1e-4 && time < clipEnd(clip) - 1e-4) return true;
    }
  }
  const subs = project().subtitles;
  if (subs && subs.enabled !== false) {
    if ((subs.items || []).some((item) => time >= item.start && time < item.end && String(item.text || '').trim())) return true;
  }
  return false;
}

function seek(time, options = {}) {
  const duration = projectDuration(project());
  state.playhead = clamp(num(time, 0), 0, Math.max(duration, 0));
  if (state.playing) lastTick = performance.now();
  timeline?.setTime(state.playhead);
  updateTransport();
  schedulePreview();
  updateOverlay();
  if (!options.fromScrub) updatePreviewEmpty();
}

function play() {
  const duration = projectDuration(project());
  if (duration <= 0) {
    toast('Add at least one clip to the timeline before playing.', 'warn');
    return;
  }
  if (state.playing) return;
  if (state.playhead >= duration - 0.01) state.playhead = 0;
  state.playing = true;
  lastTick = performance.now();
  updateTransport();
  updateOverlay();
  rafId = requestAnimationFrame(playTick);
}

function playTick(now) {
  if (!state.playing) return;
  if (now - lastTick >= 1000 / 30) {
    const duration = projectDuration(project());
    const delta = ((now - lastTick) / 1000) * state.previewRate;
    lastTick = now;
    state.playhead = Math.min(duration, state.playhead + delta);
    timeline?.setTime(state.playhead);
    updateTransport();
    schedulePreview();
    if (state.playhead >= duration - 0.002) {
      state.playing = false;
      updateTransport();
      updateOverlay();
      return;
    }
  }
  rafId = requestAnimationFrame(playTick);
}

function pause() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(rafId);
  updateTransport();
  updateOverlay();
}

function stepFrame(direction) {
  pause();
  const fps = Math.max(1, num(project().fps, 30));
  seek(state.playhead + direction / fps);
}

function updateTransport() {
  const duration = projectDuration(project());
  if (els.time) els.time.textContent = `${formatClock(state.playhead)} / ${formatClock(duration)}`;
  if (els.scrub) {
    els.scrub.max = String(Math.max(0.1, duration));
    if (document.activeElement !== els.scrub) els.scrub.value = String(state.playhead);
    els.scrub.disabled = duration <= 0;
  }
  if (els.play) {
    els.play.textContent = state.playing ? 'Pause' : 'Play';
    els.play.setAttribute('aria-pressed', String(state.playing));
    els.play.disabled = duration <= 0;
  }
  if (els.prevFrame) els.prevFrame.disabled = duration <= 0;
  if (els.nextFrame) els.nextFrame.disabled = duration <= 0;
}

/* -------------------------------------------------------------------------
 * On-canvas transform controls
 * ---------------------------------------------------------------------- */

function updateOverlay() {
  if (!els.previewOverlay || !els.previewWrap) return;
  els.previewOverlay.innerHTML = '';
  if (state.playing) return;
  const location = primaryVisualLocation();
  if (!location) return;
  const { track, clip } = location;
  if (track.kind !== 'video' || track.hidden || clip.hidden || clip.locked || clip.kind === 'background') return;
  if (state.playhead < clip.start - 1e-4 || state.playhead >= clipEnd(clip) - 1e-4) return;

  const canvas = els.previewCanvas;
  const local = state.playhead - clip.start;
  const asset = clip.mediaId ? media.get(clip.mediaId) : null;
  const bounds = clipBounds(clip, local, canvas.width, canvas.height, asset?.width, asset?.height);
  const scale = els.previewWrap.clientWidth / Math.max(1, canvas.width);
  const left = (bounds.x - bounds.width / 2) * scale;
  const top = (bounds.y - bounds.height / 2) * scale;
  const width = Math.max(18, bounds.width * scale);
  const height = Math.max(18, bounds.height * scale);

  const box = document.createElement('div');
  box.className = 've-select-box';
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.style.transform = `rotate(${bounds.rotation}deg)`;
  box.innerHTML = `
    <span class="ve-select-label">${escapeHtml(clip.name || clip.kind)}</span>
    <span class="ve-move-zone" data-handle="move" aria-hidden="true"></span>
    <span class="ve-handle" data-handle="nw" aria-hidden="true"></span>
    <span class="ve-handle" data-handle="ne" aria-hidden="true"></span>
    <span class="ve-handle" data-handle="sw" aria-hidden="true"></span>
    <span class="ve-handle" data-handle="se" aria-hidden="true"></span>
    <span class="ve-rotate" data-handle="rotate" title="Rotate" aria-hidden="true"></span>
  `;
  els.previewOverlay.appendChild(box);
  box.addEventListener('pointerdown', beginOverlayDrag);
}

function compPoint(event) {
  const rect = els.previewWrap.getBoundingClientRect();
  const canvas = els.previewCanvas;
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height
  };
}

function beginOverlayDrag(event) {
  const handle = event.target.closest('[data-handle]');
  if (!handle || event.button !== 0) return;
  const location = primaryVisualLocation();
  if (!location || location.clip.locked) return;
  event.preventDefault();
  event.stopPropagation();

  const clip = location.clip;
  const local = clamp(state.playhead - clip.start, 0, clip.duration);
  const asset = clip.mediaId ? media.get(clip.mediaId) : null;
  const bounds = clipBounds(clip, local, els.previewCanvas.width, els.previewCanvas.height, asset?.width, asset?.height);
  const center = { x: bounds.x, y: bounds.y };
  const start = compPoint(event);
  const transform = resolveTransform(clip, local);
  const info = {
    mode: handle.getAttribute('data-handle'),
    center,
    start,
    origin: {
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      rotation: transform.rotation
    },
    radius: Math.max(12, Math.hypot(bounds.width, bounds.height) / 2),
    pointerId: event.pointerId,
    clipId: clip.id,
    local
  };
  store.begin();

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== info.pointerId) return;
    const point = compPoint(moveEvent);
    const canvas = els.previewCanvas;
    store.live((draft) => {
      const located = findClip(draft, info.clipId);
      if (!located) return;
      const target = located.clip;
      if (info.mode === 'move') {
        writeAnimated(target, 'x', info.origin.x + (point.x - info.start.x) / canvas.width, info.local);
        writeAnimated(target, 'y', info.origin.y + (point.y - info.start.y) / canvas.height, info.local);
      } else if (info.mode === 'rotate') {
        const startAngle = Math.atan2(info.start.y - info.center.y, info.start.x - info.center.x);
        const angle = Math.atan2(point.y - info.center.y, point.x - info.center.x);
        const degrees = ((angle - startAngle) * 180) / Math.PI;
        writeAnimated(target, 'rotation', info.origin.rotation + degrees, info.local);
      } else {
        const startDistance = Math.hypot(info.start.x - info.center.x, info.start.y - info.center.y);
        const distance = Math.hypot(point.x - info.center.x, point.y - info.center.y);
        const factor = startDistance > 3 ? distance / startDistance : 1;
        writeAnimated(target, 'scale', clamp(info.origin.scale * factor, 0.05, 6), info.local);
      }
    });
    schedulePreview();
    updateOverlay();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    store.end();
    renderPropertiesPanel();
    renderLibraryIfRelevant(true);
    updateOverlay();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function writeAnimated(clip, prop, value, localTime) {
  const list = clip.keyframes ? clip.keyframes[prop] : null;
  if (Array.isArray(list) && list.length) {
    const existing = list.find((key) => Math.abs(key.t - localTime) < 0.04);
    if (existing) existing.v = value;
    else list.push({ t: localTime, v: value, ease: state.keyEase });
    list.sort((a, b) => a.t - b.t);
    return;
  }
  clip[prop] = value;
}

function pointInBounds(point, bounds) {
  const angle = (-(bounds.rotation || 0) * Math.PI) / 180;
  const dx = point.x - bounds.x;
  const dy = point.y - bounds.y;
  const x = dx * Math.cos(angle) - dy * Math.sin(angle);
  const y = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(x) <= bounds.width / 2 + 2 && Math.abs(y) <= bounds.height / 2 + 2;
}

function handlePreviewPointer(event) {
  if (event.button !== 0) return;
  if (state.playing) pause();
  const point = compPoint(event);
  const canvas = els.previewCanvas;
  for (const track of project().tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips.slice().sort((a, b) => b.start - a.start)) {
      if (clip.hidden || state.playhead < clip.start || state.playhead >= clipEnd(clip)) continue;
      const local = state.playhead - clip.start;
      const asset = clip.mediaId ? media.get(clip.mediaId) : null;
      const bounds = clipBounds(clip, local, canvas.width, canvas.height, asset?.width, asset?.height);
      if (pointInBounds(point, bounds)) {
        selectClip(clip.id, { additive: event.shiftKey || event.ctrlKey || event.metaKey });
        return;
      }
    }
  }
  if (!event.shiftKey) selectNone();
}

/* -------------------------------------------------------------------------
 * Media import and placement
 * ---------------------------------------------------------------------- */

async function importFiles(fileList, options = {}) {
  const files = [...(fileList || [])];
  if (!files.length) return [];
  const accepted = [];
  const errors = [];
  toast(`Importing ${files.length} file${files.length === 1 ? '' : 's'}…`, 'info', 1600);
  for (const file of files) {
    const invalid = validateFile(file);
    if (invalid) {
      errors.push(`${file.name}: ${invalid}`);
      continue;
    }
    try {
      const asset = await media.addFile(file);
      accepted.push(asset);
    } catch (error) {
      errors.push(error.message || `${file.name}: import failed.`);
    }
  }
  state.importErrors = errors.slice(0, 8);
  if (accepted.length) {
    if (options.relink || state.pendingRelink.length) relinkPendingMedia();
    renderLibrary(true);
    updateToolbar();
    updateProjectMeta();
    scheduleAutosave();
    toast(`${accepted.length} file${accepted.length === 1 ? '' : 's'} imported. Media stayed in this tab.`, 'success');
  }
  if (errors.length) {
    toast(errors[0], 'error', 6500);
    renderLibrary(true);
  }
  return accepted;
}

function openMediaPicker({ relink = false } = {}) {
  if (!els.mediaInput) return;
  els.mediaInput.dataset.relink = relink ? 'true' : 'false';
  els.mediaInput.value = '';
  els.mediaInput.click();
}

function usedClipCount(mediaId) {
  let count = 0;
  for (const track of project().tracks) {
    for (const clip of track.clips) {
      if (clip.mediaId === mediaId) count += 1;
    }
  }
  return count;
}

function removeMedia(mediaId) {
  const asset = media.get(mediaId);
  if (!asset) return;
  const used = usedClipCount(mediaId);
  if (used && !window.confirm(`“${asset.name}” is used by ${used} clip${used === 1 ? '' : 's'}. Removing it will leave those clips without a picture. Continue?`)) return;
  media.remove(mediaId);
  renderLibrary(true);
  updateProjectMeta();
  toast(`Removed ${asset.name} from the library.`, 'info');
}

function compatibleTracks(kind) {
  return project().tracks.filter((track) => track.kind === (kind === 'audio' ? 'audio' : 'video'));
}

function findPlacementTrack(kind, start, duration) {
  const tracks = compatibleTracks(kind);
  const ordered = kind === 'audio' ? tracks.slice().reverse() : tracks.slice().reverse();
  for (const track of ordered) {
    if (track.locked) continue;
    if (!track.clips.some((clip) => start < clipEnd(clip) - 1e-4 && start + duration > clip.start + 1e-4)) {
      return track;
    }
  }
  return null;
}

function ensureTrack(kind) {
  const tracks = compatibleTracks(kind);
  if (tracks.length) return tracks[0];
  const track = createTrack(kind === 'audio' ? 'audio' : 'video', kind === 'audio' ? 'Audio 1' : 'Video 1');
  store.apply((draft) => {
    if (kind === 'audio') draft.tracks.push(track);
    else draft.tracks.unshift(track);
  });
  return findTrack(project(), track.id);
}

function addAssetToTimeline(mediaId, options = {}) {
  const asset = media.get(mediaId);
  if (!asset) {
    toast('That media file is not loaded in this project.', 'warn');
    return null;
  }
  const kind = asset.type === 'image' ? 'image' : asset.type === 'audio' ? 'audio' : 'video';
  const desiredStart = Math.max(0, num(options.start, state.playhead));
  const duration = asset.type === 'image' ? 3 : Math.max(0.2, asset.duration || 3);
  let track = options.trackId ? findTrack(project(), options.trackId) : null;
  const compatible = track && track.kind === (kind === 'audio' ? 'audio' : 'video');
  if (!compatible) track = findPlacementTrack(kind, desiredStart, duration);
  if (!track) {
    if (kind === 'audio') {
      track = createTrack('audio', `Audio ${compatibleTracks('audio').length + 1}`);
      store.apply((draft) => draft.tracks.push(track));
      track = findTrack(project(), track.id);
    } else {
      track = createTrack('video', `Overlay ${visualTracks(project()).length}`);
      store.apply((draft) => draft.tracks.unshift(track));
      track = findTrack(project(), track.id);
    }
  }

  const clip = createClip(kind, {
    name: asset.name,
    mediaId,
    start: desiredStart,
    duration,
    inPoint: 0,
    outPoint: asset.type === 'image' ? duration : Math.max(0.2, asset.duration || duration)
  });

  let placed = null;
  store.apply((draft) => {
    const destination = findTrack(draft, track.id);
    if (!destination) return;
    placed = addClipToTrack(destination, clip);
  });
  if (!placed) return null;
  state.selection.clear();
  state.selection.add(placed.id);
  state.playhead = clamp(placed.start + Math.min(0.1, placed.duration / 2), 0, projectDuration(project()));
  updateSelectionClasses();
  renderPropertiesPanel();
  renderLibraryIfRelevant(true);
  timeline?.setTime(state.playhead);
  schedulePreview();
  toast(`Added “${asset.name}” to ${track.name}.`, 'success');
  return placed;
}

function addTextPreset(presetId) {
  const preset = TEXT_PRESETS[presetId] || TEXT_PRESETS.title;
  const duration = preset.duration || 3;
  const start = state.playhead;
  let track = findPlacementTrack('video', start, duration);
  if (!track) {
    const created = createTrack('video', `Text ${visualTracks(project()).length}`);
    store.apply((draft) => draft.tracks.unshift(created));
    track = findTrack(project(), created.id);
  }
  const clip = createClip('text', {
    name: preset.name,
    start,
    duration,
    x: preset.x ?? 0.5,
    y: preset.y ?? 0.5,
    text: { ...deepClone(preset.text), content: preset.text.content }
  });
  store.apply((draft) => {
    const destination = findTrack(draft, track.id);
    if (destination) addClipToTrack(destination, clip);
  });
  state.selection.clear();
  state.selection.add(clip.id);
  state.activeTab = 'media';
  renderTabs();
  renderLibrary(true);
  renderPropertiesPanel();
  updateSelectionClasses();
  timeline?.setTime(state.playhead);
  schedulePreview();
  toast(`${preset.label} added as its own text layer.`, 'success');
  return clip;
}

function addShapeClip(type) {
  const duration = 3;
  const start = state.playhead;
  let track = findPlacementTrack('video', start, duration);
  if (!track) {
    const created = createTrack('video', `Shape ${visualTracks(project()).length}`);
    store.apply((draft) => draft.tracks.unshift(created));
    track = findTrack(project(), created.id);
  }
  const clip = createClip('shape', {
    name: `${SHAPE_TYPES.find((shape) => shape.id === type)?.label || 'Shape'}`,
    start,
    duration,
    shape: { type }
  });
  store.apply((draft) => {
    const destination = findTrack(draft, track.id);
    if (destination) addClipToTrack(destination, clip);
  });
  state.selection.clear();
  state.selection.add(clip.id);
  renderPropertiesPanel();
  updateSelectionClasses();
  schedulePreview();
  toast('Shape layer added. Edit its colour and size in Properties.', 'success');
  return clip;
}

function addBackgroundClip(type) {
  const duration = Math.max(5, Math.ceil(projectDuration(project()) || 5));
  let bottom = visualTracks(project()).slice().reverse().find((track) => !track.clips.length);
  if (!bottom) {
    bottom = createTrack('video', 'Background');
    store.apply((draft) => draft.tracks.push(bottom));
    bottom = findTrack(project(), bottom.id);
  }
  const clip = createClip('background', {
    name: type === 'gradient' ? 'Gradient background' : 'Solid background',
    start: 0,
    duration,
    background: { type }
  });
  store.apply((draft) => {
    const destination = findTrack(draft, bottom.id);
    if (destination) addClipToTrack(destination, clip);
  });
  state.selection.clear();
  state.selection.add(clip.id);
  renderPropertiesPanel();
  updateSelectionClasses();
  schedulePreview();
  toast('Background added on its own bottom track.', 'success');
  return clip;
}

function addSticker(emoji) {
  const duration = 3;
  const start = state.playhead;
  let track = findPlacementTrack('video', start, duration);
  if (!track) {
    const created = createTrack('video', `Sticker ${visualTracks(project()).length}`);
    store.apply((draft) => draft.tracks.unshift(created));
    track = findTrack(project(), created.id);
  }
  const clip = createClip('text', {
    name: `Sticker ${emoji}`,
    start,
    duration,
    x: 0.78,
    y: 0.22,
    text: {
      content: emoji,
      size: 160,
      bold: false,
      bgOpacity: 0,
      shadow: true,
      maxWidth: 0.4
    }
  });
  store.apply((draft) => {
    const destination = findTrack(draft, track.id);
    if (destination) addClipToTrack(destination, clip);
  });
  state.selection.clear();
  state.selection.add(clip.id);
  renderPropertiesPanel();
  updateSelectionClasses();
  schedulePreview();
  toast('Sticker layer added.', 'success');
  return clip;
}

/* -------------------------------------------------------------------------
 * Panels
 * ---------------------------------------------------------------------- */

function renderTabs() {
  if (!els.tabs) return;
  els.tabs.innerHTML = renderTabStrip(state.activeTab);
}

function panelContext() {
  return {
    tab: state.activeTab,
    project: project(),
    media,
    selection: state.selection,
    importErrors: state.importErrors,
    selectedSubtitleId: state.selectedSubtitleId,
    transitionDuration: state.transitionDuration
  };
}

/** Remember which disclosure sections the user has opened so a re-render
 *  (for example the deferred refresh after editing a field) does not close
 *  them under the pointer. */
function openSectionLabels(container) {
  if (!container) return [];
  return $$('details[open]', container)
    .map((details) => details.querySelector('summary')?.textContent?.trim())
    .filter(Boolean);
}

function restoreOpenSections(container, labels) {
  if (!container || !labels.length) return;
  for (const details of $$('details', container)) {
    const label = details.querySelector('summary')?.textContent?.trim();
    if (label && labels.includes(label)) details.open = true;
  }
}

function renderLibrary() {
  if (!els.panel) return;
  const scrollTop = els.panel.scrollTop;
  const openSections = openSectionLabels(els.panel);
  els.panel.innerHTML = renderLibraryPanel(panelContext());
  restoreOpenSections(els.panel, openSections);
  els.panel.scrollTop = scrollTop;
}

function renderLibraryIfRelevant(force) {
  if (!els.panel) return;
  if (!force && isEditingWithin(els.panel)) return;
  renderLibrary();
}

function renderPropertiesPanel(force = false) {
  if (!els.propsBody) return;
  if (!force && isEditingWithin(els.propsBody)) return;
  const scrollTop = els.propsBody.scrollTop;
  els.propsBody.innerHTML = renderProperties({
    project: project(),
    selection: state.selection,
    playhead: state.playhead,
    media
  });
  els.propsBody.scrollTop = scrollTop;
}

function setActiveTab(tab) {
  if (!TABS.some((item) => item.id === tab)) return;
  state.activeTab = tab;
  renderTabs();
  renderLibrary();
  const tabButton = els.tabs.querySelector(`[data-tab="${tab}"]`);
  tabButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateMobilePanel() {
  if (!els.app) return;
  els.app.dataset.mobilePanel = state.mobilePanel;
  for (const button of $$('[data-mobile-panel]', els.mobileBar || document)) {
    const active = button.getAttribute('data-mobile-panel') === state.mobilePanel;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('is-active', active);
  }
}

function updateMobileBadges() {
  if (!els.mobileBar) return;
  const tools = els.mobileBar.querySelector('[data-mobile-panel="tools"] .ve-mobile-count');
  if (tools) tools.textContent = String(media ? media.list().length : 0);
  const props = els.mobileBar.querySelector('[data-mobile-panel="properties"] .ve-mobile-count');
  if (props) props.textContent = String(state.selection.size);
}

/* -------------------------------------------------------------------------
 * Autosave and project files
 * ---------------------------------------------------------------------- */

let autosaveSoon = null;

function projectFileData() {
  return {
    schema: 2,
    kind: 'letitedit.video-editor',
    savedAt: new Date().toISOString(),
    project: deepClone(project()),
    media: media.list().map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      size: asset.size,
      mimeType: asset.mimeType,
      width: asset.width || null,
      height: asset.height || null,
      duration: asset.duration || null
    }))
  };
}

function writeAutosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(projectFileData()));
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    state.autosaveStatus = `Autosaved ${time}`;
  } catch (error) {
    state.autosaveStatus = 'Autosave unavailable (storage full)';
  }
  if (els.autosave) els.autosave.textContent = state.autosaveStatus;
}

function scheduleAutosave() {
  if (!autosaveSoon) autosaveSoon = debounce(writeAutosave, 1200);
  autosaveSoon();
}

function saveProjectFile() {
  try {
    const data = projectFileData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${sanitizeFilename(project().name, 'video-project')}.letitedit.json`);
    toast('Project file downloaded. Imported media is not inside it — keep the original files to relink later.', 'success', 6200);
  } catch (error) {
    toast(`The project could not be saved: ${error.message || error}`, 'error');
  }
}

function rekeyAsset(oldId, newId) {
  const asset = media.get(oldId);
  if (!asset || oldId === newId) return false;
  if (media.has(newId)) return false;
  media.assets.delete(oldId);
  asset.id = newId;
  media.assets.set(newId, asset);
  return true;
}

function updateRelinkBanner() {
  if (!els.relinkBanner || !els.relinkText) return;
  if (!state.pendingRelink.length) {
    els.relinkBanner.hidden = true;
    return;
  }
  const names = state.pendingRelink.slice(0, 4).map((item) => item.name || item.id).join(', ');
  const extra = state.pendingRelink.length > 4 ? ` and ${state.pendingRelink.length - 4} more` : '';
  els.relinkText.textContent = `${state.pendingRelink.length} media file${state.pendingRelink.length === 1 ? '' : 's'} used by this project are not loaded: ${names}${extra}. Re-import them to restore the picture.`;
  els.relinkBanner.hidden = false;
}

function relinkPendingMedia() {
  updateRelinkBanner();
  if (!state.pendingRelink.length) return;
  /* Names may match assets already in the library. */
  for (const entry of state.pendingRelink.slice()) {
    const existing = media.list().find((asset) => asset.name === entry.name && asset.id !== entry.id);
    if (existing && rekeyAsset(existing.id, entry.id)) {
      state.pendingRelink = state.pendingRelink.filter((item) => item !== entry);
    }
  }
  updateRelinkBanner();
  renderLibrary();
  schedulePreview();
}

function loadProjectData(data, options = {}) {
  const restored = restoreProject(data);
  if (!restored.project.tracks.length) throw new Error('This project has no tracks.');
  pause();
  store = new ProjectStore(restored.project);
  store.subscribe(onStoreChange);
  if (timeline) timeline.store = store;
  state.selection.clear();
  state.selectedSubtitleId = null;
  state.restoreData = null;
  state.pendingRelink = [];
  state.playhead = 0;

  const declared = Array.isArray(data.media) ? data.media : (Array.isArray(restored.media) ? restored.media : []);
  for (const entry of declared) {
    if (!entry || !entry.id) continue;
    if (media.has(entry.id)) continue;
    const existing = media.list().find((asset) => asset.name === entry.name);
    if (existing && rekeyAsset(existing.id, entry.id)) continue;
    state.pendingRelink.push({ id: entry.id, name: entry.name || 'media', type: entry.type || 'video' });
  }

  if (els.restoreBanner) els.restoreBanner.hidden = true;
  state.autosaveStatus = options.autosaved ? 'Restored autosave' : 'Project loaded';
  renderTabs();
  renderLibrary();
  renderPropertiesPanel(true);
  updateToolbar();
  updateProjectMeta();
  updatePreviewSize();
  updateTransport();
  updateSelectionClasses();
  updateRelinkBanner();
  updateSelectionCount();
  updateMobileBadges();
  timeline?.render();
  timeline?.setTime(0);
  timeline?.fit();
  schedulePreview();
  scheduleAutosave();
  try {
    if (options.autosaved) localStorage.removeItem(AUTOSAVE_KEY);
  } catch (error) {
    /* storage unavailable */
  }
}

async function openProjectFile(file) {
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('That file is not valid JSON.');
    }
    loadProjectData(data);
    toast(`Opened “${project().name}”.`, 'success');
  } catch (error) {
    toast(`The project could not be opened: ${error.message || error}`, 'error', 7000);
  }
}

function newProject() {
  const hasContent = project().tracks.some((track) => track.clips.length);
  if (hasContent || (media && media.list().length)) {
    if (!window.confirm('Start a new project? The current timeline and the imported media in this tab will be cleared. Saved project files are not affected.')) return;
  }
  pause();
  media.clear();
  store = new ProjectStore(createProject());
  store.subscribe(onStoreChange);
  if (timeline) timeline.store = store;
  state.selection.clear();
  state.selectedSubtitleId = null;
  state.playhead = 0;
  state.pendingRelink = [];
  state.restoreData = null;
  state.importErrors = [];
  state.autosaveStatus = 'Autosave ready';
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (error) {
    /* storage unavailable */
  }
  if (els.restoreBanner) els.restoreBanner.hidden = true;
  updateRelinkBanner();
  renderTabs();
  renderLibrary();
  renderPropertiesPanel(true);
  updateToolbar();
  updateProjectMeta();
  updatePreviewSize();
  updateTransport();
  updateSelectionCount();
  updateSelectionClasses();
  updatePreviewEmpty();
  timeline?.render();
  timeline?.setTime(0);
  schedulePreview();
  toast('New project ready. Import media to begin.', 'info');
}

function loadAutosaveBanner() {
  if (!els.restoreBanner) return;
  let raw = null;
  try {
    raw = localStorage.getItem(AUTOSAVE_KEY);
  } catch (error) {
    return;
  }
  if (!raw) return;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (removeError) {
      /* ignore */
    }
    return;
  }
  if (!data || !data.project || !Array.isArray(data.project.tracks)) return;
  const clips = data.project.tracks.reduce((sum, track) => sum + (track.clips ? track.clips.length : 0), 0);
  if (!clips) {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (error) {
      /* ignore */
    }
    return;
  }
  state.restoreData = data;
  if (els.restoreText) {
    const saved = data.savedAt ? new Date(data.savedAt) : null;
    els.restoreText.textContent = `An autosaved project (“${data.project.name || 'Untitled'}”, ${clips} clip${clips === 1 ? '' : 's'}${saved ? `, ${saved.toLocaleString()}` : ''}) is stored in this browser. Media has to be re-imported.`;
  }
  els.restoreBanner.hidden = false;
}

/* -------------------------------------------------------------------------
 * Clip commands
 * ---------------------------------------------------------------------- */

function overlapAt(track, start, duration, excludeId) {
  return track.clips.some((clip) => clip.id !== excludeId && start < clipEnd(clip) - 1e-4 && start + duration > clip.start + 1e-4);
}

function splitAtPlayhead() {
  const time = state.playhead;
  const targets = selectedLocations().filter(({ clip }) => !clip.locked && time > clip.start + 0.06 && time < clipEnd(clip) - 0.06);
  if (!targets.length) {
    toast('Select a clip and put the playhead inside it to split.', 'warn');
    return;
  }
  const createdIds = [];
  store.apply((draft) => {
    for (const reference of targets) {
      const located = findClip(draft, reference.clip.id);
      if (!located) continue;
      const { clip } = located;
      if (time <= clip.start + 0.06 || time >= clipEnd(clip) - 0.06) continue;
      const offset = time - clip.start;
      const speed = Math.max(0.05, Number(clip.speed) || 1);
      const right = deepClone(clip);
      right.id = uid('clip');
      right.start = time;
      right.duration = clipEnd(clip) - time;
      right.transition = { type: 'none', duration: 0.5, reverse: false };
      right.inAnim = { type: 'none', duration: 0.5 };
      right.outAnim = deepClone(clip.outAnim);
      right.name = clip.name;
      if (!clip.freeze && (clip.kind === 'video' || clip.kind === 'audio')) {
        const inPoint = Number(clip.inPoint) || 0;
        const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : inPoint + clip.duration * speed;
        if (clip.reverse) {
          right.outPoint = clamp(outPoint - offset * speed, inPoint + 0.02, outPoint);
          clip.inPoint = right.outPoint;
        } else {
          right.inPoint = clamp(inPoint + offset * speed, inPoint, outPoint - 0.02);
          clip.outPoint = right.inPoint;
        }
      }
      /* Move the second half's keyframes to its own local time. */
      if (right.keyframes) {
        for (const key of Object.keys(right.keyframes)) {
          right.keyframes[key] = (right.keyframes[key] || [])
            .filter((item) => item.t >= offset - 1e-3)
            .map((item) => ({ ...item, t: Math.max(0, item.t - offset) }));
        }
      }
      if (clip.keyframes) {
        for (const key of Object.keys(clip.keyframes)) {
          clip.keyframes[key] = (clip.keyframes[key] || []).filter((item) => item.t <= offset + 1e-3);
        }
      }
      clip.duration = offset;
      located.track.clips.push(right);
      sortTrack(located.track);
      createdIds.push(right.id);
    }
  });
  if (!createdIds.length) {
    toast('Nothing could be split at this position.', 'warn');
    return;
  }
  if (createdIds.length === 1) {
    state.selection.clear();
    state.selection.add(createdIds[0]);
  }
  updateSelectionClasses();
  renderPropertiesPanel();
  updateTransport();
  toast(`Split into ${createdIds.length + (createdIds.length ? targets.length : 0)} parts.`, 'success');
}

function deleteSelection() {
  if (!state.selection.size) {
    toast('Select a clip first.', 'warn');
    return;
  }
  let removed = 0;
  let blocked = 0;
  store.apply((draft) => {
    for (const track of draft.tracks) {
      if (track.locked) continue;
      const keep = [];
      for (const clip of track.clips) {
        if (state.selection.has(clip.id)) {
          if (clip.locked) {
            blocked += 1;
            keep.push(clip);
          } else {
            removed += 1;
          }
        } else {
          keep.push(clip);
        }
      }
      track.clips = keep;
    }
  });
  if (removed) {
    state.selection.clear();
    updateSelectionClasses();
    renderPropertiesPanel(true);
    toast(`Deleted ${removed} clip${removed === 1 ? '' : 's'}.`, 'info');
  }
  if (blocked) toast(`${blocked} clip${blocked === 1 ? ' is' : 's are'} locked and stayed on the timeline.`, 'warn');
}

function duplicateSelection() {
  const targets = selectedLocations().filter(({ clip }) => !clip.locked);
  if (!targets.length) {
    toast('Select a clip to duplicate.', 'warn');
    return;
  }
  const createdIds = [];
  store.apply((draft) => {
    for (const reference of targets) {
      const located = findClip(draft, reference.clip.id);
      if (!located) continue;
      const copy = deepClone(located.clip);
      copy.id = uid('clip');
      copy.name = `${located.clip.name || located.clip.kind} copy`;
      copy.start = clipEnd(located.clip);
      copy.transition = { type: 'none', duration: 0.5, reverse: false };
      let target = located.track;
      if (overlapAt(target, copy.start, copy.duration, copy.id)) {
        target = createTrack('video', `Layer ${draft.tracks.filter((track) => track.kind === 'video').length + 1}`);
        if (copy.kind === 'audio') target = createTrack('audio', `Audio ${draft.tracks.filter((track) => track.kind === 'audio').length + 1}`);
        if (target.kind === 'audio') draft.tracks.push(target);
        else draft.tracks.unshift(target);
      }
      addClipToTrack(target, copy);
      createdIds.push(copy.id);
    }
  });
  if (createdIds.length) {
    state.selection.clear();
    for (const id of createdIds) state.selection.add(id);
    updateSelectionClasses();
    renderPropertiesPanel(true);
    timeline?.render();
    toast(`Duplicated ${createdIds.length} clip${createdIds.length === 1 ? '' : 's'}.`, 'success');
  }
}

function moveAudioTrackOrder(clipId, direction) {
  const located = findClip(project(), clipId);
  if (!located) return;
  const audioTracks = project().tracks.filter((track) => track.kind === 'audio');
  const index = audioTracks.findIndex((track) => track.id === located.track.id);
  const target = audioTracks[index + direction];
  if (!target) return;
  const moved = store.apply((draft) => moveClipToTrack(draft, clipId, target.id, located.clip.start));
  if (!moved) toast('There is no space on the neighbouring audio track.', 'warn');
}

function stackClip(clipId, mode) {
  const located = findClip(project(), clipId);
  if (!located) return;
  if (located.clip.locked || located.track.locked) {
    toast('Unlock the clip or its track before changing the layer order.', 'warn');
    return;
  }
  if (located.clip.kind === 'audio') {
    if (mode === 'up') moveAudioTrackOrder(clipId, -1);
    else if (mode === 'down') moveAudioTrackOrder(clipId, 1);
    else toast('Audio clips mix together; their track order does not change what you hear.', 'info');
    return;
  }
  const videoTracks = project().tracks.filter((track) => track.kind === 'video');
  const currentIndex = videoTracks.findIndex((track) => track.id === located.track.id);
  let targetIndex;
  if (mode === 'front') targetIndex = 0;
  else if (mode === 'back') targetIndex = videoTracks.length - 1;
  else targetIndex = currentIndex + (mode === 'up' ? -1 : 1);
  if (targetIndex < 0) {
    toast('This clip is already in front.', 'info');
    return;
  }
  if (targetIndex >= videoTracks.length) {
    toast('This clip is already at the back.', 'info');
    return;
  }
  const target = videoTracks[targetIndex];
  if (target.id === located.track.id) return;
  /* Only move within the same time window. If the neighbouring layer is
   * already busy there, give the clip its own layer instead of silently
   * shifting it in time. */
  const occupied = overlapAt(target, located.clip.start, located.clip.duration, clipId);
  let moved = false;
  if (!occupied && !target.locked) {
    moved = store.apply((draft) => moveClipToTrack(draft, clipId, target.id, located.clip.start));
  }
  if (moved) return;

  /* The neighbouring track is full, so give the clip its own layer. */
  store.apply((draft) => {
    const current = findClip(draft, clipId);
    if (!current) return;
    const track = createTrack('video', `Layer ${draft.tracks.filter((item) => item.kind === 'video').length + 1}`);
    let insertAt;
    if (mode === 'front') {
      insertAt = 0;
    } else if (mode === 'back') {
      const lastVideo = draft.tracks.map((item) => item.kind).lastIndexOf('video');
      insertAt = lastVideo + 1;
    } else if (mode === 'up') {
      insertAt = draft.tracks.findIndex((item) => item.id === target.id);
    } else {
      const nextVideo = draft.tracks.filter((item) => item.kind === 'video')[targetIndex];
      insertAt = draft.tracks.findIndex((item) => item.id === (nextVideo ? nextVideo.id : current.track.id)) + 1;
    }
    if (insertAt < 0) insertAt = 0;
    draft.tracks.splice(insertAt, 0, track);
    moveClipToTrack(draft, clipId, track.id, current.clip.start);
    const recheck = findClip(draft, clipId);
    if (recheck) recheck.clip.start = current.clip.start;
  });
}

function addTrack(kind) {
  const name = kind === 'audio'
    ? `Audio ${project().tracks.filter((track) => track.kind === 'audio').length + 1}`
    : `Layer ${project().tracks.filter((track) => track.kind === 'video').length + 1}`;
  const track = createTrack(kind === 'audio' ? 'audio' : 'video', name);
  store.apply((draft) => {
    if (kind === 'audio') draft.tracks.push(track);
    else draft.tracks.unshift(track);
  });
  toast(`${name} added.`, 'success');
}

function handleTimelineCommand(command, payload = {}) {
  if (command === 'split') splitAtPlayhead();
  else if (command === 'delete') deleteSelection();
  else if (command === 'duplicate') duplicateSelection();
  else if (command === 'add-track') addTrack(payload.kind);
  else if (command === 'move-layer') stackClip(payload.clipId, payload.direction < 0 ? 'up' : 'down');
  else if (command === 'edit-transition') {
    state.activeTab = 'transitions';
    renderTabs();
    renderLibrary();
  }
}

/* -------------------------------------------------------------------------
 * Toolbar, tabs and panel bindings
 * ---------------------------------------------------------------------- */

function bindToolbar() {
  els.undo?.addEventListener('click', () => {
    pause();
    if (!store.undo()) toast('There is nothing to undo.', 'info');
  });
  els.redo?.addEventListener('click', () => {
    pause();
    if (!store.redo()) toast('There is nothing to redo.', 'info');
  });
  els.projectButton?.addEventListener('click', () => openProjectDialog());
  els.save?.addEventListener('click', saveProjectFile);
  els.open?.addEventListener('click', () => {
    if (els.openInput) {
      els.openInput.value = '';
      els.openInput.click();
    }
  });
  els.newProject?.addEventListener('click', newProject);
  els.exportOpen?.addEventListener('click', openExportDialog);
  els.help?.addEventListener('click', () => {
    if (els.helpDialog && typeof els.helpDialog.showModal === 'function') els.helpDialog.showModal();
  });
  els.projectName?.addEventListener('change', () => {
    const value = els.projectName.value.trim().slice(0, 80);
    if (!value) {
      els.projectName.value = project().name;
      return;
    }
    store.apply((draft) => {
      draft.name = value;
    });
    toast('Project renamed.', 'success');
  });
  els.mediaInput?.addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    const relink = event.target.dataset.relink === 'true';
    event.target.value = '';
    if (relink) state.pendingRelink.length ? await importFiles(files, { relink: true }) : await importFiles(files);
    else await importFiles(files);
  });
  els.openInput?.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) await openProjectFile(file);
  });
  els.replaceInput?.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const targetId = state.replaceTargetId;
    state.replaceTargetId = null;
    const invalid = validateFile(file);
    if (invalid) {
      toast(`${file.name}: ${invalid}`, 'error', 6500);
      return;
    }
    try {
      const previousAsset = targetId ? (primaryLocation()?.clip.mediaId || null) : null;
      const asset = await media.addFile(file);
      const location = targetId ? findClip(project(), targetId) : null;
      if (location) {
        const remap = {};

        remap[asset.id] = asset.id;
        store.apply((draft) => {
          const current = findClip(draft, targetId);
          if (!current) return;
          current.clip.mediaId = asset.id;
          current.clip.name = asset.name;
          current.clip.kind = asset.type === 'audio' ? 'audio' : asset.type === 'image' ? 'image' : 'video';
          const duration = asset.type === 'image' ? Math.max(current.clip.duration, 1) : Math.max(MIN_DURATION, asset.duration || current.clip.duration);
          current.clip.inPoint = 0;
          current.clip.duration = Math.min(duration, Math.max(current.clip.duration, MIN_DURATION));
          current.clip.outPoint = Math.min(duration, current.clip.duration * Math.max(0.05, Number(current.clip.speed) || 1));
          if (current.clip.freeze) {
            current.clip.freeze = false;
            current.clip.freezeAt = null;
          }
        });
        toast(`Replaced the source with “${asset.name}”.`, 'success');
        if (previousAsset && previousAsset !== asset.id && !usedClipCount(previousAsset)) {
          /* keep the old asset available in the library */
        }
      } else {
        toast(`Imported “${asset.name}”. Select a clip to use it as a replacement.`, 'success');
      }
      renderLibrary();
      renderPropertiesPanel(true);
      schedulePreview();
    } catch (error) {
      toast(`The replacement could not be imported: ${error.message || error}`, 'error', 7000);
    }
  });
  els.subtitleInput?.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) await importSubtitleFile(file);
  });
  els.restoreButton?.addEventListener('click', () => {
    if (!state.restoreData) return;
    try {
      loadProjectData(state.restoreData, { autosaved: true });
      toast('Autosave restored. Re-import the original media to see the picture.', 'success', 7000);
    } catch (error) {
      toast(`The autosave could not be restored: ${error.message || error}`, 'error', 7000);
    }
  });
  els.restoreDiscard?.addEventListener('click', () => {
    state.restoreData = null;
    if (els.restoreBanner) els.restoreBanner.hidden = true;
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (error) {
      /* ignore */
    }
    toast('Autosave discarded.', 'info');
  });
  els.relinkButton?.addEventListener('click', () => openMediaPicker({ relink: true }));
  els.previewQuality?.addEventListener('change', () => {
    state.previewQuality = els.previewQuality.value;
    updatePreviewSize();
    schedulePreview();
  });
  els.fullscreen?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await els.previewShell.requestFullscreen();
    } catch (error) {
      toast('Fullscreen is not available in this browser.', 'warn');
    }
  });
  document.addEventListener('fullscreenchange', () => layoutCanvas());
}

function bindTabs() {
  if (!els.tabs) return;
  els.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    setActiveTab(button.getAttribute('data-tab'));
  });
  els.tabs.addEventListener('keydown', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const buttons = $$('[data-tab]', els.tabs);
    const index = buttons.indexOf(button);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    const target = buttons[next];
    setActiveTab(target.getAttribute('data-tab'));
    target.focus();
  });
}

function selectedClipIds() {
  return [...state.selection];
}

function applyToSelectedVisuals(mutator) {
  store.apply((draft) => {
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        if (!state.selection.has(clip.id) || clip.locked) continue;
        if (clip.kind === 'audio') continue;
        mutator(clip, track, draft);
      }
    }
  });
}

function bindPanel() {
  if (!els.panel) return;
  els.panel.addEventListener('click', onPanelClick);
  els.panel.addEventListener('input', onPanelInput);
  els.panel.addEventListener('change', onPanelInput);
  els.panel.addEventListener('dragstart', onPanelDragStart);
  els.panel.addEventListener('dragover', onPanelDragOver);
  els.panel.addEventListener('dragleave', onPanelDragLeave);
  els.panel.addEventListener('drop', onPanelDrop);

  document.addEventListener('input', onGlobalRangeInput);
  document.addEventListener('change', onGlobalRangeInput);
}

function onGlobalRangeInput(event) {
  const el = event.target;
  if (!el || !el.matches || !el.matches('[data-track-volume]')) return;
  const trackId = el.getAttribute('data-track-id') || el.closest('[data-track-id]')?.getAttribute('data-track-id');
  if (!trackId) return;
  const value = clamp(num(el.value, 1), 0, 1.5);
  if (event.type === 'input') {
    store.begin();
    store.live((draft) => {
      const track = findTrack(draft, trackId);
      if (track) track.volume = value;
    });
  } else {
    store.end();
    renderLibraryIfRelevant(false);
  }
}

function onPanelClick(event) {
  const button = event.target.closest('button');
  if (button && button.hasAttribute('data-import')) {
    openMediaPicker();
    return;
  }
  if (button && button.hasAttribute('data-dismiss-error')) {
    state.importErrors = [];
    renderLibrary();
    return;
  }
  if (button && button.hasAttribute('data-media-action')) {
    const mediaId = button.getAttribute('data-media-id');
    const action = button.getAttribute('data-media-action');
    if (action === 'add') addAssetToTimeline(mediaId);
    else if (action === 'remove') removeMedia(mediaId);
    else if (action === 'replace') startReplaceWithAsset(mediaId);
    return;
  }
  if (button && button.hasAttribute('data-text-preset')) {
    addTextPreset(button.getAttribute('data-text-preset'));
    return;
  }
  if (button && button.hasAttribute('data-shape-type')) {
    addShapeClip(button.getAttribute('data-shape-type'));
    return;
  }
  if (button && button.hasAttribute('data-bg-type')) {
    addBackgroundClip(button.getAttribute('data-bg-type'));
    return;
  }
  if (button && button.hasAttribute('data-sticker')) {
    addSticker(button.getAttribute('data-sticker'));
    return;
  }
  if (button && button.hasAttribute('data-transition')) {
    setTransition(button.getAttribute('data-transition'));
    return;
  }
  if (button && button.hasAttribute('data-filter')) {
    setFilter(button.getAttribute('data-filter'));
    return;
  }
  if (button && button.hasAttribute('data-color-preset')) {
    setColorPreset(button.getAttribute('data-color-preset'));
    return;
  }
  if (button && button.hasAttribute('data-color-reset')) {
    resetColor();
    return;
  }
  if (button && button.hasAttribute('data-sub-action')) {
    handleSubtitleAction(button.getAttribute('data-sub-action'), button.getAttribute('data-sub-id'));
    return;
  }
  if (button && button.hasAttribute('data-layer-action')) {
    handleLayerAction(button.getAttribute('data-layer-action'), button.getAttribute('data-clip-id'));
    return;
  }
  if (button && button.hasAttribute('data-mix-action')) {
    handleMixAction(button.getAttribute('data-mix-action'), button.getAttribute('data-track-id'));
    return;
  }
  if (!button) {
    const card = event.target.closest('[data-media-id]');
    if (card && !event.target.closest('[data-layer-row]')) addAssetToTimeline(card.getAttribute('data-media-id'));
  }
}

function onPanelInput(event) {
  const el = event.target;
  if (!el || !el.matches) return;
  const live = event.type === 'input';

  if (el.matches('[data-master-volume]')) {
    const value = clamp(num(el.value, 1), 0, 1.5);
    const output = el.closest('label')?.querySelector('output');
    if (output) output.textContent = `${Math.round(value * 100)}%`;
    if (live) {
      store.begin();
      store.live((draft) => {
        draft.masterVolume = value;
      });
    } else {
      store.end({ reason: 'field' });
    }
    return;
  }

  if (el.matches('[data-transition-duration]')) {
    setTransitionDuration(num(el.value, 0.5), live);
    return;
  }
  if (el.matches('[data-transition-reverse]')) {
    setTransitionReverse(el.checked);
    return;
  }
  if (el.matches('[data-filter-intensity]')) {
    setFilterIntensity(num(el.value, 1), live);
    return;
  }
  if (el.matches('[data-anim]')) {
    setAnimation(el.getAttribute('data-anim'), el.value);
    return;
  }
  if (el.matches('[data-anim-duration]')) {
    setAnimationDuration(el.getAttribute('data-anim-duration'), num(el.value, 0.5), live);
    return;
  }
  if (el.matches('[data-sub-enabled]')) {
    store.apply((draft) => {
      draft.subtitles.enabled = el.checked;
    });
    schedulePreview();
    return;
  }
  if (el.matches('[data-sub-field]')) {
    const id = el.getAttribute('data-sub-id');
    const field = el.getAttribute('data-sub-field');
    const value = field === 'text' ? el.value : clamp(num(el.value, 0), 0, 86400);
    if (live) {
      store.begin();
      store.live((draft) => {
        const item = (draft.subtitles.items || []).find((entry) => entry.id === id);
        if (!item) return;
        item[field] = value;
        if (field === 'start' && item.end <= item.start) item.end = item.start + 0.3;
        if (field === 'end' && item.end <= item.start) item.end = item.start + 0.3;
      });
      schedulePreview();
    } else {
      store.end({ reason: 'field' });
    }
    return;
  }
  if (el.matches('[data-sub-style]')) {
    const field = el.getAttribute('data-sub-style');
    const value = el.type === 'checkbox'
      ? el.checked
      : el.type === 'number' || el.type === 'range'
        ? num(el.value, 0)
        : el.value;
    store.apply((draft) => {
      draft.subtitles.style = { ...draft.subtitles.style, [field]: value };
    });
    schedulePreview();
  }
}

function startReplaceWithAsset(mediaId) {
  const location = primaryLocation();
  if (!location) {
    toast('Select a clip in the timeline first, then use “Use” to replace its media.', 'warn');
    return;
  }
  if (location.clip.locked) {
    toast('This clip is locked. Unlock it before replacing its media.', 'warn');
    return;
  }
  const asset = media.get(mediaId);
  if (!asset) return;
  const compatible = asset.type === 'audio' ? 'audio' : 'video';
  if (location.track.kind !== compatible) {
    toast(`An ${asset.type} file cannot replace a clip on a ${location.track.kind} track.`, 'warn');
    return;
  }
  store.apply((draft) => {
    const current = findClip(draft, location.clip.id);
    if (!current) return;
    current.clip.mediaId = mediaId;
    current.clip.name = asset.name;
    current.clip.kind = asset.type === 'audio' ? 'audio' : asset.type === 'image' ? 'image' : 'video';
    current.clip.inPoint = 0;
    const sourceDuration = asset.type === 'image' ? current.clip.duration : Math.max(MIN_DURATION, asset.duration || current.clip.duration);
    current.clip.duration = Math.min(current.clip.duration, sourceDuration * Math.max(0.05, Number(current.clip.speed) || 1));
    current.clip.outPoint = current.clip.duration * Math.max(0.05, Number(current.clip.speed) || 1);
    current.clip.freeze = false;
    current.clip.freezeAt = null;
  });
  renderPropertiesPanel(true);
  schedulePreview();
  toast(`“${asset.name}” now feeds the selected clip.`, 'success');
}

function setTransition(type) {
  const targets = selectedLocations().filter(({ track, clip }) => track.kind === 'video' && clip.kind !== 'audio');
  if (!targets.length) {
    toast('Select a video, image, text or shape clip first.', 'warn');
    return;
  }
  if (type !== 'none') {
    const usable = targets.filter(({ track, clip }) => !clip.locked && previousClip(track, clip));
    if (!usable.length) {
      toast('A transition needs an earlier clip on the same track.', 'warn');
      return;
    }
  }
  store.apply((draft) => {
    for (const reference of targets) {
      const located = findClip(draft, reference.clip.id);
      if (!located || located.clip.locked) continue;
      const prev = previousClip(located.track, located.clip);
      if (type !== 'none' && !prev) continue;
      const maxDuration = prev ? Math.max(0.1, Math.min(5, prev.duration, located.clip.duration)) : 0.5;
      located.clip.transition = {
        type,
        duration: clamp(Number(located.clip.transition?.duration) || state.transitionDuration || 0.5, 0.1, maxDuration),
        reverse: Boolean(located.clip.transition?.reverse)
      };
    }
  });
  state.transitionDuration = Number(primaryLocation()?.clip.transition?.duration) || state.transitionDuration;
  renderLibrary();
  schedulePreview();
  toast(type === 'none' ? 'Transition removed.' : `${transitionLabel(type)} applied.`, 'success');
}

function setTransitionDuration(value, live) {
  state.transitionDuration = value;
  const mutate = (draft) => {
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        if (!state.selection.has(clip.id) || clip.locked) continue;
        const prev = previousClip(track, clip);
        const max = prev ? Math.max(0.1, Math.min(5, prev.duration, clip.duration)) : 0.5;
        clip.transition.duration = clamp(value, 0.1, max);
      }
    }
  };
  if (live) {
    store.begin();
    store.live(mutate);
    const output = els.panel.querySelector('[data-transition-duration]')?.closest('label')?.querySelector('output');
    if (output) output.textContent = `${Number(value).toFixed(2)} s`;
  } else {
    store.apply(mutate);
    renderLibrary();
  }
  schedulePreview();
}

function setTransitionReverse(checked) {
  store.apply((draft) => {
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        if (!state.selection.has(clip.id) || clip.locked) continue;
        clip.transition.reverse = Boolean(checked);
      }
    }
  });
  schedulePreview();
}

function setFilter(filterId) {
  const targets = selectedLocations().filter(({ clip }) => clip.kind !== 'audio' && !clip.locked);
  if (!targets.length) {
    toast('Select a visual clip first.', 'warn');
    return;
  }
  store.apply((draft) => {
    for (const reference of targets) {
      const located = findClip(draft, reference.clip.id);
      if (!located) continue;
      located.clip.filter = filterId;
      if (filterId !== 'none' && !(located.clip.filterIntensity > 0)) located.clip.filterIntensity = 1;
    }
  });
  renderLibrary();
  schedulePreview();
  toast(filterId === 'none' ? 'Filter removed.' : 'Filter applied.', 'success');
}

function setFilterIntensity(value, live) {
  const mutate = (draft) => {
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        if (!state.selection.has(clip.id) || clip.locked || clip.kind === 'audio') continue;
        clip.filterIntensity = clamp(value, 0, 1);
      }
    }
  };
  if (live) {
    store.begin();
    store.live(mutate);
    const output = els.panel.querySelector('[data-filter-intensity]')?.closest('label')?.querySelector('output');
    if (output) output.textContent = `${Math.round(value * 100)}%`;
  } else {
    store.apply(mutate);
  }
  schedulePreview();
}

const COLOR_KEYS = ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'exposure', 'highlights', 'shadows', 'gamma', 'sharpness', 'fade', 'vignette'];

function setColorPreset(id) {
  const preset = COLOR_PRESETS.find((item) => item.id === id);
  if (!preset) return;
  applyToSelectedVisuals((clip) => {
    const color = {};
    for (const key of COLOR_KEYS) color[key] = Number(preset.values[key]) || 0;
    clip.color = color;
  });
  renderLibrary();
  renderPropertiesPanel(true);
  schedulePreview();
  toast(`${preset.label} colour applied.`, 'success');
}

function resetColor() {
  applyToSelectedVisuals((clip) => {
    const color = {};
    for (const key of COLOR_KEYS) color[key] = 0;
    clip.color = color;
  });
  renderLibrary();
  renderPropertiesPanel(true);
  schedulePreview();
}

function setAnimation(slot, type) {
  const key = slot === 'out' ? 'outAnim' : 'inAnim';
  applyToSelectedVisuals((clip) => {
    clip[key].type = type;
    clip[key].duration = clamp(Number(clip[key].duration) || 0.5, 0.1, Math.max(0.1, clip.duration));
  });
  renderLibrary();
  renderPropertiesPanel(true);
  schedulePreview();
}

function setAnimationDuration(slot, value, live) {
  const key = slot === 'out' ? 'outAnim' : 'inAnim';
  const mutate = (draft) => {
    for (const track of draft.tracks) {
      for (const clip of track.clips) {
        if (!state.selection.has(clip.id) || clip.locked || clip.kind === 'audio') continue;
        clip[key].duration = clamp(value, 0.1, Math.max(0.1, clip.duration));
      }
    }
  };
  if (live) {
    store.begin();
    store.live(mutate);
  } else {
    store.apply(mutate);
  }
  schedulePreview();
}

function handleLayerAction(action, clipId) {
  if (action === 'add-track') {
    addTrack('video');
    return;
  }
  if (!clipId) return;
  if (action === 'select') {
    selectClip(clipId, { additive: false });
    timeline?.scrollToTime(primaryLocation()?.clip.start || 0);
    return;
  }
  if (action === 'delete') {
    state.selection.clear();
    state.selection.add(clipId);
    deleteSelection();
    return;
  }
  if (action === 'up' || action === 'down' || action === 'front' || action === 'back') {
    stackClip(clipId, action);
    return;
  }
  const located = findClip(project(), clipId);
  if (!located) return;
  if (action === 'hide' || action === 'lock') {
    store.apply((draft) => {
      const current = findClip(draft, clipId);
      if (!current) return;
      if (action === 'hide') current.clip.hidden = !current.clip.hidden;
      else current.clip.locked = !current.clip.locked;
    });
    renderPropertiesPanel(true);
    schedulePreview();
  }
}

function handleMixAction(action, trackId) {
  if (action === 'add-track') {
    addTrack('audio');
    return;
  }
  if (action === 'mute' && trackId) {
    store.apply((draft) => {
      const track = findTrack(draft, trackId);
      if (track) track.muted = !track.muted;
    });
  }
}

/* Layer and media drag and drop ------------------------------------------ */

function onPanelDragStart(event) {
  const layer = event.target.closest('[data-layer-row]');
  if (layer) {
    event.dataTransfer.setData('application/x-letitedit-layer', layer.getAttribute('data-clip-id'));
    event.dataTransfer.effectAllowed = 'move';
    layer.classList.add('is-dragging');
    return;
  }
  const card = event.target.closest('[data-media-id]');
  if (card) {
    event.dataTransfer.setData('application/x-letitedit-media', card.getAttribute('data-media-id'));
    event.dataTransfer.setData('text/plain', card.getAttribute('data-media-id'));
    event.dataTransfer.effectAllowed = 'copy';
  }
}

function onPanelDragOver(event) {
  const row = event.target.closest('[data-layer-row]');
  if (!row) return;
  const types = event.dataTransfer ? [...event.dataTransfer.types] : [];
  if (!types.includes('application/x-letitedit-layer') && !types.includes('application/x-letitedit-media')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = types.includes('application/x-letitedit-media') ? 'copy' : 'move';
  row.classList.add('is-drop-target');
}

function onPanelDragLeave(event) {
  const row = event.target.closest('[data-layer-row]');
  if (row && !row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
}

function onPanelDrop(event) {
  const row = event.target.closest('[data-layer-row]');
  if (!row) return;
  const clipId = event.dataTransfer?.getData('application/x-letitedit-layer');
  const mediaId = event.dataTransfer?.getData('application/x-letitedit-media');
  const targetTrackId = row.getAttribute('data-track-id');
  row.classList.remove('is-drop-target');
  if (mediaId) {
    event.preventDefault();
    addAssetToTimeline(mediaId, { trackId: targetTrackId });
    return;
  }
  if (!clipId) return;
  event.preventDefault();
  const located = findClip(project(), clipId);
  const target = findTrack(project(), targetTrackId);
  if (!located || !target) return;
  if (located.track.id === target.id) return;
  if (target.locked || located.clip.locked) {
    toast('Unlock the clip or track before moving it.', 'warn');
    return;
  }
  if (target.kind !== (located.clip.kind === 'audio' ? 'audio' : 'video')) {
    toast('That layer holds a different kind of clip.', 'warn');
    return;
  }
  if (overlapAt(target, located.clip.start, located.clip.duration, clipId)) {
    toast(`${target.name} already has a clip at that time. Move the clip on the timeline first.`, 'warn');
    return;
  }
  const moved = store.apply((draft) => moveClipToTrack(draft, clipId, target.id, located.clip.start));
  if (moved) {
    toast(`Moved “${located.clip.name || located.clip.kind}” to ${target.name}.`, 'success');
    timeline?.render();
    schedulePreview();
  } else {
    toast('There is no room on that layer at the same time.', 'warn');
  }
}

/* -------------------------------------------------------------------------
 * Properties bindings
 * ---------------------------------------------------------------------- */

function bindProperties() {
  if (!els.propsBody) return;
  els.propsBody.addEventListener('click', onPropsClick);
  els.propsBody.addEventListener('input', onPropsInput);
  els.propsBody.addEventListener('change', onPropsInput);
}

function readControlValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.type === 'number') return num(el.value, 0);
  return el.value;
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let cursor = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function previousOnTrack(track, clip) {
  return track.clips
    .filter((item) => item.id !== clip.id && item.start >= clip.start - 1e-4)
    .sort((a, b) => a.start - b.start)[0] || null;
}

function setClipDuration(clip, track, requested) {
  const next = previousOnTrack(track, clip);
  const limit = next ? Math.max(MIN_DURATION, next.start - clip.start) : Infinity;
  const duration = clamp(Number(requested) || MIN_DURATION, MIN_DURATION, limit);
  const speed = Math.max(0.05, Number(clip.speed) || 1);
  const inPoint = Number(clip.inPoint) || 0;
  const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : inPoint + clip.duration * speed;
  clip.duration = duration;
  if (!clip.freeze && (clip.kind === 'video' || clip.kind === 'audio')) {
    if (clip.reverse) clip.inPoint = Math.max(0, outPoint - duration * speed);
    else clip.outPoint = inPoint + duration * speed;
  }
  if (clip.fadeIn > duration) clip.fadeIn = duration;
  if (clip.fadeOut > duration) clip.fadeOut = duration;
  return duration;
}

function setClipProperty(clip, track, path, value) {
  if (path === 'name') {
    clip.name = String(value).slice(0, 80);
    return;
  }
  if (path === 'speed') {
    const oldSpeed = Math.max(0.05, Number(clip.speed) || 1);
    const newSpeed = clamp(Number(value) || 1, 0.1, 4);
    if (!clip.freeze && Math.abs(newSpeed - oldSpeed) > 1e-4) {
      const span = clip.duration * oldSpeed;
      const inPoint = Number(clip.inPoint) || 0;
      const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : inPoint + span;
      const duration = setClipDuration(clip, track, span / newSpeed);
      if (clip.reverse) clip.outPoint = Math.min(outPoint, inPoint + span);
      else clip.outPoint = Math.min(outPoint, inPoint + duration * newSpeed);
    }
    clip.speed = newSpeed;
    return;
  }
  if (path === 'transition.type') {
    const prev = previousClip(track, clip);
    if (value !== 'none' && !prev) {
      toast('Add an earlier clip on this track before choosing a transition.', 'warn');
      return;
    }
    const maxDuration = prev ? Math.max(0.1, Math.min(5, prev.duration, clip.duration)) : 0.5;
    clip.transition = {
      type: value,
      duration: clamp(Number(clip.transition?.duration) || 0.5, 0.1, maxDuration),
      reverse: Boolean(clip.transition?.reverse)
    };
    return;
  }
  if (path === 'transition.duration') {
    const prev = previousClip(track, clip);
    const max = prev ? Math.max(0.1, Math.min(5, prev.duration, clip.duration)) : 0.5;
    clip.transition.duration = clamp(Number(value) || 0.5, 0.1, max);
    return;
  }
  if (path === 'inAnim.duration' || path === 'outAnim.duration') {
    const key = path.startsWith('in') ? 'inAnim' : 'outAnim';
    clip[key].duration = clamp(Number(value) || 0.5, 0.1, Math.max(0.1, clip.duration));
    return;
  }
  if (path === 'fadeIn' || path === 'fadeOut') {
    clip[path] = clamp(Number(value) || 0, 0, Math.min(5, clip.duration));
    return;
  }
  if (path === 'muted' || path === 'reverse' || path === 'flipH' || path === 'flipV' || path === 'filterIntensity') {
    clip[path] = path === 'filterIntensity' ? clamp(Number(value) || 0, 0, 1) : Boolean(value);
    return;
  }
  /* Transform controls write a keyframe at the playhead when that property is
   * already animated, matching what dragging the clip in the preview does. */
  if (path === 'x' || path === 'y' || path === 'scale' || path === 'rotation' || path === 'opacity') {
    const local = state.playhead - clip.start;
    if (local >= -1e-4 && local <= clip.duration + 1e-4) {
      writeAnimated(clip, path, Number(value), clamp(local, 0, clip.duration));
      return;
    }
  }
  setPath(clip, path, value);
}

function onPropsClick(event) {
  const button = event.target.closest('button');
  if (!button) return;

  const propAction = button.getAttribute('data-prop-action');
  if (propAction) {
    event.preventDefault();
    runPropAction(propAction);
    return;
  }

  const projectAction = button.getAttribute('data-project-action');
  if (projectAction) {
    event.preventDefault();
    if (projectAction === 'dialog') openProjectDialog();
    else if (projectAction === 'save') saveProjectFile();
    else if (projectAction === 'open' && els.openInput) {
      els.openInput.value = '';
      els.openInput.click();
    }
    return;
  }

  if (button.hasAttribute('data-nudge')) {
    event.preventDefault();
    nudgeClip(button.getAttribute('data-nudge'), num(button.getAttribute('data-delta'), 0));
    return;
  }

  const keyProp = button.getAttribute('data-keyframe');
  if (keyProp) {
    event.preventDefault();
    addKeyframe(keyProp);
    return;
  }
  const clearProp = button.getAttribute('data-keyframe-clear');
  if (clearProp) {
    event.preventDefault();
    clearKeyframes(clearProp);
    return;
  }
  if (button.hasAttribute('data-layer-up')) {
    /* handled by data-prop-action above */
  }
}

function onPropsInput(event) {
  const el = event.target;
  if (!el || !el.matches) return;
  const live = event.type === 'input';

  if (el.matches('[data-key-ease]')) {
    state.keyEase = el.value;
    return;
  }

  if (el.matches('[data-clip-track]')) {
    if (live) return;
    moveSelectedClipToTrack(el.value);
    return;
  }

  if (el.matches('[data-timing]')) {
    handleTimingInput(el, live);
    return;
  }

  if (el.matches('[data-project-prop]')) {
    if (live && el.type !== 'range') return;
    handleProjectProp(el, live);
    return;
  }

  if (el.matches('[data-prop]')) {
    const location = primaryLocation();
    const path = el.getAttribute('data-prop');
    if (!location) return;
    if (location.clip.locked) {
      toast('Unlock this clip before editing it.', 'warn');
      renderPropertiesPanel(true);
      return;
    }
    const value = readControlValue(el);
    if (live && (el.type === 'range' || el.type === 'color' || el.type === 'text' || el.tagName === 'TEXTAREA')) {
      store.begin();
      store.live((draft) => {
        const current = findClip(draft, location.clip.id);
        if (current) setClipProperty(current.clip, current.track, path, value);
      });
      const output = el.closest('label')?.querySelector('output');
      if (output && el.type === 'range') {
        const suffix = output.getAttribute('data-suffix') || '';
        output.textContent = `${value}${suffix}`;
      }
    } else if (live && el.type === 'number') {
      store.begin();
      store.live((draft) => {
        const current = findClip(draft, location.clip.id);
        if (current) setClipProperty(current.clip, current.track, path, value);
      });
    } else {
      /* text, textarea and number fields commit when they blur. If the blur
       * was caused by pressing another control, rebuilding the panel now would
       * replace that control before its click event fires. */
      const deferred = el.type === 'text' || el.type === 'textarea' || el.type === 'number';
      store.end({ reason: deferred ? 'field' : undefined });
      store.apply((draft) => {
        const current = findClip(draft, location.clip.id);
        if (current) setClipProperty(current.clip, current.track, path, value);
      }, { reason: deferred ? 'field' : 'apply' });
      if (!deferred && (path === 'filter' || path === 'speed' || path === 'transition.type')) {
        renderPropertiesPanel(true);
        renderLibraryIfRelevant(true);
      }
      if (path === 'text.font' || path === 'text.size') schedulePreview();
    }
    return;
  }
}

function handleTimingInput(el, live) {
  const location = primaryLocation();
  if (!location) return;
  if (location.clip.locked) {
    toast('This clip is locked.', 'warn');
    return;
  }
  const field = el.getAttribute('data-timing');
  const value = num(el.value, 0);
  const mutate = (draft) => {
    const current = findClip(draft, location.clip.id);
    if (!current) return;
    if (field === 'start') {
      const start = Math.max(0, value);
      if (overlapAt(current.track, start, current.clip.duration, current.clip.id)) return;
      current.clip.start = start;
      sortTrack(current.track);
    } else {
      setClipDuration(current.clip, current.track, value);
    }
  };
  if (live) {
    store.begin();
    store.live(mutate);
  } else {
    store.apply(mutate, { reason: 'field' });
  }
}

function nudgeClip(field, delta) {
  const location = primaryLocation();
  if (!location) return;
  if (location.clip.locked) {
    toast('This clip is locked.', 'warn');
    return;
  }
  let blocked = false;
  store.apply((draft) => {
    const current = findClip(draft, location.clip.id);
    if (!current) return;
    if (field === 'start') {
      const start = Math.max(0, current.clip.start + delta);
      if (overlapAt(current.track, start, current.clip.duration, current.clip.id)) {
        blocked = true;
        return;
      }
      current.clip.start = start;
      sortTrack(current.track);
    } else {
      setClipDuration(current.clip, current.track, current.clip.duration + delta);
    }
  });
  if (blocked) toast('That move would overlap another clip on this track.', 'warn');
  renderPropertiesPanel(true);
}

function moveSelectedClipToTrack(trackId) {
  const location = primaryLocation();
  if (!location) return;
  const target = findTrack(project(), trackId);
  if (!target) return;
  if (target.id === location.track.id) return;
  if (target.locked) {
    toast(`${target.name} is locked.`, 'warn');
    renderPropertiesPanel(true);
    return;
  }
  if (overlapAt(target, location.clip.start, location.clip.duration, location.clip.id)) {
    toast(`${target.name} already has a clip at that time.`, 'warn');
    renderPropertiesPanel(true);
    return;
  }
  const moved = store.apply((draft) => moveClipToTrack(draft, location.clip.id, trackId, location.clip.start));
  if (!moved) {
    toast('There is no space on that track at this time.', 'warn');
    renderPropertiesPanel(true);
    return;
  }
  toast(`Moved to ${target.name}.`, 'success');
  timeline?.render();
  schedulePreview();
}

function runPropAction(action) {
  const location = primaryLocation();
  if (action === 'delete-many') {
    deleteSelection();
    return;
  }
  if (action === 'duplicate-many') {
    duplicateSelection();
    return;
  }
  if (!location) return;
  const { track, clip } = location;

  if (action === 'split') {
    splitAtPlayhead();
    return;
  }
  if (action === 'duplicate') {
    duplicateSelection();
    return;
  }
  if (action === 'delete') {
    deleteSelection();
    return;
  }
  if (action === 'layer-up' || action === 'layer-down') {
    stackClip(clip.id, action === 'layer-up' ? 'up' : 'down');
    return;
  }
  if (action === 'toggle-hide') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (current) current.clip.hidden = !current.clip.hidden;
    });
    renderPropertiesPanel(true);
    schedulePreview();
    return;
  }
  if (action === 'toggle-lock') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (current) current.clip.locked = !current.clip.locked;
    });
    renderPropertiesPanel(true);
    return;
  }
  if (clip.locked) {
    toast('This clip is locked. Unlock it first.', 'warn');
    return;
  }
  if (action === 'reset-transform') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (!current) return;
      current.clip.x = 0.5;
      current.clip.y = 0.5;
      current.clip.scale = 1;
      current.clip.rotation = 0;
      current.clip.opacity = 1;
      current.clip.flipH = false;
      current.clip.flipV = false;
    });
    renderPropertiesPanel(true);
    schedulePreview();
    return;
  }
  if (action === 'reset-crop') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (current) current.clip.crop = { top: 0, right: 0, bottom: 0, left: 0 };
    });
    renderPropertiesPanel(true);
    schedulePreview();
    return;
  }
  if (action === 'reset-color') {
    resetColor();
    return;
  }
  if (action === 'clear-keys') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (!current) return;
      current.clip.keyframes = { x: [], y: [], scale: [], rotation: [], opacity: [] };
    });
    renderPropertiesPanel(true);
    schedulePreview();
    return;
  }
  if (action === 'replace') {
    state.replaceTargetId = clip.id;
    const input = els.replaceInput;
    if (input) {
      input.value = '';
      input.click();
    }
    return;
  }
  if (action === 'unlink') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (current) {
        current.clip.mediaId = null;
        current.clip.freeze = false;
        current.clip.freezeAt = null;
      }
    });
    renderPropertiesPanel(true);
    schedulePreview();
    return;
  }
  if (action === 'freeze' || action === 'unfreeze') {
    store.apply((draft) => {
      const current = findClip(draft, clip.id);
      if (!current) return;
      if (action === 'unfreeze') {
        current.clip.freeze = false;
        current.clip.freezeAt = null;
      } else {
        const local = clamp(state.playhead - current.clip.start, 0, current.clip.duration);
        let sourceTime = clipSourceTime(current.clip, local);
        const asset = current.clip.mediaId ? media.get(current.clip.mediaId) : null;
        if (asset && Number.isFinite(asset.duration)) sourceTime = clamp(sourceTime, 0, asset.duration);
        current.clip.freeze = true;
        current.clip.freezeAt = sourceTime;
      }
    });
    renderPropertiesPanel(true);
    schedulePreview();
  }
}

function addKeyframe(prop) {
  const location = primaryLocation();
  if (!location) return;
  const { clip } = location;
  if (clip.locked) return;
  const local = clamp(state.playhead - clip.start, 0, clip.duration);
  if (state.playhead < clip.start - 1e-4 || state.playhead > clipEnd(clip) + 1e-4) {
    toast('Move the playhead over this clip to add a keyframe.', 'warn');
    return;
  }
  const resolved = resolveTransform(clip, local);
  const value = Number.isFinite(resolved[prop])
    ? resolved[prop]
    : Number(clip[prop]) || (prop === 'opacity' || prop === 'scale' ? 1 : prop === 'rotation' ? 0 : 0.5);
  store.apply((draft) => {
    const current = findClip(draft, clip.id);
    if (!current) return;
    const list = current.clip.keyframes[prop] || (current.clip.keyframes[prop] = []);
    const rounded = Math.round(local * 1000) / 1000;
    const existing = list.find((item) => Math.abs(item.t - rounded) < 0.02);
    if (existing) {
      existing.v = value;
      existing.ease = state.keyEase;
    } else {
      list.push({ t: rounded, v: value, ease: state.keyEase });
      list.sort((a, b) => a.t - b.t);
    }
  });
  renderPropertiesPanel(true);
  schedulePreview();
  toast(`Keyframe added for ${prop}.`, 'success');
}

function clearKeyframes(prop) {
  const location = primaryLocation();
  if (!location) return;
  store.apply((draft) => {
    const current = findClip(draft, location.clip.id);
    if (current && current.clip.keyframes) current.clip.keyframes[prop] = [];
  });
  renderPropertiesPanel(true);
  schedulePreview();
}

function handleProjectProp(el, live) {
  const key = el.getAttribute('data-project-prop');
  const value = readControlValue(el);
  const mutate = (draft) => {
    if (key === 'name') draft.name = String(value).slice(0, 80);
    else if (key === 'aspect') draft.aspect = String(value);
    else if (key === 'resolution') draft.resolution = String(value);
    else if (key === 'fps') draft.fps = clamp(Math.round(num(value, 30)), 1, 120);
    else if (key === 'background') draft.background = String(value);
    else if (key === 'masterVolume') draft.masterVolume = clamp(num(value, 1), 0, 1.5);
    else if (key === 'customWidth') draft.customWidth = clamp(Math.round(num(value, 1920)), 16, 4096);
    else if (key === 'customHeight') draft.customHeight = clamp(Math.round(num(value, 1080)), 16, 4096);
    else if (key === 'customAspectW') draft.customAspectW = clamp(Math.round(num(value, 16)), 1, 100);
    else if (key === 'customAspectH') draft.customAspectH = clamp(Math.round(num(value, 9)), 1, 100);
  };
  if (live && el.type === 'range') {
    store.begin();
    store.live(mutate);
  } else {
    store.end();
    store.apply(mutate);
    if (key === 'aspect' || key === 'resolution' || key === 'customWidth' || key === 'customHeight' || key === 'customAspectW' || key === 'customAspectH') {
      updatePreviewSize();
      updateProjectMeta();
      schedulePreview();
      renderPropertiesPanel(true);
      renderLibraryIfRelevant(true);
    }
  }
}

/* Subtitles --------------------------------------------------------------- */

function addSubtitle() {
  const start = Math.max(0, state.playhead);
  const item = {
    id: uid('sub'),
    start: Math.round(start * 100) / 100,
    end: Math.round((start + 3) * 100) / 100,
    text: 'New subtitle'
  };
  store.apply((draft) => {
    draft.subtitles = draft.subtitles || { enabled: true, style: defaultSubtitleStyle(), items: [] };
    draft.subtitles.enabled = true;
    draft.subtitles.items.push(item);
  });
  state.selectedSubtitleId = item.id;
  setActiveTab('subtitles');
  schedulePreview();
  toast('Subtitle added at the playhead. Edit its text in the list.', 'success');
}

function handleSubtitleAction(action, id) {
  if (action === 'add') {
    addSubtitle();
    return;
  }
  if (action === 'import') {
    if (els.subtitleInput) {
      els.subtitleInput.value = '';
      els.subtitleInput.click();
    }
    return;
  }
  if (action === 'delete' && id) {
    store.apply((draft) => {
      draft.subtitles.items = (draft.subtitles.items || []).filter((item) => item.id !== id);
    });
    if (state.selectedSubtitleId === id) state.selectedSubtitleId = null;
    renderLibrary();
    schedulePreview();
    return;
  }
  if (action === 'export-srt' || action === 'export-vtt') {
    exportSubtitles(action === 'export-srt' ? 'srt' : 'vtt');
  }
}

async function importSubtitleFile(file) {
  try {
    const text = await file.text();
    const extension = (file.name.split('.').pop() || 'srt').toLowerCase();
    const entries = parseSubtitleFile(text, extension);
    if (!entries.length) {
      toast('No subtitle cues were found in that file. Check that it is a valid SRT or WebVTT file.', 'error', 7000);
      return;
    }
    store.apply((draft) => {
      draft.subtitles = draft.subtitles || { enabled: true, style: defaultSubtitleStyle(), items: [] };
      draft.subtitles.enabled = true;
      draft.subtitles.items = [...(draft.subtitles.items || []), ...entries];
    });
    setActiveTab('subtitles');
    schedulePreview();
    toast(`Imported ${entries.length} subtitle cue${entries.length === 1 ? '' : 's'} from ${file.name}.`, 'success');
  } catch (error) {
    toast(`The subtitle file could not be read: ${error.message || error}`, 'error', 7000);
  }
}

function exportSubtitles(format) {
  const items = project().subtitles?.items || [];
  if (!items.length) {
    toast('There are no subtitles to download yet.', 'warn');
    return;
  }
  const text = format === 'vtt' ? toVtt(items) : toSrt(items);
  const blob = new Blob([text], { type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip' });
  downloadBlob(blob, `${sanitizeFilename(project().name, 'subtitles')}.${format}`);
  toast(`${format.toUpperCase()} file downloaded.`, 'success');
}

/* -------------------------------------------------------------------------
 * Transport and preview interactions
 * ---------------------------------------------------------------------- */

function bindTransport() {
  els.play?.addEventListener('click', () => {
    if (state.playing) pause();
    else play();
  });
  els.prevFrame?.addEventListener('click', () => stepFrame(-1));
  els.nextFrame?.addEventListener('click', () => stepFrame(1));
  els.scrub?.addEventListener('input', () => {
    pause();
    seek(num(els.scrub.value, 0));
  });
  els.previewRate?.addEventListener('change', () => {
    state.previewRate = clamp(num(els.previewRate.value, 1), 0.1, 4);
  });
}

function bindPreviewInteractions() {
  if (!els.previewCanvas) return;
  els.previewCanvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    handlePreviewPointer(event);
  });
  els.previewCanvas.addEventListener('dblclick', () => {
    if (els.fullscreen) els.fullscreen.click();
  });
}

/* -------------------------------------------------------------------------
 * Global drag and drop and keyboard
 * ---------------------------------------------------------------------- */

function bindGlobalDragDrop() {
  let dragDepth = 0;
  const isFileDrag = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return;
    dragDepth += 1;
    if (els.dropveil) els.dropveil.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (els.dropveil) els.dropveil.hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && els.dropveil) els.dropveil.hidden = true;
  });
  window.addEventListener('drop', async (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    if (els.dropveil) els.dropveil.hidden = true;
    const files = [...(event.dataTransfer.files || [])];
    if (files.length) await importFiles(files);
  });
}

function selectAllClips() {
  state.selection.clear();
  for (const track of project().tracks) {
    for (const clip of track.clips) state.selection.add(clip.id);
  }
  updateSelectionClasses();
  renderPropertiesPanel(true);
  updateSelectionCount();
}

function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    if (isTypingTarget(event.target)) return;
    const inClip = event.target.closest?.('[data-clip-id]');
    if (inClip && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Enter', ' '].includes(event.key)) return;

    const meta = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (meta && key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (meta && key.toLowerCase() === 'y') {
      event.preventDefault();
      store.redo();
      return;
    }
    if (meta && key.toLowerCase() === 's') {
      event.preventDefault();
      saveProjectFile();
      return;
    }
    if (meta && key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (meta && key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllClips();
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      if (state.playing) pause();
      else play();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (key === 's' || key === 'S') {
      splitAtPlayhead();
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      stepFrame(-1);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      stepFrame(1);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      seek(0);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      seek(projectDuration(project()));
      return;
    }
    if (key === 'Escape') {
      selectNone();
      return;
    }
    if (key === '+' || key === '=') {
      timeline?.zoomBy(1.25);
      return;
    }
    if (key === '-') {
      timeline?.zoomBy(0.8);
    }
  });

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-mobile-close]');
    if (close) {
      state.mobilePanel = 'none';
      updateMobilePanel();
    }
  });
}

/* -------------------------------------------------------------------------
 * Project settings dialog
 * ---------------------------------------------------------------------- */

function openProjectDialog() {
  if (!els.projectDialog) return;
  const current = project();
  els.pdName.value = current.name;
  els.pdAspect.value = current.aspect;
  els.pdResolution.value = current.resolution;
  els.pdFps.value = String(current.fps);
  els.pdWidth.value = String(current.customWidth);
  els.pdHeight.value = String(current.customHeight);
  els.pdAspectW.value = String(current.customAspectW);
  els.pdAspectH.value = String(current.customAspectH);
  els.pdBackground.value = current.background || '#000000';
  els.pdVolume.value = String(current.masterVolume ?? 1);
  toggleProjectDialogCustom();
  els.projectDialog.showModal();
}

function toggleProjectDialogCustom() {
  if (!els.projectDialog) return;
  if (els.pdCustomWrap) els.pdCustomWrap.hidden = els.pdResolution.value !== 'custom';
  if (els.pdAspectWrap) els.pdAspectWrap.hidden = els.pdAspect.value !== 'custom';
}

function applyProjectDialog(event) {
  event.preventDefault();
  const data = {
    name: els.pdName.value.trim().slice(0, 80) || 'Untitled project',
    aspect: els.pdAspect.value,
    resolution: els.pdResolution.value,
    fps: clamp(Math.round(num(els.pdFps.value, 30)), 1, 120),
    customWidth: clamp(Math.round(num(els.pdWidth.value, 1920)), 16, 4096),
    customHeight: clamp(Math.round(num(els.pdHeight.value, 1080)), 16, 4096),
    customAspectW: clamp(Math.round(num(els.pdAspectW.value, 16)), 1, 100),
    customAspectH: clamp(Math.round(num(els.pdAspectH.value, 9)), 1, 100),
    background: els.pdBackground.value,
    masterVolume: clamp(num(els.pdVolume.value, 1), 0, 1.5)
  };
  store.apply((draft) => Object.assign(draft, data));
  els.projectDialog.close();
  updatePreviewSize();
  updateProjectMeta();
  updateToolbar();
  renderPropertiesPanel(true);
  renderLibraryIfRelevant(true);
  schedulePreview();
  toast('Project settings updated.', 'success');
}

function clearProjectContent() {
  if (!window.confirm('Clear every clip, subtitle and shape from this project? Imported media stays in the library and undo is available.')) return;
  store.apply((draft) => {
    for (const track of draft.tracks) track.clips = [];
    draft.subtitles.items = [];
  });
  state.selection.clear();
  state.selectedSubtitleId = null;
  state.playhead = 0;
  pause();
  updateSelectionClasses();
  renderPropertiesPanel(true);
  renderLibraryIfRelevant(true);
  updateTransport();
  timeline?.render();
  schedulePreview();
  toast('Timeline cleared.', 'info');
}

/* -------------------------------------------------------------------------
 * Export dialog and real export pipeline
 * ---------------------------------------------------------------------- */

const QUALITY_BPP = { high: 0.16, balanced: 0.1, small: 0.06 };

function fillExportSelects() {
  if (els.exportFormat) {
    els.exportFormat.innerHTML = EXPORT_FORMATS.map((format) => `<option value="${format.id}">${format.label} — ${format.detail}</option>`).join('');
  }
  if (els.exportQuality) {
    els.exportQuality.innerHTML = EXPORT_QUALITIES.map((quality) => `<option value="${quality.id}">${quality.label} — ${quality.detail}</option>`).join('');
  }
  if (els.exportResolution) {
    const options = [{ id: 'project', label: `Match project (${project().resolution === 'custom' ? 'custom' : `${project().resolution}p`})` }]
      .concat(RESOLUTIONS.map((resolution) => ({ id: resolution.id, label: resolution.label })));
    els.exportResolution.innerHTML = options.map((option) => `<option value="${option.id}">${option.label}</option>`).join('');
  }
  if (els.exportAspect) {
    const options = [{ id: 'project', label: 'Match project' }].concat(ASPECTS.map((aspect) => ({ id: aspect.id, label: aspect.label })));
    els.exportAspect.innerHTML = options.map((option) => `<option value="${option.id}">${option.label}</option>`).join('');
  }
}

function exportDimensions(settings = state.exportSettings) {
  let ratio = projectAspectValue(project());
  if (settings.aspect === 'custom') ratio = clamp(num(settings.customAspectW, 16), 1, 100) / clamp(num(settings.customAspectH, 9), 1, 100);
  else if (settings.aspect && settings.aspect !== 'project') ratio = aspectRatio(settings.aspect);
  if (settings.resolution === 'project') {
    const dims = projectDimensions(project());
    if (settings.aspect === 'project') return { width: dims.width, height: dims.height };
    return dimsForResolution(project().resolution, ratio, project().customWidth, project().customHeight);
  }
  return dimsForResolution(settings.resolution, ratio, settings.customWidth, settings.customHeight);
}

function readExportSettings() {
  const settings = state.exportSettings;
  if (els.exportFormat) settings.format = els.exportFormat.value;
  if (els.exportQuality) settings.quality = els.exportQuality.value;
  if (els.exportResolution) settings.resolution = els.exportResolution.value;
  if (els.exportAspect) settings.aspect = els.exportAspect.value;
  if (els.exportWidth) settings.customWidth = clamp(Math.round(num(els.exportWidth.value, 1920)), 16, 4096);
  if (els.exportHeight) settings.customHeight = clamp(Math.round(num(els.exportHeight.value, 1080)), 16, 4096);
  if (els.exportAspectW) settings.customAspectW = clamp(Math.round(num(els.exportAspectW.value, 16)), 1, 100);
  if (els.exportAspectH) settings.customAspectH = clamp(Math.round(num(els.exportAspectH.value, 9)), 1, 100);
  return settings;
}

function updateExportForm() {
  const settings = readExportSettings();
  if (els.exportCustom) els.exportCustom.hidden = settings.resolution !== 'custom';
  if (els.exportAspectCustom) els.exportAspectCustom.hidden = settings.aspect !== 'custom';
  const dims = exportDimensions(settings);
  const duration = projectDuration(project());
  const fps = Math.max(1, num(project().fps, 30));
  const format = EXPORT_FORMATS.find((item) => item.id === settings.format) || EXPORT_FORMATS[0];
  const quality = settings.quality in QUALITY_BPP ? QUALITY_BPP[settings.quality] : QUALITY_BPP.balanced;
  const bitrate = clamp(dims.width * dims.height * fps * quality, 400000, 45000000);
  const bytes = (bitrate / 8) * Math.max(0.1, duration) + 14000 * duration;
  if (els.exportSummary) {
    els.exportSummary.textContent = `${dims.width} × ${dims.height} · ${fps} fps · ${formatClock(duration)} · ${format.label}`;
  }
  if (els.exportEstimate) {
    els.exportEstimate.textContent = `About ${formatBytes(bytes)} (estimate). ${Math.max(1, Math.ceil(duration * fps))} frames will be composed and encoded on this device.`;
  }
  if (els.exportNote) {
    els.exportNote.textContent = !appSupport.encoder
      ? 'This browser does not expose the WebCodecs video encoder, so exporting is unavailable here. Editing still works. Try a current Chrome or Edge release.'
      : !appSupport.audioEncoder
        ? 'This browser can encode video but not audio, so the exported file will be silent. The picture, text and effects are still encoded locally.'
        : 'The file is encoded locally. Export takes roughly the length of the timeline or longer on slower machines, and can be cancelled while it runs.';
  }
  if (els.exportStart) els.exportStart.disabled = !appSupport.encoder || duration <= 0 || state.exporting;
}

function syncExportControls() {
  const settings = state.exportSettings;
  if (els.exportFormat) els.exportFormat.value = settings.format;
  if (els.exportQuality) els.exportQuality.value = settings.quality;
  if (els.exportResolution) els.exportResolution.value = settings.resolution;
  if (els.exportAspect) els.exportAspect.value = settings.aspect;
  if (els.exportWidth) els.exportWidth.value = String(settings.customWidth);
  if (els.exportHeight) els.exportHeight.value = String(settings.customHeight);
  if (els.exportAspectW) els.exportAspectW.value = String(settings.customAspectW);
  if (els.exportAspectH) els.exportAspectH.value = String(settings.customAspectH);
}

function openExportDialog() {
  if (!els.exportDialog) return;
  if (!appSupport.encoder) {
    toast('This browser cannot encode video with WebCodecs. Editing works, but export needs a current Chrome or Edge release.', 'error', 8000);
    return;
  }
  if (projectDuration(project()) <= 0) {
    toast('Add at least one clip before exporting.', 'warn');
    return;
  }
  fillExportSelects();
  syncExportControls();
  if (els.exportProgress) els.exportProgress.hidden = true;
  if (els.exportResult) els.exportResult.hidden = true;
  if (els.exportError) els.exportError.hidden = true;
  if (els.exportVideo) {
    els.exportVideo.hidden = true;
    els.exportVideo.removeAttribute('src');
  }
  state.exporting = false;
  if (els.exportClose) els.exportClose.disabled = false;
  if (els.exportCancel) els.exportCancel.disabled = true;
  updateExportForm();
  els.exportDialog.showModal();
}

function setExportProgress(progress, stage) {
  const percent = Math.round(clamp(progress, 0, 1) * 100);
  if (els.exportBar) els.exportBar.style.width = `${percent}%`;
  if (els.exportPercent) els.exportPercent.textContent = `${percent}%`;
  if (els.exportStage) {
    const labels = {
      prepare: 'Preparing media and encoders',
      video: 'Compositing and encoding frames',
      audio: 'Mixing audio tracks',
      finalize: 'Finalising the container',
      cancel: 'Cancelling the export'
    };
    els.exportStage.textContent = labels[stage] || 'Working';
  }
}

function mediaEntries() {
  return media.list().map((asset) => ({
    id: asset.id,
    type: asset.type,
    name: asset.name,
    file: asset.file
  }));
}

function startExport() {
  if (state.exporting) return;
  const settings = readExportSettings();
  const dims = exportDimensions(settings);
  const duration = projectDuration(project());
  if (duration <= 0) {
    toast('There is nothing on the timeline to export.', 'warn');
    return;
  }
  const id = uid('export');
  let worker;
  try {
    worker = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    toast(`The export worker could not start: ${error.message || error}`, 'error', 8000);
    return;
  }
  state.exporting = true;
  activeExport = { worker, id, startedAt: performance.now(), objectUrl: null };
  if (els.exportStart) els.exportStart.disabled = true;
  if (els.exportCancel) els.exportCancel.disabled = false;
  if (els.exportClose) els.exportClose.disabled = true;
  if (els.exportProgress) els.exportProgress.hidden = false;
  if (els.exportResult) els.exportResult.hidden = true;
  if (els.exportError) els.exportError.hidden = true;
  setExportProgress(0, 'prepare');

  worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.id !== id) return;
    if (data.type === 'progress') {
      setExportProgress(data.progress, data.phase);
      if (activeExport && els.exportStage) {
        const elapsed = (performance.now() - activeExport.startedAt) / 1000;
        if (data.progress > 0.05) {
          const total = elapsed / data.progress;
          const remaining = Math.max(0, total - elapsed);
          els.exportStage.textContent += ` · ${Math.round(remaining)} s remaining`;
        }
      }
      return;
    }
    if (data.type === 'error') {
      finishExport();
      if (els.exportProgress) els.exportProgress.hidden = true;
      if (els.exportError) {
        els.exportError.hidden = false;
        els.exportError.textContent = data.canceled ? 'Export cancelled. Nothing was downloaded.' : `Export failed: ${data.message}`;
      }
      toast(data.canceled ? 'Export cancelled.' : `Export failed: ${data.message}`, data.canceled ? 'info' : 'error', 8000);
      return;
    }
    if (data.type === 'done') {
      const blob = new Blob([data.buffer], { type: data.meta.mimeType });
      const url = URL.createObjectURL(blob);
      state.lastExport = { blob, url, meta: data.meta };
      if (activeExport) {
        if (activeExport.objectUrl) URL.revokeObjectURL(activeExport.objectUrl);
        activeExport.objectUrl = url;
      }
      finishExport();
      if (els.exportProgress) els.exportProgress.hidden = true;
      if (els.exportResult) els.exportResult.hidden = false;
      if (els.exportVideo) {
        els.exportVideo.src = url;
        els.exportVideo.hidden = false;
      }
      if (els.exportMeta) {
        const meta = data.meta;
        const rows = [
          ['Format', `${meta.format.toUpperCase()} · ${meta.codec}${meta.audioCodec ? ` + ${meta.audioCodec}` : ''}`],
          ['Resolution', `${meta.width} × ${meta.height}`],
          ['Duration', `${Number(meta.duration).toFixed(2)} s (measured)`],
          ['Frame rate', `${meta.fps} fps`],
          ['File size', formatBytes(meta.size)],
          ['Bitrate', `${Math.round(meta.bitrate / 1000)} kbps`],
          ['Audio', meta.hasAudio ? `${meta.audioCodec} · ${Math.round(meta.audioSampleRate / 1000)} kHz · ${meta.audioChannels} ch` : 'Silent']
        ];
        els.exportMeta.innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('');
      }
      toast(`Export finished: ${formatBytes(data.meta.size)}, ${Number(data.meta.duration).toFixed(2)} s.`, 'success', 7000);
    }
  };
  worker.onerror = (event) => {
    finishExport();
    if (els.exportProgress) els.exportProgress.hidden = true;
    if (els.exportError) {
      els.exportError.hidden = false;
      els.exportError.textContent = `Export failed: ${event.message || 'the export worker stopped unexpectedly.'}`;
    }
    toast(`Export failed: ${event.message || 'the export worker stopped unexpectedly.'}`, 'error', 8000);
  };

  worker.postMessage({
    type: 'export',
    id,
    project: deepClone(project()),
    media: mediaEntries(),
    options: {
      format: settings.format,
      quality: settings.quality,
      width: dims.width,
      height: dims.height,
      fps: num(project().fps, 30),
      duration
    }
  });
}

function finishExport() {
  state.exporting = false;
  if (activeExport && activeExport.worker) activeExport.worker.terminate();
  activeExport = null;
  if (els.exportStart) els.exportStart.disabled = false;
  if (els.exportCancel) els.exportCancel.disabled = true;
  if (els.exportClose) els.exportClose.disabled = false;
}

function cancelExport() {
  if (!activeExport || !state.exporting) return;
  setExportProgress(0.01, 'cancel');
  if (els.exportCancel) els.exportCancel.disabled = true;
  activeExport.worker.postMessage({ type: 'cancel' });
}

function downloadLastExport() {
  if (!state.lastExport) {
    toast('There is no finished export to download yet.', 'warn');
    return;
  }
  const { blob, meta } = state.lastExport;
  downloadBlob(blob, `${sanitizeFilename(project().name, 'video')}.${meta.extension}`);
  toast(`Downloaded ${meta.extension.toUpperCase()} · ${formatBytes(blob.size)}.`, 'success');
}

function requestCloseExport() {
  if (state.exporting) {
    if (!window.confirm('An export is running. Cancel it and close the panel?')) return;
    cancelExport();
  }
  els.exportDialog?.close();
}

function resetExportResult() {
  if (state.lastExport?.url) {
    URL.revokeObjectURL(state.lastExport.url);
    state.lastExport = null;
  }
  if (els.exportResult) els.exportResult.hidden = true;
  if (els.exportVideo) {
    els.exportVideo.removeAttribute('src');
    els.exportVideo.hidden = true;
  }
  if (els.exportProgress) els.exportProgress.hidden = true;
  if (els.exportError) els.exportError.hidden = true;
  updateExportForm();
}

function bindDialogs() {
  fillExportSelects();

  for (const key of ['exportFormat', 'exportQuality', 'exportResolution', 'exportAspect', 'exportWidth', 'exportHeight', 'exportAspectW', 'exportAspectH']) {
    const element = els[key];
    if (!element) continue;
    const handler = () => {
      readExportSettings();
      updateExportForm();
    };
    element.addEventListener('change', handler);
    element.addEventListener('input', handler);
  }
  els.exportStart?.addEventListener('click', startExport);
  els.exportCancel?.addEventListener('click', cancelExport);
  els.exportClose?.addEventListener('click', requestCloseExport);
  els.exportDownload?.addEventListener('click', downloadLastExport);
  els.exportAgain?.addEventListener('click', resetExportResult);
  els.exportDialog?.addEventListener('cancel', (event) => {
    if (state.exporting) {
      event.preventDefault();
      requestCloseExport();
    }
  });
  els.exportDialog?.addEventListener('close', () => {
    if (!state.exporting) updateExportForm();
  });

  els.projectDialogForm?.addEventListener('submit', applyProjectDialog);
  els.pdAspect?.addEventListener('change', toggleProjectDialogCustom);
  els.pdResolution?.addEventListener('change', toggleProjectDialogCustom);
  els.pdClear?.addEventListener('click', clearProjectContent);
  els.projectDialog?.addEventListener('close', () => {
    /* form values persist only while the dialog is open */
  });

  els.helpDialog?.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => els.helpDialog.close());
  });
  els.projectDialog?.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => els.projectDialog.close());
  });
}

function bindMobileBar() {
  if (!els.mobileBar) return;
  els.mobileBar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mobile-panel]');
    if (!button) return;
    const target = button.getAttribute('data-mobile-panel');
    if (target === 'preview') {
      state.mobilePanel = 'none';
      updateMobilePanel();
      els.previewShell?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (target === 'timeline') {
      state.mobilePanel = 'none';
      updateMobilePanel();
      els.timeline?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    state.mobilePanel = state.mobilePanel === target ? 'none' : target;
    updateMobilePanel();
    if (state.mobilePanel === 'tools') renderLibrary();
    if (state.mobilePanel === 'properties') renderPropertiesPanel(true);
  });
}

/* -------------------------------------------------------------------------
 * Debug surface used by the automated tests
 * ---------------------------------------------------------------------- */

async function exportToBlob(overrides = {}) {
  const settings = { ...state.exportSettings, ...overrides };
  const dims = exportDimensions(settings);
  const duration = projectDuration(project());
  if (duration <= 0) throw new Error('The timeline is empty.');
  const id = uid('export');
  const worker = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('The export timed out.'));
    }, 240000);
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.id !== id) return;
      if (data.type === 'progress') return;
      clearTimeout(timer);
      worker.terminate();
      if (data.type === 'done') {
        resolve({ blob: new Blob([data.buffer], { type: data.meta.mimeType }), meta: data.meta });
      } else if (data.type === 'error') {
        reject(new Error(data.message || 'Export failed.'));
      }
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || 'The export worker stopped unexpectedly.'));
    };
    worker.postMessage({
      type: 'export',
      id,
      project: deepClone(project()),
      media: mediaEntries(),
      options: {
        format: settings.format,
        quality: settings.quality,
        width: dims.width,
        height: dims.height,
        fps: num(project().fps, 30),
        duration
      }
    });
  });
}

function exposeDebug() {
  window.__videoEditor = {
    get state() {
      return state;
    },
    get project() {
      return project();
    },
    get store() {
      return store;
    },
    get media() {
      return media;
    },
    get timeline() {
      return timeline;
    },
    support: () => ({ ...appSupport }),
    filters: () => FILTERS.map((filter) => filter.id),
    transitions: () => TRANSITIONS.map((entry) => entry.id),
    importFiles,
    addAssetToTimeline,
    addTextPreset,
    addShapeClip,
    addBackgroundClip,
    addSticker,
    addSubtitle,
    selectClip,
    selectNone,
    selectAllClips,
    setActiveTab,
    splitAtPlayhead,
    deleteSelection,
    duplicateSelection,
    stackClip,
    addTrack,
    seek,
    play,
    pause,
    getTime: () => state.playhead,
    renderPreview,
    exportToBlob,
    projectFileData,
    loadProjectData,
    openExportDialog,
    startExport,
    cancelExport,
    getLastExport: () => state.lastExport,
    setExportSetting: (key, value) => {
      state.exportSettings[key] = value;
      syncExportControls();
      updateExportForm();
    },
    getExportDimensions: () => exportDimensions(),
    setTransition,
    setFilter,
    setColorPreset,
    applyProjectDialog: null,
    toast,
    elements: els
  };
}

/* Start the editor. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
