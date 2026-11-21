/* LetitEdit global mobile preview workspace.
 * Progressive enhancement only: existing tool markup and runtimes stay in
 * charge of editing. On phones this adds a focused, Tuxpi-inspired app shell:
 * one viewport-high workspace, compact scrolling toolbar, large preview and a
 * controls drawer. Desktop/tablet layouts keep the original behaviour. */
(function (global) {
  'use strict';

  var M = { roots: [], mode: 'preview', zoom: 1 };
  var fullscreenRoot = null;
  var viewportTimer = null;
  var shellRoot = null;
  var shellDismissed = false;
  var actionCounter = 0;
  var titleHome = null;
  var menuHome = null;
  var navHome = null;

  var APP_QUERY = global.matchMedia ? global.matchMedia('(max-width: 680px)') : null;

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
    var rootChildren = all(':scope > *', root);
    if (root.contains(preview) && rootChildren.length > 1) return root;
    return null;
  }

  function ownerChild(grid, node) {
    var current = node;
    while (current && current.parentElement && current.parentElement !== grid) {
      current = current.parentElement;
    }
    return current && current.parentElement === grid ? current : node;
  }

  var ACTION_WORDS = [
    ['upload', 'Upload'], ['import', 'Import'], ['open', 'Open'],
    ['sample', 'Sample'], ['save', 'Save'], ['download', 'Download'],
    ['export', 'Export'], ['generate', 'Generate'], ['process', 'Process'],
    ['apply', 'Apply'], ['update', 'Update'], ['format', 'Format'],
    ['validate', 'Validate'], ['copy', 'Copy'], ['clear', 'Clear'],
    ['reset', 'Reset'], ['undo', 'Undo'], ['redo', 'Redo']
  ];

  var ACTION_PRIORITY = {
    upload: 0, import: 0, open: 1, sample: 1, save: 1, download: 1,
    export: 1, generate: 1, process: 1, apply: 1, update: 1,
    format: 1, validate: 1, copy: 2, clear: 3, reset: 4, undo: 5, redo: 6
  };

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function actionKey(element) {
    var label = cleanText((element.id || '') + ' ' + (element.getAttribute('aria-label') || '') + ' ' +
      (element.textContent || '') + ' ' + (element.title || ''));
    var found = ACTION_WORDS.filter(function (word) {
      return new RegExp(word[0], 'i').test(label);
    });
    return found.length ? found[0][0] : '';
  }

  function actionLabel(element, key) {
    if (element.tagName === 'INPUT' && element.type === 'file') {
      var labelText = element.labels && element.labels.length ? cleanText(element.labels[0].textContent) : '';
      return labelText && labelText.length <= 16 ? labelText : 'Upload';
    }
    var text = cleanText(element.textContent || element.value || element.getAttribute('aria-label'));
    if (text && text.length <= 18) return text;
    var found = ACTION_WORDS.filter(function (word) { return word[0] === key; })[0];
    return found ? found[1] : text.slice(0, 16) || 'Action';
  }

  function collectActions(root) {
    var candidates = [];

    all('input[type="file"]', root).forEach(function (input) {
      if (input.closest('.mw-toolbar') || input.closest('.mw-action-bar')) return;
      if (input.disabled) return;
      candidates.push({ element: input, key: 'upload', label: actionLabel(input, 'upload') });
    });

    all('button', root).forEach(function (button) {
      if (button.closest('.mw-toolbar') || button.closest('.mw-action-bar')) return;
      if (button.disabled) return;
      var key = actionKey(button);
      if (!key) return;
      candidates.push({ element: button, key: key, label: actionLabel(button, key) });
    });

    candidates.sort(function (a, b) {
      return (ACTION_PRIORITY[a.key] || 9) - (ACTION_PRIORITY[b.key] || 9);
    });

    var seen = [];
    return candidates.filter(function (candidate) {
      if (seen.indexOf(candidate.element) !== -1) return false;
      seen.push(candidate.element);
      return true;
    }).slice(0, 8);
  }

  function createActionProxy(candidate, extraClass) {
    var original = candidate.element;
    if (!original.id) original.id = 'mw-action-source-' + (++actionCounter);

    var proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.className = 'mw-action-btn' + (extraClass ? ' ' + extraClass : '');
    proxy.setAttribute('data-mw-proxy-for', original.id);
    proxy.textContent = candidate.label;
    proxy.disabled = Boolean(original.disabled);
    proxy.addEventListener('click', function () {
      if (!original.isConnected || original.disabled) return;
      original.click();
    });
    if (global.MutationObserver) {
      var observer = new MutationObserver(function () { proxy.disabled = Boolean(original.disabled); });
      observer.observe(original, { attributes: true, attributeFilter: ['disabled'] });
    }
    return proxy;
  }

  function buildToolbar(root, candidates) {
    var bar = document.createElement('div');
    bar.className = 'mw-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Mobile preview and editing controls');
    bar.innerHTML =
      '<div class="mw-mode-switch" role="group" aria-label="Workspace view">' +
        '<button type="button" class="mw-mode is-active" data-mw-mode="preview" aria-pressed="true">Preview</button>' +
        '<button type="button" class="mw-mode" data-mw-mode="controls" aria-pressed="false">Controls</button>' +
      '</div>' +
      '<div class="mw-quick-actions" role="group" aria-label="Quick actions"></div>' +
      '<div class="mw-view-tools" role="group" aria-label="Preview zoom">' +
        '<button type="button" class="mw-icon-btn" data-mw-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>' +
        '<span class="mw-zoom" aria-live="polite">100%</span>' +
        '<button type="button" class="mw-icon-btn" data-mw-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>' +
        '<button type="button" class="mw-text-btn" data-mw-action="fit" aria-label="Fit preview to screen">Fit</button>' +
        '<button type="button" class="mw-icon-btn" data-mw-action="settings" aria-label="Open controls drawer" title="Settings">⚙</button>' +
        '<button type="button" class="mw-text-btn" data-mw-action="fullscreen" aria-label="Expand preview to fullscreen" aria-pressed="false">Expand</button>' +
        '<button type="button" class="mw-text-btn mw-exit-btn" data-mw-action="exit" aria-label="Exit focused tool view">Done</button>' +
      '</div>';

    var quick = one('.mw-quick-actions', bar);
    candidates.slice(0, 3).forEach(function (candidate) {
      quick.appendChild(createActionProxy(candidate, 'mw-quick-btn'));
    });
    return bar;
  }

  function buildActionBar(candidates) {
    if (!candidates.length) return null;
    var bar = document.createElement('div');
    bar.className = 'mw-action-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Essential actions');
    candidates.forEach(function (candidate, index) {
      bar.appendChild(createActionProxy(candidate, index === 0 ? 'mw-primary-action' : ''));
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
    else if (action === 'settings') setMode(root.getAttribute('data-mw-mode') === 'controls' ? 'preview' : 'controls', root);
    else if (action === 'exit') dismissAppShell();
    else if (action === 'fullscreen') enterFullscreen(root);
  }

  function isVisibleElement(element) {
    if (!element || element.closest('[hidden]')) return false;
    var style = global.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  var IGNORED_HIDDEN = { SCRIPT: true, STYLE: true, META: true, LINK: true, TEMPLATE: true, NOSCRIPT: true };

  function hideNonToolSiblings(root) {
    var node = root;
    while (node && node !== document.body) {
      var parent = node.parentElement;
      if (!parent) break;
      all(':scope > *', parent).forEach(function (child) {
        if (child === node || child.contains(root) || IGNORED_HIDDEN[child.tagName]) return;
        child.classList.add('mw-app-hidden');
      });
      node = parent;
    }
  }

  function adoptTitle(root) {
    var heading = one('h1');
    var bar = one('.mw-toolbar', root);
    if (!heading || !bar || heading.closest('.mw-toolbar')) return;
    titleHome = { parent: heading.parentNode, next: heading.nextSibling };
    var title = document.createElement('div');
    title.className = 'mw-app-title';
    title.appendChild(heading);
    var menu = one('.mw-app-menu', bar);
    if (menu && menu.parentNode === bar) bar.insertBefore(title, menu.nextSibling);
    else bar.insertBefore(title, bar.firstChild);
  }

  function restoreTitle() {
    if (!titleHome) return;
    var heading = one('.mw-app-title h1');
    if (heading) titleHome.parent.insertBefore(heading, titleHome.next);
    all('.mw-app-title').forEach(function (node) { node.remove(); });
    titleHome = null;
  }

  /* The focused shell hides the site header visually. Adopt the existing
   * navigation controls instead of cloning them so js/site.js listeners keep
   * working and the menu stays reachable inside the app toolbar. */
  function adoptNavigation(root) {
    var menu = one('.menu-button');
    var bar = one('.mw-toolbar', root);
    if (menu && bar && !menu.closest('.mw-toolbar')) {
      menuHome = { parent: menu.parentNode, next: menu.nextSibling };
      menu.classList.add('mw-app-menu');
      bar.insertBefore(menu, bar.firstChild);
    }

    var nav = one('.nav-links');
    if (nav && root && !nav.closest('.mw-app-root')) {
      navHome = { parent: nav.parentNode, next: nav.nextSibling };
      nav.classList.add('mw-nav-overlay');
      root.appendChild(nav);
    }
  }

  function restoreNavigation() {
    if (menuHome) {
      var menu = one('.mw-app-menu');
      if (menu) {
        menu.classList.remove('mw-app-menu');
        menuHome.parent.insertBefore(menu, menuHome.next);
      }
      menuHome = null;
    }

    if (navHome) {
      var nav = one('.mw-nav-overlay');
      if (nav) {
        nav.classList.remove('mw-nav-overlay', 'is-open');
        navHome.parent.insertBefore(nav, navHome.next);
      }
      var menuButton = one('.menu-button');
      if (menuButton) {
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.textContent = 'Menu';
      }
      var categoryPanel = one('#nav-category-list');
      if (categoryPanel) categoryPanel.hidden = true;
      var categoryToggle = one('.nav-category-toggle');
      if (categoryToggle) categoryToggle.setAttribute('aria-expanded', 'false');
      navHome = null;
    }
  }

  function addDrawerBackdrop(root) {
    var backdrop = one('.mw-drawer-backdrop', root);
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'mw-drawer-backdrop';
      backdrop.setAttribute('aria-label', 'Close controls drawer');
      root.appendChild(backdrop);
    }
    backdrop.addEventListener('click', function () { setMode('preview', root); });
  }

  function activateAppShell(root) {
    if (!root) return;
    if (shellRoot === root && document.documentElement.classList.contains('mw-app')) return;
    if (fullscreenRoot) exitFullscreen();
    deactivateAppShell(false);
    shellRoot = root;
    root.classList.add('mw-app-root');
    document.documentElement.classList.add('mw-app');
    document.body.classList.add('mw-app-active');
    adoptNavigation(root);
    adoptTitle(root);
    hideNonToolSiblings(root);
    addDrawerBackdrop(root);
  }

  function deactivateAppShell(restoreScroll) {
    restoreTitle();
    restoreNavigation();
    all('.mw-app-hidden').forEach(function (element) { element.classList.remove('mw-app-hidden'); });
    all('.mw-app-root').forEach(function (element) { element.classList.remove('mw-app-root'); });
    document.documentElement.classList.remove('mw-app');
    document.body.classList.remove('mw-app-active');
    shellRoot = null;
    if (restoreScroll !== false && M.roots.forEach) {
      M.roots.forEach(function (root) { setMode('preview', root); });
    }
  }

  function dismissAppShell() {
    shellDismissed = true;
    deactivateAppShell();
  }

  function updateAppShell() {
    if (!APP_QUERY) return;
    if (!APP_QUERY.matches) {
      if (document.documentElement.classList.contains('mw-app')) deactivateAppShell();
      return;
    }
    if (shellDismissed) return;
    var visible = M.roots.filter(isVisibleElement);
    if (!visible.length) {
      if (document.documentElement.classList.contains('mw-app')) deactivateAppShell();
      return;
    }
    activateAppShell(visible[visible.length - 1]);
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

    var candidates = collectActions(root);
    var toolbar = buildToolbar(root, candidates);
    root.insertBefore(toolbar, root.firstChild);
    toolbar.addEventListener('click', function (event) { handleToolbarClick(root, event); });

    var actionBar = buildActionBar(candidates);
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
    updateAppShell();
  }

  M.refresh = refresh;
  M.setMode = setMode;
  M.setZoom = function (value, root) { applyZoom(root || M.roots[0], value); };
  M.fullscreen = function (root) { enterFullscreen(root || M.roots[0]); };

  ready(function () {
    refresh();
    updateAppShell();
    updateViewport();
    global.addEventListener('resize', updateViewport, { passive: true });
    global.addEventListener('orientationchange', updateViewport, { passive: true });
    if (APP_QUERY && APP_QUERY.addEventListener) {
      APP_QUERY.addEventListener('change', function () {
        shellDismissed = false;
        refresh();
      });
    }
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', updateViewport, { passive: true });
      global.visualViewport.addEventListener('scroll', updateViewport, { passive: true });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && fullscreenRoot) {
        exitFullscreen();
        event.preventDefault();
      } else if (event.key === 'Escape' && document.documentElement.classList.contains('mw-app')) {
        dismissAppShell();
      }
    });
    if (global.MutationObserver) {
      var observer = new MutationObserver(function () { refresh(); });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden']
      });
    }
  });

  global.MobileWorkspace = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
