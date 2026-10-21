// Kartenspiele (Startmenü → Spiele und Apps → 🂡 Kartenspiele, views/kartenspiele.ejs): offene Spieltische als Karten,
// Kasse, Shop und Bestenlisten. Am Spieltisch baut das Fenster das Skript des gewählten Spiels auf (window.KartenSpiele[id],
// siehe public/blackjack.js, poker.js, durak.js, cardtable.js) und legt den Rahmen darum: eine Werkzeugleiste (Spielwahl,
// Gesichter, Shop, Gestalten, Einladen, ☰ Mehr), das Seitenfach rechts (Am Tisch, Verlauf, Ich oder der Shop), das letzte
// Ereignis in der Statusleiste, Getränke und Glücksbringer auf dem Holz und die Reaktionen. Die Spiele bauen ihre Plätze mit
// K.plaque und K.free und reichen Leiste und Seitenfach mit K.info und K.side herein. Wählt der Gastgeber ein anderes Spiel,
// schickt der Server „switch“ und das Fenster baut den neuen Tisch auf, ohne dass jemand aufsteht.
(function () {
  'use strict';
  var root = document.getElementById('ks');
  if (!root || !root.dataset.user) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, ME = Number(root.dataset.user);
  var GAMES = JSON.parse(root.dataset.games), LOOKS = JSON.parse(root.dataset.looks), EMOTES = JSON.parse(root.dataset.emotes);
  var main = $('ks-main'), statusEl = $('ks-status'), meEl = $('ks-me'), dlg = $('ks-dlg'), gameEl = $('ks-game');
  var Sound = window.RetroSound || { play: function () {} };
  var view = 'tische', tables = [], tablesSig = '', mine = null, me = null, kasse = null, board = null, current = null, shop = null, owned = [];
  var DEFAULT = { felt: 'gruen', back: 'klassisch', wood: 'eiche' };
  // Wie die Spiele ihr Fenster erwarten: Kürzel der Element-Ids und Klassen (die Spiele bauen aufeinander auf)
  var LOOK = { blackjack: ['bj', 'bj'], poker: ['pk', 'bj pk'], durak: ['dk', 'bj pk dk'] };
  function look(id) { return LOOK[id] || ['cg', 'bj pk dk cg cg-' + id]; }
  function game(id) { return GAMES.filter(function (g) { return g.id === id; })[0] || { id: id, title: id, icon: '🂠', min: 1, max: 8 }; }
  function playable() { return GAMES.filter(function (g) { return g.id !== 'lobby'; }); }

  // ---------- Kleinkram ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function euro(n, sign) { n = Number(n) || 0; return (n < 0 ? '−' : sign && n > 0 ? '+' : sign ? '±' : '') + Math.abs(n).toLocaleString('de-DE') + ' €'; }
  function cls(n) { return n < 0 ? 'neg' : n > 0 ? 'pos' : ''; }
  function names(list) { return list.length > 1 ? list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1] : list[0] || ''; }
  function status(text) { statusEl.textContent = text; }
  // Fensterweite Kleinigkeiten (offenes Seitenfach, Reiter) merkt sich nur dieser Browser
  function remember(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { /* privat: gilt bis zum Neuladen */ }
    return null;
  }
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
  function oops(e) { if (current) oopsAtTable(e); else { status('⚠ ' + e.message); Sound.play('fehler'); } }
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
  function avatarHtml(src, name, extra) {
    var c = 'ks-ava' + (extra ? ' ' + extra : '');
    return src ? '<img class="' + c + '" src="' + esc(src) + '" alt="">' : '<span class="' + c + ' ks-ava-none">' + esc(String(name || '?').charAt(0).toUpperCase()) + '</span>';
  }

  // ---------- Fenster ohne Tisch: Spieltische, Kasse, Shop, Bestenlisten ----------
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
    else if (view === 'shop') paintShop();
    else renderGames();
  }
  function renderMe() {
    if (me && kasse) meEl.innerHTML = '👤 ' + esc(me.name) + ' · 💰 ' + euro(kasse.balance) + ' · Bilanz <b class="' + cls(kasse.net) + '">' + euro(kasse.net, true) + '</b>';
    // Kontostand und Bilanz stehen auch unten im Fensterrand (public/retro.js)
    if (kasse) document.body.dataset.status = '💰 ' + euro(kasse.balance) + ' · Bilanz ' + euro(kasse.net, true);
  }

  // Tischliste: oben „Schnell spielen“, darunter jeder Tisch als Karte mit Mini-Tisch, Gesichtern und freien Stühlen
  function loadTables() {
    return req('GET', '/kartenspiele/tische').then(function (j) {
      var sig = JSON.stringify([j.tables, j.mine]);
      tables = j.tables; mine = j.mine; me = j.me; kasse = j.kasse; owned = j.owned || owned;
      renderMe();
      if (view === 'tische' && !current && sig !== tablesSig) renderTables();
      tablesSig = sig;
    }).catch(oops);
  }
  setInterval(function () { if (view === 'tische' && !current && !document.hidden) loadTables(); }, 8000);
  function miniTable(t) {
    var n = t.faces.length;
    var seats = t.faces.map(function (f, i) {
      var a = Math.PI / 2 + i * 2 * Math.PI / n, pos = 'left:' + (50 + 39 * Math.cos(a)).toFixed(1) + '%;top:' + (50 + 36 * Math.sin(a)).toFixed(1) + '%';
      return f ? '<span class="ks-pv-seat" style="' + pos + '" title="' + esc(f.name) + '">' + avatarHtml(f.avatar, f.name) + '</span>' : '<span class="ks-pv-seat free" style="' + pos + '" title="Platz frei"></span>';
    }).join('');
    return '<div class="ks-pv ks-wood-' + esc(t.wood || DEFAULT.wood) + ' ks-felt-' + esc(t.felt || DEFAULT.felt) + '" aria-hidden="true"><i class="ks-pv-rim"></i><i class="ks-pv-felt"></i>' +
      '<span class="ks-pv-game">' + t.icon + '</span>' + seats + (t.live ? '<span class="ks-pv-live">● läuft</span>' : '') + (t.hidden ? '<span class="ks-pv-lock" title="Nur mit Link">🔒</span>' : '') + '</div>';
  }
  function tableCard(t) {
    var here = mine === t.id, full = t.players >= t.seats;
    var act = here ? '<button type="button" class="def" data-join="' + t.id + '">↩ Zurück an den Tisch</button>'
      : full ? '<button type="button" data-watch="' + t.id + '">👁 Zusehen</button>'
        : '<button type="button" data-watch="' + t.id + '">👁 Zusehen</button><button type="button" class="def" data-join="' + t.id + '">🪑 Hinsetzen</button>';
    return '<div class="ks-card' + (here ? ' mine' : '') + '">' + miniTable(t) + '<div class="ks-card-bd"><b>' + esc(t.name) + '</b>' +
      '<small>' + esc(t.game === 'lobby' ? 'Noch kein Spiel' : t.title) + ' · 👑 ' + esc(t.host) + '</small>' +
      '<small>' + t.players + ' von ' + t.seats + ' Plätzen · ' + esc(t.status) + (t.viewers ? ' · ' + t.viewers + ' 👁' : '') +
      (t.friends && t.friends.length ? ' · <b title="' + esc(names(t.friends)) + '">👥 ' + t.friends.length + (t.friends.length === 1 ? ' Freund' : ' Freunde') + '</b>' : '') + '</small>' +
      '<div class="ks-card-act">' + act + '</div></div></div>';
  }
  function renderTables() {
    var friends = tables.filter(function (t) { return t.friends && t.friends.length; });
    main.innerHTML = '<div class="bj-pad ks-list"><fieldset class="groupbox ks-quick"><legend>⚡ Schnell spielen</legend>' +
      '<span>Setzt dich an den vollsten Tisch mit freiem Platz oder macht einen auf.</span><span class="ks-quick-go">' +
      playable().map(function (g) { return '<button type="button" data-quick="' + g.id + '">' + g.icon + ' ' + esc(g.title) + '</button>'; }).join('') +
      '<button type="button" class="def" data-quick="egal">Egal</button></span></fieldset>' +
      '<div class="ks-cards">' + tables.map(tableCard).join('') +
      '<button type="button" class="ks-card ks-new" data-act="create"><span class="ks-plus" aria-hidden="true">➕</span><b>Neuer Spieltisch</b>' +
      '<small>Name, Spiel, Holz und Filz wählst du gleich danach am Tisch.</small></button></div>' +
      friends.map(function (t) { return '<p class="ks-friendline">👥 <b>' + esc(names(t.friends)) + '</b> ' + (t.friends.length > 1 ? 'sitzen' : 'sitzt') + ' am Tisch „' + esc(t.name) + '“.</p>'; }).join('') + '</div>';
  }
  function quick(g) {
    status('Suche einen Tisch …');
    req('POST', '/kartenspiele/schnell', { game: g }).then(function (j) { enter(j.id, true); }).catch(oops);
  }
  function createTable() {
    req('POST', '/kartenspiele/tische', {}).then(function (j) { enter(j.id, true); }).catch(oops);
  }

  // Aussehen des Tisches: Holz, Filz und Kartenrücken. Die ersten hat jeder, die anderen gibt es im Shop.
  function lookOptions(kind, cur) {
    return LOOKS[kind].map(function (x) {
      var has = owned.indexOf(x.id) >= 0 || x.id === cur;
      return '<option value="' + x.id + '"' + (x.id === cur ? ' selected' : '') + (has ? '' : ' disabled') + '>' + esc(x.title) + (has ? '' : ' (erst im 🛒 Shop kaufen)') + '</option>';
    }).join('');
  }
  function lookCls(felt, back, wood) { return 'ks-preview ks-tisch ks-felt-' + felt + ' ks-back-' + back + ' ks-wood-' + wood; }
  function preview(felt, back, wood) {
    return '<div class="' + lookCls(felt, back, wood) + '" id="ks-preview"><div class="bj-felt"><span class="bj-card back"></span><span class="bj-card back"></span><span class="bj-card red"><span class="r">A</span><span class="s">♥</span></span></div>' +
      '<small>So sieht der Tisch für alle aus.</small></div>';
  }
  function designForm(o) {
    return '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(o.name) + '"></label>' +
      '<div class="row"><label>Filz:<select name="felt" class="w100" data-look="felt">' + lookOptions('felt', o.felt) + '</select></label>' +
      '<label>Kartenrücken:<select name="back" class="w100" data-look="back">' + lookOptions('back', o.back) + '</select></label></div>' +
      '<label>Holzrand:<select name="wood" class="w100" data-look="wood">' + lookOptions('wood', o.wood || DEFAULT.wood) + '</select></label>' +
      preview(o.felt, o.back, o.wood || DEFAULT.wood) +
      '<label class="inline"><input type="checkbox" name="hidden"' + (o.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>' +
      '<p><small>Mehr Holz, Filz und Kartenrücken gibt es im 🛒 Shop unter „Tisch“. Das Spiel wählst du oben in der Leiste.</small></p>';
  }
  dlg.addEventListener('change', function (e) {
    if (!e.target.dataset.look) return;
    var p = $('ks-preview');
    if (p) p.className = lookCls(field('felt'), field('back'), field('wood'));
  });

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

  // Bestenlisten und Regeln: das Spiel ohne Tisch aufbauen
  function renderGames() {
    main.innerHTML = '<div class="bj-pad"><h2>📊 Bestenlisten und Regeln</h2><p>Jedes Spiel hat seine eigene Bestenliste und Statistik; deine Zahlen stehen auch in deinem <a href="/nutzer/' + encodeURIComponent(me ? me.user : '') + '">Profil</a>.</p>' +
      '<div class="ks-games">' + playable().map(function (g) {
        return '<button type="button" data-stats="' + g.id + '">' + g.icon + ' ' + esc(g.title) + '</button>';
      }).join('') + '</div>' +
      '<h3>So funktionieren die Spieltische</h3><ul class="bj-rules"><li>Am Spieltisch wählt der Gastgeber (👑) das Spiel und wechselt es zwischen zwei Runden, ohne dass jemand aufstehen muss.</li>' +
      '<li>„⚡ Schnell spielen“ setzt dich an den vollsten Tisch mit freiem Platz, „➕ Neuer Spieltisch“ macht sofort einen auf. Name, Holz, Filz und Kartenrücken stellt der Gastgeber am Tisch unter 🎨 Gestalten ein.</li>' +
      '<li>Versteckte Tische siehst nur du und wer den Link hat. Leere Tische schließen nach 10 Minuten. Du kannst nur an einem Tisch gleichzeitig sitzen.</li>' +
      '<li>Am Tisch: ☰ Mehr zeigt, wer sitzt, den ganzen Verlauf und deine Zahlen. Mit 😀 ▾ schickst du eine Reaktion, ein Klick auf dein Glas stößt an, ein Klick auf ein Tier streichelt es.</li>' +
      '<li>Im 🛒 Shop kaufst du mit Spielgeld Getränke, Untersetzer, Glücksbringer, ein Plätzchen für dein Pixelpfoten-Tier und Neues für deine Tische, oder du schmeißt eine Runde für alle. Jede Woche ist ein Teil im Angebot.</li></ul></div>';
  }

  main.addEventListener('click', function (e) {
    var b = e.target.closest('button, a');
    if (!b) return;
    if (shopClick(b)) return;
    if (b.dataset.join) { var t = tables.filter(function (x) { return x.id === b.dataset.join; })[0]; enter(b.dataset.join, t && t.players < t.seats && mine !== t.id); return; }
    if (b.dataset.watch) { enter(b.dataset.watch, false); return; }
    if (b.dataset.quick) { quick(b.dataset.quick); return; }
    if (b.dataset.stats) { mount(b.dataset.stats, null, false, 'statistik'); return; }
    if (b.dataset.user) { if (window.RetroUserMenu) window.RetroUserMenu.open(e, b.dataset.user, {}); return; }
    var a = b.dataset.act;
    if (a === 'create') createTable();
    else if (a === 'rebuy') req('POST', '/kartenspiele/kasse', { action: 'rebuy' }).then(function () { Sound.play('ding'); status('Nachgekauft.'); return loadKasse(); }).catch(oops);
  });
  main.addEventListener('change', function (e) { if (e.target.id === 'ks-round-item') paintRound(); });

  // ---------- Shop: im Fenster (🛒 Shop in der Menüleiste) und im Seitenfach am Tisch ----------
  // Reiter Bar, Glücksbringer, Tisch und Meine Sachen; oben eine Vorschau zum Anprobieren, darunter große Symbole.
  var SHOP_TABS = [['bar', '🥤 Bar', ['drink', 'coaster']], ['charm', '🍀 Glücksbringer', ['charm']], ['tisch', '🪵 Tisch', ['wood', 'felt', 'back']], ['mine', '🎒 Meine Sachen', []]];
  var KIND_NAMES = { drink: 'Getränke und Snacks', coaster: 'Untersetzer', charm: 'Glücksbringer', wood: 'Holzrand', felt: 'Filz', back: 'Kartenrücken' };
  var shopTab = 'bar', shopSel = null, roundItem = 'bier';
  function loadShop() {
    return req('GET', '/kartenspiele/shop').then(function (j) { gotShop(j); }).catch(oops);
  }
  function gotShop(j) {
    shop = j; kasse = j.kasse;
    owned = j.items.filter(function (x) { return x.owned && (x.kind === 'wood' || x.kind === 'felt' || x.kind === 'back'); }).map(function (x) { return x.id; });
    renderMe();
    paintShop();
  }
  function item(id) { return shop && shop.items.filter(function (x) { return x.id === id; })[0]; }
  function placed(kind) { return shop ? shop[kind] : null; }
  function shortTitle(x) { return x.title.split(' für ')[0]; }
  function stars(r) { return r === 2 ? '★★' : r === 1 ? '★' : ''; }
  function shopIcon(x) {
    if (x.kind === 'wood') return '<span class="ks-chip-wood ks-wood-' + x.id + '"></span>';
    if (x.kind === 'felt') return '<span class="ks-chip-felt ks-felt-' + x.id + '"></span>';
    if (x.kind === 'back') return '<span class="bj-card back ks-chip-back ks-back-' + x.id + '"></span>';
    if (x.kind === 'coaster') return '<span class="ks-chip-coaster ks-co-' + x.id + '"></span>';
    return x.icon;
  }
  function priceHtml(x) { return x.price ? (x.was ? '<s>' + euro(x.was) + '</s> ' : '') + euro(x.price) : 'gratis'; }
  function tile(x) {
    var on = placed(x.kind) === x.id;
    return '<button type="button" class="ks-ic' + (x.id === shopSel ? ' sel' : '') + (x.owned ? ' own' : '') + (x.was ? ' deal' : '') + '" data-item="' + x.id + '" title="' + esc(x.title) + '">' +
      '<span class="i">' + shopIcon(x) + '</span>' + (on ? '<span class="ov" title="Steht an deinem Platz">✔</span>' : '') + (x.rarity ? '<span class="rar" title="' + (x.rarity === 2 ? 'legendär' : 'selten') + '">' + stars(x.rarity) + '</span>' : '') +
      '<span class="n">' + esc(shortTitle(x)) + '</span><span class="p">' + (x.owned && x.price ? 'gehört dir' : priceHtml(x)) + '</span></button>';
  }
  function icons(list) { return list.length ? '<div class="ks-icons">' + list.map(tile).join('') + '</div>' : ''; }
  // Was an meinem Platz steht, mit dem gewählten Teil zur Probe
  function tryOn(sel) {
    var d = shop.deco || {}, x = sel && item(sel);
    var drink = d.drink, coaster = d.coaster, charm = d.charm, pet = d.pet;
    if (x && x.kind === 'drink') drink = x;
    if (x && x.kind === 'coaster') coaster = x;
    if (x && x.kind === 'charm') { charm = x; pet = x.pet ? shop.pet : null; }
    if (x && (x.kind === 'wood' || x.kind === 'felt' || x.kind === 'back')) {
      var m = current && current.meta || DEFAULT, l = { wood: m.wood || DEFAULT.wood, felt: m.felt || DEFAULT.felt, back: m.back || DEFAULT.back };
      l[x.kind] = x.id;
      return '<div class="ks-try ks-try-table ks-wood-' + l.wood + ' ks-felt-' + l.felt + ' ks-back-' + l.back + '"><i class="ks-pv-rim"></i><i class="ks-pv-felt"></i>' +
        '<span class="ks-try-cards"><span class="bj-card back"></span><span class="bj-card red"><span class="r">A<br>♥</span><span class="s">♥</span></span><span class="bj-card back"></span></span></div>';
    }
    var wood = current && current.meta ? current.meta.wood || DEFAULT.wood : DEFAULT.wood, felt = current && current.meta ? current.meta.felt || DEFAULT.felt : DEFAULT.felt;
    return '<div class="ks-try ks-wood-' + wood + ' ks-felt-' + felt + '"><i class="ks-try-rim"></i><i class="ks-try-felt"></i>' +
      '<span class="ks-try-me"><span class="ks-face">' + avatarHtml(d.avatar, me && me.name) + '</span><span class="ks-plate"><b>' + esc(me ? me.name : '') + '</b><small>' + euro(kasse ? kasse.balance : 0) + '</small></span></span>' +
      '<span class="ks-try-drink">' + drinkHtml(drink, coaster) + '</span><span class="ks-try-charm">' + charmHtml(charm, pet) + '</span></div>';
  }
  function tryInfo(sel) {
    var x = sel && item(sel), k = shop.kasse;
    if (!x) return '<b>Dein Platz</b><small>So sehen dich die anderen am Tisch. Klick auf ein Teil, um es anzuprobieren.</small>' +
      '<small>' + (k.atTable ? 'Dein Geld liegt am Tisch „' + esc(k.atTable) + '“, bezahlt wird dort mit deinen Chips.' : 'Bezahlt wird mit Spielgeld aus der Kasse.') + ' Gekauftes behältst du; es zählt nicht als Verlust.</small>';
    var on = placed(x.kind) === x.id, look = x.kind === 'wood' || x.kind === 'felt' || x.kind === 'back';
    var what = x.kind === 'drink' ? 'Steht rechts neben deinem Platz auf dem Holz. Klick am Tisch auf dein Glas, um anzustoßen.'
      : x.kind === 'coaster' ? 'Liegt unter deinem Getränk.'
        : x.pet ? 'Hier sitzt dein Pixelpfoten-Tier mit am Tisch, und alle können es streicheln.' + (shop.pet ? '' : ' Hol dir erst ein Tier bei Pixelpfoten.')
          : x.kind === 'charm' ? 'Liegt links neben deinem Platz auf dem Holz.' : 'Für deine eigenen Spieltische, wählbar unter 🎨 Gestalten.';
    var btns = !x.owned ? '<button type="button" class="def" data-shop="buy" data-item="' + x.id + '"' + (x.price > k.balance && !k.atTable ? ' disabled title="Dafür reicht dein Geld nicht"' : '') + '>Kaufen</button><button type="button" data-shop="cancel">Abbrechen</button>'
      : look ? '<small>✔ Gehört dir.</small>' + (current && current.meta && isHost() ? '<button type="button" data-ks="design">🎨 Gestalten</button>' : '')
        : on ? '<button type="button" data-shop="equip" data-item="" data-kind="' + x.kind + '">Wegräumen</button>' : '<button type="button" class="def" data-shop="equip" data-item="' + x.id + '">Hinstellen</button>';
    return '<b>' + esc(x.title) + (x.rarity ? ' <span class="ks-rar">' + stars(x.rarity) + ' ' + (x.rarity === 2 ? 'legendär' : 'selten') + '</span>' : '') + '</b>' +
      '<span>' + priceHtml(x) + (x.was ? ' <span class="ks-deal">Angebot der Woche</span>' : '') + '</span><small>' + what + '</small><div class="actions">' + btns + '</div>';
  }
  function roundLabel() {
    var x = item(roundItem), n = current && current.side ? current.side.players.length : 0;
    return x ? '🍻 ' + n + ' × ' + euro(x.price) + ' = ' + euro(n * x.price) : '🍻 Runde schmeißen';
  }
  function roundBox() {
    var drinks = shop.items.filter(function (x) { return x.kind === 'drink' && x.price; });
    var n = current && current.side ? current.side.players.length : 0, ok = seated() && n >= 2;
    if (!item(roundItem) || !item(roundItem).price) roundItem = 'bier';
    return '<fieldset class="groupbox ks-roundbox"><legend>Für alle am Tisch</legend><span class="ks-round-ic" aria-hidden="true">🍻</span><div><b>Runde schmeißen</b>' +
      '<small>Jeder am Tisch bekommt das Getränk hingestellt, solange der Tisch offen ist, und dein Name steht im Verlauf.</small>' +
      (ok ? '<div class="actions"><select id="ks-round-item" aria-label="Getränk für die Runde">' + drinks.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === roundItem ? ' selected' : '') + '>' + x.icon + ' ' + esc(x.title) + '</option>';
      }).join('') + '</select><button type="button" data-shop="round" id="ks-round-btn">' + roundLabel() + '</button></div>'
        : '<small><i>Geht, sobald du mit anderen an einem Spieltisch sitzt.</i></small>') + '</div></fieldset>';
  }
  function paintRound() {
    var s = document.getElementById('ks-round-item'), b = document.getElementById('ks-round-btn');
    if (!s || !b) return;
    roundItem = s.value;
    b.textContent = roundLabel();
  }
  function mineHtml() {
    var mineItems = shop.items.filter(function (x) { return x.owned && x.price; });
    var at = ['drink', 'coaster', 'charm'].map(function (k) {
      var x = item(placed(k));
      return '<tr><td>' + KIND_NAMES[k].replace(' und Snacks', '') + '</td><td>' + (x ? (x.kind === 'coaster' ? '' : x.icon + ' ') + esc(x.title) : '<i>nichts</i>') + '</td><td class="num">' +
        (x ? '<button type="button" class="small" data-shop="equip" data-item="" data-kind="' + k + '">Wegräumen</button>' : '') + '</td></tr>';
    }).join('');
    var place = mineItems.filter(function (x) { return x.kind === 'drink' || x.kind === 'coaster' || x.kind === 'charm'; });
    var looks = mineItems.filter(function (x) { return x.kind === 'wood' || x.kind === 'felt' || x.kind === 'back'; });
    return '<fieldset class="groupbox"><legend>An deinem Platz</legend><table class="kv">' + at + '</table></fieldset>' +
      '<fieldset class="groupbox"><legend>Im Schrank</legend>' + (place.length ? icons(place) : '<small>Noch nichts gekauft. Kaffee steht für alle bereit.</small>') + '</fieldset>' +
      (looks.length ? '<fieldset class="groupbox"><legend>Für deine Tische</legend>' + icons(looks) + '<small>Wählbar unter 🎨 Gestalten, wenn du Gastgeber bist.</small></fieldset>' : '');
  }
  function shopHtml() {
    if (!shop) return '<p class="bj-empty">Lädt …</p>';
    var tab = SHOP_TABS.filter(function (t) { return t[0] === shopTab; })[0] || SHOP_TABS[0];
    var h = '<div class="tabs" role="tablist">' + SHOP_TABS.map(function (t) { return '<button type="button" role="tab" data-shoptab="' + t[0] + '" aria-selected="' + (t[0] === tab[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="tab-page ks-shoppage"><div class="ks-trybox">' + tryOn(shopSel) + '<div class="ks-tryinfo">' + tryInfo(shopSel) + '</div></div>';
    if (tab[0] === 'mine') h += mineHtml();
    else {
      h += tab[2].map(function (k) {
        var list = shop.items.filter(function (x) { return x.kind === k; });
        return (tab[2].length > 1 ? '<h4>' + KIND_NAMES[k] + '</h4>' : '') + icons(list);
      }).join('');
      if (tab[0] === 'bar') h += roundBox();
    }
    var deal = item(shop.offer);
    return h + (deal ? '<p class="ks-dealline"><small>Angebot der Woche: <b>' + esc(deal.title) + '</b> für ' + euro(deal.price) + ' statt ' + euro(deal.was) + '.</small></p>' : '') + '</div>';
  }
  function paintShop() {
    if (view === 'shop' && !current) main.innerHTML = '<div class="bj-pad ks-shopwin"><h2>🛒 Shop</h2>' + shopHtml() + '</div>';
    if (current && pane.mode === 'shop') renderPane();
  }
  function shopAct(a, id, kind) {
    var body = { action: a, item: id || '', kind: kind || '' };
    req('POST', '/kartenspiele/shop', body).then(function (j) {
      Sound.play(a === 'buy' ? 'ding' : 'klick');
      if (a === 'buy' && item(id) && (item(id).kind === 'wood' || item(id).kind === 'felt' || item(id).kind === 'back')) shopSel = id;
      else if (a !== 'round') shopSel = null;
      gotShop(j);
      var msg = a === 'buy' ? 'Gekauft.' : a === 'round' ? 'Runde geschmissen.' : id ? 'Steht an deinem Platz.' : 'Weggeräumt.';
      if (current) statusAtTable(msg); else status(msg);
    }).catch(oops);
  }
  // Klicks im Shop (im Fenster oder im Seitenfach); true = erledigt
  function shopClick(b) {
    if (b.dataset.shoptab) { shopTab = b.dataset.shoptab; shopSel = null; paintShop(); return true; }
    if (b.dataset.item !== undefined && !b.dataset.shop) { shopSel = shopSel === b.dataset.item ? null : b.dataset.item; paintShop(); return true; }
    var a = b.dataset.shop;
    if (!a) return false;
    if (a === 'cancel') { shopSel = null; paintShop(); }
    else if (a === 'round') shopAct('round', roundItem);
    else shopAct(a, b.dataset.item, b.dataset.kind);
    return true;
  }

  // ---------- Am Spieltisch ----------
  function enter(id, sit) {
    return req('GET', '/kartenspiele/tisch/' + encodeURIComponent(id)).then(function (meta) { mount(meta.game, meta, sit); })
      .catch(function (e) { show('tische'); oops(e); });
  }
  var pane = { mode: '', tab: remember('ks-tab') || 'tisch' };
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 760px)') : { matches: false };
  // Das Spiel im Fenster aufbauen: mit Spieltisch (meta) oder ohne, dann nur Statistik und Regeln (viewName)
  function mount(id, meta, sit, viewName) {
    unmount();
    var g = game(id), l = look(id), p = l[0];
    var nav = '<a href="#tische" data-view="tische">🂡 Spieltische</a>' + '<a href="#tisch" data-view="tisch" hidden>🟩 Am Tisch</a>' +
      (id === 'lobby' ? '' : '<a href="#statistik" data-view="statistik">📊 ' + esc(g.title) + '-Statistik</a>') + '<a href="#regeln" data-view="regeln">📜 Regeln</a>';
    gameEl.innerHTML = '<div class="' + l[1] + (meta ? ' ks-room' : '') + '" id="' + p + '" data-csrf="' + esc(CSRF) + '" data-user="' + ME + '" data-game="' + id + '" data-title="' + esc(g.title) + '" data-icon="' + g.icon + '" data-seats="' + g.min + '-' + g.max + '">' +
      '<nav class="menubar bj-nav" role="tablist">' + nav + '<span class="spacer"></span><span class="bj-me" id="' + p + '-me"></span></nav>' +
      (meta ? '<div class="ks-tbar" id="ks-bar" role="toolbar"></div>' : '') +
      '<div class="ks-body"><div class="bj-main" id="' + p + '-main"></div>' +
      (meta ? '<aside class="ks-pane" id="ks-pane" hidden><button type="button" class="ks-pane-x" data-ks="close" title="Fach schließen" aria-label="Fach schließen">×</button><div class="ks-pane-in" id="ks-pane-in"></div></aside>' +
        '<div class="ks-fx" id="ks-fx" aria-hidden="true"></div>' : '') + '</div>' +
      '<div class="statusbar"><span id="' + p + '-status"' + (meta ? ' class="ks-last" title="Klick zeigt den ganzen Verlauf"' : '') + '>' + g.icon + ' ' + esc(g.title) + '</span></div></div>' +
      '<dialog class="window mp-dlg" id="' + p + '-dlg"><div class="titlebar"><span class="ttl" id="' + p + '-dlg-title"></span></div><form method="dialog" class="body"><div id="' + p + '-dlg-body"></div><div class="actions" id="' + p + '-dlg-actions"></div></form></dialog>';
    root.hidden = true;
    gameEl.hidden = false;
    current = { id: id, meta: meta, el: gameEl.firstElementChild, destroy: null, side: null, info: '', faces: '', lastLog: '' };
    if (meta) {
      pane.mode = !narrow.matches && remember('ks-pane') === 'more' ? 'more' : '';
      design(meta); watch(); renderPane();
      url('/kartenspiele?tisch=' + encodeURIComponent(meta.id));
      if (!shop) loadShop();
    }
    var K = {
      table: meta ? meta.id : null, sit: !!sit, view: viewName, url: '/kartenspiele/tisch/',
      lobby: function () { show('tische'); },
      closed: function (msg) { show('tische'); status(msg); },
      switched: function () { enter(meta.id, false); },
      salon: function (m) { if (current && current.meta && current.meta.id === m.id) design(m); },
      link: function () { return location.origin + '/kartenspiele?tisch=' + encodeURIComponent(meta.id); },
      plaque: plaque, free: freeSeat, info: info, side: side, fx: fx,
    };
    var start = window.KartenSpiele && window.KartenSpiele[id];
    if (!start) { show('tische'); status('Dieses Spiel lässt sich gerade nicht laden.'); return; }
    current.destroy = start(current.el, K);
  }
  function unmount() {
    if (!current) return;
    unwatch();
    closeEmotes();
    if (current.destroy) current.destroy();
    current = null;
    gameEl.innerHTML = '';
    gameEl.hidden = true;
  }
  function deco() { return (current && current.meta && current.meta.deco) || {}; }
  function isHost() { return !!current && !!current.meta && (current.meta.hostId === ME || !!(me && me.admin)); }
  function seated() { return !!current && !!current.side && current.side.players.some(function (x) { return x.p.id === ME; }); }

  // Werkzeugleiste über dem Tisch: zurück zur Liste, Name, Spielwahl (Gastgeber), Infos des Spiels, Gesichter, rechts die Knöpfe
  function design(m) {
    current.meta = m;
    var el = current.el, g = game(m.game), host = isHost();
    ['felt', 'back', 'wood'].forEach(function (kind) {
      LOOKS[kind].forEach(function (x) { el.classList.toggle('ks-' + kind + '-' + x.id, x.id === (m[kind] || DEFAULT[kind])); });
    });
    el.classList.add('ks-tisch');
    $('ks-bar').innerHTML = '<button type="button" class="ks-tb" data-ks="back" title="Zur Tischliste; dein Platz bleibt frei für dich">◀ <span>Tische</span></button><span class="ks-tsep"></span>' +
      '<b class="ks-tname" title="' + esc(m.name) + '">' + (m.hidden ? '🔒 ' : '') + esc(m.name) + '</b>' +
      (host ? '<select id="ks-pick" title="Gewechselt wird zwischen zwei Runden; alle bleiben sitzen.">' + GAMES.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === m.game ? ' selected' : '') + '>' + x.icon + ' ' + esc(x.id === 'lobby' ? 'Kein Spiel (Lobby)' : x.title) + '</option>';
      }).join('') + '</select>' : '<span class="ks-gname" title="👑 ' + esc(m.host) + ' wählt das Spiel">' + g.icon + ' ' + esc(m.game === 'lobby' ? 'Noch kein Spiel' : g.title) + '</span>') +
      '<span class="ks-info" id="ks-info">' + current.info + '</span><span class="ks-faces" id="ks-faces">' + current.faces + '</span><span class="spacer"></span>' +
      '<button type="button" class="ks-tb" data-ks="shop" title="Getränke, Glücksbringer und mehr; du bleibst sitzen">🛒 <span>Shop</span></button>' +
      (host ? '<button type="button" class="ks-tb" data-ks="design" title="Name, Holz, Filz und Kartenrücken">🎨 <span>Gestalten</span></button>' : '') +
      '<button type="button" class="ks-tb" data-act="link" title="Link zu diesem Tisch">🔗 <span>Einladen</span></button><span class="ks-tsep"></span>' +
      '<button type="button" class="ks-tb" data-ks="pane" title="Wer am Tisch sitzt, Verlauf und deine Zahlen">☰ <span>Mehr</span></button>';
    pressed();
    decorate(true);
    if (pane.mode === 'more') renderPane();
  }
  function pressed() {
    var bar = $('ks-bar');
    if (!bar) return;
    bar.querySelectorAll('[data-ks=shop], [data-ks=pane]').forEach(function (b) {
      var on = b.dataset.ks === 'shop' ? pane.mode === 'shop' : pane.mode === 'more';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
  }
  gameEl.addEventListener('change', function (e) {
    if (e.target.id === 'ks-round-item') { paintRound(); return; }
    if (e.target.id !== 'ks-pick' || !current || !current.meta) return;
    switchGame(e.target.value);
  });
  function switchGame(to) {
    var m = current.meta;
    req('POST', '/kartenspiele/tisch/' + encodeURIComponent(m.id), { action: 'game', game: to }).catch(function (err) {
      if ($('ks-pick')) $('ks-pick').value = m.game;
      oopsAtTable(err);
    });
  }
  gameEl.addEventListener('click', function (e) {
    if (!current || !current.meta) return;
    var t = e.target;
    if (t.closest('.ks-last')) { openPane('more', 'verlauf'); return; }
    var glass = t.closest('.ks-drink[data-uid]'), pet = t.closest('.ks-pet[data-uid]');
    if (glass && Number(glass.dataset.uid) === ME) { tableAct({ action: 'cheers' }); return; }
    if (pet) { tableAct({ action: 'pet', uid: Number(pet.dataset.uid) }); return; }
    var pick = t.closest('[data-pick]');
    if (pick) { switchGame(pick.dataset.pick); return; }
    var emo = t.closest('[data-emote]');
    if (emo) { closeEmotes(); tableAct({ action: 'emote', emoji: emo.dataset.emote }); return; }
    var b = t.closest('button');
    if (!b) return;
    if (b.dataset.ptab) { pane.tab = b.dataset.ptab; remember('ks-tab', pane.tab); renderPane(); return; }
    if (shopClick(b)) return;
    var k = b.dataset.ks;
    if (!k) return;
    if (k === 'back') show('tische');
    else if (k === 'shop') openPane(pane.mode === 'shop' ? '' : 'shop');
    else if (k === 'pane') openPane(pane.mode === 'more' ? '' : 'more');
    else if (k === 'close') openPane('');
    else if (k === 'mine') { shopTab = 'mine'; shopSel = null; openPane('shop'); }
    else if (k === 'emote') toggleEmotes(b);
    else if (k === 'rules' || k === 'stats') { var a = current.el.querySelector('.bj-nav [data-view=' + (k === 'rules' ? 'regeln' : 'statistik') + ']'); if (a) a.click(); }
    else if (k === 'design') designTable();
  });
  function designTable() {
    var m = current.meta;
    dialog('🎨 Tisch gestalten', designForm(m), [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      req('POST', '/kartenspiele/tisch/' + encodeURIComponent(m.id), { action: 'design', name: field('name'), felt: field('felt'), back: field('back'), wood: field('wood'), hidden: field('hidden') }).catch(oopsAtTable);
    });
  }
  function tableAct(body) {
    if (!current || !current.meta) return;
    req('POST', '/kartenspiele/tisch/' + encodeURIComponent(current.meta.id), body).catch(oopsAtTable);
  }
  // Fehler und Meldungen am Tisch landen in der Statusleiste des Spiels
  function statusAtTable(text) {
    var el = current && current.el.querySelector('.statusbar span');
    if (el) el.textContent = text;
  }
  function oopsAtTable(err) { statusAtTable('⚠ ' + err.message); Sound.play('fehler'); }

  // ---------- Was die Spiele hereinreichen ----------
  // Platz-Plakette: Bild im grauen Rahmen mit Abzeichen (👑, D, BB, aus …), darunter das Namensschild mit Chips oder Karten.
  // Wer dran ist, bekommt ein blaues Schild und darunter die Bedenkzeit als Fortschrittsbalken.
  // o: { p (Platz mit id, user, name, away, leaving), host, turn, left (ms), total (ms), tags: [], line, note }
  function plaque(o) {
    var p = o.p, d = deco()[p.id] || {};
    var tags = (o.tags || []).filter(Boolean).map(function (t) { return '<i class="ks-tag">' + esc(t) + '</i>'; }).join('');
    var prog = '';
    if (o.turn && o.total > 0) {
      var left = Math.max(0, Math.min(o.total, o.left || 0));
      prog = '<span class="ks-prog" title="Noch ' + Math.ceil(left / 1000) + ' s"><i style="--p:' + (left / o.total * 100).toFixed(1) + '%;animation-duration:' + Math.round(left) + 'ms"></i></span>';
    }
    return '<div class="ks-plaque"><span class="ks-face" data-uid="' + p.id + '">' + avatarHtml(d.avatar, p.name) + (o.host ? '<i class="ks-crown" title="Gastgeber">👑</i>' : '') +
      (tags ? '<span class="ks-tags">' + tags + '</span>' : '') + '</span>' +
      '<button type="button" class="bj-name ks-plate" data-user="' + esc(p.user) + '" data-uid="' + p.id + '"><b>' + esc(p.name) + (p.away ? ' 💤' : '') + (p.leaving ? ' 🚪' : '') + '</b>' +
      (o.line ? '<small>' + o.line + '</small>' : '') + '</button>' + prog + (o.note ? '<span class="ks-note">' + o.note + '</span>' : '') + '</div>';
  }
  // Freier Platz: ein Klick setzt dich hin (wer schon sitzt, sieht nur, dass er frei ist)
  function freeSeat(i, canSit) {
    return canSit ? '<button type="button" class="ks-free" data-sit="' + i + '"><span aria-hidden="true">🪑</span>Platz frei</button>' : '<span class="ks-free off">Platz frei</span>';
  }
  // Infos des Spiels (Blinds, Runde …) in der Werkzeugleiste
  function info(html) {
    if (!current || !current.meta || html === current.info) return;
    current.info = html;
    var el = $('ks-info');
    if (el) el.innerHTML = html;
  }
  // Seitenfach und alles, was davon in Werkzeug- und Statusleiste steht.
  // o: { players: [{ p, sub, cells: [] }], cols: [], viewers: [], hostId, info, acts, me, log: [], playing }
  function side(o) {
    if (!current || !current.meta) return;
    current.side = o;
    var d = deco(), faces = o.players.map(function (x) {
      var p = x.p, a = d[p.id] || {};
      return '<button type="button" class="ks-mface" data-user="' + esc(p.user) + '" data-uid="' + p.id + '" title="' + esc(p.name) + (o.hostId === p.id ? ' (Gastgeber)' : '') + '">' + avatarHtml(a.avatar, p.name) + '</button>';
    }).join('') + (o.viewers.length ? '<span class="ks-watchers" title="Sehen zu: ' + esc(names(o.viewers.map(function (v) { return v.name; }))) + '">+' + o.viewers.length + ' 👁</span>' : '');
    if (faces !== current.faces) { current.faces = faces; var f = $('ks-faces'); if (f) f.innerHTML = faces; }
    // Das letzte Ereignis steht in der Statusleiste; auf dem Tisch läuft kein Text mit
    if (o.log[0] && o.log[0] !== current.lastLog) { current.lastLog = o.log[0]; statusAtTable('📜 ' + o.log[0]); }
    current.el.classList.toggle('ks-idle', !o.playing);
    if (pane.mode === 'more') renderPane();
    if (pane.mode === 'shop' && shopTab === 'bar') paintRound();
    decorate();
  }

  // ---------- Seitenfach: Am Tisch, Verlauf, Ich oder der Shop ----------
  function openPane(mode, tab) {
    pane.mode = mode;
    if (tab) { pane.tab = tab; remember('ks-tab', tab); }
    if (mode !== 'shop') remember('ks-pane', mode);
    if (mode === 'shop' && !shop) loadShop();
    renderPane();
  }
  function renderPane() {
    var el = $('ks-pane');
    if (!el || !current) return;
    el.hidden = !pane.mode;
    el.classList.toggle('shop', pane.mode === 'shop');
    current.el.classList.toggle('ks-paned', !!pane.mode);
    pressed();
    if (pane.mode) $('ks-pane-in').innerHTML = pane.mode === 'shop' ? shopHtml() : moreHtml();
  }
  function moreHtml() {
    var o = current.side, m = current.meta;
    var TABS = [['tisch', '👥 Am Tisch'], ['verlauf', '📜 Verlauf'], ['ich', '🙂 Ich']];
    var h = '<div class="tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-ptab="' + t[0] + '" aria-selected="' + (pane.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div><div class="tab-page ks-page">';
    if (!o) return h + '<p class="bj-empty">Lädt …</p></div>';
    if (pane.tab === 'verlauf') h += '<div class="sunken bj-log">' + o.log.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
    else if (pane.tab === 'ich') {
      h += (o.me || '<p>Du siehst gerade zu. Klick am Tisch auf „🪑 Platz frei“, um mitzuspielen.</p>') +
        (kasse ? '<fieldset class="groupbox"><legend>Kasse</legend><table class="kv"><tr><td>Kontostand</td><td class="num">' + euro(kasse.balance) + '</td></tr><tr><td>Bilanz</td><td class="num ' + cls(kasse.net) + '">' + euro(kasse.net, true) + '</td></tr></table></fieldset>' : '') +
        '<div class="actions"><button type="button" data-ks="mine">🎒 Meine Sachen</button><button type="button" data-ks="stats">📊 Statistik</button></div>';
    } else {
      var d = deco();
      h += '<table class="list ks-people"><thead><tr><th>Spieler</th>' + o.cols.map(function (c) { return '<th class="num">' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (o.players.length ? o.players.map(function (x) {
          var p = x.p, a = d[p.id] || {};
          return '<tr' + (p.id === ME ? ' class="sel"' : '') + '><td><button type="button" class="bj-link ks-pname" data-user="' + esc(p.user) + '" data-uid="' + p.id + '">' + avatarHtml(a.avatar, p.name) +
            '<span>' + (o.hostId === p.id ? '👑 ' : '') + esc(p.name) + (p.id === ME ? ' (du)' : '') + '</span></button>' + (x.sub ? '<small>' + x.sub + '</small>' : '') + '</td>' +
            x.cells.map(function (c) { return '<td class="num">' + c + '</td>'; }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="' + (o.cols.length + 1) + '"><i>Noch sitzt niemand.</i></td></tr>') + '</tbody></table>' +
        (o.viewers.length ? '<fieldset class="groupbox"><legend>Zuschauer (' + o.viewers.length + ')</legend>👁 ' + o.viewers.map(function (v) {
          return '<button type="button" class="bj-link" data-user="' + esc(v.user) + '" data-uid="' + v.id + '">' + esc(v.name) + '</button>';
        }).join(', ') + '</fieldset>' : '') +
        '<fieldset class="groupbox"><legend>Tisch</legend>' + (o.info ? '<div>' + o.info + '</div>' : '') + '<div>' + (m.hidden ? '🔒 Nur mit Link' : 'Sichtbar für alle') +
        (isHost() ? ' · <button type="button" class="bj-link" data-act="settings">Einstellungen …</button> · <button type="button" class="bj-link" data-act="close">Tisch schließen</button>' : '') +
        ' · <button type="button" class="bj-link" data-ks="rules">Regeln</button></div></fieldset>';
    }
    return h + '</div><div class="ks-pane-foot"><button type="button" data-act="link">🔗 Einladen</button>' + (o.acts || '') +
      (seated() ? '' : '<button type="button" data-act="leave-view">🚪 Weggehen</button>') + '</div>';
  }

  // ---------- Der Tisch: Holzrand mit Verzierungen, Getränk und Glücksbringer direkt auf dem Holz ----------
  // Die Spiele zeichnen ihren Filz (.bj-felt) selbst neu; Rand und Filz kommen per CSS (.ks-tisch, ::before/::after),
  // Verzierungen und Dinge am Platz liegen in einer Ebene (.ks-layer), die hier nach jedem Neuzeichnen wieder eingesetzt wird.
  // Rechts vom Platz (vom Spieler aus gesehen) steht das Getränk auf dem Untersetzer, links der Glücksbringer oder das Tier.
  function drinkHtml(drink, coaster, uid) {
    if (!drink) return '';
    var t = drink.title + (drink.from ? ' · Runde von ' + drink.from : '') + (uid === ME ? ' · Klick zum Anstoßen' : '');
    return '<span class="ks-drink' + (uid === ME ? ' mine' : '') + '"' + (uid ? ' data-uid="' + uid + '"' : '') + ' title="' + esc(t) + '">' +
      (coaster ? '<i class="ks-coaster ks-co-' + esc(coaster.id) + '"></i>' : '') + '<span>' + drink.icon + '</span></span>';
  }
  function charmHtml(charm, pet, uid) {
    if (!charm) return '';
    var at = uid ? ' data-uid="' + uid + '"' : '';
    if (charm.pet) {
      return '<span class="ks-pet ks-base-' + esc(charm.id) + '"' + at + ' title="' + esc(pet ? pet.name + ' · Klick zum Streicheln' : 'Leer: Hol dir ein Tier bei Pixelpfoten') + '">' +
        '<i class="ks-base"></i>' + (pet ? pet.svg : '') + '</span>';
    }
    return '<span class="ks-charm" title="' + esc(charm.title) + '">' + charm.icon + '</span>';
  }
  var ORN_SIDE = '<svg viewBox="0 0 64 26"><path d="M32 4 L38 13 L32 22 L26 13 Z"/><circle class="dot" cx="32" cy="13" r="2"/>' +
    '<path d="M25 13 C 18 13, 16 5, 10 7 C 5 9, 6 16, 11 15 C 14 14, 13 11, 11 11"/><path d="M39 13 C 46 13, 48 5, 54 7 C 59 9, 58 16, 53 15 C 50 14, 51 11, 53 11"/>' +
    '<path d="M25 13 C 20 14, 18 20, 13 20"/><path d="M39 13 C 44 14, 46 20, 51 20"/></svg>';
  var ORN_CORNER = '<svg viewBox="0 0 64 26"><path d="M8 18 C 20 18, 22 6, 32 6 C 42 6, 44 18, 56 18"/><circle class="dot" cx="32" cy="6" r="2.2"/><circle class="dot" cx="8" cy="18" r="1.6"/><circle class="dot" cx="56" cy="18" r="1.6"/></svg>';
  var observer = null, sizer = null, pending = 0;
  function decorate(now) {
    if (!now) { if (!pending) pending = requestAnimationFrame(function () { pending = 0; decorate(true); }); return; }
    if (!current || !current.meta) return;
    var el = current.el, felt = el.querySelector('.bj-felt');
    // Am Tisch nur die Werkzeugleiste, bei Regeln und Statistik die Menüleiste
    el.classList.toggle('ks-am-tisch', !!felt || !!el.querySelector('.bj-nav [data-view=tisch].active'));
    var dock = el.querySelector('.ks-dock');
    if (dock) {
      var x = dock.querySelector(':scope > .ks-dock-x');
      if (seated() && !x) dock.insertAdjacentHTML('beforeend', '<span class="ks-dock-x"><span class="ks-tsep"></span><button type="button" data-ks="emote" title="Reaktion schicken" aria-haspopup="menu">😀 ▾</button></span>');
      else if (!seated() && x) x.remove();
    }
    // Bilder an den Plaketten auffrischen, wenn jemand ein neues hat
    var d = deco();
    el.querySelectorAll('.ks-face[data-uid]').forEach(function (f) {
      var a = d[f.dataset.uid], img = f.querySelector('.ks-ava'), src = a && a.avatar;
      if (img && src && img.getAttribute('src') !== src) img.outerHTML = avatarHtml(src, '');
    });
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
      felt.insertBefore(layer, felt.firstChild);
    }
    // Mittellinie des Holzes als abgerundetes Rechteck: Abstand eines Punktes (negativ = innen)
    var cx = W / 2, cy = H / 2, hw = bw / 2 - rim / 2, hh = bh / 2 - rim / 2, rr = r - rim / 2;
    function sdf(px, py) {
      var qx = Math.abs(px - cx) - (hw - rr), qy = Math.abs(py - cy) - (hh - rr);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    }
    // Punkt auf dem Holz in Richtung (x, y), gesehen vom Punkt (ox, oy) innen
    function onRim(ox, oy, px, py) {
      var dx = px - ox, dy = py - oy, len = Math.hypot(dx, dy) || 1, lo = 0, hi = W + H;
      dx /= len; dy /= len;
      if (dx === 0 && dy === 0) dy = 1;
      for (var k = 0; k < 30; k++) { var mid = (lo + hi) / 2; if (sdf(ox + dx * mid, oy + dy * mid) < 0) lo = mid; else hi = mid; }
      return { x: ox + dx * lo, y: oy + dy * lo, dx: dx, dy: dy };
    }
    var html = '';
    // Verzierungen: Ranken mitten auf den Seiten, Bögen in den Ecken
    var sides = [[cx, iy + rim / 2, 0], [cx, H - iy - rim / 2, 180], [ix + rim / 2, cy, -90], [W - ix - rim / 2, cy, 90]];
    sides.forEach(function (o) { html += '<span class="ks-orn" style="left:' + o[0] + 'px;top:' + o[1] + 'px;transform:translate(-50%,-50%) rotate(' + o[2] + 'deg)">' + ORN_SIDE + '</span>'; });
    var cd = rr * (1 - Math.SQRT1_2);
    [[-1, -1, -45], [1, -1, 45], [1, 1, 135], [-1, 1, -135]].forEach(function (c) {
      html += '<span class="ks-orn corner" style="left:' + (cx + c[0] * (hw - cd)) + 'px;top:' + (cy + c[1] * (hh - cd)) + 'px;transform:translate(-50%,-50%) rotate(' + c[2] + 'deg)">' + ORN_CORNER + '</span>';
    });
    // Dinge am Platz: auf dem Holz hinter jedem besetzten Platz, nach beiden Seiten. Beim Blackjack sitzt der Geber oben
    // und die Plätze stehen im Bogen um ihn herum: hinter dem Platz heißt dort vom Geber aus gesehen.
    var fr = felt.getBoundingClientRect(), oy = current.id === 'blackjack' ? H * 0.15 : cy;
    function at(px, py) { return onRim(cx, oy, px, py); }
    felt.querySelectorAll('.ks-face[data-uid]').forEach(function (face) {
      var uid = Number(face.dataset.uid), a = d[uid];
      if (!a) return;
      var plate = face.parentNode, sr = plate.getBoundingClientRect(), px = sr.left - fr.left + sr.width / 2, py = sr.top - fr.top + sr.height / 2;
      var p = at(px, py), off = Math.max(sr.width / 2 + rim * 1.3, rim * 3.4);
      // Rechte Hand des Spielers: er schaut zur Mitte (−dx, −dy), rechts davon ist (dy, −dx) auf dem Bildschirm
      var right = at(p.x + p.dy * off, p.y - p.dx * off), left = at(p.x - p.dy * off, p.y + p.dx * off);
      if (a.drink) html += '<span class="ks-at" style="left:' + right.x.toFixed(1) + 'px;top:' + right.y.toFixed(1) + 'px">' + drinkHtml(a.drink, a.coaster, uid) + '</span>';
      if (a.charm) html += '<span class="ks-at" style="left:' + left.x.toFixed(1) + 'px;top:' + left.y.toFixed(1) + 'px">' + charmHtml(a.charm, a.pet, uid) + '</span>';
    });
    if (layer.innerHTML !== html) layer.innerHTML = html;
  }
  function watch() {
    unwatch();
    if (!window.MutationObserver) return;
    observer = new MutationObserver(function (list) {
      // Nur Änderungen der Spiele zählen, nicht die eigenen Ebenen
      for (var i = 0; i < list.length; i++) {
        var t = list[i].target;
        if (!t.closest || !t.closest('.ks-layer, .ks-fx, .ks-pane, .ks-tbar, .ks-emopop, .statusbar')) { decorate(); return; }
      }
    });
    observer.observe(current.el, { childList: true, subtree: true });
  }
  function unwatch() {
    if (observer) { observer.disconnect(); observer = null; }
    if (sizer) { sizer.disconnect(); sizer = null; }
  }

  // ---------- Leben am Tisch: Reaktionen, Anstoßen, Tier streicheln, Runde ----------
  // Der Server schickt „fx“ an alle offenen Fenster; angezeigt wird es über dem Tisch in .ks-fx, damit das Neuzeichnen
  // der Spiele es nicht wegwischt.
  function burst(cls, html, el, ms, dx) {
    var layer = $('ks-fx');
    if (!layer || !el) return;
    var lr = layer.getBoundingClientRect(), r = el.getBoundingClientRect();
    var s = document.createElement('span');
    s.className = cls;
    s.innerHTML = html;
    s.style.left = (r.left - lr.left + r.width / 2 + (dx || 0)) + 'px';
    s.style.top = (r.top - lr.top) + 'px';
    layer.appendChild(s);
    setTimeout(function () { s.remove(); }, ms);
  }
  function wiggle(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 900);
  }
  function fx(m) {
    if (!current || !current.meta) return;
    function find(sel) { return current.el.querySelector(sel + '[data-uid="' + Number(m.uid) + '"]'); }
    var face = find('.ks-face') || find('.ks-mface');
    if (m.kind === 'emote') burst('ks-float', esc(m.emoji), face, 2600);
    else if (m.kind === 'cheers') {
      var glass = find('.ks-drink') || face;
      burst('ks-balloon', '🍻 Prost!', glass, 3200);
      wiggle(glass, 'ks-clink');
      // Wer mit anstößt, bringt die Gläser zum Klingen
      if (m.join) Sound.play('prost');
    } else if (m.kind === 'pet') {
      var pet = find('.ks-pet');
      [-14, 0, 14].forEach(function (dx, i) { setTimeout(function () { burst('ks-heart', '❤️', pet, 1600, dx); }, i * 140); });
      wiggle(pet, 'ks-wiggle');
    } else if (m.kind === 'round') {
      burst('ks-balloon', '🍻 Eine Runde ' + esc(m.icon) + ' für alle!', face, 3600);
      Sound.play('prost');
    }
  }
  function toggleEmotes(btn) {
    if (closeEmotes()) return;
    var body = current.el.querySelector('.ks-body'), br = body.getBoundingClientRect(), r = btn.getBoundingClientRect();
    var p = document.createElement('div');
    p.className = 'ks-emopop';
    p.setAttribute('role', 'menu');
    p.innerHTML = EMOTES.map(function (e) { return '<button type="button" role="menuitem" data-emote="' + e + '">' + e + '</button>'; }).join('');
    body.appendChild(p);
    p.style.left = Math.max(4, Math.min(br.width - p.offsetWidth - 4, r.right - br.left - p.offsetWidth)) + 'px';
    p.style.top = Math.max(4, r.top - br.top - p.offsetHeight - 4) + 'px';
    var first = p.querySelector('button');
    if (first) first.focus();
  }
  function closeEmotes() {
    var p = document.querySelector('.ks-emopop');
    if (p) p.remove();
    return !!p;
  }
  document.addEventListener('click', function (e) { if (!e.target.closest('.ks-emopop, [data-ks=emote]')) closeEmotes(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeEmotes(); });

  // Treffpunkt ohne Spiel: läuft über den gemeinsamen Kartentisch (public/cardtable.js), gegeben wird dort nie
  window.CardTable({
    id: 'lobby',
    noStats: true,
    tableWord: 'Spieltisch',
    motto: 'SPIELTISCH',
    blurb: '',
    idle: function (s, ctx) {
      var host = s.seats.filter(function (x) { return x && x.id === s.hostId; })[0];
      return s.hostId === ME || (me && me.admin) ? 'Du bist Gastgeber: Such unten ein Spiel aus, sobald alle da sind. Unter 🎨 Gestalten stellst du Name, Holz und Filz ein.' : '👑 ' + ctx.esc(host ? host.name : s.host) + ' wählt gleich ein Spiel.';
    },
    center: function () { return ''; },
    // In der Leiste unten: der Gastgeber wählt das Spiel mit einem Klick, alle anderen können schon anstoßen
    bar: function (s) {
      var n = s.seats.filter(Boolean).length;
      if (s.hostId !== ME && !(me && me.admin)) return '<span>Bis es losgeht: Klick auf dein Glas, um anzustoßen.</span>';
      return '<div class="bj-row ks-picks"><span>Was spielen wir?</span>' + playable().map(function (g) {
        return '<button type="button" data-pick="' + g.id + '"' + (n > g.max ? ' disabled title="Höchstens ' + g.max + ' Spieler"' : '') + '>' + g.icon + ' ' + esc(g.title) + '</button>';
      }).join('') + '</div>';
    },
    rules: function () {
      return '<p>Am Spieltisch trefft ihr euch, bevor ihr ein Spiel anfangt. Der Gastgeber (👑) wählt oben in der Leiste das Spiel und kann es zwischen zwei Runden wechseln; wer sitzt, bleibt dabei auf seinem Platz.</p>' +
        '<ul>' + playable().map(function (g) { return '<li>' + g.icon + ' <b>' + esc(g.title) + '</b>: ' + (g.min === g.max ? g.min : g.min + ' bis ' + g.max) + ' Spieler' + (g.money ? ', mit Geld aus der Kasse' : '') + '</li>'; }).join('') + '</ul>' +
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
