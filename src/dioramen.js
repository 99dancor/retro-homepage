'use strict';
// Dancors Dioramen (Update 98, src/routes/dioramen.js, views/v3/diorama*.ejs, public/dioramen*.js): Spielstände und einzelne
// Bauwerke aus Spielständen zeigen, mit Bildern, Text, Steckbrief, benötigten Mods und einem Download mit Versionen.
// Ein Bauwerk kann zu einem Spielstand gehören („Teil von“), muss aber nicht. Ein Spielstand kann einen Lageplan haben,
// auf dem seine Bauwerke als Nummern stehen; jedes Eintrag kann ein Vorher/Nachher-Bild haben.
// Die Dateien liegen im Download-Ordner, zählen aber in einer eigenen Tabelle (dio_files), damit sie nicht zwischen den
// Downloads auftauchen. Auf Wunsch (Haken je Eintrag) steht der Eintrag als Karte in Dancors Downloads.
// Schreiben dürfen der Admin und Mitglieder mit dem Recht „Schreiben“; ändern darf, wer den Eintrag angelegt hat, und der Admin.
const fs = require('node:fs');
const path = require('node:path');
const { db, now, getSetting, setSetting, UPLOAD_DIR, MEDIA_DIR } = require('./db');
const auth = require('./auth');
const { slugify, fmtSize, safeUrl } = require('./util');

db.exec(`
CREATE TABLE IF NOT EXISTS dioramen (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'spielstand',   -- spielstand | bauwerk
  parent_id INTEGER REFERENCES dioramen(id) ON DELETE SET NULL,   -- Bauwerk: Teil von diesem Spielstand
  title TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  world TEXT NOT NULL DEFAULT '',            -- Karte oder Welt
  summary TEXT NOT NULL DEFAULT '',          -- Kurztext für Karte und Titelbild
  body_md TEXT NOT NULL DEFAULT '',
  howto_md TEXT NOT NULL DEFAULT '',         -- Anleitung im Download-Kasten
  cover TEXT,                                -- Titelbild (media.stored_name)
  images TEXT NOT NULL DEFAULT '[]',         -- JSON [{ f, cap }] in Reihenfolge
  facts TEXT NOT NULL DEFAULT '[]',          -- Steckbrief: JSON [[Name, Wert]]
  mods TEXT NOT NULL DEFAULT '[]',           -- benötigte Mods: JSON [{ name, ver, url }]
  plan TEXT,                                 -- Lageplan (Bild von oben)
  pins TEXT NOT NULL DEFAULT '{}',           -- Nummern auf dem Lageplan: JSON { Bauwerk-ID: [x, y] } in Prozent
  before_img TEXT,                           -- Vorher/Nachher
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
`);

const KINDS = { spielstand: { icon: '💾', label: 'Spielstand', plural: 'Spielstände' }, bauwerk: { icon: '🏗️', label: 'Bauwerk', plural: 'Bauwerke' } };
const RESERVED = new Set(['neu', 'seite', 'dl', 'bild', 'spiel']);
const NEW_DAYS = 14;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
const MAX_IMAGES = 60;
const SORTS = { eigene: 'Empfohlen', neu: 'Neueste zuerst', beliebt: 'Meiste Downloads', name: 'Name A–Z' };

const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const json = (s, def) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : def; } catch { return def; } };
const asArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const mediaName = s => (typeof s === 'string' && /^[\w.-]{1,80}$/.test(s) ? s : null);

// ---------- Inhalt eines Eintrags lesen ----------
function images(d) { return json(d.images, []).filter(i => i && mediaName(i.f)).map(i => ({ f: i.f, cap: str(i.cap, 120) })); }
function facts(d) { return json(d.facts, []).filter(r => Array.isArray(r) && r[0]).map(r => [str(r[0], 40), str(r[1], 120)]); }
function mods(d) { return json(d.mods, []).filter(m => m && m.name).map(m => ({ name: str(m.name, 80), ver: str(m.ver, 20), url: link(m.url) })); }
function pins(d) {
  const p = json(d.pins, {}), out = {};
  for (const [k, v] of Object.entries(p)) if (/^\d+$/.test(k) && Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 100)) out[k] = v;
  return out;
}
// Mod-Link: eine Adresse im Netz (https/http) oder eine Seite hier (/downloads/…)
const link = u => { u = str(u, 500); return safeUrl(u) || (/^\/(?![/\\])\S*$/.test(u) ? u : ''); };

