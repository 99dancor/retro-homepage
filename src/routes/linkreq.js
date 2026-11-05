'use strict';
// Link-Vorschläge für Mitglieder (src/linkreq.js): vorschlagen im Fenster „Hinzufügen“ (Reiter Link vorschlagen),
// Meine Vorschläge mit Status und Ergebnis, Teilen vom Handy (manifest share_target).
const express = require('express');
const auth = require('../auth');
const lr = require('../linkreq');

const router = express.Router();
const wantsJson = req => req.accepts(['html', 'json']) === 'json';

router.post('/files/vorschlag', auth.requireLogin, auth.rateLimit('linkreq', 30, 600), async (req, res) => {
  try {
    const ids = await lr.suggest(req.user, req.body || {});
    if (wantsJson(req)) return res.json({ ok: true, ids });
    res.redirect('/files/vorschlaege?neu=' + ids.length);
  } catch (e) {
    if (wantsJson(req)) return res.status(400).json({ error: e.message });
    res.redirect('/files/upload?tab=link&err=' + encodeURIComponent(e.message) + '&url=' + encodeURIComponent(String(req.body.urls || '').slice(0, 2000)));
  }
});

router.get('/files/vorschlaege', auth.requireLogin, (req, res) => {
  const list = lr.mine(req.user.id), r = lr.rules();
  const open = list.filter(x => x.open).length;
  res.render('linkreq-mine', {
    title: 'Meine Vorschläge', list, open, left: req.user.isAdmin ? null : Math.max(0, r.maxOpen - open),
    canSuggest: lr.canSuggest(req.user), neu: Number(req.query.neu) || 0, err: String(req.query.err || ''),
  });
});
// Fortschritt für die Liste (public/linkreq.js fragt alle paar Sekunden, solange etwas läuft)
router.get('/files/vorschlaege.json', auth.requireLogin, (req, res) => {
  res.json({ items: lr.mine(req.user.id).map(x => ({ id: x.id, status: x.status, statusLabel: x.statusLabel, pct: x.pct, bytes_done: x.bytes_done,
    bytes_total: x.bytes_total, eta: x.eta, active: x.active, open: x.open })) });
});
router.post('/files/vorschlaege/:id/zurueckziehen', auth.requireLogin, async (req, res) => {
  try { await lr.withdraw(Number(req.params.id), req.user); } catch (e) { return res.redirect('/files/vorschlaege?err=' + encodeURIComponent(e.message)); }
  res.redirect('/files/vorschlaege');
});

// Teilen vom Handy (YouTube-App → Teilen → diese Seite): Link landet im Formular, vorgeschlagen wird erst nach Klick
router.get('/files/teilen', (req, res) => {
  const text = [req.query.url, req.query.text, req.query.title].map(v => String(v || '')).join(' ');
  const m = text.match(/https?:\/\/\S+/);
  const target = '/files/upload?tab=link' + (m ? '&url=' + encodeURIComponent(m[0].slice(0, 2000)) : '');
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(target));
  res.redirect(target);
});

module.exports = router;
