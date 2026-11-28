/* Background Remover inference worker.
 * Runs BiRefNet Lite (MIT) locally with ONNX Runtime Web.
 * The model is kept in Cache Storage after a verified download so repeat
 * visits do not re-download the 94 MB file. Inference stays in this worker.
 * Images never leave the browser on this path. */

import { MODEL_CONFIG } from './model-config.mjs';
import { verifyModelBuffer } from './integrity.js';

const MODEL_URL = new URL(MODEL_CONFIG.url, self.location.href).href;
const MODEL_BYTES = MODEL_CONFIG.bytes;
const MODEL_SIZE = 512;
const ORT_PATH = '/vendor/onnxruntime/';
const CACHE_NAME = 'letitedit-bgr-model-v1';
const THREAD_LIMIT = 4;

let ort = null;
let session = null;
let backend = 'wasm';
let loadPromise = null;
let downloadPromise = null;
let downloadAbort = null;
let preparePromise = null;
let prepareCancelled = false;
let cancelled = new Set();

function post(type, data = {}, transfer) {
  self.postMessage({ type, ...data }, transfer || []);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function threadCount() {
  if (!self.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(THREAD_LIMIT, navigator.hardwareConcurrency || 1));
}

/* WebGPU is only selected when a real adapter can be acquired. The presence of
 * navigator.gpu alone is not evidence that inference will work. */
async function usableWebGPU() {
  if (typeof navigator === 'undefined' || !navigator.gpu || !navigator.gpu.requestAdapter) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return !!adapter;
  } catch (error) {
    return false;
  }
}

async function importOrt(preferWebGPU) {
  if (preferWebGPU) {
    try {
      const mod = await import(ORT_PATH + 'ort.webgpu.min.mjs');
      mod.env.wasm.wasmPaths = ORT_PATH;
      mod.env.wasm.numThreads = threadCount();
      mod.env.wasm.simd = true;
      mod.env.logLevel = 'fatal';
      backend = 'webgpu';
      return mod;
    } catch (error) {
      /* Fall through to the WASM build. */
    }
  }
  const mod = await import(ORT_PATH + 'ort.wasm.min.mjs');
  mod.env.wasm.wasmPaths = ORT_PATH;
  mod.env.wasm.numThreads = threadCount();
  mod.env.wasm.simd = true;
  mod.env.logLevel = 'fatal';
  backend = 'wasm';
  return mod;
}

function modelHost() {
  try {
    return new URL(MODEL_URL).host;
  } catch (error) {
    return 'the configured model host';
  }
}

function openCache() {
  if (typeof caches === 'undefined') return Promise.resolve(null);
  return caches.open(CACHE_NAME).catch(() => null);
}

async function readCachedModel() {
  const cache = await openCache();
  if (!cache) return null;
  let hit = null;
  try {
    hit = await cache.match(MODEL_URL);
  } catch (error) {
    return null;
  }
  if (!hit) return null;
  try {
    const buffer = await hit.arrayBuffer();
    post('model-stage', { stage: 'verify', backend });
    const result = await verifyModelBuffer(buffer, MODEL_CONFIG);
    if (!result.verified) {
      await cache.delete(MODEL_URL).catch(() => {});
      return null;
    }
    post('model-stage', { stage: 'cache-hit', backend });
    return { buffer, verified: true, source: 'cache' };
  } catch (error) {
    /* A corrupt or truncated cache entry is deleted and treated as a miss. */
    await cache.delete(MODEL_URL).catch(() => {});
    post('model-stage', { stage: 'cache-invalid', backend });
    return null;
  }
}

async function writeCachedModel(buffer) {
  const cache = await openCache();
  if (!cache) return false;
  try {
    const response = new Response(buffer, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(buffer.byteLength),
        'x-model-sha256': MODEL_CONFIG.sha256,
        'x-model-version': MODEL_CONFIG.version
      }
    });
    await cache.put(MODEL_URL, response);
    return true;
  } catch (error) {
    /* Quota, private-mode or storage failures must not break processing. */
    post('model-stage', { stage: 'cache-write-failed', backend });
    return false;
  }
}

