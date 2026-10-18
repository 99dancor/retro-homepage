'use strict';
// Kartenspiele (Startmenü → Spiele und Apps → 🂡 Kartenspiele): ein Programm für alle Kartenspiele. Man eröffnet einen
// Spieltisch, trifft sich dort und der Gastgeber wählt das Spiel; zwischen zwei Runden kann er es wechseln, ohne dass der
// Tisch zugeht. Die Spiele selbst laufen weiter in ihren eigenen Modulen (src/blackjack.js, poker.js, durak.js und über
// src/cardtable.js uno.js, flip7.js, pilli.js). Ein Spieltisch hält immer genau einen Tisch des gewählten Spiels; der zeigt
// mit t.spieltisch zurück und fehlt in den Listen des Spiels selbst. Solange noch keins gewählt ist, ist das ein Tisch der
// „Lobby“ unten, an dem nie gegeben wird.
//
// Spielwechsel: Wer am alten Tisch sitzt, sitzt danach auf demselben Platz am neuen (passt er nicht mehr, auf dem
// nächsten freien). Die offenen Fenster bekommen das Ereignis „switch“ und verbinden sich neu. Geld (Blackjack, Poker)
// kommt aus der gemeinsamen Kasse (src/kasse.js) und geht nach jeder Hand dorthin zurück, bleibt beim Wechsel also beim Spieler.
const crypto = require('node:crypto');
const { getSetting } = require('./db');
const { createGame } = require('./cardtable');
const kasse = require('./kasse');

const MAX_TABLES = 30;

// Treffpunkt ohne Spiel: Plätze, Gastgeber und Zuschauer wie an jedem Tisch, gegeben wird aber nie
const lobby = createGame({
  id: 'lobby', prefix: 'ks', title: 'Spieltisch', tableWord: 'Spieltisch', minSeats: 1, maxSeats: 8, defaultSeats: 4,
  start() {}, act() { return undefined; }, drop() {}, view() {},
});

// Spiele am Spieltisch: Plätze [mindestens, höchstens], Schalter in der Systemsteuerung, Geld aus der Kasse?
const GAMES = {
  lobby: { title: 'Noch kein Spiel', icon: '🂠', seats: [1, 8], engine: lobby },
  blackjack: { title: 'Blackjack', icon: '🃏', seats: [1, 5], flag: 'bj_enabled', money: true, load: () => require('./blackjack') },
  poker: { title: 'Poker', icon: '♠️', seats: [2, 6], flag: 'pk_enabled', money: true, load: () => require('./poker') },
  durak: { title: 'Durak', icon: '🎴', seats: [2, 6], flag: 'dk_enabled', load: () => require('./durak') },
  uno: { title: 'UNO', icon: '🟥', seats: [2, 8], flag: 'uno_enabled', load: () => require('./uno') },
  flip7: { title: 'Flip 7', icon: '7️⃣', seats: [2, 8], flag: 'f7_enabled', load: () => require('./flip7') },
  pilli: { title: 'Pilli Pilli', icon: '🌶️', seats: [2, 8], flag: 'pp_enabled', load: () => require('./pilli') },
};
const engine = id => GAMES[id].engine || (GAMES[id].engine = GAMES[id].load());
const enabled = id => !!GAMES[id] && (!GAMES[id].flag || getSetting(GAMES[id].flag, '1') === '1');
function games() {
  return Object.entries(GAMES).filter(([id]) => enabled(id)).map(([id, g]) => ({ id, title: g.title, icon: g.icon, min: g.seats[0], max: g.seats[1], money: !!g.money }));
}

// Aussehen: Filz und Kartenrücken (die Farben stehen in public/retro.css unter .ks-felt-* und .ks-back-*)
const FELTS = ['gruen', 'blau', 'rot', 'lila', 'schwarz', 'petrol'];
const BACKS = ['klassisch', 'rot', 'blau', 'gruen', 'gold', 'karo', 'retro'];

const tables = new Map();
const clamp = (n, [min, max]) => Math.max(min, Math.min(max, n));
// Läuft gerade eine Runde? Dann darf das Spiel nicht wechseln.
const busy = t => t.phase === 'playing' || t.phase === 'dealer';
const seatedUsers = t => t.seats.map((x, i) => x && { i, user: { id: x.userId, name: x.name, username: x.username } }).filter(Boolean);

function tableOf(s) {
  const t = s && engine(s.game).get(s.tableId);
  if (s && (!t || t.spieltisch !== s)) { tables.delete(s.id); return null; }
  return t;
}
const get = id => { const s = tables.get(String(id)); return s && tableOf(s) ? s : null; };
function seatedAt(userId) {
  for (const s of tables.values()) {
    const t = tableOf(s);
    if (t && t.seats.some(x => x && x.userId === userId)) return s;
  }
  return null;
}
const isHost = (s, user) => { const t = tableOf(s); return !!t && !!user && (user.isAdmin || user.id === t.hostId); };

// Den Tisch eines Spiels für den Spieltisch aufmachen und die Leute hinsetzen
function open(s, game, host, players = []) {
  const E = engine(game), G = GAMES[game];
  const t = E.create(host, { ...(s.opts[game] || {}), name: s.name, hidden: s.hidden, seats: clamp(Math.max(s.seats, players.length), G.seats) });
  if (!t) return 'Gerade gibt es zu viele Tische. Versuch es später noch einmal.';
  t.spieltisch = s;
  if (G.money) t.bank = kasse.bank;
  s.game = game; s.tableId = t.id;
  for (const p of players) E.control(t, p.user, { action: 'sit', seat: p.i < t.seatCount ? p.i : -1 });
  return null;
}

