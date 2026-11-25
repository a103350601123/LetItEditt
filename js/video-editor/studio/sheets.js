/* LetitEdit Video Editor — editing sheets.
 *
 * Every panel here edits project data through the studio store. Nothing is a
 * mock control: sliders, keyframes, filters, transitions and export options
 * all change what the shared renderer draws and what the worker encodes.
 */

import { FILTERS, TRANSITIONS } from '../effects.js';
import { TEXT_PRESETS, SHAPE_TYPES, STICKERS, ANIMATIONS, COLOR_PRESETS } from '../presets.js';
import { FONT_OPTIONS, defaultText, defaultSubtitleStyle } from '../model.js';
import { keyframeValue } from '../renderer.js';
import { clamp, sanitizeFilename, parseSubtitleFile } from '../utils.js';
import {
  h,
  icon,
  field,
  note,
  setPressed,
  clock,
  durationLabel,
  clampNumber
} from './ui.js';

/* ------------------------------------------------------------------ helpers */

function seconds(value) {
  return `${(Number(value) || 0).toFixed(2)}s`;
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function rangeField(options) {
  const {
    label,
    min,
    max,
    step = 0.01,
    value,
    format = (v) => String(v),
    onInput,
    onCommit,
    disabled = false
  } = options;
  const output = h('output', { class: 'se-range-value', text: format(value) });
  const input = h('input', {
    type: 'range',
    class: 'se-range',
    min,
    max,
    step,
    value,
    disabled,
    'aria-label': label
  });
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = format(next);
    onInput?.(next);
  });
  input.addEventListener('change', () => onCommit?.(Number(input.value)));
  return field(label, h('div', { class: 'se-range-row' }, input, output));
}

function numberField(options) {
  const { label, min, max, step = 0.1, value, onChange, hint } = options;
  const input = h('input', {
    type: 'number',
    class: 'se-input',
    min,
    max,
    step,
    value: Number(value).toFixed(step < 0.1 ? 2 : 1)
  });
  input.addEventListener('change', () => {
    const next = clampNumber(input.value, min, max, value);
    input.value = String(next);
    onChange?.(next);
  });
  return field(label, input, hint);
}

function selectField(label, choices, value, onChange, hint) {
  const select = h('select', { class: 'se-select', 'aria-label': label });
  for (const choice of choices) {
    select.append(h('option', { value: choice.id, text: choice.label, selected: choice.id === value }));
  }
  select.addEventListener('change', () => onChange?.(select.value));
  return field(label, select, hint);
}

function colorField(label, value, onChange) {
  const input = h('input', { type: 'color', value: value || '#ffffff', 'aria-label': label });
  input.addEventListener('input', () => onChange?.(input.value));
  return field(label, h('div', { class: 'se-color-row' }, input));
}

function segment(options, value, onChange, label) {
  const wrap = h('div', { class: 'se-seg', role: 'group', 'aria-label': label || '' });
  for (const option of options) {
    const button = h('button', {
      type: 'button',
      text: option.label,
      'aria-pressed': option.id === value ? 'true' : 'false'
    });
    button.addEventListener('click', () => {
      for (const child of wrap.children) child.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      onChange?.(option.id);
    });
    wrap.append(button);
  }
  return wrap;
}

function chip(label, pressed, onClick, iconName) {
  const button = h('button', {
    type: 'button',
    class: 'se-chip',
    'aria-pressed': pressed ? 'true' : 'false',
    onclick: onClick
  });
  if (iconName) button.innerHTML = icon(iconName);
  button.append(document.createTextNode(label));
  return button;
}

function sectionLabel(text) {
  return h('h3', { class: 'se-section-label', text });
}

function targetLabel(app, clip) {
  if (!clip) return 'No layer selected';
  if (app.store.isBaseClip(clip)) return 'Main video';
  return clip.name || (clip.kind === 'text' ? 'Text' : clip.kind === 'audio' ? 'Audio' : 'Layer');
}

function visualTarget(app) {
  const selected = app.store.selected();
  if (selected && selected.track.kind === 'video') return selected.clip;
  const found = app.store.clipAtPlayhead(true);
  return found && found.track.kind === 'video' ? found.clip : null;
}

function audioTarget(app) {
  const selected = app.store.selected();
  if (selected && (selected.clip.kind === 'audio' || selected.clip.kind === 'video')) return selected.clip;
  return app.store.baseClipAt(app.store.playhead);
}

function assetFor(app, clip) {
  return clip && clip.mediaId ? app.media.get(clip.mediaId) : null;
}

function setSourceRange(clip, inPoint, outPoint) {
  const speed = Math.max(0.05, Number(clip.speed) || 1);
  clip.inPoint = inPoint;
  clip.outPoint = outPoint;
  clip.duration = Math.max(0.1, (outPoint - inPoint) / speed);
}

function motionPreset(clip, preset) {
  const duration = Math.max(0.4, clip.duration);
  clip.inAnim = { type: 'none', duration: 0.5 };
  clip.outAnim = { type: 'none', duration: 0.5 };
  if (preset === 'fade') {
    clip.inAnim = { type: 'fade', duration: Math.min(0.8, duration / 2) };
    clip.outAnim = { type: 'fade', duration: Math.min(0.6, duration / 2) };
  } else if (preset === 'slide-up') {
    clip.inAnim = { type: 'slide-up', duration: Math.min(0.7, duration / 2) };
  } else if (preset === 'zoom') {
    clip.inAnim = { type: 'zoom', duration: Math.min(0.7, duration / 2) };
  } else if (preset === 'pop') {
    clip.keyframes.scale = [
      { t: 0, v: 0.68, ease: 'easeOut' },
      { t: Math.min(0.35, duration / 2), v: 1.06, ease: 'easeInOut' },
      { t: Math.min(0.7, duration), v: 1, ease: 'linear' }
    ];
    clip.keyframes.opacity = [
      { t: 0, v: 0, ease: 'easeOut' },
      { t: Math.min(0.3, duration / 2), v: 1, ease: 'linear' }
    ];
  } else if (preset === 'kenburns') {
    clip.keyframes.scale = [
      { t: 0, v: 1, ease: 'linear' },
      { t: duration, v: 1.08, ease: 'linear' }
    ];
    clip.keyframes.x = [
      { t: 0, v: clip.x ?? 0.5, ease: 'linear' },
      { t: duration, v: (clip.x ?? 0.5) + 0.015, ease: 'linear' }
    ];
  } else if (preset === 'none') {
    clip.keyframes.scale = [];
    clip.keyframes.opacity = [];
    clip.keyframes.x = [];
    clip.keyframes.y = [];
    clip.keyframes.rotation = [];
  }
}

/* --------------------------------------------------------------- keyframes */

const KF_PROPS = {
  x: { label: 'Position X', min: -0.5, max: 1.5, step: 0.005, base: 0.5, format: (v) => v.toFixed(3) },
  y: { label: 'Position Y', min: -0.5, max: 1.5, step: 0.005, base: 0.5, format: (v) => v.toFixed(3) },
  scale: { label: 'Scale', min: 0.05, max: 4, step: 0.01, base: 1, format: (v) => `${Math.round(v * 100)}%` },
  rotation: { label: 'Rotation', min: -360, max: 360, step: 1, base: 0, format: (v) => `${Math.round(v)}°` },
  opacity: { label: 'Opacity', min: 0, max: 1, step: 0.01, base: 1, format: (v) => `${Math.round(v * 100)}%` },
  volume: { label: 'Volume', min: 0, max: 1, step: 0.01, base: 1, format: (v) => `${Math.round(v * 100)}%` }
};

function availableProps(clip) {
  if (clip.kind === 'audio') return ['volume'];
  if (clip.kind === 'video') return ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
  return ['x', 'y', 'scale', 'rotation', 'opacity'];
}

