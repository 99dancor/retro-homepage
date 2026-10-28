'use strict';
// Farming Simulator Hub: holt die Daten des Spieleservers ab. Alles läuft auf dem Server der Website, kein Browser sieht
// Adressen, Codes oder FTP-Zugang (Seitenverwaltung → Farming Simulator, wie das SMTP-Passwort).
//
//   Webinterface (HTTP): Stats (live: Uhrzeit, Spieler, Mods, Grundstücke, Fahrzeuge), Savegame (careerSavegame),
//                        Vehicles (Farm, Preis, Verschleiß), Economy (Preise, große Nachfragen), Map Image (Kartenbild)
//   FTP (z. B. GPORTAL): farms.xml (Geld je Hof), placeables.xml (Silos, Produktionen, Ställe), items.xml (Ballen),
//                        environment.xml (Datum, Wetter). Ist eine Webinterface-Adresse leer, liest er careerSavegame.xml,
//                        vehicles.xml und economy.xml auch von dort. Die Dateien sind so aktuell wie der letzte Autosave.
//
// Jeder Zugang hat seinen eigenen Abstand. Klappt ein Abruf nicht, wartet er länger (bis 10 Minuten) und behält den
// letzten Stand. Der Stand jedes Zugangs liegt ausgelesen in fs_cache, damit nach einem Neustart sofort etwas da ist.
const fs = require('node:fs');
const path = require('node:path');
const { Writable } = require('node:stream');
const { db, now, getSetting, DATA_DIR } = require('./db');
const X = require('./fsxml');

const FS_DIR = path.join(DATA_DIR, 'fshub');
fs.mkdirSync(FS_DIR, { recursive: true });
const MAP_FILE = path.join(FS_DIR, 'map-server');

// Zugänge: Schlüssel, Name, Vorgabe-Abstand in Sekunden, kleinster Abstand
const FEEDS = {
  stats: { name: 'Stats', every: 30, min: 10, hint: 'dedicated-server-stats.xml' },
  savegame: { name: 'Savegame', every: 300, min: 30, hint: 'dedicated-server-savegame.html?…&file=careerSavegame' },
  vehicles: { name: 'Vehicles', every: 300, min: 30, hint: 'Vehicles-Adresse aus dem Webinterface' },
  economy: { name: 'Economy', every: 3600, min: 60, hint: 'Economy-Adresse aus dem Webinterface' },
  map: { name: 'Map Image', every: 86400, min: 600, hint: 'dedicated-server-stats-map.jpg' },
  ftp: { name: 'FTP', every: 300, min: 60, hint: 'Savegame-Ordner beim Hoster' },
};
const FTP_FILES = ['farms.xml', 'placeables.xml', 'items.xml', 'environment.xml'];
// Diese drei liest der FTP-Abruf zusätzlich, wenn die Webinterface-Adresse dafür leer ist
const FTP_FALLBACK = { savegame: 'careerSavegame.xml', vehicles: 'vehicles.xml', economy: 'economy.xml' };
const TIMEOUT = 15000;
const MAX_BYTES = 30 * 1024 * 1024;

const url = key => (getSetting('fs_url_' + key, '') || '').trim();
function interval(key) {
  const f = FEEDS[key];
  const v = Math.round(Number(getSetting('fs_int_' + key, '')));
  return Math.max(f.min, Number.isFinite(v) && v > 0 ? v : f.every);
}
function ftpConfig() {
  return {
    host: (getSetting('fs_ftp_host', '') || '').trim(), port: Number(getSetting('fs_ftp_port', '21')) || 21,
    user: getSetting('fs_ftp_user', '') || '', password: getSetting('fs_ftp_pass', '') || '',
    dir: (getSetting('fs_ftp_path', '') || '').trim() || '/', secure: getSetting('fs_ftp_secure', '0'),
  };
}
const configured = key => (key === 'ftp' ? !!ftpConfig().host : !!url(key));

