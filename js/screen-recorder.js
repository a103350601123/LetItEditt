/* LetitEdit Screen Recorder — browser-side screen, microphone and webcam capture.
 *
 * Everything happens in this tab: getDisplayMedia() asks the browser for a
 * screen/window/tab stream, getUserMedia() adds an optional microphone and
 * webcam, the Web Audio API mixes audio sources, and MediaRecorder writes the
 * final file. Nothing is uploaded and no recording is stored outside the page.
 */

const CANDIDATES = [
  { mime: 'video/webm;codecs=vp9,opus', label: 'WebM · VP9 + Opus', format: 'WebM', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', label: 'WebM · VP8 + Opus', format: 'WebM', ext: 'webm' },
  { mime: 'video/webm', label: 'WebM', format: 'WebM', ext: 'webm' },
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', label: 'MP4 · H.264 + AAC', format: 'MP4', ext: 'mp4' },
  { mime: 'video/mp4', label: 'MP4', format: 'MP4', ext: 'mp4' }
];

const els = {
  panel: document.querySelector('[data-panel]'),
  stageSection: document.querySelector('[data-stage-section]'),
  stage: document.querySelector('[data-stage]'),
  screen: document.querySelector('[data-screen-preview]'),
  webcamPreview: document.querySelector('[data-webcam-preview]'),
  webcamPreviewVideo: document.querySelector('[data-webcam-preview] video'),
  placeholder: document.querySelector('[data-placeholder]'),
  badge: document.querySelector('[data-rec-badge]'),
  pausedBadge: document.querySelector('[data-paused-badge]'),
  timer: document.querySelector('[data-timer]'),
  status: document.querySelector('[data-status]'),
  captured: document.querySelector('[data-captured]'),
  transport: document.querySelector('[data-transport]'),
  start: document.querySelector('[data-start]'),
  pause: document.querySelector('[data-pause]'),
  resume: document.querySelector('[data-resume]'),
  stop: document.querySelector('[data-stop]'),
  cancel: document.querySelector('[data-cancel]'),
  mute: document.querySelector('[data-mute-mic]'),
  error: document.querySelector('[data-error]'),
  notice: document.querySelector('[data-notice]'),
  support: document.querySelector('[data-support]'),
  supportList: document.querySelector('[data-support-list]'),
  settings: document.querySelector('[data-settings]'),
  resolution: document.querySelector('[data-resolution]'),
  fps: document.querySelector('[data-fps]'),
  quality: document.querySelector('[data-quality]'),
  systemAudio: document.querySelector('[data-system-audio]'),
  mic: document.querySelector('[data-mic]'),
  micDevice: document.querySelector('[data-mic-device]'),
  micVolume: document.querySelector('[data-mic-volume]'),
  micVolumeLabel: document.querySelector('[data-mic-volume-label]'),
  level: document.querySelector('[data-level]'),
  levelBar: document.querySelector('[data-level-bar]'),
  webcam: document.querySelector('[data-webcam]'),
  webcamFields: document.querySelector('[data-webcam-fields]'),
  webcamSize: document.querySelector('[data-webcam-size]'),
  webcamSizeLabel: document.querySelector('[data-webcam-size-label]'),
  webcamShape: document.querySelector('[data-webcam-shape]'),
  positions: Array.from(document.querySelectorAll('[data-position]')),
  formatNote: document.querySelector('[data-format-note]'),
  audioSupport: document.querySelector('[data-audio-support]'),
  result: document.querySelector('[data-result]'),
  resultVideo: document.querySelector('[data-result-video]'),
  resultName: document.querySelector('[data-result-name]'),
  resultFormat: document.querySelector('[data-result-format]'),
  resultDuration: document.querySelector('[data-result-duration]'),
  resultSize: document.querySelector('[data-result-size]'),
  resultResolution: document.querySelector('[data-result-resolution]'),
  resultAudio: document.querySelector('[data-result-audio]'),
  resultNote: document.querySelector('[data-result-note]'),
  download: document.querySelector('[data-download]'),
  again: document.querySelector('[data-record-again]'),
  discard: document.querySelector('[data-discard]')
};

const caps = {
  secure: true,
  display: false,
  recorder: false,
  capture: false,
  mic: false,
  webcam: false,
  mime: '',
  format: '',
  ext: '',
  label: ''
};

const state = {
  phase: 'idle',
  recorder: null,
  displayStream: null,
  displayVideo: null,
  micStream: null,
  webcamStream: null,
  audioContext: null,
  mixDestination: null,
  micGain: null,
  systemGain: null,
  analyser: null,
  audioBuffer: null,
  composition: null,
  compositionTrack: null,
  chunks: [],
  result: null,
  settings: null,
  recordMime: '',
  formatLabel: '',
  elapsed: 0,
  segmentStart: 0,
  timerId: null,
  levelId: null,
  micMuted: false,
  cancelRequested: false,
  finalized: false,
  finalizedFallback: null,
  audioDetected: false,
  outputAudioCount: 0,
  captured: '',
  measuredFps: 0,
  levelPeak: 0,
  webcamBusy: false,
  starting: false
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function evenSize(width, height) {
  return {
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2)
  };
}

function targetSize(source, resolution) {
  const sourceWidth = Math.max(2, Math.round(source.width || 1280));
  const sourceHeight = Math.max(2, Math.round(source.height || 720));
  if (resolution === 'source') return evenSize(sourceWidth, sourceHeight);
  const wanted = Number(resolution) || 1080;
  /* Never upscale: a 720p source stays 720p even when 1080p is requested. */
  const height = Math.min(wanted, sourceHeight);
  const width = Math.round(sourceWidth * (height / sourceHeight));
  return evenSize(width, height);
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch (error) {
      /* already stopped */
    }
  }
}

