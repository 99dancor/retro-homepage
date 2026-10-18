'use strict';
// Poker-Regeln und Bilanz ohne Browser: Blätter werten, Tisch direkt bedienen, Karten im Deck vorgeben.
// Aufruf: node --test test/poker.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const pk = require('../src/poker');

let nextId = 0;
function user(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  return { id, username: name + nextId, name, isAdmin: false };
}
const c = s => ({ r: s.slice(0, -1), s: s.slice(-1) });
const cs = str => str.split(' ').map(c);
const seat = (t, u) => t.seats.find(s => s && s.userId === u.id);
const wait = (t, test, ms = 8000) => new Promise((resolve, reject) => {
  const end = Date.now() + ms;
  (function poll() {
    if (test()) return resolve();
    if (Date.now() > end) return reject(new Error(`kam nicht, Phase ${t.phase} ${t.street}`));
    setTimeout(poll, 20);
  })();
});
test('Blätter: Reihenfolge und Gleichstände', () => {
  const name = str => pk.best(cs(str)).name;
  const cmp = (a, b) => pk.compare(pk.best(cs(a)).score, pk.best(cs(b)).score);
  assert.equal(name('A♠ K♠ Q♠ J♠ 10♠ 2♦ 3♣'), 'Royal Flush');
  assert.equal(name('5♥ 4♥ 3♥ 2♥ A♥ K♣ 9♦'), 'Straight Flush bis Fünf');
  assert.equal(name('9♠ 9♥ 9♦ 9♣ K♠ 2♦ 3♣'), 'Vierling Neunen');
  assert.equal(name('Q♠ Q♥ Q♦ 4♣ 4♠ 4♦ 3♣'), 'Full House, Damen über Vieren');
  assert.equal(name('A♦ 9♦ 7♦ 4♦ 2♦ K♣ K♠'), 'Flush, Ass hoch');
  assert.equal(name('A♠ 2♦ 3♣ 4♥ 5♠ 9♦ K♣'), 'Straße bis Fünf');
  assert.equal(name('10♠ J♦ Q♣ K♥ A♠ 2♦ 2♣'), 'Straße bis Ass');
  assert.equal(name('7♠ 7♦ 7♣ K♥ 2♠ 9♦ 4♣'), 'Drilling Siebenen');
  assert.equal(name('K♠ K♦ 7♣ 7♥ 2♠ 9♦ 4♣'), 'Zwei Paare, Könige und Siebenen');
  assert.equal(name('J♠ J♦ 7♣ 3♥ 2♠ 9♦ 4♣'), 'Paar Buben');
  assert.equal(name('A♠ J♦ 7♣ 3♥ 2♠ 9♦ 4♣'), 'Höchste Karte Ass');
  assert.ok(cmp('K♠ K♦ 7♣ 7♥ A♠ 2♦ 3♣', 'K♣ K♥ 7♦ 7♠ Q♠ 2♣ 3♦') > 0, 'Kicker entscheidet');
  assert.equal(cmp('A♠ K♦ 7♣ 7♥ 2♠ 3♦ 4♣', 'A♣ K♥ 7♦ 7♠ 2♦ 3♣ 4♦'), 0, 'Split');
  assert.ok(cmp('2♠ 3♦ 4♣ 5♥ 6♠ K♦ K♣', 'A♠ 2♦ 3♣ 4♥ 5♠ K♥ K♠') > 0, 'Sechser-Straße schlägt das Rad');
  assert.ok(cmp('2♦ 3♦ 5♦ 7♦ 9♦ A♠ A♣', 'A♥ A♦ A♣ K♠ K♦ 2♠ 3♣') < 0, 'Full House schlägt Flush');
  assert.equal(pk.newDeck().length, 52);
  assert.equal(new Set(pk.newDeck().map(x => x.r + x.s)).size, 52);
});

test('Nebenpots: All-in gewinnt nur, was es selbst gedeckt hat', () => {
  const s = (name, total, folded = false) => ({ name, total, folded, inHand: true });
  const a = s('a', 100), b = s('b', 300), cc = s('c', 300), d = s('d', 50, true);
  const t = { seats: [a, b, cc, d] };
  const p = pk.pots(t);
  assert.deepEqual(p.map(x => [x.amount, x.eligible.map(e => e.name)]), [[350, ['a', 'b', 'c']], [400, ['b', 'c']]]);
});

