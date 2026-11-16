'use strict';
// DS-Spiele (src/ds.js): das Spielfenster, die ROM für den Emulator im Browser und der Spielstand des Mitglieds.
//
//   GET  /ds                    Liste der Spiele, die das Konto spielen darf
//   GET  /ds/<slug>             das Spielfenster (views/ds.ejs)
//   GET  /ds/<slug>/rom         die ROM, nur für Mitglieder, die das Spiel sehen dürfen (nie zwischengespeichert für andere)
//   GET  /ds/<slug>/spielstand  der eigene Spielstand (204 wenn noch keiner), Fassung im Kopf x-save-rev
//   POST /ds/<slug>/spielstand  neuer Spielstand als application/octet-stream, x-save-rev = Fassung, auf der er beruht
//                               (Formular-Token im Kopf x-csrf-token), 409 wenn inzwischen eine neuere da ist
const express = require('express');
const fs = require('node:fs');
const ds = require('../ds');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });
// Der Emulator ist WebAssembly: Nur die Spielseite darf es übersetzen (wasm-unsafe-eval), der Rest der Seite nicht
const CSP = "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; frame-ancestors 'self'; form-action 'self'";

function load(req, res, next) {
  const g = ds.bySlug(req.params.slug);
  const api = /\/(rom|spielstand)$/.test(req.path);
  if (!req.user) {
    if (api) return fail(res, 401, 'Bitte melde dich an.');
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  if (!g || !ds.canPlay(req.user, g)) {
    if (api) return fail(res, 404, 'Dieses Spiel gibt es nicht.');
    return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Spiel gibt es nicht.' });
  }
  req.game = g;
  next();
}

router.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/ds');
  const games = ds.visibleTo(req.user);
  if (games.length === 1) return res.redirect(`/ds/${games[0].slug}`);
  res.render('ds-list', { title: 'DS-Spiele', games });
});

router.get('/:slug', load, (req, res) => {
  const g = req.game;
  ds.countPlay(g);
  res.set('Content-Security-Policy', CSP);
  res.render('ds', { title: g.title, game: g, lang: ds.language(g.game_code), core: ds.CORE, coreReady: ds.coreReady() });
});

router.get('/:slug/rom', load, (req, res) => {
  const g = req.game, file = ds.romPath(g);
  let st;
  try { st = fs.statSync(file); } catch { return fail(res, 404, 'Die ROM fehlt auf dem Server.'); }
  const etag = `"${g.sha1}"`;
  // privat: nur der Browser des Mitglieds darf sie behalten, kein Proxy dazwischen
  res.set({ 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Robots-Tag': 'noindex', 'Content-Type': 'application/octet-stream' });
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.set('Content-Length', String(st.size));
  fs.createReadStream(file).pipe(res);
});

router.get('/:slug/spielstand', load, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const s = ds.getSave(req.user.id, req.game.id);
  if (!s) return res.set('x-save-rev', '0').status(204).end();
  res.set({ 'x-save-rev': String(s.rev), 'Content-Type': 'application/octet-stream' });
  res.send(Buffer.from(s.data));
});

router.post('/:slug/spielstand', load, express.raw({ type: 'application/octet-stream', limit: ds.MAX_SAVE }), (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'Leerer Spielstand.');
  const base = Number(req.get('x-save-rev'));
  if (!Number.isInteger(base) || base < 0) return fail(res, 400, 'Fassung fehlt.');
  const r = ds.putSave(req.user.id, req.game.id, req.body, base);
  if (r.conflict !== undefined) return res.status(409).json({ error: 'Der Spielstand wurde inzwischen woanders gespeichert.', rev: r.conflict });
  res.json({ rev: r.rev });
});

module.exports = router;
