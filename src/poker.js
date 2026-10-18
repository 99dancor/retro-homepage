'use strict';
// Poker (Startmenü → Spiele und Apps → ♠️ Poker): Texas Hold'em No Limit an Tischen, die wie die Blackjack-Tische
// nur im Arbeitsspeicher leben und Änderungen per Server-Sent Events schicken. Gemischt und gegeben wird nur hier;
// jeder Browser bekommt seinen eigenen Zustand (state(t, viewerId)) und darin nur die eigenen Handkarten. Fremde
// Karten verlassen den Server erst beim Showdown. Gespielt wird mit Spielgeld.
//
// Bilanz wie bei Blackjack: Jede Sitzung an einem Tisch ist eine Zeile in pk_sessions mit den Chips und dem insgesamt
// eingekauften Geld (Start-Buy-in plus alle Nachkäufe). Bilanz eines Kontos = Summe aus (Chips − eingekauft).
// Gespeichert wird nach jeder Hand; ein Neustart des Servers kostet höchstens die laufende Hand.
// Am Spieltisch (src/kartenspiele.js) kommt das Geld wie bei Blackjack über t.bank aus der Kasse (src/kasse.js).
const crypto = require('node:crypto');
const { db, now, getSetting } = require('./db');
const kasse = require('./kasse');

const MAX_TABLES = 30;
const MAX_SEATS = 6;
const EMPTY_MS = 10 * 60 * 1000;   // leere Tische verschwinden nach 10 Minuten
const AWAY_MS = 90 * 1000;         // wer so lange kein Fenster mehr offen hat, steht nach der Hand auf
const START_MS = 3000;             // Pause, bevor die erste Hand beginnt (damit noch jemand dazukommen kann)
const STREET_MS = 1300;            // Pause zwischen Flop, Turn und River, wenn niemand mehr setzen kann
const RESULT_MS = 6000;            // Ergebnis zeigen, dann nächste Hand
const BLINDS = [1, 2, 5, 10, 25, 50, 100];   // Small Blind; der Big Blind ist doppelt so hoch
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const int = (v, d, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
function config() {
  return {
    ...kasse.config(),
    turn: int(getSetting('pk_turn'), 30, 5, 300),
  };
}
const euro = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-DE') + ' €';

// ---------- Karten und Blätter ----------
const value = c => RANKS.indexOf(c.r) + 2;   // 2 … 14 (Ass)
function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

const HANDS = ['Höchste Karte', 'Ein Paar', 'Zwei Paare', 'Drilling', 'Straße', 'Flush', 'Full House', 'Vierling', 'Straight Flush', 'Royal Flush'];
const ONE = { 2: 'Zwei', 3: 'Drei', 4: 'Vier', 5: 'Fünf', 6: 'Sechs', 7: 'Sieben', 8: 'Acht', 9: 'Neun', 10: 'Zehn', 11: 'Bube', 12: 'Dame', 13: 'König', 14: 'Ass' };
const MANY = { 2: 'Zweien', 3: 'Dreien', 4: 'Vieren', 5: 'Fünfen', 6: 'Sechsen', 7: 'Siebenen', 8: 'Achten', 9: 'Neunen', 10: 'Zehnen', 11: 'Buben', 12: 'Damen', 13: 'Könige', 14: 'Asse' };

// Wertung von genau fünf Karten: [Kategorie, Ränge für Gleichstände …], größer ist besser
function score5(cards) {
  const vals = cards.map(value).sort((a, b) => b - a);
  const flush = cards.every(c => c.s === cards[0].s);
  const uniq = [...new Set(vals)];
  let high = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) high = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) high = 5;   // A-2-3-4-5, das Ass zählt als Eins
  }
  if (high && flush) return [high === 14 ? 9 : 8, high];
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ranks = groups.map(g => g[0]);
  if (groups[0][1] === 4) return [7, ...ranks];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...ranks];
  if (flush) return [5, ...vals];
  if (high) return [4, high];
  if (groups[0][1] === 3) return [3, ...ranks];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...ranks];
  if (groups[0][1] === 2) return [1, ...ranks];
  return [0, ...vals];
}
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}
// Bestes Blatt aus fünf bis sieben Karten: alle Fünfer-Kombinationen durchprobieren (höchstens 21)
function best(cards) {
  let top = null;
  const pick = (start, chosen) => {
    if (chosen.length === 5) {
      const sc = score5(chosen);
      if (!top || compare(sc, top.score) > 0) top = { score: sc, cards: chosen.slice() };
      return;
    }
    for (let i = start; i <= cards.length - (5 - chosen.length); i++) { chosen.push(cards[i]); pick(i + 1, chosen); chosen.pop(); }
  };
  pick(0, []);
  return withName(top);
}
function withName(top) {
  const [cat, a, b] = top.score;
  const name = cat === 0 ? `Höchste Karte ${ONE[a]}` : cat === 1 ? `Paar ${MANY[a]}` : cat === 2 ? `Zwei Paare, ${MANY[a]} und ${MANY[b]}` :
    cat === 3 ? `Drilling ${MANY[a]}` : cat === 4 ? `Straße bis ${ONE[a]}` : cat === 5 ? `Flush, ${ONE[a]} hoch` :
    cat === 6 ? `Full House, ${MANY[a]} über ${MANY[b]}` : cat === 7 ? `Vierling ${MANY[a]}` : cat === 8 ? `Straight Flush bis ${ONE[a]}` : 'Royal Flush';
  return { ...top, cat, name };
}

