'use strict';
// Farming Simulator Hub: holt die Daten des Spieleservers ab. Alles läuft auf dem Server der Website, kein Browser sieht
// Adressen, Codes oder FTP-Zugang (Seitenverwaltung → Farming Simulator, wie das SMTP-Passwort).
//
//   Webinterface (HTTP): Stats (live: Uhrzeit, Spieler, Mods, Grundstücke, Fahrzeuge), Savegame (careerSavegame),
//                        Vehicles (Farm, Preis, Verschleiß), Economy (Preise, große Nachfragen), Map Image (Kartenbild)
//   FTP (z. B. GPORTAL): farms.xml (Geld je Hof), placeables.xml (Silos, Produktionen, Ställe), items.xml (Ballen),
//                        environment.xml (Datum, Wetter), fields.xml (Frucht, Wachstum und Boden je Feld),
//                        bankCredit.xml (Kredite aus dem Mod „Bank Credit“, wenn vorhanden), densityMap_ground.gdm und die
//                        Kalk-, Dünger- und Pflug-Ebenen (echte Feldformen, src/fsmap.js). Ist eine Webinterface-Adresse leer, liest er careerSavegame.xml,
//                        vehicles.xml und economy.xml auch von dort. Die Dateien sind so aktuell wie der letzte Autosave.
//                        Aus der Karten-Mod im mods-Ordner liest er die Feldumrisse (map.i3d, src/fsfields.js), ohne die
//                        ganze Mod herunterzuladen. Wird ein anderer Ordner eingetragen, holt er alles neu.
//
// Jeder Zugang hat seinen eigenen Abstand. Klappt ein Abruf nicht, wartet er länger (bis 10 Minuten) und behält den
// letzten Stand. Der Stand jedes Zugangs liegt ausgelesen in fs_cache, damit nach einem Neustart sofort etwas da ist.
const fs = require('node:fs');
const path = require('node:path');
const { Writable } = require('node:stream');
const { db, now, getSetting, DATA_DIR } = require('./db');
const X = require('./fsxml');
const fsfields = require('./fsfields');

const FS_DIR = path.join(DATA_DIR, 'fshub');
fs.mkdirSync(FS_DIR, { recursive: true });
const MAP_FILE = path.join(FS_DIR, 'map-server');
// Feldumrisse aus der Karte: { source: ftp | upload, mod, mapTitle, sig, entry, at, polys }
const OUTLINES = path.join(FS_DIR, 'map-fields.json');

