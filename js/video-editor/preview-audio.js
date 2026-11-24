/* LetitEdit Professional Video Editor — preview audio monitor.
 *
 * The preview canvas is drawn from decoded frames, so it has no media element
 * of its own to carry sound. This mixer keeps exactly one HTMLAudioElement per
 * active clip and streams the original file, which means:
 *   · no second copy of the same audio (the canvas never plays sound itself),
 *   · long videos are not decoded into memory just for monitoring,
 *   · trimming, speed, fades, track/clip/master volume and mute use the same
 *     rules as the export mixer.
 *
 * It is intentionally small and DOM-free apart from the Audio elements so the
 * export path is unaffected. Reverse clips are silent in the preview because
 * browsers cannot play an audio stream backwards; the export still reverses
 * that audio sample-accurately.
 */

import { clipEnd } from './model.js';
import { clipSourceTime } from './renderer.js';

const EPSILON = 1e-4;
/* Only correct drift when it is large enough to hear, so normal playback is
 * never interrupted by a seek. */
const DRIFT_LIMIT = 0.28;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function gainOf(value) {
  return clamp(value, 0, 1);
}

export class PreviewAudioMixer {
  constructor({ getProject, getTime, getRate, media, onBlocked, onStatus }) {
    this.getProject = getProject;
    this.getTime = getTime;
    this.getRate = getRate;
    this.media = media;
    this.onBlocked = onBlocked;
    this.onStatus = onStatus;

    this.entries = new Map();
    this.playing = false;
    this.blockedNoticeShown = false;
    this.reportedFailures = new Set();
  }

  /* --------------------------------------------------------------------- */
  /* Lifecycle                                                             */
  /* --------------------------------------------------------------------- */

  /** Called from the play click so the browser still sees a user gesture. */
  start() {
    this.playing = true;
    this.sync(true);
  }

  /** Called once per playback tick. */
  update() {
    if (!this.playing) return;
    this.sync(false);
  }

  /** Called after a seek; repositions everything that should be audible. */
  seek() {
    if (this.playing) this.sync(true);
    else this.stop();
  }

  /** Called after project edits so volume/mute/fades apply immediately. */
  refresh() {
    if (!this.playing) return;
    this.sync(false);
  }

  stop() {
    this.playing = false;
    for (const entry of this.entries.values()) {
      entry.started = false;
      entry.pendingSeek = null;
      if (!entry.el.paused) entry.el.pause();
    }
  }

  /** Pause and release an asset that was removed from the library. */
  forgetMedia(mediaId) {
    for (const [clipId, entry] of [...this.entries]) {
      if (entry.mediaId !== mediaId) continue;
      this.disposeEntry(entry);
      this.entries.delete(clipId);
    }
  }

  dispose() {
    this.stop();
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
  }

  /* --------------------------------------------------------------------- */
  /* Mix                                                                   */
  /* --------------------------------------------------------------------- */

  activeClips(project, time) {
    const list = [];
    const master = gainOf(project.masterVolume ?? 1);
    for (const track of project.tracks) {
      if (track.muted) continue;
      const trackGain = gainOf(track.volume ?? 1);
      for (const clip of track.clips) {
        if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
        if (clip.muted || clip.reverse) continue;
        if (time < clip.start - EPSILON || time >= clipEnd(clip) - EPSILON) continue;
        const asset = this.media.get(clip.mediaId);
        if (!asset || !asset.hasAudio) continue;
        const local = time - clip.start;
        let gain = gainOf(clip.volume ?? 1) * trackGain * master;
        const fadeIn = Math.max(0, Number(clip.fadeIn) || 0);
        if (fadeIn > 0 && local < fadeIn) gain *= clamp(local / fadeIn, 0, 1);
        const fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
        const remaining = clip.duration - local;
        if (fadeOut > 0 && remaining < fadeOut) gain *= clamp(remaining / fadeOut, 0, 1);
        const source = clipSourceTime(clip, local);
        list.push({ clip, track, asset, gain: clamp(gain, 0, 1), source });
      }
    }
    return list;
  }

  sync(force) {
    const project = this.getProject();
    const time = this.getTime();
    const active = this.activeClips(project, time);
    const seen = new Set();

    for (const info of active) {
      seen.add(info.clip.id);
      const entry = this.ensureEntry(info);
      if (!entry) continue;
      this.applyVolume(entry, info.gain);
      if (force || !entry.started) {
        this.startEntry(entry, info);
        continue;
      }
      this.alignEntry(entry, info);
    }

    for (const [clipId, entry] of this.entries) {
      if (seen.has(clipId)) continue;
      entry.started = false;
      entry.pendingSeek = null;
      if (!entry.el.paused) entry.el.pause();
    }
    this.prune(project);
  }

