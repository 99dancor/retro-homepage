'use strict';
// Blackjack (Startmenü → 🃏 Blackjack): Tische leben wie die Musik-Lobbys nur im Arbeitsspeicher und schicken
// Änderungen per Server-Sent Events. Gemischt und gegeben wird nur hier auf dem Server; die verdeckte Karte des
// Dealers verlässt ihn erst, wenn sie aufgedeckt ist. Gespielt wird mit Spielgeld.
//
// Bilanz: Jede Sitzung an einem Tisch ist eine Zeile in bj_sessions mit den Chips und dem insgesamt eingekauften
// Geld (Start-Buy-in plus alle Nachkäufe). Bilanz eines Kontos = Summe aus (Chips − eingekauft) über alle Sitzungen.
// Beispiel: 1.000 € Start, drei Nachkäufe zu 1.000 €, mit 500 € aufgehört → 500 − 4.000 = −3.500 €.
// Der Stand wird nach jeder Hand gespeichert; ein Neustart des Servers kostet höchstens die laufende Hand.
const crypto = require('node:crypto');
const { db, now, getSetting } = require('./db');

const MAX_TABLES = 30;
const MAX_SEATS = 5;
const EMPTY_MS = 10 * 60 * 1000;   // leere Tische verschwinden nach 10 Minuten
const AWAY_MS = 90 * 1000;         // wer so lange kein Fenster mehr offen hat, steht auf
const BET_MS = 15 * 1000;          // Zeit für Einsätze, sobald der erste gesetzt hat
const RESULT_MS = 5000;            // Ergebnis zeigen, dann neue Runde
const DEAL_MS = 900;               // kurze Pause vor dem Geben, wenn alle gesetzt haben
const DEALER_MS = 750;             // Pause zwischen den Karten des Dealers
const MIN_BETS = [1, 5, 10, 25, 50, 100];
const MAX_BETS = [50, 100, 250, 500, 1000, 2500, 5000];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const int = (v, d, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
function config() {
  return {
    buyin: int(getSetting('bj_buyin'), 1000, 1, 1e9),
    rebuyBelow: int(getSetting('bj_rebuy_below'), 200, 0, 1e9),
    decks: int(getSetting('bj_decks'), 6, 1, 8),
    h17: getSetting('bj_h17') === '1',
    turn: int(getSetting('bj_turn'), 30, 5, 300),
  };
}
const euro = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-DE') + ' €';

// ---------- Karten ----------
const cardValue = c => (c.r === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));
function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { t += cardValue(c); if (c.r === 'A') aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 };
}
const isBlackjack = cards => cards.length === 2 && total(cards).total === 21;
function newShoe(decks) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  return shoe;
}

// ---------- Sitzungen in der Datenbank ----------
// Beim Start war der Server vielleicht mitten im Spiel weg: offene Sitzungen gelten als beendet
db.prepare('UPDATE bj_sessions SET ended_at = updated_at WHERE ended_at IS NULL').run();

