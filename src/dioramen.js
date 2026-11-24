'use strict';
// Dancors Dioramen (Update 98, Kacheln ab Update 99; src/routes/dioramen.js, views/v3/diorama*.ejs, public/dioramen.js, public/dio-kacheln.js):
// Spielstände zeigen, frei gestaltet aus Kacheln auf einem Raster mit 12 Spalten. Die Bauwerke eines Spielstands sind farbige
// Gruppen darin: eine Kachel gehört zu keinem oder zu einem Bauwerk. Eine Karten-Kachel hat Punkte, die zu einem Bauwerk oder
// zu einer einzelnen Kachel springen.
// Die Dateien liegen im Download-Ordner, zählen aber in einer eigenen Tabelle (dio_files), damit sie nicht zwischen den
// Downloads auftauchen; eine Datei kann einem Bauwerk gehören. Auf Wunsch (Haken) steht der Spielstand als Karte in Dancors Downloads.
// Schreiben dürfen der Admin und Mitglieder mit dem Recht „Schreiben“; ändern darf, wer den Spielstand angelegt hat, und der Admin.
const fs = require('node:fs');
const path = require('node:path');
const { db, now, getSetting, setSetting, tx, UPLOAD_DIR, MEDIA_DIR } = require('./db');
const auth = require('./auth');
const { slugify, fmtSize, safeUrl, mdBlocks } = require('./util');

db.exec(`
CREATE TABLE IF NOT EXISTS dioramen (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'spielstand',   -- bis Update 98: spielstand | bauwerk (seit den Kacheln immer spielstand)
  parent_id INTEGER REFERENCES dioramen(id) ON DELETE SET NULL,   -- bis Update 98: Bauwerk war Teil von diesem Spielstand
  title TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  world TEXT NOT NULL DEFAULT '',            -- Karte oder Welt
  summary TEXT NOT NULL DEFAULT '',          -- Kurztext für Karte und Titelbild
  body_md TEXT NOT NULL DEFAULT '',          -- bis Update 98 (steckt jetzt in einer Text-Kachel)
  howto_md TEXT NOT NULL DEFAULT '',         -- Anleitung in der Download-Kachel
  cover TEXT,                                -- Titelbild (media.stored_name)
  images TEXT NOT NULL DEFAULT '[]',         -- Bilder des Spielstands: JSON [{ f, cap }] in Reihenfolge
  facts TEXT NOT NULL DEFAULT '[]',          -- Steckbrief: JSON [[Name, Wert]]
  mods TEXT NOT NULL DEFAULT '[]',           -- benötigte Mods: JSON [{ name, ver, url }]
  plan TEXT,                                 -- bis Update 98: Lageplan
  pins TEXT NOT NULL DEFAULT '{}',           -- bis Update 98: Nummern auf dem Lageplan
  before_img TEXT,                           -- bis Update 98: Vorher/Nachher
  after_img TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  in_downloads INTEGER NOT NULL DEFAULT 0,   -- auch als Karte in Dancors Downloads
  visibility TEXT NOT NULL DEFAULT 'public',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dio_parent ON dioramen(parent_id);
CREATE TABLE IF NOT EXISTS dio_files (
  id INTEGER PRIMARY KEY,
  dio_id INTEGER NOT NULL REFERENCES dioramen(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  version TEXT,
  changes TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dio_files_dio ON dio_files(dio_id, created_at);
-- Alte Adressen von Bauwerken (bis Update 98 eigene Einträge) führen in ihren Spielstand
CREATE TABLE IF NOT EXISTS dio_moved (
  slug TEXT PRIMARY KEY,
  dio_id INTEGER NOT NULL REFERENCES dioramen(id) ON DELETE CASCADE,
  bw TEXT
);
`);
const addColumn = (table, column, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
};
addColumn('dioramen', 'tiles', "TEXT NOT NULL DEFAULT '[]'");        // Kacheln: JSON [{ id, type, x, y, w, h, bw, … }]
addColumn('dioramen', 'buildings', "TEXT NOT NULL DEFAULT '[]'");    // Bauwerke: JSON [{ id, name, text, color }]
addColumn('dioramen', 'tiles_v', 'INTEGER NOT NULL DEFAULT 0');      // 1 = aus den alten Feldern in Kacheln umgezogen
addColumn('dio_files', 'bw', 'TEXT');                                // Datei gehört zu diesem Bauwerk (sonst zum Spielstand)

const KINDS = { spielstand: { icon: '💾', label: 'Spielstand', plural: 'Spielstände' } };
const RESERVED = new Set(['neu', 'seite', 'dl', 'bild', 'spiel']);
const NEW_DAYS = 14;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
const MAX_IMAGES = 200;
const SORTS = { eigene: 'Empfohlen', neu: 'Neueste zuerst', beliebt: 'Meiste Downloads', name: 'Name A–Z' };
// Farben der Bauwerke, der Reihe nach vergeben
const COLORS = { rot: '#d8432f', blau: '#1d5fd1', gruen: '#5f8f10', orange: '#e07a12', lila: '#7a4cc2', tuerkis: '#0f9488', braun: '#8a5a2b', pink: '#d63384' };
// Kachel-Arten mit Größe beim Anlegen (Spalten × Reihen)
const TYPES = {
  text: { icon: '📝', label: 'Text', w: 6, h: 6 },
  img: { icon: '🖼️', label: 'Bild', w: 6, h: 7 },
  cmp: { icon: '⇔', label: 'Vorher / Nachher', w: 6, h: 7 },
  map: { icon: '🗺️', label: 'Karte', w: 8, h: 10 },
  gal: { icon: '🎞️', label: 'Galerie', w: 6, h: 7 },
  head: { icon: '🏗️', label: 'Bauwerk-Überschrift', w: 12, h: 2 },
  dl: { icon: '⬇', label: 'Download', w: 5, h: 6 },
  facts: { icon: '📋', label: 'Steckbrief', w: 4, h: 5 },
  mods: { icon: '🧩', label: 'Mods', w: 4, h: 5 },
  video: { icon: '▶️', label: 'Video', w: 6, h: 7 },
};
const COLS = 12, MAX_H = 40, MAX_Y = 2000, MAX_TILES = 200, MAX_BUILDINGS = 40, MAX_POINTS = 60;

