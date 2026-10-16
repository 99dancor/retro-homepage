'use strict';
// Paint-Lobbys unter /paint/lobby… (siehe src/paintlobby.js). Nur für angemeldete Mitglieder. Das Bild kommt live per
// Server-Sent Events, Änderungen per POST mit dem Formular-Token im Kopf x-csrf-token und der Verbindungsnummer (sid).
const express = require('express');
const auth = require('../auth');
const P = require('../../public/paint-core');
const png = require('../png');
const paint = require('../paint');
const lobby = require('../paintlobby');

const router = express.Router();
const fail = (res, status, error) => res.status(status).json({ error });
const small = express.json({ limit: '20kb' });
const big = express.json({ limit: '20mb' });   // ein eingefügtes Foto in voller Größe als PNG

function gate(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!paint.lobbiesOn()) return fail(res, 404, 'Lobbys sind in Paint gerade ausgeschaltet.');
  if (!req.user) return fail(res, 401, 'Zum gemeinsamen Malen musst du angemeldet sein.');
  next();
}
function load(req, res, next) {
  req.lobby = lobby.get(req.params.id);
  return req.lobby ? next() : fail(res, 404, 'Diese Lobby gibt es nicht mehr.');
}
function here(req, res, next) {
  // Wer ändert, muss gerade in der Lobby sein (offene Verbindung)
  const l = req.lobby;
  for (const c of l.clients) if (c.user.id === req.user.id) return next();
  return fail(res, 409, 'Du bist nicht mehr mit der Lobby verbunden. Lade Paint neu.');
}

router.get('/lobbys', gate, (req, res) => res.json({ lobbies: lobby.list(req.user), max: paint.maxSize() }));

// Neue Lobby: leere Leinwand (w, h) oder das gerade offene Bild als PNG (data)
router.post('/lobbys', gate, auth.rateLimit('ptlobby', 20, 600), big, (req, res) => {
  const b = req.body || {}, m = paint.maxSize();
  let image;
  if (b.data) {
    image = png.decode(Buffer.from(String(b.data), 'base64'), m.w * m.h);
    if (!image || image.w > m.w || image.h > m.h) return fail(res, 400, `Das Bild ließ sich nicht übernehmen (höchstens ${m.w} × ${m.h} Pixel).`);
    for (let i = 3; i < image.d.length; i += 4) image.d[i] = 255;
  } else {
    const w = Math.round(Number(b.w)), h = Math.round(Number(b.h));
    image = P.create(w >= 1 && w <= m.w ? w : 640, h >= 1 && h <= m.h ? h : 480, 0xffffff);
  }
  const l = lobby.create(req.user, { name: b.name, hidden: !!b.hidden, everyone: b.everyone !== false, chat: b.chat !== false }, image);
  if (!l) return fail(res, 503, 'Gerade gibt es zu viele Lobbys. Versuch es später noch einmal.');
  res.json({ id: l.id });
});

router.get('/lobby/:id', gate, load, (req, res) => res.json({ lobby: lobby.state(req.lobby) }));

// Live-Verbindung. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/lobby/:id/events', gate, load, (req, res) => {
  const l = req.lobby;
  if (lobby.full(l) && ![...l.clients].some(c => c.user.id === req.user.id)) return fail(res, 409, `Die Lobby ist voll (höchstens ${lobby.MAX_PEOPLE} Leute).`);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const leave = lobby.join(l, req.user, res);
  req.on('close', leave);
});
// Das Bild, wie es auf dem Server gerade ist. X-Seq: die Nummer der letzten Änderung darin
router.get('/lobby/:id/bild.png', gate, load, (req, res) => {
  const s = lobby.snapshot(req.lobby);
  res.set({ 'Content-Type': 'image/png', 'X-Seq': String(s.seq), 'Content-Security-Policy': "default-src 'none'" });
  res.end(s.buf);
});

router.post('/lobby/:id/op', gate, load, here, auth.rateLimit('ptop', 600, 60), big, (req, res) => {
  const r = lobby.op(req.lobby, req.user, req.body || {}, String((req.body || {}).sid || ''));
  return r.error ? fail(res, 400, r.error) : res.json(r);
});
router.post('/lobby/:id/undo', gate, load, here, auth.rateLimit('ptop', 600, 60), small, (req, res) => {
  const b = req.body || {}, fn = b.redo ? lobby.redo : lobby.undo;
  const r = fn(req.lobby, req.user, String(b.sid || ''), String(b.cid || '').slice(0, 40));
  return r.error ? fail(res, 409, r.error) : res.json(r);
});
router.post('/lobby/:id/zeiger', gate, load, here, auth.rateLimit('ptcur', 1500, 60), small, (req, res) => {
  lobby.cursor(req.lobby, req.user, String((req.body || {}).sid || ''), req.body || {});
  res.json({ ok: true });
});
router.post('/lobby/:id/chat', gate, load, here, auth.rateLimit('ptchat', 30, 60), small, (req, res) => {
  const err = lobby.chat(req.lobby, req.user, (req.body || {}).text);
  return err ? fail(res, 400, err) : res.json({ ok: true });
});
router.post('/lobby/:id/speichern', gate, load, here, auth.rateLimit('ptsave', 30, 600), small, (req, res) => {
  const r = lobby.save(req.lobby, req.user, req.body || {});
  if (r.error) return fail(res, r.status || 400, r.error);
  const a = paint.get(r.id);
  res.json({ artwork: paint.row(a, req.user), note: a.visibility === 'public' && !a.approved ? 'Öffentlich zu sehen ist es erst, wenn der Admin es freigibt.' : null });
});
// Gastgeber: Einstellungen, Malrechte, Lobby schließen
router.post('/lobby/:id', gate, load, small, (req, res) => {
  const l = req.lobby, b = req.body || {};
  if (b.action === 'close') {
    if (!lobby.isHost(l, req.user)) return fail(res, 403, 'Nur der Gastgeber kann die Lobby schließen.');
    lobby.remove(l);
    return res.json({ ok: true });
  }
  const err = lobby.control(l, req.user, b);
  return err ? fail(res, 403, err) : res.json({ ok: true });
});

module.exports = router;
