// UNO (Startmenü → Spiele und Apps → Kartenspiele → 🟥 UNO): eigene Tischmitte (großer Ablagestapel im Ring der aktuellen
// Farbe, Pfeile für die Spielrichtung, Ziehstapel), Kartenfächer an den Plätzen, die eigene Hand mit großem UNO-Knopf und die
// Regeln samt Hausregeln. Tischliste, Plätze, Seitenleiste und Statistik kommen aus public/cardtable.js, die Regeln aus
// src/uno.js. Jede Karte trägt data-card (Farbe und Wert, ab der zweiten gleichen mit Nummer), Zieh- und Ablagestapel
// data-pile="deck" bzw. "discard"; damit kann das Fenster Karten fliegen lassen.
(function () {
  'use strict';
  var NAMES = { r: 'Rot', y: 'Gelb', g: 'Grün', b: 'Blau' };
  var SYM = { S: '⊘', R: '⇄', D2: '+2', W: '★', W4: '+4' };
  var ORDER = ['r', 'y', 'g', 'b', 'w'], VALS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D2', 'W', 'W4'];
  var TITLE = { S: 'Aussetzen', R: 'Richtungswechsel', D2: 'Zieh zwei', W: 'Farbwahl', W4: 'Zieh vier' };
  // Hausregeln wie in src/uno.js: [Schalter, offiziell an?, Name, Erklärung im Dialog, Kurzname, wenn abweichend]
  var HOUSE = [
    ['challenge', true, '„Zieh vier“ anzweifeln', 'Wer vier ziehen soll, darf anzweifeln (offiziell).', 'ohne Anzweifeln'],
    ['skipDraw', true, 'Aussetzen nach dem Ziehen', 'Wer zwei oder vier zieht, ist danach nicht dran (offiziell).', 'Ziehen ohne Aussetzen'],
    ['stack', false, 'Weiterleiten', 'Zieh zwei auf Zieh zwei, Zieh vier auf Zieh zwei oder Zieh vier legen; der Nächste zieht alles.', 'Weiterleiten'],
    ['drawUntil', false, 'Ziehen, bis es passt', 'Wer zieht, zieht so lange, bis eine Karte passt.', 'Ziehen, bis es passt'],
    ['mustPlay', false, 'Legepflicht', 'Wer eine passende Karte hat, muss legen und darf nicht ziehen.', 'Legepflicht'],
  ];
  var S = null;   // der zuletzt gezeichnete Tisch, für Regeln und Hinweise

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rule(opts, k) { var v = opts && opts[k]; return typeof v === 'boolean' ? v : HOUSE.filter(function (h) { return h[0] === k; })[0][1]; }
  function house(opts) { return HOUSE.filter(function (h) { return rule(opts, h[0]) !== h[1]; }).map(function (h) { return h[4]; }); }
  function word(n) { return { 2: 'zwei', 4: 'vier', 6: 'sechs', 8: 'acht' }[n] || String(n); }
  // Kartenname fürs Fenster: Farbe und Wert, ab der zweiten gleichen Karte mit Nummer (vom Server, sonst nur Farbe und Wert)
  function cid(c) { return c.id || c.c + c.v; }

  function card(c, extra, attrs) {
    var sym = SYM[c.v] || c.v, name = c.c === 'w' ? TITLE[c.v] : NAMES[c.c] + ' ' + (TITLE[c.v] || c.v);
    var mid = '<span>' + (c.v === 'W' ? '' : sym) + '</span>';
    return '<span class="bj-card un-card un-' + c.c + ' un-v' + c.v + (extra ? ' ' + extra : '') + '" title="' + name + '" data-card="' + esc(cid(c)) + '"' + (attrs || '') + '>' +
      '<span class="un-corner">' + sym + '</span><span class="un-oval">' + mid + '</span><span class="un-corner br">' + sym + '</span></span>';
  }
  function sortHand(h) {
    return h.slice().sort(function (a, b) { return ORDER.indexOf(a.c) - ORDER.indexOf(b.c) || VALS.indexOf(a.v) - VALS.indexOf(b.v); });
  }
  function colorButtons(act) {
    return '<span class="un-picks">' + ['r', 'y', 'g', 'b'].map(function (c) { return '<button type="button" class="un-pick un-' + c + '" data-uact="' + act + '" data-color="' + c + '">' + NAMES[c] + '</button>'; }).join('') + '</span>';
  }
  // Leicht schräg, aber bei jedem Neuzeichnen gleich: der Winkel hängt an der Karte
  function tilt(c, span) { return ((Number(c.k) * 47) % (2 * span + 1)) - span; }
  // Pfeilring um den Ablagestapel: drei Bögen mit Spitze im Uhrzeigersinn (gegen den Uhrzeigersinn gespiegelt)
  var RING = (function () {
    var h = '', R = 44, rad = Math.PI / 180;
    function p(a, r) { return (50 + r * Math.cos(a)).toFixed(2) + ' ' + (50 + r * Math.sin(a)).toFixed(2); }
    for (var k = 0; k < 3; k++) {
      var a1 = (k * 120 + 14) * rad, a2 = (k * 120 + 96) * rad;
      h += '<path d="M' + p(a1, R) + ' A' + R + ' ' + R + ' 0 0 1 ' + p(a2, R) + '"/><polygon points="' + p(a2 + 11 * rad, R) + ' ' + p(a2, R + 5.5) + ' ' + p(a2, R - 5.5) + '"/>';
    }
    return h;
  })();
  function ring(dir) {
    return '<svg class="un-ring' + (dir === 1 ? '' : ' ccw') + '" viewBox="0 0 100 100" aria-hidden="true"><g' + (dir === 1 ? '' : ' transform="translate(100 0) scale(-1 1)"') + '>' + RING + '</g></svg>';
  }
  // Fächer verdeckter Karten am Platz, mit der Zahl daneben
  function fan(n) {
    var shown = Math.min(n, 10), h = '';
    for (var k = 0; k < shown; k++) h += '<span class="bj-card back" style="--i:' + k + '"></span>';
    return '<span class="un-fan' + (n === 1 ? ' one' : '') + '" style="--n:' + Math.max(shown, 1) + '" title="' + n + (n === 1 ? ' Karte' : ' Karten') + '"><span class="un-fan-in">' + h + '</span><b class="un-num">' + n + '</b></span>';
  }

  // Sitzt der Platz ganz links oder rechts am Tisch? Dann rückt er auf dem Handy etwas zur Mitte (wie die Plätze in cardtable.js)
  function side(s, p, ctx) {
    var me = ctx.seat(), n = s.seatCount, x = Math.cos(Math.PI / 2 + ((p.i - (me ? me.i : 0) + n) % n) * 2 * Math.PI / n);
    return x < -.6 ? ' at-w' : x > .6 ? ' at-e' : '';
  }

  window.CardTable({
    id: 'uno',
    tableWord: 'UNO-Tisch',
    motto: 'UNO · 108 KARTEN',
    blurb: 'UNO nach den offiziellen Regeln, 2 bis 8 Spieler, bis 500 Punkte oder eine Runde. Hausregeln wie Weiterleiten stellt der Gastgeber ein.',
    defaults: { target: 500, challenge: true, skipDraw: true, stack: false, drawUntil: false, mustPlay: false },
    options: function (o) {
      return '<label>Gespielt wird:<select name="target" class="w100">' + [[500, 'bis 500 Punkte (offiziell)'], [300, 'bis 300 Punkte'], [200, 'bis 200 Punkte'], [100, 'bis 100 Punkte'], [0, 'nur eine Runde']].map(function (x) {
        return '<option value="' + x[0] + '"' + (Number(o.target) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
      }).join('') + '</select></label>' +
        '<fieldset class="groupbox un-rules"><legend>Hausregeln</legend>' + HOUSE.map(function (h) {
          return '<label class="inline"><input type="checkbox" name="' + h[0] + '"' + (rule(o, h[0]) ? ' checked' : '') + '><span><b>' + h[2] + '</b><small>' + h[3] + '</small></span></label>';
        }).join('') + '</fieldset>';
    },
    read: function (field) {
      var out = { target: Number(field('target')) };
      HOUSE.forEach(function (h) { out[h[0]] = !!field(h[0]); });
      return out;
    },
    tags: function (s) {
      S = s;
      var u = s.uno;
      return '<span class="tag">' + (s.opts.target ? 'bis ' + s.opts.target + ' Punkte' : 'eine Runde') + '</span>' + house(s.opts).map(function (x) { return '<span class="tag">' + x + '</span>'; }).join('') +
        (u ? '<span class="tag">Runde ' + u.round + '</span><span class="tag">' + (u.dir === 1 ? '↻ im Uhrzeigersinn' : '↺ gegen den Uhrzeigersinn') + '</span>' : '');
    },
    turnText: function (kind) {
      var p = S && S.uno && S.uno.pend;
      return kind === 'color' ? 'wählt Farbe' : kind === 'challenge' ? 'soll 4 ziehen' : kind === 'take' ? 'soll ' + (p ? p.n : '') + ' ziehen' : '';
    },
    seat: function (s, p, ctx) {
      var u = s.uno;
      return {
        hole: ctx.mine(p) ? '' : fan(p.cards),
        line: p.cards + (p.cards === 1 ? ' Karte' : ' Karten') + ' · ' + p.score + ' P.',
        badge: p.cards === 1 ? (p.said ? '<span class="bj-badge win un-said">UNO!</span>' : '<span class="bj-badge un-last">1 Karte</span>') : '',
        dealer: !!u && u.dealer === p.i,
        cls: 'un-seat' + side(s, p, ctx) + (u && u.pend && u.pend.to === p.i ? ' un-hit' : ''),
      };
    },
    score: function (p) { return p.score + ' P.'; },
    sideRows: function (s, seat) { return '<tr><td>Punkte</td><td class="num">' + seat.score + '</td></tr><tr><td>Runden gewonnen</td><td class="num">' + seat.won + '</td></tr>'; },
    center: function (s, ctx) {
      var u = s.uno, o = s.options || {}, cur = s.seats[u.cur];
      if (u.over) {
        var r = u.over;
        return '<div class="un-over"><div class="un-over-head">🎉 ' + ctx.esc(r.winner) + ' hat keine Karten mehr</div><div class="un-over-pts">+' + r.points + ' Punkte</div>' +
          (r.hands.length ? '<div class="un-over-hands">' + r.hands.map(function (h) {
            return '<div><span class="un-over-name">' + ctx.esc(h.name) + '</span><span class="un-mini">' + h.cards.map(function (c) { return card(c, 'mini'); }).join('') + '</span><b>' + h.points + ' P.</b></div>';
          }).join('') + '</div>' : '') + '<div class="un-over-next">' + (ctx.next ? ctx.next(s) : 'Gleich geht es weiter …') + '</div></div>';
      }
      var p = u.pend, canDraw = o.draw || o.take;
      var recent = (u.recent && u.recent.length ? u.recent : [u.top]).slice(-3);
      var pile = recent.map(function (c, k) {
        var last = k === recent.length - 1;
        return card(c, last ? 'top' : 'under', ' style="--r:' + tilt(c, last ? 6 : 16) + 'deg"');
      }).join('');
      var backs = '';
      for (var k = 0; k < Math.min(3, Math.max(1, Math.ceil(u.deck / 30))); k++) backs += '<span class="bj-card back" style="--i:' + k + '"></span>';
      var h = '<div class="un-table un-c-' + (u.color || 'w') + '">' +
        '<div class="un-deck' + (canDraw ? ' ok' : '') + '" data-pile="deck"' + (canDraw ? ' data-uact="draw" role="button" tabindex="0" title="' + (o.take ? p.n + ' Karten ziehen' : 'Karte ziehen') + ' (Taste Z)"' : '') + '>' +
          '<span class="un-backs">' + backs + '</span><b class="un-count">' + u.deck + '</b>' + (canDraw ? '<span class="un-cta">' + (o.take ? p.n + ' ziehen' : 'Ziehen') + '</span>' : '') + '</div>' +
        '<div class="un-disc"><span class="un-glow"></span>' + ring(u.dir) + '<span class="un-pile" data-pile="discard">' + pile + '</span>' +
          (p ? '<b class="un-plus" title="' + ctx.name(s, p.to) + ' soll ' + p.n + ' Karten ziehen">+' + p.n + '</b>' : '') + '</div>' +
        '<div class="un-colour"><span class="un-dot un-' + (u.color || 'w') + '"></span><b>' + (u.color ? NAMES[u.color] : 'Farbe?') + '</b><small>' + (u.dir === 1 ? '↻ im Uhrzeigersinn' : '↺ andersherum') + '</small></div>' +
        '</div>';
      var line;
      if (p) {
        var ways = [word(p.n) + ' ziehen'].concat(p.doubt ? ['anzweifeln'] : [], rule(s.opts, 'stack') ? ['weiterleiten'] : []);
        line = ctx.name(s, p.to) + ' soll ' + (ways.length > 1 ? ways.slice(0, -1).join(', ') + ' oder ' + ways[ways.length - 1] : ways[0]) + ' …';
      } else if (u.choosing) line = (cur ? ctx.esc(cur.name) : '–') + ' wählt die Farbe …';
      else line = (cur ? ctx.esc(cur.name) : '–') + ' ist dran.';
      h += '<div class="pk-pot un-status' + (p ? ' hit' : '') + '">' + line + '</div>';
      if (o.catch) h += '<button type="button" class="un-catch" data-uact="catch" title="Taste U">🚨 ' + ctx.name(s, u.catchable) + ' hat kein UNO gerufen!</button>';
      if (u.reveal) h += '<div class="un-reveal"><small>Hand von ' + ctx.esc(u.reveal.name) + ':</small> <span class="un-mini">' + u.reveal.cards.map(function (c) { return card(c, 'mini'); }).join('') + '</span></div>';
      var hr = house(s.opts);
      if (hr.length) h += '<div class="un-houseline" title="Hausregeln an diesem Tisch">🏠 ' + hr.join(' · ') + '</div>';
      return h;
    },
    bar: function (s, seat, ctx) {
      var u = s.uno, o = s.options || {}, ui = ctx.ui(), p = u.pend;
      if (ui.wild != null && o.play.indexOf(ui.wild) < 0) ui.wild = null;
      var hand = sortHand(s.hand || []), mine = !u.over && (o.take || o.color || u.cur === seat.i);
      var cards = hand.map(function (c) {
        var ok = o.play.indexOf(c.k) >= 0;
        return card(c, (ok ? 'ok' : mine ? 'dim' : '') + (ui.wild === c.k ? ' picked' : ''), ' data-k="' + c.k + '" role="button" tabindex="0"');
      }).join('');
      var row = '';
      if (u.over) row = '<span>Die Runde ist vorbei.</span>';
      else if (ui.wild != null) row = '<span>Welche Farbe wünschst du dir?</span>' + colorButtons('wild') + '<button type="button" data-uact="nowild">Abbrechen</button>';
      else if (o.take) {
        var what = p.v === 'W4' ? '„Zieh vier“' : '„Zieh zwei“';
        row = '<span>' + (p.n > (p.v === 'W4' ? 4 : 2) ? 'Weitergeleitet: ' : what + ' gegen dich: ') + '<b>' + p.n + ' Karten</b>.' +
          (o.play.length ? ' Leg eine Zieh-Karte zum Weiterleiten oder zieh.' : o.challenge ? ' <small>Falsch angezweifelt: sechs.</small>' : '') + '</span>' +
          '<button type="button" class="def" data-uact="accept" title="Taste Z"><b>' + p.n + ' <u>z</u>iehen</b></button>' +
          (o.challenge ? '<button type="button" data-uact="challenge" title="Taste A">🤨 <u>A</u>nzweifeln</button>' : '');
      } else if (o.color) row = '<span>Wähl die Farbe:</span>' + colorButtons('color');
      else if (u.cur === seat.i) {
        row = '<span>' + (o.keep ? 'Die gezogene Karte passt. Legen oder behalten?' : !o.play.length ? 'Nichts passt, du musst ziehen.' : o.draw ? 'Du bist dran: leg eine Karte oder zieh.' :
          rule(s.opts, 'mustPlay') ? 'Legepflicht: leg eine passende Karte.' : 'Leg eine passende Karte.') + '</span>' +
          (o.draw ? '<button type="button"' + (o.play.length ? '' : ' class="def"') + ' data-uact="draw" title="Taste Z"><b><u>Z</u>iehen</b></button>' : '') +
          (o.keep ? '<button type="button" class="def" data-uact="keep" title="Taste B"><b><u>B</u>ehalten</b></button>' : '');
      } else row = '<span>' + (p ? ctx.name(s, p.to) + ' soll ' + p.n + ' Karten ziehen …' : s.seats[u.cur] ? ctx.esc(s.seats[u.cur].name) + ' ist dran.' : 'Warten …') + '</span>';
      var unoBtn = u.over ? '' : '<button type="button" class="un-uno' + (o.uno ? ' go' : '') + '" data-uact="uno"' + (o.uno ? ' title="Jetzt UNO rufen (Taste U)"' : ' disabled title="UNO rufst du, wenn du deine vorletzte Karte legst"') + '><span>UNO!</span></button>';
      return '<div class="un-dock"><div class="un-dock-main"><div class="dk-hand un-hand" style="--n:' + hand.length + '">' + cards + '</div><div class="bj-row">' + row + '</div></div>' + unoBtn + '</div>';
    },
    click: function (el, ctx) {
      var a = el.closest('[data-uact]'), c = el.closest('[data-k]'), ui = ctx.ui();
      if (c) { play(Number(c.dataset.k), ctx); return true; }
      if (!a) return false;
      var act = a.dataset.uact;
      if (a.disabled) return true;
      if (act === 'wild') { var w = ui.wild; ui.wild = null; ctx.ctl('play', { card: w, color: a.dataset.color }); }
      else if (act === 'nowild') { ui.wild = null; ctx.redraw(); }
      else if (act === 'color') ctx.ctl('color', { color: a.dataset.color });
      else ctx.ctl(act);
      return true;
    },
    keys: function (e) {
      var k = e.key.toLowerCase(), act = k === 'z' ? 'draw' : k === 'b' ? 'keep' : k === 'u' ? 'uno' : k === 'a' ? 'challenge' : null;
      var btn = act && document.querySelector('.cg-uno [data-uact=' + act + ']:not([disabled])') ||
        (k === 'z' && document.querySelector('.cg-uno [data-uact=accept]')) || (k === 'u' && document.querySelector('.cg-uno [data-uact=catch]'));
      if (btn) { e.preventDefault(); btn.click(); }
    },
    sounds: function (prev, s, ctx) {
      if (s.uno && prev.uno && (s.uno.pile > prev.uno.pile || (s.hand && prev.hand && s.hand.length > prev.hand.length))) ctx.sound.play('karte');
    },
    rules: function () {
      var opts = S && S.opts, on = function (k) { return rule(opts, k) ? '<b>an</b>' : 'aus'; };
      return '<ul>' +
        '<li>Gespielt wird mit <b>108 Karten</b>: in Rot, Gelb, Grün und Blau je eine 0, zwei von 1 bis 9 und je zwei Aussetzen (⊘), Richtungswechsel (⇄) und Zieh zwei (+2), dazu vier Farbwahl- (★) und vier Zieh-vier-Karten (+4). Jeder bekommt <b>sieben Karten</b>.</li>' +
        '<li>Der Spieler links vom Geber fängt an. Auf die offene Karte passt eine Karte in <b>derselben Farbe</b> oder mit <b>derselben Zahl bzw. demselben Symbol</b>. Farbwahl und Zieh vier passen immer, mit ihnen wünschst du dir eine Farbe.</li>' +
        '<li>Kannst oder willst du nicht legen, <b>ziehst</b> du eine Karte. Passt sie, darfst du sie sofort legen, sonst ist der Nächste dran.</li>' +
        '<li><b>Aussetzen:</b> der Nächste ist nicht dran. <b>Richtungswechsel:</b> es geht andersherum weiter, zu zweit wirkt er wie Aussetzen. <b>Zieh zwei:</b> der Nächste zieht zwei und setzt aus.</li>' +
        '<li><b>Zieh vier</b> darfst du eigentlich nur legen, wenn du keine Karte in der aktuellen Farbe hast. Der Nächste kann vier ziehen (und aussetzen) oder <b>anzweifeln</b>: Hattest du die Farbe doch, ziehst du selbst vier und er spielt normal weiter; sonst zieht er sechs und setzt aus. Wer anzweifelt, sieht deine Hand.</li>' +
        '<li>Ist die erste aufgedeckte Karte eine Aktionskarte, wirkt sie auf den ersten Spieler; bei einer Farbwahl sucht er die Farbe aus, ein Zieh vier wird neu gemischt.</li>' +
        '<li><b>UNO rufen:</b> Wer seine vorletzte Karte legt, klickt auf den roten Knopf „UNO!“ (vorher oder gleich danach). Merkt ein anderer, dass du es vergessen hast, bevor der Nächste zieht oder legt, ziehst du zwei Karten.</li>' +
        '<li>Wer zuerst keine Karten mehr hat, gewinnt die Runde und bekommt die Punkte aller Karten, die die anderen noch auf der Hand haben: Zahlen ihren Wert, Aussetzen, Richtungswechsel und Zieh zwei je 20, Farbwahl und Zieh vier je 50. Die letzte Karte darf eine Zieh-Karte sein, die Karten werden noch gezogen und mitgezählt.</li>' +
        '<li>Wer zuerst <b>500 Punkte</b> hat, gewinnt das Spiel. Am Tisch lässt sich auch eine kürzere Grenze oder nur eine Runde einstellen.</li></ul>' +
        '<h3>Hausregeln</h3><p>Der Gastgeber schaltet sie unter ⚙️ Tisch-Einstellungen an oder aus; sie gelten ab dem nächsten Spiel. Voreingestellt ist das offizielle UNO.' + (opts ? ' An diesem Tisch: ' + (house(opts).length ? '<b>' + house(opts).join(', ') + '</b>.' : 'alles offiziell.') : '') + '</p><ul>' +
        '<li><b>„Zieh vier“ anzweifeln</b> (offiziell an' + (opts ? ', hier ' + on('challenge') : '') + '): wie oben. Ist es aus, zieht man vier ohne Nachfrage.</li>' +
        '<li><b>Aussetzen nach dem Ziehen</b> (offiziell an' + (opts ? ', hier ' + on('skipDraw') : '') + '): Wer zwei, vier oder sechs Strafkarten zieht, ist danach nicht dran. Ist es aus, zieht er und spielt dann ganz normal.</li>' +
        '<li><b>Weiterleiten</b> (offiziell aus' + (opts ? ', hier ' + on('stack') : '') + '): Wer ziehen soll, darf stattdessen auf ein Zieh zwei ein <b>Zieh zwei</b> oder ein <b>Zieh vier</b> legen, auf ein Zieh vier nur ein <b>Zieh vier</b>. Ein Zieh zwei auf ein Zieh vier geht nicht. Die Karten zählen zusammen, der Nächste muss die ganze Summe ziehen oder selbst weiterleiten. Anzweifeln lässt sich nur ein Zieh vier, das eine Kette anfängt; wer zu Unrecht zweifelt, zieht dann sechs. Klick auf „N ziehen“ oder den Stapel nimmt alle Karten.</li>' +
        '<li><b>Ziehen, bis es passt</b> (offiziell aus' + (opts ? ', hier ' + on('drawUntil') : '') + '): Wer zieht, zieht so lange, bis eine passende Karte kommt, und darf sie dann legen oder behalten. Strafkarten zählen nicht dazu.</li>' +
        '<li><b>Legepflicht</b> (offiziell aus' + (opts ? ', hier ' + on('mustPlay') : '') + '): Wer eine passende Karte hat, muss legen. Ziehen geht nur, wenn nichts passt, und eine passende gezogene Karte wird gelegt.</li></ul>' +
        '<h3>Bedienung</h3><ul><li>Klick auf eine Karte legt sie, bei schwarzen Karten wählst du danach die Farbe. Klick auf den Stapel oder Taste <b>Z</b> zieht (auch die Strafkarten), <b>B</b> behält die gezogene Karte, <b>A</b> zweifelt an, <b>U</b> ruft UNO oder meldet ein vergessenes UNO.</li></ul>';
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
    if (o.play.indexOf(k) < 0) {
      var p = st.uno.pend;
      ctx.status(o.take ? (o.play.length || rule(st.opts, 'stack') ? 'Weiterleiten geht nur mit ' + (p.v === 'D2' ? 'Zieh zwei oder Zieh vier.' : 'Zieh vier.') : 'Erst ' + p.n + ' Karten ziehen' + (o.challenge ? ' oder anzweifeln.' : '.')) :
        o.color ? 'Erst die Farbe wählen.' : st.uno.cur === ctx.seat().i ? 'Diese Karte passt nicht.' : 'Du bist nicht dran.');
      return;
    }
    var c = (st.hand || []).filter(function (x) { return x.k === k; })[0];
    if (c && c.c === 'w') { ui.wild = ui.wild === k ? null : k; ctx.redraw(); return; }
    ctx.ctl('play', { card: k });
  }
})();
