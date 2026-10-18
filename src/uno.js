'use strict';
// UNO (Startmenü → Spiele und Apps → Kartenspiele → 🟥 UNO) nach den offiziellen Regeln von Mattel: 108 Karten, sieben
// auf die Hand, Farbe oder Zahl/Symbol bedienen, Aussetzen, Richtungswechsel, Zieh zwei, Farbwahl und Zieh vier mit
// Anzweifeln. Wer die vorletzte Karte legt, ruft „UNO“; vergisst er es und jemand merkt es, bevor der Nächste zieht oder
// legt, zieht er zwei Karten. Wer zuerst keine Karten mehr hat, bekommt die Punkte aller anderen Handkarten; gespielt
// wird bis 500 Punkte (am Tisch einstellbar, auch nur eine Runde). Tische, Plätze und Live-Stand: src/cardtable.js.
const { createGame, shuffle, rank } = require('./cardtable');

const COLORS = ['r', 'y', 'g', 'b'];
const NAMES = { r: 'Rot', y: 'Gelb', g: 'Grün', b: 'Blau' };
const TARGETS = [0, 100, 200, 300, 500];
const HAND = 7;
const ROUND_MS = 8000;              // so lange bleibt das Rundenende stehen

// ---------- Karten ----------
// c: Farbe (r/y/g/b, w = schwarz), v: 0–9, S Aussetzen, R Richtungswechsel, D2 Zieh zwei, W Farbwahl, W4 Zieh vier; k macht jede Karte eindeutig
function newDeck() {
  const deck = [];
  let k = 0;
  for (const c of COLORS) {
    deck.push({ k: k++, c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D2']) for (let n = 0; n < 2; n++) deck.push({ k: k++, c, v });
  }
  for (let n = 0; n < 4; n++) deck.push({ k: k++, c: 'w', v: 'W' }, { k: k++, c: 'w', v: 'W4' });
  return shuffle(deck);
}
const points = c => (/^\d$/.test(c.v) ? Number(c.v) : c.c === 'w' ? 50 : 20);
const LABEL = { S: 'Aussetzen', R: 'Richtungswechsel', D2: 'Zieh zwei', W: 'Farbwahl', W4: 'Zieh vier' };
const label = c => (c.c === 'w' ? LABEL[c.v] : `${NAMES[c.c]} ${LABEL[c.v] || c.v}`);
const top = g => g.pile[g.pile.length - 1];
// Bedienen: gleiche Farbe, gleiche Zahl bzw. gleiches Symbol, schwarze Karten immer
const fits = (g, c) => c.c === 'w' || c.c === g.color || c.v === top(g).v;

const T = createGame({
  id: 'uno', prefix: 'uno', title: 'UNO', tableWord: 'UNO-Tisch', minSeats: 2, maxSeats: 8, defaultSeats: 4, turn: 30,
  defaults: { target: 500 },
  options(t, b) { if (TARGETS.includes(Number(b.target))) t.opts.target = Number(b.target); },
  describe: t => (t.opts.target ? `bis ${t.opts.target} Punkte` : 'eine Runde'),
  start, act, drop, view, seatView,
});

const active = s => s.inGame;
const next = (t, i, steps = 1) => { let j = i; for (let n = 0; n < steps; n++) j = T.nextIndex(t, j, active, t.g.dir); return j; };
const playersLeft = t => T.seated(t).filter(active);

// Zieht n Karten; ist der Stapel leer, wird der Ablagestapel bis auf die oberste Karte neu gemischt
function draw(t, s, n) {
  const g = t.g, got = [];
  for (let k = 0; k < n; k++) {
    if (!g.deck.length && g.pile.length > 1) { g.deck = shuffle(g.pile.splice(0, g.pile.length - 1)); T.log(t, 'Der Ablagestapel wird neu gemischt.'); }
    if (!g.deck.length) break;
    const c = g.deck.pop();
    s.hand.push(c); got.push(c);
  }
  if (s.hand.length > 2) s.said = false;
  return got;
}

function start(t, players) {
  t.g = { deck: [], pile: [], color: null, dir: 1, cur: -1, dealer: t.seats.indexOf(players[Math.floor(Math.random() * players.length)]), round: 0,
    drew: null, catchable: -1, challenge: null, choosing: false, over: null, reveal: null };
  for (const s of players) Object.assign(s, { hand: [], score: 0, won: 0, best: 0, said: false });
  T.log(t, `Spiel ${t.game}: ` + (t.opts.target ? `gespielt wird bis ${t.opts.target} Punkte.` : 'gespielt wird eine Runde.'));
  startRound(t);
}

function startRound(t) {
  const g = t.g;
  g.round++;
  g.deck = newDeck(); g.pile = []; g.dir = 1; g.drew = null; g.catchable = -1; g.challenge = null; g.choosing = false; g.over = null; g.reveal = null;
  if (g.round > 1) g.dealer = next(t, g.dealer);
  if (!t.seats[g.dealer]) g.dealer = next(t, g.dealer);
  const players = playersLeft(t);
  for (const s of players) { s.hand = []; s.said = false; }
  for (let k = 0; k < HAND; k++) for (const s of players) s.hand.push(g.deck.pop());
  // Erste Karte aufdecken; ein Zieh vier kommt zurück in den Stapel
  let first = g.deck.pop();
  while (first.v === 'W4') { g.deck.push(first); shuffle(g.deck); first = g.deck.pop(); }
  g.pile.push(first);
  g.color = first.c === 'w' ? null : first.c;
  g.cur = next(t, g.dealer);
  const dealer = t.seats[g.dealer].name;
  let text = `Runde ${g.round}: ${dealer} gibt, aufgedeckt ist ${label(first)}.`;
  if (first.v === 'S') { text += ` ${t.seats[g.cur].name} setzt aus.`; g.cur = next(t, g.cur); }
  else if (first.v === 'R') { g.dir = -1; g.cur = g.dealer; text += ` Es geht andersherum, ${dealer} fängt an.`; }
  else if (first.v === 'D2') { draw(t, t.seats[g.cur], 2); text += ` ${t.seats[g.cur].name} zieht zwei und setzt aus.`; g.cur = next(t, g.cur); }
  else if (first.v === 'W') { g.choosing = true; text += ` ${t.seats[g.cur].name} wählt die Farbe.`; }
  T.log(t, text);
  schedule(t);
}

// Auf wen wartet der Tisch, und was passiert, wenn die Zeit abläuft?
function schedule(t) {
  const g = t.g;
  if (!g || g.over) return;
  if (g.challenge) T.waitFor(t, 'challenge', g.challenge.to, () => { T.log(t, `${t.seats[g.challenge.to].name}: Zeit abgelaufen.`); accept(t, t.seats[g.challenge.to]); });
  else if (g.choosing) T.waitFor(t, 'color', g.cur, () => chooseColor(t, t.seats[g.cur], favorite(t.seats[g.cur])));
  else {
    T.waitFor(t, 'play', g.cur, () => {
      const s = t.seats[g.cur];
      T.log(t, `${s.name}: Zeit abgelaufen.`);
      closeCatch(t, g.cur);
      if (g.drew == null) draw(t, s, 1);
      g.drew = null;
      pass(t);
    });
  }
}
// Farbe, von der jemand am meisten auf der Hand hat (für Zeitablauf)
function favorite(s) {
  const n = { r: 0, y: 0, g: 0, b: 0 };
  for (const c of s.hand) if (c.c !== 'w') n[c.c]++;
  return COLORS.reduce((a, b) => (n[b] > n[a] ? b : a));
}
function pass(t) { t.g.cur = next(t, t.g.cur); schedule(t); }
// Wer als Nächstes etwas tut, schließt das Fenster, in dem man ein vergessenes UNO melden kann
function closeCatch(t, i) { if (t.g.catchable !== i) t.g.catchable = -1; t.g.reveal = null; }

function play(t, s, k, color) {
  const g = t.g, i = t.seats.indexOf(s);
  if (g.cur !== i || g.challenge || g.choosing) return 'Du bist nicht dran.';
  const c = s.hand.find(x => x.k === k);
  if (!c) return 'Diese Karte hast du nicht.';
  if (g.drew != null && c.k !== g.drew) return 'Nach dem Ziehen darfst du nur die gezogene Karte legen.';
  if (!fits(g, c)) return `${label(c)} passt nicht auf ${label(top(g))}` + (g.color && top(g).c === 'w' ? ` (gewählt: ${NAMES[g.color]}).` : '.');
  if (c.c === 'w' && !COLORS.includes(color)) return 'Wähl eine Farbe.';
  closeCatch(t, i);
  s.hand.splice(s.hand.indexOf(c), 1);
  g.pile.push(c);
  const prevColor = g.color;
  g.color = c.c === 'w' ? color : c.c;
  g.drew = null;
  if (s.hand.length > 1) s.said = false;
  let text = `${s.name} legt ${label(c)}` + (c.c === 'w' ? ` und wünscht sich ${NAMES[color]}` : '') + '.';
  if (s.hand.length === 1) { if (s.said) text += ' UNO!'; else g.catchable = i; }
  const n = next(t, i);
  // Letzte Karte: Zieh zwei und Zieh vier wirken noch, dann ist die Runde vorbei
  if (!s.hand.length) {
    if (c.v === 'D2' || c.v === 'W4') { const m = c.v === 'D2' ? 2 : 4; draw(t, t.seats[n], m); text += ` ${t.seats[n].name} zieht noch ${m}.`; }
    T.log(t, text);
    return endRound(t, s);
  }
  if (c.v === 'S') { text += ` ${t.seats[n].name} setzt aus.`; g.cur = next(t, i, 2); }
  else if (c.v === 'R') {
    g.dir = -g.dir;
    // Zu zweit wirkt der Richtungswechsel wie Aussetzen
    g.cur = playersLeft(t).length === 2 ? i : next(t, i);
    text += ' Richtungswechsel.';
  } else if (c.v === 'D2') { draw(t, t.seats[n], 2); text += ` ${t.seats[n].name} zieht zwei und setzt aus.`; g.cur = next(t, i, 2); }
  else if (c.v === 'W4') { g.challenge = { from: i, to: n, prevColor }; g.cur = n; text += ` ${t.seats[n].name} soll vier ziehen.`; }
  else g.cur = n;
  T.log(t, text);
  schedule(t);
  return null;
}

function drawCard(t, s) {
  const g = t.g, i = t.seats.indexOf(s);
  if (g.cur !== i || g.challenge || g.choosing) return 'Du bist nicht dran.';
  if (g.drew != null) return 'Du hast schon gezogen.';
  closeCatch(t, i);
  const [c] = draw(t, s, 1);
  if (c && fits(g, c)) {
    g.drew = c.k;
    T.log(t, `${s.name} zieht eine Karte.`);
    schedule(t);
  } else {
    T.log(t, c ? `${s.name} zieht eine Karte, sie passt nicht.` : `${s.name} kann nicht ziehen, es sind keine Karten mehr da.`);
    pass(t);
  }
  return null;
}

function chooseColor(t, s, color) {
  const g = t.g;
  if (!g.choosing || g.cur !== t.seats.indexOf(s)) return 'Du wählst gerade keine Farbe.';
  if (!COLORS.includes(color)) return 'Diese Farbe gibt es nicht.';
  g.color = color; g.choosing = false;
  T.log(t, `${s.name} wählt ${NAMES[color]}.`);
  schedule(t);
  return null;
}

// Zieh vier: hinnehmen (vier ziehen, aussetzen) oder anzweifeln. Durfte der Spieler die Karte nicht legen, weil er die
// vorherige Farbe hatte, zieht er selbst vier; sonst zieht der Zweifler sechs und setzt aus.
function accept(t, s) {
  const g = t.g;
  g.challenge = null;
  draw(t, s, 4);
  T.log(t, `${s.name} zieht vier und setzt aus.`);
  g.cur = next(t, t.seats.indexOf(s));
  schedule(t);
  return null;
}
function challenge(t, s) {
  const g = t.g, ch = g.challenge, i = t.seats.indexOf(s);
  const from = t.seats[ch.from];
  g.challenge = null;
  if (!from) { T.log(t, `${s.name} zweifelt, aber der Spieler ist schon weg.`); g.cur = i; schedule(t); return null; }
  const guilty = !!ch.prevColor && from.hand.some(c => c.c === ch.prevColor);
  // Der Zweifler darf die Hand sehen
  g.reveal = { to: s.userId, name: from.name, cards: from.hand.slice() };
  if (guilty) {
    draw(t, from, 4);
    T.log(t, `${s.name} zweifelt zu Recht: ${from.name} hatte noch ${NAMES[ch.prevColor]} und zieht selbst vier.`);
    g.cur = i;
  } else {
    draw(t, s, 6);
    T.log(t, `${s.name} zweifelt zu Unrecht und zieht sechs.`);
    g.cur = next(t, i);
  }
  schedule(t);
  return null;
}

function act(t, s, a, b) {
  const g = t.g, i = t.seats.indexOf(s);
  if (g.over) return 'Die Runde ist vorbei, gleich wird neu gegeben.';
  switch (a) {
    case 'play': return play(t, s, Number(b.card), String(b.color || ''));
    case 'draw': return drawCard(t, s);
    case 'keep':
      if (g.cur !== i || g.drew == null) return 'Du hast nichts gezogen.';
      g.drew = null;
      T.log(t, `${s.name} behält die Karte.`);
      pass(t);
      return null;
    case 'color': return chooseColor(t, s, String(b.color || ''));
    case 'accept': case 'challenge':
      if (!g.challenge || g.challenge.to !== i) return 'Du sollst gerade nichts ziehen.';
      return a === 'accept' ? accept(t, s) : challenge(t, s);
    case 'uno':
      if (s.hand.length > 2 || (s.hand.length === 2 && g.cur !== i)) return 'UNO rufst du, wenn du deine vorletzte Karte legst.';
      if (s.said) return null;
      s.said = true;
      if (g.catchable === i) g.catchable = -1;
      T.log(t, `${s.name} ruft UNO!`);
      return null;
    case 'catch': {
      const o = t.seats[g.catchable];
      if (!o || o === s || o.said || o.hand.length !== 1) return 'Da gibt es nichts zu melden.';
      g.catchable = -1;
      draw(t, o, 2);
      T.log(t, `${s.name} merkt, dass ${o.name} kein UNO gerufen hat: ${o.name} zieht zwei.`);
      return null;
    }
  }
  return undefined;
}

function endRound(t, winner) {
  const g = t.g;
  T.stopTimer(t);
  const others = playersLeft(t).filter(s => s !== winner);
  const pts = others.reduce((n, s) => n + s.hand.reduce((m, c) => m + points(c), 0), 0);
  winner.score += pts; winner.won++; winner.best = Math.max(winner.best, pts);
  g.over = { winner: winner.name, user: winner.username, points: pts, hands: others.map(s => ({ name: s.name, cards: s.hand.slice(), points: s.hand.reduce((m, c) => m + points(c), 0) })) };
  g.catchable = -1; g.challenge = null; g.drew = null;
  T.log(t, `${winner.name} hat keine Karten mehr und bekommt ${pts} Punkte (jetzt ${winner.score}).`);
  if (!t.opts.target || winner.score >= t.opts.target) return finishGame(t);
  T.pause(t, 'round', ROUND_MS, () => startRound(t));
  return null;
}

function finishGame(t) {
  const g = t.g;
  const places = rank(t.players, s => s.score || 0);
  T.finish(t, t.players.map(s => ({
    seat: s, place: places.get(s), won: places.get(s) === 1 && !s.quit, score: s.score || 0, best: s.best || 0, bonus: s.won || 0, rounds: g.round,
    note: `${s.score || 0} Punkte` + (s.won ? `, ${s.won} ${s.won === 1 ? 'Runde' : 'Runden'} gewonnen` : ''),
  })), { last: g.over });
  return null;
}

// Aufgestanden: Karten zurück in den Stapel, wer dran war, gibt weiter; bleibt nur einer, gewinnt er
function drop(t, s, i) {
  const g = t.g;
  g.deck.push(...s.hand); shuffle(g.deck); s.hand = [];
  if (playersLeft(t).length < 2) return finishGame(t);
  if (g.over) return;
  if (g.catchable === i) g.catchable = -1;
  if (g.challenge && g.challenge.to === i) { g.challenge = null; g.cur = next(t, i); }
  else if (g.challenge && g.challenge.from === i) { g.challenge = null; }
  else if (g.cur === i) { g.drew = null; g.cur = next(t, i); }
  schedule(t);
}

function seatView(t, s) {
  return { cards: s.hand ? s.hand.length : 0, score: s.score || 0, won: s.won || 0, said: !!s.said };
}

function view(t, me, out) {
  const g = t.g, i = me ? t.seats.indexOf(me) : -1;
  out.uno = {
    top: top(g), color: g.color, dir: g.dir, deck: g.deck.length, pile: g.pile.length, cur: g.cur, round: g.round, dealer: g.dealer,
    challenge: g.challenge && { from: g.challenge.from, to: g.challenge.to }, choosing: g.choosing, over: g.over,
    catchable: g.catchable >= 0 && t.seats[g.catchable] && !t.seats[g.catchable].said && t.seats[g.catchable].hand.length === 1 ? g.catchable : -1,
  };
  if (!me) return;
  out.hand = me.hand;
  if (g.reveal && g.reveal.to === me.userId) out.uno.reveal = { name: g.reveal.name, cards: g.reveal.cards };
  const o = { play: [], draw: false, keep: false, color: false, challenge: false, uno: false, catch: false };
  if (!g.over) {
    if (g.challenge) o.challenge = g.challenge.to === i;
    else if (g.cur === i && g.choosing) o.color = true;
    else if (g.cur === i) {
      o.play = (g.drew != null ? me.hand.filter(c => c.k === g.drew) : me.hand).filter(c => fits(g, c)).map(c => c.k);
      o.draw = g.drew == null;
      o.keep = g.drew != null;
    }
    o.uno = !me.said && (me.hand.length === 1 || (me.hand.length === 2 && g.cur === i && !g.challenge && !g.choosing));
    o.catch = out.uno.catchable >= 0 && out.uno.catchable !== i;
  }
  out.options = o;
}

module.exports = Object.assign(T, { info: { icon: '🟥', name: 'UNO', script: 'uno.js', intro: 'Der Kartenklassiker für 2 bis 8 Mitglieder: Farbe oder Zahl bedienen, Aussetzen, Zieh zwei, Zieh vier und rechtzeitig „UNO“ rufen. Spiele, Siege und gewonnene Runden landen in deinem Profil.' }, newDeck, points, fits, COLORS, TARGETS, _startRound: startRound });
