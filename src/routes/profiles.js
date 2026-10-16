'use strict';
// Mitglieder (Startmenü → 👥 Mitglieder), Profile unter /nutzer/<name>, Freunde, Privatnachrichten,
// Profil-Einstellungen in „Mein Konto“ und die Schnittstelle für Spielstatistiken.
const express = require('express');
const multer = require('multer');
const { db, getSetting } = require('../db');
const auth = require('../auth');
const p = require('../profiles');
const GAMES = require('../games');
const paint = require('../paint');
const notify = require('../notify');

const router = express.Router();
const PER_PAGE = 50;
// Rücksprung nach einem Formular: nur Pfade dieser Seite
const back = (v, fallback) => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : fallback);
const notFound = res => res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Mitglied gibt es nicht (mehr).' });

// ---------- Mitglieder ----------
router.get('/nutzer', (req, res) => {
  const me = req.user;
  const q = String(req.query.q || '').trim().slice(0, 50);
  const page = Math.max(1, Number(req.query.page) || 1);
  const params = [];
  let where = 'u.disabled = 0';
  // Gäste finden nur Profile, die für alle sichtbar sind
  if (!me) where += " AND u.profile_visibility = 'public'";
  if (q) { where += ' AND (u.username LIKE ? OR u.display_name LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`).get(...params).n;
  const members = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.created_at FROM users u WHERE ${where}
                              ORDER BY COALESCE(u.display_name, u.username) COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, PER_PAGE, (page - 1) * PER_PAGE);
  const friends = me ? p.friendsOf(me.id) : [];
  const friendIds = new Set(friends.map(f => f.id));
  for (const m of members) m.friend = friendIds.has(m.id);
  res.render('members', {
    title: 'Mitglieder', q, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, members, friends,
    incoming: me ? p.requestsTo(me.id) : [], outgoing: me ? p.requestsFrom(me.id) : [],
    msg: Object.hasOwn(p.FRIEND_MSG, req.query.ok || '') ? p.FRIEND_MSG[req.query.ok] : null,
  });
});

