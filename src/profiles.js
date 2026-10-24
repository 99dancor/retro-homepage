'use strict';
// Nutzerprofile: Anzeigename, Profilbild, Freunde, Privatnachrichten und Spielstatistiken.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, now, AVATAR_DIR } = require('./db');
const auth = require('./auth');
const GAMES = require('./games');

const displayName = u => (u && (u.display_name || u.username)) || 'Gelöschter Nutzer';
const profileUrl = username => '/nutzer/' + encodeURIComponent(username);
const PROFILE_VIS = { public: 'Alle Besucher', members: 'Angemeldete Mitglieder', friends: 'Nur meine Freunde' };
const PM_FROM = { all: 'Allen Mitgliedern', friends: 'Nur meinen Freunden' };
const GB_FROM = { all: 'Allen Mitgliedern', friends: 'Nur meinen Freunden', off: 'Niemandem (Freundebuch aus)' };

// Anzeigename: 2–32 Zeichen, Leerzeichen zusammengefasst, keine unsichtbaren Steuerzeichen.
// '' heißt zurück zum Benutzernamen, null ist ungültig.
function cleanDisplayName(v) {
  const s = String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const n = [...s].length;
  return n >= 2 && n <= 32 && !/[\p{C}<>]/u.test(s) ? s : null;
}
// Niemand soll sich als jemand anderes ausgeben: Anzeigenamen dürfen keinem fremden Benutzer- oder Anzeigenamen gleichen
function nameTaken(name, exceptId) {
  return !!db.prepare('SELECT 1 FROM users WHERE id != ? AND (username = ? OR display_name = ? COLLATE NOCASE)').get(exceptId, name, name);
}

function findUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '')) || null;
}

