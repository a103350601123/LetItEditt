/* Video Converter worker.
 * Decodes, re-encodes and muxes video, or extracts and encodes audio, entirely
 * in the browser with Mediabunny (MPL-2.0) + WebCodecs. MP3 encoding uses the
 * self-hosted LAME port (@breezystack/lamejs, LGPL-2.1) registered as a
 * Mediabunny custom audio encoder. No network requests, no server, no upload. */

import * as MB from '../vendor/mediabunny/mediabunny.min.mjs';

const MAX_OUTPUT_EDGE = 4096;
const VIDEO_AUDIO_RATE = 48000;
const VIDEO_AUDIO_CHANNELS = 2;
const MIN_VIDEO_BITRATE = 20000;
const MAX_VIDEO_BITRATE = 100000000;

// Container -> codecs this engine can mux. The controller asks the browser
// which of these it can actually encode at the chosen size before exposing them.
const VIDEO_FORMATS = {
  mp4: {
    codecs: ['avc', 'hevc'],
    audioCodec: 'aac',
    mimeType: 'video/mp4',
    extension: 'mp4',
    make: () => new MB.Mp4OutputFormat()
  },
  webm: {
    codecs: ['vp9', 'vp8', 'av1'],
    audioCodec: 'opus',
    mimeType: 'video/webm',
    extension: 'webm',
    make: () => new MB.WebMOutputFormat()
  },
  mov: {
    codecs: ['avc', 'hevc'],
    audioCodec: 'aac',
    mimeType: 'video/quicktime',
    extension: 'mov',
    make: () => new MB.MovOutputFormat()
  },
  mkv: {
    codecs: ['avc', 'hevc', 'vp9', 'av1'],
    audioCodec: 'aac',
    mimeType: 'video/x-matroska',
    extension: 'mkv',
    make: () => new MB.MkvOutputFormat()
  }
};

const AUDIO_FORMATS = {
  mp3: {
    codec: 'mp3',
    mimeType: 'audio/mpeg',
    extension: 'mp3',
    compressed: true,
    make: () => new MB.Mp3OutputFormat()
  },
  wav: {
    codec: 'pcm-s16',
    mimeType: 'audio/wav',
    extension: 'wav',
    compressed: false,
    make: () => new MB.WavOutputFormat()
  },
  m4a: {
    codec: 'aac',
    mimeType: 'audio/mp4',
    extension: 'm4a',
    compressed: true,
    make: () => new MB.Mp4OutputFormat()
  },
  aac: {
    codec: 'aac',
    mimeType: 'audio/aac',
    extension: 'aac',
    compressed: true,
    make: () => new MB.AdtsOutputFormat()
  }
};

let activeOutput = null;
let cancelRequested = false;
let mp3EncoderPromise = null;

function openInput(blob) {
  return new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
}

function checkCancel() {
  if (cancelRequested) throw new Error('Conversion canceled.');
}

function postProgress(id, progress, details = {}) {
  self.postMessage({
    id,
    type: 'progress',
    progress: Math.max(0, Math.min(1, progress)),
    ...details
  });
}

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function trackBitrate(track) {
  if (!track) return null;
  try {
    const value = await track.getBitrate();
    if (Number.isFinite(value) && value > 0) return value;
  } catch (error) {
    /* Bitrate metadata is optional. */
  }
  try {
    const stats = await track.computePacketStats(120);
    if (stats && Number.isFinite(stats.averageBitrate) && stats.averageBitrate > 0) {
      return stats.averageBitrate;
    }
  } catch (error) {
    /* Packet statistics are optional. */
  }
  return null;
}

/* --------------------------------------------------------------------------
 * MP3 encoder
 * ------------------------------------------------------------------------ */

