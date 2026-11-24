/* LetitEdit editor V3 — real MP4/WebM export with measured read-back. */

import { EXPORT_FORMATS } from '../presets.js';
import { projectAspectValue, projectDimensions, projectDuration } from '../model.js';
import { RESOLUTIONS, deepClone, downloadBlob, sanitizeFilename, uid } from '../utils.js';
import { formatBytes, formatTime, escapeHtml } from './dom.js';

const PRESETS = [
  { id: 'project', label: 'Match canvas' },
  { id: '1080', label: '1080p · Full HD' },
  { id: '720', label: '720p · HD' },
  { id: '480', label: '480p · SD' }
];

const QUALITY = {
  high: { bpp: 0.16, label: 'High' },
  balanced: { bpp: 0.1, label: 'Balanced' },
  small: { bpp: 0.06, label: 'Smaller file' }
};

export class Exporter {
  constructor({ store, media, onStatus, onEdit }) {
    this.store = store;
    this.media = media;
    this.onStatus = onStatus || (() => {});
    this.onEdit = onEdit || (() => {});
    this.root = null;
    this.dialog = null;
    this.state = 'idle';
    this.worker = null;
    this.exportId = '';
    this.progress = 0;
    this.phase = '';
    this.error = '';
    this.result = null;
    this.lastProgressAt = 0;
    this.cancelTimer = 0;
  }

  mount(root) {
    this.root = root;
    this.dialog = root;
    root.addEventListener('click', this.onClick.bind(this));
    root.addEventListener('change', this.onChange.bind(this));
    root.addEventListener('input', this.onChange.bind(this));
    this.dialog.addEventListener('cancel', (event) => {
      if (this.state === 'exporting') {
        event.preventDefault();
        this.requestClose();
      }
    });
    this.render();
  }

  capabilities() {
    return {
      videoEncoder: typeof window.VideoEncoder === 'function',
      audioEncoder: typeof window.AudioEncoder === 'function'
    };
  }

