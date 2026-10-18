'use strict';
// Spieltische und Kasse ohne Browser: Spieltisch eröffnen, Spiel wählen und wechseln, Plätze und Geld beim Wechsel
// mitnehmen. Aufruf: node --test test/kartenspiele.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-test-'));
process.env.PUID = '0';
const { db, now, setSetting } = require('../src/db');
const ks = require('../src/kartenspiele');
const kasse = require('../src/kasse');
const bj = require('../src/blackjack');

let nextId = 0;
function user(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  return { id, username: name + nextId, name, isAdmin: false };
}
// Ein offenes Fenster: sammelt, was der Server per Server-Sent Events schickt
function client() {
  const events = [];
  return { events, write(chunk) { const m = /^event: (\w+)/.exec(chunk); if (m) events.push(m[1]); }, end() { events.push('end'); } };
}
const ok = (s, u, b) => assert.equal(ks.control(s, u, b), null, JSON.stringify(b));
const seats = s => ks.tableOf(s).seats.filter(Boolean).map(x => x.userId);

test('Spieltisch: Lobby, Spiel wählen, Plätze bleiben beim Wechsel', () => {
  const [anna, bernd, carla] = ['Anna', 'Bernd', 'Carla'].map(user);
  const { table: s } = ks.create(anna, { name: 'Freitag', seats: 4 });
  assert.equal(s.game, 'lobby');
  ok(s, anna, { action: 'sit', seat: 0 });
  ok(s, bernd, { action: 'sit', seat: 2 });
  assert.match(String(ks.control(s, bernd, { action: 'ready' })), /wählt der Gastgeber/);
  assert.deepEqual(ks.list(carla).map(x => x.id), [s.id]);

  // Nur der Gastgeber wählt
  assert.match(String(ks.switchGame(s, bernd, 'durak')), /Gastgeber/);
  const res = client();
  const leave = ks.engine(s.game).join(ks.tableOf(s), carla, res);
  assert.equal(ks.switchGame(s, anna, 'durak'), null);
  assert.deepEqual(res.events.slice(-3), ['switch', 'closed', 'end']);
  leave();
  const t = ks.tableOf(s);
  assert.equal(s.game, 'durak');
  assert.equal(t.spieltisch, s);
  assert.equal(t.seats[0].userId, anna.id);
  assert.equal(t.seats[2].userId, bernd.id);
  assert.equal(t.hostId, anna.id);
  assert.equal(t.name, 'Freitag');

  // Mitten im Spiel wird nicht gewechselt
  ok(s, anna, { action: 'ready' });
  ok(s, bernd, { action: 'ready' });
  clearTimeout(t.timer); t.timer = null;
  require('../src/durak')._startGame(t);
  assert.equal(t.phase, 'playing');
  assert.match(String(ks.switchGame(s, anna, 'uno')), /Runde/);
  ks.close(s);
  assert.equal(ks.get(s.id), null);
});

test('Spieltisch: nur an einem Tisch sitzen, Grenzen der Spiele', () => {
  const us = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(user);
  const { table: s } = ks.create(us[0], { seats: 8, game: 'uno' });
  for (const u of us) ok(s, u, { action: 'sit' });
  assert.match(String(ks.switchGame(s, us[0], 'durak')), /höchstens 6/);
  const { table: other } = ks.create(us[0], {});
  assert.match(String(ks.control(other, us[1], { action: 'sit' })), /schon am Spieltisch/);
  ks.close(s); ks.close(other);
});

test('Kasse: Geld geht mit an den Tisch, bleibt beim Wechsel und nach der Hand', () => {
  setSetting('ks_buyin', '1000');
  setSetting('ks_rebuy_below', '200');
  const [anna, bernd] = ['Anna', 'Bernd'].map(user);
  assert.equal(kasse.wallet(anna.id).balance, 1000);
  assert.match(String(kasse.rebuy(anna.id)), /weniger als 200/);
  kasse.save(anna.id, 150);
  assert.equal(kasse.rebuy(anna.id), null);
  assert.deepEqual(kasse.view(kasse.wallet(anna.id)), { balance: 1150, bought: 2000, buyins: 2, net: -850 });

  const { table: s } = ks.create(anna, { game: 'blackjack' });
  ok(s, anna, { action: 'sit' });
  ok(s, bernd, { action: 'sit' });
  let t = ks.tableOf(s);
  assert.equal(t.seats[0].chips, 1150);
  assert.equal(t.seats[1].chips, 1000);
  // Anna verliert 100 in einer Hand; nach der Hand speichert der Tisch, und die Kasse zieht mit
  const a = t.seats[0];
  a.chips -= 100;
  ok(s, anna, { action: 'leave' });
  assert.equal(kasse.wallet(anna.id).balance, 1050);
  ok(s, anna, { action: 'sit', seat: 0 });
  t = ks.tableOf(s);
  assert.equal(bj.userTotals(anna.id).balance, -100);

  // Wechsel zu Poker: die Chips kommen mit
  assert.equal(ks.switchGame(s, anna, 'poker'), null);
  t = ks.tableOf(s);
  assert.equal(t.seats[0].chips, 1050);
  assert.equal(t.seats[1].chips, 1000);
  assert.deepEqual(seats(s), [anna.id, bernd.id]);

  // Nachkaufen am Tisch zählt in der Kasse
  t.seats[1].chips = 50; t.bank.save(bernd.id, 50);
  ok(s, bernd, { action: 'rebuy' });
  assert.deepEqual(kasse.view(kasse.wallet(bernd.id)), { balance: 1050, bought: 2000, buyins: 2, net: -950 });

  // Aufstehen: Stand landet in der Kasse; Wechsel zu UNO braucht kein Geld
  ok(s, bernd, { action: 'leave' });
  assert.equal(kasse.wallet(bernd.id).balance, 1050);
  assert.equal(ks.switchGame(s, anna, 'uno'), null);
  assert.equal(kasse.wallet(anna.id).balance, 1050);
  assert.equal(ks.tableOf(s).bank, undefined);
  ks.close(s);
});

test('Spieltisch: Aussehen und Einstellungen', () => {
  const [anna, bernd] = ['Anna', 'Bernd'].map(user);
  const { table: s } = ks.create(anna, { felt: 'blau', back: 'gold', hidden: true });
  assert.equal(s.felt, 'blau');
  assert.equal(s.back, 'gold');
  assert.deepEqual(ks.list(bernd), []);
  assert.match(String(ks.settings(s, bernd, { felt: 'rot' })), /Gastgeber/);
  assert.equal(ks.settings(s, anna, { felt: 'rot', back: 'kaputt', name: 'Neu' }), null);
  assert.equal(s.felt, 'rot');
  assert.equal(s.back, 'gold');
  assert.equal(ks.tableOf(s).name, 'Neu');
  // Spiel-Einstellungen merkt sich der Spieltisch für das nächste Mal
  assert.equal(ks.switchGame(s, anna, 'poker'), null);
  ok(s, anna, { action: 'settings', sb: 25 });
  assert.equal(ks.tableOf(s).sb, 25);
  assert.equal(ks.switchGame(s, anna, 'uno'), null);
  assert.equal(ks.switchGame(s, anna, 'poker'), null);
  assert.equal(ks.tableOf(s).sb, 25);
  ks.close(s);
});
