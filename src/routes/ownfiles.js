'use strict';
// Eigene Dateien (Startmenü → Dokumente) als Explorer: links der Ordnerbaum, rechts der Inhalt. Oben im Baum der Desktop
// mit den eigenen Ordnern, darunter die Bibliotheken (alles einer Art, egal in welchem Ordner) und der Papierkorb.
// Ordner gibt es nur in der Datenbank (src/desk.js), die Dateien bleiben in ihren Tabellen und Verzeichnissen.
// Ändern von Titel und Sichtbarkeit geht wie bisher per Formular, alles andere über die Desktop-API (public/explorer.js).
const express = require('express');
const { db, now } = require('../db');
const auth = require('../auth');
const paint = require('../paint');
const music = require('../music');
const desk = require('../desk');
const quota = require('../quota');

const router = express.Router();
router.use(auth.requireLogin);

// Wählbare Sichtbarkeit je Art; „groups“ vergibt nur der Admin in der Seitenverwaltung und bleibt, solange niemand etwas anderes wählt
const VIS = {
  datei: ['public', 'members', 'friends', 'private'],
  titel: ['public', 'members', 'friends', 'private'],
  playlist: ['public', 'members', 'friends', 'private'],
  bild: paint.VIS,
};
const LABEL = { public: 'Öffentlich', members: 'Angemeldete', friends: 'Nur Freunde', private: 'Nur ich', groups: 'Gruppen (Admin)', link: 'Jeder mit der Adresse' };
// Reihenfolge im Baum
const LIBS = [['datei', '📁', 'Downloads'], ['medien', '🖼️', 'Bilder in Beiträgen'], ['text', '📄', 'Textdokumente'], ['titel', '🎵', 'Mediaplayer'],
  ['playlist', '📃', 'Playlists'], ['bild', '🎨', 'Paint-Bilder'], ['quiz', '❓', 'Quizze']];

// Zusatzangaben für die Bibliotheken mit Formularen (wie die Eigenen Dateien vor den Ordnern)
function rows(u, kind) {
  switch (kind) {
    case 'datei': return db.prepare('SELECT * FROM files WHERE uploader_id = ? ORDER BY created_at DESC').all(u.id);
    case 'titel': return db.prepare('SELECT * FROM tracks WHERE uploader_id = ? ORDER BY created_at DESC').all(u.id);
    case 'playlist': return db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS n
                                        FROM playlists p WHERE user_id = ? ORDER BY updated_at DESC`).all(u.id);
    case 'bild': return db.prepare('SELECT * FROM artworks WHERE owner_id = ? ORDER BY updated_at DESC').all(u.id);
    case 'quiz': return db.prepare('SELECT id, title, questions, shared, updated_at FROM quizzes WHERE user_id = ? ORDER BY updated_at DESC').all(u.id);
    case 'medien': return db.prepare('SELECT * FROM media WHERE uploader_id = ? ORDER BY created_at DESC').all(u.id);
    default: return [];
  }
}
// Ordnernamen für die Spalte „Ordner“ in den Bibliotheken
function folderNames(userId) {
  return Object.fromEntries(db.prepare("SELECT id, name FROM desk_items WHERE user_id = ? AND kind = 'folder'").all(userId).map(f => [f.id, f.name]));
}

router.get('/', (req, res, next) => {
  const u = req.user, q = req.query;
  const base = {
    title: 'Eigene Dateien', VIS, LABEL, LIBS, tree: desk.tree(u.id), counts: desk.counts(u.id), space: quota.view(u),
    trashN: desk.trashList(u.id).length, limits: desk.limits(), canUploadMusic: music.canUpload(u),
    msg: { saved: 'Gespeichert.', deleted: 'In den Papierkorb verschoben.', purged: 'Endgültig gelöscht.' }[q.ok] || null,
    view: 'home', items: [], folder: null, crumbs: [], kind: null, rows: [], names: {}, places: {},
  };
  if (q.ordner === 'papierkorb') {
    const items = desk.trashList(u.id), names = folderNames(u.id);
    return res.render('own-files', { ...base, title: 'Papierkorb', view: 'trash', items, names });
  }
  if (q.ordner !== undefined) {
    const id = Number(q.ordner) || 0, folder = id ? desk.own(u, id) : null;
    if (id && (!folder || folder.kind !== 'folder')) return next();
    if (folder && desk.trashed(folder)) return res.redirect('/eigene-dateien?ordner=papierkorb');
    return res.render('own-files', {
      ...base, title: folder ? folder.name : 'Desktop', view: 'folder', folder: folder && desk.deskEntry(folder, u),
      crumbs: desk.crumbs(folder), items: desk.children(u.id, id, u),
    });
  }
  if (q.bib && LIBS.some(l => l[0] === q.bib)) {
    const kind = q.bib, lib = LIBS.find(l => l[0] === kind);
    const places = Object.fromEntries(desk.library(u.id, kind).map(e => [e.id, e.folder]));
    return res.render('own-files', { ...base, title: lib[2], view: 'lib', kind, items: desk.library(u.id, kind), rows: rows(u, kind), names: folderNames(u.id), places });
  }
  res.render('own-files', { ...base, items: desk.children(u.id, 0, u).filter(e => e.kind === 'folder') });
});

const back = (req, res, ok, kind) => res.redirect(`/eigene-dateien?bib=${kind}&ok=${ok}`);
const pickVis = (kind, v, cur) => (VIS[kind].includes(v) ? v : cur);
// Nur eigene Einträge; der Admin verwaltet fremde in der Seitenverwaltung
function own(table, col) {
  return (req, res, next) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${col} = ?`).get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diesen Eintrag gibt es nicht (mehr) in deinen Dateien.' });
    req.item = row;
    next();
  };
}
// Löschen legt in den Papierkorb (dort endgültig löschen oder wiederherstellen)
const toTrash = kind => (req, res) => { desk.trash(req.user, [kind + ':' + req.item.id]); back(req, res, 'deleted', kind); };

