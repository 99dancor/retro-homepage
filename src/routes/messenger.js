'use strict';
// Messenger (ICU im XP-Design, DSN im 98-Design): Kontaktliste, Gespräche, Mitglieder finden, Anfragen und die
// Live-Verbindung des Desktops. Ersetzt die früheren Seiten „Mitglieder“ (/nutzer) und „Nachrichten“ (/nachrichten).
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const p = require('../profiles');
const m = require('../messenger');
const notify = require('../notify');
const us = require('../usersettings');

const router = express.Router();
const json = express.json({ limit: '20kb' });
const PER_PAGE = 50;
const wantsJson = req => req.accepts(['html', 'json']) === 'json';
const fail = (req, res, code, msg, html) => (wantsJson(req) ? res.status(code).json({ error: msg }) : html ? html() : res.status(code).render('error', { title: 'Messenger', message: msg }));
const notFound = (req, res) => fail(req, res, 404, 'Dieses Mitglied gibt es nicht (mehr).');
const needUser = (req, res, next) => (req.user ? next() : wantsJson(req) ? res.status(401).json({ error: 'Bitte melde dich an.' }) : auth.requireLogin(req, res, next));
const back = (v, fallback) => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : fallback);
const chatUrl = name => '/messenger/mit/' + encodeURIComponent(name);
const short = s => (s.length > 140 ? s.slice(0, 140) + '…' : s);

// Gegenüber eines Gesprächs
function partner(req, res, next) {
  const u = p.findUser(req.params.name);
  if (!u || u.id === req.user.id || (u.disabled && !req.user.isAdmin)) return notFound(req, res);
  req.partner = u;
  next();
}

// ---------- Kontaktliste ----------
router.get('/messenger', (req, res) => {
  res.render('messenger', {
    title: req.user ? 'Messenger – ' + p.displayName(req.user) : 'Messenger', page: 'liste',
    data: req.user ? m.contacts(req.user) : null, prefs: req.user ? us.get(req.user.id, 'icu') : null, STATUS: m.STATUS,
  });
});
router.get('/api/messenger/kontakte', needUser, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(m.contacts(req.user));
});

// ---------- Live-Verbindung (eine pro Desktop-Tab, public/messenger-hub.js) ----------
router.get('/api/messenger/stream', needUser, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 5000\n\n');
  const leave = m.connect(req.user, res, String(req.query.c || ''), { prefs: us.get(req.user.id, 'icu') });
  req.on('close', leave);
});
router.post('/api/messenger/aktiv', needUser, json, (req, res) => {
  const b = req.body || {};
  m.setIdle(req.user.id, String(b.c || ''), b.idle === true || b.idle === '1');
  res.json({ ok: true });
});
router.post('/api/messenger/status', needUser, auth.rateLimit('msgrstatus', 60, 60), json, (req, res) => {
  const b = req.body || {};
  res.json(m.setStatus(req.user.id, b.status, typeof b.msg === 'string' ? b.msg : undefined));
});

