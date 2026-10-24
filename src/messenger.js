'use strict';
// Messenger: im Windows-XP-Design „ICU“ (wie ICQ), im Windows-98-Design „DSN“ (wie der MSN Messenger). Dahinter steckt
// dasselbe: Freunde als Kontaktliste, Online-Status, Gespräche (Privatnachrichten), Anfragen und Einladungen.
// Jeder Desktop-Tab hält eine Live-Verbindung (Server-Sent Events, /api/messenger/stream). Ob jemand da ist, weiß nur
// dieser Arbeitsspeicher: online heißt „mindestens ein Tab verbunden“. Gespeichert wird nur der gewählte Status,
// die Statusnachricht und wann jemand zuletzt da war.
const { db, now } = require('./db');
const p = require('./profiles');

const STATUS = { online: 'Online', away: 'Abwesend', dnd: 'Nicht stören', invisible: 'Unsichtbar' };
const MAX_MSG = 80;          // Zeichen der Statusnachricht
const GRACE = 8000;          // so lange nach dem letzten Tab gilt man noch als online (Neuladen, Seitenwechsel)
const PING = 25000;          // Lebenszeichen auf jeder Verbindung, damit Proxys sie nicht schließen

// userId → Map(Verbindungskennung → { res, idle })
const conns = new Map();
const leaving = new Map();   // userId → Timer bis „offline“

const userById = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const connected = userId => conns.has(userId) || leaving.has(userId);

function write(res, type, data) {
  try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* Verbindung schon zu */ }
}
// Ereignis an alle offenen Tabs eines Kontos
function send(userId, type, data = {}) {
  const m = conns.get(userId);
  if (m) for (const c of m.values()) write(c.res, type, data);
}

// Status, wie er wirklich ist: offline ohne Verbindung; „online“ wird zu „abwesend“, wenn alle Tabs lange nichts mehr gemacht haben
function rawStatus(u) {
  if (!u || u.disabled || !connected(u.id)) return 'offline';
  const st = Object.hasOwn(STATUS, u.status) ? u.status : 'online';
  if (st !== 'online') return st;
  const m = conns.get(u.id);
  return m && m.size && [...m.values()].every(c => c.idle) ? 'away' : 'online';
}

// Darf viewer etwas sehen, das target nur members | friends | nobody zeigt?
function allowed(viewer, target, rule) {
  if (!viewer || !target) return false;
  if (viewer.id === target.id) return true;
  if (p.blocked(viewer.id, target.id)) return false;
  if (rule === 'members') return true;
  if (rule === 'friends') return p.friendship(viewer.id, target.id) === 'friends';
  return false;
}
// Status, wie viewer ihn sieht: Unsichtbare und alle, die ihren Status nicht zeigen, sind offline
function statusFor(viewer, target) {
  const st = rawStatus(target);
  if (viewer && viewer.id === target.id) return st;
  if (st === 'invisible' || !allowed(viewer, target, target.presence_from)) return 'offline';
  return st;
}
// „zuletzt online“ nur grob (heute, gestern, vor 3 Tagen …), und nur für die, die den Status sehen dürfen
function lastSeenFor(viewer, target) {
  if (!target.last_seen || !target.show_last_seen || target.status === 'invisible' || !allowed(viewer, target, target.presence_from)) return null;
  const day = d => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  const diff = day(new Date()) - day(new Date(target.last_seen * 1000));
  if (diff <= 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff < 7) return `vor ${diff} Tagen`;
  if (diff < 30) return `vor ${Math.floor(diff / 7)} Woche${diff >= 14 ? 'n' : ''}`;
  return 'vor über einem Monat';
}

// Was alle gerade machen (Tische, Paint, Mediaplayer, Werwolf, Quiz), so wie viewer die Lobbys sehen darf: userId → Lobby
function activities(viewer) {
  const out = new Map();
  if (!viewer) return out;
  let all = [];
  try { all = require('./lobbies').collect(viewer); } catch (e) { console.error('Messenger:', e.message); }
  for (const l of all) for (const id of l.ids) if (!out.has(id)) out.set(id, { icon: l.icon, what: l.what, name: l.name, url: l.url, app: l.app });
  return out;
}
function activityFor(viewer, target, acts) {
  if (statusFor(viewer, target) === 'offline' || !allowed(viewer, target, target.activity_from)) return null;
  return (acts || activities(viewer)).get(target.id) || null;
}

// Wer bekommt mit, wenn sich mein Status ändert? Alle verbundenen Freunde (die Kontaktliste besteht aus Freunden)
function tellFriends(userId) {
  for (const f of p.friendsOf(userId)) if (conns.has(f.id)) send(f.id, 'kontakte');
  send(userId, 'ich', me(userById(userId)));
}

function me(u) {
  return { user: u.username, name: p.displayName(u), number: p.number(u), status: rawStatus(u), chosen: u.status, msg: u.status_msg || '' };
}