function create(user, b = {}) {
  for (const s of tables.values()) tableOf(s);
  if (tables.size >= MAX_TABLES) return { error: 'Gerade gibt es zu viele Spieltische. Versuch es später noch einmal.' };
  const game = GAMES[b.game] && enabled(b.game) ? b.game : 'lobby';
  const s = {
    id: crypto.randomBytes(5).toString('hex'), name: `Spieltisch von ${user.name}`, hidden: false, seats: 4,
    felt: 'gruen', back: 'klassisch', game, tableId: null, opts: {},
  };
  applySettings(s, b);
  const err = open(s, game, user);
  if (err) return { error: err };
  tables.set(s.id, s);
  return { table: s };
}
function applySettings(s, b) {
  if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim().slice(0, 60);
  if ('hidden' in b) s.hidden = !!b.hidden;
  if (Number(b.seats) >= 1 && Number(b.seats) <= 8) s.seats = Math.floor(Number(b.seats));
  if (FELTS.includes(b.felt)) s.felt = b.felt;
  if (BACKS.includes(b.back)) s.back = b.back;
}

// Was das Fenster über den Spieltisch wissen muss
function meta(s) {
  const t = tableOf(s), G = GAMES[s.game];
  return {
    id: s.id, name: s.name, hidden: s.hidden, seats: s.seats, felt: s.felt, back: s.back,
    game: s.game, title: G.title, icon: G.icon, money: !!G.money, hostId: t.hostId, host: t.hostName, busy: busy(t),
  };
}
function summary(s) {
  const t = tableOf(s), G = GAMES[s.game];
  const seated = t.seats.filter(Boolean);
  const viewers = new Set([...t.clients].map(c => c.user.id).filter(id => !seated.some(x => x.userId === id)));
  return {
    id: s.id, name: s.name, hidden: s.hidden, game: s.game, title: G.title, icon: G.icon, host: t.hostName,
    players: seated.length, seats: t.seatCount, viewers: viewers.size,
    status: s.game === 'lobby' ? 'Wählt gerade ein Spiel' : busy(t) ? 'Runde läuft' : seated.length ? 'Zwischen zwei Runden' : 'Freie Plätze',
  };
}
function list(user) {
  return [...tables.values()].filter(s => {
    const t = tableOf(s);
    return t && (!s.hidden || user.isAdmin || t.hostId === user.id || t.seats.some(x => x && x.userId === user.id));
  }).map(summary).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
}

const send = (t, event, data) => { for (const c of t.clients) c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

// Spiel wechseln (nur der Gastgeber, nur zwischen zwei Runden)
function switchGame(s, user, game) {
  if (!isHost(s, user)) return 'Nur der Gastgeber wählt das Spiel.';
  if (!GAMES[game] || !enabled(game)) return 'Dieses Spiel gibt es gerade nicht.';
  const old = tableOf(s);
  if (game === s.game) return null;
  if (busy(old)) return 'Gerade läuft noch eine Runde. Gewechselt wird danach.';
  const players = seatedUsers(old), G = GAMES[game];
  if (players.length > G.seats[1]) return `${G.title} geht mit höchstens ${G.seats[1]} Spielern, am Tisch sitzen ${players.length}.`;
  const host = { id: old.hostId, name: old.hostName };
  const from = GAMES[s.game].title;
  // Erst die Fenster umlenken, dann den alten Tisch schließen (dabei landet das Geld in der Kasse)
  send(old, 'switch', { game });
  engine(s.game).remove(old);
  const err = open(s, game, host, players);
  if (err) { tables.delete(s.id); return err; }
  const t = tableOf(s);
  t.log.unshift(game === 'lobby' ? `${host.name} hat ${from} beendet.` : `${host.name} hat ${G.title} gewählt.`);
  return null;
}

// Name, Sichtbarkeit, Filz und Kartenrücken; die offenen Fenster bekommen das gleich mit
function settings(s, user, b) {
  if (!isHost(s, user)) return 'Nur der Gastgeber gestaltet den Tisch.';
  applySettings(s, b);
  const t = tableOf(s);
  t.name = s.name; t.hidden = s.hidden;
  announce(s);
  return null;
}
function announce(s) { send(tableOf(s), 'salon', meta(s)); }

function close(s) {
  const t = tableOf(s);
  tables.delete(s.id);
  if (t) engine(s.game).remove(t);
}

// Zug oder Platzwahl am Tisch des gewählten Spiels. Ein paar Dinge regelt der Spieltisch selbst.
function control(s, user, b) {
  const t = tableOf(s), E = engine(s.game);
  const a = String(b.action || '');
  if (a === 'sit') {
    const other = seatedAt(user.id);
    if (other && other !== s) return `Du sitzt schon am Spieltisch „${other.name}“. Steh dort erst auf.`;
  }
  if (a === 'ready' && s.game === 'lobby') return 'Erst wählt der Gastgeber ein Spiel.';
  if (a === 'settings') {
    if (!E.isHost(t, user)) return 'Nur der Gastgeber ändert die Einstellungen.';
    const { action, ...rest } = b;
    if ('hidden' in b) s.hidden = !!b.hidden;
    if (typeof rest.name === 'string' && rest.name.trim()) s.name = rest.name.trim().slice(0, 60);
    const err = E.control(t, user, { ...rest, action });
    if (err) return err;
    const { name, seats, hidden, ...opts } = rest;
    s.opts[s.game] = { ...s.opts[s.game], ...opts };
    s.seats = t.seatCount;
    return null;
  }
  return E.control(t, user, b);
}

module.exports = {
  GAMES, FELTS, BACKS, games, enabled, engine, get, list, create, meta, switchGame, settings, announce, close, control, isHost, seatedAt, tableOf,
  _tables: tables,
};
