'use strict';
// Tägliches Kreuzworträtsel: Jeden Tag (Zeitzone der Seite) gibt es ein Rätsel für alle. Der Server baut es beim
// ersten Aufruf des Tages aus der Wortliste (src/crossword-words.js + eigene Wörter des Admins) und legt es in
// cw_puzzles ab, damit es den ganzen Tag gleich bleibt. Die Lösung verlässt den Server nie im Ganzen: Prüfen und
// Aufdecken laufen über ihn. Mit Konto speichert er den Stand pro Tag in cw_progress (Profil, Serie, Bestenliste).
const { db, now, getSetting } = require('./db');
const BUILTIN = require('./crossword-words');

const TZ = process.env.TZ || 'Europe/Berlin';
const SIZE = 13;              // größtes Gitter (Breite und Höhe)
const TARGET = 24;            // so viele Wörter höchstens pro Rätsel
const MIN_WORDS = 12;
const RECENT_DAYS = 7;        // Wörter der letzten Tage nicht gleich wieder verwenden
const ARCHIVE_DAYS = 30;      // so weit zurück lassen sich alte Rätsel noch spielen
const MAX_SECONDS = 24 * 3600;

const dayOf = ms => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });
const today = () => dayOf(Date.now());
const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Wie in deutschen Rätseln: Ä → AE, Ö → OE, Ü → UE, ß → SS, nur A–Z
function normalize(word) {
  const s = String(word || '').trim().toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ|ß/g, 'SS');
  return /^[A-Z]+$/.test(s) ? s : null;
}
// „Wort=Hinweis“ pro Zeile; Zeilen mit # sind Kommentare
function parseWords(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const answer = normalize(line.slice(0, i)), clue = line.slice(i + 1).trim().replace(/\s+/g, ' ').slice(0, 120);
    if (answer && answer.length >= 3 && answer.length <= SIZE && clue) out.push({ answer, clue });
  }
  return out;
}
// Eigene Wörter des Admins ersetzen gleichnamige eingebaute (anderer Hinweis)
function wordPool() {
  const map = new Map();
  for (const w of parseWords(BUILTIN)) map.set(w.answer, w);
  for (const w of parseWords(getSetting('cw_words', ''))) map.set(w.answer, w);
  return [...map.values()];
}

// Zufall mit festem Startwert: gleicher Tag → gleiches Rätsel (solange Wortliste und Vorgeschichte gleich sind)
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

// ---------- Gitter bauen ----------
// Freies Kreuzworträtsel wie in Zeitschriften: Wörter kreuzen sich, berühren sich aber sonst nirgends.
function attempt(words, rand) {
  const N = SIZE, grid = new Array(N * N).fill(null), dirs = new Array(N * N).fill(0);
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? null : grid[y * N + x]);
  const placed = [];
  const used = new Set();
  function fits(word, x, y, d) {
    const dx = d === 'a' ? 1 : 0, dy = d === 'a' ? 0 : 1, bit = d === 'a' ? 1 : 2;
    const ex = x + dx * (word.length - 1), ey = y + dy * (word.length - 1);
    if (x < 0 || y < 0 || ex >= N || ey >= N) return -1;
    if (at(x - dx, y - dy) || at(ex + dx, ey + dy)) return -1;
    let cross = 0;
    for (let i = 0; i < word.length; i++) {
      const cx = x + dx * i, cy = y + dy * i, c = grid[cy * N + cx];
      if (c) {
        if (c !== word[i] || dirs[cy * N + cx] & bit) return -1;
        cross++;
      } else if (at(cx + dy, cy + dx) || at(cx - dy, cy - dx)) return -1;
    }
    return cross === word.length ? -1 : cross;
  }
  function put(w, x, y, d) {
    const dx = d === 'a' ? 1 : 0, dy = d === 'a' ? 0 : 1;
    for (let i = 0; i < w.answer.length; i++) {
      const k = (y + dy * i) * N + x + dx * i;
      grid[k] = w.answer[i]; dirs[k] |= d === 'a' ? 1 : 2;
    }
    placed.push({ ...w, x, y, dir: d });
    used.add(w.answer);
  }
  const list = shuffle(words, rand);
  const first = list.find(w => w.answer.length >= 6 && w.answer.length <= 9) || list[0];
  put(first, Math.floor((N - first.answer.length) / 2), Math.floor(N / 2), 'a');
  let crossings = 0;
  while (placed.length < TARGET) {
    let best = null;
    // Pro Runde nur einen Teil der Wörter prüfen, das hält den Aufbau schnell und abwechslungsreich
    const offset = Math.floor(rand() * list.length);
    for (let n = 0, tried = 0; n < list.length && tried < 160; n++) {
      const w = list[(offset + n) % list.length];
      if (used.has(w.answer)) continue;
      tried++;
      for (let k = 0; k < N * N; k++) {
        const c = grid[k];
        if (!c) continue;
        const gx = k % N, gy = Math.floor(k / N);
        for (let i = 0; i < w.answer.length; i++) {
          if (w.answer[i] !== c) continue;
          for (const d of dirs[k] & 1 ? ['d'] : ['a']) {
            const x = d === 'a' ? gx - i : gx, y = d === 'a' ? gy : gy - i;
            const cross = fits(w.answer, x, y, d);
            if (cross < 1) continue;
            // Mehr Kreuzungen und nah an der Mitte sind besser; ein wenig Zufall für Abwechslung
            const mid = Math.abs(x + (d === 'a' ? w.answer.length / 2 : 0) - N / 2) + Math.abs(y + (d === 'd' ? w.answer.length / 2 : 0) - N / 2);
            const score = cross * 10 + w.answer.length - mid * 0.5 + rand() * 2;
            if (!best || score > best.score) best = { w, x, y, d, score, cross };
          }
        }
      }
    }
    if (!best) break;
    put(best.w, best.x, best.y, best.d);
    crossings += best.cross;
  }
  return { placed, crossings };
}

