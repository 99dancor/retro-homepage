'use strict';
// Farming Simulator Hub: Spielstände. Höfe, Mitglieder, Aufgaben, Anbaupläne, Feldmeldungen, Orte, Verläufe und der
// Spieltag gehören zu einem Spielstand. Läuft auf dem Server ein anderer (andere Karte oder anderes Anlegedatum laut
// careerSavegame), legt der Hub diese Daten beiseite (fs_saves.data) und holt die des neuen zurück, wenn er ihn schon
// kennt, sonst beginnt er leer. Notizen, Changelog, Vorschläge, Online-Zeiten und die Kalendervorlage bleiben.
// Ein eigenes Kartenbild wandert mit, wenn es für den alten Spielstand hochgeladen wurde.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, now, getSetting, setSetting, tx } = require('./db');
const feeds = require('./fsfeeds');

const TABLES = ['fs_farms', 'fs_members', 'fs_tasks', 'fs_hidden', 'fs_places', 'fs_plans', 'fs_fields', 'fs_hist'];
const SETTINGS = ['fs_day'];
// Spalten mit Konten; gibt es das Konto beim Zurückholen nicht mehr, wird die Spalte leer (fs_members: Zeile fällt weg)
const USER_COLS = ['updated_by', 'user_id', 'assignee_id', 'created_by', 'done_by'];
const LABELS = { fs_farms: 'Höfe', fs_members: 'Mitglieder', fs_tasks: 'Aufgaben', fs_plans: 'Anbaupläne', fs_fields: 'Feldmeldungen', fs_places: 'Orte' };

// Der laufende Spielstand: aus careerSavegame (Webinterface, sonst FTP). Ohne beides weiß der Hub es nicht.
function identity() {
  const sg = feeds.get('savegame') || (!feeds.url('savegame') && ((feeds.get('ftp') || {}).files || {})['careerSavegame.xml']) || null;
  if (!sg || !(sg.mapTitle || sg.mapId)) return null;
  return { key: `${sg.mapTitle || sg.mapId}|${sg.created || ''}`, map: sg.mapTitle || sg.mapId, title: sg.title || '', created: sg.created || '' };
}
const current = () => getSetting('fs_save', '') || '';
function row(key) { return db.prepare('SELECT * FROM fs_saves WHERE key = ?').get(key) || null; }
function list() {
  return db.prepare('SELECT key, map, title, created, first_at, last_at, data IS NOT NULL AS stored, LENGTH(data) AS bytes, data FROM fs_saves ORDER BY last_at DESC').all()
    .map(r => ({ ...r, active: r.key === current(), counts: r.data ? counts(JSON.parse(r.data)) : null, data: undefined }));
}
function counts(snap) {
  const out = {};
  for (const [t, label] of Object.entries(LABELS)) out[label] = (snap.tables[t] || []).length;
  return out;
}
function liveCounts() { return Object.fromEntries(Object.entries(LABELS).map(([t, l]) => [l, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n])); }
const hasData = () => Object.values(liveCounts()).some(n => n > 0);

