/* Toolbox PDF Editor — original full-screen host + About dialog controller.
   The editor engine lives in app.js; this file only manages the page shell. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const host = $('#editorHost');
  const launchBtn = $('#launchEditorBtn');
  const launchAboutBtn = $('#launchAboutBtn');
  const closeEditorBtn = $('#closeEditorBtn');
  const aboutBtn = $('#aboutBtn');
  const backdrop = $('#aboutBackdrop');
  const modal = $('#aboutModal');
  const closeAboutBtn = $('#closeAbout');
  const content = $('#aboutContent');
  const navList = $('#aboutNavList');

  let hostReturnFocus = null;
  let aboutReturnFocus = null;
  let hostTimer = 0;
  let aboutTimer = 0;
  let prepared = false;
  let navButtons = [];
  let scrollPending = false;

  /* ---------- full-screen editor host ---------- */

  function openHost() {
    if (!host) return;
    if (host.classList.contains('is-open')) return;
    hostReturnFocus = document.activeElement || launchBtn || null;
    clearTimeout(hostTimer);
    host.hidden = false;
    /* Make the host hit-testable immediately: no animated transform means
       pointer coordinates cannot drift while the page is opening. */
    host.classList.add('is-open');
    document.body.classList.add('editor-open');

    /* The editor measures its canvas on resize; refresh once visible and
       again after the fade so annotations always match the final geometry. */
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
    setTimeout(() => {
      const upload = $('#uploadBtn');
      if (upload && upload.focus) { try { upload.focus({ preventScroll: true }); } catch (e) {} }
    }, 200);
  }

  function closeHost() {
    if (!host || host.hidden) return;
    host.classList.remove('is-open');
    document.body.classList.remove('editor-open');
    hostTimer = setTimeout(() => { host.hidden = true; }, 250);
    if (hostReturnFocus && hostReturnFocus.focus) {
      try { hostReturnFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    hostReturnFocus = null;
  }

  /* ---------- About dialog content ---------- */

  function prepareAbout() {
    if (prepared || !content) return;
    const source = $('#landing .content');
    if (!source) return;

    /* One source of truth: reuse the crawlable article without duplicating IDs. */
    const clone = source.cloneNode(true);
    clone.removeAttribute('aria-labelledby');
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    clone.classList.add('about-copy');

    const related = $('#aboutRelated');
    if (related) content.insertBefore(clone, related);
    else content.appendChild(clone);

    const sections = [];
    const heading = clone.querySelector('h1');
    if (heading) {
      heading.id = 'about-sec-overview';
      sections.push({ id: heading.id, label: 'Overview' });
    }
    clone.querySelectorAll('h2').forEach((h2, i) => {
      const id = 'about-sec-' + (i + 1);
      h2.id = id;
      sections.push({ id: id, label: h2.dataset.navLabel || h2.textContent.trim() });
    });
    if (related) {
      related.id = 'about-sec-related';
      sections.push({ id: related.id, label: 'More tools' });
    }

    if (navList) {
      sections.forEach((section) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'about-nav-btn';
        btn.dataset.target = section.id;
        btn.textContent = section.label;
        btn.addEventListener('click', () => scrollToSection(section.id));
        navList.appendChild(btn);
      });
      navButtons = Array.from(navList.querySelectorAll('.about-nav-btn'));
    }

    prepared = true;
    updateActiveNav();
  }

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (!target || !content) return;
    const top = target.getBoundingClientRect().top -
      content.getBoundingClientRect().top + content.scrollTop - 12;
    if (content.scrollTo) {
      content.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      content.scrollTop = Math.max(0, top);
    }
    setActiveNav(id);
  }

  function setActiveNav(id) {
    navButtons.forEach((btn) => {
      const active = btn.dataset.target === id;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function updateActiveNav() {
    if (!prepared || !navButtons.length || !content) return;
    const containerTop = content.getBoundingClientRect().top;
    let active = navButtons[0].dataset.target;
    navButtons.forEach((btn) => {
      const section = document.getElementById(btn.dataset.target);
      if (section && section.getBoundingClientRect().top - containerTop <= 26) {
        active = btn.dataset.target;
      }
    });
    /* Near the bottom, always highlight the last section. */
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 8) {
      active = navButtons[navButtons.length - 1].dataset.target;
    }
    setActiveNav(active);
  }

  /* ---------- About dialog open / close ---------- */

  function openAbout(trigger, updateHash) {
    if (!modal) return;
    prepareAbout();
    aboutReturnFocus = trigger || document.activeElement || null;
    clearTimeout(aboutTimer);
    if (backdrop) backdrop.hidden = false;
    modal.hidden = false;
    document.body.classList.add('about-open');

    requestAnimationFrame(() => {
      if (backdrop) backdrop.classList.add('is-open');
      modal.classList.add('is-open');
      if (closeAboutBtn && closeAboutBtn.focus) {
        try { closeAboutBtn.focus({ preventScroll: true }); } catch (e) {}
      }
      updateActiveNav();
    });

    if (updateHash !== false) {
      try { history.replaceState(null, '', location.pathname + location.search + '#about'); } catch (e) {}
    }
  }

  function closeAbout(updateHash) {
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    document.body.classList.remove('about-open');
    aboutTimer = setTimeout(() => {
      modal.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 250);

    if (aboutReturnFocus && aboutReturnFocus.focus) {
      try { aboutReturnFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    aboutReturnFocus = null;

    if (updateHash !== false) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
  }

  /* ---------- events ---------- */

  if (launchBtn) launchBtn.addEventListener('click', openHost);
  if (closeEditorBtn) closeEditorBtn.addEventListener('click', closeHost);
  if (launchAboutBtn) launchAboutBtn.addEventListener('click', () => openAbout(launchAboutBtn));
  if (aboutBtn) aboutBtn.addEventListener('click', () => openAbout(aboutBtn));
  if (closeAboutBtn) closeAboutBtn.addEventListener('click', () => closeAbout());
  if (backdrop) backdrop.addEventListener('click', () => closeAbout());

  if (modal) {
    /* Keep keyboard focus inside the dialog and stop editor shortcuts firing. */
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeAbout();
        return;
      }
      if (ev.key === 'Tab') {
        const focusables = Array.from(
          modal.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (ev.shiftKey && document.activeElement === first) {
            ev.preventDefault();
            last.focus();
          } else if (!ev.shiftKey && document.activeElement === last) {
            ev.preventDefault();
            first.focus();
          }
        }
      }
      ev.stopPropagation();
    });
  }

  if (content) {
    content.addEventListener('scroll', () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(() => { scrollPending = false; updateActiveNav(); });
    }, { passive: true });
  }

  window.addEventListener('hashchange', () => {
    if (location.hash === '#about') {
      if (!modal || modal.hidden) openAbout(null, false);
    } else if (modal && !modal.hidden) {
      closeAbout(false);
    }
  });

  if (location.hash === '#about') {
    requestAnimationFrame(() => openAbout(null, false));
  }
})();
