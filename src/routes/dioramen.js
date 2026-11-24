'use strict';
// Dancors Dioramen (Update 98, Kacheln ab Update 99): Spielstände aus Kacheln zeigen. Daten in src/dioramen.js.
//   GET  /dioramen?spiel=&sort=&q=                                 Übersicht
//   POST /dioramen/seite                                           Aufbau speichern (JSON, nur Admin, Bearbeiten-Modus)
//   GET  /dioramen/neu, POST                                       Eintrag anlegen (Admin, Recht „Schreiben“)
//   GET  /dioramen/<slug>                                          Eintragsseite
//   GET  /dioramen/<slug>/bearbeiten, POST                         Eckdaten und Dateien ändern (wer ihn angelegt hat, Admin)
//   POST /dioramen/<slug>/kacheln                                  Kacheln und Bauwerke speichern (JSON, Gestalten-Modus)
//   POST /dioramen/<slug>/kacheln/vorschau                         Kacheln als HTML für den Gestalten-Modus (JSON)
//   POST /dioramen/<slug>/bilder                                   Bilder hochladen (Gestalten-Modus, antwortet JSON)
//   POST /dioramen/<slug>/datei/<id>/loeschen, /dioramen/<slug>/loeschen
//   GET  /dioramen/dl/<id>                                         Download (zählt mit, prüft die Sichtbarkeit)
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const auth = require('../auth');
const up = require('../uploads');
const v3 = require('../v3');
const dio = require('../dioramen');
const cats = require('../filecats');
const { db, UPLOAD_DIR } = require('../db');
const { mdBlocks } = require('../util');
const ejs = require('ejs');
const TILE_VIEW = path.join(__dirname, '..', '..', 'views', 'v3', '_dio-tile.ejs');

const router = express.Router();
const loc = (req, res) => v3.locals(req, res, 'dioramen');
const needLogin = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));
const writer = (req, res, next) => (dio.canWrite(req.user) ? next() : v3.error(req, res, 403, 'Kein Schreibrecht', 'Dioramas legen der Admin und Mitglieder mit dem Recht „Schreiben“ an.'));
const OK = { neu: 'Angelegt. Mit „Gestalten“ ordnest du die Kacheln.', gespeichert: 'Gespeichert.', datei: 'Die Datei ist online.', geloescht: 'Datei gelöscht.' };

router.get('/', (req, res) => {
  const qs = k => String(req.query[k] || '').slice(0, 100);
  const view = dio.view(req.user, { spiel: qs('spiel'), art: qs('art'), sort: qs('sort'), q: qs('q') });
  res.render('v3/dioramen', {
    ...loc(req, res), ...view, title: view.layout.title, description: 'Spielstände, Bauprojekte, Sammlungen und mehr: mit Bildern, Karte, Steckbrief und Download.',
    KINDS: dio.KINDS, canWrite: dio.canWrite(req.user), isAdmin: !!(req.user && req.user.isAdmin), ok: req.query.ok === 'gespeichert' ? 'Gespeichert.' : '',
  });
});

router.post('/seite', express.json({ limit: '1mb' }), (req, res) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Nur der Admin bearbeitet die Seite.' });
  res.json({ ok: true, layout: dio.saveLayout(req.body && req.body.layout) });
});

// Download: zählt einmal je Aufruf (Fortsetzungen mit Range ab > 0 nicht)
router.get('/dl/:id', (req, res, next) => {
  const f = dio.fileById(req.params.id), d = f && dio.byId(f.dio_id);
  if (!d || !dio.canSee(req.user, d)) return next();
  const p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) return next();
  const range = /^bytes=(\d+)-/.exec(String(req.headers.range || ''));
  if (req.method !== 'HEAD' && !(range && Number(range[1]) > 0)) db.prepare('UPDATE dio_files SET downloads = downloads + 1 WHERE id = ?').run(f.id);
  res.download(p, f.original_name, err => { if (err && !res.headersSent) next(err); });
});

