'use strict';
// Dienste (Seitenverwaltung → Dienste): andere Server und Docker-Container, deren Zustand die Seite zeigt – auf der
// Startseite, im Laufband, als 🗄️ neben der Uhr und im Desktop-Widget „Dienste“. Der Admin legt sie selbst an, für
// häufige gibt es Vorlagen (Jellyfin, Immich, Nextcloud, Minecraft, Steam-Spieleserver, Farming Simulator aus dem Hub)
// und dazu einfache Prüfungen (Website, TCP-Port).
//
// Sicherheit: Die Seite fragt die Dienste selbst ab, im eigenen Takt und nicht pro Besucher. Adressen, Ports und
// Schlüssel liegen nur in der Datenbank (services.config) und gehen nie an den Browser; die Seitenverwaltung zeigt sie
// gekürzt. Besucher sehen nur Name, Zustand und eine Kurzinfo. Docker selbst wird bewusst nicht abgefragt (der Socket
// verrät auch die Passwörter anderer Container). Jellyfin-Schlüssel haben immer volle Admin-Rechte, darum ist das Feld
// freiwillig; ohne Schlüssel zeigt Jellyfin nur online und die Version.
const fs = require('node:fs');
const net = require('node:net');
const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');
const { db, now, getSetting, DATA_DIR, UPLOAD_DIR, MUSIC_DIR, MEDIA_DIR, PAINT_DIR, APPS_DIR } = require('./db');
const events = require('./events');

const TIMEOUT = 6000;
const KEEP_DAYS = 7;
const MIN_EVERY = 30;

// Felder: url (Adresse), host + port, key (geheim), slow (ab so vielen ms „langsam“), insecure (Zertifikat nicht prüfen)
const KINDS = {
  jellyfin: { name: 'Jellyfin', icon: '🎬', hint: 'Filme und Serien: online, Version, mit Schlüssel auch wie viele gerade schauen',
    fields: ['url', 'key', 'insecure'], key: 'API-Schlüssel (freiwillig)', placeholder: 'http://192.168.1.10:8096' },
  immich: { name: 'Immich', icon: '📷', hint: 'Fotos: online und Version, mit Schlüssel auch Anzahl Fotos und Speicher',
    fields: ['url', 'key', 'insecure'], key: 'API-Schlüssel (freiwillig, nur Statistik)', placeholder: 'http://192.168.1.10:2283' },
  nextcloud: { name: 'Nextcloud', icon: '☁️', hint: 'Dateien: online, Version, Wartungsmodus, mit Token auch Nutzer und freier Platz',
    fields: ['url', 'key', 'insecure'], key: 'Serverinfo-Token (freiwillig)', placeholder: 'https://cloud.example.de' },
  minecraft: { name: 'Minecraft', icon: '⛏️', hint: 'Java-Server: Spieler online, Version, Beschreibung',
    fields: ['host', 'port'], port: 25565, placeholder: '192.168.1.10' },
  steam: { name: 'Steam-Spieleserver', icon: '🎮', hint: 'Valheim, CS2, ARK, Rust, Satisfactory …: Spieler und Karte (Steam-Abfrage A2S)',
    fields: ['host', 'port'], port: 27015, placeholder: '192.168.1.10' },
  fs25: { name: 'Farming Simulator 25', icon: '🚜', hint: 'Der Server aus dem Farming Hub, ohne weitere Angaben', fields: [] },
  http: { name: 'Website', icon: '🌐', hint: 'Antwortet eine Adresse? Für alles mit Weboberfläche', fields: ['url', 'slow', 'insecure'], placeholder: 'http://192.168.1.10:8080' },
  tcp: { name: 'TCP-Port', icon: '🔌', hint: 'Nimmt ein Port Verbindungen an? Für alles ohne Weboberfläche', fields: ['host', 'port'], placeholder: '192.168.1.10' },
};
const STATES = { up: 'Online', warn: 'Langsam', down: 'Offline', unknown: 'Noch nicht geprüft' };
const VIS = { public: 'Alle', members: 'Mitglieder', admin: 'Nur ich' };
const SHOW = { home: 'Startseite', widget: 'Widget', ticker: 'Laufband', tray: 'Taskleiste' };

