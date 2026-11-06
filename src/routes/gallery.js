'use strict';
// Galerie (🖼️ im Startmenü): Explorer mit Alben, Fotos der Mitglieder und den Paint-Bildern. Die Seite (views/gallery.ejs,
// public/gallery.js) holt jede Ansicht als JSON. Bilder kommen einzeln per multipart, damit jedes seinen eigenen Fortschritt hat.
const express = require('express');
const multer = require('multer');
const { db, now, tx } = require('../db');
const auth = require('../auth');
const gal = require('../gallery');
const paint = require('../paint');
const quota = require('../quota');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });
const str = (v, max = 120) => String(v ?? '').replace(/[\p{C}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const vis = (v, d) => (gal.VIS.includes(v) ? v : d);
const paintOn = () => paint.galleryOn();
const FRESH_DAYS = 14;

router.use((req, res, next) => (gal.on() ? next() : res.status(404).render('error', { title: 'Nicht gefunden', message: 'Die Galerie ist ausgeschaltet.' })));
router.use((req, res, next) => { if (req.path !== '/') res.set('Cache-Control', 'no-store'); next(); });
const needLogin = (req, res, next) => (req.user ? next() : fail(res, 401, 'Bitte melde dich an.'));

// ---------- Seite ----------
router.get('/', (req, res) => {
  // blob: für die Vorschau beim Hochladen und „Als Desktophintergrund“
  res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("img-src 'self' https: data:;", "img-src 'self' https: data: blob:;"));
  let ort = String(req.query.ort || '');
  if (req.query.von) ort = 'u:' + String(req.query.von);
  if (req.query.album) ort = 'a:' + Number(req.query.album);
  let bild = Number(req.query.bild) || 0;
  // Ein Bild direkt öffnen: dann in seinem Album (oder unter Alle Bilder), wenn es sichtbar ist
  if (bild) {
    const p = gal.getPhoto(bild);
    if (!gal.canSeePhoto(req.user, p)) bild = 0;
    else if (!ort) ort = p.album_id && gal.canSeeAlbum(req.user, gal.getAlbum(p.album_id)) ? 'a:' + p.album_id : 'alle';
  }
  res.render('gallery', { title: 'Galerie', start: { ort: ort || 'alle', q: String(req.query.q || '').slice(0, 80), bild }, maxMb: Math.round(gal.maxBytes() / 1048576) });
});

// ---------- Ansichten ----------
function tree(u) {
  const ps = gal.photoSql(u);
  const count = (where = '1=1', params = []) => db.prepare(`SELECT COUNT(*) AS n FROM gal_photos p JOIN users u ON u.id = p.owner_id LEFT JOIN gal_albums al ON al.id = p.album_id WHERE ${ps} AND ${where}`).get(...params).n;
  const pv = paintOn() ? (u ? "a.visibility IN ('public','members')" : "a.visibility = 'public'") : null;
  const paintCount = (where = '1=1', params = []) => (pv ? db.prepare(`SELECT COUNT(*) AS n FROM artworks a JOIN users u ON u.id = a.owner_id
      WHERE ${pv} AND (a.visibility != 'public' OR a.approved = 1) AND a.draft = 0 AND u.disabled = 0 AND ${where}`).get(...params).n : 0);
  const since = now() - FRESH_DAYS * 86400;
  // Mitglieder mit Bildern: Fotos und Paint-Bilder zusammen
  const members = new Map();
  for (const r of db.prepare(`SELECT u.username, u.display_name, COUNT(*) AS n FROM gal_photos p JOIN users u ON u.id = p.owner_id LEFT JOIN gal_albums al ON al.id = p.album_id
                              WHERE ${ps} GROUP BY p.owner_id`).all()) members.set(r.username, { user: r.username, name: gal.nameOf(r), n: r.n });
  if (pv) {
    for (const r of db.prepare(`SELECT u.username, u.display_name, COUNT(*) AS n FROM artworks a JOIN users u ON u.id = a.owner_id
                                WHERE ${pv} AND (a.visibility != 'public' OR a.approved = 1) AND a.draft = 0 AND u.disabled = 0 GROUP BY a.owner_id`).all()) {
      const m = members.get(r.username) || { user: r.username, name: gal.nameOf(r), n: 0 };
      m.n += r.n;
      members.set(r.username, m);
    }
  }
  return {
    all: count() + paintCount(), fresh: count('p.created_at > ?', [since]) + paintCount('a.updated_at > ?', [since]),
    albums: gal.albums(u).map(al => ({ id: al.id, title: al.title, count: al.n_photos, shared: !!al.shared, mine: !!u && al.owner_id === u.id, vis: al.visibility })),
    paint: pv ? paintCount() : null,
    members: [...members.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de')).slice(0, 40),
    mine: u ? db.prepare('SELECT COUNT(*) AS n FROM gal_photos WHERE owner_id = ?').get(u.id).n + (paintOn() ? db.prepare('SELECT COUNT(*) AS n FROM artworks WHERE owner_id = ? AND draft = 0').get(u.id).n : 0) : null,
    loose: u ? db.prepare('SELECT COUNT(*) AS n FROM gal_photos WHERE owner_id = ? AND album_id IS NULL').get(u.id).n : null,
  };
}
const byDate = (a, b) => b.date - a.date || b.id - a.id;
function paintList(u, sql, params, limit = 500) {
  if (!paintOn()) return [];
  const pv = u ? "a.visibility IN ('public','members')" : "a.visibility = 'public'";
  return db.prepare(`SELECT a.*, u.username, u.display_name FROM artworks a JOIN users u ON u.id = a.owner_id
                     WHERE ${pv} AND (a.visibility != 'public' OR a.approved = 1) AND a.draft = 0 AND u.disabled = 0 AND ${sql}
                     ORDER BY a.updated_at DESC LIMIT ?`).all(...params, limit).map(a => gal.paintRow(a, u));
}
function albumOut(al, u) {
  return { ...gal.albumRow(al, u), covers: gal.covers(u, al), contributors: gal.contributors(al.id) };
}
function view(u, ort, q) {
  const F = (where, params, opts) => gal.photos(u, where, params, opts).map(p => gal.photoRow(p, u));
  const out = { node: ort, mode: 'photos', items: [], album: null, albums: null };
  let m;
  if (ort === 'alben') {
    Object.assign(out, { title: 'Alben', icon: '📚', mode: 'albums', albums: gal.albums(u).map(al => albumOut(al, u)) });
  } else if ((m = /^a:(\d+)$/.exec(ort))) {
    const al = gal.getAlbum(m[1]);
    if (!gal.canSeeAlbum(u, al)) return null;
    Object.assign(out, { title: al.title, icon: '📁', album: albumOut(al, u), items: F('p.album_id = ?', [al.id], { order: 'COALESCE(p.taken_at, p.created_at), p.id' }) });
  } else if (ort === 'neu') {
    const since = now() - FRESH_DAYS * 86400;
    Object.assign(out, { title: 'Neu hinzugefügt', icon: '🆕', items: [...F('p.created_at > ?', [since], { limit: 300 }), ...paintList(u, 'a.updated_at > ?', [since], 100)].sort(byDate) });
  } else if (ort === 'paint') {
    if (!paintOn()) return null;
    Object.assign(out, { title: 'Paint-Bilder', icon: '🎨', items: paintList(u, '1=1', []) });
  } else if ((m = /^u:(.+)$/.exec(ort))) {
    const owner = db.prepare('SELECT id, username, display_name, disabled FROM users WHERE username = ?').get(m[1]);
    if (!owner || (owner.disabled && !(u && u.isAdmin))) return null;
    const own = u && u.id === owner.id;
    const pt = paintOn() ? paint.byUser(owner.id, u).map(a => gal.paintRow(a, u)) : [];
    Object.assign(out, { title: own ? 'Meine Bilder' : 'Bilder von ' + gal.nameOf(owner), icon: '👤', owner: { user: owner.username, name: gal.nameOf(owner) },
      items: [...F('p.owner_id = ?', [owner.id]), ...pt].sort(byDate) });
  } else if (ort === 'mein' || ort === 'ohne') {
    if (!u) return null;
    const mine = F(ort === 'ohne' ? 'p.owner_id = ? AND p.album_id IS NULL' : 'p.owner_id = ?', [u.id]);
    const pt = ort === 'mein' && paintOn() ? paint.mine(u.id).filter(a => !a.draft).map(a => gal.paintRow(a, u)) : [];
    Object.assign(out, { title: ort === 'ohne' ? 'Ohne Album' : 'Meine Bilder', icon: ort === 'ohne' ? '🗃️' : '⭐', items: [...mine, ...pt].sort(byDate) });
  } else if (ort === 'suche') {
    const like = '%' + q.toLowerCase().replace(/[\\%_]/g, c => '\\' + c) + '%';
    Object.assign(out, { title: 'Suche', icon: '🔍', items: [...F("(lower(p.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(al.title, '')) LIKE ? ESCAPE '\\')", [like, like], { limit: 300 }),
      ...paintList(u, "lower(a.title) LIKE ? ESCAPE '\\'", [like], 100)].sort(byDate) });
  } else {
    Object.assign(out, { node: 'alle', title: 'Alle Bilder', icon: '🗂️', items: [...F('1=1', [], { limit: 3000 }), ...paintList(u, '1=1', [], 1000)].sort(byDate) });
  }
  return out;
}
router.get('/api/ansicht', (req, res) => {
  const u = req.user, q = str(req.query.q, 80);
  const v = view(u, String(req.query.ort || 'alle'), q);
  if (!v) return fail(res, 404, 'Das gibt es nicht (oder du darfst es nicht sehen).');
  res.json({
    ...v, q, tree: tree(u), me: u ? { user: u.username, admin: !!u.isAdmin } : null, canUpload: gal.canUpload(u),
    addable: gal.addableAlbums(u).map(al => ({ id: al.id, title: al.title, mine: al.owner_id === u.id, by: gal.nameOf(al), vis: al.visibility })),
    quota: u && quota.limitBytes(u) ? { used: quota.usedBytes(u.id), total: quota.limitBytes(u) } : null,
  });
});
router.get('/api/foto/:id', (req, res) => {
  const p = gal.getPhoto(req.params.id);
  if (!gal.canSeePhoto(req.user, p)) return fail(res, 404, 'Dieses Bild gibt es nicht (oder du darfst es nicht sehen).');
  res.json({ photo: gal.photoRow(p, req.user), comments: commentRows(p, req.user) });
});
function commentRows(p, u) {
  return gal.comments(p.id).map(c => ({
    id: c.id, body: c.body, date: c.created_at, by: gal.nameOf(c), byUser: c.username, avatar: c.avatar ? '/avatar/' + c.avatar : null,
    canDelete: !!u && (u.isAdmin || u.id === c.user_id || u.id === p.owner_id),
  }));
}

// ---------- Dateien ----------
function send(req, res, p, variant) {
  const headers = { 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    'Content-Type': variant ? 'image/jpeg' : gal.MIME[p.ext] };
  if (!variant && req.query.download) headers['Content-Disposition'] = `attachment; filename="bild.${p.ext}"; filename*=UTF-8''${encodeURIComponent(p.title.replace(/[\\/:*?"<>|]+/g, '_') + '.' + p.ext)}`;
  res.sendFile(gal.file(p, variant), { headers }, err => err && !res.headersSent && res.status(404).end());
}
router.get('/datei/:name', (req, res) => {
  const m = /^(\d+)\.(jpg|png|gif|webp)$/.exec(req.params.name);
  const p = m && gal.getPhoto(m[1]);
  if (!p || p.ext !== m[2] || !gal.canSeePhoto(req.user, p)) return res.status(404).end();
  send(req, res, p, null);
});
router.get('/datei/:id/:size', (req, res) => {
  const p = gal.getPhoto(req.params.id), size = { 'klein.jpg': 'v', 'mittel.jpg': 'm' }[req.params.size];
  if (!size || !gal.canSeePhoto(req.user, p)) return res.status(404).end();
  if ((size === 'v' && !p.has_thumb) || (size === 'm' && !p.has_medium)) return res.redirect(`/galerie/datei/${p.id}.${p.ext}`);
  send(req, res, p, size);
});

// ---------- Hochladen ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 3, fields: 10 } })
  .fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }, { name: 'medium', maxCount: 1 }]);
