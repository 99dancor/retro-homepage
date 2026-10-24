'use strict';
// Durak (Startmenü → Spiele und Apps → 🎴 Durak): klassischer „Podkidnoy“ (Zuwerfen) mit 36 Karten an Tischen für
// 2 bis 6 Mitglieder. Die Tische leben wie bei Poker nur im Arbeitsspeicher und schicken Änderungen per Server-Sent
// Events; gemischt und gegeben wird nur hier. Jeder Browser bekommt seinen eigenen Zustand (state(t, viewerId)) und darin
// nur die eigenen Handkarten, von allen anderen nur die Anzahl. Gespielt wird ohne Geld.
//
// Ablauf eines Angriffs: Der Angreifer legt eine Karte, der Spieler links von ihm verteidigt. Alle anderen dürfen Karten
// mit einem Wert zuwerfen, der schon auf dem Tisch liegt (höchstens 6, im ersten Angriff 5, und nie mehr, als der
// Verteidiger Karten hat). Schlägt der Verteidiger alles und wirft niemand mehr zu, kommen die Karten weg und er greift als
// Nächster an. Nimmt er, wandert alles auf seine Hand und der Spieler links von ihm greift an. Danach ziehen alle auf
// sechs Karten nach, der Verteidiger zuletzt. Wer bei leerem Stapel keine Karten mehr hat, ist raus; wer am Ende als
// Einziger noch Karten hat, ist der Durak („Dummkopf“).
//
// Gespeichert wird nur das Ergebnis jedes Spiels (dk_results): Platz, ob Durak, ob aufgestanden.
const crypto = require('node:crypto');
const { db, now, getSetting } = require('./db');

const MAX_TABLES = 30;
const MAX_SEATS = 6;
const HAND = 6;
const EMPTY_MS = 10 * 60 * 1000;   // leere Tische verschwinden nach 10 Minuten
const AWAY_MS = 90 * 1000;         // wer so lange kein Fenster mehr offen hat, steht nach dem Spiel auf
const START_MS = 3000;             // alle bereit → kurz warten, dann wird gegeben
const OFFLINE_S = 3;               // Bedenkzeit für Spieler ohne offenes Fenster
const END_MS = 900;                // kurz zeigen, wie der Angriff ausgegangen ist
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const int = (v, d, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
function config() {
  const turn = int(getSetting('dk_turn'), 30, 5, 300);
  // Zum Zuwerfen reicht die halbe Zeit, sonst wartet der Tisch bei jedem Angriff lange auf „Fertig“
  return { turn, pass: Math.max(5, Math.ceil(turn / 2)) };
}

// ---------- Karten ----------
const value = c => RANKS.indexOf(c.r);
const id = c => c.r + c.s;
function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
// Schlägt d die Karte a? Höher in derselben Farbe, oder Trumpf auf eine Nicht-Trumpf-Karte
const beats = (a, d, trump) => (d.s === a.s && value(d) > value(a)) || (d.s === trump && a.s !== trump);

// ---------- Ergebnisse in der Datenbank ----------
function userTotals(userId) {
  return db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(place = 1 AND durak = 0), 0) AS wins, COALESCE(SUM(durak), 0) AS duraks,
                     COALESCE(SUM(quit), 0) AS quits, MAX(ended_at) AS last FROM dk_results WHERE user_id = ?`).get(userId);
}
function recentGames(userId, limit = 10) {
  return db.prepare('SELECT * FROM dk_results WHERE user_id = ? ORDER BY ended_at DESC, id DESC LIMIT ?').all(userId, limit);
}
function leaderboard() {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility,
                     COUNT(*) AS games, SUM(r.place = 1 AND r.durak = 0) AS wins, SUM(r.durak) AS duraks
                     FROM dk_results r JOIN users u ON u.id = r.user_id WHERE u.disabled = 0
                     GROUP BY u.id ORDER BY wins DESC, (1.0 * duraks / games), games DESC`).all();
}
function resetStats(userId) {
  if (userId) db.prepare('DELETE FROM dk_results WHERE user_id = ?').run(userId);
  else db.prepare('DELETE FROM dk_results').run();
}

// ---------- Tische ----------
const tables = new Map();

