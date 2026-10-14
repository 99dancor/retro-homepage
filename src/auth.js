'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db, now } = require('./db');

const SESSION_DAYS = 30;
// 'auto' (Standard): Secure-Cookies, sobald die Seite per HTTPS (über Nginx Proxy Manager) aufgerufen wird.
const COOKIE_SECURE = process.env.COOKIE_SECURE || 'auto';
const secureFor = req => (COOKIE_SECURE === 'auto' ? req.secure : COOKIE_SECURE === 'true');

function hashPassword(pw) { return bcrypt.hashSync(pw, 12); }
function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function createUser(username, password, role = 'user') {
  return db.prepare('INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(password), role, now()).lastInsertRowid;
}

function validUsername(u) { return typeof u === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 200; }

function startSession(req, res, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(id, user_id, expires) VALUES (?, ?, ?)').run(id, userId, now() + SESSION_DAYS * 86400);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), userId);
  res.cookie('sid', id, { httpOnly: true, sameSite: 'lax', secure: secureFor(req), maxAge: SESSION_DAYS * 86400e3 });
}

function endSession(req, res) {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.cookies.sid);
  res.clearCookie('sid');
}

// Lädt den eingeloggten Nutzer (falls vorhanden) und setzt ein CSRF-Token-Cookie.
function loadUser(req, res, next) {
  req.user = null;
  const sid = req.cookies.sid;
  if (sid) {
    const u = db.prepare(`SELECT u.id, u.username, u.role, u.disabled, u.can_upload FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.id = ? AND s.expires > ?`).get(sid, now());
    if (u && !u.disabled) {
      u.groups = db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(u.id).map(r => r.group_id);
      u.isAdmin = u.role === 'admin';
      u.canUpload = u.isAdmin || !!u.can_upload;
      req.user = u;
    }
  }
  let csrf = req.cookies.csrf;
  if (!csrf || !/^[a-f0-9]{48}$/.test(csrf)) {
    csrf = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', csrf, { httpOnly: true, sameSite: 'lax', secure: secureFor(req) });
  }
  req.csrfToken = csrf;
  res.locals.user = req.user;
  res.locals.csrf = csrf;
  next();
}

// Double-Submit-Cookie: jedes POST-Formular schickt das Token als Feld _csrf mit.
function csrfValid(req) {
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const want = req.cookies.csrf;
  return !!sent && !!want && sent.length === want.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want));
}
function csrfCheck(req, res, next) {
  if (req.method !== 'POST') return next();
  if (!csrfValid(req)) {
    // bereits gespeicherte Uploads eines abgelehnten Formulars wieder entfernen
    for (const f of [].concat(req.files || [], req.file || [])) fs.rm(f.path, { force: true }, () => {});
    return res.status(403).render('error', { title: 'Fehler', message: 'Ungültiges Formular-Token. Bitte Seite neu laden und erneut versuchen.' });
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  if (!req.user.isAdmin) return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Dieser Bereich ist nur für Admins.' });
  next();
}

// Sichtbarkeit: public | members | groups | private
function canSee(user, type, item) {
  if (!item) return false;
  if (user && user.isAdmin) return true;
  if (user && item.uploader_id && item.uploader_id === user.id) return true;
  switch (item.visibility) {
    case 'public': return true;
    case 'members': return !!user;
    case 'groups': {
      if (!user || !user.groups.length) return false;
      const ph = user.groups.map(() => '?').join(',');
      return !!db.prepare(`SELECT 1 FROM acl WHERE item_type = ? AND item_id = ? AND group_id IN (${ph})`)
        .get(type, item.id, ...user.groups);
    }
    default: return false;
  }
}

// SQL-Fragment für Listen, das nur sichtbare Einträge liefert.
function visibilitySql(user, type, alias) {
  if (user && user.isAdmin) return { sql: '1=1', params: [] };
  if (!user) return { sql: `${alias}.visibility = 'public'`, params: [] };
  const own = type === 'file' ? `${alias}.uploader_id = ${Number(user.id)} OR ` : '';
  return {
    sql: `(${own}${alias}.visibility IN ('public','members') OR (${alias}.visibility = 'groups' AND EXISTS (
            SELECT 1 FROM acl a JOIN user_groups ug ON ug.group_id = a.group_id
            WHERE a.item_type = ? AND a.item_id = ${alias}.id AND ug.user_id = ?)))`,
    params: [type, user.id],
  };
}

function setAcl(type, id, groupIds) {
  db.prepare('DELETE FROM acl WHERE item_type = ? AND item_id = ?').run(type, id);
  const ins = db.prepare('INSERT OR IGNORE INTO acl(item_type, item_id, group_id) VALUES (?, ?, ?)');
  for (const g of groupIds) ins.run(type, id, Number(g));
}
function getAcl(type, id) {
  return db.prepare('SELECT group_id FROM acl WHERE item_type = ? AND item_id = ?').all(type, id).map(r => r.group_id);
}

// Einfaches In-Memory-Rate-Limit (pro IP und Schlüssel)
const buckets = new Map();
function rateLimit(key, max, windowSec) {
  return (req, res, next) => {
    const k = key + ':' + req.ip;
    const t = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < t) { b = { count: 0, reset: t + windowSec * 1000 }; buckets.set(k, b); }
    b.count++;
    if (b.count > max) return res.status(429).render('error', { title: 'Zu viele Anfragen', message: 'Bitte warte kurz und versuche es dann erneut.' });
    next();
  };
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60e3).unref();
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(now()), 3600e3).unref();

module.exports = {
  hashPassword, checkPassword, createUser, validUsername, validPassword,
  startSession, endSession, loadUser, csrfCheck, requireLogin, requireAdmin,
  canSee, visibilitySql, setAcl, getAcl, rateLimit,
};
