'use strict';
const path = require('node:path');
const express = require('express');
const { db, now, getSetting, setSetting, tx, UPLOAD_DIR, MEDIA_DIR, APPS_DIR } = require('../db');
const auth = require('../auth');
const analytics = require('../analytics');
const mail = require('../mail');
const up = require('../uploads');
const { slugify, safeUrl, asArray, visibilityFrom, mdBlocks } = require('../util');
const modlists = require('../modlists');
const GAMES = require('../games');
const profiles = require('../profiles');
const music = require('../music');
const paint = require('../paint');
const paintRoutes = require('./paint');
const paintLobby = require('../paintlobby');
const drafts = require('./drafts');
const desk = require('../desk');
const quota = require('../quota');
const programs = require('../programs');

const router = express.Router();
// UNO, Flip 7, Pilli Pilli (src/cardtable.js): Modul, Name, Schalter-Präfix
const CARD_GAMES = [['uno', 'UNO', 'uno'], ['flip7', 'Flip 7', 'f7'], ['pilli', 'Pilli Pilli', 'pp']];
router.use(auth.requireAdmin);

router.use((req, res, next) => {
  // Zahlen im Baum: was im Postfach wartet, Dienste offline, Vorschläge für Popup-Bilder (src/adminnav.js)
  const c = {
    unread: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0').get().n,
    pending: db.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE approved = 0').get().n,
    paint: db.prepare("SELECT COUNT(*) AS n FROM artworks WHERE visibility = 'public' AND approved = 0").get().n,
    popups: require('../popups').pendingCount(),
    down: require('../services').downCount(),
  };
  c.links = db.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE status IN ('new','checking','checked')").get().n;
  c.inbox = c.unread + c.pending + c.paint + c.popups;
  res.locals.counts = c;
  res.locals.adminNav = require('../adminnav');
  res.locals.allGroups = db.prepare('SELECT * FROM groups ORDER BY name').all();
  res.locals.flash = req.query.ok ? 'Gespeichert.' : null;
  next();
});

