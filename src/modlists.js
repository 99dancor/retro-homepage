'use strict';
// Modlisten: jedes Mitglied legt Listen an (Titel, Spiel, kurze Beschreibung) und füllt sie zeilenweise mit Mods
// (Name, Link, Bemerkung, Haken „läuft auf dem Server“), sortiert nach Kategorien. Darunter stehen Vorschläge,
// die je nach Einstellung der Liste jeder eintragen und ändern darf, auch Gäste. Jede Änderung an den Vorschlägen
// landet im Verlauf mit dem Stand davor, damit der Besitzer zurückdrehen kann.
const { db, now, tx } = require('./db');
const auth = require('./auth');
const notify = require('./notify');
const { slugify, safeUrl } = require('./util');

const MAX = { title: 120, game: 60, desc: 600, category: 60, name: 120, url: 500, notes: 300, guest: 32 };
const MAX_ITEMS = 500;
const MAX_CATEGORIES = 40;
const MAX_SUGGESTIONS = 200;
const KEEP_LOG = 50;                 // so viele Einträge bleiben im Verlauf jeder Liste
const VIS = ['public', 'members', 'friends', 'private'];
const VIS_LABEL = { public: 'Alle', members: 'Angemeldete', friends: 'Nur Freunde', private: 'Nur ich', groups: 'Gruppen (Admin)' };
const SUGGESTIONS = { all: 'Alle, auch Gäste', members: 'Nur Angemeldete', off: 'Aus' };

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

function bySlug(slug) { return db.prepare('SELECT * FROM modlists WHERE slug = ?').get(String(slug)); }
function canEdit(user, list) { return !!user && (user.isAdmin || (!!list.owner_id && list.owner_id === user.id)); }
function canSuggest(user, list) { return list.suggestions === 'all' || (list.suggestions === 'members' && !!user); }

// Domain hinter dem Link, klein und grau in der Ansicht („wohin führt das?“)
function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Zeilen einer Liste nach Kategorien, in der gespeicherten Reihenfolge
function categories(listId) {
  const out = [];
  for (const r of db.prepare('SELECT * FROM mod_items WHERE modlist_id = ? ORDER BY position, id').all(listId)) {
    let c = out[out.length - 1];
    if (!c || c.name !== r.category) out.push(c = { name: r.category, rows: [] });
    c.rows.push({ id: r.id, name: r.name, url: r.url || '', notes: r.notes || '', on_server: !!r.on_server, domain: domain(r.url) });
  }
  return out;
}

function suggestions(listId) {
  return db.prepare('SELECT s.*, u.username FROM mod_suggestions s LEFT JOIN users u ON u.id = s.author_id WHERE s.modlist_id = ? ORDER BY s.position, s.id').all(listId)
    .map(s => ({ id: s.id, name: s.name, url: s.url || '', notes: s.notes || '', author_name: s.author_name, username: s.username, guest: !!s.guest, domain: domain(s.url) }));
}

function log(listId, limit = KEEP_LOG) {
  return db.prepare('SELECT id, actor_id, actor_name, guest, summary, created_at FROM mod_suggestion_log WHERE modlist_id = ? ORDER BY id DESC LIMIT ?').all(listId, limit);
}