// ---------- Sitzungen in der Datenbank ----------
// Beim Start war der Server vielleicht mitten im Spiel weg: offene Sitzungen gelten als beendet
db.prepare('UPDATE pk_sessions SET ended_at = updated_at WHERE ended_at IS NULL').run();

function openSession(t, seat) {
  const ts = now();
  seat.sessionId = Number(db.prepare(`INSERT INTO pk_sessions(user_id, table_name, chips, bought, buyins, started_at, updated_at)
                                      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(seat.userId, t.name, seat.chips, seat.bought, seat.buyins, ts, ts).lastInsertRowid);
}
function saveSession(seat, end = false) {
  const s = seat.stats;
  if (seat.bank) seat.bank.save(seat.userId, seat.chips);
  db.prepare(`UPDATE pk_sessions SET chips = ?, bought = ?, buyins = ?, hands = ?, wins = ?, showdowns = ?, best_win = ?, best_hand = ?,
              updated_at = ?${end ? ', ended_at = ?' : ''} WHERE id = ?`)
    .run(...[seat.chips, seat.bought, seat.buyins, s.hands, s.wins, s.showdowns, s.bestWin, s.bestHand, now()], ...(end ? [now()] : []), seat.sessionId);
}

// Größter Gewinn einer Hand: Wer den Rekord bisher hielt, bekommt Bescheid, wenn ihn jemand anderes übertrifft
function recordWin(seat, net) {
  if (net <= 0) return;
  const prev = db.prepare('SELECT user_id, best_win FROM pk_sessions WHERE best_win > 0 ORDER BY best_win DESC, updated_at LIMIT 1').get();
  if (!prev || prev.user_id === seat.userId || net <= prev.best_win) return;
  require('./notify').send(prev.user_id, 'highscore', {
    title: `🏆 ${seat.name} hat deinen Poker-Rekord geknackt`,
    body: `Größter Gewinn in einer Hand: +${net.toLocaleString('de-DE')} € (dein Rekord: +${prev.best_win.toLocaleString('de-DE')} €)`, url: '/kartenspiele?statistik=poker',
  });
}

function userTotals(userId) {
  return db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(chips - bought), 0) AS balance, COALESCE(SUM(buyins), 0) AS buyins,
                     COALESCE(SUM(bought), 0) AS bought, COALESCE(SUM(hands), 0) AS hands, COALESCE(SUM(wins), 0) AS wins,
                     COALESCE(SUM(showdowns), 0) AS showdowns, COALESCE(MAX(best_win), 0) AS best_win, COALESCE(MAX(best_hand), -1) AS best_hand,
                     MAX(updated_at) AS last FROM pk_sessions WHERE user_id = ?`).get(userId);
}
function recentSessions(userId, limit = 10) {
  return db.prepare('SELECT * FROM pk_sessions WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?').all(userId, limit);
}
function leaderboard() {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility,
                     SUM(s.chips - s.bought) AS balance, SUM(s.buyins) AS buyins, SUM(s.bought) AS bought, SUM(s.hands) AS hands,
                     SUM(s.wins) AS wins, SUM(s.showdowns) AS showdowns, MAX(s.best_win) AS best_win, MAX(s.best_hand) AS best_hand
                     FROM pk_sessions s JOIN users u ON u.id = s.user_id WHERE u.disabled = 0 AND s.hands > 0
                     GROUP BY u.id ORDER BY balance DESC, hands DESC`).all();
}
function resetStats(userId) {
  if (userId) db.prepare('DELETE FROM pk_sessions WHERE user_id = ? AND ended_at IS NOT NULL').run(userId);
  else db.prepare('DELETE FROM pk_sessions WHERE ended_at IS NOT NULL').run();
}

// ---------- Tische ----------
const tables = new Map();

function create(user, opts) {
  if (tables.size >= MAX_TABLES) cleanup(true);
  if (tables.size >= MAX_TABLES) return null;
  const t = {
    id: crypto.randomBytes(5).toString('hex'), hostId: user.id, hostName: user.name,
    name: '', hidden: false, sb: 5, seatCount: MAX_SEATS,
    seats: Array(MAX_SEATS).fill(null), clients: new Set(), emptySince: Date.now(),
    phase: 'waiting', street: null, hand: 0, button: -1, board: [], deck: [], pot: 0,
    currentBet: 0, minRaise: 0, raiseId: 0, turn: null, reveal: false, results: [],
    timer: null, log: [], version: 0,
  };
  applySettings(t, { name: `Pokertisch von ${user.name}`, ...opts });
  tables.set(t.id, t);
  return t;
}
function applySettings(t, b) {
  if (typeof b.name === 'string' && b.name.trim()) t.name = b.name.trim().slice(0, 60);
  if ('hidden' in b) t.hidden = !!b.hidden;
  if (BLINDS.includes(Number(b.sb))) t.sb = Number(b.sb);
  const n = Number(b.seats);
  // Weniger Plätze nur, wenn die wegfallenden frei sind
  if (n >= 2 && n <= MAX_SEATS && t.seats.slice(n).every(s => !s)) t.seatCount = n;
}

const get = id => tables.get(String(id)) || null;
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
const live = t => seated(t).filter(s => s.inHand && !s.folded);          // noch im Spiel um den Pot
const canAct = s => s.inHand && !s.folded && !s.allIn;
const ready = t => seated(t).filter(s => s.chips > 0 && !s.sittingOut && !s.leaving);   // bekommt die nächste Hand
// Nächster Platz nach i (im Kreis), für den test(seat) gilt
function nextIndex(t, i, test) {
  for (let k = 1; k <= t.seatCount; k++) {
    const j = (i + k + t.seatCount) % t.seatCount;
    if (t.seats[j] && test(t.seats[j])) return j;
  }
  return -1;
}

function summary(t) {
  return {
    id: t.id, name: t.name, host: t.hostName, hidden: t.hidden, players: seated(t).length, seats: t.seatCount,
    viewers: viewers(t).length, sb: t.sb, bb: t.sb * 2,
    status: playing(t) ? `Hand ${t.hand} läuft` : seated(t).length >= 2 ? 'Gleich geht es los' : seated(t).length ? 'Wartet auf Mitspieler' : 'Freie Plätze',
  };
}
function list(user) {
  return [...tables.values()].filter(t => !t.spieltisch && (!t.hidden || t.hostId === user.id || user.isAdmin || seatOf(t, user.id)))
    .map(summary).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
}

// Während einer Hand gehört, was jemand schon in den Pot gelegt hat, für die Bilanz noch ihm
const balanceOf = (t, s) => s.chips + (playing(t) && s.inHand ? s.total : 0) - s.bought;
function state(t, viewerId) {
  const cfg = config();
  const me = seatOf(t, viewerId);
  const shown = s => s.userId === viewerId || (t.reveal && s.inHand && !s.folded);
  const out = {
    id: t.id, name: t.name, host: t.hostName, hostId: t.hostId, hidden: t.hidden, sb: t.sb, bb: t.sb * 2, seatCount: t.seatCount,
    phase: t.phase, street: t.street, hand: t.hand, button: t.button, board: t.board,
    pot: t.pot + seated(t).reduce((n, s) => n + s.bet, 0), currentBet: t.currentBet,
    seats: t.seats.slice(0, t.seatCount).map((s, i) => s && {
      i, id: s.userId, name: s.name, user: s.username, chips: s.chips, bet: s.bet, inHand: s.inHand, folded: s.folded, allIn: s.allIn,
      action: s.action, win: s.win, buyins: s.buyins, bought: s.bought, balance: balanceOf(t, s),
      cards: s.inHand ? (shown(s) ? s.cards : s.cards.map(() => null)) : [],
      best: shown(s) && s.inHand && t.board.length >= 3 ? best([...s.cards, ...t.board]).name : null,
      away: !online(t, s.userId), leaving: s.leaving, sittingOut: s.sittingOut,
      session: { hands: s.stats.hands, wins: s.stats.wins },
    }),
    turn: t.turn && { seat: t.turn.seat, left: Math.max(0, t.turn.deadline - Date.now()) },
    results: t.results, viewers: viewers(t), log: t.log.slice(0, 20),
    rules: { buyin: cfg.buyin, rebuyBelow: cfg.rebuyBelow, turn: cfg.turn }, blinds: BLINDS, now: Date.now(), version: t.version,
  };
  // Was der Betrachter gerade tun kann
  if (me && playing(t) && t.turn && t.seats[t.turn.seat] === me) {
    const toCall = Math.min(t.currentBet - me.bet, me.chips);
    const maxTo = me.bet + me.chips;
    out.options = {
      toCall, canCheck: toCall <= 0, maxTo,
      canRaise: maxTo > t.currentBet && !(me.acted && me.raiseSeen === t.raiseId),
      minTo: Math.min(maxTo, t.currentBet + t.minRaise),
    };
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

// ---------- Platz nehmen, Nachkaufen, Aufstehen ----------
function sit(t, user, index) {
  if (seatOf(t, user.id)) return 'Du sitzt schon an diesem Tisch.';
  const other = tableOf(user.id);
  if (other) return `Du sitzt schon am Tisch „${other.name}“. Steh dort erst auf.`;
  const i = Number.isInteger(index) && index >= 0 && index < t.seatCount && !t.seats[index] ? index : t.seats.slice(0, t.seatCount).findIndex(s => !s);
  if (i < 0) return 'Alle Plätze sind besetzt.';
  // Am Spieltisch kommt das Geld aus der Kasse (src/kasse.js), sonst gibt es den Buy-in
  const chips = t.bank ? t.bank.take(user.id) : config().buyin;
  const seat = {
    userId: user.id, name: user.name, username: user.username, chips, bought: chips, buyins: t.bank ? 0 : 1, bank: t.bank || null,
    leaving: false, sittingOut: false, awaySince: 0, ...emptyHand(),
    stats: { hands: 0, wins: 0, showdowns: 0, bestWin: 0, bestHand: -1 },
  };
  openSession(t, seat);
  t.seats[i] = seat;
  log(t, `${user.name} setzt sich mit ${euro(chips)}.`);
  maybeStart(t);
  return null;
}
function emptyHand() {
  return { cards: [], inHand: false, folded: false, allIn: false, bet: 0, total: 0, acted: false, raiseSeen: -1, action: '', win: 0 };
}
function rebuy(t, seat) {
  const cfg = config();
  if (playing(t) && seat.inHand) return 'Nachkaufen geht erst nach dieser Hand.';
  if (seat.chips >= cfg.rebuyBelow) return `Nachkaufen geht erst, wenn du weniger als ${euro(cfg.rebuyBelow)} hast.`;
  if (seat.bank) seat.bank.rebuy(seat.userId, seat.chips);
  seat.chips += cfg.buyin; seat.bought += cfg.buyin; seat.buyins++;
  saveSession(seat);
  log(t, `${seat.name} kauft für ${euro(cfg.buyin)} nach` + (seat.bank ? '.' : ` (${seat.buyins}. Buy-in).`));
  maybeStart(t);
  return null;
}
// Aufstehen: wer mitten in einer Hand geht, steigt sofort aus und räumt den Platz nach der Hand
function stand(t, seat) {
  if (playing(t) && seat.inHand) {
    seat.leaving = true;
    if (!seat.folded) fold(t, seat);
    return;
  }
  const i = t.seats.indexOf(seat);
  if (i < 0) return;
  saveSession(seat, true);
  t.seats[i] = null;
  log(t, `${seat.name} steht auf: ${euro(seat.chips)} Chips, Bilanz ${euro(seat.chips - seat.bought)}.`);
  maybeStart(t);
}

// ---------- Ablauf einer Hand ----------
// Zwischen zwei Händen: sobald zwei mit Chips dasitzen, geht es los
function maybeStart(t) {
  if (t.phase !== 'waiting') return;
  if (ready(t).length >= 2) { if (!t.timer) later(t, START_MS, () => startHand(t)); }
  else stopTimer(t);
}

function commit(s, amount) {
  const a = Math.max(0, Math.min(amount, s.chips));
  s.chips -= a; s.bet += a; s.total += a;
  if (!s.chips) s.allIn = true;
  return a;
}

function startHand(t) {
  const players = ready(t);
  if (players.length < 2) { t.phase = 'waiting'; return; }
  for (const s of seated(t)) Object.assign(s, emptyHand());
  t.deck = newDeck(); t.board = []; t.pot = 0; t.results = []; t.reveal = false;
  t.hand++;
  t.phase = 'playing'; t.street = 'preflop';
  for (const s of players) { s.inHand = true; s.stats.hands++; }
  // Der Button wandert zum nächsten Spieler; zu zweit setzt der Button den Small Blind und spricht vor dem Flop zuerst
  t.button = nextIndex(t, t.button < 0 ? -1 : t.button, s => s.inHand);
  const sbi = players.length === 2 ? t.button : nextIndex(t, t.button, s => s.inHand);
  const bbi = nextIndex(t, sbi, s => s.inHand);
  const bb = t.sb * 2;
  commit(t.seats[sbi], t.sb); t.seats[sbi].action = 'Small Blind';
  commit(t.seats[bbi], bb); t.seats[bbi].action = 'Big Blind';
  t.currentBet = bb; t.minRaise = bb; t.raiseId = 0;
  for (let k = 0; k < 2; k++) {
    let i = sbi;
    do { t.seats[i].cards.push(t.deck.pop()); i = nextIndex(t, i, s => s.inHand); } while (i !== sbi);
  }
  log(t, `Hand ${t.hand}: ${t.seats[t.button].name} hat den Button, Blinds ${euro(t.sb)} / ${euro(bb)}.`);
  nextTurn(t, bbi + 1);
}

// Wer ist als Nächstes dran (ab Platz from)? Ist die Setzrunde fertig, kommt die nächste Straße.
function nextTurn(t, from) {
  stopTimer(t);
  from = ((from % t.seatCount) + t.seatCount) % t.seatCount;
  t.turn = null;
  if (live(t).length <= 1) return settle(t);
  const actors = live(t).filter(s => !s.allIn);
  const pending = s => canAct(s) && (!s.acted || s.bet < t.currentBet);
  // Kann höchstens noch einer setzen und hat der gleichgezogen, ist die Runde vorbei
  if (!actors.some(pending) || (actors.length === 1 && actors[0].bet >= t.currentBet)) return endStreet(t);
  const i = t.seats[from] && pending(t.seats[from]) ? from : nextIndex(t, from, pending);
  const s = t.seats[i];
  const secs = online(t, s.userId) ? config().turn : 3;
  t.turn = { seat: i, deadline: Date.now() + secs * 1000 };
  later(t, secs * 1000, () => {
    const check = s.bet >= t.currentBet;
    log(t, `${s.name}: Zeit abgelaufen, ${check ? 'checkt' : 'steigt aus'}.`);
    act(t, s, check ? 'check' : 'fold');
  });
}

function fold(t, s) {
  s.folded = true; s.action = 'Aussteigen';
  if (t.turn && t.seats[t.turn.seat] === s) nextTurn(t, t.turn.seat + 1);
  else if (live(t).length <= 1) { stopTimer(t); t.turn = null; settle(t); }
}

// Züge. amount bei raise ist der Betrag, auf den erhöht wird (gesamter Einsatz in dieser Setzrunde).
function act(t, s, action, amount) {
  if (!playing(t) || !t.turn || t.seats[t.turn.seat] !== s) return 'Du bist nicht dran.';
  const toCall = t.currentBet - s.bet;
  const i = t.turn.seat;
  switch (action) {
    case 'fold': fold(t, s); return null;
    case 'check':
      if (toCall > 0) return `Du musst ${euro(Math.min(toCall, s.chips))} mitgehen, erhöhen oder aussteigen.`;
      s.action = 'Check';
      break;
    case 'call': {
      if (toCall <= 0) { s.action = 'Check'; break; }
      const a = commit(s, toCall);
      s.action = s.allIn ? `All-in ${euro(s.bet)}` : `Geht mit ${euro(a)}`;
      break;
    }
    case 'raise': case 'allin': {
      const maxTo = s.bet + s.chips;
      if (maxTo <= t.currentBet) return act(t, s, 'call');
      if (s.acted && s.raiseSeen === t.raiseId) return 'Erhöhen geht hier nicht mehr, nur mitgehen oder aussteigen.';
      const minTo = t.currentBet + t.minRaise;
      let to = action === 'allin' ? maxTo : Math.floor(Number(amount) || 0);
      if (to >= maxTo) to = maxTo;
      else if (to < minTo) return `Erhöhen geht mindestens auf ${euro(minTo)}.`;
      const by = to - t.currentBet;
      const opened = t.currentBet === 0;
      commit(s, to - s.bet);
      // Nur eine volle Erhöhung öffnet das Setzen für alle wieder; ein kleineres All-in muss man nur mitgehen
      if (by >= t.minRaise) { t.minRaise = by; t.raiseId++; }
      t.currentBet = to;
      s.action = s.allIn ? `All-in ${euro(to)}` : opened ? `Setzt ${euro(to)}` : `Erhöht auf ${euro(to)}`;
      break;
    }
    default: return 'Unbekannter Zug.';
  }
  s.acted = true; s.raiseSeen = t.raiseId;
  nextTurn(t, i + 1);
  return null;
}

function collect(t) {
  for (const s of seated(t)) { t.pot += s.bet; s.bet = 0; }
}
function endStreet(t) {
  collect(t);
  t.currentBet = 0; t.minRaise = t.sb * 2; t.raiseId = 0;
  for (const s of seated(t)) { s.acted = false; s.raiseSeen = -1; if (canAct(s)) s.action = ''; }
  if (t.street === 'river') return settle(t);
  t.deck.pop();   // eine Karte wird verbrannt
  if (t.street === 'preflop') { t.board.push(t.deck.pop(), t.deck.pop(), t.deck.pop()); t.street = 'flop'; }
  else { t.board.push(t.deck.pop()); t.street = t.street === 'flop' ? 'turn' : 'river'; }
  // Kann niemand mehr setzen (alle bis auf höchstens einen All-in), werden die Karten aufgedeckt und der Rest ausgeteilt
  if (live(t).filter(s => !s.allIn).length <= 1) {
    t.reveal = true;
    t.turn = null;
    later(t, STREET_MS, () => endStreet(t));
    return;
  }
  nextTurn(t, nextIndex(t, t.button, canAct));
}

// Pots verteilen. Wer All-in ist, kann nur gewinnen, was er selbst gegen jeden anderen eingesetzt hat (Nebenpots).
function pots(t) {
  const players = seated(t).filter(s => s.inHand);
  const left = new Map(players.map(s => [s, s.total]));
  const out = [];
  for (;;) {
    const open = players.filter(s => !s.folded && left.get(s) > 0);
    if (!open.length) break;
    const level = Math.min(...open.map(s => left.get(s)));
    let amount = 0;
    for (const s of players) { const a = Math.min(left.get(s), level); amount += a; left.set(s, left.get(s) - a); }
    out.push({ amount, eligible: open });
  }
  // Was Ausgestiegene über alle Verbliebenen hinaus gesetzt haben (kommt praktisch nicht vor), geht in den letzten Pot
  const rest = [...left.values()].reduce((n, v) => n + v, 0);
  if (rest && out.length) out[out.length - 1].amount += rest;
  return out;
}

function settle(t) {
  stopTimer(t);
  collect(t);
  t.turn = null;
  const remaining = live(t);
  const showdown = remaining.length > 1;
  t.reveal = showdown;
  const hands = new Map(remaining.map(s => [s, showdown ? best([...s.cards, ...t.board]) : null]));
  // Reihenfolge für ungerade Chips: links vom Button zuerst
  const order = [];
  for (let k = 1; k <= t.seatCount; k++) { const s = t.seats[(t.button + k) % t.seatCount]; if (s && s.inHand) order.push(s); }
  t.results = [];
  for (const [n, p] of pots(t).entries()) {
    let winners = p.eligible;
    if (showdown && winners.length > 1) {
      const top = winners.reduce((m, s) => (compare(hands.get(s).score, m) > 0 ? hands.get(s).score : m), hands.get(winners[0]).score);
      winners = winners.filter(s => compare(hands.get(s).score, top) === 0);
    }
    winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(p.amount / winners.length);
    let odd = p.amount - share * winners.length;
    for (const w of winners) { w.win += share + (odd > 0 ? 1 : 0); odd--; }
    // Ein Pot, um den keiner mehr mitspielt, ist nur ein zurückgegebener Einsatz
    if (p.eligible.length > 1 || n === 0) {
      t.results.push({ pot: n === 0 ? 'Pot' : `Nebenpot ${n}`, amount: p.amount, winners: winners.map(w => w.name), hand: showdown ? hands.get(winners[0]).name : null });
    }
  }
  const parts = [];
  for (const s of seated(t).filter(x => x.inHand)) {
    s.chips += s.win;
    const net = s.win - s.total;
    const st = s.stats;
    if (net > 0) st.wins++;
    if (showdown && !s.folded) { st.showdowns++; st.bestHand = Math.max(st.bestHand, hands.get(s).cat); }
    recordWin(s, net);
    st.bestWin = Math.max(st.bestWin, net);
    if (s.win) s.action = `Gewinnt ${euro(s.win)}`;
    saveSession(s);
    if (net) parts.push(`${s.name} ${net > 0 ? '+' : ''}${euro(net)}`);
  }
  const r = t.results[0];
  log(t, `Hand ${t.hand}: ${r ? r.winners.join(' und ') + (r.winners.length > 1 ? ' teilen' : ' gewinnt') + ' ' + euro(r.amount) + (r.hand ? ' mit ' + r.hand : '') : ''}. ${parts.join(', ')}`);
  t.phase = 'showdown'; t.street = null; t.pot = 0;
  later(t, RESULT_MS, () => newHand(t));
}

function newHand(t) {
  t.phase = 'waiting'; t.turn = null; t.reveal = false;
  for (const s of seated(t)) {
    const gone = s.awaySince && Date.now() - s.awaySince > AWAY_MS;
    if (s.leaving || gone) stand(t, s);
  }
  stopTimer(t);
  if (ready(t).length >= 2) startHand(t);
  else { for (const s of seated(t)) Object.assign(s, emptyHand()); t.board = []; t.results = []; }
}

// ---------- Aktionen vom Browser ----------
function control(t, user, b) {
  const a = String(b.action || '');
  const seat = seatOf(t, user.id);
  switch (a) {
    case 'sit': return sit(t, user, Number(b.seat));
    case 'fold': case 'check': case 'call': case 'raise': case 'allin': return seat ? act(t, seat, a, b.amount) : 'Du sitzt nicht am Tisch.';
    case 'rebuy': return seat ? rebuy(t, seat) : 'Du sitzt nicht am Tisch.';
    case 'sitout':
      if (!seat) return 'Du sitzt nicht am Tisch.';
      seat.sittingOut = !seat.sittingOut;
      log(t, seat.sittingOut ? `${seat.name} setzt ab der nächsten Hand aus.` : `${seat.name} spielt wieder mit.`);
      maybeStart(t);
      return null;
    case 'leave': if (seat) stand(t, seat); return null;
    case 'kick': {
      if (!isHost(t, user)) return 'Nur der Gastgeber kann Spieler vom Tisch nehmen.';
      const s = seatOf(t, Number(b.user));
      if (!s) return 'Dieser Spieler sitzt nicht am Tisch.';
      log(t, `${s.name} wurde vom Tisch genommen.`);
      stand(t, s);
      return null;
    }
    case 'settings':
      if (!isHost(t, user)) return 'Nur der Gastgeber ändert die Einstellungen.';
      if (playing(t) && 'sb' in b && Number(b.sb) !== t.sb) return 'Die Blinds lassen sich nur zwischen zwei Händen ändern.';
      applySettings(t, b);
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

function remove(t) {
  stopTimer(t);
  // Was in der laufenden Hand gesetzt ist, geht zurück, dann wird jede Sitzung abgeschlossen
  for (const s of seated(t)) {
    if (playing(t) && s.inHand) s.chips += s.total;
    Object.assign(s, emptyHand());
    saveSession(s, true);
  }
  for (const c of t.clients) { send(c.res, 'closed', {}); c.res.end(); }
  tables.delete(t.id);
}

// Leere Tische schließen; wer lange weg ist, steht zwischen zwei Händen auf
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
  config, create, get, list, state, control, join, remove, broadcast, isHost, tableOf, euro,
  userTotals, recentSessions, leaderboard, resetStats, best, score5, compare, newDeck, pots,
  BLINDS, HANDS, MAX_SEATS,
  _tables: tables,
};
