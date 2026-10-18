// 🃏 Blackjack im Fenster Kartenspiele (Startmenü → Spiele und Apps → 🂡 Kartenspiele): Spieltisch, Statistik und Regeln.
// Den Tisch schickt der Server per Server-Sent Events (/kartenspiele/tisch/<id>/events), jedem Browser mit nur seinen
// eigenen Karten; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Bestenliste: /blackjack/statistik.
(function () {
  'use strict';
  // Läuft im Fenster Kartenspiele (public/kartenspiele.js): K.table ist der Spieltisch (oder null, dann nur Statistik und
  // Regeln), K.sit sagt, ob man sich gleich hinsetzt, K.lobby/closed/switched/salon/link führen zurück ins Fenster.
  (window.KartenSpiele = window.KartenSpiele || {}).blackjack = function (root, K) {
    function $(id) { return document.getElementById(id); }
    var CSRF = root.dataset.csrf, ME = Number(root.dataset.user), TITLE = root.dataset.title;
    var main = $('bj-main'), statusEl = $('bj-status'), meEl = $('bj-me'), dlg = $('bj-dlg');
    var Sound = window.RetroSound || { play: function () {} };
    var view = 'tisch', me = null, mineId = null, tab = null, stats = null, statsTab = 'board';
    var CHIPS = [1, 5, 10, 25, 50, 100, 500, 1000];

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
      $('bj-dlg-title').textContent = title;
      $('bj-dlg-body').innerHTML = html;
      var acts = $('bj-dlg-actions');
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
    function userMenu(e, username, opts) {
      if (window.RetroUserMenu) window.RetroUserMenu.open(e, username, opts);
    }

    // ---------- Karten ----------
    function card(c, i) {
      if (!c) return '<span class="bj-card back" style="--i:' + i + '"></span>';
      var red = c.s === '♥' || c.s === '♦';
      return '<span class="bj-card' + (red ? ' red' : '') + '" style="--i:' + i + '" title="' + esc(c.r + c.s) + '"><span class="r">' + esc(c.r) + '<br>' + c.s + '</span><span class="s">' + c.s + '</span></span>';
    }
    function cards(list) { return '<span class="bj-cards">' + list.map(card).join('') + '</span>'; }
    var RESULT = { win: 'Gewonnen', blackjack: 'Blackjack!', push: 'Unentschieden', lose: 'Verloren', bust: 'Überkauft' };
    function totalBadge(h) {
      if (h.result) return '<span class="bj-badge ' + h.result + '">' + RESULT[h.result] + (h.result === 'bust' ? ' (' + h.total + ')' : h.result === 'blackjack' ? '' : ' · ' + h.total) + '</span>';
      if (h.cards.length === 2 && h.total === 21 && !h.split) return '<span class="bj-badge blackjack">Blackjack</span>';
      return '<span class="bj-badge">' + (h.soft ? (h.total - 10) + ' / ' + h.total : h.total) + '</span>';
    }

    // ---------- Navigation ----------
    function show(v) {
      if (v === 'tische' || (v === 'tisch' && !tab)) { K.lobby(); return; }
      view = v;
      root.querySelectorAll('.bj-nav [data-view]').forEach(function (a) {
        a.classList.toggle('active', a.dataset.view === v);
        if (a.dataset.view === 'tisch') a.hidden = !tab;
      });
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

    // ---------- Eigene Zahlen ----------
    function loadTables() {
      return req('GET', '/blackjack/tische').then(function (j) {
        me = j.me;
        renderMe();
      }).catch(oops);
    }
    var lastRules = null;
    function rules() { return (tab && tab.state && tab.state.rules) || lastRules || { buyin: 1000, rebuyBelow: 200, decks: 6, h17: false, turn: 30 }; }

    // ---------- Am Tisch ----------
    function enter(id, sit) {
      if (tab && tab.id === id) { show('tisch'); if (sit) ctl('sit'); return; }
      leaveView();
      tab = { id: id, state: null, es: null, sitAfterJoin: !!sit, seen: {} };
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
      // Nach jeder Runde stimmen die eigenen Zahlen aus der Datenbank wieder
      if (prev && prev.phase !== 'result' && s.phase === 'result') setTimeout(loadTables, 300);
      if (first) status('Am Tisch „' + s.name + '“.');
      if (seat && s.phase !== 'playing' && s.phase !== 'dealer' && seat.chips < s.minBet && seat.chips < s.rules.rebuyBelow && !tab.askedRebuy) { tab.askedRebuy = true; askRebuy(); }
      if (seat && seat.chips >= s.minBet) tab.askedRebuy = false;
      if (view === 'tisch') renderTable();
    }
    function cardCount(s) {
      var n = s.dealer.filter(Boolean).length;
      s.seats.forEach(function (x) { if (x) x.hands.forEach(function (h) { n += h.cards.length; }); });
      return n;
    }
    function sounds(prev, s) {
      if (!prev) return;
      if (cardCount(s) > cardCount(prev)) Sound.play('karte');
      var seat = mySeat(), before = prev.seats.filter(function (x) { return x && x.id === ME; })[0];
      if (seat && before && seat.bet !== before.bet && seat.bet) Sound.play('chips');
      if (prev.phase !== 'result' && s.phase === 'result' && seat && seat.hands.length) {
        var res = seat.hands.map(function (h) { return h.result; });
        if (res.indexOf('blackjack') >= 0) Sound.play('tusch');
        else if (res.indexOf('win') >= 0) Sound.play('ding');
        else if (res.indexOf('lose') >= 0 || res.indexOf('bust') >= 0) Sound.play('fehler');
      }
      if (s.turn && seat && s.turn.seat === seat.i && !(prev.turn && prev.turn.seat === seat.i)) Sound.play('hinweis');
    }

    function askRebuy() {
      var s = tab.state, seat = mySeat(), r = s.rules;
      dialog('💰 Keine Chips mehr',
        '<p>Du hast nur noch ' + euro(seat.chips) + '. Du kannst für ' + euro(r.buyin) + ' nachkaufen, so oft du willst.</p>' +
        '<div class="sunken"><table class="kv"><tr><td>Hier schon nachgekauft</td><td class="num">' + seat.buyins + '×</td></tr>' +
        '<tr><td>Bilanz an diesem Tisch</td><td class="num ' + cls(seat.balance) + '">' + euro(seat.balance, true) + '</td></tr>' +
        '<tr><td>Nach dem Nachkauf</td><td class="num">' + euro(seat.chips + r.buyin) + ' Chips</td></tr></table></div>' +
        '<p><small>Der Nachkauf zählt in deiner Kasse als Buy-in und ändert die Bilanz nicht, erst gewonnene und verlorene Hände tun das.</small></p>',
        [{ label: '<b>Für ' + euro(r.buyin) + ' nachkaufen</b>', value: 'buy' }, { label: 'Zusehen', value: 'cancel' }, { label: 'Aufstehen', value: 'leave' }]).then(function (v) {
        if (v === 'buy') ctl('rebuy');
        else if (v === 'leave') ctl('leave');
      });
    }

    // Plätze im Halbkreis um den Dealer
    var POS = { 1: [50], 2: [30, 70], 3: [17, 50, 83], 4: [12, 37, 63, 88], 5: [10, 30, 50, 70, 90] };
    function seatHtml(s, i, st) {
      var pos = POS[st.seatCount][i], dy = Math.abs(pos - 50) * 1.3;
      var style = 'left:' + pos + '%;top:calc(46% - var(--c) * ' + (dy / 44).toFixed(2) + ')';
      if (!s) {
        return '<div class="bj-seat empty" style="' + style + '">' + (mySeat() ? '<span class="bj-free">frei</span>' : '<button type="button" class="small" data-sit="' + i + '">🪑 Hier hinsetzen</button>') + '</div>';
      }
      var turn = st.turn && st.turn.seat === i, mine = s.id === ME;
      var hands = s.hands.length ? s.hands.map(function (h, k) {
        var active = turn && st.turn.hand === k;
        return '<div class="bj-hand' + (active ? ' active' : '') + '">' + cards(h.cards) + '<div>' + chip(h.bet) + ' ' + totalBadge(h) + (h.doubled ? ' <small>×2</small>' : '') + '</div></div>';
      }).join('') : (s.bet ? '<div class="bj-hand">' + chip(s.bet) + (st.phase === 'betting' ? (s.ready ? ' <span class="bj-badge win" title="Einsatz bestätigt">✔</span>' : ' <small>wählt …</small>') : '') + '</div>' : '<div class="bj-hand bj-nobet">' + (st.phase === 'betting' ? (s.chips < st.minBet ? 'keine Chips' : 'setzt …') : 'setzt aus') + '</div>');
      return '<div class="bj-seat' + (turn ? ' turn' : '') + (mine ? ' mine' : '') + '" style="' + style + '">' + hands +
        '<button type="button" class="bj-name" data-user="' + esc(s.user) + '" data-uid="' + s.id + '">' + (st.hostId === s.id ? '👑 ' : '') + esc(s.name) + (mine ? ' (du)' : '') + (s.away ? ' 💤' : '') + (s.leaving ? ' 🚪' : '') + '</button>' +
        '<div class="bj-chips">Chips ' + euro(s.chips) + ' · <span class="' + cls(s.balance) + '">' + euro(s.balance, true) + '</span></div></div>';
    }
    function chip(n) {
      if (!n) return '';
      var c = n >= 1000 ? 'c1000' : n >= 500 ? 'c500' : n >= 100 ? 'c100' : n >= 50 ? 'c50' : n >= 25 ? 'c25' : n >= 10 ? 'c10' : 'c5';
      return '<span class="bj-chip ' + c + '" title="Einsatz ' + euro(n) + '">' + (n >= 1000 ? (n / 1000).toLocaleString('de-DE') + 'k' : n) + '</span>';
    }
    function secs(ms) { return Math.ceil(ms / 1000); }
    function renderTable() {
      if (!tab || !tab.state) { main.innerHTML = '<p class="bj-empty">Verbinde mit dem Tisch …</p>'; return; }
      var s = tab.state, seat = mySeat(), host = isHost(), r = s.rules;
      var dealer = s.dealer.length ? cards(s.dealer) + ' <span class="bj-badge">' + (s.dealer.indexOf(null) >= 0 ? s.dealerTotal + ' + ?' : s.dealerTotal) + '</span>' : '';
      var phaseText = s.phase === 'betting' ? (s.betLeft ? 'Einsätze: noch <b data-count="bet">' + secs(s.betLeft) + '</b> s' : 'Chips legen und Einsatz bestätigen') :
        s.phase === 'dealer' ? 'Dealer ist dran' : s.phase === 'result' ? 'Runde ' + s.round + ' vorbei' :
        s.turn ? (s.seats[s.turn.seat] && s.seats[s.turn.seat].id === ME ? '<b>Du bist dran</b> · <b data-count="turn">' + secs(s.turn.left) + '</b> s ⏳' : esc(s.seats[s.turn.seat] ? s.seats[s.turn.seat].name : '') + ' ist dran · <span data-count="turn">' + secs(s.turn.left) + '</span> s') : '';
      var felt = '<div class="bj-felt"><div class="bj-dealer"><div class="bj-label">DEALER</div>' + dealer + '</div>' +
        '<div class="bj-motto">BLACKJACK ZAHLT 3 ZU 2 · DEALER ' + (r.h17 ? 'ZIEHT AUF SOFT 17' : 'STEHT AUF ALLEN 17') + '</div>' +
        s.seats.map(function (x, i) { return seatHtml(x, i, s); }).join('') +
        '<div class="bj-bottom"><div class="bj-phase">' + phaseText + '</div><div class="bj-controls">' + controls(s, seat) + '</div></div></div>';
      var side = '<div class="bj-side">';
      if (seat) {
        side += '<fieldset class="groupbox"><legend>Mein Platz</legend><table class="kv">' +
          '<tr><td>Chips</td><td class="num"><b>' + euro(seat.chips) + '</b></td></tr>' +
          '<tr><td>Nachgekauft</td><td class="num">' + seat.buyins + '×</td></tr>' +
          '<tr><td>Bilanz hier</td><td class="num ' + cls(seat.balance) + '">' + euro(seat.balance, true) + '</td></tr>' +
          '<tr><td>Hände hier</td><td class="num">' + seat.session.hands + ' · ' + seat.session.wins + ' gewonnen</td></tr></table>' +
          '<div class="actions"><button type="button" class="small" data-act="rebuy"' + (seat.chips < r.rebuyBelow && !inHand(seat) ? '' : ' disabled title="Nachkaufen geht unter ' + esc(euro(r.rebuyBelow)) + ' und zwischen zwei Händen"') + '>💰 Nachkaufen</button>' +
          '<button type="button" class="small" data-act="leave">🚪 Aufstehen</button></div></fieldset>';
      }
      var players = s.seats.filter(Boolean);
      side += '<fieldset class="groupbox"><legend>Am Tisch (' + players.length + (s.viewers.length ? ' + ' + s.viewers.length + ' 👁' : '') + ')</legend><table class="kv">' +
        players.map(function (p) { return '<tr><td><button type="button" class="bj-link" data-user="' + esc(p.user) + '" data-uid="' + p.id + '">' + (s.hostId === p.id ? '👑 ' : '') + esc(p.name) + '</button></td><td class="num ' + cls(p.balance) + '">' + euro(p.balance, true) + '</td></tr>'; }).join('') +
        (s.viewers.length ? '<tr><td colspan="2"><small>👁 ' + s.viewers.map(function (v) { return '<button type="button" class="bj-link" data-user="' + esc(v.user) + '" data-uid="' + v.id + '">' + esc(v.name) + '</button>'; }).join(', ') + '</small></td></tr>' : '') +
        '</table><div class="actions"><button type="button" class="small" data-act="link">🔗 Einladen</button>' +
        (host ? '<button type="button" class="small" data-act="settings">⚙️</button><button type="button" class="small danger" data-act="close" title="Tisch schließen">✖</button>' : '') +
        (!seat ? '<button type="button" class="small" data-act="leave-view">🚪 Weggehen</button>' : '') + '</div></fieldset>';
      side += '<div class="sunken bj-log">' + s.log.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div></div>';
      main.innerHTML = '<div class="bj-tools"><b>' + (s.hidden ? '🔒 ' : '🃏 ') + esc(s.name) + '</b><span class="tag">Runde ' + s.round + '</span><span class="tag">Einsatz ' + euro(s.minBet) + ' – ' + euro(s.maxBet) + '</span>' +
        '<span class="tag">' + r.decks + ' Decks' + (s.shoeLeft ? ' · noch ' + s.shoeLeft + ' Karten' : '') + '</span></div><div class="bj-table">' + felt + side + '</div>';
    }
    function inHand(seat) { return seat.hands.some(function (h) { return !h.result; }); }
    function controls(s, seat) {
      if (!seat) return s.seats.some(function (x) { return !x; }) ? '<small>Klick auf einen freien Platz, um mitzuspielen. Du bringst dein Geld aus der Kasse mit.</small>' : '<small>Alle Plätze sind besetzt. Du siehst zu.</small>';
      if (s.phase === 'betting') {
        if (seat.chips < s.minBet) return '<small>Zu wenig Chips für den Mindesteinsatz.</small> <button type="button" data-act="rebuy">💰 Nachkaufen</button>';
        var room = Math.min(s.maxBet, seat.chips);
        return '<div class="bj-betbar">' + CHIPS.filter(function (c) { return c <= room && c >= Math.min(s.minBet, 5); }).map(function (c) {
          return '<button type="button" class="bj-chip ' + chip(c).match(/c\d+/)[0] + '" data-bet="' + c + '" title="+' + euro(c) + '">' + (c >= 1000 ? '1k' : c) + '</button>';
        }).join('') + '</div><div>Einsatz: <b>' + euro(seat.bet) + '</b> ' +
          (seat.bet && !seat.ready ? '<button type="button" data-act="confirm" title="Taste Enter"><b>✔ Einsatz bestätigen</b></button> ' : '') +
          (seat.ready ? '<span class="bj-badge win">✔ Bestätigt</span> ' : '') +
          (seat.lastBet && seat.lastBet <= room && seat.lastBet >= s.minBet && seat.lastBet !== seat.bet ? '<button type="button" class="small" data-act="again">↺ Wie zuletzt (' + euro(seat.lastBet) + ')</button> ' : '') +
          (seat.bet ? '<button type="button" class="small" data-act="clear">✖ Zurücknehmen</button>' : '') + '</div>' +
          (seat.ready ? '<small>Noch ein Chip ändert den Einsatz, dann neu bestätigen.</small>' : seat.bet ? '<small>Gegeben wird erst, wenn du bestätigst.</small>' : '');
      }
      if (s.phase === 'playing' && s.turn && s.seats[s.turn.seat] === seat) {
        var h = seat.hands[s.turn.hand], two = h.cards.length === 2;
        var canDouble = two && seat.chips >= h.bet, canSplit = two && seat.hands.length === 1 && val(h.cards[0]) === val(h.cards[1]) && seat.chips >= h.bet;
        return '<div class="bj-row"><button type="button" data-act="hit"><u>Z</u>iehen</button><button type="button" data-act="stand"><u>H</u>alten</button>' +
          '<button type="button" data-act="double"' + (canDouble ? '' : ' disabled') + '><u>V</u>erdoppeln</button><button type="button" data-act="split"' + (canSplit ? '' : ' disabled') + '><u>T</u>eilen</button></div>';
      }
      return '';
    }
    function val(c) { return c.r === 'A' ? 11 : ['J', 'Q', 'K'].indexOf(c.r) >= 0 ? 10 : Number(c.r); }

    // Countdown ohne neu zu zeichnen
    var tick = setInterval(function () {
      if (!tab || !tab.state || view !== 'tisch') return;
      var s = tab.state, passed = Date.now() + (tab.offset || 0) - s.now;
      main.querySelectorAll('[data-count]').forEach(function (el) {
        var ms = el.dataset.count === 'bet' ? s.betLeft : s.turn ? s.turn.left : 0;
        el.textContent = Math.max(0, secs(ms - passed));
      });
    }, 250);

    function settings() {
      var s = tab.state;
      var opt = function (list, cur) { return list.map(function (n) { return '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + euro(n) + '</option>'; }).join(''); };
      dialog('⚙️ Tisch-Einstellungen',
        '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(s.name) + '"></label>' +
        '<div class="row"><label>Mindesteinsatz:<select name="minBet" class="w100">' + opt(s.minBets, s.minBet) + '</select></label><label>Höchsteinsatz:<select name="maxBet" class="w100">' + opt(s.maxBets, s.maxBet) + '</select></label>' +
        '<label>Plätze:<select name="seats" class="w100">' + [1, 2, 3, 4, 5].map(function (n) { return '<option' + (n === s.seatCount ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
        '<label class="inline"><input type="checkbox" name="hidden"' + (s.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
        '<p><small>Einsätze lassen sich nur zwischen zwei Runden ändern, weniger Plätze nur, wenn die hinteren frei sind.</small></p>',
        [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r === 'ok') ctl('settings', { name: field('name'), minBet: Number(field('minBet')), maxBet: Number(field('maxBet')), seats: Number(field('seats')), hidden: field('hidden') });
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
      userMenu(e, el.dataset.user, { note: note, items: items });
    }

    // ---------- Statistik ----------
    function loadStats() {
      return req('GET', '/blackjack/statistik').then(function (j) { stats = j; if (view === 'statistik') renderStats(); }).catch(oops);
    }
    function renderStats() {
      if (!stats) { main.innerHTML = '<p class="bj-empty">Lädt …</p>'; return; }
      var h = '<div class="bj-pad"><div class="tabs" role="tablist"><button type="button" role="tab" data-stab="board" aria-selected="' + (statsTab === 'board') + '">🏆 Bestenliste</button>' +
        '<button type="button" role="tab" data-stab="mine" aria-selected="' + (statsTab === 'mine') + '">👤 Meine Statistik</button></div><div class="tab-page">';
      if (statsTab === 'board') {
        var b = stats.board;
        var rec = function (key, label, unit) {
          var best = b.slice().sort(function (x, y) { return y[key] - x[key]; })[0];
          return best && best[key] > 0 ? '<div>' + label + ': <b>' + esc(best.name) + ', ' + (unit ? euro(best[key]) : best[key].toLocaleString('de-DE')) + '</b></div>' : '';
        };
        h += b.length ? '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Gewinn/Verlust</th><th class="num">Hände</th><th class="num">Gewonnen</th><th class="num">Blackjacks</th><th class="num">Größter Gewinn</th></tr></thead><tbody>' +
          b.map(function (u, i) {
            return '<tr' + (u.id === ME ? ' class="bj-me-row"' : '') + '><td>' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</td><td><button type="button" class="bj-link" data-user="' + esc(u.user) + '" data-uid="' + u.id + '">' + esc(u.name) + '</button></td>' +
              '<td class="num ' + cls(u.balance) + '"><b>' + euro(u.balance, true) + '</b></td><td class="num">' + u.hands.toLocaleString('de-DE') + '</td>' +
              '<td class="num">' + (u.hands ? Math.round(u.wins / u.hands * 100) : 0) + ' %</td><td class="num">' + u.blackjacks + '</td><td class="num">' + euro(u.bestWin, true) + '</td></tr>';
          }).join('') + '</tbody></table><fieldset class="groupbox"><legend>Rekorde</legend><div class="row">' + rec('bestStreak', '🔥 Längste Siegesserie') + rec('blackjacks', '🃏 Meiste Blackjacks') + rec('bestWin', '💰 Größter Gewinn', true) + '</div></fieldset>'
          : '<p class="bj-empty">Noch hat niemand gespielt.</p>';
        h += '<p><small>Sortiert nach dem, was jemand beim Blackjack gewonnen oder verloren hat. Kontostand und Gesamtbilanz stehen in der Kasse. Es erscheint nur, wessen Profil du sehen darfst.</small></p>';
      } else {
        var m = stats.me;
        h += '<div class="bj-kpis">' +
          '<div class="sunken"><small>Gewonnen/verloren</small><b class="' + cls(m.balance) + '">' + euro(m.balance, true) + '</b><small>über alle Blackjack-Sitzungen</small></div>' +
                    '<div class="sunken"><small>Hände</small><b>' + m.hands.toLocaleString('de-DE') + '</b><small>' + m.wins + ' gewonnen · ' + m.blackjacks + ' Blackjacks</small></div>' +
          '<div class="sunken"><small>Bestwerte</small><b>' + euro(m.best_win, true) + '</b><small>Serie ' + m.best_streak + '</small></div></div>' +
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
        '<li>Gespielt wird mit <b>Spielgeld</b>. Es gibt kein echtes Geld, nichts zum Einzahlen und nichts zum Auszahlen.</li>' +
        '<li>Wer sich an einen Tisch setzt, bringt seinen ganzen Kontostand aus der <b>Kasse</b> als Chips mit (am Anfang ' + euro(r.buyin) + ', das zählt als erster Buy-in). Nach jeder Hand und beim Aufstehen geht der Stand zurück in die Kasse; wechselt der Tisch das Spiel, bleibt dein Geld bei dir.</li>' +
        '<li>Hast du weniger als <b>' + euro(r.rebuyBelow) + '</b>, kannst du zwischen zwei Händen für ' + euro(r.buyin) + ' nachkaufen, so oft du willst.</li>' +
        '<li><b>Bilanz</b> der Kasse = Kontostand minus alles eingekaufte Geld, für alle Kartenspiele zusammen. Beispiel: 1.000 € Start, dreimal nachgekauft, 500 € übrig: 500 − 4.000 = <b class="neg">−3.500 €</b>. Was du beim Blackjack gewonnen oder verloren hast, zählt die Statistik hier extra; beides steht in deinem Profil.</li>' +
        '<li>' + r.decks + ' Decks, neu gemischt, wenn nur noch ein Viertel übrig ist. Der Dealer ' + (r.h17 ? 'zieht auf Soft 17' : 'steht auf allen 17') + '.</li>' +
        '<li>Blackjack (Ass + Zehnerkarte als erste zwei Karten) zahlt <b>3 zu 2</b>, ein normaler Gewinn 1 zu 1, Gleichstand gibt den Einsatz zurück.</li>' +
        '<li><b>Verdoppeln</b> mit den ersten zwei Karten: doppelter Einsatz, genau eine Karte. <b>Teilen</b> einmal bei zwei gleichwertigen Karten; geteilte Asse bekommen nur noch je eine Karte.</li>' +
        '<li>Hat der Dealer Blackjack, ist die Runde sofort vorbei. Versicherung gibt es nicht.</li>' +
        '<li>Bedenkzeit pro Zug: ' + r.turn + ' Sekunden, danach hältst du automatisch. Wer das Fenster länger als anderthalb Minuten zu hat, steht nach der Runde auf.</li>' +
        '<li>Einsatz: Chips anklicken, bis der Betrag stimmt, dann <b>✔ Einsatz bestätigen</b>. Gegeben wird, wenn alle bestätigt haben, spätestens 15 Sekunden nach der ersten Bestätigung. Wer bis dahin nicht bestätigt hat, setzt diese Runde aus.</li>' +
        '<li>Tastatur am Tisch: <b>Enter</b> bestätigt den Einsatz, <b>Z</b>iehen, <b>H</b>alten, <b>V</b>erdoppeln, <b>T</b>eilen.</li></ul></div>';
    }

    // ---------- Klicks und Tasten ----------
    main.addEventListener('click', function (e) {
      var b = e.target.closest('button, a');
      if (!b) return;
      if (b.dataset.sit) { ctl('sit', { seat: Number(b.dataset.sit) }); return; }
      if (b.dataset.bet) { var seat = mySeat(); if (seat) ctl('bet', { amount: Math.max(tab.state.minBet, Math.min(tab.state.maxBet, seat.chips, seat.bet + Number(b.dataset.bet))) }); return; }
      if (b.dataset.stab) { statsTab = b.dataset.stab; renderStats(); return; }
      if (b.dataset.user) { personMenu(e, b); return; }
      var a = b.dataset.act;
      if (!a) return;
      if (a === 'hit' || a === 'stand' || a === 'double' || a === 'split') ctl(a);
      else if (a === 'again') ctl('bet', { amount: mySeat().lastBet });
      else if (a === 'confirm') ctl('confirm');
      else if (a === 'clear') ctl('bet', { amount: 0 });
      else if (a === 'rebuy') ctl('rebuy');
      else if (a === 'leave') { var s = mySeat(); if (s && s.hands.some(function (h) { return !h.result; })) status('Du stehst nach dieser Hand auf.'); ctl('leave'); }
      else if (a === 'leave-view') { leaveView(); K.lobby(); }
      else if (a === 'settings') settings();
      else if (a === 'link') invite();
      else if (a === 'close') dialog('Tisch schließen', '<p>Den Tisch für alle schließen? Einsätze der laufenden Hand gehen zurück.</p>', [{ label: 'Schließen', value: 'ok', danger: true }, { label: 'Abbrechen', value: 'cancel' }])
        .then(function (r) { if (r === 'ok') req('POST', K.url + encodeURIComponent(tab.id), { action: 'close' }).catch(oops); });
    });
    function onKey(e) {
      if (view !== 'tisch' || dlg.open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      var map = { z: 'hit', h: 'stand', v: 'double', t: 'split', enter: 'confirm' }, a = map[e.key.toLowerCase()];
      var btn = a && main.querySelector('[data-act=' + a + ']:not([disabled])');
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