// Auf die benutzte Fläche zuschneiden und nummerieren (Reihe für Reihe, wie üblich)
function finish(placed) {
  let minX = SIZE, minY = SIZE, maxX = 0, maxY = 0;
  for (const p of placed) {
    const ex = p.x + (p.dir === 'a' ? p.answer.length - 1 : 0), ey = p.y + (p.dir === 'd' ? p.answer.length - 1 : 0);
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, ex); maxY = Math.max(maxY, ey);
  }
  const words = placed.map(p => ({ answer: p.answer, clue: p.clue, x: p.x - minX, y: p.y - minY, dir: p.dir }));
  const starts = [...new Set(words.map(w => w.y * 100 + w.x))].sort((a, b) => a - b);
  for (const w of words) w.num = starts.indexOf(w.y * 100 + w.x) + 1;
  words.sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'a' ? -1 : 1));
  return { w: maxX - minX + 1, h: maxY - minY + 1, words };
}

function generate(seed, pool) {
  const rand = rng(seed);
  let best = null;
  for (let i = 0; i < 24; i++) {
    const r = attempt(pool, rand);
    const fin = finish(r.placed);
    // Viele Wörter, viele Kreuzungen, möglichst quadratisch
    const score = r.placed.length * 100 + r.crossings * 20 - Math.abs(fin.w - fin.h) * 15 - (SIZE * SIZE - fin.w * fin.h) * 0.5;
    if (!best || score > best.score) best = { score, fin };
  }
  return best.fin;
}

// ---------- Rätsel des Tages ----------
function puzzle(day) {
  const row = db.prepare('SELECT data FROM cw_puzzles WHERE day = ?').get(day);
  if (row) return JSON.parse(row.data);
  const recent = new Set();
  for (const r of db.prepare('SELECT data FROM cw_puzzles WHERE day >= ? AND day < ?').iterate(addDays(day, -RECENT_DAYS), day)) {
    for (const w of JSON.parse(r.data).words) recent.add(w.answer);
  }
  const all = wordPool();
  const fresh = all.filter(w => !recent.has(w.answer));
  let p = generate(day, fresh.length >= 150 ? fresh : all);
  if (p.words.length < MIN_WORDS) p = generate(day + '#2', all);
  db.prepare('INSERT OR IGNORE INTO cw_puzzles(day, data, created_at) VALUES (?, ?, ?)').run(day, JSON.stringify(p), now());
  return JSON.parse(db.prepare('SELECT data FROM cw_puzzles WHERE day = ?').get(day).data);
}
// Darf dieser Tag gespielt werden? Heute immer, ältere nur, wenn es das Rätsel schon gab
function playable(day) {
  if (!validDay(day)) return false;
  const t = today();
  if (day === t) return true;
  return day < t && day >= addDays(t, -ARCHIVE_DAYS) && !!db.prepare('SELECT 1 FROM cw_puzzles WHERE day = ?').get(day);
}
function archive() {
  return db.prepare('SELECT day FROM cw_puzzles WHERE day >= ? AND day <= ? ORDER BY day DESC').all(addDays(today(), -ARCHIVE_DAYS), today()).map(r => r.day);
}

