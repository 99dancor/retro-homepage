'use strict';
// Dancors Downloads (Version 3.0): Liste mit Kategorien, Projekte mit Versionen. Daten in src/downloads.js.
//   GET  /downloads?ort=projekte|alle|neu|privat|k:<Kategorie>&q=&sort=&kat=&nur=&ansicht=gross|kompakt   Liste
//   POST /downloads/seite                                             Aufbau speichern (JSON, nur Admin, Bearbeiten-Modus)
//   GET  /downloads/neues-projekt, POST                               Projekt anlegen (wer hochladen darf)
//   GET  /downloads/<slug>                                            Projektseite
//   GET  /downloads/<slug>/bearbeiten, POST                           Projekt ändern (Besitzer, Admin)
//   POST /downloads/<slug>/version                                    neue Version hochladen
//   POST /downloads/<slug>/version/<id>/loeschen, /downloads/<slug>/loeschen
// Heruntergeladen wird wie bisher über /files/dl/<id> (zählt mit, prüft die Sichtbarkeit).
const express = require('express');
const auth = require('../auth');
const up = require('../uploads');
const v3 = require('../v3');
const dl = require('../downloads');
const cats = require('../filecats');
const { mdBlocks } = require('../util');

const router = express.Router();
const loc = (req, res) => v3.locals(req, res, 'downloads');

router.get('/', (req, res) => {
  const qs = k => String(req.query[k] || '').slice(0, 100);
  const view = dl.view(req.user, qs('ort'), req.query.q, { sort: qs('sort'), kat: qs('kat'), nur: qs('nur') });
  // Groß oder Kompakt: Wahl des Besuchers merkt sich ein Cookie, sonst gilt, was der Admin festgelegt hat
  let look = req.cookies && req.cookies.dl_look;
  if (req.query.ansicht === 'gross' || req.query.ansicht === 'kompakt') {
    look = req.query.ansicht;
    res.cookie('dl_look', look, { maxAge: 365 * 86400e3, sameSite: 'lax', httpOnly: true, secure: req.secure });
  }
  if (look !== 'gross' && look !== 'kompakt') look = view.layout.look;
  res.render('v3/downloads', {
    ...loc(req, res), ...view, look, heading: view.title, title: view.node === 'projekte' ? view.layout.title : view.title + ' – Downloads', canCreate: dl.canCreate(req.user),
    isAdmin: !!(req.user && req.user.isAdmin), ok: req.query.ok === 'gespeichert' ? 'Gespeichert.' : '',
    editData: view.canArrange ? { colors: Object.entries(dl.COLORS) } : null,
    canUpload: !!(req.user && req.user.canUpload), canSuggest: !!req.user && require('../linkreq').canSuggest(req.user), description: 'Widget, Tools, Spielstände und mehr zum Herunterladen, mit Versionen und Anleitung.',
  });
});

router.post('/seite', express.json({ limit: '1mb' }), (req, res) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Nur der Admin bearbeitet die Seite.' });
  res.json({ ok: true, layout: dl.saveLayout(req.body && req.body.layout) });
});