function once(target, event, timeout = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.removeEventListener(event, finish);
      resolve(true);
    };
    target.addEventListener(event, finish, { once: true });
    setTimeout(finish, timeout);
  });
}

function waitForVideo(video, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error('The capture stream did not produce a picture.'));
    };
    const timer = setTimeout(() => finish(video.videoWidth > 0), timeout);
    const check = () => {
      if (video.videoWidth > 0) finish(true);
    };
    video.addEventListener('loadedmetadata', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('playing', check);
    video.play().then(check).catch(() => {});
    check();
  });
}

/* ------------------------------------------------------------------ */
/* Capability detection                                               */
/* ------------------------------------------------------------------ */

function detectCapabilities() {
  caps.secure = window.isSecureContext !== false;
  caps.display = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
  caps.recorder = typeof window.MediaRecorder === 'function';
  caps.capture = typeof HTMLCanvasElement === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  caps.mic = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  caps.webcam = caps.mic && caps.capture;

  if (caps.recorder) {
    for (const candidate of CANDIDATES) {
      let supported = false;
      try {
        supported = window.MediaRecorder.isTypeSupported(candidate.mime);
      } catch (error) {
        supported = false;
      }
      if (supported) {
        caps.mime = candidate.mime;
        caps.format = candidate.format;
        caps.ext = candidate.ext;
        caps.label = candidate.label;
        break;
      }
    }
  }

  const problems = [];
  if (!caps.secure) problems.push('Screen capture needs HTTPS (or localhost). Open this page over a secure connection.');
  if (!caps.display) problems.push('This browser does not provide screen capture (getDisplayMedia). Use a desktop version of Chrome, Edge, Firefox or Safari.');
  if (!caps.recorder) problems.push('This browser does not support MediaRecorder, so the recording cannot be saved.');
  if (caps.recorder && !caps.mime) problems.push('No supported recording format was found. Try another browser.');
  if (!caps.capture) {
    /* Not fatal for screen-only recording, but the overlay is impossible. */
    els.webcam.title = 'This browser cannot combine a webcam overlay with the screen recording.';
  }

  if (problems.length) {
    els.support.hidden = false;
    els.supportList.innerHTML = '';
    for (const problem of problems) {
      const item = document.createElement('li');
      item.textContent = problem;
      els.supportList.appendChild(item);
    }
  } else {
    els.support.hidden = true;
  }

  els.formatNote.textContent = caps.mime
    ? `This browser records ${caps.label}. The extension always matches the real file type.`
    : 'No recording format is available in this browser.';

  els.webcam.disabled = !caps.webcam;
  els.mic.disabled = !caps.mic;
  els.micDevice.disabled = !caps.mic;
  els.micVolume.disabled = !caps.mic;

  const canStart = capsReady();
  els.start.disabled = !canStart;
  if (!canStart) {
    els.start.setAttribute('aria-describedby', 'sr-support-note');
  }
}

function capsReady() {
  return caps.secure && caps.display && caps.recorder && Boolean(caps.mime);
}

/* ------------------------------------------------------------------ */
/* UI state                                                           */
/* ------------------------------------------------------------------ */

function isActive() {
  return state.phase === 'recording' || state.phase === 'paused';
}

function setPhase(phase) {
  state.phase = phase;
  els.panel.dataset.state = phase;
  const active = phase === 'recording' || phase === 'paused';
  const busy = phase === 'starting' || phase === 'stopping';

  els.start.hidden = phase !== 'idle';
  els.pause.hidden = phase !== 'recording';
  els.resume.hidden = phase !== 'paused';
  els.stop.hidden = !active;
  els.cancel.hidden = !active;
  els.mute.hidden = !(active && state.micStream);
  if (els.settings) els.settings.inert = phase !== 'idle';
  els.badge.hidden = !active;
  els.pausedBadge.hidden = phase !== 'paused';
  els.transport.hidden = phase === 'ready';
  els.stageSection.hidden = phase === 'ready';

  els.start.disabled = !capsReady() || busy;
  els.stop.disabled = busy;
  els.cancel.disabled = busy;
  els.pause.disabled = busy;
  els.resume.disabled = busy;

  if (phase === 'ready') {
    els.webcamPreview.hidden = true;
  }

  refreshStatus();
}

function refreshStatus(extra) {
  const messages = {
    idle: 'Ready to record',
    starting: 'Waiting for screen permission…',
    recording: state.micMuted ? 'Recording · microphone muted' : 'Recording your screen',
    paused: 'Recording paused',
    stopping: 'Finishing the recording…',
    ready: 'Recording ready'
  };
  els.status.textContent = extra || messages[state.phase] || '';
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.notice.hidden = true;
}

function showNotice(message) {
  els.notice.textContent = message;
  els.notice.hidden = false;
}

function clearMessages() {
  els.error.hidden = true;
  els.error.textContent = '';
  els.notice.hidden = true;
  els.notice.textContent = '';
}