const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const json = (s, def) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : def; } catch { return def; } };
const asArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const mediaName = s => (typeof s === 'string' && /^[\w.-]{1,80}$/.test(s) ? s : null);
const int = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const pct = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n)) * 10) / 10 : null; };

// ---------- Inhalt eines Spielstands lesen ----------
function images(d) { return json(d.images, []).filter(i => i && mediaName(i.f)).map(i => ({ f: i.f, cap: str(i.cap, 120) })); }
function facts(d) { return json(d.facts, []).filter(r => Array.isArray(r) && r[0]).map(r => [str(r[0], 40), str(r[1], 120)]); }
function mods(d) { return json(d.mods, []).filter(m => m && m.name).map(m => ({ name: str(m.name, 80), ver: str(m.ver, 20), url: link(m.url) })); }
function buildings(d) { return normBuildings(json(d.buildings, [])); }
function tiles(d) { const b = buildings(d); return normTiles(json(d.tiles, []), b); }
// Mod-Link: eine Adresse im Netz (https/http) oder eine Seite hier (/downloads/…)
const link = u => { u = str(u, 500); return safeUrl(u) || (/^\/(?![/\\])\S*$/.test(u) ? u : ''); };

// Bauwerke: Kennung b1, b2 …, Name, Kurztext, Farbe aus COLORS
function normBuildings(list) {
  const out = [], seen = new Set();
  for (const b of Array.isArray(list) ? list : []) {
    if (!b || typeof b !== 'object' || !/^b\d{1,6}$/.test(b.id) || seen.has(b.id)) continue;
    const name = str(b.name, 80);
    if (!name) continue;
    seen.add(b.id);
    out.push({ id: b.id, name, text: str(b.text, 160), color: Object.hasOwn(COLORS, b.color) ? b.color : Object.keys(COLORS)[out.length % 8], frame: b.frame !== false });
    if (out.length >= MAX_BUILDINGS) break;
  }
  return out;
}
// Video: YouTube bekommt ein Vorschaubild, alles andere ist ein Link
function videoInfo(u) {
  const url = safeUrl(str(u, 500));
  if (!url) return null;
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return { url, thumb: m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null };
}
// Kacheln prüfen: Lage im Raster, Art, Bauwerk und Inhalt je Art. Reihenfolge danach: von oben nach unten, links nach rechts.
function normTiles(list, blds) {
  const bIds = new Set(blds.map(b => b.id)), out = [], seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || typeof t !== 'object' || !Object.hasOwn(TYPES, t.type) || !/^t\d{1,6}$/.test(t.id) || seen.has(t.id)) continue;
    const w = int(t.w, 1, COLS, TYPES[t.type].w), x = int(t.x, 1, COLS - w + 1, 1);
    const k = { id: t.id, type: t.type, x, y: int(t.y, 1, MAX_Y, 1), w, h: int(t.h, 1, MAX_H, TYPES[t.type].h), bw: bIds.has(t.bw) ? t.bw : null };
    if (t.type === 'head' && !k.bw) continue;   // eine Überschrift gehört immer zu einem Bauwerk
    if (t.type === 'text') { k.title = str(t.title, 120); k.md = String(t.md ?? '').slice(0, 20000); }
    if (t.type === 'img') { k.f = mediaName(t.f); k.cap = str(t.cap, 160); k.fit = t.fit === 'contain' ? 'contain' : 'cover'; }
    if (t.type === 'cmp') { k.before = mediaName(t.before); k.after = mediaName(t.after); }
    if (t.type === 'gal') k.imgs = asArray(t.imgs).map(mediaName).filter(Boolean).slice(0, 40);
    if (t.type === 'video') { const v = videoInfo(t.url); k.url = v ? v.url : ''; k.cap = str(t.cap, 160); }
    // Steckbrief: eigene Zeilen, wahlweise mit den Eckdaten des Spielstands (ohne Angabe: ja, wenn die Kachel keinem Bauwerk gehört)
    if (t.type === 'facts') {
      k.title = str(t.title, 60);
      k.rows = asArray(t.rows).filter(r => Array.isArray(r) && str(r[0], 40)).slice(0, 30).map(r => [str(r[0], 40), str(r[1], 160)]);
      k.base = t.base === undefined || t.base === null ? !k.bw : !!t.base;
    }
    if (t.type === 'map') {
      k.f = mediaName(t.f);
      k.points = [];
      for (const p of asArray(t.points).slice(0, MAX_POINTS)) {
        if (!p || typeof p !== 'object') continue;
        const px = pct(p.x), py = pct(p.y);
        if (px === null || py === null) continue;
        k.points.push({ x: px, y: py, label: str(p.label, 60), to: typeof p.to === 'string' && /^[bt]\d{1,6}$/.test(p.to) ? p.to : '' });
      }
    }
    seen.add(t.id);
    out.push(k);
    if (out.length >= MAX_TILES) break;
  }
  // Ziele der Kartenpunkte: nur vorhandene Bauwerke und Kacheln
  for (const k of out) if (k.points) for (const p of k.points) if (p.to && !(p.to[0] === 'b' ? bIds.has(p.to) : seen.has(p.to))) p.to = '';
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
// Kacheln, die sich überdecken, rutschen nach unten (wie im Browser beim Ziehen); Lücken bleiben, wie gestaltet
function settle(list) {
  const placed = [];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const t of [...list].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let y = t.y;
    while (placed.some(p => hit({ ...t, y }, p))) y++;
    t.y = y;
    placed.push(t);
  }
  return list.sort((a, b) => a.y - b.y || a.x - b.x);
}
const nextId = (list, prefix) => prefix + (list.reduce((n, x) => Math.max(n, Number(String(x.id).slice(1)) || 0), 0) + 1);
const bottom = list => list.reduce((n, t) => Math.max(n, t.y + t.h), 1);