// ---------- Auslesen ----------
const num = X.num;
const xyz = s => { const p = String(s || '').trim().split(/\s+/).map(Number); return p.length >= 3 && p.every(Number.isFinite) ? p : null; };
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function readStats(xml) {
  const s = X.parse(xml);
  if (s.n !== 'Server') throw new Error('Das ist keine Stats-Datei (kein <Server>).');
  const slots = X.kid(s, 'Slots');
  const fillPairs = (types, levels) => {
    const t = String(types || '').trim().split(/\s+/), l = String(levels || '').trim().split(/\s+/).map(Number);
    return t.map((k, i) => [k, l[i] || 0]).filter(([k, v]) => k && k !== 'UNKNOWN' && k !== 'AIR' && v > 0.01).map(([k, v]) => [k, round(v)]);
  };
  return {
    name: s.a.name || '', version: s.a.version || '', game: s.a.game || '', map: s.a.mapName || '', mapSize: num(s.a.mapSize, 2048),
    dayTime: num(s.a.dayTime), capacity: num(slots && slots.a.capacity, 0),
    players: X.kids(slots, 'Player').filter(p => p.a.isUsed === 'true' && p.t).map(p => ({
      name: p.t, admin: p.a.isAdmin === 'true', uptime: num(p.a.uptime, 0), x: num(p.a.x), z: num(p.a.z),
    })),
    mods: X.all(s, 'Mod').map(m => ({ name: m.a.name || '', title: m.t || m.a.name || '', author: m.a.author || '', version: m.a.version || '', hash: m.a.hash || '' })),
    farmlands: X.all(s, 'Farmland').map(f => ({ id: num(f.a.id), name: f.a.name || f.a.id, owner: num(f.a.owner, 0), area: num(f.a.area, 0), price: num(f.a.price, 0), x: num(f.a.x), z: num(f.a.z) })),
    fields: X.all(s, 'Field').map(f => ({ id: num(f.a.id), x: num(f.a.x), z: num(f.a.z), owned: f.a.isOwned === 'true' })),
    vehicles: X.all(s, 'Vehicle').map(v => ({
      name: v.a.name || '', category: v.a.category || '', type: v.a.type || '', x: num(v.a.x), y: num(v.a.y), z: num(v.a.z),
      fill: fillPairs(v.a.fillTypes, v.a.fillLevels), ai: v.a.isAIActive === 'true', controller: v.a.controller || null,
    })),
  };
}
function readSavegame(xml) {
  const s = X.parse(xml);
  if (s.n !== 'careerSavegame') throw new Error('Das ist keine careerSavegame-Datei.');
  const st = (...p) => X.text(s, 'settings', ...p);
  return {
    title: st('savegameName') || '', mapTitle: st('mapTitle') || '', saveDate: st('saveDate') || '', created: st('creationDate') || '',
    timeScale: num(st('timeScale'), 1), daysPerPeriod: num(st('plannedDaysPerPeriod'), 1), difficulty: st('economicDifficulty') || '',
    growthMode: num(st('growthMode')), autoSave: num(st('autoSaveInterval')), fuelUsage: num(st('fuelUsage')),
    money: num(X.text(s, 'statistics', 'money')), playTime: num(X.text(s, 'statistics', 'playTime')),
  };
}
function readVehicles(xml) {
  const s = X.parse(xml);
  if (s.n !== 'vehicles') throw new Error('Das ist keine Vehicles-Datei (kein <vehicles>).');
  return X.kids(s, 'vehicle').map(v => {
    const comp = X.kids(v, 'component').find(c => c.a.index === '1') || X.kid(v, 'component');
    const pos = xyz(comp && comp.a.position) || [null, null, null];
    const dirt = X.all(v, 'dirtNode').map(d => num(d.a.amount, 0));
    const wear = X.kid(v, 'wearable');
    return {
      file: v.a.filename || '', uid: v.a.uniqueId || '', farmId: num(v.a.farmId, 0), price: num(v.a.price, 0), age: num(v.a.age, 0),
      hours: round(num(v.a.operatingTime, 0) / 3600), damage: wear ? round(num(wear.a.damage, 0), 3) : null,
      dirt: dirt.length ? round(dirt.reduce((a, b) => a + b, 0) / dirt.length, 2) : null, state: v.a.propertyState || '',
      x: pos[0], y: pos[1], z: pos[2], pallet: !!X.kid(v, 'pallet') || /pallet|bigbag|ibc/i.test(v.a.filename || ''),
      fill: X.all(v, 'unit').filter(u => u.a.fillType && u.a.fillType !== 'UNKNOWN' && u.a.fillType !== 'AIR' && num(u.a.fillLevel, 0) > 0.01)
        .map(u => [u.a.fillType, round(num(u.a.fillLevel, 0))]),
    };
  });
}
function readEconomy(xml) {
  const s = X.parse(xml);
  if (s.n !== 'economy') throw new Error('Das ist keine Economy-Datei (kein <economy>).');
  const P = require('./fsnames').PERIODS;
  const prices = {};
  for (const f of X.all(s, 'fillType')) {
    const h = X.kid(f, 'history');
    if (!h || !f.a.fillType) continue;
    const row = P.map(p => { const e = X.kids(h, 'period').find(x => x.a.period === p); return e ? num(e.t, null) : null; });
    if (row.some(v => v !== null && v > 0)) prices[f.a.fillType] = row;
  }
  return {
    demands: X.all(s, 'greatDemand').filter(d => d.a.isValid !== 'false').map(d => ({
      fill: d.a.fillTypeName || '', mult: num(d.a.demandMultiplier, 1), day: num(d.a.demandStartDay), hour: num(d.a.demandStartHour, 0),
      hours: num(d.a.demandDuration, 0), running: d.a.isRunning === 'true', place: d.a.uniqueId || '',
    })),
    prices,
  };
}
// farms.xml: Geld, Kredit, Spieler und Finanzen je Hof
function readFarms(xml) {
  const s = X.parse(xml);
  return X.all(s, 'farm').filter(f => f.a.farmId).map(f => {
    const fin = X.kid(f, 'finances');
    const days = X.kids(fin, 'stats').map(st => {
      const out = { day: num(st.a.day, 0), v: {} };
      for (const c of st.c) { const v = num(c.t); if (v !== null && v !== 0) out.v[c.n] = round(v, 2); }
      return out;
    });
    return {
      id: num(f.a.farmId), name: f.a.name || '', color: num(f.a.color), money: num(f.a.money), loan: num(f.a.loan, 0),
      players: X.all(f, 'player').map(p => ({ name: p.a.lastNickname || p.a.nickname || '', manager: p.a.farmManager === 'true' })).filter(p => p.name),
      finances: days,
    };
  });
}
// placeables.xml: alles mit Füllständen (Silos, Produktionen, Lager) und Tieren. Jeder Füllstand gehört zu dem Bereich,
// in dem er steht (silo, productionPoint, husbandryFood …), so lässt sich Futter von Lager unterscheiden.
function readPlaceables(xml) {
  const s = X.parse(xml);
  const out = [];
  for (const p of X.all(s, 'placeable')) {
    const fills = [], animals = [], productions = [];
    for (const sec of p.c) {
      for (const el of X.walk(sec)) {
        const ft = el.a.fillType || el.a.fillTypeName;
        const lvl = num(el.a.fillLevel ?? el.a.amount);
        if (ft && lvl !== null && ft !== 'UNKNOWN') fills.push([sec.n, ft, round(lvl)]);
        if (el.a.numAnimals !== undefined || (el.n === 'animal' && (el.a.subType || el.a.subTypeName))) {
          animals.push([el.a.subType || el.a.subTypeName || el.a.type || 'ANIMAL', num(el.a.numAnimals, 1)]);
        }
        if (el.n === 'production' && el.a.id) productions.push({ id: el.a.id, on: el.a.isEnabled !== 'false' });
      }
    }
    if (!fills.length && !animals.length && !productions.length) continue;
    const pos = xyz(p.a.position);
    const secs = new Set(p.c.map(c => c.n));
    const kind = [...secs].some(n => /^husbandry/i.test(n)) ? 'husbandry' : secs.has('productionPoint') ? 'production'
      : [...secs].some(n => /silo|storage/i.test(n)) ? 'silo' : 'other';
    out.push({ farmId: num(p.a.farmId, 0), name: p.a.name || '', file: p.a.filename || '', x: pos && pos[0], z: pos && pos[2], kind, fills, animals, productions });
  }
  return out;
}
// items.xml: Ballen und andere lose Dinge mit Füllstand
function readItems(xml) {
  const s = X.parse(xml);
  const out = [];
  for (const el of X.walk(s)) {
    const ft = el.a.fillType || el.a.fillTypeName;
    if (!ft || el.a.farmId === undefined || num(el.a.fillLevel) === null) continue;
    const pos = xyz(el.a.position) || [num(el.a.posX), 0, num(el.a.posZ)];
    out.push({ farmId: num(el.a.farmId, 0), fill: ft, level: round(num(el.a.fillLevel, 0)), kind: el.a.className || el.n, x: pos[0], z: pos[2] });
  }
  return out;
}
// environment.xml: Spieltag, Uhrzeit und Wettervorhersage
function readEnvironment(xml) {
  const s = X.parse(xml);
  const t = n => num(X.text(s, n));
  return {
    day: t('currentMonotonicDay') ?? t('currentDay'), dayTime: t('dayTime'), daysPerPeriod: t('daysPerPeriod'),
    weather: X.all(s, 'instance').map(w => ({ type: w.a.typeName || w.a.type || '', day: num(w.a.startDay), time: num(w.a.startDayTime, 0), duration: num(w.a.duration, 0) }))
      .filter(w => w.type),
  };
}
const READ = { stats: readStats, savegame: readSavegame, vehicles: readVehicles, economy: readEconomy };

