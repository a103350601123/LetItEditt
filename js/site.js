/* LetitEdit site behaviour: mobile navigation, search, category filters,
 * current year and keyboard dismissal. No third-party libraries. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u064b-\u065f\u0670]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matchesQuery(terms, query) {
    var tokens = query.split(' ').filter(Boolean);
    return tokens.every(function (token) { return terms.indexOf(token) !== -1; });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

  function trapFocus(container, event) {
    var nodes = Array.prototype.filter.call(
      container.querySelectorAll(FOCUSABLE),
      function (element) { return element.offsetParent !== null; }
    );
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function anyOverlayOpen() {
    var menu = document.getElementById('mobile-menu');
    var search = document.getElementById('search-dialog');
    return (menu && !menu.hidden) || (search && !search.hidden);
  }

  function unlockBody() {
    if (!anyOverlayOpen()) document.body.classList.remove('overlay-open');
  }

  ready(function () {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });

    /* ---------- Mobile navigation drawer ---------- */
    var menu = document.getElementById('mobile-menu');
    var menuButton = document.querySelector('.menu-button');
    var menuReturnFocus = null;

    function openMenu() {
      if (!menu) return;
      menuReturnFocus = document.activeElement;
      menu.hidden = false;
      document.body.classList.add('overlay-open');
      if (menuButton) menuButton.setAttribute('aria-expanded', 'true');
      var closeButton = menu.querySelector('.icon-button');
      if (closeButton) closeButton.focus();
    }

    function closeMenu() {
      if (!menu || menu.hidden) return;
      menu.hidden = true;
      if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
      unlockBody();
      if (menuReturnFocus && document.contains(menuReturnFocus)) menuReturnFocus.focus();
      menuReturnFocus = null;
    }

    if (menuButton) {
      menuButton.addEventListener('click', function () {
        if (menu && menu.hidden) openMenu();
        else closeMenu();
      });
    }

    if (menu) {
      menu.addEventListener('click', function (event) {
        if (event.target.closest('[data-menu-close]')) {
          closeMenu();
          return;
        }
        if (event.target.closest('a[href]')) closeMenu();
      });
    }

    /* ---------- Search ---------- */
    var search = document.getElementById('search-dialog');
    var searchInput = document.getElementById('site-search');
    var resultsList = document.getElementById('search-results');
    var statusEl = search ? search.querySelector('.search-status') : null;
    var searchReturnFocus = null;
    var index = (window.LETITEDIT_SEARCH && window.LETITEDIT_SEARCH.categories) || [];
    var publishedTools = (window.LETITEDIT_SEARCH && window.LETITEDIT_SEARCH.tools) || [];
    var plannedTotal = index.reduce(function (total, item) {
      return total + (item.planned ? item.planned.length : 0);
    }, 0);
    var categoryTerms = index.map(function (item) {
      return normalize([item.name, item.short, item.group, item.description, (item.planned || []).join(' ')].join(' '));
    });

    function resultIcon(icon) {
      var span = document.createElement('span');
      span.className = 'search-result-icon';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = icon;
      return span;
    }

    function categoryResult(item) {
      var link = document.createElement('a');
      link.className = 'search-result search-result-link';
      link.href = item.path;
      var body = document.createElement('span');
      body.className = 'search-result-main';
      var title = document.createElement('span');
      title.className = 'search-result-title';
      title.textContent = item.name;
      var meta = document.createElement('span');
      meta.className = 'search-result-meta';
      meta.textContent = item.group + ' · Category';
      body.appendChild(title);
      body.appendChild(meta);
      link.appendChild(resultIcon(item.icon));
      link.appendChild(body);
      return link;
    }

    function plannedResult(tool, item) {
      var row = document.createElement('div');
      row.className = 'search-result is-planned';
      var body = document.createElement('span');
      body.className = 'search-result-main';
      var title = document.createElement('span');
      title.className = 'search-result-title';
      title.textContent = tool;
      var meta = document.createElement('span');
      meta.className = 'search-result-meta';
      var link = document.createElement('a');
      link.href = item.path;
      link.textContent = item.name;
      meta.appendChild(link);
      meta.appendChild(document.createTextNode(' · ' + item.group));
      body.appendChild(title);
      body.appendChild(meta);
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Planned';
      row.appendChild(resultIcon(item.icon));
      row.appendChild(body);
      row.appendChild(badge);
      return row;
    }

    function toolResult(tool) {
      var link = document.createElement('a');
      link.className = 'search-result search-result-link';
      link.href = tool.path;
      var body = document.createElement('span');
      body.className = 'search-result-main';
      var title = document.createElement('span');
      title.className = 'search-result-title';
      title.textContent = tool.name;
      var meta = document.createElement('span');
      meta.className = 'search-result-meta';
      meta.textContent = tool.category + ' · Tool';
      body.appendChild(title);
      body.appendChild(meta);
      link.appendChild(resultIcon(tool.icon || '🧰'));
      link.appendChild(body);
      return link;
    }

    function addHeading(text) {
      var heading = document.createElement('p');
      heading.className = 'search-group-title';
      heading.textContent = text;
      resultsList.appendChild(heading);
    }

    function emptyResults(query) {
      var empty = document.createElement('div');
      empty.className = 'search-empty';
      var title = document.createElement('p');
      title.className = 'search-empty-title';
      title.textContent = 'No matches for “' + query + '”';
      var copy = document.createElement('p');
      copy.textContent = 'Try a broader word such as photo, PDF or design, or browse the full category directory.';
      var link = document.createElement('a');
      link.className = 'btn btn-secondary btn-small';
      link.href = '/categories/';
      link.textContent = 'Browse all categories';
      empty.appendChild(title);
      empty.appendChild(copy);
      empty.appendChild(link);
      resultsList.appendChild(empty);
    }

    function runSearch(rawQuery) {
      if (!resultsList) return;
      var query = normalize(rawQuery);
      clear(resultsList);

      if (!query) {
        if (statusEl) statusEl.textContent = 'Search ' + index.length + ' categories and ' + plannedTotal + ' planned tools.';
        addHeading('Popular categories');
        index.slice(0, 6).forEach(function (item) {
          resultsList.appendChild(categoryResult(item));
        });
        return;
      }

      var categoryMatches = index.filter(function (item, position) {
        return matchesQuery(categoryTerms[position], query);
      });
      var toolMatches = publishedTools.filter(function (tool) {
        return matchesQuery(normalize([tool.name, tool.category, (tool.keywords || []).join(' ')].join(' ')), query);
      });
      var plannedMatches = [];
      index.forEach(function (item) {
        (item.planned || []).forEach(function (tool) {
          if (matchesQuery(normalize(tool), query)) plannedMatches.push({ tool: tool, item: item });
        });
      });

      var total = categoryMatches.length + toolMatches.length + plannedMatches.length;
      if (statusEl) {
        statusEl.textContent = total === 0
          ? 'No results for “' + rawQuery.trim() + '”'
          : total + (total === 1 ? ' result for “' : ' results for “') + rawQuery.trim() + '”';
      }

      if (total === 0) {
        emptyResults(rawQuery.trim());
        return;
      }

      if (toolMatches.length) {
        addHeading('Published tools');
        toolMatches.slice(0, 8).forEach(function (tool) {
          resultsList.appendChild(toolResult(tool));
        });
      }
      if (categoryMatches.length) {
        addHeading('Categories');
        categoryMatches.slice(0, 10).forEach(function (item) {
          resultsList.appendChild(categoryResult(item));
        });
      }
      if (plannedMatches.length) {
        addHeading('Planned tools');
        plannedMatches.slice(0, 15).forEach(function (match) {
          resultsList.appendChild(plannedResult(match.tool, match.item));
        });
      }
    }

    function openSearch(query) {
      if (!search) return;
      searchReturnFocus = document.activeElement;
      search.hidden = false;
      document.body.classList.add('overlay-open');
      if (searchInput) {
        searchInput.value = query || '';
        runSearch(searchInput.value);
        searchInput.focus();
        if (searchInput.value) searchInput.select();
      }
    }

    function closeSearch() {
      if (!search || search.hidden) return;
      search.hidden = true;
      unlockBody();
      if (searchReturnFocus && document.contains(searchReturnFocus)) searchReturnFocus.focus();
      searchReturnFocus = null;
    }

    document.querySelectorAll('[data-search-open]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeMenu();
        openSearch('');
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        runSearch(searchInput.value);
      });
      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') {
          var firstResult = resultsList ? resultsList.querySelector('a[href], button') : null;
          if (firstResult) {
            event.preventDefault();
            firstResult.focus();
          }
        }
      });
    }

    document.querySelectorAll('[data-search-form]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = form.querySelector('input[type="search"]');
        var value = input ? input.value : '';
        if (search && search.hidden) openSearch(value);
        else runSearch(value);
      });
    });

    if (search) {
      search.addEventListener('click', function (event) {
        if (event.target.closest('[data-search-close]')) closeSearch();
      });
    }

    /* ---------- Keyboard handling for overlays ---------- */
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (search && !search.hidden) {
          closeSearch();
          return;
        }
        if (menu && !menu.hidden) closeMenu();
        return;
      }
      if (event.key !== 'Tab') return;
      if (search && !search.hidden) trapFocus(search, event);
      else if (menu && !menu.hidden) trapFocus(menu, event);
    });

    if (window.matchMedia) {
      var desktop = window.matchMedia('(min-width: 721px)');
      var onChange = function (event) { if (event.matches) closeMenu(); };
      if (desktop.addEventListener) desktop.addEventListener('change', onChange);
      else if (desktop.addListener) desktop.addListener(onChange);
    }

    /* ---------- Category directory filter ---------- */
    var directoryInput = document.querySelector('[data-directory-search]');
    if (directoryInput) {
      var tiles = Array.prototype.slice.call(document.querySelectorAll('[data-category]'));
      var groupSections = Array.prototype.slice.call(document.querySelectorAll('[data-category-group]'));
      var directoryStatus = document.querySelector('[data-directory-status]');
      var directoryEmpty = document.querySelector('[data-directory-empty]');
      var totalCategories = tiles.length;

      var applyDirectoryFilter = function () {
        var query = normalize(directoryInput.value);
        var shown = 0;
        tiles.forEach(function (tile) {
          var terms = normalize(tile.getAttribute('data-terms') || tile.textContent);
          var match = !query || matchesQuery(terms, query);
          tile.hidden = !match;
          if (match) shown += 1;
        });
        groupSections.forEach(function (section) {
          section.hidden = !section.querySelector('[data-category]:not([hidden])');
        });
        if (directoryStatus) {
          directoryStatus.textContent = query
            ? 'Showing ' + shown + ' of ' + totalCategories + ' categories'
            : 'Showing all ' + totalCategories + ' categories';
        }
        if (directoryEmpty) directoryEmpty.hidden = shown !== 0;
      };

      directoryInput.addEventListener('input', applyDirectoryFilter);
      var directoryForm = directoryInput.closest('form');
      if (directoryForm) {
        directoryForm.addEventListener('submit', function (event) {
          event.preventDefault();
          applyDirectoryFilter();
        });
      }
    }

    /* ---------- Planned-tool filter on category pages ---------- */
    document.querySelectorAll('[data-filter-input]').forEach(function (input) {
      var scope = input.closest('.info-card') || document;
      var items = Array.prototype.slice.call(scope.querySelectorAll('[data-filter-item]'));
      var empty = scope.querySelector('[data-filter-empty]');
      input.addEventListener('input', function () {
        var query = normalize(input.value);
        var shown = 0;
        items.forEach(function (item) {
          var match = !query || matchesQuery(normalize(item.textContent), query);
          item.hidden = !match;
          if (match) shown += 1;
        });
        if (empty) empty.hidden = shown !== 0;
      });
    });
  });
})();