const multipartCsrf = auth.csrfCheck; // nach multer aufrufen, damit req.body gefüllt ist
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function uniqueSlug(table, wanted, id) {
  const base = slugify(wanted);
  let slug = base;
  // Apps teilen sich die Spielstand-Adressen mit den eingebauten Spielen
  const taken = s => db.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`).get(s, id || 0) || (table === 'apps' && Object.hasOwn(GAMES, s));
  for (let i = 2; taken(slug); i++) slug = `${base}-${i}`;
  return slug;
}
function saveVisibility(type, id, body) {
  auth.setAcl(type, id, body.visibility === 'groups' ? asArray(body.groups) : []);
}

// ---------- Statistik (System → Statistik; die Übersicht steht in src/routes/admin-areas.js) ----------
router.get('/statistik', (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const stats = analytics.stats(days);
  const fileTitles = new Map(db.prepare('SELECT id, title FROM files').all().map(f => [f.id, f.title]));
  stats.downloads = stats.downloads.map(d => ({ ...d, title: fileTitles.get(Number(d.path.split('/').pop())) || d.path }));
  res.render('admin/dashboard', {
    title: 'Statistik', stats, days, retention: getSetting('analytics_retention_days', '365'),
    totals: {
      posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
      files: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS size, COALESCE(SUM(downloads),0) AS dl FROM files').get(),
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      guestbook: db.prepare('SELECT COUNT(*) AS n FROM guestbook').get().n,
    },
  });
});

// ---------- Download-Statistik ----------
const periodOf = q => ([7, 30, 90, 365].includes(Number(q.days)) ? Number(q.days) : 30);
router.get('/downloads', (req, res) => {
  const days = periodOf(req.query);
  res.render('admin/downloads', { title: 'Download-Statistik', days, st: analytics.downloadStats(days), disk: up.diskSpace() });
});
router.get('/downloads/:id', (req, res, next) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!file) return next();
  const days = periodOf(req.query);
  res.render('admin/download-file', { title: 'Downloads: ' + file.title, days, file, st: analytics.downloadStats(days, file.id) });
});

// ---------- Blog ----------
router.get('/posts', (req, res) => res.render('admin/posts', { title: 'Blog-Beiträge', posts: db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all(), drafts: drafts.list(req.user.id, 'blog') }));
router.get('/posts/new', (req, res) => res.render('admin/post-edit', { title: 'Neuer Beitrag', post: { visibility: 'public', published: 1 }, acl: [] }));
router.get('/posts/:id', (req, res, next) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id));
  if (!post) return next();
  res.render('admin/post-edit', { title: 'Beitrag bearbeiten', post, acl: auth.getAcl('post', post.id) });
});
router.post('/posts/save', (req, res) => {
  const b = req.body;
  const id = Number(b.id) || 0;
  const title = str(b.title, 200) || 'Ohne Titel';
  const slug = uniqueSlug('posts', b.slug || title, id);
  const vals = [slug, title, str(b.summary, 500), String(b.body_md || ''), str(b.tags, 200).split(',').map(t => t.trim()).filter(Boolean).join(','), visibilityFrom(b), b.published ? 1 : 0];
  const created = b.created_at ? Math.floor(new Date(b.created_at).getTime() / 1000) || now() : now();
  const postId = tx(() => {
    let pid = id;
    if (id) db.prepare('UPDATE posts SET slug=?, title=?, summary=?, body_md=?, tags=?, visibility=?, published=?, created_at=?, updated_at=? WHERE id=?').run(...vals, created, now(), id);
    else pid = Number(db.prepare('INSERT INTO posts(slug, title, summary, body_md, tags, visibility, published, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(...vals, created, now()).lastInsertRowid);
    saveVisibility('post', pid, b);
    return pid;
  });
  drafts.consume(req);
  res.redirect(`/admin/posts/${postId}?ok=1`);
});
router.post('/posts/:id/delete', (req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(Number(req.params.id));
  db.prepare("DELETE FROM acl WHERE item_type = 'post' AND item_id = ?").run(Number(req.params.id));
  res.redirect('/admin/posts');
});
router.post('/preview', (req, res) => res.type('html').send(mdBlocks(String(req.body.md || ''))));

// ---------- Bilder / Medien ----------
router.get('/media', (req, res) => res.render('admin/media', { title: 'Bilder', media: db.prepare('SELECT * FROM media ORDER BY created_at DESC').all() }));
router.get('/media.json', (req, res) => res.json(db.prepare('SELECT stored_name, original_name FROM media ORDER BY created_at DESC LIMIT 200').all()
  .map(m => ({ url: '/media/' + m.stored_name, name: m.original_name }))));
router.post('/media', up.mediaUpload.array('images'), multipartCsrf, (req, res) => {
  const saved = up.saveMedia(req.files, req.user.id);
  if (req.get('accept') === 'application/json') return res.json(saved);
  res.redirect('/admin/media?ok=1');
});
router.post('/media/:id/delete', (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(req.params.id));
  if (m) { up.removeQuietly(path.join(MEDIA_DIR, m.stored_name)); db.prepare('DELETE FROM media WHERE id = ?').run(m.id); }
  res.redirect('/admin/media');
});

// ---------- Dateien ----------
// Link-Vorschläge, Warteschlange und Regeln für JDownloader: src/routes/admin-linkreq.js
router.use('/files', require('./admin-linkreq'));
router.get('/files', (req, res) => res.render('admin/files', {
  title: 'Dateien', maxMb: up.MAX_MB, imports: up.listImports(), disk: up.diskSpace(), importMsg: req.query.imported || null,
  files: db.prepare('SELECT f.*, u.username FROM files f LEFT JOIN users u ON u.id = f.uploader_id ORDER BY created_at DESC').all(),
  categories: require('../filecats').list().map(c => c.name),
}));
// Kategorien der Downloads: feste Liste mit Symbol, Endungen (für den Vorschlag beim Hochladen) und „Spiel“
router.get('/files/kategorien', (req, res) => {
  const cats = require('../filecats');
  const counts = Object.fromEntries(db.prepare('SELECT category, COUNT(*) AS n FROM files GROUP BY category').all().map(r => [r.category, r.n]));
  res.render('admin/file-cats', { title: 'Download-Kategorien', cats: cats.list(), counts, blocked: cats.blockedExt().join(' '), ok: req.query.ok });
});
router.post('/files/kategorien', (req, res) => {
  const cats = require('../filecats'), b = req.body;
  const names = asArray(b.name), olds = asArray(b.old), icons = asArray(b.icon), exts = asArray(b.ext), games = asArray(b.game).map(String), dels = asArray(b.del).map(String);
  const next = [];
  if (b.name !== undefined) names.forEach((n, i) => {
    const old = String(olds[i] || ''), name = String(n || '').trim();
    if (old && dels.includes(old)) return cats.remove(old);
    if (!name) return;
    if (old && old !== name) cats.rename(old, name);
    next.push({ name, icon: icons[i], ext: exts[i], game: games.includes(String(i)) });
  });
  if (b.name !== undefined) cats.save(next);
  if (b.blocked !== undefined) setSetting('upload_blocked_ext', cats.extList(b.blocked).join(' '));
  res.redirect('/admin/files/kategorien?ok=1');
});
router.post('/files/upload', up.fileUpload.array('files'), multipartCsrf, (req, res) => {
  const b = req.body;
  const ins = db.prepare(`INSERT INTO files(title, description, category, game, original_name, stored_name, size, mime, visibility, uploader_id, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  tx(() => {
    for (const f of req.files || []) {
      const title = (req.files.length === 1 && str(b.title, 200)) || f.originalname;
      const id = Number(ins.run(title, str(b.description, 2000), str(b.category, 100) || 'Allgemein', str(b.game, 100) || null,
        f.originalname, f.filename, f.size, f.mimetype, visibilityFrom(b), req.user.id, now()).lastInsertRowid);
      saveVisibility('file', id, b);
    }
  });
  res.redirect('/admin/files?ok=1');
});
// Große Dateien per Netzwerkfreigabe in uploads/eingang kopieren und hier übernehmen
router.post('/files/import', (req, res) => {
  const b = req.body;
  const ins = db.prepare(`INSERT INTO files(title, description, category, game, original_name, stored_name, size, mime, visibility, uploader_id, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  const errors = [];
  for (const name of asArray(b.names)) {
    try {
      const f = up.importFile(String(name));
      const id = Number(ins.run(f.original, str(b.description, 2000), str(b.category, 100) || 'Allgemein', str(b.game, 100) || null,
        f.original, f.stored, f.size, null, visibilityFrom(b), req.user.id, now()).lastInsertRowid);
      saveVisibility('file', id, b);
      n++;
    } catch (e) { errors.push(e.message); }
  }
  const msg = `${n} Datei(en) übernommen.` + (errors.length ? ' Fehler: ' + errors.join('; ') : '');
  res.redirect('/admin/files?imported=' + encodeURIComponent(msg));
});
router.get('/files/:id', (req, res, next) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!file) return next();
  const categories = require('../filecats').list().map(c => c.name);
  if (!categories.includes(file.category)) categories.push(file.category);
  res.render('admin/file-edit', { title: 'Datei bearbeiten', file, categories, acl: auth.getAcl('file', file.id), projects: require('../downloads').all() });
});
router.post('/files/:id', (req, res) => {
  const b = req.body, id = Number(req.params.id);
  db.prepare('UPDATE files SET title=?, description=?, category=?, game=?, visibility=? WHERE id=?')
    .run(str(b.title, 200) || 'Datei', str(b.description, 2000), str(b.category, 100) || 'Allgemein', str(b.game, 100) || null, visibilityFrom(b, true), id);
  saveVisibility('file', id, b);
  if (b.project_id !== undefined) require('../downloads').assign(id, Number(b.project_id) || null, b.version, b.changes);
  res.redirect(`/admin/files/${id}?ok=1`);
});
router.post('/files/:id/delete', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (f) {
    up.removeQuietly(path.join(UPLOAD_DIR, f.stored_name));
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    db.prepare("DELETE FROM acl WHERE item_type = 'file' AND item_id = ?").run(f.id);
  }
  res.redirect('/admin/files');
});

// ---------- Musik ----------
// Hier lädt der Admin seine Sammlung hoch und vergibt Sichtbarkeit (auch Gruppen) für alle Titel, auch die der Mitglieder.
router.get('/musik', (req, res) => res.render('admin/music', {
  title: 'Mediaplayer', quotaMb: getSetting('user_quota_mb', '2048'),
  tracks: db.prepare('SELECT t.*, u.username, u.role FROM tracks t LEFT JOIN users u ON u.id = t.uploader_id ORDER BY t.created_at DESC').all(),
  playlists: db.prepare('SELECT COUNT(*) AS n FROM playlists').get().n,
}));
router.post('/musik/upload', music.adminUpload.array('files'), multipartCsrf, (req, res) => {
  const b = req.body;
  const ins = db.prepare(`INSERT INTO tracks(title, artist, album, original_name, stored_name, size, mime, visibility, uploader_id, created_at, kind)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  tx(() => {
    for (const f of req.files || []) {
      const tags = music.readTags(f.path), guess = music.fromFilename(f.originalname);
      const id = Number(ins.run(tags.title || guess.title || f.originalname, str(b.artist, 200) || tags.artist || guess.artist || null, tags.album || null,
        f.originalname, f.filename, f.size, f.mimetype, visibilityFrom(b), req.user.id, now(), music.kindOf(f)).lastInsertRowid);
      saveVisibility('track', id, b);
    }
  });
  res.redirect('/admin/musik?ok=1');
});
router.get('/musik/:id', (req, res, next) => {
  const t = db.prepare('SELECT t.*, u.username FROM tracks t LEFT JOIN users u ON u.id = t.uploader_id WHERE t.id = ?').get(Number(req.params.id));
  if (!t) return next();
  res.render('admin/track-edit', { title: 'Titel bearbeiten', t, acl: auth.getAcl('track', t.id) });
});
router.post('/musik/:id', (req, res) => {
  const b = req.body, id = Number(req.params.id);
  db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ?, visibility = ? WHERE id = ?')
    .run(str(b.title, 200) || 'Titel', str(b.artist, 200) || null, str(b.album, 200) || null, visibilityFrom(b, true), id);
  saveVisibility('track', id, b);
  res.redirect(`/admin/musik/${id}?ok=1`);
});
router.post('/musik/:id/delete', (req, res) => {
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(req.params.id));
  if (t) music.deleteTrack(t);
  res.redirect('/admin/musik');
});

