/* Video Resizer worker.
 * Demuxes, decodes, rescales, composites, re-encodes and muxes one video
 * entirely in the browser. Mediabunny (MPL-2.0) + WebCodecs.
 * No network requests, no server, no upload. */

import * as MB from '../vendor/mediabunny/mediabunny.min.mjs';

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const MAX_OUTPUT_EDGE = 4096;
const DEFAULT_BACKGROUND = '#000000';

let activeOutput = null;
let cancelRequested = false;

function openInput(blob) {
  return new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
}

function outputFormatFor(format) {
  return format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat();
}

function checkCancel() {
  if (cancelRequested) throw new Error('Resize canceled.');
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

function normalizeColor(value) {
  const text = String(value || '').trim();
  const long = /^#([0-9a-f]{6})$/i.exec(text);
  if (long) return `#${long[1].toLowerCase()}`;
  const short = /^#([0-9a-f]{3})$/i.exec(text);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_BACKGROUND;
}

function videoQuality(options) {
  const mode = options.quality;
  if (mode === 'custom') {
    const bitrate = Math.round(Number(options.bitrate) || 0);
    if (!Number.isFinite(bitrate) || bitrate < 50000 || bitrate > 100000000) {
      throw new Error('The custom video bitrate is not valid. Use a value between 0.05 and 100 Mbps.');
    }
    return new MB.Quality({ bitrate, bitrateMode: 'variable' });
  }
  if (mode === 'high') return new MB.Quality('high');
  if (mode === 'smaller' || mode === 'low') return new MB.Quality('low');
  return new MB.Quality('medium');
}

function audioQuality(format) {
  return new MB.Quality({ bitrate: format === 'webm' ? 96000 : 128000 });
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
    }

    let thumbnail = null;
    if (videoDecodable) {
      try {
        thumbnail = await makeThumbnail(videoTrack, duration);
      } catch (error) {
        thumbnail = null;
      }
    }

    let videoCodec = null;
    try {
      videoCodec = await videoTrack.getCodec();
    } catch (error) {
      videoCodec = null;
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
      videoDecodable,
      hasAudio: Boolean(audioTrack),
      audioCodec,
      audioChannels,
      audioSampleRate,
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

async function checkSupport(sizes, needsAudio) {
  const result = {};
  for (const format of ['mp4', 'webm']) {
    const videoCodec = format === 'webm' ? 'vp9' : 'avc';
    const audioCodec = format === 'webm' ? 'opus' : 'aac';
    result[format] = {};

    for (const size of sizes) {
      try {
        result[format][size.key] = await MB.canEncodeVideo(videoCodec, {
          width: size.width,
          height: size.height
        });
      } catch (error) {
        result[format][size.key] = false;
      }
    }

    if (needsAudio) {
      try {
        result[format].audio = await MB.canEncodeAudio(audioCodec, {
          numberOfChannels: AUDIO_CHANNELS,
          sampleRate: AUDIO_SAMPLE_RATE
        });
      } catch (error) {
        result[format].audio = false;
      }
    } else {
      result[format].audio = true;
    }
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

function validateSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('The output size is not valid.');
  }
  if (width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE) {
    throw new Error(`The output cannot exceed ${MAX_OUTPUT_EDGE} px on either edge. Choose a smaller resolution.`);
  }
}

async function exportResize(file, options, id) {
  cancelRequested = false;

  const format = options.format === 'webm' ? 'webm' : 'mp4';
  const width = even(Number(options.width) || 0);
  const height = even(Number(options.height) || 0);
  const fit = options.fit === 'fill' ? 'fill' : 'fit';
  const background = normalizeColor(options.background);
  validateSize(width, height);

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
      throw new Error('This browser cannot decode the video in this file.');
    }

    let audioTrack = null;
    try {
      audioTrack = await input.getPrimaryAudioTrack();
    } catch (error) {
      audioTrack = null;
    }

    if (audioTrack) {
      let audioDecodable = false;
      try {
        audioDecodable = await audioTrack.canDecode();
      } catch (error) {
        audioDecodable = false;
      }
      if (!audioDecodable) {
        throw new Error(
          'The audio in this video cannot be decoded by this browser. Exporting would silently lose it, so choose another file or browser.'
        );
      }
    }

    checkCancel();

    const target = new MB.BufferTarget();
    output = new MB.Output({ format: outputFormatFor(format), target });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The browser could not create a canvas for the resized video.');

    const mediaQuality = videoQuality(options);
    const videoSource = new MB.CanvasSource(canvas, {
      codec: format === 'webm' ? 'vp9' : 'avc',
      quality: mediaQuality,
      keyFrameInterval: 2
    });
    output.addVideoTrack(videoSource);

    if (audioTrack) {
      audioSource = new MB.AudioSampleSource({
        codec: format === 'webm' ? 'opus' : 'aac',
        quality: audioQuality(format)
      });
      output.addAudioTrack(audioSource);
    }

    activeOutput = output;
    await output.start();

    const fps = Number(options.fps) > 0 ? Number(options.fps) : 30;
    const nominal = 1 / fps;
    // 'contain' keeps the whole frame and pads; 'cover' fills the frame and
    // crops the overflow. Neither mode ever stretches the picture.
    const sink = new MB.CanvasSink(videoTrack, {
      width,
      height,
      fit: fit === 'fill' ? 'cover' : 'contain',
      alpha: fit === 'fit',
      poolSize: 2
    });

    let firstFrame = true;
    let lastEnd = 0;
    let frameCount = 0;

    for await (const frame of sink.canvases(0, duration)) {
      checkCancel();
      let start = firstFrame ? 0 : Math.max(0, frame.timestamp);
      firstFrame = false;
      start = Math.max(start, lastEnd);
      if (start >= duration - 0.0005) break;

      let end = Math.min(
        duration,
        frame.timestamp + (Number(frame.duration) > 0 ? frame.duration : nominal)
      );
      if (end <= start + 0.0005) end = Math.min(duration, start + nominal);
      if (end <= start + 0.0005) continue;

      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(frame.canvas, 0, 0, width, height);

      await videoSource.add(start, end - start);
      frameCount += 1;
      lastEnd = end;
      postProgress(id, 0.85 * Math.min(1, start / duration), { phase: 'video' });
    }

    if (!frameCount) {
      throw new Error('No decodable video frames were found in this file.');
    }

    if (lastEnd < duration - 0.002) {
      const last = await sink.getCanvas(Math.max(0, duration - 0.001));
      if (last) {
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(last.canvas, 0, 0, width, height);
        await videoSource.add(lastEnd, duration - lastEnd);
      }
    }

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
        postProgress(id, 0.85 + 0.14 * Math.min(1, cursor / totalFrames), { phase: 'audio' });
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
      throw new Error('The encoder did not produce a valid resized file.');
    }

    const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
    const extension = format === 'webm' ? 'webm' : 'mp4';
    const blob = new Blob([buffer], { type: mimeType });
    const check = openInput(blob);

    try {
      const outputDuration = await check.computeDuration();
      const outputVideo = await check.getPrimaryVideoTrack();
      const outputAudio = await check.getPrimaryAudioTrack();

      if (!outputVideo) {
        throw new Error('The resized file does not contain a video track.');
      }

      const outputWidth = await outputVideo.getDisplayWidth();
      const outputHeight = await outputVideo.getDisplayHeight();
      if (Math.abs(outputWidth - width) > 1 || Math.abs(outputHeight - height) > 1) {
        throw new Error(
          `The resized file is ${outputWidth} × ${outputHeight}, not the requested ${width} × ${height}.`
        );
      }

      let outputRotation = 0;
      try {
        outputRotation = await outputVideo.getRotation();
      } catch (error) {
        outputRotation = 0;
      }
      if (outputRotation !== 0) {
        throw new Error('The resized file still carries rotation metadata and would display incorrectly.');
      }

      const tolerance = Math.max(0.35, duration * 0.03);
      if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - duration) > tolerance) {
        throw new Error(
          `The resized file duration (${Number(outputDuration).toFixed(2)} s) does not match the source duration (${duration.toFixed(2)} s).`
        );
      }

      if (audioTrack && !outputAudio) {
        throw new Error('The resized file is missing the audio track that the source video contains.');
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
        plannedDuration: duration,
        fit,
        background
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
      const payload = await checkSupport(message.sizes || [], Boolean(message.needsAudio));
      self.postMessage({ id, type: 'done', payload });
    } else if (type === 'export') {
      const payload = await exportResize(message.file, message.options || {}, id);
      self.postMessage({ id, type: 'done', payload }, [payload.buffer]);
    }
  } catch (error) {
    const canceled = cancelRequested && /cancel/i.test(error && error.message ? error.message : '');
    self.postMessage({
      id,
      type: 'error',
      name: error && error.name ? error.name : 'Error',
      message: canceled
        ? 'Resize canceled.'
        : error && error.message
          ? error.message
          : String(error)
    });
  }
};
