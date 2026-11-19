/* Image Editor — history (undo/redo), layers list and document metadata */

function resizeCanvases() {
  canvas.width = state.width;
  canvas.height = state.height;
  overlay.width = state.width;
  overlay.height = state.height;
  updateCanvasSizeLabel();
}

function updateCanvasSizeLabel() {
  const el = $('canvasSize');
  if (el) el.textContent = state.loaded ? state.width + ' × ' + state.height + ' px' : '';
}

function updateDocMeta() {
  $('docName').textContent = state.loaded ? state.name : 'No image loaded';
  $('docMeta').textContent = state.loaded
    ? state.width + ' × ' + state.height + ' px · ' + state.layers.length + (state.layers.length === 1 ? ' layer' : ' layers')
    : 'Open or drop a picture to begin';
}

/* ------------------------------ history ------------------------------ */
function snapshot() {
  return {
    width: state.width,
    height: state.height,
    base: state.base,
    adjustments: Object.assign({}, state.adjustments),
    layers: deepClone(state.layers),
    selectedId: state.selectedId
  };
}

function commit() {
  state.history = state.history.slice(0, state.hIndex + 1);
  state.history.push(snapshot());
  if (state.history.length > 40) state.history.shift();
  state.hIndex = state.history.length - 1;
  updateHistoryButtons();
  updateDocMeta();
}

function restore(snap) {
  state.width = snap.width;
  state.height = snap.height;
  state.base = snap.base;
  state.adjustments = Object.assign({}, snap.adjustments);
  state.layers = deepClone(snap.layers);
  state.selectedId = snap.selectedId;
  resizeCanvases();
  syncAdjustUI();
  buildLayers();
  updateSelectionUI();
  render();
  updateDocMeta();
}

function undo() {
  if (state.hIndex > 0) { state.hIndex--; restore(state.history[state.hIndex]); updateHistoryButtons(); }
}
function redo() {
  if (state.hIndex < state.history.length - 1) { state.hIndex++; restore(state.history[state.hIndex]); updateHistoryButtons(); }
}
function updateHistoryButtons() {
  $('btnUndo').disabled = state.hIndex <= 0;
  $('btnRedo').disabled = state.hIndex >= state.history.length - 1;
}

/* ------------------------------ layers ------------------------------ */
function selectedLayer() {
  return state.layers.find((l) => l.id === state.selectedId) || null;
}

function eyeIcon(on) {
  return on
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18"/><path d="M10.6 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.4 4.3M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 4.3-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
}

function buildLayers() {
  const list = $('layerList');
  if (!list) return;
  list.innerHTML = '';
  $('layerCount').textContent = state.layers.length;
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i];
    const el = document.createElement('div');
    el.className = 'layer-item' + (l.id === state.selectedId ? ' active' : '') + (l.visible === false ? ' off' : '');
    el.innerHTML = '<button class="lyr-eye" title="Show or hide">' + eyeIcon(l.visible !== false) + '</button>' +
      '<span class="lyr-name"></span><span class="lyr-tag">' + l.type + '</span>';
    el.querySelector('.lyr-name').textContent = l.name || l.type;
    el.querySelector('.lyr-eye').addEventListener('click', (e) => {
      e.stopPropagation();
      l.visible = l.visible === false;
      buildLayers(); render(); commit();
    });
    el.addEventListener('click', () => {
      state.selectedId = l.id;
      buildLayers(); updateSelectionUI(); render();
    });
    list.appendChild(el);
  }
  if (state.loaded) {
    const base = document.createElement('div');
    base.className = 'layer-item base';
    base.innerHTML = '<span class="lyr-eye">' + eyeIcon(true) + '</span><span class="lyr-name">Background</span><span class="lyr-tag">image</span>';
    list.appendChild(base);
  }
  updateLayerButtons();
}

function updateLayerButtons() {
  const l = selectedLayer();
  const i = l ? state.layers.indexOf(l) : -1;
  $('layerUp').disabled = !l || i === state.layers.length - 1;
  $('layerDown').disabled = !l || i <= 0;
  $('layerDel').disabled = !l;
}

function removeLayer(id, doCommit) {
  const i = state.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  state.layers.splice(i, 1);
  if (state.selectedId === id) state.selectedId = null;
  buildLayers();
  updateSelectionUI();
  render();
  if (doCommit !== false) commit();
}
