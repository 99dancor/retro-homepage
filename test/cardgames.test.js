'use strict';
// UNO, Flip 7 und Pilli Pilli ohne Browser: Tische direkt bedienen, Karten vorgeben, ganze Spiele zufällig durchspielen
// und dabei prüfen, dass keine Karte verloren geht. Aufruf: node --test test/cardgames.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const uno = require('../src/uno');
const flip7 = require('../src/flip7');
const pilli = require('../src/pilli');

let nextId = 0;
function user(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  return { id, username: name + nextId, name, isAdmin: false };
}
const ok = (g, t, u, b) => assert.equal(g.control(t, u, b), null, JSON.stringify(b));
const no = (g, t, u, b, re) => assert.match(String(g.control(t, u, b)), re);
function table(g, names, opts = {}) {
  const us = names.map(user);
  const t = g.create(us[0], { name: 'Test', seats: names.length, ...opts });
  for (const u of us) ok(g, t, u, { action: 'sit' });
  for (const u of us) ok(g, t, u, { action: 'ready' });
  assert.ok(t.timer, 'Start ist geplant');
  clearTimeout(t.timer); t.timer = null;
  g._startGame(t);
  assert.equal(t.phase, 'playing');
  return { t, us };
}
// Was gerade läuft, sofort auslösen (Zeitablauf oder Pause)
function fire(t) {
  const fn = t.turn && t.turn.fn;
  assert.ok(fn, 'es wartet etwas');
  clearTimeout(t.timer); t.timer = null;
  fn();
}
const pick = a => a[Math.floor(Math.random() * a.length)];
const userAt = (t, us, i) => us.find(u => t.seats[i] && t.seats[i].userId === u.id);
// Die Ergebnisse des zuletzt beendeten Spiels an diesem Tisch
function results(game, t) { return db.prepare('SELECT * FROM (SELECT * FROM cg_results WHERE game = ? ORDER BY id DESC LIMIT ?) ORDER BY place, id').all(game, t.result.order.length); }

// ---------- UNO ----------
const unoCards = t => t.g.deck.length + t.g.pile.length + uno.seated(t).reduce((n, s) => n + (s.inGame ? s.hand.length : 0), 0);
const U = (c, v, k) => ({ k, c, v });

test('UNO: Deck, Punkte und Bedienen', () => {
  const d = uno.newDeck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map(c => c.k)).size, 108);
  assert.equal(d.filter(c => c.v === 'W4').length, 4);
  assert.equal(d.filter(c => c.c === 'r' && c.v === '0').length, 1);
  assert.equal(d.filter(c => c.c === 'b' && c.v === '7').length, 2);
  assert.equal(uno.points(U('r', '7')), 7);
  assert.equal(uno.points(U('g', 'D2')), 20);
  assert.equal(uno.points(U('w', 'W4')), 50);
  const g = { color: 'r', pile: [U('r', '5')] };
  assert.ok(uno.fits(g, U('r', '9')));
  assert.ok(uno.fits(g, U('b', '5')));
  assert.ok(!uno.fits(g, U('b', '6')));
  assert.ok(uno.fits(g, U('w', 'W')));
});

test('UNO: Aussetzen, Richtungswechsel, Zieh zwei und Farbwahl', () => {
  const { t, us } = table(uno, ['Anna', 'Bernd', 'Clara'], { target: 0 });
  const g = t.g;
  // Feste Hände, Anna ist dran, oben liegt Rot 5
  t.seats[0].hand = [U('r', 'S', 900), U('r', '1', 901), U('b', '1', 902)];
  t.seats[1].hand = [U('y', '3', 910), U('y', '4', 911)];
  t.seats[2].hand = [U('r', 'D2', 920), U('g', '2', 921), U('w', 'W', 922)];
  g.pile = [U('r', '5', 999)]; g.color = 'r'; g.cur = 0; g.dir = 1; g.challenge = null; g.choosing = false; g.drew = null;
  no(uno, t, us[1], { action: 'play', card: 910 }, /nicht dran/);
  no(uno, t, us[0], { action: 'play', card: 902 }, /passt nicht/);
  ok(uno, t, us[0], { action: 'play', card: 900 });
  assert.equal(g.cur, 2, 'Bernd setzt aus');
  ok(uno, t, us[2], { action: 'play', card: 920 });
  assert.equal(t.seats[0].hand.length, 4, 'Anna zieht zwei');
  assert.equal(g.cur, 1, 'und setzt aus');
  no(uno, t, us[1], { action: 'play', card: 910 }, /passt nicht/);
  ok(uno, t, us[1], { action: 'draw' });
  if (g.drew != null) ok(uno, t, us[1], { action: 'keep' });
  assert.equal(g.cur, 2);
  no(uno, t, us[2], { action: 'play', card: 922 }, /Farbe/);
  ok(uno, t, us[2], { action: 'play', card: 922, color: 'g' });
  assert.equal(g.color, 'g');
  assert.equal(g.catchable, 2, 'Clara hat eine Karte und kein UNO gerufen');
  ok(uno, t, us[1], { action: 'catch' });
  assert.equal(t.seats[2].hand.length, 3);
  uno.stopTimer(t);
});

