'use strict';
// Dancors Deliziösitäten (Version 3.0, src/routes/rezepte.js, views/v3/rezept*.ejs, public/rezept.js): das Rezeptbuch.
// Zutaten stehen geordnet im Rezept (Menge, Einheit, Name, Hinweis), damit der Portionsrechner sie umrechnen und die
// Einkaufsliste gleiche Zutaten zusammenzählen kann. Schreiben dürfen Admins und Mitglieder mit dem Recht „Schreiben“.
const { db, now } = require('./db');
const auth = require('./auth');
const { slugify } = require('./util');

db.exec(`
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  intro_md TEXT NOT NULL DEFAULT '',        -- Einleitung und Tipps (Markdown)
  servings INTEGER NOT NULL DEFAULT 4,
  servings_label TEXT NOT NULL DEFAULT 'Portionen',
  prep_min INTEGER,                         -- Arbeitszeit
  cook_min INTEGER,                         -- Koch- und Backzeit
  ingredients TEXT NOT NULL DEFAULT '[]',   -- JSON: [{ g: 'Für den Teig' } | { a, a2, u, n, note }]
  steps TEXT NOT NULL DEFAULT '[]',         -- JSON: ['Schritt', …]
  tags TEXT NOT NULL DEFAULT '',            -- mit Komma
  icon TEXT NOT NULL DEFAULT '',
  image TEXT,                               -- Bild aus media (stored_name)
  source_url TEXT,                          -- übernommen von
  visibility TEXT NOT NULL DEFAULT 'public',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_favs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, recipe_id)
);
-- Einkaufsliste je Mitglied: jede Zutat einzeln (mit Rezept), die Liste zählt gleiche zusammen
CREATE TABLE IF NOT EXISTS shopping_items (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount REAL,
  unit TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shop_user ON shopping_items(user_id, done);
`);

const RESERVED = new Set(['neu', 'einkauf', 'favoriten', 'tag', 'bild', 'import']);
const TAG_IDEAS = ['vegetarisch', 'vegan', 'schnell', 'Backen', 'Grill', 'Dessert', 'Suppe', 'Salat', 'Frühstück', 'Party', 'Weihnachten'];
const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

// ---------- Zutaten lesen und schreiben ----------
const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅛': 0.125 };
const UNITS = ['g', 'kg', 'mg', 'ml', 'l', 'cl', 'dl', 'EL', 'TL', 'Msp.', 'Prise', 'Prisen', 'Stück', 'Stk.', 'Pck.', 'Päckchen', 'Packung', 'Packungen',
  'Dose', 'Dosen', 'Becher', 'Bund', 'Zehe', 'Zehen', 'Scheibe', 'Scheiben', 'Tasse', 'Tassen', 'Glas', 'Gläser', 'Handvoll', 'Blatt', 'Blätter',
  'Zweig', 'Zweige', 'Tropfen', 'Spritzer', 'Würfel', 'Stange', 'Stangen', 'Knolle', 'Knollen', 'Kopf', 'Köpfe', 'cm', 'Liter', 'Gramm', 'Kilogramm', 'Schuss', 'Rolle', 'Rollen', 'Tafel', 'Tafeln', 'Beutel', 'Flasche', 'Flaschen'];
const UNIT_ALIAS = { el: 'EL', tl: 'TL', esslöffel: 'EL', teelöffel: 'TL', stk: 'Stk.', 'stk.': 'Stk.', st: 'Stück', 'st.': 'Stück', pck: 'Pck.', 'pck.': 'Pck.', msp: 'Msp.', 'msp.': 'Msp.',
  liter: 'l', gramm: 'g', kilogramm: 'kg', milliliter: 'ml', tbsp: 'EL', tsp: 'TL', cup: 'Tasse', cups: 'Tassen' };
const unitOf = w => { const l = w.toLowerCase(); return UNIT_ALIAS[l] || UNITS.find(u => u.toLowerCase() === l) || null; };

function num(s) {
  s = String(s).trim();
  if (FRACTIONS[s] != null) return FRACTIONS[s];
  let m = /^(\d+)\s*([½⅓⅔¼¾⅕⅛])$/.exec(s);
  if (m) return Number(m[1]) + FRACTIONS[m[2]];
  m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = /^\d+(?:[.,]\d+)?$/.exec(s);
  return m ? Number(s.replace(',', '.')) : null;
}
const AMOUNT = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\s*[½⅓⅔¼¾⅕⅛]|[½⅓⅔¼¾⅕⅛]|\\d+(?:[.,]\\d+)?)';
const LINE_RE = new RegExp(`^(${AMOUNT})(?:\\s*(?:-|–|bis)\\s*(${AMOUNT}))?\\s*(.*)$`);

