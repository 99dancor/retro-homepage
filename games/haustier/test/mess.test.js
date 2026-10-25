import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESS, MARKS, catchUp, dayMs, planMess, addMess, cleanMess, dryUp, messMood, messChance, missChance, nightTime, cleanText, messPose, messSvg,
  MESS_RATE, MESS_MAX, PENALTY_FROM, PENALTY_MAX, LITTER_MAX,
} from '../src/js/mess.js';
import { social } from '../src/js/behavior.js';
import { newState, migrate } from '../src/js/state.js';
import { adopt } from '../src/js/pets.js';
import { photoSvg, cleanShot } from '../src/js/photo.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('Etwa zwei neue Flecken pro Stunde', () => {
  assert.equal(MESS_RATE, 2);
  // 180 Takte zu 20 Sekunden = eine Stunde: erwartet werden ungefähr MESS_RATE Flecken
  const sum = 180 * messChance(20e3);
  assert.ok(Math.abs(sum - 2) < 0.1, `${sum}`);
  assert.equal(nightTime(new Date(2026, 9, 25, 23)), true);
  assert.equal(nightTime(new Date(2026, 9, 25, 6)), true);
  assert.equal(nightTime(new Date(2026, 9, 25, 14)), false);
});

test('Geschäfte gehen in die Streukiste, Spuren an Kratzbaum und Kauholz', () => {
  const cat = { species: 'cat' }, dog = { species: 'dog' };
  // Geschäft (rng < 0.45), Pfütze, nicht daneben
  assert.deepEqual(planMess(cat, { placed: (id) => id === 'furn_litter', litter: 0, lvl: 5 }, seq(0.1, 0.1, 0.9)), { kind: 'pee', to: 'furn_litter' });
  // Volle Streukiste: daneben
  assert.deepEqual(planMess(cat, { placed: (id) => id === 'furn_litter', litter: LITTER_MAX, lvl: 5 }, seq(0.1, 0.9)), { kind: 'poo', to: null });
  // Ohne Geschäfte nur Spuren, die Katze kratzt am Kratzbaum
  assert.deepEqual(planMess(cat, { potty: false, placed: (id) => id === 'furn_tree' }, seq(0, 0.1)), { kind: 'scratch', to: 'furn_tree' });
  const d = planMess(dog, { potty: false }, seq(0.6));
  assert.ok(MARKS.dog.includes(d.kind) && d.to === null);
  assert.ok(missChance(1) > missChance(6));
  assert.equal(messPose('pee', 'dog'), 'leg');
  assert.equal(messPose('pee', 'cat'), 'crouch');
  for (const k of Object.keys(MESS)) assert.match(messSvg(k), /^<svg /);
});

test('Flecken: anlegen, wegwischen, trocknen, höchstens MESS_MAX', () => {
  const s = newState(0);
  const m = addMess(s, { kind: 'pee', at: 'desk', on: 'win', win: '/forum', dx: 12.6, x: 3 }, 1000);
  assert.equal(m.on, 'win'); assert.equal(m.win, '/forum'); assert.equal(m.dx, 13); assert.equal(m.x, 1);
  assert.equal(addMess(s, { kind: 'quatsch' }), null);
  addMess(s, { kind: 'poo', at: 'room', x: 0.4, y: 0.5 }, 1000);
  assert.equal(dryUp(s, 1000 + 3 * 3600e3), 1);           // die Pfütze ist getrocknet, das Häufchen nicht
  assert.equal(s.mess.length, 1);
  assert.equal(cleanMess(s, s.mess[0].id).kind, 'poo');
  for (let i = 0; i < MESS_MAX + 3; i++) addMess(s, { kind: 'scratch' }, 2000 + i);
  assert.equal(s.mess.length, MESS_MAX);
  assert.equal(cleanText(0), 'Alles sauber');
});

test('Erfüllung sinkt ab PENALTY_FROM Flecken höchstens um PENALTY_MAX und kommt nach dem Putzen zurück', () => {
  const s = newState(0);
  adopt(s, 'cat', 'orange', 'Mimi', 0);
  s.pets[0].stats.joy = 50;
  for (let i = 0; i < PENALTY_FROM - 1; i++) addMess(s, { kind: 'scratch' }, i);
  assert.equal(messMood(s, 5), null);
  addMess(s, { kind: 'scratch' }, 99);
  assert.equal(messMood(s, 100), 'down');
  assert.equal(s.pets[0].stats.joy, 50 - PENALTY_MAX);
  assert.equal(messMood(s, 100), null);                    // nicht noch weiter
  cleanMess(s, s.mess[0].id);
  assert.equal(messMood(s, 0), 'back');
  assert.equal(s.pets[0].stats.joy, 50);
  assert.equal(s.messDebt, 0);
});

