/* IndexedDB storage + local media probing / thumbnails */
(function () {
  const VE = (window.VE = window.VE || {});

  const DB_NAME = 'letitedit';
  const DB_VERSION = 1;
  /* Earlier builds used this name. Kept only to migrate existing projects. */
  const LEGACY_DB_NAME = 'clipforge';
  let dbPromise = null;
  let useMemory = false;
  const mem = { assets: new Map(), meta: new Map() };

  function openNamed(name) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(name, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Storage is blocked by another tab'));
    });
  }

  function allFrom(db, storeName) {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function migrateLegacy(legacy, target) {
    for (const name of ['assets', 'meta']) {
      const rows = await allFrom(legacy, name);
      if (!rows.length) continue;
      await new Promise((resolve, reject) => {
        const s = target.transaction(name, 'readwrite').objectStore(name);
        rows.forEach(row => s.put(row));
        s.transaction.oncomplete = resolve;
        s.transaction.onerror = () => reject(s.transaction.error);
      });
    }
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = (async () => {
      const db = await openNamed(DB_NAME);
      const current = await allFrom(db, 'assets');
      const meta = await allFrom(db, 'meta');
      if (!current.length && !meta.length) {
        try {
          const legacy = await openNamed(LEGACY_DB_NAME);
          await migrateLegacy(legacy, db);
          legacy.close();
        } catch (err) {
          /* no legacy database, or it could not be read — start fresh */
        }
      }
      return db;
    })().catch(err => {
      console.warn('IndexedDB unavailable, using memory storage.', err);
      useMemory = true;
      return null;
    });
    return dbPromise;
  }

  async function store(name, mode) {
    const db = await openDb();
    if (!db) return null;
    return db.transaction(name, mode).objectStore(name);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const DB = {
    async ready() { await openDb(); return true; },

    async putAsset(asset) {
      const rec = {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        category: asset.category || asset.type,
        mime: asset.mime,
        size: asset.size,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        thumb: asset.thumb,
        blob: asset.blob,
        missing: !!asset.missing
      };
      if (useMemory) { mem.assets.set(rec.id, rec); return rec; }
      const s = await store('assets', 'readwrite');
      await reqToPromise(s.put(rec));
      return rec;
    },

    async getAsset(id) {
      if (useMemory) return mem.assets.get(id) || null;
      const s = await store('assets', 'readonly');
      return reqToPromise(s.get(id));
    },

    async getAllAssets() {
      if (useMemory) return Array.from(mem.assets.values());
      const s = await store('assets', 'readonly');
      return reqToPromise(s.getAll());
    },

    async deleteAsset(id) {
      if (useMemory) { mem.assets.delete(id); return; }
      const s = await store('assets', 'readwrite');
      await reqToPromise(s.delete(id));
    },

    async saveProject(project) {
      const rec = { id: 'current', project, savedAt: Date.now() };
      if (useMemory) { mem.meta.set('current', rec); return; }
      const s = await store('meta', 'readwrite');
      await reqToPromise(s.put(rec));
    },

    async loadProject() {
      if (useMemory) return (mem.meta.get('current') || {}).project || null;
      const s = await store('meta', 'readonly');
      const rec = await reqToPromise(s.get('current'));
      return rec ? rec.project : null;
    },

    async clearAll() {
      if (useMemory) { mem.assets.clear(); mem.meta.clear(); return; }
      await openDb();
      const db = await openDb();
      if (!db) return;
      for (const name of ['assets', 'meta']) {
        await new Promise((resolve, reject) => {
          const s = db.transaction(name, 'readwrite').objectStore(name);
          const req = s.clear();
          req.onsuccess = resolve;
          req.onerror = () => reject(req.error);
        });
      }
    }
  };

  VE.DB = DB;

  /* ---------------- media probing ---------------- */

  function canvasThumb(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, 320, 180);
    draw(ctx, 320, 180);
    try { return c.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
  }

  function drawCover(ctx, src, sw, sh, W, H) {
    if (!sw || !sh) return;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function audioThumb(name) {
    return canvasThumb(320, 180, (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#123a2e');
      g.addColorStop(1, '#0c1b2a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      let seed = 0;
      for (let i = 0; i < String(name).length; i++) seed += String(name).charCodeAt(i);
      const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      ctx.fillStyle = 'rgba(55,211,155,.85)';
      const bars = 34;
      const bw = W / bars - 3;
      for (let i = 0; i < bars; i++) {
        const bh = 12 + rand() * (H - 44) * (0.45 + Math.sin(i / 3) * 0.25 + 0.3);
        const x = 8 + i * (W - 16) / bars;
        const y = H / 2 - bh / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, Math.max(4, bh), 2);
        else ctx.rect(x, y, bw, Math.max(4, bh));
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '700 12px Inter, sans-serif';
      ctx.fillText('AUDIO', 12, 20);
    });
  }

  function imageThumb(img) {
    return canvasThumb(320, 180, (ctx, W, H) => {
      drawCover(ctx, img, img.naturalWidth, img.naturalHeight, W, H);
    });
  }

  function videoThumb(video) {
    return canvasThumb(320, 180, (ctx, W, H) => {
      const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
      drawCover(ctx, video, vw, vh, W, H);
    });
  }

  /* Some recordings (WebM from MediaRecorder) report Infinity until the
     browser probes the stream. Nudge currentTime so the duration resolves. */
  function resolveDuration(el) {
    if (Number.isFinite(el.duration) && el.duration > 0) return Promise.resolve(el.duration);
    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener('durationchange', check);
        el.removeEventListener('timeupdate', check);
        resolve(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
      };
      const check = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) finish();
      };
      el.addEventListener('durationchange', check);
      el.addEventListener('timeupdate', check);
      timer = setTimeout(finish, 2500);
      try { el.currentTime = 1e7; } catch (e) { finish(); }
    }).then((duration) => {
      try { el.currentTime = 0; } catch (e) { /* noop */ }
      return duration;
    });
  }

  VE.probeMedia = async function (file) {
    const mime = file.type || '';
    const url = URL.createObjectURL(file);
    const base = {
      id: VE.uid('asset'),
      name: file.name || 'Untitled media',
      size: file.size,
      mime,
      url,
      blob: file,
      type: 'video',
      duration: 0,
      width: 0,
      height: 0,
      thumb: ''
    };

    const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name);
    const isAudio = mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name);
    const isVideo = mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(file.name);

    if (isImage) {
      const img = await VE.loadImage(url);
      Object.assign(base, {
        type: 'image',
        width: img.naturalWidth,
        height: img.naturalHeight,
        duration: 0,
        thumb: imageThumb(img)
      });
      return base;
    }

    if (isAudio) {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = url;
      let duration = 0;
      let width = 0, height = 0;
      try {
        await VE.once(audio, 'loadedmetadata', 12000);
        duration = await resolveDuration(audio);
        width = audio.videoWidth || 0;
        height = audio.videoHeight || 0;
      } catch (err) {
        URL.revokeObjectURL(url);
        throw new Error('This audio file could not be read: ' + file.name);
      }
      Object.assign(base, { type: 'audio', duration: Math.max(0.1, duration), width, height, thumb: audioThumb(file.name) });
      return base;
    }

    if (isVideo) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      try {
        await VE.once(video, 'loadedmetadata', 15000);
      } catch (err) {
        URL.revokeObjectURL(url);
        throw new Error('This video format is not supported by your browser: ' + file.name);
      }
      const duration = await resolveDuration(video);
      video.currentTime = Math.min(0.15, Math.max(0, duration / 2));
      await VE.once(video, 'seeked', 6000).catch(() => {});
      const thumb = (video.videoWidth ? videoThumb(video) : '') || audioThumb(file.name);
      Object.assign(base, {
        type: 'video',
        duration: Math.max(0.1, duration),
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
        thumb
      });
      return base;
    }

    URL.revokeObjectURL(url);
    throw new Error('Unsupported file type: ' + file.name);
  };

  VE.thumbForBlob = async function (asset) {
    /* Rebuild a thumbnail for an asset loaded from storage (used when relinking). */
    try {
      if (asset.type === 'image') {
        const img = await VE.loadImage(asset.url);
        return imageThumb(img);
      }
      if (asset.type === 'audio') return audioThumb(asset.name);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = asset.url;
      await VE.once(video, 'loadedmetadata', 15000);
      video.currentTime = Math.min(0.15, Math.max(0, (video.duration || 0) / 2));
      await VE.once(video, 'seeked', 6000).catch(() => {});
      return videoThumb(video);
    } catch (e) {
      return '';
    }
  };
})();
