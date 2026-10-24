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
const { db, getSetting } = require('./db');
const { createGame } = require('./cardtable');
const kasse = require('./kasse');

const MAX_TABLES = 30;

// Treffpunkt ohne Spiel: Plätze, Gastgeber und Zuschauer wie an jedem Tisch, gegeben wird aber nie
const lobby = createGame({
  id: 'lobby', prefix: 'ks', title: 'Spieltisch', tableWord: 'Spieltisch', minSeats: 1, maxSeats: 8, defaultSeats: 4,
  start() {}, act() { return undefined; }, drop() {}, view() {},
});

// Spiele am Spieltisch: Plätze [mindestens, höchstens], Schalter in der Seitenverwaltung, Geld aus der Kasse?
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

// Aussehen: Holzrand, Filz und Kartenrücken (die Farben stehen in public/retro.css unter .ks-wood-*, .ks-felt-* und
// .ks-back-*). Die ersten hat jeder, die anderen kauft der Gastgeber im Shop (src/kasse.js).
const ofKind = kind => Object.keys(kasse.SHOP).filter(id => kasse.SHOP[id].kind === kind);
const WOODS = ofKind('wood'), FELTS = ofKind('felt'), BACKS = ofKind('back');
const LOOKS = { wood: 'Den Tischrand', felt: 'Den Filz', back: 'Den Kartenrücken' };
const looks = () => Object.fromEntries(['wood', 'felt', 'back'].map(k => [k, ofKind(k).map(id => ({ id, title: kasse.SHOP[id].title, price: kasse.SHOP[id].price }))]));

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
    felt: 'gruen', back: 'klassisch', wood: 'eiche', game, tableId: null, opts: {},
  };
  applySettings(s, b, user);
  const err = open(s, game, user);
  if (err) return { error: err };
  tables.set(s.id, s);
  return { table: s };
}
function applySettings(s, b, user) {
  if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim().slice(0, 60);
  if ('hidden' in b) s.hidden = !!b.hidden;
  if (Number(b.seats) >= 1 && Number(b.seats) <= 8) s.seats = Math.floor(Number(b.seats));
  if (FELTS.includes(b.felt) && kasse.owns(user.id, b.felt)) s.felt = b.felt;
  if (BACKS.includes(b.back) && kasse.owns(user.id, b.back)) s.back = b.back;
  if (WOODS.includes(b.wood) && kasse.owns(user.id, b.wood)) s.wood = b.wood;
}

// ---------- Was an den Plätzen zu sehen ist ----------
// Avatar, Getränk in der Ablage, Glücksbringer und mit dem Körbchen das Pixelpfoten-Tier (aus dem gespeicherten Spielstand)
let pp = null;
function petArt() {
  pp ||= {
    state: require('../games/haustier/src/js/state.js'), pets: require('../games/haustier/src/js/pets.js'),
    items: require('../games/haustier/src/js/items.js'), art: require('../games/haustier/src/js/art.js'),
  };
  return pp;
}
function petOf(userId) {
  const row = db.prepare("SELECT data FROM game_saves WHERE user_id = ? AND app_slug = 'haustier' AND slot = 'main'").get(userId);
  if (!row) return null;
  try {
    const { state, pets, items, art } = petArt();
    const save = state.migrate(JSON.parse(row.data));
    if (!save || !save.pets || !save.pets.length) return null;
    // Das Tier mit der höchsten Stufe kommt mit an den Tisch
    const p = save.pets.reduce((a, x) => (pets.level(x) > pets.level(a) ? x : a));
    if (!pets.SPECIES[p.species]) return null;
    const acc = {};
    for (const [slot, id] of Object.entries(p.acc || {})) if (items.ITEMS[id] && items.ITEMS[id].slot === slot) acc[slot] = id;
    return { name: String(p.name || '').slice(0, 30), svg: art.petSvg(p.species, p.color, p.sleeping ? 'sleep' : 'happy', { acc, shadow: false }) };
  } catch { return null; }
}
const shopItem = id => (id && kasse.SHOP[id] ? { id, icon: kasse.SHOP[id].icon, title: kasse.SHOP[id].title, pet: !!kasse.SHOP[id].pet } : null);
function avatarOf(userId) {
  const u = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId);
  return u && u.avatar ? '/avatar/' + u.avatar : null;
}
// Hat jemand am Spieltisch s eine Runde geschmissen, steht dessen Getränk bei allen, solange der Tisch offen ist
function deco(userId, s) {
  const l = kasse.loadout(userId), round = s && s.rounds && s.rounds[userId];
  const charm = shopItem(l.charm);
  return {
    avatar: avatarOf(userId), drink: round ? { ...shopItem(round.item), from: round.from } : shopItem(l.drink), coaster: shopItem(l.coaster),
    charm, pet: charm && kasse.SHOP[charm.id].pet ? petOf(userId) : null,
  };
}