// ---------- Gespräche ----------
function renderChat(req, res, err, draft) {
  const u = req.partner;
  const users = { [req.user.id]: req.user.username, [u.id]: u.username };
  res.status(err ? 400 : 200).render('messenger', {
    title: p.displayName(u) + ' – Gespräch', page: 'chat', u, card: m.card(req.user, u),
    messages: p.thread(req.user.id, u.id).map(x => m.message(x, users)), relation: p.friendship(req.user.id, u.id),
    canMessage: p.canMessage(req.user, u), canInvite: m.canInvite(req.user, u), err, draft: draft || '', maxLength: p.MAX_PM, STATUS: m.STATUS,
  });
}
router.get('/messenger/mit/:name', needUser, partner, (req, res) => {
  m.read(req.user, req.partner);
  notify.readKey(req.user.id, 'pm:' + req.partner.id);
  renderChat(req, res, null);
});
// Ältere Nachrichten nachladen und neue holen, falls die Live-Verbindung kurz weg war
router.get('/api/messenger/mit/:name', needUser, partner, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const users = { [req.user.id]: req.user.username, [req.partner.id]: req.partner.username };
  res.json({ messages: p.thread(req.user.id, req.partner.id).map(x => m.message(x, users)), card: m.card(req.user, req.partner) });
});
router.post('/messenger/mit/:name', needUser, auth.rateLimit('pm', 60, 60), partner, (req, res) => {
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
  const u = req.partner;
  const again = msg => fail(req, res, 400, msg, () => renderChat(req, res, msg, body));
  if (!p.canMessage(req.user, u)) return again(p.blocked(req.user.id, u.id) ? 'Das geht gerade nicht.' : `${p.displayName(u)} bekommt nur Nachrichten von Freunden.`);
  if (!body) return wantsJson(req) ? res.status(400).json({ error: 'Leere Nachricht.' }) : res.redirect(chatUrl(u.username));
  if (body.length > p.MAX_PM) return again(`Höchstens ${p.MAX_PM} Zeichen.`);
  const msg = m.deliver(req.user, u, body);
  // Wer den Messenger offen hat, sieht die Nachricht dort; die 🔔 und Push nur, wenn niemand zuschaut
  if (!m.connected(u.id)) {
    notify.send(u.id, 'pm', { key: 'pm:' + req.user.id, title: '💬 Nachricht von ' + p.displayName(req.user), body: short(body), url: chatUrl(req.user.username) });
  }
  if (wantsJson(req)) return res.json({ message: msg });
  res.redirect(chatUrl(u.username) + '#n' + msg.id);
});
router.post('/messenger/mit/:name/gelesen', needUser, partner, (req, res) => {
  m.read(req.user, req.partner);
  notify.readKey(req.user.id, 'pm:' + req.partner.id);
  res.json({ ok: true });
});
// „schreibt gerade …“
router.post('/messenger/mit/:name/tippt', needUser, auth.rateLimit('msgrtyping', 60, 60), partner, (req, res) => {
  if (p.canMessage(req.user, req.partner)) m.send(req.partner.id, 'tippt', { partner: req.user.username });
  res.json({ ok: true });
});
// Anstupsen: höchstens einmal pro Minute und Gespräch
router.post('/messenger/mit/:name/anstupsen', needUser, auth.rateLimit('msgrnudge', 20, 600), partner, (req, res) => {
  const u = req.partner;
  if (!p.canMessage(req.user, u)) return res.status(403).json({ error: 'Das geht gerade nicht.' });
  const last = db.prepare("SELECT created_at FROM private_messages WHERE from_id = ? AND to_id = ? AND kind = 'nudge' ORDER BY id DESC LIMIT 1").get(req.user.id, u.id);
  if (last && Date.now() / 1000 - last.created_at < 60) return res.status(429).json({ error: 'Einmal pro Minute reicht.' });
  res.json({ message: m.deliver(req.user, u, '', 'nudge') });
});
// Einladen: in eine Lobby, in der man gerade selbst ist
router.get('/api/messenger/einladen', needUser, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ lobbies: m.myLobbies(req.user) });
});
router.post('/messenger/mit/:name/einladen', needUser, auth.rateLimit('msgrinvite', 30, 600), partner, (req, res) => {
  const u = req.partner;
  if (!m.canInvite(req.user, u)) return res.status(403).json({ error: `${p.displayName(u)} möchte nur von Freunden eingeladen werden.` });
  const l = m.myLobbies(req.user).find(x => x.url === String((req.body && req.body.url) || ''));
  if (!l) return res.status(400).json({ error: 'Du bist dort gerade nicht.' });
  const meta = { icon: l.icon, what: l.what, name: l.name, url: l.url };
  const msg = m.deliver(req.user, u, `${l.what}: ${l.name}`, 'invite', meta);
  if (!m.connected(u.id)) {
    notify.send(u.id, 'invite', { key: 'invite:' + req.user.id, title: `🎲 ${p.displayName(req.user)} lädt dich ein`, body: `${l.what}: ${l.name}`, url: l.url });
  }
  res.json({ message: msg });
});
router.post('/messenger/mit/:name/loeschen', needUser, partner, (req, res) => {
  p.hideConversation(req.user.id, req.partner.id);
  res.redirect('/messenger/verlauf');
});

// ---------- Verlauf (alle Gespräche) ----------
router.get('/messenger/verlauf', needUser, (req, res) => {
  res.render('messenger', { title: 'Nachrichtenverlauf', page: 'verlauf', conversations: p.conversations(req.user.id), STATUS: m.STATUS });
});

