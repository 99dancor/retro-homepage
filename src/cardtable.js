'use strict';
// Gemeinsamer Unterbau für UNO, Flip 7 und Pilli Pilli (Startmenü → Spiele und Apps → Kartenspiele): Tische nur im
// Arbeitsspeicher, Plätze, „Bereit“, Aufstehen, Gastgeber, Live-Stand per Server-Sent Events und die Ergebnisse in
// cg_results. Abgeschaut von src/durak.js; die Regeln stecken in src/uno.js, src/flip7.js und src/pilli.js und hängen
// sich über ein paar Haken ein:
//   rules.start(t, players)        neues Spiel geben (t.g gehört dem Spiel)
//   rules.act(t, seat, action, b)  Zug eines Mitspielers → Fehlertext, null (geklappt) oder undefined (unbekannt)
//   rules.drop(t, seat, i)         jemand steht mitten im Spiel auf (Platz ist schon frei)
//   rules.view(t, me, out)         was der Betrachter sieht; fremde Handkarten nie
//   rules.seatView(t, s)           Zusatzfelder pro Platz (Kartenzahl, Punkte …)
//   rules.options(t, b)            Regeln des Tisches (nur zwischen zwei Spielen)
// Ein Spiel endet mit finish(t, rows): eine Zeile pro Mitspieler, auch für die, die aufgestanden sind.
// Steht t.manual (Spieltisch mit „Nächste Runde: der Gastgeber“), startet nur der Gastgeber ein Spiel („start“), „Bereit“
// ist dann ein Zeichen an ihn; auch die Pause am Ende einer Runde (pause mit kind 'round') wartet auf seinen Klick.
const crypto = require('node:crypto');
const { db, now, getSetting } = require('./db');

const MAX_TABLES = 30;
const EMPTY_MS = 10 * 60 * 1000;   // leere Tische verschwinden nach 10 Minuten
const AWAY_MS = 90 * 1000;         // wer so lange kein Fenster mehr offen hat, steht nach dem Spiel auf
const START_MS = 3000;             // alle bereit → kurz warten, dann wird gegeben
const OFFLINE_S = 3;               // Bedenkzeit für Spieler ohne offenes Fenster

const int = (v, d, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Ergebnisse in der Datenbank ----------
function userTotals(game, userId) {
  return db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins, COALESCE(SUM(quit), 0) AS quits, COALESCE(SUM(rounds), 0) AS rounds,
                     COALESCE(SUM(bonus), 0) AS bonus, COALESCE(MAX(best), 0) AS best, MAX(score) AS top, MIN(score) AS low, MAX(ended_at) AS last
                     FROM cg_results WHERE game = ? AND user_id = ?`).get(game, userId);
}
function recentGames(game, userId, limit = 20) {
  return db.prepare('SELECT * FROM cg_results WHERE game = ? AND user_id = ? ORDER BY ended_at DESC, id DESC LIMIT ?').all(game, userId, limit);
}
function leaderboard(game) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility,
                     COUNT(*) AS games, SUM(r.won) AS wins, SUM(r.bonus) AS bonus, MAX(r.best) AS best, SUM(r.rounds) AS rounds, MAX(r.score) AS top, MIN(r.score) AS low
                     FROM cg_results r JOIN users u ON u.id = r.user_id WHERE r.game = ? AND u.disabled = 0
                     GROUP BY u.id ORDER BY wins DESC, (1.0 * wins / games) DESC, games DESC`).all(game);
}
function resetStats(game, userId) {
  if (userId) db.prepare('DELETE FROM cg_results WHERE game = ? AND user_id = ?').run(game, userId);
  else db.prepare('DELETE FROM cg_results WHERE game = ?').run(game);
}

