'use strict';
// Dancors Daddelecke (src/daddelecke.js):
//   GET  /spiele                         Übersicht mit „Heute“ und Regalen; der Admin bearbeitet sie direkt dort (public/v3-edit.js)
//   POST /spiele/seite                   Aufbau speichern (JSON, nur Admin)
//   GET  /spiele/neu, POST               Spiel hinzufügen (Admin und Recht „Schreiben“), multipart: datei, cover
//   GET  /spiele/<key>                   Spielseite: Spiel im Rahmen, Bestenliste, Anleitung
//   GET  /spiele/<key>/bearbeiten, POST, POST /spiele/<key>/loeschen, POST /spiele/<key>/freigeben (Admin)
//   POST /spiele/<key>/punkte            Punkte eines mitgebrachten Spiels (JSON { score })
// Spiele von Mitgliedern mit Schreibrecht laufen erst nach der Freigabe durch den Admin für alle, denn ihr Code läuft auf dieser Seite.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const auth = require('../auth');
const up = require('../uploads');
const v3 = require('../v3');
const dd = require('../daddelecke');
const { db, now, DATA_DIR, MEDIA_DIR, APPS_DIR } = require('../db');
const { mdBlocks } = require('../util');

const router = express.Router();
const loc = (req, res) => v3.locals(req, res, 'spiele');
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const TMP = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP,
    filename: (req, file, cb) => {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10));
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 2 },
}).fields([{ name: 'datei', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);
const WRITER_MB = 300;
const OK = { neu: 'Spiel hinzugefügt. Probier es gleich aus.', gespeichert: 'Gespeichert.', geloescht: 'Spiel gelöscht.', freigegeben: 'Freigegeben: jetzt sehen es alle.', wartet: 'Gespeichert. Der Admin schaut es sich an und gibt es frei, dann sehen es alle.' };

const writer = (req, res, next) => (dd.canAdd(req.user) ? next() : req.user
  ? v3.error(req, res, 403, 'Kein Schreibrecht', 'Spiele fügen der Admin und Mitglieder mit dem Recht „Schreiben“ hinzu.')
  : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));

// ---------- Übersicht ----------
router.get('/', (req, res) => {
  const admin = !!(req.user && req.user.isAdmin);
  const v = dd.view(req.user, res.locals, { edit: admin });
  res.render('v3/spiele', {
    ...loc(req, res), title: v.layout.title, description: 'Sudoku, Minesweeper, Kartenspiele und mehr: direkt im Browser spielen.',
    v, today: dd.today(req.user, res.locals, v), live: dd.live(req.user), canAdd: dd.canAdd(req.user), admin,
    pending: admin ? dd.pending() : [], COLORS: dd.COLORS, ok: OK[req.query.ok] || null,
    editData: admin ? { layout: v.layout, games: [...v.all.values()].map(g => ({ key: g.key, title: g.title, icon: g.icon, color: g.color, text: g.text, cover: g.cover || '' })) } : null,
  });
});

router.post('/seite', express.json({ limit: '1mb' }), (req, res) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Nur der Admin bearbeitet die Seite.' });
  const l = dd.saveLayout(req.body && req.body.layout);
  res.json({ ok: true, layout: l });
});

// ---------- Hinzufügen und Bearbeiten ----------
function form(req, res, a, extra = {}) {
  const l = dd.layout();
  const shelf = a.slug ? (l.shelves.find(s => s.games.includes(a.slug)) || {}).id : req.query.regal;
  res.render('v3/spiel-edit', {
    ...loc(req, res), title: a.id ? `${a.title} bearbeiten` : 'Spiel hinzufügen', a, shelves: l.shelves, shelf: shelf || 'mitgebracht',
    KINDS: dd.KINDS, ASPECTS: dd.ASPECTS, CONTROLS: dd.CONTROLS, SCORES: dd.SCORES, COLORS: dd.COLORS,
    vis: v3.visForm(req.user, 'app', a), err: null, ...extra,
  });
}
router.get('/neu', writer, (req, res) => form(req, res, { kind: dd.KINDS[req.query.art] ? req.query.art : 'html', visibility: 'public', aspect: '16:9', fresh: 1 }));

function loadApp(req, res, next) {
  const a = dd.appBySlug(req.params.key);
  if (!a || !dd.canSeeApp(req.user, a)) return next('route');
  req.app_ = a;
  next();
}
const editor = (req, res, next) => (dd.canEditApp(req.user, req.app_) ? next() : v3.error(req, res, 403, 'Nicht deins', 'Dieses Spiel bearbeiten der Admin und wer es hinzugefügt hat.'));
router.get('/:key/bearbeiten', loadApp, editor, (req, res) => form(req, res, req.app_));

const drop = req => { for (const f of Object.values(req.files || {}).flat()) up.removeQuietly(f.path); };
const ext = f => path.extname(f.originalname || '').toLowerCase();

