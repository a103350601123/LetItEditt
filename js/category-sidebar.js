/* LetitEdit category sidebar and directory filtering.
 * Category counts are rendered by the build from the registry; this file only
 * filters what is already on the page and searches the generated tool index. */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  ready(function () {
    var data = window.LETITEDIT_SIDEBAR || { categories: [], tools: [], total: 0 };
    var filter = document.getElementById('sidebar-filter');
    var links = Array.prototype.slice.call(document.querySelectorAll('.sidebar-link'));
    var matches = document.getElementById('sidebar-matches');
    var sidebar = document.querySelector('.category-sidebar');
    var base = sidebar ? sidebar.getAttribute('data-base') || '' : '';

    function renderMatches(query) {
      if (!matches) return;
      if (!query) {
        matches.innerHTML = '';
        matches.hidden = true;
        return;
      }
      var found = data.tools.filter(function (tool) {
        return (tool.name + ' ' + (tool.description || '') + ' ' + (tool.keywords || []).join(' ')).toLocaleLowerCase().indexOf(query) !== -1;
      }).slice(0, 8);
      if (!found.length) {
        matches.innerHTML = '<p class="sidebar-match-empty">No matching tools.</p>';
        matches.hidden = false;
        return;
      }
      matches.innerHTML = '<h3>Matching tools</h3>' + found.map(function (tool) {
        return '<a href="' + escapeHtml(base + tool.url.replace(/^\//, '')) + '">' + escapeHtml(tool.name) + '</a>';
      }).join('');
      matches.hidden = false;
    }

    if (filter) {
      filter.addEventListener('input', function () {
        var query = filter.value.trim().toLocaleLowerCase();
        links.forEach(function (link) {
          var name = link.querySelector('.sidebar-name');
          var text = name ? name.textContent.toLocaleLowerCase() : '';
          link.hidden = !!query && text.indexOf(query) === -1;
        });
        renderMatches(query);
      });
      filter.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          filter.value = '';
          filter.dispatchEvent(new Event('input'));
        }
      });
    }

    var toolFilter = document.getElementById('tool-filter');
    var grid = document.getElementById('tool-grid');
    var count = document.getElementById('directory-matched');
    if (toolFilter && grid) {
      var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
      toolFilter.addEventListener('input', function () {
        var query = toolFilter.value.trim().toLocaleLowerCase();
        var shown = 0;
        cards.forEach(function (card) {
          var text = card.textContent.toLocaleLowerCase();
          var visible = !query || text.indexOf(query) !== -1;
          card.hidden = !visible;
          if (visible) shown++;
        });
        if (count) {
          count.textContent = query ? shown + ' matching tool' + (shown === 1 ? '' : 's') : '';
          count.hidden = !query;
        }
      });
      toolFilter.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          toolFilter.value = '';
          toolFilter.dispatchEvent(new Event('input'));
        }
      });
    }
  });
})();
