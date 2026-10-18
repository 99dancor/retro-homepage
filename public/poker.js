// ♠️ Poker im Fenster Kartenspiele (Startmenü → Spiele und Apps → 🂡 Kartenspiele): Spieltisch, Statistik und Regeln.
// Den Tisch schickt der Server per Server-Sent Events (/kartenspiele/tisch/<id>/events), jedem Browser mit nur seinen
// eigenen Karten; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Bestenliste: /poker/statistik.
(function () {
  'use strict';
  // Läuft im Fenster Kartenspiele (public/kartenspiele.js): K.table ist der Spieltisch (oder null, dann nur Statistik und
  // Regeln), K.sit sagt, ob man sich gleich hinsetzt, K.lobby/closed/switched/salon/link führen zurück ins Fenster.
  (window.KartenSpiele = window.KartenSpiele || {}).poker = function (root, K) {
    function $(id) { return document.getElementById(id); }
    var CSRF = root.dataset.csrf, ME = Number(root.dataset.user), TITLE = root.dataset.title;
    var main = $('pk-main'), statusEl = $('pk-status'), meEl = $('pk-me'), dlg = $('pk-dlg');
    var Sound = window.RetroSound || { play: function () {} };
    var view = 'tisch', me = null, mineId = null, tab = null, stats = null, statsTab = 'board';
    var HANDS = ['Höchste Karte', 'Ein Paar', 'Zwei Paare', 'Drilling', 'Straße', 'Flush', 'Full House', 'Vierling', 'Straight Flush', 'Royal Flush'];

    // ---------- Kleinkram ----------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function euro(n, sign) { n = Number(n) || 0; return (n < 0 ? '−' : sign && n > 0 ? '+' : sign ? '±' : '') + Math.abs(n).toLocaleString('de-DE') + ' €'; }
    function cls(n) { return n < 0 ? 'neg' : n > 0 ? 'pos' : ''; }
    function date(ts) { return new Date(ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
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
      $('pk-dlg-title').textContent = title;
      $('pk-dlg-body').innerHTML = html;
      var acts = $('pk-dlg-actions');
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

    // ---------- Karten und Chips ----------
    function card(c, i) {
      if (!c) return '<span class="bj-card back" style="--i:' + i + '"></span>';
      var red = c.s === '♥' || c.s === '♦';
      return '<span class="bj-card' + (red ? ' red' : '') + '" style="--i:' + i + '" title="' + esc(c.r + c.s) + '"><span class="r">' + esc(c.r) + '<br>' + c.s + '</span><span class="s">' + c.s + '</span></span>';
    }
    function cards(list) { return '<span class="bj-cards">' + list.map(card).join('') + '</span>'; }
    function chip(n) {
      if (!n) return '';
      var c = n >= 1000 ? 'c1000' : n >= 500 ? 'c500' : n >= 100 ? 'c100' : n >= 50 ? 'c50' : n >= 25 ? 'c25' : n >= 10 ? 'c10' : 'c5';
      return '<span class="bj-chip ' + c + '">' + (n >= 1000 ? Math.floor(n / 100) / 10 + 'k' : n) + '</span>';
    }
    function secs(ms) { return Math.ceil(ms / 1000); }

    // ---------- Navigation ----------
    function show(v) {
      if (v === 'tische' || (v === 'tisch' && !tab)) { K.lobby(); return; }
      view = v;
      root.querySelectorAll('.bj-nav [data-view]').forEach(function (a) {
        a.classList.toggle('active', a.dataset.view === v);
        if (a.dataset.view === 'tisch') a.hidden = !tab;
      });
      main.innerHTML = '';
      render();
      if (v === 'statistik') loadStats();
    }
    root.querySelector('.bj-nav').addEventListener('click', function (e) {
      var a = e.target.closest('[data-view]');
      if (!a) return;
      e.preventDefault();
      show(a.dataset.view);
    });
    function render() {
      if (view === 'tisch') renderTable();
      else if (view === 'statistik') renderStats();
      else renderRules();
    }
    function renderMe() {
      if (!me) return;
      meEl.innerHTML = '👤 ' + esc(me.name) + ' · ' + TITLE + ' <b class="' + cls(me.balance) + '">' + euro(me.balance, true) + '</b>';
    }
    var lastRules = null;
    function rules() { return (tab && tab.state && tab.state.rules) || lastRules || { buyin: 1000, rebuyBelow: 200, turn: 30 }; }
    var BLINDS = [1, 2, 5, 10, 25, 50, 100];
    function blindOpts(cur) { return BLINDS.map(function (n) { return '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + euro(n) + ' / ' + euro(n * 2) + '</option>'; }).join(''); }

    // ---------- Eigene Zahlen ----------
    function loadTables() {
      return req('GET', '/poker/tische').then(function (j) {
        me = j.me;
        renderMe();
      }).catch(oops);
    }

    // ---------- Am Tisch ----------
    function enter(id, sit) {
      if (tab && tab.id === id) { show('tisch'); if (sit) ctl('sit'); return; }
      leaveView();
      tab = { id: id, state: null, es: null, sitAfterJoin: !!sit, raise: 0, barSig: '' };
      tab.es = new EventSource(K.url + encodeURIComponent(id) + '/events');
      tab.es.addEventListener('state', function (e) { onState(JSON.parse(e.data)); });
      tab.es.addEventListener('ping', function (e) { if (tab) tab.offset = JSON.parse(e.data).now - Date.now(); });
      tab.es.addEventListener('closed', function () { gone('Der Spieltisch wurde geschlossen.'); });
      // Der Gastgeber hat ein anderes Spiel gewählt: das Fenster baut den Tisch neu auf
      tab.es.addEventListener('switch', function () { leaveView(); K.switched(); });
      tab.es.addEventListener('salon', function (e) { K.salon(JSON.parse(e.data)); });
      tab.es.addEventListener('error', function () {
        if (!tab) return;
        if (tab.es.readyState === 2) gone('Diesen Tisch gibt es nicht mehr.');
        else status('Verbindung zum Tisch unterbrochen, verbinde neu …');
      });
      show('tisch');
      status('Verbinde mit dem Tisch …');
    }
    function leaveView() {
      if (!tab) return;
      tab.es.close();
      tab = null;
    }
    function gone(msg) {
      leaveView();
      K.closed(msg);
    }
    function mySeat() { return tab && tab.state ? tab.state.seats.filter(function (s) { return s && s.id === ME; })[0] || null : null; }
    function isHost() { return tab && tab.state && (tab.state.hostId === ME || (me && me.admin)); }
    function ctl(action, extra) {
      if (!tab) return Promise.resolve();
      var body = Object.assign({ action: action }, extra || {});
      return req('POST', K.url + encodeURIComponent(tab.id), body).catch(oops);
    }

    function onState(s) {
      var first = !tab.state, prev = tab.state;
      tab.state = s; lastRules = s.rules;
      if (tab.sitAfterJoin) { tab.sitAfterJoin = false; if (!mySeat()) ctl('sit'); }
      sounds(prev, s);
      var seat = mySeat();
      if (seat) mineId = s.id;
      else if (mineId === s.id) mineId = null;
      // Nach jeder Hand stimmen die eigenen Zahlen aus der Datenbank wieder
      if (prev && prev.phase !== 'showdown' && s.phase === 'showdown') setTimeout(loadTables, 300);
      if (first) status('Am Tisch „' + s.name + '“.');
      var busy = s.phase === 'playing' && seat && seat.inHand;
      if (seat && !busy && seat.chips === 0 && !tab.askedRebuy) { tab.askedRebuy = true; askRebuy(); }
      if (seat && seat.chips > 0) tab.askedRebuy = false;
      if (s.options && (!prev || !prev.options || prev.hand !== s.hand || prev.street !== s.street || prev.currentBet !== s.currentBet)) tab.raise = s.options.minTo;
      if (view === 'tisch') renderTable();
    }
    function cardCount(s) {
      var n = s.board.length;
      s.seats.forEach(function (x) { if (x) n += x.cards.length; });
      return n;
    }
    function sounds(prev, s) {
      if (!prev) return;
      if (cardCount(s) > cardCount(prev)) Sound.play('karte');
      if (s.pot > prev.pot && s.hand === prev.hand) Sound.play('chips');
      var seat = mySeat();
      if (prev.phase !== 'showdown' && s.phase === 'showdown' && seat && seat.inHand) {
        if (seat.win > 0) Sound.play(s.results.length && s.results[0].hand ? 'tusch' : 'ding');
        else if (!seat.folded) Sound.play('fehler');
      }
      if (s.turn && seat && s.turn.seat === seat.i && !(prev.turn && prev.turn.seat === seat.i)) Sound.play('hinweis');
    }

    function askRebuy() {
      var s = tab.state, seat = mySeat(), r = s.rules;
      dialog('💰 Keine Chips mehr',
        '<p>Du hast keine Chips mehr. Du kannst für ' + euro(r.buyin) + ' nachkaufen, so oft du willst.</p>' +
        '<div class="sunken"><table class="kv"><tr><td>Hier schon nachgekauft</td><td class="num">' + seat.buyins + '×</td></tr>' +
        '<tr><td>Bilanz an diesem Tisch</td><td class="num ' + cls(seat.balance) + '">' + euro(seat.balance, true) + '</td></tr>' +
        '<tr><td>Nach dem Nachkauf</td><td class="num">' + euro(seat.chips + r.buyin) + ' Chips</td></tr></table></div>' +
        '<p><small>Der Nachkauf zählt in deiner Kasse als Buy-in und ändert die Bilanz nicht, erst gewonnene und verlorene Hände tun das.</small></p>',
        [{ label: '<b>Für ' + euro(r.buyin) + ' nachkaufen</b>', value: 'buy' }, { label: 'Zusehen', value: 'cancel' }, { label: 'Aufstehen', value: 'leave' }]).then(function (v) {
        if (v === 'buy') ctl('rebuy');
        else if (v === 'leave') ctl('leave');
      });
    }

    // Plätze rund um den ovalen Tisch; der eigene sitzt immer unten in der Mitte
    function spot(slot, n, r) {
      var a = Math.PI / 2 + slot * 2 * Math.PI / n;
      return { x: 50 + 41 * r * Math.cos(a), y: 47 + 36 * r * Math.sin(a) };
    }
    function seatHtml(s, i, st, slot) {
      var p = spot(slot, st.seatCount, 1);
      var style = 'left:' + p.x.toFixed(1) + '%;top:' + p.y.toFixed(1) + '%';
      if (!s) {
        return '<div class="pk-seat empty" style="' + style + '">' + (mySeat() ? '<span class="bj-free">frei</span>' : '<button type="button" class="small" data-sit="' + i + '">🪑 Hier hinsetzen</button>') + '</div>';
      }
      var turn = st.turn && st.turn.seat === i, mine = s.id === ME;
      var won = st.phase === 'showdown' && s.win > 0;
      var html = '<div class="pk-seat' + (turn ? ' turn' : '') + (mine ? ' mine' : '') + (s.folded ? ' folded' : '') + (won ? ' won' : '') + (s.sittingOut ? ' out' : '') + '" style="' + style + '">' +
        '<div class="pk-hole">' + (s.cards.length ? cards(s.cards) : '') + '</div>' +
        '<button type="button" class="bj-name" data-user="' + esc(s.user) + '" data-uid="' + s.id + '">' + (st.hostId === s.id ? '👑 ' : '') + esc(s.name) + (mine ? ' (du)' : '') + (s.away ? ' 💤' : '') + (s.leaving ? ' 🚪' : '') + '</button>' +
        '<div class="bj-chips">' + euro(s.chips) + (s.allIn ? ' · <b>All-in</b>' : '') + '</div>' +
        '<div class="pk-act">' + (turn ? '⏳ <span data-count="turn">' + secs(st.turn.left) + '</span> s' : s.sittingOut && !s.inHand ? 'setzt aus' : esc(s.action)) + '</div>' +
        (s.best && !s.folded ? '<div class="pk-best">' + esc(s.best) + '</div>' : '') + '</div>';
      if (s.bet) {
        var b = spot(slot, st.seatCount, .55);
        html += '<div class="pk-bet" style="left:' + b.x.toFixed(1) + '%;top:' + b.y.toFixed(1) + '%">' + chip(s.bet) + ' ' + euro(s.bet) + '</div>';
      }
      if (st.button === i && st.phase !== 'waiting') {
        var d = spot(slot + .38, st.seatCount, .78);
        html += '<span class="pk-button" style="left:' + d.x.toFixed(1) + '%;top:' + d.y.toFixed(1) + '%" title="Dealer-Button">D</span>';
      }
      return html;
    }
    function renderTable() {
      if (!tab || !tab.state) { main.innerHTML = '<p class="bj-empty">Verbinde mit dem Tisch …</p>'; tab && (tab.barSig = ''); return; }
      var s = tab.state, seat = mySeat();
      if (!$('pk-felt')) {
        main.innerHTML = '<div class="bj-tools" id="pk-tools"></div><div class="bj-table"><div class="pk-col"><div class="bj-felt pk-felt" id="pk-felt"></div>' +
          '<div class="pk-bar sunken" id="pk-bar"></div></div><div class="bj-side" id="pk-side"></div></div>';
        tab.barSig = '';
      }
      $('pk-tools').innerHTML = '<b>' + (s.hidden ? '🔒 ' : '♠️ ') + esc(s.name) + '</b><span class="tag">Hand ' + s.hand + '</span><span class="tag">Blinds ' + euro(s.sb) + ' / ' + euro(s.bb) + '</span>' +
        '<span class="tag">Texas Hold\'em ohne Limit</span>';
      // Eigener Platz unten: alle Plätze so drehen, dass er auf Position 0 landet
      var shift = seat ? seat.i : 0;
      var seats = s.seats.map(function (x, i) { return seatHtml(x, i, s, (i - shift + s.seatCount) % s.seatCount); }).join('');
      var center = '<div class="pk-center"><div class="pk-board">' + (s.board.length ? cards(s.board) : '') + '</div>' +
        (s.pot ? '<div class="pk-pot">Pot <b>' + euro(s.pot) + '</b></div>' : '') +
        (s.phase === 'showdown' ? s.results.map(function (r) { return '<div class="pk-result">🏆 ' + esc(r.winners.join(' und ')) + (r.winners.length > 1 ? ' teilen ' : ' gewinnt ') + esc(r.pot === 'Pot' ? '' : r.pot + ' ') + euro(r.amount) + (r.hand ? ' · ' + esc(r.hand) : '') + '</div>'; }).join('') : '') +
        (s.phase === 'waiting' ? '<div class="pk-result">' + (s.seats.filter(Boolean).length < 2 ? 'Wartet auf einen zweiten Spieler …' : 'Gleich wird gegeben …') + '</div>' : '') + '</div>';
      $('pk-felt').innerHTML = '<div class="bj-motto pk-motto">TEXAS HOLD\'EM · BLINDS ' + s.sb + ' / ' + s.bb + '</div>' + center + seats;
      renderBar(s, seat);
      renderSide(s, seat);
    }
    function renderSide(s, seat) {
      var host = isHost(), r = s.rules, html = '';
      if (seat) {
        html += '<fieldset class="groupbox"><legend>Mein Platz</legend><table class="kv">' +
          '<tr><td>Chips</td><td class="num"><b>' + euro(seat.chips) + '</b></td></tr>' +
          '<tr><td>Nachgekauft</td><td class="num">' + seat.buyins + '×</td></tr>' +
          '<tr><td>Bilanz hier</td><td class="num ' + cls(seat.balance) + '">' + euro(seat.balance, true) + '</td></tr>' +
          '<tr><td>Hände hier</td><td class="num">' + seat.session.hands + ' · ' + seat.session.wins + ' gewonnen</td></tr></table>' +
          '<div class="actions"><button type="button" class="small" data-act="rebuy"' + (seat.chips < r.rebuyBelow && !(s.phase === 'playing' && seat.inHand) ? '' : ' disabled title="Nachkaufen geht unter ' + esc(euro(r.rebuyBelow)) + ' und zwischen zwei Händen"') + '>💰 Nachkaufen</button>' +
          '<button type="button" class="small" data-act="sitout" title="Ab der nächsten Hand aussetzen oder wieder mitspielen">' + (seat.sittingOut ? '▶ Mitspielen' : '⏸ Aussetzen') + '</button>' +
          '<button type="button" class="small" data-act="leave">🚪 Aufstehen</button></div></fieldset>';
      }
      var players = s.seats.filter(Boolean);
      html += '<fieldset class="groupbox"><legend>Am Tisch (' + players.length + (s.viewers.length ? ' + ' + s.viewers.length + ' 👁' : '') + ')</legend><table class="kv">' +
        players.map(function (p) { return '<tr><td><button type="button" class="bj-link" data-user="' + esc(p.user) + '" data-uid="' + p.id + '">' + (s.hostId === p.id ? '👑 ' : '') + esc(p.name) + '</button></td><td class="num ' + cls(p.balance) + '">' + euro(p.balance, true) + '</td></tr>'; }).join('') +
        (s.viewers.length ? '<tr><td colspan="2"><small>👁 ' + s.viewers.map(function (v) { return '<button type="button" class="bj-link" data-user="' + esc(v.user) + '" data-uid="' + v.id + '">' + esc(v.name) + '</button>'; }).join(', ') + '</small></td></tr>' : '') +
        '</table><div class="actions"><button type="button" class="small" data-act="link">🔗 Einladen</button>' +
        (host ? '<button type="button" class="small" data-act="settings">⚙️</button><button type="button" class="small danger" data-act="close" title="Tisch schließen">✖</button>' : '') +
        (!seat ? '<button type="button" class="small" data-act="leave-view">🚪 Weggehen</button>' : '') + '</div></fieldset>';
      html += '<div class="sunken bj-log">' + s.log.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
      $('pk-side').innerHTML = html;
    }

    // Die Leiste mit den Zügen wird nur neu gebaut, wenn sich dafür etwas ändert, damit der Regler beim Ziehen nicht springt
    function renderBar(s, seat) {
      var o = s.options;
      var sig = JSON.stringify([!!seat, seat && seat.inHand, seat && seat.chips, s.phase, o, s.pot, s.hand, s.street]);
      if (sig === tab.barSig) return;
      tab.barSig = sig;
      var bar = $('pk-bar'), html;
      if (!seat) html = s.seats.some(function (x) { return !x; }) ? 'Klick auf einen freien Platz, um mitzuspielen. Du bringst dein Geld aus der Kasse mit.' : 'Alle Plätze sind besetzt. Du siehst zu.';
      else if (!o) {
        var t = s.turn && s.seats[s.turn.seat];
        html = s.phase === 'playing' ? (seat.inHand && !seat.folded ? (t ? esc(t.name) + ' ist dran …' : 'Karten werden aufgedeckt …') : 'Du bist in dieser Hand nicht dabei.') :
          s.phase === 'showdown' ? 'Hand ' + s.hand + ' ist vorbei. Gleich kommt die nächste.' : seat.chips ? 'Warten auf die nächste Hand …' : 'Du hast keine Chips mehr.';
        html = '<span>' + html + '</span>';
      } else {
        var pot = s.pot, raise = Math.max(o.minTo, Math.min(o.maxTo, tab.raise || o.minTo));
        var quick = function (label, to) { to = Math.max(o.minTo, Math.min(o.maxTo, Math.floor(to))); return '<button type="button" class="small" data-to="' + to + '">' + label + '</button>'; };
        html = '<div class="bj-row"><button type="button" data-act="fold" title="Taste F"><u>A</u>ussteigen</button>' +
          (o.canCheck ? '<button type="button" data-act="check" title="Taste C"><u>C</u>heck</button>' : '<button type="button" data-act="call" title="Taste C"><b>Mitgehen ' + euro(o.toCall) + '</b>' + (o.toCall >= seat.chips ? ' (All-in)' : '') + '</button>') + '</div>' +
          (o.canRaise ? '<div class="bj-row pk-raise">' +
            '<input type="range" id="pk-range" min="' + o.minTo + '" max="' + o.maxTo + '" step="' + Math.max(1, s.sb) + '" value="' + raise + '" aria-label="Erhöhen auf">' +
            '<input type="number" id="pk-amount" min="' + o.minTo + '" max="' + o.maxTo + '" value="' + raise + '" aria-label="Betrag">' +
            '<button type="button" data-act="raise" id="pk-raise-btn" title="Taste R oder Enter im Betrag"><b>' + raiseLabel(s, raise, o) + '</b></button></div>' +
            '<div class="bj-row pk-quick">' + quick('Min', o.minTo) + quick('½ Pot', s.currentBet + (pot + o.toCall) / 2) + quick('Pot', s.currentBet + pot + o.toCall) + quick('All-in', o.maxTo) + '</div>' : '');
      }
      bar.innerHTML = html;
    }
    function raiseLabel(s, to, o) { return to >= o.maxTo ? 'All-in ' + euro(to) : (s.currentBet ? 'Erhöhen auf ' : 'Setzen ') + euro(to); }
    function setRaise(v) {
      var o = tab.state.options;
      if (!o) return;
      v = Math.floor(Number(v) || 0);
      tab.raise = v;
      var r = $('pk-range'), a = $('pk-amount'), b = $('pk-raise-btn');
      var shown = Math.max(o.minTo, Math.min(o.maxTo, v));
      if (r && document.activeElement !== r) r.value = shown;
      if (a && document.activeElement !== a) a.value = shown;
      if (b) b.innerHTML = '<b>' + raiseLabel(tab.state, shown, o) + '</b>';
    }
    main.addEventListener('input', function (e) {
      if (e.target.id === 'pk-range' || e.target.id === 'pk-amount') setRaise(e.target.value);
    });
    main.addEventListener('keydown', function (e) {
      if (e.target.id === 'pk-amount' && e.key === 'Enter') { e.preventDefault(); doRaise(); }
    });
    function doRaise() {
      var o = tab.state.options;
      if (!o) return;
      var to = Math.max(o.minTo, Math.min(o.maxTo, Math.floor(Number(tab.raise) || o.minTo)));
      ctl(to >= o.maxTo ? 'allin' : 'raise', { amount: to });
    }

    // Countdown ohne neu zu zeichnen
    var tick = setInterval(function () {
      if (!tab || !tab.state || view !== 'tisch') return;
      var s = tab.state, passed = Date.now() + (tab.offset || 0) - s.now;
      main.querySelectorAll('[data-count]').forEach(function (el) { el.textContent = Math.max(0, secs((s.turn ? s.turn.left : 0) - passed)); });
    }, 250);

    function settings() {
      var s = tab.state;
      dialog('⚙️ Tisch-Einstellungen',
        '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(s.name) + '"></label>' +
        '<div class="row"><label>Blinds (Small / Big):<select name="sb" class="w100">' + blindOpts(s.sb) + '</select></label>' +
        '<label>Plätze:<select name="seats" class="w100">' + [2, 3, 4, 5, 6].map(function (n) { return '<option' + (n === s.seatCount ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
        '<label class="inline"><input type="checkbox" name="hidden"' + (s.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
        '<p><small>Die Blinds lassen sich nur zwischen zwei Händen ändern, weniger Plätze nur, wenn die hinteren frei sind.</small></p>',
        [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r === 'ok') ctl('settings', { name: field('name'), sb: Number(field('sb')), seats: Number(field('seats')), hidden: field('hidden') });
      });
    }
    function invite() {
      var url = K.link();
      dialog('🔗 Einladen', '<p>Schick diesen Link an andere Mitglieder. Wer ihn öffnet, kommt direkt an diesen Tisch.</p><input type="text" class="w100" name="link" readonly value="' + esc(url) + '">',
        [{ label: 'Kopieren', value: 'copy' }, { label: 'Schließen', value: 'cancel' }]).then(function (r) {
        if (r === 'copy' && navigator.clipboard) navigator.clipboard.writeText(url).then(function () { status('Link kopiert.'); }).catch(function () {});
      });
      dlg.querySelector('[name=link]').select();
    }
    function personMenu(e, el) {
      var uid = Number(el.dataset.uid), items = [];
      var s = tab && tab.state, p = s && s.seats.filter(function (x) { return x && x.id === uid; })[0];
      var note = p ? (s.hostId === uid ? '👑 Gastgeber · ' : '') + 'Chips ' + euro(p.chips) + ' · Bilanz hier ' + euro(p.balance, true) : s && s.hostId === uid ? '👑 Gastgeber · sieht zu' : s ? '👁 Sieht zu' : '';
      if (p && isHost() && uid !== ME) items.push({ label: '🚪 Vom Tisch nehmen', danger: true, run: function () { ctl('kick', { user: uid }); } });
      if (window.RetroUserMenu) window.RetroUserMenu.open(e, el.dataset.user, { note: note, items: items });
    }

    // ---------- Statistik ----------
    function loadStats() {
      return req('GET', '/poker/statistik').then(function (j) { stats = j; if (view === 'statistik') renderStats(); }).catch(oops);
    }
    function renderStats() {
      if (!stats) { main.innerHTML = '<p class="bj-empty">Lädt …</p>'; return; }
      var h = '<div class="bj-pad"><div class="tabs" role="tablist"><button type="button" role="tab" data-stab="board" aria-selected="' + (statsTab === 'board') + '">🏆 Bestenliste</button>' +
        '<button type="button" role="tab" data-stab="mine" aria-selected="' + (statsTab === 'mine') + '">👤 Meine Statistik</button></div><div class="tab-page">';
      if (statsTab === 'board') {
        var b = stats.board;
        var rec = function (key, label, fmt) {
          var best = b.slice().sort(function (x, y) { return y[key] - x[key]; })[0];
          return best && best[key] > 0 ? '<div>' + label + ': <b>' + esc(best.name) + ', ' + fmt(best[key]) + '</b></div>' : '';
        };
        var num = function (n) { return n.toLocaleString('de-DE'); };
        h += b.length ? '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Gewinn/Verlust</th><th class="num">Hände</th><th class="num">Gewonnen</th><th class="num">Größter Gewinn</th><th>Bestes Blatt</th></tr></thead><tbody>' +
          b.map(function (u, i) {
            return '<tr' + (u.id === ME ? ' class="bj-me-row"' : '') + '><td>' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</td><td><button type="button" class="bj-link" data-user="' + esc(u.user) + '" data-uid="' + u.id + '">' + esc(u.name) + '</button></td>' +
              '<td class="num ' + cls(u.balance) + '"><b>' + euro(u.balance, true) + '</b></td><td class="num">' + num(u.hands) + '</td>' +
              '<td class="num">' + (u.hands ? Math.round(u.wins / u.hands * 100) : 0) + ' %</td><td class="num">' + euro(u.bestWin, true) + '</td><td>' + (u.bestHand >= 0 ? HANDS[u.bestHand] : '–') + '</td></tr>';
          }).join('') + '</tbody></table><fieldset class="groupbox"><legend>Rekorde</legend><div class="row">' +
            rec('bestWin', '💰 Größter Gewinn', function (n) { return euro(n); }) + rec('bestHand', '🃏 Bestes Blatt', function (n) { return HANDS[n]; }) +
            rec('showdowns', '👀 Meiste Showdowns', num) + '</div></fieldset>'
          : '<p class="bj-empty">Noch hat niemand gespielt.</p>';
        h += '<p><small>Sortiert nach dem, was jemand beim Poker gewonnen oder verloren hat. Kontostand und Gesamtbilanz stehen in der Kasse. Es erscheint nur, wessen Profil du sehen darfst.</small></p>';
      } else {
        var m = stats.me;
        h += '<div class="bj-kpis">' +
          '<div class="sunken"><small>Gewonnen/verloren</small><b class="' + cls(m.balance) + '">' + euro(m.balance, true) + '</b><small>über alle Poker-Sitzungen</small></div>' +
                    '<div class="sunken"><small>Hände</small><b>' + m.hands.toLocaleString('de-DE') + '</b><small>' + m.wins + ' gewonnen · ' + m.showdowns + ' Showdowns</small></div>' +
          '<div class="sunken"><small>Bestwerte</small><b>' + euro(m.best_win, true) + '</b><small>' + (m.best_hand >= 0 ? HANDS[m.best_hand] : 'noch kein Showdown') + '</small></div></div>' +
          '<h3>Letzte Sitzungen</h3>' + (stats.sessions.length ? '<table class="list"><thead><tr><th>Beginn</th><th>Tisch</th><th class="num">Mitgebracht</th><th class="num">Chips</th><th class="num">Ergebnis</th><th class="num">Hände</th></tr></thead><tbody>' +
          stats.sessions.map(function (x) {
            return '<tr><td>' + date(x.started) + (x.ended ? '' : ' <small>(läuft)</small>') + '</td><td>' + esc(x.table) + '</td><td class="num">' + euro(x.bought) + '</td><td class="num">' + euro(x.chips) + '</td>' +
              '<td class="num ' + cls(x.result) + '">' + euro(x.result, true) + '</td><td class="num">' + x.hands + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch keine Sitzungen.</p>') +
          '<p><small>Deine Zahlen stehen auch in deinem <a href="/nutzer/' + encodeURIComponent(me ? me.user : '') + '">Profil</a>.</small></p>';
      }
      main.innerHTML = h + '</div></div>';
    }

    function renderRules() {
      var r = rules();
      main.innerHTML = '<div class="bj-pad bj-rules"><h2>📜 Regeln</h2><ul>' +
        '<li>Gespielt wird <b>Texas Hold\'em ohne Limit</b> mit <b>Spielgeld</b>. Es gibt kein echtes Geld, nichts zum Einzahlen und nichts zum Auszahlen.</li>' +
        '<li>Wer sich an einen Tisch setzt, bringt seinen ganzen Kontostand aus der <b>Kasse</b> als Chips mit (am Anfang ' + euro(r.buyin) + ', das zählt als erster Buy-in); nach jeder Hand geht der Stand zurück in die Kasse. Hast du weniger als <b>' + euro(r.rebuyBelow) + '</b>, kannst du zwischen zwei Händen für ' + euro(r.buyin) + ' nachkaufen, so oft du willst.</li>' +
        '<li><b>Bilanz</b> der Kasse = Kontostand minus alles eingekaufte Geld, für alle Kartenspiele zusammen. Was du beim Poker gewonnen oder verloren hast, zählt die Statistik hier extra; beides steht in deinem Profil.</li>' +
        '<li>Gespielt wird ab zwei Spielern. Der Dealer-Button <span class="pk-button inline">D</span> wandert jede Hand einen Platz weiter, die zwei Plätze danach setzen Small und Big Blind (zu zweit setzt der Button den Small Blind).</li>' +
        '<li>Jeder bekommt zwei verdeckte Karten, die nur er sieht. Dann kommen fünf offene Karten in die Mitte: drei auf einmal (<b>Flop</b>), dann eine (<b>Turn</b>) und noch eine (<b>River</b>). Vor dem Flop und nach jeder neuen Karte wird gesetzt.</li>' +
        '<li>Wer dran ist, kann <b>aussteigen</b>, <b>checken</b> (wenn nichts zu bezahlen ist), <b>mitgehen</b> oder <b>erhöhen</b>. Erhöht wird mindestens um die letzte Erhöhung, höchstens um alles (<b>All-in</b>). Den Betrag stellst du mit dem Regler oder den Knöpfen ein und bestätigst mit „Erhöhen auf …“.</li>' +
        '<li>Wer All-in ist, kann nur gewinnen, was er selbst gegen jeden anderen gesetzt hat. Den Rest spielen die anderen in einem <b>Nebenpot</b> aus.</li>' +
        '<li>Im <b>Showdown</b> gewinnt das beste Blatt aus fünf der sieben Karten (zwei eigene und fünf in der Mitte). Bei Gleichstand wird geteilt.</li>' +
        '<li>Bedenkzeit pro Zug: ' + r.turn + ' Sekunden, danach checkst du automatisch, wenn das geht, sonst steigst du aus. Wer das Fenster länger als anderthalb Minuten zu hat, steht nach der Hand auf. Mit „⏸ Aussetzen“ bleibst du sitzen, bekommst aber keine Karten.</li>' +
        '<li>Tastatur am Tisch: <b>A</b> oder <b>F</b> aussteigen, <b>C</b> checken oder mitgehen, <b>R</b> springt zum Betrag, <b>Enter</b> erhöht.</li></ul>' +
        '<h3>Blätter, vom besten zum schwächsten</h3><table class="list pk-hands"><tbody>' +
        [['Royal Flush', 'A♠ K♠ Q♠ J♠ 10♠', 'Straße von der Zehn bis zum Ass in einer Farbe'], ['Straight Flush', '9♥ 8♥ 7♥ 6♥ 5♥', 'Fünf Karten in Folge, gleiche Farbe'],
          ['Vierling', 'Q♣ Q♦ Q♥ Q♠ 3♦', 'Vier gleiche Werte'], ['Full House', 'K♠ K♥ K♦ 4♣ 4♠', 'Drilling und Paar'], ['Flush', 'A♦ J♦ 8♦ 5♦ 2♦', 'Fünf Karten einer Farbe'],
          ['Straße', '10♣ 9♦ 8♠ 7♥ 6♣', 'Fünf Karten in Folge, das Ass auch ganz unten (A-2-3-4-5)'], ['Drilling', '7♠ 7♥ 7♦ K♣ 2♠', 'Drei gleiche Werte'],
          ['Zwei Paare', 'J♠ J♦ 4♥ 4♣ A♠', 'Zwei Paare'], ['Ein Paar', '10♥ 10♠ K♦ 6♣ 3♠', 'Zwei gleiche Werte'], ['Höchste Karte', 'A♣ Q♦ 9♠ 6♥ 2♣', 'Nichts davon: die höchste Karte zählt']]
          .map(function (x) { return '<tr><td><b>' + x[0] + '</b></td><td class="pk-mini">' + x[1].split(' ').map(function (c) { var s = c.slice(-1); return '<span class="' + (s === '♥' || s === '♦' ? 'red' : '') + '">' + esc(c) + '</span>'; }).join(' ') + '</td><td>' + x[2] + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }

    // ---------- Klicks und Tasten ----------
    main.addEventListener('click', function (e) {
      var b = e.target.closest('button, a');
      if (!b) return;
      if (b.dataset.sit) { ctl('sit', { seat: Number(b.dataset.sit) }); return; }
      if (b.dataset.to) { setRaise(b.dataset.to); return; }
      if (b.dataset.stab) { statsTab = b.dataset.stab; renderStats(); return; }
      if (b.dataset.user) { personMenu(e, b); return; }
      var a = b.dataset.act;
      if (!a) return;
      if (a === 'fold' || a === 'check' || a === 'call') ctl(a);
      else if (a === 'raise') doRaise();
      else if (a === 'rebuy') ctl('rebuy');
      else if (a === 'sitout') ctl('sitout');
      else if (a === 'leave') { var s = mySeat(); if (s && s.inHand && tab.state.phase === 'playing') status('Du steigst aus und stehst nach dieser Hand auf.'); ctl('leave'); }
      else if (a === 'leave-view') { leaveView(); K.lobby(); }
      else if (a === 'settings') settings();
      else if (a === 'link') invite();
      else if (a === 'close') dialog('Tisch schließen', '<p>Den Tisch für alle schließen? Was in der laufenden Hand gesetzt ist, geht zurück.</p>', [{ label: 'Schließen', value: 'ok', danger: true }, { label: 'Abbrechen', value: 'cancel' }])
        .then(function (r) { if (r === 'ok') req('POST', K.url + encodeURIComponent(tab.id), { action: 'close' }).catch(oops); });
    });
    function onKey(e) {
      if (view !== 'tisch' || dlg.open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      var k = e.key.toLowerCase();
      if (k === 'r') { var amt = $('pk-amount'); if (amt) { e.preventDefault(); amt.focus(); amt.select(); } return; }
      var map = { a: 'fold', f: 'fold', c: main.querySelector('[data-act=check]') ? 'check' : 'call' }, act = map[k];
      var btn = act && main.querySelector('[data-act=' + act + ']:not([disabled])');
      if (btn) { e.preventDefault(); btn.click(); }
    }
    document.addEventListener('keydown', onKey);

    // ---------- Start ----------
    loadTables();
    if (K.table) enter(K.table, K.sit);
    else show(K.view || 'statistik');
    // Abbauen, wenn das Fenster ein anderes Spiel zeigt
    return function destroy() { leaveView(); clearInterval(tick); document.removeEventListener('keydown', onKey); };
  };
})();