// Datei an ihren Platz: data/apps/<slug>, je nach Art. Gibt den Einstieg zurück (Datei, die im Rahmen geladen wird).
function storeGame(kind, file, slug, title, cmd) {
  const target = path.join(APPS_DIR, slug);
  const fresh = () => { fs.rmSync(target, { recursive: true, force: true }); fs.mkdirSync(target, { recursive: true }); };
  const e = ext(file);
  if (kind === 'html') {
    if (!/^\.html?$/.test(e)) throw new Error('Bitte eine .html-Datei hochladen.');
    fresh();
    fs.renameSync(file.path, path.join(target, 'index.html'));
    up.compressFile(path.join(target, 'index.html'));
    return 'index.html';
  }
  if (kind === 'zip') {
    if (e !== '.zip') throw new Error('Bitte ein .zip hochladen.');
    const dir = up.extractApp(file.path, slug);
    return up.findEntry(dir);
  }
  if (kind === 'flash') {
    if (e !== '.swf') throw new Error('Bitte eine .swf-Datei hochladen.');
    fresh();
    fs.renameSync(file.path, path.join(target, 'spiel.swf'));
    fs.writeFileSync(path.join(target, 'index.html'), dd.playerHtml('flash', 'spiel.swf', title));
    return 'index.html';
  }
  if (kind === 'dos') {
    if (e === '.jsdos') {
      fresh();
      fs.renameSync(file.path, path.join(target, 'spiel.jsdos'));
    } else if (e === '.zip') {
      const dir = up.extractApp(file.path, slug);
      const bundle = dd.dosBundle(dir, cmd);
      // Nur das fertige Paket bleibt
      for (const n of fs.readdirSync(dir)) if (n !== bundle) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
      if (bundle !== 'spiel.jsdos') fs.renameSync(path.join(dir, bundle), path.join(dir, 'spiel.jsdos'));
    } else throw new Error('Bitte ein .zip mit dem Spiel oder eine .jsdos-Datei hochladen.');
    fs.writeFileSync(path.join(target, 'index.html'), dd.playerHtml('dos', 'spiel.jsdos', title));
    return 'index.html';
  }
  throw new Error('Unbekannte Art.');
}
function storeCover(req) {
  const f = req.files && req.files.cover && req.files.cover[0];
  if (!f) return null;
  if (!IMAGE.test(ext(f))) { up.removeQuietly(f.path); throw new Error('Das Titelbild muss ein Bild sein (PNG, JPG, GIF, WebP).'); }
  if (f.size > 25 * 1024 * 1024) { up.removeQuietly(f.path); throw new Error('Das Titelbild ist zu groß (höchstens 25 MB).'); }
  const name = path.basename(f.path);
  fs.renameSync(f.path, path.join(MEDIA_DIR, name));
  up.saveMedia([{ filename: name, originalname: f.originalname, mimetype: f.mimetype, size: f.size }], req.user.id);
  return '/media/' + name;
}

