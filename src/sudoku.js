'use strict';
// Tägliches Sudoku: Jeden Tag (Zeitzone der Seite) gibt es drei Sudokus für alle, Leicht, Mittel und Schwer. Der
// Server baut sie beim ersten Aufruf des Tages und legt sie in sd_puzzles ab. Jedes hat genau eine Lösung und lässt
// sich mit Logik lösen, ohne zu raten. Die Lösung verlässt den Server nie im Ganzen: Prüfen und Aufdecken laufen über
// ihn. Mit Konto speichert er den Stand pro Tag und Stufe in sd_progress (Profil, Serie, Bestenliste).
const { db, now } = require('./db');
const TZ = process.env.TZ || 'Europe/Berlin';
const dayOf = ms => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });
const today = () => dayOf(Date.now());
const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// givens: so viele Ziffern stehen höchstens noch da; logic: welche Lösungswege nötig sein dürfen
// (1 = nur „hier passt nur diese Zahl“ und „diese Zahl passt nur hier“, 2 = dazu Paare und Blöcke)
const LEVELS = {
  leicht: { name: 'Leicht', givens: 38, logic: 1 },
  mittel: { name: 'Mittel', givens: 30, logic: 1 },
  schwer: { name: 'Schwer', givens: 17, logic: 2 },
};
const LEVEL_KEYS = Object.keys(LEVELS);
const ARCHIVE_DAYS = 30;      // so weit zurück lassen sich alte Sudokus noch spielen
const MAX_SECONDS = 24 * 3600;

// Zufall mit festem Startwert: gleicher Tag → gleiches Sudoku
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Gitter ----------
// Felder 0–80 Reihe für Reihe; UNITS sind die 27 Reihen, Spalten und Blöcke, PEERS die 20 Nachbarn jedes Feldes
const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) UNITS.push([...Array(9)].map((_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)));
const UNITS_OF = [...Array(81)].map((_, i) => UNITS.filter(u => u.includes(i)));
const PEERS = [...Array(81)].map((_, i) => [...new Set(UNITS_OF[i].flat())].filter(j => j !== i));
const ALL = 0x3FE;            // Bits 1–9
const bits = m => { let n = 0; for (; m; m &= m - 1) n++; return n; };
const digitOf = m => 31 - Math.clz32(m);

function candidates(grid, i) {
  let m = ALL;
  for (const j of PEERS[i]) if (grid[j]) m &= ~(1 << grid[j]);
  return m;
}

// Lösungen zählen (bis limit), immer zuerst das Feld mit den wenigsten Möglichkeiten
function countSolutions(grid, limit = 2) {
  const g = grid.slice();
  let found = 0;
  (function solve() {
    let best = -1, bestM = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = candidates(g, i), n = bits(m);
      if (!n) return;
      if (n < bestN) { best = i; bestM = m; bestN = n; if (n === 1) break; }
    }
    if (best < 0) { found++; return; }
    for (let m = bestM; m && found < limit; m &= m - 1) {
      g[best] = digitOf(m & -m);
      solve();
    }
    g[best] = 0;
  })();
  return found;
}

// Ein volles, gültiges Gitter (zufällige Reihenfolge der Ziffern)
function fullGrid(rand) {
  const g = new Array(81).fill(0);
  (function fill(i) {
    if (i === 81) return true;
    const m = candidates(g, i);
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand)) {
      if (!(m & (1 << d))) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  })(0);
  return g;
}

