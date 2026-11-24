/* LetitEdit editor V3 — genuine MediaRecorder capture for audio, camera,
 * screen and a composited screen + camera mode. Unsupported modes are
 * disabled with a truthful explanation rather than simulated.
 */

import { escapeHtml, formatTime, toast } from './dom.js';

const MIME_CANDIDATES = {
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
  video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
};

function supportedMime(kind) {
  if (!window.MediaRecorder) return '';
  return MIME_CANDIDATES[kind].find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
}

function extensionFor(mime, kind) {
  if (mime.includes('mp4')) return kind === 'audio' ? 'm4a' : 'mp4';
  if (kind === 'audio') return 'webm';
  return 'webm';
}

export class Recorder {
  constructor({ store, media, onAdded, onStatus, onEdit }) {
    this.store = store;
    this.media = media;
    this.onAdded = onAdded || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onEdit = onEdit || (() => {});
    this.container = null;
    this.mode = 'audio';
    this.status = 'idle';
    this.error = '';
    this.stream = null;
    this.screenStream = null;
    this.cameraStream = null;
    this.recorder = null;
    this.chunks = [];
    this.blob = null;
    this.url = '';
    this.assetId = '';
    this.assetName = '';
    this.timer = 0;
    this.startedAt = 0;
    this.elapsed = 0;
    this.countdown = 0;
    this.countdownTimer = 0;
    this.devices = { audioinput: [], videoinput: [] };
    this.selected = { audioinput: '', videoinput: '' };
    this.previewAnimation = 0;
    this.canvas = null;
    this.canvasStream = null;
    this.audioContext = null;
    this.hiddenVideos = [];
  }

  isActive() {
    return ['requesting', 'countdown', 'recording', 'paused'].includes(this.status);
  }

