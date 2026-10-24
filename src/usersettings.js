'use strict';
// Einstellungen eines Mitglieds, die auf allen Geräten gelten: eine Zeile JSON pro Konto in user_settings.
//   display: Darstellung, wenn „Auf allen meinen Geräten“ gewählt ist (ohne Größe und eigenes Bild, die bleiben pro Gerät)
//   desk:    Desktop (readme.txt gelesen, Lobby-Widget, Suche, ausgeblendete Standardsymbole und ihre Plätze)
//   stats:   wer welche Spielwerte im Profil sieht, ob und wie man in Bestenlisten steht, Vitrine
//   cards:   eigene Ansicht am Kartentisch (Hintergrund und Tischrand, nur für einen selbst)
//   icu:     Messenger (ICU/DSN): Töne, Hinweis „ist jetzt online“, automatisch abwesend, beim Anmelden öffnen
const { db, now } = require('./db');
const { FONTS } = require('./themes');

const HEX = /^#[0-9a-f]{6}$/i;
const pick = (list, v, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const KEY = /^[\w-]{1,40}$/;

// Muss zu public/display.js passen
const DISPLAY = {
  designs: ['98', 'xp'], xp: ['blau', 'oliv', 'silber'], schemes: ['seite', 'nacht', 'kontrast'],
  bgs: ['seite', 'kein', 'bild', 'karo', 'streifen', 'punkte', 'raster', 'wellen'], modes: ['tile', 'cover', 'center'],
  marquee: ['an', 'still', 'aus'], colors: ['desktop', 'win', 'titleFrom', 'titleTo', 'text', 'link'],
};
function cleanDisplay(p) {
  if (!p || typeof p !== 'object') return null;
  const colors = {};
  for (const k of DISPLAY.colors) if (p.colors && HEX.test(p.colors[k])) colors[k] = p.colors[k].toLowerCase();
  return {
    design: pick(DISPLAY.designs, p.design, '98'),
    xp: pick(DISPLAY.xp, p.xp, 'blau'),
    scheme: pick(DISPLAY.schemes, p.scheme, 'seite'),
    colors,
    font: Object.hasOwn(FONTS, p.font) ? p.font : '',
    bg: pick(DISPLAY.bgs, p.bg, 'seite'),
    bgMode: pick(DISPLAY.modes, p.bgMode, 'tile'),
    marquee: pick(DISPLAY.marquee, p.marquee, 'an'),
    widgets: bool(p.widgets, true),
    css: typeof p.css === 'string' ? p.css.slice(0, 20000) : '',
    // Zeitpunkt der Änderung: Das neuere von Konto und Browser gewinnt
    t: Number.isFinite(p.t) ? Math.floor(p.t) : Date.now(),
  };
}

// hidden: ausgeblendete Standardsymbole (auch die gelöschte readme.txt), pos: deren Plätze auf dem Raster,
// arrange: frei (wo man sie hinzieht) oder automatisch nach Name bzw. Art
const DESK = { readmeSeen: 0, lobbies: true, search: true, arrange: 'frei', hidden: [], pos: {} };
function cleanDesk(p) {
  p = p && typeof p === 'object' ? p : {};
  const pos = {};
  if (p.pos && typeof p.pos === 'object') {
    for (const [k, v] of Object.entries(p.pos).slice(0, 100)) {
      if (KEY.test(k) && Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= 0 && n < 200)) pos[k] = v;
    }
  }
  return {
    readmeSeen: Number.isInteger(p.readmeSeen) && p.readmeSeen >= 0 ? p.readmeSeen : 0,
    lobbies: bool(p.lobbies, true),
    search: bool(p.search, true),
    arrange: pick(['frei', 'name', 'typ'], p.arrange, 'frei'),
    hidden: Array.isArray(p.hidden) ? [...new Set(p.hidden.filter(k => typeof k === 'string' && KEY.test(k)))].slice(0, 50) : [],
    pos,
  };
}

// Wer sieht einen Spielwert im Profil, und wie steht man in Bestenlisten
const SEE = { profil: 'Wie das Profil', members: 'Angemeldete', friends: 'Nur Freunde', private: 'Nur ich' };
const BOARD = { name: 'Mit Namen', anon: 'Anonym', off: 'Gar nicht' };
const SITE = { posts: 'Forenbeiträge und -themen', guestbook: 'Einträge im Besucherbuch', tracks: 'Hochgeladene Musik', friends: 'Freunde', recent: 'Zuletzt im Forum' };
const STAT_KEY = /^[^\u0000-\u001f<>]{1,60}$/;
function cleanStats(p) {
  p = p && typeof p === 'object' ? p : {};
  const games = {};
  if (p.games && typeof p.games === 'object') {
    for (const [slug, g] of Object.entries(p.games).slice(0, 200)) {
      if (!KEY.test(slug) || !g || typeof g !== 'object') continue;
      games[slug] = {
        see: pick(Object.keys(SEE), g.see, 'profil'),
        board: pick(Object.keys(BOARD), g.board, 'name'),
        hide: Array.isArray(g.hide) ? [...new Set(g.hide.filter(k => typeof k === 'string' && STAT_KEY.test(k)))].slice(0, 60) : [],
        order: Number.isInteger(g.order) && g.order >= 0 && g.order < 1000 ? g.order : null,
      };
    }
  }
  const showcase = Array.isArray(p.showcase) ? p.showcase.filter(s => s && KEY.test(s.app) && typeof s.key === 'string' && STAT_KEY.test(s.key))
    .map(s => ({ app: s.app, key: s.key })).slice(0, 4) : [];
  const site = {};
  for (const k of Object.keys(SITE)) site[k] = bool(p.site && p.site[k], true);
  return { games, showcase, auto: bool(p.auto, true), site };
}

