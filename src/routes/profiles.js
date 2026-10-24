'use strict';
// Profile unter /nutzer/<name>, Freundschaften, Freundebuch, Profil-Einstellungen (Konto und Passwort → Profil)
// und die Schnittstelle für Spielstatistiken. Mitglieder finden und Gespräche laufen im Messenger (src/routes/messenger.js).
const express = require('express');
const multer = require('multer');
const { db, getSetting } = require('../db');
const auth = require('../auth');
const p = require('../profiles');
const GAMES = require('../games');
const paint = require('../paint');
const notify = require('../notify');
const us = require('../usersettings');
const desk = require('../desk');
const m = require('../messenger');

const router = express.Router();
// Vorschau des eigenen Profils: welche Sichtbarkeiten (von Profil und Links) der jeweilige Betrachter sehen würde
const PREVIEW = { guest: ['public'], member: ['public', 'members'], friend: ['public', 'members', 'friends'] };
// Rücksprung nach einem Formular: nur Pfade dieser Seite
const back = (v, fallback) => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : fallback);
const notFound = res => res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Mitglied gibt es nicht (mehr).' });

// ---------- Profil ----------
router.get('/nutzer/:name', (req, res) => {
  const u = p.findUser(req.params.name);
  const me = req.user;
  if (!u || (u.disabled && !(me && me.isAdmin))) return notFound(res);
  const relation = me ? p.friendship(me.id, u.id) : 'none';
  // ?ansicht=guest|member|friend: Der Besitzer sieht sein Profil so wie andere (Systemsteuerung → Profil und Statistik)
  const preview = me && me.id === u.id && Object.hasOwn(PREVIEW, req.query.ansicht) ? req.query.ansicht : null;
  const visible = preview ? PREVIEW[preview].includes(u.profile_visibility) : p.canViewProfile(me, u);
  const data = {
    title: p.displayName(u) + ' – Profil', u, relation, visible, preview, canMessage: p.canMessage(me, u), msg: Object.hasOwn(p.FRIEND_MSG, req.query.ok || '') ? p.FRIEND_MSG[req.query.ok] : null,
    card: m.card(preview ? null : me, u), canInvite: !preview && m.canInvite(me, u), canRequest: !!me && p.canRequest(me.id, u),
    ignoring: !!me && !!db.prepare('SELECT 1 FROM ignores WHERE user_id = ? AND other_id = ?').get(me.id, u.id), STATUS: m.STATUS,
  };
  if (visible) {
    const view = us.profileView(u.id, me, p.gameStats(u.id, me), preview);
    const boardOpen = getSetting('board_enabled') === '1' && (getSetting('board_members_only') !== '1' || me);
    const tv = auth.visibilitySql(me, 'track', 't');
    const both = me && !preview && me.id !== u.id;
    Object.assign(data, {
      friends: p.friendsOf(u.id),
      // „Ihr beide“: nur, was beide ohnehin sehen dürfen
      common: both ? p.commonFriends(me.id, u.id) : [], since: both ? p.friendsSince(me.id, u.id) : null,
      talked: both ? db.prepare('SELECT COUNT(*) AS n FROM private_messages WHERE (from_id = ? AND to_id = ? AND hidden_from = 0) OR (from_id = ? AND to_id = ? AND hidden_to = 0)').get(me.id, u.id, u.id, me.id).n : 0,
      guestbook: u.gb_from === 'off' ? null : p.guestbookOf(u.id),
      canSign: p.canSign(me, u), maxGb: p.MAX_GB,
      games: view.games, showcase: view.showcase, onSite: view.site, siteSettings: view.siteSettings, rel: view.rel,
      // Internetlinks vom Desktop, die der Betrachter sehen darf; der Besitzer sieht auch private (grau)
      links: db.prepare("SELECT * FROM desk_items WHERE user_id = ? AND kind = 'link' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE LIMIT 50").all(u.id)
        .filter(it => (preview ? PREVIEW[preview].includes(it.visibility) : desk.canSeeDesk(me, it)) && !desk.trashed(it))
        .map(it => ({ name: it.name, url: it.target, icon: it.icon || '🌐', host: desk.hostOf(it.target), private: it.visibility === 'private' })),
      // Bilder aus Paint, die der Betrachter sehen darf (die neuesten acht)
      artworks: paint.galleryOn() ? paint.byUser(u.id, me, 9).map(a => paint.row(a, me)) : null,
      counts: {
        // Anonyme Beiträge zählen nicht mit, sonst ließen sie sich zuordnen
        posts: db.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE user_id = ? AND anonymous = 0').get(u.id).n,
        topics: db.prepare('SELECT COUNT(*) AS n FROM board_topics WHERE user_id = ? AND anonymous = 0').get(u.id).n,
        guestbook: db.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE user_id = ? AND approved = 1').get(u.id).n,
        tracks: db.prepare(`SELECT COUNT(*) AS n FROM tracks t WHERE t.uploader_id = ? AND ${tv.sql}`).get(u.id, ...tv.params).n,
      },
      boardOpen,
      recent: boardOpen ? db.prepare(`SELECT p.id, p.created_at, t.id AS topic_id, t.title FROM board_posts p JOIN board_topics t ON t.id = p.topic_id
                                      WHERE p.user_id = ? AND p.anonymous = 0 ORDER BY p.created_at DESC, p.id DESC LIMIT 5`).all(u.id) : [],
    });
  }
  res.render('profile', data);
});

