'use strict';
// Poker (Startmenü → Spiele und Apps → ♠️ Poker). Die Seite holt Tische und Statistik als JSON und bekommt den Tisch
// live per Server-Sent Events; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token.
const express = require('express');
const { getSetting } = require('../db');
const pk = require('../poker');
const profiles = require('../profiles');

const router = express.Router();
const on = () => getSetting('pk_enabled', '1') === '1';
const fail = (res, status, error) => res.status(status).json({ error });
const auth = require('../auth');

router.use(express.json({ limit: '10kb' }));
router.use((req, res, next) => {
  if (!on()) return req.path === '/' ? res.status(404).render('error', { title: 'Poker', message: 'Poker ist gerade ausgeschaltet.' }) : fail(res, 404, 'Poker ist ausgeschaltet.');
  if (req.path !== '/') res.set('Cache-Control', 'no-store');
  next();
});
function gate(req, res, next) { return req.user ? next() : fail(res, 401, 'Für Poker musst du angemeldet sein.'); }
function loadTable(req, res, next) {
  req.table = pk.get(req.params.id);
  return req.table ? next() : fail(res, 404, 'Diesen Tisch gibt es nicht mehr.');
}

router.get('/', (req, res) => {
  if (req.user) profiles.countStart(req.user, 'poker');
  res.render('poker', { title: 'Poker', rules: pk.config() });
});

router.get('/tische', gate, (req, res) => {
  const mine = pk.tableOf(req.user.id);
  res.json({ tables: pk.list(req.user), mine: mine ? mine.id : null, me: { id: req.user.id, name: req.user.name, user: req.user.username, admin: req.user.isAdmin, ...myTotals(req.user.id) } });
});
function myTotals(userId) {
  const t = pk.userTotals(userId);
  return { balance: t.balance, buyins: t.buyins };
}
router.post('/tische', gate, auth.rateLimit('pktable', 20, 600), (req, res) => {
  const b = req.body || {};
  const t = pk.create(req.user, { name: b.name, hidden: !!b.hidden, sb: b.sb, seats: b.seats });
  if (!t) return fail(res, 503, 'Gerade gibt es zu viele Tische. Versuch es später noch einmal.');
  res.json({ id: t.id });
});

// Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/tisch/:id/events', gate, loadTable, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const leave = pk.join(req.table, req.user, res);
  req.on('close', leave);
});

router.post('/tisch/:id', gate, loadTable, auth.rateLimit('pkctl', 240, 60), (req, res) => {
  const t = req.table, b = req.body || {};
  if (b.action === 'close') {
    if (!pk.isHost(t, req.user)) return fail(res, 403, 'Nur der Gastgeber kann den Tisch schließen.');
    pk.remove(t);
    return res.json({ ok: true });
  }
  const err = pk.control(t, req.user, b);
  if (err) return fail(res, 400, err);
  pk.broadcast(t);
  res.json({ ok: true });
});

// Bestenliste: nur wer sein Profil dem Betrachter zeigt, erscheint mit Namen
router.get('/statistik', gate, (req, res) => {
  const board = pk.leaderboard().filter(u => profiles.canViewProfile(req.user, u)).slice(0, 100).map(u => ({
    id: u.id, name: profiles.displayName(u), user: u.username, avatar: u.avatar, balance: u.balance, buyins: u.buyins, bought: u.bought,
    hands: u.hands, wins: u.wins, showdowns: u.showdowns, bestWin: u.best_win, bestHand: u.best_hand,
  }));
  res.json({
    board, handNames: pk.HANDS,
    me: pk.userTotals(req.user.id),
    sessions: pk.recentSessions(req.user.id, 20).map(s => ({
      table: s.table_name, started: s.started_at, ended: s.ended_at, buyins: s.buyins, bought: s.bought, chips: s.chips,
      result: s.chips - s.bought, hands: s.hands, wins: s.wins,
    })),
  });
});

module.exports = router;