// ---------- Paint ----------
const PAINT_FLAGS = ['paint_enabled', 'paint_guests', 'paint_gallery', 'paint_moderation', 'paint_lobbies'];
router.get('/paint', (req, res) => {
  const s = Object.fromEntries([...PAINT_FLAGS, 'paint_save', 'paint_max_w', 'paint_max_h'].map(k => [k, getSetting(k, '')]));
  const stats = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT owner_id) AS users, COALESCE(SUM(size), 0) AS bytes,
                            COALESCE(SUM(visibility = 'public' AND approved = 0), 0) AS pending FROM artworks`).get();
  const lobbies = [...paintLobby._lobbies.values()].map(l => ({ ...paintLobby.state(l), owner: l.owner.name }));
  res.render('admin/paint', { title: 'Paint', s, stats, lobbies, artworks: paintRoutes.adminList(), ok: 'ok' in req.query });
});
router.post('/paint', (req, res) => {
  const b = req.body;
  for (const k of PAINT_FLAGS) setSetting(k, b[k] === '1' ? '1' : '0');
  setSetting('paint_save', ['members', 'upload', 'admin'].includes(b.paint_save) ? b.paint_save : 'members');
  const n = (v, d, min, max) => String(Math.max(min, Math.min(max, Math.round(Number(v)) || d)));
  setSetting('paint_max_w', n(b.paint_max_w, 2000, 16, 4000));
  setSetting('paint_max_h', n(b.paint_max_h, 2000, 16, 4000));
  res.redirect('/admin/paint?ok=1');
});
router.post('/paint/lobby/:id/schliessen', (req, res) => {
  const l = paintLobby.get(req.params.id);
  if (l) paintLobby.remove(l);
  res.redirect('/admin/paint?ok=1');
});
router.post('/paint/:id/freigeben', (req, res) => {
  db.prepare('UPDATE artworks SET approved = 1 WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/paint');
});
router.post('/paint/:id/loeschen', (req, res) => {
  paintRoutes.adminDelete(req.params.id);
  res.redirect('/admin/paint');
});

// ---------- Quiz ----------
router.get('/quiz', (req, res) => {
  const quiz = require('../quiz');
  const s = Object.fromEntries(['quiz_enabled', 'quiz_guests', 'quiz_hosts', 'quiz_max_rooms', 'quiz_max_players'].map(k => [k, getSetting(k, '')]));
  Object.assign(s, quiz.config(), { quiz_enabled: getSetting('quiz_enabled', '1'), quiz_guests: getSetting('quiz_guests', '1') });
  const rooms = [...quiz._rooms.values()].map(r => ({ code: r.code, name: r.name, host: r.hostName, players: r.players.size, phase: r.phase, cur: r.cur, created: r.created, hidden: r.hidden }));
  const games = db.prepare(`SELECT g.*, (SELECT name FROM quiz_results WHERE game_id = g.id AND place = 1 LIMIT 1) AS winner
                            FROM quiz_games g ORDER BY ended_at DESC LIMIT 30`).all();
  const total = db.prepare('SELECT COUNT(*) AS games, COALESCE(SUM(players), 0) AS players FROM quiz_games').get();
  res.render('admin/quiz', { title: 'Quiz', s, rooms, games, total, ok: 'ok' in req.query });
});
router.post('/quiz', (req, res) => {
  const b = req.body;
  setSetting('quiz_enabled', b.quiz_enabled === '1' ? '1' : '0');
  setSetting('quiz_guests', b.quiz_guests === '1' ? '1' : '0');
  setSetting('quiz_hosts', ['all', 'members', 'admin'].includes(b.quiz_hosts) ? b.quiz_hosts : 'all');
  const n = (v, d, min, max) => String(Math.max(min, Math.min(max, Math.round(Number(v)) || d)));
  setSetting('quiz_max_rooms', n(b.quiz_max_rooms, 20, 1, 200));
  setSetting('quiz_max_players', n(b.quiz_max_players, 30, 2, 200));
  res.redirect('/admin/quiz?ok=1');
});
router.post('/quiz/raum/:code/schliessen', (req, res) => {
  const quiz = require('../quiz');
  const r = quiz.get(req.params.code);
  if (r) quiz.remove(r, 'Der Admin hat den Raum geschlossen.');
  res.redirect('/admin/quiz?ok=1');
});
router.post('/quiz/spiel/:id/loeschen', (req, res) => {
  db.prepare('DELETE FROM quiz_games WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/quiz?ok=1');
});

// ---------- Werwolf ----------
router.get('/werwolf', (req, res) => {
  const ww = require('../werwolf');
  const s = Object.assign(ww.config(), { ww_enabled: getSetting('ww_enabled', '1'), ww_guests: getSetting('ww_guests', '1') });
  const rooms = [...ww._rooms.values()].map(r => ({ code: r.code, name: r.name, mode: r.mode, players: r.players.size, phase: r.phase, day: r.day, created: r.created, hidden: r.hidden }));
  const total = db.prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT user_id) AS members, COALESCE(SUM(won), 0) AS wins,
                            COALESCE(SUM(role = 'werwolf' AND won), 0) AS wolfWins FROM ww_results`).get();
  res.render('admin/werwolf', { title: 'Werwolf', s, rooms, total, ok: 'ok' in req.query });
});
router.post('/werwolf', (req, res) => {
  const b = req.body;
  setSetting('ww_enabled', b.ww_enabled === '1' ? '1' : '0');
  setSetting('ww_guests', b.ww_guests === '1' ? '1' : '0');
  const n = (v, d, min, max) => String(Math.max(min, Math.min(max, Math.round(Number(v)) || d)));
  setSetting('ww_max_rooms', n(b.ww_max_rooms, 20, 1, 200));
  setSetting('ww_max_players', n(b.ww_max_players, 20, 4, 40));
  res.redirect('/admin/werwolf?ok=1');
});
router.post('/werwolf/raum/:code/schliessen', (req, res) => {
  const ww = require('../werwolf');
  const r = ww.get(req.params.code);
  if (r) ww.remove(r, 'Der Admin hat den Raum geschlossen.');
  res.redirect('/admin/werwolf?ok=1');
});
router.post('/werwolf/statistik/loeschen', (req, res) => {
  db.prepare('DELETE FROM ww_results').run();
  res.redirect('/admin/werwolf?ok=1');
});

