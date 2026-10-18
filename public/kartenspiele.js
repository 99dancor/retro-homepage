// Kartenspiele (Startmenü → Spiele und Apps → 🂡 Kartenspiele, views/kartenspiele.ejs): offene Spieltische, Kasse und
// Bestenlisten. Am Spieltisch baut das Fenster das Skript des gewählten Spiels auf (window.KartenSpiele[id], siehe
// public/blackjack.js, poker.js, durak.js, cardtable.js) und legt die Leiste mit Spielwahl und Aussehen darüber. Wählt der
// Gastgeber ein anderes Spiel, schickt der Server „switch“ und das Fenster baut den neuen Tisch auf, ohne dass jemand aufsteht.
(function () {
  'use strict';
  var root = document.getElementById('ks');
  if (!root || !root.dataset.user) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, ME = Number(root.dataset.user);
  var GAMES = JSON.parse(root.dataset.games), FELTS = root.dataset.felts.split(','), BACKS = root.dataset.backs.split(',');
  var main = $('ks-main'), statusEl = $('ks-status'), meEl = $('ks-me'), dlg = $('ks-dlg'), gameEl = $('ks-game');
  var Sound = window.RetroSound || { play: function () {} };
  var view = 'tische', tables = [], mine = null, me = null, kasse = null, board = null, current = null;
  var FELT_NAMES = { gruen: 'Grün', blau: 'Blau', rot: 'Rot', lila: 'Lila', schwarz: 'Schwarz', petrol: 'Petrol mit Chromrand' };
  var BACK_NAMES = { klassisch: 'Klassisch (Fensterfarben)', rot: 'Rot gestreift', blau: 'Blau gestreift', gruen: 'Grün gestreift', gold: 'Schwarz-Gold', karo: 'Rot-weiß kariert', retro: 'Retro (Punkte)' };
  // Wie die Spiele ihr Fenster erwarten: Kürzel der Element-Ids und Klassen (die Spiele bauen aufeinander auf)
  var LOOK = { blackjack: ['bj', 'bj'], poker: ['pk', 'bj pk'], durak: ['dk', 'bj pk dk'] };
  function look(id) { return LOOK[id] || ['cg', 'bj pk dk cg cg-' + id]; }
  function game(id) { return GAMES.filter(function (g) { return g.id === id; })[0] || { id: id, title: id, icon: '🂠', min: 1, max: 8 }; }

  // ---------- Kleinkram ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function euro(n, sign) { n = Number(n) || 0; return (n < 0 ? '−' : sign && n > 0 ? '+' : sign ? '±' : '') + Math.abs(n).toLocaleString('de-DE') + ' €'; }
  function cls(n) { return n < 0 ? 'neg' : n > 0 ? 'pos' : ''; }
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
    $('ks-dlg-title').textContent = title;
    $('ks-dlg-body').innerHTML = html;
    var acts = $('ks-dlg-actions');
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
    });
  }
  function field(name) {
    var el = dlg.querySelector('[name=' + name + ']');
    return el ? (el.type === 'checkbox' ? el.checked : el.value) : null;
  }
  function url(path) { try { history.replaceState(null, '', path); } catch (e) { /* egal */ } }

  // ---------- Fenster ohne Tisch: Spieltische, Kasse, Bestenlisten ----------
  function show(v) {
    unmount();
    view = v;
    root.hidden = false;
    root.querySelectorAll('.bj-nav [data-view]').forEach(function (a) { a.classList.toggle('active', a.dataset.view === v); });
    url('/kartenspiele');
    render();
    if (v === 'tische') loadTables();
    if (v === 'kasse') loadKasse();
  }
  root.querySelector('.bj-nav').addEventListener('click', function (e) {
    var a = e.target.closest('[data-view]');
    if (!a) return;
    e.preventDefault();
    show(a.dataset.view);
  });
  function render() {
    if (view === 'tische') renderTables();
    else if (view === 'kasse') renderKasse();
    else renderGames();
  }
  function renderMe() {
    if (me && kasse) meEl.innerHTML = '👤 ' + esc(me.name) + ' · 💰 ' + euro(kasse.balance) + ' · Bilanz <b class="' + cls(kasse.net) + '">' + euro(kasse.net, true) + '</b>';
  }

  function loadTables() {
    return req('GET', '/kartenspiele/tische').then(function (j) {
      tables = j.tables; mine = j.mine; me = j.me; kasse = j.kasse;
      renderMe();
      if (view === 'tische' && !current) renderTables();
    }).catch(oops);
  }
  function renderTables() {
    var rows = tables.map(function (t) {
      var full = t.players >= t.seats;
      return '<tr><td>' + (t.hidden ? '🔒 ' : '') + '<b>' + esc(t.name) + '</b></td><td>' + t.icon + ' ' + esc(t.title) + '</td><td>' + esc(t.host) + '</td><td>' + t.players + ' / ' + t.seats +
        (t.viewers ? ' <small>+' + t.viewers + ' 👁</small>' : '') + '</td><td>' + esc(t.status) + '</td>' +
        '<td class="bj-acts"><button type="button" class="small" data-join="' + t.id + '"' + (full && mine !== t.id ? ' title="Alle Plätze besetzt"' : '') + '>' +
        (mine === t.id ? '↩ Zurück an den Tisch' : full ? '👁 Zusehen' : '🪑 Hinsetzen') + '</button>' +
        (mine !== t.id && !full ? ' <button type="button" class="small" data-watch="' + t.id + '">👁 Zusehen</button>' : '') + '</td></tr>';
    }).join('');
    main.innerHTML = '<div class="bj-pad"><div class="actions bj-top"><button type="button" data-act="create"><b>➕ Neuer Spieltisch</b></button><button type="button" data-act="refresh">🔄 Aktualisieren</button>' +
      '<small>' + tables.length + ' ' + (tables.length === 1 ? 'Spieltisch' : 'Spieltische') + ' offen</small></div>' +
      (tables.length ? '<table class="list"><thead><tr><th>Spieltisch</th><th>Spiel</th><th>Gastgeber</th><th>Plätze</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="bj-empty">Gerade ist kein Spieltisch offen. Mach einen auf und lade andere mit dem Link ein.</p>') +
      '<p><small>Am Spieltisch wählt der Gastgeber das Spiel (' + GAMES.filter(function (g) { return g.id !== 'lobby'; }).map(function (g) { return g.icon + ' ' + esc(g.title); }).join(', ') +
      ') und wechselt es zwischen zwei Runden, ohne dass jemand aufstehen muss. Versteckte Tische siehst nur du per Link. Leere Tische schließen nach 10 Minuten. Du kannst nur an einem Tisch gleichzeitig sitzen.</small></p></div>';
  }

  function options(list, names, cur) {
    return list.map(function (x) { return '<option value="' + x + '"' + (x === cur ? ' selected' : '') + '>' + esc(names[x] || x) + '</option>'; }).join('');
  }
  // Vorschau von Filz und Kartenrücken im Dialog
  function preview(felt, back) {
    return '<div class="ks-preview ks-felt-' + felt + ' ks-back-' + back + '" id="ks-preview"><div class="bj-felt"><span class="bj-card back"></span><span class="bj-card back"></span><span class="bj-card red"><span class="r">A</span><span class="s">♥</span></span></div>' +
      '<small>So sieht der Tisch für alle aus.</small></div>';
  }
  function designForm(o) {
    return '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(o.name) + '"></label>' +
      (o.create ? '<div class="row"><label>Spiel:<select name="game" class="w100">' + GAMES.map(function (g) {
        return '<option value="' + g.id + '">' + g.icon + ' ' + esc(g.id === 'lobby' ? 'Erst mal keins, wir treffen uns am Tisch' : g.title + ' (' + (g.min === g.max ? g.min : g.min + '–' + g.max) + ' Spieler)') + '</option>';
      }).join('') + '</select></label>' +
        '<label>Plätze:<select name="seats" class="w100">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option' + (n === 4 ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' : '') +
      '<div class="row"><label>Tisch:<select name="felt" class="w100" data-look="felt">' + options(FELTS, FELT_NAMES, o.felt) + '</select></label>' +
      '<label>Kartenrücken:<select name="back" class="w100" data-look="back">' + options(BACKS, BACK_NAMES, o.back) + '</select></label></div>' +
      preview(o.felt, o.back) +
      '<label class="inline"><input type="checkbox" name="hidden"' + (o.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
      (o.create ? '<p><small>Das Spiel kannst du am Tisch jederzeit zwischen zwei Runden ändern. Wie viele Plätze es gibt, hängt dann auch vom Spiel ab.</small></p>' : '');
  }
  dlg.addEventListener('change', function (e) {
    if (!e.target.dataset.look) return;
    var p = $('ks-preview');
    if (p) p.className = 'ks-preview ks-felt-' + field('felt') + ' ks-back-' + field('back');
  });
  function createTable() {
    dialog('➕ Neuer Spieltisch', designForm({ create: true, name: 'Spieltisch von ' + (me ? me.name : ''), felt: FELTS[0], back: BACKS[0] }),
      [{ label: '<b>Eröffnen</b>', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      req('POST', '/kartenspiele/tische', { name: field('name'), game: field('game'), seats: Number(field('seats')), felt: field('felt'), back: field('back'), hidden: field('hidden') })
        .then(function (j) { enter(j.id, true); }).catch(oops);
    });
  }

  // Kasse: Kontostand, Nachkaufen, Bestenliste nach Bilanz
  function loadKasse() {
    return req('GET', '/kartenspiele/kasse').then(function (j) {
      kasse = j.kasse; board = j.board;
      renderMe();
      if (view === 'kasse' && !current) renderKasse();
    }).catch(oops);
  }
  function renderKasse() {
    if (!kasse || !board) { main.innerHTML = '<p class="bj-empty">Lädt …</p>'; return; }
    var k = kasse, can = k.balance < k.rebuyBelow && !k.atTable;
    main.innerHTML = '<div class="bj-pad"><h2>💰 Kasse</h2><div class="bj-kpis">' +
      '<div class="sunken"><small>Kontostand</small><b>' + euro(k.balance) + '</b><small>' + (k.atTable ? 'liegt gerade am Tisch „' + esc(k.atTable) + '“' : '&nbsp;') + '</small></div>' +
      '<div class="sunken"><small>Bilanz</small><b class="' + cls(k.net) + '">' + euro(k.net, true) + '</b><small>Kontostand − eingekauft</small></div>' +
      '<div class="sunken"><small>Buy-ins</small><b>' + k.buyins + '</b><small>' + euro(k.bought) + ' eingekauft</small></div></div>' +
      '<div class="actions"><button type="button" data-act="rebuy"' + (can ? '' : ' disabled') + '>💶 Für ' + euro(k.buyin) + ' nachkaufen</button>' +
      '<small>' + (k.atTable ? 'Am Tisch kaufst du direkt dort nach.' : can ? 'Du hast weniger als ' + euro(k.rebuyBelow) + '.' : 'Nachkaufen geht, sobald du weniger als ' + euro(k.rebuyBelow) + ' hast.') + '</small></div>' +
      '<p><small>Eine Kasse für alle Kartenspiele mit Geld (Blackjack und Poker). Wer sich an einen Geldtisch setzt, nimmt seinen ganzen Kontostand als Chips mit; nach jeder Hand und beim Aufstehen geht der Stand zurück in die Kasse. ' +
      'Wechselt der Tisch das Spiel, bleibt dein Geld bei dir. Jeder startet mit ' + euro(k.buyin) + ', das zählt als erster Buy-in. Spielgeld, kein echtes Geld.</small></p>' +
      '<h3>🏆 Bestenliste nach Bilanz</h3>' + (board.length ? '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Bilanz</th><th class="num">Kontostand</th><th class="num">Buy-ins</th></tr></thead><tbody>' +
        board.map(function (u, i) {
          return '<tr' + (u.id === ME ? ' class="bj-me-row"' : '') + '><td>' + (['🥇', '🥈', '🥉'][i] || i + 1) + '</td><td><button type="button" class="bj-link" data-user="' + esc(u.user) + '">' + esc(u.name) + '</button></td>' +
            '<td class="num ' + cls(u.net) + '"><b>' + euro(u.net, true) + '</b></td><td class="num">' + euro(u.balance) + '</td><td class="num">' + u.buyins + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="bj-empty">Noch hat niemand eine Kasse.</p>') +
      '<p><small>Es erscheint nur, wessen Profil du sehen darfst.</small></p></div>';
  }

  // Bestenlisten und Regeln: das Spiel ohne Tisch aufbauen
  function renderGames() {
    main.innerHTML = '<div class="bj-pad"><h2>📊 Bestenlisten und Regeln</h2><p>Jedes Spiel hat seine eigene Bestenliste und Statistik; deine Zahlen stehen auch in deinem <a href="/nutzer/' + encodeURIComponent(me ? me.user : '') + '">Profil</a>.</p>' +
      '<div class="ks-games">' + GAMES.filter(function (g) { return g.id !== 'lobby'; }).map(function (g) {
        return '<button type="button" data-stats="' + g.id + '">' + g.icon + ' ' + esc(g.title) + '</button>';
      }).join('') + '</div></div>';
  }

  main.addEventListener('click', function (e) {
    var b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.join) { var t = tables.filter(function (x) { return x.id === b.dataset.join; })[0]; enter(b.dataset.join, t && t.players < t.seats && mine !== t.id); return; }
    if (b.dataset.watch) { enter(b.dataset.watch, false); return; }
    if (b.dataset.stats) { mount(b.dataset.stats, null, false, 'statistik'); return; }
    if (b.dataset.user) { if (window.RetroUserMenu) window.RetroUserMenu.open(e, b.dataset.user, {}); return; }
    var a = b.dataset.act;
    if (a === 'create') createTable();
    else if (a === 'refresh') loadTables();
    else if (a === 'rebuy') req('POST', '/kartenspiele/kasse', { action: 'rebuy' }).then(function () { Sound.play('ding'); status('Nachgekauft.'); return loadKasse(); }).catch(oops);
  });

  // ---------- Am Spieltisch ----------
  function enter(id, sit) {
    return req('GET', '/kartenspiele/tisch/' + encodeURIComponent(id)).then(function (meta) { mount(meta.game, meta, sit); })
      .catch(function (e) { show('tische'); oops(e); });
  }
  // Das Spiel im Fenster aufbauen: mit Spieltisch (meta) oder ohne, dann nur Statistik und Regeln (viewName)
  function mount(id, meta, sit, viewName) {
    unmount();
    var g = game(id), l = look(id), p = l[0];
    var nav = '<a href="#tische" data-view="tische">🂡 Spieltische</a>' + '<a href="#tisch" data-view="tisch" hidden>🟩 Am Tisch</a>' +
      (id === 'lobby' ? '' : '<a href="#statistik" data-view="statistik">📊 ' + esc(g.title) + '-Statistik</a>') + '<a href="#regeln" data-view="regeln">📜 Regeln</a>';
    gameEl.innerHTML = '<div class="' + l[1] + '" id="' + p + '" data-csrf="' + esc(CSRF) + '" data-user="' + ME + '" data-game="' + id + '" data-title="' + esc(g.title) + '" data-icon="' + g.icon + '" data-seats="' + g.min + '-' + g.max + '">' +
      '<nav class="menubar bj-nav" role="tablist">' + nav + '<span class="spacer"></span><span class="bj-me" id="' + p + '-me"></span></nav>' +
      (meta ? '<div class="ks-bar" id="ks-bar"></div>' : '') +
      '<div class="bj-main" id="' + p + '-main"></div><div class="statusbar"><span id="' + p + '-status">' + g.icon + ' ' + esc(g.title) + '</span></div></div>' +
      '<dialog class="window mp-dlg" id="' + p + '-dlg"><div class="titlebar"><span class="ttl" id="' + p + '-dlg-title"></span></div><form method="dialog" class="body"><div id="' + p + '-dlg-body"></div><div class="actions" id="' + p + '-dlg-actions"></div></form></dialog>';
    root.hidden = true;
    gameEl.hidden = false;
    current = { id: id, meta: meta, el: gameEl.firstElementChild, destroy: null };
    if (meta) { design(meta); url('/kartenspiele?tisch=' + encodeURIComponent(meta.id)); }
    var K = {
      table: meta ? meta.id : null, sit: !!sit, view: viewName, url: '/kartenspiele/tisch/',
      lobby: function () { show('tische'); },
      closed: function (msg) { show('tische'); status(msg); },
      switched: function () { enter(meta.id, false); },
      salon: function (m) { if (current && current.meta && current.meta.id === m.id) design(m); },
      link: function () { return location.origin + '/kartenspiele?tisch=' + encodeURIComponent(meta.id); },
    };
    var start = window.KartenSpiele && window.KartenSpiele[id];
    if (!start) { show('tische'); status('Dieses Spiel lässt sich gerade nicht laden.'); return; }
    current.destroy = start(current.el, K);
  }
  function unmount() {
    if (!current) return;
    if (current.destroy) current.destroy();
    current = null;
    gameEl.innerHTML = '';
    gameEl.hidden = true;
  }
  // Leiste über dem Tisch: Spielwahl für den Gastgeber, Aussehen, Geld aus der Kasse
  function design(m) {
    current.meta = m;
    var el = current.el, g = game(m.game);
    FELTS.forEach(function (f) { el.classList.toggle('ks-felt-' + f, f === m.felt); });
    BACKS.forEach(function (b) { el.classList.toggle('ks-back-' + b, b === m.back); });
    var host = m.hostId === ME || (me && me.admin);
    $('ks-bar').innerHTML = '<b>🂡 Spiel:</b>' +
      (host ? '<select id="ks-pick" title="Gewechselt wird zwischen zwei Runden; alle bleiben sitzen.">' + GAMES.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === m.game ? ' selected' : '') + '>' + x.icon + ' ' + esc(x.id === 'lobby' ? 'Kein Spiel (Lobby)' : x.title) + '</option>';
      }).join('') + '</select>' : '<span>' + g.icon + ' <b>' + esc(m.game === 'lobby' ? 'noch keins' : g.title) + '</b></span>') +
      (m.money ? '<span class="tag" title="Das Geld kommt aus deiner Kasse und geht nach jeder Hand dorthin zurück.">💰 aus der Kasse</span>' : '') +
      '<span class="spacer"></span>' + (host ? '<button type="button" class="small" data-ks="design">🎨 Tisch gestalten</button>' : '<small>👑 ' + esc(m.host) + ' wählt das Spiel</small>');
  }
  gameEl.addEventListener('change', function (e) {
    if (e.target.id !== 'ks-pick' || !current || !current.meta) return;
    var m = current.meta, to = e.target.value;
    req('POST', '/kartenspiele/tisch/' + encodeURIComponent(m.id), { action: 'game', game: to }).catch(function (err) {
      e.target.value = m.game;
      oopsAtTable(err);
    });
  });
  gameEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ks]');
    if (!b || !current || !current.meta) return;
    var m = current.meta;
    dialog('🎨 Tisch gestalten', designForm(m), [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      req('POST', '/kartenspiele/tisch/' + encodeURIComponent(m.id), { action: 'design', name: field('name'), felt: field('felt'), back: field('back'), hidden: field('hidden') }).catch(oopsAtTable);
    });
  });
  // Fehler am Tisch landen in der Statusleiste des Spiels
  function oopsAtTable(err) {
    var el = current && current.el.querySelector('.statusbar span');
    if (el) el.textContent = '⚠ ' + err.message;
    Sound.play('fehler');
  }

  // Treffpunkt ohne Spiel: läuft über den gemeinsamen Kartentisch (public/cardtable.js), gegeben wird dort nie
  window.CardTable({
    id: 'lobby',
    noStats: true,
    tableWord: 'Spieltisch',
    motto: 'SPIELTISCH',
    blurb: '',
    idle: function (s, ctx) {
      var host = s.seats.filter(function (x) { return x && x.id === s.hostId; })[0];
      return s.hostId === ME || (me && me.admin) ? 'Du bist Gastgeber: Wähl oben in der Leiste ein Spiel, sobald alle da sind.' : '👑 ' + ctx.esc(host ? host.name : s.host) + ' wählt gleich ein Spiel.';
    },
    center: function () { return ''; },
    bar: function () { return ''; },
    rules: function () {
      return '<p>Am Spieltisch trefft ihr euch, bevor ihr ein Spiel anfangt. Der Gastgeber (👑) wählt oben in der Leiste das Spiel und kann es zwischen zwei Runden wechseln; wer sitzt, bleibt dabei auf seinem Platz.</p>' +
        '<ul>' + GAMES.filter(function (g) { return g.id !== 'lobby'; }).map(function (g) { return '<li>' + g.icon + ' <b>' + esc(g.title) + '</b>: ' + (g.min === g.max ? g.min : g.min + ' bis ' + g.max) + ' Spieler' + (g.money ? ', mit Geld aus der Kasse' : '') + '</li>'; }).join('') + '</ul>' +
        '<p>Hat ein Spiel weniger Plätze, als Leute am Tisch sitzen, lässt es sich erst wählen, wenn jemand aufsteht.</p>';
    },
    stats: { board: [], kpis: [], games: [] },
  });

  // ---------- Start ----------
  var q = new URLSearchParams(location.search), want = q.get('tisch'), statsFor = q.get('statistik');
  var hash = (location.hash || '').slice(1);
  loadTables().then(function () {
    if (want) enter(want, false);
    else if (statsFor && game(statsFor).id) mount(statsFor, null, false, 'statistik');
    else if (mine) enter(mine, false);
    else if (hash === 'kasse' || hash === 'statistik') show(hash);
  });
  show('tische');
})();