// Lösen wie ein Mensch. Gibt zurück, ob es klappt und welche Stufe dabei nötig war (siehe LEVELS.logic).
function rate(grid, maxLogic = 2) {
  const g = grid.slice(), cand = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) if (!g[i]) cand[i] = candidates(g, i);
  let left = g.filter(d => !d).length, level = left ? 1 : 0;
  function place(i, d) {
    g[i] = d; cand[i] = 0; left--;
    for (const j of PEERS[i]) cand[j] &= ~(1 << d);
  }
  function singles() {
    for (let i = 0; i < 81; i++) if (!g[i] && bits(cand[i]) === 1) { place(i, digitOf(cand[i])); return true; }
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        let at = -1, n = 0;
        for (const i of u) if (!g[i] && cand[i] & (1 << d)) { at = i; n++; }
        if (n === 1) { place(at, d); return true; }
      }
    }
    return false;
  }
  // Blöcke und Linien: steht eine Ziffer in einer Einheit nur in Feldern, die auch in einer anderen Einheit
  // liegen, fällt sie im Rest der anderen weg. Nackte Paare: zwei Felder mit denselben zwei Möglichkeiten.
  function advanced() {
    let changed = false;
    for (const u of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const where = u.filter(i => !g[i] && cand[i] & (1 << d));
        if (where.length < 2 || where.length > 3) continue;
        for (const v of UNITS_OF[where[0]]) {
          if (v === u || !where.every(i => v.includes(i))) continue;
          for (const j of v) if (!where.includes(j) && !g[j] && cand[j] & (1 << d)) { cand[j] &= ~(1 << d); changed = true; }
        }
      }
      const pairs = u.filter(i => !g[i] && bits(cand[i]) === 2);
      for (let a = 0; a < pairs.length; a++) {
        for (let b = a + 1; b < pairs.length; b++) {
          const m = cand[pairs[a]];
          if (m !== cand[pairs[b]]) continue;
          for (const j of u) if (j !== pairs[a] && j !== pairs[b] && !g[j] && cand[j] & m) { cand[j] &= ~m; changed = true; }
        }
      }
    }
    return changed;
  }
  while (left) {
    if (singles()) continue;
    if (maxLogic >= 2 && advanced()) { level = 2; continue; }
    return { solved: false, level };
  }
  return { solved: true, level };
}

// Ziffern paarweise (punktsymmetrisch) herausnehmen, solange die Lösung eindeutig bleibt und das Sudoku mit der
// erlaubten Logik lösbar ist
function carve(solution, lv, rand) {
  const g = solution.slice();
  let givens = 81;
  for (const i of shuffle([...Array(41)].map((_, k) => k), rand)) {
    if (givens <= lv.givens) break;
    const pair = i === 40 ? [40] : [i, 80 - i];
    const keep = pair.map(k => g[k]);
    for (const k of pair) g[k] = 0;
    if (countSolutions(g) === 1 && rate(g, lv.logic).solved) givens -= pair.length;
    else pair.forEach((k, n) => { g[k] = keep[n]; });
  }
  return g;
}

function generate(seed, level) {
  const lv = LEVELS[level], rand = rng(seed + '/' + level);
  let best = null;
  for (let n = 0; n < 40; n++) {
    const solution = fullGrid(rand), puzzle = carve(solution, lv, rand);
    const r = rate(puzzle, lv.logic), givens = puzzle.filter(Boolean).length;
    // Schwer soll mehr brauchen als die einfachen Wege; sonst das Sudoku mit den wenigsten Ziffern nehmen
    const score = (lv.logic === 2 && r.level === 2 ? 1000 : 0) - givens;
    if (!best || score > best.score) best = { score, puzzle, solution };
    if (lv.logic === 1 ? givens <= lv.givens : r.level === 2 && givens <= 28) break;
  }
  return { givens: best.puzzle.join('').replace(/0/g, '-'), solution: best.solution.join('') };
}

// ---------- Sudokus des Tages ----------
function puzzle(day, level) {
  const get = () => db.prepare('SELECT givens, solution FROM sd_puzzles WHERE day = ? AND level = ?').get(day, level);
  let row = get();
  if (!row) {
    const p = generate(day, level);
    db.prepare('INSERT OR IGNORE INTO sd_puzzles(day, level, givens, solution, created_at) VALUES (?, ?, ?, ?, ?)').run(day, level, p.givens, p.solution, now());
    row = get();
  }
  return { givens: row.givens, solution: row.solution };
}
const validLevel = l => LEVEL_KEYS.includes(l);
// Darf dieser Tag gespielt werden? Heute immer, ältere nur, wenn es die Sudokus schon gab
function playable(day) {
  if (!validDay(day)) return false;
  const t = today();
  if (day === t) return true;
  return day < t && day >= addDays(t, -ARCHIVE_DAYS) && !!db.prepare('SELECT 1 FROM sd_puzzles WHERE day = ?').get(day);
}
function archive() {
  return db.prepare('SELECT DISTINCT day FROM sd_puzzles WHERE day >= ? AND day <= ? ORDER BY day DESC').all(addDays(today(), -ARCHIVE_DAYS), today()).map(r => r.day);
}

