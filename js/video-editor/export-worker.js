/* LetitEdit Professional Video Editor — export worker.
 *
 * Renders the composition frame-by-frame with the shared renderer, encodes
 * video with WebCodecs through Mediabunny, mixes every audio track into a
 * 48 kHz stereo bed and muxes a real MP4 or WebM file.
 */

import * as MB from '../../vendor/mediabunny/mediabunny.min.mjs';
import { renderComposition } from './renderer.js';
import { clamp } from './utils.js';

const AUDIO_RATE = 48000;
const AUDIO_CHANNELS = 2;

/* Web Workers do not expose the AudioBuffer interface, but Mediabunny's
 * AudioBufferSink builds one for each decoded chunk and its AudioBufferSource
 * accepts one. This small polyfill supplies exactly the surface used by the
 * decoder, the encoder and the mix loop below. */
if (typeof globalThis.AudioBuffer !== 'function') {
  globalThis.AudioBuffer = class AudioBuffer {
    constructor(options = {}) {
      const numberOfChannels = Math.max(1, Number(options.numberOfChannels) || 1);
      const length = Math.max(0, Math.round(Number(options.length) || 0));
      const sampleRate = Math.max(1, Number(options.sampleRate) || AUDIO_RATE);
      this.numberOfChannels = numberOfChannels;
      this.length = length;
      this.sampleRate = sampleRate;
      this._channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    }

    get duration() {
      return this.sampleRate ? this.length / this.sampleRate : 0;
    }

    getChannelData(channel) {
      return this._channels[channel];
    }

    copyToChannel(source, channel, start = 0) {
      const data = this._channels[channel];
      if (!data) return;
      const count = Math.max(0, Math.min(source.length, data.length - start));
      data.set(source.subarray(0, count), start);
    }

    copyFromChannel(destination, channel, start = 0) {
      const data = this._channels[channel];
      if (!data) return;
      const count = Math.max(0, Math.min(destination.length, data.length - start));
      destination.set(data.subarray(start, start + count), 0);
    }
  };
}

let cancelRequested = false;
let activeOutput = null;

const QUALITY = {
  high: { bpp: 0.16, audio: 192000 },
  balanced: { bpp: 0.1, audio: 128000 },
  small: { bpp: 0.06, audio: 96000 }
};

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelRequested = true;
    return;
  }
  if (message.type === 'export') {
    cancelRequested = false;
    runExport(message).catch((error) => {
      finishOutput();
      self.postMessage({
        type: 'error',
        id: message.id,
        message: error && error.message ? error.message : String(error),
        canceled: cancelRequested || /cancel/i.test(String(error && error.message))
      });
    });
  }
};

function checkCancel() {
  if (cancelRequested) throw new Error('Conversion canceled.');
}

function postProgress(id, progress, phase) {
  self.postMessage({
    type: 'progress',
    id,
    progress: clamp(progress, 0, 1),
    phase
  });
}

async function finishOutput() {
  if (!activeOutput) return;
  try {
    await activeOutput.cancel?.();
  } catch (error) {
    /* already finished */
  }
  activeOutput = null;
}

function bucketSize(value) {
  if (value <= 480) return 480;
  if (value <= 720) return 720;
  if (value <= 1080) return 1080;
  if (value <= 1440) return 1440;
  return 2160;
}

class WorkerSource {
  constructor() {
    this.assets = new Map();
  }

  async add(file, type, name) {
    const blob = file && file.file ? file.file : file;
    if (type === 'image') {
      const bitmap = await createImageBitmap(blob);
      this.assets.set(file.id, { type: 'image', bitmap });
      return;
    }
    const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
    if (type === 'video') {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error(`${name}: no video track.`);
      const decodable = await videoTrack.canDecode().catch(() => false);
      if (!decodable) throw new Error(`${name}: this browser cannot decode the video track.`);
      const duration = await input.computeDuration().catch(() => 0);
      const width = await videoTrack.getDisplayWidth().catch(() => 0);
      const height = await videoTrack.getDisplayHeight().catch(() => 0);
      let audioTrack = null;
      try {
        audioTrack = await input.getPrimaryAudioTrack();
        if (audioTrack && !(await audioTrack.canDecode().catch(() => false))) audioTrack = null;
      } catch (error) {
        audioTrack = null;
      }
      this.assets.set(file.id, {
        type: 'video',
        input,
        videoTrack,
        audioTrack,
        duration,
        width,
        height,
        sinks: new Map()
      });
      return;
    }
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error(`${name}: no audio track.`);
    const decodable = await audioTrack.canDecode().catch(() => false);
    if (!decodable) throw new Error(`${name}: this browser cannot decode the audio track.`);
    this.assets.set(file.id, { type: 'audio', input, audioTrack });
  }

  async getFrame(id, time, maxDimension) {
    const asset = this.assets.get(id);
    if (!asset || asset.type !== 'video') return null;
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
    const clamped = Math.max(0, Math.min(time, Math.max(0, (asset.duration || 0) - 0.002)));
    const result = await sink.getCanvas(clamped);
    return result ? result.canvas : null;
  }

