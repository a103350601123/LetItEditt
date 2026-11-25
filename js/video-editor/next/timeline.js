/* LetitEdit editor V3 — multi-track timeline with pointer, touch, snapping,
 * trimming, cross-track moves, subtitle cues, gaps and real project timing.
 */

import { clipEnd, findClip, isCompatibleTrack, moveClipToTrack, projectDuration } from '../model.js';
import { clamp, escapeHtml, formatBytes, formatTime, num, toast } from './dom.js';
import { categoryForClip, hasOverlap } from './state.js';
import { resolveStart } from '../model.js';

const MIN_CLIP = 0.1;
const TRACK_ICONS = {
  audio: '♪',
  text: 'T',
  image: '▧',
  element: '◆',
  background: '▦',
  video: '▶'
};

function trackIcon(track) {
  return TRACK_ICONS[track.category] || TRACK_ICONS[track.kind] || '▶';
}

function clipLabel(clip) {
  if (clip.kind === 'text') return clip.name || clip.text?.content?.split('\n')[0] || 'Text';
  if (clip.kind === 'shape') return clip.name || 'Shape';
  if (clip.kind === 'background') return 'Background';
  return clip.name || clip.kind;
}

const KEYFRAME_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];

function keyframeMarkers(clip) {
  const markers = [];
  for (const prop of KEYFRAME_PROPS) {
    for (const key of clip.keyframes?.[prop] || []) {
      if (Number.isFinite(Number(key.t))) markers.push({ prop, t: Number(key.t) });
    }
  }
  if (!markers.length) return '';
  const duration = Math.max(0.01, clip.duration);
  return `<span class="tl-kf-track" aria-hidden="true">${markers.map((key) =>
    `<i class="tl-kf tl-kf-${key.prop}" data-kf-prop="${key.prop}" data-kf-t="${key.t}" style="left:${clamp(key.t / duration, 0, 1) * 100}%" title="${key.prop} keyframe at ${formatTime(key.t)} — drag to retime"></i>`
  ).join('')}</span>`;
}

export class Timeline {
  constructor({ store, media, onSelect, onAction, onStatus, onEdit }) {
    this.store = store;
    this.media = media;
    this.onSelect = onSelect || (() => {});
    this.onAction = onAction || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onEdit = onEdit || (() => {});
    this.root = null;
    this.scroll = null;
    this.drag = null;
    this.selectedGap = null;
    this.trackHeight = 58;
    this._move = this.onPointerMove.bind(this);
    this._up = this.onPointerUp.bind(this);
    this._cancel = this.onPointerCancel.bind(this);
  }

  mount(root) {
    this.root = root;
    root.innerHTML = `
      <div class="tl-toolbar" role="toolbar" aria-label="Timeline tools">
        <div class="tl-toolbar-group tl-history-tools">
          <button type="button" class="tl-btn" data-tl-action="split" title="Split at playhead (S)"><span aria-hidden="true">✂</span><span>Split</span></button>
          <button type="button" class="tl-btn" data-tl-action="duplicate" title="Duplicate (Ctrl/Cmd + D)"><span aria-hidden="true">⧉</span><span>Duplicate</span></button>
          <button type="button" class="tl-btn" data-tl-action="delete" title="Delete (Delete)"><span aria-hidden="true">⌫</span><span>Delete</span></button>
        </div>
        <div class="tl-toolbar-group">
          <button type="button" class="tl-btn" data-tl-action="add-video-track" title="Add visual track">+ Visual track</button>
          <button type="button" class="tl-btn" data-tl-action="add-audio-track" title="Add audio track">+ Audio track</button>
          <button type="button" class="tl-btn" data-tl-action="close-gap" title="Close the selected gap">Close gap</button>
        </div>
        <div class="tl-toolbar-group tl-toolbar-end">
          <button type="button" class="tl-toggle is-on" data-tl-action="snap" aria-pressed="true" title="Snap clips to edges and the playhead">Snap</button>
          <button type="button" class="tl-toggle" data-tl-action="ripple" aria-pressed="false" title="Ripple editing is off by default">Ripple</button>
          <span class="tl-divider" aria-hidden="true"></span>
          <button type="button" class="tl-icon-btn" data-tl-action="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" class="tl-icon-btn" data-tl-action="fit" title="Fit timeline" aria-label="Fit timeline">Fit</button>
          <button type="button" class="tl-icon-btn" data-tl-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
          <input class="tl-track-height" id="ve-track-height" type="range" min="44" max="94" value="${this.trackHeight}" aria-label="Track height" title="Track height">
        </div>
      </div>
      <div class="tl-main">
        <div class="tl-headers" id="ve-tl-headers"></div>
        <div class="tl-scroll" id="ve-tl-scroll" tabindex="0" aria-label="Timeline tracks">
          <div class="tl-content" id="ve-tl-content">
            <div class="tl-ruler" id="ve-tl-ruler" role="slider" aria-label="Timeline playhead" aria-valuemin="0"></div>
            <div class="tl-lanes" id="ve-tl-lanes"></div>
            <div class="tl-playhead" id="ve-tl-playhead" aria-hidden="true"><span></span></div>
            <div class="tl-snap-line" id="ve-tl-snap" aria-hidden="true"></div>
          </div>
        </div>
      </div>`;
    this.scroll = root.querySelector('#ve-tl-scroll');
    this.ruler = root.querySelector('#ve-tl-ruler');
    this.lanes = root.querySelector('#ve-tl-lanes');
    this.headers = root.querySelector('#ve-tl-headers');
    this.content = root.querySelector('#ve-tl-content');
    this.playhead = root.querySelector('#ve-tl-playhead');
    this.snapLine = root.querySelector('#ve-tl-snap');

    root.addEventListener('click', this.onClick.bind(this));
    root.addEventListener('pointerdown', this.onPointerDown.bind(this));
    root.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    root.addEventListener('input', this.onInput.bind(this));
    this.scroll.addEventListener('scroll', () => {
      this.syncPlayhead();
      if (this.headers) this.headers.scrollTop = this.scroll.scrollTop;
    });
    this.store.subscribe(() => {
      if (!this.drag) this.render();
    });
    this.render();
  }

