'use strict';
// Sudoku (Startmenü → Spiele und Apps → 🔢 Sudoku). Jeden Tag drei Sudokus (Leicht, Mittel, Schwer). Spielen geht
// auch ohne Konto, dann bleibt der Stand im Browser. Prüfen und Aufdecken fragen immer den Server, weil nur er die
// Lösung kennt. Mit Konto speichert die Seite den Stand per POST (Formular-Token im Kopf x-csrf-token), daraus
// entstehen Profil, Serie und Bestenliste.
const express = require('express');
const sd = require('../sudoku');
const auth = require('../auth');
const profiles = require('../profiles');
const us = require('../usersettings');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });

router.use(express.json({ limit: '4kb' }));
router.use((req, res, next) => { if (req.path !== '/') res.set('Cache-Control', 'no-store'); next(); });
function dayParam(req, res, next) {
  const day = (req.body && req.body.day) || req.query.day || sd.today();
  if (!sd.playable(day)) return fail(res, 404, 'Dieses Sudoku gibt es nicht (mehr).');
  req.day = day;
  next();
}
function levelParam(req, res, next) {
  const level = (req.body && req.body.level) || req.query.level;
  if (!sd.validLevel(level)) return fail(res, 400, 'Ungültige Stufe.');
  req.level = level;
  next();
}
function scopeParam(req, res, next) {
  const b = req.body || {};
  if (b.scope !== 'cell' && b.scope !== 'all') return fail(res, 400, 'Ungültige Anfrage.');
  next();
}

// Alle drei Sudokus eines Tages auf einmal, damit der Wechsel der Stufe ohne Laden geht
function state(user, day) {
  const out = { day, today: sd.today(), levels: {} };
  for (const k of sd.LEVEL_KEYS) {
    const p = sd.puzzle(day, k), lv = { name: sd.LEVELS[k].name, givens: p.givens, progress: null };
    if (user) {
      const r = sd.progress(user.id, day, k);
      if (r) lv.progress = { digits: r.digits, seconds: r.seconds, help: r.checks + r.reveals, solved: !!r.solved_at, gave_up: !!r.gave_up };
    }
    out.levels[k] = lv;
  }
  return out;
}

router.get('/', (req, res) => {
  if (req.user) profiles.countStart(req.user, 'sudoku');
  res.render('sudoku', { title: 'Sudoku', data: state(req.user, sd.today()) });
});

router.get('/raetsel', dayParam, (req, res) => res.json(state(req.user, req.day)));

// Frühere Tage; mit Konto steht dabei, welche Stufen schon gelöst sind
router.get('/archiv', (req, res) => {
  const days = sd.archive();
  res.json({ today: sd.today(), days: days.map(d => {
    const st = {};
    if (req.user) {
      for (const k of sd.LEVEL_KEYS) {
        const r = sd.progress(req.user.id, d, k);
        if (r) st[k] = r.solved_at ? 'solved' : r.gave_up ? 'gave_up' : 'started';
      }
    }
    return { day: d, state: st };
  }) });
});

// Wer ein Profil nicht sehen darf, sieht den Namen nicht
// u kommt aus us.boardList: anonym ohne Konto und Profil-Link
function entry(viewer, u) {
  return { seconds: u.seconds, help: u.help > 0, name: u.name, url: u.user ? profiles.profileUrl(u.user) : null, me: !!viewer && viewer.id === u.id };
}
router.get('/bestenliste', dayParam, levelParam, (req, res) => {
  const out = { day: req.day, level: req.level, list: us.boardList('sudoku', sd.leaderboard(req.day, req.level, 60), req.user).slice(0, 20).map(u => entry(req.user, u)), solvers: sd.rank(0, req.day, req.level).of, mine: null };
  if (req.user) out.mine = sd.userTotals(req.user.id);
  res.json(out);
});

router.post('/speichern', auth.rateLimit('sdsave', 900, 600), dayParam, levelParam, (req, res) => {
  const b = req.body || {};
  res.json(sd.save(req.user ? req.user.id : null, req.day, req.level, { digits: b.digits, seconds: b.seconds }));
});
router.post('/pruefen', auth.rateLimit('sdcheck', 600, 600), dayParam, levelParam, scopeParam, (req, res) => {
  const b = req.body;
  res.json(sd.check(req.user ? req.user.id : null, req.day, req.level, { digits: b.digits, scope: b.scope, cell: b.cell }));
});
router.post('/aufdecken', auth.rateLimit('sdreveal', 600, 600), dayParam, levelParam, scopeParam, (req, res) => {
  const b = req.body;
  res.json(sd.reveal(req.user ? req.user.id : null, req.day, req.level, { scope: b.scope, cell: b.cell }));
});

module.exports = router;
