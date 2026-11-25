/* LetitEdit Video Editor — small DOM and sheet primitives. */

import { formatClock, formatDuration } from '../utils.js';

const ICONS = {
  text: '<path d="M5 6h14M12 6v13M8 19h8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M3 16l5-4 4 3 3-2 6 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 10l5-3v10l-5-3z" fill="currentColor"/>',
  audio: '<path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/>',
  shape: '<rect x="4" y="4" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="16" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  sticker: '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  filter: '<circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="15" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  transition: '<path d="M4 6h6v12H4zM14 6h6v12h-6z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 12h4M12 10l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  speed: '<path d="M12 20a8 8 0 1 1 8-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12l4-4M12 20h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  split: '<path d="M12 3v18M8 7l-4 4 4 4M16 7l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  eyeOff: '<path d="M4 4l16 16M9.5 6.4A10.6 10.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.2 3.8M6.2 7.8A16.5 16.5 0 0 0 2.5 12s3.5 6 9.5 6a10 10 0 0 0 4.1-.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  unlock: '<rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10V7a4 4 0 0 1 7.6-1.7" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  up: '<path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M6 10l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v5h14v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  download: '<path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<path d="M12 4l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  layers: '<path d="M12 4l8 4-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  sparkles: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor"/>',
  timer: '<circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v4l2.5 2M9 3h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause: '<path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/>',
  chevron: '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.sparkles}</svg>`;
}

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'string') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function frag(...children) {
  const fragment = document.createDocumentFragment();
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    fragment.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return fragment;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function clock(seconds) {
  return formatClock(seconds, false);
}

export function durationLabel(seconds) {
  return formatDuration(seconds);
}

export function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function field(label, control, note) {
  const wrap = h('div', { class: 'se-field' });
  if (label) wrap.append(h('span', { class: 'se-field-label', text: label }));
  wrap.append(control);
  if (note) wrap.append(h('p', { class: 'se-field-note', text: note }));
  return wrap;
}

export function note(message, tone = '') {
  return h('p', { class: `se-note${tone ? ` is-${tone}` : ''}`, text: message });
}

export function setPressed(node, pressed) {
  node.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

/* ------------------------------------------------------------------ sheets */

export class Sheets {
  constructor(root) {
    this.root = root;
    this.current = null;
    this.previousFocus = null;
    this.locked = false;
    this._onKey = this.onKey.bind(this);
  }

  lockScroll() {
    if (this.locked) return;
    this.locked = true;
    this.scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
  }

  unlockScroll() {
    if (!this.locked) return;
    this.locked = false;
    document.documentElement.style.overflow = '';
  }

  onKey(event) {
    if (!this.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  /**
   * Open a bottom sheet. Returns { close, body, sheet, setTitle }.
   * Only one sheet is open at a time; opening another replaces it.
   */
  open(options = {}) {
    this.close({ restoreFocus: false, silent: true });
    const {
      title = '',
      sub = '',
      body = null,
      footer = null,
      onMount = null,
      onClose = null,
      dismissible = true,
      tall = false
    } = options;

    this.previousFocus = document.activeElement;
    const titleId = `se-sheet-title-${Date.now()}`;
    const bodyNode = h('div', { class: 'se-sheet-body' });
    if (body) bodyNode.append(body.nodeType ? body : h('div', { html: String(body) }));

    const head = h(
      'div',
      { class: 'se-sheet-head' },
      h(
        'div',
        { class: 'se-sheet-head-text' },
        h('h2', { class: 'se-sheet-title', id: titleId, text: title }),
        sub ? h('p', { class: 'se-sheet-sub', text: sub }) : null
      ),
      dismissible
        ? h('button', {
            type: 'button',
            class: 'se-sheet-close',
            'aria-label': 'Close',
            html: icon('close'),
            onclick: () => this.close()
          })
        : null
    );

    const sheet = h(
      'div',
      { class: 'se-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'se-sheet-handle', 'aria-hidden': 'true' }),
      head,
      bodyNode
    );

    if (Array.isArray(footer) && footer.length) {
      const foot = h('div', { class: 'se-sheet-foot' });
      for (const item of footer) {
        if (!item) continue;
        const button = h('button', {
          type: 'button',
          class: `se-btn${item.variant ? ` se-btn-${item.variant}` : ''}`,
          text: item.label,
          disabled: Boolean(item.disabled),
          onclick: () => item.onClick?.()
        });
        if (item.id) button.id = item.id;
        foot.append(button);
      }
      sheet.append(foot);
    }

    const backdrop = h('div', { class: 'se-sheet-backdrop' }, sheet);
    backdrop.addEventListener('pointerdown', (event) => {
      if (!dismissible) return;
      if (event.target === backdrop) this.close();
    });

    this.root.append(backdrop);
    this.lockScroll();
    this.root.closest('.se-app')?.classList.add('has-sheet');
    /* The sheet leaves only a thin strip of backdrop at the top of the screen,
       so keep at most one toast there instead of stacking over the header. */
    const toasts = this.root.parentElement?.querySelector('.se-toasts');
    if (toasts) while (toasts.children.length > 1) toasts.firstElementChild.remove();
    document.addEventListener('keydown', this._onKey, true);

    if (tall) sheet.style.maxHeight = 'min(94vh, 900px)';

    const controller = {
      close: () => this.close(),
      body: bodyNode,
      sheet,
      setTitle: (value) => {
        const node = sheet.querySelector('.se-sheet-title');
        if (node) node.textContent = value;
      }
    };
    this.current = { backdrop, sheet, controller, onClose, dismissible };

    /* Swipe the handle down to dismiss. */
    const handle = sheet.querySelector('.se-sheet-handle');
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      if (!dismissible) return;
      drag = { y: event.clientY, dy: 0, id: event.pointerId };
      handle.setPointerCapture?.(event.pointerId);
      sheet.style.transition = 'none';
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.dy = Math.max(0, event.clientY - drag.y);
      sheet.style.transform = `translateY(${drag.dy}px)`;
    });
    const endDrag = (event) => {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      const shouldClose = drag.dy > 90;
      drag = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (shouldClose) this.close();
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    if (onMount) {
      try {
        onMount(bodyNode, controller);
      } catch (error) {
        console.error('Sheet mount failed', error);
        bodyNode.append(note(`This panel could not be built: ${error.message || error}`, 'error'));
      }
    }

    requestAnimationFrame(() => {
      const focusable = bodyNode.querySelector('textarea, input:not([type="hidden"]), select, button, [tabindex]');
      if (focusable && !focusable.disabled) focusable.focus({ preventScroll: true });
    });

    return controller;
  }

  close({ restoreFocus = true, silent = false } = {}) {
    if (!this.current) return;
    const { backdrop, onClose } = this.current;
    this.current = null;
    backdrop.remove();
    this.unlockScroll();
    this.root.closest('.se-app')?.classList.remove('has-sheet');
    document.removeEventListener('keydown', this._onKey, true);
    if (!silent) {
      try {
        onClose?.();
      } catch (error) {
        console.error('Sheet close failed', error);
      }
    }
    if (restoreFocus && this.previousFocus && document.contains(this.previousFocus)) {
      try {
        this.previousFocus.focus({ preventScroll: true });
      } catch (error) {
        /* focus target is gone */
      }
    }
    this.previousFocus = null;
  }
}

/* ------------------------------------------------------------------ toasts */

export class Toasts {
  constructor(root) {
    this.root = root;
    this.timers = new Set();
  }

  show(message, tone = '', duration = 3400) {
    const node = h('div', { class: 'se-toast', dataset: { tone }, text: message });
    /* With a sheet open the toast sits above the panel, in the small gap the
       sheet leaves at the top of the screen. Only one at a time fits there. */
    const sheetOpen = this.root.closest('.se-app')?.classList.contains('has-sheet');
    if (sheetOpen) {
      while (this.root.firstElementChild) this.root.firstElementChild.remove();
    }
    this.root.append(node);
    while (this.root.children.length > (sheetOpen ? 1 : 2)) this.root.firstElementChild.remove();
    const timer = setTimeout(() => {
      node.remove();
      this.timers.delete(timer);
    }, duration);
    this.timers.add(timer);
    return node;
  }
}
