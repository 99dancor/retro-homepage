'use strict';
// Quiz (Startmenü → Spiele und Apps → ❓ Quiz). Die Seite holt Räume als JSON, bekommt den Raum live per
// Server-Sent Events (/quiz/<code>/events) und schickt Eingaben per POST mit dem Formular-Token im Kopf x-csrf-token.
// Einladungslink: /quiz/<code>. Gäste ohne Konto erkennt der Server an einem eigenen Cookie wieder, damit sie nach
// einem Neuladen oder Funkloch mit ihren Punkten zurückkommen.
const crypto = require('node:crypto');
const express = require('express');
const { getSetting } = require('../db');
const auth = require('../auth');
const quiz = require('../quiz');
const qr = require('../qr');
const profiles = require('../profiles');

const router = express.Router();
const on = () => getSetting('quiz_enabled', '1') === '1';
const fail = (res, status, error, extra) => res.status(status).json({ error, ...extra });
const CODE = /^[A-Z0-9]{4}$/;

router.use(express.json({ limit: '300kb' }));
router.use((req, res, next) => {
  if (!on()) {
    const isPage = req.method === 'GET' && (req.path === '/' || CODE.test(req.path.slice(1).toUpperCase()));
    return isPage ? res.status(404).render('error', { title: 'Quiz', message: 'Das Quiz ist gerade ausgeschaltet.' }) : fail(res, 404, 'Das Quiz ist ausgeschaltet.');
  }
  res.set('Cache-Control', 'no-store');
  next();
});

// Wer bin ich? Mitglieder über ihr Konto, Gäste über das Cookie „quiz“ (nur eine Zufallszahl, keine Daten)
function guestToken(req, res, create) {
  let t = req.cookies.quiz;
  if (!t || !/^[a-f0-9]{32}$/.test(t)) {
    if (!create) return null;
    t = crypto.randomBytes(16).toString('hex');
    res.cookie('quiz', t, { httpOnly: true, sameSite: 'lax', secure: auth.secureFor(req), maxAge: 30 * 86400e3 });
    req.cookies.quiz = t;
  }
  return t;
}
function who(req, res, create = false) {
  if (req.user) return { pid: 'u' + req.user.id, user: req.user, name: req.user.name };
  const t = guestToken(req, res, create);
  return t ? { pid: 'g' + crypto.createHash('sha256').update(t).digest('hex').slice(0, 16), user: null, name: '' } : null;
}
function loadRoom(req, res, next) {
  req.room = CODE.test(String(req.params.code).toUpperCase()) ? quiz.get(req.params.code) : null;
  return req.room ? next() : fail(res, 404, 'Diesen Raum gibt es nicht (mehr). Prüf den Code.');
}

function page(req, res, code) {
  if (req.user) profiles.countStart(req.user, 'quiz');
  const r = code ? quiz.get(code) : null;
  res.render('quiz', {
    title: r ? 'Quiz – ' + r.name : 'Quiz', code: r ? r.code : code ? String(code).toUpperCase() : '',
    emojis: quiz.EMOJIS, colors: quiz.COLORS, defaults: quiz.DEFAULTS,
  });
}
router.get('/', (req, res) => page(req, res, ''));

router.get('/raeume', (req, res) => {
  const me = who(req, res);
  const cfg = quiz.config();
  res.json({
    rooms: quiz.list(),
    me: req.user ? { name: req.user.name, user: req.user.username, member: true } : { member: false },
    canHost: quiz.canHost(req.user), guestsAllowed: cfg.guests,
    mine: me ? [...quiz._rooms.values()].filter(r => r.hostPid === me.pid || r.players.has(me.pid)).map(r => ({ code: r.code, name: r.name, host: r.hostPid === me.pid })) : [],
  });
});

router.post('/raeume', auth.rateLimit('quizroom', 20, 600), (req, res) => {
  if (!quiz.canHost(req.user)) return fail(res, 403, req.user ? 'Räume eröffnen darf hier nur der Admin.' : 'Zum Eröffnen eines Raums musst du angemeldet sein.', { login: !req.user });
  const b = req.body || {};
  const me = who(req, res, true);
  if (!me.user) {
    me.name = String(b.hostName || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!me.name) return fail(res, 400, 'Bitte gib deinen Namen ein.');
  }
  const r = quiz.create(me, { name: b.name, hidden: !!b.hidden, guests: b.guests !== false, defaults: b.defaults });
  if (!r) return fail(res, 503, 'Gerade sind zu viele Räume offen. Versuch es später noch einmal.');
  res.json({ code: r.code });
});