test('Raufen oder kuscheln je nach Art', () => {
  assert.equal(social('dog', 'fox', {}, () => 0), 'romp');
  assert.equal(social('rabbit', 'rabbit', {}, () => 0.3), 'snuggle');
  assert.equal(social('axolotl', 'axolotl', {}, () => 0.99), null);
});

test('Fotoalbum: Schnappschüsse werden geprüft und gezeichnet, der Spielstand behält sie', () => {
  const shot = { w: 200, h: 90, floor: 80, pets: [{ name: 'Mimi', species: 'cat', color: 'orange', face: 'happy', pose: 'lean', facing: -1, x: 60, y: 80 }],
    things: [{ id: 'furn_litter', x: 120, y: 69 }, { id: '<script>', x: 0, y: 0 }], marks: [{ kind: 'poo', x: 150, y: 80 }, { kind: 'x' }] };
  const c = cleanShot(shot);
  assert.equal(c.things.length, 1);
  assert.equal(c.marks.length, 1);
  assert.equal(c.pets[0].facing, -1);
  assert.equal(cleanShot({ w: 100, h: 100, pets: [{ species: 'einhorn' }] }), null);
  assert.equal(cleanShot('kaputt'), null);
  const svg = photoSvg(c);
  assert.match(svg, /^<svg class="photo"/);
  assert.match(svg, /scale\(-1 1\)/);
  const raw = { ...newState(0), album: [{ at: 1, text: 'Erster Tanz', shot }, { at: 2, shot: { pets: 'nein' } }], mess: [{ id: 'm1', kind: 'pee', t: 1, at: 'room' }, { id: 'm2', kind: 'gibtsnicht', t: 1 }], litter: 99, prefs: { potty: false } };
  const s = migrate(raw);
  assert.equal(s.album.length, 1);
  assert.equal(s.mess.length, 1);
  assert.equal(s.litter, LITTER_MAX);
  assert.equal(s.prefs.potty, false);
  assert.equal(migrate({ ...newState(0) }).prefs.potty, true);
});

test('Während niemand zuschaut: verstrichene Tageszeit nachrechnen und zufällig verteilen', () => {
  const day = (h) => new Date(2026, 9, 25, h).getTime();
  assert.equal(dayMs(day(8), day(12)), 4 * 3600e3);
  assert.equal(dayMs(day(20), day(20) + 12 * 3600e3), 3 * 3600e3);   // 20–22 und 7–8 Uhr, die Nacht zählt nicht
  let r = 0.5, i = 0;
  const rng = () => { i++; r = (r * 9301 + 49297) % 233280 / 233280; return r; };
  const s = newState(0);
  adopt(s, 'cat', 'orange', 'Mimi', 0);
  adopt(s, 'dog', 'brown', 'Bello', 0);
  const out = catchUp(s, day(8), day(13), { where: (p) => (p.species === 'dog' ? 'desk' : 'room') }, rng);
  assert.ok(out.room + out.desk >= 3 && out.room + out.desk <= 18, JSON.stringify(out));
  assert.equal(s.mess.length, out.room + out.desk);
  for (const m of s.mess) {
    assert.ok(m.t >= day(8) && m.t <= day(13));
    if (m.at === 'desk') assert.equal(m.on, 'floor');
    else assert.ok(m.y > 0 && m.x > 0);
  }
  // Nachts entsteht nichts, und mehr als MESS_MAX liegen nie herum
  const n = newState(0); adopt(n, 'cat', 'orange', 'Mimi', 0);
  assert.deepEqual(catchUp(n, day(22) + 60e3, day(22) + 8 * 3600e3, {}, rng), { room: 0, desk: 0, litter: 0 });
  catchUp(n, day(8) - 5 * 86400e3, day(8), {}, rng);
  assert.equal(n.mess.length, MESS_MAX);
  // Mit Streukiste landet ein Teil dort
  const k = newState(0); adopt(k, 'cat', 'orange', 'Mimi', 0); k.pets[0].stats.love = 100;
  const o = catchUp(k, day(8), day(18), { placed: (id) => id === 'furn_litter', lvl: () => 8 }, rng);
  assert.ok(o.litter > 0 && k.litter === Math.min(LITTER_MAX, o.litter));
});
