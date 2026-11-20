'use strict';
// Dancors Duden (Version 3.0, src/routes/duden.js, views/v3/duden*.ejs): Guides (Schritt für Schritt), Wiki-Artikel zum
// Nachschlagen und Linksammlungen, nach Themen sortiert. Schreiben dürfen Admins und Mitglieder mit dem Recht „Schreiben“
// (users.can_write). Die alte Linksammlung (/links, Tabelle links) zieht als Linksammlungen ein: je Kategorie ein Eintrag.
const { db, now } = require('./db');
const auth = require('./auth');
const { slugify, mdBlocks, safeUrl } = require('./util');

db.exec(`
CREATE TABLE IF NOT EXISTS duden (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'wiki',        -- guide | wiki | links
  topic TEXT NOT NULL DEFAULT 'Allgemein',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  link_category TEXT,                       -- Linksammlung: Kategorie der Links (Tabelle links)
  visibility TEXT NOT NULL DEFAULT 'public',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  editor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS duden_topic ON duden(topic, title);
`);

const KINDS = {
  guide: { label: 'Guide', plural: 'Guides', icon: '🧭', hint: 'Schritt für Schritt' },
  wiki: { label: 'Wiki-Artikel', plural: 'Wiki', icon: '📘', hint: 'zum Nachschlagen' },
  links: { label: 'Linksammlung', plural: 'Linksammlungen', icon: '🔗', hint: 'gute Adressen zu einem Thema' },
};
const RESERVED = new Set(['neu', 'beitraege', 'links', 'thema', 'guides', 'wiki', 'bild', 'vorschau']);
const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

// Die Links ziehen um: jede Kategorie ohne Eintrag wird eine Linksammlung im Thema „Links“. Läuft beim Start und vor jeder
// Übersicht, damit auch Kategorien aus der Seitenverwaltung (Inhalte → Links) gleich eine Sammlung bekommen.
function migrateLinks() {
  const t = now();
  for (const r of db.prepare('SELECT category, MIN(created_at) AS at FROM links GROUP BY category ORDER BY category').all()) {
    if (db.prepare('SELECT 1 FROM duden WHERE kind = ? AND link_category = ?').get('links', r.category)) continue;
    db.prepare(`INSERT INTO duden(slug, kind, topic, title, summary, body_md, link_category, visibility, created_at, updated_at) VALUES (?, 'links', 'Links', ?, '', '', ?, 'public', ?, ?)`)
      .run(uniqueSlug(r.category), r.category, r.category, r.at || t, t);
  }
}

// ---------- Rechte ----------
const canWrite = user => !!user && (user.isAdmin || !!user.canWrite);
const canSee = (user, e) => auth.canSee(user, 'duden', e);
// Wie in einem Wiki: Wer schreiben darf, darf auch fremde Einträge verbessern, die er sieht. Löschen nur der Autor und der Admin.
const canEdit = (user, e) => canWrite(user) && canSee(user, e);
const canDelete = (user, e) => !!user && (user.isAdmin || (e.author_id && e.author_id === user.id));

// ---------- Lesen ----------
const bySlug = slug => db.prepare('SELECT * FROM duden WHERE slug = ?').get(String(slug || ''));
const byId = id => db.prepare('SELECT * FROM duden WHERE id = ?').get(Number(id));

function visible(user) {
  const v = auth.visibilitySql(user, 'duden', 'd');
  return db.prepare(`SELECT d.*, u.username AS author_name, u.display_name AS author_display FROM duden d LEFT JOIN users u ON u.id = d.author_id
                     WHERE ${v.sql} ORDER BY d.topic COLLATE NOCASE, d.title COLLATE NOCASE`).all(...v.params);
}
function linksOf(user, e) {
  if (e.kind !== 'links' || !e.link_category) return [];
  const v = auth.visibilitySql(user, 'link', 'l');
  return db.prepare(`SELECT * FROM links l WHERE l.category = ? AND ${v.sql} ORDER BY position, title COLLATE NOCASE`).all(e.link_category, ...v.params);
}
function posts(user, limit = 50) {
  const v = auth.visibilitySql(user, 'post', 'p');
  return db.prepare(`SELECT slug, title, summary, tags, created_at, updated_at FROM posts p WHERE published = 1 AND ${v.sql} ORDER BY created_at DESC LIMIT ?`).all(...v.params, limit);
}
function post(user, slug) {
  const p = db.prepare('SELECT * FROM posts WHERE slug = ? AND published = 1').get(String(slug || ''));
  return p && auth.canSee(user, 'post', p) ? p : null;
}

