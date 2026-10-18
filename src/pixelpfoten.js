'use strict';
// Pixelpfoten-Besuche: Mitglieder besuchen die Tiere anderer Mitglieder, allein oder mit einem eigenen Tier.
//
// - Nachbarn und Zimmer kommen aus den gespeicherten Spielständen (game_saves). Wer besuchen darf, steht im
//   Spielstand des Gastgebers (visitors: members | friends | none).
// - Was Besucher tun (streicheln, spielen, Futter dalassen, Gruß), landet im Besuchsbuch (pp_visits). Das Spiel des
//   Gastgebers holt die Einträge ab und rechnet sie selbst in seinen Spielstand ein (games/haustier/src/js/visits.js).
// - Live-Zimmer leben nur im Arbeitsspeicher: Wer gerade im Zimmer ist (Gastgeber oder Besucher), schickt die Stände
//   seiner eigenen Tiere, der Server reicht sie per Server-Sent Events an die anderen weiter.
const crypto = require('node:crypto');
const { db, now } = require('./db');
const profiles = require('./profiles');
const notify = require('./notify');

let game = null;
function rules() {
  game ||= {
    state: require('../games/haustier/src/js/state.js'),
    pets: require('../games/haustier/src/js/pets.js'),
    visits: require('../games/haustier/src/js/visits.js'),
  };
  return game;
}

const KEEP_DAYS = 30;          // Besuchsbuch-Einträge verschwinden nach 30 Tagen
const MAX_NEIGHBOURS = 60;
const MAX_LIVE = 8;            // Leute je Live-Zimmer
const nameOf = u => u.display_name || u.username;

// Spielstand eines Kontos, auf jetzt hochgerechnet, oder null
function loadSave(userId) {
  const row = db.prepare("SELECT data, updated_at FROM game_saves WHERE user_id = ? AND app_slug = 'haustier' AND slot = 'main'").get(userId);
  if (!row) return null;
  const { state, pets } = rules();
  let s;
  try { s = state.migrate(JSON.parse(row.data)); } catch { return null; }
  if (!s) return null;
  pets.tickAll(s);
  return s;
}

// Darf viewer die Tiere von host besuchen? s: Spielstand des Gastgebers
function allowed(viewer, host, s) {
  if (!viewer || !host || host.disabled || !s || !s.pets.length) return false;
  if (viewer.id === host.id) return true;
  const p = rules().visits.privacyOf(s);
  if (p === 'none') return false;
  if (p === 'friends') return profiles.friendship(viewer.id, host.id) === 'friends';
  return true;
}

function petsOf(s) {
  const { pets, visits } = rules();
  return s.pets.map(p => visits.publicPet(p, pets.level(p)));
}

// Mitglieder, die man besuchen kann: wer gerade live ist zuerst, dann Freunde, dann zuletzt gespielt
function neighbours(viewer) {
  const rows = db.prepare(`SELECT u.id, u.username, u.display_name, u.disabled, s.data, s.updated_at FROM game_saves s JOIN users u ON u.id = s.user_id
                           WHERE s.app_slug = 'haustier' AND s.slot = 'main' AND u.disabled = 0 AND u.id != ?
                           ORDER BY s.updated_at DESC LIMIT 400`).all(viewer.id);
  const { state } = rules();
  const out = [];
  for (const r of rows) {
    let s;
    try { s = state.migrate(JSON.parse(r.data)); } catch { continue; }
    if (!allowed(viewer, r, s)) continue;
    const friend = profiles.friendship(viewer.id, r.id) === 'friends';
    out.push({
      user: r.username, name: nameOf(r), url: profiles.profileUrl(r.username), friend, live: isLive(r.id),
      room: s.room, pets: petsOf(s).map(p => ({ name: p.name, species: p.species, color: p.color, acc: p.acc })), seen: r.updated_at,
    });
  }
  out.sort((a, b) => (b.live - a.live) || (b.friend - a.friend) || (b.seen - a.seen));
  return out.slice(0, MAX_NEIGHBOURS);
}

