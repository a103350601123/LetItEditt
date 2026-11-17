/* Export: real-time canvas + audio capture to MP4 / WebM */
(function () {
  const VE = (window.VE = window.VE || {});

  const FORMATS = [
    {
      id: 'mp4', label: 'MP4 · H.264',
      mimes: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'],
      ext: 'mp4'
    },
    {
      id: 'webm', label: 'WebM · VP9',
      mimes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'],
      ext: 'webm'
    }
  ];

  function detectFormats() {
    if (typeof MediaRecorder === 'undefined') return [];
    return FORMATS.map(f => {
      const mime = f.mimes.find(m => MediaRecorder.isTypeSupported(m)) || null;
      return { ...f, mime };
    });
  }

  function bitrateFor(width, height, fps, quality) {
    const base = width * height * fps * 0.055;
    const factor = 0.5 + quality / 100;
    return Math.round(VE.clamp(base * factor, 1_200_000, 48_000_000));
  }

  const Exporter = {
    app: null,
    active: null,

    open(app) {
      this.app = app;
      const project = app.state.project;
      if (!project) return;
      const duration = VE.projectDuration(project);
      if (duration <= 0.05) {
        VE.toast('Add something to the timeline before exporting', 'warn');
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        VE.toast('This browser does not support in-browser video recording. Try Chrome or Edge.', 'error');
        return;
      }

      const formats = detectFormats();
      const chosen = formats.find(f => f.mime) || null;
      if (!chosen) {
        VE.toast('Your browser cannot record MP4 or WebM here. Try Chrome or Edge.', 'error');
        return;
      }

      const body = document.createElement('div');
      const grid = document.createElement('div');
      grid.className = 'export-grid';

      const art = document.createElement('div');
      art.className = 'export-art';
      const pv = document.createElement('canvas');
      const dims = VE.dimsForAspect(project.aspect, 360);
      pv.width = dims.w; pv.height = dims.h;
      art.appendChild(pv);
      const tag = document.createElement('span');
      tag.className = 'ratio-tag';
      tag.textContent = project.aspect + ' · ' + VE.fmtClock(duration);
      art.appendChild(tag);

      try {
        app.renderer.draw(pv.getContext('2d'), project, Math.min(app.state.time, Math.max(0, duration - 0.04)), app.state.assets);
      } catch (e) { /* preview optional */ }

      const fields = document.createElement('div');

      const formatRow = document.createElement('div');
      formatRow.className = 'form-row';
      formatRow.innerHTML = '<label>Format</label>';
      const formatSel = document.createElement('select');
      formatSel.className = 'select';
      formats.forEach(f => {
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = f.label + (f.mime ? '' : ' (unsupported)');
        o.disabled = !f.mime;
        formatSel.appendChild(o);
      });
      formatSel.value = chosen.id;
      formatRow.appendChild(formatSel);

      const resRow = document.createElement('div');
      resRow.className = 'form-row';
      resRow.innerHTML = '<label>Resolution</label>';
      const resSel = document.createElement('select');
      resSel.className = 'select';
      VE.RESOLUTIONS.forEach(r => {
        const o = document.createElement('option');
        o.value = String(r.short);
        o.textContent = r.name;
        if (r.short === 1080) o.selected = true;
        resSel.appendChild(o);
      });
      resRow.appendChild(resSel);

      const fpsRow = document.createElement('div');
      fpsRow.className = 'form-row';
      fpsRow.innerHTML = '<label>Frame rate</label>';
      const fpsSel = document.createElement('select');
      fpsSel.className = 'select';
      [24, 30, 60].forEach((f, i) => {
        const o = document.createElement('option');
        o.value = String(f);
        o.textContent = f + ' fps';
        if (i === 1) o.selected = true;
        fpsSel.appendChild(o);
      });
      fpsRow.appendChild(fpsSel);

      const qualityRow = document.createElement('div');
      qualityRow.className = 'form-row';
      qualityRow.innerHTML = '<label>Quality</label>';
      const quality = document.createElement('input');
      quality.type = 'range';
      quality.min = '10'; quality.max = '100'; quality.value = '72';
      qualityRow.appendChild(quality);

      const estimate = document.createElement('div');
      estimate.className = 'estimate';

      fields.append(formatRow, resRow, fpsRow, qualityRow, estimate);
      grid.append(art, fields);
      body.appendChild(grid);

      const progressWrap = document.createElement('div');
      progressWrap.className = 'progress-wrap hidden';
      progressWrap.innerHTML = `<div class="progress-track"><div class="progress-bar"></div></div>
        <div class="progress-meta"><span class="left">Preparing…</span><b class="right">0%</b></div>
        <p class="insp-note" style="margin-top:10px">Export runs in real time in this tab. Keep the window visible until it finishes.</p>`;
      body.appendChild(progressWrap);

      const footer = document.createElement('div');
      footer.className = 'btn-row';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn ghost';
      cancelBtn.textContent = 'Cancel';
      const startBtn = document.createElement('button');
      startBtn.className = 'btn primary';
      startBtn.innerHTML = VE.icon('download') + '<span>Start export</span>';
      footer.append(cancelBtn, startBtn);

      const modal = VE.openModal({
        title: 'Export video',
        body,
        footer,
        wide: true,
        onClose: () => {
          if (this.active && !this.active.finishing) this.cancel();
        }
      });

      const updateEstimate = () => {
        const short = Number(resSel.value);
        const d = VE.dimsForAspect(project.aspect, short);
        const fps = Number(fpsSel.value);
        const rate = bitrateFor(d.w, d.h, fps, Number(quality.value));
        const bytes = (rate + 128000) / 8 * duration;
        estimate.innerHTML = `Canvas <b>${d.w} × ${d.h}</b><br>
          Video bitrate <b>${(rate / 1e6).toFixed(1)} Mbps</b><br>
          Estimated file <b>~${VE.formatBytes(bytes)}</b><br>
          Duration <b>${VE.fmtClock(duration)}</b>`;
        if (d.w > 4096) estimate.innerHTML += '<br><span style="color:var(--warn)">Very wide canvas — encoding may fail on some devices.</span>';
      };
      updateEstimate();
      [formatSel, resSel, fpsSel, quality].forEach(el => el.addEventListener('input', updateEstimate));

      const setBusy = (busy) => {
        startBtn.disabled = busy;
        formatSel.disabled = busy;
        resSel.disabled = busy;
        fpsSel.disabled = busy;
        quality.disabled = busy;
        startBtn.textContent = busy ? 'Rendering…' : 'Start export';
      };

      startBtn.addEventListener('click', () => {
        const format = formats.find(f => f.id === formatSel.value);
        if (!format || !format.mime) {
          VE.toast('That format is not supported by this browser', 'error');
          return;
        }
        const short = Number(resSel.value);
        const d = VE.dimsForAspect(project.aspect, short);
        const fps = Number(fpsSel.value);
        const rate = bitrateFor(d.w, d.h, fps, Number(quality.value));
        this.start({
          app, duration, format, width: d.w, height: d.h, fps, rate,
          progressWrap, startBtn, cancelBtn, setBusy, modal, body
        });
      });

      cancelBtn.addEventListener('click', () => {
        if (this.active && !this.active.finishing) this.cancel();
        else modal.close();
      });

      this.ui = { modal, progressWrap, startBtn, cancelBtn, body };
    },

    async start(cfg) {
      const { app, duration, format, width, height, fps, rate } = cfg;
      app.pause();
      app.seek(0);
      const prevLoop = app.state.loop;
      app.state.loop = false;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = app.state.project.background || '#000';
      ctx.fillRect(0, 0, width, height);

      const stream = canvas.captureStream(fps);
      let dest = null;
      const audio = app.renderer.ensureAudio();
      if (audio) {
        try {
          await audio.ctx.resume();
          dest = audio.ctx.createMediaStreamDestination();
          audio.master.connect(dest);
          if (dest.stream.getAudioTracks().length) stream.addTrack(dest.stream.getAudioTracks()[0]);
        } catch (err) {
          console.warn('Audio capture unavailable', err);
          dest = null;
        }
      }

      const ex = {
        app, canvas, ctx, stream, dest, format, duration, width, height, fps, rate,
        recorder: null, chunks: [], finishing: false, cancelled: false, prevLoop,
        startedAt: performance.now(), ui: cfg
      };
      this.active = ex;
      app.state.exporting = ex;

      try {
        ex.recorder = new MediaRecorder(stream, {
          mimeType: format.mime,
          videoBitsPerSecond: rate,
          audioBitsPerSecond: 160000
        });
      } catch (err) {
        this.cleanup(true);
        this.fail('Could not start the recorder: ' + err.message);
        return;
      }

      ex.recorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size) ex.chunks.push(e.data);
      });
      ex.recorder.addEventListener('error', (e) => {
        console.error('Recorder error', e);
        this.fail('Recording failed. Try a lower resolution.');
      });
      ex.recorder.addEventListener('stop', () => this.complete());

      ex.recorder.start(250);
      cfg.progressWrap.classList.remove('hidden');
      cfg.setBusy(true);
      cfg.cancelBtn.textContent = 'Cancel export';

      app.renderer.ensureAudio();
      ex.startTime = 0;
      ex.wallStart = performance.now();
      app.play();

      ex.watchdog = setTimeout(() => {
        if (this.active !== ex || ex.cancelled || ex.finishing) return;
        if (ex.app.state.time < 0.05) {
          this.fail('Export did not start. Keep this tab visible and in the foreground, then try again.');
        }
      }, 10000);
    },

    tick(time) {
      const ex = this.active;
      if (!ex || ex.finishing) return;
      ex.app.renderer.draw(ex.ctx, ex.app.state.project, time, ex.app.state.assets);

      const p = VE.clamp(time / Math.max(0.001, ex.duration), 0, 1);
      const bar = ex.ui.progressWrap.querySelector('.progress-bar');
      const left = ex.ui.progressWrap.querySelector('.left');
      const right = ex.ui.progressWrap.querySelector('.right');
      if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
      if (left) left.textContent = `Rendering ${VE.fmtTime(time)} / ${VE.fmtTime(ex.duration)}`;
      if (right) right.textContent = Math.round(p * 100) + '%';

      if (time >= ex.duration - 0.02) this.finish();
    },

    finish() {
      const ex = this.active;
      if (!ex || ex.finishing) return;
      ex.finishing = true;
      ex.app.pause();
      try {
        ex.app.renderer.draw(ex.ctx, ex.app.state.project, ex.duration, ex.app.state.assets);
        ex.recorder.requestData && ex.recorder.requestData();
      } catch (e) { /* noop */ }
      setTimeout(() => {
        try { if (ex.recorder && ex.recorder.state !== 'inactive') ex.recorder.stop(); } catch (e) { /* noop */ }
      }, 320);
    },

    complete() {
      const ex = this.active;
      if (!ex) return;
      const duration = ex.duration;
      const blob = new Blob(ex.chunks, { type: ex.format.mime.split(';')[0] });
      const filename = `${VE.safeFilename(ex.app.state.project.name)}-${ex.height}p.${ex.format.ext}`;
      const url = URL.createObjectURL(blob);
      this.cleanup();

      if (ex.cancelled) {
        URL.revokeObjectURL(url);
        return;
      }

      VE.download(blob, filename);

      const ui = ex.ui;
      ui.progressWrap.classList.add('hidden');
      ui.body.querySelector('.export-grid')?.classList.add('hidden');
      const gridCheck = ui.body.querySelector('.export-done');
      if (gridCheck) gridCheck.remove();

      const done = document.createElement('div');
      done.className = 'export-done';
      done.innerHTML = `<div class="file-chip">${VE.icon('check')}<div>
          <div style="font-weight:700;font-size:12px">${VE.escapeHtml(filename)}</div>
          <div style="font-size:10.5px;color:var(--muted)">${VE.formatBytes(blob.size)} · ${VE.fmtClock(duration)} · ${ex.width}×${ex.height}</div>
        </div></div>
        <p class="insp-note" style="margin:0">The file was downloaded automatically. If it did not appear, use the button below.</p>
        <div class="btn-row">
          <a class="btn soft" href="${url}" download="${VE.escapeAttr(filename)}">${VE.icon('download')}<span>Download again</span></a>
        </div>`;
      ui.body.appendChild(done);
      ui.startBtn.textContent = 'Export again';
      ui.startBtn.disabled = false;
      ui.startBtn.onclick = () => {
        done.remove();
        ui.body.querySelector('.export-grid')?.classList.remove('hidden');
        ui.startBtn.textContent = 'Start export';
        ui.startBtn.onclick = null;
        ui.startBtn.disabled = true;
        VE.toast('Choose export settings and press Start again');
        ui.modal.close();
        this.open(ex.app);
      };
      ui.cancelBtn.textContent = 'Close';
      ui.cancelBtn.disabled = false;
      ui.cancelBtn.onclick = () => ui.modal.close();
      VE.toast('Video exported — check your downloads');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    },

    cancel() {
      const ex = this.active;
      if (!ex) return;
      ex.cancelled = true;
      ex.app.pause();
      try {
        if (ex.recorder && ex.recorder.state !== 'inactive') ex.recorder.stop();
      } catch (e) { /* noop */ }
      this.cleanup();
      VE.toast('Export cancelled', 'warn');
      if (this.ui) this.ui.modal.close();
    },

    cleanup(silent) {
      const ex = this.active;
      if (!ex) return;
      if (ex.watchdog) clearTimeout(ex.watchdog);
      if (ex.dest && this.app && this.app.renderer.audio) {
        try { this.app.renderer.audio.master.disconnect(ex.dest); } catch (e) { /* noop */ }
      }
      try {
        ex.stream.getTracks().forEach(t => t.stop());
      } catch (e) { /* noop */ }
      if (this.app) {
        this.app.state.exporting = null;
        if (ex.prevLoop != null) {
          this.app.state.loop = ex.prevLoop;
          this.app.updateTransport();
        }
      }
      this.active = null;
      if (!silent) this.app.pause();
    },

    fail(message) {
      const ex = this.active;
      if (ex) {
        ex.cancelled = true;
        try {
          if (ex.recorder && ex.recorder.state !== 'inactive') ex.recorder.stop();
        } catch (e) { /* noop */ }
      }
      this.cleanup(true);
      if (this.ui) {
        this.ui.progressWrap.classList.add('hidden');
        this.ui.setBusy(false);
        this.ui.startBtn.disabled = false;
        this.ui.cancelBtn.disabled = false;
        this.ui.cancelBtn.textContent = 'Close';
      }
      VE.toast(message, 'error');
    }
  };

  VE.Exporter = Exporter;
})();