async function fetchModel(cacheMode, signal) {
  let response;
  try {
    response = await fetch(MODEL_URL, { cache: cacheMode, mode: 'cors', signal });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new Error(
      'The AI model host (' +
        modelHost() +
        ') could not be reached. Check your connection, the configured model URL, ' +
        'and that the host allows cross-origin GET requests (CORS).'
    );
  }
  if (!response.ok) {
    throw new Error(
      'The AI model could not be downloaded from ' +
        modelHost() +
        ' (HTTP ' +
        response.status +
        '). Check that the public model URL is correct and that the object is publicly readable.'
    );
  }
  const total = Number(response.headers.get('content-length')) || MODEL_BYTES;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    post('model-progress', { loaded: buffer.byteLength, total });
    return buffer;
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(MODEL_BYTES);
  let loaded = 0;
  let lastReport = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > buffer.length) {
        throw new Error(
          'The AI model download is larger than the published ' +
            MODEL_BYTES +
            ' bytes. The hosted file does not match the published model.'
        );
      }
      buffer.set(value, loaded);
      loaded += value.length;
      const now = Date.now();
      if (now - lastReport > 240) {
        lastReport = now;
        post('model-progress', { loaded, total });
      }
    }
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    if (error && /larger than the published/.test(error.message)) throw error;
    throw new Error(
      'The AI model download was interrupted after ' +
        loaded +
        ' bytes. Check your connection and try again.'
    );
  }
  if (loaded !== MODEL_BYTES) {
    throw new Error(
      'The AI model download was incomplete (' +
        loaded +
        ' of ' +
        MODEL_BYTES +
        ' bytes). Check your connection and try again.'
    );
  }
  post('model-progress', { loaded, total });
  return buffer.buffer;
}

async function downloadVerifiedModel() {
  if (downloadPromise) {
    if (downloadAbort && !downloadAbort.signal.aborted) return downloadPromise;
    /* A cancelled preparation may still be settling. Wait for it, then start a
     * fresh download instead of returning the aborted promise. */
    try {
      await downloadPromise;
    } catch (error) {
      /* The previous attempt was cancelled or failed; retry below. */
    }
  }
  downloadAbort = new AbortController();
  const signal = downloadAbort.signal;
  downloadPromise = (async () => {
    let lastError = null;
    for (const cacheMode of ['force-cache', 'reload']) {
      if (signal.aborted) throw Object.assign(new Error('Model preparation cancelled.'), { name: 'AbortError' });
      if (cacheMode === 'reload') post('model-stage', { stage: 'retry', backend });
      try {
        const buffer = await fetchModel(cacheMode, signal);
        post('model-stage', { stage: 'verify', backend });
        const result = await verifyModelBuffer(buffer, MODEL_CONFIG);
        await writeCachedModel(buffer);
        return { buffer, verified: result.verified, source: 'download' };
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        lastError = error;
        if (!/integrity|incomplete|interrupted/i.test(error.message)) throw error;
      }
    }
    throw lastError;
  })().finally(() => {
    downloadPromise = null;
    downloadAbort = null;
  });
  return downloadPromise;
}

/* Serialise the download across tabs so two open tabs cannot both pull the
 * 94 MB model. The Web Locks API is optional; without it each tab keeps its
 * own single-flight promise. */
async function withModelLock(task) {
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    return navigator.locks.request(CACHE_NAME + '-lock', task);
  }
  return task();
}

async function getVerifiedModel() {
  const cached = await readCachedModel();
  if (cached) return cached;
  return withModelLock(async () => {
    /* Another tab may have finished the download while this one waited. */
    const rechecked = await readCachedModel();
    if (rechecked) return rechecked;
    return downloadVerifiedModel();
  });
}

