'use strict';
// Internetradio im Mediaplayer: Sender sind nur ein Name und eine Stream-Adresse (Tabelle radio_stations). Abgespielt wird
// über den Server (GET /musik/radio/:id/stream): So klappt es auch mit http-Streams auf einer https-Seite, der Equalizer
// und die Visualisierung bekommen den Ton (gleicher Ursprung), und der Radiosender sieht nur den Server, nicht die Hörer.
// Playlist-Dateien (.pls, .m3u, .m3u8 mit einfachen Einträgen) löst der Server beim Hinzufügen auf.
const dns = require('node:dns').promises;
const net = require('node:net');
const { Readable } = require('node:stream');
const { db, now } = require('./db');

const VIS = ['public', 'members', 'private'];
const MAX_PER_USER = 100;
const UA = 'Mozilla/5.0 (compatible; RetroHomepage-Radio)';

// Mitglieder dürfen keine Adressen im eigenen Netz eintragen (sonst ginge der Server für sie ins Heimnetz); der Admin schon,
// etwa für einen eigenen Icecast auf dem Unraid.
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
async function checkUrl(raw, admin) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Das ist keine gültige Adresse.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Nur http- und https-Adressen gehen.');
  if (u.username || u.password) throw new Error('Adressen mit Benutzername und Kennwort gehen nicht.');
  if (!admin) {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new Error('Den Server hinter dieser Adresse gibt es nicht.'); })).map(a => a.address);
    if (!ips.length || ips.some(privateIp)) throw new Error('Adressen im eigenen Netz kann nur der Admin eintragen.');
  }
  return u.href;
}

// Erste Stream-Adresse aus einer Playlist-Datei
function fromPlaylist(text) {
  const pls = text.match(/^\s*File\d+\s*=\s*(https?:\/\/\S+)/im);
  if (pls) return pls[1];
  const line = text.split(/\r?\n/).map(l => l.trim()).find(l => /^https?:\/\//i.test(l));
  return line || null;
}
const PLAYLIST = /\.(pls|m3u8?)(\?|$)/i;
const PLAYLIST_TYPE = /mpegurl|scpls|x-scpls|audio\/x-pn|text\/plain/i;
// Prüft die Adresse und löst Playlists auf. Ergebnis: { url, page }
async function resolve(raw, admin) {
  const url = await checkUrl(raw, admin);
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, 'Icy-MetaData': '0' }, redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok) throw new Error(`Der Sender antwortet nicht richtig (${r.status}).`);
    if (PLAYLIST.test(url) || PLAYLIST_TYPE.test(type)) {
      // Nur den Anfang lesen: Playlists sind klein, ein Stream liefe endlos
      const reader = r.body.getReader();
      let text = '', n = 0;
      while (n < 65536) { const { done, value } = await reader.read(); if (done) break; n += value.length; text += Buffer.from(value).toString('utf8'); }
      reader.cancel().catch(() => {});
      const inner = fromPlaylist(text);
      if (!inner) throw new Error('In dieser Playlist steht keine Stream-Adresse.');
      if (/\.m3u8(\?|$)/i.test(inner) || /#EXT-X-/i.test(text)) throw new Error('HLS-Streams (.m3u8 mit Abschnitten) gehen leider nicht. Nimm die MP3- oder AAC-Adresse des Senders.');
      return { url: await checkUrl(inner, admin), page: url };
    }
    r.body && r.body.cancel().catch(() => {});
    if (!/^(audio|application\/ogg|video\/ogg|application\/octet-stream)/i.test(type) && type) throw new Error('Unter dieser Adresse kommt kein Ton, sondern „' + type.split(';')[0] + '“. Nimm die Stream-Adresse (oft endet sie auf .mp3, .aac, .pls oder .m3u).');
    return { url, page: null };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Der Sender antwortet nicht.');
    if (e instanceof TypeError) throw new Error('Der Sender ist nicht erreichbar.');
    throw e;
  } finally { clearTimeout(timer); }
}

function visibleSql(user) {
  if (user && user.isAdmin) return { sql: '1=1', params: [] };
  if (!user) return { sql: "r.visibility = 'public'", params: [] };
  return { sql: "(r.visibility IN ('public','members') OR r.owner_id = ?)", params: [user.id] };
}
function canSee(user, s) {
  return !!s && (s.visibility === 'public' || (!!user && (user.isAdmin || s.visibility === 'members' || s.owner_id === user.id)));
}
function row(s, user) {
  return {
    id: s.id, name: s.name, host: (() => { try { return new URL(s.page || s.url).host; } catch { return ''; } })(), visibility: s.visibility,
    by: s.username ? s.display_name || s.username : null, byUser: s.username || null, plays: s.plays,
    canEdit: !!user && (user.isAdmin || s.owner_id === user.id),
  };
}
function list(user) {
  const v = visibleSql(user);
  return db.prepare(`SELECT r.*, u.username, u.display_name FROM radio_stations r LEFT JOIN users u ON u.id = r.owner_id
                     WHERE ${v.sql} ORDER BY r.name COLLATE NOCASE`).all(...v.params).map(s => row(s, user));
}
function get(id) { return db.prepare('SELECT * FROM radio_stations WHERE id = ?').get(Number(id)); }

async function add(user, b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Gib dem Sender einen Namen.');
  if (!user.isAdmin && db.prepare('SELECT COUNT(*) AS n FROM radio_stations WHERE owner_id = ?').get(user.id).n >= MAX_PER_USER) throw new Error(`Du hast schon ${MAX_PER_USER} Sender.`);
  const { url, page } = await resolve(b.url, user.isAdmin);
  const vis = VIS.includes(b.visibility) ? b.visibility : user.isAdmin ? 'public' : 'members';
  return Number(db.prepare('INSERT INTO radio_stations(name, url, page, visibility, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, url, page, vis, user.id, now()).lastInsertRowid);
}
async function update(user, s, b) {
  const name = String(b.name || '').trim().slice(0, 80) || s.name;
  const vis = VIS.includes(b.visibility) ? b.visibility : s.visibility;
  let url = s.url, page = s.page;
  const typed = String(b.url || '').trim();
  if (typed && typed !== (s.page || s.url)) ({ url, page } = await resolve(typed, user.isAdmin));
  db.prepare('UPDATE radio_stations SET name = ?, url = ?, page = ?, visibility = ? WHERE id = ?').run(name, url, page, vis, s.id);
}
function remove(s) { db.prepare('DELETE FROM radio_stations WHERE id = ?').run(s.id); }

// Ton durchreichen. Range-Anfragen des Browsers beantwortet ein Livestream ohnehin von vorn.
async function stream(s, req, res) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let r;
  try {
    r = await fetch(s.url, { signal: ac.signal, headers: { 'User-Agent': UA, 'Icy-MetaData': '0' }, redirect: 'follow' });
  } catch { if (!res.headersSent) res.status(502).end(); return; }
  if (!r.ok || !r.body) { r.body && r.body.cancel().catch(() => {}); res.status(502).end(); return; }
  db.prepare('UPDATE radio_stations SET plays = plays + 1 WHERE id = ?').run(s.id);
  res.status(200).set({
    'Content-Type': (r.headers.get('content-type') || 'audio/mpeg').split(';')[0],
    'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'", 'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const body = Readable.fromWeb(r.body);
  body.on('error', () => res.end());
  body.pipe(res);
}

module.exports = { list, get, add, update, remove, canSee, stream, fromPlaylist, privateIp, VIS };
