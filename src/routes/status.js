'use strict';
// Für Besucher: Dienste (Fenster /dienste, Widget, 🗄️ neben der Uhr), Laufband, Popup-Bilder und „Info über …“.
// Alles hier zeigt nur, was die Seitenverwaltung für den Besucher freigegeben hat; Adressen und Schlüssel der Dienste
// bleiben auf dem Server (src/services.js).
const express = require('express');
const { db, getSetting } = require('../db');
const auth = require('../auth');
const services = require('../services');
const ticker = require('../ticker');
const popups = require('../popups');
const changelog = require('../changelog');

const router = express.Router();
const STARTED = Date.now();
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

// ---------- Dienste ----------
// Alles für Widget und Infobereich in einer Abfrage: Dienste (wo sie erscheinen sollen), Speicher, Einstellungen
function deskServices(user) {
  const list = services.forViewer(user);
  return {
    widget: getSetting('svc_widget', '1') === '1',
    services: list,
    storage: services.storage(user),
    down: list.filter(s => s.state === 'down').length,
  };
}
router.get('/api/dienste', noStore, (req, res) => res.json(deskServices(req.user)));
// „Sag Bescheid, wenn er wieder da ist“
router.post('/api/dienste/:id/bescheid', noStore, express.json({ limit: '2kb' }), (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.' });
  const on = !(req.body && req.body.on === false);
  if (!services.watch(req.user, req.params.id, on)) return res.status(404).json({ error: 'Diesen Dienst gibt es nicht.' });
  res.json({ ok: true, watching: on });
});
// Fenster mit allen Diensten, die man sehen darf, und dem Verlauf der letzten 24 Stunden
router.get('/dienste', (req, res) => {
  const list = services.forViewer(req.user).map(s => ({ ...s, bars: services.bars(s.id, 24), uptime: services.uptime(s.id) }));
  res.render('dienste', { title: 'Dienste', list, storage: services.storage(req.user), STATES: services.STATES });
});

// ---------- Laufband ----------
router.get('/api/laufband', noStore, (req, res) => res.json(ticker.forDesk(req.user, res.locals) || { items: [] }));

// ---------- Popup-Bilder ----------
router.get('/api/popups', noStore, (req, res) => res.json(popups.eligible(req.user) || { items: [] }));
// Zähler ohne Personenbezug; die Grenze verhindert nur, dass jemand die Zahlen hochtreibt
router.post('/api/popups/:id/:what', noStore, auth.rateLimit('popup', 60, 600), (req, res) => {
  if (!popups.count(req.params.id, req.params.what)) return res.status(404).json({ error: 'Unbekannt' });
  res.json({ ok: true });
});

// ---------- Info über … (Start → Info) ----------
router.get('/info', (req, res) => {
  const u = changelog.latest();
  const all = changelog.all();
  res.render('info', {
    title: 'Info über ' + (res.locals.site.title || 'diese Seite'), update: u, updates: all.length,
    since: all.length ? all[all.length - 1].date : null, started: STARTED,
    members: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get().n,
    disk: req.user && req.user.isAdmin ? require('../uploads').diskSpace() : null,
  });
});

module.exports = router;
