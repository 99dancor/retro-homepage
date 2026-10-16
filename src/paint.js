'use strict';
// Paint: gespeicherte Bilder, Rechte, Speicherplatz und Galerie. Gemalt wird nur im Browser (public/paint.js),
// der Server bekommt fertige PNG-Dateien (Bild und Vorschau) und prüft Format und Größe.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, getSetting, PAINT_DIR } = require('./db');
const { fmtDate } = require('./util');

const VIS = ['public', 'members', 'private'];
const MAX_FILE = 12 * 1024 * 1024;     // ein Bild mit 2000 × 2000 Pixeln passt als PNG gut hinein
const MAX_THUMB = 256 * 1024;

const enabled = () => getSetting('paint_enabled', '1') === '1';
const guestsOk = () => getSetting('paint_guests', '1') === '1';
const galleryOn = () => enabled() && getSetting('paint_gallery', '1') === '1';
const lobbiesOn = () => enabled() && getSetting('paint_lobbies', '1') === '1';
const moderation = () => getSetting('paint_moderation', '0') === '1';
const num = (k, d, max) => Math.max(1, Math.min(max, Number(getSetting(k, String(d))) || d));
const maxSize = () => ({ w: num('paint_max_w', 2000, 4000), h: num('paint_max_h', 2000, 4000) });
function canSave(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const mode = getSetting('paint_save', 'members');
  return mode === 'members' || (mode === 'upload' && user.canUpload);
}
function quotaBytes() { return Math.max(0, Number(getSetting('paint_quota_mb', '50')) || 0) * 1024 * 1024; }
function usedBytes(userId) { return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM artworks WHERE owner_id = ?').get(userId).n; }

// Wer darf ein Bild sehen? Besitzer, Mitmaler aus einer Lobby und Admin immer, sonst je nach Sichtbarkeit.
// Öffentliche Bilder, die noch auf die Freigabe warten, und Entwürfe sehen nur sie.
function canSee(user, a) {
  if (!a) return false;
  if (user && (user.isAdmin || user.id === a.owner_id || (a.id != null && isPainter(a.id, user.id)))) return true;
  if (a.visibility === 'public') return a.approved === 1 && !a.draft;
  if (a.visibility === 'members') return !!user && !a.draft;
  return false;
}
const isPainter = (artId, userId) => !!db.prepare('SELECT 1 FROM artwork_painters WHERE artwork_id = ? AND user_id = ?').get(artId, userId);
// Dasselbe als SQL-Bedingung für Listen (Alias a)
function visibleSql(user) {
  if (user && user.isAdmin) return { sql: '1=1', params: [] };
  if (!user) return { sql: "(a.visibility = 'public' AND a.approved = 1 AND a.draft = 0)", params: [] };
  return {
    sql: `(a.owner_id = ? OR a.id IN (SELECT artwork_id FROM artwork_painters WHERE user_id = ?)
           OR (a.draft = 0 AND ((a.visibility = 'public' AND a.approved = 1) OR a.visibility = 'members')))`,
    params: [user.id, user.id],
  };
}

// Breite und Höhe aus dem Kopf einer PNG-Datei, null wenn es keine ist
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
// Nur die Teile einer PNG-Datei behalten, die das Bild selbst beschreiben. Texte, Aufnahmedaten (eXIf) und
// alles andere fliegen raus. null, wenn die Datei kaputt ist.
const KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
function cleanPng(buf) {
  if (!pngSize(buf)) return null;
  const parts = [PNG_SIG];
  let i = 8, end = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8);
    if (i + 12 + len > buf.length) return null;
    if (KEEP.has(type)) parts.push(buf.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === 'IEND') { end = true; break; }
  }
  return end ? Buffer.concat(parts) : null;
}
// Prüft Bild und Vorschau aus dem Formular; gibt { error } oder { image, thumb, w, h } zurück
function checkFiles(files) {
  const image = files && files.image && files.image[0], thumb = files && files.thumb && files.thumb[0];
  if (!image || !thumb) return { error: 'Bild oder Vorschau fehlt.' };
  const s = pngSize(image.buffer), t = pngSize(thumb.buffer), m = maxSize();
  if (!s || !t) return { error: 'Das ist keine PNG-Datei.' };
  if (s.w < 1 || s.h < 1 || s.w > m.w || s.h > m.h) return { error: `Das Bild ist zu groß (höchstens ${m.w} × ${m.h} Pixel).` };
  if (t.w > 256 || t.h > 256 || thumb.size > MAX_THUMB) return { error: 'Die Vorschau ist zu groß.' };
  const img = cleanPng(image.buffer), th = cleanPng(thumb.buffer);
  if (!img || !th) return { error: 'Die PNG-Datei ist beschädigt.' };
  return { image: img, thumb: th, w: s.w, h: s.h };
}

