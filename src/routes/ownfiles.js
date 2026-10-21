'use strict';
// Eigene Dateien (Startmenü → Dokumente): alles, was ein Mitglied hochgeladen oder gespeichert hat, an einem Ort.
// Downloads, Mediaplayer-Titel und Playlists, Paint-Bilder, Quizze und Bilder aus Forum und Blog: Sichtbarkeit ändern und löschen.
const path = require('node:path');
const express = require('express');
const { db, now, MEDIA_DIR, UPLOAD_DIR } = require('../db');
const auth = require('../auth');
const up = require('../uploads');
const music = require('../music');
const paint = require('../paint');
const quiz = require('../quiz');
const { deleteTrack } = require('./music');

const router = express.Router();
router.use(auth.requireLogin);

// Wählbare Sichtbarkeit je Art; „groups“ vergibt nur der Admin in der Systemsteuerung und bleibt, solange niemand etwas anderes wählt
const VIS = {
  datei: ['public', 'members', 'friends', 'private'],
  titel: ['public', 'members', 'friends', 'private'],
  playlist: ['public', 'members', 'friends', 'private'],
  bild: paint.VIS,
};
const LABEL = { public: 'Öffentlich', members: 'Angemeldete', friends: 'Nur Freunde', private: 'Nur ich', groups: 'Gruppen (Admin)' };

function lists(u) {
  return {
    files: db.prepare('SELECT * FROM files WHERE uploader_id = ? ORDER BY created_at DESC').all(u.id),
    tracks: db.prepare('SELECT * FROM tracks WHERE uploader_id = ? ORDER BY created_at DESC').all(u.id),
    playlists: db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS n
                           FROM playlists p WHERE user_id = ? ORDER BY updated_at DESC`).all(u.id),
    artworks: db.prepare('SELECT * FROM artworks WHERE owner_id = ? ORDER BY updated_at DESC').all(u.id),
    quizzes: db.prepare('SELECT id, title, questions, shared, updated_at FROM quizzes WHERE user_id = ? ORDER BY updated_at DESC').all(u.id),
    media: db.prepare('SELECT * FROM media WHERE uploader_id = ? ORDER BY created_at DESC').all(u.id),
  };
}

router.get('/', (req, res) => {
  const u = req.user, l = lists(u);
  const sum = rows => rows.reduce((n, r) => n + (r.size || 0), 0);
  res.render('own-files', {
    title: 'Eigene Dateien', ...l, VIS, LABEL,
    usage: {
      files: sum(l.files), media: sum(l.media),
      music: { used: music.usedBytes(u.id), total: u.isAdmin ? 0 : music.quotaBytes() },
      paint: { used: paint.usedBytes(u.id), total: u.isAdmin ? 0 : paint.quotaBytes() },
    },
    canUploadMusic: music.canUpload(u),
    msg: { saved: 'Gespeichert.', deleted: 'Gelöscht.' }[req.query.ok] || null,
  });
});

const back = (res, ok, anchor) => res.redirect(`/eigene-dateien?ok=${ok}#${anchor}`);
const pickVis = (kind, v, cur) => (VIS[kind].includes(v) ? v : cur);
// Nur eigene Einträge; der Admin verwaltet fremde in der Systemsteuerung
function own(table, col) {
  return (req, res, next) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${col} = ?`).get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diesen Eintrag gibt es nicht (mehr) in deinen Dateien.' });
    req.item = row;
    next();
  };
}

// ---------- Downloads ----------
router.post('/datei/:id', own('files', 'uploader_id'), (req, res) => {
  const f = req.item, vis = pickVis('datei', req.body.visibility, f.visibility);
  db.prepare('UPDATE files SET title = ?, visibility = ? WHERE id = ?').run(String(req.body.title || '').trim().slice(0, 200) || f.title, vis, f.id);
  if (vis !== 'groups') auth.setAcl('file', f.id, []);
  back(res, 'saved', 'downloads');
});
router.post('/datei/:id/loeschen', own('files', 'uploader_id'), (req, res) => {
  up.removeQuietly(path.join(UPLOAD_DIR, req.item.stored_name));
  db.prepare('DELETE FROM files WHERE id = ?').run(req.item.id);
  db.prepare("DELETE FROM acl WHERE item_type = 'file' AND item_id = ?").run(req.item.id);
  back(res, 'deleted', 'downloads');
});

// ---------- Mediaplayer ----------
router.post('/titel/:id', own('tracks', 'uploader_id'), (req, res) => {
  const t = req.item, vis = pickVis('titel', req.body.visibility, t.visibility);
  db.prepare('UPDATE tracks SET title = ?, visibility = ? WHERE id = ?').run(String(req.body.title || '').trim().slice(0, 200) || t.title, vis, t.id);
  if (vis !== 'groups') auth.setAcl('track', t.id, []);
  back(res, 'saved', 'mediaplayer');
});
router.post('/titel/:id/loeschen', own('tracks', 'uploader_id'), (req, res) => { deleteTrack(req.item); back(res, 'deleted', 'mediaplayer'); });
router.post('/playlist/:id', own('playlists', 'user_id'), (req, res) => {
  const p = req.item;
  db.prepare('UPDATE playlists SET title = ?, visibility = ?, updated_at = ? WHERE id = ?')
    .run(String(req.body.title || '').trim().slice(0, 100) || p.title, pickVis('playlist', req.body.visibility, p.visibility), now(), p.id);
  back(res, 'saved', 'playlists');
});
router.post('/playlist/:id/loeschen', own('playlists', 'user_id'), (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.item.id);
  back(res, 'deleted', 'playlists');
});

// ---------- Paint ----------
router.post('/bild/:id', own('artworks', 'owner_id'), (req, res) => {
  const a = req.item, vis = pickVis('bild', req.body.visibility, a.visibility);
  // Wie in Paint: Ein Bild, das öffentlich wird, muss bei eingeschalteter Freigabe erst vom Admin freigegeben werden
  const approved = vis !== a.visibility && paint.needsApproval(req.user, vis) ? 0 : vis === 'public' && req.user.isAdmin ? 1 : a.approved;
  db.prepare('UPDATE artworks SET title = ?, visibility = ?, approved = ? WHERE id = ?')
    .run(String(req.body.title || '').trim().slice(0, 80) || a.title, vis, approved, a.id);
  back(res, 'saved', 'bilder');
});
router.post('/bild/:id/loeschen', own('artworks', 'owner_id'), (req, res) => {
  db.prepare('DELETE FROM artworks WHERE id = ?').run(req.item.id);
  paint.removeFiles(req.item.stored_name);
  back(res, 'deleted', 'bilder');
});

// ---------- Quiz ----------
router.post('/quiz/:id', own('quizzes', 'user_id'), (req, res) => {
  db.prepare('UPDATE quizzes SET shared = ? WHERE id = ?').run(req.body.shared === '1' ? 1 : 0, req.item.id);
  back(res, 'saved', 'quizze');
});
router.post('/quiz/:id/loeschen', own('quizzes', 'user_id'), (req, res) => {
  quiz.deleteQuiz(req.user, req.item.id);
  back(res, 'deleted', 'quizze');
});

// ---------- Bilder aus Forum und Blog ----------
router.post('/medien/:id/loeschen', own('media', 'uploader_id'), (req, res) => {
  up.removeQuietly(path.join(MEDIA_DIR, req.item.stored_name));
  db.prepare('DELETE FROM media WHERE id = ?').run(req.item.id);
  back(res, 'deleted', 'medien');
});

module.exports = router;