function save(req, res) {
  const b = req.body, old = req.app_ || null, admin = req.user.isAdmin;
  const kind = old ? old.kind : (dd.KINDS[b.kind] ? b.kind : 'html');
  const file = req.files && req.files.datei && req.files.datei[0];
  const a = {
    ...(old || {}), kind, title: str(b.title, 120).replace(/\s+/g, ' ') || 'Spiel', description: str(b.description, 240).replace(/\s+/g, ' '),
    howto_md: str(b.howto_md, 20000), icon: [...str(b.icon, 8)].slice(0, 2).join('') || '🕹️', color: Object.hasOwn(dd.COLORS, b.color) ? b.color : 'lila',
    aspect: Object.hasOwn(dd.ASPECTS, b.aspect) ? b.aspect : '16:9', source: str(b.source, 300).replace(/\s+/g, ' '),
    controls: [].concat(b.controls || []).filter(c => Object.hasOwn(dd.CONTROLS, c)).join(','), score_mode: Object.hasOwn(dd.SCORES, b.score_mode) ? b.score_mode : '',
    dos_cmd: dd.cleanCmd(b.dos_cmd), fresh: b.fresh ? 1 : 0, visibility: v3.visibility(req.user, b),
  };
  const back = err => { drop(req); form(req, res, a, { err }); };
  if (!admin && file && file.size > WRITER_MB * 1024 * 1024) return back(`Die Datei ist zu groß (höchstens ${WRITER_MB} MB).`);
  if (kind === 'link') {
    a.external_url = dd.embedUrl(b.external_url);
    if (!a.external_url) return back('Bitte eine https-Adresse oder einen Einbettungscode (<iframe src="https://…">) angeben.');
  } else if (!old && !file) return back('Bitte die Datei des Spiels auswählen.');
  const slug = old ? old.slug : dd.slugFor(b.slug || a.title);
  try {
    const cover = storeCover(req);
    if (cover) a.cover = cover;
    if (b.drop_cover && !cover) a.cover = null;
    if (file && kind !== 'link') a.entry = storeGame(kind, file, slug, a.title, a.dos_cmd);
  } catch (e) { return back(e.message); }
  if (kind === 'link') a.entry = 'index.html';
  // Mitglieder: neu und bei einer neuen Datei erst nach Freigabe für alle sichtbar
  a.approved = admin ? 1 : old && !file && old.approved ? 1 : 0;
  const t = now();
  const cols = ['title', 'description', 'howto_md', 'icon', 'color', 'aspect', 'source', 'controls', 'score_mode', 'dos_cmd', 'fresh', 'visibility', 'external_url', 'entry', 'cover', 'approved', 'kind'];
  const vals = cols.map(c => a[c] ?? null);
  let id = old && old.id;
  if (old) db.prepare(`UPDATE apps SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, t, old.id);
  else id = Number(db.prepare(`INSERT INTO apps(${cols.join(', ')}, slug, author_id, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?, ?)`).run(...vals, slug, req.user.id, t, t).lastInsertRowid);
  v3.saveAcl(req.user, 'app', id, b);
  const l = dd.layout(), cur = l.shelves.find(s => s.games.includes(slug));
  if (req.user.isAdmin && b.shelf && (!cur || cur.id !== b.shelf)) dd.place(slug, b.shelf);
  else if (!old) dd.place(slug, req.user.isAdmin ? b.shelf : 'mitgebracht');
  if (!a.approved) {
    try { require('../notify').toAdmins('🕹️ Neues Spiel wartet auf Freigabe: ' + a.title, 'von ' + req.user.name, '/spiele/' + slug, 'admin:spiele'); } catch { /* egal */ }
  }
  res.redirect(`/spiele/${slug}?ok=${a.approved ? (old ? 'gespeichert' : 'neu') : 'wartet'}`);
}
router.post('/neu', writer, upload, auth.csrfCheck, save);
router.post('/:key/bearbeiten', loadApp, editor, upload, auth.csrfCheck, save);

router.post('/:key/loeschen', loadApp, editor, (req, res) => {
  const a = req.app_;
  up.removeQuietly(path.join(APPS_DIR, a.slug));
  db.prepare('DELETE FROM apps WHERE id = ?').run(a.id);
  dd.unplace(a.slug);
  res.redirect('/spiele?ok=geloescht');
});
router.post('/:key/freigeben', loadApp, (req, res) => {
  if (!req.user || !req.user.isAdmin) return v3.error(req, res, 403, 'Nur der Admin', 'Spiele gibt nur der Admin frei.');
  db.prepare('UPDATE apps SET approved = 1 WHERE id = ?').run(req.app_.id);
  res.redirect(`/spiele/${req.app_.slug}?ok=freigegeben`);
});
router.post('/:key/punkte', auth.rateLimit('ddscore', 120, 600), express.json({ limit: '4kb' }), loadApp, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login' });
  const okd = dd.addScore(req.app_, req.user, req.body && req.body.score);
  res.json({ ok: okd, board: okd ? dd.scoreBoard(req.app_, req.user, 10) : [] });
});

// ---------- Spielseite ----------
router.get('/:key', (req, res, next) => {
  const key = String(req.params.key);
  const g = dd.card(req.user, res.locals, key);
  if (!g || ((g.off || g.hidden) && !(req.user && req.user.isAdmin))) return next();
  if (g.locked) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  let src = g.src;
  if (g.kind === 'builtin' || g.kind === 'ds') {
    const u = new URL(src, 'http://x');
    u.searchParams.set('embed', '');
    if (!g.retro) u.searchParams.set('look', 'modern');
    if (g.cards && req.query.tisch) u.searchParams.set('tisch', str(req.query.tisch, 40));
    src = u.pathname + u.search.replace(/embed=(&|$)/, 'embed$1');
  }
  const a = g.app;
  if (a) {
    db.prepare('UPDATE apps SET plays = plays + 1 WHERE id = ?').run(a.id);
    try { require('../profiles').countStart(req.user, a.slug); } catch { /* nur Statistik */ }
  }
  const l = dd.layout(), shelf = l.shelves.find(s => s.games.includes(key));
  res.render('v3/spiel', {
    ...loc(req, res), title: g.title, description: g.text, g, src, a: a || null, shelf,
    bodyClass: g.kind === 'builtin' && !g.retro ? 'dd-host' : '',
    howto: a && a.howto_md ? mdBlocks(a.howto_md) : '', boards: dd.boards(req.user, g), tables: g.cards ? dd.tablesFor(req.user, g.cards) : [],
    canEdit: a ? dd.canEditApp(req.user, a) : false, admin: !!(req.user && req.user.isAdmin), KINDS: dd.KINDS, CONTROLS: dd.CONTROLS, ASPECTS: dd.ASPECTS,
    ok: OK[req.query.ok] || null,
  });
});

module.exports = router;