// ---------- Rechte ----------
const canWrite = user => !!user && (user.isAdmin || !!user.canWrite);
const canSee = (user, d) => auth.canSee(user, 'dio', d);
const canEdit = (user, d) => !!user && !!d && (user.isAdmin || (canWrite(user) && d.author_id === user.id));

function bySlug(slug) { return db.prepare('SELECT * FROM dioramen WHERE slug = ?').get(String(slug || '')); }
function byId(id) { return db.prepare('SELECT * FROM dioramen WHERE id = ?').get(Number(id)); }
// Alte Adresse eines Bauwerks: { d, bw }
function moved(slug) {
  const m = db.prepare('SELECT * FROM dio_moved WHERE slug = ?').get(String(slug || ''));
  const d = m && byId(m.dio_id);
  return d ? { d, bw: m.bw } : null;
}
function visible(user) {
  const v = auth.visibilitySql(user, 'dio', 'd');
  return db.prepare(`SELECT d.* FROM dioramen d WHERE ${v.sql} ORDER BY d.created_at DESC`).all(...v.params);
}
function files(d) { return db.prepare('SELECT * FROM dio_files WHERE dio_id = ? ORDER BY created_at DESC, id DESC').all(d.id); }
function fileById(id) { return db.prepare('SELECT * FROM dio_files WHERE id = ?').get(Number(id)); }
// Die Dateien des Spielstands selbst (ohne Bauwerk); gibt es keine, zählen die der Bauwerke
const mainFiles = list => { const m = list.filter(f => !f.bw); return m.length ? m : list; };

// Eine Zeile für Karten und Listen
function row(d, user, ctx = {}) {
  const all = ctx.files ? ctx.files.get(d.id) || [] : files(d), fs_ = mainFiles(all);
  const latest = fs_[0] || null, since = now() - NEW_DAYS * 86400;
  const imgs = images(d), blds = buildings(d), tl = json(d.tiles, []);
  return {
    key: 'd' + d.id, id: d.id, slug: d.slug, url: '/dioramen/' + d.slug, kind: 'spielstand', kindIcon: '💾', kindLabel: 'Spielstand',
    title: d.title, summary: d.summary, game: d.game, world: d.world, cover: d.cover ? '/media/' + d.cover : imgs[0] ? '/media/' + imgs[0].f : null,
    imageCount: imgs.length, tileCount: Array.isArray(tl) ? tl.length : 0,
    buildings: blds.map((b, i) => ({ no: i + 1, id: b.id, name: b.name, color: COLORS[b.color], url: '/dioramen/' + d.slug + '#bw-' + b.id })),
    pinned: !!d.pinned, fresh: d.created_at >= since, update: !!latest && fs_.length > 1 && latest.created_at >= since,
    version: latest && latest.version, size: latest ? latest.size : 0, sizeText: latest ? fmtSize(latest.size) : '', dl: latest ? '/dioramen/dl/' + latest.id : null,
    downloads: all.reduce((n, f) => n + f.downloads, 0), date: Math.max(d.created_at, latest ? latest.created_at : 0), created: d.created_at,
    vis: d.visibility, edit: canEdit(user, d),
  };
}
// Alle Dateien für viele Zeilen auf einmal (statt je Spielstand eine Abfrage)
function context(list) {
  const ctx = { files: new Map() };
  if (!list.length) return ctx;
  const ids = list.map(d => d.id);
  for (const f of db.prepare(`SELECT * FROM dio_files WHERE dio_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`).all(...ids)) {
    (ctx.files.get(f.dio_id) || ctx.files.set(f.dio_id, []).get(f.dio_id)).push(f);
  }
  return ctx;
}

// ---------- Aufbau der Übersicht (Bearbeiten-Modus) ----------
const LAYOUT = {
  title: 'Dancors Dioramen', text: 'Spielstände aus meinen Spielen, mit allen Bauwerken darin. Anschauen, nachbauen oder einfach herunterladen.',
  hero: 'pin', sort: 'eigene', order: [], hidden: [],
};
const OLD_TEXT = 'Spielstände und einzelne Bauwerke aus meinen Spielen. Anschauen, nachbauen oder einfach herunterladen.';
const keyOk = k => typeof k === 'string' && /^d\d{1,9}$/.test(k);
function normalize(l) {
  l = l && typeof l === 'object' ? l : {};
  const keys = a => (Array.isArray(a) ? [...new Set(a.filter(keyOk))].slice(0, 1000) : []);
  const text = str(l.text, 300);
  return {
    title: str(l.title, 80) || LAYOUT.title, text: text && text !== OLD_TEXT ? text : LAYOUT.text,
    hero: ['pin', 'neu', 'aus'].includes(l.hero) ? l.hero : 'pin', sort: l.sort === 'neu' ? 'neu' : 'eigene',
    order: keys(l.order), hidden: keys(l.hidden),
  };
}
function layout() { return normalize(json(getSetting('dio_layout', 'null'), {})); }
// Speichert den Aufbau; Titel, Kurztext und „angepinnt“ gehen direkt an die Spielstände
function saveLayout(input) {
  input = input && typeof input === 'object' ? input : {};
  const l = normalize({ ...layout(), ...input });
  for (const c of Array.isArray(input.cards) ? input.cards.slice(0, 1000) : []) {
    if (!c || !keyOk(c.key)) continue;
    const d = byId(c.key.slice(1));
    if (!d) continue;
    const title = str(c.title, 120) || d.title, summary = c.summary === undefined ? d.summary : str(c.summary, 240), pinned = c.pin === undefined ? d.pinned : c.pin ? 1 : 0;
    if (title !== d.title || summary !== d.summary || pinned !== d.pinned)
      db.prepare('UPDATE dioramen SET title = ?, summary = ?, pinned = ?, updated_at = ? WHERE id = ?').run(title, summary, pinned, title !== d.title || summary !== d.summary ? now() : d.updated_at, d.id);
  }
  setSetting('dio_layout', JSON.stringify(l));
  return l;
}

