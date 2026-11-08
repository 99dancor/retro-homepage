'use strict';
// Jellyfin im Mediaplayer (src/jellyfin.js): JSON für public/music.js, Bilder und Videos über die Seite.
// Schreiben geht per POST mit dem Formular-Token im Kopf x-csrf-token (wie beim Mediaplayer).
const express = require('express');
const jf = require('../jellyfin');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));
const fail = (res, e) => res.status(e.status === 403 ? 403 : e.status === 404 ? 404 : 502).json({ error: e.status === 403 ? 'Dafür fehlt dir die Freigabe.' : e.message || 'Jellyfin antwortet nicht.' });
const json = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await fn(req, res)); } catch (e) { fail(res, e); }
};
const needLogin = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Bitte melde dich an.' }));

router.get('/status', json(req => {
  const st = jf.status(req.user);
  return { on: st.on, browse: !!st.browse, play: !!st.play, state: st.state || null, canRequest: !!st.canRequest, admin: !!st.admin, name: st.name || 'Jellyfin', app: st.app || null };
}));
router.get('/start', json(req => jf.home(req.user)));
router.get('/liste', json(req => jf.browse(req.user, req.query)));
router.get('/genres', json(async req => ({ genres: await jf.genres(req.user, req.query.type) })));
router.get('/titel/:id', json(req => jf.details(req.user, req.params.id)));
router.get('/folgen/:id', json(async req => ({ items: await jf.episodes(req.user, req.params.id, req.query.staffel || '') })));

router.post('/anfragen', needLogin, json(req => {
  const r = jf.request(req.user, { message: req.body.message, app: !!req.body.app });
  if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
  return r;
}));
router.post('/merken/:id', needLogin, json(async req => { await jf.favorite(req.user, req.params.id, !!req.body.on); return { ok: true }; }));
router.post('/abspielen/:id', needLogin, json(req => jf.play(req.user, req.params.id, {
  audio: req.body.audio ?? null, sub: req.body.sub ?? null, bitrate: req.body.bitrate, codecs: Array.isArray(req.body.codecs) ? req.body.codecs.map(String).slice(0, 8) : [],
})));
router.post('/fortschritt/:id', needLogin, json(async req => {
  await jf.progress(req.user, req.params.id, { pos: req.body.pos, done: !!req.body.done, stop: !!req.body.stop, session: String(req.body.session || '').slice(0, 64) });
  return { ok: true };
}));
// Zugangsdaten für die Jellyfin-Apps: Name und Adresse immer, das Passwort nur einmal (danach neu erzeugen)
router.post('/app-zugang', needLogin, json(req => {
  const st = jf.status(req.user);
  if (!st.app) throw Object.assign(new Error('Keine App-Zugangsdaten.'), { status: 403 });
  return { url: st.app.url, name: st.app.name, pw: jf.takeAppPassword(req.user), canReset: st.app.created };
}));
router.post('/app-passwort', needLogin, json(async req => ({ pw: await jf.newAppPassword(req.user) })));

// Bilder (Cover) und Videos. Fehler hier nur als Status, ohne Text.
router.get('/bild/:id', async (req, res) => {
  try { await jf.image(req.user, req.params.id, req.query.w, res); } catch { if (!res.headersSent) res.status(502).end(); }
});
router.get('/s/:id/*rest', async (req, res) => {
  const rest = [].concat(req.params.rest || []).join('/');
  try { await jf.stream(req.user, req.params.id, rest, req.query, req, res); } catch { if (!res.headersSent) res.status(502).end(); }
});
// HLS im Browser (Chrome, Firefox): hls.js aus node_modules, ohne fremden Server
router.get('/hls.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(require.resolve('hls.js/dist/hls.light.min.js'));
});

module.exports = router;
