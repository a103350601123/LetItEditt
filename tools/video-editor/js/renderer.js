/* Rendering engine: canvas compositor, media pool and audio graph */
(function () {
  const VE = (window.VE = window.VE || {});

  VE.dimsForAspect = function (aspectId, shortSide) {
    const a = VE.ASPECT_MAP[aspectId] || VE.ASPECTS[0];
    const scale = shortSide / Math.min(a.w, a.h);
    return { w: Math.round(a.w * scale), h: Math.round(a.h * scale) };
  };

  function layoutLines(ctx, text, maxW) {
    const lines = [];
    const spaceW = ctx.measureText(' ').width;
    const rawLines = String(text == null ? '' : text).split('\n');
    for (const raw of rawLines) {
      const words = raw.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push({ words: [], w: 0 }); continue; }
      let line = { words: [], w: 0 };
      for (const word of words) {
        const w = ctx.measureText(word).width;
        const gap = line.words.length ? spaceW : 0;
        if (line.words.length && line.w + gap + w > maxW) {
          lines.push(line);
          line = { words: [], w: 0 };
        }
        const gap2 = line.words.length ? spaceW : 0;
        const x = line.w + gap2;
        line.words.push({ text: word, w, x });
        line.w = x + w;
      }
      lines.push(line);
    }
    return lines;
  }

  function drawRounded(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function applyTransition(state, type, p) {
    switch (type) {
      case 'fade':
        state.a *= p;
        break;
      case 'slide-left':
        state.tx += -(1 - p) * 0.35;
        break;
      case 'slide-right':
        state.tx += (1 - p) * 0.35;
        break;
      case 'slide-up':
        state.ty += (1 - p) * 0.35;
        break;
      case 'zoom':
        state.s *= 0.72 + 0.28 * p;
        state.a *= Math.min(1, p * 1.6);
        break;
      case 'wipe':
        state.wipe = Math.min(state.wipe, p);
        break;
      case 'blur':
        state.blur += (1 - p) * 16;
        state.a *= p;
        break;
    }
  }

  function transitionFor(clip, local) {
    const st = { a: 1, tx: 0, ty: 0, s: 1, wipe: 1, blur: 0 };
    const tin = clip.transitionIn || {};
    const tout = clip.transitionOut || {};
    if (tin.type && tin.type !== 'none' && tin.duration > 0 && local < tin.duration) {
      applyTransition(st, tin.type, VE.clamp(local / tin.duration, 0, 1));
    }
    const remain = clip.duration - local;
    if (tout.type && tout.type !== 'none' && tout.duration > 0 && remain < tout.duration) {
      applyTransition(st, tout.type, VE.clamp(remain / tout.duration, 0, 1));
    }
    return st;
  }

  VE.Renderer = class Renderer {
    constructor(poolEl, onInvalidate) {
      this.poolEl = poolEl;
      this.onInvalidate = onInvalidate || (() => {});
      this.elements = new Map();
      this.images = new Map();
      this.audio = null;
      this.initAudio();
    }

    initAudio() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const master = ctx.createGain();
        const monitor = ctx.createGain();
        master.gain.value = 1;
        monitor.gain.value = 1;
        master.connect(monitor);
        monitor.connect(ctx.destination);
        this.audio = { ctx, master, monitor };
      } catch (err) {
        console.warn('Audio graph unavailable', err);
      }
    }

    ensureAudio() {
      if (!this.audio) this.initAudio();
      if (this.audio && this.audio.ctx.state === 'suspended') {
        this.audio.ctx.resume().catch(() => {});
      }
      return this.audio;
    }

    setMuted(muted) {
      if (this.audio) this.audio.monitor.gain.value = muted ? 0 : 1;
      this.muted = muted;
    }

    attachElement(el) {
      if (!this.audio || el.__cfAttached) return;
      try {
        const src = this.audio.ctx.createMediaElementSource(el);
        const gain = this.audio.ctx.createGain();
        gain.gain.value = 1;
        src.connect(gain);
        gain.connect(this.audio.master);
        el.__cfAttached = true;
        el.__cfGain = gain;
      } catch (err) {
        /* element already attached or audio unavailable */
      }
    }

    getImage(asset) {
      let img = this.images.get(asset.id);
      if (!img) {
        img = new Image();
        img.decoding = 'async';
        img.src = asset.url;
        img.onload = () => this.onInvalidate();
        this.images.set(asset.id, img);
      }
      return img;
    }

    getElement(clip, asset) {
      if (clip.type === 'image') return this.getImage(asset);
      let rec = this.elements.get(clip.id);
      if (rec && rec.url !== asset.url) {
        this.disposeClip(clip.id);
        rec = null;
      }
      if (!rec) {
        const el = document.createElement(clip.type === 'audio' ? 'audio' : 'video');
        el.preload = 'auto';
        el.playsInline = true;
        el.crossOrigin = 'anonymous';
        el.volume = 1;
        el.src = asset.url;
        el.addEventListener('seeked', () => this.onInvalidate());
        el.addEventListener('loadeddata', () => this.onInvalidate());
        el.addEventListener('error', () => {
          if (clip.assetId && !asset.missing) console.warn('Media error for', clip.name);
        });
        this.attachElement(el);
        this.poolEl.appendChild(el);
        rec = { el, kind: clip.type, url: asset.url };
        this.elements.set(clip.id, rec);
      }
      return rec.el;
    }

    disposeClip(clipId) {
      const rec = this.elements.get(clipId);
      if (!rec) return;
      try {
        rec.el.pause();
        rec.el.removeAttribute('src');
        rec.el.load();
      } catch (e) { /* noop */ }
      rec.el.remove();
      this.elements.delete(clipId);
    }

    prune(project) {
      const live = new Set();
      project.tracks.forEach(t => t.clips.forEach(c => live.add(c.id)));
      for (const id of Array.from(this.elements.keys())) {
        if (!live.has(id)) this.disposeClip(id);
      }
    }

    sync(project, time, playing, assets) {
      const seen = new Set();
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          if (clip.type !== 'video' && clip.type !== 'audio') continue;
          const asset = assets.get(clip.assetId);
          if (!asset || asset.missing) continue;
          seen.add(clip.id);
          const el = this.getElement(clip, asset);
          const local = time - clip.start;
          const active = local >= 0 && local < clip.duration;
          const end = asset.duration - 0.04;
          const expected = Math.max(0, Math.min(end, clip.inPoint + local * clip.speed));

          if (!active) {
            if (!el.paused) el.pause();
            el.__cfActive = false;
            if (el.__cfGain) el.__cfGain.gain.value = 0;
            continue;
          }

          el.playbackRate = VE.clamp(clip.speed, 0.0625, 16);

          if (playing) {
            if (el.__cfActive !== true) {
              try { el.currentTime = expected; } catch (e) { /* noop */ }
              el.play().catch(() => {});
              el.__cfActive = true;
            } else if (Math.abs(el.currentTime - expected) > 0.32) {
              try { el.currentTime = expected; } catch (e) { /* noop */ }
            }
            if (el.paused && expected < end - 0.02) el.play().catch(() => {});
          } else {
            if (!el.paused) el.pause();
            el.__cfActive = false;
            if (Math.abs(el.currentTime - expected) > 0.03) {
              try { el.currentTime = expected; } catch (e) { /* noop */ }
            }
          }

          if (el.__cfGain) {
            let g = VE.clamp(clip.volume, 0, 1);
            const fadeIn = clip.fadeIn || 0;
            const fadeOut = clip.fadeOut || 0;
            if (fadeIn > 0 && local < fadeIn) g *= VE.clamp(local / fadeIn, 0, 1);
            if (fadeOut > 0 && (clip.duration - local) < fadeOut) g *= VE.clamp((clip.duration - local) / fadeOut, 0, 1);
            if (track.muted) g = 0;
            el.__cfGain.gain.value = g;
          }
        }
      }
      for (const [id, rec] of this.elements) {
        if (!seen.has(id) && !rec.el.paused) rec.el.pause();
      }
    }

    stopAll() {
      for (const rec of this.elements.values()) {
        if (!rec.el.paused) rec.el.pause();
        rec.el.__cfActive = false;
      }
    }

    draw(ctx, project, time, assets) {
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = project.background || '#000000';
      ctx.fillRect(0, 0, W, H);

      for (const track of project.tracks) {
        if (track.type === 'audio' || track.hidden) continue;
        for (const clip of track.clips) {
          const local = time - clip.start;
          if (local < 0 || local >= clip.duration) continue;
          this.drawClip(ctx, project, track, clip, local, W, H, assets);
        }
      }
      ctx.restore();
    }

    drawClip(ctx, project, track, clip, local, W, H, assets) {
      const tr = transitionFor(clip, local);
      if (tr.a <= 0.001) return;

      ctx.save();
      ctx.globalAlpha = VE.clamp(clip.opacity, 0, 1) * tr.a;
      if (tr.wipe < 1) {
        ctx.beginPath();
        ctx.rect(0, 0, W * tr.wipe, H);
        ctx.clip();
      }

      if (clip.type === 'text') {
        this.drawText(ctx, clip, local, W, H, tr);
        ctx.restore();
        return;
      }

      const asset = assets.get(clip.assetId);
      if (!asset || asset.missing) { ctx.restore(); return; }
      const el = this.getElement(clip, asset);
      if (clip.type !== 'image' && el.readyState < 2) { ctx.restore(); return; }
      if (clip.type === 'image' && !el.complete) { ctx.restore(); return; }

      const sw = el.videoWidth || el.naturalWidth || asset.width || 16;
      const sh = el.videoHeight || el.naturalHeight || asset.height || 9;
      if (!sw || !sh) { ctx.restore(); return; }

      const fitScale = clip.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
      const scale = fitScale * (clip.scale || 1) * tr.s;
      const dw = sw * scale;
      const dh = sh * scale;

      let filter = 'none';
      const preset = VE.FILTER_MAP[clip.filter];
      if (preset && preset.css !== 'none') filter = preset.css;
      if (tr.blur > 0) {
        const blurPx = (tr.blur * W) / 1280;
        filter = (filter === 'none' ? '' : filter + ' ') + `blur(${blurPx.toFixed(2)}px)`;
      }
      ctx.filter = filter;

      ctx.translate((clip.x * W) + tr.tx * W, (clip.y * H) + tr.ty * H);
      ctx.rotate((clip.rotation || 0) * Math.PI / 180);
      try {
        ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
      } catch (e) { /* frame not ready */ }
      ctx.filter = 'none';
      ctx.restore();
    }

    drawText(ctx, clip, local, W, H, tr) {
      const text = String(clip.text == null ? '' : clip.text);
      if (!text.trim()) return;

      const scale = (clip.scale || 1) * tr.s;
      const fs = Math.max(6, (clip.fontSize || 56) * (H / 1080) * scale);
      const maxW = Math.max(30, W * VE.clamp(clip.textWidth || 0.86, 0.1, 1) * scale);
      const family = `"${clip.fontFamily || 'Inter'}", Inter, "Segoe UI", sans-serif`;
      const weight = clip.bold === false ? 400 : 700;
      const style = clip.italic ? 'italic ' : '';
      ctx.font = `${style}${weight} ${fs}px ${family}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      const progress = VE.clamp(local / clip.duration, 0, 1);
      const styleId = clip.style || 'plain';
      const lineHeight = fs * (clip.lineHeight || 1.22);
      const pad = fs * 0.36;
      let display = text;

      if (styleId === 'comic') display = text.toUpperCase();
      if (styleId === 'typewriter') {
        const reveal = VE.clamp(local / Math.max(0.4, clip.duration * 0.62), 0, 1);
        const chars = Math.floor(text.length * reveal);
        display = chars >= text.length ? text : text.slice(0, Math.max(0, chars));
      }

      const lines = layoutLines(ctx, display, maxW);
      const totalW = Math.max(0, ...lines.map(l => l.w));
      const totalH = Math.max(lineHeight, lines.length * lineHeight);
      const startY = -totalH / 2 + lineHeight / 2;

      ctx.translate((clip.x * W) + tr.tx * W, (clip.y * H) + tr.ty * H);
      ctx.rotate((clip.rotation || 0) * Math.PI / 180);
      if (styleId === 'comic') ctx.rotate(-0.04);

      const alignedStart = (line) => {
        if (styleId === 'lowerthird') return -totalW / 2;
        if (clip.align === 'left') return -totalW / 2;
        if (clip.align === 'right') return totalW / 2 - line.w;
        return -line.w / 2;
      };

      const paint = (fill, opts = {}) => {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const x0 = alignedStart(line);
          const y = startY + i * lineHeight;
          for (const word of line.words) {
            if (opts.stroke) {
              ctx.strokeStyle = opts.stroke;
              ctx.lineWidth = opts.lineWidth || fs * 0.1;
              ctx.strokeText(word.text, x0 + word.x, y);
            }
            ctx.fillStyle = fill;
            ctx.fillText(word.text, x0 + word.x, y);
          }
        }
      };

      const bgBox = (fill, radius, padY) => {
        const w = totalW + pad * 2;
        const h = totalH + padY * 2;
        ctx.fillStyle = fill;
        drawRounded(ctx, -w / 2, -h / 2, w, h, radius);
        ctx.fill();
      };

      const color = clip.color || '#ffffff';
      const bg = clip.bgColor || '#000000';

      switch (styleId) {
        case 'subtitle': {
          bgBox(VE.hexToRgba(bg, 0.62), fs * 0.24, pad * 0.55);
          ctx.shadowColor = 'rgba(0,0,0,.35)';
          ctx.shadowBlur = fs * 0.2;
          paint('#ffffff');
          break;
        }
        case 'boxed': {
          bgBox(bg, fs * 0.2, pad * 0.5);
          paint(color);
          break;
        }
        case 'karaoke': {
          const totalWords = lines.reduce((n, l) => n + l.words.length, 0);
          const activeIndex = Math.floor(progress * totalWords);
          let wi = 0;
          ctx.shadowColor = 'rgba(0,0,0,.5)';
          ctx.shadowBlur = fs * 0.25;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const x0 = alignedStart(line);
            const y = startY + i * lineHeight;
            for (const word of line.words) {
              const active = wi === activeIndex;
              ctx.fillStyle = active ? color : 'rgba(255,255,255,.82)';
              if (active) {
                ctx.shadowColor = color;
                ctx.shadowBlur = fs * 0.55;
              } else {
                ctx.shadowColor = 'rgba(0,0,0,.5)';
                ctx.shadowBlur = fs * 0.22;
              }
              ctx.fillText(word.text, x0 + word.x, y);
              wi++;
            }
          }
          break;
        }
        case 'neon': {
          ctx.shadowColor = color;
          ctx.shadowBlur = fs * 0.6;
          paint(color);
          ctx.shadowBlur = fs * 0.25;
          paint(color);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,.55)';
          ctx.lineWidth = Math.max(1, fs * 0.035);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const x0 = alignedStart(line);
            const y = startY + i * lineHeight;
            for (const word of line.words) ctx.strokeText(word.text, x0 + word.x, y);
          }
          break;
        }
        case 'comic': {
          ctx.shadowColor = 'rgba(0,0,0,.55)';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = fs * 0.06;
          ctx.shadowOffsetY = fs * 0.08;
          paint(color, { stroke: '#111111', lineWidth: fs * 0.18 });
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          break;
        }
        case 'typewriter': {
          paint(color);
          if (display.length < text.length) {
            const last = lines[lines.length - 1];
            const x = alignedStart(last) + last.w + fs * 0.06;
            const y = startY + (lines.length - 1) * lineHeight;
            ctx.fillStyle = color;
            ctx.globalAlpha *= 0.8;
            ctx.fillRect(x, y - fs * 0.45, fs * 0.12, fs * 0.9);
          }
          break;
        }
        case 'lowerthird': {
          const w = totalW + pad * 2 + fs * 0.5;
          const h = totalH + pad * 1.1;
          ctx.fillStyle = VE.hexToRgba(bg, 0.9);
          drawRounded(ctx, -w / 2, -h / 2, w, h, fs * 0.14);
          ctx.fill();
          ctx.fillStyle = color;
          drawRounded(ctx, -w / 2, -h / 2, fs * 0.16, h, fs * 0.06);
          ctx.fill();
          paint('#ffffff');
          break;
        }
        case 'outline': {
          ctx.shadowColor = 'rgba(0,0,0,.45)';
          ctx.shadowBlur = fs * 0.2;
          paint(color, { stroke: '#0b0d12', lineWidth: fs * 0.14 });
          break;
        }
        case 'gradient': {
          const g = ctx.createLinearGradient(-totalW / 2, 0, totalW / 2, 0);
          g.addColorStop(0, color);
          g.addColorStop(1, clip.color2 || '#3ba0ff');
          ctx.shadowColor = 'rgba(0,0,0,.4)';
          ctx.shadowBlur = fs * 0.25;
          paint(g);
          break;
        }
        default: {
          ctx.shadowColor = 'rgba(0,0,0,.55)';
          ctx.shadowBlur = fs * 0.28;
          ctx.shadowOffsetY = fs * 0.04;
          paint(color);
          ctx.shadowOffsetY = 0;
          break;
        }
      }
    }
  };
})();