function create(user, opts) {
  if (tables.size >= MAX_TABLES) cleanup(true);
  if (tables.size >= MAX_TABLES) return null;
  const t = {
    id: crypto.randomBytes(5).toString('hex'), hostId: user.id, hostName: user.name,
    name: '', hidden: false, seatCount: 4,
    seats: Array(MAX_SEATS).fill(null), clients: new Set(), emptySince: Date.now(),
    phase: 'waiting', game: 0, deck: [], trump: null, discard: 0,
    table: [], limit: HAND, attacker: -1, defender: -1, taking: false, passed: new Set(), bouts: 0,
    turn: null, places: 0, result: null, lastDurak: 0, timer: null, log: [], version: 0,
  };
  applySettings(t, { name: `Duraktisch von ${user.name}`, ...opts });
  tables.set(t.id, t);
  return t;
}
function applySettings(t, b) {
  if (typeof b.name === 'string' && b.name.trim()) t.name = b.name.trim().slice(0, 60);
  if ('hidden' in b) t.hidden = !!b.hidden;
  const n = Number(b.seats);
  // Weniger Plätze nur, wenn die wegfallenden frei sind
  if (n >= 2 && n <= MAX_SEATS && t.seats.slice(n).every(s => !s)) t.seatCount = n;
}

const get = tid => tables.get(String(tid)) || null;
const seated = t => t.seats.filter(Boolean);
const seatOf = (t, userId) => t.seats.find(s => s && s.userId === userId) || null;
const isHost = (t, user) => !!user && (user.isAdmin || user.id === t.hostId);
function tableOf(userId) {
  for (const t of tables.values()) if (seatOf(t, userId)) return t;
  return null;
}
function online(t, userId) { for (const c of t.clients) if (c.user.id === userId) return true; return false; }
function viewers(t) {
  const users = new Map();
  for (const c of t.clients) if (!seatOf(t, c.user.id)) users.set(c.user.id, c.user);
  return [...users.values()].map(u => ({ id: u.id, name: u.name, user: u.username })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
function log(t, text) { t.log.unshift(text); t.log.length = Math.min(t.log.length, 40); }

const playing = t => t.phase === 'playing';
const active = s => s && s.inGame && !s.place;               // spielt noch (hat Karten oder kann nachziehen)
// Nächster Platz nach i (im Uhrzeigersinn = nach links), für den test(seat) gilt
function nextIndex(t, i, test = active) {
  for (let k = 1; k <= t.seatCount; k++) {
    const j = (((i + k) % t.seatCount) + t.seatCount) % t.seatCount;
    if (t.seats[j] && test(t.seats[j])) return j;
  }
  return -1;
}
function prevIndex(t, i, test = active) {
  for (let k = 1; k <= t.seatCount; k++) {
    const j = (((i - k) % t.seatCount) + t.seatCount) % t.seatCount;
    if (t.seats[j] && test(t.seats[j])) return j;
  }
  return -1;
}

function summary(t) {
  const n = seated(t).length;
  return {
    id: t.id, name: t.name, host: t.hostName, hidden: t.hidden, players: n, seats: t.seatCount, viewers: viewers(t).length,
    status: playing(t) ? `Spiel ${t.game} läuft` : n >= 2 ? 'Wartet auf „Bereit“' : n ? 'Wartet auf Mitspieler' : 'Freie Plätze',
  };
}
function list(user) {
  return [...tables.values()].filter(t => !t.spieltisch && (!t.hidden || t.hostId === user.id || user.isAdmin || seatOf(t, user.id)))
    .map(summary).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
}

// Was liegt auf dem Tisch, und wer darf noch etwas dazulegen?
const ranksOnTable = t => new Set(t.table.flatMap(p => (p.d ? [p.a.r, p.d.r] : [p.a.r])));
const unbeaten = t => t.table.filter(p => !p.d).length;
const allBeaten = t => t.table.length > 0 && !unbeaten(t);
const defenderSeat = t => t.seats[t.defender] || null;
// Platz für weitere Angriffskarten: nicht über das Limit und nie mehr offene Karten, als der Verteidiger schlagen könnte
function room(t) {
  const d = defenderSeat(t);
  if (!d) return 0;
  const byLimit = t.limit - t.table.length;
  // Nimmt er, zählt nur das Limit (es kommt von seinen Karten zu Beginn des Angriffs)
  return Math.max(0, t.taking ? byLimit : Math.min(byLimit, d.hand.length - unbeaten(t)));
}
const attackers = t => seated(t).filter(s => active(s) && t.seats.indexOf(s) !== t.defender);
function canThrow(t, s) {
  if (!t.table.length || room(t) <= 0 || !s.hand.length) return false;
  const ranks = ranksOnTable(t);
  return s.hand.some(c => ranks.has(c.r));
}
// Auf wen wartet der Tisch noch, bevor der Angriff zu Ende ist? Wer nichts mehr zuwerfen kann, gilt als fertig.
const waitingOn = t => attackers(t).filter(s => !t.passed.has(s.userId) && canThrow(t, s));

function state(t, viewerId) {
  const cfg = config();
  const me = seatOf(t, viewerId);
  const out = {
    id: t.id, name: t.name, host: t.hostName, hostId: t.hostId, hidden: t.hidden, seatCount: t.seatCount,
    phase: t.phase, game: t.game, deck: t.deck.length, trump: t.trump, discard: t.discard,
    table: t.table.map(p => ({ a: p.a, d: p.d })), limit: t.limit, attacker: t.attacker, defender: t.defender, taking: t.taking,
    seats: t.seats.slice(0, t.seatCount).map((s, i) => s && {
      i, id: s.userId, name: s.name, user: s.username, cards: s.hand.length, inGame: s.inGame, place: s.place,
      ready: s.ready, passed: t.passed.has(s.userId), away: !online(t, s.userId), leaving: s.leaving,
      session: { games: s.stats.games, wins: s.stats.wins, duraks: s.stats.duraks },
    }),
    turn: t.turn && { kind: t.turn.kind, seat: t.turn.seat, left: Math.max(0, t.turn.deadline - Date.now()) },
    waiting: playing(t) && t.turn && t.turn.kind === 'pass' ? waitingOn(t).map(s => t.seats.indexOf(s)) : [],
    result: t.result, viewers: viewers(t), log: t.log.slice(0, 20), manual: !!t.manual,
    rules: { turn: cfg.turn, pass: cfg.pass }, now: Date.now(), version: t.version,
  };
  // Eigene Karten und was der Betrachter gerade tun kann
  if (me) {
    out.hand = me.hand;
    if (playing(t) && active(me)) {
      const i = t.seats.indexOf(me);
      const ranks = ranksOnTable(t);
      const o = { attack: [], defend: {}, take: false, pass: false };
      if (i === t.defender) {
        if (!t.taking) {
          for (const c of me.hand) {
            const targets = t.table.map((p, k) => (!p.d && beats(p.a, c, t.trump.s) ? k : -1)).filter(k => k >= 0);
            if (targets.length) o.defend[id(c)] = targets;
          }
          o.take = unbeaten(t) > 0;
        }
      } else if (!t.table.length) {
        if (i === t.attacker) o.attack = me.hand.map(id);
      } else if (room(t) > 0) {
        o.attack = me.hand.filter(c => ranks.has(c.r)).map(id);
      }
      if (i !== t.defender && t.table.length && (allBeaten(t) || t.taking) && !t.passed.has(me.userId)) o.pass = true;
      out.options = o;
    }
  }
  return out;
}

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(t) {
  t.version++;
  const cache = new Map();
  for (const c of t.clients) {
    if (!cache.has(c.user.id)) cache.set(c.user.id, state(t, c.user.id));
    send(c.res, 'state', cache.get(c.user.id));
  }
}
function later(t, ms, fn) {
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { t.timer = null; if (tables.has(t.id)) { fn(); broadcast(t); } }, ms);
  t.timer.unref?.();
}
function stopTimer(t) { clearTimeout(t.timer); t.timer = null; }

// ---------- Platz nehmen, Bereit, Aufstehen ----------
function sit(t, user, index) {
  if (seatOf(t, user.id)) return 'Du sitzt schon an diesem Tisch.';
  const other = tableOf(user.id);
  if (other) return `Du sitzt schon am Tisch „${other.name}“. Steh dort erst auf.`;
  const i = Number.isInteger(index) && index >= 0 && index < t.seatCount && !t.seats[index] ? index : t.seats.slice(0, t.seatCount).findIndex(s => !s);
  if (i < 0) return 'Alle Plätze sind besetzt.';
  t.seats[i] = {
    userId: user.id, name: user.name, username: user.username, hand: [], inGame: false, place: 0,
    ready: false, leaving: false, awaySince: 0, stats: { games: 0, wins: 0, duraks: 0 },
  };
  log(t, playing(t) ? `${user.name} setzt sich und spielt ab dem nächsten Spiel mit.` : `${user.name} setzt sich.`);
  return null;
}
function setReady(t, seat, on) {
  if (playing(t)) return 'Das Spiel läuft schon.';
  seat.ready = on;
  maybeStart(t);
  return null;
}
// Aufstehen: wer mitten im Spiel geht, beendet es für alle und ist der Durak
function stand(t, seat, why = 'steht auf') {
  const i = t.seats.indexOf(seat);
  if (i < 0) return;
  if (playing(t) && active(seat)) {
    log(t, `${seat.name} ${why} und ist damit der Durak.`);
    finish(t, seat, true);
  } else if (playing(t) && seat.inGame) {
    // Schon raus: der Platz wird erst nach dem Spiel frei, damit das Ergebnis mitgezählt wird
    seat.leaving = true;
    log(t, `${seat.name} ${why}, sobald das Spiel vorbei ist.`);
    return;
  } else {
    log(t, `${seat.name} ${why}.`);
  }
  t.seats[i] = null;
  maybeStart(t);
}

// ---------- Ablauf ----------
// Zwischen zwei Spielen: sitzen mindestens zwei da und sind alle bereit, wird gegeben. Startet der Gastgeber
// (t.manual, vom Spieltisch), ist „Bereit“ nur ein Zeichen an ihn und es geht los, wenn er auf „Starten“ klickt.
function maybeStart(t) {
  if (t.phase === 'playing' || t.manual) return;
  const s = seated(t);
  if (s.length >= 2 && s.every(x => x.ready)) { if (!t.timer) later(t, START_MS, () => startGame(t)); }
  else stopTimer(t);
}

function startGame(t, force = false) {
  const players = seated(t);
  if (players.length < 2 || (!force && !players.every(s => s.ready))) return;
  t.deck = newDeck();
  // Die unterste Karte bestimmt Trumpf; sie liegt offen unter dem Stapel und wird als Letzte gezogen
  t.trump = t.deck[0];
  t.discard = 0; t.table = []; t.taking = false; t.passed.clear(); t.bouts = 0; t.places = 0; t.result = null;
  t.game++;
  t.phase = 'playing';
  for (const s of players) { Object.assign(s, { hand: [], inGame: true, place: 0, ready: false }); s.stats.games++; }
  for (let k = 0; k < HAND; k++) for (const s of players) s.hand.push(t.deck.pop());
  // Wer anfängt: im ersten Spiel die niedrigste Trumpfkarte, danach wird der letzte Durak zuerst angegriffen
  const loser = seatOf(t, t.lastDurak);
  let first;
  if (loser && active(loser)) {
    first = prevIndex(t, t.seats.indexOf(loser));
    log(t, `Spiel ${t.game}: Trumpf ist ${t.trump.s}. ${t.seats[first].name} greift den Durak der letzten Runde an.`);
  } else {
    let low = null;
    for (const s of players) for (const c of s.hand) if (c.s === t.trump.s && (!low || value(c) < value(low.c))) low = { s, c };
    first = low ? t.seats.indexOf(low.s) : t.seats.indexOf(players[crypto.randomInt(players.length)]);
    log(t, `Spiel ${t.game}: Trumpf ist ${t.trump.s}. ` + (low ? `${low.s.name} hat die niedrigste Trumpfkarte (${id(low.c)}) und fängt an.` : `Niemand hat Trumpf, ${t.seats[first].name} fängt an.`));
  }
  startBout(t, first);
}

function startBout(t, attacker) {
  t.attacker = attacker;
  t.defender = nextIndex(t, attacker);
  t.table = []; t.taking = false; t.passed.clear();
  // Im ersten Angriff eines Spiels höchstens fünf Karten
  t.limit = Math.min(t.bouts === 0 ? 5 : HAND, t.seats[t.defender].hand.length);
  t.bouts++;
  schedule(t);
}

// Nach jeder Änderung: Ist der Angriff vorbei? Sonst läuft die Uhr für den, auf den der Tisch wartet.
function schedule(t) {
  stopTimer(t);
  t.turn = null;
  if (!playing(t)) return;
  const cfg = config();
  const d = defenderSeat(t);
  let kind, seat = -1, who;
  if (!t.table.length) { kind = 'open'; seat = t.attacker; who = [t.seats[t.attacker]]; }
  else if (!t.taking && unbeaten(t)) { kind = 'defend'; seat = t.defender; who = [d]; }
  else {
    who = waitingOn(t);
    if (!who.length) {
      // Niemand will oder kann noch etwas dazulegen
      t.turn = { kind: 'end', seat: -1, deadline: Date.now() + END_MS };
      later(t, END_MS, () => endBout(t));
      return;
    }
    kind = 'pass';
  }
  const secs = who.some(s => online(t, s.userId)) ? (kind === 'pass' ? cfg.pass : cfg.turn) : OFFLINE_S;
  t.turn = { kind, seat, deadline: Date.now() + secs * 1000 };
  later(t, secs * 1000, () => timeout(t, kind));
}

// Zeit abgelaufen: der Angreifer legt seine kleinste Karte, der Verteidiger nimmt, wer noch zuwerfen könnte, ist fertig
function timeout(t, kind) {
  if (kind === 'open') {
    const s = t.seats[t.attacker];
    const c = s.hand.slice().sort((a, b) => (a.s === t.trump.s) - (b.s === t.trump.s) || value(a) - value(b))[0];
    log(t, `${s.name}: Zeit abgelaufen, legt ${id(c)}.`);
    attack(t, s, id(c));
  } else if (kind === 'defend') {
    log(t, `${defenderSeat(t).name}: Zeit abgelaufen, nimmt.`);
    take(t, defenderSeat(t));
  } else {
    for (const s of waitingOn(t)) t.passed.add(s.userId);
    schedule(t);
  }
}

const takeCard = (s, cid) => { const k = s.hand.findIndex(c => id(c) === cid); return k < 0 ? null : s.hand.splice(k, 1)[0]; };

function attack(t, s, cid) {
  const i = t.seats.indexOf(s);
  if (!playing(t) || !active(s)) return 'Du spielst gerade nicht mit.';
  if (i === t.defender) return 'Du verteidigst gerade.';
  const c = s.hand.find(x => id(x) === cid);
  if (!c) return 'Diese Karte hast du nicht.';
  if (!t.table.length) {
    if (i !== t.attacker) return `${t.seats[t.attacker].name} fängt den Angriff an.`;
  } else {
    if (!ranksOnTable(t).has(c.r)) return 'Zuwerfen geht nur mit einem Wert, der schon auf dem Tisch liegt.';
    if (room(t) <= 0) return t.table.length >= t.limit ? `Mehr als ${t.limit} Karten gehen in diesem Angriff nicht.` : 'Der Verteidiger hat nicht genug Karten für noch eine.';
  }
  takeCard(s, cid);
  t.table.push({ a: c, d: null, by: s.userId });
  t.passed.clear();
  schedule(t);
  return null;
}

function defend(t, s, cid, target) {
  if (!playing(t) || t.seats.indexOf(s) !== t.defender) return 'Du verteidigst gerade nicht.';
  if (t.taking) return 'Du hast schon genommen.';
  const c = s.hand.find(x => id(x) === cid);
  if (!c) return 'Diese Karte hast du nicht.';
  // Ohne Ziel: die erste offene Karte, die sich damit schlagen lässt
  let k = Number.isInteger(target) ? target : t.table.findIndex(p => !p.d && beats(p.a, c, t.trump.s));
  const p = t.table[k];
  if (!p || p.d) return 'Diese Karte ist schon geschlagen.';
  if (!beats(p.a, c, t.trump.s)) return `${id(c)} schlägt ${id(p.a)} nicht. Nötig ist eine höhere ${p.a.s}-Karte oder Trumpf (${t.trump.s}).`;
  takeCard(s, cid);
  p.d = c;
  t.passed.clear();
  schedule(t);
  return null;
}

function take(t, s) {
  if (!playing(t) || t.seats.indexOf(s) !== t.defender) return 'Du verteidigst gerade nicht.';
  if (t.taking) return null;
  if (!unbeaten(t)) return 'Es ist alles geschlagen.';
  t.taking = true;
  t.passed.clear();
  log(t, `${s.name} nimmt.`);
  schedule(t);
  return null;
}

function pass(t, s) {
  const i = t.seats.indexOf(s);
  if (!playing(t) || !active(s) || i === t.defender) return 'Du greifst gerade nicht an.';
  if (!t.table.length || !(allBeaten(t) || t.taking)) return 'Warte, bis der Verteidiger geschlagen oder genommen hat.';
  t.passed.add(s.userId);
  schedule(t);
  return null;
}

// Angriff vorbei: Karten weg oder auf die Hand des Verteidigers, nachziehen, wer keine Karten mehr hat, ist raus
function endBout(t) {
  const d = defenderSeat(t);
  const cards = t.table.flatMap(p => (p.d ? [p.a, p.d] : [p.a]));
  const took = t.taking;
  if (took) { d.hand.push(...cards); log(t, `${d.name} nimmt ${cards.length} ${cards.length === 1 ? 'Karte' : 'Karten'} auf.`); }
  else { t.discard += cards.length; log(t, `${d.name} hat alles geschlagen, ${cards.length} Karten kommen weg.`); }
  t.table = []; t.taking = false; t.passed.clear();
  // Nachziehen: erst der Angreifer, dann die anderen im Uhrzeigersinn, der Verteidiger zuletzt
  const order = [];
  for (let k = 0; k < t.seatCount; k++) { const j = (t.attacker + k) % t.seatCount; if (j !== t.defender && active(t.seats[j])) order.push(t.seats[j]); }
  if (active(d)) order.push(d);
  for (const s of order) while (s.hand.length < HAND && t.deck.length) s.hand.push(t.deck.pop());
  // Leerer Stapel und keine Karten mehr: raus. Wer im selben Angriff fertig wird, teilt sich den Platz.
  if (!t.deck.length) {
    const done = seated(t).filter(s => active(s) && !s.hand.length);
    if (done.length) {
      const place = t.places + 1;
      for (const s of done) { s.place = place; log(t, `${s.name} hat keine Karten mehr${place === 1 ? ' und ist als Erster raus' : ''}.`); }
      t.places += done.length;
    }
  }
  const left = seated(t).filter(active);
  if (left.length <= 1) return finish(t, left[0] || null, false);
  // Wer greift als Nächstes an? Nach einer Abwehr der Verteidiger, nach dem Nehmen der Spieler links von ihm
  const next = !took && active(d) ? t.defender : nextIndex(t, t.defender);
  startBout(t, next);
}

// Spiel vorbei: durak ist der Verlierer (oder null bei Unentschieden), quit = mitten im Spiel aufgestanden
function finish(t, durak, quit) {
  stopTimer(t);
  t.turn = null;
  const players = seated(t).filter(s => s.inGame);
  const ts = now();
  const ins = db.prepare('INSERT INTO dk_results(user_id, table_name, players, place, durak, quit, bouts, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const order = [];
  for (const s of players) {
    // Wer noch Karten hatte, als das Spiel durch Aufstehen endete, landet hinter allen, die schon raus sind
    const isDurak = s === durak;
    const place = isDurak ? players.length : s.place || t.places + 1;
    ins.run(s.userId, t.name, players.length, place, isDurak ? 1 : 0, isDurak && quit ? 1 : 0, t.bouts, ts);
    if (isDurak) s.stats.duraks++;
    if (place === 1 && !isDurak) s.stats.wins++;
    order.push({ name: s.name, user: s.username, place, durak: isDurak, cards: s.hand.length });
    s.inGame = false; s.place = 0;
  }
  order.sort((a, b) => a.place - b.place);
  t.result = { durak: durak ? durak.name : null, quit: !!quit, order };
  t.lastDurak = durak ? durak.userId : 0;
  log(t, durak ? `Spiel ${t.game} vorbei: ${durak.name} ist der Durak!` : `Spiel ${t.game} vorbei: Unentschieden, alle sind gleichzeitig fertig geworden.`);
  t.phase = 'result';
  t.table = []; t.taking = false; t.passed.clear(); t.attacker = -1; t.defender = -1;
  for (const s of seated(t)) s.hand = [];
  // Wer lange weg war oder gehen wollte, steht jetzt auf
  for (const s of seated(t)) if (s.leaving || (s.awaySince && Date.now() - s.awaySince > AWAY_MS)) { t.seats[t.seats.indexOf(s)] = null; log(t, `${s.name} steht auf.`); }
}

// ---------- Aktionen vom Browser ----------
function control(t, user, b) {
  const a = String(b.action || '');
  const seat = seatOf(t, user.id);
  const card = String(b.card || '');
  switch (a) {
    case 'sit': return sit(t, user, Number(b.seat));
    case 'ready': return seat ? setReady(t, seat, b.on !== false) : 'Du sitzt nicht am Tisch.';
    case 'attack': return seat ? attack(t, seat, card) : 'Du sitzt nicht am Tisch.';
    case 'defend': return seat ? defend(t, seat, card, b.target == null ? null : Number(b.target)) : 'Du sitzt nicht am Tisch.';
    case 'take': return seat ? take(t, seat) : 'Du sitzt nicht am Tisch.';
    case 'pass': return seat ? pass(t, seat) : 'Du sitzt nicht am Tisch.';
    case 'leave': if (seat) stand(t, seat); return null;
    case 'kick': {
      if (!isHost(t, user)) return 'Nur der Gastgeber kann Spieler vom Tisch nehmen.';
      const s = seatOf(t, Number(b.user));
      if (!s) return 'Dieser Spieler sitzt nicht am Tisch.';
      stand(t, s, 'wurde vom Tisch genommen');
      return null;
    }
    case 'settings':
      if (!isHost(t, user)) return 'Nur der Gastgeber ändert die Einstellungen.';
      applySettings(t, b);
      return null;
    case 'start':
      if (!isHost(t, user)) return 'Nur der Gastgeber startet das Spiel.';
      if (playing(t)) return 'Das Spiel läuft schon.';
      if (seated(t).length < 2) return 'Es braucht mindestens zwei Spieler.';
      stopTimer(t);
      startGame(t, true);
      return null;
    default: return 'Unbekannte Aktion.';
  }
}

function join(t, user, res) {
  const c = { user, res };
  t.clients.add(c);
  t.emptySince = 0;
  const s = seatOf(t, user.id);
  if (s) s.awaySince = 0;
  // Kommt jemand zurück, auf den der Tisch wartet, bekommt er wieder die volle Bedenkzeit
  if (s && playing(t)) schedule(t);
  broadcast(t);
  const ping = setInterval(() => send(res, 'ping', { now: Date.now() }), 20000);
  return () => {
    clearInterval(ping);
    t.clients.delete(c);
    if (!tables.has(t.id)) return;
    const seat = seatOf(t, user.id);
    if (seat && !online(t, user.id)) seat.awaySince = Date.now();
    if (!t.clients.size) t.emptySince = Date.now();
    // Der Gastgeber ist weg: wer noch da ist, übernimmt
    if (!online(t, t.hostId) && t.clients.size) {
      const next = [...t.clients][0].user;
      t.hostId = next.id; t.hostName = next.name;
    }
    broadcast(t);
  };
}

// Nach einem Wechsel der Einstellung „Nächste Runde“
function wake(t) {
  if (t.manual) { if (!playing(t)) stopTimer(t); } else maybeStart(t);
}

// Tisch schließen: ein laufendes Spiel zählt nicht
function remove(t) {
  stopTimer(t);
  for (const c of t.clients) { send(c.res, 'closed', {}); c.res.end(); }
  tables.delete(t.id);
}

// Leere Tische schließen; wer lange weg ist, steht zwischen zwei Spielen auf
function cleanup(force = false) {
  const ts = Date.now();
  for (const t of tables.values()) {
    if (!t.clients.size && (force || ts - t.emptySince > EMPTY_MS)) { remove(t); continue; }
    if (!playing(t)) {
      const gone = seated(t).filter(s => s.awaySince && ts - s.awaySince > AWAY_MS);
      gone.forEach(s => stand(t, s));
      if (gone.length) broadcast(t);
    }
  }
}
setInterval(cleanup, 30e3).unref();

module.exports = {
  config, create, get, list, state, control, join, remove, broadcast, isHost, tableOf, wake,
  userTotals, recentGames, leaderboard, resetStats, beats, newDeck, room,
  MAX_SEATS, RANKS, SUITS,
  _tables: tables, _startGame: startGame, _startBout: startBout, _endBout: endBout,
};
