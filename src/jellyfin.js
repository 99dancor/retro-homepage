'use strict';
// Jellyfin im Mediaplayer: Filme und Serien durchsuchen, abspielen und weiterschauen, Zugang anfragen und freigeben.
//
// Die Seite spricht als einzige mit Jellyfin, und zwar mit dem API-Schlüssel des Dienstes (Seitenverwaltung → Dienste →
// Jellyfin, Haken „Im Mediaplayer anbieten“). Der Schlüssel hat in Jellyfin immer Admin-Rechte; er bleibt in der
// Datenbank und geht nie an den Browser. Damit nicht jeder alles sieht, fragt die Seite für freigegebene Mitglieder
// immer mit deren eigenem Jellyfin-Konto (userId): Jellyfin prüft dann selbst, welche Bibliotheken das Konto sehen darf,
// und merkt sich Fortschritt und „gesehen“ je Person. Bilder und Videos laufen über die Seite (Proxy), nur für Pfade
// eines Titels, den das Konto sehen darf; der Schlüssel wird dabei aus Wiedergabelisten (m3u8) entfernt.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { db, now } = require('./db');
const services = require('./services');
const notify = require('./notify');
const events = require('./events');

const TIMEOUT = 15000;
const ID = /^[0-9a-f]{32}$/i;
const base = u => String(u || '').trim().replace(/\/+$/, '');
const VIEWS = { members: 'Angemeldete Mitglieder', approved: 'Nur freigegebene Mitglieder', public: 'Alle Besucher' };
const FIELDS = 'Overview,Genres,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,RecursiveItemCount,DateCreated,EndDate,Status,PrimaryImageAspectRatio';

// ---------- Einstellungen ----------
// Es zählt der erste eingeschaltete Jellyfin-Dienst mit Schlüssel und Haken „Im Mediaplayer anbieten“
function conf() {
  const s = services.all().find(x => x.kind === 'jellyfin' && x.enabled && x.config.player && x.config.key && x.config.url);
  if (!s) return null;
  const c = s.config;
  return {
    id: s.id, name: s.name, url: base(c.url), key: c.key, insecure: !!c.insecure, publicUrl: s.public_url ? base(s.public_url) : '',
    view: Object.hasOwn(VIEWS, c.view) ? c.view : 'members', libs: Array.isArray(c.libs) ? c.libs.filter(x => ID.test(x)) : [],
    browseAs: ID.test(c.browse_as || '') ? c.browse_as : '', app: c.app !== false,
  };
}

// ---------- Netz ----------
function authHeader(c, deviceId) {
  return `MediaBrowser Client="Retro-Homepage", Device="Website", DeviceId="${deviceId || 'retro-homepage'}", Version="1.0", Token="${c.key}"`;
}
// Anfrage an Jellyfin. stream: Antwort nicht einlesen, sondern das Antwortobjekt zurückgeben (für den Proxy).
function request(c, method, p, { query = null, body = undefined, headers = {}, device = null, stream = false, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(c.url + p); } catch { return reject(new Error('Adresse ungültig')); }
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method, rejectUnauthorized: !c.insecure, timeout,
      headers: { accept: 'application/json', authorization: authHeader(c, device), 'x-emby-authorization': authHeader(c, device), 'x-emby-token': c.key,
        ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers },
    }, res => {
      if (stream) return resolve(res);
      const chunks = [];
      res.on('data', ch => chunks.push(ch));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Jellyfin antwortet nicht')));
    req.on('error', e => reject(new Error(e.code === 'ECONNREFUSED' ? 'Jellyfin ist nicht erreichbar' : e.message)));
    if (data) req.write(data);
    req.end();
  });
}
async function api(c, method, p, opts = {}) {
  const r = await request(c, method, p, opts);
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Jellyfin lehnt den Schlüssel ab'), { status: r.status });
  if (r.status === 404) throw Object.assign(new Error('Nicht gefunden'), { status: 404 });
  if (r.status >= 400) throw Object.assign(new Error('Jellyfin meldet HTTP ' + r.status + (r.body.length ? ': ' + r.body.toString('utf8').slice(0, 160) : '')), { status: r.status });
  if (!r.body.length) return null;
  try { return JSON.parse(r.body.toString('utf8')); } catch { return null; }
}
// Neuere Jellyfin-Fassungen (ab 10.9) haben andere Pfade als ältere; erst den neuen, bei 404 den alten probieren
async function either(c, method, a, b, opts) {
  try { return await api(c, method, a, opts); } catch (e) { if (e.status === 404 && b) return api(c, method, b, opts); throw e; }
}

