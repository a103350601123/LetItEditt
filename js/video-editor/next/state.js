/* LetitEdit editor V3 — the single project state shared by every panel.
 * The composition engine is reused, but this workspace owns its own project
 * bootstrap, selection model, track categories and sanitising rules.
 */

import {
  SCHEMA_VERSION,
  ProjectStore,
  addClipToTrack,
  clipEnd,
  createClip,
  createProject,
  createTrack,
  defaultBackground,
  defaultColor,
  defaultShape,
  defaultSubtitleStyle,
  defaultText,
  findClip,
  findTrack,
  isCompatibleTrack,
  projectDimensions,
  projectDuration,
  resolveStart,
  sortTrack
} from '../model.js';
import { clamp, deepClone, uid } from '../utils.js';

export const APP_SCHEMA = 3;
export const TRACK_COLORS = {
  video: '#0080ff',
  image: '#27b39b',
  text: '#e5a42b',
  audio: '#9c6cff',
  element: '#ef6f93',
  background: '#5c8dd6'
};

export function categoryForClip(clip) {
  if (!clip) return 'video';
  if (clip.kind === 'audio') return 'audio';
  if (clip.kind === 'text') return 'text';
  if (clip.kind === 'shape') return 'element';
  if (clip.kind === 'background') return 'background';
  if (clip.kind === 'image') return 'image';
  return 'video';
}

export function newTrack(kind, category = kind === 'audio' ? 'audio' : 'video', name = '') {
  const track = createTrack(kind, name || (kind === 'audio' ? 'Audio' : 'Visual'));
  track.category = category;
  track.volume = 1;
  track.muted = false;
  track.hidden = false;
  track.locked = false;
  return track;
}

export function newProject(overrides = {}) {
  const project = createProject({
    name: 'Untitled project',
    aspect: '16:9',
    resolution: '1080',
    fps: 30,
    background: '#000000',
    ...overrides
  });
  project.schema = APP_SCHEMA;
  project.tracks = [
    newTrack('video', 'text', 'Text & overlays'),
    newTrack('video', 'video', 'Video 1'),
    newTrack('audio', 'audio', 'Audio 1')
  ];
  project.subtitles = {
    enabled: true,
    style: defaultSubtitleStyle(),
    items: []
  };
  project.masterVolume = 1;
  project.guides = { center: false, safe: false };
  project.defaultFit = 'contain';
  return project;
}