router.get('/nutzer/:name', (req, res) => {
  const u = p.findUser(req.params.name);
  const me = req.user;
  if (!u || (u.disabled && !(me && me.isAdmin))) return notFound(res);
  const relation = me ? p.friendship(me.id, u.id) : 'none';
  const visible = p.canViewProfile(me, u);
  const data = { title: p.displayName(u), u, relation, visible, canMessage: p.canMessage(me, u), msg: Object.hasOwn(p.FRIEND_MSG, req.query.ok || '') ? p.FRIEND_MSG[req.query.ok] : null };
  if (visible) {
    const boardOpen = getSetting('board_enabled') === '1' && (getSetting('board_members_only') !== '1' || me);
    const tv = auth.visibilitySql(me, 'track', 't');
    Object.assign(data, {
      friends: p.friendsOf(u.id),
      guestbook: u.gb_from === 'off' ? null : p.guestbookOf(u.id),
      canSign: p.canSign(me, u), maxGb: p.MAX_GB,
      games: p.gameStats(u.id, me),
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
  const msg = p.friendAction(req.user.id, u.id, String(req.body.action || ''));
  const me = p.displayName(req.user), key = 'friend:' + req.user.id;
  if (msg === 'gesendet') notify.send(u.id, 'friend', { key, title: `👥 ${me} möchte mit dir befreundet sein`, body: 'Annehmen oder ablehnen kannst du unter Mitglieder.', url: '/nutzer' });
  else if (msg === 'freunde') {
    notify.readKey(req.user.id, 'friend:' + u.id);
    notify.send(u.id, 'friend', { key, title: `👥 ${me} hat deine Freundschaftsanfrage angenommen`, body: 'Ihr seid jetzt Freunde.', url: p.profileUrl(req.user.username) });
  } else if (msg === 'abgelehnt') notify.readKey(req.user.id, 'friend:' + u.id);
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
    relation: me ? p.friendship(me.id, u.id) : 'none', canMessage: p.canMessage(me, u),
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

// ---------- Privatnachrichten ----------
router.get('/nachrichten', auth.requireLogin, (req, res) => {
  if (req.query.an) {
    const u = p.findUser(String(req.query.an).trim().replace(/^@/, ''));
    if (u && !u.disabled) return res.redirect('/nachrichten/' + encodeURIComponent(u.username));
  }
  res.render('messages', {
    title: 'Nachrichten', conversations: p.conversations(req.user.id), friends: p.friendsOf(req.user.id),
    err: req.query.an ? 'Dieses Mitglied gibt es nicht.' : null,
  });
});

function loadPartner(req, res, next) {
  const u = p.findUser(req.params.name);
  if (!u || u.id === req.user.id || (u.disabled && !req.user.isAdmin)) return notFound(res);
  req.partner = u;
  next();
}
function renderThread(req, res, err, draft) {
  const u = req.partner;
  p.markRead(req.user.id, u.id);
  notify.readKey(req.user.id, 'pm:' + u.id);
  res.status(err ? 400 : 200).render('conversation', {
    title: 'Nachrichten mit ' + p.displayName(u), u, messages: p.thread(req.user.id, u.id),
    canMessage: p.canMessage(req.user, u), err, draft: draft || '', maxLength: p.MAX_PM,
  });
}
router.get('/nachrichten/:name', auth.requireLogin, loadPartner, (req, res) => renderThread(req, res, null));
router.post('/nachrichten/:name', auth.requireLogin, auth.rateLimit('pm', 30, 600), loadPartner, (req, res) => {
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
  if (!p.canMessage(req.user, req.partner)) return renderThread(req, res, `${p.displayName(req.partner)} bekommt nur Nachrichten von Freunden.`, body);
  if (!body) return res.redirect('/nachrichten/' + encodeURIComponent(req.partner.username));
  if (body.length > p.MAX_PM) return renderThread(req, res, `Höchstens ${p.MAX_PM} Zeichen.`, body);
  const id = p.sendMessage(req.user.id, req.partner.id, body);
  notify.send(req.partner.id, 'pm', {
    key: 'pm:' + req.user.id, title: '💌 Nachricht von ' + p.displayName(req.user),
    body: body.length > 140 ? body.slice(0, 140) + '…' : body, url: '/nachrichten/' + encodeURIComponent(req.user.username),
  });
  res.redirect('/nachrichten/' + encodeURIComponent(req.partner.username) + '#n' + id);
});
router.post('/nachrichten/:name/loeschen', auth.requireLogin, loadPartner, (req, res) => {
  p.hideConversation(req.user.id, req.partner.id);
  res.redirect('/nachrichten');
});
// Der Desktop fragt regelmäßig nach ungelesenen Nachrichten (💌 neben der Uhr)
router.get('/api/nachrichten', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.json({ unread: 0 });
  const out = { unread: p.unreadCount(req.user.id) };
  // Ein offenes Gespräch lädt neu, sobald von diesem Partner etwas Neues kommt
  const from = req.query.von && p.findUser(req.query.von);
  if (from) out.from = db.prepare('SELECT COUNT(*) AS n FROM private_messages WHERE to_id = ? AND from_id = ? AND read_at IS NULL').get(req.user.id, from.id).n;
  res.json(out);
});

// ---------- Profil-Einstellungen (Mein Konto) ----------
const accountBack = (res, key) => res.redirect('/account?' + key + '#profil');
router.post('/account/profil', auth.requireLogin, (req, res) => {
  const b = req.body;
  const name = p.cleanDisplayName(b.display_name);
  if (name === null) return accountBack(res, 'err=name');
  if (name && name.toLowerCase() !== req.user.username.toLowerCase() && p.nameTaken(name, req.user.id)) return accountBack(res, 'err=taken');
  db.prepare('UPDATE users SET display_name = ?, about = ?, profile_visibility = ?, pm_from = ?, gb_from = ? WHERE id = ?').run(
    name && name !== req.user.username ? name : null,
    String(b.about || '').replace(/\r\n/g, '\n').trim().slice(0, 1000) || null,
    Object.hasOwn(p.PROFILE_VIS, b.profile_visibility) ? b.profile_visibility : 'members',
    Object.hasOwn(p.PM_FROM, b.pm_from) ? b.pm_from : 'all',
    Object.hasOwn(p.GB_FROM, b.gb_from) ? b.gb_from : 'all',
    req.user.id);
  accountBack(res, 'ok=profil');
});

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: p.AVATAR_MAX, files: 1 } }).single('avatar');
router.post('/account/avatar', auth.requireLogin, auth.rateLimit('avatar', 20, 3600), (req, res, next) => avatarUpload(req, res, err => {
  if (err) return accountBack(res, err.code === 'LIMIT_FILE_SIZE' ? 'err=big' : 'err=bild');
  next();
}), auth.csrfCheck, (req, res) => {
  if (!req.file) return accountBack(res, 'err=bild');
  let name;
  try { name = p.saveAvatar(req.file.buffer); } catch { return accountBack(res, 'err=bild'); }
  p.removeAvatar(req.user.avatar);
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(name, req.user.id);
  accountBack(res, 'ok=bild');
});
router.post('/account/avatar/loeschen', auth.requireLogin, (req, res) => {
  p.removeAvatar(req.user.avatar);
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  accountBack(res, 'ok=bildweg');
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
      title: `🏆 ${p.displayName(req.user)} hat deinen Rekord in ${g.title} geknackt`,
      body: `${key}: ${value.toLocaleString('de-DE')} (dein Rekord: ${prev.value.toLocaleString('de-DE')})`, url: g.url,
    });
  });
  res.json({ ok: true, stats: p.ownStats(req.user.id, req.params.app) });
});
stats.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.status ? 'request' : 'server' }));

module.exports = { router, stats };
