// Darstellung: Schriftgröße, Farben und Bewegung, eingestellt über den Knopf neben der Uhr.
// Die Wahl liegt nur im Browser (localStorage "darstellung") und wird nie an den Server geschickt.
// Läuft schon im <head>, damit eine Seite gar nicht erst in der falschen Größe oder Farbe aufblitzt.
(function () {
  'use strict';
  var KEY = 'darstellung';
  var root = document.documentElement;
  var SIZES = ['normal', 'gross', 'sehr-gross'], SCHEMES = ['seite', 'nacht', 'kontrast'];

  function load() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* gesperrt oder leer */ }
    return {
      size: SIZES.indexOf(p.size) > 0 ? p.size : 'normal',
      scheme: SCHEMES.indexOf(p.scheme) > 0 ? p.scheme : 'seite',
      still: p.still === true,
    };
  }
  function save(p) {
    try {
      if (p.size === 'normal' && p.scheme === 'seite' && !p.still) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(p));
    } catch (e) { /* dann gilt die Wahl nur bis zum Neuladen */ }
  }

  function apply(p) {
    p = p || load();
    SIZES.forEach(function (s) { root.classList.toggle('fs-' + s, s === p.size && s !== 'normal'); });
    SCHEMES.forEach(function (s) { root.classList.toggle('scheme-' + s, s === p.scheme && s !== 'seite'); });
    root.classList.toggle('still', p.still);
    if (document.body) {
      document.querySelectorAll('marquee').forEach(function (m) { try { if (p.still) m.stop(); else m.start(); } catch (e) { /* egal */ } });
    }
  }
  apply();
  window.RetroDisplay = { apply: apply };
  // Andere Fenster (iframes) übernehmen eine Änderung sofort
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) apply(); });

  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var btn = document.getElementById('displaybtn'), panel = document.getElementById('displaypanel');
    if (!btn || !panel) return;
    var form = panel.querySelector('form');

    function fill(p) {
      form.elements.size.value = p.size;
      form.elements.scheme.value = p.scheme;
      form.elements.still.checked = p.still;
    }
    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open);
      if (open) { fill(load()); (form.querySelector('input:checked') || form.elements.size[0]).focus(); }
    }
    function changed(p) {
      save(p); apply(p);
      document.querySelectorAll('iframe').forEach(function (f) {
        try { if (f.contentWindow.RetroDisplay) f.contentWindow.RetroDisplay.apply(p); } catch (e) { /* fremde Seite */ }
      });
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById('startmenu');
      if (menu) menu.classList.remove('open');
      setOpen(panel.hidden);
    });
    var start = document.getElementById('startbtn');
    if (start) start.addEventListener('click', function () { setOpen(false); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { if (!panel.hidden) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
    panel.querySelector('[data-act=close]').addEventListener('click', function () { setOpen(false); });
    form.addEventListener('change', function () {
      changed({ size: form.elements.size.value, scheme: form.elements.scheme.value, still: form.elements.still.checked });
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); setOpen(false); });
    form.querySelector('[data-act=reset]').addEventListener('click', function () {
      var p = { size: 'normal', scheme: 'seite', still: false };
      fill(p); changed(p);
    });
    // Links im Fenster öffnen auf dem Desktop ein eigenes Fenster
    panel.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a || !window.RetroDesk) return;
      e.preventDefault(); setOpen(false);
      window.RetroDesk.open(a.getAttribute('href'), false);
    });
  });
})();
