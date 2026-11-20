'use strict';
// Dancors Downloads (Version 3.0, src/routes/downloads.js, views/v3/downloads*.ejs): die Dateien der Seite in einer modernen
// Ansicht mit Kategorien links, hervorgehobenen Projekten oben und der Liste darunter.
// Neu ist das Projekt: ein Download mit Beschreibung, Bildern, Anleitung und mehreren Versionen samt Änderungen. Jede Version
// ist eine ganz normale Datei (files) mit project_id, version und changes; zählt, lädt und prüft sich also wie bisher.
const fs = require('node:fs');
const path = require('node:path');
const { db, now, UPLOAD_DIR, MEDIA_DIR } = require('./db');
const auth = require('./auth');
const cats = require('./filecats');
const { slugify, fmtSize } = require('./util');

db.exec(`
CREATE TABLE IF NOT EXISTS dl_projects (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',          -- ein Satz für Liste und Kachel
  body_md TEXT NOT NULL DEFAULT '',          -- Beschreibung
  howto_md TEXT NOT NULL DEFAULT '',         -- Anleitung (Installieren, Einrichten …)
  icon TEXT NOT NULL DEFAULT '📦',
  color TEXT NOT NULL DEFAULT 'dl',          -- Farbe des Symbols: dl | du | de | fs | desk | x | gray
  cover TEXT,                                -- Bild aus media (stored_name)
  shots TEXT NOT NULL DEFAULT '[]',          -- weitere Bilder (stored_name), JSON
  category TEXT NOT NULL DEFAULT 'Allgemein',
  game TEXT,
  featured INTEGER NOT NULL DEFAULT 0,       -- oben hervorgehoben
  visibility TEXT NOT NULL DEFAULT 'public',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dlp_cat ON dl_projects(category);
`);
const cols = db.prepare('PRAGMA table_info(files)').all().map(c => c.name);
if (!cols.includes('project_id')) db.exec('ALTER TABLE files ADD COLUMN project_id INTEGER REFERENCES dl_projects(id) ON DELETE SET NULL');
if (!cols.includes('version')) db.exec('ALTER TABLE files ADD COLUMN version TEXT');           // z. B. 2.1
if (!cols.includes('changes')) db.exec('ALTER TABLE files ADD COLUMN changes TEXT');           // Änderungen dieser Version (Markdown)
db.exec('CREATE INDEX IF NOT EXISTS files_project ON files(project_id, created_at)');

const COLORS = { dl: 'Blau', du: 'Bernstein', de: 'Rot', fs: 'Grün', desk: 'Türkis', x: 'Lila', gray: 'Grau' };
const RESERVED = new Set(['neues-projekt', 'p', 'dl', 'kategorie', 'bild', 'vorschau', 'privat', 'neu', 'alle', 'projekte']);
const NEW_DAYS = 14;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const parseShots = p => { try { const a = JSON.parse(p.shots || '[]'); return Array.isArray(a) ? a.filter(s => typeof s === 'string') : []; } catch { return []; } };

// ---------- Rechte ----------
// Projekte legt an, wer hochladen darf. Bearbeiten darf der Besitzer und der Admin.
const canCreate = user => !!user && user.canUpload;
const canEdit = (user, p) => !!user && (user.isAdmin || (p.owner_id && p.owner_id === user.id));
const canSee = (user, p) => auth.canSee(user, 'dl_project', p);

// ---------- Lesen ----------
function bySlug(slug) { return db.prepare('SELECT * FROM dl_projects WHERE slug = ?').get(String(slug || '')); }
function byId(id) { return db.prepare('SELECT * FROM dl_projects WHERE id = ?').get(Number(id)); }

// Versionen eines Projekts, die der Besucher sehen darf, neueste zuerst
function versions(user, p) {
  const v = auth.visibilitySql(user, 'file', 'f', { noPrivat: true });
  return db.prepare(`SELECT f.* FROM files f WHERE f.project_id = ? AND ${v.sql} ORDER BY f.created_at DESC, f.id DESC`).all(p.id, ...v.params);
}