// Was das Fenster über den Spieltisch wissen muss
function meta(s) {
  const t = tableOf(s), G = GAMES[s.game];
  return {
    id: s.id, name: s.name, hidden: s.hidden, seats: s.seats, felt: s.felt, back: s.back, wood: s.wood,
    deco: Object.fromEntries(t.seats.filter(Boolean).map(x => [x.userId, deco(x.userId, s)])),
    game: s.game, title: G.title, icon: G.icon, money: !!G.money, hostId: t.hostId, host: t.hostName, busy: busy(t),
  };
}
function summary(s) {
  const t = tableOf(s), G = GAMES[s.game];
  const seated = t.seats.filter(Boolean);
  const viewers = new Set([...t.clients].map(c => c.user.id).filter(id => !seated.some(x => x.userId === id)));
  return {
    id: s.id, name: s.name, hidden: s.hidden, game: s.game, title: G.title, icon: G.icon, host: t.hostName, felt: s.felt, wood: s.wood,
    players: seated.length, seats: t.seatCount, viewers: viewers.size, live: busy(t),
    // Für die Karte in der Tischliste: wer auf welchem Platz sitzt
    faces: t.seats.map(x => x && { id: x.userId, name: x.name, avatar: avatarOf(x.userId) }),
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

// Name, Sichtbarkeit, Holz, Filz und Kartenrücken; die offenen Fenster bekommen das gleich mit
function settings(s, user, b) {
  if (!isHost(s, user)) return 'Nur der Gastgeber gestaltet den Tisch.';
  if (b.wood && !WOODS.includes(b.wood)) return 'Diesen Tischrand gibt es nicht.';
  for (const [k, what] of Object.entries(LOOKS)) {
    if (b[k] && b[k] !== s[k] && kasse.SHOP[b[k]] && kasse.SHOP[b[k]].kind === k && !kasse.owns(user.id, b[k])) return `${what} „${kasse.SHOP[b[k]].title}“ musst du erst im Shop kaufen.`;
  }
  applySettings(s, b, user);
  const t = tableOf(s);
  t.name = s.name; t.hidden = s.hidden;
  announce(s);
  return null;
}
function announce(s) { send(tableOf(s), 'salon', meta(s)); }

// Shop am Tisch: Liegt das Geld gerade als Chips an einem Geldtisch, wird dort bezahlt. Danach sehen alle am Tisch,
// was neu am Platz steht.
function buy(user, item) {
  const s = seatedAt(user.id), t = s && tableOf(s);
  const seat = t && GAMES[s.game].money ? t.seats.find(x => x && x.userId === user.id) : null;
  const err = kasse.buy(user.id, item, seat ? seat.chips : undefined);
  if (err) return err;
  // Der Einkauf ist kein Verlust am Tisch: Mitgebrachtes sinkt mit, die Bilanz der Sitzung bleibt
  if (seat) { const price = kasse.price(item); seat.chips -= price; seat.bought -= price; engine(s.game).broadcast(t); }
  if (s) announce(s);
  return null;
}
function equip(user, item, kind) {
  const err = kasse.equip(user.id, item, kind);
  if (err) return err;
  const s = seatedAt(user.id);
  if (s) announce(s);
  return null;
}

// Schnell spielen: an den vollsten Tisch mit freiem Platz im gewünschten Spiel (oder irgendeinem), sonst einen aufmachen.
// Wer schon sitzt, kommt an seinen Tisch zurück.
function quick(user, game) {
  const mine = seatedAt(user.id);
  if (mine) return { table: mine };
  const want = game && game !== 'egal' ? game : null;
  if (want && (!GAMES[want] || want === 'lobby' || !enabled(want))) return { error: 'Dieses Spiel gibt es gerade nicht.' };
  const free = [...tables.values()].map(s => [s, tableOf(s)]).filter(([s, t]) => t && !s.hidden && (!want || s.game === want) && t.seats.some(x => !x))
    .sort(([, a], [, b]) => b.seats.filter(Boolean).length - a.seats.filter(Boolean).length);
  if (free.length) return { table: free[0][0] };
  return create(user, { game: want || 'lobby' });
}

// Eine Runde für alle am Tisch: jeder bekommt das Getränk hingestellt, solange der Spieltisch offen ist. Bezahlt wird wie
// im Shop (am Geldtisch mit den Chips) und zählt nicht als Verlust.
function round(user, item) {
  const s = seatedAt(user.id), t = s && tableOf(s);
  if (!t) return 'Setz dich erst an einen Spieltisch.';
  const it = kasse.SHOP[item];
  if (!it || it.kind !== 'drink' || !it.price) return 'Dieses Getränk gibt es nicht als Runde.';
  const players = t.seats.filter(Boolean);
  if (players.length < 2) return 'Eine Runde lohnt sich erst, wenn noch jemand am Tisch sitzt.';
  const total = kasse.price(item) * players.length;
  const seat = GAMES[s.game].money ? players.find(x => x.userId === user.id) : null;
  const err = kasse.spend(user.id, total, seat ? seat.chips : undefined);
  if (err) return err;
  if (seat) { seat.chips -= total; seat.bought -= total; }
  s.rounds = s.rounds || {};
  for (const p of players) s.rounds[p.userId] = { item, from: user.name };
  t.log.unshift(`${user.name} schmeißt eine Runde ${it.title} für alle.`);
  engine(s.game).broadcast(t);
  announce(s);
  send(t, 'fx', { kind: 'round', uid: user.id, icon: it.icon });
  return null;
}

// Leben am Tisch, nur für den Augenblick (nichts wird gespeichert): Reaktionen, Anstoßen, fremde Tiere streicheln.
// Alle offenen Fenster bekommen „fx“ und zeigen es am Platz an.
const EMOTES = ['👏', '😂', '😮', '😡', '🍀', '🫡'];
const WAIT = { emote: 3000, cheers: 2000, pet: 1500 };
const FX = Object.keys(WAIT);
const CHEERS = 8000;
function fx(s, user, b) {
  const t = tableOf(s), kind = String(b.action || '');
  const seated = t.seats.some(x => x && x.userId === user.id);
  if (kind !== 'pet' && !seated) return 'Setz dich erst an den Tisch.';
  s.fxAt = s.fxAt || new Map();
  const key = kind + ':' + user.id, at = Date.now();
  if (at - (s.fxAt.get(key) || 0) < WAIT[kind]) return 'Nicht so schnell.';
  let msg;
  if (kind === 'emote') {
    if (!EMOTES.includes(b.emoji)) return 'Diese Reaktion gibt es nicht.';
    msg = { kind, uid: user.id, emoji: b.emoji };
  } else if (kind === 'cheers') {
    // Wer kurz nach dem ersten Glas auch anstößt, stößt mit an
    const join = !!s.cheers && at - s.cheers.at < CHEERS && s.cheers.uid !== user.id;
    if (!join) s.cheers = { at, uid: user.id };
    msg = { kind, uid: user.id, join };
  } else if (kind === 'pet') {
    const owner = Number(b.uid), x = t.seats.find(y => y && y.userId === owner);
    const charm = x && kasse.loadout(owner).charm;
    if (!charm || !kasse.SHOP[charm].pet) return 'Hier sitzt kein Tier.';
    msg = { kind, uid: owner, by: user.id };
  } else return 'Unbekannte Aktion.';
  s.fxAt.set(key, at);
  send(t, 'fx', msg);
  return null;
}

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
  GAMES, FELTS, BACKS, WOODS, EMOTES, FX, games, looks, pet: petOf, buy, equip, deco, enabled, engine, get, list, create, quick, round, fx, meta, switchGame, settings, announce, close, control, isHost, seatedAt, tableOf,
  _tables: tables,
};
