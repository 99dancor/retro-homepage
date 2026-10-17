'use strict';
// Minesweeper (Startmenü → Spiele und Apps → 💣 Minesweeper). Spielen geht auch ohne Konto; mit Konto meldet die Seite
// Start und Ende per POST (Formular-Token im Kopf x-csrf-token), daraus entstehen Profil-Zahlen und Bestzeiten.
const express = require('express');
const ms = require('../minesweeper');
const auth = require('../auth');
const notify = require('../notify');
const profiles = require('../profiles');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });

router.use(express.json({ limit: '2kb' }));
router.use((req, res, next) => { if (req.path !== '/') res.set('Cache-Control', 'no-store'); next(); });
function gate(req, res, next) { return req.user ? next() : fail(res, 401, 'Zum Speichern musst du angemeldet sein.'); }

router.get('/', (req, res) => {
  if (req.user) profiles.countStart(req.user, 'minesweeper');
  res.render('minesweeper', { title: 'Minesweeper', levels: ms.LEVELS, limits: ms.LIMITS });
});

// Wer ein Profil nicht sehen darf, sieht den Namen nicht: dann steht dort wie im Original „Anonym“
function entry(viewer, u) {
  const visible = profiles.canViewProfile(viewer, u);
  return { seconds: u.seconds, name: visible ? profiles.displayName(u) : 'Anonym', url: visible ? profiles.profileUrl(u.username) : null, me: !!viewer && viewer.id === u.id };
}
router.get('/bestzeiten', (req, res) => {
  const out = { levels: {}, mine: null };
  for (const k of Object.keys(ms.LEVELS)) out.levels[k] = ms.bestTimes(k, 10).map(u => entry(req.user, u));
  if (req.user) {
    const t = ms.userTotals(req.user.id);
    out.mine = { games: t.games, wins: t.wins, streak: t.streak, best_streak: t.best_streak, best: t.best };
  }
  res.json(out);
});

router.post('/start', gate, auth.rateLimit('msstart', 600, 600), (req, res) => {
  if (!ms.start(req.user.id, req.body || {})) return fail(res, 400, 'Ungültiges Spielfeld.');
  res.json({ ok: true });
});

router.post('/ergebnis', gate, auth.rateLimit('msend', 600, 600), (req, res) => {
  const b = req.body || {};
  const r = ms.finish(req.user.id, { won: b.won === true, seconds: b.seconds });
  if (!r) return fail(res, 409, 'Zu diesem Spiel kennt der Server keinen Start.');
  // Wer bisher den Rekord der Seite hielt, bekommt Bescheid
  if (r.beaten) {
    notify.send(r.beaten.id, 'highscore', {
      title: `🏆 ${profiles.displayName(req.user)} hat deinen Rekord in Minesweeper geknackt`,
      body: `${ms.LEVELS[r.level].name}: ${r.seconds} Sekunden (dein Rekord: ${r.beaten.seconds})`, url: '/minesweeper',
    });
  }
  res.json({ ok: true, level: r.level, seconds: r.seconds, personal: r.personal, record: r.record });
});

module.exports = router;