// Eingabe aus dem Browser: 81 Zeichen, 1–9 oder '-' für leer. Vorgegebene Ziffern lassen sich nicht ändern.
function cleanDigits(p, digits) {
  const s = String(digits || '');
  let out = '';
  for (let i = 0; i < 81; i++) out += p.givens[i] !== '-' ? p.givens[i] : /[1-9]/.test(s[i] || '') ? s[i] : '-';
  return out;
}
function cellsOf(p, scope, cell) {
  if (scope === 'all') return [...p.givens].map((c, i) => (c === '-' ? i : -1)).filter(i => i >= 0);
  const i = Number(cell);
  return Number.isInteger(i) && i >= 0 && i < 81 && p.givens[i] === '-' ? [i] : [];
}

// ---------- Stand der Mitglieder ----------
function progress(userId, day, level) {
  return db.prepare('SELECT digits, seconds, checks, reveals, gave_up, solved_at FROM sd_progress WHERE user_id = ? AND day = ? AND level = ?').get(userId, day, level) || null;
}
function ensure(userId, day, level, seconds = 0) {
  const t = now();
  db.prepare('INSERT OR IGNORE INTO sd_progress(user_id, day, level, digits, seconds, started_at, updated_at) VALUES (?, ?, ?, \'\', 0, ?, ?)')
    .run(userId, day, level, t - Math.min(Math.max(0, seconds | 0), MAX_SECONDS), t);
  return db.prepare('SELECT * FROM sd_progress WHERE user_id = ? AND day = ? AND level = ?').get(userId, day, level);
}

// Zwischenstand speichern. Die Zeit zählt der Browser (sie hält an, wenn das Fenster nicht sichtbar ist);
// sie kann nur wachsen und nicht länger sein als die Zeit seit dem ersten Speichern.
function save(userId, day, level, { digits, seconds }) {
  const p = puzzle(day, level), clean = cleanDigits(p, digits);
  const solved = clean === p.solution;
  const shown = Math.max(0, Math.round(Number(seconds) || 0));
  if (!userId) return { solved };
  const r = ensure(userId, day, level, shown);
  if (r.solved_at || r.gave_up) return { solved: !!r.solved_at, seconds: r.seconds, done: true };
  const t = now();
  let secs = Math.min(MAX_SECONDS, Math.max(r.seconds, Math.min(shown, t - r.started_at + 5)));
  let solvedAt = null;
  if (solved) {
    // Schneller als vier Ziffern pro Sekunde tippt niemand
    secs = Math.max(secs, Math.ceil(p.givens.replace(/[1-9]/g, '').length / 4));
    solvedAt = t;
  }
  db.prepare('UPDATE sd_progress SET digits = ?, seconds = ?, updated_at = ?, solved_at = ? WHERE user_id = ? AND day = ? AND level = ?')
    .run(clean, secs, t, solvedAt, userId, day, level);
  if (!solved) return { solved: false, seconds: secs };
  return { solved: true, justSolved: true, seconds: secs, help: r.checks + r.reveals > 0, rank: rank(userId, day, level) };
}

