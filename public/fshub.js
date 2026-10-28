// Farming Simulator Hub im Browser (views/fshub/*.ejs): laufende Spieluhr, Übersicht frisch halten, Karte umschalten,
// Aufgabenformular. Alles Weitere sind normale Links und Formulare, der Hub geht auch ohne JavaScript.
(function () {
  'use strict';
  var root = document.getElementById('fs');
  if (!root) return;

  // ---------- Uhr: läuft der Server, zählt sie mit dem Zeitfaktor weiter ----------
  var clock = document.getElementById('fs-clock');
  if (clock && clock.dataset.run && clock.dataset.ms) {
    var ms = Number(clock.dataset.ms), at = Number(clock.dataset.at) || Date.now(), scale = Number(clock.dataset.scale) || 1;
    var tick = function () {
      var t = (ms + (Date.now() - at) * scale) % 86400000, m = Math.floor(t / 60000);
      clock.textContent = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    };
    tick();
    setInterval(tick, 5000);
  }

  // ---------- Übersicht: jede Minute neu laden, solange niemand schreibt ----------
  if (document.getElementById('notizen')) {
    setInterval(function () {
      if (document.hidden) return;
      var busy = [].some.call(document.querySelectorAll('textarea, input:not([type=hidden]), select'), function (el) {
        return el === document.activeElement || (el.tagName === 'TEXTAREA' && el.value.trim());
      });
      if (!busy && !document.querySelector('details[open]')) location.reload();
    }, 60000);
  }

  // ---------- Karte ----------
  var map = document.getElementById('fs-map');
  if (map) {
    var setLayer = function (k) {
      map.dataset.layer = k;
      document.querySelectorAll('[data-layer]').forEach(function (a) { if (a !== map) a.classList.toggle('on', a.dataset.layer === k); });
      document.querySelectorAll('.fs-legend').forEach(function (l) { l.hidden = l.dataset.for !== k; });
      try {
        var u = new URL(location.href);
        u.searchParams.set('ansicht', k);
        history.replaceState(null, '', u);
      } catch (e) { /* egal */ }
      // Feld-Links behalten die Ansicht
      map.querySelectorAll('a[data-field]').forEach(function (a) { a.setAttribute('href', '/farming/karte?ansicht=' + k + '&feld=' + a.dataset.field); });
    };
    document.querySelectorAll('a[data-layer]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); setLayer(a.dataset.layer); });
    });
    setLayer(map.dataset.layer);
    document.querySelectorAll('[data-show]').forEach(function (c) {
      var apply = function () { map.classList.toggle('hide-' + c.dataset.show, !c.checked); };
      c.addEventListener('change', apply);
      apply();
    });
    document.querySelectorAll('button[data-crop]').forEach(function (b) {
      b.addEventListener('click', function () {
        var off = b.classList.toggle('off');
        map.querySelectorAll('.l-fruechte circle').forEach(function (c) {
          if (c.getAttribute('data-crop') === b.dataset.crop) c.style.display = off ? 'none' : '';
        });
      });
    });
  }

  // ---------- Aufgabenformular: nur die passenden Felder zeigen ----------
  document.querySelectorAll('.fs-taskform').forEach(function (f) {
    var due = f.querySelector('[data-due]'), rep = f.querySelector('[data-repeat]');
    var sync = function () {
      f.querySelectorAll('[data-for]').forEach(function (el) {
        var k = el.dataset.for;
        var show = k === 'n' ? ['days', 'gdays', 'gmonths', 'weekly'].indexOf(rep.value) >= 0 : k === 'weekly' ? rep.value === 'weekly' : due.value === k;
        el.hidden = !show;
        el.disabled = !show;
      });
    };
    due.addEventListener('change', sync);
    rep.addEventListener('change', sync);
    sync();
  });
})();