router.post('/nutzer/:name/freund', auth.requireLogin, auth.rateLimit('friends', 60, 600), (req, res) => {
  const u = p.findUser(req.params.name);
  if (!u || u.disabled) return notFound(res);
  const msg = p.friendAction(req.user.id, u.id, String(req.body.action || ''), req.body.note);
  const me = p.displayName(req.user), key = 'friend:' + req.user.id;
  if (msg === 'gesendet') {
    const note = p.cleanNote(req.body.note);
    notify.send(u.id, 'friend', { key, title: `👥 ${me} möchte mit dir befreundet sein`, body: note ? '„' + note + '“' : 'Annehmen oder ablehnen kannst du im Messenger.', url: '/messenger/anfrage/' + encodeURIComponent(req.user.username) });
  }
  else if (msg === 'freunde') {
    notify.readKey(req.user.id, 'friend:' + u.id);
    notify.send(u.id, 'friend', { key, title: `👥 ${me} hat deine Freundschaftsanfrage angenommen`, body: 'Ihr seid jetzt Freunde.', url: p.profileUrl(req.user.username) });
  } else if (msg === 'abgelehnt') notify.readKey(req.user.id, 'friend:' + u.id);
  // Beide Kontaktlisten zeigen den neuen Stand sofort
  if (msg && msg !== 'nein' && msg !== 'voll') { m.send(req.user.id, 'kontakte'); m.send(u.id, 'kontakte'); }
  // Das Nutzermenü in Lobbys fragt per fetch und will nur wissen, wie es jetzt steht
  if (req.accepts(['html', 'json']) === 'json') return res.json({ ok: !!msg, msg: msg ? p.FRIEND_MSG[msg] : null, relation: p.friendship(req.user.id, u.id) });
  const to = back(req.body.back, p.profileUrl(u.username));
  res.redirect(to.split('?')[0] + (msg ? '?ok=' + msg : ''));
});

// Kurzinfo für das Nutzermenü (public/usermenu.js), z. B. beim Klick auf einen Namen in einer Lobby
router.get('/api/nutzer/:name', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = p.findUser(req.params.name);
  const me = req.user;
  if (!u || (u.disabled && !(me && me.isAdmin))) return res.status(404).json({ error: 'Dieses Mitglied gibt es nicht (mehr).' });
  res.json({
    id: u.id, user: u.username, name: p.displayName(u), avatar: u.avatar ? '/avatar/' + u.avatar : null, admin: u.role === 'admin',
    url: p.profileUrl(u.username), visible: p.canViewProfile(me, u),
    relation: me ? p.friendship(me.id, u.id) : 'none', canMessage: p.canMessage(me, u), canRequest: !!me && p.canRequest(me.id, u),
    status: m.statusFor(me, u), number: p.number(u),
    me: me ? { id: me.id, admin: me.isAdmin } : null,
  });
});