// ---------- Zugang ----------
const row = userId => (userId ? db.prepare('SELECT * FROM jf_access WHERE user_id = ?').get(userId) : null);
// Was darf dieser Besucher? on: Jellyfin ist im Mediaplayer eingeschaltet
function status(user, c = conf()) {
  if (!c) return { on: false };
  const r = user ? row(user.id) : null;
  const play = !!(r && r.state === 'approved' && r.jf_user_id);
  const isAdmin = !!(user && user.isAdmin);
  const browse = play || isAdmin || c.view === 'public' || (c.view === 'members' && !!user);
  return {
    on: true, browse, play, admin: isAdmin, state: r ? r.state : null, name: c.name,
    // „Zugang anfragen“ geht nur mit Konto; abgelehnt heißt: der Admin hat nein gesagt, neu fragen geht nach einem Tag
    canRequest: !!user && !play && (!r || (r.state === 'denied' && now() - (r.decided_at || 0) > 86400)),
    app: play && c.app && !!c.publicUrl ? { url: c.publicUrl, name: r.jf_name, created: !!r.created_account, pw: !!r.app_pw } : null,
    jfUser: play ? r.jf_user_id : null,
  };
}
// Mit welchem Jellyfin-Konto gefragt wird: freigegeben → das eigene, sonst das Vorschau-Konto (oder keins)
function asUser(st, c) { return st.play ? st.jfUser : c.browseAs || null; }

function request_(user, { message = '', app = false } = {}) {
  const c = conf();
  const st = status(user, c);
  if (!st.on) return { error: 'Jellyfin ist gerade nicht eingeschaltet.' };
  if (!st.canRequest) return { error: st.play ? 'Du hast schon Zugang.' : st.state === 'pending' ? 'Deine Anfrage liegt schon beim Admin.' : 'Bitte warte etwas, bevor du noch einmal fragst.' };
  const msg = String(message || '').trim().slice(0, 300);
  db.prepare(`INSERT INTO jf_access(user_id, state, message, wants_app, requested_at) VALUES (?, 'pending', ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET state = 'pending', message = excluded.message, wants_app = excluded.wants_app, requested_at = excluded.requested_at, decided_at = NULL, decided_by = NULL`)
    .run(user.id, msg || null, app ? 1 : 0, now());
  const name = user.display_name || user.username;
  notify.toAdmins('🎬 Jellyfin: ' + name + ' fragt nach Zugang', msg || 'Ohne Nachricht', `/admin/dienste/${c.id}#zugaenge`, 'jf-req-' + user.id);
  events.log('info', 'Jellyfin', `${name} fragt nach Zugang`, user.id);
  return { ok: true };
}

