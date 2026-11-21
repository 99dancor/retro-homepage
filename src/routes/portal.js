'use strict';
// Version 3.0: Startseite mit Kacheln (/) und die Suche über alle Bereiche (/finden). Der Desktop liegt unter /desktop
// (src/routes/public.js). Im Desktop-Fenster bleibt „/“ das Willkommensfenster, damit alte Verknüpfungen weiter gehen.
const express = require('express');
const v3 = require('../v3');
const portal = require('../portal');

const router = express.Router();

router.get('/', (req, res, next) => {
  if (res.locals.embed) return next();
  const admin = !!(req.user && req.user.isAdmin);
  let services = [];
  try { services = require('../services').forViewer(req.user, 'home').slice(0, 4); } catch { services = []; }
  const fromDesk = [];
  const u = require('../changelog').latest();
  if (u) fromDesk.push({ kind: 'desk', label: 'Update ' + u.no, title: u.title, url: '/changelog#update-' + u.no });
  try {
    for (const it of require('./public').feed(req.user, res.locals).filter(i => i.kind === 'board' || i.kind === 'guestbook').slice(0, 3)) {
      fromDesk.push({ kind: it.kind === 'board' ? 'blog' : 'x', label: it.kind === 'board' ? 'Forum' : 'Besucherbuch', title: it.title, url: it.url, when: it.when });
    }
  } catch { /* nur Beiwerk */ }
  res.render('v3/portal', {
    ...v3.locals(req, res), title: '', hero: portal.hero(), tiles: portal.forViewer(req.user, res.locals, { edit: admin }), admin,
    ok: req.query.ok === 'gespeichert' ? 'Gespeichert.' : null,
    services, recent: portal.recent(req.user, 5).map(r => ({ ...r, when: v3.ago(r.at) })), fromDesk: fromDesk.slice(0, 4),
    description: 'Downloads, Guides, Rezepte, der Retro-Desktop und der FS25 Hub von Dancor.',
  });
});

// Bearbeiten-Modus der Startseite (nur Admin): Begrüßung und Kacheln
router.post('/startseite', express.json({ limit: '256kb' }), (req, res) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Nur der Admin bearbeitet die Startseite.' });
  portal.saveEdit(req.body);
  res.json({ ok: true });
});

router.get('/finden', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const hits = portal.search(req.user, q, res.locals);
  res.render('v3/finden', { ...v3.locals(req, res), title: q ? `Suche: ${q}` : 'Suchen', q, hits });
});

module.exports = router;