function keyframeEditor(app, clip) {
  const wrap = h('div', { class: 'se-kf-editor' });
  const props = availableProps(clip);
  let prop = props[0];

  const render = () => {
    wrap.textContent = '';
    const def = KF_PROPS[prop];
    const list = Array.isArray(clip.keyframes?.[prop]) ? clip.keyframes[prop] : [];

    const select = h('select', { class: 'se-select', 'aria-label': 'Keyframe property' });
    for (const id of props) select.append(h('option', { value: id, text: KF_PROPS[id].label, selected: id === prop }));
    select.addEventListener('change', () => {
      prop = select.value;
      render();
    });

    const add = h('button', {
      type: 'button',
      class: 'se-btn se-btn-sm',
      text: 'Add at playhead',
      onclick: () => {
        const local = clamp(app.store.playhead - clip.start, 0, Math.max(0, clip.duration));
        const value = keyframeValue(clip, prop, local, Number.isFinite(clip[prop]) ? clip[prop] : def.base);
        app.edit(() => {
          const target = clip.keyframes[prop] || (clip.keyframes[prop] = []);
          const existing = target.find((entry) => Math.abs(entry.t - local) < 0.02);
          if (existing) existing.v = value;
          else target.push({ t: local, v: value, ease: 'linear' });
          target.sort((a, b) => a.t - b.t);
        }, 'keyframe-add');
        app.toast(`Keyframe added for ${def.label}.`, 'ok');
        render();
      }
    });

    const bar = h('div', { class: 'se-kf-bar', 'aria-hidden': 'true' });
    if (clip.duration > 0) {
      for (const entry of list) {
        const diamond = h('span', {
          class: 'se-kf-diamond',
          dataset: { time: String(entry.t) },
          title: `${entry.t.toFixed(2)}s · ${def.format(entry.v)}`
        });
        diamond.style.left = `${clamp(entry.t / clip.duration, 0, 1) * 100}%`;
        diamond.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = bar.getBoundingClientRect();
          let moved = false;
          const startX = event.clientX;
          const move = (moveEvent) => {
            if (Math.abs(moveEvent.clientX - startX) > 1) moved = true;
            const t = clamp(((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * clip.duration, 0, clip.duration);
            entry.t = t;
            diamond.style.left = `${(t / clip.duration) * 100}%`;
            app.store.live(() => {});
            app.preview.seek(clip.start + t);
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            if (moved) app.commit('keyframe-retime');
            render();
          };
          app.store.begin();
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', up);
        });
        diamond.addEventListener('click', (event) => {
          event.stopPropagation();
          app.preview.seek(clip.start + entry.t);
        });
        bar.append(diamond);
      }
    }
    bar.addEventListener('click', (event) => {
      if (event.target !== bar) return;
      const rect = bar.getBoundingClientRect();
      const t = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * clip.duration, 0, clip.duration);
      app.preview.seek(clip.start + t);
    });

    const rows = h('div', { class: 'se-kf-list' });
    if (!list.length) {
      rows.append(note('No keyframes yet. Move the playhead, then add one. Presets such as Pop also create editable keyframes.'));
    }
    list.forEach((entry, index) => {
      const timeInput = h('input', {
        type: 'number',
        class: 'se-input',
        min: 0,
        max: clip.duration,
        step: 0.05,
        value: entry.t.toFixed(2),
        'aria-label': 'Keyframe time'
      });
      timeInput.addEventListener('change', () => {
        const t = clampNumber(timeInput.value, 0, clip.duration, entry.t);
        app.edit(() => {
          entry.t = t;
          list.sort((a, b) => a.t - b.t);
        }, 'keyframe-time');
        render();
      });

      const valueInput = h('input', {
        type: 'number',
        class: 'se-input',
        min: def.min,
        max: def.max,
        step: def.step,
        value: String(Number(entry.v).toFixed(3)),
        'aria-label': 'Keyframe value'
      });
      valueInput.addEventListener('change', () => {
        const value = clampNumber(valueInput.value, def.min, def.max, entry.v);
        app.edit(() => {
          entry.v = value;
        }, 'keyframe-value');
        render();
      });

      const easeSelect = h('select', { class: 'se-select', 'aria-label': 'Easing to the next keyframe', title: 'Easing applies from this keyframe to the next one' });
      for (const easing of [
        { id: 'linear', label: 'Linear' },
        { id: 'easeIn', label: 'Ease in' },
        { id: 'easeOut', label: 'Ease out' },
        { id: 'easeInOut', label: 'Ease in/out' }
      ]) {
        easeSelect.append(h('option', { value: easing.id, text: easing.label, selected: (entry.ease || 'linear') === easing.id }));
      }
      easeSelect.addEventListener('change', () => {
        app.edit(() => {
          entry.ease = easeSelect.value;
        }, 'keyframe-ease');
      });

      const jump = h('button', { type: 'button', html: icon('timer'), title: 'Go to keyframe', 'aria-label': 'Go to keyframe' });
      jump.addEventListener('click', () => app.preview.seek(clip.start + entry.t));

      const remove = h('button', { type: 'button', html: icon('trash'), title: 'Delete keyframe', 'aria-label': 'Delete keyframe' });
      remove.addEventListener('click', () => {
        app.edit(() => {
          const at = list.indexOf(entry);
          if (at !== -1) list.splice(at, 1);
        }, 'keyframe-delete');
        render();
      });

      rows.append(h('div', { class: 'se-kf-row' }, timeInput, valueInput, easeSelect, jump, remove));
    });

    wrap.append(
      h('div', { class: 'se-row', style: 'margin-bottom:8px' }, select, add),
      bar,
      rows,
      h('p', { class: 'se-field-note', text: 'Easing belongs to the starting keyframe of each segment. Keyframes are stored in the project and render in both preview and export.' })
    );
  };

  render();
  return wrap;
}

/* ---------------------------------------------------------------- motion */

function motionSection(app, clip) {
  const wrap = h('div');
  wrap.append(sectionLabel('Entrance and exit'));
  wrap.append(
    selectField('Entrance', ANIMATIONS, clip.inAnim?.type || 'none', (value) => {
      app.edit(() => {
        clip.inAnim = { type: value, duration: clip.inAnim?.duration || 0.5 };
      }, 'entrance');
    }),
    rangeField({
      label: 'Entrance duration',
      min: 0.1,
      max: 2.5,
      step: 0.05,
      value: clip.inAnim?.duration || 0.5,
      format: seconds,
      onInput: (value) => app.live(() => { clip.inAnim.duration = value; }),
      onCommit: () => app.commit('entrance-duration')
    }),
    selectField('Exit', ANIMATIONS, clip.outAnim?.type || 'none', (value) => {
      app.edit(() => {
        clip.outAnim = { type: value, duration: clip.outAnim?.duration || 0.5 };
      }, 'exit');
    }),
    rangeField({
      label: 'Exit duration',
      min: 0.1,
      max: 2.5,
      step: 0.05,
      value: clip.outAnim?.duration || 0.5,
      format: seconds,
      onInput: (value) => app.live(() => { clip.outAnim.duration = value; }),
      onCommit: () => app.commit('exit-duration')
    })
  );

  wrap.append(sectionLabel('Motion presets'));
  const presets = h('div', { class: 'se-chip-row' });
  for (const preset of [
    { id: 'none', label: 'Clear motion' },
    { id: 'fade', label: 'Fade' },
    { id: 'slide-up', label: 'Slide up' },
    { id: 'zoom', label: 'Zoom in' },
    { id: 'pop', label: 'Pop' },
    { id: 'kenburns', label: 'Slow zoom' }
  ]) {
    const button = chip(preset.label, false, () => {
      app.edit(() => motionPreset(clip, preset.id), 'motion-preset');
      app.toast(preset.id === 'none' ? 'Motion cleared.' : `${preset.label} applied. Edit the keyframes below.`, 'ok');
    });
    presets.append(button);
  }
  wrap.append(presets, h('p', { class: 'se-field-note', text: 'Presets write real animation and keyframe data, never CSS. You can retime or delete every value below.' }));
  wrap.append(sectionLabel('Keyframes'));
  wrap.append(keyframeEditor(app, clip));
  return wrap;
}

/* --------------------------------------------------------------- text sheet */