function projectRow(p, user, list) {
  const vs = versions(user, p), latest = vs[0] || null;
  return {
    type: 'project', id: p.id, slug: p.slug, url: '/downloads/' + p.slug, title: p.title, summary: p.summary, icon: p.icon || '📦', color: p.color || 'dl',
    cover: p.cover ? '/media/' + p.cover : null, cat: p.category, catIcon: cats.iconOf(p.category, list), game: p.game || '', featured: !!p.featured,
    version: latest && latest.version, size: latest ? latest.size : 0, sizeText: latest ? fmtSize(latest.size) : '', dl: latest ? '/files/dl/' + latest.id : null,
    count: vs.length, downloads: vs.reduce((n, f) => n + f.downloads, 0), date: Math.max(p.updated_at, latest ? latest.created_at : 0),
    vis: p.visibility, edit: canEdit(user, p),
  };
}
function fileRow(f, user, list) {
  return {
    type: 'file', id: f.id, url: '/files/dl/' + f.id, view: '/ansehen/datei/' + f.id, title: f.title, summary: f.description || (f.original_name !== f.title ? f.original_name : ''),
    icon: cats.iconOf(f.category, list), cat: f.category, catIcon: cats.iconOf(f.category, list), game: f.game || '', size: f.size, sizeText: fmtSize(f.size),
    dl: '/files/dl/' + f.id, downloads: f.downloads, date: f.created_at, vis: f.visibility, privat: !!f.privat,
    edit: user && user.isAdmin ? '/admin/files/' + f.id : user && f.uploader_id === user.id ? '/eigene-dateien?bib=datei' : '',
  };
}

// Die FS25-Mod lebt im Hub (Hub Link). In den Downloads steht sie nur als Verweis, für alle, die den Hub sehen.
function hubRow(user) {
  try {
    const hub = require('./hub');
    if (!hub.canView(user)) return null;
    return {
      type: 'link', title: 'FS25 Hub Link', summary: `Die Mod für den Farming-Simulator-Server, Download und Anleitung im ${hub.title()}`, icon: '🚜', color: 'fs',
      cat: 'Mods', catIcon: cats.iconOf('Mods'), game: 'Farming Simulator 25', version: hub.modVersion(), url: hub.BASE + '/hublink', date: 0, sizeText: '', external: false,
    };
  } catch { return null; }
}

// Alles, was in der Liste steht: Projekte (je eine Zeile) und Dateien ohne Projekt
function visibleProjects(user) {
  const v = auth.visibilitySql(user, 'dl_project', 'p');
  return db.prepare(`SELECT p.* FROM dl_projects p WHERE ${v.sql} ORDER BY p.featured DESC, p.updated_at DESC`).all(...v.params);
}
function looseFiles(user, privat = false) {
  const v = auth.visibilitySql(user, 'file', 'f', privat ? {} : { noPrivat: true });
  return db.prepare(`SELECT f.* FROM files f WHERE f.project_id IS NULL AND ${v.sql} ${privat ? 'AND f.privat = 1' : ''} ORDER BY f.created_at DESC`).all(...v.params);
}
function privatTracks(user) {
  if (!user || !user.canPrivate) return [];
  const v = auth.visibilitySql(user, 'track', 't');
  return db.prepare(`SELECT t.* FROM tracks t WHERE t.privat = 1 AND ${v.sql} AND t.stored_name IS NOT NULL AND t.stored_name != '' ORDER BY t.created_at DESC`).all(...v.params)
    .map(t => ({ type: 'track', id: t.id, title: t.title, summary: [t.artist, t.album].filter(Boolean).join(' · '), icon: t.kind === 'video' ? '🎬' : '🎵', cat: t.kind === 'video' ? 'Videos' : 'Musik',
      size: t.size, sizeText: fmtSize(t.size || 0), date: t.created_at, url: '/musik?titel=' + t.id, dl: '/musik/stream/' + t.id + '?dl=1', vis: t.visibility }));
}

// Ansicht: node = alle | neu | projekte | privat | k:<Kategorie>; q = Suche
function view(user, node, q) {
  const list = cats.list();
  const projects = visibleProjects(user).map(p => projectRow(p, user, list)).filter(p => p.count || p.edit);
  const files = looseFiles(user).map(f => fileRow(f, user, list));
  const hub = hubRow(user);
  const all = [...projects, ...files, ...(hub ? [hub] : [])];
  const byCat = {};
  for (const r of all) (byCat[r.cat] ||= []).push(r);
  const catNodes = list.filter(c => byCat[c.name] && byCat[c.name].length).map(c => ({ key: 'k:' + c.name, icon: c.icon, label: c.name, n: byCat[c.name].length }));
  const since = now() - NEW_DAYS * 86400;
  const fresh = all.filter(r => r.date >= since);
  const privat = user && user.canPrivate ? [...looseFiles(user, true).map(f => fileRow(f, user, list)), ...privatTracks(user)].sort((a, b) => b.date - a.date) : null;

  q = str(q, 100).toLowerCase();
  let rows, title = 'Alle Downloads', icon = '🗂️';
  if (q) {
    const hit = r => [r.title, r.summary, r.cat, r.game, r.version].some(x => x && String(x).toLowerCase().includes(q));
    rows = all.filter(hit); node = 'suche'; title = `Suche: „${q}“`; icon = '🔍';
  } else if (node === 'neu') { rows = fresh; title = 'Neu hinzugefügt'; icon = '🆕'; }
  else if (node === 'projekte') { rows = projects; title = 'Projekte'; icon = '⭐'; }
  else if (node === 'privat' && privat) { rows = privat; title = 'Privat'; icon = '🔒'; }
  else if (node && node.startsWith('k:') && byCat[node.slice(2)]) { rows = byCat[node.slice(2)]; title = node.slice(2); icon = cats.iconOf(title, list); }
  else { node = 'alle'; rows = all; }
  rows = [...rows].sort((a, b) => (b.type === 'project') - (a.type === 'project') || b.date - a.date);
  const featured = node === 'alle' ? projects.filter(p => p.featured).slice(0, 4) : [];
  return {
    node, title, icon, rows, featured, q,
    tree: { all: all.length, fresh: fresh.length, projects: projects.length, cats: catNodes, privat: privat ? privat.length : null },
  };
}