  support() {
    const hasRecorder = Boolean(window.MediaRecorder);
    const mediaDevices = navigator.mediaDevices || {};
    return {
      audio: hasRecorder && typeof mediaDevices.getUserMedia === 'function',
      camera: hasRecorder && typeof mediaDevices.getUserMedia === 'function',
      screen: hasRecorder && typeof mediaDevices.getDisplayMedia === 'function',
      'screen-camera': hasRecorder && typeof mediaDevices.getDisplayMedia === 'function' && typeof mediaDevices.getUserMedia === 'function'
    };
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.devices = { audioinput: [], videoinput: [] };
      this.render();
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = {
        audioinput: all.filter((device) => device.kind === 'audioinput'),
        videoinput: all.filter((device) => device.kind === 'videoinput')
      };
      if (!this.selected.audioinput) this.selected.audioinput = this.devices.audioinput[0]?.deviceId || '';
      if (!this.selected.videoinput) this.selected.videoinput = this.devices.videoinput[0]?.deviceId || '';
    } catch (error) {
      this.devices = { audioinput: [], videoinput: [] };
    }
    this.render();
  }

  mountInto(container) {
    this.container = container;
    this.render();
    if (!this.devices.audioinput.length && !this.devices.videoinput.length && !this._enumerated) {
      this._enumerated = true;
      this.refreshDevices();
    }
  }

  render() {
    if (!this.container) return;
    const support = this.support();
    const modeSupported = support[this.mode];
    const modeLabels = {
      audio: 'Voice',
      camera: 'Camera',
      screen: 'Screen',
      'screen-camera': 'Screen + camera'
    };
    const isStopped = this.status === 'stopped' && this.blob;
    this.container.innerHTML = `
      <div class="ve-record">
        <div class="ve-record-modes" role="tablist" aria-label="Recording mode">
          ${Object.entries(modeLabels).map(([id, label]) => `<button type="button" role="tab" class="ve-record-mode ${this.mode === id ? 'is-on' : ''}" data-record-mode="${id}" aria-selected="${this.mode === id}" ${support[id] ? '' : 'disabled title="This mode is not supported by this browser"'}><span aria-hidden="true">${id === 'audio' ? '●' : id === 'camera' ? '▣' : id === 'screen' ? '▤' : '◫'}</span>${label}</button>`).join('')}
        </div>
        ${!modeSupported ? `<div class="ve-notice ve-notice-warn"><strong>This mode is unavailable.</strong><span>${this.mode === 'screen' || this.mode === 'screen-camera' ? 'Screen capture is not exposed by this browser. Mobile Safari and some embedded browsers do not support it.' : 'This browser does not expose MediaRecorder or microphone/camera capture.'}</span></div>` : ''}
        ${this.status === 'idle' || this.status === 'error' ? this.idleMarkup() : ''}
        ${this.status === 'countdown' ? `<div class="ve-record-live"><div class="ve-countdown" aria-live="assertive">${this.countdown}</div><p>Recording starts in ${this.countdown}…</p><button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-record-action="cancel">Cancel</button></div>` : ''}
        ${['recording', 'paused', 'requesting'].includes(this.status) ? this.liveMarkup() : ''}
        ${isStopped ? this.resultMarkup() : ''}
        ${this.error ? `<p class="ve-alert ve-alert-error" role="alert">${escapeHtml(this.error)}</p>` : ''}
        <div class="ve-record-help">
          <p>Recording uses your browser's own capture APIs. Nothing is uploaded. Screen and camera recordings can contain private information — review before exporting.</p>
          <p>${this.mode === 'screen-camera' ? 'Screen and camera are composited into one picture on this device.' : 'The selected microphone or camera stops when you finish or retake.'}</p>
        </div>
      </div>`;
    this.container.onclick = (event) => this.onClick(event);
    this.container.onchange = (event) => this.onChange(event);
    if (this.status === 'recording' || this.status === 'paused' || this.status === 'requesting') this.attachPreview();
  }

  idleMarkup() {
    const showAudio = this.mode !== 'screen' && this.mode !== 'camera' || this.mode === 'camera';
    const showVideo = this.mode === 'camera';
    return `<div class="ve-record-setup">
      ${showAudio ? `<label class="ve-field"><span>Microphone</span><select data-record-device="audioinput">${this.deviceOptions('audioinput')}</select></label>` : ''}
      ${showVideo ? `<label class="ve-field"><span>Camera</span><select data-record-device="videoinput">${this.deviceOptions('videoinput')}</select></label>` : ''}
      ${this.mode === 'screen' || this.mode === 'screen-camera' ? '<p class="ve-micro">Your browser will ask which screen or window to share. System audio is included only when the picker offers it.</p>' : ''}
      ${this.mode === 'audio' ? '<p class="ve-micro">Voice recordings become audio files in your media library. Microphone permission is requested only when you start.</p>' : ''}
      <button type="button" class="ve-record-start" data-record-action="start" ${this.support()[this.mode] ? '' : 'disabled'}>
        <span class="ve-record-dot" aria-hidden="true"></span>Start ${this.mode === 'audio' ? 'recording' : this.mode.replace('-', ' + ') + ' recording'}
      </button>
      ${this.blob && this.status === 'error' ? '<button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-record-action="retake">Clear recording</button>' : ''}
    </div>`;
  }

  deviceOptions(kind) {
    const devices = this.devices[kind] || [];
    if (!devices.length) return `<option value="">Default ${kind === 'audioinput' ? 'microphone' : 'camera'}</option>`;
    return devices.map((device, index) => `<option value="${escapeHtml(device.deviceId)}" ${this.selected[kind] === device.deviceId ? 'selected' : ''}>${escapeHtml(device.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${index + 1}`)}</option>`).join('');
  }

  liveMarkup() {
    return `<div class="ve-record-live">
      <div class="ve-record-preview"><video data-record-live-preview muted playsinline></video><div class="ve-record-preview-badge"><span class="${this.status === 'paused' ? '' : 'is-live'}"></span>${this.status === 'paused' ? 'Paused' : this.status === 'requesting' ? 'Waiting for permission' : 'Recording'}</div></div>
      <div class="ve-record-status"><strong data-record-elapsed>${formatTime(this.elapsed)}</strong><span>${this.mode === 'audio' ? 'Audio' : 'Video'} · local recording</span></div>
      <div class="ve-record-actions">
        ${this.status === 'recording' ? '<button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-record-action="pause">Pause</button>' : ''}
        ${this.status === 'paused' ? '<button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-record-action="resume">Resume</button>' : ''}
        <button type="button" class="ve-btn ve-btn-danger ve-btn-sm" data-record-action="stop" ${this.status === 'recording' || this.status === 'paused' ? '' : 'disabled'}>Stop</button>
      </div>
    </div>`;
  }

  resultMarkup() {
    const kind = this.mode === 'audio' ? 'audio' : 'video';
    return `<div class="ve-record-result">
      <div class="ve-record-preview">
        ${kind === 'audio' ? `<audio src="${this.url}" controls preload="metadata"></audio>` : `<video src="${this.url}" controls playsinline preload="metadata"></video>`}
      </div>
      <div class="ve-grid-2">
        <label class="ve-field"><span>Name</span><input type="text" data-record-name value="${escapeHtml(this.assetName)}" maxlength="80"></label>
        <label class="ve-field"><span>Length</span><output class="ve-readout">${formatTime(this.elapsed)}</output></label>
      </div>
      <div class="ve-record-actions ve-wrap">
        <button type="button" class="ve-btn ve-btn-primary ve-btn-sm" data-record-action="add">Add to media</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-record-action="add-timeline">Add to timeline</button>
        <button type="button" class="ve-btn ve-btn-ghost ve-btn-sm" data-record-action="retake">Retake</button>
      </div>
      <p class="ve-micro">${this.assetId ? 'Saved in your local media library.' : 'Review the take, rename it, then add it to the library.'}</p>
    </div>`;
  }

  async onClick(event) {
    const mode = event.target.closest('[data-record-mode]');
    if (mode) {
      if (this.isActive()) {
        toast('Finish or cancel the current recording before switching modes.', 'warn');
        return;
      }
      this.mode = mode.dataset.recordMode;
      this.error = '';
      if (this.status === 'stopped') this.resetTake();
      this.render();
      return;
    }
    const action = event.target.closest('[data-record-action]');
    if (!action) return;
    const name = action.dataset.recordAction;
    if (name === 'start') this.start();
    else if (name === 'pause') this.pause();
    else if (name === 'resume') this.resume();
    else if (name === 'stop') this.stop();
    else if (name === 'cancel') this.cancelCountdown();
    else if (name === 'retake') this.retake();
    else if (name === 'add') this.addToLibrary(false);
    else if (name === 'add-timeline') this.addToLibrary(true);
  }

  onChange(event) {
    const device = event.target.closest('[data-record-device]');
    if (device) {
      this.selected[device.dataset.recordDevice] = device.value;
      return;
    }
    const name = event.target.closest('[data-record-name]');
    if (name) this.assetName = name.value.trim().slice(0, 80) || this.assetName;
  }

  async start() {
    if (this.isActive()) return;
    this.error = '';
    if (!this.support()[this.mode]) {
      this.error = 'This recording mode is not supported by this browser.';
      this.render();
      return;
    }
    this.status = 'requesting';
    this.render();
    try {
      await this.openStreams();
      this.status = 'countdown';
      this.countdown = 3;
      this.render();
      this.countdownTimer = setInterval(() => {
        this.countdown -= 1;
        if (this.countdown <= 0) {
          clearInterval(this.countdownTimer);
          this.beginRecorder();
        } else {
          const node = this.container?.querySelector('.ve-countdown');
          if (node) node.textContent = String(this.countdown);
        }
      }, 1000);
    } catch (error) {
      this.releaseStreams();
      this.status = 'error';
      this.error = this.explain(error);
      this.render();
      this.onStatus(this.error, 'error');
    }
  }

  async openStreams() {
    const selectedAudio = this.selected.audioinput
      ? { deviceId: { exact: this.selected.audioinput } }
      : true;
    const selectedVideo = this.selected.videoinput
      ? { deviceId: { exact: this.selected.videoinput } }
      : true;
    if (this.mode === 'audio') {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: selectedAudio, video: false });
      return;
    }
    if (this.mode === 'camera') {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: selectedVideo });
      return;
    }
    if (this.mode === 'screen') {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.stream = this.screenStream;
      return;
    }
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    this.cameraStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: selectedVideo });
    this.stream = await this.composeScreenAndCamera(this.screenStream, this.cameraStream);
  }

  async composeScreenAndCamera(screenStream, cameraStream) {
    const screen = document.createElement('video');
    screen.muted = true;
    screen.playsInline = true;
    screen.srcObject = screenStream;
    await screen.play().catch(() => {});
    const camera = document.createElement('video');
    camera.muted = true;
    camera.playsInline = true;
    camera.srcObject = cameraStream;
    await camera.play().catch(() => {});
    this.hiddenVideos = [screen, camera];
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      if (!this.canvas) return;
      const sw = screen.videoWidth || 1280;
      const sh = screen.videoHeight || 720;
      const scale = Math.max(canvas.width / sw, canvas.height / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(screen, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      if (camera.videoWidth) {
        const pw = Math.round(canvas.width * 0.23);
        const ph = Math.round(pw * (camera.videoHeight / camera.videoWidth || 0.75));
        const px = canvas.width - pw - 28;
        const py = canvas.height - ph - 28;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#000000';
        ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
        ctx.drawImage(camera, px, py, pw, ph);
        ctx.restore();
      }
      this.previewAnimation = requestAnimationFrame(draw);
    };
    draw();
    this.canvasStream = canvas.captureStream(30);
    const out = new MediaStream();
    for (const track of this.canvasStream.getVideoTracks()) out.addTrack(track);
    const audioTracks = [];
    for (const stream of [screenStream, cameraStream]) {
      for (const track of stream.getAudioTracks()) if (!audioTracks.some((item) => item.id === track.id)) audioTracks.push(track);
    }
    if (audioTracks.length) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new Ctx();
        const destination = this.audioContext.createMediaStreamDestination();
        for (const track of audioTracks) {
          const source = this.audioContext.createMediaStreamSource(new MediaStream([track]));
          source.connect(destination);
        }
        for (const track of destination.stream.getAudioTracks()) out.addTrack(track);
      } catch {
        for (const track of audioTracks) out.addTrack(track);
      }
    }
    return out;
  }

  beginRecorder() {
    if (!this.stream) {
      this.status = 'error';
      this.error = 'The capture stream ended before recording started.';
      this.render();
      return;
    }
    const kind = this.mode === 'audio' ? 'audio' : 'video';
    const mime = supportedMime(kind);
    try {
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    } catch (error) {
      this.status = 'error';
      this.error = `MediaRecorder could not start: ${error.message || error}`;
      this.releaseStreams();
      this.render();
      return;
    }
    this.chunks = [];
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size) this.chunks.push(event.data);
    });
    this.recorder.addEventListener('error', (event) => {
      this.status = 'error';
      this.error = `Recording stopped unexpectedly: ${event.error?.message || event.error || 'unknown error'}`;
      this.releaseStreams();
      this.render();
    });
    this.recorder.addEventListener('stop', () => this.finishTake());
    this.recorder.start(1000);
    this.status = 'recording';
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.render();
    this.timer = setInterval(() => {
      if (this.status !== 'recording') return;
      this.elapsed = (performance.now() - this.startedAt) / 1000;
      const node = this.container?.querySelector('[data-record-elapsed]');
      if (node) node.textContent = formatTime(this.elapsed);
    }, 250);
  }

  async attachPreview() {
    const video = this.container?.querySelector('[data-record-live-preview]');
    if (!video) return;
    if (this.canvasStream) {
      video.srcObject = this.canvasStream;
    } else if (this.stream?.getVideoTracks?.().length) {
      video.srcObject = this.stream;
    } else if (this.screenStream?.getVideoTracks?.().length) {
      video.srcObject = this.screenStream;
    } else {
      video.hidden = true;
    }
    if (!video.hidden) await video.play().catch(() => {});
  }

  pause() {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause();
      this.status = 'paused';
      this.elapsed = (performance.now() - this.startedAt) / 1000;
      this.render();
    }
  }

  resume() {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume();
      this.status = 'recording';
      this.startedAt = performance.now() - this.elapsed * 1000;
      this.render();
    }
  }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch (error) {
        this.error = `The recording could not be stopped cleanly: ${error.message || error}`;
      }
    } else {
      this.finishTake();
    }
  }

  finishTake() {
    clearInterval(this.timer);
    clearInterval(this.countdownTimer);
    cancelAnimationFrame(this.previewAnimation);
    this.releaseStreams();
    if (!this.chunks.length) {
      this.status = 'error';
      this.error = 'The recorder produced no data. Try a shorter take or another mode.';
      this.render();
      return;
    }
    const kind = this.mode === 'audio' ? 'audio' : 'video';
    const mime = this.recorder?.mimeType || supportedMime(kind) || (kind === 'audio' ? 'audio/webm' : 'video/webm');
    this.blob = new Blob(this.chunks, { type: mime });
    this.url = URL.createObjectURL(this.blob);
    this.assetName = `${this.mode === 'audio' ? 'Voice recording' : this.mode === 'camera' ? 'Camera recording' : 'Screen recording'} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    this.status = 'stopped';
    this.error = '';
    this.render();
    this.onStatus('Recording finished. Review it and add it to your media.', 'success');
  }

  async addToLibrary(toTimeline) {
    if (!this.blob) return;
    if (this.assetId) {
      const asset = this.media.get(this.assetId);
      if (asset) {
        if (toTimeline) this.onAdded(asset, true);
        else this.onStatus('This recording is already in your media library.', 'info');
      }
      return;
    }
    const kind = this.mode === 'audio' ? 'audio' : 'video';
    const ext = extensionFor(this.blob.type, kind);
    const rawName = this.assetName.trim() || 'Recording';
    const name = /\.[a-z0-9]+$/i.test(rawName) ? rawName : `${rawName}.${ext}`;
    try {
      const file = new File([this.blob], name, { type: this.blob.type });
      const asset = await this.media.addFile(file);
      this.assetId = asset.id;
      this.assetName = asset.name;
      this.render();
      this.onAdded(asset, Boolean(toTimeline));
      this.onStatus(`Added ${asset.name} to your media.`, 'success');
    } catch (error) {
      this.error = error.message || String(error);
      this.render();
      this.onStatus(this.error, 'error');
    }
  }

  retake() {
    this.releaseStreams();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    this.blob = null;
    this.chunks = [];
    this.assetId = '';
    this.elapsed = 0;
    this.status = 'idle';
    this.error = '';
    this.render();
  }

  cancelCountdown() {
    clearInterval(this.countdownTimer);
    this.releaseStreams();
    this.status = 'idle';
    this.countdown = 0;
    this.render();
  }

  releaseStreams() {
    clearInterval(this.timer);
    cancelAnimationFrame(this.previewAnimation);
    for (const track of this.stream?.getTracks?.() || []) {
      try { track.stop(); } catch { /* ignore */ }
    }
    for (const track of this.screenStream?.getTracks?.() || []) {
      try { track.stop(); } catch { /* ignore */ }
    }
    for (const track of this.cameraStream?.getTracks?.() || []) {
      try { track.stop(); } catch { /* ignore */ }
    }
    this.canvasStream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch { /* ignore */ }
    });
    this.audioContext?.close?.().catch?.(() => {});
    for (const video of this.hiddenVideos) {
      try { video.pause(); video.srcObject = null; } catch { /* ignore */ }
    }
    this.hiddenVideos = [];
    this.stream = null;
    this.screenStream = null;
    this.cameraStream = null;
    this.canvasStream = null;
    this.canvas = null;
    this.audioContext = null;
  }

  explain(error) {
    const name = error?.name || '';
    if (name === 'NotAllowedError') return 'Permission was denied. Allow microphone, camera or screen access in your browser, then try again.';
    if (name === 'NotFoundError') return 'No matching microphone or camera was found on this device.';
    if (name === 'NotReadableError') return 'The selected device is busy in another app or tab.';
    if (name === 'OverconstrainedError') return 'The selected device could not satisfy the requested settings. Choose another device.';
    if (name === 'AbortError') return 'The screen share was cancelled before recording began.';
    if (name === 'TypeError') return 'This browser cannot combine screen and camera capture in this context. Try Screen or Camera separately.';
    return error?.message || String(error);
  }

  dispose() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* ignore */ }
    }
    this.releaseStreams();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
  }
}