// Wiki-Verweise [[Titel]] oder [[Titel|Text]] werden zu Links auf den Eintrag, wenn es ihn gibt
function wikiLinks(md, user) {
  return String(md || '').replace(/\[\[([^\]|\n]{1,120})(?:\|([^\]\n]{1,120}))?\]\]/g, (m, target, text) => {
    const t = target.trim();
    const e = db.prepare('SELECT slug, title, visibility, author_id, id FROM duden WHERE slug = ? OR title = ? COLLATE NOCASE').get(slugify(t), t);
    if (!e || !canSee(user, e)) return text || t;
    return `[${(text || e.title).replace(/[[\]]/g, '')}](/duden/${e.slug})`;
  });
}
const render = (md, user) => mdBlocks(wikiLinks(md, user));

// Seitenleiste und Liste: Themen mit Anzahl, Arten, gefilterte Einträge
function view(user, { topic = '', kind = '', q = '' } = {}) {
  migrateLinks();
  const all = visible(user);
  const topics = {};
  for (const e of all) topics[e.topic] = (topics[e.topic] || 0) + 1;
  const kinds = Object.fromEntries(Object.keys(KINDS).map(k => [k, all.filter(e => e.kind === k).length]));
  q = str(q, 100);
  topic = str(topic, 60);
  kind = Object.hasOwn(KINDS, kind) ? kind : '';
  const k = q.toLowerCase();
  let rows = all;
  if (q) rows = rows.filter(e => [e.title, e.summary, e.topic, e.body_md].some(x => x && x.toLowerCase().includes(k)));
  if (topic) rows = rows.filter(e => e.topic === topic);
  if (kind) rows = rows.filter(e => e.kind === kind);
  return {
    rows, all, q, topic, kind,
    topics: Object.entries(topics).sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([name, n]) => ({ name, n })),
    kinds, recent: [...all].sort((a, b) => b.updated_at - a.updated_at).slice(0, 6),
  };
}
const topicList = () => db.prepare('SELECT DISTINCT topic FROM duden ORDER BY topic COLLATE NOCASE').all().map(r => r.topic);
function related(user, e, limit = 6) {
  return visible(user).filter(x => x.id !== e.id && x.topic === e.topic).slice(0, limit);
}
function stats(user) {
  const all = visible(user);
  const latest = [...all].sort((a, b) => b.created_at - a.created_at)[0] || null;
  return { count: all.length, latest };
}
function recent(user, limit = 5) {
  return visible(user).sort((a, b) => b.created_at - a.created_at).slice(0, limit).map(e => ({ title: e.title, url: '/duden/' + e.slug, at: e.created_at }));
}
function search(user, q, limit = 20) {
  q = str(q, 100);
  if (!q) return [];
  return view(user, { q }).rows.slice(0, limit).map(e => ({ kind: 'du', icon: e.icon || KINDS[e.kind].icon, title: e.title, text: e.summary || KINDS[e.kind].label + ' · ' + e.topic, url: '/duden/' + e.slug }))
    .concat(posts(user, 200).filter(p => [p.title, p.summary, p.tags].some(x => x && x.toLowerCase().includes(q.toLowerCase()))).slice(0, 5)
      .map(p => ({ kind: 'blog', icon: '📝', title: p.title, text: p.summary || 'Beitrag', url: '/duden/beitraege/' + p.slug })));
}
function seen(e) { db.prepare('UPDATE duden SET views = views + 1 WHERE id = ?').run(e.id); }

