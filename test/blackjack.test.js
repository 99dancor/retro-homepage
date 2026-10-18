'use strict';
// Blackjack-Regeln und Bilanz ohne Browser: Tisch direkt bedienen, Karten im Schlitten vorgeben.
// Aufruf: node --test test/blackjack.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const bj = require('../src/blackjack');

let nextId = 0;
function user(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  return { id, username: name + nextId, name, isAdmin: false };
}
const c = s => ({ r: s.slice(0, -1), s: s.slice(-1) });
// Karten in Ausgabe-Reihenfolge; davor genug Füllkarten, damit nicht neu gemischt wird
function rig(t, cards) { t.shoe = [...Array(150).fill(c('2♣')), ...cards.map(c).reverse()]; }
const wait = (t, phase, ms = 6000) => new Promise((resolve, reject) => {
  const end = Date.now() + ms;
  (function poll() {
    if (t.phase === phase) return resolve();
    if (Date.now() > end) return reject(new Error(`Phase ${phase} kam nicht, steht bei ${t.phase}`));
    setTimeout(poll, 20);
  })();
});
const seat = (t, u) => t.seats.find(s => s && s.userId === u.id);

test('Werte: Asse zählen 11 oder 1, Blackjack nur mit zwei Karten', () => {
  assert.deepEqual(bj.total([c('A♠'), c('6♥')]), { total: 17, soft: true });
  assert.deepEqual(bj.total([c('A♠'), c('6♥'), c('10♦')]), { total: 17, soft: false });
  assert.equal(bj.total([c('A♠'), c('A♥'), c('9♦')]).total, 21);
  assert.ok(bj.isBlackjack([c('A♠'), c('K♥')]));
  assert.ok(!bj.isBlackjack([c('7♠'), c('7♥'), c('7♦')]));
  const shoe = bj.newShoe(2);
  assert.equal(shoe.length, 104);
  assert.equal(new Set(shoe.map(x => x.r + x.s)).size, 52);
});

test('Bilanz: Start zählt als Buy-in, Nachkaufen nur unter 200 €', () => {
  const u = user('anna');
  const t = bj.create(u, { name: 'Test' });
  assert.equal(bj.control(t, u, { action: 'sit' }), null);
  const s = seat(t, u);
  assert.deepEqual([s.chips, s.bought, s.buyins], [1000, 1000, 1]);
  assert.match(bj.control(t, u, { action: 'rebuy' }), /weniger als 200 €/);
  // Dreimal pleite, dreimal nachgekauft, mit 500 € aufgehört
  for (let i = 0; i < 3; i++) { s.chips = 150; assert.equal(bj.control(t, u, { action: 'rebuy' }), null); }
  s.chips = 500;
  assert.deepEqual([s.bought, s.buyins], [4000, 4]);
  bj.control(t, u, { action: 'leave' });
  assert.equal(seat(t, u), undefined);
  const tot = bj.userTotals(u.id);
  assert.equal(tot.balance, -3500, '500 − 4 × 1.000');
  assert.equal(tot.buyins, 4);
  assert.ok(db.prepare('SELECT ended_at FROM bj_sessions WHERE user_id = ?').get(u.id).ended_at);
  bj.remove(t);
});

test('Nur ein Tisch gleichzeitig, Einsatz in den Grenzen', () => {
  const u = user('bernd');
  const a = bj.create(u, { name: 'A', minBet: 10, maxBet: 100 }), b = bj.create(u, { name: 'B' });
  assert.equal(bj.control(a, u, { action: 'sit' }), null);
  assert.match(bj.control(b, u, { action: 'sit' }), /schon am Tisch „A“/);
  assert.match(bj.control(a, u, { action: 'bet', amount: 5 }), /zwischen 10 € und 100 €/);
  assert.match(bj.control(a, u, { action: 'bet', amount: 500 }), /zwischen/);
  assert.match(bj.control(a, u, { action: 'hit' }), /nicht dran/);
  bj.remove(a); bj.remove(b);
});

test('Einsatz: Chips legen gibt noch nicht, erst Bestätigen', async () => {
  const u = user('fritz'), v = user('gina');
  const t = bj.create(u, { name: 'Bestätigen' });
  bj.control(t, u, { action: 'sit' });
  bj.control(t, v, { action: 'sit' });
  const s = seat(t, u);
  assert.match(bj.control(t, u, { action: 'confirm' }), /erst Chips/);
  assert.equal(bj.control(t, u, { action: 'bet', amount: 25 }), null);
  assert.equal(bj.control(t, u, { action: 'bet', amount: 35 }), null, 'mehrere Chips nacheinander');
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(t.phase, 'betting', 'ohne Bestätigung wird nicht gegeben');
  assert.equal(t.betDeadline, 0, 'und die Zeit läuft noch nicht');
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  assert.ok(s.ready && t.betDeadline > 0);
  assert.equal(bj.control(t, u, { action: 'bet', amount: 45 }), null);
  assert.equal(s.ready, false, 'neuer Chip hebt die Bestätigung auf');
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  // Gina legt Chips, bestätigt aber nicht. Sie hat kein Fenster offen, also wartet der Tisch nicht auf sie.
  rig(t, ['10♠', '10♥', '9♣', '7♦']);
  bj.control(t, v, { action: 'bet', amount: 10 });
  assert.equal(t.phase, 'betting');
  await wait(t, 'playing');
  assert.equal(s.hands[0].bet, 45);
  assert.equal(seat(t, v).hands.length, 0, 'nicht bestätigt spielt nicht mit');
  assert.equal(seat(t, v).chips, 1000);
  bj.remove(t);
});

