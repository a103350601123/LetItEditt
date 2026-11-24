/* LetitEdit Professional Video Editor — multi-track timeline.
 *
 * Renders tracks, clips, ruler and playhead; owns clip dragging, trimming,
 * seeking, snapping, zooming, drop targets and the accessible alternatives
 * exposed through the properties panel.
 */

import { clamp, escapeHtml, formatClock } from './utils.js';
import { transitionLabel } from './effects.js';
import {
  clipEnd,
  findClip,
  findTrack,
  overlaps,
  projectDuration,
  sortTrack
} from './model.js';

const MIN_PPS = 14;
const MAX_PPS = 480;
const DEFAULT_PPS = 90;
const MIN_DURATION = 0.2;

const TICK_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function tickStep(pxPerSecond) {
  return TICK_STEPS.find((step) => step * pxPerSecond >= 62) || 600;
}

function kindIcon(kind) {
  if (kind === 'video') return '🎬';
  if (kind === 'image') return '🖼';
  if (kind === 'text') return 'T';
  if (kind === 'audio') return '♪';
  if (kind === 'shape') return '◆';
  if (kind === 'background') return '▦';
  return '▣';
}

function trackKindLabel(kind) {
  return kind === 'audio' ? 'Audio track' : 'Video track';
}

function neighborBounds(track, clip) {
  const ordered = track.clips.slice().sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((item) => item.id === clip.id);
  const prevEnd = index > 0 ? clipEnd(ordered[index - 1]) : 0;
  const nextStart = index >= 0 && index < ordered.length - 1 ? ordered[index + 1].start : Infinity;
  return { prevEnd, nextStart };
}

function sourceLimit(clip, media) {
  if (clip.freeze) return null;
  if (clip.kind !== 'video' && clip.kind !== 'audio') return null;
  const asset = clip.mediaId ? media.get(clip.mediaId) : null;
  if (!asset || !Number.isFinite(asset.duration) || asset.duration <= 0) return null;
  return asset.duration;
}

/** Apply a trim edge to a clip in place, keeping source in/out points sane. */
export function applyTrim(project, track, clip, edge, desired, media) {
  const bounds = neighborBounds(track, clip);
  const limit = sourceLimit(clip, media);
  const speed = Math.max(0.05, Number(clip.speed) || 1);
  const minDuration = MIN_DURATION;

  if (edge === 'start') {
    const end = clip.start + clip.duration;
    let earliest = Math.max(0, bounds.prevEnd);
    if (limit !== null) {
      if (clip.reverse) {
        const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : limit;
        earliest = Math.max(earliest, clip.start - Math.max(0, limit - outPoint) / speed);
      } else {
        const inPoint = Number(clip.inPoint) || 0;
        earliest = Math.max(earliest, clip.start - inPoint / speed);
      }
    }
    const latest = end - minDuration;
    const start = clamp(desired, earliest, latest);
    const delta = start - clip.start;
    if (Math.abs(delta) < 1e-4) return false;
    const duration = Math.max(minDuration, end - start);
    if (limit !== null) {
      if (clip.reverse) {
        const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : limit;
        clip.outPoint = clamp(outPoint - delta * speed, (Number(clip.inPoint) || 0) + 0.05, limit);
      } else {
        const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : limit;
        clip.inPoint = clamp((Number(clip.inPoint) || 0) + delta * speed, 0, outPoint - 0.05);
      }
    }
    clip.start = start;
    clip.duration = duration;
    return true;
  }

  let latest = bounds.nextStart === Infinity ? Infinity : bounds.nextStart;
  if (limit !== null) {
    if (clip.reverse) {
      latest = Math.min(latest, clip.start + (Number(clip.outPoint) || limit) / speed);
    } else {
      const inPoint = Number(clip.inPoint) || 0;
      latest = Math.min(latest, clip.start + Math.max(0, limit - inPoint) / speed);
    }
  }
  const end = clamp(desired, clip.start + minDuration, latest);
  const duration = end - clip.start;
  if (Math.abs(duration - clip.duration) < 1e-4) return false;
  if (limit !== null) {
    if (clip.reverse) {
      clip.inPoint = clamp((Number(clip.outPoint) || limit) - duration * speed, 0, (Number(clip.outPoint) || limit) - 0.05);
    } else {
      const inPoint = Number(clip.inPoint) || 0;
      clip.outPoint = clamp(inPoint + duration * speed, inPoint + 0.05, limit);
    }
  }
  clip.duration = duration;
  return true;
}

export class TimelineView {
  constructor(options) {
    this.root = options.root;
    this.store = options.store;
    this.media = options.media;
    this.getTime = options.getTime || (() => 0);
    this.getSelection = options.getSelection || (() => new Set());
    this.onSeek = options.onSeek || (() => {});
    this.onSelectClip = options.onSelectClip || (() => {});
    this.onDropMedia = options.onDropMedia || (() => {});
    this.onCommand = options.onCommand || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onNeedRender = options.onNeedRender || (() => {});

    this.pxPerSecond = DEFAULT_PPS;
    this.snapping = true;
    this.editingTrackId = null;
    this.drag = null;
    this.scrub = null;
    this.pinch = null;
    this.pointers = new Map();
    this.mounted = false;
    this.rafPending = false;
    this.lastScrollLeft = 0;
    this.scrollToTimeAfterRender = null;
  }