// ---------- Freundebuch im Profil ----------
router.post('/nutzer/:name/freundebuch', auth.requireLogin, auth.rateLimit('pgb', 10, 600), (req, res) => {
  const u = p.findUser(req.params.name);
  if (!u || u.disabled) return notFound(res);
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, p.MAX_GB);
  if (body && p.canSign(req.user, u)) {
    const id = p.signGuestbook(u.id, req.user.id, body);
    return res.redirect(p.profileUrl(u.username) + '#g' + id);
  }
  res.redirect(p.profileUrl(u.username) + '#freundebuch');
});
router.post('/nutzer/:name/freundebuch/:id/loeschen', auth.requireLogin, (req, res) => {
  const u = p.findUser(req.params.name);
  if (!u) return notFound(res);
  p.deleteGuestbookEntry(req.user, u.id, Number(req.params.id));
  res.redirect(p.profileUrl(u.username) + '#freundebuch');
});

// ---------- Profil-Einstellungen (Konto und Passwort → Profil und Privatsphäre) ----------
// Der Dialog speichert per fetch (Antwort JSON), ohne JavaScript leiten die Formulare zurück.
const accountBack = (res, key, tab = 'profil') => res.redirect(`/konto?reiter=${tab}&${key}#${tab}`);
const { ERR: ACCOUNT_ERR, OK: ACCOUNT_OK } = require('./konto');
function accountDone(req, res, key, tab = 'profil') {
  const [kind, code] = key.split('=');
  if (req.accepts(['html', 'json']) === 'json') return kind === 'err' ? res.status(400).json({ error: ACCOUNT_ERR[code] || 'Das ging nicht.' }) : res.json({ ok: true, msg: ACCOUNT_OK[code] || '' });
  accountBack(res, key, tab);
}
router.post('/account/profil', auth.requireLogin, (req, res) => {
  const b = req.body;
  const name = p.cleanDisplayName(b.display_name);
  if (name === null) return accountDone(req, res, 'err=name');
  if (name && name.toLowerCase() !== req.user.username.toLowerCase() && p.nameTaken(name, req.user.id)) return accountDone(req, res, 'err=taken');
  db.prepare('UPDATE users SET display_name = ?, about = ? WHERE id = ?').run(
    name && name !== req.user.username ? name : null,
    String(b.about || '').replace(/\r\n/g, '\n').trim().slice(0, 1000) || null,
    req.user.id);
  if (typeof b.status_msg === 'string') m.setStatus(req.user.id, undefined, b.status_msg);
  // Ältere Formulare schicken die Privatsphäre mit
  if (b.profile_visibility !== undefined) savePrivacy(req.user.id, b);
  accountDone(req, res, 'ok=profil');
});
// Wer darf was (Konto und Passwort → Privatsphäre). Fehlt ein Feld, bleibt es, wie es ist.
function savePrivacy(userId, b) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const val = (k, map) => (Object.hasOwn(map, b[k]) ? b[k] : u[k]);
  db.prepare(`UPDATE users SET profile_visibility = ?, pm_from = ?, gb_from = ?, presence_from = ?, activity_from = ?, invite_from = ?,
              request_from = ?, show_last_seen = ? WHERE id = ?`).run(
    val('profile_visibility', p.PROFILE_VIS), val('pm_from', p.PM_FROM), val('gb_from', p.GB_FROM),
    val('presence_from', p.SEE_FROM), val('activity_from', p.SEE_FROM), val('invite_from', p.SEE_FROM), val('request_from', p.REQUEST_FROM),
    b.show_last_seen === undefined ? u.show_last_seen : b.show_last_seen === '1' ? 1 : 0, userId);
  m.send(userId, 'kontakte');
  for (const f of p.friendsOf(userId)) m.send(f.id, 'kontakte');
}
router.post('/konto/privatsphaere', auth.requireLogin, (req, res) => {
  savePrivacy(req.user.id, { show_last_seen: '0', ...req.body });
  accountDone(req, res, 'ok=privat', 'privatsphaere');
});

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: p.AVATAR_MAX, files: 1 } }).single('avatar');
router.post('/account/avatar', auth.requireLogin, auth.rateLimit('avatar', 20, 3600), (req, res, next) => avatarUpload(req, res, err => {
  if (err) return accountDone(req, res, err.code === 'LIMIT_FILE_SIZE' ? 'err=big' : 'err=bild');
  next();
}), auth.csrfCheck, (req, res) => {
  if (!req.file) return accountDone(req, res, 'err=bild');
  let name;
  try { name = p.saveAvatar(req.file.buffer); } catch (e) { return accountDone(req, res, e.code === 'quadrat' ? 'err=quadrat' : 'err=bild'); }
  p.removeAvatar(req.user.avatar);
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(name, req.user.id);
  accountDone(req, res, 'ok=bild');
});
router.post('/account/avatar/loeschen', auth.requireLogin, (req, res) => {
  p.removeAvatar(req.user.avatar);
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  accountDone(req, res, 'ok=bildweg');
});

