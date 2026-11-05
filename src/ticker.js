'use strict';
// Laufband oben über dem Desktop (Seitenverwaltung → Aussehen → Laufband). Es zeigt eigene Meldungen mit Zeitraum und
// automatische: das neueste Update, neue Blogbeiträge, Dienste (Spieler online, Ausfälle) und offene Lobbys.
// Jeder Besucher blendet es mit × aus (bis etwas Neues kommt oder ganz) oder stellt es unter 🖥️ → Effekte ein; das
// merkt sich nur sein Browser (public/laufband.js).
const { db, now, getSetting, setSetting } = require('./db');
const auth = require('./auth');

const STYLES = { led: 'LED-Anzeige (schwarz, grüne Schrift)', bar: 'Leiste im Fensterstil', eil: 'Eilmeldung (rot)' };
const AUTO = { update: '🆕 Neuestes Update (14 Tage lang)', posts: '📝 Neue Blogbeiträge (7 Tage lang)', services: '🗄️ Dienste: Spieler online und Ausfälle', lobbies: '🎲 Offene Lobbys (nur für Mitglieder)' };
const AUDIENCE = { all: 'Alle', guests: 'Nur Gäste', members: 'Nur Mitglieder' };

const auto = () => new Set(String(getSetting('ticker_auto', '') || '').split(',').filter(k => Object.hasOwn(AUTO, k)));
const fits = (aud, user) => aud === 'all' || (aud === 'guests' && !user) || (aud === 'members' && !!user);

function own() { return db.prepare('SELECT * FROM ticker_items ORDER BY position, id').all(); }
function active(it, t = now()) { return it.enabled && (!it.starts_at || it.starts_at <= t) && (!it.ends_at || it.ends_at > t); }

// Meldungen für einen Besucher: [{ text, url }]. locals sind die res.locals der Seite (für Lobbys und Abschaltungen).
function items(user, locals = {}) {
  const out = [], t = now(), a = auto();
  for (const it of own()) if (active(it, t) && fits(it.audience, user)) out.push({ text: it.text, url: it.url || null });
  if (a.has('update')) {
    const u = require('./changelog').latest(), m = u && u.date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const at = m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000 : 0;
    if (u && (!at || t - at < 14 * 86400)) out.push({ text: `🆕 ${u.no != null ? 'Update ' + u.no + ': ' : 'Neu: '}${u.title}`, url: '/changelog' + (u.no != null ? '#update-' + u.no : '') });
  }
  if (a.has('posts') && !(locals.navHidden || []).includes('blog')) {
    const v = auth.visibilitySql(user, 'post', 'p');
    for (const p of db.prepare(`SELECT slug, title FROM posts p WHERE published = 1 AND created_at >= ? AND ${v.sql} ORDER BY created_at DESC LIMIT 3`).all(t - 7 * 86400, ...v.params)) {
      out.push({ text: '📝 Neuer Beitrag: ' + p.title, url: '/blog/' + p.slug });
    }
  }
  if (a.has('services')) {
    const services = require('./services');
    for (const s of services.forViewer(user, 'ticker')) {
      const full = services.get(s.id), i = full.info || {};
      if (s.state === 'down') out.push({ text: `🔴 ${s.name} ist ${services.since(s.since).replace(/^seit/, 'seit')} offline`, url: '/dienste' });
      else if (s.state === 'up' && ['minecraft', 'steam', 'fs25'].includes(full.kind)) out.push({ text: `🟢 ${s.name}: ${i.players || 0} von ${i.max || 0} Spielern online`, url: s.url || '/dienste' });
      else if (s.state === 'up' && full.kind === 'jellyfin' && i.watching) out.push({ text: `🎬 ${s.name}: ${s.text}`, url: s.url || '/dienste' });
    }
  }
  if (a.has('lobbies') && user) {
    const l = require('./lobbies').list(user);
    if (l.length) out.push({ text: `🎲 ${l.length === 1 ? 'Eine offene Lobby' : l.length + ' offene Lobbys'}: ${[...new Set(l.map(x => x.what))].slice(0, 4).join(', ')}`, url: null });
  }
  return out.map(x => ({ text: String(x.text).slice(0, 200), url: x.url }));
}
// Was der Desktop braucht: an/aus, Stil, Beschriftung, Meldungen
function forDesk(user, locals) {
  if (getSetting('ticker_on', '1') !== '1') return null;
  const list = items(user, locals);
  return list.length ? { style: Object.hasOwn(STYLES, getSetting('ticker_style')) ? getSetting('ticker_style') : 'led', label: getSetting('ticker_label', '') || '', items: list } : null;
}

// Datum aus dem Formular (YYYY-MM-DDTHH:MM in Ortszeit der Seite) → Sekunden
const when = v => require('./util').fromLocalInput(v);
function save(id, b) {
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return { error: 'Bitte einen Text eintragen.' };
  const url = String(b.url || '').trim().slice(0, 500);
  if (url && !/^(\/(?![/\\])|https?:\/\/)\S*$/i.test(url)) return { error: 'Der Link muss mit / (Seite hier) oder http(s):// beginnen.' };
  const vals = [text, url || null, when(b.starts_at), when(b.ends_at), Object.hasOwn(AUDIENCE, b.audience) ? b.audience : 'all', b.enabled === '0' ? 0 : 1];
  if (id) db.prepare('UPDATE ticker_items SET text=?, url=?, starts_at=?, ends_at=?, audience=?, enabled=? WHERE id=?').run(...vals, Number(id));
  else db.prepare('INSERT INTO ticker_items(text, url, starts_at, ends_at, audience, enabled, position, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(...vals, (db.prepare('SELECT MAX(position) AS p FROM ticker_items').get().p || 0) + 1, now());
  return { ok: true };
}
function remove(id) { db.prepare('DELETE FROM ticker_items WHERE id = ?').run(Number(id)); }
function move(id, dir) {
  const list = own(), i = list.findIndex(x => x.id === Number(id)), j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const upd = db.prepare('UPDATE ticker_items SET position = ? WHERE id = ?');
  list.forEach((x, n) => upd.run(n + 1, x.id));
}

// Früher gab es einen Lauftext unter Design (theme_marquee): Er wird einmal zur ersten eigenen Meldung
function migrate() {
  if (getSetting('ticker_migrated') === '1') return;
  const old = String(getSetting('theme_marquee', '') || '').trim();
  if (old && !db.prepare('SELECT 1 FROM ticker_items LIMIT 1').get()) {
    db.prepare("INSERT INTO ticker_items(text, audience, enabled, position, created_at) VALUES (?, 'all', 1, 1, ?)").run(old.slice(0, 200), now());
  }
  setSetting('ticker_migrated', '1');
}

module.exports = { STYLES, AUTO, AUDIENCE, own, active, items, forDesk, save, remove, move, migrate, when };
