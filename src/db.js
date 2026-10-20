'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
// Downloads liegen in /data/uploads. Dort kann in Unraid ein eigener Ordner auf einer anderen
// Platte eingehängt werden (siehe README). In uploads/eingang kopierte Dateien lassen sich im Admin übernehmen.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const IMPORT_DIR = path.join(UPLOAD_DIR, 'eingang');
require('./privileges').dropPrivileges(DATA_DIR, [UPLOAD_DIR, IMPORT_DIR]);
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const APPS_DIR = path.join(DATA_DIR, 'apps');
const MUSIC_DIR = path.join(DATA_DIR, 'musik');
const AVATAR_DIR = path.join(DATA_DIR, 'avatare');
const PAINT_DIR = path.join(DATA_DIR, 'paint');
for (const d of [UPLOAD_DIR, MEDIA_DIR, APPS_DIR, MUSIC_DIR, AVATAR_DIR, PAINT_DIR]) fs.mkdirSync(d, { recursive: true });
fs.mkdirSync(IMPORT_DIR, { recursive: true });
try { fs.chmodSync(IMPORT_DIR, 0o777); } catch { /* Netzwerkfreigabe darf hineinkopieren */ }

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
  last_login INTEGER,
  display_name TEXT,                          -- Anzeigename, sonst gilt der Benutzername
  avatar TEXT,                                -- Profilbild unter data/avatare
  about TEXT,                                 -- „Über mich“ im Profil
  profile_visibility TEXT NOT NULL DEFAULT 'members',  -- public | members | friends
  pm_from TEXT NOT NULL DEFAULT 'all',        -- Privatnachrichten von: all (allen Mitgliedern) | friends
  gb_from TEXT NOT NULL DEFAULT 'all'         -- Einträge ins Freundebuch im Profil von: all | friends | off
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
-- Jeder Download-Vorgang: wer (anonymer Tages-Hash), wie viel übertragen, fertig oder abgebrochen
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  visitor_hash TEXT NOT NULL,
  user_id INTEGER,
  device TEXT,
  referrer_host TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  resumed INTEGER NOT NULL DEFAULT 0      -- Fortsetzung eines abgebrochenen Downloads (Range ab > 0)
);
-- Forum: Themen und Beiträge angemeldeter Nutzer
CREATE TABLE IF NOT EXISTS board_topics (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,   -- wie der erste Beitrag
  created_at INTEGER NOT NULL,
  last_post_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS board_posts (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES board_topics(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body_md TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,   -- andere sehen statt des Namens "Anonym", der Admin sieht ihn
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);
-- Entwürfe für Forenbeiträge und Blogbeiträge. place sagt, wofür der Text gedacht war:
-- Forum 'new' | 'reply:<Thema>' | 'edit:<Beitrag>', Blog 'new' | 'post:<Beitrag>'. fields: übrige Formularfelder als JSON.
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  place TEXT NOT NULL,
  title TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  fields TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Abonnierte Forenthemen. Wer ein Thema beginnt oder antwortet, abonniert es von selbst.
CREATE TABLE IF NOT EXISTS board_subs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES board_topics(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, topic_id)
);
-- Benachrichtigungen (🔔 neben der Uhr, Startseite). key fasst gleiche ungelesene zusammen (count zählt mit).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
-- Geräte für Push-Benachrichtigungen: Adresse beim Push-Dienst des Browsers und dessen Schlüssel
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);
-- Musik: hochgeladene Titel (Admin und Mitglieder), Playlists der Mitglieder
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  duration REAL,                          -- Sekunden, vom Browser gemessen (beim Hochladen oder ersten Abspielen)
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  plays INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, position)
);
-- Freunde: eine Zeile pro Paar, user_id hat die Anfrage geschickt
CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
-- Privatnachrichten zwischen zwei Mitgliedern. Löschen beide den Verlauf, verschwindet die Nachricht ganz.
CREATE TABLE IF NOT EXISTS private_messages (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  hidden_from INTEGER NOT NULL DEFAULT 0,   -- Absender hat den Verlauf gelöscht
  hidden_to INTEGER NOT NULL DEFAULT 0      -- Empfänger hat den Verlauf gelöscht
);
-- Freundebuch im Profil: Mitglieder schreiben einem anderen Mitglied etwas auf sein Profil
CREATE TABLE IF NOT EXISTS profile_guestbook (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Spielstatistiken im Profil: pro Konto, Spiel und Wert eine Zahl (z. B. Siege, Höchstpunktzahl)
CREATE TABLE IF NOT EXISTS game_stats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_slug TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_slug, key)
);
-- Blackjack: eine Zeile pro Sitzung an einem Tisch (Spielgeld). Bilanz = Chips − eingekauft (Start + Nachkäufe).
CREATE TABLE IF NOT EXISTS bj_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  chips INTEGER NOT NULL,                   -- Chips beim letzten Speichern (nach jeder Hand) bzw. beim Aufstehen
  bought INTEGER NOT NULL,                  -- insgesamt eingekauft
  buyins INTEGER NOT NULL DEFAULT 1,
  hands INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  pushes INTEGER NOT NULL DEFAULT 0,
  blackjacks INTEGER NOT NULL DEFAULT 0,
  best_win INTEGER NOT NULL DEFAULT 0,      -- höchster Gewinn in einer Runde
  best_streak INTEGER NOT NULL DEFAULT 0,   -- längste Siegesserie
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);
-- Poker (Texas Hold'em): eine Zeile pro Sitzung an einem Tisch, Bilanz wie bei Blackjack = Chips − eingekauft.
CREATE TABLE IF NOT EXISTS pk_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  chips INTEGER NOT NULL,                   -- Chips beim letzten Speichern (nach jeder Hand) bzw. beim Aufstehen
  bought INTEGER NOT NULL,                  -- insgesamt eingekauft
  buyins INTEGER NOT NULL DEFAULT 1,
  hands INTEGER NOT NULL DEFAULT 0,         -- ausgeteilte Hände
  wins INTEGER NOT NULL DEFAULT 0,          -- Hände mit Gewinn
  showdowns INTEGER NOT NULL DEFAULT 0,
  best_win INTEGER NOT NULL DEFAULT 0,      -- höchster Gewinn in einer Hand
  best_hand INTEGER NOT NULL DEFAULT -1,    -- bestes Blatt im Showdown (0 Höchste Karte … 9 Royal Flush)
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);
-- Durak: eine Zeile pro Spieler und beendetem Spiel. place 1 = als Erster keine Karten mehr, durak 1 = mit Karten übrig geblieben
-- (oder mitten im Spiel aufgestanden). Bei Unentschieden (die Letzten werden gleichzeitig fertig) gibt es keinen Durak.
CREATE TABLE IF NOT EXISTS dk_results (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  players INTEGER NOT NULL,                 -- Mitspieler in diesem Spiel
  place INTEGER NOT NULL,
  durak INTEGER NOT NULL DEFAULT 0,
  quit INTEGER NOT NULL DEFAULT 0,          -- mitten im Spiel aufgestanden (zählt als Durak)
  bouts INTEGER NOT NULL DEFAULT 0,         -- Angriffe im ganzen Spiel
  ended_at INTEGER NOT NULL
);
-- UNO, Flip 7 und Pilli Pilli (src/cardtable.js): eine Zeile pro Spieler und beendetem Spiel, game sagt welches.
-- score ist der Endstand (UNO/Flip 7 Punkte, Pilli Pilli Strafpunkte), best und bonus zählt jedes Spiel selbst (siehe src/games.js).
CREATE TABLE IF NOT EXISTS cg_results (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,                       -- uno | flip7 | pilli
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  players INTEGER NOT NULL,                 -- Mitspieler in diesem Spiel
  place INTEGER NOT NULL,
  won INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,          -- UNO: höchste Runde, Flip 7: beste Runde, Pilli Pilli: –
  bonus INTEGER NOT NULL DEFAULT 0,         -- UNO: Runden gewonnen, Flip 7: Flip 7 geschafft, Pilli Pilli: Runden genau getroffen
  rounds INTEGER NOT NULL DEFAULT 0,
  quit INTEGER NOT NULL DEFAULT 0,          -- mitten im Spiel aufgestanden
  ended_at INTEGER NOT NULL
);
-- Kartenspiele (src/kasse.js): ein Geldbeutel pro Mitglied für alle Kartenspiele mit Geld (Blackjack, Poker).
-- Bilanz = balance − bought; der Start zählt als erster Buy-in. Sitzt jemand an einem Geldtisch, liegt das Geld als Chips dort
-- und balance ist der Stand nach der letzten Hand.
CREATE TABLE IF NOT EXISTS ks_wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL,
  bought INTEGER NOT NULL,                  -- insgesamt eingekauft (Start + Nachkäufe)
  buyins INTEGER NOT NULL DEFAULT 1,
  spent INTEGER NOT NULL DEFAULT 0,         -- im Shop ausgegeben (zählt nicht als Verlust)
  drink TEXT,                               -- was in der Ablage am Platz steht (Shop-Artikel)
  charm TEXT,                               -- Glücksbringer neben dem Namen (Shop-Artikel)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Kartenspiele-Shop (src/kasse.js): was ein Mitglied mit Spielgeld gekauft hat (Getränke, Glücksbringer, Tischränder)
