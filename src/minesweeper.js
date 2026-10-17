'use strict';
// Minesweeper wie bei Windows 98. Gespielt wird im Browser (public/minesweeper.js); mit Konto meldet die Seite
// Start und Ende jedes Spiels, der Server merkt sich pro Spiel Stufe, Ergebnis und Zeit für Profil und Bestzeiten.
const { db, now } = require('./db');

const LEVELS = {
  beginner: { name: 'Anfänger', w: 9, h: 9, m: 10 },
  intermediate: { name: 'Fortgeschrittene', w: 16, h: 16, m: 40 },
  expert: { name: 'Profis', w: 30, h: 16, m: 99 },
};
// Grenzen von „Benutzerdefiniert…“ wie im Original
const LIMITS = { wMin: 9, wMax: 30, hMin: 9, hMax: 24, mMin: 10 };
const MAX_TIME = 999;

function board(b) {
  const int = v => (Number.isInteger(Number(v)) ? Number(v) : NaN);
  const w = int(b && b.w), h = int(b && b.h), m = int(b && b.m);
  if (!(w >= LIMITS.wMin && w <= LIMITS.wMax && h >= LIMITS.hMin && h <= LIMITS.hMax)) return null;
  if (!(m >= LIMITS.mMin && m <= (w - 1) * (h - 1))) return null;
  const level = Object.keys(LEVELS).find(k => LEVELS[k].w === w && LEVELS[k].h === h && LEVELS[k].m === m) || 'custom';
  return { level, w, h, m };
}

// Laufende Spiele nur im Arbeitsspeicher: Die Uhr startet beim ersten Klick, gleichzeitig geht der Start an den
// Server. So kann eine gemeldete Zeit nicht kürzer sein als die tatsächlich vergangene.
const running = new Map();   // user_id -> { level, w, h, m, t }
function start(userId, b) {
  const g = board(b);
  if (!g) return null;
  running.set(userId, { ...g, t: Date.now() });
  return g;
}
function finish(userId, { won, seconds }) {
  const g = running.get(userId);
  if (!g) return null;
  running.delete(userId);
  const real = Math.floor((Date.now() - g.t) / 1000);
  const shown = Number.isFinite(Number(seconds)) ? Math.round(Number(seconds)) : 0;
  const secs = Math.min(MAX_TIME, Math.max(1, shown, real));
  const before = won && g.level !== 'custom' ? siteBest(g.level) : null;
  const mine = won && g.level !== 'custom' ? userBest(userId, g.level) : null;
  db.prepare('INSERT INTO ms_games(user_id, level, width, height, mines, won, seconds, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, g.level, g.w, g.h, g.m, won ? 1 : 0, secs, now());
  return {
    level: g.level, seconds: secs, won: !!won,
    personal: !!won && g.level !== 'custom' && (mine == null || secs < mine),
    record: !!won && g.level !== 'custom' && (!before || secs < before.seconds),
    beaten: won && before && secs < before.seconds && before.id !== userId ? before : null,
  };
}
// Alte Starts ohne Ende (Tab zu, neues Spiel) nicht ewig behalten
setInterval(() => {
  const old = Date.now() - (MAX_TIME + 600) * 1000;
  for (const [id, g] of running) if (g.t < old) running.delete(id);
}, 600e3).unref();

// Rekord der Seite auf einer Stufe; bei gleicher Zeit gilt, wer sie zuerst geschafft hat
function siteBest(level) {
  return bestTimes(level, 1)[0] || null;
}
function userBest(userId, level) {
  const r = db.prepare('SELECT MIN(seconds) AS s FROM ms_games WHERE user_id = ? AND level = ? AND won = 1').get(userId, level);
  return r ? r.s : null;
}
// Bestzeiten pro Stufe: die schnellsten Mitglieder, je Konto nur die beste Zeit
function bestTimes(level, limit = 10) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility, b.seconds, b.played_at
                     FROM (SELECT user_id, seconds, played_at, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY seconds, played_at, id) AS n
                           FROM ms_games WHERE level = ? AND won = 1) b
                     JOIN users u ON u.id = b.user_id WHERE b.n = 1 AND u.disabled = 0
                     ORDER BY b.seconds, b.played_at LIMIT ?`).all(level, limit);
}

function userTotals(userId) {
  const t = db.prepare('SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins, MAX(played_at) AS last FROM ms_games WHERE user_id = ?').get(userId);
  t.best = {};
  for (const k of Object.keys(LEVELS)) t.best[k] = userBest(userId, k);
  // Siegesserien über alle Stufen, in der Reihenfolge der Spiele
  let cur = 0, best = 0;
  for (const r of db.prepare('SELECT won FROM ms_games WHERE user_id = ? ORDER BY played_at, id').iterate(userId)) {
    cur = r.won ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  t.streak = cur; t.best_streak = best;
  return t;
}

function resetStats(userId) {
  if (userId) { db.prepare('DELETE FROM ms_games WHERE user_id = ?').run(userId); running.delete(userId); }
  else { db.prepare('DELETE FROM ms_games').run(); running.clear(); }
}

module.exports = { LEVELS, LIMITS, MAX_TIME, board, start, finish, siteBest, userBest, bestTimes, userTotals, resetStats, _running: running };
