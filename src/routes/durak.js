'use strict';
// Durak (Startmenü → Spiele und Apps → 🎴 Durak). Die Seite holt Tische und Statistik als JSON und bekommt den Tisch
// live per Server-Sent Events; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Aufbau wie routes/poker.js.
const express = require('express');
const { getSetting } = require('../db');
const dk = require('../durak');
const profiles = require('../profiles');

const router = express.Router();
const on = () => getSetting('dk_enabled', '1') === '1';
const fail = (res, status, error) => res.status(status).json({ error });
const auth = require('../auth');

router.use(express.json({ limit: '10kb' }));
router.use((req, res, next) => {
  if (!on()) return req.path === '/' ? res.status(404).render('error', { title: 'Durak', message: 'Durak ist gerade ausgeschaltet.' }) : fail(res, 404, 'Durak ist ausgeschaltet.');
  if (req.path !== '/') res.set('Cache-Control', 'no-store');
  next();
});
function gate(req, res, next) { return req.user ? next() : fail(res, 401, 'Für Durak musst du angemeldet sein.'); }
function loadTable(req, res, next) {
  req.table = dk.get(req.params.id);
  return req.table ? next() : fail(res, 404, 'Diesen Tisch gibt es nicht mehr.');
}

router.get('/', (req, res) => {
  if (req.user) profiles.countStart(req.user, 'durak');
  res.render('durak', { title: 'Durak' });
});

router.get('/tische', gate, (req, res) => {
  const mine = dk.tableOf(req.user.id);
  const t = dk.userTotals(req.user.id);
  res.json({ tables: dk.list(req.user), mine: mine ? mine.id : null, me: { id: req.user.id, name: req.user.name, user: req.user.username, admin: req.user.isAdmin, games: t.games, wins: t.wins, duraks: t.duraks } });
});
router.post('/tische', gate, auth.rateLimit('dktable', 20, 600), (req, res) => {
  const b = req.body || {};
  const t = dk.create(req.user, { name: b.name, hidden: !!b.hidden, seats: b.seats });
  if (!t) return fail(res, 503, 'Gerade gibt es zu viele Tische. Versuch es später noch einmal.');
  res.json({ id: t.id });
});

// Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/tisch/:id/events', gate, loadTable, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const leave = dk.join(req.table, req.user, res);
  req.on('close', leave);
});

router.post('/tisch/:id', gate, loadTable, auth.rateLimit('dkctl', 300, 60), (req, res) => {
  const t = req.table, b = req.body || {};
  if (b.action === 'close') {
    if (!dk.isHost(t, req.user)) return fail(res, 403, 'Nur der Gastgeber kann den Tisch schließen.');
    dk.remove(t);
    return res.json({ ok: true });
  }
  const err = dk.control(t, req.user, b);
  if (err) return fail(res, 400, err);
  dk.broadcast(t);
  res.json({ ok: true });
});

// Bestenliste: nur wer sein Profil dem Betrachter zeigt, erscheint mit Namen
router.get('/statistik', gate, (req, res) => {
  const board = dk.leaderboard().filter(u => profiles.canViewProfile(req.user, u)).slice(0, 100).map(u => ({
    id: u.id, name: profiles.displayName(u), user: u.username, avatar: u.avatar, games: u.games, wins: u.wins, duraks: u.duraks,
  }));
  res.json({
    board,
    me: dk.userTotals(req.user.id),
    games: dk.recentGames(req.user.id, 20).map(g => ({ table: g.table_name, ended: g.ended_at, players: g.players, place: g.place, durak: !!g.durak, quit: !!g.quit, bouts: g.bouts })),
  });
});

module.exports = router;
