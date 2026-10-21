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
  var GAMES = JSON.parse(root.dataset.games), FELTS = root.dataset.felts.split(','), BACKS = root.dataset.backs.split(','), WOODS = root.dataset.woods.split(',');
  var main = $('ks-main'), statusEl = $('ks-status'), meEl = $('ks-me'), dlg = $('ks-dlg'), gameEl = $('ks-game');
  var Sound = window.RetroSound || { play: function () {} };
  var view = 'tische', tables = [], mine = null, me = null, kasse = null, board = null, current = null, shop = null, myWoods = ['eiche'];
  var FELT_NAMES = { gruen: 'Grün', blau: 'Blau', rot: 'Rot', lila: 'Lila', schwarz: 'Schwarz', petrol: 'Petrol mit Chromrand' };
  var WOOD_NAMES = { eiche: 'Eiche', walnuss: 'Walnuss mit Silber', mahagoni: 'Mahagoni mit Messing', ebenholz: 'Ebenholz mit Gold' };
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
    if (v === 'shop') loadShop();
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
    else if (view === 'shop') renderShop();
    else renderGames();
  }
  function renderMe() {
    if (me && kasse) meEl.innerHTML = '👤 ' + esc(me.name) + ' · 💰 ' + euro(kasse.balance) + ' · Bilanz <b class="' + cls(kasse.net) + '">' + euro(kasse.net, true) + '</b>';
    // Kontostand und Bilanz stehen auch unten im Fensterrand (public/retro.js)
    if (kasse) document.body.dataset.status = '💰 ' + euro(kasse.balance) + ' · Bilanz ' + euro(kasse.net, true);
  }

  function loadTables() {
    return req('GET', '/kartenspiele/tische').then(function (j) {
      tables = j.tables; mine = j.mine; me = j.me; kasse = j.kasse; myWoods = j.woods || myWoods;
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
  // Vorschau von Holzrand, Filz und Kartenrücken im Dialog
  function lookCls(felt, back, wood) { return 'ks-preview ks-tisch ks-felt-' + felt + ' ks-back-' + back + ' ks-wood-' + wood; }
  function preview(felt, back, wood) {
    return '<div class="' + lookCls(felt, back, wood) + '" id="ks-preview"><div class="bj-felt"><span class="bj-card back"></span><span class="bj-card back"></span><span class="bj-card red"><span class="r">A</span><span class="s">♥</span></span></div>' +
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
      '<label>Holzrand:<select name="wood" class="w100" data-look="wood">' + WOODS.map(function (w) {
        var has = myWoods.indexOf(w) >= 0 || w === o.wood;
        return '<option value="' + w + '"' + (w === o.wood ? ' selected' : '') + (has ? '' : ' disabled') + '>' + esc(WOOD_NAMES[w] || w) + (has ? '' : ' (erst im 🛒 Shop kaufen)') + '</option>';
      }).join('') + '</select></label>' +
      preview(o.felt, o.back, o.wood || 'eiche') +
      '<label class="inline"><input type="checkbox" name="hidden"' + (o.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
      (o.create ? '<p><small>Das Spiel kannst du am Tisch jederzeit zwischen zwei Runden ändern. Wie viele Plätze es gibt, hängt dann auch vom Spiel ab.</small></p>' : '');
  }
  dlg.addEventListener('change', function (e) {
    if (!e.target.dataset.look) return;
    var p = $('ks-preview');
    if (p) p.className = lookCls(field('felt'), field('back'), field('wood'));
  });
  function createTable() {
    dialog('➕ Neuer Spieltisch', designForm({ create: true, name: 'Spieltisch von ' + (me ? me.name : ''), felt: FELTS[0], back: BACKS[0], wood: 'eiche' }),
      [{ label: '<b>Eröffnen</b>', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      req('POST', '/kartenspiele/tische', { name: field('name'), game: field('game'), seats: Number(field('seats')), felt: field('felt'), back: field('back'), wood: field('wood'), hidden: field('hidden') })
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
      '<div class="sunken"><small>Bilanz</small><b class="' + cls(k.net) + '">' + euro(k.net, true) + '</b><small>Kontostand + Shop − eingekauft</small></div>' +
      '<div class="sunken"><small>Buy-ins</small><b>' + k.buyins + '</b><small>' + euro(k.bought) + ' eingekauft</small></div>' +
      '<div class="sunken"><small>Im Shop ausgegeben</small><b>' + euro(k.spent) + '</b><small>zählt nicht als Verlust</small></div></div>' +
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

  // Shop: Getränke, Glücksbringer (mit dem Körbchen das Pixelpfoten-Tier) und Holzränder für Spielgeld aus der Kasse
  var SHOP_KINDS = [
    ['drink', '🥤 Getränke und Snacks', 'Stehen in der Ablage im Holzrand vor deinem Platz.'],
    ['charm', '🍀 Glücksbringer', 'Liegen neben deinem Namen. Mit dem Körbchen sitzt dein Pixelpfoten-Tier mit am Tisch.'],
    ['wood', '🪵 Holzränder', 'Für deine eigenen Spieltische, wählbar unter „🎨 Tisch gestalten“.'],
  ];
  function loadShop() {
    return req('GET', '/kartenspiele/shop').then(function (j) {
      shop = j; kasse = j.kasse;
      myWoods = j.items.filter(function (x) { return x.kind === 'wood' && x.owned; }).map(function (x) { return x.id; });
      renderMe();
      if (view === 'shop' && !current) renderShop();
    }).catch(oops);
  }
  function shopAct(a, item, kind) {
    req('POST', '/kartenspiele/shop', { action: a, item: item || '', kind: kind || '' }).then(function (j) {
      shop = j; kasse = j.kasse;
      myWoods = j.items.filter(function (x) { return x.kind === 'wood' && x.owned; }).map(function (x) { return x.id; });
      Sound.play(a === 'buy' ? 'ding' : 'klick');
      status(a === 'buy' ? 'Gekauft.' : item ? 'Steht an deinem Platz.' : 'Weggeräumt.');
      renderMe();
      if (view === 'shop' && !current) renderShop();
    }).catch(oops);
  }
  // So sieht dein Platz am Tisch aus
  function seatPreview(d) {
    return '<div class="ks-myseat ks-tisch ks-wood-eiche"><div class="ks-myseat-wood">' + cupHtml(d.drink) + '</div><div class="ks-myseat-me">' + whoHtml(d, me ? me.name : '') +
      '<b>' + esc(me ? me.name : '') + '</b></div></div>';
  }
  function renderShop() {
    if (!shop) { main.innerHTML = '<p class="bj-empty">Lädt …</p>'; return; }
    var k = shop.kasse;
    main.innerHTML = '<div class="bj-pad"><h2>🛒 Shop</h2><div class="ks-shophead"><div><b class="ks-big">💰 ' + euro(k.balance) + '</b><br><small>' +
      (k.atTable ? 'Dein Geld liegt am Tisch „' + esc(k.atTable) + '“, bezahlt wird dort mit deinen Chips.' : 'Bezahlt wird mit Spielgeld aus der Kasse.') +
      ' Gekauftes behältst du; es zählt nicht als Verlust in der Bilanz.</small></div>' + seatPreview(shop.deco) + '</div>' +
      SHOP_KINDS.map(function (c) {
        var cur = c[0] === 'drink' ? shop.drink : c[0] === 'charm' ? shop.charm : null;
        return '<h3>' + c[1] + '</h3><p><small>' + c[2] + '</small>' + (cur ? ' <button type="button" class="small" data-act="equip" data-item="" data-kind="' + c[0] + '">Wegräumen</button>' : '') + '</p>' +
          '<div class="ks-shop">' + shop.items.filter(function (x) { return x.kind === c[0]; }).map(function (x) {
            var on = x.id === cur;
            var btn = !x.owned ? '<button type="button" class="small" data-act="buy" data-item="' + x.id + '"' + (x.price > k.balance && !k.atTable ? ' disabled' : '') + '>Kaufen</button>'
              : x.kind === 'wood' ? '<small>✔ gehört dir</small>'
                : on ? '<button type="button" class="small" disabled>✔ Am Platz</button>' : '<button type="button" class="small" data-act="equip" data-item="' + x.id + '">Hinstellen</button>';
            return '<div class="ks-item' + (x.owned ? ' owned' : '') + (on ? ' on' : '') + '">' + (x.kind === 'wood' ? '<span class="ks-woodchip ks-tisch ks-wood-' + x.id + '"></span>' : '<span class="ks-ic">' + x.icon + '</span>') +
              '<span>' + esc(x.title) + '</span><b>' + (x.price ? euro(x.price) : 'gratis') + '</b>' + btn + '</div>';
          }).join('') + '</div>';
      }).join('') + '</div>';
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
    else if (a === 'buy' || a === 'equip') shopAct(a, b.dataset.item, b.dataset.kind);
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
    if (meta) { design(meta); watch(); url('/kartenspiele?tisch=' + encodeURIComponent(meta.id)); }
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
    unwatch();
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
    WOODS.forEach(function (w) { el.classList.toggle('ks-wood-' + w, w === (m.wood || 'eiche')); });
    el.classList.add('ks-tisch');
    // Wer was am Platz hat, kann sich geändert haben: neu anhängen
    el.querySelectorAll('.ks-who').forEach(function (x) { x.remove(); });
    decorate(true);
    var host = m.hostId === ME || (me && me.admin);
    $('ks-bar').innerHTML = '<b>🂡 Spiel:</b>' +
      (host ? '<select id="ks-pick" title="Gewechselt wird zwischen zwei Runden; alle bleiben sitzen.">' + GAMES.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === m.game ? ' selected' : '') + '>' + x.icon + ' ' + esc(x.id === 'lobby' ? 'Kein Spiel (Lobby)' : x.title) + '</option>';
      }).join('') + '</select>' : '<span>' + g.icon + ' <b>' + esc(m.game === 'lobby' ? 'noch keins' : g.title) + '</b></span>') +
      (m.money ? '<span class="tag" title="Das Geld kommt aus deiner Kasse und geht nach jeder Hand dorthin zurück.">💰 aus der Kasse</span>' : '') +
      '<span class="spacer"></span>' + (host ? '<button type="button" class="small" data-ks="design">🎨 Tisch gestalten</button>' : '<small>👑 ' + esc(m.host) + ' wählt das Spiel</small>') +
      '<button type="button" class="small" data-ks="shop" title="Getränke, Glücksbringer und Holzränder; du bleibst sitzen">🛒 Shop</button>';
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
    if (b.dataset.ks === 'shop') { show('shop'); return; }
    var m = current.meta;
    dialog('🎨 Tisch gestalten', designForm(m), [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      req('POST', '/kartenspiele/tisch/' + encodeURIComponent(m.id), { action: 'design', name: field('name'), felt: field('felt'), back: field('back'), wood: field('wood'), hidden: field('hidden') }).catch(oopsAtTable);
    });
  });
  // Fehler am Tisch landen in der Statusleiste des Spiels
  function oopsAtTable(err) {
    var el = current && current.el.querySelector('.statusbar span');
    if (el) el.textContent = '⚠ ' + err.message;
    Sound.play('fehler');
  }

  // ---------- Der Tisch: Holzrand mit Verzierungen, Ablagen, Avatare, Glücksbringer ----------
  // Die Spiele zeichnen ihren Filz (.bj-felt) selbst neu; Rand und Filz kommen per CSS (.ks-tisch, ::before/::after),
  // Verzierungen und Ablagen liegen in einer Ebene (.ks-layer), die hier nach jedem Neuzeichnen wieder eingesetzt wird.
  // Avatar, Glücksbringer und Tier hängen an den Plätzen (.bj-name[data-uid]); was wer hat, steht in meta.deco.
  function avatarHtml(src, name) {
    return src ? '<img class="ks-ava" src="' + esc(src) + '" alt="">' : '<span class="ks-ava ks-ava-none">' + esc(String(name || '?').charAt(0).toUpperCase()) + '</span>';
  }
  function cupHtml(drink) { return '<span class="ks-cup' + (drink ? '' : ' empty') + '"' + (drink ? ' title="' + esc(drink.title) + '"' : '') + '>' + (drink ? drink.icon : '') + '</span>'; }
  function charmHtml(d) {
    if (!d || !d.charm) return '';
    if (d.charm.id === 'korb') return '<span class="ks-pet" title="' + esc(d.pet ? d.pet.name : 'Leeres Körbchen: Hol dir ein Tier bei Pixelpfoten') + '">' + (d.pet ? d.pet.svg : '') + '<span class="ks-basket">🧺</span></span>';
    return '<span class="ks-charm" title="' + esc(d.charm.title) + '">' + d.charm.icon + '</span>';
  }
  // Über dem Namen: Avatar, daneben Glücksbringer oder das Tier im Körbchen
  function whoHtml(d, name) { return '<span class="ks-who">' + avatarHtml(d && d.avatar, name) + charmHtml(d) + '</span>'; }
  var ORN_SIDE = '<svg viewBox="0 0 64 26"><path d="M32 4 L38 13 L32 22 L26 13 Z"/><circle class="dot" cx="32" cy="13" r="2"/>' +
    '<path d="M25 13 C 18 13, 16 5, 10 7 C 5 9, 6 16, 11 15 C 14 14, 13 11, 11 11"/><path d="M39 13 C 46 13, 48 5, 54 7 C 59 9, 58 16, 53 15 C 50 14, 51 11, 53 11"/>' +
    '<path d="M25 13 C 20 14, 18 20, 13 20"/><path d="M39 13 C 44 14, 46 20, 51 20"/></svg>';
  var ORN_CORNER = '<svg viewBox="0 0 64 26"><path d="M8 18 C 20 18, 22 6, 32 6 C 42 6, 44 18, 56 18"/><circle class="dot" cx="32" cy="6" r="2.2"/><circle class="dot" cx="8" cy="18" r="1.6"/><circle class="dot" cx="56" cy="18" r="1.6"/></svg>';
  var observer = null, sizer = null, pending = 0;
  function decorate(now) {
    if (!now) { if (!pending) pending = requestAnimationFrame(function () { pending = 0; decorate(true); }); return; }
    if (!current || !current.meta) return;
    var felt = current.el.querySelector('.bj-felt');
    if (!felt) return;
    if (sizer && sizer.felt !== felt) { sizer.disconnect(); sizer = null; }
    if (!sizer && window.ResizeObserver) { sizer = new ResizeObserver(function () { decorate(); }); sizer.felt = felt; sizer.observe(felt); }
    var W = felt.clientWidth, H = felt.clientHeight;
    if (!W || !H) return;
    // Maße des Tisches: Rand und Rundung wachsen mit dem Fenster
    var rim = Math.round(Math.max(11, Math.min(22, W * 0.02))), ix = W * 0.025, iy = H * 0.04;
    var bw = W - 2 * ix, bh = H - 2 * iy, r = Math.min(bh / 2, bw * 0.2);
    felt.style.setProperty('--rim', rim + 'px');
    felt.style.setProperty('--ks-r', r + 'px');
    var layer = felt.querySelector(':scope > .ks-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ks-layer';
      layer.setAttribute('aria-hidden', 'true');
      felt.insertBefore(layer, felt.firstChild);
    }
    // Mittellinie des Holzes als abgerundetes Rechteck: Abstand eines Punktes (negativ = innen)
    var cx = W / 2, cy = H / 2, hw = bw / 2 - rim / 2, hh = bh / 2 - rim / 2, rr = r - rim / 2;
    function sdf(x, y) {
      var qx = Math.abs(x - cx) - (hw - rr), qy = Math.abs(y - cy) - (hh - rr);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    }
    // Punkt auf dem Holz in Richtung (x, y), gesehen vom Punkt (ox, oy) innen
    function onRim(ox, oy, x, y) {
      var dx = x - ox, dy = y - oy, len = Math.hypot(dx, dy) || 1, lo = 0, hi = W + H;
      dx /= len; dy /= len;
      if (!len || (dx === 0 && dy === 0)) dy = 1;
      for (var k = 0; k < 30; k++) { var mid = (lo + hi) / 2; if (sdf(ox + dx * mid, oy + dy * mid) < 0) lo = mid; else hi = mid; }
      return { x: ox + dx * lo, y: oy + dy * lo, dx: dx, dy: dy };
    }
    var html = '';
    // Verzierungen: Ranken mitten auf den Seiten, Bögen in den Ecken
    var side = [[cx, iy + rim / 2, 0], [cx, H - iy - rim / 2, 180], [ix + rim / 2, cy, -90], [W - ix - rim / 2, cy, 90]];
    side.forEach(function (o) { html += '<span class="ks-orn" style="left:' + o[0] + 'px;top:' + o[1] + 'px;transform:translate(-50%,-50%) rotate(' + o[2] + 'deg)">' + ORN_SIDE + '</span>'; });
    var cd = rr * (1 - Math.SQRT1_2);
    [[-1, -1, -45], [1, -1, 45], [1, 1, 135], [-1, 1, -135]].forEach(function (c) {
      var x = cx + c[0] * (hw - cd), y = cy + c[1] * (hh - cd);
      html += '<span class="ks-orn corner" style="left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%) rotate(' + c[2] + 'deg)">' + ORN_CORNER + '</span>';
    });
    // Ablagen: auf dem Holz hinter jedem Platz, etwas zur Seite. Beim Blackjack sitzt der Geber oben, die Ablagen kommen
    // senkrecht unter die Plätze.
    var fr = felt.getBoundingClientRect(), deco = current.meta.deco || {};
    var bj = current.id === 'blackjack';
    function at(x, y) { return bj ? onRim(x, cy, x, H * 2) : onRim(cx, cy, x, y); }
    felt.querySelectorAll('.pk-seat, .bj-seat').forEach(function (seat) {
      var sr = seat.getBoundingClientRect(), px = sr.left - fr.left + sr.width / 2, py = sr.top - fr.top + sr.height / 2;
      // Zur linken Seite des Platzes (beim Blackjack nach außen, in der Mitte liegen die Chips)
      var p = at(px, py), off = Math.min(sr.width * 0.62, 80);
      var q1 = at(p.x - p.dy * off, p.y + p.dx * off), q2 = at(p.x + p.dy * off, p.y - p.dx * off);
      var q = bj ? (Math.abs(q1.x - cx) > Math.abs(q2.x - cx) ? q1 : q2) : Math.abs(q1.x - q2.x) > 1 ? (q1.x < q2.x ? q1 : q2) : (q1.y < q2.y ? q1 : q2);
      var name = seat.querySelector('.bj-name[data-uid]'), d = name && deco[name.dataset.uid];
      html += '<span class="ks-at" style="left:' + q.x + 'px;top:' + q.y + 'px">' + cupHtml(d && d.drink) + '</span>';
      // Avatar und Glücksbringer an den Platz hängen (einmal je Neuzeichnen)
      if (name && !seat.querySelector('.ks-who')) name.insertAdjacentHTML('beforebegin', whoHtml(d, name.textContent.replace(/^👑 /, '')));
    });
    if (layer.innerHTML !== html) layer.innerHTML = html;
  }
  function watch() {
    unwatch();
    if (!window.MutationObserver) return;
    observer = new MutationObserver(function (list) {
      // Nur Änderungen der Spiele zählen, nicht die eigene Ebene
      for (var i = 0; i < list.length; i++) if (!list[i].target.closest || !list[i].target.closest('.ks-layer')) { decorate(); return; }
    });
    observer.observe(current.el, { childList: true, subtree: true });
  }
  function unwatch() {
    if (observer) { observer.disconnect(); observer = null; }
    if (sizer) { sizer.disconnect(); sizer = null; }
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
    else if (hash === 'kasse' || hash === 'shop' || hash === 'statistik') show(hash);
  });
  show('tische');
})();
