'use strict';
// Dancors Downloads (Version 3.0, src/routes/downloads.js, views/v3/downloads*.ejs): die Dateien der Seite in einer modernen
// Ansicht mit Kategorien links. Startansicht sind die Projekte als Karten im Stil der Titelleiste einer Projektseite (Update 96),
// „Alle Dateien“ ist die Tabelle mit allem. Reihenfolge, Anpinnen, Ausblenden und die Texte oben legt der Admin im
// Bearbeiten-Modus fest (Einstellung dl_layout, public/downloads.js).
// Neu ist das Projekt: ein Download mit Beschreibung, Bildern, Anleitung und mehreren Versionen samt Änderungen. Jede Version
// ist eine ganz normale Datei (files) mit project_id, version und changes; zählt, lädt und prüft sich also wie bisher.
const fs = require('node:fs');
const path = require('node:path');
const { db, now, getSetting, setSetting, UPLOAD_DIR, MEDIA_DIR } = require('./db');
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
const RESERVED = new Set(['neues-projekt', 'p', 'dl', 'kategorie', 'bild', 'vorschau', 'privat', 'neu', 'alle', 'projekte', 'seite']);
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
  const vs = versions(user, p), latest = vs[0] || null, since = now() - NEW_DAYS * 86400;
  const owner = p.owner_id ? db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(p.owner_id) : null;
  return {
    key: 'p' + p.id, owner: owner ? owner.display_name || owner.username : '', fresh: p.created_at >= since && vs.length <= 1,
    update: !!latest && vs.length > 1 && latest.created_at >= since, iconRaw: p.icon || '📦', coverName: p.cover || '',
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
      key: 'hub', featured: false, downloads: 0, type: 'link', title: 'FS25 Hub Link', summary: `Die Mod für den Farming-Simulator-Server, Download und Anleitung im ${hub.title()}`, icon: '🚜', color: 'fs',
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

// ---------- Aufbau der Seite (Bearbeiten-Modus) ----------
const LAYOUT = {
  title: 'Dancors Downloads', text: 'Projekte mit Versionen, Anleitung und einer Liste der Änderungen. Einzelne Dateien findest du unter „Alle Dateien“.',
  start: 'projekte', look: 'gross', more: true, order: [], hidden: [],
};
const SORTS = { eigene: 'Empfohlen', neu: 'Zuletzt aktualisiert', beliebt: 'Meiste Downloads', name: 'Name A–Z' };
const keyOk = k => typeof k === 'string' && /^(p\d{1,9}|d\d{1,9}|hub)$/.test(k);
function layout() {
  let l = {};
  try { l = JSON.parse(getSetting('dl_layout', 'null')) || {}; } catch { /* Standard */ }
  return normalize(l);
}
function normalize(l) {
  l = l && typeof l === 'object' ? l : {};
  const keys = a => (Array.isArray(a) ? [...new Set(a.filter(keyOk))].slice(0, 500) : []);
  return {
    title: str(l.title, 80) || LAYOUT.title, text: str(l.text, 300) || LAYOUT.text,
    start: l.start === 'alle' ? 'alle' : 'projekte', look: l.look === 'kompakt' ? 'kompakt' : 'gross', more: l.more !== false,
    order: keys(l.order), hidden: keys(l.hidden),
  };
}
// Speichert den Aufbau; Texte, Symbol, Farbe, Bild und „angepinnt“ gehen direkt an die Projekte
function saveLayout(input) {
  input = input && typeof input === 'object' ? input : {};
  const l = normalize({ ...layout(), ...input });
  const t = now();
  for (const c of Array.isArray(input.cards) ? input.cards.slice(0, 500) : []) {
    if (!c || !keyOk(c.key) || c.key[0] !== 'p') continue;   // Hub und Dioramen ändern hier nur ihren Platz
    const p = byId(c.key.slice(1));
    if (!p) continue;
    const cover = typeof c.cover === 'string' ? (c.cover.match(/^\/media\/([\w.-]+)$/) || [])[1] || (c.cover === '' ? null : p.cover) : p.cover;
    const next = {
      title: str(c.title, 120) || p.title, summary: c.summary === undefined ? p.summary : str(c.summary, 240),
      icon: [...str(c.icon, 8)].slice(0, 2).join('') || p.icon, color: Object.hasOwn(COLORS, c.color) ? c.color : p.color,
      cover, featured: c.pin === undefined ? p.featured : c.pin ? 1 : 0,
    };
    if (Object.keys(next).some(k => String(next[k] ?? '') !== String(p[k] ?? '')))
      db.prepare('UPDATE dl_projects SET title = ?, summary = ?, icon = ?, color = ?, cover = ?, featured = ?, updated_at = ? WHERE id = ?')
        .run(next.title, next.summary, next.icon, next.color, next.cover, next.featured, next.title !== p.title || next.summary !== p.summary ? t : p.updated_at, p.id);
  }
  setSetting('dl_layout', JSON.stringify(l));
  return l;
}

// Ansicht: node = projekte | alle | neu | privat | k:<Kategorie>; q = Suche; o = { sort, kat, nur }
function view(user, node, q, o = {}) {
  const list = cats.list(), l = layout();
  const projects = visibleProjects(user).map(p => projectRow(p, user, list)).filter(p => p.count || p.edit);
  const files = looseFiles(user).map(f => fileRow(f, user, list));
  const hub = hubRow(user);
  let dio = [];
  try { dio = require('./dioramen').downloadCards(user); } catch { dio = []; }   // Dioramen mit Haken „auch in Downloads zeigen“
  const cards = [...projects, ...(hub ? [hub] : []), ...dio];
  const all = [...cards, ...files];
  const byCat = {};
  for (const r of all) (byCat[r.cat] ||= []).push(r);
  const catNodes = list.filter(c => byCat[c.name] && byCat[c.name].length).map(c => ({ key: 'k:' + c.name, icon: c.icon, label: c.name, n: byCat[c.name].length }));
  const since = now() - NEW_DAYS * 86400;
  const fresh = all.filter(r => r.date >= since);
  const privat = user && user.canPrivate ? [...looseFiles(user, true).map(f => fileRow(f, user, list)), ...privatTracks(user)].sort((a, b) => b.date - a.date) : null;
  const hidden = new Set(l.hidden);
  for (const c of cards) c.hidden = hidden.has(c.key);

  // Reihenfolge der Karten
  const sort = Object.hasOwn(SORTS, o.sort) ? o.sort : 'eigene';
  const pos = new Map(l.order.map((k, i) => [k, i]));
  const cmp = {
    eigene: (a, b) => b.featured - a.featured || (pos.has(a.key) ? pos.get(a.key) : 1e6) - (pos.has(b.key) ? pos.get(b.key) : 1e6) || b.date - a.date,
    neu: (a, b) => b.date - a.date, beliebt: (a, b) => (b.downloads || 0) - (a.downloads || 0) || b.date - a.date,
    name: (a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }),
  }[sort];
  const sortCards = rs => [...rs].sort(cmp);

  q = str(q, 100).toLowerCase();
  if (!['projekte', 'alle', 'neu', 'privat'].includes(node) && !(node && node.startsWith('k:') && byCat[node.slice(2)])) node = l.start;
  if (node === 'privat' && !privat) node = l.start;
  let shown = [], rows = [], title = 'Projekte', icon = '⭐', kat = '';
  if (q) {
    const hit = r => [r.title, r.summary, r.cat, r.game, r.version].some(x => x && String(x).toLowerCase().includes(q));
    shown = sortCards(cards.filter(hit)); rows = files.filter(hit); node = 'suche'; title = `Suche: „${q}“`; icon = '🔍';
  } else if (node === 'projekte') {
    kat = cats.list().some(c => c.name === o.kat) && cards.some(c => c.cat === o.kat) ? o.kat : '';
    shown = sortCards(cards.filter(c => (!kat || c.cat === kat) && (!c.hidden || (user && user.isAdmin && !kat && sort === 'eigene'))));
  } else if (node === 'alle') {
    title = 'Alle Dateien'; icon = '🗂️';
    const nur = o.nur === 'projekte' || o.nur === 'dateien' ? o.nur : '';
    rows = (nur === 'projekte' ? cards : nur === 'dateien' ? files : all);
    rows = [...rows].sort((a, b) => (b.type !== 'file') - (a.type !== 'file') || b.date - a.date);
  } else if (node === 'neu') { rows = [...fresh].sort((a, b) => b.date - a.date); title = 'Neu hinzugefügt'; icon = '🆕'; }
  else if (node === 'privat') { rows = privat; title = 'Privat'; icon = '🔒'; }
  else {
    title = node.slice(2); icon = cats.iconOf(title, list);
    shown = sortCards(byCat[title].filter(r => r.type !== 'file' && !r.hidden)); rows = byCat[title].filter(r => r.type === 'file').sort((a, b) => b.date - a.date);
  }
  const chips = list.filter(c => cards.some(r => r.cat === c.name && !r.hidden)).map(c => ({ name: c.name, icon: c.icon }));
  return {
    node, title, icon, cards: shown, rows, q, sort, sorts: SORTS, kat, nur: o.nur || '', chips, layout: l, more: files.length,
    canArrange: !!(user && user.isAdmin) && node === 'projekte' && !kat && sort === 'eigene',
    tree: { all: all.length, fresh: fresh.length, projects: cards.filter(c => !c.hidden).length, cats: catNodes, privat: privat ? privat.length : null },
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
  const v = view(user, 'alle', q);
  return [...v.cards, ...v.rows].slice(0, limit).map(r => ({ kind: 'dl', icon: r.icon, title: r.title + (r.version ? ' ' + r.version : ''), text: r.summary || r.cat, url: r.type === 'file' ? '/downloads?q=' + encodeURIComponent(r.title) : r.url }));
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
  IMAGE_TYPES, COLORS, NEW_DAYS, SORTS, layout, saveLayout, canCreate, canEdit, canSee, bySlug, byId, versions, view, stats, recent, search, create, update, takeImage, setImages,
  addVersion, removeVersion, remove, assign, parseShots, projectRow, hubRow, all: () => db.prepare('SELECT id, title FROM dl_projects ORDER BY title COLLATE NOCASE').all(),
};