// ---------- Netz ----------
// Eigenes GET statt fetch: geht an keinem Proxy vorbei ins interne Netz und kann auf Wunsch selbst signierte Zertifikate annehmen
function httpGet(url, { headers = {}, insecure = false, max = 1 << 20, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('Adresse ungültig')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('Nur http:// oder https://'));
    const t0 = Date.now();
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'user-agent': 'retro-homepage-dienste', accept: 'application/json, */*', ...headers }, rejectUnauthorized: !insecure, timeout }, res => {
      const chunks = [];
      let n = 0;
      res.on('data', c => { n += c.length; if (n <= max) chunks.push(c); else res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), ms: Date.now() - t0 }));
      res.on('error', reject);
      res.on('close', () => { if (n > max) resolve({ status: res.statusCode, body: '', ms: Date.now() - t0 }); });
    });
    req.on('timeout', () => req.destroy(new Error('keine Antwort')));
    req.on('error', e => reject(new Error(netError(e))));
  });
}
async function getJson(url, opts) {
  const r = await httpGet(url, opts);
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`Zugriff verweigert (HTTP ${r.status}), Schlüssel prüfen`), { auth: true, ms: r.ms });
  if (r.status >= 400) throw Object.assign(new Error('HTTP ' + r.status), { ms: r.ms });
  try { return { json: JSON.parse(r.body), ms: r.ms }; } catch { throw Object.assign(new Error('Antwort ist kein JSON (falsche Adresse?)'), { ms: r.ms }); }
}
function netError(e) {
  const c = e && e.code;
  return { ECONNREFUSED: 'Verbindung abgelehnt', EHOSTUNREACH: 'Rechner nicht erreichbar', ENOTFOUND: 'Name nicht gefunden', EAI_AGAIN: 'Name nicht gefunden',
    ETIMEDOUT: 'keine Antwort', ECONNRESET: 'Verbindung abgebrochen', DEPTH_ZERO_SELF_SIGNED_CERT: 'selbst signiertes Zertifikat',
    SELF_SIGNED_CERT_IN_CHAIN: 'selbst signiertes Zertifikat', CERT_HAS_EXPIRED: 'Zertifikat abgelaufen', ERR_TLS_CERT_ALTNAME_INVALID: 'Zertifikat passt nicht zur Adresse' }[c]
    || (e && e.message) || 'Fehler';
}
function tcpConnect(host, port, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    s.setTimeout(timeout, () => { s.destroy(); reject(new Error('keine Antwort')); });
    s.once('connect', () => { const ms = Date.now() - t0; s.destroy(); resolve(ms); });
    s.once('error', e => reject(new Error(netError(e))));
  });
}

// ---------- Minecraft: Server List Ping ----------
function varint(n) {
  const out = [];
  n >>>= 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function readVarint(buf, pos) {
  let n = 0, shift = 0, b;
  do {
    if (pos >= buf.length) return null;
    b = buf[pos++];
    n |= (b & 0x7f) << shift;
    shift += 7;
    if (shift > 35) throw new Error('kaputte Antwort');
  } while (b & 0x80);
  return { value: n, pos };
}
const packet = (...parts) => { const body = Buffer.concat(parts); return Buffer.concat([varint(body.length), body]); };
function mcText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.replace(/§./g, '');
  return (String(d.text || '') + (Array.isArray(d.extra) ? d.extra.map(mcText).join('') : '')).replace(/§./g, '');
}
function minecraftPing(host, port, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    let buf = Buffer.alloc(0), done = false;
    const fail = e => { if (!done) { done = true; s.destroy(); reject(e instanceof Error ? e : new Error(String(e))); } };
    s.setTimeout(timeout, () => fail(new Error('keine Antwort')));
    s.once('error', e => fail(new Error(netError(e))));
    s.once('connect', () => {
      const h = Buffer.from(String(host), 'utf8'), p = Buffer.alloc(2);
      p.writeUInt16BE(port);
      s.write(packet(varint(0), varint(-1), varint(h.length), h, p, varint(1)));
      s.write(packet(varint(0)));
    });
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > 1 << 20) return fail(new Error('Antwort zu groß'));
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.pos + len.value) return;
        const id = readVarint(buf, len.pos), sl = readVarint(buf, id.pos);
        const json = JSON.parse(buf.slice(sl.pos, sl.pos + sl.value).toString('utf8'));
        done = true;
        s.destroy();
        resolve({ ms: Date.now() - t0, json });
      } catch (e) { fail(new Error('Antwort nicht lesbar: ' + e.message)); }
    });
  });
}

