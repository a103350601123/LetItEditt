/* LetitEdit Professional Video Editor — project model, defaults and undo.
 * The project is plain JSON so it can be autosaved and restored.
 */

import {
  uid,
  clamp,
  deepClone,
  aspectRatio,
  dimsForResolution
} from './utils.js';

export const SCHEMA_VERSION = 2;

export const FONT_STACKS = {
  sans: '"Inter", "Segoe UI", system-ui, -apple-system, "Noto Sans", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", "Noto Sans Mono", monospace',
  rounded: '"Segoe UI Variable", "Segoe UI", "Nunito", "Quicksand", system-ui, sans-serif',
  display: 'Impact, "Arial Black", "Noto Sans Display", "Segoe UI", sans-serif',
  arabic: '"Segoe UI", "Noto Naskh Arabic", "Noto Sans Arabic", "Geeza Pro", Tahoma, sans-serif',
  devanagari: '"Nirmala UI", "Noto Sans Devanagari", "Noto Serif Devanagari", Mangal, sans-serif',
  cjk: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Yu Gothic", "Malgun Gothic", sans-serif'
};

export const FONT_OPTIONS = [
  { id: 'sans', label: 'Sans (system)' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospace' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'display', label: 'Display' },
  { id: 'arabic', label: 'Arabic / Urdu' },
  { id: 'devanagari', label: 'Devanagari / Hindi' },
  { id: 'cjk', label: 'CJK (Chinese, Japanese, Korean)' }
];

export function defaultColor() {
  return {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    exposure: 0,
    highlights: 0,
    shadows: 0,
    gamma: 0,
    sharpness: 0,
    fade: 0,
    vignette: 0
  };
}

export function defaultText() {
  return {
    content: 'Your text',
    font: 'sans',
    size: 72,
    bold: true,
    italic: false,
    underline: false,
    color: '#ffffff',
    bgColor: '#0f172a',
    bgOpacity: 0,
    align: 'center',
    letterSpacing: 0,
    lineHeight: 1.25,
    outlineColor: '#000000',
    outlineWidth: 0,
    shadow: true,
    direction: 'auto',
    maxWidth: 0.9
  };
}

export function defaultShape() {
  return {
    type: 'rect',
    fill: '#2563eb',
    stroke: '#ffffff',
    strokeWidth: 0,
    width: 0.45,
    height: 0.3,
    radius: 16,
    arrowDirection: 'right'
  };
}

export function defaultBackground() {
  return {
    type: 'solid',
    color1: '#0f172a',
    color2: '#2563eb',
    angle: 135
  };
}

export function defaultSubtitleStyle() {
  return {
    font: 'sans',
    size: 44,
    color: '#ffffff',
    bgColor: '#000000',
    bgOpacity: 0.62,
    position: 0.86,
    align: 'center',
    outlineWidth: 0,
    outlineColor: '#000000',
    bold: false
  };
}

export function createTrack(kind = 'video', name = '') {
  const fallback = kind === 'audio' ? 'Audio' : 'Video';
  return {
    id: uid('track'),
    kind,
    name: name || fallback,
    hidden: false,
    muted: kind === 'audio' ? false : false,
    locked: false,
    volume: 1,
    collapsed: false,
    clips: []
  };
}

export function createClip(kind, overrides = {}) {
  const base = {
    id: uid('clip'),
    kind,
    name: '',
    mediaId: null,
    start: 0,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
    speed: 1,
    reverse: false,
    fit: 'contain',
    muted: false,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    flipH: false,
    flipV: false,
    filter: 'none',
    filterIntensity: 1,
    color: defaultColor(),
    transition: { type: 'none', duration: 0.5, reverse: false },
    inAnim: { type: 'none', duration: 0.5 },
    outAnim: { type: 'none', duration: 0.5 },
    keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
    text: defaultText(),
    shape: defaultShape(),
    background: defaultBackground(),
    hidden: false,
    freeze: false,
    freezeAt: null,
    locked: false,
    label: ''
  };
  return { ...base, ...deepClone(overrides) };
}

export function createProject(overrides = {}) {
  const project = {
    schema: SCHEMA_VERSION,
    id: uid('project'),
    name: 'Untitled project',
    aspect: '16:9',
    resolution: '1080',
    customWidth: 1920,
    customHeight: 1080,
    customAspectW: 16,
    customAspectH: 9,
    fps: 30,
    background: '#000000',
    masterVolume: 1,
    tracks: [
      createTrack('video', 'Video 2'),
      createTrack('video', 'Video 1'),
      createTrack('audio', 'Audio 1')
    ],
    subtitles: {
      enabled: true,
      style: defaultSubtitleStyle(),
      items: []
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return { ...project, ...deepClone(overrides) };
}

/* -------------------------------------------------------------------------
 * Lookups
 * ---------------------------------------------------------------------- */

export function findTrack(project, trackId) {
  return project.tracks.find((track) => track.id === trackId) || null;
}

export function findClip(project, clipId) {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index !== -1) return { track, clip: track.clips[index], index };
  }
  return null;
}

export function clipEnd(clip) {
  return clip.start + clip.duration;
}

export function trackEnd(track) {
  return track.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
}

export function projectDuration(project) {
  const end = project.tracks.reduce((max, track) => Math.max(max, trackEnd(track)), 0);
  return Math.max(0, end);
}

export function projectAspectValue(project) {
  if (project.aspect === 'custom') {
    const w = Number(project.customAspectW) || 16;
    const h = Number(project.customAspectH) || 9;
    return w / h;
  }
  return aspectRatio(project.aspect);
}

export function projectDimensions(project) {
  const ratio = projectAspectValue(project);
  return dimsForResolution(
    project.resolution,
    ratio,
    Number(project.customWidth) || 1920,
    Number(project.customHeight) || 1080
  );
}

export function visualTracks(project) {
  return project.tracks.filter((track) => track.kind === 'video');
}

export function audibleTracks(project) {
  return project.tracks.filter((track) => track.kind === 'audio');
}

/** The clip visible on `track` at timeline time `t`. */
export function clipAtTime(track, t) {
  let found = null;
  for (const clip of track.clips) {
    if (t >= clip.start - 1e-6 && t < clipEnd(clip) - 1e-6) {
      if (!found || clip.start > found.start) found = clip;
    }
  }
  return found;
}

/** The nearest clip that ends at or before the given clip starts. */
export function previousClip(track, clip) {
  let found = null;
  for (const candidate of track.clips) {
    if (candidate.id === clip.id) continue;
    if (clipEnd(candidate) <= clip.start + 0.02) {
      if (!found || clipEnd(candidate) > clipEnd(found)) found = candidate;
    }
  }
  return found;
}

/** The nearest clip that starts at or after the given clip ends. */
export function nextClip(track, clip) {
  let found = null;
  for (const candidate of track.clips) {
    if (candidate.id === clip.id) continue;
    if (candidate.start >= clipEnd(clip) - 0.02) {
      if (!found || candidate.start < found.start) found = candidate;
    }
  }
  return found;
}

/* -------------------------------------------------------------------------
 * Placement helpers
 * ---------------------------------------------------------------------- */

export function isCompatibleTrack(track, clip) {
  if (clip.kind === 'audio') return track.kind === 'audio';
  return track.kind === 'video';
}

export function overlaps(track, clip, start, duration, excludeId) {
  const end = start + duration;
  return track.clips.some((other) => {
    if (other.id === excludeId) return false;
    const otherEnd = other.start + other.duration;
    return start < otherEnd - 1e-4 && end > other.start + 1e-4;
  });
}

/**
 * Find the nearest legal start time for a clip of `duration` on `track`.
 * Returns null when no space is nearby.
 */
export function resolveStart(track, clip, desiredStart, duration) {
  const start = Math.max(0, desiredStart);
  if (!overlaps(track, clip, start, duration, clip.id)) return start;

  const candidates = [0];
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    candidates.push(other.start + other.duration);
    candidates.push(other.start - duration);
  }
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const value = Math.max(0, candidate);
    if (overlaps(track, clip, value, duration, clip.id)) continue;
    const distance = Math.abs(value - start);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  }
  return best;
}