// Für Startseite und Suche: Anzahl, das Neueste
function stats(user) {
  const projects = visibleProjects(user).length;
  const v = auth.visibilitySql(user, 'file', 'f', { noPrivat: true });
  const files = db.prepare(`SELECT COUNT(*) AS n FROM files f WHERE f.project_id IS NULL AND ${v.sql}`).get(...v.params).n;
  return { count: projects + files, latest: recent(user, 1)[0] || null };
}
function recent(user, limit = 5) {
  const vp = auth.visibilitySql(user, 'dl_project', 'p'), vf = auth.visibilitySql(user, 'file', 'f', { noPrivat: true });
  const out = [];
  // Neue Versionen zählen als Neuigkeit des Projekts
  for (const r of db.prepare(`SELECT f.id, f.title, f.version, f.created_at, p.title AS ptitle, p.slug, p.visibility, p.owner_id, p.id AS pid FROM files f
      LEFT JOIN dl_projects p ON p.id = f.project_id WHERE ${vf.sql} ORDER BY f.created_at DESC LIMIT ?`).all(...vf.params, limit * 3)) {
    if (r.pid && !auth.canSee(user, 'dl_project', { id: r.pid, visibility: r.visibility, owner_id: r.owner_id })) continue;
    out.push(r.pid ? { title: r.ptitle + (r.version ? ' ' + r.version : ''), url: '/downloads/' + r.slug, at: r.created_at } : { title: r.title, url: '/downloads?q=' + encodeURIComponent(r.title), at: r.created_at });
  }
  for (const p of db.prepare(`SELECT p.title, p.slug, p.created_at FROM dl_projects p WHERE ${vp.sql} AND NOT EXISTS (SELECT 1 FROM files f WHERE f.project_id = p.id) ORDER BY p.created_at DESC LIMIT ?`).all(...vp.params, limit)) {
    out.push({ title: p.title, url: '/downloads/' + p.slug, at: p.created_at });
  }
  const seen = new Set();
  return out.sort((a, b) => b.at - a.at).filter(r => !seen.has(r.url) && seen.add(r.url)).slice(0, limit);
}
function search(user, q, limit = 20) {
  q = str(q, 100).toLowerCase();
  if (!q) return [];
  return view(user, 'alle', q).rows.slice(0, limit).map(r => ({ kind: 'dl', icon: r.icon, title: r.title + (r.version ? ' ' + r.version : ''), text: r.summary || r.cat, url: r.type === 'file' ? '/downloads?q=' + encodeURIComponent(r.title) : r.url }));
}