// ---------- Formular ----------
const IMG_FIELDS = [{ name: 'images', maxCount: 30 }, { name: 'file', maxCount: 1 }];
const formUpload = (req, res, next) => up.fileUpload.fields(IMG_FIELDS)(req, res, err => {
  if (!err) return next();
  dropFiles(req);
  return v3.error(req, res, 413, 'Zu groß', err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist zu groß (höchstens ${up.MAX_MB} MB).` : 'Hochladen fehlgeschlagen.');
});
const dropFiles = req => { for (const f of Object.values(req.files || {}).flat()) up.removeQuietly(f.path); };
const imgFiles = req => ((req.files && req.files.images) || []);

function checkUpload(req) {
  const wrong = imgFiles(req).find(f => !dio.IMAGE_TYPES.includes(f.mimetype));
  if (wrong) return `„${wrong.originalname}“ ist kein Bild. Bilder nehmen PNG, JPG, WebP oder GIF; die Datei zum Herunterladen gehört ins Feld „Datei“ im Download-Kasten.`;
  const file = ((req.files || {}).file || [])[0];
  if (file && cats.isBlocked(req.user, file.originalname)) return `„${file.originalname}“: Programme und Skripte (.${cats.extOf(file.originalname)}) werden nicht angenommen.`;
  const size = Object.values(req.files || {}).flat().reduce((n, f) => n + f.size, 0), quota = require('../quota');
  if (!req.user.isAdmin && !quota.fits(req.user, size)) return quota.fullMessage(req.user);
  return null;
}

function formView(req, res, d, extra = {}) {
  const isNew = !d || !d.id;
  const cur = d || {};
  return {
    ...loc(req, res), title: isNew ? 'Neues Diorama' : `${cur.title}: Eckdaten und Dateien`, d: cur, isNew, KINDS: dio.KINDS, K: dio.kindOf(cur), bg: cur.bg_mode !== undefined ? dio.normBg(cur) : dio.bgRaw(cur),
    images: isNew ? [] : dio.images(cur).concat(cur.cover && !dio.images(cur).some(i => i.f === cur.cover) ? [{ f: cur.cover, cap: '' }] : []),
    facts: extra.facts || (isNew ? [] : dio.facts(cur)), mods: extra.mods || (isNew ? [] : dio.mods(cur)), files: isNew ? [] : dio.files(cur),
    buildings: isNew ? [] : dio.buildings(cur), games: dio.knownGames(),
    vis: v3.visForm(req.user, 'dio', isNew ? null : cur), maxMb: up.MAX_MB, err: null, ok: OK[req.query.ok] || null, ...extra,
  };
}
// Bei einem Fehler das Formular mit dem Eingegebenen zurück
const again = (req, res, base, msg) => res.status(400).render('v3/diorama-edit', formView(req, res, { ...base, ...req.body, id: base.id || null, slug: base.slug },
  { err: msg, facts: dio.factsFrom(req.body), mods: dio.modsFrom(req.body) }));

function saveExtras(req, d) {
  const added = (req.files.images || []).map(f => dio.takeImage(f, req.user.id)).filter(Boolean);
  dio.setImages(d, req.body, added);
  const file = (req.files.file || [])[0];
  if (file) dio.addFile(req.user, d, file, req.body);
  return !!file;
}

router.get('/neu', needLogin, writer, (req, res) => res.render('v3/diorama-edit', formView(req, res, null)));
router.post('/neu', needLogin, writer, formUpload, auth.csrfCheck, (req, res) => {
  const bad = checkUpload(req);
  if (bad) { dropFiles(req); return again(req, res, {}, bad); }
  let d;
  try { d = dio.create(req.user, req.body, { visibility: v3.visibility(req.user, req.body) }); } catch (e) { dropFiles(req); return again(req, res, {}, e.message); }
  v3.saveAcl(req.user, 'dio', d.id, req.body);
  saveExtras(req, d);
  require('../events').info('Dioramas', `${dio.kindOf(d).label} „${d.title}“ angelegt von ${req.user.username}`);
  res.redirect('/dioramen/' + d.slug + '?ok=neu');
});

// Spielstand laden und Sichtbarkeit prüfen; die alte Adresse eines Bauwerks führt zu seinem Abschnitt im Spielstand
function entry(req, res, next) {
  const d = dio.bySlug(req.params.slug);
  if (!d && req.method === 'GET') {
    const m = dio.moved(req.params.slug);
    if (m && dio.canSee(req.user, m.d)) return res.redirect(301, '/dioramen/' + m.d.slug + (m.bw ? '#bw-' + m.bw : ''));
  }
  if (!d || !dio.canSee(req.user, d)) return v3.error(req, res, 404, 'Nicht gefunden', 'Diesen Eintrag gibt es nicht (oder du darfst ihn nicht sehen).');
  req.dio = d;
  next();
}
const editor = (req, res, next) => (dio.canEdit(req.user, req.dio) ? next() : v3.error(req, res, 403, 'Kein Zugriff', 'Nur wer den Eintrag angelegt hat und der Admin dürfen ihn ändern.'));
const editorJson = (req, res, next) => (dio.canEdit(req.user, req.dio) ? next() : res.status(403).json({ error: 'Nur wer den Eintrag angelegt hat und der Admin dürfen ihn gestalten.' }));

router.get('/:slug', entry, (req, res) => {
  const d = req.dio, pg = dio.page(req.user, d);
  res.render('v3/diorama', {
    ...loc(req, res), ...pg, types: dio.typesFor(d), title: d.title, description: d.summary || `${dio.kindOf(d).label}${d.game ? ' · ' + d.game : ''}`,
    ok: OK[req.query.ok] || null,
  });
});

// ---------- Gestalten: Kacheln und Bauwerke ----------
router.post('/:slug/kacheln', express.json({ limit: '2mb' }), entry, editorJson, (req, res) => {
  const out = dio.saveTiles(req.dio, req.body || {});
  res.json({ ok: true, ...out });
});
// Kacheln als HTML (so sieht jede Kachel im Gestalten-Modus genau aus wie später auf der Seite)
router.post('/:slug/kacheln/vorschau', express.json({ limit: '2mb' }), entry, editorJson, async (req, res, next) => {
  try {
    const b = req.body || {}, d = req.dio;
    const blds = dio.normBuildings(b.buildings), list = dio.normTiles(b.tiles, blds);
    const want = new Set(Array.isArray(b.only) ? b.only.map(String) : list.map(t => t.id));
    const rows = dio.resolve(d, list, blds);
    const anchors = new Map();
    for (const x of blds) { const own = list.filter(t => t.bw === x.id); const tgt = own.find(t => t.type === 'head') || own[0]; if (tgt) anchors.set(x.id, tgt.id); }
    const map = rows.find(r => r.t.type === 'map' && !r.empty);
    const locals = { types: dio.typesFor(d), K: dio.kindOf(d), anchors, mapId: map ? map.t.id : null, buildings: blds, d, edit: true };
    const html = {};
    for (const r of rows) if (want.has(r.t.id)) html[r.t.id] = await ejs.renderFile(TILE_VIEW, { ...locals, r });
    res.json({ ok: true, html, tiles: list, buildings: blds });
  } catch (e) { next(e); }
});
const imgUpload = (req, res, next) => up.fileUpload.array('images', 30)(req, res, err => {
  if (!err) return next();
  for (const f of req.files || []) up.removeQuietly(f.path);
  res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Das Bild ist zu groß (höchstens ${up.MAX_MB} MB).` : 'Hochladen fehlgeschlagen.' });
});
router.post('/:slug/bilder', needLogin, entry, editorJson, imgUpload, auth.csrfCheck, (req, res) => {
  const list = req.files || [];
  const wrong = list.find(f => !dio.IMAGE_TYPES.includes(f.mimetype));
  const size = list.reduce((n, f) => n + f.size, 0), quota = require('../quota');
  const bad = wrong ? `„${wrong.originalname}“ ist kein Bild (PNG, JPG, WebP oder GIF).` : !req.user.isAdmin && !quota.fits(req.user, size) ? quota.fullMessage(req.user) : null;
  if (bad) { for (const f of list) up.removeQuietly(f.path); return res.status(400).json({ error: bad }); }
  const added = list.map(f => dio.takeImage(f, req.user.id)).filter(Boolean);
  res.json({ ok: true, added, images: dio.addImages(req.dio, added) });
});

