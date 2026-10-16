// Paint-Lobbys im Browser (Menü Lobby in Paint): gemeinsam an einem Bild malen. Gegenstück zu src/paintlobby.js.
// Jeder eigene Schritt geht als Stück (nur die geänderten Pixel) oder als Befehl für das ganze Bild an den Server.
// Angezeigt wird immer: Stand des Servers (base) plus die eigenen Schritte, die er noch nicht bestätigt hat (pending).
// Änderungen der anderen kommen in fester Reihenfolge; während man gerade malt, warten sie kurz, bis der Strich fertig ist.
(function () {
  'use strict';
  var RP = window.RetroPaint, root = document.getElementById('paint');
  if (!RP || !RP.internals || !root) return;
  var I = RP.internals, P = I.P, esc = I.esc;
  var side = root.querySelector('.pt-side'), cursorsEl = root.querySelector('.pt-cursors'), rctx = I.remote.getContext('2d');
  var $ = function (sel) { return side.querySelector(sel); };
  var L = null, cidN = 0, RND = Math.random().toString(36).slice(2, 8);
  var SHAPES = ['round', 'square', 'slash', 'backslash'], KINDS = ['line', 'rect', 'ellipse', 'rrect'];

  // ---------- Bilder umwandeln ----------
  function decodeBlob(blob) {
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then(function (bm) {
      var c = document.createElement('canvas');
      c.width = bm.width; c.height = bm.height;
      var x = c.getContext('2d');
      x.drawImage(bm, 0, 0);
      var d = x.getImageData(0, 0, bm.width, bm.height).data;
      for (var i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
      return { w: bm.width, h: bm.height, d: new Uint8ClampedArray(d.buffer) };
    });
  }
  function decodeB64(b64) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return decodeBlob(new Blob([u], { type: 'image/png' }));
  }
  function toB64(b) {
    return I.toBlob(b, 'image/png').then(function (blob) {
      return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.readAsDataURL(blob); });
    });
  }
  function opaque(b) { for (var i = 0; i < b.d.length; i += 4) if (!b.d[i + 3]) { b.d[i] = b.d[i + 1] = b.d[i + 2] = 255; b.d[i + 3] = 255; } return b; }
  // Nur die geänderten Pixel, zugeschnitten auf das kleinste Rechteck; null, wenn sich nichts geändert hat
  function diff(before, after, ox, oy) {
    var w = after.w, h = after.h, x0 = w, y0 = h, x1 = -1, y1 = -1, p = P.clone(after);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (p.d[i] === before.d[i] && p.d[i + 1] === before.d[i + 1] && p.d[i + 2] === before.d[i + 2]) p.d[i + 3] = 0;
      else { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    return { x: ox + x0, y: oy + y0, patch: P.crop(p, x0, y0, x1 - x0 + 1, y1 - y0 + 1) };
  }
  function applyTo(b, c) {
    if (c.kind === 'patch') { P.blit(b, c.patch, c.x, c.y); return b; }
    if (c.kind === 'cmd') return P.run(b, c.cmd, I.MAX_W, I.MAX_H) || b;
    return P.clone(c.put);
  }

  // ---------- Anzeige: Stand des Servers plus eigene, noch unbestätigte Schritte ----------
  function showAll() {
    var b = P.clone(L.base);
    L.pending.forEach(function (p) { b = applyTo(b, p); });
    I.setImage(b, true);
  }
  function show(c) {
    var img = I.img;
    if (c.kind !== 'patch' || img.w !== L.base.w || img.h !== L.base.h || L.pending.some(function (p) { return p.kind !== 'patch'; })) return showAll();
    var r = P.clip({ x0: c.x, y0: c.y, x1: c.x + c.patch.w - 1, y1: c.y + c.patch.h - 1 }, L.base);
    if (!r) return;
    var part = P.crop(L.base, r.x, r.y, r.w, r.h);
    L.pending.forEach(function (p) { P.blit(part, p.patch, p.x - r.x, p.y - r.y); });
    P.blit(img, part, r.x, r.y);
    P.blit(I.committed, part, r.x, r.y);
    I.refresh(r);
  }

  // ---------- Eingang vom Server, in Reihenfolge ----------
  function schedule() { if (L && !L.timer) L.timer = setTimeout(function () { if (L) { L.timer = null; pump(); } }, 120); }
  function pump() {
    if (!L || L.syncing || L.decoding) return;
    if (L.needAll) { if (!I.idle()) return schedule(); L.needAll = false; showAll(); }
    while (L.inbox.length) {
      var m = L.inbox[0];
      if (m.d.seq <= L.seq) { L.inbox.shift(); continue; }
      if (m.type === 'op' && m.d.data && !m.bmp && !m.bad) {
        L.decoding = true;
        var lob = L;
        decodeB64(m.d.data).then(function (b) { m.bmp = b; }, function () { m.bad = true; }).then(function () { lob.decoding = false; if (lob === L) pump(); });
        return;
      }
      if (!I.idle()) return schedule();
      L.inbox.shift();
      if (m.bad) return resync();
      if (handle(m) === false) return resync();
    }
  }
  function handle(m) {
    var d = m.d;
    if (m.type === 'ack') {
      var i = -1;
      L.pending.some(function (p, k) { if (p.cid === d.cid) { i = k; return true; } return false; });
      if (i < 0) return false;
      L.base = applyTo(L.base, L.pending.splice(i, 1)[0]);
      L.seq = d.seq;
      return true;
    }
    var c = { kind: d.kind, x: d.x, y: d.y, cmd: d.cmd, patch: m.bmp, put: d.kind === 'put' ? opaque(m.bmp) : null };
    L.base = applyTo(L.base, c);
    L.seq = d.seq;
    if (L.base.w !== d.w || L.base.h !== d.h) return false;
    if (d.by !== L.me) clearPreview(d.by);
    show(c);
    return true;
  }
  // Bild neu vom Server holen: beim Beitreten, nach einer Unterbrechung und wenn etwas nicht zusammenpasst
  function resync() {
    if (!L) return;
    L.syncing = true;
    var lob = L, token = L.syncToken = {};
    (function wait() {
      if (lob.sending) return setTimeout(wait, 50);
      fetch('/paint/lobby/' + encodeURIComponent(lob.id) + '/bild.png', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('Das Bild der Lobby ließ sich nicht laden.');
        var seq = Number(r.headers.get('X-Seq')) || 0;
        return r.blob().then(decodeBlob).then(function (b) { return { b: opaque(b), seq: seq }; });
      }).then(function (x) {
        if (lob !== L || L.syncToken !== token) return;
        L.base = x.b; L.seq = x.seq;
        L.pending = L.pending.filter(function (p) { return !p.seq || p.seq > x.seq; });
        L.inbox = L.inbox.filter(function (m) { return m.d.seq > x.seq; });
        L.syncing = false;
        if (I.idle()) showAll(); else L.needAll = true;
        pump(); send();
      }).catch(function (e) { if (lob === L && L.syncToken === token) ended(e.message); });
    }());
  }

  // ---------- Eigene Schritte an den Server, einer nach dem anderen ----------
  var newCid = function () { return 'c' + (++cidN) + RND; };
  function commit(e) {
    if (!canPaint()) { I.hint('Du siehst in dieser Lobby nur zu.'); L.needAll = true; schedule(); return; }
    var p;
    if (e.full) p = e.cmd ? { kind: 'cmd', cmd: e.cmd } : { kind: 'put', put: opaque(P.clone(e.after)) };
    else {
      var d = diff(e.before, e.after, e.r.x, e.r.y);
      if (!d) return;
      p = { kind: 'patch', x: d.x, y: d.y, patch: d.patch };
    }
    p.cid = newCid();
    L.pending.push(p);
    L.queue.push(p);
    send();
  }
  function body(p) {
    if (p.undo != null) return Promise.resolve({ redo: p.undo });
    if (p.kind === 'cmd') return Promise.resolve({ cmd: p.cmd });
    return toB64(p.kind === 'put' ? p.put : p.patch).then(function (data) { return p.kind === 'put' ? { put: data } : { x: p.x, y: p.y, data: data }; });
  }
  function send() {
    if (!L || L.sending || L.syncing || !L.sid || !L.queue.length) return;
    var lob = L, p = L.queue.shift();
    L.sending = true;
    body(p).then(function (b) {
      b.sid = lob.sid; b.cid = p.cid;
      return I.api('/paint/lobby/' + encodeURIComponent(lob.id) + (p.undo != null ? '/undo' : '/op'), { json: b });
    }).then(function (r) { p.seq = r.seq; }, function (err) {
      if (lob !== L) return;
      if (p.undo == null) { var i = L.pending.indexOf(p); if (i >= 0) { L.pending.splice(i, 1); L.needAll = true; schedule(); } }
      I.hint(err.message);
      if (p.undo != null) I.msgbox(err.message, 'ℹ️');
    }).then(function () { lob.sending = false; if (lob === L) send(); });
  }
  function undo(redo) {
    if (!canPaint()) return I.hint('Du siehst in dieser Lobby nur zu.');
    L.queue.push({ undo: !!redo, cid: newCid() });
    send();
  }

  // ---------- Zeiger und Vorschau der anderen ----------
  function moved(p) {
    L.lastPos = p;
    if (!L.moveTimer) L.moveTimer = setTimeout(sendMove, Math.max(0, 80 - (Date.now() - (L.lastSent || 0))));
  }
  function sendMove() {
    if (!L) return;
    L.moveTimer = null;
    if (!L.sid || !L.lastPos) return;
    var pv = I.busyPreview, out = null, more = false;
    if (pv && pv.k === 's') {
      if (L.pvRef !== pv) { L.pvRef = pv; L.pvSent = 0; L.pvId = (L.pvId || 0) + 1; }
      var pts = pv.pts.slice(L.pvSent, L.pvSent + 150);
      out = { k: 's', id: L.pvId, pts: pts, c: pv.c, sh: pv.sh, sz: pv.sz };
      L.pvSent += pts.length;
      more = L.pvSent < pv.pts.length;
    } else if (pv) out = { k: pv.k, a: pv.a, b: pv.b, c: pv.c, w: pv.w, o: pv.o };
    var key = L.lastPos.join() + '|' + JSON.stringify(out);
    if (key === L.lastKey) return;
    L.lastKey = key;
    L.lastSent = Date.now();
    fetch('/paint/lobby/' + encodeURIComponent(L.id) + '/zeiger', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': I.CSRF },
      body: JSON.stringify({ sid: L.sid, x: L.lastPos[0], y: L.lastPos[1], pv: out }),
    }).catch(function () { /* nur Zeiger */ });
    if (more) moved(L.lastPos);
  }
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) : 0; };
  var pt = function (q) { return Array.isArray(q) ? [num(q[0]), num(q[1])] : [0, 0]; };
  function onCursor(d) {
    if (d.by === L.me) return;
    if (d.gone) { removeCursor(d.by); clearPreview(d.by); return; }
    var c = L.cursors[d.by];
    if (!c) {
      c = L.cursors[d.by] = { el: document.createElement('div') };
      c.el.className = 'pt-rc';
      c.el.style.setProperty('--c', 'hsl(' + (d.by * 47 % 360) + ',80%,40%)');
      c.el.innerHTML = '<i></i><span></span>';
      cursorsEl.appendChild(c.el);
    }
    c.el.querySelector('span').textContent = d.name || '';
    c.x = d.x; c.y = d.y; c.t = Date.now();
    placeCursor(c);
    if (d.pv && typeof d.pv === 'object') updatePreview(d.by, d.pv);
    else if (L.previews[d.by]) L.previews[d.by].ended = Date.now();
  }
  function placeCursor(c) {
    c.el.hidden = c.x == null;
    c.el.style.left = (c.x + 0.5) * I.zoom + 'px'; c.el.style.top = (c.y + 0.5) * I.zoom + 'px';
  }
  function placeCursors() { if (L) Object.keys(L.cursors).forEach(function (k) { placeCursor(L.cursors[k]); }); redrawPreviews(); }
  function removeCursor(by) { var c = L.cursors[by]; if (c) { c.el.remove(); delete L.cursors[by]; } }
  // Vorschau mit denselben Werkzeugen wie beim Malen, auf einer eigenen Ebene über dem Bild
  function paintTemp(x0, y0, w, h, fn) {
    w = Math.min(w, 4000); h = Math.min(h, 4000);
    if (w < 1 || h < 1) return;
    var tmp = { w: w, h: h, d: new Uint8ClampedArray(w * h * 4) };
    fn(tmp);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(tmp.d, w, h), 0, 0);
    rctx.drawImage(c, x0, y0);
  }
  function drawStroke(pv, pts) {
    if (!pts.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, m = pv.sz + 2;
    pts.forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    x0 -= m; y0 -= m;
    paintTemp(x0, y0, x1 - x0 + m + 1, y1 - y0 + m + 1, function (t) {
      P.stroke(t, pts.map(function (q) { return [q[0] - x0, q[1] - y0]; }), pv.c, P.stamp(pv.sh, pv.sz));
    });
  }
  function drawShape(pv) {
    var m = pv.w + 3, x0 = Math.min(pv.a[0], pv.b[0]) - m, y0 = Math.min(pv.a[1], pv.b[1]) - m;
    paintTemp(x0, y0, Math.abs(pv.a[0] - pv.b[0]) + 2 * m + 1, Math.abs(pv.a[1] - pv.b[1]) + 2 * m + 1, function (t) {
      if (pv.k === 'line') P.line(t, pv.a[0] - x0, pv.a[1] - y0, pv.b[0] - x0, pv.b[1] - y0, pv.c, pv.w);
      else P.shape(t, pv.k, pv.a[0] - x0, pv.a[1] - y0, pv.b[0] - x0, pv.b[1] - y0, pv.o);
    });
  }
  function updatePreview(by, raw) {
    var color = function (v) { return num(v) & 0xffffff; };
    var old = L.previews[by];
    if (raw.k === 's') {
      var sh = SHAPES.indexOf(raw.sh) >= 0 ? raw.sh : 'square', sz = Math.max(1, Math.min(12, num(raw.sz)));
      var pts = (Array.isArray(raw.pts) ? raw.pts : []).slice(0, 200).map(pt);
      if (!old || old.k !== 's' || old.id !== raw.id) old = L.previews[by] = { k: 's', id: raw.id, pts: [], c: color(raw.c), sh: sh, sz: sz };
      var seg = old.pts.length ? [old.pts[old.pts.length - 1]].concat(pts) : pts;
      old.pts = old.pts.concat(pts);
      old.ended = 0;
      drawStroke(old, seg);
    } else if (KINDS.indexOf(raw.k) >= 0) {
      var o = raw.o && typeof raw.o === 'object' ? raw.o : {};
      L.previews[by] = { k: raw.k, a: pt(raw.a), b: pt(raw.b), c: color(raw.c), w: Math.max(1, Math.min(5, num(raw.w))),
        o: { stroke: o.stroke == null ? null : color(o.stroke), fill: o.fill == null ? null : color(o.fill), width: Math.max(1, Math.min(5, num(o.width))) } };
      redrawPreviews();
    }
  }
  function clearPreview(by) { if (L.previews[by]) { delete L.previews[by]; redrawPreviews(); } }
  function redrawPreviews() {
    rctx.clearRect(0, 0, I.remote.width, I.remote.height);
    if (!L) return;
    Object.keys(L.previews).forEach(function (k) { var pv = L.previews[k]; if (pv.k === 's') drawStroke(pv, pv.pts); else drawShape(pv); });
  }
  // Vorschauen ohne Abschluss (Verbindung weg) und alte Zeiger aufräumen
  setInterval(function () {
    if (!L) return;
    var t = Date.now();
    Object.keys(L.previews).forEach(function (k) { var pv = L.previews[k]; if (pv.ended && t - pv.ended > 2500) clearPreview(k); });
    Object.keys(L.cursors).forEach(function (k) { if (t - L.cursors[k].t > 60000) L.cursors[k].el.hidden = true; });
  }, 1000);

  // ---------- Seitenleiste: wer ist da, Unterhaltung ----------
  function me() { return L.state.people.filter(function (u) { return u.id === L.me; })[0]; }
  function isHost() { return !!L && L.state.hostId === L.me; }
  function canPaint() { if (!L) return true; var m = me(); return isHost() || L.state.everyone || !!(m && m.paint); }
  function renderSide() {
    var s = L.state, host = isHost();
    $('[data-lobby=name]').textContent = '👥 ' + s.name;
    $('[data-lobby=info]').textContent = s.w + ' × ' + s.h + ' · ' + s.people.length + ' dabei' + (s.everyone ? '' : ' · malen nur mit Malrecht') + (s.hidden ? ' · versteckt' : '');
    $('[data-lobby-act=settings]').hidden = !host;
    $('[data-lobby=people]').innerHTML = s.people.map(function (u) {
      var icon = u.host ? '👑' : u.paint ? '✏️' : '👁️';
      return '<li><button type="button" class="pt-person" data-u="' + u.id + '" title="' + esc(u.host ? 'Gastgeber' : u.paint ? 'Darf malen' : 'Sieht zu') + '">' +
        '<i style="background:hsl(' + (u.id * 47 % 360) + ',80%,40%)"></i>' + icon + ' ' + esc(u.name) + (u.id === L.me ? ' (du)' : '') + '</button></li>';
    }).join('');
    $('[data-lobby=chat]').hidden = !s.chat;
    I.setDoc({ title: s.name });
    if (!canPaint()) I.hint('Du siehst in dieser Lobby nur zu. Der Gastgeber kann dir Malrechte geben.');
  }
  function fmtTime(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function chatLine(m) { return '<p><button type="button" class="pt-chat-name" data-user="' + esc(m.user) + '">' + esc(m.name) + '</button> ' + esc(m.text) + ' <small>' + fmtTime(m.at) + '</small></p>'; }
  function renderChat(add) {
    var log = $('[data-lobby=log]'), stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    if (add) { var hint = log.querySelector('.muted'); if (hint) hint.remove(); log.insertAdjacentHTML('beforeend', chatLine(add)); }
    else log.innerHTML = L.chat.length ? L.chat.map(chatLine).join('') : '<p class="muted"><small>Hier könnt ihr euch unterhalten. Gespeichert wird nichts.</small></p>';
    if (stick || !add) log.scrollTop = log.scrollHeight;
  }
  function userMenu(e, u) {
    if (!window.RetroUserMenu || !u) return;
    var items = [], s = L.state;
    if (isHost() && !u.host && !s.everyone) {
      items.push(u.paint ? { label: '🚫 Malrecht entziehen', run: function () { control({ action: 'rights', user: u.id, allow: false }); } }
        : { label: '✏️ Malrecht geben', run: function () { control({ action: 'rights', user: u.id, allow: true }); } });
    }
    var note = u.host ? '👑 Gastgeber dieser Lobby' : u.paint ? '✏️ Malt mit' : '👁️ Sieht zu' + (isHost() && s.everyone ? ' (unter ⚙️ kannst du das Malen auf Freigegebene beschränken)' : '');
    window.RetroUserMenu.open(e, u.user, { note: note, items: items });
  }
  side.addEventListener('click', function (e) {
    var b = e.target.closest('[data-u]');
    if (b) return userMenu(e, L.state.people.filter(function (u) { return u.id === Number(b.dataset.u); })[0]);
    var n = e.target.closest('.pt-chat-name');
    if (n && window.RetroUserMenu) return window.RetroUserMenu.open(e, n.dataset.user, {});
    var a = e.target.closest('[data-lobby-act]');
    if (a) api[a.dataset.lobbyAct]();
  });
  $('[data-lobby=chatform]').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = e.target.text, text = inp.value.trim();
    if (!text || !L) return;
    I.api('/paint/lobby/' + encodeURIComponent(L.id) + '/chat', { json: { text: text } }).then(function () { inp.value = ''; }, function (err) { I.hint(err.message); });
  });
  function control(b) {
    return I.api('/paint/lobby/' + encodeURIComponent(L.id), { json: b }).catch(function (err) { I.msgbox(err.message, '⚠️'); });
  }

  // ---------- Beitreten und Verlassen ----------
  var hooks = { commit: commit, undo: undo, canPaint: canPaint, isHost: isHost, moved: moved, zoomed: placeCursors, save: save, leave: function () { leave(); } };
  function start(id, state) {
    I.finishAll();
    L = { id: id, sid: null, me: I.ME.id, state: state, base: null, seq: 0, pending: [], queue: [], inbox: [], syncing: true, chat: [], cursors: {}, previews: {} };
    I.attach(hooks);
    side.hidden = false;
    root.classList.add('in-lobby');
    renderSide();
    renderChat();
    try { history.replaceState(null, '', '/paint?lobby=' + encodeURIComponent(id)); } catch (e) { /* egal */ }
    connect();
  }
  function connect() {
    var lob = L, es = L.es = new EventSource('/paint/lobby/' + encodeURIComponent(L.id) + '/events');
    var on = function (ev, fn) { es.addEventListener(ev, function (m) { if (lob === L) fn(JSON.parse(m.data)); }); };
    on('hello', function (d) {
      L.sid = d.sid; L.me = d.me; L.state = d.state; L.chat = d.chat || [];
      renderSide(); renderChat();
      resync();
    });
    on('state', function (d) { L.state = d; renderSide(); });
    on('op', function (d) { L.inbox.push({ type: 'op', d: d }); pump(); });
    on('ack', function (d) { L.inbox.push({ type: 'ack', d: d }); pump(); });
    on('cursor', onCursor);
    on('chat', function (d) { L.chat.push(d); if (L.chat.length > 50) L.chat.shift(); renderChat(d); });
    on('closed', function () { ended('Der Gastgeber hat die Lobby geschlossen. Das Bild bleibt bei dir offen.'); });
    es.onerror = function () {
      if (lob !== L) return;
      L.sid = null;
      if (es.readyState !== 2) return;   // der Browser verbindet sich von selbst neu
      I.api('/paint/lobby/' + encodeURIComponent(lob.id)).then(function () { if (lob === L) setTimeout(function () { if (lob === L) connect(); }, 3000); },
        function (e) { if (lob === L) ended(e.message); });
    };
  }
  function leave() {
    if (!L) return;
    var lob = L;
    L = null;
    if (lob.es) lob.es.close();
    clearTimeout(lob.timer); clearTimeout(lob.moveTimer);
    Object.keys(lob.cursors).forEach(function (k) { lob.cursors[k].el.remove(); });
    rctx.clearRect(0, 0, I.remote.width, I.remote.height);
    side.hidden = true;
    root.classList.remove('in-lobby');
    I.attach(null);
    I.setDoc({ title: lob.state.name, dirty: true });
    I.hint('Lobby verlassen. Das Bild ist jetzt nur noch bei dir offen.');
    try { history.replaceState(null, '', '/paint'); } catch (e) { /* egal */ }
  }
  function ended(msg) { leave(); I.msgbox(msg, 'ℹ️'); }
  function join(id) {
    if (L && L.id === id) return;
    return I.api('/paint/lobby/' + encodeURIComponent(id)).then(function (j) {
      return I.confirmDiscard().then(function (ok) { if (ok) start(id, j.lobby); });
    }).catch(function (e) { I.msgbox(e.message, '⚠️'); });
  }

  // ---------- Dialoge ----------
  function list() {
    var dlg = I.dialog('Lobbys', '<p>Malt gemeinsam an einem Bild. Alle sehen sofort, was die anderen malen.</p><div data-list><p>Lade …</p></div>', ['Neue Lobby…', 'Schließen'], 'lobby-dialog');
    var box = dlg.el.querySelector('[data-list]');
    I.api('/paint/lobbys').then(function (j) {
      box.innerHTML = j.lobbies.length ? '<table class="list"><thead><tr><th>Lobby</th><th>Gastgeber</th><th class="num">Dabei</th><th>Größe</th><th></th></tr></thead><tbody>' +
        j.lobbies.map(function (l) {
          var here = L && L.id === l.id;
          return '<tr><td>' + esc(l.name) + (l.hidden ? ' <small>(versteckt)</small>' : '') + '</td><td>' + esc(l.host) + '</td><td class="num">' + l.people + '</td><td>' + l.w + ' × ' + l.h + '</td>' +
            '<td>' + (here ? '<small>du bist hier</small>' : '<button type="button" class="small" data-join="' + esc(l.id) + '">Beitreten</button>') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">Gerade ist keine Lobby offen. Mach eine auf!</p>';
    }).catch(function (e) { box.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; });
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-join]'); if (b) { dlg.close('Schließen'); join(b.dataset.join); } });
    dlg.done.then(function (r) { if (r.button === 'Neue Lobby…') create(); });
  }
  function create() {
    var size = I.size, img = I.img;
    I.dialog('Neue Lobby', '<label>Name<input type="text" name="name" maxlength="60" class="w100" value="' + esc('Lobby von ' + (root.dataset.username || '')) + '"></label>' +
      '<fieldset class="groupbox"><legend>Anfangen mit</legend>' +
      '<label class="inline"><input type="radio" name="start" value="blank" checked> leerer Leinwand: </label><input type="number" name="w" min="1" max="' + I.MAX_W + '" value="' + size[0] + '" style="width:64px"> × <input type="number" name="h" min="1" max="' + I.MAX_H + '" value="' + size[1] + '" style="width:64px"> Pixel<br>' +
      '<label class="inline"><input type="radio" name="start" value="current"> dem gerade offenen Bild (' + img.w + ' × ' + img.h + ')</label>' +
      '<p><small>Ein gespeichertes Bild öffnest du vorher mit Datei → Öffnen.</small></p></fieldset>' +
      '<label class="inline"><input type="checkbox" name="everyone" checked> Alle dürfen malen (sonst nur, wem du es erlaubst)</label><br>' +
      '<label class="inline"><input type="checkbox" name="chat" checked> Unterhaltung</label><br>' +
      '<label class="inline"><input type="checkbox" name="hidden"> Versteckt: nur mit Einladungslink zu finden</label>' +
      '<p><small>Jede Minute wird das Bild als Entwurf unter deinen Bildern gesichert.</small></p>', ['Lobby öffnen', 'Abbrechen']).then(function (r) {
      if (r.button !== 'Lobby öffnen') return;
      var f = r.form, current = f.start.value === 'current';
      var b = { name: f.name.value, everyone: f.everyone.checked, chat: f.chat.checked, hidden: f.hidden.checked };
      var go = function () {
        I.finishAll();
        var data = current ? toB64(opaque(P.clone(I.img))) : Promise.resolve(null);
        return data.then(function (d) {
          if (d) b.data = d; else { b.w = I.clamp(Number(f.w.value) || 640, 1, I.MAX_W); b.h = I.clamp(Number(f.h.value) || 480, 1, I.MAX_H); }
          return I.api('/paint/lobbys', { json: b });
        }).then(function (j) { return I.api('/paint/lobby/' + encodeURIComponent(j.id)).then(function (k) { start(j.id, k.lobby); }); })
          .catch(function (e) { I.msgbox(e.message, '⚠️'); });
      };
      // Mit dem offenen Bild wird nichts verworfen, es zieht in die Lobby um
      if (current && !L) return go();
      return I.confirmDiscard().then(function (ok) { if (ok) go(); });
    });
  }
  function link() {
    if (!L) return;
    var url = location.origin + '/paint?lobby=' + encodeURIComponent(L.id);
    var dlg = I.dialog('🔗 Einladen', '<p>Schick diesen Link an andere Mitglieder. Wer ihn öffnet, landet direkt in dieser Lobby.</p><input type="text" class="w100" name="link" readonly value="' + esc(url) + '">', ['Kopieren', 'Schließen']);
    var inp = dlg.el.querySelector('[name=link]');
    setTimeout(function () { inp.select(); }, 0);
    dlg.done.then(function (r) { if (r.button === 'Kopieren' && navigator.clipboard) navigator.clipboard.writeText(url).then(function () { I.hint('Link kopiert.'); }, function () { /* markiert */ }); });
  }
  function settings() {
    if (!L || !isHost()) return;
    var s = L.state;
    I.dialog('⚙️ Lobby-Einstellungen', '<label>Name<input type="text" name="name" maxlength="60" class="w100" value="' + esc(s.name) + '"></label>' +
      '<label class="inline"><input type="checkbox" name="everyone"' + (s.everyone ? ' checked' : '') + '> Alle dürfen malen</label><br>' +
      '<small>Sonst malen nur du und wem du es erlaubst: Klick auf einen Namen rechts.</small><br>' +
      '<label class="inline"><input type="checkbox" name="chat"' + (s.chat ? ' checked' : '') + '> Unterhaltung</label><br>' +
      '<label class="inline"><input type="checkbox" name="hidden"' + (s.hidden ? ' checked' : '') + '> Versteckt: nur mit Einladungslink zu finden</label>',
    ['OK', 'Lobby schließen', 'Abbrechen']).then(function (r) {
      var f = r.form;
      if (r.button === 'OK') control({ action: 'settings', name: f.name.value, everyone: f.everyone.checked, chat: f.chat.checked, hidden: f.hidden.checked });
      if (r.button === 'Lobby schließen') {
        I.msgbox('Lobby für alle schließen? Das Bild bleibt bei allen offen und wird als Entwurf bei dir gesichert.', '⚠️', ['Schließen', 'Abbrechen']).then(function (x) {
          if (x === 'Schließen') control({ action: 'close' });
        });
      }
    });
  }
  // Datei → Speichern: gespeichert wird der Stand auf dem Server, mit den ausgewählten Mitmalern
  function save(asNew) {
    // Frischer Stand: wer inzwischen mitgemalt hat, steht sonst noch als Zuschauer da
    var lob = L;
    I.api('/paint/lobby/' + encodeURIComponent(L.id)).then(function (j) { if (lob === L) saveDialog(asNew, j.lobby); }, function (e) { I.msgbox(e.message, '⚠️'); });
  }
  function saveDialog(asNew, s) {
    var people = {};
    s.painted.concat(s.people).forEach(function (u) { if (u.id !== L.me && !people[u.id]) people[u.id] = u; });
    var list = Object.keys(people).map(function (k) { return people[k]; });
    var rows = list.length ? list.map(function (u) {
      return '<label class="inline"><input type="checkbox" name="p" value="' + u.id + '"' + (u.strokes ? ' checked' : '') + '> ' + esc(u.name) + (u.strokes ? ' <small>(' + u.strokes + ' Änderungen)</small>' : ' <small>(hat zugesehen)</small>') + '</label><br>';
    }).join('') : '<p class="muted"><small>Bisher malst du alleine.</small></p>';
    I.dialog(asNew ? 'Speichern unter' : 'Speichern', '<label>Titel<input type="text" name="title" maxlength="80" class="w100" value="' + esc(L.savedTitle || s.name) + '" required></label>' +
      '<label>Wer darf es sehen?</label>' + I.visSelect(L.savedVis || 'private') +
      '<fieldset class="groupbox"><legend>Mitgemalt haben</legend>' + rows + '<small>Wer hier steht, findet das Bild unter Datei → Öffnen → Gemeinsam gemalt.</small></fieldset>',
    ['Speichern', 'Auf meinem PC speichern…', 'Abbrechen']).then(function (r) {
      if (r.button === 'Auf meinem PC speichern…') return I.downloadDialog();
      if (r.button !== 'Speichern' || !L) return;
      var f = r.form, picked = [].slice.call(f.querySelectorAll('[name=p]:checked')).map(function (x) { return Number(x.value); });
      var b = { title: f.title.value.trim(), visibility: f.vis.value, painters: picked, asNew: !!asNew };
      I.hint('Speichere …');
      I.api('/paint/lobby/' + encodeURIComponent(L.id) + '/speichern', { json: b }).then(function (j) {
        if (L) { L.savedTitle = j.artwork.title; L.savedVis = j.artwork.visibility; }
        I.hint('Gespeichert: ' + j.artwork.title + ' (unter Meine Bilder)' + (j.note ? ' · ' + j.note : ''));
        if (j.note) I.msgbox(j.note, 'ℹ️');
      }, function (e) { I.hint(); I.msgbox(e.message, '⚠️'); });
    });
  }

  var api = { list: list, create: create, link: link, settings: settings, leave: leave, join: join };
  window.RetroPaintLobby = api;
  var want = new URLSearchParams(location.search).get('lobby');
  if (want) join(want);
}());