// Zugänge: Schlüssel, Name, Vorgabe-Abstand in Sekunden, kleinster Abstand
const FEEDS = {
  stats: { name: 'Stats', every: 30, min: 10, hint: 'dedicated-server-stats.xml' },
  savegame: { name: 'Savegame', every: 300, min: 30, hint: 'dedicated-server-savegame.html?…&file=careerSavegame' },
  vehicles: { name: 'Vehicles', every: 300, min: 30, hint: 'Vehicles-Adresse aus dem Webinterface' },
  economy: { name: 'Economy', every: 3600, min: 60, hint: 'Economy-Adresse aus dem Webinterface' },
  map: { name: 'Map Image', every: 86400, min: 600, hint: 'dedicated-server-stats-map.jpg' },
  ftp: { name: 'FTP', every: 300, min: 60, hint: 'Savegame-Ordner beim Hoster' },
};
const FTP_FILES = ['farms.xml', 'placeables.xml', 'items.xml', 'environment.xml', 'fields.xml', 'bankCredit.xml'];
// Dichtekarten für die Feldformen: werden nur gespeichert (sg-<Name> im Datenordner), nicht ausgelesen
const FTP_BINARY = ['densityMap_ground.gdm', 'infoLayer_limeLevel.grle', 'infoLayer_sprayLevel.grle', 'infoLayer_plowLevel.grle'];
// Dateien von Mods und Dichtekarten: fehlen sie, ist das kein Fehler
const FTP_OPTIONAL = new Set(['bankCredit.xml', ...FTP_BINARY]);
// Diese drei liest der FTP-Abruf zusätzlich, wenn die Webinterface-Adresse dafür leer ist
const FTP_FALLBACK = { savegame: 'careerSavegame.xml', vehicles: 'vehicles.xml', economy: 'economy.xml' };
const TIMEOUT = 15000;
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_I3D = 120 * 1024 * 1024;   // gepackte Größe der Karten-i3d

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
    mapMod: (/\$moddir\$([^/\\]+)/.exec(s.a.mapOverviewFilename || '') || [])[1] || null,
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
    title: st('savegameName') || '', mapTitle: st('mapTitle') || '', mapId: st('mapId') || '', saveDate: st('saveDate') || '', created: st('creationDate') || '',
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
// in dem er steht (silo, productionPoint, husbandryFood …), so lässt sich Futter von Lager unterscheiden. Dazu die Stationen
// der Karte ohne Füllstand (kind 'station': Verkaufsstellen, Tankstellen, Händler). Vorplatzierte haben keine Position.
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
    const pos = xyz(p.a.position);
    // Plantagen (DLC, z. B. Kaffee und Bananen): Reihen als Zaunstücke mit id „COFFEE_ORCHARD“, Weltkoordinaten
    const rows = {};
    for (const el of X.walk(p)) {
      const m = el.n === 'segment' && /^([A-Z]+)_ORCHARD$/.exec(el.a.id || '');
      const a = m && xyz(el.a.start), b = m && xyz(el.a.end);
      if (a && b) (rows[m[1]] = rows[m[1]] || []).push([round(a[0]), round(a[2]), round(b[0]), round(b[2])]);
    }
    for (const [type, list] of Object.entries(rows)) out.push({ farmId: num(p.a.farmId, 0), name: '', file: p.a.filename || '', kind: 'orchard', type, rows: list, fills: [], animals: [], productions: [] });
    // Stationen der Karte (Verkauf, Tankstelle, Händler …): Kartensymbol (customImage mapIcon_<art>.png) und was sie annehmen
    let icon = '';
    const sells = new Set();
    for (const sec of p.c) {
      if (sec.n === 'customImage') icon = (/mapIcon_([A-Za-z0-9]+)\.png$/.exec(sec.a.filename || '') || [])[1] || icon;
      if (sec.n === 'sellingStation') for (const el of X.kids(sec, 'stats')) if (el.a.fillType) sells.add(el.a.fillType);
    }
    const base = { farmId: num(p.a.farmId, 0), name: p.a.name || '', file: p.a.filename || '', uid: p.a.uniqueId || '', price: num(p.a.price), x: pos && pos[0], z: pos && pos[2], icon, sells: [...sells] };
    if (!fills.length && !animals.length && !productions.length) {
      if (icon || sells.size) out.push({ ...base, kind: 'station', fills, animals, productions });
      continue;
    }
    const secs = new Set(p.c.map(c => c.n));
    const kind = [...secs].some(n => /^husbandry/i.test(n)) ? 'husbandry' : secs.has('productionPoint') ? 'production'
      : [...secs].some(n => /silo|storage/i.test(n)) ? 'silo' : 'other';
    out.push({ ...base, kind, fills, animals, productions });
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
// fields.xml: Stand jedes Felds beim Autosave (Frucht, Wachstum, Boden, Kalk, Dünger, Pflug, Unkraut, Steine)
function readFields(xml) {
  const s = X.parse(xml);
  const code = v => (v && v !== 'UNKNOWN' && v !== 'NONE' ? v : null);
  return X.all(s, 'field').filter(f => num(f.a.id) !== null).map(f => ({
    id: num(f.a.id), fruit: code(f.a.fruitType), growth: num(f.a.growthState, 0), ground: code(f.a.groundType), planned: code(f.a.plannedFruit),
    spray: num(f.a.sprayLevel, 0), lime: num(f.a.limeLevel, 0), plow: num(f.a.plowLevel, 0), roller: num(f.a.rollerLevel, 0),
    stubble: num(f.a.stubbleShredLevel, 0), weed: num(f.a.weedState, 0), stone: num(f.a.stoneLevel, 0),
  }));
}
// bankCredit.xml (Mod „Bank Credit“): laufende Kredite je Hof mit Zins, Rate und Restlaufzeit, Jahresberichte
function readBankCredit(xml) {
  const s = X.parse(xml);
  const rm = X.all(s, 'rateModel')[0], st = X.all(s, 'settings')[0];
  return {
    rate: num(rm && rm.a.currentRate) ?? num(st && st.a.baseInterestRate),
    loans: X.all(s, 'loan').map(l => ({
      id: num(l.a.id), farmId: num(l.a.farmId, 0), type: num(l.a.type), amount: num(l.a.amount, 0), rest: num(l.a.restAmount, 0),
      rate: num(l.a.interestRate), months: num(l.a.duration), restMonths: num(l.a.restDuration), monthly: num(l.a.monthlyPayment, 0),
      risk: num(l.a.riskLevel), day: num(l.a.createdDay), paidOff: l.a.paidOff === 'true',
    })),
    years: X.all(s, 'entry').filter(e => e.a.farmId !== undefined).map(e => ({
      farmId: num(e.a.farmId, 0), year: num(e.a.year), interest: num(e.a.interestPaid, 0), principal: num(e.a.principalPaid, 0),
      opened: num(e.a.loansOpened, 0), closed: num(e.a.loansClosed, 0),
    })),
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
  if (key === 'ftp') dropBinaries();
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

// ---------- Spielstand und Karte ----------
// Der Spielstand, der gerade auf dem Server läuft: aus dem Webinterface (Savegame), sonst nur der Kartenname (Stats)
function liveSave() {
  const sg = url('savegame') ? get('savegame') : null;
  if (sg && sg.mapTitle) return { mapTitle: sg.mapTitle, mapId: sg.mapId || '', created: sg.created, saveDate: sg.saveDate };
  const st = get('stats');
  return st && st.map ? { mapTitle: st.map, mapId: '' } : null;
}
// Name der Karten-Mod (FS25_Bilk aus FS25_Bilk.Bilk), null bei Karten aus dem Spiel
function mapMod(sg = (url('savegame') && get('savegame')) || ((get('ftp') || {}).files || {})['careerSavegame.xml']) {
  if (sg && sg.mapId && sg.mapId.includes('.')) return sg.mapId.split('.')[0];
  const st = get('stats');
  return (st && st.mapMod) || null;
}

// ---------- FTP ----------
async function ftpConnect(cfg) {
  const ftp = require('basic-ftp');
  const client = new ftp.Client(TIMEOUT);
  await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    secure: cfg.secure === '1' || cfg.secure === '2', secureOptions: cfg.secure === '2' ? { rejectUnauthorized: false } : undefined });
  return client;
}
async function fetchFile(client, remote) {
  const chunks = [];
  await client.downloadTo(new Writable({ write(c, e, cb) { chunks.push(c); cb(); } }), remote);
  return Buffer.concat(chunks);
}
// Ein Stück aus der Mitte einer großen Datei (REST): eigene Verbindung, die nach len Bytes abbricht
async function ftpRange(cfg, remote, start, len) {
  const client = await ftpConnect(cfg);
  const chunks = [];
  let got = 0;
  try {
    await client.downloadTo(new Writable({ write(c, e, cb) { if (got < len) { chunks.push(c); got += c.length; } cb(); if (got >= len) client.close(); } }), remote, start);
  } catch (e) { if (got < len) throw e; } finally { client.close(); }
  if (got < len) throw new Error('Teil-Download unvollständig.');
  return Buffer.concat(chunks).subarray(0, len);
}
function dropBinaries() { for (const n of FTP_BINARY) fs.rmSync(path.join(FS_DIR, 'sg-' + n), { force: true }); }

