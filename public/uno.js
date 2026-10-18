// UNO (Startmenü → Spiele und Apps → Kartenspiele → 🟥 UNO): Tischmitte, eigene Hand und Regeln. Tischliste, Plätze,
// Seitenleiste und Statistik kommen aus public/cardtable.js, die Regeln aus src/uno.js.
(function () {
  'use strict';
  var NAMES = { r: 'Rot', y: 'Gelb', g: 'Grün', b: 'Blau' };
  var SYM = { S: '⊘', R: '⇄', D2: '+2', W: '★', W4: '+4' };
  var ORDER = ['r', 'y', 'g', 'b', 'w'], VALS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D2', 'W', 'W4'];
  var TITLE = { S: 'Aussetzen', R: 'Richtungswechsel', D2: 'Zieh zwei', W: 'Farbwahl', W4: 'Zieh vier' };

  function card(c, extra, attrs) {
    var sym = SYM[c.v] || c.v, name = c.c === 'w' ? TITLE[c.v] : NAMES[c.c] + ' ' + (TITLE[c.v] || c.v);
    return '<span class="bj-card un-card un-' + c.c + (extra ? ' ' + extra : '') + '" title="' + name + '"' + (attrs || '') + '>' +
      '<span class="un-corner">' + sym + '</span><span class="un-oval"><span>' + sym + '</span></span><span class="un-corner br">' + sym + '</span></span>';
  }
  function sortHand(h) {
    return h.slice().sort(function (a, b) { return ORDER.indexOf(a.c) - ORDER.indexOf(b.c) || VALS.indexOf(a.v) - VALS.indexOf(b.v); });
  }
  function colorButtons(act, extra) {
    return ['r', 'y', 'g', 'b'].map(function (c) { return '<button type="button" class="un-pick un-' + c + '" data-uact="' + act + '" data-color="' + c + '"' + (extra || '') + '>' + NAMES[c] + '</button>'; }).join('');
  }

  window.CardTable({
    tableWord: 'UNO-Tisch',
    motto: 'UNO · 108 KARTEN',
    blurb: 'UNO nach den offiziellen Regeln, 2 bis 8 Spieler, bis 500 Punkte oder eine Runde.',
    defaults: { target: 500 },
    options: function (o) {
      return '<label>Gespielt wird:<select name="target" class="w100">' + [[500, 'bis 500 Punkte (offiziell)'], [300, 'bis 300 Punkte'], [200, 'bis 200 Punkte'], [100, 'bis 100 Punkte'], [0, 'nur eine Runde']].map(function (x) {
        return '<option value="' + x[0] + '"' + (Number(o.target) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
      }).join('') + '</select></label>';
    },
    read: function (field) { return { target: Number(field('target')) }; },
    tags: function (s) {
      var u = s.uno;
      return '<span class="tag">' + (s.opts.target ? 'bis ' + s.opts.target + ' Punkte' : 'eine Runde') + '</span>' + (u ? '<span class="tag">Runde ' + u.round + '</span><span class="tag">' + (u.dir === 1 ? '↻ im Uhrzeigersinn' : '↺ gegen den Uhrzeigersinn') + '</span>' : '');
    },
    turnText: function (kind) { return kind === 'color' ? 'wählt Farbe' : kind === 'challenge' ? 'soll 4 ziehen' : ''; },
    seat: function (s, p, ctx) {
      return {
        hole: ctx.mine(p) ? '' : ctx.backs(p.cards),
        line: p.cards + (p.cards === 1 ? ' Karte' : ' Karten') + ' · ' + p.score + ' P.',
        badge: (p.cards === 1 && p.said ? '<span class="bj-badge win">📣 UNO!</span>' : '') + (s.uno && s.uno.dealer === p.i ? ' <span class="bj-badge">Geber</span>' : ''),
      };
    },
    score: function (p) { return p.score + ' P.'; },
    sideRows: function (s, seat) { return '<tr><td>Punkte</td><td class="num">' + seat.score + '</td></tr><tr><td>Runden gewonnen</td><td class="num">' + seat.won + '</td></tr>'; },
    center: function (s, ctx) {
      var u = s.uno, o = s.options || {}, cur = s.seats[u.cur];
      if (u.over) {
        var r = u.over;
        return '<div class="pk-result dk-big">🎉 ' + ctx.esc(r.winner) + ' hat keine Karten mehr: +' + r.points + ' Punkte</div>' +
          '<div class="dk-order">' + r.hands.map(function (h) { return '<div>' + ctx.esc(h.name) + ': <span class="un-mini">' + h.cards.map(function (c) { return card(c, 'mini'); }).join('') + '</span> ' + h.points + ' P.</div>'; }).join('') + '</div>' +
          '<div class="pk-result">Gleich geht es mit der nächsten Runde weiter …</div>';
      }
      var h = '<div class="un-mid"><div class="un-stack' + (o.draw ? ' ok' : '') + '"' + (o.draw ? ' data-uact="draw" role="button" tabindex="0" title="Karte ziehen (Taste Z)"' : '') + '>' + ctx.back() + '<small>' + u.deck + ' im Stapel</small></div>' +
        '<div class="un-pile">' + card(u.top) + '<small>' + (u.color ? '<span class="un-dot un-' + u.color + '"></span> ' + NAMES[u.color] : 'Farbe wird gewählt') + '</small></div>' +
        '<div class="un-dir" title="Spielrichtung">' + (u.dir === 1 ? '↻' : '↺') + '</div></div>';
      var line;
      if (u.challenge) line = ctx.name(s, u.challenge.to) + ' soll vier ziehen oder anzweifeln …';
      else if (u.choosing) line = (cur ? ctx.esc(cur.name) : '–') + ' wählt die Farbe …';
      else line = (cur ? ctx.esc(cur.name) : '–') + ' ist dran.';
      h += '<div class="pk-pot">' + line + '</div>';
      if (o.catch) h += '<button type="button" class="un-catch" data-uact="catch" title="Taste U">🚨 ' + ctx.name(s, u.catchable) + ' hat kein UNO gerufen!</button>';
      if (u.reveal) h += '<div class="dk-order"><small>Hand von ' + ctx.esc(u.reveal.name) + ':</small> <span class="un-mini">' + u.reveal.cards.map(function (c) { return card(c, 'mini'); }).join('') + '</span></div>';
      return h;
    },
    bar: function (s, seat, ctx) {
      var u = s.uno, o = s.options || {}, ui = ctx.ui();
      if (ui.wild != null && o.play.indexOf(ui.wild) < 0) ui.wild = null;
      var hand = sortHand(s.hand || []);
      var html = '<div class="dk-hand un-hand">' + hand.map(function (c) {
        var ok = o.play.indexOf(c.k) >= 0;
        return card(c, (ok ? 'ok' : 'dim') + (ui.wild === c.k ? ' picked' : ''), ' data-card="' + c.k + '" role="button" tabindex="0"');
      }).join('') + '</div><div class="bj-row">';
      if (u.over) html += '<span>Die Runde ist vorbei.</span>';
      else if (o.challenge) html += '<span>Zieh vier gegen dich. Anzweifeln? Hatte der andere noch die vorherige Farbe, zieht er vier, sonst ziehst du sechs.</span><button type="button" data-uact="accept"><b>4 ziehen</b></button><button type="button" data-uact="challenge">🤨 Anzweifeln</button>';
      else if (o.color) html += '<span>Wähl die Farbe:</span>' + colorButtons('color');
      else if (ui.wild != null) html += '<span>Welche Farbe wünschst du dir?</span>' + colorButtons('wild') + '<button type="button" data-uact="nowild">Abbrechen</button>';
      else if (u.cur === seat.i) {
        html += '<span>' + (o.keep ? (o.play.length ? 'Die gezogene Karte passt. Legen oder behalten?' : 'Behalten?') : o.play.length ? 'Du bist dran: leg eine passende Karte oder zieh.' : 'Nichts passt, du musst ziehen.') + '</span>' +
          (o.draw ? '<button type="button" data-uact="draw" title="Taste Z"><b><u>Z</u>iehen</b></button>' : '') + (o.keep ? '<button type="button" data-uact="keep" title="Taste B"><b><u>B</u>ehalten</b></button>' : '');
      } else html += '<span>' + (s.seats[u.cur] ? ctx.esc(s.seats[u.cur].name) + ' ist dran.' : 'Warten …') + '</span>';
      if (o.uno) html += '<button type="button" class="un-uno" data-uact="uno" title="Taste U">📣 <u>U</u>NO!</button>';
      return html + '</div>';
    },
    click: function (el, ctx) {
      var a = el.closest('[data-uact]'), c = el.closest('[data-card]'), ui = ctx.ui();
      if (c) { play(Number(c.dataset.card), ctx); return true; }
      if (!a) return false;
      var act = a.dataset.uact;
      if (act === 'wild') { var w = ui.wild; ui.wild = null; ctx.ctl('play', { card: w, color: a.dataset.color }); }
      else if (act === 'nowild') { ui.wild = null; ctx.redraw(); }
      else if (act === 'color') ctx.ctl('color', { color: a.dataset.color });
      else ctx.ctl(act);
      return true;
    },
    keys: function (e) {
      var k = e.key.toLowerCase(), act = k === 'z' ? 'draw' : k === 'b' ? 'keep' : k === 'u' ? 'uno' : null;
      var btn = act && document.querySelector('[data-uact=' + act + ']') || (k === 'u' && document.querySelector('[data-uact=catch]'));
      if (btn) { e.preventDefault(); btn.click(); }
    },
    sounds: function (prev, s, ctx) {
      if (s.uno && prev.uno && (s.uno.pile > prev.uno.pile || (s.hand && prev.hand && s.hand.length > prev.hand.length))) ctx.sound.play('karte');
    },
    rules: function () {
      return '<ul>' +
        '<li>Gespielt wird mit <b>108 Karten</b>: in Rot, Gelb, Grün und Blau je eine 0, zwei von 1 bis 9 und je zwei Aussetzen (⊘), Richtungswechsel (⇄) und Zieh zwei (+2), dazu vier Farbwahl- (★) und vier Zieh-vier-Karten (+4). Jeder bekommt <b>sieben Karten</b>.</li>' +
        '<li>Der Spieler links vom Geber fängt an. Auf die offene Karte passt eine Karte in <b>derselben Farbe</b> oder mit <b>derselben Zahl bzw. demselben Symbol</b>. Farbwahl und Zieh vier passen immer, mit ihnen wünschst du dir eine Farbe.</li>' +
        '<li>Kannst oder willst du nicht legen, <b>ziehst</b> du eine Karte. Passt sie, darfst du sie sofort legen, sonst ist der Nächste dran.</li>' +
        '<li><b>Aussetzen:</b> der Nächste ist nicht dran. <b>Richtungswechsel:</b> es geht andersherum weiter, zu zweit wirkt er wie Aussetzen. <b>Zieh zwei:</b> der Nächste zieht zwei und setzt aus.</li>' +
        '<li><b>Zieh vier</b> darfst du eigentlich nur legen, wenn du keine Karte in der aktuellen Farbe hast. Der Nächste kann vier ziehen (und aussetzen) oder <b>anzweifeln</b>: Hattest du die Farbe doch, ziehst du selbst vier und er spielt normal weiter; sonst zieht er sechs und setzt aus. Wer anzweifelt, sieht deine Hand.</li>' +
        '<li>Ist die erste aufgedeckte Karte eine Aktionskarte, wirkt sie auf den ersten Spieler; bei einer Farbwahl sucht er die Farbe aus, ein Zieh vier wird neu gemischt.</li>' +
        '<li><b>UNO rufen:</b> Wer seine vorletzte Karte legt, klickt auf „UNO!“ (vorher oder gleich danach). Merkt ein anderer, dass du es vergessen hast, bevor der Nächste zieht oder legt, ziehst du zwei Karten.</li>' +
        '<li>Wer zuerst keine Karten mehr hat, gewinnt die Runde und bekommt die Punkte aller Karten, die die anderen noch auf der Hand haben: Zahlen ihren Wert, Aussetzen, Richtungswechsel und Zieh zwei je 20, Farbwahl und Zieh vier je 50. Die letzte Karte darf eine Zieh-Karte sein, die Karten werden noch gezogen und mitgezählt.</li>' +
        '<li>Wer zuerst <b>500 Punkte</b> hat, gewinnt das Spiel. Am Tisch lässt sich auch eine kürzere Grenze oder nur eine Runde einstellen.</li>' +
        '<li>Bedienung: Klick auf eine Karte legt sie, bei schwarzen Karten wählst du danach die Farbe. Klick auf den Stapel oder Taste <b>Z</b> zieht, <b>B</b> behält die gezogene Karte, <b>U</b> ruft UNO oder meldet ein vergessenes UNO.</li></ul>';
    },
    stats: {
      board: [['Runden gewonnen', function (u) { return u.bonus; }], ['Beste Runde', function (u) { return u.best + ' P.'; }]],
      kpis: [['Runden gewonnen', function (m) { return m.bonus; }, function (m) { return 'von ' + m.rounds + ' gespielten'; }], ['Beste Runde', function (m) { return m.best + ' P.'; }]],
      games: [['Punkte', function (g) { return g.score; }], ['Runden gewonnen', function (g) { return g.bonus; }]],
    },
  });

  // Karte anklicken: passt sie, wird sie gelegt; schwarze Karten fragen erst nach der Farbe
  function play(k, ctx) {
    var ui = ctx.ui(), st = ctx.state();
    var o = st && st.options;
    if (!o) return;
    if (o.play.indexOf(k) < 0) { ctx.status(o.color || o.challenge ? 'Erst entscheiden, dann legen.' : st.uno.cur === ctx.seat().i ? 'Diese Karte passt nicht.' : 'Du bist nicht dran.'); return; }
    var c = (st.hand || []).filter(function (x) { return x.k === k; })[0];
    if (c && c.c === 'w') { ui.wild = ui.wild === k ? null : k; ctx.redraw(); return; }
    ctx.ctl('play', { card: k });
  }
})();