export function sanitizeProject(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tracks)) {
    throw new Error('This project does not contain a readable timeline.');
  }
  const base = newProject();
  const project = {
    ...base,
    ...deepClone(input),
    schema: APP_SCHEMA,
    tracks: [],
    subtitles: {
      ...base.subtitles,
      ...(deepClone(input.subtitles) || {})
    }
  };
  project.name = String(project.name || 'Untitled project').slice(0, 80);
  project.aspect = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '3:2', 'custom'].includes(project.aspect)
    ? project.aspect : '16:9';
  project.resolution = ['2160', '1440', '1080', '720', '480', 'custom'].includes(String(project.resolution))
    ? String(project.resolution) : '1080';
  project.fps = clamp(Math.round(Number(project.fps) || 30), 1, 60);
  project.customWidth = clamp(Math.round(Number(project.customWidth) || 1920), 16, 4096);
  project.customHeight = clamp(Math.round(Number(project.customHeight) || 1080), 16, 4096);
  project.customAspectW = clamp(Math.round(Number(project.customAspectW) || 16), 1, 100);
  project.customAspectH = clamp(Math.round(Number(project.customAspectH) || 9), 1, 100);
  project.background = /^#[0-9a-f]{6}$/i.test(project.background || '') ? project.background : '#000000';
  project.masterVolume = clamp(Number(project.masterVolume ?? 1), 0, 1.5);
  project.guides = { center: false, safe: false, ...(project.guides || {}) };
  project.defaultFit = project.defaultFit === 'cover' ? 'cover' : 'contain';
  project.subtitles.enabled = project.subtitles.enabled !== false;
  project.subtitles.style = { ...defaultSubtitleStyle(), ...(project.subtitles.style || {}) };
  project.subtitles.items = (Array.isArray(project.subtitles.items) ? project.subtitles.items : [])
    .filter((item) => item && Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)))
    .map((item) => ({
      id: String(item.id || uid('sub')),
      start: Math.max(0, Number(item.start)),
      end: Math.max(Number(item.start) + 0.2, Number(item.end)),
      text: String(item.text || '').slice(0, 4000)
    }))
    .sort((a, b) => a.start - b.start);

  for (const rawTrack of input.tracks) {
    if (!rawTrack || !rawTrack.kind) continue;
    const kind = rawTrack.kind === 'audio' ? 'audio' : 'video';
    const category = kind === 'audio'
      ? 'audio'
      : ['video', 'image', 'text', 'element', 'background'].includes(rawTrack.category)
        ? rawTrack.category : 'video';
    const track = newTrack(kind, category, String(rawTrack.name || '').slice(0, 32));
    track.id = String(rawTrack.id || uid('track'));
    track.hidden = Boolean(rawTrack.hidden);
    track.muted = Boolean(rawTrack.muted);
    track.locked = Boolean(rawTrack.locked);
    track.volume = clamp(Number(rawTrack.volume ?? 1), 0, 2);
    track.clips = [];
    for (const rawClip of Array.isArray(rawTrack.clips) ? rawTrack.clips : []) {
      if (!rawClip || !rawClip.kind) continue;
      if (!['video', 'image', 'audio', 'text', 'shape', 'background'].includes(rawClip.kind)) continue;
      const clip = createClip(rawClip.kind, rawClip);
      clip.id = String(rawClip.id || uid('clip'));
      clip.name = String(rawClip.name || '').slice(0, 120);
      clip.start = Math.max(0, Number(rawClip.start) || 0);
      clip.duration = clamp(Number(rawClip.duration) || 3, 0.1, 6 * 60 * 60);
      clip.inPoint = Math.max(0, Number(rawClip.inPoint) || 0);
      clip.outPoint = Math.max(clip.inPoint + 0.05, Number(rawClip.outPoint) || clip.inPoint + clip.duration);
      clip.speed = clamp(Number(rawClip.speed) || 1, 0.1, 8);
      clip.volume = clamp(Number(rawClip.volume ?? 1), 0, 2);
      clip.fadeIn = clamp(Number(rawClip.fadeIn) || 0, 0, clip.duration);
      clip.fadeOut = clamp(Number(rawClip.fadeOut) || 0, 0, clip.duration);
      clip.x = clamp(Number(rawClip.x ?? 0.5), -1, 2);
      clip.y = clamp(Number(rawClip.y ?? 0.5), -1, 2);
      clip.scale = clamp(Number(rawClip.scale ?? 1), 0.02, 12);
      clip.rotation = clamp(Number(rawClip.rotation) || 0, -720, 720);
      clip.opacity = clamp(Number(rawClip.opacity ?? 1), 0, 1);
      clip.color = { ...defaultColor(), ...(rawClip.color || {}) };
      clip.text = { ...defaultText(), ...(rawClip.text || {}) };
      clip.shape = { ...defaultShape(), ...(rawClip.shape || {}) };
      clip.background = { ...defaultBackground(), ...(rawClip.background || {}) };
      clip.crop = {
        top: clamp(Number(rawClip.crop?.top) || 0, 0, 0.45),
        right: clamp(Number(rawClip.crop?.right) || 0, 0, 0.45),
        bottom: clamp(Number(rawClip.crop?.bottom) || 0, 0, 0.45),
        left: clamp(Number(rawClip.crop?.left) || 0, 0, 0.45)
      };
      clip.keyframes = clip.keyframes || { x: [], y: [], scale: [], rotation: [], opacity: [] };
      for (const key of Object.keys(clip.keyframes)) {
        clip.keyframes[key] = (Array.isArray(clip.keyframes[key]) ? clip.keyframes[key] : [])
          .filter((frame) => Number.isFinite(Number(frame.t)) && Number.isFinite(Number(frame.v)))
          .map((frame) => ({ t: Number(frame.t), v: Number(frame.v), ease: frame.ease || 'linear' }));
      }
      clip.transition = {
        type: String(rawClip.transition?.type || 'none'),
        duration: clamp(Number(rawClip.transition?.duration) || 0.5, 0.1, 5),
        reverse: Boolean(rawClip.transition?.reverse)
      };
      clip.inAnim = {
        type: String(rawClip.inAnim?.type || 'none'),
        duration: clamp(Number(rawClip.inAnim?.duration) || 0.5, 0.1, 5)
      };
      clip.outAnim = {
        type: String(rawClip.outAnim?.type || 'none'),
        duration: clamp(Number(rawClip.outAnim?.duration) || 0.5, 0.1, 5)
      };
      if (!isCompatibleTrack(track, clip)) continue;
      track.clips.push(clip);
    }
    sortTrack(track);
    project.tracks.push(track);
  }
  if (!project.tracks.some((track) => track.kind === 'audio')) {
    project.tracks.push(newTrack('audio', 'audio', 'Audio 1'));
  }
  if (!project.tracks.some((track) => track.kind === 'video')) {
    project.tracks.unshift(newTrack('video', 'video', 'Video 1'));
  }
  return project;
}