// Zimmer eines Gastgebers für einen Besucher, oder null (gibt es nicht / nicht erlaubt)
function room(viewer, username) {
  const host = profiles.findUser(username);
  if (!host || host.id === viewer.id) return null;
  const s = loadSave(host.id);
  if (!allowed(viewer, host, s)) return null;
  return {
    host: { user: host.username, name: nameOf(host), url: profiles.profileUrl(host.username) },
    room: s.room, pets: petsOf(s), live: isLive(host.id), book: book(host.id, 8),
  };
}

// ---------- Besuchsbuch ----------
function day(t = Date.now()) { return rules().state.dayKey(t); }

// Eine Handlung eines Besuchers eintragen. b: { kind, pet, detail }. Gibt { ok, counted } oder { error } zurück.
function act(viewer, username, b) {
  const host = profiles.findUser(username);
  if (!host || host.id === viewer.id) return { error: 'Dieses Zimmer gibt es nicht.' };
  const s = loadSave(host.id);
  if (!allowed(viewer, host, s)) return { error: 'Hier darfst du gerade nicht zu Besuch sein.' };
  const { visits } = rules();
  const kind = String(b.kind || '');
  const k = visits.KINDS[kind];
  if (!k) return { error: 'Unbekannte Handlung.' };
  let petId = null, detail = null;
  if (kind === 'pet' || kind === 'play') {
    petId = String(b.pet || '');
    if (!s.pets.some(p => p.id === petId)) return { error: 'Dieses Tier gibt es hier nicht.' };
  }
  if (kind === 'gift') {
    detail = String(b.detail || '');
    if (!visits.giftable(detail)) return { error: 'Das kann man nicht verschenken.' };
  }
  if (kind === 'sticker') {
    detail = String(b.detail || '');
    if (!visits.STICKERS.includes(detail)) return { error: 'Unbekannter Gruß.' };
  }
  if (kind === 'playdate') detail = String(b.detail || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || null;
  const today = day();
  const n = db.prepare('SELECT COUNT(*) AS n FROM pp_visits WHERE host_id = ? AND visitor_id = ? AND day = ? AND kind = ?').get(host.id, viewer.id, today, kind).n;
  if (n >= k.limit) return { ok: true, counted: false };
  db.prepare('INSERT INTO pp_visits(host_id, visitor_id, kind, pet_id, detail, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(host.id, viewer.id, kind, petId, detail, today, now());
  // Der Gastgeber hat das Spiel offen: sofort abholen lassen. Sonst einmal am Tag je Besucher benachrichtigen.
  const r = rooms.get(host.id);
  if (r && [...r.clients].some(c => c.user.id === host.id)) broadcast(r, 'post', {}, c => c.user.id === host.id);
  else if (kind === 'visit') {
    notify.send(host.id, 'besuch', { key: `besuch:${viewer.id}:${today}`, once: true, title: `🐾 ${nameOf(viewer)} hat deine Pixelpfoten besucht`, body: 'Schau nach, was bei dir los war.', url: '/haustier/' });
  }
  if (Math.random() < 0.05) cleanup();
  return { ok: true, counted: true };
}

// Noch nicht abgeholte Einträge für den Gastgeber
function inbox(userId) {
  return db.prepare(`SELECT v.id, v.kind, v.pet_id, v.detail, v.created_at, u.username, u.display_name FROM pp_visits v JOIN users u ON u.id = v.visitor_id
                     WHERE v.host_id = ? AND v.applied = 0 ORDER BY v.id LIMIT 200`).all(userId)
    .map(r => ({ id: r.id, kind: r.kind, pet_id: r.pet_id, detail: r.detail, at: r.created_at, visitor: nameOf(r) }));
}
function markApplied(userId, upTo) {
  db.prepare('UPDATE pp_visits SET applied = 1 WHERE host_id = ? AND id <= ?').run(userId, Number(upTo) || 0);
}

// Wer zuletzt da war: je Besucher und Tag eine Zeile mit den Grüßen
function book(hostId, limit = 12) {
  return db.prepare(`SELECT u.username, u.display_name, v.day, MAX(v.created_at) AS at,
                       GROUP_CONCAT(CASE WHEN v.kind = 'sticker' THEN v.detail END, '') AS stickers,
                       MAX(v.kind = 'playdate') AS playdate, MAX(CASE WHEN v.kind = 'playdate' THEN v.detail END) AS buddy
                     FROM pp_visits v JOIN users u ON u.id = v.visitor_id WHERE v.host_id = ? AND u.disabled = 0
                     GROUP BY v.visitor_id, v.day ORDER BY at DESC LIMIT ?`).all(hostId, limit)
    .map(r => ({ user: r.username, name: nameOf(r), url: profiles.profileUrl(r.username), at: r.at, stickers: r.stickers || '', buddy: r.playdate ? r.buddy : null }));
}

function cleanup() {
  db.prepare('DELETE FROM pp_visits WHERE created_at < ?').run(now() - KEEP_DAYS * 86400);
}

// ---------- Live-Zimmer ----------
const rooms = new Map();       // Gastgeber-id -> { hostId, clients: Set<{ user, res, sid, pets, toy }> }
const isLive = hostId => { const r = rooms.get(hostId); return !!r && [...r.clients].some(c => c.user.id === hostId); };

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(r, event, data, filter = () => true) { for (const c of r.clients) if (filter(c)) send(c.res, event, data); }
const member = c => ({ sid: c.sid, user: c.user.username, name: nameOf(c.user), host: c.user.id === c.hostId, pets: c.pets, toy: c.toy });

// Verbindung zum Live-Zimmer von username. Gibt eine Abmelde-Funktion zurück oder { error }.
function join(viewer, username, res) {
  const host = profiles.findUser(username);
  if (!host) return { error: 'Dieses Zimmer gibt es nicht.' };
  if (host.id !== viewer.id && !allowed(viewer, host, loadSave(host.id))) return { error: 'Hier darfst du gerade nicht zu Besuch sein.' };
  let r = rooms.get(host.id);
  if (!r) { r = { hostId: host.id, clients: new Set() }; rooms.set(host.id, r); }
  const people = new Set([...r.clients].map(c => c.user.id));
  if (!people.has(viewer.id) && people.size >= MAX_LIVE) return { error: `Hier sind gerade schon ${MAX_LIVE} Leute.` };
  const c = { user: viewer, res, sid: crypto.randomBytes(8).toString('hex'), pets: [], toy: null, hostId: host.id };
  r.clients.add(c);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  send(res, 'hello', { sid: c.sid, members: [...r.clients].filter(o => o !== c).map(member) });
  broadcast(r, 'join', member(c), o => o !== c);
  const ping = setInterval(() => send(res, 'ping', {}), 20000).unref();
  return () => {
    clearInterval(ping);
    r.clients.delete(c);
    broadcast(r, 'leave', { sid: c.sid });
    if (!r.clients.size) rooms.delete(host.id);
  };
}

// Stand der eigenen Tiere (und des Spielzeugs) weiterreichen
function update(viewer, username, b) {
  const host = profiles.findUser(username);
  const r = host && rooms.get(host.id);
  const c = r && [...r.clients].find(o => o.sid === String(b.sid || '') && o.user.id === viewer.id);
  if (!c) return { error: 'Du bist nicht mehr mit dem Zimmer verbunden.' };
  const { visits } = rules();
  c.pets = (Array.isArray(b.pets) ? b.pets : []).slice(0, 3).map(visits.cleanLivePet).filter(Boolean);
  c.toy = visits.cleanLiveToy(b.toy);
  broadcast(r, 'state', { sid: c.sid, pets: c.pets, toy: c.toy }, o => o !== c);
  return { ok: true };
}

module.exports = { neighbours, room, act, inbox, markApplied, book, join, update, isLive, cleanup, KEEP_DAYS };