// ---------- Freunde ----------
// 'self' | 'none' | 'friends' | 'sent' (ich habe angefragt) | 'received' (ich wurde angefragt)
function friendship(meId, otherId) {
  if (!meId || !otherId) return 'none';
  if (meId === otherId) return 'self';
  const r = db.prepare('SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(meId, otherId, otherId, meId);
  if (!r) return 'none';
  if (r.accepted) return 'friends';
  return r.user_id === meId ? 'sent' : 'received';
}

const MAX_PENDING = 50;
const FRIEND_MSG = {
  freunde: 'Ihr seid jetzt Freunde.',
  voll: `Du hast schon ${MAX_PENDING} offene Anfragen. Warte, bis jemand antwortet.`,
  gesendet: 'Freundschaftsanfrage geschickt.',
  abgelehnt: 'Anfrage abgelehnt.',
  zurueck: 'Anfrage zurückgezogen.',
  entfernt: 'Aus deinen Freunden entfernt.',
};
// Gibt den Schlüssel einer Meldung aus FRIEND_MSG zurück
function friendAction(meId, otherId, action) {
  const st = friendship(meId, otherId);
  if (st === 'self') return null;
  const accept = () => db.prepare('UPDATE friends SET accepted = 1 WHERE user_id = ? AND friend_id = ?').run(otherId, meId);
  const drop = () => db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(meId, otherId, otherId, meId);
  switch (action) {
    case 'add':
      if (st === 'received') { accept(); return 'freunde'; }
      if (st !== 'none') return null;
      if (db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ? AND accepted = 0').get(meId).n >= MAX_PENDING) {
        return 'voll';
      }
      db.prepare('INSERT INTO friends(user_id, friend_id, accepted, created_at) VALUES (?, ?, 0, ?)').run(meId, otherId, now());
      return 'gesendet';
    case 'accept':
      if (st === 'received') { accept(); return 'freunde'; }
      return null;
    case 'decline': if (st === 'received') { drop(); return 'abgelehnt'; } return null;
    case 'cancel': if (st === 'sent') { drop(); return 'zurueck'; } return null;
    case 'remove': if (st === 'friends') { drop(); return 'entfernt'; } return null;
    default: return null;
  }
}

const USER_COLS = 'u.id, u.username, u.display_name, u.avatar, u.role';
function friendsOf(userId) {
  return db.prepare(`SELECT ${USER_COLS} FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
                     WHERE (f.user_id = ? OR f.friend_id = ?) AND f.accepted = 1 AND u.disabled = 0
                     ORDER BY COALESCE(u.display_name, u.username) COLLATE NOCASE`).all(userId, userId, userId);
}
function requestsTo(userId) {
  return db.prepare(`SELECT ${USER_COLS}, f.created_at AS asked_at FROM friends f JOIN users u ON u.id = f.user_id
                     WHERE f.friend_id = ? AND f.accepted = 0 AND u.disabled = 0 ORDER BY f.created_at DESC`).all(userId);
}
function requestsFrom(userId) {
  return db.prepare(`SELECT ${USER_COLS}, f.created_at AS asked_at FROM friends f JOIN users u ON u.id = f.friend_id
                     WHERE f.user_id = ? AND f.accepted = 0 AND u.disabled = 0 ORDER BY f.created_at DESC`).all(userId);
}

// ---------- Wer darf was ----------
function canViewProfile(viewer, target) {
  if (!target || (target.disabled && !(viewer && viewer.isAdmin))) return false;
  if (viewer && (viewer.isAdmin || viewer.id === target.id)) return true;
  if (target.profile_visibility === 'public') return true;
  if (!viewer) return false;
  if (target.profile_visibility !== 'friends') return true;
  return friendship(viewer.id, target.id) === 'friends';
}
// Wer nur Nachrichten von Freunden möchte, kann trotzdem jedem antworten, der ihm geschrieben hat
function canMessage(sender, target) {
  if (!sender || !target || sender.id === target.id || target.disabled) return false;
  if (sender.isAdmin || target.pm_from !== 'friends') return true;
  if (friendship(sender.id, target.id) === 'friends') return true;
  return !!db.prepare('SELECT 1 FROM private_messages WHERE from_id = ? AND to_id = ?').get(target.id, sender.id);
}

// ---------- Freundebuch im Profil ----------
const MAX_GB = 2000;
function canSign(viewer, target) {
  if (!viewer || !canViewProfile(viewer, target) || target.disabled || target.gb_from === 'off') return false;
  if (viewer.isAdmin || viewer.id === target.id || target.gb_from !== 'friends') return true;
  return friendship(viewer.id, target.id) === 'friends';
}
function guestbookOf(profileId, limit = 50) {
  return db.prepare(`SELECT g.*, u.username, u.display_name, u.avatar FROM profile_guestbook g JOIN users u ON u.id = g.author_id
                     WHERE g.profile_id = ? AND u.disabled = 0 ORDER BY g.created_at DESC, g.id DESC LIMIT ?`).all(profileId, limit);
}
function signGuestbook(profileId, authorId, body) {
  return Number(db.prepare('INSERT INTO profile_guestbook(profile_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(profileId, authorId, body, now()).lastInsertRowid);
}
// Löschen dürfen Verfasser, Profilinhaber und Admin
function deleteGuestbookEntry(viewer, profileId, id) {
  const e = db.prepare('SELECT * FROM profile_guestbook WHERE id = ? AND profile_id = ?').get(id, profileId);
  if (!e || !viewer || !(viewer.isAdmin || viewer.id === e.author_id || viewer.id === e.profile_id)) return false;
  db.prepare('DELETE FROM profile_guestbook WHERE id = ?').run(id);
  return true;
}

// ---------- Privatnachrichten ----------
const MAX_PM = 5000;
function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM private_messages WHERE to_id = ? AND read_at IS NULL AND hidden_to = 0').get(userId).n;
}
// Ein Eintrag pro Gesprächspartner, neuestes Gespräch zuerst. SQLite liefert zu MAX(id) die Spalten genau dieser Zeile.
function conversations(userId) {
  return db.prepare(`
    SELECT c.other, MAX(c.id) AS last_id, c.body, c.from_id, c.created_at, SUM(c.unread) AS unread,
      u.username, u.display_name, u.avatar, u.role
    FROM (SELECT id, body, from_id, created_at, CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other,
                 (to_id = ? AND read_at IS NULL) AS unread
          FROM private_messages WHERE (from_id = ? AND hidden_from = 0) OR (to_id = ? AND hidden_to = 0)) c
    JOIN users u ON u.id = c.other
    GROUP BY c.other ORDER BY last_id DESC`).all(userId, userId, userId, userId);
}
function thread(meId, otherId, limit = 200) {
  return db.prepare(`SELECT * FROM private_messages
                     WHERE (from_id = ? AND to_id = ? AND hidden_from = 0) OR (from_id = ? AND to_id = ? AND hidden_to = 0)
                     ORDER BY id DESC LIMIT ?`).all(meId, otherId, otherId, meId, limit).reverse();
}
function markRead(meId, otherId) {
  db.prepare('UPDATE private_messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL').run(now(), meId, otherId);
}
function sendMessage(fromId, toId, body) {
  return Number(db.prepare('INSERT INTO private_messages(from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)').run(fromId, toId, body, now()).lastInsertRowid);
}
// Verlauf nur für mich löschen. Haben ihn beide gelöscht, verschwinden die Nachrichten ganz aus der Datenbank.
function hideConversation(meId, otherId) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE private_messages SET hidden_from = 1 WHERE from_id = ? AND to_id = ?').run(meId, otherId);
    db.prepare('UPDATE private_messages SET hidden_to = 1 WHERE to_id = ? AND from_id = ?').run(meId, otherId);
    db.prepare('DELETE FROM private_messages WHERE hidden_from = 1 AND hidden_to = 1').run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- Spielstatistiken ----------
// Spiele melden Zahlen über /api/stats/<spiel>. „Gestartet“ zählt die Seite selbst.
const STARTS = 'Gestartet';
const STAT_KEY = /^[\p{L}\p{N}][\p{L}\p{N} _.:'()-]{0,39}$/u;
const MAX_KEYS = 50;
const OPS = {
  add: 'value + excluded.value',
  max: 'MAX(value, excluded.value)',
  min: 'MIN(value, excluded.value)',
  set: 'excluded.value',
};
// ops: { add: { Siege: 1 }, max: { Höchstpunktzahl: 1200 }, min: { ... }, set: { Stufe: 5 } }. Gibt eine Fehlermeldung oder null zurück.
function recordStats(userId, app, ops) {
  if (!ops || typeof ops !== 'object') return 'stats';
  const rows = [];
  for (const op of Object.keys(ops)) {
    if (!Object.hasOwn(OPS, op)) return 'op';
    const vals = ops[op];
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) return 'op';
    for (const [key, value] of Object.entries(vals)) {
      if (!STAT_KEY.test(key) || key === STARTS) return 'key';
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) return 'value';
      rows.push([op, key, value]);
    }
  }
  if (rows.length > MAX_KEYS) return 'keys';
  const have = new Set(db.prepare('SELECT key FROM game_stats WHERE user_id = ? AND app_slug = ?').all(userId, app).map(r => r.key));
  if (new Set([...have, ...rows.map(r => r[1])]).size > MAX_KEYS + 1) return 'keys';
  const t = now();
  db.exec('BEGIN');
  try {
    for (const [op, key, value] of rows) {
      db.prepare(`INSERT INTO game_stats(user_id, app_slug, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, app_slug, key) DO UPDATE SET value = ${OPS[op]}, updated_at = excluded.updated_at`).run(userId, app, key, value, t);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return null;
}
function countStart(user, app) {
  if (!user) return;
  db.prepare(`INSERT INTO game_stats(user_id, app_slug, key, value, updated_at) VALUES (?, ?, ?, 1, ?)
              ON CONFLICT(user_id, app_slug, key) DO UPDATE SET value = value + 1, updated_at = excluded.updated_at`).run(user.id, app, STARTS, now());
}
function ownStats(userId, app) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM game_stats WHERE user_id = ? AND app_slug = ? ORDER BY key').all(userId, app)) out[r.key] = r.value;
  return out;
}

// Alle Spiele eines Kontos für das Profil: gemeldete Zahlen plus das, was eingebaute Spiele aus ihrem Spielstand ablesen.
// Apps, die der Betrachter nicht sehen darf, bleiben weg.
function gameStats(userId, viewer) {
  const games = new Map();
  const game = slug => {
    if (!games.has(slug)) {
      let g;
      if (Object.hasOwn(GAMES, slug)) g = { title: GAMES[slug].title, url: GAMES[slug].url || `/${slug}/` };
      else {
        const a = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug);
        g = a && auth.canSee(viewer, 'app', a) ? { title: a.title, url: `/apps/${a.slug}` } : null;
      }
      if (g) Object.assign(g, { slug, stats: [], last: 0 });
      games.set(slug, g);
    }
    return games.get(slug);
  };
  for (const r of db.prepare('SELECT app_slug, key, value, updated_at FROM game_stats WHERE user_id = ? ORDER BY key COLLATE NOCASE').all(userId)) {
    const g = game(r.app_slug);
    if (!g) continue;
    if (r.key === STARTS) g.stats.unshift({ key: r.key, value: r.value });
    else g.stats.push({ key: r.key, value: r.value });
    g.last = Math.max(g.last, r.updated_at);
  }
  for (const [slug, def] of Object.entries(GAMES)) {
    if (def.userStats) {
      const r = def.userStats(userId);
      if (!r) continue;
      const g = game(slug);
      g.stats.push(...r.stats);
      g.last = Math.max(g.last, r.last || 0);
      continue;
    }
    if (!def.stats) continue;
    const save = db.prepare("SELECT data, updated_at FROM game_saves WHERE user_id = ? AND app_slug = ? AND slot = 'main'").get(userId, slug);
    if (!save) continue;
    let extra = [];
    try { extra = def.stats(save.data) || []; } catch { /* kaputter Spielstand */ }
    const g = game(slug);
    g.stats.push(...extra);
    g.last = Math.max(g.last, save.updated_at);
  }
  return [...games.values()].filter(g => g && g.stats.length).sort((a, b) => b.last - a.last);
}

// ---------- Profilbilder ----------
// Hochgeladene Bilder verlieren versteckte Angaben (EXIF mit Aufnahmeort, Kamera, Textfelder).
// Bei JPEG bleibt nur die Drehung erhalten, sonst stünden Handyfotos auf der Seite.
const AVATAR_MAX = 2 * 1024 * 1024;
function imageType(b) {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function exifOrientation(seg) {
  // seg: Inhalt eines APP1-Blocks ab "Exif\0\0"
  if (seg.toString('latin1', 0, 6) !== 'Exif\0\0') return 0;
  const t = seg.subarray(6);
  if (t.length < 8) return 0;
  const le = t.toString('latin1', 0, 2) === 'II';
  const u16 = o => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = o => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 0;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}
// Kleinster EXIF-Block, der nur die Drehung enthält
function orientationApp1(o) {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2, orientation = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('jpeg');
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (m === 0xff) { i++; continue; }
    const len = b.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > b.length) throw new Error('jpeg');
    if (m === 0xda) { out.push(b.subarray(i)); break; }      // Bilddaten: Rest unverändert
    // APP1 (EXIF, XMP), APP13 (IPTC) und Kommentare fallen weg; APP0, APP2 (Farbprofil) und APP14 bleiben
    if (m === 0xe1) orientation ||= exifOrientation(b.subarray(i + 4, end));
    else if (m !== 0xed && m !== 0xfe) out.push(b.subarray(i, end));
    i = end;
  }
  if (orientation > 1) out.splice(1, 0, orientationApp1(orientation));
  return Buffer.concat(out);
}
function stripPng(b) {
  const out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8), end = i + 12 + len;
    if (end > b.length) throw new Error('png');
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}
function stripWebp(b) {
  const out = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = b.toString('latin1', i, i + 4), len = b.readUInt32LE(i + 4), end = i + 8 + len + (len & 1);
    if (end > b.length + 1) throw new Error('webp');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(b.subarray(i, Math.min(end, b.length)));
      if (type === 'VP8X') chunk[8] &= ~0x0c;               // Merker „hat EXIF/XMP“ löschen
      out.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(out);
  const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([head, body]);
}
const STRIP = { jpg: stripJpeg, png: stripPng, webp: stripWebp, gif: b => b };

