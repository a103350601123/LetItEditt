/* LetitEdit site behaviour for the content-only site: mobile navigation,
 * current year and keyboard dismissal. */
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
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (navLinks && navLinks.classList.contains('is-open')) {
        closeMenu();
        if (menuButton) menuButton.focus();
      }
    });
  });
})();
