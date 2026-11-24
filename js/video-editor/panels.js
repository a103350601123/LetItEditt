/* LetitEdit Professional Video Editor — library and tool panels. */

import {
  formatBytes,
  formatClock,
  escapeHtml
} from './utils.js';
import { projectDuration, previousClip } from './model.js';
import { FILTERS, TRANSITION_GROUPS, TRANSITIONS, filterCss, transitionLabel } from './effects.js';
import { ANIMATIONS, COLOR_PRESETS, SHAPE_TYPES, STICKERS, TEXT_PRESETS } from './presets.js';

export const TABS = [
  { id: 'media', label: 'Media' },
  { id: 'text', label: 'Text' },
  { id: 'audio', label: 'Audio' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'filters', label: 'Filters' },
  { id: 'effects', label: 'Effects' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'layers', label: 'Layers' }
];

/* A short glyph plus the written label keeps every tool recognisable at
 * 320 px without relying on an icon font or an image request. */
export const TAB_ICONS = {
  media: '▤',
  text: 'T',
  audio: '♪',
  overlays: '▣',
  transitions: '⇄',
  filters: '◐',
  effects: '✦',
  subtitles: 'CC',
  layers: '≡'
};

function tabId(tab) {
  return TABS.some((item) => item.id === tab) ? tab : 'media';
}

export function renderTabStrip(activeTab) {
  return TABS.map((tab) => `
    <button type="button" role="tab" id="ve-tab-${tab.id}" data-tab="${tab.id}" aria-selected="${tab.id === activeTab}" aria-controls="ve-panel" tabindex="${tab.id === activeTab ? '0' : '-1'}">
      <span class="ve-tab-icon" aria-hidden="true">${TAB_ICONS[tab.id] || '•'}</span>
      <span class="ve-tab-label">${tab.label}</span>
    </button>
  `).join('');
}

