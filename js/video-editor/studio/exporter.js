/* LetitEdit Video Editor — export controller.
 *
 * The worker owns the frame loop and encoder. This controller only prepares a
 * serialisable project, passes the original files, and reports honest
 * progress. The finished blob is read back and measured inside the worker.
 */

import * as MB from '../../../vendor/mediabunny/mediabunny.min.mjs';
import { dimsForResolution, uid } from '../utils.js';

const QUALITY = {
  high: { label: 'High quality' },
  balanced: { label: 'Balanced' },
  small: { label: 'Smaller file' }
};

export class Exporter {
  constructor({ store, media, onStatus }) {
    this.store = store;
    this.media = media;
    this.onStatus = onStatus || (() => {});
    this.worker = null;
    this.exportId = null;
    this.rejectCurrent = null;
    this.canceled = false;
  }

  projectDuration() {
    return this.store.duration();
  }

  referencedAssets() {
    const ids = new Set();
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) {
        if (clip.mediaId) ids.add(clip.mediaId);
      }
    }
    return this.media.list().filter((asset) => ids.has(asset.id));
  }

  missingMedia() {
    const missing = [];
    const seen = new Set();
    for (const track of this.store.project.tracks) {
      for (const clip of track.clips) {
        if (!clip.mediaId || seen.has(clip.mediaId)) continue;
        seen.add(clip.mediaId);
        if (!this.media.has(clip.mediaId)) missing.push(clip.name || 'Unnamed layer');
      }
    }
    return missing;
  }

  async capabilities(width, height) {
    const dims = {
      width: Math.max(2, Math.round(width / 2) * 2),
      height: Math.max(2, Math.round(height / 2) * 2)
    };
    const [mp4, webm, audio] = await Promise.all([
      MB.canEncodeVideo('avc', dims).catch(() => false),
      MB.canEncodeVideo('vp9', dims).catch(() => false),
      MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false)
    ]);
    return { mp4, webm, audio };
  }

  resolveDimensions(resolution) {
    const base = this.store.dimensions();
    if (!resolution || resolution === 'project') return base;
    const ratio = base.width / base.height;
    return dimsForResolution(resolution, ratio);
  }

  buildOptions(overrides = {}) {
    const dims = this.resolveDimensions(overrides.resolution);
    return {
      format: overrides.format === 'webm' ? 'webm' : 'mp4',
      quality: QUALITY[overrides.quality] ? overrides.quality : 'balanced',
      includeAudio: overrides.includeAudio !== false,
      width: dims.width,
      height: dims.height,
      fps: Math.max(1, Math.min(60, Math.round(overrides.fps || this.store.project.fps || 30))),
      duration: this.projectDuration()
    };
  }

  exportToBlob(options, onProgress) {
    if (this.worker) this.cancel();
    const duration = Number(options.duration) || this.projectDuration();
    if (duration <= 0) {
      return Promise.reject(new Error('There is nothing on the timeline to export yet.'));
    }
    const missing = this.missingMedia();
    if (missing.length) {
      return Promise.reject(
        new Error(`These layers are missing their source file: ${missing.slice(0, 4).join(', ')}. Re-import the file first.`)
      );
    }

    const assets = this.referencedAssets();
    const mediaEntries = assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      file: asset.file
    }));

    const project = JSON.parse(JSON.stringify(this.store.project));
    const id = uid('export');
    this.exportId = id;
    this.canceled = false;

    const workerUrl = new URL('../export-worker.js', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    this.worker = worker;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        this.worker = null;
        this.exportId = null;
        this.rejectCurrent = null;
        try {
          worker.terminate();
        } catch (error) {
          /* already gone */
        }
        fn(value);
      };
      this.rejectCurrent = (error) => finish(reject, error);

      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.id && message.id !== id) return;
        if (message.type === 'progress') {
          onProgress?.(Math.max(0, Math.min(1, Number(message.progress) || 0)), message.phase || '');
        } else if (message.type === 'done') {
          const meta = message.meta || {};
          const blob = new Blob([message.buffer], { type: meta.mimeType || (options.format === 'webm' ? 'video/webm' : 'video/mp4') });
          finish(resolve, { blob, meta });
        } else if (message.type === 'error') {
          const error = new Error(message.message || 'The export failed.');
          error.canceled = Boolean(message.canceled);
          finish(reject, error);
        }
      };
      worker.onerror = (event) => {
        finish(reject, new Error(event.message || 'The export worker stopped unexpectedly.'));
      };
      worker.onmessageerror = () => {
        finish(reject, new Error('The export worker could not read its input.'));
      };

      try {
        worker.postMessage({
          type: 'export',
          id,
          project,
          media: mediaEntries,
          options: {
            format: options.format,
            quality: options.quality,
            includeAudio: options.includeAudio !== false,
            width: options.width,
            height: options.height,
            fps: options.fps,
            duration
          }
        });
      } catch (error) {
        finish(reject, new Error(`The export could not start: ${error.message || error}`));
      }
    });
  }

  cancel() {
    if (!this.worker) return;
    this.canceled = true;
    try {
      this.worker.postMessage({ type: 'cancel' });
    } catch (error) {
      /* already stopped */
    }
    const worker = this.worker;
    const reject = this.rejectCurrent;
    setTimeout(() => {
      if (this.worker === worker) {
        try {
          worker.terminate();
        } catch (error) {
          /* already gone */
        }
        this.worker = null;
        this.exportId = null;
        if (reject) {
          const error = new Error('Export canceled.');
          error.canceled = true;
          reject(error);
        }
        this.rejectCurrent = null;
      }
    }, 1200);
  }
}
