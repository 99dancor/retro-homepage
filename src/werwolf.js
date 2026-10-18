'use strict';
// Werwolf (Startmenü → Spiele und Apps → 🐺 Werwolf): das Gesellschaftsspiel mit Werwölfen, Dorf und Sonderrollen.
// Die Seite ist der Erzähler: sie verteilt die Rollen, sammelt die Nachtaktionen ein und zählt die Stimmen.
// Ein Raum läuft in einem von zwei Modi:
//  - lokal: alle sitzen zusammen und haben ihr eigenes Handy in der Hand. Geredet wird am Tisch, ein Gerät liest
//    auf Wunsch laut vor (die Stimme macht der Browser). Nachts tippen ALLE gleichzeitig etwas an (wer keine Aufgabe
//    hat, bekommt eine Verdachtsfrage), damit niemand am Tippen erkennt, wer gerade handelt.
//  - online: jeder sitzt woanders. Dazu kommen ein Dorf-Chat am Tag, ein Wolfs-Chat in der Nacht und ein Chat
//    für Tote.
// Räume leben wie beim Quiz nur im Arbeitsspeicher und schicken Änderungen per Server-Sent Events. Jeder bekommt
// seinen eigenen Zustand (view(r, pid)) und darin nur, was er wissen darf. Gespeichert wird nur das Ergebnis für
// Mitglieder (ww_results).
//
// Ablauf: lobby → roles (jeder schaut seine Rolle an) → night (Schritt 1: Amor, Beschützer, Werwölfe, Seherin;
// Schritt 2: Hexe, nur wenn eine im Spiel ist) → day (Tote der Nacht, reden) → vote → (hunter, wenn der Jäger
// stirbt) → night … bis eine Seite gewonnen hat → end.
const crypto = require('node:crypto');
const { db, now, getSetting } = require('./db');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_MS = 10 * 60 * 1000;   // Räume ohne offenes Fenster verschwinden nach 10 Minuten
const MIN_PLAYERS = 4;
const MAX_CHAT = 200;
const EMOJIS = ['🦊', '🐼', '🦉', '🐸', '🐙', '🐢', '🤖', '👽', '🎃', '🌵', '🍩', '⭐', '🚀', '👑', '🐱', '🐶', '🦄', '🐝'];
const COLORS = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#d68910', '#16a085', '#5d6d7e'];

// Rollen in der Reihenfolge, in der sie in der Lobby stehen. team: wer mit wem gewinnt.
const ROLES = {
  werwolf: { name: 'Werwolf', icon: '🐺', team: 'wolf', text: 'Jede Nacht sucht ihr Werwölfe euch gemeinsam ein Opfer aus. Am Tag tut ihr harmlos. Ihr gewinnt, sobald ihr so viele seid wie der Rest.' },
  dorf: { name: 'Dorfbewohner', icon: '🧑‍🌾', team: 'dorf', text: 'Du hast keine besondere Fähigkeit, nur deinen Verstand. Finde mit dem Dorf die Werwölfe und stimme tagsüber richtig ab.' },
  seherin: { name: 'Seherin', icon: '🔮', team: 'dorf', text: 'Jede Nacht schaust du dir eine Person an und erfährst ihre Rolle.' },
  hexe: { name: 'Hexe', icon: '🧪', team: 'dorf', text: 'Du erfährst nachts, wen die Werwölfe holen. Mit dem Heiltrank rettest du das Opfer, mit dem Gifttrank tötest du jemanden. Jeder Trank wirkt nur einmal im Spiel.' },
  jaeger: { name: 'Jäger', icon: '🏹', team: 'dorf', text: 'Wenn du stirbst, egal ob nachts oder durch das Dorf, schießt du noch einmal und nimmst jemanden mit.' },
  amor: { name: 'Amor', icon: '💘', team: 'dorf', text: 'In der ersten Nacht verliebst du zwei Personen (auch dich selbst). Stirbt eine, stirbt die andere vor Kummer. Sind sie aus verschiedenen Lagern, gewinnen sie nur zu zweit.' },
  beschuetzer: { name: 'Beschützer', icon: '🛡️', team: 'dorf', text: 'Jede Nacht beschützt du eine Person vor den Werwölfen, auch dich selbst, aber nie zweimal hintereinander dieselbe.' },
};
const SPECIAL = ['seherin', 'hexe', 'jaeger', 'amor', 'beschuetzer'];
const CAUSES = { wolf: 'von den Werwölfen geholt', gift: 'vergiftet', dorf: 'vom Dorf verurteilt', jaeger: 'vom Jäger erschossen', liebe: 'vor Kummer gestorben', weg: 'hat das Dorf verlassen' };

