/* LetitEdit Professional Video Editor — local media library.
 * Files never leave the browser. Mediabunny decodes metadata and frames,
 * WebCodecs handles the heavy lifting.
 */

import * as MB from '../../vendor/mediabunny/mediabunny.min.mjs';
import { fileExtension, formatBytes, uid } from './utils.js';

export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'];

const VIDEO_MIME = ['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'video/x-matroska'];
const AUDIO_MIME = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg'];
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'];

export function classifyFile(file) {
  if (!file || !file.name) return null;
  const ext = fileExtension(file.name);
  const mime = String(file.type || '').toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext) || VIDEO_MIME.includes(mime)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext) || AUDIO_MIME.includes(mime)) return 'audio';
  if (IMAGE_EXTENSIONS.includes(ext) || IMAGE_MIME.includes(mime)) return 'image';
  return null;
}

export function validateFile(file) {
  if (!file || !file.name) return 'The file could not be read.';
  if (!file.size) return 'The file is empty.';
  if (file.size > MAX_FILE_BYTES) {
    return `The file is larger than the ${formatBytes(MAX_FILE_BYTES)} limit for browser-side editing.`;
  }
  const type = classifyFile(file);
  if (!type) {
    return 'Unsupported file type. Use MP4, M4V, MOV, WebM, MKV, JPG, PNG, WebP, GIF, MP3, WAV, M4A, AAC or OGG.';
  }
  return null;
}

function extensionFor(type, file) {
  const ext = fileExtension(file.name);
  if (ext) return ext;
  if (type === 'video') return 'mp4';
  if (type === 'audio') return 'mp3';
  return 'png';
}

/** Bucket a requested decode size so we reuse one MediaBunny sink. */
function bucketSize(value) {
  if (value <= 480) return 480;
  if (value <= 720) return 720;
  if (value <= 1080) return 1080;
  if (value <= 1280) return 1280;
  if (value <= 1440) return 1440;
  if (value <= 1920) return 1920;
  return 2160;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

/** Resolve on the next event, or after `timeout` ms, whichever comes first. */
function waitForEvent(target, name, timeout = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      target.removeEventListener(name, finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    target.addEventListener(name, finish, { once: true });
  });
}

/** Resolve once the element has presented a frame, or after `timeout` ms.
 *  A seek updates `currentTime` before the new picture is composited, and
 *  drawing the element in that window produces a black rectangle in Chromium.
 *  `requestVideoFrameCallback` is the only reliable "the new frame is on
 *  screen" signal, so paused/seeked rendering waits for it. */
function waitForPresentedFrame(el, timeout = 220) {
  if (typeof el.requestVideoFrameCallback !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    try {
      el.requestVideoFrameCallback(finish);
    } catch (error) {
      finish();
    }
  });
}

/** Encode a canvas to a Blob on either the main thread (HTMLCanvasElement)
 *  or in a worker/OffscreenCanvas. */
function canvasToBlob(canvas, options) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob(options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The canvas could not be encoded.'))),
      options.type,
      options.quality
    );
  });
}

export class MediaLibrary {
  constructor() {
    this.assets = new Map();
    this.decodeContext = null;
    /* Persistent <video> elements used only by the preview monitor. The
     * browser's own pipeline decodes and presents these frames, so ordinary
     * playback no longer performs a random-access decode per composition
     * frame. Elements are keyed by clip so a split clip can show its own
     * moment of the same file. */
    this.previewVideos = new Map();
    this.onPreviewFrame = null;
  }

  list() {
    return [...this.assets.values()];
  }

  get(id) {
    return this.assets.get(id) || null;
  }

  has(id) {
    return this.assets.has(id);
  }

  async addFile(file) {
    const invalid = validateFile(file);
    if (invalid) throw new Error(invalid);
    const type = classifyFile(file);
    if (!type) throw new Error('Unsupported file type.');

    if (type === 'video') return this.addVideo(file);
    if (type === 'audio') return this.addAudio(file);
    return this.addImage(file);
  }

