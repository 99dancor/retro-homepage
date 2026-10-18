'use strict';
// Flip 7 (Startmenü → Spiele und Apps → Kartenspiele → 7️⃣ Flip 7) nach den Regeln von The Op: 94 Karten (Zahlen 0–12, von
// jeder Zahl so viele Karten wie ihr Wert, dazu Bonuskarten +2 bis +10 und ×2 sowie je drei Mal Einfrieren, Drei ziehen und
// Zweite Chance). Reihum zieht jeder eine Karte („Karte!“) oder hört auf („Genug“). Eine doppelte Zahl heißt Pech: null
// Punkte in dieser Runde. Wer sieben verschiedene Zahlen hat, schafft Flip 7, bekommt 15 Punkte extra und beendet die Runde
// für alle. Gespielt wird, bis am Ende einer Runde jemand allein vorne mindestens 200 Punkte hat (am Tisch einstellbar).
// Alle Karten liegen offen. Der Stapel wird zwischen den Runden nicht neu gemischt, erst wenn er leer ist.
const { createGame, shuffle, rank } = require('./cardtable');

const TARGETS = [100, 200, 300];
const ROUND_MS = 8000;
const BONUS = 15;
const ACTIONS = { freeze: 'Einfrieren', flip3: 'Drei ziehen', second: 'Zweite Chance' };

// t: n Zahl, m Bonus, a Aktion; k macht jede Karte eindeutig
function newDeck() {
  const deck = [];
  let k = 0;
  deck.push({ k: k++, t: 'n', v: 0 });
  for (let v = 1; v <= 12; v++) for (let n = 0; n < v; n++) deck.push({ k: k++, t: 'n', v });
  for (const v of [2, 4, 6, 8, 10, 'x2']) deck.push({ k: k++, t: 'm', v });
  for (const v of Object.keys(ACTIONS)) for (let n = 0; n < 3; n++) deck.push({ k: k++, t: 'a', v });
  return shuffle(deck);
}
const label = c => (c.t === 'n' ? String(c.v) : c.t === 'm' ? (c.v === 'x2' ? '×2' : '+' + c.v) : ACTIONS[c.v]);

// Punkte einer Runde: Zahlen zusammen, ×2 verdoppelt nur die Zahlen, dann Bonuskarten und 15 für Flip 7
function roundPoints(s) {
  if (s.status === 'bust') return 0;
  let n = s.nums.reduce((m, c) => m + c.v, 0);
  if (s.mods.some(c => c.v === 'x2')) n *= 2;
  n += s.mods.reduce((m, c) => m + (c.v === 'x2' ? 0 : c.v), 0);
  return n + (s.flip7 ? BONUS : 0);
}

const T = createGame({
  id: 'flip7', prefix: 'f7', title: 'Flip 7', tableWord: 'Flip-7-Tisch', minSeats: 2, maxSeats: 8, defaultSeats: 4, turn: 20,
  defaults: { target: 200 },
  options(t, b) { if (TARGETS.includes(Number(b.target))) t.opts.target = Number(b.target); },
  describe: t => `bis ${t.opts.target} Punkte`,
  start, act, drop, view, seatView,
});

const inRound = s => !!s && s.inGame && s.status === 'in';
const anyIn = t => T.seated(t).some(inRound);

function drawTop(t) {
  const g = t.g;
  if (!g.deck.length && g.discard.length) { g.deck = shuffle(g.discard); g.discard = []; T.log(t, 'Der Stapel ist leer, die abgelegten Karten werden gemischt.'); }
  return g.deck.pop() || null;
}

function start(t, players) {
  t.g = { deck: newDeck(), discard: [], dealer: t.seats.indexOf(players[Math.floor(Math.random() * players.length)]), round: 0, cur: -1, stack: [], ended: false, over: null };
  for (const s of players) Object.assign(s, { total: 0, best: 0, f7: 0, nums: [], mods: [], sc: null, status: 'in', flip7: false, last: 0 });
  T.log(t, `Spiel ${t.game}: gespielt wird bis ${t.opts.target} Punkte.`);
  startRound(t);
}

