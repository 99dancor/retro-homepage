'use strict';
// Quiz (Startmenü → Spiele und Apps → ❓ Quiz): Ein Spielleiter öffnet einen Raum, Spieler treten über die Liste,
// den Raumcode oder den Einladungslink bei, Mitglieder mit ihrem Profilbild, Gäste mit Namen und Emoji.
// Räume leben wie die anderen Lobbys nur im Arbeitsspeicher und schicken Änderungen per Server-Sent Events.
// Timer, Buzzer-Reihenfolge und Wertung laufen nur hier auf dem Server. Die richtige Antwort verlässt ihn erst
// bei der Auflösung, und was ein Spieler tippt, sieht nur der Spielleiter (beim Buzzer auch alle anderen).
//
// Ablauf einer Frage (phase): prep (Spielleiter bereitet vor, Spieler sehen live mit, außer die Frage ist
// verdeckt) → open (Timer läuft, Antworten bzw. Buzzer) → judge (Freitext abhaken oder bei Multiple Choice
// ohne hinterlegte Lösung die richtige wählen) → reveal (Auflösung mit Punkten) → nächste Frage. Am Ende: end.
const crypto = require('node:crypto');
const { db, now, getSetting } = require('./db');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ohne O/0 und I/1
const EMPTY_MS = 10 * 60 * 1000;   // Räume ohne offenes Fenster verschwinden nach 10 Minuten
const GRACE_MS = 250;              // so lange wartet der Server nach dem ersten Buzzer auf früher gedrückte
const LAG_MAX = 300;               // so viel Verzögerung einer Verbindung gleicht er beim Buzzer höchstens aus
const MAX_QUESTIONS = 500;
const TYPES = ['buzzer', 'mc', 'tf', 'estimate', 'text'];
const ESTIMATE = ['all', 'top3', 'scaled'];
const EMOJIS = ['🦊', '🐼', '🦉', '🐸', '🐙', '🐢', '🤖', '👽', '🎃', '🌵', '🍩', '⭐', '🚀', '👑', '🐱', '🐶', '🦄', '🐝'];
const COLORS = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#d68910', '#16a085', '#5d6d7e'];

const int = (v, d, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);
function config() {
  return {
    hosts: ['all', 'members', 'admin'].includes(getSetting('quiz_hosts')) ? getSetting('quiz_hosts') : 'all',
    guests: getSetting('quiz_guests', '1') === '1',
    maxRooms: int(getSetting('quiz_max_rooms'), 20, 1, 200),
    maxPlayers: int(getSetting('quiz_max_players'), 30, 2, 200),
  };
}
const DEFAULTS = { time: 20, buzzTime: 30, answerTime: 10, right: 100, wrong: -50, others: 0, estimate: 'top3', rebuzz: true };
function cleanDefaults(d, base = DEFAULTS) {
  d = d || {};
  return {
    time: int(d.time, base.time, 3, 600), buzzTime: int(d.buzzTime, base.buzzTime, 3, 600), answerTime: int(d.answerTime, base.answerTime, 3, 600),
    right: int(d.right, base.right, -10000, 10000), wrong: int(d.wrong, base.wrong, -10000, 10000), others: int(d.others, base.others, -10000, 10000),
    estimate: ESTIMATE.includes(d.estimate) ? d.estimate : base.estimate, rebuzz: d.rebuzz == null ? base.rebuzz : !!d.rebuzz,
  };
}