// Für den Browser: alles außer den Antworten
function publicPuzzle(p) {
  return { w: p.w, h: p.h, words: p.words.map(w => ({ num: w.num, dir: w.dir, x: w.x, y: w.y, len: w.answer.length, clue: w.clue })) };
}
// Lösung als Zeichenkette w × h, '#' für Felder ohne Buchstaben
function solution(p) {
  const s = new Array(p.w * p.h).fill('#');
  for (const w of p.words) for (let i = 0; i < w.answer.length; i++) s[(w.y + (w.dir === 'd' ? i : 0)) * p.w + w.x + (w.dir === 'a' ? i : 0)] = w.answer[i];
  return s.join('');
}
// Eingabe aus dem Browser: genau w × h Zeichen, A–Z oder '-' für leer
function cleanLetters(p, letters) {
  const sol = solution(p), s = String(letters || '');
  let out = '';
  for (let i = 0; i < sol.length; i++) out += sol[i] === '#' ? '#' : /[A-Z]/.test(s[i] || '') ? s[i] : '-';
  return out;
}
function cellsOf(p, scope, cell, dir) {
  const sol = solution(p);
  if (scope === 'all') return [...sol].map((c, i) => (c === '#' ? -1 : i)).filter(i => i >= 0);
  const i = Number(cell);
  if (!Number.isInteger(i) || i < 0 || i >= sol.length || sol[i] === '#') return [];
  if (scope === 'cell') return [i];
  const x = i % p.w, y = Math.floor(i / p.w);
  const w = p.words.find(o => o.dir === dir && (dir === 'a' ? o.y === y && x >= o.x && x < o.x + o.answer.length : o.x === x && y >= o.y && y < o.y + o.answer.length));
  if (!w) return [];
  return [...w.answer].map((c, k) => (w.y + (w.dir === 'd' ? k : 0)) * p.w + w.x + (w.dir === 'a' ? k : 0));
}

// ---------- Stand der Mitglieder ----------
function progress(userId, day) {
  return db.prepare('SELECT letters, seconds, checks, reveals, gave_up, solved_at FROM cw_progress WHERE user_id = ? AND day = ?').get(userId, day) || null;
}
function ensure(userId, day, seconds = 0) {
  const t = now();
  db.prepare('INSERT OR IGNORE INTO cw_progress(user_id, day, letters, seconds, started_at, updated_at) VALUES (?, ?, \'\', 0, ?, ?)')
    .run(userId, day, t - Math.min(Math.max(0, seconds | 0), MAX_SECONDS), t);
  return db.prepare('SELECT * FROM cw_progress WHERE user_id = ? AND day = ?').get(userId, day);
}