test('UNO: Zieh vier anzweifeln', () => {
  const { t, us } = table(uno, ['Anna', 'Bernd']);
  const g = t.g;
  const set = () => {
    t.seats[0].hand = [U('w', 'W4', 900), U('r', '1', 901), U('b', '2', 902)];
    t.seats[1].hand = [U('y', '3', 910), U('y', '4', 911)];
    g.pile = [U('r', '5', 999)]; g.color = 'r'; g.cur = 0; g.dir = 1; g.challenge = null; g.choosing = false; g.drew = null;
  };
  set();
  ok(uno, t, us[0], { action: 'play', card: 900, color: 'y' });
  assert.deepEqual(g.challenge && [g.challenge.from, g.challenge.to], [0, 1]);
  no(uno, t, us[1], { action: 'play', card: 910 }, /nicht dran/);
  ok(uno, t, us[1], { action: 'challenge' });
  assert.equal(t.seats[0].hand.length, 6, 'Anna hatte Rot und zieht vier');
  assert.equal(g.cur, 1, 'Bernd spielt normal weiter');
  assert.equal(uno.state(t, us[1].id).uno.reveal.cards.length, 2, 'Bernd sieht Annas Hand');
  // Ohne passende Farbe: der Zweifler zieht sechs
  set();
  t.seats[0].hand = [U('w', 'W4', 900), U('b', '2', 902), U('g', '2', 903)];
  ok(uno, t, us[0], { action: 'play', card: 900, color: 'y' });
  ok(uno, t, us[1], { action: 'challenge' });
  assert.equal(t.seats[1].hand.length, 8);
  assert.equal(g.cur, 0);
  uno.stopTimer(t);
});

test('UNO: Rundenende zählt die Punkte, Spiel endet an der Grenze', () => {
  const { t, us } = table(uno, ['Anna', 'Bernd'], { target: 100 });
  const g = t.g;
  t.seats[0].hand = [U('r', '1', 900), U('r', '2', 901)];
  t.seats[1].hand = [U('w', 'W', 910), U('y', 'S', 911), U('b', '9', 912)];
  g.pile = [U('r', '5', 999)]; g.color = 'r'; g.cur = 0; g.dir = 1; g.challenge = null; g.choosing = false; g.drew = null;
  ok(uno, t, us[0], { action: 'uno' });
  ok(uno, t, us[0], { action: 'play', card: 900 });
  assert.equal(g.catchable, -1, 'UNO gerufen');
  g.cur = 0;
  ok(uno, t, us[0], { action: 'play', card: 901 });
  assert.equal(t.seats[0].score, 79);
  assert.ok(g.over);
  no(uno, t, us[1], { action: 'draw' }, /vorbei/);
  fire(t);
  assert.equal(g.round, 2);
  t.seats[0].hand = [U('r', '3', 920)];
  t.seats[1].hand = [U('w', 'W4', 930)];
  g.pile = [U('r', '5', 998)]; g.color = 'r'; g.cur = 0; g.challenge = null; g.choosing = false; g.drew = null;
  ok(uno, t, us[0], { action: 'play', card: 920 });
  assert.equal(t.phase, 'result');
  assert.deepEqual(t.result.winners, ['Anna']);
  const rows = results('uno', t);
  assert.deepEqual(rows.map(r => [r.place, r.won, r.score, r.bonus, r.rounds]), [[1, 1, 129, 2, 2], [2, 0, 0, 0, 2]]);
  assert.equal(uno.userTotals(us[0].id).wins, 1);
});

