/* Timeline: ruler, tracks, clips, drag / trim / snapping / zoom */
(function () {
  const VE = (window.VE = window.VE || {});
  /* Must match --head-w in css/styles.css. */
  const HEAD = 132;

  const TRACK_ICON = { video: 'film', overlay: 'layers', text: 'type', audio: 'music' };

  function ppsFromSlider(v) { return 8 * Math.pow(40, v / 100); }
  function sliderFromPps(pps) { return 100 * Math.log(pps / 8) / Math.log(40); }

  const Timeline = {
    app: null,

    init(app) {
      this.app = app;
      this.tracksEl = document.getElementById('tracks');
      this.rulerEl = document.getElementById('ruler');
      this.scrollEl = document.getElementById('tlScroll');
      this.contentEl = document.getElementById('tlContent');
      this.playheadEl = document.getElementById('playhead');
      this.snapEl = document.getElementById('snapLine');
      this.cornerEl = document.querySelector('.tl-corner span');

      this.tracksEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      this.tracksEl.addEventListener('click', (e) => this.onClick(e));
      this.rulerEl.addEventListener('pointerdown', (e) => this.onScrubStart(e, this.rulerEl));

      this.tracksEl.addEventListener('dragover', (e) => {
        if (e.target.closest('.tl-lane')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      });
      this.tracksEl.addEventListener('drop', (e) => {
        const lane = e.target.closest('.tl-lane');
        if (!lane) return;
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        const rect = lane.getBoundingClientRect();
        const time = Math.max(0, (e.clientX - rect.left) / app.state.pps);
        app.addAssetToTrack(id, lane.dataset.trackId, time);
      });

      this.scrollEl.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const dir = e.deltaY > 0 ? -1 : 1;
        this.zoomBy(dir * 0.12);
      }, { passive: false });

      document.getElementById('btnZoomIn').addEventListener('click', () => this.zoomBy(0.18));
      document.getElementById('btnZoomOut').addEventListener('click', () => this.zoomBy(-0.18));
      document.getElementById('zoomSlider').addEventListener('input', (e) => {
        app.state.pps = VE.clamp(ppsFromSlider(Number(e.target.value)), 8, 320);
        this.render();
        app.saveViewPrefs();
      });

      this.scrollEl.addEventListener('scroll', () => { app.updatePlayhead(); });
      window.addEventListener('resize', VE.debounce(() => this.updatePlayhead(), 100));
    },

    zoomBy(delta) {
      const app = this.app;
      const slider = document.getElementById('zoomSlider');
      const v = VE.clamp(Number(slider.value) + delta * 100, 0, 100);
      slider.value = v;
      app.state.pps = VE.clamp(ppsFromSlider(v), 8, 320);
      this.render();
      app.saveViewPrefs();
    },

    setZoom(pps) {
      const app = this.app;
      app.state.pps = VE.clamp(pps, 8, 320);
      const slider = document.getElementById('zoomSlider');
      slider.value = VE.clamp(sliderFromPps(app.state.pps), 0, 100);
      this.render();
    },

    timeToX(t) { return HEAD + t * this.app.state.pps; },

    render() {
      const app = this.app;
      const project = app.state.project;
      if (!project) return;
      const pps = app.state.pps;
      const duration = Math.max(VE.projectDuration(project), 1);
      const laneW = Math.max(this.scrollEl.clientWidth - HEAD, (duration + 8) * pps, 640);
      this.contentEl.style.width = (HEAD + laneW) + 'px';
      this.contentEl.style.setProperty('--lane-w', laneW + 'px');

      this.renderRuler(duration + 8, pps, laneW);
      this.tracksEl.innerHTML = project.tracks.map((track, i) => this.trackHtml(track, i, pps, laneW)).join('');
      this.updateSelection();
      this.updatePlayhead();
      app.updateTransport();
    },

    renderRuler(span, pps, laneW) {
      const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
      const step = steps.find(s => s * pps >= 66) || 600;
      const minor = step / 5;
      const count = Math.ceil(span / step) + 1;
      let html = '';
      const minorCount = Math.ceil(span / minor) + 1;
      for (let i = 0; i < minorCount; i++) {
        const t = i * minor;
        if (t > span) break;
        const left = t * pps;
        if (left > laneW) break;
        html += `<div class="tick" style="left:${left}px"></div>`;
      }
      for (let i = 0; i < count; i++) {
        const t = i * step;
        if (t > span) break;
        const left = t * pps;
        if (left > laneW) break;
        const label = step < 1 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : VE.fmtClock(t);
        html += `<div class="tick major" style="left:${left}px"><span>${label}</span></div>`;
      }
      this.rulerEl.innerHTML = html;
      this.laneW = laneW;
    },

    trackHtml(track, trackIndex, pps, laneW) {
      const app = this.app;
      const h = track.type === 'audio' ? 62 : 78;
      const iconName = TRACK_ICON[track.type] || 'layers';
      const z = trackIndex + 1;
      const buttons = [];
      if (track.type !== 'audio') {
        buttons.push(`<button data-act="hide" class="${track.hidden ? 'warn' : 'on'}" title="${track.hidden ? 'Show' : 'Hide'} track${track.groupId ? ' (group)' : ''}">${VE.icon(track.hidden ? 'eye-off' : 'eye')}</button>`);
      }
      if (track.type !== 'text') {
        buttons.push(`<button data-act="mute" class="${track.muted ? 'warn' : 'on'}" title="${track.muted ? 'Unmute' : 'Mute'} track${track.groupId ? ' (group)' : ''}">${VE.icon(track.muted ? 'volume-x' : 'volume')}</button>`);
      }
      buttons.push(`<button data-act="lock" class="${track.locked ? 'warn' : ''}" title="${track.locked ? 'Unlock' : 'Lock'} track${track.groupId ? ' (group)' : ''}">${VE.icon(track.locked ? 'lock' : 'unlock')}</button>`);
      buttons.push(`<button data-act="group" class="${track.groupId ? 'grouped' : ''}" title="${track.groupId ? 'Ungroup' : 'Group with adjacent track'}">${VE.icon(track.groupId ? 'ungroup' : 'group')}</button>`);
      buttons.push(`<button data-act="up" title="Move track forward (higher Z)">${VE.icon('up')}</button>`);
      buttons.push(`<button data-act="down" title="Move track backward (lower Z)">${VE.icon('down')}</button>`);
      buttons.push(`<button data-act="del" title="Delete track">${VE.icon('x')}</button>`);

      const head = `<div class="tl-head-cell" style="height:${h}px">
        <div class="track-head${track.groupId ? ' grouped' : ''}">
          <div class="th-top">
            <span class="th-icon">${VE.icon(iconName)}</span>
            <span class="th-name">${VE.escapeHtml(track.name)}</span>
            <span class="th-z" title="Stack order">Z${z}</span>
          </div>
          <div class="th-btns">${buttons.join('')}</div>
        </div>
      </div>`;

      const clips = track.clips.slice().sort((a, b) => a.start - b.start).map(c => this.clipHtml(c, track, pps)).join('');
      return `<div class="tl-row${track.groupId ? ' grouped' : ''}" data-track-row="${track.id}" style="height:${h}px">
        ${head}
        <div class="tl-lane${track.locked ? ' locked' : ''}" data-track-id="${track.id}" style="height:${h}px">${clips}</div>
      </div>`;
    },

    clipHtml(clip, track, pps) {
      const app = this.app;
      const selected = app.state.selection === clip.id ? ' selected' : '';
      const left = Math.max(0, clip.start * pps);
      const width = Math.max(6, clip.duration * pps);
      const asset = clip.assetId ? app.state.assets.get(clip.assetId) : null;
      const thumb = asset && asset.thumb ? ` style="background-image:url('${asset.thumb}')"` : '';
      const iconName = clip.type === 'text' ? 'type' : clip.type === 'audio' ? 'music' : clip.type === 'image' ? 'image' : clip.type === 'shape' ? 'square' : 'film';
      let label = clip.name || 'Clip';
      if (clip.type === 'text') label = (clip.text || 'Text').split('\n')[0] || 'Text';
      label = label.length > 60 ? label.slice(0, 58) + '…' : label;
      const missing = asset && asset.missing ? ' missing' : '';
      const flags = `${clip.locked ? VE.icon('lock') : ''}${clip.hidden ? VE.icon('eye-off') : ''}`;
      const flagClass = clip.locked || clip.hidden ? ' flagged' : '';
      return `<div class="tl-clip type-${clip.type}${selected}${missing}${flagClass}" data-id="${clip.id}"
        style="left:${left}px;width:${width}px" title="${VE.escapeAttr(label)}">
        <div class="clip-thumb"${thumb}></div>
        <div class="clip-label">${VE.icon(iconName)}<span>${VE.escapeHtml(label)}</span></div>
        ${flags ? `<div class="clip-flags">${flags}</div>` : ''}
        <div class="trim trim-l" data-trim="l"></div>
        <div class="trim trim-r" data-trim="r"></div>
        <div class="clip-handle"></div>
      </div>`;
    },

    updateSelection() {
      const sel = this.app.state.selection;
      this.tracksEl.querySelectorAll('.tl-clip').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === sel);
      });
    },

    updatePlayhead() {
      const app = this.app;
      if (!app.state.project) return;
      const x = this.timeToX(app.state.time);
      this.playheadEl.style.left = x + 'px';
      if (this.cornerEl) this.cornerEl.textContent = VE.fmtTime(app.state.time);
    },

    revealPlayhead() {
      const app = this.app;
      const x = this.timeToX(app.state.time);
      const scroll = this.scrollEl;
      const leftEdge = scroll.scrollLeft + HEAD + 40;
      const rightEdge = scroll.scrollLeft + scroll.clientWidth - 40;
      if (x > rightEdge) scroll.scrollLeft = x - scroll.clientWidth + HEAD + 120;
      else if (x < leftEdge) scroll.scrollLeft = Math.max(0, x - HEAD - 80);
    },

    scrollToTimeCenter(t) {
      const x = this.timeToX(t);
      this.scrollEl.scrollLeft = Math.max(0, x - this.scrollEl.clientWidth / 2);
    },

    showSnap(t) {
      this.snapEl.classList.remove('hidden');
      this.snapEl.style.left = this.timeToX(t) + 'px';
    },

    hideSnap() {
      this.snapEl.classList.add('hidden');
    },

    collectSnapPoints(project, excludeId, time) {
      const pts = [0, time];
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          if (clip.id === excludeId) continue;
          pts.push(clip.start, clip.start + clip.duration);
        }
      }
      return pts;
    },

    findSnap(value, points, pps, dur = 0) {
      const tol = 7 / pps;
      let best = null;
      let bestD = tol;
      for (const p of points) {
        const d = Math.abs(value - p);
        if (d < bestD) { bestD = d; best = p; }
        if (dur) {
          const d2 = Math.abs(value + dur - p);
          if (d2 < bestD) { bestD = d2; best = p - dur; }
        }
      }
      return best;
    },

    onPointerDown(e) {
      if (e.button !== 0) return;
      const clipEl = e.target.closest('.tl-clip');
      if (clipEl) {
        this.startClipDrag(e, clipEl);
        return;
      }
      const lane = e.target.closest('.tl-lane');
      if (lane) this.onScrubStart(e, lane);
    },

    onClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-track-row]');
      if (!row) return;
      const app = this.app;
      const track = app.state.project.tracks.find(t => t.id === row.dataset.trackRow);
      if (!track) return;
      const act = btn.dataset.act;
      if (act === 'hide' || act === 'mute' || act === 'lock') app.setTrackFlag(track.id, act);
      else if (act === 'group') app.toggleTrackGroup(track.id);
      else if (act === 'up') app.moveTrack(track.id, 1);
      else if (act === 'down') app.moveTrack(track.id, -1);
      else if (act === 'del') app.deleteTrack(track.id);
    },

    onScrubStart(e, el) {
      const app = this.app;
      const rect = el.getBoundingClientRect();
      const pps = app.state.pps;
      const seek = (ev) => {
        const t = Math.max(0, (ev.clientX - rect.left) / pps);
        app.seek(t, false);
        app.updatePlayhead();
      };
      this.scrollEl.classList.add('scrubbing');
      seek(e);
      const onMove = (ev) => seek(ev);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        this.scrollEl.classList.remove('scrubbing');
        app.saveViewPrefs();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    },

    startClipDrag(e, clipEl) {
      const app = this.app;
      const project = app.state.project;
      const found = VE.findClip(project, clipEl.dataset.id);
      if (!found) return;
      const { clip, track } = found;
      app.selectClip(clip.id);
      if (track.locked || clip.locked) {
        VE.toast('This layer or track is locked', 'warn');
        return;
      }
      e.preventDefault();

      const isTrimL = !!e.target.closest('.trim-l');
      const isTrimR = !!e.target.closest('.trim-r');
      const mode = isTrimL ? 'left' : isTrimR ? 'right' : 'move';
      const pps = app.state.pps;
      const startX = e.clientX;
      const orig = { start: clip.start, duration: clip.duration, inPoint: clip.inPoint };
      const asset = clip.assetId ? app.state.assets.get(clip.assetId) : null;
      const maxDur = VE.assetDurationLimit(clip, asset);
      const snapPoints = app.state.snap ? this.collectSnapPoints(project, clip.id, app.state.time) : [];
      const handle = clipEl.querySelector('.clip-handle');
      let moved = false;

      const setHandle = (t) => {
        if (handle) handle.textContent = VE.fmtTime(t);
      };

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 2) return;
        moved = true;
        const dt = dx / pps;
        let snapAt = null;

        if (mode === 'move') {
          let ns = Math.max(0, orig.start + dt);
          if (app.state.snap) {
            const snap = this.findSnap(ns, snapPoints, pps, orig.duration);
            if (snap !== null) { ns = Math.max(0, snap); snapAt = snap; }
          }
          clip.start = ns;
          clipEl.style.left = (ns * pps) + 'px';
          setHandle(ns);
        } else if (mode === 'left') {
          const minStart = Math.max(0, orig.start - orig.inPoint / Math.max(0.05, clip.speed));
          const maxStart = orig.start + orig.duration - 0.1;
          let ns = VE.clamp(orig.start + dt, minStart, maxStart);
          if (app.state.snap) {
            const snap = this.findSnap(ns, snapPoints, pps, 0);
            if (snap !== null && snap >= minStart && snap <= maxStart) { ns = snap; snapAt = snap; }
          }
          const delta = ns - orig.start;
          clip.start = ns;
          clip.duration = Math.max(0.1, orig.duration - delta);
          clip.inPoint = Math.max(0, orig.inPoint + delta * clip.speed);
          clipEl.style.left = (ns * pps) + 'px';
          clipEl.style.width = (clip.duration * pps) + 'px';
          setHandle(ns);
        } else {
          let nd = VE.clamp(orig.duration + dt, 0.1, maxDur);
          if (app.state.snap) {
            const snap = this.findSnap(orig.start + nd, snapPoints, pps, 0);
            if (snap !== null) { nd = VE.clamp(snap - orig.start, 0.1, maxDur); snapAt = snap; }
          }
          clip.duration = nd;
          clipEl.style.width = (nd * pps) + 'px';
          setHandle(orig.start + nd);
        }

        clipEl.classList.add('dragging');
        if (snapAt !== null) this.showSnap(snapAt); else this.hideSnap();
        app.invalidate();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        clipEl.classList.remove('dragging');
        this.hideSnap();
        if (moved) {
          clip.duration = Math.max(0.1, clip.duration);
          clip.name = clip.name;
          app.commit({ history: true, timeline: true, inspector: true });
        } else {
          app.selectClip(clip.id);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },

    updateClipLabel(clip) {
      const el = this.tracksEl.querySelector(`.tl-clip[data-id="${clip.id}"] .clip-label span`);
      if (!el) return;
      let label = clip.type === 'text' ? (clip.text || 'Text').split('\n')[0] : clip.name;
      label = String(label || '').slice(0, 60);
      el.textContent = label;
    },

    refreshClip(clip) {
      const el = this.tracksEl.querySelector(`.tl-clip[data-id="${clip.id}"]`);
      if (!el) return;
      el.style.left = (clip.start * this.app.state.pps) + 'px';
      el.style.width = (Math.max(0.1, clip.duration) * this.app.state.pps) + 'px';
      this.updateClipLabel(clip);
    }
  };

  VE.Timeline = Timeline;
})();
