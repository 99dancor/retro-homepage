'use strict';
// Seiten für UNO, Flip 7 und Pilli Pilli (src/cardtable.js): eine Seite pro Spiel, Tische und Statistik als JSON, der Tisch
// live per Server-Sent Events; Züge gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Aufbau wie routes/durak.js.
const express = require('express');
const { getSetting } = require('../db');
const profiles = require('../profiles');
const auth = require('../auth');

const fail = (res, status, error) => res.status(status).json({ error });

module.exports = function cardGameRouter(cg) {
  const router = express.Router();
  const on = () => getSetting(cg.prefix + '_enabled', '1') === '1';

  router.use(express.json({ limit: '10kb' }));
  router.use((req, res, next) => {
    if (!on()) return req.path === '/' ? res.status(404).render('error', { title: cg.title, message: `${cg.title} ist gerade ausgeschaltet.` }) : fail(res, 404, `${cg.title} ist ausgeschaltet.`);
    if (req.path !== '/') res.set('Cache-Control', 'no-store');
    next();
  });
  const gate = (req, res, next) => (req.user ? next() : fail(res, 401, `Für ${cg.title} musst du angemeldet sein.`));
  function loadTable(req, res, next) {
    req.table = cg.get(req.params.id);
    // Tische eines Spieltisches laufen über /kartenspiele (src/routes/kartenspiele.js)
    return req.table && !req.table.spieltisch ? next() : fail(res, 404, 'Diesen Tisch gibt es nicht mehr.');
  }

  // Gespielt wird im gemeinsamen Fenster Kartenspiele
  router.get('/', (req, res) => res.redirect('/kartenspiele'));

  router.get('/tische', gate, (req, res) => {
    const mine = cg.tableOf(req.user.id);
    const t = cg.userTotals(req.user.id);
    res.json({ tables: cg.list(req.user), mine: mine ? mine.id : null, me: { id: req.user.id, name: req.user.name, user: req.user.username, admin: req.user.isAdmin, games: t.games, wins: t.wins } });
  });
  router.post('/tische', gate, auth.rateLimit(cg.id + 'table', 20, 600), (req, res) => {
    const b = req.body || {};
    const t = cg.create(req.user, { ...b, hidden: !!b.hidden });
    if (!t) return fail(res, 503, 'Gerade gibt es zu viele Tische. Versuch es später noch einmal.');
    res.json({ id: t.id });
  });

  // Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
  router.get('/tisch/:id/events', gate, loadTable, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    const leave = cg.join(req.table, req.user, res);
    req.on('close', leave);
  });

  router.post('/tisch/:id', gate, loadTable, auth.rateLimit(cg.id + 'ctl', 300, 60), (req, res) => {
    const t = req.table, b = req.body || {};
    if (b.action === 'close') {
      if (!cg.isHost(t, req.user)) return fail(res, 403, 'Nur der Gastgeber kann den Tisch schließen.');
      cg.remove(t);
      return res.json({ ok: true });
    }
    const err = cg.control(t, req.user, b);
    if (err) return fail(res, 400, err);
    cg.broadcast(t);
    res.json({ ok: true });
  });

  // Bestenliste: nur wer sein Profil dem Betrachter zeigt, erscheint mit Namen
  router.get('/statistik', gate, (req, res) => {
    const board = cg.leaderboard().filter(u => profiles.canViewProfile(req.user, u)).slice(0, 100).map(u => ({
      id: u.id, name: profiles.displayName(u), user: u.username, avatar: u.avatar, games: u.games, wins: u.wins, bonus: u.bonus, best: u.best, rounds: u.rounds, top: u.top, low: u.low,
    }));
    res.json({
      board,
      me: cg.userTotals(req.user.id),
      games: cg.recentGames(req.user.id, 20).map(g => ({ table: g.table_name, ended: g.ended_at, players: g.players, place: g.place, won: !!g.won, quit: !!g.quit, score: g.score, best: g.best, bonus: g.bonus, rounds: g.rounds })),
    });
  });

  return router;
};