async function ensureMp3Encoder() {
  if (!mp3EncoderPromise) {
    mp3EncoderPromise = (async () => {
      const { Mp3Encoder } = await import('../vendor/lamejs/lamejs.mjs');

      class LameMp3Encoder extends MB.CustomAudioEncoder {
        static supports(codec, config) {
          if (codec !== 'mp3') return false;
          if (![32000, 44100, 48000].includes(config.sampleRate)) return false;
          if (!(config.numberOfChannels >= 1 && config.numberOfChannels <= 2)) return false;
          const bitrate = Number(config.bitrate);
          return Number.isFinite(bitrate) && bitrate >= 32000 && bitrate <= 320000;
        }

        async init() {
          const kbps = Math.round(Number(this.config.bitrate) / 1000);
          this.encoder = new Mp3Encoder(this.config.numberOfChannels, this.config.sampleRate, kbps);
          this.left = new Float32Array(0);
          this.right = new Float32Array(0);
          this.nextTimestamp = 0;
          this.frameSize = 1152;
        }

        emit(bytes, duration) {
          if (!bytes || !bytes.length) return;
          this.onPacket(
            new MB.EncodedPacket(new Uint8Array(bytes), 'key', this.nextTimestamp, duration)
          );
          this.nextTimestamp += duration;
        }

        pushFrame() {
          const frame = this.frameSize;
          const left = new Int16Array(frame);
          const right = new Int16Array(frame);
          for (let index = 0; index < frame; index += 1) {
            left[index] = Math.max(-32768, Math.min(32767, Math.round(this.left[index] * 32767)));
            if (this.config.numberOfChannels > 1) {
              right[index] = Math.max(-32768, Math.min(32767, Math.round(this.right[index] * 32767)));
            }
          }
          const bytes = this.config.numberOfChannels > 1
            ? this.encoder.encodeBuffer(left, right)
            : this.encoder.encodeBuffer(left);
          this.emit(bytes, frame / this.config.sampleRate);
          this.left = this.left.slice(frame);
          this.right = this.right.slice(frame);
        }

        async encode(audioSample) {
          const frames = audioSample.numberOfFrames;
          const channels = audioSample.numberOfChannels;
          const left = new Float32Array(frames);
          audioSample.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
          const right = new Float32Array(frames);
          if (channels > 1) {
            audioSample.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
          } else {
            right.set(left);
          }

          const mergedLeft = new Float32Array(this.left.length + frames);
          mergedLeft.set(this.left);
          mergedLeft.set(left, this.left.length);
          this.left = mergedLeft;

          const mergedRight = new Float32Array(this.right.length + frames);
          mergedRight.set(this.right);
          mergedRight.set(right, this.right.length);
          this.right = mergedRight;

          while (this.left.length >= this.frameSize) {
            this.pushFrame();
          }
        }

        async flush() {
          if (this.left.length > 0) {
            const rest = this.left.length;
            const paddedLeft = new Float32Array(this.frameSize);
            const paddedRight = new Float32Array(this.frameSize);
            paddedLeft.set(this.left);
            paddedRight.set(this.right);
            this.left = paddedLeft;
            this.right = paddedRight;
            this.pushFrame();
            // The last MP3 frame carries encoder padding; keep its real
            // duration so timestamps stay monotonic and the file ends cleanly.
            void rest;
          }
          const tail = this.encoder.flush();
          this.emit(tail, this.frameSize / this.config.sampleRate);
          this.left = new Float32Array(0);
          this.right = new Float32Array(0);
        }

        async close() {
          this.encoder = null;
          this.left = null;
          this.right = null;
        }
      }

      MB.registerEncoder(LameMp3Encoder);
      return true;
    })().catch((error) => {
      mp3EncoderPromise = null;
      throw error;
    });
  }
  return mp3EncoderPromise;
}

/* --------------------------------------------------------------------------
 * Inspection
 * ------------------------------------------------------------------------ */

async function makeThumbnail(videoTrack, duration) {
  const width = 320;
  const height = 180;
  const sink = new MB.CanvasSink(videoTrack, {
    width,
    height,
    fit: 'contain',
    alpha: true,
    poolSize: 1
  });
  const time = duration > 0.2 ? Math.min(duration * 0.2, duration - 0.05) : 0;
  const wrapped = await sink.getCanvas(Math.max(0, time));
  if (!wrapped) return null;

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(wrapped.canvas, 0, 0, width, height);
  return canvas.transferToImageBitmap();
}

