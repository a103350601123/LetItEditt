/* LetitEdit inline navigation helper.
 * Used on tool pages that already toggle their compact nav themselves.
 * Adds Escape-to-close, focus return and a keyboard focus loop without
 * binding a second toggle handler. No third-party libraries. */
(function () {
  'use strict';

  if (window.__letiteditInlineNav) return;
  window.__letiteditInlineNav = true;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
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

  ready(function () {
    var year = String(new Date().getFullYear());
    Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (el) {
      el.textContent = year;
    });

    var button = document.querySelector('.menu-button');
    var nav = document.getElementById('primary-links');
    if (!button || !nav) return;

    var returnFocus = null;

    function isOpen() {
      return nav.classList.contains('is-open');
    }

    function close(focusButton) {
      if (!isOpen()) return;
      nav.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      if (focusButton !== false) {
        var target = returnFocus && document.contains(returnFocus) ? returnFocus : button;
        target.focus();
      }
      returnFocus = null;
    }

    button.addEventListener('click', function () {
      if (!isOpen()) returnFocus = document.activeElement;
      window.setTimeout(function () {
        if (!isOpen()) return;
        var first = nav.querySelector('a[href]');
        if (first) first.focus();
      }, 0);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab' && isOpen()) trapFocus(nav, event);
    });

    if (window.matchMedia) {
      var desktop = window.matchMedia('(min-width: 721px)');
      var onChange = function (event) { if (event.matches) close(false); };
      if (desktop.addEventListener) desktop.addEventListener('change', onChange);
      else if (desktop.addListener) desktop.addListener(onChange);
    }
  });
})();