// ---------- Zwischenspeicher ----------
const cache = new Map();   // key → { data, ok_at, tried_at, error, fails }
const listeners = [], errorListeners = [];
function load() {
  for (const r of db.prepare('SELECT * FROM fs_cache').all()) {
    let data = null;
    try { data = JSON.parse(r.data); } catch { data = null; }
    cache.set(r.feed, { data, ok_at: r.ok_at, tried_at: r.tried_at, error: r.error, fails: 0, info: r.info ? JSON.parse(r.info) : null });
  }
}
function store(key, patch) {
  const c = { ...(cache.get(key) || { data: null, ok_at: null, tried_at: null, error: null, fails: 0, info: null }), ...patch };
  cache.set(key, c);
  db.prepare(`INSERT INTO fs_cache(feed, data, ok_at, tried_at, error, info) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(feed) DO UPDATE SET data = excluded.data, ok_at = excluded.ok_at, tried_at = excluded.tried_at, error = excluded.error, info = excluded.info`)
    .run(key, c.data === null ? null : JSON.stringify(c.data), c.ok_at, c.tried_at, c.error, c.info ? JSON.stringify(c.info) : null);
  return c;
}
const get = key => (cache.get(key) || {}).data || null;
const status = key => cache.get(key) || { data: null, ok_at: null, tried_at: null, error: null, fails: 0 };
function on(fn) { listeners.push(fn); }
function onError(fn) { errorListeners.push(fn); }
function changed(key, prev) { for (const fn of listeners) { try { fn(key, prev); } catch (e) { console.error('Farming Hub:', e); } } }
function forget(key) {
  db.prepare('DELETE FROM fs_cache WHERE feed = ?').run(key);
  cache.delete(key);
  if (key === 'map') fs.rm(MAP_FILE, { force: true }, () => {});
  changed(key, null);
}