// Eine Frage. Fehlende Werte kommen aus den Standards des Raums (null = „Standard“).
function cleanQuestion(q, old) {
  q = q || {}; old = old || {};
  const pick = (k, fn) => (k in q ? fn(q[k]) : k in old ? old[k] : fn(undefined));
  const num = (min, max) => v => (v === null || v === undefined || v === '' ? null : int(v, null, min, max));
  const type = pick('type', v => (TYPES.includes(v) ? v : 'buzzer'));
  const out = {
    id: old.id || crypto.randomBytes(4).toString('hex'),
    type,
    text: pick('text', v => str(v, 600)),
    options: pick('options', v => [0, 1, 2, 3].map(i => str(Array.isArray(v) ? v[i] : '', 160))),
    answer: pick('answer', v => str(v, 200)),                     // Buzzer/Freitext: richtige Antwort, Schätzen: Zahl als Text
    correct: pick('correct', v => (v === null || v === undefined || v === '' ? null : int(v, null, 0, 3))),   // Multiple Choice / Wahr-Falsch
    unit: pick('unit', v => str(v, 30)),
    right: pick('right', num(-10000, 10000)), wrong: pick('wrong', num(-10000, 10000)), others: pick('others', num(-10000, 10000)),
    time: pick('time', num(3, 600)), answerTime: pick('answerTime', num(3, 600)),
    estimate: pick('estimate', v => (ESTIMATE.includes(v) ? v : null)),
    rebuzz: pick('rebuzz', v => (v === null || v === undefined ? null : !!v)),
    note: pick('note', v => str(v, 300)),          // Hinweis nur für den Spielleiter
    explain: pick('explain', v => str(v, 400)),    // Erklärung, die bei der Auflösung alle sehen
    hidden: pick('hidden', v => !!v),               // beim Vorbereiten verdeckt
  };
  if (type === 'tf' && out.correct !== null && out.correct > 1) out.correct = null;
  return out;
}
// Werte, die tatsächlich gelten
function eff(r, q) {
  const d = r.defaults, v = (k, dk = k) => (q[k] === null || q[k] === undefined ? d[dk] : q[k]);
  return {
    right: v('right'), wrong: v('wrong'), others: v('others'), estimate: v('estimate'), rebuzz: v('rebuzz'),
    time: q.type === 'buzzer' ? v('time', 'buzzTime') : v('time'), answerTime: v('answerTime'),
  };
}
function parseNumber(s) {
  s = String(s == null ? '' : s).replace(/[\s'’]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');
// Freitext: passt die Antwort zu einer der richtigen (mehrere mit | trennen)?
const matches = (given, answer) => !!norm(given) && String(answer || '').split('|').some(a => norm(a) && norm(a) === norm(given));

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

function canHost(user) {
  const h = config().hosts;
  return h === 'all' || (h === 'members' && !!user) || (h === 'admin' && !!user && user.isAdmin);
}

// who: { pid, user, name } – pid ist „u<Konto>“ oder „g<Prüfsumme des Gast-Cookies>“
function create(who, opts = {}) {
  cleanup();
  if (rooms.size >= config().maxRooms) return null;
  const code = newCode();
  if (!code) return null;
  const r = {
    code, name: str(opts.name, 60).trim() || `Quiz von ${who.name}`, hidden: !!opts.hidden, guests: opts.guests !== false, locked: false,
    hostPid: who.pid, hostName: who.name, hostUserId: who.user ? who.user.id : null,
    defaults: cleanDefaults(opts.defaults), title: '', questions: [], cur: -1, phase: 'lobby',
    players: new Map(), kicked: new Set(), clients: new Set(),
    deadline: 0, total: 0, paused: 0, answers: new Map(), marks: new Map(),
    buzz: newBuzz(), result: null, log: [], qstats: [], awards: null,
    quizId: null, quizOwner: null, quizShared: false,
    timer: null, grace: null, emptySince: Date.now(), created: Date.now(), startedAt: 0, version: 0,
  };
  rooms.set(code, r);
  return r;
}
function newBuzz() { return { queue: [], tried: new Set(), answering: null, answerDeadline: 0, answerTotal: 0, mainLeft: 0, since: 0 }; }

function remove(r, why = 'Der Raum wurde geschlossen.') {
  // Läuft das Quiz noch, zählt der Stand beim Schließen als Endstand (fürs Profil), sobald eine Frage gestellt war
  if (r.phase !== 'lobby' && r.phase !== 'end' && r.qstats.some(Boolean)) finish(r);
  clearTimeout(r.timer); clearTimeout(r.grace);
  rooms.delete(r.code);
  for (const c of r.clients) { send(c.res, 'closed', { message: why }); c.res.end(); }
  r.clients.clear();
}
function cleanup() {
  for (const r of rooms.values()) if (!r.clients.size && Date.now() - r.emptySince > EMPTY_MS) remove(r);
}
setInterval(cleanup, 60 * 1000).unref();

function list() {
  return [...rooms.values()].filter(r => !r.hidden).map(r => ({
    code: r.code, name: r.name, host: r.hostName, title: r.title, players: r.players.size, guests: r.guests, locked: r.locked && r.phase !== 'lobby',
    status: r.phase === 'lobby' ? 'Warteraum' : r.phase === 'end' ? 'Endstand' : `Frage ${r.cur + 1}${r.questions.length > r.cur + 1 ? ' von ' + r.questions.length : ''}`,
  })).sort((a, b) => b.players - a.players || a.name.localeCompare(b.name, 'de'));
}

// ---------- Mitspielen ----------
const isHost = (r, pid) => r.hostPid === pid;
function join(r, who, opts = {}) {
  if (isHost(r, who.pid)) return { ok: true };
  if (r.players.has(who.pid)) return { ok: true };
  if (r.kicked.has(who.pid)) return { error: 'Der Spielleiter hat dich aus diesem Raum genommen.' };
  if (!who.user && !(r.guests && config().guests)) return { error: 'In diesem Raum spielen nur angemeldete Mitglieder mit.', login: true };
  if (r.locked && r.phase !== 'lobby') return { error: 'Der Spielleiter hat den Raum nach dem Start zugemacht.' };
  if (r.players.size >= config().maxPlayers) return { error: 'Der Raum ist voll.' };
  let name = who.name;
  if (!who.user) {
    name = str(opts.name, 24).replace(/\s+/g, ' ').trim();
    if (!name) return { error: 'Bitte gib einen Namen ein.' };
  }
  const taken = [...r.players.values()].some(p => norm(p.name) === norm(name)) || norm(r.hostName) === norm(name);
  if (taken) return { error: `Den Namen „${name}“ gibt es in diesem Raum schon.` };
  r.players.set(who.pid, {
    pid: who.pid, userId: who.user ? who.user.id : null, username: who.user ? who.user.username : null, name,
    avatar: who.user && who.user.avatar ? '/avatar/' + who.user.avatar : null,
    emoji: who.user ? null : (EMOJIS.includes(opts.emoji) ? opts.emoji : EMOJIS[crypto.randomInt(EMOJIS.length)]),
    color: COLORS.includes(opts.color) ? opts.color : who.user ? `hsl(${who.user.id * 47 % 360},45%,42%)` : COLORS[crypto.randomInt(COLORS.length)],
    guest: !who.user, score: 0, delta: 0, right: 0, input: '', estWins: 0, bestBuzz: null, joined: Date.now(),
  });
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

// ---------- Ansicht ----------
function current(r) { return r.questions[r.cur] || null; }
function playerList(r) {
  return [...r.players.values()].sort((a, b) => b.score - a.score || a.joined - b.joined).map(p => ({
    pid: p.pid, name: p.name, user: p.username, avatar: p.avatar, emoji: p.emoji, color: p.color, guest: p.guest,
    score: p.score, delta: p.delta, right: p.right, online: online(r, p.pid), has: hasAnswer(r, p.pid),
  }));
}
function hasAnswer(r, pid) {
  const q = current(r);
  if (!q || !['open', 'judge', 'reveal'].includes(r.phase)) return false;
  if (q.type === 'buzzer') return r.buzz.queue.some(b => b.pid === pid) || r.buzz.answering === pid || r.buzz.tried.has(pid);
  const a = r.answers.get(pid);
  return a !== undefined && a !== '' && a !== null;
}
function timer(r) {
  if (r.phase !== 'open') return null;
  const b = r.buzz;
  if (b.answering) return { kind: 'answer', left: b.answerDeadline ? Math.max(0, b.answerDeadline - Date.now()) : r.paused, total: b.answerTotal, paused: !b.answerDeadline };
  return { kind: 'main', left: r.deadline ? Math.max(0, r.deadline - Date.now()) : r.paused, total: r.total, paused: !r.deadline };
}
// Was Spieler von einer Frage sehen dürfen: ohne Lösung und ohne Spielleiter-Notiz
function publicQuestion(r, q) {
  if (!q) return null;
  const e = eff(r, q);
  return { id: q.id, type: q.type, text: q.text, options: q.type === 'mc' ? q.options : q.type === 'tf' ? ['Wahr', 'Falsch'] : null, unit: q.unit, right: e.right, wrong: e.wrong, others: e.others };
}
function base(r) {
  const q = current(r);
  const showQ = q && (r.phase !== 'prep' || !q.hidden);
  const b = r.buzz;
  return {
    code: r.code, name: r.name, hidden: r.hidden, guests: r.guests, locked: r.locked, title: r.title,
    phase: r.phase, cur: r.cur, count: r.questions.length, host: { name: r.hostName, online: online(r, r.hostPid) },
    q: showQ ? publicQuestion(r, q) : null, players: playerList(r), timer: timer(r),
    buzz: q && q.type === 'buzzer' && r.phase === 'open' ? {
      answering: b.answering, text: b.answering ? (r.players.get(b.answering) || {}).input || '' : '',
      queue: b.queue.map(x => x.pid), tried: [...b.tried],
    } : null,
    result: ['reveal', 'end'].includes(r.phase) ? r.result : null,
    awards: r.phase === 'end' ? r.awards : null,
    now: Date.now(), version: r.version,
  };
}
function hostView(r, s) {
  const q = current(r);
  return Object.assign(s, {
    isHost: true, defaults: r.defaults, questions: r.questions,
    inputs: Object.fromEntries([...r.players.values()].map(p => [p.pid, q && q.type === 'buzzer' ? p.input : r.answers.has(p.pid) ? r.answers.get(p.pid) : null])),
    queueMs: r.buzz.queue.map(x => ({ pid: x.pid, ms: x.ms })), firstMs: r.buzz.firstMs || null,
    marks: Object.fromEntries(r.marks), canUndo: r.log.length > 0,
    saved: r.quizId ? { id: r.quizId, mine: r.quizOwner === r.hostUserId, shared: r.quizShared } : null,
  });
}
function playerView(r, s, pid) {
  const p = r.players.get(pid);
  return Object.assign({}, s, { isHost: false, me: pid, joined: !!p, my: p ? { answer: r.answers.has(pid) ? r.answers.get(pid) : null, input: p.input } : null });
}
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(r) {
  r.version++;
  const s = base(r);
  let hs = null;
  for (const c of r.clients) send(c.res, 'state', isHost(r, c.pid) ? (hs ||= hostView(r, Object.assign({}, s))) : playerView(r, s, c.pid));
}
// Getippte Antworten gehen nur an den Spielleiter, beim Buzzer die Antwort des Antwortenden an alle
function sendInput(r, pid, text) {
  const all = r.buzz.answering === pid;
  for (const c of r.clients) if (all || isHost(r, c.pid)) send(c.res, 'input', { pid, text });
}

// ---------- Ablauf ----------
function schedule(r) {
  clearTimeout(r.timer);
  if (r.phase !== 'open') return;
  const b = r.buzz;
  const at = b.answering ? b.answerDeadline : r.deadline;
  if (!at) return;
  r.timer = setTimeout(() => {
    if (!rooms.has(r.code) || r.phase !== 'open') return;
    // Antwortzeit beim Buzzer abgelaufen: der Spielleiter entscheidet, die Uhr steht auf 0
    if (b.answering) { b.answerDeadline = 0; r.paused = 0; broadcast(r); return; }
    finishOpen(r);
    broadcast(r);
  }, Math.max(0, at - Date.now()) + 30);
  r.timer.unref?.();
}
function goTo(r, index) {
  clearTimeout(r.timer); clearTimeout(r.grace);
  r.cur = index;
  r.phase = 'prep';
  r.answers = new Map(); r.marks = new Map(); r.buzz = newBuzz(); r.result = null; r.deadline = 0; r.paused = 0;
  for (const p of r.players.values()) p.input = '';
}
function open(r) {
  const q = current(r);
  if (!q) return 'Es gibt keine Frage.';
  if (!q.text.trim()) return 'Die Frage hat noch keinen Text.';
  if (q.type === 'mc' && q.options.filter(o => o.trim()).length < 2) return 'Trag mindestens zwei Antwortmöglichkeiten ein.';
  const e = eff(r, q);
  r.phase = 'open';
  r.answers = new Map(); r.marks = new Map(); r.buzz = newBuzz(); r.result = null;
  r.total = e.time * 1000; r.deadline = Date.now() + r.total; r.paused = 0;
  r.buzz.since = Date.now();
  for (const p of r.players.values()) { p.delta = 0; p.input = ''; }
  r.qstats[r.cur] = { right: 0, answered: 0 };
  schedule(r);
  return null;
}
// Zeit um oder „Auflösen“: werten, wo der Server das selbst kann
function finishOpen(r) {
  const q = current(r);
  clearTimeout(r.timer); clearTimeout(r.grace);
  r.deadline = 0; r.paused = 0;
  if (q.type === 'buzzer') return reveal(r, {});
  if (q.type === 'text' || ((q.type === 'mc' || q.type === 'tf') && q.correct === null)) {
    r.phase = 'judge';
    if (q.type === 'text') for (const [pid, a] of r.answers) if (String(a).trim()) r.marks.set(pid, matches(a, q.answer));
    return;
  }
  return score(r);
}
// Automatische Wertung (Multiple Choice, Wahr/Falsch, Schätzen) und nach dem Abhaken (Freitext)
function score(r) {
  const q = current(r), e = eff(r, q), changes = {}, rights = [];
  const st = r.qstats[r.cur] || (r.qstats[r.cur] = { right: 0, answered: 0 });
  const answers = [];
  if (q.type === 'estimate') {
    const target = parseNumber(q.answer);
    const list = [];
    for (const [pid, a] of r.answers) {
      const v = parseNumber(a);
      if (v !== null && r.players.has(pid)) list.push({ pid, value: v, dist: target === null ? null : Math.abs(v - target) });
    }
    st.answered = list.length;
    if (target !== null) {
      list.sort((a, b) => a.dist - b.dist);
      list.forEach((x, i) => { x.rank = i && x.dist === list[i - 1].dist ? list[i - 1].rank : i + 1; });
      for (const x of list) {
        let pts = 0;
        if (e.estimate === 'all') pts = x.rank === 1 ? e.right : 0;
        else if (e.estimate === 'top3') pts = x.rank <= 3 ? Math.round(e.right * [1, 0.6, 0.3][x.rank - 1]) : 0;
        else pts = Math.round(e.right * Math.max(0, 1 - x.dist / Math.max(Math.abs(target), 1)));
        x.points = pts;
        if (pts) changes[x.pid] = pts;
        if (x.rank === 1) { rights.push(x.pid); r.players.get(x.pid).estWins++; }
      }
      st.right = list.filter(x => x.rank === 1).length;
    }
    answers.push(...list);
    return reveal(r, changes, rights, { kind: 'estimate', target, unit: q.unit, answers });
  }
  for (const [pid, a] of r.answers) {
    if (!r.players.has(pid) || a === null || a === '') continue;
    let ok;
    if (q.type === 'text') ok = !!r.marks.get(pid);
    else ok = Number(a) === q.correct;
    st.answered++;
    if (ok) { st.right++; rights.push(pid); if (e.right) changes[pid] = e.right; } else if (e.wrong) changes[pid] = e.wrong;
    answers.push({ pid, value: a, ok });
  }
  return reveal(r, changes, rights, { kind: q.type, answers });
}
function reveal(r, changes, rights = [], extra = {}) {
  const q = current(r);
  clearTimeout(r.timer); clearTimeout(r.grace);
  r.phase = 'reveal'; r.deadline = 0; r.paused = 0;
  apply(r, changes, rights);
  const correct = q.type === 'mc' ? (q.correct === null ? null : { index: q.correct, text: q.options[q.correct] })
    : q.type === 'tf' ? (q.correct === null ? null : { index: q.correct, text: q.correct === 0 ? 'Wahr' : 'Falsch' })
      : { text: (q.type === 'text' ? q.answer.split('|').map(a => a.trim()).filter(Boolean).join(' / ') : q.answer) + (q.type === 'estimate' && q.unit ? ' ' + q.unit : '') };
  r.result = Object.assign({ q: r.cur, correct, explain: q.explain, rights: r.log.length ? collectRights(r) : [] }, extra);
  return null;
}
function collectRights(r) { return r.log.filter(l => l.q === r.cur).flatMap(l => l.rights); }
function apply(r, changes, rights = [], kind = 'score') {
  const real = {};
  for (const [pid, n] of Object.entries(changes)) {
    const p = r.players.get(pid);
    if (!p || !n) continue;
    p.score += n; p.delta += n; real[pid] = n;
  }
  for (const pid of rights) { const p = r.players.get(pid); if (p) p.right++; }
  if (Object.keys(real).length || rights.length) r.log.push({ q: r.cur, changes: real, rights, kind });
}
function undo(r) {
  const l = r.log.pop();
  if (!l) return 'Es gibt nichts zurückzunehmen.';
  for (const [pid, n] of Object.entries(l.changes)) { const p = r.players.get(pid); if (p) { p.score -= n; p.delta -= n; } }
  for (const pid of l.rights) { const p = r.players.get(pid); if (p) p.right--; }
  if (r.result && r.result.q === r.cur) r.result.rights = collectRights(r);
  return null;
}

// Buzzer: Der Browser meldet, wie lange er seit dem Freigeben gebraucht hat. Das zählt, solange es höchstens
// LAG_MAX vor der Ankunft beim Server liegt; so verliert eine langsame Verbindung nicht immer.
function buzz(r, pid, reported) {
  const q = current(r), b = r.buzz;
  if (!q || q.type !== 'buzzer' || r.phase !== 'open') return 'Gerade kann man nicht buzzern.';
  if (!r.deadline && !b.answering) return 'Der Buzzer ist gerade angehalten.';
  if (b.tried.has(pid) || b.answering === pid || b.queue.some(x => x.pid === pid)) return null;
  const arrival = Date.now() - b.since;
  const rep = Number(reported);
  const ms = b.answering ? arrival : Number.isFinite(rep) ? Math.min(arrival, Math.max(arrival - LAG_MAX, rep)) : arrival;
  b.queue.push({ pid, ms: Math.max(0, Math.round(ms)) });
  b.queue.sort((x, y) => x.ms - y.ms);
  if (!b.answering && !r.grace) {
    r.grace = setTimeout(() => { r.grace = null; if (rooms.has(r.code) && r.phase === 'open' && !b.answering) { nextAnswer(r); broadcast(r); } }, GRACE_MS);
    r.grace.unref?.();
  }
  return null;
}
function nextAnswer(r) {
  const b = r.buzz, q = current(r), e = eff(r, q);
  const x = b.queue.shift();
  if (!x) return false;
  if (r.deadline) { b.mainLeft = Math.max(0, r.deadline - Date.now()); r.deadline = 0; } else if (r.paused) { b.mainLeft = r.paused; r.paused = 0; }
  const p = r.players.get(x.pid);
  if (p && (p.bestBuzz === null || x.ms < p.bestBuzz) && !b.tried.size) p.bestBuzz = x.ms;
  if (!b.tried.size) b.firstMs = x.ms;
  b.answering = x.pid; b.answerTotal = e.answerTime * 1000; b.answerDeadline = Date.now() + b.answerTotal;
  schedule(r);
  return true;
}
function judgeBuzz(r, ok) {
  const q = current(r), b = r.buzz, e = eff(r, q);
  if (!b.answering) return 'Gerade antwortet niemand.';
  const pid = b.answering;
  const st = r.qstats[r.cur];
  st.answered++;
  if (ok) { st.right++; return reveal(r, e.right ? { [pid]: e.right } : {}, [pid], { kind: 'buzzer', by: pid }); }
  // Falsch: Minuspunkte für ihn, auf Wunsch Punkte für alle anderen
  const changes = {};
  if (e.wrong) changes[pid] = e.wrong;
  if (e.others) for (const other of r.players.keys()) if (other !== pid) changes[other] = e.others;
  apply(r, changes, [], 'wrong');
  b.tried.add(pid); b.answering = null; b.answerDeadline = 0;
  const p = r.players.get(pid);
  if (p) p.input = '';
  if (!e.rebuzz) return reveal(r, {}, [], { kind: 'buzzer', by: null });
  if (nextAnswer(r)) return null;
  // Niemand mehr in der Reihe: Buzzer für die übrigen wieder frei, mit der restlichen Zeit
  if (b.mainLeft <= 0 || r.players.size <= b.tried.size) return reveal(r, {}, [], { kind: 'buzzer', by: null });
  r.deadline = Date.now() + b.mainLeft; b.since = Date.now();
  schedule(r);
  return null;
}

// ---------- Ende ----------
function finish(r) {
  clearTimeout(r.timer); clearTimeout(r.grace);
  if (r.phase === 'open') finishOpen(r);
  r.phase = 'end';
  const list = playerList(r);
  list.forEach((p, i) => { p.place = i && p.score === list[i - 1].score ? list[i - 1].place : i + 1; });
  const ps = [...r.players.values()];
  const fast = ps.filter(p => p.bestBuzz !== null).sort((a, b) => a.bestBuzz - b.bestBuzz)[0];
  const est = ps.filter(p => p.estWins).sort((a, b) => b.estWins - a.estWins)[0];
  let hard = null;
  r.qstats.forEach((s, i) => { if (s && s.answered && (!hard || s.right / s.answered < hard.rate)) hard = { q: i + 1, right: s.right, rate: s.right / s.answered }; });
  const asked = r.qstats.filter(Boolean).length;
  r.awards = {
    places: list.map(p => ({ pid: p.pid, place: p.place })), asked,
    fastest: fast ? { pid: fast.pid, ms: fast.bestBuzz } : null,
    estimator: est ? { pid: est.pid, wins: est.estWins } : null,
    hardest: hard ? { q: hard.q, right: hard.right } : null,
  };
  r.result = null;
  if (r.startedAt && ps.length) save(r, list, asked);
}
function save(r, list, asked) {
  const ts = now();
  const game = Number(db.prepare(`INSERT INTO quiz_games(room_name, quiz_title, host_user_id, host_name, questions, players, started_at, ended_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(r.name, r.title || null, r.hostUserId, r.hostName, asked, list.length, Math.floor(r.startedAt / 1000), ts).lastInsertRowid);
  const ins = db.prepare('INSERT INTO quiz_results(game_id, user_id, name, guest, points, place, correct) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const p of list) {
    const pl = r.players.get(p.pid);
    ins.run(game, pl.userId, pl.name, pl.guest ? 1 : 0, pl.score, p.place, pl.right);
  }
}
function userTotals(userId) {
  const t = db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(place = 1), 0) AS wins, MIN(place) AS best, COALESCE(SUM(points), 0) AS points,
                        COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(g.questions), 0) AS asked, MAX(g.ended_at) AS last
                        FROM quiz_results r JOIN quiz_games g ON g.id = r.game_id WHERE r.user_id = ?`).get(userId);
  t.hosted = db.prepare('SELECT COUNT(*) AS n FROM quiz_games WHERE host_user_id = ?').get(userId).n;
  t.made = db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE user_id = ?').get(userId).n;
  return t;
}

function removePlayer(r, pid) {
  r.players.delete(pid); r.answers.delete(pid); r.marks.delete(pid);
  const b = r.buzz;
  b.queue = b.queue.filter(x => x.pid !== pid);
  if (b.answering === pid && r.phase === 'open') {
    b.answering = null; b.answerDeadline = 0;
    if (!nextAnswer(r)) { r.deadline = Date.now() + Math.max(b.mainLeft, 1000); b.since = Date.now(); schedule(r); }
  }
}

// ---------- Aktionen ----------
// Spieler: answer (Multiple Choice/Wahr-Falsch), input (Schätzen, Freitext, Antwort nach dem Buzzer), buzz
function playerAction(r, pid, b) {
  const p = r.players.get(pid);
  if (!p) return { error: 'Du spielst in diesem Raum nicht mit.' };
  const q = current(r);
  if (b.action === 'buzz') return { error: buzz(r, pid, b.ms), full: true };
  if (b.action === 'answer') {
    if (!q || r.phase !== 'open' || !['mc', 'tf'].includes(q.type)) return { error: 'Gerade kann man nicht antworten.' };
    const n = int(b.value, -1, 0, q.type === 'tf' ? 1 : 3);
    if (n < 0 || (q.type === 'mc' && !q.options[n].trim())) return { error: 'Diese Antwort gibt es nicht.' };
    r.answers.set(pid, n);
    return { full: true };
  }
  if (b.action === 'input') {
    const text = str(b.text, q && q.type === 'estimate' ? 30 : 200);
    if (q && q.type === 'buzzer' && r.phase === 'open' && r.buzz.answering === pid) { p.input = text; sendInput(r, pid, text); return {}; }
    if (!q || r.phase !== 'open' || !['estimate', 'text'].includes(q.type)) return { error: 'Gerade kann man nichts eintragen.' };
    const had = hasAnswer(r, pid);
    r.answers.set(pid, text);
    sendInput(r, pid, text);
    return { full: had !== hasAnswer(r, pid) };
  }
  if (b.action === 'leave') {
    removePlayer(r, pid);
    return { full: true };
  }
  return { error: 'Unbekannte Aktion.' };
}

function hostAction(r, b) {
  const q = current(r);
  const need = (ok, msg) => (ok ? null : msg);
  switch (b.action) {
    case 'settings': {
      if ('name' in b) r.name = str(b.name, 60).trim() || r.name;
      for (const k of ['hidden', 'guests', 'locked']) if (k in b) r[k] = !!b[k];
      if (b.defaults) r.defaults = cleanDefaults(b.defaults, r.defaults);
      return null;
    }
    case 'load': {
      // Quiz aus einer Datei (Export dieser Seite): ersetzt die Fragen, laufende Punkte bleiben
      const err = loadQuestions(r, b);
      if (!err) r.quizId = r.quizOwner = null;
      return err;
    }
    case 'new': {
      r.questions = []; r.title = ''; r.quizId = r.quizOwner = null;
      if (r.phase !== 'lobby') { r.questions.push(cleanQuestion({ type: 'buzzer' })); goTo(r, 0); }
      return null;
    }
    case 'insert': {
      if (r.questions.length >= MAX_QUESTIONS) return 'Mehr Fragen gehen nicht.';
      const at = int(b.at, r.questions.length, 0, r.questions.length);
      r.questions.splice(at, 0, cleanQuestion(b.q || { type: q ? q.type : 'buzzer' }));
      if (at <= r.cur && r.cur >= 0) r.cur++;
      return null;
    }
    case 'edit': {
      const i = int(b.index, -1, 0, r.questions.length - 1);
      if (i < 0) return 'Diese Frage gibt es nicht.';
      const old = r.questions[i];
      if (i === r.cur && r.phase !== 'prep' && r.phase !== 'lobby' && b.q && 'type' in b.q && b.q.type !== old.type) return 'Den Typ kann man nur vor dem Freigeben ändern.';
      r.questions[i] = cleanQuestion(b.q, old);
      return null;
    }
    case 'delete': {
      const i = int(b.index, -1, 0, r.questions.length - 1);
      if (i < 0) return 'Diese Frage gibt es nicht.';
      if (i === r.cur && r.phase !== 'lobby') return 'Die aktuelle Frage kann man nicht löschen.';
      r.questions.splice(i, 1);
      if (i < r.cur) r.cur--;
      return null;
    }
    case 'move': {
      const from = int(b.from, -1, 0, r.questions.length - 1), to = int(b.to, -1, 0, r.questions.length - 1);
      if (from < 0 || to < 0) return 'Diese Frage gibt es nicht.';
      const curId = q && q.id;
      const [x] = r.questions.splice(from, 1);
      r.questions.splice(to, 0, x);
      if (curId) r.cur = r.questions.findIndex(y => y.id === curId);
      return null;
    }
    case 'start': {
      if (r.phase !== 'lobby') return 'Das Quiz läuft schon.';
      if (!r.questions.length) r.questions.push(cleanQuestion({ type: 'buzzer' }));
      r.startedAt = Date.now();
      for (const p of r.players.values()) { p.score = 0; p.delta = 0; p.right = 0; p.estWins = 0; p.bestBuzz = null; }
      r.log = []; r.qstats = [];
      goTo(r, 0);
      return null;
    }
    case 'goto': {
      const i = int(b.index, -1, 0, r.questions.length - 1);
      if (i < 0) return 'Diese Frage gibt es nicht.';
      if (r.phase === 'lobby' || r.phase === 'end') return 'Das Quiz läuft gerade nicht.';
      if (r.phase === 'open') return 'Erst die laufende Frage auflösen.';
      goTo(r, i);
      return null;
    }
    case 'open': return need(r.phase === 'prep', 'Die Frage ist schon freigegeben.') || open(r);
    case 'reveal': {
      if (r.phase !== 'open') return 'Gerade läuft keine Frage.';
      finishOpen(r);
      return null;
    }
    case 'right': case 'wrong': {
      if (!q || r.phase !== 'open' || q.type !== 'buzzer') return 'Gerade antwortet niemand.';
      return judgeBuzz(r, b.action === 'right');
    }
    case 'mark': {
      if (r.phase !== 'judge' || !q || q.type !== 'text') return 'Gerade gibt es nichts abzuhaken.';
      if (!r.answers.has(String(b.pid))) return 'Von diesem Spieler gibt es keine Antwort.';
      r.marks.set(String(b.pid), !!b.ok);
      return null;
    }
    case 'pick': {
      if (r.phase !== 'judge' || !q || !['mc', 'tf'].includes(q.type)) return 'Gerade gibt es nichts zu wählen.';
      const n = int(b.index, -1, 0, q.type === 'tf' ? 1 : 3);
      if (n < 0) return 'Diese Antwort gibt es nicht.';
      q.correct = n;
      score(r);
      return null;
    }
    case 'score': {
      if (r.phase !== 'judge' || !q || q.type !== 'text') return 'Gerade gibt es nichts zu werten.';
      score(r);
      return null;
    }
    case 'pause': {
      if (r.phase !== 'open') return 'Gerade läuft kein Timer.';
      const bz = r.buzz;
      if (bz.answering) { if (bz.answerDeadline) { r.paused = Math.max(0, bz.answerDeadline - Date.now()); bz.answerDeadline = 0; } }
      else if (r.deadline) { r.paused = Math.max(0, r.deadline - Date.now()); r.deadline = 0; }
      clearTimeout(r.timer);
      return null;
    }
    case 'resume': {
      if (r.phase !== 'open') return 'Gerade läuft kein Timer.';
      const bz = r.buzz;
      if (bz.answering) { if (!bz.answerDeadline) bz.answerDeadline = Date.now() + Math.max(r.paused, 1000); }
      else if (!r.deadline) { r.deadline = Date.now() + Math.max(r.paused, 1000); bz.since = Date.now(); }
      r.paused = 0;
      schedule(r);
      return null;
    }
    case 'addtime': {
      if (r.phase !== 'open') return 'Gerade läuft kein Timer.';
      const add = int(b.seconds, 10, 1, 600) * 1000, bz = r.buzz;
      if (bz.answering) { if (bz.answerDeadline) bz.answerDeadline = Math.max(bz.answerDeadline, Date.now()) + add; else r.paused += add; bz.answerTotal += add; }
      else { if (r.deadline) r.deadline += add; else r.paused += add; r.total += add; }
      schedule(r);
      return null;
    }
    case 'skip': {
      if (r.phase === 'lobby' || r.phase === 'end') return 'Das Quiz läuft gerade nicht.';
      return nextQuestion(r);
    }
    case 'next': {
      if (r.phase === 'open' || r.phase === 'judge') return 'Erst die Frage auflösen.';
      if (r.phase === 'lobby' || r.phase === 'end') return 'Das Quiz läuft gerade nicht.';
      return nextQuestion(r);
    }
    case 'give': {
      // Extrapunkte von Hand, für einen Spieler oder alle (auch negativ)
      const n = int(b.points, 0, -100000, 100000);
      if (!n) return 'Gib eine Punktzahl ein.';
      const targets = b.pid === 'all' ? [...r.players.keys()] : r.players.has(String(b.pid)) ? [String(b.pid)] : [];
      if (!targets.length) return 'Diesen Spieler gibt es nicht.';
      apply(r, Object.fromEntries(targets.map(t => [t, n])), [], 'give');
      return null;
    }
    case 'undo': return undo(r);
    case 'kick': {
      const pid = String(b.pid);
      if (!r.players.has(pid)) return 'Diesen Spieler gibt es nicht.';
      removePlayer(r, pid);
      r.kicked.add(pid);
      for (const c of r.clients) if (c.pid === pid) { send(c.res, 'closed', { message: 'Der Spielleiter hat dich aus dem Raum genommen.' }); c.res.end(); r.clients.delete(c); }
      return null;
    }
    case 'end': {
      if (r.phase === 'lobby') return 'Das Quiz hat noch nicht angefangen.';
      if (r.phase === 'end') return null;
      finish(r);
      return null;
    }
    case 'again': {
      if (r.phase !== 'end') return 'Das Quiz läuft noch.';
      r.phase = 'lobby'; r.cur = -1; r.result = null; r.awards = null; r.startedAt = 0;
      for (const p of r.players.values()) { p.score = 0; p.delta = 0; p.right = 0; }
      return null;
    }
  }
  return 'Unbekannte Aktion.';
}
function loadQuestions(r, d) {
  const qs = Array.isArray(d.questions) ? d.questions.slice(0, MAX_QUESTIONS).map(x => cleanQuestion(x)) : [];
  if (!qs.length) return 'In diesem Quiz sind keine Fragen.';
  r.questions = qs; r.title = str(d.title, 80).trim();
  if (d.defaults) r.defaults = cleanDefaults(d.defaults, r.defaults);
  if (r.phase !== 'lobby') goTo(r, 0);
  return null;
}

// ---------- Gespeicherte Quizze ----------
// Mitglieder speichern die Fragen eines Raums im Konto. Andere Mitglieder sehen ein Quiz erst, wenn sein Ersteller
// es teilt, damit niemand vor dem Spieleabend die Antworten nachlesen kann.
const MAX_SAVED = 200;
function library(user) {
  if (!user) return [];
  return db.prepare(`SELECT q.id, q.title, q.questions, q.shared, q.updated_at, q.user_id, u.username AS owner
                     FROM quizzes q JOIN users u ON u.id = q.user_id
                     WHERE q.user_id = ? OR q.shared = 1 ORDER BY q.user_id <> ?, q.updated_at DESC LIMIT 500`).all(user.id, user.id)
    .map(q => ({ id: q.id, title: q.title, questions: q.questions, shared: !!q.shared, updated: q.updated_at, owner: q.owner, mine: q.user_id === user.id }));
}
function saveQuiz(r, user, b = {}) {
  if (!user) return { error: 'Zum Speichern musst du angemeldet sein.' };
  if (!r.questions.length) return { error: 'Im Raum sind noch keine Fragen.' };
  const title = str(b.title, 80).trim() || r.title || r.name;
  const data = JSON.stringify({ defaults: r.defaults, questions: r.questions.map(q => { const c = { ...q }; delete c.id; return c; }) });
  const shared = b.shared ? 1 : 0, ts = now();
  const own = !b.copy && r.quizId && r.quizOwner === user.id && db.prepare('SELECT 1 FROM quizzes WHERE id = ? AND user_id = ?').get(r.quizId, user.id);
  if (own) {
    db.prepare('UPDATE quizzes SET title = ?, data = ?, questions = ?, shared = ?, updated_at = ? WHERE id = ?').run(title, data, r.questions.length, shared, ts, r.quizId);
  } else {
    if (db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE user_id = ?').get(user.id).n >= MAX_SAVED) return { error: `Mehr als ${MAX_SAVED} Quizze gehen nicht. Lösch erst ein altes.` };
    r.quizId = Number(db.prepare('INSERT INTO quizzes(user_id, title, data, questions, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, title, data, r.questions.length, shared, ts, ts).lastInsertRowid);
    r.quizOwner = user.id;
  }
  r.title = title; r.quizShared = !!shared;
  return { id: r.quizId };
}
function loadQuiz(r, user, id) {
  const q = user && db.prepare('SELECT * FROM quizzes WHERE id = ? AND (user_id = ? OR shared = 1)').get(id, user.id);
  if (!q) return 'Dieses Quiz gibt es nicht (mehr).';
  const d = JSON.parse(q.data);
  const err = loadQuestions(r, { title: q.title, defaults: d.defaults, questions: d.questions });
  if (err) return err;
  r.quizId = q.id; r.quizOwner = q.user_id; r.quizShared = !!q.shared;
  return null;
}
function deleteQuiz(user, id) {
  const ok = user && db.prepare('DELETE FROM quizzes WHERE id = ? AND (user_id = ? OR ?)').run(id, user.id, user.isAdmin ? 1 : 0).changes;
  if (!ok) return 'Dieses Quiz kannst du nicht löschen.';
  for (const r of rooms.values()) if (r.quizId === id) r.quizId = r.quizOwner = null;
  return null;
}

function nextQuestion(r) {
  if (r.phase === 'open') { clearTimeout(r.timer); clearTimeout(r.grace); }
  if (r.cur + 1 >= r.questions.length) {
    if (r.questions.length >= MAX_QUESTIONS) return 'Mehr Fragen gehen nicht.';
    const q = current(r);
    r.questions.push(cleanQuestion({ type: q ? q.type : 'buzzer' }));
  }
  goTo(r, r.cur + 1);
  return null;
}

module.exports = {
  config, canHost, create, get, list, join, connect, remove, broadcast, playerAction, hostAction, isHost, userTotals,
  library, saveQuiz, loadQuiz, deleteQuiz,
  cleanQuestion, parseNumber, matches, EMOJIS, COLORS, DEFAULTS, _rooms: rooms,
};