// ---------- Steam-Spieleserver: A2S_INFO über UDP ----------
const A2S = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]), Buffer.from('Source Engine Query\0', 'latin1')]);
function parseA2S(buf) {
  let pos = 4;
  if (buf.readInt32LE(0) !== -1 || buf[pos++] !== 0x49) throw new Error('keine Server-Info');
  pos++; // Protokoll
  const str = () => { const end = buf.indexOf(0, pos); if (end < 0) throw new Error('kaputte Antwort'); const s = buf.slice(pos, end).toString('utf8'); pos = end + 1; return s; };
  const name = str(), map = str(), folder = str(), game = str();
  pos += 2; // Steam-App
  const players = buf[pos++], max = buf[pos++], bots = buf[pos++];
  pos += 2; // Art und System
  const visibility = buf[pos++];
  pos++; // VAC
  let version = '';
  try { version = str(); } catch { /* ältere Server */ }
  return { name, map, folder, game, players, max, bots, password: visibility === 1, version };
}
function steamQuery(host, port, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const s = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
    let done = false;
    const end = (e, v) => { if (done) return; done = true; clearTimeout(timer); try { s.close(); } catch { /* zu */ } if (e) reject(e); else resolve(v); };
    const timer = setTimeout(() => end(new Error('keine Antwort')), timeout);
    s.on('error', e => end(new Error(netError(e))));
    s.on('message', msg => {
      try {
        // Challenge (0x41): Anfrage mit den vier Bytes wiederholen
        if (msg.length >= 9 && msg.readInt32LE(0) === -1 && msg[4] === 0x41) return s.send(Buffer.concat([A2S, msg.slice(5, 9)]), port, host);
        end(null, { ms: Date.now() - t0, info: parseA2S(msg) });
      } catch (e) { end(e); }
    });
    s.send(A2S, port, host, e => { if (e) end(new Error(netError(e))); });
  });
}