// ---------- Rechte ----------
const canWrite = user => !!user && (user.isAdmin || !!user.canWrite);
const canSee = (user, d) => auth.canSee(user, 'dio', d);
const canEdit = (user, d) => !!user && !!d && (user.isAdmin || (canWrite(user) && d.author_id === user.id));

function bySlug(slug) { return db.prepare('SELECT * FROM dioramen WHERE slug = ?').get(String(slug || '')); }
function byId(id) { return db.prepare('SELECT * FROM dioramen WHERE id = ?').get(Number(id)); }
function visible(user) {
  const v = auth.visibilitySql(user, 'dio', 'd');
  return db.prepare(`SELECT d.* FROM dioramen d WHERE ${v.sql} ORDER BY d.created_at DESC`).all(...v.params);
}
function files(d) { return db.prepare('SELECT * FROM dio_files WHERE dio_id = ? ORDER BY created_at DESC, id DESC').all(d.id); }
function fileById(id) { return db.prepare('SELECT * FROM dio_files WHERE id = ?').get(Number(id)); }

// Eine Zeile für Karten und Listen
function row(d, user, ctx = {}) {
  const fs_ = ctx.files ? ctx.files.get(d.id) || [] : files(d);
  const latest = fs_[0] || null, since = now() - NEW_DAYS * 86400;
  const parent = d.parent_id ? (ctx.byId ? ctx.byId.get(d.parent_id) : byId(d.parent_id)) : null;
  const kids = ctx.kids ? ctx.kids.get(d.id) || 0 : 0;
  const imgs = images(d);
  return {
    key: 'd' + d.id, id: d.id, slug: d.slug, url: '/dioramen/' + d.slug, kind: d.kind, kindIcon: KINDS[d.kind].icon, kindLabel: KINDS[d.kind].label,
    title: d.title, summary: d.summary, game: d.game, world: d.world, cover: d.cover ? '/media/' + d.cover : imgs[0] ? '/media/' + imgs[0].f : null,
    imageCount: imgs.length + (d.cover && !imgs.some(i => i.f === d.cover) ? 1 : 0),
    parent: parent && (!user || canSee(user, parent)) ? { title: parent.title, url: '/dioramen/' + parent.slug } : null,
    kids, pinned: !!d.pinned, fresh: d.created_at >= since, update: !!latest && fs_.length > 1 && latest.created_at >= since,
    version: latest && latest.version, size: latest ? latest.size : 0, sizeText: latest ? fmtSize(latest.size) : '', dl: latest ? '/dioramen/dl/' + latest.id : null,
    downloads: fs_.reduce((n, f) => n + f.downloads, 0), date: Math.max(d.created_at, latest ? latest.created_at : 0), created: d.created_at,
    vis: d.visibility, edit: canEdit(user, d),
  };
}
// Alles Nötige für viele Zeilen auf einmal (statt je Eintrag eine Abfrage)
function context(list) {
  const ctx = { files: new Map(), kids: new Map(), byId: new Map(list.map(d => [d.id, d])) };
  if (!list.length) return ctx;
  const ids = list.map(d => d.id);
  for (const f of db.prepare(`SELECT * FROM dio_files WHERE dio_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`).all(...ids)) {
    (ctx.files.get(f.dio_id) || ctx.files.set(f.dio_id, []).get(f.dio_id)).push(f);
  }
  for (const d of list) if (d.parent_id) ctx.kids.set(d.parent_id, (ctx.kids.get(d.parent_id) || 0) + 1);
  return ctx;
}

// ---------- Aufbau der Seite (Bearbeiten-Modus) ----------
const LAYOUT = {
  title: 'Dancors Dioramen', text: 'Spielstände und einzelne Bauwerke aus meinen Spielen. Anschauen, nachbauen oder einfach herunterladen.',
  hero: 'pin', sort: 'eigene', order: [], hidden: [],
};
const keyOk = k => typeof k === 'string' && /^d\d{1,9}$/.test(k);
function normalize(l) {
  l = l && typeof l === 'object' ? l : {};
  const keys = a => (Array.isArray(a) ? [...new Set(a.filter(keyOk))].slice(0, 1000) : []);
  return {
    title: str(l.title, 80) || LAYOUT.title, text: str(l.text, 300) || LAYOUT.text,
    hero: ['pin', 'neu', 'aus'].includes(l.hero) ? l.hero : 'pin', sort: l.sort === 'neu' ? 'neu' : 'eigene',
    order: keys(l.order), hidden: keys(l.hidden),
  };
}
function layout() { return normalize(json(getSetting('dio_layout', 'null'), {})); }
// Speichert den Aufbau; Titel, Kurztext und „angepinnt“ gehen direkt an die Einträge
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

