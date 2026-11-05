'use strict';
// Ereignisanzeige (Seitenverwaltung → System → Ereignisanzeige): was auf der Seite passiert ist, wie bei Windows mit
// Stufe (Information, Warnung, Fehler) und Quelle. Steht nur in der Datenbank, die Seitenverwaltung zeigt es an; nach
// 90 Tagen fällt es weg. Keine IP-Adressen; bei Änderungen in der Seitenverwaltung steht dabei, welcher Admin es war.
const { db, now } = require('./db');

const LEVELS = { info: 'ℹ️ Information', warn: '⚠️ Warnung', error: '⛔ Fehler' };
const KEEP_DAYS = 90;

function log(level, source, message, userId = null) {
  try {
    db.prepare('INSERT INTO events(at, level, source, message, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(now(), Object.hasOwn(LEVELS, level) ? level : 'info', String(source).slice(0, 40), String(message).slice(0, 500), userId || null);
  } catch { /* Protokoll darf nichts aufhalten */ }
}
const info = (source, msg, userId) => log('info', source, msg, userId);
const warn = (source, msg, userId) => log('warn', source, msg, userId);
const error = (source, msg, userId) => log('error', source, msg, userId);

function list({ level = '', source = '', limit = 300 } = {}) {
  const where = [], params = [];
  if (Object.hasOwn(LEVELS, level)) { where.push('e.level = ?'); params.push(level); }
  if (source) { where.push('e.source = ?'); params.push(String(source)); }
  return db.prepare(`SELECT e.*, u.username FROM events e LEFT JOIN users u ON u.id = e.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                     ORDER BY e.at DESC, e.id DESC LIMIT ?`).all(...params, limit);
}
function sources() { return db.prepare('SELECT source, COUNT(*) AS n FROM events GROUP BY source ORDER BY source').all(); }
function counts(sinceSec = 86400) {
  const r = db.prepare('SELECT level, COUNT(*) AS n FROM events WHERE at >= ? GROUP BY level').all(now() - sinceSec);
  return Object.fromEntries(Object.keys(LEVELS).map(k => [k, (r.find(x => x.level === k) || { n: 0 }).n]));
}
function clear() { db.prepare('DELETE FROM events').run(); }
function cleanup() { db.prepare('DELETE FROM events WHERE at < ?').run(now() - KEEP_DAYS * 86400); }

module.exports = { LEVELS, log, info, warn, error, list, sources, counts, clear, cleanup };
