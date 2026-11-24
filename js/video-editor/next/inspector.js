/* LetitEdit editor V3 — contextual properties inspector. */

import {
  FONT_OPTIONS,
  clipEnd,
  defaultColor,
  projectDimensions,
  projectDuration
} from '../model.js';
import { FILTERS, TRANSITION_GROUPS } from '../effects.js';
import { ANIMATIONS, COLOR_PRESETS } from '../presets.js';
import { escapeHtml, formatTime, num, clamp, isTypingTarget } from './dom.js';

const KEY_PROPS = [
  ['x', 'Position X'],
  ['y', 'Position Y'],
  ['scale', 'Scale'],
  ['rotation', 'Rotation'],
  ['opacity', 'Opacity']
];

function optionList(items, selected, encode = true) {
  return items.map((item) => {
    const value = encode ? escapeHtml(String(item.id ?? item)) : String(item.id ?? item);
    const label = escapeHtml(String(item.label ?? item));
    return `<option value="${value}" ${String(item.id ?? item) === String(selected) ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function section(title, body, open = true, badge = '') {
  return `<details class="ve-inspector-section" ${open ? 'open' : ''}>
    <summary><span>${escapeHtml(title)}</span>${badge ? `<em>${escapeHtml(badge)}</em>` : ''}<i aria-hidden="true">⌄</i></summary>
    <div class="ve-inspector-body">${body}</div>
  </details>`;
}

function numberField(label, prop, value, { min = -9999, max = 9999, step = 1, suffix = '', hint = '' } = {}) {
  return `<label class="ve-field ve-field-compact">
    <span>${escapeHtml(label)}</span>
    <div class="ve-number-unit">
      <input type="number" data-prop="${prop}" value="${Number(value).toFixed(step < 1 ? 2 : 0)}" min="${min}" max="${max}" step="${step}" aria-label="${escapeHtml(label)}">
      ${suffix ? `<em>${escapeHtml(suffix)}</em>` : ''}
    </div>
    ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
  </label>`;
}

function rangeField(label, prop, value, { min = 0, max = 1, step = 0.01, suffix = '', format = (v) => `${Math.round(v * 100)}%` } = {}) {
  const current = Number(value);
  return `<label class="ve-field ve-range-field">
    <span>${escapeHtml(label)}<output data-output="${prop}">${format(current)}</output></span>
    <input type="range" data-prop="${prop}" value="${current}" min="${min}" max="${max}" step="${step}" aria-label="${escapeHtml(label)}">
  </label>`;
}

function colorField(label, prop, value) {
  return `<label class="ve-field ve-color-field">
    <span>${escapeHtml(label)}</span>
    <span class="ve-color-wrap"><input type="color" data-prop="${prop}" value="${/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'}" aria-label="${escapeHtml(label)}"><code>${escapeHtml(value || '#000000')}</code></span>
  </label>`;
}

function toggleField(label, prop, checked, hint = '') {
  return `<label class="ve-toggle-row">
    <span><strong>${escapeHtml(label)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</span>
    <input type="checkbox" data-prop="${prop}" ${checked ? 'checked' : ''}>
  </label>`;
}

function selectField(label, prop, value, options, hint = '') {
  return `<label class="ve-field">
    <span>${escapeHtml(label)}</span>
    <select data-prop="${prop}">${options}</select>
    ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
  </label>`;
}

function textField(label, prop, value, hint = '') {
  return `<label class="ve-field">
    <span>${escapeHtml(label)}</span>
    <input type="text" data-prop="${prop}" value="${escapeHtml(value)}" maxlength="500" autocomplete="off">
    ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
  </label>`;
}

export class Inspector {
  constructor({ store, onAction, onStatus, onEdit }) {
    this.store = store;
    this.onAction = onAction || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onEdit = onEdit || (() => {});
    this.root = null;
    this.lastRenderKey = '';
  }

  mount(root) {
    this.root = root;
    root.addEventListener('input', this.onInput.bind(this));
    root.addEventListener('change', this.onChange.bind(this));
    root.addEventListener('click', this.onClick.bind(this));
    this.store.subscribe((reason) => {
      if (reason === 'live-drag') return;
      if (isTypingTarget(document.activeElement) && this.root.contains(document.activeElement)) return;
      this.render();
    });
    this.render();
  }

  primary() {
    return this.store.firstSelected();
  }

  subtitle() {
    if (!this.store.selectedSubtitle) return null;
    return this.store.project.subtitles.items.find((item) => item.id === this.store.selectedSubtitle) || null;
  }

  render() {
    if (!this.root) return;
    const found = this.primary();
    const subtitle = this.subtitle();
    if (subtitle) {
      this.root.innerHTML = this.subtitlePanel(subtitle);
      return;
    }
    if (!found) {
      this.root.innerHTML = this.emptyPanel();
      return;
    }
    const { clip, track } = found;
    const local = this.store.playhead - clip.start;
    const isVisual = track.kind === 'video';
    const isMedia = clip.kind === 'video' || clip.kind === 'image';
    const isAudio = clip.kind === 'video' || clip.kind === 'audio';
    const dims = projectDimensions(this.store.project);
    let html = `<div class="ve-inspector-title">
      <span class="ve-kind-chip ve-kind-${escapeHtml(clip.kind)}">${escapeHtml(clip.kind)}</span>
      <div><h2 title="${escapeHtml(clip.name || clip.kind)}">${escapeHtml(clip.name || clip.kind)}</h2><p>${escapeHtml(track.name)} · ${formatTime(clip.start, true, this.store.project.fps)}</p></div>
      <button type="button" class="ve-icon-btn" data-inspector-action="close" aria-label="Clear selection" title="Clear selection">×</button>
    </div>`;

    if (isVisual) {
      html += section('Transform', `
        <div class="ve-grid-2">
          ${numberField('X', 'x', (clip.x ?? 0.5) * dims.width, { min: -5000, max: 5000, step: 1, suffix: 'px' })}
          ${numberField('Y', 'y', (clip.y ?? 0.5) * dims.height, { min: -5000, max: 5000, step: 1, suffix: 'px' })}
          ${numberField('Scale', 'scale', (clip.scale ?? 1) * 100, { min: 2, max: 1000, step: 1, suffix: '%' })}
          ${numberField('Rotation', 'rotation', clip.rotation || 0, { min: -720, max: 720, step: 1, suffix: '°' })}
        </div>
        ${rangeField('Opacity', 'opacity', clip.opacity ?? 1)}
        <div class="ve-btn-row">
          <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="fit-contain">Fit</button>
          <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="fit-cover">Fill</button>
          <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="flip-h">Flip H</button>
          <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="flip-v">Flip V</button>
          <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="reset-transform">Reset</button>
        </div>
        <div class="ve-keyframe-bar">
          <span>Keyframes</span>
          ${KEY_PROPS.map(([prop, label]) => `<button type="button" class="ve-kf ${clip.keyframes?.[prop]?.length ? 'has-kf' : ''}" data-inspector-action="keyframe" data-key-prop="${prop}" title="Add ${escapeHtml(label)} keyframe at ${formatTime(this.store.playhead)}">${escapeHtml(prop)}<sup>${clip.keyframes?.[prop]?.length || 0}</sup></button>`).join('')}
          <button type="button" class="ve-kf-clear" data-inspector-action="clear-keyframes" title="Clear all keyframes">Clear</button>
        </div>
        <p class="ve-micro">Keyframes animate position, scale, rotation and opacity and are rendered in the export.</p>
        ${clip.kind === 'video' || clip.kind === 'image' ? `
          <div class="ve-grid-2 ve-crop-grid">
            ${['left', 'right', 'top', 'bottom'].map((side) => `<label class="ve-field ve-field-compact"><span>Crop ${side}</span><input type="number" data-crop="${side}" min="0" max="45" step="1" value="${Math.round((clip.crop?.[side] || 0) * 100)}" aria-label="Crop ${side} percent"></label>`).join('')}
          </div>` : ''}
      `);
    }

    const media = clip.mediaId ? this.store.media?.get(clip.mediaId) : null;
    html += section('Timing', `
      <div class="ve-grid-2">
        ${numberField('Start', 'start', clip.start, { min: 0, max: 86400, step: 0.05, suffix: 's' })}
        ${numberField('Duration', 'duration', clip.duration, { min: 0.1, max: 86400, step: 0.05, suffix: 's' })}
        ${clip.kind === 'video' || clip.kind === 'audio' ? numberField('Source in', 'inPoint', clip.inPoint || 0, { min: 0, max: 86400, step: 0.05, suffix: 's' }) : ''}
        ${clip.kind === 'video' || clip.kind === 'audio' ? `<div class="ve-field ve-field-compact"><span>Ends at</span><output class="ve-readout">${formatTime(clipEnd(clip), true, this.store.project.fps)}</output></div>` : ''}
      </div>
      <div class="ve-grid-2">
        ${numberField('Speed', 'speed', clip.speed || 1, { min: 0.1, max: 8, step: 0.05, suffix: '×' })}
        ${clip.kind === 'video' ? numberField('Freeze at', 'freezeAt', clip.freezeAt ?? clip.inPoint ?? 0, { min: 0, max: 86400, step: 0.05, suffix: 's' }) : ''}
      </div>
      ${clip.kind === 'video' ? toggleField('Freeze frame', 'freeze', clip.freeze, 'Holds one decoded frame for the clip duration.') : ''}
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="split-clip">Split at playhead</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="duplicate-clip">Duplicate</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="delete-clip">Delete</button>
      </div>
      ${media ? `<p class="ve-micro">Source: ${escapeHtml(media.name)} · ${media.width || 0}×${media.height || 0}${media.duration ? ` · ${formatTime(media.duration)}` : ''}</p>` : ''}
      <p class="ve-micro">Local time ${formatTime(Math.max(0, local))} of ${formatTime(clip.duration)}.</p>
    `, false);

    if (clip.kind === 'text') {
      const text = clip.text || {};
      html += section('Text', `
        <label class="ve-field"><span>Content</span><textarea data-text-prop="content" rows="4" maxlength="4000" spellcheck="true">${escapeHtml(text.content || '')}</textarea></label>
        <div class="ve-grid-2">
          ${selectField('Font', 'text.font', text.font, optionList(FONT_OPTIONS, text.font))}
          ${numberField('Size', 'text.size', text.size ?? 72, { min: 6, max: 500, step: 1, suffix: 'px' })}
          ${selectField('Alignment', 'text.align', text.align, optionList([{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }], text.align))}
          ${selectField('Direction', 'text.direction', text.direction, optionList([{ id: 'auto', label: 'Auto (Unicode)' }, { id: 'ltr', label: 'Left to right' }, { id: 'rtl', label: 'Right to left' }], text.direction))}
          ${numberField('Line height', 'text.lineHeight', text.lineHeight ?? 1.25, { min: 0.7, max: 3, step: 0.05 })}
          ${numberField('Letter spacing', 'text.letterSpacing', text.letterSpacing || 0, { min: -20, max: 60, step: 0.5, suffix: 'px' })}
        </div>
        <div class="ve-style-row">
          <button type="button" class="ve-style-toggle ${text.bold ? 'is-on' : ''}" data-inspector-action="text-style" data-style="bold" aria-pressed="${text.bold}"><strong>B</strong></button>
          <button type="button" class="ve-style-toggle ${text.italic ? 'is-on' : ''}" data-inspector-action="text-style" data-style="italic" aria-pressed="${text.italic}"><em>I</em></button>
          <button type="button" class="ve-style-toggle ${text.underline ? 'is-on' : ''}" data-inspector-action="text-style" data-style="underline" aria-pressed="${text.underline}"><u>U</u></button>
          <label class="ve-inline-check"><input type="checkbox" data-prop="text.shadow" ${text.shadow ? 'checked' : ''}> Shadow</label>
        </div>
        <div class="ve-grid-2">
          ${colorField('Text colour', 'text.color', text.color)}
          ${colorField('Background', 'text.bgColor', text.bgColor)}
          ${numberField('Background opacity', 'text.bgOpacity', Math.round((text.bgOpacity || 0) * 100), { min: 0, max: 100, step: 1, suffix: '%' })}
          ${colorField('Outline colour', 'text.outlineColor', text.outlineColor)}
          ${numberField('Outline width', 'text.outlineWidth', text.outlineWidth || 0, { min: 0, max: 20, step: 1, suffix: 'px' })}
          ${numberField('Max width', 'text.maxWidth', Math.round((text.maxWidth ?? 0.9) * 100), { min: 10, max: 100, step: 1, suffix: '%' })}
        </div>
        <p class="ve-micro">Shaping uses the selected system font stack. Emoji and RTL scripts render with the browser's shaping engine and reach the exported frames.</p>
      `, true, 'Shaping');
    }

    if (clip.kind === 'shape') {
      const shape = clip.shape || {};
      html += section('Shape', `
        <div class="ve-grid-2">
          ${selectField('Type', 'shape.type', shape.type, optionList([{ id: 'rect', label: 'Rectangle' }, { id: 'circle', label: 'Circle' }, { id: 'line', label: 'Line' }, { id: 'arrow', label: 'Arrow' }], shape.type))}
          ${numberField('Width', 'shape.width', Math.round((shape.width ?? 0.45) * 100), { min: 1, max: 100, step: 1, suffix: '%' })}
          ${numberField('Height', 'shape.height', Math.round((shape.height ?? 0.3) * 100), { min: 1, max: 100, step: 1, suffix: '%' })}
          ${numberField('Corner radius', 'shape.radius', shape.radius || 0, { min: 0, max: 200, step: 1, suffix: 'px' })}
        </div>
        <div class="ve-grid-2">
          ${colorField('Fill', 'shape.fill', shape.fill)}
          ${colorField('Stroke', 'shape.stroke', shape.stroke)}
          ${numberField('Stroke width', 'shape.strokeWidth', shape.strokeWidth || 0, { min: 0, max: 40, step: 1, suffix: 'px' })}
        </div>
      `, false);
    }

    if (clip.kind === 'background') {
      const background = clip.background || {};
      html += section('Background', `
        ${selectField('Style', 'background.type', background.type, optionList([{ id: 'solid', label: 'Solid colour' }, { id: 'gradient', label: 'Gradient' }], background.type))}
        <div class="ve-grid-2">${colorField('Colour 1', 'background.color1', background.color1)}${colorField('Colour 2', 'background.color2', background.color2)}</div>
        ${numberField('Gradient angle', 'background.angle', background.angle || 135, { min: 0, max: 360, step: 1, suffix: '°' })}
      `, false);
    }

    if (isVisual) {
      const filterOptions = optionList(FILTERS.map((item) => ({ id: item.id, label: item.label })), clip.filter || 'none');
      const transitionOptions = '<option value="none">None</option>' + TRANSITION_GROUPS.map((group) =>
        `<optgroup label="${escapeHtml(group.label)}">${group.items.map(([id, label]) => `<option value="${escapeHtml(id)}" ${id === clip.transition?.type ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</optgroup>`
      ).join('');
      const fadeOptions = optionList(ANIMATIONS, clip.inAnim?.type || 'none');
      const outOptions = optionList(ANIMATIONS, clip.outAnim?.type || 'none');
      html += section('Effects', `
        <div class="ve-grid-2">
          ${selectField('Filter', 'filter', clip.filter || 'none', filterOptions)}
          ${numberField('Filter strength', 'filterIntensity', Math.round((clip.filterIntensity ?? 1) * 100), { min: 0, max: 100, step: 1, suffix: '%' })}
        </div>
        <div class="ve-preset-chips">
          ${COLOR_PRESETS.map((preset) => `<button type="button" class="ve-chip" data-inspector-action="color-preset" data-preset="${preset.id}">${escapeHtml(preset.label)}</button>`).join('')}
          <button type="button" class="ve-chip" data-inspector-action="reset-color">Reset colour</button>
        </div>
        <div class="ve-grid-2">
          ${selectField('Transition in', 'transition.type', clip.transition?.type || 'none', transitionOptions)}
          ${numberField('Transition seconds', 'transition.duration', clip.transition?.duration || 0.5, { min: 0.1, max: 5, step: 0.1, suffix: 's' })}
        </div>
        ${toggleField('Reverse transition', 'transition.reverse', clip.transition?.reverse || false)}
        <div class="ve-grid-2">
          ${selectField('Animate in', 'inAnim.type', clip.inAnim?.type || 'none', fadeOptions)}
          ${numberField('In duration', 'inAnim.duration', clip.inAnim?.duration || 0.5, { min: 0.1, max: 5, step: 0.1, suffix: 's' })}
          ${selectField('Animate out', 'outAnim.type', clip.outAnim?.type || 'none', outOptions)}
          ${numberField('Out duration', 'outAnim.duration', clip.outAnim?.duration || 0.5, { min: 0.1, max: 5, step: 0.1, suffix: 's' })}
        </div>
      `, false);
    }

    if (isMedia) {
      const color = { ...defaultColor(), ...(clip.color || {}) };
      html += section('Adjust', `
        <div class="ve-grid-2">
          ${rangeField('Brightness', 'color.brightness', color.brightness, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Contrast', 'color.contrast', color.contrast, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Saturation', 'color.saturation', color.saturation, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Exposure', 'color.exposure', color.exposure, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Temperature', 'color.temperature', color.temperature, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Tint', 'color.tint', color.tint, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Highlights', 'color.highlights', color.highlights, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Shadows', 'color.shadows', color.shadows, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Gamma', 'color.gamma', color.gamma, { min: -100, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Sharpness', 'color.sharpness', color.sharpness, { min: 0, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Vignette', 'color.vignette', color.vignette, { min: 0, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
          ${rangeField('Fade', 'color.fade', color.fade, { min: 0, max: 100, step: 1, format: (v) => `${Math.round(v)}` })}
        </div>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="reset-color">Reset all adjustments</button>
      `, false);
    }

    if (isAudio) {
      html += section('Audio', `
        ${rangeField('Clip volume', 'volume', clip.volume ?? 1, { min: 0, max: 1.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%` })}
        ${toggleField('Mute this clip', 'muted', clip.muted)}
        <div class="ve-grid-2">
          ${numberField('Fade in', 'fadeIn', clip.fadeIn || 0, { min: 0, max: 60, step: 0.05, suffix: 's' })}
          ${numberField('Fade out', 'fadeOut', clip.fadeOut || 0, { min: 0, max: 60, step: 0.05, suffix: 's' })}
        </div>
        <p class="ve-micro">Preview monitoring and the export mixer apply clip gain, track gain, master gain and both fades. Speed changes resample audio and change pitch.</p>
      `, false, 'Mix');
    }

    this.root.innerHTML = html;
  }

  subtitlePanel(item) {
    const style = this.store.project.subtitles.style;
    return `<div class="ve-inspector-title">
      <span class="ve-kind-chip ve-kind-text">CC</span>
      <div><h2>Subtitle cue</h2><p>${formatTime(item.start)} → ${formatTime(item.end)}</p></div>
      <button type="button" class="ve-icon-btn" data-inspector-action="close" aria-label="Clear selection">×</button>
    </div>
    ${section('Cue', `
      <label class="ve-field"><span>Text</span><textarea data-subtitle-prop="text" rows="4" maxlength="4000">${escapeHtml(item.text)}</textarea></label>
      <div class="ve-grid-2">
        ${numberField('Start', 'subtitle.start', item.start, { min: 0, max: 86400, step: 0.05, suffix: 's' })}
        ${numberField('End', 'subtitle.end', item.end, { min: 0, max: 86400, step: 0.05, suffix: 's' })}
      </div>
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="duplicate-subtitle">Duplicate</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-inspector-action="delete-subtitle">Delete</button>
      </div>
    `, true, 'Timed')}
    ${section('Subtitle style', `
      <div class="ve-grid-2">
        ${selectField('Font', 'subtitleStyle.font', style.font, optionList(FONT_OPTIONS, style.font))}
        ${numberField('Size', 'subtitleStyle.size', style.size, { min: 8, max: 200, step: 1, suffix: 'px' })}
        ${selectField('Alignment', 'subtitleStyle.align', style.align, optionList([{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }], style.align))}
        ${numberField('Vertical position', 'subtitleStyle.position', Math.round(style.position * 100), { min: 2, max: 98, step: 1, suffix: '%' })}
        ${colorField('Text colour', 'subtitleStyle.color', style.color)}
        ${colorField('Background colour', 'subtitleStyle.bgColor', style.bgColor)}
        ${numberField('Background opacity', 'subtitleStyle.bgOpacity', Math.round(style.bgOpacity * 100), { min: 0, max: 100, step: 1, suffix: '%' })}
        ${colorField('Outline colour', 'subtitleStyle.outlineColor', style.outlineColor)}
        ${numberField('Outline width', 'subtitleStyle.outlineWidth', style.outlineWidth || 0, { min: 0, max: 20, step: 1, suffix: 'px' })}
      </div>
      ${toggleField('Bold', 'subtitleStyle.bold', style.bold)}
      <p class="ve-micro">Style changes apply to every cue and burn into the exported frames.</p>
    `, false)}
  `;
  }

  emptyPanel() {
    const project = this.store.project;
    const dims = projectDimensions(project);
    return `<div class="ve-inspector-empty">
      <span class="ve-empty-icon" aria-hidden="true">◇</span>
      <h2>Nothing selected</h2>
      <p>Select a clip in the timeline or click an element in the preview to edit its transform, timing, style and effects.</p>
      <dl class="ve-project-facts">
        <div><dt>Canvas</dt><dd>${dims.width}×${dims.height}</dd></div>
        <div><dt>Duration</dt><dd>${formatTime(projectDuration(project))}</dd></div>
        <div><dt>Frame rate</dt><dd>${project.fps} fps</dd></div>
        <div><dt>Master audio</dt><dd>${Math.round((project.masterVolume ?? 1) * 100)}%</dd></div>
      </dl>
      <div class="ve-empty-tips">
        <p><kbd>Space</kbd> play or pause</p>
        <p><kbd>S</kbd> split at the playhead</p>
        <p><kbd>Ctrl</kbd> + <kbd>Z</kbd> undo</p>
        <p><kbd>Del</kbd> delete selection</p>
      </div>
    </div>`;
  }

  setPath(path, value, { live = true } = {}) {
    const found = this.primary();
    if (!found) return;
    if (live) {
      this.store.begin();
      this.store.apply((draft) => {
        const located = this.findInDraft(draft, found.clip.id);
        if (!located) return;
        setDeep(located.clip, path, value);
      }, { history: false, reason: 'inspector' });
      return;
    }
    this.store.apply((draft) => {
      const located = this.findInDraft(draft, found.clip.id);
      if (!located) return;
      setDeep(located.clip, path, value);
    }, { reason: 'inspector-change' });
  }

  findInDraft(project, clipId) {
    for (const track of project.tracks) {
      const clip = track.clips.find((item) => item.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }

  subtitlePath(path, value, live = true) {
    const item = this.subtitle();
    if (!item) return;
    if (live) this.store.begin();
    this.store.apply((draft) => {
      if (path.startsWith('subtitleStyle.')) {
        setDeep(draft.subtitles.style, path.slice('subtitleStyle.'.length), value);
      } else if (path === 'subtitle.start' || path === 'subtitle.end') {
        const cue = draft.subtitles.items.find((entry) => entry.id === item.id);
        if (cue) {
          const key = path.split('.')[1];
          cue[key] = Math.max(0, num(value));
          if (cue.end < cue.start + 0.2) cue[key === 'end' ? 'start' : 'end'] = cue[key] + (key === 'end' ? -0.2 : 0.2);
        }
      } else {
        const cue = draft.subtitles.items.find((entry) => entry.id === item.id);
        if (cue) cue.text = String(value).slice(0, 4000);
      }
    }, { history: !live, reason: 'subtitle-edit' });
  }

  parseValue(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'range' || input.type === 'number') return num(input.value);
    return input.value;
  }

  onInput(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
    const prop = input.dataset.prop;
    const textProp = input.dataset.textProp;
    const subProp = input.dataset.subtitleProp;
    const crop = input.dataset.crop;
    const output = input.closest('.ve-range-field')?.querySelector(`[data-output="${CSS.escape(prop || '')}"]`);
    if (output) {
      const format = output.textContent.includes('%') ? (v) => `${Math.round(v)}%` : (v) => `${Math.round(v)}`;
      output.textContent = format(num(input.value));
    }
    if (crop) {
      const found = this.primary();
      if (!found) return;
      this.store.begin();
      this.store.apply((draft) => {
        const located = this.findInDraft(draft, found.clip.id);
        if (located) located.clip.crop[crop] = clamp(num(input.value) / 100, 0, 0.45);
      }, { history: false, reason: 'crop' });
      return;
    }
    if (subProp) {
      this.subtitlePath('subtitle.text', input.value, true);
      return;
    }
    if (textProp === 'content') {
      this.setPath('text.content', input.value, true);
      return;
    }
    if (!prop) return;
    let value = this.parseValue(input);
    if (prop === 'x') value = value / Math.max(1, this.store.dimensions().width);
    else if (prop === 'y') value = value / Math.max(1, this.store.dimensions().height);
    else if (prop === 'scale') value = clamp(value / 100, 0.02, 12);
    else if (prop === 'filterIntensity' || prop === 'text.bgOpacity' || prop === 'subtitleStyle.bgOpacity') value = clamp(value / 100, 0, 1);
    else if (prop === 'text.maxWidth' || prop === 'subtitleStyle.position') value = clamp(value / 100, 0, 1);
    else if (prop === 'shape.width' || prop === 'shape.height') value = clamp(value / 100, 0.01, 2);
    else if (prop === 'start' || prop === 'duration' || prop === 'inPoint') {
      const found = this.primary();
      if (found) {
        const clip = found.clip;
        if (prop === 'duration') value = Math.max(0.1, value);
        if (prop === 'start') value = Math.max(0, value);
        if (prop === 'inPoint') value = Math.max(0, value);
      }
    }
    if (prop.startsWith('subtitleStyle.') || prop.startsWith('subtitle.')) {
      this.subtitlePath(prop, value, true);
      return;
    }
    this.setPath(prop, value, true);
  }

  onChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
    if (input.dataset.crop) {
      this.store.end('crop');
      return;
    }
    if (input.dataset.prop || input.dataset.textProp || input.dataset.subtitleProp) {
      this.store.end('inspector-change');
    }
  }

  onClick(event) {
    const button = event.target.closest('[data-inspector-action]');
    if (!button) return;
    const action = button.dataset.inspectorAction;
    const found = this.primary();
    if (action === 'close') {
      this.store.clearSelection();
      this.store.emit('selection');
      this.onEdit('selection');
      return;
    }
    if (action.startsWith('keyframe') || action === 'clear-keyframes') {
      this.keyframeAction(action, button.dataset.keyProp);
      return;
    }
    if (action === 'text-style') {
      if (!found) return;
      const style = button.dataset.style;
      this.setPath(`text.${style}`, !found.clip.text[style], false);
      return;
    }
    if (action === 'color-preset') {
      if (!found) return;
      const preset = COLOR_PRESETS.find((entry) => entry.id === button.dataset.preset);
      if (!preset) return;
      this.store.apply((draft) => {
        const located = this.findInDraft(draft, found.clip.id);
        if (located) located.clip.color = { ...defaultColor(), ...preset.values };
      }, { reason: 'color-preset' });
      return;
    }
    if (action === 'reset-color') {
      if (!found) return;
      this.store.apply((draft) => {
        const located = this.findInDraft(draft, found.clip.id);
        if (located) {
          located.clip.color = defaultColor();
          located.clip.filter = 'none';
          located.clip.filterIntensity = 1;
        }
      }, { reason: 'reset-color' });
      return;
    }
    if (action === 'fit-contain' || action === 'fit-cover') {
      if (!found) return;
      this.setPath('fit', action === 'fit-cover' ? 'cover' : 'contain', false);
      return;
    }
    if (action === 'flip-h' || action === 'flip-v') {
      if (!found) return;
      const key = action === 'flip-h' ? 'flipH' : 'flipV';
      this.setPath(key, !found.clip[key], false);
      return;
    }
    if (action === 'reset-transform') {
      if (!found) return;
      this.store.apply((draft) => {
        const located = this.findInDraft(draft, found.clip.id);
        if (!located) return;
        Object.assign(located.clip, {
          x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false,
          crop: { top: 0, right: 0, bottom: 0, left: 0 }
        });
      }, { reason: 'reset-transform' });
      return;
    }
    if (action === 'split-clip') this.onAction('split');
    if (action === 'duplicate-clip') this.onAction('duplicate');
    if (action === 'delete-clip') this.onAction('delete');
    if (action === 'duplicate-subtitle') this.onAction('duplicate-subtitle');
    if (action === 'delete-subtitle') this.onAction('delete-subtitle');
  }

  keyframeAction(action, prop) {
    const found = this.primary();
    if (!found) return;
    if (action === 'clear-keyframes') {
      this.store.apply((draft) => {
        const located = this.findInDraft(draft, found.clip.id);
        if (located) {
          for (const key of Object.keys(located.clip.keyframes)) located.clip.keyframes[key] = [];
        }
      }, { reason: 'clear-keyframes' });
      return;
    }
    if (!prop) return;
    const clip = found.clip;
    const local = clamp(this.store.playhead - clip.start, 0, clip.duration);
    let base = 0;
    if (prop === 'x') base = clip.x ?? 0.5;
    else if (prop === 'y') base = clip.y ?? 0.5;
    else if (prop === 'scale') base = clip.scale ?? 1;
    else if (prop === 'rotation') base = clip.rotation ?? 0;
    else base = clip.opacity ?? 1;
    this.store.apply((draft) => {
      const located = this.findInDraft(draft, found.clip.id);
      if (!located) return;
      const list = located.clip.keyframes[prop] || (located.clip.keyframes[prop] = []);
      const existing = list.find((entry) => Math.abs(entry.t - local) < 0.015);
      if (existing) existing.v = base;
      else {
        list.push({ t: local, v: base, ease: 'linear' });
        list.sort((a, b) => a.t - b.t);
      }
    }, { reason: 'keyframe' });
    this.onStatus(`Keyframe added at ${formatTime(local)}.`, 'success');
  }
}

function setDeep(target, path, value) {
  if (!target) return;
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}
