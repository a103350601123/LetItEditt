/* Rendering engine: canvas compositor, animation/effects pipeline, media pool, audio graph */
(function () {
  const VE = (window.VE = window.VE || {});

  VE.dimsForAspect = function (aspectId, shortSide) {
    const a = VE.ASPECT_MAP[aspectId] || VE.ASPECTS[0];
    const scale = shortSide / Math.min(a.w, a.h);
    return { w: Math.round(a.w * scale), h: Math.round(a.h * scale) };
  };

  const clamp01 = p => Math.min(1, Math.max(0, p));
  const easeOut = p => 1 - Math.pow(1 - clamp01(p), 3);
  const easeIn = p => Math.pow(clamp01(p), 3);
  const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const easeOutBack = p => {
    const c1 = 1.70158, c3 = c1 + 1, q = clamp01(p) - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
  };
  const elastic = p => {
    const q = clamp01(p);
    if (q === 0 || q === 1) return q;
    return Math.pow(2, -10 * q) * Math.sin((q * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  };
  const bounce = p => {
    let q = clamp01(p);
    const n1 = 7.5625, d1 = 2.75;
    if (q < 1 / d1) return n1 * q * q;
    if (q < 2 / d1) { q -= 1.5 / d1; return n1 * q * q + 0.75; }
    if (q < 2.5 / d1) { q -= 2.25 / d1; return n1 * q * q + 0.9375; }
    q -= 2.625 / d1; return n1 * q * q + 0.984375;
  };
  const dirVec = dir => ({ left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] }[dir] || [-1, 0]);

  /* Pure animation evaluator: shared by preview, export and self-tests. */
  VE.animationState = function (clip, local) {
    const spec = VE.ANIM_MAP[clip && clip.animationId] || VE.ANIMATIONS[0];
    const st = {
      a: 1, tx: 0, ty: 0, s: 1, rot: 0, blur: 0,
      reveal: 1, revealDir: spec.direction || 'left', iris: false,
      chars: null, highlight: 0, underline: 0, strike: 0, glow: 0,
      flipX: 1, flipY: 1, glitch: 0, sparkle: 0, motion: spec.motion
    };
    if (spec.motion === 'none') return st;
    const dur = Math.max(0.05, Number(clip.animDuration) || spec.duration || 0.6);
    const speed = VE.clamp(Number(clip.animSpeed) || 1, 0.1, 4);
    const delay = Number(clip.animDelay) || 0;
    const dir = clip.animDirection || spec.direction || 'left';
    const [dx, dy] = dirVec(dir);
    const t = (local - delay) * speed;
    let p = 0;
    if (spec.phase === 'out') p = clamp01((clip.duration - local - delay) * speed / dur);
    else if (spec.phase === 'loop') {
      const cycle = ((t % (dur * 2)) + dur * 2) % (dur * 2);
      p = cycle < dur ? cycle / dur : 2 - cycle / dur;
    } else if (spec.phase === 'continuous') p = (((t % dur) + dur) % dur) / dur;
    else p = clamp01(t / dur);
    const enter = spec.phase === 'in';
    const exit = spec.phase === 'out';
    const k = exit ? p : enter ? 1 - p : p; /* amount of "not yet arrived" */
    const v = 1 - k; /* amount arrived */
    const loop = !enter && !exit;
    const e = easeOut(p);

    switch (spec.motion) {
      case 'fade':
        st.a = exit ? 1 - p : loop ? 0.35 + 0.65 * p : Math.max(0.001, p);
        break;
      case 'pulseAlpha':
        st.a = 0.35 + 0.65 * p;
        break;
      case 'fadeThrough':
        st.a = enter ? easeInOut(p) : 1 - easeInOut(k);
        break;
      case 'slide':
        st.tx = dx * (loop ? (p - 0.5) * 0.16 : k * 0.32);
        st.ty = dy * (loop ? (p - 0.5) * 0.16 : k * 0.32);
        st.a = exit ? 1 - k * 0.55 : Math.min(1, 0.15 + v * 1.3);
        break;
      case 'drift':
        st.tx = dx * 0.16 * (loop ? p - 0.5 : k);
        st.ty = dy * 0.16 * (loop ? p - 0.5 : k);
        st.a = loop ? 0.55 + 0.45 * p : Math.min(1, 0.2 + v * 1.4);
        break;
      case 'zoom':
        st.s = exit ? 1 - 0.45 * p : loop ? 0.94 + 0.12 * p : 0.55 + 0.45 * e;
        st.a = exit ? 1 - p : Math.min(1, 0.1 + v * 1.5);
        break;
      case 'overshoot':
        st.s = exit ? 1 - 0.4 * p : Math.max(0.05, easeOutBack(p));
        st.a = Math.min(1, 0.15 + v * 1.4);
        break;
      case 'punch':
        st.s = exit ? 1 - 0.3 * p : 1 + 0.28 * Math.sin(Math.PI * clamp01(p));
        st.a = Math.min(1, 0.2 + v * 1.4);
        break;
      case 'zoomBlur':
        st.s = exit ? 1 - 0.5 * p : 0.5 + 0.5 * e;
        st.blur = k * 9;
        st.a = Math.min(1, 0.15 + v * 1.4);
        break;
      case 'blur':
        st.blur = k * 12;
        st.a = exit ? 1 - p : Math.min(1, 0.2 + v * 1.4);
        break;
      case 'bounce':
        st.tx = dx * 0.3 * k * (1 - bounce(p));
        st.ty = dy * 0.3 * k * (1 - bounce(p));
        st.a = Math.min(1, 0.2 + v * 1.5);
        break;
      case 'elastic':
        st.tx = dx * 0.24 * k * (1 - elastic(p));
        st.ty = dy * 0.24 * k * (1 - elastic(p));
        st.a = Math.min(1, 0.2 + v * 1.5);
        break;
      case 'spring':
        st.ty = -0.06 * Math.sin(p * Math.PI * 4) * (1 - p * 0.5);
        st.s = 1 + 0.06 * Math.sin(p * Math.PI * 4) * (1 - p * 0.5);
        break;
      case 'type':
        st.chars = exit ? 1 - p : loop ? 0.25 + 0.75 * p : p;
        break;
      case 'typeReverse':
        st.chars = exit ? 1 - p : 1 - easeIn(p);
        break;
      case 'backspace':
        st.chars = 1 - p;
        break;
      case 'wipe':
        st.reveal = exit ? 1 - p : p;
        st.revealDir = dir;
        break;
      case 'curtain':
        st.reveal = exit ? 1 - p : p;
        st.revealDir = 'left';
        st.s = 0.96 + 0.04 * st.reveal;
        break;
      case 'iris':
        st.reveal = exit ? 1 - p : p;
        st.iris = true;
        break;
      case 'blink':
        st.a = p < 0.55 ? 1 : 0.12;
        break;
      case 'flicker':
        st.a = 0.45 + 0.55 * Math.abs(Math.sin(local * 31));
        break;
      case 'glow':
        st.glow = p;
        st.s = 1 + 0.03 * p;
        break;
      case 'highlight':
        st.highlight = p;
        break;
      case 'underline':
        st.underline = exit ? 1 - p : p;
        break;
      case 'strike':
        st.strike = p;
        break;
      case 'neonFlicker':
        st.glow = p;
        st.a = Math.sin(local * 27) > 0.72 ? 0.3 : 1;
        break;
      case 'orbit':
        st.tx = Math.cos(p * Math.PI * 2) * 0.13;
        st.ty = Math.sin(p * Math.PI * 2) * 0.07;
        st.rot = Math.sin(p * Math.PI * 2) * 5;
        break;
      case 'sway':
        st.rot = Math.sin(p * Math.PI * 2) * 7;
        break;
      case 'shake':
        st.tx = Math.sin(local * 74) * 0.018 * (loop ? 1 : k);
        st.ty = Math.cos(local * 61) * 0.018 * (loop ? 1 : k);
        break;
      case 'jitter':
        st.tx = Math.sin(local * 133) * 0.012;
        st.ty = Math.cos(local * 107) * 0.012;
        break;
      case 'ripple':
        st.s = 1 + Math.sin(p * Math.PI * 2) * 0.09;
        st.blur = Math.sin(p * Math.PI * 2) * 1.5;
        break;
      case 'wave':
        st.ty = Math.sin(p * Math.PI * 2) * 0.05;
        st.rot = Math.cos(p * Math.PI * 2) * 3;
        break;
      case 'zoomLoop':
        st.s = 1 + Math.sin(p * Math.PI * 2) * 0.1;
        break;
      case 'rotate':
        st.rot = k * (dir === 'right' ? 180 : -180);
        st.a = Math.min(1, 0.2 + v * 1.4);
        break;
      case 'flipX':
        st.flipX = Math.max(0.02, exit ? 1 - p : p);
        st.a = Math.min(1, 0.3 + v);
        break;
      case 'flipY':
        st.flipY = Math.max(0.02, exit ? 1 - p : p);
        st.a = Math.min(1, 0.3 + v);
        break;
      case 'glitch':
        st.glitch = k;
        st.tx = Math.sin(local * 57) * 0.012 * k;
        st.ty = Math.cos(local * 43) * 0.004 * k;
        st.a = Math.min(1, 0.25 + v * 1.4);
        break;
      case 'sparkle':
        st.sparkle = p;
        st.glow = p * 0.6;
        break;
    }
    st.a = clamp01(st.a);
    st.reveal = clamp01(st.reveal);
    if (st.chars != null) st.chars = clamp01(st.chars);
    return st;
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
        if (line.words.length && line.w + gap + w > maxW) { lines.push(line); line = { words: [], w: 0 }; }
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
      case 'fade': state.a *= p; break;
      case 'slide-left': state.tx += -(1 - p) * 0.35; break;
      case 'slide-right': state.tx += (1 - p) * 0.35; break;
      case 'slide-up': state.ty += (1 - p) * 0.35; break;
      case 'zoom': state.s *= 0.72 + 0.28 * p; state.a *= Math.min(1, p * 1.6); break;
      case 'wipe': state.wipe = Math.min(state.wipe, p); break;
      case 'blur': state.blur += (1 - p) * 16; state.a *= p; break;
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

  /* ---------------- effect post-processing ---------------- */

  let fxA = null, fxB = null, grain = null, grainAt = -1;
  function scratch(w, h, which) {
    let c = which === 'b' ? fxB : fxA;
    if (!c) { c = document.createElement('canvas'); if (which === 'b') fxB = c; else fxA = c; }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }
  function noiseCanvas() {
    if (grain) return grain;
    grain = document.createElement('canvas');
    grain.width = grain.height = 160;
    const gctx = grain.getContext('2d');
    const data = gctx.createImageData(160, 160);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    gctx.putImageData(data, 0, 0);
    return grain;
  }

  function effectCss(effect, amount) {
    const a = VE.clamp(amount, 0, 1);
    const neutral = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, 'hue-rotate': 0, grayscale: 0, blur: 0, invert: 0 };
    return String(effect.css || '').replace(/([a-z-]+)\(([^)]+)\)/gi, (all, fn, arg) => {
      if (!(fn in neutral)) return all;
      const base = parseFloat(arg) || 0;
      const unit = String(arg).replace(/[\d.\-]/g, '');
      const scaled = neutral[fn] + (base - neutral[fn]) * a;
      return `${fn}(${fn === 'hue-rotate' ? scaled.toFixed(1) + unit : scaled.toFixed(3) + unit})`;
    });
  }

  VE.applyEffects = function (ctx, effects, W, H, local) {
    if (!effects || !effects.length) return;
    const list = effects.map(e => ({ spec: VE.EFFECT_MAP[e.id], amount: VE.clamp(e.amount, 0, 1) }))
      .filter(x => x.spec && x.spec.kind !== 'none' && x.spec.kind !== 'filter' && x.amount > 0.01);
    if (!list.length) return;
    for (const { spec, amount } of list) {
      const kind = spec.kind;
      if (kind === 'vignette') {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.22, W / 2, H / 2, Math.max(W, H) * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${(amount * 0.92).toFixed(3)})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      } else if (kind === 'leak') {
        const t = (local * 0.13) % 2;
        const x = t < 1 ? (t * 1.6 - 0.3) * W : (1.3 - (t - 1) * 1.6) * W;
        const g = ctx.createLinearGradient(x - W * 0.35, 0, x + W * 0.35, H);
        g.addColorStop(0, 'rgba(255,120,60,0)');
        g.addColorStop(0.5, `rgba(255,160,90,${(amount * 0.4).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,80,140,0)');
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      } else if (kind === 'grain') {
        const t = Math.floor(local * 12);
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = amount * 0.42;
        const ox = (t * 37) % 160, oy = (t * 61) % 160;
        for (let y = -oy; y < H; y += 160) for (let x = -ox; x < W; x += 160) ctx.drawImage(noiseCanvas(), x, y);
        ctx.restore();
      } else if (kind === 'scanlines') {
        ctx.save();
        ctx.globalAlpha = amount * 0.34;
        ctx.fillStyle = '#000';
        for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
        ctx.restore();
      } else if (kind === 'glitch' || kind === 'vhs' || kind === 'motion' || kind === 'composite' || kind === 'pixelate') {
        const tmp = scratch(W, H, 'a');
        tmp.getContext('2d').clearRect(0, 0, W, H);
        tmp.getContext('2d').drawImage(ctx.canvas, 0, 0);
        const sctx = tmp.getContext('2d');
        if (kind === 'glitch' || kind === 'vhs') {
          const bands = kind === 'vhs' ? 8 : 14;
          for (let i = 0; i < bands; i++) {
            const y = Math.floor(local * (kind === 'vhs' ? 3 : 11) + i * 97) % H;
            const h = Math.max(2, Math.round(H / bands / 2));
            const shift = (Math.sin(i * 13.7 + local * 9) * amount * (kind === 'vhs' ? 9 : 24));
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.drawImage(tmp, 0, y, W, h, shift, y, W, h);
            if (kind === 'vhs') {
              ctx.globalCompositeOperation = 'screen';
              ctx.globalAlpha = amount * 0.22;
              ctx.fillStyle = i % 2 ? '#ff4060' : '#30d0ff';
              ctx.fillRect(0, y, W, 1);
            }
            ctx.restore();
          }
          if (kind === 'vhs') {
            ctx.save(); ctx.globalAlpha = amount * 0.12; ctx.fillStyle = '#fff';
            ctx.fillRect(0, Math.floor(local * 40) % H, W, 2); ctx.restore();
          }
        } else if (kind === 'motion') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 1; i <= 4; i++) {
            ctx.globalAlpha = amount * 0.13;
            ctx.drawImage(tmp, i * amount * 9, 0);
          }
          ctx.restore();
        } else if (kind === 'composite') {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = amount * (spec.id === 'halation' ? 0.32 : 0.5);
          ctx.filter = `blur(${(amount * 14 + 2).toFixed(1)}px) brightness(1.35)`;
          ctx.drawImage(tmp, 0, 0);
          ctx.restore();
        } else if (kind === 'pixelate') {
          const block = Math.max(2, Math.round(4 + amount * 34));
          const small = scratch(Math.max(1, Math.ceil(W / block)), Math.max(1, Math.ceil(H / block)), 'b');
          small.getContext('2d').drawImage(ctx.canvas, 0, 0, small.width, small.height);
          ctx.save(); ctx.imageSmoothingEnabled = false;
          ctx.drawImage(small, 0, 0, W, H);
          ctx.restore();
        }
        void sctx;
      } else if (kind === 'chromatic' || kind === 'sharpen' || kind === 'duotone') {
        let data;
        try { data = ctx.getImageData(0, 0, W, H); } catch (e) { return; }
        const d = data.data;
        if (kind === 'chromatic') {
          const shift = Math.max(1, Math.round(amount * 7));
          const copy = new Uint8ClampedArray(d);
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const i = (y * W + x) * 4;
              const xr = Math.min(W - 1, x + shift), xb = Math.max(0, x - shift);
              d[i] = copy[(y * W + xr) * 4];
              d[i + 2] = copy[(y * W + xb) * 4 + 2];
            }
          }
        } else if (kind === 'sharpen') {
          const copy = new Uint8ClampedArray(d);
          const a = amount * 0.9;
          const at = (x, y) => ((Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4);
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const i = (y * W + x) * 4;
              for (let c = 0; c < 3; c++) {
                const sum = copy[i + c] * (1 + 4 * a)
                  - copy[at(x - 1, y) + c] * a - copy[at(x + 1, y) + c] * a
                  - copy[at(x, y - 1) + c] * a - copy[at(x, y + 1) + c] * a;
                d[i + c] = sum;
              }
            }
          }
        } else if (kind === 'duotone') {
          const c1 = VE.hexToRgba(spec.color1 || '#102040', 1).match(/\d+/g).map(Number);
          const c2 = VE.hexToRgba(spec.color2 || '#ffd76e', 1).match(/\d+/g).map(Number);
          for (let i = 0; i < d.length; i += 4) {
            const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
            for (let c = 0; c < 3; c++) {
              const mapped = c1[c] + (c2[c] - c1[c]) * lum;
              d[i + c] = d[i + c] + (mapped - d[i + c]) * amount;
            }
          }
        }
        ctx.putImageData(data, 0, 0);
      }
    }
  };

  /* ---------------- renderer ---------------- */

  VE.Renderer = class Renderer {
    constructor(poolEl, onInvalidate) {
      this.poolEl = poolEl;
      this.onInvalidate = onInvalidate || (() => {});
      this.elements = new Map();
      this.images = new Map();
      this.offscreen = null;
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
      if (this.audio && this.audio.ctx.state === 'suspended') this.audio.ctx.resume().catch(() => {});
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
      } catch (err) { /* element already attached or audio unavailable */ }
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
      if (rec && rec.url !== asset.url) { this.disposeClip(clip.id); rec = null; }
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
      try { rec.el.pause(); rec.el.removeAttribute('src'); rec.el.load(); } catch (e) { /* noop */ }
      rec.el.remove();
      this.elements.delete(clipId);
    }

    prune(project) {
      const live = new Set();
      project.tracks.forEach(t => t.clips.forEach(c => live.add(c.id)));
      for (const id of Array.from(this.elements.keys())) if (!live.has(id)) this.disposeClip(id);
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
          const active = local >= 0 && local < clip.duration && !clip.hidden;
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
            const fadeIn = clip.fadeIn || 0, fadeOut = clip.fadeOut || 0;
            if (fadeIn > 0 && local < fadeIn) g *= VE.clamp(local / fadeIn, 0, 1);
            if (fadeOut > 0 && (clip.duration - local) < fadeOut) g *= VE.clamp((clip.duration - local) / fadeOut, 0, 1);
            if (track.muted) g = 0;
            el.__cfGain.gain.value = g;
          }
        }
      }
      for (const [id, rec] of this.elements) if (!seen.has(id) && !rec.el.paused) rec.el.pause();
    }

    stopAll() {
      for (const rec of this.elements.values()) {
        if (!rec.el.paused) rec.el.pause();
        rec.el.__cfActive = false;
      }
    }

    getOffscreen(W, H) {
      if (!this.offscreen) this.offscreen = document.createElement('canvas');
      if (this.offscreen.width !== W || this.offscreen.height !== H) { this.offscreen.width = W; this.offscreen.height = H; }
      const c = this.offscreen.getContext('2d', { alpha: true });
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      c.globalAlpha = 1;
      c.filter = 'none';
      return c;
    }

    draw(ctx, project, time, assets) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = project.background || '#000000';
      ctx.fillRect(0, 0, W, H);
      for (const track of project.tracks) {
        if (track.type === 'audio' || track.hidden) continue;
        for (const clip of track.clips) {
          if (clip.hidden) continue;
          const local = time - clip.start;
          if (local < 0 || local >= clip.duration) continue;
          this.drawClip(ctx, project, track, clip, local, W, H, assets);
        }
      }
      ctx.restore();
    }

    drawClip(ctx, project, track, clip, local, W, H, assets) {
      const tr = transitionFor(clip, local);
      const anim = VE.animationState(clip, local);
      const alpha = VE.clamp(clip.opacity, 0, 1) * tr.a * anim.a;
      if (alpha <= 0.001) return;

      const effects = (clip.effects || []).map(e => ({ e, spec: VE.EFFECT_MAP[e.id] }))
        .filter(x => x.spec && x.spec.kind !== 'none');
      const cssEffects = effects.filter(x => x.spec.kind === 'filter');
      const post = effects.filter(x => x.spec.kind !== 'filter');
      let target = ctx;
      let off = null;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (tr.wipe < 1) {
        ctx.beginPath(); ctx.rect(0, 0, W * tr.wipe, H); ctx.clip();
      }
      if (post.length) { off = this.getOffscreen(W, H); target = off; }

      if (clip.type === 'text') {
        this.drawText(target, clip, local, W, H, tr, anim, cssEffects);
      } else if (clip.type === 'shape') {
        this.drawShape(target, clip, local, W, H, tr, anim, cssEffects);
      } else {
        const asset = assets.get(clip.assetId);
        if (!asset || asset.missing) { ctx.restore(); return; }
        const el = this.getElement(clip, asset);
        if (clip.type !== 'image' && el.readyState < 2) { ctx.restore(); return; }
        if (clip.type === 'image' && !el.complete) { ctx.restore(); return; }
        const sw = el.videoWidth || el.naturalWidth || asset.width || 16;
        const sh = el.videoHeight || el.naturalHeight || asset.height || 9;
        if (!sw || !sh) { ctx.restore(); return; }
        const fitScale = clip.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
        const scale = fitScale * (clip.scale || 1) * tr.s * anim.s;
        const dw = sw * scale, dh = sh * scale;
        let filter = 'none';
        const preset = VE.FILTER_MAP[clip.filter];
        if (preset && preset.css !== 'none') filter = preset.css;
        cssEffects.forEach(({ e, spec }) => { filter = (filter === 'none' ? '' : filter + ' ') + effectCss(spec, e.amount); });
        if (tr.blur > 0 || anim.blur > 0) {
          const blurPx = ((tr.blur + anim.blur) * W) / 1280;
          filter = (filter === 'none' ? '' : filter + ' ') + `blur(${blurPx.toFixed(2)}px)`;
        }
        target.save();
        target.filter = filter;
        target.translate(clip.x * W + (tr.tx + anim.tx) * W, clip.y * H + (tr.ty + anim.ty) * H);
        target.rotate((clip.rotation || 0) * Math.PI / 180 + anim.rot * Math.PI / 180);
        target.scale(anim.flipX, anim.flipY);
        try { target.drawImage(el, -dw / 2, -dh / 2, dw, dh); } catch (e) { /* frame not ready */ }
        target.restore();
      }

      if (off) {
        VE.applyEffects(off, post.map(x => x.e), W, H, local);
        ctx.drawImage(off.canvas, 0, 0, W, H);
      }
      ctx.restore();
    }

    clipBounds(clip, W, H, assets) {
      if (clip.type === 'text') {
        return {
          x: clip.x * W, y: clip.y * H,
          w: Math.max(60, W * VE.clamp(clip.textWidth || 0.86, 0.1, 1) * (clip.scale || 1)),
          h: Math.max(30, (clip.fontSize || 56) * (H / 1080) * (clip.scale || 1) * 1.6),
          rot: clip.rotation || 0
        };
      }
      if (clip.type === 'shape') {
        return { x: clip.x * W, y: clip.y * H, w: W * (clip.shapeWidth || 0.3), h: H * (clip.shapeHeight || 0.2), rot: clip.rotation || 0 };
      }
      const asset = assets && assets.get(clip.assetId);
      const ratio = asset && asset.width && asset.height ? asset.width / asset.height : 16 / 9;
      const w = W * (clip.fit === 'contain' ? 0.6 : 0.9) * (clip.scale || 1);
      return { x: clip.x * W, y: clip.y * H, w, h: w / ratio, rot: clip.rotation || 0 };
    }

    drawShape(ctx, clip, local, W, H, tr, anim, cssEffects) {
      const shape = clip.shape || 'rect';
      const w = Math.max(4, W * (clip.shapeWidth || 0.3) * tr.s * anim.s);
      const h = Math.max(4, H * (clip.shapeHeight || 0.2) * tr.s * anim.s);
      const phase = (((local * (clip.speed || 1) * 0.7) % 1) + 1) % 1;
      ctx.save();
      ctx.translate(clip.x * W + (tr.tx + anim.tx) * W, clip.y * H + (tr.ty + anim.ty) * H);
      ctx.rotate((clip.rotation || 0) * Math.PI / 180 + anim.rot * Math.PI / 180);
      ctx.scale(anim.flipX, anim.flipY);
      let filter = 'none';
      cssEffects.forEach(({ e, spec }) => { filter = (filter === 'none' ? '' : filter + ' ') + effectCss(spec, e.amount); });
      if (tr.blur > 0 || anim.blur > 0) filter = (filter === 'none' ? '' : filter + ' ') + `blur(${((tr.blur + anim.blur) * W) / 1280}px)`;
      ctx.filter = filter;
      const fill = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      fill.addColorStop(0, clip.shapeColor || '#7c5cff');
      fill.addColorStop(1, clip.shapeColor2 || '#3ba0ff');
      ctx.fillStyle = fill;
      const stroke = () => { ctx.strokeStyle = clip.shapeColor || '#7c5cff'; ctx.lineWidth = Math.max(2, h * 0.04); ctx.stroke(); };
      const path = () => {
        ctx.beginPath();
        switch (shape) {
          case 'roundRect': drawRounded(ctx, -w / 2, -h / 2, w, h, h * 0.22); break;
          case 'circle': ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2); break;
          case 'ellipse': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
          case 'triangle': ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); break;
          case 'star': {
            for (let i = 0; i < 10; i++) {
              const r = i % 2 ? Math.min(w, h) * 0.22 : Math.min(w, h) * 0.5;
              const a = -Math.PI / 2 + i * Math.PI / 5;
              const x = Math.cos(a) * r, y = Math.sin(a) * r;
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath(); break;
          }
          case 'heart': {
            const s = Math.min(w, h) / 2;
            ctx.moveTo(0, s * 0.8);
            ctx.bezierCurveTo(-s * 1.4, -s * 0.2, -s * 0.5, -s * 1.1, 0, -s * 0.35);
            ctx.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.4, -s * 0.2, 0, s * 0.8);
            ctx.closePath(); break;
          }
          case 'arrow':
            ctx.moveTo(-w / 2, -h * 0.14); ctx.lineTo(w * 0.16, -h * 0.14); ctx.lineTo(w * 0.16, -h * 0.4);
            ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.16, h * 0.4); ctx.lineTo(w * 0.16, h * 0.14);
            ctx.lineTo(-w / 2, h * 0.14); ctx.closePath(); break;
          case 'line': ctx.rect(-w / 2, -Math.max(2, h * 0.06) / 2, w, Math.max(2, h * 0.06)); break;
          default: ctx.rect(-w / 2, -h / 2, w, h);
        }
      };
      path();
      if (shape !== 'line') ctx.fill(); else ctx.fill();

      if (shape === 'gradientBar') {
        const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, clip.shapeColor || '#3ba0ff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
      } else if (shape === 'bokeh') {
        for (let i = 0; i < 12; i++) {
          const a = i * 2.4, r = ((i * 37) % 100) / 100;
          const bx = Math.cos(a) * w * 0.45 * r, by = Math.sin(a * 1.7) * h * 0.45 * r;
          const br = Math.max(3, h * (0.04 + ((i * 13) % 9) / 90));
          ctx.globalAlpha = 0.11 + (i % 4) * 0.05;
          ctx.fillStyle = i % 2 ? clip.shapeColor : clip.shapeColor2;
          ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (shape === 'lightWash') {
        const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
        g.addColorStop(0, VE.hexToRgba(clip.shapeColor2 || '#ff5cc8', 0.01));
        g.addColorStop(0.55, VE.hexToRgba(clip.shapeColor || '#ffb84d', 0.55));
        g.addColorStop(1, VE.hexToRgba(clip.shapeColor2 || '#3ba0ff', 0.01));
        ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
      } else if (shape === 'scanlines') {
        ctx.fillStyle = VE.hexToRgba(clip.shapeColor || '#3ba0ff', 0.28);
        for (let y = -h / 2; y < h / 2; y += Math.max(3, h / 30)) ctx.fillRect(-w / 2, y, w, 1);
      } else if (shape === 'grainField') {
        ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.5;
        for (let y = -h / 2; y < h / 2; y += 160) for (let x = -w / 2; x < w / 2; x += 160) ctx.drawImage(noiseCanvas(), x, y);
        ctx.restore();
      } else if (shape === 'pulseDot') {
        const r = Math.min(w, h) * (0.18 + 0.24 * Math.sin(phase * Math.PI));
        ctx.fillStyle = clip.shapeColor || '#7c5cff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      } else if (shape === 'spinner') {
        ctx.lineWidth = Math.max(3, h * 0.09); ctx.strokeStyle = clip.shapeColor || '#7c5cff';
        ctx.beginPath(); ctx.arc(0, 0, Math.min(w, h) * 0.35, phase * Math.PI * 2, phase * Math.PI * 2 + Math.PI * 1.3); ctx.stroke();
      } else if (shape === 'progress') {
        ctx.fillStyle = 'rgba(255,255,255,.18)'; drawRounded(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
        ctx.fillStyle = clip.shapeColor || '#37d39b'; drawRounded(ctx, -w / 2, -h / 2, Math.max(2, w * phase), h, h / 2); ctx.fill();
      } else if (shape === 'bounceBall') {
        const y = -h / 2 + h * Math.abs(Math.sin(phase * Math.PI * 2)) * 0.7;
        ctx.fillStyle = clip.shapeColor || '#ff5d6c'; ctx.beginPath(); ctx.arc(0, y, Math.min(w, h) * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = VE.hexToRgba(clip.shapeColor2 || '#ffffff', 0.3); ctx.beginPath(); ctx.moveTo(-w / 2, h / 2); ctx.lineTo(w / 2, h / 2); ctx.stroke();
      } else if (shape === 'wavingLines') {
        ctx.lineWidth = Math.max(2, h * 0.04); ctx.strokeStyle = clip.shapeColor || '#3ba0ff';
        for (let row = 0; row < 3; row++) {
          ctx.beginPath();
          for (let x = -w / 2; x <= w / 2; x += Math.max(3, w / 60)) {
            const y = -h / 3 + row * h / 3 + Math.sin((x / w) * Math.PI * 4 + phase * Math.PI * 2 + row) * h * 0.08;
            x === -w / 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else if (shape === 'orbitDots') {
        for (let i = 0; i < 5; i++) {
          const a = phase * Math.PI * 2 + i * Math.PI * 2 / 5;
          ctx.fillStyle = i % 2 ? clip.shapeColor : clip.shapeColor2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * w * 0.38, Math.sin(a) * h * 0.38, Math.max(3, h * 0.07), 0, Math.PI * 2); ctx.fill();
        }
      } else if (shape === 'sparklePop') {
        ctx.fillStyle = clip.shapeColor2 || '#ffe14d';
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5 + phase * Math.PI;
          const r = (0.2 + 0.3 * Math.sin(phase * Math.PI + i)) * Math.min(w, h);
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          ctx.beginPath(); ctx.moveTo(x, y - h * 0.05); ctx.lineTo(x + h * 0.02, y); ctx.lineTo(x, y + h * 0.05); ctx.lineTo(x - h * 0.02, y); ctx.closePath(); ctx.fill();
        }
      } else if (shape === 'typingDots') {
        for (let i = 0; i < 3; i++) {
          const a = 0.3 + 0.7 * Math.max(0, Math.sin(phase * Math.PI * 3 - i * 0.6));
          ctx.fillStyle = VE.hexToRgba(clip.shapeColor || '#ffffff', a);
          ctx.beginPath(); ctx.arc((i - 1) * w * 0.18, 0, Math.max(3, h * 0.09), 0, Math.PI * 2); ctx.fill();
        }
      } else if (shape !== 'line') {
        stroke();
      }
      ctx.restore();
    }

    drawText(ctx, clip, local, W, H, tr, anim, cssEffects) {
      let text = String(clip.text == null ? '' : clip.text);
      if (!text.trim()) return;
      const scale = (clip.scale || 1) * tr.s * anim.s;
      const fs = Math.max(6, (clip.fontSize || 56) * (H / 1080) * scale);
      const maxW = Math.max(30, W * VE.clamp(clip.textWidth || 0.86, 0.1, 1) * scale);
      const family = VE.fontCss(clip.fontFamily);
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
      if (anim.chars != null) {
        const chars = Math.floor(text.length * anim.chars);
        display = chars >= text.length ? text : text.slice(0, Math.max(0, chars));
      } else if (styleId === 'typewriter') {
        const reveal = VE.clamp(local / Math.max(0.4, clip.duration * 0.62), 0, 1);
        const chars = Math.floor(text.length * reveal);
        display = chars >= text.length ? text : text.slice(0, Math.max(0, chars));
      }

      const lines = layoutLines(ctx, display, maxW);
      const totalW = Math.max(0, ...lines.map(l => l.w));
      const totalH = Math.max(lineHeight, lines.length * lineHeight);
      const startY = -totalH / 2 + lineHeight / 2;

      ctx.save();
      ctx.translate(clip.x * W + (tr.tx + anim.tx) * W, clip.y * H + (tr.ty + anim.ty) * H);
      ctx.rotate((clip.rotation || 0) * Math.PI / 180 + anim.rot * Math.PI / 180);
      ctx.scale(anim.flipX, anim.flipY);
      if (styleId === 'comic') ctx.rotate(-0.04);
      let filter = 'none';
      cssEffects.forEach(({ e, spec }) => { filter = (filter === 'none' ? '' : filter + ' ') + effectCss(spec, e.amount); });
      if (tr.blur > 0 || anim.blur > 0) filter = (filter === 'none' ? '' : filter + ' ') + `blur(${((tr.blur + anim.blur) * W) / 1280}px)`;
      ctx.filter = filter;

      if (anim.reveal < 1) {
        ctx.beginPath();
        if (anim.iris) {
          ctx.ellipse(0, 0, Math.max(1, totalW * 0.55 * anim.reveal), Math.max(1, totalH * 0.7 * anim.reveal), 0, 0, Math.PI * 2);
        } else {
          const rw = Math.max(1, totalW * anim.reveal), rh = Math.max(1, totalH * anim.reveal);
          if (anim.revealDir === 'right') ctx.rect(-totalW / 2 - rw, -totalH, rw, totalH * 2);
          else if (anim.revealDir === 'up') ctx.rect(-totalW, totalH / 2, totalW * 2, rh);
          else if (anim.revealDir === 'down') ctx.rect(-totalW, -totalH / 2 - rh, totalW * 2, rh);
          else ctx.rect(-totalW / 2 - 1, -totalH, rw, totalH * 2);
        }
        ctx.clip();
      }

      const alignedStart = (line) => {
        if (styleId === 'lowerthird' || styleId === 'chapter') return -totalW / 2;
        if (clip.align === 'left') return -totalW / 2;
        if (clip.align === 'right') return totalW / 2 - line.w;
        return -line.w / 2;
      };
      const paint = (fill, opts = {}) => {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i], x0 = alignedStart(line), y = startY + i * lineHeight;
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
        const w = totalW + pad * 2, hgt = totalH + padY * 2;
        ctx.fillStyle = fill; drawRounded(ctx, -w / 2, -hgt / 2, w, hgt, radius); ctx.fill();
      };
      const color = clip.color || '#ffffff', bg = clip.bgColor || '#000000';

      if (anim.highlight > 0) {
        ctx.fillStyle = VE.hexToRgba(color, 0.26 * anim.highlight);
        ctx.fillRect(-totalW / 2, -fs * 0.58, totalW * anim.highlight, fs * 1.16);
      }
      if (anim.glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = fs * 0.85 * anim.glow; }

      switch (styleId) {
        case 'subtitle':
          bgBox(VE.hexToRgba(bg, 0.62), fs * 0.24, pad * 0.55);
          ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = fs * 0.2; paint('#ffffff'); break;
        case 'boxed': bgBox(bg, fs * 0.2, pad * 0.5); paint(color); break;
        case 'karaoke': {
          const totalWords = lines.reduce((n, l) => n + l.words.length, 0);
          const activeIndex = Math.floor(progress * totalWords);
          let wi = 0;
          ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = fs * 0.25;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i], x0 = alignedStart(line), y = startY + i * lineHeight;
            for (const word of line.words) {
              const active = wi === activeIndex;
              ctx.fillStyle = active ? color : 'rgba(255,255,255,.82)';
              ctx.shadowColor = active ? color : 'rgba(0,0,0,.5)';
              ctx.shadowBlur = active ? fs * 0.55 : fs * 0.22;
              ctx.fillText(word.text, x0 + word.x, y); wi++;
            }
          }
          break;
        }
        case 'neon':
          ctx.shadowColor = color; ctx.shadowBlur = fs * 0.6; paint(color);
          ctx.shadowBlur = fs * 0.25; paint(color); ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, fs * 0.035);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i], x0 = alignedStart(line), y = startY + i * lineHeight;
            for (const word of line.words) ctx.strokeText(word.text, x0 + word.x, y);
          }
          break;
        case 'comic':
          ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowOffsetX = fs * 0.06; ctx.shadowOffsetY = fs * 0.08;
          paint(color, { stroke: '#111111', lineWidth: fs * 0.18 });
          ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; break;
        case 'typewriter':
          paint(color);
          if (display.length < text.length) {
            const last = lines[lines.length - 1];
            if (last) {
              const x = alignedStart(last) + last.w + fs * 0.06;
              const y = startY + (lines.length - 1) * lineHeight;
              ctx.fillStyle = color; ctx.globalAlpha *= 0.8;
              ctx.fillRect(x, y - fs * 0.45, fs * 0.12, fs * 0.9);
              ctx.globalAlpha /= 0.8;
            }
          }
          break;
        case 'lowerthird': {
          const w = totalW + pad * 2 + fs * 0.5, hgt = totalH + pad * 1.1;
          ctx.fillStyle = VE.hexToRgba(bg, 0.9); drawRounded(ctx, -w / 2, -hgt / 2, w, hgt, fs * 0.14); ctx.fill();
          ctx.fillStyle = color; drawRounded(ctx, -w / 2, -hgt / 2, fs * 0.16, hgt, fs * 0.06); ctx.fill();
          paint('#ffffff'); break;
        }
        case 'outline':
          ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = fs * 0.2;
          paint(color, { stroke: '#0b0d12', lineWidth: fs * 0.14 }); break;
        case 'gradient': {
          const g = ctx.createLinearGradient(-totalW / 2, 0, totalW / 2, 0);
          g.addColorStop(0, color); g.addColorStop(1, clip.color2 || '#3ba0ff');
          ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = fs * 0.25; paint(g); break;
        }
        case 'chapter': {
          ctx.fillStyle = color;
          drawRounded(ctx, -totalW / 2 - pad * 0.6, -hgtSafe(totalH, pad), fs * 0.9, hgtSafe(totalH, pad) * 2, fs * 0.1); ctx.fill();
          ctx.fillStyle = bg; ctx.font = `${weight} ${fs * 0.8}px ${family}`;
          const label = (text.split(/[\s·:]/)[0] || '01');
          ctx.textAlign = 'center'; ctx.fillText(label, -totalW / 2 - pad * 0.6 + fs * 0.45, 0);
          ctx.textAlign = 'left'; ctx.font = `${style}${weight} ${fs}px ${family}`;
          paint('#ffffff'); break;
        }
        case 'quote': {
          ctx.fillStyle = VE.hexToRgba(color, 0.35);
          ctx.font = `${weight} ${fs * 2.4}px ${family}`;
          ctx.fillText('“', -totalW / 2 - fs * 0.5, -totalH / 2 + fs * 0.2);
          ctx.font = `${style}${weight} ${fs}px ${family}`;
          paint(color); break;
        }
        case 'badge': {
          bgBox(bg, fs * 0.5, pad * 0.45); paint(color); break;
        }
        case 'glitch': {
          paint(color);
          ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.6;
          ctx.translate(-fs * 0.04, 0); paint('#ff3b6b');
          ctx.translate(fs * 0.08, 0); paint('#3ba0ff');
          ctx.restore(); break;
        }
        default:
          ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = fs * 0.28; ctx.shadowOffsetY = fs * 0.04;
          paint(color); ctx.shadowOffsetY = 0; break;
      }

      if (anim.underline > 0) {
        ctx.fillStyle = color; ctx.globalAlpha *= 0.9;
        ctx.fillRect(-totalW / 2, fs * 0.62, totalW * anim.underline, Math.max(2, fs * 0.05));
        ctx.globalAlpha /= 0.9;
      }
      if (anim.strike > 0) {
        ctx.fillStyle = color;
        ctx.fillRect(-totalW / 2, 0, totalW * anim.strike, Math.max(2, fs * 0.045));
      }
      if (anim.glitch > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = anim.glitch * 0.6;
        ctx.translate(-fs * 0.05, fs * 0.02); paint('#ff3b6b');
        ctx.translate(fs * 0.1, -fs * 0.02); paint('#3ba0ff');
        ctx.restore();
      }
      if (anim.sparkle > 0) {
        ctx.fillStyle = VE.hexToRgba(color, anim.sparkle * 0.85);
        for (let i = 0; i < 6; i++) {
          const a = i * 1.7 + local * 2;
          const x = Math.cos(a) * totalW * 0.48, y = Math.sin(a * 1.3) * totalH * 0.6;
          const r = fs * (0.05 + 0.04 * Math.sin(a * 3));
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.3, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.3, y); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }
  };

  function hgtSafe(totalH, pad) { return totalH / 2 + pad * 0.5; }
})();
