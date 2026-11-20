'use strict';
// Nintendo-DS-Spiele (Startmenü → Spiele und Apps → z. B. 🍃 Animal Crossing). Der Admin lädt eine eigene ROM hoch, sie
// liegt nur hier in data/ds und geht nur an angemeldete Mitglieder, die das Spiel sehen dürfen (nie öffentlich). Jedes
// Mitglied hat seinen eigenen Spielstand auf dem Server (ds_saves), mit der Fassung davor als Sicherung. Gespielt wird im
// Browser (public/ds.js mit dem melonDS-Kern), der Server sieht nur ROM und Spielstand.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, now, DATA_DIR } = require('./db');
const auth = require('./auth');

const DS_DIR = path.join(DATA_DIR, 'ds');
fs.mkdirSync(DS_DIR, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS ds_games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎮',
  file TEXT NOT NULL,                          -- Dateiname in data/ds
  size INTEGER NOT NULL,
  sha1 TEXT NOT NULL,
  game_code TEXT,                              -- aus dem ROM-Kopf, z. B. ADMP
  rom_title TEXT,
  visibility TEXT NOT NULL DEFAULT 'members',  -- members | groups | private (nie public)
  in_menu INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Ein Spielstand pro Mitglied und Spiel. rev zählt die Fassungen: Ein Fenster schreibt nur auf die Fassung, die es geladen
-- hat, sonst gewinnt beim Spielen auf zwei Geräten nicht still das ältere. prev_data ist die Fassung davor.
CREATE TABLE IF NOT EXISTS ds_saves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES ds_games(id) ON DELETE CASCADE,
  data BLOB NOT NULL,
  rev INTEGER NOT NULL,
  prev_data BLOB,
  prev_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
`);

const VIS = { members: 'Alle angemeldeten Mitglieder', groups: 'Nur bestimmte Gruppen', private: 'Nur Admin' };
const MAX_SAVE = 8 * 1024 * 1024;   // größter DS-Speicherchip: 8 MB Flash
const MAX_ROM = 512 * 1024 * 1024;  // größte DS-Karte: 4 Gbit
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// ---------- ROM-Kopf ----------
// Die ersten 0x160 Bytes: Titel (12 Zeichen), Spielcode (4), Herstellercode (2), dazu eine Prüfsumme über den Kopf (CRC16
// an 0x15E). Passt sie, ist es sehr wahrscheinlich eine DS-ROM und nicht irgendeine Datei.
function crc16(buf) {
  let c = 0xffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  }
  return c;
}
const ascii = b => b.toString('latin1').replace(/\0+$/, '').replace(/[^\x20-\x7e]/g, '').trim();
function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = Buffer.alloc(0x160);
    if (fs.readSync(fd, h, 0, h.length, 0) < h.length) return null;
    if (crc16(h.subarray(0, 0x15e)) !== h.readUInt16LE(0x15e)) return null;
    return { title: ascii(h.subarray(0, 12)), code: ascii(h.subarray(12, 16)), maker: ascii(h.subarray(16, 18)) };
  } finally { fs.closeSync(fd); }
}
// Spielcode → Region (letzter Buchstabe) und die Sprache, die der Emulator der Firmware vorgibt: Europäische ROMs
// (P, D, F …) enthalten mehrere Sprachen und nehmen die aus der Firmware.
const REGION = { E: 'USA', P: 'Europa', D: 'Deutschland', F: 'Frankreich', I: 'Italien', S: 'Spanien', J: 'Japan', K: 'Korea', U: 'Australien' };
function region(code) { return REGION[String(code || '').slice(3)] || ''; }
function language(code) {
  return { J: 'Japanese', F: 'French', I: 'Italian', S: 'Spanish', E: 'English', U: 'English' }[String(code || '').slice(3)] || 'German';
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// ---------- Spiele ----------
const all = () => db.prepare('SELECT * FROM ds_games ORDER BY title').all();
const byId = id => db.prepare('SELECT * FROM ds_games WHERE id = ?').get(Number(id));
const bySlug = slug => db.prepare('SELECT * FROM ds_games WHERE slug = ?').get(String(slug));
// Wer darf spielen? Nur Mitglieder, nie Gäste: auch wenn jemand die Sichtbarkeit auf öffentlich stellen wollte
function canPlay(user, g) {
  if (!user || !g) return false;
  if (g.visibility === 'public') return true;
  return auth.canSee(user, 'ds', g);
}
function visibleTo(user) {
  if (!user) return [];
  return all().filter(g => canPlay(user, g));
}
function romPath(g) { return path.join(DS_DIR, path.basename(g.file)); }

function slugFor(title, id) {
  const base = String(title || 'spiel').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'spiel';
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM ds_games WHERE slug = ? AND id != ?').get(slug, id || 0); i++) slug = `${base}-${i}`;
  return slug;
}

// Neue ROM übernehmen (die hochgeladene Datei wird verschoben). Fehler als Text für die Seitenverwaltung.
async function storeRom(tmp, size) {
  if (!size || size < 0x200) return { error: 'Das ist keine Nintendo-DS-ROM (Datei zu klein).' };
  if (size > MAX_ROM) return { error: 'Die Datei ist größer als jede DS-Karte.' };
  const head = readHeader(tmp);
  if (!head) return { error: 'Das ist keine Nintendo-DS-ROM (.nds): Der Kopf der Datei passt nicht.' };
  const sha1 = await sha1File(tmp);
  const file = `${sha1.slice(0, 16)}.nds`;
  const dest = path.join(DS_DIR, file);
  try { fs.renameSync(tmp, dest); } catch { fs.copyFileSync(tmp, dest); fs.rmSync(tmp, { force: true }); }
  return { file, sha1, size, head };
}
function removeRomIfUnused(file) {
  if (!file || db.prepare('SELECT 1 FROM ds_games WHERE file = ?').get(file)) return;
  try { fs.rmSync(path.join(DS_DIR, path.basename(file)), { force: true }); } catch { /* schon weg */ }
}

function create({ title, icon, visibility, inMenu, rom }) {
  const t = now();
  const slug = slugFor(title, 0);
  const id = Number(db.prepare(`INSERT INTO ds_games(slug, title, icon, file, size, sha1, game_code, rom_title, visibility, in_menu, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, title, icon, rom.file, rom.size, rom.sha1, rom.head.code, rom.head.title,
    visibility, inMenu ? 1 : 0, t, t).lastInsertRowid);
  return byId(id);
}
function update(id, { title, icon, visibility, inMenu, rom }) {
  const old = byId(id);
  if (!old) return null;
  db.prepare('UPDATE ds_games SET title = ?, icon = ?, visibility = ?, in_menu = ?, updated_at = ? WHERE id = ?')
    .run(title, icon, visibility, inMenu ? 1 : 0, now(), id);
  if (rom) {
    db.prepare('UPDATE ds_games SET file = ?, size = ?, sha1 = ?, game_code = ?, rom_title = ? WHERE id = ?')
      .run(rom.file, rom.size, rom.sha1, rom.head.code, rom.head.title, id);
    if (rom.file !== old.file) removeRomIfUnused(old.file);
  }
  return byId(id);
}
function remove(id) {
  const g = byId(id);
  if (!g) return;
  db.prepare('DELETE FROM ds_saves WHERE game_id = ?').run(g.id);
  db.prepare('DELETE FROM ds_games WHERE id = ?').run(g.id);
  db.prepare("DELETE FROM acl WHERE item_type = 'ds' AND item_id = ?").run(g.id);
  removeRomIfUnused(g.file);
}
function countPlay(g) { db.prepare('UPDATE ds_games SET plays = plays + 1 WHERE id = ?').run(g.id); }

