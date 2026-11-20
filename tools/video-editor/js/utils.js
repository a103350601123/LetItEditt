/* Utilities: icons, formatting, DOM helpers, toast & modal */
(function () {
  const VE = (window.VE = window.VE || {});

  const ICONS = {
    play: '<path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
    upload: '<path d="M12 17V5"/><path d="m7 10 5-5 5 5"/><path d="M4 19h16"/>',
    film: '<rect x="2.5" y="3.5" width="19" height="17" rx="3"/><path d="M7 3.5v17M17 3.5v17M2.5 9h4.5M2.5 15h4.5M17 9h4.5M17 15h4.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-7 7"/>',
    music: '<path d="M9 18V6l11-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="15" r="2.5"/>',
    type: '<path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M8 20h8"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    captions: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M9 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>',
    sparkle: '<path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>',
    magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6Z"/><path d="M6 8h4M14 8h4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M17 9.5a4 4 0 0 1 0 5M19.5 7a8 8 0 0 1 0 10"/>',
    'volume-x': '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 5M22 9l-5 5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.5M6.4 7.4A16 16 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    save: '<path d="M5 3h11l3 3v15H5V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 2.5 2.5V13.5"/><path d="M12 17h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    external: '<path d="M14 3h7v7"/><path d="M21 3 11 13"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    group: '<path d="M9 6h9a2 2 0 0 1 2 2v9"/><path d="M15 18H6a2 2 0 0 1-2-2V7"/><path d="M9 6v12M15 6v12"/>',
    ungroup: '<rect x="3" y="4" width="8" height="10" rx="1.5"/><rect x="13" y="10" width="8" height="10" rx="1.5"/>',
    wave: '<path d="M2 12c2-5 4 5 6 0s4 5 6 0 4 5 6 0"/>',
    spark: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>'
  };

  VE.icon = function (name) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  };

  VE.setIcon = function (el, name) {
    if (!el) return;
    const holder = el.querySelector(':scope > svg');
    const html = VE.icon(name);
    if (holder) holder.outerHTML = html;
    else el.insertAdjacentHTML('afterbegin', html);
  };

  VE.hydrateIcons = function (root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      const name = el.getAttribute('data-icon');
      if (!name) return;
      const hasText = el.textContent.trim().length > 0;
      if (hasText) {
        if (!el.querySelector(':scope > svg')) el.insertAdjacentHTML('afterbegin', VE.icon(name));
      } else if (!el.querySelector(':scope > svg')) {
        el.innerHTML = VE.icon(name);
      }
    });
  };

  VE.uid = (p = 'c') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  VE.clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
  VE.round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

  VE.fmtTime = function (s, decimals = 1) {
    s = Math.max(0, Number(s) || 0);
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${String(m).padStart(2, '0')}:${sec.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`;
  };

  VE.fmtTimecode = function (s) {
    s = Math.max(0, Number(s) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s - Math.floor(s)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };

  VE.fmtClock = function (s) {
    s = Math.max(0, Number(s) || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  VE.parseTimecode = function (str) {
    if (!str) return 0;
    const t = String(str).trim().replace(',', '.');
    const parts = t.split(':').map(Number);
    if (parts.some(n => isNaN(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };

  VE.escapeHtml = function (str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  };

  VE.escapeAttr = VE.escapeHtml;

  VE.hexToRgba = function (hex, alpha) {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return `rgba(0,0,0,${alpha})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  };

  VE.debounce = function (fn, ms) {
    let t;
    const wrapped = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  };

  VE.formatBytes = function (bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
  };

  VE.once = function (el, event, timeout = 8000) {
    return new Promise((resolve, reject) => {
      let timer;
      const done = (val) => { cleanup(); resolve(val); };
      const fail = (err) => { cleanup(); reject(err); };
      const cleanup = () => { el.removeEventListener(event, onEvent); el.removeEventListener('error', onError); clearTimeout(timer); };
      const onEvent = (e) => done(e);
      const onError = () => fail(new Error('Media failed to load'));
      el.addEventListener(event, onEvent, { once: true });
      el.addEventListener('error', onError, { once: true });
      timer = setTimeout(() => fail(new Error('Timed out')), timeout);
    });
  };

  VE.loadImage = function (src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed'));
      img.src = src;
    });
  };

  VE.toast = function (message, type = 'ok') {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'ok' ? '' : type);
    const iconName = type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check';
    t.innerHTML = VE.icon(iconName) + '<span></span>';
    t.querySelector('span').textContent = message;
    root.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 260);
    }, type === 'error' ? 4200 : 2800);
  };

  VE.openModal = function (opts) {
    const root = document.getElementById('modalRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal' + (opts.wide ? ' wide' : '');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h = document.createElement('h3');
    h.textContent = opts.title || '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-x';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = VE.icon('x');
    head.append(h, closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (opts.body) {
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else body.appendChild(opts.body);
    }

    modal.append(head, body);
    if (opts.footer) {
      const foot = document.createElement('div');
      foot.className = 'modal-foot';
      if (typeof opts.footer === 'string') foot.innerHTML = opts.footer;
      else foot.appendChild(opts.footer);
      modal.appendChild(foot);
    }
    backdrop.appendChild(modal);
    root.appendChild(backdrop);

    const api = {
      backdrop, modal, body,
      close() {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        if (opts.onClose) opts.onClose();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
    };
    closeBtn.addEventListener('click', api.close);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop && !opts.persistent) api.close();
    });
    document.addEventListener('keydown', onKey);
    VE.hydrateIcons(body);
    return api;
  };

  VE.confirm = function (title, message, confirmLabel = 'Confirm', danger = true) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.style.cssText = 'font-size:12.5px;line-height:1.6;color:var(--muted)';
      body.textContent = message;
      const footer = document.createElement('div');
      footer.className = 'btn-row';
      footer.innerHTML = `<button class="btn ghost" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? 'primary' : 'soft'}" data-act="ok">${VE.escapeHtml(confirmLabel)}</button>`;
      const m = VE.openModal({ title, body, footer, onClose: () => resolve(false) });
      footer.querySelector('[data-act=cancel]').addEventListener('click', () => { m.close(); });
      footer.querySelector('[data-act=ok]').addEventListener('click', () => {
        resolve(true);
        m.close();
      });
    });
  };

  VE.openMenu = function (anchor, items) {
    document.querySelectorAll('.floating-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'floating-menu';
    menu.style.cssText = `position:fixed;z-index:300;background:#121623;border:1px solid var(--line);
      border-radius:10px;padding:5px;min-width:170px;box-shadow:0 18px 50px rgba(0,0,0,.6);`;
    items.forEach(item => {
      const b = document.createElement('button');
      b.style.cssText = 'display:flex;width:100%;align-items:center;gap:8px;background:none;border:0;color:var(--text);padding:7px 9px;border-radius:6px;font-size:12px;text-align:left;';
      b.innerHTML = (item.icon ? VE.icon(item.icon) : '') + '<span></span>';
      b.querySelector('span').textContent = item.label;
      b.addEventListener('mouseenter', () => { b.style.background = 'var(--panel-3)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
      b.addEventListener('click', () => { close(); item.onClick && item.onClick(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.min(window.innerWidth - mw - 10, r.left);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 10) top = r.top - mh - 6;
    menu.style.left = Math.max(10, left) + 'px';
    menu.style.top = Math.max(10, top) + 'px';
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey);
    };
    const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    return { close };
  };

  VE.pickFiles = function (accept, multiple = true) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '';
      input.multiple = multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      });
      input.click();
    });
  };

  VE.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  VE.safeFilename = function (name) {
    return String(name || 'project').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
  };
})();