export function openTextSheet(app, clipId) {
  const found = clipId ? app.store.trackForClip(clipId) : null;
  if (!found) {
    openAddTextSheet(app);
    return;
  }
  const clip = found.clip;
  const text = clip.text;

  const body = h('div');
  const nameInput = h('input', { type: 'text', class: 'se-input', value: clip.name || 'Text', maxlength: 60, 'aria-label': 'Layer name' });
  nameInput.addEventListener('change', () => {
    app.edit(() => { clip.name = nameInput.value.trim() || 'Text'; }, 'text-name');
  });
  body.append(field('Layer name', nameInput));

  const textarea = h('textarea', { class: 'se-textarea', rows: 3, 'aria-label': 'Text content' });
  textarea.value = text.content || '';
  textarea.addEventListener('focus', () => app.store.begin());
  textarea.addEventListener('input', () => {
    app.live(() => {
      text.content = textarea.value;
      if (!clip.name || clip.name === 'Text' || clip.name === 'Your text') {
        clip.name = textarea.value.split('\n')[0].slice(0, 28) || 'Text';
      }
    });
  });
  textarea.addEventListener('blur', () => app.commit('text-content'));
  body.append(field('Text', textarea));

  body.append(sectionLabel('Style'));
  body.append(
    selectField('Font', FONT_OPTIONS, text.font || 'sans', (value) => {
      app.edit(() => { text.font = value; }, 'text-font');
    })
  );
  body.append(
    rangeField({
      label: 'Font size',
      min: 16,
      max: 180,
      step: 1,
      value: text.size || 72,
      format: (value) => `${Math.round(value)} px`,
      onInput: (value) => app.live(() => { text.size = value; }),
      onCommit: () => app.commit('text-size')
    })
  );

  const styleRow = h('div', { class: 'se-chip-row' });
  for (const style of [
    { key: 'bold', label: 'Bold' },
    { key: 'italic', label: 'Italic' },
    { key: 'underline', label: 'Underline' },
    { key: 'shadow', label: 'Shadow' }
  ]) {
    const button = chip(style.label, Boolean(text[style.key]), () => {
      app.edit(() => { text[style.key] = !text[style.key]; }, 'text-style');
      setPressed(button, Boolean(text[style.key]));
    });
    styleRow.append(button);
  }
  body.append(field('Weight and decoration', styleRow));
  body.append(field('Alignment', segment(
    [{ id: 'left', label: 'Left' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Right' }],
    text.align || 'center',
    (value) => app.edit(() => { text.align = value; }, 'text-align')
  )));

  body.append(
    colorField('Text colour', text.color, (value) => app.edit(() => { text.color = value; }, 'text-color')),
    colorField('Box colour', text.bgColor, (value) => app.edit(() => { text.bgColor = value; }, 'text-bg')),
    rangeField({
      label: 'Box opacity',
      min: 0,
      max: 1,
      step: 0.01,
      value: text.bgOpacity || 0,
      format: percent,
      onInput: (value) => app.live(() => { text.bgOpacity = value; }),
      onCommit: () => app.commit('text-bg-opacity')
    }),
    colorField('Outline colour', text.outlineColor, (value) => app.edit(() => { text.outlineColor = value; }, 'text-outline')),
    rangeField({
      label: 'Outline width',
      min: 0,
      max: 16,
      step: 1,
      value: text.outlineWidth || 0,
      format: (value) => `${Math.round(value)} px`,
      onInput: (value) => app.live(() => { text.outlineWidth = value; }),
      onCommit: () => app.commit('text-outline-width')
    })
  );

  body.append(sectionLabel('Position and size'));
  const positions = h('div', { class: 'se-chip-row' });
  for (const position of [
    { id: 'top', label: 'Top', x: 0.5, y: 0.18 },
    { id: 'center', label: 'Centre', x: 0.5, y: 0.5 },
    { id: 'bottom', label: 'Bottom', x: 0.5, y: 0.84 },
    { id: 'left', label: 'Left', x: 0.28, y: 0.5 },
    { id: 'right', label: 'Right', x: 0.72, y: 0.5 }
  ]) {
    positions.append(chip(position.label, false, () => {
      app.edit(() => { clip.x = position.x; clip.y = position.y; }, 'text-position');
    }));
  }
  body.append(field('Quick position', positions));
  body.append(
    rangeField({
      label: 'Horizontal position',
      min: -0.2,
      max: 1.2,
      step: 0.005,
      value: clip.x ?? 0.5,
      format: percent,
      onInput: (value) => app.live(() => { clip.x = value; }),
      onCommit: () => app.commit('text-x')
    }),
    rangeField({
      label: 'Vertical position',
      min: -0.2,
      max: 1.2,
      step: 0.005,
      value: clip.y ?? 0.5,
      format: percent,
      onInput: (value) => app.live(() => { clip.y = value; }),
      onCommit: () => app.commit('text-y')
    }),
    rangeField({
      label: 'Scale',
      min: 0.1,
      max: 3,
      step: 0.01,
      value: clip.scale ?? 1,
      format: percent,
      onInput: (value) => app.live(() => { clip.scale = value; }),
      onCommit: () => app.commit('text-scale')
    }),
    rangeField({
      label: 'Rotation',
      min: -180,
      max: 180,
      step: 1,
      value: clip.rotation ?? 0,
      format: (value) => `${Math.round(value)}°`,
      onInput: (value) => app.live(() => { clip.rotation = value; }),
      onCommit: () => app.commit('text-rotation')
    }),
    rangeField({
      label: 'Opacity',
      min: 0,
      max: 1,
      step: 0.01,
      value: clip.opacity ?? 1,
      format: percent,
      onInput: (value) => app.live(() => { clip.opacity = value; }),
      onCommit: () => app.commit('text-opacity')
    })
  );
  body.append(h('p', { class: 'se-field-note', text: 'Tip: drag the text directly in the preview. Corner handles resize it; the top handle rotates it.' }));

  body.append(sectionLabel('Timing'));
  const maxStart = Math.max(30, app.store.duration() + 10);
  body.append(
    rangeField({
      label: 'Start',
      min: 0,
      max: maxStart,
      step: 0.05,
      value: clip.start,
      format: seconds,
      onInput: (value) => app.live(() => { clip.start = value; }),
      onCommit: () => app.commit('text-start')
    }),
    rangeField({
      label: 'Duration',
      min: 0.2,
      max: 120,
      step: 0.1,
      value: clip.duration,
      format: seconds,
      onInput: (value) => app.live(() => { clip.duration = value; }),
      onCommit: () => app.commit('text-duration')
    })
  );
  body.append(h('div', { class: 'se-row' },
    h('button', { type: 'button', class: 'se-btn se-btn-sm', text: 'Start at playhead', onclick: () => { app.edit(() => { clip.start = app.store.playhead; }, 'text-start-at'); } }),
    h('button', { type: 'button', class: 'se-btn se-btn-sm', text: 'End at playhead', onclick: () => { app.edit(() => { clip.duration = Math.max(0.2, app.store.playhead - clip.start); }, 'text-end-at'); } })
  ));

  body.append(sectionLabel('Motion'));
  body.append(motionSection(app, clip));

  app.sheets.open({
    title: 'Edit text',
    sub: targetLabel(app, clip),
    body,
    footer: [
      { label: 'Duplicate', onClick: () => { app.duplicateClip(clip.id); } },
      { label: 'Delete', variant: 'danger', onClick: () => { app.deleteClip(clip.id); app.sheets.close(); } },
      { label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }
    ]
  });
}

function openAddTextSheet(app) {
  const body = h('div');
  let tab = 'text';
  const content = h('div');
  const tabs = segment(
    [{ id: 'text', label: 'Text' }, { id: 'shapes', label: 'Shapes' }, { id: 'stickers', label: 'Stickers' }],
    tab,
    (value) => {
      tab = value;
      render();
    },
    'Add graphic'
  );
  body.append(tabs, content);

  const render = () => {
    content.textContent = '';
    if (tab === 'text') {
      const grid = h('div', { class: 'se-grid-2' });
      for (const [key, preset] of Object.entries(TEXT_PRESETS)) {
        const button = h('button', { type: 'button', class: 'se-btn', style: 'justify-content:flex-start;text-align:left;flex-direction:column;align-items:flex-start;gap:2px;min-height:58px' });
        button.append(h('strong', { text: preset.label, style: 'font-size:13px' }), h('span', { text: preset.description, style: 'font-size:11px;color:#9aa8c0;font-weight:400' }));
        button.addEventListener('click', () => {
          const clip = app.addTextPreset(key);
          if (clip) openTextSheet(app, clip.id);
        });
        grid.append(button);
      }
      content.append(grid, h('p', { class: 'se-field-note', text: 'Text is added at the playhead for three to four seconds, then can be moved, resized and rotated directly in the preview.' }));
    } else if (tab === 'shapes') {
      const grid = h('div', { class: 'se-grid-2' });
      for (const shape of SHAPE_TYPES) {
        const button = h('button', { type: 'button', class: 'se-btn', text: `${shape.icon}  ${shape.label}` });
        button.addEventListener('click', () => {
          const clip = app.addShape(shape.id);
          if (clip) {
            app.sheets.close();
            openClipSheet(app, clip.id);
          }
        });
        grid.append(button);
      }
      content.append(grid, h('p', { class: 'se-field-note', text: 'Shapes are vector layers. Change fill, outline, size and motion without losing quality on export.' }));
    } else {
      const grid = h('div', { class: 'se-grid-3' });
      for (const sticker of STICKERS) {
        const button = h('button', { type: 'button', class: 'se-btn', text: sticker, style: 'font-size:24px;min-height:48px' });
        button.addEventListener('click', () => {
          const clip = app.addSticker(sticker);
          if (clip) openTextSheet(app, clip.id);
        });
        grid.append(button);
      }
      content.append(grid, h('p', { class: 'se-field-note', text: 'Stickers are text layers using the device font, so they render in the preview and the exported file.' }));
    }
  };
  render();

  app.sheets.open({
    title: 'Add text or graphic',
    sub: `At ${clock(app.store.playhead)}`,
    body
  });
}

/* --------------------------------------------------------------- clip sheet */

export function openClipSheet(app, clipId) {
  const found = app.store.trackForClip(clipId);
  if (!found) return;
  const clip = found.clip;
  const track = found.track;
  if (clip.kind === 'text') {
    openTextSheet(app, clipId);
    return;
  }
  if (clip.kind === 'audio') {
    openAudioSheet(app, clipId);
    return;
  }
  const asset = assetFor(app, clip);
  const sourceDuration = asset?.duration || Math.max(clip.duration, clip.outPoint || 0);
  const body = h('div');

  const nameInput = h('input', { type: 'text', class: 'se-input', value: clip.name || 'Video layer', maxlength: 60, 'aria-label': 'Layer name' });
  nameInput.addEventListener('change', () => app.edit(() => { clip.name = nameInput.value.trim() || 'Video layer'; }, 'clip-name'));
  body.append(field('Layer name', nameInput));

  body.append(sectionLabel('Timing and trim'));
  const maxStart = Math.max(30, app.store.duration() + 10);
  body.append(
    rangeField({
      label: 'Start on the video',
      min: 0,
      max: maxStart,
      step: 0.05,
      value: clip.start,
      format: seconds,
      onInput: (value) => app.live(() => { clip.start = value; }),
      onCommit: () => app.commit('clip-start')
    }),
    rangeField({
      label: 'Duration',
      min: 0.2,
      max: Math.max(30, sourceDuration + 10),
      step: 0.05,
      value: clip.duration,
      format: seconds,
      onInput: (value) => app.live(() => {
        clip.duration = value;
        const speed = Math.max(0.05, Number(clip.speed) || 1);
        clip.outPoint = Math.min(sourceDuration, clip.inPoint + value * speed);
      }),
      onCommit: () => app.commit('clip-duration')
    })
  );

  const trimRow = h('div', { class: 'se-row' });
  trimRow.append(
    h('button', {
      type: 'button', class: 'se-btn se-btn-sm', text: 'Trim start here',
      onclick: () => {
        const local = clamp(app.store.playhead - clip.start, 0.05, Math.max(0.05, clip.duration - 0.05));
        app.edit(() => {
          const speed = Math.max(0.05, Number(clip.speed) || 1);
          clip.inPoint = Math.min(sourceDuration - 0.05, clip.inPoint + local * speed);
          clip.start += local;
          clip.duration = Math.max(0.1, clip.duration - local);
        }, 'trim-start');
      }
    }),
    h('button', {
      type: 'button', class: 'se-btn se-btn-sm', text: 'Trim end here',
      onclick: () => {
        const duration = Math.max(0.1, app.store.playhead - clip.start);
        app.edit(() => {
          clip.duration = duration;
          clip.outPoint = Math.min(sourceDuration, clip.inPoint + duration * (Number(clip.speed) || 1));
        }, 'trim-end');
      }
    })
  );
  body.append(trimRow);
  body.append(
    rangeField({
      label: 'Source in point',
      min: 0,
      max: Math.max(0.1, sourceDuration - 0.1),
      step: 0.05,
      value: clip.inPoint || 0,
      format: seconds,
      onInput: (value) => app.live(() => {
        const out = Math.max(value + 0.1, clip.outPoint || sourceDuration);
        setSourceRange(clip, value, out);
      }),
      onCommit: () => app.commit('trim-in')
    }),
    rangeField({
      label: 'Source out point',
      min: 0.1,
      max: sourceDuration,
      step: 0.05,
      value: clip.outPoint || sourceDuration,
      format: seconds,
      onInput: (value) => app.live(() => {
        const input = Math.min(clip.inPoint || 0, value - 0.1);
        setSourceRange(clip, Math.max(0, input), value);
      }),
      onCommit: () => app.commit('trim-out')
    })
  );

  body.append(sectionLabel('Speed'));
  const speedOutput = h('output', { class: 'se-range-value', text: `${(clip.speed || 1).toFixed(2)}×` });
  const speedInput = h('input', { type: 'range', class: 'se-range', min: 0.25, max: 3, step: 0.05, value: clip.speed || 1, 'aria-label': 'Playback speed' });
  speedInput.addEventListener('input', () => {
    speedOutput.textContent = `${Number(speedInput.value).toFixed(2)}×`;
    app.live(() => {
      clip.speed = Number(speedInput.value);
      const inPoint = Number(clip.inPoint) || 0;
      const outPoint = Number(clip.outPoint) || inPoint + clip.duration;
      clip.duration = Math.max(0.1, (outPoint - inPoint) / clip.speed);
    });
  });
  speedInput.addEventListener('change', () => app.commit('speed'));
  body.append(field('Speed', h('div', { class: 'se-range-row' }, speedInput, speedOutput), 'Changing speed also changes pitch. Pitch-preserving stretching is not implemented.'));

  const reverse = h('label', { class: 'se-check' },
    h('input', { type: 'checkbox', checked: Boolean(clip.reverse), onchange: () => app.edit(() => { clip.reverse = !clip.reverse; }, 'reverse') }),
    document.createTextNode('Play backwards')
  );
  body.append(reverse);

  if (clip.kind === 'shape') {
    body.append(sectionLabel('Shape'));
    body.append(
      selectField('Shape type', SHAPE_TYPES, clip.shape?.type || 'rect', (value) => app.edit(() => { clip.shape.type = value; }, 'shape-type')),
      colorField('Fill', clip.shape?.fill, (value) => app.edit(() => { clip.shape.fill = value; }, 'shape-fill')),
      colorField('Outline', clip.shape?.stroke, (value) => app.edit(() => { clip.shape.stroke = value; }, 'shape-stroke')),
      rangeField({
        label: 'Outline width',
        min: 0, max: 24, step: 1, value: clip.shape?.strokeWidth || 0,
        format: (value) => `${Math.round(value)} px`,
        onInput: (value) => app.live(() => { clip.shape.strokeWidth = value; }),
        onCommit: () => app.commit('shape-stroke-width')
      }),
      rangeField({
        label: 'Width',
        min: 0.03, max: 1.5, step: 0.01, value: clip.shape?.width || 0.45,
        format: percent,
        onInput: (value) => app.live(() => { clip.shape.width = value; }),
        onCommit: () => app.commit('shape-width')
      }),
      rangeField({
        label: 'Height',
        min: 0.02, max: 1.5, step: 0.01, value: clip.shape?.height || 0.3,
        format: percent,
        onInput: (value) => app.live(() => { clip.shape.height = value; }),
        onCommit: () => app.commit('shape-height')
      })
    );
  }

  body.append(sectionLabel('Position, size and opacity'));
  body.append(
    rangeField({
      label: 'Horizontal position', min: -0.5, max: 1.5, step: 0.005, value: clip.x ?? 0.5, format: percent,
      onInput: (value) => app.live(() => { clip.x = value; }),
      onCommit: () => app.commit('clip-x')
    }),
    rangeField({
      label: 'Vertical position', min: -0.5, max: 1.5, step: 0.005, value: clip.y ?? 0.5, format: percent,
      onInput: (value) => app.live(() => { clip.y = value; }),
      onCommit: () => app.commit('clip-y')
    }),
    rangeField({
      label: 'Scale', min: 0.05, max: 4, step: 0.01, value: clip.scale ?? 1, format: percent,
      onInput: (value) => app.live(() => { clip.scale = value; }),
      onCommit: () => app.commit('clip-scale')
    }),
    rangeField({
      label: 'Rotation', min: -180, max: 180, step: 1, value: clip.rotation ?? 0, format: (value) => `${Math.round(value)}°`,
      onInput: (value) => app.live(() => { clip.rotation = value; }),
      onCommit: () => app.commit('clip-rotation')
    }),
    rangeField({
      label: 'Opacity', min: 0, max: 1, step: 0.01, value: clip.opacity ?? 1, format: percent,
      onInput: (value) => app.live(() => { clip.opacity = value; }),
      onCommit: () => app.commit('clip-opacity')
    })
  );
  const transformRow = h('div', { class: 'se-chip-row' });
  transformRow.append(
    chip('Centre', false, () => app.edit(() => { clip.x = 0.5; clip.y = 0.5; }, 'centre')),
    chip('Fill frame', false, () => app.edit(() => { clip.fit = 'cover'; clip.scale = 1; clip.x = 0.5; clip.y = 0.5; }, 'fill-frame')),
    chip('Fit frame', false, () => app.edit(() => { clip.fit = 'contain'; clip.scale = 1; clip.x = 0.5; clip.y = 0.5; }, 'fit-frame')),
    chip('Flip H', Boolean(clip.flipH), () => app.edit(() => { clip.flipH = !clip.flipH; }, 'flip-h')),
    chip('Flip V', Boolean(clip.flipV), () => app.edit(() => { clip.flipV = !clip.flipV; }, 'flip-v')),
    chip('Rotate 90°', false, () => app.edit(() => { clip.rotation = ((Number(clip.rotation) || 0) + 90) % 360; }, 'rotate-90'))
  );
  body.append(field('Quick transforms', transformRow));

  if (clip.kind === 'video' || clip.kind === 'image') {
    body.append(sectionLabel('Crop'));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      body.append(rangeField({
        label: `Crop ${side}`,
        min: 0,
        max: 0.45,
        step: 0.005,
        value: clip.crop?.[side] || 0,
        format: percent,
        onInput: (value) => app.live(() => { clip.crop[side] = value; }),
        onCommit: () => app.commit('crop')
      }));
    }
    body.append(h('button', {
      type: 'button', class: 'se-btn se-btn-sm', text: 'Reset crop',
      onclick: () => app.edit(() => { clip.crop = { top: 0, right: 0, bottom: 0, left: 0 }; }, 'crop-reset')
    }));
  }

  if (clip.kind === 'video' || clip.kind === 'audio') {
    body.append(sectionLabel('Audio'));
    body.append(
      rangeField({
        label: 'Volume',
        min: 0,
        max: 1,
        step: 0.01,
        value: clip.volume ?? 1,
        format: percent,
        onInput: (value) => app.live(() => app.setClipVolume(clip, value)),
        onCommit: () => app.commit('clip-volume')
      }),
      rangeField({
        label: 'Fade in',
        min: 0,
        max: Math.min(5, Math.max(0.1, clip.duration / 2)),
        step: 0.05,
        value: clip.fadeIn || 0,
        format: seconds,
        onInput: (value) => app.live(() => { clip.fadeIn = value; }),
        onCommit: () => app.commit('fade-in')
      }),
      rangeField({
        label: 'Fade out',
        min: 0,
        max: Math.min(5, Math.max(0.1, clip.duration / 2)),
        step: 0.05,
        value: clip.fadeOut || 0,
        format: seconds,
        onInput: (value) => app.live(() => { clip.fadeOut = value; }),
        onCommit: () => app.commit('fade-out')
      })
    );
    const mute = h('label', { class: 'se-check' },
      h('input', { type: 'checkbox', checked: Boolean(clip.muted), onchange: () => app.edit(() => { clip.muted = !clip.muted; }, 'clip-mute') }),
      document.createTextNode('Mute this layer')
    );
    body.append(mute);
  }

  body.append(sectionLabel('Layer order'));
  const orderRow = h('div', { class: 'se-chip-row' });
  orderRow.append(
    chip('Bring to front', false, () => app.moveLayer(clip.id, 'front'), 'up'),
    chip('Forward', false, () => app.moveLayer(clip.id, 'up'), 'up'),
    chip('Backward', false, () => app.moveLayer(clip.id, 'down'), 'down'),
    chip('Send to back', false, () => app.moveLayer(clip.id, 'back'), 'down')
  );
  body.append(orderRow);

  body.append(sectionLabel('Motion'));
  body.append(motionSection(app, clip));

  const base = app.store.isBaseClip(clip);
  app.sheets.open({
    title: base ? 'Edit main video' : 'Edit video layer',
    sub: `${targetLabel(app, clip)} · ${clock(clip.start)} to ${clock(clip.start + clip.duration)}`,
    body,
    footer: [
      { label: 'Duplicate', onClick: () => app.duplicateClip(clip.id) },
      { label: 'Split', onClick: () => app.splitClip(clip.id) },
      { label: 'Delete', variant: 'danger', onClick: () => { app.deleteClip(clip.id); app.sheets.close(); } },
      { label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }
    ]
  });
}

/* -------------------------------------------------------------- media sheet */

export function openMediaSheet(app, initialTab = 'all') {
  let tab = initialTab;
  const body = h('div');
  const tabs = h('div', { class: 'se-media-tabs' });
  for (const entry of [
    { id: 'all', label: 'All' },
    { id: 'video', label: 'Video' },
    { id: 'image', label: 'Images' },
    { id: 'audio', label: 'Audio' }
  ]) {
    const button = chip(entry.label, tab === entry.id, () => {
      tab = entry.id;
      for (const child of tabs.children) setPressed(child, child === button);
      renderGrid();
    });
    tabs.append(button);
  }

  const uploads = h('div', { class: 'se-dropzone' },
    h('strong', { text: 'Add media from this device', style: 'font-size:13px' }),
    h('p', { text: 'The first video becomes the main video. Later videos, images and audio become layers at the playhead.' }),
    h('div', { class: 'se-dropzone-actions' },
      h('button', { type: 'button', class: 'se-btn se-btn-sm', html: `${icon('video')} Video`, onclick: () => { app.pickFile('video'); app.sheets.close(); } }),
      h('button', { type: 'button', class: 'se-btn se-btn-sm', html: `${icon('image')} Image`, onclick: () => { app.pickFile('image'); app.sheets.close(); } }),
      h('button', { type: 'button', class: 'se-btn se-btn-sm', html: `${icon('audio')} Audio`, onclick: () => { app.pickFile('audio'); app.sheets.close(); } })
    )
  );

  const missing = app.missingMediaNames?.() || [];
  const missingNote = missing.length ? note(`Missing source files: ${missing.join(', ')}. Re-import them by name to restore those layers.`, 'warn') : null;
  const grid = h('div', { class: 'se-media-grid' });
  body.append(uploads, missingNote, tabs, grid);

  const renderGrid = () => {
    grid.textContent = '';
    const assets = app.media.list().filter((asset) => tab === 'all' || asset.type === tab);
    if (!assets.length) {
      grid.append(note('No media in this project yet. Use the buttons above or drop a file on the preview.'));
      return;
    }
    for (const asset of assets) {
      const thumb = h('div', { class: 'se-media-thumb' });
      if (asset.thumbnail) thumb.style.backgroundImage = `url("${asset.thumbnail}")`;
      else if (asset.type === 'audio') thumb.style.background = 'linear-gradient(135deg,#831843,#db2777)';
      else thumb.style.background = 'linear-gradient(135deg,#1e3a8a,#2563eb)';
      thumb.append(h('span', { text: asset.type === 'video' ? 'VIDEO' : asset.type === 'audio' ? 'AUDIO' : 'IMAGE' }));
      const add = h('button', {
        type: 'button',
        class: 'se-btn se-btn-sm',
        text: asset.type === 'audio' ? 'Add music' : app.store.baseTrack().clips.length ? 'Add layer' : 'Use as video',
        onclick: () => {
          if (asset.type === 'video') app.addVideoAsset(asset);
          else if (asset.type === 'audio') app.addAudioAsset(asset);
          else app.addImageAsset(asset);
          app.sheets.close();
        }
      });
      const remove = h('button', {
        type: 'button',
        class: 'se-btn se-btn-sm se-media-del',
        html: icon('trash'),
        title: 'Remove from library',
        'aria-label': `Remove ${asset.name}`,
        onclick: () => {
          if (app.deleteAsset(asset.id)) renderGrid();
        }
      });
      grid.append(h('div', { class: 'se-media-card' },
        thumb,
        h('span', { class: 'se-media-name', text: asset.name }),
        h('span', { class: 'se-media-meta', text: `${asset.type === 'image' ? `${asset.width}×${asset.height}` : durationLabel(asset.duration)} · ${asset.type}` }),
        h('div', { class: 'se-media-actions' }, add, remove)
      ));
    }
  };
  renderGrid();

  app.sheets.open({
    title: 'Media library',
    sub: 'Files stay on this device',
    body
  });
}

/* -------------------------------------------------------------- audio sheet */

export function openAudioSheet(app, clipId) {
  const found = clipId ? app.store.trackForClip(clipId) : null;
  const clip = found && (found.clip.kind === 'video' || found.clip.kind === 'audio') ? found.clip : null;
  const body = h('div');

  if (clip) {
    const asset = assetFor(app, clip);
    body.append(sectionLabel('Selected sound'));
    body.append(h('p', { class: 'se-field-note', text: `${targetLabel(app, clip)}${asset ? ` · ${asset.name}` : ''}` }));
    body.append(
      rangeField({
        label: 'Volume', min: 0, max: 1, step: 0.01, value: clip.volume ?? 1, format: percent,
        onInput: (value) => app.live(() => app.setClipVolume(clip, value)),
        onCommit: () => app.commit('volume')
      }),
      rangeField({
        label: 'Fade in', min: 0, max: Math.min(8, Math.max(0.1, clip.duration / 2)), step: 0.05, value: clip.fadeIn || 0, format: seconds,
        onInput: (value) => app.live(() => { clip.fadeIn = value; }),
        onCommit: () => app.commit('audio-fade-in')
      }),
      rangeField({
        label: 'Fade out', min: 0, max: Math.min(8, Math.max(0.1, clip.duration / 2)), step: 0.05, value: clip.fadeOut || 0, format: seconds,
        onInput: (value) => app.live(() => { clip.fadeOut = value; }),
        onCommit: () => app.commit('audio-fade-out')
      })
    );
    const mute = h('label', { class: 'se-check' },
      h('input', { type: 'checkbox', checked: Boolean(clip.muted), onchange: () => app.edit(() => { clip.muted = !clip.muted; }, 'audio-mute') }),
      document.createTextNode('Mute this layer')
    );
    body.append(mute);
    body.append(sectionLabel('Volume keyframes'));
    body.append(keyframeEditor(app, clip));
    body.append(h('div', { class: 'se-row' },
      h('button', { type: 'button', class: 'se-btn se-btn-sm', text: 'Trim and speed', onclick: () => openClipSheet(app, clip.id) }),
      h('button', { type: 'button', class: 'se-btn se-btn-sm se-btn-danger', text: 'Delete sound', onclick: () => { app.deleteClip(clip.id); openAudioSheet(app); } })
    ));
    body.append(note('Preview sound uses Web Audio. Export mixes every audible layer at 48 kHz stereo. Speed changes also change pitch.', ''));
  } else {
    body.append(note('Select a video or audio layer to adjust its volume, fades or keyframes.'));
  }

  body.append(sectionLabel('Add music or voiceover'));
  const upload = h('button', { type: 'button', class: 'se-btn se-btn-primary', html: `${icon('upload')} Choose audio file`, onclick: () => { app.pickFile('audio'); app.sheets.close(); } });
  body.append(upload);

  const audioAssets = app.media.list().filter((asset) => asset.type === 'audio');
  const list = h('div', { class: 'se-media-grid' });
  for (const asset of audioAssets) {
    list.append(h('div', { class: 'se-media-card' },
      h('div', { class: 'se-media-thumb', style: 'background:linear-gradient(135deg,#831843,#db2777)' }, h('span', { text: 'AUDIO' })),
      h('span', { class: 'se-media-name', text: asset.name }),
      h('span', { class: 'se-media-meta', text: durationLabel(asset.duration) }),
      h('div', { class: 'se-media-actions' },
        h('button', { type: 'button', class: 'se-btn se-btn-sm', text: 'Add', onclick: () => { app.addAudioAsset(asset); app.sheets.close(); } })
      )
    ));
  }
  if (audioAssets.length) body.append(list);

  app.sheets.open({
    title: 'Audio',
    sub: clip ? targetLabel(app, clip) : 'Music, voiceover and the video sound',
    body
  });
}

/* ------------------------------------------------------------- filter sheet */

export function openFilterSheet(app) {
  const clip = visualTarget(app);
  if (!clip) {
    app.sheets.open({ title: 'Filters', body: note('Add a video or visual layer first.'), footer: [{ label: 'Close', onClick: () => app.sheets.close() }] });
    return;
  }
  const body = h('div');
  body.append(h('p', { class: 'se-field-note', text: `Applying to ${targetLabel(app, clip)}. The filter is drawn into preview and export frames.` }));

  const filterGrid = h('div', { class: 'se-filter-grid' });
  const renderFilters = () => {
    filterGrid.textContent = '';
    for (const filter of FILTERS) {
      const swatch = h('div', { class: 'se-filter-swatch' });
      swatch.style.filter = filter.css;
      const card = h('button', {
        type: 'button',
        class: 'se-filter-card',
        'aria-pressed': (clip.filter || 'none') === filter.id ? 'true' : 'false',
        onclick: () => {
          app.edit(() => { clip.filter = filter.id; }, 'filter');
          renderFilters();
        }
      }, swatch, h('span', { text: filter.label }));
      filterGrid.append(card);
    }
  };
  renderFilters();
  body.append(filterGrid);
  body.append(
    rangeField({
      label: 'Filter intensity', min: 0, max: 1, step: 0.01, value: clip.filterIntensity ?? 1, format: percent,
      onInput: (value) => app.live(() => { clip.filterIntensity = value; }),
      onCommit: () => app.commit('filter-intensity')
    })
  );

  body.append(sectionLabel('Colour presets'));
  const presetRow = h('div', { class: 'se-chip-row' });
  for (const preset of COLOR_PRESETS) {
    presetRow.append(chip(preset.label, false, () => {
      app.edit(() => {
        clip.color = { ...clip.color, ...preset.values };
      }, 'color-preset');
      app.toast(`${preset.label} grade applied.`, 'ok');
    }));
  }
  body.append(presetRow);

  body.append(sectionLabel('Adjustments'));
  for (const control of [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
    { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
    { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 100 },
    { key: 'fade', label: 'Fade', min: 0, max: 100 }
  ]) {
    body.append(rangeField({
      label: control.label,
      min: control.min,
      max: control.max,
      step: 1,
      value: clip.color?.[control.key] || 0,
      format: (value) => `${Math.round(value)}`,
      onInput: (value) => app.live(() => { clip.color[control.key] = value; }),
      onCommit: () => app.commit(`color-${control.key}`)
    }));
  }

  body.append(h('button', {
    type: 'button',
    class: 'se-btn se-btn-sm',
    text: 'Reset filter and colour',
    onclick: () => {
      app.edit(() => {
        clip.filter = 'none';
        clip.filterIntensity = 1;
        clip.color = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0, gamma: 0, sharpness: 0, fade: 0, vignette: 0 };
      }, 'filter-reset');
      renderFilters();
    }
  }));

  app.sheets.open({
    title: 'Filters and colour',
    sub: targetLabel(app, clip),
    body,
    footer: [{ label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }]
  });
}

/* --------------------------------------------------------- transition sheet */

export function openTransitionSheet(app) {
  const clip = visualTarget(app);
  if (!clip) {
    app.sheets.open({ title: 'Transitions', body: note('Add a video or visual layer first.'), footer: [{ label: 'Close', onClick: () => app.sheets.close() }] });
    return;
  }
  const body = h('div');
  body.append(h('p', { class: 'se-field-note', text: `A transition is applied to the start of ${targetLabel(app, clip)}. At a real cut it blends with the previous clip; at the first clip it reveals from black.` }));

  const grid = h('div', { class: 'se-transition-grid' });
  const renderGrid = () => {
    grid.textContent = '';
    const current = clip.transition?.type || 'none';
    const none = h('button', { type: 'button', class: 'se-transition-card', text: 'None', 'aria-pressed': current === 'none' ? 'true' : 'false' });
    none.addEventListener('click', () => {
      app.edit(() => { clip.transition = { type: 'none', duration: 0.5, reverse: false }; }, 'transition-none');
      renderGrid();
    });
    grid.append(none);
    for (const transition of TRANSITIONS) {
      const button = h('button', {
        type: 'button',
        class: 'se-transition-card',
        text: transition.label,
        'aria-pressed': current === transition.id ? 'true' : 'false',
        title: transition.groupLabel
      });
      button.addEventListener('click', () => {
        app.edit(() => {
          clip.transition = {
            type: transition.id,
            duration: Math.min(Number(clip.transition?.duration) || 0.6, Math.max(0.15, clip.duration - 0.05)),
            reverse: Boolean(clip.transition?.reverse)
          };
        }, 'transition');
        renderGrid();
      });
      grid.append(button);
    }
  };
  renderGrid();
  body.append(grid);
  body.append(
    rangeField({
      label: 'Transition length', min: 0.15, max: Math.min(3, Math.max(0.2, clip.duration)), step: 0.05,
      value: Math.min(Number(clip.transition?.duration) || 0.6, Math.max(0.2, clip.duration)),
      format: seconds,
      onInput: (value) => app.live(() => { clip.transition.duration = value; }),
      onCommit: () => app.commit('transition-duration')
    })
  );
  const reverse = h('label', { class: 'se-check' },
    h('input', { type: 'checkbox', checked: Boolean(clip.transition?.reverse), onchange: () => app.edit(() => { clip.transition.reverse = !clip.transition.reverse; }, 'transition-reverse') }),
    document.createTextNode('Reverse direction')
  );
  body.append(reverse);
  body.append(h('button', {
    type: 'button', class: 'se-btn se-btn-sm', text: 'Preview this cut',
    onclick: () => {
      app.preview.seek(Math.max(0, clip.start + 0.02));
      app.preview.play();
    }
  }));

  app.sheets.open({
    title: 'Transitions',
    sub: targetLabel(app, clip),
    body,
    footer: [{ label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }]
  });
}

/* -------------------------------------------------------------- project sheet */

export function openProjectSheet(app) {
  const body = h('div');
  const project = app.store.project;
  const nameInput = h('input', { type: 'text', class: 'se-input', value: project.name || '', maxlength: 80, 'aria-label': 'Project name' });
  nameInput.addEventListener('change', () => app.edit(() => { project.name = nameInput.value.trim() || 'Untitled video'; }, 'project-name'));
  body.append(field('Project name', nameInput));

  body.append(sectionLabel('Canvas'));
  body.append(field('Aspect ratio', segment(
    [
      { id: '16:9', label: '16:9' },
      { id: '9:16', label: '9:16' },
      { id: '1:1', label: '1:1' },
      { id: '4:3', label: '4:3' },
      { id: '3:4', label: '3:4' },
      { id: '4:5', label: '4:5' }
    ],
    project.aspect || '16:9',
    (value) => app.edit(() => { project.aspect = value; }, 'project-aspect')
  )));
  body.append(
    selectField('Resolution', [
      { id: '1080', label: '1080p · Full HD' },
      { id: '720', label: '720p · HD' },
      { id: '480', label: '480p · SD' },
      { id: '360', label: '360p · Small' }
    ], project.resolution || '1080', (value) => app.edit(() => { project.resolution = value; }, 'project-resolution')),
    selectField('Frame rate', [
      { id: '24', label: '24 fps' },
      { id: '25', label: '25 fps' },
      { id: '30', label: '30 fps' },
      { id: '60', label: '60 fps' }
    ], String(project.fps || 30), (value) => app.edit(() => { project.fps = Number(value); }, 'project-fps')),
    colorField('Background', project.background || '#000000', (value) => app.edit(() => { project.background = value; }, 'project-background')),
    rangeField({
      label: 'Master volume', min: 0, max: 1, step: 0.01, value: project.masterVolume ?? 1, format: percent,
      onInput: (value) => app.live(() => { project.masterVolume = value; }),
      onCommit: () => app.commit('master-volume')
    })
  );

  const dims = app.store.dimensions();
  const info = app.projectInfo();
  body.append(sectionLabel('Project'));
  const facts = h('dl', { class: 'se-meta-list' });
  for (const [label, value] of [
    ['Canvas', `${dims.width} × ${dims.height}`],
    ['Duration', durationLabel(info.duration)],
    ['Layers', String(info.layerCount)],
    ['Media files', String(info.mediaCount)],
    ['Saved', info.savedAt ? new Date(info.savedAt).toLocaleTimeString() : 'not yet saved']
  ]) {
    facts.append(h('div', { class: 'se-meta-row' }, h('dt', { text: label }), h('dd', { text: value })));
  }
  body.append(facts);

  body.append(sectionLabel('Project file and local data'));
  const actions = h('div', { class: 'se-row' });
  actions.append(
    h('button', { type: 'button', class: 'se-btn se-btn-sm', html: `${icon('download')} Save project file`, onclick: () => app.saveProjectFile() }),
    h('button', { type: 'button', class: 'se-btn se-btn-sm', html: `${icon('upload')} Open project file`, onclick: () => { app.openProjectFile(); app.sheets.close(); } })
  );
  body.append(actions);
  body.append(note('The project and its media autosave in this browser. A project file contains the edit and media metadata, not the original video bytes.'));

  let armed = false;
  const clearButton = h('button', { type: 'button', class: 'se-btn se-btn-sm se-btn-danger', text: 'Forget saved copy' });
  clearButton.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      clearButton.textContent = 'Tap again to remove the saved copy';
      return;
    }
    app.clearSaved();
    app.sheets.close();
  });
  body.append(h('div', { class: 'se-row', style: 'margin-top:10px' }, clearButton));

  app.sheets.open({
    title: 'Project settings',
    sub: 'Everything is processed on this device',
    body,
    footer: [{ label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }]
  });
}