function openSession(t, seat) {
  const ts = now();
  seat.sessionId = Number(db.prepare(`INSERT INTO bj_sessions(user_id, table_name, chips, bought, buyins, started_at, updated_at)
                                      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(seat.userId, t.name, seat.chips, seat.bought, seat.buyins, ts, ts).lastInsertRowid);
}
function saveSession(seat, end = false) {
  const s = seat.stats;
  db.prepare(`UPDATE bj_sessions SET chips = ?, bought = ?, buyins = ?, hands = ?, wins = ?, losses = ?, pushes = ?, blackjacks = ?,
              best_win = ?, best_streak = ?, updated_at = ?${end ? ', ended_at = ?' : ''} WHERE id = ?`)
    .run(...[seat.chips, seat.bought, seat.buyins, s.hands, s.wins, s.losses, s.pushes, s.blackjacks, s.bestWin, s.bestStreak, now()], ...(end ? [now()] : []), seat.sessionId);
}

// Bilanz und Zahlen eines Kontos über alle Sitzungen
function userTotals(userId) {
  return db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(chips - bought), 0) AS balance, COALESCE(SUM(buyins), 0) AS buyins,
                     COALESCE(SUM(bought), 0) AS bought, COALESCE(SUM(hands), 0) AS hands, COALESCE(SUM(wins), 0) AS wins,
                     COALESCE(SUM(losses), 0) AS losses, COALESCE(SUM(pushes), 0) AS pushes, COALESCE(SUM(blackjacks), 0) AS blackjacks,
                     COALESCE(MAX(best_win), 0) AS best_win, COALESCE(MAX(best_streak), 0) AS best_streak, MAX(updated_at) AS last
                     FROM bj_sessions WHERE user_id = ?`).get(userId);
}
function recentSessions(userId, limit = 10) {
  return db.prepare('SELECT * FROM bj_sessions WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT ?').all(userId, limit);
}
function leaderboard() {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility,
                     SUM(s.chips - s.bought) AS balance, SUM(s.buyins) AS buyins, SUM(s.bought) AS bought, SUM(s.hands) AS hands,
                     SUM(s.wins) AS wins, SUM(s.blackjacks) AS blackjacks, MAX(s.best_win) AS best_win, MAX(s.best_streak) AS best_streak
                     FROM bj_sessions s JOIN users u ON u.id = s.user_id WHERE u.disabled = 0 AND s.hands > 0
                     GROUP BY u.id ORDER BY balance DESC, hands DESC`).all();
}
function resetStats(userId) {
  if (userId) db.prepare('DELETE FROM bj_sessions WHERE user_id = ? AND ended_at IS NOT NULL').run(userId);
  else db.prepare('DELETE FROM bj_sessions WHERE ended_at IS NOT NULL').run();
}

// ---------- Tische ----------
const tables = new Map();

function create(user, opts) {
  if (tables.size >= MAX_TABLES) cleanup(true);
  if (tables.size >= MAX_TABLES) return null;
  const t = {
    id: crypto.randomBytes(5).toString('hex'), hostId: user.id, hostName: user.name,
    name: '', hidden: false, minBet: 10, maxBet: 500, seatCount: MAX_SEATS,
    seats: Array(MAX_SEATS).fill(null), clients: new Set(), emptySince: Date.now(),
    phase: 'betting', round: 0, dealer: [], holeHidden: true, shoe: [], turn: null, betDeadline: 0,
    timer: null, log: [], version: 0,
  };
  applySettings(t, { name: `Tisch von ${user.name}`, ...opts });
  tables.set(t.id, t);
  return t;
}
function applySettings(t, b) {
  if (typeof b.name === 'string' && b.name.trim()) t.name = b.name.trim().slice(0, 60);
  if ('hidden' in b) t.hidden = !!b.hidden;
  if (MIN_BETS.includes(Number(b.minBet))) t.minBet = Number(b.minBet);
  if (MAX_BETS.includes(Number(b.maxBet))) t.maxBet = Number(b.maxBet);
  if (t.maxBet < t.minBet) t.maxBet = MAX_BETS.find(m => m >= t.minBet);
  const n = Number(b.seats);
  // Weniger Plätze nur, wenn die wegfallenden frei sind
  if (n >= 1 && n <= MAX_SEATS && t.seats.slice(n).every(s => !s)) t.seatCount = n;
}

const get = id => tables.get(String(id)) || null;
const seated = t => t.seats.filter(Boolean);
const seatOf = (t, userId) => t.seats.find(s => s && s.userId === userId) || null;
const isHost = (t, user) => !!user && (user.isAdmin || user.id === t.hostId);
// Wo sitzt ein Konto gerade? Jeder darf nur an einem Tisch Platz nehmen.
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

function summary(t) {
  return {
    id: t.id, name: t.name, host: t.hostName, hidden: t.hidden, players: seated(t).length, seats: t.seatCount,
    viewers: viewers(t).length, minBet: t.minBet, maxBet: t.maxBet,
    status: t.phase === 'betting' ? (seated(t).length ? 'Wartet auf Einsätze' : 'Freie Plätze') : `Runde ${t.round} läuft`,
  };
}
function list(user) {
  return [...tables.values()].filter(t => !t.hidden || t.hostId === user.id || user.isAdmin || seatOf(t, user.id))
    .map(summary).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
}

const balanceOf = s => s.chips + s.hands.reduce((n, h) => n + (h.result ? 0 : h.bet), 0) - s.bought;
function handView(h) {
  const v = total(h.cards);
  return { cards: h.cards, bet: h.bet, total: v.total, soft: v.soft && v.total < 21, done: h.done, doubled: h.doubled, result: h.result, payout: h.payout };
}
function state(t) {
  const cfg = config();
  const dealer = t.holeHidden && t.dealer.length ? [t.dealer[0], null] : t.dealer;
  const shown = dealer.filter(Boolean);
  return {
    id: t.id, name: t.name, host: t.hostName, hostId: t.hostId, hidden: t.hidden, minBet: t.minBet, maxBet: t.maxBet, seatCount: t.seatCount,
    phase: t.phase, round: t.round, dealer, dealerTotal: shown.length ? total(shown).total : 0,
    seats: t.seats.slice(0, t.seatCount).map((s, i) => s && {
      i, id: s.userId, name: s.name, user: s.username, chips: s.chips, bet: s.bet, lastBet: s.lastBet, buyins: s.buyins, bought: s.bought,
      balance: balanceOf(s), hands: s.hands.map(handView), away: !online(t, s.userId), leaving: s.leaving,
      session: { hands: s.stats.hands, wins: s.stats.wins },
    }),
    turn: t.turn && { seat: t.turn.seat, hand: t.turn.hand, left: Math.max(0, t.turn.deadline - Date.now()) },
    betLeft: t.betDeadline ? Math.max(0, t.betDeadline - Date.now()) : 0,
    viewers: viewers(t), log: t.log.slice(0, 20), shoeLeft: t.shoe.length,
    rules: { buyin: cfg.buyin, rebuyBelow: cfg.rebuyBelow, decks: cfg.decks, h17: cfg.h17, turn: cfg.turn },
    minBets: MIN_BETS, maxBets: MAX_BETS, now: Date.now(), version: t.version,
  };
}

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(t) {
  t.version++;
  const s = state(t);
  for (const c of t.clients) send(c.res, 'state', s);
}
function later(t, ms, fn) {
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { t.timer = null; if (tables.has(t.id)) { fn(); broadcast(t); } }, ms);
  t.timer.unref?.();
}

// ---------- Platz nehmen, Nachkaufen, Aufstehen ----------
function sit(t, user, index) {
  if (seatOf(t, user.id)) return 'Du sitzt schon an diesem Tisch.';
  const other = tableOf(user.id);
  if (other) return `Du sitzt schon am Tisch „${other.name}“. Steh dort erst auf.`;
  let i = Number.isInteger(index) && index >= 0 && index < t.seatCount && !t.seats[index] ? index : t.seats.slice(0, t.seatCount).findIndex(s => !s);
  if (i < 0) return 'Alle Plätze sind besetzt.';
  const cfg = config();
  const seat = {
    userId: user.id, name: user.name, username: user.username, chips: cfg.buyin, bought: cfg.buyin, buyins: 1,
    bet: 0, lastBet: 0, hands: [], leaving: false, awaySince: 0, streak: 0,
    stats: { hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, bestWin: 0, bestStreak: 0 },
  };
  openSession(t, seat);
  t.seats[i] = seat;
  log(t, `${user.name} setzt sich mit ${euro(cfg.buyin)}.`);
  return null;
}
const inHand = s => s.hands.some(h => !h.result);
function rebuy(t, seat) {
  const cfg = config();
  if (inHand(seat)) return 'Nachkaufen geht erst nach dieser Hand.';
  if (seat.chips >= cfg.rebuyBelow) return `Nachkaufen geht erst, wenn du weniger als ${euro(cfg.rebuyBelow)} hast.`;
  seat.chips += cfg.buyin; seat.bought += cfg.buyin; seat.buyins++;
  saveSession(seat);
  log(t, `${seat.name} kauft für ${euro(cfg.buyin)} nach (${seat.buyins}. Buy-in).`);
  return null;
}
// Aufstehen: mitten in einer Hand erst, wenn sie entschieden ist
function stand(t, seat) {
  if (inHand(seat)) {
    seat.leaving = true;
    if (t.turn && t.seats[t.turn.seat] === seat) { seat.hands.forEach(h => { h.done = true; }); nextTurn(t); }
    return;
  }
  const i = t.seats.indexOf(seat);
  if (i < 0) return;
  saveSession(seat, true);
  t.seats[i] = null;
  log(t, `${seat.name} steht auf: ${euro(seat.chips)} Chips, Bilanz ${euro(seat.chips - seat.bought)}.`);
  if (t.phase === 'betting') maybeDeal(t);
}

// ---------- Ablauf einer Runde ----------
function placeBet(t, seat, amount) {
  if (t.phase !== 'betting') return 'Gerade läuft eine Runde. Setz in der nächsten.';
  const a = Math.floor(Number(amount) || 0);
  if (a !== 0 && (a < t.minBet || a > t.maxBet)) return `Der Einsatz muss zwischen ${euro(t.minBet)} und ${euro(t.maxBet)} liegen.`;
  if (a > seat.chips) return 'So viele Chips hast du nicht.';
  seat.bet = a;
  if (a && !t.betDeadline) t.betDeadline = Date.now() + BET_MS;
  maybeDeal(t);
  return null;
}
// Gegeben wird, wenn alle Anwesenden gesetzt haben oder die Zeit um ist
function maybeDeal(t) {
  const players = seated(t);
  const betting = players.filter(s => s.bet > 0);
  if (!betting.length) { t.betDeadline = 0; clearTimeout(t.timer); t.timer = null; return; }
  const waiting = players.filter(s => !s.bet && online(t, s.userId) && !s.leaving && s.chips >= t.minBet);
  if (!waiting.length) later(t, DEAL_MS, () => deal(t));
  else later(t, Math.max(0, t.betDeadline - Date.now()), () => deal(t));
}

function draw(t) {
  if (!t.shoe.length) t.shoe = newShoe(config().decks);
  return t.shoe.pop();
}
function deal(t) {
  const cfg = config();
  // Neu gemischt wird vor einer Runde, wenn nur noch ein Viertel im Schlitten ist
  if (t.shoe.length < cfg.decks * 52 * 0.25) { t.shoe = newShoe(cfg.decks); log(t, `🔀 Neu gemischt (${cfg.decks} ${cfg.decks === 1 ? 'Deck' : 'Decks'}).`); }
  const players = seated(t).filter(s => s.bet > 0 && s.bet <= s.chips);
  if (!players.length) { t.betDeadline = 0; return; }
  t.round++;
  t.phase = 'playing'; t.betDeadline = 0; t.holeHidden = true;
  for (const s of players) {
    s.chips -= s.bet;
    s.lastBet = s.bet;
    s.hands = [{ cards: [], bet: s.bet, done: false, doubled: false, split: false, result: null, payout: 0 }];
    s.bet = 0;
  }
  for (const s of seated(t)) if (!players.includes(s)) s.bet = 0;
  t.dealer = [];
  for (let k = 0; k < 2; k++) {
    for (const s of players) s.hands[0].cards.push(draw(t));
    t.dealer.push(draw(t));
  }
  // Hat der Dealer Blackjack, ist die Runde sofort vorbei (er schaut bei Ass oder Zehn nach)
  if (isBlackjack(t.dealer)) { t.holeHidden = false; log(t, `Runde ${t.round}: Dealer hat Blackjack.`); return settle(t); }
  for (const s of players) if (isBlackjack(s.hands[0].cards)) s.hands[0].done = true;
  nextTurn(t);
}

function nextTurn(t) {
  for (let i = 0; i < t.seatCount; i++) {
    const s = t.seats[i];
    if (!s) continue;
    const h = s.hands.findIndex(x => !x.done && !x.result);
    if (h < 0) continue;
    // Wer aufstehen will, hält einfach
    if (s.leaving) { s.hands.forEach(x => { x.done = true; }); continue; }
    const secs = online(t, s.userId) ? config().turn : 3;
    t.turn = { seat: i, hand: h, deadline: Date.now() + secs * 1000 };
    later(t, secs * 1000, () => { s.hands[h].done = true; log(t, `${s.name}: Zeit abgelaufen, hält.`); nextTurn(t); });
    return;
  }
  t.turn = null;
  dealerPlay(t);
}

function act(t, seat, action) {
  if (t.phase !== 'playing' || !t.turn || t.seats[t.turn.seat] !== seat) return 'Du bist nicht dran.';
  const h = seat.hands[t.turn.hand];
  const two = h.cards.length === 2;
  switch (action) {
    case 'hit':
      h.cards.push(draw(t));
      if (total(h.cards).total >= 21) h.done = true;
      break;
    case 'stand': h.done = true; break;
    case 'double':
      if (!two || h.splitAces) return 'Verdoppeln geht nur mit den ersten zwei Karten.';
      if (seat.chips < h.bet) return 'Für das Verdoppeln fehlen dir Chips.';
      seat.chips -= h.bet; h.bet *= 2; h.doubled = true;
      h.cards.push(draw(t)); h.done = true;
      break;
    case 'split': {
      if (!two || seat.hands.length > 1 || cardValue(h.cards[0]) !== cardValue(h.cards[1])) return 'Teilen geht nur einmal mit zwei gleichwertigen Karten.';
      if (seat.chips < h.bet) return 'Für das Teilen fehlen dir Chips.';
      seat.chips -= h.bet;
      const aces = h.cards[0].r === 'A';
      const second = { cards: [h.cards.pop(), draw(t)], bet: h.bet, done: aces, doubled: false, split: true, splitAces: aces, result: null, payout: 0 };
      h.cards.push(draw(t)); h.split = true; h.splitAces = aces; h.done = aces;
      seat.hands.push(second);
      // Geteilte Asse bekommen nur noch eine Karte; 21 ist fertig
      for (const x of seat.hands) if (total(x.cards).total === 21) x.done = true;
      break;
    }
    default: return 'Unbekannter Zug.';
  }
  if (h.done) nextTurn(t);
  else { t.turn.deadline = Date.now() + config().turn * 1000; later(t, config().turn * 1000, () => { h.done = true; nextTurn(t); }); }
  return null;
}

function dealerPlay(t) {
  t.phase = 'dealer';
  t.holeHidden = false;
  const live = seated(t).some(s => s.hands.some(h => total(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.split)));
  const step = () => {
    const v = total(t.dealer);
    if (live && (v.total < 17 || (v.total === 17 && v.soft && config().h17))) {
      t.dealer.push(draw(t));
      later(t, DEALER_MS, step);
    } else later(t, DEALER_MS, () => settle(t));
  };
  later(t, DEALER_MS, step);
}

function settle(t) {
  clearTimeout(t.timer); t.timer = null;
  t.phase = 'result'; t.turn = null; t.holeHidden = false;
  const d = total(t.dealer).total, dealerBj = isBlackjack(t.dealer);
  const parts = [];
  for (const s of seated(t)) {
    if (!s.hands.length) continue;
    let net = 0;
    for (const h of s.hands) {
      const p = total(h.cards).total, bj = isBlackjack(h.cards) && !h.split;
      if (bj && !dealerBj) { h.result = 'blackjack'; h.payout = h.bet + Math.floor(h.bet * 1.5); }
      else if (p > 21) { h.result = 'bust'; h.payout = 0; }
      else if (dealerBj) { h.result = bj ? 'push' : 'lose'; h.payout = bj ? h.bet : 0; }
      else if (d > 21 || p > d) { h.result = 'win'; h.payout = h.bet * 2; }
      else if (p === d) { h.result = 'push'; h.payout = h.bet; }
      else { h.result = 'lose'; h.payout = 0; }
      s.chips += h.payout;
      net += h.payout - h.bet;
      const st = s.stats;
      st.hands++;
      if (h.result === 'blackjack') st.blackjacks++;
      if (h.result === 'win' || h.result === 'blackjack') { st.wins++; s.streak++; st.bestStreak = Math.max(st.bestStreak, s.streak); }
      else if (h.result === 'push') st.pushes++;
      else { st.losses++; s.streak = 0; }
    }
    s.stats.bestWin = Math.max(s.stats.bestWin, net);
    saveSession(s);
    parts.push(`${s.name} ${net > 0 ? '+' : ''}${euro(net)}`);
  }
  log(t, `Runde ${t.round}: Dealer ${d > 21 ? 'überkauft (' + d + ')' : dealerBj ? 'Blackjack' : d}. ${parts.join(', ')}`);
  later(t, RESULT_MS, () => newRound(t));
}

function newRound(t) {
  t.phase = 'betting'; t.dealer = []; t.holeHidden = true; t.turn = null; t.betDeadline = 0;
  for (const s of seated(t)) {
    s.hands = [];
    const gone = s.awaySince && Date.now() - s.awaySince > AWAY_MS;
    if (s.leaving || gone) stand(t, s);
  }
  maybeDeal(t);
}

// ---------- Aktionen vom Browser ----------
// Gibt eine Fehlermeldung zurück oder null
function control(t, user, b) {
  const a = String(b.action || '');
  const seat = seatOf(t, user.id);
  switch (a) {
    case 'sit': return sit(t, user, Number(b.seat));
    case 'bet': return seat ? placeBet(t, seat, b.amount) : 'Setz dich erst an den Tisch.';
    case 'hit': case 'stand': case 'double': case 'split': return seat ? act(t, seat, a) : 'Du sitzt nicht am Tisch.';
    case 'rebuy': return seat ? rebuy(t, seat) : 'Du sitzt nicht am Tisch.';
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
      if (t.phase !== 'betting' && ('minBet' in b || 'maxBet' in b)) return 'Einsätze lassen sich nur zwischen zwei Runden ändern.';
      applySettings(t, b);
      for (const s of seated(t)) if (s.bet && (s.bet < t.minBet || s.bet > t.maxBet)) s.bet = 0;
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
    if (t.phase === 'betting') maybeDeal(t);
    broadcast(t);
  };
}

function remove(t) {
  clearTimeout(t.timer);
  // Einsätze der laufenden Hand gehen zurück, dann wird jede Sitzung abgeschlossen
  for (const s of seated(t)) {
    for (const h of s.hands) if (!h.result) s.chips += h.bet;
    s.hands = [];
    saveSession(s, true);
  }
  for (const c of t.clients) { send(c.res, 'closed', {}); c.res.end(); }
  tables.delete(t.id);
}

// Leere Tische schließen; wer lange weg ist, steht zwischen zwei Runden auf
function cleanup(force = false) {
  const ts = Date.now();
  for (const t of tables.values()) {
    if (!t.clients.size && (force || ts - t.emptySince > EMPTY_MS)) { remove(t); continue; }
    if (t.phase === 'betting') {
      const gone = seated(t).filter(s => s.awaySince && ts - s.awaySince > AWAY_MS);
      gone.forEach(s => stand(t, s));
      if (gone.length) broadcast(t);
    }
  }
}
setInterval(cleanup, 30e3).unref();

module.exports = {
  config, create, get, list, state, control, join, remove, broadcast, isHost, tableOf, euro,
  userTotals, recentSessions, leaderboard, resetStats, total, isBlackjack, newShoe,
  MIN_BETS, MAX_BETS, MAX_SEATS,
  _tables: tables,
};