function screenError(error) {
  const name = error && error.name ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError' || name === 'SecurityError') {
    return 'Screen access was cancelled or denied. Click Start recording to try again, then choose a screen, window or tab in the browser dialog.';
  }
  if (name === 'NotFoundError') {
    return 'No screen, window or tab was available to share. Make sure another display is connected or try a different source.';
  }
  if (name === 'NotReadableError') {
    return 'The browser could not start the screen capture. Another application may be using the display, or the operating system blocked it.';
  }
  if (name === 'OverconstrainedError') {
    return 'This browser could not apply the requested frame rate to the screen capture. Try 30 FPS or Original resolution.';
  }
  if (name === 'InvalidStateError') {
    return 'Screen capture could not start from this page state. Reload the page and click Start recording again.';
  }
  const detail = error && error.message ? ` (${error.message})` : '';
  return `Screen capture could not start${detail}. Reload the page or try a supported desktop browser.`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function readSettings() {
  return {
    resolution: els.resolution.value,
    fps: Number(els.fps.value) || 30,
    quality: els.quality.value,
    systemAudio: els.systemAudio.checked,
    mic: els.mic.checked && caps.mic,
    micDevice: els.micDevice.value,
    micVolume: clamp(Number(els.micVolume.value) / 100 || 0, 0, 1),
    webcam: els.webcam.checked && caps.webcam,
    webcamPosition: activePosition(),
    webcamSize: clamp(Number(els.webcamSize.value) || 28, 18, 45),
    webcamShape: els.webcamShape.value === 'rectangle' ? 'rectangle' : 'circle'
  };
}

function activePosition() {
  const pressed = els.positions.find((button) => button.getAttribute('aria-pressed') === 'true');
  return pressed ? pressed.dataset.position : 'top-right';
}

function setPosition(position) {
  for (const button of els.positions) {
    button.setAttribute('aria-pressed', String(button.dataset.position === position));
  }
  applyWebcamPreview();
}

function bitrateFor(width, height, fps, quality) {
  const bpp = quality === 'high' ? 0.16 : quality === 'low' ? 0.06 : 0.1;
  return Math.round(clamp(width * height * fps * bpp, 500000, 20000000));
}

/* ------------------------------------------------------------------ */
/* Webcam preview                                                     */
/* ------------------------------------------------------------------ */

function applyWebcamPreview() {
  const frame = els.webcamPreview;
  if (!frame) return;
  const hasStream = Boolean(state.webcamStream && state.webcamStream.getVideoTracks().length);
  frame.hidden = !hasStream;
  if (!hasStream) return;

  const rect = els.stage.getBoundingClientRect();
  const height = Math.max(1, rect.height);
  const width = Math.max(1, rect.width);
  const size = Math.round(height * (Number(els.webcamSize.value) / 100));
  const margin = Math.round(Math.min(width, height) * 0.035);
  const position = activePosition();
  const left = position.endsWith('left');
  const top = position.startsWith('top');

  frame.style.width = `${size}px`;
  frame.style.height = `${size}px`;
  frame.style.left = left ? `${margin}px` : 'auto';
  frame.style.right = left ? 'auto' : `${margin}px`;
  frame.style.top = top ? `${margin}px` : 'auto';
  frame.style.bottom = top ? 'auto' : `${margin}px`;
  frame.style.borderRadius = els.webcamShape.value === 'rectangle' ? `${Math.round(size * 0.12)}px` : '50%';

  els.webcamSizeLabel.textContent = `${Math.round(Number(els.webcamSize.value))}% of frame height`;
}

function attachWebcamStream(stream) {
  state.webcamStream = stream;
  els.webcamPreviewVideo.srcObject = stream;
  els.webcamPreviewVideo.play().catch(() => {});
  applyWebcamPreview();
}

async function ensureWebcam() {
  if (!caps.webcam) {
    els.webcam.checked = false;
    showError('This browser does not support webcam capture.');
    return false;
  }
  if (state.webcamStream && state.webcamStream.getVideoTracks().length) return true;
  if (state.webcamBusy) return false;
  state.webcamBusy = true;
  els.webcam.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
    attachWebcamStream(stream);
    clearMessages();
    return true;
  } catch (error) {
    els.webcam.checked = false;
    const name = error && error.name ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      showError('Camera access was denied. Allow the camera for this site in your browser settings, then enable the webcam again.');
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      showError('No usable webcam was found. Connect a camera or continue with screen-only recording.');
    } else {
      showError(`The webcam could not start${error && error.message ? ` (${error.message})` : ''}. You can continue without it.`);
    }
    return false;
  } finally {
    state.webcamBusy = false;
    els.webcam.disabled = !caps.webcam || state.phase !== 'idle';
  }
}

