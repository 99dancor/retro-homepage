'use strict';
// Paint-Lobbys (Datei → Lobby in Paint): mehrere Mitglieder malen am selben Bild. Wie die Musik-Lobbys und
// Blackjack-Tische leben sie nur im Arbeitsspeicher und schicken Änderungen per Server-Sent Events.
//
// Der Server hat das Bild selbst. Jede Änderung kommt als „Stück“: nur die Pixel, die sich geändert haben, als PNG
// (alle anderen durchsichtig). Befehle für das ganze Bild (Drehen, Größe …) kommen als Befehl und werden mit
// public/paint-core.js ausgeführt, damit gleichzeitig Gemaltes mitgedreht wird. Der Server gibt jeder Änderung eine
// laufende Nummer und schickt sie in dieser Reihenfolge an alle. Weil jeder Browser dieselben Stücke in derselben
// Reihenfolge aufträgt, sehen alle exakt dasselbe Bild.
//
// Rückgängig nimmt nur eigene Änderungen zurück, und nur, solange niemand anderes über dieselben Pixel gemalt hat.
// Jede Minute sichert die Lobby das Bild als Entwurf beim Ersteller (Tabelle artworks mit draft = 1).
const crypto = require('node:crypto');
const P = require('../public/paint-core');
const png = require('./png');
const paint = require('./paint');
const { db, now } = require('./db');

const MAX_LOBBIES = 12;
const MAX_PEOPLE = 16;
const EMPTY_MS = 10 * 60 * 1000;     // leere Lobbys verschwinden nach 10 Minuten
const DRAFT_MS = 60 * 1000;          // Entwurf höchstens einmal pro Minute
const UNDO_STEPS = 10;               // eigene Schritte pro Person
const HISTORY_OPS = 400;
const HISTORY_BYTES = 48 * 1024 * 1024;
const CHAT_KEEP = 50;

const lobbies = new Map();
const get = id => lobbies.get(String(id)) || null;
const isHost = (l, user) => !!user && (user.isAdmin || user.id === l.hostId);
const canPaint = (l, user) => !!user && (isHost(l, user) || l.everyone || l.allowed.has(user.id));
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const who = u => ({ id: u.id, name: u.name || u.display_name || u.username, user: u.username });

// ---------- Lobbys ----------
function create(user, opts, image) {
  if (lobbies.size >= MAX_LOBBIES) cleanup(true);
  if (lobbies.size >= MAX_LOBBIES) return null;
  const l = {
    id: crypto.randomBytes(5).toString('hex'), name: `Lobby von ${user.name}`, hidden: false, everyone: true, chatOn: true,
    owner: user, hostId: user.id, hostName: user.name, img: image, seq: 0,
    history: [], histBytes: 0, undo: new Map(), redo: new Map(), allowed: new Set(), painted: new Map(),
    clients: new Set(), chat: [], emptySince: Date.now(), created: Date.now(),
    draftId: null, draftSeq: 0, draftAt: 0, savedSeq: -1, saved: new Map(), snap: null,
  };
  settings(l, opts || {});
  lobbies.set(l.id, l);
  return l;
}
function settings(l, b) {
  if (typeof b.name === 'string' && b.name.trim()) l.name = str(b.name, 60);
  if ('hidden' in b) l.hidden = !!b.hidden;
  if ('everyone' in b) l.everyone = !!b.everyone;
  if ('chat' in b) l.chatOn = !!b.chat;
}
function online(l) {
  const users = new Map();
  for (const c of l.clients) users.set(c.user.id, c.user);
  return [...users.values()];
}
function people(l) {
  return online(l).map(u => ({ ...who(u), host: u.id === l.hostId, paint: canPaint(l, u), strokes: (l.painted.get(u.id) || {}).strokes || 0 }))
    .sort((a, b) => b.host - a.host || b.paint - a.paint || a.name.localeCompare(b.name, 'de'));
}
function state(l) {
  return {
    id: l.id, name: l.name, hidden: l.hidden, everyone: l.everyone, chat: l.chatOn, hostId: l.hostId, host: l.hostName,
    ownerId: l.owner.id, w: l.img.w, h: l.img.h, seq: l.seq, people: people(l),
    painted: [...l.painted.values()].filter(p => p.strokes > 0).sort((a, b) => b.strokes - a.strokes),
  };
}
function summary(l) {
  return { id: l.id, name: l.name, host: l.hostName, hidden: l.hidden, people: online(l).length, w: l.img.w, h: l.img.h, everyone: l.everyone };
}
function list(user) {
  return [...lobbies.values()].filter(l => !l.hidden || isHost(l, user) || l.owner.id === user.id || online(l).some(u => u.id === user.id))
    .map(summary).sort((a, b) => b.people - a.people || a.name.localeCompare(b.name, 'de'));
}

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(l, event, data, except) { for (const c of l.clients) if (c.sid !== except) send(c.res, event, data); }
function pushState(l) { const s = state(l); for (const c of l.clients) send(c.res, 'state', s); }

