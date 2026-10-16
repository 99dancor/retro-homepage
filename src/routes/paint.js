'use strict';
// Paint (Startmenü → 🎨 Paint) und Galerie (🖼️ Galerie). Die Seite holt Listen als JSON; Schreiben geht per POST
// mit dem Formular-Token im Kopf x-csrf-token (bei Bildern vor dem Lesen der Dateien geprüft), Bilder kommen als PNG per multipart.
const express = require('express');
const multer = require('multer');
const { db, now, tx } = require('../db');
const auth = require('../auth');
const paint = require('../paint');
const { fmtSize } = require('../util');

const router = express.Router();
const gallery = express.Router();
const str = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const fail = (res, status, error) => res.status(status).json({ error });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: paint.MAX_FILE, files: 2, fields: 10 } })
  .fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);

function gate(req, res, next) {
  if (!paint.enabled()) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Paint ist ausgeschaltet.' });
  next();
}
router.use(gate);
router.use(express.json({ limit: '20kb' }));
router.use((req, res, next) => { if (req.path !== '/') res.set('Cache-Control', 'no-store'); next(); });
function needLogin(req, res, next) { return req.user ? next() : fail(res, 401, 'Bitte melde dich an.'); }
function needSave(req, res, next) { return paint.canSave(req.user) ? next() : fail(res, 403, 'Speichern ist für dein Konto nicht freigeschaltet.'); }
function files(req, res, next) {
  upload(req, res, err => {
    if (err) return fail(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'Das Bild ist zu groß.' : 'Hochladen fehlgeschlagen.');
    next();
  });
}
function own(req, res, next) {
  const a = paint.get(req.params.id);
  if (!a || !req.user || !(req.user.isAdmin || a.owner_id === req.user.id)) return fail(res, 404, 'Dieses Bild gibt es nicht.');
  req.art = a;
  next();
}
const noteFor = a => (a.visibility === 'public' && !a.approved ? 'Öffentlich zu sehen ist es erst, wenn der Admin es freigibt.' : null);

router.get('/', (req, res) => {
  if (!req.user && !paint.guestsOk()) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  // blob: für eingefügte Bilder und Downloads aus dem Browser
  res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("img-src 'self' https: data:;", "img-src 'self' https: data: blob:;"));
  const m = paint.maxSize();
  res.render('paint', { title: 'Paint', canSave: paint.canSave(req.user), galleryOn: paint.galleryOn(), maxW: m.w, maxH: m.h });
});

// Listen für „Datei → Öffnen“: eigene Bilder oder die Galerie
router.get('/bilder', (req, res) => {
  const u = req.user;
  if (req.query.tab === 'gallery') {
    if (!paint.galleryOn()) return fail(res, 404, 'Die Galerie ist ausgeschaltet.');
    return res.json({ artworks: paint.gallery(u, 300).map(a => paint.row(a, u)) });
  }
  if (!u) return fail(res, 401, 'Bitte melde dich an.');
  const list = db.prepare(`SELECT a.*, u.username, u.display_name FROM artworks a JOIN users u ON u.id = a.owner_id
                           WHERE a.owner_id = ? ORDER BY a.updated_at DESC, a.id DESC`).all(u.id);
  res.json({ artworks: list.map(a => paint.row(a, u)), quota: paint.canSave(u) && !u.isAdmin ? { used: paint.usedBytes(u.id), total: paint.quotaBytes() } : null });
});
router.get('/bilder/:id', (req, res) => {
  const a = paint.get(req.params.id);
  if (!paint.canSee(req.user, a)) return fail(res, 404, 'Dieses Bild gibt es nicht (oder du darfst es nicht sehen).');
  res.json({ artwork: paint.row(a, req.user) });
});

