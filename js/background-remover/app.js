import { $, $$, clamp, createCanvas, formatBytes, formatMegapixels, downloadBlob, safeCanvasBlob, baseName } from './util.js';
import { computeBounds, renderScene } from './render.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EXPORT_DIM = 6000;
const MAX_EXPORT_PIXELS = 24 * 1000 * 1000;
const PREVIEW_MAX = 1800;
const MODEL_SIZE = 512;

const state = {
  fileName: 'image',
  originalWidth: 0,
  originalHeight: 0,
  sourceFull: null,
  previewSource: null,
  cleanSource: null,
  alpha: null,
  aiAlpha: null,
  maskCanvas: null,
  cutout: null,
  bounds: null,
  sceneCanvas: null,
  history: [],
  historyIndex: -1,
  view: { zoom: 1, panX: 0, panY: 0 },
  tool: 'pan',
  brush: { size: 64, softness: 65 },
  background: {
    type: 'transparent',
    color: '#2563eb',
    gradient: { from: '#eff6ff', to: '#2563eb', angle: 135 },
    image: null,
    blur: 0,
    depth: 0
  },
  studio: {
    shadowOpacity: 38,
    shadowBlur: 34,
    shadowDirection: 90,
    shadowOffset: 14,
    shadowFade: 55,
    reflection: 16,
    reflectionFade: 62
  },
  status: 'empty',
  compare: false,
  model: 'idle',
  modelVerified: false,
  backend: 'wasm',
  jobId: 0,
  worker: null,
  processing: false,
  spaceDown: false,
  pointers: new Map(),
  pinch: null,
  stroke: null,
  pan: null
};

const els = {
  canvas: $('[data-canvas]'),
  stage: $('[data-stage]'),
  empty: $('[data-empty]'),
  processing: $('[data-processing]'),
  progressBar: $('[data-progress-bar]'),
  progressText: $('[data-progress-text]'),
  cancel: $('[data-cancel]'),
  compare: $('[data-compare]'),
  compareBadge: $('[data-compare-badge]'),
  status: $('[data-status]'),
  subtitle: $('[data-stage-subtitle]'),
  stageHint: $('[data-stage-hint]'),
  fileInput: $('[data-file-input]'),
  browse: $$('[data-browse]'),
  fileMeta: $('[data-file-meta]'),
  process: $('[data-process]'),
  newImage: $('[data-new-image]'),
  controls: $$('[data-controls]'),
  modelNote: $('[data-model-note]'),
  error: $('[data-error]'),
  errorText: $('[data-error-text]'),
  errorClose: $('[data-error-close]'),
  zoomLabel: $('[data-zoom-label]'),
  bgRadios: $$('input[name="bgr-background"]'),
  color: $('[data-color]'),
  colorHex: $('[data-color-hex]'),
  gradientFrom: $('[data-gradient-from]'),
  gradientTo: $('[data-gradient-to]'),
  gradientAngle: $('[data-gradient-angle]'),
  gradientAngleValue: $('[data-gradient-angle-value]'),
  bgImageInput: $('[data-bg-image-input]'),
  bgImageMeta: $('[data-bg-image-meta]'),
  blur: $('[data-blur]'),
  blurValue: $('[data-blur-value]'),
  depth: $('[data-depth]'),
  depthValue: $('[data-depth-value]'),
  blurWrap: $('[data-blur-wrap]'),
  shadowOpacity: $('[data-shadow-opacity]'),
  shadowOpacityValue: $('[data-shadow-opacity-value]'),
  shadowBlur: $('[data-shadow-blur]'),
  shadowBlurValue: $('[data-shadow-blur-value]'),
  shadowDirection: $('[data-shadow-direction]'),
  shadowDirectionValue: $('[data-shadow-direction-value]'),
  shadowOffset: $('[data-shadow-offset]'),
  shadowOffsetValue: $('[data-shadow-offset-value]'),
  shadowFade: $('[data-shadow-fade]'),
  shadowFadeValue: $('[data-shadow-fade-value]'),
  reflection: $('[data-reflection]'),
  reflectionValue: $('[data-reflection-value]'),
  reflectionFade: $('[data-reflection-fade]'),
  reflectionFadeValue: $('[data-reflection-fade-value]'),
  brushSize: $('[data-brush-size]'),
  brushSizeValue: $('[data-brush-size-value]'),
  brushSoftness: $('[data-brush-softness]'),
  brushSoftnessValue: $('[data-brush-softness-value]'),
  undo: $('[data-undo]'),
  redo: $('[data-redo]'),
  resetMask: $('[data-reset-mask]'),
  format: $('[data-format]'),
  quality: $('[data-quality]'),
  qualityValue: $('[data-quality-value]'),
  qualityWrap: $('[data-quality-wrap]'),
  download: $('[data-download]'),
  exportNote: $('[data-export-note]'),
  exportMeta: $('[data-export-meta]'),
  toolButtons: $$('[data-tool]'),
  studioReset: $('[data-studio-reset]')
};

let renderQueued = false;
let resizeQueued = false;

function isTestHost() {
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderDisplay();
  });
}

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function showError(message) {
  if (!els.error) return;
  els.errorText.textContent = message;
  els.error.hidden = false;
  setStatus('Could not complete the action.');
}

function clearError() {
  if (els.error) els.error.hidden = true;
}

function setProgress(percent, text) {
  if (els.progressBar) {
    const value = Math.round(clamp(percent, 0, 100));
    els.progressBar.style.width = clamp(percent, 0, 100).toFixed(1) + '%';
    els.progressBar.classList.remove('is-indeterminate');
    const track = els.progressBar.parentElement;
    if (track) track.setAttribute('aria-valuenow', String(value));
  }
  if (text && els.progressText) els.progressText.textContent = text;
}

function setIndeterminate(text) {
  if (els.progressBar) {
    els.progressBar.style.width = '100%';
    els.progressBar.classList.add('is-indeterminate');
    const track = els.progressBar.parentElement;
    if (track) track.removeAttribute('aria-valuenow');
  }
  if (text && els.progressText) els.progressText.textContent = text;
}

function showProcessing(show) {
  state.processing = show;
  if (els.processing) els.processing.hidden = !show;
  if (els.process) els.process.disabled = show || !state.previewSource;
  if (show) clearError();
}

