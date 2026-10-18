'use strict';
// Pilli Pilli (Startmenü → Spiele und Apps → Kartenspiele → 🌶️ Pilli Pilli), das Stichspiel „Pili Pili“ von ATM Gaming in
// der Grundversion ohne Missionskarten: 55 Zahlenkarten (1–55) und ein Joker, jeder bekommt fünf Karten. Reihum sagt jeder,
// wie viele Stiche er macht; zusammen dürfen die Ansagen nicht genau die Zahl der Karten ergeben (der Letzte muss
// ausweichen). Dann legt jeder eine Karte, die höchste gewinnt den Stich, Farben gibt es nicht. Der Joker zählt so viel,
// wie sein Spieler beim Legen sagt (0 bis 56). Für jeden Stich daneben gibt es einen Pili (Strafpunkt); sobald jemand
// 7 Pilis hat, ist Schluss und wer die wenigsten hat, gewinnt. Tische, Plätze und Live-Stand: src/cardtable.js.
const { createGame, shuffle, rank } = require('./cardtable');

const HAND = 5;
const LIMIT = 7;                    // so viele Pilis beenden das Spiel
const TRICK_MS = 1800;              // so lange bleibt ein fertiger Stich liegen
const ROUND_MS = 8000;
const JOKER_MAX = 56;

// v: Wert, j: Joker; k macht jede Karte eindeutig (Zahlen: k = Wert, Joker: k = 0)
function newDeck() {
  const deck = [{ k: 0, v: 0, j: true }];
  for (let v = 1; v <= 55; v++) deck.push({ k: v, v });
  return shuffle(deck);
}

const T = createGame({
  id: 'pilli', prefix: 'pp', title: 'Pilli Pilli', tableWord: 'Pilli-Pilli-Tisch', minSeats: 2, maxSeats: 8, defaultSeats: 4, turn: 30,
  defaults: {},
  describe: () => `${HAND} Karten, bis ${LIMIT} Pilis`,
  start, act, drop, view, seatView,
});

const inGame = s => !!s && s.inGame;
const players = t => T.seated(t).filter(inGame);
const bidSum = t => players(t).reduce((n, s) => n + (s.bid ?? 0), 0);
// Ansage, die der Letzte nicht machen darf (oder -1)
function forbidden(t, s) {
  const open = players(t).filter(x => x.bid == null);
  if (open.length !== 1 || open[0] !== s) return -1;
  const f = HAND - bidSum(t);
  return f >= 0 && f <= HAND ? f : -1;
}

function start(t, list) {
  t.g = { deck: [], dealer: t.seats.indexOf(list[Math.floor(Math.random() * list.length)]), round: 0, phase: 'bid', cur: -1, trick: [], last: null, over: null };
  for (const s of list) Object.assign(s, { hand: [], bid: null, tricks: 0, pilis: 0, exact: 0, pen: 0 });
  T.log(t, `Spiel ${t.game}: wer zuerst ${LIMIT} Pilis hat, beendet das Spiel.`);
  startRound(t);
}

function startRound(t) {
  const g = t.g;
  g.round++;
  if (g.round > 1 || !t.seats[g.dealer]) g.dealer = T.nextIndex(t, g.dealer, inGame);
  g.deck = newDeck(); g.trick = []; g.last = null; g.over = null; g.phase = 'bid';
  for (const s of players(t)) { s.hand = g.deck.splice(0, HAND); s.bid = null; s.tricks = 0; s.pen = 0; }
  // Angesagt und ausgespielt wird ab dem Geber
  g.cur = g.dealer;
  T.log(t, `Runde ${g.round}: ${t.seats[g.dealer].name} gibt je ${HAND} Karten und sagt zuerst an.`);
  schedule(t);
}