test('Runde: gewinnen, Blackjack zahlt 3 zu 2, Dealerkarte bleibt verdeckt', async () => {
  const u = user('carla');
  const t = bj.create(u, { name: 'Runde' });
  bj.control(t, u, { action: 'sit' });
  // Spieler 10 + 9, Dealer 10 + 7 (verdeckt)
  rig(t, ['10♠', '10♥', '9♣', '7♦']);
  assert.equal(bj.control(t, u, { action: 'bet', amount: 100 }), null);
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  await wait(t, 'playing');
  const st = bj.state(t);
  assert.equal(st.dealer[1], null, 'Lochkarte geht nicht an den Browser');
  assert.ok(!JSON.stringify(st).includes('"7"'), 'auch nicht versteckt im Zustand');
  assert.equal(st.seats[0].balance, 0, 'Einsatz zählt während der Hand noch mit');
  assert.equal(bj.control(t, u, { action: 'stand' }), null);
  await wait(t, 'result');
  const s = seat(t, u);
  assert.equal(s.hands[0].result, 'win');
  assert.equal(s.chips, 1100);
  assert.equal(bj.userTotals(u.id).balance, 100, 'nach der Hand gespeichert');

  await wait(t, 'betting');
  // Spieler Ass + König, Dealer 9 + 7: Blackjack ohne Zug
  rig(t, ['A♠', '9♥', 'K♣', '7♦']);
  bj.control(t, u, { action: 'bet', amount: 100 });
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  await wait(t, 'result');
  assert.equal(s.hands[0].result, 'blackjack');
  assert.equal(s.chips, 1100 + 150);
  const tot = bj.userTotals(u.id);
  assert.deepEqual([tot.balance, tot.hands, tot.wins, tot.blackjacks, tot.best_streak], [250, 2, 2, 1, 2]);
  bj.remove(t);
});

test('Verdoppeln, Teilen und Überkaufen', async () => {
  const u = user('dora');
  const t = bj.create(u, { name: 'Züge' });
  bj.control(t, u, { action: 'sit' });
  // Spieler 8 + 8, Dealer 10 + 6. Beim Teilen bekommt erst die zweite Hand ihre Karte (10 → 18), dann die erste (3 → 11);
  // die erste verdoppelt mit einer 10 auf 21, die zweite hält, der Dealer zieht 10 und überkauft
  rig(t, ['8♠', '10♥', '8♣', '6♦', '10♣', '3♠', '10♦', '10♠']);
  bj.control(t, u, { action: 'bet', amount: 100 });
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  await wait(t, 'playing');
  assert.equal(bj.control(t, u, { action: 'split' }), null);
  const s = seat(t, u);
  assert.equal(s.hands.length, 2);
  assert.match(bj.control(t, u, { action: 'split' }), /nur einmal/);
  assert.equal(bj.control(t, u, { action: 'double' }), null);
  assert.equal(bj.total(s.hands[0].cards).total, 21);
  assert.equal(s.hands[0].bet, 200);
  assert.equal(bj.control(t, u, { action: 'stand' }), null);
  await wait(t, 'result');
  assert.deepEqual(s.hands.map(h => h.result), ['win', 'win']);
  assert.equal(s.chips, 1000 + 200 + 100);

  await wait(t, 'betting');
  // Spieler 10 + 6, Dealer 10 + 7, Spieler zieht König
  rig(t, ['10♠', '10♥', '6♣', '7♦', 'K♠']);
  bj.control(t, u, { action: 'bet', amount: 50 });
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  await wait(t, 'playing');
  bj.control(t, u, { action: 'hit' });
  await wait(t, 'result');
  assert.equal(s.hands[0].result, 'bust');
  assert.equal(s.chips, 1250);
  bj.remove(t);
});

test('Tisch schließen gibt laufende Einsätze zurück und beendet die Sitzung', async () => {
  const u = user('emil');
  const t = bj.create(u, { name: 'Zu' });
  bj.control(t, u, { action: 'sit' });
  rig(t, ['10♠', '10♥', '6♣', '7♦']);
  bj.control(t, u, { action: 'bet', amount: 300 });
  assert.equal(bj.control(t, u, { action: 'confirm' }), null);
  await wait(t, 'playing');
  assert.equal(seat(t, u).chips, 700);
  bj.remove(t);
  const row = db.prepare('SELECT * FROM bj_sessions WHERE user_id = ?').get(u.id);
  assert.equal(row.chips, 1000);
  assert.ok(row.ended_at);
  assert.equal(bj.get(t.id), null);
});