// ---------- Schreiben ----------
function uniqueSlug(base, id = 0) {
  let slug = slugify(base);
  if (RESERVED.has(slug)) slug += '-1';
  for (let i = 2; db.prepare('SELECT 1 FROM duden WHERE slug = ? AND id != ?').get(slug, id); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}
function fields(b) {
  return {
    kind: Object.hasOwn(KINDS, b.kind) ? b.kind : 'wiki', topic: str(b.topic, 60) || 'Allgemein', title: str(b.title, 140), summary: str(b.summary, 280),
    body_md: String(b.body_md || '').slice(0, 300000), icon: [...str(b.icon, 8)].slice(0, 2).join(''),
  };
}
// Links einer Sammlung als Zeilen „Titel | Adresse | Beschreibung“
function linksText(e) {
  if (!e || !e.link_category) return '';
  return db.prepare('SELECT title, url, description FROM links WHERE category = ? ORDER BY position, title COLLATE NOCASE').all(e.link_category)
    .map(l => [l.title, l.url, l.description].filter((x, i) => i < 2 || x).join(' | ')).join('\n');
}
function parseLinks(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split('|').map(s => s.trim());
    if (!parts[0]) continue;
    let [title, url, desc] = parts;
    if (!url && /^https?:\/\//i.test(title)) { url = title; title = title.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''); }
    url = safeUrl(url);
    if (!url) continue;
    out.push({ title: title.slice(0, 200), url: url.slice(0, 2000), description: (desc || '').slice(0, 500) || null });
  }
  return out.slice(0, 300);
}
// Speichert die Links der Sammlung. Vorhandene Links (gleiche Adresse) behalten ihre Sichtbarkeit.
function saveLinks(e, text) {
  const cat = e.link_category;
  const list = parseLinks(text), old = db.prepare('SELECT * FROM links WHERE category = ?').all(cat);
  const keep = new Set();
  list.forEach((l, i) => {
    const o = old.find(x => x.url === l.url && !keep.has(x.id));
    if (o) { keep.add(o.id); db.prepare('UPDATE links SET title = ?, description = ?, position = ? WHERE id = ?').run(l.title, l.description, i, o.id); }
    else db.prepare('INSERT INTO links(category, title, url, description, position, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(cat, l.title, l.url, l.description, i, 'public', now());
  });
  for (const o of old) if (!keep.has(o.id)) { db.prepare("DELETE FROM acl WHERE item_type = 'link' AND item_id = ?").run(o.id); db.prepare('DELETE FROM links WHERE id = ?').run(o.id); }
  return list.length;
}
function create(user, b, visibility) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Eintrag einen Titel.');
  const t = now();
  let cat = null;
  if (f.kind === 'links') {
    cat = f.title;
    for (let i = 2; db.prepare('SELECT 1 FROM duden WHERE link_category = ?').get(cat); i++) cat = `${f.title} (${i})`;
  }
  const id = Number(db.prepare(`INSERT INTO duden(slug, kind, topic, title, summary, body_md, icon, link_category, visibility, author_id, editor_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uniqueSlug(b.slug || f.title), f.kind, f.topic, f.title, f.summary, f.body_md, f.icon, cat, visibility, user.id, user.id, t, t).lastInsertRowid);
  const e = byId(id);
  if (f.kind === 'links') saveLinks(e, b.links_text);
  return e;
}
function update(user, e, b, visibility) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Eintrag einen Titel.');
  let cat = e.link_category;
  if (f.kind === 'links' && !cat) cat = f.title;
  const slug = b.slug && slugify(b.slug) !== e.slug ? uniqueSlug(b.slug, e.id) : e.slug;
  db.prepare('UPDATE duden SET slug = ?, kind = ?, topic = ?, title = ?, summary = ?, body_md = ?, icon = ?, link_category = ?, visibility = ?, editor_id = ?, updated_at = ? WHERE id = ?')
    .run(slug, f.kind, f.topic, f.title, f.summary, f.body_md, f.icon, cat, visibility, user.id, now(), e.id);
  const n = byId(e.id);
  if (f.kind === 'links' && b.links_text !== undefined) saveLinks(n, b.links_text);
  return n;
}
// Löschen: Linksammlung nimmt ihre Links mit
function remove(e) {
  if (e.kind === 'links' && e.link_category) {
    for (const l of db.prepare('SELECT id FROM links WHERE category = ?').all(e.link_category)) db.prepare("DELETE FROM acl WHERE item_type = 'link' AND item_id = ?").run(l.id);
    db.prepare('DELETE FROM links WHERE category = ?').run(e.link_category);
  }
  db.prepare("DELETE FROM acl WHERE item_type = 'duden' AND item_id = ?").run(e.id);
  db.prepare('DELETE FROM duden WHERE id = ?').run(e.id);
}

migrateLinks();

module.exports = {
  KINDS, canWrite, canSee, canEdit, canDelete, bySlug, byId, visible, linksOf, posts, post, render, view, topicList, related, stats, recent, search, seen,
  linksText, parseLinks, saveLinks, create, update, remove, migrateLinks,
};