  async addVideo(file) {
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    let formatName = '';
    let videoTrack = null;
    try {
      const format = await input.getFormat();
      formatName = format ? format.name : '';
      videoTrack = await input.getPrimaryVideoTrack();
    } catch (error) {
      input.dispose?.();
      throw new Error(`${file.name}: this file could not be read as a supported video.`);
    }
    if (!videoTrack) {
      input.dispose?.();
      throw new Error(`${file.name}: no video track was found. Images and audio belong in their own tabs.`);
    }

    let decodable = false;
    try {
      decodable = await videoTrack.canDecode();
    } catch (error) {
      decodable = false;
    }
    if (!decodable) {
      input.dispose?.();
      throw new Error(
        `${file.name}: this browser cannot decode the ${(await videoTrack.getCodec().catch(() => 'unknown')) || 'unknown'} video codec.`
      );
    }

    let duration = 0;
    try {
      duration = await input.computeDuration();
    } catch (error) {
      duration = 0;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      input.dispose?.();
      throw new Error(`${file.name}: this file does not contain a readable video duration.`);
    }

    let width = 0;
    let height = 0;
    try {
      width = await videoTrack.getDisplayWidth();
      height = await videoTrack.getDisplayHeight();
    } catch (error) {
      width = 0;
      height = 0;
    }

    let fps = 30;
    let videoBitrate = 0;
    try {
      const stats = await videoTrack.computePacketStats(90);
      if (stats && Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0) {
        fps = Math.round(stats.averagePacketRate * 1000) / 1000;
      }
      if (stats && Number.isFinite(stats.averageBitrate)) videoBitrate = stats.averageBitrate;
    } catch (error) {
      /* keep defaults */
    }

    let audioTrack = null;
    try {
      audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        const canAudio = await audioTrack.canDecode();
        if (!canAudio) audioTrack = null;
      }
    } catch (error) {
      audioTrack = null;
    }

    let codec = '';
    try {
      codec = (await videoTrack.getCodec()) || '';
    } catch (error) {
      codec = '';
    }