// Übersicht: o = { spiel, typ, sort, q }
function view(user, o = {}) {
  const l = layout(), list = visible(user), ctx = context(list);
  const all = list.map(d => row(d, user, ctx));
  const hidden = new Set(l.hidden);
  for (const r of all) r.hidden = hidden.has(r.key);
  const isAdmin = !!(user && user.isAdmin);
  const games = [];
  for (const r of all) if (r.game && !r.hidden) { const g = games.find(x => x.name === r.game); if (g) g.n++; else games.push({ name: r.game, n: 1 }); }
  games.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
  const spiel = games.some(g => g.name === o.spiel) ? o.spiel : '';
  const typ = Object.hasOwn(KINDS, o.typ) ? o.typ : '';
  const sort = Object.hasOwn(SORTS, o.sort) ? o.sort : l.sort;
  const q = str(o.q, 100).toLowerCase();
  // Eigene Reihenfolge: angepinnt zuerst, dann noch nicht einsortierte (neue) Einträge, dann die gezogene Reihenfolge
  const pos = new Map(l.order.map((k, i) => [k, i]));
  const cmp = {
    eigene: (a, b) => b.pinned - a.pinned || (pos.has(a.key) ? pos.get(a.key) : -1) - (pos.has(b.key) ? pos.get(b.key) : -1) || b.date - a.date,
    neu: (a, b) => b.created - a.created, beliebt: (a, b) => b.downloads - a.downloads || b.date - a.date,
    name: (a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }),
  }[sort];
  const filtered = !!(spiel || typ || q);
  const arrange = isAdmin && !filtered && sort === 'eigene';
  let cards = all.filter(r => (!r.hidden || arrange) && (!spiel || r.game === spiel) && (!typ || r.kind === typ)
    && (!q || [r.title, r.summary, r.game, r.world].some(x => x && x.toLowerCase().includes(q))));
  cards.sort(cmp);
  // Oben groß: der erste angepinnte oder der neueste Eintrag, nur in der ungefilterten Ansicht
  let hero = null;
  if (!filtered && l.hero !== 'aus') {
    const pool = cards.filter(r => !r.hidden);
    hero = l.hero === 'pin' ? pool.find(r => r.pinned) || null : [...pool].sort((a, b) => b.created - a.created)[0] || null;
    if (hero && !arrange) cards = cards.filter(r => r !== hero);
  }
  return {
    layout: l, cards, hero, games, spiel, typ, sort, sorts: SORTS, q: o.q ? str(o.q, 100) : '', canArrange: arrange, filtered,
    counts: { spielstand: all.filter(r => r.kind === 'spielstand' && !r.hidden).length, bauwerk: all.filter(r => r.kind === 'bauwerk' && !r.hidden).length },
  };
}

// Eintragsseite: alles zum Anzeigen
function page(user, d) {
  const imgs = images(d);
  const gallery = d.cover && !imgs.some(i => i.f === d.cover) ? [{ f: d.cover, cap: '' }, ...imgs] : imgs.length && d.cover ? [imgs.find(i => i.f === d.cover), ...imgs.filter(i => i.f !== d.cover)] : imgs;
  const fl = files(d);
  const parent = d.parent_id ? byId(d.parent_id) : null;
  const showParent = parent && canSee(user, parent) ? parent : null;
  const v = auth.visibilitySql(user, 'dio', 'd');
  const kids = d.kind === 'spielstand' ? db.prepare(`SELECT d.* FROM dioramen d WHERE d.parent_id = ? AND ${v.sql} ORDER BY d.created_at`).all(d.id, ...v.params) : [];
  const siblings = showParent ? db.prepare(`SELECT d.* FROM dioramen d WHERE d.parent_id = ? AND d.id != ? AND ${v.sql} ORDER BY d.created_at LIMIT 4`).all(showParent.id, d.id, ...v.params) : [];
  const kidCtx = context([...kids, ...siblings]);
  const pinMap = pins(d);
  const kidRows = kids.map((k, i) => ({ ...row(k, user, kidCtx), no: i + 1, pin: pinMap[k.id] || null }));
  const parentFiles = !fl.length && showParent ? files(showParent) : [];
  const author = d.author_id ? db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(d.author_id) : null;
  return {
    d, kind: KINDS[d.kind], gallery, facts: facts(d), mods: mods(d), files: fl, latest: fl[0] || null, parent: showParent,
    parentDl: parentFiles[0] ? { url: '/dioramen/dl/' + parentFiles[0].id, version: parentFiles[0].version, size: fmtSize(parentFiles[0].size) } : null,
    kids: kidRows, siblings: siblings.map(s => row(s, user, kidCtx)), plan: d.plan && kidRows.length ? d.plan : null,
    compare: d.before_img && d.after_img ? { before: d.before_img, after: d.after_img } : null,
    downloads: fl.reduce((n, f) => n + f.downloads, 0), author: author ? author.display_name || author.username : '',
    fresh: d.created_at >= now() - NEW_DAYS * 86400,
  };
}

