'use strict';
// Benachrichtigungen: Liste (🔔 neben der Uhr und /benachrichtigungen), Einstellungen unter Konto und Passwort,
// Push-Geräte und der Service Worker, der Push-Nachrichten anzeigt.
const path = require('node:path');
const express = require('express');
const { getSetting } = require('../db');
const auth = require('../auth');
const notify = require('../notify');
const webpush = require('../webpush');

const router = express.Router();
const local = u => (typeof u === 'string' && /^\/(?![/\\])/.test(u) ? u : '/');
const item = n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: local(n.url), count: n.count, at: n.created_at, read: !!n.read_at });
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'login' }));

// ---------- Liste ----------
router.get('/api/benachrichtigungen', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.json({ unread: 0, items: [] });
  res.json({ unread: notify.unread(req.user.id), items: notify.list(req.user.id, Math.min(50, Number(req.query.n) || 12)).map(item) });
});
router.post('/api/benachrichtigungen/gelesen', needUser, express.json({ limit: '1kb' }), (req, res) => {
  notify.markRead(req.user.id, Number((req.body && req.body.id) || 0) || null);
  res.json({ unread: notify.unread(req.user.id) });
});

router.get('/benachrichtigungen', auth.requireLogin, (req, res) => {
  res.render('notifications', { title: 'Benachrichtigungen', items: notify.list(req.user.id, 100).map(item) });
});
// Klick auf eine Benachrichtigung: als gelesen markieren und zur Sache springen
router.get('/benachrichtigungen/:id', auth.requireLogin, (req, res) => {
  const n = notify.list(req.user.id, 100).find(x => x.id === Number(req.params.id));
  if (n) notify.markRead(req.user.id, n.id);
  res.redirect(n ? local(n.url) : '/benachrichtigungen');
});
router.post('/benachrichtigungen/alle-gelesen', auth.requireLogin, (req, res) => { notify.markRead(req.user.id); res.redirect('/benachrichtigungen'); });
router.post('/benachrichtigungen/loeschen', auth.requireLogin, (req, res) => {
  notify.remove(req.user.id, Number(req.body.id) || null);
  res.redirect('/benachrichtigungen');
});

// ---------- Einstellungen ----------
router.post('/account/benachrichtigungen', auth.requireLogin, (req, res) => {
  notify.savePrefs(req.user.id, req.body);
  if (req.accepts(['html', 'json']) === 'json') return res.json({ ok: true });
  res.redirect('/konto?reiter=benachrichtigungen&ok=notify#benachrichtigungen');
});
router.post('/account/geraete/:id/loeschen', auth.requireLogin, (req, res) => {
  notify.removeDevice(req.user.id, Number(req.params.id));
  res.redirect('/konto?reiter=benachrichtigungen&ok=geraet#benachrichtigungen');
});

// ---------- Push ----------
router.get('/api/push/key', (req, res) => res.json({ key: webpush.publicKey() }));
router.post('/api/push/abo', needUser, auth.rateLimit('push', 20, 3600), express.json({ limit: '4kb' }), (req, res) => {
  const b = req.body || {};
  if (!notify.addDevice(req.user.id, b.subscription, b.label)) return res.status(400).json({ error: 'Dieses Gerät lässt sich nicht anmelden.' });
  res.json({ ok: true });
});
router.post('/api/push/abmelden', needUser, express.json({ limit: '4kb' }), (req, res) => {
  notify.removeEndpoint(req.user.id, req.body && req.body.endpoint);
  res.json({ ok: true });
});
router.post('/api/push/test', needUser, auth.rateLimit('pushtest', 10, 600), async (req, res) => {
  const n = await notify.pushTo(req.user.id, { title: '🔔 Test', body: 'So sehen Benachrichtigungen von ' + getSetting('site_title') + ' aus.', url: '/benachrichtigungen', tag: 'test' });
  res.json({ sent: n });
});

// Der Service Worker muss unter / liegen, damit er für die ganze Seite gilt
router.get('/sw.js', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'sw.js'));
});
// Damit sich die Seite auf dem Handy zum Startbildschirm hinzufügen lässt (auf dem iPhone Voraussetzung für Push)
router.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').json({
    name: getSetting('site_title'), short_name: getSetting('site_title'), start_url: '/', scope: '/', display: 'standalone',
    background_color: '#008080', theme_color: '#000080',
    icons: [{ src: '/static/icon.png', sizes: '256x256', type: 'image/png' }, { src: '/static/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  });
});

module.exports = router;