export class EditorStore extends ProjectStore {
  constructor(project) {
    super(project || newProject());
    this.selection = new Set();
    this.selectedSubtitle = null;
    this.playhead = 0;
    this.playing = false;
    this.activeCategory = 'media';
    this.previewZoom = 1;
    this.timelineZoom = 54;
    this.snapping = true;
    this.ripple = false;
    this.mobileSheet = 'none';
    this.workspace = {
      libraryWidth: 304,
      inspectorWidth: 300,
      timelineHeight: 286
    };
    this.exporting = false;
    this.autosaveState = 'ready';
    this.lastSavedAt = null;
    this.exportSettings = {
      format: 'mp4',
      resolution: 'project',
      quality: 'balanced',
      includeAudio: true
    };
  }

  get project() {
    return this._project || (this._project = createProject());
  }

  set project(value) {
    this._project = value;
  }

  selectClip(clipId, { additive = false, range = false } = {}) {
    if (!clipId) {
      if (!additive) this.selection.clear();
      this.selectedSubtitle = null;
      return;
    }
    this.selectedSubtitle = null;
    const all = this.allClipIds();
    if (additive) {
      if (this.selection.has(clipId)) this.selection.delete(clipId);
      else this.selection.add(clipId);
    } else if (range && this.selection.size) {
      const anchor = all.findIndex((id) => this.selection.has(id));
      const target = all.indexOf(clipId);
      if (anchor !== -1 && target !== -1) {
        const start = Math.min(anchor, target);
        const end = Math.max(anchor, target);
        for (let i = start; i <= end; i += 1) this.selection.add(all[i]);
      } else {
        this.selection = new Set([clipId]);
      }
    } else {
      this.selection = new Set([clipId]);
    }
  }

  selectSubtitle(id) {
    this.selectedSubtitle = id || null;
    this.selection.clear();
  }

  clearSelection() {
    this.selection.clear();
    this.selectedSubtitle = null;
  }

  allClipIds() {
    return this.project.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
  }

  firstSelected() {
    for (const clipId of this.selection) {
      const found = findClip(this.project, clipId);
      if (found) return found;
    }
    return null;
  }

  selectAll() {
    this.selection = new Set(this.allClipIds());
    this.selectedSubtitle = null;
  }

  prune() {
    const all = new Set(this.allClipIds());
    for (const id of [...this.selection]) if (!all.has(id)) this.selection.delete(id);
    if (this.selectedSubtitle && !this.project.subtitles.items.some((item) => item.id === this.selectedSubtitle)) {
      this.selectedSubtitle = null;
    }
  }

  duration() {
    return projectDuration(this.project);
  }

  dimensions() {
    return projectDimensions(this.project);
  }