function schedule(t) {
  const g = t.g;
  if (g.phase === 'bid') {
    T.waitFor(t, 'bid', g.cur, () => {
      const s = t.seats[g.cur];
      T.log(t, `${s.name}: Zeit abgelaufen.`);
      bid(t, s, forbidden(t, s) === 0 ? 1 : 0);
    });
  } else if (g.phase === 'play') {
    T.waitFor(t, 'play', g.cur, () => {
      const s = t.seats[g.cur];
      const low = s.hand.reduce((a, c) => (c.v < a.v ? c : a));
      T.log(t, `${s.name}: Zeit abgelaufen.`);
      play(t, s, low.k, 0);
    });
  }
}

function bid(t, s, n) {
  const g = t.g, i = t.seats.indexOf(s);
  if (g.phase !== 'bid' || g.cur !== i) return 'Du bist nicht mit Ansagen dran.';
  if (!Number.isInteger(n) || n < 0 || n > HAND) return `Sag 0 bis ${HAND} Stiche an.`;
  if (n === forbidden(t, s)) return `${n} geht nicht: Zusammen dürfen die Ansagen nicht genau ${HAND} ergeben.`;
  s.bid = n;
  T.log(t, `${s.name} sagt ${n} ${n === 1 ? 'Stich' : 'Stiche'} an.`);
  const nextSeat = T.nextIndex(t, i, x => inGame(x) && x.bid == null);
  if (nextSeat >= 0) g.cur = nextSeat;
  else {
    g.phase = 'play';
    g.cur = inGame(t.seats[g.dealer]) ? g.dealer : T.nextIndex(t, g.dealer, inGame);
    T.log(t, `Zusammen ${bidSum(t)} Stiche angesagt. ${t.seats[g.cur].name} spielt aus.`);
  }
  schedule(t);
  return null;
}

function play(t, s, k, value) {
  const g = t.g, i = t.seats.indexOf(s);
  if (g.phase !== 'play' || g.cur !== i) return 'Du bist nicht dran.';
  const c = s.hand.find(x => x.k === k);
  if (!c) return 'Diese Karte hast du nicht.';
  let v = c.v;
  if (c.j) {
    v = Number(value);
    if (!Number.isInteger(v) || v < 0 || v > JOKER_MAX) return `Sag, wie viel der Joker zählt (0 bis ${JOKER_MAX}).`;
  }
  s.hand.splice(s.hand.indexOf(c), 1);
  g.trick.push({ seat: i, name: s.name, card: c, value: v });
  T.log(t, `${s.name} legt ` + (c.j ? `den Joker als ${v}` : String(v)) + '.');
  const missing = players(t).some(x => !g.trick.some(p => p.seat === t.seats.indexOf(x)));
  if (missing) { g.cur = T.nextIndex(t, i, x => inGame(x) && !g.trick.some(p => p.seat === t.seats.indexOf(x))); schedule(t); return null; }
  // Stich voll: der höchste Wert gewinnt, bei Gleichstand die früher gelegte Karte
  const win = g.trick.reduce((a, p) => (p.value > a.value ? p : a));
  const w = t.seats[win.seat];
  if (w && w.inGame) { w.tricks++; T.log(t, `${w.name} gewinnt den Stich mit ${win.value}.`); }
  g.last = { cards: g.trick, winner: win.seat };
  g.phase = 'trick';
  T.pause(t, 'trick', TRICK_MS, () => afterTrick(t, win.seat));
  return null;
}

function afterTrick(t, winner) {
  const g = t.g;
  g.trick = [];
  if (players(t).every(s => !s.hand.length)) return endRound(t);
  g.phase = 'play';
  g.cur = inGame(t.seats[winner]) ? winner : T.nextIndex(t, winner, inGame);
  schedule(t);
}