async function inspect(file) {
  const input = openInput(file);
  try {
    let duration;
    try {
      duration = await input.computeDuration();
    } catch (error) {
      throw new Error('This file could not be read as a supported video.');
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('This file does not contain a readable video duration.');
    }

    const format = await input.getFormat();
    const container = format ? format.name : '';
    const videoTrack = await input.getPrimaryVideoTrack();

    let audioTracks = [];
    try {
      audioTracks = await input.getAudioTracks();
    } catch (error) {
      audioTracks = [];
    }

    const audioDetails = [];
    for (const track of audioTracks) {
      let codec = null;
      let channels = null;
      let sampleRate = null;
      let language = null;
      let name = null;
      let decodable = false;
      let bitrate = null;
      let trackDuration = null;
      try { codec = await track.getCodec(); } catch (error) { codec = null; }
      try { channels = await track.getNumberOfChannels(); } catch (error) { channels = null; }
      try { sampleRate = await track.getSampleRate(); } catch (error) { sampleRate = null; }
      try { language = await track.getLanguageCode(); } catch (error) { language = null; }
      try { name = await track.getName(); } catch (error) { name = null; }
      try { decodable = await track.canDecode(); } catch (error) { decodable = false; }
      try { trackDuration = await track.computeDurationOrNull(); } catch (error) { trackDuration = null; }
      bitrate = await trackBitrate(track);
      audioDetails.push({
        index: audioDetails.length,
        codec,
        channels,
        sampleRate,
        language,
        name,
        decodable,
        bitrate,
        duration: trackDuration
      });
    }

    let primaryAudioIndex = 0;
    if (audioTracks.length) {
      try {
        const primary = await input.getPrimaryAudioTrack();
        const found = primary ? audioTracks.indexOf(primary) : 0;
        primaryAudioIndex = found >= 0 ? found : 0;
      } catch (error) {
        primaryAudioIndex = 0;
      }
    }

    if (!videoTrack) {
      return {
        hasVideo: false,
        duration,
        container,
        videoDecodable: false,
        hasAudio: audioDetails.length > 0,
        audioTracks: audioDetails,
        primaryAudioIndex
      };
    }

    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();
    let codedWidth = width;
    let codedHeight = height;
    let rotation = 0;
    try {
      codedWidth = await videoTrack.getCodedWidth();
      codedHeight = await videoTrack.getCodedHeight();
    } catch (error) {
      /* Coded dimensions are informational only. */
    }
    try {
      rotation = await videoTrack.getRotation();
    } catch (error) {
      rotation = 0;
    }

    let videoDecodable = false;
    try {
      videoDecodable = await videoTrack.canDecode();
    } catch (error) {
      videoDecodable = false;
    }

    let fps = null;
    let fpsVariable = true;
    try {
      const metrics = await videoTrack.computeFrameRateMetrics({ targetPacketCount: 150 });
      fps = Number.isFinite(metrics.bestGuessFrameRate) ? metrics.bestGuessFrameRate : null;
      fpsVariable = metrics.underlyingFrameRate === null;
    } catch (error) {
      fps = null;
      fpsVariable = true;
    }

    let videoCodec = null;
    try {
      videoCodec = await videoTrack.getCodec();
    } catch (error) {
      videoCodec = null;
    }

    const videoBitrate = await trackBitrate(videoTrack);

    let thumbnail = null;
    if (videoDecodable) {
      try {
        thumbnail = await makeThumbnail(videoTrack, duration);
      } catch (error) {
        thumbnail = null;
      }
    }

    return {
      hasVideo: true,
      duration,
      container,
      width,
      height,
      codedWidth,
      codedHeight,
      rotation,
      fps,
      fpsVariable,
      videoCodec,
      videoBitrate,
      videoDecodable,
      hasAudio: audioDetails.length > 0,
      audioTracks: audioDetails,
      primaryAudioIndex,
      audioCodec: audioDetails.length ? audioDetails[primaryAudioIndex].codec : null,
      audioChannels: audioDetails.length ? audioDetails[primaryAudioIndex].channels : null,
      audioSampleRate: audioDetails.length ? audioDetails[primaryAudioIndex].sampleRate : null,
      audioBitrate: audioDetails.length ? audioDetails[primaryAudioIndex].bitrate : null,
      audioDecodable: audioDetails.length ? audioDetails[primaryAudioIndex].decodable : false,
      thumbnail
    };
  } finally {
    try {
      input.dispose();
    } catch (error) {
      /* The input may already be closed after a failed read. */
    }
  }
}

/* --------------------------------------------------------------------------
 * Capability checks
 * ------------------------------------------------------------------------ */

async function checkSupport(options) {
  const width = even(Number(options.width) || 0);
  const height = even(Number(options.height) || 0);
  const mode = options.mode === 'audio' ? 'audio' : 'video';
  const result = { mode, video: {}, audio: {}, audioFormats: {}, mp3: false };

  if (mode === 'video') {
    if (width >= 2 && height >= 2 && width <= MAX_OUTPUT_EDGE && height <= MAX_OUTPUT_EDGE) {
      for (const [format, config] of Object.entries(VIDEO_FORMATS)) {
        for (const codec of config.codecs) {
          const key = `${format}:${codec}`;
          try {
            result.video[key] = await MB.canEncodeVideo(codec, { width, height });
          } catch (error) {
            result.video[key] = false;
          }
        }
      }
    }
    for (const [codec, key] of [['aac', 'mp4:aac'], ['opus', 'webm:opus']]) {
      try {
        result.audio[key] = await MB.canEncodeAudio(codec, {
          numberOfChannels: VIDEO_AUDIO_CHANNELS,
          sampleRate: VIDEO_AUDIO_RATE
        });
      } catch (error) {
        result.audio[key] = false;
      }
    }
  } else {
    const sampleRate = [44100, 48000].includes(Number(options.sampleRate))
      ? Number(options.sampleRate)
      : 48000;
    const channels = Number(options.channels) === 1 ? 1 : 2;

    try {
      await ensureMp3Encoder();
      result.mp3 = await MB.canEncodeAudio('mp3', {
        numberOfChannels: channels,
        sampleRate,
        bitrate: 192000
      });
    } catch (error) {
      result.mp3 = false;
    }
    result.audioFormats.mp3 = result.mp3;

    try {
      result.audioFormats.wav = await MB.canEncodeAudio('pcm-s16', {
        numberOfChannels: channels,
        sampleRate
      });
    } catch (error) {
      result.audioFormats.wav = false;
    }

    let aac = false;
    try {
      aac = await MB.canEncodeAudio('aac', {
        numberOfChannels: channels,
        sampleRate,
        bitrate: 192000
      });
    } catch (error) {
      aac = false;
    }
    result.audioFormats.aac = aac;
    result.audioFormats.m4a = aac;
  }

  return result;
}

/* --------------------------------------------------------------------------
 * Shared audio helpers
 * ------------------------------------------------------------------------ */