// Startseite, Suche, „Zuletzt neu“
function stats(user) {
  const list = visible(user), l = layout(), hidden = new Set(l.hidden);
  const shown = list.filter(d => !hidden.has('d' + d.id));
  const latest = shown[0] || null;
  return { spielstand: shown.filter(d => d.kind === 'spielstand').length, bauwerk: shown.filter(d => d.kind === 'bauwerk').length, latest: latest && { title: latest.title, url: '/dioramen/' + latest.slug } };
}
function meta(user) {
  const s = stats(user), out = [];
  if (!s.spielstand && !s.bauwerk) return ['Noch leer'];
  if (s.spielstand) out.push(`${s.spielstand} ${s.spielstand === 1 ? 'Spielstand' : 'Spielstände'}`);
  if (s.bauwerk) out.push(`${s.bauwerk} ${s.bauwerk === 1 ? 'Bauwerk' : 'Bauwerke'}`);
  if (s.latest) out.push('neu: ' + s.latest.title);
  return out;
}
function recent(user, limit = 5) {
  return visible(user).slice(0, limit).map(d => ({ title: d.title, url: '/dioramen/' + d.slug, at: d.created_at }));
}
function search(user, q, limit = 20) {
  q = str(q, 100).toLowerCase();
  if (!q) return [];
  return visible(user).filter(d => [d.title, d.summary, d.game, d.world, d.body_md].some(x => x && x.toLowerCase().includes(q))).slice(0, limit)
    .map(d => ({ kind: 'di', icon: KINDS[d.kind].icon, title: d.title, text: [KINDS[d.kind].label, d.game, d.world].filter(Boolean).join(' · '), url: '/dioramen/' + d.slug }));
}
// Karten für Dancors Downloads: Einträge mit Haken „auch in Downloads zeigen“ und einer Datei
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
  let slug = slugify(base) || 'eintrag';
  if (RESERVED.has(slug)) slug += '-1';
  const root = slug;
  for (let i = 2; db.prepare('SELECT 1 FROM dioramen WHERE slug = ? AND id != ?').get(slug, id); i++) slug = `${root}-${i}`;
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
// Ein Spielstand als „Teil von“: nur Spielstände, nicht der Eintrag selbst
function parentFrom(b, id = 0) {
  const p = Number(b.parent_id) ? byId(b.parent_id) : null;
  return p && p.kind === 'spielstand' && p.id !== id ? p.id : null;
}
function fields(b, id = 0) {
  const kind = Object.hasOwn(KINDS, b.kind) ? b.kind : 'spielstand';
  return {
    kind, parent_id: kind === 'bauwerk' ? parentFrom(b, id) : null,
    title: str(b.title, 120), game: str(b.game, 80), world: str(b.world, 80), summary: str(b.summary, 240),
    body_md: String(b.body_md || '').slice(0, 200000), howto_md: String(b.howto_md || '').slice(0, 20000),
    facts: JSON.stringify(factsFrom(b)), mods: JSON.stringify(modsFrom(b)), in_downloads: b.in_downloads ? 1 : 0,
  };
}
function create(user, b, extra = {}) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Eintrag einen Titel.');
  const t = now();
  const id = Number(db.prepare(`INSERT INTO dioramen(slug, kind, parent_id, title, game, world, summary, body_md, howto_md, facts, mods, in_downloads, pinned, visibility, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uniqueSlug(b.slug || f.title), f.kind, f.parent_id, f.title, f.game, f.world, f.summary, f.body_md, f.howto_md,
    f.facts, f.mods, f.in_downloads, user.isAdmin && b.pinned ? 1 : 0, extra.visibility || 'public', user.id, t, t).lastInsertRowid);
  return byId(id);
}
function update(user, d, b, extra = {}) {
  const f = fields(b, d.id);
  if (!f.title) throw new Error('Bitte gib dem Eintrag einen Titel.');
  const slug = b.slug && slugify(b.slug) !== d.slug ? uniqueSlug(b.slug, d.id) : d.slug;
  db.prepare(`UPDATE dioramen SET slug = ?, kind = ?, parent_id = ?, title = ?, game = ?, world = ?, summary = ?, body_md = ?, howto_md = ?, facts = ?, mods = ?, in_downloads = ?,
    pinned = ?, visibility = ?, updated_at = ? WHERE id = ?`).run(slug, f.kind, f.parent_id, f.title, f.game, f.world, f.summary, f.body_md, f.howto_md, f.facts, f.mods, f.in_downloads,
    user.isAdmin ? (b.pinned ? 1 : 0) : d.pinned, extra.visibility || d.visibility, now(), d.id);
  // Wird aus dem Spielstand ein Bauwerk, hängen seine Bauwerke nicht mehr an ihm
  if (f.kind !== 'spielstand') db.prepare('UPDATE dioramen SET parent_id = NULL WHERE parent_id = ?').run(d.id);
  return byId(d.id);
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
// Titelbild per Name (cover) oder „new:<n>“ für das n-te neue Bild. Lageplan, Vorher und Nachher einzeln.
function setImages(d, b, added, singles = {}) {
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
  const keepOr = (name, drop, fresh) => fresh || (drop ? null : d[name]);
  db.prepare('UPDATE dioramen SET images = ?, cover = ?, plan = ?, before_img = ?, after_img = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(out), cover,
    keepOr('plan', b.drop_plan, singles.plan), keepOr('before_img', b.drop_before, singles.before), keepOr('after_img', b.drop_after, singles.after), now(), d.id);
}
// Nummern auf dem Lageplan: { Bauwerk-ID: [x, y] }, nur für eigene Bauwerke
function setPins(d, raw) {
  const p = json(typeof raw === 'string' ? raw : JSON.stringify(raw || {}), {}), out = {};
  const kids = new Set(db.prepare('SELECT id FROM dioramen WHERE parent_id = ?').all(d.id).map(r => String(r.id)));
  for (const [k, v] of Object.entries(p)) {
    if (!kids.has(k) || !Array.isArray(v) || v.length !== 2) continue;
    const [x, y] = v.map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out[k] = [Math.round(Math.min(100, Math.max(0, x)) * 10) / 10, Math.round(Math.min(100, Math.max(0, y)) * 10) / 10];
  }
  db.prepare('UPDATE dioramen SET pins = ? WHERE id = ?').run(JSON.stringify(out), d.id);
  return out;
}

function addFile(user, d, file, b) {
  const id = Number(db.prepare(`INSERT INTO dio_files(dio_id, original_name, stored_name, size, mime, version, changes, uploader_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.id, file.originalname, file.filename, file.size, file.mimetype, str(b.version, 30) || null, String(b.changes || '').slice(0, 20000) || null, user.id, now()).lastInsertRowid);
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
// Eintrag löschen nimmt seine Dateien mit; Bauwerke bleiben (ohne „Teil von“), Bilder bleiben in der Bibliothek
function remove(d) {
  for (const f of files(d)) removeFile(d, f.id);
  db.prepare('UPDATE dioramen SET parent_id = NULL WHERE parent_id = ?').run(d.id);
  db.prepare("DELETE FROM acl WHERE item_type = 'dio' AND item_id = ?").run(d.id);
  db.prepare('DELETE FROM dioramen WHERE id = ?').run(d.id);
}
function removeQuietly(p) { try { fs.rmSync(p, { force: true }); } catch { /* egal */ } }

// Spielstände zur Auswahl „Teil von“ und bekannte Spiele für das Formular
function parents(user, exceptId = 0) {
  return visible(user).filter(d => d.kind === 'spielstand' && d.id !== exceptId).map(d => ({ id: d.id, title: d.title, game: d.game }));
}
function knownGames() { return db.prepare("SELECT DISTINCT game FROM dioramen WHERE game != '' ORDER BY game COLLATE NOCASE").all().map(r => r.game); }

module.exports = {
  KINDS, SORTS, IMAGE_TYPES, NEW_DAYS, canWrite, canSee, canEdit, bySlug, byId, files, fileById, images, facts, mods, pins, row, view, page, layout, saveLayout, normalize,
  stats, meta, recent, search, downloadCards, create, update, takeImage, setImages, setPins, addFile, removeFile, remove, parents, knownGames, factsFrom, modsFrom, uniqueSlug,
};