// Spiele mit Bestenliste: dort wählt jeder, ob er mit Namen, anonym oder gar nicht erscheint
const BOARD_GAMES = {
  kartenspiele: 'Kartenspiele (Kasse)', blackjack: 'Blackjack', poker: 'Poker', durak: 'Durak', uno: 'UNO', flip7: 'Flip 7', pilli: 'Pilli Pilli',
  minesweeper: 'Minesweeper', kreuzwortraetsel: 'Kreuzworträtsel', sudoku: 'Sudoku', haustier: 'Pixelpfoten (Wettbewerb)',
};

// Eigene Ansicht am Kartentisch: Hintergrund um den Tisch (die Farben stehen in public/retro.css unter .ks-floor-*) und
// ein Holzrand statt dem des Gastgebers ('' = wie der Gastgeber; ob man ihn hat, prüft src/routes/kartenspiele.js)
const CARD_FLOORS = { lounge: 'Lounge (dunkles Holz)', parkett: 'Parkett', teppich: 'Casino-Teppich', fliesen: 'Fliesen', nacht: 'Nachthimmel', desktop: 'Wie mein Desktop' };
function cleanCards(p) {
  p = p && typeof p === 'object' ? p : {};
  return { floor: pick(Object.keys(CARD_FLOORS), p.floor, 'lounge'), wood: typeof p.wood === 'string' && KEY.test(p.wood) ? p.wood : '' };
}

// Messenger-Töne (public/sound.js, msgr-*): „klassisch“ klingt je nach Design wie ICU oder wie DSN
const ICU_SOUNDS = { klassisch: 'Wie das Design (ICU oder DSN)', pling: 'Pling', glocke: 'Glocke', tuer: 'Tür auf', summen: 'Summen', aus: '(Kein Ton)' };
const ICU_AWAY = [0, 5, 10, 15, 30, 60];
function cleanIcu(p) {
  p = p && typeof p === 'object' ? p : {};
  const snd = p.sounds && typeof p.sounds === 'object' ? p.sounds : {};
  const tone = (v, d) => pick(Object.keys(ICU_SOUNDS), v, d);
  return {
    sounds: { msg: tone(snd.msg, 'klassisch'), online: tone(snd.online, 'tuer'), nudge: tone(snd.nudge, 'summen') },
    toast: bool(p.toast, true),            // Hinweis unten rechts, wenn ein Freund online kommt
    quietDnd: bool(p.quietDnd, true),      // bei „Nicht stören“ keine Töne und Hinweise
    autostart: bool(p.autostart, false),   // Messenger öffnet sich mit dem Desktop
    away: ICU_AWAY.includes(p.away) ? p.away : 10,  // nach so vielen Minuten ohne Maus und Tastatur „abwesend“ (0 = nie)
  };
}

const CLEAN = { display: cleanDisplay, desk: cleanDesk, stats: cleanStats, cards: cleanCards, icu: cleanIcu };

