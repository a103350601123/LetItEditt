/* LetitEdit editor V3 — category panels for media, canvas, text, audio,
 * videos, images, elements, subtitles and recording.
 */

import { formatBytes, formatTime, escapeHtml } from './dom.js';
import { FONT_OPTIONS } from '../model.js';
import { TEXT_PRESETS, SHAPE_TYPES } from '../presets.js';
import { ASPECTS, RESOLUTIONS as ENGINE_RESOLUTIONS } from '../utils.js';

const NAV_ITEMS = [
  { id: 'media', label: 'Media', icon: '▣' },
  { id: 'canvas', label: 'Canvas', icon: '▤' },
  { id: 'text', label: 'Text', icon: 'T' },
  { id: 'audio', label: 'Audio', icon: '♫' },
  { id: 'videos', label: 'Videos', icon: '▶' },
  { id: 'images', label: 'Images', icon: '▧' },
  { id: 'elements', label: 'Elements', icon: '◆' },
  { id: 'subtitles', label: 'Subtitles', icon: 'CC' },
  { id: 'record', label: 'Record', icon: '●' }
];

const EMOJIS = ['✨', '🔥', '🎯', '💡', '❤️', '👏', '🚀', '🎬', '⭐', '💬', '👍', '🎉'];
const MEDIA_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Images' },
  { id: 'audio', label: 'Audio' }
];

export class Panel {
  constructor({ store, media, recorder, onAction, onStatus, onEdit }) {
    this.store = store;
    this.media = media;
    this.recorder = recorder;
    this.onAction = onAction || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onEdit = onEdit || (() => {});
    this.root = null;
    this.search = '';
    this.filter = 'all';
    this.usage = 'all';
    this.importStatus = null;
    this.lastCategory = '';
  }

  mount(root) {
    this.root = root;
    root.addEventListener('click', this.onClick.bind(this));
    root.addEventListener('input', this.onInput.bind(this));
    root.addEventListener('change', this.onChange.bind(this));
    this.store.subscribe((reason) => {
      if (reason === 'playhead' || reason === 'live-drag') return;
      if (this.recorder?.isActive() && this.store.activeCategory === 'record') return;
      this.render();
    });
    this.render();
  }

  setCategory(category) {
    this.store.activeCategory = category;
    this.render();
  }

  setImportStatus(status) {
    this.importStatus = status;
    if (this.store.activeCategory === 'media') this.render();
  }

