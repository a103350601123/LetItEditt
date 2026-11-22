/* Video Trimmer export worker.
 * Demuxes, decodes, trims, re-encodes and muxes entirely in the browser.
 * Mediabunny (MPL-2.0) + WebCodecs. No network requests and no server. */

import * as MB from '../vendor/mediabunny/mediabunny.min.mjs';

let activeConversion = null;
let cancelRequested = false;

function openInput(blob) {
  return new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
}

function outputFormatFor(format) {
  return format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat();
}

async function inspect(file) {
  const input = openInput(file);
  const duration = await input.computeDuration();
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const container = (await input.getFormat()).name;

  if (!video) {
    return { hasVideo: false, duration, container };
  }

  const metrics = await video.computeFrameRateMetrics({ targetPacketCount: 180 });

  return {
    hasVideo: true,
    container,
    duration,
    width: await video.getDisplayWidth(),
    height: await video.getDisplayHeight(),
    fps: metrics.bestGuessFrameRate,
    fpsVariable: metrics.underlyingFrameRate === null,
    videoCodec: await video.getCodec(),
    videoDecodable: await video.canDecode(),
    hasAudio: Boolean(audio),
    audioCodec: audio ? await audio.getCodec() : null,
    audioChannels: audio ? await audio.getNumberOfChannels() : null,
    audioSampleRate: audio ? await audio.getSampleRate() : null,
    audioDecodable: audio ? await audio.canDecode() : false
  };
}

async function thumbnails(file, count) {
  const input = openInput(file);
  const duration = await input.computeDuration();
  const track = await input.getPrimaryVideoTrack();
  if (!track) return [];

  const sink = new MB.VideoSampleSink(track);
  const times = [];
  for (let i = 0; i < count; i += 1) times.push(((i + 0.5) / count) * duration);

  const bitmaps = [];
  for await (const sample of sink.samplesAtTimestamps(times)) {
    if (!sample) {
      bitmaps.push(null);
      continue;
    }
    const width = 160;
    const height = 90;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = Math.max(width / sample.displayWidth, height / sample.displayHeight);
    const drawWidth = sample.displayWidth * scale;
    const drawHeight = sample.displayHeight * scale;
    sample.draw(
      context,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    bitmaps.push(canvas.transferToImageBitmap());
    sample.close();
  }
  return bitmaps;
}

function removeSectionProcessors(start, end) {
  const shift = end - start;

  return {
    video(sample) {
      const timestamp = sample.timestamp;
      const duration = sample.duration;
      const sampleEnd = timestamp + duration;

      if (timestamp >= start && timestamp < end) {
        sample.close();
        return null;
      }
      if (timestamp < start && sampleEnd > start) {
        sample.setDuration(start - timestamp);
        return sample;
      }
      if (timestamp >= end) sample.setTimestamp(timestamp - shift);
      return sample;
    },
    audio(sample) {
      const timestamp = sample.timestamp;
      const sampleEnd = timestamp + sample.duration;
      const rate = sample.sampleRate;

      if (sampleEnd <= start) return sample;
      if (timestamp >= end) {
        sample.setTimestamp(timestamp - shift);
        return sample;
      }
      if (timestamp >= start && sampleEnd <= end) {
        sample.close();
        return null;
      }
      if (timestamp < start && sampleEnd > start) {
        const keepFrames = Math.floor((start - timestamp) * rate);
        if (keepFrames <= 0) {
          sample.close();
          return null;
        }
        const trimmed = sample.trim(0, keepFrames);
        sample.close();
        return trimmed;
      }
      if (timestamp < end && sampleEnd > end) {
        const dropFrames = Math.ceil((end - timestamp) * rate);
        if (dropFrames >= sample.numberOfFrames) {
          sample.close();
          return null;
        }
        const trimmed = sample.trim(dropFrames);
        trimmed.setTimestamp(end - shift);
        sample.close();
        return trimmed;
      }
      sample.close();
      return null;
    }
  };
}

async function exportTrim(file, options) {
  const { mode, start, end, format, quality } = options;
  cancelRequested = false;

  const input = openInput(file);
  const target = new MB.BufferTarget();
  const output = new MB.Output({ format: outputFormatFor(format), target });
  const mediaQuality = new MB.Quality(quality);
  const videoCodec = format === 'webm' ? 'vp9' : 'avc';
  const audioCodec = format === 'webm' ? 'opus' : 'aac';

  const conversionOptions = {
    input,
    output,
    copy: false,
    video: { codec: videoCodec, quality: mediaQuality },
    audio: { codec: audioCodec, quality: mediaQuality }
  };

  if (mode === 'keep') {
    conversionOptions.trim = { start, end };
  } else {
    const processors = removeSectionProcessors(start, end);
    conversionOptions.video.process = processors.video;
    conversionOptions.audio.process = processors.audio;
  }

  const conversion = await MB.Conversion.init(conversionOptions);
  if (!conversion.isValid) {
    const reason = conversion.discardedTracks
      .map((track) => track.reason)
      .filter(Boolean)
      .join(' ');
    throw new Error(reason || 'This selection cannot be exported.');
  }

  if (cancelRequested) {
    await conversion.cancel();
    throw new Error('Export canceled.');
  }

  activeConversion = conversion;
  conversion.onProgress = (progress) => {
    self.postMessage({ type: 'progress', progress: Math.max(0, Math.min(1, progress)) });
  };

  try {
    await conversion.execute();
  } finally {
    activeConversion = null;
  }

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 512) {
    throw new Error('The encoder did not produce a valid file.');
  }

  const blob = new Blob([buffer], {
    type: format === 'webm' ? 'video/webm' : 'video/mp4'
  });
  const check = openInput(blob);
  const duration = await check.computeDuration();
  const videoTrack = await check.getPrimaryVideoTrack();
  const audioTrack = await check.getPrimaryAudioTrack();

  return {
    buffer,
    mimeType: format === 'webm' ? 'video/webm' : 'video/mp4',
    extension: format === 'webm' ? 'webm' : 'mp4',
    duration,
    width: videoTrack ? await videoTrack.getDisplayWidth() : 0,
    height: videoTrack ? await videoTrack.getDisplayHeight() : 0,
    hasAudio: Boolean(audioTrack),
    size: blob.size
  };
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const { id, type } = message;

  if (type === 'cancel') {
    cancelRequested = true;
    if (activeConversion) {
      try {
        await activeConversion.cancel();
      } catch (error) {
        /* The execute() call reports the cancellation. */
      }
    }
    return;
  }

  try {
    if (type === 'inspect') {
      self.postMessage({ id, type: 'done', payload: await inspect(message.file) });
    } else if (type === 'thumbnails') {
      const bitmaps = await thumbnails(message.file, message.count);
      self.postMessage(
        { id, type: 'done', payload: bitmaps },
        bitmaps.filter((bitmap) => bitmap !== null)
      );
    } else if (type === 'export') {
      const payload = await exportTrim(message.file, message);
      self.postMessage({ id, type: 'done', payload }, [payload.buffer]);
    }
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      name: error && error.name ? error.name : 'Error',
      message: error && error.message ? error.message : String(error)
    });
  }
};