const int = (v, d, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');
function config() {
  return {
    guests: getSetting('ww_guests', '1') === '1',
    maxRooms: int(getSetting('ww_max_rooms'), 20, 1, 200),
    maxPlayers: int(getSetting('ww_max_players'), 20, MIN_PLAYERS, 40),
  };
}

// Vorschlag fürs Rollenset je nach Spielerzahl (so lange der Gastgeber nichts selbst einstellt)
function suggest(n) {
  return {
    werwolf: n < 6 ? 1 : n < 12 ? 2 : n < 16 ? 3 : 4,
    seherin: 1, hexe: n >= 6 ? 1 : 0, jaeger: n >= 7 ? 1 : 0, amor: n >= 8 ? 1 : 0, beschuetzer: n >= 10 ? 1 : 0,
  };
}
const DEFAULTS = { night: 60, talk: 180, vote: 60, reveal: true, deadSee: true, witchSelf: true };
function cleanOpts(b, old = DEFAULTS) {
  b = b || {};
  const bool = k => (k in b ? !!b[k] : old[k]);
  return {
    night: int(b.night, old.night, 15, 600), talk: int(b.talk, old.talk, 0, 1800), vote: int(b.vote, old.vote, 15, 600),
    reveal: bool('reveal'), deadSee: bool('deadSee'), witchSelf: bool('witchSelf'),
  };
}
function cleanRoles(b, old) {
  const out = {};
  for (const k of ['werwolf', ...SPECIAL]) out[k] = int(b && b[k], old ? old[k] : 0, k === 'werwolf' ? 1 : 0, k === 'werwolf' ? 10 : 1);
  return out;
}
// Das Rollenset, das beim Start gilt: Vorschlag oder eigene Auswahl, Rest Dorfbewohner
function roleSet(r) {
  const n = r.players.size;
  const set = r.auto ? suggest(n) : r.roles;
  const list = [];
  for (const k of ['werwolf', ...SPECIAL]) for (let i = 0; i < set[k]; i++) list.push(k);
  while (list.length < n) list.push('dorf');
  return list;
}
function checkSet(r) {
  const n = r.players.size, list = roleSet(r);
  if (n < MIN_PLAYERS) return `Werwolf braucht mindestens ${MIN_PLAYERS} Spieler.`;
  if (list.length > n) return `Es sind mehr Rollen gewählt (${list.length}) als Spieler da sind (${n}).`;
  const wolves = list.filter(k => k === 'werwolf').length;
  if (wolves * 2 >= n) return 'So viele Werwölfe hätten schon gewonnen. Nimm weniger Werwölfe oder mehr Spieler.';
  return null;
}

// ---------- Ergebnisse ----------
function save(r) {
  const ins = db.prepare(`INSERT INTO ww_results(user_id, room_name, mode, players, days, role, won, survived, ended_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of r.players.values()) {
    if (!p.userId || !p.role) continue;
    ins.run(p.userId, r.name, r.mode, r.order.length, r.day, p.role, winners(r).has(p.pid) ? 1 : 0, p.alive ? 1 : 0, now());
  }
}
function userTotals(userId) {
  return db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins, COALESCE(SUM(role = 'werwolf'), 0) AS wolf,
                     COALESCE(SUM(role = 'werwolf' AND won), 0) AS wolfWins, COALESCE(SUM(survived), 0) AS survived, MAX(ended_at) AS last
                     FROM ww_results WHERE user_id = ?`).get(userId);
}

// ---------- Räume ----------
const rooms = new Map();
function newCode() {
  for (let n = 0; n < 1000; n++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const get = code => rooms.get(String(code || '').toUpperCase()) || null;

// who: { pid, user, name } wie beim Quiz – pid ist „u<Konto>“ oder „g<Prüfsumme des Gast-Cookies>“
function create(who, opts = {}) {
  cleanup();
  if (rooms.size >= config().maxRooms) return null;
  const code = newCode();
  if (!code) return null;
  const r = {
    code, name: str(opts.name, 40).replace(/\s+/g, ' ').trim() || 'Wolfsbach', mode: opts.mode === 'online' ? 'online' : 'lokal',
    hidden: !!opts.hidden, guests: opts.guests !== false,
    hostPid: who.pid, players: new Map(), order: [], kicked: new Set(), clients: new Set(),
    auto: true, roles: suggest(MIN_PLAYERS), opts: cleanOpts(opts.opts),
    phase: 'lobby', step: 0, day: 0, deadline: 0, timer: null, game: 0,
    picks: new Map(), night: null, lastProtected: null, potions: { heal: true, poison: true }, lovers: null,
    news: [], suspect: null, votes: new Map(), ready: new Set(), verdict: null, hunters: [], after: null,
    chat: [], chatId: 0, log: [], winner: null, emptySince: Date.now(), created: Date.now(), version: 0,
  };
  rooms.set(code, r);
  const err = join(r, who, opts);
  if (err.error) { rooms.delete(code); return { error: err.error }; }
  return r;
}

function remove(r, why = 'Der Raum wurde geschlossen.') {
  clearTimeout(r.timer);
  rooms.delete(r.code);
  for (const c of r.clients) { send(c.res, 'closed', { message: why }); c.res.end(); }
  r.clients.clear();
}
function cleanup() {
  for (const r of rooms.values()) if (!r.clients.size && Date.now() - r.emptySince > EMPTY_MS) remove(r);
}
setInterval(cleanup, 60 * 1000).unref();

const PHASE = { lobby: 'Warteraum', roles: 'Rollen ansehen', night: 'Nacht', day: 'Tag', vote: 'Abstimmung', hunter: 'Tag', end: 'Spiel vorbei' };
function list() {
  return [...rooms.values()].filter(r => !r.hidden).map(r => ({
    code: r.code, name: r.name, mode: r.mode, host: hostName(r), players: r.players.size, guests: r.guests,
    status: r.phase === 'lobby' || r.phase === 'end' ? PHASE[r.phase] : `${PHASE[r.phase]} ${Math.max(1, r.day)}`,
  })).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
}
function hostName(r) { const h = r.players.get(r.hostPid); return h ? h.name : '?'; }

// ---------- Mitspielen ----------
const isHost = (r, pid) => r.hostPid === pid;
function join(r, who, opts = {}) {
  if (r.players.has(who.pid)) return { ok: true };
  if (r.kicked.has(who.pid)) return { error: 'Der Gastgeber hat dich aus diesem Raum genommen.' };
  if (!who.user && !(r.guests && config().guests)) return { error: 'In diesem Raum spielen nur angemeldete Mitglieder mit.', login: true };
  if (r.phase !== 'lobby') return { error: 'Das Spiel läuft schon. Warte, bis die Runde vorbei ist.' };
  if (r.players.size >= config().maxPlayers) return { error: 'Der Raum ist voll.' };
  let name = who.name;
  if (!who.user) {
    name = str(opts.playerName != null ? opts.playerName : opts.name, 24).replace(/\s+/g, ' ').trim();
    if (!name) return { error: 'Bitte gib einen Namen ein.' };
  }
  if ([...r.players.values()].some(p => norm(p.name) === norm(name))) return { error: `Den Namen „${name}“ gibt es in diesem Raum schon.` };
  r.players.set(who.pid, {
    pid: who.pid, userId: who.user ? who.user.id : null, username: who.user ? who.user.username : null, name,
    avatar: who.user && who.user.avatar ? '/avatar/' + who.user.avatar : null,
    emoji: who.user ? null : (EMOJIS.includes(opts.emoji) ? opts.emoji : EMOJIS[crypto.randomInt(EMOJIS.length)]),
    color: COLORS.includes(opts.color) ? opts.color : who.user ? `hsl(${who.user.id * 47 % 360},45%,42%)` : COLORS[crypto.randomInt(COLORS.length)],
    guest: !who.user, joined: Date.now(),
    role: null, alive: true, seen: false, notes: [],
  });
  r.order.push(who.pid);
  return { ok: true };
}
const online = (r, pid) => [...r.clients].some(c => c.pid === pid);

function connect(r, pid, res) {
  const c = { pid, res };
  r.clients.add(c);
  r.emptySince = 0;
  broadcast(r);
  const ping = setInterval(() => send(res, 'ping', { now: Date.now() }), 20000);
  return () => {
    clearInterval(ping);
    r.clients.delete(c);
    if (!rooms.has(r.code)) return;
    if (!r.clients.size) r.emptySince = Date.now();
    broadcast(r);
  };
}

// Wer geht, ist im laufenden Spiel tot (ohne Jägerschuss). Der Gastgeber gibt den Raum an den Nächsten weiter.
function leave(r, pid) {
  const p = r.players.get(pid);
  if (!p) return;
  if (running(r)) {
    p.left = true;
    const died = [];
    if (p.alive) kill(r, pid, 'weg', died, false);
    r.news.push(...died);
    logDeaths(r, died);
    if (!decide(r)) {
      if (r.phase === 'day' && r.hunters.length) afterDeaths(r, 'day');   // der verliebte Jäger schießt sofort
      else progress(r);
    }
  }
  if (r.phase === 'lobby' || r.phase === 'end') { r.players.delete(pid); r.order = r.order.filter(x => x !== pid); }
  else p.left = true;
  for (const c of [...r.clients]) if (c.pid === pid) { send(c.res, 'closed', { message: 'Du hast den Raum verlassen.' }); c.res.end(); r.clients.delete(c); }
  if (isHost(r, pid)) {
    const next = r.order.find(x => x !== pid && r.players.has(x) && !r.players.get(x).left);
    if (!next) return remove(r);
    r.hostPid = next;
  }
}

// ---------- Spielablauf ----------
const running = r => !['lobby', 'end'].includes(r.phase);
const alive = r => r.order.map(pid => r.players.get(pid)).filter(p => p && p.alive);
const wolves = r => alive(r).filter(p => p.role === 'werwolf');
const has = (r, role) => r.order.some(pid => r.players.get(pid).role === role);
function log(r, text) { r.log.push({ day: r.day, text }); }
function setTimer(r, seconds, fn) {
  clearTimeout(r.timer);
  r.deadline = seconds ? Date.now() + seconds * 1000 : 0;
  if (seconds) r.timer = setTimeout(() => { if (rooms.get(r.code) === r) { fn(); broadcast(r); } }, seconds * 1000).unref();
}

function start(r, fixed) {
  const err = checkSet(r);
  if (err) return err;
  const ps = r.order.map(pid => r.players.get(pid));
  const deck = roleSet(r);
  for (let i = deck.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  ps.forEach((p, i) => Object.assign(p, { role: (fixed && fixed[p.pid]) || deck[i], alive: true, seen: false, notes: [], died: null, left: false }));
  Object.assign(r, {
    phase: 'roles', step: 0, day: 0, game: r.game + 1, picks: new Map(), night: null, lastProtected: null,
    potions: { heal: true, poison: true }, lovers: null, news: [], suspect: null, votes: new Map(), ready: new Set(),
    verdict: null, hunters: [], after: null, log: [], winner: null,
  });
  r.chat = r.chat.filter(m => m.ch === 'dorf').slice(-20);
  log(r, `Das Spiel beginnt mit ${ps.length} Leuten: ${roleSummary(ps.map(p => p.role))}.`);
  setTimer(r, 0);
  return null;
}
function roleSummary(list) {
  const n = {};
  for (const k of list) n[k] = (n[k] || 0) + 1;
  return Object.keys(ROLES).filter(k => n[k]).map(k => `${n[k]}× ${ROLES[k].name}`).join(', ');
}

// Was hat diese Person in der Nacht zu tun? Alle bekommen etwas, damit niemand am Tippen auffällt.
function task(r, p) {
  if (r.phase === 'hunter') return r.hunters[0] === p.pid ? 'jaeger' : null;   // der Jäger ist dabei schon tot
  if (!p.alive) return null;
  if (r.phase === 'night' && r.step === 1) {
    if (p.role === 'amor' && r.day === 0) return 'amor';
    if (p.role === 'werwolf') return 'wolf';
    if (p.role === 'seherin') return 'seherin';
    if (p.role === 'beschuetzer') return 'schutz';
    return 'verdacht';
  }
  if (r.phase === 'night' && r.step === 2) return p.role === 'hexe' && (r.potions.heal || r.potions.poison) ? 'hexe' : 'vertrauen';
  if (r.phase === 'vote') return 'vote';
  return null;
}
// Wen darf man bei einer Aufgabe antippen?
function canPick(r, p, t, target) {
  const q = r.players.get(target);
  if (!q || !q.alive) return false;
  switch (t) {
    case 'wolf': return q.role !== 'werwolf';
    case 'seherin': case 'verdacht': case 'vertrauen': case 'vote': case 'jaeger': return target !== p.pid;
    case 'schutz': return target !== r.lastProtected;
    case 'amor': return true;
    case 'hexe': return target !== p.pid;   // Gift
    default: return false;
  }
}

function startNight(r) {
  r.phase = 'night'; r.step = 1; r.picks = new Map(); r.ready = new Set();
  r.night = { victim: null, protect: null, heal: false, poison: null, suspects: new Map() };
  setTimer(r, r.opts.night, () => endStep(r));
}
// Alle Lebenden fertig? Dann geht es ohne Warten weiter.
function progress(r) {
  if (r.phase === 'roles') {
    if (r.order.every(pid => { const p = r.players.get(pid); return p.seen || p.left; })) startNight(r);
  } else if (r.phase === 'night' || r.phase === 'vote') {
    if (alive(r).every(p => (r.picks.get(p.pid) || {}).done)) endStep(r);
  } else if (r.phase === 'hunter') {
    const h = r.players.get(r.hunters[0]);
    if (!h || h.left) shoot(r, null);
  }
}
function pickOf(r, pid) { return r.picks.get(pid) || {}; }
function endStep(r) {
  if (r.phase === 'vote') return endVote(r);
  if (r.phase !== 'night') return;
  if (r.step === 1) {
    const n = r.night;
    // Werwölfe: Mehrheit ihrer Wahl, bei Gleichstand das Los
    const count = new Map();
    for (const w of wolves(r)) { const t = pickOf(r, w.pid).target; if (t && canPick(r, w, 'wolf', t)) count.set(t, (count.get(t) || 0) + 1); }
    n.victim = top(count);
    for (const p of alive(r)) {
      const k = pickOf(r, p.pid);
      if (p.role === 'beschuetzer' && k.target && canPick(r, p, 'schutz', k.target)) n.protect = k.target;
      if (task(r, p) === 'verdacht' && k.target) n.suspects.set(k.target, (n.suspects.get(k.target) || 0) + 1);
      if (p.role === 'seherin' && k.target && !k.done) see(r, p, k.target);
      if (task(r, p) === 'amor') {
        let a = k.target, b = k.target2;
        const pool = alive(r).map(x => x.pid);
        if (!a || !b || a === b) {   // nicht gewählt: Amor schießt blind
          const rest = pool.filter(x => x !== a);
          if (!a) a = rest.splice(crypto.randomInt(rest.length), 1)[0];
          const rest2 = pool.filter(x => x !== a);
          b = rest2[crypto.randomInt(rest2.length)];
        }
        r.lovers = [a, b];
        log(r, `Amor hat ${name(r, a)} und ${name(r, b)} verliebt.`);
      }
    }
    r.lastProtected = n.protect;
    if (r.lovers && r.day === 0) for (const [a, b] of [r.lovers, [...r.lovers].reverse()]) {
      r.players.get(a).notes.push({ day: 0, text: `💘 Du bist verliebt in ${name(r, b)}. Stirbt einer von euch, stirbt der andere mit.` });
    }
    if (has(r, 'hexe')) {
      r.step = 2; r.picks = new Map();
      return setTimer(r, Math.max(15, Math.round(r.opts.night * 0.75)), () => endStep(r));
    }
  } else {
    const witch = alive(r).find(p => p.role === 'hexe');
    if (witch) {
      const k = pickOf(r, witch.pid);
      if (k.heal && r.potions.heal && r.night.victim && (r.opts.witchSelf || r.night.victim !== witch.pid)) { r.night.heal = true; r.potions.heal = false; }
      if (k.target && r.potions.poison && canPick(r, witch, 'hexe', k.target)) { r.night.poison = k.target; r.potions.poison = false; }
    }
  }
  dawn(r);
}
function top(count) {
  let best = 0, list = [];
  for (const [k, v] of count) { if (v > best) { best = v; list = [k]; } else if (v === best) list.push(k); }
  return list.length ? list[crypto.randomInt(list.length)] : null;
}
const name = (r, pid) => (r.players.get(pid) || {}).name || '?';
function see(r, p, target) {
  const q = r.players.get(target);
  p.notes.push({ day: r.day, text: `🔮 ${q.name} ist ${ROLES[q.role].icon} ${ROLES[q.role].name}.`, pid: target, role: q.role });
}

// Morgen: Tote der Nacht verkünden
function dawn(r) {
  const n = r.night, died = [];
  r.day++;
  r.news = []; r.verdict = null;
  if (n.victim && n.victim !== n.protect && !n.heal) kill(r, n.victim, 'wolf', died);
  else if (n.victim) log(r, `${name(r, n.victim)} wurde ${n.heal ? 'von der Hexe gerettet' : 'vom Beschützer gerettet'}.`);
  if (n.poison) kill(r, n.poison, 'gift', died);
  r.news = died;
  r.suspect = top(n.suspects);
  logDeaths(r, died);
  if (!died.length) log(r, 'In dieser Nacht ist niemand gestorben.');
  afterDeaths(r, 'day');
}
function logDeaths(r, died) { for (const d of died) log(r, `${name(r, d.pid)} (${ROLES[r.players.get(d.pid).role].name}) ist ${CAUSES[d.cause]}.`); }

// Jemand stirbt: das Liebespaar stirbt mit, der Jäger schießt danach noch (shot = false: ohne Schuss)
function kill(r, pid, cause, died, shot = true) {
  const p = r.players.get(pid);
  if (!p || !p.alive) return;
  p.alive = false;
  p.died = { day: r.day, cause };
  died.push({ pid, cause });
  if (p.role === 'jaeger' && shot && !p.left && cause !== 'weg') r.hunters.push(pid);
  if (r.lovers && r.lovers.includes(pid)) kill(r, r.lovers.find(x => x !== pid), 'liebe', died);
}
// Nach Toden: erst die Jäger, dann prüfen, ob jemand gewonnen hat, dann weiter mit next ('day' oder 'night')
function afterDeaths(r, next) {
  r.after = next;
  if (decide(r)) return;
  if (r.hunters.length) {
    r.phase = 'hunter'; r.picks = new Map();
    return setTimer(r, Math.max(20, Math.round(r.opts.vote / 2)), () => shoot(r, pickOf(r, r.hunters[0]).target || null));
  }
  if (next === 'night') return startNight(r);
  r.phase = 'day'; r.step = 0; r.ready = new Set(); r.votes = new Map(); r.picks = new Map();
  if (r.opts.talk) setTimer(r, r.opts.talk, () => startVote(r));
  else setTimer(r, 0);
}
function shoot(r, target) {
  const pid = r.hunters.shift();
  const died = [];
  const h = r.players.get(pid);
  if (target && h && canPick(r, h, 'jaeger', target)) kill(r, target, 'jaeger', died);
  else log(r, `${name(r, pid)} hat nicht mehr geschossen.`);
  r.news.push(...died);
  logDeaths(r, died);
  afterDeaths(r, r.after);
}
function startVote(r) {
  if (r.phase !== 'day') return;
  r.phase = 'vote'; r.picks = new Map(); r.ready = new Set(); r.votes = new Map(); r.verdict = null;
  setTimer(r, r.opts.vote, () => endStep(r));
}
function endVote(r) {
  const count = new Map();
  for (const p of alive(r)) { const t = pickOf(r, p.pid).target; if (t && t !== 'skip' && canPick(r, p, 'vote', t)) count.set(t, (count.get(t) || 0) + 1); }
  const max = Math.max(0, ...count.values());
  const most = [...count].filter(([, v]) => v === max).map(([k]) => k);
  r.votes = new Map([...r.picks].map(([k, v]) => [k, v.target || 'skip']));
  r.news = [];
  const died = [];
  if (max && most.length === 1) {
    kill(r, most[0], 'dorf', died);
    r.verdict = { pid: most[0], votes: max };
  } else {
    r.verdict = { pid: null, votes: max, tie: most.length > 1 };
    log(r, most.length > 1 ? 'Gleichstand bei der Abstimmung, niemand wurde verurteilt.' : 'Das Dorf hat niemanden verurteilt.');
  }
  r.news = died;
  logDeaths(r, died);
  afterDeaths(r, 'night');
}

// Wer gewinnt? Verliebte aus beiden Lagern gewinnen nur, wenn sie zu zweit übrig sind.
function mixedLovers(r) { return !!r.lovers && new Set(r.lovers.map(pid => ROLES[r.players.get(pid).role].team)).size > 1; }
function team(r, p) { return mixedLovers(r) && r.lovers.includes(p.pid) ? 'liebe' : ROLES[p.role].team; }
function decide(r) {
  const a = alive(r);
  const w = a.filter(p => p.role === 'werwolf').length;
  let winner = null;
  if (mixedLovers(r) && a.length === 2 && a.every(p => r.lovers.includes(p.pid))) winner = 'liebe';
  else if (!a.length) winner = 'niemand';
  else if (!w) winner = 'dorf';
  else if (w * 2 >= a.length) winner = 'wolf';
  if (!winner) return false;
  clearTimeout(r.timer);
  r.deadline = 0; r.hunters = [];
  r.phase = 'end'; r.winner = winner;
  log(r, { dorf: 'Das Dorf hat gewonnen.', wolf: 'Die Werwölfe haben gewonnen.', liebe: 'Das Liebespaar hat gewonnen.', niemand: 'Niemand hat überlebt.' }[winner]);
  save(r);
  return true;
}
function winners(r) {
  if (!r.winner) return new Set();
  return new Set(r.order.filter(pid => team(r, r.players.get(pid)) === r.winner));
}

// ---------- Eingaben ----------
function playerAction(r, pid, b) {
  const p = r.players.get(pid);
  if (!p) return { error: 'Du bist in diesem Raum nicht dabei.' };
  switch (b.action) {
    case 'leave': leave(r, pid); return { ok: true };
    case 'seen':
      if (r.phase !== 'roles') return { error: 'Gerade gibt es keine Rolle anzusehen.' };
      p.seen = true; progress(r); return { ok: true };
    case 'chat': return chat(r, p, b);
    case 'ready': {
      if (r.phase !== 'day' || !p.alive) return { error: 'Das geht nur tagsüber.' };
      if (r.ready.has(pid)) r.ready.delete(pid); else r.ready.add(pid);
      if (r.ready.size * 2 > alive(r).length) startVote(r);
      return { ok: true };
    }
    case 'pick': case 'done': {
      const t = task(r, p);
      if (!t) return { error: p.alive ? 'Gerade hast du nichts zu tun.' : 'Du bist tot.' };
      const k = r.picks.get(pid) || {};
      if (k.done && t !== 'vote') return { error: 'Du hast schon entschieden.' };
      if (b.action === 'pick') {
        if (!('target' in b)) { /* nur der Heiltrank */ }
        else if (b.target === null || b.target === '') { delete k.target; delete k.target2; }
        else if (t === 'vote' && b.target === 'skip') k.target = 'skip';
        else if (!canPick(r, p, t, String(b.target))) return { error: t === 'schutz' && b.target === r.lastProtected ? 'Diese Person hast du letzte Nacht schon beschützt.' : 'Diese Person kannst du nicht wählen.' };
        else if (t === 'amor') {
          const x = String(b.target);
          if (k.target === x) { k.target = k.target2 || null; delete k.target2; }
          else if (k.target2 === x) delete k.target2;
          else if (!k.target) k.target = x;
          else k.target2 = x;
        } else k.target = String(b.target);
        if (t === 'hexe' && 'heal' in b) k.heal = !!b.heal && r.potions.heal && !!r.night.victim && (r.opts.witchSelf || r.night.victim !== pid);
        if (t === 'vote' && k.done) k.done = false;
        r.picks.set(pid, k);
        return { ok: true };
      }
      // Fertig: Wer ein Ziel braucht, muss eins haben
      if (t === 'amor' && !(k.target && k.target2)) return { error: 'Wähle zwei Personen aus.' };
      if (['wolf', 'seherin', 'schutz', 'verdacht', 'vertrauen', 'jaeger'].includes(t) && !k.target) return { error: 'Tippe erst eine Person an.' };
      if (t === 'vote' && !k.target) return { error: 'Wähle jemanden oder enthalte dich.' };
      k.done = true;
      r.picks.set(pid, k);
      if (t === 'seherin') see(r, p, k.target);
      if (t === 'jaeger') { shoot(r, k.target); return { ok: true }; }
      progress(r);
      return { ok: true };
    }
    default: return { error: 'Unbekannte Aktion.' };
  }
}

function hostAction(r, pid, b) {
  switch (b.action) {
    case 'settings': {
      if (r.phase !== 'lobby' && r.phase !== 'end') return 'Einstellungen gehen nur zwischen den Runden.';
      if (typeof b.name === 'string' && b.name.trim()) r.name = str(b.name, 40).replace(/\s+/g, ' ').trim();
      if (b.mode === 'lokal' || b.mode === 'online') r.mode = b.mode;
      if ('hidden' in b) r.hidden = !!b.hidden;
      if ('guests' in b) r.guests = !!b.guests;
      if ('auto' in b) r.auto = !!b.auto;
      if (b.roles) { r.roles = cleanRoles(b.roles, r.auto ? suggest(r.players.size) : r.roles); r.auto = false; }
      if (b.opts) r.opts = cleanOpts(b.opts, r.opts);
      return null;
    }
    case 'start':
      if (r.phase !== 'lobby' && r.phase !== 'end') return 'Das Spiel läuft schon.';
      for (const [k, p] of r.players) if (p.left) { r.players.delete(k); r.order = r.order.filter(x => x !== k); }
      return start(r);
    case 'lobby':
      if (r.phase !== 'end') return 'Das geht erst, wenn das Spiel vorbei ist.';
      for (const [k, p] of r.players) if (p.left) { r.players.delete(k); r.order = r.order.filter(x => x !== k); }
      r.phase = 'lobby'; r.winner = null; r.news = []; r.verdict = null; r.lovers = null;
      for (const p of r.players.values()) Object.assign(p, { role: null, alive: true, notes: [], died: null });
      return null;
    case 'skip':   // Gastgeber drängelt: Reden beenden bzw. Zeit für die aktuelle Entscheidung abkürzen
      if (r.phase === 'day') { startVote(r); return null; }
      if (r.phase === 'roles') { startNight(r); return null; }
      if (r.phase === 'night' || r.phase === 'vote') { endStep(r); return null; }
      return 'Gerade gibt es nichts zu überspringen.';
    case 'abort':
      if (!running(r)) return 'Es läuft gerade kein Spiel.';
      clearTimeout(r.timer); r.deadline = 0;
      r.phase = 'end'; r.winner = 'abbruch';
      log(r, 'Der Gastgeber hat das Spiel abgebrochen.');
      return null;
    case 'kick': {
      const target = String(b.pid || '');
      if (target === pid || !r.players.has(target)) return 'Diese Person ist nicht im Raum.';
      if (running(r)) return 'Rauswerfen geht nur zwischen den Runden.';
      r.kicked.add(target);
      leave(r, target);
      for (const c of [...r.clients]) if (c.pid === target) { send(c.res, 'closed', { message: 'Der Gastgeber hat dich aus dem Raum genommen.' }); c.res.end(); r.clients.delete(c); }
      return null;
    }
    case 'host': {
      const target = String(b.pid || '');
      if (!r.players.has(target) || r.players.get(target).left) return 'Diese Person ist nicht im Raum.';
      r.hostPid = target;
      return null;
    }
    default: return 'Unbekannte Aktion.';
  }
}

// Chat (nur online): Dorf am Tag und zwischen den Runden, Wölfe unter sich, Tote unter sich
function channels(r, p) {
  const out = { read: ['dorf'], write: [] };
  if (!running(r)) { out.write.push('dorf'); return out; }
  if (!p.alive) { out.read.push('tot'); out.write.push('tot'); if (r.opts.deadSee) out.read.push('wolf'); return out; }
  if (['day', 'vote', 'hunter'].includes(r.phase)) out.write.push('dorf');
  if (p.role === 'werwolf') { out.read.push('wolf'); out.write.push('wolf'); }
  return out;
}
function chat(r, p, b) {
  if (r.mode !== 'online') return { error: 'Im lokalen Modus redet ihr am Tisch.' };
  const text = str(b.text, 300).trim();
  if (!text) return { error: 'Die Nachricht ist leer.' };
  const ch = b.ch || 'dorf';
  if (!channels(r, p).write.includes(ch)) return { error: ch === 'dorf' && r.phase === 'night' ? 'Nachts schläft das Dorf.' : 'Hier kannst du gerade nicht schreiben.' };
  r.chat.push({ id: ++r.chatId, ch, pid: p.pid, name: p.name, text, at: Date.now() });
  if (r.chat.length > MAX_CHAT) r.chat.splice(0, r.chat.length - MAX_CHAT);
  return { ok: true };
}

// ---------- Ansicht ----------
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(r) {
  r.version++;
  for (const c of r.clients) send(c.res, 'state', view(r, c.pid));
}
// Wessen Rolle darf pid sehen?
function roleVisible(r, me, q) {
  if (!q.role) return false;
  if (r.phase === 'end' || q.pid === me.pid) return true;
  if (!me.alive && r.opts.deadSee && running(r)) return true;
  if (!q.alive && r.opts.reveal) return true;
  if (me.role === 'werwolf' && q.role === 'werwolf') return true;
  return false;
}
function view(r, pid) {
  const me = r.players.get(pid) || { pid, alive: false };
  const t = me.role ? task(r, me) : null;
  const k = pickOf(r, pid);
  const ch = me.role || !running(r) ? channels(r, me) : { read: ['dorf'], write: [] };
  const players = r.order.map(x => r.players.get(x)).filter(Boolean).map(q => ({
    pid: q.pid, name: q.name, user: q.username, avatar: q.avatar, emoji: q.emoji, color: q.color, guest: q.guest,
    online: online(r, q.pid), host: isHost(r, q.pid), left: !!q.left,
    alive: q.alive, died: q.alive ? null : q.died,
    role: roleVisible(r, me, q) ? q.role : null,
    lover: !!r.lovers && r.lovers.includes(q.pid) && (r.phase === 'end' || r.lovers.includes(pid) || (!me.alive && r.opts.deadSee && running(r))),
    seen: r.phase === 'roles' ? q.seen : undefined,
    done: ['night', 'vote'].includes(r.phase) && q.alive ? !!pickOf(r, q.pid).done : undefined,
    ready: r.phase === 'day' ? r.ready.has(q.pid) : undefined,
  }));
  const s = {
    code: r.code, name: r.name, mode: r.mode, hidden: r.hidden, guests: r.guests, phase: r.phase, step: r.step, day: r.day, game: r.game,
    ms: r.deadline ? Math.max(0, r.deadline - Date.now()) : 0,
    me: pid, isHost: isHost(r, pid), joined: r.players.has(pid), players,
    auto: r.auto, roles: r.auto ? suggest(r.players.size) : r.roles, opts: r.opts, set: roleSummary(roleSet(r)), problem: r.phase === 'lobby' ? checkSet(r) : null,
    news: r.news, suspect: r.phase === 'day' && r.suspect ? r.suspect : null, verdict: ['day', 'night', 'hunter', 'end'].includes(r.phase) ? r.verdict : null,
    hunter: r.phase === 'hunter' ? r.hunters[0] : null,
    mine: me.role ? {
      role: me.role, alive: me.alive, task: t, target: k.target || null, target2: k.target2 || null, heal: !!k.heal, done: !!k.done,
      notes: me.notes, lastProtected: me.role === 'beschuetzer' ? r.lastProtected : null,
      potions: me.role === 'hexe' ? r.potions : null,
      victim: t === 'hexe' ? r.night.victim : null,
    } : null,
    chat: r.mode === 'online' ? r.chat.filter(m => ch.read.includes(m.ch)).slice(-80) : [], canWrite: r.mode === 'online' ? ch.write : [],
    winner: r.winner, log: r.phase === 'end' ? r.log : null, winners: r.phase === 'end' ? [...winners(r)] : null,
    lovers: r.phase === 'end' ? r.lovers : null,
  };
  // Werwölfe sehen, wen die anderen Wölfe gerade antippen; offene Abstimmung: alle sehen alle Stimmen
  if (t === 'wolf' || (!me.alive && r.opts.deadSee && r.phase === 'night' && r.step === 1)) s.wolfPicks = Object.fromEntries(wolves(r).map(w => [w.pid, pickOf(r, w.pid).target || null]));
  if (r.phase === 'vote') s.votes = Object.fromEntries(alive(r).map(p => [p.pid, pickOf(r, p.pid).target || null]));
  else if (r.verdict && s.verdict) s.votes = Object.fromEntries(r.votes);
  return s;
}

module.exports = {
  ROLES, SPECIAL, CAUSES, EMOJIS, COLORS, DEFAULTS, MIN_PLAYERS,
  config, suggest, create, get, list, join, connect, leave, remove, broadcast, playerAction, hostAction, isHost, view, userTotals,
  _rooms: rooms, _start: start, _endStep: endStep,
};