function releaseWebcam() {
  stopStream(state.webcamStream);
  state.webcamStream = null;
  els.webcamPreviewVideo.srcObject = null;
  els.webcamPreview.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Audio                                                              */
/* ------------------------------------------------------------------ */

async function buildAudioMix(displayStream, micStream, settings) {
  const systemTracks = displayStream ? displayStream.getAudioTracks() : [];
  const micTracks = micStream ? micStream.getAudioTracks() : [];
  if (!systemTracks.length && !micTracks.length) {
    return { tracks: [], hasSystem: false, hasMic: false, mixed: false, failed: false };
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    const fallbackTracks = systemTracks.length ? systemTracks : micTracks;
    showNotice('This browser could not mix audio tracks, so only one source is recorded.');
    return {
      tracks: fallbackTracks,
      hasSystem: Boolean(systemTracks.length),
      hasMic: Boolean(micTracks.length),
      mixed: false,
      failed: true
    };
  }

  try {
    const context = new AudioCtor();
    if (context.state === 'suspended') await context.resume().catch(() => {});
    const destination = context.createMediaStreamDestination();
    const master = context.createGain();
    /* A small trim keeps a microphone and loud system audio from clipping. */
    master.gain.value = 0.9;
    master.connect(destination);

    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(analyser);

    if (systemTracks.length) {
      const source = context.createMediaStreamSource(new MediaStream(systemTracks));
      const gain = context.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(master);
      state.systemGain = gain;
    }
    if (micTracks.length) {
      const source = context.createMediaStreamSource(new MediaStream(micTracks));
      const gain = context.createGain();
      gain.gain.value = settings.micVolume;
      source.connect(gain);
      gain.connect(master);
      state.micGain = gain;
    }

    state.audioContext = context;
    state.mixDestination = destination;
    state.analyser = analyser;
    state.audioBuffer = new Float32Array(analyser.fftSize);

    return {
      tracks: destination.stream.getAudioTracks(),
      hasSystem: Boolean(systemTracks.length),
      hasMic: Boolean(micTracks.length),
      mixed: Boolean(systemTracks.length && micTracks.length),
      failed: false
    };
  } catch (error) {
    const fallbackTracks = systemTracks.length ? systemTracks : micTracks;
    showNotice('Audio mixing was unavailable, so a single audio source is recorded.');
    return {
      tracks: fallbackTracks,
      hasSystem: Boolean(systemTracks.length),
      hasMic: Boolean(micTracks.length),
      mixed: false,
      failed: true
    };
  }
}

function sampleAudio() {
  if (!state.analyser || !state.audioBuffer) return;
  try {
    state.analyser.getFloatTimeDomainData(state.audioBuffer);
  } catch (error) {
    return;
  }
  let peak = 0;
  for (let index = 0; index < state.audioBuffer.length; index += 1) {
    const value = Math.abs(state.audioBuffer[index]);
    if (value > peak) peak = value;
  }
  state.levelPeak = Math.max(state.levelPeak * 0.82, peak);
  if (peak > 0.004) state.audioDetected = true;
  if (els.levelBar) {
    els.levelBar.style.width = `${Math.min(100, Math.round(state.levelPeak * 140))}%`;
  }
}

/* ------------------------------------------------------------------ */
/* Composition canvas (used only when the webcam must be combined)     */
/* ------------------------------------------------------------------ */

function drawWebcamOverlay(context, width, height, settings) {
  const video = state.webcamStream && state.webcamStream.getVideoTracks().length
    ? els.webcamPreviewVideo
    : null;
  if (!video || !video.videoWidth || video.readyState < 2) return;

  const size = Math.round(height * (settings.webcamSize / 100));
  const margin = Math.round(Math.min(width, height) * 0.035);
  const left = settings.webcamPosition.endsWith('left');
  const top = settings.webcamPosition.startsWith('top');
  const x = left ? margin : width - size - margin;
  const y = top ? margin : height - size - margin;

  const sourceRatio = video.videoWidth / video.videoHeight;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;
  if (sourceRatio > 1) {
    sw = video.videoHeight;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth;
    sy = (video.videoHeight - sh) / 2;
  }

  context.save();
  context.beginPath();
  if (settings.webcamShape === 'circle') {
    context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  } else {
    const radius = Math.round(size * 0.12);
    if (typeof context.roundRect === 'function') {
      context.roundRect(x, y, size, size, radius);
    } else {
      context.rect(x, y, size, size);
    }
  }
  context.clip();
  context.drawImage(video, sx, sy, sw, sh, x, y, size, size);
  context.restore();

  context.save();
  context.beginPath();
  if (settings.webcamShape === 'circle') {
    context.arc(x + size / 2, y + size / 2, Math.max(1, size / 2 - 1), 0, Math.PI * 2);
  } else {
    const radius = Math.round(size * 0.12);
    if (typeof context.roundRect === 'function') {
      context.roundRect(x + 1, y + 1, size - 2, size - 2, radius);
    } else {
      context.rect(x + 1, y + 1, size - 2, size - 2);
    }
  }
  context.strokeStyle = 'rgba(255,255,255,.92)';
  context.lineWidth = Math.max(2, Math.round(size * 0.022));
  context.stroke();
  context.restore();
}

function drawComposition(composition) {
  const { canvas, context, settings } = composition;
  const width = canvas.width;
  const height = canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#0b1220';
  context.fillRect(0, 0, width, height);

  const screen = els.screen;
  if (screen && screen.readyState >= 2 && screen.videoWidth > 0) {
    context.drawImage(screen, 0, 0, width, height);
  }
  drawWebcamOverlay(context, width, height, settings);
}

function startComposition(settings) {
  const canvas = document.createElement('canvas');
  const source = {
    width: els.screen.videoWidth || 1280,
    height: els.screen.videoHeight || 720
  };
  const size = targetSize(source, settings.resolution);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The browser could not create the recording canvas.');

  const composition = {
    canvas,
    context,
    settings,
    fps: settings.fps,
    active: true,
    raf: 0,
    last: 0,
    start: 0,
    frames: 0,
    timer: 0
  };
  state.composition = composition;

  drawComposition(composition);
  composition.start = performance.now();

  const tick = (now) => {
    if (!composition.active) return;
    const interval = 1000 / composition.fps;
    if (!composition.last || now - composition.last >= interval - 4) {
      composition.last = now;
      drawComposition(composition);
      composition.frames += 1;
      const elapsed = now - composition.start;
      if (elapsed > 1200) {
        state.measuredFps = Math.round((composition.frames * 1000) / elapsed * 10) / 10;
        composition.frames = 0;
        composition.start = now;
        updateCapturedLine();
      }
    }
    composition.raf = requestAnimationFrame(tick);
  };
  composition.raf = requestAnimationFrame(tick);

  /* Hidden tabs stop requestAnimationFrame. A slow timer keeps a frame
     flowing, but the honest limitation is documented on the page. */
  composition.timer = setInterval(() => {
    if (composition.active && document.hidden) drawComposition(composition);
  }, Math.max(40, Math.round(1000 / composition.fps)));

  return composition;
}

function stopComposition() {
  const composition = state.composition;
  if (composition) {
    composition.active = false;
    cancelAnimationFrame(composition.raf);
    clearInterval(composition.timer);
    state.composition = null;
  }
  if (state.compositionTrack) {
    try {
      state.compositionTrack.stop();
    } catch (error) {
      /* already stopped */
    }
    state.compositionTrack = null;
  }
}

/* ------------------------------------------------------------------ */
/* Captured summary                                                   */
/* ------------------------------------------------------------------ */

function updateCapturedLine() {
  if (!state.captured) {
    els.captured.hidden = true;
    return;
  }
  const parts = [state.captured];
  if (state.measuredFps) parts.push(`≈${state.measuredFps} fps drawn`);
  if (state.outputAudioCount) {
    parts.push(state.audioDetected ? 'audio detected' : 'audio track included');
  } else {
    parts.push('no audio');
  }
  els.captured.textContent = parts.join(' · ');
  els.captured.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Recording                                                          */
/* ------------------------------------------------------------------ */

async function startRecording() {
  if (state.starting || !capsReady() || state.phase !== 'idle') return;
  state.starting = true;
  clearMessages();
  discardResult();
  setPhase('starting');
  refreshStatus('Waiting for you to choose a screen, window or tab…');
  els.start.disabled = true;

  const settings = readSettings();
  let displayStream = null;
  let micStream = null;
  const warnings = [];

  try {
    displayStream = await requestDisplay(settings);
  } catch (error) {
    state.starting = false;
    setPhase('idle');
    showError(screenError(error));
    return;
  }

  const displayTracks = displayStream ? displayStream.getVideoTracks() : [];
  if (!displayTracks.length) {
    stopStream(displayStream);
    state.starting = false;
    setPhase('idle');
    showError('The browser returned a screen stream without a video track. Please try again.');
    return;
  }

  state.displayStream = displayStream;
  state.displayVideo = els.screen;
  els.screen.srcObject = displayStream;
  els.screen.hidden = false;
  els.placeholder.hidden = true;
  els.stage.classList.add('has-stream');
  await els.screen.play().catch(() => {});

  try {
    await waitForVideo(els.screen);
  } catch (error) {
    stopStream(displayStream);
    cleanupAfterFailure();
    state.starting = false;
    setPhase('idle');
    showError('The screen capture started but no picture arrived. Stop other screen-sharing apps and try again.');
    return;
  }

  const source = {
    width: els.screen.videoWidth || displayTracks[0].getSettings().width || 1280,
    height: els.screen.videoHeight || displayTracks[0].getSettings().height || 720
  };

  if (settings.systemAudio && displayStream.getAudioTracks().length === 0) {
    warnings.push('No system or tab audio track was provided by the browser. Your browser or the selected source does not offer audio capture.');
  }

  if (settings.mic) {
    try {
      micStream = await requestMicrophone(settings);
      state.micStream = micStream;
      refreshDevices();
    } catch (error) {
      const name = error && error.name ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        warnings.push('Microphone access was denied. Recording continues without the microphone.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        warnings.push('No usable microphone was found. Recording continues without it.');
      } else {
        warnings.push('The microphone could not start, so the recording continues without it.');
      }
      els.mic.checked = false;
    }
  }

  if (settings.webcam) {
    const ready = await ensureWebcam();
    if (!ready) {
      settings.webcam = false;
      warnings.push('The webcam could not start. Recording continues with the screen only.');
    }
  }

  const audio = await buildAudioMix(displayStream, micStream, settings);
  const audioTracks = audio.tracks || [];
  state.outputAudioCount = audioTracks.length;
  state.audioDetected = false;
  state.levelPeak = 0;

  const audioProblem = settings.systemAudio && !audio.hasSystem && settings.mic && !audio.hasMic;
  if (audioProblem) {
    warnings.push('Neither microphone nor system audio was available, so this recording has no sound.');
  }

  let outputStream = null;
  let captured = '';
  let width = source.width;
  let height = source.height;

  try {
    if (settings.webcam) {
      const composition = startComposition(settings);
      width = composition.canvas.width;
      height = composition.canvas.height;
      const videoTrack = composition.canvas.captureStream(settings.fps).getVideoTracks()[0];
      if (!videoTrack) throw new Error('The browser could not capture the composition canvas.');
      state.compositionTrack = videoTrack;
      outputStream = new MediaStream([videoTrack, ...audioTracks]);
      captured = `Captured ${width} × ${height} · ${settings.fps} fps · ${caps.format} with webcam overlay`;
    } else {
      await applyScreenConstraints(displayTracks[0], settings, source);
      const applied = displayTracks[0].getSettings();
      width = applied.width || source.width;
      height = applied.height || source.height;
      const appliedFps = Math.round(applied.frameRate || settings.fps);
      outputStream = new MediaStream([displayTracks[0], ...audioTracks]);
      captured = `Captured ${width} × ${height} · ${appliedFps} fps · ${caps.format}`;
      const requested = targetSize(source, settings.resolution);
      if (settings.resolution !== 'source' && requested.height < source.height && height > requested.height + 2) {
        captured += ' (source size kept; this browser cannot resize a live screen capture)';
      }
    }
  } catch (error) {
    stopStream(displayStream);
    stopStream(micStream);
    stopStream(state.webcamStream);
    state.webcamStream = null;
    state.micStream = null;
    state.displayStream = null;
    cleanupAudio();
    stopComposition();
    state.starting = false;
    setPhase('idle');
    showError(error && error.message ? error.message : 'The recording could not be prepared.');
    return;
  }

  state.settings = settings;
  state.recordMime = caps.mime;
  state.formatLabel = caps.label;
  state.captured = captured;
  state.elapsed = 0;
  state.segmentStart = 0;
  state.micMuted = false;
  state.cancelRequested = false;
  state.finalized = false;
  state.chunks = [];
  state.measuredFps = 0;
  state.levelPeak = 0;

  const videoBitrate = bitrateFor(width, height, settings.fps, settings.quality);
  let recorder = null;
  try {
    recorder = new MediaRecorder(outputStream, {
      mimeType: caps.mime,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: 128000
    });
  } catch (error) {
    stopStream(displayStream);
    stopStream(micStream);
    stopStream(state.webcamStream);
    state.webcamStream = null;
    state.micStream = null;
    state.displayStream = null;
    cleanupAudio();
    stopComposition();
    state.starting = false;
    setPhase('idle');
    showError('This browser refused the recording settings. Try a lower resolution or 30 FPS.');
    return;
  }

  state.recorder = recorder;
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) state.chunks.push(event.data);
  };
  recorder.onerror = () => {
    showError('Recording was interrupted by the browser. The material captured so far will be saved.');
    if (isActive()) stopRecording('error');
  };
  recorder.onstop = () => finalizeRecording();

  rsTrackEnded(displayTracks[0]);
  for (const track of audioTracks) {
    track.addEventListener('ended', () => {
      if (isActive()) showNotice('An audio track stopped while recording. The rest of the recording continues.');
    });
  }

  try {
    recorder.start(1000);
  } catch (error) {
    stopStream(displayStream);
    stopStream(micStream);
    stopStream(state.webcamStream);
    state.webcamStream = null;
    state.micStream = null;
    state.displayStream = null;
    cleanupAudio();
    stopComposition();
    state.starting = false;
    setPhase('idle');
    showError('The recording could not start. Reload the page and try again.');
    return;
  }

  state.starting = false;
  state.segmentStart = performance.now();
  setPhase('recording');
  refreshStatus();
  startTicker();
  if (warnings.length) showNotice(warnings.join(' '));
  window.addEventListener('beforeunload', beforeUnload);
  els.mute.textContent = 'Mute mic';
  els.mute.setAttribute('aria-pressed', 'false');
  updateCapturedLine();
}

