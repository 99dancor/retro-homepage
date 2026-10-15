'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, getSetting } = require('./db');
const auth = require('./auth');
const analytics = require('./analytics');
const util = require('./util');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Hinter Nginx Proxy Manager: echte Client-IP aus X-Forwarded-For übernehmen.
// Standard: private Netze (RFC1918) gelten als vertrauenswürdige Proxys.
const tp = process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal';
app.set('trust proxy', tp === 'true' ? true : tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : tp);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'self'; form-action 'self'",
  });
  next();
});
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(auth.loadUser);
app.use((req, res, next) => {
  Object.assign(res.locals, util, {
    site: { title: getSetting('site_title'), tagline: getSetting('site_tagline') },
    path: req.path,
    guestbookEnabled: getSetting('guestbook_enabled') === '1',
    registrationOpen: getSetting('registration_open') === '1',
    contactEnabled: getSetting('contact_enabled') === '1',
    boardEnabled: getSetting('board_enabled') === '1',
    navHidden: (getSetting('nav_hidden') || '').split(','),
    marquee: getSetting('theme_marquee'),
    showCounter: getSetting('theme_show_counter') === '1',
    hitCounter: Number(getSetting('hit_counter', '0')),
  });
  const v = auth.visibilitySql(req.user, 'page', 'p');
  res.locals.navPages = db.prepare(`SELECT slug, title FROM pages p WHERE in_nav = 1 AND ${v.sql} ORDER BY position, title`).all(...v.params);
  next();
});
// Desktop: Seiten laufen als Fenster (iframes) auf einem Win98-Desktop. Direkt aufgerufen
// liefert jede öffentliche Seite den Desktop mit ihr als Fenster, im Fenster selbst den
// schlanken Inhalt ohne Rahmen. Der Browser verrät per Sec-Fetch-Dest, ob er ein iframe lädt.
app.use((req, res, next) => {
  res.vary('Sec-Fetch-Dest');
  const embed = req.get('sec-fetch-dest') === 'iframe' || 'embed' in req.query;
  res.locals.embed = embed;
  if (embed || req.method !== 'GET') return next();
  const render = res.render.bind(res);
  res.render = (view, opts, cb) => {
    if (view.startsWith('admin/')) return render(view, opts, cb);
    req.shell = true;
    return render('desktop', { title: (opts && opts.title) || '', src: req.originalUrl }, cb);
  };
  next();
});
app.use((req, res, next) => (req.is('multipart/form-data') ? next() : auth.csrfCheck(req, res, next)));
app.use(analytics.middleware);

app.use('/api/saves', require('./routes/saves'));
app.use('/admin', require('./routes/admin'));
app.use('/forum', require('./routes/board'));
app.use('/', require('./routes/public'));

app.use((req, res) => res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht (oder du hast keinen Zugriff).' }));
app.use((err, req, res, next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Die Datei ist zu groß.' : 'Da ist etwas schiefgelaufen.';
  res.status(err.status || 500).render('error', { title: 'Fehler', message: msg });
});

// Erster Start: Admin-Konto anlegen
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const name = process.env.ADMIN_USER || 'admin';
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) pw = crypto.randomBytes(9).toString('base64url');
  auth.createUser(name, pw, 'admin');
  console.log('='.repeat(60));
  console.log(`Admin-Konto angelegt: ${name}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Passwort: ${pw}  (bitte nach dem Login ändern)`);
  console.log('='.repeat(60));
}

app.listen(PORT, () => console.log(`Website läuft auf Port ${PORT}`));