function updateModelNote() {
  if (!els.modelNote) return;
  if (state.model === 'ready') {
    const verification = state.modelVerified ? ' SHA-256 verified.' : '';
    els.modelNote.textContent =
      (state.backend === 'webgpu'
        ? 'AI model ready — WebGPU acceleration is active.'
        : 'AI model ready — CPU (WASM) fallback is active. Processing may take 30–90 seconds.') +
      verification;
  } else if (state.model === 'loading') {
    els.modelNote.textContent = 'Loading the AI model. The first run downloads about 94 MB.';
  } else if (state.model === 'error') {
    els.modelNote.textContent = 'The AI model could not be loaded. Check your connection and try again.';
  } else {
    els.modelNote.textContent =
      'The 94 MB AI model downloads only when you first remove a background. Images are processed on this device.';
  }
}

function updateHistoryButtons() {
  if (els.undo) els.undo.disabled = state.historyIndex <= 0;
  if (els.redo) els.redo.disabled = state.historyIndex < 0 || state.historyIndex >= state.history.length - 1;
  if (els.resetMask) els.resetMask.disabled = !state.aiAlpha;
}

function updateBackgroundPanels() {
  const type = state.background.type;
  $$('[data-bg-panel]').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-bg-panel') !== type;
  });
  const usesPhotoBlur = type === 'image' || type === 'original';
  if (els.blurWrap) els.blurWrap.hidden = !usesPhotoBlur;
  if (els.exportNote) {
    els.exportNote.textContent =
      state.background.type === 'transparent'
        ? 'PNG and WebP keep transparency. JPG will use a white background.'
        : 'The selected background, shadow and reflection are included in the downloaded file.';
  }
}

function updateExportControls() {
  const format = els.format ? els.format.value : 'image/png';
  if (els.qualityWrap) els.qualityWrap.hidden = format === 'image/png';
  if (els.qualityValue && els.quality) els.qualityValue.textContent = els.quality.value + '%';
  if (els.download) els.download.disabled = !state.alpha;
}

function setTool(tool) {
  state.tool = tool;
  els.toolButtons.forEach((button) => {
    const active = button.getAttribute('data-tool') === tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (els.canvas) els.canvas.setAttribute('data-tool', tool);
  if (els.stageHint) {
    els.stageHint.textContent =
      tool === 'erase'
        ? 'Erase mode: drag over the image to remove areas.'
        : tool === 'restore'
          ? 'Restore mode: drag over the image to bring areas back.'
          : 'Pan mode: drag the image, pinch to zoom, or use the wheel.';
  }
}

function setView(zoom, panX, panY) {
  state.view.zoom = clamp(zoom, 0.2, 8);
  state.view.panX = panX;
  state.view.panY = panY;
  if (els.zoomLabel) els.zoomLabel.textContent = Math.round(state.view.zoom * 100) + '%';
  scheduleRender();
}

function resetView() {
  setView(1, 0, 0);
}

function getFitScale(cssWidth, cssHeight) {
  const width = state.previewSource ? state.previewSource.width : 1;
  const height = state.previewSource ? state.previewSource.height : 1;
  const padding = Math.min(cssWidth, cssHeight) < 520 ? 18 : 32;
  return Math.max(0.0001, Math.min((cssWidth - padding * 2) / width, (cssHeight - padding * 2) / height));
}

function resizeDisplayCanvas() {
  if (!els.canvas || !els.stage) return;
  const rect = els.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
}

function drawSceneToDisplay(scene) {
  if (!els.canvas || !els.stage) return;
  resizeDisplayCanvas();
  const rect = els.stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ctx = els.canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!scene) return;
  const fit = getFitScale(rect.width, rect.height);
  const scale = fit * state.view.zoom;
  const width = scene.width * scale;
  const height = scene.height * scale;
  const x = (rect.width - width) / 2 + state.view.panX;
  const y = (rect.height - height) / 2 + state.view.panY;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scene, x, y, width, height);
}

function renderDisplay() {
  if (!state.previewSource) {
    drawSceneToDisplay(null);
    return;
  }
  if (state.compare || !state.alpha) {
    drawSceneToDisplay(state.previewSource);
    return;
  }
  const width = state.previewSource.width;
  const height = state.previewSource.height;
  if (!state.sceneCanvas || state.sceneCanvas.width !== width || state.sceneCanvas.height !== height) {
    state.sceneCanvas = createCanvas(width, height);
  }
  const ctx = state.sceneCanvas.getContext('2d');
  renderScene(ctx, width, height, {
    source: state.cleanSource || state.previewSource,
    cutout: state.cutout,
    bounds: state.bounds || { x: 0, y: 0, w: 1, h: 1 },
    background: state.background,
    studio: state.studio
  });
  drawSceneToDisplay(state.sceneCanvas);
}

function makeMaskCanvas(alpha, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = alpha[i];
  }
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}

function canvasFromRGBA(rgba, width, height) {
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
}

function makeCutout(source, mask) {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, source.width, source.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, source.width, source.height);
  return canvas;
}

function refreshCutout() {
  if (!state.cutout || !state.cleanSource || !state.maskCanvas) return;
  const ctx = state.cutout.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, state.cutout.width, state.cutout.height);
  ctx.drawImage(state.cleanSource, 0, 0, state.cutout.width, state.cutout.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(state.maskCanvas, 0, 0, state.cutout.width, state.cutout.height);
  ctx.globalCompositeOperation = 'source-over';
}

function applyAlpha(alpha, { push = false } = {}) {
  state.alpha = new Uint8Array(alpha);
  if (!state.previewSource) return;
  const width = state.previewSource.width;
  const height = state.previewSource.height;
  state.maskCanvas = makeMaskCanvas(state.alpha, width, height);
  if (!state.cutout) state.cutout = createCanvas(width, height);
  refreshCutout();
  state.bounds = computeBounds(state.alpha, width, height);
  if (push) pushHistory();
  updateHistoryButtons();
  scheduleRender();
}

function pushHistory() {
  if (!state.alpha) return;
  const snapshot = state.alpha.slice();
  const last = state.history[state.historyIndex];
  if (last && last.length === snapshot.length && last.every((value, index) => value === snapshot[index])) {
    return;
  }
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > 16) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  applyAlpha(state.history[state.historyIndex]);
  setStatus('Undid the last refinement.');
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex += 1;
  applyAlpha(state.history[state.historyIndex]);
  setStatus('Redid the refinement.');
}