  /* Rendering ------------------------------------------------------------ */

  pps() {
    return clamp(num(this.store.timelineZoom, 54), 4, 360);
  }

  duration() {
    return Math.max(projectDuration(this.store.project), this.store.project.subtitles.items.reduce((max, item) => Math.max(max, item.end), 0), 5);
  }

  tickStep() {
    const pps = this.pps();
    if (pps >= 190) return 0.5;
    if (pps >= 95) return 1;
    if (pps >= 48) return 2;
    if (pps >= 24) return 5;
    if (pps >= 12) return 10;
    return 30;
  }

  render() {
    if (!this.root) return;
    this.store.prune();
    const project = this.store.project;
    const pps = this.pps();
    const duration = this.duration();
    const minWidth = Math.max(560, this.scroll?.clientWidth || 600);
    const width = Math.max(minWidth, Math.ceil((duration + 2) * pps));
    this.content.style.width = `${width}px`;
    this.ruler.style.width = `${width}px`;
    this.lanes.style.width = `${width}px`;

    this.renderRuler(width, pps);
    this.renderHeaders();
    this.renderLanes(width, pps);
    this.syncTransport();
    this.updateSelectionClasses();
    this.paintMediaPreviews();
  }

  renderRuler(width, pps) {
    const step = this.tickStep();
    const duration = Math.max(this.duration(), 5);
    const count = Math.ceil((width / pps) / step) + 2;
    let html = '';
    for (let i = 0; i < count; i += 1) {
      const time = i * step;
      const left = time * pps;
      const major = Math.abs(time % (step * 5)) < 1e-6;
      html += `<span class="tl-tick ${major ? 'is-major' : ''}" style="left:${left}px"><i></i><em>${formatTime(time)}</em></span>`;
    }
    html += `<span class="tl-ruler-end" style="left:${duration * pps}px"></span>`;
    this.ruler.innerHTML = html;
    this.ruler.setAttribute('aria-valuemax', String(Math.round(duration)));
    this.ruler.setAttribute('aria-valuenow', String(Math.round(this.store.playhead)));
  }