// Feldumrisse
let outlineMem = null;
function outlines() {
  try {
    const t = fs.statSync(OUTLINES).mtimeMs;
    if (!outlineMem || outlineMem.t !== t) outlineMem = { t, data: JSON.parse(fs.readFileSync(OUTLINES, 'utf8')) };
    return outlineMem.data;
  } catch { outlineMem = null; return null; }
}
function saveOutlines(o) { fs.writeFileSync(OUTLINES, JSON.stringify(o)); outlineMem = null; }
function removeOutlines() { fs.rmSync(OUTLINES, { force: true }); outlineMem = null; }
// Die Umrisse, wenn sie zur Karte des laufenden Spielstands gehören
function currentOutlines() {
  const o = outlines();
  if (!o || !o.polys || !o.polys.length) return null;
  const mod = mapMod(), live = liveSave();
  if (o.mod && mod) return o.mod === mod ? o : null;
  return !o.mapTitle || !live || o.mapTitle === live.mapTitle ? o : null;
}
// Felder aus einer hochgeladenen map.i3d oder einem ZIP mit ihr (Seitenverwaltung)
function outlinesFromUpload(buf) {
  let polys = [], entry = 'map.i3d';
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const zip = new (require('adm-zip'))(buf);
    for (const c of fsfields.mapCandidates(zip.getEntries().map(e => ({ name: e.entryName, size: e.header.size, e })))) {
      polys = fsfields.i3dFields(c.e.getData().toString('utf8'));
      entry = c.name;
      if (polys.length) break;
    }
    if (!polys.length) throw new Error('Im ZIP steckt keine i3d-Datei mit Feldern.');
  } else {
    polys = fsfields.i3dFields(buf.toString('utf8'));
    if (!polys.length) throw new Error('In dieser i3d-Datei stehen keine Felder (polygonPoints).');
  }
  const live = liveSave();
  saveOutlines({ source: 'upload', mod: mapMod(), mapTitle: live ? live.mapTitle : '', sig: 'upload:' + now(), entry, at: now(), polys });
  return polys.length;
}
// Aus der Karten-Mod im mods-Ordner: erst das Inhaltsverzeichnis am Ende des ZIPs, dann nur die i3d-Datei der Karte
async function mapOutlines(cfg, client, dir, career) {
  const cur = outlines();
  const mod = mapMod(career || undefined);
  if (!mod) return null;
  if (cur && cur.source === 'upload' && (!cur.mod || cur.mod === mod)) return null;
  let zip = null, modsDir = null;
  for (const d of new Set([path.posix.join(path.posix.dirname(dir), 'mods'), '/mods'])) {
    let list;
    try { list = await client.list(d); } catch { continue; }
    zip = list.find(f => f.isFile && f.name.toLowerCase() === mod.toLowerCase() + '.zip') || null;
    if (zip) { modsDir = d; break; }
  }
  if (!zip) return `Feldumrisse: ${mod}.zip nicht im mods-Ordner gefunden`;
  const sig = `${mod}:${zip.size}:${zip.rawModifiedAt || ''}`;
  if (cur && cur.sig === sig) return null;
  const remote = path.posix.join(modsDir, zip.name);
  const tailLen = Math.min(zip.size, 1 << 20), tailStart = zip.size - tailLen;
  const tail = await ftpRange(cfg, remote, tailStart, tailLen);
  let cd;
  try { cd = fsfields.zipDirectory(tail, tailStart); } catch (e) { throw new Error(`${e.message} Kann der FTP-Server keine Teil-Downloads (REST)?`); }
  const list = cd.offset >= tailStart ? tail.subarray(cd.offset - tailStart, cd.offset - tailStart + cd.size) : await ftpRange(cfg, remote, cd.offset, cd.size);
  for (const e of fsfields.mapCandidates(fsfields.zipEntries(list))) {
    if (e.csize > MAX_I3D) continue;
    const local = await ftpRange(cfg, remote, e.offset, Math.min(zip.size - e.offset, 30 + 65535 * 2 + e.csize));
    const polys = fsfields.i3dFields(fsfields.zipData(local, e).toString('utf8'));
    if (polys.length) {
      saveOutlines({ source: 'ftp', mod, mapTitle: career ? career.mapTitle : '', sig, entry: e.name, at: now(), polys });
      return null;
    }
  }
  // Merken, damit er es nicht alle fünf Minuten neu versucht
  saveOutlines({ source: 'ftp', mod, mapTitle: career ? career.mapTitle : '', sig, entry: null, at: now(), polys: [] });
  return null;
}