// ---------- Prüfungen je Art ----------
// Ergebnis: { state: up | warn | down, ms, info, error }
const base = u => String(u || '').trim().replace(/\/+$/, '');
const CHECKS = {
  async http(c) {
    const r = await httpGet(c.url, { insecure: c.insecure, max: 64 * 1024 });
    if (r.status >= 400) return { state: 'down', ms: r.ms, error: 'HTTP ' + r.status, info: { code: r.status } };
    const slow = Math.max(100, Number(c.slow) || 2000);
    return { state: r.ms > slow ? 'warn' : 'up', ms: r.ms, info: { code: r.status } };
  },
  async tcp(c) {
    const ms = await tcpConnect(c.host, c.port);
    return { state: 'up', ms, info: {} };
  },
  async jellyfin(c) {
    const pub = await getJson(base(c.url) + '/System/Info/Public', { insecure: c.insecure });
    const info = { version: pub.json.Version || '', server: pub.json.ServerName || '' };
    if (c.key) {
      const headers = { authorization: `MediaBrowser Token="${c.key}"`, 'x-emby-token': c.key };
      try {
        const s = await getJson(base(c.url) + '/Sessions?activeWithinSeconds=900', { insecure: c.insecure, headers });
        const playing = (Array.isArray(s.json) ? s.json : []).filter(x => x && x.NowPlayingItem);
        info.watching = playing.length;
        // Wer was schaut: nur für die Seitenverwaltung, und nur wenn der Admin das eingeschaltet hat
        if (c.details) info.streams = playing.slice(0, 10).map(x => ({ user: String(x.UserName || ''), title: String((x.NowPlayingItem.SeriesName ? x.NowPlayingItem.SeriesName + ' – ' : '') + (x.NowPlayingItem.Name || '')).slice(0, 120) }));
        const counts = await getJson(base(c.url) + '/Items/Counts', { insecure: c.insecure, headers });
        info.counts = { movies: counts.json.MovieCount || 0, series: counts.json.SeriesCount || 0, episodes: counts.json.EpisodeCount || 0, songs: counts.json.SongCount || 0 };
      } catch (e) { info.keyError = e.message; }
    }
    return { state: 'up', ms: pub.ms, info };
  },
  async immich(c) {
    const ping = await getJson(base(c.url) + '/api/server/ping', { insecure: c.insecure });
    if (!ping.json || ping.json.res !== 'pong') return { state: 'down', ms: ping.ms, error: 'Antwort ist nicht von Immich', info: {} };
    const info = {};
    try { const v = await getJson(base(c.url) + '/api/server/version', { insecure: c.insecure }); info.version = [v.json.major, v.json.minor, v.json.patch].join('.'); } catch { /* ältere Fassung */ }
    if (c.key) {
      const headers = { 'x-api-key': c.key };
      try {
        const st = await getJson(base(c.url) + '/api/server/statistics', { insecure: c.insecure, headers });
        Object.assign(info, { photos: st.json.photos || 0, videos: st.json.videos || 0, usage: st.json.usage || 0 });
      } catch (e) { info.keyError = e.message; }
      try {
        const d = await getJson(base(c.url) + '/api/server/storage', { insecure: c.insecure, headers });
        if (d.json.diskSizeRaw) info.disk = { used: d.json.diskUseRaw || 0, total: d.json.diskSizeRaw };
      } catch { /* Schlüssel ohne Speicher-Recht */ }
    }
    return { state: 'up', ms: ping.ms, info };
  },
  async nextcloud(c) {
    const st = await getJson(base(c.url) + '/status.php', { insecure: c.insecure });
    if (!st.json || st.json.installed === undefined) return { state: 'down', ms: st.ms, error: 'Antwort ist nicht von Nextcloud', info: {} };
    const info = { version: st.json.versionstring || st.json.version || '', maintenance: !!st.json.maintenance };
    if (c.key) {
      try {
        const r = await getJson(base(c.url) + '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true&skipUpdate=true', { insecure: c.insecure, headers: { 'nc-token': c.key, 'ocs-apirequest': 'true' } });
        const d = (r.json && r.json.ocs && r.json.ocs.data) || {}, nc = d.nextcloud || {};
        info.users = nc.storage && nc.storage.num_users;
        info.files = nc.storage && nc.storage.num_files;
        info.active = d.activeUsers && d.activeUsers.last5minutes;
        if (nc.system && Number.isFinite(Number(nc.system.freespace))) info.free = Number(nc.system.freespace);
      } catch (e) { info.keyError = e.message; }
    }
    return { state: info.maintenance ? 'warn' : 'up', ms: st.ms, info };
  },
  async minecraft(c) {
    const r = await minecraftPing(c.host, c.port);
    const j = r.json || {};
    return { state: 'up', ms: r.ms, info: { players: (j.players && j.players.online) || 0, max: (j.players && j.players.max) || 0,
      version: (j.version && j.version.name) || '', motd: mcText(j.description).slice(0, 120) } };
  },
  async steam(c) {
    const r = await steamQuery(c.host, c.port);
    return { state: 'up', ms: r.ms, info: { players: r.info.players, max: r.info.max, map: r.info.map.slice(0, 60), game: r.info.game.slice(0, 60),
      server: r.info.name.slice(0, 80), version: r.info.version.slice(0, 30), password: r.info.password } };
  },
  async fs25() {
    const feeds = require('./fsfeeds');
    if (!feeds.configured('stats')) return { state: 'down', error: 'Im Farming Hub ist keine Stats-Adresse eingetragen', info: {} };
    const st = feeds.status('stats'), d = st.data;
    const fresh = st.ok_at && now() - st.ok_at < Math.max(180, feeds.interval('stats') * 3);
    if (!fresh || !d) return { state: 'down', error: st.error || 'Der Server antwortet dem Hub nicht', info: {} };
    return { state: 'up', ms: null, info: { players: d.players.length, max: d.capacity, map: d.map, server: d.name, version: d.version } };
  },
};

// ---------- Datenbank ----------
function parse(row) {
  if (!row) return null;
  let config = {}, info = null;
  try { config = JSON.parse(row.config) || {}; } catch { config = {}; }
  try { info = row.info ? JSON.parse(row.info) : null; } catch { info = null; }
  return { ...row, config, info, show: String(row.show_on || '').split(',').filter(k => Object.hasOwn(SHOW, k)) };
}
const all = () => db.prepare('SELECT * FROM services ORDER BY position, id').all().map(parse);
const get = id => parse(db.prepare('SELECT * FROM services WHERE id = ?').get(Number(id)));

