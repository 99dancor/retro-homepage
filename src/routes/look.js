'use strict';
// Update 100: Aussehen der Seite (src/look.js). Alles unter /aussehen:
//   GET  /aussehen/daten        Einstellungen, Bildauswahl und Auswahllisten für die Schublade (Admin)
//   POST /aussehen              speichern (Admin, JSON)
//   POST /aussehen/vorschau     CSS für die Live-Vorschau aus ungespeicherten Werten (Admin, JSON)
//   POST /aussehen/bild         Bild in die Bildauswahl hochladen (Admin, Formular „image“)
//   POST /aussehen/bild/loeschen  Bild aus der Bildauswahl nehmen (Admin, JSON { f })
//   GET  /aussehen/symbol.svg   Browser-Symbol aus Emoji oder Buchstaben
//   GET  /aussehen/bilder       Bildauswahl für „Mein Hintergrund“ (Mitglieder, wenn erlaubt)
//   POST /aussehen/mein         eigenen Hintergrund wählen oder zurücksetzen (Mitglieder, JSON { bg })
const express = require('express');
const look = require('../look');
const up = require('../uploads');
const auth = require('../auth');

const router = express.Router();
const admin = (req, res, next) => (req.user && req.user.isAdmin ? next() : res.status(403).json({ error: 'Das Aussehen ändert nur der Admin.' }));

router.get('/daten', admin, (req, res) => res.json(look.editorData()));

router.post('/', admin, express.json({ limit: '256kb' }), (req, res) => {
  const l = look.save(req.body || {}, req.user);
  res.json({ ok: true, look: l });
});

router.post('/vorschau', admin, express.json({ limit: '256kb' }), (req, res) => {
  const l = look.normalize({ ...(req.body || {}), images: look.get().images });
  res.type('text/css').send(look.css(l));
});

const imgUpload = (req, res, next) => up.mediaUpload.single('image')(req, res, err => {
  if (!err) return next();
  if (req.file) up.removeQuietly(req.file.path);
  res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Das Bild ist zu groß (höchstens 25 MB).' : 'Hochladen fehlgeschlagen.' });
});
const IMG = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
router.post('/bild', admin, imgUpload, auth.csrfCheck, (req, res) => {
  const f = req.file;
  if (!f || !IMG.includes(f.mimetype)) {
    if (f) up.removeQuietly(f.path);
    return res.status(400).json({ error: 'Das ist kein Bild (PNG, JPG, WebP, AVIF oder GIF).' });
  }
  // Inhalt prüfen, nicht nur die Angabe des Browsers
  let head = Buffer.alloc(0);
  try { const fd = require('fs').openSync(f.path, 'r'); head = Buffer.alloc(16); require('fs').readSync(fd, head, 0, 16, 0); require('fs').closeSync(fd); } catch { /* unten */ }
  const ok = require('../gallery').imageType(head) || (head.toString('latin1', 4, 12) === 'ftypavif');
  if (!ok) { up.removeQuietly(f.path); return res.status(400).json({ error: 'Das ist kein Bild (PNG, JPG, WebP, AVIF oder GIF).' }); }
  up.saveMedia([f], req.user.id);
  const l = look.addImage(f.filename, f.originalname, req.body.w, req.body.h);
  res.json({ ok: true, f: f.filename, url: '/media/' + f.filename, images: l.images });
});
router.post('/bild/loeschen', admin, express.json({ limit: '4kb' }), (req, res) => {
  const f = String((req.body && req.body.f) || '');
  if (look.imageUsed(f)) return res.status(409).json({ error: 'Das Bild ist noch als Hintergrund oder Symbol eingestellt.' });
  res.json({ ok: true, images: look.removeImage(f).images });
});

router.get('/symbol.svg', (req, res) => {
  res.set({ 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.type('image/svg+xml').send(look.symbolSvg());
});

router.get('/bilder', (req, res) => {
  const l = look.get();
  if (!req.user || !l.extras.memberBg) return res.status(403).json({ error: 'Nicht erlaubt.' });
  res.json({ images: l.images.map(i => ({ f: i.f, url: '/media/' + i.f, name: i.name })), mine: look.memberBg(req.user, l) });
});
router.post('/mein', express.json({ limit: '4kb' }), (req, res) => {
  const l = look.get();
  if (!req.user || !l.extras.memberBg) return res.status(403).json({ error: 'Nicht erlaubt.' });
  const f = String((req.body && req.body.bg) || '');
  const bg = l.images.some(i => i.f === f) ? f : '';
  require('../usersettings').set(req.user.id, 'look', { bg });
  res.json({ ok: true, bg });
});

module.exports = router;
