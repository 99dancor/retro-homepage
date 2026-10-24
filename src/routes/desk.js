'use strict';
// Desktop 2.0 im Browser: Symbole auf dem Desktop (public/desk.js), Notizblock, Dateien ansehen, freigegebene Ordner,
// Suche und das Widget „Offene Lobbys“. Schreiben geht als JSON mit dem Formular-Token im Kopf x-csrf-token.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { db, getSetting, UPLOAD_DIR } = require('../db');
const auth = require('../auth');
const desk = require('../desk');
const us = require('../usersettings');
const programs = require('../programs');
const search = require('../search');
const lobbies = require('../lobbies');
const { displayName, profileUrl } = require('../profiles');

const router = express.Router();
const api = express.Router();
// Hängt unter /api: JSON lesen und nie zwischenspeichern, aber nur für die eigenen Adressen
const OWN = ['/desktop', '/eigene-dateien', '/notizblock', '/lobbys', '/suche'];
api.use(OWN, express.json({ limit: '200kb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const fail = (res, status, error) => res.status(status).json({ error });
const needLogin = (req, res, next) => (req.user ? next() : fail(res, 401, 'Bitte melde dich an.'));
const send = (res, r) => (r.error ? fail(res, 400, r.error) : res.json(r));
const origin = req => `${req.protocol}://${req.get('host')}`;
const body = req => req.body || {};

// ---------- readme.txt ----------
const readmeVersion = () => Number(getSetting('desk_readme_version', '1')) || 1;
function readmeText(user, locals) {
  const L = desk.limits();
  // Platzhalter, damit die Datei nach geänderten Grenzen nicht veraltet
  let t = (getSetting('desk_readme') || '').replace(/\{zeichen\}/g, L.chars.toLocaleString('de-DE')).replace(/\{tage\}/g, String(L.trashDays));
  if (!user) t += `\n\nOHNE KONTO\n==========\nAls Gast kannst du Symbole verschieben (das merkt sich dein Browser).\n${locals.registrationOpen ? 'Mit einem Konto (Startmenü → Registrieren…) legst du eigene Ordner, Textdokumente und Verknüpfungen an.' : 'Eigene Ordner, Textdokumente und Verknüpfungen gibt es mit einem Konto.'}\n`;
  return t;
}
// Gelesen: Der NEU-Punkt verschwindet. Kam die gelöschte readme.txt wegen einer neuen Fassung zurück, bleibt sie jetzt liegen.
function readmeSeen(user) {
  const d = us.get(user.id, 'desk'), v = readmeVersion();
  if (d.readmeSeen >= v) return;
  us.set(user.id, 'desk', { ...d, readmeSeen: v, hidden: d.hidden.filter(k => k !== 'readme') });
}

// ---------- Was auf dem Desktop liegt ----------
// Standardsymbole (Seitenverwaltung → Desktop) plus die eigenen Einträge. locals sind die res.locals der Seite.
function deskData(req, locals) {
  const u = req.user, d = us.get(u && u.id, 'desk'), version = readmeVersion();
  const progs = new Map(programs.list(locals).map(p => [p.key, p]));
  const trashN = u ? desk.trashList(u.id).length : 0;
  const items = [];
  for (const k of (getSetting('desk_defaults') || '').split(',').map(s => s.trim()).filter(Boolean)) {
    let it = null;
    if (k === 'eigene-dateien') it = u && { name: 'Eigene Dateien', icon: '🗂️', url: '/eigene-dateien' };
    else if (k === 'papierkorb') it = u && { name: 'Papierkorb', icon: '🗑️', url: '/eigene-dateien?ordner=papierkorb', full: trashN > 0 };
    else if (k === 'readme') it = { name: 'readme.txt', icon: '📄', url: '/notizblock/readme', isNew: !!u && d.readmeSeen < version };
    else if (progs.has(k)) { const p = progs.get(k); it = { name: p.name, icon: p.icon, url: p.url, link: true }; }
    if (!it || (d.hidden.includes(k) && !(k === 'readme' && it.isNew))) continue;
    const p = d.pos[k];
    items.push({ ref: k, kind: 'sys', sys: true, ...it, x: p ? p[0] : null, y: p ? p[1] : null });
  }
  if (u) items.push(...desk.children(u.id, 0, u));
  return {
    me: u ? { id: u.id, name: u.name, canUpload: !!u.canUpload } : null,
    items, arrange: d.arrange, trash: trashN, limits: desk.limits(), version,
    lobbyAllowed: !!u && getSetting('lobby_widget', '1') === '1', lobbyWidget: !!u && getSetting('lobby_widget', '1') === '1' && d.lobbies,
    search: getSetting('search_enabled', '1') === '1' && d.search,
    newLobby: lobbies.apps(locals),
    hidden: d.hidden.filter(k => k !== 'readme' || !(d.readmeSeen < version)),
  };
}

api.get('/desktop', (req, res) => res.json(deskData(req, res.locals)));
api.post('/desktop/neu', needLogin, (req, res) => send(res, desk.create(req.user, body(req), origin(req))));
api.post('/desktop/verschieben', needLogin, (req, res) => {
  const b = body(req);
  send(res, desk.move(req.user, b.refs, b.folder === 'lib' ? 'lib' : Number(b.folder) || 0));
});
api.post('/desktop/platz', needLogin, (req, res) => { desk.place(req.user, body(req).list); res.json({ ok: true }); });
// Löschen: eigene Einträge in den Papierkorb, Standardsymbole werden nur ausgeblendet (zurück unter Systemsteuerung → Desktop)
api.post('/desktop/loeschen', needLogin, (req, res) => {
  const refs = [].concat(body(req).refs || []).map(String);
  const sys = refs.filter(r => /^[\w-]{1,40}$/.test(r) && !desk.parseRef(r));
  if (sys.length) {
    const d = us.get(req.user.id, 'desk');
    us.set(req.user.id, 'desk', { ...d, hidden: [...d.hidden, ...sys], readmeSeen: sys.includes('readme') ? readmeVersion() : d.readmeSeen });
  }
  res.json({ ...desk.trash(req.user, refs.filter(r => desk.parseRef(r)), !!body(req).keep), hidden: sys.length });
});
api.post('/desktop/wiederherstellen', needLogin, (req, res) => res.json(desk.restore(req.user, body(req).refs)));
api.post('/desktop/endgueltig', needLogin, (req, res) => res.json(desk.purge(req.user, body(req).refs)));
api.post('/desktop/papierkorb-leeren', needLogin, (req, res) => res.json(desk.emptyTrash(req.user)));
api.post('/desktop/freigabe/:id', needLogin, (req, res) => send(res, desk.share(req.user, req.params.id, body(req).vis)));
// Desktop-Einstellungen aus dem Rechtsklick-Menü (Symbole anordnen, Widget) und Symbole wieder zeigen
api.post('/desktop/einstellungen', needLogin, (req, res) => {
  const b = body(req), d = us.get(req.user.id, 'desk');
  const next = { ...d };
  for (const k of ['arrange', 'lobbies', 'search']) if (b[k] !== undefined) next[k] = b[k];
  if (b.arrange && b.arrange !== 'frei') next.pos = {};
  if (Array.isArray(b.show)) next.hidden = d.hidden.filter(k => !b.show.includes(k));
  res.json({ settings: us.set(req.user.id, 'desk', next) });
});
api.post('/desktop/:id', needLogin, (req, res) => send(res, desk.update(req.user, req.params.id, body(req), origin(req))));

// Für „Speichern unter“, „Verschieben nach“ und „Öffnen“ im Notizblock
api.get('/eigene-dateien/ordner', needLogin, (req, res) => res.json({ tree: desk.tree(req.user.id) }));
api.get('/eigene-dateien/texte', needLogin, (req, res) => res.json({ texts: desk.library(req.user.id, 'text'), limits: desk.limits() }));
api.post('/notizblock/:id', needLogin, (req, res) => send(res, desk.saveText(req.user, req.params.id, body(req).body)));

api.get('/lobbys', needLogin, (req, res) => res.json({ lobbies: lobbies.list(req.user), apps: lobbies.apps(res.locals) }));
// Kein Protokoll: Der Suchbegriff landet weder in der Datenbank noch im Log
api.get('/suche', auth.rateLimit('suche', 120, 60), (req, res) => {
  if (getSetting('search_enabled', '1') !== '1') return fail(res, 404, 'Die Suche ist ausgeschaltet.');
  res.json(search.search(req.user, res.locals, String(req.query.q || ''), Math.min(20, Math.max(1, Number(req.query.n) || 3))));
});

// ---------- Notizblock ----------
function notepad(res, doc) {
  const L = desk.limits();
  res.render('notepad', { title: doc.name + ' – Notizblock', doc, maxChars: L.chars, VIS: desk.VIS, VIS_LABEL: desk.VIS_LABEL });
}
router.get('/notizblock', (req, res) => notepad(res, { id: null, name: 'Unbenannt', body: '', vis: 'private', mine: true, readonly: !req.user }));
router.get('/notizblock/readme', (req, res) => {
  if (req.user) readmeSeen(req.user);
  notepad(res, { id: 'readme', name: 'readme.txt', body: readmeText(req.user, res.locals), vis: 'public', mine: false, readonly: true, readme: true });
});
router.get('/notizblock/:id', (req, res, next) => {
  const it = desk.getItem(req.params.id);
  if (!it || it.kind !== 'text' || !desk.canSeeDesk(req.user, it)) return next();
  const mine = !!req.user && it.user_id === req.user.id;
  const owner = mine ? null : db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(it.user_id);
  notepad(res, { id: it.id, name: it.name, body: it.body || '', vis: it.visibility, mine, readonly: !mine || desk.trashed(it),
    trashed: desk.trashed(it), owner: owner && { name: displayName(owner), url: profileUrl(owner.username) }, folder: it.parent_id || 0 });
});

// ---------- Suchen (Fenster mit allen Treffern) ----------
router.get('/suche', (req, res, next) => {
  if (getSetting('search_enabled', '1') !== '1') return next();
  const q = String(req.query.q || '').slice(0, 100);
  res.render('search', { title: q ? `Suchergebnisse für „${q}“` : 'Suchen', q, result: search.search(req.user, res.locals, q, 50), GROUPS: search.GROUPS, only: String(req.query.nur || '') });
});

// ---------- Freigegebene Ordner ----------
router.get('/ordner/:token', (req, res, next) => {
  const s = desk.shared(req.params.token, req.user);
  if (!s) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diesen Ordner gibt es nicht, er ist nicht mehr freigegeben, oder du darfst ihn nicht sehen.' });
  res.render('shared-folder', { title: s.folder.name, s, ownerName: displayName(s.owner), ownerUrl: profileUrl(s.owner.username), mine: !!req.user && req.user.id === s.owner.id });
});

// ---------- Dateien ansehen ----------
// Bilder, Videos und Musik zeigt der Browser selbst, alles andere gibt es zum Herunterladen
router.get('/ansehen/datei/:id', (req, res, next) => {
  const f = desk.libRow('datei', req.params.id);
  if (!f || !auth.canSee(req.user, 'file', f)) return next();
  const by = f.uploader_id && db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(f.uploader_id);
  res.render('viewer', {
    title: f.title, name: f.title, file: f.original_name, size: f.size, date: f.created_at, mime: f.mime || '', description: f.description,
    icon: desk.fileIcon(f.mime, f.original_name), show: desk.viewable(f.mime) ? '/ansehen/datei/' + f.id + '/inhalt' : null,
    download: '/files/dl/' + f.id, by: by && { name: displayName(by), url: profileUrl(by.username) }, mine: !!req.user && req.user.id === f.uploader_id,
    vis: desk.VIS_LABEL[f.visibility] || f.visibility,
  });
});
router.get('/ansehen/datei/:id/inhalt', (req, res, next) => {
  const f = desk.libRow('datei', req.params.id);
  if (!f || !auth.canSee(req.user, 'file', f) || !desk.viewable(f.mime)) return next();
  const p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) return next();
  // Die Art steht fest (nie HTML oder SVG), nosniff verhindert, dass der Browser etwas anderes daraus macht
  res.sendFile(p, { headers: { 'Content-Type': f.mime, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; media-src 'self'", 'Cache-Control': 'private, max-age=3600' } },
    err => err && !res.headersSent && next());
});
router.get('/ansehen/medien/:id', (req, res, next) => {
  const m = desk.libRow('medien', req.params.id);
  if (!m) return next();
  const by = m.uploader_id && db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(m.uploader_id);
  res.render('viewer', {
    title: m.original_name, name: m.original_name, file: m.original_name, size: m.size, date: m.created_at, mime: m.mime || '', description: null,
    icon: '🖼️', show: '/media/' + m.stored_name, download: '/media/' + m.stored_name, by: by && { name: displayName(by), url: profileUrl(by.username) },
    mine: !!req.user && req.user.id === m.uploader_id, vis: 'Jeder mit der Adresse (Bild in Beiträgen)',
  });
});

module.exports = { router, api, deskData, readmeVersion };
