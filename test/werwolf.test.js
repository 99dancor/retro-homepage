'use strict';
// Werwolf ohne Browser: Raum direkt bedienen und prüfen, wer was sieht, wer stirbt und wer gewinnt.
// Aufruf: node --test test/werwolf.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'werwolf-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const ww = require('../src/werwolf');

let nextId = 0;
function member(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  return { pid: 'u' + id, user: { id, username: name + nextId, name, isAdmin: false, avatar: null }, name };
}
const guest = n => ({ pid: 'g' + n, user: null, name: '' });
// Raum mit festen Rollen: roles = ['werwolf', 'seherin', …], der Erste ist ein Mitglied und Gastgeber
function room(roles, opts = {}) {
  const host = member('Anna');
  const r = ww.create(host, { name: 'Testdorf', mode: opts.mode || 'lokal' });
  const ps = [host.pid];
  for (let i = 1; i < roles.length; i++) {
    assert.deepEqual(ww.join(r, guest('p' + i), { playerName: 'Gast' + i }), { ok: true });
    ps.push('gp' + i);
  }
  if (opts.opts) r.opts = { ...r.opts, ...opts.opts };
  r.auto = false;
  assert.equal(ww._start(r, Object.fromEntries(ps.map((pid, i) => [pid, roles[i]]))), null);
  for (const pid of ps) ok(r, pid, { action: 'seen' });
  assert.equal(r.phase, 'night');
  return { r, ps };
}
function ok(r, pid, b) { const out = ww.playerAction(r, pid, b); assert.deepEqual(out, { ok: true }, `${pid} ${JSON.stringify(b)}: ${out.error}`); }
const pick = (r, pid, target, extra) => { ok(r, pid, { action: 'pick', target, ...extra }); ok(r, pid, { action: 'done' }); };
// Alle ohne eigene Aufgabe tippen irgendwen an (Tarnung), damit die Nacht weitergeht
function others(r, ps, skip = []) {
  for (const pid of ps) {
    const v = ww.view(r, pid);
    if (!v.mine.alive || skip.includes(pid) || v.mine.done) continue;
    if (['verdacht', 'vertrauen'].includes(v.mine.task)) pick(r, pid, ps.find(x => x !== pid && r.players.get(x).alive));
  }
}
const alive = (r, pid) => r.players.get(pid).alive;

test('Rollenvorschlag und Prüfung vor dem Start', () => {
  assert.deepEqual(ww.suggest(4), { werwolf: 1, seherin: 1, hexe: 0, jaeger: 0, amor: 0, beschuetzer: 0 });
  assert.deepEqual(ww.suggest(10), { werwolf: 2, seherin: 1, hexe: 1, jaeger: 1, amor: 1, beschuetzer: 1 });
  const host = member('Bea');
  const r = ww.create(host, { name: 'Klein' });
  assert.match(ww.hostAction(r, host.pid, { action: 'start' }), /mindestens 4/);
  for (let i = 0; i < 3; i++) ww.join(r, guest('k' + i), { playerName: 'K' + i });
  assert.match(ww.join(r, guest('kx'), { playerName: 'k0' }).error, /gibt es in diesem Raum schon/);
  assert.equal(ww.hostAction(r, host.pid, { action: 'settings', roles: { werwolf: 2 } }), null);
  assert.match(ww.hostAction(r, host.pid, { action: 'settings', roles: { werwolf: 2 } }) || ww.hostAction(r, host.pid, { action: 'start' }), /weniger Werwölfe/);
  assert.equal(ww.hostAction(r, host.pid, { action: 'settings', auto: true }), null);
  assert.equal(ww.hostAction(r, host.pid, { action: 'start' }), null);
  assert.equal(r.phase, 'roles');
  assert.deepEqual([...r.players.values()].map(p => p.role).sort(), ['dorf', 'dorf', 'seherin', 'werwolf']);
  assert.match(ww.join(r, guest('spaet'), { playerName: 'Spät' }).error, /läuft schon/);
  ww.remove(r);
});

test('Jeder sieht nur seine Rolle, Wölfe sehen sich gegenseitig', () => {
  const { r, ps } = room(['werwolf', 'werwolf', 'seherin', 'dorf', 'dorf', 'dorf']);
  const v = ww.view(r, ps[0]);
  assert.deepEqual(v.players.map(p => p.role), ['werwolf', 'werwolf', null, null, null, null]);
  const d = ww.view(r, ps[3]);
  assert.deepEqual(d.players.map(p => p.role), [null, null, null, 'dorf', null, null]);
  assert.equal(d.mine.task, 'verdacht', 'auch Dorfbewohner haben nachts etwas zu tippen');
  assert.equal(v.mine.task, 'wolf');
  assert.equal(JSON.stringify(d).includes('wolfPicks'), false);
  ww.remove(r);
});

