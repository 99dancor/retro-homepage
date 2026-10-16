'use strict';
// Code-Ausschnitte für die Seite /datenschutz. Sie werden beim ersten Aufruf aus genau den Dateien gelesen,
// die der Server gerade ausführt, und gesucht statt über feste Zeilennummern geholt: So zeigt die Seite auch
// nach Änderungen den echten Code. Findet sich ein Anker nicht mehr, schlägt der Rauchtest an.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPO = 'https://github.com/99dancor/retro-homepage/blob/main/';

// name: [Datei, Text in der ersten Zeile, Anzahl Zeilen]
const SNIPPETS = {
  salt: ['src/analytics.js', 'function dailySalt()', 8],
  hash: ['src/analytics.js', 'function visitorHash(req)', 3],
  pageview: ['src/analytics.js', 'const insert = db.prepare(`INSERT INTO pageviews', 2],
  tracked: ['src/analytics.js', 'function isTracked(req)', 5],
  cleanup: ['src/analytics.js', 'function cleanup()', 5],
  rateLimit: ['src/auth.js', 'function rateLimit(key, max, windowSec)', 4],
  session: ['src/auth.js', 'function startSession(req, res, userId)', 6],
  csrf: ['src/auth.js', "res.cookie('csrf'", 1],
  csp: ['src/server.js', "'Content-Security-Policy': \"default-src 'self'", 1],
  desk: ['public/retro.js', "sessionStorage.setItem('desk'", 1],
  display: ['public/display.js', "var KEY = 'darstellung'", 1],
  displaySave: ['public/display.js', 'function save(p, img)', 7],
  editor: ['public/editor.js', "var MODE_KEY = 'editor-mode'", 1],
  pet: ['games/haustier/src/js/storage.js', "const PREFIX = 'haustier:v1:'", 7],
  users: ['src/db.js', 'CREATE TABLE IF NOT EXISTS users (', 10],
  password: ['src/auth.js', 'function hashPassword(pw)', 1],
  guestbook: ['src/routes/public.js', 'const userId = req.user && !anonymous', 6],
  byline: ['src/routes/board.js', 'function byline(viewer, name, anonymous, userId)', 5],
  contact: ['src/routes/public.js', "db.prepare('INSERT INTO messages(", 3],
  media: ['src/uploads.js', 'function saveMedia(files, uploaderId = null)', 7],
  saves: ['src/routes/saves.js', 'db.prepare(`INSERT INTO game_saves', 3],
  volume: ['public/sound.js', "var KEY = 'lautstaerke'", 1],
  musicPrefs: ['public/music.js', "var PREF_KEY = 'musik-player'", 1],
  youtubeKey: ['public/music.js', "var YT = 'https://www.youtube-nocookie.com', YT_KEY", 1],
  tracks: ['src/db.js', 'CREATE TABLE IF NOT EXISTS tracks (', 15],
  playlists: ['src/db.js', 'CREATE TABLE IF NOT EXISTS playlists (', 8],
  plays: ['src/routes/music.js', "db.prepare('UPDATE tracks SET plays = plays + 1", 1],
  lobbyState: ['src/lobby.js', 'function state(l) {', 7],
  oembed: ['src/youtube.js', 'async function oembed(id) {', 4],
};

let cache = null;
function snippets() {
  if (cache) return cache;
  cache = {};
  const files = {};
  for (const [name, [file, find, count]] of Object.entries(SNIPPETS)) {
    try { files[file] ||= fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n'); } catch { files[file] = []; }
    const i = files[file].findIndex(l => l.includes(find));
    if (i < 0) { cache[name] = { file, missing: true }; continue; }
    const lines = files[file].slice(i, i + count);
    const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
    cache[name] = {
      file,
      from: i + 1,
      to: i + lines.length,
      code: lines.map(l => l.slice(indent)).join('\n'),
      url: `${REPO}${file}#L${i + 1}-L${i + lines.length}`,
    };
  }
  return cache;
}

module.exports = { snippets, REPO: REPO.replace(/\/blob\/main\/$/, '') };