// FTP: Ordner auflisten und nur geänderte Dateien holen (Größe oder Zeit anders als beim letzten Mal)
async function runFtp(force = false) {
  const cfg = ftpConfig();
  const prev = status('ftp');
  let files = { ...((prev.data && prev.data.files) || {}) };
  let seen = { ...((prev.info && prev.info.seen) || {}) };
  const shapes = getSetting('fs_shapes', '1') === '1';
  const wanted = [...FTP_FILES, ...(shapes ? FTP_BINARY : []), ...Object.entries(FTP_FALLBACK).filter(([k]) => !url(k)).map(([, f]) => f)];
  if (!shapes) for (const n of FTP_BINARY) { delete files[n]; fs.rmSync(path.join(FS_DIR, 'sg-' + n), { force: true }); }
  const notes = [];
  const dir = cfg.dir;
  // Anderer Ordner als beim letzten Mal: alles neu holen
  if (prev.data && prev.data.dir && prev.data.dir !== dir) { files = {}; seen = {}; dropBinaries(); }
  const client = await ftpConnect(cfg);
  try {
    const list = await client.list(dir);
    const byName = new Map(list.filter(f => f.isFile).map(f => [f.name, f]));
    for (const name of wanted) {
      const f = byName.get(name);
      if (!f) {
        if (!FTP_OPTIONAL.has(name)) notes.push(`${name} fehlt`);
        delete files[name];
        if (FTP_BINARY.includes(name)) fs.rmSync(path.join(FS_DIR, 'sg-' + name), { force: true });
        continue;
      }
      const sig = `${f.size}:${f.rawModifiedAt || ''}`;
      if (!force && seen[name] === sig && files[name] !== undefined) continue;
      if (f.size > MAX_BYTES) { notes.push(`${name} ist zu groß`); continue; }
      const buf = await fetchFile(client, path.posix.join(dir, name));
      if (FTP_BINARY.includes(name)) {
        fs.writeFileSync(path.join(FS_DIR, 'sg-' + name), buf);
        files[name] = { bytes: buf.length, at: now(), sig };
        seen[name] = sig;
        continue;
      }
      try {
        files[name] = readFtpFile(name, buf.toString('utf8'));
        seen[name] = sig;
      } catch (e) { notes.push(`${name}: ${e.message}`); }
    }
    if (shapes) {
      try { const n = await mapOutlines(cfg, client, dir, files['careerSavegame.xml'] || null); if (n) notes.push(n); } catch (e) { notes.push('Feldumrisse: ' + (e.message || e)); }
    }
  } finally { client.close(); }
  const data = { files, at: now(), dir };
  return { data, info: { seen, notes, summary: summarizeFtp(files, notes) } };
}
function readFtpFile(name, xml) {
  switch (name) {
    case 'farms.xml': return readFarms(xml);
    case 'placeables.xml': return readPlaceables(xml);
    case 'items.xml': return readItems(xml);
    case 'environment.xml': return readEnvironment(xml);
    case 'fields.xml': return { at: now(), list: readFields(xml) };
    case 'bankCredit.xml': return readBankCredit(xml);
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
  const fl = files['fields.xml'];
  if (fl) parts.push(`fields.xml: ${fl.list.length} Felder`);
  const bc = files['bankCredit.xml'];
  if (bc) { const open = bc.loans.filter(l => !l.paidOff).length; parts.push(`bankCredit.xml: ${open} ${open === 1 ? 'laufender Kredit' : 'laufende Kredite'}`); }
  if (files['densityMap_ground.gdm']) parts.push(`Dichtekarte: Feldformen${FTP_BINARY.slice(1).some(n => files[n]) ? ' und Boden-Ebenen' : ''}`);
  const o = outlines();
  if (o && o.source === 'ftp') parts.push(o.polys.length ? `Feldumrisse aus ${o.mod}.zip: ${o.polys.length} Felder` : `${o.mod}.zip: keine Feldumrisse gefunden`);
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
// Beim nächsten Takt abholen (neue Adresse, anderer Spielstand)
function soon(key) { nextAt.set(key, 0); }

module.exports = {
  FEEDS, FTP_FILES, FTP_BINARY, FTP_FALLBACK, MAP_FILE, FS_DIR, url, interval, ftpConfig, configured, get, status, on, onError, run, runAll, start, reschedule, soon, forget,
  liveSave, mapMod, outlines, currentOutlines, outlinesFromUpload, removeOutlines,
  readStats, readSavegame, readVehicles, readEconomy, readFarms, readPlaceables, readItems, readEnvironment, readFields, readBankCredit, imageSize, load,
};
