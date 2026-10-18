// Gemeinsamer Rahmen für UNO, Flip 7 und Pilli Pilli (views/cardgame.ejs): Tischliste, Tisch mit Plätzen, Seitenleiste,
// Statistik und Regeln. Den Tisch schickt der Server per Server-Sent Events (/<spiel>/tisch/<id>/events), jedem Browser mit
// nur seinen eigenen Handkarten; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Aufbau wie public/durak.js.
// Das Spiel selbst (public/uno.js, flip7.js, pilli.js) ruft window.CardTable({ … }) mit seinen Haken auf:
//   center(s, ctx)  Mitte des Tisches während des Spiels      bar(s, seat, ctx)  eigene Karten und Knöpfe unten
//   seat(s, p, ctx) { hole, line, badge } pro Platz          click(el, ctx)     eigene Klicks (true = erledigt)
//   options(o) / read(field)  Regeln im Tisch-Dialog          rules(r), stats, sounds(prev, s, ctx), tags(s), keys(e, ctx)
(function () {
  'use strict';
  window.CardTable = function (G) {
    var root = document.getElementById('cg');
    if (!root) return;
    function $(id) { return document.getElementById(id); }
    var CSRF = root.dataset.csrf, ME = Number(root.dataset.user), BASE = '/' + root.dataset.game;
    var TITLE = root.dataset.title, ICON = root.dataset.icon, SEATS = root.dataset.seats.split('-').map(Number);
    var main = $('cg-main'), statusEl = $('cg-status'), meEl = $('cg-me'), dlg = $('cg-dlg');
    var Sound = window.RetroSound || { play: function () {} };
    var view = 'tische', me = null, tables = [], mineId = null, tab = null, stats = null, statsTab = 'board', lastRules = null;

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
      $('cg-dlg-title').textContent = title;
      $('cg-dlg-body').innerHTML = html;
      var acts = $('cg-dlg-actions');
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
        var first = dlg.querySelector('input:not([type=checkbox]):not([type=radio]), select');
        if (first) first.focus();
      });
    }
    function field(name) {
      var el = dlg.querySelector('[name=' + name + ']:checked') || dlg.querySelector('[name=' + name + ']');
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : null;
    }
    function secs(ms) { return Math.ceil(ms / 1000); }
    function back(extra) { return '<span class="bj-card back' + (extra ? ' ' + extra : '') + '"></span>'; }
    function backs(n) {
      var h = '';
      for (var k = 0; k < Math.min(n, 8); k++) h += back();
      return '<span class="bj-cards dk-backs">' + h + '</span>';
    }

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
      if (me) meEl.innerHTML = '👤 ' + esc(me.name) + ' · ' + me.games + (me.games === 1 ? ' Spiel · ' : ' Spiele · ') + me.wins + (me.wins === 1 ? ' Sieg' : ' Siege');
    }
    function rules() { return (tab && tab.state && tab.state.rules) || lastRules || { turn: 30 }; }

    // ---------- Tischliste ----------
    function loadTables() {
      return req('GET', BASE + '/tische').then(function (j) {
        tables = j.tables; me = j.me; mineId = j.mine;
        renderMe();
        if (view === 'tische') renderTables();
      }).catch(oops);
    }
    function renderTables() {
      var rows = tables.map(function (t) {
        var full = t.players >= t.seats;
        return '<tr><td>' + (t.hidden ? '🔒 ' : ICON + ' ') + '<b>' + esc(t.name) + '</b>' + (t.rules ? '<br><small>' + esc(t.rules) + '</small>' : '') + '</td><td>' + esc(t.host) + '</td><td>' + t.players + ' / ' + t.seats +
          (t.viewers ? ' <small>+' + t.viewers + ' 👁</small>' : '') + '</td><td>' + esc(t.status) + '</td>' +
          '<td class="bj-acts"><button type="button" class="small" data-join="' + t.id + '"' + (full && mineId !== t.id ? ' title="Alle Plätze besetzt"' : '') + '>' +
          (mineId === t.id ? '↩ Zurück an den Tisch' : full ? '👁 Zusehen' : '🪑 Hinsetzen') + '</button>' +
          (mineId !== t.id && !full ? ' <button type="button" class="small" data-watch="' + t.id + '">👁 Zusehen</button>' : '') + '</td></tr>';
      }).join('');
      main.innerHTML = '<div class="bj-pad"><div class="actions bj-top"><button type="button" data-act="create">➕ Neuer Tisch</button><button type="button" data-act="refresh">🔄 Aktualisieren</button>' +
        '<small>' + tables.length + ' ' + (tables.length === 1 ? 'Tisch' : 'Tische') + ' offen</small></div>' +
        (tables.length ? '<table class="list"><thead><tr><th>Tisch</th><th>Gastgeber</th><th>Plätze</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="bj-empty">Gerade ist kein Tisch offen. Mach einen auf und lade andere mit dem Link ein. Gespielt wird ab ' + SEATS[0] + ' Spielern.</p>') +
        '<p><small>' + esc(G.blurb) + ' Versteckte Tische siehst nur du per Link. Leere Tische schließen nach 10 Minuten. Du kannst nur an einem Tisch gleichzeitig sitzen.</small></p></div>';
    }
    function seatOpts(cur) {
      var h = '';
      for (var n = SEATS[0]; n <= SEATS[1]; n++) h += '<option' + (n === cur ? ' selected' : '') + '>' + n + '</option>';
      return h;
    }
    function tableForm(name, seats, hidden, opts, note) {
      return '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(name) + '"></label>' +
        '<label>Plätze:<select name="seats" class="w100">' + seatOpts(seats) + '</select></label>' +
        (G.options ? G.options(opts) : '') +
        '<label class="inline"><input type="checkbox" name="hidden"' + (hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
        '<p><small>' + note + '</small></p>';
    }
    function formValues() {
      return Object.assign({ name: field('name'), seats: Number(field('seats')), hidden: field('hidden') }, G.read ? G.read(field) : {});
    }
    function createTable() {
      dialog('➕ Neuer ' + G.tableWord, tableForm(G.tableWord + ' von ' + (me ? me.name : ''), 4, false, G.defaults || {}, 'Sobald alle am Tisch auf „Bereit“ klicken, wird gegeben.'),
        [{ label: '<b>Erstellen</b>', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r !== 'ok') return;
        req('POST', BASE + '/tische', formValues()).then(function (j) { enter(j.id, true); }).catch(oops);
      });
    }

    // ---------- Am Tisch ----------
    function enter(id, sit) {
      if (tab && tab.id === id) { show('tisch'); if (sit) ctl('sit'); return; }
      leaveView();
      tab = { id: id, state: null, es: null, sitAfterJoin: !!sit, ui: {} };
      tab.es = new EventSource(BASE + '/tisch/' + encodeURIComponent(id) + '/events');
      tab.es.addEventListener('state', function (e) { onState(JSON.parse(e.data)); });
      tab.es.addEventListener('ping', function (e) { if (tab) tab.offset = JSON.parse(e.data).now - Date.now(); });
      tab.es.addEventListener('closed', function () { gone('Der Tisch wurde geschlossen.'); });
      tab.es.addEventListener('error', function () {
        if (!tab) return;
        if (tab.es.readyState === 2) gone('Diesen Tisch gibt es nicht mehr.');
        else status('Verbindung zum Tisch unterbrochen, verbinde neu …');
      });
      try { history.replaceState(null, '', BASE + '?tisch=' + encodeURIComponent(id)); } catch (e) { /* egal */ }
      show('tisch');
      status('Verbinde mit dem Tisch …');
    }
    function leaveView() {
      if (!tab) return;
      tab.es.close();
      tab = null;
      try { history.replaceState(null, '', BASE); } catch (e) { /* egal */ }
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
      return req('POST', BASE + '/tisch/' + encodeURIComponent(tab.id), body).catch(oops);
    }

    // Was die Spiel-Skripte brauchen
    var ctx = {
      esc: esc, ctl: ctl, status: status, dialog: dialog, field: field, back: back, backs: backs, secs: secs, sound: Sound,
      me: function () { return me; }, seat: mySeat, state: function () { return tab && tab.state; }, mine: function (p) { return !!p && p.id === ME; }, ui: function () { return tab ? tab.ui : {}; }, redraw: function () { if (view === 'tisch') renderTable(); },
      name: function (s, i) { var p = s.seats[i]; return p ? esc(p.name) : '–'; },
      count: function (s) { return '<span data-count="turn">' + secs(s.turn ? s.turn.left : 0) + '</span> s'; },
    };

    function onState(s) {
      var first = !tab.state, prev = tab.state;
      tab.state = s; lastRules = s.rules;
      if (tab.sitAfterJoin) { tab.sitAfterJoin = false; if (!mySeat()) ctl('sit'); }
      if (prev) sounds(prev, s);
      var seat = mySeat();
      if (seat) mineId = s.id;
      else if (mineId === s.id) mineId = null;
      // Nach jedem Spiel stimmen die eigenen Zahlen aus der Datenbank wieder
      if (prev && prev.phase === 'playing' && s.phase === 'result') setTimeout(loadTables, 300);
      if (first) status('Am Tisch „' + s.name + '“.');
      if (view === 'tisch') renderTable();
    }
    function sounds(prev, s) {
      var seat = mySeat();
      if (prev.phase === 'playing' && s.phase === 'result' && s.result) {
        var mine = s.result.order.filter(function (o) { return o.user === (me && me.user); })[0];
        if (mine) Sound.play(mine.won ? 'tusch' : 'ding');
        return;
      }
      if (G.sounds) G.sounds(prev, s, ctx);
      var myTurn = function (st) { return st.phase === 'playing' && st.turn && seat && st.turn.seat === seat.i; };
      if (myTurn(s) && !myTurn(prev)) Sound.play('hinweis');
    }

    // Plätze rund um den ovalen Tisch; der eigene sitzt immer unten in der Mitte
    function spot(slot, n) {
      var a = Math.PI / 2 + slot * 2 * Math.PI / n;
      return { x: 50 + 41 * Math.cos(a), y: 47 + 37 * Math.sin(a) };
    }
    function seatHtml(p, i, st, slot) {
      var pos = spot(slot, st.seatCount);
      var style = 'left:' + pos.x.toFixed(1) + '%;top:' + pos.y.toFixed(1) + '%';
      if (!p) {
        return '<div class="pk-seat empty" style="' + style + '">' + (mySeat() ? '<span class="bj-free">frei</span>' : '<button type="button" class="small" data-sit="' + i + '">🪑 Hier hinsetzen</button>') + '</div>';
      }
      var mine = p.id === ME, playing = st.phase === 'playing';
      var turn = playing && st.turn && st.turn.seat === i;
      var won = st.phase === 'result' && st.result && st.result.order.some(function (o) { return o.user === p.user && o.won; });
      var g = playing && p.inGame && G.seat ? G.seat(st, p, ctx) : {};
      var note = playing ? (p.inGame ? (turn ? '⏳ ' + ctx.count(st) + (G.turnText ? ' ' + G.turnText(st.turn.kind) : '') : g.note || '') : 'spielt nächstes Spiel mit')
        : p.ready ? '✓ bereit' : 'noch nicht bereit';
      return '<div class="pk-seat cg-seat' + (turn ? ' turn' : '') + (mine ? ' mine' : '') + (g.cls ? ' ' + g.cls : '') + (won ? ' won' : '') + '" style="' + style + '">' +
        '<div class="pk-hole">' + (g.hole || '') + '</div>' +
        '<button type="button" class="bj-name" data-user="' + esc(p.user) + '" data-uid="' + p.id + '">' + (st.hostId === p.id ? '👑 ' : '') + esc(p.name) + (mine ? ' (du)' : '') + (p.away ? ' 💤' : '') + (p.leaving ? ' 🚪' : '') + '</button>' +
        '<div class="bj-chips">' + (g.line || '&nbsp;') + '</div>' +
        '<div>' + (g.badge || '') + '</div><div class="pk-act">' + note + '</div></div>';
    }
    function renderTable() {
      if (!tab || !tab.state) { main.innerHTML = '<p class="bj-empty">Verbinde mit dem Tisch …</p>'; return; }
      var s = tab.state, seat = mySeat();
      if (!$('cg-felt')) {
        main.innerHTML = '<div class="bj-tools" id="cg-tools"></div><div class="bj-table"><div class="pk-col"><div class="bj-felt pk-felt dk-felt cg-felt" id="cg-felt"></div>' +
          '<div class="pk-bar dk-bar cg-bar sunken" id="cg-bar"></div></div><div class="bj-side" id="cg-side"></div></div>';
      }
      $('cg-tools').innerHTML = '<b>' + (s.hidden ? '🔒 ' : ICON + ' ') + esc(s.name) + '</b>' + (s.game ? '<span class="tag">Spiel ' + s.game + '</span>' : '') + (G.tags ? G.tags(s) : '');
      var shift = seat ? seat.i : 0;
      var seats = s.seats.map(function (x, i) { return seatHtml(x, i, s, (i - shift + s.seatCount) % s.seatCount); }).join('');
      $('cg-felt').innerHTML = (s.phase === 'playing' ? '' : '<div class="bj-motto pk-motto">' + esc(G.motto) + '</div>') + '<div class="pk-center dk-center cg-center">' + center(s) + '</div>' + seats;
      renderBar(s, seat);
      renderSide(s, seat);
    }
    function center(s) {
      if (s.phase === 'playing') return G.center(s, ctx);
      if (s.phase === 'result' && s.result) {
        var r = s.result;
        return '<div class="pk-result dk-big">' + (r.winners.length ? '🏆 ' + esc(r.winners.join(' und ')) + (r.winners.length > 1 ? ' gewinnen!' : ' gewinnt!') : 'Kein Sieger') + '</div>' +
          '<div class="dk-order">' + r.order.map(function (o) { return '<div>' + (o.won ? '🥇' : o.place + '.') + ' ' + esc(o.name) + ' <small>' + esc(o.note) + (o.quit ? ', aufgestanden' : '') + '</small></div>'; }).join('') + '</div>' +
          '<div class="pk-result">Wer noch einmal will, klickt auf „Bereit“.</div>';
      }
      var n = s.seats.filter(Boolean).length;
      return '<div class="pk-result">' + (n < SEATS[0] ? 'Wartet auf einen zweiten Spieler …' : s.seats.every(function (x) { return !x || x.ready; }) ? 'Gleich wird gegeben …' : 'Gegeben wird, wenn alle bereit sind.') + '</div>';
    }
    function renderSide(s, seat) {
      var host = isHost(), html = '';
      if (seat) {
        html += '<fieldset class="groupbox"><legend>Mein Platz</legend><table class="kv">' +
          '<tr><td>Spiele hier</td><td class="num">' + seat.session.games + '</td></tr>' +
          '<tr><td>Gewonnen</td><td class="num">' + seat.session.wins + '</td></tr>' + (G.sideRows && seat.inGame && s.phase === 'playing' ? G.sideRows(s, seat, ctx) : '') + '</table>' +
          '<div class="actions">' + (s.phase !== 'playing' ? '<button type="button" class="small" data-act="ready">' + (seat.ready ? '✋ Doch nicht bereit' : '<b>✓ Bereit</b>') + '</button>' : '') +
          '<button type="button" class="small" data-act="leave">🚪 Aufstehen</button></div></fieldset>';
      }
      var players = s.seats.filter(Boolean);
      html += '<fieldset class="groupbox"><legend>Am Tisch (' + players.length + (s.viewers.length ? ' + ' + s.viewers.length + ' 👁' : '') + ')</legend><table class="kv">' +
        players.map(function (p) {
          return '<tr><td><button type="button" class="bj-link" data-user="' + esc(p.user) + '" data-uid="' + p.id + '">' + (s.hostId === p.id ? '👑 ' : '') + esc(p.name) + '</button></td><td class="num">' +
            (s.phase === 'playing' && p.inGame && G.score ? G.score(p) : p.session.wins + '× gewonnen') + '</td></tr>';
        }).join('') +
        (s.viewers.length ? '<tr><td colspan="2"><small>👁 ' + s.viewers.map(function (v) { return '<button type="button" class="bj-link" data-user="' + esc(v.user) + '" data-uid="' + v.id + '">' + esc(v.name) + '</button>'; }).join(', ') + '</small></td></tr>' : '') +
        '</table><div class="actions"><button type="button" class="small" data-act="link">🔗 Einladen</button>' +
        (host ? '<button type="button" class="small" data-act="settings">⚙️</button><button type="button" class="small danger" data-act="close" title="Tisch schließen">✖</button>' : '') +
        (!seat ? '<button type="button" class="small" data-act="leave-view">🚪 Weggehen</button>' : '') + '</div></fieldset>';
      html += '<div class="sunken bj-log">' + s.log.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
      $('cg-side').innerHTML = html;
    }
    function renderBar(s, seat) {
      var html;
      if (!seat) {
        html = '<span>' + (s.seats.some(function (x) { return !x; }) ? 'Klick auf einen freien Platz, um mitzuspielen.' : 'Alle Plätze sind besetzt. Du siehst zu.') + '</span>';
      } else if (s.phase !== 'playing' || !seat.inGame) {
        html = '<div class="bj-row"><span>' + (s.phase === 'playing' ? 'Das Spiel läuft schon. Du spielst ab dem nächsten mit.' : seat.ready ? 'Du bist bereit. Gegeben wird, wenn alle bereit sind.' : 'Bereit für ein Spiel?') + '</span>' +
          (s.phase !== 'playing' ? '<button type="button" data-act="ready">' + (seat.ready ? '✋ Doch nicht' : '<b>✓ Bereit</b>') + '</button>' : '') + '</div>';
      } else html = G.bar(s, seat, ctx);
      $('cg-bar').innerHTML = html;
    }

    // Countdown ohne neu zu zeichnen
    setInterval(function () {
      if (!tab || !tab.state || view !== 'tisch') return;
      var s = tab.state, passed = Date.now() + (tab.offset || 0) - s.now;
      main.querySelectorAll('[data-count]').forEach(function (el) { el.textContent = Math.max(0, secs((s.turn ? s.turn.left : 0) - passed)); });
    }, 250);

    function settings() {
      var s = tab.state;
      dialog('⚙️ Tisch-Einstellungen', tableForm(s.name, s.seatCount, s.hidden, s.opts, 'Weniger Plätze gehen nur, wenn die hinteren frei sind. Regeln ändern sich erst ab dem nächsten Spiel.'),
        [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r === 'ok') ctl('settings', formValues());
      });
    }
    function invite() {
      var url = location.origin + BASE + '?tisch=' + encodeURIComponent(tab.id);
      dialog('🔗 Einladen', '<p>Schick diesen Link an andere Mitglieder. Wer ihn öffnet, kommt direkt an diesen Tisch.</p><input type="text" class="w100" name="link" readonly value="' + esc(url) + '">',
        [{ label: 'Kopieren', value: 'copy' }, { label: 'Schließen', value: 'cancel' }]).then(function (r) {
        if (r === 'copy' && navigator.clipboard) navigator.clipboard.writeText(url).then(function () { status('Link kopiert.'); }).catch(function () {});
      });
      dlg.querySelector('[name=link]').select();
    }
    function personMenu(e, el) {
      var uid = Number(el.dataset.uid), items = [];
      var s = tab && tab.state, p = s && s.seats.filter(function (x) { return x && x.id === uid; })[0];
      var note = p ? (s.hostId === uid ? '👑 Gastgeber · ' : '') + p.session.games + ' Spiele hier · ' + p.session.wins + '× gewonnen' : s && s.hostId === uid ? '👑 Gastgeber · sieht zu' : s ? '👁 Sieht zu' : '';
      if (p && isHost() && uid !== ME) items.push({ label: '🚪 Vom Tisch nehmen', danger: true, run: function () { ctl('kick', { user: uid }); } });
      if (window.RetroUserMenu) window.RetroUserMenu.open(e, el.dataset.user, { note: note, items: items });
    }

    // ---------- Statistik ----------
    function loadStats() {
      return req('GET', BASE + '/statistik').then(function (j) { stats = j; if (view === 'statistik') renderStats(); }).catch(oops);
    }
    function renderStats() {
      if (!stats) { main.innerHTML = '<p class="bj-empty">Lädt …</p>'; return; }
      var S = G.stats;
      var h = '<div class="bj-pad"><div class="tabs" role="tablist"><button type="button" role="tab" data-stab="board" aria-selected="' + (statsTab === 'board') + '">🏆 Bestenliste</button>' +
        '<button type="button" role="tab" data-stab="mine" aria-selected="' + (statsTab === 'mine') + '">👤 Meine Statistik</button></div><div class="tab-page">';
      if (statsTab === 'board') {
        var b = stats.board;
        h += b.length ? '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Spiele</th><th class="num">Siege</th><th class="num">Quote</th>' + S.board.map(function (c) { return '<th class="num">' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
          b.map(function (u, i) {
            return '<tr' + (u.id === ME ? ' class="bj-me-row"' : '') + '><td>' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</td><td><button type="button" class="bj-link" data-user="' + esc(u.user) + '" data-uid="' + u.id + '">' + esc(u.name) + '</button></td>' +
              '<td class="num">' + u.games + '</td><td class="num"><b>' + u.wins + '</b></td><td class="num">' + pct(u.wins, u.games) + '</td>' + S.board.map(function (c) { return '<td class="num">' + c[1](u) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch hat niemand gespielt.</p>';
        h += '<p><small>Sortiert nach Siegen, bei Gleichstand nach der Siegquote. Es erscheint nur, wessen Profil du sehen darfst.</small></p>';
      } else {
        var m = stats.me;
        h += '<div class="bj-kpis">' +
          '<div class="sunken"><small>Spiele</small><b>' + m.games + '</b><small>' + (m.quits ? m.quits + '× aufgestanden' : '&nbsp;') + '</small></div>' +
          '<div class="sunken"><small>Gewonnen</small><b class="' + (m.wins ? 'pos' : '') + '">' + m.wins + '</b><small>' + pct(m.wins, m.games) + '</small></div>' +
          S.kpis.map(function (k) { return '<div class="sunken"><small>' + k[0] + '</small><b>' + k[1](m) + '</b><small>' + (k[2] ? k[2](m) : '&nbsp;') + '</small></div>'; }).join('') + '</div>' +
          '<h3>Letzte Spiele</h3>' + (stats.games.length ? '<table class="list"><thead><tr><th>Ende</th><th>Tisch</th><th class="num">Spieler</th><th class="num">Platz</th>' + S.games.map(function (c) { return '<th class="num">' + c[0] + '</th>'; }).join('') + '<th class="num">Runden</th></tr></thead><tbody>' +
          stats.games.map(function (g) {
            return '<tr><td>' + date(g.ended) + '</td><td>' + esc(g.table) + '</td><td class="num">' + g.players + '</td><td class="num">' + (g.won ? '🥇' : g.place + '.') + (g.quit ? ' 🚪' : '') + '</td>' +
              S.games.map(function (c) { return '<td class="num">' + c[1](g) + '</td>'; }).join('') + '<td class="num">' + g.rounds + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch keine Spiele.</p>') +
          '<p><small>Deine Zahlen stehen auch in deinem <a href="/nutzer/' + encodeURIComponent(me ? me.user : '') + '">Profil</a>. 🚪 = mitten im Spiel aufgestanden.</small></p>';
      }
      main.innerHTML = h + '</div></div>';
    }

    function renderRules() {
      var r = rules();
      main.innerHTML = '<div class="bj-pad bj-rules"><h2>📜 Regeln</h2>' + G.rules(r) +
        '<h3>Am Tisch</h3><ul><li>Gegeben wird, sobald ' + SEATS[0] + ' bis ' + SEATS[1] + ' Spieler sitzen und alle auf „Bereit“ geklickt haben.</li>' +
        '<li>Bedenkzeit pro Zug: ' + r.turn + ' Sekunden. Wer kein Fenster offen hat, bekommt nur drei Sekunden. Wer das Fenster länger als anderthalb Minuten zu hat, steht nach dem Spiel auf.</li>' +
        '<li>Wer mitten im Spiel aufsteht, scheidet aus und landet auf dem letzten Platz. Die anderen spielen weiter; bleibt nur einer übrig, hat er gewonnen.</li></ul></div>';
    }

    // ---------- Klicks und Tasten ----------
    main.addEventListener('click', function (e) {
      if (view === 'tisch' && tab && tab.state && G.click && G.click(e.target, ctx, e)) return;
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
      else if (a === 'ready') { var seat = mySeat(); ctl('ready', { on: !(seat && seat.ready) }); }
      else if (a === 'leave') {
        var s = mySeat();
        if (s && s.inGame && tab.state.phase === 'playing') {
          dialog('🚪 Aufstehen', '<p>Das Spiel läuft noch. Wenn du jetzt aufstehst, <b>scheidest du aus und landest auf dem letzten Platz</b>.</p>', [{ label: 'Trotzdem aufstehen', value: 'ok', danger: true }, { label: 'Weiterspielen', value: 'cancel' }])
            .then(function (r) { if (r === 'ok') ctl('leave'); });
        } else ctl('leave');
      }
      else if (a === 'leave-view') { leaveView(); show('tische'); }
      else if (a === 'settings') settings();
      else if (a === 'link') invite();
      else if (a === 'close') dialog('Tisch schließen', '<p>Den Tisch für alle schließen? Ein laufendes Spiel zählt dann nicht.</p>', [{ label: 'Schließen', value: 'ok', danger: true }, { label: 'Abbrechen', value: 'cancel' }])
        .then(function (r) { if (r === 'ok') req('POST', BASE + '/tisch/' + encodeURIComponent(tab.id), { action: 'close' }).catch(oops); });
    });
    document.addEventListener('keydown', function (e) {
      if (view !== 'tisch' || dlg.open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-card]')) { e.preventDefault(); e.target.click(); return; }
      if (G.keys) G.keys(e, ctx);
    });

    // ---------- Start ----------
    var want = new URLSearchParams(location.search).get('tisch');
    loadTables().then(function () {
      if (want) enter(want, false);
      else if (mineId) enter(mineId, false);
    });
    show('tische');
  };
})();