function startRound(t) {
  const g = t.g;
  g.round++;
  if (g.round > 1 || !t.seats[g.dealer]) g.dealer = T.nextIndex(t, g.dealer);
  g.over = null; g.ended = false; g.stack = [];
  const players = T.seated(t).filter(s => s.inGame);
  for (const s of players) Object.assign(s, { nums: [], mods: [], sc: null, status: 'in', flip7: false });
  // Erst bekommt jeder eine Karte offen, links vom Geber angefangen; Aktionskarten wirken sofort
  const order = [];
  for (let j = T.nextIndex(t, g.dealer); order.length < players.length; j = T.nextIndex(t, j)) order.push(j);
  g.stack.push({ k: 'deal', order, i: 0 });
  T.log(t, `Runde ${g.round}: ${t.seats[g.dealer].name} gibt.`);
  advance(t);
}

// Eine gezogene Karte landet bei Platz i. frame ist das laufende „Drei ziehen“, falls es eins gibt.
function apply(t, i, c, frame) {
  const g = t.g, s = t.seats[i];
  if (c.t === 'n') {
    if (s.nums.some(x => x.v === c.v)) {
      if (s.sc) {
        g.discard.push(c, s.sc); s.sc = null;
        T.log(t, `${s.name} zieht noch eine ${c.v}, die Zweite Chance rettet.`);
      } else {
        s.nums.push(c); s.status = 'bust';
        T.log(t, `${s.name} zieht noch eine ${c.v}: Pech, keine Punkte in dieser Runde.`);
      }
      return;
    }
    s.nums.push(c);
    T.log(t, `${s.name} zieht eine ${c.v}.`);
    if (s.nums.length === 7) { s.flip7 = true; g.ended = true; T.log(t, `${s.name} hat sieben verschiedene Zahlen: FLIP 7! 15 Punkte extra, die Runde ist vorbei.`); }
  } else if (c.t === 'm') {
    s.mods.push(c);
    T.log(t, `${s.name} zieht ${label(c)}.`);
  } else if (c.v === 'second' && !s.sc) {
    s.sc = c;
    T.log(t, `${s.name} zieht eine Zweite Chance.`);
  } else if (c.v !== 'second' && frame) {
    frame.later.push(c);
    T.log(t, `${s.name} zieht ${label(c)}, das kommt nach den drei Karten dran.`);
  } else {
    T.log(t, `${s.name} zieht ${label(c)}` + (c.v === 'second' ? ', hat aber schon eine und muss sie weitergeben.' : '.'));
    g.stack.push({ k: 'choose', seat: i, card: c });
  }
}

// Wen darf der Spieler mit dieser Aktionskarte treffen? Einfrieren und Drei ziehen: alle, die noch dabei sind (auch sich
// selbst). Eine zweite Zweite Chance geht an jemand anderen, der noch keine hat.
function targets(t, f) {
  const out = [];
  for (let j = 0; j < t.seatCount; j++) {
    const s = t.seats[j];
    if (!inRound(s)) continue;
    if (f.card.v === 'second' && (j === f.seat || s.sc)) continue;
    out.push(j);
  }
  return out;
}
function resolve(t, f, j) {
  const g = t.g, s = t.seats[j], by = t.seats[f.seat];
  const who = j === f.seat ? 'sich selbst' : s.name;
  if (f.card.v === 'second') { s.sc = f.card; T.log(t, `${by.name} gibt die Zweite Chance an ${s.name}.`); return; }
  g.discard.push(f.card);
  if (f.card.v === 'freeze') { s.status = 'frozen'; T.log(t, `${by.name} friert ${who} ein: ${s.name} hört mit ${roundPoints(s)} Punkten auf.`); }
  else { g.stack.push({ k: 'flip', target: j, left: 3, later: [] }); T.log(t, `${by.name} lässt ${who} drei Karten ziehen.`); }
}

