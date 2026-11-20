'use strict';
// Dancors Dreschplatz: der FS25 Hub (eigenes Projekt, github.com/99dancor/fs25hub) eingebaut unter /farming.
// Die Website gibt ihm Konten, Formular-Token, Benachrichtigungen, Profile, Modlisten und den Rückweg; seine Tabellen fs_*
// liegen wie bisher in site.db, seine Dateien in DATA_DIR/fshub. Verwaltet wird er im Hub selbst (/farming/verwaltung).
const { createHub } = require('fs25hub');
const { db, DATA_DIR } = require('./db');
const auth = require('./auth');
const notify = require('./notify');
const profiles = require('./profiles');

const BASE = '/farming';

const hub = createHub({
  db,
  dataDir: DATA_DIR,
  base: BASE,
  title: 'Dancors Dreschplatz',
  host: {
    user: req => req.user && { id: req.user.id, username: req.user.username, display_name: req.user.display_name, avatar: req.user.avatar, isAdmin: req.user.isAdmin },
    loginUrl: next => '/login?next=' + encodeURIComponent(next || BASE),
    logoutUrl: '/logout',
    csrfToken: req => req.csrfToken,
    csrfValid: req => auth.csrfValid(req),
    notify: (userId, msg) => notify.send(userId, 'fshub', msg),
    notifyAdmins: (title, body, url, key) => notify.toAdmins(title, body, url, key),
    profileUrl: username => profiles.profileUrl(username),
    avatarUrl: u => (u && u.avatar ? '/avatar/' + u.avatar : null),
    siteAdmins: () => db.prepare("SELECT id, username, display_name FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY username COLLATE NOCASE").all(),
    back: { href: '/', label: 'dancor.org' },
    modlists: {
      all: () => db.prepare('SELECT id, slug, title, game, owner_id FROM modlists ORDER BY game, title').all(),
      bySlug: slug => require('./modlists').bySlug(slug) || null,
      categories: id => require('./modlists').categories(id),
      setOnServer: (itemId, on) => db.prepare('UPDATE mod_items SET on_server = ? WHERE id = ?').run(on ? 1 : 0, Number(itemId)),
    },
  },
});

module.exports = hub;
module.exports.BASE = BASE;
