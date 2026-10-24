// Desktop 2.0: Symbole auf dem Desktop, Rechtsklick-Menüs, Ziehen und Ablegen, das Widget „Offene Lobbys“ und die Suche
// in der Taskleiste. Die Daten kommen aus <script id="desk-daten"> (src/routes/desk.js, deskData), Änderungen gehen als JSON
// an /api/desktop. Gäste können Symbole nur verschieben, das merkt sich ihr Browser (localStorage „desk-pos“).
(function () {
  'use strict';
  var W = window.WinUI, D = window.DeskUI, R = window.RetroDesk;
  var deskEl = document.getElementById('desk'), box = document.getElementById('deskicons');
  if (!W || !D || !R || !deskEl) return;
  var esc = W.esc, data;
  try { data = JSON.parse(document.getElementById('desk-daten').textContent); } catch (e) { return; }
  var me = data.me, mobile = window.matchMedia('(max-width: 760px)');
  // Ein Platz im Raster ist 80 × 80 Pixel groß (bei vergrößerter Oberfläche entsprechend mehr)
  var CW = 80, CH = 80, PAD = 4;
  var icons = [], selected = [], menuPos = null;

  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* privat */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guestPos() { try { return JSON.parse(read('desk-pos') || '{}') || {}; } catch (e) { return {}; } }
  function guestArrange() { var a = read('desk-arrange'); return a === 'name' || a === 'typ' ? a : 'frei'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function oops(e) { W.msgbox(e.message, '⚠️'); }
  function closeStart() {
    var m = document.getElementById('startmenu'), b = document.getElementById('startbtn');
    if (m && m.classList.contains('open')) { m.classList.remove('open'); if (b) b.setAttribute('aria-expanded', false); }
  }
  if (!me) data.arrange = guestArrange();

  // ---------- Symbole ----------
  // Für andere sichtbar? Dann bekommt das Symbol ein kleines 👥, wie die Hand unter freigegebenen Ordnern bei Windows
  function shared(e) {
    if (e.sys) return false;
    if (e.kind === 'folder') return !!e.share;
    return !!e.vis && e.vis !== 'private' && e.vis !== 'link';
  }
  function render() {
    if (!box) return;
    var keep = selected.map(function (e) { return e.ref; }), gp = me ? null : guestPos();
    box.innerHTML = '';
    icons = data.items.map(function (e) {
      var el = document.createElement('div');
      el.className = 'dicon' + (e.broken ? ' broken' : '') + (e.isNew ? ' new' : '') + (e.full ? ' full' : '');
      el.setAttribute('role', 'option');
      el.tabIndex = -1;
      el.title = e.name + (e.external ? '\n' + (e.host || e.url) : e.broken ? '\nZiel fehlt' : '');
      el.innerHTML = '<span class="g">' + (e.thumb ? '<img src="' + esc(e.thumb) + '" alt="" loading="lazy">' : esc(e.icon || '📄')) +
        (e.kind === 'shortcut' || e.kind === 'link' || e.link ? '<i class="lnk" aria-hidden="true"></i>' : '') +
        (shared(e) ? '<i class="shr" title="Für andere sichtbar">👥</i>' : '') +
        (e.isNew ? '<i class="neu">NEU</i>' : '') + (e.broken ? '<i class="brk" aria-hidden="true">✕</i>' : '') + '</span>' +
        '<span class="t">' + esc(e.name) + '</span>';
      e.el = el;
      el._e = e;
      if (gp && gp[e.ref]) { e.x = gp[e.ref][0]; e.y = gp[e.ref][1]; }
      box.appendChild(el);
      return e;
    });
    selected = icons.filter(function (e) { return keep.indexOf(e.ref) >= 0; });
    layout();
    sync();
  }

  function zoom() { return box ? parseFloat(getComputedStyle(box).zoom) || 1 : 1; }
  function grid() {
    var z = zoom(), r = deskEl.getBoundingClientRect();
    return { z: z, r: r, rows: Math.max(1, Math.floor((r.height / z - PAD * 2) / CH)), cols: Math.max(1, Math.floor((r.width / z - PAD * 2) / CW)) };
  }
  var ORDER = { folder: 1, text: 2, shortcut: 3, link: 4 };
  // Nach Name: Symbole für alle zuerst, dann Ordner, dann der Rest nach dem Alphabet. Nach Typ: nach Art, dann Name.
  function sorted(list) {
    var by = data.arrange;
    if (by !== 'name' && by !== 'typ') return list;
    return list.slice().sort(function (a, b) {
      if (!!a.sys !== !!b.sys) return a.sys ? -1 : 1;
      if (a.sys) return 0;
      if (by === 'typ') {
        var ka = a.lib ? 5 : ORDER[a.kind] || 6, kb = b.lib ? 5 : ORDER[b.kind] || 6;
        if (ka !== kb) return ka - kb;
        if (a.lib && a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      } else if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'de', { sensitivity: 'base', numeric: true });
    });
  }
  // Frei: Jedes Symbol bleibt auf seinem Platz, was keinen hat, kommt auf den ersten freien (von oben nach unten, dann nach rechts)
  function layout() {
    if (!box) return;
    if (mobile.matches) { icons.forEach(function (e) { e.el.style.left = e.el.style.top = ''; e.cx = e.cy = null; }); return; }
    var g = grid(), taken = {}, free = data.arrange === 'frei', later = [];
    function put(e, x, y) { taken[x + ',' + y] = e; e.cx = x; e.cy = y; e.el.style.left = PAD + x * CW + 'px'; e.el.style.top = PAD + y * CH + 'px'; }
    sorted(icons).forEach(function (e) {
      var x = e.x, y = e.y;
      if (free && x != null && y != null && x < g.cols && y < g.rows && !taken[x + ',' + y]) put(e, x, y); else later.push(e);
    });
    var cx = 0, cy = 0;
    later.forEach(function (e) {
      while (taken[cx + ',' + cy]) { cy++; if (cy >= g.rows) { cy = 0; cx++; } }
      put(e, cx, cy);
    });
  }
  // Nächster freier Platz um x/y herum (Ring für Ring)
  function nearestFree(x, y, taken, g) {
    for (var d = 1; d < Math.max(g.cols, g.rows) + 1; d++) {
      for (var dx = -d; dx <= d; dx++) for (var dy = -d; dy <= d; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        var nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < g.cols && ny < g.rows && !taken[nx + ',' + ny]) return [nx, ny];
      }
    }
    return [x, y];
  }
  function cellAt(px, py) {
    var g = grid(), taken = {};
    var cx = clamp(Math.floor(((px - g.r.left) / g.z - PAD) / CW), 0, g.cols - 1), cy = clamp(Math.floor(((py - g.r.top) / g.z - PAD) / CH), 0, g.rows - 1);
    icons.forEach(function (o) { if (o.cx != null) taken[o.cx + ',' + o.cy] = o; });
    return taken[cx + ',' + cy] ? nearestFree(cx, cy, taken, g) : [cx, cy];
  }
  // Plätze merken: am Konto oder als Gast im Browser
  function savePositions() {
    if (me) {
      W.api('POST', '/api/desktop/platz', { list: icons.filter(function (o) { return o.x != null; }).map(function (o) { return { ref: o.ref, x: o.x, y: o.y }; }) }).catch(oops);
    } else {
      var p = {};
      icons.forEach(function (o) { if (o.x != null) p[o.ref] = [o.x, o.y]; });
      store('desk-pos', JSON.stringify(p));
      store('desk-arrange', 'frei');
    }
  }
  // Die gerade sichtbare Anordnung festhalten (beim Wechsel auf „Frei anordnen“ und vor dem ersten Ziehen)
  function freeze() { icons.forEach(function (o) { if (o.cx != null) { o.x = o.cx; o.y = o.cy; } }); data.arrange = 'frei'; }

  // ---------- Auswahl ----------
  function sync() {
    icons.forEach(function (e) { var on = selected.indexOf(e) >= 0; e.el.classList.toggle('sel', on); e.el.setAttribute('aria-selected', on); });
  }
  function select(e, ev) {
    if (e && ev && (ev.ctrlKey || ev.metaKey)) {
      var i = selected.indexOf(e);
      if (i >= 0) selected.splice(i, 1); else selected.push(e);
    } else selected = e ? [e] : [];
    if (e) e.el.focus({ preventScroll: true });
    sync();
  }
  function open(e) {
    if (e.isNew) { e.isNew = false; e.el.classList.remove('new'); var n = e.el.querySelector('.neu'); if (n) n.remove(); }
    D.open(e);
  }
  function refresh() {
    return W.api('GET', '/api/desktop').then(function (j) {
      data = j;
      if (!me) data.arrange = guestArrange();
      render();
      lobbyState();
    }).catch(function () { /* nächstes Mal */ });
  }

  // ---------- Umbenennen direkt am Symbol ----------
  function startRename(ref) {
    var e = icons.filter(function (o) { return o.ref === ref; })[0];
    if (!e || e.sys || e.lib || !me) return;
    select(e);
    var t = e.el.querySelector('.t'), inp = document.createElement('textarea'), done = false;
    inp.className = 'dicon-edit';
    inp.value = e.name; inp.maxLength = 60; inp.rows = 2; inp.spellcheck = false;
    inp.setAttribute('aria-label', 'Neuer Name');
    t.hidden = true;
    e.el.appendChild(inp);
    e.el.classList.add('renaming');
    inp.focus();
    inp.select();
    function finish(ok) {
      if (done) return;
      done = true;
      var name = inp.value.replace(/\s+/g, ' ').trim();
      inp.remove(); t.hidden = false; e.el.classList.remove('renaming');
      if (ok && name && name !== e.name) D.rename(e, name).then(function (it) { if (it) refresh(); });
      e.el.focus({ preventScroll: true });
    }
    inp.addEventListener('keydown', function (k) {
      k.stopPropagation();
      if (k.key === 'Enter') { k.preventDefault(); finish(true); } else if (k.key === 'Escape') { k.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', function () { finish(true); });
    inp.addEventListener('pointerdown', function (k) { k.stopPropagation(); });
    inp.addEventListener('dblclick', function (k) { k.stopPropagation(); });
  }

  // ---------- Menüs ----------
  function deskMenu() {
    var arr = data.arrange, items = [
      { label: 'Symbole anordnen', sub: [{ label: 'Nach Name', act: 'arrange:name', checked: arr === 'name' }, { label: 'Nach Typ', act: 'arrange:typ', checked: arr === 'typ' },
        '-', { label: 'Frei anordnen', act: 'arrange:frei', checked: arr === 'frei' }] },
      { label: 'Aktualisieren', act: 'refresh' }];
    if (me) {
      items.push('-', { label: 'Neu', sub: D.newMenu() });
      if (me.canUpload) items.push({ label: 'Datei hochladen…', act: 'upload' });
      if (data.hidden && data.hidden.length) items.push({ label: 'Ausgeblendete Symbole zeigen', act: 'unhide' });
      if (data.lobbyAllowed) items.push('-', { label: 'Offene Lobbys zeigen', act: 'lobbies', checked: !!data.lobbyWidget });
    }
    items.push('-', { label: 'Eigenschaften', act: 'props' });
    return items;
  }
  function iconMenu() {
    var es = selected, one = es.length === 1 ? es[0] : null, own = es.filter(function (e) { return !e.sys; });
    var items = [{ label: one && one.kind === 'folder' ? 'Öffnen' : 'Öffnen', act: 'open', bold: true, disabled: !one }];
    if (one && one.external) items.push({ label: 'Adresse kopieren', act: 'copy' });
    if (one && one.ref === 'papierkorb') items.push({ label: 'Papierkorb leeren', act: 'empty', disabled: !data.trash });
    if (!me) return items;
    if (one && one.lib) items.push({ label: 'In der Bibliothek zeigen', act: 'lib' });
    if (own.length) items.push('-', { label: 'Verschieben nach…', act: 'move' });
    items.push('-', { label: own.length ? 'Löschen' : 'Vom Desktop nehmen', act: 'delete' });
    if (one && !one.sys && !one.lib) items.push({ label: 'Umbenennen', act: 'rename', key: 'F2' });
    if (one) items.push('-', { label: 'Eigenschaften', act: 'iprops' });
    return items;
  }
  function menuAt(x, y, e) {
    if (e && selected.indexOf(e) < 0) select(e);
    if (!e) select(null);
    menuPos = { x: x, y: y };
    W.contextMenu(x, y, e ? iconMenu() : deskMenu(), act);
  }
  function setting(d) { return me ? W.api('POST', '/api/desktop/einstellungen', d).catch(oops) : Promise.resolve(); }
  function act(a) {
    var es = selected.slice(), one = es[0];
    if (a.indexOf('new:') === 0) {
      var kind = a.slice(4), c = menuPos ? cellAt(menuPos.x, menuPos.y) : [0, 0];
      return D.newEntry(kind, 0, { x: c[0], y: c[1] }).then(function (it) {
        if (!it) return;
        refresh().then(function () { if (kind === 'folder' || kind === 'text') startRename('d:' + it.id); });
      });
    }
    if (a.indexOf('arrange:') === 0) {
      var to = a.slice(8);
      if (to === 'frei') { freeze(); layout(); savePositions(); return; }
      data.arrange = to;
      icons.forEach(function (o) { o.x = o.y = null; });
      if (!me) { store('desk-arrange', to); store('desk-pos', null); }
      layout();
      return setting({ arrange: to });
    }
    switch (a) {
      case 'refresh': refresh(); break;
      case 'upload': R.open('/files/upload?ordner=0', true); break;
      case 'unhide': setting({ show: data.hidden }).then(refresh); break;
      case 'lobbies':
        data.lobbyWidget = !data.lobbyWidget;
        lobbyState();
        setting({ lobbies: data.lobbyWidget });
        break;
      case 'props':
        if (me) R.open('/einstellungen/desktop', true);
        else { var b = document.getElementById('displaybtn'); if (b) b.click(); }
        break;
      case 'open': if (one) open(one); break;
      case 'copy': if (navigator.clipboard) navigator.clipboard.writeText(one.url); break;
      case 'empty':
        W.confirm('Alles im Papierkorb endgültig löschen? Das lässt sich nicht rückgängig machen.', '🗑️', 'Papierkorb leeren', 'Papierkorb leeren')
          .then(function (ok) { if (ok) W.api('POST', '/api/desktop/papierkorb-leeren').then(refresh, oops); });
        break;
      case 'lib': R.open('/eigene-dateien?bib=' + one.kind, true); break;
      case 'move': D.moveTo(es, false).then(function (ok) { if (ok) refresh(); }); break;
      case 'delete': D.remove(es).then(function (ok) { if (ok) refresh(); }); break;
      case 'rename': startRename(one.ref); break;
      case 'iprops': D.properties(one).then(function (it) { if (it) refresh(); }); break;
    }
  }

  // ---------- Maus, Finger, Tastatur ----------
  var touch = false, pressTimer = 0, longAt = 0;
  function hit(px, py, skip) {
    for (var i = 0; i < icons.length; i++) {
      var o = icons[i];
      if (skip.indexOf(o) >= 0 || !(o.kind === 'folder' || o.ref === 'papierkorb')) continue;
      var r = o.el.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return o;
    }
    return null;
  }
  function dropOn(target, list) {
    if (target.ref === 'papierkorb') return D.remove(list).then(function (ok) { if (ok) refresh(); });
    var own = list.filter(function (o) { return !o.sys; });
    if (!own.length) return W.msgbox('Symbole, die jeder hat, lassen sich nicht in Ordner legen.', 'ℹ️');
    W.api('POST', '/api/desktop/verschieben', { refs: own.map(function (o) { return o.ref; }), folder: target.id })
      .then(function (r) { if (r.error) W.msgbox(r.error, '⚠️'); refresh(); }, oops);
  }
  function drag(ev) {
    var sx = ev.clientX, sy = ev.clientY, moving = false, g = null, list = null, target = null, id = ev.pointerId;
    // Erst beim Ziehen festhalten, sonst landen click/dblclick nicht mehr am Symbol
    function move(m) {
      var dx = m.clientX - sx, dy = m.clientY - sy;
      if (!moving) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        try { box.setPointerCapture(id); } catch (e) { /* Zeiger schon weg */ }
        moving = true; g = grid(); list = selected.slice();
        document.body.classList.add('dragging');
        list.forEach(function (o) { o.el.classList.add('moving'); });
      }
      list.forEach(function (o) { o.el.style.transform = 'translate(' + dx / g.z + 'px,' + dy / g.z + 'px)'; });
      var over = me ? hit(m.clientX, m.clientY, list) : null;
      if (over !== target) { if (target) target.el.classList.remove('drop-on'); target = over; if (target) target.el.classList.add('drop-on'); }
    }
    function up(u) {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      try { box.releasePointerCapture(id); } catch (e) { /* schon weg */ }
      if (!moving) return;
      document.body.classList.remove('dragging');
      list.forEach(function (o) { o.el.style.transform = ''; o.el.classList.remove('moving'); });
      if (target) { target.el.classList.remove('drop-on'); if (u.type === 'pointerup') dropOn(target, list); return; }
      var mx = Math.round((u.clientX - sx) / g.z / CW), my = Math.round((u.clientY - sy) / g.z / CH);
      if (u.type !== 'pointerup' || (!mx && !my)) return;
      freeze();
      var taken = {};
      icons.forEach(function (o) { if (list.indexOf(o) < 0) taken[o.x + ',' + o.y] = o; });
      list.forEach(function (o) {
        var x = clamp(o.x + mx, 0, g.cols - 1), y = clamp(o.y + my, 0, g.rows - 1);
        if (taken[x + ',' + y]) { var p = nearestFree(x, y, taken, g); x = p[0]; y = p[1]; }
        taken[x + ',' + y] = o; o.x = x; o.y = y;
      });
      layout();
      savePositions();
    }
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  }
  // Rahmen aufziehen markiert mehrere Symbole
  function band(ev) {
    var sx = ev.clientX, sy = ev.clientY, el = null, base = ev.ctrlKey || ev.metaKey ? selected.slice() : [], id = ev.pointerId;
    function move(m) {
      if (!el) {
        if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 4) return;
        try { box.setPointerCapture(id); } catch (e) { /* Zeiger schon weg */ }
        el = document.createElement('div');
        el.className = 'desk-band';
        document.body.appendChild(el);
      }
      var l = Math.min(sx, m.clientX), t = Math.min(sy, m.clientY), r = Math.max(sx, m.clientX), b = Math.max(sy, m.clientY);
      el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = r - l + 'px'; el.style.height = b - t + 'px';
      selected = base.concat(icons.filter(function (o) {
        if (base.indexOf(o) >= 0) return false;
        var q = o.el.getBoundingClientRect();
        return q.right > l && q.left < r && q.bottom > t && q.top < b;
      }));
      sync();
    }
    function up() {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      try { box.releasePointerCapture(id); } catch (e) { /* schon weg */ }
      if (el) el.remove(); else if (!base.length) select(null);
    }
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  }

  if (box) {
    box.addEventListener('pointerdown', function (ev) {
      touch = ev.pointerType !== 'mouse';
      if (ev.target.closest('.dicon-edit')) return;
      closeStart();
      var el = ev.target.closest('.dicon');
      clearTimeout(pressTimer);
      if (touch) {
        var tx = ev.clientX, ty = ev.clientY;
        pressTimer = setTimeout(function () { longAt = Date.now(); menuAt(tx, ty, el ? el._e : null); }, 550);
        if (el && selected.indexOf(el._e) < 0) select(el._e);
        return;
      }
      if (!el) { if (ev.button === 0) { box.focus({ preventScroll: true }); band(ev); } return; }
      var e = el._e;
      if (ev.button !== 0) { if (selected.indexOf(e) < 0) select(e); return; }
      if (ev.ctrlKey || ev.metaKey) { select(e, ev); return; }
      if (selected.indexOf(e) < 0) select(e); else e.el.focus({ preventScroll: true });
      if (!mobile.matches) drag(ev);
    });
    ['pointerup', 'pointercancel'].forEach(function (t) { box.addEventListener(t, function () { clearTimeout(pressTimer); }); });
    box.addEventListener('pointermove', function (ev) { if (touch && pressTimer) clearTimeout(pressTimer); }, { passive: true });
    box.addEventListener('click', function (ev) {
      var el = ev.target.closest('.dicon');
      if (!el || !touch || Date.now() - longAt < 800 || ev.target.closest('.dicon-edit')) return;
      open(el._e);
    });
    box.addEventListener('dblclick', function (ev) {
      var el = ev.target.closest('.dicon');
      if (el && !touch && !ev.target.closest('.dicon-edit')) open(el._e);
    });
    box.addEventListener('contextmenu', function (ev) {
      if (ev.target.closest('.dicon-edit')) return;
      ev.preventDefault();
      if (Date.now() - longAt < 800) return;
      var el = ev.target.closest('.dicon');
      menuAt(ev.clientX, ev.clientY, el ? el._e : null);
    });
    box.addEventListener('keydown', function (k) {
      if (k.target !== box && !k.target.classList.contains('dicon')) return;
      var one = selected[selected.length - 1];
      if (k.key === 'Enter' && one) { k.preventDefault(); if (selected.length === 1) open(one); }
      else if (k.key === 'Delete' && selected.length && me) { k.preventDefault(); act('delete'); }
      else if (k.key === 'F2' && one && me) { k.preventDefault(); startRename(one.ref); }
      else if ((k.ctrlKey || k.metaKey) && k.key.toLowerCase() === 'a') { k.preventDefault(); selected = icons.slice(); sync(); }
      else if (/^Arrow/.test(k.key)) { k.preventDefault(); step(k.key, one); }
      else if (k.key === 'ContextMenu' || (k.shiftKey && k.key === 'F10')) {
        k.preventDefault();
        var r = (one ? one.el : box).getBoundingClientRect();
        menuAt(r.left + 24, r.top + 24, one || null);
      }
    });
    // Pfeiltasten: zum nächsten Symbol in diese Richtung
    var step = function (key, cur) {
      if (!cur) { if (icons[0]) select(icons[0]); return; }
      var dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
      var best = null, bd = 1e9;
      icons.forEach(function (o) {
        if (o === cur || o.cx == null) return;
        var ox = o.cx - cur.cx, oy = o.cy - cur.cy;
        if ((dx && Math.sign(ox) !== dx) || (dy && Math.sign(oy) !== dy) || (!dx && ox && !oy)) return;
        var d = Math.abs(ox) * (dy ? 4 : 1) + Math.abs(oy) * (dx ? 4 : 1);
        if (d < bd) { bd = d; best = o; }
      });
      if (best) select(best);
    };
    var relayout = 0;
    window.addEventListener('resize', function () { clearTimeout(relayout); relayout = setTimeout(layout, 120); });
    // Größe der Oberfläche geändert (🖥️ → Darstellung): das Raster neu legen
    window.addEventListener('storage', function (e) { if (e.key === 'darstellung') setTimeout(layout, 50); });
    window.addEventListener('darstellung:angewendet', function () { layout(); });
  }

  // ---------- Aus dem Startmenü auf den Desktop ziehen ----------
  var startMenu = document.getElementById('startmenu');
  if (startMenu) startMenu.addEventListener('dragstart', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    var label = a.textContent.trim(), sp = label.indexOf(' ');
    ev.dataTransfer.setData('application/x-desk', JSON.stringify({ url: a.getAttribute('href'), icon: label.slice(0, sp), name: label.slice(sp + 1).replace(/\s*\(\d+\)$/, '') }));
    ev.dataTransfer.effectAllowed = 'copy';
  });
  deskEl.addEventListener('dragover', function (ev) {
    if ([].indexOf.call(ev.dataTransfer.types, 'application/x-desk') < 0) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  });
  deskEl.addEventListener('drop', function (ev) {
    var raw = ev.dataTransfer.getData('application/x-desk');
    if (!raw) return;
    ev.preventDefault();
    closeStart();
    if (!me) return W.msgbox('Eigene Verknüpfungen gibt es mit einem Konto.', '🔑', 'Verknüpfung');
    var d = JSON.parse(raw), c = cellAt(ev.clientX, ev.clientY);
    W.api('POST', '/api/desktop/neu', { kind: 'shortcut', target: d.url, name: d.name, icon: d.icon, parent: 0, x: c[0], y: c[1] }).then(refresh, oops);
  });

  // ---------- Offene Lobbys ----------
  var lw = document.getElementById('lobbywidget'), lwTimer = 0;
  function lobbyState() {
    if (!lw) return;
    lw.hidden = !data.lobbyWidget;
    clearTimeout(lwTimer);
    if (!data.lobbyWidget) return;
    var min = read('lobby-widget-min') === '1';
    lw.classList.toggle('collapsed', min);
    lw.querySelector('[data-lw=min]').setAttribute('aria-expanded', !min);
    poll();
  }
  function poll() {
    clearTimeout(lwTimer);
    if (!data.lobbyWidget) return;
    if (!document.hidden) W.api('GET', '/api/lobbys').then(drawLobbies, function () { /* nächstes Mal */ });
    lwTimer = setTimeout(poll, 15000);
  }
  function drawLobbies(j) {
    var list = j.lobbies || [], el = lw.querySelector('[data-list]');
    lw.querySelector('[data-n]').textContent = list.length ? '(' + list.length + ')' : '';
    lw.querySelector('[data-time]').textContent = 'Stand ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (j.apps) data.newLobby = j.apps;
    if (!list.length) { el.innerHTML = '<p class="lob-empty">Gerade ist nichts offen. Mach doch selbst eine auf!</p>'; return; }
    function row(l) {
      var who = l.max ? l.players + '/' + l.max : l.players + (l.players === 1 ? ' Person' : ' Leute');
      return '<div class="lob"><span class="ic">' + esc(l.icon) + '</span><span class="nm" title="' + esc(l.name) + '">' + esc(l.name) + '</span>' +
        '<button type="button" class="small" data-join="' + esc(l.url) + '">' + (l.mine ? 'Zurück' : 'Beitreten') + '</button>' +
        '<span class="sub">' + esc(l.what) + ' · ' + esc(who) + (l.status ? ' · ' + esc(l.status) : '') +
        (l.friends.length ? ' · <span class="fr">⭐ ' + esc(l.friends.join(', ')) + '</span>' : '') + '</span></div>';
    }
    var fr = list.filter(function (l) { return l.friends.length; }), rest = list.filter(function (l) { return !l.friends.length; });
    el.innerHTML = (fr.length ? '<div class="lob-group">⭐ Mit Freunden</div>' + fr.map(row).join('') : '') +
      (rest.length ? (fr.length ? '<div class="lob-group">Alle anderen</div>' : '') + rest.map(row).join('') : '');
  }
  if (lw) {
    lw.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.join) R.open(b.dataset.join, true);
      else if (b.dataset.lw === 'min') {
        var min = lw.classList.toggle('collapsed');
        b.setAttribute('aria-expanded', !min);
        store('lobby-widget-min', min ? '1' : null);
      } else if (b.dataset.lw === 'new') {
        var r = b.getBoundingClientRect();
        var items = (data.newLobby || []).map(function (a) { return { label: a.name, icon: a.icon, act: a.url }; });
        W.contextMenu(r.left, r.bottom, items.length ? items : [{ label: 'Gerade nicht möglich', disabled: true }], function (url) { R.open(url, true); });
      }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && data.lobbyWidget) poll(); });
  }

  // ---------- Suche in der Taskleiste ----------
  var sBox = document.getElementById('tbsearch'), sIn = document.getElementById('tbsearch-q'), sPop = document.getElementById('searchpop');
  var sRes = document.getElementById('searchres'), hits = [], hl = -1, sTimer = 0, sSeq = 0;
  function fold(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss'); }
  // Treffer gelb markieren (ä findet a wie auf dem Server)
  function mark(text, q) {
    var t = String(text), ft = fold(t), fq = fold(q), out = '', i = 0, at;
    if (ft.length !== t.length || !fq) return esc(t);
    while ((at = ft.indexOf(fq, i)) >= 0) { out += esc(t.slice(i, at)) + '<mark>' + esc(t.slice(at, at + fq.length)) + '</mark>'; i = at + fq.length; }
    return out + esc(t.slice(i));
  }
  function sOpen(on) { if (!sPop) return; sPop.hidden = !on; sIn.setAttribute('aria-expanded', on); }
  function paintHits() {
    sRes.querySelectorAll('.r').forEach(function (r) {
      var on = Number(r.dataset.i) === hl;
      r.classList.toggle('hl', on); r.setAttribute('aria-selected', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
  }
  function drawHits(j, q) {
    hits = [];
    var html = '';
    j.groups.forEach(function (g) {
      html += '<h4>' + esc(g.label) + (g.more ? ' <a href="/suche?q=' + encodeURIComponent(q) + '&amp;nur=' + esc(g.key) + '">mehr …</a>' : '') + '</h4>';
      g.items.forEach(function (it) {
        var i = hits.push(it) - 1;
        html += '<div class="r" role="option" data-i="' + i + '">' + (it.thumb || it.avatar ? '<img class="ic" src="' + esc(it.thumb || it.avatar) + '" alt="">' : '<span class="ic">' + esc(it.icon) + '</span>') +
          '<span class="w">' + mark(it.name, q) + '</span>' + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + (it.external ? '<small>↗</small>' : '') + '</div>';
      });
    });
    sRes.innerHTML = html || '<p class="res-hint">Nichts gefunden für „' + esc(q) + '“.</p>';
    hl = hits.length ? 0 : -1;
    paintHits();
    sOpen(true);
  }
  function go(it) { sOpen(false); sIn.blur(); sBox.classList.remove('open'); if (it.external) D.openExternal(it.url); else R.open(it.url, true); }
  function all() { var q = sIn.value.trim(); sOpen(false); sBox.classList.remove('open'); R.open(q ? '/suche?q=' + encodeURIComponent(q) : '/suche', true); }
  function focusSearch() {
    if (!sIn) return false;
    closeStart();
    sBox.classList.add('open');
    sIn.focus();
    sIn.select();
    return true;
  }
  if (sIn && sPop) {
    sIn.addEventListener('input', function () {
      clearTimeout(sTimer);
      var q = sIn.value.trim();
      if (q.length < 2) { hits = []; sRes.innerHTML = q ? '<p class="res-hint">Weiter tippen …</p>' : ''; sOpen(!!q); return; }
      sTimer = setTimeout(function () {
        var my = ++sSeq;
        W.api('GET', '/api/suche?q=' + encodeURIComponent(q)).then(function (j) { if (my === sSeq) drawHits(j, q); },
          function (e) { sRes.innerHTML = '<p class="res-hint">' + esc(e.message) + '</p>'; sOpen(true); });
      }, 180);
    });
    sIn.addEventListener('keydown', function (k) {
      if (k.key === 'ArrowDown' || k.key === 'ArrowUp') {
        k.preventDefault();
        if (!hits.length) return;
        hl = (hl + (k.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
        paintHits();
      } else if (k.key === 'Enter') { k.preventDefault(); if (hl >= 0 && hits[hl] && !sPop.hidden) go(hits[hl]); else all(); }
      else if (k.key === 'Escape') { k.preventDefault(); sOpen(false); sIn.value = ''; sIn.blur(); sBox.classList.remove('open'); }
    });
    sIn.addEventListener('focus', function () { if (hits.length && sIn.value.trim().length >= 2) sOpen(true); });
    sIn.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== sIn && sPop.hidden) sBox.classList.remove('open'); }, 150); });
    sBox.querySelector('.tb-search-btn').addEventListener('click', function (e) { e.stopPropagation(); if (sBox.classList.contains('open') && sIn.value.trim()) all(); else focusSearch(); });
    sRes.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a) { e.preventDefault(); sOpen(false); sBox.classList.remove('open'); R.open(a.getAttribute('href'), true); return; }
      var r = e.target.closest('.r');
      if (r) go(hits[Number(r.dataset.i)]);
    });
    sRes.addEventListener('mousemove', function (e) { var r = e.target.closest('.r'); if (r && Number(r.dataset.i) !== hl) { hl = Number(r.dataset.i); paintHits(); } });
    sPop.querySelector('[data-all]').addEventListener('click', function (e) { e.preventDefault(); all(); });
    document.addEventListener('pointerdown', function (e) {
      if (!sPop.hidden && !e.target.closest('#searchpop, #tbsearch')) { sOpen(false); if (!sIn.value.trim()) sBox.classList.remove('open'); }
    });
    document.addEventListener('keydown', function (k) {
      if ((k.ctrlKey || k.metaKey) && !k.altKey && !k.shiftKey && k.key.toLowerCase() === 'k' && focusSearch()) k.preventDefault();
    });
  }

  // ---------- Darstellung am Konto (🖥️ → „Auf allen meinen Geräten“) ----------
  window.addEventListener('darstellung:gespeichert', function (ev) {
    if (!me || !ev.detail) return;
    W.api('POST', '/api/einstellungen/darstellung', { display: ev.detail.sync ? ev.detail.display : null }).catch(function () { /* bleibt im Browser */ });
  });

  R.refreshIcons = refresh;
  R.focusSearch = focusSearch;
  render();
  lobbyState();
  // Schriften und Zoom stehen erst nach dem Laden fest
  window.addEventListener('load', layout);
})();