// Weiter, bis jemand etwas entscheiden muss oder die Runde vorbei ist
function advance(t) {
  const g = t.g;
  for (let guard = 0; guard < 500; guard++) {
    if (g.ended || !anyIn(t)) return endRound(t);
    const f = g.stack[g.stack.length - 1];
    if (!f) {
      if (!inRound(t.seats[g.cur])) g.cur = T.nextIndex(t, g.cur, inRound);
      return T.waitFor(t, 'turn', g.cur, () => { const s = t.seats[g.cur]; T.log(t, `${s.name}: Zeit abgelaufen.`); stay(t, s); });
    }
    if (f.k === 'next') { g.stack.pop(); g.cur = T.nextIndex(t, g.cur, inRound); continue; }
    if (f.k === 'deal') {
      if (f.i >= f.order.length) { g.stack.pop(); g.cur = T.nextIndex(t, g.dealer, inRound); continue; }
      const j = f.order[f.i++];
      if (!inRound(t.seats[j])) continue;
      const c = drawTop(t);
      if (c) apply(t, j, c, null);
      continue;
    }
    if (f.k === 'flip') {
      const s = t.seats[f.target];
      if (!inRound(s) || f.left <= 0) {
        g.stack.pop();
        // Aktionskarten aus den drei Karten kommen danach dran, in der gezogenen Reihenfolge – aber nur, wenn er noch dabei ist
        if (inRound(s)) for (const c of f.later.reverse()) g.stack.push({ k: 'choose', seat: f.target, card: c });
        else g.discard.push(...f.later);
        continue;
      }
      f.left--;
      const c = drawTop(t);
      if (!c) { f.left = 0; continue; }
      apply(t, f.target, c, f);
      continue;
    }
    // f.k === 'choose'
    const list = t.seats[f.seat] ? targets(t, f) : [];
    if (!list.length) { g.stack.pop(); g.discard.push(f.card); if (f.card.v === 'second') T.log(t, 'Niemand kann die Zweite Chance nehmen, sie kommt weg.'); continue; }
    if (list.length === 1) { g.stack.pop(); resolve(t, f, list[0]); continue; }
    return T.waitFor(t, 'target', f.seat, () => {
      // Zeit abgelaufen: Einfrieren trifft den Besten der anderen, Drei ziehen den Ersten der anderen, sonst sich selbst
      const others = list.filter(j => j !== f.seat);
      const pick = f.card.v === 'freeze' && others.length ? others.reduce((a, b) => (t.seats[b].total + roundPoints(t.seats[b]) > t.seats[a].total + roundPoints(t.seats[a]) ? b : a)) : others[0] ?? list[0];
      T.log(t, `${t.seats[f.seat].name}: Zeit abgelaufen.`);
      g.stack.pop(); resolve(t, f, pick); advance(t);
    });
  }
  return endRound(t);
}

function stay(t, s) {
  s.status = 'stayed';
  T.log(t, `${s.name} hat genug und bleibt bei ${roundPoints(s)} Punkten.`);
  t.g.cur = T.nextIndex(t, t.g.cur, inRound);
  advance(t);
}

function act(t, s, a, b) {
  const g = t.g, i = t.seats.indexOf(s), f = g.stack[g.stack.length - 1];
  if (g.over) return 'Die Runde ist vorbei, gleich wird neu gegeben.';
  switch (a) {
    case 'hit': case 'stay': {
      if (f || g.cur !== i || !inRound(s)) return 'Du bist nicht dran.';
      if (a === 'stay') { stay(t, s); return null; }
      g.stack.push({ k: 'next' });
      const c = drawTop(t);
      if (c) apply(t, i, c, null);
      else T.log(t, 'Es sind keine Karten mehr da.');
      advance(t);
      return null;
    }
    case 'target': {
      if (!f || f.k !== 'choose' || f.seat !== i) return 'Du musst gerade niemanden wählen.';
      const j = Number(b.seat);
      if (!targets(t, f).includes(j)) return f.card.v === 'second' ? 'Die Zweite Chance geht nur an jemand anderen, der noch dabei ist und keine hat.' : 'Diesen Spieler kannst du nicht wählen.';
      g.stack.pop();
      resolve(t, f, j);
      advance(t);
      return null;
    }
  }
  return undefined;
}

