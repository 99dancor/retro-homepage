'use strict';
// Quiz ohne Browser: Raum direkt bedienen und prüfen, wie gewertet wird.
// Aufruf: node --test test/quiz.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const quiz = require('../src/quiz');
const qr = require('../src/qr');

let nextId = 0;
function member(name) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
  const user = { id, username: name + nextId, name, isAdmin: false, avatar: null };
  return { pid: 'u' + id, user, name };
}
const guest = n => ({ pid: 'g' + n, user: null, name: '' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function room(players = 3) {
  const host = member('Tobi');
  const r = quiz.create(host, { name: 'Testraum' });
  const ps = [];
  for (let i = 0; i < players; i++) {
    const p = i === 0 ? member('Lena') : guest('p' + i);
    assert.deepEqual(quiz.join(r, p, { name: 'Gast' + i, emoji: '🦉' }), { ok: true });
    ps.push(p.pid);
  }
  return { r, host, ps };
}
const act = (r, b) => { const e = quiz.hostAction(r, b); assert.equal(e, null, b.action + ': ' + e); };
const score = (r, pid) => r.players.get(pid).score;
function ask(r, q) {
  act(r, { action: 'edit', index: r.cur, q });
  act(r, { action: 'open' });
}

test('Zahlen lesen wie man sie tippt', () => {
  assert.equal(quiz.parseNumber('1.234'), 1234);
  assert.equal(quiz.parseNumber('1.234,5'), 1234.5);
  assert.equal(quiz.parseNumber('3,5'), 3.5);
  assert.equal(quiz.parseNumber('3.5'), 3.5);
  assert.equal(quiz.parseNumber(' 200 '), 200);
  assert.equal(quiz.parseNumber('abc'), null);
  assert.ok(quiz.matches('Furby ', 'furby'));
  assert.ok(quiz.matches('Müller', 'Mueller|Müller'));
  assert.ok(!quiz.matches('', 'x'));
});

test('Beitreten: Gäste brauchen einen Namen, Namen sind pro Raum eindeutig, Rauswurf gilt', () => {
  const { r, ps } = room(2);
  assert.match(quiz.join(r, guest('neu'), { name: '' }).error, /Namen/);
  assert.match(quiz.join(r, guest('neu'), { name: 'gast1' }).error, /gibt es in diesem Raum schon/);
  act(r, { action: 'kick', pid: ps[1] });
  assert.match(quiz.join(r, guest('p1'), { name: 'Wieder da' }).error, /aus diesem Raum genommen/);
  act(r, { action: 'settings', guests: false });
  assert.ok(quiz.join(r, guest('x'), { name: 'X' }).login);
  quiz.remove(r);
});

test('Multiple Choice: richtig, falsch, nichts; Spieler sehen die Lösung erst bei der Auflösung', () => {
  const { r, ps } = room(3);
  act(r, { action: 'start' });
  ask(r, { type: 'mc', text: 'Nevermind?', options: ['Pearl Jam', 'Nirvana', 'Soundgarden', ''], correct: 1, right: 100, wrong: -50 });
  assert.match(quiz.playerAction(r, ps[0], { action: 'answer', value: 3 }).error, /gibt es nicht/, 'leere Antwort D');
  quiz.playerAction(r, ps[0], { action: 'answer', value: 0 });
  quiz.playerAction(r, ps[0], { action: 'answer', value: 1 });   // umentschieden
  quiz.playerAction(r, ps[1], { action: 'answer', value: 2 });
  let seen = null;
  const fake = { write: s => { if (s.startsWith('event: state')) seen = JSON.parse(s.split('data: ')[1]); }, end() {} };
  const leave = quiz.connect(r, ps[1], fake);
  assert.equal(JSON.stringify(seen.q).includes('correct'), false);
  assert.equal(seen.my.answer, 2);
  act(r, { action: 'reveal' });
  assert.equal(r.phase, 'reveal');
  assert.deepEqual([score(r, ps[0]), score(r, ps[1]), score(r, ps[2])], [100, -50, 0]);
  quiz.broadcast(r);
  assert.equal(seen.result.correct.text, 'Nirvana');
  leave();
  quiz.remove(r);
});

test('Schätzen Top 3 mit Gleichstand, ohne Minuspunkte', () => {
  const { r, ps } = room(4);
  act(r, { action: 'start' });
  ask(r, { type: 'estimate', text: 'Folgen Friends?', answer: '236', unit: 'Folgen', right: 100, estimate: 'top3' });
  [['220'], ['252'], ['300'], ['']].forEach(([v], i) => quiz.playerAction(r, ps[i], { action: 'input', text: v }));
  act(r, { action: 'reveal' });
  assert.deepEqual(ps.map(p => score(r, p)), [100, 100, 30, 0], '220 und 252 liegen beide 16 daneben: geteilter erster Platz');
  assert.equal(r.result.target, 236);
  act(r, { action: 'next' });
  ask(r, { type: 'estimate', text: 'Höhe?', answer: '100', estimate: 'scaled' });
  quiz.playerAction(r, ps[0], { action: 'input', text: '75' });
  act(r, { action: 'reveal' });
  assert.equal(r.players.get(ps[0]).delta, 75);
  quiz.remove(r);
});

test('Buzzer: frühester Druck zählt, falsch gibt den anderen Punkte, dann der Nächste', async () => {
  const { r, ps } = room(3);
  act(r, { action: 'start' });
  ask(r, { type: 'buzzer', text: 'Sprechendes Spielzeug?', answer: 'Furby', right: 150, wrong: -50, others: 1, answerTime: 10 });
  await sleep(40);
  // p1 kommt zuerst an, p0 hat aber laut Browser früher gedrückt (langsamere Verbindung)
  quiz.playerAction(r, ps[1], { action: 'buzz', ms: 35 });
  quiz.playerAction(r, ps[0], { action: 'buzz', ms: 5 });
  assert.equal(r.buzz.answering, null, 'erst nach der kurzen Wartezeit');
  await sleep(320);
  assert.equal(r.buzz.answering, ps[0]);
  quiz.playerAction(r, ps[0], { action: 'input', text: 'Tamagotchi' });
  act(r, { action: 'wrong' });
  assert.deepEqual(ps.map(p => score(r, p)), [-50, 1, 1], 'alle anderen bekommen einen Punkt');
  assert.equal(r.buzz.answering, ps[1], 'weiter zum Nächsten in der Reihe');
  act(r, { action: 'right' });
  assert.equal(r.phase, 'reveal');
  assert.deepEqual(ps.map(p => score(r, p)), [-50, 151, 1]);
  assert.equal(r.players.get(ps[1]).delta, 151);
  quiz.remove(r);
});

test('Buzzer: nach falsch ohne Reihe ist der Buzzer wieder frei, ohne „nochmal“ ist Schluss', async () => {
  const { r, ps } = room(2);
  act(r, { action: 'start' });
  ask(r, { type: 'buzzer', text: 'Frage?', answer: 'x' });
  quiz.playerAction(r, ps[0], { action: 'buzz' });
  await sleep(300);
  act(r, { action: 'wrong' });
  assert.equal(r.phase, 'open');
  assert.ok(r.deadline > Date.now(), 'Timer läuft weiter');
  assert.equal(quiz.playerAction(r, ps[0], { action: 'buzz' }).error, null);
  assert.equal(r.buzz.queue.length, 0, 'wer falsch lag, darf nicht nochmal');
  quiz.remove(r);
});

test('Freitext: passende Antworten sind vorgeschlagen, der Spielleiter hakt ab', () => {
  const { r, ps } = room(3);
  act(r, { action: 'start' });
  ask(r, { type: 'text', text: 'Nenne ein Spice Girl', answer: 'Mel B|Mel C|Emma|Geri|Victoria', right: 50, wrong: 0 });
  quiz.playerAction(r, ps[0], { action: 'input', text: 'emma' });
  quiz.playerAction(r, ps[1], { action: 'input', text: 'Sporty Spice' });
  act(r, { action: 'reveal' });
  assert.equal(r.phase, 'judge');
  assert.equal(r.marks.get(ps[0]), true);
  assert.equal(r.marks.get(ps[1]), false);
  act(r, { action: 'mark', pid: ps[1], ok: true });
  act(r, { action: 'score' });
  assert.deepEqual(ps.map(p => score(r, p)), [50, 50, 0]);
  quiz.remove(r);
});

test('Extrapunkte von Hand, für einen und für alle, und Rückgängig', () => {
  const { r, ps } = room(3);
  act(r, { action: 'start' });
  act(r, { action: 'give', pid: ps[2], points: 7 });
  act(r, { action: 'give', pid: 'all', points: 2 });
  assert.deepEqual(ps.map(p => score(r, p)), [2, 2, 9]);
  act(r, { action: 'undo' });
  assert.deepEqual(ps.map(p => score(r, p)), [0, 0, 7]);
  assert.match(quiz.hostAction(r, { action: 'give', pid: ps[0], points: 0 }), /Punktzahl/);
  quiz.remove(r);
});

test('Ende: Plätze, Auszeichnungen und Profil-Statistik', async () => {
  const { r, ps } = room(2);
  act(r, { action: 'start' });
  ask(r, { type: 'tf', text: 'Die Erde ist rund', correct: 0, right: 10 });
  quiz.playerAction(r, ps[0], { action: 'answer', value: 0 });
  quiz.playerAction(r, ps[1], { action: 'answer', value: 1 });
  act(r, { action: 'reveal' });
  act(r, { action: 'end' });
  assert.equal(r.phase, 'end');
  assert.deepEqual(r.awards.places.map(p => p.place), [1, 2]);
  assert.deepEqual(r.awards.hardest, { q: 1, right: 1 });
  const lena = r.players.get(ps[0]);
  const t = quiz.userTotals(lena.userId);
  assert.deepEqual([t.games, t.wins, t.best, t.correct, t.asked], [1, 1, 1, 1, 1]);
  assert.equal(quiz.userTotals(r.hostUserId).hosted, 1);
  const rows = db.prepare('SELECT name, guest, place FROM quiz_results ORDER BY place').all().slice(-2);
  assert.equal(rows[1].guest, 1);
  quiz.remove(r);
});

test('Spontane Fragen: „Nächste“ legt eine neue an, Multiple Choice ohne Lösung wählt der Spielleiter', () => {
  const { r, ps } = room(1);
  act(r, { action: 'start' });
  assert.equal(r.questions.length, 1);
  ask(r, { type: 'mc', text: 'Spontan', options: ['a', 'b', '', ''] });
  quiz.playerAction(r, ps[0], { action: 'answer', value: 1 });
  act(r, { action: 'reveal' });
  assert.equal(r.phase, 'judge');
  act(r, { action: 'pick', index: 1 });
  assert.equal(score(r, ps[0]), 100);
  act(r, { action: 'next' });
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[1].type, 'mc');
  assert.equal(r.phase, 'prep');
  quiz.remove(r);
});

test('QR-Code hat die richtige Größe und Suchmuster', () => {
  const m = qr.matrix('https://dancor.org/quiz/K7QX');
  assert.equal(m.length, 29);
  assert.deepEqual(m[0].slice(0, 7), Array(7).fill(true));
  assert.deepEqual(m[1].slice(0, 7), [true, false, false, false, false, false, true]);
  assert.match(qr.svg('x'), /^<svg[\s\S]*<path d="M4 4h1v1h-1z/);
});
