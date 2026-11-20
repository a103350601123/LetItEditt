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

  /* ---------- Pure sample-buffer DSP ----------
   * Every helper returns a new AudioBuffer-like object. No buffer is mutated,
   * so the original decode can always be replayed for A/B comparison. */

  function sliceBuffer(buffer, start, end) {
    var rate = buffer.sampleRate;
    var channels = buffer.numberOfChannels;
    var first = clamp(Number(start) || 0, 0, buffer.duration);
    var last = clamp(Number(end) || buffer.duration, first + 0.001, buffer.duration);
    var from = Math.min(buffer.length, Math.floor(first * rate));
    var to = Math.min(buffer.length, Math.max(from + 1, Math.ceil(last * rate)));
    var result = makeAudioBuffer(to - from, channels, rate);
    for (var channel = 0; channel < channels; channel++) {
      var input = buffer.getChannelData(channel);
      result.getChannelData(channel).set(input.subarray(from, to));
    }
    return result;
  }

  function concatBuffers(buffers) {
    var list = (buffers || []).filter(Boolean);
    if (!list.length) throw new Error('There are no audio buffers to join.');
    var rate = list[0].sampleRate;
    var channels = Math.max.apply(null, list.map(function (item) { return item.numberOfChannels; }));
    var frames = list.reduce(function (total, item) { return total + item.length; }, 0);
    var result = makeAudioBuffer(Math.max(1, frames), channels, rate);
    var offset = 0;
    list.forEach(function (item) {
      for (var channel = 0; channel < channels; channel++) {
        var source = item.getChannelData(Math.min(channel, item.numberOfChannels - 1));
        result.getChannelData(channel).set(source, offset);
      }
      offset += item.length;
    });
    return result;
  }

  function splitBuffer(buffer, at) {
    var point = clamp(Number(at) || 0, 0.001, Math.max(0.001, buffer.duration - 0.001));
    return [sliceBuffer(buffer, 0, point), sliceBuffer(buffer, point, buffer.duration)];
  }

  function gainBuffer(buffer, gain) {
    var amount = Number(gain);
    if (!isFinite(amount)) amount = 1;
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      for (var i = 0; i < input.length; i++) output[i] = clamp(input[i] * amount, -1, 1);
    }
    return result;
  }

  function reverseBuffer(buffer) {
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      for (var i = 0; i < input.length; i++) output[i] = input[input.length - 1 - i];
    }
    return result;
  }

  function fadeBuffer(buffer, fadeInSeconds, fadeOutSeconds) {
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
    var rate = buffer.sampleRate;
    var frames = buffer.length;
    var fadeIn = Math.max(0, Number(fadeInSeconds) || 0) * rate;
    var fadeOut = Math.max(0, Number(fadeOutSeconds) || 0) * rate;
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      for (var i = 0; i < frames; i++) {
        var envelope = 1;
        if (fadeIn > 0 && i < fadeIn) envelope *= i / fadeIn;
        if (fadeOut > 0 && i > frames - fadeOut) envelope *= Math.max(0, (frames - i) / fadeOut);
        output[i] = clamp(input[i] * envelope, -1, 1);
      }
    }
    return result;
  }

  function audioMetrics(buffer) {
    var peak = 0;
    var sum = 0;
    var count = 0;
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var data = buffer.getChannelData(channel);
      for (var i = 0; i < data.length; i++) {
        var value = Math.abs(data[i]);
        if (value > peak) peak = value;
        sum += data[i] * data[i];
        count++;
      }
    }
    var rms = Math.sqrt(sum / Math.max(1, count));
    return {
      peak: peak,
      rms: rms,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
      duration: buffer.duration || buffer.length / buffer.sampleRate,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate
    };
  }

  function normaliseBuffer(buffer, targetPeak) {
    var metrics = audioMetrics(buffer);
    var target = clamp(Number(targetPeak) || 0.95, 0.01, 1);
    var factor = metrics.peak > 0 ? Math.min(12, target / metrics.peak) : 1;
    return gainBuffer(buffer, factor);
  }

  function compressorBuffer(buffer, options) {
    var opts = options || {};
    var threshold = clamp(Number(opts.threshold) || -18, -60, 0);
    var ratio = clamp(Number(opts.ratio) || 3, 1, 20);
    var knee = clamp(Number(opts.knee) || 6, 0, 24);
    var attack = clamp(Number(opts.attack) || 5, 0, 200) / 1000;
    var release = clamp(Number(opts.release) || 120, 0, 1000) / 1000;
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
    var rate = buffer.sampleRate;
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      var envelope = -60;
      for (var i = 0; i < input.length; i++) {
        var level = 20 * Math.log10(Math.abs(input[i]) + 1e-8);
        var coefficient = level > envelope
          ? Math.exp(-1 / Math.max(1, attack * rate))
          : Math.exp(-1 / Math.max(1, release * rate));
        envelope = level + (envelope - level) * coefficient;
        var over = envelope - threshold;
        var reduction = 0;
        if (over > knee / 2) reduction = over * (1 - 1 / ratio);
        else if (over > -knee / 2) reduction = (over + knee / 2) * (over + knee / 2) / (2 * knee) * (1 - 1 / ratio);
        output[i] = clamp(input[i] * Math.pow(10, -reduction / 20), -1, 1);
      }
    }
    return result;
  }

  function limiterBuffer(buffer, ceiling) {
    var limit = clamp(Number(ceiling) || 0.97, 0.1, 1);
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      for (var i = 0; i < input.length; i++) output[i] = clamp(Math.tanh(input[i] / limit) * limit, -1, 1);
    }
    return result;
  }

  function onePole(input, output, cutoff, rate, highpass) {
    var alpha = 1 / (1 + 2 * Math.PI * cutoff / Math.max(1, rate));
    var previous = 0;
    var low = highpass ? input[0] : 0;
    for (var i = 0; i < input.length; i++) {
      low = alpha * input[i] + (1 - alpha) * low;
      output[i] = highpass ? input[i] - low : low;
      previous = low;
    }
    return previous;
  }

  function toneBuffer(buffer, options) {
    var opts = options || {};
    var bass = clamp(Number(opts.bass) || 0, -100, 100) / 100;
    var treble = clamp(Number(opts.treble) || 0, -100, 100) / 100;
    var presence = clamp(Number(opts.presence) || 0, -100, 100) / 100;
    if (!bass && !treble && !presence) return buffer;
    var rate = buffer.sampleRate;
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, rate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      var low = new Float32Array(input.length);
      var high = new Float32Array(input.length);
      var midLow = new Float32Array(input.length);
      var midHigh = new Float32Array(input.length);
      onePole(input, low, 220, rate, false);
      onePole(input, high, 3500, rate, true);
      onePole(input, midLow, 900, rate, false);
      onePole(input, midHigh, 4000, rate, false);
      for (var i = 0; i < input.length; i++) {
        var band = midHigh[i] - midLow[i];
        output[i] = clamp(input[i] + low[i] * bass * 0.65 + high[i] * treble * 0.9 + band * presence * 0.8, -1, 1);
      }
    }
    return result;
  }

  /* Pitch and speed change together by honest linear resampling. This is the
   * classic tape-speed effect: it does not preserve formants or duration. */
  function resampleSpeed(buffer, options) {
    var opts = options || {};
    var speed = clamp(Number(opts.speed) || 1, 0.25, 4);
    var semitones = clamp(Number(opts.pitch) || 0, -24, 24);
    var factor = speed * Math.pow(2, semitones / 12);
    if (Math.abs(factor - 1) < 0.001) return buffer;
    var frames = Math.max(1, Math.round(buffer.length / factor));
    var result = makeAudioBuffer(frames, buffer.numberOfChannels, buffer.sampleRate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var output = result.getChannelData(channel);
      for (var i = 0; i < frames; i++) {
        var position = i * factor;
        var first = Math.floor(position);
        var fraction = position - first;
        var a = first < input.length ? input[first] : 0;
        var b = first + 1 < input.length ? input[first + 1] : a;
        output[i] = clamp(a + (b - a) * fraction, -1, 1);
      }
    }
    return result;
  }

  function removeRanges(buffer, ranges) {
    var list = (ranges || []).filter(function (range) { return range && range.end > range.start; })
      .sort(function (a, b) { return a.start - b.start; });
    if (!list.length) return buffer;
    var rate = buffer.sampleRate;
    var keep = [];
    var cursor = 0;
    list.forEach(function (range) {
      var from = clamp(Math.floor(range.start * rate), cursor, buffer.length);
      var to = clamp(Math.ceil(range.end * rate), from, buffer.length);
      if (from > cursor) keep.push([cursor, from]);
      cursor = Math.max(cursor, to);
    });
    if (cursor < buffer.length) keep.push([cursor, buffer.length]);
    var frames = keep.reduce(function (total, pair) { return total + pair[1] - pair[0]; }, 0);
    var result = makeAudioBuffer(Math.max(1, frames), buffer.numberOfChannels, rate);
    var offset = 0;
    keep.forEach(function (pair) {
      for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
        result.getChannelData(channel).set(buffer.getChannelData(channel).subarray(pair[0], pair[1]), offset);
      }
      offset += pair[1] - pair[0];
    });
    return result;
  }

  function detectSilence(buffer, options) {
    var opts = options || {};
    var threshold = clamp(Number(opts.threshold) || -42, -80, -6);
    var minimum = clamp(Number(opts.minDuration) || 0.3, 0.05, 10);
    var window = Math.max(1, Math.round(buffer.sampleRate * 0.02));
    var series = [];
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var data = buffer.getChannelData(channel);
      for (var i = 0; i < data.length; i += window) {
        var sum = 0;
        var end = Math.min(data.length, i + window);
        for (var j = i; j < end; j++) sum += data[j] * data[j];
        var rms = Math.sqrt(sum / Math.max(1, end - i));
        var index = Math.floor(i / window);
        series[index] = Math.max(series[index] === undefined ? 0 : series[index], rms);
      }
    }
    var ranges = [];
    var start = -1;
    for (var k = 0; k <= series.length; k++) {
      var quiet = k < series.length && series[k] !== undefined ? 20 * Math.log10(Math.max(series[k], 1e-9)) < threshold : false;
      if (quiet && start < 0) start = k;
      if (!quiet && start >= 0) {
        var from = start * 0.02;
        var to = k * 0.02;
        if (to - from >= minimum) ranges.push({ start: from, end: to, duration: to - from, kind: 'silence' });
        start = -1;
      }
    }
    return ranges;
  }

  function detectRepeats(buffer, options) {
    var opts = options || {};
    var minimum = clamp(Number(opts.minDuration) || 0.6, 0.2, 20);
    var tolerance = clamp(Number(opts.tolerance) || 0.12, 0.01, 0.6);
    var step = 0.1;
    var rate = buffer.sampleRate;
    var frames = Math.max(1, Math.round(step * rate));
    var count = Math.floor(buffer.length / frames);
    var signatures = [];
    var data = buffer.getChannelData(0);
    for (var i = 0; i < count; i++) {
      var sum = 0;
      var crossings = 0;
      var previous = data[i * frames] || 0;
      for (var j = i * frames; j < Math.min(data.length, (i + 1) * frames); j++) {
        sum += data[j] * data[j];
        if ((data[j] >= 0) !== (previous >= 0)) crossings++;
        previous = data[j];
      }
      var rms = Math.sqrt(sum / frames);
      signatures.push({ rms: rms, crossing: crossings / frames });
    }
    function similar(a, b) {
      var level = Math.max(0.005, (a.rms + b.rms) / 2);
      return Math.abs(a.rms - b.rms) / level <= tolerance && Math.abs(a.crossing - b.crossing) <= tolerance;
    }
    var ranges = [];
    var runStart = -1;
    for (var k = 1; k <= signatures.length; k++) {
      var match = k < signatures.length && similar(signatures[k - 1], signatures[k]);
      if (match && runStart < 0) runStart = k - 1;
      if (!match && runStart >= 0) {
        var from = runStart * step;
        var to = k * step;
        if (to - from >= minimum && signatures[runStart].rms > 0.001) {
          ranges.push({ start: from, end: to, duration: to - from, kind: 'repeat' });
        }
        runStart = -1;
      }
    }
    return ranges;
  }

  function notchChannel(input, frequency, rate, resonance) {
    var output = new Float32Array(input.length);
    var omega = 2 * Math.PI * clamp(frequency, 1, rate / 2 - 1) / rate;
    var r = clamp(resonance || 0.92, 0.7, 0.99);
    var coefficient = 2 * Math.cos(omega) * r;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < input.length; i++) {
      var x = input[i];
      var y = x - coefficient * x1 + r * r * x2 + coefficient * r * y1 - r * r * y2;
      output[i] = y;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
    }
    return output;
  }

  var NOISE_PROFILES = {
    hiss: { highpass: 180, lowpass: 9000, notch: 0, gate: 0.35 },
    fan: { highpass: 90, lowpass: 6000, notch: 120, gate: 0.25 },
    hum: { highpass: 40, lowpass: 12000, notch: 50, harmonic: 100, gate: 0.12 },
    static: { highpass: 120, lowpass: 5200, notch: 0, gate: 0.45 },
    traffic: { highpass: 220, lowpass: 9000, notch: 0, gate: 0.3 },
    voice: { highpass: 85, lowpass: 11000, notch: 0, gate: 0.18, presence: 0.35 }
  };

  function noiseReduceBuffer(buffer, options) {
    var opts = options || {};
    var profile = NOISE_PROFILES[opts.profile] || NOISE_PROFILES.hiss;
    var strength = clamp(Number(opts.strength) || 0, 0, 100) / 100;
    if (!strength) return buffer;
    var rate = buffer.sampleRate;
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, rate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var low = new Float32Array(input.length);
      var band = new Float32Array(input.length);
      var filtered = new Float32Array(input.length);
      onePole(input, low, profile.highpass, rate, false);
      for (var i = 0; i < input.length; i++) band[i] = input[i] - low[i];
      onePole(band, filtered, profile.lowpass, rate, false);
      if (profile.notch) filtered = notchChannel(filtered, profile.notch, rate, 0.94);
      if (profile.harmonic) filtered = notchChannel(filtered, profile.harmonic, rate, 0.9);
      var gate = new Float32Array(input.length);
      var window = Math.max(1, Math.round(rate * 0.02));
      var floor = Infinity;
      var energies = [];
      for (var start = 0; start < input.length; start += window) {
        var sum = 0;
        var end = Math.min(input.length, start + window);
        for (var j = start; j < end; j++) sum += input[j] * input[j];
        var rms = Math.sqrt(sum / Math.max(1, end - start));
        energies.push(rms);
        if (rms > 0 && rms < floor) floor = rms;
      }
      if (!isFinite(floor)) floor = 0.0001;
      var threshold = floor * (1 + profile.gate * strength * 6);
      for (var w = 0; w < energies.length; w++) {
        var attenuation = energies[w] < threshold ? Math.max(0.08, energies[w] / threshold) : 1;
        var fill = Math.min(window, input.length - w * window);
        for (var k = 0; k < fill; k++) gate[w * window + k] = attenuation;
      }
      var output = result.getChannelData(channel);
      for (var n = 0; n < input.length; n++) {
        var shaped = filtered[n] * gate[n] * (profile.presence ? 1 + profile.presence * strength : 1);
        output[n] = clamp(input[n] + (shaped - input[n]) * strength, -1, 1);
      }
    }
    return result;
  }

  function voiceEffectBuffer(buffer, effect, options) {
    var opts = options || {};
    var kind = String(effect || 'none');
    if (kind === 'none') return buffer;
    if (kind === 'pitch-up') return resampleSpeed(buffer, { pitch: clamp(Number(opts.semitones) || 5, 1, 12) });
    if (kind === 'pitch-down') return resampleSpeed(buffer, { pitch: -clamp(Number(opts.semitones) || 5, 1, 12) });
    if (kind === 'formant-bright') return toneBuffer(compressorBuffer(buffer, {}), { treble: 55, presence: 40 });
    if (kind === 'formant-dark') return toneBuffer(buffer, { bass: 40, treble: -45, presence: -20 });
    var rate = buffer.sampleRate;
    var lowCut = kind === 'telephone' ? 300 : 180;
    var highCut = kind === 'telephone' ? 3400 : 5000;
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, rate);
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var input = buffer.getChannelData(channel);
      var low = new Float32Array(input.length);
      var high = new Float32Array(input.length);
      onePole(input, low, highCut, rate, false);
      onePole(input, high, lowCut, rate, true);
      var band = new Float32Array(input.length);
      onePole(high, band, highCut, rate, false);
      var output = result.getChannelData(channel);
      for (var i = 0; i < input.length; i++) output[i] = clamp(band[i], -1, 1);
    }
    return compressorBuffer(result, { threshold: -20, ratio: 3 });
  }

  function stereoBuffer(buffer, options) {
    var opts = options || {};
    var balance = clamp(Number(opts.balance) || 0, -100, 100) / 100;
    if (opts.mono && buffer.numberOfChannels > 1) {
      var mono = makeAudioBuffer(buffer.length, 1, buffer.sampleRate);
      var output = mono.getChannelData(0);
      for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
        var data = buffer.getChannelData(channel);
        for (var i = 0; i < data.length; i++) output[i] += data[i] / buffer.numberOfChannels;
      }
      return mono;
    }
    if (!balance || buffer.numberOfChannels < 2) return buffer;
    var result = makeAudioBuffer(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      var gain = c === 0 ? clamp(1 - balance, 0, 2) : clamp(1 + balance, 0, 2);
      var source = buffer.getChannelData(c);
      var target = result.getChannelData(c);
      for (var j = 0; j < source.length; j++) target[j] = clamp(source[j] * gain, -1, 1);
    }
    return result;
  }

  function mixAudio(base, tracks) {
    var list = (tracks || []).filter(function (item) { return item && item.buffer; });
    if (!list.length) return base;
    var rate = base.sampleRate;
    var channels = base.numberOfChannels;
    var result = makeAudioBuffer(base.length, channels, rate);
    for (var channel = 0; channel < channels; channel++) {
      var output = result.getChannelData(channel);
      output.set(base.getChannelData(Math.min(channel, base.numberOfChannels - 1)));
      list.forEach(function (item) {
        var source = item.buffer.getChannelData(Math.min(channel, item.buffer.numberOfChannels - 1));
        var offset = Math.max(0, Math.round((Number(item.start) || 0) * rate));
        var amount = clamp(Number(item.gain) || 0, 0, 2);
        for (var i = 0; i < source.length && offset + i < output.length; i++) {
          output[offset + i] = clamp(output[offset + i] + source[i] * amount, -1, 1);
        }
      });
    }
    return result;
  }

  function samplePeaks(buffer, columns, startFraction, endFraction) {
    var count = clamp(Math.floor(Number(columns) || 640), 1, 4096);
    var from = clamp(Number(startFraction) || 0, 0, 0.999);
    var to = clamp(Number(endFraction) || 1, from + 0.001, 1);
    var result = [];
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var data = buffer.getChannelData(channel);
      for (var column = 0; column < count; column++) {
        var fromFrame = Math.floor((from + (to - from) * column / count) * data.length);
        var toFrame = Math.max(fromFrame + 1, Math.floor((from + (to - from) * (column + 1) / count) * data.length));
        var min = 1, max = -1, sum = 0, n = 0;
        for (var i = fromFrame; i < Math.min(data.length, toFrame); i++) {
          var value = data[i];
          if (value < min) min = value;
          if (value > max) max = value;
          sum += value * value;
          n++;
        }
        var peak = result[column] || { min: 0, max: 0, rms: 0 };
        peak.min = Math.min(peak.min, min);
        peak.max = Math.max(peak.max, max);
        peak.rms = Math.max(peak.rms, Math.sqrt(sum / Math.max(1, n)));
        result[column] = peak;
      }
    }
    return result;
  }

  function editAudio(buffer, options) {
    var opts = options || {};
    var start = clamp(Number(opts.start) || 0, 0, buffer.duration);
    var end = clamp(Number(opts.end) || buffer.duration, start + 0.001, buffer.duration);
    var result = sliceBuffer(buffer, start, end);
    var gain = Number(opts.gain) / 100;
    if (isFinite(gain) && gain !== 1) result = gainBuffer(result, gain);
    if (opts.reverse) result = reverseBuffer(result);
    var fadeIn = Math.max(0, Number(opts.fadeIn) || 0) / 1000;
    var fadeOut = Math.max(0, Number(opts.fadeOut) || 0) / 1000;
    if (fadeIn || fadeOut) result = fadeBuffer(result, fadeIn, fadeOut);
    if (opts.normalize) result = normaliseBuffer(result, opts.normalizeTarget || 0.95);
    if (opts.compress) result = compressorBuffer(result, opts.compressor || {});
    result = toneBuffer(result, opts);
    if (opts.noiseReduction) result = noiseReduceBuffer(result, opts.noiseReduction);
    if (opts.voiceEnhance) {
      result = toneBuffer(result, { bass: -20, treble: 25, presence: 45 });
      result = compressorBuffer(result, { threshold: -22, ratio: 3, attack: 8, release: 160 });
      result = normaliseBuffer(result, 0.94);
    }
    if (opts.voiceEffect && opts.voiceEffect !== 'none') result = voiceEffectBuffer(result, opts.voiceEffect, opts);
    if (Number(opts.speed) || Number(opts.pitch)) result = resampleSpeed(result, opts);
    var ranges = [];
    if (opts.removeSilence) ranges = ranges.concat(detectSilence(result, opts.silence || {}));
    if (opts.removeRepeats) ranges = ranges.concat(detectRepeats(result, opts.repeats || {}));
    if (ranges.length) result = removeRanges(result, ranges);
    if (opts.limiter) result = limiterBuffer(result, opts.ceiling || 0.97);
    result = stereoBuffer(result, opts);
    if (opts.music && opts.music.length) result = mixAudio(result, opts.music);
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
    var mb = codec === 'mp3' ? await registerMp3() : await mediabunny();
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
          outputCategoryMask: true,
          outputConfidenceMasks: true,
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

  function segmentationMaskFromResult(result, width, height) {
    var length = width * height;
    var masks = result && result.confidenceMasks;
    if (masks && masks.length) {
      /* MediaPipe orders confidence masks by category; selfie_segmenter has
       * background at index 0 and person at index 1, so prefer the last one. */
      var mask = masks[masks.length - 1];
      if (mask && typeof mask.getAsFloat32Array === 'function') {
        var values = mask.getAsFloat32Array();
        if (values && values.length >= length) {
          var bytes = new Uint8Array(length);
          for (var i = 0; i < length; i++) {
            var value = Number(values[i]);
            bytes[i] = isFinite(value) ? Math.max(0, Math.min(255, Math.round(value * 255))) : 0;
          }
          return bytes;
        }
      }
    }
    if (result && result.categoryMask && typeof result.categoryMask.getAsUint8Array === 'function') {
      return result.categoryMask.getAsUint8Array();
    }
    return null;
  }

  function maskFromCategories(maskData, width, height, threshold, feather) {
    var source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    var sourceContext = source.getContext('2d');
    var image = sourceContext.createImageData(width, height);
    var length = width * height;
    var usable = !!(maskData && maskData.length >= length);
    var categoryMode = usable;
    for (var j = 0; usable && categoryMode && j < length; j++) {
      if (Number(maskData[j]) > 1) categoryMode = false;
    }
    var cutoff = Math.max(0, Math.min(255, Number(threshold) || 70));
    for (var i = 0; i < length; i++) {
      var raw = usable ? Number(maskData[i]) : 0;
      /* Category masks use 0 for background and 1 for person; confidence
       * masks use 0-255. Detect the format instead of assuming one scale. */
      var person = usable && (categoryMode ? raw === 1 : raw >= cutoff);
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
        var maskData = segmentationMaskFromResult(result, width, height);
        if (!maskData || maskData.length < width * height) {
          throw new Error('The segmentation model returned no usable mask.');
        }
        var mask = maskFromCategories(maskData, width, height, opts.threshold || 70, opts.feather || 0);
        if (result.confidenceMasks) result.confidenceMasks.forEach(function (entry) {
          if (entry && typeof entry.close === 'function') entry.close();
        });
        if (result.categoryMask && typeof result.categoryMask.close === 'function') result.categoryMask.close();
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
      if (opts.signal && opts.signal.aborted) { reject(V.abortError()); return; }
      if (asrWorker) { reject(new Error('A transcription is already running.')); return; }
      var worker = new Worker(new URL('video-asr-worker.js', BASE), { type: 'module' });
      asrWorker = worker;
      var transfer = new Float32Array(samples);
      var onAbort = function () { cleanup(); reject(V.abortError()); };
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
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        worker.terminate();
        if (asrWorker === worker) asrWorker = null;
        asrCallbacks = null;
      }
      asrCallbacks = { cleanup: cleanup, reject: reject };
      if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
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

  /* ---------- Short-form layout helpers ---------- */

  var LAYOUTS = {
    '9:16': { width: 720, height: 1280, label: '9:16 vertical (720×1280)' },
    '1:1': { width: 1080, height: 1080, label: '1:1 square (1080×1080)' },
    '4:5': { width: 864, height: 1080, label: '4:5 portrait (864×1080)' },
    '16:9': { width: 1280, height: 720, label: '16:9 landscape (1280×720)' },
    'face': { width: 720, height: 1280, label: '9:16 subject-centred crop' },
    'speaker': { width: 720, height: 1280, label: '9:16 motion/audio-balance crop' },
    'split': { width: 1080, height: 1080, label: '1:1 split view (same source)' },
    'presenter': { width: 1080, height: 1080, label: '1:1 presenter + inset (same source)' },
    'blur': { width: 720, height: 1280, label: '9:16 blurred fill (contain)' }
  };

  function layoutDimensions(layout) {
    return LAYOUTS[layout] || LAYOUTS['9:16'];
  }

  function cropRect(sourceWidth, sourceHeight, targetWidth, targetHeight, focusX, focusY, zoom) {
    var sw = Math.max(1, Number(sourceWidth) || targetWidth);
    var sh = Math.max(1, Number(sourceHeight) || targetHeight);
    var tw = Math.max(1, Number(targetWidth) || 720);
    var th = Math.max(1, Number(targetHeight) || 1280);
    var targetRatio = tw / th;
    var sourceRatio = sw / sh;
    var cropWidth = sourceRatio > targetRatio ? sh * targetRatio : sw;
    var cropHeight = sourceRatio > targetRatio ? sh : sw / targetRatio;
    var scale = clamp(Number(zoom) || 1, 1, 3);
    cropWidth = Math.min(sw, cropWidth / scale);
    cropHeight = Math.min(sh, cropHeight / scale);
    var x = clamp(Number(focusX) || 0, 0, 1) * (sw - cropWidth);
    var y = clamp(Number(focusY) || 0, 0, 1) * (sh - cropHeight);
    return { x: x, y: y, width: cropWidth, height: cropHeight };
  }

  function audioFocus(buffer, start, end) {
    if (!buffer || buffer.numberOfChannels < 2) return 0.5;
    var first = Math.max(0, Math.floor((Number(start) || 0) * buffer.sampleRate));
    var last = Math.min(buffer.length, Math.ceil((Number(end) || buffer.duration) * buffer.sampleRate));
    var left = 0, right = 0, count = 0;
    var a = buffer.getChannelData(0);
    var b = buffer.getChannelData(1);
    for (var i = first; i < last; i += 16) {
      left += a[i] * a[i];
      right += b[i] * b[i];
      count++;
    }
    if (!count || left + right < 1e-8) return 0.5;
    return clamp(left / (left + right), 0, 1);
  }

  var faceDetectorPromise = null;

  async function faceDetector(signal) {
    checkSignal(signal);
    if (!faceDetectorPromise) {
      faceDetectorPromise = (async function () {
        var mod = await importModule('vendor/mediapipe/vision_bundle.mjs');
        var wasmUrl = new URL('vendor/mediapipe/wasm/', BASE).href;
        var fileset = await mod.FilesetResolver.forVisionTasks(wasmUrl);
        var detector = await mod.FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
            delegate: 'CPU'
          },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5
        });
        return { mod: mod, detector: detector };
      })().catch(function (error) { faceDetectorPromise = null; throw error; });
    }
    return faceDetectorPromise;
  }

  function closeFaceDetector() {
    if (faceDetectorPromise) {
      faceDetectorPromise.then(function (engine) {
        if (engine && engine.detector && typeof engine.detector.close === 'function') engine.detector.close();
      }).catch(function () { /* nothing to close */ });
      faceDetectorPromise = null;
    }
  }

  async function faceCentre(canvas, signal) {
    var engine = await faceDetector(signal);
    checkSignal(signal);
    var result = engine.detector.detect(canvas);
    var detections = (result && result.detections) || [];
    if (!detections.length) return null;
    var detection = detections[0];
    var score = detection.categories && detection.categories[0] ? detection.categories[0].score : 0;
    /* MediaPipe returns normalised facial keypoints; the nose tip is a steadier
     * crop anchor than the centre of a padded bounding box. */
    var keypoints = detection.keypoints || [];
    var nose = keypoints[2] || keypoints[0];
    if (nose && isFinite(Number(nose.x)) && isFinite(Number(nose.y))) {
      return { x: clamp(Number(nose.x), 0, 1), y: clamp(Number(nose.y), 0, 1), confidence: score };
    }
    var box = detection.boundingBox || detection.relativeBoundingBox || {};
    var width = Math.max(1, Number(canvas.width) || 1);
    var height = Math.max(1, Number(canvas.height) || 1);
    var x = Number(box.xCenter);
    var y = Number(box.yCenter);
    if (!isFinite(x) || !isFinite(y)) {
      var left = Number(box.originX !== undefined ? box.originX : box.x !== undefined ? box.x : box.left);
      var top = Number(box.originY !== undefined ? box.originY : box.y !== undefined ? box.y : box.top);
      x = (left || 0) + (Number(box.width) || 0) / 2;
      y = (top || 0) + (Number(box.height) || 0) / 2;
      if (x > 1 || y > 1) { x /= width; y /= height; }
    }
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), confidence: score };
  }

  function renderLayout(sample, options) {
    var opts = options || {};
    var target = layoutDimensions(opts.layout);
    var canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    var context = canvas.getContext('2d');
    var sw = sample.displayWidth || sample.width || 1280;
    var sh = sample.displayHeight || sample.height || 720;
    var focusX = clamp(Number(opts.focusX) || 0, 0, 1);
    var focusY = clamp(Number(opts.focusY) || 0, 0, 1);
    var zoom = clamp(Number(opts.zoom) || 1, 1, 3);
    function drawCrop(sx, sy, sw2, sh2, dx, dy, dw, dh) {
      sample.draw(context, sx, sy, sw2, sh2, dx, dy, dw, dh);
    }
    if (opts.layout === 'split' || opts.layout === 'presenter') {
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      var leftRect = cropRect(sw, sh, canvas.width / 2, canvas.height, 0.12, focusY, zoom);
      var rightRect = cropRect(sw, sh, canvas.width / 2, canvas.height, 0.88, focusY, zoom);
      if (opts.layout === 'split') {
        drawCrop(leftRect.x, leftRect.y, leftRect.width, leftRect.height, 0, 0, canvas.width / 2, canvas.height);
        drawCrop(rightRect.x, rightRect.y, rightRect.width, rightRect.height, canvas.width / 2, 0, canvas.width / 2, canvas.height);
      } else {
        var main = cropRect(sw, sh, canvas.width, canvas.height, focusX, focusY, zoom);
        drawCrop(main.x, main.y, main.width, main.height, 0, 0, canvas.width, canvas.height);
        var insetWidth = Math.round(canvas.width * 0.3);
        var insetHeight = Math.round(canvas.height * 0.3);
        drawCrop(rightRect.x, rightRect.y, rightRect.width, rightRect.height,
          canvas.width - insetWidth - 24, canvas.height - insetHeight - 24, insetWidth, insetHeight);
        context.strokeStyle = '#ffffff';
        context.lineWidth = 6;
        context.strokeRect(canvas.width - insetWidth - 24, canvas.height - insetHeight - 24, insetWidth, insetHeight);
      }
      return canvas;
    }
    if (opts.layout === 'blur') {
      context.save();
      context.filter = 'blur(26px) brightness(0.72)';
      var background = cropRect(sw, sh, canvas.width, canvas.height, focusX, focusY, 0.6);
      drawCrop(background.x, background.y, background.width, background.height, -40, -40, canvas.width + 80, canvas.height + 80);
      context.restore();
      var containWidth = canvas.width;
      var containHeight = canvas.width * sh / sw;
      if (containHeight > canvas.height) {
        containHeight = canvas.height;
        containWidth = canvas.height * sw / sh;
      }
      drawCrop(0, 0, sw, sh, (canvas.width - containWidth) / 2, (canvas.height - containHeight) / 2, containWidth, containHeight);
      return canvas;
    }
    var rect = cropRect(sw, sh, canvas.width, canvas.height, focusX, focusY, zoom);
    drawCrop(rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function layoutProcessor(options) {
    var opts = options || {};
    return function (sample) { return renderLayout(sample, opts); };
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
  V.sliceBuffer = sliceBuffer;
  V.concatBuffers = concatBuffers;
  V.splitBuffer = splitBuffer;
  V.gainBuffer = gainBuffer;
  V.reverseBuffer = reverseBuffer;
  V.fadeBuffer = fadeBuffer;
  V.audioMetrics = audioMetrics;
  V.normaliseBuffer = normaliseBuffer;
  V.compressorBuffer = compressorBuffer;
  V.limiterBuffer = limiterBuffer;
  V.toneBuffer = toneBuffer;
  V.resampleSpeed = resampleSpeed;
  V.removeRanges = removeRanges;
  V.detectSilence = detectSilence;
  V.detectRepeats = detectRepeats;
  V.noiseReduceBuffer = noiseReduceBuffer;
  V.voiceEffectBuffer = voiceEffectBuffer;
  V.stereoBuffer = stereoBuffer;
  V.mixAudio = mixAudio;
  V.samplePeaks = samplePeaks;
  V.editAudio = editAudio;
  V.NOISE_PROFILES = NOISE_PROFILES;
  V.writeWav = writeWav;
  V.audioOutput = audioOutput;
  V.convertVideo = convertVideo;
  V.canvasFrames = canvasFrames;
  V.makeGif = makeGif;
  V.personSegmenter = personSegmenter;
  V.closeSegmenter = closeSegmenter;
  V.segmentationMaskFromResult = segmentationMaskFromResult;
  V.maskFromCategories = maskFromCategories;
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
  V.LAYOUTS = LAYOUTS;
  V.layoutDimensions = layoutDimensions;
  V.cropRect = cropRect;
  V.audioFocus = audioFocus;
  V.faceDetector = faceDetector;
  V.closeFaceDetector = closeFaceDetector;
  V.faceCentre = faceCentre;
  V.renderLayout = renderLayout;
  V.layoutProcessor = layoutProcessor;
})(typeof window !== 'undefined' ? window : globalThis);
