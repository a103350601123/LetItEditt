/* LetitEdit editor V3 — main controller.
 * A fresh workspace shell around a shared composition/export engine.
 */

import { MediaLibrary, validateFile } from '../media.js';
import {
  addClipToTrack,
  clipEnd,
  findClip,
  isCompatibleTrack,
  projectDimensions,
  projectDuration
} from '../model.js';
import {
  deepClone,
  downloadBlob,
  formatClock,
  parseSubtitleFile,
  sanitizeFilename,
  toSrt,
  toVtt,
  uid
} from '../utils.js';
import { TEXT_PRESETS } from '../presets.js';
import {
  EditorStore,
  createBackgroundClip,
  createEmojiClip,
  createMediaClip,
  createShapeClip,
  createTextClip,
  hasOverlap,
  labelForCategory,
  newProject,
  newTrack,
  sanitizeProject
} from './state.js';
import { $, $$, clamp, confirmAction, escapeHtml, focusWithoutScroll, formatBytes, formatTime, isTypingTarget, num, toast } from './dom.js';
import { Preview } from './preview.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Panel, NAV_ITEMS } from './panel.js';
import { Recorder } from './recorder.js';
import { Exporter } from './exporter.js';
import {
  clearAutosave,
  loadAutosave,
  loadAutosaveMedia,
  requestPersistentStorage,
  saveAutosave,
  storageEstimate
} from './persistence.js';

const WORKSPACE_KEY = 'letitedit:video-editor:workspace:v3';
const AUTOSAVE_SCHEMA = 'letitedit-video-editor';

class VideoEditorApp {
  constructor() {
    this.store = new EditorStore(newProject());
    this.media = new MediaLibrary();
    this.store.media = this.media;
    this.mediaManifest = [];
    this.clipboard = null;
    this.autosaveTimer = 0;
    this.autosaveBusy = false;
    this.autosaveQueued = false;
    this.commitTimer = 0;
    this.pendingRestore = null;
    this.restoredOnce = false;
    this.activePopover = null;
    this.popoverAnchor = null;
    this.lastSaveAt = 0;
    this.previewWasPlaying = false;
    this.resizer = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    this.cacheDom();
    this.applyWorkspace();
    this.buildRail();
    this.installComponents();
    this.bindTopbar();
    this.bindTransport();
    this.bindResizers();
    this.bindMobile();
    this.bindProjectMenu();
    this.bindDialogs();
    this.bindInputs();
    this.bindKeyboard();
    this.bindDragDrop();
    this.updateAll();
    this.setCategory('media', { openSheet: false, silent: true });
    this.preview.layout();
    this.preview.renderPreviewNow();
    this.timeline.render();
    this.inspector.render();
    this.restoreWorkspace();
    this.offerRestore();
    requestPersistentStorage();
    this.exposeDebug();
    window.__videoEditorReady = true;
    window.dispatchEvent(new CustomEvent('video-editor-ready'));
    this.setSaveStatus('Autosave ready');
  }

  /* DOM ------------------------------------------------------------------ */

  cacheDom() {
    this.app = $('#ve-app');
    this.rail = $('#ve-rail');
    this.library = $('#ve-library');
    this.libraryPanel = $('#ve-library-panel');
    this.inspectorEl = $('#ve-inspector');
    this.inspectorPanel = $('#ve-inspector-panel');
    this.timelineEl = $('#ve-timeline');
    this.previewStage = $('#ve-preview-stage');
    this.previewShell = $('#ve-preview-shell');
    this.previewInner = $('#ve-preview-stage-inner');
    this.playButton = $('#ve-play');
    this.prevFrame = $('#ve-prev-frame');
    this.nextFrame = $('#ve-next-frame');
    this.scrub = $('#ve-scrub');
    this.currentTime = $('#ve-current-time');
    this.totalTime = $('#ve-total-time');
    this.rateSelect = $('#ve-rate');
    this.previewQuality = $('#ve-preview-quality');
    this.projectName = $('#ve-project-name');
    this.projectMeta = $('#ve-project-meta');
    this.saveStatus = $('#ve-save-status');
    this.undoButton = $('#ve-undo');
    this.redoButton = $('#ve-redo');
    this.selectionLabel = $('#ve-selection-label');
    this.clipCount = $('#ve-clip-count');
    this.projectMenu = $('#ve-project-menu');
    this.projectMenuButton = $('#ve-project-menu-button');
    this.projectMenuWrap = this.projectMenuButton.closest('.ve-menu-wrap');
    this.mobileMenuButton = $('#ve-mobile-menu');
    this.restoreBanner = $('#ve-restore-banner');
    this.restoreText = $('#ve-restore-text');
    this.relinkBanner = $('#ve-relink-banner');
    this.relinkText = $('#ve-relink-text');
    this.dropveil = $('#ve-dropveil');
    this.exportDialog = $('#ve-export-dialog');
    this.helpDialog = $('#ve-help-dialog');
    this.confirmDialog = $('#ve-confirm-dialog');
    this.mediaInput = $('#ve-media-input');
    this.replaceInput = $('#ve-replace-input');
    this.openInput = $('#ve-open-input');
    this.subtitleInput = $('#ve-subtitle-input');
    this.mobileCategoryLabel = $('#ve-mobile-category-label');
    this.sheetBackdrop = $('#ve-sheet-backdrop');
  }

  installComponents() {
    this.preview = new Preview({
      store: this.store,
      media: this.media,
      onTime: (time) => this.updateTransport(time),
      onStatus: (message, tone) => toast(message, tone || 'info'),
      onSelect: (clipId) => {
        this.timeline.updateSelectionClasses();
        this.updateSelectionUi();
        this.inspector.render();
        if (clipId) this.revealSelection();
      }
    });
    this.preview.mount(this.app);

    this.timeline = new Timeline({
      store: this.store,
      media: this.media,
      onSelect: (clipId, subtitleId) => {
        this.preview.updateOverlay();
        this.updateSelectionUi();
        this.inspector.render();
        if (subtitleId) {
          const cue = this.store.project.subtitles.items.find((item) => item.id === subtitleId);
          if (cue) this.preview.seek(cue.start, { keepPlaying: false });
        }
      },
      onAction: (action, payload) => this.handleTimelineAction(action, payload),
      onStatus: (message, tone) => toast(message, tone || 'info'),
      onEdit: (reason, value) => {
        if (reason === 'seek') this.preview.seek(value);
        if (reason === 'pause-for-seek') this.preview.pause();
        if (reason === 'ui') this.scheduleAutosave();
      }
    });
    this.timeline.mount(this.timelineEl);

    this.inspector = new Inspector({
      store: this.store,
      onAction: (action, payload) => this.handleInspectorAction(action, payload),
      onStatus: (message, tone) => toast(message, tone || 'info'),
      onEdit: () => this.scheduleAutosave()
    });
    this.inspector.mount(this.inspectorPanel);

    this.recorder = new Recorder({
      store: this.store,
      media: this.media,
      onAdded: (asset, addToTimeline) => {
        this.panel.render();
        this.scheduleAutosave();
        if (addToTimeline) this.addAssetToTimeline(asset.id);
      },
      onStatus: (message, tone) => toast(message, tone || 'info'),
      onEdit: () => this.scheduleAutosave()
    });

    this.panel = new Panel({
      store: this.store,
      media: this.media,
      recorder: this.recorder,
      onAction: (action, payload) => this.handlePanelAction(action, payload),
      onStatus: (message, tone) => toast(message, tone || 'info'),
      onEdit: () => this.scheduleAutosave()
    });
    this.panel.mount(this.libraryPanel);

    this.exporter = new Exporter({
      store: this.store,
      media: this.media,
      onStatus: (message, tone) => toast(message, tone || 'info'),
      onEdit: () => this.scheduleAutosave()
    });
    this.exporter.mount(this.exportDialog);

    this.store.subscribe((reason, project) => this.onStoreChange(reason, project));
  }

