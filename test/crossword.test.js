'use strict';
// Kreuzworträtsel ohne Browser: Wortliste, Aufbau des Gitters, Prüfen/Aufdecken/Speichern und Serien.
// Aufruf: node --test test/crossword.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-test-'));
process.env.PUID = '0';
const { db, now, setSetting } = require('../src/db');
const cw = require('../src/crossword');

let nextId = 0;
function user(name) {
  return Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name + ++nextId, now()).lastInsertRowid);
}

test('Wortliste: gültige Wörter, keine doppelten, Hinweis verrät das Wort nicht', () => {
  const lines = require('../src/crossword-words').split('\n').filter(l => l.includes('='));
  const words = cw.parseWords(lines.join('\n'));
  assert.equal(words.length, lines.length, 'jede Zeile ergibt ein Wort');
  assert.ok(words.length >= 500);
  const seen = new Set();
  for (const w of words) {
    assert.ok(!seen.has(w.answer), 'doppelt: ' + w.answer);
    seen.add(w.answer);
    for (const token of w.clue.split(/[^\p{L}]+/u)) {
      assert.ok(!(cw.normalize(token) || '').includes(w.answer), `Hinweis enthält das Wort: ${w.answer} = ${w.clue}`);
    }
  }
  assert.equal(cw.normalize('Größe'), 'GROESSE');
  assert.equal(cw.normalize('Bär'), 'BAER');
  assert.equal(cw.normalize('Ein Wort'), null);
});

// Jede zusammenhängende Buchstabenfolge (ab zwei) muss genau ein Wort des Rätsels sein
function checkGrid(p) {
  const sol = cw.solution(p);
  const runs = [];
  for (const dir of ['a', 'd']) {
    const outer = dir === 'a' ? p.h : p.w, inner = dir === 'a' ? p.w : p.h;
    for (let o = 0; o < outer; o++) {
      let run = '', sx = 0, sy = 0;
      for (let k = 0; k <= inner; k++) {
        const x = dir === 'a' ? k : o, y = dir === 'a' ? o : k;
        const c = k < inner ? sol[y * p.w + x] : '#';
        if (c !== '#') { if (!run) { sx = x; sy = y; } run += c; }
        else { if (run.length > 1) runs.push(`${dir}${sx},${sy}:${run}`); run = ''; }
      }
    }
  }
  const words = p.words.map(w => `${w.dir}${w.x},${w.y}:${w.answer}`);
  assert.deepEqual(runs.sort(), words.slice().sort());
  // Nummern laufen ohne Lücke ab 1
  const nums = [...new Set(p.words.map(w => w.num))].sort((a, b) => a - b);
  assert.deepEqual(nums, nums.map((n, i) => i + 1));
}

test('Gitter: gleicher Startwert gibt dasselbe Rätsel, Wörter berühren sich nur an Kreuzungen', () => {
  const pool = cw.wordPool();
  assert.deepEqual(cw.generate('2026-01-01', pool), cw.generate('2026-01-01', pool));
  for (let i = 0; i < 8; i++) {
    const p = cw.generate('seed' + i, pool);
    assert.ok(p.w <= cw.SIZE && p.h <= cw.SIZE);
    assert.ok(p.words.length >= 15, 'genug Wörter: ' + p.words.length);
    checkGrid(p);
  }
});

test('Rätsel des Tages bleibt gleich und nimmt keine Wörter der Vortage', () => {
  const a = cw.puzzle('2026-03-01');
  assert.deepEqual(cw.puzzle('2026-03-01'), a);
  const b = cw.puzzle('2026-03-02');
  const used = new Set(a.words.map(w => w.answer));
  assert.ok(b.words.every(w => !used.has(w.answer)));
  // Die Antworten gehen nicht an den Browser
  assert.ok(!JSON.stringify(cw.publicPuzzle(a)).includes(a.words[0].answer + '"'));
  assert.equal(cw.publicPuzzle(a).words[0].len, a.words[0].answer.length);
});

