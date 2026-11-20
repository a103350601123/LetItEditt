/* Canvas controls: on-preview selection, move, resize and rotate handles */
(function () {
  const VE = (window.VE = window.VE || {});

  const HANDLE_R = 6;
  const HIT_R = 14;
  const ROTATE_GAP = 28;
  const MIN_SIDE = 22;

  let app = null;
  let frame = null;
  let preview = null;
  let overlay = null;
  let ctx = null;
  let dragging = null;
  let hadOverlay = false;
  let raf = 0;

  function activeClipAt(time) {
    const project = app.state.project;
    if (!project) return null;
    for (let ti = project.tracks.length - 1; ti >= 0; ti--) {
      const track = project.tracks[ti];
      if (track.type === 'audio' || track.hidden) continue;
      for (let ci = track.clips.length - 1; ci >= 0; ci--) {
        const clip = track.clips[ci];
        if (clip.hidden) continue;
        const local = time - clip.start;
        if (local >= 0 && local < clip.duration) return { clip, track };
      }
    }
    return null;
  }

  function selectionContext() {
    const id = app.state.selection;
    if (!id || !app.state.project) return null;
    const found = VE.findClip(app.state.project, id);
    if (!found) return null;
    const active = activeClipAt(app.state.time);
    return { found, active: !!active && active.clip.id === id };
  }

  function measure() {
    const fr = frame.getBoundingClientRect();
    const pr = preview.getBoundingClientRect();
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(fr.width * dpr));
    const h = Math.max(1, Math.round(fr.height * dpr));
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    const cssW = fr.width.toFixed(1) + 'px';
    const cssH = fr.height.toFixed(1) + 'px';
    if (overlay.style.width !== cssW) overlay.style.width = cssW;
    if (overlay.style.height !== cssH) overlay.style.height = cssH;
    return { fr, pr, dpr, sx: pr.width / Math.max(1, preview.width), sy: pr.height / Math.max(1, preview.height) };
  }

  function boundsFor(clip, m) {
    const b = app.renderer.clipBounds(clip, preview.width, preview.height, app.state.assets);
    return {
      cx: (m.pr.left - m.fr.left) + b.x * m.sx,
      cy: (m.pr.top - m.fr.top) + b.y * m.sy,
      w: Math.max(MIN_SIDE, b.w * m.sx),
      h: Math.max(MIN_SIDE, b.h * m.sy),
      rot: b.rot || 0
    };
  }

  function rotatePoint(cx, cy, lx, ly, deg) {
    const a = (deg || 0) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
  }

  function handles(b) {
    const hw = b.w / 2, hh = b.h / 2;
    return [
      rotatePoint(b.cx, b.cy, -hw, -hh, b.rot),
      rotatePoint(b.cx, b.cy, hw, -hh, b.rot),
      rotatePoint(b.cx, b.cy, hw, hh, b.rot),
      rotatePoint(b.cx, b.cy, -hw, hh, b.rot),
      rotatePoint(b.cx, b.cy, 0, -hh - ROTATE_GAP, b.rot)
    ];
  }

  function localPoint(p, b) {
    const dx = p.x - b.cx, dy = p.y - b.cy;
    const a = -(b.rot || 0) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  function hitTest(p, b) {
    const hs = handles(b);
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(p.x - hs[i].x, p.y - hs[i].y) <= HIT_R) return { mode: 'resize', corner: i };
    }
    if (Math.hypot(p.x - hs[4].x, p.y - hs[4].y) <= HIT_R) return { mode: 'rotate' };
    const l = localPoint(p, b);
    if (Math.abs(l.x) <= b.w / 2 + 3 && Math.abs(l.y) <= b.h / 2 + 3) return { mode: 'move' };
    return null;
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function badge(text) {
    ctx.font = '600 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 16;
    const h = 24;
    const x = Math.max(8, (frame.clientWidth - w) / 2);
    const y = 10;
    ctx.fillStyle = 'rgba(12,15,24,.92)';
    ctx.strokeStyle = 'rgba(124,92,255,.55)';
    ctx.lineWidth = 1;
    roundRectPath(x, y, w, h, 7);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dfe3f2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + h / 2);
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (!app || !app.state.project || app.state.exporting) {
      if (hadOverlay) { ctx.clearRect(0, 0, overlay.width, overlay.height); hadOverlay = false; }
      return;
    }
    const sc = selectionContext();
    if (!sc && !dragging) {
      if (hadOverlay) { ctx.clearRect(0, 0, overlay.width, overlay.height); hadOverlay = false; }
      return;
    }
    const m = measure();
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    ctx.clearRect(0, 0, m.fr.width, m.fr.height);
    hadOverlay = true;
    if (!sc) return;
    if (!sc.active) {
      badge('Move the playhead over the selected layer');
      return;
    }
    const b = boundsFor(sc.found.clip, m);
    const hs = handles(b);

    ctx.save();
    ctx.translate(b.cx, b.cy);
    ctx.rotate((b.rot || 0) * Math.PI / 180);
    ctx.strokeStyle = '#a99bff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 4]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, -b.h / 2);
    ctx.lineTo(0, -b.h / 2 - ROTATE_GAP);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#7c5cff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(hs[i].x - HANDLE_R, hs[i].y - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#ffe14d';
    ctx.strokeStyle = '#0b0d13';
    ctx.beginPath();
    ctx.arc(hs[4].x, hs[4].y, HANDLE_R + 1, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    const label = `${VE.trackKindName(sc.found.track.type)} · ${sc.found.clip.type}`;
    ctx.font = '600 10px system-ui, sans-serif';
    const lw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(12,15,24,.86)';
    roundRectPath(Math.max(4, hs[0].x - lw / 2), Math.max(4, hs[0].y - 28), lw, 19, 5);
    ctx.fill();
    ctx.fillStyle = '#e9ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, Math.max(4, hs[0].x), Math.max(4, hs[0].y - 18.5));
  }

  function overlayPoint(e) {
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (!app || !app.state.project || app.state.exporting) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const m = measure();
    let sc = selectionContext();
    if (!sc || !sc.active) {
      const active = activeClipAt(app.state.time);
      if (!active) {
        if (app.state.selection) app.selectClip(null);
        return;
      }
      app.selectClip(active.clip.id);
      sc = selectionContext();
    }
    if (!sc || !sc.active) return;

    const { clip, track } = sc.found;
    const p = overlayPoint(e);
    const b = boundsFor(clip, m);
    const hit = hitTest(p, b);
    if (!hit) {
      app.selectClip(null);
      return;
    }
    if (track.locked || clip.locked) {
      VE.toast('This layer or track is locked', 'warn');
      return;
    }

    e.preventDefault();
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    const lp = localPoint(p, b);
    dragging = {
      pointerId: e.pointerId,
      mode: hit.mode,
      corner: hit.corner,
      clipId: clip.id,
      start: p,
      startLocal: lp,
      bounds: b,
      startAngle: Math.atan2(p.y - b.cy, p.x - b.cx) * 180 / Math.PI,
      base: {
        x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation || 0,
        shapeWidth: clip.shapeWidth, shapeHeight: clip.shapeHeight
      },
      moved: false
    };
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const found = VE.findClip(app.state.project, dragging.clipId);
    if (!found) { dragging = null; return; }
    const clip = found.clip;
    const p = overlayPoint(e);
    const dx = p.x - dragging.start.x;
    const dy = p.y - dragging.start.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !dragging.moved) return;
    dragging.moved = true;
    e.preventDefault();

    if (dragging.mode === 'move') {
      const m = measure();
      clip.x = VE.clamp(dragging.base.x + dx / Math.max(1, m.pr.width), -1, 2);
      clip.y = VE.clamp(dragging.base.y + dy / Math.max(1, m.pr.height), -1, 2);
    } else if (dragging.mode === 'resize') {
      const b = dragging.bounds;
      const nowLocal = localPoint(p, b);
      const dlx = nowLocal.x - dragging.startLocal.x;
      const dly = nowLocal.y - dragging.startLocal.y;
      const c = dragging.corner;
      const right = c === 1 || c === 2;
      const left = c === 0 || c === 3;
      const bottom = c === 2 || c === 3;
      const top = c === 0 || c === 1;
      const newW = Math.max(MIN_SIDE, b.w + (right ? 2 * dlx : left ? -2 * dlx : 0));
      const newH = Math.max(MIN_SIDE, b.h + (bottom ? 2 * dly : top ? -2 * dly : 0));
      const rw = newW / Math.max(1, b.w);
      const rh = newH / Math.max(1, b.h);
      if (clip.type === 'shape') {
        clip.shapeWidth = VE.clamp(dragging.base.shapeWidth * rw, 0.02, 2);
        clip.shapeHeight = VE.clamp(dragging.base.shapeHeight * rh, 0.02, 2);
      } else {
        clip.scale = VE.clamp(dragging.base.scale * (rw + rh) / 2, 0.1, 3);
      }
    } else if (dragging.mode === 'rotate') {
      const angle = Math.atan2(p.y - dragging.bounds.cy, p.x - dragging.bounds.cx) * 180 / Math.PI;
      let delta = angle - dragging.startAngle;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      clip.rotation = dragging.base.rotation + delta;
    }
    app.invalidate();
  }

  function onPointerUp(e) {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    try { overlay.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    const moved = dragging.moved;
    dragging = null;
    if (moved) app.commit({ history: true, inspector: true });
  }

  const CanvasControls = {
    init(appInstance) {
      app = appInstance;
      const els = app.getEls();
      frame = els.canvasFrame || document.getElementById('canvasFrame');
      preview = els.preview || document.getElementById('preview');
      overlay = els.overlayCanvas || document.getElementById('overlayCanvas');
      if (!frame || !preview || !overlay) return;
      ctx = overlay.getContext('2d');
      overlay.addEventListener('pointerdown', onPointerDown);
      overlay.addEventListener('pointermove', onPointerMove);
      overlay.addEventListener('pointerup', onPointerUp);
      overlay.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('resize', () => { hadOverlay = false; });
      document.addEventListener('fullscreenchange', () => { hadOverlay = false; });
      if (!raf) raf = requestAnimationFrame(draw);
    }
  };

  VE.CanvasControls = CanvasControls;
})();
