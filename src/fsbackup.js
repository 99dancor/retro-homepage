'use strict';
// Farming Simulator Hub: Backups. Ein Backup ist ein ZIP mit allem, was der Hub selbst weiß und nicht vom Server neu holen
// kann: Höfe, Mitglieder, Aufgaben, Pläne, Orte, Verläufe, Bodenverteilung und Stationen des laufenden Spielstands, die
// beiseitegelegten Spielstände (fs_saves), Notizen, Changelog, Vorschläge, Online-Zeiten, Kalendervorlage, Produktionsplaner,
// die zuletzt gelesenen Daten vom Server samt Export der Mod (fs_cache), die Einstellungen des Hubs, eigene Kartenbilder,
// Hintergründe, den hochgeladenen Export und die Tierdaten (wiki.xml). Auf Wunsch auch die Dichtekarten und die Symbole.
// Adressen, Codes und der FTP-Zugang kommen nie hinein (wie in der Seitenverwaltung bleiben sie auf dem Server).
//
// Aufbau: manifest.json (was, wann, welcher Spielstand), db.json (Tabellen und Einstellungen), files/… (Dateien aus
// DATA_DIR/fshub). Abgelegt in DATA_DIR/fshub-backups. Vor jedem Spielstandwechsel und vor jedem Wiederherstellen legt der
// Hub selbst eins an (auto), davon bleiben die letzten zehn.
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { db, now, getSetting, setSetting, tx, DATA_DIR } = require('./db');
const feeds = require('./fsfeeds');

const DIR = path.join(DATA_DIR, 'fshub-backups');
fs.mkdirSync(DIR, { recursive: true });
const KEEP_AUTO = 10;
const FORMAT = 1;
// Reihenfolge zum Einspielen (Fremdschlüssel: Vorlagen vor Plänen, Vorschläge vor Stimmen), gelöscht wird rückwärts
const TABLES = ['fs_crops', 'fs_prod_buildings', 'fs_prod_recipes', 'fs_suggestions', 'fs_votes', 'fs_farms', 'fs_members', 'fs_places', 'fs_tasks',
  'fs_hidden', 'fs_plans', 'fs_fields', 'fs_hist', 'fs_outlines', 'fs_soil', 'fs_stations', 'fs_saves', 'fs_notes', 'fs_sessions', 'fs_changelog', 'fs_cache'];
const USER_COLS = ['updated_by', 'user_id', 'assignee_id', 'created_by', 'done_by'];
// Zugangsdaten und was nur gerade gilt, bleiben draußen. Der FTP-Ordner bleibt auch, wie er ist: Wiederherstellen soll den
// Server nicht umstellen (die Liste der Ordner kommt mit).
const SECRET = k => /^fs_url_/.test(k) || /^fs_ftp_/.test(k) || k === 'fs_online';
// Dateien im Datenordner des Hubs. Abgeleitetes (Ebenen der Karte, patches.json) baut der Hub selbst neu.
const FILE_BASE = /^(map-custom\.(png|jpe?g|webp)|map-saved-[0-9a-f]+\.(png|jpe?g|webp)|bg-[a-z0-9-]+\.(png|jpe?g|webp)|export-saved-[0-9a-f]+\.json|hub-export\.json|wiki\.xml|map-server)$/;
const FILE_DENSE = /^sg-[A-Za-z0-9_.]+\.(gdm|grle)$/;
const FILE_ICON = /^[a-z0-9]+\.png$/;

const stamp = t => new Date(t * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(/[-:]/g, '').replace(' ', '-').slice(0, 13);
const slug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const safeName = n => /^[a-z0-9][a-z0-9_.-]*\.zip$/i.test(String(n || '')) && !String(n).includes('..') ? String(n) : null;
const columns = t => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));