// ---------- Downloads ----------
router.post('/datei/:id', own('files', 'uploader_id'), (req, res) => {
  const f = req.item, vis = pickVis('datei', req.body.visibility, f.visibility);
  db.prepare('UPDATE files SET title = ?, visibility = ? WHERE id = ?').run(String(req.body.title || '').trim().slice(0, 200) || f.title, vis, f.id);
  if (vis !== 'groups') auth.setAcl('file', f.id, []);
  back(req, res, 'saved', 'datei');
});
router.post('/datei/:id/loeschen', own('files', 'uploader_id'), toTrash('datei'));

// ---------- Mediaplayer ----------
router.post('/titel/:id', own('tracks', 'uploader_id'), (req, res) => {
  const t = req.item, vis = pickVis('titel', req.body.visibility, t.visibility);
  db.prepare('UPDATE tracks SET title = ?, visibility = ? WHERE id = ?').run(String(req.body.title || '').trim().slice(0, 200) || t.title, vis, t.id);
  if (vis !== 'groups') auth.setAcl('track', t.id, []);
  back(req, res, 'saved', 'titel');
});
router.post('/titel/:id/loeschen', own('tracks', 'uploader_id'), toTrash('titel'));
router.post('/playlist/:id', own('playlists', 'user_id'), (req, res) => {
  const p = req.item;
  db.prepare('UPDATE playlists SET title = ?, visibility = ?, updated_at = ? WHERE id = ?')
    .run(String(req.body.title || '').trim().slice(0, 100) || p.title, pickVis('playlist', req.body.visibility, p.visibility), now(), p.id);
  back(req, res, 'saved', 'playlist');
});
router.post('/playlist/:id/loeschen', own('playlists', 'user_id'), toTrash('playlist'));

// ---------- Paint ----------
router.post('/bild/:id', own('artworks', 'owner_id'), (req, res) => {
  const a = req.item, vis = pickVis('bild', req.body.visibility, a.visibility);
  // Wie in Paint: Ein Bild, das öffentlich wird, muss bei eingeschalteter Freigabe erst vom Admin freigegeben werden
  const approved = vis !== a.visibility && paint.needsApproval(req.user, vis) ? 0 : vis === 'public' && req.user.isAdmin ? 1 : a.approved;
  db.prepare('UPDATE artworks SET title = ?, visibility = ?, approved = ? WHERE id = ?')
    .run(String(req.body.title || '').trim().slice(0, 80) || a.title, vis, approved, a.id);
  back(req, res, 'saved', 'bild');
});
router.post('/bild/:id/loeschen', own('artworks', 'owner_id'), toTrash('bild'));

// ---------- Quiz ----------
router.post('/quiz/:id', own('quizzes', 'user_id'), (req, res) => {
  db.prepare('UPDATE quizzes SET shared = ? WHERE id = ?').run(req.body.shared === '1' ? 1 : 0, req.item.id);
  back(req, res, 'saved', 'quiz');
});
router.post('/quiz/:id/loeschen', own('quizzes', 'user_id'), toTrash('quiz'));

// ---------- Bilder aus Forum und Blog ----------
router.post('/medien/:id/loeschen', own('media', 'uploader_id'), toTrash('medien'));

module.exports = router;
