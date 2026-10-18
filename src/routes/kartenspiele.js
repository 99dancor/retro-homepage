'use strict';
// Kartenspiele (src/kartenspiele.js): die Seite /kartenspiele mit Spieltischen, Kasse und dem Tisch des gewählten Spiels.
// Der Tisch kommt wie bei den einzelnen Spielen per Server-Sent Events (/kartenspiele/tisch/<id>/events), Züge gehen per
// POST an /kartenspiele/tisch/<id> mit dem Formular-Token im Kopf x-csrf-token. Bestenlisten und Regeln holt das Fenster
// weiter bei den Spielen selbst (/blackjack/statistik usw.).
const express = require('express');
const ks = require('../kartenspiele');
const kasse = require('../kasse');
const profiles = require('../profiles');
const auth = require('../auth');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });

router.use(express.json({ limit: '10kb' }));
router.use((req, res, next) => {
  if (!ks.games().some(g => g.id !== 'lobby')) return req.path === '/' ? res.status(404).render('error', { title: 'Kartenspiele', message: 'Die Kartenspiele sind gerade ausgeschaltet.' }) : fail(res, 404, 'Die Kartenspiele sind ausgeschaltet.');
  if (req.path !== '/') res.set('Cache-Control', 'no-store');
  next();
});
const gate = (req, res, next) => (req.user ? next() : fail(res, 401, 'Für die Kartenspiele musst du angemeldet sein.'));
function loadTable(req, res, next) {
  req.salon = ks.get(req.params.id);
  return req.salon ? next() : fail(res, 404, 'Diesen Spieltisch gibt es nicht mehr.');
}
function wallet(user) {
  const s = ks.seatedAt(user.id);
  return { ...kasse.view(kasse.wallet(user.id)), ...kasse.config(), atTable: s && ks.GAMES[s.game].money ? s.name : null };
}

router.get('/', (req, res) => {
  if (req.user) profiles.countStart(req.user, 'kartenspiele');
  res.render('kartenspiele', { title: 'Kartenspiele', games: ks.games(), felts: ks.FELTS, backs: ks.BACKS, kasse: kasse.config() });
});

router.get('/tische', gate, (req, res) => {
  const mine = ks.seatedAt(req.user.id);
  res.json({ tables: ks.list(req.user), mine: mine ? mine.id : null, games: ks.games(), kasse: wallet(req.user), me: { id: req.user.id, name: req.user.name, user: req.user.username, admin: req.user.isAdmin } });
});
router.post('/tische', gate, auth.rateLimit('kstable', 20, 600), (req, res) => {
  const b = req.body || {};
  const r = ks.create(req.user, { name: b.name, hidden: !!b.hidden, seats: b.seats, game: b.game, felt: b.felt, back: b.back });
  if (r.error) return fail(res, 503, r.error);
  res.json({ id: r.table.id });
});

// Kasse: Kontostand, Bestenliste nach Bilanz und Nachkaufen außerhalb eines Geldtisches
router.get('/kasse', gate, (req, res) => {
  const board = kasse.leaderboard().filter(u => profiles.canViewProfile(req.user, u)).slice(0, 100)
    .map(u => ({ id: u.id, name: profiles.displayName(u), user: u.username, balance: u.balance, bought: u.bought, buyins: u.buyins, net: u.net }));
  res.json({ kasse: wallet(req.user), board });
});
router.post('/kasse', gate, auth.rateLimit('kskasse', 30, 600), (req, res) => {
  if ((req.body || {}).action !== 'rebuy') return fail(res, 400, 'Unbekannte Aktion.');
  const w = wallet(req.user);
  if (w.atTable) return fail(res, 400, `Dein Geld liegt gerade am Spieltisch „${w.atTable}“. Kauf dort nach.`);
  const err = kasse.rebuy(req.user.id);
  if (err) return fail(res, 400, err);
  res.json({ kasse: wallet(req.user) });
});

router.get('/tisch/:id', gate, loadTable, (req, res) => {
  if (req.salon.game !== 'lobby') profiles.countStart(req.user, req.salon.game);
  res.json(ks.meta(req.salon));
});

// Live-Verbindung zum Tisch des gewählten Spiels. Wechselt das Spiel, kommt „switch“ und die Verbindung endet.
router.get('/tisch/:id/events', gate, loadTable, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const s = req.salon, t = ks.tableOf(s);
  res.write(`event: salon\ndata: ${JSON.stringify(ks.meta(s))}\n\n`);
  const leave = ks.engine(s.game).join(t, req.user, res);
  req.on('close', () => {
    const host = t.hostId;
    leave();
    // Ging der Gastgeber, hat jemand anderes übernommen: die Leiste über dem Tisch muss das wissen
    if (t.hostId !== host && ks.tableOf(s) === t) ks.announce(s);
  });
});

router.post('/tisch/:id', gate, loadTable, auth.rateLimit('ksctl', 300, 60), (req, res) => {
  const s = req.salon, b = req.body || {};
  let err;
  if (b.action === 'close') {
    if (!ks.isHost(s, req.user)) return fail(res, 403, 'Nur der Gastgeber kann den Spieltisch schließen.');
    ks.close(s);
    return res.json({ ok: true });
  }
  if (b.action === 'game') err = ks.switchGame(s, req.user, String(b.game || ''));
  else if (b.action === 'design') err = ks.settings(s, req.user, b);
  else err = ks.control(s, req.user, b);
  if (err) return fail(res, 400, err);
  const t = ks.tableOf(s);
  if (t) ks.engine(s.game).broadcast(t);
  res.json({ ok: true });
});

module.exports = router;
