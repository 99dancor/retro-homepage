'use strict';
// Mediaplayer (Startmenü → 🎵 Musik): Musik, Videos und YouTube-Links, Playlists, Hochladen für Mitglieder und Lobbys zum gemeinsamen Hören.
// Die Seite holt sich ihre Daten als JSON; Schreiben geht per POST mit dem Formular-Token im Kopf x-csrf-token.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { db, now, getSetting, tx } = require('../db');
const auth = require('../auth');
const music = require('../music');
const lobby = require('../lobby');
const youtube = require('../youtube');

const router = express.Router();
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
// Mitglieder wählen zwischen öffentlich, angemeldet, nur Freunde und privat; Gruppen vergibt der Admin in der Systemsteuerung
const OWN_VIS = ['public', 'members', 'friends', 'private'];
const ownVis = (v, fallback) => (OWN_VIS.includes(v) ? v : fallback);
const lobbyOn = () => getSetting('lobby_enabled', '1') === '1';
const youtubeOn = () => getSetting('youtube_enabled', '1') === '1';

router.use(express.json({ limit: '100kb' }));
router.use((req, res, next) => { if (req.path !== '/') res.set('Cache-Control', 'no-store'); next(); });
const fail = (res, status, error) => res.status(status).json({ error });
function needLogin(req, res, next) { return req.user ? next() : fail(res, 401, 'Bitte melde dich an.'); }

// ---------- Player ----------
router.get('/', (req, res) => {
  // blob: für das Messen der Länge vor dem Hochladen. Nur diese Seite darf den YouTube-Player einbetten,
  // und das erst nach einem Klick (siehe public/music.js).
  const extra = "media-src 'self' blob:;" + (youtubeOn() ? " frame-src 'self' https://www.youtube-nocookie.com;" : '');
  res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("default-src 'self';", "default-src 'self'; " + extra));
  res.render('music', {
    title: 'Mediaplayer',
    canUploadMusic: music.canUpload(req.user),
    lobbyOn: lobbyOn(), youtubeOn: youtubeOn(),
  });
});

function trackRow(t, user) {
  return {
    id: t.id, kind: t.kind || 'audio', videoId: t.kind === 'youtube' ? t.youtube_id : undefined,
    title: t.title, artist: t.artist || '', album: t.album || '', duration: t.duration || 0, plays: t.plays,
    visibility: t.visibility, by: t.username ? t.display_name || t.username : null, byUser: t.username || null, byAdmin: t.role === 'admin',
    mine: !!user && t.uploader_id === user.id,
    canEdit: !!user && (user.isAdmin || t.uploader_id === user.id),
    // In Lobbys hören nur angemeldete Mitglieder: dafür muss der Titel für alle Mitglieder sichtbar sein
    shareable: t.visibility === 'public' || t.visibility === 'members',
  };
}

router.get('/bibliothek', (req, res) => {
  const u = req.user;
  const tv = auth.visibilitySql(u, 'track', 't');
  const tracks = db.prepare(`SELECT t.*, us.username, us.display_name, us.role FROM tracks t LEFT JOIN users us ON us.id = t.uploader_id
                             WHERE ${tv.sql} ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE`).all(...tv.params)
    // Gespeicherte YouTube-Links verschwinden, solange YouTube in der Systemsteuerung aus ist
    .filter(t => t.kind !== 'youtube' || youtubeOn()).map(t => trackRow(t, u));
  const visible = new Set(tracks.map(t => t.id));
  let playlists = [];
  if (u) {
    const pv = auth.visibilitySql(u, 'playlist', 'p');
    playlists = db.prepare(`SELECT p.*, us.username, us.display_name FROM playlists p JOIN users us ON us.id = p.user_id WHERE ${pv.sql}
                            ORDER BY p.user_id != ?, p.title COLLATE NOCASE`).all(...pv.params, u.id).map(p => ({
      id: p.id, title: p.title, visibility: p.visibility, owner: p.display_name || p.username, ownerUser: p.username, mine: p.user_id === u.id,
      tracks: db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(p.id).map(r => r.track_id).filter(id => visible.has(id)),
    }));
  }
  const canUpload = music.canUpload(u);
  res.json({
    me: u ? { id: u.id, name: u.name, admin: u.isAdmin } : null,
    canUpload,
    quota: canUpload && !u.isAdmin ? { used: music.usedBytes(u.id), total: music.quotaBytes(), fileMb: music.MEMBER_FILE_MB } : null,
    tracks, playlists,
  });
});