function readAll(userId) {
  const r = db.prepare('SELECT data FROM user_settings WHERE user_id = ?').get(userId);
  try { return r ? JSON.parse(r.data) || {} : {}; } catch { return {}; }
}
// Ein Bereich, bereinigt; display ist null, solange die Darstellung nur im Browser liegt
function get(userId, section) {
  if (!userId) return CLEAN[section](null);
  const all = readAll(userId);
  return CLEAN[section](all[section]);
}
// value null entfernt den Bereich (z. B. Darstellung wieder nur im Browser)
function set(userId, section, value) {
  const all = readAll(userId);
  const clean = value === null ? null : CLEAN[section](value);
  if (clean === null) delete all[section]; else all[section] = clean;
  db.prepare(`INSERT INTO user_settings(user_id, data, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(userId, JSON.stringify(all), now());
  return clean;
}
// Die Statistik-Einstellungen vieler Konten auf einmal (für Bestenlisten)
function statsOf(userIds) {
  const ids = [...new Set(userIds.filter(Number.isInteger))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    for (const r of db.prepare(`SELECT user_id, data FROM user_settings WHERE user_id IN (${part.map(() => '?').join(',')})`).all(...part)) {
      try { const d = JSON.parse(r.data); if (d && d.stats) out.set(r.user_id, cleanStats(d.stats)); } catch { /* kaputt = Vorgaben */ }
    }
  }
  return out;
}

// Eigene Reihenfolge zuerst, sonst wie bisher (zuletzt gespielt oben)
function orderGames(games, s) {
  const o = g => (s.games[g.slug] && s.games[g.slug].order !== null && s.games[g.slug].order !== undefined ? s.games[g.slug].order : 1e6);
  return games.slice().sort((a, b) => o(a) - o(b) || b.last - a.last);
}

// Was viewer im Profil von ownerId sieht. Der Besitzer sieht alles, Ausgeblendetes grau (hidden), und kann sich
// das Profil als Gast, Mitglied oder Freund ansehen (preview). Auch der Admin sieht nur, was ein Mitglied sieht.
function profileView(ownerId, viewer, games, preview) {
  const s = get(ownerId, 'stats');
  const self = !!viewer && viewer.id === ownerId;
  const rel = self && ['guest', 'member', 'friend'].includes(preview) ? preview
    : self ? 'self' : !viewer ? 'guest' : require('./auth').isFriend(viewer.id, ownerId) ? 'friend' : 'member';
  const allowed = see => see === 'profil' || (see === 'members' && rel !== 'guest') || (see === 'friends' && rel === 'friend');
  const out = [];
  for (const g of orderGames(games, s)) {
    const c = s.games[g.slug] || { see: s.auto ? 'profil' : 'private', hide: [] };
    if (rel !== 'self' && !allowed(c.see)) continue;
    const stats = g.stats.map(st => ({ ...st, hidden: c.hide.includes(st.key) })).filter(st => rel === 'self' || !st.hidden);
    if (!stats.length) continue;
    // Der Besitzer sieht alles; grau ist, was nur er sieht
    out.push({ ...g, stats, hiddenGame: rel === 'self' && c.see === 'private', see: c.see });
  }
  const showcase = [];
  for (const p of s.showcase) {
    const g = out.find(x => x.slug === p.app), st = g && g.stats.find(x => x.key === p.key);
    if (st && (rel === 'self' || !st.hidden)) showcase.push({ app: g.slug, title: g.title, url: g.url, key: st.key, value: st.value, text: st.text, cls: st.cls });
  }
  const site = rel === 'self' ? Object.fromEntries(Object.keys(SITE).map(k => [k, true])) : s.site;
  return { games: out, showcase, site, siteSettings: s.site, rel };
}

// ---------- Bestenlisten ----------
// Wie jemand in der Bestenliste eines Spiels steht: name (Standard), anon oder off
function boardModes(slug, userIds) {
  const map = statsOf(userIds), out = new Map();
  for (const id of userIds) { const s = map.get(id), c = s && s.games[slug]; out.set(id, c ? c.board : 'name'); }
  return out;
}
const boardMode = (slug, userId) => boardModes(slug, [userId]).get(userId);
// Name in „… hat deinen Rekord geknackt“: Wer anonym oder gar nicht in der Bestenliste steht, heißt dort „Jemand“
const recordName = (slug, userId, name) => (boardMode(slug, userId) === 'name' ? name : 'Jemand');
// Bestenliste aus Konten (Zeilen mit id, username, display_name, avatar, disabled, profile_visibility): „Gar nicht“ fällt raus.
// Anonym erscheint, wer das so gewählt hat oder sein Profil vor dem Betrachter verbirgt: ohne Namen, Konto, Bild und id.
// Der Betrachter selbst sieht sich mit Namen, bei „Anonym“ mit dem Zusatz „(anonym)“. Ergebnis: Zeilen mit name, user, avatar, id.
function boardList(slug, rows, viewer) {
  const profiles = require('./profiles');
  const modes = boardModes(slug, rows.map(r => r.id)), out = [];
  for (const r of rows) {
    const mode = modes.get(r.id), self = !!viewer && viewer.id === r.id;
    if (mode === 'off' || (r.disabled && !(viewer && viewer.isAdmin))) continue;
    if (self || (mode !== 'anon' && profiles.canViewProfile(viewer, r))) {
      out.push({ ...r, name: profiles.displayName(r) + (self && mode === 'anon' ? ' (anonym)' : ''), user: r.username });
    } else out.push({ ...r, name: 'Anonym', user: null, username: null, display_name: null, avatar: null, id: null, anon: true });
  }
  return out;
}

module.exports = {
  ICU_SOUNDS, ICU_AWAY, get, set, statsOf, cleanDisplay, cleanDesk, cleanStats, cleanCards, CARD_FLOORS, orderGames, profileView, boardModes, boardMode, recordName, boardList, DESK, SEE, BOARD, SITE, DISPLAY, BOARD_GAMES };
