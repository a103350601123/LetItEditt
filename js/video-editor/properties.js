/* LetitEdit Professional Video Editor — properties panel markup. */

import { clamp, escapeHtml, formatBytes, formatClock } from './utils.js';
import {
  FONT_OPTIONS,
  clipEnd,
  previousClip,
  projectDimensions,
  projectDuration
} from './model.js';
import {
  FILTERS,
  TRANSITION_GROUPS,
  filterLabel,
  transitionLabel
} from './effects.js';
import { ANIMATIONS } from './presets.js';

const COLOR_CONTROLS = [
  ['brightness', 'Brightness', -100, 100],
  ['contrast', 'Contrast', -100, 100],
  ['saturation', 'Saturation', -100, 100],
  ['temperature', 'Temperature', -100, 100],
  ['tint', 'Tint', -100, 100],
  ['exposure', 'Exposure', -100, 100],
  ['highlights', 'Highlights', -100, 100],
  ['shadows', 'Shadows', -100, 100],
  ['gamma', 'Gamma', -100, 100],
  ['sharpness', 'Sharpness', 0, 100],
  ['fade', 'Fade', 0, 100],
  ['vignette', 'Vignette', 0, 100]
];

const TRANSFORM_KEYS = [
  ['x', 'Position X'],
  ['y', 'Position Y'],
  ['scale', 'Scale'],
  ['rotation', 'Rotation'],
  ['opacity', 'Opacity']
];

function findSelected(project, selection) {
  const found = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (selection.has(clip.id)) found.push({ track, clip });
    }
  }
  return found;
}

function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rangeField(label, prop, value, min, max, step, suffix = '', extra = '') {
  return `
    <label class="ve-field">
      <span>${label} <output data-suffix="${suffix}">${value}${suffix}</output></span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-prop="${prop}" ${extra}>
    </label>
  `;
}

function numberField(label, prop, value, min, max, step, extra = '') {
  return `
    <label class="ve-field">
      <span>${label}</span>
      <input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-prop="${prop}" ${extra}>
    </label>
  `;
}

function colorField(label, prop, value) {
  return `
    <label class="ve-field ve-field-color">
      <span>${label}</span>
      <input type="color" value="${attr(value)}" data-prop="${prop}">
    </label>
  `;
}

function checkField(label, prop, checked, extra = '') {
  return `<label class="ve-check"><input type="checkbox" data-prop="${prop}" ${checked ? 'checked' : ''} ${extra}> ${label}</label>`;
}