// Eine Zeile wie „1 1/2 EL Zucker, fein“ oder „Für den Teig:“
function parseLine(line) {
  line = str(line, 200).replace(/^[-*•]\s*/, '');
  if (!line) return null;
  if (/:$/.test(line) && line.length <= 60) return { g: line.slice(0, -1).trim() };
  const m = LINE_RE.exec(line);
  let a = null, a2 = null, rest = line;
  if (m) { a = num(m[1]); a2 = m[2] ? num(m[2]) : null; rest = m[3]; }
  let u = '';
  const w = /^(\S+)\s+(.*)$/.exec(rest);
  if (a != null && w) {
    const unit = unitOf(w[1]) || unitOf(w[1].replace(/\.$/, ''));
    if (unit) { u = unit; rest = w[2]; }
  } else if (a != null) {
    const glued = /^(g|kg|mg|ml|l|cl|dl)\b\s*(.*)$/i.exec(rest);
    if (glued) { u = unitOf(glued[1]); rest = glued[2]; }
  }
  let n = rest.trim(), note = '';
  const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(n);
  if (paren && paren[1]) { n = paren[1]; note = paren[2]; }
  const comma = n.indexOf(',');
  if (comma > 0) { note = [n.slice(comma + 1).trim(), note].filter(Boolean).join(', '); n = n.slice(0, comma).trim(); }
  if (!n) { n = u || line; u = ''; }
  return { a, a2, u, n: n.slice(0, 120), note: note.slice(0, 120) };
}
const parseIngredients = text => String(text || '').split(/\r?\n/).map(parseLine).filter(Boolean).slice(0, 120);

// Mengen schön: ½, 1½, 0,3, 250
const FR_OUT = [[0.5, '½'], [0.25, '¼'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔']];
function fmtAmount(x, unit = '') {
  if (x == null || !isFinite(x)) return '';
  if (x <= 0) return '0';
  const whole = Math.floor(x), rest = x - whole;
  if (!['g', 'ml', 'mg', 'kg', 'l'].includes(unit) || x < 1) {
    for (const [v, s] of FR_OUT) if (Math.abs(rest - v) < 0.04) return (whole ? whole : '') + s;
  }
  if (Math.abs(rest) < 0.04) return String(whole);
  if (Math.abs(1 - rest) < 0.04) return String(whole + 1);
  if (['g', 'ml'].includes(unit) && x >= 100) return String(Math.round(x / 5) * 5);
  return (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)).toLocaleString('de-DE');
}
function ingredientText(i) {
  if (i.g) return i.g + ':';
  const amt = i.a != null ? fmtAmount(i.a, i.u) + (i.a2 != null ? '–' + fmtAmount(i.a2, i.u) : '') : '';
  return [amt, i.u, i.n].filter(Boolean).join(' ') + (i.note ? ', ' + i.note : '');
}
const ingredientsText = list => list.map(ingredientText).join('\n');

const parseSteps = text => String(text || '').split(/\r?\n/).map(s => s.trim().replace(/^(\d{1,2}[.)]|[-*•])\s+/, '')).filter(Boolean).map(s => s.slice(0, 2000)).slice(0, 60);

// Zeiten in Schritten („10 Minuten“, „1–2 Std.“) als Wecker-Knöpfe. Gibt sicheres HTML zurück.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TIME_RE = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|bis)\s*(\d+(?:[.,]\d+)?))?\s*(Minuten|Minute|Min\.?|Stunden|Stunde|Std\.?|Sekunden|Sek\.?)(?![a-zäöü])/gi;
function stepHtml(text) {
  return esc(text).replace(TIME_RE, (m, a, b) => {
    const unit = /^s(t|td)/i.test(m.replace(/^[\d.,\s–-]+(bis\s*[\d.,]+\s*)?/i, '')) ? 3600 : /sek/i.test(m) ? 1 : 60;
    const sec = Math.round(Number(String(b || a).replace(',', '.')) * unit);
    return sec > 0 && sec <= 86400 ? `<button type="button" class="pill small timer-btn" data-timer="${sec}" title="Wecker stellen">⏱ ${m}</button>` : m;
  });
}

// ---------- Rechte ----------
const canWrite = user => !!user && (user.isAdmin || !!user.canWrite);
const canSee = (user, r) => auth.canSee(user, 'recipe', r);
const canEdit = (user, r) => !!user && (user.isAdmin || (r.author_id && r.author_id === user.id) || (!!user.canWrite && canSee(user, r) && r.visibility !== 'private'));
const canDelete = (user, r) => !!user && (user.isAdmin || (r.author_id && r.author_id === user.id));

