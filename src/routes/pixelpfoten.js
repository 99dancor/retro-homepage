'use strict';
// Pixelpfoten-Besuche unter /api/pixelpfoten (siehe src/pixelpfoten.js). Nur für angemeldete Mitglieder.
// Schreibende Anfragen schicken das Formular-Token im Kopf x-csrf-token (das Spiel bekommt es als data-csrf).
//
//   GET  /nachbarn              -> { neighbours: [...] }   wen ich besuchen darf
//   GET  /zimmer/<name>         -> { host, room, pets, live, book }
//   POST /zimmer/<name>         <- { kind, pet, detail }   Handlung im Besuchsbuch eintragen
//   GET  /post                  -> { entries, book }       noch nicht eingerechnete Besuche bei mir
//   POST /post                  <- { upTo }                eingerechnet bis id
//   GET  /live/<name>           Server-Sent Events: hello, join, state, leave, post
//   POST /live/<name>           <- { sid, pets, toy }      Stand der eigenen Tiere
const express = require('express');
const auth = require('../auth');
const pp = require('../pixelpfoten');

const router = express.Router();
const small = express.json({ limit: '16kb' });
const fail = (res, status, error) => res.status(status).json({ error });

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return fail(res, 401, 'Zum Besuchen musst du angemeldet sein.');
  next();
});

router.get('/nachbarn', (req, res) => res.json({ neighbours: pp.neighbours(req.user) }));

router.get('/zimmer/:name', (req, res) => {
  const r = pp.room(req.user, req.params.name);
  return r ? res.json(r) : fail(res, 404, 'Dieses Zimmer kannst du gerade nicht besuchen.');
});
router.post('/zimmer/:name', auth.rateLimit('ppact', 120, 60), small, (req, res) => {
  const r = pp.act(req.user, req.params.name, req.body || {});
  return r.error ? fail(res, 400, r.error) : res.json(r);
});

router.get('/post', (req, res) => res.json({ entries: pp.inbox(req.user.id), book: pp.book(req.user.id) }));
router.post('/post', small, (req, res) => { pp.markApplied(req.user.id, (req.body || {}).upTo); res.json({ ok: true }); });

// X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll
router.get('/live/:name', (req, res) => {
  const leave = pp.join(req.user, req.params.name, res);
  if (leave.error) return fail(res, 403, leave.error);
  req.on('close', leave);
});
router.post('/live/:name', auth.rateLimit('pplive', 900, 60), small, (req, res) => {
  const r = pp.update(req.user, req.params.name, req.body || {});
  return r.error ? fail(res, 409, r.error) : res.json(r);
});

module.exports = router;