// ---------- Dancors Dreschplatz ----------
// Der Hub ist ein eigenes Paket (fs25hub) und hat seine Verwaltung dabei: /farming/verwaltung. Alte Lesezeichen leiten dorthin.
router.get(['/farming', '/farming/*rest'], (req, res) => res.redirect(301, '/farming/verwaltung'));

// ---------- Modlisten ----------
// Angelegt und bearbeitet werden Modlisten im Fenster selbst (src/routes/mods.js), hier nur die Übersicht aller Listen
router.get('/mods', (req, res) => res.render('admin/mods', {
  title: 'Modlisten',
  lists: db.prepare(`SELECT m.*, u.username AS owner, (SELECT COUNT(*) FROM mod_items i WHERE i.modlist_id = m.id) AS n,
                       (SELECT COUNT(*) FROM mod_suggestions s WHERE s.modlist_id = m.id) AS sugg
                     FROM modlists m LEFT JOIN users u ON u.id = m.owner_id ORDER BY game, title`).all(),
}));
router.get('/mods/new', (req, res) => res.redirect('/mods/neu'));
router.get('/mods/:id', (req, res, next) => {
  const list = db.prepare('SELECT slug FROM modlists WHERE id = ?').get(Number(req.params.id));
  if (!list) return next();
  res.redirect(`/mods/${list.slug}?bearbeiten`);
});
router.post('/mods/:id/delete', (req, res) => {
  db.prepare('DELETE FROM modlists WHERE id = ?').run(Number(req.params.id));
  db.prepare("DELETE FROM acl WHERE item_type = 'modlist' AND item_id = ?").run(Number(req.params.id));
  res.redirect('/admin/mods');
});