  trackForClip(clipId) {
    for (const track of this.project.tracks) {
      const clip = track.clips.find((item) => item.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }

  activeVisualClip() {
    const found = this.firstSelected();
    if (!found || found.track.kind !== 'video' || found.clip.hidden) return null;
    if (this.playhead < found.clip.start || this.playhead >= clipEnd(found.clip)) return null;
    return found;
  }

  ensureVisualTrack(category = 'video', start = this.playhead, duration = 4) {
    const candidates = this.project.tracks.filter((track) => track.kind === 'video' && !track.locked);
    const matching = candidates.find((track) => track.category === category && !hasOverlap(track, start, duration));
    if (matching) return matching;
    const free = candidates.find((track) => !hasOverlap(track, start, duration));
    if (free && free.category === 'video' && category === 'video') {
      free.category = category;
      if (free.name === 'Video 1' && category !== 'video') free.name = labelForCategory(category);
      return free;
    }
    const track = newTrack('video', category, labelForCategory(category));
    const index = Math.max(0, this.project.tracks.findIndex((item) => item.kind === 'audio'));
    this.project.tracks.splice(index, 0, track);
    return track;
  }

  ensureAudioTrack(start = this.playhead, duration = 3) {
    const candidates = this.project.tracks.filter((track) => track.kind === 'audio' && !track.locked);
    const free = candidates.find((track) => !hasOverlap(track, start, duration));
    if (free) return free;
    const track = newTrack('audio', 'audio', `Audio ${candidates.length + 1}`);
    this.project.tracks.push(track);
    return track;
  }

  addClip(clip, { track = null, start = clip.start, history = true, reason = 'add-clip' } = {}) {
    const target = track || (clip.kind === 'audio'
      ? this.ensureAudioTrack(start, clip.duration)
      : this.ensureVisualTrack(categoryForClip(clip), start, clip.duration));
    const before = this.snapshot();
    clip.start = Math.max(0, Number(start) || 0);
    const resolved = resolveStart(target, clip, clip.start, clip.duration);
    clip.start = resolved === null ? targetEnd(target) + 0.01 : resolved;
    addClipToTrack(target, clip);
    if (history) this.record(before, this.snapshot());
    this.emit(reason);
    return { track: target, clip };
  }
}

export function labelForCategory(category) {
  return {
    video: 'Video',
    image: 'Images',
    text: 'Text',
    element: 'Elements',
    background: 'Background'
  }[category] || 'Visual';
}

export function targetEnd(track) {
  return track.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
}

export function hasOverlap(track, start, duration, excludeId = null) {
  const end = start + duration;
  return track.clips.some((clip) => {
    if (clip.id === excludeId) return false;
    return start < clipEnd(clip) - 1e-4 && end > clip.start + 1e-4;
  });
}

export function createMediaClip(asset, overrides = {}) {
  const duration = asset.type === 'image' ? 4 : Math.max(0.2, Number(asset.duration) || 4);
  const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image';
  const clip = createClip(kind, {
    mediaId: asset.id,
    name: asset.name,
    duration,
    inPoint: 0,
    outPoint: duration,
    fit: overrides.fit || 'contain',
    ...overrides
  });
  if (asset.type === 'video') {
    clip.scale = 1;
  }
  return clip;
}

export function createTextClip(preset = {}) {
  return createClip('text', {
    name: preset.name || 'Text',
    duration: preset.duration || 3,
    x: preset.x ?? 0.5,
    y: preset.y ?? 0.5,
    text: { ...defaultText(), ...(preset.text || {}) }
  });
}

export function createShapeClip(type = 'rect') {
  const shapes = {
    rect: { type: 'rect', fill: '#0080ff', width: 0.42, height: 0.24, radius: 18 },
    circle: { type: 'circle', fill: '#ff5c8a', width: 0.26, height: 0.26 },
    line: { type: 'line', fill: '#ffffff', width: 0.5, height: 0.02 },
    arrow: { type: 'arrow', fill: '#ffd166', width: 0.46, height: 0.18 },
    badge: { type: 'rect', fill: '#151519', stroke: '#ffffff', strokeWidth: 2, width: 0.32, height: 0.12, radius: 40 }
  };
  return createClip('shape', {
    name: type === 'badge' ? 'Badge' : type[0].toUpperCase() + type.slice(1),
    duration: 4,
    shape: { ...defaultShape(), ...(shapes[type] || shapes.rect) }
  });
}

export function createBackgroundClip(kind = 'solid') {
  const backgrounds = {
    solid: { type: 'solid', color1: '#101b38' },
    blue: { type: 'solid', color1: '#0b5cff' },
    sun: { type: 'gradient', color1: '#f97316', color2: '#ec4899', angle: 135 },
    ocean: { type: 'gradient', color1: '#082f49', color2: '#0ea5e9', angle: 160 },
    mint: { type: 'gradient', color1: '#052e2b', color2: '#14b8a6', angle: 120 },
    night: { type: 'gradient', color1: '#050505', color2: '#1d4ed8', angle: 210 }
  };
  return createClip('background', {
    name: 'Background',
    duration: 5,
    background: { ...defaultBackground(), ...(backgrounds[kind] || backgrounds.solid) }
  });
}

export function createEmojiClip(emoji = '✨') {
  return createTextClip({
    name: `${emoji} Sticker`,
    duration: 4,
    y: 0.6,
    text: {
      content: emoji,
      size: 150,
      bold: false,
      bgOpacity: 0,
      shadow: false,
      maxWidth: 1
    }
  });
}

export function aspectList() {
  return ['16:9', '9:16', '1:1', '4:3', '3:4', 'custom'];
}

export { findClip, findTrack, clipEnd, projectDuration, sortTrack };
