'use strict';
// Daddelecke (src/daddelecke.js): Aufbau der Seite aus Regalen, Einbett-Adressen, Startbefehl für DOS-Spiele, Namen neuer Spiele.
// Aufruf: node --test test/daddelecke.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.PUID = '0';
const dd = require('../src/daddelecke');
// Kartentische und Lobbys halten Zeitgeber offen: nach den Tests aufräumen und beenden
test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); setImmediate(() => process.exit(process.exitCode || 0)); });

test('Regale: jedes Spiel genau einmal, fehlende in ihr Standardregal', () => {
  const keys = new Set(['sudoku', 'minesweeper', 'uno', 'mein-spiel']);
  const l = dd.normalize({ shelves: [{ id: 'a', title: 'Erstes', games: ['uno', 'sudoku', 'uno', 'gibtsnicht'] }, { id: 'a', title: 'Doppelt', games: ['sudoku'] }] }, keys);
  assert.deepEqual(l.shelves[0].games, ['uno', 'sudoku']);
  assert.notEqual(l.shelves[1].id, 'a', 'doppelte Regal-Kennung wird ersetzt');
  assert.deepEqual(l.shelves[1].games, []);
  const all = l.shelves.flatMap(s => s.games).sort();
  assert.deepEqual(all, [...keys].sort());
  assert.ok(l.shelves.find(s => s.id === 'raetsel').games.includes('minesweeper'));
  assert.ok(l.shelves.find(s => s.id === 'mitgebracht').games.includes('mein-spiel'));
});

test('Regale: Texte werden gekürzt, Heute-Schalter haben Vorgaben', () => {
  const l = dd.normalize({ title: 'x'.repeat(500), today: { daily: false }, shelves: [{ id: '<b>', title: '', games: [] }] }, new Set());
  assert.equal(l.title.length, 80);
  assert.equal(l.today.daily, false);
  assert.equal(l.today.tables, true);
  assert.equal(l.shelves[0].id, 'b');
  assert.equal(l.shelves[0].title, 'Regal');
});

test('Einbetten: nur https, auch aus einem <iframe>-Code', () => {
  assert.equal(dd.embedUrl('https://example.org/spiel?a=1'), 'https://example.org/spiel?a=1');
  assert.equal(dd.embedUrl('<iframe width="800" src="https://itch.io/embed-upload/1?color=333&amp;x=1"></iframe>'), 'https://itch.io/embed-upload/1?color=333&x=1');
  assert.equal(dd.embedUrl('http://example.org/'), '');
  assert.equal(dd.embedUrl('javascript:alert(1)'), '');
  assert.equal(dd.embedUrl(''), '');
});

test('DOS: Startdatei raten und Befehl säubern', () => {
  assert.equal(dd.guessExe(['SETUP.EXE', 'GAME/INSTALL.EXE', 'GAME/KEEN.EXE', 'README.TXT']), 'cd GAME;KEEN.EXE');
  assert.equal(dd.guessExe(['A/B/DEEP.EXE', 'TOP.BAT']), 'TOP.BAT');
  assert.equal(dd.guessExe(['readme.txt']), '');
  assert.equal(dd.cleanCmd('cd GAME; KEEN.EXE && rm -rf "/"'), 'cd GAME; KEEN.EXE  rm -rf /');
});

test('Namen neuer Spiele kollidieren nicht mit eingebauten', () => {
  assert.equal(dd.slugFor('Mein Spiel!'), 'mein-spiel');
  assert.equal(dd.slugFor('Süßes Ödland'), 'suesses-oedland');
  assert.notEqual(dd.slugFor('Sudoku'), 'sudoku');
  assert.notEqual(dd.slugFor('neu'), 'neu');
});