// ---------- Ein Spiel mit eigenen Tischen ----------
function createGame(rules) {
  const tables = new Map();
  const { id: GAME, prefix, minSeats = 2, maxSeats = 8, defaultSeats = 4 } = rules;
  const config = () => ({ turn: int(getSetting(prefix + '_turn'), rules.turn || 30, 5, 300) });

  function create(user, opts) {
    if (tables.size >= MAX_TABLES) cleanup(true);
    if (tables.size >= MAX_TABLES) return null;
    const t = {
      id: crypto.randomBytes(5).toString('hex'), hostId: user.id, hostName: user.name,
      name: '', hidden: false, seatCount: defaultSeats, opts: { ...rules.defaults },
      seats: Array(maxSeats).fill(null), clients: new Set(), emptySince: Date.now(),
      phase: 'waiting', game: 0, players: [], g: null, turn: null, result: null, timer: null, log: [], version: 0,
    };
    applySettings(t, { name: `${rules.tableWord} von ${user.name}`, ...opts });
    tables.set(t.id, t);
    return t;
  }
  function applySettings(t, b) {
    if (typeof b.name === 'string' && b.name.trim()) t.name = b.name.trim().slice(0, 60);
    if ('hidden' in b) t.hidden = !!b.hidden;
    const n = Number(b.seats);
    // Weniger Plätze nur, wenn die wegfallenden frei sind
    if (n >= minSeats && n <= maxSeats && t.seats.slice(n).every(s => !s)) t.seatCount = n;
    if (t.phase !== 'playing' && rules.options) rules.options(t, b);
  }

  const get = tid => tables.get(String(tid)) || null;
  const isHost = (t, user) => !!user && (user.isAdmin || user.id === t.hostId);
  function tableOf(userId) {
    for (const t of tables.values()) if (seatOf(t, userId)) return t;
    return null;
  }
  function viewers(t) {
    const users = new Map();
    for (const c of t.clients) if (!seatOf(t, c.user.id)) users.set(c.user.id, c.user);
    return [...users.values()].map(u => ({ id: u.id, name: u.name, user: u.username })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  function summary(t) {
    const n = seated(t).length;
    return {
      id: t.id, name: t.name, host: t.hostName, hidden: t.hidden, players: n, seats: t.seatCount, viewers: viewers(t).length,
      rules: rules.describe ? rules.describe(t) : '',
      status: playing(t) ? `Spiel ${t.game} läuft` : n >= minSeats ? 'Wartet auf „Bereit“' : n ? 'Wartet auf Mitspieler' : 'Freie Plätze',
    };
  }
  function list(user) {
    return [...tables.values()].filter(t => !t.spieltisch && (!t.hidden || t.hostId === user.id || user.isAdmin || seatOf(t, user.id)))
      .map(summary).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
  }

  function state(t, viewerId) {
    const me = seatOf(t, viewerId);
    const out = {
      id: t.id, name: t.name, host: t.hostName, hostId: t.hostId, hidden: t.hidden, seatCount: t.seatCount, opts: t.opts,
      phase: t.phase, game: t.game,
      seats: t.seats.slice(0, t.seatCount).map((s, i) => s && {
        i, id: s.userId, name: s.name, user: s.username, inGame: s.inGame, ready: s.ready, away: !online(t, s.userId), leaving: s.leaving,
        session: { games: s.stats.games, wins: s.stats.wins }, ...(s.inGame && rules.seatView ? rules.seatView(t, s) : {}),
      }),
      turn: t.turn && { kind: t.turn.kind, seat: t.turn.seat, left: Math.max(0, t.turn.deadline - Date.now()), hold: !!t.turn.hold },
      result: t.result, viewers: viewers(t), log: t.log.slice(0, 30), rules: config(), now: Date.now(), version: t.version, manual: !!t.manual,
    };
    if (playing(t)) rules.view(t, me && me.inGame ? me : null, out);
    return out;
  }

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
  function stopTimer(t) { clearTimeout(t.timer); t.timer = null; t.turn = null; }
  // Der Tisch wartet auf Platz i: volle Bedenkzeit, wenn er ein Fenster offen hat, sonst nur kurz. fn läuft bei Zeitablauf.
  function waitFor(t, kind, i, fn, secs) {
    const s = t.seats[i];
    const base = secs || config().turn;
    const n = s && online(t, s.userId) ? base : Math.min(base, OFFLINE_S);
    t.turn = { kind, seat: i, deadline: Date.now() + n * 1000, fn, secs };
    later(t, n * 1000, fn);
  }
  // Kurze Pause, in der niemand dran ist (z. B. Rundenende zeigen). Das Ende einer Runde hält der Gastgeber an, wenn er startet.
  function pause(t, kind, ms, fn) {
    if (kind === 'round' && t.manual) { clearTimeout(t.timer); t.timer = null; t.turn = { kind, seat: -1, deadline: Date.now(), fn, hold: true }; return; }
    t.turn = { kind, seat: -1, deadline: Date.now() + ms, fn };
    later(t, ms, fn);
  }
  // Der Gastgeber startet: das nächste Spiel oder, wenn das Rundenende auf ihn wartet, die nächste Runde
  function start(t) {
    if (t.turn && t.turn.hold) { const fn = t.turn.fn; stopTimer(t); fn(); return null; }
    if (playing(t)) return 'Das Spiel läuft schon.';
    if (seated(t).length < minSeats) return `Es braucht mindestens ${minSeats} Spieler.`;
    stopTimer(t);
    startGame(t, true);
    return null;
  }
  // Nach einem Wechsel der Einstellung: automatisch geht es weiter, sobald alle bereit sind bzw. die Pause um ist
  function wake(t) {
    if (t.manual) { if (!playing(t)) stopTimer(t); return; }
    if (t.turn && t.turn.hold) pause(t, 'next', 1500, t.turn.fn);
    else maybeStart(t);
  }

  // ---------- Platz nehmen, Bereit, Aufstehen ----------
  function sit(t, user, index) {
    if (seatOf(t, user.id)) return 'Du sitzt schon an diesem Tisch.';
    const other = tableOf(user.id);
    if (other) return `Du sitzt schon am Tisch „${other.name}“. Steh dort erst auf.`;
    const i = Number.isInteger(index) && index >= 0 && index < t.seatCount && !t.seats[index] ? index : t.seats.slice(0, t.seatCount).findIndex(s => !s);
    if (i < 0) return 'Alle Plätze sind besetzt.';
    t.seats[i] = {
      userId: user.id, name: user.name, username: user.username, inGame: false, quit: false,
      ready: false, leaving: false, awaySince: 0, stats: { games: 0, wins: 0 },
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
  // Wer mitten im Spiel aufsteht, ist raus und landet auf dem letzten Platz; die anderen spielen weiter
  function stand(t, seat, why = 'steht auf') {
    const i = t.seats.indexOf(seat);
    if (i < 0) return;
    t.seats[i] = null;
    if (playing(t) && seat.inGame) {
      seat.quit = true;
      log(t, `${seat.name} ${why} und scheidet aus.`);
      rules.drop(t, seat, i);
    } else {
      log(t, `${seat.name} ${why}.`);
      maybeStart(t);
    }
  }

  function maybeStart(t) {
    if (playing(t) || t.manual) return;
    const s = seated(t);
    if (s.length >= minSeats && s.every(x => x.ready)) { if (!t.timer) later(t, START_MS, () => startGame(t)); }
    else stopTimer(t);
  }
  function startGame(t, force = false) {
    const players = seated(t);
    if (players.length < minSeats || (!force && !players.every(s => s.ready))) return;
    t.game++;
    t.phase = 'playing';
    t.result = null;
    t.players = players;
    for (const s of players) { Object.assign(s, { inGame: true, quit: false, ready: false }); s.stats.games++; }
    rules.start(t, players);
  }

  // Spiel vorbei. rows: [{ seat, place, won, score, best, bonus, rounds, note }] für alle Mitspieler (auch Aufgestandene)
  function finish(t, rows, extra = {}) {
    stopTimer(t);
    const ts = now();
    const ins = db.prepare('INSERT INTO cg_results(game, user_id, table_name, players, place, won, score, best, bonus, rounds, quit, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    rows.sort((a, b) => a.place - b.place);
    for (const r of rows) {
      const s = r.seat;
      ins.run(GAME, s.userId, t.name, t.players.length, r.place, r.won ? 1 : 0, r.score || 0, r.best || 0, r.bonus || 0, r.rounds || 0, s.quit ? 1 : 0, ts);
      if (r.won) s.stats.wins++;
      s.inGame = false;
    }
    const winners = rows.filter(r => r.won).map(r => r.seat.name);
    t.result = { winners, order: rows.map(r => ({ name: r.seat.name, user: r.seat.username, place: r.place, won: !!r.won, score: r.score || 0, quit: r.seat.quit, note: r.note || '' })), ...extra };
    log(t, `Spiel ${t.game} vorbei: ` + (winners.length ? `${winners.join(' und ')} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'}!` : 'kein Sieger.'));
    t.phase = 'result';
    t.g = null;
    t.players = [];
    // Wer lange weg war oder gehen wollte, steht jetzt auf
    for (const s of seated(t)) if (s.leaving || (s.awaySince && Date.now() - s.awaySince > AWAY_MS)) { t.seats[t.seats.indexOf(s)] = null; log(t, `${s.name} steht auf.`); }
  }

  // ---------- Aktionen vom Browser ----------
  function control(t, user, b) {
    const a = String(b.action || '');
    const seat = seatOf(t, user.id);
    switch (a) {
      case 'sit': return sit(t, user, Number(b.seat));
      case 'ready': return seat ? setReady(t, seat, b.on !== false) : 'Du sitzt nicht am Tisch.';
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
      case 'start': return isHost(t, user) ? start(t) : 'Nur der Gastgeber startet die Runde.';
    }
    if (!seat) return 'Du sitzt nicht am Tisch.';
    if (!playing(t) || !seat.inGame) return 'Du spielst gerade nicht mit.';
    const err = rules.act(t, seat, a, b);
    return err === undefined ? 'Unbekannte Aktion.' : err;
  }

  function join(t, user, res) {
    const c = { user, res };
    t.clients.add(c);
    t.emptySince = 0;
    const s = seatOf(t, user.id);
    if (s) s.awaySince = 0;
    // Kommt jemand zurück, auf den der Tisch wartet, bekommt er wieder die volle Bedenkzeit
    if (s && playing(t) && t.turn && t.turn.fn && t.seats[t.turn.seat] === s) waitFor(t, t.turn.kind, t.turn.seat, t.turn.fn, t.turn.secs);
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

  // Tisch schließen: ein laufendes Spiel zählt nicht
  function remove(t) {
    stopTimer(t);
    for (const c of t.clients) { send(c.res, 'closed', {}); c.res.end(); }
    tables.delete(t.id);
  }
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

  return {
    id: GAME, prefix, title: rules.title, info: rules.info, maxSeats, minSeats,
    config, create, get, list, state, control, join, remove, broadcast, isHost, tableOf, wake,
    userTotals: userId => userTotals(GAME, userId), recentGames: (userId, n) => recentGames(GAME, userId, n),
    leaderboard: () => leaderboard(GAME), resetStats: userId => resetStats(GAME, userId),
    // für die Regeln
    log, later, stopTimer, waitFor, pause, finish, online, seated, nextIndex,
    _tables: tables, _startGame: startGame,
  };
}

// ---------- Kleinkram für alle Tische ----------
const seated = t => t.seats.filter(Boolean);
const seatOf = (t, userId) => t.seats.find(s => s && s.userId === userId) || null;
const playing = t => t.phase === 'playing';
function online(t, userId) { for (const c of t.clients) if (c.user.id === userId) return true; return false; }
function log(t, text) { t.log.unshift(text); t.log.length = Math.min(t.log.length, 60); }
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
// Nächster besetzter Platz nach i in Richtung dir (1 = im Uhrzeigersinn), für den test(seat, index) gilt
function nextIndex(t, i, test = s => s.inGame, dir = 1) {
  for (let k = 1; k <= t.seatCount; k++) {
    const j = (((i + k * dir) % t.seatCount) + t.seatCount) % t.seatCount;
    if (t.seats[j] && test(t.seats[j], j)) return j;
  }
  return -1;
}
// Platzierung nach Punkten (höher besser, außer lower): Gleichstand teilt sich den Platz, Aufgestandene ganz hinten
function rank(players, score, lower = false) {
  const sorted = players.slice().sort((a, b) => (a.quit - b.quit) || (lower ? score(a) - score(b) : score(b) - score(a)));
  const out = new Map();
  sorted.forEach((s, k) => {
    const prev = sorted[k - 1];
    out.set(s, prev && !s.quit && !prev.quit && score(prev) === score(s) ? out.get(prev) : k + 1);
  });
  return out;
}

module.exports = { createGame, shuffle, rank, userTotals, recentGames, leaderboard, resetStats };
