// Durak (Startmenü → Spiele und Apps → 🎴 Durak): Tischliste, Spieltisch, Statistik und Regeln. Den Tisch schickt
// der Server per Server-Sent Events (/durak/tisch/<id>/events), jedem Browser mit nur seinen eigenen Handkarten;
// Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Aufbau wie public/poker.js.
(function () {
  'use strict';
  var root = document.getElementById('dk');
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, ME = Number(root.dataset.user);
  var main = $('dk-main'), statusEl = $('dk-status'), meEl = $('dk-me'), dlg = $('dk-dlg');
  var Sound = window.RetroSound || { play: function () {} };
  var view = 'tische', me = null, tables = [], mineId = null, tab = null, stats = null, statsTab = 'board';
  var RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  // ---------- Kleinkram ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function date(ts) { return new Date(ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function pct(n, of) { return of ? Math.round(n / of * 100) + ' %' : '–'; }
  function status(text) { statusEl.textContent = text; }
  function req(method, url, body) {
    var opts = { method: method, headers: { 'x-csrf-token': CSRF, accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
        return j;
      });
    });
  }
  function oops(e) { status('⚠ ' + e.message); Sound.play('fehler'); }
  function dialog(title, html, buttons) {
    $('dk-dlg-title').textContent = title;
    $('dk-dlg-body').innerHTML = html;
    var acts = $('dk-dlg-actions');
    acts.innerHTML = '';
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.value = b.value; el.innerHTML = b.label;
      if (b.danger) el.className = 'danger';
      acts.appendChild(el);
    });
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function () { resolve(dlg.returnValue || 'cancel'); }, { once: true });
      dlg.returnValue = '';
      if (dlg.open) dlg.close();
      dlg.showModal();
      var first = dlg.querySelector('input:not([type=checkbox]), select');
      if (first) first.focus();
    });
  }
  function field(name) { var el = dlg.querySelector('[name=' + name + ']'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; }

  // ---------- Karten ----------
  function cid(c) { return c.r + c.s; }
  function card(c, extra, attrs) {
    if (!c) return '<span class="bj-card back' + (extra ? ' ' + extra : '') + '"' + (attrs || '') + '></span>';
    var red = c.s === '♥' || c.s === '♦';
    return '<span class="bj-card' + (red ? ' red' : '') + (extra ? ' ' + extra : '') + '" title="' + esc(cid(c)) + '"' + (attrs || '') + '><span class="r">' + esc(c.r) + '<br>' + c.s + '</span><span class="s">' + c.s + '</span></span>';
  }
  // Eigene Hand: erst Nicht-Trumpf nach Wert, Trümpfe rechts
  function sortHand(hand, trump) {
    return hand.slice().sort(function (a, b) { return (a.s === trump) - (b.s === trump) || RANKS.indexOf(a.r) - RANKS.indexOf(b.r) || a.s.localeCompare(b.s); });
  }
  function secs(ms) { return Math.ceil(ms / 1000); }

  // ---------- Navigation ----------
  function show(v) {
    if (v === 'tisch' && !tab) v = 'tische';
    view = v;
    root.querySelectorAll('.bj-nav [data-view]').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === v);
      if (a.dataset.view === 'tisch') a.hidden = !tab;
    });
    main.innerHTML = '';
    render();
    if (v === 'tische') loadTables();
    if (v === 'statistik') loadStats();
  }
  root.querySelector('.bj-nav').addEventListener('click', function (e) {
    var a = e.target.closest('[data-view]');
    if (!a) return;
    e.preventDefault();
    show(a.dataset.view);
  });
  function render() {
    if (view === 'tische') renderTables();
    else if (view === 'tisch') renderTable();
    else if (view === 'statistik') renderStats();
    else renderRules();
  }
  function renderMe() {
    if (!me) return;
    meEl.innerHTML = '👤 ' + esc(me.name) + ' · ' + me.games + (me.games === 1 ? ' Spiel · ' : ' Spiele · ') + me.wins + '× Erster · ' + me.duraks + '× Durak';
  }
  var lastRules = null;
  function rules() { return (tab && tab.state && tab.state.rules) || lastRules || { turn: 30, pass: 15 }; }

  // ---------- Tischliste ----------
  function loadTables() {
    return req('GET', '/durak/tische').then(function (j) {
      tables = j.tables; me = j.me; mineId = j.mine;
      renderMe();
      if (view === 'tische') renderTables();
    }).catch(oops);
  }
  function renderTables() {
    var rows = tables.map(function (t) {
      var full = t.players >= t.seats;
      return '<tr><td>' + (t.hidden ? '🔒 ' : '🎴 ') + '<b>' + esc(t.name) + '</b></td><td>' + esc(t.host) + '</td><td>' + t.players + ' / ' + t.seats +
        (t.viewers ? ' <small>+' + t.viewers + ' 👁</small>' : '') + '</td><td>' + esc(t.status) + '</td>' +
        '<td class="bj-acts"><button type="button" class="small" data-join="' + t.id + '"' + (full && mineId !== t.id ? ' title="Alle Plätze besetzt"' : '') + '>' +
        (mineId === t.id ? '↩ Zurück an den Tisch' : full ? '👁 Zusehen' : '🪑 Hinsetzen') + '</button>' +
        (mineId !== t.id && !full ? ' <button type="button" class="small" data-watch="' + t.id + '">👁 Zusehen</button>' : '') + '</td></tr>';
    }).join('');
    main.innerHTML = '<div class="bj-pad"><div class="actions bj-top"><button type="button" data-act="create">➕ Neuer Tisch</button><button type="button" data-act="refresh">🔄 Aktualisieren</button>' +
      '<small>' + tables.length + ' ' + (tables.length === 1 ? 'Tisch' : 'Tische') + ' offen</small></div>' +
      (tables.length ? '<table class="list"><thead><tr><th>Tisch</th><th>Gastgeber</th><th>Plätze</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="bj-empty">Gerade ist kein Tisch offen. Mach einen auf und lade andere mit dem Link ein. Gespielt wird ab zwei Spielern.</p>') +
      '<p><small>Klassischer Durak mit 36 Karten und Zuwerfen, 2 bis 6 Spieler. Versteckte Tische siehst nur du per Link. Leere Tische schließen nach 10 Minuten. Du kannst nur an einem Tisch gleichzeitig sitzen.</small></p></div>';
  }
  function seatOpts(cur) { return [2, 3, 4, 5, 6].map(function (n) { return '<option' + (n === cur ? ' selected' : '') + '>' + n + '</option>'; }).join(''); }
  function createTable() {
    dialog('➕ Neuer Duraktisch',
      '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc('Duraktisch von ' + (me ? me.name : '')) + '"></label>' +
      '<label>Plätze:<select name="seats" class="w100">' + seatOpts(4) + '</select></label>' +
      '<label class="inline"><input type="checkbox" name="hidden"> Nicht in der Liste zeigen (nur mit Link)</label>' +
      '<p><small>Sobald alle am Tisch auf „Bereit“ klicken, wird gegeben.</small></p>',
      [{ label: '<b>Erstellen</b>', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      req('POST', '/durak/tische', { name: field('name'), seats: Number(field('seats')), hidden: field('hidden') })
        .then(function (j) { enter(j.id, true); }).catch(oops);
    });
  }

  // ---------- Am Tisch ----------
  function enter(id, sit) {
    if (tab && tab.id === id) { show('tisch'); if (sit) ctl('sit'); return; }
    leaveView();
    tab = { id: id, state: null, es: null, sitAfterJoin: !!sit, pick: null };
    tab.es = new EventSource('/durak/tisch/' + encodeURIComponent(id) + '/events');
    tab.es.addEventListener('state', function (e) { onState(JSON.parse(e.data)); });
    tab.es.addEventListener('ping', function (e) { if (tab) tab.offset = JSON.parse(e.data).now - Date.now(); });
    tab.es.addEventListener('closed', function () { gone('Der Tisch wurde geschlossen.'); });
    tab.es.addEventListener('error', function () {
      if (!tab) return;
      if (tab.es.readyState === 2) gone('Diesen Tisch gibt es nicht mehr.');
      else status('Verbindung zum Tisch unterbrochen, verbinde neu …');
    });
    try { history.replaceState(null, '', '/durak?tisch=' + encodeURIComponent(id)); } catch (e) { /* egal */ }
    show('tisch');
    status('Verbinde mit dem Tisch …');
  }
  function leaveView() {
    if (!tab) return;
    tab.es.close();
    tab = null;
    try { history.replaceState(null, '', '/durak'); } catch (e) { /* egal */ }
  }
  function gone(msg) {
    leaveView();
    status(msg);
    show('tische');
  }
  function mySeat() { return tab && tab.state ? tab.state.seats.filter(function (s) { return s && s.id === ME; })[0] || null : null; }
  function isHost() { return tab && tab.state && (tab.state.hostId === ME || (me && me.admin)); }
  function ctl(action, extra) {
    if (!tab) return Promise.resolve();
    var body = Object.assign({ action: action }, extra || {});
    return req('POST', '/durak/tisch/' + encodeURIComponent(tab.id), body).catch(oops);
  }

  function onState(s) {
    var first = !tab.state, prev = tab.state;
    tab.state = s; lastRules = s.rules;
    if (tab.sitAfterJoin) { tab.sitAfterJoin = false; if (!mySeat()) ctl('sit'); }
    sounds(prev, s);
    var seat = mySeat();
    if (seat) mineId = s.id;
    else if (mineId === s.id) mineId = null;
    // Nach jedem Spiel stimmen die eigenen Zahlen aus der Datenbank wieder
    if (prev && prev.phase === 'playing' && s.phase === 'result') setTimeout(loadTables, 300);
    if (first) status('Am Tisch „' + s.name + '“.');
    // Gewählte Karte vergessen, wenn sie nicht mehr passt
    if (tab.pick && !(s.options && s.options.defend[tab.pick])) tab.pick = null;
    if (view === 'tisch') renderTable();
  }
  function tableCount(s) { var n = 0; s.table.forEach(function (p) { n += p.d ? 2 : 1; }); return n; }
  function sounds(prev, s) {
    if (!prev) return;
    if (tableCount(s) > tableCount(prev) || (s.hand && prev.hand && s.hand.length > prev.hand.length && s.phase === 'playing')) Sound.play('karte');
    var seat = mySeat();
    if (prev.phase === 'playing' && s.phase === 'result' && s.result) {
      var mine = s.result.order.filter(function (o) { return o.user === (me && me.user); })[0];
      if (mine) Sound.play(mine.durak ? 'fehler' : mine.place === 1 ? 'tusch' : 'ding');
    }
    var myTurn = function (st) { return st.turn && seat && st.turn.seat === seat.i && (st.turn.kind === 'open' || st.turn.kind === 'defend'); };
    if (myTurn(s) && !myTurn(prev)) Sound.play('hinweis');
  }

  // Plätze rund um den ovalen Tisch; der eigene sitzt immer unten in der Mitte
  function spot(slot, n, r) {
    var a = Math.PI / 2 + slot * 2 * Math.PI / n;
    return { x: 50 + 41 * r * Math.cos(a), y: 47 + 36 * r * Math.sin(a) };
  }
  function role(st, s) {
    if (st.phase !== 'playing' || !s.inGame) return '';
    if (s.place) return '<span class="bj-badge win">🏁 ' + s.place + '. raus</span>';
    if (s.i === st.defender) return '<span class="bj-badge lose">🛡 verteidigt' + (st.taking ? ', nimmt' : '') + '</span>';
    if (s.i === st.attacker) return '<span class="bj-badge">⚔ greift an</span>';
    return '';
  }
  function backs(n) {
    var shown = Math.min(n, 8), h = '';
    for (var k = 0; k < shown; k++) h += '<span class="bj-card back"></span>';
    return '<span class="bj-cards dk-backs">' + h + '</span>';
  }
  function seatHtml(s, i, st, slot) {
    var p = spot(slot, st.seatCount, 1);
    var style = 'left:' + p.x.toFixed(1) + '%;top:' + p.y.toFixed(1) + '%';
    if (!s) {
      return '<div class="pk-seat empty" style="' + style + '">' + (mySeat() ? '<span class="bj-free">frei</span>' : '<button type="button" class="small" data-sit="' + i + '">🪑 Hier hinsetzen</button>') + '</div>';
    }
    var mine = s.id === ME;
    var turn = st.turn && (st.turn.seat === i || (st.turn.kind === 'pass' && st.waiting.indexOf(i) >= 0));
    var lost = st.phase === 'result' && st.result && st.result.order.some(function (o) { return o.user === s.user && o.durak; });
    var note = st.phase === 'playing' ? (s.inGame ? (turn ? '⏳ <span data-count="turn">' + secs(st.turn.left) + '</span> s' + (st.turn.kind === 'pass' ? ' zum Zuwerfen' : '') : s.passed ? '✓ fertig' : '') : 'spielt nächste Runde mit')
      : s.ready ? '✓ bereit' : 'noch nicht bereit';
    return '<div class="pk-seat dk-seat' + (turn ? ' turn' : '') + (mine ? ' mine' : '') + (s.place ? ' folded' : '') + (lost ? ' lost' : '') + '" style="' + style + '">' +
      (mine ? '' : '<div class="pk-hole">' + (s.cards ? backs(s.cards) : '') + '</div>') +
      '<button type="button" class="bj-name" data-user="' + esc(s.user) + '" data-uid="' + s.id + '">' + (st.hostId === s.id ? '👑 ' : '') + esc(s.name) + (mine ? ' (du)' : '') + (s.away ? ' 💤' : '') + (s.leaving ? ' 🚪' : '') + '</button>' +
      '<div class="bj-chips">' + (st.phase === 'playing' && s.inGame ? s.cards + (s.cards === 1 ? ' Karte' : ' Karten') : '&nbsp;') + '</div>' +
      '<div>' + role(st, s) + '</div><div class="pk-act">' + note + '</div></div>';
  }
  function renderTable() {
    if (!tab || !tab.state) { main.innerHTML = '<p class="bj-empty">Verbinde mit dem Tisch …</p>'; return; }
    var s = tab.state, seat = mySeat();
    if (!$('dk-felt')) {
      main.innerHTML = '<div class="bj-tools" id="dk-tools"></div><div class="bj-table"><div class="pk-col"><div class="bj-felt pk-felt dk-felt" id="dk-felt"></div>' +
        '<div class="pk-bar dk-bar sunken" id="dk-bar"></div></div><div class="bj-side" id="dk-side"></div></div>';
    }
    $('dk-tools').innerHTML = '<b>' + (s.hidden ? '🔒 ' : '🎴 ') + esc(s.name) + '</b>' + (s.game ? '<span class="tag">Spiel ' + s.game + '</span>' : '') +
      (s.trump && s.phase === 'playing' ? '<span class="tag">Trumpf <b class="' + (s.trump.s === '♥' || s.trump.s === '♦' ? 'dk-red' : '') + '">' + s.trump.s + '</b></span>' : '') + '<span class="tag">36 Karten · mit Zuwerfen</span>';
    var shift = seat ? seat.i : 0;
    var seats = s.seats.map(function (x, i) { return seatHtml(x, i, s, (i - shift + s.seatCount) % s.seatCount); }).join('');
    $('dk-felt').innerHTML = (s.phase === 'result' ? '' : '<div class="bj-motto pk-motto">DURAK · 36 KARTEN</div>') + center(s) + seats;
    renderBar(s, seat);
    renderSide(s, seat);
  }
  function center(s) {
    var h = '<div class="pk-center dk-center">';
    if (s.phase === 'playing') {
      var o = s.options, pick = tab.pick && o && o.defend[tab.pick];
      h += '<div class="dk-mid"><div class="dk-stock" title="' + s.deck + ' Karten im Stapel">' +
        (s.deck ? card(s.trump, 'dk-trump') + (s.deck > 1 ? card(null) : '') : '<span class="dk-suit ' + (s.trump.s === '♥' || s.trump.s === '♦' ? 'dk-red' : '') + '">' + s.trump.s + '</span>') +
        '<small>' + (s.deck ? s.deck + ' im Stapel' : 'Stapel leer') + '</small></div>' +
        '<div class="dk-pairs">' + (s.table.length ? s.table.map(function (p, k) {
          var target = pick && pick.indexOf(k) >= 0;
          return '<span class="dk-pair' + (target ? ' target' : '') + '"' + (target ? ' data-target="' + k + '" title="Hiermit schlagen"' : '') + '>' + card(p.a) + (p.d ? card(p.d, 'dk-def') : '') + '</span>';
        }).join('') : '<span class="dk-hint">' + (s.turn && s.seats[s.turn.seat] ? esc(s.seats[s.turn.seat].name) + ' greift an …' : '') + '</span>') + '</div>' +
        '<div class="dk-discard" title="Abgeworfene Karten">' + (s.discard ? card(null, 'dk-off') : '') + '<small>' + s.discard + ' weg</small></div></div>';
      var d = s.seats[s.defender];
      if (s.table.length) h += '<div class="pk-pot">' + s.table.length + ' / ' + s.limit + ' Karten' + (d ? ' · ' + esc(d.name) + (s.taking ? ' nimmt' : ' verteidigt') : '') + '</div>';
    } else if (s.phase === 'result' && s.result) {
      var r = s.result;
      h += '<div class="pk-result dk-big">' + (r.durak ? '🎴 ' + esc(r.durak) + ' ist der Durak!' : '🤝 Unentschieden, kein Durak') + '</div>' +
        '<div class="dk-order">' + r.order.map(function (o) { return '<div>' + (o.durak ? '🤡' : o.place === 1 ? '🥇' : o.place + '.') + ' ' + esc(o.name) + (o.durak ? (r.quit ? ' (aufgestanden)' : ' (' + o.cards + ' Karten übrig)') : '') + '</div>'; }).join('') + '</div>' +
        '<div class="pk-result">Wer noch einmal will, klickt auf „Bereit“.</div>';
    } else {
      var n = s.seats.filter(Boolean).length;
      h += '<div class="pk-result">' + (n < 2 ? 'Wartet auf einen zweiten Spieler …' : s.seats.every(function (x) { return !x || x.ready; }) ? 'Gleich wird gegeben …' : 'Gegeben wird, wenn alle bereit sind.') + '</div>';
    }
    return h + '</div>';
  }
  function renderSide(s, seat) {
    var host = isHost(), html = '';
    if (seat) {
      html += '<fieldset class="groupbox"><legend>Mein Platz</legend><table class="kv">' +
        '<tr><td>Spiele hier</td><td class="num">' + seat.session.games + '</td></tr>' +
        '<tr><td>Als Erster raus</td><td class="num">' + seat.session.wins + '</td></tr>' +
        '<tr><td>Durak</td><td class="num">' + seat.session.duraks + '×</td></tr></table>' +
        '<div class="actions">' + (s.phase !== 'playing' ? '<button type="button" class="small" data-act="ready">' + (seat.ready ? '✋ Doch nicht bereit' : '<b>✓ Bereit</b>') + '</button>' : '') +
        '<button type="button" class="small" data-act="leave">🚪 Aufstehen</button></div></fieldset>';
    }
    var players = s.seats.filter(Boolean);
    html += '<fieldset class="groupbox"><legend>Am Tisch (' + players.length + (s.viewers.length ? ' + ' + s.viewers.length + ' 👁' : '') + ')</legend><table class="kv">' +
      players.map(function (p) { return '<tr><td><button type="button" class="bj-link" data-user="' + esc(p.user) + '" data-uid="' + p.id + '">' + (s.hostId === p.id ? '👑 ' : '') + esc(p.name) + '</button></td><td class="num">' + p.session.duraks + '× Durak</td></tr>'; }).join('') +
      (s.viewers.length ? '<tr><td colspan="2"><small>👁 ' + s.viewers.map(function (v) { return '<button type="button" class="bj-link" data-user="' + esc(v.user) + '" data-uid="' + v.id + '">' + esc(v.name) + '</button>'; }).join(', ') + '</small></td></tr>' : '') +
      '</table><div class="actions"><button type="button" class="small" data-act="link">🔗 Einladen</button>' +
      (host ? '<button type="button" class="small" data-act="settings">⚙️</button><button type="button" class="small danger" data-act="close" title="Tisch schließen">✖</button>' : '') +
      (!seat ? '<button type="button" class="small" data-act="leave-view">🚪 Weggehen</button>' : '') + '</div></fieldset>';
    html += '<div class="sunken bj-log">' + s.log.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
    $('dk-side').innerHTML = html;
  }

  // Unten: die eigene Hand und die Knöpfe Nehmen / Fertig / Bereit
  function renderBar(s, seat) {
    var bar = $('dk-bar'), o = s.options, html = '';
    if (!seat) {
      html = '<span>' + (s.seats.some(function (x) { return !x; }) ? 'Klick auf einen freien Platz, um mitzuspielen.' : 'Alle Plätze sind besetzt. Du siehst zu.') + '</span>';
    } else if (s.phase !== 'playing' || !seat.inGame) {
      html = '<div class="bj-row"><span>' + (s.phase === 'playing' ? 'Das Spiel läuft schon. Du spielst ab dem nächsten mit.' : seat.ready ? 'Du bist bereit. Gegeben wird, wenn alle bereit sind.' : 'Bereit für ein Spiel?') + '</span>' +
        (s.phase !== 'playing' ? '<button type="button" data-act="ready">' + (seat.ready ? '✋ Doch nicht' : '<b>✓ Bereit</b>') + '</button>' : '') + '</div>';
    } else {
      var trump = s.trump.s, hand = sortHand(s.hand || [], trump);
      var playable = function (c) { return o && (o.attack.indexOf(cid(c)) >= 0 || !!o.defend[cid(c)]); };
      html = '<div class="dk-hand">' + (hand.length ? hand.map(function (c) {
        var ok = playable(c);
        return card(c, (ok ? 'ok' : 'dim') + (c.s === trump ? ' trump' : '') + (tab.pick === cid(c) ? ' picked' : ''), ' data-card="' + esc(cid(c)) + '" role="button" tabindex="0"');
      }).join('') : '<span>Keine Karten mehr' + (seat.place ? ', du bist raus. 🎉' : '.') + '</span>') + '</div>';
      html += '<div class="bj-row">' + hint(s, seat) +
        (o && o.take ? '<button type="button" data-act="take" title="Taste N"><b><u>N</u>ehmen</b></button>' : '') +
        (o && o.pass ? '<button type="button" data-act="pass" title="Taste F oder Leertaste"><b><u>F</u>ertig</b></button>' : '') + '</div>';
    }
    bar.innerHTML = html;
  }
  function hint(s, seat) {
    var o = s.options, t = '';
    if (seat.place) t = 'Du bist raus und siehst zu, bis das Spiel vorbei ist.';
    else if (seat.i === s.defender) t = s.taking ? 'Du nimmst. Die anderen dürfen noch zuwerfen.' : tab.pick ? 'Klick auf die Karte in der Mitte, die du schlagen willst.' : s.table.length && s.table.some(function (p) { return !p.d; }) ? (Object.keys(o.defend).length ? 'Schlag die Karten oder nimm.' : 'Du kannst nichts schlagen, du musst nehmen.') : 'Du wirst angegriffen.';
    else if (!s.table.length) t = seat.i === s.attacker ? 'Du greifst an: leg eine Karte.' : esc(s.seats[s.attacker].name) + ' fängt an.';
    else if (o.attack.length) t = 'Du kannst zuwerfen.';
    else if (o.pass) t = 'Nichts mehr zuwerfen?';
    else t = 'Warten …';
    return '<span>' + t + '</span>';
  }

  function playCard(id) {
    var s = tab && tab.state, o = s && s.options;
    if (!o) return;
    if (o.attack.indexOf(id) >= 0) { ctl('attack', { card: id }); return; }
    var targets = o.defend[id];
    if (targets) {
      if (targets.length === 1) { tab.pick = null; ctl('defend', { card: id, target: targets[0] }); return; }
      tab.pick = tab.pick === id ? null : id;
      renderTable();
      return;
    }
    var seat = mySeat();
    status(seat && seat.i === s.defender ? 'Mit ' + id + ' kannst du keine offene Karte schlagen.' : s.table.length ? 'Zuwerfen geht nur mit einem Wert, der schon auf dem Tisch liegt.' : 'Du bist gerade nicht dran.');
  }

  // Countdown ohne neu zu zeichnen
  setInterval(function () {
    if (!tab || !tab.state || view !== 'tisch') return;
    var s = tab.state, passed = Date.now() + (tab.offset || 0) - s.now;
    main.querySelectorAll('[data-count]').forEach(function (el) { el.textContent = Math.max(0, secs((s.turn ? s.turn.left : 0) - passed)); });
  }, 250);

  function settings() {
    var s = tab.state;
    dialog('⚙️ Tisch-Einstellungen',
      '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(s.name) + '"></label>' +
      '<label>Plätze:<select name="seats" class="w100">' + seatOpts(s.seatCount) + '</select></label>' +
      '<label class="inline"><input type="checkbox" name="hidden"' + (s.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
      '<p><small>Weniger Plätze gehen nur, wenn die hinteren frei sind.</small></p>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r === 'ok') ctl('settings', { name: field('name'), seats: Number(field('seats')), hidden: field('hidden') });
    });
  }
  function invite() {
    var url = location.origin + '/durak?tisch=' + encodeURIComponent(tab.id);
    dialog('🔗 Einladen', '<p>Schick diesen Link an andere Mitglieder. Wer ihn öffnet, kommt direkt an diesen Tisch.</p><input type="text" class="w100" name="link" readonly value="' + esc(url) + '">',
      [{ label: 'Kopieren', value: 'copy' }, { label: 'Schließen', value: 'cancel' }]).then(function (r) {
      if (r === 'copy' && navigator.clipboard) navigator.clipboard.writeText(url).then(function () { status('Link kopiert.'); }).catch(function () {});
    });
    dlg.querySelector('[name=link]').select();
  }
  function personMenu(e, el) {
    var uid = Number(el.dataset.uid), items = [];
    var s = tab && tab.state, p = s && s.seats.filter(function (x) { return x && x.id === uid; })[0];
    var note = p ? (s.hostId === uid ? '👑 Gastgeber · ' : '') + p.session.games + ' Spiele hier · ' + p.session.duraks + '× Durak' : s && s.hostId === uid ? '👑 Gastgeber · sieht zu' : s ? '👁 Sieht zu' : '';
    if (p && isHost() && uid !== ME) items.push({ label: '🚪 Vom Tisch nehmen', danger: true, run: function () { ctl('kick', { user: uid }); } });
    if (window.RetroUserMenu) window.RetroUserMenu.open(e, el.dataset.user, { note: note, items: items });
  }

  // ---------- Statistik ----------
  function loadStats() {
    return req('GET', '/durak/statistik').then(function (j) { stats = j; if (view === 'statistik') renderStats(); }).catch(oops);
  }
  function renderStats() {
    if (!stats) { main.innerHTML = '<p class="bj-empty">Lädt …</p>'; return; }
    var h = '<div class="bj-pad"><div class="tabs" role="tablist"><button type="button" role="tab" data-stab="board" aria-selected="' + (statsTab === 'board') + '">🏆 Bestenliste</button>' +
      '<button type="button" role="tab" data-stab="mine" aria-selected="' + (statsTab === 'mine') + '">👤 Meine Statistik</button></div><div class="tab-page">';
    if (statsTab === 'board') {
      var b = stats.board;
      h += b.length ? '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Spiele</th><th class="num">Als Erster raus</th><th class="num">Durak</th><th class="num">Durak-Quote</th></tr></thead><tbody>' +
        b.map(function (u, i) {
          return '<tr' + (u.id === ME ? ' class="bj-me-row"' : '') + '><td>' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</td><td><button type="button" class="bj-link" data-user="' + esc(u.user) + '" data-uid="' + u.id + '">' + esc(u.name) + '</button></td>' +
            '<td class="num">' + u.games + '</td><td class="num"><b>' + u.wins + '</b></td><td class="num">' + u.duraks + '×</td><td class="num">' + pct(u.duraks, u.games) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch hat niemand gespielt.</p>';
      h += '<p><small>Sortiert danach, wie oft jemand als Erster keine Karten mehr hatte, bei Gleichstand nach der kleineren Durak-Quote. Es erscheint nur, wessen Profil du sehen darfst.</small></p>';
    } else {
      var m = stats.me;
      h += '<div class="bj-kpis">' +
        '<div class="sunken"><small>Spiele</small><b>' + m.games + '</b><small>' + (m.quits ? m.quits + '× aufgestanden' : '&nbsp;') + '</small></div>' +
        '<div class="sunken"><small>Als Erster raus</small><b>' + m.wins + '</b><small>' + pct(m.wins, m.games) + '</small></div>' +
        '<div class="sunken"><small>Durak geworden</small><b class="' + (m.duraks ? 'neg' : '') + '">' + m.duraks + '×</b><small>' + pct(m.duraks, m.games) + '</small></div>' +
        '<div class="sunken"><small>Nicht Durak</small><b class="' + (m.games > m.duraks ? 'pos' : '') + '">' + (m.games - m.duraks) + '×</b><small>' + pct(m.games - m.duraks, m.games) + '</small></div></div>' +
        '<h3>Letzte Spiele</h3>' + (stats.games.length ? '<table class="list"><thead><tr><th>Ende</th><th>Tisch</th><th class="num">Spieler</th><th class="num">Platz</th><th>Ergebnis</th><th class="num">Angriffe</th></tr></thead><tbody>' +
        stats.games.map(function (g) {
          return '<tr><td>' + date(g.ended) + '</td><td>' + esc(g.table) + '</td><td class="num">' + g.players + '</td><td class="num">' + g.place + '.</td>' +
            '<td>' + (g.durak ? (g.quit ? '🚪 aufgestanden, Durak' : '🤡 Durak') : g.place === 1 ? '🥇 Erster raus' : '✓ kein Durak') + '</td><td class="num">' + g.bouts + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch keine Spiele.</p>') +
        '<p><small>Deine Zahlen stehen auch in deinem <a href="/nutzer/' + encodeURIComponent(me ? me.user : '') + '">Profil</a>.</small></p>';
    }
    main.innerHTML = h + '</div></div>';
  }

  function renderRules() {
    var r = rules();
    main.innerHTML = '<div class="bj-pad bj-rules"><h2>📜 Regeln</h2><ul>' +
      '<li>Gespielt wird <b>Durak mit Zuwerfen</b> (Podkidnoy) mit 36 Karten von der Sechs bis zum Ass, zu zweit bis zu sechst. Ziel ist, seine Karten loszuwerden. Wer am Ende als Einziger noch Karten hat, ist der <b>Durak</b> (russisch für Dummkopf).</li>' +
      '<li>Jeder bekommt sechs Karten. Die unterste Karte des Stapels liegt offen darunter und bestimmt die <b>Trumpffarbe</b>; sie wird als Letzte gezogen.</li>' +
      '<li>Im ersten Spiel fängt an, wer die niedrigste Trumpfkarte hat. Danach wird der Durak der letzten Runde zuerst angegriffen.</li>' +
      '<li>Der <b>Angreifer</b> legt eine beliebige Karte. Der Spieler links von ihm <b>verteidigt</b>: Er schlägt sie mit einer höheren Karte derselben Farbe oder mit einem Trumpf. Einen Trumpf schlägt nur ein höherer Trumpf.</li>' +
      '<li><b>Zuwerfen:</b> Alle außer dem Verteidiger dürfen weitere Karten legen, deren Wert schon auf dem Tisch liegt. Höchstens sechs Karten pro Angriff (im ersten Angriff eines Spiels fünf) und nie mehr, als der Verteidiger Karten hat.</li>' +
      '<li>Schlägt der Verteidiger alles und wirft niemand mehr zu (alle klicken „Fertig“), kommen die Karten weg und er greift als Nächster an. Wer nichts Passendes hat, muss nicht klicken.</li>' +
      '<li>Kann oder will er nicht schlagen, <b>nimmt</b> er. Die anderen dürfen dann noch zuwerfen, danach wandern alle Karten auf seine Hand, und der Spieler links von ihm greift an.</li>' +
      '<li>Nach jedem Angriff ziehen alle auf sechs Karten nach: erst der Angreifer, dann die anderen, der Verteidiger zuletzt. Ist der Stapel leer und hat jemand keine Karten mehr, ist er raus.</li>' +
      '<li>Werden die letzten Spieler gleichzeitig fertig, ist es unentschieden. Wer mitten im Spiel aufsteht, beendet es für alle und ist der Durak.</li>' +
      '<li>Bedenkzeit zum Angreifen und Verteidigen: ' + r.turn + ' Sekunden, zum Zuwerfen ' + r.pass + '. Danach legt der Angreifer seine kleinste Karte, der Verteidiger nimmt, und wer noch zuwerfen könnte, ist fertig. Wer das Fenster länger als anderthalb Minuten zu hat, steht nach dem Spiel auf.</li>' +
      '<li>Bedienung: Klick auf eine Karte in deiner Hand legt sie. Passt sie als Verteidigung auf mehrere Karten, klickst du danach die Karte in der Mitte an. Tastatur: <b>N</b> nehmen, <b>F</b> oder Leertaste fertig.</li></ul>' +
      '<p><small>Statistik: gespeichert wird nach jedem Spiel dein Platz und ob du der Durak warst. „Als Erster raus“ zählt, wer zuerst keine Karten mehr hatte.</small></p></div>';
  }

  // ---------- Klicks und Tasten ----------
  main.addEventListener('click', function (e) {
    var cardEl = e.target.closest('[data-card]');
    if (cardEl) { playCard(cardEl.dataset.card); return; }
    var tgt = e.target.closest('[data-target]');
    if (tgt && tab && tab.pick) { var c = tab.pick; tab.pick = null; ctl('defend', { card: c, target: Number(tgt.dataset.target) }); return; }
    var b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.join) { var t = tables.filter(function (x) { return x.id === b.dataset.join; })[0]; enter(b.dataset.join, t && t.players < t.seats && mineId !== t.id); return; }
    if (b.dataset.watch) { enter(b.dataset.watch, false); return; }
    if (b.dataset.sit) { ctl('sit', { seat: Number(b.dataset.sit) }); return; }
    if (b.dataset.stab) { statsTab = b.dataset.stab; renderStats(); return; }
    if (b.dataset.user) { personMenu(e, b); return; }
    var a = b.dataset.act;
    if (!a) return;
    if (a === 'create') createTable();
    else if (a === 'refresh') loadTables();
    else if (a === 'take' || a === 'pass') ctl(a);
    else if (a === 'ready') { var seat = mySeat(); ctl('ready', { on: !(seat && seat.ready) }); }
    else if (a === 'leave') {
      var s = mySeat();
      if (s && s.inGame && !s.place && tab.state.phase === 'playing') {
        dialog('🚪 Aufstehen', '<p>Das Spiel läuft noch. Wenn du jetzt aufstehst, ist es für alle vorbei und <b>du bist der Durak</b>.</p>', [{ label: 'Trotzdem aufstehen', value: 'ok', danger: true }, { label: 'Weiterspielen', value: 'cancel' }])
          .then(function (r) { if (r === 'ok') ctl('leave'); });
      } else ctl('leave');
    }
    else if (a === 'leave-view') { leaveView(); show('tische'); }
    else if (a === 'settings') settings();
    else if (a === 'link') invite();
    else if (a === 'close') dialog('Tisch schließen', '<p>Den Tisch für alle schließen? Ein laufendes Spiel zählt dann nicht.</p>', [{ label: 'Schließen', value: 'ok', danger: true }, { label: 'Abbrechen', value: 'cancel' }])
      .then(function (r) { if (r === 'ok') req('POST', '/durak/tisch/' + encodeURIComponent(tab.id), { action: 'close' }).catch(oops); });
  });
  document.addEventListener('keydown', function (e) {
    if (view !== 'tisch' || dlg.open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.card) { e.preventDefault(); playCard(e.target.dataset.card); return; }
    var k = e.key.toLowerCase(), act = k === 'n' ? 'take' : k === 'f' || k === ' ' ? 'pass' : null;
    var btn = act && main.querySelector('[data-act=' + act + ']:not([disabled])');
    if (btn) { e.preventDefault(); btn.click(); }
  });

  // ---------- Start ----------
  var want = new URLSearchParams(location.search).get('tisch');
  loadTables().then(function () {
    if (want) enter(want, false);
    else if (mineId) enter(mineId, false);
  });
  show('tische');
})();