function join(l, user, res) {
  const c = { user, res, sid: crypto.randomBytes(8).toString('hex') };
  l.clients.add(c);
  l.emptySince = 0;
  send(res, 'hello', { sid: c.sid, me: user.id, state: state(l), chat: l.chatOn ? l.chat : [] });
  pushState(l);
  const ping = setInterval(() => send(res, 'ping', { now: Date.now() }), 20000).unref();
  return () => {
    clearInterval(ping);
    l.clients.delete(c);
    if (!lobbies.has(l.id)) return;
    if (!l.clients.size) l.emptySince = Date.now();
    // Der Gastgeber ist weg: wer noch da ist, übernimmt
    const here = online(l);
    if (here.length && !here.some(u => u.id === l.hostId)) { l.hostId = here[0].id; l.hostName = here[0].name; }
    broadcast(l, 'cursor', { by: user.id, gone: true });
    pushState(l);
  };
}
const full = l => online(l).length >= MAX_PEOPLE;

// ---------- Änderungen ----------
const bmpBytes = b => (b ? b.d.length : 0);
function record(l, e) {
  e.seq = ++l.seq;
  e.bytes = bmpBytes(e.patch) + bmpBytes(e.before);
  l.history.push(e);
  l.histBytes += e.bytes;
  while (l.history.length > HISTORY_OPS || (l.histBytes > HISTORY_BYTES && l.history.length > 1)) {
    const old = l.history.shift();
    l.histBytes -= old.bytes;
    for (const m of [l.undo, l.redo]) for (const [k, list] of m) m.set(k, list.filter(x => (x.e || x) !== old));
  }
  l.snap = null;
  return e;
}
function count(l, user) {
  const p = l.painted.get(user.id) || { ...who(user), strokes: 0 };
  p.strokes++;
  l.painted.set(user.id, p);
}
function remember(l, user, e) {
  const list = (l.undo.get(user.id) || []).concat(e);
  l.undo.set(user.id, list.slice(-UNDO_STEPS));
}
// Durchsichtig oder deckend, nichts dazwischen
function hardAlpha(b) { for (let i = 3; i < b.d.length; i += 4) b.d[i] = b.d[i] >= 128 ? 255 : 0; return b; }

// Ein Stück auftragen. Gibt den Eintrag zurück (ohne ihn zu senden) oder einen Fehlertext.
function applyPatch(l, by, x, y, patch) {
  hardAlpha(patch);
  const r = P.clip({ x0: x, y0: y, x1: x + patch.w - 1, y1: y + patch.h - 1 }, l.img);
  if (!r) return 'Das Stück liegt außerhalb des Bildes.';
  const part = r.x === x && r.y === y && r.w === patch.w && r.h === patch.h ? patch : P.crop(patch, r.x - x, r.y - y, r.w, r.h);
  const before = P.crop(l.img, r.x, r.y, r.w, r.h);
  P.blit(l.img, part, r.x, r.y);
  return record(l, { by, kind: 'patch', x: r.x, y: r.y, patch: part, before });
}
function applyCmd(l, by, cmd) {
  const m = paint.maxSize(), before = P.clone(l.img), out = P.run(l.img, cmd, m.w, m.h);
  if (!out) return 'Unbekannter Befehl.';
  l.img = out;
  return record(l, { by, kind: 'cmd', cmd, before });
}
function applyPut(l, by, image) {
  const before = l.img;
  for (let i = 3; i < image.d.length; i += 4) if (image.d[i] < 128) { image.d[i - 3] = image.d[i - 2] = image.d[i - 1] = 255; image.d[i] = 255; } else image.d[i] = 255;
  l.img = image;
  return record(l, { by, kind: 'put', patch: P.clone(image), before });
}
// Nachricht für alle: Stücke und ganze Bilder als PNG, Befehle als Befehl
function message(l, e, cid) {
  const m = { seq: e.seq, by: e.by, cid: cid || null, kind: e.kind, w: l.img.w, h: l.img.h };
  if (e.kind === 'patch') { m.x = e.x; m.y = e.y; m.data = png.encode(e.patch).toString('base64'); }
  else if (e.kind === 'put') m.data = png.encode(e.patch).toString('base64');
  else m.cmd = e.cmd;
  return m;
}
// Wer die Änderung geschickt hat, kennt sie schon und bekommt nur die Bestätigung
function publish(l, e, sid, cid, toSender) {
  let msg = null;
  for (const c of l.clients) {
    if (c.sid === sid && !toSender) send(c.res, 'ack', { seq: e.seq, cid, w: l.img.w, h: l.img.h });
    else send(c.res, 'op', msg || (msg = message(l, e, cid)));
  }
}

