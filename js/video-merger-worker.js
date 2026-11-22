/* Video Merger worker.
 * Demuxes, decodes, normalizes, re-encodes and muxes multiple clips into one file.
 * Mediabunny (MPL-2.0) + WebCodecs. No network requests and no server. */

import * as MB from '../vendor/mediabunny/mediabunny.min.mjs';

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
const MAX_OUTPUT_EDGE = 4096;

let activeOutput = null;
let cancelRequested = false;

function openInput(blob) {
  return new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
}

function outputFormatFor(format) {
  return format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat();
}

function checkCancel() {
  if (cancelRequested) throw new Error('Merge canceled.');
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

async function checkSupport(sizes) {
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

    try {
      result[format].audio = await MB.canEncodeAudio(audioCodec, {
        numberOfChannels: AUDIO_CHANNELS,
        sampleRate: AUDIO_SAMPLE_RATE
      });
    } catch (error) {
      result[format].audio = false;
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

async function addSilenceFrames(source, absoluteFrame, frameCount, onProgress) {
  let written = 0;
  while (written < frameCount) {
    checkCancel();
    const length = Math.min(AUDIO_SAMPLE_RATE, frameCount - written);
    const data = new Float32Array(length * AUDIO_CHANNELS);
    await addAudioFrames(source, absoluteFrame + written, data);
    written += length;
    if (onProgress) onProgress(written / frameCount);
  }
}

async function merge(clips, options, id) {
  cancelRequested = false;

  if (!Array.isArray(clips) || clips.length < 2) {
    throw new Error('Add at least two video clips before merging.');
  }

  const format = options.format === 'webm' ? 'webm' : 'mp4';
  const quality = options.quality === 'high' || options.quality === 'low' ? options.quality : 'medium';
  const fit = options.fit === 'cover' ? 'cover' : 'contain';
  const background = /^#[0-9a-f]{6}$/i.test(options.background || '') ? options.background : '#0f172a';
  const width = even(Number(options.width) || 0);
  const height = even(Number(options.height) || 0);

  if (width < 2 || height < 2) {
    throw new Error('The output size is not valid.');
  }
  if (width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE) {
    throw new Error(`The output cannot exceed ${MAX_OUTPUT_EDGE} px on either edge. Choose a smaller resolution.`);
  }

  const prepared = [];
  let totalFrames = 0;
  let hasAudio = false;
  let output = null;

  try {
    for (const clip of clips) {
      checkCancel();
      const input = openInput(clip.file);
      let duration;
      try {
        duration = await input.computeDuration();
      } catch (error) {
        input.dispose();
        throw new Error(`"${clip.name}" could not be read as a supported video.`);
      }

      if (!Number.isFinite(duration) || duration <= 0) {
        input.dispose();
        throw new Error(`"${clip.name}" has no readable video duration.`);
      }

      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        input.dispose();
        throw new Error(`"${clip.name}" does not contain a video track.`);
      }

      let videoDecodable = false;
      try {
        videoDecodable = await videoTrack.canDecode();
      } catch (error) {
        videoDecodable = false;
      }
      if (!videoDecodable) {
        input.dispose();
        throw new Error(`This browser cannot decode the video in "${clip.name}".`);
      }

      let audioTrack = null;
      try {
        audioTrack = await input.getPrimaryAudioTrack();
      } catch (error) {
        audioTrack = null;
      }

      let audioUsable = false;
      if (audioTrack) {
        let audioDecodable = false;
        try {
          audioDecodable = await audioTrack.canDecode();
        } catch (error) {
          audioDecodable = false;
        }
        if (!audioDecodable) {
          input.dispose();
          throw new Error(
            `The audio in "${clip.name}" cannot be decoded by this browser. Remove that clip or try another browser so audio is not silently lost.`
          );
        }
        audioUsable = true;
        hasAudio = true;
      }

      const fps = Number(clip.fps) > 0 ? Number(clip.fps) : 30;
      const durationFrames = Math.max(1, Math.round(duration * AUDIO_SAMPLE_RATE));
      prepared.push({
        input,
        name: clip.name || 'clip',
        duration,
        durationFrames,
        videoTrack,
        audioTrack: audioUsable ? audioTrack : null,
        fps,
        offset: totalFrames / AUDIO_SAMPLE_RATE,
        offsetFrames: totalFrames
      });
      totalFrames += durationFrames;
    }

    const totalDuration = totalFrames / AUDIO_SAMPLE_RATE;
    if (totalDuration <= 0) {
      throw new Error('The selected clips have no usable duration.');
    }

    checkCancel();

    const target = new MB.BufferTarget();
    output = new MB.Output({ format: outputFormatFor(format), target });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The browser could not create a canvas for the merged video.');

    const mediaQuality = new MB.Quality(quality);
    const videoSource = new MB.CanvasSource(canvas, {
      codec: format === 'webm' ? 'vp9' : 'avc',
      quality: mediaQuality,
      keyFrameInterval: 2
    });
    output.addVideoTrack(videoSource);

    let audioSource = null;
    if (hasAudio) {
      audioSource = new MB.AudioSampleSource({
        codec: format === 'webm' ? 'opus' : 'aac',
        quality: mediaQuality
      });
      output.addAudioTrack(audioSource);
    }

    activeOutput = output;
    await output.start();

    const clipSpan = 1 / prepared.length;
    const videoWeight = audioSource ? 0.82 : 1;

    for (let index = 0; index < prepared.length; index += 1) {
      checkCancel();
      const clip = prepared[index];
      const clipBase = index * clipSpan;
      const sink = new MB.CanvasSink(clip.videoTrack, {
        width,
        height,
        fit,
        alpha: true,
        poolSize: 2
      });

      let firstFrame = true;
      let lastEnd = 0;
      let frameCount = 0;

      for await (const frame of sink.canvases(0, clip.duration)) {
        checkCancel();
        let start = firstFrame ? 0 : Math.max(0, frame.timestamp);
        firstFrame = false;
        start = Math.max(start, lastEnd);
        if (start >= clip.duration - 0.0005) break;

        const nominal = 1 / clip.fps;
        let end = Math.min(
          clip.duration,
          frame.timestamp + (Number(frame.duration) > 0 ? frame.duration : nominal)
        );
        if (end <= start + 0.0005) end = Math.min(clip.duration, start + nominal);
        if (end <= start + 0.0005) continue;

        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(frame.canvas, 0, 0, width, height);

        await videoSource.add(clip.offset + start, end - start);
        frameCount += 1;
        lastEnd = start + (end - start);
        postProgress(id, clipBase + clipSpan * videoWeight * (start / clip.duration), {
          clipIndex: index + 1,
          clipCount: prepared.length,
          phase: 'video'
        });
      }

      if (!frameCount) {
        throw new Error(`No decodable video frames were found in "${clip.name}".`);
      }

      if (lastEnd < clip.duration - 0.002) {
        const last = await sink.getCanvas(Math.max(0, clip.duration - 0.001));
        if (last) {
          context.fillStyle = background;
          context.fillRect(0, 0, width, height);
          context.drawImage(last.canvas, 0, 0, width, height);
          await videoSource.add(clip.offset + lastEnd, clip.duration - lastEnd);
        }
      }

      if (audioSource) {
        const clipFrames = clip.durationFrames;
        const clipStartFrame = clip.offsetFrames;
        let cursor = 0;

        if (clip.audioTrack) {
          const audioSink = new MB.AudioSampleSink(clip.audioTrack);
          for await (const sample of audioSink.samples(0, clip.duration)) {
            checkCancel();
            const sampleStart = sample.timestamp;
            const sampleEnd = sample.timestamp + sample.duration;
            const start = Math.max(
              cursor,
              Math.round(Math.max(0, sampleStart) * AUDIO_SAMPLE_RATE)
            );
            const end = Math.min(clipFrames, Math.round(sampleEnd * AUDIO_SAMPLE_RATE));

            if (end <= start) {
              sample.close();
              continue;
            }

            if (start > cursor) {
              await addSilenceFrames(
                audioSource,
                clipStartFrame + cursor,
                start - cursor,
                (fraction) => {
                  postProgress(
                    id,
                    clipBase +
                      clipSpan *
                        (videoWeight +
                          ((1 - videoWeight) * (cursor + (start - cursor) * fraction)) / clipFrames),
                    { clipIndex: index + 1, clipCount: prepared.length, phase: 'audio' }
                  );
                }
              );
            }

            const rate = sample.sampleRate;
            const sourceStart = Math.round(
              Math.max(0, (start / AUDIO_SAMPLE_RATE - sampleStart) * rate)
            );
            const sourceEnd = Math.round(
              Math.min(
                sample.numberOfFrames,
                (end / AUDIO_SAMPLE_RATE - sampleStart) * rate
              )
            );

            if (sourceEnd > sourceStart) {
              const stereo = readStereo(sample);
              const data = resampleStereo(
                stereo.left,
                stereo.right,
                sourceStart,
                sourceEnd,
                end - start
              );
              await addAudioFrames(audioSource, clipStartFrame + start, data);
            }
            sample.close();
            cursor = end;

            postProgress(
              id,
              clipBase +
                clipSpan * (videoWeight + ((1 - videoWeight) * cursor) / clipFrames),
              { clipIndex: index + 1, clipCount: prepared.length, phase: 'audio' }
            );
          }
        }

        if (cursor < clipFrames) {
          await addSilenceFrames(
            audioSource,
            clipStartFrame + cursor,
            clipFrames - cursor,
            (fraction) => {
              postProgress(
                id,
                clipBase +
                  clipSpan *
                    (videoWeight +
                      ((1 - videoWeight) * (cursor + (clipFrames - cursor) * fraction)) / clipFrames),
                { clipIndex: index + 1, clipCount: prepared.length, phase: 'audio' }
              );
            }
          );
        }
      }

      postProgress(id, clipBase + clipSpan, {
        clipIndex: index + 1,
        clipCount: prepared.length,
        phase: 'clip'
      });

      try {
        clip.input.dispose();
      } catch (error) {
        /* The input has already been released. */
      }
      clip.input = null;
    }

    checkCancel();
    postProgress(id, 0.99, { phase: 'finalizing' });
    await output.finalize();
    activeOutput = null;

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 512) {
      throw new Error('The encoder did not produce a valid merged file.');
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
        throw new Error('The merged file does not contain a video track.');
      }

      const outputWidth = await outputVideo.getDisplayWidth();
      const outputHeight = await outputVideo.getDisplayHeight();
      if (Math.abs(outputWidth - width) > 1 || Math.abs(outputHeight - height) > 1) {
        throw new Error(
          `The merged file is ${outputWidth} × ${outputHeight}, not the requested ${width} × ${height}.`
        );
      }

      const tolerance = Math.max(0.35, totalDuration * 0.03);
      if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - totalDuration) > tolerance) {
        throw new Error(
          `The merged file duration (${Number(outputDuration).toFixed(2)} s) does not match the planned duration (${totalDuration.toFixed(2)} s).`
        );
      }

      if (hasAudio && !outputAudio) {
        throw new Error('The merged file is missing the audio track that the clips contain.');
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
        clipCount: prepared.length,
        plannedDuration: totalDuration
      };
    } finally {
      try {
        check.dispose();
      } catch (error) {
        /* The check input has already been released. */
      }
    }
  } finally {
    for (const clip of prepared) {
      if (clip.input) {
        try {
          clip.input.dispose();
        } catch (error) {
          /* The input has already been released. */
        }
      }
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
        /* The merge call reports the cancellation. */
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
      const payload = await checkSupport(message.sizes || []);
      self.postMessage({ id, type: 'done', payload });
    } else if (type === 'merge') {
      const payload = await merge(message.clips || [], message.options || {}, id);
      self.postMessage({ id, type: 'done', payload }, [payload.buffer]);
    }
  } catch (error) {
    const canceled = cancelRequested && /cancel/i.test(error && error.message ? error.message : '');
    self.postMessage({
      id,
      type: 'error',
      name: error && error.name ? error.name : 'Error',
      message: canceled
        ? 'Merge canceled.'
        : error && error.message
          ? error.message
          : String(error)
    });
  }
};