// ---------- Links ----------
router.get('/links', (req, res) => {
  const links = db.prepare('SELECT * FROM links ORDER BY category, position, title').all();
  const edit = req.query.edit ? db.prepare('SELECT * FROM links WHERE id = ?').get(Number(req.query.edit)) : null;
  res.render('admin/links', {
    title: 'Links', links, edit: edit || { visibility: 'public' }, acl: edit ? auth.getAcl('link', edit.id) : [],
    categories: [...new Set(links.map(l => l.category))],
  });
});
router.post('/links/save', (req, res) => {
  const b = req.body, id = Number(b.id) || 0;
  const url = safeUrl(b.url);
  if (!url) return res.redirect('/admin/links');
  const vals = [str(b.category, 100) || 'Allgemein', str(b.title, 200) || url, url, str(b.description, 1000), Number(b.position) || 0, visibilityFrom(b)];
  let lid = id;
  if (id) db.prepare('UPDATE links SET category=?, title=?, url=?, description=?, position=?, visibility=? WHERE id=?').run(...vals, id);
  else lid = Number(db.prepare('INSERT INTO links(category, title, url, description, position, visibility, created_at) VALUES (?,?,?,?,?,?,?)').run(...vals, now()).lastInsertRowid);
  saveVisibility('link', lid, b);
  res.redirect('/admin/links?ok=1');
});
router.post('/links/:id/delete', (req, res) => {
  db.prepare('DELETE FROM links WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/links');
});

// ---------- Besucherbuch ----------
router.get('/guestbook', (req, res) => res.render('admin/guestbook', {
  title: 'Besucherbuch',
  entries: db.prepare('SELECT g.*, u.username FROM guestbook g LEFT JOIN users u ON u.id = g.user_id ORDER BY approved, created_at DESC').all(),
}));
router.post('/guestbook/:id/:action', (req, res) => {
  const id = Number(req.params.id);
  if (req.params.action === 'approve') db.prepare('UPDATE guestbook SET approved = 1 WHERE id = ?').run(id);
  if (req.params.action === 'hide') db.prepare('UPDATE guestbook SET approved = 0 WHERE id = ?').run(id);
  if (req.params.action === 'delete') db.prepare('DELETE FROM guestbook WHERE id = ?').run(id);
  res.redirect('/admin/guestbook');
});

// ---------- Nachrichten ----------
router.get('/messages', (req, res) => res.render('admin/messages', { title: 'Nachrichten', messages: db.prepare('SELECT m.*, u.username FROM messages m LEFT JOIN users u ON u.id = m.user_id ORDER BY created_at DESC').all() }));
router.get('/messages/:id', (req, res, next) => {
  const m = db.prepare('SELECT m.*, u.username FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(Number(req.params.id));
  if (!m) return next();
  db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(m.id);
  res.render('admin/message', { title: m.subject || 'Nachricht', m });
});
router.post('/messages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/messages');
});
router.post('/messages/:id/unread', (req, res) => {
  db.prepare('UPDATE messages SET is_read = 0 WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/messages');
});