// Eine Änderung aus dem Browser: { cid, x, y, data } (Stück), { cid, cmd } oder { cid, put: data }
function op(l, user, b, sid) {
  if (!canPaint(l, user)) return { error: 'Du darfst in dieser Lobby gerade nur zusehen.' };
  const m = paint.maxSize();
  let e;
  if (b.cmd) e = applyCmd(l, user.id, b.cmd);
  else {
    const raw = typeof b.data === 'string' || typeof b.put === 'string' ? Buffer.from(b.data || b.put, 'base64') : null;
    const bmp = raw && png.decode(raw, b.put ? m.w * m.h : l.img.w * l.img.h);
    if (!bmp) return { error: 'Die Änderung ließ sich nicht lesen.' };
    if (b.put) {
      if (bmp.w > m.w || bmp.h > m.h) return { error: `Das Bild ist zu groß (höchstens ${m.w} × ${m.h} Pixel).` };
      e = applyPut(l, user.id, bmp);
    } else e = applyPatch(l, user.id, Math.floor(Number(b.x)) || 0, Math.floor(Number(b.y)) || 0, bmp);
  }
  if (typeof e === 'string') return { error: e };
  count(l, user);
  remember(l, user, e);
  l.redo.delete(user.id);
  publish(l, e, sid, str(b.cid, 40));
  return { seq: e.seq };
}

// Überschneiden sich zwei Änderungen? Ganze Bilder überschneiden sich mit allem, Stücke Pixel für Pixel.
function overlaps(a, b) {
  if (a.kind !== 'patch' || b.kind !== 'patch') return true;
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.patch.w, b.x + b.patch.w), y1 = Math.min(a.y + a.patch.h, b.y + b.patch.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (a.patch.d[((y - a.y) * a.patch.w + (x - a.x)) * 4 + 3] && b.patch.d[((y - b.y) * b.patch.w + (x - b.x)) * 4 + 3]) return true;
  }
  return false;
}
function blockedSince(l, user, e, seq) {
  if (!l.history.length || l.history[0].seq > seq) return 'Das ist zu lange her, um es noch rückgängig zu machen.';
  for (const h of l.history) if (h.seq > seq && h.by !== user.id && overlaps(e, h)) return 'Jemand anderes hat inzwischen darüber gemalt. Rückgängig geht hier nicht mehr, sonst wäre dessen Arbeit mit weg.';
  return null;
}
function undo(l, user, sid, cid) {
  const list = l.undo.get(user.id) || [], e = list[list.length - 1];
  if (!e) return { error: 'Es gibt nichts mehr, das du rückgängig machen kannst.' };
  const block = blockedSince(l, user, e, e.seq);
  if (block) return { error: block };
  let r;
  if (e.kind === 'patch') {
    const back = P.clone(e.before);
    for (let i = 3; i < back.d.length; i += 4) if (!e.patch.d[i]) back.d[i] = 0;
    r = applyPatch(l, user.id, e.x, e.y, back);
  } else r = applyPut(l, user.id, P.clone(e.before));
  if (typeof r === 'string') return { error: r };
  list.pop();
  l.redo.set(user.id, (l.redo.get(user.id) || []).concat({ e, at: r.seq }).slice(-UNDO_STEPS));
  publish(l, r, sid, cid, true);
  return { seq: r.seq };
}
function redo(l, user, sid, cid) {
  const list = l.redo.get(user.id) || [], top = list[list.length - 1];
  if (!top) return { error: 'Es gibt nichts zum Wiederholen.' };
  const block = blockedSince(l, user, top.e, top.at);
  if (block) return { error: block.replace('Rückgängig', 'Wiederholen') };
  const e = top.e;
  const r = e.kind === 'patch' ? applyPatch(l, user.id, e.x, e.y, P.clone(e.patch)) : e.kind === 'cmd' ? applyCmd(l, user.id, e.cmd) : applyPut(l, user.id, P.clone(e.patch));
  if (typeof r === 'string') return { error: r };
  list.pop();
  remember(l, user, r);
  publish(l, r, sid, cid, true);
  return { seq: r.seq };
}