function rsTrackEnded(track) {
  track.addEventListener('ended', () => {
    if (state.phase !== 'recording' && state.phase !== 'paused') return;
    showNotice('Screen sharing ended. The recording was stopped and everything captured so far was kept.');
    stopRecording('ended');
  });
}

async function requestDisplay(settings) {
  const video = { frameRate: { ideal: settings.fps } };
  const audio = settings.systemAudio
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : false;
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video, audio });
  } catch (error) {
    if (error && (error.name === 'OverconstrainedError' || error.name === 'TypeError')) {
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio });
    }
    throw error;
  }
}

async function requestMicrophone(settings) {
  const constraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };
  if (settings.micDevice) constraints.deviceId = { exact: settings.micDevice };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    if (settings.micDevice && error && error.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw error;
  }
}

async function applyScreenConstraints(track, settings, source) {
  const requested = targetSize(source, settings.resolution);
  const constraints = { frameRate: { ideal: settings.fps } };
  if (settings.resolution !== 'source' && requested.height < source.height) {
    constraints.height = { ideal: requested.height };
    constraints.width = { ideal: requested.width };
  }
  try {
    await track.applyConstraints(constraints);
  } catch (error) {
    /* The source size is kept; this is reported in the captured summary. */
  }
}

function startTicker() {
  clearInterval(state.timerId);
  clearInterval(state.levelId);
  state.timerId = setInterval(() => {
    els.timer.textContent = formatClock(currentElapsed());
  }, 250);
  state.levelId = setInterval(() => {
    sampleAudio();
    if (state.phase === 'recording' || state.phase === 'paused') updateCapturedLine();
  }, 350);
  els.timer.textContent = '00:00';
  sampleAudio();
}