async function loadSession() {
  if (session) return session;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const started = performance.now();
    const preferWebGPU = await usableWebGPU();
    let mod = await importOrt(preferWebGPU);
    post('model-stage', { stage: 'download', backend });
    const { buffer, verified, source } = await getVerifiedModel();
    post('model-stage', { stage: 'initialise', backend });
    const options = {
      executionProviders: [backend === 'webgpu' ? 'webgpu' : 'wasm'],
      graphOptimizationLevel: 'all'
    };
    try {
      session = await mod.InferenceSession.create(buffer, options);
    } catch (error) {
      if (backend !== 'webgpu') throw error;
      post('model-stage', { stage: 'fallback', backend: 'wasm' });
      ort = null;
      session = null;
      mod = await importOrt(false);
      ort = mod;
      backend = 'wasm';
      session = await mod.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
    }
    ort = mod;
    post('model-ready', {
      backend,
      threads: backend === 'wasm' ? threadCount() : 1,
      loadMs: Math.round(performance.now() - started),
      bytes: buffer.byteLength,
      verified: !!verified,
      source,
      sha256: MODEL_CONFIG.sha256
    });
    return session;
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

/* Prepare the model without building a session. Used after a Cloudflare result
 * so the next visit can run locally. Safe to call repeatedly. */
async function prepareModel() {
  if (preparePromise) return preparePromise;
  prepareCancelled = false;
  preparePromise = (async () => {
    const cached = await readCachedModel();
    if (cached) {
      post('model-cached', { bytes: cached.buffer.byteLength, source: 'cache' });
      return true;
    }
    return withModelLock(async () => {
      if (prepareCancelled) {
        post('model-prep-cancelled');
        return false;
      }
      const rechecked = await readCachedModel();
      if (rechecked) {
        post('model-cached', { bytes: rechecked.buffer.byteLength, source: 'cache' });
        return true;
      }
      post('model-stage', { stage: 'download', backend: 'wasm' });
      const { buffer, verified } = await downloadVerifiedModel();
      post('model-cached', {
        bytes: buffer.byteLength,
        verified: !!verified,
        source: 'download'
      });
      return true;
    });
  })()
    .catch((error) => {
      if (error && error.name === 'AbortError') {
        post('model-prep-cancelled');
      } else {
        post('model-prep-error', {
          message: error && error.message ? error.message : 'The local AI model could not be prepared.'
        });
      }
      return false;
    })
    .finally(() => {
      preparePromise = null;
    });
  return preparePromise;
}

function boxFilter(source, width, height, radius) {
  const r = Math.max(1, Math.round(radius));
  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    const maxX = Math.min(r, width - 1);
    for (let x = 0; x <= maxX; x++) sum += source[row + x];
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - r);
      const right = Math.min(width - 1, x + r);
      temp[row + x] = sum / (right - left + 1);
      if (right + 1 < width) sum += source[row + right + 1];
      if (x - r >= 0) sum -= source[row + x - r];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    const maxY = Math.min(r, height - 1);
    for (let y = 0; y <= maxY; y++) sum += temp[y * width + x];
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - r);
      const bottom = Math.min(height - 1, y + r);
      out[y * width + x] = sum / (bottom - top + 1);
      if (bottom + 1 < height) sum += temp[(bottom + 1) * width + x];
      if (y - r >= 0) sum -= temp[(y - r) * width + x];
    }
  }
  return out;
}

function guidedFilter(rgba, alpha, width, height) {
  const length = width * height;
  const guide = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const offset = i * 4;
    guide[i] =
      (0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]) / 255;
  }
  const meanGuide = boxFilter(guide, width, height, 7);
  const meanAlpha = boxFilter(alpha, width, height, 7);
  const guideSquare = new Float32Array(length);
  const guideAlpha = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    guideSquare[i] = guide[i] * guide[i];
    guideAlpha[i] = guide[i] * alpha[i];
  }
  const meanGuideSquare = boxFilter(guideSquare, width, height, 7);
  const meanGuideAlpha = boxFilter(guideAlpha, width, height, 7);
  const a = new Float32Array(length);
  const b = new Float32Array(length);
  const eps = 0.0008;
  for (let i = 0; i < length; i++) {
    const variance = Math.max(0, meanGuideSquare[i] - meanGuide[i] * meanGuide[i]);
    const covariance = meanGuideAlpha[i] - meanGuide[i] * meanAlpha[i];
    a[i] = covariance / (variance + eps);
    b[i] = meanAlpha[i] - a[i] * meanGuide[i];
  }
  const meanA = boxFilter(a, width, height, 7);
  const meanB = boxFilter(b, width, height, 7);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = clamp(meanA[i] * guide[i] + meanB[i], 0, 1);
  }
  return out;
}

/* Map the 512 x 512 model mask back to the image, sampling only the content
 * rectangle produced by the letterboxed preprocess step. */
function upsampleMask(logits, width, height, rect) {
  const sourceWidth = MODEL_SIZE;
  const sourceHeight = MODEL_SIZE;
  const box = rect || { x: 0, y: 0, w: MODEL_SIZE, h: MODEL_SIZE };
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = box.y + ((y + 0.5) / height) * box.h - 0.5;
    let y0 = Math.floor(fy);
    let wy = fy - y0;
    if (y0 < box.y) {
      y0 = box.y;
      wy = 0;
    } else if (y0 >= box.y + box.h - 1) {
      y0 = box.y + box.h - 1;
      wy = 0;
    }
    const y1 = Math.min(box.y + box.h - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const fx = box.x + ((x + 0.5) / width) * box.w - 0.5;
      let x0 = Math.floor(fx);
      let wx = fx - x0;
      if (x0 < box.x) {
        x0 = box.x;
        wx = 0;
      } else if (x0 >= box.x + box.w - 1) {
        x0 = box.x + box.w - 1;
        wx = 0;
      }
      const x1 = Math.min(box.x + box.w - 1, x0 + 1);
      const v00 = logits[y0 * sourceWidth + x0];
      const v10 = logits[y0 * sourceWidth + x1];
      const v01 = logits[y1 * sourceWidth + x0];
      const v11 = logits[y1 * sourceWidth + x1];
      const value =
        (v00 * (1 - wx) + v10 * wx) * (1 - wy) +
        (v01 * (1 - wx) + v11 * wx) * wy;
      out[y * width + x] = 1 / (1 + Math.exp(-value));
    }
  }
  return out;
}