// ---------- Zeiger, Unterhaltung, Rechte ----------
function cursor(l, user, sid, b) {
  const x = Math.round(Number(b.x)), y = Math.round(Number(b.y));
  const pv = b.pv && typeof b.pv === 'object' && JSON.stringify(b.pv).length <= 6000 ? b.pv : null;
  broadcast(l, 'cursor', { by: user.id, name: user.name, x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null, pv: canPaint(l, user) ? pv : null }, sid);
}
function chat(l, user, text) {
  if (!l.chatOn) return 'Die Unterhaltung ist in dieser Lobby ausgeschaltet.';
  text = str(text, 300);
  if (!text) return 'Schreib erst etwas.';
  const msg = { ...who(user), text, at: Date.now() };
  l.chat.push(msg);
  if (l.chat.length > CHAT_KEEP) l.chat.shift();
  broadcast(l, 'chat', msg);
  return null;
}
function control(l, user, b) {
  if (!isHost(l, user)) return 'Das darf nur der Gastgeber.';
  if (b.action === 'settings') {
    const wasChat = l.chatOn;
    settings(l, b);
    if (wasChat && !l.chatOn) l.chat = [];
  } else if (b.action === 'rights') {
    const id = Number(b.user);
    if (b.allow) l.allowed.add(id); else l.allowed.delete(id);
  } else return 'Unbekannte Aktion.';
  pushState(l);
  return null;
}