function resetMask() {
  if (!state.aiAlpha) return;
  state.alpha = state.aiAlpha.slice();
  state.maskCanvas = makeMaskCanvas(state.alpha, state.previewSource.width, state.previewSource.height);
  refreshCutout();
  state.bounds = computeBounds(state.alpha, state.previewSource.width, state.previewSource.height);
  pushHistory();
  scheduleRender();
  setStatus('Reset the edge refinements to the AI result.');
}

function updateImageMeta() {
  if (!els.fileMeta) return;
  if (!state.previewSource) {
    els.fileMeta.textContent = 'No image selected.';
    return;
  }
  els.fileMeta.textContent =
    state.originalWidth +
    ' × ' +
    state.originalHeight +
    ' px · ' +
    formatMegapixels(state.originalWidth, state.originalHeight) +
    (state.sourceFull && state.sourceFull.width !== state.originalWidth
      ? ' · processed at ' + state.sourceFull.width + ' × ' + state.sourceFull.height
      : '');
}

async function decodeFile(file) {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const allowed =
    /^image\/(jpeg|png|webp|avif)$/.test(type) ||
    /\.(jpe?g|png|webp|avif)$/.test(name);
  if (!allowed) {
    throw new Error('Choose a JPG, PNG, WebP or AVIF image. Other formats are not supported.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This image is ' + formatBytes(file.size) + '. The limit is 25 MB.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    try {
      bitmap = await createImageBitmap(file);
    } catch (fallbackError) {
      throw new Error('The browser could not decode this image. Try a JPG, PNG or WebP file.');
    }
  }
  return bitmap;
}

async function loadFile(file) {
  clearError();
  if (state.processing) cancelProcessing();
  setStatus('Reading image…');
  try {
    const bitmap = await decodeFile(file);
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const pixelScale = Math.sqrt(MAX_EXPORT_PIXELS / (originalWidth * originalHeight));
    const fullScale = Math.min(
      1,
      MAX_EXPORT_DIM / Math.max(originalWidth, originalHeight),
      Number.isFinite(pixelScale) ? pixelScale : 1
    );
    const fullWidth = Math.max(1, Math.round(originalWidth * fullScale));
    const fullHeight = Math.max(1, Math.round(originalHeight * fullScale));
    const full = createCanvas(fullWidth, fullHeight);
    full.getContext('2d').drawImage(bitmap, 0, 0, fullWidth, fullHeight);
    if (bitmap.close) bitmap.close();

    const previewScale = Math.min(1, PREVIEW_MAX / Math.max(fullWidth, fullHeight));
    const previewWidth = Math.max(1, Math.round(fullWidth * previewScale));
    const previewHeight = Math.max(1, Math.round(fullHeight * previewScale));
    const preview = createCanvas(previewWidth, previewHeight);
    preview.getContext('2d').drawImage(full, 0, 0, previewWidth, previewHeight);

    state.fileName = file.name || 'image';
    state.originalWidth = originalWidth;
    state.originalHeight = originalHeight;
    state.sourceFull = full;
    state.previewSource = preview;
    state.cleanSource = null;
    state.alpha = null;
    state.aiAlpha = null;
    state.maskCanvas = null;
    state.cutout = null;
    state.bounds = null;
    state.sceneCanvas = null;
    state.history = [];
    state.historyIndex = -1;
    state.status = 'ready';
    state.compare = false;
    state.view = { zoom: 1, panX: 0, panY: 0 };
    state.background.type = 'transparent';
    els.bgRadios.forEach((radio) => {
      radio.checked = radio.value === 'transparent';
    });
    updateBackgroundPanels();
    if (els.empty) els.empty.hidden = true;
    if (els.process) els.process.disabled = false;
    if (els.newImage) els.newImage.hidden = false;
    if (els.download) els.download.disabled = true;
    els.controls.forEach((control) => {
      control.hidden = true;
    });
    if (els.compare) {
      els.compare.disabled = true;
      els.compare.setAttribute('aria-pressed', 'false');
      els.compareBadge.hidden = true;
    }
    updateImageMeta();
    if (els.subtitle) {
      els.subtitle.textContent =
        previewWidth + ' × ' + previewHeight + ' px working preview · ' +
        originalWidth + ' × ' + originalHeight + ' px original';
    }
    if (els.stageHint) els.stageHint.textContent = 'Choose Remove background to run the local AI model.';
    resetView();
    renderDisplay();
    setStatus('Image loaded. Choose Remove background to start.');
  } catch (error) {
    showError(error.message || 'The image could not be loaded.');
    setStatus('Image could not be loaded.');
  }
}

function preprocess(source) {
  const canvas = createCanvas(MODEL_SIZE, MODEL_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const data = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const pixelCount = MODEL_SIZE * MODEL_SIZE;
  const tensor = new Float32Array(3 * pixelCount);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    tensor[i] = (data[offset] / 255 - mean[0]) / std[0];
    tensor[pixelCount + i] = (data[offset + 1] / 255 - mean[1]) / std[1];
    tensor[pixelCount * 2 + i] = (data[offset + 2] / 255 - mean[2]) / std[2];
  }
  return tensor;
}

function ensureWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => handleWorkerMessage(event.data || {});
  worker.onerror = (event) => {
    state.worker = null;
    showProcessing(false);
    state.model = 'error';
    state.modelVerified = false;
    updateModelNote();
    showError(event.message || 'The local AI worker stopped unexpectedly. Try again.');
    setStatus('Processing failed.');
  };
  state.worker = worker;
  return worker;
}