// ---------- Mitglieder finden ----------
router.get('/messenger/finden', (req, res) => {
  const me = req.user;
  const q = String(req.query.q || '').trim().replace(/^@/, '').slice(0, 50);
  const f = { online: req.query.online === '1', gemeinsam: req.query.gemeinsam === '1', admins: req.query.admins === '1' };
  const page = Math.max(1, Number(req.query.page) || 1);
  const params = [];
  let where = 'u.disabled = 0';
  // Gäste finden nur Profile, die für alle sichtbar sind
  if (!me) where += " AND u.profile_visibility = 'public'";
  if (q) {
    const num = /^\d[\d\s]*$/.test(q) ? Number(q.replace(/\s/g, '')) - p.NUMBER_BASE : null;
    where += ' AND (u.username LIKE ? OR u.display_name LIKE ?' + (num > 0 ? ' OR u.id = ?' : '') + ')';
    params.push('%' + q + '%', '%' + q + '%');
    if (num > 0) params.push(num);
  }
  if (f.admins) where += " AND u.role = 'admin'";
  let rows = db.prepare(`SELECT u.* FROM users u WHERE ${where} ORDER BY COALESCE(u.display_name, u.username) COLLATE NOCASE`).all(...params);
  if (me) rows = rows.filter(u => u.id === me.id || !p.blocked(me.id, u.id));
  const acts = me ? m.activities(me) : new Map();
  const friendIds = new Set(me ? p.friendsOf(me.id).map(x => x.id) : []);
  const commonOf = u => (me && u.id !== me.id ? p.commonFriends(me.id, u.id).length : 0);
  let list = rows.map(u => ({ ...m.card(me, u, acts), friend: friendIds.has(u.id), self: !!me && u.id === me.id, created: u.created_at, u }));
  if (me && f.online) list = list.filter(x => x.status !== 'offline');
  if (me) for (const x of list) x.common = commonOf(x.u);
  if (me && f.gemeinsam) list = list.filter(x => x.common > 0);
  const total = list.length;
  const shown = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  for (const x of shown) {
    x.relation = me ? p.friendship(me.id, x.u.id) : 'none';
    x.canMessage = p.canMessage(me, x.u);
    x.canRequest = me ? p.canRequest(me.id, x.u) : false;
    delete x.u;
  }
  // Wer gerade auf der Seite ist und das zeigt
  const active = me ? db.prepare('SELECT * FROM users WHERE disabled = 0 AND id != ?').all(me.id)
    .filter(u => m.connected(u.id)).map(u => m.card(me, u, acts)).filter(c => c.status !== 'offline').slice(0, 40) : [];
  const hiddenActive = me ? db.prepare('SELECT id FROM users WHERE disabled = 0 AND id != ?').all(me.id).filter(u => m.connected(u.id)).length - active.length : 0;
  res.render('messenger', {
    title: 'Mitglieder finden', page: 'finden', q, f, pageNo: page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, list: shown, active, hiddenActive,
    memberCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get().n, STATUS: m.STATUS,
    msg: Object.hasOwn(p.FRIEND_MSG, req.query.ok || '') ? p.FRIEND_MSG[req.query.ok] : null,
  });
});

// ---------- Anfrage: ansehen (von jemandem) oder schicken (an jemanden) ----------
router.get('/messenger/anfrage/:name', needUser, partner, (req, res) => {
  const u = req.partner;
  const relation = p.friendship(req.user.id, u.id);
  const incoming = relation === 'received' ? p.request(u.id, req.user.id) : null;
  res.render('messenger', {
    title: incoming ? 'Anfrage von ' + p.displayName(u) : p.displayName(u) + ' hinzufügen', page: 'anfrage', u, card: m.card(req.user, u), relation, incoming,
    common: p.commonFriends(req.user.id, u.id), canRequest: p.canRequest(req.user.id, u), visible: p.canViewProfile(req.user, u), STATUS: m.STATUS,
    msg: Object.hasOwn(p.FRIEND_MSG, req.query.ok || '') ? p.FRIEND_MSG[req.query.ok] : null,
  });
});

// ---------- Ignorieren ----------
router.post('/messenger/ignorieren', needUser, (req, res) => {
  const u = p.findUser(String(req.body.user || '').trim().replace(/^@/, ''));
  const on = req.body.on !== '0';
  const ok = !!u && p.ignore(req.user.id, u.id, on);
  if (ok) { m.send(req.user.id, 'kontakte'); m.send(u.id, 'kontakte'); }
  if (wantsJson(req)) return u ? res.json({ ok }) : res.status(404).json({ error: 'Dieses Mitglied gibt es nicht.' });
  res.redirect(back(req.body.back, '/konto#privatsphaere'));
});

// ---------- Frühere Adressen ----------
router.get('/nutzer', (req, res) => {
  const q = String(req.query.q || '').trim();
  res.redirect(301, '/messenger/finden' + (q ? '?q=' + encodeURIComponent(q) : ''));
});
router.get('/nachrichten', (req, res) => {
  if (req.query.an) return res.redirect(301, chatUrl(String(req.query.an).trim().replace(/^@/, '')));
  res.redirect(301, '/messenger/verlauf');
});
router.get('/nachrichten/:name', (req, res) => res.redirect(301, chatUrl(req.params.name)));
// Ungelesene Nachrichten (der Desktop bekommt sie live, das hier bleibt für Seiten ohne Live-Verbindung)
router.get('/api/nachrichten', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ unread: req.user ? p.unreadCount(req.user.id) : 0 });
});

module.exports = router;