const pw = () => crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
// Neues Jellyfin-Konto: ohne Admin-Rechte, auf der Anmeldeseite versteckt, nur die gewählten Bibliotheken
async function createAccount(c, name, password) {
  const existing = (await api(c, 'GET', '/Users')) || [];
  let n = name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || 'Mitglied';
  if (existing.some(u => u.Name.toLowerCase() === n.toLowerCase())) n = (n + ' (Website)').slice(0, 50);
  if (existing.some(u => u.Name.toLowerCase() === n.toLowerCase())) throw new Error(`In Jellyfin gibt es „${n}“ schon. Verknüpfe das vorhandene Konto.`);
  const u = await api(c, 'POST', '/Users/New', { body: { Name: n, Password: password } });
  const full = await api(c, 'GET', '/Users/' + u.Id);
  const p = Object.assign({}, full.Policy || {}, {
    IsAdministrator: false, IsHidden: true, IsDisabled: false, EnableAllFolders: !c.libs.length, EnabledFolders: c.libs,
    EnableContentDeletion: false, EnableContentDeletionFromFolders: [], EnableRemoteControlOfOtherUsers: false, EnableSharedDeviceControl: false,
    EnableLiveTvManagement: false, EnableCollectionManagement: false, EnableSubtitleManagement: false, EnableUserPreferenceAccess: true,
    EnableMediaPlayback: true, EnableAudioPlaybackTranscoding: true, EnableVideoPlaybackTranscoding: true, EnablePlaybackRemuxing: true, EnableRemoteAccess: true,
  });
  await api(c, 'POST', `/Users/${u.Id}/Policy`, { body: p });
  return { id: u.Id, name: n };
}
// Admin gibt frei: neues Konto anlegen oder ein vorhandenes verknüpfen (link = Jellyfin-Konto-Id)
async function approve(admin, userId, { link = '' } = {}) {
  const c = conf();
  if (!c) throw new Error('Jellyfin ist im Mediaplayer nicht eingeschaltet.');
  const u = db.prepare('SELECT id, username, display_name FROM users WHERE id = ? AND disabled = 0').get(Number(userId));
  if (!u) throw new Error('Dieses Mitglied gibt es nicht.');
  let r = row(u.id);
  if (!r) { db.prepare("INSERT INTO jf_access(user_id, state, requested_at) VALUES (?, 'pending', ?)").run(u.id, now()); r = row(u.id); }
  let acc, created = 0, appPw = null;
  if (link) {
    if (!ID.test(link)) throw new Error('Unbekanntes Jellyfin-Konto.');
    const j = await api(c, 'GET', '/Users/' + link);
    acc = { id: j.Id, name: j.Name };
  } else {
    const password = pw();
    acc = await createAccount(c, u.display_name || u.username, password);
    created = 1;
    if (r.wants_app) appPw = password;
  }
  db.prepare("UPDATE jf_access SET state = 'approved', jf_user_id = ?, jf_name = ?, created_account = ?, app_pw = ?, decided_at = ?, decided_by = ? WHERE user_id = ?")
    .run(acc.id, acc.name, created, appPw, now(), admin.id, u.id);
  notify.send(u.id, 'jellyfin', { key: 'jf-ok', title: '🎬 Jellyfin ist freigeschaltet', body: 'Im Mediaplayer findest du jetzt Filme und Serien zum Ansehen.' + (appPw ? ' Die Zugangsdaten für die Apps stehen dort unter „Jellyfin-App“.' : ''), url: '/musik#jellyfin' });
  events.log('info', 'Jellyfin', `Zugang für ${u.username} freigegeben (${created ? 'neues Konto' : 'verknüpft mit ' + acc.name})`, admin.id);
  return acc;
}
function deny(admin, userId) {
  const r = row(Number(userId));
  if (!r || r.state !== 'pending') return;
  db.prepare("UPDATE jf_access SET state = 'denied', decided_at = ?, decided_by = ? WHERE user_id = ?").run(now(), admin.id, r.user_id);
  notify.send(r.user_id, 'jellyfin', { key: 'jf-no', title: '🎬 Jellyfin: Anfrage abgelehnt', body: 'Der Admin hat deine Anfrage diesmal abgelehnt.', url: '/musik' });
}
// Zugang entziehen. Ein Konto, das die Seite angelegt hat, wird in Jellyfin gelöscht (samt Fortschritt), ein verknüpftes bleibt.
async function revoke(admin, userId) {
  const r = row(Number(userId));
  if (!r) return;
  const c = conf();
  if (c && r.created_account && r.jf_user_id) await api(c, 'DELETE', '/Users/' + r.jf_user_id).catch(e => { if (e.status !== 404) throw e; });
  db.prepare('DELETE FROM jf_access WHERE user_id = ?').run(r.user_id);
  events.log('info', 'Jellyfin', `Zugang für Konto ${r.user_id} entzogen`, admin.id);
}
// Konto löschen auf der Seite: angelegtes Jellyfin-Konto mitnehmen (Aufruf aus der Kontolöschung)
async function forget(userId) {
  const r = row(userId), c = conf();
  if (r && c && r.created_account && r.jf_user_id) await api(c, 'DELETE', '/Users/' + r.jf_user_id).catch(() => {});
}
// App-Zugangsdaten: das Passwort zeigt die Seite genau einmal, danach ist es weg. Neu setzen geht nur bei Konten der Seite.
function takeAppPassword(user) {
  const r = row(user.id);
  if (!r || r.state !== 'approved' || !r.app_pw) return null;
  db.prepare('UPDATE jf_access SET app_pw = NULL WHERE user_id = ?').run(user.id);
  return r.app_pw;
}
async function newAppPassword(user) {
  const c = conf(), r = row(user.id);
  if (!c || !c.app || !r || r.state !== 'approved' || !r.created_account) throw new Error('Das geht nur für Konten, die die Seite angelegt hat.');
  const p = pw();
  await api(c, 'POST', `/Users/${r.jf_user_id}/Password`, { body: { CurrentPw: '', NewPw: p, ResetPassword: false } });
  return p;
}
// Für die Seitenverwaltung
function accessList() {
  return db.prepare(`SELECT a.*, u.username, u.display_name FROM jf_access a JOIN users u ON u.id = a.user_id
    ORDER BY a.state = 'pending' DESC, a.state = 'approved' DESC, a.requested_at DESC`).all();
}
const pendingCount = () => db.prepare("SELECT COUNT(*) AS n FROM jf_access WHERE state = 'pending'").get().n;
async function adminInfo(c = conf()) {
  if (!c) return null;
  const [folders, users] = await Promise.all([api(c, 'GET', '/Library/MediaFolders').catch(() => null), api(c, 'GET', '/Users').catch(() => null)]);
  return {
    folders: ((folders && folders.Items) || []).map(f => ({ id: f.Id, name: f.Name, type: f.CollectionType || '' })),
    users: (users || []).map(u => ({ id: u.Id, name: u.Name, admin: !!(u.Policy && u.Policy.IsAdministrator), hidden: !!(u.Policy && u.Policy.IsHidden) })),
  };
}

