'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { db, now, getSetting, UPLOAD_DIR, MEDIA_DIR, APPS_DIR } = require('../db');
const auth = require('../auth');
const analytics = require('../analytics');
const mail = require('../mail');
const notify = require('../notify');
const up = require('../uploads');
const { md } = require('../util');
const privacy = require('../privacy');
const profiles = require('../profiles');
const { FONTS } = require('../themes');
const programs = require('../programs');
const changelog = require('../changelog');

const router = express.Router();

// ---------- Startseite ----------
// Schnellstart auf der Startseite: diese Programme in dieser Reihenfolge, sofern Startmenü und Seitenverwaltung sie zeigen.
// Der Text erscheint beim Drüberfahren.
const HOME_APPS = {
  kartenspiele: 'Blackjack, Poker, Durak, UNO, Flip 7 und Pilli Pilli am Spieltisch',
  haustier: 'Tiere pflegen, Gassi gehen und andere besuchen',
  paint: 'Malen wie früher, allein oder zusammen',
  musik: 'Musik, Videos und YouTube, auch gemeinsam in Lobbys',
  minesweeper: 'Der Klassiker aus Windows 98',
  kreuzwortraetsel: 'Jeden Tag ein neues Rätsel',
  sudoku: 'Jeden Tag drei neue Sudokus',
  quiz: 'Quiz erstellen oder einem Raum beitreten',
  werwolf: 'Die Seite ist der Erzähler, am Tisch oder online',
  board: 'Mitreden, fragen und verabreden',
};
const HOME_ORDER = Object.keys(HOME_APPS);

// Wann etwas war, kurz: „vor 5 Min.“, „heute 18:12“, „gestern“, „02.11.“
function ago(t) {
  const tz = process.env.TZ || 'Europe/Berlin', n = now();
  const day = x => new Date(x * 1000).toLocaleDateString('sv-SE', { timeZone: tz });
  if (n - t < 3600) return 'vor ' + Math.max(1, Math.round((n - t) / 60)) + ' Min.';
  if (day(t) === day(n)) return 'heute ' + new Date(t * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  if (day(t) === day(n - 86400)) return 'gestern';
  return new Date(t * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: tz });
}
// Neuigkeiten: Blog, Forum, Downloads und Besucherbuch in einer Liste, je Art die letzten sechs. „Alles“ zeigt die acht neuesten.
const FEED = { blog: '📝 Blog', board: '💬 Forum', files: '📁 Downloads', guestbook: '📖 Besucherbuch' };
function feed(user, locals) {
  const off = programs.off(locals), out = [];
  const shown = k => !off[k] && !(locals.navHidden || []).includes(k);
  if (shown('blog')) {
    const v = auth.visibilitySql(user, 'post', 'p');
    for (const p of db.prepare(`SELECT slug, title, summary, created_at FROM posts p WHERE published = 1 AND ${v.sql} ORDER BY created_at DESC LIMIT 6`).all(...v.params)) {
      out.push({ kind: 'blog', icon: '📝', title: p.title, url: '/blog/' + p.slug, meta: 'Blog' + (p.summary ? ' · ' + p.summary : ''), at: p.created_at });
    }
  }
  if (shown('board') && getSetting('board_enabled') === '1' && (getSetting('board_members_only') !== '1' || user)) {
    for (const t of db.prepare(`SELECT t.id, t.title, t.last_post_at, (SELECT COUNT(*) FROM board_posts p WHERE p.topic_id = t.id) - 1 AS replies
                                FROM board_topics t ORDER BY t.last_post_at DESC LIMIT 6`).all()) {
      out.push({ kind: 'board', icon: '💬', title: t.title, url: `/forum/t/${t.id}?page=last`, meta: 'Forum · ' + (t.replies === 1 ? '1 Antwort' : t.replies + ' Antworten'), at: t.last_post_at });
    }
  }
  if (shown('files')) {
    const v = auth.visibilitySql(user, 'file', 'f', { noPrivat: true });
    for (const f of db.prepare(`SELECT id, title, category, game, size, created_at FROM files f WHERE ${v.sql} ORDER BY created_at DESC LIMIT 6`).all(...v.params)) {
      out.push({ kind: 'files', icon: '📁', title: f.title, url: '/files', meta: ['Downloads', f.category, f.game, require('../util').fmtSize(f.size)].filter(Boolean).join(' · '), at: f.created_at });
    }
  }
  if (shown('guestbook') && getSetting('guestbook_enabled') === '1') {
    for (const g of db.prepare('SELECT name, message, created_at FROM guestbook WHERE approved = 1 ORDER BY created_at DESC, id DESC LIMIT 6').all()) {
      const m = g.message.replace(/\s+/g, ' ');
      out.push({ kind: 'guestbook', icon: '📖', title: '„' + (m.length > 90 ? m.slice(0, 90) + '…' : m) + '“', url: '/guestbook', meta: 'Besucherbuch · ' + (g.name || 'Anonym'), at: g.created_at, quote: true });
    }
  }
  out.sort((a, b) => b.at - a.at);
  out.forEach((it, i) => { it.top = i < 8; it.when = ago(it.at); });
  return out;
}