/* --------------------------------------------------------------- export sheet */

export function openExportSheet(app) {
  const body = h('div');
  const duration = app.store.duration();
  const dims = app.store.dimensions();
  if (duration <= 0) {
    app.sheets.open({
      title: 'Export',
      body: note('Add a video or another layer before exporting. There is nothing to render yet.', 'warn'),
      footer: [{ label: 'Close', onClick: () => app.sheets.close() }]
    });
    return;
  }

  let format = 'mp4';
  let resolution = 'project';
  let quality = 'balanced';
  let includeAudio = true;
  let capabilities = { mp4: null, webm: null, audio: false };

  body.append(h('p', { class: 'se-field-note', text: `${durationLabel(duration)} · ${dims.width} × ${dims.height}. Export runs on this device and can take longer than playback. Keep this tab open.` }));

  const capabilityNote = h('div', { class: 'se-note', text: 'Checking what this browser can encode…' });
  body.append(capabilityNote);

  body.append(sectionLabel('Format'));
  const formatSeg = h('div', { class: 'se-seg' });
  body.append(formatSeg);
  body.append(sectionLabel('Resolution'));
  body.append(segment(
    [
      { id: 'project', label: 'Project' },
      { id: '1080', label: '1080p' },
      { id: '720', label: '720p' },
      { id: '480', label: '480p' }
    ],
    resolution,
    (value) => { resolution = value; updateEstimate(); }
  ));
  body.append(sectionLabel('Quality'));
  body.append(segment(
    [
      { id: 'high', label: 'High' },
      { id: 'balanced', label: 'Balanced' },
      { id: 'small', label: 'Small' }
    ],
    quality,
    (value) => { quality = value; updateEstimate(); }
  ));

  const audioCheck = h('label', { class: 'se-check' },
    h('input', { type: 'checkbox', checked: true, onchange: () => { includeAudio = audioCheck.querySelector('input').checked; } }),
    document.createTextNode('Include audio')
  );
  body.append(audioCheck);

  const estimate = h('p', { class: 'se-field-note' });
  body.append(estimate);

  const updateEstimate = () => {
    const target = app.exporter.resolveDimensions(resolution);
    estimate.textContent = `Output: ${target.width} × ${target.height} · ${app.store.project.fps || 30} fps · ${format === 'mp4' ? 'H.264 + AAC' : 'VP9 + Opus'}`;
  };

  const renderFormats = () => {
    formatSeg.textContent = '';
    const choices = [
      { id: 'mp4', label: 'MP4', detail: 'H.264 + AAC', supported: capabilities.mp4 !== false },
      { id: 'webm', label: 'WebM', detail: 'VP9 + Opus', supported: capabilities.webm !== false }
    ];
    for (const choice of choices) {
      const button = h('button', {
        type: 'button',
        html: `<span>${choice.label}</span><small style="display:block;font-size:9.5px;font-weight:400;opacity:.75">${choice.detail}</small>`,
        'aria-pressed': format === choice.id ? 'true' : 'false',
        disabled: capabilities[choice.id] === false
      });
      button.addEventListener('click', () => {
        format = choice.id;
        renderFormats();
        updateEstimate();
      });
      formatSeg.append(button);
    }
    updateEstimate();
  };

  let canStart = false;
  const setStartEnabled = (enabled) => {
    canStart = Boolean(enabled);
    const node = document.getElementById('se-export-start');
    if (node) node.disabled = !canStart;
  };
  const showForm = () => {
    body.textContent = '';
    body.append(
      h('p', { class: 'se-field-note', text: `${durationLabel(duration)} · ${dims.width} × ${dims.height}. Export runs on this device and can take longer than playback. Keep this tab open.` }),
      capabilityNote,
      sectionLabel('Format'),
      formatSeg,
      sectionLabel('Resolution'),
      segment(
        [
          { id: 'project', label: 'Project' },
          { id: '1080', label: '1080p' },
          { id: '720', label: '720p' },
          { id: '480', label: '480p' }
        ],
        resolution,
        (value) => { resolution = value; updateEstimate(); }
      ),
      sectionLabel('Quality'),
      segment(
        [
          { id: 'high', label: 'High' },
          { id: 'balanced', label: 'Balanced' },
          { id: 'small', label: 'Small' }
        ],
        quality,
        (value) => { quality = value; updateEstimate(); }
      ),
      audioCheck,
      estimate
    );
    updateEstimate();
  };

  showForm();
  renderFormats();

  app.exporter.capabilities(dims.width, dims.height).then((caps) => {
    capabilities = caps;
    if (caps.mp4 === false && caps.webm !== false) format = 'webm';
    if (caps.mp4 === false && caps.webm === false) {
      capabilityNote.className = 'se-note is-error';
      capabilityNote.textContent = 'This browser does not expose a video encoder for MP4 or WebM. Editing and saving still work, but exporting a video is not possible here. Current Chrome or Edge is recommended.';
      setStartEnabled(false);
    } else {
      capabilityNote.className = 'se-note is-ok';
      const parts = [];
      if (caps.mp4) parts.push('MP4');
      if (caps.webm) parts.push('WebM');
      capabilityNote.textContent = `This browser can encode ${parts.join(' and ')}${caps.audio ? ' with AAC/Opus audio' : ''}.`;
      setStartEnabled(true);
    }
    renderFormats();
  }).catch((error) => {
    capabilityNote.className = 'se-note is-warn';
    capabilityNote.textContent = `Encoder capability could not be checked: ${error.message || error}. You can still try an export.`;
    setStartEnabled(true);
  });

  const controller = app.sheets.open({
    title: 'Export video',
    sub: app.store.project.name,
    body,
    footer: [
      { label: 'Cancel', onClick: () => app.sheets.close() },
      {
        label: 'Start export',
        variant: 'primary',
        onClick: () => startExport(),
        disabled: true,
        id: 'se-export-start'
      }
    ]
  });
  setStartEnabled(canStart);

  function startExport() {
    if (duration <= 0) return;
    const options = app.exporter.buildOptions({ format, resolution, quality, includeAudio });
    const progressWrap = h('div');
    const bar = h('span');
    progressWrap.append(
      h('p', { class: 'se-field-note', text: 'Preparing media and encoder…' }),
      h('div', { class: 'se-progress' }, bar),
      h('p', { class: 'se-field-note', id: 'se-export-phase', text: '0%' })
    );
    body.textContent = '';
    body.append(progressWrap);
    const foot = controller.sheet.querySelector('.se-sheet-foot');
    if (foot) foot.remove();
    const phase = progressWrap.querySelector('#se-export-phase');
    app.sheets.open({
      title: 'Exporting…',
      sub: `${format.toUpperCase()} · ${options.width} × ${options.height}`,
      body: progressWrap,
      footer: [{ label: 'Cancel export', variant: 'danger', onClick: () => app.exporter.cancel() }]
    });
    app.exportRunning = true;

    app.exporter.exportToBlob(options, (progress, label) => {
      bar.style.width = `${Math.round(progress * 100)}%`;
      phase.textContent = `${Math.round(progress * 100)}% · ${label || 'working'}`;
    }).then((result) => {
      app.exportRunning = false;
      app.lastExport = result;
      showResult(result, options);
    }).catch((error) => {
      app.exportRunning = false;
      if (error.canceled) {
        app.toast('Export canceled.', 'warn');
        app.sheets.close();
        return;
      }
      showError(error);
    });
  }

  function showResult(result, options) {
    const meta = result.meta || {};
    const resultBody = h('div');
    resultBody.append(
      note('The file was written and read back successfully. The measurements below come from the finished file, not from the settings.', 'ok')
    );
    const facts = h('dl', { class: 'se-meta-list' });
    for (const [label, value] of [
      ['Format', `${(meta.format || options.format).toUpperCase()} · ${meta.codec || ''}${meta.audioCodec ? ` + ${meta.audioCodec}` : ''}`],
      ['Resolution', `${meta.width || options.width} × ${meta.height || options.height}`],
      ['Duration', `${(Number(meta.duration) || 0).toFixed(2)} s`],
      ['Frame rate', `${meta.fps || options.fps} fps`],
      ['Size', `${((Number(meta.size) || result.blob.size) / 1024 / 1024).toFixed(2)} MB`],
      ['Bitrate', meta.bitrate ? `${Math.round(meta.bitrate / 1000)} kbps` : '—'],
      ['Audio', meta.hasAudio ? `${meta.audioSampleRate || 48000} Hz · ${meta.audioChannels || 2} ch` : 'none']
    ]) {
      facts.append(h('div', { class: 'se-meta-row' }, h('dt', { text: label }), h('dd', { text: value })));
    }
    resultBody.append(facts);
    resultBody.append(h('p', { class: 'se-field-note', text: 'Download the file now. It exists only in this browser tab until you save it.' }));

    const download = () => {
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFilename(app.store.project.name || 'video', 'video')}.${meta.extension || options.format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    app.sheets.open({
      title: 'Export complete',
      sub: `${((Number(meta.size) || result.blob.size) / 1024 / 1024).toFixed(2)} MB · ${(Number(meta.duration) || 0).toFixed(1)} s`,
      body: resultBody,
      footer: [
        { label: 'Export again', onClick: () => openExportSheet(app) },
        { label: 'Download video', variant: 'primary', onClick: download }
      ]
    });
    app.toast('Video exported. Download it to keep the file.', 'ok', 5000);
  }

  function showError(error) {
    const errorBody = h('div');
    errorBody.append(note(error.message || String(error), 'error'));
    errorBody.append(h('p', { class: 'se-field-note', text: 'No file was produced. The project is unchanged. If the message mentions encoding, try the other format or a smaller resolution.' }));
    app.sheets.open({
      title: 'Export failed',
      body: errorBody,
      footer: [
        { label: 'Close', onClick: () => app.sheets.close() },
        { label: 'Try again', variant: 'primary', onClick: () => openExportSheet(app) }
      ]
    });
  }
}

/* ---------------------------------------------------------------- menu/help */

export function openMenuSheet(app) {
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const entries = [
    { icon: 'settings', label: 'Project settings', detail: 'Canvas, name, aspect and local data', action: () => openProjectSheet(app) },
    { icon: 'download', label: 'Save project file', detail: 'Download the edit as JSON', action: () => app.saveProjectFile() },
    { icon: 'upload', label: 'Open project file', detail: 'Restore an edit from JSON', action: () => app.openProjectFile() },
    { icon: 'sparkles', label: 'Help and shortcuts', detail: 'How editing and export work', action: () => openHelpSheet(app) }
  ];
  for (const entry of entries) {
    const button = h('button', { type: 'button', class: 'se-btn', style: 'justify-content:flex-start;text-align:left;gap:10px;min-height:56px;padding:10px 12px' });
    button.innerHTML = icon(entry.icon);
    button.append(h('span', { style: 'display:flex;flex-direction:column;gap:1px;min-width:0' },
      h('strong', { text: entry.label, style: 'font-size:13px' }),
      h('span', { text: entry.detail, style: 'font-size:11px;font-weight:400;color:#9aa8c0' })
    ));
    button.addEventListener('click', () => {
      app.sheets.close();
      entry.action();
    });
    body.append(button);
  }
  let armed = false;
  const newButton = h('button', { type: 'button', class: 'se-btn se-btn-danger', text: 'New project', style: 'margin-top:4px' });
  newButton.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      newButton.textContent = 'Tap again to discard this project';
      return;
    }
    app.newProject();
    app.sheets.close();
  });
  body.append(newButton);
  app.sheets.open({ title: 'Project actions', body });
}

