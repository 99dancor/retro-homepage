// Version 3.0: kleine Helfer für die modernen Seiten (views/v3). Hell/dunkel, Menüs, Rückfragen, Inhaltsverzeichnis,
// Code kopieren und im Desktop-Fenster: Links in andere Bereiche öffnen ein eigenes Fenster.
(function () {
  'use strict';
  var root = document.documentElement;

  // ---------- Hell, dunkel oder wie das Gerät ----------
  function theme() { try { return localStorage.getItem('v3-theme') || ''; } catch (e) { return ''; } }
  document.querySelectorAll('[data-theme-pick]').forEach(function (sel) {
    sel.value = theme();
    sel.addEventListener('change', function () {
      try { if (sel.value) localStorage.setItem('v3-theme', sel.value); else localStorage.removeItem('v3-theme'); } catch (e) { /* privat */ }
      if (sel.value) root.dataset.theme = sel.value; else delete root.dataset.theme;
    });
  });

  // ---------- Aufklappmenüs (Konto oben rechts) ----------
  var openMenu = null;
  function close() {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }
  document.querySelectorAll('[data-menu]').forEach(function (btn) {
    var menu = document.getElementById(btn.getAttribute('data-menu'));
    if (!menu) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var was = openMenu && openMenu.menu === menu;
      close();
      if (was) return;
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      openMenu = { btn: btn, menu: menu };
      var first = menu.querySelector('a, button');
      if (first && e.detail === 0) first.focus();
    });
  });
  document.addEventListener('click', function (e) { if (openMenu && !openMenu.menu.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMenu) { var b = openMenu.btn; close(); b.focus(); } });

  // ---------- Rückfrage vor dem Löschen ----------
  document.addEventListener('submit', function (e) {
    var f = e.target, q = f.getAttribute && f.getAttribute('data-confirm');
    if (q && !window.confirm(q)) e.preventDefault();
  }, true);

  // ---------- Inhaltsverzeichnis aus den Überschriften (Duden) ----------
  document.querySelectorAll('[data-toc]').forEach(function (box) {
    var src = document.querySelector(box.getAttribute('data-toc'));
    if (!src) return;
    var hs = src.querySelectorAll('h2, h3'), list = box.querySelector('ol') || box, used = {};
    if (!hs.length) { box.closest('[data-toc-wrap]') && (box.closest('[data-toc-wrap]').hidden = true); return; }
    hs.forEach(function (h) {
      var id = h.id || (h.textContent || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'abschnitt';
      while (used[id]) id += '-2';
      used[id] = 1; h.id = id;
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = '#' + id; a.textContent = h.textContent;
      if (h.tagName === 'H3') li.style.marginLeft = '12px';
      li.appendChild(a); list.appendChild(li);
    });
  });

  // ---------- Formular-Teile, die nur bei einer Auswahl gelten (Duden: Links nur bei Linksammlungen) ----------
  var kind = document.querySelector('[data-kind]'), linksBox = document.querySelector('[data-links]');
  if (kind && linksBox) kind.addEventListener('change', function () { linksBox.hidden = kind.value !== 'links'; });

  // ---------- Code-Blöcke kopieren ----------
  if (navigator.clipboard) document.querySelectorAll('.prose pre').forEach(function (pre) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pill small noprint'; b.textContent = 'Kopieren';
    b.style.cssText = 'float:right;margin:-4px -6px 4px 8px';
    b.addEventListener('click', function () {
      var code = pre.querySelector('code') || pre;
      navigator.clipboard.writeText(code.innerText).then(function () { b.textContent = 'Kopiert ✓'; setTimeout(function () { b.textContent = 'Kopieren'; }, 1500); });
    });
    pre.insertBefore(b, pre.firstChild);
  });

  // ---------- Im Desktop-Fenster ----------
  var desk = null;
  try { if (window.parent !== window) desk = window.parent.RetroDesk || null; } catch (e) { desk = null; }
  if (!desk) return;
  var section = function (p) { return p.split(/[?#]/)[0].split('/')[1] || ''; };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.hasAttribute('download') || a.target) return;
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener'; return; }
    if (/^\/(files\/dl|downloads\/dl|media|static|uploads|api)\//.test(u.pathname) || /\.(zip|xml|json|png|jpe?g|webp|gif|pdf)$/i.test(u.pathname)) return;
    if (section(u.pathname) !== section(location.pathname)) {
      e.preventDefault();
      desk.open(u.pathname + u.search + u.hash, true);
    }
  });
})();
