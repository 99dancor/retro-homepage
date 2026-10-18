'use strict';
// Durak-Regeln ohne Browser: Tisch direkt bedienen, Hände und Stapel vorgeben, ganze Spiele zufällig durchspielen.
// Aufruf: node --test test/durak.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const dk = require('../src/durak');

let nextId = 0;
function user(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  return { id, username: name + nextId, name, isAdmin: false };
}
const c = s => ({ r: s.slice(0, -1), s: s.slice(-1) });
const cs = str => (str ? str.split(' ').map(c) : []);
const seat = (t, u) => t.seats.find(s => s && s.userId === u.id);
const ok = (t, u, b) => assert.equal(dk.control(t, u, b), null, JSON.stringify(b));
const no = (t, u, b, re) => assert.match(String(dk.control(t, u, b)), re);
// Ein Angriff ist vorbei: nicht auf den Timer warten
function flush(t) {
  if (t.turn && t.turn.kind === 'end') { clearTimeout(t.timer); t.timer = null; dk._endBout(t); }
}
function table(names, seats) {
  const us = names.map(user);
  const t = dk.create(us[0], { name: 'Test', seats: seats || names.length });
  for (const u of us) ok(t, u, { action: 'sit' });
  return { t, us };
}
function start(t, us) {
  for (const u of us) ok(t, u, { action: 'ready' });
  assert.ok(t.timer, 'Start ist geplant');
  clearTimeout(t.timer); t.timer = null;
  dk._startGame(t);
  assert.equal(t.phase, 'playing');
}
// Hände und Stapel vorgeben, dann einen Angriff von Platz attacker aus beginnen
function rig(t, hands, { trump = '♠', deck = '', attacker = 0, bouts = 1 } = {}) {
  hands.forEach((h, i) => { if (t.seats[i]) t.seats[i].hand = cs(h); });
  t.deck = cs(deck);
  t.trump = t.deck[0] || c('6' + trump);
  t.bouts = bouts;
  dk._startBout(t, attacker);
}
const total = t => t.seats.reduce((n, s) => n + (s ? s.hand.length : 0), 0) + t.deck.length + t.discard + t.table.reduce((n, p) => n + (p.d ? 2 : 1), 0);

test('Schlagen: höher in derselben Farbe oder Trumpf', () => {
  const b = (a, d) => dk.beats(c(a), c(d), '♠');
  assert.ok(b('7♥', '9♥'));
  assert.ok(!b('9♥', '7♥'));
  assert.ok(!b('9♥', 'A♦'), 'andere Farbe schlägt nicht');
  assert.ok(b('A♥', '6♠'), 'Trumpf schlägt alles andere');
  assert.ok(b('6♠', '7♠'));
  assert.ok(!b('7♠', 'A♥'), 'Trumpf nur mit höherem Trumpf');
  assert.equal(dk.newDeck().length, 36);
  assert.equal(new Set(dk.newDeck().map(x => x.r + x.s)).size, 36);
});

test('Geben: sechs Karten, Trumpf unten, niedrigster Trumpf fängt an, fremde Karten bleiben verdeckt', () => {
  const { t, us } = table(['Anna', 'Bernd', 'Cem']);
  start(t, us);
  for (const u of us) assert.equal(seat(t, u).hand.length, 6);
  assert.equal(t.deck.length, 36 - 18);
  assert.equal(t.deck[0], t.trump);
  const low = Math.min(...t.seats.filter(Boolean).flatMap(s => s.hand.filter(x => x.s === t.trump.s).map(x => dk.RANKS.indexOf(x.r))));
  if (Number.isFinite(low)) assert.ok(t.seats[t.attacker].hand.some(x => x.s === t.trump.s && dk.RANKS.indexOf(x.r) === low));
  assert.equal(t.defender, (t.attacker + 1) % 3);
  const st = dk.state(t, us[0].id);
  assert.equal(st.hand.length, 6);
  assert.ok(!('hand' in st.seats[1]), 'nur die Anzahl der fremden Karten');
  assert.equal(st.seats[1].cards, 6);
  assert.equal(dk.state(t, user('Zuschauer').id).hand, undefined);
  dk.remove(t);
});

