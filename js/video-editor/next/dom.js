/* LetitEdit editor V3 — small DOM helpers shared by the interface modules. */

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

let toastTimer = 0;

export function toast(message, tone = 'info', timeout = 3800) {
  const host = document.getElementById('ve-toasts');
  if (!host) return;
  const item = document.createElement('div');
  item.className = `ve-toast ve-toast-${tone}`;
  item.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  item.textContent = message;
  host.appendChild(item);
  requestAnimationFrame(() => item.classList.add('is-visible'));
  window.clearTimeout(toastTimer);
  setTimeout(() => {
    item.classList.remove('is-visible');
    setTimeout(() => item.remove(), 220);
  }, timeout);
  while (host.children.length > 4) host.firstElementChild.remove();
}

export function focusWithoutScroll(element) {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = label || 'Working…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.idleLabel || button.textContent;
    button.disabled = false;
    delete button.dataset.idleLabel;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export function formatTime(seconds, withFrames = false, fps = 30) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  if (withFrames) {
    const frames = Math.floor((safe % 1) * Math.max(1, fps));
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  }
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function confirmAction(message, { title = 'Are you sure?', confirmLabel = 'Continue', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('ve-confirm-dialog');
    if (!dialog) {
      resolve(window.confirm(message));
      return;
    }
    dialog.querySelector('[data-confirm-title]').textContent = title;
    dialog.querySelector('[data-confirm-message]').textContent = message;
    const ok = dialog.querySelector('[data-confirm-ok]');
    ok.textContent = confirmLabel;
    ok.classList.toggle('is-danger', Boolean(danger));
    const cleanup = () => {
      ok.removeEventListener('click', onOk);
      dialog.querySelector('[data-confirm-cancel]').removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
    };
    const onOk = (event) => {
      event.preventDefault();
      cleanup();
      dialog.close('confirm');
      resolve(true);
    };
    const onCancel = (event) => {
      if (event) event.preventDefault();
      cleanup();
      dialog.close('cancel');
      resolve(false);
    };
    ok.addEventListener('click', onOk);
    dialog.querySelector('[data-confirm-cancel]').addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}