function decontaminate(rgba, alpha, width, height) {
  const out = new Uint8ClampedArray(rgba);
  const radius = Math.max(2, Math.min(6, Math.round(Math.min(width, height) * 0.006)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const a = alpha[index];
      if (a < 0.04 || a > 0.96) continue;
      let red = 0;
      let green = 0;
      let blue = 0;
      let weightSum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const sample = yy * width + xx;
          const sampleAlpha = alpha[sample];
          if (sampleAlpha < 0.55) continue;
          const distance = Math.sqrt(dx * dx + dy * dy) / (radius + 1);
          const weight = Math.pow(sampleAlpha, 4) * (1 - Math.min(1, distance) * 0.55);
          const offset = sample * 4;
          red += rgba[offset] * weight;
          green += rgba[offset + 1] * weight;
          blue += rgba[offset + 2] * weight;
          weightSum += weight;
        }
      }
      if (weightSum > 0) {
        const mix = Math.min(0.8, (1 - a) * 0.8);
        const offset = index * 4;
        out[offset] = rgba[offset] * (1 - mix) + (red / weightSum) * mix;
        out[offset + 1] = rgba[offset + 1] * (1 - mix) + (green / weightSum) * mix;
        out[offset + 2] = rgba[offset + 2] * (1 - mix) + (blue / weightSum) * mix;
      }
    }
  }
  return out;
}

async function processImage(message) {
  const id = message.id;
  const width = message.width;
  const height = message.height;
  const tensorData = new Float32Array(message.tensor);
  const rgba = new Uint8ClampedArray(message.rgba);
  const rect = message.rect || { x: 0, y: 0, w: MODEL_SIZE, h: MODEL_SIZE };
  cancelled.delete(id);

  try {
    const activeSession = await loadSession();
    if (cancelled.has(id)) return;
    post('processing', { id, stage: 'inference', backend });
    const inputName = activeSession.inputNames[0] || 'input_image';
    const outputName = activeSession.outputNames[0] || 'output_image';
    const tensor = new ort.Tensor('float32', tensorData, [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const result = await activeSession.run({ [inputName]: tensor });
    if (cancelled.has(id)) return;
    const output = result[outputName] || result[Object.keys(result)[0]];
    if (!output || !output.data) throw new Error('The AI model returned no mask.');
    post('processing', { id, stage: 'refine', backend });

    const raw = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    let alpha = upsampleMask(raw, width, height, rect);
    alpha = guidedFilter(rgba, alpha, width, height);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = clamp((alpha[i] - 0.01) / 0.98, 0, 1);
    }
    const clean = decontaminate(rgba, alpha, width, height);
    const alphaBytes = new Uint8ClampedArray(alpha.length);
    for (let i = 0; i < alpha.length; i++) alphaBytes[i] = Math.round(alpha[i] * 255);
    if (cancelled.has(id)) return;
    post(
      'result',
      { id, width, height, alpha: alphaBytes.buffer, rgba: clean.buffer, backend },
      [alphaBytes.buffer, clean.buffer]
    );
  } catch (error) {
    if (cancelled.has(id) || (error && error.name === 'AbortError')) return;
    const messageText =
      error && error.message ? error.message : 'The AI model could not process this image.';
    const code = /integrity|incomplete|hash/i.test(messageText) ? 'model-integrity' : 'inference';
    post('error', { id, message: messageText, code });
  } finally {
    cancelled.delete(id);
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'process') {
    processImage(message);
  } else if (message.type === 'cancel') {
    cancelled.add(message.id);
    if (!session && !preparePromise && downloadAbort) {
      downloadAbort.abort();
    }
    post('cancelled', { id: message.id });
  } else if (message.type === 'warmup') {
    loadSession()
      .then(() => post('warmup-ready', { backend, threads: backend === 'wasm' ? threadCount() : 1 }))
      .catch((error) => {
        const text = error && error.message ? error.message : 'Model load failed.';
        post('warmup-error', {
          message: text,
          code: /integrity|incomplete|hash/i.test(text) ? 'model-integrity' : 'model-load'
        });
      });
  } else if (message.type === 'prepare-model') {
    prepareModel();
  } else if (message.type === 'cancel-prepare') {
    prepareCancelled = true;
    if (downloadAbort) downloadAbort.abort();
  }
};
