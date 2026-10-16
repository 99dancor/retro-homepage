'use strict';
// Musik-Lobbys: Mehrere Mitglieder hören dieselbe Warteschlange zur selben Zeit.
// Die Lobbys leben nur im Arbeitsspeicher; nach einem Neustart des Servers sind sie weg.
// Jeder Browser bekommt Änderungen per Server-Sent Events und rechnet die Stelle im Lied aus
// startedAt (Serverzeit, zu der das Lied bei Sekunde 0 gewesen wäre) selbst nach.
const crypto = require('node:crypto');

const MAX_LOBBIES = 50;
const MAX_QUEUE = 500;
const EMPTY_MS = 10 * 60 * 1000;   // leere Lobbys verschwinden nach 10 Minuten

const lobbies = new Map();

function create(user, { name, hidden, open }) {
  if (lobbies.size >= MAX_LOBBIES) cleanup(true);
  if (lobbies.size >= MAX_LOBBIES) return null;
  const id = crypto.randomBytes(5).toString('hex');
  const l = {
    id, name: String(name || '').trim().slice(0, 60) || `Lobby von ${user.name}`,
    hostId: user.id, hostName: user.name, hidden: !!hidden, open: open !== false,
    queue: [], index: -1, playing: false, startedAt: 0, pausedPos: 0,
    clients: new Set(), emptySince: Date.now(), timer: null, version: 0,
    rights: new Map(),   // Player-Rechte einzelner Zuhörer (Konto-ID -> true/false), sonst gilt „open“
  };
  lobbies.set(id, l);
  return l;
}

const get = id => lobbies.get(String(id)) || null;
const position = l => (l.playing ? Math.max(0, (Date.now() - l.startedAt) / 1000) : l.pausedPos);
const current = l => l.queue[l.index] || null;
const isHost = (l, user) => !!user && (user.isAdmin || user.id === l.hostId);
const canControl = (l, user) => isHost(l, user) || (!!user && (l.rights.has(user.id) ? l.rights.get(user.id) : l.open));

// Wer gerade zuhört (jedes Konto einmal, auch mit mehreren Fenstern)
function listeners(l) {
  const users = new Map();
  for (const c of l.clients) users.set(c.user.id, c.user);
  return [...users.values()].map(u => ({ id: u.id, name: u.name, user: u.username, host: u.id === l.hostId, control: canControl(l, u) }))
    .sort((a, b) => b.host - a.host || a.name.localeCompare(b.name, 'de'));
}

function summary(l) {
  const c = current(l);
  return { id: l.id, name: l.name, host: l.hostName, hidden: l.hidden, listeners: listeners(l).length, now: c ? c.title : null };
}
function list(user) {
  return [...lobbies.values()].filter(l => !l.hidden || l.hostId === user.id || l.clients.size && [...l.clients].some(c => c.user.id === user.id))
    .map(summary).sort((a, b) => b.listeners - a.listeners || a.name.localeCompare(b.name, 'de'));
}

function state(l) {
  return {
    id: l.id, name: l.name, host: l.hostName, hostId: l.hostId, hidden: l.hidden, open: l.open,
    queue: l.queue, index: l.index, playing: l.playing, startedAt: l.startedAt, pausedPos: l.pausedPos,
    listeners: listeners(l), now: Date.now(), version: l.version,
  };
}

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(l) {
  l.version++;
  schedule(l);
  const s = state(l);
  for (const c of l.clients) send(c.res, 'state', s);
}

// Lieder mit bekannter Länge wechselt der Server selbst, auch wenn gerade niemand zuhört
function schedule(l) {
  clearTimeout(l.timer);
  const c = current(l);
  if (!l.playing || !c || !c.duration) return;
  const left = (c.duration - position(l)) * 1000 + 800;
  l.timer = setTimeout(() => { if (current(l) === c && l.playing) { advance(l, 1); broadcast(l); } }, Math.max(0, left));
  l.timer.unref?.();
}

function playAt(l, index, pos = 0) {
  l.index = index;
  if (index < 0 || index >= l.queue.length) { l.index = l.queue.length ? l.queue.length - 1 : -1; l.playing = false; l.pausedPos = 0; return; }
  l.playing = true;
  l.startedAt = Date.now() - pos * 1000;
}
function advance(l, step) {
  const next = l.index + step;
  if (next >= l.queue.length) {
    // Am Ende stehen bleiben; kommt später etwas dazu, geht es dort weiter
    l.index = l.queue.length; l.playing = false; l.pausedPos = 0;
    return;
  }
  playAt(l, Math.max(0, next));
}

function addItems(l, items, user) {
  const room = MAX_QUEUE - l.queue.length;
  const added = items.slice(0, Math.max(0, room)).map(it => ({ ...it, key: crypto.randomBytes(4).toString('hex'), by: user.name, byUser: user.username }));
  l.queue.push(...added);
  // Lief nichts mehr (leer oder am Ende), startet das erste neue Lied sofort
  if (added.length && (l.index < 0 || l.index >= l.queue.length - added.length) && !l.playing) playAt(l, l.queue.length - added.length);
  return added.length;
}