// Alle sichtbaren Listen nach Spiel, mit Zahlen für die Übersicht
function overview(user) {
  const v = auth.visibilitySql(user, 'modlist', 'm');
  const lists = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM mod_items i WHERE i.modlist_id = m.id) AS n,
      (SELECT COUNT(*) FROM mod_items i WHERE i.modlist_id = m.id AND i.on_server = 1) AS on_server,
      (SELECT COUNT(*) FROM mod_suggestions s WHERE s.modlist_id = m.id) AS sugg
    FROM modlists m WHERE ${v.sql} ORDER BY m.game COLLATE NOCASE, m.title COLLATE NOCASE`).all(...v.params);
  const games = [];
  for (const l of lists) {
    let g = games[games.length - 1];
    if (!g || g.name.toLowerCase() !== l.game.toLowerCase()) games.push(g = { name: l.game, lists: [] });
    g.lists.push(l);
  }
  return games;
}
function gameNames() {
  return db.prepare('SELECT DISTINCT game FROM modlists ORDER BY game COLLATE NOCASE').all().map(r => r.game);
}

function parseJson(text) {
  try { const v = JSON.parse(String(text || '')); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

// Formulardaten des Editors (public/mods.js) prüfen: { categories: [{ name, rows: [{ name, url, notes, on_server }] }] }
function cleanCategories(data) {
  const out = [];
  let count = 0;
  for (const c of Array.isArray(data && data.categories) ? data.categories : []) {
    if (out.length >= MAX_CATEGORIES) break;
    const rows = [];
    for (const r of Array.isArray(c && c.rows) ? c.rows : []) {
      const name = str(r && r.name, MAX.name);
      if (!name || count >= MAX_ITEMS) continue;
      rows.push({ name, url: safeUrl(str(r.url, MAX.url)), notes: str(r.notes, MAX.notes), on_server: r.on_server ? 1 : 0 });
      count++;
    }
    if (rows.length) out.push({ name: str(c.name, MAX.category), rows });
  }
  // Gleich benannte Kategorien zusammenlegen, sonst zerfiele die Liste beim Lesen in mehrere Blöcke
  const merged = [];
  for (const c of out) {
    const same = merged.find(m => m.name.toLowerCase() === c.name.toLowerCase());
    if (same) same.rows.push(...c.rows); else merged.push(c);
  }
  return merged;
}

function uniqueSlug(wanted, id) {
  const base = slugify(wanted);
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM modlists WHERE slug = ? AND id != ?').get(slug, id || 0) || slug === 'neu'; i++) slug = `${base}-${i}`;
  return slug;
}

// Liste anlegen (list = null) oder ändern. Die Zeilen werden komplett neu geschrieben.
function save(list, user, body) {
  const title = str(body.title, MAX.title) || 'Modliste';
  const game = str(body.game, MAX.game) || 'Sonstiges';
  const desc = str(body.description, MAX.desc);
  const cur = list ? list.visibility : 'public';
  let visibility = VIS.includes(body.visibility) ? body.visibility : cur;
  if (body.visibility === 'groups' && cur === 'groups') visibility = 'groups';   // Gruppen vergibt nur der Admin in der Seitenverwaltung
  const sugg = Object.hasOwn(SUGGESTIONS, body.suggestions) ? body.suggestions : (list ? list.suggestions : 'all');
  const cats = cleanCategories(parseJson(body.data));
  return tx(() => {
    let id = list && list.id;
    const t = now();
    if (id) {
      db.prepare('UPDATE modlists SET game = ?, title = ?, description_md = ?, visibility = ?, suggestions = ?, updated_at = ? WHERE id = ?')
        .run(game, title, desc, visibility, sugg, t, id);
    } else {
      id = Number(db.prepare(`INSERT INTO modlists(slug, game, title, description_md, visibility, suggestions, owner_id, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uniqueSlug(`${game}-${title}`), game, title, desc, visibility, sugg, user.id, t, t).lastInsertRowid);
    }
    db.prepare('DELETE FROM mod_items WHERE modlist_id = ?').run(id);
    const ins = db.prepare('INSERT INTO mod_items(modlist_id, position, category, name, url, notes, on_server) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let pos = 0;
    for (const c of cats) for (const r of c.rows) ins.run(id, pos++, c.name, r.name, r.url || null, r.notes || null, r.on_server);
    if (visibility !== 'groups') auth.setAcl('modlist', id, []);
    return db.prepare('SELECT * FROM modlists WHERE id = ?').get(id);
  });
}

function remove(list) {
  db.prepare('DELETE FROM modlists WHERE id = ?').run(list.id);
  db.prepare("DELETE FROM acl WHERE item_type = 'modlist' AND item_id = ?").run(list.id);
}