// ---------- Nutzer & Gruppen ----------
router.get('/users', (req, res) => res.render('admin/users', {
  title: 'Nutzer & Gruppen', err: req.query.err || null,
  users: db.prepare(`SELECT u.*, (SELECT GROUP_CONCAT(g.name, ', ') FROM user_groups ug JOIN groups g ON g.id = ug.group_id WHERE ug.user_id = u.id) AS group_names
                     FROM users u ORDER BY username`).all(),
  groups: db.prepare('SELECT g.*, (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.id) AS n FROM groups g ORDER BY name').all(),
}));
router.post('/users/create', (req, res) => {
  const { username, password } = req.body;
  if (!auth.validUsername(username)) return res.redirect('/admin/users?err=' + encodeURIComponent('Ungültiger Benutzername (3–32 Zeichen, A–Z, 0–9, _ . -)'));
  if (!auth.validPassword(password)) return res.redirect('/admin/users?err=' + encodeURIComponent('Passwort muss mindestens 8 Zeichen haben.'));
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.redirect('/admin/users?err=' + encodeURIComponent('Benutzername ist schon vergeben.'));
  const id = auth.createUser(username, password, req.body.role === 'admin' ? 'admin' : 'user');
  res.redirect(`/admin/users/${id}`);
});
router.get('/users/:id', (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return next();
  res.render('admin/user-edit', { title: 'Nutzer: ' + u.username, u, ks: require('../kasse').peek(u.id), bj: require('../blackjack').userTotals(u.id), pk: require('../poker').userTotals(u.id), dk: require('../durak').userTotals(u.id), cg: CARD_GAMES.map(([id, title]) => ({ id, title, t: require('../' + id).userTotals(u.id) })), ms: require('../minesweeper').userTotals(u.id), cw: require('../crossword').userTotals(u.id), sd: require('../sudoku').userTotals(u.id), userGroups: db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(u.id).map(r => r.group_id), err: req.query.err || null });
});
router.post('/users/:id', (req, res) => {
  const id = Number(req.params.id), b = req.body;
  const isSelf = id === req.user.id;
  if (b.password && !auth.validPassword(b.password)) return res.redirect(`/admin/users/${id}?err=` + encodeURIComponent('Passwort muss mindestens 8 Zeichen haben.'));
  tx(() => {
    db.prepare('UPDATE users SET role = ?, disabled = ?, can_upload = ?, can_private = ?, can_write = ?, jd_trusted = ? WHERE id = ?').run(
      isSelf ? 'admin' : (b.role === 'admin' ? 'admin' : 'user'), isSelf ? 0 : (b.disabled ? 1 : 0), b.can_upload ? 1 : 0, b.can_private ? 1 : 0, b.can_write ? 1 : 0, b.jd_trusted ? 1 : 0, id);
    if (b.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(b.password), id);
      if (!isSelf) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (b.disabled && !isSelf) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    // Moderation: unpassende Profilangaben zurücksetzen
    if (b.reset_name) db.prepare('UPDATE users SET display_name = NULL WHERE id = ?').run(id);
    if (b.reset_about) db.prepare('UPDATE users SET about = NULL WHERE id = ?').run(id);
    if (b.reset_avatar) {
      const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(id);
      if (old) profiles.removeAvatar(old.avatar);
      db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(id);
    }
    if (b.reset_kasse) require('../kasse').reset(id);
    if (b.reset_blackjack) require('../blackjack').resetStats(id);
    if (b.reset_poker) require('../poker').resetStats(id);
    if (b.reset_durak) require('../durak').resetStats(id);
    for (const [g] of CARD_GAMES) if (b['reset_' + g]) require('../' + g).resetStats(id);
    if (b.reset_minesweeper) require('../minesweeper').resetStats(id);
    if (b.reset_crossword) require('../crossword').resetStats(id);
    if (b.reset_sudoku) require('../sudoku').resetStats(id);
    db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_groups(user_id, group_id) VALUES (?, ?)');
    for (const g of asArray(b.groups)) ins.run(id, Number(g));
  });
  res.redirect(`/admin/users/${id}?ok=1`);
});
router.post('/users/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  // Statistik hat keinen Fremdschlüssel: Verbindung lösen, sonst erbte ein neues Konto mit derselben Nummer die Einträge
  // Freunde, Privatnachrichten und Spielstatistiken verschwinden über ihre Fremdschlüssel mit, das Profilbild hier
  const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(id);
  // Bilder aus Paint und Galerie verschwinden mit dem Konto (Fremdschlüssel), ihre Dateien hier
  const pictures = id !== req.user.id ? paint.filesOf(id) : [];
  const photos = id !== req.user.id ? require('../gallery').filesOf(id) : [];
  // Ein Jellyfin-Konto, das die Seite für dieses Mitglied angelegt hat, kommt mit weg (läuft im Hintergrund)
  if (id !== req.user.id) require('../jellyfin').forget(id).catch(() => {});
  if (id !== req.user.id) tx(() => {
    db.prepare('UPDATE pageviews SET user_id = NULL WHERE user_id = ?').run(id);
    db.prepare('UPDATE downloads SET user_id = NULL WHERE user_id = ?').run(id);
    // Quiz: eigene Ergebnisse fallen über den Fremdschlüssel weg, als Spielleiter bleibt nur „gelöschtes Konto“
    db.prepare("UPDATE quiz_games SET host_name = 'gelöschtes Konto' WHERE host_user_id = ?").run(id);
    // Modlisten des Kontos gehen an den Admin (owner_id fällt weg), an Vorschlägen und im Verlauf bleibt kein Name stehen
    modlists.forgetUser(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  if (old && id !== req.user.id) profiles.removeAvatar(old.avatar);
  paint.removeFiles(pictures);
  require('../gallery').removeFiles(photos);
  res.redirect('/admin/users');
});
router.post('/groups/create', (req, res) => {
  const name = str(req.body.name, 50);
  if (name && !db.prepare('SELECT 1 FROM groups WHERE name = ?').get(name)) db.prepare('INSERT INTO groups(name, description) VALUES (?, ?)').run(name, str(req.body.description, 200));
  res.redirect('/admin/users');
});
router.post('/groups/:id/delete', (req, res) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/users');
});

// ---------- Eigene Seiten ----------
router.get('/pages', (req, res) => res.render('admin/pages', { title: 'Eigene Seiten', pages: db.prepare('SELECT * FROM pages ORDER BY position, title').all() }));
router.get('/pages/new', (req, res) => res.render('admin/page-edit', { title: 'Neue Seite', page: { visibility: 'public', in_nav: 1, position: 0 }, acl: [] }));
router.get('/pages/:id', (req, res, next) => {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(Number(req.params.id));
  if (!page) return next();
  res.render('admin/page-edit', { title: 'Seite bearbeiten', page, acl: auth.getAcl('page', page.id) });
});
router.post('/pages/save', (req, res) => {
  const b = req.body, id = Number(b.id) || 0;
  const title = str(b.title, 200) || 'Seite';
  const slug = uniqueSlug('pages', b.slug || title, id);
  const vals = [slug, title, String(b.body_md || ''), visibilityFrom(b), b.in_nav ? 1 : 0, Number(b.position) || 0, now()];
  let pid = id;
  if (id) db.prepare('UPDATE pages SET slug=?, title=?, body_md=?, visibility=?, in_nav=?, position=?, updated_at=? WHERE id=?').run(...vals, id);
  else pid = Number(db.prepare('INSERT INTO pages(slug, title, body_md, visibility, in_nav, position, updated_at) VALUES (?,?,?,?,?,?,?)').run(...vals).lastInsertRowid);
  saveVisibility('page', pid, b);
  res.redirect(`/admin/pages/${pid}?ok=1`);
});
router.post('/pages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/pages');
});

// ---------- Spiele & Apps ----------
// Mitgebrachte Spiele verwaltet die Daddelecke (/spiele, src/routes/daddelecke.js) direkt auf ihrer Seite
router.get('/apps', (req, res) => res.redirect('/spiele'));
router.get('/apps/new', (req, res) => res.redirect('/spiele/neu'));
router.get('/apps/:id', (req, res, next) => {
  const a = db.prepare('SELECT slug FROM apps WHERE id = ?').get(Number(req.params.id));
  if (!a) return next();
  res.redirect(`/spiele/${a.slug}/bearbeiten`);
});

