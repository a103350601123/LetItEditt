/* LetitEdit Video Editor — local project and media persistence.
 *
 * IndexedDB keeps the project JSON and the imported files so a reload can
 * restore the edit without asking for the files again. Nothing leaves the
 * device. Every failure is reported to the caller instead of being hidden.
 */

import { restoreProject } from '../model.js';
import { sanitizeFilename } from '../utils.js';

const DB_NAME = 'letitedit-video-editor';
const DB_VERSION = 1;
const META_STORE = 'meta';
const MEDIA_STORE = 'media';
const META_KEY = 'current';
const FALLBACK_KEY = 'letitedit-video-editor-project';

let dbPromise = null;

function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not provide IndexedDB.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('The local database could not be opened.'));
    request.onblocked = () => reject(new Error('The local database is blocked by another tab.'));
  });
  return dbPromise;
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Local storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local storage transaction was aborted.'));
  });
}

function mediaMeta(asset) {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    mimeType: asset.mimeType || '',
    size: asset.size || 0,
    duration: asset.duration || 0,
    width: asset.width || 0,
    height: asset.height || 0
  };
}

export async function saveLocal(project, assets) {
  const db = await openDb();
  const savedAt = Date.now();
  const list = Array.isArray(assets) ? assets : [];

  /* Read the existing keys in their own transaction; an awaited request would
   * let a readwrite transaction auto-commit before the media puts below. */
  const keyTransaction = db.transaction(MEDIA_STORE, 'readonly');
  const existingKeys = new Set(await requestPromise(keyTransaction.objectStore(MEDIA_STORE).getAllKeys()));

  const transaction = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
  const metaStore = transaction.objectStore(META_STORE);
  const mediaStore = transaction.objectStore(MEDIA_STORE);

  metaStore.put(
    {
      schema: 2,
      project,
      savedAt,
      media: list.map(mediaMeta)
    },
    META_KEY
  );

  const currentKeys = new Set();
  for (const asset of list) {
    if (!asset || !asset.id) continue;
    currentKeys.add(asset.id);
    if (!existingKeys.has(asset.id) && asset.file) {
      mediaStore.put(
        {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          mimeType: asset.mimeType || '',
          file: asset.file
        },
        asset.id
      );
    }
  }
  for (const key of existingKeys) {
    if (!currentKeys.has(key)) mediaStore.delete(key);
  }
  await transactionDone(transaction);
  return { savedAt, mediaCount: list.length };
}

export async function loadLocal() {
  const db = await openDb();
  const metaTransaction = db.transaction(META_STORE, 'readonly');
  const meta = await requestPromise(metaTransaction.objectStore(META_STORE).get(META_KEY));
  if (!meta || !meta.project) return null;

  const entries = meta.media || [];
  const mediaTransaction = db.transaction(MEDIA_STORE, 'readonly');
  const store = mediaTransaction.objectStore(MEDIA_STORE);
  const records = await Promise.all(entries.map((entry) => requestPromise(store.get(entry.id))));
  const media = [];
  const missing = [];
  entries.forEach((entry, index) => {
    const record = records[index];
    if (record && record.file) {
      let file = record.file;
      if (!(file instanceof File)) {
        file = new File([record.file], record.name || entry.name || 'media', { type: record.mimeType || entry.mimeType || '' });
      }
      media.push({ ...entry, file });
    } else {
      missing.push({ id: entry.id, name: entry.name || 'Unnamed file' });
    }
  });
  return {
    project: meta.project,
    media,
    missing,
    savedAt: meta.savedAt || 0
  };
}

export async function clearLocal() {
  const db = await openDb();
  const transaction = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
  transaction.objectStore(META_STORE).clear();
  transaction.objectStore(MEDIA_STORE).clear();
  await transactionDone(transaction);
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch (error) {
    /* storage disabled */
  }
}

export function saveFallback(project) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify({ savedAt: Date.now(), project }));
    return true;
  } catch (error) {
    return false;
  }
}

export function loadFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.project ? parsed : null;
  } catch (error) {
    return null;
  }
}

export function clearFallback() {
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch (error) {
    /* storage disabled */
  }
}

export function projectFileName(project) {
  return `${sanitizeFilename(project?.name || 'video-project', 'video-project')}.letitedit.json`;
}

export function downloadProjectFile(project, assets) {
  const payload = {
    schema: 2,
    savedAt: new Date().toISOString(),
    project,
    media: (assets || []).map(mediaMeta)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = projectFileName(project);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return payload;
}

export async function readProjectFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error('That file is not valid project JSON.');
  }
  const restored = restoreProject(data);
  return {
    project: restored.project,
    media: restored.media || []
  };
}