  renderHeaders() {
    const project = this.store.project;
    let html = `<div class="tl-head-corner"><span>Timeline</span><small>${formatTime(this.duration())}</small></div>`;
    for (let index = 0; index < project.tracks.length; index += 1) {
      const track = project.tracks[index];
      const isAudio = track.kind === 'audio';
      html += `
        <div class="tl-head" data-track-head="${track.id}" style="height:${this.trackHeight}px">
          <span class="tl-track-icon tl-track-${escapeHtml(track.category || track.kind)}" aria-hidden="true">${trackIcon(track)}</span>
          <div class="tl-track-meta">
            <strong title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</strong>
            <small>${isAudio ? `${Math.round((track.volume ?? 1) * 100)}%${track.muted ? ' · muted' : ''}` : track.hidden ? 'hidden' : `${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}`}</small>
          </div>
          <div class="tl-track-controls">
            <button type="button" class="tl-track-btn ${track.hidden || (isAudio && track.muted) ? 'is-off' : ''}" data-track-action="${isAudio ? 'mute' : 'hide'}" data-track-id="${track.id}" title="${isAudio ? 'Mute track' : 'Hide track'}" aria-label="${isAudio ? 'Mute track' : 'Hide track'}" aria-pressed="${isAudio ? track.muted : track.hidden}">${isAudio ? 'M' : '◉'}</button>
            <button type="button" class="tl-track-btn ${track.locked ? 'is-off' : ''}" data-track-action="lock" data-track-id="${track.id}" title="Lock track" aria-label="Lock track" aria-pressed="${track.locked}">${track.locked ? '▣' : '▢'}</button>
            <button type="button" class="tl-track-btn tl-track-more" data-track-action="menu" data-track-id="${track.id}" aria-label="Track options" title="Track options">⋯</button>
          </div>
          ${isAudio ? `<input class="tl-track-volume" type="range" min="0" max="1.5" step="0.01" value="${track.volume ?? 1}" data-track-volume="${track.id}" aria-label="Volume for ${escapeHtml(track.name)}">` : ''}
        </div>`;
    }
    const subCount = project.subtitles.items.length;
    html += `
      <div class="tl-head tl-head-subs" style="height:44px">
        <span class="tl-track-icon tl-track-text" aria-hidden="true">CC</span>
        <div class="tl-track-meta"><strong>Subtitles</strong><small>${subCount} cue${subCount === 1 ? '' : 's'}</small></div>
        <button type="button" class="tl-track-btn" data-tl-action="add-subtitle" title="Add subtitle cue" aria-label="Add subtitle cue">+</button>
      </div>`;
    this.headers.innerHTML = html;
  }

  renderLanes(width, pps) {
    const project = this.store.project;
    let html = '';
    for (const track of project.tracks) {
      const gaps = this.gapsFor(track, pps);
      html += `<div class="tl-lane tl-lane-${escapeHtml(track.category || track.kind)} ${track.locked ? 'is-locked' : ''} ${track.hidden ? 'is-hidden' : ''}" data-track-id="${track.id}" style="height:${this.trackHeight}px">`;
      html += gaps;
      for (const clip of track.clips) {
        const selected = this.store.selection.has(clip.id);
        const left = clip.start * pps;
        const w = Math.max(8, clip.duration * pps);
        const label = clipLabel(clip);
        const asset = clip.mediaId ? this.media.get(clip.mediaId) : null;
        const kind = categoryForClip(clip);
        const dim = clip.hidden ? ' is-clip-hidden' : '';
        const thumb = asset?.thumbnail
          ? `style="--clip-thumb:url('${asset.thumbnail.replace(/'/g, "\\'")}')"`
          : '';
        html += `
          <div class="tl-clip tl-clip-${kind}${selected ? ' is-selected' : ''}${dim}${clip.locked ? ' is-locked' : ''}"
               data-clip-id="${clip.id}" data-track-id="${track.id}" tabindex="0" role="button"
               aria-label="${escapeHtml(label)}, ${formatTime(clip.start)} to ${formatTime(clipEnd(clip))}"
               aria-pressed="${selected}" ${thumb}
               style="left:${left}px;width:${w}px">
            <span class="tl-trim tl-trim-left" data-trim="left" title="Trim start" aria-hidden="true"></span>
            <div class="tl-clip-body">
              ${clip.kind === 'audio' ? '<canvas class="tl-wave" aria-hidden="true"></canvas>' : asset?.thumbnail ? '<span class="tl-clip-thumb" aria-hidden="true"></span>' : `<span class="tl-clip-glyph" aria-hidden="true">${clip.kind === 'text' ? 'T' : clip.kind === 'shape' ? '◆' : '▶'}</span>`}
              <span class="tl-clip-name">${escapeHtml(label)}</span>
              ${w > 86 ? `<span class="tl-clip-time">${formatTime(clip.duration)}</span>` : ''}
            </div>
            <span class="tl-trim tl-trim-right" data-trim="right" title="Trim end" aria-hidden="true"></span>
            ${keyframeMarkers(clip)}
          </div>`;
      }
      html += '</div>';
    }
    const subtitleBlocks = project.subtitles.items.map((item) => {
      const selected = this.store.selectedSubtitle === item.id;
      return `<div class="tl-subtitle${selected ? ' is-selected' : ''}" data-subtitle-id="${item.id}" tabindex="0" role="button" aria-pressed="${selected}" style="left:${item.start * pps}px;width:${Math.max(18, (item.end - item.start) * pps)}px">
        <span class="tl-trim tl-trim-left" data-subtitle-trim="left" aria-hidden="true"></span>
        <span class="tl-subtitle-text">${escapeHtml(item.text.split('\n')[0] || 'Subtitle')}</span>
        <span class="tl-trim tl-trim-right" data-subtitle-trim="right" aria-hidden="true"></span>
      </div>`;
    }).join('');
    html += `<div class="tl-lane tl-lane-subs" data-subtitle-lane="1" style="height:44px">${subtitleBlocks}</div>`;
    this.lanes.innerHTML = html;
    this.syncPlayhead();
  }