// ---------- Inhalte ----------
const sec = t => (t ? Math.round(t / 1e7) : 0);
function item(x) {
  const ud = x.UserData || {};
  const primary = x.ImageTags && x.ImageTags.Primary;
  return {
    id: x.Id, type: x.Type, name: x.Name || '', year: x.ProductionYear || null, endYear: x.EndDate ? Number(String(x.EndDate).slice(0, 4)) : null,
    status: x.Status || '', runtime: sec(x.RunTimeTicks), overview: String(x.Overview || '').slice(0, 1500), genres: (x.Genres || []).slice(0, 4),
    rating: x.CommunityRating ? Math.round(x.CommunityRating * 10) / 10 : null, age: x.OfficialRating || '',
    played: !!ud.Played, pos: sec(ud.PlaybackPositionTicks), fav: !!ud.IsFavorite, unplayed: ud.UnplayedItemCount ?? null,
    series: x.SeriesName || '', seriesId: x.SeriesId || '', seasonId: x.SeasonId || '', season: x.ParentIndexNumber ?? null, episode: x.IndexNumber ?? null,
    img: primary ? x.Id : x.SeriesPrimaryImageTag ? x.SeriesId : x.ParentThumbItemId || null,
    seriesImg: x.SeriesPrimaryImageTag ? x.SeriesId : null,
    count: x.ChildCount ?? x.RecursiveItemCount ?? null, added: x.DateCreated ? Math.floor(Date.parse(x.DateCreated) / 1000) : null,
  };
}
// /Items mit Konto; ältere Fassungen kennen nur /Users/{id}/Items
async function items(c, uid, q) {
  const query = { Recursive: true, Fields: FIELDS, EnableImageTypes: 'Primary', ImageTypeLimit: 1, ...q };
  if (uid) query.userId = uid;
  else if (c.libs.length === 1 && !query.ParentId) query.ParentId = c.libs[0];
  const r = await either(c, 'GET', '/Items', uid ? `/Users/${uid}/Items` : null, { query });
  let list = (r && r.Items) || [];
  return { items: list.map(item), total: (r && r.TotalRecordCount) || list.length };
}
const SORT = { neu: ['DateCreated', 'Descending'], name: ['SortName', 'Ascending'], jahr: ['ProductionYear,SortName', 'Descending'], bewertung: ['CommunityRating,SortName', 'Descending'], zufall: ['Random', 'Ascending'] };
async function browse(user, { type = 'Movie', sort = 'neu', genre = '', q = '', filter = '', start = 0, limit = 60 } = {}) {
  const c = conf(), st = status(user, c);
  if (!st.browse) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  const uid = asUser(st, c), s = SORT[sort] || SORT.neu;
  const query = {
    IncludeItemTypes: type === 'Series' ? 'Series' : type === 'Episode' ? 'Episode' : type === 'all' ? 'Movie,Series' : 'Movie',
    SortBy: s[0], SortOrder: s[1], StartIndex: Math.max(0, Number(start) || 0), Limit: Math.max(1, Math.min(100, Number(limit) || 60)),
  };
  if (q) query.SearchTerm = String(q).slice(0, 80);
  if (genre) query.Genres = String(genre).slice(0, 60);
  if (st.play && filter === 'ungesehen') query.Filters = 'IsUnplayed';
  if (st.play && filter === 'liste') query.Filters = 'IsFavorite';
  const r = await items(c, uid, query);
  return st.play ? r : { ...r, items: r.items.map(hidePersonal) };
}
// Wer nur stöbert, sieht keinen Fortschritt (der käme vom Vorschau-Konto)
const hidePersonal = x => ({ ...x, played: false, pos: 0, fav: false, unplayed: null });
async function home(user) {
  const c = conf(), st = status(user, c);
  if (!st.browse) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  const uid = asUser(st, c);
  const latest = (type, limit = 16) => items(c, uid, { IncludeItemTypes: type, SortBy: 'DateCreated', SortOrder: 'Descending', Limit: limit }).catch(() => ({ items: [] }));
  // Neue Folgen: je Serie nur die neueste, sonst steht dieselbe Serie zehnmal nebeneinander
  const perSeries = list => list.filter((x, i) => !x.seriesId || list.findIndex(y => y.seriesId === x.seriesId) === i).slice(0, 16);
  const [movies, episodes, resume, counts] = await Promise.all([
    latest('Movie'), latest('Episode', 60).then(r => ({ items: perSeries(r.items) })),
    st.play ? items(c, uid, { IncludeItemTypes: 'Movie,Episode', Filters: 'IsResumable', SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 12 }).catch(() => ({ items: [] })) : { items: [] },
    Promise.all([items(c, uid, { IncludeItemTypes: 'Movie', Limit: 1 }), items(c, uid, { IncludeItemTypes: 'Series', Limit: 1 })]).then(([m, s]) => ({ movies: m.total, series: s.total })).catch(() => null),
  ]);
  const p = x => (st.play ? x : x.map(hidePersonal));
  return { movies: p(movies.items), episodes: p(episodes.items), resume: resume.items, counts };
}
async function details(user, id) {
  const c = conf(), st = status(user, c);
  if (!st.browse || !ID.test(id)) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  const uid = asUser(st, c);
  const x = await either(c, 'GET', `/Items/${id}`, uid ? `/Users/${uid}/Items/${id}` : null, { query: uid ? { userId: uid } : null });
  const out = item(x);
  const ms = (x.MediaSources && x.MediaSources[0]) || null;
  const streams = (ms && ms.MediaStreams) || x.MediaStreams || [];
  out.audio = streams.filter(s => s.Type === 'Audio').map(s => ({ index: s.Index, label: s.DisplayTitle || s.Language || 'Ton ' + s.Index, def: !!s.IsDefault }));
  out.subs = streams.filter(s => s.Type === 'Subtitle').map(s => ({ index: s.Index, label: s.DisplayTitle || s.Language || 'Untertitel ' + s.Index, def: !!s.IsDefault, text: !!s.IsTextSubtitleStream }));
  const v = streams.find(s => s.Type === 'Video');
  out.video = v ? { codec: v.Codec || '', width: v.Width || 0, height: v.Height || 0, hdr: v.VideoRange && v.VideoRange !== 'SDR' ? v.VideoRange : '' } : null;
  if (x.Type === 'Series') {
    const seasons = await either(c, 'GET', `/Shows/${id}/Seasons`, null, { query: { userId: uid, Fields: 'ChildCount' } }).catch(() => null);
    out.seasons = ((seasons && seasons.Items) || []).map(s => ({ id: s.Id, name: s.Name, index: s.IndexNumber ?? null, count: s.ChildCount ?? null, unplayed: s.UserData ? s.UserData.UnplayedItemCount ?? null : null }));
    if (st.play) {
      const nu = await api(c, 'GET', '/Shows/NextUp', { query: { userId: uid, SeriesId: id, Limit: 1, Fields: FIELDS } }).catch(() => null);
      out.next = nu && nu.Items && nu.Items[0] ? item(nu.Items[0]) : null;
    }
  }
  out.app = st.play && c.publicUrl ? `${c.publicUrl}/web/#/details?id=${x.Id}` : null;
  return st.play ? out : { ...hidePersonal(out), app: null };
}
async function episodes(user, seriesId, seasonId) {
  const c = conf(), st = status(user, c);
  if (!st.browse || !ID.test(seriesId) || (seasonId && !ID.test(seasonId))) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  const uid = asUser(st, c);
  const r = await api(c, 'GET', `/Shows/${seriesId}/Episodes`, { query: { userId: uid, SeasonId: seasonId || null, Fields: FIELDS } });
  const list = ((r && r.Items) || []).map(item);
  return st.play ? list : list.map(hidePersonal);
}
async function genres(user, type) {
  const c = conf(), st = status(user, c);
  if (!st.browse) return [];
  const r = await api(c, 'GET', '/Genres', { query: { userId: asUser(st, c), IncludeItemTypes: type === 'Series' ? 'Series' : 'Movie', Recursive: true, SortBy: 'SortName' } }).catch(() => null);
  return ((r && r.Items) || []).map(g => g.Name).slice(0, 60);
}
async function favorite(user, id, on) {
  const c = conf(), st = status(user, c);
  if (!st.play || !ID.test(id)) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  await either(c, on ? 'POST' : 'DELETE', `/UserFavoriteItems/${id}`, `/Users/${st.jfUser}/FavoriteItems/${id}`, { query: { userId: st.jfUser } });
}