// Formular der Seitenverwaltung → Zeile. Leere Schlüsselfelder lassen den gespeicherten Schlüssel stehen.
function fromForm(b, old) {
  const kind = Object.hasOwn(KINDS, b.kind) ? b.kind : old ? old.kind : 'http';
  const K = KINDS[kind], c = {}, oc = (old && old.config) || {};
  if (K.fields.includes('url')) {
    const u = String(b.url || '').trim().slice(0, 500);
    if (!/^https?:\/\/[^\s]+$/i.test(u)) return { error: 'Bitte eine Adresse mit http:// oder https:// eintragen.' };
    c.url = u;
  }
  if (K.fields.includes('host')) {
    const h = String(b.host || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').slice(0, 200);
    if (!h || /[\s/]/.test(h)) return { error: 'Bitte einen Rechner eintragen (Name oder IP-Adresse).' };
    // „host:port“ in einem Feld geht auch
    const m = h.match(/^(.+):(\d{1,5})$/);
    c.host = m && !h.includes(']') && h.split(':').length === 2 ? m[1] : h;
    const p = Math.round(Number(m && h.split(':').length === 2 ? m[2] : b.port) || K.port || 0);
    if (!(p > 0 && p < 65536)) return { error: 'Bitte einen Port zwischen 1 und 65535 eintragen.' };
    c.port = p;
  }
  if (K.fields.includes('key')) {
    if (b.key_clear === '1') c.key = '';
    else c.key = String(b.key || '').trim().slice(0, 500) || oc.key || '';
  }
  if (K.fields.includes('slow')) c.slow = Math.max(100, Math.min(60000, Math.round(Number(b.slow)) || 2000));
  if (K.fields.includes('insecure')) c.insecure = b.insecure === '1';
  if (kind === 'jellyfin') c.details = b.details === '1';
  if (kind === 'immich' || kind === 'nextcloud') c.storage = b.storage === '1';
  const pub = String(b.public_url || '').trim().slice(0, 500);
  if (pub && !/^https?:\/\/[^\s]+$/i.test(pub)) return { error: 'Der Link für Besucher muss mit http:// oder https:// beginnen.' };
  return {
    kind, config: c,
    name: String(b.name || '').trim().slice(0, 60) || K.name,
    icon: String(b.icon || '').trim().slice(0, 8) || K.icon,
    visibility: Object.hasOwn(VIS, b.visibility) ? b.visibility : 'members',
    show_on: [].concat(b.show || []).filter(k => Object.hasOwn(SHOW, k)).join(','),
    public_url: pub || null,
    every: Math.max(MIN_EVERY, Math.min(3600, Math.round(Number(b.every)) || 60)),
    notify_down: b.notify_down === '1' ? 1 : 0,
    enabled: b.enabled === '0' ? 0 : 1,
  };
}
function save(id, b, userId) {
  const old = id ? get(id) : null;
  const v = fromForm(b, old);
  if (v.error) return v;
  const cols = [v.kind, v.name, v.icon, JSON.stringify(v.config), v.visibility, v.show_on, v.public_url, v.every, v.notify_down, v.enabled];
  if (old) {
    db.prepare('UPDATE services SET kind=?, name=?, icon=?, config=?, visibility=?, show_on=?, public_url=?, every=?, notify_down=?, enabled=? WHERE id=?').run(...cols, old.id);
    // Andere Adresse oder Art: der alte Zustand gilt nicht mehr
    if (old.kind !== v.kind || JSON.stringify({ ...old.config, details: 0, storage: 0 }) !== JSON.stringify({ ...v.config, details: 0, storage: 0 })) {
      db.prepare("UPDATE services SET state = 'unknown', state_since = NULL, info = NULL, fails = 0, last_check = NULL WHERE id = ?").run(old.id);
    }
    events.info('Dienste', `„${v.name}“ geändert`, userId);
    return { id: old.id };
  }
  const pos = (db.prepare('SELECT MAX(position) AS p FROM services').get().p || 0) + 1;
  const nid = Number(db.prepare('INSERT INTO services(kind, name, icon, config, visibility, show_on, public_url, every, notify_down, enabled, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(...cols, pos, now()).lastInsertRowid);
  events.info('Dienste', `„${v.name}“ angelegt (${KINDS[v.kind].name})`, userId);
  setTimeout(() => checkOne(nid).catch(() => {}), 50).unref();
  return { id: nid };
}
function remove(id, userId) {
  const s = get(id);
  if (!s) return;
  db.prepare('UPDATE popups SET service_id = NULL WHERE service_id = ?').run(s.id);
  db.prepare('DELETE FROM services WHERE id = ?').run(s.id);
  events.info('Dienste', `„${s.name}“ entfernt`, userId);
}
function move(id, dir) {
  const list = all(), i = list.findIndex(s => s.id === Number(id)), j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const upd = db.prepare('UPDATE services SET position = ? WHERE id = ?');
  list.forEach((s, n) => upd.run(n + 1, s.id));
}

// ---------- Abfragen ----------
async function probe(kind, config) {
  const fn = CHECKS[kind];
  if (!fn) return { state: 'down', error: 'Unbekannte Art', info: {} };
  try { return await fn(config); } catch (e) { return { state: 'down', ms: e.ms || null, error: e.message || String(e), info: {} }; }
}
// „Jetzt testen“ im Formular: prüft mit den eingegebenen Werten, ohne zu speichern
async function test(b, id) {
  const v = fromForm(b, id ? get(id) : null);
  if (v.error) return { state: 'down', error: v.error };
  return probe(v.kind, v.config);
}

const running = new Set();
async function checkOne(id) {
  if (running.has(id)) return null;
  const s = get(id);
  if (!s) return null;
  running.add(id);
  try {
    const r = await probe(s.kind, s.config);
    record(s, r);
    return r;
  } finally { running.delete(id); }
}
// Ergebnis speichern. Offline gilt ein Dienst erst nach zwei Fehlschlägen hintereinander (ein Aussetzer ist kein Ausfall),
// außer er war noch nie geprüft.
function record(s, r, t = now()) {
  const fails = r.state === 'down' ? (s.fails || 0) + 1 : 0;
  let state = r.state;
  if (state === 'down' && fails < 2 && s.state !== 'unknown' && s.state !== 'down') state = s.state;
  const changed = state !== s.state;
  const info = r.state === 'down' ? { ...(s.info || {}), error: r.error || 'keine Antwort' } : { ...(r.info || {}) };
  if (r.state !== 'down') delete info.error;
  db.prepare('UPDATE services SET state = ?, state_since = ?, info = ?, last_check = ?, last_ms = ?, fails = ? WHERE id = ?')
    .run(state, changed ? t : s.state_since || t, JSON.stringify(info), t, Number.isFinite(r.ms) ? Math.round(r.ms) : null, fails, s.id);
  db.prepare('INSERT INTO service_checks(service_id, at, state, ms) VALUES (?, ?, ?, ?)').run(s.id, t, r.state, Number.isFinite(r.ms) ? Math.round(r.ms) : null);
  if (changed) announce(s, s.state, state, r.error);
}
function announce(s, from, to, error) {
  const notify = require('./notify');
  if (to === 'down') {
    events.warn('Dienste', `„${s.name}“ antwortet nicht: ${error || 'keine Antwort'}`);
    if (s.notify_down) notify.toAdmins(`🔴 ${s.name} ist offline`, error || 'keine Antwort', `/admin/dienste/${s.id}`, 'admin:dienst-' + s.id);
  } else if (from === 'down' && (to === 'up' || to === 'warn')) {
    events.info('Dienste', `„${s.name}“ ist wieder erreichbar`);
    if (s.notify_down) notify.toAdmins(`🟢 ${s.name} ist wieder online`, 'Der Dienst antwortet wieder.', `/admin/dienste/${s.id}`, 'admin:dienst-' + s.id);
    // „Sag Bescheid“: einmal benachrichtigen, dann ist die Liste leer
    const fresh = get(s.id);
    for (const w of db.prepare('SELECT user_id FROM service_watch WHERE service_id = ?').all(s.id)) {
      const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(w.user_id);
      if (u && canSee({ id: u.id, isAdmin: u.role === 'admin' }, fresh)) notify.send(u.id, 'dienste', { key: 'dienst-' + s.id, title: `🟢 ${s.name} ist wieder online`, body: summary(fresh, false), url: '/dienste' });
    }
    db.prepare('DELETE FROM service_watch WHERE service_id = ?').run(s.id);
  } else if (to === 'warn' && from === 'up') {
    events.info('Dienste', `„${s.name}“ antwortet langsam`);
  }
}

let timer = null, lastPrune = 0;
function tick() {
  const t = now();
  for (const s of db.prepare('SELECT id, every, last_check FROM services WHERE enabled = 1').all()) {
    if (!s.last_check || t - s.last_check >= Math.max(MIN_EVERY, s.every)) checkOne(s.id).catch(() => {});
  }
  if (t - lastPrune > 3600) { lastPrune = t; db.prepare('DELETE FROM service_checks WHERE at < ?').run(t - KEEP_DAYS * 86400); }
}
function start() {
  if (timer) return;
  timer = setInterval(tick, 10000);
  timer.unref();
  setTimeout(tick, 3000).unref();
}
async function checkAll() { await Promise.all(all().filter(s => s.enabled).map(s => checkOne(s.id))); }

// ---------- Anzeige ----------
const fmtN = n => Number(n || 0).toLocaleString('de-DE');
function fmtBytes(b) {
  if (!Number.isFinite(b)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1024; i++; }
  return (b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1).replace('.', ',')) + ' ' + u[i];
}
function since(t) {
  if (!t) return '';
  const d = new Date(t * 1000), today = new Date();
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Berlin' });
  return d.toDateString() === today.toDateString() ? 'seit ' + hm : 'seit ' + d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: process.env.TZ || 'Europe/Berlin' }) + ' ' + hm;
}
// Kurzinfo hinter dem Namen: für Besucher knapp, für den Admin mit Version und Antwortzeit
function summary(s, admin) {
  const i = s.info || {};
  if (!s.enabled) return 'pausiert';
  if (s.state === 'unknown') return 'wird geprüft …';
  if (s.state === 'down') return 'offline ' + since(s.state_since) + (admin && i.error ? ' · ' + i.error : '');
  const parts = [];
  switch (s.kind) {
    case 'jellyfin': parts.push(i.watching ? `${i.watching} ${i.watching === 1 ? 'schaut' : 'schauen'} gerade` : 'online'); break;
    case 'immich': parts.push(i.photos != null ? `${fmtN(i.photos)} Fotos` + (i.videos ? `, ${fmtN(i.videos)} Videos` : '') : 'online'); break;
    case 'nextcloud': parts.push(i.maintenance ? 'Wartungsmodus' : i.active ? `online · ${i.active} gerade aktiv` : 'online'); break;
    case 'minecraft': case 'steam': case 'fs25':
      parts.push(`${i.players || 0} / ${i.max || 0} Spieler`);
      if (i.map && s.kind !== 'minecraft') parts.push(i.map);
      break;
    default: parts.push(s.state === 'warn' ? 'langsam' : 'online');
  }
  if (admin) {
    if (i.version) parts.push(i.version);
    if (s.last_ms != null) parts.push(s.last_ms + ' ms');
    if (i.keyError) parts.push('Schlüssel: ' + i.keyError);
  }
  return parts.join(' · ');
}
function canSee(user, s) {
  if (!s || !s.enabled) return !!(user && user.isAdmin) && !!s;
  return s.visibility === 'public' || (s.visibility === 'members' && !!user) || !!(user && user.isAdmin);
}
// Balken der letzten Stunden: je Stunde der schlechteste Zustand (down > warn > up), n = keine Abfrage
function bars(id, hours = 24, t = now()) {
  const from = t - hours * 3600;
  const rows = db.prepare('SELECT at, state FROM service_checks WHERE service_id = ? AND at >= ?').all(id, from);
  const out = Array(hours).fill('n'), rank = { n: 0, up: 1, warn: 2, down: 3 };
  for (const r of rows) {
    const i = Math.min(hours - 1, Math.floor((r.at - from) / 3600));
    if (rank[r.state] > rank[out[i]]) out[i] = r.state;
  }
  return out;
}
// Verfügbarkeit in Prozent über einen Zeitraum
function uptime(id, sec = 7 * 86400, t = now()) {
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(state != 'down'), 0) AS ok FROM service_checks WHERE service_id = ? AND at >= ?").get(id, t - sec);
  return r.n ? Math.round(r.ok / r.n * 1000) / 10 : null;
}
// Für Besucher: nur Name, Zustand, Kurzinfo, öffentlicher Link. where: home | widget | ticker | tray
function forViewer(user, where = null) {
  const watched = user ? new Set(db.prepare('SELECT service_id FROM service_watch WHERE user_id = ?').all(user.id).map(r => r.service_id)) : new Set();
  return all().filter(s => s.enabled && canSee(user, s) && (!where || s.show.includes(where))).map(s => ({
    id: s.id, name: s.name, icon: s.icon, state: s.state, since: s.state_since, text: summary(s, false), url: s.public_url || null,
    show: s.show, watching: watched.has(s.id),
  }));
}
function watch(user, id, on) {
  const s = get(id);
  if (!user || !s || !canSee(user, s)) return false;
  if (on) db.prepare('INSERT OR IGNORE INTO service_watch(service_id, user_id, created_at) VALUES (?, ?, ?)').run(s.id, user.id, now());
  else db.prepare('DELETE FROM service_watch WHERE service_id = ? AND user_id = ?').run(s.id, user.id);
  return true;
}
// Wie viel „braucht dich“: Dienste, die gerade offline sind
const downCount = () => db.prepare("SELECT COUNT(*) AS n FROM services WHERE enabled = 1 AND state = 'down'").get().n;

