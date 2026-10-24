'use strict';
// Systemsteuerung für alle (Startmenü → Systemsteuerung): Anzeige, Desktop, Speicherplatz und
// Verweise auf Konto und Passwort, Sounds und Datenschutz. Die Verwaltung der Seite heißt „Seitenverwaltung“ (/admin).
const express = require('express');
const { getSetting } = require('../db');
const auth = require('../auth');
const us = require('../usersettings');
const desk = require('../desk');
const quota = require('../quota');
const programs = require('../programs');
const profiles = require('../profiles');
const { asArray } = require('../util');

const router = express.Router();
const api = express.Router();
api.use(express.json({ limit: '100kb' }));

router.get('/', (req, res) => res.render('settings', { title: 'Systemsteuerung', page: 'start' }));

// ---------- Desktop ----------
// Standardsymbole, die es geben kann (Seitenverwaltung → Desktop legt fest, welche alle haben)
function defaultIcons(locals) {
  const progs = new Map(programs.list(locals).map(p => [p.key, p]));
  return (getSetting('desk_defaults') || '').split(',').map(k => k.trim()).filter(Boolean).map(k => {
    if (k === 'eigene-dateien') return { key: k, icon: '🗂️', name: 'Eigene Dateien' };
    if (k === 'papierkorb') return { key: k, icon: '🗑️', name: 'Papierkorb' };
    if (k === 'readme') return { key: k, icon: '📄', name: 'readme.txt' };
    const p = progs.get(k);
    return p ? { key: k, icon: p.icon, name: p.name } : null;
  }).filter(Boolean);
}
router.get('/desktop', auth.requireLogin, (req, res) => {
  const counts = { folders: 0, texts: 0, links: 0 };
  for (const r of require('../db').db.prepare('SELECT kind, COUNT(*) AS n FROM desk_items WHERE user_id = ? GROUP BY kind').all(req.user.id)) {
    if (r.kind === 'folder') counts.folders = r.n; else if (r.kind === 'text') counts.texts = r.n; else counts.links += r.n;
  }
  res.render('settings', {
    title: 'Desktop', page: 'desktop', d: us.get(req.user.id, 'desk'), icons: defaultIcons(res.locals), limits: desk.limits(), counts,
    lobbyOn: getSetting('lobby_widget', '1') === '1', searchOn: getSetting('search_enabled', '1') === '1', saved: 'ok' in req.query,
  });
});
router.post('/desktop', auth.requireLogin, (req, res) => {
  const b = req.body, d = us.get(req.user.id, 'desk'), shown = asArray(b.icon);
  const hidden = defaultIcons(res.locals).map(i => i.key).filter(k => !shown.includes(k));
  us.set(req.user.id, 'desk', {
    ...d, lobbies: b.lobbies === '1', search: b.search === '1', arrange: b.arrange, hidden,
    pos: b.arrange && b.arrange !== 'frei' ? {} : d.pos,
  });
  res.redirect('/einstellungen/desktop?ok');
});

// ---------- Statistik (Konto und Passwort → Statistik) ----------
// Die Einstellungen stehen seit dem Messenger unter Konto und Passwort → Statistik; gespeichert wird weiter hier
router.get('/statistik', (req, res) => res.redirect(301, '/konto?reiter=statistik#statistik'));
router.post('/statistik', auth.requireLogin, (req, res) => {
  const b = req.body, all = profiles.gameStats(req.user.id, req.user);
  const slugs = new Set([...all.map(g => g.slug), ...Object.keys(us.BOARD_GAMES)]);
  const games = {};
  let i = 0;
  for (const slug of asArray(b.order)) {
    if (!slugs.has(slug)) continue;
    const g = all.find(x => x.slug === slug), shown = asArray(b['show_' + slug]);
    games[slug] = {
      see: b['see_' + slug], board: b['board_' + slug], order: i++,
      hide: g ? g.stats.map(st => st.key).filter(k => !shown.includes(k)) : [],
    };
  }
  const showcase = asArray(b.pin).map(v => { const [app, ...key] = String(v).split('|'); return { app, key: key.join('|') }; }).filter(p => slugs.has(p.app)).slice(0, 4);
  const site = {};
  for (const k of Object.keys(us.SITE)) site[k] = asArray(b.site).includes(k);
  us.set(req.user.id, 'stats', { games, showcase, auto: b.auto === '1', site });
  if (req.accepts(['html', 'json']) === 'json') return res.json({ ok: true });
  res.redirect('/konto?reiter=statistik&ok=stats#statistik');
});

// ---------- Speicherplatz ----------
router.get('/speicher', auth.requireLogin, (req, res) => {
  res.render('settings', { title: 'Speicherplatz', page: 'speicher', space: quota.view(req.user), trashN: desk.trashList(req.user.id).length, limits: desk.limits() });
});

// ---------- Darstellung am Konto ----------
// Nur wenn „Auf allen meinen Geräten“ gewählt ist. Größe der Oberfläche und eigenes Bild bleiben immer im Browser.
api.post('/darstellung', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.' });
  const v = req.body && req.body.display;
  res.json({ display: us.set(req.user.id, 'display', v && typeof v === 'object' ? v : null) });
});

module.exports = { router, api };