// Breite und Höhe aus dem Dateikopf, null wenn sie sich nicht finden lassen
function imageSize(b, type) {
  try {
    if (type === 'png') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (type === 'gif') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (type === 'jpg') {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        if (m === 0xda) return null;
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (type === 'webp') {
      const c = b.toString('latin1', 12, 16);
      if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (c === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
      if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    }
  } catch { /* zu kurz */ }
  return null;
}
// Profilbilder sind quadratisch: Der Browser schneidet sie beim Hochladen zu (public/avatar-crop.js).
// GIFs bleiben, wie sie sind (sonst wäre die Bewegung weg), und werden mittig quadratisch gezeigt.
function squareEnough(buf, type) {
  const d = type === 'gif' ? null : imageSize(buf, type);
  return !d || Math.abs(d.w - d.h) <= Math.max(1, Math.round(Math.max(d.w, d.h) * 0.02));
}

// Speichert ein Profilbild und gibt seinen Dateinamen zurück; wirft bei ungültigen Bildern
function saveAvatar(buf) {
  const type = imageType(buf);
  if (!type) throw new Error('Das ist kein Bild (PNG, JPEG, GIF oder WebP).');
  if (!squareEnough(buf, type)) throw Object.assign(new Error('Das Profilbild muss quadratisch sein.'), { code: 'quadrat' });
  let clean;
  try { clean = STRIP[type](buf); } catch { throw new Error('Das Bild ist beschädigt.'); }
  const name = crypto.randomBytes(16).toString('hex') + '.' + type;
  fs.writeFileSync(path.join(AVATAR_DIR, name), clean);
  return name;
}
function removeAvatar(name) {
  if (name && /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(name)) fs.rm(path.join(AVATAR_DIR, name), { force: true }, () => {});
}

module.exports = {
  displayName, profileUrl, PROFILE_VIS, PM_FROM, GB_FROM, MAX_GB, canSign, guestbookOf, signGuestbook, deleteGuestbookEntry, cleanDisplayName, nameTaken, findUser,
  friendship, friendAction, FRIEND_MSG, friendsOf, requestsTo, requestsFrom, canViewProfile, canMessage,
  MAX_PM, unreadCount, conversations, thread, markRead, sendMessage, hideConversation,
  STARTS, recordStats, countStart, ownStats, gameStats,
  AVATAR_MAX, saveAvatar, removeAvatar, imageSize, stripJpeg, stripPng, stripWebp,
};