function snapshot() {
  return {
    tables: Object.fromEntries(TABLES.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()])),
    settings: Object.fromEntries(SETTINGS.map(k => [k, getSetting(k, null)])),
  };
}
function clear() {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  for (const k of SETTINGS) setSetting(k, '');
}
function restore(snap) {
  const users = new Set(db.prepare('SELECT id FROM users').all().map(r => r.id));
  const cropIds = new Set(db.prepare('SELECT id FROM fs_crops').all().map(r => r.id));
  for (const t of TABLES) {
    for (const r of snap.tables[t] || []) {
      const x = { ...r };
      for (const c of USER_COLS) if (x[c] !== undefined && x[c] !== null && !users.has(x[c])) x[c] = null;
      if (t === 'fs_members' && x.user_id === null) continue;
      if ('crop_id' in x && x.crop_id !== null && !cropIds.has(x.crop_id)) { if (t === 'fs_plans') continue; x.crop_id = null; }
      const cols = Object.keys(x);
      db.prepare(`INSERT OR IGNORE INTO ${t}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => x[c]));
    }
  }
  for (const [k, v] of Object.entries(snap.settings || {})) setSetting(k, v ?? '');
}

// Eigenes Kartenbild: gehört es zum alten Spielstand, wird es unter einem eigenen Namen abgelegt
const customImage = () => fs.readdirSync(feeds.FS_DIR).find(f => /^map-custom\.(png|jpe?g|webp)$/.test(f)) || null;
const hash = key => crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
function parkImage(key) {
  const img = customImage();
  if (!img || getSetting('fs_map_custom_save', '') !== key) return null;
  const name = `map-saved-${hash(key)}${path.extname(img)}`;
  fs.renameSync(path.join(feeds.FS_DIR, img), path.join(feeds.FS_DIR, name));
  return name;
}
function unparkImage(r) {
  if (!r || !r.image || !fs.existsSync(path.join(feeds.FS_DIR, r.image)) || customImage()) return;
  fs.renameSync(path.join(feeds.FS_DIR, r.image), path.join(feeds.FS_DIR, 'map-custom' + path.extname(r.image)));
  setSetting('fs_map_custom_save', r.key);
}

function upsert(id, t = now()) {
  db.prepare(`INSERT INTO fs_saves(key, map, title, created, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET map = excluded.map, title = excluded.title, created = excluded.created, last_at = excluded.last_at`)
    .run(id.key, id.map, id.title, id.created, t, t);
}
// Von old auf id umstellen: alte Daten ablegen, neue zurückholen oder leer beginnen
function switchTo(oldKey, id) {
  const t = now();
  tx(() => {
    if (oldKey) {
      const snap = JSON.stringify(snapshot());
      if (!row(oldKey)) db.prepare('INSERT INTO fs_saves(key, map, first_at, last_at) VALUES (?, ?, ?, ?)').run(oldKey, oldKey.split('|')[0], t, t);
      db.prepare('UPDATE fs_saves SET data = ?, last_at = ?, image = COALESCE(?, image) WHERE key = ?').run(snap, t, parkImage(oldKey), oldKey);
    }
    clear();
    const r = row(id.key);
    if (r && r.data) restore(JSON.parse(r.data));
    upsert(id, t);
    db.prepare('UPDATE fs_saves SET data = NULL WHERE key = ?').run(id.key);
    setSetting('fs_save', id.key);
    setSetting('fs_save_unsure', '0');
    unparkImage(r);
  });
  // Das Kartenbild vom Server zeigt noch die alte Karte, Dateien vom FTP gehören zum alten Ordner
  fs.rmSync(feeds.MAP_FILE, { force: true });
  for (const k of ['map', 'ftp', 'savegame']) if (feeds.configured(k)) feeds.soon(k);
}

// Nach jedem Abruf: läuft noch derselbe Spielstand? Gibt { from, to, restored } zurück, wenn umgestellt wurde.
function check() {
  const id = identity();
  if (!id) return null;
  const cur = current();
  if (cur === id.key) { db.prepare('UPDATE fs_saves SET last_at = ?, title = ? WHERE key = ?').run(now(), id.title, id.key); return null; }
  if (!cur) {
    // Erster Lauf: die vorhandenen Daten können noch von einem früheren Spielstand sein, das entscheidet der Admin
    upsert(id);
    setSetting('fs_save', id.key);
    if (hasData()) setSetting('fs_save_unsure', '1');
    return null;
  }
  const from = row(cur), known = !!(row(id.key) || {}).data;
  switchTo(cur, id);
  return { from: from ? from.map : cur.split('|')[0], to: id.map, restored: known };
}
// Seitenverwaltung: die Daten gehören nicht zu diesem Spielstand → beiseitelegen und leer beginnen
function restart() {
  const id = identity() || { key: current(), map: '', title: '', created: '' };
  if (!id.key) return false;
  const t = now();
  tx(() => {
    db.prepare('INSERT INTO fs_saves(key, map, title, created, first_at, last_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`alt-${t}`, 'Früherer Stand', `beiseitegelegt am ${new Date(t * 1000).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`, '', t, t, JSON.stringify(snapshot()));
    clear();
    upsert(id, t);
    setSetting('fs_save', id.key);
    setSetting('fs_save_unsure', '0');
  });
  return true;
}
function keep() { setSetting('fs_save_unsure', '0'); }
// Einen abgelegten Stand in den laufenden holen (ersetzt dessen Daten, die vorher beiseitegelegt werden)
function adopt(key) {
  const r = row(key);
  const id = identity();
  if (!r || !r.data || r.key === current() || !id) return false;
  tx(() => {
    const t = now();
    const mine = JSON.stringify(snapshot());
    clear();
    restore(JSON.parse(r.data));
    db.prepare('DELETE FROM fs_saves WHERE key = ?').run(key);
    if (Object.values(counts(JSON.parse(mine))).some(n => n > 0)) {
      db.prepare('INSERT INTO fs_saves(key, map, title, created, first_at, last_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(`alt-${t}`, 'Früherer Stand', `beiseitegelegt am ${new Date(t * 1000).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`, '', t, t, mine);
    }
    setSetting('fs_save_unsure', '0');
  });
  return true;
}
function remove(key) {
  const r = row(key);
  if (!r || r.key === current()) return false;
  if (r.image) fs.rmSync(path.join(feeds.FS_DIR, r.image), { force: true });
  db.prepare('DELETE FROM fs_saves WHERE key = ?').run(key);
  return true;
}
// Eigenes Kartenbild hochgeladen: gehört zum laufenden Spielstand
function imageUploaded() { setSetting('fs_map_custom_save', current()); }

module.exports = { TABLES, identity, current, row, list, liveCounts, check, switchTo, restart, keep, adopt, remove, imageUploaded, unsure: () => getSetting('fs_save_unsure', '0') === '1' };