  getImage(id) {
    const asset = this.assets.get(id);
    return asset && asset.type === 'image' ? asset.bitmap : null;
  }

  dispose() {
    for (const asset of this.assets.values()) {
      try {
        asset.input?.dispose?.();
      } catch (error) {
        /* closed */
      }
      try {
        asset.bitmap?.close?.();
      } catch (error) {
        /* closed */
      }
      asset.sinks?.clear?.();
    }
    this.assets.clear();
  }
}

async function mixAudio(project, source, duration) {
  const totalFrames = Math.max(1, Math.round(duration * AUDIO_RATE));
  const mix = new Float32Array(totalFrames * AUDIO_CHANNELS);
  let hasAudio = false;
  const master = Number.isFinite(project.masterVolume) ? project.masterVolume : 1;

  for (const track of project.tracks) {
    if (track.muted) continue;
    const trackGain = (Number.isFinite(track.volume) ? track.volume : 1) * master;
    if (trackGain <= 0) continue;
    for (const clip of track.clips) {
      checkCancel();
      if (!clip.mediaId) continue;
      if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
      if (clip.muted || clip.hidden || clip.freeze) continue;
      const asset = source.assets.get(clip.mediaId);
      if (!asset || !asset.audioTrack) continue;

      hasAudio = true;
      const clipGain = (Number.isFinite(clip.volume) ? clip.volume : 1) * trackGain;
      const speed = Math.max(0.05, Number(clip.speed) || 1);
      const inPoint = Number(clip.inPoint) || 0;
      const outPoint = Number.isFinite(Number(clip.outPoint)) ? Number(clip.outPoint) : inPoint + clip.duration * speed;
      const rangeStart = Math.min(inPoint, outPoint);
      const rangeEnd = Math.max(inPoint, outPoint);
      const sink = new MB.AudioBufferSink(asset.audioTrack);

      for await (const wrapped of sink.buffers(rangeStart, rangeEnd)) {
        checkCancel();
        const buffer = wrapped.buffer;
        const bufferStart = Number.isFinite(wrapped.timestamp) ? wrapped.timestamp : 0;
        const bufferDuration = wrapped.duration || buffer.duration;
        const sampleRate = buffer.sampleRate;
        const leftChannel = buffer.getChannelData(0);
        const rightChannel = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftChannel;

        let local0;
        let local1;
        if (clip.reverse) {
          local0 = (outPoint - (bufferStart + bufferDuration)) / speed;
          local1 = (outPoint - bufferStart) / speed;
        } else {
          local0 = (bufferStart - inPoint) / speed;
          local1 = (bufferStart + bufferDuration - inPoint) / speed;
        }
        const startLocal = Math.max(0, local0);
        const endLocal = Math.min(clip.duration, local1);
        if (endLocal <= startLocal) continue;

        const outStart = Math.max(0, Math.floor((clip.start + startLocal) * AUDIO_RATE));
        const outEnd = Math.min(totalFrames, Math.ceil((clip.start + endLocal) * AUDIO_RATE));

        for (let frame = outStart; frame < outEnd; frame += 1) {
          const local = frame / AUDIO_RATE - clip.start;
          if (local < 0 || local >= clip.duration) continue;
          const sourceTime = clip.reverse ? outPoint - local * speed : inPoint + local * speed;
          const position = (sourceTime - bufferStart) * sampleRate;
          if (position < 0 || position >= leftChannel.length) continue;
          const index0 = Math.floor(position);
          const index1 = Math.min(leftChannel.length - 1, index0 + 1);
          const fraction = position - index0;
          const left = leftChannel[index0] * (1 - fraction) + leftChannel[index1] * fraction;
          const right = rightChannel[index0] * (1 - fraction) + rightChannel[index1] * fraction;

          let gain = clipGain;
          const fadeIn = Number(clip.fadeIn) || 0;
          if (fadeIn > 0 && local < fadeIn) gain *= local / fadeIn;
          const fadeOut = Number(clip.fadeOut) || 0;
          const remaining = clip.duration - local;
          if (fadeOut > 0 && remaining < fadeOut) gain *= remaining / fadeOut;

          const offset = frame * AUDIO_CHANNELS;
          mix[offset] += left * gain;
          mix[offset + 1] += right * gain;
        }
      }
    }
  }

  return { mix, totalFrames, hasAudio };
}

async function addMixedAudio(audioSource, mix, totalFrames) {
  const chunk = AUDIO_RATE;
  let written = 0;
  while (written < totalFrames) {
    checkCancel();
    const length = Math.min(chunk, totalFrames - written);
    const data = new Float32Array(length * AUDIO_CHANNELS);
    for (let i = 0; i < length; i += 1) {
      const sourceIndex = (written + i) * AUDIO_CHANNELS;
      data[i] = clamp(mix[sourceIndex], -1, 1);
      data[length + i] = clamp(mix[sourceIndex + 1], -1, 1);
    }
    const sample = new MB.AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: AUDIO_CHANNELS,
      sampleRate: AUDIO_RATE,
      timestamp: written / AUDIO_RATE
    });
    try {
      await audioSource.add(sample);
    } finally {
      sample.close();
    }
    written += length;
  }
}