function currentElapsed() {
  if (state.phase === 'recording') return state.elapsed + (performance.now() - state.segmentStart);
  return state.elapsed;
}

function pauseRecording() {
  if (state.phase !== 'recording' || !state.recorder) return;
  try {
    state.recorder.pause();
  } catch (error) {
    showError('This browser could not pause the recording. Stop it to keep the file.');
    return;
  }
  state.elapsed += performance.now() - state.segmentStart;
  setPhase('paused');
  els.timer.textContent = formatClock(state.elapsed);
}

function resumeRecording() {
  if (state.phase !== 'paused' || !state.recorder) return;
  try {
    state.recorder.resume();
  } catch (error) {
    showError('This browser could not resume the recording. Stop it to keep the file.');
    return;
  }
  state.segmentStart = performance.now();
  setPhase('recording');
}

function stopRecording(reason = 'user') {
  if (!isActive()) return;
  if (state.phase === 'recording') state.elapsed += performance.now() - state.segmentStart;
  setPhase('stopping');
  refreshStatus(reason === 'ended' ? 'Screen sharing ended. Finishing the file…' : 'Finishing the recording…');
  clearInterval(state.timerId);
  clearInterval(state.levelId);
  sampleAudio();
  window.removeEventListener('beforeunload', beforeUnload);
  try {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    else finalizeRecording();
  } catch (error) {
    finalizeRecording();
  }
  clearTimeout(state.finalizedFallback);
  state.finalizedFallback = setTimeout(() => finalizeRecording(), 2500);
}

function cancelRecording() {
  if (!isActive()) return;
  state.cancelRequested = true;
  if (state.phase === 'recording') state.elapsed += performance.now() - state.segmentStart;
  setPhase('stopping');
  refreshStatus('Discarding the recording…');
  clearInterval(state.timerId);
  clearInterval(state.levelId);
  window.removeEventListener('beforeunload', beforeUnload);
  try {
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    else finalizeRecording();
  } catch (error) {
    finalizeRecording();
  }
  clearTimeout(state.finalizedFallback);
  state.finalizedFallback = setTimeout(() => finalizeRecording(), 2500);
}

