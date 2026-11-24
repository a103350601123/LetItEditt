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
  if (value <= 1440) return 1440;
  return 2160;
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
    if (asset.thumbnail) URL.revokeObjectURL(asset.thumbnail);
    if (asset.url) URL.revokeObjectURL(asset.url);
    if (asset.audioUrl) URL.revokeObjectURL(asset.audioUrl);
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