function readStereo(sample) {
  const frames = sample.numberOfFrames;
  const channels = Math.max(1, sample.numberOfChannels);
  const planes = [];
  for (let channel = 0; channel < channels; channel += 1) {
    const plane = new Float32Array(frames);
    sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
    planes.push(plane);
  }

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  if (channels === 1) {
    left.set(planes[0]);
    right.set(planes[0]);
  } else if (channels === 2) {
    left.set(planes[0]);
    right.set(planes[1]);
  } else {
    const add = (target, plane, gain) => {
      if (!plane) return;
      for (let index = 0; index < frames; index += 1) target[index] += plane[index] * gain;
    };

    add(left, planes[0], 1);
    add(right, planes[1], 1);

    if (channels === 3) {
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
    } else if (channels === 4) {
      add(left, planes[2], 0.7071);
      add(right, planes[3], 0.7071);
    } else if (channels === 5) {
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
      add(left, planes[3], 0.7071);
      add(right, planes[4], 0.7071);
    } else if (channels === 7) {
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
      add(left, planes[3], 0.5);
      add(right, planes[3], 0.5);
      add(left, planes[4], 0.7071);
      add(right, planes[4], 0.7071);
      add(left, planes[5], 0.7071);
      add(right, planes[6], 0.7071);
    } else {
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
      add(left, planes[3], 0.5);
      add(right, planes[3], 0.5);
      add(left, planes[4], 0.7071);
      add(right, planes[5], 0.7071);
      add(left, planes[6], 0.7071);
      add(right, planes[7], 0.7071);
      for (let channel = 8; channel < channels; channel += 1) {
        add(left, planes[channel], 0.5);
        add(right, planes[channel], 0.5);
      }
    }
  }

  for (let index = 0; index < frames; index += 1) {
    left[index] = clamp(left[index], -1, 1);
    right[index] = clamp(right[index], -1, 1);
  }

  return { left, right };
}

function resampleChannel(source, startFrame, endFrame, outFrames) {
  const output = new Float32Array(outFrames);
  const span = endFrame - startFrame;
  if (span <= 0 || outFrames <= 0) return output;

  for (let index = 0; index < outFrames; index += 1) {
    const position = startFrame + (index * span) / outFrames;
    let base = Math.floor(position);
    const fraction = position - base;
    if (base < startFrame) base = startFrame;
    if (base > endFrame - 1) base = endFrame - 1;
    const next = Math.min(endFrame - 1, base + 1);
    output[index] = clamp(source[base] + (source[next] - source[base]) * fraction, -1, 1);
  }

  return output;
}

function buildAudioData(sample, targetChannels, start, end, sampleStart, targetRate) {
  const sourceRate = sample.sampleRate;
  const sourceStart = Math.round(Math.max(0, (start / targetRate - sampleStart) * sourceRate));
  const sourceEnd = Math.round(
    Math.min(sample.numberOfFrames, (end / targetRate - sampleStart) * sourceRate)
  );
  const frames = Math.max(0, end - start);
  const data = new Float32Array(frames * targetChannels);
  if (sourceEnd <= sourceStart || !frames) return data;

  const stereo = readStereo(sample);
  const left = resampleChannel(stereo.left, sourceStart, sourceEnd, frames);
  const right = resampleChannel(stereo.right, sourceStart, sourceEnd, frames);

  if (targetChannels === 1) {
    for (let index = 0; index < frames; index += 1) {
      data[index] = clamp((left[index] + right[index]) / 2, -1, 1);
    }
  } else {
    for (let index = 0; index < frames; index += 1) {
      data[index] = left[index];
      data[frames + index] = right[index];
    }
  }

  return data;
}

async function addAudioFrames(source, absoluteFrame, data, sampleRate, channels) {
  const sample = new MB.AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: channels,
    sampleRate,
    timestamp: absoluteFrame / sampleRate
  });
  try {
    await source.add(sample);
  } finally {
    sample.close();
  }
}

async function addSilenceFrames(source, absoluteFrame, frameCount, sampleRate, channels) {
  let written = 0;
  while (written < frameCount) {
    checkCancel();
    const length = Math.min(sampleRate, frameCount - written);
    const data = new Float32Array(length * channels);
    await addAudioFrames(source, absoluteFrame + written, data, sampleRate, channels);
    written += length;
  }
}

/* --------------------------------------------------------------------------
 * Video export
 * ------------------------------------------------------------------------ */