function endRound(t) {
  const g = t.g;
  const list = players(t);
  for (const s of list) {
    s.pen = Math.abs((s.bid ?? 0) - s.tricks);
    s.pilis += s.pen;
    if (!s.pen) s.exact++;
  }
  g.phase = 'over';
  g.over = { rows: list.map(s => ({ name: s.name, user: s.username, bid: s.bid, tricks: s.tricks, pen: s.pen, pilis: s.pilis })) };
  T.log(t, `Runde ${g.round} vorbei: ` + list.map(s => `${s.name} ${s.pen ? '+' + s.pen + ' 🌶️' : 'genau getroffen'}`).join(', ') + '.');
  if (list.some(s => s.pilis >= LIMIT)) return finishGame(t);
  T.pause(t, 'round', ROUND_MS, () => startRound(t));
}

function finishGame(t) {
  const g = t.g;
  const places = rank(t.players, s => s.pilis || 0, true);
  T.finish(t, t.players.map(s => ({
    seat: s, place: places.get(s), won: places.get(s) === 1 && !s.quit, score: s.pilis || 0, bonus: s.exact || 0, rounds: g.round,
    note: `${s.pilis || 0} ${s.pilis === 1 ? 'Pili' : 'Pilis'}, ${s.exact || 0}× genau getroffen`,
  })), { last: g.over });
}

function act(t, s, a, b) {
  if (a === 'bid') return bid(t, s, Number(b.bid));
  if (a === 'play') return play(t, s, Number(b.card), b.value);
  return undefined;
}

// Aufgestanden: seine Karten sind weg, seine Ansage zählt nicht mehr; bleibt nur einer, gewinnt er
function drop(t, s, i) {
  const g = t.g;
  s.hand = [];
  if (players(t).length < 2) return finishGame(t);
  if (g.phase === 'over' || g.phase === 'trick') return;
  if (g.phase === 'bid' && g.cur === i) g.cur = T.nextIndex(t, i, x => inGame(x) && x.bid == null);
  if (g.phase === 'bid' && g.cur < 0) { g.phase = 'play'; g.cur = T.nextIndex(t, g.dealer, inGame); }
  if (g.phase === 'play') {
    // Haben jetzt alle anderen schon gelegt, ist der Stich voll
    const missing = players(t).filter(x => !g.trick.some(p => p.seat === t.seats.indexOf(x)));
    if (!missing.length && g.trick.length) {
      const win = g.trick.reduce((a, p) => (p.value > a.value ? p : a));
      const w = t.seats[win.seat];
      if (w) w.tricks++;
      g.last = { cards: g.trick, winner: win.seat };
      g.phase = 'trick';
      return T.pause(t, 'trick', TRICK_MS, () => afterTrick(t, win.seat));
    }
    if (g.cur === i) g.cur = T.nextIndex(t, i, x => inGame(x) && !g.trick.some(p => p.seat === t.seats.indexOf(x)));
  }
  schedule(t);
}

function seatView(t, s) {
  return { cards: s.hand ? s.hand.length : 0, bid: s.bid ?? null, tricks: s.tricks || 0, pilis: s.pilis || 0, exact: s.exact || 0 };
}

function view(t, me, out) {
  const g = t.g, i = me ? t.seats.indexOf(me) : -1;
  out.pp = { phase: g.phase, cur: g.cur, dealer: g.dealer, round: g.round, hand: HAND, limit: LIMIT, trick: g.trick, last: g.last, over: g.over, bids: bidSum(t) };
  if (!me) return;
  out.hand = me.hand;
  const f = forbidden(t, me);
  out.options = {
    bid: g.phase === 'bid' && g.cur === i ? Array.from({ length: HAND + 1 }, (_, n) => n).filter(n => n !== f) : [],
    play: g.phase === 'play' && g.cur === i ? me.hand.map(c => c.k) : [],
    forbidden: g.phase === 'bid' && g.cur === i ? f : -1,
  };
}

module.exports = Object.assign(T, { info: { icon: '🌶️', name: 'Pilli Pilli', script: 'pilli.js', intro: 'Das scharfe Stichspiel für 2 bis 8 Mitglieder: Sag genau an, wie viele Stiche du machst. Jeder Stich daneben bringt einen Pili. Spiele, Siege und genaue Ansagen landen in deinem Profil.' }, newDeck, HAND, LIMIT });
