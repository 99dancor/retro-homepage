'use strict';
// Ein Speicher für alles (Desktop 2.0): Downloads, Mediaplayer, Paint, Bilder in Beiträgen und Textdokumente
// zählen zusammen gegen user_quota_mb. Der Admin hat keine Grenze, 0 heißt für alle ohne Grenze.
const { db, getSetting } = require('./db');

const PARTS = {
  files: ['📁 Downloads und eigene Uploads', 'SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE uploader_id = ?'],
  tracks: ['🎵 Mediaplayer', 'SELECT COALESCE(SUM(size), 0) AS n FROM tracks WHERE uploader_id = ?'],
  artworks: ['🎨 Paint-Bilder', 'SELECT COALESCE(SUM(size), 0) AS n FROM artworks WHERE owner_id = ?'],
  media: ['🖼️ Bilder in Beiträgen', 'SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE uploader_id = ?'],
  texts: ['🗒️ Textdokumente', "SELECT COALESCE(SUM(length(CAST(body AS BLOB))), 0) AS n FROM desk_items WHERE user_id = ? AND kind = 'text'"],
};

function limitBytes(user) {
  if (user && user.isAdmin) return 0;
  return Math.max(0, Number(getSetting('user_quota_mb', '2048')) || 0) * 1024 * 1024;
}
function breakdown(userId) {
  return Object.entries(PARTS).map(([key, [label, sql]]) => ({ key, label, bytes: db.prepare(sql).get(userId).n }));
}
function usedBytes(userId) { return breakdown(userId).reduce((n, p) => n + p.bytes, 0); }
// Passt noch so viel hinein? (add in Bytes; bei Ersetzen den alten Stand vorher abziehen)
function fits(user, add, minus = 0) {
  const limit = limitBytes(user);
  return !limit || usedBytes(user.id) - minus + add <= limit;
}
function fullMessage(user) {
  const { fmtSize } = require('./util');
  return `Dein Speicher ist voll (${fmtSize(usedBytes(user.id))} von ${fmtSize(limitBytes(user))}). Lösche alte Dateien unter Eigene Dateien, und leere den Papierkorb.`;
}
function view(user) {
  const parts = breakdown(user.id), used = parts.reduce((n, p) => n + p.bytes, 0), limit = limitBytes(user);
  return { parts, used, limit, free: limit ? Math.max(0, limit - used) : 0, pct: limit ? Math.min(100, Math.round(used / limit * 100)) : 0 };
}

module.exports = { limitBytes, usedBytes, breakdown, fits, fullMessage, view };
