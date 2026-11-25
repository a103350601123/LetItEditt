/* LetitEdit editor V3 — preview monitor, direct canvas editing and transport.
 * The page and the export worker still share ../renderer.js, so the frame in
 * this monitor is produced by the same rules as the exported file.
 */

import { clipBounds, renderComposition, resolveTransform } from '../renderer.js';
import { clipAtTime, clipEnd, projectDuration } from '../model.js';
import { PreviewAudioMixer } from '../preview-audio.js';
import { clamp, num } from './dom.js';

const MAX_PREVIEW_EDGE = 1280;
const QUALITY_EDGE = { low: 540, standard: 720, high: 1080 };

export class Preview {
  constructor({ store, media, onTime, onStatus, onSelect }) {
    this.store = store;
    this.media = media;
    this.source = {
      getFrame: (id, time, maxDimension) => media.frameAt(id, time, maxDimension),
      getImage: (id) => media.getImage(id)
    };
    this.onTime = onTime || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onSelect = onSelect || (() => {});
    this.canvas = null;
    this.ctx = null;
    this.frame = null;
    this.shell = null;
    this.stage = null;
    this.overlay = null;
    this.empty = null;
    this.back = document.createElement('canvas');
    this.renderToken = 0;
    this.renderQueued = false;
    this.renderInFlight = false;
    this.renderPending = false;
    this.lastRenderedTime = null;
    this.lastRenderStartedAt = 0;
    this.lastRenderFinishedAt = 0;
    this.lastRenderMs = 0;
    this.raf = 0;
    this.playStart = 0;
    this.playFrom = 0;
    this.playToken = 0;
    this.playing = false;
    this.lastDemoFrame = -1;
    this.selectionBox = null;
    this.guides = null;
    this.audio = new PreviewAudioMixer({
      getProject: () => this.store.project,
      getTime: () => this.store.playhead,
      getRate: () => (this.store.playing ? this.rate : 1),
      media: this.media,
      onBlocked: () => this.onStatus('The browser blocked preview audio. Press play again to allow sound.', 'warn'),
      onStatus: (message, tone) => this.onStatus(message, tone)
    });
    this.rate = 1;
    this.quality = 'standard';
    this.drag = null;
    this._boundPointerMove = this.onPointerMove.bind(this);
    this._boundPointerUp = this.onPointerUp.bind(this);
  }