// Abspielen: Spulen klappt über Range-Anfragen, die sendFile beherrscht
router.get('/stream/:id', (req, res, next) => {
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(req.params.id));
  if (!t || !t.stored_name || !auth.canSee(req.user, 'track', t)) return res.status(404).end();
  res.sendFile(path.join(music.MUSIC_DIR, t.stored_name), {
    headers: { 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'private, max-age=86400' },
  }, err => err && !res.headersSent && res.status(404).end());
});

// Nach 30 Sekunden oder am Ende zählt ein Titel als gehört (nur die Zahl, ohne Konto)
// Titel aus der Systemsteuerung kennen ihre Länge noch nicht: die misst der Browser beim Abspielen
router.post('/titel/:id/gespielt', auth.rateLimit('plays', 120, 600), (req, res) => {
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(req.params.id));
  const d = Number((req.body || {}).duration);
  if (t && auth.canSee(req.user, 'track', t)) {
    db.prepare('UPDATE tracks SET plays = plays + 1, duration = COALESCE(duration, ?) WHERE id = ?').run(d > 0 && d < 24 * 3600 ? Math.round(d * 10) / 10 : null, t.id);
  }
  res.json({ ok: true });
});

// ---------- Hochladen ----------
function pickUpload(req, res, next) {
  if (!music.canUpload(req.user)) return fail(res, 403, 'Du darfst keine Musik hochladen.');
  return (req.user.isAdmin ? music.adminUpload : music.memberUpload).single('file')(req, res, err => {
    if (err) return fail(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist zu groß (höchstens ${music.MEMBER_FILE_MB} MB).` : 'Hochladen fehlgeschlagen.');
    next();
  });
}
router.post('/hochladen', needLogin, pickUpload, auth.csrfCheck, (req, res) => {
  const f = req.file;
  if (!f) return fail(res, 400, 'Das ist keine Musik- oder Videodatei (MP3, OGG, WAV, FLAC, M4A, MP4, WebM …).');
  const u = req.user;
  if (!u.isAdmin && music.usedBytes(u.id) + f.size > music.quotaBytes()) {
    fs.rm(f.path, { force: true }, () => {});
    return fail(res, 413, `Dein Speicher für Musik und Videos ist voll (${getSetting('music_quota_mb', '500')} MB). Lösche alte Titel, um Platz zu schaffen.`);
  }
  const kind = music.kindOf(f);
  const tags = kind === 'audio' ? music.readTags(f.path) : {}, guess = music.fromFilename(f.originalname);
  const b = req.body || {};
  const duration = Number(b.duration) > 0 && Number(b.duration) < 24 * 3600 ? Math.round(Number(b.duration) * 10) / 10 : null;
  const id = Number(db.prepare(`INSERT INTO tracks(title, artist, album, duration, original_name, stored_name, size, mime, visibility, uploader_id, created_at, kind)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    str(b.title) || tags.title || guess.title || f.originalname, str(b.artist) || tags.artist || guess.artist || null, tags.album || null,
    duration, f.originalname, f.filename, f.size, f.mimetype, ownVis(b.visibility, u.isAdmin ? 'public' : 'members'), u.id, now(), kind).lastInsertRowid);
  res.json({ track: trackRow(oneTrack(id), u) });
});
const oneTrack = id => db.prepare('SELECT t.*, us.username, us.display_name, us.role FROM tracks t LEFT JOIN users us ON us.id = t.uploader_id WHERE t.id = ?').get(id);

// YouTube-Links: Titel über oEmbed holen und, mit Konto, als Einträge in der Bibliothek speichern (ohne Datei).
// Ohne Konto oder mit save: false kommen nur die Angaben zurück, abgespielt wird dann nur im eigenen Browser.
router.post('/youtube', auth.rateLimit('ytlinks', 60, 600), async (req, res) => {
  if (!youtubeOn()) return fail(res, 404, 'YouTube ist ausgeschaltet.');
  const b = req.body || {}, u = req.user;
  const items = await youtube.items(Array.isArray(b.ids) ? b.ids : []);
  if (!items.length) return fail(res, 400, 'Das sieht nicht nach einem YouTube-Link aus.');
  if (!u || b.save === false) return res.json({ items });
  const vis = ownVis(b.visibility, 'members');
  const tracks = tx(() => items.map(it => {
    // Hat man das Video schon gespeichert, bleibt es bei dem einen Eintrag
    const had = db.prepare("SELECT id FROM tracks WHERE kind = 'youtube' AND youtube_id = ? AND uploader_id = ?").get(it.videoId, u.id);
    if (had) return had.id;
    return Number(db.prepare(`INSERT INTO tracks(title, artist, original_name, stored_name, size, visibility, uploader_id, created_at, kind, youtube_id)
                              VALUES (?, ?, ?, '', 0, ?, ?, ?, 'youtube', ?)`).run(it.title, it.artist || null, 'youtube:' + it.videoId, vis, u.id, now(), it.videoId).lastInsertRowid);
  }));
  res.json({ tracks: tracks.map(id => trackRow(oneTrack(id), u)) });
});

