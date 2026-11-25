/* LetitEdit Video Editor — studio application.
 *
 * The video is the workspace. One base video defines the project; everything
 * else is a layer placed at a moment. This module owns the shell wiring, the
 * moment actions, layer list, uploads, autosave, shortcuts and the debug API.
 */

import { MediaLibrary, classifyFile, validateFile } from '../media.js';
import { createClip, addClipToTrack, clipEnd } from '../model.js';
import { clipSourceTime, keyframeValue } from '../renderer.js';
import { TEXT_PRESETS, SHAPE_TYPES } from '../presets.js';
import { uid, clamp, deepClone, sanitizeFilename } from '../utils.js';
import { StudioStore, createEmptyProject } from './store.js';
import { Preview } from './preview.js';
import { Exporter } from './exporter.js';
import { Sheets, Toasts, icon, clock, durationLabel } from './ui.js';
import {
  openTextSheet,
  openClipSheet,
  openMediaSheet,
  openAudioSheet,
  openFilterSheet,
  openTransitionSheet,
  openProjectSheet,
  openExportSheet,
  openMenuSheet,
  openHelpSheet,
  openCaptionsSheet
} from './sheets.js';
import {
  saveLocal,
  loadLocal,
  clearLocal,
  downloadProjectFile,
  readProjectFile
} from './persistence.js';

const ASPECT_CHOICES = [
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '4:5', ratio: 4 / 5 }
];

const KIND_LABEL = {
  video: 'video',
  image: 'image',
  text: 'text',
  shape: 'graphic',
  audio: 'audio',
  background: 'background'
};

const KIND_ICON = {
  video: 'video',
  image: 'image',
  text: 'text',
  shape: 'shape',
  audio: 'audio',
  background: 'image'
};

function closestAspect(width, height) {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  let best = ASPECT_CHOICES[0];
  let distance = Infinity;
  for (const choice of ASPECT_CHOICES) {
    const gap = Math.abs(choice.ratio - ratio);
    if (gap < distance) {
      distance = gap;
      best = choice;
    }
  }
  return best.id;
}

function stripExtension(name) {
  return String(name || '').replace(/\.[a-z0-9]{1,6}$/i, '') || 'Untitled video';
}