// Startseite aus Bausteinen (Aussehen → Startseite, src/homeblocks.js): links breit, rechts schmal, je nach Besucher
router.get('/', (req, res) => {
  const blocks = require('../homeblocks').forViewer(req.user), want = new Set([...blocks.main, ...blocks.side]);
  const services = require('../services');
  const rules = db.prepare("SELECT * FROM pages WHERE slug = 'regeln'").get();
  const items = want.has('neuigkeiten') ? feed(req.user, res.locals) : [];
  res.render('home', {
    title: 'Startseite', blocks,
    homeHtml: md(getSetting('home_md')),
    feed: items, feedKinds: Object.entries(FEED).filter(([k]) => items.some(i => i.kind === k)),
    services: want.has('dienste') ? services.forViewer(req.user, 'home') : [],
    storage: want.has('speicher') ? services.storage(req.user) : null,
    guestbook: want.has('besucherbuch') && res.locals.guestbookEnabled ? db.prepare('SELECT * FROM guestbook WHERE approved = 1 ORDER BY created_at DESC, id DESC LIMIT 3').all() : [],
    rulesUrl: rules && auth.canSee(req.user, 'page', rules) ? '/p/regeln' : null,
    apps: !want.has('schnellstart') ? [] : programs.list(res.locals).filter(p => HOME_APPS[p.key])
      .sort((a, b) => HOME_ORDER.indexOf(a.key) - HOME_ORDER.indexOf(b.key))
      // Weiches Trennzeichen, damit „Kreuzworträtsel“ unter dem Symbol sauber umbricht
      .map(p => ({ ...p, name: p.name.replace('Kreuzworträtsel', 'Kreuzwort\u00adrätsel'), hint: HOME_APPS[p.key] })),
    update: changelog.latest(),
  });
});

// ---------- Blog ----------
router.get('/blog', (req, res) => {
  const v = auth.visibilitySql(req.user, 'post', 'p');
  const tag = String(req.query.tag || '').trim();
  const params = [...v.params];
  let where = `published = 1 AND ${v.sql}`;
  if (tag) { where += ` AND (',' || tags || ',') LIKE ?`; params.push('%,' + tag + ',%'); }
  res.render('blog-list', {
    title: 'Blog', tag,
    posts: db.prepare(`SELECT * FROM posts p WHERE ${where} ORDER BY created_at DESC`).all(...params),
  });
});

router.get('/blog/:slug', (req, res, next) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
  if (!post || (!post.published && !(req.user && req.user.isAdmin)) || !auth.canSee(req.user, 'post', post)) return next();
  res.render('blog-post', { title: post.title, post, bodyHtml: md(post.body_md) });
});

// ---------- Dateien ----------
router.get('/files', (req, res) => {
  const view = require('../filesview').build(req.user, String(req.query.ort || req.query.cat && 'k:' + req.query.cat || ''), req.query.q);
  const lr = require('../linkreq'), canSuggest = lr.canSuggest(req.user);
  const mySuggestions = canSuggest ? db.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE user_id = ? AND status NOT IN ('done','rejected','withdrawn','failed')").get(req.user.id).n : 0;
  res.render('files', { ...view, title: view.node === 'alle' ? 'Downloads' : 'Downloads – ' + view.title, nodeTitle: view.title, q: String(req.query.q || ''),
    disk: req.user && req.user.isAdmin ? up.diskSpace() : null, canSuggest, mySuggestions });
});

