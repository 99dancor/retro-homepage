// Farming Simulator Hub im Browser (views/fshub/*.ejs): laufende Spieluhr, Übersicht frisch halten, Karte (Ansichten, Zoom, Feldwahl),
// Hofkalender (Aufgabe per Klick auf einen Tag), Aufgabenformular. Alles Weitere sind normale Links und Formulare, der Hub geht auch ohne JavaScript.
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

  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privat */ } }
  };

  // ---------- Karte: Ansichten blättern, Einträge ein- und ausblenden, zoomen und verschieben, Feld wählen ----------
  var map = document.getElementById('fs-map');
  if (map) {
    var box = document.getElementById('fs-mapbox'), groups = [].slice.call(document.querySelectorAll('.fs-items[data-group]'));
    var keys = groups.map(function (g) { return g.dataset.group; });
    var saved = store.get('fs-map') || {};
    var off = saved.off || {};          // je Ansicht die ausgeblendeten Einträge
    var layer = map.dataset.layer;
    var fields = [].slice.call(map.querySelectorAll('.fld'));
    var save = function () { store.set('fs-map', { off: off, layer: layer, shows: shows }); };
    var url = function (k, feld) {
      try {
        var u = new URL(location.href);
        if (k) u.searchParams.set('ansicht', k);
        if (feld === null) u.searchParams.delete('feld'); else if (feld) u.searchParams.set('feld', feld);
        u.searchParams.delete('ok');
        history.replaceState(null, '', u);
      } catch (e) { /* egal */ }
    };
    var apply = function () {
      var hid = off[layer] || [];
      fields.forEach(function (f) { f.classList.toggle('hid', hid.indexOf(f.getAttribute('data-' + layer)) >= 0); });
      map.querySelectorAll('.ras image').forEach(function (im) { im.classList.toggle('hid', hid.indexOf('ras:' + im.dataset.raster) >= 0); });
      groups.forEach(function (g) {
        g.querySelectorAll('.fs-item').forEach(function (b) { b.classList.toggle('off', hid.indexOf(b.dataset.item) >= 0); });
      });
    };
    var setLayer = function (k) {
      layer = k;
      map.dataset.layer = k;
      groups.forEach(function (g) { g.hidden = g.dataset.group !== k; });
      var g = groups[keys.indexOf(k)];
      document.getElementById('fs-ltitle').textContent = g ? g.dataset.title : '';
      document.querySelectorAll('.fs-dots [data-layer]').forEach(function (a) { a.firstElementChild.classList.toggle('on', a.dataset.layer === k); });
      map.querySelectorAll('a[data-field]').forEach(function (a) { a.setAttribute('href', '/farming/karte?ansicht=' + k + '&feld=' + a.dataset.field); });
      url(k);
      apply();
      save();
    };
    document.querySelectorAll('.fs-legend [data-step]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        setLayer(keys[(keys.indexOf(layer) + Number(a.dataset.step) + keys.length) % keys.length]);
      });
    });
    document.querySelectorAll('.fs-dots [data-layer]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); setLayer(a.dataset.layer); });
    });
    groups.forEach(function (g) {
      var all = [].map.call(g.querySelectorAll('.fs-item'), function (b) { return b.dataset.item; });
      g.querySelectorAll('.fs-item').forEach(function (b) {
        var k = b.dataset.item;
        b.addEventListener('click', function () {
          var hid = off[layer] = (off[layer] || []).slice(), i = hid.indexOf(k);
          if (i >= 0) hid.splice(i, 1); else hid.push(k);
          apply(); save();
        });
        // Rechtsklick: nur dieser Eintrag; ist er schon allein, wieder alle
        b.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          var hid = off[layer] || [], alone = hid.indexOf(k) < 0 && hid.length === all.length - 1;
          off[layer] = alone ? [] : all.filter(function (x) { return x !== k; });
          apply(); save();
        });
        // Überfahren hebt die Felder des Eintrags hervor
        b.addEventListener('mouseenter', function () { fields.forEach(function (f) { f.classList.toggle('hl', f.getAttribute('data-' + layer) === k); }); });
        b.addEventListener('mouseleave', function () { fields.forEach(function (f) { f.classList.remove('hl'); }); });
      });
    });
    var shows = saved.shows || {};
    document.querySelectorAll('[data-show]').forEach(function (c) {
      var k = c.dataset.show;
      if (typeof shows[k] === 'boolean') c.checked = shows[k];
      var put = function () { map.classList.toggle('hide-' + k, !c.checked); shows[k] = c.checked; save(); };
      c.addEventListener('change', put);
      put();
    });
    // Ohne ausdrückliche Ansicht in der Adresse gilt die zuletzt gewählte
    if (!/[?&]ansicht=/.test(location.search) && saved.layer && keys.indexOf(saved.layer) >= 0) setLayer(saved.layer); else setLayer(layer);

    // Zoomen und Verschieben über die viewBox
    var vb = [0, 0, 1000, 1000];
    var setVb = function () { map.setAttribute('viewBox', vb.map(function (v) { return v.toFixed(1); }).join(' ')); };
    var toMap = function (cx, cy) {
      var m = map.getScreenCTM();
      if (!m) return [500, 500];
      var p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      return [p.x, p.y];
    };
    var zoom = function (f, cx, cy) {
      var w = Math.max(40, Math.min(1600, vb[2] / f)), k = w / vb[2];
      vb = [cx - (cx - vb[0]) * k, cy - (cy - vb[1]) * k, w, w];
      setVb();
    };
    box.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = toMap(e.clientX, e.clientY);
      zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, p[0], p[1]);
    }, { passive: false });
    document.querySelectorAll('[data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = Number(b.dataset.zoom);
        if (!f) { vb = [0, 0, 1000, 1000]; setVb(); return; }
        zoom(f, vb[0] + vb[2] / 2, vb[1] + vb[3] / 2);
      });
    });
    var drag = null, moved = false;
    box.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('.fs-finfo, .fs-zoom')) return;
      drag = { x: e.clientX, y: e.clientY, vb: vb.slice(), p: toMap(e.clientX, e.clientY) };
      moved = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      if (!moved) { moved = true; box.classList.add('drag'); }
      var r = map.getBoundingClientRect(), s = drag.vb[2] / Math.min(r.width, r.height);
      vb = [drag.vb[0] - (e.clientX - drag.x) * s, drag.vb[1] - (e.clientY - drag.y) * s, drag.vb[2], drag.vb[3]];
      setVb();
    });
    window.addEventListener('pointerup', function () { drag = null; box.classList.remove('drag'); });

    // Feld wählen: Infokarte aus den mitgeschickten Daten, das Meldeformular aus der Vorlage
    var cards = {};
    try { JSON.parse(document.getElementById('fs-cards').textContent).forEach(function (c) { cards[c.id] = c; }); } catch (e) { /* ohne Daten bleibt der Link */ }
    var info = document.getElementById('fs-finfo'), tpl = document.getElementById('fs-reportform');
    var esc = function (t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
    var de = function (n, d) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
    var row = function (t, v) { return '<div class="fs-row"><span class="t">' + t + '</span><span class="v">' + v + '</span></div>'; };
    var select = function (id) {
      fields.forEach(function (f) { f.classList.toggle('sel', f.parentNode.dataset.field === String(id)); });
      var c = cards[id];
      if (!c) { info.hidden = true; url(null, null); return; }
      var h = '<a class="x" href="#" data-close aria-label="Schließen">✕</a><h2>Feld ' + c.id + '</h2><div class="fs-rows">' +
        row('Größe', de(c.ha, 1) + ' ha') +
        row('Besitzer', c.farm ? '<a href="/farming/hof/' + c.farm.id + '">' + esc(c.farm.name) + '</a>' : 'zu kaufen' + (c.price ? ' für ' + de(Math.round(c.price)) + ' €' : '')) +
        row('Frucht', c.crop ? '<span class="fs-name">' + c.icon + esc(c.crop) + '</span>' + (c.src === 'plan' ? ' (laut Plan)' : '') : (c.src === 'auto' ? 'nichts' : 'unbekannt')) +
        row('Zustand', '<b>' + esc(c.state || 'unbekannt') + '</b>' + (c.growth ? ', Stufe ' + c.growth : '')) +
        (c.soil ? row('Boden', 'Kalk ' + c.soil.lime + '/3 · Dünger ' + c.soil.spray + '/2 · Pflug ' + (c.soil.plow ? '✔' : '–')) : '') + '</div>';
      if (c.care.length) h += '<div class="chips">' + c.care.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div>';
      if (c.autoAt) h += '<div class="hint">laut letztem Autosave, abgeholt ' + esc(c.autoAt) + '</div>';
      if (c.report) h += '<div class="hint">' + (c.report.cur ? '' : 'Ältere Meldung: ') + 'gemeldet von ' + esc(c.report.by) + (c.report.day ? ' am ' + esc(c.report.day) : '') + ', ' + esc(c.report.at) + '</div>';
      if (c.plan) h += '<div class="hint">Plan: ' + esc(c.plan) + '</div>';
      info.innerHTML = h;
      if (c.edit && tpl) {
        var form = tpl.content.firstElementChild.cloneNode(true);
        form.action = '/farming/feld/' + c.id;
        var cs = form.querySelector('[name=crop_id]');
        if (c.report && c.report.crop) cs.value = String(c.report.crop);
        else if (c.crop) [].forEach.call(cs.options, function (o) { if (o.textContent === c.crop) cs.value = o.value; });
        if (c.stateKey) form.querySelector('[name=state]').value = c.stateKey;
        var pl = form.querySelector('[data-plan]'), tk = form.querySelector('[data-task]');
        if (c.farm) {
          pl.href = '/farming/hof/' + c.farm.id + '?tab=kalender&feld=' + c.id + '#plan';
          tk.href = '/farming/hof/' + c.farm.id + '?tab=aufgaben&feld=' + c.id + '#neu';
        } else { pl.remove(); tk.remove(); }
        info.appendChild(form);
      }
      info.hidden = false;
      url(null, c.id);
    };
    map.querySelectorAll('a[data-field]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (moved) return;
        select(Number(a.dataset.field));
      });
    });
    info.addEventListener('click', function (e) {
      if (!e.target.closest('[data-close]')) return;
      e.preventDefault();
      info.hidden = true;
      fields.forEach(function (f) { f.classList.remove('sel'); });
      url(null, null);
    });
    // Feld aus der Adresse: hinzoomen
    var pre = map.querySelector('.fld.sel');
    if (pre && pre.getBBox) {
      var bb = pre.getBBox(), w = Math.max(160, bb.width * 4, bb.height * 4);
      vb = [bb.x + bb.width / 2 - w / 2, bb.y + bb.height / 2 - w / 2, w, w];
      setVb();
    }
  }

  // ---------- Hofkalender: Klick auf einen Tag öffnet „Neue Aufgabe“ ----------
  var pop = document.getElementById('fs-calpop');
  if (pop) {
    var close = function () { pop.hidden = true; };
    document.querySelectorAll('.fs-cal td.d > a[data-day]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        pop.querySelector('[name=due_day]').value = a.dataset.day;
        pop.querySelector('[data-title]').textContent = 'Neue Aufgabe · ' + a.dataset.label;
        pop.querySelector('[name=field]').value = a.dataset.field || '';
        pop.hidden = false;
        var r = a.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
        pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
        pop.style.top = (r.bottom + ph + 8 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - ph - 6)) + 'px';
        pop.querySelector('[name=title]').focus();
      });
    });
    pop.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.addEventListener('pointerdown', function (e) { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.fs-cal td.d > a')) close(); });
  }

  // ---------- Aufklappbare Abschnitte merken sich, ob sie offen sind ----------
  document.querySelectorAll('details[data-remember]').forEach(function (d) {
    var k = d.dataset.remember, v = store.get(k);
    if (typeof v === 'boolean') d.open = v;
    d.addEventListener('toggle', function () { store.set(k, d.open); });
  });

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
