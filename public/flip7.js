// Flip 7 (Startmenü → Spiele und Apps → Kartenspiele → 7️⃣ Flip 7): Spielshow am Tisch. In der Mitte die Leuchtschrift, der
// Stapel zum Aufdecken und die abgelegten Karten; vor jedem Platz liegt seine Reihe mit Punkten der Runde, sieben Lämpchen
// für die Zahlen bis Flip 7 und einem Balken bis zum Ziel. Tischliste, Plätze, Seitenleiste und Statistik kommen aus
// public/cardtable.js, die Regeln aus src/flip7.js. Alle Karten liegen offen. Jede Karte trägt data-card (Art und Wert,
// die doppelte Zahl mit -2), Stapel und Ablage data-pile="deck" bzw. "discard"; damit kann das Fenster Karten fliegen lassen.
(function () {
  'use strict';
  var ACTIONS = { freeze: ['❄️', 'Einfrieren'], flip3: ['3️⃣', 'Drei ziehen'], second: ['🛟', 'Zweite Chance'] };
  var STAMP = { stayed: '✋ Genug', frozen: '❄️ Eingefroren', bust: '💥 Pech' };

  function cid(c) { return c.t + c.v; }
  function card(c, extra, id) {
    var cls = 'bj-card f7-card ' + (c.t === 'n' ? 'f7-n f7-v' + c.v : c.t === 'm' ? 'f7-m' + (c.v === 'x2' ? ' f7-x2' : '') : 'f7-a f7-' + c.v) + (extra ? ' ' + extra : '');
    var attr = ' data-card="' + (id || cid(c)) + '"';
    if (c.t === 'a') return '<span class="' + cls + '" title="' + ACTIONS[c.v][1] + '"' + attr + '><span class="f7-big">' + ACTIONS[c.v][0] + '</span><span class="f7-lbl">' + ACTIONS[c.v][1] + '</span></span>';
    var t = c.t === 'm' ? (c.v === 'x2' ? '×2' : '+' + c.v) : String(c.v);
    return '<span class="' + cls + '" title="' + t + '"' + attr + '><span class="f7-ix">' + t + '</span><span class="f7-big">' + t + '</span><span class="f7-ix br">' + t + '</span></span>';
  }
  // Die Reihe eines Spielers: Zahlen aufsteigend (die doppelte gekippt daneben), dann Bonuskarten und die Zweite Chance
  function row(p, extra) {
    var dup = p.status === 'bust' ? p.nums[p.nums.length - 1] : null;
    var nums = p.nums.filter(function (c) { return c !== dup; }).sort(function (a, b) { return a.v - b.v; });
    var h = nums.map(function (c) {
      var twin = dup && dup.v === c.v;
      return card(c, extra) + (twin ? card(dup, extra + ' f7-dup', cid(dup) + '-2') : '');
    }).join('');
    return h + p.mods.map(function (c) { return card(c, extra); }).join('') + (p.sc ? card({ t: 'a', v: 'second' }, extra) : '');
  }
  function uniq(p) { return p.nums.length - (p.status === 'bust' ? 1 : 0); }
  // Sieben Lämpchen: so viele verschiedene Zahlen liegen schon (sieben sind Flip 7)
  function bulbs(p) {
    var n = uniq(p), h = '';
    for (var k = 0; k < 7; k++) h += '<i' + (k < n ? ' class="on"' : '') + '></i>';
    return '<span class="f7-bulbs" title="' + n + ' von 7 Zahlen">' + h + '</span>';
  }
  // Balken bis zum Ziel: was schon zählt, dazu (heller) was diese Runde bringen würde
  function meter(total, round, target, bust) {
    var a = Math.min(100, total / target * 100), b = bust ? 0 : Math.min(100 - a, round / target * 100);
    return '<span class="f7-meter" title="' + total + ' von ' + target + ' Punkten' + (b ? ', mit dieser Runde ' + (total + round) : '') + '"><i style="width:' + a.toFixed(1) + '%"></i><i class="r" style="width:' + b.toFixed(1) + '%"></i></span>';
  }
  function roundPts(p) { return p.status === 'bust' ? 0 : p.points; }

  // Sitzt der Platz ganz links oder rechts am Tisch? Dann rückt er auf dem Handy etwas zur Mitte (wie die Plätze in cardtable.js)
  function side(s, p, ctx) {
    var me = ctx.seat(), n = s.seatCount, x = Math.cos(Math.PI / 2 + ((p.i - (me ? me.i : 0) + n) % n) * 2 * Math.PI / n);
    return x < -.6 ? ' at-w' : x > .6 ? ' at-e' : '';
  }

  window.CardTable({
    id: 'flip7',
    tableWord: 'Flip-7-Tisch',
    motto: 'FLIP 7 · 94 KARTEN',
    blurb: 'Flip 7 nach den Originalregeln, 2 bis 8 Spieler, bis 200 Punkte.',
    defaults: { target: 200 },
    options: function (o) {
      return '<label>Gespielt wird bis:<select name="target" class="w100">' + [[200, '200 Punkte (offiziell)'], [300, '300 Punkte'], [100, '100 Punkte']].map(function (x) {
        return '<option value="' + x[0] + '"' + (Number(o.target) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
      }).join('') + '</select></label>';
    },
    read: function (field) { return { target: Number(field('target')) }; },
    tags: function (s) { return '<span class="tag">bis ' + s.opts.target + ' Punkte</span>' + (s.f7 ? '<span class="tag">Runde ' + s.f7.round + '</span>' : ''); },
    turnText: function (kind) { return kind === 'target' ? 'wählt' : ''; },
    seat: function (s, p, ctx) {
      var f = s.f7, o = s.options || {}, pick = o.targets && o.targets.indexOf(p.i) >= 0 && !ctx.mine(p);
      var st = p.flip7 ? 'flip7' : p.status;
      var lane = '<span class="f7-lane st-' + st + (pick ? ' pick' : '') + '"' + (pick ? ' data-fact="target" data-seat="' + p.i + '" role="button" tabindex="0" title="' + ctx.esc(p.name) + ' wählen"' : '') + '>' +
        '<span class="f7-row">' + (ctx.mine(p) ? '' : row(p, 'mini')) + '</span>' +
        (p.flip7 ? '<span class="f7-stamp win">FLIP 7!</span>' : STAMP[p.status] ? '<span class="f7-stamp">' + STAMP[p.status] + '</span>' : '') +
        '<span class="f7-meta">' + bulbs(p) + '<b class="f7-rp">+' + roundPts(p) + '</b></span>' + meter(p.total, roundPts(p), s.opts.target, p.status === 'bust') + '</span>';
      return {
        hole: lane,
        line: p.total + ' P. gesamt',
        badge: '',
        dealer: !!f && f.dealer === p.i,
        cls: 'f7-seat' + side(s, p, ctx) + (p.status === 'bust' || p.status === 'frozen' || p.status === 'stayed' ? ' folded' : '') + (pick ? ' f7-target' : ''),
      };
    },
    score: function (p) { return p.total + ' P.'; },
    sideRows: function (s, seat) { return '<tr><td>Punkte gesamt</td><td class="num">' + seat.total + '</td></tr><tr><td>Diese Runde</td><td class="num">' + roundPts(seat) + '</td></tr>'; },
    center: function (s, ctx) {
      var f = s.f7, o = s.options || {}, target = s.opts.target;
      if (f.over) {
        var rows = f.over.rows.slice().sort(function (a, b) { return b.total - a.total; });
        return '<div class="f7-board"><div class="f7-marquee small"><span>Runde ' + f.round + '</span><b>vorbei</b></div><table class="f7-sum">' + rows.map(function (r) {
          return '<tr class="st-' + (r.flip7 ? 'flip7' : r.status) + '"><td>' + ctx.esc(r.name) + '</td><td>' + (r.status === 'bust' ? '💥' : r.flip7 ? '7️⃣' : r.status === 'frozen' ? '❄️' : '') + '</td><td class="num">+' + r.points + '</td>' +
            '<td class="num"><b>' + r.total + '</b></td><td class="f7-sum-bar">' + meter(r.total - r.points, r.points, target, false) + '</td></tr>';
        }).join('') + '</table><div class="f7-next">' + (ctx.next ? ctx.next(s) : 'Gleich geht es weiter …') + '</div></div>';
      }
      var backs = '';
      for (var k = 0; k < Math.min(3, Math.max(1, Math.ceil(f.deck / 30))); k++) backs += '<span class="bj-card back" style="--i:' + k + '"></span>';
      var h = '<div class="f7-stage"><div class="f7-piles">' +
        '<div class="f7-deck' + (o.hit ? ' ok' : '') + '" data-pile="deck"' + (o.hit ? ' data-fact="hit" role="button" tabindex="0" title="Karte! (Taste K)"' : '') + '>' +
          '<span class="f7-backs">' + backs + '</span><b class="f7-count">' + f.deck + '</b>' + (o.hit ? '<span class="f7-cta">Karte!</span>' : '') + '</div>' +
        '<div class="f7-marquee"><span>FLIP</span><b>7</b></div>' +
        '<div class="f7-disc" data-pile="discard">' + (f.discard ? ctx.back('f7-off') : '<span class="f7-empty"></span>') + '<small>' + f.discard + ' abgelegt</small></div></div>';
      var line = '';
      if (f.choose) line = ctx.name(s, f.choose.seat) + ' wählt, wen „' + ACTIONS[f.choose.card.v][1] + '“ trifft …';
      else if (f.cur >= 0 && s.seats[f.cur]) line = ctx.name(s, f.cur) + ' ist dran: Karte oder genug?';
      if (line) h += '<div class="pk-pot f7-ticker">' + line + '</div>';
      return h + '</div>';
    },
    bar: function (s, seat, ctx) {
      var f = s.f7, o = s.options || {}, rp = roundPts(seat), target = s.opts.target;
      var has = seat.nums.length || seat.mods.length || seat.sc;
      var html = '<div class="f7-mine st-' + (seat.flip7 ? 'flip7' : seat.status) + '"><div class="dk-hand f7-hand">' + (has ? row(seat, '') : '<span class="f7-none">Noch keine Karten.</span>') + '</div>' +
        '<div class="f7-mysum">' + bulbs(seat) + '<span><b>+' + rp + '</b> diese Runde</span>' + meter(seat.total, rp, target, seat.status === 'bust') + '<span>' + seat.total + ' / ' + target + '</span></div><div class="bj-row">';
      if (f.over) html += '<span>Die Runde ist vorbei.</span>';
      else if (o.targets && o.targets.length) {
        html += '<span>Wen trifft <b>' + ACTIONS[f.choose.card.v][1] + '</b>?</span>' + o.targets.map(function (j, n) {
          return '<button type="button"' + (n ? '' : ' class="def"') + ' data-fact="target" data-seat="' + j + '">' + (j === seat.i ? 'Mich selbst' : ctx.name(s, j)) + '</button>';
        }).join('');
      } else if (o.hit) {
        html += '<span>Noch eine Karte?</span><button type="button" class="def f7-hit" data-fact="hit" title="Taste K oder Leertaste"><b><u>K</u>arte!</b></button>' +
          '<button type="button" class="f7-stay" data-fact="stay" title="Taste G"><b><u>G</u>enug</b></button>';
      } else if (seat.status !== 'in') html += '<span>' + (seat.status === 'bust' ? 'Pech gehabt, diese Runde gibt es keine Punkte.' : seat.flip7 ? 'Flip 7! 15 Punkte extra.' : 'Du bist für diese Runde fertig mit ' + rp + ' Punkten.') + '</span>';
      else html += '<span>' + (f.choose ? ctx.name(s, f.choose.seat) + ' wählt …' : f.cur >= 0 && s.seats[f.cur] ? ctx.name(s, f.cur) + ' ist dran.' : 'Warten …') + '</span>';
      return html + '</div></div>';
    },
    click: function (el, ctx) {
      var b = el.closest('[data-fact]');
      if (!b) return false;
      if (b.dataset.fact === 'target') ctx.ctl('target', { seat: Number(b.dataset.seat) });
      else ctx.ctl(b.dataset.fact);
      return true;
    },
    keys: function (e) {
      var k = e.key.toLowerCase(), act = k === 'k' || k === ' ' ? 'hit' : k === 'g' ? 'stay' : null;
      var btn = act && document.querySelector('.cg-flip7 .ks-dock [data-fact=' + act + ']');
      if (btn) { e.preventDefault(); btn.click(); }
    },
    sounds: function (prev, s, ctx) {
      var n = function (st) { return st.seats.reduce(function (m, p) { return m + (p && p.nums ? p.nums.length + p.mods.length : 0); }, 0); };
      if (n(s) > n(prev)) ctx.sound.play('karte');
      var me = ctx.seat(), was = me && prev.seats[me.i];
      if (me && was && me.status === 'bust' && was.status !== 'bust') ctx.sound.play('fehler');
      if (me && was && me.flip7 && !was.flip7) ctx.sound.play('tusch');
    },
    rules: function () {
      return '<ul>' +
        '<li>Gespielt wird mit <b>94 Karten</b>: Zahlen von 0 bis 12, von jeder Zahl so viele Karten wie ihr Wert (eine 1, zwei 2en … zwölf 12en, dazu eine 0). Dazu Bonuskarten <b>+2, +4, +6, +8, +10</b> und <b>×2</b> und je drei Aktionskarten <b>Einfrieren</b> ❄️, <b>Drei ziehen</b> 3️⃣ und <b>Zweite Chance</b> 🛟.</li>' +
        '<li>Zu Beginn jeder Runde bekommt jeder eine Karte offen. Dann ist reihum, links vom Geber angefangen, jeder einmal dran und sagt <b>„Karte!“</b> (eine Karte ziehen) oder <b>„Genug“</b> (aufhören und die Punkte behalten). Das geht so lange, bis niemand mehr ziehen will oder kann.</li>' +
        '<li>Ziehst du eine <b>Zahl, die du schon hast</b>, ist die Runde für dich vorbei und du bekommst <b>null Punkte</b>.</li>' +
        '<li>Schaffst du <b>sieben verschiedene Zahlen</b>, hast du <b>Flip 7</b>: 15 Punkte extra, und die Runde ist für alle sofort vorbei. Wer nicht ausgeschieden ist, bekommt seine Punkte. Die sieben Lämpchen an jeder Reihe zeigen, wie viele Zahlen schon liegen.</li>' +
        '<li><b>Punkte:</b> alle Zahlen zusammen, ×2 verdoppelt diese Summe, danach kommen die Bonuskarten dazu. Bonuskarten zählen nicht für Flip 7 und machen nie doppelt.</li>' +
        '<li><b>Einfrieren:</b> du wählst einen Spieler, der noch dabei ist (auch dich selbst). Er hört sofort auf und behält seine Punkte.</li>' +
        '<li><b>Drei ziehen:</b> der gewählte Spieler zieht nacheinander drei Karten. Hat er doppelt oder Flip 7, hört er früher auf. Einfrieren oder Drei ziehen, die er dabei zieht, kommen erst danach dran.</li>' +
        '<li><b>Zweite Chance:</b> behältst du. Ziehst du später eine doppelte Zahl, kommen beide weg und du bist weiter dabei. Mehr als eine darfst du nicht haben, eine weitere gibst du einem anderen, der noch keine hat.</li>' +
        '<li>Aktionskarten in der ersten Karte jeder Runde wirken sofort. Ist nur noch einer dabei, trifft die Aktion ihn selbst.</li>' +
        '<li>Der Stapel wird zwischen den Runden nicht gemischt. Ist er leer, werden die abgelegten Karten gemischt.</li>' +
        '<li>Hat am Ende einer Runde jemand <b>200 Punkte</b> oder mehr, gewinnt, wer am meisten hat. Bei Gleichstand an der Spitze wird noch eine Runde gespielt. Am Tisch lässt sich auch 100 oder 300 einstellen. Der Balken an jeder Reihe zeigt den Stand bis zum Ziel, hell dazu, was die laufende Runde bringen würde.</li>' +
        '<li>Bedienung: <b>K</b>, Leertaste oder ein Klick auf den Stapel für „Karte!“, <b>G</b> für „Genug“. Läuft die Zeit ab, hörst du auf. Bei Aktionskarten wählst du den Spieler mit den Knöpfen unten oder per Klick auf seine Reihe.</li></ul>';
    },
    stats: {
      board: [['Flip 7', function (u) { return u.bonus; }], ['Beste Runde', function (u) { return u.best + ' P.'; }]],
      kpis: [['Flip 7 geschafft', function (m) { return m.bonus + '×'; }, function (m) { return 'in ' + m.rounds + ' Runden'; }], ['Beste Runde', function (m) { return m.best + ' P.'; }], ['Höchster Endstand', function (m) { return (m.top || 0) + ' P.'; }]],
      games: [['Punkte', function (g) { return g.score; }], ['Beste Runde', function (g) { return g.best; }], ['Flip 7', function (g) { return g.bonus; }]],
    },
  });
})();