    const thumbnail = await this.videoThumbnail(videoTrack, duration, width, height);
    const id = uid('media');
    const asset = {
      id,
      type: 'video',
      name: file.name,
      file,
      url: null,
      size: file.size,
      mimeType: file.type || 'video/mp4',
      extension: extensionFor('video', file),
      container: formatName,
      codec,
      width,
      height,
      duration,
      fps,
      videoBitrate,
      hasAudio: Boolean(audioTrack),
      thumbnail,
      input,
      videoTrack,
      audioTrack,
      sinks: new Map(),
      bitmap: null,
      peaks: null,
      sampleRate: null,
      channels: null
    };
    this.assets.set(id, asset);
    return asset;
  }

  async videoThumbnail(track, duration, width, height) {
    try {
      const scaleWidth = 320;
      const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
      const sink = new MB.CanvasSink(track, {
        width: scaleWidth,
        height: Math.max(2, Math.round(scaleWidth / ratio)),
        fit: 'contain',
        alpha: false,
        poolSize: 1
      });
      const result = await sink.getCanvas(Math.min(0.1, duration / 2));
      if (!result) return '';
      const blob = await canvasToBlob(result.canvas, { type: 'image/jpeg', quality: 0.75 });
      return URL.createObjectURL(blob);
    } catch (error) {
      this.lastThumbError = error && error.message ? error.message : String(error);
      return '';
    }
  }

  async addAudio(file) {
    let input = null;
    let duration = 0;
    let sampleRate = null;
    let channels = null;
    let codec = '';
    let audioTrack = null;
    try {
      input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
      duration = await input.computeDuration();
      audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) throw new Error('no audio track');
      const decodable = await audioTrack.canDecode();
      if (!decodable) throw new Error('audio codec not decodable');
      sampleRate = await audioTrack.getSampleRate();
      channels = await audioTrack.getNumberOfChannels();
      codec = (await audioTrack.getCodec()) || '';
    } catch (error) {
      input?.dispose?.();
      throw new Error(`${file.name}: this audio file could not be decoded by this browser.`);
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      input?.dispose?.();
      throw new Error(`${file.name}: this audio file has no readable duration.`);
    }

    const buffer = await file.arrayBuffer();
    const decoded = await this.decodeAudio(buffer);
    if (decoded) {
      duration = decoded.duration;
      sampleRate = decoded.sampleRate;
      channels = decoded.numberOfChannels;
    }
    const peaks = decoded ? this.computePeaks(decoded) : null;

    const id = uid('media');
    const asset = {
      id,
      type: 'audio',
      name: file.name,
      file,
      url: null,
      size: file.size,
      mimeType: file.type || 'audio/mpeg',
      extension: extensionFor('audio', file),
      container: '',
      codec,
      width: 0,
      height: 0,
      duration,
      fps: 0,
      videoBitrate: 0,
      hasAudio: true,
      thumbnail: '',
      input,
      videoTrack: null,
      audioTrack,
      sinks: new Map(),
      bitmap: null,
      peaks,
      sampleRate,
      channels
    };
    this.assets.set(id, asset);
    return asset;
  }

  async addImage(file) {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
    } catch (error) {
      throw new Error(`${file.name}: this image could not be decoded by this browser.`);
    }
    if (!bitmap || !bitmap.width) {
      throw new Error(`${file.name}: this image has no readable dimensions.`);
    }
    let thumbnail = '';
    try {
      const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(2, Math.round(bitmap.width * scale)), Math.max(2, Math.round(bitmap.height * scale)));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      thumbnail = URL.createObjectURL(blob);
    } catch (error) {
      thumbnail = '';
    }

    const id = uid('media');
    const asset = {
      id,
      type: 'image',
      name: file.name,
      file,
      url: null,
      size: file.size,
      mimeType: file.type || 'image/png',
      extension: extensionFor('image', file),
      container: '',
      codec: '',
      width: bitmap.width,
      height: bitmap.height,
      duration: 0,
      fps: 0,
      videoBitrate: 0,
      hasAudio: false,
      thumbnail,
      input: null,
      videoTrack: null,
      audioTrack: null,
      sinks: new Map(),
      bitmap,
      peaks: null,
      sampleRate: null,
      channels: null
    };
    this.assets.set(id, asset);
    return asset;
  }

  async decodeAudio(arrayBuffer) {
    try {
      if (!this.decodeContext) {
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) return null;
        this.decodeContext = new Ctx(1, 1, 48000);
      }
      const copy = arrayBuffer.slice(0);
      return await this.decodeContext.decodeAudioData(copy);
    } catch (error) {
      return null;
    }
  }

  computePeaks(audioBuffer, buckets = 480) {
    try {
      const channel = audioBuffer.getChannelData(0);
      const step = Math.max(1, Math.floor(channel.length / buckets));
      const peaks = new Float32Array(buckets);
      for (let i = 0; i < buckets; i += 1) {
        let max = 0;
        const start = i * step;
        for (let j = 0; j < step; j += 1) {
          const value = Math.abs(channel[start + j] || 0);
          if (value > max) max = value;
        }
        peaks[i] = max;
      }
      return peaks;
    } catch (error) {
      return null;
    }
  }

  /** Return a decoded canvas frame for a video asset at a source time. */
  async frameAt(mediaId, sourceTime, maxDimension = 1280) {
    const asset = this.assets.get(mediaId);
    if (!asset || asset.type !== 'video' || !asset.videoTrack) return null;
    const bucket = bucketSize(maxDimension);
    let sink = asset.sinks.get(bucket);
    if (!sink) {
      const ratio = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9;
      let width;
      let height;
      if (ratio >= 1) {
        width = Math.min(asset.width || bucket, bucket);
        height = Math.max(2, Math.round(width / ratio));
      } else {
        height = Math.min(asset.height || bucket, bucket);
        width = Math.max(2, Math.round(height * ratio));
      }
      sink = new MB.CanvasSink(asset.videoTrack, {
        width,
        height,
        fit: 'contain',
        alpha: false,
        poolSize: 2
      });
      asset.sinks.set(bucket, sink);
    }
    const clamped = Math.max(0, Math.min(sourceTime, Math.max(0, asset.duration - 0.002)));
    try {
      const result = await sink.getCanvas(clamped);
      return result ? result.canvas : null;
    } catch (error) {
      return null;
    }
  }

  getImage(mediaId) {
    const asset = this.assets.get(mediaId);
    if (!asset || asset.type !== 'image') return null;
    return asset.bitmap;
  }

  /* ------------------------------------------------------------------ */
  /* Preview video elements                                             */
  /* ------------------------------------------------------------------ */

  supportsFrameCallback() {
    return (
      typeof HTMLVideoElement !== 'undefined' &&
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function'
    );
  }

  /** A stable blob URL for any file (video elements and preview audio). */
  fileUrl(mediaId) {
    const asset = this.assets.get(mediaId);
    if (!asset || !asset.file) return '';
    if (!asset.fileUrl) {
      try {
        asset.fileUrl = URL.createObjectURL(asset.file);
      } catch (error) {
        return '';
      }
    }
    return asset.fileUrl;
  }

  previewElement(mediaId, clipKey) {
    const asset = this.assets.get(mediaId);
    if (!asset || asset.type !== 'video' || !asset.file) return null;
    const key = `${mediaId}\u0001${clipKey || 'main'}`;
    let entry = this.previewVideos.get(key);
    if (entry && entry.assetId === mediaId) {
      /* Refresh insertion order so trimming evicts the least recently used
         clip, never the one currently on screen. */
      this.previewVideos.delete(key);
      this.previewVideos.set(key, entry);
      return entry;
    }
    if (entry) this.destroyPreviewVideo(key);

    const url = this.fileUrl(mediaId);
    if (!url) return null;
    const el = document.createElement('video');
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    el.src = url;
    /* Keep the element in the document and technically on screen (some
       browsers stop presenting frames for fully detached or off-screen
       videos) but visually invisible and out of the way. */
    el.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
    (document.body || document.documentElement).appendChild(el);

    entry = {
      key,
      assetId: mediaId,
      el,
      frameHandle: null,
      lastFrameAt: 0,
      ready: false,
      failed: false,
      /* Last frame known to be fully presented. Used while the element is
         seeking, because drawing a video mid-seek can paint black. */
      snapshot: null,
      hasSnapshot: false
    };
    this.previewVideos.set(key, entry);

    el.addEventListener('loadeddata', () => {
      entry.ready = true;
      this.capturePreviewFrame(entry);
      this.onPreviewFrame?.();
    });
    el.addEventListener('seeked', () => {
      this.onPreviewFrame?.();
    });
    el.addEventListener('error', () => {
      entry.failed = true;
    });
    this.attachPreviewFrameCallback(entry);
    el.load();
    this.trimPreviewVideos();
    return entry;
  }

  attachPreviewFrameCallback(entry) {
    if (!this.supportsFrameCallback()) return;
    const el = entry.el;
    const onFrame = () => {
      if (this.previewVideos.get(entry.key) !== entry) return;
      entry.frameHandle = null;
      entry.lastFrameAt = performance.now();
      this.onPreviewFrame?.();
      try {
        entry.frameHandle = el.requestVideoFrameCallback(onFrame);
      } catch (error) {
        entry.frameHandle = null;
      }
    };
    try {
      entry.frameHandle = el.requestVideoFrameCallback(onFrame);
    } catch (error) {
      entry.frameHandle = null;
    }
  }

  /** Copy the element's currently presented picture into a small canvas.
   *  Called before a seek and after `loadeddata`, never during a seek, so the
   *  copy is always a real frame rather than a black intermediate. */
  capturePreviewFrame(entry, maxEdge = 1280) {
    const el = entry.el;
    if (!el.videoWidth || !el.videoHeight || el.readyState < 2 || el.seeking) return false;
    try {
      if (!entry.snapshot) entry.snapshot = document.createElement('canvas');
      const canvas = entry.snapshot;
      const scale = Math.min(1, maxEdge / Math.max(el.videoWidth, el.videoHeight));
      const width = Math.max(2, Math.round(el.videoWidth * scale));
      const height = Math.max(2, Math.round(el.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.getContext('2d').drawImage(el, 0, 0, width, height);
      entry.hasSnapshot = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  destroyPreviewVideo(key) {
    const entry = this.previewVideos.get(key);
    if (!entry) return;
    this.previewVideos.delete(key);
    try {
      if (entry.frameHandle !== null && typeof entry.el.cancelVideoFrameCallback === 'function') {
        entry.el.cancelVideoFrameCallback(entry.frameHandle);
      }
    } catch (error) {
      /* already cancelled */
    }
    try {
      entry.el.pause();
    } catch (error) {
      /* already paused */
    }
    try {
      entry.el.removeAttribute('src');
      entry.el.load();
    } catch (error) {
      /* already detached */
    }
    entry.el.remove();
  }

  trimPreviewVideos(limit = 8) {
    while (this.previewVideos.size > limit) {
      const oldest = this.previewVideos.keys().next().value;
      this.destroyPreviewVideo(oldest);
    }
  }

  /** Pause every preview element without dropping its decoded frame. */
  pausePreview() {
    for (const entry of this.previewVideos.values()) {
      try {
        entry.el.pause();
      } catch (error) {
        /* already paused */
      }
    }
  }

  disposePreview() {
    for (const key of [...this.previewVideos.keys()]) this.destroyPreviewVideo(key);
  }

  /**
   * Frame source used by the preview renderer. During playback the element is
   * kept playing at the project rate and its latest presented frame is drawn
   * directly; when paused or seeking it is positioned exactly and awaited.
   * Returns a drawable (the element) or null. `frameAt` is only a fallback for
   * the first frame before the element is ready, and for reverse clips.
   */
  async frameForPreview(mediaId, clipKey, sourceTime, options = {}) {
    const asset = this.assets.get(mediaId);
    if (!asset || asset.type !== 'video') return null;
    const time = Math.max(
      0,
      Math.min(Number(sourceTime) || 0, Math.max(0, (asset.duration || 0) - 0.001))
    );

    /* A media element can only move forwards; reverse clips keep the decoder
       path. Reverse playback is rare, so this does not affect normal preview. */
    if (options.reverse) return this.frameAt(mediaId, time, 1280);

    const entry = this.previewElement(mediaId, clipKey);
    if (!entry) return this.frameAt(mediaId, time, 1280);
    const el = entry.el;
    if (entry.failed) return this.frameAt(mediaId, time, 1280);

    const speed = clampNumber(Number(options.speed) || 1, 0.25, 4);
    const projectRate = clampNumber(Number(options.rate) || 1, 0.25, 4);
    const rate = clampNumber(speed * projectRate, 0.0625, 16);

    if (options.playing && !options.freeze) {
      if (el.playbackRate !== rate) {
        try {
          el.playbackRate = rate;
        } catch (error) {
          /* unsupported rate */
        }
      }
      if (el.paused) {
        const promise = el.play();
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
      }
      /* Correct real drift only; small corrections would seek every frame
         and cause the stutter this change is meant to remove. 0.2 s keeps
         the picture close to the audio without visible correction seeks. */
      if (Math.abs(el.currentTime - time) > 0.2) {
        /* Keep the picture that is on screen right now. Chromium can paint
           black for a moment while a seek is in flight, and this snapshot is
           what the monitor shows until the new frame is presented. */
        this.capturePreviewFrame(entry);
        try {
          el.currentTime = time;
        } catch (error) {
          /* seek refused while loading */
        }
      }
      if (el.seeking) return entry.hasSnapshot ? entry.snapshot : null;
      if (el.readyState >= 2 && el.videoWidth > 0) return el;
      if (entry.hasSnapshot) return entry.snapshot;
      /* Formats the media element cannot play (some containers) still have a
         WebCodecs decoder; fall back to it until the element is ready. */
      return this.frameAt(mediaId, time, 1280);
    }

    if (!el.paused) {
      try {
        el.pause();
      } catch (error) {
        /* already paused */
      }
    }
    if (el.readyState < 1) await waitForEvent(el, 'loadedmetadata', 1200);
    if (entry.failed) return this.frameAt(mediaId, time, 1280);
    if (!el.videoWidth) return this.frameAt(mediaId, time, 1280);
    if (el.readyState < 2) await waitForEvent(el, 'loadeddata', 1200);
    if (entry.failed) return this.frameAt(mediaId, time, 1280);
    if (Math.abs(el.currentTime - time) > 0.03) {
      this.capturePreviewFrame(entry);
      try {
        el.currentTime = time;
      } catch (error) {
        /* seek refused while loading */
      }
      await waitForEvent(el, 'seeked', 2500);
      /* `seeked` fires before the new picture is guaranteed to be composited.
         Waiting for the presented frame avoids one black flash per seek. */
      await waitForPresentedFrame(el);
    }
    if (el.readyState >= 2 && el.videoWidth > 0) return el;
    if (entry.hasSnapshot) return entry.snapshot;
    return this.frameAt(mediaId, time, 1280);
  }

  getPeaks(mediaId) {
    const asset = this.assets.get(mediaId);
    return asset && asset.peaks ? asset.peaks : null;
  }

  /** A stable blob URL for preview audio monitoring.
   *  Created once per asset and reused by every clip, so seeking or pausing
   *  never replaces the source and never starts a second copy of the sound. */
  audioUrl(mediaId) {
    const asset = this.assets.get(mediaId);
    if (!asset || !asset.hasAudio || !asset.file) return '';
    if (!asset.audioUrl) {
      try {
        asset.audioUrl = URL.createObjectURL(asset.file);
      } catch (error) {
        return '';
      }
    }
    return asset.audioUrl;
  }

  remove(mediaId) {
    const asset = this.assets.get(mediaId);
    if (!asset) return;
    for (const [key, entry] of [...this.previewVideos]) {
      if (entry.assetId === mediaId) this.destroyPreviewVideo(key);
    }
    if (asset.thumbnail) URL.revokeObjectURL(asset.thumbnail);
    if (asset.url) URL.revokeObjectURL(asset.url);
    if (asset.audioUrl) URL.revokeObjectURL(asset.audioUrl);
    if (asset.fileUrl) URL.revokeObjectURL(asset.fileUrl);
    try {
      asset.input?.dispose?.();
    } catch (error) {
      /* already closed */
    }
    try {
      asset.bitmap?.close?.();
    } catch (error) {
      /* already closed */
    }
    asset.sinks.clear();
    this.assets.delete(mediaId);
  }

  clear() {
    for (const id of [...this.assets.keys()]) this.remove(id);
  }

  /** Re-link a restored project with freshly imported files (matched by name). */
  relink(files) {
    const unmatched = [];
    const links = new Map();
    for (const file of files) {
      const match = this.list().find((asset) => asset.name === file.name) ||
        this.list().find((asset) => decodeURIComponent(asset.name) === file.name);
      if (match) links.set(match.id, file);
      else unmatched.push(file.name);
    }
    return { links, unmatched };
  }
}