// Prüfen: welche eingetragenen Ziffern falsch sind. Mit Konto zählt das als Hilfe.
function check(userId, day, level, { digits, scope, cell }) {
  const p = puzzle(day, level), clean = cleanDigits(p, digits);
  const cells = cellsOf(p, scope, cell);
  const wrong = cells.filter(i => clean[i] !== '-' && clean[i] !== p.solution[i]);
  if (userId && cells.length) {
    const r = ensure(userId, day, level);
    if (!r.solved_at && !r.gave_up) db.prepare('UPDATE sd_progress SET checks = checks + 1 WHERE user_id = ? AND day = ? AND level = ?').run(userId, day, level);
  }
  return { wrong, checked: cells };
}
// Aufdecken: die richtigen Ziffern. Das ganze Sudoku aufdecken heißt aufgeben, dann zählt es nicht als gelöst.
function reveal(userId, day, level, { scope, cell }) {
  const p = puzzle(day, level);
  const cells = cellsOf(p, scope, cell);
  if (userId && cells.length) {
    const r = ensure(userId, day, level);
    if (!r.solved_at && !r.gave_up) {
      db.prepare('UPDATE sd_progress SET reveals = reveals + 1, gave_up = ? WHERE user_id = ? AND day = ? AND level = ?').run(scope === 'all' ? 1 : 0, userId, day, level);
      if (scope === 'all') db.prepare('UPDATE sd_progress SET digits = ? WHERE user_id = ? AND day = ? AND level = ?').run(p.solution, userId, day, level);
    }
  }
  return { cells: cells.map(i => [i, p.solution[i]]) };
}

// Bestenliste eines Tages und einer Stufe: erst ohne Hilfe, dann mit, jeweils nach Zeit
function leaderboard(day, level, limit = 20) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility,
                            s.seconds, s.solved_at, (s.checks + s.reveals) AS help
                     FROM sd_progress s JOIN users u ON u.id = s.user_id
                     WHERE s.day = ? AND s.level = ? AND s.solved_at IS NOT NULL AND s.gave_up = 0 AND u.disabled = 0
                     ORDER BY help > 0, s.seconds, s.solved_at LIMIT ?`).all(day, level, limit);
}
function rank(userId, day, level) {
  const all = db.prepare('SELECT user_id FROM sd_progress WHERE day = ? AND level = ? AND solved_at IS NOT NULL AND gave_up = 0 ORDER BY (checks + reveals) > 0, seconds, solved_at').all(day, level);
  return { place: all.findIndex(r => r.user_id === userId) + 1, of: all.length };
}

// Serie: Tage, an denen mindestens eins der drei Sudokus noch am selben Tag gelöst wurde (ohne Aufgeben)
function streaks(userId) {
  const days = [...new Set(db.prepare('SELECT day, solved_at FROM sd_progress WHERE user_id = ? AND solved_at IS NOT NULL AND gave_up = 0 ORDER BY day').all(userId)
    .filter(r => dayOf(r.solved_at * 1000) === r.day).map(r => r.day))];
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const set = new Set(days);
  let cur = 0, d = set.has(today()) ? today() : addDays(today(), -1);
  while (set.has(d)) { cur++; d = addDays(d, -1); }
  return { streak: cur, best_streak: best };
}

function userTotals(userId) {
  const t = db.prepare(`SELECT COUNT(*) AS solved, COALESCE(SUM(checks + reveals = 0), 0) AS clean, MAX(solved_at) AS last
                        FROM sd_progress WHERE user_id = ? AND solved_at IS NOT NULL AND gave_up = 0`).get(userId);
  t.levels = {};
  for (const k of LEVEL_KEYS) {
    t.levels[k] = db.prepare(`SELECT COUNT(*) AS solved, MIN(CASE WHEN checks + reveals = 0 THEN seconds END) AS best
                              FROM sd_progress WHERE user_id = ? AND level = ? AND solved_at IS NOT NULL AND gave_up = 0`).get(userId, k);
  }
  return Object.assign(t, streaks(userId));
}

function resetStats(userId) {
  if (userId) db.prepare('DELETE FROM sd_progress WHERE user_id = ?').run(userId);
  else db.prepare('DELETE FROM sd_progress').run();
}

module.exports = {
  LEVELS, LEVEL_KEYS, ARCHIVE_DAYS, today, validDay, validLevel, addDays, countSolutions, rate, generate, puzzle, playable, archive,
  cleanDigits, progress, save, check, reveal, leaderboard, rank, userTotals, resetStats,
};