function validateVideoPlan(options) {
  const formatKey = VIDEO_FORMATS[options.format] ? options.format : 'mp4';
  const format = VIDEO_FORMATS[formatKey];
  const codec = format.codecs.includes(options.codec) ? options.codec : format.codecs[0];
  const width = even(Number(options.width) || 0);
  const height = even(Number(options.height) || 0);
  const bitrate = Math.round(Number(options.videoBitrate) || 0);
  const audioMode = options.audio === 'remove' ? 'remove' : 'keep';
  const audioBitrate = Math.round(Number(options.audioBitrate) || 0);
  const fpsCap = Number(options.fpsCap) > 0 ? Number(options.fpsCap) : 0;
  const quantizer = Number.isFinite(Number(options.quantizer)) && options.quantizer !== null
    ? Math.round(Number(options.quantizer))
    : null;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('The output size is not valid.');
  }
  if (width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE) {
    throw new Error(`The output cannot exceed ${MAX_OUTPUT_EDGE} px on either edge. Choose a smaller resolution.`);
  }
  if (!Number.isFinite(bitrate) || bitrate < MIN_VIDEO_BITRATE || bitrate > MAX_VIDEO_BITRATE) {
    throw new Error('The video bitrate is not valid. Use a value between 0.02 and 100 Mbps.');
  }
  if (audioMode === 'keep' && (!Number.isFinite(audioBitrate) || audioBitrate < 24000 || audioBitrate > 512000)) {
    throw new Error('The audio bitrate is not valid. Use a value between 24 and 512 kbps.');
  }
  if (fpsCap && (fpsCap < 1 || fpsCap > 240)) {
    throw new Error('The frame-rate cap is not valid.');
  }
  if (quantizer !== null && (quantizer < 0 || quantizer > 63)) {
    throw new Error('The constant-quality value is not valid.');
  }

  return {
    mode: 'video',
    format: formatKey,
    formatConfig: format,
    codec,
    width,
    height,
    bitrate,
    audioMode,
    audioBitrate: audioMode === 'keep' ? audioBitrate : 0,
    audioCodec: format.audioCodec,
    fpsCap,
    quantizer
  };
}

function videoQuality(plan) {
  if (plan.quantizer !== null) {
    return new MB.Quality({
      quantizer: plan.quantizer,
      bitrate: plan.bitrate,
      bitrateMode: 'variable'
    });
  }
  return new MB.Quality({ bitrate: plan.bitrate, bitrateMode: 'variable' });
}