test('Eigene Wörter des Admins ersetzen eingebaute', () => {
  setSetting('cw_words', 'Unraid=Server-Betriebssystem\nRom=Ewige Stadt\nkaputt\n#Kommentar=nein');
  const pool = cw.wordPool();
  assert.equal(pool.find(w => w.answer === 'UNRAID').clue, 'Server-Betriebssystem');
  assert.equal(pool.find(w => w.answer === 'ROM').clue, 'Ewige Stadt');
  assert.ok(!pool.some(w => w.answer === 'KOMMENTAR'));
  setSetting('cw_words', '');
});

test('Prüfen, Aufdecken, Speichern und Bestenliste', () => {
  const day = cw.today(), p = cw.puzzle(day), sol = cw.solution(p);
  const anna = user('anna'), bernd = user('bernd');
  const empty = sol.replace(/[A-Z]/g, '-');
  // Ohne Konto: nur die Antwort, nichts gespeichert
  assert.deepEqual(cw.save(null, day, { letters: sol, seconds: 99 }), { solved: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cw_progress').get().n, 0);
  // Falscher Buchstabe wird beim Prüfen gefunden, leere Felder nicht
  const i = sol.search(/[A-Z]/);
  const wrong = empty.slice(0, i) + (sol[i] === 'Q' ? 'X' : 'Q') + empty.slice(i + 1);
  assert.deepEqual(cw.check(anna, day, { letters: wrong, scope: 'all' }).wrong, [i]);
  assert.equal(cw.save(anna, day, { letters: wrong, seconds: 30 }).solved, false);
  const w = p.words[0];
  const rev = cw.reveal(anna, day, { scope: 'word', cell: w.y * p.w + w.x, dir: w.dir });
  assert.equal(rev.cells.map(c => c[1]).join(''), w.answer);
  let r = cw.save(anna, day, { letters: sol, seconds: 200 });
  assert.equal(r.solved, true);
  assert.equal(r.help, true);
  // Bernd löst ohne Hilfe: steht vor Anna, obwohl langsamer
  r = cw.save(bernd, day, { letters: sol, seconds: 400 });
  assert.equal(r.help, false);
  assert.deepEqual(r.rank, { place: 1, of: 2 });
  assert.deepEqual(cw.leaderboard(day).map(u => u.id), [bernd, anna]);
  // Nach dem Lösen ändert nichts mehr den Stand
  cw.reveal(bernd, day, { scope: 'all' });
  assert.equal(cw.progress(bernd, day).gave_up, 0);
  const t = cw.userTotals(bernd);
  assert.deepEqual([t.solved, t.clean, t.best, t.streak], [1, 1, 400, 1]);
  // Aufgelöst zählt nicht als gelöst
  const carl = user('carl');
  cw.reveal(carl, day, { scope: 'all' });
  assert.equal(cw.save(carl, day, { letters: sol, seconds: 5 }).solved, false);
  assert.equal(cw.userTotals(carl).solved, 0);
});

test('Serie zählt nur Tage, an denen am selben Tag gelöst wurde', () => {
  const u = user('dora'), today = cw.today();
  const at = (day, plusDays = 0) => Math.floor(Date.parse(cw.addDays(day, plusDays) + 'T10:00:00Z') / 1000);
  const ins = db.prepare('INSERT INTO cw_progress(user_id, day, letters, seconds, started_at, updated_at, solved_at) VALUES (?, ?, \'\', 60, ?, ?, ?)');
  for (const d of [-1, -2, -3]) { const day = cw.addDays(today, d); ins.run(u, day, at(day), at(day), at(day)); }
  for (const d of [-6, -7]) { const day = cw.addDays(today, d); ins.run(u, day, at(day), at(day), at(day)); }
  const late = cw.addDays(today, -5);
  ins.run(u, late, at(late), at(late), at(late, 1));   // erst am nächsten Tag gelöst
  const t = cw.userTotals(u);
  assert.equal(t.solved, 6);
  assert.equal(t.streak, 3, 'gestern, vorgestern, vorvorgestern – heute noch offen');
  assert.equal(t.best_streak, 3);
  cw.resetStats(u);
  assert.equal(cw.userTotals(u).solved, 0);
});
