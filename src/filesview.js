'use strict';
// Downloads als Explorer (views/files.ejs, public/files.js): links der Baum (Alle, Neu, Mediathek, Kategorien),
// in der Mitte die Liste, rechts die Details der Auswahl. Mediathek-Einträge sind Titel und Playlists aus dem Mediaplayer,
// damit man alles an einer Stelle findet; abgespielt wird weiter im Mediaplayer.
const { db, now } = require('./db');
const auth = require('./auth');
const cats = require('./filecats');

const NEW_DAYS = 14;
const VIS_LABEL = { public: '🌐 Öffentlich', members: '👥 Angemeldete', friends: '⭐ Nur Freunde', private: '🔒 Nur ich und der Admin', groups: '👪 Gruppen' };

// Geladene Link-Vorschläge: „vorgeschlagen von …“ in den Details (rq_*)
const REQ = 'LEFT JOIN users rq ON rq.id = {a}.requested_by';
function visibleFiles(user) {
  const v = auth.visibilitySql(user, 'file', 'f');
  return db.prepare(`SELECT f.*, u.username, u.display_name, rq.username AS rq_user, rq.display_name AS rq_name FROM files f LEFT JOIN users u ON u.id = f.uploader_id ${REQ.replace('{a}', 'f')}
                     WHERE ${v.sql} ORDER BY f.created_at DESC`).all(...v.params);
}
function visibleTracks(user) {
  const v = auth.visibilitySql(user, 'track', 't');
  return db.prepare(`SELECT t.*, u.username, u.display_name, rq.username AS rq_user, rq.display_name AS rq_name FROM tracks t LEFT JOIN users u ON u.id = t.uploader_id ${REQ.replace('{a}', 't')}
                     WHERE ${v.sql} AND t.kind IN ('audio', 'video') AND t.stored_name IS NOT NULL AND t.stored_name != ''
                     ORDER BY t.artist COLLATE NOCASE, t.title COLLATE NOCASE`).all(...v.params);
}
function visiblePlaylists(user) {
  if (!user) return [];
  const v = auth.visibilitySql(user, 'playlist', 'p');
  return db.prepare(`SELECT p.*, u.username, u.display_name, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS n
                     FROM playlists p JOIN users u ON u.id = p.user_id WHERE ${v.sql} ORDER BY p.title COLLATE NOCASE`).all(...v.params);
}

const by = r => (r.username ? r.display_name || r.username : null);
// Herkunft: hochgeladen oder über einen Link geladen (vorgeschlagen von …)
const origin = r => (r.source_url ? { source: r.source_url, requestedBy: r.rq_user ? r.rq_name || r.rq_user : '' } : {});

function fileRow(f, user, list) {
  const mine = !!user && f.uploader_id === user.id;
  return {
    ref: 'datei:' + f.id, type: 'file', icon: cats.iconOf(f.category, list), name: f.title, file: f.original_name !== f.title ? f.original_name : '',
    group: f.category, cat: f.category, game: f.game || '', desc: f.description || '', size: f.size, date: f.created_at, by: by(f), byUser: f.username || '',
    vis: f.visibility, visLabel: VIS_LABEL[f.visibility] || '', downloads: f.downloads,
    dl: '/files/dl/' + f.id, view: '/ansehen/datei/' + f.id,
    edit: user && user.isAdmin ? '/admin/files/' + f.id : mine ? '/eigene-dateien?bib=datei' : '', privat: !!f.privat, ...origin(f),
  };
}
function trackRow(t, user) {
  const mine = !!user && t.uploader_id === user.id, video = t.kind === 'video';
  return {
    ref: 'titel:' + t.id, type: video ? 'video' : 'audio', icon: video ? '🎬' : '🎵', name: t.title, file: t.original_name,
    group: video ? 'Videos' : 'Musik', artist: t.artist || '', album: t.album || '', duration: t.duration || 0,
    size: t.size, date: t.created_at, by: by(t), byUser: t.username || '', vis: t.visibility, visLabel: VIS_LABEL[t.visibility] || '', plays: t.plays,
    dl: '/musik/stream/' + t.id + '?dl=1', play: '/musik?titel=' + t.id,
    edit: user && user.isAdmin ? '/admin/musik/' + t.id : mine ? '/eigene-dateien?bib=titel' : '', privat: !!t.privat, ...origin(t),
  };
}
function playlistRow(p, user) {
  return {
    ref: 'playlist:' + p.id, type: 'playlist', icon: '📋', name: p.title, group: 'Playlists', count: p.n, size: 0, date: p.updated_at,
    by: by(p), byUser: p.username || '', vis: p.visibility, visLabel: VIS_LABEL[p.visibility] || '', play: '/musik?playlist=' + p.id,
    edit: user && p.user_id === user.id ? '/eigene-dateien?bib=playlist' : '',
  };
}

