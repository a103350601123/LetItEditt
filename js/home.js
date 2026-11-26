/* LetitEdit homepage — Phase 1 interactions.
 * Homepage-only: mobile navigation and a client-side search built from the
 * real tool and category cards already present in the page. No uploads,
 * no external requests, no framework. */
'use strict';

(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  onReady(function () {
    var header = document.querySelector('[data-header]');
    var nav = document.getElementById('mobile-nav');
    var navToggle = document.querySelector('[data-nav-toggle]');
    var searchInput = document.getElementById('tool-search');
    var searchForm = document.querySelector('[data-search-form]');
    var searchWrap = document.querySelector('[data-search-wrap]');
    var results = document.getElementById('search-results');
    var status = document.querySelector('[data-search-status]');
    var focusButtons = document.querySelectorAll('[data-search-focus]');
    var lastFocused = null;

    /* ---------- Footer year ---------- */

    var year = String(new Date().getFullYear());
    document.querySelectorAll('[data-year]').forEach(function (node) {
      node.textContent = year;
    });

    /* ---------- Header elevation ---------- */

    if (header) {
      var updateHeader = function () {
        header.classList.toggle('is-scrolled', window.scrollY > 8);
      };
      updateHeader();
      window.addEventListener('scroll', updateHeader, { passive: true });
    }

    /* ---------- Mobile navigation ---------- */

    function openNav() {
      if (!nav || !navToggle) return;
      lastFocused = document.activeElement;
      nav.hidden = false;
      navToggle.setAttribute('aria-expanded', 'true');
      navToggle.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('hp-lock');
      var close = nav.querySelector('.hp-mobile-head [data-nav-close]');
      if (close) close.focus();
    }

    function closeNav() {
      if (!nav || !navToggle || nav.hidden) return;
      nav.hidden = true;
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('hp-lock');
      if (lastFocused && typeof lastFocused.focus === 'function') {
        lastFocused.focus();
      }
      lastFocused = null;
    }

    function navOpen() {
      return Boolean(nav && !nav.hidden);
    }

    if (navToggle) {
      navToggle.addEventListener('click', function () {
        if (navOpen()) closeNav();
        else openNav();
      });
    }

    if (nav) {
      nav.querySelectorAll('[data-nav-close]').forEach(function (button) {
        button.addEventListener('click', closeNav);
      });

      nav.addEventListener('click', function (event) {
        if (event.target.closest('a')) closeNav();
      });

      nav.addEventListener('keydown', function (event) {
        if (event.key !== 'Tab' || !navOpen()) return;
        var focusable = Array.prototype.filter.call(
          nav.querySelectorAll('a[href], button:not([disabled]), summary, input'),
          function (element) {
            return element.offsetParent !== null;
          }
        );
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    window.addEventListener('resize', function () {
      if (window.innerWidth > 980) closeNav();
    });

    /* ---------- Search index from real cards ---------- */

    var index = [];
    document.querySelectorAll('[data-search-type]').forEach(function (card) {
      var titleNode = card.querySelector('.hp-tool-title, .hp-cat-name');
      var descNode = card.querySelector('.hp-tool-desc, .hp-cat-desc');
      var iconNode = card.querySelector('.hp-tool-icon svg, .hp-cat-icon svg');
      var title = titleNode ? titleNode.textContent.trim() : '';
      var desc = descNode ? descNode.textContent.trim() : '';
      var href = card.getAttribute('href');
      if (!title || !href) return;
      var keys = (card.getAttribute('data-search-keys') || '').toLowerCase();
      index.push({
        title: title,
        titleLower: title.toLowerCase(),
        desc: desc,
        descLower: desc.toLowerCase(),
        keys: keys,
        type: card.getAttribute('data-search-type') || 'tool',
        url: href,
        icon: iconNode ? iconNode.cloneNode(true) : null
      });
    });

    function tokensOf(query) {
      return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    }

    function scoreEntry(entry, tokens) {
      var total = 0;
      for (var i = 0; i < tokens.length; i += 1) {
        var token = tokens[i];
        var part = 0;
        if (entry.titleLower.indexOf(token) === 0) part = 5;
        else if (entry.titleLower.indexOf(token) !== -1) part = 4;
        else if (entry.keys.indexOf(token) !== -1) part = 3;
        else if (entry.descLower.indexOf(token) !== -1) part = 2;
        else return -1;
        total += part;
      }
      if (entry.titleLower === tokens.join(' ')) total += 4;
      return total;
    }

    function findMatches(query, limit) {
      var tokens = tokensOf(query);
      if (!tokens.length) return [];
      return index
        .map(function (entry) {
          return { entry: entry, score: scoreEntry(entry, tokens) };
        })
        .filter(function (item) {
          return item.score >= 0;
        })
        .sort(function (a, b) {
          if (a.score !== b.score) return b.score - a.score;
          if (a.entry.type !== b.entry.type) return a.entry.type === 'tool' ? -1 : 1;
          return a.entry.title.localeCompare(b.entry.title);
        })
        .slice(0, limit)
        .map(function (item) {
          return item.entry;
        });
    }

    function appendHighlighted(node, text, tokens) {
      var lower = text.toLowerCase();
      var bestIndex = -1;
      var bestLength = 0;
      tokens.forEach(function (token) {
        var found = lower.indexOf(token);
        if (found === -1) return;
        if (bestIndex === -1 || found < bestIndex || (found === bestIndex && token.length > bestLength)) {
          bestIndex = found;
          bestLength = token.length;
        }
      });
      if (bestIndex === -1) {
        node.textContent = text;
        return;
      }
      node.appendChild(document.createTextNode(text.slice(0, bestIndex)));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(bestIndex, bestIndex + bestLength);
      node.appendChild(mark);
      node.appendChild(document.createTextNode(text.slice(bestIndex + bestLength)));
    }

    function resultNode(entry, tokens) {
      var link = document.createElement('a');
      link.className = 'hp-result';
      link.href = entry.url;

      var iconWrap = document.createElement('span');
      iconWrap.className = 'hp-result-icon';
      if (entry.icon) {
        iconWrap.appendChild(entry.icon.cloneNode(true));
      }
      link.appendChild(iconWrap);

      var body = document.createElement('span');
      body.className = 'hp-result-body';

      var title = document.createElement('span');
      title.className = 'hp-result-title';
      appendHighlighted(title, entry.title, tokens);
      body.appendChild(title);

      if (entry.desc) {
        var desc = document.createElement('span');
        desc.className = 'hp-result-desc';
        desc.textContent = entry.desc;
        body.appendChild(desc);
      }
      link.appendChild(body);

      var badge = document.createElement('span');
      badge.className = 'hp-result-badge';
      badge.textContent = entry.type === 'tool' ? 'Tool' : 'Category';
      link.appendChild(badge);

      return link;
    }

    function renderEntries(entries, tokens, heading) {
      if (!results) return;
      results.innerHTML = '';
      if (heading) {
        var label = document.createElement('p');
        label.className = 'hp-search-heading';
        label.textContent = heading;
        results.appendChild(label);
      }
      entries.forEach(function (entry) {
        results.appendChild(resultNode(entry, tokens));
      });
      results.hidden = false;
    }

    function setStatus(message) {
      if (status) status.textContent = message;
    }

    function hideResults() {
      if (!results) return;
      results.hidden = true;
      results.innerHTML = '';
      setStatus('');
    }

    function renderQuery(query) {
      if (!results) return;
      var tokens = tokensOf(query);
      if (!tokens.length) {
        hideResults();
        return;
      }
      var matches = findMatches(query, 8);
      if (!matches.length) {
        results.innerHTML = '';
        var empty = document.createElement('p');
        empty.className = 'hp-search-empty';
        empty.textContent =
          'No tools or categories match \u201c' + query.trim() +
          '\u201d. Try \u201cvideo\u201d, \u201caudio\u201d, \u201cimage\u201d or \u201cPDF\u201d.';
        results.appendChild(empty);
        results.hidden = false;
        setStatus('No results for ' + query.trim());
        return;
      }
      renderEntries(matches, tokens);
      setStatus(matches.length + (matches.length === 1 ? ' result' : ' results') + ' for ' + query.trim());
    }

    function showSuggestions() {
      if (!results || !searchInput || searchInput.value.trim()) return;
      var tools = index.filter(function (entry) {
        return entry.type === 'tool';
      }).slice(0, 5);
      if (!tools.length) return;
      renderEntries(tools, [], 'Popular tools');
      setStatus('Popular tools shown');
    }

    function focusSearch() {
      if (!searchInput) return;
      if (navOpen()) closeNav();
      searchInput.focus({ preventScroll: true });
      if (searchWrap) {
        searchWrap.scrollIntoView({
          behavior: reduceMotion.matches ? 'auto' : 'smooth',
          block: 'center'
        });
      }
      window.requestAnimationFrame(function () {
        searchInput.focus({ preventScroll: true });
        if (!searchInput.value.trim()) showSuggestions();
      });
    }

    focusButtons.forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        focusSearch();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        renderQuery(searchInput.value);
      });

      searchInput.addEventListener('focus', function () {
        if (!searchInput.value.trim()) showSuggestions();
      });

      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          if (searchInput.value) {
            searchInput.value = '';
            hideResults();
          } else {
            hideResults();
            searchInput.blur();
          }
          return;
        }
        if (event.key === 'ArrowDown' && results && !results.hidden) {
          var first = results.querySelector('.hp-result');
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }
      });
    }

    if (searchForm) {
      searchForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!searchInput) return;
        var query = searchInput.value.trim();
        if (!query) {
          searchInput.focus();
          return;
        }
        renderQuery(query);
        var first = results ? results.querySelector('.hp-result') : null;
        if (first) first.click();
      });
    }

    if (results) {
      results.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Escape') return;
        if (event.key === 'Escape') {
          event.preventDefault();
          hideResults();
          if (searchInput) searchInput.focus();
          return;
        }
        var links = Array.prototype.slice.call(results.querySelectorAll('.hp-result'));
        if (!links.length) return;
        var current = links.indexOf(document.activeElement);
        var next;
        if (event.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(links.length - 1, current + 1);
        else next = current < 0 ? links.length - 1 : Math.max(0, current - 1);
        event.preventDefault();
        links[next].focus();
      });
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-search-focus]')) return;
      if (searchWrap && !searchWrap.contains(event.target)) hideResults();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (navOpen()) {
        closeNav();
        return;
      }
      if (results && !results.hidden) hideResults();
    });
  });
})();