async function exportVideo(file, options, id) {
  const plan = validateVideoPlan(options);

  const input = openInput(file);
  let output = null;
  let audioSource = null;

  try {
    let duration;
    try {
      duration = await input.computeDuration();
    } catch (error) {
      throw new Error('This file could not be read as a supported video.');
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('This file has no readable video duration.');
    }

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('This file does not contain a video track.');
    }

    let videoDecodable = false;
    try {
      videoDecodable = await videoTrack.canDecode();
    } catch (error) {
      videoDecodable = false;
    }
    if (!videoDecodable) {
      throw new Error('This browser cannot decode the video in this file, so it cannot be converted here.');
    }

    let videoEncodable = false;
    try {
      videoEncodable = await MB.canEncodeVideo(plan.codec, {
        width: plan.width,
        height: plan.height
      });
    } catch (error) {
      videoEncodable = false;
    }
    if (!videoEncodable) {
      throw new Error(
        `This browser cannot encode ${plan.codec.toUpperCase()} at ${plan.width} × ${plan.height}. Choose another format or a smaller resolution.`
      );
    }

    let audioTrack = null;
    try {
      audioTrack = await input.getPrimaryAudioTrack();
    } catch (error) {
      audioTrack = null;
    }

    if (audioTrack && plan.audioMode === 'keep') {
      let audioDecodable = false;
      try {
        audioDecodable = await audioTrack.canDecode();
      } catch (error) {
        audioDecodable = false;
      }
      if (!audioDecodable) {
        throw new Error(
          'The audio in this video cannot be decoded by this browser. Keep audio would silently fail, so choose Remove audio or another file.'
        );
      }
      let audioEncodable = false;
      try {
        audioEncodable = await MB.canEncodeAudio(plan.audioCodec, {
          numberOfChannels: VIDEO_AUDIO_CHANNELS,
          sampleRate: VIDEO_AUDIO_RATE
        });
      } catch (error) {
        audioEncodable = false;
      }
      if (!audioEncodable) {
        throw new Error('This browser cannot encode the selected audio codec. Try another output format or remove the audio.');
      }
    }

    checkCancel();

    const target = new MB.BufferTarget();
    output = new MB.Output({ format: plan.formatConfig.make(), target });

    const work = new OffscreenCanvas(plan.width, plan.height);
    const workContext = work.getContext('2d', { alpha: false });
    const hold = new OffscreenCanvas(plan.width, plan.height);
    const holdContext = hold.getContext('2d');
    if (!workContext || !holdContext) {
      throw new Error('The browser could not create a canvas for the converted video.');
    }

    const videoSource = new MB.VideoSampleSource({
      codec: plan.codec,
      quality: videoQuality(plan),
      keyFrameInterval: 2
    });
    output.addVideoTrack(videoSource);

    if (audioTrack && plan.audioMode === 'keep') {
      audioSource = new MB.AudioSampleSource({
        codec: plan.audioCodec,
        quality: new MB.Quality({ bitrate: plan.audioBitrate })
      });
      output.addAudioTrack(audioSource);
    }

    activeOutput = output;
    await output.start();

    const sourceFps = Number(options.sourceFps) > 0 ? Number(options.sourceFps) : 30;
    const nominal = 1 / Math.max(1, plan.fpsCap || sourceFps);
    const sink = new MB.CanvasSink(videoTrack, {
      width: plan.width,
      height: plan.height,
      fit: 'contain',
      alpha: true,
      poolSize: 2
    });

    let heldStart = null;
    let frameCount = 0;
    let sourceFrames = 0;
    let lastKeptIndex = -1;

    const drawFrame = (frameCanvas) => {
      workContext.fillStyle = '#000000';
      workContext.fillRect(0, 0, plan.width, plan.height);
      workContext.imageSmoothingEnabled = true;
      workContext.imageSmoothingQuality = 'high';
      workContext.drawImage(frameCanvas, 0, 0, plan.width, plan.height);
    };

    const flushHeld = async (endTime) => {
      if (heldStart === null) return;
      let length = endTime - heldStart;
      if (!Number.isFinite(length) || length <= 0.0005) length = nominal;
      const sample = new MB.VideoSample(hold, { timestamp: heldStart, duration: length });
      try {
        await videoSource.add(sample);
      } finally {
        sample.close();
      }
      heldStart = null;
    };

    for await (const frame of sink.canvases(0, duration)) {
      checkCancel();
      sourceFrames += 1;
      const timestamp = Math.max(0, Number(frame.timestamp) || 0);
      if (timestamp >= duration - 0.0005) break;

      if (plan.fpsCap) {
        // Quantise each source timestamp onto the target frame grid and keep
        // the first frame that lands on each new slot. This drops frames
        // without inventing duplicates and keeps the average rate at the cap
        // instead of drifting above it.
        const step = 1 / plan.fpsCap;
        const targetIndex = Math.floor(timestamp / step + 0.5);
        if (targetIndex <= lastKeptIndex) {
          continue;
        }
        lastKeptIndex = targetIndex;
      }

      drawFrame(frame.canvas);
      await flushHeld(timestamp);
      holdContext.clearRect(0, 0, plan.width, plan.height);
      holdContext.drawImage(work, 0, 0);
      heldStart = timestamp;
      frameCount += 1;
      postProgress(id, 0.82 * Math.min(1, timestamp / duration), { phase: 'video' });
    }

    if (!frameCount) {
      throw new Error('No decodable video frames were found in this file.');
    }

    await flushHeld(duration);
    postProgress(id, 0.83, { phase: 'video' });

    if (audioSource && audioTrack) {
      const totalFrames = Math.max(1, Math.round(duration * VIDEO_AUDIO_RATE));
      const audioSink = new MB.AudioSampleSink(audioTrack);
      let cursor = 0;

      for await (const sample of audioSink.samples(0, duration)) {
        checkCancel();
        const sampleStart = sample.timestamp;
        const sampleEnd = sample.timestamp + sample.duration;
        const start = Math.max(cursor, Math.round(Math.max(0, sampleStart) * VIDEO_AUDIO_RATE));
        const end = Math.min(totalFrames, Math.round(sampleEnd * VIDEO_AUDIO_RATE));

        if (end <= start) {
          sample.close();
          continue;
        }

        if (start > cursor) {
          await addSilenceFrames(audioSource, cursor, start - cursor, VIDEO_AUDIO_RATE, VIDEO_AUDIO_CHANNELS);
        }

        const data = buildAudioData(
          sample,
          VIDEO_AUDIO_CHANNELS,
          start,
          end,
          sampleStart,
          VIDEO_AUDIO_RATE
        );
        await addAudioFrames(audioSource, start, data, VIDEO_AUDIO_RATE, VIDEO_AUDIO_CHANNELS);

        sample.close();
        cursor = end;
        postProgress(id, 0.83 + 0.14 * Math.min(1, cursor / totalFrames), { phase: 'audio' });
      }

      if (cursor < totalFrames) {
        await addSilenceFrames(
          audioSource,
          cursor,
          totalFrames - cursor,
          VIDEO_AUDIO_RATE,
          VIDEO_AUDIO_CHANNELS
        );
      }
    }

    checkCancel();
    postProgress(id, 0.98, { phase: 'finalizing' });
    await output.finalize();
    activeOutput = null;

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 512) {
      throw new Error('The encoder did not produce a valid converted file.');
    }

    const blob = new Blob([buffer], { type: plan.formatConfig.mimeType });
    const check = openInput(blob);

    try {
      const outputDuration = await check.computeDuration();
      const outputVideo = await check.getPrimaryVideoTrack();
      const outputAudio = await check.getPrimaryAudioTrack();

      if (!outputVideo) {
        throw new Error('The converted file does not contain a video track.');
      }

      const outputWidth = await outputVideo.getDisplayWidth();
      const outputHeight = await outputVideo.getDisplayHeight();
      if (Math.abs(outputWidth - plan.width) > 1 || Math.abs(outputHeight - plan.height) > 1) {
        throw new Error(
          `The converted file is ${outputWidth} × ${outputHeight}, not the requested ${plan.width} × ${plan.height}.`
        );
      }

      let outputRotation = 0;
      try {
        outputRotation = await outputVideo.getRotation();
      } catch (error) {
        outputRotation = 0;
      }
      if (outputRotation !== 0) {
        throw new Error('The converted file still carries rotation metadata and would display incorrectly.');
      }

      const tolerance = Math.max(0.35, duration * 0.03);
      if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - duration) > tolerance) {
        throw new Error(
          `The converted file duration (${Number(outputDuration).toFixed(2)} s) does not match the source duration (${duration.toFixed(2)} s).`
        );
      }

      if (audioTrack && plan.audioMode === 'keep' && !outputAudio) {
        throw new Error('The converted file is missing the audio track that should have been kept.');
      }

      let outputVideoCodec = null;
      try { outputVideoCodec = await outputVideo.getCodec(); } catch (error) { outputVideoCodec = null; }
      let outputAudioCodec = null;
      let outputChannels = null;
      let outputSampleRate = null;
      if (outputAudio) {
        try { outputAudioCodec = await outputAudio.getCodec(); } catch (error) { outputAudioCodec = null; }
        try { outputChannels = await outputAudio.getNumberOfChannels(); } catch (error) { outputChannels = null; }
        try { outputSampleRate = await outputAudio.getSampleRate(); } catch (error) { outputSampleRate = null; }
      }

      return {
        mode: 'video',
        buffer,
        mimeType: plan.formatConfig.mimeType,
        extension: plan.formatConfig.extension,
        format: plan.format,
        codec: outputVideoCodec || plan.codec,
        audioCodec: outputAudioCodec,
        duration: outputDuration,
        width: outputWidth,
        height: outputHeight,
        hasAudio: Boolean(outputAudio),
        audioChannels: outputChannels,
        audioSampleRate: outputSampleRate,
        size: blob.size,
        videoBitrate: plan.bitrate,
        audioBitrate: plan.audioBitrate,
        sourceFrames,
        encodedFrames: frameCount
      };
    } finally {
      try { check.dispose(); } catch (error) { /* already released */ }
    }
  } finally {
    try { input.dispose(); } catch (error) { /* already released */ }
    if (activeOutput) {
      try { await activeOutput.cancel(); } catch (error) { /* already canceled */ }
      activeOutput = null;
    }
    output = null;
    audioSource = null;
  }
}