export function openHelpSheet(app) {
  const body = h('div');
  body.append(
    h('h3', { class: 'se-section-label', text: 'Quick start' }),
    h('ol', { class: 'vc-steps' },
      h('li', { text: 'Upload a video. It becomes the main video and sets the project length.' }),
      h('li', { text: 'Drag the progress strip to a moment, then tap an action.' }),
      h('li', { text: 'Select a layer in the Layers panel to edit it again. Drag text or graphics in the preview.' }),
      h('li', { text: 'Export. The file is rendered locally and can be downloaded when the read-back succeeds.' })
    ),
    h('h3', { class: 'se-section-label', text: 'Shortcuts' }),
    h('div', { class: 'se-meta-list' },
      ...[
        ['Space', 'Play or pause'],
        ['← / →', 'Seek one second (Shift: five seconds)'],
        [', / .', 'Step one frame'],
        ['Ctrl / ⌘ + Z', 'Undo'],
        ['Ctrl / ⌘ + Shift + Z', 'Redo'],
        ['S', 'Split at playhead'],
        ['T', 'Add text'],
        ['D', 'Duplicate selected layer'],
        ['Delete', 'Delete selected layer'],
        ['Esc', 'Close a sheet or deselect']
      ].map(([key, action]) => h('div', { class: 'se-meta-row' }, h('dt', { text: key }), h('dd', { text: action })))
    ),
    h('h3', { class: 'se-section-label', text: 'Honest limits' }),
    note('Export needs WebCodecs. MP4 uses H.264 + AAC; WebM uses VP9 + Opus. Long or 4K projects are limited by device memory. Speed changes also change pitch. Preview is drawn from decoded frames and can trail the audio clock slightly on heavy files; audio is the timing reference. This build is tested in browser emulation, not on every physical phone.')
  );
  app.sheets.open({ title: 'Help and shortcuts', body, footer: [{ label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }] });
}

