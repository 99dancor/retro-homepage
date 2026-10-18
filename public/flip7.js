// Flip 7 (Startmenü → Spiele und Apps → Kartenspiele → 7️⃣ Flip 7): Tischmitte, ausliegende Karten und Regeln. Tischliste,
// Plätze, Seitenleiste und Statistik kommen aus public/cardtable.js, die Regeln aus src/flip7.js. Alle Karten liegen offen.
(function () {
  'use strict';
  var ACTIONS = { freeze: ['🥶', 'Einfrieren'], flip3: ['3️⃣', 'Drei ziehen'], second: ['🛟', 'Zweite Chance'] };
  var STATUS = { stayed: '<span class="bj-badge">✋ genug</span>', frozen: '<span class="bj-badge f7-frozen">🥶 eingefroren</span>', bust: '<span class="bj-badge bust">💥 Pech</span>' };

  function card(c, extra) {
    var cls = 'bj-card f7-card ' + (c.t === 'n' ? 'f7-n f7-v' + c.v : c.t === 'm' ? 'f7-m' : 'f7-a f7-' + c.v) + (extra ? ' ' + extra : '');
    if (c.t === 'a') return '<span class="' + cls + '" title="' + ACTIONS[c.v][1] + '"><span class="f7-big">' + ACTIONS[c.v][0] + '</span><span class="f7-lbl">' + ACTIONS[c.v][1] + '</span></span>';
    var t = c.t === 'm' ? (c.v === 'x2' ? '×2' : '+' + c.v) : String(c.v);
    return '<span class="' + cls + '" title="' + t + '"><span class="f7-big">' + t + '</span></span>';
  }
  function cards(p, extra) {
    var nums = p.nums.slice().sort(function (a, b) { return a.v - b.v; });
    return nums.map(function (c, i) { return card(c, extra + (p.status === 'bust' && c === p.nums[p.nums.length - 1] ? ' f7-dup' : '')); }).join('') +
      p.mods.map(function (c) { return card(c, extra); }).join('') + (p.sc ? card({ t: 'a', v: 'second' }, extra) : '');
  }

  window.CardTable({
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
      return {
        hole: '<span class="f7-row">' + cards(p, 'mini') + '</span>',
        line: (p.status === 'bust' ? '0' : p.points) + ' P. diese Runde · ' + p.total + ' gesamt',
        badge: (STATUS[p.status] || '') + (p.flip7 ? ' <span class="bj-badge win">FLIP 7!</span>' : '') + (s.f7 && s.f7.dealer === p.i ? ' <span class="bj-badge">Geber</span>' : ''),
        cls: p.status === 'bust' || p.status === 'frozen' || p.status === 'stayed' ? 'folded' : '',
      };
    },
    score: function (p) { return p.total + ' P.'; },
    sideRows: function (s, seat) { return '<tr><td>Punkte gesamt</td><td class="num">' + seat.total + '</td></tr><tr><td>Diese Runde</td><td class="num">' + (seat.status === 'bust' ? 0 : seat.points) + '</td></tr>'; },
    center: function (s, ctx) {
      var f = s.f7;
      if (f.over) {
        return '<div class="pk-result dk-big">Runde ' + f.round + ' vorbei</div><div class="dk-order"><table class="f7-sum">' + f.over.rows.map(function (r) {
          return '<tr><td>' + ctx.esc(r.name) + '</td><td>' + (r.status === 'bust' ? '💥' : r.flip7 ? '7️⃣' : r.status === 'frozen' ? '🥶' : '') + '</td><td class="num">+' + r.points + '</td><td class="num"><b>' + r.total + '</b></td></tr>';
        }).join('') + '</table></div><div class="pk-result">Gleich geht es weiter …</div>';
      }
      var h = '<div class="un-mid"><div class="un-stack">' + ctx.back() + '<small>' + f.deck + ' im Stapel</small></div>' +
        '<div class="un-stack">' + (f.discard ? ctx.back('dk-off') : '') + '<small>' + f.discard + ' abgelegt</small></div></div>';
      var line = '';
      if (f.choose) line = ctx.name(s, f.choose.seat) + ' wählt, wen „' + ACTIONS[f.choose.card.v][1] + '“ trifft …';
      else if (f.cur >= 0 && s.seats[f.cur]) line = ctx.name(s, f.cur) + ' ist dran: Karte oder genug?';
      if (line) h += '<div class="pk-pot">' + line + '</div>';
      return h;
    },
    bar: function (s, seat, ctx) {
      var f = s.f7, o = s.options || {};
      var html = '<div class="dk-hand f7-hand">' + (seat.nums.length || seat.mods.length || seat.sc ? cards(seat, '') : '<span>Noch keine Karten.</span>') + '</div><div class="bj-row">';
      if (f.over) html += '<span>Die Runde ist vorbei.</span>';
      else if (o.targets && o.targets.length) {
        html += '<span>Wen trifft <b>' + ACTIONS[f.choose.card.v][1] + '</b>?</span>' + o.targets.map(function (j) {
          return '<button type="button" data-fact="target" data-seat="' + j + '">' + (j === seat.i ? 'Mich selbst' : ctx.name(s, j)) + '</button>';
        }).join('');
      } else if (o.hit) {
        html += '<span>Du hast ' + seat.points + ' Punkte. Noch eine Karte?</span><button type="button" data-fact="hit" title="Taste K oder Leertaste"><b><u>K</u>arte!</b></button>' +
          '<button type="button" data-fact="stay" title="Taste G"><b><u>G</u>enug</b></button>';
      } else if (seat.status !== 'in') html += '<span>' + (seat.status === 'bust' ? 'Pech gehabt, diese Runde gibt es keine Punkte.' : 'Du bist für diese Runde fertig mit ' + seat.points + ' Punkten.') + '</span>';
      else html += '<span>Warten …</span>';
      return html + '</div>';
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
      var btn = act && document.querySelector('[data-fact=' + act + ']');
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
        '<li>Gespielt wird mit <b>94 Karten</b>: Zahlen von 0 bis 12, von jeder Zahl so viele Karten wie ihr Wert (eine 1, zwei 2en … zwölf 12en, dazu eine 0). Dazu Bonuskarten <b>+2, +4, +6, +8, +10</b> und <b>×2</b> und je drei Aktionskarten <b>Einfrieren</b> 🥶, <b>Drei ziehen</b> 3️⃣ und <b>Zweite Chance</b> 🛟.</li>' +
        '<li>Zu Beginn jeder Runde bekommt jeder eine Karte offen. Dann ist reihum, links vom Geber angefangen, jeder einmal dran und sagt <b>„Karte!“</b> (eine Karte ziehen) oder <b>„Genug“</b> (aufhören und die Punkte behalten). Das geht so lange, bis niemand mehr ziehen will oder kann.</li>' +
        '<li>Ziehst du eine <b>Zahl, die du schon hast</b>, ist die Runde für dich vorbei und du bekommst <b>null Punkte</b>.</li>' +
        '<li>Schaffst du <b>sieben verschiedene Zahlen</b>, hast du <b>Flip 7</b>: 15 Punkte extra, und die Runde ist für alle sofort vorbei. Wer nicht ausgeschieden ist, bekommt seine Punkte.</li>' +
        '<li><b>Punkte:</b> alle Zahlen zusammen, ×2 verdoppelt diese Summe, danach kommen die Bonuskarten dazu. Bonuskarten zählen nicht für Flip 7 und machen nie doppelt.</li>' +
        '<li><b>Einfrieren:</b> du wählst einen Spieler, der noch dabei ist (auch dich selbst). Er hört sofort auf und behält seine Punkte.</li>' +
        '<li><b>Drei ziehen:</b> der gewählte Spieler zieht nacheinander drei Karten. Hat er doppelt oder Flip 7, hört er früher auf. Einfrieren oder Drei ziehen, die er dabei zieht, kommen erst danach dran.</li>' +
        '<li><b>Zweite Chance:</b> behältst du. Ziehst du später eine doppelte Zahl, kommen beide weg und du bist weiter dabei. Mehr als eine darfst du nicht haben, eine weitere gibst du einem anderen, der noch keine hat.</li>' +
        '<li>Aktionskarten in der ersten Karte jeder Runde wirken sofort. Ist nur noch einer dabei, trifft die Aktion ihn selbst.</li>' +
        '<li>Der Stapel wird zwischen den Runden nicht gemischt. Ist er leer, werden die abgelegten Karten gemischt.</li>' +
        '<li>Hat am Ende einer Runde jemand <b>200 Punkte</b> oder mehr, gewinnt, wer am meisten hat. Bei Gleichstand an der Spitze wird noch eine Runde gespielt. Am Tisch lässt sich auch 100 oder 300 einstellen.</li>' +
        '<li>Bedienung: <b>K</b> oder Leertaste für „Karte!“, <b>G</b> für „Genug“. Läuft die Zeit ab, hörst du auf. Bei Aktionskarten wählst du den Spieler mit den Knöpfen unten.</li></ul>';
    },
    stats: {
      board: [['Flip 7', function (u) { return u.bonus; }], ['Beste Runde', function (u) { return u.best + ' P.'; }]],
      kpis: [['Flip 7 geschafft', function (m) { return m.bonus + '×'; }, function (m) { return 'in ' + m.rounds + ' Runden'; }], ['Beste Runde', function (m) { return m.best + ' P.'; }], ['Höchster Endstand', function (m) { return (m.top || 0) + ' P.'; }]],
      games: [['Punkte', function (g) { return g.score; }], ['Beste Runde', function (g) { return g.best; }], ['Flip 7', function (g) { return g.bonus; }]],
    },
  });
})();