// ---------- Spielstände ----------
function getSave(userId, gameId) {
  return db.prepare('SELECT data, rev, updated_at FROM ds_saves WHERE user_id = ? AND game_id = ?').get(userId, gameId) || null;
}
function revOf(userId, gameId) {
  const r = db.prepare('SELECT rev FROM ds_saves WHERE user_id = ? AND game_id = ?').get(userId, gameId);
  return r ? r.rev : 0;
}
// Schreibt nur, wenn baseRev die aktuelle Fassung ist. Ergebnis: { rev } oder { conflict: aktuelle rev }
function putSave(userId, gameId, data, baseRev) {
  const cur = db.prepare('SELECT data, rev FROM ds_saves WHERE user_id = ? AND game_id = ?').get(userId, gameId);
  const rev = cur ? cur.rev : 0;
  if (Number(baseRev) !== rev) return { conflict: rev };
  const t = now();
  if (!cur) db.prepare('INSERT INTO ds_saves(user_id, game_id, data, rev, updated_at) VALUES (?, ?, ?, 1, ?)').run(userId, gameId, data, t);
  else if (Buffer.compare(Buffer.from(cur.data), data) !== 0) {
    db.prepare('UPDATE ds_saves SET prev_data = data, prev_at = updated_at, data = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND game_id = ?')
      .run(data, t, userId, gameId);
  } else return { rev };
  return { rev: rev + 1 };
}
// Die Sicherung zurückholen (Seitenverwaltung): aktuelle und vorige Fassung tauschen
function restorePrev(userId, gameId) {
  const r = db.prepare('UPDATE ds_saves SET data = prev_data, prev_data = data, updated_at = ?, prev_at = updated_at, rev = rev + 1 WHERE user_id = ? AND game_id = ? AND prev_data IS NOT NULL')
    .run(now(), userId, gameId);
  return r.changes > 0;
}
function deleteSave(userId, gameId) {
  db.prepare('DELETE FROM ds_saves WHERE user_id = ? AND game_id = ?').run(userId, gameId);
}
// Für die Seitenverwaltung: alle Spielstände eines Spiels
function savesOf(gameId) {
  return db.prepare(`SELECT s.user_id, s.rev, s.updated_at, length(s.data) AS size, s.prev_at, u.username, u.display_name
                     FROM ds_saves s JOIN users u ON u.id = s.user_id WHERE s.game_id = ? ORDER BY s.updated_at DESC`).all(gameId);
}
// Für Konto → Spielstände
function savesOfUser(userId) {
  return db.prepare(`SELECT g.id AS game_id, g.slug, g.title, g.icon, s.updated_at, length(s.data) AS size
                     FROM ds_saves s JOIN ds_games g ON g.id = s.game_id WHERE s.user_id = ? ORDER BY g.title`).all(userId);
}