function ownTrack(req, res, next) {
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(Number(req.params.id));
  if (!t || !req.user || !(req.user.isAdmin || t.uploader_id === req.user.id)) return fail(res, 404, 'Diesen Titel gibt es nicht.');
  req.track = t;
  next();
}
router.post('/titel/:id', needLogin, ownTrack, (req, res) => {
  const t = req.track, b = req.body || {};
  // Mit Gruppen-Freigabe aus der Systemsteuerung bleibt die Sichtbarkeit, solange hier nichts anderes gewählt wird
  const vis = b.visibility === t.visibility ? t.visibility : ownVis(b.visibility, t.visibility);
  db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ?, visibility = ? WHERE id = ?')
    .run(str(b.title) || t.title, str(b.artist) || null, str(b.album) || null, vis, t.id);
  if (vis !== 'groups') auth.setAcl('track', t.id, []);
  res.json({ ok: true });
});
router.post('/titel/:id/loeschen', needLogin, ownTrack, (req, res) => {
  deleteTrack(req.track);
  res.json({ ok: true });
});
function deleteTrack(t) {
  if (t.stored_name) fs.rm(path.join(music.MUSIC_DIR, t.stored_name), { force: true }, () => {});
  tx(() => {
    db.prepare('DELETE FROM tracks WHERE id = ?').run(t.id);
    db.prepare("DELETE FROM acl WHERE item_type = 'track' AND item_id = ?").run(t.id);
  });
}

// ---------- Playlists ----------
router.post('/playlists', needLogin, (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 100);
  if (!title) return fail(res, 400, 'Gib der Playlist einen Namen.');
  if (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(req.user.id).n >= 200) return fail(res, 409, 'Du hast schon 200 Playlists.');
  const id = Number(db.prepare('INSERT INTO playlists(user_id, title, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, title, ownVis(b.visibility, 'private'), now(), now()).lastInsertRowid);
  if (Array.isArray(b.tracks)) setTracks(id, b.tracks, req.user);
  res.json({ id });
});
function ownPlaylist(req, res, next) {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(req.params.id));
  if (!p || !(req.user.isAdmin || p.user_id === req.user.id)) return fail(res, 404, 'Diese Playlist gibt es nicht.');
  req.playlist = p;
  next();
}
// Nur Titel, die der Besitzer sehen darf
function setTracks(id, ids, user) {
  const tv = auth.visibilitySql(user, 'track', 't');
  const ok = new Set(db.prepare(`SELECT id FROM tracks t WHERE ${tv.sql}`).all(...tv.params).map(r => r.id));
  const list = ids.map(Number).filter(n => ok.has(n)).slice(0, 2000);
  tx(() => {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id);
    const ins = db.prepare('INSERT INTO playlist_tracks(playlist_id, position, track_id) VALUES (?, ?, ?)');
    list.forEach((t, i) => ins.run(id, i, t));
  });
}
router.post('/playlists/:id', needLogin, ownPlaylist, (req, res) => {
  const p = req.playlist, b = req.body || {};
  db.prepare('UPDATE playlists SET title = ?, visibility = ?, updated_at = ? WHERE id = ?')
    .run(str(b.title, 100) || p.title, ownVis(b.visibility, p.visibility), now(), p.id);
  if (Array.isArray(b.tracks)) setTracks(p.id, b.tracks, req.user);
  res.json({ ok: true });
});
router.post('/playlists/:id/loeschen', needLogin, ownPlaylist, (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.playlist.id);
  res.json({ ok: true });
});

// ---------- Lobbys ----------
function lobbyGate(req, res, next) {
  if (!lobbyOn()) return fail(res, 404, 'Lobbys sind ausgeschaltet.');
  if (!req.user) return fail(res, 401, 'Für Lobbys musst du angemeldet sein.');
  next();
}
function loadLobby(req, res, next) {
  req.lobby = lobby.get(req.params.id);
  return req.lobby ? next() : fail(res, 404, 'Diese Lobby gibt es nicht mehr.');
}