/* -------------------------------------------------------------- captions */

export function openCaptionsSheet(app) {
  const project = app.store.project;
  project.subtitles = project.subtitles || { enabled: true, style: defaultSubtitleStyle(), items: [] };
  project.subtitles.style = { ...defaultSubtitleStyle(), ...(project.subtitles.style || {}) };
  project.subtitles.items = Array.isArray(project.subtitles.items) ? project.subtitles.items : [];

  const body = h('div');

  const enabled = h('label', { class: 'se-check' },
    h('input', {
      type: 'checkbox',
      checked: project.subtitles.enabled !== false,
      onchange: () => app.edit(() => { project.subtitles.enabled = !project.subtitles.enabled; }, 'captions-enabled')
    }),
    document.createTextNode('Show captions in the preview and export')
  );
  body.append(enabled);

  body.append(
    h('div', { class: 'se-row', style: 'margin:10px 0 4px' },
      h('button', {
        type: 'button',
        class: 'se-btn se-btn-sm se-btn-primary',
        text: 'Add caption at playhead',
        onclick: () => {
          app.edit(() => {
            const start = app.store.playhead;
            project.subtitles.items.push({
              id: `sub-${Date.now().toString(36)}`,
              start,
              end: start + 3,
              text: 'Your caption'
            });
            project.subtitles.items.sort((a, b) => a.start - b.start);
          }, 'caption-add');
          renderList();
        }
      }),
      h('button', {
        type: 'button',
        class: 'se-btn se-btn-sm',
        text: 'Import SRT / VTT',
        onclick: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.srt,.vtt,text/plain';
          input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const extension = file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
              const entries = parseSubtitleFile(text, extension);
              if (!entries.length) throw new Error('No captions were found in that file.');
              app.edit(() => {
                const offset = app.store.playhead;
                for (const entry of entries) {
                  project.subtitles.items.push({ ...entry, start: entry.start + offset, end: entry.end + offset });
                }
                project.subtitles.items.sort((a, b) => a.start - b.start);
              }, 'captions-import');
              app.toast(`${entries.length} caption${entries.length === 1 ? '' : 's'} imported.`, 'ok');
              renderList();
            } catch (error) {
              app.toast(error.message || String(error), 'error', 5200);
            }
          });
          input.click();
        }
      })
    )
  );

  body.append(sectionLabel('Style'));
  const style = project.subtitles.style;
  body.append(
    selectField('Font', FONT_OPTIONS, style.font || 'sans', (value) => app.edit(() => { style.font = value; }, 'caption-font')),
    rangeField({
      label: 'Text size', min: 20, max: 110, step: 1, value: style.size || 44,
      format: (value) => `${Math.round(value)} px`,
      onInput: (value) => app.live(() => { style.size = value; }),
      onCommit: () => app.commit('caption-size')
    }),
    colorField('Text colour', style.color, (value) => app.edit(() => { style.color = value; }, 'caption-color')),
    colorField('Box colour', style.bgColor, (value) => app.edit(() => { style.bgColor = value; }, 'caption-bg')),
    rangeField({
      label: 'Box opacity', min: 0, max: 1, step: 0.01, value: style.bgOpacity ?? 0.62,
      format: percent,
      onInput: (value) => app.live(() => { style.bgOpacity = value; }),
      onCommit: () => app.commit('caption-bg-opacity')
    }),
    rangeField({
      label: 'Position from top', min: 0.35, max: 0.97, step: 0.005, value: style.position ?? 0.86,
      format: percent,
      onInput: (value) => app.live(() => { style.position = value; }),
      onCommit: () => app.commit('caption-position')
    })
  );

  body.append(sectionLabel('Captions'));
  const list = h('div', { class: 'se-kf-list' });
  body.append(list);

  const renderList = () => {
    list.textContent = '';
    if (!project.subtitles.items.length) {
      list.append(note('No captions yet. Move the playhead and tap “Add caption at playhead”, or import an SRT or VTT file. The import starts at the playhead.'));
      return;
    }
    project.subtitles.items
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((item) => {
        const textarea = h('textarea', { class: 'se-textarea', rows: 2, 'aria-label': 'Caption text', style: 'min-height:54px' });
        textarea.value = item.text || '';
        textarea.addEventListener('change', () => {
          app.edit(() => { item.text = textarea.value; }, 'caption-text');
        });

        const startInput = h('input', { type: 'number', class: 'se-input', min: 0, step: 0.05, value: Number(item.start).toFixed(2), 'aria-label': 'Caption start' });
        const endInput = h('input', { type: 'number', class: 'se-input', min: 0.1, step: 0.05, value: Number(item.end).toFixed(2), 'aria-label': 'Caption end' });
        startInput.addEventListener('change', () => {
          const value = clampNumber(startInput.value, 0, 3600, item.start);
          app.edit(() => {
            item.start = value;
            item.end = Math.max(item.end, value + 0.3);
          }, 'caption-start');
          renderList();
        });
        endInput.addEventListener('change', () => {
          const value = clampNumber(endInput.value, 0.1, 3600, item.end);
          app.edit(() => {
            item.end = Math.max(item.start + 0.3, value);
          }, 'caption-end');
          renderList();
        });

        const jump = h('button', { type: 'button', html: icon('timer'), title: 'Go to caption', 'aria-label': 'Go to caption' });
        jump.addEventListener('click', () => app.preview.seek(item.start + 0.001));
        const remove = h('button', { type: 'button', html: icon('trash'), title: 'Delete caption', 'aria-label': 'Delete caption' });
        remove.addEventListener('click', () => {
          app.edit(() => {
            const index = project.subtitles.items.indexOf(item);
            if (index !== -1) project.subtitles.items.splice(index, 1);
          }, 'caption-delete');
          renderList();
        });

        list.append(h('div', { class: 'se-kf-row' }, textarea, startInput, endInput, jump, remove));
      });
  };
  renderList();
  body.append(note('Captions are project data drawn by the same renderer used for export. Times are clip-independent, so a caption stays at its moment even when the main video is trimmed.'));

  app.sheets.open({
    title: 'Captions and subtitles',
    sub: `${project.subtitles.items.length} caption${project.subtitles.items.length === 1 ? '' : 's'}`,
    body,
    footer: [{ label: 'Done', variant: 'primary', onClick: () => app.sheets.close() }]
  });
}