  mount(root) {
    this.root = root;
    this.canvas = root.querySelector('#ve-preview-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.frame = root.querySelector('.ve-canvas-frame');
    this.shell = root.querySelector('#ve-preview-shell');
    this.stage = root.querySelector('#ve-preview-stage');
    this.overlay = root.querySelector('#ve-canvas-overlay');
    this.empty = root.querySelector('#ve-preview-empty');
    this.guides = root.querySelector('#ve-preview-guides');
    this.overlay.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this._resize = this.layout.bind(this);
    this._visibility = () => {
      /* rAF stops while the tab is hidden but the audio clock does not, so
       * stop both instead of letting sound run ahead of the picture. */
      if (document.hidden && this.playing) this.pause();
    };
    document.addEventListener('visibilitychange', this._visibility);
    if (window.ResizeObserver) {
      this.observer = new ResizeObserver(this._resize);
      this.observer.observe(this.stage);
    } else {
      window.addEventListener('resize', this._resize);
    }
    this.store.subscribe((reason) => {
      if (!this.playing) this.scheduleRender();
      if (this.store.selectedSubtitle) this.updateOverlay();
      else this.updateOverlay();
      this.onTime(this.store.playhead);
      if (reason === 'undo' || reason === 'redo' || reason === 'replace') this.layout();
    });
    this.layout();
    this.scheduleRender();
  }

  layout() {
    if (!this.frame || !this.stage) return;
    const project = this.store.project;
    const dims = this.store.dimensions();
    const rect = this.stage.getBoundingClientRect();
    const pad = 24;
    const availableW = Math.max(120, rect.width - pad);
    const availableH = Math.max(100, rect.height - pad);
    const zoom = clamp(this.store.previewZoom || 1, 0.5, 2.5);
    const scale = Math.min(availableW / dims.width, availableH / dims.height) * zoom;
    const width = Math.max(120, Math.round(dims.width * scale));
    const height = Math.max(80, Math.round(dims.height * scale));
    this.frame.style.width = `${width}px`;
    this.frame.style.height = `${height}px`;
    this.frame.style.setProperty('--ve-aspect', `${dims.width} / ${dims.height}`);

    const qualityEdge = QUALITY_EDGE[this.quality] || QUALITY_EDGE.standard;
    const previewEdge = Math.min(MAX_PREVIEW_EDGE, qualityEdge, Math.max(dims.width, dims.height));
    const ratio = dims.width / dims.height;
    let bw;
    let bh;
    if (ratio >= 1) {
      bw = Math.min(dims.width, previewEdge);
      bh = Math.max(2, Math.round(bw / ratio));
    } else {
      bh = Math.min(dims.height, previewEdge);
      bw = Math.max(2, Math.round(bh * ratio));
    }
    const roundedW = Math.max(2, Math.round(bw / 2) * 2);
    const roundedH = Math.max(2, Math.round(bh / 2) * 2);
    if (this.canvas.width !== roundedW || this.canvas.height !== roundedH) {
      this.canvas.width = roundedW;
      this.canvas.height = roundedH;
      this.back.width = roundedW;
      this.back.height = roundedH;
      this.scheduleRender();
    }
    this.frame.dataset.width = String(dims.width);
    this.frame.dataset.height = String(dims.height);
    this.updateGuides();
    this.updateOverlay();
  }

  updateGuides() {
    if (!this.guides) return;
    const guides = this.store.project.guides || {};
    this.guides.classList.toggle('show-center', Boolean(guides.center));
    this.guides.classList.toggle('show-safe', Boolean(guides.safe));
  }

  setZoom(zoom) {
    this.store.previewZoom = clamp(zoom, 0.5, 2.5);
    this.layout();
  }

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.requestRender();
    });
  }

  /* One composition pass at a time, newest request wins.
   *
   * The old code started a render on every animation frame without waiting
   * for the previous one. Each pass seeks the same MediaBunny canvas sink and
   * draws through the same scratch canvases, so a slow file accumulated a
   * queue of stale frame requests. The visible frame then fell seconds behind
   * the ruler while the discarded passes kept decoding. Coalescing to a
   * single in-flight pass keeps at most one seek alive and drops every
   * intermediate time that is already obsolete. */
  requestRender() {
    if (this.renderInFlight) {
      this.renderPending = true;
      return Promise.resolve(false);
    }
    this.renderInFlight = true;
    this.renderPending = false;
    return this.renderNow()
      .catch(() => {})
      .finally(() => {
        this.renderInFlight = false;
        if (this.renderPending) {
          this.renderPending = false;
          this.requestRender();
        }
      });
  }

  /* Called by seeks and pauses: an in-flight pass for the old time must not
   * paint over the new playhead when it finally resolves. */
  invalidateRender() {
    this.renderToken += 1;
    if (this.renderInFlight) this.renderPending = true;
  }

  async renderNow() {
    const token = ++this.renderToken;
    const time = this.store.playhead;
    const startedAt = performance.now();
    this.lastRenderStartedAt = startedAt;
    try {
      await renderComposition(this.back.getContext('2d'), this.store.project, this.source, time, {
        maxDimension: Math.max(this.canvas.width, this.canvas.height)
      });
      if (token !== this.renderToken) return;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.back, 0, 0);
      this.ctx.restore();
      this.lastRenderedTime = time;
      this.lastRenderFinishedAt = performance.now();
      this.lastRenderMs = this.lastRenderFinishedAt - startedAt;
      this.empty.hidden = this.hasContentAt(time);
      this.updateOverlay();
    } catch (error) {
      if (token !== this.renderToken) return;
      this.onStatus(`A frame could not be drawn: ${error.message || error}`, 'error');
    }
  }

  renderPreviewNow() {
    this.renderQueued = false;
    return this.requestRender();
  }

  hasContentAt(time) {
    return this.store.project.tracks.some((track) =>
      track.kind === 'video' && !track.hidden &&
      track.clips.some((clip) => !clip.hidden && time >= clip.start - 1e-6 && time < clipEnd(clip) - 1e-6)
    ) || this.store.project.subtitles.items.some((item) => time >= item.start && time < item.end && item.text.trim());
  }

  duration() {
    return Math.max(
      projectDuration(this.store.project),
      this.store.project.subtitles?.items?.reduce((max, item) => Math.max(max, item.end), 0) || 0
    );
  }

  seek(time, { keepPlaying = false } = {}) {
    const duration = this.duration();
    this.store.playhead = clamp(time, 0, Math.max(0, duration));
    /* A pass that was already decoding the old time must not paint over the
       frame we are seeking to. */
    this.invalidateRender();
    if (this.playing && !keepPlaying) {
      this.pause();
    } else if (this.playing) {
      this.playStart = performance.now() - (this.store.playhead - this.playFrom) * 1000 / this.rate;
      this.audio.seek();
    }
    this.onTime(this.store.playhead);
    this.scheduleRender();
  }

  stepFrames(direction) {
    const fps = Math.max(1, num(this.store.project.fps, 30));
    this.seek(this.store.playhead + direction / fps);
  }

  setRate(rate) {
    const next = clamp(rate, 0.25, 4);
    if (this.playing) {
      this.playFrom = this.store.playhead;
      this.playStart = performance.now();
    }
    this.rate = next;
    /* Re-schedule so the new speed applies to the already-started sources. */
    this.audio.seek();
    return next;
  }

  play() {
    if (this.playing) return true;
    const duration = this.duration();
    if (duration <= 0) {
      this.onStatus('Add something to the timeline before playing.', 'info');
      return false;
    }
    if (this.store.playhead >= duration - 0.01) this.seek(0);
    this.playing = true;
    this.store.playing = true;
    this.playFrom = this.store.playhead;
    this.playStart = performance.now();
    const generation = ++this.playToken;
    this.audio.start();
    this.onTime(this.store.playhead);
    const tick = (now) => {
      /* A pause or a second play() invalidates this loop, so an old timer can
         never overwrite the authoritative playhead. */
      if (!this.playing || generation !== this.playToken) return;
      const elapsed = (now - this.playStart) / 1000;
      const next = this.playFrom + elapsed * this.rate;
      if (next >= duration) {
        this.store.playhead = duration;
        this.pause();
        this.onTime(duration);
        this.scheduleRender();
        return;
      }
      this.store.playhead = next;
      this.audio.update();
      this.onTime(next);
      this.scheduleRender();
      this.raf = requestAnimationFrame(tick);
    };
    /* The mixer joins at the live playhead once the file can actually play,
     * so a slow-buffering MP4 starts in sync instead of half a second late. */
    this.raf = requestAnimationFrame(tick);
    return true;
  }

  pause() {
    this.playing = false;
    this.store.playing = false;
    this.playToken += 1;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.invalidateRender();
    this.onTime(this.store.playhead);
    this.scheduleRender();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  dispose() {
    this.pause();
    this.audio.dispose();
    this.observer?.disconnect();
    window.removeEventListener('resize', this._resize);
    document.removeEventListener('visibilitychange', this._visibility);
  }

  /* Direct canvas manipulation ------------------------------------------- */

  activeVisual() {
    const current = this.store.playhead;
    for (const track of this.store.project.tracks) {
      if (track.kind !== 'video' || track.hidden) continue;
      const clip = clipAtTime(track, current);
      if (clip && !clip.hidden) return { track, clip };
    }
    return null;
  }

  selectedVisual() {
    const found = this.store.firstSelected();
    if (!found || found.track.kind !== 'video' || found.clip.hidden) return null;
    if (this.store.playhead < found.clip.start || this.store.playhead >= clipEnd(found.clip)) return null;
    return found;
  }

  sourceSize(clip) {
    if (!clip.mediaId) return { width: this.canvas.width, height: this.canvas.height };
    const asset = this.media.get(clip.mediaId);
    if (!asset) return { width: this.canvas.width, height: this.canvas.height };
    return {
      width: asset.width || this.canvas.width,
      height: asset.height || this.canvas.height
    };
  }

  boundsFor(clip) {
    const source = this.sourceSize(clip);
    return clipBounds(clip, this.store.playhead - clip.start, this.canvas.width, this.canvas.height, source.width, source.height);
  }

  updateOverlay() {
    if (!this.overlay || !this.frame) return;
    const selected = this.selectedVisual();
    this.overlay.innerHTML = '';
    this.overlay.classList.toggle('has-selection', Boolean(selected));
    if (!selected) return;
    const bounds = this.boundsFor(selected.clip);
    const scaleX = this.frame.clientWidth / this.canvas.width;
    const scaleY = this.frame.clientHeight / this.canvas.height;
    const width = Math.max(18, bounds.width * scaleX);
    const height = Math.max(18, bounds.height * scaleY);
    const left = bounds.x * scaleX;
    const top = bounds.y * scaleY;
    const box = document.createElement('div');
    box.className = 've-selection-box';
    box.dataset.selectedId = selected.clip.id;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.transform = `translate(-50%, -50%) rotate(${bounds.rotation || 0}deg)`;
    box.innerHTML = [
      '<span class="ve-handle ve-handle-nw" data-handle="nw"></span>',
      '<span class="ve-handle ve-handle-ne" data-handle="ne"></span>',
      '<span class="ve-handle ve-handle-sw" data-handle="sw"></span>',
      '<span class="ve-handle ve-handle-se" data-handle="se"></span>',
      '<span class="ve-handle ve-handle-rotate" data-handle="rotate"></span>'
    ].join('');
    this.overlay.appendChild(box);
    this.selectionBox = box;
  }

  pointInClip(clip, point) {
    const bounds = this.boundsFor(clip);
    const x = point.x;
    const y = point.y;
    const angle = -(bounds.rotation || 0) * Math.PI / 180;
    const dx = x - bounds.x;
    const dy = y - bounds.y;
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(rx) <= bounds.width / 2 && Math.abs(ry) <= bounds.height / 2;
  }

  eventPoint(event) {
    const rect = this.frame.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / Math.max(1, rect.width) * this.canvas.width,
      y: (event.clientY - rect.top) / Math.max(1, rect.height) * this.canvas.height
    };
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const point = this.eventPoint(event);
    const handle = event.target.closest('[data-handle]');
    let selected = this.selectedVisual();
    if (handle && selected) {
      event.preventDefault();
      this.startDrag(event, selected, handle.dataset.handle, point);
      return;
    }
    let hit = null;
    for (const track of this.store.project.tracks) {
      if (track.kind !== 'video' || track.hidden || track.locked) continue;
      const clip = clipAtTime(track, this.store.playhead);
      if (!clip || clip.hidden || clip.locked) continue;
      if (this.pointInClip(clip, point)) {
        hit = { track, clip };
        break;
      }
    }
    if (!hit) {
      this.store.clearSelection();
      this.store.emit('selection');
      this.updateOverlay();
      this.onSelect(null);
      return;
    }
    this.store.selectClip(hit.clip.id);
    this.store.emit('selection');
    this.onSelect(hit.clip.id);
    this.updateOverlay();
    event.preventDefault();
    this.startDrag(event, hit, 'move', point);
  }

  startDrag(event, found, mode, point) {
    const clip = found.clip;
    const transform = resolveTransform(clip, clamp(this.store.playhead - clip.start, 0, Math.max(0, clip.duration)));
    this.store.begin();
    this.drag = {
      mode,
      pointerId: event.pointerId,
      clipId: clip.id,
      startX: transform.x,
      startY: transform.y,
      startScale: transform.scale,
      startRotation: transform.rotation,
      center: this.boundsFor(clip),
      point,
      moved: false
    };
    this.frame.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', this._boundPointerMove, { passive: false });
    window.addEventListener('pointerup', this._boundPointerUp, { once: true });
    window.addEventListener('pointercancel', this._boundPointerUp, { once: true });
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const point = this.eventPoint(event);
    const dx = point.x - this.drag.point.x;
    const dy = point.y - this.drag.point.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) this.drag.moved = true;
    const found = this.store.trackForClip(this.drag.clipId);
    if (!found) return;
    const clip = found.clip;
    if (this.drag.mode === 'move') {
      let x = this.drag.startX + dx / this.canvas.width;
      let y = this.drag.startY + dy / this.canvas.height;
      if (this.store.snapping) {
        x = this.snap(x, 0.5, 0.012);
        y = this.snap(y, 0.5, 0.012);
      }
      x = clamp(x, -0.5, 1.5);
      y = clamp(y, -0.5, 1.5);
      this.writeAnimated(clip, 'x', x);
      this.writeAnimated(clip, 'y', y);
      this.showGuide('v', Math.abs(x - 0.5) < 0.015);
      this.showGuide('h', Math.abs(y - 0.5) < 0.015);
    } else if (this.drag.mode === 'rotate') {
      const angle = Math.atan2(point.y - this.drag.center.y, point.x - this.drag.center.x) * 180 / Math.PI + 90;
      this.writeAnimated(clip, 'rotation', Math.round(angle * 10) / 10);
    } else {
      const distanceStart = Math.hypot(this.drag.point.x - this.drag.center.x, this.drag.point.y - this.drag.center.y);
      const distanceNow = Math.hypot(point.x - this.drag.center.x, point.y - this.drag.center.y);
      const factor = distanceStart > 5 ? distanceNow / distanceStart : 1;
      this.writeAnimated(clip, 'scale', clamp(this.drag.startScale * factor, 0.04, 8));
    }
    this.store.emit('live-drag');
    this.updateOverlay();
    this.scheduleRender();
    event.preventDefault();
  }

  /* Dragging an animated layer writes the keyframe under the playhead instead
   * of a base value that interpolation would immediately hide. */
  writeAnimated(clip, prop, value) {
    const list = clip.keyframes?.[prop];
    if (!list || !list.length) {
      clip[prop] = value;
      return;
    }
    const local = clamp(this.store.playhead - clip.start, 0, Math.max(0, clip.duration));
    const existing = list.find((entry) => Math.abs(entry.t - local) < 0.015);
    if (existing) existing.v = value;
    else {
      list.push({ t: local, v: value, ease: 'linear' });
      list.sort((a, b) => a.t - b.t);
    }
  }

  snap(value, target, threshold) {
    return Math.abs(value - target) < threshold ? target : value;
  }

  showGuide(axis, show) {
    if (!this.guides || !this.store.project.guides) return;
    const line = this.guides.querySelector(axis === 'v' ? '.ve-guide-v' : '.ve-guide-h');
    if (line) line.classList.toggle('is-active', Boolean(show));
  }

  onPointerUp(event) {
    if (!this.drag) return;
    if (event && event.pointerId !== this.drag.pointerId) return;
    window.removeEventListener('pointermove', this._boundPointerMove);
    window.removeEventListener('pointerup', this._boundPointerUp);
    window.removeEventListener('pointercancel', this._boundPointerUp);
    if (this.drag.moved) this.store.end('preview-drag');
    else this.store.end({ history: false });
    this.drag = null;
    this.updateOverlay();
    this.scheduleRender();
    this.onTime(this.store.playhead);
  }

  zoomToFit() {
    this.store.previewZoom = 1;
    this.layout();
  }

  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.shell.requestFullscreen();
      return true;
    } catch (error) {
      this.onStatus('Fullscreen was blocked by the browser.', 'warn');
      return false;
    }
  }

  debug() {
    return {
      playing: this.playing,
      time: this.store.playhead,
      renderedTime: this.lastRenderedTime,
      renderLag: this.lastRenderedTime === null ? null : this.store.playhead - this.lastRenderedTime,
      renderMs: this.lastRenderMs,
      renderInFlight: this.renderInFlight,
      renderPending: this.renderPending,
      audio: this.audio.debug(),
      canvas: { width: this.canvas.width, height: this.canvas.height },
      selection: this.store.firstSelected()?.clip?.id || null
    };
  }
}
