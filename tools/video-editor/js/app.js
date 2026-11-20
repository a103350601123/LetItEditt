/* Application core: state, playback, project + asset management */
(function () {
  const VE = (window.VE = window.VE || {});

  const state = {
    project: null,
    assets: new Map(),
    selection: null,
    time: 0,
    playing: false,
    loop: false,
    muted: false,
    snap: true,
    pps: 56,
    needsDraw: true,
    exporting: null,
    ready: false,
    clearing: false
  };

  let renderer = null;
  let history = null;
  let els = {};
  let lastTs = 0;
  let rafId = 0;
  let lastSave = Promise.resolve();
  const PREFS_KEY = 'letitedit:prefs';
  /* Earlier builds used this key; read it once, then migrate. */
  const LEGACY_PREFS_KEY = 'clipforge:prefs';
  const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171b28"/><stop offset="1" stop-color="#0d1018"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><g fill="none" stroke="#3a425c" stroke-width="3" stroke-linecap="round"><rect x="126" y="82" width="68" height="44" rx="6"/><path d="M146 93v22l18-11z"/></g></svg>'
  );

  function cacheEls() {
    const ids = [
      'preview', 'canvasFrame', 'mediaPool', 'stageHint', 'projectName', 'saveState',
      'aspectSelect', 'captionStyle', 'textPresets', 'assetGrid', 'libEmpty', 'dropZone',
      'relinkBar', 'fileInput', 'seekBar', 'timeDisplay', 'btnPlay', 'btnLoop', 'btnMute',
      'btnFullscreen', 'btnUndo', 'btnRedo', 'btnSplit', 'btnDelete', 'btnDuplicate',
      'btnSnap', 'tracks', 'inspector', 'zoomSlider', 'fileMenu', 'openProjectInput',
      'btnFileMenu', 'btnExport', 'btnNewProject', 'btnSaveProject', 'btnOpenProject',
      'btnExportProject', 'btnHelp', 'btnImport', 'btnStageImport', 'btnDemo',
      'btnAddText', 'btnVoiceover', 'btnImportAudio', 'btnAddCaption', 'btnImportCaptions',
      'btnExportCaptions', 'captionFileInput', 'btnRelink', 'btnSplit2',
      'libraryPanel', 'drawerBackdrop', 'btnMobileLibrary', 'btnMobileInspector',
      'previewStack', 'overlayCanvas', 'libCategories', 'proceduralGrid', 'libTools'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
    els.pool = document.getElementById('mediaPool');
  }

  /* ---------------- persistence ---------------- */

  function setSaveState(kind) {
    if (!els.saveState) return;
    const map = { saving: 'Saving…', saved: 'Saved locally', error: 'Not saved' };
    els.saveState.innerHTML = '<i></i>' + (map[kind] || 'Saved locally');
    els.saveState.classList.toggle('saving', kind === 'saving');
  }

  function saveNow() {
    if (!state.project || state.clearing) return lastSave;
    lastSave = (async () => {
      try {
        await VE.DB.saveProject(state.project);
        setSaveState('saved');
      } catch (err) {
        console.warn('Save failed', err);
        setSaveState('error');
      }
    })();
    return lastSave;
  }

  const debouncedSave = VE.debounce(saveNow, 650);

  function scheduleSave() {
    setSaveState('saving');
    debouncedSave();
  }

  /* ---------------- state helpers ---------------- */

  function sanitizeProject(raw) {
    return VE.sanitizeProject(raw);
  }

  function loadAssets(records) {
    for (const rec of records || []) {
      const asset = Object.assign({}, rec);
      if (asset.blob) {
        try {
          asset.url = URL.createObjectURL(asset.blob);
          asset.missing = false;
        } catch (e) {
          asset.missing = true;
        }
      } else if (!asset.url) {
        asset.missing = true;
      }
      state.assets.set(asset.id, asset);
    }
  }

  /* ---------------- selection & commits ---------------- */

  function selectClip(id) {
    state.selection = id || null;
    VE.Timeline.updateSelection();
    VE.Inspector.render();
    App.updateTransport();
  }

  function commit(opts = {}) {
    if (!state.project) return;
    state.project.updatedAt = Date.now();
    if (opts.history !== false && history) history.push(state.project);
    if (opts.timeline) VE.Timeline.render();
    if (opts.inspector) VE.Inspector.render();
    App.updateUndoButtons();
    App.updateTransport();
    App.invalidate();
    scheduleSave();
  }

  function updateUndoButtons() {
    if (!history) return;
    if (els.btnUndo) els.btnUndo.disabled = !history.canUndo;
    if (els.btnRedo) els.btnRedo.disabled = !history.canRedo;
  }

  function applyProject(next) {
    const clean = sanitizeProject(next) || next;
    if (!clean) return;
    state.project = clean;
    if (state.selection && !VE.findClip(clean, state.selection)) state.selection = null;
    if (renderer) renderer.prune(clean);
    resizePreview();
    els.projectName.value = clean.name;
    els.aspectSelect.value = clean.aspect;
    state.time = VE.clamp(state.time, 0, VE.projectDuration(clean));
    VE.Timeline.render();
    VE.Inspector.render();
    App.updateUndoButtons();
    App.updateTransport();
    App.invalidate();
    scheduleSave();
  }

  /* ---------------- transport ---------------- */

  function setBtnIcon(btn, name) {
    if (!btn || btn.dataset.cfIcon === name) return;
    btn.dataset.cfIcon = name;
    VE.setIcon(btn, name);
  }

  function updateTransport() {
    if (!state.project) return;
    const duration = VE.projectDuration(state.project);
    if (els.timeDisplay) els.timeDisplay.textContent = `${VE.fmtTime(state.time)} / ${VE.fmtTime(duration)}`;
    if (els.seekBar) {
      els.seekBar.max = String(Math.max(0.1, duration));
      if (document.activeElement !== els.seekBar) els.seekBar.value = String(VE.clamp(state.time, 0, Math.max(0.1, duration)));
    }
    setBtnIcon(els.btnPlay, state.playing ? 'pause' : 'play');
    if (els.btnPlay) els.btnPlay.title = state.playing ? 'Pause (Space)' : 'Play (Space)';
    if (els.btnLoop) els.btnLoop.classList.toggle('active', state.loop);
    if (els.btnMute) {
      setBtnIcon(els.btnMute, state.muted ? 'volume-x' : 'volume');
      els.btnMute.title = state.muted ? 'Unmute preview' : 'Mute preview';
    }
    if (els.btnSnap) els.btnSnap.classList.toggle('active', state.snap);
    if (els.btnSplit) els.btnSplit.disabled = !state.selection;
    if (els.btnDuplicate) els.btnDuplicate.disabled = !state.selection;
    if (els.btnDelete) els.btnDelete.disabled = !state.selection;
    const empty = VE.projectDuration(state.project) <= 0.01;
    if (els.stageHint) els.stageHint.classList.toggle('hidden', !empty);
    if (els.canvasFrame) els.canvasFrame.classList.toggle('empty', empty);
  }

  function seek(t) {
    if (!state.project) return;
    const duration = VE.projectDuration(state.project);
    state.time = VE.clamp(t, 0, Math.max(0.1, duration));
    if (state.playing) {
      renderer.sync(state.project, state.time, true, state.assets);
    }
    App.invalidate();
    App.updateTransport();
    VE.Timeline.updatePlayhead();
  }

  function play() {
    if (!state.project || state.playing) return;
    const duration = VE.projectDuration(state.project);
    if (duration <= 0.05) {
      VE.toast('Add a clip to the timeline first', 'warn');
      return;
    }
    if (state.time >= duration - 0.02) state.time = 0;
    renderer.ensureAudio();
    state.playing = true;
    renderer.sync(state.project, state.time, true, state.assets);
    App.updateTransport();
    App.invalidate();
  }

  function pause() {
    state.playing = false;
    if (renderer) renderer.stopAll();
    App.updateTransport();
    App.invalidate();
  }

  function togglePlay() {
    if (state.playing) pause(); else play();
  }

  function drawPreview() {
    const ctx = els.preview.getContext('2d', { alpha: false });
    renderer.draw(ctx, state.project, state.time, state.assets);
  }

  function loop(now) {
    const maxStep = state.exporting ? 1 : 0.15;
    const dt = Math.min(maxStep, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;
    if (!state.project) { rafId = requestAnimationFrame(loop); return; }

    if (state.playing) {
      let t = state.time + dt;
      if (state.exporting && state.exporting.wallStart) {
        t = state.exporting.startTime + (now - state.exporting.wallStart) / 1000;
      }
      const duration = VE.projectDuration(state.project);
      if (t >= duration) {
        if (state.loop && duration > 0.05) {
          t = t % duration;
        } else {
          t = duration;
          pause();
        }
      }
      state.time = t;
      state.needsDraw = true;
      App.updateTransport();
      VE.Timeline.updatePlayhead();
      if (!state.exporting) VE.Timeline.revealPlayhead();
    }

    if (state.playing || state.needsDraw) {
      state.needsDraw = false;
      renderer.sync(state.project, state.time, state.playing, state.assets);
      if (!state.exporting) drawPreview();
    }

    if (state.exporting) VE.Exporter.tick(state.time);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- preview sizing / aspect ---------------- */

  function resizePreview() {
    if (!state.project || !els.preview) return;
    const dims = VE.dimsForAspect(state.project.aspect, 720);
    if (els.preview.width !== dims.w || els.preview.height !== dims.h) {
      els.preview.width = dims.w;
      els.preview.height = dims.h;
    }
    state.needsDraw = true;
  }

  function setAspect(id) {
    if (!state.project || !VE.ASPECT_MAP[id]) return;
    state.project.aspect = id;
    els.aspectSelect.value = id;
    resizePreview();
    commit({ history: true, timeline: true });
    VE.Inspector.render();
    App.invalidate();
  }

  /* ---------------- clip operations ---------------- */

  function splitSelection() {
    const sel = state.selection ? VE.findClip(state.project, state.selection) : null;
    if (!sel) { VE.toast('Select a clip to split', 'warn'); return; }
    const { clip, track } = sel;
    if (track.locked) { VE.toast('This track is locked', 'warn'); return; }
    const at = state.time;
    if (at <= clip.start + 0.04 || at >= clip.start + clip.duration - 0.04) {
      VE.toast('Move the playhead inside the clip to split it', 'warn');
      return;
    }
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = VE.uid('clip');
    copy.start = at;
    copy.duration = clip.start + clip.duration - at;
    copy.inPoint = clip.inPoint + (at - clip.start) * clip.speed;
    clip.duration = at - clip.start;
    track.clips.push(copy);
    renderer.disposeClip(copy.id);
    commit({ history: true, timeline: true, inspector: true });
    VE.toast('Clip split');
  }

  function duplicateSelection() {
    const sel = state.selection ? VE.findClip(state.project, state.selection) : null;
    if (!sel) { VE.toast('Select a clip to duplicate', 'warn'); return; }
    const { clip, track } = sel;
    if (track.locked) { VE.toast('This track is locked', 'warn'); return; }
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = VE.uid('clip');
    copy.start = VE.findFreeStart(track, clip.start + clip.duration, clip.duration);
    track.clips.push(copy);
    commit({ history: true, timeline: true });
    selectClip(copy.id);
  }

  function deleteSelection() {
    if (!state.selection) return;
    const sel = VE.findClip(state.project, state.selection);
    if (!sel) return;
    if (sel.track.locked) { VE.toast('This track is locked', 'warn'); return; }
    removeClip(sel.clip.id);
  }

  function removeClip(clipId) {
    const found = VE.findClip(state.project, clipId);
    if (!found) return;
    found.track.clips = found.track.clips.filter(c => c.id !== clipId);
    renderer.disposeClip(clipId);
    if (state.selection === clipId) state.selection = null;
    commit({ history: true, timeline: true, inspector: true });
  }

  function detachAudio(clipId) {
    const found = VE.findClip(state.project, clipId);
    if (!found || found.clip.type !== 'video') return;
    const clip = found.clip;
    const track = VE.ensureTrack(state.project, 'audio');
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = VE.uid('clip');
    copy.type = 'audio';
    copy.name = (clip.name || 'Clip') + ' · audio';
    copy.start = VE.findFreeStart(track, clip.start, clip.duration);
    copy.transitionIn = { type: 'none', duration: 0.4 };
    copy.transitionOut = { type: 'none', duration: 0.4 };
    track.clips.push(copy);
    clip.volume = 0;
    commit({ history: true, timeline: true, inspector: true });
    VE.toast('Audio detached to the audio track');
  }

  /* ---------------- layers & shapes ---------------- */

  function moveLayer(dir) {
    if (!state.selection) { VE.toast('Select a layer first', 'warn'); return; }
    const before = VE.layerInfo(state.project, state.selection);
    if (!before) return;
    const found = VE.findClip(state.project, state.selection);
    if (found && (found.track.locked || found.clip.locked)) { VE.toast('This layer or track is locked', 'warn'); return; }
    const moved = VE.moveLayer(state.project, state.selection, dir);
    if (!moved) { VE.toast(dir > 0 ? 'Already at the front' : 'Already at the back', 'warn'); return; }
    const after = VE.layerInfo(state.project, state.selection);
    commit({ history: true, timeline: true, inspector: true });
    VE.toast(`Layer ${after.z} of ${after.count}`);
    void before;
  }

  function toggleClipFlag(flag) {
    const found = state.selection ? VE.findClip(state.project, state.selection) : null;
    if (!found) { VE.toast('Select a layer first', 'warn'); return; }
    found.clip[flag] = !found.clip[flag];
    commit({ history: true, timeline: true, inspector: true, renderer: true });
    VE.toast(flag === 'locked' ? (found.clip.locked ? 'Layer locked' : 'Layer unlocked')
      : (found.clip.hidden ? 'Layer hidden' : 'Layer shown'));
  }

  function addShape(procId) {
    const item = VE.PROCEDURAL_MAP[procId];
    if (!item) return;
    const trackType = item.category === 'decorative' || item.category === 'animated' ? 'overlay' : 'overlay';
    const track = VE.ensureTrack(state.project, trackType);
    const clip = VE.createShapeClip(procId, { start: state.time });
    clip.start = VE.findFreeStart(track, state.time, clip.duration);
    track.clips.push(clip);
    commit({ history: true, timeline: true, inspector: true });
    selectClip(clip.id);
    VE.toast(item.label + ' added — drag it on the preview to position it');
  }

  /* ---------------- tracks ---------------- */

  function addTrack(kind) {
    if (!['video', 'overlay', 'text', 'audio'].includes(kind)) return;
    if (state.project.tracks.length >= VE.MAX_TRACKS) {
      VE.toast(`This editor supports up to ${VE.MAX_TRACKS} tracks per project`, 'warn');
      return;
    }
    const track = VE.createTrack(kind, state.project.tracks);
    const tracks = state.project.tracks;
    let index = tracks.length;
    if (kind === 'video') {
      const lastVideo = tracks.map(t => t.type).lastIndexOf('video');
      index = lastVideo >= 0 ? lastVideo + 1 : 0;
    } else if (kind === 'overlay') {
      const lastOverlay = tracks.map(t => t.type).lastIndexOf('overlay');
      if (lastOverlay >= 0) index = lastOverlay + 1;
      else {
        const firstText = tracks.findIndex(t => t.type === 'text');
        const firstAudio = tracks.findIndex(t => t.type === 'audio');
        index = firstText >= 0 ? firstText : firstAudio >= 0 ? firstAudio : tracks.length;
      }
    } else if (kind === 'text') {
      const firstAudio = tracks.findIndex(t => t.type === 'audio');
      index = firstAudio >= 0 ? firstAudio : tracks.length;
    }
    tracks.splice(index, 0, track);
    commit({ history: true, timeline: true, inspector: true });
    VE.toast(track.name + ' added');
  }

  async function deleteTrack(trackId) {
    const track = state.project.tracks.find(t => t.id === trackId);
    if (!track) return;
    const n = track.clips.length;
    const ok = await VE.confirm('Delete track', `Delete “${track.name}”${n ? ` and its ${n} clip${n > 1 ? 's' : ''}` : ''}? This cannot be undone with the track controls (use Ctrl+Z).`, 'Delete track');
    if (!ok) return;
    track.clips.forEach(c => renderer.disposeClip(c.id));
    state.project.tracks = state.project.tracks.filter(t => t.id !== trackId);
    if (state.selection && !VE.findClip(state.project, state.selection)) state.selection = null;
    commit({ history: true, timeline: true, inspector: true });
    VE.toast('Track deleted');
  }

  function moveTrack(trackId, dir) {
    const tracks = state.project.tracks;
    const index = tracks.findIndex(t => t.id === trackId);
    if (index < 0) return;
    const track = tracks[index];
    const group = track.groupId ? tracks.filter(t => t.groupId === track.groupId) : [track];
    const first = tracks.indexOf(group[0]);
    const last = tracks.indexOf(group[group.length - 1]);
    const target = dir > 0 ? last + 1 : first - 1;
    if (target < 0 || target >= tracks.length) {
      VE.toast(dir > 0 ? 'Group is already at the front' : 'Group is already at the back', 'warn');
      return;
    }
    tracks.splice(first, group.length);
    const insert = dir > 0 ? target - group.length + 1 : target;
    tracks.splice(insert, 0, ...group);
    commit({ history: true, timeline: true, inspector: true });
    VE.toast(group.length > 1 ? 'Track group reordered' : 'Track reordered');
  }

  function toggleTrackGroup(trackId) {
    const tracks = state.project.tracks;
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    if (track.groupId) {
      const id = track.groupId;
      tracks.forEach(t => { if (t.groupId === id) t.groupId = null; });
      VE.toast('Tracks ungrouped');
    } else {
      const index = tracks.indexOf(track);
      const neighbour = tracks[index - 1] || tracks[index + 1];
      if (!neighbour) { VE.toast('Add a second track to make a group', 'warn'); return; }
      const id = VE.uid('grp');
      track.groupId = id;
      neighbour.groupId = id;
      VE.toast('Tracks grouped — lock, mute and hide now apply to the group');
    }
    commit({ history: true, timeline: true, inspector: true });
  }

  function setTrackFlag(trackId, flag) {
    const tracks = state.project.tracks;
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    const next = !track[flag];
    const group = track.groupId ? tracks.filter(t => t.groupId === track.groupId) : [track];
    group.forEach(t => { t[flag] = next; });
    commit({ history: true, timeline: true, inspector: true });
  }

  /* ---------------- media library ---------------- */

  function renderAssets() {
    if (!els.assetGrid) return;
    els.assetGrid.innerHTML = '';
    const assets = Array.from(state.assets.values());
    assets.forEach(asset => {
      const card = document.createElement('div');
      card.className = 'asset-card' + (asset.missing ? ' missing' : '');
      card.draggable = true;
      card.dataset.id = asset.id;
      card.title = asset.name + (asset.missing ? ' (missing)' : '');

      const img = document.createElement('img');
      img.src = asset.thumb || PLACEHOLDER;
      img.alt = '';
      img.loading = 'lazy';
      card.appendChild(img);

      const kind = document.createElement('div');
      kind.className = 'kind';
      kind.innerHTML = VE.icon(asset.type === 'audio' ? 'music' : asset.type === 'image' ? 'image' : asset.type === 'text' ? 'type' : 'film');
      card.appendChild(kind);

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = asset.name;
      card.appendChild(name);

      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = asset.type === 'image' ? 'IMAGE' : VE.fmtTime(asset.duration || 0);
      card.appendChild(badge);

      const del = document.createElement('button');
      del.className = 'asset-del';
      del.title = 'Remove media';
      del.innerHTML = VE.icon('x');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeAsset(asset.id);
      });
      card.appendChild(del);

      card.addEventListener('dragstart', (e) => {
        try {
          e.dataTransfer.setData('text/plain', asset.id);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* noop */ }
      });
      card.addEventListener('click', () => {
        if (asset.missing) { relinkAssets(); return; }
        addAssetToTimeline(asset);
      });
      els.assetGrid.appendChild(card);
    });
    if (els.libEmpty) els.libEmpty.classList.toggle('show', assets.length === 0);
    if (els.relinkBar) els.relinkBar.classList.toggle('hidden', !assets.some(a => a.missing));
    if (VE.AppUI && VE.AppUI.filterAssets) VE.AppUI.filterAssets();
  }

  async function removeAsset(assetId) {
    const asset = state.assets.get(assetId);
    if (!asset) return;
    let used = 0;
    state.project.tracks.forEach(t => { used += t.clips.filter(c => c.assetId === assetId).length; });
    const ok = await VE.confirm('Remove media', `Remove “${asset.name}” from this project?${used ? ` ${used} clip${used > 1 ? 's' : ''} using it will also be removed.` : ''}`, 'Remove');
    if (!ok) return;
    state.assets.delete(assetId);
    state.project.tracks.forEach(track => {
      const keep = [];
      track.clips.forEach(c => {
        if (c.assetId === assetId) renderer.disposeClip(c.id);
        else keep.push(c);
      });
      track.clips = keep;
    });
    if (asset.url) URL.revokeObjectURL(asset.url);
    try { await VE.DB.deleteAsset(assetId); } catch (e) { /* noop */ }
    if (state.selection && !VE.findClip(state.project, state.selection)) state.selection = null;
    renderAssets();
    commit({ history: true, timeline: true, inspector: true });
    VE.toast('Media removed');
  }

  async function importFiles(fileList, opts = {}) {
    const files = Array.from(fileList || []).filter(f => f && typeof f.size === 'number');
    if (!files.length) return;
    renderer.ensureAudio();
    let imported = 0;
    for (const file of files) {
      try {
        const asset = await VE.probeMedia(file);
        asset.category = opts.category || asset.type;
        await VE.DB.putAsset(asset);
        state.assets.set(asset.id, asset);
        renderAssets();
        addAssetToTimeline(asset);
        imported++;
      } catch (err) {
        console.warn(err);
        VE.toast(err.message || `Could not import ${file.name}`, 'error');
      }
    }
    if (imported) {
      renderAssets();
      App.updateTransport();
      VE.toast(`${imported} file${imported > 1 ? 's' : ''} imported`);
    }
  }

  function addAssetToTimeline(asset, opts = {}) {
    if (!asset || asset.missing) {
      if (asset && asset.missing) relinkAssets();
      return;
    }
    const isAudio = asset.type === 'audio';
    const trackType = isAudio ? 'audio' : 'video';
    const track = VE.ensureTrack(state.project, trackType);
    const clip = VE.createMediaClip(asset, { start: state.time });
    clip.start = VE.findFreeStart(track, state.time, clip.duration);
    track.clips.push(clip);
    commit({ history: true, timeline: true, inspector: true });
    selectClip(clip.id);
    if (!opts.silent) VE.toast(`${asset.name} added to the timeline`);
  }

  function addAssetToTrack(assetId, trackId, time) {
    const asset = state.assets.get(assetId);
    const track = state.project.tracks.find(t => t.id === trackId);
    if (!asset || !track) return;
    if (asset.missing) { relinkAssets(); return; }
    if (track.locked) { VE.toast('This track is locked', 'warn'); return; }
    const compatible = track.type === 'audio'
      ? asset.type === 'audio'
      : (track.type === 'video' || track.type === 'overlay')
        ? (asset.type === 'video' || asset.type === 'image')
        : false;
    if (!compatible) {
      const target = track.type === 'audio' ? 'the audio track' : track.type === 'text' ? 'a text track' : 'a video or overlay track';
      VE.toast(`Drop ${asset.type} media onto ${target}`, 'warn');
      return;
    }
    const clip = VE.createMediaClip(asset, { start: Math.max(0, time) });
    clip.start = VE.findFreeStart(track, Math.max(0, time), clip.duration);
    track.clips.push(clip);
    commit({ history: true, timeline: true, inspector: true });
    selectClip(clip.id);
  }

  async function relinkAssets() {
    const missing = Array.from(state.assets.values()).filter(a => a.missing);
    if (!missing.length) {
      VE.toast('All media is present', 'ok');
      return;
    }
    const files = await VE.pickFiles('video/*,audio/*,image/*', true);
    if (!files.length) return;
    const usedNames = new Set();
    let matched = 0;
    for (const asset of missing) {
      let file = files.find(f => f.name.toLowerCase() === String(asset.name).toLowerCase() && !usedNames.has(f.name));
      if (!file && files.length === missing.length) file = files.find(f => !usedNames.has(f.name));
      if (!file) continue;
      usedNames.add(file.name);
      try {
        const probed = await VE.probeMedia(file);
        asset.blob = probed.blob;
        asset.url = probed.url;
        asset.thumb = probed.thumb || asset.thumb;
        asset.size = probed.size;
        asset.missing = false;
        await VE.DB.putAsset(asset);
        matched++;
      } catch (err) {
        VE.toast(err.message, 'error');
      }
    }
    renderAssets();
    if (renderer) {
      renderer.prune(state.project);
    }
    commit({ history: true, timeline: true, inspector: true });
    VE.toast(matched ? `${matched} file${matched > 1 ? 's' : ''} relinked` : 'No matching files found', matched ? 'ok' : 'warn');
  }

  /* ---------------- project files ---------------- */

  function projectFilePayload() {
    return {
      app: VE.APP_NAME,
      appId: 'letitedit',
      version: 2,
      savedAt: new Date().toISOString(),
      project: state.project,
      assets: Array.from(state.assets.values()).map(a => ({
        id: a.id, name: a.name, type: a.type, category: a.category || a.type, mime: a.mime, size: a.size,
        duration: a.duration, width: a.width, height: a.height, thumb: a.thumb, missing: !!a.missing
      }))
    };
  }

  function saveProjectFile() {
    const payload = projectFilePayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    VE.download(blob, `${VE.safeFilename(state.project.name)}${VE.PROJECT_EXT}`);
    VE.toast('Project file saved');
  }

  async function loadProjectFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming = data && data.project ? data.project : data;
      if (!incoming || !Array.isArray(incoming.tracks)) throw new Error('This file is not a LetitEdit project');

      const hasClips = state.project && state.project.tracks.some(t => t.clips.length);
      if (hasClips) {
        const ok = await VE.confirm('Open project', 'Open this project and replace the current edit? The current project stays saved only until you save it as a file.', 'Open project');
        if (!ok) return;
      }

      const merged = sanitizeProject(incoming);
      if (!merged) throw new Error('Invalid project data');

      const declared = Array.isArray(data.assets) ? data.assets : [];
      for (const meta of declared) {
        if (!meta || !meta.id) continue;
        const existing = state.assets.get(meta.id);
        if (existing && existing.url && !existing.missing) continue;
        const asset = Object.assign({}, meta, existing || {});
        asset.id = meta.id;
        asset.name = meta.name || asset.name || 'Media';
        asset.type = meta.type || asset.type || 'video';
        asset.category = meta.category || asset.category || asset.type;
        asset.duration = meta.duration || asset.duration || 0;
        asset.thumb = meta.thumb || asset.thumb || '';
        asset.blob = existing ? existing.blob : null;
        asset.url = existing && existing.url ? existing.url : '';
        asset.missing = !asset.url;
        state.assets.set(asset.id, asset);
      }
      merged.tracks.forEach(t => t.clips.forEach(c => {
        if (!c.assetId) return;
        if (!state.assets.has(c.assetId)) {
          state.assets.set(c.assetId, {
            id: c.assetId, name: c.name || 'Missing media', type: c.type === 'audio' ? 'audio' : 'video',
            duration: c.duration, width: 1920, height: 1080, thumb: '', url: '', missing: true
          });
        }
      }));

      state.project = merged;
      state.selection = null;
      state.time = 0;
      state.playing = false;
      if (renderer) renderer.stopAll();
      history = new VE.History(state.project);
      els.projectName.value = merged.name;
      els.aspectSelect.value = merged.aspect;
      resizePreview();
      renderAssets();
      VE.Timeline.setZoom(state.pps);
      VE.Timeline.render();
      VE.Inspector.render();
      updateUndoButtons();
      App.updateTransport();
      App.invalidate();
      scheduleSave();
      saveNow();
      VE.toast('Project opened');
    } catch (err) {
      console.warn(err);
      VE.toast(err.message || 'Could not open this project file', 'error');
    }
  }

  async function newProject() {
    const hasClips = state.project && state.project.tracks.some(t => t.clips.length);
    if (hasClips) {
      const ok = await VE.confirm('New project', 'Start a new project? Save a project file first if you want to keep this edit.', 'Start new project');
      if (!ok) return;
    }
    pause();
    state.project = VE.createProject();
    state.selection = null;
    state.time = 0;
    history = new VE.History(state.project);
    els.projectName.value = state.project.name;
    els.aspectSelect.value = state.project.aspect;
    resizePreview();
    VE.Timeline.setZoom(state.pps);
    VE.Timeline.render();
    VE.Inspector.render();
    App.updateTransport();
    updateUndoButtons();
    App.invalidate();
    scheduleSave();
    saveNow();
    VE.toast('New project ready');
  }

  async function resetAllData() {
    const ok = await VE.confirm('Clear browser storage', 'Delete every LetitEdit project and media file stored in this browser? This cannot be undone.', 'Delete everything');
    if (!ok) return;
    state.clearing = true;
    setSaveState('saved');
    debouncedSave.cancel();
    try { debouncedPrefs.cancel(); } catch (e) { /* noop */ }
    try { await lastSave; } catch (e) { /* noop */ }
    try { await VE.DB.clearAll(); } catch (e) { /* noop */ }
    try { localStorage.removeItem(PREFS_KEY); localStorage.removeItem(LEGACY_PREFS_KEY); } catch (e) { /* noop */ }
    location.reload();
  }

  /* ---------------- preferences ---------------- */

  function saveViewPrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        pps: state.pps, loop: state.loop, muted: state.muted, snap: state.snap
      }));
    } catch (e) { /* noop */ }
  }
  const debouncedPrefs = VE.debounce(saveViewPrefs, 400);

  function restorePrefs() {
    try {
      let raw = localStorage.getItem(PREFS_KEY);
      let migrated = false;
      if (!raw) {
        raw = localStorage.getItem(LEGACY_PREFS_KEY);
        migrated = !!raw;
      }
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (Number.isFinite(p.pps)) state.pps = VE.clamp(p.pps, 8, 320);
        state.loop = !!p.loop;
        state.muted = !!p.muted;
        state.snap = p.snap !== false;
      }
      if (migrated) {
        localStorage.setItem(PREFS_KEY, raw);
        localStorage.removeItem(LEGACY_PREFS_KEY);
      }
    } catch (e) { /* noop */ }
  }

  /* ---------------- init ---------------- */

  function syncStaticUI() {
    if (els.aspectSelect) {
      els.aspectSelect.innerHTML = '';
      VE.ASPECTS.forEach(a => {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = `${a.short} · ${a.name}`;
        els.aspectSelect.appendChild(o);
      });
    }
    if (els.captionStyle) {
      els.captionStyle.innerHTML = '';
      ['subtitle', 'caption', 'karaoke', 'typewriter', 'neon', 'comic'].forEach(id => {
        const preset = VE.TEXT_PRESETS.find(p => p.id === id);
        if (!preset) return;
        const o = document.createElement('option');
        o.value = id;
        o.textContent = preset.label;
        if (id === 'caption') o.selected = true;
        els.captionStyle.appendChild(o);
      });
    }
    if (els.aspectSelect) els.aspectSelect.value = state.project.aspect;
  }

  function toggleDrawer(name) {
    const panel = name === 'library' ? els.libraryPanel : els.inspector;
    if (!panel) return;
    const open = !panel.classList.contains('open');
    document.querySelectorAll('.panel.drawer.open').forEach(p => p.classList.remove('open'));
    if (open) panel.classList.add('open');
    if (els.drawerBackdrop) els.drawerBackdrop.classList.toggle('hidden', !open);
    document.body.classList.toggle('drawer-open', open);
  }

  function closeDrawers() {
    document.querySelectorAll('.panel.drawer.open').forEach(p => p.classList.remove('open'));
    if (els.drawerBackdrop) els.drawerBackdrop.classList.add('hidden');
    document.body.classList.remove('drawer-open');
  }

  const App = {
    state,
    get renderer() { return renderer; },
    get history() { return history; },

    async init() {
      cacheEls();
      VE.hydrateIcons();
      restorePrefs();

      let stored = null;
      let records = [];
      try {
        await VE.DB.ready();
        stored = await VE.DB.loadProject();
        records = await VE.DB.getAllAssets();
      } catch (err) {
        console.warn('Could not read local storage', err);
      }

      loadAssets(records);
      state.project = sanitizeProject(stored) || VE.createProject();

      renderer = new VE.Renderer(els.pool, () => App.invalidate());
      renderer.setMuted(state.muted);
      history = new VE.History(state.project);

      syncStaticUI();
      els.projectName.value = state.project.name;

      VE.Timeline.init(App);
      VE.Inspector.init(App);
      VE.Timeline.setZoom(state.pps);
      renderAssets();
      VE.Timeline.render();
      VE.Inspector.render();
      App.updateTransport();
      updateUndoButtons();
      resizePreview();
      App.invalidate();

      if (VE.AppUI) VE.AppUI.init(App);
      if (VE.CanvasControls) VE.CanvasControls.init(App);

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          state.needsDraw = true;
          App.invalidate();
        }).catch(() => {});
      }

      lastTs = performance.now();
      rafId = requestAnimationFrame(loop);
      state.ready = true;
      setSaveState('saved');

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveNow();
      });
      window.addEventListener('beforeunload', () => { saveNow(); });
    },

    /* public API used by modules */
    invalidate() { state.needsDraw = true; },
    commit,
    scheduleSave,
    selectClip,
    seek,
    play,
    pause,
    togglePlay,
    updateTransport,
    updatePlayhead() { VE.Timeline.updatePlayhead(); },
    updateUndoButtons,
    setAspect,
    addTrack,
    deleteTrack,
    moveTrack,
    toggleTrackGroup,
    setTrackFlag,
    moveLayer,
    toggleClipFlag,
    addShape,
    toggleDrawer,
    closeDrawers,
    splitSelection,
    duplicateSelection,
    deleteSelection,
    detachAudio,
    addAssetToTimeline,
    addAssetToTrack,
    importFiles,
    renderAssets,
    removeAsset,
    relinkAssets,
    saveProjectFile,
    openProjectFile() { els.openProjectInput.value = ''; els.openProjectInput.click(); },
    loadProjectFile,
    newProject,
    resetAllData,
    saveViewPrefs: debouncedPrefs,
    updateStageHint() { App.updateTransport(); },
    getEls() { return els; },
    openExport() {
      if (state.playing) pause();
      VE.Exporter.open(App);
    },
    undo() {
      if (!history) return;
      const next = history.undo();
      if (!next) return;
      applyProject(next);
      VE.toast('Undo');
    },
    redo() {
      if (!history) return;
      const next = history.redo();
      if (!next) return;
      applyProject(next);
      VE.toast('Redo');
    },
    toggleLoop() {
      state.loop = !state.loop;
      App.updateTransport();
      App.saveViewPrefs();
    },
    toggleMute() {
      state.muted = !state.muted;
      renderer.setMuted(state.muted);
      App.updateTransport();
      App.saveViewPrefs();
    },
    toggleSnap() {
      state.snap = !state.snap;
      App.updateTransport();
      App.saveViewPrefs();
    },
    toggleFullscreen() {
      const frame = els.canvasFrame;
      if (!document.fullscreenElement) {
        if (frame.requestFullscreen) frame.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  VE.app = App;

  function bindCore() {
    els.btnPlay.addEventListener('click', () => togglePlay());
    els.btnLoop.addEventListener('click', () => App.toggleLoop());
    els.btnMute.addEventListener('click', () => App.toggleMute());
    els.btnFullscreen.addEventListener('click', () => App.toggleFullscreen());
    els.btnUndo.addEventListener('click', () => App.undo());
    els.btnRedo.addEventListener('click', () => App.redo());
    els.btnSplit.addEventListener('click', () => splitSelection());
    els.btnDuplicate.addEventListener('click', () => duplicateSelection());
    els.btnDelete.addEventListener('click', () => deleteSelection());
    els.btnSnap.addEventListener('click', () => App.toggleSnap());
    els.seekBar.addEventListener('input', () => seek(Number(els.seekBar.value)));
    els.aspectSelect.addEventListener('change', () => setAspect(els.aspectSelect.value));
    els.projectName.addEventListener('change', () => {
      state.project.name = els.projectName.value.trim() || 'Untitled project';
      els.projectName.value = state.project.name;
      commit({ history: true });
    });
    els.projectName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); els.projectName.blur(); }
    });
    els.btnExport.addEventListener('click', () => App.openExport());
    els.btnExportProject.addEventListener('click', () => { closeFileMenu(); App.openExport(); });
    els.btnSaveProject.addEventListener('click', () => { closeFileMenu(); saveProjectFile(); });
    els.btnOpenProject.addEventListener('click', () => { closeFileMenu(); App.openProjectFile(); });
    els.btnNewProject.addEventListener('click', () => { closeFileMenu(); newProject(); });
    els.btnHelp.addEventListener('click', () => { closeFileMenu(); VE.AppUI && VE.AppUI.showHelp(); });
    els.openProjectInput.addEventListener('change', () => {
      const file = els.openProjectInput.files && els.openProjectInput.files[0];
      els.openProjectInput.value = '';
      if (file) loadProjectFile(file);
    });
    els.btnFileMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      els.fileMenu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!els.fileMenu.contains(e.target) && e.target !== els.btnFileMenu) closeFileMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (!state.ready) return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) App.redo(); else App.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault(); App.redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveProjectFile();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault(); duplicateSelection();
      } else if (e.code === 'Space') {
        e.preventDefault(); togglePlay();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection) { e.preventDefault(); deleteSelection(); }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        seek(state.time + (e.key === 'ArrowRight' ? step : -step));
      } else if (e.key === 'Home') {
        e.preventDefault(); seek(0);
      } else if (e.key === 'End') {
        e.preventDefault(); seek(VE.projectDuration(state.project));
      } else if (e.key === 'Escape') {
        if (state.selection) selectClip(null);
      } else if (e.key.toLowerCase() === 's' && !mod) {
        splitSelection();
      } else if (e.key.toLowerCase() === 'm' && !mod) {
        App.toggleMute();
      } else if (e.key === '+' || e.key === '=') {
        VE.Timeline.zoomBy(0.12);
      } else if (e.key === '-') {
        VE.Timeline.zoomBy(-0.12);
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        moveLayer(e.key === ']' ? 1 : -1);
      }
    });

    if (els.btnMobileLibrary) els.btnMobileLibrary.addEventListener('click', () => toggleDrawer('library'));
    if (els.btnMobileInspector) els.btnMobileInspector.addEventListener('click', () => toggleDrawer('inspector'));
    if (els.drawerBackdrop) els.drawerBackdrop.addEventListener('click', closeDrawers);
  }

  function closeFileMenu() {
    if (els.fileMenu) els.fileMenu.classList.remove('open');
  }

  function start() {
    cacheEls();
    bindCore();
    App.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