  /* --------------------------------------------------------------------- */
  /* Mount and layout                                                      */
  /* --------------------------------------------------------------------- */

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.root.innerHTML = `
      <div class="ve-tl-toolbar" role="toolbar" aria-label="Timeline controls">
        <div class="ve-tl-tools">
          <button type="button" class="ve-tl-btn" data-timeline-action="add-video" title="Add a video overlay track">+ Video</button>
          <button type="button" class="ve-tl-btn" data-timeline-action="add-audio" title="Add an audio track">+ Audio</button>
          <button type="button" class="ve-tl-btn" data-timeline-action="split" title="Split selected clip at the playhead (S)">Split</button>
          <button type="button" class="ve-tl-btn" data-timeline-action="delete" title="Delete selected clips (Delete)">Delete</button>
        </div>
        <div class="ve-tl-zoom">
          <button type="button" class="ve-tl-icon" data-timeline-action="zoom-out" aria-label="Zoom timeline out">−</button>
          <input type="range" min="${MIN_PPS}" max="${MAX_PPS}" step="1" value="${this.pxPerSecond}" data-zoom-range aria-label="Timeline zoom">
          <button type="button" class="ve-tl-icon" data-timeline-action="zoom-in" aria-label="Zoom timeline in">+</button>
          <button type="button" class="ve-tl-btn" data-timeline-action="fit" title="Fit project in view">Fit</button>
        </div>
        <label class="ve-tl-snap"><input type="checkbox" data-snap checked> Snap</label>
        <output class="ve-tl-clock" data-clock aria-live="off">00:00.0 / 00:00.0</output>
      </div>
      <div class="ve-tl-scroll" data-scroll>
        <div class="ve-tl-inner" data-inner>
          <div class="ve-tl-ruler-row">
            <div class="ve-tl-corner"><span>Timeline</span></div>
            <div class="ve-tl-ruler" data-ruler></div>
          </div>
          <div class="ve-tl-rows" data-rows></div>
          <div class="ve-playhead" data-playhead aria-hidden="true"><span class="ve-playhead-grip"></span></div>
          <div class="ve-tl-insert" data-insert aria-hidden="true"></div>
        </div>
      </div>
      <p class="ve-tl-hint" data-hint></p>
    `;

    this.toolbar = this.root.querySelector('.ve-tl-toolbar');
    this.scroll = this.root.querySelector('[data-scroll]');
    this.inner = this.root.querySelector('[data-inner]');
    this.ruler = this.root.querySelector('[data-ruler]');
    this.rowsHost = this.root.querySelector('[data-rows]');
    this.playhead = this.root.querySelector('[data-playhead]');
    this.insertLine = this.root.querySelector('[data-insert]');
    this.clock = this.root.querySelector('[data-clock]');
    this.hint = this.root.querySelector('[data-hint]');
    this.zoomRange = this.root.querySelector('[data-zoom-range]');
    this.snapInput = this.root.querySelector('[data-snap]');

    this.bind();
    this.render();