// Text, in dem die Suche und der Filter suchen
const haystack = d => [d.title, d.summary, d.game, d.world, ...buildings(d).flatMap(b => [b.name, b.text]),
  ...tiles(d).flatMap(t => [t.title, t.md, t.cap, ...(t.points || []).map(p => p.label)])].filter(Boolean).join('\n').toLowerCase();

// Übersicht: o = { spiel, sort, q }
function view(user, o = {}) {
  const l = layout(), list = visible(user), ctx = context(list);
  const all = list.map(d => ({ ...row(d, user, ctx), hay: o.q ? haystack(d) : '' }));
  const hidden = new Set(l.hidden);
  for (const r of all) r.hidden = hidden.has(r.key);
  const isAdmin = !!(user && user.isAdmin);
  const games = [];
  for (const r of all) if (r.game && !r.hidden) { const g = games.find(x => x.name === r.game); if (g) g.n++; else games.push({ name: r.game, n: 1 }); }
  games.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
  const spiel = games.some(g => g.name === o.spiel) ? o.spiel : '';
  const sort = Object.hasOwn(SORTS, o.sort) ? o.sort : l.sort;
  const q = str(o.q, 100).toLowerCase();
  // Eigene Reihenfolge: angepinnt zuerst, dann noch nicht einsortierte (neue) Spielstände, dann die gezogene Reihenfolge
  const pos = new Map(l.order.map((k, i) => [k, i]));
  const cmp = {
    eigene: (a, b) => b.pinned - a.pinned || (pos.has(a.key) ? pos.get(a.key) : -1) - (pos.has(b.key) ? pos.get(b.key) : -1) || b.date - a.date,
    neu: (a, b) => b.created - a.created, beliebt: (a, b) => b.downloads - a.downloads || b.date - a.date,
    name: (a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }),
  }[sort];
  const filtered = !!(spiel || q);
  const arrange = isAdmin && !filtered && sort === 'eigene';
  let cards = all.filter(r => (!r.hidden || arrange) && (!spiel || r.game === spiel) && (!q || r.hay.includes(q)));
  cards.sort(cmp);
  // Oben groß: der erste angepinnte oder der neueste Spielstand, nur in der ungefilterten Ansicht
  let hero = null;
  if (!filtered && l.hero !== 'aus') {
    const pool = cards.filter(r => !r.hidden);
    hero = l.hero === 'pin' ? pool.find(r => r.pinned) || null : [...pool].sort((a, b) => b.created - a.created)[0] || null;
    if (hero && !arrange) cards = cards.filter(r => r !== hero);
  }
  const shown = all.filter(r => !r.hidden);
  return {
    layout: l, cards, hero, games, spiel, sort, sorts: SORTS, q: o.q ? str(o.q, 100) : '', canArrange: arrange, filtered,
    counts: { spielstand: shown.length, bauwerk: shown.reduce((n, r) => n + r.buildings.length, 0) },
  };
}