// Ein Formular mit Bildern und einer Datei: alles landet erst bei den Downloads, Bilder ziehen danach in die Medien um
const formUpload = (req, res, next) => up.fileUpload.fields([{ name: 'cover', maxCount: 1 }, { name: 'shots', maxCount: 10 }, { name: 'file', maxCount: 1 }])(req, res, err => {
  if (!err) return next();
  for (const f of Object.values(req.files || {}).flat()) up.removeQuietly(f.path);
  return v3.error(req, res, 413, 'Zu groß', err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist zu groß (höchstens ${up.MAX_MB} MB).` : 'Hochladen fehlgeschlagen.');
});
const dropFiles = req => { for (const f of Object.values(req.files || {}).flat()) up.removeQuietly(f.path); };
const needLogin = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));

// Prüft eine hochgeladene Version (gesperrte Endungen, Speicherplatz). Gibt eine Fehlermeldung zurück oder null.
function checkFile(req, file) {
  if (!file) return null;
  const quota = require('../quota');
  if (cats.isBlocked(req.user, file.originalname)) return `„${file.originalname}“: Programme und Skripte (.${cats.extOf(file.originalname)}) werden nicht angenommen.`;
  if (!req.user.isAdmin && !quota.fits(req.user, file.size)) return quota.fullMessage(req.user);
  return null;
}

function formView(req, res, p, extra = {}) {
  return {
    ...loc(req, res), title: p && p.id ? `${p.title} bearbeiten` : 'Neues Projekt', p: p || { icon: '📦', color: 'dl', category: 'Allgemein' },
    cats: cats.list(), COLORS: dl.COLORS, vis: v3.visForm(req.user, 'dl_project', p), shots: p && p.id ? dl.parseShots(p) : [], err: null, ...extra,
  };
}

router.get('/neues-projekt', needLogin, (req, res) => {
  if (!dl.canCreate(req.user)) return v3.error(req, res, 403, 'Kein Upload-Recht', 'Projekte legen Mitglieder an, die hochladen dürfen. Frag den Admin.');
  res.render('v3/download-edit', formView(req, res, null));
});
router.post('/neues-projekt', needLogin, (req, res, next) => (dl.canCreate(req.user) ? next() : res.status(403).end()), formUpload, auth.csrfCheck, (req, res) => {
  const b = req.body, file = (req.files.file || [])[0];
  const bad = checkFile(req, file);
  if (bad) { dropFiles(req); return res.status(400).render('v3/download-edit', formView(req, res, { ...b, id: null }, { err: bad })); }
  let p;
  try { p = dl.create(req.user, b, { visibility: v3.visibility(req.user, b) }); } catch (e) { dropFiles(req); return res.status(400).render('v3/download-edit', formView(req, res, { ...b, id: null }, { err: e.message })); }
  v3.saveAcl(req.user, 'dl_project', p.id, b);
  dl.setImages(p, { cover: dl.takeImage((req.files.cover || [])[0], req.user.id), shots: (req.files.shots || []).map(f => dl.takeImage(f, req.user.id)).filter(Boolean) });
  if (file) dl.addVersion(req.user, dl.byId(p.id), file, b);
  require('../events').info('Downloads', `Projekt „${p.title}“ angelegt von ${req.user.username}`);
  res.redirect('/downloads/' + p.slug + '?ok=neu');
});

// Projekt laden und Sichtbarkeit prüfen
function project(req, res, next) {
  const p = dl.bySlug(req.params.slug);
  if (!p || !dl.canSee(req.user, p)) return v3.error(req, res, 404, 'Nicht gefunden', 'Dieses Projekt gibt es nicht (oder du darfst es nicht sehen).');
  req.project = p;
  next();
}
const editor = (req, res, next) => (dl.canEdit(req.user, req.project) ? next() : v3.error(req, res, 403, 'Kein Zugriff', 'Nur wer das Projekt angelegt hat und der Admin dürfen es ändern.'));

const OK = { neu: 'Projekt angelegt.', gespeichert: 'Gespeichert.', version: 'Neue Version ist online.', geloescht: 'Version gelöscht.' };
router.get('/:slug', project, (req, res) => {
  const p = req.project, vs = dl.versions(req.user, p), list = cats.list();
  res.render('v3/download', {
    ...loc(req, res), title: p.title, description: p.summary, p, row: dl.projectRow(p, req.user, list), versions: vs, latest: vs[0] || null,
    body: mdBlocks(p.body_md), howto: mdBlocks(p.howto_md), changes: vs.map(f => (f.changes ? mdBlocks(f.changes) : '')), shots: dl.parseShots(p),
    canEdit: dl.canEdit(req.user, p), ok: OK[req.query.ok] || null, err: String(req.query.err || '').slice(0, 300) || null, maxMb: up.MAX_MB,
    owner: p.owner_id ? require('../db').db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(p.owner_id) : null,
  });
});
router.get('/:slug/bearbeiten', needLogin, project, editor, (req, res) => res.render('v3/download-edit', formView(req, res, req.project)));
router.post('/:slug/bearbeiten', needLogin, project, editor, formUpload, auth.csrfCheck, (req, res) => {
  const b = req.body;
  let p;
  try { p = dl.update(req.user, req.project, b, { visibility: v3.visibility(req.user, b) }); } catch (e) { dropFiles(req); return res.status(400).render('v3/download-edit', formView(req, res, { ...req.project, ...b }, { err: e.message })); }
  v3.saveAcl(req.user, 'dl_project', p.id, b);
  const drop = b.drop_shots === undefined ? [] : [].concat(b.drop_shots);
  dl.setImages(p, { cover: dl.takeImage((req.files.cover || [])[0], req.user.id), dropCover: !!b.drop_cover, shots: (req.files.shots || []).map(f => dl.takeImage(f, req.user.id)).filter(Boolean), dropShots: drop });
  for (const f of req.files.file || []) up.removeQuietly(f.path);
  res.redirect('/downloads/' + p.slug + '?ok=gespeichert');
});
router.post('/:slug/version', needLogin, project, editor, formUpload, auth.csrfCheck, (req, res) => {
  const file = (req.files.file || [])[0], p = req.project;
  const back = msg => { dropFiles(req); res.redirect(`/downloads/${p.slug}?err=${encodeURIComponent(msg)}#versionen`); };
  if (!file) return back('Bitte eine Datei wählen.');
  const bad = checkFile(req, file);
  if (bad) return back(bad);
  for (const f of [...(req.files.cover || []), ...(req.files.shots || [])]) up.removeQuietly(f.path);
  dl.addVersion(req.user, p, file, req.body);
  require('../events').info('Downloads', `Neue Version ${req.body.version || ''} von „${p.title}“`);
  res.redirect('/downloads/' + p.slug + '?ok=version#versionen');
});
router.post('/:slug/version/:id/loeschen', needLogin, project, editor, (req, res) => {
  dl.removeVersion(req.project, req.params.id);
  res.redirect('/downloads/' + req.project.slug + '?ok=geloescht#versionen');
});
router.post('/:slug/loeschen', needLogin, project, editor, (req, res) => {
  dl.remove(req.project);
  res.redirect('/downloads?ok=1');
});

module.exports = router;