// ---------- Schreiben ----------
function uniqueSlug(base, id = 0) {
  let slug = slugify(base);
  if (RESERVED.has(slug)) slug += '-projekt';
  for (let i = 2; db.prepare('SELECT 1 FROM dl_projects WHERE slug = ? AND id != ?').get(slug, id); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}
function fields(b, list) {
  const category = cats.pick(b.category, list);
  return {
    title: str(b.title, 120), summary: str(b.summary, 240), body_md: String(b.body_md || '').slice(0, 200000), howto_md: String(b.howto_md || '').slice(0, 200000),
    icon: [...str(b.icon, 8)].slice(0, 2).join('') || '📦', color: Object.hasOwn(COLORS, b.color) ? b.color : 'dl',
    category, game: (list.find(c => c.name === category) || {}).game ? str(b.game, 100) || null : null,
  };
}
function create(user, b, extra = {}) {
  const f = fields(b, cats.list());
  if (!f.title) throw new Error('Bitte gib dem Projekt einen Namen.');
  const t = now();
  const id = Number(db.prepare(`INSERT INTO dl_projects(slug, title, summary, body_md, howto_md, icon, color, category, game, featured, visibility, owner_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uniqueSlug(b.slug || f.title), f.title, f.summary, f.body_md, f.howto_md, f.icon, f.color, f.category, f.game,
    user.isAdmin && b.featured ? 1 : 0, extra.visibility || 'public', user.id, t, t).lastInsertRowid);
  return byId(id);
}
function update(user, p, b, extra = {}) {
  const f = fields(b, cats.list());
  if (!f.title) throw new Error('Bitte gib dem Projekt einen Namen.');
  const slug = b.slug && slugify(b.slug) !== p.slug ? uniqueSlug(b.slug, p.id) : p.slug;
  db.prepare(`UPDATE dl_projects SET slug = ?, title = ?, summary = ?, body_md = ?, howto_md = ?, icon = ?, color = ?, category = ?, game = ?, featured = ?, visibility = ?, updated_at = ? WHERE id = ?`)
    .run(slug, f.title, f.summary, f.body_md, f.howto_md, f.icon, f.color, f.category, f.game, user.isAdmin ? (b.featured ? 1 : 0) : p.featured, extra.visibility || p.visibility, now(), p.id);
  // Versionen folgen der Sichtbarkeit und Kategorie des Projekts
  db.prepare('UPDATE files SET visibility = ?, category = ?, game = ? WHERE project_id = ?').run(extra.visibility || p.visibility, f.category, f.game, p.id);
  return byId(p.id);
}

// Bilder (Titelbild, weitere Bilder) kommen mit dem Formular ins Upload-Verzeichnis und ziehen in die Medien um
function takeImage(file, userId) {
  if (!file) return null;
  if (!IMAGE_TYPES.includes(file.mimetype)) { removeQuietly(file.path); return null; }
  const dest = path.join(MEDIA_DIR, file.filename);
  try { fs.renameSync(file.path, dest); } catch { fs.copyFileSync(file.path, dest); removeQuietly(file.path); }
  db.prepare('INSERT INTO media(stored_name, original_name, mime, size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(file.filename, file.originalname, file.mimetype, file.size, userId, now());
  return file.filename;
}
function setImages(p, { cover, shots, dropCover, dropShots }) {
  let list = parseShots(p);
  if (dropShots && dropShots.length) list = list.filter(s => !dropShots.includes(s));
  list = [...list, ...(shots || [])].slice(0, 12);
  const c = cover || (dropCover ? null : p.cover);
  db.prepare('UPDATE dl_projects SET cover = ?, shots = ?, updated_at = ? WHERE id = ?').run(c, JSON.stringify(list), now(), p.id);
}

// Neue Version: eine Datei im Projekt, mit Versionsnummer und Änderungen
function addVersion(user, p, file, b) {
  const id = Number(db.prepare(`INSERT INTO files(title, description, category, game, original_name, stored_name, size, mime, visibility, uploader_id, created_at, project_id, version, changes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.title + (str(b.version, 30) ? ' ' + str(b.version, 30) : ''), p.summary || null, p.category, p.game, file.originalname, file.filename,
    file.size, file.mimetype, p.visibility, user.id, now(), p.id, str(b.version, 30) || null, String(b.changes || '').slice(0, 20000) || null).lastInsertRowid);
  db.prepare('UPDATE dl_projects SET updated_at = ? WHERE id = ?').run(now(), p.id);
  return id;
}
function removeVersion(p, fileId) {
  const f = db.prepare('SELECT * FROM files WHERE id = ? AND project_id = ?').get(Number(fileId), p.id);
  if (!f) return false;
  removeQuietly(path.join(UPLOAD_DIR, f.stored_name));
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  return true;
}
// Projekt löschen nimmt seine Versionen mit; die Bilder bleiben in der Bibliothek
function remove(p) {
  for (const f of db.prepare('SELECT * FROM files WHERE project_id = ?').all(p.id)) removeVersion(p, f.id);
  db.prepare("DELETE FROM acl WHERE item_type = 'dl_project' AND item_id = ?").run(p.id);
  db.prepare('DELETE FROM dl_projects WHERE id = ?').run(p.id);
}
// Eine vorhandene Datei einem Projekt zuordnen (Seitenverwaltung → Downloads → Datei)
function assign(fileId, projectId, version, changes) {
  const p = projectId ? byId(projectId) : null;
  db.prepare('UPDATE files SET project_id = ?, version = ?, changes = ? WHERE id = ?').run(p ? p.id : null, str(version, 30) || null, String(changes || '').slice(0, 20000) || null, Number(fileId));
  if (p) db.prepare('UPDATE dl_projects SET updated_at = ? WHERE id = ?').run(now(), p.id);
}
function removeQuietly(p) { try { fs.rmSync(p, { force: true }); } catch { /* egal */ } }

module.exports = {
  COLORS, NEW_DAYS, canCreate, canEdit, canSee, bySlug, byId, versions, view, stats, recent, search, create, update, takeImage, setImages,
  addVersion, removeVersion, remove, assign, parseShots, projectRow, hubRow, all: () => db.prepare('SELECT id, title FROM dl_projects ORDER BY title COLLATE NOCASE').all(),
};
