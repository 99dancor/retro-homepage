'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { db, now, getSetting, UPLOAD_DIR, MEDIA_DIR, APPS_DIR } = require('../db');
const auth = require('../auth');
const analytics = require('../analytics');
const mail = require('../mail');
const up = require('../uploads');
const { md } = require('../util');

const router = express.Router();

// ---------- Startseite ----------
router.get('/', (req, res) => {
  const pv = auth.visibilitySql(req.user, 'post', 'p');
  const fv = auth.visibilitySql(req.user, 'file', 'f');
  res.render('home', {
    title: 'Startseite',
    homeHtml: md(getSetting('home_md')),
    posts: db.prepare(`SELECT * FROM posts p WHERE published = 1 AND ${pv.sql} ORDER BY created_at DESC LIMIT 5`).all(...pv.params),
    files: db.prepare(`SELECT * FROM files f WHERE ${fv.sql} ORDER BY created_at DESC LIMIT 5`).all(...fv.params),
    guestbook: db.prepare('SELECT * FROM guestbook WHERE approved = 1 ORDER BY created_at DESC, id DESC LIMIT 3').all(),
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
  const v = auth.visibilitySql(req.user, 'file', 'f');
  const q = String(req.query.q || '').trim();
  const cat = String(req.query.cat || '').trim();
  const params = [...v.params];
  let where = v.sql;
  if (q) { where += ' AND (title LIKE ? OR description LIKE ? OR game LIKE ? OR original_name LIKE ?)'; params.push(...Array(4).fill('%' + q + '%')); }
  if (cat) { where += ' AND category = ?'; params.push(cat); }
  const files = db.prepare(`SELECT * FROM files f WHERE ${where} ORDER BY category, game, created_at DESC`).all(...params);
  const cats = db.prepare(`SELECT category, COUNT(*) AS n FROM files f WHERE ${v.sql} GROUP BY category ORDER BY category`).all(...v.params);
  const grouped = {};
  for (const f of files) (grouped[f.category] ||= []).push(f);
  res.render('files', { title: 'Downloads', grouped, cats, q, cat });
});

router.get('/files/dl/:id', (req, res, next) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!f || !auth.canSee(req.user, 'file', f)) return next();
  const p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) return next();
  db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(f.id);
  try { analytics.record(req, '/files/dl/' + f.id, true); } catch { /* egal */ }
  res.download(p, f.original_name);
});

router.get('/files/upload', auth.requireLogin, (req, res, next) => {
  if (!req.user.canUpload) return next();
  res.render('upload', { title: 'Datei hochladen', maxMb: up.MAX_MB, msg: null });
});
router.post('/files/upload', auth.requireLogin, (req, res, next) => (req.user.canUpload ? next() : res.status(403).end()),
  up.fileUpload.array('files'), auth.csrfCheck, (req, res) => {
    const vis = ['public', 'members', 'private'].includes(req.body.visibility) ? req.body.visibility : 'members';
    const ins = db.prepare(`INSERT INTO files(title, description, category, game, original_name, stored_name, size, mime, visibility, uploader_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of req.files || []) {
      ins.run((req.body.title || '').trim() || f.originalname, req.body.description || '', (req.body.category || '').trim() || 'Allgemein',
        (req.body.game || '').trim() || null, f.originalname, f.filename, f.size, f.mimetype, vis, req.user.id, now());
    }
    res.render('upload', { title: 'Datei hochladen', maxMb: up.MAX_MB, msg: `${(req.files || []).length} Datei(en) hochgeladen.` });
  });

// ---------- Modlisten ----------
router.get('/mods', (req, res) => {
  const v = auth.visibilitySql(req.user, 'modlist', 'm');
  const lists = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM mod_items i WHERE i.modlist_id = m.id) AS n
                            FROM modlists m WHERE ${v.sql} ORDER BY game, title`).all(...v.params);
  const grouped = {};
  for (const l of lists) (grouped[l.game] ||= []).push(l);
  res.render('mods-list', { title: 'Modlisten', grouped });
});
router.get('/mods/:slug', (req, res, next) => {
  const list = db.prepare('SELECT * FROM modlists WHERE slug = ?').get(req.params.slug);
  if (!list || !auth.canSee(req.user, 'modlist', list)) return next();
  const items = db.prepare('SELECT * FROM mod_items WHERE modlist_id = ? ORDER BY position, id').all(list.id);
  res.render('mod-detail', { title: list.title, list, items, descHtml: md(list.description_md) });
});

// ---------- Links ----------
router.get('/links', (req, res) => {
  const v = auth.visibilitySql(req.user, 'link', 'l');
  const links = db.prepare(`SELECT * FROM links l WHERE ${v.sql} ORDER BY category, position, title`).all(...v.params);
  const grouped = {};
  for (const l of links) (grouped[l.category] ||= []).push(l);
  res.render('links', { title: 'Links', grouped });
});

// ---------- Freundebuch ----------
function guestbookOn(req, res, next) { return getSetting('guestbook_enabled') === '1' ? next() : res.status(404).render('error', { title: 'Freundebuch', message: 'Das Freundebuch ist gerade geschlossen.' }); }