function finalizeRecording() {
  if (state.finalized) return;
  state.finalized = true;
  clearTimeout(state.finalizedFallback);

  const canceled = state.cancelRequested;
  const chunks = state.chunks;
  const mime = state.recordMime || caps.mime;
  const elapsed = state.elapsed;
  const audioDetected = state.audioDetected;
  const audioCount = state.outputAudioCount;

  state.chunks = [];
  state.cancelRequested = false;
  state.recorder = null;

  cleanupAudio();
  stopComposition();
  releaseCaptureStreams();
  clearInterval(state.timerId);
  clearInterval(state.levelId);

  if (canceled) {
    resetToIdle('Recording discarded. No file was created.');
    return;
  }

  if (!chunks.length) {
    resetToIdle();
    showError('No recording data was produced. The browser may have stopped the capture before any frames arrived. Try again or choose a smaller resolution.');
    return;
  }

  const blob = new Blob(chunks, { type: mime });
  if (!blob.size) {
    resetToIdle();
    showError('The recording file is empty. This can happen if screen sharing stopped immediately. Try again.');
    return;
  }

  const ext = caps.ext;
  const name = filenameFor(ext);
  const url = URL.createObjectURL(blob);
  const result = {
    blob,
    url,
    name,
    mime,
    formatLabel: caps.label,
    durationHint: elapsed,
    width: 0,
    height: 0,
    hasAudio: audioCount > 0,
    audioDetected,
    measured: false
  };
  state.result = result;
  showResult(result);
  setPhase('ready');
  els.resultNote.hidden = false;
  if (result.hasAudio && !audioDetected) {
    els.resultNote.textContent = 'An audio track is included, but no sound was detected while recording. Check that the source was unmuted.';
  } else {
    els.resultNote.textContent = 'Saved locally in this tab. Nothing was uploaded.';
  }
}

function releaseCaptureStreams() {
  stopStream(state.displayStream);
  if (state.displayStream) {
    for (const track of state.displayStream.getTracks()) {
      track.onended = null;
    }
  }
  stopStream(state.micStream);
  stopStream(state.webcamStream);
  state.displayStream = null;
  state.micStream = null;
  state.webcamStream = null;
  state.displayVideo = null;

  els.screen.srcObject = null;
  els.screen.hidden = true;
  els.webcamPreviewVideo.srcObject = null;
  els.webcamPreview.hidden = true;
  els.placeholder.hidden = false;
  els.stage.classList.remove('has-stream');
  state.outputAudioCount = 0;
  state.captured = '';
  state.measuredFps = 0;
  updateCapturedLine();
}

function cleanupAudio() {
  if (state.mixDestination) {
    stopStream(state.mixDestination.stream);
  }
  if (state.audioContext) {
    try {
      state.audioContext.close();
    } catch (error) {
      /* already closed */
    }
  }
  state.audioContext = null;
  state.mixDestination = null;
  state.micGain = null;
  state.systemGain = null;
  state.analyser = null;
  state.audioBuffer = null;
  if (els.levelBar) els.levelBar.style.width = '0%';
}

function cleanupAfterFailure() {
  cleanupAudio();
  stopComposition();
  releaseCaptureStreams();
  clearInterval(state.timerId);
  clearInterval(state.levelId);
}

/* ------------------------------------------------------------------ */
/* Result, result actions and downloads                               */
/* ------------------------------------------------------------------ */

function showResult(result) {
  els.result.hidden = false;
  els.resultName.textContent = result.name;
  els.resultFormat.textContent = result.formatLabel;
  els.resultDuration.textContent = formatClock(result.durationHint * 1000);
  els.resultSize.textContent = formatBytes(result.blob.size);
  els.resultResolution.textContent = 'Reading…';
  els.resultAudio.textContent = result.hasAudio
    ? result.audioDetected
      ? 'Included · sound detected'
      : 'Included · no sound detected'
    : 'None';
  els.download.href = result.url;
  els.download.download = result.name;
  els.download.setAttribute('aria-disabled', 'false');
  els.resultVideo.src = result.url;
  els.resultVideo.load();

  const measure = async () => {
    const duration = await readVideoDuration(els.resultVideo, result.durationHint);
    result.duration = duration;
    result.width = els.resultVideo.videoWidth || result.width;
    result.height = els.resultVideo.videoHeight || result.height;
    els.resultDuration.textContent = formatClock((duration || result.durationHint) * 1000);
    els.resultResolution.textContent = result.width && result.height
      ? `${result.width} × ${result.height}`
      : 'Not reported';
  };
  els.resultVideo.onloadedmetadata = () => {
    measure();
  };
  setTimeout(measure, 600);
}

async function readVideoDuration(video, fallback) {
  try {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    /* MediaRecorder WebM files often report Infinity until the browser seeks
       to the end. Seek far past the end, then read the real duration. */
    if (video.duration === Infinity) {
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('seeked', done);
          resolve();
        };
        video.addEventListener('seeked', done, { once: true });
        video.currentTime = 1e7;
        setTimeout(done, 1200);
      });
      const measured = video.duration;
      video.currentTime = 0;
      if (Number.isFinite(measured) && measured > 0) return measured;
    }
  } catch (error) {
    /* fall through to the timer value */
  }
  return fallback;
}

function filenameFor(ext) {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `letitedit-screen-recording-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.${ext}`;
}

