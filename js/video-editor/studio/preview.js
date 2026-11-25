/* LetitEdit Video Editor — preview monitor and direct canvas editing.
 *
 * The page and the export worker share ../renderer.js, so the frame in this
 * monitor is produced by the same rules as the exported file. Composition
 * passes are coalesced to one in-flight pass: a slow decode can no longer
 * queue stale frames and make the picture fall seconds behind the ruler.
 */

import { clipBounds, renderComposition, resolveTransform } from '../renderer.js';
import { clipAtTime, clipEnd } from '../model.js';
import { PreviewAudioMixer } from '../preview-audio.js';
import { clamp } from '../utils.js';

const MAX_PREVIEW_EDGE = 1280;
const QUALITY_EDGE = { low: 540, standard: 720, high: 1080 };

export class Preview {
  constructor({ store, media, onTime, onStatus, onSelect, onRequestEdit }) {
    this.store = store;
    this.media = media;
    this.onTime = onTime || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onRequestEdit = onRequestEdit || (() => {});
    this.source = {
      getFrame: (id, time, maxDimension) => media.frameAt(id, time, maxDimension),
      getImage: (id) => media.getImage(id)
    };
    this.canvas = null;
    this.ctx = null;
    this.frame = null;
    this.stage = null;
    this.overlay = null;
    this.empty = null;
    this.back = document.createElement('canvas');
    this.renderToken = 0;
    this.renderQueued = false;
    this.renderInFlight = false;
    this.renderPending = false;
    this.lastRenderedTime = null;
    this.lastRenderMs = 0;
    this.raf = 0;
    this.playStart = 0;
    this.playFrom = 0;
    this.playToken = 0;
    this.playing = false;
    this.rate = 1;
    this.quality = 'standard';
    this.drag = null;
    this.selectionBox = null;
    this.lastTap = { id: null, at: 0 };
    this._boundPointerMove = this.onPointerMove.bind(this);
    this._boundPointerUp = this.onPointerUp.bind(this);
    this.audio = new PreviewAudioMixer({
      getProject: () => this.store.project,
      getTime: () => this.store.playhead,
      getRate: () => (this.store.playing ? this.rate : 1),
      media: this.media,
      onBlocked: () => this.onStatus('The browser blocked preview audio. Press play again to allow sound.', 'warn'),
      onStatus: (message, tone) => this.onStatus(message, tone)
    });
    this.audio.setMuted(Boolean(this.store.previewMuted));
  }

  mount(root) {
    this.root = root;
    this.canvas = root.querySelector('#se-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.frame = root.querySelector('#se-frame');
    this.stage = root.id === 'se-stage' ? root : root.querySelector('#se-stage');
    this.overlay = root.querySelector('#se-overlay');
    this.empty = root.querySelector('#se-empty');
    this.overlay.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this._resize = this.layout.bind(this);
    this._visibility = () => {
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
      else this.audio.refresh();
      this.updateOverlay();
      this.onTime(this.store.playhead);
      if (reason === 'undo' || reason === 'redo' || reason === 'replace') this.layout();
      const dims = this.store.dimensions();
      if (this.lastDims && (this.lastDims.width !== dims.width || this.lastDims.height !== dims.height)) this.layout();
      this.lastDims = dims;
    });
    this.layout();
    this.scheduleRender();
  }

