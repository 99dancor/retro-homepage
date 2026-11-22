// Dioramen: Spielstand gestalten (views/v3/diorama.ejs, _dio-tile.ejs; Speichern über POST /dioramen/<slug>/kacheln).
// Kacheln am ⠿ verschieben, an den Griffen Breite und Höhe ändern, aus der Leiste neue Kacheln aufs Raster ziehen oder antippen,
// Inhalt über ⚙, Bauwerke anlegen, umbenennen, einfärben und löschen, Punkte auf Karten setzen. Rückgängig über einen Stapel.
// Das Raster hat 12 Spalten und Reihen zu 40 px (+14 px Abstand). Kacheln, die sich überdecken, rutschen nach unten,
// Lücken bleiben (dieselbe Regel wie settle() in src/dioramen.js). Wie eine Kachel aussieht, rechnet der Server
// (POST …/kacheln/vorschau), so sieht sie beim Gestalten genau aus wie danach.
(function () {
  'use strict';
  var dataEl = document.getElementById('dio-data');
  var grid = document.getElementById('kg');
  if (!dataEl || !grid) return;
  var D = JSON.parse(dataEl.textContent);
  var csrf = document.body.getAttribute('data-csrf') || '';
  var base = '/dioramen/' + D.slug;
  var bar = document.querySelector('.dio-bar'), pal = document.querySelector('.dio-pal'), bwBox = document.getElementById('dio-bws');
  var COLS = 12, ROW = 54, GAP = 14, MAX_H = 40;
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var state = { tiles: clone(D.tiles), buildings: clone(D.buildings) };
  var saved = JSON.stringify(state), undo = [], on = false, busy = false;
  var CONTENT = { text: 1, img: 1, cmp: 1, gal: 1, map: 1, video: 1, facts: 1 };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var tile = function (id) { for (var i = 0; i < state.tiles.length; i++) if (state.tiles[i].id === id) return state.tiles[i]; return null; };
  var bld = function (id) { for (var i = 0; i < state.buildings.length; i++) if (state.buildings[i].id === id) return state.buildings[i]; return null; };
  var elOf = function (id) { return document.getElementById('k-' + id); };
  var clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };
  var nextId = function (list, p) { var n = 0; list.forEach(function (x) { n = Math.max(n, Number(String(x.id).slice(1)) || 0); }); return p + (n + 1); };
  var bottom = function () { var n = 1; state.tiles.forEach(function (t) { n = Math.max(n, t.y + t.h); }); return n; };
  var narrow = function () { return window.innerWidth <= 760; };

  // ---------- Raster ----------
  var hit = function (a, y, b) { return a.x < b.x + b.w && b.x < a.x + a.w && y < b.y + b.h && b.y < y + a.h; };
  // fixed bleibt, wo es ist; wer etwas überdeckt, rutscht nach unten
  var settleIn = function (list, fixed) {
    var placed = [];
    list.slice().sort(function (a, b) { if (a.id === fixed) return -1; if (b.id === fixed) return 1; return a.y - b.y || a.x - b.x; }).forEach(function (t) {
      if (t.id !== fixed) { var y = t.y; while (placed.some(function (p) { return hit(t, y, p); })) y++; t.y = y; }
      placed.push(t);
    });
  };
  var place = function (el, t) { el.style.gridColumn = t.x + ' / span ' + t.w; el.style.gridRow = t.y + ' / span ' + t.h; };
  // Farbiger Rahmen je Bauwerk: umschließt alle seine Kacheln (wie frames() im Server)
  var updateFrames = function () {
    var want = {};
    state.buildings.forEach(function (b) {
      if (b.frame === false) return;
      var ts = state.tiles.filter(function (t) { return t.bw === b.id; });
      if (!ts.length) return;
      var x0 = 99, y0 = 1e9, x1 = 0, y1 = 0;
      ts.forEach(function (t) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h); });
      want[b.id] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, hex: D.colors[b.color] };
    });
    grid.querySelectorAll('.bwframe').forEach(function (f) { if (!want[f.getAttribute('data-frame')]) f.remove(); });
    Object.keys(want).forEach(function (id) {
      var f = grid.querySelector('.bwframe[data-frame="' + id + '"]');
      if (!f) { f = document.createElement('div'); f.className = 'bwframe'; f.setAttribute('data-frame', id); f.setAttribute('aria-hidden', 'true'); grid.insertBefore(f, grid.firstChild); }
      place(f, want[id]); f.style.setProperty('--bwc', want[id].hex);
    });
  };
  var applyAll = function (skip) { state.tiles.forEach(function (t) { var el = elOf(t.id); if (el && t.id !== skip) place(el, t); }); updateFrames(); };

  // ---------- Zustand, Rückgängig, Speichern ----------
  var stateText = bar && bar.querySelector('.dio-state');
  var dirty = function () { return JSON.stringify(state) !== saved; };
  var mark = function () {
    if (!bar) return;
    bar.querySelector('[data-k=undo]').disabled = !undo.length;
    stateText.textContent = busy ? 'Speichere …' : dirty() ? 'nicht gespeichert' : '';
  };
  var snap = function () { undo.push(JSON.stringify(state)); if (undo.length > 60) undo.shift(); mark(); };
  var post = function (url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'Das hat nicht geklappt (' + r.status + ').'); return j; }); });
  };
  var say = function (msg) { if (stateText) { stateText.textContent = msg; setTimeout(mark, 4000); } };
  // Kacheln neu zeichnen lassen (ohne ids: alle, in der Reihenfolge des Rasters)
  var render = function (ids) {
    return post(base + '/kacheln/vorschau', { tiles: state.tiles, buildings: state.buildings, only: ids || undefined }).then(function (j) {
      if (!ids) {
        grid.innerHTML = state.tiles.map(function (t) { return j.html[t.id] || ''; }).join('');
      } else ids.forEach(function (id) {
        var old = elOf(id), html = j.html[id];
        if (!html) { if (old) old.remove(); return; }
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        if (old) old.replaceWith(tmp.firstElementChild); else grid.appendChild(tmp.firstElementChild);
      });
      applyAll();
      if (window.DioUI) window.DioUI.initCmp(grid);
      renderBws();
    }).catch(function (e) { say('⚠ ' + e.message); });
  };
  var restore = function () { if (!undo.length) return; state = JSON.parse(undo.pop()); render(); mark(); };

  var start = function () {
    if (on) return;
    on = true;
    document.body.classList.add('dio-ed');
    bar.hidden = false; pal.hidden = false;
    if (narrow()) bar.querySelector('.hint').textContent = 'Am Handy änderst du Inhalte und Bauwerke. Verschieben und Größe ändern gehen am großen Bildschirm.';
    renderBws();
    mark();
  };
  var stop = function (href) { on = false; window.removeEventListener('beforeunload', warn); location.href = href || base; };
  var warn = function (e) { if (on && dirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  var save = function () {
    if (busy) return;
    busy = true; mark();
    post(base + '/kacheln', state).then(function () { saved = JSON.stringify(state); busy = false; stop(base + '?ok=gespeichert'); })
      .catch(function (e) { busy = false; mark(); say('⚠ ' + e.message); });
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-k]');
    if (!b || b.tagName === 'SELECT') return;
    var k = b.getAttribute('data-k');
    if (k === 'start') { e.preventDefault(); start(); }
    else if (k === 'save') save();
    else if (k === 'undo') restore();
    else if (k === 'cancel') { if (!dirty() || window.confirm('Änderungen verwerfen?')) stop(base); }
    else if (k === 'bw-add') editBuilding(null);
    else if (!on) return;
    else if (k === 'cfg') configure(b.closest('.kt').getAttribute('data-id'));
    else if (k === 'del') removeTile(b.closest('.kt').getAttribute('data-id'));
  });

  // ---------- Kacheln auswählen, Bauwerk wählen, löschen ----------
  grid.addEventListener('click', function (e) {
    if (!on) return;
    var k = e.target.closest('.kt');
    if (e.target.closest('a')) e.preventDefault();
    grid.querySelectorAll('.kt.sel').forEach(function (x) { if (x !== k) x.classList.remove('sel'); });
    if (k) k.classList.add('sel');
  });
  grid.addEventListener('change', function (e) {
    var s = e.target.closest('select[data-k=bw]');
    if (!s) return;
    var t = tile(s.closest('.kt').getAttribute('data-id'));
    if (t.type === 'head' && !s.value) { s.value = t.bw; say('Eine Überschrift gehört immer zu einem Bauwerk.'); return; }
    snap();
    t.bw = s.value || null;
    render();
  });
  var removeTile = function (id) {
    snap();
    state.tiles = state.tiles.filter(function (t) { return t.id !== id; });
    state.tiles.forEach(function (t) { (t.points || []).forEach(function (p) { if (p.to === id) p.to = ''; }); });
    var el = elOf(id); if (el) el.remove();
    settleIn(state.tiles, null); applyAll(); mark();
  };

  // ---------- Ziehen: verschieben und Größe ändern ----------
  var ghost = document.createElement('div'); ghost.className = 'kghost';
  var badge = document.createElement('div'); badge.className = 'ksize'; badge.hidden = true; document.body.appendChild(badge);
  var metrics = function () { var r = grid.getBoundingClientRect(); return { left: r.left, top: r.top, colW: (r.width + GAP) / COLS }; };
  var cellAt = function (e, m) { return { c: Math.floor((e.clientX - m.left) / m.colW) + 1, r: Math.floor((e.clientY - m.top) / ROW) + 1 }; };
  var drag = function (t, mode, e0, grab, isNew) {
    var el = elOf(t.id), m = metrics(), c0 = cellAt(e0, m);
    var gc = grab ? grab.c : c0.c - t.x, gr = grab ? grab.r : c0.r - t.y;
    var startPos = {}, before = JSON.stringify(state), lastY = e0.clientY;
    state.tiles.forEach(function (x) { startPos[x.id] = { x: x.x, y: x.y }; });
    el.classList.add('drag', 'sel');
    grid.appendChild(ghost);
    var final = null;
    var step = function (ev) {
      m = metrics();
      var c = cellAt(ev, m);
      state.tiles.forEach(function (x) { if (x !== t && startPos[x.id]) { x.x = startPos[x.id].x; x.y = startPos[x.id].y; } });
      if (mode === 'move') { t.x = clamp(c.c - gc, 1, COLS - t.w + 1); t.y = Math.max(1, c.r - gr); }
      else {
        if (mode !== 'b') t.w = clamp(c.c - t.x + 1, 1, COLS - t.x + 1);
        if (mode !== 'r') t.h = clamp(c.r - t.y + 1, 1, MAX_H);
        badge.hidden = false; badge.textContent = t.w + ' × ' + t.h;
        badge.style.left = (ev.clientX + 14) + 'px'; badge.style.top = (ev.clientY + 14) + 'px';
      }
      var held = { x: t.x, y: t.y };
      settleIn(state.tiles, t.id);
      settleIn(state.tiles, null);
      final = { x: t.x, y: t.y };
      place(ghost, t);
      applyAll(t.id);
      place(el, { x: held.x, y: held.y, w: t.w, h: t.h });
      t.x = final.x; t.y = final.y;
      lastY = ev.clientY;
    };
    var scroller = setInterval(function () {
      if (lastY < 70) window.scrollBy(0, -18); else if (lastY > window.innerHeight - 50) window.scrollBy(0, 18);
    }, 30);
    var move = function (ev) { ev.preventDefault(); step(ev); };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      clearInterval(scroller);
      el.classList.remove('drag');
      ghost.remove(); badge.hidden = true;
      applyAll();
      if (!isNew && JSON.stringify(state) === before) { undo.pop(); }
      mark();
      if (isNew) render([t.id]).then(function () { if (CONTENT[t.type]) configure(t.id); });
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    step(e0);
  };
  grid.addEventListener('pointerdown', function (e) {
    if (!on || narrow() || e.button > 0) return;
    var h = e.target.closest('[data-k=move], [data-rz]');
    if (!h) return;
    e.preventDefault();
    var t = tile(h.closest('.kt').getAttribute('data-id'));
    snap();
    drag(t, h.hasAttribute('data-rz') ? h.getAttribute('data-rz') : 'move', e);
  });

  // ---------- Neue Kacheln aus der Leiste ----------
  var DEFAULTS = { text: { title: '', md: '' }, img: { f: null, cap: '', fit: 'cover' }, cmp: { before: null, after: null }, gal: { imgs: [] }, map: { f: null, points: [] }, video: { url: '', cap: '' }, facts: { title: '', rows: [] } };
  var TYPES = D.types;
  var newTile = function (type, extra) {
    var T = TYPES[type], t = { id: nextId(state.tiles, 't'), type: type, x: 1, y: bottom(), w: T.w, h: T.h, bw: null };
    var d = DEFAULTS[type] || {};
    Object.keys(d).forEach(function (k) { t[k] = clone(d[k]); });
    if (extra) Object.keys(extra).forEach(function (k) { t[k] = extra[k]; });
    state.tiles.push(t);
    var el = document.createElement('div');
    el.className = 'kt k-' + type + ' empty show'; el.id = 'k-' + t.id; el.setAttribute('data-id', t.id);
    el.innerHTML = '<div class="kph"><span class="emo">' + esc(T.icon) + '</span><b>' + esc(T.label) + '</b></div>';
    place(el, t);
    grid.appendChild(el);
    return t;
  };
  if (pal) pal.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('[data-add]');
    if (!b || !on || e.button > 0) return;
    e.preventDefault();
    var type = b.getAttribute('data-add'), x0 = e.clientX, y0 = e.clientY, started = false;
    var move = function (ev) {
      if (started || narrow() || Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 8) return;
      started = true; cleanup();
      snap();
      var t = newTile(type);
      drag(t, 'move', ev, { c: Math.floor(t.w / 2), r: 0 }, true);
    };
    var up = function () {
      cleanup();
      if (started) return;
      snap();
      var t = newTile(type);
      settleIn(state.tiles, null); applyAll(); mark();
      elOf(t.id).scrollIntoView({ behavior: 'smooth', block: 'center' });
      render([t.id]).then(function () { if (CONTENT[t.type]) configure(t.id); });
    };
    var cleanup = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ---------- Dialoge ----------
  var dialog = function (title, body, onOk, small) {
    var d = document.createElement('dialog');
    d.className = 'kdlg' + (small ? ' small' : '');
    d.innerHTML = '<form method="dialog"><div class="hd"><b></b><button type="button" class="pill small" value="x" data-x aria-label="Schließen">✕</button></div><div class="bdy"></div>'
      + '<div class="ft"><button type="button" class="pill" data-x>Abbrechen</button><button class="pill pri" value="ok">✔ Übernehmen</button></div></form>';
    d.querySelector('.hd b').textContent = title;
    d.querySelector('.bdy').appendChild(body);
    document.body.appendChild(d);
    d.querySelectorAll('[data-x]').forEach(function (x) { x.addEventListener('click', function () { d.close(); }); });
    d.querySelector('form').addEventListener('submit', function (e) {
      if (e.submitter && e.submitter.value !== 'ok') return;
      if (onOk() === false) e.preventDefault();
    });
    d.addEventListener('close', function () { d.remove(); });
    d.showModal();
    return d;
  };
  var html = function (s) { var w = document.createElement('div'); w.innerHTML = s; return w; };
  var field = function (label, input, hint) { return '<label class="f">' + label + (hint ? ' <small>' + hint + '</small>' : '') + input + '</label>'; };

  // Bildauswahl aus den Bildern des Spielstands, mit Hochladen. multi: Reihenfolge = Klickreihenfolge
  var picker = function (multi, selected, onChange) {
    var sel = (selected || []).filter(Boolean).slice();
    var box = document.createElement('div'); box.className = 'kpick';
    var draw = function () {
      box.innerHTML = D.images.map(function (im) {
        var i = sel.indexOf(im.f);
        return '<button type="button" data-f="' + esc(im.f) + '" class="' + (i >= 0 ? 'on' : '') + '" title="' + esc(im.cap) + '"><img src="/media/' + esc(im.f) + '" alt="" loading="lazy">' + (multi && i >= 0 ? '<span class="n">' + (i + 1) + '</span>' : '') + '</button>';
      }).join('') + '<label class="up2"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple><span>📥 Bilder<br>hochladen</span></label>';
    };
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]');
      if (!b) return;
      var f = b.getAttribute('data-f'), i = sel.indexOf(f);
      if (multi) { if (i >= 0) sel.splice(i, 1); else sel.push(f); } else sel = i >= 0 ? [] : [f];
      draw(); if (onChange) onChange(sel);
    });
    box.addEventListener('change', function (e) {
      if (!e.target.files || !e.target.files.length) return;
      var fd = new FormData(); fd.append('_csrf', csrf);
      Array.prototype.forEach.call(e.target.files, function (f) { fd.append('images', f); });
      var lab = box.querySelector('.up2 span'); lab.textContent = 'Lädt hoch …';
      fetch(base + '/bilder', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'Hochladen fehlgeschlagen'); return j; }); })
        .then(function (j) {
          D.images = j.images;
          if (multi) sel = sel.concat(j.added); else if (j.added[0]) sel = [j.added[0]];
          draw(); if (onChange) onChange(sel);
        })
        .catch(function (err) { lab.textContent = '⚠ ' + err.message; });
    });
    draw();
    return { el: box, get: function () { return sel.slice(); } };
  };
  var labelOf = function (t) {
    var T = TYPES[t.type], b = t.bw && bld(t.bw);
    var name = t.title || t.cap || '';
    return T.label + (name ? ': ' + name : '') + (b ? ' (' + b.name + ')' : '');
  };

  var configure = function (id) {
    var t = tile(id);
    if (!t) return;
    var T = TYPES[t.type], body, ok;
    if (t.type === 'text') {
      body = html(field('Überschrift', '<input type="text" name="title" maxlength="120">', 'freiwillig')
        + field('Text', '<textarea name="md" rows="12"></textarea>', 'Markdown: **fett**, *schräg*, „- “ für Listen, [Link](https://…)'));
      body.querySelector('[name=title]').value = t.title || '';
      body.querySelector('[name=md]').value = t.md || '';
      ok = function () { t.title = body.querySelector('[name=title]').value; t.md = body.querySelector('[name=md]').value; };
    } else if (t.type === 'img') {
      var p1 = picker(false, [t.f]);
      body = html(field('Unterschrift', '<input type="text" name="cap" maxlength="160">', 'freiwillig') + '<label class="check"><input type="checkbox" name="fit"> ganzes Bild zeigen (nicht zuschneiden)</label>');
      body.insertBefore(p1.el, body.firstChild);
      body.querySelector('[name=cap]').value = t.cap || '';
      body.querySelector('[name=fit]').checked = t.fit === 'contain';
      ok = function () { t.f = p1.get()[0] || null; t.cap = body.querySelector('[name=cap]').value; t.fit = body.querySelector('[name=fit]').checked ? 'contain' : 'cover'; };
    } else if (t.type === 'gal') {
      var p2 = picker(true, t.imgs);
      body = html('<p class="muted" style="margin:0">Bilder in der Reihenfolge antippen, in der sie erscheinen sollen.</p>');
      body.appendChild(p2.el);
      ok = function () { t.imgs = p2.get(); };
    } else if (t.type === 'cmp') {
      var pb = picker(false, [t.before]), pa = picker(false, [t.after]);
      body = html('<b>Vorher</b>'); body.appendChild(pb.el);
      body.appendChild(html('<b>Nachher</b>').firstChild); body.appendChild(pa.el);
      body.appendChild(html('<p class="muted" style="margin:0">Am besten zwei Bilder aus demselben Blickwinkel.</p>').firstChild);
      ok = function () { t.before = pb.get()[0] || null; t.after = pa.get()[0] || null; };
    } else if (t.type === 'video') {
      body = html(field('Adresse des Videos', '<input type="url" name="url" maxlength="500" placeholder="https://www.youtube.com/watch?v=…">', 'YouTube bekommt ein Vorschaubild')
        + field('Unterschrift', '<input type="text" name="cap" maxlength="160">', 'freiwillig'));
      body.querySelector('[name=url]').value = t.url || '';
      body.querySelector('[name=cap]').value = t.cap || '';
      ok = function () { t.url = body.querySelector('[name=url]').value.trim(); t.cap = body.querySelector('[name=cap]').value; };
    } else if (t.type === 'map') return mapDialog(t);
    else if (t.type === 'head') return editBuilding(t.bw);
    else if (t.type === 'facts') {
      var rows = clone(t.rows || []);
      body = html(field('Überschrift', '<input type="text" name="title" maxlength="60" placeholder="Steckbrief">', 'freiwillig')
        + '<label class="check"><input type="checkbox" name="base"> Eckdaten des Spielstands mit anzeigen (Spiel, Karte und was unter „Eckdaten und Dateien“ steht)</label>'
        + '<div class="f"><b style="font-size:14px">Eigene Zeilen</b><div class="krows"></div><button type="button" class="pill small" data-radd style="justify-self:start">＋ Zeile</button></div>');
      var box = body.querySelector('.krows');
      var drawRows = function () {
        box.innerHTML = rows.map(function (r, i) {
          return '<input type="text" data-i="' + i + '" data-c="0" maxlength="40" placeholder="z. B. Baujahr" value="' + esc(r[0]) + '" aria-label="Bezeichnung"><input type="text" data-i="' + i + '" data-c="1" maxlength="160" placeholder="z. B. Frühjahr Jahr 3" value="' + esc(r[1]) + '" aria-label="Wert"><button type="button" class="pill small" data-rdel="' + i + '" aria-label="Zeile löschen">🗑</button>';
        }).join('') || '<p class="muted" style="margin:0;grid-column:1/-1">Noch keine eigenen Zeilen.</p>';
      };
      box.addEventListener('input', function (e) { var i = e.target.getAttribute('data-i'); if (i !== null) rows[Number(i)][Number(e.target.getAttribute('data-c'))] = e.target.value; });
      body.addEventListener('click', function (e) {
        if (e.target.closest('[data-radd]')) { if (rows.length < 30) { rows.push(['', '']); drawRows(); var ins = box.querySelectorAll('input'); ins[ins.length - 2].focus(); } }
        var d = e.target.closest('[data-rdel]'); if (d) { rows.splice(Number(d.getAttribute('data-rdel')), 1); drawRows(); }
      });
      if (!rows.length) rows.push(['', '']);
      drawRows();
      body.querySelector('[name=title]').value = t.title || '';
      body.querySelector('[name=base]').checked = t.base !== undefined && t.base !== null ? !!t.base : !t.bw;
      ok = function () {
        t.title = body.querySelector('[name=title]').value.trim();
        t.base = body.querySelector('[name=base]').checked;
        t.rows = rows.map(function (r) { return [r[0].trim(), r[1].trim()]; }).filter(function (r) { return r[0]; });
      };
    } else {
      var what = { dl: 'Die Dateien', mods: 'Die Mods' }[t.type];
      body = html('<p style="margin:0">' + what + ' trägst du unter <b>⚙ Eckdaten und Dateien</b> ein. Diese Kachel zeigt sie an.'
        + (t.type === 'dl' ? ' Gehört die Kachel zu einem Bauwerk, zeigt sie nur dessen Dateien (beim Hochladen „Gehört zu“ wählen).' : '')
        + '</p><p class="muted" style="margin:0">Speichere zuerst mit „Fertig“, sonst gehen die Änderungen hier verloren.</p>');
      dialog(T.icon + ' ' + T.label, body, function () {}, true);
      return;
    }
    dialog(T.icon + ' ' + T.label, body, function () { snap(); ok(); render([t.id]); mark(); }, t.type === 'video');
  };

  // Karte: Bild wählen, Punkte setzen und verschieben, je Punkt ein Ziel (Bauwerk oder Kachel)
  var mapDialog = function (t) {
    var pts = clone(t.points || []), f = t.f, cur = -1;
    var body = document.createElement('div');
    var pk = picker(false, [f], function (sel) { f = sel[0] || null; draw(); });
    var det = html('<details><summary><b>Kartenbild</b> wählen oder hochladen</summary></details>').firstChild;
    det.appendChild(pk.el);
    if (!f) det.open = true;
    var wrap = document.createElement('div'); wrap.className = 'kmap';
    body.appendChild(det); body.appendChild(wrap);
    var targets = function () {
      var o = '<option value="">– kein Ziel –</option>';
      state.buildings.forEach(function (b, i) { o += '<option value="' + b.id + '">🏗️ ' + (i + 1) + ' ' + esc(b.name) + ' (alle Kacheln)</option>'; });
      state.tiles.forEach(function (x) { if (x.id !== t.id && x.type !== 'head') o += '<option value="' + x.id + '">Kachel: ' + esc(labelOf(x)) + '</option>'; });
      return o;
    };
    var colorOf = function (to) {
      var b = to && to.charAt(0) === 'b' ? bld(to) : to ? (tile(to) && tile(to).bw && bld(tile(to).bw)) : null;
      return b ? D.colors[b.color] : '#5b6a85';
    };
    var draw = function () {
      if (!f) { wrap.innerHTML = '<p class="muted">Wähle oben ein Kartenbild, z. B. die Karte aus dem Spiel oder ein Bild von oben.</p>'; return; }
      wrap.innerHTML = '<div class="box"><img src="/media/' + esc(f) + '" alt="Karte">' + pts.map(function (p, i) {
        return '<span class="mp' + (i === cur ? ' on' : '') + '" data-i="' + i + '" style="left:' + p.x + '%;top:' + p.y + '%;--bwc:' + colorOf(p.to) + '"><i><span>' + (i + 1) + '</span></i>' + (p.label ? '<em>' + esc(p.label) + '</em>' : '') + '</span>';
      }).join('') + '</div><div><p class="muted" style="margin:0 0 8px;font-size:13px">Klick in die Karte setzt einen Punkt. Punkte lassen sich mit der Maus verschieben.</p><div class="kpts">' + pts.map(function (p, i) {
        return '<div class="kpt' + (i === cur ? ' on' : '') + '" data-i="' + i + '" style="--bwc:' + colorOf(p.to) + '"><div class="r"><i>' + (i + 1) + '</i><input type="text" data-f="label" maxlength="60" placeholder="Name (leer = Name des Bauwerks)" value="' + esc(p.label) + '"><button type="button" class="pill small" data-del aria-label="Punkt löschen">🗑</button></div>'
          + '<div class="r">Springt zu <select data-f="to">' + targets() + '</select></div></div>';
      }).join('') + (pts.length ? '' : '<p class="muted">Noch keine Punkte.</p>') + '</div></div>';
      wrap.querySelectorAll('.kpt select').forEach(function (s, i) { s.value = pts[i].to || ''; });
    };
    wrap.addEventListener('input', function (e) {
      var row = e.target.closest('.kpt'); if (!row) return;
      var i = Number(row.getAttribute('data-i'));
      pts[i][e.target.getAttribute('data-f')] = e.target.value;
      if (e.target.tagName === 'SELECT') { cur = i; draw(); }
      else { var em = wrap.querySelector('.mp[data-i="' + i + '"] em'); if (em) em.textContent = e.target.value; }
    });
    wrap.addEventListener('click', function (e) {
      var del = e.target.closest('[data-del]');
      if (del) { pts.splice(Number(del.closest('.kpt').getAttribute('data-i')), 1); cur = -1; draw(); return; }
      var row = e.target.closest('.kpt');
      if (row && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') { cur = Number(row.getAttribute('data-i')); draw(); }
    });
    wrap.addEventListener('pointerdown', function (e) {
      var box = e.target.closest('.box'); if (!box) return;
      e.preventDefault();
      var img = box.querySelector('img'), mp = e.target.closest('.mp');
      var pos = function (ev) { var r = img.getBoundingClientRect(); return { x: Math.round(clamp((ev.clientX - r.left) / r.width * 100, 0, 100) * 10) / 10, y: Math.round(clamp((ev.clientY - r.top) / r.height * 100, 0, 100) * 10) / 10 }; };
      if (!mp) {
        if (pts.length >= 60) return;
        var p = pos(e), b0 = state.buildings.filter(function (b) { return !pts.some(function (q) { return q.to === b.id; }); })[0];
        pts.push({ x: p.x, y: p.y, label: '', to: b0 ? b0.id : '' });
        cur = pts.length - 1; draw();
        return;
      }
      var i = Number(mp.getAttribute('data-i'));
      cur = i;
      var move = function (ev) { var q = pos(ev); pts[i].x = q.x; pts[i].y = q.y; mp.style.left = q.x + '%'; mp.style.top = q.y + '%'; };
      var up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); draw(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    draw();
    dialog('🗺️ Karte und Punkte', body, function () { snap(); t.f = f; t.points = pts; render([t.id]); mark(); });
  };

  // ---------- Bauwerke ----------
  var renderBws = function () {
    if (!bwBox) return;
    bwBox.innerHTML = state.buildings.map(function (b, i) {
      var n = state.tiles.filter(function (t) { return t.bw === b.id; }).length;
      var head = state.tiles.some(function (t) { return t.bw === b.id && t.type === 'head'; });
      return '<div class="r" style="--bwc:' + D.colors[b.color] + '"><i>' + (i + 1) + '</i><span class="nm" title="' + esc(b.name) + '">' + esc(b.name) + '</span><small>' + n + ' K.</small>'
        + (head ? '' : '<button type="button" data-bwh="' + b.id + '" title="Überschrift-Kachel dazu">＋🏗️</button>')
        + '<button type="button" data-bwe="' + b.id + '" title="Umbenennen, Farbe" aria-label="Bauwerk ändern">✎</button><button type="button" data-bwd="' + b.id + '" title="Bauwerk löschen" aria-label="Bauwerk löschen">🗑</button></div>';
    }).join('') || '<p class="muted small-note" style="margin:0">Noch keine Bauwerke.</p>';
  };
  if (bwBox) bwBox.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !on) return;
    if (b.hasAttribute('data-bwe')) editBuilding(b.getAttribute('data-bwe'));
    if (b.hasAttribute('data-bwh')) { snap(); var t = newTile('head', { bw: b.getAttribute('data-bwh') }); settleIn(state.tiles, null); applyAll(); render([t.id]); mark(); }
    if (b.hasAttribute('data-bwd')) {
      var id = b.getAttribute('data-bwd'), x = bld(id);
      if (!window.confirm('Bauwerk „' + x.name + '“ löschen? Seine Kacheln bleiben (ohne Bauwerk), nur die Überschrift fällt weg.')) return;
      snap();
      state.buildings = state.buildings.filter(function (y) { return y.id !== id; });
      state.tiles = state.tiles.filter(function (t) { return !(t.type === 'head' && t.bw === id); });
      state.tiles.forEach(function (t) { if (t.bw === id) t.bw = null; (t.points || []).forEach(function (p) { if (p.to === id) p.to = ''; }); });
      settleIn(state.tiles, null);
      render(); mark();
    }
  });
  var editBuilding = function (id) {
    if (!on) start();
    var b = id ? bld(id) : null;
    var keys = Object.keys(D.colors);
    var color = b ? b.color : keys[state.buildings.length % keys.length];
    var body = html(field('Name', '<input type="text" name="name" maxlength="80" required placeholder="z. B. Kuhstall „Zur Weide“">')
      + field('Kurztext', '<input type="text" name="text" maxlength="160" placeholder="z. B. Laufstall für 120 Kühe">', 'steht unter dem Namen')
      + '<div class="f"><b style="font-size:14px">Farbe</b><div class="kcolors">' + keys.map(function (k) { return '<label style="--c:' + D.colors[k] + '" title="' + k + '"><input type="radio" name="color" value="' + k + '"' + (k === color ? ' checked' : '') + '></label>'; }).join('') + '</div></div>'
      + '<label class="check"><input type="checkbox" name="frame"> farbiger Rahmen um alle Kacheln des Bauwerks</label>'
      + (b ? '' : '<p class="muted" style="margin:0">Unten auf dem Raster kommt eine Überschrift-Kachel dazu. Danach wählst du oben an anderen Kacheln dieses Bauwerk aus.</p>'));
    body.querySelector('[name=name]').value = b ? b.name : '';
    body.querySelector('[name=text]').value = b ? b.text : '';
    body.querySelector('[name=frame]').checked = !b || b.frame !== false;
    dialog(b ? '🏗️ Bauwerk ändern' : '🏗️ Neues Bauwerk', body, function () {
      var name = body.querySelector('[name=name]').value.trim();
      if (!name) return false;
      snap();
      var c = body.querySelector('[name=color]:checked');
      if (b) { b.name = name; b.text = body.querySelector('[name=text]').value.trim(); b.color = c ? c.value : b.color; b.frame = body.querySelector('[name=frame]').checked; render(); }
      else {
        var nb = { id: nextId(state.buildings, 'b'), name: name, text: body.querySelector('[name=text]').value.trim(), color: c ? c.value : color, frame: body.querySelector('[name=frame]').checked };
        state.buildings.push(nb);
        var t = newTile('head', { bw: nb.id });
        settleIn(state.tiles, null); applyAll();
        render().then(function () { var el = elOf(t.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      }
      mark();
    }, true);
  };
  document.addEventListener('keydown', function (e) {
    if (!on || e.target.closest('input, textarea, select, dialog')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); restore(); }
    if (e.key === 'Escape') grid.querySelectorAll('.kt.sel').forEach(function (x) { x.classList.remove('sel'); });
  });
  if (/[?&]gestalten\b/.test(location.search)) start();
})();