// ---------- Startmenü ----------
// Ein Eintrag pro Spiel, das das Konto sehen darf (Schlüssel ds-<slug>; src/programs.js blendet sie mit „ds“ aus)
function menuEntries(user) {
  if (!user) return [];
  try { return visibleTo(user).filter(g => g.in_menu).map(g => [`ds-${g.slug}`, `/ds/${g.slug}`, `${g.icon} ${g.title}`]); }
  catch { return []; }
}

// Der Emulator liegt im Image unter public/ds-core (Dockerfile). Fehlt er (Entwicklung ohne `npm run ds-core`), sagt die
// Seite das, statt einen 404 im Browser zu verstecken.
const CORE_DIR = path.join(__dirname, '..', 'public', 'ds-core');
const CORE = 'melonds_libretro';
function coreReady() { return fs.existsSync(path.join(CORE_DIR, CORE + '.js')) && fs.existsSync(path.join(CORE_DIR, CORE + '.wasm')); }

module.exports = {
  DS_DIR, VIS, MAX_SAVE, MAX_ROM, SLUG_RE, CORE, readHeader, crc16, region, language, all, byId, bySlug, canPlay, visibleTo, romPath,
  storeRom, create, update, remove, countPlay, getSave, revOf, putSave, restorePrev, deleteSave, savesOf, savesOfUser, menuEntries, coreReady,
};