// ---------- Abrufen ----------
function friendly(e) {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'Zeitüberschreitung: Der Server hat nicht rechtzeitig geantwortet.';
  const c = e.cause && (e.cause.code || e.cause.message);
  if (c === 'ECONNREFUSED') return 'Verbindung abgelehnt (läuft der Server, stimmt der Port?).';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'Adresse nicht gefunden.';
  if (c === 'ETIMEDOUT' || c === 'ECONNRESET') return 'Keine Verbindung zum Server.';
  return e.message || String(e);
}
async function download(u) {
  const res = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': 'retro-homepage farming-hub' } });
  if (!res.ok) throw new Error(`Der Server antwortet mit HTTP ${res.status}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Die Antwort ist zu groß.');
  return buf;
}
const isImage = b => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) || b.slice(0, 4).toString() === 'RIFF';
// Größe eines JPEG oder PNG, damit die Karte weiß, wie sie es ausschneidet
function imageSize(b) {
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

async function runHttp(key) {
  const buf = await download(url(key));
  if (key === 'map') {
    if (!isImage(buf)) throw new Error('Das ist kein Bild (JPEG oder PNG erwartet).');
    fs.writeFileSync(MAP_FILE, buf);
    const size = imageSize(buf);
    return { data: { bytes: buf.length, at: now(), ...size }, info: { summary: `Bild ${size ? size.w + ' × ' + size.h + ' Pixel, ' : ''}${Math.round(buf.length / 1024)} KB` } };
  }
  const data = READ[key](buf.toString('utf8'));
  return { data, info: { summary: summarize(key, data) } };
}

// FTP: Ordner auflisten und nur geänderte Dateien holen (Größe oder Zeit anders als beim letzten Mal)
async function runFtp(force = false) {
  const ftp = require('basic-ftp');
  const cfg = ftpConfig();
  const client = new ftp.Client(TIMEOUT);
  const prev = status('ftp');
  const files = { ...((prev.data && prev.data.files) || {}) };
  const seen = { ...((prev.info && prev.info.seen) || {}) };
  const wanted = [...FTP_FILES, ...Object.entries(FTP_FALLBACK).filter(([k]) => !url(k)).map(([, f]) => f)];
  const notes = [];
  try {
    await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
      secure: cfg.secure === '1' || cfg.secure === '2', secureOptions: cfg.secure === '2' ? { rejectUnauthorized: false } : undefined });
    const list = await client.list(cfg.dir);
    const byName = new Map(list.filter(f => f.isFile).map(f => [f.name, f]));
    for (const name of wanted) {
      const f = byName.get(name);
      if (!f) { notes.push(`${name} fehlt`); delete files[name]; continue; }
      const sig = `${f.size}:${f.rawModifiedAt || ''}`;
      if (!force && seen[name] === sig && files[name] !== undefined) continue;
      if (f.size > MAX_BYTES) { notes.push(`${name} ist zu groß`); continue; }
      const chunks = [];
      await client.downloadTo(new Writable({ write(c, e, cb) { chunks.push(c); cb(); } }), path.posix.join(cfg.dir, name));
      const xml = Buffer.concat(chunks).toString('utf8');
      try {
        files[name] = readFtpFile(name, xml);
        seen[name] = sig;
      } catch (e) { notes.push(`${name}: ${e.message}`); }
    }
  } finally { client.close(); }
  const data = { files, at: now() };
  return { data, info: { seen, notes, summary: summarizeFtp(files, notes) } };
}
function readFtpFile(name, xml) {
  switch (name) {
    case 'farms.xml': return readFarms(xml);
    case 'placeables.xml': return readPlaceables(xml);
    case 'items.xml': return readItems(xml);
    case 'environment.xml': return readEnvironment(xml);
    case 'careerSavegame.xml': return readSavegame(xml);
    case 'vehicles.xml': return readVehicles(xml);
    case 'economy.xml': return readEconomy(xml);
    default: return null;
  }
}

function summarize(key, d) {
  if (key === 'stats') return `${d.name || 'Server'} · ${d.map} · ${d.players.length}/${d.capacity} Spieler · ${d.mods.length} Mods · ${d.farmlands.length} Grundstücke · ${d.fields.length} Felder · ${d.vehicles.length} Fahrzeuge`;
  if (key === 'savegame') return `Zeitfaktor ×${d.timeScale} · ${d.daysPerPeriod} ${d.daysPerPeriod === 1 ? 'Tag' : 'Tage'} pro Monat · Geld ${Math.round(d.money || 0).toLocaleString('de-DE')} €`;
  if (key === 'vehicles') {
    const farms = {};
    for (const v of d) farms[v.farmId] = (farms[v.farmId] || 0) + 1;
    return `${d.length} Einträge · ` + Object.entries(farms).map(([f, n]) => `Farm ${f}: ${n}`).join(', ');
  }
  if (key === 'economy') return `${Object.keys(d.prices).length} Waren mit Preisen · ${d.demands.length} große Nachfragen`;
  return '';
}
function summarizeFtp(files, notes) {
  const parts = [];
  const f = files['farms.xml'];
  if (f) parts.push(`farms.xml: ${f.length} ${f.length === 1 ? 'Hof' : 'Höfe'}`);
  const p = files['placeables.xml'];
  if (p) parts.push(`placeables.xml: ${p.length} Gebäude mit Inhalt`);
  const i = files['items.xml'];
  if (i) parts.push(`items.xml: ${i.length} Ballen und Gegenstände`);
  const e = files['environment.xml'];
  if (e) parts.push(`environment.xml: Tag ${e.day ?? '?'}`);
  for (const [k, n] of Object.entries(FTP_FALLBACK)) if (files[n]) parts.push(`${n} statt ${FEEDS[k].name}-Adresse`);
  return parts.concat(notes).join(' · ');
}

const running = new Set();
const nextAt = new Map();
async function run(key, { force = false } = {}) {
  if (running.has(key) || !configured(key)) return status(key);
  running.add(key);
  const prev = get(key);
  const t = now();
  try {
    const r = key === 'ftp' ? await runFtp(force) : await runHttp(key);
    const c = store(key, { data: r.data, info: r.info, ok_at: t, tried_at: t, error: null, fails: 0 });
    nextAt.set(key, Date.now() + interval(key) * 1000);
    changed(key, prev);
    return c;
  } catch (e) {
    const fails = (status(key).fails || 0) + 1;
    const c = store(key, { tried_at: t, error: friendly(e), fails });
    nextAt.set(key, Date.now() + Math.min(600, interval(key) * 2 ** Math.min(fails, 6)) * 1000);
    for (const fn of errorListeners) { try { fn(key, c); } catch (err) { console.error('Farming Hub:', err); } }
    return c;
  } finally { running.delete(key); }
}
// Alle eingetragenen Zugänge sofort (Seitenverwaltung → „Alle testen“)
async function runAll() {
  const keys = Object.keys(FEEDS).filter(configured);
  await Promise.all(keys.map(k => run(k, { force: true })));
  return keys;
}
function tick() {
  const t = Date.now();
  for (const key of Object.keys(FEEDS)) {
    if (!configured(key) || running.has(key)) continue;
    if (!nextAt.has(key)) {
      // Nach dem Start: was länger her ist als sein Abstand, gleich holen
      const ok = status(key).ok_at;
      nextAt.set(key, ok && (now() - ok) < interval(key) ? (ok + interval(key)) * 1000 : t);
    }
    if (nextAt.get(key) <= t) run(key);
  }
}
let timer = null;
function start() {
  load();
  if (!timer) { timer = setInterval(tick, 5000); timer.unref(); setTimeout(tick, 2000).unref(); }
}
// Nach dem Ändern einer Adresse oder eines Abstands sofort neu planen
function reschedule(key) { nextAt.delete(key); }

module.exports = {
  FEEDS, FTP_FILES, FTP_FALLBACK, MAP_FILE, FS_DIR, url, interval, ftpConfig, configured, get, status, on, onError, run, runAll, start, reschedule, forget,
  readStats, readSavegame, readVehicles, readEconomy, readFarms, readPlaceables, readItems, readEnvironment, imageSize, load,
};
