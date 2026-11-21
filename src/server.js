'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, getSetting } = require('./db');
const auth = require('./auth');
const analytics = require('./analytics');
const util = require('./util');
const themes = require('./themes');
const profiles = require('./profiles');
const notify = require('./notify');
const us = require('./usersettings');
const desk = require('./desk');
const deskRoutes = require('./routes/desk');
const settingsRoutes = require('./routes/settings');

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
// Statische Dateien tragen eine Versionsnummer aus ihrem Inhalt (?v=…). Nach einem Update
// laden Browser so sofort die neue Fassung statt einer alten aus dem Zwischenspeicher.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const assetVersions = {};
function asset(name) {
  if (!(name in assetVersions)) {
    try { assetVersions[name] = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, name))).digest('hex').slice(0, 10); }
    catch { assetVersions[name] = ''; }
  }
  return '/static/' + name + (assetVersions[name] ? '?v=' + assetVersions[name] : '');
}
app.use('/static', express.static(PUBLIC_DIR, {
  maxAge: '7d',
  setHeaders: (res, file) => { if ('v' in res.req.query) res.set('Cache-Control', 'public, max-age=31536000, immutable'); },
}));
// Spieler für mitgebrachte Spiele der Daddelecke: js-dos (DOS) und Ruffle (Flash) aus node_modules, nichts aus dem Netz.
// Die Spielerseiten laufen unter /apps/<slug>/play und holen sie von hier.
for (const [url, pkg, sub] of [['/vendor/js-dos', 'js-dos/package.json', 'dist'], ['/vendor/ruffle', '@ruffle-rs/ruffle/package.json', '']]) {
  let dir = null;
  try { dir = path.join(path.dirname(require.resolve(pkg)), sub); } catch { /* Paket fehlt: dann eben ohne */ }
  if (dir) app.use(url, express.static(dir, { maxAge: '7d', index: false }));
}
app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(auth.loadUser);
app.use((req, res, next) => {
  Object.assign(res.locals, util, {
    asset,
    themes,
    site: { title: getSetting('site_title'), tagline: getSetting('site_tagline') },
    path: req.path,
    guestbookEnabled: getSetting('guestbook_enabled') === '1',
    registrationOpen: getSetting('registration_open') === '1',
    contactEnabled: getSetting('contact_enabled') === '1',
    boardEnabled: getSetting('board_enabled') === '1',
    cardsEnabled: getSetting('ks_enabled', '1') === '1' && ['bj', 'pk', 'dk', 'uno', 'f7', 'pp'].some(p => getSetting(p + '_enabled', '1') === '1'),
    paintEnabled: getSetting('paint_enabled', '1') === '1',
    quizEnabled: getSetting('quiz_enabled', '1') === '1',
    werwolfEnabled: getSetting('ww_enabled', '1') === '1',
    galleryEnabled: getSetting('paint_gallery', '1') === '1',
    farmingVisible: require('./hub').canView(req.user),
    navHidden: (getSetting('nav_hidden') || '').split(','),
    // Wartungsmodus (System → Allgemein): Admins sehen die Seite weiter, mit Hinweis
    maintOn: getSetting('maint_on', '0') === '1',
    // Design ohne eigene Wahl (Seitenverwaltung → Design): 98, xp, xp-oliv oder xp-silber; display.js liest es aus <html data-design>
    siteDesign: getSetting('theme_design', '98'),
    // Skin des Mediaplayers für sein Symbol (<html data-mp-skin>, retro.css .sym-player): eigene Wahl am Konto, sonst die
    // Vorgabe der Seite. Gäste haben ihre Wahl im Browser, display.js übernimmt sie dann.
    playerSkin: (req.user && require('./usersettings').get(req.user.id, 'player').skin) || getSetting('music_skin', 'klassisch'),
    // Anmeldebildschirm bei jedem Laden des Desktops (views/partials/logon.ejs, public/logon.js), abschaltbar in der Seitenverwaltung
    logonScreen: getSetting('logon_screen', '1') === '1',
    programs: require('./programs'),
    ico: require('./programs').ico,
    showCounter: getSetting('theme_show_counter') === '1',
    hitCounter: Number(getSetting('hit_counter', '0')),
    displayName: profiles.displayName,
    profileUrl: profiles.profileUrl,
    fmtNumber: profiles.fmtNumber,
    unreadPm: req.user ? profiles.unreadCount(req.user.id) : 0,
    unreadNotify: req.user ? notify.unread(req.user.id) : 0,
  });
  const v = auth.visibilitySql(req.user, 'page', 'p');
  res.locals.navPages = db.prepare(`SELECT slug, title FROM pages p WHERE in_nav = 1 AND ${v.sql} ORDER BY position, title`).all(...v.params);
  // Regelkodex (eigene Seite mit der Adresse „regeln“) steht im Startmenü unter Info
  res.locals.rulesPage = !!db.prepare(`SELECT 1 FROM pages p WHERE slug = 'regeln' AND ${v.sql}`).get(...v.params);
  next();
});
// Wartungsmodus: Wer kein Admin ist, sieht nur die Wartungsseite (mit Anmeldung für Admins). Kommt vor dem Desktop,
// damit die Seite ohne Fenster und ohne die Abfragen des Desktops auskommt.
const MAINT_OPEN = /^\/(login|logout|theme\.css|favicon\.ico|manifest\.webmanifest|sw\.js|static\/.*|vendor\/.*|media\/.*|api\/kennworthinweis)$/;
app.use((req, res, next) => {
  if (!res.locals.maintOn || (req.user && req.user.isAdmin) || MAINT_OPEN.test(req.path)) return next();
  res.status(503).set('Retry-After', '600');
  if (req.path.startsWith('/api/') || req.method !== 'GET') return res.json({ error: 'Die Seite wird gerade gewartet.' });
  res.render('wartung', { title: 'Wartungsarbeiten', text: getSetting('maint_text', '') });
});
// Eigene Seiten ohne Desktop drumherum (Version 3.0, src/v3.js): Startseite, Downloads, Duden, Deliziösitäten, Suche,
// die Anmeldung von dort und der Hub, der sein eigenes Aussehen mitbringt
const v3 = require('./v3');
// Desktop: Seiten laufen als Fenster (iframes) auf einem Win98-Desktop. Direkt aufgerufen
// liefert jede öffentliche Seite den Desktop mit ihr als Fenster, im Fenster selbst den
// schlanken Inhalt ohne Rahmen. Der Browser verrät per Sec-Fetch-Dest, ob er ein iframe lädt.
app.use((req, res, next) => {
  res.vary('Sec-Fetch-Dest');
  const embed = req.get('sec-fetch-dest') === 'iframe' || 'embed' in req.query;
  res.locals.embed = embed;
  // Spiele in der Daddelecke: moderner Look statt 98/XP (public/play-modern.css)
  res.locals.lookModern = embed && req.query.look === 'modern';
  if (embed || req.method !== 'GET' || v3.isModern(req)) return next();
  const render = res.render.bind(res);
  res.render = (view, opts, cb) => {
    req.shell = true;
    // Die Seitenverwaltung ist ein Fenster wie alle anderen, nur mit eigenem Titel
    const title = (opts && opts.title) || '';
    return render('desktop', {
      title: view.startsWith('admin/') ? 'Seitenverwaltung' + (title ? ' – ' + title : '') : title, src: req.originalUrl,
      // Symbole, Widget und Suche (public/desk.js), dazu die Darstellung am Konto, falls „auf allen Geräten“ gewählt ist
      desk: deskRoutes.deskData(req, res.locals), deskDisplay: req.user ? us.get(req.user.id, 'display') : null,
      // Laufband oben (src/ticker.js) und Popup-Bilder (src/popups.js, nur ob es welche gibt; die Liste holt public/popups.js)
      ticker: require('./ticker').forDesk(req.user, res.locals), popupsOn: !!require('./popups').eligible(req.user),
    }, cb);
  };
  next();
});
app.use((req, res, next) => (req.is('multipart/form-data') ? next() : auth.csrfCheck(req, res, next)));
app.use(analytics.middleware);
// Programme, die die Seitenverwaltung ausgeschaltet oder auf Mitglieder gestellt hat (src/programs.js)
app.use(require('./programs').gate);

