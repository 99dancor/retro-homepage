// Farming Simulator Hub, Karte: Feldumrisse für Admins (views/fshub/map.ejs, Abschnitt „Feldumrisse“).
//   Erkennen: Felder ohne Form (Kreise) im Kartenbild suchen (public/fsdetect.js), Vorschau gelb, dann übernehmen.
//   Bearbeiten: Punkte ziehen, Klick auf die Mitte einer Kante fügt einen Punkt ein, Doppelklick auf einen Punkt löscht ihn.
//   Neu zeichnen: Punkt für Punkt klicken, Speichern schließt den Umriss. „Automatisch“ nimmt den eigenen Umriss wieder weg.
// Gespeichert wird in Weltkoordinaten (POST /farming/umrisse), die Seite lädt danach neu.
(function () {
  'use strict';
  var map = document.getElementById('fs-map'), panel = document.getElementById('fs-umriss'), dataEl = document.getElementById('fs-umriss-data');
  if (!map || !panel || !dataEl || !window.FSDetect) return;
  var D = JSON.parse(dataEl.textContent), S = D.size, NS = 'http://www.w3.org/2000/svg';
  var csrf = panel.dataset.csrf || '';
  var byId = {};
  D.fields.forEach(function (f) { byId[f.id] = f; });
  var $ = function (k) { return panel.querySelector('[data-umriss="' + k + '"]'); };
  var part = function (k) { return panel.querySelector('[data-umriss-' + k + ']'); };
  var el = function (tag, a, parent) { var e = document.createElementNS(NS, tag); for (var k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; };
  var layer = el('g', { class: 'umr' }, map);
  var world = function (p) { return [Math.round((p[0] / 1000 * S - S / 2) * 10) / 10, Math.round((p[1] / 1000 * S - S / 2) * 10) / 10]; };
  var toMap = function (e) { var m = map.getScreenCTM(); var p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return [p.x, p.y]; };
  var dPath = function (pts) { return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z'; };
  var say = function (k, t) { var n = part(k); if (n) n.textContent = t; };
  var post = function (url, data) {
    var body = new URLSearchParams({ _csrf: csrf });
    if (data) body.set('data', JSON.stringify(data));
    return fetch(url, { method: 'POST', body: body, credentials: 'same-origin' }).then(function (r) { return r.json(); });
  };
  var reload = function (id) {
    var u = new URL(location.href);
    if (id) u.searchParams.set('feld', id); else u.searchParams.delete('feld');
    u.searchParams.delete('ok');
    location.href = u.toString();
  };

  // Stand: woher die Formen kommen
  var NAMES = { karte: 'aus der Karte', boden: 'aus dem Feldboden', bild: 'aus dem Bild erkannt', hand: 'von Hand', kreis: 'ohne Form (Kreis)' };
  var counts = {};
  D.fields.forEach(function (f) { counts[f.src] = (counts[f.src] || 0) + 1; });
  say('stat', Object.keys(NAMES).filter(function (k) { return counts[k]; }).map(function (k) { return counts[k] + ' ' + NAMES[k]; }).join(' · '));
  if (!counts.bild) $('bildweg').hidden = true;

  // ---------- Erkennen ----------
  var found = null;
  $('erkennen').addEventListener('click', function () {
    if (!D.img) { say('msg', 'Erst ein Kartenbild hochladen (Seitenverwaltung).'); part('preview').hidden = false; return; }
    var all = part('alle').checked;
    say('msg', 'Erkenne Felder im Kartenbild …');
    part('preview').hidden = false;
    $('uebernehmen').hidden = true;
    var img = new Image();
    img.onload = function () {
      setTimeout(function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        var cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        var data = cx.getImageData(0, 0, cv.width, cv.height);
        var ppu = cv.width / D.img.w, mpp = S / 1000 / ppu;
        var seeds = D.fields.filter(function (f) { return all ? f.src !== 'hand' : f.src === 'kreis'; }).map(function (f) {
          var px = (f.ha > 0 ? f.ha : 15) * 10000 / (mpp * mpp);
          return { id: f.id, x: (f.cx - D.img.off) * ppu, y: (f.cy - D.img.off) * ppu, max: px * 1.15, min: Math.max(25, px * 0.08) };
        });
        var res = window.FSDetect.detect(data, seeds);
        layer.innerHTML = '';
        found = {};
        var n = 0;
        Object.keys(res).forEach(function (id) {
          var pts = res[id].map(function (p) { return [D.img.off + p[0] / ppu, D.img.off + p[1] / ppu]; });
          el('path', { d: dPath(pts), class: 'umr-prev' }, layer);
          found[id] = pts.map(world);
          n++;
        });
        say('msg', seeds.length ? n + ' von ' + seeds.length + ' Feldern erkannt (gelb gestrichelt). Was nicht passt, danach von Hand korrigieren.' : 'Alle Felder haben schon eine Form.');
        $('uebernehmen').hidden = !n;
      }, 30);
    };
    img.onerror = function () { say('msg', 'Das Kartenbild ließ sich nicht laden.'); };
    img.src = D.img.src;
  });
  $('uebernehmen').addEventListener('click', function () {
    if (!found) return;
    say('msg', 'Speichere …');
    post('/farming/umrisse', { fields: found, source: 'bild' }).then(function () { reload(); }, function () { say('msg', 'Speichern ging nicht.'); });
  });
  $('verwerfen').addEventListener('click', function () { found = null; layer.innerHTML = ''; part('preview').hidden = true; });
  $('bildweg').addEventListener('click', function () {
    if (!confirm('Alle aus dem Bild erkannten Umrisse löschen? Von Hand gezeichnete bleiben.')) return;
    post('/farming/umrisse/bild/loeschen').then(function () { reload(); });
  });

  // ---------- Bearbeiten und Zeichnen ----------
  var sel = null, mode = null, pts = [], drag = null;
  var selected = function () { var a = map.querySelector('.fld.sel'); return a ? Number(a.parentNode.dataset.field) : null; };
  var showSel = function () {
    sel = selected();
    say('sel', sel ? 'Feld ' + sel + ': ' + NAMES[(byId[sel] || {}).src || 'kreis'] : 'Erst ein Feld auf der Karte anklicken.');
    ['bearbeiten', 'zeichnen'].forEach(function (k) { $(k).disabled = !sel || !!mode; });
    $('auto').disabled = !sel || !!mode || ['hand', 'bild'].indexOf((byId[sel] || {}).src) < 0;
  };
  var down = null;   // Klick nach Verschieben der Karte ist kein neuer Punkt
  map.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; }, true);
  map.addEventListener('click', function (e) {
    if (mode === 'draw') {
      e.preventDefault(); e.stopPropagation();
      if ((drag && drag.moved) || (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)) return;
      pts.push(toMap(e));
      draw();
      return;
    }
    if (mode) { e.preventDefault(); e.stopPropagation(); return; }
    setTimeout(showSel, 0);
  }, true);
  document.getElementById('fs-finfo').addEventListener('click', function () { setTimeout(showSel, 0); });
  // Punkte aus der Form des Felds (Pfad oder Kreis)
  var shapeOf = function (id) {
    var a = map.querySelector('a[data-field="' + id + '"] .fld');
    if (!a) return [];
    if (a.tagName === 'circle') {
      var cx = +a.getAttribute('cx'), cy = +a.getAttribute('cy'), r = +a.getAttribute('r'), out = [];
      for (var i = 0; i < 8; i++) out.push([cx + r * Math.cos(i * Math.PI / 4), cy + r * Math.sin(i * Math.PI / 4)]);
      return out;
    }
    return (a.getAttribute('d').match(/-?[\d.]+\s+-?[\d.]+/g) || []).map(function (s) { var v = s.trim().split(/\s+/); return [+v[0], +v[1]]; });
  };
  var handleR = function () { var vb = map.viewBox.baseVal; return Math.max(0.6, vb.width / 180); };
  var draw = function () {
    layer.innerHTML = '';
    if (!mode) return;
    var r = handleR();
    if (pts.length > 1) el(mode === 'draw' ? 'polyline' : 'path', mode === 'draw' ? { points: pts.map(function (p) { return p.join(','); }).join(' '), class: 'umr-edit' } : { d: dPath(pts), class: 'umr-edit' }, layer);
    if (mode === 'edit') {
      pts.forEach(function (p, i) {
        var q = pts[(i + 1) % pts.length];
        el('circle', { cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2, r: r * 0.7, class: 'umr-mid', 'data-mid': i }, layer);
      });
    }
    pts.forEach(function (p, i) { el('circle', { cx: p[0], cy: p[1], r: r, class: 'umr-pt' + (i === 0 && mode === 'draw' ? ' first' : ''), 'data-pt': i }, layer); });
    $('speichern').disabled = pts.length < 3;
  };
  new MutationObserver(function () { if (mode) draw(); }).observe(map, { attributes: true, attributeFilter: ['viewBox'] });
  layer.addEventListener('pointerdown', function (e) {
    var t = e.target, i;
    if (t.dataset.mid !== undefined) { i = Number(t.dataset.mid) + 1; pts.splice(i, 0, toMap(e)); }
    else if (t.dataset.pt !== undefined) i = Number(t.dataset.pt);
    else return;
    e.stopPropagation(); e.preventDefault();
    if (mode === 'draw' && i === 0 && pts.length >= 3) { save(); return; }
    drag = { i: i, moved: false };
    draw();
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    drag.moved = true;
    pts[drag.i] = toMap(e);
    draw();
  });
  window.addEventListener('pointerup', function () { if (drag) setTimeout(function () { drag = null; }, 0); });
  layer.addEventListener('dblclick', function (e) {
    var i = e.target.dataset.pt;
    if (i === undefined || pts.length <= 3) return;
    e.stopPropagation();
    pts.splice(Number(i), 1);
    draw();
  });
  var start = function (m) {
    if (!sel) return;
    mode = m;
    pts = m === 'edit' ? shapeOf(sel) : [];
    map.classList.add('umr-on');
    document.getElementById('fs-finfo').hidden = true;   // die Infokarte läge sonst über dem Feld
    part('edit').hidden = false;
    say('hint', m === 'edit' ? 'Punkte ziehen · Klick auf einen kleinen Punkt fügt dort einen ein · Doppelklick löscht einen Punkt' : 'Rund um das Feld Punkt für Punkt klicken. Klick auf den ersten Punkt oder Speichern schließt den Umriss.');
    showSel(); draw();
  };
  var stop = function () { mode = null; pts = []; map.classList.remove('umr-on'); part('edit').hidden = true; draw(); showSel(); };
  var save = function () {
    if (!sel || pts.length < 3) return;
    var f = {};
    f[sel] = pts.map(world);
    post('/farming/umrisse', { fields: f, source: 'hand' }).then(function () { reload(sel); }, function () { say('hint', 'Speichern ging nicht.'); });
  };
  $('bearbeiten').addEventListener('click', function () { start('edit'); });
  $('zeichnen').addEventListener('click', function () { start('draw'); });
  $('speichern').addEventListener('click', save);
  $('abbrechen').addEventListener('click', stop);
  $('auto').addEventListener('click', function () { if (sel) post('/farming/umrisse/' + sel + '/loeschen').then(function () { reload(sel); }); });
  document.addEventListener('keydown', function (e) { if (mode && e.key === 'Escape') stop(); });
  showSel();
})();
