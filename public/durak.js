// 🎴 Durak im Fenster Kartenspiele (Startmenü → Spiele und Apps → 🂡 Kartenspiele): Spieltisch, Statistik und Regeln.
// Den Tisch schickt der Server per Server-Sent Events (/kartenspiele/tisch/<id>/events), jedem Browser mit nur seinen
// eigenen Karten; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Bestenliste: /durak/statistik.
(function () {
  'use strict';
  // Läuft im Fenster Kartenspiele (public/kartenspiele.js): K.table ist der Spieltisch (oder null, dann nur Statistik und
  // Regeln), K.sit sagt, ob man sich gleich hinsetzt, K.lobby/closed/switched/salon/link führen zurück ins Fenster.
  (window.KartenSpiele = window.KartenSpiele || {}).durak = function (root, K) {
    function $(id) { return document.getElementById(id); }
    var CSRF = root.dataset.csrf, ME = Number(root.dataset.user);
    var main = $('dk-main'), statusEl = $('dk-status'), meEl = $('dk-me'), dlg = $('dk-dlg');
    var Sound = window.RetroSound || { play: function () {} };
    var view = 'tisch', me = null, mineId = null, tab = null, stats = null, statsTab = 'board';
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
      meEl.innerHTML = '👤 ' + esc(me.name) + ' · ' + me.games + (me.games === 1 ? ' Spiel · ' : ' Spiele · ') + me.wins + '× Erster · ' + me.duraks + '× Durak';
    }
    var lastRules = null;
    function rules() { return (tab && tab.state && tab.state.rules) || lastRules || { turn: 30, pass: 15 }; }

    // ---------- Eigene Zahlen ----------
    function loadTables() {
      return req('GET', '/durak/tische').then(function (j) {
        me = j.me;
        renderMe();
      }).catch(oops);
    }
    function seatOpts(cur) { return [2, 3, 4, 5, 6].map(function (n) { return '<option' + (n === cur ? ' selected' : '') + '>' + n + '</option>'; }).join(''); }

    // ---------- Am Tisch ----------
    function enter(id, sit) {
      if (tab && tab.id === id) { show('tisch'); if (sit) ctl('sit'); return; }
      leaveView();
      tab = { id: id, state: null, es: null, sitAfterJoin: !!sit, pick: null };
      tab.es = new EventSource(K.url + encodeURIComponent(id) + '/events');
      tab.es.addEventListener('state', function (e) { onState(JSON.parse(e.data)); });
      tab.es.addEventListener('ping', function (e) { if (tab) tab.offset = JSON.parse(e.data).now - Date.now(); });
      tab.es.addEventListener('closed', function () { gone('Der Spieltisch wurde geschlossen.'); });
      // Der Gastgeber hat ein anderes Spiel gewählt: das Fenster baut den Tisch neu auf
      tab.es.addEventListener('switch', function () { leaveView(); K.switched(); });
      tab.es.addEventListener('salon', function (e) { K.salon(JSON.parse(e.data)); });
      tab.es.addEventListener('fx', function (e) { K.fx(JSON.parse(e.data)); });
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
    // Rolle im laufenden Spiel als Abzeichen am Bild
    function role(st, s) {
      if (st.phase !== 'playing' || !s.inGame) return '';
      if (s.place) return '🏁 ' + s.place + '.';
      if (s.i === st.defender) return st.taking ? '🛡 nimmt' : '🛡';
      if (s.i === st.attacker) return '⚔';
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
      if (!s) return '<div class="pk-seat empty" style="' + style + '">' + K.free(i, !mySeat()) + '</div>';
      var mine = s.id === ME, playing = st.phase === 'playing';
      var turn = st.turn && (st.turn.seat === i || (st.turn.kind === 'pass' && st.waiting.indexOf(i) >= 0));
      var lost = st.phase === 'result' && st.result && st.result.order.some(function (o) { return o.user === s.user && o.durak; });
      var tags = [role(st, s), !playing && s.ready ? '✓ bereit' : '', playing && s.inGame && !turn && s.passed ? '✓' : ''];
      var left = st.turn ? st.turn.left - (Date.now() + (tab.offset || 0) - st.now) : 0;
      return '<div class="pk-seat dk-seat' + (turn ? ' turn' : '') + (mine ? ' mine' : '') + (s.place ? ' folded' : '') + (lost ? ' lost' : '') + (playing && !s.inGame ? ' out' : '') + (p.y < 45 ? ' up' : '') + '" style="' + style + '">' +
        '<div class="pk-hole">' + (mine || !s.cards ? '' : backs(s.cards)) + '</div>' +
        K.plaque({ p: s, host: st.hostId === s.id, turn: turn, left: left, total: (st.turn && st.turn.kind === 'pass' ? rules().pass : rules().turn) * 1000, tags: tags,
          line: playing && s.inGame ? s.cards + (s.cards === 1 ? ' Karte' : ' Karten') : s.session.duraks + '× Durak', note: turn && st.turn.kind === 'pass' ? 'darf zuwerfen' : '' }) + '</div>';
    }
    function renderTable() {
      if (!tab || !tab.state) { main.innerHTML = '<p class="bj-empty">Verbinde mit dem Tisch …</p>'; return; }
      var s = tab.state, seat = mySeat();
      if (!$('dk-felt')) {
        main.innerHTML = '<div class="bj-table"><div class="pk-col"><div class="bj-felt pk-felt dk-felt" id="dk-felt"></div><div class="ks-dock"><div class="pk-bar dk-bar" id="dk-bar"></div></div></div></div>';
      }
      K.info((s.trump && s.phase === 'playing' ? '<span class="tag">Trumpf <b class="' + (s.trump.s === '♥' || s.trump.s === '♦' ? 'dk-red' : '') + '">' + s.trump.s + '</b></span>' : '') + (s.game ? '<span class="tag">Spiel ' + s.game + '</span>' : ''));
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
          '<div class="pk-result">' + (s.manual ? '👑 ' + esc(s.host) + ' startet das nächste Spiel.' : 'Wer noch einmal will, klickt auf „Bereit“.') + '</div>';
      } else {
        var n = s.seats.filter(Boolean).length;
        h += '<div class="pk-result">' + (n < 2 ? 'Wartet auf einen zweiten Spieler …' : s.manual ? '👑 ' + esc(s.host) + ' startet das Spiel · ' + readyCount(s) : s.seats.every(function (x) { return !x || x.ready; }) ? 'Gleich wird gegeben …' : 'Gegeben wird, wenn alle bereit sind.') + '</div>';
      }
      return h + '</div>';
    }
    // Seitenfach (☰ Mehr): wer sitzt, Verlauf und die eigenen Zahlen
    function renderSide(s, seat) {
      K.side({
        players: s.seats.filter(Boolean).map(function (p) {
          var sub = s.phase === 'playing' ? (p.inGame ? (p.place ? p.place + '. raus' : p.i === s.defender ? 'verteidigt' : p.i === s.attacker ? 'greift an' : '') : 'spielt nächstes Spiel mit') : p.ready ? 'bereit' : 'noch nicht bereit';
          return { p: p, sub: sub, cells: [s.phase === 'playing' && p.inGame ? String(p.cards) : '–', p.session.duraks + '×'] };
        }),
        cols: ['Karten', 'Durak'], viewers: s.viewers, hostId: s.hostId, log: s.log, playing: s.phase === 'playing',
        info: '🎴 Durak mit Zuwerfen, 36 Karten' + (s.trump && s.phase === 'playing' ? ' · Trumpf ' + s.trump.s : ''),
        me: seat ? '<fieldset class="groupbox"><legend>Mein Platz</legend><table class="kv">' +
          '<tr><td>Spiele hier</td><td class="num">' + seat.session.games + '</td></tr>' +
          '<tr><td>Als Erster raus</td><td class="num">' + seat.session.wins + '</td></tr>' +
          '<tr><td>Durak</td><td class="num">' + seat.session.duraks + '×</td></tr></table></fieldset>' : '',
        acts: seat ? (s.phase !== 'playing' ? '<button type="button" data-act="ready">' + (seat.ready ? '✋ Doch nicht bereit' : '✓ Bereit') + '</button>' : '') + '<button type="button" data-act="leave">🚪 Aufstehen</button>' : '',
      });
    }

    function readyCount(s) {
      var p = s.seats.filter(Boolean);
      return p.filter(function (x) { return x.ready; }).length + ' von ' + p.length + ' bereit';
    }
    // Unten: die eigene Hand und die Knöpfe Nehmen / Fertig / Bereit (oder Starten, wenn der Gastgeber startet)
    function renderBar(s, seat) {
      var bar = $('dk-bar'), o = s.options, html = '';
      if (!seat) {
        html = '<span>' + (s.seats.some(function (x) { return !x; }) ? 'Klick auf „🪑 Platz frei“, um mitzuspielen.' : 'Alle Plätze sind besetzt. Du siehst zu.') + '</span>';
      } else if (s.phase !== 'playing' && s.manual) {
        var enough = s.seats.filter(Boolean).length >= 2;
        html = '<div class="bj-row">' + (isHost() ? '<span>' + (enough ? readyCount(s) + '.' : 'Es braucht mindestens 2 Spieler.') + '</span>' + (enough ? K.start('Spiel starten') : '')
          : '<span>' + (seat.ready ? 'Du bist bereit.' : 'Bereit für ein Spiel?') + '</span><button type="button"' + (seat.ready ? '' : ' class="def"') + ' data-act="ready">' + (seat.ready ? '✋ Doch nicht' : '✓ Bereit') + '</button>' + (enough ? K.start('', 'das Spiel') : '')) + '</div>';
      } else if (s.phase !== 'playing' || !seat.inGame) {
        html = '<div class="bj-row"><span>' + (s.phase === 'playing' ? 'Das Spiel läuft schon. Du spielst ab dem nächsten mit.' : seat.ready ? 'Du bist bereit. Gegeben wird, wenn alle bereit sind.' : 'Bereit für ein Spiel?') + '</span>' +
          (s.phase !== 'playing' ? '<button type="button"' + (seat.ready ? '' : ' class="def"') + ' data-act="ready">' + (seat.ready ? '✋ Doch nicht' : '✓ Bereit') + '</button>' : '') + '</div>';
      } else {
        var trump = s.trump.s, hand = sortHand(s.hand || [], trump);
        var playable = function (c) { return o && (o.attack.indexOf(cid(c)) >= 0 || !!o.defend[cid(c)]); };
        html = '<div class="dk-hand">' + (hand.length ? hand.map(function (c) {
          var ok = playable(c);
          return card(c, (ok ? 'ok' : 'dim') + (c.s === trump ? ' trump' : '') + (tab.pick === cid(c) ? ' picked' : ''), ' data-card="' + esc(cid(c)) + '" role="button" tabindex="0"');
        }).join('') : '<span>Keine Karten mehr' + (seat.place ? ', du bist raus. 🎉' : '.') + '</span>') + '</div>';
        html += '<div class="bj-row">' + hint(s, seat) +
          (o && o.take ? '<button type="button" data-act="take" title="Taste N"><u>N</u>ehmen</button>' : '') +
          (o && o.pass ? '<button type="button" class="def" data-act="pass" title="Taste F, Leertaste oder Enter"><u>F</u>ertig</button>' : '') + '</div>';
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

    function settings() {
      var s = tab.state;
      dialog('⚙️ Tisch-Einstellungen',
        '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(s.name) + '"></label>' +
        '<label>Plätze:<select name="seats" class="w100">' + seatOpts(s.seatCount) + '</select></label>' +
        '<label class="inline"><input type="checkbox" name="hidden"' + (s.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
        '<p><small>Weniger Plätze gehen, solange alle Platz haben; wer hinten sitzt, rückt zwischen den Runden auf.</small></p>',
        [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r === 'ok') ctl('settings', { name: field('name'), seats: Number(field('seats')), hidden: field('hidden') });
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
            return '<tr' + (u.id === ME ? ' class="bj-me-row"' : '') + '><td>' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</td><td>' + (u.user ? '<button type="button" class="bj-link" data-user="' + esc(u.user) + '" data-uid="' + u.id + '">' + esc(u.name) + '</button>' : '<i class="anon-name">' + esc(u.name) + '</i>') + '</td>' +
              '<td class="num">' + u.games + '</td><td class="num"><b>' + u.wins + '</b></td><td class="num">' + u.duraks + '×</td><td class="num">' + pct(u.duraks, u.games) + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch hat niemand gespielt.</p>';
        h += '<p><small>Sortiert danach, wie oft jemand als Erster keine Karten mehr hatte, bei Gleichstand nach der kleineren Durak-Quote. Wer anonym bleiben möchte oder sein Profil vor dir verbirgt, steht hier ohne Namen.</small></p>';
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
    // Klicks im ganzen Fenster: auch Werkzeugleiste und Seitenfach (public/kartenspiele.js) tragen data-act
    root.addEventListener('click', function (e) {
      var cardEl = e.target.closest('[data-card]');
      if (cardEl) { playCard(cardEl.dataset.card); return; }
      var tgt = e.target.closest('[data-target]');
      if (tgt && tab && tab.pick) { var c = tab.pick; tab.pick = null; ctl('defend', { card: c, target: Number(tgt.dataset.target) }); return; }
      var b = e.target.closest('button, a');
      if (!b) return;
      if (b.dataset.sit) { ctl('sit', { seat: Number(b.dataset.sit) }); return; }
      if (b.dataset.stab) { statsTab = b.dataset.stab; renderStats(); return; }
      if (b.dataset.user) { personMenu(e, b); return; }
      var a = b.dataset.act;
      if (!a) return;
      if (a === 'take' || a === 'pass') ctl(a);
      else if (a === 'ready') { var seat = mySeat(); ctl('ready', { on: !(seat && seat.ready) }); }
      else if (a === 'leave') {
        var s = mySeat();
        if (s && s.inGame && !s.place && tab.state.phase === 'playing') {
          dialog('🚪 Aufstehen', '<p>Das Spiel läuft noch. Wenn du jetzt aufstehst, ist es für alle vorbei und <b>du bist der Durak</b>.</p>', [{ label: 'Trotzdem aufstehen', value: 'ok', danger: true }, { label: 'Weiterspielen', value: 'cancel' }])
            .then(function (r) { if (r === 'ok') ctl('leave'); });
        } else ctl('leave');
      }
      else if (a === 'leave-view') { leaveView(); K.lobby(); }
      else if (a === 'settings') settings();
      else if (a === 'link') invite();
      else if (a === 'close') dialog('Tisch schließen', '<p>Den Tisch für alle schließen? Ein laufendes Spiel zählt dann nicht.</p>', [{ label: 'Schließen', value: 'ok', danger: true }, { label: 'Abbrechen', value: 'cancel' }])
        .then(function (r) { if (r === 'ok') req('POST', K.url + encodeURIComponent(tab.id), { action: 'close' }).catch(oops); });
    });
    function onKey(e) {
      if (view !== 'tisch' || dlg.open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.card) { e.preventDefault(); playCard(e.target.dataset.card); return; }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { var def = main.querySelector('.ks-dock .def:not([disabled])'); if (def) { e.preventDefault(); def.click(); } return; }
      var k = e.key.toLowerCase(), act = k === 'n' ? 'take' : k === 'f' || k === ' ' ? 'pass' : null;
      var btn = act && main.querySelector('[data-act=' + act + ']:not([disabled])');
      if (btn) { e.preventDefault(); btn.click(); }
    }
    document.addEventListener('keydown', onKey);

    // ---------- Start ----------
    loadTables();
    if (K.table) enter(K.table, K.sit);
    else show(K.view || 'statistik');
    // Abbauen, wenn das Fenster ein anderes Spiel zeigt
    return function destroy() { leaveView(); document.removeEventListener('keydown', onKey); };
  };
})();