  ensureEntry(info) {
    let entry = this.entries.get(info.clip.id);
    if (entry && entry.mediaId !== info.clip.mediaId) {
      this.disposeEntry(entry);
      this.entries.delete(info.clip.id);
      entry = null;
    }
    if (entry) return entry;

    const url = this.media.audioUrl(info.clip.mediaId);
    if (!url) return null;

    const el = new Audio();
    el.preload = 'auto';
    el.loop = false;
    el.src = url;
    entry = {
      el,
      clipId: info.clip.id,
      mediaId: info.clip.mediaId,
      started: false,
      failed: false,
      pendingSeek: null,
      volume: null,
      rate: null
    };
    el.addEventListener('loadedmetadata', () => {
      if (entry.pendingSeek === null || entry.failed) return;
      try {
        el.currentTime = Math.max(0, entry.pendingSeek);
      } catch (error) {
        /* the next tick retries */
      }
      entry.pendingSeek = null;
    });
    el.addEventListener('error', () => {
      entry.failed = true;
      if (this.reportedFailures.has(entry.mediaId)) return;
      this.reportedFailures.add(entry.mediaId);
      this.onStatus?.('This file’s audio could not be monitored in the preview, but it can still be exported.', 'warn');
    });
    this.entries.set(info.clip.id, entry);
    return entry;
  }

  rateFor(info) {
    return clamp((Number(info.clip.speed) || 1) * (Number(this.getRate()) || 1), 0.25, 4);
  }

  startEntry(entry, info) {
    entry.started = true;
    const rate = this.rateFor(info);
    if (entry.rate === null || Math.abs(entry.rate - rate) > 0.01) {
      entry.rate = rate;
      entry.el.playbackRate = rate;
      entry.pendingSeek = null;
    }
    this.seekElement(entry, info.source);
    this.playEntry(entry);
  }

  alignEntry(entry, info) {
    const rate = this.rateFor(info);
    if (entry.rate === null || Math.abs(entry.rate - rate) > 0.01) {
      entry.rate = rate;
      entry.el.playbackRate = rate;
    }
    if (entry.pendingSeek !== null) {
      if (entry.el.readyState >= 1) {
        this.seekElement(entry, info.source);
      } else {
        entry.pendingSeek = info.source;
      }
    } else if (!entry.el.seeking && Math.abs(entry.el.currentTime - info.source) > DRIFT_LIMIT) {
      this.seekElement(entry, info.source);
    }
    if (entry.el.paused && !entry.failed) this.playEntry(entry);
  }

  seekElement(entry, source) {
    const target = Math.max(0, Number(source) || 0);
    if (entry.el.readyState < 1) {
      entry.pendingSeek = target;
      return;
    }
    try {
      entry.el.currentTime = target;
      entry.pendingSeek = null;
    } catch (error) {
      entry.pendingSeek = target;
    }
  }

  playEntry(entry) {
    if (entry.failed) return;
    let promise = null;
    try {
      promise = entry.el.play();
    } catch (error) {
      this.handlePlayError(entry, error);
      return;
    }
    if (promise && typeof promise.catch === 'function') {
      promise.catch((error) => this.handlePlayError(entry, error));
    }
  }

  handlePlayError(entry, error) {
    if (!error) return;
    if (error.name === 'NotAllowedError') {
      if (this.blockedNoticeShown) return;
      this.blockedNoticeShown = true;
      this.onBlocked?.();
      return;
    }
    /* AbortError happens when a pending play is superseded by a pause/seek. */
    if (error.name === 'AbortError') return;
    entry.failed = true;
  }

  applyVolume(entry, gain) {
    const value = clamp(gain, 0, 1);
    if (entry.volume !== null && Math.abs(entry.volume - value) < 0.005) return;
    entry.volume = value;
    entry.el.volume = value;
  }

  prune(project) {
    for (const [clipId, entry] of [...this.entries]) {
      let found = null;
      for (const track of project.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (clip) {
          found = clip;
          break;
        }
      }
      if (!found || found.mediaId !== entry.mediaId) {
        this.disposeEntry(entry);
        this.entries.delete(clipId);
      }
    }
  }

  disposeEntry(entry) {
    try {
      entry.el.pause();
      entry.el.removeAttribute('src');
      entry.el.load();
    } catch (error) {
      /* already released */
    }
  }

  /* --------------------------------------------------------------------- */
  /* Diagnostics used by the automated tests                               */
  /* --------------------------------------------------------------------- */

  debug() {
    return {
      playing: this.playing,
      blocked: this.blockedNoticeShown,
      entries: [...this.entries.values()].map((entry) => ({
        clipId: entry.clipId,
        mediaId: entry.mediaId,
        started: entry.started,
        failed: entry.failed,
        paused: entry.el.paused,
        volume: entry.el.volume,
        currentTime: entry.el.currentTime,
        playbackRate: entry.el.playbackRate,
        readyState: entry.el.readyState
      }))
    };
  }
}
