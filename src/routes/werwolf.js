'use strict';
// Werwolf (Startmenü → Spiele und Apps → 🐺 Werwolf). Aufbau wie routes/quiz.js: Räume als JSON, der Raum live per
// Server-Sent Events (/werwolf/<code>/events), Eingaben per POST mit dem Formular-Token im Kopf x-csrf-token.
// Einladungslink: /werwolf/<code>. Gäste ohne Konto erkennt der Server an einem eigenen Cookie wieder, damit sie nach
// einem Neuladen oder Funkloch mit ihrer Rolle zurückkommen.
const crypto = require('node:crypto');
const express = require('express');
const { getSetting } = require('../db');
const auth = require('../auth');
const ww = require('../werwolf');
const qr = require('../qr');
const profiles = require('../profiles');

const router = express.Router();
const on = () => getSetting('ww_enabled', '1') === '1';
const fail = (res, status, error, extra) => res.status(status).json({ error, ...extra });
const CODE = /^[A-Z0-9]{4}$/;

router.use(express.json({ limit: '20kb' }));
router.use((req, res, next) => {
  if (!on()) {
    const isPage = req.method === 'GET' && (req.path === '/' || CODE.test(req.path.slice(1).toUpperCase()));
    return isPage ? res.status(404).render('error', { title: 'Werwolf', message: 'Werwolf ist gerade ausgeschaltet.' }) : fail(res, 404, 'Werwolf ist ausgeschaltet.');
  }
  res.set('Cache-Control', 'no-store');
  next();
});

// Wer bin ich? Mitglieder über ihr Konto, Gäste über das Cookie „werwolf“ (nur eine Zufallszahl, keine Daten)
function who(req, res, create = false) {
  if (req.user) return { pid: 'u' + req.user.id, user: req.user, name: req.user.name };
  let t = req.cookies.werwolf;
  if (!t || !/^[a-f0-9]{32}$/.test(t)) {
    if (!create) return null;
    t = crypto.randomBytes(16).toString('hex');
    res.cookie('werwolf', t, { httpOnly: true, sameSite: 'lax', secure: auth.secureFor(req), maxAge: 30 * 86400e3 });
    req.cookies.werwolf = t;
  }
  return { pid: 'g' + crypto.createHash('sha256').update(t).digest('hex').slice(0, 16), user: null, name: '' };
}
function loadRoom(req, res, next) {
  req.room = CODE.test(String(req.params.code).toUpperCase()) ? ww.get(req.params.code) : null;
  return req.room ? next() : fail(res, 404, 'Diesen Raum gibt es nicht (mehr). Prüf den Code.');
}

function page(req, res, code) {
  if (req.user) profiles.countStart(req.user, 'werwolf');
  const r = code ? ww.get(code) : null;
  res.render('werwolf', {
    title: r ? 'Werwolf – ' + r.name : 'Werwolf', code: r ? r.code : code ? String(code).toUpperCase() : '',
    emojis: ww.EMOJIS, colors: ww.COLORS, roles: ww.ROLES,
  });
}
router.get('/', (req, res) => page(req, res, ''));

router.get('/raeume', (req, res) => {
  const me = who(req, res);
  res.json({
    rooms: ww.list(),
    me: req.user ? { name: req.user.name, user: req.user.username, member: true } : { member: false },
    guestsAllowed: ww.config().guests,
    mine: me ? [...ww._rooms.values()].filter(r => r.players.has(me.pid) && !r.players.get(me.pid).left).map(r => ({ code: r.code, name: r.name, host: ww.isHost(r, me.pid) })) : [],
  });
});

router.post('/raeume', auth.rateLimit('wwroom', 20, 600), (req, res) => {
  const b = req.body || {};
  if (!req.user && !ww.config().guests) return fail(res, 403, 'Zum Eröffnen eines Raums musst du angemeldet sein.', { login: true });
  const me = who(req, res, true);
  const r = ww.create(me, { name: b.name, mode: b.mode, hidden: !!b.hidden, guests: b.guests !== false, playerName: b.playerName, emoji: b.emoji, color: b.color });
  if (!r) return fail(res, 503, 'Gerade sind zu viele Räume offen. Versuch es später noch einmal.');
  if (r.error) return fail(res, 400, r.error);
  res.json({ code: r.code });
});

// Bin ich schon drin? Damit weiß die Seite, ob sie gleich verbinden kann oder erst nach dem Namen fragt
router.get('/:code/info', loadRoom, (req, res) => {
  const me = who(req, res), r = req.room;
  const p = me && r.players.get(me.pid);
  res.json({
    code: r.code, name: r.name, mode: r.mode, players: r.players.size, phase: r.phase,
    joined: !!p && !p.left, guests: r.guests && ww.config().guests, member: !!req.user,
  });
});

router.post('/:code/beitreten', auth.rateLimit('wwjoin', 60, 600), loadRoom, (req, res) => {
  const me = who(req, res, true);
  const out = ww.join(req.room, me, { playerName: (req.body || {}).name, emoji: (req.body || {}).emoji, color: (req.body || {}).color });
  if (out.error) return fail(res, 400, out.error, { login: !!out.login });
  ww.broadcast(req.room);
  res.json({ ok: true });
});

// Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/:code/events', loadRoom, (req, res) => {
  const me = who(req, res);
  const r = req.room;
  if (!me || !r.players.has(me.pid) || r.players.get(me.pid).left) return fail(res, 403, 'Du bist in diesem Raum noch nicht dabei.', { join: true });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const leave = ww.connect(r, me.pid, res);
  req.on('close', leave);
});

// Eingaben zählen pro Person statt pro IP: lokal sitzen alle hinter derselben Adresse
const buckets = new Map();
function limited(pid) {
  const t = Date.now();
  let b = buckets.get(pid);
  if (!b || b.reset < t) { b = { n: 0, reset: t + 10000 }; buckets.set(pid, b); }
  return ++b.n > 60;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60e3).unref();

const HOST = new Set(['settings', 'start', 'lobby', 'skip', 'abort', 'kick', 'host']);
router.post('/:code', loadRoom, (req, res) => {
  const me = who(req, res);
  const r = req.room, b = req.body || {};
  if (!me || !r.players.has(me.pid) || r.players.get(me.pid).left) return fail(res, 403, 'Du bist in diesem Raum nicht dabei.');
  if (limited(me.pid)) return fail(res, 429, 'Zu viele Eingaben, bitte kurz warten.');
  if (b.action === 'close') {
    if (!ww.isHost(r, me.pid)) return fail(res, 403, 'Nur der Gastgeber kann den Raum schließen.');
    ww.remove(r);
    return res.json({ ok: true });
  }
  if (HOST.has(b.action)) {
    if (!ww.isHost(r, me.pid)) return fail(res, 403, 'Das darf nur der Gastgeber.');
    const err = ww.hostAction(r, me.pid, b);
    if (err) return fail(res, 400, err);
  } else {
    const out = ww.playerAction(r, me.pid, b);
    if (out.error) return fail(res, 400, out.error);
  }
  if (ww.get(r.code) === r) ww.broadcast(r);
  res.json({ ok: true });
});

router.get('/:code/qr.svg', loadRoom, (req, res) => {
  res.type('image/svg+xml').send(qr.svg(`${req.protocol}://${req.get('host')}/werwolf/${req.room.code}`));
});

router.get('/:code', (req, res, next) => {
  if (!CODE.test(String(req.params.code).toUpperCase())) return next();
  page(req, res, req.params.code);
});

module.exports = router;