// Knoten im Baum: alle, neu, musik, videos, playlists, privat (nur mit Recht) oder k:<Kategorie>
// Der Bereich Privat steht nur unter seinem eigenen Knoten, nie in Alle, Neu, Mediathek oder der Suche.
function build(user, node, q = '') {
  const list = cats.list();
  const allFiles = visibleFiles(user).map(f => fileRow(f, user, list));
  const allTracks = visibleTracks(user).map(t => trackRow(t, user));
  const files = allFiles.filter(r => !r.privat), tracks = allTracks.filter(r => !r.privat);
  const privat = user && user.canPrivate ? [...allTracks, ...allFiles].filter(r => r.privat).sort((a, b) => b.date - a.date) : [];
  const playlists = visiblePlaylists(user).map(p => playlistRow(p, user));
  const music = tracks.filter(t => t.type === 'audio'), videos = tracks.filter(t => t.type === 'video');
  const since = now() - NEW_DAYS * 86400;
  const fresh = [...files, ...tracks].filter(r => r.date >= since).sort((a, b) => b.date - a.date);
  const byCat = {};
  for (const f of files) (byCat[f.cat] ||= []).push(f);
  const catNodes = list.filter(c => !c.loose || byCat[c.name]).map(c => ({ key: 'k:' + c.name, icon: c.icon, label: c.name, n: (byCat[c.name] || []).length, game: c.game }));

  let rows, title, icon, mode;
  q = String(q || '').trim().toLowerCase().slice(0, 100);
  if (q) {
    const hit = r => [r.name, r.file, r.artist, r.album, r.desc, r.game, r.cat].some(v => v && String(v).toLowerCase().includes(q));
    rows = [...files, ...tracks, ...playlists].filter(hit); title = 'Suchergebnis'; icon = '🔍'; mode = 'mixed'; node = 'suche';
  } else if (node === 'neu') { rows = fresh; title = 'Neu hinzugefügt'; icon = '🆕'; mode = 'mixed'; }
  else if (node === 'musik') { rows = music; title = 'Musik'; icon = '🎵'; mode = 'media'; }
  else if (node === 'videos') { rows = videos; title = 'Videos'; icon = '🎬'; mode = 'media'; }
  else if (node === 'playlists') { rows = playlists; title = 'Playlists'; icon = '📋'; mode = 'playlists'; }
  else if (node === 'privat' && user && user.canPrivate) { rows = privat; title = 'Privat'; icon = '🔞'; mode = 'mixed'; }
  else if (node && node.startsWith('k:') && catNodes.some(c => c.key === node)) {
    const c = catNodes.find(x => x.key === node);
    rows = byCat[c.label] || []; title = c.label; icon = c.icon; mode = 'files';
  } else { node = 'alle'; rows = [...files].sort((a, b) => a.cat.localeCompare(b.cat, 'de') || b.date - a.date); title = 'Alle Dateien'; icon = '🗂️'; mode = 'files'; }

  return {
    node, title, icon, mode, rows,
    tree: { all: files.length, fresh: fresh.length, music: music.length, videos: videos.length, playlists: playlists.length, cats: catNodes, loggedIn: !!user,
      privat: user && user.canPrivate ? privat.length : null },
  };
}

module.exports = { build, NEW_DAYS, VIS_LABEL };