function shortLabel(value, max = 26) {
  const text = String(value || '').trim() || 'Layer';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shotName(clip) {
  if (!clip) return '';
  if (clip.kind === 'text') {
    const line = String(clip.text?.content || '').split('\n')[0].trim();
    return shortLabel(clip.name && clip.name !== 'Text' ? clip.name : line || 'Text', 26);
  }
  return shortLabel(clip.name || KIND_LABEL[clip.kind] || 'Layer', 26);
}

class StudioApp {
  constructor() {
    this.store = new StudioStore(createEmptyProject());
    this.media = new MediaLibrary();
    this.sheets = null;
    this.toasts = null;
    this.preview = null;
    this.exporter = null;
    this.savedAt = 0;
    this.saveTimer = 0;
    this.saveToken = 0;
    this.restoring = false;
    this.exportRunning = false;
    this.lastExport = null;
    this.pendingRelink = new Map();
    this.stripToken = 0;
    this.stripSignature = '';
    this.layerFrame = 0;
    this.actionsFrame = 0;
    this.dom = {};
    this.onWindowScroll = this.onWindowScroll.bind(this);
  }

  /* ------------------------------------------------------------------ boot */

  async boot() {
    this.cacheDom();
    this.sheets = new Sheets(this.dom.sheetRoot);
    this.toasts = new Toasts(this.dom.toasts);
    this.exporter = new Exporter({
      store: this.store,
      media: this.media,
      onStatus: (message, tone) => this.toast(message, tone)
    });
    this.preview = new Preview({
      store: this.store,
      media: this.media,
      onTime: (time) => this.onTime(time),
      onStatus: (message, tone) => this.toast(message, tone),
      onSelect: () => {
        this.renderLayers();
        this.renderActions();
      },
      onRequestEdit: (clipId) => openClipSheet(this, clipId)
    });
    this.preview.mount(this.dom.stage);
    this.bindShell();
    this.bindKeyboard();
    this.bindStore();
    this.bindDrop();

    this.applyProjectInputValues();
    this.renderAll();
    this.setStatus('Ready');
    this.syncTopbarOffset();
    window.addEventListener('resize', () => this.syncTopbarOffset());
    window.addEventListener('pagehide', () => this.release());

    await this.restoreLocal();
    this.preview.layout();
    this.renderAll();
    this.exposeDebug();
  }

  cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      app: $('se-app'),
      stage: $('se-stage'),
      frame: $('se-frame'),
      projectName: $('se-project-name'),
      saveStatus: $('se-save-status'),
      undo: $('se-undo'),
      redo: $('se-redo'),
      save: $('se-save'),
      export: $('se-export'),
      menu: $('se-menu'),
      play: $('se-play'),
      time: $('se-time'),
      duration: $('se-duration'),
      mute: $('se-mute'),
      fullscreen: $('se-fullscreen'),
      seek: $('se-seek'),
      timeline: $('se-timeline'),
      filmstrip: $('se-filmstrip'),
      overlayLane: $('se-overlay-lane'),
      playhead: $('se-playhead'),
      momentLabel: $('se-moment-label'),
      momentHint: $('se-moment-hint'),
      actions: $('se-actions'),
      layers: $('se-layers'),
      layersToggle: $('se-layers-toggle'),
      layerList: $('se-layer-list'),
      layerCount: $('se-layer-count'),
      layersSub: $('se-layers-sub'),
      layersEmpty: $('se-layers-empty'),
      toolbar: document.querySelector('.se-toolbar'),
      uploadBase: $('se-upload-base'),
      fileInput: $('se-file-input'),
      projectInput: $('se-project-input'),
      sheetRoot: $('se-sheet-root'),
      toasts: $('se-toasts'),
      stageBadge: $('se-stage-badge')
    };
  }

  bindShell() {
    const { dom } = this;
    dom.projectName.addEventListener('change', () => {
      const name = dom.projectName.value.trim() || 'Untitled video';
      dom.projectName.value = name;
      this.edit(() => {
        this.store.project.name = name;
      }, 'project-name');
    });

    dom.undo.addEventListener('click', () => this.undo());
    dom.redo.addEventListener('click', () => this.redo());
    dom.save.addEventListener('click', () => this.saveProjectFile());
    dom.export.addEventListener('click', () => openExportSheet(this));
    dom.menu.addEventListener('click', () => {
      dom.menu.setAttribute('aria-expanded', 'true');
      const sheet = openMenuSheet(this);
      if (this.sheets.current) {
        const previous = this.sheets.current.onClose;
        this.sheets.current.onClose = () => {
          dom.menu.setAttribute('aria-expanded', 'false');
          previous?.();
        };
      }
      return sheet;
    });

    dom.play.addEventListener('click', () => this.togglePlay());
    dom.mute.addEventListener('click', () => this.toggleMute());
    dom.fullscreen.addEventListener('click', () => this.preview.fullscreen());
    dom.uploadBase.addEventListener('click', () => this.pickFile('video'));

    dom.seek.addEventListener('input', () => {
      this.preview.seek(Number(dom.seek.value));
    });
    dom.seek.addEventListener('change', () => {
      this.preview.seek(Number(dom.seek.value));
    });

    dom.layersToggle.addEventListener('click', () => {
      const expanded = dom.layersToggle.getAttribute('aria-expanded') === 'true';
      dom.layersToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });

    dom.toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (!button) return;
      const tool = button.dataset.tool;
      if (tool === 'media') openMediaSheet(this);
      else if (tool === 'text') openTextSheet(this);
      else if (tool === 'audio') openAudioSheet(this, this.store.selectedId);
      else if (tool === 'filter') openFilterSheet(this);
      else if (tool === 'layers') {
        dom.layersToggle.setAttribute('aria-expanded', 'true');
        dom.layers.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    dom.fileInput.addEventListener('change', () => {
      const files = [...(dom.fileInput.files || [])];
      dom.fileInput.value = '';
      if (files.length) this.importFiles(files);
    });
    dom.projectInput.addEventListener('change', () => {
      const file = dom.projectInput.files?.[0];
      dom.projectInput.value = '';
      if (file) this.loadProjectFile(file);
    });

    /* Timeline scrubbing. No preventDefault: a vertical swipe must still
     * scroll the page, and a tap or horizontal drag seeks. */
    let stripPointer = null;
    const seekFromClientX = (clientX) => {
      const rect = dom.timeline.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const duration = this.store.duration();
      this.preview.seek(ratio * duration);
    };
    dom.timeline.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('.se-overlay-chip')) return;
      stripPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      seekFromClientX(event.clientX);
    });
    dom.timeline.addEventListener('pointermove', (event) => {
      if (!stripPointer || event.pointerId !== stripPointer.id) return;
      const dx = Math.abs(event.clientX - stripPointer.x);
      const dy = Math.abs(event.clientY - stripPointer.y);
      if (dy > dx + 10) {
        stripPointer = null;
        return;
      }
      seekFromClientX(event.clientX);
    });
    const endStrip = (event) => {
      if (!stripPointer || (event && event.pointerId !== stripPointer.id)) return;
      stripPointer = null;
    };
    dom.timeline.addEventListener('pointerup', endStrip);
    dom.timeline.addEventListener('pointercancel', endStrip);
    dom.timeline.addEventListener('lostpointercapture', endStrip);

    window.addEventListener('scroll', this.onWindowScroll, { passive: true });
    window.addEventListener('resize', () => this.renderTimeline());
  }

  onWindowScroll() {
    /* Keep the sticky transport from covering the preview on short screens. */
    if (!this.dom.app) return;
    this.dom.app.classList.toggle('is-scrolled', window.scrollY > 24);
  }

  syncTopbarOffset() {
    const topbar = document.querySelector('.topbar');
    const height = topbar ? Math.round(topbar.getBoundingClientRect().height) : 0;
    this.dom.app?.style.setProperty('--se-topbar', `${height}px`);
  }

  bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      const editing =
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (this.sheets?.current) {
        if (event.key === 'Escape') this.sheets.close();
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
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
      if (editing) return;

      if (event.code === 'Space') {
        event.preventDefault();
        this.togglePlay();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 1;
        this.preview.seek(this.store.playhead + (event.key === 'ArrowLeft' ? -step : step));
      } else if (event.key === ',' || event.key === '.') {
        event.preventDefault();
        this.preview.stepFrames(event.key === ',' ? -1 : 1);
      } else if (event.key.toLowerCase() === 's' && !mod) {
        event.preventDefault();
        this.splitSelected();
      } else if (event.key.toLowerCase() === 't' && !mod) {
        event.preventDefault();
        openTextSheet(this);
      } else if (event.key.toLowerCase() === 'd' && !mod) {
        event.preventDefault();
        if (this.store.selectedId) this.duplicateClip(this.store.selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!this.store.selectedId) return;
        event.preventDefault();
        this.deleteClip(this.store.selectedId);
      } else if (event.key.toLowerCase() === 'm' && !mod) {
        this.toggleMute();
      } else if (event.key === 'Escape') {
        if (this.store.selectedId) {
          this.store.clearSelection();
          this.store.emit('selection');
          this.preview.updateOverlay();
          this.renderLayers();
          this.renderActions();
        }
      }
    });
  }

  bindStore() {
    this.store.subscribe((reason) => {
      if (reason === 'replace' || reason === 'undo' || reason === 'redo') {
        this.store.clampPlayhead();
        this.pendingRelink = this.pendingRelink || new Map();
      }
      if (!this.dom.undo) return;
      this.dom.undo.disabled = !this.store.canUndo();
      this.dom.redo.disabled = !this.store.canRedo();
      this.scheduleLayerRender();
      this.scheduleActionRender();
      this.scheduleTimelineRender();
      if (!this.restoring && !['selection', 'live-drag'].includes(reason)) this.scheduleSave();
      if (reason === 'undo' || reason === 'redo' || reason === 'replace') this.syncProjectName();
    });
  }

  bindDrop() {
    const stage = this.dom.stage;
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    stage.addEventListener('dragover', (event) => {
      stop(event);
      stage.classList.add('is-dragover');
    });
    stage.addEventListener('dragleave', (event) => {
      if (event.target === stage) stage.classList.remove('is-dragover');
    });
    stage.addEventListener('drop', (event) => {
      stop(event);
      stage.classList.remove('is-dragover');
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) this.importFiles(files);
    });
  }

  /* --------------------------------------------------------------- editing */

  edit(mutator, reason = 'edit') {
    if (this.store.pendingSnapshot !== null) this.store.end();
    const result = this.store.apply(mutator, { reason });
    this.afterLocalChange();
    return result;
  }

  live(mutator) {
    if (this.store.pendingSnapshot === null) this.store.begin();
    return this.store.live(mutator);
  }

  commit(reason = 'commit') {
    return this.store.end(reason);
  }

  afterLocalChange() {
    this.store.clampPlayhead();
    this.syncProjectName();
    this.renderTransport();
    this.preview?.scheduleRender();
  }

  undo() {
    if (!this.store.undo()) {
      this.toast('Nothing to undo.', 'info');
      return false;
    }
    this.preview?.pause();
    this.renderAll();
    return true;
  }

  redo() {
    if (!this.store.redo()) {
      this.toast('Nothing to redo.', 'info');
      return false;
    }
    this.preview?.pause();
    this.renderAll();
    return true;
  }

  togglePlay() {
    if (this.exportRunning) {
      this.toast('Export is running. Pause the export before playing the preview.', 'warn');
      return;
    }
    this.preview.toggle();
    this.syncPlayButton();
  }

  toggleMute() {
    this.preview.setMuted(!this.store.previewMuted);
    this.syncMuteButton();
    this.toast(this.store.previewMuted ? 'Preview sound muted.' : 'Preview sound on.', 'info', 1600);
  }

  syncPlayButton() {
    const playing = this.preview?.playing;
    this.dom.play.classList.toggle('is-playing', Boolean(playing));
    this.dom.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.dom.play.setAttribute('title', playing ? 'Pause (Space)' : 'Play (Space)');
  }

  syncMuteButton() {
    const muted = Boolean(this.store.previewMuted);
    this.dom.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    this.dom.mute.setAttribute('aria-label', muted ? 'Unmute preview sound' : 'Mute preview sound');
  }

  setClipVolume(clip, value) {
    const list = clip.keyframes?.volume;
    if (!list || !list.length) {
      clip.volume = value;
      return;
    }
    const local = clamp(this.store.playhead - clip.start, 0, Math.max(0, clip.duration));
    const existing = list.find((entry) => Math.abs(entry.t - local) < 0.02);
    if (existing) existing.v = value;
    else {
      list.push({ t: local, v: value, ease: 'linear' });
      list.sort((a, b) => a.t - b.t);
    }
  }

  /* ------------------------------------------------------------- media flow */

  pickFile(kind = 'video') {
    const accept =
      kind === 'audio' ? 'audio/*' : kind === 'image' ? 'image/*' : 'video/*';
    this.dom.fileInput.accept = `${accept},${kind === 'video' ? 'image/*,audio/*' : 'video/*,image/*,audio/*'}`;
    this.dom.fileInput.value = '';
    this.dom.fileInput.click();
  }

  async importFiles(files) {
    let firstError = null;
    for (const file of files) {
      const invalid = validateFile(file);
      if (invalid) {
        firstError = invalid;
        continue;
      }
      try {
        await this.importOne(file);
      } catch (error) {
        firstError = error.message || String(error);
      }
    }
    if (firstError) this.toast(firstError, 'error', 5200);
    this.renderAll();
    this.scheduleSave();
  }

  async importOne(file) {
    const type = classifyFile(file);
    this.setStatus('Reading file…', 'warn');
    const savedId = this.pendingRelink.get(file.name);
    let asset = null;
    try {
      asset = await this.media.addFile(file);
    } catch (error) {
      this.setStatus('Ready');
      throw error;
    }
    if (savedId) {
      if (asset.id !== savedId) {
        this.media.assets.delete(asset.id);
        asset.id = savedId;
        this.media.assets.set(savedId, asset);
      }
      this.pendingRelink.delete(file.name);
      this.toast(`${file.name} relinked to the saved project.`, 'ok');
      this.setStatus('Ready');
      return asset;
    }
    if (type === 'video') this.addVideoAsset(asset);
    else if (type === 'audio') this.addAudioAsset(asset);
    else this.addImageAsset(asset);
    this.setStatus('Ready');
    return asset;
  }

  baseIsEmpty() {
    return this.store.baseTrack().clips.length === 0;
  }

  addVideoAsset(asset) {
    if (!asset) return null;
    if (this.baseIsEmpty()) return this.addBaseVideo(asset);
    return this.edit(() => {
      const track = this.store.addOverlayTrack(shortLabel(asset.name, 28));
      const start = this.safeStart(asset.duration);
      const clip = createClip('video', {
        mediaId: asset.id,
        name: asset.name,
        start,
        duration: Math.max(0.2, Math.min(asset.duration, 600)),
        inPoint: 0,
        outPoint: Math.max(0.2, Math.min(asset.duration, 600)),
        x: 0.72,
        y: 0.26,
        scale: 0.46,
        fit: 'contain'
      });
      addClipToTrack(track, clip);
      this.store.select(clip.id);
      this.store.emit('selection');
      this.preview.seek(clip.start + 0.001);
      this.toast(`${asset.name} added as a layer at ${clock(clip.start)}. Drag it in the preview.`, 'ok');
      return clip;
    }, 'add-video-layer');
  }

  addBaseVideo(asset) {
    const clip = this.edit(() => {
      const base = this.store.baseTrack();
      const duration = Math.max(0.2, Number(asset.duration) || 0.2);
      const clip = createClip('video', {
        mediaId: asset.id,
        name: asset.name,
        start: 0,
        duration,
        inPoint: 0,
        outPoint: duration,
        fit: 'contain'
      });
      addClipToTrack(base, clip);
      const project = this.store.project;
      project.aspect = closestAspect(asset.width, asset.height);
      project.resolution = '1080';
      project.fps = Math.max(1, Math.min(60, Math.round(Number(asset.fps) || 30)));
      if (!project.name || project.name === 'Untitled project' || project.name === 'Untitled video') {
        project.name = stripExtension(asset.name);
      }
      this.store.select(null);
      return clip;
    }, 'add-base-video');
    this.syncProjectName();
    this.preview.seek(0);
    this.preview.layout();
    this.toast(
      `Main video loaded: ${durationLabel(Number(asset.duration) || 0)}. Drag the strip to a moment, then choose an action.`,
      'ok',
      5200
    );
    return clip;
  }

  addImageAsset(asset) {
    if (!asset) return null;
    return this.edit(() => {
      const track = this.store.addOverlayTrack(shortLabel(asset.name, 28));
      const start = this.safeStart(5);
      const clip = createClip('image', {
        mediaId: asset.id,
        name: asset.name,
        start,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        x: 0.5,
        y: 0.5,
        scale: 0.62,
        fit: 'contain'
      });
      addClipToTrack(track, clip);
      this.store.select(clip.id);
      this.store.emit('selection');
      this.preview.seek(clip.start + 0.001);
      this.toast('Image added. Drag or resize it directly in the preview.', 'ok');
      return clip;
    }, 'add-image-layer');
  }

  addAudioAsset(asset) {
    if (!asset) return null;
    return this.edit(() => {
      const track = this.store.addAudioTrack(shortLabel(asset.name, 28));
      const start = this.safeStart(asset.duration);
      const duration = Math.max(0.2, Math.min(Number(asset.duration) || 0.2, 900));
      const clip = createClip('audio', {
        mediaId: asset.id,
        name: asset.name,
        start,
        duration,
        inPoint: 0,
        outPoint: duration,
        volume: 0.85
      });
      addClipToTrack(track, clip);
      this.store.select(clip.id);
      this.store.emit('selection');
      this.preview.seek(clip.start + 0.001);
      this.toast('Audio added at the playhead. Set volume and fades in the Audio panel.', 'ok');
      return clip;
    }, 'add-audio-layer');
  }

  /* Placement for a new layer: at the playhead, pulled back when the
   * playhead sits at the very end so the layer is visible. */
  safeStart(duration) {
    const total = this.store.duration();
    const playhead = this.store.playhead;
    if (total <= 0) return 0;
    if (playhead + 0.2 >= total) return Math.max(0, total - Math.min(Number(duration) || 1, Math.max(0.5, total)));
    return playhead;
  }

  addTextPreset(key) {
    const preset = TEXT_PRESETS[key];
    if (!preset) return null;
    const clip = this.edit(() => {
      const track = this.store.addOverlayTrack(shortLabel(preset.name, 28));
      const duration = Math.max(0.5, preset.duration || 3);
      const clip = createClip('text', {
        name: preset.name,
        start: this.safeStart(duration),
        duration,
        x: preset.x ?? preset.text?.x ?? 0.5,
        y: preset.y ?? preset.text?.y ?? 0.5,
        opacity: 1
      });
      Object.assign(clip.text, preset.text || {});
      if (preset.inAnim) clip.inAnim = { ...clip.inAnim, ...preset.inAnim };
      if (preset.outAnim) clip.outAnim = { ...clip.outAnim, ...preset.outAnim };
      addClipToTrack(track, clip);
      this.store.select(clip.id);
      this.store.emit('selection');
      this.preview.seek(clip.start + 0.001);
      return clip;
    }, 'add-text');
    this.toast(`${preset.label} added. Type your words in the panel.`, 'ok');
    return clip;
  }

  addShape(shapeId) {
    const shape = SHAPE_TYPES.find((entry) => entry.id === shapeId) || SHAPE_TYPES[0];
    return this.edit(() => {
      const track = this.store.addOverlayTrack(shape.label);
      const clip = createClip('shape', {
        name: shape.label,
        start: this.safeStart(4),
        duration: 4,
        x: 0.5,
        y: 0.5
      });
      clip.shape.type = shape.id;
      if (shape.id === 'circle') {
        clip.shape.width = 0.32;
        clip.shape.height = 0.32;
        clip.shape.radius = 999;
      } else if (shape.id === 'line') {
        clip.shape.width = 0.6;
        clip.shape.height = 0.08;
        clip.shape.strokeWidth = 4;
        clip.shape.fill = '#ffffff';
      } else if (shape.id === 'arrow') {
        clip.shape.width = 0.52;
        clip.shape.height = 0.24;
      }
      addClipToTrack(track, clip);
      this.store.select(clip.id);
      this.store.emit('selection');
      this.preview.seek(clip.start + 0.001);
      return clip;
    }, 'add-shape');
  }

  addSticker(character) {
    return this.edit(() => {
      const track = this.store.addOverlayTrack('Sticker');
      const clip = createClip('text', {
        name: 'Sticker',
        start: this.safeStart(3),
        duration: 3,
        x: 0.5,
        y: 0.5
      });
      Object.assign(clip.text, {
        content: character,
        size: 150,
        bold: false,
        bgOpacity: 0,
        shadow: false,
        maxWidth: 0.4
      });
      addClipToTrack(track, clip);
      this.store.select(clip.id);
      this.store.emit('selection');
      this.preview.seek(clip.start + 0.001);
      return clip;
    }, 'add-sticker');
  }

  /* -------------------------------------------------------------- clip ops */

  splitSelected() {
    const selected = this.store.selected();
    if (selected) {
      this.splitClip(selected.clip.id);
      return;
    }
    const found = this.store.baseClipAt(this.store.playhead);
    if (found) this.splitClip(found.id);
    else this.toast('Select a layer or move the playhead inside one to split.', 'info');
  }

  splitClip(clipId) {
    const found = this.store.trackForClip(clipId);
    if (!found) return null;
    const { clip, track } = found;
    const local = this.store.playhead - clip.start;
    if (local < 0.05 || local > clip.duration - 0.05) {
      this.preview.seek(clip.start + Math.min(0.1, clip.duration / 2));
      this.toast('Move the playhead inside the clip, away from its edges, to split it.', 'warn');
      return null;
    }
    const right = this.edit(() => {
      const clone = deepClone(clip);
      clone.id = uid('clip');
      clone.start = clip.start + local;
      clone.duration = clip.duration - local;
      if (clip.kind === 'video' || clip.kind === 'audio') {
        const speed = Math.max(0.05, Number(clip.speed) || 1);
        clone.inPoint = Math.min(clip.outPoint || Infinity, clip.inPoint + local * speed);
      }
      const split = splitKeyframes(clip.keyframes, local, clip);
      clip.keyframes = split.left;
      clone.keyframes = split.right;
      clip.duration = local;
      if (clip.kind === 'video' || clip.kind === 'audio') {
        const speed = Math.max(0.05, Number(clip.speed) || 1);
        clip.outPoint = Math.min(clip.outPoint || Infinity, clip.inPoint + local * speed);
      }
      clone.name = clip.name ? `${clip.name} · 2` : clip.name;
      track.clips.push(clone);
      track.clips.sort((a, b) => a.start - b.start);
      this.store.select(clone.id);
      return clone;
    }, 'split-clip');
    if (right) {
      this.store.emit('selection');
      this.preview.seek(right.start + 0.001);
      this.toast('Clip split at the playhead.', 'ok');
    }
    return right;
  }

  duplicateClip(clipId) {
    const found = this.store.trackForClip(clipId);
    if (!found) return null;
    const { clip, track } = found;
    const isBase = this.store.isBaseClip(clip);
    const clone = this.edit(() => {
      const copy = deepClone(clip);
      copy.id = uid('clip');
      copy.name = clip.name ? `${clip.name} copy` : 'Copy';
      copy.keyframes = deepClone(clip.keyframes);
      if (isBase) {
        copy.start = clipEnd(clip);
        addClipToTrack(track, copy);
      } else {
        const target = this.store.addOverlayTrack(shortLabel(copy.name, 28));
        copy.start = clip.start;
        copy.x = clamp((Number(clip.x) || 0.5) + 0.04, -0.2, 1.2);
        copy.y = clamp((Number(clip.y) || 0.5) + 0.04, -0.2, 1.2);
        addClipToTrack(target, copy);
      }
      this.store.select(copy.id);
      return copy;
    }, 'duplicate');
    if (clone) {
      this.store.emit('selection');
      this.preview.seek(clone.start + 0.001);
      this.toast('Layer duplicated.', 'ok');
    }
    return clone;
  }

  deleteClip(clipId) {
    const found = this.store.trackForClip(clipId);
    if (!found) return false;
    const name = shotName(found.clip);
    const ok = this.edit(() => this.store.removeClipEverywhere(clipId), 'delete');
    if (ok) {
      this.store.emit('selection');
      this.preview.updateOverlay();
      this.toast(`${name} removed. Undo restores it.`, 'ok');
    }
    return ok;
  }

  moveLayer(clipId, direction) {
    const found = this.store.trackForClip(clipId);
    if (!found || found.track.kind !== 'video') {
      this.toast('Audio layers do not change the visual stacking.', 'info');
      return false;
    }
    const base = this.store.baseTrack();
    if (found.track.id === base.id) {
      this.toast('The main video always sits at the back.', 'info');
      return false;
    }
    const order = this.store.project.tracks.filter((track) => track.kind === 'video' && track.id !== base.id);
    const index = order.indexOf(found.track);
    if (index === -1) return false;
    let target = index;
    if (direction === 'front') target = 0;
    else if (direction === 'back') target = order.length - 1;
    else if (direction === 'up') target = index - 1;
    else if (direction === 'down') target = index + 1;
    target = clamp(target, 0, order.length - 1);
    if (target === index) {
      this.toast(direction === 'front' || direction === 'up' ? 'This layer is already at the front.' : 'This layer is already at the back.', 'info');
      return false;
    }
    this.edit(() => {
      order.splice(index, 1);
      order.splice(target, 0, found.track);
      const audio = this.store.project.tracks.filter((track) => track.kind !== 'video');
      this.store.project.tracks = [...order, base, ...audio];
    }, 'layer-order');
    this.toast(direction === 'front' || direction === 'up' ? 'Layer moved forward.' : 'Layer moved back.', 'ok', 1800);
    return true;
  }

  toggleLayerVisibility(clipId) {
    const found = this.store.trackForClip(clipId);
    if (!found) return;
    const base = this.store.isBaseClip(found.clip);
    this.edit(() => {
      if (base) found.track.hidden = !found.track.hidden;
      else if (found.track.kind === 'audio') found.clip.muted = !found.clip.muted;
      else found.clip.hidden = !found.clip.hidden;
    }, 'layer-visibility');
    this.preview.updateOverlay();
  }

  /* ----------------------------------------------------------------- projects */

  saveProjectFile() {
    const payload = downloadProjectFile(this.store.project, this.media.list());
    this.toast(
      `${sanitizeFilename(this.store.project.name || 'video', 'video')}.letitedit.json downloaded. Media metadata is included; the video files are not.`,
      'ok',
      5200
    );
    return payload;
  }

  openProjectFile() {
    this.dom.projectInput.value = '';
    this.dom.projectInput.click();
  }

  async loadProjectFile(file) {
    try {
      const restored = await readProjectFile(file);
      this.restoring = true;
      this.preview?.pause();
      this.media.clear();
      this.store.replaceProject(restored.project);
      this.store.playhead = 0;
      this.store.clearSelection();
      this.pendingRelink = new Map((restored.media || []).map((entry) => [entry.name, entry.id]));
      this.restoring = false;
      this.syncProjectName();
      this.renderAll();
      this.preview.layout();
      const missing = restored.media?.length || 0;
      this.toast(
        missing
          ? 'Project opened. Re-import the original media files in the Media panel to relink the layers.'
          : 'Project opened.',
        missing ? 'warn' : 'ok',
        5600
      );
      if (missing) openMediaSheet(this);
      this.scheduleSave();
    } catch (error) {
      this.toast(error.message || String(error), 'error', 5200);
    }
  }

  newProject() {
    this.preview?.pause();
    this.media.clear();
    this.pendingRelink.clear();
    this.store.replaceProject(createEmptyProject());
    this.store.playhead = 0;
    this.store.clearSelection();
    this.syncProjectName();
    this.renderAll();
    this.preview.layout();
    this.toast('New project started. Your previous local autosave will be replaced after the next change.', 'ok');
    this.scheduleSave();
  }

  async clearSaved() {
    try {
      await clearLocal();
      this.savedAt = 0;
      this.setStatus('Saved copy removed', 'warn');
      this.toast('The saved project and files were removed from this browser. The open edit is unchanged.', 'ok');
    } catch (error) {
      this.toast(`The saved copy could not be removed: ${error.message || error}`, 'error');
    }
  }

  /* --------------------------------------------------------------- autosave */

  scheduleSave() {
    if (this.restoring) return;
    this.setStatus('Saving…', 'warn');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 1200);
  }

  async saveNow() {
    if (this.restoring) return null;
    const token = ++this.saveToken;
    try {
      const result = await saveLocal(this.store.project, this.media.list());
      if (token !== this.saveToken) return result;
      this.savedAt = result.savedAt;
      this.setStatus(`Saved ${new Date(result.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'ok');
      return result;
    } catch (error) {
      if (token !== this.saveToken) return null;
      this.setStatus('Not saved — storage blocked', 'warn');
      if (!this.storageWarned) {
        this.storageWarned = true;
        this.toast(
          `Autosave failed: ${error.message || error}. The edit is still in this tab; download the project file to keep it.`,
          'error',
          6200
        );
      }
      return null;
    }
  }

  async restoreLocal() {
    this.restoring = true;
    try {
      const saved = await loadLocal();
      if (!saved) {
        this.restoring = false;
        return false;
      }
      const adopted = [];
      const missing = [...(saved.missing || [])];
      for (const entry of saved.media) {
        try {
          const asset = await this.media.addFile(entry.file);
          if (asset.id !== entry.id) {
            this.media.assets.delete(asset.id);
            asset.id = entry.id;
            this.media.assets.set(entry.id, asset);
          }
          adopted.push(asset);
        } catch (error) {
          missing.push({ id: entry.id, name: entry.name || 'Unnamed file', reason: error.message || String(error) });
        }
      }
      const restored = restoreProjectInto(this.store, saved.project);
      if (!restored) {
        this.restoring = false;
        return false;
      }
      this.savedAt = saved.savedAt || 0;
      this.store.playhead = 0;
      this.restoring = false;
      this.syncProjectName();
      this.restoreMissing = missing;
      if (missing.length) {
        const relink = new Map();
        for (const entry of [...saved.media, ...(saved.missing || [])]) {
          if (entry && entry.name && entry.id) relink.set(entry.name, entry.id);
        }
        this.pendingRelink = relink;
        this.toast(
          `The saved project was restored, but ${missing.length} media file(s) could not be reopened. Re-import them in the Media panel.`,
          'warn',
          6500
        );
      } else if (adopted.length) {
        this.toast('Your last project was restored from this browser.', 'ok', 3800);
      }
      if (this.savedAt) {
        this.setStatus(`Saved ${new Date(this.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'ok');
      }
      this.renderAll();
      return true;
    } catch (error) {
      this.restoring = false;
      this.toast(`Local restore failed: ${error.message || error}`, 'warn', 5200);
      return false;
    }
  }

  /* -------------------------------------------------------------------- UI */

  setStatus(text, tone = '') {
    if (!this.dom.saveStatus) return;
    this.dom.saveStatus.textContent = text;
    this.dom.saveStatus.dataset.tone = tone;
  }

  syncProjectName() {
    if (!this.dom.projectName) return;
    if (document.activeElement !== this.dom.projectName) {
      this.dom.projectName.value = this.store.project.name || 'Untitled video';
    }
  }

  applyProjectInputValues() {
    this.syncProjectName();
    this.syncMuteButton();
    this.syncPlayButton();
  }

  renderAll() {
    this.applyProjectInputValues();
    this.renderTransport();
    this.renderTimeline();
    this.renderActions();
    this.renderLayers();
    this.preview?.updateOverlay();
  }

  renderTransport() {
    const duration = this.store.duration();
    this.dom.duration.textContent = clock(duration);
    this.dom.seek.max = String(Math.max(0.01, duration));
    this.dom.seek.value = String(clamp(this.store.playhead, 0, Math.max(0.01, duration)));
    this.dom.seek.disabled = duration <= 0;
    this.dom.undo.disabled = !this.store.canUndo();
    this.dom.redo.disabled = !this.store.canRedo();
    this.syncPlayButton();
    this.syncMuteButton();
    this.dom.export.disabled = duration <= 0;
  }

  onTime(time) {
    if (!this.dom.time) return;
    const duration = this.store.duration();
    this.dom.time.textContent = clock(time);
    this.dom.duration.textContent = clock(duration);
    if (document.activeElement !== this.dom.seek) this.dom.seek.value = String(clamp(time, 0, Math.max(0.01, duration)));
    else this.dom.seek.value = String(clamp(time, 0, Math.max(0.01, duration)));
    this.dom.seek.max = String(Math.max(0.01, duration));
    this.dom.playhead.style.left = `${duration > 0 ? clamp(time / duration, 0, 1) * 100 : 0}%`;
    this.dom.momentLabel.textContent = `At ${clock(time)}`;
    this.syncPlayButton();
  }

  scheduleTimelineRender() {
    if (this.timelineFrame) return;
    this.timelineFrame = requestAnimationFrame(() => {
      this.timelineFrame = 0;
      this.renderTimeline();
    });
  }

  scheduleLayerRender() {
    if (this.layerFrame) return;
    this.layerFrame = requestAnimationFrame(() => {
      this.layerFrame = 0;
      this.renderLayers();
    });
  }

  scheduleActionRender() {
    if (this.actionsFrame) return;
    this.actionsFrame = requestAnimationFrame(() => {
      this.actionsFrame = 0;
      this.renderActions();
    });
  }

  renderTimeline() {
    if (!this.dom.filmstrip) return;
    const duration = Math.max(this.store.duration(), 0);
    const base = this.store.baseTrack();
    const strip = this.dom.filmstrip;
    strip.textContent = '';
    this.renderOverlayLane();

    if (!base.clips.length || duration <= 0) {
      const empty = document.createElement('div');
      empty.className = 'se-film-empty';
      empty.textContent = this.baseIsEmpty() ? 'Choose a video to see its moments' : 'No main video';
      strip.append(empty);
      this.dom.playhead.style.left = '0%';
      this.renderTransport();
      return;
    }

    const width = Math.max(220, strip.clientWidth || this.dom.timeline.clientWidth || 320);
    const token = ++this.stripToken;
    const requests = [];
    const segments = [];

    for (const clip of [...base.clips].sort((a, b) => a.start - b.start)) {
      const totalPct = (clip.duration / duration) * 100;
      if (totalPct <= 0) continue;
      const targetPx = (totalPct / 100) * width;
      const slices = clamp(Math.round(targetPx / 68), 1, 10);
      for (let index = 0; index < slices; index += 1) {
        const seg = document.createElement('div');
        seg.className = 'se-film-seg';
        seg.style.width = `${totalPct / slices}%`;
        const asset = clip.mediaId ? this.media.get(clip.mediaId) : null;
        if (asset?.thumbnail) {
          seg.style.backgroundImage = `url("${asset.thumbnail}")`;
          seg.style.backgroundSize = 'cover';
        } else if (clip.kind === 'text') {
          seg.style.background = 'linear-gradient(135deg,#7c3aed,#4c1d95)';
        }
        seg.title = `${clock(clip.start)} – ${clock(clipEnd(clip))}`;
        strip.append(seg);
        segments.push(seg);
        if (asset?.type === 'video') {
          const local = (index / slices) * clip.duration + 0.001;
          const sourceTime = clipSourceTime(clip, local);
          requests.push({ seg, mediaId: clip.mediaId, sourceTime });
        }
      }
    }

    this.dom.playhead.style.left = `${clamp(this.store.playhead / duration, 0, 1) * 100}%`;
    this.renderTransport();

    if (requests.length) {
      this.loadStripFrames(token, requests, segments);
    }
  }

  async loadStripFrames(token, requests, segments) {
    /* Between two and four frames per clip are enough to read the strip. */
    const limited = requests.slice(0, 28);
    for (const request of limited) {
      if (token !== this.stripToken) return;
      const canvas = await this.media.frameAt(request.mediaId, Math.max(0, request.sourceTime), 240);
      if (token !== this.stripToken) return;
      if (!canvas) continue;
      try {
        const tile = document.createElement('canvas');
        tile.width = 96;
        tile.height = 56;
        const ctx = tile.getContext('2d');
        const scale = Math.max(tile.width / canvas.width, tile.height / canvas.height);
        const w = canvas.width * scale;
        const h = canvas.height * scale;
        ctx.drawImage(canvas, (tile.width - w) / 2, (tile.height - h) / 2, w, h);
        request.seg.style.backgroundImage = `url("${tile.toDataURL('image/jpeg', 0.55)}")`;
        request.seg.style.backgroundSize = 'cover';
      } catch (error) {
        /* a thumbnail is optional */
      }
    }
  }

  renderOverlayLane() {
    const lane = this.dom.overlayLane;
    if (!lane) return;
    lane.textContent = '';
    const duration = this.store.duration();
    if (duration <= 0) return;
    const base = this.store.baseTrack();
    const entries = this.store.layerEntries().filter((entry) => entry.track.id !== base.id);
    for (const entry of entries) {
      const { clip } = entry;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'se-overlay-chip';
      chip.dataset.kind = clip.kind;
      chip.dataset.clipId = clip.id;
      chip.style.left = `${clamp(clip.start / duration, 0, 1) * 100}%`;
      chip.style.width = `${Math.max(2, clamp(clip.duration / duration, 0, 1) * 100)}%`;
      chip.textContent = clip.kind === 'audio' ? '♪' : clip.kind === 'text' ? 'T' : clip.kind === 'image' ? '▣' : clip.kind === 'shape' ? '◆' : '▶';
      chip.title = `${shotName(clip)} · ${clock(clip.start)}`;
      chip.setAttribute('aria-label', `${shotName(clip)} layer at ${clock(clip.start)}`);
      if (this.store.selectedId === clip.id) chip.classList.add('is-selected');
      chip.addEventListener('pointerdown', (event) => event.stopPropagation());
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selectClip(clip.id, { open: false });
      });
      lane.append(chip);
    }
  }

  selectClip(clipId, { open = false } = {}) {
    const found = this.store.trackForClip(clipId);
    if (!found) return;
    this.store.select(clipId);
    this.store.emit('selection');
    if (this.store.playhead < found.clip.start || this.store.playhead >= clipEnd(found.clip) - 0.001) {
      this.preview.seek(found.clip.start + 0.001);
    }
    this.renderLayers();
    this.renderActions();
    this.renderOverlayLane();
    if (open) openClipSheet(this, clipId);
  }

  renderLayers() {
    if (!this.dom.layerList) return;
    const list = this.dom.layerList;
    const entries = this.store.layerEntries();
    const base = this.store.baseTrack();
    const overlayVisuals = this.store.visualTracks().filter((track) => track.id !== base.id);
    list.textContent = '';
    this.dom.layerCount.textContent = String(entries.length);
    this.dom.layersSub.textContent = entries.length
      ? `${overlayVisuals.length} overlay${overlayVisuals.length === 1 ? '' : 's'} above the main video`
      : 'Your video and everything on top of it';
    this.dom.layersEmpty.hidden = entries.length > 0;

    for (const entry of entries) {
      const { clip, track } = entry;
      const isBase = track.id === base.id;
      const selected = this.store.selectedId === clip.id;
      const hidden = isBase ? track.hidden : track.kind === 'audio' ? clip.muted : clip.hidden;
      const kind = clip.kind;
      const row = document.createElement('li');
      row.className = 'se-layer-row';
      row.dataset.kind = kind;
      row.dataset.clipId = clip.id;
      if (selected) row.classList.add('is-selected');
      if (hidden) row.classList.add('is-hidden');

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'se-layer-main';
      main.setAttribute('aria-label', `${shotName(clip)}${selected ? ', selected' : ''}`);
      const iconWrap = document.createElement('span');
      iconWrap.className = 'se-layer-icon';
      iconWrap.innerHTML = icon(KIND_ICON[kind] || 'video');
      const textWrap = document.createElement('span');
      textWrap.className = 'se-layer-text';
      const name = document.createElement('span');
      name.className = 'se-layer-name';
      name.textContent = isBase ? `Main video · ${shotName(clip)}` : shotName(clip);
      const meta = document.createElement('span');
      meta.className = 'se-layer-meta';
      meta.textContent = isBase
        ? `${clock(clip.start)}–${clock(clipEnd(clip))} · ${track.hidden ? 'hidden' : 'base layer'}`
        : `${clock(clip.start)}–${clock(clipEnd(clip))} · ${KIND_LABEL[kind] || kind}${clip.locked ? ' · locked' : ''}`;
      textWrap.append(name, meta);
      main.append(iconWrap, textWrap);
      main.addEventListener('click', () => {
        if (this.store.selectedId === clip.id) openClipSheet(this, clip.id);
        else this.selectClip(clip.id);
      });

      const controls = document.createElement('div');
      controls.className = 'se-layer-controls';

      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'se-layer-btn';
      eye.innerHTML = icon(hidden ? 'eyeOff' : 'eye');
      eye.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      eye.setAttribute('aria-label', hidden ? `Show ${shotName(clip)}` : `Hide ${shotName(clip)}`);
      eye.title = hidden ? 'Show layer' : 'Hide layer';
      eye.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleLayerVisibility(clip.id);
      });
      controls.append(eye);

      if (!isBase && track.kind === 'video') {
        const moves = document.createElement('div');
        moves.className = 'se-layer-move';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'se-layer-btn';
        up.innerHTML = icon('up');
        up.title = 'Bring forward';
        up.setAttribute('aria-label', `Bring ${shotName(clip)} forward`);
        up.disabled = overlayVisuals.indexOf(track) === 0;
        up.addEventListener('click', (event) => {
          event.stopPropagation();
          this.moveLayer(clip.id, 'up');
        });
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'se-layer-btn';
        down.innerHTML = icon('down');
        down.title = 'Send backward';
        down.setAttribute('aria-label', `Send ${shotName(clip)} backward`);
        down.disabled = overlayVisuals.indexOf(track) === overlayVisuals.length - 1;
        down.addEventListener('click', (event) => {
          event.stopPropagation();
          this.moveLayer(clip.id, 'down');
        });
        moves.append(up, down);
        controls.append(moves);
      }

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'se-layer-btn';
      edit.innerHTML = icon('settings');
      edit.title = 'Edit layer';
      edit.setAttribute('aria-label', `Edit ${shotName(clip)}`);
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selectClip(clip.id);
        openClipSheet(this, clip.id);
      });
      controls.append(edit);

      row.append(main, controls);
      list.append(row);
    }
  }

  renderActions() {
    if (!this.dom.actions) return;
    const wrap = this.dom.actions;
    wrap.textContent = '';
    const baseEmpty = this.baseIsEmpty();
    const selected = this.store.selected();
    const selectedClip = selected?.clip || null;
    const found = selected || this.store.clipAtPlayhead(true);
    const clip = found?.clip || null;
    const isBaseSelected = selectedClip ? this.store.isBaseClip(selectedClip) : false;

    const actions = [];
    if (baseEmpty) {
      actions.push({
        label: 'Upload video',
        icon: 'upload',
        accent: true,
        run: () => this.pickFile('video')
      });
      actions.push({ label: 'Add text', icon: 'text', run: () => openTextSheet(this) });
      actions.push({ label: 'Add image', icon: 'image', run: () => this.pickFile('image') });
    } else {
      actions.push({ label: 'Text', icon: 'text', run: () => openTextSheet(this) });
      if (clip) {
        actions.push({
          label: 'Split',
          icon: 'split',
          accent: true,
          run: () => this.splitClip(clip.id)
        });
        actions.push({
          label: 'Edit',
          icon: 'settings',
          run: () => openClipSheet(this, clip.id)
        });
      } else {
        actions.push({ label: 'Caption', icon: 'text', run: () => openCaptionsSheet(this) });
      }
      actions.push({ label: 'Music', icon: 'audio', run: () => openAudioSheet(this, selectedClip?.id) });
      actions.push({ label: 'Filter', icon: 'filter', run: () => openFilterSheet(this) });
      actions.push({ label: 'Transition', icon: 'transition', run: () => openTransitionSheet(this) });
      if (selectedClip) {
        actions.push({
          label: 'Duplicate',
          icon: 'duplicate',
          run: () => this.duplicateClip(selectedClip.id)
        });
        if (!isBaseSelected) {
          actions.push({
            label: 'Forward',
            icon: 'up',
            run: () => this.moveLayer(selectedClip.id, 'up')
          });
          actions.push({
            label: 'Back',
            icon: 'down',
            run: () => this.moveLayer(selectedClip.id, 'down')
          });
        }
        actions.push({
          label: 'Delete',
          icon: 'trash',
          danger: true,
          run: () => this.deleteClip(selectedClip.id)
        });
      }
    }

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `se-action${action.accent ? ' is-accent' : ''}${action.danger ? ' is-danger' : ''}`;
      button.innerHTML = icon(action.icon);
      button.append(document.createTextNode(action.label));
      button.addEventListener('click', action.run);
      wrap.append(button);
    }

    this.dom.momentHint.textContent = baseEmpty
      ? 'Start with a video'
      : selectedClip
        ? `${shotName(selectedClip)} selected`
        : clip
          ? `${shotName(clip)} at this moment`
          : 'Choose an action';
  }

  toast(message, tone = '', duration) {
    if (!this.toasts) return null;
    return this.toasts.show(message, tone, duration);
  }

  missingMediaNames() {
    const missing = [];
    const seen = new Set();
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) {
        if (!clip.mediaId || seen.has(clip.mediaId)) continue;
        seen.add(clip.mediaId);
        if (!this.media.has(clip.mediaId)) missing.push(shotName(clip));
      }
    }
    return missing;
  }

  projectInfo() {
    const entries = this.store.layerEntries();
    return {
      duration: this.store.duration(),
      layerCount: entries.length,
      mediaCount: this.media.list().length,
      savedAt: this.savedAt
    };
  }

  deleteAsset(assetId) {
    const used = this.store.project.tracks.some((track) =>
      track.clips.some((clip) => clip.mediaId === assetId)
    );
    if (used) {
      this.toast('This file is still used by a layer. Delete the layer first, then remove the file.', 'warn');
      return false;
    }
    this.media.remove(assetId);
    this.toast('File removed from this project.', 'ok');
    this.scheduleSave();
    return true;
  }

  /* ---------------------------------------------------------------- debug */

  exposeDebug() {
    const app = this;
    window.__VE__ = {
      app,
      store: this.store,
      media: this.media,
      preview: this.preview,
      exporter: this.exporter,
      state() {
        return {
          name: app.store.project.name,
          duration: app.store.duration(),
          playhead: app.store.playhead,
          playing: app.preview.playing,
          selection: app.store.selectedId,
          dimensions: app.store.dimensions(),
          aspect: app.store.project.aspect,
          fps: app.store.project.fps,
          resolution: app.store.project.resolution,
          layerCount: app.store.layerEntries().length,
          baseTrackId: app.store.project.baseTrackId,
          baseClips: app.store.baseTrack().clips.map((clip) => ({
            id: clip.id,
            start: clip.start,
            duration: clip.duration,
            mediaId: clip.mediaId
          })),
          tracks: app.store.project.tracks.map((track) => ({
            id: track.id,
            kind: track.kind,
            hidden: track.hidden,
            clips: track.clips.map((clip) => ({
              id: clip.id,
              kind: clip.kind,
              name: clip.name,
              start: clip.start,
              duration: clip.duration,
              mediaId: clip.mediaId,
              x: clip.x,
              y: clip.y,
              scale: clip.scale,
              rotation: clip.rotation,
              opacity: clip.opacity,
              keyframes: Object.fromEntries(
                Object.entries(clip.keyframes || {}).map(([key, list]) => [key, list.length])
              )
            }))
          })),
          subtitles: app.store.project.subtitles,
          savedAt: app.savedAt,
          exportRunning: app.exportRunning,
          lastExport: app.lastExport?.meta || null,
          previewDebug: app.preview.debug(),
          missingMedia: app.missingMediaNames(),
          sheets: Boolean(app.sheets.current)
        };
      },
      seek(time) {
        app.preview.seek(time);
      },
      play() {
        return app.preview.play();
      },
      pause() {
        app.preview.pause();
        app.syncPlayButton();
      },
      undo() {
        return app.undo();
      },
      redo() {
        return app.redo();
      },
      addText(key = 'title') {
        const clip = app.addTextPreset(key);
        return clip ? clip.id : null;
      },
      addShape(id) {
        const clip = app.addShape(id);
        return clip ? clip.id : null;
      },
      addSticker(character) {
        const clip = app.addSticker(character);
        return clip ? clip.id : null;
      },
      select(clipId) {
        app.selectClip(clipId);
      },
      split(clipId) {
        const target = clipId || app.store.selectedId;
        return target ? app.splitClip(target)?.id || null : null;
      },
      duplicate(clipId) {
        const target = clipId || app.store.selectedId;
        return target ? app.duplicateClip(target)?.id || null : null;
      },
      remove(clipId) {
        const target = clipId || app.store.selectedId;
        return target ? app.deleteClip(target) : false;
      },
      open(sheet, ...args) {
        const map = {
          media: openMediaSheet,
          text: openTextSheet,
          clip: openClipSheet,
          audio: openAudioSheet,
          filters: openFilterSheet,
          transitions: openTransitionSheet,
          project: openProjectSheet,
          export: openExportSheet,
          help: openHelpSheet,
          captions: openCaptionsSheet,
          menu: openMenuSheet
        };
        const fn = map[sheet];
        if (!fn) return false;
        fn(app, ...args);
        return true;
      },
      closeSheet() {
        app.sheets.close();
      },
      async exportNow(options = {}) {
        const built = app.exporter.buildOptions(options);
        app.exportRunning = true;
        try {
          const result = await app.exporter.exportToBlob(built, () => {});
          app.lastExport = result;
          return result;
        } finally {
          app.exportRunning = false;
        }
      },
      async saveNow() {
        return app.saveNow();
      },
      projectInfo() {
        return app.projectInfo();
      }
    };
  }

  release() {
    clearTimeout(this.saveTimer);
    this.stripToken += 1;
    this.preview?.dispose();
  }
}