test('Zuwerfen nur mit liegenden Werten, Abwehr, Fertig, Nachziehen, Verteidiger greift an', () => {
  const { t, us } = table(['Anna', 'Bernd', 'Cem']);
  const [a, b, x] = us;
  start(t, us);
  rig(t, ['7♥ 8♦ 9♣ J♥ K♦ A♣', '8♥ 9♥ 10♦ 7♠ Q♣ K♣', '7♦ 7♣ 6♥ 6♦ 10♥ Q♥'], { deck: '6♠ A♥ A♦ Q♦ J♦', trump: '♠' });
  assert.equal(t.limit, 6);
  no(t, x, { action: 'attack', card: '7♦' }, /fängt den Angriff an/);
  no(t, b, { action: 'attack', card: '8♥' }, /verteidigst/);
  ok(t, a, { action: 'attack', card: '7♥' });
  no(t, x, { action: 'attack', card: '6♥' }, /Wert, der schon auf dem Tisch liegt/);
  ok(t, x, { action: 'attack', card: '7♦' });
  no(t, b, { action: 'defend', card: '9♥', target: 1 }, /schlägt 7♦ nicht/);
  ok(t, b, { action: 'defend', card: '8♥', target: 0 });
  ok(t, b, { action: 'defend', card: '10♦', target: 1 });
  // 8 liegt jetzt auch: Anna darf 8♦ zuwerfen
  ok(t, a, { action: 'attack', card: '8♦' });
  no(t, a, { action: 'pass' }, /Warte/);
  ok(t, b, { action: 'defend', card: '7♠' });
  assert.equal(t.turn.kind, 'pass');
  ok(t, a, { action: 'pass' });
  // Cem hat noch 7♣ und muss sich entscheiden; danach ist der Angriff vorbei
  assert.deepEqual(dk.state(t, a.id).waiting, [2]);
  ok(t, x, { action: 'pass' });
  assert.equal(t.turn.kind, 'end');
  flush(t);
  assert.equal(t.discard, 6);
  assert.equal(seat(t, a).hand.length, 6);
  assert.equal(seat(t, x).hand.length, 6);
  assert.equal(seat(t, b).hand.length, 3 + 2, 'Verteidiger zieht zuletzt, was übrig ist');
  assert.equal(t.deck.length, 0);
  assert.equal(t.attacker, 1, 'wer abgewehrt hat, greift an');
  assert.equal(t.defender, 2);
  assert.equal(total(t), 6 * 3 + 5);
  dk.remove(t);
});

test('Nehmen: andere werfen noch zu, Limit, dann greift der Nächste an', () => {
  const { t, us } = table(['Anna', 'Bernd', 'Cem']);
  const [a, b, x] = us;
  start(t, us);
  // Erster Angriff des Spiels: höchstens 5 Karten, und nie mehr als der Verteidiger hat (hier 3)
  rig(t, ['9♥ 9♦ 9♣ 6♦', '6♥ 7♥ 8♥', '9♠ 10♣ 6♣'], { deck: '', trump: '♠', bouts: 0 });
  assert.equal(t.limit, 3);
  ok(t, a, { action: 'attack', card: '9♥' });
  ok(t, b, { action: 'take' });
  assert.equal(dk.state(t, b.id).options.take, false);
  no(t, b, { action: 'defend', card: '6♥' }, /schon genommen/);
  ok(t, x, { action: 'attack', card: '9♠' });
  ok(t, a, { action: 'attack', card: '9♦' });
  no(t, a, { action: 'attack', card: '9♣' }, /Mehr als 3 Karten/);
  // Niemand kann mehr etwas legen: Angriff vorbei, ohne dass jemand „Fertig“ klickt
  assert.equal(t.turn.kind, 'end');
  flush(t);
  assert.equal(seat(t, b).hand.length, 6);
  assert.equal(t.attacker, 2, 'nach dem Nehmen greift der Spieler links vom Verteidiger an');
  assert.equal(t.defender, 0);
  dk.remove(t);
});

test('Spielende: wer zuerst raus ist, gewinnt; wer übrig bleibt, ist Durak und wird im nächsten Spiel angegriffen', () => {
  const { t, us } = table(['Anna', 'Bernd']);
  const [a, b] = us;
  start(t, us);
  rig(t, ['A♥', '6♥ 7♣'], { trump: '♠' });
  ok(t, a, { action: 'attack', card: 'A♥' });
  ok(t, b, { action: 'take' });
  assert.equal(t.turn.kind, 'end');
  flush(t);
  assert.equal(t.phase, 'result');
  assert.equal(t.result.durak, 'Bernd');
  assert.deepEqual(t.result.order.map(o => [o.name, o.place, o.durak]), [['Anna', 1, false], ['Bernd', 2, true]]);
  const totals = u => { const r = dk.userTotals(u.id); return [r.games, r.wins, r.duraks]; };
  assert.deepEqual(totals(a), [1, 1, 0]);
  assert.deepEqual(totals(b), [1, 0, 1]);
  assert.equal(seat(t, a).ready, false, 'nach dem Spiel muss man wieder bereit sein');
  start(t, us);
  assert.equal(t.defender, t.seats.indexOf(seat(t, b)), 'der Durak wird zuerst angegriffen');
  // Mitten im Spiel aufstehen: Spiel vorbei, wer geht, ist Durak
  ok(t, a, { action: 'leave' });
  assert.equal(t.phase, 'result');
  assert.equal(t.result.durak, 'Anna');
  assert.ok(t.result.quit);
  assert.equal(dk.userTotals(a.id).quits, 1);
  assert.equal(dk.userTotals(b.id).wins, 1);
  assert.equal(seat(t, a), undefined);
  const board = dk.leaderboard().filter(u => [a.id, b.id].includes(u.id));
  assert.deepEqual(board.map(u => [u.games, u.wins, u.duraks]), [[2, 1, 1], [2, 1, 1]]);
  dk.remove(t);
});