// Neue Live-Verbindung eines Tabs. Gibt eine Funktion zurück, die sie wieder schließt.
function connect(user, res, id, extra = {}) {
  const wasOnline = connected(user.id);
  clearTimeout(leaving.get(user.id));
  leaving.delete(user.id);
  if (!conns.has(user.id)) conns.set(user.id, new Map());
  const key = String(id || Math.random()).slice(0, 40);
  conns.get(user.id).set(key, { res, idle: false });
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
  write(res, 'hallo', { ...me(userById(user.id)), unread: p.unreadCount(user.id), conn: key, ...extra });
  if (!wasOnline) tellFriends(user.id);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* zu */ } }, PING);
  return () => {
    clearInterval(ping);
    const m = conns.get(user.id);
    if (!m || !m.has(key)) return;
    m.delete(key);
    if (m.size) { tellFriends(user.id); return; }
    conns.delete(user.id);
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
    leaving.set(user.id, setTimeout(() => {
      leaving.delete(user.id);
      if (!conns.has(user.id)) tellFriends(user.id);
    }, GRACE));
  };
}
// Ein Tab meldet, ob gerade jemand davor sitzt (Maus, Tastatur). Sind alle Tabs untätig, gilt man als abwesend.
function setIdle(userId, id, idle) {
  const c = conns.get(userId) && conns.get(userId).get(String(id || ''));
  if (!c || c.idle === !!idle) return;
  const before = rawStatus(userById(userId));
  c.idle = !!idle;
  if (rawStatus(userById(userId)) !== before) tellFriends(userId);
}

function setStatus(userId, status, msg) {
  const u = userById(userId);
  const st = Object.hasOwn(STATUS, status) ? status : u.status;
  const m = msg === undefined ? u.status_msg : String(msg).replace(/[\p{C}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MSG) || null;
  db.prepare('UPDATE users SET status = ?, status_msg = ? WHERE id = ?').run(st, m, userId);
  tellFriends(userId);
  return me(userById(userId));
}

// Kurzform eines Kontos für die Oberfläche
function card(viewer, u, acts) {
  const st = statusFor(viewer, u);
  return {
    id: u.id, user: u.username, name: p.displayName(u), avatar: u.avatar ? '/avatar/' + u.avatar : null, number: p.number(u),
    status: st, msg: st !== 'offline' || (viewer && viewer.id === u.id) ? (u.status_msg || '') : '',
    activity: activityFor(viewer, u, acts), lastSeen: st === 'offline' ? lastSeenFor(viewer, u) : null, admin: u.role === 'admin',
  };
}

// Alles für die Kontaktliste
function contacts(viewer) {
  const acts = activities(viewer);
  const unread = new Map(db.prepare('SELECT from_id, COUNT(*) AS n FROM private_messages WHERE to_id = ? AND read_at IS NULL AND hidden_to = 0 GROUP BY from_id')
    .all(viewer.id).map(r => [r.from_id, r.n]));
  const ids = p.friendsOf(viewer.id).map(f => f.id);
  const full = id => userById(id);
  const list = ids.map(full).filter(Boolean).map(u => ({ ...card(viewer, u, acts), unread: unread.get(u.id) || 0 }));
  // Wer mir schreibt, ohne Freund zu sein, steht auch in der Liste (Gruppe „Nicht in der Liste“), solange etwas ungelesen ist
  const others = [...unread.keys()].filter(id => !ids.includes(id)).map(full).filter(u => u && !u.disabled)
    .map(u => ({ ...card(viewer, u, acts), unread: unread.get(u.id) }));
  const order = { online: 0, away: 1, dnd: 2, offline: 3 };
  list.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name, 'de'));
  return {
    me: { ...me(userById(viewer.id)), avatar: viewer.avatar ? '/avatar/' + viewer.avatar : null },
    contacts: list, others,
    requests: p.requestsTo(viewer.id).map(r => ({ user: r.username, name: p.displayName(r), avatar: r.avatar ? '/avatar/' + r.avatar : null, note: r.note || '', at: r.asked_at })),
    sent: p.requestsFrom(viewer.id).map(r => ({ user: r.username, name: p.displayName(r) })),
    unread: p.unreadCount(viewer.id),
  };
}

// Eine Nachricht so, wie die Oberfläche sie braucht
function message(m, users) {
  let meta = null;
  try { meta = m.meta ? JSON.parse(m.meta) : null; } catch { meta = null; }
  return { id: m.id, from: users[m.from_id], to: users[m.to_id], kind: m.kind || 'text', body: m.body, meta, at: m.created_at, read: !!m.read_at };
}

// Nachricht verschicken und beiden Seiten live zeigen. Gibt die Nachricht (für den Absender) zurück.
function deliver(from, to, body, kind = 'text', meta = null) {
  const id = p.sendMessage(from.id, to.id, body, kind, meta);
  const row = db.prepare('SELECT * FROM private_messages WHERE id = ?').get(id);
  const out = message(row, { [from.id]: from.username, [to.id]: to.username });
  send(to.id, 'nachricht', { ...out, partner: from.username, name: p.displayName(from) });
  send(to.id, 'ungelesen', { n: p.unreadCount(to.id) });
  send(from.id, 'nachricht', { ...out, partner: to.username, name: p.displayName(to) });
  return out;
}
// Gelesen: dem Absender die Haken zeigen, dem Leser den Zähler
function read(reader, partner) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM private_messages WHERE to_id = ? AND from_id = ? AND read_at IS NULL').get(reader.id, partner.id).n;
  if (!n) return;
  p.markRead(reader.id, partner.id);
  send(partner.id, 'gelesen', { partner: reader.username });
  send(reader.id, 'ungelesen', { n: p.unreadCount(reader.id) });
}

// Einladungen: nur in Lobbys, in denen man gerade selbst ist
function myLobbies(user) {
  try { return require('./lobbies').collect(user).filter(l => l.ids.includes(user.id)).map(({ ids, ...l }) => l); } catch { return []; }
}
function canInvite(sender, target) {
  if (!sender || !target || sender.id === target.id || target.disabled) return false;
  return allowed(sender, target, target.invite_from);
}

module.exports = {
  STATUS, MAX_MSG, connect, setIdle, setStatus, send, connected, rawStatus, statusFor, lastSeenFor, activities, activityFor, allowed,
  card, contacts, message, deliver, read, myLobbies, canInvite, me,
};