function discardResult() {
  if (state.result && state.result.url) {
    URL.revokeObjectURL(state.result.url);
  }
  state.result = null;
  els.result.hidden = true;
  els.resultVideo.pause();
  els.resultVideo.removeAttribute('src');
  els.resultVideo.load();
  els.download.removeAttribute('href');
  els.download.removeAttribute('download');
  els.download.setAttribute('aria-disabled', 'true');
}

function resetToIdle(message = '') {
  stopComposition();
  releaseCaptureStreams();
  cleanupAudio();
  clearInterval(state.timerId);
  clearInterval(state.levelId);
  state.elapsed = 0;
  state.micMuted = false;
  state.audioDetected = false;
  state.finalized = false;
  state.starting = false;
  els.timer.textContent = '00:00';
  els.mute.textContent = 'Mute mic';
  els.mute.setAttribute('aria-pressed', 'false');
  setPhase('idle');
  if (message) showNotice(message);
}

function recordAgain() {
  discardResult();
  resetToIdle();
  els.start.focus();
}

function beforeUnload(event) {
  if (!isActive()) return;
  event.preventDefault();
  event.returnValue = '';
}

/* ------------------------------------------------------------------ */
/* Devices                                                            */
/* ------------------------------------------------------------------ */

async function refreshDevices() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (error) {
    return;
  }
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  const previous = els.micDevice.value;
  els.micDevice.innerHTML = '';
  const fallback = document.createElement('option');
  fallback.value = '';
  fallback.textContent = 'Default microphone';
  els.micDevice.appendChild(fallback);
  microphones.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    els.micDevice.appendChild(option);
  });
  if (previous && microphones.some((device) => device.deviceId === previous)) {
    els.micDevice.value = previous;
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function wire() {
  els.start.addEventListener('click', () => {
    startRecording();
  });
  els.pause.addEventListener('click', pauseRecording);
  els.resume.addEventListener('click', resumeRecording);
  els.stop.addEventListener('click', () => stopRecording('user'));
  els.cancel.addEventListener('click', cancelRecording);
  els.mute.addEventListener('click', toggleMicMute);
  els.again.addEventListener('click', recordAgain);
  els.discard.addEventListener('click', recordAgain);

  els.webcam.addEventListener('change', async () => {
    if (state.phase !== 'idle') return;
    if (els.webcam.checked) {
      await ensureWebcam();
    } else {
      releaseWebcam();
    }
    applyWebcamPreview();
  });

  for (const button of els.positions) {
    button.addEventListener('click', () => setPosition(button.dataset.position));
  }

  els.webcamSize.addEventListener('input', () => {
    els.webcamSizeLabel.textContent = `${Math.round(Number(els.webcamSize.value))}% of frame height`;
    applyWebcamPreview();
  });
  els.webcamShape.addEventListener('change', applyWebcamPreview);
  els.micVolume.addEventListener('input', () => {
    const percent = Math.round(Number(els.micVolume.value));
    els.micVolumeLabel.textContent = `${percent}%`;
    if (state.micGain && !state.micMuted) {
      state.micGain.gain.value = clamp(percent / 100, 0, 1);
    }
  });

  els.download.addEventListener('click', (event) => {
    if (!state.result) {
      event.preventDefault();
      showError('There is no finished recording to download yet.');
    }
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  }

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => applyWebcamPreview());
    observer.observe(els.stage);
  } else {
    window.addEventListener('resize', applyWebcamPreview);
  }

  window.addEventListener('pagehide', () => {
    if (state.result && state.result.url) URL.revokeObjectURL(state.result.url);
    stopComposition();
    releaseCaptureStreams();
    cleanupAudio();
  });

  setPosition(activePosition() || 'top-right');
  els.webcamSizeLabel.textContent = `${Math.round(Number(els.webcamSize.value))}% of frame height`;
  els.micVolumeLabel.textContent = `${Math.round(Number(els.micVolume.value))}%`;
  applyWebcamPreview();
}

function toggleMicMute() {
  if (!state.micStream) return;
  state.micMuted = !state.micMuted;
  for (const track of state.micStream.getAudioTracks()) {
    track.enabled = !state.micMuted;
  }
  if (state.micGain) {
    state.micGain.gain.value = state.micMuted ? 0 : state.settings ? state.settings.micVolume : 1;
  }
  els.mute.textContent = state.micMuted ? 'Unmute mic' : 'Mute mic';
  els.mute.setAttribute('aria-pressed', String(state.micMuted));
  refreshStatus();
}

/* ------------------------------------------------------------------ */
/* Public read-only debug surface (used by the automated tests)       */
/* ------------------------------------------------------------------ */

function exposeDebug() {
  window.__SR__ = {
    state: () => state.phase,
    debug: () => ({
      state: state.phase,
      capabilities: { ...caps },
      mimeType: state.recordMime || caps.mime,
      format: state.formatLabel || caps.label,
      chunks: state.chunks.length,
      tracks: {
        display: state.displayStream ? state.displayStream.getTracks().map((track) => track.readyState) : [],
        mic: state.micStream ? state.micStream.getTracks().map((track) => track.readyState) : [],
        webcam: state.webcamStream ? state.webcamStream.getTracks().map((track) => track.readyState) : []
      },
      audioTracks: state.outputAudioCount,
      audioDetected: state.audioDetected,
      captured: state.captured,
      measuredFps: state.measuredFps,
      result: state.result
        ? {
            size: state.result.blob.size,
            mime: state.result.mime,
            name: state.result.name,
            duration: state.result.duration || state.result.durationHint,
            width: state.result.width,
            height: state.result.height,
            hasAudio: state.result.hasAudio,
            audioDetected: state.result.audioDetected
          }
        : null
    })
  };
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

detectCapabilities();
wire();
exposeDebug();
setPhase('idle');
refreshDevices();
els.formatNote.hidden = false;