app.use('/api/einstellungen', settingsRoutes.api);
app.use('/', require('./routes/status'));
app.use('/api', deskRoutes.api);
app.use('/api/saves', require('./routes/saves'));
app.use('/api/entwuerfe', require('./routes/drafts').router);
app.use('/api/pixelpfoten', require('./routes/pixelpfoten'));
const profileRoutes = require('./routes/profiles');
app.use('/api/stats', profileRoutes.stats);
app.use('/admin', require('./routes/admin'));
app.use('/forum', require('./routes/board'));
app.use('/musik', require('./routes/music').router);
app.use('/jellyfin', require('./routes/jellyfin'));
app.use('/eigene-dateien', require('./routes/ownfiles'));
app.use('/mods', require('./routes/mods'));
// Dancors Dreschplatz: der FS25 Hub als Paket (src/hub.js), mit eigenem Aussehen und eigener Verwaltung
app.use('/farming', require('./hub'));
app.use('/kartenspiele', require('./routes/kartenspiele'));
app.use('/blackjack', require('./routes/blackjack'));
app.use('/poker', require('./routes/poker'));
app.use('/durak', require('./routes/durak'));
app.use('/uno', require('./routes/cardgame')(require('./uno')));
app.use('/flip7', require('./routes/cardgame')(require('./flip7')));
app.use('/pilli', require('./routes/cardgame')(require('./pilli')));
app.use('/quiz', require('./routes/quiz'));
app.use('/werwolf', require('./routes/werwolf'));
app.use('/minesweeper', require('./routes/minesweeper'));
app.use('/ds', require('./routes/ds'));
app.use('/kreuzwortraetsel', require('./routes/crossword'));
app.use('/sudoku', require('./routes/sudoku'));
const paintRoutes = require('./routes/paint');
app.use('/paint', paintRoutes.router);
app.use('/galerie', require('./routes/gallery'));
app.use('/galerie', paintRoutes.gallery);
app.use('/einstellungen', settingsRoutes.router);
// Version 3.0: Startseite mit Kacheln und die neuen Bereiche
app.use('/', require('./routes/portal'));
app.use('/downloads', require('./routes/downloads'));
app.use('/duden', require('./routes/duden'));
app.use('/rezepte', require('./routes/rezepte'));
// Dancors Daddelecke: alle Spiele ohne Desktop, dazu mitgebrachte Spiele (src/daddelecke.js)
app.use('/spiele', require('./routes/daddelecke'));
// Dancors Dioramen: Spielstände und Bauwerke mit Bildern und Download (src/dioramen.js)
app.use('/dioramen', require('./routes/dioramen'));
app.use('/api/schreiben', require('./routes/schreiben'));
app.use('/', deskRoutes.router);
app.use('/', require('./routes/notify'));
app.use('/', require('./routes/games'));
app.use('/', require('./routes/messenger'));
app.use('/', require('./routes/konto').router);
app.use('/', profileRoutes.router);
app.use('/', require('./routes/linkreq'));
app.use('/', require('./routes/public'));