  open() {
    if (!this.capabilities().videoEncoder) {
      this.onStatus('This browser does not expose WebCodecs VideoEncoder, so it cannot encode video. Editing still works; try a current Chrome or Edge release.', 'error');
      return;
    }
    if (projectDuration(this.store.project) <= 0) {
      this.onStatus('Add at least one clip before exporting.', 'warn');
      return;
    }
    this.state = 'idle';
    this.error = '';
    this.result = null;
    this.progress = 0;
    if (!this.store.exportSettings.resolution) this.store.exportSettings.resolution = 'project';
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close() {
    if (this.state === 'exporting') return;
    this.dialog.close();
  }

  requestClose() {
    if (this.state !== 'exporting') {
      this.close();
      return;
    }
    if (window.confirm('Cancel the running export and close this panel?')) this.cancel();
  }

  dimensions(settings = this.store.exportSettings) {
    const project = this.store.project;
    const ratio = projectAspectValue(project);
    if (settings.resolution === 'project') return projectDimensions(project);
    const found = RESOLUTIONS.find((item) => item.id === settings.resolution);
    if (!found) return projectDimensions(project);
    let width;
    let height;
    if (ratio >= 1) {
      width = found.longEdge;
      height = found.longEdge / ratio;
    } else {
      height = found.longEdge;
      width = found.longEdge * ratio;
    }
    return { width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 };
  }

  estimate() {
    const dims = this.dimensions();
    const project = this.store.project;
    const quality = QUALITY[this.store.exportSettings.quality] || QUALITY.balanced;
    const duration = Math.max(0.1, projectDuration(project));
    const bitrate = Math.min(45000000, Math.max(400000, dims.width * dims.height * project.fps * quality.bpp));
    return Math.round((bitrate / 8) * duration + 12000 * duration);
  }

  render() {
    if (!this.root) return;
    const settings = this.store.exportSettings;
    const project = this.store.project;
    const dims = this.dimensions();
    const duration = projectDuration(project);
    const caps = this.capabilities();
    const frames = Math.max(1, Math.ceil(duration * project.fps));
    const busy = this.state === 'exporting';
    this.root.innerHTML = `
      <div class="ve-dialog-card ve-export-dialog">
        <div class="ve-dialog-head">
          <div><span class="ve-panel-eyebrow">Final step</span><h2>Export video</h2><p>Frames are composed by the same renderer as the preview and encoded on this device.</p></div>
          <button type="button" class="ve-icon-btn" data-export-action="close" aria-label="Close export dialog" ${busy ? 'disabled' : ''}>×</button>
        </div>
        <div class="ve-export-body">
          ${this.result ? this.resultMarkup() : this.settingsMarkup(dims, duration, frames, caps, busy)}
        </div>
        <div class="ve-dialog-actions">
          <button type="button" class="ve-btn ve-btn-primary" data-export-action="start" ${busy || !caps.videoEncoder || duration <= 0 || this.result ? 'disabled' : ''}>${busy ? 'Exporting…' : 'Start export'}</button>
          <button type="button" class="ve-btn ve-btn-ghost" data-export-action="cancel" ${busy ? '' : 'disabled'}>Cancel export</button>
          <button type="button" class="ve-btn ve-btn-ghost" data-export-action="close" ${busy ? 'disabled' : ''}>Close</button>
        </div>
      </div>`;
    if (this.result) {
      const video = this.root.querySelector('#ve-export-preview');
      if (video) video.src = this.result.url;
    }
  }

  settingsMarkup(dims, duration, frames, caps, busy) {
    const settings = this.store.exportSettings;
    const quality = QUALITY[settings.quality] || QUALITY.balanced;
    return `
      <div class="ve-export-settings">
        <div class="ve-export-fields">
          <label class="ve-field"><span>Format</span><select data-export-setting="format" ${busy ? 'disabled' : ''}>
            ${EXPORT_FORMATS.map((format) => `<option value="${format.id}" ${settings.format === format.id ? 'selected' : ''}>${escapeHtml(format.label)}</option>`).join('')}
          </select></label>
          <label class="ve-field"><span>Resolution</span><select data-export-setting="resolution" ${busy ? 'disabled' : ''}>
            ${PRESETS.map((preset) => `<option value="${preset.id}" ${settings.resolution === preset.id ? 'selected' : ''}>${escapeHtml(preset.label)}${preset.id === 'project' ? ` · ${dims.width}×${dims.height}` : ''}</option>`).join('')}
          </select></label>
          <label class="ve-field"><span>Quality</span><select data-export-setting="quality" ${busy ? 'disabled' : ''}>
            ${Object.entries(QUALITY).map(([id, item]) => `<option value="${id}" ${settings.quality === id ? 'selected' : ''}>${item.label}</option>`).join('')}
          </select></label>
          <div class="ve-export-summary-card">
            <div><span>Picture</span><strong>${dims.width} × ${dims.height}</strong></div>
            <div><span>Length</span><strong>${formatTime(duration)}</strong></div>
            <div><span>Frame rate</span><strong>${this.store.project.fps} fps</strong></div>
            <div><span>Frames</span><strong>${frames.toLocaleString()}</strong></div>
            <div><span>Estimate</span><strong>≈ ${formatBytes(this.estimate())}</strong></div>
          </div>
          <label class="ve-toggle-row"><span><strong>Include audio</strong><small>${caps.audioEncoder ? 'Every audible clip is mixed to 48 kHz stereo.' : 'This browser cannot encode audio with WebCodecs, so export will be silent.'}</small></span><input type="checkbox" data-export-setting="includeAudio" ${settings.includeAudio && caps.audioEncoder ? 'checked' : ''} ${caps.audioEncoder && !busy ? '' : 'disabled'}></label>
          ${!caps.videoEncoder ? '<p class="ve-alert ve-alert-warn">WebCodecs VideoEncoder is not available. Export is unavailable in this browser.</p>' : ''}
          ${!caps.audioEncoder ? '<p class="ve-alert ve-alert-warn">AudioEncoder is not available. You can still export the picture, and the result will be labelled silent.</p>' : ''}
          <p class="ve-micro">${escapeHtml(quality.label)} quality targets a real bitrate. Encoding takes time proportionate to the timeline length. Cancel stops the worker without producing a download.</p>
        </div>
        <div class="ve-export-progress-wrap ${busy ? '' : 'is-hidden'}">
          <div class="ve-progress-head"><span data-export-phase>${escapeHtml(this.phase || 'Preparing')}</span><strong data-export-percent>${Math.round(this.progress * 100)}%</strong></div>
          <div class="ve-progress-track" role="progressbar" aria-label="Export progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(this.progress * 100)}"><span data-export-bar style="width:${Math.round(this.progress * 100)}%"></span></div>
          <p class="ve-micro">Progress comes from the encoder's real frame and audio stages.</p>
        </div>
        ${this.error ? `<p class="ve-alert ve-alert-error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      </div>`;
  }

  resultMarkup() {
    const meta = this.result.meta;
    return `<div class="ve-export-result">
      <video id="ve-export-preview" controls playsinline preload="metadata"></video>
      <dl class="ve-export-meta">
        <div><dt>File</dt><dd>${escapeHtml(this.result.filename)}</dd></div>
        <div><dt>Format</dt><dd>${escapeHtml(meta.format.toUpperCase())} · ${escapeHtml(meta.codec)}${meta.audioCodec ? ` + ${escapeHtml(meta.audioCodec)}` : ' · silent'}</dd></div>
        <div><dt>Picture</dt><dd>${meta.width} × ${meta.height}</dd></div>
        <div><dt>Measured duration</dt><dd>${Number(meta.duration).toFixed(2)} s</dd></div>
        <div><dt>File size</dt><dd>${formatBytes(meta.size)}</dd></div>
        <div><dt>Audio</dt><dd>${meta.hasAudio ? `${Math.round(meta.audioSampleRate / 1000)} kHz · ${meta.audioChannels} ch` : 'Silent file'}</dd></div>
      </dl>
      <div class="ve-btn-row">
        <button type="button" class="ve-btn ve-btn-primary" data-export-action="download">Download ${escapeHtml(meta.extension.toUpperCase())}</button>
        <button type="button" class="ve-btn ve-btn-ghost" data-export-action="again">Export again</button>
      </div>
      <p class="ve-micro">The preview plays the actual encoded file. These numbers were read back from the container.</p>
    </div>`;
  }

  onClick(event) {
    const button = event.target.closest('[data-export-action]');
    if (!button) return;
    const action = button.dataset.exportAction;
    if (action === 'close') this.requestClose();
    if (action === 'start') this.start();
    if (action === 'cancel') this.cancel();
    if (action === 'download') this.download();
    if (action === 'again') this.reset();
  }

  onChange(event) {
    const control = event.target.closest('[data-export-setting]');
    if (!control) return;
    const key = control.dataset.exportSetting;
    this.store.exportSettings[key] = control.type === 'checkbox' ? control.checked : control.value;
    this.render();
  }

  mediaEntries() {
    return this.media.list().map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      file: asset.file
    }));
  }

  start() {
    if (this.state === 'exporting') return;
    const caps = this.capabilities();
    if (!caps.videoEncoder) {
      this.error = 'This browser does not expose WebCodecs VideoEncoder.';
      this.render();
      return;
    }
    const duration = projectDuration(this.store.project);
    if (duration <= 0) {
      this.error = 'There is nothing on the timeline to export.';
      this.render();
      return;
    }
    const dims = this.dimensions();
    const settings = this.store.exportSettings;
    const id = uid('export');
    let worker;
    try {
      worker = new Worker(new URL('../export-worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      this.error = `The export worker could not start: ${error.message || error}`;
      this.render();
      return;
    }
    this.worker = worker;
    this.exportId = id;
    this.state = 'exporting';
    this.progress = 0;
    this.phase = 'Preparing media and encoders';
    this.error = '';
    this.render();
    worker.onmessage = (event) => this.onWorkerMessage(event.data || {});
    worker.onerror = (event) => {
      this.finishWorker();
      this.state = 'idle';
      this.error = `Export failed: ${event.message || 'the worker stopped unexpectedly.'}`;
      this.render();
      this.onStatus(this.error, 'error');
    };
    worker.postMessage({
      type: 'export',
      id,
      project: deepClone(this.store.project),
      media: this.mediaEntries(),
      options: {
        format: settings.format,
        quality: settings.quality,
        width: dims.width,
        height: dims.height,
        fps: this.store.project.fps,
        duration,
        includeAudio: settings.includeAudio && caps.audioEncoder
      }
    });
  }

  onWorkerMessage(data) {
    if (data.id && data.id !== this.exportId) return;
    if (data.type === 'progress') {
      this.progress = data.progress;
      this.phase = {
        prepare: 'Preparing media and encoders',
        video: 'Compositing and encoding frames',
        audio: 'Mixing audio tracks',
        finalize: 'Finalising the container'
      }[data.phase] || data.phase || 'Working';
      const percent = this.root?.querySelector('[data-export-percent]');
      const bar = this.root?.querySelector('[data-export-bar]');
      const phase = this.root?.querySelector('[data-export-phase]');
      const track = this.root?.querySelector('[role="progressbar"]');
      if (percent) percent.textContent = `${Math.round(this.progress * 100)}%`;
      if (bar) bar.style.width = `${Math.round(this.progress * 100)}%`;
      if (phase) phase.textContent = this.phase;
      if (track) track.setAttribute('aria-valuenow', String(Math.round(this.progress * 100)));
      return;
    }
    if (data.type === 'error') {
      const canceled = data.canceled;
      this.finishWorker();
      this.state = 'idle';
      this.error = canceled ? '' : `Export failed: ${data.message || 'unknown encoder error'}`;
      this.render();
      this.onStatus(canceled ? 'Export cancelled. Nothing was downloaded.' : this.error, canceled ? 'info' : 'error');
      return;
    }
    if (data.type === 'done') {
      const blob = new Blob([data.buffer], { type: data.meta.mimeType });
      const url = URL.createObjectURL(blob);
      if (this.result?.url) URL.revokeObjectURL(this.result.url);
      this.finishWorker();
      this.state = 'done';
      this.result = {
        blob,
        url,
        meta: data.meta,
        filename: `${sanitizeFilename(this.store.project.name, 'video-editor')}.${data.meta.extension}`
      };
      this.progress = 1;
      this.render();
      this.onStatus(`Export finished: ${formatBytes(data.meta.size)}, ${Number(data.meta.duration).toFixed(2)} s.`, 'success');
    }
  }

  finishWorker() {
    clearTimeout(this.cancelTimer);
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
    }
    this.worker = null;
  }

  cancel() {
    if (!this.worker || this.state !== 'exporting') return;
    this.phase = 'Cancelling';
    this.progress = Math.min(this.progress, 0.99);
    this.render();
    try {
      this.worker.postMessage({ type: 'cancel' });
    } catch {
      /* worker already gone */
    }
    this.cancelTimer = setTimeout(() => {
      if (this.state !== 'exporting') return;
      this.finishWorker();
      this.state = 'idle';
      this.error = '';
      this.render();
      this.onStatus('Export cancelled.', 'info');
    }, 3500);
  }

  download() {
    if (!this.result) return;
    downloadBlob(this.result.blob, this.result.filename);
    this.onStatus(`Downloaded ${this.result.filename}.`, 'success');
  }

  reset() {
    if (this.result?.url) URL.revokeObjectURL(this.result.url);
    this.result = null;
    this.state = 'idle';
    this.error = '';
    this.progress = 0;
    this.render();
  }

  async exportToBlob(overrides = {}) {
    const caps = this.capabilities();
    if (!caps.videoEncoder) throw new Error('WebCodecs VideoEncoder is unavailable.');
    const duration = projectDuration(this.store.project);
    if (duration <= 0) throw new Error('The timeline is empty.');
    const settings = { ...this.store.exportSettings, ...overrides };
    const dims = overrides.width && overrides.height
      ? { width: overrides.width, height: overrides.height }
      : this.dimensions(settings);
    const id = uid('export');
    const worker = new Worker(new URL('../export-worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('The export timed out.'));
      }, 300000);
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.id && data.id !== id) return;
        if (data.type === 'progress') return;
        clearTimeout(timeout);
        worker.terminate();
        if (data.type === 'done') {
          resolve({
            blob: new Blob([data.buffer], { type: data.meta.mimeType }),
            meta: data.meta
          });
        } else {
          reject(new Error(data.message || 'Export failed.'));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || 'The export worker stopped unexpectedly.'));
      };
      worker.postMessage({
        type: 'export',
        id,
        project: deepClone(this.store.project),
        media: this.mediaEntries(),
        options: {
          format: settings.format,
          quality: settings.quality,
          width: dims.width,
          height: dims.height,
          fps: this.store.project.fps,
          duration,
          includeAudio: settings.includeAudio && caps.audioEncoder
        }
      });
    });
  }
}
