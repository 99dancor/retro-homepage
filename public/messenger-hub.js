// Messenger im Desktop (ICU im XP-Design, DSN im 98-Design): eine Live-Verbindung pro Tab für alle Messenger-Fenster.
// Zeigt den eigenen Status und ungelesene Nachrichten neben der Uhr, spielt Töne, blendet Hinweise unten rechts ein
// („Anna ist jetzt online“, neue Nachricht) und meldet, ob gerade jemand vor dem Bildschirm sitzt (automatisch abwesend).
// Die Fenster (public/messenger.js) hängen sich über window.RetroMessenger.on(fn) an und bekommen alle Ereignisse.
(function () {
  'use strict';
  var body = document.body;
  if (!body.classList.contains('desktop') || !body.dataset.user || !window.EventSource) return;
  var CSRF = body.dataset.csrf;
  var tray = document.getElementById('msgrtray');
  var cid = Math.random().toString(36).slice(2, 12);
  var listeners = [], state = { me: null, unread: 0, prefs: null, contacts: null }, known = null;
  var es = null, lastInput = Date.now(), idle = false, contactsTimer = null;

  function xp() { return document.documentElement.classList.contains('theme-xp'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function emit(type, data) {
    listeners.slice().forEach(function (fn) { try { fn(type, data); } catch (e) { /* Fenster schon zu */ } });
  }
  function post(url, data) {
    // Als Formular, das verstehen alle Messenger-Adressen (auch die, die ohne JavaScript gehen)
    var form = new URLSearchParams();
    Object.keys(data || {}).forEach(function (k) { if (data[k] != null) form.append(k, typeof data[k] === 'boolean' ? (data[k] ? '1' : '0') : data[k]); });
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': CSRF, accept: 'application/json' }, body: form })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Das ging gerade nicht.'); return j; }); });
  }

  // ---------- Neben der Uhr ----------
  function showTray() {
    if (!tray) return;
    var st = state.me ? state.me.status : 'offline';
    tray.querySelector('.st').className = 'st st-' + st;
    var c = tray.querySelector('.pm-count');
    c.textContent = state.unread;
    c.hidden = !state.unread;
    tray.classList.toggle('msgr-new', !!state.unread);
    tray.title = (xp() ? 'ICU' : 'DSN Messenger') + (state.unread ? ': ' + state.unread + ' ungelesene Nachrichten' : '');
  }

  // ---------- Töne und Hinweise ----------
  function quiet() { return state.me && state.me.status === 'dnd' && (!state.prefs || state.prefs.quietDnd); }
  function sound(kind) {
    if (quiet() || !window.RetroSound || !state.prefs) return;
    var pick = state.prefs.sounds[kind];
    if (!pick || pick === 'aus') return;
    var name = pick === 'klassisch' ? (kind === 'online' ? 'msgr-online-' : 'msgr-') + (xp() ? 'icu' : 'dsn') : 'msgr-' + pick;
    if (kind === 'nudge' && pick === 'klassisch') name = 'msgr-summen';
    window.RetroSound.play(name);
  }
  var toasts = 0;
  function toast(html, url) {
    if (quiet()) return;
    var el = document.createElement('div');
    el.className = 'msgr-toast window';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="titlebar"><span class="ttl"><i class="st st-logo"></i> ' + (xp() ? 'ICU' : 'DSN Messenger') + '</span><button type="button" class="tb-btn" title="Schließen">×</button></div><div class="body">' + html + '</div>';
    el.style.setProperty('--n', toasts++);
    document.body.appendChild(el);
    var gone = function () { if (el.parentNode) { el.remove(); toasts = Math.max(0, toasts - 1); } };
    el.querySelector('.tb-btn').addEventListener('click', function (e) { e.stopPropagation(); gone(); });
    el.addEventListener('click', function () { gone(); if (url && window.RetroDesk) window.RetroDesk.open(url, true); });
    setTimeout(gone, 7000);
  }
  function avatar(c, size) {
    if (c.avatar) return '<img class="avatar" src="' + esc(c.avatar) + '" alt="" width="' + size + '" height="' + size + '">';
    return '<span class="avatar avatar-letter" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.55) + 'px;background:hsl(' + (c.id * 47 % 360) + ',45%,42%)">' + esc((Array.from(c.name)[0] || '?').toUpperCase()) + '</span>';
  }

  // Ist das Gespräch mit partner gerade das vorderste Fenster?
  function chatUrl(user) { return '/messenger/mit/' + encodeURIComponent(user); }
  function chatActive(user) {
    var d = window.RetroDesk;
    return !!(d && d.activeUrl && d.activeUrl() && d.activeUrl().split(/[?#]/)[0] === chatUrl(user) && !document.hidden);
  }

  // ---------- Kontaktliste: einmal laden, an alle Fenster weitergeben, „ist jetzt online“ erkennen ----------
  function loadContacts() {
    clearTimeout(contactsTimer);
    contactsTimer = setTimeout(function () {
      fetch('/api/messenger/kontakte', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        var before = known;
        known = {};
        d.contacts.forEach(function (c) { known[c.user] = c.status; });
        if (before && state.prefs && state.prefs.toast) {
          d.contacts.forEach(function (c) {
            if (c.status !== 'offline' && before[c.user] === 'offline') {
              sound('online');
              toast('<div class="msgr-toast-row">' + avatar(c, 32) + '<div><b>' + esc(c.name) + '</b> ' + (xp() ? 'ist jetzt online.' : 'hat sich gerade angemeldet.') +
                '<br><small>' + (xp() ? 'Klick hier zum Schreiben' : 'Sofortnachricht senden') + '</small></div></div>', chatUrl(c.user));
            }
          });
        }
        state.contacts = d;
        state.unread = d.unread;
        if (d.me) state.me = Object.assign({}, state.me || {}, d.me);
        showTray();
        emit('kontakte-daten', d);
      }).catch(function () {});
    }, 250);
  }

  // ---------- Live-Verbindung ----------
  function on(type, fn) { es.addEventListener(type, function (e) { var d = {}; try { d = JSON.parse(e.data); } catch (err) { /* leer */ } fn(d); }); }
  function connect() {
    es = new EventSource('/api/messenger/stream?c=' + cid);
    on('hallo', function (d) {
      state.me = d; state.unread = d.unread || 0; state.prefs = d.prefs || state.prefs;
      showTray(); emit('ich', d); loadContacts();
      if (d.prefs && d.prefs.autostart && !connect.started && window.RetroDesk) { connect.started = true; window.RetroDesk.open('/messenger', false); }
      connect.started = true;
    });
    on('ich', function (d) { state.me = Object.assign({}, state.me, d); showTray(); emit('ich', state.me); });
    on('kontakte', function () { loadContacts(); });
    on('ungelesen', function (d) { state.unread = d.n || 0; showTray(); emit('ungelesen', d); loadContacts(); });
    on('einstellungen', function (d) { state.prefs = d; emit('einstellungen', d); });
    on('tippt', function (d) { emit('tippt', d); });
    on('gelesen', function (d) { emit('gelesen', d); });
    on('nachricht', function (d) {
      emit('nachricht', d);
      var mine = state.me && d.from === state.me.user;
      if (mine) return;
      var open = chatActive(d.partner);
      if (d.kind === 'nudge') {
        sound('nudge');
        if (window.RetroDesk) { var w = window.RetroDesk.open(chatUrl(d.partner), false); if (w && w.el) { w.el.classList.remove('msgr-shake'); void w.el.offsetWidth; w.el.classList.add('msgr-shake'); } }
        return;
      }
      sound('msg');
      if (!open) {
        var text = d.kind === 'invite' && d.meta ? '🎲 lädt dich ein: ' + d.meta.what + ' „' + d.meta.name + '“' : d.body.length > 90 ? d.body.slice(0, 90) + '…' : d.body;
        toast('<div class="msgr-toast-row"><div><b>' + esc(d.name) + '</b>' + (xp() ? ':' : ' sagt:') + '<br><span>' + esc(text) + '</span></div></div>', chatUrl(d.partner));
      }
    });
    es.onerror = function () { if (state.me) { state.me.status = 'offline'; showTray(); } };
  }

  // ---------- Automatisch abwesend ----------
  function touched() { lastInput = Date.now(); if (idle) checkIdle(); }
  ['pointerdown', 'keydown', 'pointermove', 'wheel'].forEach(function (t) { document.addEventListener(t, touched, { passive: true }); });
  function checkIdle() {
    var mins = state.prefs ? state.prefs.away : 10;
    var now = !!mins && Date.now() - lastInput > mins * 60000;
    if (now === idle) return;
    idle = now;
    post('/api/messenger/aktiv', { c: state.me && state.me.conn || cid, idle: idle }).catch(function () {});
  }
  setInterval(checkIdle, 30000);

  if (tray) tray.addEventListener('click', function (e) { e.preventDefault(); if (window.RetroDesk) window.RetroDesk.open('/messenger', false); });

  window.RetroMessenger = {
    // Fenster hängen sich an; gibt eine Funktion zum Abmelden zurück
    on: function (fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    state: function () { return state; },
    touched: touched,
    post: post,
    reload: loadContacts,
    setStatus: function (status, msg) {
      return post('/api/messenger/status', { status: status, msg: msg }).then(function (d) { state.me = Object.assign({}, state.me, d); showTray(); emit('ich', state.me); return d; });
    },
  };
  connect();
  showTray();
})();
