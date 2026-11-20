/* LetitEdit site behaviour: mobile navigation, year and functional search. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });

    var menuButton = document.querySelector('.menu-button');
    var navLinks = document.querySelector('.nav-links');
    if (menuButton && navLinks) {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.addEventListener('click', function () {
        var open = navLinks.classList.toggle('is-open');
        menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        menuButton.textContent = open ? 'Close' : 'Menu';
      });
      navLinks.addEventListener('click', function (event) {
        if (event.target.closest('a')) {
          navLinks.classList.remove('is-open');
          menuButton.setAttribute('aria-expanded', 'false');
          menuButton.textContent = 'Menu';
        }
      });
    }

    var navSearch = document.getElementById('nav-search');
    var searchStrip = document.getElementById('search-strip');
    if (navSearch && searchStrip) {
      navSearch.addEventListener('click', function () {
        searchStrip.scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchStrip.classList.add('is-open');
        var field = document.getElementById('site-search');
        if (field) field.focus();
      });
    }

    var input = document.getElementById('site-search');
    var results = document.getElementById('search-results');
    var items = Array.isArray(window.LETITEDIT_SEARCH) ? window.LETITEDIT_SEARCH : [];
    if (!input || !results) return;

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    }

    function render(query) {
      var q = query.trim().toLocaleLowerCase();
      if (!q) {
        results.innerHTML = '';
        results.hidden = true;
        return;
      }
      function score(item) {
        var name = String(item.name || '').toLocaleLowerCase();
        var keywords = (item.keywords || []).concat(item.aliases || []).join(' ').toLocaleLowerCase();
        var description = String(item.description || '').toLocaleLowerCase();
        if (name === q) return 0;
        if (name.indexOf(q) === 0) return 1;
        if (keywords.indexOf(q) !== -1) return 2;
        if (name.indexOf(q) !== -1) return 3;
        if (description.indexOf(q) !== -1) return 4;
        return 99;
      }
      var matches = items.map(function (item) { return { item: item, score: score(item) }; })
        .filter(function (entry) { return entry.score < 99; })
        .sort(function (a, b) { return a.score - b.score || a.item.name.localeCompare(b.item.name); })
        .map(function (entry) { return entry.item; })
        .slice(0, 8);
      if (!matches.length) {
        results.innerHTML = '<div class="search-empty">No tools found. Try “json”, “base64” or “slug”.</div>';
        results.hidden = false;
        return;
      }
      results.innerHTML = matches.map(function (item) {
        return '<a class="search-result" href="' + escapeHtml(item.url) + '">' +
          '<span aria-hidden="true">' + escapeHtml(item.icon || '🔧') + '</span> ' + escapeHtml(item.name) +
          '<small>' + escapeHtml(item.category || 'Writing & Text Tools') + '</small></a>';
      }).join('');
      results.hidden = false;
    }

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('focus', function () { if (input.value.trim()) render(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        results.hidden = true;
        input.blur();
      }
      if (event.key === 'Enter') {
        var first = results.querySelector('.search-result');
        if (first && !results.hidden) {
          event.preventDefault();
          window.location.href = first.getAttribute('href');
        }
      }
    });
    document.addEventListener('click', function (event) {
      if (!results.contains(event.target) && event.target !== input) results.hidden = true;
    });
  });
})();
