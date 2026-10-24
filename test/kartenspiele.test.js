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
  assert.equal(ks.switchGame(s, anna, 'uno'), ks.BUSY);
  // Mit Rückfrage geht es doch: die Runde wird abgebrochen und zählt nicht
  assert.equal(ks.switchGame(s, anna, 'uno', true), null);
  assert.equal(s.game, 'uno');
  assert.deepEqual(seats(s), [anna.id, bernd.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dk_results WHERE user_id IN (?, ?)').get(anna.id, bernd.id).n, 0);
  assert.match(ks.tableOf(s).log[0], /abgebrochen\. Sie zählt nicht\./);
  ks.close(s);
  assert.equal(ks.get(s.id), null);
});

test('Nächste Runde: der Gastgeber startet, „Bereit“ ist nur ein Zeichen', async () => {
  const [anna, bernd] = ['Anna', 'Bernd'].map(user);
  const { table: s } = ks.create(anna, { game: 'durak' });
  assert.equal(ks.meta(s).next, 'host');
  ok(s, anna, { action: 'sit' });
  ok(s, bernd, { action: 'sit' });
  ok(s, anna, { action: 'ready' });
  ok(s, bernd, { action: 'ready' });
  const t = ks.tableOf(s);
  assert.equal(t.timer, null, 'alle bereit, aber gegeben wird erst auf Klick');
  assert.match(String(ks.control(s, bernd, { action: 'start' })), /Gastgeber/);
  ok(s, anna, { action: 'start' });
  assert.equal(t.phase, 'playing');

  // UNO: auch die nächste Runde innerhalb eines Spiels wartet auf den Gastgeber
  assert.equal(ks.switchGame(s, anna, 'uno', true), null);
  const u = ks.tableOf(s);
  ok(s, anna, { action: 'start' });
  assert.equal(u.phase, 'playing');
  const T = ks.engine('uno');
  let ran = 0;
  T.pause(u, 'round', 10, () => { ran++; });
  await new Promise(r => setTimeout(r, 40));
  assert.equal(ran, 0);
  assert.equal(T.state(u, anna.id).turn.hold, true);
  ok(s, anna, { action: 'start' });
  assert.equal(ran, 1);

  // Blackjack: das Ergebnis bleibt stehen, bis der Gastgeber die nächste Runde aufmacht
  assert.equal(ks.switchGame(s, anna, 'blackjack', true), null);
  const b = ks.tableOf(s);
  b.phase = 'result';
  assert.match(String(ks.control(s, bernd, { action: 'start' })), /Gastgeber/);
  ok(s, anna, { action: 'start' });
  assert.equal(b.phase, 'betting');

  // Poker: zwei mit Chips am Tisch, aber gegeben wird erst auf Klick
  assert.equal(ks.switchGame(s, anna, 'poker'), null);
  const p = ks.tableOf(s);
  assert.equal(p.timer, null);
  assert.equal(p.phase, 'waiting');
  ok(s, anna, { action: 'start' });
  assert.equal(p.phase, 'playing');
  assert.equal(ks.switchGame(s, anna, 'blackjack', true), null);

  // Umstellen auf automatisch
  assert.equal(ks.settings(s, anna, { next: 'auto' }), null);
  assert.equal(ks.tableOf(s).manual, false);
  assert.equal(ks.meta(s).next, 'auto');
  ks.close(s);
});

test('Plätze nachträglich ändern: nie weniger als Leute sitzen, wer hinten sitzt, rückt auf', () => {
  const [anna, bernd, carla] = ['Anna', 'Bernd', 'Carla'].map(user);
  const { table: s } = ks.create(anna, { seats: 6 });
  ok(s, anna, { action: 'sit', seat: 0 });
  ok(s, bernd, { action: 'sit', seat: 5 });
  assert.match(String(ks.settings(s, bernd, { seats: 3 })), /Gastgeber/);
  assert.equal(ks.settings(s, anna, { seats: 3 }), null);
  const t = ks.tableOf(s);
  assert.equal(t.seatCount, 3);
  assert.deepEqual(seats(s), [anna.id, bernd.id]);
  assert.ok(t.seats.indexOf(t.seats.find(x => x && x.userId === bernd.id)) < 3);
  assert.match(String(ks.settings(s, anna, { seats: 1 })), /sitzen 2 Leute/);
  ok(s, carla, { action: 'sit' });
  assert.equal(ks.settings(s, anna, { seats: 8 }), null);
  assert.equal(ks.meta(s).seats, 8);
  // Das Spiel setzt die Grenzen: Durak geht mit höchstens 6
  assert.equal(ks.switchGame(s, anna, 'durak'), null);
  assert.equal(ks.tableOf(s).seatCount, 6);
  assert.match(String(ks.settings(s, anna, { seats: 7 })), /2 bis 6/);
  // Auch über die Einstellungen des Spiels
  ok(s, anna, { action: 'settings', seats: 4 });
  assert.equal(ks.tableOf(s).seatCount, 4);
  ks.close(s);
});