// ---------- Abspielen ----------
// Was der Browser direkt abspielen kann, sagt er selbst (codecs); alles andere wandelt Jellyfin in H.264/AAC als HLS um
function profile(codecs, bitrate) {
  const v = ['h264'].concat((codecs || []).filter(x => ['hevc', 'av1', 'vp9'].includes(x)));
  return {
    MaxStreamingBitrate: bitrate, MaxStaticBitrate: bitrate, MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: v.join(','), AudioCodec: 'aac,mp3,opus,flac,alac' },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' },
    ],
    TranscodingProfiles: [{ Container: 'ts', Type: 'Video', AudioCodec: 'aac', VideoCodec: 'h264', Context: 'Streaming', Protocol: 'hls', MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true }],
    ContainerProfiles: [], CodecProfiles: [],
    SubtitleProfiles: ['vtt', 'srt', 'subrip', 'ass', 'ssa'].map(f => ({ Format: f, Method: 'External' })).concat(['pgssub', 'dvdsub', 'dvbsub'].map(f => ({ Format: f, Method: 'Encode' }))),
  };
}
const device = user => 'retro-homepage-' + user.id;
// Schlüssel aus Adressen entfernen, bevor sie an den Browser gehen
function stripKey(s) {
  s = String(s);
  const i = s.indexOf('?');
  if (i < 0) return s;
  const q = s.slice(i + 1).split('&').filter(x => x && !/^(api_key|apikey)=/i.test(x));
  return s.slice(0, i) + (q.length ? '?' + q.join('&') : '');
}
async function play(user, id, { audio = null, sub = null, bitrate = 0, codecs = [] } = {}) {
  const c = conf(), st = status(user, c);
  if (!st.play || !ID.test(id)) throw Object.assign(new Error('Für Jellyfin brauchst du eine Freigabe.'), { status: 403 });
  const br = Math.max(1e6, Math.min(120e6, Number(bitrate) || 20e6));
  const subIdx = sub === null || sub === '' ? -1 : Number(sub);
  const info = await api(c, 'POST', `/Items/${id}/PlaybackInfo`, {
    device: device(user), query: { userId: st.jfUser },
    body: { UserId: st.jfUser, DeviceProfile: profile(codecs, br), MaxStreamingBitrate: br, AudioStreamIndex: audio === null || audio === '' ? undefined : Number(audio),
      SubtitleStreamIndex: subIdx, EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true, AutoOpenLiveStream: true },
  });
  const ms = info && info.MediaSources && info.MediaSources[0];
  if (!ms) throw new Error(info && info.ErrorCode ? 'Jellyfin: ' + info.ErrorCode : 'Jellyfin liefert keine Quelle für diesen Titel.');
  const streams = ms.MediaStreams || [];
  const chosenSub = streams.find(s => s.Type === 'Subtitle' && s.Index === subIdx);
  const burn = !!(chosenSub && !chosenSub.IsTextSubtitleStream);
  let mode, url;
  if (ms.SupportsDirectPlay && !burn && audio === null) {
    mode = 'direct';
    url = `/jellyfin/s/${id}/stream?static=true&MediaSourceId=${encodeURIComponent(ms.Id)}&PlaySessionId=${encodeURIComponent(info.PlaySessionId || '')}`;
  } else if (ms.TranscodingUrl) {
    mode = 'hls';
    url = '/jellyfin/s' + stripKey(ms.TranscodingUrl).replace(/^\/videos/i, '');
  } else throw new Error('Diesen Titel kann Jellyfin für den Browser nicht umwandeln.');
  const x = await either(c, 'GET', `/Items/${id}`, `/Users/${st.jfUser}/Items/${id}`, { query: { userId: st.jfUser } }).catch(() => null);
  const v = streams.find(s => s.Type === 'Video');
  return {
    mode, url, session: info.PlaySessionId || '', source: ms.Id, duration: sec(ms.RunTimeTicks), start: x ? sec((x.UserData || {}).PlaybackPositionTicks) : 0,
    video: v ? `${v.Codec || ''}${v.Height ? ' ' + v.Height + 'p' : ''}`.trim() : '', transcode: mode === 'hls' ? (ms.TranscodingSubProtocol || 'hls') : '',
    audio: streams.filter(s => s.Type === 'Audio').map(s => ({ index: s.Index, label: s.DisplayTitle || s.Language || 'Ton ' + s.Index, def: s.Index === ms.DefaultAudioStreamIndex })),
    subs: streams.filter(s => s.Type === 'Subtitle').map(s => ({ index: s.Index, label: s.DisplayTitle || s.Language || 'Untertitel ' + s.Index, text: !!s.IsTextSubtitleStream,
      url: s.IsTextSubtitleStream ? `/jellyfin/s/${id}/${encodeURIComponent(ms.Id)}/Subtitles/${s.Index}/0/Stream.vtt` : null })),
    audioIndex: audio === null || audio === '' ? ms.DefaultAudioStreamIndex ?? null : Number(audio), subIndex: subIdx, burn,
  };
}
// Fortschritt und „gesehen“ im Konto des Mitglieds; stop beendet außerdem eine laufende Umwandlung
async function progress(user, id, { pos = 0, done = false, stop = false, session = '' } = {}) {
  const c = conf(), st = status(user, c);
  if (!st.play || !ID.test(id)) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  const body = done ? { Played: true, PlaybackPositionTicks: 0 } : { PlaybackPositionTicks: Math.max(0, Math.round(Number(pos) || 0)) * 1e7 };
  await either(c, 'POST', `/UserItems/${id}/UserData`, `/Users/${st.jfUser}/Items/${id}/UserData`, { query: { userId: st.jfUser }, body }).catch(async e => {
    // Ganz alte Fassungen: nur „gesehen“ setzen geht
    if (done) await api(c, 'POST', `/Users/${st.jfUser}/PlayedItems/${id}`).catch(() => {}); else throw e;
  });
  if (stop) await api(c, 'DELETE', '/Videos/ActiveEncodings', { query: { deviceId: device(user), playSessionId: session || null } }).catch(() => {});
}

