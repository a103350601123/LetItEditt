/* Background Remover inference worker.
 * Runs BiRefNet Lite (MIT) locally with ONNX Runtime Web.
 * Images never leave the browser. */

const MODEL_URL = '/vendor/background-removal/model_fp16.onnx';
const MODEL_BYTES = 98484532;
const MODEL_SIZE = 512;
const ORT_PATH = '/vendor/onnxruntime/';

let ort = null;
let session = null;
let backend = 'wasm';
let loadPromise = null;
let cancelled = new Set();

function post(type, data = {}, transfer) {
  self.postMessage({ type, ...data }, transfer || []);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function importOrt(preferWebGPU) {
  if (preferWebGPU && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const mod = await import(ORT_PATH + 'ort.webgpu.min.mjs');
      mod.env.wasm.wasmPaths = ORT_PATH;
      mod.env.wasm.numThreads = 1;
      mod.env.wasm.simd = true;
      mod.env.logLevel = 'fatal';
      backend = 'webgpu';
      return mod;
    } catch (error) {
      /* Fall through to the small WASM build. */
    }
  }
  const mod = await import(ORT_PATH + 'ort.wasm.min.mjs');
  mod.env.wasm.wasmPaths = ORT_PATH;
  mod.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
    : 1;
  mod.env.wasm.simd = true;
  mod.env.logLevel = 'fatal';
  backend = 'wasm';
  return mod;
}

async function fetchModel() {
  const response = await fetch(MODEL_URL, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error('The AI model could not be downloaded (HTTP ' + response.status + ').');
  }
  const total = Number(response.headers.get('content-length')) || MODEL_BYTES;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    post('model-progress', { loaded: buffer.byteLength, total });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  let lastReport = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const now = Date.now();
    if (now - lastReport > 240) {
      lastReport = now;
      post('model-progress', { loaded, total });
    }
  }
  post('model-progress', { loaded, total });
  return new Blob(chunks).arrayBuffer();
}

async function loadSession() {
  if (session) return session;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const started = performance.now();
    const preferWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
    let mod = await importOrt(preferWebGPU);
    post('model-stage', { stage: 'download', backend });
    const buffer = await fetchModel();
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
      loadMs: Math.round(performance.now() - started),
      bytes: MODEL_BYTES
    });
    return session;
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });
  return loadPromise;
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

function upsampleMask(logits, width, height) {
  const sourceWidth = MODEL_SIZE;
  const sourceHeight = MODEL_SIZE;
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * scaleY - 0.5;
    let y0 = Math.floor(fy);
    let wy = fy - y0;
    if (y0 < 0) {
      y0 = 0;
      wy = 0;
    } else if (y0 >= sourceHeight - 1) {
      y0 = sourceHeight - 1;
      wy = 0;
    }
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) * scaleX - 0.5;
      let x0 = Math.floor(fx);
      let wx = fx - x0;
      if (x0 < 0) {
        x0 = 0;
        wx = 0;
      } else if (x0 >= sourceWidth - 1) {
        x0 = sourceWidth - 1;
        wx = 0;
      }
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
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
    let alpha = upsampleMask(raw, width, height);
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
    post('error', {
      id,
      message: error && error.message ? error.message : 'The AI model could not process this image.'
    });
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'process') {
    processImage(message);
  } else if (message.type === 'cancel') {
    cancelled.add(message.id);
  } else if (message.type === 'warmup') {
    loadSession()
      .then(() => post('warmup-ready', { backend }))
      .catch((error) => post('error', { message: error.message || 'Model load failed.' }));
  }
};
