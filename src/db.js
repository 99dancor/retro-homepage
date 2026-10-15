'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
require('./privileges').dropPrivileges(DATA_DIR);
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const APPS_DIR = path.join(DATA_DIR, 'apps');
for (const d of [UPLOAD_DIR, MEDIA_DIR, APPS_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'site.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- 'admin' | 'user'
  disabled INTEGER NOT NULL DEFAULT 0,
  can_upload INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT
);
CREATE TABLE IF NOT EXISTS user_groups (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

-- visibility: 'public' | 'members' | 'groups' | 'private'
CREATE TABLE IF NOT EXISTS acl (
  item_type TEXT NOT NULL,       -- 'post' | 'file' | 'modlist' | 'link'
  item_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_type, item_id, group_id)
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  tags TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Allgemein',
  game TEXT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  downloads INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS modlists (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  description_md TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mod_items (
  id INTEGER PRIMARY KEY,
  modlist_id INTEGER NOT NULL REFERENCES modlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  url TEXT,
  version TEXT,
  notes TEXT,
  required INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'Allgemein',
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS guestbook (
  id INTEGER PRIMARY KEY,
  name TEXT,                     -- NULL = anonym
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  visitor_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer_host TEXT,
  visitor_hash TEXT NOT NULL,
  user_id INTEGER,
  device TEXT,
  is_download INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  name TEXT,
  email TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public',
  in_nav INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  entry TEXT NOT NULL DEFAULT 'index.html',
  visibility TEXT NOT NULL DEFAULT 'public',
  external_url TEXT,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Spielstände der Browser-Spiele, pro Konto, App und Platz
CREATE TABLE IF NOT EXISTS game_saves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_slug TEXT NOT NULL,
  slot TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_slug, slot)
);
CREATE INDEX IF NOT EXISTS pv_day ON pageviews(day);
CREATE INDEX IF NOT EXISTS pv_path ON pageviews(path);
CREATE INDEX IF NOT EXISTS pv_visitor ON pageviews(day, visitor_hash);
`);

function now() { return Math.floor(Date.now() / 1000); }

function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

const DEFAULT_SETTINGS = {
  site_title: 'Meine Seite',
  site_tagline: 'Spielstände, Modlisten, Links und Gedanken',
  about_md: 'Willkommen! Hier sammle ich Dinge, die mich interessieren.',
  registration_open: '0',
  guestbook_moderation: '0',
  guestbook_enabled: '1',
  analytics_retention_days: '365',
  home_md: '## Willkommen auf meiner Homepage!\n\nSchön, dass du vorbeischaust. Schau dich um und trag dich ins **Freundebuch** ein!',
  // Design
  theme_bg_color: '#008080',
  theme_bg_image: '',
  theme_bg_mode: 'tile',          // tile | cover | center
  theme_window_color: '#c0c0c0',
  theme_title_from: '#000080',
  theme_title_to: '#1084d0',
  theme_text_color: '#000000',
  theme_link_color: '#0000ee',
  theme_font: 'tahoma',
  theme_marquee: 'Herzlich willkommen auf meiner Homepage! *** Trag dich ins Freundebuch ein! ***',
  theme_show_counter: '1',
  theme_custom_css: '',
  nav_hidden: '',
  // Kontakt / E-Mail
  contact_enabled: '1',
  notify_email: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (getSetting(k) === null) setSetting(k, v);
}
if (getSetting('secret') === null) setSetting('secret', crypto.randomBytes(32).toString('hex'));

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, now, getSetting, setSetting, tx, DATA_DIR, UPLOAD_DIR, MEDIA_DIR, APPS_DIR };
