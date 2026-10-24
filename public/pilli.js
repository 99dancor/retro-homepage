// Pilli Pilli (Startmenü → Spiele und Apps → Kartenspiele → 🌶️ Pilli Pilli): scharfer Tisch mit Chili-Karten. Jeder Platz
// zeigt Ansage gegen Stiche als Punkte und seine Pilis als Chili; in der Mitte liegt der Stich so, wie die Spieler sitzen,
// darunter Stapel, Stich-Zähler und der letzte Stich. Tischliste, Plätze, Seitenleiste und Statistik kommen aus public/cardtable.js, die Regeln aus
// src/pilli.js. Jede Karte trägt data-card (ihr Wert oder „joker“), der Rest des Stapels data-pile="deck" und die Mitte mit
// dem Stich data-pile="discard"; damit kann das Fenster Karten fliegen lassen.
(function () {
  'use strict';
  var DECK = 56;

  // Je höher die Zahl, desto schärfer: Farbe von Orange nach Dunkelrot, eine bis drei Chilis
  function heat(v) { return v > 37 ? 3 : v > 18 ? 2 : 1; }
  function card(c, extra, attrs, value) {
    if (c.j) {
      return '<span class="bj-card pp-card pp-joker' + (extra ? ' ' + extra : '') + '" title="Joker' + (value != null ? ' als ' + value : '') + '" data-card="joker"' + (attrs || '') + '>' +
        '<span class="pp-ix">J</span><span class="pp-num">' + (value != null ? value : '🃏') + '</span><span class="pp-lbl">Joker</span></span>';
    }
    var hue = Math.round(42 - (c.v - 1) / 54 * 42);
    return '<span class="bj-card pp-card pp-h' + heat(c.v) + (extra ? ' ' + extra : '') + '" title="' + c.v + '" data-card="' + c.v + '" style="--h:' + hue + '"' + (attrs || '') + '>' +
      '<span class="pp-ix">' + c.v + '</span><span class="pp-num">' + c.v + '</span><span class="pp-lbl">' + '🌶️'.repeat(heat(c.v)) + '</span></span>';
  }
  // Ansage gegen Stiche: ein Punkt pro angesagtem Stich, gefüllt, wenn er gemacht ist; Stiche über die Ansage hinaus rot
  function pips(p) {
    var bid = p.bid == null ? -1 : p.bid, n = Math.max(bid, p.tricks), h = '';
    for (var k = 0; k < n; k++) h += '<i class="' + (k < p.tricks ? (k < bid ? 'got' : 'over') : 'need') + '"></i>';
    var title = (p.bid == null ? 'Noch keine Ansage' : 'Ansage ' + p.bid) + ', ' + p.tricks + (p.tricks === 1 ? ' Stich' : ' Stiche');
    return '<span class="pp-score" title="' + title + '"><span class="pp-bid' + (p.bid == null ? ' open' : bid === p.tricks ? ' exact' : '') + '">' + (p.bid == null ? '?' : p.bid) + '</span>' +
      (n ? '<span class="pp-pips">' + h + '</span>' : '') + '</span>';
  }
  function chili(p, limit) { return '<span class="pp-chili' + (p.pilis >= limit - 2 ? ' hot' : '') + '" title="' + p.pilis + (p.pilis === 1 ? ' Pili' : ' Pilis') + ' von ' + limit + '">🌶️<b>' + p.pilis + '</b></span>'; }
  function backs(n, cls) {
    var h = '';
    for (var k = 0; k < Math.min(n, 6); k++) h += '<span class="bj-card back" style="--i:' + k + '"></span>';
    return '<span class="' + cls + '">' + h + '</span>';
  }

  // Sitzt der Platz ganz links oder rechts am Tisch? Dann rückt er auf dem Handy etwas zur Mitte (wie die Plätze in cardtable.js)
  function side(s, p, ctx) {
    var me = ctx.seat(), n = s.seatCount, x = Math.cos(Math.PI / 2 + ((p.i - (me ? me.i : 0) + n) % n) * 2 * Math.PI / n);
    return x < -.6 ? ' at-w' : x > .6 ? ' at-e' : '';
  }

  window.CardTable({
    id: 'pilli',
    tableWord: 'Pilli-Pilli-Tisch',
    motto: 'PILLI PILLI · 55 KARTEN + JOKER',
    blurb: 'Pilli Pilli (Pili Pili) in der Grundversion, 2 bis 8 Spieler, je 5 Karten, bis jemand 7 Pilis hat.',
    tags: function (s) { return s.pp ? '<span class="tag">Runde ' + s.pp.round + '</span><span class="tag">' + s.pp.bids + ' von ' + s.pp.hand + ' Stichen angesagt</span>' : '<span class="tag">5 Karten · bis 7 Pilis</span>'; },
    turnText: function (kind) { return kind === 'bid' ? 'sagt an' : ''; },
    seat: function (s, p, ctx) {
      var g = s.pp;
      return {
        hole: '<span class="pp-seatbox">' + (ctx.mine(p) || !p.cards ? '' : backs(p.cards, 'pp-backs')) + '<span class="pp-tally">' + pips(p) + chili(p, g ? g.limit : 7) + '</span></span>',
        line: 'Ansage ' + (p.bid == null ? '?' : p.bid) + ' · Stiche ' + p.tricks,
        badge: '',
        dealer: !!g && g.dealer === p.i,
        cls: 'pp-seat' + side(s, p, ctx) + (g && g.phase === 'trick' && g.last && g.last.winner === p.i ? ' pp-took' : ''),
      };
    },
    score: function (p) { return p.pilis + ' 🌶️'; },
    sideRows: function (s, seat) { return '<tr><td>Pilis</td><td class="num">' + seat.pilis + '</td></tr><tr><td>Ansage / Stiche</td><td class="num">' + (seat.bid == null ? '?' : seat.bid) + ' / ' + seat.tricks + '</td></tr>'; },
    center: function (s, ctx) {
      var g = s.pp;
      if (g.over) {
        return '<div class="pp-board"><div class="pp-board-head">🌶️ Runde ' + g.round + ' vorbei</div><table class="pp-sum"><tr><th></th><th>Ansage</th><th>Stiche</th><th>Pilis</th></tr>' + g.over.rows.map(function (r) {
          return '<tr' + (r.pen ? '' : ' class="exact"') + '><td>' + ctx.esc(r.name) + '</td><td class="num">' + r.bid + '</td><td class="num">' + r.tricks + '</td><td class="num">' + (r.pen ? '+' + r.pen + ' 🌶️' : '✓ genau') + ' → <b>' + r.pilis + '</b></td></tr>';
        }).join('') + '</table><div class="pp-next">' + (ctx.next ? ctx.next(s) : 'Gleich geht es weiter …') + '</div></div>';
      }
      var me = ctx.seat(), n = s.seatCount, shift = me ? me.i : 0;
      var players = s.seats.filter(function (p) { return p && p.inGame; });
      var done = players.reduce(function (m, p) { return m + p.tricks; }, 0);
      var rest = Math.max(0, DECK - g.hand * players.length);
      // Unter dem Stich: der Rest des Stapels und welcher Stich gerade läuft (beim Ansagen: wie viel schon angesagt ist)
      var hub = '<span class="pp-hub"><span class="pp-deck" data-pile="deck" title="' + rest + ' Karten bleiben im Stapel">' + backs(Math.max(1, Math.min(3, Math.ceil(rest / 12))), 'pp-backs') + '</span>' +
        (g.phase === 'bid' ? '<b>' + g.bids + '<small> / ' + g.hand + '</small></b><small>angesagt</small>' : '<b>' + Math.min(g.hand, g.phase === 'trick' ? done : done + 1) + '<small> / ' + g.hand + '</small></b><small>Stich</small>') + '</span>';
      var shown = g.phase === 'trick' && g.last ? g.last.cards : g.phase === 'play' ? g.trick : [];
      var win = g.phase === 'trick' && g.last ? g.last.winner : -1;
      // Jede Karte liegt vor dem Platz, von dem sie kam (wie die Plätze rund um den Tisch)
      var plays = shown.map(function (x) {
        var a = Math.PI / 2 + ((x.seat - shift + n) % n) * 2 * Math.PI / n;
        return '<span class="pp-play' + (x.seat === win ? ' win' : '') + '" style="left:' + (50 + 40 * Math.cos(a)).toFixed(1) + '%;top:' + (50 + 27 * Math.sin(a)).toFixed(1) + '%">' +
          card(x.card, '', '', x.card.j ? x.value : null) + '<small>' + ctx.esc(x.name) + '</small></span>';
      }).join('');
      var h = '<div class="pp-arena' + (g.phase === 'bid' ? ' bidding' : '') + '" data-pile="discard">' + plays + '</div>';
      var line;
      if (g.phase === 'bid') {
        var slots = '';
        for (var k = 0; k < g.hand; k++) slots += '<i' + (k < g.bids ? ' class="on"' : '') + '></i>';
        line = ctx.name(s, g.cur) + ' sagt an … <span class="pp-meter" title="' + g.bids + ' von ' + g.hand + ' Stichen angesagt">' + slots + '</span>' + (g.bids > g.hand ? ' <small>mehr als Stiche</small>' : '');
      } else if (g.phase === 'trick' && g.last) line = '🌶️ ' + ctx.name(s, g.last.winner) + ' gewinnt den Stich';
      else line = ctx.name(s, g.cur) + (g.trick.length ? ' ist dran …' : ' spielt aus …');
      h += '<div class="pp-foot">' + hub + '<div class="pk-pot pp-status' + (g.phase === 'trick' ? ' won' : '') + '">' + line + '</div></div>';
      if (g.last && g.phase !== 'trick') h += '<div class="pp-last"><small>Letzter Stich:</small> ' + g.last.cards.map(function (p) { return (p.card.j ? '🃏' : '') + p.value; }).join(' · ') + ' → ' + ctx.name(s, g.last.winner) + '</div>';
      return h;
    },
    bar: function (s, seat, ctx) {
      var g = s.pp, o = s.options || {};
      var hand = (s.hand || []).slice().sort(function (a, b) { return a.v - b.v; });
      var html = '<div class="dk-hand pp-hand">' + (hand.length ? hand.map(function (c) {
        var ok = o.play && o.play.indexOf(c.k) >= 0;
        return card(c, ok ? 'ok' : o.play && o.play.length ? 'dim' : '', ' data-k="' + c.k + '" role="button" tabindex="0"');
      }).join('') : '<span class="pp-none">Keine Karten mehr.</span>') + '</div><div class="bj-row">';
      if (g.over) html += '<span>Die Runde ist vorbei.</span>';
      else if (o.bid && o.bid.length) {
        html += '<span>Wie viele Stiche machst du?</span><span class="pp-bids">' + [0, 1, 2, 3, 4, 5].slice(0, g.hand + 1).map(function (n) {
          var ok = o.bid.indexOf(n) >= 0;
          return '<button type="button" class="pp-bidbtn" data-pact="bid" data-n="' + n + '"' + (ok ? '' : ' disabled title="Zusammen dürfen die Ansagen nicht genau ' + g.hand + ' ergeben"') + '><b>' + n + '</b></button>';
        }).join('') + '</span>' + (o.forbidden >= 0 ? '<small>(' + o.forbidden + ' geht nicht)</small>' : '');
      } else if (o.play && o.play.length) html += '<span>Du bist dran: leg eine Karte. Die höchste gewinnt.</span>';
      else html += '<span>' + (g.phase === 'bid' ? 'Die anderen sagen an …' : 'Warten …') + '</span>';
      return html + '</div>';
    },
    click: function (el, ctx) {
      var c = el.closest('[data-k]'), b = el.closest('[data-pact]');
      if (b) { if (!b.disabled) ctx.ctl('bid', { bid: Number(b.dataset.n) }); return true; }
      if (!c) return false;
      var st = ctx.state(), o = st.options || {}, k = Number(c.dataset.k);
      if (!o.play || o.play.indexOf(k) < 0) { ctx.status(st.pp.phase === 'bid' ? 'Erst wird angesagt.' : 'Du bist nicht dran.'); return true; }
      if (k !== 0) { ctx.ctl('play', { card: k }); return true; }
      // Joker: Wert wählen
      ctx.dialog('🃏 Joker', '<p>Wie viel zählt dein Joker in diesem Stich?</p><label>Wert (0 bis 56):<input type="number" name="value" class="w100" min="0" max="56" value="56"></label><p><small>56 schlägt jede Karte, 0 verliert gegen jede.</small></p>',
        [{ label: '<b>Legen</b>', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r === 'ok') ctx.ctl('play', { card: 0, value: Number(ctx.field('value')) });
      });
      return true;
    },
    keys: function (e) {
      var btn = /^[0-5]$/.test(e.key) && document.querySelector('.cg-pilli [data-pact=bid][data-n="' + e.key + '"]:not([disabled])');
      if (btn) { e.preventDefault(); btn.click(); }
    },
    sounds: function (prev, s, ctx) {
      if (s.pp && prev.pp && s.pp.trick.length > prev.pp.trick.length) ctx.sound.play('karte');
      var me = ctx.seat(), was = me && prev.seats[me.i];
      if (me && was && me.tricks > was.tricks) ctx.sound.play('chips');
    },
    rules: function () {
      return '<ul>' +
        '<li>Pilli Pilli ist das Stichspiel <b>Pili Pili</b> (ATM Gaming), hier in der <b>Grundversion ohne Missionskarten</b>, wie sie die Anleitung für die ersten Spiele vorschlägt. Gespielt wird mit den Zahlen <b>1 bis 55</b> und einem <b>Joker</b>, Farben gibt es nicht. Je höher die Zahl, desto schärfer die Karte: bis 18 eine Chili, bis 37 zwei, darüber drei.</li>' +
        '<li>Jeder bekommt <b>fünf Karten</b>. Angefangen beim Geber sagt jeder reihum an, wie viele Stiche er machen wird. Zusammen dürfen die Ansagen <b>nicht genau fünf</b> ergeben: Wer zuletzt ansagt, muss ausweichen.</li>' +
        '<li>Der Geber spielt aus, dann legt reihum jeder eine Karte. <b>Die höchste Karte gewinnt den Stich</b>, ihr Spieler spielt den nächsten aus. Es muss nichts bedient werden. Die Karten liegen in der Mitte vor dem, der sie gelegt hat.</li>' +
        '<li>Der <b>Joker</b> zählt so viel, wie du beim Legen sagst, von 0 bis 56. Bei gleichem Wert gewinnt die früher gelegte Karte.</li>' +
        '<li>Nach fünf Stichen bekommt jeder für jeden Stich, den er neben seiner Ansage liegt, einen <b>Pili</b> 🌶️ (Strafpunkt). Wer genau trifft, bekommt keinen. Am Platz steht die Ansage in der Scheibe, dahinter ein Punkt pro angesagtem Stich: gefüllt, wenn er gemacht ist, rot für Stiche zu viel. Die Chili zählt die Pilis.</li>' +
        '<li>Hat am Ende einer Runde jemand <b>7 Pilis</b> oder mehr, ist das Spiel vorbei. Es gewinnt, wer die <b>wenigsten Pilis</b> hat; bei Gleichstand gewinnen alle mit den wenigsten.</li>' +
        '<li>Bedienung: Ansagen per Knopf oder Taste <b>0</b> bis <b>5</b>, Karte anklicken zum Legen. Läuft die Zeit ab, sagst du 0 (oder 1, wenn 0 nicht geht) bzw. legst deine kleinste Karte.</li></ul>';
    },
    stats: {
      board: [['Genau getroffen', function (u) { return u.bonus; }], ['Treffer-Quote', function (u) { return u.rounds ? Math.round(u.bonus / u.rounds * 100) + ' %' : '–'; }]],
      kpis: [['Genau getroffen', function (m) { return m.bonus + '×'; }, function (m) { return m.rounds ? Math.round(m.bonus / m.rounds * 100) + ' % von ' + m.rounds + ' Runden' : '&nbsp;'; }], ['Wenigste Pilis', function (m) { return m.low == null ? '–' : m.low; }]],
      games: [['Pilis', function (g) { return g.score; }], ['Genau getroffen', function (g) { return g.bonus; }]],
    },
  });
})();