test('Unentschieden: die Letzten werden im selben Angriff fertig', () => {
  const { t, us } = table(['Anna', 'Bernd']);
  const [a, b] = us;
  start(t, us);
  rig(t, ['7♥', '8♥'], { trump: '♠' });
  ok(t, a, { action: 'attack', card: '7♥' });
  ok(t, b, { action: 'defend', card: '8♥' });
  flush(t);
  assert.equal(t.phase, 'result');
  assert.equal(t.result.durak, null);
  assert.deepEqual(t.result.order.map(o => o.place), [1, 1]);
  dk.remove(t);
});

test('Zeit abgelaufen: Angreifer legt die kleinste Karte, Verteidiger nimmt', async () => {
  const { t, us } = table(['Anna', 'Bernd']);
  start(t, us);
  rig(t, ['K♥ 6♠ 8♦', 'A♣ 9♣'], { trump: '♠', deck: '7♠ 7♣ 8♣ 10♣ J♣ Q♣ K♣ 7♦ 9♦ 10♦' });
  // Niemand hat ein Fenster offen: drei Sekunden pro Zug
  assert.ok(t.turn.deadline - Date.now() <= 3000);
  await new Promise(r => setTimeout(r, 3100));
  assert.deepEqual(t.table.map(p => p.a.r + p.a.s), ['8♦'], 'kleinste Nicht-Trumpf-Karte');
  await new Promise(r => setTimeout(r, 3100));
  assert.ok(t.taking, 'Verteidiger nimmt');
  dk.remove(t);
});

test('Zufällige Spiele zu zweit bis zu sechst laufen sauber durch', () => {
  for (let n = 2; n <= 6; n++) {
    const { t, us } = table(Array.from({ length: n }, (_, i) => 'P' + i));
    const users = new Map(us.map(u => [u.id, u]));
    start(t, us);
    let steps = 0;
    while (t.phase === 'playing') {
      assert.ok(++steps < 5000, 'Spiel endet');
      assert.equal(total(t), 36, 'keine Karte geht verloren');
      if (t.turn.kind === 'end') { flush(t); continue; }
      const d = t.seats[t.defender];
      if (t.turn.kind === 'open') {
        const s = t.seats[t.attacker];
        ok(t, users.get(s.userId), { action: 'attack', card: dk.state(t, s.userId).options.attack[0] });
      } else if (t.turn.kind === 'defend') {
        const o = dk.state(t, d.userId).options;
        const k = Object.keys(o.defend)[0];
        // Meistens schlagen, manchmal nehmen
        if (k && Math.random() < 0.8) ok(t, users.get(d.userId), { action: 'defend', card: k, target: o.defend[k][0] });
        else ok(t, users.get(d.userId), { action: 'take' });
        // Andere werfen manchmal schon zu, während er verteidigt
        const thrower = t.phase === 'playing' && t.seats.find(s => s && s !== t.seats[t.defender] && s.inGame && !s.place && dk.state(t, s.userId).options.attack.length);
        if (thrower && Math.random() < 0.3) ok(t, users.get(thrower.userId), { action: 'attack', card: dk.state(t, thrower.userId).options.attack[0] });
      } else {
        const idx = dk.state(t, us[0].id).waiting;
        assert.ok(idx.length, 'beim Zuwerfen wartet der Tisch auf jemanden');
        const s = t.seats[idx[0]], o = dk.state(t, s.userId).options;
        if (o.attack.length && Math.random() < 0.5) ok(t, users.get(s.userId), { action: 'attack', card: o.attack[0] });
        else ok(t, users.get(s.userId), { action: 'pass' });
      }
    }
    assert.equal(t.phase, 'result');
    assert.equal(t.result.order.length, n);
    assert.ok(t.result.order.filter(o => o.durak).length <= 1);
    for (const u of us) assert.equal(dk.userTotals(u.id).games, 1);
    dk.remove(t);
  }
});
