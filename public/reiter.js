// Reiter wie bei Windows für Seiten mit [data-reiter] (Profil): Klick oder ←/→ wechselt, die Adresse merkt sich den
// offenen Reiter (#freundebuch), Links mit data-reiter-link springen zu einem Reiter. Ohne JavaScript steht alles untereinander.
(function () {
  'use strict';
  document.querySelectorAll('[data-reiter]').forEach(function (bar) {
    var tabs = [].slice.call(bar.querySelectorAll('[role=tab]'));
    function page(t) { return document.getElementById(t.getAttribute('aria-controls')); }
    function show(t, focus) {
      tabs.forEach(function (b) {
        var on = b === t;
        b.setAttribute('aria-selected', on);
        b.tabIndex = on ? 0 : -1;
        page(b).hidden = !on;
      });
      if (focus) t.focus();
    }
    function byName(name) { return tabs.filter(function (b) { return b.getAttribute('aria-controls') === name; })[0]; }
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () {
        show(b);
        try { history.replaceState(null, '', location.pathname + location.search + (i ? '#' + b.getAttribute('aria-controls') : '')); } catch (e) { /* egal */ }
      });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); tabs[(i + d + tabs.length) % tabs.length].click(); tabs[(i + d + tabs.length) % tabs.length].focus(); }
      });
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-reiter-link]');
      var t = a && byName(a.getAttribute('href').slice(1));
      if (t) { e.preventDefault(); t.click(); t.focus(); }
    });
    // Sprung auf einen Reiter (#freundebuch) oder auf etwas darin (#g12 im Freundebuch)
    var hash = location.hash.slice(1), target = hash && document.getElementById(hash);
    var t = byName(hash) || (target && tabs.filter(function (b) { return page(b).contains(target); })[0]);
    show(t || tabs[0]);
    if (target && !byName(hash)) target.scrollIntoView();
  });
})();