// ---------- Lesen ----------
const bySlug = slug => db.prepare('SELECT * FROM recipes WHERE slug = ?').get(String(slug || ''));
const byId = id => db.prepare('SELECT * FROM recipes WHERE id = ?').get(Number(id));
function hydrate(r) {
  if (!r) return r;
  let ing = [], steps = [];
  try { ing = JSON.parse(r.ingredients) || []; } catch { ing = []; }
  try { steps = JSON.parse(r.steps) || []; } catch { steps = []; }
  return { ...r, ing, stepList: steps, tagList: tagsOf(r.tags), total: (r.prep_min || 0) + (r.cook_min || 0) };
}
const tagsOf = s => [...new Set(String(s || '').split(',').map(t => str(t, 30)).filter(Boolean))];
function visible(user) {
  const v = auth.visibilitySql(user, 'recipe', 'r');
  return db.prepare(`SELECT r.* FROM recipes r WHERE ${v.sql} ORDER BY r.created_at DESC`).all(...v.params).map(hydrate);
}
const favIds = user => (user ? new Set(db.prepare('SELECT recipe_id FROM recipe_favs WHERE user_id = ?').all(user.id).map(r => r.recipe_id)) : new Set());
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

function view(user, { q = '', tag = '', zutat = '', fav = false } = {}) {
  const all = visible(user), favs = favIds(user);
  const tags = {};
  for (const r of all) for (const t of r.tagList) tags[t] = (tags[t] || 0) + 1;
  let rows = all;
  q = str(q, 100); zutat = str(zutat, 60); tag = str(tag, 30);
  if (q) { const k = norm(q); rows = rows.filter(r => [r.title, r.summary, r.tags, ...r.ing.map(i => i.n)].some(x => norm(x).includes(k))); }
  if (zutat) { const k = norm(zutat); rows = rows.filter(r => r.ing.some(i => i.n && norm(i.n).includes(k))); }
  if (tag) rows = rows.filter(r => r.tagList.some(t => t.toLowerCase() === tag.toLowerCase()));
  if (fav) rows = rows.filter(r => favs.has(r.id));
  return {
    rows: rows.map(r => ({ ...r, fav: favs.has(r.id) })), q, tag, zutat, fav, count: all.length, favCount: all.filter(r => favs.has(r.id)).length,
    tags: Object.entries(tags).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([name, n]) => ({ name, n })),
  };
}
function stats(user) { const all = visible(user); return { count: all.length, latest: all[0] || null }; }
function recent(user, limit = 5) { return visible(user).slice(0, limit).map(r => ({ title: r.title, url: '/rezepte/' + r.slug, at: r.created_at })); }
function search(user, q, limit = 20) {
  if (!str(q, 100)) return [];
  return view(user, { q }).rows.slice(0, limit).map(r => ({ kind: 'de', icon: r.icon || '🍽️', title: r.title, text: r.summary || r.tagList.join(', '), url: '/rezepte/' + r.slug }));
}
const isFav = (user, r) => !!user && !!db.prepare('SELECT 1 FROM recipe_favs WHERE user_id = ? AND recipe_id = ?').get(user.id, r.id);
function toggleFav(user, r) {
  if (isFav(user, r)) { db.prepare('DELETE FROM recipe_favs WHERE user_id = ? AND recipe_id = ?').run(user.id, r.id); return false; }
  db.prepare('INSERT INTO recipe_favs(user_id, recipe_id, created_at) VALUES (?, ?, ?)').run(user.id, r.id, now());
  return true;
}

