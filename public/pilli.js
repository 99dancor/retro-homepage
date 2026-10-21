// Pilli Pilli (Startmenü → Spiele und Apps → Kartenspiele → 🌶️ Pilli Pilli): Ansagen, Stiche, eigene Hand und Regeln.
// Tischliste, Plätze, Seitenleiste und Statistik kommen aus public/cardtable.js, die Regeln aus src/pilli.js.
(function () {
  'use strict';
  function card(c, extra, attrs, value) {
    if (c.j) return '<span class="bj-card pp-card pp-joker' + (extra ? ' ' + extra : '') + '" title="Joker"' + (attrs || '') + '><span class="pp-num">' + (value != null ? value : '🃏') + '</span><span class="pp-lbl">Joker</span></span>';
    return '<span class="bj-card pp-card' + (extra ? ' ' + extra : '') + '" title="' + c.v + '"' + (attrs || '') + '><span class="pp-num">' + c.v + '</span><span class="pp-lbl">🌶️</span></span>';
  }
  function chilis(n) { return n + ' 🌶️'; }
  function trick(list, ctx, winner) {
    return list.map(function (p) {
      return '<span class="pp-play' + (p.seat === winner ? ' win' : '') + '">' + card(p.card, '', '', p.card.j ? p.value : null) + '<small>' + ctx.esc(p.name) + '</small></span>';
    }).join('');
  }

  window.CardTable({
    id: 'pilli',
    tableWord: 'Pilli-Pilli-Tisch',
    motto: 'PILLI PILLI · 55 KARTEN + JOKER',
    blurb: 'Pilli Pilli (Pili Pili) in der Grundversion, 2 bis 8 Spieler, je 5 Karten, bis jemand 7 Pilis hat.',
    tags: function (s) { return s.pp ? '<span class="tag">Runde ' + s.pp.round + '</span><span class="tag">' + s.pp.bids + ' von ' + s.pp.hand + ' Stichen angesagt</span>' : '<span class="tag">5 Karten · bis 7 Pilis</span>'; },
    turnText: function (kind) { return kind === 'bid' ? 'sagt an' : ''; },
    seat: function (s, p, ctx) {
      return {
        hole: ctx.mine(p) ? '' : ctx.backs(p.cards),
        line: 'Ansage ' + (p.bid == null ? '?' : p.bid) + ' · Stiche ' + p.tricks,
        badge: '<span class="bj-badge' + (p.pilis >= 5 ? ' lose' : '') + '" title="' + p.pilis + ' Pilis">' + chilis(p.pilis) + '</span>',
        dealer: !!s.pp && s.pp.dealer === p.i,
      };
    },
    score: function (p) { return p.pilis + ' 🌶️'; },
    sideRows: function (s, seat) { return '<tr><td>Pilis</td><td class="num">' + seat.pilis + '</td></tr><tr><td>Ansage / Stiche</td><td class="num">' + (seat.bid == null ? '?' : seat.bid) + ' / ' + seat.tricks + '</td></tr>'; },
    center: function (s, ctx) {
      var g = s.pp;
      if (g.over) {
        return '<div class="pk-result dk-big">Runde ' + g.round + ' vorbei</div><div class="dk-order"><table class="f7-sum"><tr><th></th><th>Ansage</th><th>Stiche</th><th>Pilis</th></tr>' + g.over.rows.map(function (r) {
          return '<tr><td>' + ctx.esc(r.name) + '</td><td class="num">' + r.bid + '</td><td class="num">' + r.tricks + '</td><td class="num">' + (r.pen ? '+' + r.pen : '✓') + ' → <b>' + r.pilis + '</b></td></tr>';
        }).join('') + '</table></div><div class="pk-result">Gleich geht es weiter …</div>';
      }
      var h = '';
      if (g.phase === 'bid') h += '<div class="pk-pot">' + ctx.name(s, g.cur) + ' sagt an …</div>';
      else {
        var shown = g.phase === 'trick' && g.last ? g.last.cards : g.trick;
        h += '<div class="pp-trick">' + (shown.length ? trick(shown, ctx, g.phase === 'trick' && g.last ? g.last.winner : -1) : '<span class="dk-hint">' + ctx.name(s, g.cur) + ' spielt aus …</span>') + '</div>';
        if (g.phase === 'trick' && g.last) h += '<div class="pk-pot">' + ctx.name(s, g.last.winner) + ' gewinnt den Stich</div>';
        else if (g.last) h += '<div class="pp-last"><small>Letzter Stich:</small> ' + g.last.cards.map(function (p) { return (p.card.j ? '🃏' : '') + p.value; }).join(' · ') + ' → ' + ctx.name(s, g.last.winner) + '</div>';
      }
      return h;
    },
    bar: function (s, seat, ctx) {
      var g = s.pp, o = s.options || {};
      var hand = (s.hand || []).slice().sort(function (a, b) { return a.v - b.v; });
      var html = '<div class="dk-hand pp-hand">' + (hand.length ? hand.map(function (c) {
        var ok = o.play && o.play.indexOf(c.k) >= 0;
        return card(c, ok ? 'ok' : 'dim', ' data-card="' + c.k + '" role="button" tabindex="0"');
      }).join('') : '<span>Keine Karten mehr.</span>') + '</div><div class="bj-row">';
      if (g.over) html += '<span>Die Runde ist vorbei.</span>';
      else if (o.bid && o.bid.length) {
        html += '<span>Wie viele Stiche machst du?</span>' + [0, 1, 2, 3, 4, 5].slice(0, g.hand + 1).map(function (n) {
          var ok = o.bid.indexOf(n) >= 0;
          return '<button type="button" data-pact="bid" data-n="' + n + '"' + (ok ? '' : ' disabled title="Zusammen dürfen die Ansagen nicht genau ' + g.hand + ' ergeben"') + '><b>' + n + '</b></button>';
        }).join('') + (o.forbidden >= 0 ? '<small>(' + o.forbidden + ' geht nicht)</small>' : '');
      } else if (o.play && o.play.length) html += '<span>Du bist dran: leg eine Karte. Die höchste gewinnt.</span>';
      else html += '<span>' + (g.phase === 'bid' ? 'Die anderen sagen an …' : 'Warten …') + '</span>';
      return html + '</div>';
    },
    click: function (el, ctx) {
      var c = el.closest('[data-card]'), b = el.closest('[data-pact]');
      if (b) { ctx.ctl('bid', { bid: Number(b.dataset.n) }); return true; }
      if (!c) return false;
      var st = ctx.state(), o = st.options || {}, k = Number(c.dataset.card);
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
      var btn = /^[0-5]$/.test(e.key) && document.querySelector('[data-pact=bid][data-n="' + e.key + '"]:not([disabled])');
      if (btn) { e.preventDefault(); btn.click(); }
    },
    sounds: function (prev, s, ctx) {
      if (s.pp && prev.pp && s.pp.trick.length > prev.pp.trick.length) ctx.sound.play('karte');
      var me = ctx.seat(), was = me && prev.seats[me.i];
      if (me && was && me.tricks > was.tricks) ctx.sound.play('chips');
    },
    rules: function () {
      return '<ul>' +
        '<li>Pilli Pilli ist das Stichspiel <b>Pili Pili</b> (ATM Gaming), hier in der <b>Grundversion ohne Missionskarten</b>, wie sie die Anleitung für die ersten Spiele vorschlägt. Gespielt wird mit den Zahlen <b>1 bis 55</b> und einem <b>Joker</b>, Farben gibt es nicht.</li>' +
        '<li>Jeder bekommt <b>fünf Karten</b>. Angefangen beim Geber sagt jeder reihum an, wie viele Stiche er machen wird. Zusammen dürfen die Ansagen <b>nicht genau fünf</b> ergeben: Wer zuletzt ansagt, muss ausweichen.</li>' +
        '<li>Der Geber spielt aus, dann legt reihum jeder eine Karte. <b>Die höchste Karte gewinnt den Stich</b>, ihr Spieler spielt den nächsten aus. Es muss nichts bedient werden.</li>' +
        '<li>Der <b>Joker</b> zählt so viel, wie du beim Legen sagst, von 0 bis 56. Bei gleichem Wert gewinnt die früher gelegte Karte.</li>' +
        '<li>Nach fünf Stichen bekommt jeder für jeden Stich, den er neben seiner Ansage liegt, einen <b>Pili</b> 🌶️ (Strafpunkt). Wer genau trifft, bekommt keinen.</li>' +
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