CREATE TABLE IF NOT EXISTS ks_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  price INTEGER NOT NULL,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
);
-- Paint: gespeicherte Bilder. Bild und Vorschau liegen als PNG in data/paint (<stored_name>.png, <stored_name>-v.png).
CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,                    -- Bytes von Bild und Vorschau zusammen
  visibility TEXT NOT NULL DEFAULT 'private',   -- public | members | private
  approved INTEGER NOT NULL DEFAULT 1,      -- öffentliche Bilder erst nach Freigabe, wenn der Admin das so eingestellt hat
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Paint: wer an einem Bild aus einer Lobby mitgemalt hat (der Besitzer steht nicht drin)
CREATE TABLE IF NOT EXISTS artwork_painters (
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strokes INTEGER NOT NULL DEFAULT 0,       -- wie viele Änderungen von ihm im Bild stecken
  PRIMARY KEY (artwork_id, user_id)
);
-- Quiz: eine Zeile pro gespieltem Quiz und eine pro Spieler (Gäste nur mit ihrem gewählten Namen, ohne Konto)
CREATE TABLE IF NOT EXISTS quiz_games (
  id INTEGER PRIMARY KEY,
  room_name TEXT NOT NULL,
  quiz_title TEXT,
  host_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  host_name TEXT NOT NULL,
  questions INTEGER NOT NULL,               -- wie viele Fragen gestellt wurden
  players INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_results (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES quiz_games(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  guest INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL,
  place INTEGER NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0
);
-- Gespeicherte Quizze der Mitglieder: Fragen als JSON (wie die Quiz-Datei), shared = für andere Mitglieder sichtbar
CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  questions INTEGER NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Minesweeper: eine Zeile pro beendetem Spiel eines Mitglieds (level: beginner | intermediate | expert | custom)
CREATE TABLE IF NOT EXISTS ms_games (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  mines INTEGER NOT NULL,
  won INTEGER NOT NULL,
  seconds INTEGER NOT NULL,
  played_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ms_user ON ms_games(user_id, played_at);
CREATE INDEX IF NOT EXISTS ms_best ON ms_games(level, won, seconds);
-- Pixelpfoten-Besuchsbuch: was ein Mitglied bei den Tieren eines anderen getan hat (siehe src/pixelpfoten.js).
-- applied: das Spiel des Gastgebers hat es schon in seinen Spielstand eingerechnet. Einträge bleiben 30 Tage.
CREATE TABLE IF NOT EXISTS pp_visits (
  id INTEGER PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visitor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  pet_id TEXT,
  detail TEXT,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pp_visits_host ON pp_visits(host_id, applied, id);
CREATE INDEX IF NOT EXISTS pp_visits_day ON pp_visits(host_id, visitor_id, day, kind);
-- Pixelpfoten-Tageswettbewerb: beste Runde je Mitglied und Tag (Tier nur mit Name, Art und Farbe)
CREATE TABLE IF NOT EXISTS pp_contest (
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_name TEXT NOT NULL,
  species TEXT NOT NULL,
  color TEXT NOT NULL,
  score INTEGER NOT NULL,
  runs INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS pp_contest_board ON pp_contest(day, score DESC, updated_at);
-- Kreuzworträtsel: ein Rätsel pro Tag (für alle gleich) und der Stand jedes Mitglieds an diesem Tag
CREATE TABLE IF NOT EXISTS cw_puzzles (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cw_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  letters TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  checks INTEGER NOT NULL DEFAULT 0,
  reveals INTEGER NOT NULL DEFAULT 0,
  gave_up INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  solved_at INTEGER,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS cw_day ON cw_progress(day, solved_at);
-- Sudoku: drei Sudokus pro Tag (Leicht, Mittel, Schwer; für alle gleich) und der Stand jedes Mitglieds daran
CREATE TABLE IF NOT EXISTS sd_puzzles (
  day TEXT NOT NULL,
  level TEXT NOT NULL,
  givens TEXT NOT NULL,
  solution TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, level)
);
CREATE TABLE IF NOT EXISTS sd_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  level TEXT NOT NULL,
  digits TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  checks INTEGER NOT NULL DEFAULT 0,
  reveals INTEGER NOT NULL DEFAULT 0,
  gave_up INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  solved_at INTEGER,
  PRIMARY KEY (user_id, day, level)
);
CREATE INDEX IF NOT EXISTS sd_day ON sd_progress(day, level, solved_at);
-- Werwolf: eine Zeile pro Mitglied und beendetem Spiel (Gäste werden nicht gespeichert)
CREATE TABLE IF NOT EXISTS ww_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  players INTEGER NOT NULL,
  days INTEGER NOT NULL,
  role TEXT NOT NULL,
  won INTEGER NOT NULL,
  survived INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ww_user ON ww_results(user_id, ended_at);
CREATE INDEX IF NOT EXISTS qz_user ON quizzes(user_id, updated_at);
CREATE INDEX IF NOT EXISTS qr_user ON quiz_results(user_id);
CREATE INDEX IF NOT EXISTS qr_game ON quiz_results(game_id);
CREATE INDEX IF NOT EXISTS awp_user ON artwork_painters(user_id);
CREATE INDEX IF NOT EXISTS aw_owner ON artworks(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS aw_list ON artworks(visibility, approved, updated_at);
CREATE INDEX IF NOT EXISTS bj_user ON bj_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS pk_user ON pk_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS dk_user ON dk_results(user_id, ended_at);
CREATE INDEX IF NOT EXISTS cg_user ON cg_results(game, user_id, ended_at);
CREATE INDEX IF NOT EXISTS pg_profile ON profile_guestbook(profile_id, created_at);
CREATE INDEX IF NOT EXISTS fr_friend ON friends(friend_id);
CREATE INDEX IF NOT EXISTS pm_to ON private_messages(to_id, read_at);
CREATE INDEX IF NOT EXISTS pm_pair ON private_messages(from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS dr_user ON drafts(user_id, kind, updated_at);
CREATE INDEX IF NOT EXISTS bp_topic ON board_posts(topic_id, created_at);
CREATE INDEX IF NOT EXISTS bt_order ON board_topics(pinned, last_post_at);
CREATE INDEX IF NOT EXISTS nt_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS nt_key ON notifications(user_id, key);
CREATE INDEX IF NOT EXISTS dl_day ON downloads(day);
CREATE INDEX IF NOT EXISTS dl_file ON downloads(file_id, day);
CREATE INDEX IF NOT EXISTS pv_day ON pageviews(day);
CREATE INDEX IF NOT EXISTS pv_path ON pageviews(path);
CREATE INDEX IF NOT EXISTS pv_visitor ON pageviews(day, visitor_hash);
`);

// Migrationen für bestehende Datenbanken: fehlende Spalten beim Start ergänzen
function addColumn(table, column, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('media', 'uploader_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('board_topics', 'anonymous', 'INTEGER NOT NULL DEFAULT 0');
addColumn('board_posts', 'anonymous', 'INTEGER NOT NULL DEFAULT 0');
addColumn('board_topics', 'views', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'notify_prefs', 'TEXT');                       // JSON je Art: { site, push }, leer = Vorgaben
addColumn('users', 'display_name', 'TEXT');
addColumn('users', 'avatar', 'TEXT');
addColumn('ks_wallets', 'spent', 'INTEGER NOT NULL DEFAULT 0');
addColumn('ks_wallets', 'drink', 'TEXT');
addColumn('ks_wallets', 'charm', 'TEXT');
addColumn('users', 'about', 'TEXT');
addColumn('users', 'profile_visibility', "TEXT NOT NULL DEFAULT 'members'");
addColumn('users', 'pm_from', "TEXT NOT NULL DEFAULT 'all'");
addColumn('users', 'gb_from', "TEXT NOT NULL DEFAULT 'all'");
addColumn('artworks', 'draft', 'INTEGER NOT NULL DEFAULT 0');    // 1 = Entwurf, den eine Paint-Lobby von selbst sichert

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
  home_md: '## Willkommen auf meiner Homepage!\n\nSchön, dass du vorbeischaust. Schau dich um und trag dich ins **Besucherbuch** ein!',
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
  theme_marquee: 'Herzlich willkommen auf meiner Homepage! *** Trag dich ins Besucherbuch ein! ***',
  theme_show_counter: '1',
  theme_custom_css: '',
  nav_hidden: '',
  // Kontakt / E-Mail
  contact_enabled: '1',
  board_enabled: '1',
  board_members_only: '0',      // Forum nur für angemeldete Nutzer lesbar
  music_upload: 'members',      // Musik hochladen: members (alle Mitglieder) | upload (nur mit Upload-Recht) | admin
  music_quota_mb: '500',        // Speicher für Musik pro Mitglied (Admin unbegrenzt)
  lobby_enabled: '1',           // Musik-Lobbys zum gemeinsamen Hören
  youtube_enabled: '1',         // YouTube-Lieder in Lobbys
  ks_buyin: '1000',             // Kartenspiele-Kasse: Startgeld und jeder Nachkauf
  ks_rebuy_below: '200',        // Nachkaufen erst unter diesem Stand
  bj_enabled: '1',              // Blackjack (Spielgeld) für Mitglieder
  bj_decks: '6',
  bj_h17: '0',                  // Dealer zieht auf Soft 17
  bj_turn: '30',                // Bedenkzeit pro Zug in Sekunden
  pk_enabled: '1',              // Poker (Texas Hold'em, Spielgeld) für Mitglieder
  pk_turn: '30',                // Bedenkzeit pro Zug in Sekunden
  dk_enabled: '1',              // Durak (Kartenspiel ohne Geld) für Mitglieder
  dk_turn: '30',                // Bedenkzeit zum Angreifen und Verteidigen in Sekunden
  uno_enabled: '1',             // UNO für Mitglieder
  uno_turn: '30',               // Bedenkzeit pro Zug in Sekunden
  f7_enabled: '1',              // Flip 7 für Mitglieder
  f7_turn: '20',
  pp_enabled: '1',              // Pilli Pilli für Mitglieder
  pp_turn: '30',
  ww_enabled: '1',              // Werwolf (Gesellschaftsspiel, lokal oder online)
  ww_guests: '1',               // Gäste spielen Werwolf ohne Konto mit
  paint_enabled: '1',           // Paint im Startmenü
  paint_guests: '1',            // Gäste dürfen malen und herunterladen (Speichern nur mit Konto)
  paint_save: 'members',        // Bilder speichern: members | upload (nur mit Upload-Recht) | admin
  paint_quota_mb: '50',         // Speicher für Bilder pro Mitglied (Admin unbegrenzt)
  paint_max_w: '2000',          // größte Leinwand in Pixeln
  paint_max_h: '2000',
  paint_gallery: '1',           // Galerie mit öffentlichen Bildern
  paint_moderation: '0',        // öffentliche Bilder erst nach Freigabe durch den Admin zeigen
  paint_lobbies: '1',           // gemeinsam malen in Lobbys (nur Mitglieder)
  notify_email: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
};
// Das Freundebuch der Seite heißt seit den Profil-Freundebüchern „Besucherbuch“: unveränderte Standardtexte mitziehen
for (const k of ['home_md', 'theme_marquee']) {
  const v = getSetting(k);
  if (v !== null && v === DEFAULT_SETTINGS[k].replace('Besucherbuch', 'Freundebuch')) setSetting(k, DEFAULT_SETTINGS[k]);
}
// Seit der gemeinsamen Kasse gilt ein Buy-in für alle Kartenspiele: den bisherigen Blackjack-Wert übernehmen
for (const k of ['buyin', 'rebuy_below']) {
  if (getSetting('ks_' + k) === null && getSetting('bj_' + k) !== null) setSetting('ks_' + k, getSetting('bj_' + k));
}
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (getSetting(k) === null) setSetting(k, v);
}
if (getSetting('secret') === null) setSetting('secret', crypto.randomBytes(32).toString('hex'));

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, now, getSetting, setSetting, tx, DATA_DIR, UPLOAD_DIR, IMPORT_DIR, MEDIA_DIR, APPS_DIR, MUSIC_DIR, AVATAR_DIR, PAINT_DIR };