function hubSettings() {
  return Object.fromEntries(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'fs\\_%' ESCAPE '\\'").all().filter(r => !SECRET(r.key)).map(r => [r.key, r.value]));
}
function hubFiles({ dense = false, icons = false } = {}) {
  const out = [];
  for (const f of fs.readdirSync(feeds.FS_DIR)) {
    const p = path.join(feeds.FS_DIR, f);
    if (!fs.statSync(p).isFile()) continue;
    if (FILE_BASE.test(f) || (dense && FILE_DENSE.test(f))) out.push({ name: f, file: p });
  }
  const iconDir = require('./fsicons').DIR;
  if (icons && fs.existsSync(iconDir)) for (const f of fs.readdirSync(iconDir)) if (FILE_ICON.test(f)) out.push({ name: 'icons/' + f, file: path.join(iconDir, f) });
  return out;
}
function counts(tables) {
  const n = t => (tables[t] || []).length;
  const saves = (tables.fs_saves || []).filter(r => r.data).length;
  return { Höfe: n('fs_farms'), Aufgaben: n('fs_tasks'), Anbaupläne: n('fs_plans'), Orte: n('fs_places'), Notizen: n('fs_notes'), 'weitere Spielstände': saves };
}

// Neues Backup anlegen; gibt den Dateinamen zurück
function create({ label = '', auto = false, dense = false, icons = false } = {}) {
  const t = now();
  const saves = require('./fssaves');
  const id = saves.identity() || saves.row(saves.current());
  const tables = Object.fromEntries(TABLES.map(tb => [tb, db.prepare(`SELECT * FROM ${tb}`).all()]));
  const files = hubFiles({ dense, icons });
  let ex = null;
  try { ex = require('./fsexport').summary(require('./fsexport').current()); } catch { ex = null; }
  const manifest = {
    app: 'farming-hub', format: FORMAT, created_at: t, label: String(label || '').trim().slice(0, 120), auto: !!auto,
    save: { key: saves.current(), map: (id && id.map) || '', title: (id && id.title) || '', created: (id && id.created) || '', dir: feeds.ftpConfig().dir },
    counts: counts(tables), export: ex ? { mapTitle: ex.mapTitle, fields: ex.fields, farmlands: ex.farmlands, productions: ex.productions } : null,
    files: files.map(f => f.name), dense: !!dense, icons: !!icons,
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 1)));
  zip.addFile('db.json', Buffer.from(JSON.stringify({ tables, settings: hubSettings() })));
  for (const f of files) zip.addFile('files/' + f.name, fs.readFileSync(f.file));
  let name = `${stamp(t)}-${auto ? 'auto' : 'backup'}${slug(manifest.save.map) ? '-' + slug(manifest.save.map) : ''}.zip`;
  for (let i = 2; fs.existsSync(path.join(DIR, name)); i++) name = name.replace(/(-\d+)?\.zip$/, `-${i}.zip`);
  fs.writeFileSync(path.join(DIR, name), zip.toBuffer());
  if (auto) prune();
  return name;
}
// Von den automatischen nur die letzten zehn behalten
function prune() {
  const autos = list().filter(b => b.auto);
  for (const b of autos.slice(KEEP_AUTO)) fs.rmSync(path.join(DIR, b.name), { force: true });
}

function readManifest(buf) {
  const zip = new AdmZip(buf);
  const m = zip.getEntry('manifest.json');
  if (!m || !zip.getEntry('db.json')) throw new Error('Das ist kein Backup des Farming Hubs.');
  const manifest = JSON.parse(m.getData().toString('utf8'));
  if (manifest.app !== 'farming-hub') throw new Error('Das ist kein Backup des Farming Hubs.');
  if (manifest.format > FORMAT) throw new Error('Das Backup ist von einer neueren Version des Hubs.');
  return { zip, manifest };
}
const metaCache = new Map();   // Name → { mtime, meta }
function list() {
  const out = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!safeName(name)) continue;
    const p = path.join(DIR, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    let c = metaCache.get(name);
    if (!c || c.mtime !== st.mtimeMs) {
      let meta;
      try { meta = readManifest(fs.readFileSync(p)).manifest; } catch (e) { meta = { broken: e.message }; }
      c = { mtime: st.mtimeMs, meta };
      metaCache.set(name, c);
    }
    out.push({ name, bytes: st.size, at: c.meta.created_at || Math.floor(st.mtimeMs / 1000), ...c.meta });
  }
  return out.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}