// Zwischenstand speichern. Die Zeit zählt der Browser (sie hält an, wenn das Fenster nicht sichtbar ist);
// sie kann nur wachsen und nicht länger sein als die Zeit seit dem ersten Speichern.
function save(userId, day, { letters, seconds }) {
  const p = puzzle(day), sol = solution(p), clean = cleanLetters(p, letters);
  const solved = clean === sol;
  const shown = Math.max(0, Math.round(Number(seconds) || 0));
  if (!userId) return { solved };
  const r = ensure(userId, day, shown);
  if (r.solved_at || r.gave_up) return { solved: !!r.solved_at, seconds: r.seconds, done: true };
  const t = now();
  let secs = Math.min(MAX_SECONDS, Math.max(r.seconds, Math.min(shown, t - r.started_at + 5)));
  let solvedAt = null;
  if (solved) {
    // Ein Rätsel lässt sich nicht schneller lösen, als man tippen kann
    secs = Math.max(secs, Math.ceil(sol.replace(/#/g, '').length / 4));
    solvedAt = t;
  }
  db.prepare('UPDATE cw_progress SET letters = ?, seconds = ?, updated_at = ?, solved_at = ? WHERE user_id = ? AND day = ?')
    .run(clean, secs, t, solvedAt, userId, day);
  if (!solved) return { solved: false, seconds: secs };
  return { solved: true, justSolved: true, seconds: secs, help: r.checks + r.reveals > 0, rank: rank(userId, day) };
}

// Prüfen: welche ausgefüllten Felder falsch sind. Mit Konto zählt das als Hilfe.
function check(userId, day, { letters, scope, cell, dir }) {
  const p = puzzle(day), sol = solution(p), clean = cleanLetters(p, letters);
  const cells = cellsOf(p, scope, cell, dir);
  const wrong = cells.filter(i => clean[i] !== '-' && clean[i] !== sol[i]);
  if (userId && cells.length) {
    const r = ensure(userId, day);
    if (!r.solved_at && !r.gave_up) db.prepare('UPDATE cw_progress SET checks = checks + 1 WHERE user_id = ? AND day = ?').run(userId, day);
  }
  return { wrong, checked: cells };
}
// Aufdecken: die richtigen Buchstaben. Das ganze Rätsel aufdecken heißt aufgeben, dann zählt es nicht als gelöst.
function reveal(userId, day, { scope, cell, dir }) {
  const p = puzzle(day), sol = solution(p);
  const cells = cellsOf(p, scope, cell, dir);
  if (userId && cells.length) {
    const r = ensure(userId, day);
    if (!r.solved_at && !r.gave_up) {
      db.prepare('UPDATE cw_progress SET reveals = reveals + 1, gave_up = ? WHERE user_id = ? AND day = ?').run(scope === 'all' ? 1 : 0, userId, day);
      if (scope === 'all') db.prepare('UPDATE cw_progress SET letters = ? WHERE user_id = ? AND day = ?').run(sol, userId, day);
    }
  }
  return { cells: cells.map(i => [i, sol[i]]) };
}

// Bestenliste eines Tages: erst ohne Hilfe, dann mit, jeweils nach Zeit
function leaderboard(day, limit = 20) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility,
                            c.seconds, c.solved_at, (c.checks + c.reveals) AS help
                     FROM cw_progress c JOIN users u ON u.id = c.user_id
                     WHERE c.day = ? AND c.solved_at IS NOT NULL AND c.gave_up = 0 AND u.disabled = 0
                     ORDER BY help > 0, c.seconds, c.solved_at LIMIT ?`).all(day, limit);
}
function rank(userId, day) {
  const all = db.prepare('SELECT user_id FROM cw_progress WHERE day = ? AND solved_at IS NOT NULL AND gave_up = 0 ORDER BY (checks + reveals) > 0, seconds, solved_at').all(day);
  return { place: all.findIndex(r => r.user_id === userId) + 1, of: all.length };
}

// Serie: Tage, an denen das Rätsel noch am selben Tag gelöst wurde (ohne Aufgeben)
function streaks(userId) {
  const days = db.prepare('SELECT day, solved_at FROM cw_progress WHERE user_id = ? AND solved_at IS NOT NULL AND gave_up = 0 ORDER BY day').all(userId)
    .filter(r => dayOf(r.solved_at * 1000) === r.day).map(r => r.day);
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const set = new Set(days);
  let cur = 0, d = set.has(today()) ? today() : addDays(today(), -1);
  while (set.has(d)) { cur++; d = addDays(d, -1); }
  return { streak: cur, best_streak: best };
}

function userTotals(userId) {
  const t = db.prepare(`SELECT COUNT(*) AS solved, COALESCE(SUM(checks + reveals = 0), 0) AS clean, MAX(solved_at) AS last,
                               MIN(CASE WHEN checks + reveals = 0 THEN seconds END) AS best, CAST(ROUND(AVG(seconds)) AS INTEGER) AS avg
                        FROM cw_progress WHERE user_id = ? AND solved_at IS NOT NULL AND gave_up = 0`).get(userId);
  return Object.assign(t, streaks(userId));
}

function resetStats(userId) {
  if (userId) db.prepare('DELETE FROM cw_progress WHERE user_id = ?').run(userId);
  else db.prepare('DELETE FROM cw_progress').run();
}

module.exports = {
  SIZE, ARCHIVE_DAYS, today, validDay, addDays, normalize, parseWords, wordPool, generate, puzzle, playable, archive,
  publicPuzzle, solution, cleanLetters, progress, save, check, reveal, leaderboard, rank, userTotals, resetStats,
};