// ---------- Speichern ----------
function storeImage(b) {
  const image = png.encode(b), th = png.encode(png.thumb(b));
  return { name: paint.store(image, th), size: image.length + th.length };
}
// Mitmaler: alle, die etwas geändert haben, außer dem Besitzer selbst (bei explizitem Speichern die ausgewählten)
function paintersFor(l, ownerId, ids) {
  const pick = ids ? new Set(ids.map(Number)) : null;
  const known = new Map([...l.painted.values()].map(p => [p.id, p]));
  for (const u of online(l)) if (!known.has(u.id)) known.set(u.id, { ...who(u), strokes: 0 });
  return [...known.values()].filter(p => p.id !== ownerId && (pick ? pick.has(p.id) : p.strokes > 0));
}
function quotaOk(user, oldSize, size) {
  return user.isAdmin || paint.usedBytes(user.id) - oldSize + size <= paint.quotaBytes();
}
// Entwurf beim Ersteller sichern, wenn sich seit dem letzten etwas geändert hat
function saveDraft(l) {
  if (l.seq === l.draftSeq || l.seq === l.savedSeq) return;
  const owner = l.owner;
  if (!paint.canSave(owner) || !db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(owner.id)) return;
  const old = l.draftId && db.prepare('SELECT * FROM artworks WHERE id = ? AND owner_id = ? AND draft = 1').get(l.draftId, owner.id);
  const enc = png.encode(l.img), th = png.encode(png.thumb(l.img)), size = enc.length + th.length;
  if (!quotaOk(owner, old ? old.size : 0, size)) return;
  const name = paint.store(enc, th), t = now();
  if (old) {
    db.prepare('UPDATE artworks SET title = ?, width = ?, height = ?, stored_name = ?, size = ?, updated_at = ? WHERE id = ?').run(l.name, l.img.w, l.img.h, name, size, t, old.id);
    paint.removeFiles(old.stored_name);
  } else {
    l.draftId = Number(db.prepare(`INSERT INTO artworks(owner_id, title, width, height, stored_name, size, visibility, approved, draft, created_at, updated_at)
                                   VALUES (?, ?, ?, ?, ?, ?, 'private', 1, 1, ?, ?)`).run(owner.id, l.name, l.img.w, l.img.h, name, size, t, t).lastInsertRowid);
  }
  paint.setPainters(l.draftId, paintersFor(l, owner.id));
  l.draftSeq = l.seq;
  l.draftAt = Date.now();
}
function dropDraft(l) {
  const d = l.draftId && db.prepare('SELECT * FROM artworks WHERE id = ? AND draft = 1').get(l.draftId);
  if (d) { db.prepare('DELETE FROM artworks WHERE id = ?').run(d.id); paint.removeFiles(d.stored_name); }
  l.draftId = null;
}
// Datei → Speichern in der Lobby: der Stand auf dem Server wird ein Bild des Speichernden
function save(l, user, b) {
  if (!paint.canSave(user)) return { error: 'Speichern ist für dein Konto nicht freigeschaltet.' };
  const vis = paint.VIS.includes(b.visibility) ? b.visibility : 'private';
  const title = str(b.title, 80) || l.name;
  const prevId = b.asNew ? null : l.saved.get(user.id);
  const old = prevId && db.prepare('SELECT * FROM artworks WHERE id = ? AND owner_id = ? AND draft = 0').get(prevId, user.id);
  const enc = png.encode(l.img), th = png.encode(png.thumb(l.img)), size = enc.length + th.length;
  if (!quotaOk(user, old ? old.size : 0, size)) return { error: `Dein Speicher für Bilder ist voll (${Math.round(paint.quotaBytes() / 1048576)} MB). Lösche alte Bilder unter Datei → Öffnen.`, status: 413 };
  const name = paint.store(enc, th), t = now();
  let id;
  if (old) {
    db.prepare('UPDATE artworks SET title = ?, width = ?, height = ?, stored_name = ?, size = ?, visibility = ?, approved = ?, updated_at = ? WHERE id = ?')
      .run(title, l.img.w, l.img.h, name, size, vis, paint.needsApproval(user, vis) ? 0 : 1, t, old.id);
    paint.removeFiles(old.stored_name);
    id = old.id;
  } else {
    id = Number(db.prepare(`INSERT INTO artworks(owner_id, title, width, height, stored_name, size, visibility, approved, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, title, l.img.w, l.img.h, name, size, vis, paint.needsApproval(user, vis) ? 0 : 1, t, t).lastInsertRowid);
  }
  paint.setPainters(id, paintersFor(l, user.id, Array.isArray(b.painters) ? b.painters : null));
  l.saved.set(user.id, id);
  // Der Ersteller hat gespeichert: der Entwurf ist überholt
  if (user.id === l.owner.id) { dropDraft(l); l.savedSeq = l.seq; l.draftSeq = l.seq; }
  return { id };
}

// Bild als PNG für alle, die neu dazukommen (zwischengespeichert, bis sich etwas ändert)
function snapshot(l) {
  if (!l.snap || l.snap.seq !== l.seq) l.snap = { seq: l.seq, buf: png.encode(l.img) };
  return l.snap;
}

function remove(l) {
  try { saveDraft(l); } catch (e) { console.error('Paint-Entwurf:', e.message); }
  for (const c of l.clients) { send(c.res, 'closed', {}); c.res.end(); }
  lobbies.delete(l.id);
}
function cleanup(force = false) {
  const t = Date.now();
  for (const l of lobbies.values()) {
    if (!l.clients.size && (force || t - l.emptySince > EMPTY_MS)) { remove(l); continue; }
    if (t - l.draftAt > DRAFT_MS) { try { saveDraft(l); } catch (e) { console.error('Paint-Entwurf:', e.message); } }
  }
}
setInterval(cleanup, 15e3).unref();

module.exports = {
  create, get, list, state, join, full, op, undo, redo, cursor, chat, control, save, saveDraft, snapshot, remove, cleanup,
  isHost, canPaint, MAX_PEOPLE, _lobbies: lobbies,
};