router.get('/files/dl/:id', (req, res, next) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!f || !auth.canSee(req.user, 'file', f)) return next();
  const p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) return next();
  // Fortsetzungen abgebrochener Downloads (Range ab > 0) zählen nicht als neuer Download
  if (analytics.trackDownload(req, res, f.id)) {
    db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(f.id);
    try { analytics.record(req, '/files/dl/' + f.id, true); } catch { /* egal */ }
  }
  res.download(p, f.original_name, err => {
    if (err && !res.headersSent) next(err);
  });
});

// Hinzufügen (Mitglieder mit Upload-Recht): Dateien hineinziehen, jede wird einzeln hochgeladen (public/upload.js),
// Musik und Videos auf Wunsch gleich in den Mediaplayer. Ohne JavaScript geht das Formular wie früher in einem Rutsch.
// Mit ?ordner=ID aus dem Explorer landen die Dateien gleich in einem eigenen Ordner.
function uploadView(req, extra) {
  const desk = require('../desk'), quota = require('../quota'), music = require('../music'), cats = require('../filecats');
  const raw = String((req.body && req.body.ordner) ?? req.query.ordner ?? ''), where = desk.own(req.user, raw);
  const folder = raw === '0' ? { id: 0, name: 'Desktop' } : where && where.kind === 'folder' && !desk.trashed(where) ? where : null;
  const list = cats.list();
  return {
    title: 'Hinzufügen', maxMb: up.MAX_MB, msg: null, err: null, folder, space: quota.view(req.user), cats: list,
    preset: cats.pick(req.query.kategorie, list), blocked: req.user.isAdmin ? [] : cats.blockedExt(),
    music: music.canUpload(req.user) ? { ext: [...new Set([...music.AUDIO_EXT, ...music.VIDEO_EXT])].map(e => e.slice(1)), video: music.VIDEO_EXT.map(e => e.slice(1)), mb: req.user.isAdmin ? 0 : music.MEMBER_FILE_MB } : null,
    games: db.prepare("SELECT DISTINCT game FROM files WHERE game IS NOT NULL AND game != '' ORDER BY game").all().map(r => r.game),
    imports: req.user.isAdmin ? up.listImports().length : 0,
    ...linkView(req),
    ...extra,
  };
}
// Reiter „Link vorschlagen“ (src/linkreq.js): auch für Mitglieder ohne Upload-Recht, wenn die Regeln es erlauben
function linkView(req) {
  const lr = require('../linkreq'), canSuggest = lr.canSuggest(req.user), r = lr.rules();
  const open = canSuggest ? db.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE user_id = ? AND status IN ('new','checking','checked')").get(req.user.id).n : 0;
  const tab = !req.user.canUpload || req.query.tab === 'link' ? 'link' : 'datei';
  return {
    tab, canSuggest, linkKinds: lr.allowedKinds(req.user).map(k => ({ key: k, ...lr.KINDS[k] })), linkOpen: open, linkMax: req.user.isAdmin ? null : r.maxOpen,
    linkUrl: String(req.query.url || '').slice(0, 2000), linkErr: String(req.query.err || '').slice(0, 300), jdReady: require('../jdownloader').configured(),
  };
}
router.get('/files/upload', auth.requireLogin, (req, res, next) => {
  const v = uploadView(req);
  if (!req.user.canUpload && !v.canSuggest) return next();
  res.render('upload', v);
});
function uploadFiles(req, res, next) {
  up.fileUpload.array('files')(req, res, err => {
    if (!err) return next();
    for (const f of req.files || []) up.removeQuietly(f.path);
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist zu groß (höchstens ${up.MAX_MB} MB).` : 'Hochladen fehlgeschlagen.';
    if (req.accepts(['html', 'json']) === 'json') return res.status(413).json({ error: msg });
    next(err);
  });
}
router.post('/files/upload', auth.requireLogin, (req, res, next) => (req.user.canUpload ? next() : res.status(403).end()),
  uploadFiles, auth.csrfCheck, (req, res) => {
    const quota = require('../quota'), cats = require('../filecats'), json = req.accepts(['html', 'json']) === 'json';
    const fail = (status, error) => {
      for (const f of req.files || []) up.removeQuietly(f.path);
      return json ? res.status(status).json({ error }) : res.status(status).render('upload', uploadView(req, { err: error }));
    };
    const files = req.files || [];
    const bad = files.find(f => cats.isBlocked(req.user, f.originalname));
    if (bad) return fail(415, `„${bad.originalname}“: Programme und Skripte (.${cats.extOf(bad.originalname)}) werden nicht angenommen.`);
    if (!quota.fits(req.user, files.reduce((n, f) => n + f.size, 0))) return fail(413, quota.fullMessage(req.user));
    const view = uploadView(req), b = req.body, list = cats.list();
    // In einen eigenen Ordner hochgeladen ist zuerst „Nur ich“, sonst wie bisher „Angemeldete“
    const vis = ['public', 'members', 'friends', 'private'].includes(b.visibility) ? b.visibility : view.folder ? 'private' : 'members';
    const category = cats.pick(b.category || cats.guess(files[0] && files[0].originalname, list), list);
    const withGame = (list.find(c => c.name === category) || {}).game;
    const ins = db.prepare(`INSERT INTO files(title, description, category, game, original_name, stored_name, size, mime, visibility, uploader_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const refs = [];
    for (const f of files) {
      const title = (files.length === 1 && String(b.title || '').trim().slice(0, 200)) || f.originalname;
      refs.push('datei:' + ins.run(title, String(b.description || '').slice(0, 2000), category, (withGame && String(b.game || '').trim().slice(0, 100)) || null,
        f.originalname, f.filename, f.size, f.mimetype, vis, req.user.id, now()).lastInsertRowid);
    }
    if (view.folder) require('../desk').move(req.user, refs, view.folder.id);
    if (json) return res.json({ ok: true, refs, category });
    res.render('upload', { ...view, space: quota.view(req.user), msg: `${refs.length} Datei(en) hochgeladen.` });
  });

// Modlisten: src/routes/mods.js

// ---------- Links ----------
router.get('/links', (req, res) => {
  const v = auth.visibilitySql(req.user, 'link', 'l');
  const links = db.prepare(`SELECT * FROM links l WHERE ${v.sql} ORDER BY category, position, title`).all(...v.params);
  const grouped = {};
  for (const l of links) (grouped[l.category] ||= []).push(l);
  res.render('links', { title: 'Links', grouped });
});

// ---------- Besucherbuch (früher Freundebuch; Adresse /guestbook) ----------
function guestbookOn(req, res, next) { return getSetting('guestbook_enabled') === '1' ? next() : res.status(404).render('error', { title: 'Besucherbuch', message: 'Das Besucherbuch ist gerade geschlossen.' }); }

router.get('/guestbook', guestbookOn, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = 20;
  const total = db.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE approved = 1').get().n;
  const entries = db.prepare(`SELECT g.*, u.username, u.display_name, u.avatar FROM guestbook g LEFT JOIN users u ON u.id = g.user_id
                              WHERE approved = 1 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(per, (page - 1) * per);
  res.render('guestbook', { title: 'Besucherbuch', entries, page, pages: Math.max(1, Math.ceil(total / per)), total, msg: req.query.ok ? (req.query.ok === 'mod' ? 'Danke! Dein Eintrag erscheint, sobald er freigeschaltet wurde.' : 'Danke für deinen Eintrag!') : null, err: null });
});

router.post('/guestbook', guestbookOn, auth.rateLimit('gb', 5, 600), (req, res) => {
  if (req.body.website) return res.redirect('/guestbook?ok=1'); // Honeypot für Spam-Bots
  const message = String(req.body.message || '').trim().slice(0, 2000);
  const anonymous = req.body.anonymous === '1';
  let name = String(req.body.name || '').trim().slice(0, 50);
  if (!message) return res.redirect('/guestbook');
  const userId = req.user && !anonymous ? req.user.id : null;
  if (userId) name = req.user.username; else if (anonymous) name = null;
  const moderated = getSetting('guestbook_moderation') === '1' && !(req.user && req.user.isAdmin);
  db.prepare('INSERT INTO guestbook(name, user_id, message, approved, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name || null, userId, message, moderated ? 0 : 1, now());
  mail.notifyQuietly('Neuer Besucherbuch-Eintrag', `Von: ${name || 'Anonym'}\n\n${message}`);
  if (!(req.user && req.user.isAdmin)) notify.toAdmins(moderated ? '📖 Besucherbuch-Eintrag wartet auf Freigabe' : '📖 Neuer Eintrag im Besucherbuch', `${name || 'Anonym'}: ${message.slice(0, 120)}`, moderated ? '/admin/guestbook' : '/guestbook', 'admin:guestbook');
  res.redirect('/guestbook?ok=' + (moderated ? 'mod' : '1'));
});

// ---------- Kontakt ----------
router.get('/contact', (req, res, next) => {
  if (getSetting('contact_enabled') !== '1') return next();
  res.render('contact', { title: 'Kontakt', sent: !!req.query.sent });
});
router.post('/contact', auth.rateLimit('contact', 5, 600), (req, res, next) => {
  if (getSetting('contact_enabled') !== '1') return next();
  if (req.body.website) return res.redirect('/contact?sent=1');
  const body = String(req.body.body || '').trim().slice(0, 10000);
  if (!body) return res.redirect('/contact');
  const name = String(req.body.name || (req.user && req.user.username) || '').trim().slice(0, 100);
  const email = String(req.body.email || '').trim().slice(0, 200);
  const subject = String(req.body.subject || '').trim().slice(0, 200);
  db.prepare('INSERT INTO messages(name, email, subject, body, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, email, subject, body, req.user ? req.user.id : null, now());
  mail.notifyQuietly('Neue Nachricht: ' + (subject || '(ohne Betreff)'), `Von: ${name || 'Anonym'} <${email || '-'}>\n\n${body}`);
  notify.toAdmins('✉️ Neue Kontaktnachricht: ' + (subject || '(ohne Betreff)'), `Von ${name || 'Anonym'}`, '/admin/messages', 'admin:contact');
  res.redirect('/contact?sent=1');
});

// ---------- Apps & Spiele ----------
router.get('/apps', (req, res) => {
  const v = auth.visibilitySql(req.user, 'app', 'a');
  res.render('apps', { title: 'Andere Games', apps: db.prepare(`SELECT * FROM apps a WHERE ${v.sql} ORDER BY title`).all(...v.params) });
});

function loadApp(req, res, next) {
  const a = db.prepare('SELECT * FROM apps WHERE slug = ?').get(req.params.slug);
  if (!a || !auth.canSee(req.user, 'app', a)) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese App gibt es nicht.' });
  req.appItem = a;
  next();
}
router.get('/apps/:slug', loadApp, (req, res) => {
  const a = req.appItem;
  db.prepare('UPDATE apps SET plays = plays + 1 WHERE id = ?').run(a.id);
  profiles.countStart(req.user, a.slug);   // für die Spielstatistik im Profil
  res.render('app-play', { title: a.title, app: a, src: a.external_url || `/apps/${a.slug}/play/${a.entry}` });
});
// Liefert eine vorkomprimierte Fassung (.br/.gz neben der Datei), wenn der Browser sie annimmt.
// Fehlt sie noch (z. B. bei Apps von vor diesem Update), wird sie im Hintergrund angelegt.
function servePrecompressed(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let rel;
  try { rel = decodeURIComponent(req.path); } catch { return next(); }
  if (!up.COMPRESSIBLE.test(rel)) return next();
  const dir = path.join(APPS_DIR, req.appItem.slug);
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return next();
  res.vary('Accept-Encoding');
  const enc = req.acceptsEncodings('br', 'gzip');
  const suffix = enc === 'br' && fs.existsSync(file + '.br') ? '.br' : enc && fs.existsSync(file + '.gz') ? '.gz' : null;
  if (!suffix) { up.compressFile(file); return next(); }
  res.set('Content-Encoding', suffix === '.br' ? 'br' : 'gzip');
  res.type(rel.toLowerCase().endsWith('.wasm') ? 'application/wasm' : path.extname(rel));
  res.sendFile(file + suffix, err => err && !res.headersSent && next());
}

// Hochgeladene HTML5-Apps: lockerere Sicherheitsrichtlinie, damit Spiele-Engines laufen.
router.use('/apps/:slug/play', loadApp, (req, res, next) => {
  res.set('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; connect-src *; font-src * data:; worker-src 'self' blob:; frame-ancestors 'self'");
  next();
}, servePrecompressed, (req, res, next) => {
  express.static(path.join(APPS_DIR, req.appItem.slug), {
    index: ['index.html'],
    // Vorkomprimierte Builds (z. B. Unity WebGL: *.wasm.br, *.js.gz) korrekt ausliefern
    setHeaders: (r, file) => {
      const m = file.match(/\.(br|gz)$/);
      if (!m) return;
      r.set('Content-Encoding', m[1] === 'br' ? 'br' : 'gzip');
      const inner = file.slice(0, -m[0].length);
      r.type(inner.endsWith('.wasm') ? 'application/wasm' : inner.endsWith('.js') ? 'application/javascript' : inner.endsWith('.data') ? 'application/octet-stream' : path.extname(inner) || 'application/octet-stream');
    },
  })(req, res, next);
});

// ---------- Eigene Seiten ----------
router.get('/p/:slug', (req, res, next) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!page || !auth.canSee(req.user, 'page', page)) return next();
  res.render('page', { title: page.title, page, bodyHtml: md(page.body_md) });
});

// ---------- Zufallsgenerator (Startmenü) ----------
// Alles läuft im Browser (public/zufall.js), der Server liefert nur die Seite aus.
router.get('/zufall', (req, res) => res.render('zufall', { title: 'Zufallsgenerator' }));

// ---------- Changelog (Startmenü) ----------
// CHANGELOG.md liegt im Image und wird mit jedem Update ergänzt.
let changelogHtml = null;
router.get('/changelog', (req, res) => {
  if (changelogHtml === null) {
    try { changelogHtml = changelog.toHtml(md(fs.readFileSync(changelog.FILE, 'utf8').replace(/^# .*\n/, ''))); }
    catch { changelogHtml = '<p>Noch keine Einträge.</p>'; }
  }
  res.render('changelog', { title: 'Changelog', changelogHtml, latest: changelog.latest() });
});

// ---------- Datenschutz (Startmenü) ----------
router.get('/datenschutz', (req, res) => {
  res.render('datenschutz', {
    title: 'Datenschutz',
    snippets: privacy.snippets(),
    repo: privacy.REPO,
    deskLimits: require('../desk').limits(),
    retentionDays: Number(getSetting('analytics_retention_days', '365')) || 365,
    mailOn: !!(getSetting('notify_email') && getSetting('smtp_host')),
  });
});

// ---------- Bilder / Medien ----------
router.get('/media/:name', (req, res, next) => {
  const name = req.params.name;
  if (!/^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$/.test(name)) return next();
  res.sendFile(path.join(MEDIA_DIR, name), { maxAge: '30d', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } }, err => err && next());
});

// ---------- Design (dynamisches CSS aus den Einstellungen) ----------
router.get('/theme.css', (req, res) => {
  const s = k => getSetting(k, '');
  const color = v => (/^#[0-9a-f]{3,8}$/i.test(v) ? v : 'inherit');
  const bg = s('theme_bg_image');
  const mode = s('theme_bg_mode');
  const bgImg = /^\/media\/[a-f0-9]{32}(\.[a-z0-9]+)?$/.test(bg) ? `url("${bg}")` : 'none';
  const bgExtra = mode === 'cover' ? 'background-size: cover; background-attachment: fixed; background-position: center;'
    : mode === 'center' ? 'background-repeat: no-repeat; background-position: center; background-attachment: fixed;' : 'background-repeat: repeat;';
  res.type('text/css').set('Cache-Control', 'no-cache').send(`:root {
  --desktop: ${color(s('theme_bg_color'))};
  --win: ${color(s('theme_window_color'))};
  --title-from: ${color(s('theme_title_from'))};
  --title-to: ${color(s('theme_title_to'))};
  --text: ${color(s('theme_text_color'))};
  --link: ${color(s('theme_link_color'))};
  --font: ${(FONTS[s('theme_font')] || FONTS.tahoma)[1]};
}
body { background-image: ${bgImg}; ${bgExtra} }
${s('theme_custom_css').replace(/<\/?style/gi, '')}
`);
});

// ---------- Konto ----------
// Ziel nach An- oder Registrierung: nur Pfade dieser Seite ("//…" oder "/\…" führten zu fremden Seiten)
const localPath = v => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : null);
// Der Anmeldebildschirm (public/logon.js) schickt dieselben Formulare per fetch und will JSON zurück
const wantsJson = req => req.accepts(['html', 'json']) === 'json';
const logonInfo = u => ({ u: u.username, n: u.display_name || u.username, a: u.avatar || '', admin: u.role === 'admin' });
router.get('/login', (req, res) => res.render('login', { title: 'Anmelden', err: null, next: req.query.next || '' }));
router.post('/login', auth.rateLimit('login', 10, 600), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || ''));
  const nextUrl = localPath(req.body.next) || (u && u.role === 'admin' ? '/admin' : '/');
  if (!u || u.disabled || !auth.checkPassword(String(req.body.password || ''), u.password_hash)) {
    if (wantsJson(req)) return res.status(401).json({ error: 'Benutzername oder Kennwort falsch.' });
    return res.status(401).render('login', { title: 'Anmelden', err: 'Benutzername oder Passwort falsch.', next: req.body.next || '' });
  }
  // Wer schon angemeldet war (Anderer Benutzer…), wird dabei abgemeldet
  auth.endSession(req, res);
  auth.startSession(req, res, u.id);
  if (wantsJson(req)) return res.json({ ok: true, next: nextUrl, user: logonInfo(u) });
  res.redirect(nextUrl);
});
router.post('/logout', (req, res) => {
  auth.endSession(req, res);
  if (wantsJson(req)) return res.json({ ok: true });
  res.redirect('/');
});
// Kennworthinweis für den „?“-Knopf. Wie früher bei Windows sieht ihn jeder, der den Benutzernamen kennt.
router.get('/api/kennworthinweis', auth.rateLimit('hinweis', 30, 600), (req, res) => {
  const u = db.prepare('SELECT password_hint FROM users WHERE username = ? AND disabled = 0').get(String(req.query.u || '').slice(0, 32));
  res.set('Cache-Control', 'no-store').json({ hint: (u && u.password_hint) || null });
});

router.get('/register', (req, res, next) => {
  if (getSetting('registration_open') !== '1') return next();
  res.render('register', { title: 'Registrieren', err: null, next: req.query.next || '' });
});
router.post('/register', auth.rateLimit('reg', 5, 3600), (req, res, next) => {
  if (getSetting('registration_open') !== '1') return wantsJson(req) ? res.status(403).json({ error: 'Registrieren ist gerade geschlossen.' }) : next();
  const { username, password, password2 } = req.body;
  let err = null;
  if (!auth.validUsername(username)) err = 'Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, _ . -';
  else if (!auth.validPassword(password)) err = 'Passwort muss mindestens 8 Zeichen haben.';
  else if (password !== password2) err = 'Die Passwörter stimmen nicht überein.';
  else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) err = 'Dieser Benutzername ist schon vergeben.';
  if (err) return wantsJson(req) ? res.status(400).json({ error: err }) : res.render('register', { title: 'Registrieren', err, next: req.body.next || '' });
  const id = auth.createUser(username, password);
  mail.notifyQuietly('Neue Registrierung', `Neuer Nutzer: ${username}`);
  notify.toAdmins('👤 Neue Registrierung: ' + username, 'Ein neues Mitglied hat sich angemeldet.', '/nutzer/' + encodeURIComponent(username), 'admin:register');
  auth.endSession(req, res);
  auth.startSession(req, res, id);
  const nextUrl = localPath(req.body.next) || '/';
  if (wantsJson(req)) return res.json({ ok: true, next: nextUrl, user: { u: username, n: username, a: '', admin: false } });
  res.redirect(nextUrl);
});

module.exports = router;
