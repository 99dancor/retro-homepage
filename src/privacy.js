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
  guide: ['public/guide.js', "var KEY = 'rundgang-gesehen'", 1],
  editor: ['public/editor.js', "var MODE_KEY = 'editor-mode'", 1],
  pet: ['games/haustier/src/js/storage.js', "const PREFIX = 'haustier:v1:'", 7],
  users: ['src/db.js', 'CREATE TABLE IF NOT EXISTS users (', 16],
  password: ['src/auth.js', 'function hashPassword(pw)', 1],
  guestbook: ['src/routes/public.js', 'const userId = req.user && !anonymous', 6],
  notifications: ['src/db.js', 'CREATE TABLE IF NOT EXISTS notifications (', 12],
  pushSubs: ['src/db.js', 'CREATE TABLE IF NOT EXISTS push_subs (', 10],
  pushEncrypt: ['src/webpush.js', 'function encrypt(payload, p256dh, authSecret) {', 15],
  petwatch: ['src/petwatch.js', 'function check(userId, data, t = Date.now()) {', 9],
  boardSubs: ['src/db.js', 'CREATE TABLE IF NOT EXISTS board_subs (', 6],
  boardViews: ['src/routes/board.js', 'function countView(req, topicId) {', 6],
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
  profileVis: ['src/profiles.js', 'function canViewProfile(viewer, target)', 7],
  profileCounts: ['src/routes/profiles.js', '// Anonyme Beiträge zählen nicht mit', 5],
  avatarStrip: ['src/profiles.js', '// APP1 (EXIF, XMP), APP13 (IPTC) und Kommentare fallen weg', 3],
  friends: ['src/db.js', 'CREATE TABLE IF NOT EXISTS friends (', 7],
  pms: ['src/db.js', 'CREATE TABLE IF NOT EXISTS private_messages (', 10],
  pmDelete: ['src/profiles.js', 'function hideConversation(meId, otherId)', 7],
  profileGuestbook: ['src/db.js', 'CREATE TABLE IF NOT EXISTS profile_guestbook (', 7],
  gameStats: ['src/db.js', 'CREATE TABLE IF NOT EXISTS game_stats (', 8],
  countStart: ['src/profiles.js', 'function countStart(user, app)', 5],
  ksWallets: ['src/db.js', 'CREATE TABLE IF NOT EXISTS ks_wallets (', 8],
  ksMeta: ['src/kartenspiele.js', 'function meta(s) {', 8],
  bjSessions: ['src/db.js', 'CREATE TABLE IF NOT EXISTS bj_sessions (', 18],
  msGames: ['src/db.js', 'CREATE TABLE IF NOT EXISTS ms_games (', 11],
  msRunning: ['src/minesweeper.js', 'function start(userId, b) {', 6],
  msPrefs: ['public/minesweeper.js', "var KEY = 'minesweeper';", 2],
  cwProgress: ['src/db.js', 'CREATE TABLE IF NOT EXISTS cw_progress (', 13],
  cwSave: ['src/crossword.js', 'function save(userId, day, { letters, seconds }) {', 6],
  cwLocal: ['public/crossword.js', "var KEY = 'kreuzwortraetsel';", 2],
  bjState: ['src/blackjack.js', 'function state(t) {', 12],
  pkSessions: ['src/db.js', 'CREATE TABLE IF NOT EXISTS pk_sessions (', 16],
  pkState: ['src/poker.js', 'function state(t, viewerId) {', 16],
  dkResults: ['src/db.js', 'CREATE TABLE IF NOT EXISTS dk_results (', 11],
  dkState: ['src/durak.js', 'function state(t, viewerId) {', 15],
  cgResults: ['src/db.js', 'CREATE TABLE IF NOT EXISTS cg_results (', 15],
  cgState: ['src/cardtable.js', 'function state(t, viewerId) {', 15],
  unoView: ['src/uno.js', 'function view(t, me, out) {', 8],
  artworks: ['src/db.js', 'CREATE TABLE IF NOT EXISTS artworks (', 13],
  artworkSee: ['src/paint.js', 'function canSee(user, a) {', 7],
  paintPrefs: ['public/paint.js', "var PREF_KEY = 'paint'", 1],
  wallpaper: ['public/display.js', 'function setWallpaper(img, mode) {', 11],
  artworkDraft: ['src/db.js', "addColumn('artworks', 'draft'", 1],
  artworkPainters: ['src/db.js', 'CREATE TABLE IF NOT EXISTS artwork_painters (', 6],
  ppVisits: ['src/db.js', 'CREATE TABLE IF NOT EXISTS pp_visits (', 11],
  ppAllowed: ['src/pixelpfoten.js', 'function allowed(viewer, host, s) {', 8],
  ppLive: ['src/pixelpfoten.js', 'function update(viewer, username, b) {', 10],
  ppContest: ['src/db.js', 'CREATE TABLE IF NOT EXISTS pp_contest (', 11],
  paintCursor: ['src/paintlobby.js', 'function cursor(l, user, sid, b) {', 5],
  paintChat: ['src/paintlobby.js', 'function chat(l, user, text) {', 10],
  quizCookie: ['src/routes/quiz.js', "res.cookie('quiz', t", 1],
  quizGuest: ['public/quiz.js', "localStorage.setItem('quiz-gast'", 1],
  quizPlayer: ['src/quiz.js', 'r.players.set(who.pid, {', 8],
  quizInput: ['src/quiz.js', 'function sendInput(r, pid, text) {', 4],
  quizSaved: ['src/db.js', 'CREATE TABLE IF NOT EXISTS quizzes (', 10],
  quizGames: ['src/db.js', 'CREATE TABLE IF NOT EXISTS quiz_games (', 11],
  quizResults: ['src/db.js', 'CREATE TABLE IF NOT EXISTS quiz_results (', 10],
  wwCookie: ['src/routes/werwolf.js', "res.cookie('werwolf', t", 1],
  wwGuest: ['public/werwolf.js', "store('werwolf-gast'", 1],
  wwPlayer: ['src/werwolf.js', 'r.players.set(who.pid, {', 8],
  wwView: ['src/werwolf.js', 'function roleVisible(r, me, q) {', 8],
  wwChat: ['src/werwolf.js', 'function chat(r, p, b) {', 10],
  wwResults: ['src/db.js', 'CREATE TABLE IF NOT EXISTS ww_results (', 12],
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
