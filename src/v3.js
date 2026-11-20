'use strict';
// Version 3.0: die modernen Bereiche (Startseite mit Kacheln, Downloads, Duden, Deliziösitäten) im Stil „Hybrid“:
// eigene Seiten mit Kopfleiste, ohne Desktop drumherum. Im Desktop öffnen sie als Fenster (iframe) und lassen dann Kopf und
// Fuß weg (framed). Layout: views/v3/_head.ejs, _foot.ejs; Aussehen: public/v3.css; Skript: public/v3.js.
const { db, getSetting } = require('./db');

// Bereiche mit eigener Seite. Die Anmeldung gehört dazu, wenn sie aus einem dieser Bereiche kommt (?next=…).
const AREAS = [
  { key: 'downloads', url: '/downloads', icon: '📦', name: 'Downloads' },
  { key: 'duden', url: '/duden', icon: '📚', name: 'Duden' },
  { key: 'rezepte', url: '/rezepte', icon: '🍝', name: 'Deliziösitäten' },
];
const MODERN = /^\/(downloads|duden|rezepte|finden)(\/|$)/;
const localPath = v => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : null);

// Gehört die Adresse zu einer eigenen Seite (ohne Desktop)? Der Hub (/farming) bringt sein Aussehen selbst mit.
function isModernPath(p) {
  return p === '/' || MODERN.test(p) || /^\/farming(\/|$)/.test(p);
}
// Anmelden und Registrieren: modern, außer man kommt aus dem Desktop (next zeigt auf eine Desktop-Seite)
function modernAuth(req) {
  if (req.path !== '/login' && req.path !== '/register') return false;
  const next = localPath(req.method === 'POST' ? req.body && req.body.next : req.query.next);
  return !next || isModernPath(next.split(/[?#]/)[0]);
}
function isModern(req) {
  return isModernPath(req.path) || modernAuth(req);
}

// Gemeinsame Werte für das Layout: aktueller Bereich, Rückweg nach der Anmeldung, Fensterbetrieb
function locals(req, res, area) {
  const framed = !!res.locals.embed;
  const u = new URL(req.originalUrl, 'http://x');
  u.searchParams.delete('embed');
  return {
    v3: true, framed, area: area || '', areas: AREAS, here: u.pathname + u.search,
    siteName: getSetting('portal_name', 'dancor.org'),
    version: '3.0',
  };
}

// Wann etwas war, kurz: „vor 5 Min.“, „heute“, „gestern“, „vor 3 Tagen“, „12.10.2026“
function ago(t) {
  const tz = process.env.TZ || 'Europe/Berlin', n = Math.floor(Date.now() / 1000);
  const day = x => new Date(x * 1000).toLocaleDateString('sv-SE', { timeZone: tz });
  if (n - t < 3600) return 'vor ' + Math.max(1, Math.round((n - t) / 60)) + ' Min.';
  if (day(t) === day(n)) return 'heute';
  if (day(t) === day(n - 86400)) return 'gestern';
  const days = Math.round((new Date(day(n)) - new Date(day(t))) / 86400e3);
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(t * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz });
}
const fmtDate = t => new Date(t * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: process.env.TZ || 'Europe/Berlin' });

// Fehlerseite im neuen Aussehen
function error(req, res, status, title, message) {
  return res.status(status).render('v3/error', { ...locals(req, res), title, message });
}

// Sichtbarkeit je Eintrag (Downloads-Projekte, Duden, Rezepte): wie überall auf der Seite. Gruppen wählt nur der Admin.
const VIS = { public: '🌐 Alle', members: '👥 Angemeldete Mitglieder', friends: '⭐ Nur meine Freunde', groups: '👪 Bestimmte Gruppen', private: '🔒 Nur ich (und der Admin)' };
function visibility(user, b) {
  const v = String((b && b.visibility) || '');
  if (v === 'groups' && !(user && user.isAdmin)) return 'members';
  return Object.hasOwn(VIS, v) ? v : 'public';
}
function saveAcl(user, type, id, b) {
  const list = b.groups === undefined ? [] : Array.isArray(b.groups) ? b.groups : [b.groups];
  require('./auth').setAcl(type, id, b.visibility === 'groups' && user && user.isAdmin ? list : []);
}
function visForm(user, type, item) {
  return {
    VIS, value: (item && item.visibility) || 'public',
    groups: user && user.isAdmin ? db.prepare('SELECT id, name FROM groups ORDER BY name').all() : [],
    acl: item && item.id ? require('./auth').getAcl(type, item.id) : [],
  };
}

module.exports = { AREAS, isModern, isModernPath, modernAuth, locals, ago, fmtDate, error, localPath, VIS, visibility, saveAcl, visForm };