function endRound(t) {
  const g = t.g;
  T.stopTimer(t);
  const players = T.seated(t).filter(s => s.inGame);
  for (const s of players) {
    const pts = roundPoints(s);
    s.last = pts; s.total += pts; s.best = Math.max(s.best, pts);
    if (s.flip7) s.f7++;
    g.discard.push(...s.nums, ...s.mods, ...(s.sc ? [s.sc] : []));
  }
  // Angefangene Aktionen verfallen
  for (const f of g.stack) { if (f.card) g.discard.push(f.card); if (f.later) g.discard.push(...f.later); }
  g.stack = [];
  g.over = { rows: players.map(s => ({ name: s.name, user: s.username, nums: s.nums, mods: s.mods, status: s.status, flip7: s.flip7, points: s.last, total: s.total })) };
  T.log(t, `Runde ${g.round} vorbei: ` + players.map(s => `${s.name} ${s.last}`).join(', ') + '.');
  const best = Math.max(...players.map(s => s.total));
  const leaders = players.filter(s => s.total === best);
  if (best >= t.opts.target && leaders.length === 1) return finishGame(t);
  if (best >= t.opts.target) T.log(t, `Gleichstand mit ${best} Punkten: noch eine Runde.`);
  T.pause(t, 'round', ROUND_MS, () => startRound(t));
}

function finishGame(t) {
  const g = t.g;
  const places = rank(t.players, s => s.total || 0);
  T.finish(t, t.players.map(s => ({
    seat: s, place: places.get(s), won: places.get(s) === 1 && !s.quit, score: s.total || 0, best: s.best || 0, bonus: s.f7 || 0, rounds: g.round,
    note: `${s.total || 0} Punkte` + (s.f7 ? `, ${s.f7}× Flip 7` : ''),
  })), { last: g.over });
}

// Aufgestanden: Karten weg, offene Aktionen von ihm oder gegen ihn fallen weg; bleibt nur einer, gewinnt er
function drop(t, s, i) {
  const g = t.g;
  g.discard.push(...(s.nums || []), ...(s.mods || []), ...(s.sc ? [s.sc] : []));
  s.nums = []; s.mods = []; s.sc = null; s.status = 'out';
  if (T.seated(t).filter(x => x.inGame).length < 2) return finishGame(t);
  if (g.over) return;
  g.stack = g.stack.filter(f => {
    if ((f.k === 'choose' && f.seat === i) || (f.k === 'flip' && f.target === i)) { if (f.card) g.discard.push(f.card); if (f.later) g.discard.push(...f.later); return false; }
    return true;
  });
  advance(t);
}

function seatView(t, s) {
  return { nums: s.nums || [], mods: s.mods || [], sc: !!s.sc, status: s.status, flip7: !!s.flip7, total: s.total || 0, points: s.nums ? roundPoints(s) : 0, f7: s.f7 || 0 };
}

function view(t, me, out) {
  const g = t.g, i = me ? t.seats.indexOf(me) : -1;
  const f = g.stack[g.stack.length - 1];
  const choose = f && f.k === 'choose' && t.turn && t.turn.kind === 'target' ? { seat: f.seat, card: f.card, targets: targets(t, f) } : null;
  out.f7 = { deck: g.deck.length, discard: g.discard.length, round: g.round, dealer: g.dealer, cur: !f && !g.over ? g.cur : -1, choose, over: g.over };
  if (!me) return;
  out.options = {
    hit: !f && !g.over && g.cur === i && inRound(me),
    stay: !f && !g.over && g.cur === i && inRound(me),
    targets: choose && choose.seat === i ? choose.targets : [],
  };
}

module.exports = Object.assign(T, { info: { icon: '7️⃣', name: 'Flip 7', script: 'flip7.js', intro: 'Das Zockerspiel für 2 bis 8 Mitglieder: Karte für Karte ziehen, aber keine Zahl doppelt. Wer sieben verschiedene Zahlen schafft, hat Flip 7. Spiele, Siege und beste Runden landen in deinem Profil.' }, newDeck, roundPoints, TARGETS, _advance: advance, _startRound: startRound });