test('Hand zu zweit: Blinds, Button spricht zuerst, Bilanz nach der Hand', async () => {
  const a = user('anna'), b = user('bernd');
  const t = pk.create(a, { name: 'Zu zweit', sb: 5 });
  assert.equal(pk.control(t, a, { action: 'sit' }), null);
  assert.equal(t.phase, 'waiting');
  assert.equal(pk.control(t, b, { action: 'sit' }), null);
  assert.ok(t.timer, 'zu zweit startet die Hand gleich');
  await wait(t, () => t.phase === 'playing');
  const sa = seat(t, a), sb = seat(t, b);
  // Erste Hand: Button ist Platz 0 (Anna) und setzt den Small Blind
  assert.equal(t.button, 0);
  assert.deepEqual([sa.bet, sb.bet], [5, 10]);
  assert.equal(t.turn.seat, 0, 'zu zweit spricht der Button vor dem Flop zuerst');
  // Fremde Karten bleiben auf dem Server
  const st = pk.state(t, b.id);
  assert.equal(st.seats[0].cards[0], null);
  assert.ok(st.seats[1].cards[0].r);
  assert.deepEqual(st.seats[0].cards, [null, null], 'Annas Karten sieht Bernd nicht');
  assert.match(pk.control(t, b, { action: 'check' }), /nicht dran/);
  assert.match(pk.control(t, a, { action: 'check' }), /mitgehen/);
  assert.match(pk.control(t, a, { action: 'raise', amount: 15 }), /mindestens auf 20 €/);
  assert.equal(pk.control(t, a, { action: 'raise', amount: 30 }), null);
  assert.equal(t.turn.seat, 1);
  assert.equal(pk.control(t, b, { action: 'fold' }), null);
  assert.equal(t.phase, 'showdown');
  assert.equal(sa.chips, 1010);
  assert.equal(sb.chips, 990);
  assert.equal(pk.userTotals(a.id).balance, 10);
  assert.equal(pk.userTotals(b.id).balance, -10);
  assert.equal(pk.state(t, b.id).seats[0].cards[0], null, 'ohne Showdown bleiben die Karten verdeckt');
  // Nächste Hand: Button wandert zu Bernd
  await wait(t, () => t.phase === 'playing' && t.hand === 2);
  assert.equal(t.button, 1);
  assert.deepEqual([sa.bet, sb.bet], [10, 5]);
  pk.remove(t);
  assert.equal(pk.userTotals(a.id).balance, 10, 'laufende Blinds gehen beim Schließen zurück');
});

test('Showdown zu dritt mit All-in und Nebenpot', async () => {
  const a = user('carla'), b = user('dora'), d = user('emil');
  const t = pk.create(a, { name: 'Dreier', sb: 5 });
  for (const u of [a, b, d]) pk.control(t, u, { action: 'sit' });
  await wait(t, () => t.phase === 'playing');
  const [sa, sb, sd] = [a, b, d].map(u => seat(t, u));
  // Button Carla (0), SB Dora (1), BB Emil (2). Karten selbst verteilen und Deck für den Board vorgeben.
  sa.cards = cs('A♠ A♥'); sb.cards = cs('K♠ K♥'); sd.cards = cs('J♦ 2♣');
  t.deck = cs('3♦ 9♣ 8♦ 4♠ J♣ 5♥ Q♦ 6♣').reverse();   // brennen, Flop, brennen, Turn, brennen, River
  sb.chips = 195;   // Dora hat insgesamt nur 200 (5 im Small Blind)
  assert.equal(t.turn.seat, 0, 'zu dritt spricht vor dem Flop der Platz nach dem Big Blind');
  assert.equal(pk.control(t, a, { action: 'raise', amount: 400 }), null);
  assert.equal(pk.control(t, b, { action: 'allin' }), null);
  assert.equal(sb.allIn, true);
  assert.equal(pk.control(t, d, { action: 'call' }), null);
  // Flop: Emil checkt, Carla checkt … bis zum River
  for (let k = 0; k < 3; k++) {
    await wait(t, () => t.turn);
    assert.equal(t.seats[t.turn.seat], sd, 'nach dem Flop spricht der erste Aktive links vom Button');
    pk.control(t, d, { action: 'check' });
    pk.control(t, a, { action: 'check' });
  }
  assert.equal(t.phase, 'showdown');
  assert.equal(t.board.length, 5);
  // Hauptpot 3 × 200 an Carla (Asse), Nebenpot 2 × 200 auch an Carla
  assert.equal(sa.win, 1000);
  assert.deepEqual(t.results.map(r => [r.pot, r.amount, r.winners.join()]), [['Pot', 600, 'carla'], ['Nebenpot 1', 400, 'carla']]);
  assert.equal(t.results[0].hand, 'Paar Asse');
  const st = pk.state(t, d.id);
  assert.equal(st.seats[0].cards[0].r, 'A', 'im Showdown sieht jeder die Karten');
  assert.equal(sb.chips, 0);
  assert.equal(pk.userTotals(b.id).balance, -1000, 'Dora hat alles verloren');
  assert.equal(pk.userTotals(a.id).showdowns, 1);
  assert.equal(pk.userTotals(a.id).best_hand, 1);
  pk.remove(t);
});

test('Nachkaufen nur zwischen Händen und unter der Grenze, nur ein Tisch', async () => {
  const a = user('fritz'), b = user('gina');
  const t = pk.create(a, { name: 'Kasse' });
  const t2 = pk.create(a, { name: 'Zweiter' });
  pk.control(t, a, { action: 'sit' });
  assert.match(pk.control(t2, a, { action: 'sit' }), /schon am Tisch „Kasse“/);
  const s = seat(t, a);
  assert.match(pk.control(t, a, { action: 'rebuy' }), /weniger als 200 €/);
  s.chips = 100;
  assert.equal(pk.control(t, a, { action: 'rebuy' }), null);
  assert.deepEqual([s.chips, s.bought, s.buyins], [1100, 2000, 2]);
  pk.control(t, b, { action: 'sit' });
  await wait(t, () => t.phase === 'playing');
  s.chips = 50;
  assert.match(pk.control(t, a, { action: 'rebuy' }), /nach dieser Hand/);
  // Aufstehen mitten in der Hand: steigt aus, Platz wird nach der Hand frei
  pk.control(t, a, { action: 'leave' });
  assert.equal(t.phase, 'showdown');
  assert.ok(seat(t, a), 'sitzt bis zum Ende der Hand');
  await wait(t, () => !seat(t, a));
  assert.equal(t.phase, 'waiting', 'allein geht es nicht weiter');
  pk.remove(t); pk.remove(t2);
});