// Steuerung: gibt eine Fehlermeldung zurück, QUIET wenn sich nichts geändert hat, sonst null
const QUIET = Symbol('quiet');
function control(l, user, b) {
  const a = String(b.action || '');
  const idx = l.queue.findIndex(q => q.key === b.key);
  if (a === 'ended') {
    // Jeder Zuhörer meldet das Ende; zählen tut nur die erste Meldung zum laufenden Lied
    // Bei bekannter Länge erst kurz vor Schluss, damit niemand so an der Steuerung vorbei weiterspringt
    const c = current(l);
    if (idx !== l.index || !l.playing || position(l) <= 3 || (c.duration && position(l) < c.duration - 5)) return QUIET;
    advance(l, 1);
    return null;
  }
  if (a === 'meta') {
    // Länge (und notfalls Titel) eines YouTube-Videos kennt nur der Player im Browser
    const it = l.queue[idx], d = Number(b.duration);
    if (!it || it.type !== 'yt') return QUIET;
    let changed = false;
    if (!it.duration && d > 0 && d < 24 * 3600) { it.duration = Math.round(d); changed = true; }
    if (it.guessed && typeof b.title === 'string' && b.title.trim()) { it.title = b.title.trim().slice(0, 200); it.guessed = false; changed = true; }
    return changed ? null : QUIET;
  }
  if (!canControl(l, user)) return 'Nur der Gastgeber darf hier steuern.';
  switch (a) {
    case 'play':
      if (l.playing) return null;
      if (l.index < 0 || l.index >= l.queue.length) { if (l.queue.length) playAt(l, l.index < 0 ? 0 : l.queue.length - 1); return null; }
      l.playing = true; l.startedAt = Date.now() - l.pausedPos * 1000; return null;
    case 'pause':
      if (l.playing) { l.pausedPos = position(l); l.playing = false; }
      return null;
    case 'seek': {
      const pos = Math.max(0, Number(b.pos) || 0);
      if (l.playing) l.startedAt = Date.now() - pos * 1000; else l.pausedPos = pos;
      return null;
    }
    case 'next': advance(l, 1); return null;
    case 'prev': if (position(l) > 4 || l.index <= 0) playAt(l, Math.max(0, Math.min(l.index, l.queue.length - 1))); else advance(l, -1); return null;
    case 'jump': if (idx >= 0) playAt(l, idx); return null;
    case 'remove':
      if (idx < 0) return null;
      l.queue.splice(idx, 1);
      if (idx < l.index) l.index--;
      else if (idx === l.index) { if (l.index < l.queue.length) playAt(l, l.index); else { l.playing = false; l.pausedPos = 0; } }
      return null;
    case 'move': {
      const to = Math.max(0, Math.min(l.queue.length - 1, idx + (Number(b.by) < 0 ? -1 : 1)));
      if (idx < 0 || to === idx) return null;
      const cur = current(l);
      const [it] = l.queue.splice(idx, 1);
      l.queue.splice(to, 0, it);
      if (cur) l.index = l.queue.indexOf(cur);
      return null;
    }
    case 'clear': l.queue = []; l.index = -1; l.playing = false; l.pausedPos = 0; return null;
    case 'rights': {
      // Gastgeber und Admin geben einzelnen Zuhörern Player-Rechte oder nehmen sie ihnen
      if (!isHost(l, user)) return 'Nur der Gastgeber vergibt Player-Rechte.';
      const id = Number(b.user);
      if (!id || id === l.hostId) return 'Dem Gastgeber kann man die Rechte nicht nehmen.';
      l.rights.set(id, !!b.allow);
      return null;
    }
    case 'settings':
      if (!isHost(l, user)) return 'Nur der Gastgeber ändert die Einstellungen.';
      if (typeof b.name === 'string' && b.name.trim()) l.name = b.name.trim().slice(0, 60);
      // „Alle dürfen steuern“ neu gesetzt: einzeln vergebene Rechte gelten nicht mehr
      if ('open' in b && l.open !== !!b.open) { l.open = !!b.open; l.rights.clear(); }
      if ('hidden' in b) l.hidden = !!b.hidden;
      return null;
    default: return 'Unbekannte Aktion.';
  }
}

function join(l, user, res) {
  const c = { user, res };
  l.clients.add(c);
  l.emptySince = 0;
  broadcast(l);
  const ping = setInterval(() => send(res, 'ping', { now: Date.now() }), 20000);
  return () => {
    clearInterval(ping);
    l.clients.delete(c);
    if (!l.clients.size) l.emptySince = Date.now();
    if (lobbies.has(l.id)) broadcast(l);
  };
}

function remove(l) {
  clearTimeout(l.timer);
  for (const c of l.clients) { send(c.res, 'closed', {}); c.res.end(); }
  lobbies.delete(l.id);
}

function cleanup(force = false) {
  const t = Date.now();
  for (const l of lobbies.values()) {
    if (!l.clients.size && (force || t - l.emptySince > EMPTY_MS)) remove(l);
  }
}
setInterval(cleanup, 60e3).unref();

module.exports = { create, get, list, state, control, join, remove, addItems, canControl, broadcast, QUIET, MAX_QUEUE };