function files(req, res, next) {
  upload(req, res, err => {
    if (err) return fail(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'Das Bild ist zu groß.' : 'Hochladen fehlgeschlagen.');
    next();
  });
}
router.post('/hochladen', needLogin, auth.csrfCheck, files, async (req, res) => {
  const u = req.user, b = req.body || {};
  if (!gal.canUpload(u)) return fail(res, 403, 'Hochladen ist für dein Konto nicht freigeschaltet.');
  const f = req.files && req.files.file && req.files.file[0];
  if (!f) return fail(res, 400, 'Es kam kein Bild an.');
  if (f.size > gal.maxBytes()) return fail(res, 413, `Das Bild ist zu groß (höchstens ${Math.round(gal.maxBytes() / 1048576)} MB).`);
  let album = null;
  if (Number(b.album)) {
    album = gal.getAlbum(b.album);
    if (!gal.canAddTo(u, album)) return fail(res, 403, 'In dieses Album darfst du keine Bilder legen.');
  }
  let img;
  try {
    img = await gal.prepare(f.buffer, { thumb: req.files.thumb && req.files.thumb[0].buffer, medium: req.files.medium && req.files.medium[0].buffer, keepDate: b.keepDate !== '0' });
  } catch (e) { return fail(res, 400, e.message); }
  const dup = db.prepare('SELECT id FROM gal_photos WHERE owner_id = ? AND hash = ? AND COALESCE(album_id, 0) = ?').get(u.id, img.hash, album ? album.id : 0);
  if (dup) return res.json({ dup: true, photo: gal.photoRow(gal.getPhoto(dup.id), u) });
  const size = gal.totalSize(img);
  if (!quota.fits(u, size)) return fail(res, 413, quota.fullMessage(u));
  const name = gal.store(img);
  const id = Number(db.prepare(`INSERT INTO gal_photos(owner_id, album_id, title, stored_name, ext, has_thumb, has_medium, size, width, height, taken_at, visibility, hash, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(u.id, album ? album.id : null, str(b.title) || gal.baseName(f.originalname), name, img.ext, img.thumb ? 1 : 0, img.medium ? 1 : 0, size, img.w, img.h,
      img.taken, album ? album.visibility : vis(b.visibility, 'members'), img.hash, now()).lastInsertRowid);
  if (album) {
    db.prepare('UPDATE gal_albums SET updated_at = ? WHERE id = ?').run(now(), album.id);
    if (album.owner_id !== u.id) {
      require('../notify').send(album.owner_id, 'galerie', { key: `gal-a-${album.id}-${u.id}`, title: `📥 ${gal.nameOf(u)} hat Bilder in dein Album „${album.title}“ gelegt`, url: '/galerie?album=' + album.id });
    }
  }
  res.json({ photo: gal.photoRow(gal.getPhoto(id), u) });
});

// ---------- Alben ----------
router.use(express.json({ limit: '50kb' }));
function albumFields(b, cur = {}) {
  return {
    title: str(b.title, 80) || cur.title || '', description: String(b.description ?? cur.description ?? '').replace(/[^\P{C}\n]/gu, '').trim().slice(0, 500),
    visibility: vis(b.visibility, cur.visibility || 'members'),
    shared: b.shared === undefined ? (cur.shared ? 1 : 0) : b.shared ? 1 : 0,
    comments: b.comments === undefined ? (cur.comments === undefined ? 1 : cur.comments ? 1 : 0) : b.comments ? 1 : 0,
  };
}
router.post('/alben', needLogin, (req, res) => {
  const u = req.user, a = albumFields(req.body || {});
  if (!gal.canUpload(u)) return fail(res, 403, 'Alben anlegen ist für dein Konto nicht freigeschaltet.');
  if (!a.title) return fail(res, 400, 'Gib dem Album einen Namen.');
  if (db.prepare('SELECT COUNT(*) AS n FROM gal_albums WHERE owner_id = ?').get(u.id).n >= gal.MAX_ALBUMS) return fail(res, 400, `Du hast schon ${gal.MAX_ALBUMS} Alben.`);
  const t = now();
  const id = Number(db.prepare('INSERT INTO gal_albums(owner_id, title, description, visibility, shared, comments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.id, a.title, a.description, a.visibility, a.visibility === 'private' ? 0 : a.shared, a.comments, t, t).lastInsertRowid);
  res.json({ album: gal.albumRow(gal.getAlbum(id), u) });
});
function ownAlbum(req, res, next) {
  const al = gal.getAlbum(req.params.id);
  if (!gal.canEditAlbum(req.user, al)) return fail(res, 404, 'Dieses Album gibt es nicht (oder es gehört dir nicht).');
  req.album = al;
  next();
}
router.post('/album/:id', needLogin, ownAlbum, (req, res) => {
  const al = req.album, b = req.body || {}, a = albumFields(b, al);
  let cover = al.cover_id;
  if (b.cover !== undefined) {
    const p = Number(b.cover) && gal.getPhoto(b.cover);
    cover = p && p.album_id === al.id ? p.id : null;
  }
  tx(() => {
    db.prepare('UPDATE gal_albums SET title = ?, description = ?, visibility = ?, shared = ?, comments = ?, cover_id = ?, updated_at = ? WHERE id = ?')
      .run(a.title, a.description, a.visibility, a.visibility === 'private' ? 0 : a.shared, a.comments, cover, now(), al.id);
    // Bilder merken sich die Sichtbarkeit des Albums, falls sie später ohne Album dastehen
    db.prepare('UPDATE gal_photos SET visibility = ? WHERE album_id = ?').run(a.visibility, al.id);
  });
  res.json({ album: gal.albumRow(gal.getAlbum(al.id), req.user) });
});
router.post('/album/:id/loeschen', needLogin, ownAlbum, (req, res) => {
  const al = req.album, withPhotos = !!(req.body && req.body.withPhotos);
  // Mit „Bilder auch löschen“ gehen nur die Bilder des Albumbesitzers weg; Bilder anderer bleiben bei ihnen (ohne Album)
  const gone = withPhotos ? db.prepare('SELECT id, stored_name, ext FROM gal_photos WHERE album_id = ? AND owner_id = ?').all(al.id, al.owner_id) : [];
  tx(() => {
    for (const p of gone) db.prepare('DELETE FROM gal_photos WHERE id = ?').run(p.id);
    db.prepare('UPDATE gal_photos SET album_id = NULL, visibility = ? WHERE album_id = ?').run(al.visibility, al.id);
    db.prepare('DELETE FROM gal_albums WHERE id = ?').run(al.id);
  });
  gal.removeFiles(gone);
  res.json({ ok: true, removed: gone.length });
});
router.get('/album/:id/zip', (req, res) => {
  const al = gal.getAlbum(req.params.id);
  if (!gal.canSeeAlbum(req.user, al)) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Album gibt es nicht (oder du darfst es nicht sehen).' });
  const list = gal.photos(req.user, 'p.album_id = ?', [al.id], { order: 'COALESCE(p.taken_at, p.created_at), p.id', limit: 10000 })
    .map(p => ({ path: gal.file(p), name: p.title + '.' + p.ext, time: p.taken_at || p.created_at }));
  gal.zipTo(res, list, al.title.replace(/[\\/:*?"<>|]+/g, '_') + '.zip');
});

// ---------- Bilder bearbeiten ----------
function loadPhoto(req, res, next) {
  const p = gal.getPhoto(req.params.id);
  if (!gal.canSeePhoto(req.user, p)) return fail(res, 404, 'Dieses Bild gibt es nicht (oder du darfst es nicht sehen).');
  req.photo = p;
  next();
}
// Ins Album legen (0 = ohne Album); prüft die Rechte und gibt eine Fehlermeldung oder null zurück
function moveTo(u, p, albumId) {
  if (!albumId) {
    if (!gal.canRemoveFromAlbum(u, p)) return 'Das darfst du nicht.';
    if (p.album_id) db.prepare('UPDATE gal_photos SET album_id = NULL, visibility = ? WHERE id = ?').run(p.al_visibility || p.visibility, p.id);
    return null;
  }
  if (!gal.canEditPhoto(u, p)) return 'Nur wer das Bild hochgeladen hat, kann es verschieben.';
  const al = gal.getAlbum(albumId);
  if (!gal.canAddTo(u, al)) return 'In dieses Album darfst du keine Bilder legen.';
  db.prepare('UPDATE gal_photos SET album_id = ?, visibility = ? WHERE id = ?').run(al.id, al.visibility, p.id);
  return null;
}
router.post('/foto/:id', needLogin, loadPhoto, (req, res) => {
  const u = req.user, p = req.photo, b = req.body || {};
  if (b.album !== undefined && Number(b.album || 0) !== (p.album_id || 0)) {
    const e = moveTo(u, p, Number(b.album) || 0);
    if (e) return fail(res, 403, e);
  }
  if (b.title !== undefined || b.visibility !== undefined || b.rotate !== undefined) {
    if (!gal.canEditPhoto(u, p)) return fail(res, 403, 'Nur wer das Bild hochgeladen hat, kann es ändern.');
    const rot = b.rotate !== undefined ? (((p.rot + (Number(b.rotate) < 0 ? 270 : 90)) % 360) + 360) % 360 : p.rot;
    db.prepare('UPDATE gal_photos SET title = ?, visibility = ?, rot = ? WHERE id = ?')
      .run(b.title !== undefined ? str(b.title) || p.title : p.title, b.visibility !== undefined && !p.album_id ? vis(b.visibility, p.visibility) : gal.getPhoto(p.id).visibility, rot, p.id);
  }
  res.json({ photo: gal.photoRow(gal.getPhoto(p.id), u) });
});
// Mehrere auf einmal: verschieben oder löschen
router.post('/fotos', needLogin, (req, res) => {
  const u = req.user, b = req.body || {}, ids = [].concat(b.ids || []).map(Number).filter(Boolean).slice(0, 2000);
  const done = [], errors = [], gone = [];
  for (const id of ids) {
    const p = gal.getPhoto(id);
    if (!gal.canSeePhoto(u, p)) continue;
    if (b.action === 'delete') {
      if (!gal.canEditPhoto(u, p)) { errors.push(p.title); continue; }
      db.prepare('DELETE FROM gal_photos WHERE id = ?').run(p.id);
      gone.push(p);
    } else if (b.action === 'move') {
      const e = moveTo(u, p, Number(b.album) || 0);
      if (e) { errors.push(p.title); continue; }
    } else return fail(res, 400, 'Unbekannte Aktion.');
    done.push(p.id);
  }
  gal.removeFiles(gone);
  res.json({ done: done.length, skipped: errors.length, error: errors.length ? `${errors.length} ${errors.length === 1 ? 'Bild gehört' : 'Bilder gehören'} nicht dir und ${errors.length === 1 ? 'blieb' : 'blieben'}, wo ${errors.length === 1 ? 'es war' : 'sie waren'}.` : null });
});
router.post('/foto/:id/loeschen', needLogin, loadPhoto, (req, res) => {
  const p = req.photo;
  if (!gal.canEditPhoto(req.user, p)) return fail(res, 403, 'Nur wer das Bild hochgeladen hat, kann es löschen.');
  db.prepare('DELETE FROM gal_photos WHERE id = ?').run(p.id);
  gal.removeFiles(p);
  res.json({ ok: true });
});

// ---------- Kommentare ----------
router.post('/foto/:id/kommentare', needLogin, loadPhoto, (req, res) => {
  const p = req.photo;
  if (!gal.canComment(req.user, p)) return fail(res, 403, p.album_id && !p.al_comments ? 'In diesem Album sind Kommentare ausgeschaltet.' : 'Kommentieren geht hier nicht.');
  try { gal.addComment(req.user, p, req.body && req.body.body); } catch (e) { return fail(res, 400, e.message); }
  res.json({ comments: commentRows(p, req.user), count: gal.comments(p.id).length });
});
router.post('/kommentar/:id/loeschen', needLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM gal_comments WHERE id = ?').get(Number(req.params.id));
  const p = c && gal.getPhoto(c.photo_id), u = req.user;
  if (!c || !(u.isAdmin || u.id === c.user_id || (p && u.id === p.owner_id))) return fail(res, 404, 'Diesen Kommentar gibt es nicht.');
  db.prepare('DELETE FROM gal_comments WHERE id = ?').run(c.id);
  res.json({ comments: commentRows(p, u) });
});

module.exports = router;