function handleWorkerMessage(message) {
  if (message.type === 'model-progress') {
    state.model = 'loading';
    updateModelNote();
    const percent = message.total ? message.loaded / message.total : 0;
    setProgress(4 + percent * 56, 'Downloading the AI model… ' + Math.round(percent * 100) + '% (' + formatBytes(message.loaded) + ' of ' + formatBytes(message.total) + ')');
    return;
  }
  if (message.type === 'model-stage') {
    if (message.stage === 'initialise') {
      setProgress(64, 'Preparing the AI model on this device…');
    } else if (message.stage === 'fallback') {
      setProgress(64, 'WebGPU was unavailable. Switching to the CPU fallback…');
    } else if (message.stage === 'download') {
      state.model = 'loading';
      state.modelVerified = false;
      updateModelNote();
      setProgress(6, 'Downloading the AI model…');
    } else if (message.stage === 'verify') {
      setProgress(61, 'Verifying the AI model SHA-256 integrity…');
    } else if (message.stage === 'retry') {
      setProgress(5, 'The cached model was incomplete. Retrying the download…');
    }
    return;
  }
  if (message.type === 'model-ready') {
    state.model = 'ready';
    state.modelVerified = message.verified === true;
    state.backend = message.backend || 'wasm';
    updateModelNote();
    setProgress(70, 'AI model ready. Running segmentation…');
    return;
  }
  if (message.type === 'processing') {
    if (message.stage === 'inference') {
      setIndeterminate('Running AI segmentation…');
      setStatus('Running AI segmentation on this device…');
    } else if (message.stage === 'refine') {
      setIndeterminate('Refining hair, edges and colour spill…');
      setStatus('Refining edges…');
    }
    return;
  }
  if (message.type === 'result') {
    if (message.id !== state.jobId) return;
    applyResult(message);
    return;
  }
  if (message.type === 'error') {
    if (message.id && message.id !== state.jobId) return;
    state.model = 'error';
    state.modelVerified = false;
    updateModelNote();
    showProcessing(false);
    showError(message.message || 'The AI model could not process this image.');
    setStatus('Processing failed.');
  }
}

function applyResult(message) {
  const width = message.width || state.previewSource.width;
  const height = message.height || state.previewSource.height;
  state.alpha = new Uint8Array(message.alpha);
  state.aiAlpha = state.alpha.slice();
  state.cleanSource = canvasFromRGBA(new Uint8ClampedArray(message.rgba), width, height);
  state.maskCanvas = makeMaskCanvas(state.alpha, width, height);
  state.cutout = createCanvas(width, height);
  refreshCutout();
  state.bounds = computeBounds(state.alpha, width, height);
  state.history = [state.alpha.slice()];
  state.historyIndex = 0;
  state.status = 'done';
  state.backend = message.backend || state.backend;
  updateHistoryButtons();
  showProcessing(false);
  setProgress(100, 'Background removed.');
  if (els.controls) els.controls.forEach((control) => { control.hidden = false; });
  if (els.compare) els.compare.disabled = false;
  if (els.download) els.download.disabled = false;
  if (els.newImage) els.newImage.hidden = false;
  updateBackgroundPanels();
  updateExportControls();
  if (els.stageHint) els.stageHint.textContent = 'Select a background, or choose Erase / Restore to refine the edges.';
  if (els.subtitle) {
    els.subtitle.textContent =
      Math.round((state.bounds.coverage || 0) * 100) + '% of the frame is foreground · ' +
      width + ' × ' + height + ' px working mask';
  }
  scheduleRender();
  setStatus('Background removed. Choose a background, refine the edges or download.');
}

function processImage() {
  if (!state.previewSource || state.processing) return;
  clearError();
  showProcessing(true);
  state.jobId += 1;
  const id = state.jobId;
  setProgress(2, 'Preparing the AI model…');
  setStatus('Preparing the local AI model…');
  const tensor = preprocess(state.previewSource);
  const ctx = state.previewSource.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, state.previewSource.width, state.previewSource.height);
  const worker = ensureWorker();
  worker.postMessage(
    {
      type: 'process',
      id,
      width: state.previewSource.width,
      height: state.previewSource.height,
      tensor: tensor.buffer,
      rgba: imageData.data.buffer
    },
    [tensor.buffer, imageData.data.buffer]
  );
}

function cancelProcessing() {
  if (!state.processing) return;
  state.jobId += 1;
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  showProcessing(false);
  setProgress(0, 'Processing cancelled.');
  setStatus('Processing cancelled. The image is unchanged.');
  if (state.alpha) {
    scheduleRender();
  }
}

async function exportImage() {
  if (!state.alpha || !state.sourceFull) return;
  const format = els.format.value;
  const quality = clamp(Number(els.quality.value) / 100, 0.1, 1);
  const width = state.sourceFull.width;
  const height = state.sourceFull.height;
  if (els.download) els.download.disabled = true;
  setStatus('Rendering the final image…');
  try {
    let source = state.sourceFull;
    if (
      state.cleanSource &&
      state.cleanSource.width === width &&
      state.cleanSource.height === height
    ) {
      source = state.cleanSource;
    }
    let mask = state.maskCanvas;
    if (!mask || mask.width !== width || mask.height !== height) {
      const scaled = createCanvas(width, height);
      const scaledCtx = scaled.getContext('2d');
      scaledCtx.imageSmoothingEnabled = true;
      scaledCtx.imageSmoothingQuality = 'high';
      scaledCtx.drawImage(state.maskCanvas, 0, 0, width, height);
      mask = scaled;
    }
    const cutout = createCanvas(width, height);
    const cutoutCtx = cutout.getContext('2d');
    cutoutCtx.drawImage(source, 0, 0, width, height);
    cutoutCtx.globalCompositeOperation = 'destination-in';
    cutoutCtx.drawImage(mask, 0, 0, width, height);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const background =
      format === 'image/jpeg' && state.background.type === 'transparent'
        ? { ...state.background, type: 'white' }
        : state.background;
    renderScene(ctx, width, height, {
      source,
      cutout,
      bounds: state.bounds || { x: 0, y: 0, w: 1, h: 1 },
      background,
      studio: state.studio
    });

    const blob = await safeCanvasBlob(canvas, format, format === 'image/png' ? undefined : quality);
    if (!blob) throw new Error('This browser could not encode the selected format.');
    const extension = format === 'image/png' ? 'png' : format === 'image/jpeg' ? 'jpg' : 'webp';
    const filename = baseName(state.fileName) + '-no-background.' + extension;
    downloadBlob(blob, filename);
    if (els.exportMeta) {
      els.exportMeta.textContent = filename + ' · ' + width + ' × ' + height + ' px · ' + formatBytes(blob.size);
    }
    setStatus('Downloaded ' + filename + ' (' + width + ' × ' + height + ').');
    if (format === 'image/jpeg' && state.background.type === 'transparent') {
      if (els.exportNote) els.exportNote.textContent = 'JPG cannot store transparency, so the transparent areas were exported on white.';
    }
  } catch (error) {
    showError(error.message || 'The image could not be exported.');
  } finally {
    if (els.download) els.download.disabled = !state.alpha;
  }
}