// ---------- Schreiben ----------
function uniqueSlug(base, id = 0) {
  let slug = slugify(base);
  if (RESERVED.has(slug)) slug += '-rezept';
  for (let i = 2; db.prepare('SELECT 1 FROM recipes WHERE slug = ? AND id != ?').get(slug, id); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}
const minutes = v => { const n = Math.round(Number(String(v ?? '').replace(',', '.'))); return n > 0 && n < 100000 ? n : null; };
function fields(b) {
  return {
    title: str(b.title, 140), summary: str(b.summary, 280), intro_md: String(b.intro_md ?? b.body_md ?? '').slice(0, 100000),
    servings: Math.min(100, Math.max(1, Math.round(Number(b.servings) || 4))), servings_label: str(b.servings_label, 30) || 'Portionen',
    prep_min: minutes(b.prep_min), cook_min: minutes(b.cook_min),
    ingredients: JSON.stringify(parseIngredients(b.ingredients_text)), steps: JSON.stringify(parseSteps(b.steps_text)),
    tags: tagsOf(b.tags).slice(0, 12).join(', '), icon: [...str(b.icon, 8)].slice(0, 2).join(''),
    source_url: /^https?:\/\//i.test(String(b.source_url || '')) ? str(b.source_url, 1000) : null,
  };
}
function create(user, b, visibility, image = null) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Rezept einen Namen.');
  const t = now();
  const id = Number(db.prepare(`INSERT INTO recipes(slug, title, summary, intro_md, servings, servings_label, prep_min, cook_min, ingredients, steps, tags, icon, image, source_url, visibility, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uniqueSlug(b.slug || f.title), f.title, f.summary, f.intro_md, f.servings, f.servings_label, f.prep_min, f.cook_min,
    f.ingredients, f.steps, f.tags, f.icon, image, f.source_url, visibility, user.id, t, t).lastInsertRowid);
  return byId(id);
}
function update(user, r, b, visibility, image) {
  const f = fields(b);
  if (!f.title) throw new Error('Bitte gib dem Rezept einen Namen.');
  const slug = b.slug && slugify(b.slug) !== r.slug ? uniqueSlug(b.slug, r.id) : r.slug;
  db.prepare(`UPDATE recipes SET slug = ?, title = ?, summary = ?, intro_md = ?, servings = ?, servings_label = ?, prep_min = ?, cook_min = ?, ingredients = ?, steps = ?, tags = ?, icon = ?,
    image = ?, source_url = ?, visibility = ?, updated_at = ? WHERE id = ?`).run(slug, f.title, f.summary, f.intro_md, f.servings, f.servings_label, f.prep_min, f.cook_min, f.ingredients,
    f.steps, f.tags, f.icon, image === undefined ? r.image : image, f.source_url, visibility, now(), r.id);
  return byId(r.id);
}
function remove(r) {
  db.prepare("DELETE FROM acl WHERE item_type = 'recipe' AND item_id = ?").run(r.id);
  db.prepare('DELETE FROM recipes WHERE id = ?').run(r.id);
}

// ---------- Einkaufsliste ----------
function addToShopping(user, r, portions) {
  const h = hydrate(r), f = Math.min(100, Math.max(1, Number(portions) || h.servings)) / h.servings;
  const ins = db.prepare('INSERT INTO shopping_items(user_id, recipe_id, name, amount, unit, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  let n = 0;
  for (const i of h.ing) {
    if (i.g || !i.n) continue;
    const a = i.a2 != null ? i.a2 : i.a;
    ins.run(user.id, r.id, i.n, a != null ? a * f : null, i.u || '', now());
    n++;
  }
  return n;
}
function addItem(user, text) {
  const i = parseLine(text);
  if (!i || i.g) return false;
  db.prepare('INSERT INTO shopping_items(user_id, recipe_id, name, amount, unit, created_at) VALUES (?, NULL, ?, ?, ?, ?)').run(user.id, i.n, i.a2 != null ? i.a2 : i.a, i.u || '', now());
  return true;
}
// Gleiche Zutat mit gleicher Einheit wird zusammengezählt; key fasst die Einträge für den Haken zusammen.
// Einfache Mehrzahl zählt mit („Zwiebeln“ = „Zwiebel“, „Tomaten“ = „Tomate“).
const sameName = n => norm(n).replace(/\s+/g, ' ').trim().split(' ').map(w => (/(el|er)n$/.test(w) || (w.length > 4 && /en$/.test(w)) ? w.slice(0, -1) : w)).join(' ');
function shopping(user) {
  const rows = db.prepare(`SELECT s.*, r.title AS recipe, r.slug FROM shopping_items s LEFT JOIN recipes r ON r.id = s.recipe_id WHERE s.user_id = ? ORDER BY s.created_at, s.id`).all(user.id);
  const groups = new Map();
  for (const s of rows) {
    const key = sameName(s.name) + '|' + (s.unit || '').toLowerCase();
    const g = groups.get(key) || { key, name: s.name, unit: s.unit, amount: null, ids: [], done: true, from: new Map(), counted: 0, uncounted: 0 };
    if (s.amount != null) { g.amount = (g.amount || 0) + s.amount; g.counted++; } else g.uncounted++;
    g.ids.push(s.id);
    g.done = g.done && !!s.done;
    if (s.recipe) g.from.set(s.slug, s.recipe);
    groups.set(key, g);
  }
  return [...groups.values()].map(g => ({ ...g, amountText: g.amount != null ? fmtAmount(g.amount, g.unit) : '', from: [...g.from].map(([slug, title]) => ({ slug, title })) }))
    .sort((a, b) => a.done - b.done || a.name.localeCompare(b.name, 'de'));
}
function setDone(user, ids, done) {
  const list = String(ids || '').split(',').map(Number).filter(Boolean).slice(0, 200);
  const st = db.prepare('UPDATE shopping_items SET done = ? WHERE id = ? AND user_id = ?');
  for (const id of list) st.run(done ? 1 : 0, id, user.id);
}
const clearDone = user => db.prepare('DELETE FROM shopping_items WHERE user_id = ? AND done = 1').run(user.id);
const clearAll = user => db.prepare('DELETE FROM shopping_items WHERE user_id = ?').run(user.id);
const shoppingCount = user => (user ? db.prepare('SELECT COUNT(*) AS n FROM shopping_items WHERE user_id = ? AND done = 0').get(user.id).n : 0);

// ---------- Rezept aus einem Link übernehmen (schema.org/Recipe als JSON-LD) ----------
// ISO-Dauer wie „PT1H30M“ oder „P1DT2H“ in Minuten
function isoMinutes(v) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i.exec(String(v || '').trim());
  if (!m) return null;
  const n = (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return n || null;
}
const text = v => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
function findRecipe(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n, depth + 1); if (r) return r; } return null; }
  if (typeof node !== 'object') return null;
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipe(node['@graph'], depth + 1) || findRecipe(node.mainEntity, depth + 1);
}
function stepsOf(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') return ins.split(/\r?\n|(?<=\.)\s{2,}/).map(text).filter(Boolean);
  if (Array.isArray(ins)) return ins.flatMap(stepsOf);
  if (typeof ins === 'object') {
    if (ins.itemListElement) return stepsOf(ins.itemListElement);
    return [text(ins.text || ins.name || '')].filter(Boolean);
  }
  return [];
}
// HTML einer Rezeptseite → Felder für das Formular (nichts wird gespeichert)
function fromJsonLd(html, url = '') {
  const blocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  let r = null;
  for (const b of blocks) {
    try { r = findRecipe(JSON.parse(b.trim())); } catch { r = null; }
    if (r) break;
  }
  if (!r) return null;
  const yieldNum = v => { const m = /(\d+)/.exec(Array.isArray(v) ? v.join(' ') : String(v || '')); return m ? Number(m[1]) : 4; };
  const kw = Array.isArray(r.keywords) ? r.keywords : String(r.keywords || '').split(',');
  const cats = [].concat(r.recipeCategory || [], r.recipeCuisine || []);
  return {
    title: text(r.name).slice(0, 140), summary: text(r.description).slice(0, 280), servings: Math.min(100, yieldNum(r.recipeYield)),
    prep_min: isoMinutes(r.prepTime), cook_min: isoMinutes(r.cookTime) || (isoMinutes(r.totalTime) && !isoMinutes(r.prepTime) ? isoMinutes(r.totalTime) : null),
    ingredients_text: [].concat(r.recipeIngredient || r.ingredients || []).map(text).filter(Boolean).join('\n'),
    steps_text: stepsOf(r.recipeInstructions).join('\n'), tags: [...cats, ...kw].map(text).filter(Boolean).slice(0, 8).join(', '), source_url: url,
  };
}
async function importUrl(raw) {
  const lr = require('./linkreq');
  let url = await lr.checkUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (Rezeptbuch)', Accept: 'text/html' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = await lr.checkUrl(new URL(res.headers.get('location'), url).href); continue; }
    if (!res.ok) throw new Error(`Die Seite antwortet nicht (${res.status}).`);
    const reader = res.body.getReader(), chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3 * 1024 * 1024) { reader.cancel(); break; }
      chunks.push(value);
    }
    const r = fromJsonLd(Buffer.concat(chunks).toString('utf8'), url);
    if (!r) throw new Error('Auf dieser Seite steht kein Rezept, das sich übernehmen lässt.');
    return r;
  }
  throw new Error('Zu viele Weiterleitungen.');
}

module.exports = {
  TAG_IDEAS, parseLine, parseIngredients, ingredientText, ingredientsText, parseSteps, fmtAmount, stepHtml, canWrite, canSee, canEdit, canDelete,
  bySlug, byId, hydrate, visible, view, stats, recent, search, isFav, toggleFav, create, update, remove,
  addToShopping, addItem, shopping, setDone, clearDone, clearAll, shoppingCount, fromJsonLd, importUrl, isoMinutes,
};
