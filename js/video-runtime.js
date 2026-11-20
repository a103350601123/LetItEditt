/* LetitEdit Video & Audio runtime. Each generated page loads this one script;
 * behaviour is selected from the registry-provided #tool-config engine. */
(function () {
  'use strict';

  var V = window.VideoCore;
  if (!V) return;
  var $ = V.$;
  var on = V.on;
  var config = null;
  var engine = null;
  var state = {
    file: null,
    info: null,
    audio: null,
    edited: null,
    controller: null,
    downloadBlob: null,
    downloadName: 'download',
    outputUrl: null,
    inputUrl: null,
    bgUrl: null,
    bgImage: null,
    recorder: null,
    recordChunks: [],
    mediaStream: null,
    audioContext: null,
    audioSource: null,
    maskSource: null,
    selection: { x: 10, y: 10, w: 25, h: 15 },
    dragStart: null,
    transcript: [],
    clips: [],
    clipPlan: [],
    clipPreviewUrls: [],
    selectedClip: 0,
    clipsAnalysed: false,
    sourceTimeHandler: null,
    waveZoom: 1,
    waveScroll: 0,
    waveSource: null,
    audioHistory: [],
    audioRedo: [],
    music: [],
    analysis: null
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function value(id) {
    var node = $(id);
    return node ? node.value : '';
  }

  function checked(id) {
    var node = $(id);
    return Boolean(node && node.checked);
  }

  function show(id, visible) {
    var node = $(id);
    if (node) node.hidden = !visible;
  }

  function setLabel(id, text) {
    var node = $(id);
    if (node) node.textContent = text;
  }

  function revoke(kind) {
    if (state[kind]) {
      URL.revokeObjectURL(state[kind]);
      state[kind] = null;
    }
  }

  function resetOutput() {
    revoke('outputUrl');
    state.clipPreviewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    state.clipPreviewUrls = [];
    state.downloadBlob = null;
    var download = $('v-download');
    if (download) download.disabled = true;
    var preview = $('v-preview');
    if (preview) { preview.removeAttribute('src'); preview.load(); show('v-preview', false); }
    var image = $('v-gif');
    if (image) image.removeAttribute('src');
    var audio = $('v-audio');
    if (audio) { audio.removeAttribute('src'); audio.load(); show('v-audio', false); }
    var original = $('v-audio-original');
    if (original) { original.removeAttribute('src'); original.load(); }
    var clips = $('v-clips');
    if (clips) clips.textContent = 'Analyse a video to see real candidate clips here.';
    state.clips = [];
    state.clipPlan = [];
    state.selectedClip = 0;
    var bar = $('v-progress-bar');
    if (bar) bar.style.width = '0%';
  }

  function resetInput() {
    revoke('inputUrl');
    state.file = null;
    state.info = null;
    state.audio = null;
    state.edited = null;
    state.waveSource = null;
    state.audioHistory = [];
    state.audioRedo = [];
    state.music = [];
    state.analysis = null;
    var preview = $('v-preview');
    if (preview) preview.removeAttribute('src');
    V.setEnabled(['v-process', 'v-play', 'v-play-original', 'v-stop', 'v-srt', 'v-vtt', 'v-txt'], false);
    V.status('Choose a file to begin.');
  }

  function showBlob(blob, filename, kind) {
    revoke('outputUrl');
    state.outputUrl = URL.createObjectURL(blob);
    state.downloadBlob = blob;
    state.downloadName = filename;
    var preview = $('v-preview');
    var image = $('v-gif');
    var audio = $('v-audio');
    if (kind === 'gif' && image) {
      image.src = state.outputUrl;
      show('v-gif', true);
      if (preview) show('v-preview', false);
    } else if (kind === 'audio' && audio) {
      audio.src = state.outputUrl;
      show('v-audio', true);
      if (preview) show('v-preview', false);
    } else if (preview) {
      preview.src = state.outputUrl;
      show('v-preview', true);
      if (image) show('v-gif', false);
    }
    var download = $('v-download');
    if (download) download.disabled = false;
    V.status('Ready: ' + filename + ' (' + V.formatBytes(blob.size) + ').');
  }

  function setBusy(busy, actionIds) {
    var ids = actionIds || ['v-process'];
    V.setEnabled(ids, !busy);
    V.setEnabled('v-cancel', busy);
  }

  function cancel() {
    if (state.controller) { state.controller.abort(); state.controller = null; }
    if (typeof V.stopTranscription === 'function') V.stopTranscription();
    if (engine === 'screen-recorder') stopRecording();
    V.status('Cancelled.');
  }

  function controller() {
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    /* Engines expect an AbortSignal; cancellation still goes through the
     * controller that we keep in state.controller. */
    return state.controller.signal;
  }

  function progress(fraction, label) {
    var amount = V.clamp(fraction || 0, 0, 1);
    var bar = $('v-progress-bar');
    if (bar) bar.style.width = Math.round(amount * 100) + '%';
    var track = $('v-progress');
    if (track) show('v-progress', true);
    V.status(label + ' ' + Math.round(amount * 100) + '%.');
  }

  function stage(label, fraction) {
    var bar = $('v-progress-bar');
    if (bar) bar.style.width = Math.round(V.clamp(fraction || 0, 0, 1) * 100) + '%';
    var track = $('v-progress');
    if (track) show('v-progress', true);
    V.status(label);
  }

  function finishProgress() {
    var track = $('v-progress');
    if (track) show('v-progress', false);
  }

  function onFileChange(handler) {
    var input = $('v-file');
    on(input, 'change', async function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      resetOutput();
      state.file = file;
      try {
        V.validateFile(file);
        V.status('Reading ' + file.name + '…');
        await handler(file);
      } catch (error) {
        V.status(V.friendlyError(error), true);
        setBusy(false);
      }
    });
  }

  function bindCommon() {
    on($('v-download'), 'click', function () {
      if (state.downloadBlob) V.download(state.downloadBlob, state.downloadName);
    });
    on($('v-cancel'), 'click', cancel);
    on(window, 'pagehide', function () {
      if (state.controller) state.controller.abort();
      if (state.audioSource) { try { state.audioSource.stop(); } catch (error) { /* ended */ } }
      if (state.audioContext) state.audioContext.close();
      if (state.mediaStream) state.mediaStream.getTracks().forEach(function (track) { track.stop(); });
      if (typeof V.stopTranscription === 'function') V.stopTranscription();
      if (typeof V.closeSegmenter === 'function') V.closeSegmenter();
      if (typeof V.closeFaceDetector === 'function') V.closeFaceDetector();
      state.clipPreviewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      state.clipPreviewUrls = [];
      revoke('outputUrl');
      revoke('inputUrl');
      revoke('bgUrl');
    });
  }

  /* ---------- Shared source preview ---------- */

  function showSourceVideo(file, info) {
    var video = $('v-source-video');
    if (!video) return;
    revoke('inputUrl');
    state.inputUrl = URL.createObjectURL(file);
    video.src = state.inputUrl;
    video.controls = true;
    video.muted = false;
    show('v-source-video', true);
    show('v-source-info', true);
    setLabel('v-source-name', file.name);
    setLabel('v-source-details', V.formatBytes(file.size) + ' · ' +
      ((info.width && info.height) ? info.width + '×' + info.height + ' · ' : '') +
      V.formatTime(info.duration) + (info.fps ? ' · ' + Math.round(info.fps) + ' fps' : ''));
    if (state.sourceTimeHandler) video.removeEventListener('timeupdate', state.sourceTimeHandler);
    var update = function () {
      setLabel('v-source-time', V.formatTime(video.currentTime || 0) + ' / ' + V.formatTime(info.duration));
    };
    on(video, 'timeupdate', update);
    state.sourceTimeHandler = update;
    update();
    video.load();
  }

  function clearSourceVideo() {
    var video = $('v-source-video');
    if (video) {
      video.pause();
      if (state.sourceTimeHandler) video.removeEventListener('timeupdate', state.sourceTimeHandler);
      video.removeAttribute('src');
      video.load();
      show('v-source-video', false);
    }
    state.sourceTimeHandler = null;
    show('v-source-info', false);
    revoke('inputUrl');
  }

  /* ---------- Audio editor ---------- */

  function audioOptions() {
    if (!state.audio) return {};
    return {
      start: Number(value('v-start')) / 1000 * state.audio.duration,
      end: Number(value('v-end')) / 1000 * state.audio.duration,
      gain: Number(value('v-gain')),
      fadeIn: Number(value('v-fade-in')),
      fadeOut: Number(value('v-fade-out')),
      reverse: checked('v-reverse'),
      normalize: checked('v-normalize'),
      normalizeTarget: Number(value('v-loudness')) / 100,
      compress: checked('v-compress'),
      compressor: { threshold: Number(value('v-threshold')), ratio: Number(value('v-ratio')), knee: 6, attack: 5, release: 120 },
      limiter: checked('v-limiter'),
      ceiling: 0.97,
      bass: Number(value('v-bass')),
      treble: Number(value('v-treble')),
      presence: Number(value('v-presence')),
      voiceEffect: value('v-voice-effect'),
      pitch: Number(value('v-pitch')),
      speed: Number(value('v-speed')) / 100,
      noiseReduction: checked('v-noise-reduction')
        ? { profile: value('v-noise-profile'), strength: Number(value('v-noise-strength')) }
        : null,
      removeSilence: checked('v-remove-silence'),
      silence: { threshold: Number(value('v-silence-threshold')), minDuration: Number(value('v-silence-min')) },
      removeRepeats: checked('v-remove-repeats'),
      repeats: { minDuration: 0.6, tolerance: 0.12 },
      voiceEnhance: checked('v-voice-enhance'),
      mono: checked('v-mono'),
      balance: Number(value('v-balance')),
      music: state.music.filter(function (item) { return item && item.buffer; }).map(function (item) {
        return { buffer: item.buffer, gain: item.gain, start: item.start };
      })
    };
  }

  function waveformWindow() {
    var zoom = V.clamp(Number(state.waveZoom) || 1, 1, 16);
    var scroll = V.clamp(Number(state.waveScroll) || 0, 0, 1000) / 1000;
    var span = 1 / zoom;
    var from = V.clamp(scroll * (1 - span), 0, 1 - span);
    return { from: from, to: from + span };
  }

  function drawWaveform() {
    var canvas = $('v-waveform');
    var source = state.waveSource || state.edited || state.audio;
    if (!canvas || !source) return;
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    var windowRange = waveformWindow();
    var peaks = V.samplePeaks(source, Math.min(width, 900), windowRange.from, windowRange.to);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#eff6ff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#93c5fd';
    peaks.forEach(function (peak, x) {
      var top = height / 2 - Math.max(peak.max, 0) * height / 2.4;
      var bottom = height / 2 - Math.min(peak.min, 0) * height / 2.4;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    });
    if (state.audio) {
      var startMs = Number(value('v-start')) || 0;
      var endMs = Number(value('v-end')) || 1000;
      var sourceDuration = state.audio.duration || 1;
      var startFraction = (startMs / 1000 - windowRange.from) / (windowRange.to - windowRange.from);
      var endFraction = (endMs / 1000 - windowRange.from) / (windowRange.to - windowRange.from);
      var start = V.clamp(startFraction, 0, 1) * width;
      var end = V.clamp(endFraction, 0, 1) * width;
      context.fillStyle = 'rgba(37,99,235,.16)';
      context.fillRect(start, 0, Math.max(1, end - start), height);
      context.strokeStyle = '#2563eb';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(start, 0); context.lineTo(start, height);
      context.moveTo(end, 0); context.lineTo(end, height);
      context.stroke();
      setLabel('v-start-value', V.formatTime(startMs / 1000 * sourceDuration));
      setLabel('v-end-value', V.formatTime(endMs / 1000 * sourceDuration));
    }
  }

  function updateDetected() {
    var label = $('v-detected');
    if (!label || !state.audio) return;
    var options = audioOptions();
    var silence = options.removeSilence ? V.detectSilence(state.audio, options.silence) : [];
    var repeats = options.removeRepeats ? V.detectRepeats(state.audio, options.repeats) : [];
    if (!silence.length && !repeats.length) {
      label.textContent = 'No silence or adjacent repeats selected. Enable detection to measure the decoded samples.';
      return;
    }
    label.textContent = 'Detected: ' + silence.length + ' silent region(s), ' + repeats.length +
      ' adjacent repeated region(s). Play edited to hear the result.';
  }

  function updateMetrics(edited) {
    var label = $('v-metrics');
    if (!label || !state.audio) return;
    var before = V.audioMetrics(state.audio);
    var after = V.audioMetrics(edited || state.audio);
    setLabel('v-source-meta', 'Duration ' + V.formatTime(before.duration) + ' · ' + before.channels +
      ' channel(s) · ' + Math.round(before.sampleRate / 1000) + ' kHz');
    label.textContent = 'Peak ' + before.peak.toFixed(3) + ' → ' + after.peak.toFixed(3) +
      ' · RMS ' + before.rms.toFixed(4) + ' → ' + after.rms.toFixed(4) +
      (edited && edited.duration !== before.duration ? ' · duration ' + V.formatTime(edited.duration) : '');
  }

  function pushAudioHistory(buffer) {
    state.audioHistory.push(buffer);
    if (state.audioHistory.length > 24) state.audioHistory.shift();
    state.audioRedo = [];
  }

  function restoreAudio(buffer, message) {
    state.edited = buffer;
    state.waveSource = buffer;
    updateMetrics(buffer);
    drawWaveform();
    V.setEnabled(['v-undo'], state.audioHistory.length > 1);
    V.setEnabled(['v-redo'], state.audioRedo.length > 0);
    V.status(message);
  }

  function applyEdits(record) {
    if (!state.audio) return null;
    var edited = V.editAudio(state.audio, audioOptions());
    state.edited = edited;
    state.waveSource = edited;
    if (record !== false) pushAudioHistory(edited);
    updateMetrics(edited);
    updateDetected();
    drawWaveform();
    V.setEnabled(['v-undo'], state.audioHistory.length > 1);
    V.setEnabled(['v-redo'], state.audioRedo.length > 0);
    return edited;
  }

  function stopAudio() {
    if (state.audioSource) {
      try { state.audioSource.stop(); } catch (error) { /* already stopped */ }
      state.audioSource = null;
    }
    V.setEnabled(['v-stop'], false);
    V.setEnabled(['v-play'], Boolean(state.audio));
    V.setEnabled(['v-play-original'], Boolean(state.audio));
  }

  function playBuffer(buffer, message) {
    if (!buffer) return;
    stopAudio();
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) { V.status('This browser cannot play decoded audio.', true); return; }
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    state.audioContext.resume();
    var source = state.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.audioContext.destination);
    source.onended = stopAudio;
    source.start();
    state.audioSource = source;
    V.setEnabled(['v-stop'], true);
    V.setEnabled(['v-play'], false);
    V.setEnabled(['v-play-original'], false);
    V.status(message);
  }

  function playEditedAudio() {
    if (!state.audio) return;
    /* Preview playback should not create a second identical history entry;
     * only explicit export applies record a new undo step. */
    var edited = state.edited || applyEdits(false);
    playBuffer(edited, 'Playing processed audio.');
  }

  function rangeLabel(id, suffix) {
    var node = $(id);
    if (!node) return;
    setLabel(id + '-value', node.value + suffix);
  }

  function initAudioEditor() {
    V.setEnabled(['v-play', 'v-play-original', 'v-stop', 'v-undo', 'v-redo', 'v-transcribe',
      'v-srt', 'v-vtt', 'v-txt'], false);
    onFileChange(async function (file) {
      state.audio = await V.decodeAudio(file);
      state.edited = null;
      state.waveSource = state.audio;
      state.audioHistory = [state.audio];
      state.audioRedo = [];
      state.music = [];
      state.waveZoom = 1;
      state.waveScroll = 0;
      $('v-start').value = 0;
      $('v-end').value = 1000;
      setLabel('v-start-value', '0:00.000');
      setLabel('v-end-value', V.formatTime(state.audio.duration));
      updateMetrics(null);
      updateDetected();
      drawWaveform();
      V.setEnabled(['v-process', 'v-play', 'v-play-original', 'v-transcribe'], true);
      V.setEnabled(['v-undo', 'v-redo', 'v-stop'], false);
      V.status('Decoded ' + V.formatTime(state.audio.duration) + ' of audio. Adjust and apply.');
    });
    ['v-start', 'v-end', 'v-gain', 'v-fade-in', 'v-fade-out', 'v-loudness', 'v-threshold', 'v-ratio',
      'v-bass', 'v-treble', 'v-presence', 'v-pitch', 'v-speed', 'v-noise-strength',
      'v-silence-threshold', 'v-silence-min', 'v-balance', 'v-music-gain', 'v-music-gain2',
      'v-music-start', 'v-zoom', 'v-scroll'].forEach(function (id) {
      on($(id), 'input', function () {
        var node = $(id);
        if (id === 'v-start' || id === 'v-end') {
          if (Number(value('v-start')) >= Number(value('v-end'))) {
            if (id === 'v-start') node.value = Math.max(0, Number(value('v-end')) - 1);
            else node.value = Math.min(1000, Number(value('v-start')) + 1);
          }
        } else if (id === 'v-zoom') state.waveZoom = Number(node.value);
        else if (id === 'v-scroll') state.waveScroll = Number(node.value);
        rangeLabel(id, id === 'v-gain' || id === 'v-loudness' || id.indexOf('music') === 0 ? '%' :
          id === 'v-speed' ? '%' : id === 'v-ratio' ? ':1' : id === 'v-pitch' ? ' st' :
            id === 'v-balance' || id.indexOf('bass') !== -1 || id.indexOf('treble') !== -1 ||
            id.indexOf('presence') !== -1 || id.indexOf('strength') !== -1 ? '' :
              id === 'v-threshold' || id === 'v-silence-threshold' ? ' dB' :
                id === 'v-silence-min' || id === 'v-music-start' ? ' s' : ' ms');
        drawWaveform();
        updateDetected();
      });
    });
    var canvas = $('v-waveform');
    var dragging = null;
    function selectionFromPointer(event) {
      if (!canvas || !state.audio) return 0;
      var rect = canvas.getBoundingClientRect();
      var windowRange = waveformWindow();
      var fraction = V.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      return (windowRange.from + fraction * (windowRange.to - windowRange.from)) * 1000;
    }
    on(canvas, 'pointerdown', function (event) {
      var ms = selectionFromPointer(event);
      dragging = Math.abs(ms - Number(value('v-start'))) < Math.abs(ms - Number(value('v-end'))) ? 'start' : 'end';
      $(dragging).value = Math.round(ms);
      canvas.setPointerCapture(event.pointerId);
      drawWaveform();
    });
    on(canvas, 'pointermove', function (event) {
      if (!dragging) return;
      $(dragging).value = Math.round(selectionFromPointer(event));
      if (Number(value('v-start')) >= Number(value('v-end'))) {
        $(dragging).value = dragging === 'start' ? Number(value('v-end')) - 1 : Number(value('v-start')) + 1;
      }
      drawWaveform();
    });
    on(canvas, 'pointerup', function () { dragging = null; });
    [['v-music-file', 0], ['v-music-file2', 1]].forEach(function (pair) {
      on($(pair[0]), 'change', async function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          V.status('Decoding background music locally…');
          var buffer = await V.decodeAudio(file);
          state.music[pair[1]] = {
            buffer: buffer,
            gain: Number(value(pair[1] ? 'v-music-gain2' : 'v-music-gain')) / 100,
            start: Number(value('v-music-start'))
          };
          V.status('Background track ' + (pair[1] + 1) + ' loaded. Adjust its level, then apply edits.');
        } catch (error) { V.status(V.friendlyError(error), true); }
      });
    });
    on($('v-play'), 'click', playEditedAudio);
    on($('v-play-original'), 'click', function () {
      playBuffer(state.audio, 'Playing the original audio.');
    });
    on($('v-stop'), 'click', stopAudio);
    on($('v-undo'), 'click', function () {
      if (state.audioHistory.length < 2) { V.status('Nothing to undo.'); return; }
      state.audioRedo.push(state.edited);
      state.audioHistory.pop();
      restoreAudio(state.audioHistory[state.audioHistory.length - 1], 'Undid the last edit.');
    });
    on($('v-redo'), 'click', function () {
      if (!state.audioRedo.length) { V.status('Nothing to redo.'); return; }
      state.audioHistory.push(state.edited);
      restoreAudio(state.audioRedo.pop(), 'Redid the last edit.');
    });
    on($('v-reset'), 'click', function () {
      var defaults = {
        'v-start': 0, 'v-end': 1000, 'v-gain': 100, 'v-fade-in': 0, 'v-fade-out': 0,
        'v-loudness': 95, 'v-threshold': -18, 'v-ratio': 3, 'v-bass': 0, 'v-treble': 0,
        'v-presence': 0, 'v-pitch': 0, 'v-speed': 100, 'v-noise-strength': 60,
        'v-silence-threshold': -42, 'v-silence-min': 0.3, 'v-balance': 0,
        'v-music-gain': 20, 'v-music-gain2': 0, 'v-music-start': 0, 'v-zoom': 1, 'v-scroll': 0
      };
      Object.keys(defaults).forEach(function (id) { if ($(id)) $(id).value = defaults[id]; });
      ['v-reverse', 'v-normalize', 'v-compress', 'v-limiter', 'v-noise-reduction',
        'v-remove-silence', 'v-remove-repeats', 'v-voice-enhance', 'v-mono'].forEach(function (id) {
        if ($(id)) $(id).checked = false;
      });
      $('v-voice-effect').value = 'none';
      $('v-noise-profile').value = 'hiss';
      state.waveZoom = 1;
      state.waveScroll = 0;
      state.edited = null;
      state.waveSource = state.audio;
      state.music = [];
      state.audioHistory = [state.audio];
      state.audioRedo = [];
      stopAudio();
      resetOutput();
      updateMetrics(null);
      updateDetected();
      drawWaveform();
      V.setEnabled(['v-undo', 'v-redo'], false);
      V.status('Edits reset.');
    });
    on($('v-process'), 'click', async function () {
      if (!state.audio) { V.status('Choose an audio file first.', true); return; }
      var signal = controller();
      setBusy(true, ['v-process', 'v-play', 'v-play-original']);
      try {
        stage('Applying real sample edits…', 0.2);
        var edited = applyEdits(true);
        var format = value('v-format');
        stage('Encoding ' + format.toUpperCase() + '…', 0.7);
        var blob = format === 'wav'
          ? V.writeWav(edited)
          : await V.audioOutput(format === 'mp3' ? 'mp3' : 'm4a', edited);
        if (signal.aborted) throw V.abortError();
        showBlob(blob, 'letitedit-audio.' + (format === 'wav' ? 'wav' : format === 'mp3' ? 'mp3' : 'm4a'), 'audio');
        finishProgress();
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false, ['v-process', 'v-play', 'v-play-original']); }
    });
    on($('v-transcribe'), 'click', async function () {
      if (!checked('v-ai-consent')) { V.status('Opt in to the local Whisper model first.', true); return; }
      if (!state.audio) { V.status('Choose an audio file first.', true); return; }
      var signal = controller();
      setBusy(true, ['v-transcribe', 'v-process']);
      try {
        stage('Decoding audio for recognition…', 0.15);
        var mono = await V.resampleMono(state.audio, 16000);
        V.checkSignal(signal);
        stage('Loading local Whisper tiny model (about 75-80 MB on first use)…', 0.4);
        var result = await V.transcribe(mono.getChannelData(0), {
          language: value('v-language'),
          onProgress: function (message) { V.status(message); }
        });
        var lines = V.chunkLines(result.chunks || []);
        if (!lines.length) throw new Error('No speech was detected in this file.');
        $('v-transcript').value = lines.map(function (line) {
          return V.formatTime(line.start) + ' --> ' + V.formatTime(line.end) + ' | ' + line.text;
        }).join('\n');
        state.transcript = lines;
        V.setEnabled(['v-srt', 'v-vtt', 'v-txt'], true);
        V.status(lines.length + ' timed lines generated. Review and edit them before exporting.');
        finishProgress();
      } catch (error) { V.status(V.friendlyError(error), true); }
      finally { setBusy(false, ['v-transcribe', 'v-process']); }
    });
    ['v-srt', 'v-vtt', 'v-txt'].forEach(function (id) {
      on($(id), 'click', function () {
        var lines = V.parseTimedTranscript(value('v-transcript'));
        if (!lines.length) { V.status('There are no valid timed lines to export.', true); return; }
        var format = id.replace('v-', '');
        V.download(new Blob([V.formatTranscript(lines, format)], { type: 'text/plain;charset=utf-8' }),
          'letitedit-audio-transcript.' + format);
        V.status('Downloaded ' + format.toUpperCase() + ' transcript.');
      });
    });
  }

  /* ---------- Screen recorder ---------- */

  function recordingMime() {
    /* VP8 is the most reliable WebM codec in headless Chromium; VP9 support
     * can be advertised while producing no chunks, so try VP8 first. */
    var options = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8',
      'video/webm;codecs=vp9',
      'video/webm'
    ];
    for (var i = 0; i < options.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(options[i])) return options[i];
    }
    return '';
  }

  function stopRecording() {
    var recorder = state.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(function (track) { track.stop(); });
      state.mediaStream = null;
    }
    var preview = $('v-preview');
    if (preview) preview.srcObject = null;
    V.setEnabled(['v-start'], true);
    V.setEnabled(['v-pause', 'v-stop'], false);
    var pause = $('v-pause');
    if (pause) pause.textContent = 'Pause';
  }

  function initScreenRecorder() {
    show('v-preview', true);
    V.setEnabled(['v-pause', 'v-stop'], false);
    on($('v-start'), 'click', async function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
        V.status('This browser does not expose screen capture. Desktop Chrome or Edge is recommended.', true);
        return;
      }
      resetOutput();
      V.status('Waiting for your browser’s share prompt…');
      V.setEnabled(['v-start'], false);
      try {
        var display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
          preferCurrentTab: value('v-source') === 'tab'
        });
        var tracks = display.getVideoTracks().slice();
        if (checked('v-mic')) {
          try {
            var mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            tracks = tracks.concat(mic.getAudioTracks());
          } catch (error) {
            V.status('Microphone permission was not granted; recording video only.');
          }
        }
        state.mediaStream = new MediaStream(tracks);
        var preview = $('v-preview');
        if (preview) {
          preview.srcObject = state.mediaStream;
          preview.muted = true;
          try { await preview.play(); } catch (error) { /* autoplay may be blocked */ }
        }
        var mime = recordingMime();
        state.recordChunks = [];
        state.recorder = new MediaRecorder(state.mediaStream, mime ? { mimeType: mime, videoBitsPerSecond: 4000000 } : undefined);
        state.recorder.ondataavailable = function (event) { if (event.data && event.data.size) state.recordChunks.push(event.data); };
        state.recorder.onerror = function (event) { V.status('Recording error: ' + (event.error ? event.error.message : 'unknown'), true); stopRecording(); };
        state.recorder.onstop = function () {
          var type = state.recorder ? state.recorder.mimeType || 'video/webm' : 'video/webm';
          var blob = new Blob(state.recordChunks, { type: type });
          state.recordChunks = [];
          if (preview) preview.srcObject = null;
          if (state.mediaStream) { state.mediaStream.getTracks().forEach(function (track) { track.stop(); }); state.mediaStream = null; }
          V.setEnabled(['v-start'], true);
          V.setEnabled(['v-pause', 'v-stop'], false);
          if (blob.size) showBlob(blob, 'letitedit-recording.webm', 'video');
          else V.status('No data was recorded.', true);
        };
        display.getVideoTracks().forEach(function (track) {
          track.addEventListener('ended', function () { if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop(); });
        });
        state.recorder.start(250);
        V.setEnabled(['v-pause', 'v-stop'], true);
        V.status('Recording. Use Pause, Stop, or the browser’s Stop sharing control.');
      } catch (error) {
        state.mediaStream = null;
        V.setEnabled(['v-start'], true);
        V.status(V.friendlyError(error), true);
      }
    });
    on($('v-pause'), 'click', function () {
      if (!state.recorder) return;
      if (state.recorder.state === 'recording') { state.recorder.pause(); $('v-pause').textContent = 'Resume'; V.status('Recording paused.'); }
      else if (state.recorder.state === 'paused') { state.recorder.resume(); $('v-pause').textContent = 'Pause'; V.status('Recording resumed.'); }
    });
    on($('v-stop'), 'click', function () { V.status('Finishing recording…'); stopRecording(); });
  }

  /* ---------- Video trimmer ---------- */

  function initTrimmer() {
    onFileChange(async function (file) {
      state.info = await V.probe(file);
      revoke('inputUrl');
      state.inputUrl = URL.createObjectURL(file);
      var preview = $('v-preview');
      preview.src = state.inputUrl;
      show('v-preview', true);
      $('v-start').value = 0;
      $('v-end').value = 1000;
      setLabel('v-start-value', '0:00.000');
      setLabel('v-end-value', V.formatTime(state.info.duration));
      V.setEnabled(['v-process'], true);
      V.status('Loaded ' + (state.info.width || '?') + '×' + (state.info.height || '?') + ', ' + V.formatTime(state.info.duration) + '.');
    });
    ['v-start', 'v-end'].forEach(function (id) {
      on($(id), 'input', function () {
        var node = $(id);
        if (Number(value('v-start')) >= Number(value('v-end'))) {
          if (id === 'v-start') node.value = Math.max(0, Number(value('v-end')) - 1);
          else node.value = Math.min(1000, Number(value('v-start')) + 1);
        }
        if (state.info) {
          setLabel('v-start-value', V.formatTime(Number(value('v-start')) / 1000 * state.info.duration));
          setLabel('v-end-value', V.formatTime(Number(value('v-end')) / 1000 * state.info.duration));
        }
      });
    });
    on($('v-process'), 'click', async function () {
      if (!state.file || !state.info) return;
      var signal = controller();
      setBusy(true);
      try {
        var copy = checked('v-copy');
        var chosen = value('v-format');
        var format = chosen === 'auto'
          ? (state.file.type.indexOf('webm') !== -1 ? 'webm' : 'mp4')
          : chosen;
        var trim = {
          start: Number(value('v-start')) / 1000 * state.info.duration,
          end: Number(value('v-end')) / 1000 * state.info.duration
        };
        if (trim.end - trim.start < 0.05) throw new Error('Choose a longer range.');
        V.status(copy ? 'Copying the selected stream…' : 'Re-encoding the selected range…');
        var blob = await V.convertVideo(state.file, {
          format: format,
          trim: trim,
          copy: copy,
          video: copy ? undefined : { quality: new (await V.mediabunny()).Quality('high') },
          audio: copy ? undefined : { quality: new (await V.mediabunny()).Quality('medium') },
          signal: signal,
          onProgress: function (fraction) { progress(fraction, copy ? 'Copying' : 'Encoding'); }
        });
        showBlob(blob, 'letitedit-trim.' + (format === 'webm' ? 'webm' : 'mp4'), 'video');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false); }
    });
  }

  /* ---------- MP4 to GIF ---------- */

  function initGif() {
    onFileChange(async function (file) {
      state.info = await V.probe(file);
      revoke('inputUrl');
      state.inputUrl = URL.createObjectURL(file);
      /* The GIF workspace shows an <img>, not a <video>; keep the same
       * preview wiring for other layouts without dereferencing a missing node. */
      var preview = $('v-preview');
      if (preview) {
        preview.src = state.inputUrl;
        show('v-preview', true);
      }
      $('v-start').value = 0;
      $('v-end').value = 1000;
      setLabel('v-start-value', '0:00.000');
      setLabel('v-end-value', V.formatTime(state.info.duration));
      V.setEnabled(['v-process'], true);
      V.status('Ready. Choose a short range for the best GIF size.');
    });
    ['v-start', 'v-end'].forEach(function (id) {
      on($(id), 'input', function () {
        if (Number(value('v-start')) >= Number(value('v-end'))) {
          $(id).value = id === 'v-start' ? Math.max(0, Number(value('v-end')) - 1) : Math.min(1000, Number(value('v-start')) + 1);
        }
        if (state.info) {
          setLabel('v-start-value', V.formatTime(Number(value('v-start')) / 1000 * state.info.duration));
          setLabel('v-end-value', V.formatTime(Number(value('v-end')) / 1000 * state.info.duration));
        }
      });
    });
    on($('v-process'), 'click', async function () {
      if (!state.file || !state.info) return;
      var signal = controller();
      setBusy(true);
      try {
        var fps = Number(value('v-fps'));
        var start = Number(value('v-start')) / 1000 * state.info.duration;
        var end = Number(value('v-end')) / 1000 * state.info.duration;
        if (end - start < 0.1) throw new Error('Choose a longer range.');
        V.status('Decoding frames…');
        var frames = await V.canvasFrames(state.file, {
          fps: fps,
          width: Number(value('v-width')),
          start: start,
          end: end,
          maxFrames: 180,
          signal: signal,
          onProgress: function (fraction) { progress(fraction, 'Decoding frames'); }
        });
        V.status('Encoding GIF…');
        var blob = await V.makeGif(frames.frames, {
          dither: checked('v-dither'),
          signal: signal,
          onProgress: function (fraction) { progress(fraction, 'Encoding GIF'); }
        });
        showBlob(blob, 'letitedit-animation.gif', 'gif');
        if (frames.truncated) V.status('GIF created from the first 180 frames. Shorten the range for the full selection.');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false); }
    });
  }

  /* ---------- Background remover ---------- */

  function initBackgroundRemover() {
    onFileChange(async function (file) {
      state.info = await V.probe(file);
      revoke('inputUrl');
      state.inputUrl = URL.createObjectURL(file);
      var preview = $('v-preview');
      preview.src = state.inputUrl;
      show('v-preview', true);
      V.setEnabled(['v-process'], true);
      V.status('Loaded video. Opt in to local segmentation before processing.');
    });
    on($('v-bg-file'), 'change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      revoke('bgUrl');
      state.bgUrl = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () { state.bgImage = image; revoke('bgUrl'); V.status('Background image loaded locally.'); };
      image.onerror = function () { state.bgImage = null; revoke('bgUrl'); V.status('That image could not be read.', true); };
      image.src = state.bgUrl;
    });
    on($('v-process'), 'click', async function () {
      if (!checked('v-ai-consent')) { V.status('Opt in to the local MediaPipe model first.', true); return; }
      if (!state.file) { V.status('Choose a video file first.', true); return; }
      var signal = controller();
      setBusy(true);
      try {
        var scale = Math.min(1, 960 / (state.info.width || 960));
        var blob = await V.replaceBackground(state.file, {
          format: value('v-format'),
          background: value('v-bg'),
          color: value('v-color'),
          backgroundImage: value('v-bg') === 'image' ? state.bgImage : null,
          threshold: Number(value('v-threshold')),
          feather: Number(value('v-feather')),
          width: Math.round((state.info.width || 640) * scale / 2) * 2,
          height: Math.round((state.info.height || 360) * scale / 2) * 2,
          signal: signal,
          onProgress: function (fraction) { progress(fraction, 'Segmenting and encoding'); },
          onNotice: function (message) { V.status(message); }
        });
        showBlob(blob, 'letitedit-background.' + (value('v-format') === 'mp4' ? 'mp4' : 'webm'), 'video');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false); }
    });
  }

  /* ---------- Subtitle generator ---------- */

  function timedLines() {
    return V.parseTimedTranscript(value('v-transcript'));
  }

  function initSubtitles() {
    V.setEnabled(['v-srt', 'v-vtt', 'v-txt'], false);
    onFileChange(async function (file) { V.status('Ready. Opt in to the local Whisper model, then generate.'); });
    on($('v-process'), 'click', async function () {
      if (!checked('v-ai-consent')) { V.status('Opt in to the local Whisper model first.', true); return; }
      if (!state.file) { V.status('Choose an audio or video file first.', true); return; }
      var signal = controller();
      setBusy(true);
      try {
        V.status('Decoding audio…');
        var audio = await V.decodeAudio(state.file, signal);
        var mono = await V.resampleMono(audio, 16000);
        V.status('Loading local Whisper tiny model (first use is a large download)…');
        var result = await V.transcribe(mono.getChannelData(0), {
          language: value('v-language'),
          signal: signal,
          onProgress: function (message) { V.status(message); }
        });
        state.transcript = result.chunks || [];
        var lines = V.chunkLines(state.transcript);
        if (!lines.length) throw new Error('No speech was detected in this file.');
        $('v-transcript').value = lines.map(function (line) {
          return V.formatTime(line.start) + ' --> ' + V.formatTime(line.end) + ' | ' + line.text;
        }).join('\n');
        V.setEnabled(['v-srt', 'v-vtt', 'v-txt'], true);
        V.status(lines.length + ' timed lines generated. Edit them, then download a subtitle file.');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false); }
    });
    ['v-srt', 'v-vtt', 'v-txt'].forEach(function (id) {
      on($(id), 'click', function () {
        var lines = timedLines();
        if (!lines.length) { V.status('There are no valid timed lines to export.', true); return; }
        var format = id.replace('v-', '');
        V.download(new Blob([V.formatTranscript(lines, format)], { type: 'text/plain;charset=utf-8' }), 'letitedit-subtitles.' + format);
        V.status('Downloaded ' + format.toUpperCase() + ' subtitles.');
      });
    });
  }

  /* ---------- Watermark / text masker ---------- */

  function overlaySelection() {
    var canvas = $('v-mask-canvas');
    if (!canvas || !state.maskSource) return;
    var context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(state.maskSource, 0, 0, canvas.width, canvas.height);
    var x = state.selection.x / 100 * canvas.width;
    var y = state.selection.y / 100 * canvas.height;
    var w = state.selection.w / 100 * canvas.width;
    var h = state.selection.h / 100 * canvas.height;
    context.fillStyle = 'rgba(37,99,235,.22)';
    context.fillRect(x, y, w, h);
    context.strokeStyle = '#2563eb';
    context.lineWidth = 2;
    context.strokeRect(x, y, w, h);
    ['v-x', 'v-y', 'v-w', 'v-h'].forEach(function (id) { $(id).value = Math.round(state.selection[id.slice(2)]); });
  }

  function maskOptions() {
    return {
      x: Number(value('v-x')),
      y: Number(value('v-y')),
      w: Number(value('v-w')),
      h: Number(value('v-h')),
      method: value('v-method'),
      strength: Number(value('v-strength')),
      color: '#0f172a'
    };
  }

  function initWatermark() {
    var canvas = $('v-mask-canvas');
    onFileChange(async function (file) {
      state.info = await V.probe(file);
      var frames = await V.canvasFrames(file, { fps: 1, width: 640, maxFrames: 1 });
      state.maskSource = frames.frames[0].canvas;
      overlaySelection();
      show('v-mask-canvas', true);
      show('v-preview', false);
      V.setEnabled(['v-process'], true);
      V.status('Drag on the frame to choose the area to cover.');
    });
    function point(event) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: V.clamp((event.clientX - rect.left) / rect.width * 100, 0, 100),
        y: V.clamp((event.clientY - rect.top) / rect.height * 100, 0, 100)
      };
    }
    on(canvas, 'pointerdown', function (event) {
      if (!state.maskSource) return;
      state.dragStart = point(event);
      state.selection.x = state.dragStart.x;
      state.selection.y = state.dragStart.y;
      state.selection.w = 1;
      state.selection.h = 1;
      canvas.setPointerCapture(event.pointerId);
      overlaySelection();
    });
    on(canvas, 'pointermove', function (event) {
      if (!state.dragStart) return;
      var current = point(event);
      state.selection.x = Math.min(state.dragStart.x, current.x);
      state.selection.y = Math.min(state.dragStart.y, current.y);
      state.selection.w = Math.max(1, Math.abs(current.x - state.dragStart.x));
      state.selection.h = Math.max(1, Math.abs(current.y - state.dragStart.y));
      overlaySelection();
    });
    on(canvas, 'pointerup', function () { state.dragStart = null; });
    ['v-x', 'v-y', 'v-w', 'v-h'].forEach(function (id) {
      on($(id), 'input', function () {
        state.selection = { x: Number(value('v-x')), y: Number(value('v-y')), w: Number(value('v-w')), h: Number(value('v-h')) };
        overlaySelection();
      });
    });
    on($('v-process'), 'click', async function () {
      if (!state.file || !state.maskSource) return;
      var signal = controller();
      setBusy(true);
      try {
        var scale = Math.min(1, 960 / (state.info.width || 960));
        var blob = await V.maskWatermark(state.file, {
          mask: maskOptions(),
          width: Math.round((state.info.width || 960) * scale / 2) * 2,
          height: Math.round((state.info.height || 540) * scale / 2) * 2,
          signal: signal,
          onProgress: function (fraction) { progress(fraction, 'Masking and encoding'); }
        });
        showBlob(blob, 'letitedit-masked.mp4', 'video');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false); }
    });
  }

  /* ---------- Video to shorts ---------- */

  function motionSeries(frames) {
    var result = [];
    var previous = null;
    frames.forEach(function (frame) {
      var canvas = frame.canvas;
      var context = canvas.getContext('2d');
      var image = context.getImageData(0, 0, canvas.width, canvas.height).data;
      if (previous && previous.length === image.length) {
        var diff = 0;
        for (var i = 0; i < image.length; i += 16) diff += Math.abs(image[i] - previous[i]);
        result.push(diff / (image.length / 16) / 255);
      } else result.push(0);
      previous = image;
    });
    return result;
  }

  function motionCentre(frames) {
    if (!frames || !frames.length) return 0.5;
    var weighted = 0;
    var total = 0;
    for (var f = 1; f < frames.length; f++) {
      var canvas = frames[f].canvas;
      var context = canvas.getContext('2d');
      var current = context.getImageData(0, 0, canvas.width, canvas.height).data;
      var previous = frames[f - 1].canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      var step = Math.max(1, Math.floor(canvas.width / 64));
      for (var y = 0; y < canvas.height; y += step) {
        for (var x = 0; x < canvas.width; x += step) {
          var index = (y * canvas.width + x) * 4;
          var difference = Math.abs(current[index] - previous[index]) +
            Math.abs(current[index + 1] - previous[index + 1]) +
            Math.abs(current[index + 2] - previous[index + 2]);
          weighted += (x / canvas.width) * difference;
          total += difference;
        }
      }
    }
    return total > 0 ? V.clamp(weighted / total, 0, 1) : 0.5;
  }

  function clipRange() {
    var duration = state.info ? state.info.duration : 0;
    var start = V.clamp(Number(value('v-clip-start')) || 0, 0, Math.max(0, duration - 0.2));
    var requestedEnd = Number(value('v-clip-end'));
    var end = requestedEnd > start ? Math.min(duration, requestedEnd) : Math.min(duration, start + 30);
    if (end - start < 0.2) end = Math.min(duration, start + 0.2);
    return { start: start, end: end, duration: end - start };
  }

  function setClipRange(start, end) {
    if ($('v-clip-start')) $('v-clip-start').value = Math.round(start * 10) / 10;
    if ($('v-clip-end')) $('v-clip-end').value = Math.round(end * 10) / 10;
    if ($('v-clip-duration')) $('v-clip-duration').value = Math.round((end - start) * 10) / 10;
  }

  function captionLinesFor(range) {
    var transcript = state.analysis ? state.analysis.transcript : [];
    return transcript.filter(function (line) {
      return line.end > range.start && line.start < range.end;
    }).map(function (line) {
      return {
        start: Math.max(0, line.start - range.start),
        end: Math.min(range.end - range.start, line.end - range.start),
        text: line.text
      };
    });
  }

  function captionTextFor(clip) {
    if (clip.captionText !== undefined) return clip.captionText;
    var lines = captionLinesFor(clip);
    if (!lines.length) return '';
    return lines.map(function (line) {
      return V.formatTime(line.start) + ' --> ' + V.formatTime(line.end) + ' | ' + line.text;
    }).join('\n');
  }

  function addClip(range) {
    if (!state.info || range.duration < 0.2) { V.status('Choose a longer clip range.', true); return false; }
    state.clipPlan.push({
      start: range.start,
      end: range.end,
      layout: value('v-layout'),
      focusX: Number(value('v-crop-x')) / 100,
      focusY: Number(value('v-crop-y')) / 100,
      zoom: Number(value('v-crop-zoom')) / 100,
      captionText: '',
      blob: null
    });
    state.selectedClip = state.clipPlan.length - 1;
    renderClips(value('v-format'));
    $('v-caption').value = captionTextFor(state.clipPlan[state.selectedClip]);
    V.setEnabled(['v-caption-apply', 'v-caption-download'], true);
    return true;
  }

  function updateSelectedSettings() {
    var clip = state.clipPlan[state.selectedClip];
    if (!clip) return;
    clip.layout = value('v-layout');
    clip.focusX = Number(value('v-crop-x')) / 100;
    clip.focusY = Number(value('v-crop-y')) / 100;
    clip.zoom = Number(value('v-crop-zoom')) / 100;
  }

  async function analyseSource(signal) {
    if (!state.file || !state.info) return [];
    stage('Decoding audio for loudness analysis…', 0.08);
    var audio = null;
    var series = [];
    try {
      audio = await V.decodeAudio(state.file, signal);
      series = V.seriesFromAudio(audio, 0.5);
    } catch (error) {
      if (!/no audio track/i.test(V.friendlyError(error))) throw error;
      V.status('No audio track found; ranking clips by frame motion only.');
    }
    var transcript = [];
    if (checked('v-ai-consent') && audio) {
      stage('Loading local Whisper tiny model (roughly 75-80 MB on first use)…', 0.18);
      var mono = await V.resampleMono(audio, 16000);
      var result = await V.transcribe(mono.getChannelData(0), {
        language: 'auto', onProgress: function (message) { V.status(message); }
      });
      transcript = V.chunkLines(result.chunks || []);
    } else if (checked('v-ai-consent')) {
      V.status('Speech ranking needs audio; using motion-only analysis.');
    }
    stage('Sampling real frames for motion analysis…', 0.28);
    var sampled = await V.canvasFrames(state.file, { fps: 1, width: 160, maxFrames: 240, signal: signal });
    var highlights = V.findHighlights({
      audioSeries: series,
      audioStep: 0.5,
      motion: motionSeries(sampled.frames),
      motionStep: 1,
      transcript: transcript,
      useAI: Boolean(transcript.length),
      duration: state.info.duration,
      length: Number(value('v-length')),
      count: Number(value('v-count'))
    });
    state.analysis = {
      audio: audio,
      transcript: transcript,
      frames: sampled.frames,
      highlights: highlights,
      motionCentre: motionCentre(sampled.frames)
    };
    stage('Ranked ' + highlights.length + ' candidate window(s) from real signals.', 0.35);
    return highlights;
  }

  async function focusForClip(clip, signal) {
    if (clip.layout === 'face') {
      if (!checked('v-face-consent')) {
        V.status('Subject crop used the centre; opt in to local face detection for face-centred framing.');
        return { focusX: clip.focusX, focusY: clip.focusY, zoom: clip.zoom };
      }
      try {
        var midpoint = (clip.start + clip.end) / 2;
        var frames = await V.canvasFrames(state.file, { fps: 1, width: 320, maxFrames: 1, start: midpoint, end: Math.min(state.info.duration, midpoint + 0.5), signal: signal });
        var detected = await V.faceCentre(frames.frames[0].canvas, signal);
        if (detected) return { focusX: detected.x, focusY: detected.y, zoom: Math.max(1.2, clip.zoom) };
        V.status('No face was detected in this clip; using the chosen centre crop instead.');
      } catch (error) {
        V.status('Face detection was unavailable (' + V.friendlyError(error) + '); using the chosen centre crop.');
      }
      return { focusX: clip.focusX, focusY: clip.focusY, zoom: clip.zoom };
    }
    if (clip.layout === 'speaker') {
      var audio = state.analysis && state.analysis.audio;
      var focus = audio
        ? V.audioFocus(audio, clip.start, clip.end)
        : (state.analysis ? state.analysis.motionCentre : 0.5);
      V.status('Active-speaker layout uses stereo balance or frame motion as a crop hint; it does not identify people.');
      return { focusX: focus, focusY: 0.5, zoom: Math.max(1.1, clip.zoom) };
    }
    return { focusX: clip.focusX, focusY: clip.focusY, zoom: clip.zoom };
  }

  function clipCaptionBlob(clip) {
    var lines = V.parseTimedTranscript(captionTextFor(clip));
    if (!lines.length) return null;
    return new Blob([V.formatTranscript(lines, 'srt')], { type: 'text/plain;charset=utf-8' });
  }

  function renderClips(format) {
    var list = $('v-clips');
    if (!list) return;
    list.textContent = '';
    state.clipPlan.forEach(function (clip, index) {
      var row = document.createElement('div');
      row.className = 'clip-row';
      var title = document.createElement('strong');
      title.textContent = 'Clip ' + (index + 1) + ': ' + V.formatTime(clip.start) + '–' + V.formatTime(clip.end) +
        ' · ' + V.layoutDimensions(clip.layout).label;
      row.appendChild(title);
      var download = document.createElement('button');
      download.type = 'button';
      download.className = 'btn btn-small';
      download.textContent = 'Download ' + format.toUpperCase();
      download.disabled = !clip.blob;
      download.addEventListener('click', function () {
        if (clip.blob) V.download(clip.blob, 'letitedit-short-' + (index + 1) + '.' + format);
      });
      row.appendChild(download);
      var previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'btn btn-small';
      previewButton.textContent = 'Preview source';
      previewButton.addEventListener('click', function () {
        var video = $('v-source-video');
        state.selectedClip = index;
        $('v-caption').value = captionTextFor(clip);
        if (video) {
          video.currentTime = clip.start;
          var stopAt = clip.end;
          var watch = function () {
            if (video.currentTime >= stopAt) {
              video.pause();
              video.removeEventListener('timeupdate', watch);
            }
          };
          on(video, 'timeupdate', watch);
          video.play().catch(function () { V.status('Press play on the source video to review this range.'); });
        }
      });
      row.appendChild(previewButton);
      ['up', 'down', 'delete'].forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-small';
        button.textContent = action === 'up' ? '↑' : action === 'down' ? '↓' : 'Delete';
        button.addEventListener('click', function () {
          if (action === 'delete') {
            if (clip.previewUrl) URL.revokeObjectURL(clip.previewUrl);
            state.clipPlan.splice(index, 1);
            state.selectedClip = Math.max(0, Math.min(state.selectedClip, state.clipPlan.length - 1));
          } else {
            var target = action === 'up' ? index - 1 : index + 1;
            if (target < 0 || target >= state.clipPlan.length) return;
            var item = state.clipPlan[index];
            state.clipPlan[index] = state.clipPlan[target];
            state.clipPlan[target] = item;
            state.selectedClip = target;
          }
          renderClips(format);
          if (state.clipPlan[state.selectedClip]) $('v-caption').value = captionTextFor(state.clipPlan[state.selectedClip]);
        });
        row.appendChild(button);
      });
      ['start', 'end', 'duration'].forEach(function (kind) {
        var input = document.createElement('input');
        input.type = 'number';
        input.step = '0.1';
        input.min = kind === 'duration' ? '0.2' : '0';
        input.value = (kind === 'duration' ? clip.end - clip.start : clip[kind]).toFixed(1);
        input.setAttribute('aria-label', 'Clip ' + (index + 1) + ' ' + kind + ' in seconds');
        input.style.minHeight = '36px';
        input.style.maxWidth = '110px';
        input.addEventListener('change', function () {
          var amount = Number(input.value);
          if (!isFinite(amount)) return;
          if (kind === 'start') clip.start = V.clamp(amount, 0, clip.end - 0.2);
          if (kind === 'end') clip.end = V.clamp(amount, clip.start + 0.2, state.info.duration);
          if (kind === 'duration') clip.end = Math.min(state.info.duration, clip.start + Math.max(0.2, amount));
          clip.blob = null;
          if (clip.previewUrl) { URL.revokeObjectURL(clip.previewUrl); clip.previewUrl = null; }
          renderClips(format);
          V.status('Clip ' + (index + 1) + ' timing updated. Generate again to render the new range.');
        });
        row.appendChild(input);
      });
      if (clip.blob) {
        var video = document.createElement('video');
        video.className = 'video-player';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.style.maxHeight = '180px';
        clip.previewUrl = clip.previewUrl || URL.createObjectURL(clip.blob);
        state.clipPreviewUrls.indexOf(clip.previewUrl) === -1 && state.clipPreviewUrls.push(clip.previewUrl);
        video.src = clip.previewUrl;
        row.appendChild(video);
        var srt = clipCaptionBlob(clip);
        if (srt) {
          var srtButton = document.createElement('button');
          srtButton.type = 'button';
          srtButton.className = 'btn btn-small';
          srtButton.textContent = 'Download SRT';
          srtButton.addEventListener('click', function () { V.download(clipCaptionBlob(clip), 'letitedit-short-' + (index + 1) + '.srt'); });
          row.appendChild(srtButton);
        }
      }
      var captionSummary = document.createElement('span');
      captionSummary.className = 'hint';
      captionSummary.textContent = captionTextFor(clip) ? 'Captions: ' + captionTextFor(clip).split('\n').length + ' line(s)' : 'No captions yet';
      row.appendChild(captionSummary);
      list.appendChild(row);
    });
    if (!state.clipPlan.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Add a clip above, or use Find candidates to analyse the source.';
      list.appendChild(empty);
    }
  }

  async function exportClips(signal) {
    var format = value('v-format');
    state.clips = [];
    var mb = await V.mediabunny();
    var videoQuality = new mb.Quality('medium');
    var audioQuality = new mb.Quality('medium');
    for (var i = 0; i < state.clipPlan.length; i++) {
      var clip = state.clipPlan[i];
      stage('Preparing clip ' + (i + 1) + ' of ' + state.clipPlan.length + '…', 0.4 + 0.5 * i / state.clipPlan.length);
      var focus = await focusForClip(clip, signal);
      var dimensions = V.layoutDimensions(clip.layout);
      var blob = await V.convertVideo(state.file, {
        format: format,
        trim: { start: clip.start, end: clip.end },
        copy: false,
        video: {
          process: V.layoutProcessor({
            layout: clip.layout,
            focusX: focus.focusX,
            focusY: focus.focusY,
            zoom: focus.zoom
          }),
          processedWidth: dimensions.width,
          processedHeight: dimensions.height,
          quality: videoQuality
        },
        audio: { quality: audioQuality },
        onProgress: function (fraction) {
          progress(0.4 + 0.5 * (i + fraction) / state.clipPlan.length, 'Encoding clip ' + (i + 1));
        },
        signal: signal
      });
      clip.blob = blob;
      state.clips.push({
        start: clip.start,
        end: clip.end,
        blob: blob,
        srt: clipCaptionBlob(clip)
      });
      renderClips(format);
    }
  }

  function initShorts() {
    V.setEnabled(['v-process', 'v-clip-preview', 'v-clip-add', 'v-clip-auto',
      'v-caption-apply', 'v-caption-download', 'v-source-change', 'v-source-remove'], false);
    onFileChange(async function (file) {
      state.info = await V.probe(file);
      state.clipPlan = [];
      state.clipsAnalysed = false;
      state.analysis = null;
      var duration = state.info.duration;
      setClipRange(0, Math.min(duration, Number(value('v-length')) || 30));
      showSourceVideo(file, state.info);
      renderClips(value('v-format'));
      V.setEnabled(['v-process', 'v-clip-preview', 'v-clip-add', 'v-clip-auto',
        'v-source-change', 'v-source-remove'], true);
      V.status('Ready. Analysis uses real audio energy and frame changes. Review clips or generate them.');
    });
    on($('v-source-change'), 'click', function () {
      var input = $('v-file');
      if (input) input.click();
    });
    on($('v-source-remove'), 'click', function () {
      if ($('v-file')) $('v-file').value = '';
      clearSourceVideo();
      resetOutput();
      state.info = null;
      state.analysis = null;
      V.setEnabled(['v-process', 'v-clip-preview', 'v-clip-add', 'v-clip-auto'], false);
      V.status('File removed. Choose another video to begin.');
    });
    on($('v-clip-preview'), 'click', function () {
      var video = $('v-source-video');
      if (!video || !state.info) return;
      var range = clipRange();
      video.currentTime = range.start;
      var watch = function () {
        if (video.currentTime >= range.end) {
          video.pause();
          video.removeEventListener('timeupdate', watch);
        }
      };
      on(video, 'timeupdate', watch);
      video.play().catch(function () { V.status('Press play on the source video to review ' + V.formatTime(range.start) + '–' + V.formatTime(range.end) + '.'); });
      V.status('Previewing ' + V.formatTime(range.start) + '–' + V.formatTime(range.end) + ' from the source.');
    });
    on($('v-clip-add'), 'click', function () {
      if (!state.info) { V.status('Choose a video first.', true); return; }
      if (addClip(clipRange())) V.status('Clip added. Reorder, retime or edit captions before generating.');
    });
    on($('v-clip-auto'), 'click', async function () {
      if (!state.file || !state.info) { V.status('Choose a video first.', true); return; }
      var signal = controller();
      setBusy(true, ['v-process', 'v-clip-auto', 'v-clip-add']);
      try {
        var highlights = await analyseSource(signal);
        highlights.forEach(function (item) { addClip({ start: item.start, end: item.end, duration: item.end - item.start }); });
        state.clipsAnalysed = true;
        if (highlights.length) V.status(highlights.length + ' candidate clip(s) added. Review and edit before generating.');
        else V.status('No usable highlight windows were found.', true);
      } catch (error) { V.status(V.friendlyError(error), true); }
      finally { setBusy(false, ['v-process', 'v-clip-auto', 'v-clip-add']); }
    });
    ['v-layout', 'v-crop-x', 'v-crop-y', 'v-crop-zoom'].forEach(function (id) {
      on($(id), 'input', function () {
        updateSelectedSettings();
        rangeLabel(id, '%');
        renderClips(value('v-format'));
      });
    });
    on($('v-caption-apply'), 'click', function () {
      var clip = state.clipPlan[state.selectedClip];
      if (!clip) { V.status('Select or add a clip first.', true); return; }
      clip.captionText = value('v-caption');
      renderClips(value('v-format'));
      V.status('Captions applied to clip ' + (state.selectedClip + 1) + '. Check the timing before export.');
    });
    on($('v-caption-download'), 'click', function () {
      var clip = state.clipPlan[state.selectedClip];
      if (!clip) { V.status('Select or add a clip first.', true); return; }
      var srt = clipCaptionBlob(clip);
      if (!srt) { V.status('There are no valid timed caption lines to export.', true); return; }
      V.download(srt, 'letitedit-short-' + (state.selectedClip + 1) + '.srt');
    });
    on($('v-process'), 'click', async function () {
      if (!state.file || !state.info) return;
      var signal = controller();
      setBusy(true, ['v-process', 'v-clip-auto', 'v-clip-add']);
      try {
        if (!state.clipPlan.length) {
          var highlights = await analyseSource(signal);
          if (!highlights.length) throw new Error('No usable highlight windows were found.');
          highlights.forEach(function (item) { addClip({ start: item.start, end: item.end, duration: item.end - item.start }); });
          state.clipsAnalysed = true;
        }
        await exportClips(signal);
        if (signal.aborted) throw V.abortError();
        renderClips(value('v-format'));
        V.status(state.clips.length + ' vertical clips exported locally with real previews.');
        finishProgress();
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false, ['v-process', 'v-clip-auto', 'v-clip-add']); }
    });
  }

  ready(function () {
    config = V.config();
    engine = config.engine;
    if (!engine) return;
    bindCommon();
    var initialisers = {
      'audio-editor': initAudioEditor,
      'screen-recorder': initScreenRecorder,
      'video-trimmer': initTrimmer,
      'mp4-to-gif': initGif,
      'video-background-remover': initBackgroundRemover,
      'subtitle-generator': initSubtitles,
      'watermark-remover': initWatermark,
      'video-to-shorts': initShorts
    };
    if (initialisers[engine]) initialisers[engine]();
  });
})();
