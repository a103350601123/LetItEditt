/* LetitEdit site behaviour: mobile navigation, year and one shared search. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  ready(function () {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });

    var menuButton = document.querySelector('.menu-button');
    var navLinks = document.querySelector('.nav-links');
    function closeMenu() {
      if (!menuButton || !navLinks) return;
      navLinks.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.textContent = 'Menu';
    }
    if (menuButton && navLinks) {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.addEventListener('click', function () {
        var open = navLinks.classList.toggle('is-open');
        menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        menuButton.textContent = open ? 'Close' : 'Menu';
      });
      navLinks.addEventListener('click', function (event) {
        if (event.target.closest('a')) closeMenu();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && navLinks.classList.contains('is-open')) {
          closeMenu();
          menuButton.focus();
        }
      });
    }

    var navSearch = document.getElementById('nav-search');
    var searchStrip = document.getElementById('search-strip');
    function setStripOpen(open) {
      if (searchStrip) searchStrip.classList.toggle('is-open', open);
      if (navSearch) navSearch.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (navSearch && searchStrip) {
      navSearch.addEventListener('click', function () {
        setStripOpen(true);
        searchStrip.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
        var field = document.getElementById('site-search');
        if (field) field.focus();
      });
    }

    var inputs = Array.prototype.slice.call(document.querySelectorAll('[data-search-input]'));
    var items = Array.isArray(window.LETITEDIT_SEARCH) ? window.LETITEDIT_SEARCH : [];
    if (!inputs.length) return;

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    }

    function resultsFor(input) {
      var id = input.getAttribute('aria-controls');
      return (id && document.getElementById(id)) ||
        input.parentElement.querySelector('[data-search-results]') ||
        document.querySelector('[data-search-results]');
    }

    function hideResults(input) {
      var results = resultsFor(input);
      if (!results) return;
      results.innerHTML = '';
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      var active = results.querySelector('.search-result.is-active');
      if (active) active.classList.remove('is-active');
    }

    function scoreItem(item, tokens) {
      var name = String(item.name || '').toLocaleLowerCase();
      var keywords = (item.keywords || []).concat(item.aliases || []).join(' ').toLocaleLowerCase();
      var description = String(item.description || '').toLocaleLowerCase();
      var category = String(item.category || '').toLocaleLowerCase();
      var total = 0;
      for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        var score = 99;
        if (name === token) score = 0;
        else if (name.indexOf(token) === 0) score = 1;
        else if (keywords.indexOf(token) !== -1) score = 2;
        else if (name.indexOf(token) !== -1) score = 3;
        else if (description.indexOf(token) !== -1) score = 4;
        else if (category.indexOf(token) !== -1) score = 5;
        if (score === 99) return 99;
        total += score;
      }
      return total;
    }

    function findMatches(query) {
      var tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      return items.map(function (item) { return { item: item, score: scoreItem(item, tokens) }; })
        .filter(function (entry) { return entry.score < 99; })
        .sort(function (a, b) { return a.score - b.score || a.item.name.localeCompare(b.item.name); })
        .map(function (entry) { return entry.item; })
        .slice(0, 8);
    }

    function updateUrl(query) {
      if (!window.history || !window.history.replaceState) return;
      try {
        var url = new URL(window.location.href);
        var q = query.trim();
        if (q) url.searchParams.set('q', q);
        else url.searchParams.delete('q');
        if (url.search !== window.location.search) {
          window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
      } catch (error) { /* search still works when URL rewriting is unavailable */ }
    }

    /* Only the field being used renders a result list. Other fields stay in
     * sync so entering a query on one search surface is reflected everywhere. */
    function render(query, activeInput) {
      var matches = findMatches(query);
      inputs.forEach(function (input) {
        if (input !== activeInput) {
          if (input.value !== query) input.value = query;
          hideResults(input);
        }
      });

      var results = resultsFor(activeInput);
      if (!results) return;
      if (!query.trim()) {
        hideResults(activeInput);
        setStripOpen(false);
        updateUrl(query);
        return;
      }

      setStripOpen(true);
      if (!matches.length) {
        results.innerHTML = '<div class="search-empty">No tools found. Try “json”, “base64” or “slug”.</div>';
        results.hidden = false;
        activeInput.setAttribute('aria-expanded', 'true');
        updateUrl(query);
        return;
      }
      results.innerHTML = matches.map(function (item) {
        return '<a class="search-result" role="option" aria-selected="false" href="' + escapeHtml(item.url) + '">' +
          '<span aria-hidden="true">' + escapeHtml(item.icon || '🔧') + '</span> ' + escapeHtml(item.name) +
          '<small>' + escapeHtml(item.category || 'Writing & Text Tools') + '</small></a>';
      }).join('');
      results.hidden = false;
      activeInput.setAttribute('aria-expanded', 'true');
      updateUrl(query);
    }

    function moveActive(input, step) {
      var results = resultsFor(input);
      if (!results || results.hidden) return;
      var options = Array.prototype.slice.call(results.querySelectorAll('.search-result'));
      if (!options.length) return;
      var current = options.findIndex(function (option) { return option.classList.contains('is-active'); });
      var next = current < 0 ? (step > 0 ? 0 : options.length - 1) : (current + step + options.length) % options.length;
      options.forEach(function (option, index) {
        var active = index === next;
        option.classList.toggle('is-active', active);
        option.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      options[next].scrollIntoView({ block: 'nearest' });
    }

    inputs.forEach(function (input) {
      input.addEventListener('input', function () { render(input.value, input); });
      input.addEventListener('focus', function () { if (input.value.trim()) render(input.value, input); });
      input.addEventListener('keydown', function (event) {
        var results = resultsFor(input);
        if (event.key === 'Escape') {
          hideResults(input);
          input.blur();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (results && !results.hidden) {
            event.preventDefault();
            moveActive(input, event.key === 'ArrowDown' ? 1 : -1);
          }
          return;
        }
        if (event.key === 'Enter') {
          var target = results && !results.hidden
            ? results.querySelector('.search-result.is-active') || results.querySelector('.search-result')
            : null;
          if (target) {
            event.preventDefault();
            window.location.href = target.getAttribute('href');
          }
        }
      });
    });

    document.addEventListener('click', function (event) {
      inputs.forEach(function (input) {
        var results = resultsFor(input);
        if (results && !results.hidden && !results.contains(event.target) && event.target !== input) hideResults(input);
      });
    });

    /* SearchAction declares /?q={search_term_string}; make that contract real. */
    var initialQuery = '';
    try { initialQuery = new URLSearchParams(window.location.search).get('q') || ''; } catch (error) { /* ignore */ }
    if (initialQuery.trim()) {
      inputs.forEach(function (input) { input.value = initialQuery; });
      setStripOpen(true);
      var preferred = inputs.filter(function (input) { return input.id === 'hero-search' && input.offsetParent !== null; })[0] || inputs[0];
      render(initialQuery, preferred);
    }
  });
})();
