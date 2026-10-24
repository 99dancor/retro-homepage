'use strict';
// „Konto und Passwort“: ein Dialog mit Reitern (Profil, Privatsphäre, Statistik, Benachrichtigungen, Kennwort, Spielstände).
// Ersetzt die frühere Seite „Kontoeinstellungen“ (/account) und die Punkte „Profil und Statistik“, „Benachrichtigungen“
// und „Spielstände“ der Systemsteuerung. Gespeichert wird über die Formulare der einzelnen Bereiche; public/konto.js
// schickt sie bei OK und Übernehmen per fetch ab, ohne JavaScript geht jedes Formular für sich.
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const GAMES = require('../games');
const notify = require('../notify');
const p = require('../profiles');
const us = require('../usersettings');
const m = require('../messenger');

const router = express.Router();

const OK = {
  profil: 'Profil gespeichert.', bild: 'Profilbild gespeichert.', bildweg: 'Profilbild entfernt.', privat: 'Privatsphäre gespeichert.',
  notify: 'Benachrichtigungen gespeichert.', geraet: 'Gerät abgemeldet.', stats: 'Statistik gespeichert.', icu: 'Messenger gespeichert.',
  passwort: 'Kennwort geändert. Auf allen anderen Geräten bist du jetzt abgemeldet.', abgemeldet: 'Auf allen anderen Geräten abgemeldet.',
  spielstand: 'Spielstand gelöscht.', ignore: 'Liste der Ignorierten geändert.',
};
const ERR = {
  name: 'Der Anzeigename braucht 2 bis 32 Zeichen, ohne < und >.',
  taken: 'Diesen Namen benutzt schon jemand anderes.',
  big: 'Das Bild ist zu groß (höchstens 2 MB).',
  bild: 'Das ist kein Bild, das hier geht (PNG, JPEG, GIF oder WebP).',
  quadrat: 'Das Profilbild muss quadratisch sein. Beim Hochladen schneidet die Seite es zu, dafür braucht dein Browser JavaScript.',
  aktuell: 'Das aktuelle Kennwort stimmt nicht.',
  kurz: 'Das neue Kennwort braucht mindestens 8 Zeichen.',
  gleich: 'Die beiden neuen Kennwörter stimmen nicht überein.',
};
const pick = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null);
const TABS = ['profil', 'privatsphaere', 'statistik', 'benachrichtigungen', 'kennwort', 'spielstaende'];

function saves(userId) {
  const list = db.prepare(`SELECT s.app_slug, s.slot, s.updated_at, length(CAST(s.data AS BLOB)) AS size, a.title
                           FROM game_saves s LEFT JOIN apps a ON a.slug = s.app_slug
                           WHERE s.user_id = ? ORDER BY a.title, s.app_slug, s.slot`).all(userId);
  for (const s of list) {
    if (Object.hasOwn(GAMES, s.app_slug)) { s.title = GAMES[s.app_slug].title; s.url = `/${s.app_slug}/`; }
    else if (s.title) s.url = `/apps/${s.app_slug}`;
  }
  return list;
}

router.get('/konto', auth.requireLogin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const st = us.get(u.id, 'stats');
  const games = p.gameStats(u.id, req.user);
  // Spiele mit Bestenliste auch dann, wenn noch nichts gespielt wurde: Man soll vorher wählen können, anonym zu bleiben
  for (const [slug, title] of Object.entries(us.BOARD_GAMES)) if (!games.some(g => g.slug === slug)) games.push({ slug, title, stats: [], last: 0, url: '' });
  res.render('konto', {
    title: 'Konto und Passwort', tab: TABS.includes(req.query.reiter) ? req.query.reiter : 'profil',
    msg: pick(OK, req.query.ok), err: pick(ERR, req.query.err), profile: u, number: p.number(u), card: m.card(req.user, u),
    PROFILE_VIS: p.PROFILE_VIS, PM_FROM: p.PM_FROM, GB_FROM: p.GB_FROM, SEE_FROM: p.SEE_FROM, REQUEST_FROM: p.REQUEST_FROM, ignored: p.ignored(u.id),
    s: st, games: us.orderGames(games, st), SEE: us.SEE, BOARD: us.BOARD, SITE: us.SITE, BOARD_GAMES: us.BOARD_GAMES,
    notifyKinds: notify.kindsFor(req.user), notifyPrefs: notify.prefs(u.id), devices: notify.devices(u.id),
    icu: us.get(u.id, 'icu'), ICU_SOUNDS: us.ICU_SOUNDS, ICU_AWAY: us.ICU_AWAY,
    sessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND id != ?').get(u.id, req.cookies.sid || '').n,
    saves: saves(u.id),
  });
});

// Erfolg und Fehler: der Dialog fragt per fetch (JSON), ohne JavaScript geht es zurück auf den Reiter
function done(req, res, tab, key) {
  const [kind, code] = key.split('=');
  if (req.accepts(['html', 'json']) === 'json') return kind === 'err' ? res.status(400).json({ error: ERR[code] || 'Das ging nicht.' }) : res.json({ ok: true, msg: OK[code] || '' });
  res.redirect(`/konto?reiter=${tab}&${key}#${tab}`);
}

// Messenger-Einstellungen (Reiter Benachrichtigungen)
router.post('/konto/messenger', auth.requireLogin, (req, res) => {
  const b = req.body;
  us.set(req.user.id, 'icu', {
    sounds: { msg: b.snd_msg, online: b.snd_online, nudge: b.snd_nudge },
    toast: b.toast === '1', quietDnd: b.quietDnd === '1', autostart: b.autostart === '1', away: Number(b.away),
  });
  m.send(req.user.id, 'einstellungen', us.get(req.user.id, 'icu'));
  done(req, res, 'benachrichtigungen', 'ok=icu');
});

// Kennwort ändern; danach sind alle anderen Geräte abgemeldet
// /account: dorthin schickten die Formulare der früheren Seite „Kontoeinstellungen“
router.post(['/konto/kennwort', '/account'], auth.requireLogin, auth.rateLimit('pw', 10, 600), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!auth.checkPassword(String(req.body.current || ''), u.password_hash)) return done(req, res, 'kennwort', 'err=aktuell');
  if (!auth.validPassword(req.body.password)) return done(req, res, 'kennwort', 'err=kurz');
  if (req.body.password !== req.body.password2) return done(req, res, 'kennwort', 'err=gleich');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(req.body.password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(u.id, req.cookies.sid);
  done(req, res, 'kennwort', 'ok=passwort');
});
router.post('/konto/abmelden', auth.requireLogin, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.cookies.sid);
  done(req, res, 'kennwort', 'ok=abgemeldet');
});
router.post(['/konto/spielstand/loeschen', '/account/saves/delete'], auth.requireLogin, (req, res) => {
  db.prepare('DELETE FROM game_saves WHERE user_id = ? AND app_slug = ? AND slot = ?')
    .run(req.user.id, String(req.body.app || ''), String(req.body.slot || ''));
  done(req, res, 'spielstaende', 'ok=spielstand');
});

// Frühere Seite „Kontoeinstellungen“
router.get('/account', (req, res) => res.redirect(301, '/konto'));

module.exports = { router, ERR, OK, TABS };