// ---------- DS-Spiele (src/ds.js) ----------
// Die ROM kommt in data/ds und geht nur an Mitglieder, die das Spiel sehen dürfen. Spielstände je Mitglied mit Sicherung.
const ds = require('../ds');
const dsInput = b => ({
  title: str(b.title, 80) || 'DS-Spiel',
  icon: str(b.icon, 8) || '🎮',
  visibility: Object.hasOwn(ds.VIS, b.visibility) ? b.visibility : 'members',
  inMenu: !!b.in_menu,
});
router.get('/ds', (req, res) => res.render('admin/ds', { title: 'DS-Spiele', games: ds.all(), coreReady: ds.coreReady(), region: ds.region }));
router.get('/ds/new', (req, res) => res.render('admin/ds-edit', { title: 'Neues DS-Spiel', g: { visibility: 'members', in_menu: 1, icon: '🎮' }, acl: [], saves: [], err: req.query.err || null, VIS: ds.VIS, region: ds.region }));
router.get('/ds/:id', (req, res, next) => {
  const g = ds.byId(req.params.id);
  if (!g) return next();
  res.render('admin/ds-edit', { title: g.title, g, acl: auth.getAcl('ds', g.id), saves: ds.savesOf(g.id), err: req.query.err || null, VIS: ds.VIS, region: ds.region });
});
router.post('/ds/save', up.zipUpload.single('rom'), multipartCsrf, async (req, res) => {
  const b = req.body, id = Number(b.id) || 0;
  const back = id ? `/admin/ds/${id}` : '/admin/ds/new';
  const bad = msg => { if (req.file) up.removeQuietly(req.file.path); res.redirect(back + '?err=' + encodeURIComponent(msg)); };
  if (!id && !req.file) return bad('Bitte wähle die ROM-Datei (.nds) aus.');
  let rom = null;
  if (req.file) {
    try { rom = await ds.storeRom(req.file.path, req.file.size); } catch (e) { return bad('Die ROM konnte nicht gespeichert werden: ' + e.message); }
    if (rom.error) return bad(rom.error);
  }
  const input = { ...dsInput(b), rom };
  const g = id ? ds.update(id, input) : ds.create(input);
  if (!g) return res.redirect('/admin/ds');
  auth.setAcl('ds', g.id, input.visibility === 'groups' ? asArray(b.groups) : []);
  res.redirect(`/admin/ds/${g.id}?ok=1`);
});
router.post('/ds/:id/delete', (req, res) => {
  ds.remove(req.params.id);
  res.redirect('/admin/ds');
});
// Spielstände eines Mitglieds: herunterladen, die vorige Fassung zurückholen, löschen
router.get('/ds/:id/spielstand/:uid', (req, res, next) => {
  const g = ds.byId(req.params.id), s = g && ds.getSave(Number(req.params.uid), g.id);
  if (!s) return next();
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(req.params.uid));
  res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.attachment(`${g.slug}-${(u && u.username) || req.params.uid}.sav`);
  res.send(Buffer.from(s.data));
});
router.post('/ds/:id/spielstand/:uid', (req, res) => {
  const g = ds.byId(req.params.id), uid = Number(req.params.uid);
  if (g && req.body.act === 'restore') ds.restorePrev(uid, g.id);
  if (g && req.body.act === 'delete') ds.deleteSave(uid, g.id);
  res.redirect(`/admin/ds/${req.params.id}?ok=1#spielstaende`);
});

// ---------- Design ----------
const THEME_KEYS = ['theme_bg_color', 'theme_bg_image', 'theme_bg_mode', 'theme_window_color', 'theme_title_from', 'theme_title_to',
  'theme_text_color', 'theme_link_color', 'theme_font', 'theme_custom_css'];
const { PRESETS: THEME_PRESETS, FONTS } = require('../themes');
// Grunddesign für alle, die unter 🖥️ nichts Eigenes gewählt haben (siehe public/display.js)
const THEME_DESIGNS = { 98: 'Windows 98', xp: 'Windows XP (Blau)', 'xp-oliv': 'Windows XP (Olivgrün)', 'xp-silber': 'Windows XP (Silber)' };
router.get('/design', (req, res) => {
  const s = Object.fromEntries([...THEME_KEYS, 'theme_show_counter', 'theme_design'].map(k => [k, getSetting(k, '')]));
  res.render('admin/design', { title: 'Design', s, designs: THEME_DESIGNS, presets: THEME_PRESETS, fonts: FONTS, media: db.prepare("SELECT * FROM media ORDER BY created_at DESC").all() });
});
router.post('/design', up.mediaUpload.single('bg_upload'), multipartCsrf, (req, res) => {
  const b = req.body;
  if (b.preset && THEME_PRESETS[b.preset]) {
    for (const [k, v] of Object.entries(THEME_PRESETS[b.preset])) setSetting(k, v);
    return res.redirect('/admin/design?ok=1');
  }
  for (const k of THEME_KEYS) if (k in b) setSetting(k, String(b[k]).slice(0, 20000));
  if (THEME_DESIGNS[b.theme_design]) setSetting('theme_design', b.theme_design);
  setSetting('theme_show_counter', b.theme_show_counter ? '1' : '0');
  if (req.file) setSetting('theme_bg_image', up.saveMedia([req.file], req.user.id)[0].url);
  res.redirect('/admin/design?ok=1');
});

// ---------- Desktop für alle (Aussehen → Desktop) und Speicher (Mitglieder → Speicher und Freigaben) ----------
// Desktop: readme.txt, Standardsymbole von Windows (Eigene Dateien, Papierkorb, readme), Widgets und Suche.
// Welche Programme auf dem Desktop liegen, steht seit der Seitenverwaltung 2.0 unter Programme (Spalte „Desktop“).
const DESK_NUMS = { desk_text_chars: [100, 100000], desk_text_max: [0, 10000], desk_folders_max: [0, 10000], desk_links_max: [0, 10000],
  desk_trash_days: [1, 365], user_quota_mb: [0, 1048576] };