const snapshot = listId => JSON.stringify(db.prepare('SELECT * FROM mod_suggestions WHERE modlist_id = ? ORDER BY position, id').all(listId));
function addLog(listId, actor, summary, before) {
  db.prepare('INSERT INTO mod_suggestion_log(modlist_id, actor_id, actor_name, guest, summary, before, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(listId, actor.id || null, actor.name, actor.guest ? 1 : 0, summary, before, now());
  db.prepare('DELETE FROM mod_suggestion_log WHERE modlist_id = ? AND id NOT IN (SELECT id FROM mod_suggestion_log WHERE modlist_id = ? ORDER BY id DESC LIMIT ?)')
    .run(listId, listId, KEEP_LOG);
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function summarize({ added, changed, removed }) {
  return [added && plural(added, 'neu', 'neu'), changed && plural(changed, 'geändert', 'geändert'), removed && plural(removed, 'entfernt', 'entfernt')].filter(Boolean).join(', ');
}

// Vorschläge speichern: { known: [ids beim Laden], rows: [{ id?, name, url, notes }] }.
// Was beim Laden da war und jetzt fehlt, ist gelöscht. Was jemand anderes inzwischen eingetragen hat, bleibt stehen.
// actor: { id, name, guest }
function saveSuggestions(list, actor, data) {
  const known = new Set((Array.isArray(data && data.known) ? data.known : []).map(Number).filter(Boolean));
  const rows = (Array.isArray(data && data.rows) ? data.rows : []).slice(0, MAX_SUGGESTIONS).map(r => ({
    id: Number(r && r.id) || 0, name: str(r && r.name, MAX.name), url: safeUrl(str(r && r.url, MAX.url)), notes: str(r && r.notes, MAX.notes),
  }));
  return tx(() => {
    const before = snapshot(list.id);
    const current = new Map(db.prepare('SELECT * FROM mod_suggestions WHERE modlist_id = ?').all(list.id).map(s => [s.id, s]));
    const keep = new Set(rows.filter(r => r.id && r.name).map(r => r.id));
    const res = { added: 0, changed: 0, removed: 0, names: [] };
    for (const id of known) {
      if (current.has(id) && !keep.has(id)) { db.prepare('DELETE FROM mod_suggestions WHERE id = ?').run(id); current.delete(id); res.removed++; }
    }
    const t = now();
    // Was es schon gab, behält seinen Platz, Neues kommt hinten dran (auch hinter das, was andere inzwischen eingetragen haben)
    const fresh = [];
    for (const r of rows) {
      if (!r.name) continue;
      const old = r.id && current.get(r.id);
      if (old) {
        if (old.name !== r.name || (old.url || '') !== r.url || (old.notes || '') !== r.notes) {
          db.prepare('UPDATE mod_suggestions SET name = ?, url = ?, notes = ?, updated_at = ? WHERE id = ?').run(r.name, r.url || null, r.notes || null, t, old.id);
          res.changed++;
        }
      } else if (!r.id) {
        if (current.size + res.added >= MAX_SUGGESTIONS) continue;
        fresh.push(Number(db.prepare(`INSERT INTO mod_suggestions(modlist_id, position, name, url, notes, author_id, author_name, guest, created_at, updated_at)
                                      VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`).run(list.id, r.name, r.url || null, r.notes || null, actor.id || null, actor.name, actor.guest ? 1 : 0, t, t).lastInsertRowid));
        res.added++;
        res.names.push(r.name);
      }
    }
    const kept = [...current.values()].sort((a, b) => a.position - b.position || a.id - b.id).map(s => s.id);
    const upd = db.prepare('UPDATE mod_suggestions SET position = ? WHERE id = ?');
    [...kept, ...fresh].forEach((id, i) => upd.run(i, id));
    if (res.added || res.changed || res.removed) {
      addLog(list.id, actor, summarize(res), before);
      db.prepare('UPDATE modlists SET updated_at = ? WHERE id = ?').run(t, list.id);
    }
    return res;
  });
}

// Den Stand vor einer Änderung wiederherstellen (das Zurückdrehen landet selbst im Verlauf)
function restore(list, logId, actor) {
  const entry = db.prepare('SELECT * FROM mod_suggestion_log WHERE id = ? AND modlist_id = ?').get(Number(logId), list.id);
  if (!entry) return false;
  let rows;
  try { rows = JSON.parse(entry.before); } catch { return false; }
  tx(() => {
    const before = snapshot(list.id);
    db.prepare('DELETE FROM mod_suggestions WHERE modlist_id = ?').run(list.id);
    const ins = db.prepare(`INSERT INTO mod_suggestions(modlist_id, position, name, url, notes, author_id, author_name, guest, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) {
      const author = r.author_id && db.prepare('SELECT 1 FROM users WHERE id = ?').get(r.author_id) ? r.author_id : null;
      ins.run(list.id, r.position, r.name, r.url, r.notes, author, r.author_name, r.guest, r.created_at, r.updated_at);
    }
    addLog(list.id, actor, 'Stand vom ' + new Date(entry.created_at * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Berlin' }) + ' wiederhergestellt', before);
  });
  return true;
}

// Vorschlag in die Liste übernehmen: hinten an die gewählte Kategorie, „Vorschlag von …“ in die Bemerkung
function take(list, suggestionId, category, actor) {
  const s = db.prepare('SELECT * FROM mod_suggestions WHERE id = ? AND modlist_id = ?').get(Number(suggestionId), list.id);
  if (!s) return null;
  category = str(category, MAX.category);
  return tx(() => {
    const before = snapshot(list.id);
    const items = db.prepare('SELECT id, category FROM mod_items WHERE modlist_id = ? ORDER BY position, id').all(list.id);
    if (items.length >= MAX_ITEMS) return null;
    let at = items.length;
    for (let i = items.length - 1; i >= 0; i--) if (items[i].category.toLowerCase() === category.toLowerCase()) { at = i + 1; category = items[i].category; break; }
    const note = [s.notes, `Vorschlag von ${s.author_name}`].filter(Boolean).join(' · ').slice(0, MAX.notes);
    const upd = db.prepare('UPDATE mod_items SET position = ? WHERE id = ?');
    items.forEach((it, i) => upd.run(i < at ? i : i + 1, it.id));
    db.prepare('INSERT INTO mod_items(modlist_id, position, category, name, url, notes, on_server) VALUES (?, ?, ?, ?, ?, ?, 0)').run(list.id, at, category, s.name, s.url, note);
    db.prepare('DELETE FROM mod_suggestions WHERE id = ?').run(s.id);
    addLog(list.id, actor, `„${s.name}“ in die Liste übernommen`, before);
    db.prepare('UPDATE modlists SET updated_at = ? WHERE id = ?').run(now(), list.id);
    return s;
  });
}

// Konto gelöscht: an Vorschlägen, im Verlauf und in den dort gemerkten Ständen bleibt kein Name stehen
function forgetUser(userId) {
  db.prepare("UPDATE mod_suggestions SET author_name = 'gelöschtes Konto' WHERE author_id = ?").run(userId);
  db.prepare("UPDATE mod_suggestion_log SET actor_name = 'gelöschtes Konto' WHERE actor_id = ?").run(userId);
  const upd = db.prepare('UPDATE mod_suggestion_log SET before = ? WHERE id = ?');
  for (const e of db.prepare("SELECT id, before FROM mod_suggestion_log WHERE before LIKE ?").all(`%"author_id":${Number(userId)},%`)) {
    let rows;
    try { rows = JSON.parse(e.before); } catch { continue; }
    upd.run(JSON.stringify(rows.map(r => (r.author_id === userId ? { ...r, author_id: null, author_name: 'gelöschtes Konto' } : r))), e.id);
  }
}

// Neue Vorschläge melden: dem Besitzer, bei Listen des Admins den Admins
function announce(list, actor, names) {
  if (!names.length) return;
  const to = list.owner_id ? [list.owner_id] : db.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled = 0").all().map(r => r.id);
  const what = names.length === 1 ? `„${names[0]}“` : `${names.length} Mods`;
  for (const id of to) {
    if (id === actor.id) continue;
    notify.send(id, 'modliste', { key: 'modliste:' + list.id, title: `💡 Neuer Vorschlag für „${list.title}“`, body: `${actor.name}${actor.guest ? ' (Gast)' : ''} schlägt ${what} vor.`, url: `/mods/${list.slug}#vorschlaege` });
  }
}

module.exports = {
  MAX, VIS, VIS_LABEL, SUGGESTIONS, bySlug, canEdit, canSuggest, categories, suggestions, log, overview, gameNames,
  save, remove, saveSuggestions, restore, take, announce, forgetUser, parseJson, cleanCategories,
};