/* Restore a saved project into the studio store without dropping baseTrackId. */
function restoreProjectInto(store, project) {
  try {
    const clone = deepClone(project);
    if (!Array.isArray(clone.tracks)) throw new Error('This saved project has no tracks.');
    store.replaceProject(clone);
    store.ensureBaseTrack();
    return true;
  } catch (error) {
    return false;
  }
}

/* Split keyframes at a clip-local time, interpolating the boundary value. */
function splitKeyframes(keyframes, local, clip) {
  const left = {};
  const right = {};
  const source = keyframes || {};
  for (const prop of ['x', 'y', 'scale', 'rotation', 'opacity', 'volume']) {
    const list = Array.isArray(source[prop]) ? source[prop] : [];
    if (!list.length) {
      left[prop] = [];
      right[prop] = [];
      continue;
    }
    const value = keyframeValue(clip, prop, local, Number.isFinite(clip[prop]) ? clip[prop] : 1);
    left[prop] = list
      .filter((entry) => entry.t < local - 1e-6)
      .map((entry) => ({ ...entry }));
    const before = list.filter((entry) => entry.t < local - 1e-6).slice(-1)[0];
    left[prop].push({ t: local, v: value, ease: before?.ease || 'linear' });
    right[prop] = list
      .filter((entry) => entry.t > local + 1e-6)
      .map((entry) => ({ ...entry, t: Math.max(0, entry.t - local) }));
    right[prop].unshift({ t: 0, v: value, ease: before?.ease || 'linear' });
  }
  return { left, right };
}

const app = new StudioApp();
window.__SE_BOOT__ = app;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app.boot().catch((error) => {
      console.error('Editor failed to start', error);
      const status = document.getElementById('se-save-status');
      if (status) {
        status.textContent = 'Editor failed to start';
        status.dataset.tone = 'warn';
      }
    });
  });
} else {
  app.boot().catch((error) => {
    console.error('Editor failed to start', error);
    const status = document.getElementById('se-save-status');
    if (status) {
      status.textContent = 'Editor failed to start';
      status.dataset.tone = 'warn';
    }
  });
}

export { app };