// Bild und Vorschau ausliefern
function sendPng(req, res, a, thumb) {
  const headers = { 'Content-Type': 'image/png', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': thumb && 'v' in req.query ? 'private, max-age=31536000' : 'private, no-cache' };
  if (req.query.download) headers['Content-Disposition'] = `attachment; filename="bild.png"; filename*=UTF-8''${encodeURIComponent(a.title.replace(/[\\/:*?"<>|]+/g, '_') + '.png')}`;
  res.sendFile(paint.file(a.stored_name, thumb), { headers, lastModified: !thumb }, err => err && !res.headersSent && res.status(404).end());
}
router.get('/bild/:name', (req, res) => {
  const m = /^(\d+)\.png$/.exec(req.params.name);
  const a = m && paint.get(m[1]);
  if (!paint.canSee(req.user, a)) return res.status(404).end();
  sendPng(req, res, a, false);
});
router.get('/bild/:id/vorschau.png', (req, res) => {
  const a = paint.get(req.params.id);
  if (!paint.canSee(req.user, a)) return res.status(404).end();
  sendPng(req, res, a, true);
});

// Neues Bild speichern
router.post('/bilder', needLogin, needSave, auth.csrfCheck, files, (req, res) => {
  const u = req.user, f = paint.checkFiles(req.files);
  if (f.error) return fail(res, 400, f.error);
  const size = f.image.length + f.thumb.length;
  if (!u.isAdmin && paint.usedBytes(u.id) + size > paint.quotaBytes()) {
    return fail(res, 413, `Dein Speicher für Bilder ist voll (${fmtSize(paint.quotaBytes())}). Lösche alte Bilder unter Datei → Öffnen, um Platz zu schaffen.`);
  }
  const b = req.body || {}, vis = paint.VIS.includes(b.visibility) ? b.visibility : 'private', t = now();
  const name = paint.store(f.image, f.thumb);
  const id = Number(db.prepare(`INSERT INTO artworks(owner_id, title, width, height, stored_name, size, visibility, approved, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(u.id, str(b.title) || 'unbenannt', f.w, f.h, name, size, vis, paint.needsApproval(u, vis) ? 0 : 1, t, t).lastInsertRowid);
  const a = paint.get(id);
  res.json({ artwork: paint.row(a, u), note: noteFor(a) });
});
// Neuer Stand eines eigenen Bildes
router.post('/bild/:id/bild', needLogin, needSave, auth.csrfCheck, own, files, (req, res) => {
  const u = req.user, a = req.art, f = paint.checkFiles(req.files);
  if (f.error) return fail(res, 400, f.error);
  if (a.owner_id !== u.id) return fail(res, 403, 'Das Bild gehört jemand anderem. Speichere eine eigene Kopie mit „Speichern unter“.');
  const size = f.image.length + f.thumb.length;
  if (!u.isAdmin && paint.usedBytes(u.id) - a.size + size > paint.quotaBytes()) return fail(res, 413, `Dein Speicher für Bilder ist voll (${fmtSize(paint.quotaBytes())}).`);
  const name = paint.store(f.image, f.thumb);
  // Ein geändertes öffentliches Bild muss bei eingeschalteter Freigabe neu freigegeben werden
  db.prepare('UPDATE artworks SET width = ?, height = ?, stored_name = ?, size = ?, approved = ?, updated_at = ? WHERE id = ?')
    .run(f.w, f.h, name, size, paint.needsApproval(u, a.visibility) ? 0 : a.approved, now(), a.id);
  paint.removeFiles(a.stored_name);
  const n = paint.get(a.id);
  res.json({ artwork: paint.row(n, u), note: noteFor(n) });
});
// Titel und Sichtbarkeit
router.post('/bild/:id', needLogin, own, (req, res) => {
  const a = req.art, b = req.body || {};
  const title = str(b.title) || a.title, vis = paint.VIS.includes(b.visibility) ? b.visibility : a.visibility;
  const approved = vis !== a.visibility && paint.needsApproval(req.user, vis) ? 0 : vis === 'public' && req.user.isAdmin ? 1 : a.approved;
  db.prepare('UPDATE artworks SET title = ?, visibility = ?, approved = ? WHERE id = ?').run(title, vis, approved, a.id);
  const n = paint.get(a.id);
  res.json({ artwork: paint.row(n, req.user), note: noteFor(n) });
});
router.post('/bild/:id/loeschen', needLogin, own, (req, res) => {
  db.prepare('DELETE FROM artworks WHERE id = ?').run(req.art.id);
  paint.removeFiles(req.art.stored_name);
  res.json({ ok: true });
});

// ---------- Galerie ----------
gallery.use((req, res, next) => (paint.galleryOn() ? next() : res.status(404).render('error', { title: 'Nicht gefunden', message: 'Die Galerie ist ausgeschaltet.' })));
gallery.get('/', (req, res) => {
  const u = req.user;
  let owner = null, list;
  if (req.query.von) {
    owner = db.prepare('SELECT id, username, display_name, disabled FROM users WHERE username = ?').get(String(req.query.von));
    if (!owner || (owner.disabled && !(u && u.isAdmin))) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Mitglied gibt es nicht.' });
    list = paint.byUser(owner.id, u);
  } else list = paint.gallery(u);
  res.render('gallery', { title: owner ? 'Bilder von ' + (owner.display_name || owner.username) : 'Galerie', owner, artworks: list.map(a => paint.row(a, u)) });
});
gallery.get('/:id', (req, res) => {
  const a = paint.get(req.params.id);
  if (!paint.canSee(req.user, a)) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Bild gibt es nicht (oder du darfst es nicht sehen).' });
  res.render('gallery-item', { title: a.title, a: paint.row(a, req.user), size: fmtSize(a.size) });
});

// Für Admin → Paint
function adminList() {
  return db.prepare(`SELECT a.*, u.username, u.display_name FROM artworks a JOIN users u ON u.id = a.owner_id
                     ORDER BY (a.visibility = 'public' AND a.approved = 0) DESC, a.updated_at DESC LIMIT 200`).all();
}
function adminDelete(id) {
  const a = paint.get(id);
  if (!a) return;
  tx(() => db.prepare('DELETE FROM artworks WHERE id = ?').run(a.id));
  paint.removeFiles(a.stored_name);
}
module.exports = { router, gallery, adminList, adminDelete };