test('Nacht: Wölfe holen jemanden, Seherin erfährt eine Rolle, Tag und Abstimmung', () => {
  const { r, ps } = room(['werwolf', 'seherin', 'dorf', 'dorf', 'dorf']);
  assert.match(ww.playerAction(r, ps[0], { action: 'pick', target: ps[0] }).error, /nicht wählen/);
  pick(r, ps[0], ps[2]);
  pick(r, ps[1], ps[0]);
  assert.match(r.players.get(ps[1]).notes[0].text, /Anna ist 🐺 Werwolf/);
  others(r, ps);
  assert.equal(r.phase, 'day');
  assert.equal(r.day, 1);
  assert.equal(alive(r, ps[2]), false);
  assert.deepEqual(r.news, [{ pid: ps[2], cause: 'wolf' }]);
  const v = ww.view(r, ps[3]);
  assert.equal(v.players[2].role, 'dorf', 'Tote zeigen ihre Rolle');
  assert.equal(v.players[0].role, null);
  // Mehr als die Hälfte bereit → Abstimmung
  ok(r, ps[1], { action: 'ready' }); ok(r, ps[3], { action: 'ready' });
  assert.equal(r.phase, 'day');
  ok(r, ps[4], { action: 'ready' });
  assert.equal(r.phase, 'vote');
  for (const pid of [ps[1], ps[3], ps[4]]) pick(r, pid, ps[0]);
  assert.deepEqual(ww.view(r, ps[0]).votes[ps[1]], ps[0], 'offene Abstimmung');
  pick(r, ps[0], 'skip');
  assert.equal(r.phase, 'end');
  assert.equal(r.winner, 'dorf');
  const res = db.prepare('SELECT role, won, survived FROM ww_results WHERE user_id = ?').all(Number(ps[0].slice(1)));
  assert.deepEqual(res.map(x => ({ ...x })), [{ role: 'werwolf', won: 0, survived: 0 }], 'nur Mitglieder werden gespeichert');
  assert.equal(ww.userTotals(Number(ps[0].slice(1))).games, 1);
});

test('Gleichstand bei der Abstimmung: niemand stirbt; Wölfe gewinnen bei Gleichstand der Zahl', () => {
  const { r, ps } = room(['werwolf', 'dorf', 'dorf', 'dorf']);
  pick(r, ps[0], ps[1]);
  others(r, ps);
  assert.equal(r.phase, 'day');
  assert.equal(ww.hostAction(r, ps[0], { action: 'skip' }), null);
  pick(r, ps[0], ps[2]); pick(r, ps[2], ps[0]); pick(r, ps[3], 'skip');
  assert.equal(r.phase, 'night');
  assert.deepEqual(r.verdict, { pid: null, votes: 1, tie: true });
  pick(r, ps[0], ps[2]);
  others(r, ps);
  assert.equal(r.phase, 'end');
  assert.equal(r.winner, 'wolf');
  assert.deepEqual(ww.view(r, ps[3]).winners, [ps[0]]);
});

test('Beschützer und Hexe retten, Gift tötet, Hexe sieht das Opfer', () => {
  const { r, ps } = room(['werwolf', 'werwolf', 'hexe', 'beschuetzer', 'dorf', 'dorf', 'dorf']);
  pick(r, ps[0], ps[4]); pick(r, ps[1], ps[4]);
  pick(r, ps[3], ps[4]);
  others(r, ps);
  assert.equal(r.step, 2, 'mit Hexe gibt es einen zweiten Nachtschritt');
  const hv = ww.view(r, ps[2]);
  assert.equal(hv.mine.task, 'hexe');
  assert.equal(hv.mine.victim, ps[4]);
  assert.equal(ww.view(r, ps[4]).mine.victim, null);
  ok(r, ps[2], { action: 'pick', heal: true });
  ok(r, ps[2], { action: 'done' });
  others(r, ps);
  assert.equal(r.phase, 'day');
  assert.equal(alive(r, ps[4]), true, 'beschützt (und geheilt)');
  assert.equal(r.potions.heal, false, 'der Heiltrank ist trotzdem verbraucht');
  // Nächste Nacht: dieselbe Person darf nicht noch mal beschützt werden
  ww.hostAction(r, ps[0], { action: 'skip' });
  for (const pid of ps) pick(r, pid, 'skip');
  assert.equal(r.phase, 'night');
  assert.match(ww.playerAction(r, ps[3], { action: 'pick', target: ps[4] }).error, /letzte Nacht schon/);
  pick(r, ps[3], ps[3]);
  pick(r, ps[0], ps[5]); pick(r, ps[1], ps[6]);   // Gleichstand der Wölfe → Los
  others(r, ps);
  assert.equal(ww.view(r, ps[2]).mine.potions.heal, false);
  pick(r, ps[2], ps[0]);   // Gift auf einen Wolf
  others(r, ps);
  assert.equal(alive(r, ps[0]), false);
  assert.equal(r.news.length, 2);
  assert.ok(r.news.some(n => n.cause === 'gift' && n.pid === ps[0]));
  assert.equal([ps[5], ps[6]].filter(p => !alive(r, p)).length, 1);
});

