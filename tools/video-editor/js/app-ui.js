/* UI bindings: library tabs, text presets, captions, voiceover, demo, help */
(function () {
  const VE = (window.VE = window.VE || {});
  let app = null;

  function $(id) { return document.getElementById(id); }

  function button(label, cls, icon) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (icon) b.innerHTML = VE.icon(icon);
    const s = document.createElement('span');
    s.textContent = label;
    b.appendChild(s);
    return b;
  }

  function focusTextEditor() {
    setTimeout(() => {
      const ta = document.getElementById('inspector').querySelector('textarea');
      if (ta) { ta.focus(); ta.select(); }
    }, 40);
  }

  /* ---------------- text ---------------- */

  function addTextPreset(presetId) {
    const track = VE.ensureTrack(app.state.project, 'text');
    const clip = VE.createTextClip(null, presetId, { start: app.state.time });
    clip.start = VE.findFreeStart(track, app.state.time, clip.duration);
    track.clips.push(clip);
    app.commit({ history: true, timeline: true, inspector: true });
    app.selectClip(clip.id);
  }

  function addBlankText() {
    const track = VE.ensureTrack(app.state.project, 'text');
    const clip = VE.createTextClip('Your text here', 'title', { start: app.state.time });
    clip.fontSize = 84;
    clip.start = VE.findFreeStart(track, app.state.time, clip.duration);
    track.clips.push(clip);
    app.commit({ history: true, timeline: true, inspector: true });
    app.selectClip(clip.id);
    focusTextEditor();
  }

  function renderTextPresets() {
    const wrap = $('textPresets');
    if (!wrap) return;
    wrap.innerHTML = '';
    VE.TEXT_PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-card';
      b.title = 'Add ' + p.label;
      const span = document.createElement('span');
      span.textContent = p.preview;
      const c = p.clip;
      span.style.fontFamily = `"${c.fontFamily}", sans-serif`;
      span.style.color = c.color || '#ffffff';
      span.style.fontWeight = c.bold === false ? '400' : '800';
      span.style.fontSize = '19px';
      if (c.style === 'boxed') {
        span.style.background = c.bgColor;
        span.style.color = c.color;
        span.style.padding = '2px 7px';
        span.style.borderRadius = '4px';
        span.style.fontSize = '13px';
      } else if (c.style === 'subtitle') {
        span.style.background = 'rgba(0,0,0,.6)';
        span.style.padding = '2px 7px';
        span.style.borderRadius = '4px';
        span.style.fontSize = '14px';
      } else if (c.style === 'neon') {
        span.style.textShadow = '0 0 12px ' + c.color;
      } else if (c.style === 'gradient') {
        span.style.background = `linear-gradient(90deg,${c.color},${c.color2})`;
        span.style.webkitBackgroundClip = 'text';
        span.style.backgroundClip = 'text';
        span.style.color = 'transparent';
      } else if (c.style === 'comic') {
        span.style.textTransform = 'uppercase';
        span.style.webkitTextStroke = '1px #111';
        span.style.fontSize = '22px';
      } else if (c.style === 'outline') {
        span.style.webkitTextStroke = '1.5px rgba(255,255,255,.55)';
        span.style.color = 'transparent';
        span.style.fontSize = '22px';
      } else if (c.style === 'karaoke') {
        span.style.textShadow = '0 0 10px ' + c.color;
      } else if (c.style === 'lowerthird') {
        span.style.fontSize = '14px';
        span.style.borderLeft = '3px solid ' + (c.color || '#fff');
        span.style.paddingLeft = '6px';
      }
      const small = document.createElement('small');
      small.textContent = p.label;
      b.append(span, small);
      b.addEventListener('click', () => addTextPreset(p.id));
      wrap.appendChild(b);
    });
  }

  /* ---------------- captions ---------------- */

  function selectedCaptionPreset() {
    const sel = $('captionStyle');
    return (sel && sel.value) || 'caption';
  }

  function addCaption() {
    const track = VE.ensureTrack(app.state.project, 'text');
    const clip = VE.createTextClip('New caption', selectedCaptionPreset(), { start: app.state.time });
    clip.duration = 2.5;
    clip.transitionIn = { type: 'none', duration: 0.2 };
    clip.transitionOut = { type: 'none', duration: 0.2 };
    clip.start = VE.findFreeStart(track, app.state.time, clip.duration);
    track.clips.push(clip);
    app.commit({ history: true, timeline: true, inspector: true });
    app.selectClip(clip.id);
    VE.toast('Caption added — edit the text in the inspector');
    focusTextEditor();
  }

  function parseSubtitles(raw) {
    const text = String(raw || '').replace(/\r/g, '').replace(/^\uFEFF/, '');
    const cues = [];
    const arrow = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/;
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split('\n');
      let idx = -1;
      let match = null;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(arrow);
        if (m) { idx = i; match = m; break; }
      }
      if (!match) continue;
      const start = VE.parseTimecode(match[1]);
      const end = VE.parseTimecode(match[2]);
      if (!(end > start)) continue;
      const caption = lines.slice(idx + 1).join('\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]+\}/g, '')
        .trim();
      if (!caption) continue;
      cues.push({ start, end, text: caption });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  async function importCaptionFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const cues = parseSubtitles(text);
      if (!cues.length) {
        VE.toast('No captions found in that file', 'warn');
        return;
      }
      const track = VE.ensureTrack(app.state.project, 'text');
      const preset = selectedCaptionPreset();
      cues.forEach(cue => {
        const clip = VE.createTextClip(cue.text, preset, { start: cue.start });
        clip.duration = Math.max(0.3, cue.end - cue.start);
        clip.transitionIn = { type: 'none', duration: 0.2 };
        clip.transitionOut = { type: 'none', duration: 0.2 };
        track.clips.push(clip);
      });
      app.commit({ history: true, timeline: true, inspector: true });
      VE.toast(`${cues.length} caption${cues.length > 1 ? 's' : ''} imported`);
    } catch (err) {
      console.warn(err);
      VE.toast('Could not read that caption file', 'error');
    }
  }

  function exportCaptions() {
    const clips = app.state.project.tracks
      .flatMap(t => t.clips)
      .filter(c => c.type === 'text' && c.text && c.text.trim())
      .sort((a, b) => a.start - b.start);
    if (!clips.length) {
      VE.toast('There are no captions to export yet', 'warn');
      return;
    }
    const srt = clips.map((c, i) => {
      return `${i + 1}\r\n${VE.fmtTimecode(c.start)} --> ${VE.fmtTimecode(c.start + c.duration)}\r\n${c.text.trim()}\r\n`;
    }).join('\r\n');
    VE.download(new Blob([srt], { type: 'text/plain;charset=utf-8' }), `${VE.safeFilename(app.state.project.name)}.srt`);
    VE.toast('Captions exported as .srt');
  }

  /* ---------------- voiceover ---------------- */

  async function recordVoiceover() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      VE.toast('Microphone recording is not supported in this browser', 'error');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      VE.toast('Microphone permission was denied', 'error');
      return;
    }

    const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    let recorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      VE.toast('Could not start the microphone recorder', 'error');
      return;
    }

    const startAt = app.state.time;
    const chunks = [];
    let cancelled = false;
    let timer = null;
    let seconds = 0;

    const body = document.createElement('div');
    body.innerHTML = `<div class="record-pill"><i></i><span>Recording voiceover</span></div>
      <p class="tab-hint" style="margin-top:12px">The timeline plays while you record. Headphones are recommended to avoid feedback. Press <b>Stop &amp; add</b> to place the take on the audio track.</p>
      <div class="stat-row"><span>Elapsed</span><b class="rec-time">0:00</b></div>`;
    const footer = document.createElement('div');
    footer.className = 'btn-row';
    const cancelBtn = button('Cancel', 'btn ghost');
    const stopBtn = button('Stop & add', 'btn primary');
    footer.append(cancelBtn, stopBtn);

    const stopStream = () => { try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* noop */ } };
    const clearTimer = () => { if (timer) clearInterval(timer); timer = null; };

    const modal = VE.openModal({
      title: 'Record voiceover',
      body,
      footer,
      persistent: true,
      onClose: () => {
        clearTimer();
        if (recorder.state !== 'inactive') {
          cancelled = true;
          try { recorder.stop(); } catch (e) { /* noop */ }
        }
        stopStream();
        app.pause();
      }
    });

    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    });

    recorder.addEventListener('stop', async () => {
      clearTimer();
      stopStream();
      app.pause();
      if (cancelled) return;
      modal.close();
      const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || mime || 'audio/webm' });
      if (blob.size < 600) {
        VE.toast('That take was too short — try again', 'warn');
        return;
      }
      try {
        const ext = /mp4/.test(mime) ? 'm4a' : 'webm';
        const file = new File([blob], `Voiceover ${app.state.assets.size + 1}.${ext}`, { type: blob.type || 'audio/webm' });
        const asset = await VE.probeMedia(file);
        await VE.DB.putAsset(asset);
        app.state.assets.set(asset.id, asset);
        app.renderAssets();
        const track = VE.ensureTrack(app.state.project, 'audio');
        const clip = VE.createMediaClip(asset, { start: startAt });
        clip.start = VE.findFreeStart(track, startAt, clip.duration);
        clip.fadeIn = 0.04;
        clip.fadeOut = 0.04;
        track.clips.push(clip);
        app.commit({ history: true, timeline: true, inspector: true });
        app.selectClip(clip.id);
        VE.toast('Voiceover added to the audio track');
      } catch (err) {
        console.warn(err);
        VE.toast('The recording could not be added', 'error');
      }
    });

    recorder.start(250);
    recorder.__started = true;
    app.play();
    timer = setInterval(() => {
      seconds++;
      const t = body.querySelector('.rec-time');
      if (t) t.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }, 1000);

    stopBtn.addEventListener('click', () => {
      clearTimer();
      app.pause();
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { /* noop */ }
    });
    cancelBtn.addEventListener('click', () => {
      cancelled = true;
      clearTimer();
      app.pause();
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { /* noop */ }
      stopStream();
      modal.close();
    });
  }

  /* ---------------- demo ---------------- */

  async function loadDemo() {
    const project = app.state.project;
    if (project.tracks.some(t => t.clips.length)) {
      const ok = await VE.confirm('Load demo', 'Add the demo timeline after the current edit?', 'Add demo');
      if (!ok) return;
    }
    const base = VE.projectDuration(project);
    const track = VE.ensureTrack(project, 'text');
    project.background = '#0b0e18';
    if (project.name === 'Untitled project') project.name = 'ClipForge demo';
    const nameInput = $('projectName');
    if (nameInput) nameInput.value = project.name;

    const add = (text, preset, start, duration, overrides) => {
      const clip = VE.createTextClip(text, preset, { start: base + start, overrides: Object.assign({ duration }, overrides || {}) });
      clip.duration = duration;
      track.clips.push(clip);
      return clip;
    };

    const title = add('CLIPFORGE', 'title', 0, 4.4, {
      y: 0.44, transitionIn: { type: 'zoom', duration: 0.7 }, transitionOut: { type: 'fade', duration: 0.6 }
    });
    add('A private video editor in your browser', 'subtitle', 0.5, 3.7, {
      fontSize: 34, y: 0.6, textWidth: 0.8, transitionIn: { type: 'fade', duration: 0.6 }, transitionOut: { type: 'fade', duration: 0.5 }
    });
    add('Edit anything. Upload nothing.', 'karaoke', 5, 4.4, {
      y: 0.5, fontSize: 62, transitionIn: { type: 'fade', duration: 0.45 }, transitionOut: { type: 'fade', duration: 0.45 }
    });
    add('Made on your device\nNo uploads · No watermark', 'lowerthird', 5.4, 3.6, {
      fontSize: 32, x: 0.37, y: 0.78, textWidth: 0.62, bgColor: '#12141c'
    });
    add('Export up to 4K.', 'typewriter', 10, 3.6, {
      y: 0.5, fontSize: 64, transitionIn: { type: 'fade', duration: 0.4 }, transitionOut: { type: 'fade', duration: 0.4 }
    });

    app.state.time = base;
    app.state.selection = null;
    app.commit({ history: true, timeline: true, inspector: true });
    app.selectClip(title.id);
    app.seek(base + 0.01);
    VE.toast('Demo timeline loaded — press Space to play');
  }

  /* ---------------- help ---------------- */

  function showHelp() {
    const body = document.createElement('div');
    const grid = document.createElement('div');
    grid.className = 'kbd-list';
    VE.SHORTCUTS.forEach(([k, d]) => {
      grid.insertAdjacentHTML('beforeend', `<kbd>${VE.escapeHtml(k)}</kbd><span>${VE.escapeHtml(d)}</span>`);
    });
    body.innerHTML = '<p class="tab-hint">Everything runs locally in your browser. Media files are stored in IndexedDB so projects survive a refresh.</p>';
    body.appendChild(grid);
    VE.openModal({ title: 'Keyboard shortcuts', body });
  }

  /* ---------------- init ---------------- */

  function init(appInstance) {
    app = appInstance;

    /* tabs */
    document.querySelectorAll('#libraryTabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#libraryTabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        ['media', 'text', 'audio', 'captions'].forEach(t => {
          const pane = $('tab' + t.charAt(0).toUpperCase() + t.slice(1));
          if (pane) pane.classList.toggle('hidden', t !== tab);
        });
      });
    });

    renderTextPresets();

    const fileInput = $('fileInput');
    $('btnImport').addEventListener('click', () => fileInput.click());
    const stageImport = $('btnStageImport');
    if (stageImport) stageImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (files.length) app.importFiles(files);
    });

    const dz = $('dropZone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('drag');
    }));
    ['dragleave', 'dragend'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('drag');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) app.importFiles(files);
    });

    const canvasFrame = $('canvasFrame');
    ['dragenter', 'dragover'].forEach(ev => canvasFrame.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }));
    canvasFrame.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) app.importFiles(files);
    });

    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files') &&
        !e.target.closest('.dropzone') && !e.target.closest('.canvas-frame')) {
        e.preventDefault();
      }
    });

    $('btnAddText').addEventListener('click', addBlankText);
    $('btnDemo').addEventListener('click', loadDemo);
    $('btnRelink').addEventListener('click', () => app.relinkAssets());
    $('btnHelp').addEventListener('click', showHelp);

    $('btnAddCaption').addEventListener('click', addCaption);
    $('btnImportCaptions').addEventListener('click', () => $('captionFileInput').click());
    $('btnExportCaptions').addEventListener('click', exportCaptions);
    $('captionFileInput').addEventListener('change', () => {
      const file = $('captionFileInput').files && $('captionFileInput').files[0];
      $('captionFileInput').value = '';
      if (file) importCaptionFile(file);
    });

    $('btnImportAudio').addEventListener('click', async () => {
      const files = await VE.pickFiles('audio/*', true);
      if (files.length) app.importFiles(files);
    });

    $('btnVoiceover').addEventListener('click', recordVoiceover);

    $('btnAddTrack').addEventListener('click', (e) => {
      VE.openMenu(e.currentTarget, [
        { label: 'Video track', icon: 'film', onClick: () => app.addTrack('video') },
        { label: 'Overlay track', icon: 'layers', onClick: () => app.addTrack('overlay') },
        { label: 'Text track', icon: 'type', onClick: () => app.addTrack('text') },
        { label: 'Audio track', icon: 'music', onClick: () => app.addTrack('audio') }
      ]);
    });

    document.addEventListener('fullscreenchange', () => {
      const btn = $('btnFullscreen');
      if (btn) VE.setIcon(btn, document.fullscreenElement ? 'x' : 'maximize');
    });
  }

  VE.AppUI = { init, showHelp, loadDemo, recordVoiceover };
})();
