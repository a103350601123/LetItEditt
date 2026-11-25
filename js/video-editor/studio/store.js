/* LetitEdit Video Editor — studio store.
 *
 * The engine still speaks in tracks and clips, because that is what the shared
 * renderer and exporter understand. The studio store adds the small amount of
 * UI state a touch editor needs (playhead, one selection, preview mute) and
 * keeps the main video pinned to the back of the visual stack.
 */

import {
  ProjectStore,
  createProject,
  createTrack,
  createClip,
  findClip,
  clipAtTime,
  clipEnd,
  projectDuration,
  projectDimensions
} from '../model.js';
import { uid } from '../utils.js';

export function createEmptyProject(name = 'Untitled video') {
  const project = createProject({ name });
  const base = createTrack('video', 'Main video');
  base.id = uid('track');
  const audio = createTrack('audio', 'Audio');
  project.tracks = [base, audio];
  project.baseTrackId = base.id;
  project.background = '#000000';
  return project;
}

export class StudioStore extends ProjectStore {
  constructor(project) {
    super(project || createEmptyProject());
    this.playhead = 0;
    this.playing = false;
    this.selectedId = null;
    this.previewMuted = false;
    this.previewQuality = 'standard';
    this.ensureBaseTrack();
  }

  duration() {
    const subtitleEnd = (this.project.subtitles?.items || []).reduce((max, item) => Math.max(max, item.end || 0), 0);
    return Math.max(projectDuration(this.project), subtitleEnd, 0);
  }

  dimensions() {
    return projectDimensions(this.project);
  }

  visualTracks() {
    return this.project.tracks.filter((track) => track.kind === 'video');
  }

  audioTracks() {
    return this.project.tracks.filter((track) => track.kind === 'audio');
  }

  ensureBaseTrack() {
    let base = this.project.tracks.find((track) => track.id === this.project.baseTrackId && track.kind === 'video');
    if (!base) {
      const visuals = this.visualTracks();
      base = visuals[visuals.length - 1] || null;
      if (!base) {
        base = createTrack('video', 'Main video');
        this.project.tracks.unshift(base);
      }
      this.project.baseTrackId = base.id;
    }
    return base;
  }

  baseTrack() {
    return this.ensureBaseTrack();
  }

  isBaseClip(clip) {
    if (!clip) return false;
    return this.baseTrack().clips.some((entry) => entry.id === clip.id);
  }

  baseClipAt(time) {
    const track = this.baseTrack();
    return clipAtTime(track, time) || track.clips[track.clips.length - 1] || null;
  }

  selected() {
    if (!this.selectedId) return null;
    return findClip(this.project, this.selectedId);
  }

  select(id) {
    this.selectedId = id || null;
  }

  clearSelection() {
    this.selectedId = null;
  }

  trackForClip(clipId) {
    return findClip(this.project, clipId);
  }

  /** Visual + audio layers in the order shown in the Layers panel. */
  layerEntries() {
    const entries = [];
    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        entries.push({ track, clip });
      }
    }
    const visual = entries.filter((entry) => entry.track.kind === 'video');
    const audio = entries.filter((entry) => entry.track.kind === 'audio');
    visual.sort((a, b) => {
      const ai = this.project.tracks.indexOf(a.track);
      const bi = this.project.tracks.indexOf(b.track);
      if (ai !== bi) return ai - bi;
      return a.clip.start - b.clip.start;
    });
    audio.sort((a, b) => a.clip.start - b.clip.start);
    return [...visual, ...audio];
  }

  /** Insert a new visual layer at the front of the visual stack. */
  addOverlayTrack(name) {
    const track = createTrack('video', name || 'Layer');
    this.project.tracks.unshift(track);
    return track;
  }

  addAudioTrack(name) {
    const track = createTrack('audio', name || 'Audio');
    this.project.tracks.push(track);
    return track;
  }

  removeTrack(track) {
    const index = this.project.tracks.indexOf(track);
    if (index === -1) return false;
    if (track.id === this.project.baseTrackId) return false;
    this.project.tracks.splice(index, 1);
    return true;
  }

  /** Remove a clip, cleaning up an overlay track that became empty. */
  removeClipEverywhere(clipId) {
    const found = findClip(this.project, clipId);
    if (!found) return false;
    found.track.clips.splice(found.index, 1);
    if (found.track.id !== this.project.baseTrackId && found.track.clips.length === 0) {
      this.removeTrack(found.track);
    }
    if (this.selectedId === clipId) this.selectedId = null;
    return true;
  }

  clampPlayhead() {
    const duration = this.duration();
    if (this.playhead > duration) this.playhead = duration;
    if (this.playhead < 0) this.playhead = 0;
  }

  /** Keep a valid selection after undo, redo or a project replacement. */
  validateSelection() {
    if (!this.selectedId) return;
    if (!findClip(this.project, this.selectedId)) this.selectedId = null;
  }

  activeVisualAt(time = this.playhead) {
    for (const track of this.visualTracks()) {
      if (track.hidden) continue;
      const clip = clipAtTime(track, time);
      if (clip && !clip.hidden) return { track, clip };
    }
    return null;
  }

  activeAudioAt(time = this.playhead) {
    const found = [];
    for (const track of this.audioTracks()) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.hidden || clip.muted) continue;
        if (time >= clip.start - 1e-6 && time < clipEnd(clip) - 1e-6) found.push({ track, clip });
      }
    }
    return found;
  }

  /** A clip that starts or ends at the playhead, used by contextual actions. */
  clipAtPlayhead(preferBase = true) {
    const selected = this.selected();
    if (selected) {
      const clip = selected.clip;
      if (this.playhead >= clip.start - 1e-6 && this.playhead < clipEnd(clip) - 1e-6) return selected;
    }
    if (preferBase) {
      const base = this.baseClipAt(this.playhead);
      if (base) {
        const track = this.baseTrack();
        return { track, clip: base, index: track.clips.indexOf(base) };
      }
    }
    return this.activeVisualAt(this.playhead);
  }

  replaceProject(project, options) {
    super.replaceProject(project, options);
    this.playhead = Math.min(this.playhead, this.duration());
    this.ensureBaseTrack();
    this.validateSelection();
  }
}
