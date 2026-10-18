'use strict';
// Fest eingebaute Spiele, z. B. „Pixelpfoten“ unter /haustier/.
// Direkt aufgerufen kommt wie bei jeder Seite der Desktop mit dem Spiel als Fenster, im Fenster das Spiel selbst.
// index.html bekommt Anmeldung und Adressen der Homepage als data-Attribute mit, denn Skripte im HTML
// verbietet die Sicherheitsrichtlinie.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const GAMES = require('../games');
const profiles = require('../profiles');

const router = express.Router();
const attr = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Nach Updates sollen Spieler sofort die neuen Dateien bekommen: Browser fragen jedes Mal kurz nach
const noCache = res => res.set('Cache-Control', 'no-cache');

for (const [slug, game] of Object.entries(GAMES)) {
  if (game.url) continue;   // läuft als normale Seite, z. B. Blackjack
  const dir = path.join(__dirname, '..', '..', 'games', slug, 'src');
  const base = `/${slug}/`;

  // Ohne Schrägstrich am Ende fänden die relativen Pfade im Spiel (css/, js/) ihre Dateien nicht
  router.get(`/${slug}`, (req, res, next) => {
    const q = req.originalUrl.indexOf('?');
    const query = q < 0 ? '' : req.originalUrl.slice(q);
    if (!req.originalUrl.slice(0, q < 0 ? undefined : q).endsWith('/')) return res.redirect(301, base + query);
    if (!res.locals.embed) return res.render('desktop', { title: game.title, src: req.originalUrl });
    fs.readFile(path.join(dir, 'index.html'), 'utf8', (err, html) => {
      if (err) return next(err);
      profiles.countStart(req.user, slug);   // für die Spielstatistik im Profil
      const l = res.locals;
      const data = {
        class: 'embed',
        'data-user': req.user ? req.user.id : '',
        'data-login': '/login?next=' + base,
        'data-register': l.registrationOpen ? '/register?next=' + base : '',
        'data-forum': l.boardEnabled ? '/forum/new' : '',
        'data-csrf': req.csrfToken || '',
      };
      const tag = '<body ' + Object.entries(data).map(([k, v]) => `${k}="${attr(v)}"`).join(' ') + '>';
      noCache(res).type('html').send(html.replace('<body>', tag));
    });
  });
  router.use(base, express.static(dir, { index: false, setHeaders: noCache }));
}

module.exports = router;