// ---------- Belegter Speicher ----------
// Platten, die der Container sieht (statfs): Daten, Downloads usw. Liegen zwei Ordner auf derselben Platte, zählt sie einmal.
const DIRS = [['daten', DATA_DIR, 'Server'], ['downloads', UPLOAD_DIR, 'Downloads'], ['musik', MUSIC_DIR, 'Mediaplayer'], ['bilder', MEDIA_DIR, 'Bilder'],
  ['paint', PAINT_DIR, 'Paint'], ['apps', APPS_DIR, 'Apps']];
function diskConfig() {
  try { return JSON.parse(getSetting('svc_disks', '') || '{}') || {}; } catch { return {}; }
}
function disks() {
  const cfg = diskConfig(), seen = new Map(), out = [];
  for (const [key, dir, label] of DIRS) {
    let st, dev;
    try { dev = fs.statSync(dir).dev; st = fs.statfsSync(dir); } catch { continue; }
    const total = st.blocks * st.bsize, free = st.bavail * st.bsize;
    const sig = dev + ':' + total;
    if (seen.has(sig)) { seen.get(sig).dirs.push(label); continue; }
    const c = cfg[key] || {};
    const d = { key, label: String(c.label || label).slice(0, 40), on: c.on !== false, total, free, used: Math.max(0, total - free), dirs: [label] };
    seen.set(sig, d);
    out.push(d);
  }
  return out;
}
const canSeeStorage = user => getSetting('svc_storage', '1') === '1' && (() => {
  const f = getSetting('svc_storage_for', 'members');
  return f === 'public' || (f === 'members' && !!user) || !!(user && user.isAdmin);
})();
// Liste für Widget, Startseite und Übersicht: { label, used, total, free, pct }
function storage(user, { all: everything = false } = {}) {
  if (!everything && !canSeeStorage(user)) return null;
  const out = disks().filter(d => d.on).map(d => ({ label: d.label, used: d.used, total: d.total, free: d.free }));
  for (const s of all()) {
    if (!s.enabled || !s.config.storage || !s.info || s.state === 'down' || (!everything && !canSee(user, s))) continue;
    if (s.info.disk && s.info.disk.total) out.push({ label: s.name, used: s.info.disk.used, total: s.info.disk.total, free: s.info.disk.total - s.info.disk.used });
    else if (Number.isFinite(s.info.free)) out.push({ label: s.name, free: s.info.free });
  }
  return out.map(d => ({ ...d, pct: d.total ? Math.round(d.used / d.total * 100) : null, usedText: fmtBytes(d.used), totalText: fmtBytes(d.total), freeText: fmtBytes(d.free) }));
}

module.exports = {
  KINDS, STATES, VIS, SHOW, CHECKS, all, get, save, remove, move, probe, test, checkOne, checkAll, record, start, tick,
  summary, canSee, bars, uptime, forViewer, watch, downCount, disks, diskConfig, storage, canSeeStorage, fmtBytes, since,
  // für Tests
  varint, readVarint, parseA2S, minecraftPing, steamQuery, httpGet,
};