function eventToImage(event) {
  if (!state.previewSource) return null;
  const rect = els.canvas.getBoundingClientRect();
  const cssX = event.clientX - rect.left;
  const cssY = event.clientY - rect.top;
  const fit = getFitScale(rect.width, rect.height);
  const scale = fit * state.view.zoom;
  const width = state.previewSource.width * scale;
  const height = state.previewSource.height * scale;
  const ox = (rect.width - width) / 2 + state.view.panX;
  const oy = (rect.height - height) / 2 + state.view.panY;
  return {
    x: (cssX - ox) / scale,
    y: (cssY - oy) / scale,
    cssX,
    cssY,
    scale
  };
}

function stamp(point) {
  if (!state.maskCanvas) return;
  const ctx = state.maskCanvas.getContext('2d');
  const radius = Math.max(1, state.brush.size / 2);
  const hardness = clamp(1 - state.brush.softness / 100, 0, 0.95);
  const inner = Math.max(0, radius * hardness);
  const gradient = ctx.createRadialGradient(point.x, point.y, inner, point.x, point.y, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.globalCompositeOperation = state.tool === 'erase' ? 'destination-out' : 'source-over';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function strokeTo(point, previous) {
  if (!previous) {
    stamp(point);
    return;
  }
  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  const step = Math.max(1, (state.brush.size / 2) * 0.2);
  if (distance < 0.5) {
    stamp(point);
    return;
  }
  const count = Math.ceil(distance / step);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    stamp({
      x: previous.x + (point.x - previous.x) * t,
      y: previous.y + (point.y - previous.y) * t
    });
  }
}

function onPointerDown(event) {
  if (!els.canvas) return;
  if (event.pointerType === 'touch') {
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size === 2) {
      state.stroke = null;
      const points = Array.from(state.pointers.values());
      state.pinch = {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        midX: (points[0].x + points[1].x) / 2,
        midY: (points[0].y + points[1].y) / 2
      };
      els.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (state.pointers.size > 2) return;
  }

  if (state.spaceDown || state.tool === 'pan' || event.button === 1) {
    state.pan = { x: event.clientX, y: event.clientY };
    els.canvas.setPointerCapture(event.pointerId);
    els.canvas.classList.add('is-panning');
    event.preventDefault();
    return;
  }

  if ((state.tool === 'erase' || state.tool === 'restore') && state.alpha) {
    const point = eventToImage(event);
    if (!point) return;
    state.stroke = { last: point, changed: false };
    els.canvas.setPointerCapture(event.pointerId);
    stamp(point);
    state.stroke.changed = true;
    refreshCutout();
    scheduleRender();
    event.preventDefault();
  }
}

function onPointerMove(event) {
  if (event.pointerType === 'touch' && state.pointers.has(event.pointerId)) {
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pinch && state.pointers.size === 2) {
      const points = Array.from(state.pointers.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      const factor = state.pinch.distance > 0 ? distance / state.pinch.distance : 1;
      const rect = els.canvas.getBoundingClientRect();
      state.view.panX += midX - state.pinch.midX;
      state.view.panY += midY - state.pinch.midY;
      zoomAt(factor, midX - rect.left, midY - rect.top);
      state.pinch = { distance, midX, midY };
      event.preventDefault();
      return;
    }
  }

  if (state.pan) {
    const dx = event.clientX - state.pan.x;
    const dy = event.clientY - state.pan.y;
    state.pan = { x: event.clientX, y: event.clientY };
    state.view.panX += dx;
    state.view.panY += dy;
    scheduleRender();
    event.preventDefault();
    return;
  }

  if (state.stroke) {
    const point = eventToImage(event);
    if (!point) return;
    strokeTo(point, state.stroke.last);
    state.stroke.last = point;
    state.stroke.changed = true;
    refreshCutout();
    scheduleRender();
    event.preventDefault();
  }
}

function readMaskAlpha() {
  if (!state.maskCanvas || !state.previewSource) return null;
  const width = state.previewSource.width;
  const height = state.previewSource.height;
  const ctx = state.maskCanvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}

function endPointer(event) {
  if (event.pointerType === 'touch') {
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.pinch = null;
  }
  if (state.pan) {
    state.pan = null;
    if (els.canvas) els.canvas.classList.remove('is-panning');
  }
  if (state.stroke) {
    const changed = state.stroke.changed;
    state.stroke = null;
    if (changed && state.previewSource) {
      const alpha = readMaskAlpha();
      if (alpha) state.alpha = alpha;
      state.bounds = computeBounds(
        state.alpha,
        state.previewSource.width,
        state.previewSource.height
      );
      pushHistory();
      setStatus('Edge refinement applied.');
    }
  }
}

function zoomAt(factor, cssX, cssY) {
  const oldZoom = state.view.zoom;
  const newZoom = clamp(oldZoom * factor, 0.2, 8);
  if (newZoom === oldZoom || !state.previewSource || !els.stage) return;
  const rect = els.stage.getBoundingClientRect();
  const fit = getFitScale(rect.width, rect.height);
  const imageWidth = state.previewSource.width;
  const imageHeight = state.previewSource.height;
  const oldScale = fit * oldZoom;
  const newScale = fit * newZoom;
  const oldOffsetX = (rect.width - imageWidth * oldScale) / 2 + state.view.panX;
  const oldOffsetY = (rect.height - imageHeight * oldScale) / 2 + state.view.panY;
  const imageX = (cssX - oldOffsetX) / oldScale;
  const imageY = (cssY - oldOffsetY) / oldScale;
  state.view.panX = cssX - imageX * newScale - (rect.width - imageWidth * newScale) / 2;
  state.view.panY = cssY - imageY * newScale - (rect.height - imageHeight * newScale) / 2;
  state.view.zoom = newZoom;
  if (els.zoomLabel) els.zoomLabel.textContent = Math.round(newZoom * 100) + '%';
  scheduleRender();
}

function loadBackgroundImage(file) {
  if (!file) return;
  if (!/^image\//.test(file.type || '')) {
    showError('Choose an image file for the background.');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError('This background is ' + formatBytes(file.size) + '. The limit is 25 MB.');
    return;
  }
  createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch(() => createImageBitmap(file))
    .then((bitmap) => {
      state.background.image = bitmap;
      state.background.type = 'image';
      els.bgRadios.forEach((radio) => {
        radio.checked = radio.value === 'image';
      });
      if (els.bgImageMeta) {
        els.bgImageMeta.textContent = file.name + ' · ' + bitmap.width + ' × ' + bitmap.height + ' px';
      }
      updateBackgroundPanels();
      scheduleRender();
      setStatus('Background image loaded.');
    })
    .catch(() => showError('The background image could not be decoded.'));
}

function bindEvents() {
  els.browse.forEach((button) => {
    button.addEventListener('click', () => els.fileInput && els.fileInput.click());
  });
  if (els.fileInput) {
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (file) loadFile(file);
      els.fileInput.value = '';
    });
  }
  if (els.newImage) {
    els.newImage.addEventListener('click', () => els.fileInput && els.fileInput.click());
  }
  if (els.process) els.process.addEventListener('click', processImage);
  if (els.cancel) els.cancel.addEventListener('click', cancelProcessing);
  if (els.compare) {
    els.compare.addEventListener('click', () => {
      if (!state.alpha) return;
      state.compare = !state.compare;
      els.compare.setAttribute('aria-pressed', state.compare ? 'true' : 'false');
      if (els.compareBadge) els.compareBadge.hidden = !state.compare;
      scheduleRender();
    });
  }
  $$('[data-zoom-in]').forEach((button) => {
    button.addEventListener('click', () => {
      const rect = els.stage.getBoundingClientRect();
      zoomAt(1.25, rect.width / 2, rect.height / 2);
    });
  });
  $$('[data-zoom-out]').forEach((button) => {
    button.addEventListener('click', () => {
      const rect = els.stage.getBoundingClientRect();
      zoomAt(0.8, rect.width / 2, rect.height / 2);
    });
  });
  $$('[data-zoom-fit]').forEach((button) => button.addEventListener('click', resetView));
  els.toolButtons.forEach((button) => {
    button.addEventListener('click', () => setTool(button.getAttribute('data-tool')));
  });
  els.bgRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.background.type = radio.value;
      updateBackgroundPanels();
      scheduleRender();
    });
  });
  if (els.color) {
    els.color.addEventListener('input', () => {
      state.background.color = els.color.value;
      if (els.colorHex) els.colorHex.value = els.color.value;
      scheduleRender();
    });
  }
  if (els.colorHex) {
    els.colorHex.addEventListener('input', () => {
      const value = els.colorHex.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        state.background.color = value;
        if (els.color) els.color.value = value;
        scheduleRender();
      }
    });
  }
  if (els.gradientFrom) {
    els.gradientFrom.addEventListener('input', () => {
      state.background.gradient.from = els.gradientFrom.value;
      scheduleRender();
    });
  }
  if (els.gradientTo) {
    els.gradientTo.addEventListener('input', () => {
      state.background.gradient.to = els.gradientTo.value;
      scheduleRender();
    });
  }
  if (els.gradientAngle) {
    els.gradientAngle.addEventListener('input', () => {
      state.background.gradient.angle = Number(els.gradientAngle.value);
      if (els.gradientAngleValue) els.gradientAngleValue.textContent = els.gradientAngle.value + '°';
      scheduleRender();
    });
  }
  if (els.bgImageInput) {
    els.bgImageInput.addEventListener('change', () => {
      const file = els.bgImageInput.files && els.bgImageInput.files[0];
      if (file) loadBackgroundImage(file);
      els.bgImageInput.value = '';
    });
  }
  if (els.blur) {
    els.blur.addEventListener('input', () => {
      state.background.blur = Number(els.blur.value);
      if (els.blurValue) els.blurValue.textContent = els.blur.value;
      scheduleRender();
    });
  }
  if (els.depth) {
    els.depth.addEventListener('input', () => {
      state.background.depth = Number(els.depth.value);
      if (els.depthValue) els.depthValue.textContent = els.depth.value;
      scheduleRender();
    });
  }
  const studioBindings = [
    ['shadowOpacity', els.shadowOpacity, els.shadowOpacityValue, '%'],
    ['shadowBlur', els.shadowBlur, els.shadowBlurValue, ''],
    ['shadowDirection', els.shadowDirection, els.shadowDirectionValue, '°'],
    ['shadowOffset', els.shadowOffset, els.shadowOffsetValue, ''],
    ['shadowFade', els.shadowFade, els.shadowFadeValue, ''],
    ['reflection', els.reflection, els.reflectionValue, '%'],
    ['reflectionFade', els.reflectionFade, els.reflectionFadeValue, '']
  ];
  studioBindings.forEach(([key, input, output, suffix]) => {
    if (!input) return;
    input.addEventListener('input', () => {
      state.studio[key] = Number(input.value);
      if (output) output.textContent = input.value + suffix;
      scheduleRender();
    });
  });
  if (els.studioReset) {
    els.studioReset.addEventListener('click', () => {
      state.studio = {
        shadowOpacity: 38,
        shadowBlur: 34,
        shadowDirection: 90,
        shadowOffset: 14,
        shadowFade: 55,
        reflection: 16,
        reflectionFade: 62
      };
      $$('[data-studio-input]').forEach((input) => {
        const key = input.getAttribute('data-studio-input');
        if (key && key in state.studio) input.value = state.studio[key];
      });
      if (els.shadowOpacityValue) els.shadowOpacityValue.textContent = state.studio.shadowOpacity + '%';
      if (els.shadowBlurValue) els.shadowBlurValue.textContent = state.studio.shadowBlur;
      if (els.shadowDirectionValue) els.shadowDirectionValue.textContent = state.studio.shadowDirection + '°';
      if (els.shadowOffsetValue) els.shadowOffsetValue.textContent = state.studio.shadowOffset;
      if (els.shadowFadeValue) els.shadowFadeValue.textContent = state.studio.shadowFade;
      if (els.reflectionValue) els.reflectionValue.textContent = state.studio.reflection + '%';
      if (els.reflectionFadeValue) els.reflectionFadeValue.textContent = state.studio.reflectionFade;
      scheduleRender();
    });
  }
  if (els.brushSize) {
    els.brushSize.addEventListener('input', () => {
      state.brush.size = Number(els.brushSize.value);
      if (els.brushSizeValue) els.brushSizeValue.textContent = els.brushSize.value + ' px';
    });
  }
  if (els.brushSoftness) {
    els.brushSoftness.addEventListener('input', () => {
      state.brush.softness = Number(els.brushSoftness.value);
      if (els.brushSoftnessValue) els.brushSoftnessValue.textContent = els.brushSoftness.value + '%';
    });
  }
  if (els.undo) els.undo.addEventListener('click', undo);
  if (els.redo) els.redo.addEventListener('click', redo);
  if (els.resetMask) els.resetMask.addEventListener('click', resetMask);
  if (els.format) {
    els.format.addEventListener('change', updateExportControls);
  }
  if (els.quality) {
    els.quality.addEventListener('input', updateExportControls);
  }
  if (els.download) els.download.addEventListener('click', exportImage);
  if (els.errorClose) {
    els.errorClose.addEventListener('click', clearError);
  }

  if (els.canvas) {
    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', endPointer);
    els.canvas.addEventListener('pointercancel', endPointer);
    els.canvas.addEventListener('pointerleave', (event) => {
      if (state.pan) return;
      if (event.pointerType === 'touch') return;
    });
    els.canvas.addEventListener('wheel', (event) => {
      if (!state.previewSource) return;
      event.preventDefault();
      const rect = els.canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    els.canvas.addEventListener('dblclick', resetView);
    els.canvas.addEventListener('keydown', (event) => {
      if (!state.previewSource) return;
      const rect = els.stage.getBoundingClientRect();
      const step = event.shiftKey ? 48 : 16;
      if (event.key === 'ArrowLeft') {
        state.view.panX -= step;
      } else if (event.key === 'ArrowRight') {
        state.view.panX += step;
      } else if (event.key === 'ArrowUp') {
        state.view.panY -= step;
      } else if (event.key === 'ArrowDown') {
        state.view.panY += step;
      } else if (event.key === '+' || event.key === '=') {
        zoomAt(1.2, rect.width / 2, rect.height / 2);
      } else if (event.key === '-') {
        zoomAt(1 / 1.2, rect.width / 2, rect.height / 2);
      } else if (event.key === '0') {
        resetView();
      } else {
        return;
      }
      event.preventDefault();
      scheduleRender();
    });
  }

  if (els.stage) {
    ['dragenter', 'dragover'].forEach((type) => {
      els.stage.addEventListener(type, (event) => {
        event.preventDefault();
        els.stage.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      els.stage.addEventListener(type, (event) => {
        event.preventDefault();
        els.stage.classList.remove('is-dragging');
      });
    });
    els.stage.addEventListener('drop', (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  document.addEventListener('paste', (event) => {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          loadFile(file);
          break;
        }
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    const editing = /INPUT|TEXTAREA|SELECT/.test(tag) || event.target.isContentEditable;
    if (event.code === 'Space' && !editing) {
      state.spaceDown = true;
      if (els.canvas) els.canvas.classList.add('is-grab');
    }
    if ((event.metaKey || event.ctrlKey) && !editing && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if ((event.metaKey || event.ctrlKey) && !editing && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      state.spaceDown = false;
      if (els.canvas) els.canvas.classList.remove('is-grab');
    }
  });

  const menuButton = $('.menu-button');
  const primaryLinks = $('#primary-links');
  if (menuButton && primaryLinks) {
    menuButton.addEventListener('click', () => {
      const open = primaryLinks.classList.toggle('is-open');
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && primaryLinks.classList.contains('is-open')) {
        primaryLinks.classList.remove('is-open');
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.focus();
      }
    });
  }

  const resizeObserver = new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resizeDisplayCanvas();
      renderDisplay();
    });
  });
  if (els.stage) resizeObserver.observe(els.stage);
  window.addEventListener('beforeunload', () => {
    if (state.worker) state.worker.terminate();
  });
}

function installTestHooks() {
  if (!isTestHost()) return;
  window.__bgrTest = {
    loadSynthetic(options = {}) {
      const width = Math.max(80, Math.round(options.width || 420));
      const height = Math.max(60, Math.round(options.height || 300));
      const source = createCanvas(width, height);
      const ctx = source.getContext('2d');
      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, '#dbeafe');
      background.addColorStop(1, '#93c5fd');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      const radius = Math.min(width, height) * 0.32;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.ellipse(0, radius * 0.55, radius * 0.72, radius * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(0, -radius * 0.62, radius * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fdba74';
      ctx.lineWidth = Math.max(1, radius * 0.018);
      for (let i = 0; i < 26; i++) {
        const angle = -Math.PI * 0.95 + (i / 25) * Math.PI * 0.9;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * radius * 0.4, -radius * 0.62 + Math.sin(angle) * radius * 0.34);
        ctx.lineTo(Math.cos(angle) * radius * 0.72, -radius * 0.62 + Math.sin(angle) * radius * 0.66);
        ctx.stroke();
      }
      ctx.restore();

      const mask = createCanvas(width, height);
      const mctx = mask.getContext('2d');
      mctx.save();
      mctx.translate(width / 2, height / 2);
      mctx.fillStyle = '#ffffff';
      mctx.beginPath();
      mctx.ellipse(0, radius * 0.55, radius * 0.72, radius * 0.9, 0, 0, Math.PI * 2);
      mctx.fill();
      mctx.beginPath();
      mctx.arc(0, -radius * 0.62, radius * 0.48, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = 'rgba(255,255,255,0.7)';
      mctx.lineWidth = Math.max(1, radius * 0.018);
      for (let i = 0; i < 26; i++) {
        const angle = -Math.PI * 0.95 + (i / 25) * Math.PI * 0.9;
        mctx.beginPath();
        mctx.moveTo(Math.cos(angle) * radius * 0.4, -radius * 0.62 + Math.sin(angle) * radius * 0.34);
        mctx.lineTo(Math.cos(angle) * radius * 0.72, -radius * 0.62 + Math.sin(angle) * radius * 0.66);
        mctx.stroke();
      }
      mctx.restore();
      const blurred = createCanvas(width, height);
      const bctx = blurred.getContext('2d');
      bctx.filter = 'blur(0.8px)';
      bctx.drawImage(mask, 0, 0);
      const maskData = bctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = maskData[i * 4 + 3];

      state.fileName = 'synthetic-portrait.png';
      state.originalWidth = width;
      state.originalHeight = height;
      state.sourceFull = source;
      state.previewSource = source;
      state.cleanSource = source;
      state.alpha = alpha;
      state.aiAlpha = alpha.slice();
      state.maskCanvas = makeMaskCanvas(alpha, width, height);
      state.cutout = createCanvas(width, height);
      refreshCutout();
      state.bounds = computeBounds(alpha, width, height);
      state.history = [alpha.slice()];
      state.historyIndex = 0;
      state.status = 'done';
      state.compare = false;
      state.view = { zoom: 1, panX: 0, panY: 0 };
      state.background.type = 'transparent';
      state.background.image = null;
      els.bgRadios.forEach((radio) => {
        radio.checked = radio.value === 'transparent';
      });
      updateBackgroundPanels();
      updateHistoryButtons();
      updateExportControls();
      if (els.empty) els.empty.hidden = true;
      if (els.process) els.process.disabled = false;
      if (els.newImage) els.newImage.hidden = false;
      if (els.compare) els.compare.disabled = false;
      if (els.download) els.download.disabled = false;
      els.controls.forEach((control) => {
        control.hidden = false;
      });
      if (els.subtitle) els.subtitle.textContent = width + ' × ' + height + ' px working preview · synthetic test image';
      if (els.stageHint) els.stageHint.textContent = 'Select a background, or choose Erase / Restore to refine the edges.';
      updateImageMeta();
      resetView();
      renderDisplay();
      setStatus('Synthetic test image ready.');
      return true;
    },
    async loadFileFromUrl(url, name = 'test.png') {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fixture could not be fetched.');
      const blob = await response.blob();
      await loadFile(new File([blob], name, { type: blob.type || 'image/png' }));
      return true;
    },
    setBackground(type, options = {}) {
      state.background.type = type;
      if (options.color) state.background.color = options.color;
      if (options.gradient) Object.assign(state.background.gradient, options.gradient);
      if (typeof options.blur === 'number') state.background.blur = options.blur;
      if (typeof options.depth === 'number') state.background.depth = options.depth;
      els.bgRadios.forEach((radio) => {
        radio.checked = radio.value === type;
      });
      updateBackgroundPanels();
      renderDisplay();
      return state.background.type;
    },
    setStudio(values = {}) {
      Object.assign(state.studio, values);
      renderDisplay();
      return { ...state.studio };
    },
    setBrush(size, softness) {
      if (typeof size === 'number') state.brush.size = size;
      if (typeof softness === 'number') state.brush.softness = softness;
      return { ...state.brush };
    },
    setTool(tool) {
      setTool(tool);
      return state.tool;
    },
    applyBrush(tool, points) {
      if (!state.maskCanvas || !state.previewSource) return false;
      setTool(tool);
      const width = state.previewSource.width;
      const height = state.previewSource.height;
      points.forEach((point) => {
        stamp({ x: point[0] * width, y: point[1] * height });
      });
      const alpha = readMaskAlpha();
      if (alpha) state.alpha = alpha;
      state.maskCanvas = makeMaskCanvas(state.alpha, width, height);
      refreshCutout();
      state.bounds = computeBounds(state.alpha, width, height);
      pushHistory();
      scheduleRender();
      renderDisplay();
      return true;
    },
    applySyntheticMask() {
      if (!state.previewSource) return false;
      const width = state.previewSource.width;
      const height = state.previewSource.height;
      const mask = createCanvas(width, height);
      const maskCtx = mask.getContext('2d');
      maskCtx.fillStyle = '#ffffff';
      maskCtx.beginPath();
      maskCtx.ellipse(
        width / 2,
        height / 2,
        width * 0.3,
        height * 0.34,
        0,
        0,
        Math.PI * 2
      );
      maskCtx.fill();
      const maskData = maskCtx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = maskData[i * 4 + 3];
      state.cleanSource = state.previewSource;
      state.alpha = alpha;
      state.aiAlpha = alpha.slice();
      state.maskCanvas = makeMaskCanvas(alpha, width, height);
      state.cutout = createCanvas(width, height);
      refreshCutout();
      state.bounds = computeBounds(alpha, width, height);
      state.history = [alpha.slice()];
      state.historyIndex = 0;
      state.status = 'done';
      els.controls.forEach((control) => {
        control.hidden = false;
      });
      updateHistoryButtons();
      updateExportControls();
      updateBackgroundPanels();
      renderDisplay();
      return true;
    },
    getState() {
      return {
        status: state.status,
        width: state.originalWidth,
        height: state.originalHeight,
        previewWidth: state.previewSource ? state.previewSource.width : 0,
        previewHeight: state.previewSource ? state.previewSource.height : 0,
        coverage: state.bounds ? state.bounds.coverage : 0,
        bounds: state.bounds ? { ...state.bounds } : null,
        background: state.background.type,
        zoom: state.view.zoom,
        tool: state.tool,
        historyIndex: state.historyIndex,
        historyLength: state.history.length,
        hasAlpha: !!state.alpha,
        backend: state.backend,
        model: state.model,
        modelVerified: state.modelVerified,
        processing: state.processing,
        compare: state.compare,
        studio: { ...state.studio },
        brush: { ...state.brush }
      };
    },
    alphaAt(x, y) {
      if (!state.maskCanvas) return null;
      const ctx = state.maskCanvas.getContext('2d');
      const data = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return data[3];
    },
    exportCanvas(format = 'image/png') {
      if (!state.alpha) return null;
      const width = state.sourceFull.width;
      const height = state.sourceFull.height;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      renderScene(ctx, width, height, {
        source: state.sourceFull,
        cutout: state.cutout,
        bounds: state.bounds,
        background: state.background,
        studio: state.studio
      });
      return canvas.toDataURL(format);
    }
  };
}

function init() {
  bindEvents();
  updateModelNote();
  updateBackgroundPanels();
  updateExportControls();
  updateHistoryButtons();
  setTool('pan');
  setStatus('Choose an image to begin.');
  resizeDisplayCanvas();
  renderDisplay();
  installTestHooks();
}

init();
