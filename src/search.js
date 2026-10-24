'use strict';
// Suche in der Taskleiste (Strg+K) und im Fenster „Suchen“. Findet nur, was der Suchende auch öffnen darf, mit denselben
// Regeln wie die Seiten selbst. Gesucht wird direkt in den Tabellen, also immer auf dem neuesten Stand.
// Suchbegriffe werden weder gespeichert noch protokolliert.
const { db, getSetting } = require('./db');
const auth = require('./auth');
const paint = require('./paint');
const programs = require('./programs');
const desk = require('./desk');
const { displayName, profileUrl } = require('./profiles');

// Groß/klein und Akzente egal: „Über“ findet „uber“ und „ÜBER“
const fold = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
db.function('fold', { deterministic: true }, s => (s == null ? null : fold(s)));

const GROUPS = {
  programme: '🪟 Programme', eigene: '🗂️ Eigene Dateien', forum: '💬 Forum', blog: '📝 Blog', seiten: '📄 Seiten',
  downloads: '📁 Downloads', mods: '🧩 Modlisten', galerie: '🖼️ Galerie', nutzer: '👥 Mitglieder',
};

// Kurzer Auszug rund um den Treffer
function snippet(text, q) {
  const t = String(text || '').replace(/[#*_`>\[\]()!|~-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const i = fold(t).indexOf(q);
  if (i < 0) return t.slice(0, 90);
  const from = Math.max(0, i - 30);
  return (from ? '…' : '') + t.slice(from, from + 90) + (from + 90 < t.length ? '…' : '');
}

// locals: res.locals der Seite (für Startmenü-Programme und abgeschaltete Bereiche)
function search(user, locals, query, perGroup = 3) {
  const q = fold(query).replace(/\s+/g, ' ').trim().slice(0, 100);
  if (q.length < 2) return { q, groups: [] };
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const L = ' LIKE ? ESCAPE \'\\\'';
  const lim = perGroup + 1;  // eins mehr, dann weiß die Liste, dass es weitere gibt
  const out = {};
  const put = (g, rows) => { if (rows.length) out[g] = rows; };

  put('programme', programs.list(locals).filter(p => fold(p.name).includes(q) || (q.length > 3 && fold(p.key).includes(q))).slice(0, lim)
    .map(p => ({ icon: p.icon, name: p.name, sub: p.group || 'Programm', url: p.url })));

  if (user) {
    const mine = db.prepare(`SELECT * FROM desk_items WHERE user_id = ? AND deleted_at IS NULL AND (fold(name)${L} OR (kind = 'text' AND fold(body)${L}) OR (kind = 'link' AND fold(target)${L}))
                             ORDER BY updated_at DESC LIMIT ?`).all(user.id, like, like, like, lim * 2)
      .filter(it => !desk.trashed(it)).map(it => {
        const e = desk.deskEntry(it, user);
        return { icon: e.icon, name: e.name, sub: it.kind === 'text' ? snippet(it.body, q) : it.kind === 'link' ? e.host : it.kind === 'folder' ? 'Ordner' : 'Verknüpfung', url: e.url, external: e.external };
      });
    const libs = [['datei', 'title', 'original_name'], ['titel', 'title', 'artist'], ['playlist', 'title', 'title'], ['bild', 'title', 'title'], ['quiz', 'title', 'title'], ['medien', 'original_name', 'original_name']];
    for (const [kind, a, b] of libs) {
      const Lb = desk.LIB[kind];
      for (const r of db.prepare(`SELECT * FROM ${Lb.table} WHERE ${Lb.owner} = ? AND (fold(${a})${L} OR fold(${b})${L}) ORDER BY ${Lb.date} DESC LIMIT ?`).all(user.id, like, like, lim)) {
        const e = desk.libEntry(kind, r, null);
        mine.push({ icon: e.icon, name: e.name, sub: Lb.label, url: e.url });
      }
    }
    put('eigene', mine.slice(0, lim));
  }

  const boardOpen = getSetting('board_enabled') === '1' && (getSetting('board_members_only') !== '1' || !!user) && !locals.navHidden.includes('board');
  if (boardOpen) {
    const topics = db.prepare(`SELECT t.id, t.title, NULL AS body FROM board_topics t WHERE fold(t.title)${L}
                               UNION ALL SELECT p.topic_id, t.title, p.body_md FROM board_posts p JOIN board_topics t ON t.id = p.topic_id WHERE fold(p.body_md)${L}
                               LIMIT 200`).all(like, like);
    const seen = new Set(), rows = [];
    for (const t of topics) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      rows.push({ icon: '💬', name: t.title, sub: t.body ? snippet(t.body, q) : 'Thema im Forum', url: '/forum/t/' + t.id });
      if (rows.length >= lim) break;
    }
    put('forum', rows);
  }

  const pv = auth.visibilitySql(user, 'post', 'p');
  if (!locals.navHidden.includes('blog')) {
    put('blog', db.prepare(`SELECT slug, title, summary, body_md FROM posts p WHERE published = 1 AND ${pv.sql} AND (fold(title)${L} OR fold(summary)${L} OR fold(body_md)${L})
                            ORDER BY created_at DESC LIMIT ?`).all(...pv.params, like, like, like, lim)
      .map(p => ({ icon: '📝', name: p.title, sub: snippet(p.summary || p.body_md, q), url: '/blog/' + p.slug })));
  }
  const gv = auth.visibilitySql(user, 'page', 'p');
  put('seiten', db.prepare(`SELECT slug, title, body_md FROM pages p WHERE ${gv.sql} AND (fold(title)${L} OR fold(body_md)${L}) ORDER BY title LIMIT ?`)
    .all(...gv.params, like, like, lim).map(p => ({ icon: '📄', name: p.title, sub: snippet(p.body_md, q), url: '/p/' + p.slug })));

  if (!locals.navHidden.includes('files')) {
    const fv = auth.visibilitySql(user, 'file', 'f');
    put('downloads', db.prepare(`SELECT * FROM files f WHERE ${fv.sql} AND (fold(title)${L} OR fold(description)${L} OR fold(original_name)${L} OR fold(game)${L})
                                 ORDER BY created_at DESC LIMIT ?`).all(...fv.params, like, like, like, like, lim)
      .map(f => ({ icon: desk.fileIcon(f.mime, f.original_name), name: f.title, sub: [f.category, f.game].filter(Boolean).join(' · '), url: '/ansehen/datei/' + f.id })));
  }
  if (!locals.navHidden.includes('mods')) {
    const mv = auth.visibilitySql(user, 'modlist', 'm');
    put('mods', db.prepare(`SELECT slug, title, game FROM modlists m WHERE ${mv.sql} AND (fold(title)${L} OR fold(game)${L}) ORDER BY updated_at DESC LIMIT ?`)
      .all(...mv.params, like, like, lim).map(m => ({ icon: '🧩', name: m.title, sub: m.game, url: '/mods/' + m.slug })));
  }
  if (paint.galleryOn() && !locals.navHidden.includes('galerie')) {
    const av = paint.visibleSql(user);
    put('galerie', db.prepare(`SELECT a.id, a.title, a.updated_at, u.username, u.display_name FROM artworks a JOIN users u ON u.id = a.owner_id
                               WHERE ${av.sql} AND a.draft = 0 AND a.visibility != 'private' AND u.disabled = 0 AND fold(a.title)${L} ORDER BY a.updated_at DESC LIMIT ?`)
      .all(...av.params, like, lim).map(a => ({ icon: '🖼️', name: a.title, sub: 'von ' + displayName(a), url: '/galerie/' + a.id, thumb: `/paint/bild/${a.id}/vorschau.png?v=${a.updated_at}` })));
  }
  if (!locals.navHidden.includes('nutzer')) {
    // Gäste finden nur Profile, die für alle sichtbar sind (wie unter Mitglieder)
    put('nutzer', db.prepare(`SELECT username, display_name, avatar FROM users u WHERE disabled = 0 ${user ? '' : "AND profile_visibility = 'public'"}
                              AND (fold(username)${L} OR fold(display_name)${L}) ORDER BY COALESCE(display_name, username) COLLATE NOCASE LIMIT ?`)
      .all(like, like, lim).map(u => ({ icon: '👤', name: displayName(u), sub: '@' + u.username, url: profileUrl(u.username), avatar: u.avatar ? '/avatar/' + u.avatar : null })));
  }

  const groups = Object.keys(GROUPS).filter(g => out[g]).map(g => ({ key: g, label: GROUPS[g], more: out[g].length > perGroup, items: out[g].slice(0, perGroup) }));
  return { q, groups };
}

module.exports = { search, fold, GROUPS };