  gapsFor(track, pps) {
    let cursor = 0;
    let html = '';
    const clips = track.clips.slice().sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      if (clip.start - cursor > 0.25) {
        html += `<button type="button" class="tl-gap" data-gap-track="${track.id}" data-gap-start="${cursor}" data-gap-end="${clip.start}" style="left:${cursor * pps}px;width:${Math.max(2, (clip.start - cursor) * pps)}px" title="Gap ${formatTime(clip.start - cursor)} — click to select" aria-label="Select gap"></button>`;
      }
      cursor = Math.max(cursor, clipEnd(clip));
    }
    return html;
  }

  paintMediaPreviews() {
    const lanes = this.lanes;
    if (!lanes) return;
    lanes.querySelectorAll('.tl-clip-audio .tl-wave').forEach((canvas) => {
      const clipEl = canvas.closest('[data-clip-id]');
      const found = findClip(this.store.project, clipEl?.dataset.clipId);
      if (!found || !found.clip.mediaId) return;
      const peaks = this.media.getPeaks(found.clip.mediaId);
      if (!peaks) {
        canvas.hidden = true;
        return;
      }
      const width = Math.max(4, Math.min(3200, Math.round(clipEl.getBoundingClientRect().width)));
      const height = 24;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(255,255,255,.68)';
      const count = Math.max(1, Math.floor(width / 3));
      for (let i = 0; i < count; i += 1) {
        const index = Math.floor(i / count * peaks.length);
        const value = clamp(peaks[index] || 0, 0, 1);
        const h = Math.max(1, value * (height - 2));
        ctx.fillRect(i * 3, (height - h) / 2, 2, h);
      }
    });
  }

  syncTransport() {
    if (!this.playhead) return;
    const pps = this.pps();
    this.playhead.style.left = `${this.store.playhead * pps}px`;
    this.ruler.setAttribute('aria-valuenow', String(Math.round(this.store.playhead)));
    this.root.querySelectorAll('[data-tl-action="snap"]').forEach((button) => {
      button.classList.toggle('is-on', this.store.snapping);
      button.setAttribute('aria-pressed', String(this.store.snapping));
    });
    this.root.querySelectorAll('[data-tl-action="ripple"]').forEach((button) => {
      button.classList.toggle('is-on', this.store.ripple);
      button.setAttribute('aria-pressed', String(this.store.ripple));
    });
  }

  syncPlayhead() {
    if (!this.playhead) return;
    this.playhead.style.left = `${this.store.playhead * this.pps()}px`;
  }

  updateSelectionClasses() {
    if (!this.lanes) return;
    this.lanes.querySelectorAll('[data-clip-id]').forEach((element) => {
      const selected = this.store.selection.has(element.dataset.clipId);
      element.classList.toggle('is-selected', selected);
      element.setAttribute('aria-pressed', String(selected));
    });
    this.lanes.querySelectorAll('[data-subtitle-id]').forEach((element) => {
      const selected = this.store.selectedSubtitle === element.dataset.subtitleId;
      element.classList.toggle('is-selected', selected);
      element.setAttribute('aria-pressed', String(selected));
    });
    this.lanes.querySelectorAll('.tl-gap').forEach((gap) => {
      gap.classList.toggle('is-selected', Boolean(this.selectedGap &&
        gap.dataset.gapTrack === this.selectedGap.trackId &&
        Math.abs(Number(gap.dataset.gapStart) - this.selectedGap.start) < 0.01));
    });
  }

  /* Interaction --------------------------------------------------------- */

  onClick(event) {
    const action = event.target.closest('[data-tl-action]');
    if (action) {
      this.handleAction(action.dataset.tlAction);
      return;
    }
    const trackAction = event.target.closest('[data-track-action]');
    if (trackAction) {
      this.handleTrackAction(trackAction.dataset.trackAction, trackAction.dataset.trackId, trackAction);
      return;
    }
    const subtitle = event.target.closest('[data-subtitle-id]');
    if (subtitle && !event.target.closest('[data-subtitle-trim]')) {
      this.store.selectSubtitle(subtitle.dataset.subtitleId);
      this.store.emit('selection');
      this.onSelect(null, subtitle.dataset.subtitleId);
      return;
    }
    const gap = event.target.closest('[data-gap-track]');
    if (gap) {
      this.selectedGap = {
        trackId: gap.dataset.gapTrack,
        start: Number(gap.dataset.gapStart),
        end: Number(gap.dataset.gapEnd)
      };
      this.updateSelectionClasses();
      toast('Gap selected. Use Close gap to remove it.', 'info', 2500);
      return;
    }
    const clip = event.target.closest('[data-clip-id]');
    if (clip) {
      const additive = event.ctrlKey || event.metaKey;
      const range = event.shiftKey;
      this.store.selectClip(clip.dataset.clipId, { additive, range });
      this.store.emit('selection');
      this.onSelect(clip.dataset.clipId);
      this.updateSelectionClasses();
      return;
    }
    if (event.target.closest('.tl-lane')) {
      this.selectedGap = null;
      this.store.clearSelection();
      this.store.emit('selection');
      this.onSelect(null);
      this.updateSelectionClasses();
    }
  }

  handleAction(action) {
    if (action === 'snap' || action === 'ripple') {
      this.store[action === 'snap' ? 'snapping' : 'ripple'] = !this.store[action === 'snap' ? 'snapping' : 'ripple'];
      this.syncTransport();
      this.onEdit('ui');
      return;
    }
    if (action === 'zoom-in') {
      this.store.timelineZoom = clamp(this.pps() * 1.3, 4, 360);
      this.render();
      this.onEdit('ui');
      return;
    }
    if (action === 'zoom-out') {
      this.store.timelineZoom = clamp(this.pps() / 1.3, 4, 360);
      this.render();
      this.onEdit('ui');
      return;
    }
    if (action === 'fit') {
      this.fit();
      return;
    }
    if (action === 'close-gap') {
      this.closeGap();
      return;
    }
    this.onAction(action, { gap: this.selectedGap });
  }

  handleTrackAction(action, trackId, button) {
    const track = this.store.project.tracks.find((item) => item.id === trackId);
    if (!track) return;
    if (action === 'menu') {
      this.onAction('track-menu', { track, anchor: button });
      return;
    }
    this.store.apply((draft) => {
      const target = draft.tracks.find((item) => item.id === trackId);
      if (!target) return;
      if (action === 'hide') target.hidden = !target.hidden;
      if (action === 'mute') target.muted = !target.muted;
      if (action === 'lock') target.locked = !target.locked;
    });
    this.render();
  }

  onInput(event) {
    const volume = event.target.closest('[data-track-volume]');
    if (volume) {
      const track = this.store.project.tracks.find((item) => item.id === volume.dataset.trackVolume);
      if (!track) return;
      this.store.begin();
      track.volume = clamp(Number(volume.value), 0, 1.5);
      this.store.emit('live-drag');
      this.store.end('track-volume');
      return;
    }
    if (event.target.id === 've-track-height') {
      this.trackHeight = clamp(Math.round(Number(event.target.value) || 58), 44, 94);
      this.root.style.setProperty('--tl-track-height', `${this.trackHeight}px`);
      this.render();
      this.onEdit('ui');
    }
  }

  setTrackHeight(value) {
    this.trackHeight = clamp(Math.round(value), 44, 94);
    this.root.style.setProperty('--tl-track-height', `${this.trackHeight}px`);
    this.render();
  }

  fit() {
    const width = Math.max(320, (this.scroll?.clientWidth || 640) - 32);
    const duration = Math.max(5, this.duration());
    this.store.timelineZoom = clamp(width / duration, 4, 200);
    this.render();
    this.scroll.scrollLeft = 0;
    this.onEdit('ui');
  }

  closeGap() {
    if (!this.selectedGap) {
      toast('Select a gap in the timeline first.', 'info');
      return;
    }
    const gap = this.selectedGap;
    const track = this.store.project.tracks.find((item) => item.id === gap.trackId);
    if (!track) return;
    this.store.apply((draft) => {
      const target = draft.tracks.find((item) => item.id === gap.trackId);
      for (const clip of target.clips) {
        if (clip.start >= gap.end - 1e-4) clip.start = Math.max(0, clip.start - (gap.end - gap.start));
      }
      target.clips.sort((a, b) => a.start - b.start);
    }, { reason: 'close-gap' });
    this.selectedGap = null;
    this.render();
    toast('Gap closed.', 'success');
  }

  onWheel(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const pps = this.pps();
    const rect = this.scroll.getBoundingClientRect();
    const anchorTime = (this.scroll.scrollLeft + event.clientX - rect.left) / pps;
    this.store.timelineZoom = clamp(pps * (event.deltaY < 0 ? 1.12 : 0.89), 4, 360);
    this.render();
    this.scroll.scrollLeft = Math.max(0, anchorTime * this.pps() - (event.clientX - rect.left));
    this.onEdit('ui');
  }

  timeAt(event) {
    const rect = this.content.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / this.pps(), 0, this.duration());
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    const trackHead = event.target.closest('[data-track-head]');
    if (trackHead && event.target.closest('[data-track-volume]')) return;
    if (event.target.closest('.tl-ruler') || event.target.closest('#ve-tl-playhead')) {
      event.preventDefault();
      const time = this.timeAt(event);
      this.pauseForSeek();
      this.store.playhead = time;
      this.onEdit('seek', time);
      this.syncTransport();
      this.drag = { mode: 'playhead', pointerId: event.pointerId };
      this.capture(event);
      return;
    }
    const subtitle = event.target.closest('[data-subtitle-id]');
    if (subtitle) {
      const trim = event.target.closest('[data-subtitle-trim]')?.dataset.subtitleTrim;
      this.beginSubtitleDrag(event, subtitle.dataset.subtitleId, trim || 'move');
      return;
    }
    const marker = event.target.closest('.tl-kf');
    if (marker) {
      this.beginKeyframeDrag(event, marker);
      return;
    }
    const clipEl = event.target.closest('[data-clip-id]');
    if (!clipEl) return;
    const found = findClip(this.store.project, clipEl.dataset.clipId);
    if (!found || found.clip.locked || found.track.locked) {
      if (found?.track.locked) toast('This track is locked. Unlock it to move clips.', 'info');
      return;
    }
    const trim = event.target.closest('[data-trim]')?.dataset.trim;
    this.beginClipDrag(event, found, trim || 'move');
  }

  capture(event) {
    window.addEventListener('pointermove', this._move, { passive: false });
    window.addEventListener('pointerup', this._up, { once: true });
    window.addEventListener('pointercancel', this._cancel, { once: true });
  }

  release() {
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._cancel);
  }

  beginClipDrag(event, found, mode) {
    event.preventDefault();
    event.stopPropagation();
    this.store.begin();
    const { clip, track } = found;
    const original = {
      start: clip.start,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      trackId: track.id
    };
    const rowRects = [...this.lanes.querySelectorAll('.tl-lane[data-track-id]')].map((row) => ({
      id: row.dataset.trackId,
      rect: row.getBoundingClientRect()
    }));
    this.drag = {
      mode,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      original,
      clipId: clip.id,
      moved: false,
      targetTrackId: track.id,
      rowRects
    };
    this.capture(event);
    this.store.selectClip(clip.id);
    this.store.emit('selection');
    this.onSelect(clip.id);
    this.updateSelectionClasses();
    this.root.classList.add('is-dragging');
  }

  beginSubtitleDrag(event, id, mode) {
    event.preventDefault();
    event.stopPropagation();
    const item = this.store.project.subtitles.items.find((cue) => cue.id === id);
    if (!item) return;
    this.store.begin();
    this.drag = {
      mode: `subtitle-${mode}`,
      pointerId: event.pointerId,
      originX: event.clientX,
      subtitleId: id,
      original: { start: item.start, end: item.end },
      moved: false
    };
    this.store.selectSubtitle(id);
    this.store.emit('selection');
    this.onSelect(null, id);
    this.capture(event);
  }

  beginKeyframeDrag(event, marker) {
    const clipEl = marker.closest('[data-clip-id]');
    const found = clipEl ? findClip(this.store.project, clipEl.dataset.clipId) : null;
    if (!found || found.clip.locked || found.track.locked) return;
    const prop = marker.dataset.kfProp;
    const time = Number(marker.dataset.kfT);
    const list = found.clip.keyframes?.[prop] || [];
    const index = list.findIndex((entry) => Math.abs(Number(entry.t) - time) < 1e-4);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.store.begin();
    this.drag = {
      mode: 'keyframe',
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      clipId: found.clip.id,
      prop,
      index,
      originalT: time,
      moved: false
    };
    this.store.selectClip(found.clip.id);
    this.store.emit('selection');
    this.onSelect(found.clip.id);
    this.updateSelectionClasses();
    this.capture(event);
    this.root.classList.add('is-dragging');
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.drag.mode === 'playhead') {
      const time = this.timeAt(event);
      this.store.playhead = time;
      this.onEdit('seek', time);
      this.syncTransport();
      event.preventDefault();
      return;
    }
    const dx = event.clientX - this.drag.originX;
    if (Math.abs(dx) > 2 || Math.abs(event.clientY - this.drag.originY) > 2) this.drag.moved = true;
    if (this.drag.mode === 'keyframe') {
      const found = findClip(this.store.project, this.drag.clipId);
      const entry = found?.clip?.keyframes?.[this.drag.prop]?.[this.drag.index];
      if (entry) {
        const time = clamp(this.drag.originalT + dx / this.pps(), 0, Math.max(0, found.clip.duration));
        entry.t = Math.round(time * 1000) / 1000;
        this.store.playhead = found.clip.start + entry.t;
        this.onEdit('seek', this.store.playhead);
        this.syncTransport();
      }
      this.store.emit('live-drag');
      this.render();
      event.preventDefault();
      return;
    }
    if (this.drag.mode.startsWith('subtitle-')) {
      this.updateSubtitleDrag(dx);
      event.preventDefault();
      return;
    }
    const found = findClip(this.store.project, this.drag.clipId);
    if (!found) return;
    const { clip } = found;
    const original = this.drag.original;
    const delta = dx / this.pps();
    if (this.drag.mode === 'move') {
      let start = Math.max(0, original.start + delta);
      start = this.snapTime(start, clip.id);
      clip.start = start;
      const target = this.trackAt(event.clientY);
      if (target && target.id !== found.track.id && isCompatibleTrack(target, clip) && !target.locked) {
        this.drag.targetTrackId = target.id;
      } else {
        this.drag.targetTrackId = found.track.id;
      }
      this.showTrackTarget();
    } else if (this.drag.mode === 'left') {
      const end = original.start + original.duration;
      let start = clamp(original.start + delta, 0, end - MIN_CLIP);
      start = this.snapTime(start, clip.id);
      const shift = start - original.start;
      clip.start = start;
      clip.duration = Math.max(MIN_CLIP, end - start);
      if (clip.kind === 'video' || clip.kind === 'audio') clip.inPoint = Math.max(0, original.inPoint + shift * (clip.speed || 1));
    } else if (this.drag.mode === 'right') {
      let end = original.start + original.duration + delta;
      end = this.snapTime(end, clip.id);
      let duration = Math.max(MIN_CLIP, end - original.start);
      if (clip.kind === 'video' || clip.kind === 'audio') {
        const asset = clip.mediaId ? this.media.get(clip.mediaId) : null;
        if (asset?.duration) duration = Math.min(duration, Math.max(MIN_CLIP, (asset.duration - clip.inPoint) / Math.max(0.05, clip.speed || 1)));
      }
      clip.duration = duration;
      if (clip.kind === 'video' || clip.kind === 'audio') clip.outPoint = clip.inPoint + duration * (clip.speed || 1);
    }
    this.store.emit('live-drag');
    this.render();
    this.syncSelectionDrag();
    event.preventDefault();
  }

  snapTime(time, excludeId) {
    if (!this.store.snapping) return time;
    const pps = this.pps();
    const threshold = 8 / pps;
    const candidates = [0, this.store.playhead];
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) {
        if (clip.id === excludeId) continue;
        candidates.push(clip.start, clipEnd(clip));
      }
    }
    for (const item of this.store.project.subtitles.items) candidates.push(item.start, item.end);
    let best = time;
    let distance = threshold;
    for (const candidate of candidates) {
      const d = Math.abs(candidate - time);
      if (d < distance) {
        distance = d;
        best = candidate;
      }
    }
    if (best !== time) this.showSnap(best);
    else this.snapLine?.classList.remove('is-visible');
    return best;
  }

  updateSubtitleDrag(dx) {
    const item = this.store.project.subtitles.items.find((cue) => cue.id === this.drag.subtitleId);
    if (!item) return;
    const delta = dx / this.pps();
    const original = this.drag.original;
    if (this.drag.mode === 'subtitle-left') {
      item.start = clamp(original.start + delta, 0, original.end - 0.2);
    } else if (this.drag.mode === 'subtitle-right') {
      item.end = Math.max(item.start + 0.2, original.end + delta);
    } else {
      const length = original.end - original.start;
      item.start = Math.max(0, original.start + delta);
      item.end = item.start + length;
    }
    this.store.emit('live-drag');
    this.render();
    this.syncSelectionDrag();
  }

  trackAt(y) {
    if (!this.drag?.rowRects) return null;
    const row = this.drag.rowRects.find((entry) => y >= entry.rect.top && y <= entry.rect.bottom);
    return row ? this.store.project.tracks.find((track) => track.id === row.id) || null : null;
  }

  showTrackTarget() {
    if (!this.drag?.targetTrackId) return;
    this.lanes.querySelectorAll('.tl-lane').forEach((lane) => {
      lane.classList.toggle('is-drop-target', lane.dataset.trackId === this.drag.targetTrackId);
    });
  }

  showSnap(time) {
    if (!this.snapLine) return;
    this.snapLine.style.left = `${time * this.pps()}px`;
    this.snapLine.classList.add('is-visible');
  }

  syncSelectionDrag() {
    this.syncTransport();
    this.updateSelectionClasses();
  }

  onPointerUp(event) {
    if (!this.drag || (event && event.pointerId !== this.drag.pointerId)) return;
    this.release();
    const drag = this.drag;
    this.drag = null;
    this.root.classList.remove('is-dragging');
    this.snapLine?.classList.remove('is-visible');
    this.lanes?.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));

    if (drag.mode === 'playhead') {
      this.render();
      return;
    }
    if (drag.mode === 'keyframe') {
      if (drag.moved) this.store.end('keyframe-move');
      else this.store.end({ history: false });
      this.render();
      return;
    }
    if (drag.mode.startsWith('subtitle-')) {
      if (drag.moved) this.store.end('subtitle-move');
      else this.store.end({ history: false });
      this.render();
      return;
    }
    if (!drag.moved) {
      this.store.end({ history: false });
      this.render();
      return;
    }
    const found = findClip(this.store.project, drag.clipId);
    if (!found) {
      this.store.end('timeline-change');
      return;
    }
    const { clip, track } = found;
    let changed = false;
    if (drag.mode === 'move' && drag.targetTrackId && drag.targetTrackId !== track.id) {
      const target = this.store.project.tracks.find((item) => item.id === drag.targetTrackId);
      if (target && isCompatibleTrack(target, clip) && !target.locked) {
        const start = resolveStart(target, clip, clip.start, clip.duration);
        if (start !== null) {
          track.clips.splice(track.clips.findIndex((item) => item.id === clip.id), 1);
          clip.start = start;
          target.clips.push(clip);
          target.clips.sort((a, b) => a.start - b.start);
          changed = true;
        }
      }
    }
    if (drag.mode === 'move' && !changed) {
      const start = resolveStart(track, clip, clip.start, clip.duration);
      if (start !== null && start !== clip.start) {
        clip.start = start;
        changed = true;
      }
      track.clips.sort((a, b) => a.start - b.start);
    }
    this.store.end('timeline-change');
    this.render();
    this.onEdit('timeline');
  }

  onPointerCancel(event) {
    if (!this.drag) return;
    this.release();
    const drag = this.drag;
    this.drag = null;
    this.root.classList.remove('is-dragging');
    this.snapLine?.classList.remove('is-visible');
    if (drag.mode.startsWith('subtitle-')) {
      const item = this.store.project.subtitles.items.find((cue) => cue.id === drag.subtitleId);
      if (item && drag.original) {
        item.start = drag.original.start;
        item.end = drag.original.end;
      }
    } else if (drag.clipId && drag.original) {
      const found = findClip(this.store.project, drag.clipId);
      if (found) {
        found.clip.start = drag.original.start;
        found.clip.duration = drag.original.duration;
        found.clip.inPoint = drag.original.inPoint;
        found.clip.outPoint = drag.original.outPoint;
      }
    }
    this.store.end({ history: false });
    this.render();
  }

  pauseForSeek() {
    this.onEdit('pause-for-seek');
  }

  fitToPlayhead() {
    if (!this.scroll) return;
    const x = this.store.playhead * this.pps();
    if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + this.scroll.clientWidth - 40) {
      this.scroll.scrollLeft = Math.max(0, x - this.scroll.clientWidth * 0.4);
    }
  }

  debug() {
    return {
      pixelsPerSecond: this.pps(),
      trackHeight: this.trackHeight,
      selectedGap: this.selectedGap,
      clipCount: this.store.project.tracks.reduce((sum, track) => sum + track.clips.length, 0)
    };
  }
}