test('Spiel wechseln mitten in der Hand: Einsätze gehen zurück in die Kasse', async () => {
  setSetting('ks_buyin', '1000');
  const [anna] = ['Anna'].map(user);
  const { table: s } = ks.create(anna, { game: 'blackjack' });
  ok(s, anna, { action: 'sit' });
  const t = ks.tableOf(s);
  // Spieler 10 + 6, Dealer 10 + 7: niemand hat Blackjack, Anna ist dran
  const c = x => ({ r: x.slice(0, -1), s: x.slice(-1) });
  t.shoe = [...Array(150).fill(c('2♣')), ...['10♠', '10♥', '6♣', '7♦'].map(c).reverse()];
  ok(s, anna, { action: 'bet', amount: 100 });
  ok(s, anna, { action: 'confirm' });
  for (let i = 0; i < 100 && t.phase !== 'playing'; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(t.phase, 'playing');
  assert.equal(t.seats[0].chips, 900);
  assert.equal(ks.switchGame(s, anna, 'poker'), ks.BUSY);
  assert.equal(ks.switchGame(s, anna, 'poker', true), null);
  assert.equal(kasse.wallet(anna.id).balance, 1000);
  assert.equal(ks.tableOf(s).seats[0].chips, 1000);
  assert.equal(bj.userTotals(anna.id).hands, 0, 'die abgebrochene Hand zählt nicht');
  assert.match(ks.tableOf(s).log[0], /alle Einsätze sind zurück/);
  ks.close(s);
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
  assert.deepEqual(kasse.view(kasse.wallet(anna.id)), { balance: 1150, bought: 2000, buyins: 2, spent: 0, net: -850 });

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
  assert.deepEqual(kasse.view(kasse.wallet(bernd.id)), { balance: 1050, bought: 2000, buyins: 2, spent: 0, net: -950 });

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

test('Shop: kaufen, hinstellen, am Geldtisch bezahlen, Holzrand und Tier am Platz', () => {
  setSetting('ks_buyin', '1000');
  const [anna, bernd] = ['Anna', 'Bernd'].map(user);
  // Kaffee und Eiche hat jeder, Kaufen geht nur mit genug Geld
  assert.equal(kasse.wallet(anna.id).drink, 'kaffee');
  assert.match(String(kasse.buy(anna.id, 'kaffee')), /schon/);
  assert.match(String(kasse.buy(anna.id, 'krone')), /reicht/);
  assert.match(String(kasse.equip(anna.id, 'bier')), /erst kaufen/);
  // Preise über kasse.price: das Angebot der Woche ist billiger
  const bier = kasse.price('bier'), korb = kasse.price('korb');
  assert.equal(ks.buy(anna, 'bier'), null);
  assert.deepEqual(kasse.view(kasse.wallet(anna.id)), { balance: 1000 - bier, bought: 1000, buyins: 1, spent: bier, net: 0 });
  assert.equal(kasse.loadout(anna.id).drink, 'bier');
  assert.equal(kasse.equip(anna.id, '', 'drink'), null);
  assert.equal(kasse.loadout(anna.id).drink, null);

  // Am Geldtisch zahlt man mit den Chips; die Bilanz der Sitzung bleibt
  const { table: s } = ks.create(anna, { game: 'blackjack', wood: 'mahagoni' });
  assert.equal(s.wood, 'eiche');
  ok(s, anna, { action: 'sit' });
  ok(s, bernd, { action: 'sit' });
  const t = ks.tableOf(s);
  t.seats[0].chips += 200;
  assert.equal(ks.buy(anna, 'korb'), null);
  assert.equal(t.seats[0].chips, 1200 - bier - korb);
  assert.equal(t.seats[0].chips - t.seats[0].bought, 200);
  assert.equal(kasse.wallet(anna.id).balance, 1200 - bier - korb);
  assert.equal(kasse.view(kasse.wallet(anna.id)).net, 200);

  // Holzrand nur, wenn der Gastgeber ihn gekauft hat
  assert.match(String(ks.settings(s, anna, { wood: 'mahagoni' })), /erst im Shop/);
  kasse.save(anna.id, 5000); t.seats[0].chips = 5000;
  assert.equal(ks.buy(anna, 'mahagoni'), null);
  assert.equal(ks.settings(s, anna, { wood: 'mahagoni' }), null);
  assert.equal(ks.meta(s).wood, 'mahagoni');

  // Am Platz: Getränk, Glücksbringer und mit dem Körbchen das Tier aus Pixelpfoten
  let m = ks.meta(s);
  assert.equal(m.deco[anna.id].charm.id, 'korb');
  assert.equal(m.deco[anna.id].pet, null);
  assert.equal(m.deco[bernd.id].drink.id, 'kaffee');
  const st = require('../games/haustier/src/js/state.js'), pets = require('../games/haustier/src/js/pets.js');
  const save = st.newState(); save.pets.push(pets.newPet('dog', '', 'Bello'));
  db.prepare("INSERT INTO game_saves(user_id, app_slug, slot, data, updated_at) VALUES (?, 'haustier', 'main', ?, ?)").run(anna.id, JSON.stringify(save), now());
  m = ks.meta(s);
  assert.equal(m.deco[anna.id].pet.name, 'Bello');
  assert.match(m.deco[anna.id].pet.svg, /^<svg class="pet-svg species-dog/);
  ks.close(s);
});

test('Shop: Angebot der Woche, Untersetzer, Filz und Kartenrücken erst kaufen', () => {
  setSetting('ks_buyin', '20000');
  const anna = user('Anna');
  // Jede Woche ein anderes Angebot, ein Viertel billiger
  const week = 7 * 864e5, t0 = Date.UTC(2026, 9, 21);
  const a = kasse.offer(t0), b = kasse.offer(t0 + week);
  assert.notEqual(a, b);
  assert.ok(kasse.SHOP[a].price >= 100);
  assert.equal(kasse.price(a, t0), Math.round(kasse.SHOP[a].price * 0.75 / 10) * 10);
  assert.equal(kasse.price(a, t0 + week), kasse.SHOP[a].price);

  // Untersetzer kommt gleich unters Getränk
  assert.equal(ks.buy(anna, 'kork'), null);
  assert.equal(kasse.loadout(anna.id).coaster, 'kork');
  assert.equal(kasse.equip(anna.id, '', 'coaster'), null);
  assert.equal(kasse.loadout(anna.id).coaster, null);
  assert.equal(kasse.equip(anna.id, 'kork'), null);

  // Neue Filze und Kartenrücken muss der Gastgeber besitzen; die alten hat jeder
  const { table: s } = ks.create(anna, { felt: 'bordeaux', back: 'sterne' });
  assert.equal(s.felt, 'gruen');
  assert.equal(s.back, 'klassisch');
  assert.match(String(ks.settings(s, anna, { felt: 'bordeaux' })), /Filz .*erst im Shop/);
  assert.match(String(ks.settings(s, anna, { back: 'sterne' })), /erst im Shop/);
  assert.equal(ks.buy(anna, 'bordeaux'), null);
  assert.equal(ks.buy(anna, 'sterne'), null);
  assert.equal(ks.settings(s, anna, { felt: 'bordeaux', back: 'sterne' }), null);
  ok(s, anna, { action: 'sit', seat: 0 });
  const m = ks.meta(s);
  assert.equal(m.felt, 'bordeaux');
  assert.equal(m.back, 'sterne');
  assert.equal(m.deco[anna.id].coaster.id, 'kork');
  ks.close(s);
});

test('Schnell spielen: an den vollsten Tisch mit freiem Platz, sonst ein neuer', () => {
  const [anna, bernd, carla, dora] = ['Anna', 'Bernd', 'Carla', 'Dora'].map(user);
  const { table: a } = ks.create(anna, { game: 'durak', seats: 2 });
  ok(a, anna, { action: 'sit' });
  const { table: b } = ks.create(bernd, { game: 'durak', seats: 4 });
  ok(b, bernd, { action: 'sit' });
  const { table: hidden } = ks.create(dora, { game: 'durak', hidden: true });
  // Beide haben einen freien Platz und einen Spieler: der erste passt, versteckte Tische nie
  assert.notEqual(ks.quick(carla, 'durak').table, hidden);
  ok(b, carla, { action: 'sit' });
  assert.equal(ks.quick(dora, 'durak').table, b);
  // Wer schon sitzt, kommt an seinen Tisch zurück
  assert.equal(ks.quick(anna, 'uno').table, a);
  // Kein Tisch mit dem Spiel frei: ein neuer mit diesem Spiel; „egal“ nimmt irgendeinen
  const fresh = ks.quick(dora, 'uno').table;
  assert.equal(fresh.game, 'uno');
  assert.notEqual(fresh, hidden);
  assert.ok([a, b, fresh].includes(ks.quick(dora, 'egal').table));
  assert.match(String(ks.quick(dora, 'gibtsnicht').error), /gibt es/);
  for (const s of [a, b, hidden, fresh]) ks.close(s);
});

test('Runde schmeißen: alle bekommen das Getränk, bezahlt wird für alle', () => {
  setSetting('ks_buyin', '1000');
  const [anna, bernd, carla] = ['Anna', 'Bernd', 'Carla'].map(user);
  const { table: s } = ks.create(anna, { game: 'poker' });
  ok(s, anna, { action: 'sit' });
  assert.match(String(ks.round(anna, 'bier')), /noch jemand/);
  assert.match(String(ks.round(bernd, 'bier')), /Setz dich/);
  ok(s, bernd, { action: 'sit' });
  ok(s, carla, { action: 'sit' });
  assert.match(String(ks.round(anna, 'krone')), /Getränk/);
  assert.match(String(ks.round(anna, 'champagner')), /reicht/);
  const t = ks.tableOf(s), res = client();
  const leave = ks.engine(s.game).join(t, carla, res);
  const before = t.seats[0].chips, cost = kasse.price('bier') * 3;
  assert.equal(ks.round(anna, 'bier'), null);
  assert.equal(t.seats[0].chips, before - cost);
  assert.equal(kasse.wallet(anna.id).spent, cost);
  assert.ok(res.events.includes('fx'));
  assert.match(t.log[0], /Anna schmeißt eine Runde Bier/);
  const m = ks.meta(s);
  for (const u of [anna, bernd, carla]) assert.deepEqual([m.deco[u.id].drink.id, m.deco[u.id].drink.from], ['bier', 'Anna']);
  // Wer danach sein eigenes Getränk hinstellt (oder kauft), hat wieder seins; bei den anderen bleibt die Runde stehen
  assert.equal(ks.equip(bernd, 'kaffee'), null);
  assert.equal(ks.meta(s).deco[bernd.id].drink.id, 'kaffee');
  assert.equal(ks.meta(s).deco[bernd.id].drink.from, undefined);
  assert.equal(ks.buy(carla, 'saft'), null);
  assert.equal(ks.meta(s).deco[carla.id].drink.id, 'saft');
  assert.equal(ks.meta(s).deco[anna.id].drink.from, 'Anna');
  leave();
  ks.close(s);
});

test('Leben am Tisch: Reaktionen mit Pause, Anstoßen, Tiere streicheln', () => {
  setSetting('ks_buyin', '1000');
  const [anna, bernd, carla] = ['Anna', 'Bernd', 'Carla'].map(user);
  const { table: s } = ks.create(anna, { game: 'uno' });
  ok(s, anna, { action: 'sit' });
  ok(s, bernd, { action: 'sit' });
  const t = ks.tableOf(s), sent = [];
  const res = { write(chunk) { const m = /^event: fx\ndata: (.*)/m.exec(chunk); if (m) sent.push(JSON.parse(m[1])); }, end() {} };
  const leave = ks.engine(s.game).join(t, carla, res);

  // Reaktionen nur am Platz, nur die sechs, und nicht zu oft
  assert.match(String(ks.fx(s, carla, { action: 'emote', emoji: '👏' })), /Setz dich/);
  assert.match(String(ks.fx(s, anna, { action: 'emote', emoji: '💩' })), /gibt es nicht/);
  assert.equal(ks.fx(s, anna, { action: 'emote', emoji: '👏' }), null);
  assert.match(String(ks.fx(s, anna, { action: 'emote', emoji: '😂' })), /schnell/);
  assert.equal(ks.fx(s, bernd, { action: 'emote', emoji: '😂' }), null);

  // Wer kurz nach dem ersten Glas auch anstößt, stößt mit an
  assert.equal(ks.fx(s, anna, { action: 'cheers' }), null);
  assert.equal(ks.fx(s, bernd, { action: 'cheers' }), null);

  // Streicheln geht auch vom Zuschauen aus, aber nur, wo ein Tier sitzt
  assert.match(String(ks.fx(s, carla, { action: 'pet', uid: anna.id })), /kein Tier/);
  assert.equal(ks.buy(anna, 'kissen'), null);
  assert.equal(ks.fx(s, carla, { action: 'pet', uid: anna.id }), null);
  assert.match(String(ks.fx(s, carla, { action: 'pet', uid: anna.id })), /schnell/);
  assert.match(String(ks.fx(s, anna, { action: 'tanzen' })), /Unbekannt/);

  assert.deepEqual(sent, [
    { kind: 'emote', uid: anna.id, emoji: '👏' },
    { kind: 'emote', uid: bernd.id, emoji: '😂' },
    { kind: 'cheers', uid: anna.id, join: false },
    { kind: 'cheers', uid: bernd.id, join: true },
    { kind: 'pet', uid: anna.id, by: carla.id },
  ]);
  leave();
  ks.close(s);
});