  buildRail() {
    this.rail.innerHTML = NAV_ITEMS.map((item) => `
      <button type="button" class="ve-rail-btn" data-category="${item.id}" role="tab" aria-selected="${item.id === 'media'}" aria-controls="ve-library-panel" title="${escapeHtml(item.label)}">
        <span class="ve-rail-icon" aria-hidden="true">${item.icon}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>`).join('');
    this.rail.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      this.setCategory(button.dataset.category, { openSheet: window.matchMedia('(max-width: 899px)').matches });
    });
  }

  /* Global state --------------------------------------------------------- */

  onStoreChange(reason) {
    this.store.prune();
    this.updateProjectName();
    this.updateUndoState();
    this.updateMeta();
    this.updateSelectionUi();
    this.updateTransport(this.store.playhead);
    this.updateCategoryState();
    if (!['selection', 'live-drag', 'preview-drag'].includes(reason)) this.scheduleAutosave();
  }

  updateAll() {
    this.updateProjectName();
    this.updateUndoState();
    this.updateMeta();
    this.updateSelectionUi();
    this.updateTransport(this.store.playhead);
    this.updateCategoryState();
  }

  updateProjectName() {
    if (document.activeElement === this.projectName) return;
    if (this.projectName.value !== this.store.project.name) this.projectName.value = this.store.project.name;
  }

  updateUndoState() {
    this.undoButton.disabled = !this.store.canUndo();
    this.redoButton.disabled = !this.store.canRedo();
  }

  updateMeta() {
    const project = this.store.project;
    const dims = projectDimensions(project);
    this.projectMeta.textContent = `${project.aspect} · ${dims.width}×${dims.height} · ${project.fps} fps`;
  }

  updateSelectionUi() {
    const count = this.store.selection.size;
    const subtitle = this.store.selectedSubtitle
      ? this.store.project.subtitles.items.find((item) => item.id === this.store.selectedSubtitle)
      : null;
    this.selectionLabel.textContent = count
      ? `${count} clip${count === 1 ? '' : 's'} selected`
      : subtitle ? 'Subtitle cue selected' : 'Nothing selected';
    const clips = this.store.project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    this.clipCount.textContent = `${clips} clip${clips === 1 ? '' : 's'}`;
  }

  updateCategoryState() {
    const category = this.store.activeCategory;
    this.rail.querySelectorAll('[data-category]').forEach((button) => {
      const active = button.dataset.category === category;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    this.app.dataset.category = category;
    if (this.mobileCategoryLabel) {
      this.mobileCategoryLabel.textContent = NAV_ITEMS.find((item) => item.id === category)?.label || 'Media';
    }
  }

  updateTransport(time) {
    const duration = this.editorDuration();
    const fps = this.store.project.fps;
    this.currentTime.textContent = formatClock(time, true, fps);
    this.totalTime.textContent = formatClock(duration, true, fps);
    this.scrub.max = String(Math.max(0.1, duration));
    if (document.activeElement !== this.scrub) this.scrub.value = String(clamp(time, 0, duration));
    this.playButton.textContent = this.store.playing ? 'Pause' : 'Play';
    this.playButton.setAttribute('aria-pressed', String(this.store.playing));
    this.timeline.syncPlayhead();
    this.timeline.fitToPlayhead();
  }

  editorDuration() {
    return Math.max(
      projectDuration(this.store.project),
      this.store.project.subtitles.items.reduce((max, cue) => Math.max(max, cue.end), 0)
    );
  }

  setCategory(category, { openSheet = false, silent = false } = {}) {
    if (!NAV_ITEMS.some((item) => item.id === category)) return;
    if (this.recorder?.isActive() && this.store.activeCategory === 'record' && category !== 'record') {
      confirmAction('A recording is in progress. Stop it and leave the Record panel?', {
        title: 'Leave recording?', confirmLabel: 'Stop and leave', danger: true
      }).then((ok) => {
        if (!ok) return;
        this.recorder.stop();
        this.recorder.retake();
        this.setCategory(category, { openSheet });
      });
      return;
    }
    this.store.activeCategory = category;
    this.updateCategoryState();
    this.panel.setCategory(category);
    if (openSheet && this.isMobile()) this.openSheet('library');
    if (!silent) this.scheduleAutosave();
  }

  revealSelection() {
    const found = this.store.firstSelected();
    if (!found) return;
    if (this.store.playhead < found.clip.start || this.store.playhead >= clipEnd(found.clip)) {
      this.preview.seek(found.clip.start + 0.001);
    }
  }

  /* Autosave and persistence -------------------------------------------- */

  currentManifest() {
    const map = new Map();
    for (const entry of this.mediaManifest || []) map.set(entry.id, entry);
    for (const asset of this.media.list()) {
      map.set(asset.id, {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        size: asset.size,
        mimeType: asset.mimeType,
        width: asset.width || null,
        height: asset.height || null,
        duration: asset.duration || null
      });
    }
    return [...map.values()];
  }

  snapshot() {
    return {
      app: AUTOSAVE_SCHEMA,
      schema: 3,
      savedAt: new Date().toISOString(),
      project: deepClone(this.store.project),
      mediaManifest: this.currentManifest()
    };
  }

  scheduleAutosave() {
    if (this.pendingRestore && !this.restoredOnce) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosave(), 900);
  }

  async autosave() {
    if (this.autosaveBusy) {
      this.autosaveQueued = true;
      return;
    }
    this.autosaveBusy = true;
    this.setSaveStatus('Saving…');
    try {
      const snapshot = this.snapshot();
      const result = await saveAutosave(snapshot, this.media.list());
      this.lastSaveAt = Date.now();
      if (!result.ok) {
        this.setSaveStatus('Not saved', true);
        toast('Autosave failed. Download a project file to keep your edit.', 'error', 6000);
      } else {
        this.setSaveStatus(`Saved ${new Date(this.lastSaveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        if (result.warning) toast(result.warning, 'warn', 5000);
      }
    } catch (error) {
      this.setSaveStatus('Not saved', true);
      console.warn('Autosave failed', error);
    } finally {
      this.autosaveBusy = false;
      if (this.autosaveQueued) {
        this.autosaveQueued = false;
        this.scheduleAutosave();
      }
    }
  }

  setSaveStatus(label, error = false) {
    this.saveStatus.textContent = label;
    this.saveStatus.classList.toggle('is-error', Boolean(error));
    this.saveStatus.title = error ? 'The browser could not save this edit locally.' : 'The current project is stored in this browser.';
  }

  async offerRestore() {
    let offer = null;
    try {
      offer = await loadAutosave();
    } catch {
      offer = null;
    }
    if (!offer?.snapshot?.project) return;
    this.pendingRestore = offer;
    this.mediaManifest = offer.snapshot.mediaManifest || [];
    const clipCount = (offer.snapshot.project.tracks || []).reduce((sum, track) => sum + (track.clips?.length || 0), 0);
    const when = offer.savedAt ? new Date(offer.savedAt).toLocaleString() : 'earlier';
    this.restoreText.textContent = `${clipCount} clip${clipCount === 1 ? '' : 's'} from ${when}. Stored media restores when the browser kept it; otherwise relink after restoring.`;
    this.restoreBanner.hidden = false;
  }

  async restorePendingProject() {
    if (!this.pendingRestore) return;
    const offer = this.pendingRestore;
    this.restoreBanner.hidden = true;
    this.preview.pause();
    try {
      this.setSaveStatus('Restoring…');
      this.media.clear();
      this.preview.audio.dispose();
      const records = await loadAutosaveMedia();
      let imported = 0;
      for (const record of records) {
        try {
          const file = new File([record.blob], record.name, { type: record.mimeType || record.blob.type || 'application/octet-stream' });
          const asset = await this.media.addFile(file);
          if (record.id && record.id !== asset.id) {
            this.media.assets.delete(asset.id);
            asset.id = record.id;
            this.media.assets.set(record.id, asset);
          }
          imported += 1;
        } catch (error) {
          console.warn('A stored media file could not be restored', record.name, error);
        }
      }
      const project = sanitizeProject(offer.snapshot.project);
      this.store.replaceProject(project);
      this.mediaManifest = offer.snapshot.mediaManifest || [];
      this.store.playhead = 0;
      this.store.clearSelection();
      this.preview.layout();
      this.preview.scheduleRender();
      this.timeline.render();
      this.inspector.render();
      this.panel.render();
      this.updateAll();
      this.restoredOnce = true;
      this.pendingRestore = null;
      this.restoreBanner.hidden = true;
      this.updateRelinkBanner();
      this.setSaveStatus(`Restored · ${imported} media file${imported === 1 ? '' : 's'}`);
      this.scheduleAutosave();
      toast('Autosaved project restored.', 'success');
    } catch (error) {
      this.setSaveStatus('Restore failed', true);
      toast(`The autosaved project could not be restored: ${error.message || error}`, 'error', 7000);
    }
  }

  async discardPendingRestore() {
    const ok = await confirmAction('Discard this autosaved project and its stored media? This cannot be undone.', {
      title: 'Discard autosave?', confirmLabel: 'Discard', danger: true
    });
    if (!ok) return;
    await clearAutosave();
    this.pendingRestore = null;
    this.restoreBanner.hidden = true;
    this.setSaveStatus('Autosave ready');
    toast('Autosaved project discarded.', 'info');
  }

  missingMedia() {
    const missing = new Map();
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) {
        if (!clip.mediaId || this.media.has(clip.mediaId)) continue;
        const manifest = (this.mediaManifest || []).find((entry) => entry.id === clip.mediaId);
        missing.set(clip.mediaId, {
          id: clip.mediaId,
          name: manifest?.name || clip.name || 'Missing media',
          type: manifest?.type || clip.kind
        });
      }
    }
    return [...missing.values()];
  }

  updateRelinkBanner() {
    const missing = this.missingMedia();
    if (!missing.length) {
      this.relinkBanner.hidden = true;
      return;
    }
    this.relinkBanner.hidden = false;
    this.relinkText.textContent = `${missing.length} media file${missing.length === 1 ? '' : 's'} need relinking: ${missing.slice(0, 3).map((item) => item.name).join(', ')}${missing.length > 3 ? '…' : ''}. Import the originals; matching names are connected to the existing clips.`;
  }

  saveProjectFile() {
    try {
      const data = {
        ...this.snapshot(),
        savedAt: new Date().toISOString(),
        mediaManifest: this.currentManifest(),
        notes: 'Media files are not embedded. Re-import the original files by name to relink them.'
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${sanitizeFilename(this.store.project.name, 'video-project')}.json`);
      this.setSaveStatus('Project file exported');
      toast('Project file downloaded. Media files are referenced separately.', 'success', 5000);
    } catch (error) {
      toast(`The project could not be saved: ${error.message || error}`, 'error');
    }
  }

  async openProjectFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const project = sanitizeProject(data.project || data);
      this.preview.pause();
      this.pendingRestore = null;
      this.restoreBanner.hidden = true;
      this.store.replaceProject(project);
      this.mediaManifest = Array.isArray(data.mediaManifest) ? data.mediaManifest : Array.isArray(data.media) ? data.media : [];
      this.store.clearSelection();
      this.store.playhead = 0;
      this.preview.layout();
      this.preview.scheduleRender();
      this.timeline.render();
      this.inspector.render();
      this.panel.render();
      this.updateAll();
      this.updateRelinkBanner();
      this.scheduleAutosave();
      toast(`Opened “${project.name}”. Media is referenced separately.`, 'success', 5000);
    } catch (error) {
      toast(`This project file could not be opened: ${error.message || error}`, 'error', 7000);
    }
  }

  async newProject() {
    const clipCount = this.store.project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    if (clipCount > 0) {
      const ok = await confirmAction('Start a new project? The current timeline will be replaced. You can undo once, but exported and autosaved data are replaced on the next change.', {
        title: 'New project', confirmLabel: 'New project', danger: true
      });
      if (!ok) return;
    }
    this.preview.pause();
    this.preview.audio.dispose();
    this.media.clear();
    const project = newProject();
    this.pendingRestore = null;
    this.restoreBanner.hidden = true;
    this.store.replaceProject(project);
    this.mediaManifest = [];
    this.store.playhead = 0;
    this.store.clearSelection();
    this.store.clearHistory();
    this.preview.layout();
    this.preview.scheduleRender();
    this.timeline.render();
    this.inspector.render();
    this.panel.render();
    this.updateAll();
    await clearAutosave();
    this.scheduleAutosave();
    toast('New project created.', 'success');
  }

  saveWorkspace() {
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(this.store.workspace));
    } catch {
      /* ignore quota */
    }
  }

  restoreWorkspace() {
    try {
      const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      if (!saved) return;
      this.store.workspace = {
        libraryWidth: clamp(num(saved.libraryWidth, 304), 240, 440),
        inspectorWidth: clamp(num(saved.inspectorWidth, 300), 250, 420),
        timelineHeight: clamp(num(saved.timelineHeight, 286), 150, 540)
      };
      this.applyWorkspace();
    } catch {
      /* ignore */
    }
  }

  applyWorkspace() {
    const ws = this.store.workspace;
    this.app.style.setProperty('--ve-library-width', `${ws.libraryWidth}px`);
    this.app.style.setProperty('--ve-inspector-width', `${ws.inspectorWidth}px`);
    this.app.style.setProperty('--ve-timeline-height', `${ws.timelineHeight}px`);
    if (this.preview) requestAnimationFrame(() => this.preview.layout());
  }

  /* Media ---------------------------------------------------------------- */

  openMediaPicker(accept = 'video/*,image/*,audio/*', target = 'media') {
    const input = target === 'replace' ? this.replaceInput : this.mediaInput;
    if (!input) return;
    input.accept = accept;
    input.dataset.target = target;
    input.value = '';
    input.click();
  }

  async importFiles(fileList, { replaceAssetId = null, relink = false } = {}) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return [];
    const results = [];
    const total = files.length;
    let imported = 0;
    const statusItems = [];
    this.panel.setImportStatus({ label: `Importing 0 of ${total}`, detail: files[0]?.name || '', items: [] });
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      this.panel.setImportStatus({
        label: `Importing ${index + 1} of ${total}`,
        detail: file.name,
        items: statusItems
      });
      const error = validateFile(file);
      if (error) {
        statusItems.push({ name: file.name, ok: false, message: error });
        results.push({ file, error });
        continue;
      }
      try {
        if (replaceAssetId) {
          const asset = await this.replaceAsset(replaceAssetId, file);
          results.push({ file, asset });
          statusItems.push({ name: file.name, ok: true, message: 'Replaced media' });
        } else if (relink) {
          const asset = await this.relinkFile(file);
          results.push({ file, asset });
          statusItems.push({ name: file.name, ok: true, message: 'Relinked' });
        } else {
          const asset = await this.media.addFile(file);
          results.push({ file, asset });
          statusItems.push({ name: file.name, ok: true, message: 'Imported' });
        }
        imported += 1;
      } catch (err) {
        statusItems.push({ name: file.name, ok: false, message: err.message || String(err) });
        results.push({ file, error: err });
      }
    }
    this.panel.setImportStatus({
      label: imported === total ? `Imported ${imported} file${imported === 1 ? '' : 's'}` : `Imported ${imported} of ${total}`,
      detail: imported === total ? 'Media is local to this tab.' : 'Some files were skipped.',
      items: statusItems,
      done: true
    });
    if (replaceAssetId) this.replaceAssetId = null;
    this.panel.render();
    this.updateRelinkBanner();
    this.scheduleAutosave();
    if (imported) toast(`${imported} media file${imported === 1 ? '' : 's'} imported.`, 'success');
    const failed = results.filter((result) => result.error);
    if (failed.length) toast(`${failed.length} file${failed.length === 1 ? '' : 's'} could not be imported.`, 'error', 6000);
    return results;
  }

  async relinkFile(file) {
    const missing = this.missingMedia();
    const normalize = (name) => String(name || '').toLowerCase().replace(/\.[^.]+$/, '');
    const target = missing.find((item) => item.name === file.name) ||
      missing.find((item) => normalize(item.name) === normalize(file.name)) ||
      missing[0];
    const asset = await this.media.addFile(file);
    if (target) {
      this.media.assets.delete(asset.id);
      asset.id = target.id;
      this.media.assets.set(target.id, asset);
      this.store.apply((draft) => {
        for (const track of draft.tracks) {
          for (const clip of track.clips) {
            if (clip.mediaId === target.id) clip.name = asset.name;
          }
        }
      }, { history: false, reason: 'relink' });
      this.store.emit('relink');
    }
    return asset;
  }

  async replaceAsset(oldId, file) {
    const old = this.media.get(oldId);
    const asset = await this.media.addFile(file);
    this.store.apply((draft) => {
      for (const track of draft.tracks) {
        for (const clip of track.clips) {
          if (clip.mediaId === oldId) clip.mediaId = asset.id;
        }
      }
    }, { reason: 'replace-media' });
    this.preview.audio.forgetMedia(oldId);
    this.media.remove(oldId);
    this.store.emit('replace-media');
    this.scheduleAutosave();
    if (old) toast(`Replaced ${old.name} with ${asset.name}.`, 'success');
    return asset;
  }

  async removeMedia(assetId) {
    const asset = this.media.get(assetId);
    if (!asset) return;
    const used = this.usedCount(assetId);
    const ok = await confirmAction(
      used
        ? `Remove “${asset.name}” and the ${used} clip${used === 1 ? '' : 's'} that use it? Undo is available.`
        : `Remove “${asset.name}” from your media library?`,
      { title: 'Remove media', confirmLabel: 'Remove', danger: true }
    );
    if (!ok) return;
    if (used) {
      this.store.apply((draft) => {
        for (const track of draft.tracks) track.clips = track.clips.filter((clip) => clip.mediaId !== assetId);
        for (const clipId of [...this.store.selection]) {
          if (!draft.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))) this.store.selection.delete(clipId);
        }
      }, { reason: 'remove-media' });
    }
    this.preview.audio.forgetMedia(assetId);
    this.media.remove(assetId);
    this.panel.render();
    this.inspector.render();
    this.preview.scheduleRender();
    this.timeline.render();
    this.scheduleAutosave();
    toast(`Removed ${asset.name}.`, 'info');
  }

  renameMedia(assetId) {
    const asset = this.media.get(assetId);
    if (!asset) return;
    const next = window.prompt('Rename media', asset.name);
    if (next === null) return;
    const clean = next.trim().slice(0, 120);
    if (!clean || clean === asset.name) return;
    asset.name = clean;
    this.store.apply((draft) => {
      for (const track of draft.tracks) {
        for (const clip of track.clips) {
          if (clip.mediaId === assetId) clip.name = clean;
        }
      }
    }, { reason: 'rename-media' });
    this.panel.render();
    this.inspector.render();
    this.scheduleAutosave();
    toast('Media renamed.', 'success');
  }

  usedCount(mediaId) {
    let count = 0;
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) if (clip.mediaId === mediaId) count += 1;
    }
    return count;
  }

  addAssetToTimeline(assetId, { start = this.store.playhead, trackId = null } = {}) {
    const asset = this.media.get(assetId);
    if (!asset) return null;
    const clip = createMediaClip(asset, { fit: this.store.project.defaultFit || 'contain' });
    const candidate = trackId ? this.store.project.tracks.find((item) => item.id === trackId) : null;
    const track = candidate && !candidate.locked && isCompatibleTrack(candidate, clip) ? candidate : null;
    const inserted = this.store.addClip(clip, { track, start });
    this.store.selectClip(inserted.clip.id);
    this.store.playhead = inserted.clip.start + 0.001;
    this.store.emit('add-clip');
    this.preview.seek(inserted.clip.start + 0.001);
    this.timeline.render();
    this.inspector.render();
    this.updateSelectionUi();
    this.scheduleAutosave();
    toast(`${asset.name} added to the timeline.`, 'success');
    return inserted;
  }

  /* Adders --------------------------------------------------------------- */

  addTextPreset(presetId = 'title') {
    const preset = presetId === 'plain' ? {
      name: 'Text',
      duration: 3,
      text: { content: 'Your text' }
    } : TEXT_PRESETS[presetId] || TEXT_PRESETS.title;
    const clip = createTextClip(preset);
    const result = this.store.addClip(clip, { start: this.store.playhead, track: this.pendingTextTrack() });
    this.store.selectClip(result.clip.id);
    this.preview.seek(result.clip.start + 0.001);
    this.store.emit('add-text');
    this.timeline.render();
    this.inspector.render();
    this.scheduleAutosave();
    toast(`${preset.label || preset.name} added. Edit it in the inspector.`, 'success');
    return result;
  }

  pendingTextTrack() {
    const visual = this.store.project.tracks.filter((track) => track.kind === 'video');
    const text = visual.find((track) => track.category === 'text' && !track.locked && !hasOverlap(track, this.store.playhead, 3));
    return text || null;
  }

  addShape(type = 'rect') {
    const clip = createShapeClip(type);
    const result = this.store.addClip(clip, { start: this.store.playhead });
    this.store.selectClip(result.clip.id);
    this.preview.seek(result.clip.start + 0.001);
    this.store.emit('add-shape');
    this.timeline.render();
    this.inspector.render();
    this.scheduleAutosave();
    toast(`${clip.name} added.`, 'success');
    return result;
  }

  addBackground(kind = 'solid') {
    const clip = createBackgroundClip(kind);
    const result = this.store.addClip(clip, { start: 0 });
    this.store.selectClip(result.clip.id);
    this.store.emit('add-background');
    this.timeline.render();
    this.inspector.render();
    this.scheduleAutosave();
    toast('Background layer added.', 'success');
    return result;
  }

  addEmoji(emoji) {
    const clip = createEmojiClip(emoji);
    const result = this.store.addClip(clip, { start: this.store.playhead });
    this.store.selectClip(result.clip.id);
    this.store.emit('add-emoji');
    this.timeline.render();
    this.inspector.render();
    this.scheduleAutosave();
    return result;
  }

  addSubtitle() {
    const start = this.store.playhead;
    const end = Math.max(start + 2.5, Math.min(this.editorDuration() || start + 3, start + 3));
    const item = { id: uid('sub'), start, end, text: 'New subtitle' };
    this.store.apply((draft) => {
      draft.subtitles.items.push(item);
      draft.subtitles.items.sort((a, b) => a.start - b.start);
    }, { reason: 'add-subtitle' });
    this.store.selectSubtitle(item.id);
    this.store.activeCategory = 'subtitles';
    this.setCategory('subtitles');
    this.inspector.render();
    this.timeline.render();
    this.scheduleAutosave();
    return item;
  }

  duplicateSubtitle(id) {
    const source = this.store.project.subtitles.items.find((item) => item.id === id || item.id === this.store.selectedSubtitle);
    if (!source) return;
    const copy = { ...source, id: uid('sub'), start: source.end + 0.05, end: source.end + 0.05 + (source.end - source.start) };
    this.store.apply((draft) => {
      draft.subtitles.items.push(copy);
      draft.subtitles.items.sort((a, b) => a.start - b.start);
    }, { reason: 'duplicate-subtitle' });
    this.store.selectSubtitle(copy.id);
    this.store.emit('selection');
    this.inspector.render();
    this.timeline.render();
    this.scheduleAutosave();
  }

  deleteSubtitle(id) {
    const target = id || this.store.selectedSubtitle;
    if (!target) return;
    this.store.apply((draft) => {
      draft.subtitles.items = draft.subtitles.items.filter((item) => item.id !== target);
    }, { reason: 'delete-subtitle' });
    if (this.store.selectedSubtitle === target) this.store.selectedSubtitle = null;
    this.inspector.render();
    this.timeline.render();
    this.scheduleAutosave();
  }

  /* Clip commands -------------------------------------------------------- */

  selectedEntries() {
    return [...this.store.selection].map((id) => findClip(this.store.project, id)).filter(Boolean);
  }

  splitSelection() {
    const targets = this.store.selection.size
      ? [...this.store.selection]
      : this.store.project.tracks.flatMap((track) => track.clips
        .filter((clip) => this.store.playhead > clip.start + 0.05 && this.store.playhead < clipEnd(clip) - 0.05)
        .map((clip) => clip.id));
    if (!targets.length) {
      toast('Place the playhead inside a clip to split it.', 'info');
      return;
    }
    let split = 0;
    this.store.apply((draft) => {
      for (const id of targets) {
        const located = findClip(draft, id);
        if (!located) continue;
        const { clip, track } = located;
        const time = this.store.playhead;
        if (time <= clip.start + 0.05 || time >= clipEnd(clip) - 0.05) continue;
        const left = time - clip.start;
        const rightDuration = clip.duration - left;
        const right = deepClone(clip);
        right.id = uid('clip');
        right.start = time;
        right.duration = rightDuration;
        if (clip.kind === 'video' || clip.kind === 'audio') {
          right.inPoint = clip.inPoint + left * (clip.speed || 1);
          right.outPoint = right.inPoint + rightDuration * (clip.speed || 1);
        }
        right.transition = { type: 'none', duration: 0.5, reverse: false };
        right.inAnim = { type: 'none', duration: 0.5 };
        clip.duration = left;
        if (clip.kind === 'video' || clip.kind === 'audio') clip.outPoint = clip.inPoint + left * (clip.speed || 1);
        clip.outAnim = { type: 'none', duration: 0.5 };
        splitKeyframes(clip, left, right);
        track.clips.push(right);
        track.clips.sort((a, b) => a.start - b.start);
        split += 1;
      }
    }, { reason: 'split' });
    this.timeline.render();
    this.inspector.render();
    this.preview.scheduleRender();
    this.scheduleAutosave();
    toast(split ? `${split} clip${split === 1 ? '' : 's'} split at ${formatTime(this.store.playhead)}.` : 'The playhead is not inside the selected clip.', split ? 'success' : 'info');
  }

  copySelection() {
    const entries = this.selectedEntries();
    if (!entries.length) return false;
    this.clipboard = entries.map(({ clip }) => deepClone(clip));
    toast(`${entries.length} clip${entries.length === 1 ? '' : 's'} copied.`, 'info', 2200);
    return true;
  }

  pasteClipboard() {
    if (!this.clipboard?.length) return false;
    const minStart = Math.min(...this.clipboard.map((clip) => clip.start));
    const created = [];
    this.store.apply((draft) => {
      for (const original of this.clipboard) {
        const clip = deepClone(original);
        clip.id = uid('clip');
        clip.start = this.store.playhead + (original.start - minStart);
        let track;
        if (clip.kind === 'audio') {
          track = draft.tracks.filter((item) => item.kind === 'audio' && !item.locked && !hasOverlap(item, clip.start, clip.duration))[0];
          if (!track) {
            track = newTrack('audio', 'audio', `Audio ${draft.tracks.filter((item) => item.kind === 'audio').length + 1}`);
            draft.tracks.push(track);
          }
        } else {
          track = draft.tracks.filter((item) => item.kind === 'video' && !item.locked && !hasOverlap(item, clip.start, clip.duration))[0];
          if (!track) {
            track = newTrack('video', 'video', `Overlay ${draft.tracks.filter((item) => item.kind === 'video').length + 1}`);
            const audioIndex = draft.tracks.findIndex((item) => item.kind === 'audio');
            draft.tracks.splice(audioIndex === -1 ? draft.tracks.length : audioIndex, 0, track);
          }
        }
        addClipToTrack(track, clip);
        created.push(clip);
      }
    }, { reason: 'paste' });
    this.store.selection = new Set(created.map((clip) => clip.id));
    this.store.emit('selection');
    this.timeline.render();
    this.inspector.render();
    this.scheduleAutosave();
    toast(`${created.length} clip${created.length === 1 ? '' : 's'} pasted.`, 'success');
    return true;
  }

  duplicateSelection() {
    const entries = this.selectedEntries();
    if (!entries.length) {
      if (this.store.selectedSubtitle) this.duplicateSubtitle(this.store.selectedSubtitle);
      return false;
    }
    const copies = entries.map(({ clip }) => deepClone(clip));
    const minStart = Math.min(...copies.map((clip) => clip.start));
    const created = [];
    this.store.apply((draft) => {
      for (const original of copies) {
        const clip = deepClone(original);
        clip.id = uid('clip');
        clip.start = original.start + 0.5;
        let track = draft.tracks.find((item) => item.kind === (clip.kind === 'audio' ? 'audio' : 'video') && !item.locked && !hasOverlap(item, clip.start, clip.duration));
        if (!track) {
          track = newTrack(clip.kind === 'audio' ? 'audio' : 'video', clip.kind === 'audio' ? 'audio' : 'video', `Duplicate ${draft.tracks.filter((item) => item.kind === (clip.kind === 'audio' ? 'audio' : 'video')).length + 1}`);
          if (clip.kind === 'audio') draft.tracks.push(track);
          else {
            const audioIndex = draft.tracks.findIndex((item) => item.kind === 'audio');
            draft.tracks.splice(audioIndex === -1 ? draft.tracks.length : audioIndex, 0, track);
          }
        }
        addClipToTrack(track, clip);
        created.push(clip);
      }
    }, { reason: 'duplicate' });
    this.store.selection = new Set(created.map((clip) => clip.id));
    this.store.emit('selection');
    this.timeline.render();
    this.inspector.render();
    this.scheduleAutosave();
    toast(`Duplicated ${created.length} clip${created.length === 1 ? '' : 's'}.`, 'success');
    return true;
  }

  deleteSelection() {
    if (this.store.selectedSubtitle) {
      this.deleteSubtitle(this.store.selectedSubtitle);
      return;
    }
    if (!this.store.selection.size) return;
    const count = this.store.selection.size;
    this.store.apply((draft) => {
      for (const track of draft.tracks) {
        track.clips = track.clips.filter((clip) => !this.store.selection.has(clip.id));
      }
    }, { reason: 'delete' });
    this.store.clearSelection();
    this.store.emit('selection');
    this.timeline.render();
    this.inspector.render();
    this.preview.scheduleRender();
    this.scheduleAutosave();
    toast(`${count} clip${count === 1 ? '' : 's'} deleted. Undo is available.`, 'info');
  }

  nudgeSelection(seconds) {
    if (!this.store.selection.size) {
      this.preview.seek(this.store.playhead + seconds);
      return;
    }
    this.store.apply((draft) => {
      for (const id of this.store.selection) {
        const located = findClip(draft, id);
        if (!located) continue;
        located.clip.start = Math.max(0, located.clip.start + seconds);
        sortDraftTrack(located.track);
      }
    }, { reason: 'nudge' });
    this.timeline.render();
    this.preview.scheduleRender();
    this.scheduleAutosave();
  }

  /* Layers --------------------------------------------------------------- */

  layerAction(action) {
    const found = this.store.firstSelected();
    if (!found || found.track.kind !== 'video') {
      toast('Select a visual clip to change its layer order.', 'info');
      return;
    }
    if (action === 'hide') {
      this.store.apply((draft) => {
        const located = findClip(draft, found.clip.id);
        if (located) located.clip.hidden = !located.clip.hidden;
      }, { reason: 'layer-hide' });
    } else if (action === 'lock') {
      this.store.apply((draft) => {
        const located = findClip(draft, found.clip.id);
        if (located) located.clip.locked = !located.clip.locked;
      }, { reason: 'layer-lock' });
    } else {
      this.store.apply((draft) => {
        const located = findClip(draft, found.clip.id);
        if (!located) return;
        const visuals = draft.tracks.filter((track) => track.kind === 'video');
        const currentIndex = visuals.findIndex((track) => track.id === located.track.id);
        if (currentIndex === -1) return;
        let targetIndex = currentIndex;
        if (action === 'forward') targetIndex = Math.max(0, currentIndex - 1);
        else if (action === 'backward') targetIndex = Math.min(visuals.length - 1, currentIndex + 1);
        else if (action === 'front') targetIndex = 0;
        else if (action === 'back') targetIndex = visuals.length - 1;
        if (targetIndex === currentIndex) return;
        const targetTrack = visuals[targetIndex];
        const a = draft.tracks.findIndex((track) => track.id === located.track.id);
        const b = draft.tracks.findIndex((track) => track.id === targetTrack.id);
        if (a === -1 || b === -1) return;
        [draft.tracks[a], draft.tracks[b]] = [draft.tracks[b], draft.tracks[a]];
      }, { reason: 'layer-order' });
    }
    this.timeline.render();
    this.inspector.render();
    this.preview.scheduleRender();
    this.scheduleAutosave();
  }

  /* Project settings ----------------------------------------------------- */

  setProjectValue(path, value, { live = true } = {}) {
    const project = this.store.project;
    if (!path) return;
    if (live) this.store.begin();
    this.store.apply((draft) => {
      if (path === 'masterVolume') draft.masterVolume = clamp(num(value), 0, 1.5);
      else if (path === 'guides.center' || path === 'guides.safe') {
        draft.guides = draft.guides || {};
        draft.guides[path.split('.')[1]] = Boolean(value);
      } else if (path.startsWith('project.')) {
        const key = path.slice('project.'.length);
        if (key === 'customWidth' || key === 'customHeight') draft[key] = clamp(Math.round(num(value)), 16, 4096);
        else if (key === 'customAspectW' || key === 'customAspectH') draft[key] = clamp(Math.round(num(value)), 1, 100);
        else if (key === 'fps') draft.fps = clamp(Math.round(num(value)), 1, 60);
        else if (key === 'resolution') draft.resolution = String(value);
        else if (key === 'background') draft.background = /^#[0-9a-f]{6}$/i.test(value) ? value : draft.background;
        else draft[key] = value;
      } else if (path === 'resolution') {
        draft.resolution = String(value);
        if (value === '480' || value === '720' || value === '1080') draft.resolution = String(value);
      } else if (path === 'fps') draft.fps = clamp(Math.round(num(value)), 1, 60);
      else if (path === 'background') draft.background = /^#[0-9a-f]{6}$/i.test(value) ? value : draft.background;
    }, { history: false, reason: 'project-settings' });
    this.preview.layout();
    this.preview.scheduleRender();
    this.updateMeta();
    this.timeline.render();
    if (!live) {
      this.store.end('project-settings');
      this.panel.render();
    } else {
      clearTimeout(this.commitTimer);
      this.commitTimer = setTimeout(() => {
        if (this.store.pendingSnapshot !== null) this.store.end('project-settings');
      }, 700);
    }
    this.scheduleAutosave();
  }

  setSubtitleStyle(key, value, live = true) {
    if (live) this.store.begin();
    this.store.apply((draft) => {
      if (key === 'size') draft.subtitles.style.size = clamp(Math.round(num(value)), 8, 200);
      else if (key === 'bgOpacity' || key === 'position') draft.subtitles.style[key] = clamp(num(value), 0, 1);
      else draft.subtitles.style[key] = value;
    }, { history: false, reason: 'subtitle-style' });
    this.preview.scheduleRender();
    if (!live) this.store.end('subtitle-style');
    else {
      clearTimeout(this.commitTimer);
      this.commitTimer = setTimeout(() => {
        if (this.store.pendingSnapshot !== null) this.store.end('subtitle-style');
      }, 700);
    }
    this.scheduleAutosave();
  }

  /* Timeline actions ----------------------------------------------------- */

  handleTimelineAction(action, payload = {}) {
    if (action === 'split') this.splitSelection();
    else if (action === 'duplicate') this.duplicateSelection();
    else if (action === 'delete') this.deleteSelection();
    else if (action === 'add-video-track') this.addTrack('video');
    else if (action === 'add-audio-track') this.addTrack('audio');
    else if (action === 'add-subtitle') {
      this.addSubtitle();
      this.setCategory('subtitles', { openSheet: this.isMobile() });
    } else if (action === 'track-menu') this.showTrackMenu(payload.track, payload.anchor);
    else if (action === 'close-gap') {
      if (!payload.gap) toast('Select a gap in the timeline first.', 'info');
    }
  }

  addTrack(kind) {
    const count = this.store.project.tracks.filter((track) => track.kind === kind).length;
    const track = newTrack(kind, kind === 'audio' ? 'audio' : 'video', kind === 'audio' ? `Audio ${count + 1}` : `Visual ${count + 1}`);
    this.store.apply((draft) => {
      if (kind === 'audio') draft.tracks.push(track);
      else {
        const audioIndex = draft.tracks.findIndex((item) => item.kind === 'audio');
        draft.tracks.splice(audioIndex === -1 ? draft.tracks.length : audioIndex, 0, track);
      }
    }, { reason: 'add-track' });
    this.timeline.render();
    this.scheduleAutosave();
    toast(`${kind === 'audio' ? 'Audio' : 'Visual'} track added.`, 'success');
  }

  showTrackMenu(track, anchor) {
    if (!track) return;
    this.showPopover(anchor, [
      { label: 'Rename track', action: () => this.renameTrack(track.id) },
      { label: 'Move track up', action: () => this.reorderTrack(track.id, -1) },
      { label: 'Move track down', action: () => this.reorderTrack(track.id, 1) },
      { label: 'Delete track', danger: true, action: () => this.deleteTrack(track.id) }
    ]);
  }

  renameTrack(trackId) {
    const track = this.store.project.tracks.find((item) => item.id === trackId);
    if (!track) return;
    const next = window.prompt('Rename track', track.name);
    if (next === null) return;
    const clean = next.trim().slice(0, 32);
    if (!clean) return;
    this.store.apply((draft) => {
      const found = draft.tracks.find((item) => item.id === trackId);
      if (found) found.name = clean;
    }, { reason: 'rename-track' });
    this.timeline.render();
  }

  reorderTrack(trackId, direction) {
    this.store.apply((draft) => {
      const track = draft.tracks.find((item) => item.id === trackId);
      if (!track) return;
      const sameKind = draft.tracks.filter((item) => item.kind === track.kind);
      const kindIndex = sameKind.indexOf(track);
      const target = sameKind[kindIndex + direction];
      if (!target) return;
      const a = draft.tracks.indexOf(track);
      const b = draft.tracks.indexOf(target);
      [draft.tracks[a], draft.tracks[b]] = [draft.tracks[b], draft.tracks[a]];
    }, { reason: 'reorder-track' });
    this.timeline.render();
    this.preview.scheduleRender();
    this.scheduleAutosave();
  }

  async deleteTrack(trackId) {
    const track = this.store.project.tracks.find((item) => item.id === trackId);
    if (!track) return;
    const sameKind = this.store.project.tracks.filter((item) => item.kind === track.kind);
    if (sameKind.length <= 1) {
      toast('Keep at least one track of each type.', 'warn');
      return;
    }
    const ok = await confirmAction(
      track.clips.length
        ? `Delete “${track.name}” and its ${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}? Undo is available.`
        : `Delete “${track.name}”?`,
      { title: 'Delete track', confirmLabel: 'Delete track', danger: true }
    );
    if (!ok) return;
    this.store.apply((draft) => {
      draft.tracks = draft.tracks.filter((item) => item.id !== trackId);
    }, { reason: 'delete-track' });
    this.store.prune();
    this.timeline.render();
    this.inspector.render();
    this.preview.scheduleRender();
    this.scheduleAutosave();
  }

  /* Inspector actions ---------------------------------------------------- */

  handleInspectorAction(action) {
    if (action === 'split') this.splitSelection();
    else if (action === 'duplicate') this.duplicateSelection();
    else if (action === 'delete') this.deleteSelection();
    else if (action === 'duplicate-subtitle') this.duplicateSubtitle(this.store.selectedSubtitle);
    else if (action === 'delete-subtitle') this.deleteSubtitle(this.store.selectedSubtitle);
    else if (['forward', 'backward', 'front', 'back', 'hide', 'lock'].includes(action)) this.layerAction(action);
    else if (action === 'close') {
      this.store.clearSelection();
      this.store.emit('selection');
      this.timeline.updateSelectionClasses();
      this.preview.updateOverlay();
    }
  }

  /* Panel actions -------------------------------------------------------- */

  handlePanelAction(action, payload = {}) {
    try {
      if (action === 'import') this.openMediaPicker(payload.accept, payload.target || 'media');
      else if (action === 'add-asset') this.addAssetToTimeline(payload.assetId);
      else if (action === 'asset-menu') this.showAssetMenu(payload.assetId, payload.element);
      else if (action === 'add-text') this.addTextPreset(payload.textPreset);
      else if (action === 'add-shape') this.addShape(payload.shape);
      else if (action === 'add-background') this.addBackground(payload.background);
      else if (action === 'add-emoji') this.addEmoji(payload.emoji);
      else if (action === 'select-clip') {
        this.store.selectClip(payload.clipId);
        this.store.emit('selection');
        this.revealSelection();
        this.inspector.render();
      } else if (action === 'select-subtitle') {
        this.store.selectSubtitle(payload.subtitleId);
        this.store.emit('selection');
        const cue = this.store.project.subtitles.items.find((item) => item.id === payload.subtitleId);
        if (cue) this.preview.seek(cue.start);
        this.inspector.render();
      } else if (action === 'add-subtitle') this.addSubtitle();
      else if (action === 'duplicate-subtitle') this.duplicateSubtitle(payload.subtitleId);
      else if (action === 'delete-subtitle') this.deleteSubtitle(payload.subtitleId);
      else if (action === 'import-subtitles') {
        this.subtitleInput.value = '';
        this.subtitleInput.click();
      } else if (action === 'export-srt') this.exportSubtitles('srt');
      else if (action === 'export-vtt') this.exportSubtitles('vtt');
      else if (action === 'aspect') this.setProjectValue('project.aspect', payload.aspect, { live: false });
      else if (action === 'preview-fit') this.preview.zoomToFit();
      else if (action === 'preview-zoom') {
        this.preview.setZoom(num(payload.value, 1));
        const output = this.panel.root?.querySelector('.ve-range-field output');
        if (output) output.textContent = `${Math.round(this.store.previewZoom * 100)}%`;
      } else if (action === 'open-record') {
        if (payload.recordMode) this.recorder.mode = payload.recordMode;
        this.setCategory('record', { openSheet: this.isMobile() });
      } else if (action === 'track-mute') {
        this.store.apply((draft) => {
          const track = draft.tracks.find((item) => item.id === payload.trackId);
          if (track) track.muted = !track.muted;
        }, { reason: 'track-mute' });
        this.timeline.render();
      } else if (action === 'track-volume') {
        this.store.begin();
        this.store.apply((draft) => {
          const track = draft.tracks.find((item) => item.id === payload.trackId);
          if (track) track.volume = clamp(num(payload.value), 0, 1.5);
        }, { history: false, reason: 'track-volume' });
        clearTimeout(this.commitTimer);
        this.commitTimer = setTimeout(() => {
          if (this.store.pendingSnapshot !== null) this.store.end('track-volume');
        }, 700);
      } else if (action === 'add-audio-track') this.addTrack('audio');
      else if (action === 'project-prop') this.setProjectValue(payload.path, payload.value, { live: payload.live });
      else if (action === 'project-boolean') this.setProjectValue(payload.path, payload.value, { live: false });
      else if (action === 'subtitle-style') this.setSubtitleStyle(payload.key, payload.value, payload.live);
      else if (action === 'font-preview') this.updateFontPreview(payload.value);
    } catch (error) {
      toast(`That action could not be completed: ${error.message || error}`, 'error', 6000);
      console.error(error);
    }
  }

  updateFontPreview(fontId) {
    const preview = this.panel.root?.querySelector('.ve-font-preview');
    if (!preview) return;
    const stacks = {
      sans: '"Inter", "Segoe UI", system-ui, sans-serif',
      serif: 'Georgia, "Times New Roman", serif',
      mono: 'Consolas, monospace',
      rounded: '"Segoe UI", system-ui, sans-serif',
      display: 'Impact, "Arial Black", sans-serif',
      arabic: '"Segoe UI", "Noto Naskh Arabic", Tahoma, sans-serif',
      devanagari: '"Nirmala UI", "Noto Sans Devanagari", Mangal, sans-serif',
      cjk: '"Microsoft YaHei", "PingFang SC", Yu Gothic, sans-serif'
    };
    preview.style.fontFamily = stacks[fontId] || stacks.sans;
  }

  exportSubtitles(format) {
    const items = this.store.project.subtitles.items;
    if (!items.length) {
      toast('There are no subtitle cues to export.', 'info');
      return;
    }
    const content = format === 'vtt' ? toVtt(items) : toSrt(items);
    const mime = format === 'vtt' ? 'text/vtt' : 'application/x-subrip';
    downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), `${sanitizeFilename(this.store.project.name, 'subtitles')}.${format}`);
    toast(`${format.toUpperCase()} downloaded with ${items.length} cue${items.length === 1 ? '' : 's'}.`, 'success');
  }

  async importSubtitles(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const extension = /\.vtt$/i.test(file.name) ? 'vtt' : 'srt';
      const entries = parseSubtitleFile(text, extension);
      if (!entries.length) throw new Error('No timed cues were found in this file.');
      this.store.apply((draft) => {
        for (const entry of entries) {
          draft.subtitles.items.push({ id: uid('sub'), start: entry.start, end: entry.end, text: entry.text });
        }
        draft.subtitles.items.sort((a, b) => a.start - b.start);
      }, { reason: 'import-subtitles' });
      this.setCategory('subtitles');
      this.preview.scheduleRender();
      this.timeline.render();
      this.scheduleAutosave();
      toast(`${entries.length} subtitle cue${entries.length === 1 ? '' : 's'} imported.`, 'success');
    } catch (error) {
      toast(`Subtitles could not be imported: ${error.message || error}`, 'error', 6000);
    }
  }

  /* Asset menu ----------------------------------------------------------- */

  showAssetMenu(assetId, anchor) {
    const asset = this.media.get(assetId);
    if (!asset) return;
    this.showPopover(anchor, [
      { label: 'Add to timeline', action: () => this.addAssetToTimeline(assetId) },
      { label: 'Rename', action: () => this.renameMedia(assetId) },
      { label: 'Replace file', action: () => {
        this.replaceAssetId = assetId;
        this.openMediaPicker(asset.type === 'video' ? 'video/*' : asset.type === 'audio' ? 'audio/*' : 'image/*', 'replace');
      } },
      { label: 'Remove from media', danger: true, action: () => this.removeMedia(assetId) }
    ]);
  }

  showPopover(anchor, items) {
    this.closePopover();
    if (!anchor) return;
    const pop = document.createElement('div');
    pop.className = 've-popover';
    pop.setAttribute('role', 'menu');
    pop.innerHTML = items.map((item, index) => `<button type="button" role="menuitem" data-pop-index="${index}" class="${item.danger ? 'is-danger' : ''}">${escapeHtml(item.label)}</button>`).join('');
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const width = 218;
    pop.style.left = `${Math.min(window.innerWidth - width - 10, Math.max(10, rect.right - width))}px`;
    pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 10, rect.bottom + 6)}px`;
    pop.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pop-index]');
      if (!button) return;
      const item = items[Number(button.dataset.popIndex)];
      this.closePopover();
      item?.action();
    });
    this.activePopover = pop;
    this.popoverAnchor = anchor;
    setTimeout(() => document.addEventListener('pointerdown', this._outsidePopover = (event) => {
      if (!pop.contains(event.target) && !anchor.contains(event.target)) this.closePopover();
    }, { once: true }), 0);
  }

  closePopover() {
    if (this.activePopover) {
      this.activePopover.remove();
      this.activePopover = null;
    }
    this.popoverAnchor = null;
    if (this._outsidePopover) {
      document.removeEventListener('pointerdown', this._outsidePopover);
      this._outsidePopover = null;
    }
  }

  /* Workspace, mobile and resizers --------------------------------------- */

  isMobile() {
    return window.matchMedia('(max-width: 899px)').matches;
  }

  openSheet(name) {
    this.closeProjectMenu();
    this.sheetTrigger = document.activeElement;
    this.app.dataset.mobileSheet = name;
    this.sheetBackdrop.hidden = false;
    this.app.querySelectorAll('[data-open-sheet]').forEach((button) => {
      button.setAttribute('aria-expanded', String(button.dataset.openSheet === name));
    });
    if (name === 'inspector') this.inspector.render();
    if (name === 'library') this.panel.render();
    const close = this.app.querySelector(name === 'library' ? '#ve-library-close' : '#ve-inspector-close');
    setTimeout(() => focusWithoutScroll(close), 40);
  }

  closeSheet() {
    this.app.dataset.mobileSheet = 'none';
    this.sheetBackdrop.hidden = true;
    this.app.querySelectorAll('[data-open-sheet]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    if (this.sheetTrigger && document.contains(this.sheetTrigger)) focusWithoutScroll(this.sheetTrigger);
    this.sheetTrigger = null;
  }

  bindMobile() {
    this.app.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-open-sheet]');
      if (opener) {
        const name = opener.dataset.openSheet;
        if (this.app.dataset.mobileSheet === name) this.closeSheet();
        else this.openSheet(name);
        return;
      }
      if (event.target.closest('[data-mobile-close-panel]') || event.target.closest('#ve-library-close') || event.target.closest('#ve-inspector-close')) {
        this.closeSheet();
      }
      if (event.target.closest('#ve-mobile-export')) this.exporter.open();
      if (event.target.closest('#ve-mobile-menu')) this.toggleProjectMenu();
    });
    this.sheetBackdrop.addEventListener('click', () => this.closeSheet());
    window.addEventListener('resize', () => {
      if (!this.isMobile()) this.closeSheet();
      this.preview.layout();
    });
  }

  bindResizers() {
    this.app.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-resizer]');
      if (!handle || this.isMobile()) return;
      event.preventDefault();
      const kind = handle.dataset.resizer;
      const ws = this.store.workspace;
      this.resizer = {
        kind,
        startX: event.clientX,
        startY: event.clientY,
        libraryWidth: ws.libraryWidth,
        inspectorWidth: ws.inspectorWidth,
        timelineHeight: ws.timelineHeight,
        pointerId: event.pointerId
      };
      handle.setPointerCapture?.(event.pointerId);
      this.app.classList.add('is-resizing');
      window.addEventListener('pointermove', this._resizeMove = (moveEvent) => this.onResizerMove(moveEvent), { passive: false });
      window.addEventListener('pointerup', this._resizeUp = () => this.onResizerUp(), { once: true });
      window.addEventListener('pointercancel', this._resizeUp, { once: true });
    });
    this.app.addEventListener('keydown', (event) => {
      const handle = event.target.closest('[data-resizer]');
      if (!handle) return;
      const step = event.shiftKey ? 24 : 8;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (handle.dataset.resizer === 'library') this.store.workspace.libraryWidth = clamp(this.store.workspace.libraryWidth + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 240, 440);
      if (handle.dataset.resizer === 'inspector') this.store.workspace.inspectorWidth = clamp(this.store.workspace.inspectorWidth + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), 250, 420);
      if (handle.dataset.resizer === 'timeline') this.store.workspace.timelineHeight = clamp(this.store.workspace.timelineHeight + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), 150, 540);
      this.applyWorkspace();
      this.saveWorkspace();
    });
  }

  onResizerMove(event) {
    if (!this.resizer) return;
    event.preventDefault();
    const dx = event.clientX - this.resizer.startX;
    const dy = event.clientY - this.resizer.startY;
    if (this.resizer.kind === 'library') this.store.workspace.libraryWidth = clamp(this.resizer.libraryWidth + dx, 240, 440);
    if (this.resizer.kind === 'inspector') this.store.workspace.inspectorWidth = clamp(this.resizer.inspectorWidth - dx, 250, 420);
    if (this.resizer.kind === 'timeline') this.store.workspace.timelineHeight = clamp(this.resizer.timelineHeight - dy, 150, 540);
    this.applyWorkspace();
  }

  onResizerUp() {
    if (!this.resizer) return;
    this.resizer = null;
    this.app.classList.remove('is-resizing');
    window.removeEventListener('pointermove', this._resizeMove);
    window.removeEventListener('pointerup', this._resizeUp);
    window.removeEventListener('pointercancel', this._resizeUp);
    this.saveWorkspace();
    this.preview.layout();
  }

  /* Topbar, menus and dialogs -------------------------------------------- */

  bindTopbar() {
    this.projectName.addEventListener('change', () => {
      const name = this.projectName.value.trim().slice(0, 80) || 'Untitled project';
      this.store.apply((draft) => { draft.name = name; }, { reason: 'project-name' });
      this.projectName.value = name;
      this.scheduleAutosave();
    });
    this.projectName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.projectName.blur();
    });
    this.undoButton.addEventListener('click', () => this.undo());
    this.redoButton.addEventListener('click', () => this.redo());
    $('#ve-export-open').addEventListener('click', () => this.exporter.open());
    $('#ve-help-open').addEventListener('click', () => this.helpDialog.showModal());
    this.projectMenuButton.addEventListener('click', () => this.toggleProjectMenu());
    $('#ve-restore-button').addEventListener('click', () => this.restorePendingProject());
    $('#ve-restore-discard').addEventListener('click', () => this.discardPendingRestore());
    $('#ve-relink-button').addEventListener('click', () => {
      this.replaceAssetId = null;
      this.relinkMode = true;
      this.mediaInput.value = '';
      this.mediaInput.accept = 'video/*,image/*,audio/*';
      this.mediaInput.click();
    });
    $('#ve-zoom-in').addEventListener('click', () => {
      this.preview.setZoom(this.store.previewZoom + 0.1);
      this.panel.render();
    });
    $('#ve-zoom-out').addEventListener('click', () => {
      this.preview.setZoom(this.store.previewZoom - 0.1);
      this.panel.render();
    });
    $('#ve-zoom-fit').addEventListener('click', () => {
      this.preview.zoomToFit();
      this.panel.render();
    });
    $('#ve-fullscreen').addEventListener('click', () => this.preview.fullscreen());
    this.previewQuality.addEventListener('change', () => {
      this.preview.quality = this.previewQuality.value;
      this.preview.layout();
      this.preview.scheduleRender();
    });    this.projectMenu.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-project-action]');
      if (!button) return;
      this.closeProjectMenu();
      const action = button.dataset.projectAction;
      if (action === 'undo') this.undo();
      else if (action === 'redo') this.redo();
      else if (action === 'new') this.newProject();
      else if (action === 'save') this.saveProjectFile();
      else if (action === 'open') this.openInput.click();
      else if (action === 'canvas') this.setCategory('canvas', { openSheet: this.isMobile() });
      else if (action === 'help') this.helpDialog.showModal();
      else if (action === 'clear-autosave') {
        const ok = await confirmAction('Clear the autosaved project and stored media from this browser? Your currently open project is not changed.', {
          title: 'Clear autosave', confirmLabel: 'Clear autosave', danger: true
        });
        if (ok) {
          await clearAutosave();
          this.setSaveStatus('Autosave cleared');
          toast('Autosaved data cleared.', 'info');
        }
      }
    });
  }

  toggleProjectMenu() {
    const open = this.projectMenu.hidden;
    this.projectMenu.hidden = !open;
    this.projectMenuButton.setAttribute('aria-expanded', String(open));
    this.mobileMenuButton?.setAttribute('aria-expanded', String(open));
    this.projectMenuWrap?.classList.toggle('is-mobile-open', open && this.isMobile());
    if (open) {
      setTimeout(() => {
        document.addEventListener('pointerdown', this._outsideMenu = (event) => {
          if (!this.projectMenu.contains(event.target) && !this.projectMenuButton.contains(event.target) && !this.mobileMenuButton?.contains(event.target)) this.closeProjectMenu();
        }, { once: true });
      }, 0);
    }
  }

  closeProjectMenu() {
    this.projectMenu.hidden = true;
    this.projectMenuButton.setAttribute('aria-expanded', 'false');
    this.mobileMenuButton?.setAttribute('aria-expanded', 'false');
    this.projectMenuWrap?.classList.remove('is-mobile-open');
    if (this._outsideMenu) {
      document.removeEventListener('pointerdown', this._outsideMenu);
      this._outsideMenu = null;
    }
  }

  bindProjectMenu() {
    document.addEventListener('click', (event) => {
      if (!this.activePopover) return;
      if (this.activePopover.contains(event.target)) return;
      if (this.popoverAnchor?.contains(event.target)) return;
      this.closePopover();
    });
  }

  undo() {
    this.preview.pause();
    if (!this.store.undo()) return;
    this.store.prune();
    this.timeline.render();
    this.inspector.render();
    this.preview.layout();
    this.preview.scheduleRender();
    this.updateAll();
    this.panel.render();
    this.scheduleAutosave();
  }

  redo() {
    this.preview.pause();
    if (!this.store.redo()) return;
    this.store.prune();
    this.timeline.render();
    this.inspector.render();
    this.preview.layout();
    this.preview.scheduleRender();
    this.updateAll();
    this.panel.render();
    this.scheduleAutosave();
  }

  bindDialogs() {
    this.helpDialog?.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => this.helpDialog.close());
    });
  }

  bindInputs() {
    this.mediaInput.addEventListener('change', async () => {
      const files = [...this.mediaInput.files];
      const target = this.mediaInput.dataset.target;
      const replaceId = target === 'replace' ? this.replaceAssetId : null;
      const relink = this.mediaInput.dataset.relink === '1' || this.relinkMode;
      this.mediaInput.dataset.target = '';
      this.mediaInput.dataset.relink = '';
      this.relinkMode = false;
      if (files.length) await this.importFiles(files, { replaceAssetId: replaceId, relink });
      this.mediaInput.value = '';
    });
    this.replaceInput.addEventListener('change', async () => {
      const file = this.replaceInput.files?.[0];
      const assetId = this.replaceAssetId;
      this.replaceAssetId = null;
      this.replaceInput.value = '';
      if (file && assetId) await this.importFiles([file], { replaceAssetId: assetId });
    });
    this.openInput.addEventListener('change', async () => {
      const file = this.openInput.files?.[0];
      this.openInput.value = '';
      if (file) await this.openProjectFile(file);
    });
    this.subtitleInput.addEventListener('change', async () => {
      const file = this.subtitleInput.files?.[0];
      this.subtitleInput.value = '';
      if (file) await this.importSubtitles(file);
    });
  }

  /* Playback ------------------------------------------------------------- */

  bindTransport() {
    this.playButton.addEventListener('click', () => this.preview.toggle());
    this.prevFrame.addEventListener('click', () => {
      this.preview.pause();
      this.preview.stepFrames(-1);
    });
    this.nextFrame.addEventListener('click', () => {
      this.preview.pause();
      this.preview.stepFrames(1);
    });
    this.scrub.addEventListener('input', () => {
      const value = Number(this.scrub.value);
      this.preview.pause();
      this.preview.seek(value);
    });
    this.rateSelect.addEventListener('change', () => {
      this.preview.setRate(Number(this.rateSelect.value) || 1);
      this.rateSelect.value = String(this.preview.rate);
    });
  }

  /* Keyboard ------------------------------------------------------------- */

  bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      if (event.key === 'Escape') {
        if (typing) {
          event.target.blur();
          return;
        }
        if (this.activePopover) this.closePopover();
        else if (!this.projectMenu.hidden) this.closeProjectMenu();
        else if (this.app.dataset.mobileSheet !== 'none') this.closeSheet();
        else if (this.helpDialog.open) this.helpDialog.close();
        return;
      }
      if (typing) return;
      const interactive = event.target instanceof Element &&
        event.target.closest('button, a, summary, [role="button"], [role="menuitem"], [role="tab"]');
      if (event.key === ' ' && interactive) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        this.store.selectAll();
        this.store.emit('selection');
        this.timeline.render();
        this.inspector.render();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.saveProjectFile();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        if (this.copySelection()) event.preventDefault();
        return;
      }
      if (mod && event.key.toLowerCase() === 'x') {
        if (this.copySelection()) {
          event.preventDefault();
          this.deleteSelection();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        if (this.pasteClipboard()) event.preventDefault();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this.duplicateSelection();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        this.preview.toggle();
        return;
      }
      if (event.key.toLowerCase() === 's' && !mod) {
        event.preventDefault();
        this.splitSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (this.store.selection.size || this.store.selectedSubtitle) {
          event.preventDefault();
          this.deleteSelection();
        }
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        if (this.store.selection.size && !event.altKey) this.nudgeSelection(direction * (event.shiftKey ? 1 : 0.1));
        else {
          this.preview.pause();
          this.preview.stepFrames(direction);
        }
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        this.preview.seek(0);
      }
      if (event.key === 'End') {
        event.preventDefault();
        this.preview.seek(this.editorDuration());
      }
    });
  }

  /* Drag and drop -------------------------------------------------------- */

  bindDragDrop() {
    let dragDepth = 0;
    window.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      dragDepth += 1;
      this.dropveil.hidden = false;
    });
    window.addEventListener('dragleave', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) this.dropveil.hidden = true;
    });
    window.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    window.addEventListener('drop', async (event) => {
      const files = [...(event.dataTransfer?.files || [])];
      dragDepth = 0;
      this.dropveil.hidden = true;
      if (!files.length) return;
      event.preventDefault();
      await this.importFiles(files);
    });

    this.libraryPanel.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-asset-id]');
      if (!card) return;
      event.dataTransfer.setData('application/x-letitedit-media', card.dataset.assetId);
      event.dataTransfer.effectAllowed = 'copy';
    });
    this.timelineEl.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('application/x-letitedit-media')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    this.timelineEl.addEventListener('drop', (event) => {
      const assetId = event.dataTransfer?.getData('application/x-letitedit-media');
      if (!assetId) return;
      event.preventDefault();
      const lane = event.target.closest('[data-track-id]');
      let start = this.store.playhead;
      const content = this.timelineEl.querySelector('#ve-tl-content');
      if (content) {
        const rect = content.getBoundingClientRect();
        start = Math.max(0, (event.clientX - rect.left) / this.timeline.pps());
      }
      this.addAssetToTimeline(assetId, { start, trackId: lane?.dataset.trackId || null });
    });

    document.addEventListener('paste', async (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      await this.importFiles(files);
    });

    window.addEventListener('pagehide', () => {
      this.preview?.dispose();
      this.recorder?.dispose();
      this.media.clear();
    }, { once: true });
  }

  /* Utilities ------------------------------------------------------------ */

  exposeDebug() {
    const app = this;
    window.__videoEditor = {
      get state() { return app.store; },
      get project() { return app.store.project; },
      get store() { return app.store; },
      get media() { return app.media; },
      get preview() { return app.preview; },
      get timeline() { return app.timeline; },
      get inspector() { return app.inspector; },
      get panel() { return app.panel; },
      get exporter() { return app.exporter; },
      get recorder() { return app.recorder; },
      support: () => ({
        videoEncoder: typeof VideoEncoder === 'function',
        audioEncoder: typeof AudioEncoder === 'function',
        mediaRecorder: Boolean(window.MediaRecorder),
        getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
        getDisplayMedia: Boolean(navigator.mediaDevices?.getDisplayMedia),
        indexedDb: Boolean(window.indexedDB)
      }),
      importFiles: (files, options) => app.importFiles(files, options),
      addAssetToTimeline: (id, options) => app.addAssetToTimeline(id, options),
      addTextPreset: (id) => app.addTextPreset(id),
      addShape: (type) => app.addShape(type),
      addBackground: (kind) => app.addBackground(kind),
      addEmoji: (emoji) => app.addEmoji(emoji),
      addSubtitle: () => app.addSubtitle(),
      duplicateSubtitle: (id) => app.duplicateSubtitle(id),
      deleteSubtitle: (id) => app.deleteSubtitle(id),
      setCategory: (id) => app.setCategory(id),
      selectClip: (id) => {
        app.store.selectClip(id);
        app.store.emit('selection');
        app.timeline.render();
        app.inspector.render();
        app.preview.updateOverlay();
      },
      selectSubtitle: (id) => {
        app.store.selectSubtitle(id);
        app.store.emit('selection');
        app.timeline.render();
        app.inspector.render();
      },
      seek: (time) => app.preview.seek(time),
      play: () => app.preview.play(),
      pause: () => app.preview.pause(),
      split: () => app.splitSelection(),
      duplicate: () => app.duplicateSelection(),
      delete: () => app.deleteSelection(),
      paste: () => app.pasteClipboard(),
      copy: () => app.copySelection(),
      undo: () => app.undo(),
      redo: () => app.redo(),
      layerAction: (action) => app.layerAction(action),
      setProjectValue: (path, value) => app.setProjectValue(path, value, { live: false }),
      setSubtitleStyle: (key, value) => app.setSubtitleStyle(key, value, false),
      saveProjectFile: () => app.saveProjectFile(),
      openProjectData: async (data) => {
        const project = sanitizeProject(data.project || data);
        app.store.replaceProject(project);
        app.mediaManifest = data.mediaManifest || data.media || [];
        app.updateAll();
        app.preview.layout();
        app.preview.scheduleRender();
        app.timeline.render();
        app.inspector.render();
        app.updateRelinkBanner();
        return project;
      },
      exportToBlob: (overrides) => app.exporter.exportToBlob(overrides),
      saveWorkspace: () => app.saveWorkspace(),
      applyWorkspace: () => app.applyWorkspace(),
      getAudioDebug: () => app.preview?.audio?.debug?.(),
      duration: () => app.editorDuration(),
      requestAutosave: () => app.autosave(),
      restoreAutosave: () => app.restorePendingProject(),
      clearAutosave: () => clearAutosave(),
      getAutosave: () => loadAutosave(),
      storageEstimate: () => storageEstimate()
    };
  }
}

function splitKeyframes(clip, leftDuration, right) {
  const keys = clip.keyframes || {};
  for (const prop of Object.keys(keys)) {
    const leftKeys = [];
    const rightKeys = [];
    for (const frame of keys[prop] || []) {
      if (frame.t <= leftDuration + 1e-6) leftKeys.push({ ...frame });
      if (frame.t >= leftDuration - 1e-6) rightKeys.push({ ...frame, t: Math.max(0, frame.t - leftDuration) });
    }
    keys[prop] = leftKeys;
    right.keyframes[prop] = rightKeys;
  }
}

function sortDraftTrack(track) {
  track.clips.sort((a, b) => a.start - b.start);
}

const app = new VideoEditorApp();
app.init().catch((error) => {
  console.error('The video editor failed to start', error);
  const host = document.getElementById('ve-app');
  if (host) {
    const notice = document.createElement('div');
    notice.className = 've-fatal';
    notice.textContent = `The editor could not start: ${error.message || error}`;
    host.prepend(notice);
  }
});

export { app };