async function runExport(message) {
  const { project, media, options } = message;
  const source = new WorkerSource();
  const formatKey = options.format === 'webm' ? 'webm' : 'mp4';
  const qualityKey = QUALITY[options.quality] ? options.quality : 'balanced';
  const quality = QUALITY[qualityKey];
  const width = Math.max(2, Math.round(options.width / 2) * 2);
  const height = Math.max(2, Math.round(options.height / 2) * 2);
  const fps = Math.max(1, Math.min(120, Math.round(options.fps) || 30));
  const duration = Math.max(0.1, Number(options.duration) || 0);

  postProgress(message.id, 0.01, 'prepare');

  for (const entry of media) {
    checkCancel();
    await source.add(entry, entry.type, entry.name);
  }

  const videoCodec = formatKey === 'webm' ? 'vp9' : 'avc';
  const audioCodec = formatKey === 'webm' ? 'opus' : 'aac';
  const videoEncodable = await MB.canEncodeVideo(videoCodec, { width, height }).catch(() => false);
  if (!videoEncodable) {
    throw new Error(
      `${formatKey.toUpperCase()} ${videoCodec.toUpperCase()} ${width}×${height} is not encodable in this browser. Try a smaller resolution or the other format.`
    );
  }

  const pixels = width * height * fps;
  const bitrate = Math.round(clamp(pixels * quality.bpp, 400000, 45000000));
  const target = new MB.BufferTarget();
  const outputFormat = formatKey === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat();
  const output = new MB.Output({ format: outputFormat, target });
  activeOutput = output;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('This browser could not create the export canvas.');

  const videoSource = new MB.CanvasSource(canvas, {
    codec: videoCodec,
    quality: new MB.Quality({ bitrate }),
    keyFrameInterval: 2
  });
  output.addVideoTrack(videoSource);

  const audioSupported = await MB.canEncodeAudio(audioCodec, {
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_RATE
  }).catch(() => false);
  let audioSource = null;
  if (audioSupported) {
    audioSource = new MB.AudioSampleSource({
      codec: audioCodec,
      quality: new MB.Quality({ bitrate: quality.audio })
    });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  /* Video --------------------------------------------------------------- */
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const frameDuration = 1 / fps;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    checkCancel();
    const time = Math.min(duration, frame / fps);
    const length = Math.max(0.0005, Math.min(frameDuration, duration - time));
    await renderComposition(ctx, project, source, time, { maxDimension: Math.max(width, height) });
    await videoSource.add(time, length);
    postProgress(message.id, 0.05 + 0.78 * ((frame + 1) / totalFrames), 'video');
  }

  /* Audio --------------------------------------------------------------- */
  if (audioSource) {
    postProgress(message.id, 0.86, 'audio');
    const { mix, totalFrames: audioFrames, hasAudio } = await mixAudio(project, source, duration);
    if (hasAudio) {
      await addMixedAudio(audioSource, mix, audioFrames);
    }
  }

  postProgress(message.id, 0.96, 'finalize');
  checkCancel();
  await output.finalize();
  activeOutput = null;

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 256) {
    throw new Error('The encoder did not produce a valid video file.');
  }

  const blob = new Blob([buffer], { type: formatKey === 'webm' ? 'video/webm' : 'video/mp4' });
  const check = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
  try {
    const outputDuration = await check.computeDuration();
    const videoTrack = await check.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('The exported file contains no video track.');
    let audioTrack = null;
    try {
      audioTrack = await check.getPrimaryAudioTrack();
    } catch (error) {
      audioTrack = null;
    }
    const codec = await videoTrack.getCodec().catch(() => videoCodec);
    const outWidth = await videoTrack.getDisplayWidth().catch(() => width);
    const outHeight = await videoTrack.getDisplayHeight().catch(() => height);
    const audioCodecOut = audioTrack ? await audioTrack.getCodec().catch(() => audioCodec) : null;
    const audioSampleRate = audioTrack ? await audioTrack.getSampleRate().catch(() => null) : null;
    const audioChannels = audioTrack ? await audioTrack.getNumberOfChannels().catch(() => null) : null;

    if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - duration) > Math.max(0.12, duration * 0.04)) {
      throw new Error(
        `The exported duration (${Number(outputDuration).toFixed(2)} s) does not match the timeline (${duration.toFixed(2)} s).`
      );
    }

    self.postMessage(
      {
        type: 'done',
        id: message.id,
        buffer,
        meta: {
          format: formatKey,
          mimeType: blob.type,
          extension: formatKey === 'webm' ? 'webm' : 'mp4',
          codec,
          audioCodec: audioCodecOut,
          width: outWidth,
          height: outHeight,
          duration: outputDuration,
          fps,
          size: blob.size,
          hasAudio: Boolean(audioTrack),
          audioSampleRate,
          audioChannels,
          bitrate: Math.round((blob.size * 8) / Math.max(0.001, outputDuration)),
          videoBitrate: bitrate,
          quality: qualityKey
        }
      },
      [buffer]
    );
  } finally {
    check.dispose?.();
    source.dispose();
  }
}
