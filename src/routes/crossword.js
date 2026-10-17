'use strict';
// Kreuzworträtsel (Startmenü → Spiele und Apps → 📰 Kreuzworträtsel). Rätseln geht auch ohne Konto, dann bleibt der
// Stand im Browser. Prüfen und Aufdecken fragen immer den Server, weil nur er die Lösung kennt. Mit Konto speichert
// die Seite den Stand per POST (Formular-Token im Kopf x-csrf-token), daraus entstehen Profil, Serie und Bestenliste.
const express = require('express');
const cw = require('../crossword');
const auth = require('../auth');
const profiles = require('../profiles');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });

router.use(express.json({ limit: '4kb' }));
router.use((req, res, next) => { if (req.path !== '/') res.set('Cache-Control', 'no-store'); next(); });
function dayParam(req, res, next) {
  const day = (req.body && req.body.day) || req.query.day || cw.today();
  if (!cw.playable(day)) return fail(res, 404, 'Dieses Rätsel gibt es nicht (mehr).');
  req.day = day;
  next();
}
const SCOPES = ['cell', 'word', 'all'];
function scopeParam(req, res, next) {
  const b = req.body || {};
  if (!SCOPES.includes(b.scope) || (b.scope === 'word' && b.dir !== 'a' && b.dir !== 'd')) return fail(res, 400, 'Ungültige Anfrage.');
  next();
}

function state(user, day) {
  const p = cw.puzzle(day);
  const out = { day, today: cw.today(), puzzle: cw.publicPuzzle(p), progress: null };
  if (user) {
    const r = cw.progress(user.id, day);
    if (r) out.progress = { letters: r.letters, seconds: r.seconds, help: r.checks + r.reveals, solved: !!r.solved_at, gave_up: !!r.gave_up };
  }
  return out;
}

router.get('/', (req, res) => {
  if (req.user) profiles.countStart(req.user, 'kreuzwortraetsel');
  res.render('crossword', { title: 'Kreuzworträtsel', data: state(req.user, cw.today()) });
});

router.get('/raetsel', dayParam, (req, res) => res.json(state(req.user, req.day)));

// Frühere Rätsel; mit Konto steht dabei, welche schon gelöst sind
router.get('/archiv', (req, res) => {
  const days = cw.archive();
  const mine = new Map();
  if (req.user) {
    for (const d of days) {
      const r = cw.progress(req.user.id, d);
      if (r) mine.set(d, r.solved_at ? 'solved' : r.gave_up ? 'gave_up' : 'started');
    }
  }
  res.json({ today: cw.today(), days: days.map(d => ({ day: d, state: mine.get(d) || null })) });
});

// Wer ein Profil nicht sehen darf, sieht den Namen nicht
function entry(viewer, u) {
  const visible = profiles.canViewProfile(viewer, u);
  return { seconds: u.seconds, help: u.help > 0, name: visible ? profiles.displayName(u) : 'Anonym', url: visible ? profiles.profileUrl(u.username) : null, me: !!viewer && viewer.id === u.id };
}
router.get('/bestenliste', dayParam, (req, res) => {
  const out = { day: req.day, list: cw.leaderboard(req.day, 20).map(u => entry(req.user, u)), solvers: cw.rank(0, req.day).of, mine: null };
  if (req.user) out.mine = cw.userTotals(req.user.id);
  res.json(out);
});

router.post('/speichern', auth.rateLimit('cwsave', 900, 600), dayParam, (req, res) => {
  const b = req.body || {};
  res.json(cw.save(req.user ? req.user.id : null, req.day, { letters: b.letters, seconds: b.seconds }));
});
router.post('/pruefen', auth.rateLimit('cwcheck', 600, 600), dayParam, scopeParam, (req, res) => {
  const b = req.body;
  res.json(cw.check(req.user ? req.user.id : null, req.day, { letters: b.letters, scope: b.scope, cell: b.cell, dir: b.dir }));
});
router.post('/aufdecken', auth.rateLimit('cwreveal', 600, 600), dayParam, scopeParam, (req, res) => {
  const b = req.body;
  res.json(cw.reveal(req.user ? req.user.id : null, req.day, { scope: b.scope, cell: b.cell, dir: b.dir }));
});

module.exports = router;
