/* Video Compressor worker.
 * Demuxes, decodes, optionally downsizes, re-encodes and muxes one video
 * entirely in the browser. Mediabunny (MPL-2.0) + WebCodecs.
 * No network requests, no server, no upload. */

import * as MB from '../vendor/mediabunny/mediabunny.min.mjs';

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const MAX_OUTPUT_EDGE = 4096;
const DEFAULT_BACKGROUND = '#000000';

const VIDEO_CODECS = {
  mp4: ['avc'],
  webm: ['vp9', 'vp8']
};

let activeOutput = null;
let cancelRequested = false;

function openInput(blob) {
  return new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
}

function outputFormatFor(format) {
  return format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat();
}

function codecForFormat(format) {
  return format === 'webm' ? 'vp9' : 'avc';
}

function audioCodecForFormat(format) {
  return format === 'webm' ? 'opus' : 'aac';
}

function checkCancel() {
  if (cancelRequested) throw new Error('Compression canceled.');
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

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return 0;
  const value = parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function backgroundFor(value) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : DEFAULT_BACKGROUND;
}

function validatePlan(options) {
  const format = options.format === 'webm' ? 'webm' : 'mp4';
  const allowed = VIDEO_CODECS[format];
  const codec = allowed.includes(options.codec) ? options.codec : codecForFormat(format);
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
  if (!Number.isFinite(bitrate) || bitrate < 20000 || bitrate > 100000000) {
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
    format,
    codec,
    width,
    height,
    bitrate,
    audioMode,
    audioBitrate: audioMode === 'keep' ? audioBitrate : 0,
    fpsCap,
    quantizer,
    background: backgroundFor(options.background)
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

async function trackBitrate(track) {
  if (!track) return null;
  try {
    const value = await track.getAverageBitrate();
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

    if (!videoTrack) {
      return {
        hasVideo: false,
        duration,
        container,
        videoDecodable: false,
        hasAudio: Boolean(await input.getPrimaryAudioTrack())
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

    let audioTrack = null;
    try {
      audioTrack = await input.getPrimaryAudioTrack();
    } catch (error) {
      audioTrack = null;
    }

    let audioDecodable = false;
    let audioCodec = null;
    let audioChannels = null;
    let audioSampleRate = null;
    let audioBitrate = null;
    if (audioTrack) {
      try {
        audioCodec = await audioTrack.getCodec();
      } catch (error) {
        audioCodec = null;
      }
      try {
        audioChannels = await audioTrack.getNumberOfChannels();
      } catch (error) {
        audioChannels = null;
      }
      try {
        audioSampleRate = await audioTrack.getSampleRate();
      } catch (error) {
        audioSampleRate = null;
      }
      try {
        audioDecodable = await audioTrack.canDecode();
      } catch (error) {
        audioDecodable = false;
      }
      audioBitrate = await trackBitrate(audioTrack);
    }

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
      hasAudio: Boolean(audioTrack),
      audioCodec,
      audioChannels,
      audioSampleRate,
      audioBitrate,
      audioDecodable,
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

async function checkSupport(options) {
  const width = even(Number(options.width) || 0);
  const height = even(Number(options.height) || 0);
  const needsAudio = Boolean(options.needsAudio);

  const result = { video: {}, audio: {} };

  if (width >= 2 && height >= 2 && width <= MAX_OUTPUT_EDGE && height <= MAX_OUTPUT_EDGE) {
    for (const format of Object.keys(VIDEO_CODECS)) {
      for (const codec of VIDEO_CODECS[format]) {
        const key = `${format}:${codec}`;
        try {
          result.video[key] = await MB.canEncodeVideo(codec, { width, height });
        } catch (error) {
          result.video[key] = false;
        }
      }
    }
  }

  for (const [codec, format] of [['aac', 'mp4'], ['opus', 'webm']]) {
    if (needsAudio) {
      try {
        result.audio[codec] = await MB.canEncodeAudio(codec, {
          numberOfChannels: AUDIO_CHANNELS,
          sampleRate: AUDIO_SAMPLE_RATE
        });
      } catch (error) {
        result.audio[codec] = false;
      }
    } else {
      result.audio[codec] = true;
    }
    result.audio[`${format}:${codec}`] = result.audio[codec];
  }

  return result;
}

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
      for (let i = 0; i < frames; i += 1) target[i] += plane[i] * gain;
    };

    add(left, planes[0], 1);
    add(right, planes[1], 1);

    if (channels === 3) {
      // L R C
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
    } else if (channels === 4) {
      // L R BL BR
      add(left, planes[2], 0.7071);
      add(right, planes[3], 0.7071);
    } else if (channels === 5) {
      // L R C BL BR
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
      add(left, planes[3], 0.7071);
      add(right, planes[4], 0.7071);
    } else if (channels === 7) {
      // L R C LFE BC SL SR
      add(left, planes[2], 0.7071);
      add(right, planes[2], 0.7071);
      add(left, planes[3], 0.5);
      add(right, planes[3], 0.5);
      add(left, planes[4], 0.7071);
      add(right, planes[4], 0.7071);
      add(left, planes[5], 0.7071);
      add(right, planes[6], 0.7071);
    } else {
      // 5.1 and wider: L R C LFE BL BR SL SR
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

  for (let i = 0; i < frames; i += 1) {
    left[i] = Math.max(-1, Math.min(1, left[i]));
    right[i] = Math.max(-1, Math.min(1, right[i]));
  }

  return { left, right };
}

function resampleStereo(left, right, startFrame, endFrame, outFrames) {
  const data = new Float32Array(outFrames * AUDIO_CHANNELS);
  const span = endFrame - startFrame;
  if (span <= 0 || outFrames <= 0) return data;

  for (let i = 0; i < outFrames; i += 1) {
    const position = startFrame + (i * span) / outFrames;
    let base = Math.floor(position);
    const fraction = position - base;
    if (base < startFrame) base = startFrame;
    if (base > endFrame - 1) base = endFrame - 1;
    const next = Math.min(endFrame - 1, base + 1);
    const l = left[base] + (left[next] - left[base]) * fraction;
    const r = right[base] + (right[next] - right[base]) * fraction;
    data[i] = l < -1 ? -1 : l > 1 ? 1 : l;
    data[outFrames + i] = r < -1 ? -1 : r > 1 ? 1 : r;
  }

  return data;
}

async function addAudioFrames(source, absoluteFrame, data) {
  const sample = new MB.AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_SAMPLE_RATE,
    timestamp: absoluteFrame / AUDIO_SAMPLE_RATE
  });
  try {
    await source.add(sample);
  } finally {
    sample.close();
  }
}

async function addSilenceFrames(source, absoluteFrame, frameCount) {
  let written = 0;
  while (written < frameCount) {
    checkCancel();
    const length = Math.min(AUDIO_SAMPLE_RATE, frameCount - written);
    const data = new Float32Array(length * AUDIO_CHANNELS);
    await addAudioFrames(source, absoluteFrame + written, data);
    written += length;
  }
}

async function exportCompress(file, options, id) {
  cancelRequested = false;
  const plan = validatePlan(options);

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
      throw new Error('This browser cannot decode the video in this file, so it cannot be compressed here.');
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
        audioEncodable = await MB.canEncodeAudio(audioCodecForFormat(plan.format), {
          numberOfChannels: AUDIO_CHANNELS,
          sampleRate: AUDIO_SAMPLE_RATE
        });
      } catch (error) {
        audioEncodable = false;
      }
      if (!audioEncodable) {
        throw new Error('This browser cannot encode the selected audio codec. Try the other output format or remove the audio.');
      }
    }

    checkCancel();

    const target = new MB.BufferTarget();
    output = new MB.Output({ format: outputFormatFor(plan.format), target });

    const work = new OffscreenCanvas(plan.width, plan.height);
    const workContext = work.getContext('2d', { alpha: false });
    const hold = new OffscreenCanvas(plan.width, plan.height);
    const holdContext = hold.getContext('2d');
    if (!workContext || !holdContext) {
      throw new Error('The browser could not create a canvas for the compressed video.');
    }

    const videoSource = new MB.VideoSampleSource({
      codec: plan.codec,
      quality: videoQuality(plan),
      keyFrameInterval: 2
    });
    output.addVideoTrack(videoSource);

    if (audioTrack && plan.audioMode === 'keep') {
      audioSource = new MB.AudioSampleSource({
        codec: audioCodecForFormat(plan.format),
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
    let nextKeepTime = 0;
    const background = plan.background;

    const drawFrame = (frameCanvas) => {
      workContext.fillStyle = background;
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

      // A maximum frame rate is enforced by dropping extra source frames and
      // extending the previous encoded frame's duration. The ideal output
      // timeline advances in 1/fpsCap steps, so a 30 fps source capped at 24
      // keeps a genuine 24 fps mix instead of every second frame. Frames are
      // never duplicated and audio timestamps are untouched.
      if (plan.fpsCap) {
        const step = 1 / plan.fpsCap;
        if (timestamp + 0.0005 < nextKeepTime) {
          continue;
        }
        const advance = Math.floor((timestamp - nextKeepTime) / step) + 1;
        nextKeepTime += advance * step;
      }

      drawFrame(frame.canvas);
      await flushHeld(timestamp);
      holdContext.clearRect(0, 0, plan.width, plan.height);
      holdContext.drawImage(work, 0, 0);
      heldStart = timestamp;
      frameCount += 1;
      postProgress(id, 0.85 * Math.min(1, timestamp / duration), { phase: 'video' });
    }

    if (!frameCount) {
      throw new Error('No decodable video frames were found in this file.');
    }

    await flushHeld(duration);
    postProgress(id, 0.86, { phase: 'video' });

    if (audioSource && audioTrack) {
      const totalFrames = Math.max(1, Math.round(duration * AUDIO_SAMPLE_RATE));
      const audioSink = new MB.AudioSampleSink(audioTrack);
      let cursor = 0;

      for await (const sample of audioSink.samples(0, duration)) {
        checkCancel();
        const sampleStart = sample.timestamp;
        const sampleEnd = sample.timestamp + sample.duration;
        const start = Math.max(cursor, Math.round(Math.max(0, sampleStart) * AUDIO_SAMPLE_RATE));
        const end = Math.min(totalFrames, Math.round(sampleEnd * AUDIO_SAMPLE_RATE));

        if (end <= start) {
          sample.close();
          continue;
        }

        if (start > cursor) {
          await addSilenceFrames(audioSource, cursor, start - cursor);
        }

        const rate = sample.sampleRate;
        const sourceStart = Math.round(
          Math.max(0, (start / AUDIO_SAMPLE_RATE - sampleStart) * rate)
        );
        const sourceEnd = Math.round(
          Math.min(sample.numberOfFrames, (end / AUDIO_SAMPLE_RATE - sampleStart) * rate)
        );

        if (sourceEnd > sourceStart) {
          const stereo = readStereo(sample);
          const data = resampleStereo(stereo.left, stereo.right, sourceStart, sourceEnd, end - start);
          await addAudioFrames(audioSource, start, data);
        }

        sample.close();
        cursor = end;
        postProgress(id, 0.86 + 0.13 * Math.min(1, cursor / totalFrames), { phase: 'audio' });
      }

      if (cursor < totalFrames) {
        await addSilenceFrames(audioSource, cursor, totalFrames - cursor);
      }
    }

    checkCancel();
    postProgress(id, 0.99, { phase: 'finalizing' });
    await output.finalize();
    activeOutput = null;

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 512) {
      throw new Error('The encoder did not produce a valid compressed file.');
    }

    const mimeType = plan.format === 'webm' ? 'video/webm' : 'video/mp4';
    const extension = plan.format === 'webm' ? 'webm' : 'mp4';
    const blob = new Blob([buffer], { type: mimeType });
    const check = openInput(blob);

    try {
      const outputDuration = await check.computeDuration();
      const outputVideo = await check.getPrimaryVideoTrack();
      const outputAudio = await check.getPrimaryAudioTrack();

      if (!outputVideo) {
        throw new Error('The compressed file does not contain a video track.');
      }

      const outputWidth = await outputVideo.getDisplayWidth();
      const outputHeight = await outputVideo.getDisplayHeight();
      if (Math.abs(outputWidth - plan.width) > 1 || Math.abs(outputHeight - plan.height) > 1) {
        throw new Error(
          `The compressed file is ${outputWidth} × ${outputHeight}, not the requested ${plan.width} × ${plan.height}.`
        );
      }

      let outputRotation = 0;
      try {
        outputRotation = await outputVideo.getRotation();
      } catch (error) {
        outputRotation = 0;
      }
      if (outputRotation !== 0) {
        throw new Error('The compressed file still carries rotation metadata and would display incorrectly.');
      }

      const tolerance = Math.max(0.35, duration * 0.03);
      if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - duration) > tolerance) {
        throw new Error(
          `The compressed file duration (${Number(outputDuration).toFixed(2)} s) does not match the source duration (${duration.toFixed(2)} s).`
        );
      }

      if (audioTrack && plan.audioMode === 'keep' && !outputAudio) {
        throw new Error('The compressed file is missing the audio track that should have been kept.');
      }

      let outputVideoCodec = null;
      try {
        outputVideoCodec = await outputVideo.getCodec();
      } catch (error) {
        outputVideoCodec = null;
      }
      let outputAudioCodec = null;
      if (outputAudio) {
        try {
          outputAudioCodec = await outputAudio.getCodec();
        } catch (error) {
          outputAudioCodec = null;
        }
      }

      return {
        buffer,
        mimeType,
        extension,
        duration: outputDuration,
        width: outputWidth,
        height: outputHeight,
        hasAudio: Boolean(outputAudio),
        size: blob.size,
        videoCodec: outputVideoCodec,
        audioCodec: outputAudioCodec,
        plannedVideoBitrate: plan.bitrate,
        plannedAudioBitrate: plan.audioBitrate,
        sourceFrames,
        encodedFrames: frameCount
      };
    } finally {
      try {
        check.dispose();
      } catch (error) {
        /* The check input has already been released. */
      }
    }
  } finally {
    try {
      input.dispose();
    } catch (error) {
      /* The input has already been released. */
    }
    if (activeOutput) {
      try {
        await activeOutput.cancel();
      } catch (error) {
        /* The output may already be canceled or finalized. */
      }
      activeOutput = null;
    }
    output = null;
    audioSource = null;
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const { id, type } = message;

  if (type === 'cancel') {
    cancelRequested = true;
    if (activeOutput) {
      try {
        await activeOutput.cancel();
      } catch (error) {
        /* The export call reports the cancellation. */
      }
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
      const payload = await exportCompress(message.file, message.options || {}, id);
      self.postMessage({ id, type: 'done', payload }, [payload.buffer]);
    }
  } catch (error) {
    const canceled = cancelRequested && /cancel/i.test(error && error.message ? error.message : '');
    self.postMessage({
      id,
      type: 'error',
      name: error && error.name ? error.name : 'Error',
      message: canceled
        ? 'Compression canceled.'
        : error && error.message
          ? error.message
          : String(error)
    });
  }
};