test('Amor verliebt zwei, Kummer und Jägerschuss', () => {
  const { r, ps } = room(['werwolf', 'amor', 'jaeger', 'dorf', 'dorf', 'dorf', 'werwolf']);
  ok(r, ps[1], { action: 'pick', target: ps[2] });
  ok(r, ps[1], { action: 'pick', target: ps[3] });
  ok(r, ps[1], { action: 'done' });
  pick(r, ps[0], ps[3]); pick(r, ps[6], ps[3]);
  others(r, ps);
  assert.equal(r.phase, 'hunter', 'der verliebte Jäger stirbt mit und schießt');
  assert.deepEqual(r.news.map(n => n.cause), ['wolf', 'liebe']);
  assert.match(r.players.get(ps[2]).notes[0].text, /verliebt in Gast3/);
  assert.equal(ww.view(r, ps[0]).mine.task, null);
  assert.equal(ww.view(r, ps[2]).mine.task, 'jaeger');
  pick(r, ps[2], ps[0]);
  assert.equal(alive(r, ps[0]), false);
  assert.equal(r.phase, 'day');
  assert.equal(r.news.at(-1).cause, 'jaeger');
});

test('Gemischtes Liebespaar gewinnt zu zweit', () => {
  const { r, ps } = room(['werwolf', 'amor', 'dorf', 'dorf']);
  ok(r, ps[1], { action: 'pick', target: ps[0] }); ok(r, ps[1], { action: 'pick', target: ps[2] }); ok(r, ps[1], { action: 'done' });
  pick(r, ps[0], ps[3]);
  others(r, ps);
  // 3 leben: Wolf + verliebter Dorfbewohner + Amor. Amor wird verurteilt
  ww.hostAction(r, ps[0], { action: 'skip' });
  pick(r, ps[0], ps[1]); pick(r, ps[2], ps[1]); pick(r, ps[1], ps[0]);
  assert.equal(r.phase, 'end');
  assert.equal(r.winner, 'liebe');
  assert.deepEqual(ww.view(r, ps[1]).winners.sort(), [ps[0], ps[2]].sort());
});

test('Zeit läuft ab: Wolf-Vorauswahl zählt, Amor schießt blind', () => {
  const { r, ps } = room(['werwolf', 'dorf', 'dorf', 'dorf', 'dorf']);
  ok(r, ps[0], { action: 'pick', target: ps[3] });
  ww._endStep(r);
  assert.equal(r.phase, 'day');
  assert.equal(alive(r, ps[3]), false);
  const amor = room(['werwolf', 'amor', 'dorf', 'dorf', 'dorf']);
  ww._endStep(amor.r);
  assert.equal(amor.r.phase, 'day', 'ohne Wolfswahl stirbt niemand');
  assert.equal(amor.r.lovers.length, 2);
  assert.notEqual(amor.r.lovers[0], amor.r.lovers[1]);
});

test('Wer geht, stirbt; der Gastgeber gibt den Raum weiter', () => {
  const { r, ps } = room(['dorf', 'werwolf', 'dorf', 'dorf', 'dorf']);
  ww.leave(r, ps[0]);
  assert.equal(r.hostPid, ps[1]);
  assert.equal(alive(r, ps[0]), false);
  assert.equal(r.players.get(ps[0]).died.cause, 'weg');
  ww.leave(r, ps[1]);
  assert.equal(r.phase, 'end');
  assert.equal(r.winner, 'dorf');
  assert.equal(ww.hostAction(r, r.hostPid, { action: 'lobby' }), null);
  assert.deepEqual([...r.players.keys()], ps.slice(2), 'Gegangene sind in der nächsten Runde weg');
});

test('Chat nur online: Dorf am Tag, Wölfe unter sich, Tote unter sich', () => {
  const lokal = room(['werwolf', 'dorf', 'dorf', 'dorf']);
  assert.match(ww.playerAction(lokal.r, lokal.ps[0], { action: 'chat', text: 'Hallo' }).error, /am Tisch/);
  const { r, ps } = room(['werwolf', 'werwolf', 'dorf', 'dorf', 'dorf', 'dorf'], { mode: 'online' });
  assert.match(ww.playerAction(r, ps[2], { action: 'chat', text: 'Huhu' }).error, /schläft/);
  ok(r, ps[0], { action: 'chat', ch: 'wolf', text: 'Nehmen wir Gast2?' });
  assert.equal(ww.view(r, ps[1]).chat.length, 1);
  assert.equal(ww.view(r, ps[2]).chat.length, 0);
  assert.match(ww.playerAction(r, ps[2], { action: 'chat', ch: 'wolf', text: 'x' }).error, /nicht schreiben/);
  pick(r, ps[0], ps[2]); pick(r, ps[1], ps[2]);
  others(r, ps);
  ok(r, ps[3], { action: 'chat', text: 'Wer war das?' });
  assert.match(ww.playerAction(r, ps[2], { action: 'chat', text: 'Ich war es nicht' }).error, /nicht schreiben/);
  ok(r, ps[2], { action: 'chat', ch: 'tot', text: 'Schade' });
  const dead = ww.view(r, ps[2]);
  assert.deepEqual(dead.chat.map(m => m.ch), ['wolf', 'dorf', 'tot'], 'Tote lesen alles mit');
  assert.ok(dead.players.every(p => p.role), 'und sehen alle Rollen');
  assert.deepEqual(ww.view(r, ps[3]).chat.map(m => m.ch), ['dorf']);
});
