'use strict';
// Sudoku ohne Browser: Erzeugen (eindeutig, lösbar, Stufen), Prüfen/Aufdecken/Speichern und Serien.
// Aufruf: node --test test/sudoku.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'));
process.env.PUID = '0';
const { db, now } = require('../src/db');
const sd = require('../src/sudoku');

let nextId = 0;
function user(name) {
  return Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
}
const toGrid = s => [...s].map(c => (c === '-' ? 0 : Number(c)));

// Jede Reihe, Spalte und jeder Block enthält 1–9 genau einmal
function validSolution(s) {
  const g = toGrid(s);
  for (let k = 0; k < 9; k++) {
    const row = new Set(), col = new Set(), box = new Set();
    for (let j = 0; j < 9; j++) {
      row.add(g[k * 9 + j]); col.add(g[j * 9 + k]);
      box.add(g[(Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)]);
    }
    for (const set of [row, col, box]) assert.deepEqual([...set].sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }
}

test('Erzeugen: gleicher Tag gibt dasselbe Sudoku, genau eine Lösung, Stufen unterscheiden sich', () => {
  assert.deepEqual(sd.generate('2026-01-01', 'mittel'), sd.generate('2026-01-01', 'mittel'));
  for (let i = 0; i < 4; i++) {
    const givens = {};
    for (const level of sd.LEVEL_KEYS) {
      const p = sd.generate('seed' + i, level), g = toGrid(p.givens);
      validSolution(p.solution);
      assert.ok([...p.givens].every((c, k) => c === '-' || c === p.solution[k]), 'Vorgaben passen zur Lösung');
      assert.equal(sd.countSolutions(g), 1, 'genau eine Lösung');
      const r = sd.rate(g, sd.LEVELS[level].logic);
      assert.ok(r.solved, 'ohne Raten lösbar');
      if (level === 'schwer') assert.equal(r.level, 2, 'Schwer braucht mehr als die einfachen Wege');
      for (let k = 0; k < 81; k++) assert.equal(p.givens[k] === '-', p.givens[80 - k] === '-', 'symmetrisch');
      givens[level] = g.filter(Boolean).length;
    }
    assert.ok(givens.leicht > givens.mittel && givens.mittel > givens.schwer, JSON.stringify(givens));
  }
});

test('Sudokus des Tages bleiben gleich, Archiv nur für vorhandene Tage', () => {
  const day = sd.today();
  const a = sd.puzzle(day, 'leicht');
  assert.deepEqual(sd.puzzle(day, 'leicht'), a);
  assert.notEqual(sd.puzzle(day, 'schwer').givens, a.givens);
  assert.ok(sd.playable(day));
  assert.ok(!sd.playable(sd.addDays(day, 1)));
  assert.ok(!sd.playable(sd.addDays(day, -3)));
  assert.ok(!sd.playable('2026-13-45'));
  assert.deepEqual(sd.archive(), [day]);
});

test('Prüfen, Aufdecken, Speichern und Bestenliste', () => {
  const day = sd.today(), p = sd.puzzle(day, 'mittel'), sol = p.solution;
  const anna = user('anna'), bernd = user('bernd');
  // Ohne Konto: nur die Antwort, nichts gespeichert
  assert.deepEqual(sd.save(null, day, 'mittel', { digits: sol, seconds: 99 }), { solved: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sd_progress').get().n, 0);
  // Vorgaben lassen sich nicht überschreiben
  const g = [...p.givens].findIndex(c => c !== '-');
  assert.equal(sd.cleanDigits(p, '1'.repeat(81))[g], p.givens[g]);
  // Falsche Ziffer wird beim Prüfen gefunden, leere Felder nicht
  const i = p.givens.indexOf('-');
  const wrong = p.givens.slice(0, i) + (sol[i] === '1' ? '2' : '1') + p.givens.slice(i + 1);
  assert.deepEqual(sd.check(anna, day, 'mittel', { digits: wrong, scope: 'all' }).wrong, [i]);
  assert.deepEqual(sd.check(anna, day, 'mittel', { digits: wrong, scope: 'cell', cell: g }).checked, [], 'Vorgaben prüft man nicht');
  assert.equal(sd.save(anna, day, 'mittel', { digits: wrong, seconds: 30 }).solved, false);
  assert.deepEqual(sd.reveal(anna, day, 'mittel', { scope: 'cell', cell: i }).cells, [[i, sol[i]]]);
  let r = sd.save(anna, day, 'mittel', { digits: sol, seconds: 200 });
  assert.equal(r.solved, true);
  assert.equal(r.help, true);
  // Bernd löst ohne Hilfe: steht vor Anna, obwohl langsamer
  r = sd.save(bernd, day, 'mittel', { digits: sol, seconds: 400 });
  assert.equal(r.help, false);
  assert.deepEqual(r.rank, { place: 1, of: 2 });
  assert.deepEqual(sd.leaderboard(day, 'mittel').map(u => u.id), [bernd, anna]);
  assert.deepEqual(sd.leaderboard(day, 'leicht'), [], 'jede Stufe hat ihre eigene Liste');
  // Nach dem Lösen ändert nichts mehr den Stand
  sd.reveal(bernd, day, 'mittel', { scope: 'all' });
  assert.equal(sd.progress(bernd, day, 'mittel').gave_up, 0);
  const t = sd.userTotals(bernd);
  assert.deepEqual([t.solved, t.clean, t.levels.mittel.best, t.levels.leicht.best, t.streak], [1, 1, 400, null, 1]);
  // Aufgelöst zählt nicht als gelöst
  const carl = user('carl');
  sd.reveal(carl, day, 'schwer', { scope: 'all' });
  assert.equal(sd.save(carl, day, 'schwer', { digits: sd.puzzle(day, 'schwer').solution, seconds: 5 }).solved, false);
  assert.equal(sd.userTotals(carl).solved, 0);
});

test('Serie zählt Tage mit mindestens einem am selben Tag gelösten Sudoku', () => {
  const u = user('dora'), today = sd.today();
  const at = (day, plusDays = 0) => Math.floor(Date.parse(sd.addDays(day, plusDays) + 'T10:00:00Z') / 1000);
  const ins = db.prepare('INSERT INTO sd_progress(user_id, day, level, digits, seconds, started_at, updated_at, solved_at) VALUES (?, ?, ?, \'\', 60, ?, ?, ?)');
  for (const d of [-1, -2, -3]) { const day = sd.addDays(today, d); ins.run(u, day, 'leicht', at(day), at(day), at(day)); }
  const two = sd.addDays(today, -2);
  ins.run(u, two, 'schwer', at(two), at(two), at(two));       // zwei Stufen am selben Tag zählen einmal
  for (const d of [-6, -7]) { const day = sd.addDays(today, d); ins.run(u, day, 'mittel', at(day), at(day), at(day)); }
  const late = sd.addDays(today, -5);
  ins.run(u, late, 'leicht', at(late), at(late), at(late, 1));   // erst am nächsten Tag gelöst
  const t = sd.userTotals(u);
  assert.equal(t.solved, 7);
  assert.equal(t.streak, 3, 'gestern, vorgestern, vorvorgestern – heute noch offen');
  assert.equal(t.best_streak, 3);
  sd.resetStats(u);
  assert.equal(sd.userTotals(u).solved, 0);
});