router.get('/avatar/:name', (req, res, next) => {
  if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(req.params.name)) return next();
  res.sendFile(req.params.name, { root: require('../db').AVATAR_DIR, maxAge: '30d', immutable: true, headers: { 'Content-Security-Policy': "default-src 'none'" } }, err => err && next());
});

// ---------- Spielstatistiken ----------
// Spiele unter /apps/<slug>/play und die eingebauten Spiele melden Zahlen für das Profil:
// PATCH statt POST: Wie bei den Spielständen braucht es so kein Formular-Token, und fremde Seiten dürfen es nicht schicken.
//   GET   /api/stats/<app>  -> { stats: { "Siege": 3, … } }      (401 ohne Login)
//   PATCH /api/stats/<app> <- { add: { Siege: 1 }, max: { Höchstpunktzahl: 1200 }, min: {…}, set: {…} } als JSON
const stats = express.Router();
stats.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
function statsApp(req, res, next) {
  // Spiele, die ihre Zahlen selbst auf dem Server zählen (Blackjack), nehmen nichts vom Browser an
  if (Object.hasOwn(GAMES, req.params.app) && GAMES[req.params.app].userStats) return res.status(404).json({ error: 'app' });
  if (!Object.hasOwn(GAMES, req.params.app)) {
    const a = db.prepare('SELECT * FROM apps WHERE slug = ?').get(req.params.app);
    if (!a || !auth.canSee(req.user, 'app', a)) return res.status(404).json({ error: 'app' });
  }
  if (!req.user) return res.status(401).json({ error: 'login' });
  next();
}
stats.get('/:app', statsApp, (req, res) => res.json({ stats: p.ownStats(req.user.id, req.params.app) }));
stats.patch('/:app', auth.rateLimit('stats', 120, 60), statsApp, express.json({ limit: '20kb' }), (req, res) => {
  if (!req.is('application/json')) return res.status(415).json({ error: 'json' });
  // Wer bisher den Rekord hielt (nur bei „max“-Werten), bekommt Bescheid, wenn er geknackt wird
  const maxes = req.body && req.body.max && typeof req.body.max === 'object' ? Object.entries(req.body.max).filter(([, v]) => typeof v === 'number').slice(0, 50) : [];
  const before = maxes.map(([key]) => db.prepare('SELECT user_id, value FROM game_stats WHERE app_slug = ? AND key = ? ORDER BY value DESC, updated_at LIMIT 1').get(req.params.app, key));
  const err = p.recordStats(req.user.id, req.params.app, req.body);
  if (err) return res.status(400).json({ error: err });
  maxes.forEach(([key, value], i) => {
    const prev = before[i];
    if (!prev || prev.user_id === req.user.id || !(value > prev.value)) return;
    const g = Object.hasOwn(GAMES, req.params.app) ? { title: GAMES[req.params.app].title, url: GAMES[req.params.app].url || `/${req.params.app}/` }
      : { title: (db.prepare('SELECT title FROM apps WHERE slug = ?').get(req.params.app) || {}).title || req.params.app, url: `/apps/${req.params.app}` };
    notify.send(prev.user_id, 'highscore', {
      title: `🏆 ${us.recordName(req.params.app, req.user.id, p.displayName(req.user))} hat deinen Rekord in ${g.title} geknackt`,
      body: `${key}: ${value.toLocaleString('de-DE')} (dein Rekord: ${prev.value.toLocaleString('de-DE')})`, url: g.url,
    });
  });
  res.json({ ok: true, stats: p.ownStats(req.user.id, req.params.app) });
});
stats.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.status ? 'request' : 'server' }));

module.exports = { router, stats };
