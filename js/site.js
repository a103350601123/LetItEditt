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
      var matches = items.filter(function (item) {
        return (item.name + ' ' + item.description + ' ' + (item.aliases || []).join(' ')).toLocaleLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
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