/* --------------------------------------------------------------------------
 * Audio export
 * ------------------------------------------------------------------------ */

function validateAudioPlan(options) {
  const formatKey = AUDIO_FORMATS[options.format] ? options.format : 'mp3';
  const config = AUDIO_FORMATS[formatKey];
  const sampleRate = [44100, 48000].includes(Number(options.sampleRate))
    ? Number(options.sampleRate)
    : 48000;
  const channels = Number(options.channels) === 1 ? 1 : 2;
  const bitrateKbps = Math.round(Number(options.bitrate) || 0);
  const bitrate = bitrateKbps * 1000;
  const trackIndex = Math.max(0, Math.round(Number(options.trackIndex) || 0));

  if (config.compressed && (bitrateKbps < 32 || bitrateKbps > 320)) {
    throw new Error('The audio bitrate must be between 32 and 320 kbps.');
  }

  return {
    mode: 'audio',
    format: formatKey,
    config,
    sampleRate,
    channels,
    bitrateKbps: config.compressed ? bitrateKbps : null,
    bitrate: config.compressed ? bitrate : null,
    trackIndex
  };
}

async function exportAudio(file, options, id) {
  const plan = validateAudioPlan(options);
  if (plan.format === 'mp3') {
    await ensureMp3Encoder();
  }

  const input = openInput(file);
  let output = null;

  try {
    const tracks = await input.getAudioTracks();
    if (!tracks.length) {
      throw new Error('This video has no audio track to extract.');
    }
    const audioTrack = tracks[Math.min(plan.trackIndex, tracks.length - 1)];
    if (!audioTrack) {
      throw new Error('The selected audio track is not available.');
    }

    let decodable = false;
    try { decodable = await audioTrack.canDecode(); } catch (error) { decodable = false; }
    if (!decodable) {
      throw new Error('This browser cannot decode the audio in this video, so it cannot be extracted here.');
    }

    let duration;
    try {
      duration = await audioTrack.computeDuration();
    } catch (error) {
      duration = await input.computeDuration();
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('This audio track has no readable duration.');
    }

    if (plan.config.compressed) {
      let encodable = false;
      try {
        encodable = await MB.canEncodeAudio(plan.config.codec, {
          numberOfChannels: plan.channels,
          sampleRate: plan.sampleRate,
          bitrate: plan.bitrate
        });
      } catch (error) {
        encodable = false;
      }
      if (!encodable) {
        throw new Error(
          `This browser cannot encode ${plan.config.codec.toUpperCase()} at ${plan.sampleRate} Hz. Try another output format or sample rate.`
        );
      }
    }

    checkCancel();

    const target = new MB.BufferTarget();
    output = new MB.Output({ format: plan.config.make(), target });
    const audioSource = new MB.AudioSampleSource({
      codec: plan.config.codec,
      quality: plan.config.compressed ? new MB.Quality({ bitrate: plan.bitrate }) : undefined
    });
    output.addAudioTrack(audioSource);
    activeOutput = output;
    await output.start();

    const totalFrames = Math.max(1, Math.round(duration * plan.sampleRate));
    const sink = new MB.AudioSampleSink(audioTrack);
    let cursor = 0;

    for await (const sample of sink.samples(0, duration)) {
      checkCancel();
      const sampleStart = sample.timestamp;
      const sampleEnd = sample.timestamp + sample.duration;
      const start = Math.max(cursor, Math.round(Math.max(0, sampleStart) * plan.sampleRate));
      const end = Math.min(totalFrames, Math.round(sampleEnd * plan.sampleRate));

      if (end <= start) {
        sample.close();
        continue;
      }

      if (start > cursor) {
        await addSilenceFrames(audioSource, cursor, start - cursor, plan.sampleRate, plan.channels);
      }

      const data = buildAudioData(sample, plan.channels, start, end, sampleStart, plan.sampleRate);
      await addAudioFrames(audioSource, start, data, plan.sampleRate, plan.channels);

      sample.close();
      cursor = end;
      postProgress(id, 0.97 * Math.min(1, cursor / totalFrames), { phase: 'audio' });
    }

    if (cursor < totalFrames) {
      await addSilenceFrames(audioSource, cursor, totalFrames - cursor, plan.sampleRate, plan.channels);
    }

    checkCancel();
    postProgress(id, 0.98, { phase: 'finalizing' });
    await output.finalize();
    activeOutput = null;

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 256) {
      throw new Error('The encoder did not produce a valid audio file.');
    }

    const blob = new Blob([buffer], { type: plan.config.mimeType });
    const check = openInput(blob);

    try {
      const outputDuration = await check.computeDuration();
      const outputTrack = await check.getPrimaryAudioTrack();
      const outputVideo = await check.getPrimaryVideoTrack();
      if (!outputTrack) {
        throw new Error('The exported audio file does not contain an audio track.');
      }
      if (outputVideo) {
        throw new Error('The exported audio file unexpectedly contains a video track.');
      }

      const tolerance = Math.max(0.12, duration * 0.03);
      if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - duration) > tolerance) {
        throw new Error(
          `The audio duration (${Number(outputDuration).toFixed(2)} s) does not match the source audio (${duration.toFixed(2)} s).`
        );
      }

      let codec = null;
      let sampleRate = null;
      let channels = null;
      try { codec = await outputTrack.getCodec(); } catch (error) { codec = null; }
      try { sampleRate = await outputTrack.getSampleRate(); } catch (error) { sampleRate = null; }
      try { channels = await outputTrack.getNumberOfChannels(); } catch (error) { channels = null; }

      return {
        mode: 'audio',
        buffer,
        mimeType: plan.config.mimeType,
        extension: plan.config.extension,
        format: plan.format,
        codec: codec || plan.config.codec,
        duration: outputDuration,
        size: blob.size,
        bitrateKbps: plan.bitrateKbps,
        measuredBitrate: outputDuration > 0 ? Math.round((blob.size * 8) / outputDuration) : null,
        sampleRate,
        channels,
        trackIndex: plan.trackIndex
      };
    } finally {
      try { check.dispose(); } catch (error) { /* already released */ }
    }
  } finally {
    try { input.dispose(); } catch (error) { /* already released */ }
    if (activeOutput) {
      try { await activeOutput.cancel(); } catch (error) { /* already canceled */ }
      activeOutput = null;
    }
    output = null;
  }
}

