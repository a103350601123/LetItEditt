/* LetitEdit global mobile preview workspace.
 * Progressive enhancement only: existing tool markup and runtimes stay in
 * charge of editing. This module marks preview/control panels, adds a mobile
 * Preview/Controls switch, zoom/fit/fullscreen actions and a pinned action
 * bar that forwards clicks to the original buttons. */
(function (global) {
  'use strict';

  var M = { roots: [], mode: 'preview', zoom: 1 };
  var fullscreenRoot = null;
  var viewportTimer = null;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  var ROOT_SELECTORS = [
    '.image-workspace', '.video-workspace', '.engine-workspace',
    'body.tool-page .workspace', 'body.tool-page .panel-grid',
    '.workspace', '.editor-shell', '[data-workspace]', '#editor', '.editor'
  ].join(',');

  var GRID_SELECTORS = [
    '.image-grid', '.video-grid', '.engine-grid', '.panel-grid',
    '.workspace-grid', '.editor-grid', '.stage-wrap'
  ].join(',');

  var PREVIEW_SELECTORS = [
    '.thumbnail-preview-frame', '.image-preview-frame', '.video-preview-frame',
    '.preview-pane', '.preview-pad', '.canvas-frame', '.stage',
    '.workspace-panel-output', '.engine-output', '.image-output', '.video-output',
    '.output-box', '.diff-output', '[data-preview]'
  ];

  var MEDIA_SELECTORS = [
    'canvas', 'video', 'img', 'svg', '.output-box', '.diff-output',
    '.preview-pad', '.cv-page', '.pdf-page', '.resume-page', '.document-page'
  ].join(',');

  function findPreview(root) {
    for (var i = 0; i < PREVIEW_SELECTORS.length; i++) {
      var node = one(PREVIEW_SELECTORS[i], root);
      if (node && root.contains(node)) return node;
    }
    return null;
  }

  function findGrid(root, preview) {
    var grids = all(GRID_SELECTORS, root);
    for (var i = 0; i < grids.length; i++) {
      if (!grids[i].contains(preview)) continue;
      if (all(':scope > *', grids[i]).length > 1) return grids[i];
    }
    if (root.contains(preview) && all(':scope > *', root).length > 1) return root;
    return null;
  }

  function ownerChild(grid, node) {
    var current = node;
    while (current && current.parentElement && current.parentElement !== grid) {
      current = current.parentElement;
    }
    return current && current.parentElement === grid ? current : node;
  }

  function buildToolbar(root) {
    var bar = document.createElement('div');
    bar.className = 'mw-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Mobile preview and editing controls');
    bar.innerHTML =
      '<div class="mw-mode-switch" role="group" aria-label="Workspace view">' +
        '<button type="button" class="mw-mode is-active" data-mw-mode="preview" aria-pressed="true">Preview</button>' +
        '<button type="button" class="mw-mode" data-mw-mode="controls" aria-pressed="false">Controls</button>' +
      '</div>' +
      '<div class="mw-view-tools" role="group" aria-label="Preview zoom">' +
        '<button type="button" class="mw-icon-btn" data-mw-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>' +
        '<span class="mw-zoom" aria-live="polite">100%</span>' +
        '<button type="button" class="mw-icon-btn" data-mw-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>' +
        '<button type="button" class="mw-text-btn" data-mw-action="fit" aria-label="Fit preview to screen">Fit</button>' +
        '<button type="button" class="mw-text-btn" data-mw-action="fullscreen" aria-label="Expand preview to fullscreen" aria-pressed="false">Expand</button>' +
      '</div>';
    return bar;
  }

  var ACTION_WORDS = [
    ['undo', '↶ Undo'], ['redo', '↷ Redo'], ['reset', 'Reset'], ['save', 'Save'],
    ['download', 'Download'], ['export', 'Export'], ['apply', 'Apply'],
    ['update', 'Update'], ['generate', 'Generate'], ['process', 'Process']
  ];

  function actionLabel(button, key) {
    var text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 18) return text;
    var found = ACTION_WORDS.filter(function (word) { return word[0] === key; })[0];
    return found ? found[1] : text.slice(0, 16);
  }

  function buildActionBar(root) {
    var candidates = all('button', root).filter(function (button) {
      if (button.closest('.mw-toolbar') || button.closest('.mw-action-bar')) return false;
      var label = button.id + ' ' + (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '');
      return ACTION_WORDS.some(function (word) { return new RegExp(word[0], 'i').test(label); });
    }).slice(0, 8);
    if (!candidates.length) return null;

    var bar = document.createElement('div');
    bar.className = 'mw-action-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Essential actions');
    candidates.forEach(function (original, index) {
      var key = ACTION_WORDS.filter(function (word) {
        var label = original.id + ' ' + (original.getAttribute('aria-label') || '') + ' ' + (original.textContent || '');
        return new RegExp(word[0], 'i').test(label);
      })[0];
      if (!original.id) original.id = 'mw-action-source-' + index;
      var proxy = document.createElement('button');
      proxy.type = 'button';
      proxy.className = 'mw-action-btn';
      proxy.setAttribute('data-mw-proxy-for', original.id);
      proxy.textContent = actionLabel(original, key ? key[0] : '');
      proxy.disabled = Boolean(original.disabled);
      proxy.addEventListener('click', function () {
        if (!original.isConnected || original.disabled) return;
        original.click();
      });
      if (global.MutationObserver) {
        var observer = new MutationObserver(function () { proxy.disabled = Boolean(original.disabled); });
        observer.observe(original, { attributes: true, attributeFilter: ['disabled'] });
      }
      bar.appendChild(proxy);
    });
    return bar;
  }

  function zoomTargets(preview) {
    var targets = all('.mw-zoom-target', preview);
    if (!targets.length) targets = all(MEDIA_SELECTORS, preview);
    return targets.length ? targets : [preview];
  }

  function applyZoom(root, value) {
    var preview = root._mwPreview;
    if (!preview) return;
    var zoom = clamp(Number(value) || 1, 0.5, 3);
    root._mwZoom = zoom;
    M.zoom = zoom;
    var editor = global.ThumbnailEditor;
    var thumbnailPage = editor && typeof editor.setZoom === 'function'
      && (root.matches && root.matches('[data-image-engine="thumbnail-generator"]')
        || root.querySelector('[data-image-engine="thumbnail-generator"]'));
    if (thumbnailPage) {
      /* The thumbnail editor owns stage sizing and pointer coordinate mapping.
       * Delegating prevents a second CSS transform from doubling the zoom. */
      editor.setZoom(zoom);
    } else {
      zoomTargets(preview).forEach(function (target) {
        if (target._mwOriginalTransform == null) {
          target._mwOriginalTransform = target.style.transform || '';
        }
        if (global.CSS && CSS.supports && CSS.supports('zoom', '1')) {
          target.style.zoom = String(zoom);
          target.style.transform = target._mwOriginalTransform;
        } else {
          target.style.zoom = '';
          target.style.transform = 'scale(' + zoom + ')';
          target.style.transformOrigin = 'center top';
        }
      });
    }
    var label = one('.mw-zoom', root);
    if (label) label.textContent = Math.round(zoom * 100) + '%';
  }

  function setMode(mode, root) {
    var target = root || M.roots[0];
    if (!target) return;
    var next = mode === 'controls' ? 'controls' : 'preview';
    M.mode = next;
    target.setAttribute('data-mw-mode', next);
    all('.mw-mode', target).forEach(function (button) {
      var active = button.getAttribute('data-mw-mode') === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var status = one('[role="status"]', target);
    if (status && target._mwLastMode !== next) {
      status.textContent = next === 'preview'
        ? 'Preview view. Use Controls to edit this tool.'
        : 'Editing controls view. Use Preview to inspect the result.';
    }
    target._mwLastMode = next;
  }

  function exitFullscreen() {
    if (!fullscreenRoot) return;
    fullscreenRoot.classList.remove('mw-is-fullscreen');
    fullscreenRoot._mwPreview.classList.remove('mw-fullscreen');
    document.documentElement.classList.remove('mw-is-fullscreen');
    document.body.classList.remove('mw-no-scroll');
    all('[data-mw-action="fullscreen"]', fullscreenRoot).forEach(function (button) {
      button.setAttribute('aria-pressed', 'false');
      button.textContent = 'Expand';
      button.setAttribute('aria-label', 'Expand preview to fullscreen');
    });
    fullscreenRoot = null;
  }

  function enterFullscreen(root) {
    if (fullscreenRoot === root) { exitFullscreen(); return; }
    if (fullscreenRoot) exitFullscreen();
    fullscreenRoot = root;
    root.classList.add('mw-is-fullscreen');
    root._mwPreview.classList.add('mw-fullscreen');
    document.documentElement.classList.add('mw-is-fullscreen');
    document.body.classList.add('mw-no-scroll');
    all('[data-mw-action="fullscreen"]', root).forEach(function (button) {
      button.setAttribute('aria-pressed', 'true');
      button.textContent = 'Exit';
      button.setAttribute('aria-label', 'Exit fullscreen preview');
    });
    applyZoom(root, 1);
    setMode('preview', root);
  }

  function handleToolbarClick(root, event) {
    var button = event.target.closest('button');
    if (!button) return;
    var mode = button.getAttribute('data-mw-mode');
    if (mode) {
      setMode(mode, root);
      return;
    }
    var action = button.getAttribute('data-mw-action');
    if (action === 'zoom-in') applyZoom(root, (root._mwZoom || 1) + 0.25);
    else if (action === 'zoom-out') applyZoom(root, (root._mwZoom || 1) - 0.25);
    else if (action === 'fit') applyZoom(root, 1);
    else if (action === 'fullscreen') enterFullscreen(root);
  }

  function updateViewport() {
    var visual = global.visualViewport;
    var height = visual ? visual.height : global.innerHeight;
    var offset = visual ? Math.max(0, global.innerHeight - visual.height - visual.offsetTop) : 0;
    var root = document.documentElement;
    root.style.setProperty('--mw-vh', Math.round(height) + 'px');
    root.style.setProperty('--mw-keyboard-offset', Math.round(offset) + 'px');
    root.classList.toggle('mw-keyboard-open', offset > 110 || (visual && visual.height < global.innerHeight * 0.72));
    if (fullscreenRoot && fullscreenRoot._mwPreview) {
      fullscreenRoot._mwPreview.style.maxHeight = Math.round(height - 96) + 'px';
    }
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(function () {
      M.roots.forEach(function (item) {
        if (item._mwPreview) item._mwPreview.dispatchEvent(new Event('mw:resize'));
      });
    }, 80);
  }

  function isTextWorkspace(preview) {
    /* Pure text tools need their input visible on arrival; media workspaces
     * benefit from a large preview-first surface. Both keep the same switch. */
    return Boolean(preview && preview.matches
      && preview.matches('.engine-output, .workspace-panel-output, .output-box, .diff-output'));
  }

  function enhance(root) {
    if (!root || root.classList.contains('mw-root')) return;
    var preview = findPreview(root);
    if (!preview) return;
    var grid = findGrid(root, preview);
    if (!grid) return;
    var previewPanel = ownerChild(grid, preview);
    var controls = all(':scope > *', grid).filter(function (child) {
      return child !== previewPanel && !child.classList.contains('mw-toolbar') && !child.classList.contains('mw-action-bar');
    });
    if (!controls.length) return;

    root.classList.add('mw-root');
    previewPanel.classList.add('mw-preview');
    controls.forEach(function (control) { control.classList.add('mw-controls'); });
    root._mwPreview = previewPanel;
    root._mwPreviewSurface = preview;

    /* A few generated tools place option groups directly inside the workspace
     * instead of the control panel. Move them into the scrolling controls so
     * they remain usable without pushing the workspace past the viewport. */
    var strayControls = all(':scope > .opt-group, :scope > .opt-set, :scope > .field, :scope > .control-row', root);
    strayControls.forEach(function (node) {
      if (grid === root || grid.contains(node)) return;
      if (controls[0] && controls[0] !== node) controls[0].appendChild(node);
    });

    var toolbar = buildToolbar(root);
    root.insertBefore(toolbar, root.firstChild);
    toolbar.addEventListener('click', function (event) { handleToolbarClick(root, event); });

    var actionBar = buildActionBar(root);
    if (actionBar) root.insertBefore(actionBar, root.firstChild);

    all(MEDIA_SELECTORS, previewPanel).forEach(function (media) {
      if (media.tagName === 'CANVAS' || media.tagName === 'VIDEO' || media.classList.contains('draw-pad')) {
        media.classList.add('mw-touch-surface');
      }
    });
    setMode(isTextWorkspace(preview) ? 'controls' : 'preview', root);
    applyZoom(root, 1);
    M.roots.push(root);
  }

  function refresh() {
    var candidates = all(ROOT_SELECTORS);
    var seen = [];
    candidates.forEach(function (root) {
      if (seen.indexOf(root) !== -1) return;
      if (M.roots.some(function (active) { return active !== root && active.contains(root); })) return;
      seen.push(root);
      enhance(root);
    });
  }

  M.refresh = refresh;
  M.setMode = setMode;
  M.setZoom = function (value, root) { applyZoom(root || M.roots[0], value); };
  M.fullscreen = function (root) { enterFullscreen(root || M.roots[0]); };

  ready(function () {
    refresh();
    updateViewport();
    global.addEventListener('resize', updateViewport, { passive: true });
    global.addEventListener('orientationchange', updateViewport, { passive: true });
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', updateViewport, { passive: true });
      global.visualViewport.addEventListener('scroll', updateViewport, { passive: true });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && fullscreenRoot) {
        exitFullscreen();
        event.preventDefault();
      }
    });
    if (global.MutationObserver) {
      var observer = new MutationObserver(function () { refresh(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });

  global.MobileWorkspace = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