// ---------- Spielstand-Seite ----------
// Kacheln zum Anzeigen: Inhalt aufbereitet, Bauwerk mit Farbe, leere Kacheln markiert (Besucher sehen sie nicht)
function resolve(d, list, blds, o = {}) {
  const bMap = new Map(blds.map((b, i) => [b.id, { ...b, no: i + 1, hex: COLORS[b.color] }]));
  const tMap = new Map(list.map(t => [t.id, t]));
  const caps = new Map(images(d).map(i => [i.f, i.cap]));
  const fl = o.files || files(d);
  const known = new Set();
  const names = list.flatMap(t => [t.f, t.before, t.after, ...(t.imgs || [])]).filter(Boolean);
  if (names.length) for (const r of db.prepare(`SELECT stored_name FROM media WHERE stored_name IN (${names.map(() => '?').join(',')})`).all(...names)) known.add(r.stored_name);
  const img = f => (f && known.has(f) ? f : null);
  const ar = (w, h) => ((w * 96 - 14) / (h * 54 - 14)).toFixed(3);   // Seitenverhältnis am Handy (Kacheln untereinander)
  const howto = d.howto_md && d.howto_md.trim() ? mdBlocks(d.howto_md) : '';
  return list.map(t => {
    const b = t.bw ? bMap.get(t.bw) || null : null;
    const r = { t, b, ar: ar(t.w, t.h), empty: false };
    if (t.type === 'text') { r.html = t.md.trim() ? mdBlocks(t.md) : ''; r.empty = !r.html && !t.title; }
    if (t.type === 'img') { r.f = img(t.f); r.empty = !r.f; }
    if (t.type === 'cmp') { r.before = img(t.before); r.after = img(t.after); r.empty = !(r.before && r.after); }
    if (t.type === 'gal') { r.imgs = t.imgs.map(img).filter(Boolean).map(f => ({ f, cap: caps.get(f) || '' })); r.empty = !r.imgs.length; }
    if (t.type === 'video') { r.video = videoInfo(t.url); r.empty = !r.video; }
    if (t.type === 'head') r.empty = !b;
    if (t.type === 'map') {
      r.f = img(t.f); r.empty = !r.f;
      r.points = t.points.map(p => {
        const to = p.to[0] === 'b' ? bMap.get(p.to) : tMap.get(p.to);
        const pb = p.to[0] === 'b' ? to : to && to.bw ? bMap.get(to.bw) : null;
        return { ...p, no: pb ? pb.no : '•', label: p.label || (p.to[0] === 'b' && to ? to.name : ''), href: !to ? '' : p.to[0] === 'b' ? '#bw-' + p.to : '#k-' + p.to, hex: pb ? pb.hex : '#5b6a85', bw: pb ? pb.id : '' };
      });
    }
    if (t.type === 'dl') {
      const own = fl.filter(f => (t.bw ? f.bw === t.bw : !f.bw));
      r.files = own;
      r.latest = own[0] || null;
      r.changes = own.map(f => (f.changes ? mdBlocks(f.changes) : ''));
      r.howto = t.bw ? '' : howto;
      r.downloads = own.reduce((n, f) => n + f.downloads, 0);
      r.empty = !own.length;
    }
    if (t.type === 'facts') {
      r.facts = t.base ? facts(d) : [];
      r.game = t.base ? d.game : ''; r.world = t.base ? d.world : '';
      r.empty = !t.rows.length && !r.facts.length && !r.game && !r.world;
    }
    if (t.type === 'mods') { r.mods = mods(d); r.empty = !r.mods.length; }
    return r;
  });
}
// Farbige Rahmen: je Bauwerk (mit Rahmen) ein Feld um alle seine Kacheln
function frames(list, blds) {
  const out = [];
  for (const b of blds) {
    if (!b.frame) continue;
    const own = list.filter(t => t.bw === b.id);
    if (!own.length) continue;
    const x1 = Math.min(...own.map(t => t.x)), y1 = Math.min(...own.map(t => t.y));
    const x2 = Math.max(...own.map(t => t.x + t.w)), y2 = Math.max(...own.map(t => t.y + t.h));
    out.push({ id: b.id, hex: COLORS[b.color], x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  return out;
}
// Für jedes Bauwerk die Kachel, zu der „Springen zu“ führt: seine Überschrift, sonst seine erste Kachel
function anchors(list, blds) {
  const out = new Map();
  for (const b of blds) {
    const own = list.filter(t => t.bw === b.id);
    const target = own.find(t => t.type === 'head') || own[0];
    if (target) out.set(b.id, target.id);
  }
  return out;
}
function page(user, d) {
  const fl = files(d), blds = buildings(d), list = tiles(d);
  const edit = canEdit(user, d);
  const shown = resolve(d, list, blds, { files: fl }).filter(r => edit || !r.empty);
  const anc = anchors(shown.map(r => r.t), blds);
  const main = mainFiles(fl.filter(f => !f.bw)), imgs = images(d);
  const author = d.author_id ? db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(d.author_id) : null;
  const bRows = blds.map((b, i) => ({ ...b, no: i + 1, hex: COLORS[b.color], count: list.filter(t => t.bw === b.id).length, anchor: anc.get(b.id) || null }));
  return {
    d, tiles: shown, anchors: anc, buildings: bRows, frames: frames(shown.map(r => r.t), blds), latest: main[0] || null, cover: d.cover || (imgs[0] && imgs[0].f) || null,
    author: author ? author.display_name || author.username : '', fresh: d.created_at >= now() - NEW_DAYS * 86400,
    editData: edit ? {
      tiles: list, buildings: blds, colors: COLORS, types: TYPES,
      images: imgs, files: fl.map(f => ({ id: f.id, bw: f.bw || null, name: f.original_name, version: f.version || '' })),
    } : null,
  };
}

// Startseite, Suche, „Zuletzt neu“
function stats(user) {
  const list = visible(user), l = layout(), hidden = new Set(l.hidden);
  const shown = list.filter(d => !hidden.has('d' + d.id));
  const latest = shown[0] || null;
  return { spielstand: shown.length, bauwerk: shown.reduce((n, d) => n + buildings(d).length, 0), latest: latest && { title: latest.title, url: '/dioramen/' + latest.slug } };
}
function meta(user) {
  const s = stats(user), out = [];
  if (!s.spielstand) return ['Noch leer'];
  out.push(`${s.spielstand} ${s.spielstand === 1 ? 'Spielstand' : 'Spielstände'}`);
  if (s.bauwerk) out.push(`${s.bauwerk} ${s.bauwerk === 1 ? 'Bauwerk' : 'Bauwerke'}`);
  if (s.latest) out.push('neu: ' + s.latest.title);
  return out;
}
function recent(user, limit = 5) {
  return visible(user).slice(0, limit).map(d => ({ title: d.title, url: '/dioramen/' + d.slug, at: d.created_at }));
}
// Suche: Spielstände und die Bauwerke darin (ein Bauwerk führt zu seinem Abschnitt)
function search(user, q, limit = 20) {
  q = str(q, 100).toLowerCase();
  if (!q) return [];
  const out = [];
  for (const d of visible(user)) {
    const where = ['Spielstand', d.game, d.world].filter(Boolean).join(' · ');
    if (haystack(d).includes(q)) {
      const hitB = buildings(d).filter(b => [b.name, b.text].some(x => x && x.toLowerCase().includes(q)));
      const own = [d.title, d.summary, d.game, d.world].some(x => x && x.toLowerCase().includes(q));
      if (own || !hitB.length) out.push({ kind: 'di', icon: '💾', title: d.title, text: where, url: '/dioramen/' + d.slug });
      for (const b of hitB) out.push({ kind: 'di', icon: '🏗️', title: b.name, text: 'Bauwerk in ' + d.title, url: '/dioramen/' + d.slug + '#bw-' + b.id });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
// Karten für Dancors Downloads: Spielstände mit Haken „auch in Downloads zeigen“ und einer Datei
function downloadCards(user) {
  const v = auth.visibilitySql(user, 'dio', 'd');
  const list = db.prepare(`SELECT d.* FROM dioramen d WHERE d.in_downloads = 1 AND ${v.sql} ORDER BY d.created_at DESC`).all(...v.params);
  const ctx = context(list);
  return list.map(d => row(d, user, ctx)).filter(r => r.dl).map(r => ({
    key: r.key, type: 'link', dio: true, featured: false, title: r.title, summary: r.summary, icon: r.kindIcon, color: 'di', cover: r.cover,
    cat: 'Spielstände', catIcon: '💾', game: r.game, version: r.version, url: r.url, date: r.date, downloads: r.downloads, sizeText: r.sizeText, dl: r.dl,
  }));
}

// ---------- Schreiben ----------
function uniqueSlug(base, id = 0) {
  let slug = slugify(base) || 'spielstand';
  if (RESERVED.has(slug)) slug += '-1';
  const root = slug;
  for (let i = 2; db.prepare('SELECT 1 FROM dioramen WHERE slug = ? AND id != ?').get(slug, id) || db.prepare('SELECT 1 FROM dio_moved WHERE slug = ?').get(slug); i++) slug = `${root}-${i}`;
  return slug;
}
// Steckbrief- und Mod-Zeilen aus dem Formular (Felder kommen je Zeile einmal)
function factsFrom(b) {
  const k = asArray(b.fact_k), v = asArray(b.fact_v), out = [];
  for (let i = 0; i < k.length && out.length < 30; i++) if (str(k[i], 40)) out.push([str(k[i], 40), str(v[i], 120)]);
  return out;
}
function modsFrom(b) {
  const n = asArray(b.mod_name), ver = asArray(b.mod_ver), url = asArray(b.mod_url), out = [];
  for (let i = 0; i < n.length && out.length < 40; i++) if (str(n[i], 80)) out.push({ name: str(n[i], 80), ver: str(ver[i], 20), url: link(url[i]) });
  return out;
}
function fields(b) {
  return {
    title: str(b.title, 120), game: str(b.game, 80), world: str(b.world, 80), summary: str(b.summary, 240),
    howto_md: String(b.howto_md || '').slice(0, 20000), facts: JSON.stringify(factsFrom(b)), mods: JSON.stringify(modsFrom(b)), in_downloads: b.in_downloads ? 1 : 0,
  };
}
// Neue Spielstände beginnen mit Text, Download, Steckbrief und Mods
function starterTiles(md = '') {
  return [
    { id: 't1', type: 'text', x: 1, y: 1, w: 7, h: 6, bw: null, title: 'Über den Spielstand', md },
    { id: 't2', type: 'dl', x: 8, y: 1, w: 5, h: 6, bw: null },
    { id: 't3', type: 'facts', x: 1, y: 7, w: 6, h: 5, bw: null },
    { id: 't4', type: 'mods', x: 7, y: 7, w: 6, h: 5, bw: null },
  ];
}
function create(user, b, extra = {}) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Spielstand einen Titel.');
  const t = now();
  const id = Number(db.prepare(`INSERT INTO dioramen(slug, kind, title, game, world, summary, howto_md, facts, mods, in_downloads, pinned, visibility, author_id, created_at, updated_at, tiles, tiles_v)
    VALUES (?, 'spielstand', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(uniqueSlug(b.slug || f.title), f.title, f.game, f.world, f.summary, f.howto_md,
    f.facts, f.mods, f.in_downloads, user.isAdmin && b.pinned ? 1 : 0, extra.visibility || 'public', user.id, t, t, JSON.stringify(starterTiles(String(b.body_md || '').slice(0, 20000)))).lastInsertRowid);
  return byId(id);
}
function update(user, d, b, extra = {}) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Spielstand einen Titel.');
  const slug = b.slug && slugify(b.slug) !== d.slug ? uniqueSlug(b.slug, d.id) : d.slug;
  db.prepare(`UPDATE dioramen SET slug = ?, title = ?, game = ?, world = ?, summary = ?, howto_md = ?, facts = ?, mods = ?, in_downloads = ?,
    pinned = ?, visibility = ?, updated_at = ? WHERE id = ?`).run(slug, f.title, f.game, f.world, f.summary, f.howto_md, f.facts, f.mods, f.in_downloads,
    user.isAdmin ? (b.pinned ? 1 : 0) : d.pinned, extra.visibility || d.visibility, now(), d.id);
  return byId(d.id);
}
// Kacheln und Bauwerke aus dem Bearbeiten-Modus speichern
function saveTiles(d, input) {
  input = input && typeof input === 'object' ? input : {};
  const blds = normBuildings(input.buildings);
  const list = settle(normTiles(input.tiles, blds));
  const ids = new Set(blds.map(b => b.id));
  tx(() => {
    db.prepare('UPDATE dioramen SET tiles = ?, buildings = ?, tiles_v = 1, updated_at = ? WHERE id = ?').run(JSON.stringify(list), JSON.stringify(blds), now(), d.id);
    // Dateien eines gelöschten Bauwerks gehören wieder dem Spielstand
    for (const f of files(d)) if (f.bw && !ids.has(f.bw)) db.prepare('UPDATE dio_files SET bw = NULL WHERE id = ?').run(f.id);
    db.prepare('DELETE FROM dio_moved WHERE dio_id = ? AND bw IS NOT NULL AND bw NOT IN (' + (blds.map(() => '?').join(',') || "''") + ')').run(d.id, ...blds.map(b => b.id));
  });
  return { tiles: list, buildings: blds };
}

// Ein hochgeladenes Bild zieht in die Medien um (wie bei den Download-Projekten)
function takeImage(file, userId) {
  if (!file) return null;
  if (!IMAGE_TYPES.includes(file.mimetype)) { removeQuietly(file.path); return null; }
  const dest = path.join(MEDIA_DIR, file.filename);
  try { fs.renameSync(file.path, dest); } catch { fs.copyFileSync(file.path, dest); removeQuietly(file.path); }
  db.prepare('INSERT INTO media(stored_name, original_name, mime, size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(file.filename, file.originalname, file.mimetype, file.size, userId, now());
  return file.filename;
}
// Bilder aus dem Formular: die behaltenen in der neuen Reihenfolge (img = Namen, cap_<Name> = Unterschrift), dazu neue,
// Titelbild per Name (cover) oder „new:<n>“ für das n-te neue Bild.
function setImages(d, b, added) {
  const old = new Map(images(d).map(i => [i.f, i]));
  if (d.cover && !old.has(d.cover)) old.set(d.cover, { f: d.cover, cap: '' });
  const keep = asArray(b.img).map(mediaName).filter(f => f && old.has(f));
  const list = keep.map(f => ({ f, cap: str(b['cap_' + f], 120) }));
  for (let i = 0; i < added.length; i++) list.push({ f: added[i], cap: str(asArray(b.new_cap)[i], 120) });
  const out = list.slice(0, MAX_IMAGES);
  let cover = String(b.cover || '');
  const m = /^new:(\d+)$/.exec(cover);
  cover = m ? added[Number(m[1])] || null : mediaName(cover);
  if (!cover || !out.some(i => i.f === cover)) cover = out[0] ? out[0].f : null;
  db.prepare('UPDATE dioramen SET images = ?, cover = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(out), cover, now(), d.id);
}
// Neue Bilder aus dem Bearbeiten-Modus der Kacheln: hinten an die Bilder des Spielstands
function addImages(d, added) {
  const list = images(d);
  for (const f of added) if (!list.some(i => i.f === f)) list.push({ f, cap: '' });
  db.prepare('UPDATE dioramen SET images = ?, cover = COALESCE(cover, ?), updated_at = ? WHERE id = ?').run(JSON.stringify(list.slice(0, MAX_IMAGES)), list[0] ? list[0].f : null, now(), d.id);
  return images(byId(d.id));
}

function addFile(user, d, file, b) {
  const bw = buildings(d).some(x => x.id === b.file_bw) ? b.file_bw : null;
  const id = Number(db.prepare(`INSERT INTO dio_files(dio_id, original_name, stored_name, size, mime, version, changes, uploader_id, created_at, bw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, file.originalname, file.filename, file.size, file.mimetype, str(b.version, 30) || null, String(b.changes || '').slice(0, 20000) || null, user.id, now(), bw).lastInsertRowid);
  db.prepare('UPDATE dioramen SET updated_at = ? WHERE id = ?').run(now(), d.id);
  return id;
}
function removeFile(d, fileId) {
  const f = db.prepare('SELECT * FROM dio_files WHERE id = ? AND dio_id = ?').get(Number(fileId), d.id);
  if (!f) return false;
  removeQuietly(path.join(UPLOAD_DIR, f.stored_name));
  db.prepare('DELETE FROM dio_files WHERE id = ?').run(f.id);
  return true;
}
// Spielstand löschen nimmt seine Dateien mit; Bilder bleiben in der Bibliothek
function remove(d) {
  for (const f of files(d)) removeFile(d, f.id);
  db.prepare("DELETE FROM acl WHERE item_type = 'dio' AND item_id = ?").run(d.id);
  db.prepare('DELETE FROM dio_moved WHERE dio_id = ?').run(d.id);
  db.prepare('DELETE FROM dioramen WHERE id = ?').run(d.id);
}
function removeQuietly(p) { try { fs.rmSync(p, { force: true }); } catch { /* egal */ } }
function knownGames() { return db.prepare("SELECT DISTINCT game FROM dioramen WHERE game != '' ORDER BY game COLLATE NOCASE").all().map(r => r.game); }

// ---------- Umzug aus Update 98: Bauwerke wandern in ihren Spielstand, alles wird zu Kacheln ----------
function migrate() {
  const old = db.prepare('SELECT * FROM dioramen WHERE tiles_v = 0 ORDER BY created_at, id').all();
  if (!old.length) return 0;
  const byParent = new Map();
  for (const d of old) if (d.kind === 'bauwerk' && d.parent_id) (byParent.get(d.parent_id) || byParent.set(d.parent_id, []).get(d.parent_id)).push(d);
  const roots = old.filter(d => d.kind !== 'bauwerk' || !d.parent_id || !old.some(p => p.id === d.parent_id && p.kind !== 'bauwerk'));
  tx(() => {
    for (const p of roots) {
      const out = [], blds = [];
      let y = 1, n = 0;
      const id = () => 't' + ++n;
      const rowOf = (items) => { const hMax = Math.max(...items.map(t => t.h)); for (const t of items) out.push({ id: id(), y, bw: null, ...t }); y += hMax; };
      const textH = (s, w) => { s = String(s || ''); const lines = s.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / (w * 12))), 0); return Math.min(20, Math.max(4, 2 + Math.ceil(lines * 0.5))); };
      const imgsOf = d => { const l = images(d); return d.cover && !l.some(i => i.f === d.cover) ? [{ f: d.cover, cap: '' }, ...l] : l; };
      const pool = imgsOf(p);
      const own = p.kind === 'bauwerk' ? [p] : byParent.get(p.id) || [];
      const solo = p.kind === 'bauwerk';   // Bauwerk ohne Spielstand: eigener Beitrag mit einem Bauwerk darin
      // Kopf: Text und Download, Vorher/Nachher und Bilder, Karte mit Steckbrief und Mods
      const hasText = !solo && p.body_md.trim();
      if (hasText) rowOf([{ type: 'text', x: 1, w: 7, h: textH(p.body_md, 7), title: 'Über den Spielstand', md: p.body_md }, { type: 'dl', x: 8, w: 5, h: 6 }]);
      else rowOf([{ type: 'dl', x: 1, w: 6, h: 6 }, { type: 'facts', x: 7, w: 6, h: 6 }]);
      if (!solo && p.before_img && p.after_img) rowOf([{ type: 'cmp', x: 1, w: 12, h: 9, before: p.before_img, after: p.after_img }]);
      if (!solo && pool.length > 1) rowOf([{ type: 'gal', x: 1, w: 12, h: 7, imgs: pool.map(i => i.f) }]);
      const pinMap = json(p.pins, {});
      const mapTile = !solo && p.plan && own.length ? { id: id(), type: 'map', x: 1, y, w: 8, h: 10, bw: null, f: p.plan, points: [] } : null;
      if (mapTile) {
        out.push(mapTile);
        if (hasText) out.push({ id: id(), type: 'facts', x: 9, y, w: 4, h: 5, bw: null });
        out.push({ id: id(), type: 'mods', x: 9, y: y + (hasText ? 5 : 0), w: 4, h: 5, bw: null });
        y += 10;
      } else if (hasText) rowOf([{ type: 'facts', x: 1, w: 6, h: 5 }, { type: 'mods', x: 7, w: 6, h: 5 }]);
      else rowOf([{ type: 'mods', x: 1, w: 12, h: 4 }]);
      const allMods = mods(p);
      // Je Bauwerk: Überschrift, Bild und Text, weitere Bilder, Vorher/Nachher und eigener Download
      own.forEach((k, i) => {
        const b = { id: 'b' + (i + 1), name: str(k.title, 80) || 'Bauwerk', text: str(k.summary, 160), color: Object.keys(COLORS)[i % 8] };
        blds.push(b);
        const ki = imgsOf(k);
        for (const im of ki) if (!pool.some(x => x.f === im.f)) pool.push(im);
        rowOf([{ type: 'head', x: 1, w: 12, h: 2, bw: b.id }]);
        const kf = facts(k), body = [k.body_md.trim(), kf.length ? kf.map(([a, v]) => `- **${a}:** ${v}`).join('\n') : ''].filter(Boolean).join('\n\n');
        const first = ki[0];
        if (first && body) rowOf([{ type: 'img', x: 1, w: 7, h: 8, bw: b.id, f: first.f, cap: first.cap, fit: 'cover' }, { type: 'text', x: 8, w: 5, h: 8, bw: b.id, title: '', md: body }]);
        else if (first) rowOf([{ type: 'img', x: 1, w: 12, h: 9, bw: b.id, f: first.f, cap: first.cap, fit: 'cover' }]);
        else if (body) rowOf([{ type: 'text', x: 1, w: 12, h: textH(body, 12), bw: b.id, title: '', md: body }]);
        if (ki.length > 1) rowOf([{ type: 'gal', x: 1, w: 12, h: 6, bw: b.id, imgs: ki.slice(1).map(im => im.f) }]);
        const kFiles = k.id === p.id ? [] : files(k);
        const extra = [];
        if (k.before_img && k.after_img) extra.push({ type: 'cmp', x: 1, w: kFiles.length ? 7 : 12, h: 8, bw: b.id, before: k.before_img, after: k.after_img });
        if (kFiles.length) extra.push({ type: 'dl', x: extra.length ? 8 : 1, w: extra.length ? 5 : 6, h: 6, bw: b.id });
        if (extra.length) rowOf(extra);
        for (const m of mods(k)) if (!allMods.some(x => x.name.toLowerCase() === m.name.toLowerCase())) allMods.push(m);
        if (mapTile && pinMap[k.id]) mapTile.points.push({ x: pinMap[k.id][0], y: pinMap[k.id][1], label: '', to: b.id });
        if (k.id !== p.id) {
          db.prepare('UPDATE dio_files SET dio_id = ?, bw = ? WHERE dio_id = ?').run(p.id, b.id, k.id);
          db.prepare('INSERT OR REPLACE INTO dio_moved(slug, dio_id, bw) VALUES (?, ?, ?)').run(k.slug, p.id, b.id);
          db.prepare("DELETE FROM acl WHERE item_type = 'dio' AND item_id = ?").run(k.id);
          db.prepare('DELETE FROM dioramen WHERE id = ?').run(k.id);
        }
      });
      db.prepare(`UPDATE dioramen SET kind = 'spielstand', parent_id = NULL, tiles = ?, buildings = ?, images = ?, mods = ?, cover = COALESCE(cover, ?), tiles_v = 1 WHERE id = ?`)
        .run(JSON.stringify(normTiles(out, blds)), JSON.stringify(blds), JSON.stringify(pool.slice(0, MAX_IMAGES)), JSON.stringify(allMods), pool[0] ? pool[0].f : null, p.id);
    }
    // Was übrig ist (Bauwerk eines Bauwerks o. ä.), wird ein Spielstand mit den Startkacheln
    db.prepare(`UPDATE dioramen SET kind = 'spielstand', parent_id = NULL, tiles = ?, tiles_v = 1 WHERE tiles_v = 0`).run(JSON.stringify(starterTiles()));
  });
  return roots.length;
}
migrate();

module.exports = {
  KINDS, SORTS, IMAGE_TYPES, NEW_DAYS, COLORS, TYPES, canWrite, canSee, canEdit, bySlug, byId, moved, files, fileById, images, facts, mods, buildings, tiles,
  normTiles, normBuildings, settle, frames, nextId, bottom, row, view, page, resolve, layout, saveLayout, normalize, stats, meta, recent, search, downloadCards,
  create, update, saveTiles, takeImage, setImages, addImages, addFile, removeFile, remove, knownGames, factsFrom, modsFrom, uniqueSlug, migrate, starterTiles, videoInfo,
};