  usedCount(mediaId) {
    let count = 0;
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) if (clip.mediaId === mediaId) count += 1;
    }
    return count;
  }

  filteredAssets(kind = null) {
    let assets = this.media.list();
    if (kind) assets = assets.filter((asset) => asset.type === kind);
    else if (this.filter !== 'all') assets = assets.filter((asset) => asset.type === this.filter);
    if (this.usage === 'used') assets = assets.filter((asset) => this.usedCount(asset.id) > 0);
    if (this.usage === 'unused') assets = assets.filter((asset) => this.usedCount(asset.id) === 0);
    const query = this.search.trim().toLowerCase();
    if (query) assets = assets.filter((asset) => asset.name.toLowerCase().includes(query));
    return assets;
  }

  render() {
    if (!this.root) return;
    const category = this.store.activeCategory || 'media';
    const item = NAV_ITEMS.find((entry) => entry.id === category) || NAV_ITEMS[0];
    this.root.dataset.category = category;
    let body = '';
    if (category === 'media') body = this.mediaPanel();
    else if (category === 'canvas') body = this.canvasPanel();
    else if (category === 'text') body = this.textPanel();
    else if (category === 'audio') body = this.audioPanel();
    else if (category === 'videos') body = this.videoPanel();
    else if (category === 'images') body = this.imagePanel();
    else if (category === 'elements') body = this.elementsPanel();
    else if (category === 'subtitles') body = this.subtitlesPanel();
    else if (category === 'record') body = this.recordPanel();

    this.root.innerHTML = `
      <header class="ve-panel-head">
        <div>
          <span class="ve-panel-eyebrow">${escapeHtml(item.label)}</span>
          <h2>${escapeHtml(this.headingFor(category))}</h2>
        </div>
        ${this.headAction(category)}
      </header>
      <div class="ve-panel-scroll">${body}</div>`;
    if (category === 'record' && this.recorder) {
      const mount = this.root.querySelector('[data-record-mount]');
      if (mount) this.recorder.mountInto(mount);
    }
    this.restoreFocus();
    this.lastCategory = category;
  }

  restoreFocus() {
    const search = this.root.querySelector('[data-media-search]');
    if (search && this.lastCategory === 'media' && this.search) {
      search.value = this.search;
      search.focus({ preventScroll: true });
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  headingFor(category) {
    return {
      media: 'Your media',
      canvas: 'Canvas & project',
      text: 'Add text',
      audio: 'Audio',
      videos: 'Video clips',
      images: 'Image overlays',
      elements: 'Elements',
      subtitles: 'Subtitles',
      record: 'Record'
    }[category] || '';
  }

  headAction(category) {
    if (!['media', 'videos', 'images', 'audio'].includes(category)) return '<button type="button" class="ve-icon-btn ve-only-mobile" data-mobile-close-panel aria-label="Close panel">×</button>';
    const accept = category === 'videos' ? 'video/*' : category === 'images' ? 'image/*' : category === 'audio' ? 'audio/*' : 'video/*,image/*,audio/*';
    return `<div class="ve-head-actions">
      <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-panel-action="import" data-accept="${accept}">Import</button>
      <button type="button" class="ve-icon-btn ve-only-mobile" data-mobile-close-panel aria-label="Close panel">×</button>
    </div>`;
  }

  mediaPanel() {
    const assets = this.filteredAssets();
    const totalSize = this.media.list().reduce((sum, asset) => sum + (asset.size || 0), 0);
    return `
      <div class="ve-panel-tools">
        <label class="ve-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" data-media-search value="${escapeHtml(this.search)}" placeholder="Search media" aria-label="Search imported media" autocomplete="off">
        </label>
        <div class="ve-chip-row" role="group" aria-label="Filter media by type">
          ${MEDIA_FILTERS.map((item) => `<button type="button" class="ve-filter-chip ${this.filter === item.id ? 'is-on' : ''}" data-media-filter="${item.id}" aria-pressed="${this.filter === item.id}">${item.label}</button>`).join('')}
        </div>
        <div class="ve-usage-filter">
          <button type="button" class="ve-text-tab ${this.usage === 'all' ? 'is-on' : ''}" data-media-usage="all">All</button>
          <button type="button" class="ve-text-tab ${this.usage === 'used' ? 'is-on' : ''}" data-media-usage="used">In timeline</button>
          <button type="button" class="ve-text-tab ${this.usage === 'unused' ? 'is-on' : ''}" data-media-usage="unused">Not used</button>
        </div>
      </div>
      ${this.importStatusMarkup()}
      ${assets.length ? `<div class="ve-asset-list" aria-live="polite">${assets.map((asset) => this.assetCard(asset)).join('')}</div>` : this.emptyMediaMarkup()}
      <div class="ve-drop-zone" data-panel-action="import" data-accept="video/*,image/*,audio/*" tabindex="0" role="button">
        <span class="ve-drop-icon" aria-hidden="true">⇪</span>
        <strong>Drop files here</strong>
        <small>Video, images and audio stay in this browser tab.</small>
      </div>
      <p class="ve-panel-foot">${this.media.list().length} file${this.media.list().length === 1 ? '' : 's'} · ${formatBytes(totalSize)}. Media is decoded locally. Files are stored for restore when browser storage allows.</p>`;
  }

  importStatusMarkup() {
    if (!this.importStatus) return '';
    const items = this.importStatus.items || [];
    return `<div class="ve-import-status ${this.importStatus.done ? 'is-done' : ''}">
      <div><strong>${escapeHtml(this.importStatus.label)}</strong>${this.importStatus.detail ? `<span>${escapeHtml(this.importStatus.detail)}</span>` : ''}</div>
      ${items.length ? `<ul>${items.map((item) => `<li class="${item.ok ? 'ok' : 'bad'}">${escapeHtml(item.name)}${item.message ? ` — ${escapeHtml(item.message)}` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  emptyMediaMarkup() {
    return `<div class="ve-empty-panel">
      <span aria-hidden="true">▣</span>
      <h3>${this.media.list().length ? 'No matching files' : 'Import your first clip'}</h3>
      <p>${this.media.list().length ? 'Change the search or filters to see your media.' : 'Choose video, images or audio from your device. You can also drop them anywhere in the workspace.'}</p>
      <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-panel-action="import" data-accept="video/*,image/*,audio/*">Choose files</button>
    </div>`;
  }

  assetCard(asset) {
    const used = this.usedCount(asset.id);
    const duration = asset.type === 'image' ? 'Still image' : formatTime(asset.duration);
    const typeLabel = asset.type === 'video' ? 'Video' : asset.type === 'audio' ? 'Audio' : 'Image';
    return `<article class="ve-asset-card ${used ? 'is-used' : ''}" data-asset-id="${asset.id}" draggable="true">
      <div class="ve-asset-thumb">
        ${asset.thumbnail ? `<img src="${asset.thumbnail}" alt="" loading="lazy">` : `<span class="ve-asset-glyph" aria-hidden="true">${asset.type === 'audio' ? '♫' : '▶'}</span>`}
        <span class="ve-asset-type">${typeLabel}</span>
        ${used ? `<span class="ve-asset-used">${used} in timeline</span>` : ''}
      </div>
      <div class="ve-asset-info">
        <strong title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</strong>
        <small>${duration}${asset.width ? ` · ${asset.width}×${asset.height}` : ''} · ${formatBytes(asset.size)}</small>
        <div class="ve-asset-actions">
          <button type="button" class="ve-mini-btn" data-panel-action="add-asset" data-asset-id="${asset.id}" title="Add to timeline">+ Timeline</button>
          <button type="button" class="ve-icon-mini" data-panel-action="asset-menu" data-asset-id="${asset.id}" aria-label="Media options for ${escapeHtml(asset.name)}" title="Media options">⋯</button>
        </div>
      </div>
    </article>`;
  }

  canvasPanel() {
    const project = this.store.project;
    const dims = this.store.dimensions();
    return `
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Aspect ratio</h3><span>${dims.width}×${dims.height}</span></div>
        <div class="ve-aspect-grid">
          ${ASPECTS.filter((item) => item.id !== '4:5' && item.id !== '3:2').map((item) => `<button type="button" class="ve-aspect ${project.aspect === item.id ? 'is-on' : ''}" data-panel-action="aspect" data-aspect="${item.id}" aria-pressed="${project.aspect === item.id}"><span class="ve-aspect-shape ve-aspect-${item.id.replace(':', '-')}" aria-hidden="true"></span>${item.label.split(' · ')[0]}<small>${item.label.split(' · ')[1] || ''}</small></button>`).join('')}
        </div>
        ${project.aspect === 'custom' ? `<div class="ve-grid-2 ve-margin-top">${this.numberInput('Aspect width', 'project.customAspectW', project.customAspectW, 1, 100)}${this.numberInput('Aspect height', 'project.customAspectH', project.customAspectH, 1, 100)}</div>` : ''}
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Output quality</h3><span>${project.fps} fps</span></div>
        <div class="ve-grid-2">
          <label class="ve-field"><span>Resolution</span><select data-project-prop="resolution">${ENGINE_RESOLUTIONS.filter((item) => !['2160', '1440'].includes(item.id)).map((item) => `<option value="${item.id}" ${project.resolution === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}<option value="custom" ${project.resolution === 'custom' ? 'selected' : ''}>Custom size</option></select></label>
          <label class="ve-field"><span>Frame rate</span><select data-project-prop="fps">${[24, 25, 30, 50, 60].map((fps) => `<option value="${fps}" ${project.fps === fps ? 'selected' : ''}>${fps} fps</option>`).join('')}</select></label>
        </div>
        ${project.resolution === 'custom' ? `<div class="ve-grid-2">${this.numberInput('Width', 'project.customWidth', project.customWidth, 16, 4096)}${this.numberInput('Height', 'project.customHeight', project.customHeight, 16, 4096)}</div>` : ''}
        <p class="ve-micro">MP4 and WebM exports are tested at 480p, 720p and 1080p. Custom dimensions are checked against the device encoder before export.</p>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Background</h3></div>
        <label class="ve-field ve-color-field"><span>Canvas colour</span><span class="ve-color-wrap"><input type="color" data-project-prop="background" value="${escapeHtml(project.background)}"><code>${escapeHtml(project.background)}</code></span></label>
        <p class="ve-micro">MP4 and WebM output in this build is opaque. Add a background layer for patterned canvases.</p>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Workspace guides</h3></div>
        <label class="ve-toggle-row"><span><strong>Centre guides</strong><small>Snap elements to the horizontal and vertical centre.</small></span><input type="checkbox" data-project-boolean="guides.center" ${project.guides?.center ? 'checked' : ''}></label>
        <label class="ve-toggle-row"><span><strong>Safe area</strong><small>Show a title-safe and action-safe frame.</small></span><input type="checkbox" data-project-boolean="guides.safe" ${project.guides?.safe ? 'checked' : ''}></label>
        <label class="ve-field ve-range-field"><span>Preview zoom<output>${Math.round(this.store.previewZoom * 100)}%</output></span><input type="range" min="50" max="250" step="5" value="${Math.round(this.store.previewZoom * 100)}" data-panel-action="preview-zoom" aria-label="Preview zoom"></label>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-panel-action="preview-fit">Fit preview</button>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Master audio</h3><span>${Math.round((project.masterVolume ?? 1) * 100)}%</span></div>
        <input class="ve-range" type="range" min="0" max="1.5" step="0.01" value="${project.masterVolume ?? 1}" data-project-prop="masterVolume" aria-label="Master volume">
      </div>`;
  }

  textPanel() {
    const presets = Object.entries(TEXT_PRESETS);
    return `
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Add a text layer</h3><span>Independent layers</span></div>
        <div class="ve-text-presets">
          ${presets.map(([id, preset]) => `<button type="button" class="ve-text-preset" data-panel-action="add-text" data-text-preset="${id}"><strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.description)}</span><i aria-hidden="true">Aa</i></button>`).join('')}
          <button type="button" class="ve-text-preset" data-panel-action="add-text" data-text-preset="plain"><strong>Plain text</strong><span>An empty, fully editable layer.</span><i aria-hidden="true">T</i></button>
        </div>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Typography</h3></div>
        <label class="ve-field"><span>Font preview</span><select data-panel-action="font-preview">${FONT_OPTIONS.map((font) => `<option value="${font.id}" style="font-family:${font.id === 'arabic' ? 'Tahoma' : font.id === 'cjk' ? 'Microsoft YaHei' : font.id === 'devanagari' ? 'Nirmala UI' : 'system-ui'}">${escapeHtml(font.label)}</option>`).join('')}</select></label>
        <div class="ve-font-preview" aria-live="polite">The quick brown fox · مرحبا · नमस्ते · 日本語</div>
        <p class="ve-micro">Fonts are system stacks with broad script coverage. The selected stack is used in both the preview and exported frames.</p>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Text layers</h3><span>${this.textLayers().length}</span></div>
        ${this.textLayers().length ? `<div class="ve-layer-list">${this.textLayers().map(({ clip }) => `<button type="button" class="ve-layer-row" data-panel-action="select-clip" data-clip-id="${clip.id}"><span>${escapeHtml((clip.text?.content || 'Text').split('\n')[0])}</span><small>${formatTime(clip.start)} · ${formatTime(clip.duration)}</small></button>`).join('')}</div>` : '<p class="ve-empty-inline">No text layers yet. Add a title, subtitle, heading, quote or caption above.</p>'}
      </div>`;
  }

  textLayers() {
    return this.store.project.tracks.flatMap((track) => track.clips.filter((clip) => clip.kind === 'text').map((clip) => ({ track, clip })));
  }

  audioPanel() {
    const assets = this.filteredAssets('audio');
    const tracks = this.store.project.tracks.filter((track) => track.kind === 'audio');
    return `
      <div class="ve-panel-actions">
        <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-panel-action="import" data-accept="audio/*">Import audio</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-panel-action="open-record" data-record-mode="audio">Record voice</button>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Audio files</h3><span>${assets.length}</span></div>
        ${assets.length ? `<div class="ve-asset-list ve-asset-list-compact">${assets.map((asset) => this.assetCard(asset)).join('')}</div>` : '<p class="ve-empty-inline">No audio imported. Add music, a voiceover or record with your microphone.</p>'}
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Tracks</h3><span>${tracks.length}</span></div>
        ${tracks.map((track) => `<div class="ve-audio-track" data-audio-track="${track.id}">
          <div><strong>${escapeHtml(track.name)}</strong><small>${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}</small></div>
          <button type="button" class="ve-mini-btn ${track.muted ? 'is-on' : ''}" data-panel-action="track-mute" data-track-id="${track.id}" aria-pressed="${track.muted}">${track.muted ? 'Muted' : 'Mute'}</button>
          <input class="ve-range" type="range" min="0" max="1.5" step="0.01" value="${track.volume ?? 1}" data-track-volume="${track.id}" aria-label="Volume for ${escapeHtml(track.name)}">
        </div>`).join('')}
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-panel-action="add-audio-track">Add audio track</button>
      </div>
      <p class="ve-micro">Preview monitoring mixes every audible clip. Export resamples the mix to 48 kHz stereo. Speed changes alter pitch; pitch-preserving stretching is not implemented.</p>`;
  }

  videoPanel() {
    return this.mediaKindPanel('video', 'Video clips', 'Import video', 'video/*',
      'Trim, split, layer and adjust clips in the timeline and inspector. Every visual change reaches the export.');
  }

  imagePanel() {
    return this.mediaKindPanel('image', 'Images', 'Import images', 'image/*',
      'Images are overlays with transform, crop, duration and colour controls. Transparent PNG alpha is preserved through composition.');
  }

  mediaKindPanel(kind, title, action, accept, note) {
    const assets = this.filteredAssets(kind);
    return `
      <div class="ve-panel-actions">
        <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-panel-action="import" data-accept="${accept}">${action}</button>
      </div>
      ${assets.length ? `<div class="ve-asset-list">${assets.map((asset) => this.assetCard(asset)).join('')}</div>` : `<div class="ve-empty-panel"><span aria-hidden="true">${kind === 'video' ? '▶' : '▧'}</span><h3>No ${kind}s imported</h3><p>${note}</p><button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-panel-action="import" data-accept="${accept}">${action}</button></div>`}
      <p class="ve-panel-foot">${note}</p>`;
  }

  elementsPanel() {
    return `
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Shapes</h3><span>Vector layers</span></div>
        <div class="ve-shape-grid">
          ${SHAPE_TYPES.map((shape) => `<button type="button" class="ve-shape" data-panel-action="add-shape" data-shape="${shape.id}"><span class="ve-shape-icon ve-shape-${shape.id}" aria-hidden="true">${shape.id === 'rect' ? '' : shape.icon}</span><strong>${escapeHtml(shape.label)}</strong></button>`).join('')}
          <button type="button" class="ve-shape" data-panel-action="add-shape" data-shape="badge"><span class="ve-shape-icon ve-shape-badge" aria-hidden="true"></span><strong>Badge</strong></button>
        </div>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Backgrounds</h3><span>Full canvas</span></div>
        <div class="ve-bg-grid">
          ${['solid', 'blue', 'sun', 'ocean', 'mint', 'night'].map((kind) => `<button type="button" class="ve-bg-swatch ve-bg-${kind}" data-panel-action="add-background" data-background="${kind}" title="${kind} background" aria-label="${kind} background"></button>`).join('')}
        </div>
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Stickers & emoji</h3><span>Unicode</span></div>
        <div class="ve-emoji-grid">
          ${EMOJIS.map((emoji) => `<button type="button" class="ve-emoji" data-panel-action="add-emoji" data-emoji="${emoji}" aria-label="Add ${emoji} sticker">${emoji}</button>`).join('')}
        </div>
      </div>
      <p class="ve-micro">Shapes, backgrounds and emoji are independent visual layers. They can be moved, resized, rotated, animated and exported. Animated GIF export is not included; imported GIFs use their first frame.</p>`;
  }

  subtitlesPanel() {
    const project = this.store.project;
    const items = project.subtitles.items;
    const style = project.subtitles.style;
    return `
      <div class="ve-panel-actions ve-wrap">
        <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-panel-action="add-subtitle">Add cue</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-panel-action="import-subtitles">Import SRT/VTT</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-panel-action="export-srt">Export SRT</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-panel-action="export-vtt">Export VTT</button>
      </div>
      <label class="ve-toggle-row"><span><strong>Burn subtitles into output</strong><small>The export renderer draws styled cues at their timestamps.</small></span><input type="checkbox" data-project-boolean="subtitles.enabled" ${project.subtitles.enabled ? 'checked' : ''}></label>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Cues</h3><span>${items.length}</span></div>
        ${items.length ? `<div class="ve-cue-list">${items.map((item, index) => `<div class="ve-cue-row ${this.store.selectedSubtitle === item.id ? 'is-selected' : ''}" data-cue-id="${item.id}">
          <button type="button" class="ve-cue-main" data-panel-action="select-subtitle" data-subtitle-id="${item.id}"><span>${index + 1}</span><strong>${escapeHtml(item.text || 'Empty cue')}</strong><small>${formatTime(item.start)} → ${formatTime(item.end)}</small></button>
          <button type="button" class="ve-icon-mini" data-panel-action="duplicate-subtitle" data-subtitle-id="${item.id}" title="Duplicate cue" aria-label="Duplicate cue">⧉</button>
          <button type="button" class="ve-icon-mini" data-panel-action="delete-subtitle" data-subtitle-id="${item.id}" title="Delete cue" aria-label="Delete cue">×</button>
        </div>`).join('')}</div>` : '<p class="ve-empty-inline">No cues yet. Add one manually or import an SRT or WebVTT file. Automatic speech transcription is not offered.</p>'}
      </div>
      <div class="ve-panel-section">
        <div class="ve-section-head"><h3>Default cue style</h3></div>
        <div class="ve-grid-2">
          <label class="ve-field"><span>Font</span><select data-subtitle-style="font">${FONT_OPTIONS.map((font) => `<option value="${font.id}" ${style.font === font.id ? 'selected' : ''}>${escapeHtml(font.label)}</option>`).join('')}</select></label>
          <label class="ve-field"><span>Size</span><input type="number" data-subtitle-style="size" value="${style.size}" min="8" max="200" step="1"></label>
          <label class="ve-field ve-color-field"><span>Text</span><span class="ve-color-wrap"><input type="color" data-subtitle-style="color" value="${style.color}"><code>${style.color}</code></span></label>
          <label class="ve-field ve-color-field"><span>Background</span><span class="ve-color-wrap"><input type="color" data-subtitle-style="bgColor" value="${style.bgColor}"><code>${style.bgColor}</code></span></label>
          <label class="ve-field"><span>Background opacity</span><input type="range" data-subtitle-style="bgOpacity" value="${style.bgOpacity}" min="0" max="1" step="0.01"></label>
          <label class="ve-field"><span>Vertical position</span><input type="range" data-subtitle-style="position" value="${style.position}" min="0.05" max="0.95" step="0.01"></label>
        </div>
      </div>
      <p class="ve-micro">SRT and VTT import and export are local text-file operations. Styling is burned into the exported picture; a separate soft-subtitle track is not muxed.</p>`;
  }

  recordPanel() {
    return '<div data-record-mount class="ve-record-mount"></div>';
  }

  numberInput(label, prop, value, min, max) {
    return `<label class="ve-field ve-field-compact"><span>${escapeHtml(label)}</span><input type="number" data-project-prop="${prop}" value="${value}" min="${min}" max="${max}" step="1"></label>`;
  }

  onClick(event) {
    const actionEl = event.target.closest('[data-panel-action]');
    const filter = event.target.closest('[data-media-filter]');
    const usage = event.target.closest('[data-media-usage]');
    if (filter) {
      this.filter = filter.dataset.mediaFilter;
      this.render();
      return;
    }
    if (usage) {
      this.usage = usage.dataset.mediaUsage;
      this.render();
      return;
    }
    if (actionEl) {
      const action = actionEl.dataset.panelAction;
      if (action === 'preview-zoom') return;
      this.onAction(action, {
        ...actionEl.dataset,
        event,
        element: actionEl,
        panel: this
      });
    }
  }

  onInput(event) {
    const search = event.target.closest('[data-media-search]');
    if (search) {
      this.search = search.value;
      const position = search.selectionStart;
      this.render();
      const next = this.root.querySelector('[data-media-search]');
      if (next) {
        next.focus({ preventScroll: true });
        next.setSelectionRange(position, position);
      }
      return;
    }
    const zoom = event.target.closest('[data-panel-action="preview-zoom"]');
    if (zoom) {
      this.onAction('preview-zoom', { value: Number(zoom.value) });
      return;
    }
    const trackVolume = event.target.closest('[data-track-volume]');
    if (trackVolume) {
      this.onAction('track-volume', { trackId: trackVolume.dataset.trackVolume, value: Number(trackVolume.value) });
      return;
    }
    const projectProp = event.target.closest('[data-project-prop]');
    if (projectProp) {
      this.onAction('project-prop', { path: projectProp.dataset.projectProp, value: projectProp.value, live: true, element: projectProp });
      return;
    }
    const subtitleStyle = event.target.closest('[data-subtitle-style]');
    if (subtitleStyle) {
      this.onAction('subtitle-style', { key: subtitleStyle.dataset.subtitleStyle, value: subtitleStyle.value, live: true });
      return;
    }
    const boolean = event.target.closest('[data-project-boolean]');
    if (boolean) {
      this.onAction('project-boolean', { path: boolean.dataset.projectBoolean, value: boolean.checked });
    }
  }

  onChange(event) {
    const projectProp = event.target.closest('[data-project-prop]');
    if (projectProp) {
      this.onAction('project-prop', { path: projectProp.dataset.projectProp, value: projectProp.value, live: false, element: projectProp });
      return;
    }
    const subtitleStyle = event.target.closest('[data-subtitle-style]');
    if (subtitleStyle) {
      this.onAction('subtitle-style', { key: subtitleStyle.dataset.subtitleStyle, value: subtitleStyle.value, live: false });
    }
  }
}

export { NAV_ITEMS };