app.use((req, res) => (v3.isModern(req) ? v3.error(req, res, 404, 'Nicht gefunden', 'Diese Seite gibt es nicht (oder du hast keinen Zugriff).')
  : res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht (oder du hast keinen Zugriff).' })));
app.use((err, req, res, next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Die Datei ist zu groß.' : 'Da ist etwas schiefgelaufen.';
  if (res.headersSent) return;
  if (v3.isModern(req)) return v3.error(req, res, err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500), 'Fehler', msg);
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

// Dienste abfragen (src/services.js), alten Lauftext ins Laufband übernehmen, Ereignisanzeige aufräumen
require('./services').start();
require('./linkreq').start();
require('./ticker').migrate();
const events = require('./events');
events.cleanup();
setInterval(events.cleanup, 24 * 3600e3).unref();
{
  const u = require('./changelog').latest();
  events.info('System', `Seite gestartet${u && u.no != null ? ` (Update ${u.no})` : ''}`);
}
// Dancors Dreschplatz: Feeds des Spieleservers und Austausch mit der Mod im Hintergrund (Paket fs25hub)
require('./hub').start();
// Haustier-Erinnerungen und alte Benachrichtigungen aufräumen
require('./petwatch').start();
setInterval(notify.cleanup, 6 * 3600e3).unref();
// Papierkorb: Was länger als desk_trash_days drin liegt, wird endgültig gelöscht
setTimeout(desk.purgeOld, 60e3).unref();
setInterval(desk.purgeOld, 6 * 3600e3).unref();

app.listen(PORT, () => console.log(`Website läuft auf Port ${PORT}`));