    this.resizeObserver = new ResizeObserver(() => {
      this.render();
    });
    this.resizeObserver.observe(this.scroll);
  }

  headWidth() {
    const value = getComputedStyle(this.root).getPropertyValue('--ve-head-w');
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 172;
  }

  laneWidth() {
    const project = this.store.project;
    const duration = Math.max(projectDuration(project), this.getTime()) + 5;
    const seconds = Math.max(12, Math.ceil(duration));
    return Math.round(seconds * this.pxPerSecond);
  }

  bind() {
    this.root.addEventListener('click', (event) => this.handleClick(event));
    this.root.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.root.addEventListener('keydown', (event) => this.handleKeyDown(event));
    this.root.addEventListener('dblclick', (event) => this.handleDoubleClick(event));

    this.zoomRange?.addEventListener('input', () => {
      this.setZoom(Number(this.zoomRange.value));
    });
    this.zoomRange?.addEventListener('change', () => {
      this.setZoom(Number(this.zoomRange.value));
    });
    this.snapInput?.addEventListener('change', () => {
      this.snapping = this.snapInput.checked;
      this.onCommand?.('toggle-snap', { enabled: this.snapping });
    });

    this.scroll.addEventListener('wheel', (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.18 : 0.85;
        this.zoomBy(factor, this.timeAtClientX(event.clientX));
      } else if (event.shiftKey) {
        event.preventDefault();
        this.scroll.scrollLeft += event.deltaY;
      }
    }, { passive: false });

    this.root.addEventListener('dragover', (event) => this.handleDragOver(event));
    this.root.addEventListener('dragleave', (event) => {
      if (!this.root.contains(event.relatedTarget)) this.hideInsert();
    });
    this.root.addEventListener('drop', (event) => this.handleDrop(event));
    this.scroll.addEventListener('scroll', () => {
      if (this.drag && this.drag.mode === 'move') this.positionInsertForDrag(this.drag);
    });

    window.addEventListener('pointerdown', (event) => this.trackPointer(event), true);
    window.addEventListener('pointermove', (event) => this.movePointer(event), true);
    window.addEventListener('pointerup', (event) => this.releasePointer(event), true);
    window.addEventListener('pointercancel', (event) => this.releasePointer(event), true);
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }

  /* --------------------------------------------------------------------- */
  /* Rendering                                                             */
  /* --------------------------------------------------------------------- */

  render() {
    if (!this.mounted) return;
    const scrollLeft = this.scroll ? this.scroll.scrollLeft : 0;
    const scrollTop = this.scroll ? this.scroll.scrollTop : 0;
    /* Re-rendering replaces every row, so remember the focused control and
     * restore it afterwards. Without this, moving a clip with the arrow keys
     * would drop focus and block the next key press. */
    const active = document.activeElement;
    const focus = active && this.root.contains(active)
      ? {
          clipId: active.closest('[data-clip-id]')?.getAttribute('data-clip-id') || null,
          trim: active.getAttribute('data-trim') || null,
          trackId: active.closest('[data-track-row]')?.getAttribute('data-track-id') || null,
          trackAction: active.getAttribute('data-track-action') || null,
          timelineAction: active.getAttribute('data-timeline-action') || null,
          zoom: active.hasAttribute('data-zoom-range')
        }
      : null;
    this.renderRows();
    this.updateToolbar();
    this.setTime(this.getTime());
    if (focus) this.restoreFocus(focus);
    if (this.scroll) {
      this.scroll.scrollLeft = scrollLeft;
      this.scroll.scrollTop = scrollTop;
    }
    if (this.scrollToTimeAfterRender !== null) {
      const target = this.scrollToTimeAfterRender;
      this.scrollToTimeAfterRender = null;
      this.scrollToTime(target);
    }
  }

  restoreFocus(focus) {
    let element = null;
    if (focus.clipId) {
      const clipElement = this.rowsHost.querySelector(`[data-clip-id="${focus.clipId}"]`);
      if (clipElement) {
        element = focus.trim
          ? clipElement.querySelector(`[data-trim="${focus.trim}"]`)
          : clipElement;
      }
    } else if (focus.trackId) {
      const row = this.rowsHost.querySelector(`[data-track-row][data-track-id="${focus.trackId}"]`);
      if (row) {
        if (focus.trackAction) element = row.querySelector(`[data-track-action="${focus.trackAction}"]`);
        else if (focus.timelineAction) element = this.root.querySelector(`[data-timeline-action="${focus.timelineAction}"]`);
      }
    }
    if (!element && focus.timelineAction) {
      element = this.root.querySelector(`[data-timeline-action="${focus.timelineAction}"]`);
    }
    if (!element && focus.zoom) element = this.zoomRange;
    if (element && typeof element.focus === 'function') element.focus({ preventScroll: true });
  }

  renderRows() {
    const project = this.store.project;
    const width = this.laneWidth();
    const head = this.headWidth();
    const step = tickStep(this.pxPerSecond);
    const totalSeconds = width / this.pxPerSecond;

    this.inner.style.width = `${head + width}px`;
    this.inner.style.setProperty('--lane-w', `${width}px`);
    this.inner.style.setProperty('--grid-step', `${step * this.pxPerSecond}px`);

    /* Ruler ------------------------------------------------------------- */
    const ticks = [];
    for (let time = 0; time <= totalSeconds + 0.001; time += step) {
      const x = Math.round(time * this.pxPerSecond);
      const major = Math.abs(time / (step * 5) - Math.round(time / (step * 5))) < 1e-6;
      ticks.push(`<span class="ve-tick${major ? ' is-major' : ''}" style="left:${x}px"><i>${formatClock(time)}</i></span>`);
    }
    this.ruler.style.width = `${width}px`;
    this.ruler.innerHTML = ticks.join('') +
      `<span class="ve-ruler-end" style="left:${width}px"></span>`;

    /* Tracks ------------------------------------------------------------ */
    const selection = this.getSelection();
    const rows = project.tracks.map((track, index) => {
      const rowHeight = track.collapsed ? 26 : 62;
      const clipHeight = track.collapsed ? 16 : rowHeight - 14;
      const clips = track.clips.map((clip) =>
        this.clipMarkup(clip, track, clipHeight, selection.has(clip.id))
      ).join('');
      const video = track.kind === 'video';
      const volume = video ? '' : `
        <label class="ve-tl-vol" title="Track volume">
          <span class="visually-hidden">Volume for ${escapeHtml(track.name)}</span>
          <input type="range" min="0" max="1.5" step="0.05" value="${Number(track.volume) || 0}" data-track-volume>
        </label>`;
      return `
        <div class="ve-tl-row${track.collapsed ? ' is-collapsed' : ''}${track.hidden ? ' is-hidden' : ''}${track.locked ? ' is-locked' : ''}" data-track-row data-track-id="${track.id}" data-kind="${track.kind}">
          <div class="ve-tl-head">
            <div class="ve-tl-head-top">
              <button type="button" class="ve-tl-name" data-track-action="rename" title="Rename track">${escapeHtml(track.name)}</button>
              <span class="ve-tl-kind" aria-hidden="true">${video ? 'VID' : 'AUD'}</span>
            </div>
            <div class="ve-tl-head-buttons">
              <button type="button" data-track-action="up" title="Move track up (higher visual layer)" aria-label="Move ${escapeHtml(track.name)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" data-track-action="down" title="Move track down (lower visual layer)" aria-label="Move ${escapeHtml(track.name)} down" ${index === project.tracks.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" data-track-action="collapse" aria-label="${track.collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(track.name)}" aria-expanded="${!track.collapsed}" title="${track.collapsed ? 'Expand' : 'Collapse'} track">${track.collapsed ? '▸' : '▾'}</button>
              <button type="button" data-track-action="hide" aria-pressed="${track.hidden}" title="${track.hidden ? 'Show' : 'Hide'} track" aria-label="${track.hidden ? 'Show' : 'Hide'} ${escapeHtml(track.name)}">${track.hidden ? '🚫' : '👁'}</button>
              <button type="button" data-track-action="lock" aria-pressed="${track.locked}" title="${track.locked ? 'Unlock' : 'Lock'} track" aria-label="${track.locked ? 'Unlock' : 'Lock'} ${escapeHtml(track.name)}">${track.locked ? '🔒' : '🔓'}</button>
              <button type="button" data-track-action="mute" aria-pressed="${track.muted}" title="${track.muted ? 'Unmute' : 'Mute'} track audio" aria-label="${track.muted ? 'Unmute' : 'Mute'} ${escapeHtml(track.name)}">${track.muted ? '🔇' : '🔊'}</button>
              <button type="button" data-track-action="delete" title="Delete track" aria-label="Delete ${escapeHtml(track.name)}">✕</button>
            </div>
            ${volume}
          </div>
          <div class="ve-tl-lane" data-lane="true" data-track-id="${track.id}" style="height:${rowHeight}px;width:${width}px">
            ${clips}
          </div>
        </div>
      `;
    }).join('');

    const empty = project.tracks.every((track) => !track.clips.length)
      ? `<p class="ve-tl-empty">Import media, then drag it here — or tap an asset to add it at the playhead.</p>`
      : '';
    this.rowsHost.innerHTML = rows + empty;

    this.drawWaveforms();
    this.setTime(this.getTime());
    this.updateHint();
  }

  clipMarkup(clip, track, height, selected) {
    const left = Math.max(0, clip.start) * this.pxPerSecond;
    const width = Math.max(14, clip.duration * this.pxPerSecond);
    const thumb = clip.mediaId ? this.media.get(clip.mediaId)?.thumbnail : '';
    const transition = clip.transition && clip.transition.type !== 'none'
      ? `<button type="button" class="ve-clip-transition" data-transition-chip="${clip.id}" title="${escapeHtml(transitionLabel(clip.transition.type))} · ${Number(clip.transition.duration).toFixed(2)} s. Click to edit." style="width:${Math.max(16, Number(clip.transition.duration) * this.pxPerSecond)}px">⇄</button>`
      : '';
    const keys = new Set();
    if (clip.keyframes) {
      for (const list of Object.values(clip.keyframes)) {
        for (const key of list || []) keys.add(Number(key.t));
      }
    }
    const keyMarkers = [...keys]
      .filter((time) => Number.isFinite(time) && time >= 0 && time <= clip.duration)
      .map((time) => `<span class="ve-key-marker" style="left:${Math.min(width - 6, Math.max(2, time * this.pxPerSecond))}px"></span>`)
      .join('');
    const wave = clip.kind === 'audio' || (clip.mediaId && this.media.get(clip.mediaId)?.peaks)
      ? `<canvas class="ve-clip-wave" data-wave="${clip.mediaId || ''}" height="40"></canvas>`
      : '';
    const flags = [
      clip.locked ? '🔒' : '',
      clip.hidden ? '🚫' : '',
      clip.freeze ? '❄' : '',
      clip.reverse ? '⟲' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="ve-clip ve-kind-${clip.kind}${selected ? ' is-selected' : ''}${clip.locked ? ' is-locked' : ''}${clip.hidden ? ' is-hidden' : ''}${clip.freeze ? ' is-frozen' : ''}"
        data-clip-id="${clip.id}" style="left:${left}px;width:${width}px;height:${Math.max(14, height)}px"
        tabindex="0" role="option" aria-selected="${selected}"
        aria-label="${escapeHtml(clip.name || clip.kind)} on ${escapeHtml(track.name)}, starts ${formatClock(clip.start)}, length ${formatClock(clip.duration)}">
        ${thumb ? `<span class="ve-clip-thumb" style="background-image:url('${thumb}')" aria-hidden="true"></span>` : ''}
        ${wave}
        <span class="ve-clip-body">
          <span class="ve-clip-name">${kindIcon(clip.kind)} ${escapeHtml(flags ? `${flags} ${clip.name || clip.kind}` : (clip.name || clip.kind))}</span>
          <span class="ve-clip-time" data-clip-time>${formatClock(clip.duration)}</span>
        </span>
        ${transition}
        ${keyMarkers}
        <span class="ve-trim ve-trim-start" data-trim="start" role="separator" aria-label="Trim start of ${escapeHtml(clip.name || clip.kind)}" tabindex="0"></span>
        <span class="ve-trim ve-trim-end" data-trim="end" role="separator" aria-label="Trim end of ${escapeHtml(clip.name || clip.kind)}" tabindex="0"></span>
      </div>
    `;
  }

  drawWaveforms() {
    const canvases = this.rowsHost.querySelectorAll('canvas[data-wave]');
    for (const canvas of canvases) {
      const mediaId = canvas.getAttribute('data-wave');
      const clipElement = canvas.closest('[data-clip-id]');
      if (!clipElement) continue;
      const located = findClip(this.store.project, clipElement.getAttribute('data-clip-id'));
      if (!located) continue;
      const width = Math.max(20, Math.round(located.clip.duration * this.pxPerSecond));
      canvas.width = Math.min(4000, width);
      canvas.height = Math.max(12, canvas.height || 40);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const peaks = mediaId ? this.media.getPeaks(mediaId) : null;
      if (!peaks) continue;
      const color = located.clip.kind === 'audio' ? 'rgba(125, 211, 252, .85)' : 'rgba(196, 181, 253, .7)';
      ctx.fillStyle = color;
      const middle = canvas.height / 2;
      const step = peaks.length / canvas.width;
      for (let x = 0; x < canvas.width; x += 1) {
        const index = Math.min(peaks.length - 1, Math.floor(x * step));
        const amplitude = peaks[index] * (middle - 2);
        ctx.fillRect(x, middle - amplitude, 1, Math.max(1, amplitude * 2));
      }
    }
  }

  updateToolbar() {
    if (!this.clock) return;
    this.clock.textContent = `${formatClock(this.getTime())} / ${formatClock(projectDuration(this.store.project))}`;
    const hasSelection = this.getSelection().size > 0;
    for (const action of ['split', 'delete']) {
      const button = this.toolbar.querySelector(`[data-timeline-action="${action}"]`);
      if (button) button.disabled = !hasSelection;
    }
    if (this.zoomRange) this.zoomRange.value = String(Math.round(this.pxPerSecond));
    if (this.snapInput) this.snapInput.checked = this.snapping;
  }

  updateHint() {
    if (!this.hint) return;
    const project = this.store.project;
    const visual = project.tracks.filter((track) => track.kind === 'video').length;
    const audio = project.tracks.filter((track) => track.kind === 'audio').length;
    this.hint.textContent = `${visual} video track${visual === 1 ? '' : 's'} · ${audio} audio track${audio === 1 ? '' : 's'}. Drag clips sideways to change timing, up or down to change their visual layer.`;
  }

  updateSelection() {
    const selection = this.getSelection();
    for (const element of this.root.querySelectorAll('[data-clip-id]')) {
      const selected = selection.has(element.getAttribute('data-clip-id'));
      element.classList.toggle('is-selected', selected);
      element.setAttribute('aria-selected', String(selected));
    }
    this.updateToolbar();
  }

  /* --------------------------------------------------------------------- */
  /* Playhead                                                              */
  /* --------------------------------------------------------------------- */

  setTime(time) {
    const head = this.headWidth();
    const x = head + Math.max(0, time) * this.pxPerSecond;
    if (this.playhead) {
      this.playhead.style.left = `${x}px`;
      this.playhead.dataset.label = formatClock(time);
      this.playhead.setAttribute('data-label', formatClock(time));
      const height = Math.max(this.rowsHost?.scrollHeight || 0, 120);
      this.playhead.style.height = `${height + 28}px`;
    }
    if (this.clock) {
      this.clock.textContent = `${formatClock(time)} / ${formatClock(projectDuration(this.store.project))}`;
    }
  }

  timeAtClientX(clientX) {
    const rect = this.ruler.getBoundingClientRect();
    return clamp((clientX - rect.left) / this.pxPerSecond, 0, this.laneWidth() / this.pxPerSecond);
  }

  scrollToTime(time) {
    if (!this.scroll) return;
    const head = this.headWidth();
    const x = time * this.pxPerSecond;
    const visible = this.scroll.clientWidth - head;
    if (x < this.scroll.scrollLeft + 20 || x > this.scroll.scrollLeft + visible - 20) {
      this.scroll.scrollLeft = Math.max(0, x - visible / 2);
    }
  }

  /* --------------------------------------------------------------------- */
  /* Zoom                                                                  */
  /* --------------------------------------------------------------------- */

  zoomBy(factor, anchorTime = this.getTime()) {
    const anchor = anchorTime * this.pxPerSecond;
    const scroll = this.scroll;
    const pointerOffset = scroll ? Math.max(0, this.scrollOffsetOfTime(anchorTime)) : 0;
    const next = clamp(this.pxPerSecond * factor, MIN_PPS, MAX_PPS);
    if (Math.abs(next - this.pxPerSecond) < 0.01) return;
    this.pxPerSecond = next;
    this.render();
    if (scroll) {
      const head = this.headWidth();
      const timeX = next * anchorTime;
      const visible = scroll.clientWidth - head;
      if (visible > 0) {
        scroll.scrollLeft = Math.max(0, timeX - pointerOffset);
      }
    }
  }

  /** Set an absolute zoom from the toolbar slider. */
  setZoom(value, anchorTime = this.getTime()) {
    const next = clamp(Number(value) || DEFAULT_PPS, MIN_PPS, MAX_PPS);
    if (Math.abs(next - this.pxPerSecond) < 0.01) return;
    const scroll = this.scroll;
    const pointerOffset = scroll ? this.scrollOffsetOfTime(anchorTime) : 0;
    this.pxPerSecond = next;
    this.render();
    if (scroll) {
      const head = this.headWidth();
      const visible = scroll.clientWidth - head;
      if (visible > 0) scroll.scrollLeft = Math.max(0, next * anchorTime - pointerOffset);
    }
  }

  scrollOffsetOfTime(time) {
    if (!this.scroll) return 0;
    const rect = this.scroll.getBoundingClientRect();
    return Math.max(0, time * this.pxPerSecond);
  }

  fit() {
    const project = this.store.project;
    const duration = Math.max(1, projectDuration(project));
    const head = this.headWidth();
    const available = Math.max(200, (this.scroll?.clientWidth || 900) - head - 24);
    this.pxPerSecond = clamp(available / duration, MIN_PPS, MAX_PPS);
    this.scrollToTimeAfterRender = 0;
    this.render();
  }

  /* --------------------------------------------------------------------- */
  /* Snapping                                                              */
  /* --------------------------------------------------------------------- */

  snapCandidates(excludeIds = new Set()) {
    const candidates = [0, this.getTime()];
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) {
        if (excludeIds.has(clip.id)) continue;
        candidates.push(clip.start, clipEnd(clip));
      }
    }
    return candidates;
  }

  snapTime(time, excludeIds = new Set()) {
    if (!this.snapping) return time;
    const threshold = 8 / this.pxPerSecond;
    let best = time;
    let bestDistance = threshold;
    for (const candidate of this.snapCandidates(excludeIds)) {
      const distance = Math.abs(candidate - time);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  /* --------------------------------------------------------------------- */
  /* Pointer handling                                                      */
  /* --------------------------------------------------------------------- */

  trackPointer(event) {
    if (event.pointerType !== 'touch') return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.cancelDrag();
      this.endScrub();
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        pps: this.pxPerSecond,
        midpoint: (a.x + b.x) / 2
      };
    }
  }

  movePointer(event) {
    if (!this.pinch) return;
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size < 2) return;
    const [a, b] = [...this.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (!this.pinch.distance) return;
    const anchorTime = this.timeAtClientX((a.x + b.x) / 2);
    this.pxPerSecond = clamp(this.pinch.pps * (distance / this.pinch.distance), MIN_PPS, MAX_PPS);
    this.render();
    const midpointTime = Math.max(0, anchorTime * this.pxPerSecond);
    this.scroll.scrollLeft = Math.max(0, midpointTime - (this.scroll.clientWidth - this.headWidth()) / 2);
  }

  releasePointer(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  }

  handlePointerDown(event) {
    const target = event.target;
    if (target.closest('button, input, select, textarea, .ve-tl-toolbar')) return;
    if (target.closest('[data-transition-chip]')) return;
    if (event.button !== undefined && event.button !== 0) return;

    const trim = target.closest('[data-trim]');
    const clipElement = target.closest('[data-clip-id]');
    const row = target.closest('[data-track-row]');
    const lane = target.closest('[data-lane]');
    const ruler = target.closest('[data-ruler]');

    if (trim && clipElement) {
      this.startTrim(event, trim, clipElement);
      return;
    }
    if (clipElement) {
      this.startClipDrag(event, clipElement, row);
      return;
    }
    if (ruler) {
      this.startScrub(event, true);
      return;
    }
    if (lane) {
      this.startScrub(event, true);
    }
  }

  startScrub(event, seek) {
    if (event.pointerType === 'touch' && this.pointers.size > 1) return;
    event.preventDefault();
    this.scrub = { seek, pointerId: event.pointerId };
    this.onSeek(this.timeAtClientX(event.clientX), { scrubbing: true });
    this.scrubMove = (moveEvent) => {
      if (!this.scrub || moveEvent.pointerId !== this.scrub.pointerId) return;
      this.onSeek(this.timeAtClientX(moveEvent.clientX), { scrubbing: true });
    };
    this.scrubEnd = () => {
      this.endScrub();
      this.onSeek(this.getTime(), { scrubbing: false });
    };
    window.addEventListener('pointermove', this.scrubMove);
    window.addEventListener('pointerup', this.scrubEnd, { once: true });
    window.addEventListener('pointercancel', this.scrubEnd, { once: true });
  }

  endScrub() {
    if (this.scrubMove) window.removeEventListener('pointermove', this.scrubMove);
    if (this.scrubEnd) {
      window.removeEventListener('pointerup', this.scrubEnd);
      window.removeEventListener('pointercancel', this.scrubEnd);
    }
    this.scrubMove = null;
    this.scrubEnd = null;
    this.scrub = null;
  }

  startClipDrag(event, clipElement, row) {
    const project = this.store.project;
    const clipId = clipElement.getAttribute('data-clip-id');
    const located = findClip(project, clipId);
    if (!located) return;
    if (located.clip.locked || located.track.locked) {
      this.onStatus('This clip or its track is locked. Unlock it to edit.', 'warn');
      return;
    }
    if (event.pointerType === 'touch' && this.pointers.size > 1) return;
    event.preventDefault();
    this.onSelectClip(clipId, {
      additive: event.shiftKey || event.ctrlKey || event.metaKey
    });
    this.beginDrag(event, {
      mode: 'move',
      clipId,
      sourceTrackId: located.track.id,
      targetTrackId: located.track.id,
      startX: event.clientX,
      startY: event.clientY,
      originStart: located.clip.start,
      snapStart: located.clip.start,
      moved: false,
      element: clipElement,
      originRow: row,
      lastTargetRow: row
    });
  }

  startTrim(event, handle, clipElement) {
    const project = this.store.project;
    const clipId = clipElement.getAttribute('data-clip-id');
    const located = findClip(project, clipId);
    if (!located) return;
    if (located.clip.locked || located.track.locked) {
      this.onStatus('This clip or its track is locked. Unlock it to edit.', 'warn');
      return;
    }
    if (event.pointerType === 'touch' && this.pointers.size > 1) return;
    event.preventDefault();
    this.onSelectClip(clipId, { additive: false });
    this.beginDrag(event, {
      mode: 'trim',
      edge: handle.getAttribute('data-trim'),
      clipId,
      sourceTrackId: located.track.id,
      startX: event.clientX,
      originStart: located.clip.start,
      originDuration: located.clip.duration,
      element: clipElement,
      moved: false
    });
  }

  beginDrag(event, info) {
    this.drag = info;
    this.drag.pointerId = event.pointerId;
    this.dragElement = info.element;
    info.element.classList.add('is-dragging');
    if (info.mode === 'move') {
      this.dragElement.style.pointerEvents = 'none';
      info.element.classList.add('is-selected');
    }
    this.store.begin?.();
    if (info.mode === 'trim') this.showInsert(info.element, 0, info.sourceTrackId);
    this.onNeedRender?.();

    this.onDragMove = (moveEvent) => this.handleDragMove(moveEvent);
    this.onDragUp = (upEvent) => this.handleDragUp(upEvent);
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragUp);
    window.addEventListener('pointercancel', this.onDragUp);
  }

  detachDragListeners() {
    if (this.onDragMove) window.removeEventListener('pointermove', this.onDragMove);
    if (this.onDragUp) {
      window.removeEventListener('pointerup', this.onDragUp);
      window.removeEventListener('pointercancel', this.onDragUp);
    }
    this.onDragMove = null;
    this.onDragUp = null;
  }

  cancelDrag() {
    if (!this.drag) return;
    const { element } = this.drag;
    element.classList.remove('is-dragging', 'is-invalid');
    element.style.transform = '';
    element.style.pointerEvents = '';
    this.drag = null;
    this.detachDragListeners();
    this.hideInsert();
    this.store.end?.();
    this.render();
  }

  handleDragMove(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();

    if (drag.mode === 'trim') {
      const desiredEdge = drag.edge === 'start'
        ? drag.originStart + dx / this.pxPerSecond
        : drag.originStart + drag.originDuration + dx / this.pxPerSecond;
      const snapped = this.snapTime(desiredEdge, new Set([drag.clipId]));
      this.store.live((project) => {
        const located = findClip(project, drag.clipId);
        if (!located) return;
        applyTrim(project, located.track, located.clip, drag.edge, snapped, this.media);
        sortTrack(located.track);
        this.updateClipGeometry(drag.element, located.clip);
      });
      return;
    }

    /* Move -------------------------------------------------------------- */
    let desiredStart = Math.max(0, drag.originStart + dx / this.pxPerSecond);
    const snapSet = new Set(this.getSelection());
    snapSet.add(drag.clipId);
    desiredStart = this.snapTime(desiredStart, snapSet);
    drag.snapStart = desiredStart;
    const visualDx = (desiredStart - drag.originStart) * this.pxPerSecond;
    drag.element.style.transform = `translateX(${visualDx}px)`;

    const over = document.elementFromPoint(event.clientX, event.clientY);
    const row = over?.closest?.('[data-track-row]');
    if (row) {
      const targetTrack = findTrack(this.store.project, row.getAttribute('data-track-id'));
      const located = findClip(this.store.project, drag.clipId);
      if (targetTrack && located) {
        const compatible = targetTrack.kind === (located.clip.kind === 'audio' ? 'audio' : 'video');
        const allowed = compatible && !targetTrack.locked;
        drag.targetTrackId = allowed ? targetTrack.id : drag.sourceTrackId;
        drag.lastTargetRow = row;
        drag.element.classList.toggle('is-invalid', !allowed && targetTrack.id !== drag.sourceTrackId);
        this.showInsert(drag.element, desiredStart, drag.targetTrackId);
        return;
      }
    }
    this.showInsert(drag.element, desiredStart, drag.targetTrackId || drag.sourceTrackId);
  }

  handleDragUp(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasTrim = drag.mode === 'trim';
    const moved = drag.moved;
    const clipId = drag.clipId;
    const element = drag.element;
    element.classList.remove('is-dragging', 'is-invalid');
    element.style.transform = '';
    element.style.pointerEvents = '';
    this.hideInsert();
    this.drag = null;
    this.detachDragListeners();

    if (!moved) {
      if (wasTrim) this.store.end?.({ history: false });
      this.onNeedRender?.();
      return;
    }

    if (wasTrim) {
      this.store.end?.();
    } else {
      this.commitMove(drag);
      this.store.end?.();
    }
    this.render();
    this.onNeedRender?.();
  }

  commitMove(drag) {
    const project = this.store.project;
    const located = findClip(project, drag.clipId);
    if (!located) return;
    const snappedStart = Math.max(0, drag.snapStart);
    const targetTrack = drag.targetTrackId !== drag.sourceTrackId
      ? findTrack(this.store.project, drag.targetTrackId)
      : null;
    if (drag.targetTrackId !== drag.sourceTrackId && !targetTrack) return;
    if (targetTrack && (targetTrack.locked || targetTrack.kind !== (located.clip.kind === 'audio' ? 'audio' : 'video'))) {
      return;
    }
    if (targetTrack) {
      const allowed = !overlaps(targetTrack, located.clip, snappedStart, located.clip.duration, located.clip.id);
      if (!allowed) {
        this.onStatus('There is no free space on that track at the drop position.', 'warn');
        return;
      }
    } else {
      const allowed = !overlaps(located.track, located.clip, snappedStart, located.clip.duration, located.clip.id);
      if (!allowed) {
        this.onStatus('That position overlaps another clip on this track.', 'warn');
        return;
      }
    }
    this.store.live((draft) => {
      const current = findClip(draft, drag.clipId);
      if (!current) return;
      if (targetTrack) {
        current.track.clips = current.track.clips.filter((clip) => clip.id !== drag.clipId);
        current.clip.start = snappedStart;
        const destination = draft.tracks.find((track) => track.id === targetTrack.id);
        destination.clips.push(current.clip);
        sortTrack(destination);
      } else {
        current.clip.start = snappedStart;
        sortTrack(current.track);
      }
    });
    this.onNeedRender?.();
  }

  /* --------------------------------------------------------------------- */
  /* Insert indicator                                                      */
  /* --------------------------------------------------------------------- */

  showInsert(element, time, trackId) {
    const row = this.root.querySelector(`[data-track-id="${trackId}"]`);
    if (!row || !this.insertLine) return;
    const lane = row.querySelector('[data-lane]');
    if (!lane) return;
    const head = this.headWidth();
    const top = row.offsetTop + 4;
    const x = head + time * this.pxPerSecond;
    this.insertLine.style.left = `${Math.max(head, x)}px`;
    this.insertLine.style.top = `${top}px`;
    this.insertLine.style.height = `${Math.max(16, lane.offsetHeight - 8)}px`;
    this.insertLine.classList.add('is-visible');
    this.insertLine.dataset.track = trackId;
  }

  positionInsertForDrag(drag) {
    if (drag.mode !== 'move') return;
    this.showInsert(drag.element, drag.snapStart, drag.targetTrackId || drag.sourceTrackId);
  }

  hideInsert() {
    this.insertLine?.classList.remove('is-visible');
  }

  updateClipGeometry(element, clip) {
    if (!element) return;
    element.style.left = `${Math.max(0, clip.start) * this.pxPerSecond}px`;
    element.style.width = `${Math.max(14, clip.duration * this.pxPerSecond)}px`;
    const label = element.querySelector('[data-clip-time]');
    if (label) label.textContent = formatClock(clip.duration);
    const aria = element.getAttribute('aria-label') || '';
    element.setAttribute('aria-label', aria.replace(/length [0-9:.]+/, `length ${formatClock(clip.duration)}`));
  }

  /* --------------------------------------------------------------------- */
  /* Click and keyboard                                                    */
  /* --------------------------------------------------------------------- */

  handleClick(event) {
    const trackAction = event.target.closest('[data-track-action]');
    if (trackAction) {
      event.preventDefault();
      this.trackCommand(trackAction);
      return;
    }
    const action = event.target.closest('[data-timeline-action]');
    if (action) {
      event.preventDefault();
      this.timelineCommand(action.getAttribute('data-timeline-action'));
      return;
    }
    const chip = event.target.closest('[data-transition-chip]');
    if (chip) {
      const clipId = chip.getAttribute('data-transition-chip');
      this.onSelectClip(clipId, { additive: false });
      this.onCommand('edit-transition', { clipId });
    }
  }

  timelineCommand(action) {
    if (action === 'add-video') {
      this.onCommand('add-track', { kind: 'video' });
    } else if (action === 'add-audio') {
      this.onCommand('add-track', { kind: 'audio' });
    } else if (action === 'zoom-in') {
      this.zoomBy(1.3);
    } else if (action === 'zoom-out') {
      this.zoomBy(0.77);
    } else if (action === 'fit') {
      this.fit();
    } else if (action === 'split' || action === 'delete') {
      this.onCommand(action);
    }
  }

  trackCommand(button) {
    const row = button.closest('[data-track-row]');
    if (!row) return;
    const trackId = row.getAttribute('data-track-id');
    const action = button.getAttribute('data-track-action');
    const track = findTrack(this.store.project, trackId);
    if (!track) return;

    if (action === 'rename') {
      this.startRename(row, track);
      return;
    }
    if (action === 'delete') {
      if (this.store.project.tracks.length <= 1) {
        this.onStatus('A project needs at least one track.', 'warn');
        return;
      }
      if (track.clips.length && !window.confirm(`Delete “${track.name}” and its ${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}?`)) return;
      this.store.apply((project) => {
        project.tracks = project.tracks.filter((item) => item.id !== trackId);
      });
      this.onStatus(`Deleted ${track.name}.`, 'info');
      return;
    }
    if (action === 'up' || action === 'down') {
      const index = this.store.project.tracks.findIndex((item) => item.id === trackId);
      const target = action === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= this.store.project.tracks.length) return;
      this.store.apply((project) => {
        const [moved] = project.tracks.splice(index, 1);
        project.tracks.splice(target, 0, moved);
      });
      return;
    }
    if (action === 'collapse' || action === 'hide' || action === 'lock' || action === 'mute') {
      this.store.apply((project) => {
        const current = findTrack(project, trackId);
        if (!current) return;
        if (action === 'collapse') current.collapsed = !current.collapsed;
        if (action === 'hide') current.hidden = !current.hidden;
        if (action === 'lock') current.locked = !current.locked;
        if (action === 'mute') current.muted = !current.muted;
      });
      return;
    }
  }

  startRename(row, track) {
    const nameButton = row.querySelector('.ve-tl-name');
    if (!nameButton) return;
    this.editingTrackId = track.id;
    const input = document.createElement('input');
    input.className = 've-tl-rename';
    input.value = track.name;
    input.setAttribute('aria-label', 'Track name');
    nameButton.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit) => {
      if (this.editingTrackId !== track.id) return;
      this.editingTrackId = null;
      if (commit && input.value.trim()) {
        this.store.apply((project) => {
          const current = findTrack(project, track.id);
          if (current) current.name = input.value.trim().slice(0, 60);
        });
      } else {
        this.render();
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  handleDoubleClick(event) {
    const name = event.target.closest('.ve-tl-name');
    if (name) {
      const row = name.closest('[data-track-row]');
      const track = row ? findTrack(this.store.project, row.getAttribute('data-track-id')) : null;
      if (track) this.startRename(row, track);
    }
  }

  handleKeyDown(event) {
    const handle = event.target.closest('[data-trim]');
    const clipElement = event.target.closest('[data-clip-id]');
    if (!clipElement) return;
    const clipId = clipElement.getAttribute('data-clip-id');
    const located = findClip(this.store.project, clipId);
    if (!located) return;
    const isTrim = Boolean(handle);

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelectClip(clipId, { additive: event.shiftKey });
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.onCommand('delete');
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const amount = event.shiftKey ? 1 : 0.1;
      if (isTrim) {
        event.preventDefault();
        const edge = handle.getAttribute('data-trim');
        const target = edge === 'start'
          ? located.clip.start + direction * amount
          : clipEnd(located.clip) + direction * amount;
        this.store.apply((project) => {
          const current = findClip(project, clipId);
          if (!current) return;
          applyTrim(project, current.track, current.clip, edge, target, this.media);
          sortTrack(current.track);
        });
      } else {
        event.preventDefault();
        const start = Math.max(0, located.clip.start + direction * amount);
        if (overlaps(located.track, located.clip, start, located.clip.duration, clipId)) {
          this.onStatus('That position overlaps another clip on this track.', 'warn');
          return;
        }
        this.store.apply((project) => {
          const current = findClip(project, clipId);
          if (current) {
            current.clip.start = start;
            sortTrack(current.track);
          }
        });
      }
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !isTrim) {
      event.preventDefault();
      this.onCommand('move-layer', {
        clipId,
        direction: event.key === 'ArrowUp' ? -1 : 1
      });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Media drag and drop onto the timeline                                 */
  /* --------------------------------------------------------------------- */

  dropTarget(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const row = element?.closest?.('[data-track-row]');
    if (!row) return null;
    const lane = row.querySelector('[data-lane]');
    if (!lane) return null;
    const rect = lane.getBoundingClientRect();
    const time = clamp((event.clientX - rect.left) / this.pxPerSecond, 0, this.laneWidth() / this.pxPerSecond);
    return {
      trackId: row.getAttribute('data-track-id'),
      kind: row.getAttribute('data-kind'),
      time,
      row
    };
  }

  handleDragOver(event) {
    const types = event.dataTransfer ? [...event.dataTransfer.types] : [];
    if (!types.includes('application/x-letitedit-media') && !types.includes('text/plain')) return;
    const target = this.dropTarget(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.showInsert(null, this.snapTime(target.time, new Set()), target.trackId);
  }

  handleDrop(event) {
    const mediaId = event.dataTransfer?.getData('application/x-letitedit-media') ||
      event.dataTransfer?.getData('text/plain');
    if (!mediaId || !this.media.has(mediaId)) return;
    const target = this.dropTarget(event);
    if (!target) return;
    event.preventDefault();
    this.hideInsert();
    this.onDropMedia(mediaId, target.trackId, this.snapTime(target.time, new Set()));
  }

  zoomToFit() {
    this.fit();
  }

  isBusy() {
    return Boolean(this.drag || this.scrub || this.pinch || this.editingTrackId);
  }
}