test('UNO: Zufällige ganze Spiele verlieren keine Karte', () => {
  for (let n = 0; n < 15; n++) {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, 2 + (n % 5));
    const { t, us } = table(uno, names, { target: 100 });
    let steps = 0;
    while (t.phase === 'playing') {
      assert.ok(++steps < 20000, 'Spiel endet');
      if (!t.g.over) assert.equal(unoCards(t), 108);
      if (t.turn.seat < 0 || Math.random() < 0.03) { fire(t); continue; }
      const u = userAt(t, us, t.turn.seat);
      const o = uno.state(t, u.id).options;
      if (o.catch && Math.random() < 0.5) { const c = us.find(x => x !== userAt(t, us, t.g.catchable)); ok(uno, t, c, { action: 'catch' }); continue; }
      if (o.uno && Math.random() < 0.7) ok(uno, t, u, { action: 'uno' });
      if (o.challenge) ok(uno, t, u, { action: pick(['accept', 'challenge']) });
      else if (o.color) ok(uno, t, u, { action: 'color', color: pick(uno.COLORS) });
      else if (o.play.length && Math.random() < 0.85) ok(uno, t, u, { action: 'play', card: pick(o.play), color: pick(uno.COLORS) });
      else if (o.draw) ok(uno, t, u, { action: 'draw' });
      else ok(uno, t, u, { action: 'keep' });
    }
    assert.equal(t.result.winners.length, 1);
    assert.ok(t.result.order[0].score >= 100);
    uno.remove(t);
  }
});

test('UNO: Aufstehen mitten im Spiel', () => {
  const { t, us } = table(uno, ['Anna', 'Bernd', 'Clara']);
  const cur = t.g.cur;
  ok(uno, t, userAt(t, us, cur), { action: 'leave' });
  assert.equal(t.phase, 'playing', 'zu zweit geht es weiter');
  assert.notEqual(t.g.cur, cur);
  assert.equal(unoCards(t), 108);
  ok(uno, t, userAt(t, us, t.g.cur), { action: 'leave' });
  assert.equal(t.phase, 'result');
  const last = results('uno', t);
  assert.equal(last.length, 3);
  assert.deepEqual(last.map(r => r.quit).sort(), [0, 1, 1]);
  assert.equal(last.find(r => !r.quit).won, 1, 'wer bleibt, gewinnt');
  uno.remove(t);
});

// ---------- Flip 7 ----------
const N = v => ({ k: 1000 + Math.random(), t: 'n', v });
const M = v => ({ k: 2000 + Math.random(), t: 'm', v });
const A = v => ({ k: 3000 + Math.random(), t: 'a', v });
function f7Cards(t) {
  const g = t.g;
  let n = g.deck.length + g.discard.length;
  for (const s of flip7.seated(t)) if (s.inGame) n += s.nums.length + s.mods.length + (s.sc ? 1 : 0);
  for (const f of g.stack) n += (f.card ? 1 : 0) + (f.later ? f.later.length : 0);
  return n;
}
// Stapel von oben nach unten vorgeben
const stack = (t, cards) => { t.g.deck = cards.slice().reverse(); };

test('Flip 7: Deck und Punkte', () => {
  const d = flip7.newDeck();
  assert.equal(d.length, 94);
  assert.equal(d.filter(c => c.t === 'n' && c.v === 12).length, 12);
  assert.equal(d.filter(c => c.t === 'n' && c.v === 0).length, 1);
  assert.equal(d.filter(c => c.t === 'a').length, 9);
  const p = (nums, mods, extra = {}) => flip7.roundPoints({ status: 'in', nums: nums.map(N), mods: mods.map(M), flip7: false, ...extra });
  assert.equal(p([3, 5, 12], []), 20);
  assert.equal(p([3, 5, 12], ['x2', 4]), 44);
  assert.equal(p([1, 2, 3, 4, 5, 6, 7], [], { flip7: true }), 43);
  assert.equal(p([3, 5], [], { status: 'bust' }), 0);
});