function file(name) {
  const n = safeName(name);
  return n && fs.existsSync(path.join(DIR, n)) ? path.join(DIR, n) : null;
}
function remove(name) {
  const f = file(name);
  if (!f) return false;
  fs.rmSync(f, { force: true });
  metaCache.delete(name);
  return true;
}
// Hochgeladenes Backup prüfen und in die Liste legen (eingespielt wird es erst auf Knopfdruck)
function upload(buf, original = '') {
  const { manifest } = readManifest(buf);
  let name = safeName(path.basename(String(original || ''))) || `${stamp(manifest.created_at || now())}-hochgeladen.zip`;
  for (let i = 2; fs.existsSync(path.join(DIR, name)); i++) name = name.replace(/(-\d+)?\.zip$/, `-${i}.zip`);
  fs.writeFileSync(path.join(DIR, name), buf);
  return name;
}

// Einspielen: ersetzt alles, was im Backup steckt. Vorher legt der Hub den jetzigen Stand als Backup ab.
function restore(name) {
  const f = file(name);
  if (!f) throw new Error('Backup nicht gefunden.');
  const { zip, manifest } = readManifest(fs.readFileSync(f));
  const data = JSON.parse(zip.getEntry('db.json').getData().toString('utf8'));
  const before = create({ label: `vor dem Wiederherstellen von ${name}`, auto: true });
  const users = new Set(db.prepare('SELECT id FROM users').all().map(r => r.id));
  tx(() => {
    for (const t of [...TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABLES) {
      const have = columns(t);
      for (const r of (data.tables || {})[t] || []) {
        const x = {};
        for (const [k, v] of Object.entries(r)) if (have.has(k)) x[k] = v;
        // Konten, die es hier nicht (mehr) gibt: Spalte leer, Zuordnungen fallen weg
        for (const c of USER_COLS) if (x[c] !== undefined && x[c] !== null && !users.has(x[c])) x[c] = null;
        if (['fs_members', 'fs_votes'].includes(t) && x.user_id === null) continue;
        const cols = Object.keys(x);
        if (cols.length) db.prepare(`INSERT OR IGNORE INTO ${t}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => x[c]));
      }
    }
    // Einstellungen des Hubs: was im Backup fehlt, wird leer (Zugangsdaten bleiben unberührt)
    const keep = data.settings || {};
    for (const k of Object.keys(hubSettings())) if (!(k in keep)) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
    for (const [k, v] of Object.entries(keep)) if (!SECRET(k) && /^fs_/.test(k)) setSetting(k, v ?? '');
    // Der FTP-Abruf soll alles frisch holen: Dateistand vergessen, damit Dichtekarten und Co. neu kommen
    const c = db.prepare("SELECT info FROM fs_cache WHERE feed = 'ftp'").get();
    if (c && c.info) { try { const info = JSON.parse(c.info); info.seen = {}; db.prepare("UPDATE fs_cache SET info = ? WHERE feed = 'ftp'").run(JSON.stringify(info)); } catch { /* egal */ } }
  });
  // Dateien: was zum Backup gehört, ersetzen; Dichtekarten und Symbole nur, wenn sie drinstecken
  const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.startsWith('files/')).map(e => ({ e, name: e.entryName.slice(6) }));
  const del = re => { for (const x of fs.readdirSync(feeds.FS_DIR)) if (re.test(x)) fs.rmSync(path.join(feeds.FS_DIR, x), { force: true }); };
  del(FILE_BASE);
  if (manifest.dense) del(FILE_DENSE);
  const iconDir = require('./fsicons').DIR;
  if (manifest.icons) for (const x of fs.readdirSync(iconDir)) fs.rmSync(path.join(iconDir, x), { force: true });
  for (const { e, name: n } of entries) {
    if (n.startsWith('icons/')) { const b = n.slice(6); if (FILE_ICON.test(b)) fs.writeFileSync(path.join(iconDir, b), e.getData()); continue; }
    if (n.includes('/') || !(FILE_BASE.test(n) || FILE_DENSE.test(n))) continue;
    fs.writeFileSync(path.join(feeds.FS_DIR, n), e.getData());
  }
  // Zwischenspeicher neu laden und gleich abholen, damit der Stand vom Server dazukommt
  feeds.load();
  require('./fsicons').forget();
  require('./fsmap').forget();
  require('./fscrops').forget();
  require('./fshub').invalidate();
  for (const k of Object.keys(feeds.FEEDS)) if (feeds.configured(k)) feeds.soon(k);
  return { manifest, before };
}

module.exports = { DIR, TABLES, create, list, file, remove, upload, restore, readManifest };