/* --------------------------------------------------------------------------
 * Worker entry
 * ------------------------------------------------------------------------ */

self.onmessage = async (event) => {
  const message = event.data || {};
  const { id, type } = message;

  if (type === 'cancel') {
    cancelRequested = true;
    if (activeOutput) {
      try { await activeOutput.cancel(); } catch (error) { /* export reports it */ }
    }
    return;
  }

  try {
    if (type === 'inspect') {
      const payload = await inspect(message.file);
      const transfer = payload.thumbnail ? [payload.thumbnail] : [];
      self.postMessage({ id, type: 'done', payload }, transfer);
    } else if (type === 'support') {
      const payload = await checkSupport(message.options || {});
      self.postMessage({ id, type: 'done', payload });
    } else if (type === 'export') {
      cancelRequested = false;
      const payload = message.options && message.options.mode === 'audio'
        ? await exportAudio(message.file, message.options || {}, id)
        : await exportVideo(message.file, message.options || {}, id);
      self.postMessage({ id, type: 'done', payload }, [payload.buffer]);
    }
  } catch (error) {
    const canceled = cancelRequested && /cancel/i.test(error && error.message ? error.message : '');
    self.postMessage({
      id,
      type: 'error',
      name: error && error.name ? error.name : 'Error',
      message: canceled
        ? 'Conversion canceled.'
        : error && error.message
          ? error.message
          : String(error)
    });
  }
};