// ---------- Proxy für Bilder und Videos ----------
// Darf das Konto diesen Titel sehen? Kurz gemerkt, weil ein Film aus hunderten Stückchen besteht.
const seen = new Map();
async function mayAccess(c, st, id) {
  const uid = asUser(st, c);
  const k = (uid || '-') + ':' + id, t = seen.get(k);
  if (t && t > Date.now()) return true;
  try {
    await either(c, 'GET', `/Items/${id}`, uid ? `/Users/${uid}/Items/${id}` : null, { query: uid ? { userId: uid } : null });
  } catch { return false; }
  if (seen.size > 5000) seen.clear();
  seen.set(k, Date.now() + 30 * 60 * 1000);
  return true;
}
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
async function pipe(c, res, p, query, headers, { m3u8 = false, cache = null, device: dev } = {}) {
  const up = await request(c, 'GET', p, { query, headers, stream: true, device: dev, timeout: 60000 });
  if (up.statusCode >= 400) { up.resume(); return res.status(up.statusCode === 404 ? 404 : 502).end(); }
  const type = String(up.headers['content-type'] || '');
  if (m3u8 || /mpegurl/i.test(type)) {
    const chunks = [];
    up.on('data', ch => chunks.push(ch));
    up.on('end', () => {
      res.set('content-type', type || 'application/vnd.apple.mpegurl').set('cache-control', 'no-store');
      res.send(Buffer.concat(chunks).toString('utf8').split('\n').map(l => (l.startsWith('#') ? l.replace(/URI="([^"]*)"/g, (m, u) => 'URI="' + stripKey(u) + '"') : stripKey(l))).join('\n'));
    });
    return;
  }
  res.status(up.statusCode);
  for (const h of PASS) if (up.headers[h]) res.set(h, up.headers[h]);
  res.set('cache-control', cache || 'private, no-store');
  res.on('close', () => up.destroy());
  up.pipe(res);
}
async function image(user, id, w, res) {
  const c = conf(), st = status(user, c);
  if (!st.browse || !ID.test(id)) return res.status(404).end();
  if (!(await mayAccess(c, st, id))) return res.status(404).end();
  await pipe(c, res, `/Items/${id}/Images/Primary`, { fillWidth: Math.max(60, Math.min(800, Number(w) || 240)), quality: 82 }, {}, { cache: 'private, max-age=86400' });
}
// rest: alles hinter /jellyfin/s/<id>/, z. B. master.m3u8, hls1/main/0.ts, stream, <quelle>/Subtitles/3/0/Stream.vtt
async function stream(user, id, rest, query, req, res) {
  const c = conf(), st = status(user, c);
  if (!st.play || !ID.test(id) || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(rest) || rest.split('/').some(x => x === '..' || x === '.')) return res.status(404).end();
  if (!(await mayAccess(c, st, id))) return res.status(404).end();
  const q = {};
  for (const [k, v] of Object.entries(query || {})) if (!/^(api_key|apikey)$/i.test(k) && typeof v === 'string') q[k] = v;
  const headers = req.headers.range ? { range: req.headers.range } : {};
  await pipe(c, res, `/Videos/${id}/${rest}`, q, headers, { m3u8: /\.m3u8$/i.test(rest), device: device(user) });
}

// Für Tests
const _ = { stripKey, item, profile, authHeader };
module.exports = {
  VIEWS, conf, status, request: request_, approve, deny, revoke, forget, takeAppPassword, newAppPassword, accessList, pendingCount, adminInfo,
  browse, home, details, episodes, genres, favorite, play, progress, image, stream, api, _,
};
