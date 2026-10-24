'use strict';
// Blackjack (Startmenü → 🃏 Blackjack). Die Seite holt Tische und Statistik als JSON und bekommt den Tisch
// live per Server-Sent Events; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token.
const express = require('express');
const { getSetting } = require('../db');
const bj = require('../blackjack');
const us = require('../usersettings');

const router = express.Router();
const on = () => getSetting('bj_enabled', '1') === '1';
const fail = (res, status, error) => res.status(status).json({ error });
const auth = require('../auth');

router.use(express.json({ limit: '10kb' }));
router.use((req, res, next) => {
  if (!on()) return req.path === '/' ? res.status(404).render('error', { title: 'Blackjack', message: 'Blackjack ist gerade ausgeschaltet.' }) : fail(res, 404, 'Blackjack ist ausgeschaltet.');
  if (req.path !== '/') res.set('Cache-Control', 'no-store');
  next();
});
function gate(req, res, next) { return req.user ? next() : fail(res, 401, 'Für Blackjack musst du angemeldet sein.'); }
function loadTable(req, res, next) {
  req.table = bj.get(req.params.id);
  // Tische eines Spieltisches laufen über /kartenspiele (src/routes/kartenspiele.js)
  return req.table && !req.table.spieltisch ? next() : fail(res, 404, 'Diesen Tisch gibt es nicht mehr.');
}

// Gespielt wird im gemeinsamen Fenster Kartenspiele
router.get('/', (req, res) => res.redirect('/kartenspiele'));

router.get('/tische', gate, (req, res) => {
  const mine = bj.tableOf(req.user.id);
  res.json({ tables: bj.list(req.user), mine: mine ? mine.id : null, me: { id: req.user.id, name: req.user.name, user: req.user.username, admin: req.user.isAdmin, ...myTotals(req.user.id) } });
});
function myTotals(userId) {
  const t = bj.userTotals(userId);
  return { balance: t.balance, buyins: t.buyins };
}
router.post('/tische', gate, auth.rateLimit('bjtable', 20, 600), (req, res) => {
  const b = req.body || {};
  const t = bj.create(req.user, { name: b.name, hidden: !!b.hidden, minBet: b.minBet, maxBet: b.maxBet, seats: b.seats });
  if (!t) return fail(res, 503, 'Gerade gibt es zu viele Tische. Versuch es später noch einmal.');
  res.json({ id: t.id });
});

// Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/tisch/:id/events', gate, loadTable, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const leave = bj.join(req.table, req.user, res);
  req.on('close', leave);
});

router.post('/tisch/:id', gate, loadTable, auth.rateLimit('bjctl', 240, 60), (req, res) => {
  const t = req.table, b = req.body || {};
  if (b.action === 'close') {
    if (!bj.isHost(t, req.user)) return fail(res, 403, 'Nur der Gastgeber kann den Tisch schließen.');
    bj.remove(t);
    return res.json({ ok: true });
  }
  const err = bj.control(t, req.user, b);
  if (err) return fail(res, 400, err);
  bj.broadcast(t);
  res.json({ ok: true });
});

// Bestenliste: Jeder wählt unter Systemsteuerung → Profil und Statistik, ob er mit Namen, anonym oder gar nicht drinsteht
router.get('/statistik', gate, (req, res) => {
  const board = us.boardList('blackjack', bj.leaderboard(), req.user).slice(0, 100).map(u => ({
    id: u.id, name: u.name, user: u.user, avatar: u.avatar, balance: u.balance, buyins: u.buyins, bought: u.bought,
    hands: u.hands, wins: u.wins, blackjacks: u.blackjacks, bestWin: u.best_win, bestStreak: u.best_streak,
  }));
  res.json({
    board,
    me: bj.userTotals(req.user.id),
    sessions: bj.recentSessions(req.user.id, 20).map(s => ({
      table: s.table_name, started: s.started_at, ended: s.ended_at, buyins: s.buyins, bought: s.bought, chips: s.chips,
      result: s.chips - s.bought, hands: s.hands, wins: s.wins,
    })),
  });
});

module.exports = router;