const file = (name, thumb) => path.join(PAINT_DIR, name + (thumb ? '-v' : '') + '.png');
function store(image, thumb) {
  const name = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(file(name), image);
  fs.writeFileSync(file(name, true), thumb);
  return name;
}
function removeFiles(names) {
  for (const n of [].concat(names || [])) {
    if (!/^[a-f0-9]{32}$/.test(n)) continue;
    fs.rm(file(n), { force: true }, () => {});
    fs.rm(file(n, true), { force: true }, () => {});
  }
}
const filesOf = userId => db.prepare('SELECT stored_name FROM artworks WHERE owner_id = ?').all(userId).map(r => r.stored_name);

// Freigabe: Admin und nicht öffentliche Bilder brauchen keine
const needsApproval = (user, visibility) => visibility === 'public' && moderation() && !(user && user.isAdmin);

function get(id) {
  return db.prepare(`SELECT a.*, u.username, u.display_name, ${WITH} FROM artworks a JOIN users u ON u.id = a.owner_id WHERE a.id = ?`).get(Number(id)) || null;
}
// Mitmaler eines Bildes, meiste Änderungen zuerst
function painters(artId) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, p.strokes FROM artwork_painters p JOIN users u ON u.id = p.user_id
                     WHERE p.artwork_id = ? ORDER BY p.strokes DESC, u.username`).all(artId)
    .map(u => ({ id: u.id, name: u.display_name || u.username, user: u.username, strokes: u.strokes }));
}
function setPainters(artId, list) {
  db.prepare('DELETE FROM artwork_painters WHERE artwork_id = ?').run(artId);
  const ins = db.prepare('INSERT OR IGNORE INTO artwork_painters(artwork_id, user_id, strokes) VALUES (?, ?, ?)');
  for (const p of list) ins.run(artId, p.id, Math.max(0, Math.floor(p.strokes) || 0));
}
// Namen der Mitmaler für Listen in einem Rutsch (eine Abfrage statt einer pro Bild)
const WITH = "(SELECT GROUP_CONCAT(COALESCE(pu.display_name, pu.username), ', ') FROM artwork_painters pp JOIN users pu ON pu.id = pp.user_id WHERE pp.artwork_id = a.id) AS with_names";
function row(a, user) {
  return {
    id: a.id, title: a.title, w: a.width, h: a.height, visibility: a.visibility, draft: !!a.draft,
    pending: a.visibility === 'public' && !a.approved, mine: !!user && user.id === a.owner_id,
    by: a.display_name || a.username, byUser: a.username, with: a.with_names || '', date: fmtDate(a.updated_at), updated: a.updated_at,
  };
}
// Bilder eines Mitglieds (selbst gemalt oder mitgemalt), die der Betrachter sehen darf (Profil und Galerie). Entwürfe nicht.
function byUser(userId, viewer, limit = 200) {
  const v = visibleSql(viewer);
  return db.prepare(`SELECT a.*, u.username, u.display_name, ${WITH} FROM artworks a JOIN users u ON u.id = a.owner_id
                     WHERE (a.owner_id = ? OR a.id IN (SELECT artwork_id FROM artwork_painters WHERE user_id = ?)) AND a.draft = 0 AND ${v.sql}
                     ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`).all(userId, userId, ...v.params, limit);
}
// Eigene Bilder und Entwürfe (Datei → Öffnen → Meine Bilder)
function mine(userId) {
  return db.prepare(`SELECT a.*, u.username, u.display_name, ${WITH} FROM artworks a JOIN users u ON u.id = a.owner_id
                     WHERE a.owner_id = ? ORDER BY a.updated_at DESC, a.id DESC`).all(userId);
}
// Bilder anderer, an denen man mitgemalt hat (Datei → Öffnen → Gemeinsam gemalt)
function shared(userId) {
  return db.prepare(`SELECT a.*, u.username, u.display_name, ${WITH} FROM artworks a JOIN users u ON u.id = a.owner_id
                     WHERE a.id IN (SELECT artwork_id FROM artwork_painters WHERE user_id = ?) ORDER BY a.updated_at DESC, a.id DESC`).all(userId);
}
// Galerie: öffentliche Bilder, für Mitglieder auch die für Mitglieder freigegebenen. Private stehen nur unter „Meine Bilder“.
function gallery(viewer, limit = 500) {
  const vis = viewer ? "a.visibility IN ('public','members')" : "a.visibility = 'public'";
  return db.prepare(`SELECT a.*, u.username, u.display_name, ${WITH} FROM artworks a JOIN users u ON u.id = a.owner_id
                     WHERE ${vis} AND (a.visibility != 'public' OR a.approved = 1) AND a.draft = 0 AND u.disabled = 0
                     ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`).all(limit);
}

module.exports = {
  VIS, MAX_FILE, enabled, guestsOk, galleryOn, lobbiesOn, moderation, maxSize, canSave, quotaBytes, usedBytes,
  canSee, isPainter, visibleSql, pngSize, cleanPng, checkFiles, file, store, removeFiles, filesOf, needsApproval, get, row, byUser, gallery,
  painters, setPainters, mine, shared,
};
