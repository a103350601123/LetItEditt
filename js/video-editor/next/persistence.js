/* LetitEdit editor V3 — local project and media persistence.
 *
 * The timeline snapshot is written frequently. Original media blobs are
 * written once per file into a separate object store, only when browser quota
 * allows. Loading never assumes the media survived: clips can be relinked.
 */

const DB_NAME = 'letitedit-video-editor-v3';
const DB_VERSION = 2;
const AUTOSAVE_STORE = 'autosave';
const MEDIA_STORE = 'media';
const KEY = 'current';
const MAX_PERSISTED_MEDIA = 380 * 1024 * 1024;

let dbPromise = null;
let storedMediaIds = new Set();
let mediaKeysLoaded = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) db.createObjectStore(AUTOSAVE_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB could not be opened.'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function withStores(mode, stores, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const map = Object.fromEntries(stores.map((name) => [name, tx.objectStore(name)]));
    let result;
    try {
      result = action(map, tx);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('The local database operation failed.'));
    tx.onabort = () => reject(tx.error || new Error('The local database operation was aborted.'));
  });
}

function fallbackWrite(snapshot, skipped) {
  try {
    localStorage.setItem('letitedit:video-editor:v3', JSON.stringify({
      schema: 3,
      savedAt: new Date().toISOString(),
      snapshot,
      mediaManifest: snapshot.mediaManifest || [],
      skippedMedia: skipped,
      mediaError: true
    }));
    return true;
  } catch {
    return false;
  }
}

async function ensureMediaKeys() {
  if (mediaKeysLoaded) return;
  try {
    const keys = await withStores('readonly', [MEDIA_STORE], (stores) => new Promise((resolve, reject) => {
      const request = stores[MEDIA_STORE].getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
    storedMediaIds = new Set(keys);
  } catch {
    storedMediaIds = new Set();
  }
  mediaKeysLoaded = true;
}

export async function saveAutosave(snapshot, assets = []) {
  await ensureMediaKeys();
  const persistable = [];
  const skipped = [];
  let total = 0;
  for (const id of storedMediaIds) {
    const asset = assets.find((item) => item.id === id);
    if (asset?.file) total += asset.file.size;
  }
  for (const asset of assets) {
    if (!asset?.file) continue;
    if (storedMediaIds.has(asset.id)) continue;
    if (total + asset.file.size > MAX_PERSISTED_MEDIA) {
      skipped.push(asset.name);
      continue;
    }
    total += asset.file.size;
    persistable.push(asset);
  }

  try {
    const removed = [...storedMediaIds].filter((id) => !assets.some((asset) => asset.id === id));
    await withStores('readwrite', [AUTOSAVE_STORE, MEDIA_STORE], (stores) => {
      stores[AUTOSAVE_STORE].put({
        schema: 3,
        savedAt: new Date().toISOString(),
        snapshot,
        skippedMedia: skipped
      }, KEY);
      for (const asset of persistable) {
        stores[MEDIA_STORE].put({
          id: asset.id,
          name: asset.name,
          type: asset.type,
          mimeType: asset.mimeType,
          size: asset.file.size,
          blob: asset.file
        }, asset.id);
      }
      for (const id of removed) stores[MEDIA_STORE].delete(id);
    });
    for (const asset of persistable) storedMediaIds.add(asset.id);
    for (const id of removed) storedMediaIds.delete(id);
    try {
      localStorage.removeItem('letitedit:video-editor:v3');
    } catch {
      /* ignore */
    }
    return { ok: true, mediaCount: persistable.length, skipped };
  } catch (error) {
    const fallback = fallbackWrite(snapshot, skipped);
    return {
      ok: fallback,
      mediaCount: 0,
      skipped,
      warning: fallback
        ? 'The edit was saved without media because browser storage is unavailable or full.'
        : 'This browser could not save the edit locally.'
    };
  }
}

export async function loadAutosave() {
  let payload = null;
  try {
    payload = await withStores('readonly', [AUTOSAVE_STORE], (stores) => new Promise((resolve, reject) => {
      const request = stores[AUTOSAVE_STORE].get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  } catch {
    try {
      const raw = localStorage.getItem('letitedit:video-editor:v3');
      if (raw) payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }
  if (!payload?.snapshot) return null;
  return {
    snapshot: payload.snapshot,
    savedAt: payload.savedAt || null,
    skippedMedia: Array.isArray(payload.skippedMedia) ? payload.skippedMedia : [],
    mediaError: Boolean(payload.mediaError)
  };
}

export async function loadAutosaveMedia() {
  try {
    return await withStores('readonly', [MEDIA_STORE], (stores) => new Promise((resolve, reject) => {
      const request = stores[MEDIA_STORE].getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  } catch {
    return [];
  }
}

export async function loadAutosaveMediaMeta() {
  try {
    const records = await loadAutosaveMedia();
    return records.map((record) => ({ id: record.id, name: record.name, type: record.type, size: record.size, mimeType: record.mimeType }));
  } catch {
    return [];
  }
}

export async function clearAutosave() {
  storedMediaIds.clear();
  mediaKeysLoaded = false;
  try {
    await withStores('readwrite', [AUTOSAVE_STORE, MEDIA_STORE], (stores) => {
      stores[AUTOSAVE_STORE].delete(KEY);
      stores[MEDIA_STORE].clear();
    });
  } catch {
    /* fall through to localStorage */
  }
  try {
    localStorage.removeItem('letitedit:video-editor:v3');
  } catch {
    /* ignore */
  }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
