// Farming Simulator Hub, Karte: Stationen setzen für Admins (views/fshub/map.ejs, Abschnitt „Stationen setzen“).
//   Station wählen, „Setzen“, dann auf die Karte klicken: gespeichert wird sofort (POST /farming/stationen, Weltkoordinaten),
//   das Symbol springt an die Stelle und die nächste Station ohne Position ist dran. Esc oder „Fertig“ hört auf.
//   Ein Klick auf ein Symbol wählt die Station hier aus, so lässt sie sich neu setzen oder entfernen.
(function () {
  'use strict';
  var map = document.getElementById('fs-map'), panel = document.getElementById('fs-stset'), dataEl = document.getElementById('fs-stations');
  if (!map || !panel || !dataEl) return;
  var S = (JSON.parse((document.getElementById('fs-umriss-data') || {}).textContent || '{}').size) || 2048;
  var list = JSON.parse(dataEl.textContent), byUid = {};
  list.forEach(function (s) { byUid[s.uid] = s; });
  var pick = panel.querySelector('[data-st-pick]'), btnSet = panel.querySelector('[data-st="setzen"]'), btnDel = panel.querySelector('[data-st="weg"]');
  var msg = panel.querySelector('[data-st-msg]'), csrf = panel.dataset.csrf || '';
  var placing = false, down = null;
  var marker = function (uid) { return map.querySelector('.st[data-station="' + uid + '"]'); };
  var label = function (s) { return s.name + (s.cx !== null ? ' ✔' : ''); };
  var say = function (t) { msg.textContent = t; };
  var count = function () { return list.filter(function (s) { return s.cx !== null; }).length; };
  var post = function (data) {
    var body = new URLSearchParams({ _csrf: csrf });
    Object.keys(data).forEach(function (k) { body.set(k, data[k]); });
    return fetch('/farming/stationen', { method: 'POST', body: body, credentials: 'same-origin' }).then(function (r) { return r.json(); });
  };
  var mark = function () { map.querySelectorAll('.st').forEach(function (a) { a.classList.toggle('sel', a.dataset.station === pick.value); }); };
  var status = function () {
    var s = byUid[pick.value];
    btnDel.disabled = !s || s.cx === null;
    btnSet.textContent = placing ? 'Fertig' : 'Setzen';
    if (placing && s) say('Klick auf die Karte setzt „' + s.name + '“ (' + s.catLabel + '). ' + count() + ' von ' + list.length + ' gesetzt.');
    else if (!placing) say(count() + ' von ' + list.length + ' Stationen haben eine Position.');
    mark();
  };
  var next = function () {
    var opts = [].slice.call(pick.options), i = pick.selectedIndex;
    var later = opts.slice(i + 1).concat(opts.slice(0, i + 1)).filter(function (o) { return !o.disabled && byUid[o.value].cx === null; });
    if (later.length) pick.value = later[0].value; else stop('Alle Stationen haben eine Position.');
  };
  var start = function () { if (!byUid[pick.value]) return; placing = true; map.classList.add('st-placing'); status(); };
  var stop = function (text) { placing = false; map.classList.remove('st-placing'); status(); if (text) say(text); };
  var put = function (s, cx, cy) {
    s.cx = cx; s.cy = cy;
    var a = marker(s.uid);
    if (a) { a.setAttribute('transform', cx === null ? 'translate(500 500)' : 'translate(' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')'); a.classList.toggle('unplaced', cx === null); }
    var o = [].find.call(pick.options, function (x) { return x.value === s.uid; });
    if (o) o.textContent = label(s);
  };

  btnSet.addEventListener('click', function () { if (placing) stop(); else start(); });
  btnDel.addEventListener('click', function () {
    var s = byUid[pick.value];
    if (!s || s.cx === null) return;
    post({ uid: s.uid, clear: '1' }).then(function (r) {
      if (!r.ok) return say(r.error || 'Hat nicht geklappt.');
      put(s, null, null); status(); say('„' + s.name + '“ hat keine Position mehr.');
    }).catch(function () { say('Keine Verbindung, nichts geändert.'); });
  });
  pick.addEventListener('change', status);

  // Klick auf die Karte: im Setzen-Modus die Position, sonst wählt ein Klick auf ein Symbol die Station hier aus
  map.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; }, true);
  map.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.st');
    if (!placing) { if (a && byUid[a.dataset.station] && !byUid[a.dataset.station].fixed) { pick.value = a.dataset.station; status(); } return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;   // Karte verschoben, kein Klick
    var s = byUid[pick.value];
    if (!s) return;
    var p = new DOMPoint(e.clientX, e.clientY).matrixTransform(map.getScreenCTM().inverse());
    var x = Math.round((p.x / 1000 * S - S / 2) * 10) / 10, z = Math.round((p.y / 1000 * S - S / 2) * 10) / 10;
    post({ uid: s.uid, x: x, z: z }).then(function (r) {
      if (!r.ok) return say(r.error || 'Hat nicht geklappt.');
      put(s, p.x, p.y);
      next();
      if (placing) status();
    }).catch(function () { say('Keine Verbindung, nichts gespeichert.'); });
  }, true);
  document.addEventListener('keydown', function (e) { if (placing && e.key === 'Escape') stop(); });

  // Zu Beginn die erste Station ohne Position vorschlagen
  var first = list.find(function (s) { return s.cx === null && !s.fixed; });
  if (first) pick.value = first.uid;
  status();
})();