const DESK_SYS = [['eigene-dateien', '🗂️ Eigene Dateien'], ['papierkorb', '🗑️ Papierkorb'], ['readme', '📄 readme.txt']];
router.get('/desktop', (req, res) => {
  const s = Object.fromEntries(['desk_readme', 'desk_readme_version', 'desk_defaults', 'lobby_widget', 'svc_widget', 'search_enabled'].map(k => [k, getSetting(k, '')]));
  res.render('admin/desktop', { title: 'Desktop', s, icons: DESK_SYS, on: s.desk_defaults.split(','), readmeDefault: require('../readme').DEFAULT });
});
router.post('/desktop', (req, res) => {
  const b = req.body;
  // Programme auf dem Desktop bleiben, wie sie unter Programme eingestellt sind
  const keep = (getSetting('desk_defaults') || '').split(',').filter(k => k && !DESK_SYS.some(([s]) => s === k));
  if ('icons_form' in b) setSetting('desk_defaults', [...asArray(b.icons).filter(k => DESK_SYS.some(([s]) => s === k)), ...keep].join(','));
  if ('widgets_form' in b) {
    setSetting('lobby_widget', b.lobby_widget ? '1' : '0');
    setSetting('search_enabled', b.search_enabled ? '1' : '0');
  }
  if (typeof b.desk_readme === 'string') {
    const text = b.desk_readme.replace(/\r\n?/g, '\n').slice(0, 20000);
    // Neue Fassung: Alle sehen die readme.txt wieder mit NEU, auch wer sie gelöscht hat
    if (b.readme_bump && text !== getSetting('desk_readme')) setSetting('desk_readme_version', String((Number(getSetting('desk_readme_version', '1')) || 1) + 1));
    setSetting('desk_readme', text);
  }
  res.redirect('/admin/desktop?ok=1');
});
router.get('/speicher', (req, res) => {
  const s = Object.fromEntries(Object.keys(DESK_NUMS).map(k => [k, getSetting(k, '')]));
  const usage = db.prepare("SELECT id, username, display_name, role = 'admin' AS is_admin FROM users WHERE disabled = 0").all()
    .map(u => ({ ...u, used: quota.usedBytes(u.id) })).filter(u => u.used > 0).sort((a, b) => b.used - a.used).slice(0, 25);
  res.render('admin/speicher', { title: 'Speicher und Freigaben', s, usage, shared: desk.publicList(), visLabel: desk.VIS_LABEL, disks: require('../services').disks() });
});
router.post('/speicher', (req, res) => {
  const b = req.body;
  for (const [k, [min, max]] of Object.entries(DESK_NUMS)) {
    const n = Math.round(Number(b[k]));
    if (k in b && Number.isFinite(n)) setSetting(k, String(Math.min(max, Math.max(min, n))));
  }
  res.redirect('/admin/speicher?ok=1');
});
router.post('/desktop/freigabe/:id', (req, res) => {
  desk.moderate(req.params.id, req.body.remove === '1');
  res.redirect('/admin/speicher?ok=1#freigaben');
});

// ---------- Zurücksetzen (Programme → Eigenschaften) ----------
// Die Einstellungen selbst stehen jetzt in src/routes/admin-areas.js (Programme, System, Aussehen)
const back = (req, res, fallback) => res.redirect(String(req.body.back || '').startsWith('/admin/') ? req.body.back : fallback);
// Kasse der Kartenspiele leeren: beim nächsten Hinsetzen gibt es wieder Startgeld
router.post('/settings/kasse-reset', (req, res) => {
  require('../kasse').reset(null);
  back(req, res, '/admin/programme/kartenspiele?ok=1#bestenlisten');
});
// Blackjack-Bestenliste leeren. Sitzungen, die gerade an einem Tisch laufen, bleiben stehen.
router.post('/settings/blackjack-reset', (req, res) => {
  require('../blackjack').resetStats(null);
  back(req, res, '/admin/programme/kartenspiele?ok=1#bestenlisten');
});
// Poker-Bestenliste leeren, genauso
router.post('/settings/poker-reset', (req, res) => {
  require('../poker').resetStats(null);
  back(req, res, '/admin/programme/kartenspiele?ok=1#bestenlisten');
});
// UNO, Flip 7, Pilli Pilli: alle Ergebnisse eines Spiels löschen
router.post('/settings/kartenspiel-reset/:game', (req, res) => {
  const g = CARD_GAMES.find(([id]) => id === req.params.game);
  if (g) require('../' + g[0]).resetStats(null);
  back(req, res, '/admin/programme/kartenspiele?ok=1#bestenlisten');
});
// Alle Durak-Ergebnisse löschen (Bestenliste und Zahlen im Profil)
router.post('/settings/durak-reset', (req, res) => {
  require('../durak').resetStats(null);
  back(req, res, '/admin/programme/kartenspiele?ok=1#bestenlisten');
});
// Alle Minesweeper-Spiele und damit Bestzeiten und Profil-Zahlen löschen
router.post('/settings/minesweeper-reset', (req, res) => {
  require('../minesweeper').resetStats(null);
  back(req, res, '/admin/programme/raetsel?ok=1#minesweeper');
});
// Alle Kreuzworträtsel-Stände löschen (Profile, Serien, Bestenlisten); die Rätsel selbst bleiben
router.post('/settings/kreuzwortraetsel-reset', (req, res) => {
  require('../crossword').resetStats(null);
  back(req, res, '/admin/programme/raetsel?ok=1#kreuzwortraetsel');
});
// Alle Sudoku-Stände löschen (Profile, Serien, Bestenlisten); die Sudokus selbst bleiben
router.post('/settings/sudoku-reset', (req, res) => {
  require('../sudoku').resetStats(null);
  back(req, res, '/admin/programme/raetsel?ok=1#sudoku');
});
router.post('/settings/testmail', async (req, res) => {
  let msg;
  try { msg = (await mail.notify('Test-E-Mail', 'Wenn du das liest, funktioniert der E-Mail-Versand.')) ? 'Test-E-Mail wurde verschickt.' : 'Bitte zuerst Empfänger und SMTP-Server eintragen.'; }
  catch (e) { msg = 'Fehler: ' + e.message; }
  res.redirect('/admin/email?mail=' + encodeURIComponent(msg));
});

// Neue Bereiche der Seitenverwaltung 2.0: Übersicht, Programme, Dienste, Aussehen, System
router.use('/', require('./admin-areas'));

module.exports = router;