  layout() {
    if (!this.frame || !this.stage) return;
    const project = this.store.project;
    const dims = this.store.dimensions();
    const rect = this.stage.getBoundingClientRect();
    const horizontal = window.innerWidth <= 430 ? 18 : window.innerWidth < 760 ? 30 : 50;
    const availableW = Math.max(150, rect.width - horizontal);
    const maxH = Math.max(170, Math.min(window.innerHeight * (window.innerWidth < 560 ? 0.46 : 0.58), 640));
    const ratio = dims.width / dims.height;
    let width = availableW;
    let height = width / ratio;
    if (height > maxH) {
      height = maxH;
      width = height * ratio;
    }
    this.frame.style.width = `${Math.max(120, Math.round(width))}px`;
    this.frame.style.height = `${Math.max(80, Math.round(height))}px`;

    const edge = Math.min(MAX_PREVIEW_EDGE, QUALITY_EDGE[this.quality] || QUALITY_EDGE.standard, Math.max(dims.width, dims.height));
    let bw;
    let bh;
    if (ratio >= 1) {
      bw = Math.min(dims.width, edge);
      bh = Math.max(2, Math.round(bw / ratio));
    } else {
      bh = Math.min(dims.height, edge);
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
    this.lastDims = dims;
    this.updateOverlay();
  }

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.requestRender();
    });
  }

  /* One composition pass at a time, newest request wins. */
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

  invalidateRender() {
    this.renderToken += 1;
    if (this.renderInFlight) this.renderPending = true;
  }

  async renderNow() {
    const token = ++this.renderToken;
    const time = this.store.playhead;
    const startedAt = performance.now();
    try {
      await renderComposition(this.back.getContext('2d'), this.store.project, this.source, time, {
        maxDimension: Math.max(this.canvas.width, this.canvas.height)
      });
      if (token !== this.renderToken) return;
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalAlpha = 1;
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.filter = 'none';
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.back, 0, 0);
      this.ctx.restore();
      this.lastRenderedTime = time;
      this.lastRenderMs = performance.now() - startedAt;
      this.updateEmptyState(time);
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
      track.kind === 'video' &&
      !track.hidden &&
      track.clips.some((clip) => !clip.hidden && time >= clip.start - 1e-6 && time < clipEnd(clip) - 1e-6)
    ) || (this.store.project.subtitles?.items || []).some(
      (item) => time >= item.start && time < item.end && String(item.text || '').trim()
    );
  }

  updateEmptyState(time = this.store.playhead) {
    if (!this.empty) return;
    this.empty.hidden = this.hasContentAt(time) || this.store.duration() > 0;
  }

  duration() {
    return this.store.duration();
  }

  seek(time, { keepPlaying = false } = {}) {
    const duration = this.duration();
    this.store.playhead = clamp(Number(time) || 0, 0, Math.max(0, duration));
    this.invalidateRender();
    if (this.playing && !keepPlaying) {
      this.pause();
    } else if (this.playing) {
      this.playStart = performance.now() - ((this.store.playhead - this.playFrom) * 1000) / this.rate;
      this.audio.seek();
    }
    this.onTime(this.store.playhead);
    this.scheduleRender();
  }

  stepFrames(direction) {
    const fps = Math.max(1, Number(this.store.project.fps) || 30);
    this.seek(this.store.playhead + direction / fps);
  }

  setRate(rate) {
    const next = clamp(rate, 0.25, 4);
    if (this.playing) {
      this.playFrom = this.store.playhead;
      this.playStart = performance.now();
    }
    this.rate = next;
    this.audio.seek();
    return next;
  }

  setMuted(muted) {
    this.store.previewMuted = Boolean(muted);
    this.audio.setMuted(this.store.previewMuted);
  }

  play() {
    if (this.playing) return true;
    const duration = this.duration();
    if (duration <= 0) {
      this.onStatus('Add a video or another layer before playing.', 'info');
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

  selectedVisual() {
    const found = this.store.selected();
    if (!found || found.track.kind !== 'video' || found.clip.hidden) return null;
    if (this.store.playhead < found.clip.start - 1e-6 || this.store.playhead >= clipEnd(found.clip) - 1e-6) return null;
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
    return clipBounds(
      clip,
      clamp(this.store.playhead - clip.start, 0, Math.max(0, clip.duration)),
      this.canvas.width,
      this.canvas.height,
      source.width,
      source.height
    );
  }

  updateOverlay() {
    if (!this.overlay || !this.frame) return;
    const selected = this.selectedVisual();
    if (!selected) {
      if (this.selectionBox) {
        this.selectionBox.remove();
        this.selectionBox = null;
      }
      this.overlay.classList.remove('has-selection');
      return;
    }
    const clip = selected.clip;
    const base = this.store.isBaseClip(clip);
    const bounds = this.boundsFor(clip);
    const scaleX = this.frame.clientWidth / this.canvas.width;
    const scaleY = this.frame.clientHeight / this.canvas.height;
    const width = Math.max(20, bounds.width * scaleX);
    const height = Math.max(20, bounds.height * scaleY);
    const left = bounds.x * scaleX;
    const top = bounds.y * scaleY;

    let box = this.selectionBox;
    if (!box || box.dataset.selectedId !== clip.id) {
      if (box) box.remove();
      box = document.createElement('div');
      box.className = `se-selection-box${base ? ' is-base' : ''}`;
      box.dataset.selectedId = clip.id;
      if (!base && !clip.locked) {
        box.innerHTML = [
          '<span class="se-handle se-handle-nw" data-handle="nw"></span>',
          '<span class="se-handle se-handle-ne" data-handle="ne"></span>',
          '<span class="se-handle se-handle-sw" data-handle="sw"></span>',
          '<span class="se-handle se-handle-se" data-handle="se"></span>',
          '<span class="se-handle se-handle-rotate" data-handle="rotate"></span>'
        ].join('');
      }
      this.overlay.appendChild(box);
      this.selectionBox = box;
    }
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.transform = `translate(-50%, -50%) rotate(${bounds.rotation || 0}deg)`;
    this.overlay.classList.add('has-selection');
  }

  pointInClip(clip, point) {
    const bounds = this.boundsFor(clip);
    const angle = (-(bounds.rotation || 0) * Math.PI) / 180;
    const dx = point.x - bounds.x;
    const dy = point.y - bounds.y;
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(rx) <= bounds.width / 2 && Math.abs(ry) <= bounds.height / 2;
  }

  eventPoint(event) {
    const rect = this.frame.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * this.canvas.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * this.canvas.height
    };
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const point = this.eventPoint(event);
    const handle = event.target.closest('[data-handle]');
    let selected = this.selectedVisual();
    if (handle && selected) {
      event.preventDefault();
      event.stopPropagation();
      this.startDrag(event, selected, handle.dataset.handle, point);
      return;
    }
    let hit = null;
    for (const track of this.store.visualTracks()) {
      if (track.hidden) continue;
      const clip = clipAtTime(track, this.store.playhead);
      if (!clip || clip.hidden) continue;
      if (this.pointInClip(clip, point)) {
        hit = { track, clip };
        break;
      }
    }
    if (!hit) {
      if (this.store.selectedId) {
        this.store.clearSelection();
        this.store.emit('selection');
        this.onSelect(null);
        this.updateOverlay();
      }
      return;
    }
    const now = performance.now();
    const wasSelected = this.store.selectedId === hit.clip.id;
    this.store.select(hit.clip.id);
    this.store.emit('selection');
    this.onSelect(hit.clip.id);
    this.updateOverlay();
    if (wasSelected && now - this.lastTap.at < 360 && this.lastTap.id === hit.clip.id) {
      this.lastTap = { id: null, at: 0 };
      this.onRequestEdit(hit.clip.id);
      return;
    }
    this.lastTap = { id: hit.clip.id, at: now };

    const base = this.store.isBaseClip(hit.clip);
    if (!base && !hit.clip.locked) {
      this.startDrag(event, hit, 'move', point);
    }
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
      moved: false,
      axis: mode === 'move' ? null : 'active'
    };
    window.addEventListener('pointermove', this._boundPointerMove, { passive: false });
    window.addEventListener('pointerup', this._boundPointerUp, { once: true });
    window.addEventListener('pointercancel', this._boundPointerUp, { once: true });
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const point = this.eventPoint(event);
    const dx = point.x - this.drag.point.x;
    const dy = point.y - this.drag.point.y;
    if (this.drag.mode === 'move' && this.drag.axis === null) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ay > 6 && ay > ax * 1.15) {
        /* A vertical swipe belongs to the page, not to the layer. */
        this.cancelDrag();
        return;
      }
      if (ax < 4) return;
      this.drag.axis = 'x';
    }
    if (Math.abs(dx) + Math.abs(dy) > 1) this.drag.moved = true;
    const found = this.store.trackForClip(this.drag.clipId);
    if (!found) return;
    const clip = found.clip;
    if (this.drag.mode === 'move') {
      let x = this.drag.startX + dx / this.canvas.width;
      let y = this.drag.startY + dy / this.canvas.height;
      if (Math.abs(x - 0.5) < 0.012) x = 0.5;
      if (Math.abs(y - 0.5) < 0.012) y = 0.5;
      this.writeAnimated(clip, 'x', clamp(x, -0.5, 1.5));
      this.writeAnimated(clip, 'y', clamp(y, -0.5, 1.5));
    } else if (this.drag.mode === 'rotate') {
      const angle = (Math.atan2(point.y - this.drag.center.y, point.x - this.drag.center.x) * 180) / Math.PI + 90;
      this.writeAnimated(clip, 'rotation', Math.round(angle * 10) / 10);
    } else {
      const startDistance = Math.hypot(this.drag.point.x - this.drag.center.x, this.drag.point.y - this.drag.center.y);
      const nowDistance = Math.hypot(point.x - this.drag.center.x, point.y - this.drag.center.y);
      const factor = startDistance > 5 ? nowDistance / startDistance : 1;
      this.writeAnimated(clip, 'scale', clamp(this.drag.startScale * factor, 0.04, 8));
    }
    this.store.emit('live-drag');
    this.updateOverlay();
    this.scheduleRender();
    event.preventDefault();
  }

  /* Dragging an animated layer writes the keyframe under the playhead. */
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

  cancelDrag() {
    if (!this.drag) return;
    window.removeEventListener('pointermove', this._boundPointerMove);
    window.removeEventListener('pointerup', this._boundPointerUp);
    window.removeEventListener('pointercancel', this._boundPointerUp);
    this.drag = null;
    this.store.end({ history: false });
    this.updateOverlay();
    this.scheduleRender();
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

  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.frame.requestFullscreen();
      return true;
    } catch (error) {
      this.onStatus('Full screen was blocked by the browser.', 'warn');
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
      selection: this.store.selectedId
    };
  }
}