// Gespeicherte Quizze: eigene und von anderen Mitgliedern geteilte. Speichern und Laden geht nur als Spielleiter
// eines offenen Raums, die Fragen kommen dabei direkt aus dem Raum bzw. landen dort.
router.get('/sammlung', (req, res) => res.json({ member: !!req.user, quizzes: quiz.library(req.user) }));
function hostRoom(req, res) {
  const r = CODE.test(String(req.body.code || '').toUpperCase()) ? quiz.get(req.body.code) : null;
  const me = who(req, res);
  if (!r || !me || !quiz.isHost(r, me.pid)) { fail(res, 403, 'Das geht nur als Spielleiter eines offenen Raums.'); return null; }
  return r;
}
router.post('/sammlung', auth.rateLimit('quizsave', 60, 600), (req, res) => {
  if (!req.user) return fail(res, 403, 'Zum Speichern musst du angemeldet sein.', { login: true });
  const r = hostRoom(req, res);
  if (!r) return;
  const out = quiz.saveQuiz(r, req.user, req.body);
  if (out.error) return fail(res, 400, out.error);
  quiz.broadcast(r);
  res.json(out);
});
router.post('/sammlung/:id/laden', (req, res) => {
  const r = hostRoom(req, res);
  if (!r) return;
  const err = quiz.loadQuiz(r, req.user, Number(req.params.id));
  if (err) return fail(res, 404, err);
  quiz.broadcast(r);
  res.json({ ok: true });
});
router.post('/sammlung/:id/loeschen', (req, res) => {
  const err = quiz.deleteQuiz(req.user, Number(req.params.id));
  if (err) return fail(res, 403, err);
  res.json({ ok: true });
});

// Bin ich schon drin? Damit weiß die Seite, ob sie gleich verbinden kann oder erst nach Namen und Bild fragt
router.get('/:code/info', loadRoom, (req, res) => {
  const me = who(req, res), r = req.room;
  res.json({
    code: r.code, name: r.name, host: r.hostName, players: r.players.size, phase: r.phase,
    isHost: !!me && quiz.isHost(r, me.pid), joined: !!me && r.players.has(me.pid),
    guests: r.guests && quiz.config().guests, member: !!req.user, locked: r.locked && r.phase !== 'lobby',
  });
});

router.post('/:code/beitreten', auth.rateLimit('quizjoin', 60, 600), loadRoom, (req, res) => {
  const me = who(req, res, true);
  const out = quiz.join(req.room, me, req.body || {});
  if (out.error) return fail(res, 400, out.error, { login: !!out.login });
  quiz.broadcast(req.room);
  res.json({ ok: true });
});

// Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/:code/events', loadRoom, (req, res) => {
  const me = who(req, res);
  const r = req.room;
  if (!me || (!quiz.isHost(r, me.pid) && !r.players.has(me.pid))) return fail(res, 403, 'Du bist in diesem Raum noch nicht dabei.', { join: true });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const leave = quiz.connect(r, me.pid, res);
  req.on('close', leave);
});

// Eingaben: getippter Text kommt bis zu 10-mal pro Sekunde, deshalb zählt hier jede Person für sich statt pro IP
// (auf einem Spieleabend sitzen oft alle hinter derselben Adresse)
const buckets = new Map();
function limited(pid) {
  const t = Date.now();
  let b = buckets.get(pid);
  if (!b || b.reset < t) { b = { n: 0, reset: t + 10000 }; buckets.set(pid, b); }
  return ++b.n > 300;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60e3).unref();

router.post('/:code', loadRoom, (req, res) => {
  const me = who(req, res);
  const r = req.room, b = req.body || {};
  if (!me) return fail(res, 403, 'Du bist in diesem Raum nicht dabei.');
  if (limited(me.pid)) return fail(res, 429, 'Zu viele Eingaben, bitte kurz warten.');
  if (quiz.isHost(r, me.pid)) {
    if (b.action === 'close') { quiz.remove(r); return res.json({ ok: true }); }
    const err = quiz.hostAction(r, b);
    if (err) return fail(res, 400, err);
    quiz.broadcast(r);
    return res.json({ ok: true });
  }
  const out = quiz.playerAction(r, me.pid, b);
  if (out.error) return fail(res, 400, out.error);
  if (out.full) quiz.broadcast(r);
  res.json({ ok: true });
});

router.get('/:code/qr.svg', loadRoom, (req, res) => {
  res.type('image/svg+xml').send(qr.svg(`${req.protocol}://${req.get('host')}/quiz/${req.room.code}`));
});

// Einladungslink: dieselbe Seite, die gleich den Beitreten-Dialog für diesen Raum zeigt
router.get('/:code', (req, res, next) => {
  if (!CODE.test(String(req.params.code).toUpperCase())) return next();
  page(req, res, req.params.code);
});

module.exports = router;
