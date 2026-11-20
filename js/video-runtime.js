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
    clips: []
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
    state.downloadBlob = null;
    var download = $('v-download');
    if (download) download.disabled = true;
    var preview = $('v-preview');
    if (preview) { preview.removeAttribute('src'); preview.load(); show('v-preview', false); }
    var image = $('v-gif');
    if (image) image.removeAttribute('src');
    var audio = $('v-audio');
    if (audio) { audio.removeAttribute('src'); audio.load(); }
    var clips = $('v-clips');
    if (clips) clips.textContent = 'Analyse a video to see real candidate clips here.';
    state.clips = [];
  }

  function resetInput() {
    revoke('inputUrl');
    state.file = null;
    state.info = null;
    state.audio = null;
    state.edited = null;
    var preview = $('v-preview');
    if (preview) preview.removeAttribute('src');
    V.setEnabled(['v-process', 'v-play', 'v-stop', 'v-srt', 'v-vtt', 'v-txt'], false);
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
    V.status(label + ' ' + Math.round(V.clamp(fraction || 0, 0, 1) * 100) + '%.');
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
      revoke('outputUrl');
      revoke('inputUrl');
      revoke('bgUrl');
    });
  }

  /* ---------- Audio editor ---------- */

  function drawWaveform() {
    var canvas = $('v-waveform');
    if (!canvas || !state.audio) return;
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    var data = state.audio.getChannelData(0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#eff6ff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#93c5fd';
    var columns = Math.min(width, 640);
    for (var x = 0; x < columns; x++) {
      var from = Math.floor(x / columns * data.length);
      var to = Math.max(from + 1, Math.floor((x + 1) / columns * data.length));
      var min = 1;
      var max = -1;
      for (var i = from; i < to; i++) {
        var sample = data[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      var top = height / 2 - max * height / 2.4;
      var bottom = height / 2 - min * height / 2.4;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
    var start = Number(value('v-start')) / 1000 * width;
    var end = Number(value('v-end')) / 1000 * width;
    context.fillStyle = 'rgba(37,99,235,.16)';
    context.fillRect(start, 0, Math.max(1, end - start), height);
    context.strokeStyle = '#2563eb';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(start, 0); context.lineTo(start, height);
    context.moveTo(end, 0); context.lineTo(end, height);
    context.stroke();
  }

  function audioOptions() {
    return {
      start: Number(value('v-start')) / 1000 * state.audio.duration,
      end: Number(value('v-end')) / 1000 * state.audio.duration,
      gain: Number(value('v-gain')),
      fadeIn: Number(value('v-fade-in')),
      fadeOut: Number(value('v-fade-out')),
      reverse: checked('v-reverse')
    };
  }

  function stopAudio() {
    if (state.audioSource) {
      try { state.audioSource.stop(); } catch (error) { /* already stopped */ }
      state.audioSource = null;
    }
    V.setEnabled(['v-stop'], false);
    V.setEnabled(['v-play'], Boolean(state.audio));
  }

  function playEditedAudio() {
    if (!state.audio) return;
    stopAudio();
    var edited = V.editAudio(state.audio, audioOptions());
    state.edited = edited;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    state.audioContext.resume();
    var source = state.audioContext.createBufferSource();
    source.buffer = edited;
    source.connect(state.audioContext.destination);
    source.onended = stopAudio;
    source.start();
    state.audioSource = source;
    V.setEnabled(['v-stop'], true);
    V.setEnabled(['v-play'], false);
    V.status('Playing edited audio.');
  }

  function initAudioEditor() {
    onFileChange(async function (file) {
      state.audio = await V.decodeAudio(file);
      setLabel('v-start-value', '0:00.000');
      setLabel('v-end-value', V.formatTime(state.audio.duration));
      $('v-start').value = 0;
      $('v-end').value = 1000;
      drawWaveform();
      V.setEnabled(['v-process', 'v-play'], true);
      V.status('Decoded ' + V.formatTime(state.audio.duration) + ' of audio. Adjust and apply.');
    });
    ['v-start', 'v-end', 'v-gain', 'v-fade-in', 'v-fade-out'].forEach(function (id) {
      on($(id), 'input', function () {
        var node = $(id);
        if (id === 'v-start' || id === 'v-end') {
          if (Number(value('v-start')) >= Number(value('v-end'))) {
            if (id === 'v-start') node.value = Math.max(0, Number(value('v-end')) - 1);
            else node.value = Math.min(1000, Number(value('v-start')) + 1);
          }
          if (state.audio) {
            setLabel('v-start-value', V.formatTime(Number(value('v-start')) / 1000 * state.audio.duration));
            setLabel('v-end-value', V.formatTime(Number(value('v-end')) / 1000 * state.audio.duration));
          }
        } else {
          setLabel(id + '-value', node.value + (id === 'v-gain' ? '%' : ' ms'));
        }
        drawWaveform();
      });
    });
    on($('v-play'), 'click', playEditedAudio);
    on($('v-stop'), 'click', stopAudio);
    on($('v-reset'), 'click', function () {
      ['v-start', 'v-fade-in', 'v-fade-out'].forEach(function (id) { $(id).value = id === 'v-start' ? 0 : 0; });
      $('v-end').value = 1000;
      $('v-gain').value = 100;
      $('v-reverse').checked = false;
      setLabel('v-start-value', state.audio ? '0:00.000' : '0');
      setLabel('v-end-value', state.audio ? V.formatTime(state.audio.duration) : '0');
      setLabel('v-gain-value', '100%');
      setLabel('v-fade-in-value', '0 ms');
      setLabel('v-fade-out-value', '0 ms');
      stopAudio();
      resetOutput();
      drawWaveform();
      V.status('Edits reset.');
    });
    on($('v-process'), 'click', async function () {
      if (!state.audio) { V.status('Choose an audio file first.', true); return; }
      var signal = controller();
      setBusy(true, ['v-process', 'v-play']);
      try {
        V.status('Applying edits…');
        var edited = V.editAudio(state.audio, audioOptions());
        var format = value('v-format');
        var blob = format === 'wav'
          ? V.writeWav(edited)
          : await V.audioOutput(format === 'mp3' ? 'mp3' : 'm4a', edited);
        if (signal.aborted) throw V.abortError();
        showBlob(blob, 'letitedit-audio.' + (format === 'wav' ? 'wav' : format === 'mp3' ? 'mp3' : 'm4a'), 'audio');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false, ['v-process', 'v-play']); }
    });
  }

  /* ---------- Screen recorder ---------- */

  function recordingMime() {
    var options = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
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

  function verticalFrame(sample) {
    var canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    var context = canvas.getContext('2d');
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    var sw = sample.displayWidth || sample.width || 1280;
    var sh = sample.displayHeight || sample.height || 720;
    var target = canvas.width / canvas.height;
    var cropWidth = Math.min(sw, sh * target);
    var cropHeight = Math.min(sh, sw / target);
    var sx = (sw - cropWidth) / 2;
    var sy = (sh - cropHeight) / 2;
    sample.draw(context, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function renderClips(format) {
    var list = $('v-clips');
    list.textContent = '';
    state.clips.forEach(function (clip, index) {
      var row = document.createElement('div');
      row.className = 'clip-row';
      var title = document.createElement('strong');
      title.textContent = 'Clip ' + (index + 1) + ': ' + V.formatTime(clip.start) + '–' + V.formatTime(clip.end);
      row.appendChild(title);
      var video = document.createElement('button');
      video.type = 'button';
      video.className = 'btn btn-small';
      video.textContent = 'Download ' + format.toUpperCase();
      video.addEventListener('click', function () { V.download(clip.blob, 'letitedit-short-' + (index + 1) + '.' + format); });
      row.appendChild(video);
      if (clip.srt) {
        var srt = document.createElement('button');
        srt.type = 'button';
        srt.className = 'btn btn-small';
        srt.textContent = 'Download SRT';
        srt.addEventListener('click', function () { V.download(clip.srt, 'letitedit-short-' + (index + 1) + '.srt'); });
        row.appendChild(srt);
      }
      list.appendChild(row);
    });
    if (!state.clips.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No candidate clips were found in this source.';
      list.appendChild(empty);
    }
  }

  function initShorts() {
    onFileChange(async function (file) {
      state.info = await V.probe(file);
      V.setEnabled(['v-process'], true);
      V.status('Ready. Analysis uses real audio energy and frame changes.');
    });
    on($('v-process'), 'click', async function () {
      if (!state.file || !state.info) return;
      var signal = controller();
      setBusy(true);
      state.clips = [];
      try {
        V.status('Decoding audio for loudness analysis…');
        var audio = null;
        var series = [];
        try {
          audio = await V.decodeAudio(state.file, signal);
          series = V.seriesFromAudio(audio, 0.5);
        } catch (error) {
          if (!/no audio track/i.test(V.friendlyError(error))) throw error;
          audio = null;
          V.status('No audio track found; ranking clips by frame motion only.');
        }
        var transcript = [];
        if (checked('v-ai-consent')) {
          if (!audio) {
            V.status('Speech ranking needs audio; using motion-only analysis.');
          } else {
            var mono = await V.resampleMono(audio, 16000);
            V.status('Loading local Whisper tiny model…');
            var result = await V.transcribe(mono.getChannelData(0), { language: 'auto', onProgress: function (message) { V.status(message); } });
            transcript = V.chunkLines(result.chunks || []);
          }
        }
        V.status('Sampling frames for motion analysis…');
        var sampled = await V.canvasFrames(state.file, { fps: 1, width: 160, maxFrames: 240, signal: signal });
        var highlights = V.findHighlights({
          audioSeries: series,
          audioStep: 0.5,
          motion: motionSeries(sampled.frames),
          motionStep: 1,
          transcript: transcript,
          useAI: checked('v-ai-consent'),
          duration: state.info.duration,
          length: Number(value('v-length')),
          count: Number(value('v-count'))
        });
        if (!highlights.length) throw new Error('No usable highlight windows were found.');
        var format = value('v-format');
        for (var i = 0; i < highlights.length; i++) {
          var highlight = highlights[i];
          progress((i + 1) / highlights.length, 'Exporting clip ' + (i + 1));
          var blob = await V.convertVideo(state.file, {
            format: format,
            trim: { start: highlight.start, end: highlight.end },
            copy: false,
            video: {
              process: verticalFrame,
              processedWidth: 720,
              processedHeight: 1280,
              quality: new (await V.mediabunny()).Quality('medium')
            },
            audio: { quality: new (await V.mediabunny()).Quality('medium') },
            signal: signal
          });
          var lines = transcript.filter(function (line) { return line.end > highlight.start && line.start < highlight.end; }).map(function (line) {
            return { start: Math.max(0, line.start - highlight.start), end: Math.min(highlight.end - highlight.start, line.end - highlight.start), text: line.text };
          });
          state.clips.push({
            start: highlight.start,
            end: highlight.end,
            blob: blob,
            srt: lines.length ? new Blob([V.formatTranscript(lines, 'srt')], { type: 'text/plain;charset=utf-8' }) : null
          });
        }
        renderClips(format);
        V.status(state.clips.length + ' vertical clips exported locally.');
      } catch (error) {
        V.status(V.friendlyError(error), true);
      } finally { setBusy(false); }
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