test('Flip 7: Karte, doppelt, Zweite Chance, Einfrieren und Drei ziehen', () => {
  const { t, us } = table(flip7, ['Anna', 'Bernd', 'Clara']);
  const g = t.g;
  flip7.stopTimer(t);
  // Neue Runde mit vorgegebenem Stapel: Geber Clara, also bekommen Anna, Bernd, Clara je eine Karte
  g.dealer = 2; g.round = 0; g.deck = []; g.discard = [];
  for (const s of flip7.seated(t)) Object.assign(s, { total: 0 });
  stack(t, [N(5), N(7), A('second'), N(5), N(9), A('freeze'), A('flip3'), N(1), N(2), N(2), N(4), N(8), N(10)]);
  g.round = 0; g.dealer = 2;
  // startRound zieht Geber weiter, wenn round > 1; erste Runde bleibt er
  flip7._startRound(t);
  assert.deepEqual(t.seats.slice(0, 3).map(s => s.nums.map(c => c.v)), [[5], [7], []]);
  assert.ok(t.seats[2].sc, 'Clara hat eine Zweite Chance');
  assert.equal(g.cur, 0);
  ok(flip7, t, us[0], { action: 'hit' });
  assert.equal(t.seats[0].status, 'bust', 'Anna hat die 5 doppelt');
  assert.equal(g.cur, 1);
  no(flip7, t, us[0], { action: 'hit' }, /nicht dran/);
  ok(flip7, t, us[1], { action: 'hit' });
  assert.deepEqual(t.seats[1].nums.map(c => c.v), [7, 9]);
  ok(flip7, t, us[2], { action: 'hit' });
  // Clara zieht Einfrieren und muss wählen: Bernd oder sich selbst
  assert.equal(t.turn.kind, 'target');
  no(flip7, t, us[2], { action: 'target', seat: 0 }, /nicht wählen/);
  ok(flip7, t, us[2], { action: 'target', seat: 1 });
  assert.equal(t.seats[1].status, 'frozen');
  assert.equal(g.cur, 2, 'nur Clara ist noch dabei');
  ok(flip7, t, us[2], { action: 'hit' });
  // Drei ziehen trifft automatisch Clara selbst: 1, 2, 2 → die zweite 2 frisst die Zweite Chance
  assert.deepEqual(t.seats[2].nums.map(c => c.v), [1, 2]);
  assert.equal(t.seats[2].sc, null);
  assert.equal(t.seats[2].status, 'in');
  ok(flip7, t, us[2], { action: 'stay' });
  assert.ok(g.over, 'alle fertig');
  assert.deepEqual(t.seats.slice(0, 3).map(s => s.total), [0, 16, 3]);
  flip7.stopTimer(t);
});

test('Flip 7: Flip 7 beendet die Runde und bringt 15 Punkte', () => {
  const { t, us } = table(flip7, ['Anna', 'Bernd'], { target: 100 });
  const g = t.g;
  flip7.stopTimer(t);
  g.dealer = 1; g.round = 0; g.deck = []; g.discard = [];
  stack(t, [N(1), N(12), N(2), N(3), N(4), N(5), N(6), N(7)]);
  flip7._startRound(t);
  ok(flip7, t, us[0], { action: 'hit' });
  ok(flip7, t, us[1], { action: 'stay' });
  for (let k = 0; k < 5; k++) ok(flip7, t, us[0], { action: 'hit' });
  assert.ok(t.seats[0].flip7);
  assert.ok(g.over);
  assert.equal(t.seats[0].total, 1 + 2 + 3 + 4 + 5 + 6 + 7 + 15);
  assert.equal(t.seats[1].total, 12);
  flip7.stopTimer(t);
});

test('Flip 7: Zufällige ganze Spiele verlieren keine Karte', () => {
  for (let n = 0; n < 15; n++) {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].slice(0, 2 + (n % 6));
    const { t, us } = table(flip7, names, { target: 100 });
    let steps = 0;
    while (t.phase === 'playing') {
      assert.ok(++steps < 20000, 'Spiel endet');
      if (!t.g.over) assert.equal(f7Cards(t), 94);
      if (t.turn.seat < 0 || Math.random() < 0.05) { fire(t); continue; }
      const u = userAt(t, us, t.turn.seat);
      const o = flip7.state(t, u.id).options;
      if (o.targets.length) ok(flip7, t, u, { action: 'target', seat: pick(o.targets) });
      else ok(flip7, t, u, { action: Math.random() < 0.65 ? 'hit' : 'stay' });
    }
    assert.equal(t.result.winners.length, 1);
    assert.ok(t.result.order[0].score >= 100);
    assert.ok(t.result.order[0].score > t.result.order[1].score);
    flip7.remove(t);
  }
});