router.get('/lobbys', lobbyGate, (req, res) => res.json({ lobbies: lobby.list(req.user) }));
router.post('/lobbys', lobbyGate, auth.rateLimit('lobby', 20, 600), (req, res) => {
  const b = req.body || {};
  const l = lobby.create(req.user, { name: b.name, hidden: !!b.hidden, open: b.open !== false });
  if (!l) return fail(res, 503, 'Gerade gibt es zu viele Lobbys. Versuch es später noch einmal.');
  res.json({ id: l.id });
});

// Live-Verbindung: Server-Sent Events. X-Accel-Buffering sagt Nginx (Proxy Manager), dass er nichts zurückhalten soll.
router.get('/lobby/:id/events', lobbyGate, loadLobby, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const leave = lobby.join(req.lobby, req.user, res);
  req.on('close', leave);
});

// Lieder hinzufügen: eigene Titel und Playlists (für alle Mitglieder sichtbar) oder YouTube-Videos
async function itemsFor(req) {
  const b = req.body, u = req.user;
  const tv = auth.visibilitySql(u, 'track', 't');
  const visible = id => db.prepare(`SELECT t.* FROM tracks t WHERE t.id = ? AND ${tv.sql}`).get(Number(id), ...tv.params);
  // Gespeicherte YouTube-Links spielen in der Lobby wie eingefügte Links, Videos wie Musik über den eigenen Server
  const local = t => (t.kind === 'youtube'
    ? { type: 'yt', videoId: t.youtube_id, title: t.title, artist: t.artist || '', duration: t.duration || 0 }
    : { type: 'track', trackId: t.id, video: t.kind === 'video', title: t.title, artist: t.artist || '', duration: t.duration || 0 });
  let ids = [];
  if (Array.isArray(b.tracks)) ids = b.tracks;
  if (b.playlist) {
    const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(Number(b.playlist));
    if (!p || !auth.canSee(u, 'playlist', p)) throw new Error('Diese Playlist gibt es nicht.');
    ids = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(p.id).map(r => r.track_id);
  }
  const tracks = ids.slice(0, lobby.MAX_QUEUE).map(visible).filter(t => t && (t.kind !== 'youtube' || youtubeOn()));
  const skipped = tracks.filter(t => t.visibility !== 'public' && t.visibility !== 'members').length;
  const items = tracks.filter(t => t.visibility === 'public' || t.visibility === 'members').map(local);
  if (Array.isArray(b.youtube) && b.youtube.length) {
    if (!youtubeOn()) throw new Error('YouTube ist ausgeschaltet.');
    items.push(...await youtube.items(b.youtube));
  }
  return { items, skipped };
}

router.post('/lobby/:id', lobbyGate, loadLobby, auth.rateLimit('lobbyctl', 300, 60), async (req, res) => {
  const l = req.lobby, b = req.body || {};
  if (b.action === 'close') {
    if (req.user.id !== l.hostId && !req.user.isAdmin) return fail(res, 403, 'Nur der Gastgeber kann die Lobby schließen.');
    lobby.remove(l);
    return res.json({ ok: true });
  }
  if (b.action === 'add') {
    if (!lobby.canControl(l, req.user)) return fail(res, 403, 'Nur der Gastgeber darf hier Lieder hinzufügen.');
    let r;
    try { r = await itemsFor(req); } catch (e) { return fail(res, 400, e.message); }
    const n = lobby.addItems(l, r.items, req.user);
    if (n) lobby.broadcast(l);
    let msg = n ? `${n} ${n === 1 ? 'Lied' : 'Lieder'} hinzugefügt.` : 'Nichts hinzugefügt.';
    if (r.skipped) msg += ` ${r.skipped} private ${r.skipped === 1 ? 'Titel ist' : 'Titel sind'} nicht für alle hörbar und ${r.skipped === 1 ? 'blieb' : 'blieben'} draußen.`;
    if (n < r.items.length) msg += ` Die Warteschlange ist voll (${lobby.MAX_QUEUE}).`;
    return res.json({ ok: true, added: n, msg });
  }
  const err = lobby.control(l, req.user, b);
  if (typeof err === 'string') return fail(res, 403, err);
  if (err !== lobby.QUIET) lobby.broadcast(l);
  res.json({ ok: true });
});

module.exports = { router, deleteTrack };
