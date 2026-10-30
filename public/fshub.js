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

  // ---------- Karte: Ansichten blättern, Einträge ein- und ausblenden, zoomen und verschieben, wählen ----------
  var map = document.getElementById('fs-map');
  if (map) {
    var box = document.getElementById('fs-mapbox'), groups = [].slice.call(document.querySelectorAll('.fs-items[data-group]'));
    var keys = groups.map(function (g) { return g.dataset.group; });
    var saved = store.get('fs-map') || {};
    var off = saved.off || {};          // je Ansicht die ausgeblendeten Einträge
    var shows = saved.shows || {};
    var layer = map.dataset.layer;
    var fields = [].slice.call(map.querySelectorAll('.fld'));
    // Bilder je Fleck und Plantagenreihen: gehören zu einer Ansicht (data-of) und einem Eintrag (data-item)
    var layered = [].slice.call(map.querySelectorAll('[data-of]'));
    var info = document.getElementById('fs-finfo');
    var esc = function (t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
    var de = function (n, d) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
    var ha = function (n) { return de(n, n < 10 ? 2 : 1) + ' ha'; };
    var row = function (t, v) { return '<div class="fs-row"><span class="t">' + t + '</span><span class="v">' + v + '</span></div>'; };
    var save = function () { store.set('fs-map', { off: off, layer: layer, shows: shows }); };
    var url = function (k, sel) {
      try {
        var u = new URL(location.href);
        if (k) u.searchParams.set('ansicht', k);
        if (sel !== undefined) { ['feld', 'station', 'fahrzeug'].forEach(function (p) { u.searchParams.delete(p); }); if (sel) u.searchParams.set(sel[0], sel[1]); }
        u.searchParams.delete('ok');
        history.replaceState(null, '', u);
      } catch (e) { /* egal */ }
    };
    var apply = function () {
      var hid = off[layer] || [];
      fields.forEach(function (f) { f.classList.toggle('hid', hid.indexOf(f.getAttribute('data-' + layer)) >= 0); });
      layered.forEach(function (el) { el.style.display = el.dataset.of === layer && hid.indexOf(el.dataset.item) < 0 ? '' : 'none'; });
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
    var mark = function (k, on) {
      fields.forEach(function (f) { f.classList.toggle('hl', on && f.getAttribute('data-' + layer) === k); });
      layered.forEach(function (el) { el.classList.toggle('hl', on && el.dataset.item === k); });
    };
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
        // Überfahren hebt hervor, was zum Eintrag gehört
        b.addEventListener('mouseenter', function () { mark(k, true); });
        b.addEventListener('mouseleave', function () { mark(k, false); });
      });
    });
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
    // Symbole bleiben beim Zoomen gleich groß (fshub.css: .st .sc { transform: scale(var(--z)) }): Kartenmaß je Bildpunkt
    // --z nur an Stationen und Nummern: an der ganzen Karte müsste der Browser bei jedem Zoomschritt alle Formen neu durchrechnen
    var scaled = map.querySelectorAll('.stn, .nr');
    var setZ = function () {
      var r = map.getBoundingClientRect(), px = Math.min(r.width, r.height);
      if (px) for (var i = 0; i < scaled.length; i++) scaled[i].style.setProperty('--z', (vb[2] / px * 1.1).toFixed(4));
    };
    // Höchstens einmal je Bild neu zeichnen, auch wenn Mausrad und Ziehen schneller Ereignisse schicken
    var frame = 0;
    var setVb = function () {
      if (frame) return;
      frame = requestAnimationFrame(function () { frame = 0; map.setAttribute('viewBox', vb.map(function (v) { return v.toFixed(1); }).join(' ')); setZ(); });
    };
    setZ();
    window.addEventListener('resize', setZ);
    // Bildschirm → Kartenmaß aus der aktuellen vb (nicht aus der gezeichneten Karte, die hängt bis zum nächsten Bild hinterher)
    var toMap = function (cx, cy) {
      var r = map.getBoundingClientRect(), m = Math.min(r.width, r.height);
      if (!m) return [500, 500];
      return [vb[0] + (cx - r.left - (r.width - m) / 2) * vb[2] / m, vb[1] + (cy - r.top - (r.height - m) / 2) * vb[3] / m];
    };
    var zoom = function (f, cx, cy) {
      var w = Math.max(40, Math.min(1600, vb[2] / f)), k = w / vb[2];
      vb = [cx - (cx - vb[0]) * k, cy - (cy - vb[1]) * k, w, w];
      setVb();
    };
    var focus = function (cx, cy, w) { vb = [cx - w / 2, cy - w / 2, w, w]; setVb(); };
    box.addEventListener('wheel', function (e) {
      if (e.target.closest('.fs-finfo')) return;
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
      drag = { x: e.clientX, y: e.clientY, vb: vb.slice() };
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

    // Infokarten aus den mitgeschickten Daten: Grundstück, Station, Fahrzeug
    var json = function (id) { try { return JSON.parse(document.getElementById(id).textContent); } catch (e) { return []; } };
    var cards = {}, stations = {}, vehicles = {};
    json('fs-cards').forEach(function (c) { cards[c.id] = c; });
    json('fs-stations').forEach(function (s) { stations[s.uid] = s; });
    json('fs-vehicles').forEach(function (v) { vehicles[v.i] = v; });
    var soilTpl = document.getElementById('fs-soilform');
    var unselect = function () {
      fields.forEach(function (f) { f.classList.remove('sel'); });
      map.querySelectorAll('.st.sel, [data-vehicle].sel').forEach(function (a) { a.classList.remove('sel'); });
    };
    var show = function (h, sel) { info.innerHTML = '<a class="x" href="#" data-close aria-label="Schließen">✕</a>' + h; info.hidden = false; url(null, sel); };
    // Balken mit Anteilen: Hektar und Prozent (pct: Werte sind schon Prozent)
    var bar = function (list, pct) {
      var sum = list.reduce(function (a, x) { return a + x.ha; }, 0) || 1;
      return '<div class="fs-soil"><div class="bar">' + list.map(function (x) { return '<i style="flex:' + x.ha + ';background:' + x.color + '" title="' + esc(x.name || x.label) + '"></i>'; }).join('') + '</div>' +
        list.map(function (x) { return '<span>' + (x.icon || '<i style="background:' + x.color + '"></i>') + esc(x.name || x.label) + ' ' + (pct ? de(x.ha) + ' %' : ha(x.ha) + ' (' + Math.round(x.ha / sum * 100) + ' %)') + '</span>'; }).join('') + '</div>';
    };
    var selectField = function (id) {
      var c = cards[id];
      unselect();
      if (!c) { info.hidden = true; url(null, null); return; }
      fields.forEach(function (f) { f.classList.toggle('sel', f.parentNode.dataset.field === String(id)); });
      var h = '<h2>Grundstück ' + c.id + '</h2><div class="fs-rows">' +
        row('Größe', de(c.ha, 2) + ' ha' + (c.fieldHa ? ' · ' + ha(c.fieldHa) + ' bewirtschaftet' : '')) +
        row('Besitzer', c.farm ? '<a href="/farming/hof/' + c.farm.id + '">' + esc(c.farm.name) + '</a>' : 'zu kaufen' + (c.price ? ' für ' + de(Math.round(c.price)) + ' €' : '')) +
        (c.fields.length ? row(c.fields.length === 1 ? 'Feld' : 'Felder', c.fields.map(function (f) { return 'Feld ' + f.id + (f.ha ? ' (' + ha(f.ha) + ')' : ''); }).join(', ')) : row('Felder', 'keins (Wiese, Wald oder Gebäude)')) +
        (c.orchard ? row('Plantage', esc(c.orchard)) : '') +
        (!c.mix.length ? row('Frucht', c.crop ? '<span class="fs-name">' + c.icon + esc(c.crop) + '</span>' + (c.src === 'plan' ? ' (laut Plan)' : '') : (c.src ? 'nichts' : 'unbekannt')) : '') +
        (!c.states.length && (c.state || c.src) ? row('Zustand', '<b>' + esc(c.state || 'unbekannt') + '</b>' + (c.growth ? ', Stufe ' + c.growth : '')) : '') +
        (c.soil ? row('Boden', 'Kalk ' + c.soil.lime + '/3 · Dünger ' + c.soil.spray + '/2 · Pflug ' + (c.soil.plow ? '✔' : '–')) : '') +
        (c.soilType && c.soilType.yield ? row('Ertragspotenzial', de(c.soilType.yield) + ' %') : '') + '</div>';
      if (c.mix.length) h += '<div class="hint">Früchte</div>' + bar(c.mix);
      if (c.states.length) h += '<div class="hint">Zustand</div>' + bar(c.states);
      if (c.soilType && c.soilType.parts.length) h += '<div class="hint">Bodenart</div>' + bar(c.soilType.parts.map(function (x) { return { label: x.label, color: x.color, ha: x.pct }; }), true);
      if (c.care.length) h += '<div class="chips">' + c.care.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div>';
      if (c.stations.length) h += '<div class="hint">Hier stehen: ' + c.stations.map(function (s) { return '<a href="#" data-goto-station="' + esc(s.uid) + '">' + esc(s.name) + '</a>'; }).join(', ') + '</div>';
      if (c.autoAt) h += '<div class="hint">laut letztem Autosave, abgeholt ' + esc(c.autoAt) + '</div>';
      if (c.plan) h += '<div class="hint">Plan: ' + esc(c.plan) + '</div>';
      if (c.farm && c.edit) h += '<div class="row"><a class="btn small" href="/farming/hof/' + c.farm.id + '?tab=kalender&feld=' + c.id + '#plan">Anbau planen</a> <a class="btn small" href="/farming/hof/' + c.farm.id + '?tab=aufgaben&feld=' + c.id + '#neu">Aufgabe</a></div>';
      show(h, ['feld', c.id]);
      if (soilTpl) {
        var f = soilTpl.content.firstElementChild.cloneNode(true), form = f.querySelector('form');
        form.action = '/farming/boden/' + c.id;
        if (c.soilType) {
          c.soilType.parts.forEach(function (x) { var i = form.querySelector('[data-soil="' + x.key + '"]'); if (i) i.value = x.pct; });
          if (c.soilType.yield) form.querySelector('[data-soil=yield]').value = c.soilType.yield;
        }
        info.appendChild(f);
      }
    };
    var goods = function (title, list) {
      return list.length ? '<div class="hint">' + title + ' (' + list.length + '):</div><div class="chips fs-sells">' + list.map(function (f) { return '<a class="chip" href="/farming/preise?w=' + encodeURIComponent(f.fill) + '">' + f.icon + esc(f.name) + '</a>'; }).join('') + '</div>' : '';
    };
    var selectStation = function (uid) {
      var s = stations[uid];
      if (!s) return;
      unselect();
      map.querySelectorAll('.st').forEach(function (a) { a.classList.toggle('sel', a.dataset.station === uid); });
      var h = '<h2>' + esc(s.name) + '</h2><div class="fs-rows">' + row('Art', esc(s.catLabel)) + (s.where ? row('Lage', esc(s.where)) : '') +
        (s.farm ? row('Besitzer', '<a href="/farming/hof/' + s.farm.id + '">' + esc(s.farm.name) + '</a>') : '') +
        (s.planner ? row('Produktionen', s.productions + ' · <a href="/farming/produktion?g=' + encodeURIComponent(s.planner) + '">im Produktionsplaner</a>') : '') + '</div>';
      if (s.demands.length) h += '<div class="hint">Große Nachfrage: ' + s.demands.map(function (d) { return esc(d.name) + ' ×' + de(d.mult, 1) + (d.running ? ' (läuft)' : d.day ? ' ab ' + esc(d.day) : ''); }).join(', ') + '</div>';
      h += goods(s.cat === 'einkauf' ? 'Hier zu kaufen' : 'Nimmt an', s.cat === 'einkauf' && s.buys.length ? s.buys : s.sells);
      if (s.cat !== 'einkauf' && s.buys.length) h += goods('Hier zu kaufen', s.buys);
      show(h, ['station', uid]);
      return s;
    };
    var selectVehicle = function (i) {
      var v = vehicles[i];
      if (!v) return;
      unselect();
      map.querySelectorAll('[data-vehicle]').forEach(function (a) { a.classList.toggle('sel', a.dataset.vehicle === String(i)); });
      var link = v.farm ? '/farming/hof/' + v.farm.id + '?tab=fahrzeuge' + (v.pallet ? '&paletten=1' : '') + '#v-' + encodeURIComponent(v.uid || i) : null;
      var h = '<h2>' + esc(v.name) + '</h2><div class="fs-rows">' + row('Art', esc(v.cat || (v.pallet ? 'Palette' : '–'))) +
        row('Hof', v.farm ? '<a href="/farming/hof/' + v.farm.id + '">' + esc(v.farm.name) + '</a>' : '–') + row('Lage', esc(v.where)) +
        (v.driver ? row('Fährt', esc(v.driver)) : v.ai ? row('Fährt', 'Helfer') : '') +
        (v.damage !== null ? row('Verschleiß', v.damage + ' %') : '') + (v.hours !== null ? row('Betriebsstunden', de(v.hours, 1)) : '') +
        (v.diesel !== null ? row('Diesel', de(v.diesel) + ' l') : '') + '</div>';
      if (v.fill.length) h += '<div class="chips">' + v.fill.map(function (f) { return '<span class="chip">' + f.icon + esc(f.name) + ' ' + de(f.amount) + ' l</span>'; }).join('') + '</div>';
      if (link) h += '<div class="row"><a class="btn small" href="' + link + '">Im Hof ansehen</a></div>';
      show(h, ['fahrzeug', i]);
      return v;
    };
    var clickable = function (sel, fn) {
      map.querySelectorAll(sel).forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); if (!moved) fn(a); });
      });
    };
    clickable('a[data-field]', function (a) { selectField(Number(a.dataset.field)); });
    clickable('a[data-station]', function (a) { selectStation(a.dataset.station); });
    clickable('a[data-vehicle]', function (a) { selectVehicle(Number(a.dataset.vehicle)); });
    info.addEventListener('click', function (e) {
      var go = e.target.closest('[data-goto-station]');
      if (go) { e.preventDefault(); var s = selectStation(go.dataset.gotoStation); if (s && s.cx !== null) focus(s.cx, s.cy, Math.min(vb[2], 200)); return; }
      if (!e.target.closest('[data-close]')) return;
      e.preventDefault();
      info.hidden = true;
      unselect();
      url(null, null);
    });
    // Auswahl aus der Adresse: hinzoomen (Grundstück, ?station=, ?fahrzeug=)
    var pick = json('fs-pick');
    var pre = map.querySelector('.fld.sel');
    if (pre && pre.getBBox) {
      var bb = pre.getBBox();
      focus(bb.x + bb.width / 2, bb.y + bb.height / 2, Math.max(160, bb.width * 4, bb.height * 4));
      selectField(Number(pre.parentNode.dataset.field));
    } else if (pick && pick.station && stations[pick.station]) {
      var s0 = selectStation(pick.station);
      if (s0.cx !== null) focus(s0.cx, s0.cy, 220);
    } else if (pick && pick.vehicle !== '' && vehicles[Number(pick.vehicle)]) {
      var v0 = selectVehicle(Number(pick.vehicle));
      var c = document.querySelector('[data-show=' + (v0.pallet ? 'pal' : 'veh') + ']');
      if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); }
      focus(v0.cx, v0.cy, 160);
    }

    // Kartenbild ausrichten (Admins): Vorschau sofort, gespeichert wird mit dem Formular
    var fitForm = document.querySelector('[data-fit-form]'), mapImg = document.getElementById('fs-mapimg');
    if (fitForm && mapImg) {
      var size = Number(map.dataset.size) || 2048, base = Number(map.dataset.base) || 1000;
      var preview = function () {
        var v = function (k) { return Number(fitForm.querySelector('input[name=' + k + ']').value) || 0; };
        var w = base * (v('scale') || 100) / 100;
        mapImg.setAttribute('width', w); mapImg.setAttribute('height', w);
        mapImg.setAttribute('x', 500 - w / 2 + v('dx') / size * 1000); mapImg.setAttribute('y', 500 - w / 2 + v('dz') / size * 1000);
      };
      fitForm.querySelectorAll('[data-fit]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          fitForm.querySelectorAll('[data-fit="' + inp.dataset.fit + '"]').forEach(function (o) { if (o !== inp) o.value = inp.value; });
          preview();
        });
      });
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
  // ---------- Suche in Planer und Preisliste: filtert schon beim Tippen, Enter fragt den Server ----------
  [].forEach.call(document.querySelectorAll('input[data-filter]'), function (input) {
    var box = document.querySelector(input.dataset.filter);
    if (!box) return;
    var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var run = function () {
      var words = norm(input.value).split(/\s+/).filter(Boolean), shown = 0;
      [].forEach.call(box.querySelectorAll('[data-q]'), function (el) {
        var hit = words.every(function (w) { return el.dataset.q.indexOf(w) >= 0; });
        el.hidden = !hit;
        if (hit) shown++;
      });
      // Gruppen ohne Treffer weg, mit Treffern beim Suchen aufklappen
      [].forEach.call(box.querySelectorAll('details'), function (d) {
        var any = d.querySelector('[data-q]:not([hidden])');
        d.hidden = !any;
        if (words.length && any) d.open = true;
      });
      var none = box.querySelector('.pl-none');
      if (none) none.hidden = shown > 0;
    };
    input.addEventListener('input', run);
    if (input.value) run();
  });
})();
