/* LetitEdit Professional Video Editor — preview audio monitor.
 *
 * The preview canvas is drawn from decoded frames, so it has no media element
 * of its own to carry sound. This mixer decodes each source file's audio into
 * an AudioBuffer (once per asset) and schedules Web Audio buffer sources that
 * follow the same timing, speed, fade and gain rules as the export mixer.
 *
 * Why not one <audio> element per clip? Chrome can leave a fragmented MP4
 * element permanently stuck in `seeking` when it is repositioned after
 * playback, which freezes preview sound. Web Audio has no seeking at all: a
 * clip is simply started at an offset, so play, pause and scrubbing stay
 * sample-accurate and never leave a stale or doubled source behind.
 *
 * Reverse clips are silent in the preview because a buffer cannot be played
 * backwards without an extra copy; the export still reverses that audio
 * sample-accurately. Long files are downmixed to mono to bound memory, and a
 * file whose audio cannot be decoded is reported instead of silently dropped.
 */

import { clipEnd } from './model.js';
import { clipSourceTime, keyframeValue } from './renderer.js';

const EPSILON = 1e-4;
/* 24 M samples ≈ 96 MB of float32 audio; beyond this the preview keeps a mono
 * mix so a long import cannot exhaust memory. */
const MAX_SAMPLES = 24000000;
/* Small lead so the first scheduled source is not already late. */
const SCHEDULE_LEAD = 0.02;
const FADE_TIME = 0.015;

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

    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.levelData = null;
    this.nodes = new Map();
    this.buffers = new Map();
    this.playing = false;
    this.muted = false;
    this.blockedNoticeShown = false;
    this.reportedFailures = new Set();
  }

  /** Mute only the preview monitor; export levels are untouched. */
  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.playing) this.schedule();
  }

  /* --------------------------------------------------------------------- */
  /* Lifecycle                                                             */
  /* --------------------------------------------------------------------- */

  /** Called from the play click so the browser still sees a user gesture. */
  start() {
    this.playing = true;
    this.ensureContext();
    this.schedule();
  }

  /** Called once per playback tick. */
  update() {
    if (!this.playing) return;
    this.schedule();
  }

  /** Called after a seek; repositions everything that should be audible. */
  seek() {
    if (!this.playing) return;
    this.clearNodes();
    this.schedule();
  }

  /** Called after project edits so volume/mute/fades apply immediately. */
  refresh() {
    if (!this.playing) return;
    this.updateGains();
  }

  stop() {
    this.playing = false;
    this.clearNodes();
  }

  /** Release an asset that was removed from the library. */
  forgetMedia(mediaId) {
    const cached = this.buffers.get(mediaId);
    if (cached) {
      cached.disposed = true;
      this.buffers.delete(mediaId);
    }
    for (const [clipId, node] of [...this.nodes]) {
      if (node.mediaId !== mediaId) continue;
      this.stopNode(node);
      this.nodes.delete(clipId);
    }
  }

  dispose() {
    this.stop();
    this.buffers.clear();
    try {
      this.ctx?.close();
    } catch (error) {
      /* already closed */
    }
    this.ctx = null;
    this.master = null;
  }

  /* --------------------------------------------------------------------- */
  /* Web Audio plumbing                                                    */
  /* --------------------------------------------------------------------- */

  ensureContext() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        if (!this.blockedNoticeShown) {
          this.blockedNoticeShown = true;
          this.onBlocked?.();
        }
        return null;
      }
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.master.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        this.levelData = new Uint8Array(this.analyser.fftSize);
      } catch (error) {
        this.ctx = null;
        this.master = null;
        this.analyser = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        if (this.blockedNoticeShown) return;
        this.blockedNoticeShown = true;
        this.onBlocked?.();
      });
    }
    return this.ctx;
  }

  clearNodes() {
    for (const node of this.nodes.values()) this.stopNode(node);
    this.nodes.clear();
  }

  stopNode(node) {
    try {
      node.source.onended = null;
      node.source.stop();
    } catch (error) {
      /* already stopped */
    }
    try {
      node.source.disconnect();
      node.gain.disconnect();
    } catch (error) {
      /* already disconnected */
    }
  }

  /* --------------------------------------------------------------------- */
  /* Decoding                                                              */
  /* --------------------------------------------------------------------- */

  ensureBuffer(asset) {
    const existing = this.buffers.get(asset.id);
    if (existing) return existing;
    const ctx = this.ctx;
    if (!ctx) return null;
    const cached = { state: 'loading', buffer: null, disposed: false };
    this.buffers.set(asset.id, cached);
    if (!asset.file) {
      cached.state = 'unavailable';
      return cached;
    }
    (async () => {
      try {
        const data = await asset.file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(data);
        if (cached.disposed) return;
        cached.buffer = this.boundBuffer(decoded);
        cached.state = 'ready';
        if (this.playing) this.schedule();
      } catch (error) {
        if (cached.disposed) return;
        cached.state = 'failed';
        if (this.reportedFailures.has(asset.id)) return;
        this.reportedFailures.add(asset.id);
        this.onStatus?.(`Preview sound for “${asset.name}” could not be decoded. The export still includes its audio.`, 'warn');
      }
    })();
    return cached;
  }

  /** Keep preview audio memory bounded by folding very long files to mono. */
  boundBuffer(buffer) {
    const channels = buffer.numberOfChannels;
    const samples = buffer.length * channels;
    if (samples <= MAX_SAMPLES || channels === 1) return buffer;
    const ctx = this.ctx;
    const mono = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
    const target = mono.getChannelData(0);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) target[i] += data[i] / channels;
    }
    return mono;
  }

  /* --------------------------------------------------------------------- */
  /* Mix                                                                   */
  /* --------------------------------------------------------------------- */

  activeClips(project, time) {
    const list = [];
    if (this.muted) return list;
    const master = gainOf(project.masterVolume ?? 1);
    for (const track of project.tracks) {
      if (track.muted) continue;
      const trackGain = gainOf(track.volume ?? 1);
      for (const clip of track.clips) {
        if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
        /* Keep parity with the export mixer: hidden, frozen, muted and
         * reversed clips contribute no audio. Reverse playback is silent in
         * the preview because browsers cannot stream audio backwards. */
        if (clip.muted || clip.hidden || clip.freeze || clip.reverse) continue;
        if (time < clip.start - EPSILON || time >= clipEnd(clip) - EPSILON) continue;
        const asset = this.media.get(clip.mediaId);
        if (!asset || !asset.hasAudio) continue;
        const local = time - clip.start;
        const clipVolume = keyframeValue(clip, 'volume', local, Number.isFinite(clip.volume) ? clip.volume : 1);
        let gain = gainOf(clipVolume) * trackGain * master;
        const fadeIn = Math.max(0, Number(clip.fadeIn) || 0);
        if (fadeIn > 0 && local < fadeIn) gain *= clamp(local / fadeIn, 0, 1);
        const fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
        const remaining = clip.duration - local;
        if (fadeOut > 0 && remaining < fadeOut) gain *= clamp(remaining / fadeOut, 0, 1);
        /* Nothing to hear when master, track, clip or a fade is at zero. */
        if (gain <= EPSILON) continue;
        const source = clipSourceTime(clip, local);
        list.push({ clip, track, asset, gain: clamp(gain, 0, 1), source });
      }
    }
    return list;
  }

  /** Match scheduled sources to what should be audible right now. */
  schedule() {
    if (!this.playing || !this.ctx) return;
    const project = this.getProject();
    const time = this.getTime();
    const active = this.activeClips(project, time);
    const seen = new Set();

    for (const info of active) {
      seen.add(info.clip.id);
      const existing = this.nodes.get(info.clip.id);
      if (existing && existing.mediaId === info.clip.mediaId) {
        this.updateGain(existing, info);
        continue;
      }
      if (existing) {
        this.stopNode(existing);
        this.nodes.delete(info.clip.id);
      }
      this.startNode(info, time);
    }

    for (const [clipId, node] of [...this.nodes]) {
      if (seen.has(clipId)) continue;
      this.stopNode(node);
      this.nodes.delete(clipId);
    }
  }

  startNode(info, time) {
    const cached = this.ensureBuffer(info.asset);
    if (!cached || !cached.buffer) return;
    const ctx = this.ctx;
    const buffer = cached.buffer;
    const offset = clamp(info.source, 0, Math.max(0, buffer.duration - 0.001));
    const speed = clamp((Number(info.clip.speed) || 1) * (Number(this.getRate()) || 1), 0.25, 4);
    const remaining = Math.max(0, clipEnd(info.clip) - time);
    const bufferDuration = Math.min(buffer.duration - offset, remaining * speed);
    if (bufferDuration <= 0) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    const gain = ctx.createGain();
    gain.gain.value = info.gain;
    source.connect(gain);
    gain.connect(this.master);

    const node = {
      clipId: info.clip.id,
      mediaId: info.clip.mediaId,
      source,
      gain,
      bufferDuration,
      speed,
      gainValue: info.gain
    };
    source.onended = () => {
      if (this.nodes.get(info.clip.id) !== node) return;
      this.nodes.delete(info.clip.id);
    };
    try {
      source.start(ctx.currentTime + SCHEDULE_LEAD, offset, bufferDuration);
    } catch (error) {
      this.stopNode(node);
      return;
    }
    this.nodes.set(info.clip.id, node);
  }

  updateGain(node, info) {
    if (Math.abs(node.gainValue - info.gain) < 0.002) return;
    node.gainValue = info.gain;
    try {
      node.gain.gain.setTargetAtTime(info.gain, this.ctx.currentTime, FADE_TIME);
    } catch (error) {
      node.gain.gain.value = info.gain;
    }
  }

  updateGains() {
    if (!this.ctx) return;
    const project = this.getProject();
    const time = this.getTime();
    const active = new Map(this.activeClips(project, time).map((info) => [info.clip.id, info]));
    for (const [clipId, node] of this.nodes) {
      const info = active.get(clipId);
      if (!info) continue;
      this.updateGain(node, info);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Diagnostics used by the automated tests                               */
  /* --------------------------------------------------------------------- */

  debug() {
    let level = 0;
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.levelData);
      let sum = 0;
      for (let i = 0; i < this.levelData.length; i += 1) {
        const value = (this.levelData[i] - 128) / 128;
        sum += value * value;
      }
      level = Math.sqrt(sum / this.levelData.length);
    }
    return {
      playing: this.playing,
      muted: this.muted,
      blocked: this.blockedNoticeShown,
      context: this.ctx ? this.ctx.state : 'none',
      sampleRate: this.ctx ? this.ctx.sampleRate : 0,
      level,
      decoding: [...this.buffers.values()].map((entry) => entry.state),
      entries: [...this.nodes.values()].map((node) => ({
        clipId: node.clipId,
        mediaId: node.mediaId,
        gain: node.gainValue,
        playbackRate: node.speed,
        bufferDuration: node.bufferDuration
      }))
    };
  }
}
