'use strict';
// Spielstände im Konto. Browser-Spiele unter /apps/<slug>/play und die eingebauten Spiele (src/games.js)
// laufen auf derselben Seite, das Login-Cookie geht bei fetch() also automatisch mit.
//
//   GET    /api/saves/<app>          -> { user, slots: [{ slot, size, updated_at }] }   (401 ohne Login)
//   GET    /api/saves/<app>/<slot>   -> { slot, data, updated_at }                      (404 wenn leer)
//   PUT    /api/saves/<app>/<slot>   <- { data: "<Text>" }  als application/json
//   DELETE /api/saves/<app>/<slot>
//
// Schreiben geht nur per PUT/DELETE mit JSON: Fremde Seiten bekommen dafür keine CORS-Freigabe,
// und das sameSite=lax-Cookie wird bei solchen Anfragen von außen nicht mitgeschickt.
const express = require('express');
const { db, now } = require('../db');
const auth = require('../auth');
const GAMES = require('../games');

const router = express.Router();
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SLOTS = 20;
const SLOT_RE = /^[A-Za-z0-9_.-]{1,40}$/;

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

function loadApp(req, res, next) {
  if (!Object.hasOwn(GAMES, req.params.app)) {
    const a = db.prepare('SELECT * FROM apps WHERE slug = ?').get(req.params.app);
    if (!a || !auth.canSee(req.user, 'app', a)) return res.status(404).json({ error: 'app' });
  }
  if (!req.user) return res.status(401).json({ error: 'login' });
  if (req.params.slot !== undefined && !SLOT_RE.test(req.params.slot)) return res.status(400).json({ error: 'slot' });
  next();
}

router.get('/:app', loadApp, (req, res) => {
  const slots = db.prepare(`SELECT slot, length(CAST(data AS BLOB)) AS size, updated_at FROM game_saves
                            WHERE user_id = ? AND app_slug = ? ORDER BY slot`).all(req.user.id, req.params.app);
  res.json({ user: req.user.username, slots });
});

router.get('/:app/:slot', loadApp, (req, res) => {
  const s = db.prepare('SELECT slot, data, updated_at FROM game_saves WHERE user_id = ? AND app_slug = ? AND slot = ?')
    .get(req.user.id, req.params.app, req.params.slot);
  if (!s) return res.status(404).json({ error: 'empty' });
  res.json(s);
});

router.put('/:app/:slot', auth.rateLimit('saves', 120, 60), loadApp, express.json({ limit: MAX_BYTES + 1024 }), (req, res) => {
  if (!req.is('application/json')) return res.status(415).json({ error: 'json' });
  const data = req.body && req.body.data;
  if (typeof data !== 'string') return res.status(400).json({ error: 'data' });
  if (Buffer.byteLength(data) > MAX_BYTES) return res.status(413).json({ error: 'size' });
  const { app, slot } = req.params;
  const exists = db.prepare('SELECT 1 FROM game_saves WHERE user_id = ? AND app_slug = ? AND slot = ?').get(req.user.id, app, slot);
  if (!exists && db.prepare('SELECT COUNT(*) AS n FROM game_saves WHERE user_id = ? AND app_slug = ?').get(req.user.id, app).n >= MAX_SLOTS) {
    return res.status(409).json({ error: 'slots' });
  }
  const t = now();
  db.prepare(`INSERT INTO game_saves(user_id, app_slug, slot, data, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id, app_slug, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(req.user.id, app, slot, data, t);
  res.json({ ok: true, slot, updated_at: t });
});

router.delete('/:app/:slot', loadApp, (req, res) => {
  db.prepare('DELETE FROM game_saves WHERE user_id = ? AND app_slug = ? AND slot = ?').run(req.user.id, req.params.app, req.params.slot);
  res.json({ ok: true });
});

// Fehler (z. B. zu großer oder kaputter JSON-Body) als JSON statt als HTML-Seite
router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.status === 413 ? 'size' : err.status ? 'request' : 'server' });
});

module.exports = router;