router.get('/:slug/bearbeiten', needLogin, entry, editor, (req, res) => res.render('v3/diorama-edit', formView(req, res, req.dio)));
router.post('/:slug/bearbeiten', needLogin, entry, editor, formUpload, auth.csrfCheck, (req, res) => {
  const bad = checkUpload(req);
  if (bad) { dropFiles(req); return again(req, res, req.dio, bad); }
  let d;
  try { d = dio.update(req.user, req.dio, req.body, { visibility: v3.visibility(req.user, req.body) }); } catch (e) { dropFiles(req); return again(req, res, req.dio, e.message); }
  v3.saveAcl(req.user, 'dio', d.id, req.body);
  const file = saveExtras(req, d);
  if (file) require('../events').info('Dioramas', `Neue Datei ${req.body.version || ''} für „${d.title}“`);
  res.redirect('/dioramen/' + d.slug + '?ok=' + (file ? 'datei' : 'gespeichert'));
});
router.post('/:slug/datei/:id/loeschen', needLogin, entry, editor, (req, res) => {
  dio.removeFile(req.dio, req.params.id);
  res.redirect('/dioramen/' + req.dio.slug + '/bearbeiten?ok=geloescht#download');
});
router.post('/:slug/loeschen', needLogin, entry, editor, (req, res) => {
  dio.remove(req.dio);
  res.redirect('/dioramen');
});

module.exports = router;
