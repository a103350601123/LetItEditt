/* LetitEdit Video & Audio core.
 * Pure browser-side media helpers shared by the generated media tools. Nothing
 * here uploads user media. Codec and model modules are imported only by the
 * tool that needs them, and every long-running loop accepts an AbortSignal. */
(function (global) {
  'use strict';

  var script = typeof document === 'undefined' ? null : document.currentScript;
  var BASE = script
    ? new URL('.', script.src).href
    : (typeof document === 'undefined' ? './js/' : new URL('./js/', document.baseURI).href);
  var V = {};
  global.VideoCore = V;

  V.BASE = BASE;

  function $(id) { return typeof document === 'undefined' ? null : document.getElementById(id); }
  function on(target, event, handler) { if (target && target.addEventListener) target.addEventListener(event, handler); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function config() {
    var node = $('tool-config');
    if (!node) return {};
    try { return JSON.parse(node.textContent || '{}'); } catch (error) { return {}; }
  }

  function status(message, isError) {
    var node = $('v-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', Boolean(isError));
  }

  function setEnabled(ids, enabled) {
    (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
      var node = $(id);
      if (node) node.disabled = !enabled;
    });
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var whole = Math.floor(seconds);
    var hours = Math.floor(whole / 3600);
    var minutes = Math.floor((whole % 3600) / 60);
    var secs = whole % 60;
    var ms = Math.floor((seconds - whole) * 1000);
    var left = hours ? String(hours) + ':' : '';
    return left + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }

  function formatBytes(bytes) {
    if (!isFinite(bytes) || bytes <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    var value = bytes / Math.pow(1024, index);
    return (value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[index];
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return url;
  }

  function validateFile(file, maxBytes) {
    if (!file) throw new Error('Choose a file first.');
    var limit = maxBytes || 500 * 1024 * 1024;
    if (!file.size) throw new Error('That file is empty.');
    if (file.size > limit) throw new Error('That file is larger than ' + formatBytes(limit) + '. Try a smaller source.');
    return true;
  }

  function abortError() {
    var error = new Error('Cancelled.');
    error.name = 'AbortError';
    return error;
  }

  function friendlyError(error) {
    if (!error) return 'Something went wrong.';
    if (error.name === 'AbortError' || /abort|cancel/i.test(error.message || '')) return 'Cancelled.';
    return String(error.message || error).replace(/^Error:\s*/, '');
  }

  function checkSignal(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  function importModule(relative) {
    return import(new URL(relative, BASE).href);
  }

  var mbPromise = null;
  var mp3Ready = false;

  function mediabunny() {
    if (!mbPromise) mbPromise = importModule('vendor/mediabunny.min.mjs');
    return mbPromise;
  }

  async function registerMp3() {
    var mb = await mediabunny();
    if (!mp3Ready) {
      var extension = await importModule('vendor/mediabunny-mp3-encoder.mjs');
      if (typeof extension.registerMp3Encoder === 'function') extension.registerMp3Encoder();
      mp3Ready = true;
    }
    return mb;
  }

  async function createInput(file) {
    var mb = await mediabunny();
    return new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
  }

  async function probe(file) {
    var input = await createInput(file);
    var duration = await input.computeDuration();
    var videoTrack = await input.getPrimaryVideoTrack();
    var audioTrack = await input.getPrimaryAudioTrack();
    var info = {
      input: input,
      duration: duration,
      videoTrack: videoTrack,
      audioTrack: audioTrack,
      hasVideo: Boolean(videoTrack),
      hasAudio: Boolean(audioTrack),
      width: 0,
      height: 0,
      fps: 0,
      sampleRate: 0,
      channels: 0
    };
    if (videoTrack) {
      info.width = await videoTrack.getDisplayWidth();
      info.height = await videoTrack.getDisplayHeight();
      try {
        var metrics = await videoTrack.computeFrameRateMetrics();
        info.fps = metrics.bestGuessFrameRate || 0;
      } catch (error) { info.fps = 0; }
    }
    if (audioTrack) {
      info.sampleRate = await audioTrack.getSampleRate();
      info.channels = await audioTrack.getNumberOfChannels();
    }
    return info;
  }

  function makeAudioBuffer(length, channels, sampleRate) {
    if (typeof AudioBuffer !== 'undefined') return new AudioBuffer({ length: length, numberOfChannels: channels, sampleRate: sampleRate });
    var context = new (global.AudioContext || global.webkitAudioContext)();
    var buffer = context.createBuffer(channels, length, sampleRate);
    context.close();
    return buffer;
  }

  async function decodeAudio(file, signal) {
    var info = await probe(file);
    checkSignal(signal);
    if (!info.audioTrack) throw new Error('This file has no audio track.');
    if (!(await info.audioTrack.canDecode())) throw new Error('This browser cannot decode the audio in this file.');
    var mb = await mediabunny();
    var sink = new mb.AudioBufferSink(info.audioTrack);
    var sampleRate = 48000;
    var channels = clamp(info.channels || 2, 1, 2);
    var length = Math.max(1, Math.ceil((info.duration + 0.25) * sampleRate));
    var context = new OfflineAudioContext(channels, length, sampleRate);
    var count = 0;
    for await (var item of sink.buffers(0, info.duration + 0.25)) {
      checkSignal(signal);
      var source = context.createBufferSource();
      source.buffer = item.buffer;
      source.connect(context.destination);
      source.start(clamp(item.timestamp, 0, info.duration + 0.2));
      count++;
    }
    if (!count) throw new Error('No audio samples could be decoded.');
    var rendered = await context.startRendering();
    checkSignal(signal);
    return rendered;
  }

  function editAudio(buffer, options) {
    var opts = options || {};
    var sampleRate = buffer.sampleRate;
    var channels = buffer.numberOfChannels;
    var start = clamp(Number(opts.start) || 0, 0, buffer.duration);
    var end = clamp(Number(opts.end) || buffer.duration, start + 0.001, buffer.duration);
    var first = Math.floor(start * sampleRate);
    var last = Math.min(buffer.length, Math.ceil(end * sampleRate));
    var frames = Math.max(1, last - first);
    var result = makeAudioBuffer(frames, channels, sampleRate);
    var gain = clamp(Number(opts.gain) / 100, 0, 2);
    if (!isFinite(gain)) gain = 1;
    var fadeIn = Math.max(0, Number(opts.fadeIn) || 0) / 1000;
    var fadeOut = Math.max(0, Number(opts.fadeOut) || 0) / 1000;
    var reverse = Boolean(opts.reverse);
    for (var channel = 0; channel < channels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      for (var i = 0; i < frames; i++) {
        var sourceIndex = reverse ? last - 1 - i : first + i;
        var sample = sourceIndex >= 0 && sourceIndex < input.length ? input[sourceIndex] : 0;
        var time = i / sampleRate;
        var envelope = 1;
        if (fadeIn > 0 && time < fadeIn) envelope *= time / fadeIn;
        var remaining = frames / sampleRate - time;
        if (fadeOut > 0 && remaining < fadeOut) envelope *= remaining / fadeOut;
        output[i] = clamp(sample * gain * envelope, -1, 1);
      }
    }
    return result;
  }

  function writeWav(buffer) {
    var channels = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var frames = buffer.length;
    var bytesPerSample = 2;
    var dataBytes = frames * channels * bytesPerSample;
    var bytes = new ArrayBuffer(44 + dataBytes);
    var view = new DataView(bytes);
    function text(offset, value) {
      for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    }
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, dataBytes, true);
    var data = [];
    for (var c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
    var offset = 44;
    for (var frame = 0; frame < frames; frame++) {
      for (var channel = 0; channel < channels; channel++) {
        var sample = clamp(data[channel][frame], -1, 1);
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  async function audioOutput(format, buffer) {
    var codec = format === 'mp3' ? 'mp3' : 'aac';
    var mb = await registerMp3();
    if (codec === 'aac') {
      var supported = await mb.canEncodeAudio('aac', { numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      if (!supported) throw new Error('This browser cannot encode AAC/M4A. Choose MP3 or WAV instead.');
    }
    var mbFormat = codec === 'mp3' ? new mb.Mp3OutputFormat() : new mb.Mp4OutputFormat();
    var output = new mb.Output({ format: mbFormat, target: new mb.BufferTarget() });
    var source = new mb.AudioBufferSource({ codec: codec, bitrate: 192000 });
    output.addAudioTrack(source);
    await output.start();
    await source.add(buffer);
    await output.finalize();
    if (!output.target.buffer) throw new Error('The encoder produced no data.');
    return new Blob([output.target.buffer], { type: codec === 'mp3' ? 'audio/mpeg' : 'audio/mp4' });
  }

  function outputFormat(kind) {
    return mediabunny().then(function (mb) {
      if (kind === 'webm') return { mb: mb, format: new mb.WebMOutputFormat() };
      return { mb: mb, format: new mb.Mp4OutputFormat() };
    });
  }

  function conversionError(conversion) {
    var reasons = (conversion.discardedTracks || []).map(function (track) { return track.reason; }).filter(Boolean);
    if (!reasons.length) return new Error('This conversion is not supported in this browser.');
    return new Error('This browser cannot produce that track: ' + reasons.join(', ') + '. Try a different format.');
  }

  async function convertVideo(file, options) {
    var opts = options || {};
    checkSignal(opts.signal);
    var pair = await outputFormat(opts.format === 'webm' ? 'webm' : 'mp4');
    var mb = pair.mb;
    var input = await createInput(file);
    var output = new mb.Output({ format: pair.format, target: new mb.BufferTarget() });
    var conversion = await mb.Conversion.init({
      input: input,
      output: output,
      tracks: 'primary',
      copy: opts.copy,
      video: opts.video,
      audio: opts.audio,
      trim: opts.trim,
      tags: {}
    });
    if (!conversion.isValid) throw conversionError(conversion);
    if (typeof opts.onProgress === 'function') conversion.onProgress = opts.onProgress;
    var onAbort = function () { try { output.cancel(); } catch (error) { /* already closed */ } };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } catch (error) {
      checkSignal(opts.signal);
      throw error;
    } finally {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
    if (!output.target.buffer) throw new Error('The encoder produced no data.');
    return new Blob([output.target.buffer], { type: pair.format.mimeType || 'video/mp4' });
  }

  async function canvasFrames(file, options) {
    var opts = options || {};
    var info = await probe(file);
    if (!info.videoTrack) throw new Error('This file has no video track.');
    if (!(await info.videoTrack.canDecode())) throw new Error('This browser cannot decode the video in this file.');
    var mb = await mediabunny();
    var fps = clamp(Number(opts.fps) || 10, 1, 30);
    var width = clamp(Number(opts.width) || 320, 80, 1280);
    var start = clamp(Number(opts.start) || 0, 0, Math.max(0, info.duration - 0.05));
    var end = clamp(Number(opts.end) || info.duration, start + 0.05, info.duration);
    var count = Math.min(opts.maxFrames || 180, Math.max(1, Math.floor((end - start) * fps)));
    var aspect = info.height && info.width ? info.height / info.width : 0.5625;
    var sink = new mb.CanvasSink(info.videoTrack, {
      width: width,
      height: Math.round(width * aspect),
      fit: 'contain'
    });
    var frames = [];
    for (var i = 0; i < count; i++) {
      checkSignal(opts.signal);
      var timestamp = start + i / fps;
      var result = await sink.getCanvas(timestamp);
      var canvas = result.canvas;
      frames.push({
        canvas: canvas,
        width: canvas.width,
        height: canvas.height,
        timestamp: timestamp,
        delay: Math.round(1000 / fps)
      });
      if (typeof opts.onProgress === 'function') opts.onProgress((i + 1) / count);
    }
    return { frames: frames, truncated: Math.floor((end - start) * fps) > count };
  }

  function ditherRGBA(data, width, strength) {
    var matrix = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    var amount = clamp(Number(strength) || 18, 0, 64);
    for (var i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
      var offset = (matrix[(pixel % 4) + (Math.floor(pixel / width) % 4) * 4] / 16 - 0.5) * amount;
      data[i] = clamp(data[i] + offset, 0, 255);
      data[i + 1] = clamp(data[i + 1] + offset, 0, 255);
      data[i + 2] = clamp(data[i + 2] + offset, 0, 255);
    }
    return data;
  }

  async function makeGif(frames, options) {
    var opts = options || {};
    var enc = await importModule('vendor/gifenc.esm.js');
    var gif = enc.GIFEncoder({ auto: true });
    for (var i = 0; i < frames.length; i++) {
      checkSignal(opts.signal);
      var frame = frames[i];
      var canvas = frame.canvas;
      var context = canvas.getContext('2d');
      var image = context.getImageData(0, 0, canvas.width, canvas.height);
      var rgba = new Uint8Array(image.data);
      if (opts.dither) ditherRGBA(rgba, canvas.width, opts.ditherAmount || 18);
      var palette = enc.quantize(rgba, 256);
      var indexed = enc.applyPalette(rgba, palette);
      gif.writeFrame(indexed, canvas.width, canvas.height, {
        palette: palette,
        delay: frame.delay,
        repeat: 0
      });
      if (typeof opts.onProgress === 'function') opts.onProgress((i + 1) / frames.length);
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  var mediaPipePromise = null;

  async function personSegmenter(signal) {
    checkSignal(signal);
    if (!mediaPipePromise) {
      mediaPipePromise = (async function () {
        var mod = await importModule('vendor/mediapipe/vision_bundle.mjs');
        var wasmUrl = new URL('vendor/mediapipe/wasm/', BASE).href;
        var fileset = await mod.FilesetResolver.forVisionTasks(wasmUrl);
        var options = {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          categoryConfidenceThreshold: 0.5
        };
        var segmenter;
        try {
          segmenter = await mod.ImageSegmenter.createFromOptions(fileset, options);
        } catch (error) {
          options.baseOptions.delegate = 'CPU';
          segmenter = await mod.ImageSegmenter.createFromOptions(fileset, options);
        }
        return { mod: mod, segmenter: segmenter };
      })().catch(function (error) { mediaPipePromise = null; throw error; });
    }
    return mediaPipePromise;
  }

  function closeSegmenter() {
    if (mediaPipePromise) {
      mediaPipePromise.then(function (engine) {
        if (engine && engine.segmenter && typeof engine.segmenter.close === 'function') engine.segmenter.close();
      }).catch(function () { /* nothing to close */ });
      mediaPipePromise = null;
    }
  }

  function maskFromCategories(maskData, width, height, threshold, feather) {
    var source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    var sourceContext = source.getContext('2d');
    var image = sourceContext.createImageData(width, height);
    var scale = maskData.length && maskData.length >= width * height ? 1 : 0;
    for (var i = 0; i < width * height; i++) {
      var person = scale && maskData[i] >= threshold;
      var alpha = person ? 255 : 0;
      image.data[i * 4] = 255;
      image.data[i * 4 + 1] = 255;
      image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = alpha;
    }
    sourceContext.putImageData(image, 0, 0);
    if (!feather) return source;
    var soft = document.createElement('canvas');
    soft.width = width;
    soft.height = height;
    var context = soft.getContext('2d');
    context.filter = 'blur(' + feather + 'px)';
    context.drawImage(source, 0, 0);
    return soft;
  }

  async function replaceBackground(file, options) {
    var opts = options || {};
    checkSignal(opts.signal);
    var info = await probe(file);
    if (!info.videoTrack) throw new Error('This file has no video track.');
    var engine = await personSegmenter(opts.signal);
    var pair = await outputFormat(opts.format === 'mp4' ? 'mp4' : 'webm');
    var transparent = opts.background === 'transparent' && pair.format.getSupportedVideoCodecs().indexOf('vp9') !== -1;
    if (opts.background === 'transparent' && !transparent) {
      transparent = false;
      if (typeof opts.onNotice === 'function') opts.onNotice('Transparent WebM is unavailable here; using a solid background instead.');
    }
    var width = opts.width || info.width || 640;
    var height = opts.height || info.height || 360;
    var mb = pair.mb;
    var input = await createInput(file);
    var output = new mb.Output({ format: pair.format, target: new mb.BufferTarget() });
    var videoOptions = {
      width: width,
      height: height,
      fit: 'contain',
      processedWidth: width,
      processedHeight: height,
      quality: new mb.Quality('medium'),
      alpha: transparent ? 'keep' : 'discard',
      process: async function (sample) {
        checkSignal(opts.signal);
        var work = document.createElement('canvas');
        work.width = width;
        work.height = height;
        var context = work.getContext('2d', { alpha: true });
        sample.draw(context, 0, 0, width, height);
        var result = engine.segmenter.segment(work);
        var maskData = result.categoryMask.getAsUint8Array();
        var mask = maskFromCategories(maskData, width, height, opts.threshold || 70, opts.feather || 0);
        var person = document.createElement('canvas');
        person.width = width;
        person.height = height;
        var personContext = person.getContext('2d', { alpha: true });
        personContext.drawImage(work, 0, 0);
        personContext.globalCompositeOperation = 'destination-in';
        personContext.drawImage(mask, 0, 0);
        personContext.globalCompositeOperation = 'source-over';
        context.clearRect(0, 0, width, height);
        if (!transparent) {
          if (opts.backgroundImage) context.drawImage(opts.backgroundImage, 0, 0, width, height);
          else {
            context.fillStyle = opts.color || '#2563eb';
            context.fillRect(0, 0, width, height);
          }
        }
        context.drawImage(person, 0, 0);
        return work;
      }
    };
    var conversion = await mb.Conversion.init({
      input: input,
      output: output,
      tracks: 'primary',
      video: videoOptions,
      audio: {},
      tags: {}
    });
    if (!conversion.isValid) throw conversionError(conversion);
    if (typeof opts.onProgress === 'function') conversion.onProgress = opts.onProgress;
    var onAbort = function () { try { output.cancel(); } catch (error) { /* closed */ } };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    try { await conversion.execute(); }
    finally { if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
    if (!output.target.buffer) throw new Error('The encoder produced no data.');
    return new Blob([output.target.buffer], { type: pair.format.mimeType || 'video/webm' });
  }

  function maskFrame(canvas, options) {
    var opts = options || {};
    var x = clamp(opts.x, 0, 100) / 100 * canvas.width;
    var y = clamp(opts.y, 0, 100) / 100 * canvas.height;
    var w = clamp(opts.w, 1, 100) / 100 * canvas.width;
    var h = clamp(opts.h, 1, 100) / 100 * canvas.height;
    x = clamp(x, 0, canvas.width - 1);
    y = clamp(y, 0, canvas.height - 1);
    w = clamp(w, 1, canvas.width - x);
    h = clamp(h, 1, canvas.height - y);
    var context = canvas.getContext('2d');
    if (opts.method === 'fill') {
      context.save();
      context.fillStyle = opts.color || '#0f172a';
      context.fillRect(x, y, w, h);
      context.restore();
      return canvas;
    }
    var cropX = Math.max(0, Math.floor(x));
    var cropY = Math.max(0, Math.floor(y));
    var cropW = Math.max(1, Math.floor(w));
    var cropH = Math.max(1, Math.floor(h));
    var image = context.getImageData(cropX, cropY, cropW, cropH);
    if (opts.method === 'mosaic') {
      var block = clamp(Number(opts.strength) || 8, 1, 40);
      for (var by = 0; by < cropH; by += block) {
        for (var bx = 0; bx < cropW; bx += block) {
          var r = 0, g = 0, b = 0, a = 0, n = 0;
          for (var yy = by; yy < Math.min(cropH, by + block); yy++) {
            for (var xx = bx; xx < Math.min(cropW, bx + block); xx++) {
              var index = (yy * cropW + xx) * 4;
              r += image.data[index]; g += image.data[index + 1]; b += image.data[index + 2]; a += image.data[index + 3]; n++;
            }
          }
          for (var y2 = by; y2 < Math.min(cropH, by + block); y2++) {
            for (var x2 = bx; x2 < Math.min(cropW, bx + block); x2++) {
              var i2 = (y2 * cropW + x2) * 4;
              image.data[i2] = r / n; image.data[i2 + 1] = g / n; image.data[i2 + 2] = b / n; image.data[i2 + 3] = a / n;
            }
          }
        }
      }
    } else if (opts.method === 'clone') {
      var sourceX = cropX - cropW < 0 ? cropX + cropW : cropX - cropW;
      var neighbour = context.getImageData(sourceX, cropY, cropW, cropH);
      image.data.set(neighbour.data);
    } else {
      var blur = document.createElement('canvas');
      blur.width = cropW;
      blur.height = cropH;
      var blurContext = blur.getContext('2d');
      blurContext.putImageData(image, 0, 0);
      var result = document.createElement('canvas');
      result.width = cropW;
      result.height = cropH;
      var resultContext = result.getContext('2d');
      resultContext.filter = 'blur(' + clamp(Number(opts.strength) || 8, 1, 24) + 'px)';
      resultContext.drawImage(blur, 0, 0);
      image = resultContext.getImageData(0, 0, cropW, cropH);
    }
    context.putImageData(image, cropX, cropY);
    return canvas;
  }

  async function maskWatermark(file, options) {
    var opts = options || {};
    checkSignal(opts.signal);
    var pair = await outputFormat(opts.format === 'webm' ? 'webm' : 'mp4');
    var mb = pair.mb;
    var input = await createInput(file);
    var output = new mb.Output({ format: pair.format, target: new mb.BufferTarget() });
    var width = opts.width || 960;
    var height = opts.height || 540;
    var work = document.createElement('canvas');
    work.width = width;
    work.height = height;
    var conversion = await mb.Conversion.init({
      input: input,
      output: output,
      tracks: 'primary',
      video: {
        width: width,
        height: height,
        fit: 'contain',
        processedWidth: width,
        processedHeight: height,
        quality: new mb.Quality('medium'),
        process: function (sample) {
          checkSignal(opts.signal);
          var context = work.getContext('2d');
          context.clearRect(0, 0, width, height);
          sample.draw(context, 0, 0, width, height);
          maskFrame(work, opts.mask);
          return work;
        }
      },
      audio: {},
      tags: {}
    });
    if (!conversion.isValid) throw conversionError(conversion);
    if (typeof opts.onProgress === 'function') conversion.onProgress = opts.onProgress;
    var onAbort = function () { try { output.cancel(); } catch (error) { /* closed */ } };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    try { await conversion.execute(); }
    finally { if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
    if (!output.target.buffer) throw new Error('The encoder produced no data.');
    return new Blob([output.target.buffer], { type: pair.format.mimeType || 'video/mp4' });
  }

  function resampleMono(audioBuffer, sampleRate) {
    var rate = sampleRate || 16000;
    var context = new OfflineAudioContext(1, Math.max(1, Math.ceil(audioBuffer.duration * rate)), rate);
    var source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.start();
    return context.startRendering();
  }

  var asrWorker = null;
  var asrCallbacks = null;

  function transcribe(samples, options) {
    var opts = options || {};
    return new Promise(function (resolve, reject) {
      if (asrWorker) { reject(new Error('A transcription is already running.')); return; }
      var worker = new Worker(new URL('video-asr-worker.js', BASE), { type: 'module' });
      asrWorker = worker;
      var transfer = new Float32Array(samples);
      worker.onmessage = function (event) {
        var message = event.data || {};
        if (message.type === 'progress' && typeof opts.onProgress === 'function') opts.onProgress(message.message);
        if (message.type === 'done') { cleanup(); resolve(message.result); }
        if (message.type === 'error') { cleanup(); reject(new Error(message.message || 'Transcription failed.')); }
      };
      worker.onerror = function (event) {
        cleanup();
        reject(new Error((event && event.message) || 'The recognition worker could not start.'));
      };
      function cleanup() {
        worker.terminate();
        if (asrWorker === worker) asrWorker = null;
        asrCallbacks = null;
      }
      asrCallbacks = { cleanup: cleanup, reject: reject };
      worker.postMessage({ type: 'transcribe', samples: transfer, language: opts.language || 'auto' }, [transfer.buffer]);
    });
  }

  function stopTranscription() {
    if (asrCallbacks) asrCallbacks.reject(new Error('Cancelled.'));
    if (asrWorker) { asrWorker.terminate(); asrWorker = null; }
    asrCallbacks = null;
  }

  function chunkLines(chunks, maxWords) {
    var lines = [];
    var limit = maxWords || 9;
    var current = null;
    (chunks || []).forEach(function (chunk) {
      var text = String(chunk.text || '').trim();
      if (!text) return;
      var start = Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[0]) : 0;
      var end = Array.isArray(chunk.timestamp) && isFinite(chunk.timestamp[1]) ? Number(chunk.timestamp[1]) : start + 0.4;
      if (!current || current.words.length >= limit || start - current.start > 7) {
        if (current) lines.push(current);
        current = { start: start, end: end, words: [] };
      }
      current.words.push(text);
      current.end = end;
    });
    if (current) lines.push(current);
    return lines.map(function (line) {
      return { start: line.start, end: Math.max(line.end, line.start + 0.4), text: line.words.join(' ').replace(/\s+([.,!?])/g, '$1') };
    });
  }

  function parseTimedTranscript(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    var result = [];
    lines.forEach(function (line) {
      var parts = line.split('|');
      var timing = (parts.shift() || '').trim();
      var body = parts.join('|').trim();
      var match = timing.match(/([\d:.]+)\s*(?:-->|->)\s*([\d:.]+)/);
      if (!match || !body) return;
      function seconds(value) {
        var bits = value.split(':').map(Number);
        if (bits.some(function (bit) { return !isFinite(bit); })) return NaN;
        return bits.reduce(function (total, bit) { return total * 60 + bit; }, 0);
      }
      var start = seconds(match[1]);
      var end = seconds(match[2]);
      if (isFinite(start) && isFinite(end) && end > start) result.push({ start: start, end: end, text: body });
    });
    return result;
  }

  function srtTime(seconds) {
    var ms = Math.max(0, Math.round(seconds * 1000));
    var hours = Math.floor(ms / 3600000);
    var minutes = Math.floor((ms % 3600000) / 60000);
    var secs = Math.floor((ms % 60000) / 1000);
    var milli = ms % 1000;
    return [hours, minutes, secs].map(function (value) { return String(value).padStart(2, '0'); }).join(':') + ',' + String(milli).padStart(3, '0');
  }

  function formatTranscript(lines, format) {
    if (format === 'vtt') {
      return 'WEBVTT\n\n' + lines.map(function (line, index) {
        return (index + 1) + '\n' + srtTime(line.start).replace(',', '.') + ' --> ' + srtTime(line.end).replace(',', '.') + '\n' + line.text + '\n';
      }).join('\n');
    }
    if (format === 'txt') return lines.map(function (line) { return line.text; }).join('\n');
    return lines.map(function (line, index) {
      return (index + 1) + '\n' + srtTime(line.start) + ' --> ' + srtTime(line.end) + '\n' + line.text + '\n';
    }).join('\n');
  }

  function seriesFromAudio(buffer, windowSeconds) {
    var step = windowSeconds || 0.5;
    var data = buffer.getChannelData(0);
    var samplesPerWindow = Math.max(1, Math.floor(buffer.sampleRate * step));
    var result = [];
    for (var i = 0; i < data.length; i += samplesPerWindow) {
      var sum = 0;
      var end = Math.min(data.length, i + samplesPerWindow);
      for (var j = i; j < end; j++) sum += data[j] * data[j];
      result.push({ time: i / buffer.sampleRate, energy: Math.sqrt(sum / Math.max(1, end - i)) });
    }
    return result;
  }

  function normalise(values) {
    var max = values.reduce(function (best, value) { return Math.max(best, value); }, 0) || 1;
    return values.map(function (value) { return value / max; });
  }

  function findHighlights(options) {
    var audio = normalise((options.audioSeries || []).map(function (item) { return item.energy; }));
    var motion = normalise(options.motion || []);
    var transcript = options.transcript || [];
    var length = Math.max(5, Number(options.length) || 30);
    var count = Math.max(1, Number(options.count) || 2);
    var duration = Number(options.duration) || 0;
    if (duration < length) length = duration;
    var step = 1;
    var candidates = [];
    for (var start = 0; start + length <= duration + 0.001; start += step) {
      function average(series, timeScale) {
        if (!series.length) return 0;
        var from = Math.floor(start / timeScale);
        var to = Math.min(series.length, Math.ceil((start + length) / timeScale));
        var sum = 0;
        for (var i = from; i < to; i++) sum += series[i] || 0;
        return sum / Math.max(1, to - from);
      }
      var speech = 0;
      transcript.forEach(function (line) {
        if (line.end >= start && line.start <= start + length) speech += Math.max(0, line.end - Math.max(line.start, start));
      });
      var score = average(audio, options.audioStep || 0.5) * 0.55 + average(motion, options.motionStep || 1) * 0.2 + Math.min(1, speech / length) * (options.useAI ? 0.25 : 0);
      candidates.push({ start: start, end: start + length, score: score });
    }
    candidates.sort(function (a, b) { return b.score - a.score; });
    var chosen = [];
    for (var c = 0; c < candidates.length && chosen.length < count; c++) {
      var candidate = candidates[c];
      if (chosen.some(function (item) { return Math.abs(item.start - candidate.start) < length * 0.8; })) continue;
      chosen.push(candidate);
    }
    return chosen.sort(function (a, b) { return a.start - b.start; });
  }

  V.$ = $;
  V.on = on;
  V.clamp = clamp;
  V.config = config;
  V.status = status;
  V.setEnabled = setEnabled;
  V.formatTime = formatTime;
  V.formatBytes = formatBytes;
  V.download = download;
  V.friendlyError = friendlyError;
  V.validateFile = validateFile;
  V.checkSignal = checkSignal;
  V.abortError = abortError;
  V.importModule = importModule;
  V.mediabunny = mediabunny;
  V.registerMp3 = registerMp3;
  V.createInput = createInput;
  V.probe = probe;
  V.decodeAudio = decodeAudio;
  V.editAudio = editAudio;
  V.writeWav = writeWav;
  V.audioOutput = audioOutput;
  V.convertVideo = convertVideo;
  V.canvasFrames = canvasFrames;
  V.makeGif = makeGif;
  V.personSegmenter = personSegmenter;
  V.closeSegmenter = closeSegmenter;
  V.replaceBackground = replaceBackground;
  V.maskFrame = maskFrame;
  V.maskWatermark = maskWatermark;
  V.resampleMono = resampleMono;
  V.transcribe = transcribe;
  V.stopTranscription = stopTranscription;
  V.chunkLines = chunkLines;
  V.parseTimedTranscript = parseTimedTranscript;
  V.formatTranscript = formatTranscript;
  V.seriesFromAudio = seriesFromAudio;
  V.normalise = normalise;
  V.findHighlights = findHighlights;
})(typeof window !== 'undefined' ? window : globalThis);