export function addClipToTrack(track, clip) {
  const resolved = resolveStart(track, clip, clip.start, clip.duration);
  clip.start = resolved === null ? trackEnd(track) + 0.001 : resolved;
  track.clips.push(clip);
  track.clips.sort((a, b) => a.start - b.start);
  return clip;
}

export function removeClip(project, clipId) {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index !== -1) {
      const [removed] = track.clips.splice(index, 1);
      return { track, clip: removed };
    }
  }
  return null;
}

export function moveClipToTrack(project, clipId, targetTrackId, desiredStart) {
  const located = findClip(project, clipId);
  if (!located) return false;
  const target = findTrack(project, targetTrackId);
  if (!target || !isCompatibleTrack(target, located.clip)) return false;
  if (target.locked) return false;

  const start = resolveStart(target, located.clip, desiredStart, located.clip.duration);
  if (start === null) return false;

  located.track.clips.splice(located.index, 1);
  located.clip.start = start;
  target.clips.push(located.clip);
  target.clips.sort((a, b) => a.start - b.start);
  return true;
}

export function sortTrack(track) {
  track.clips.sort((a, b) => a.start - b.start);
}

/* -------------------------------------------------------------------------
 * Undo / redo store
 * ---------------------------------------------------------------------- */

export class ProjectStore {
  constructor(project) {
    this.project = project || createProject();
    this.media = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.limit = 80;
    this.listeners = new Set();
    this.pendingSnapshot = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(reason = 'change') {
    this.project.updatedAt = Date.now();
    for (const listener of this.listeners) {
      try {
        listener(reason, this.project);
      } catch (error) {
        console.error('Editor listener failed', error);
      }
    }
  }

  snapshot() {
    return JSON.stringify(this.project);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  record(before, after) {
    if (!before || before === after) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  /** Mutate with an automatic undo entry. */
  apply(mutator, options = {}) {
    const { history = true, emit = true, reason = 'apply' } = options;
    const before = this.snapshot();
    const result = mutator(this.project);
    const after = this.snapshot();
    if (history) this.record(before, after);
    if (emit && before !== after) this.emit(reason);
    return result;
  }

  /** Begin a continuous interaction (drag, slider). */
  begin() {
    if (this.pendingSnapshot === null) this.pendingSnapshot = this.snapshot();
  }

  /** Live change without history noise. */
  live(mutator) {
    return this.apply(mutator, { history: false, emit: true });
  }

  /** Finish a continuous interaction and record one undo entry. */
  end(options = {}) {
    if (this.pendingSnapshot === null) return false;
    const before = this.pendingSnapshot;
    this.pendingSnapshot = null;
    const after = this.snapshot();
    const recorded = options.history === false ? false : this.record(before, after);
    if (recorded) this.emit(options.reason || 'commit');
    return recorded;
  }

  undo() {
    if (!this.undoStack.length) return false;
    const current = this.snapshot();
    const previous = this.undoStack.pop();
    this.redoStack.push(current);
    this.project = JSON.parse(previous);
    this.emit('undo');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const current = this.snapshot();
    const next = this.redoStack.pop();
    this.undoStack.push(current);
    this.project = JSON.parse(next);
    this.emit('redo');
    return true;
  }

  clearHistory() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pendingSnapshot = null;
  }

  replaceProject(project, { history = false } = {}) {
    const before = this.snapshot();
    this.project = project;
    this.media = new Map();
    this.clearHistory();
    if (history) this.record(before, this.snapshot());
    this.emit('replace');
  }
}

/** Serialise the project plus non-media metadata for save/restore. */
export function serializeProject(store) {
  const media = [];
  for (const asset of store.media.values()) {
    media.push({
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
  return {
    schema: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    project: deepClone(store.project),
    media
  };
}

export function restoreProject(data) {
  if (!data || typeof data !== 'object') throw new Error('This project file is not valid.');
  const project = data.project || data;
  if (!project || !Array.isArray(project.tracks)) throw new Error('This project has no timeline tracks.');
  const restored = deepClone(project);
  restored.schema = SCHEMA_VERSION;
  restored.subtitles = restored.subtitles || { enabled: true, style: defaultSubtitleStyle(), items: [] };
  restored.subtitles.style = { ...defaultSubtitleStyle(), ...(restored.subtitles.style || {}) };
  for (const track of restored.tracks) {
    track.clips = Array.isArray(track.clips) ? track.clips : [];
    track.volume = Number.isFinite(track.volume) ? track.volume : 1;
    for (const clip of track.clips) {
      clip.color = { ...defaultColor(), ...(clip.color || {}) };
      clip.text = { ...defaultText(), ...(clip.text || {}) };
      clip.shape = { ...defaultShape(), ...(clip.shape || {}) };
      clip.background = { ...defaultBackground(), ...(clip.background || {}) };
      clip.keyframes = { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [], ...(clip.keyframes || {}) };
      clip.transition = { type: 'none', duration: 0.5, reverse: false, ...(clip.transition || {}) };
      clip.inAnim = { type: 'none', duration: 0.5, ...(clip.inAnim || {}) };
      clip.outAnim = { type: 'none', duration: 0.5, ...(clip.outAnim || {}) };
      clip.crop = clip.crop || { top: 0, right: 0, bottom: 0, left: 0 };
      clip.hidden = Boolean(clip.hidden);
      clip.freeze = Boolean(clip.freeze);
      clip.freezeAt = Number.isFinite(clip.freezeAt) ? clip.freezeAt : null;
      clip.locked = Boolean(clip.locked);
    }
  }
  return { project: restored, media: Array.isArray(data.media) ? data.media : [] };
}

export function clampClipDurations(project) {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      clip.duration = Math.max(0.1, clip.duration);
      clip.start = Math.max(0, clip.start);
      if (clip.kind === 'audio' || clip.kind === 'video') {
        clip.inPoint = clamp(clip.inPoint, 0, Math.max(0, (clip.outPoint || 0) - 0.05));
      }
    }
    sortTrack(track);
  }
}