function safeUrl(url) {
  return String(url || '').replace(/'/g, '%27');
}

function mediaKindLabel(asset) {
  if (asset.type === 'video') return asset.hasAudio ? 'Video + audio' : 'Video';
  if (asset.type === 'audio') return 'Audio';
  return 'Image';
}

function mediaMeta(asset) {
  const parts = [];
  if (asset.type === 'image') {
    parts.push(`${asset.width}×${asset.height}`);
  } else if (asset.type === 'video') {
    parts.push(`${asset.width}×${asset.height}`);
    parts.push(formatClock(asset.duration));
    if (asset.fps) parts.push(`${Math.round(asset.fps * 100) / 100} fps`);
  } else {
    parts.push(formatClock(asset.duration));
    if (asset.sampleRate) parts.push(`${Math.round(asset.sampleRate / 100) / 10} kHz`);
  }
  parts.push(formatBytes(asset.size));
  return parts.join(' · ');
}

function selectedContext(context) {
  const { project, selection } = context;
  const ids = [...selection];
  for (const id of ids) {
    const located = findClipSafe(project, id);
    if (located) return located;
  }
  return null;
}

function findClipSafe(project, id) {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

function mediaTab(context) {
  const { media, selection, project } = context;
  const assets = media.list();
  const total = assets.reduce((sum, asset) => sum + (asset.size || 0), 0);
  const primary = selectedContext(context);
  const warnings = [];
  if (total > 750 * 1024 * 1024) {
    warnings.push('This project holds more than 750 MB of media in memory. Very large projects can exhaust browser memory; remove unused files or use shorter clips.');
  }
  if (projectDuration(project) > 300) {
    warnings.push('The timeline is longer than five minutes. Export may take a while on slower devices.');
  }

  const cards = assets.map((asset) => {
    const thumb = asset.thumbnail
      ? `<span class="ve-media-thumb" style="background-image:url('${safeUrl(asset.thumbnail)}')" aria-hidden="true"></span>`
      : `<span class="ve-media-thumb is-empty" aria-hidden="true">${asset.type === 'audio' ? '♪' : asset.type === 'image' ? '🖼' : '🎬'}</span>`;
    return `
      <article class="ve-media-card" draggable="true" data-media-id="${asset.id}" aria-label="${escapeHtml(asset.name)}">
        ${thumb}
        <div class="ve-media-info">
          <strong title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</strong>
          <span>${mediaKindLabel(asset)} · ${mediaMeta(asset)}</span>
          <span class="ve-media-detail">${escapeHtml(asset.container || asset.codec || asset.mimeType || '')}</span>
        </div>
        <div class="ve-media-actions">
          <button type="button" class="ve-btn ve-btn-primary ve-btn-xs" data-media-action="add" data-media-id="${asset.id}">Add</button>
          <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-media-action="replace" data-media-id="${asset.id}" title="Replace the selected clip's media">Use</button>
          <button type="button" class="ve-icon-btn" data-media-action="remove" data-media-id="${asset.id}" aria-label="Remove ${escapeHtml(asset.name)} from the project" title="Remove from library">✕</button>
        </div>
      </article>
    `;
  }).join('');

  const errors = (context.importErrors || []).map((message) => `
    <p class="ve-alert ve-alert-warn">${escapeHtml(message)}<button type="button" class="ve-inline-x" data-dismiss-error aria-label="Dismiss error">✕</button></p>
  `).join('');

  return `
    <div class="ve-panel-actions">
      <button type="button" class="ve-btn ve-btn-primary" data-import>Import media</button>
      <span class="ve-small">${assets.length} file${assets.length === 1 ? '' : 's'} · ${formatBytes(total)}</span>
    </div>
    <p class="ve-hint">Tap <strong>Add</strong> to place a file at the playhead, or drag a card onto any compatible track. Media stays in this browser tab.</p>
    ${errors}
    ${warnings.map((text) => `<p class="ve-alert ve-alert-warn">${escapeHtml(text)}</p>`).join('')}
    <div class="ve-media-list">
      ${cards || `<div class="ve-empty"><strong>No media yet</strong><p>Import MP4, MOV, WebM, MKV video; JPG, PNG, WebP, GIF images; or MP3, WAV, M4A, AAC, OGG audio.</p><button type="button" class="ve-btn ve-btn-primary" data-import>Choose files</button></div>`}
    </div>
    ${selection.size && primary ? `<p class="ve-hint">Selected: <strong>${escapeHtml(primary.clip.name || primary.clip.kind)}</strong>. Use <strong>Use</strong> to swap that clip's source file.</p>` : ''}
  `;
}

function textTab() {
  return `
    <div class="ve-panel-actions">
      <button type="button" class="ve-btn ve-btn-primary" data-text-preset="title">Add text</button>
      <span class="ve-small">Placed at the playhead</span>
    </div>
    <p class="ve-hint">Every text preset creates an independent, editable layer. Unicode shaping for Arabic, Urdu, Persian, Hindi, Bengali, Chinese, Japanese, Korean and Cyrillic uses the browser's own text engine.</p>
    <div class="ve-preset-grid">
      ${Object.entries(TEXT_PRESETS).map(([id, preset]) => `
        <button type="button" class="ve-preset" data-text-preset="${id}">
          <span class="ve-preset-sample">${preset.label === 'Heading' ? 'HEAD' : preset.label === 'Lower third' ? 'Name' : 'Aa'}</span>
          <span><strong>${preset.label}</strong><small>${preset.description}</small></span>
        </button>
      `).join('')}
    </div>
    <h3 class="ve-panel-h3">Text tips</h3>
    <ul class="ve-list">
      <li>Select a text clip to change content, font, size, colour, outline, spacing, alignment and timing in Properties.</li>
      <li>Drag the box in the preview to position text; use the corner handles to resize and the round handle to rotate.</li>
      <li>Switch the direction to RTL for Arabic, Urdu or Persian if automatic detection is not what you want.</li>
      <li>Text is drawn into exported frames by the same renderer as the preview.</li>
    </ul>
  `;
}

function audioTab(context) {
  const { project, media } = context;
  const audioTracks = project.tracks.filter((track) => track.kind === 'audio');
  const audioAssets = media.list().filter((asset) => asset.type === 'audio' || (asset.type === 'video' && asset.hasAudio));
  return `
    <div class="ve-panel-actions">
      <button type="button" class="ve-btn ve-btn-primary" data-import>Add audio files</button>
      <span class="ve-small">${audioAssets.length} asset${audioAssets.length === 1 ? '' : 's'}</span>
    </div>
    <label class="ve-field">
      <span>Master volume <output>${Math.round((project.masterVolume ?? 1) * 100)}%</output></span>
      <input type="range" min="0" max="1.5" step="0.01" value="${project.masterVolume ?? 1}" data-master-volume>
    </label>
    <h3 class="ve-panel-h3">Audio tracks</h3>
    <div class="ve-track-list">
      ${audioTracks.map((track) => `
        <div class="ve-track-row">
          <span>${escapeHtml(track.name)}</span>
          <label class="ve-inline-range"><span class="visually-hidden">Volume for ${escapeHtml(track.name)}</span><input type="range" min="0" max="1.5" step="0.05" value="${track.volume}" data-track-volume data-track-id="${track.id}"></label>
          <button type="button" class="ve-icon-btn" data-mix-action="mute" data-track-id="${track.id}" aria-pressed="${track.muted}" title="${track.muted ? 'Unmute' : 'Mute'} ${escapeHtml(track.name)}">${track.muted ? '🔇' : '🔊'}</button>
        </div>
      `).join('') || '<p class="ve-hint">No audio tracks yet. Add one from the timeline toolbar or add an audio file.</p>'}
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-mix-action="add-track">Add audio track</button>
    </div>
    <h3 class="ve-panel-h3">Available audio</h3>
    <div class="ve-media-list">
      ${audioAssets.map((asset) => `
        <article class="ve-media-card is-audio" draggable="true" data-media-id="${asset.id}">
          <span class="ve-media-thumb is-empty" aria-hidden="true">♪</span>
          <div class="ve-media-info">
            <strong>${escapeHtml(asset.name)}</strong>
            <span>${formatClock(asset.duration)} · ${formatBytes(asset.size)}${asset.type === 'video' ? ' · from video' : ''}</span>
          </div>
          <div class="ve-media-actions">
            <button type="button" class="ve-btn ve-btn-primary ve-btn-xs" data-media-action="add" data-media-id="${asset.id}">Add</button>
          </div>
        </article>
      `).join('') || '<p class="ve-hint">Import music, a voiceover or a sound effect to see it here.</p>'}
    </div>
    <p class="ve-hint">Speed changes resample audio, so pitch rises or falls with speed. Keep pitch and time-stretch are not available in this browser-only build.</p>
  `;
}

function overlaysTab(context) {
  const { selection } = context;
  return `
    <p class="ve-hint">Overlays are independent visual layers. Each one can be moved, resized, rotated, cropped, faded, animated and reordered in Layers.</p>
    <h3 class="ve-panel-h3">Shapes</h3>
    <div class="ve-chip-grid">
      ${SHAPE_TYPES.map((shape) => `<button type="button" class="ve-chip" data-shape-type="${shape.id}"><span aria-hidden="true">${shape.icon}</span>${shape.label}</button>`).join('')}
    </div>
    <h3 class="ve-panel-h3">Backgrounds</h3>
    <div class="ve-chip-grid">
      <button type="button" class="ve-chip" data-bg-type="solid"><span aria-hidden="true">▦</span>Solid colour</button>
      <button type="button" class="ve-chip" data-bg-type="gradient"><span aria-hidden="true">▤</span>Gradient</button>
    </div>
    <h3 class="ve-panel-h3">Sticker-like text</h3>
    <div class="ve-sticker-grid">
      ${STICKERS.map((emoji) => `<button type="button" class="ve-sticker" data-sticker="${emoji}" aria-label="Add ${emoji} sticker">${emoji}</button>`).join('')}
    </div>
    <h3 class="ve-panel-h3">Transparent images and logos</h3>
    <p class="ve-hint">Import a PNG or WebP with transparency, then add it to a track above your video. ${selection.size ? 'The selected clip is ready for repositioning in the preview.' : 'Select the image layer to position it directly in the preview.'}</p>
  `;
}

function transitionsTab(context) {
  const located = selectedContext(context);
  const clip = located?.clip || null;
  const prev = located && located.track.kind === 'video' ? previousClip(located.track, clip) : null;
  const current = clip?.transition?.type || 'none';
  const duration = clip?.transition?.duration || context.transitionDuration || 0.5;
  const maxDuration = prev ? Math.max(0.2, Math.min(5, prev.duration, clip.duration)) : 5;

  return `
    <div class="ve-panel-actions">
      <span class="ve-badge">${TRANSITIONS.length} transitions</span>
      <span class="ve-small">${clip ? escapeHtml(clip.name || clip.kind) : 'No clip selected'}</span>
    </div>
    ${clip ? '' : '<p class="ve-alert ve-alert-info">Select a clip that follows another clip on the same video track, then choose a transition.</p>'}
    ${clip && !prev ? '<p class="ve-alert ve-alert-warn">A transition blends one clip into the clip before it on the same track. Add another clip earlier on this track first.</p>' : ''}
    <label class="ve-field">
      <span>Transition length <output>${Number(duration).toFixed(2)} s</output></span>
      <input type="range" min="0.1" max="${maxDuration.toFixed(2)}" step="0.05" value="${Math.min(duration, maxDuration)}" data-transition-duration ${clip ? '' : 'disabled'}>
    </label>
    <label class="ve-check"><input type="checkbox" data-transition-reverse ${clip?.transition?.reverse ? 'checked' : ''} ${clip && current !== 'none' ? '' : 'disabled'}> Reverse direction</label>
    <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-transition="none" ${clip ? '' : 'disabled'}>Remove transition</button>
    <div class="ve-transition-groups">
      ${TRANSITION_GROUPS.map((group) => `
        <section class="ve-transition-group" aria-label="${group.label} transitions">
          <h3 class="ve-panel-h3">${group.label}</h3>
          <div class="ve-transition-grid">
            ${group.items.map(([id, label]) => `
              <button type="button" class="ve-transition${id === current ? ' is-active' : ''}" data-transition="${id}" ${clip && prev ? '' : 'disabled'}>
                <span class="ve-transition-preview" aria-hidden="true"><i></i><i></i></span>
                <span>${label}</span>
              </button>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </div>
    <p class="ve-hint">Transitions are real frame blends rendered by the shared compositor. They apply at the start of the incoming clip and export exactly as previewed.</p>
  `;
}

function filtersTab(context) {
  const located = selectedContext(context);
  const clip = located?.clip || null;
  const canFilter = clip && clip.kind !== 'audio';
  return `
    <div class="ve-panel-actions">
      <span class="ve-badge">${FILTERS.length} filters</span>
      <span class="ve-small">${canFilter ? escapeHtml(clip.name || clip.kind) : 'No visual clip selected'}</span>
    </div>
    ${canFilter ? '' : '<p class="ve-alert ve-alert-info">Select a video, image, text or shape layer to apply a look.</p>'}
    <div class="ve-filter-grid">
      ${FILTERS.map((filter) => `
        <button type="button" class="ve-filter${filter.id === (clip?.filter || 'none') ? ' is-active' : ''}" data-filter="${filter.id}" ${canFilter ? '' : 'disabled'}>
          <span class="ve-filter-swatch" style="filter:${filterCss(filter.id)}" aria-hidden="true"></span>
          <span>${filter.label}</span>
        </button>
      `).join('')}
    </div>
    <label class="ve-field">
      <span>Intensity <output>${Math.round((clip?.filterIntensity ?? 1) * 100)}%</output></span>
      <input type="range" min="0" max="1" step="0.01" value="${clip?.filterIntensity ?? 1}" data-filter-intensity ${canFilter && clip?.filter !== 'none' ? '' : 'disabled'}>
    </label>
    <p class="ve-hint">A filter replaces the previous look instead of stacking. Colour correction controls in Properties refine the result further. Every filter is rendered into the export.</p>
  `;
}

function effectsTab(context) {
  const located = selectedContext(context);
  const clip = located?.clip || null;
  const visual = clip && clip.kind !== 'audio';
  const currentColor = clip?.color || {};
  const activePreset = COLOR_PRESETS.find((preset) =>
    Object.entries(preset.values).every(([key, value]) => Math.abs((currentColor[key] || 0) - value) < 0.5)
  );
  return `
    <div class="ve-panel-actions">
      <span class="ve-badge">Colour and motion</span>
      <span class="ve-small">${visual ? escapeHtml(clip.name || clip.kind) : 'No visual clip selected'}</span>
    </div>
    ${visual ? '' : '<p class="ve-alert ve-alert-info">Select a visual layer to apply a colour preset or entrance animation.</p>'}
    <h3 class="ve-panel-h3">Colour presets</h3>
    <div class="ve-chip-grid">
      ${COLOR_PRESETS.map((preset) => `<button type="button" class="ve-chip${activePreset?.id === preset.id ? ' is-active' : ''}" data-color-preset="${preset.id}" ${visual ? '' : 'disabled'}>${preset.label}</button>`).join('')}
      <button type="button" class="ve-chip" data-color-reset ${visual ? '' : 'disabled'}>Reset colour</button>
    </div>
    <h3 class="ve-panel-h3">Entrance animation</h3>
    <label class="ve-field">
      <span class="visually-hidden">Entrance animation</span>
      <select data-anim="in" ${visual ? '' : 'disabled'}>
        ${ANIMATIONS.map((animation) => `<option value="${animation.id}" ${clip?.inAnim?.type === animation.id ? 'selected' : ''}>${animation.label}</option>`).join('')}
      </select>
    </label>
    <h3 class="ve-panel-h3">Exit animation</h3>
    <label class="ve-field">
      <span class="visually-hidden">Exit animation</span>
      <select data-anim="out" ${visual ? '' : 'disabled'}>
        ${ANIMATIONS.map((animation) => `<option value="${animation.id}" ${clip?.outAnim?.type === animation.id ? 'selected' : ''}>${animation.label}</option>`).join('')}
      </select>
    </label>
    <label class="ve-field">
      <span>Animation length (s)</span>
      <input type="number" min="0.1" max="5" step="0.05" value="${clip?.inAnim?.duration ?? 0.5}" data-anim-duration="in" ${visual ? '' : 'disabled'}>
    </label>
    <label class="ve-field">
      <span>Exit length (s)</span>
      <input type="number" min="0.1" max="5" step="0.05" value="${clip?.outAnim?.duration ?? 0.5}" data-anim-duration="out" ${visual ? '' : 'disabled'}>
    </label>
    <h3 class="ve-panel-h3">Keyframe animation</h3>
    <p class="ve-hint">Select a layer and use the keyframe diamonds in Properties to animate position, scale, rotation and opacity with linear, ease-in, ease-out or ease-in-out interpolation.</p>
  `;
}

function subtitlesTab(context) {
  const { project } = context;
  const subtitles = project.subtitles || { enabled: true, items: [], style: {} };
  const style = subtitles.style || {};
  const items = (subtitles.items || []).slice().sort((a, b) => a.start - b.start);
  return `
    <div class="ve-panel-actions">
      <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-sub-action="add">Add subtitle</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-sub-action="import">Import SRT / VTT</button>
    </div>
    <label class="ve-check"><input type="checkbox" data-sub-enabled ${subtitles.enabled !== false ? 'checked' : ''}> Burn subtitles into the preview and export</label>
    <div class="ve-sub-list">
      ${items.map((item) => `
        <article class="ve-sub-row${item.id === context.selectedSubtitleId ? ' is-selected' : ''}" data-sub-id="${item.id}">
          <div class="ve-sub-times">
            <label><span>Start</span><input type="number" min="0" step="0.05" value="${Number(item.start).toFixed(2)}" data-sub-field="start" data-sub-id="${item.id}"></label>
            <label><span>End</span><input type="number" min="0" step="0.05" value="${Number(item.end).toFixed(2)}" data-sub-field="end" data-sub-id="${item.id}"></label>
            <button type="button" class="ve-icon-btn" data-sub-action="delete" data-sub-id="${item.id}" aria-label="Delete subtitle">✕</button>
          </div>
          <textarea rows="2" data-sub-field="text" data-sub-id="${item.id}" aria-label="Subtitle text">${escapeHtml(item.text || '')}</textarea>
        </article>
      `).join('') || '<p class="ve-hint">No subtitles yet. Add one at the playhead or import an SRT or WebVTT file.</p>'}
    </div>
    <div class="ve-panel-actions">
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-sub-action="export-srt" ${items.length ? '' : 'disabled'}>Download SRT</button>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-sub-action="export-vtt" ${items.length ? '' : 'disabled'}>Download VTT</button>
    </div>
    <details class="ve-details" ${items.length ? '' : 'open'}>
      <summary>Subtitle style</summary>
      <div class="ve-field-grid">
        <label class="ve-field"><span>Font</span>
          <select data-sub-style="font">
            ${['sans', 'serif', 'mono', 'arabic', 'devanagari', 'cjk'].map((font) => `<option value="${font}" ${style.font === font ? 'selected' : ''}>${font}</option>`).join('')}
          </select>
        </label>
        <label class="ve-field"><span>Size</span><input type="number" min="14" max="140" step="1" value="${style.size ?? 44}" data-sub-style="size"></label>
        <label class="ve-field"><span>Text colour</span><input type="color" value="${style.color || '#ffffff'}" data-sub-style="color"></label>
        <label class="ve-field"><span>Background</span><input type="color" value="${style.bgColor || '#000000'}" data-sub-style="bgColor"></label>
        <label class="ve-field"><span>Background opacity</span><input type="range" min="0" max="1" step="0.01" value="${style.bgOpacity ?? 0.62}" data-sub-style="bgOpacity"></label>
        <label class="ve-field"><span>Vertical position</span><input type="range" min="0.1" max="0.95" step="0.01" value="${style.position ?? 0.86}" data-sub-style="position"></label>
        <label class="ve-field"><span>Outline width</span><input type="number" min="0" max="10" step="0.5" value="${style.outlineWidth ?? 0}" data-sub-style="outlineWidth"></label>
        <label class="ve-field"><span>Outline colour</span><input type="color" value="${style.outlineColor || '#000000'}" data-sub-style="outlineColor"></label>
      </div>
      <label class="ve-check"><input type="checkbox" data-sub-style="bold" ${style.bold ? 'checked' : ''}> Bold subtitles</label>
    </details>
    <p class="ve-hint">Subtitles are manual entries or imported SRT/VTT cues. This editor does not perform automatic speech transcription, and it does not upload audio to a service.</p>
  `;
}

function layerList(context) {
  const { project, selection } = context;
  const videoTracks = project.tracks.filter((track) => track.kind === 'video');
  const rows = [];
  videoTracks.forEach((track, trackIndex) => {
    const clips = track.clips.slice().sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      rows.push({ track, clip, trackIndex });
    }
  });
  if (!rows.length) {
    return `<p class="ve-hint">No visual layers yet. Add a video, image, text, shape or background.</p>`;
  }
  return rows.map(({ track, clip, trackIndex }) => {
    const topIndex = trackIndex;
    const bottomIndex = videoTracks.length - 1;
    const selected = selection.has(clip.id);
    return `
      <article class="ve-layer${selected ? ' is-selected' : ''}${clip.hidden ? ' is-hidden' : ''}" draggable="true" data-layer-row data-clip-id="${clip.id}" data-track-id="${track.id}">
        <span class="ve-layer-grip" aria-hidden="true">⠿</span>
        <button type="button" class="ve-layer-main" data-layer-action="select" data-clip-id="${clip.id}">
          <strong>${clip.kind === 'text' ? 'T' : clip.kind === 'shape' ? '◆' : clip.kind === 'background' ? '▦' : clip.kind === 'image' ? '🖼' : '🎬'} ${escapeHtml(clip.name || clip.kind)}</strong>
          <small>${escapeHtml(track.name)} · ${formatClock(clip.start)} · ${clip.hidden ? 'hidden' : clip.locked ? 'locked' : 'visible'}</small>
        </button>
        <div class="ve-layer-actions">
          <button type="button" class="ve-icon-btn" data-layer-action="up" data-clip-id="${clip.id}" aria-label="Move ${escapeHtml(clip.name)} up one layer" title="Move up one layer" ${topIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="ve-icon-btn" data-layer-action="down" data-clip-id="${clip.id}" aria-label="Move ${escapeHtml(clip.name)} down one layer" title="Move down one layer" ${topIndex === bottomIndex ? 'disabled' : ''}>↓</button>
          <button type="button" class="ve-icon-btn" data-layer-action="front" data-clip-id="${clip.id}" aria-label="Bring ${escapeHtml(clip.name)} to front" title="Bring to front" ${topIndex === 0 ? 'disabled' : ''}>⤒</button>
          <button type="button" class="ve-icon-btn" data-layer-action="back" data-clip-id="${clip.id}" aria-label="Send ${escapeHtml(clip.name)} to back" title="Send to back" ${topIndex === bottomIndex ? 'disabled' : ''}>⤓</button>
          <button type="button" class="ve-icon-btn" data-layer-action="hide" data-clip-id="${clip.id}" aria-pressed="${clip.hidden}" aria-label="${clip.hidden ? 'Show' : 'Hide'} ${escapeHtml(clip.name)}" title="${clip.hidden ? 'Show layer' : 'Hide layer'}">${clip.hidden ? '🚫' : '👁'}</button>
          <button type="button" class="ve-icon-btn" data-layer-action="lock" data-clip-id="${clip.id}" aria-pressed="${clip.locked}" aria-label="${clip.locked ? 'Unlock' : 'Lock'} ${escapeHtml(clip.name)}" title="${clip.locked ? 'Unlock layer' : 'Lock layer'}">${clip.locked ? '🔒' : '🔓'}</button>
          <button type="button" class="ve-icon-btn" data-layer-action="delete" data-clip-id="${clip.id}" aria-label="Delete ${escapeHtml(clip.name)}" title="Delete layer">✕</button>
        </div>
      </article>
    `;
  }).join('');
}

function layersTab(context) {
  return `
    <div class="ve-panel-actions">
      <span class="ve-badge">${context.project.tracks.filter((track) => track.kind === 'video').length} video layers</span>
      <button type="button" class="ve-btn ve-btn-ghost ve-btn-xs" data-layer-action="add-track">Add video track</button>
    </div>
    <p class="ve-hint"><strong>Top of this list renders in front.</strong> Horizontal timeline position controls timing; moving a layer up or down changes only its stacking order.</p>
    <div class="ve-layers" data-layer-list>
      ${layerList(context)}
    </div>
    <p class="ve-hint">Drag a layer row onto another to move it to that track at the same time. Audio layers are managed in the Audio tab and timeline.</p>
  `;
}

export function renderLibraryPanel(context) {
  const tab = tabId(context.tab);
  let body = '';
  if (tab === 'media') body = mediaTab(context);
  else if (tab === 'text') body = textTab();
  else if (tab === 'audio') body = audioTab(context);
  else if (tab === 'overlays') body = overlaysTab(context);
  else if (tab === 'transitions') body = transitionsTab(context);
  else if (tab === 'filters') body = filtersTab(context);
  else if (tab === 'effects') body = effectsTab(context);
  else if (tab === 'subtitles') body = subtitlesTab(context);
  else body = layersTab(context);
  return `<div class="ve-panel-inner" data-tab-panel="${tab}">${body}</div>`;
}

export function layerDragPayload(clipId) {
  return clipId;
}

export { transitionLabel };