function selectField(label, prop, value, options, extra = '') {
  return `
    <label class="ve-field">
      <span>${label}</span>
      <select data-prop="${prop}" ${extra}>
        ${options.map((option) => `<option value="${attr(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

function typeLabel(kind) {
  if (kind === 'video') return 'Video';
  if (kind === 'image') return 'Image';
  if (kind === 'text') return 'Text';
  if (kind === 'audio') return 'Audio';
  if (kind === 'shape') return 'Shape';
  if (kind === 'background') return 'Background';
  return kind;
}

function propHeader(track, clip, project) {
  const tracks = project.tracks
    .filter((item) => item.kind === (clip.kind === 'audio' ? 'audio' : 'video'))
    .map((item) => `<option value="${item.id}" ${item.id === track.id ? 'selected' : ''} ${item.locked ? 'disabled' : ''}>${escapeHtml(item.name)}${item.locked ? ' (locked)' : ''}</option>`)
    .join('');
  return `
    <div class="ve-prop-heading">
      <span class="ve-kind-badge kind-${clip.kind}">${typeLabel(clip.kind)}</span>
      <h3>${escapeHtml(clip.name || typeLabel(clip.kind))}</h3>
    </div>
    <label class="ve-field">
      <span>Layer name</span>
      <input type="text" maxlength="80" value="${attr(clip.name || '')}" data-prop="name" autocomplete="off">
    </label>
    ${clip.locked ? '<p class="ve-alert ve-alert-warn">This clip is locked. Unlock it to edit its properties.</p>' : ''}
    <label class="ve-field">
      <span>Visual track</span>
      <select data-clip-track ${clip.locked ? 'disabled' : ''}>${tracks}</select>
    </label>
    <div class="ve-btn-row">
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="split">Split</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="duplicate">Duplicate</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="layer-up" ${clip.kind === 'audio' ? 'disabled' : ''}>Layer ↑</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="layer-down" ${clip.kind === 'audio' ? 'disabled' : ''}>Layer ↓</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="toggle-hide">${clip.hidden ? 'Show' : 'Hide'}</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="toggle-lock">${clip.locked ? 'Unlock' : 'Lock'}</button>
      <button type="button" class="ve-btn ve-btn-danger ve-btn-xs" data-prop-action="delete">Delete</button>
    </div>
  `;
}

function timingSection(track, clip) {
  return `
    <section class="ve-prop-section">
      <h3>Timing</h3>
      <div class="ve-prop-grid">
        <label class="ve-field">
          <span>Start (s)</span>
          <input type="number" min="0" step="0.05" value="${clip.start.toFixed(2)}" data-timing="start">
        </label>
        <label class="ve-field">
          <span>Duration (s)</span>
          <input type="number" min="0.2" step="0.05" value="${clip.duration.toFixed(2)}" data-timing="duration">
        </label>
      </div>
      <p class="ve-small">Ends at ${formatClock(clipEnd(clip))} on ${escapeHtml(track.name)}. ${clip.mediaId ? 'Source in/out points follow trims.' : ''}</p>
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-nudge="start" data-delta="-1">Start −1 s</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-nudge="start" data-delta="-0.1">Start −0.1</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-nudge="start" data-delta="0.1">Start +0.1</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-nudge="start" data-delta="1">Start +1 s</button>
      </div>
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-nudge="duration" data-delta="-0.5">Shorter 0.5</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-nudge="duration" data-delta="0.5">Longer 0.5</button>
      </div>
    </section>
  `;
}

function transformSection(track, clip, playhead) {
  const active = playhead >= clip.start - 1e-6 && playhead < clipEnd(clip) + 1e-6;
  return `
    <section class="ve-prop-section">
      <h3>Transform</h3>
      ${rangeField('Position X', 'x', num(clip.x, 0.5).toFixed(3), 0, 1, 0.001)}
      ${rangeField('Position Y', 'y', num(clip.y, 0.5).toFixed(3), 0, 1, 0.001)}
      ${rangeField('Scale', 'scale', num(clip.scale, 1).toFixed(2), 0.05, 4, 0.01)}
      ${rangeField('Rotation', 'rotation', Math.round(num(clip.rotation, 0)), -180, 180, 1, '°')}
      ${rangeField('Opacity', 'opacity', num(clip.opacity, 1).toFixed(2), 0, 1, 0.01)}
      <div class="ve-check-row">
        ${checkField('Flip horizontal', 'flipH', clip.flipH)}
        ${checkField('Flip vertical', 'flipV', clip.flipV)}
      </div>
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="reset-transform">Reset transform</button>
        <span class="ve-small">Local time ${active ? formatClock(playhead - clip.start) : 'outside clip'}</span>
      </div>
      <div class="ve-keyframes">
        <div class="ve-key-head">
          <strong>Keyframes</strong>
          <label class="ve-inline-select"><span class="visually-hidden">New keyframe easing</span>
            <select data-key-ease>
              <option value="linear">Linear</option>
              <option value="easeIn">Ease in</option>
              <option value="easeOut">Ease out</option>
              <option value="easeInOut">Ease in-out</option>
            </select>
          </label>
        </div>
        ${TRANSFORM_KEYS.map(([key, label]) => {
          const keys = (clip.keyframes && clip.keyframes[key]) || [];
          return `
            <div class="ve-key-row">
              <span>${label}</span>
              <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-keyframe="${key}" ${active && !clip.locked ? '' : 'disabled'} title="Add or replace a keyframe at the playhead">◆ Key</button>
              <span class="ve-small">${keys.length} key${keys.length === 1 ? '' : 's'}</span>
              ${keys.length ? `<button type="button" class="ve-icon-btn" data-keyframe-clear="${key}" aria-label="Clear ${label} keyframes">✕</button>` : ''}
            </div>
          `;
        }).join('')}
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="clear-keys">Clear all keyframes</button>
      </div>
    </section>
  `;
}

function mediaSection(clip, media, playhead) {
  const asset = clip.mediaId ? media.get(clip.mediaId) : null;
  const isMedia = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio';
  if (!isMedia) return '';
  const info = asset
    ? `<p class="ve-small">${escapeHtml(asset.name)} · ${asset.type === 'image' ? `${asset.width}×${asset.height}` : `${formatClock(asset.duration)} source`} · ${formatBytes(asset.size)}</p>`
    : `<p class="ve-alert ve-alert-warn">The source media for this clip is not loaded. Re-import ${escapeHtml(clip.name || 'the file')} to restore it.</p>`;
  const canSpeed = clip.kind === 'video' || clip.kind === 'audio';
  const freeze = clip.kind === 'video';
  return `
    <section class="ve-prop-section">
      <h3>Source</h3>
      ${info}
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="replace">Replace media</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="unlink" ${clip.mediaId ? '' : 'disabled'}>Unlink media</button>
        ${freeze ? `<button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="${clip.freeze ? 'unfreeze' : 'freeze'}">${clip.freeze ? 'Unfreeze' : 'Freeze frame'}</button>` : ''}
      </div>
      ${clip.freeze ? `<p class="ve-small">Frozen at source ${formatClock(clip.freezeAt || 0)}. Audio is muted while frozen.</p>` : ''}
      ${canSpeed ? `
        ${rangeField('Playback speed', 'speed', num(clip.speed, 1).toFixed(2), 0.1, 4, 0.05, '×', clip.freeze ? 'disabled' : '')}
        <div class="ve-check-row">
          ${checkField('Reverse playback', 'reverse', clip.reverse, clip.freeze ? 'disabled' : '')}
        </div>
        <p class="ve-small">Speed resamples audio, so pitch changes with speed. Pitch-preserving time stretching is not available in this build.</p>
      ` : ''}
      ${(clip.kind === 'image' || clip.kind === 'video') ? `
        ${selectField('Fit', 'fit', clip.fit || 'contain', [{ value: 'contain', label: 'Contain (show all)' }, { value: 'cover', label: 'Cover (fill frame)' }])}
      ` : ''}
    </section>
  `;
}

function cropSection(clip) {
  if (clip.kind !== 'image' && clip.kind !== 'video') return '';
  const crop = clip.crop || {};
  return `
    <section class="ve-prop-section">
      <h3>Crop</h3>
      ${rangeField('Crop top', 'crop.top', num(crop.top, 0).toFixed(2), 0, 0.45, 0.01)}
      ${rangeField('Crop bottom', 'crop.bottom', num(crop.bottom, 0).toFixed(2), 0, 0.45, 0.01)}
      ${rangeField('Crop left', 'crop.left', num(crop.left, 0).toFixed(2), 0, 0.45, 0.01)}
      ${rangeField('Crop right', 'crop.right', num(crop.right, 0).toFixed(2), 0, 0.45, 0.01)}
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="reset-crop">Reset crop</button>
    </section>
  `;
}

function textSection(clip) {
  if (clip.kind !== 'text') return '';
  const text = clip.text || {};
  return `
    <section class="ve-prop-section">
      <h3>Text</h3>
      <label class="ve-field">
        <span>Content</span>
        <textarea rows="4" data-prop="text.content" dir="auto" spellcheck="false">${escapeHtml(text.content || '')}</textarea>
      </label>
      ${selectField('Font stack', 'text.font', text.font || 'sans', FONT_OPTIONS.map((font) => ({ value: font.id, label: font.label })))}
      ${numberField('Font size', 'text.size', Math.round(num(text.size, 72)), 8, 320, 1)}
      <div class="ve-check-row">
        ${checkField('Bold', 'text.bold', text.bold)}
        ${checkField('Italic', 'text.italic', text.italic)}
        ${checkField('Underline', 'text.underline', text.underline)}
        ${checkField('Shadow', 'text.shadow', text.shadow)}
      </div>
      ${selectField('Alignment', 'text.align', text.align || 'center', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }])}
      ${selectField('Direction', 'text.direction', text.direction || 'auto', [{ value: 'auto', label: 'Auto (detect RTL)' }, { value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }])}
      ${rangeField('Letter spacing', 'text.letterSpacing', num(text.letterSpacing, 0), -5, 30, 1, ' px')}
      ${rangeField('Line spacing', 'text.lineHeight', num(text.lineHeight, 1.25).toFixed(2), 0.8, 2.5, 0.05)}
      ${rangeField('Text box width', 'text.maxWidth', num(text.maxWidth, 0.9).toFixed(2), 0.1, 0.98, 0.01)}
      <div class="ve-prop-grid">
        ${colorField('Text colour', 'text.color', text.color || '#ffffff')}
        ${colorField('Background', 'text.bgColor', text.bgColor || '#0f172a')}
      </div>
      ${rangeField('Background opacity', 'text.bgOpacity', num(text.bgOpacity, 0).toFixed(2), 0, 1, 0.01)}
      ${rangeField('Outline width', 'text.outlineWidth', num(text.outlineWidth, 0).toFixed(1), 0, 12, 0.5, ' px')}
      ${colorField('Outline colour', 'text.outlineColor', text.outlineColor || '#000000')}
      <p class="ve-small">Unicode is shaped by the browser. Arabic, Urdu, Persian, Hindi, Bengali, Chinese, Japanese, Korean and Cyrillic render in the preview and export with the selected system font stack.</p>
    </section>
  `;
}

function shapeSection(clip) {
  if (clip.kind !== 'shape') return '';
  const shape = clip.shape || {};
  return `
    <section class="ve-prop-section">
      <h3>Shape</h3>
      ${selectField('Shape type', 'shape.type', shape.type || 'rect', [
        { value: 'rect', label: 'Rectangle' },
        { value: 'circle', label: 'Circle / ellipse' },
        { value: 'line', label: 'Line' },
        { value: 'arrow', label: 'Arrow' }
      ])}
      <div class="ve-prop-grid">
        ${colorField('Fill', 'shape.fill', shape.fill || '#2563eb')}
        ${colorField('Outline', 'shape.stroke', shape.stroke || '#ffffff')}
      </div>
      ${rangeField('Width', 'shape.width', num(shape.width, 0.45).toFixed(2), 0.02, 1.5, 0.01)}
      ${rangeField('Height', 'shape.height', num(shape.height, 0.3).toFixed(2), 0.01, 1.5, 0.01)}
      ${rangeField('Outline width', 'shape.strokeWidth', num(shape.strokeWidth, 0).toFixed(1), 0, 20, 0.5, ' px')}
      ${rangeField('Corner radius', 'shape.radius', Math.round(num(shape.radius, 16)), 0, 120, 1, ' px')}
    </section>
  `;
}

function backgroundSection(clip) {
  if (clip.kind !== 'background') return '';
  const background = clip.background || {};
  return `
    <section class="ve-prop-section">
      <h3>Background</h3>
      ${selectField('Type', 'background.type', background.type || 'solid', [{ value: 'solid', label: 'Solid colour' }, { value: 'gradient', label: 'Gradient' }])}
      <div class="ve-prop-grid">
        ${colorField('Colour 1', 'background.color1', background.color1 || '#0f172a')}
        ${colorField('Colour 2', 'background.color2', background.color2 || '#2563eb')}
      </div>
      ${rangeField('Gradient angle', 'background.angle', Math.round(num(background.angle, 135)), 0, 360, 1, '°')}
    </section>
  `;
}

function effectsSections(clip) {
  if (clip.kind !== 'video' && clip.kind !== 'image') return '';
  const color = clip.color || {};
  return `
    <section class="ve-prop-section">
      <h3>Filter</h3>
      ${selectField('Look', 'filter', clip.filter || 'none', FILTERS.map((filter) => ({ value: filter.id, label: filter.label })))}
      ${rangeField('Filter intensity', 'filterIntensity', num(clip.filterIntensity, 1).toFixed(2), 0, 1, 0.01)}
      <p class="ve-small">Current look: ${escapeHtml(filterLabel(clip.filter))}</p>
    </section>
    <section class="ve-prop-section">
      <h3>Colour correction</h3>
      ${COLOR_CONTROLS.map(([key, label, min, max]) => rangeField(label, `color.${key}`, Math.round(num(color[key], 0)), min, max, 1)).join('')}
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-prop-action="reset-color">Reset colour correction</button>
    </section>
  `;
}

function audioSection(clip, track) {
  if (clip.kind !== 'audio' && clip.kind !== 'video') return '';
  return `
    <section class="ve-prop-section">
      <h3>Audio mix</h3>
      ${rangeField('Clip gain', 'volume', num(clip.volume, 1).toFixed(2), 0, 1.5, 0.01, '×')}
      <div class="ve-check-row">${checkField('Mute clip audio', 'muted', clip.muted)}</div>
      ${rangeField('Fade in', 'fadeIn', num(clip.fadeIn, 0).toFixed(2), 0, Math.min(5, clip.duration), 0.05, ' s')}
      ${rangeField('Fade out', 'fadeOut', num(clip.fadeOut, 0).toFixed(2), 0, Math.min(5, clip.duration), 0.05, ' s')}
      <p class="ve-small">Track “${escapeHtml(track.name)}” volume is set on the timeline or in the Audio tab. Master volume is in the project panel.</p>
    </section>
  `;
}

function transitionSection(track, clip) {
  if (track.kind !== 'video') return '';
  const prev = previousClip(track, clip);
  const transition = clip.transition || { type: 'none', duration: 0.5, reverse: false };
  const maxDuration = prev ? Math.max(0.1, Math.min(5, prev.duration, clip.duration)) : 5;
  const options = TRANSITION_GROUPS.map((group) => `
    <optgroup label="${escapeHtml(group.label)}">
      ${group.items.map(([id, label]) => `<option value="${id}" ${transition.type === id ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
    </optgroup>
  `).join('');
  return `
    <section class="ve-prop-section">
      <h3>Transition</h3>
      ${prev ? '' : '<p class="ve-alert ve-alert-info">Transitions blend with the previous clip on this track. Add an earlier clip to enable one.</p>'}
      <label class="ve-field">
        <span>Type</span>
        <select data-prop="transition.type" ${prev ? '' : 'disabled'}>
          <option value="none" ${transition.type === 'none' ? 'selected' : ''}>None</option>
          ${options}
        </select>
      </label>
      ${rangeField('Duration', 'transition.duration', Math.min(num(transition.duration, 0.5), maxDuration).toFixed(2), 0.1, maxDuration, 0.05, ' s', prev ? '' : 'disabled')}
      <div class="ve-check-row">${checkField('Reverse direction', 'transition.reverse', transition.reverse, transition.type === 'none' ? 'disabled' : '')}</div>
      <p class="ve-small">${transition.type === 'none' ? 'No transition.' : `${escapeHtml(transitionLabel(transition.type))} blends the outgoing tail of the previous clip into this clip.`}</p>
    </section>
  `;
}

function animationSection(clip) {
  if (clip.kind === 'audio' || clip.kind === 'background') return '';
  const inAnim = clip.inAnim || { type: 'none', duration: 0.5 };
  const outAnim = clip.outAnim || { type: 'none', duration: 0.5 };
  return `
    <section class="ve-prop-section">
      <h3>Entrance and exit</h3>
      ${selectField('Entrance', 'inAnim.type', inAnim.type, ANIMATIONS.map((item) => ({ value: item.id, label: item.label })))}
      ${rangeField('Entrance length', 'inAnim.duration', num(inAnim.duration, 0.5).toFixed(2), 0.1, Math.min(5, clip.duration), 0.05, ' s')}
      ${selectField('Exit', 'outAnim.type', outAnim.type, ANIMATIONS.map((item) => ({ value: item.id, label: item.label })))}
      ${rangeField('Exit length', 'outAnim.duration', num(outAnim.duration, 0.5).toFixed(2), 0.1, Math.min(5, clip.duration), 0.05, ' s')}
    </section>
  `;
}

function projectPanel(project, media, selection) {
  const assets = media.list();
  const bytes = assets.reduce((sum, asset) => sum + (asset.size || 0), 0);
  const clips = project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  const dimensions = projectDimensions(project);
  const missing = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.mediaId && !media.has(clip.mediaId)) missing.push(clip.name || 'clip');
    }
  }
  return `
    <section class="ve-prop-section">
      <h3>Project</h3>
      <label class="ve-field">
        <span>Project name</span>
        <input type="text" maxlength="80" value="${attr(project.name)}" data-project-prop="name">
      </label>
      <div class="ve-prop-grid">
        ${selectField('Aspect ratio', 'aspect', project.aspect, [
          { value: '16:9', label: '16:9 landscape' },
          { value: '9:16', label: '9:16 portrait' },
          { value: '1:1', label: '1:1 square' },
          { value: '4:5', label: '4:5 portrait' },
          { value: '4:3', label: '4:3 classic' },
          { value: '3:2', label: '3:2 photo' },
          { value: 'custom', label: 'Custom' }
        ]).replace('data-prop="aspect"', 'data-project-prop="aspect"')}
        ${selectField('Resolution', 'resolution', project.resolution, [
          { value: '2160', label: '4K · 2160p' },
          { value: '1440', label: '1440p' },
          { value: '1080', label: '1080p' },
          { value: '720', label: '720p' },
          { value: '480', label: '480p' },
          { value: '360', label: '360p' },
          { value: 'custom', label: 'Custom' }
        ]).replace('data-prop="resolution"', 'data-project-prop="resolution"')}
      </div>
      ${project.aspect === 'custom' ? `
        <div class="ve-prop-grid">
          <label class="ve-field"><span>Aspect width</span><input type="number" min="1" max="100" step="1" value="${project.customAspectW}" data-project-prop="customAspectW"></label>
          <label class="ve-field"><span>Aspect height</span><input type="number" min="1" max="100" step="1" value="${project.customAspectH}" data-project-prop="customAspectH"></label>
        </div>
      ` : ''}
      ${project.resolution === 'custom' ? `
        <div class="ve-prop-grid">
          <label class="ve-field"><span>Width</span><input type="number" min="16" max="4096" step="2" value="${project.customWidth}" data-project-prop="customWidth"></label>
          <label class="ve-field"><span>Height</span><input type="number" min="16" max="4096" step="2" value="${project.customHeight}" data-project-prop="customHeight"></label>
        </div>
      ` : ''}
      <div class="ve-prop-grid">
        ${selectField('Frame rate', 'fps', project.fps, [
          { value: 24, label: '24 fps' },
          { value: 25, label: '25 fps' },
          { value: 30, label: '30 fps' },
          { value: 50, label: '50 fps' },
          { value: 60, label: '60 fps' }
        ]).replace('data-prop="fps"', 'data-project-prop="fps"')}
        ${colorField('Canvas background', 'background', project.background || '#000000').replace('data-prop="background"', 'data-project-prop="background"')}
      </div>
      ${rangeField('Master volume', 'masterVolume', num(project.masterVolume, 1).toFixed(2), 0, 1.5, 0.01, '×').replace('data-prop="masterVolume"', 'data-project-prop="masterVolume"')}
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-project-action="dialog">Project settings</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-project-action="save">Save project file</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-project-action="open">Open project</button>
      </div>
    </section>
    <section class="ve-prop-section">
      <h3>Project summary</h3>
      <dl class="ve-stats">
        <div><dt>Duration</dt><dd>${formatClock(projectDuration(project))}</dd></div>
        <div><dt>Canvas</dt><dd>${dimensions.width}×${dimensions.height}</dd></div>
        <div><dt>Tracks</dt><dd>${project.tracks.length}</dd></div>
        <div><dt>Clips</dt><dd>${clips}</dd></div>
        <div><dt>Media</dt><dd>${assets.length} · ${formatBytes(bytes)}</dd></div>
        <div><dt>Selection</dt><dd>${selection.size}</dd></div>
      </dl>
      ${missing.length ? `<p class="ve-alert ve-alert-warn">${missing.length} clip${missing.length === 1 ? '' : 's'} reference media that is not loaded. Re-import the original files to restore the picture.</p>` : ''}
      <p class="ve-hint">Select a clip in the timeline to edit it. Use the tool tabs on the left to add text, audio, overlays, transitions, filters and subtitles.</p>
      <p class="ve-hint">Project JSON and autosave store the timeline only. Imported media is never persisted and must be re-imported after reloading the page.</p>
    </section>
  `;
}

function noSelection(project, media, selection) {
  return projectPanel(project, media, selection);
}

function multiSelection(locatedList) {
  return `
    <section class="ve-prop-section">
      <h3>${locatedList.length} clips selected</h3>
      <ul class="ve-list">
        ${locatedList.slice(0, 12).map(({ track, clip }) => `<li>${escapeHtml(clip.name || clip.kind)} <span class="ve-small">on ${escapeHtml(track.name)}</span></li>`).join('')}
        ${locatedList.length > 12 ? `<li>and ${locatedList.length - 12} more…</li>` : ''}
      </ul>
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-danger ve-btn-sm" data-prop-action="delete-many">Delete selected</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-prop-action="duplicate-many">Duplicate selected</button>
      </div>
      <p class="ve-hint">Select a single clip to edit its detailed properties. Filters and transitions apply to every selected compatible clip from the tool tabs.</p>
    </section>
  `;
}

export function renderProperties(context) {
  const { project, selection, playhead, media } = context;
  const located = findSelected(project, selection);
  if (!located.length) return noSelection(project, media, selection);
  if (located.length > 1) return multiSelection(located);
  const { track, clip } = located[0];

  const parts = [
    propHeader(track, clip, project),
    timingSection(track, clip)
  ];

  if (clip.kind === 'text') {
    parts.push(transformSection(track, clip, playhead));
    parts.push(textSection(clip));
  } else if (clip.kind === 'shape') {
    parts.push(transformSection(track, clip, playhead));
    parts.push(shapeSection(clip));
  } else if (clip.kind === 'background') {
    parts.push(backgroundSection(clip));
  } else {
    parts.push(transformSection(track, clip, playhead));
    parts.push(mediaSection(clip, media, playhead));
    parts.push(cropSection(clip));
    parts.push(effectsSections(clip));
  }

  if (clip.kind === 'audio' || clip.kind === 'video') parts.push(audioSection(clip, track));
  if (track.kind === 'video' && clip.kind !== 'audio') parts.push(transitionSection(track, clip));
  parts.push(animationSection(clip));

  return parts.join('');
}

export function renderProjectSettings(context) {
  return noSelection(context.project, context.media, context.selection);
}