router.get('/guestbook', guestbookOn, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = 20;
  const total = db.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE approved = 1').get().n;
  const entries = db.prepare(`SELECT g.*, u.username FROM guestbook g LEFT JOIN users u ON u.id = g.user_id
                              WHERE approved = 1 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(per, (page - 1) * per);
  res.render('guestbook', { title: 'Freundebuch', entries, page, pages: Math.max(1, Math.ceil(total / per)), total, msg: req.query.ok ? (req.query.ok === 'mod' ? 'Danke! Dein Eintrag erscheint, sobald er freigeschaltet wurde.' : 'Danke für deinen Eintrag!') : null, err: null });
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
  mail.notifyQuietly('Neuer Freundebuch-Eintrag', `Von: ${name || 'Anonym'}\n\n${message}`);
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
  res.redirect('/contact?sent=1');
});

// ---------- Apps & Spiele ----------
router.get('/apps', (req, res) => {
  const v = auth.visibilitySql(req.user, 'app', 'a');
  res.render('apps', { title: 'Spiele & Apps', apps: db.prepare(`SELECT * FROM apps a WHERE ${v.sql} ORDER BY title`).all(...v.params) });
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
  const fonts = {
    tahoma: 'Tahoma, Verdana, "Segoe UI", sans-serif',
    ms_sans: '"MS Sans Serif", "Microsoft Sans Serif", Tahoma, sans-serif',
    times: '"Times New Roman", Times, serif',
    comic: '"Comic Sans MS", "Comic Neue", cursive',
    courier: '"Courier New", Courier, monospace',
    verdana: 'Verdana, Geneva, sans-serif',
  };
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
  --font: ${fonts[s('theme_font')] || fonts.tahoma};
}
body { background-image: ${bgImg}; ${bgExtra} }
${s('theme_custom_css').replace(/<\/?style/gi, '')}
`);
});

// ---------- Konto ----------
router.get('/login', (req, res) => res.render('login', { title: 'Anmelden', err: null, next: req.query.next || '' }));
router.post('/login', auth.rateLimit('login', 10, 600), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || ''));
  const nextUrl = /^\/(?!\/)/.test(req.body.next || '') ? req.body.next : (u && u.role === 'admin' ? '/admin' : '/');
  if (!u || u.disabled || !auth.checkPassword(String(req.body.password || ''), u.password_hash)) {
    return res.status(401).render('login', { title: 'Anmelden', err: 'Benutzername oder Passwort falsch.', next: req.body.next || '' });
  }
  auth.startSession(req, res, u.id);
  res.redirect(nextUrl);
});
router.post('/logout', (req, res) => { auth.endSession(req, res); res.redirect('/'); });

router.get('/register', (req, res, next) => {
  if (getSetting('registration_open') !== '1') return next();
  res.render('register', { title: 'Registrieren', err: null });
});
router.post('/register', auth.rateLimit('reg', 5, 3600), (req, res, next) => {
  if (getSetting('registration_open') !== '1') return next();
  const { username, password, password2 } = req.body;
  let err = null;
  if (!auth.validUsername(username)) err = 'Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, _ . -';
  else if (!auth.validPassword(password)) err = 'Passwort muss mindestens 8 Zeichen haben.';
  else if (password !== password2) err = 'Die Passwörter stimmen nicht überein.';
  else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) err = 'Dieser Benutzername ist schon vergeben.';
  if (err) return res.render('register', { title: 'Registrieren', err });
  const id = auth.createUser(username, password);
  mail.notifyQuietly('Neue Registrierung', `Neuer Nutzer: ${username}`);
  auth.startSession(req, res, id);
  res.redirect('/');
});

function renderAccount(req, res, msg, err) {
  const saves = db.prepare(`SELECT s.app_slug, s.slot, s.updated_at, length(CAST(s.data AS BLOB)) AS size, a.title
                            FROM game_saves s LEFT JOIN apps a ON a.slug = s.app_slug
                            WHERE s.user_id = ? ORDER BY a.title, s.app_slug, s.slot`).all(req.user.id);
  res.render('account', { title: 'Mein Konto', msg, err, saves });
}
router.get('/account', auth.requireLogin, (req, res) => renderAccount(req, res, null, null));
router.post('/account/saves/delete', auth.requireLogin, (req, res) => {
  db.prepare('DELETE FROM game_saves WHERE user_id = ? AND app_slug = ? AND slot = ?')
    .run(req.user.id, String(req.body.app || ''), String(req.body.slot || ''));
  renderAccount(req, res, 'Spielstand gelöscht.', null);
});
router.post('/account', auth.requireLogin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const render = (msg, err) => renderAccount(req, res, msg, err);
  if (!auth.checkPassword(String(req.body.current || ''), u.password_hash)) return render(null, 'Aktuelles Passwort ist falsch.');
  if (!auth.validPassword(req.body.password)) return render(null, 'Neues Passwort muss mindestens 8 Zeichen haben.');
  if (req.body.password !== req.body.password2) return render(null, 'Die Passwörter stimmen nicht überein.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(req.body.password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(u.id, req.cookies.sid);
  render('Passwort geändert.', null);
});

module.exports = router;