// ---------- Pilli Pilli ----------
test('Pilli Pilli: Ansage, Stiche, Joker und Pilis', () => {
  const { t, us } = table(pilli, ['Anna', 'Bernd', 'Clara']);
  const g = t.g;
  assert.equal(pilli.newDeck().length, 56);
  const P = v => ({ k: v, v }), J = { k: 0, v: 0, j: true };
  g.dealer = 0; g.cur = 0;
  t.seats[0].hand = [P(50), P(10), P(3), P(4), P(5)];
  t.seats[1].hand = [P(40), P(41), P(1), P(2), J];
  t.seats[2].hand = [P(55), P(20), P(21), P(22), P(23)];
  no(pilli, t, us[1], { action: 'bid', bid: 1 }, /nicht mit Ansagen/);
  ok(pilli, t, us[0], { action: 'bid', bid: 1 });
  ok(pilli, t, us[1], { action: 'bid', bid: 2 });
  no(pilli, t, us[2], { action: 'bid', bid: 2 }, /nicht genau 5/);
  assert.deepEqual(pilli.state(t, us[2].id).options.bid, [0, 1, 3, 4, 5]);
  ok(pilli, t, us[2], { action: 'bid', bid: 3 });
  assert.equal(g.phase, 'play');
  assert.equal(g.cur, 0, 'der Geber spielt aus');
  ok(pilli, t, us[0], { action: 'play', card: 50 });
  no(pilli, t, us[1], { action: 'play', card: 0 }, /Joker/);
  ok(pilli, t, us[1], { action: 'play', card: 0, value: 56 });
  ok(pilli, t, us[2], { action: 'play', card: 55 });
  assert.equal(g.phase, 'trick');
  assert.equal(t.seats[1].tricks, 1, 'Joker als 56 gewinnt');
  fire(t);
  assert.equal(g.cur, 1, 'Bernd spielt aus');
  // Rest: Bernd 40/41 gewinnen gegen alles außer Claras 2x; einfach durchspielen
  for (const [i, k] of [[1, 40], [2, 20], [0, 10], [1, 41], [2, 21], [0, 3], [1, 1], [2, 22], [0, 4]]) {
    if (g.phase === 'trick') fire(t);
    assert.equal(g.cur, i);
    ok(pilli, t, us[i], { action: 'play', card: k });
  }
  fire(t);
  assert.equal(g.cur, 2);
  ok(pilli, t, us[2], { action: 'play', card: 23 });
  ok(pilli, t, us[0], { action: 'play', card: 5 });
  ok(pilli, t, us[1], { action: 'play', card: 2 });
  fire(t);
  assert.ok(g.over);
  assert.deepEqual(t.seats.slice(0, 3).map(s => [s.tricks, s.pen]), [[0, 1], [3, 1], [2, 1]]);
  pilli.stopTimer(t);
});

test('Pilli Pilli: Zufällige ganze Spiele enden bei 7 Pilis', () => {
  for (let n = 0; n < 15; n++) {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].slice(0, 2 + (n % 7));
    const { t, us } = table(pilli, names);
    let steps = 0;
    while (t.phase === 'playing') {
      assert.ok(++steps < 20000, 'Spiel endet');
      if (t.turn.seat < 0 || Math.random() < 0.05) { fire(t); continue; }
      const u = userAt(t, us, t.turn.seat);
      const o = pilli.state(t, u.id).options;
      if (o.bid.length) ok(pilli, t, u, { action: 'bid', bid: pick(o.bid) });
      else ok(pilli, t, u, { action: 'play', card: pick(o.play), value: Math.floor(Math.random() * 57) });
    }
    const order = t.result.order;
    assert.ok(order.some(o => o.score >= 7));
    assert.ok(order.filter(o => o.won).every(o => o.score === Math.min(...order.map(x => x.score))));
    pilli.remove(t);
  }
});

test('Pilli Pilli: Aufstehen mitten im Stich', () => {
  const { t, us } = table(pilli, ['Anna', 'Bernd', 'Clara']);
  const g = t.g;
  while (g.phase === 'bid') fire(t);
  const first = g.cur;
  ok(pilli, t, userAt(t, us, first), { action: 'play', card: t.seats[first].hand[0].k });
  const second = g.cur;
  const third = us.find(u => ![first, second].includes(t.seats.findIndex(s => s && s.userId === u.id)));
  ok(pilli, t, third, { action: 'leave' });
  ok(pilli, t, userAt(t, us, second), { action: 'play', card: t.seats[second].hand[0].k, value: 1 });
  assert.equal(g.phase, 'trick', 'Stich ist mit zwei Karten voll');
  pilli.stopTimer(t);
});
