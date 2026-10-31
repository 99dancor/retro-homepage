'use strict';
// Farming Simulator Hub (Startmenü → 🚜 Farming Simulator): ein Fenster für alles rund um den FS25-Server.
// Die Feeds holt src/fsfeeds.js ab, hier wird daraus ein Bild des Servers (model): Uhrzeit, Datum, Wetter, Spieler, Höfe
// mit Land, Fahrzeugen, Paletten, Lager und Bilanz, Karte und Preise. Dazu kommen die Daten der Mitglieder: Höfe und
// Mitglieder, Notizen, Aufgaben, Anbauplan, Orte, Changelog und Vorschläge (Tabellen fs_* in src/db.js).
//
// Was das Spiel weiß, kommt aus dem Spiel: Grundstücke, Felder, Stationen, Rezepte, Waren und Früchte aus der Mod
// „FS25 Hub Link“ (src/fsexport.js), was je Fleck wächst aus den Dichtekarten (src/fsmap.js), Datum aus environment.xml.
// Von Hand gepflegt werden nur Dinge, die das Spiel nicht kennt: Höfe auf der Seite, Aufgaben, Pläne, Orte, Notizen.
const fs = require('node:fs');
const path = require('node:path');
const { db, now, getSetting, setSetting, tx } = require('./db');
const feeds = require('./fsfeeds');
const fsmap = require('./fsmap');
const saves = require('./fssaves');
const N = require('./fsnames');
const prod = require('./fsprod');
const fsst = require('./fsstations');
const fscrops = require('./fscrops');
const fsexport = require('./fsexport');
const fswiki = require('./fswiki');
const notify = require('./notify');

const DEFAULT_COLORS = ['#2e8b2e', '#2f6fd8', '#c0392b', '#d4a017', '#8e44ad', '#16a085', '#d35400', '#7f8c8d'];
const STATUS = { offen: '💡 Offen', geplant: '📅 Geplant', umgesetzt: '✔ Umgesetzt', abgelehnt: '✖ Abgelehnt' };
const REPEAT = { '': 'einmalig', days: 'alle … Tage', weekly: 'jede Woche', gdays: 'alle … Spieltage', gmonths: 'alle … Spielmonate' };
const MAX = { note: 2000, title: 120, body: 4000, name: 40 };
// Betriebsmittel (werden verbraucht, nicht verkauft) und Tank-Inhalte von Fahrzeugen
const SUPPLIES = new Set(['SEEDS', 'FERTILIZER', 'LIQUIDFERTILIZER', 'HERBICIDE', 'LIME', 'DIESEL', 'DEF', 'SILAGE_ADDITIVE', 'FISHFOOD', 'MINERAL_FEED',
  'PIGFOOD', 'CHICKENFOOD', 'BALE_TWINE', 'BALE_NET', 'BALE_WRAP', 'TREESAPLINGS', 'RICESAPLINGS', 'WATER', 'ROADSALT', 'LIQUIDSEEDTREATMENT', 'METHANE',
  'ELECTRICCHARGE', 'TARP', 'TROUTYOUNG', 'SALMONYOUNG', 'COMPOST']);
const TANK = new Set(['DIESEL', 'DEF', 'AIR', 'ELECTRICCHARGE', 'METHANE']);
const PALLET_CATS = new Set(['PALLETS', 'PALLETSILAGE', 'BIGBAGS', 'IBC', 'BARRELS']);
// Selbstfahrend (eigener Tank): nach Art im Stats-Feed oder nach Fahrzeugart
const DRIVABLE = /drivable|tractor|truck|^car|combine|harvester|telehandler|wheelloader|motor|selfpropelled|skidsteer|forklift/i;
const DRIVABLE_CATS = /^(TRACTORS[SML]?|TRUCKS|CARS|HARVESTERS|FORAGEHARVESTERS|GRAPEHARVESTERS|OLIVEHARVESTERS|RICEHARVESTERS|POTATOHARVESTING|BEETHARVESTING|TELELOADERVEHICLES|WHEELLOADERVEHICLES|FRONTLOADERVEHICLES|SKIDSTEERVEHICLES|FORKLIFTS|SPRAYERS)$/;
// Waren, die im Economy-Feed stehen, aber keine Ware im Preis-Menü sind (Tiere, Ballen-Arten, Hilfsmittel)
const NOT_GOODS = /^(UNKNOWN|AIR|WEED|SNOW|TREE|ELECTRICCHARGE|METHANE|ROUNDBALE.*|SQUAREBALE.*|(COW|PIG|SHEEP|HORSE|CHICKEN)(_.*)?|GOAT|.*_CUT|FORAGE_MIXING|MEADOW)$/;
const CROPS = new Set(['WHEAT', 'BARLEY', 'OAT', 'CANOLA', 'SORGHUM', 'SUNFLOWER', 'SOYBEAN', 'MAIZE', 'POTATO', 'SUGARBEET', 'BEETROOT', 'CARROT', 'PARSNIP',
  'COTTON', 'RICE', 'RICELONGGRAIN', 'GREENBEAN', 'PEA', 'SPINACH', 'SUGARCANE', 'GRASS_WINDROW', 'DRYGRASS_WINDROW', 'STRAW', 'GRAPE', 'OLIVE', 'SILAGE',
  'RYE', 'TRITICALE', 'SPELT', 'WINTERWHEAT', 'WINTERBARLEY', 'ONION', 'ALFALFA', 'CLOVER', 'WOODCHIPS', 'WOOD', 'CHAFF']);
const ANIMAL_GOODS = new Set(['MILK', 'GOATMILK', 'BUFFALOMILK', 'WOOL', 'EGG', 'HONEY', 'MANURE', 'LIQUIDMANURE', 'TROUT', 'SALMON']);

// ---------- Kleinigkeiten ----------
const clean = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const intOr = (v, d = null) => { const n = Math.round(Number(v)); return v === '' || v === undefined || v === null || !Number.isFinite(n) ? d : n; };
const today = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const months = s => String(s || '').split(',').map(Number).filter(m => Number.isInteger(m) && m >= 0 && m < 12);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function enabled() { return getSetting('fs_enabled', '1') === '1'; }
function canView(user) { return enabled() && (!!user || getSetting('fs_view', 'members') === 'public'); }
function farmOf(userId) { const r = userId && db.prepare('SELECT farm_id FROM fs_members WHERE user_id = ?').get(userId); return r ? r.farm_id : null; }
function canEditFarm(user, farmId) {
  if (!user) return false;
  if (user.isAdmin || getSetting('fs_edit', 'farm') === 'members') return true;
  return farmOf(user.id) === Number(farmId);
}

// Feed mit Ersatz aus dem FTP-Ordner (Seitenverwaltung: Webinterface-Adresse leer, FTP eingetragen)
function feed(key) {
  const d = feeds.get(key);
  if (d) return d;
  const name = feeds.FTP_FALLBACK[key];
  return (name && ftpFile(name)) || null;
}
function ftpFile(name) {
  const f = feeds.get('ftp'), base = (f && f.files && f.files[name]) || null;
  const g = require('./fslive').gameData();
  return g ? withLive(name, base, g) : base;
}
// Mod „FS25 Hub Link“ ab 3.3 verbunden: Geld, Datum, Wetter und Felder live aus dem Spiel statt vom letzten Autosave.
// Namen, Farben und Spieler der Höfe kennt nur farms.xml; die bleiben.
function withLive(name, base, g) {
  if (name === 'farms.xml' && g.farms && g.farms.length) {
    const out = (base || []).map(x => ({ ...x }));
    for (const lf of g.farms) {
      let x = out.find(o => o.id === lf.id);
      if (!x) { x = { id: lf.id, name: '', color: null, players: [], finances: [] }; out.push(x); }
      Object.assign(x, { money: lf.money, loan: lf.loan, live: true }, lf.finances.length ? { finances: lf.finances } : {});
    }
    out.live = true;
    return out;
  }
  if (name === 'environment.xml' && g.environment && g.environment.day) {
    const e = g.environment;
    return { ...(base || {}), day: e.day, dayTime: e.dayTime ?? (base && base.dayTime), daysPerPeriod: e.daysPerPeriod || (base && base.daysPerPeriod) || null,
      weather: e.weather.length ? e.weather : (base ? base.weather : []), temp: e.temp, live: true };
  }
  if (name === 'fields.xml' && g.fields && g.fields.length) return { at: g.at, list: g.fields, live: true };
  return base;
}

// ---------- Uhr und Datum ----------
// Der Stats-Feed nennt nur die Uhrzeit (Millisekunden seit Mitternacht). Ob sie läuft, sieht der Hub am Vergleich zweier
// Abrufe; den Spieltag zählt er selbst weiter, wenn die Uhr über Mitternacht springt. Startwert: environment.xml (FTP),
// sonst die Korrektur aus der Seitenverwaltung, sonst eine Schätzung aus den großen Nachfragen (die nennen ihren Spieltag).
const clock = { dayTime: null, at: 0, running: false };
function dayState() { try { return JSON.parse(getSetting('fs_day', 'null')); } catch { return null; } }
function setDay(day, source) {
  const st = feeds.get('stats');
  setSetting('fs_day', JSON.stringify({ day: Math.max(1, Math.round(day)), last: st ? st.dayTime : null, source, at: now() }));
  invalidate();
}
function daysPerPeriod() {
  const sg = feed('savegame'), env = ftpFile('environment.xml');
  return Math.max(1, Math.round((env && env.daysPerPeriod) || (sg && sg.daysPerPeriod) || 1));
}
function estimateDay() {
  const ec = feed('economy');
  const d = ec && ec.demands.filter(x => x.day).map(x => (x.running ? x.day : x.day - 1));
  return d && d.length ? Math.max(1, Math.min(...d)) : null;
}
function currentDay() {
  const st = dayState();
  if (st && st.day) return st.day;
  return estimateDay();
}
// Absoluter Spieltag → Monat, Tag im Monat, Jahr
function dateOf(day, dpp = daysPerPeriod()) {
  if (!day) return null;
  const i = day - 1;
  const month = Math.floor(i / dpp) % 12;
  return { day, month, monthName: N.MONTHS[month], dom: (i % dpp) + 1, year: Math.floor(i / (dpp * 12)) + 1, dpp };
}
// Erster Spieltag eines Monats in einem Spieljahr
function dayOfMonth(month, year, dpp = daysPerPeriod()) { return (year - 1) * 12 * dpp + month * dpp + 1; }
function fmtDay(day) {
  const d = dateOf(day);
  return d ? `${d.dpp > 1 ? d.dom + '. ' : ''}${d.monthName} J${d.year}` : '';
}
const hhmm = ms => { if (ms === null || ms === undefined) return '–'; const m = Math.floor(ms / 60000) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

function weatherNow(day, dayTime) {
  const env = ftpFile('environment.xml');
  if (!env || !(env.weather || []).length || !day) return null;
  const t = (day * 86400000) + (dayTime || 0);
  const w = env.weather.find(x => { const s = x.day * 86400000 + x.time; return t >= s && t < s + x.duration; }) || env.weather[0];
  const [icon, label] = N.WEATHER[w.type] || ['🌡️', N.pretty(w.type)];
  return { icon, label, temp: env.temp ?? null, live: !!env.live, forecast: env.weather.filter(x => x.day >= day).slice(0, 4).map(x => ({ day: x.day, ...{ icon: (N.WEATHER[x.type] || ['🌡️'])[0], label: (N.WEATHER[x.type] || [0, N.pretty(x.type)])[1] } })) };
}

// ---------- Bild des Servers ----------
let cached = null;
function invalidate() { cached = null; }

function farmRows() { return new Map(db.prepare('SELECT * FROM fs_farms').all().map(r => [r.id, r])); }
function membersByFarm() {
  const out = new Map();
  for (const r of db.prepare('SELECT m.farm_id, u.id, u.username, u.display_name, u.avatar FROM fs_members m JOIN users u ON u.id = m.user_id WHERE u.disabled = 0 ORDER BY u.username').all()) {
    if (!out.has(r.farm_id)) out.set(r.farm_id, []);
    out.get(r.farm_id).push(r);
  }
  return out;
}
function priceOf(ec, fill, month) {
  const p = ec && ec.prices[fill];
  if (!p) return null;
  if (month !== null && month !== undefined && p[month]) return p[month];
  const v = p.filter(Boolean);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function model() {
  if (cached) return cached;
  const st = feeds.get('stats'), sg = feed('savegame'), vf = feed('vehicles'), ec = feed('economy');
  // Kartendaten aus dem Spiel (Mod „FS25 Hub Link“): Positionen der vorplatzierten Gebäude, Grundstücke ohne Stats-Feed
  const ex = fsexport.current();
  N.setGameTitles(ex && ex.fillTypes, ex && ex.language);
  // Monatsnamen und Kalender je Halbkugel (Einstellung, sonst Export)
  N.setHemisphere(fswiki.hemisphere(ex, getSetting('fs_hemisphere', '')));
  // Tierdaten fürs Wiki: neue aus dem Export in wiki.xml ablegen
  try { fswiki.sync(ex); } catch (e) { console.error('Farming Hub, Wiki:', e); }
  const plcRaw = ftpFile('placeables.xml');
  const farmsX = ftpFile('farms.xml'), plc = fsexport.withPositions(plcRaw, ex), items = ftpFile('items.xml');
  const bank = ftpFile('bankCredit.xml');
  const size = (st && st.mapSize) || (ex && ex.mapSize) || 2048;
  const day = currentDay();
  const date = dateOf(day);
  const month = date ? date.month : null;
  const places = db.prepare('SELECT * FROM fs_places ORDER BY name').all();
  const price = fill => priceOf(ec, fill, month);
  const valueOf = (fill, amount) => { const p = price(fill); return p ? amount / 1000 * p : 0; };

  // Grundstücke: alle aus dem Spiel (Export), Besitzer live aus dem Stats-Feed. Felder liegen auf Grundstücken; welche zu
  // welchem gehören, sagt der Export. Ein Grundstück ohne Feld (Wiese, Wald, Plantage) heißt „parcel“, zählt nicht als Feld,
  // sieht auf der Karte aber genauso aus. Ohne Export gilt Feldnummer = Grundstücksnummer.
  const live = new Map(((st && st.farmlands) || []).map(f => [f.id, f]));
  const lands = new Map();
  for (const f of (ex && ex.farmlands) || []) if (!f.hidden) lands.set(f.id, { ...f, owner: live.has(f.id) ? live.get(f.id).owner : f.owner });
  for (const f of live.values()) if (!lands.has(f.id)) lands.set(f.id, f);
  const onLand = new Map();
  for (const f of (ex && ex.fields) || []) {
    const k = f.farmland ?? f.id;
    if (!onLand.has(k)) onLand.set(k, []);
    onLand.get(k).push({ id: f.id, ha: f.ha });
  }
  const fields = [];
  const fromLand = (l, parcel) => fields.push({ id: l.id, x: l.x, z: l.z, owner: l.owner, area: l.area, price: l.price, fieldIds: (onLand.get(l.id) || []).map(f => f.id), ...(parcel ? { parcel: true } : {}) });
  if (onLand.size) {
    for (const l of lands.values()) if (l.id < 255 && l.area > 0 && Number.isFinite(l.x)) fromLand(l, !onLand.has(l.id));
  } else {
    const known = new Set(), fxml = ftpFile('fields.xml');
    for (const f of (st && st.fields) || []) { const land = lands.get(f.id); known.add(f.id); fields.push({ id: f.id, x: f.x, z: f.z, owner: land ? land.owner : 0, area: land ? land.area : 0, price: land ? land.price : 0, fieldIds: [f.id] }); }
    for (const f of (fxml && fxml.list) || []) { const l = lands.get(f.id); if (l && !known.has(f.id) && Number.isFinite(l.x)) { known.add(l.id); fromLand(l); } }
    const noList = !fields.length;
    for (const l of lands.values()) if (!known.has(l.id) && l.id < 255 && l.area > 0 && Number.isFinite(l.x)) fromLand(l, !noList);
  }
  fields.sort((a, b) => a.id - b.id);
  // Plantagen (Kaffee, Bananen) aus placeables.xml: jede Reihe gehört zu dem Grundstück, auf dem sie liegt (ohne Grundstückskarte:
  // dessen Mitte am nächsten)
  const orchards = (plc || []).filter(p => p.kind === 'orchard').map(o => ({ type: o.type, farmId: o.farmId, rows: o.rows }));
  const votes = new Map();
  for (const o of orchards) {
    for (const r of o.rows) {
      const mx = (r[0] + r[2]) / 2, mz = (r[1] + r[3]) / 2;
      let best = null;
      const pid = fsexport.parcelAt(ex, mx, mz);
      if (pid) best = { f: fields.find(f => f.id === pid) };
      if (!best || !best.f) {
        best = null;
        for (const f of fields) {
          const d = Math.hypot(f.x - mx, f.z - mz), reach = Math.max(40, 1.4 * Math.sqrt((f.area || 0.5) * 10000 / Math.PI));
          if (d < reach && (!best || d / reach < best.k)) best = { k: d / reach, f };
        }
      }
      if (!best || !best.f) continue;
      const v = votes.get(best.f) || {};
      v[o.type] = (v[o.type] || 0) + 1;
      votes.set(best.f, v);
    }
  }
  for (const [f, v] of votes) f.orchard = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
  function where(x, z) {
    if (x === null || z === null || x === undefined) return { label: '–' };
    const p = { x, z };
    let best = null;
    for (const pl of places) { const d = dist(pl, p); if (d <= pl.radius && (!best || d < best.d)) best = { d, pl }; }
    if (best) return { label: best.pl.name, place: best.pl.id };
    let bf = null;
    const pid = fsexport.parcelAt(ex, x, z);
    if (pid && fields.some(f => f.id === pid)) return { label: `Grundstück ${pid}`, field: pid };
    for (const f of fields) { const d = dist(f, p); if (!bf || d < bf.d) bf = { d, f }; }
    if (bf && bf.d < 150) return { label: `bei Grundstück ${bf.f.id}`, field: bf.f.id };
    return { label: `${Math.round(x)} / ${Math.round(z)}` };
  }

  // Fahrzeuge: Vehicles kennt Farm, Preis und Verschleiß, Stats Name, Art und Fahrer. Verbunden über die Position.
  const sv = ((st && st.vehicles) || []).map(v => ({ ...v, used: false }));
  const vehicles = [];
  const make = (s, v) => {
    const cat = s ? s.category : (v.pallet ? 'PALLETS' : '');
    const fill = (v && v.fill.length ? v.fill : (s ? s.fill : []));
    const isPallet = PALLET_CATS.has(cat) || (s && /pallet|bigBag/i.test(s.type)) || (!s && v && v.pallet);
    const parts = String((v && v.file) || '').split('/');
    const name = s ? s.name : [parts.length > 2 ? N.pretty(parts[parts.length - 3]) : '', parts.pop().replace(/\.xml$/i, '')].filter(Boolean).join(' ');
    const x = s ? s.x : v.x, z = s ? s.z : v.z;
    const drivable = !!s && !isPallet && (DRIVABLE.test(s.type || '') || (DRIVABLE_CATS.test(cat) && /selfPropelled|drivable/i.test(s.type || '')) || /^(TRACTORS|TRUCKS|CARS)/.test(cat));
    const diesel = drivable ? (fill.find(([t]) => t === 'DIESEL') || [0, null])[1] : null;
    return {
      name, category: cat, catName: N.category(cat), type: s ? s.type : '', farmId: v ? v.farmId : 0, price: v ? v.price : 0, age: v ? v.age : null,
      hours: v ? v.hours : null, damage: v && v.damage !== null ? Math.round(v.damage * 100) : null, dirt: v && v.dirt !== null ? Math.round(v.dirt * 100) : null,
      x, z, fill, pallet: !!isPallet, drivable, diesel, ai: !!(s && s.ai), driver: s ? s.controller : null, where: where(x, z), uid: v ? v.uid : '',
    };
  };
  if (vf) {
    // 1. gleiche Stelle (vehicles.xml vom letzten Autosave, Stats live)
    const pairs = vf.map(v => {
      let best = null;
      for (const s of sv) {
        if (s.used || v.x === null) continue;
        const d = Math.hypot(s.x - v.x, s.z - v.z, (s.y ?? 0) - (v.y ?? 0));
        if (d < 1.5 && (!best || d < best.d)) best = { d, s };
      }
      if (best) best.s.used = true;
      return [v, best ? best.s : null];
    });
    // 2. Seit dem Autosave bewegt (jemand ist damit gefahren): über den Namen, „prolander7500.xml“ ↔ „ProLander 7500“, das
    // nächste gleichnamige. Sonst stünde es doppelt auf der Karte, einmal am alten, einmal am neuen Platz.
    const key = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const pr of pairs) {
      const v = pr[0];
      if (pr[1] || v.pallet) continue;
      const fk = key(String(v.file).split('/').pop().replace(/\.xml$/i, ''));
      if (fk.length < 3) continue;
      let best = null;
      for (const s of sv) {
        const sk = key(s.name);
        if (s.used || sk.length < 3 || !(fk.includes(sk) || sk.includes(fk))) continue;
        const d = v.x === null ? 0 : Math.hypot(s.x - v.x, s.z - v.z);
        if (!best || d < best.d) best = { d, s };
      }
      if (best) { best.s.used = true; pr[1] = best.s; }
    }
    for (const [v, s] of pairs) vehicles.push(make(s, v));
  }
  for (const s of sv) if (!s.used) vehicles.push(make(s, null));

  // Höfe: alle Farm-Nummern, die irgendwo vorkommen. Mit farms.xml (FTP) zählen nur die Höfe, die es im Spielstand gibt,
  // sonst auch die, die Mitglieder hier angelegt haben
  const rows = farmRows(), members = membersByFarm();
  const exNames = new Map(((ex && ex.placeables) || []).filter(p => p.uid && p.name).map(p => [p.uid, p.name]));
  const exStalls = new Map(((ex && ex.placeables) || []).filter(p => p.uid && p.stall).map(p => [p.uid, p.stall]));
  const ids = new Set(farmsX ? [] : [...rows.keys()]);
  for (const v of vehicles) if (v.farmId > 0) ids.add(v.farmId);
  for (const f of lands.values()) if (f.owner > 0) ids.add(f.owner);
  for (const f of farmsX || []) if (f.id > 0) ids.add(f.id);
  const farms = [...ids].filter(id => id > 0 && id < 100).sort((a, b) => a - b).map((id, i) => {
    const r = rows.get(id) || {}, fx = (farmsX || []).find(f => f.id === id);
    const own = [...lands.values()].filter(f => f.owner === id);
    const fv = vehicles.filter(v => v.farmId === id);
    const fleet = fv.filter(v => !v.pallet);
    // Lager: Paletten, Big Bags, Silos, Produktionslager, Ballen; dazu was in Anhängern und Fässern unterwegs ist
    const stock = new Map();
    const put = (fill, amount, label, kind) => {
      if (!(amount > 0.5)) return;
      if (!stock.has(fill)) stock.set(fill, { fill, name: N.fill(fill), amount: 0, value: 0, where: new Map(), supply: SUPPLIES.has(fill) });
      const s = stock.get(fill);
      s.amount += amount;
      s.value += valueOf(fill, amount);
      const k = label + '|' + kind;
      s.where.set(k, { label, kind, amount: ((s.where.get(k) || {}).amount || 0) + amount });
    };
    const cargo = [];
    for (const v of fv) {
      if (v.pallet) for (const [t, l] of v.fill) put(t, l, v.where.label, 'Palette');
      else for (const [t, l] of v.fill) if (!(v.drivable && TANK.has(t))) cargo.push({ vehicle: v.name, fill: t, name: N.fill(t), amount: l, value: valueOf(t, l), where: v.where.label });
    }
    const buildings = (plc || []).filter(p => p.farmId === id && p.kind !== 'orchard' && p.kind !== 'station').map((p, k) => {
      const name = p.name || (exNames.get(p.uid) || '') || prod.buildingName(prod.typeOf(p));
      const loc = where(p.x, p.z);
      const label = loc.place ? loc.label : name;
      const fills = p.fills.map(([sec, t, l]) => ({ sec, fill: t, name: N.fill(t), amount: l, food: /food/i.test(sec), value: valueOf(t, l) }));
      for (const f of fills) if (!f.food && !/water|straw|milk|manure|liquidManure/i.test(f.sec)) put(f.fill, f.amount, label, p.kind === 'production' ? 'Produktion' : 'Silo');
      const animals = {};
      for (const [t, n] of p.animals) animals[t] = (animals[t] || 0) + n;
      return { idx: k, uid: p.uid || '', name, kind: p.kind, where: loc.label, x: p.x, z: p.z, fills, animals: Object.entries(animals).map(([t, n]) => ({ type: t, name: N.FILL[t] || N.pretty(t), n })),
        productions: p.productions, food: fills.filter(f => f.food).reduce((a, f) => a + f.amount, 0), hasFood: fills.some(f => f.food),
        stall: p.kind === 'husbandry' ? fswiki.stall(exStalls.get(p.uid), fills, Object.keys(animals)) : null };
    });
    const bales = (items || []).filter(b => b.farmId === id);
    for (const b of bales) put(b.fill, b.level, where(b.x, b.z).label, 'Ballen');
    const stockList = [...stock.values()].map(s => ({ ...s, where: [...s.where.values()].sort((a, b) => b.amount - a.amount) })).sort((a, b) => b.value - a.value || b.amount - a.amount);
    const land = { ha: own.reduce((a, f) => a + f.area, 0), value: own.reduce((a, f) => a + f.price, 0), lands: own.length, fields: fields.filter(f => f.owner === id && !f.parcel).length };
    const stockValue = stockList.reduce((a, s) => a + s.value, 0);
    const fleetValue = fleet.reduce((a, v) => a + v.price, 0);
    const money = fx && fx.money !== null ? fx.money : null;
    const credits = bank ? bank.loans.filter(l => l.farmId === id && !l.paidOff) : [];
    const creditRest = credits.reduce((a, l) => a + l.rest, 0);
    return {
      id, name: r.name || (fx && fx.name) || `Farm ${id}`, gameName: fx ? fx.name : '', color: r.color || DEFAULT_COLORS[(id - 1) % DEFAULT_COLORS.length] || DEFAULT_COLORS[i % 8],
      members: members.get(id) || [], players: fx ? fx.players : [], money, moneyLive: !!(fx && fx.live), loan: fx ? fx.loan : 0, finances: fx ? fx.finances : [],
      land, vehicles: fv, fleet, fleetValue, stock: stockList, stockValue, cargo, buildings, bales: bales.length,
      pallets: fv.filter(v => v.pallet), credits, creditRest, creditYears: bank ? bank.years.filter(y => y.farmId === id).sort((a, b) => b.year - a.year) : [],
      bilanz: (money || 0) - ((fx && fx.loan) || 0) - creditRest + land.value + fleetValue + stockValue,
    };
  });

  // Stationen der Karte (src/fsstations.js), mit Lage und großer Nachfrage (economy.xml nennt die uniqueId der Station)
  const stations = fsst.list(ex, plcRaw).map(s => ({ ...s, where: s.placed ? where(s.x, s.z).label : null,
    demands: (ec ? ec.demands : []).filter(d => d.place === s.uid) }));

  const dayTime = st ? st.dayTime : null;
  const ok = feeds.status('stats');
  const stale = !ok.ok_at || (now() - ok.ok_at) > Math.max(120, feeds.interval('stats') * 4);
  cached = {
    configured: feeds.configured('stats'), stats: st, savegame: sg, economy: ec, size,
    online: !!st && !stale, paused: !!st && !stale && !clock.running && clock.at > 0, statsAt: ok.ok_at, statsError: ok.error,
    dayTime, clock: { ...clock }, time: hhmm(dayTime), timeScale: sg ? sg.timeScale : null,
    day, date, dateSource: (dayState() || {}).source || (day ? 'estimate' : null), weather: weatherNow(day, dayTime),
    money: farmsX && farmsX.live ? farmsX.reduce((a, f) => a + (f.money || 0), 0) : sg && sg.money !== null ? sg.money : (farmsX ? farmsX.reduce((a, f) => a + (f.money || 0), 0) : null),
    perFarmMoney: !!farmsX, moneyLive: !!(farmsX && farmsX.live), ftp: !!feeds.get('ftp'), missions: require('./fslive').missions(),
    farms, fields, orchards, stations, where, lands: [...lands.values()], vehicles, places, players: st ? st.players : [], mods: st ? st.mods : [],
    demands: ec ? ec.demands : [], month, gameData: ex ? { version: ex.version || 1, mapTitle: ex.mapTitle, at: ex.at } : null,
  };
  return cached;
}
feeds.on(() => invalidate());

// Spieler auf der Seite: Spielername = Benutzername oder Anzeigename
function accountFor(name) {
  return db.prepare('SELECT id, username, display_name, avatar FROM users WHERE disabled = 0 AND (username = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE) LIMIT 1').get(name, name) || null;
}

// ---------- Was beim Abruf passiert ----------
feeds.on((key, prev) => {
  // Ordnerliste der Seitenverwaltung: was im FTP-Ordner liegt; auf Wunsch dem Server in einen bekannten Ordner folgen
  if (key === 'ftp') saves.syncSlot();
  if (key === 'savegame' || key === 'ftp') {
    const to = saves.follow();
    if (to) db.prepare("INSERT INTO fs_changelog(kind, title, body, created_at) VALUES ('server', ?, ?, ?)").run('FTP-Ordner umgestellt', `Der Server läuft mit einem anderen Spielstand, der Hub liest jetzt ${to}.`, now());
  }
  if (key === 'savegame' || key === 'ftp') checkSave();
  if (key === 'stats') onStats(prev, feeds.get('stats'));
  if (key === 'ftp') {
    setImmediate(() => { try { shapes(); } catch (e) { console.error('Farming Hub, Feldformen:', e); } });
    // Spieltag aus environment.xml, sonst aus dem Export der Mod
    const env = ftpFile('environment.xml') || fsexport.current();
    const before = prev && prev.files && (prev.files['environment.xml'] || prev.files['farmingHubExport.xml']);
    if (env && env.day && (!before || before.day !== env.day || !dayState())) setDay(env.day, 'ftp');
  }
  record();
  try { syncAuto(true); } catch (e) { console.error('Farming Hub, Vorschläge:', e); }
});
feeds.onError((key, st) => {
  if (key !== 'stats' || st.fails < 3) return;
  if (getSetting('fs_online', '0') === '1') {
    setSetting('fs_online', '0');
    closeSessions();
    announce('fs-offline', '🚜 Server nicht erreichbar', `${(feeds.get('stats') || {}).name || 'Der Server'} antwortet seit ein paar Minuten nicht.`);
  }
});

// Anderer Spielstand auf dem Server: Daten des alten beiseitelegen (src/fssaves.js), Changelog-Eintrag
function checkSave() {
  const sw = saves.check();
  if (!sw) return;
  fsmap.forget();
  fscrops.forget();
  invalidate();
  db.prepare("INSERT INTO fs_changelog(kind, title, body, created_at) VALUES ('server', ?, ?, ?)").run(`Neuer Spielstand: ${sw.to}`,
    `Vorher ${sw.from}. ${sw.restored ? 'Höfe, Aufgaben und Pläne von früher sind wieder da.' : 'Höfe, Aufgaben und Pläne des alten Spielstands sind beiseitegelegt, hier beginnt alles leer.'}`, now());
}
function onStats(prev, st) {
  if (!st) return;
  const t = Date.now();
  clock.running = !!(prev && prev.dayTime !== null && st.dayTime !== null && st.dayTime !== prev.dayTime);
  clock.dayTime = st.dayTime;
  clock.at = t;
  // Spieltag: über Mitternacht weiterzählen, sonst Startwert setzen
  const ds = dayState();
  if (ds && ds.day) {
    if (ds.last !== null && st.dayTime !== null && st.dayTime + 3600000 < ds.last) ds.day++;
    ds.last = st.dayTime;
    setSetting('fs_day', JSON.stringify(ds));
  } else {
    const est = estimateDay();
    if (est) setDay(est, 'estimate');
  }
  if (getSetting('fs_online', '0') !== '1') {
    const was = getSetting('fs_online', null);
    setSetting('fs_online', '1');
    if (was === '0') announce('fs-online', '🚜 Server wieder da', `${st.name || 'Der Server'} ist wieder erreichbar.`);
  }
  trackSessions(st.players.map(p => p.name));
  trackMods(st);
}
function trackSessions(names) {
  const open = db.prepare('SELECT id, name FROM fs_sessions WHERE end_at IS NULL').all();
  const lower = new Set(names.map(n => n.toLowerCase()));
  const t = now();
  for (const s of open) if (!lower.has(s.name.toLowerCase())) db.prepare('UPDATE fs_sessions SET end_at = ? WHERE id = ?').run(t, s.id);
  const openNames = new Set(open.map(s => s.name.toLowerCase()));
  for (const n of names) if (!openNames.has(n.toLowerCase())) db.prepare('INSERT INTO fs_sessions(name, start_at) VALUES (?, ?)').run(n, t);
  // Mitgeschrieben wird ein halbes Jahr
  db.prepare('DELETE FROM fs_sessions WHERE start_at < ?').run(t - 183 * 86400);
}
function closeSessions() { db.prepare('UPDATE fs_sessions SET end_at = ? WHERE end_at IS NULL').run(now()); }
function trackMods(st) {
  const seen = (() => { try { return JSON.parse(getSetting('fs_mods_seen', 'null')); } catch { return null; } })();
  const cur = Object.fromEntries(st.mods.map(m => [m.name, m.version]));
  const titles = Object.fromEntries(st.mods.map(m => [m.name, m.title]));
  if (seen && seen.mods) {
    const added = Object.keys(cur).filter(k => !(k in seen.mods));
    const removed = Object.keys(seen.mods).filter(k => !(k in cur));
    const updated = Object.keys(cur).filter(k => k in seen.mods && seen.mods[k] !== cur[k]);
    if (added.length || removed.length || updated.length) {
      const lines = [...added.map(k => `➕ ${titles[k]} (${cur[k]})`), ...updated.map(k => `🔄 ${titles[k]}: ${seen.mods[k]} → ${cur[k]}`),
        ...removed.map(k => `➖ ${(seen.titles || {})[k] || k}`)];
      const parts = [added.length && `${added.length} neu`, updated.length && `${updated.length} aktualisiert`, removed.length && `${removed.length} entfernt`].filter(Boolean);
      db.prepare("INSERT INTO fs_changelog(kind, title, body, created_at) VALUES ('mods', ?, ?, ?)").run('Mods geändert: ' + parts.join(', '), lines.join('\n'), now());
      announce('fs-mods-' + now(), '🧩 Server-Mods geändert', parts.join(', '));
    }
    if (seen.version && st.version && seen.version !== st.version) {
      db.prepare("INSERT INTO fs_changelog(kind, title, body, created_at) VALUES ('server', ?, ?, ?)").run(`Server-Version ${st.version}`, `Vorher ${seen.version}`, now());
    }
  }
  setSetting('fs_mods_seen', JSON.stringify({ mods: cur, titles, version: st.version }));
}
// Benachrichtigung an alle, die einem Hof angehören
function announce(key, title, body, url = '/farming') {
  for (const r of db.prepare('SELECT user_id FROM fs_members').all()) notify.send(r.user_id, 'fshub', { key, title, body, url });
}

// Verläufe je Tag (höchstens alle 10 Minuten neu): Kontostand, Bilanz und Paletten je Hof, Paletten je Ort
let lastRecord = 0;
function record(force = false) {
  if (!force && Date.now() - lastRecord < 600e3) return;
  lastRecord = Date.now();
  const m = model();
  if (!m.stats) return;
  const d = today();
  const put = db.prepare('INSERT INTO fs_hist(series, day, value) VALUES (?, ?, ?) ON CONFLICT(series, day) DO UPDATE SET value = excluded.value');
  tx(() => {
    if (m.money !== null) put.run('money:0', d, m.money);
    for (const f of m.farms) {
      if (f.money !== null) put.run('money:' + f.id, d, f.money);
      put.run('bilanz:' + f.id, d, Math.round(f.bilanz));
      put.run('pallets:' + f.id, d, Math.round(f.pallets.reduce((a, v) => a + v.fill.reduce((b, [, l]) => b + l, 0), 0)));
    }
    const per = {};
    for (const v of m.vehicles) if (v.pallet && v.where.place) per[v.where.place] = (per[v.where.place] || 0) + v.fill.reduce((b, [, l]) => b + l, 0);
    for (const p of m.places) put.run('place:' + p.id, d, Math.round(per[p.id] || 0));
    db.prepare('DELETE FROM fs_hist WHERE day < ?').run(addDays(d, -400));
  });
  dueReminders();
}
function history(series, days = 30) {
  return db.prepare('SELECT day, value FROM fs_hist WHERE series = ? AND day >= ? ORDER BY day').all(series, addDays(today(), -days));
}

// ---------- Höfe und Mitglieder ----------
function farm(id) { return model().farms.find(f => f.id === Number(id)) || null; }
function join(userId, farmId) {
  const id = intOr(farmId);
  if (!id || id < 1 || id > 99) return false;
  db.prepare('INSERT INTO fs_members(user_id, farm_id, joined_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET farm_id = excluded.farm_id, joined_at = excluded.joined_at').run(userId, id, now());
  if (!db.prepare('SELECT 1 FROM fs_farms WHERE id = ?').get(id)) db.prepare('INSERT INTO fs_farms(id, updated_at) VALUES (?, ?)').run(id, now());
  invalidate();
  return true;
}
function leave(userId) { db.prepare('DELETE FROM fs_members WHERE user_id = ?').run(userId); invalidate(); }
function setMember(userId, farmId) { if (intOr(farmId)) join(userId, farmId); else leave(userId); }
function saveFarm(id, user, { name, color }) {
  const nm = oneLine(name, MAX.name);
  const col = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : null;
  db.prepare(`INSERT INTO fs_farms(id, name, color, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = COALESCE(excluded.color, fs_farms.color), updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(Number(id), nm || null, col, user ? user.id : null, now());
  invalidate();
}

// ---------- Notizen ----------
function notes() {
  return db.prepare('SELECT n.*, u.username, u.display_name, u.avatar FROM fs_notes n LEFT JOIN users u ON u.id = n.user_id ORDER BY n.created_at DESC, n.id DESC LIMIT 100').all();
}
function addNote(user, body) {
  const b = clean(body, MAX.note);
  if (!b) return null;
  return Number(db.prepare('INSERT INTO fs_notes(user_id, body, created_at) VALUES (?, ?, ?)').run(user.id, b, now()).lastInsertRowid);
}
function note(id) { return db.prepare('SELECT * FROM fs_notes WHERE id = ?').get(Number(id)) || null; }
const canChangeNote = (user, n) => !!user && !!n && (user.isAdmin || n.user_id === user.id);
function editNote(id, body) { const b = clean(body, MAX.note); if (b) db.prepare('UPDATE fs_notes SET body = ?, updated_at = ? WHERE id = ?').run(b, now(), Number(id)); }
function removeNote(id) { db.prepare('DELETE FROM fs_notes WHERE id = ?').run(Number(id)); }

// ---------- Aufgaben ----------
// Fällig „heute“: Datum bis heute oder Spieltag bis zum aktuellen
function isDue(t, day = currentDay(), d = today()) {
  if (t.done_at) return false;
  if (t.due_date) return t.due_date <= d;
  if (t.due_day) return !!day && t.due_day <= day;
  // Automatisch angelegt (Spiel, Hub): gilt, solange der Anlass besteht
  return t.source === 'game' || t.source === 'auto';
}
function isOverdue(t, day = currentDay(), d = today()) {
  if (t.done_at) return false;
  if (t.due_date) return t.due_date < d;
  if (t.due_day) return !!day && t.due_day < day;
  return false;
}
function dueLabel(t) {
  if (t.due_date) {
    const d = today();
    if (t.due_date === d) return 'heute';
    if (t.due_date === addDays(d, 1)) return 'morgen';
    if (t.due_date === addDays(d, -1)) return 'gestern';
    return new Date(t.due_date + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  }
  if (t.due_day) return fmtDay(t.due_day) || `Spieltag ${t.due_day}`;
  return '';
}
function repeatLabel(t) {
  const n = t.repeat_n || 1;
  switch (t.repeat) {
    case 'days': return n === 1 ? 'täglich' : `alle ${n} Tage`;
    case 'weekly': return n === 1 ? 'wöchentlich' : `alle ${n} Wochen`;
    case 'gdays': return n === 1 ? 'jeden Spieltag' : `alle ${n} Spieltage`;
    case 'gmonths': return n === 1 ? 'jeden Spielmonat' : `alle ${n} Spielmonate`;
    default: return '';
  }
}
const TASK_SQL = `SELECT t.*, a.username AS assignee, a.display_name AS assignee_display, c.username AS creator, d.username AS doner, p.name AS place
  FROM fs_tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by LEFT JOIN users d ON d.id = t.done_by
  LEFT JOIN fs_places p ON p.id = t.place_id`;
function decorate(t, day, d) {
  return { ...t, due: dueLabel(t), repeatText: repeatLabel(t), isDue: isDue(t, day, d), overdue: isOverdue(t, day, d) };
}
function tasks(farmId, { done = false } = {}) {
  const day = currentDay(), d = today();
  const rows = db.prepare(`${TASK_SQL} WHERE (t.farm_id = ? OR t.farm_id = 0) AND ${done ? 't.done_at IS NOT NULL' : 't.done_at IS NULL'}
    ORDER BY ${done ? 't.done_at DESC LIMIT 15' : "COALESCE(t.due_date, '9999'), COALESCE(t.due_day, 1e9), t.id"}`).all(Number(farmId));
  return rows.map(t => decorate(t, day, d));
}
function openTasks() {
  const day = currentDay(), d = today();
  return db.prepare(`${TASK_SQL} WHERE t.done_at IS NULL ORDER BY COALESCE(t.due_date, '9999'), COALESCE(t.due_day, 1e9), t.id`).all().map(t => decorate(t, day, d));
}
function task(id) { return db.prepare('SELECT * FROM fs_tasks WHERE id = ?').get(Number(id)) || null; }
// Formular → Felder einer Aufgabe. due: none | date | gday | gmonth
function taskFields(b, farmId) {
  const out = {
    title: oneLine(b.title, MAX.title), note: clean(b.note, 1000) || null, field: intOr(b.field), place_id: intOr(b.place_id),
    assignee_id: intOr(b.assignee_id), due_date: null, due_day: null, repeat: Object.hasOwn(REPEAT, b.repeat) ? b.repeat : '',
    repeat_n: Math.max(1, Math.min(365, intOr(b.repeat_n, 1))), farm_id: b.all_farms === '1' ? 0 : Number(farmId),
  };
  const day = currentDay();
  if (b.due === 'date' && validDay(b.due_date)) out.due_date = b.due_date;
  else if (b.due === 'today') out.due_date = today();
  else if (b.due === 'gday' && intOr(b.due_day) > 0) out.due_day = intOr(b.due_day);
  else if (b.due === 'gmonth' && intOr(b.due_month) !== null && day) {
    // Nächster Beginn dieses Monats (dieses oder nächstes Spieljahr)
    const cur = dateOf(day), m = Math.max(0, Math.min(11, intOr(b.due_month)));
    let first = dayOfMonth(m, cur.year);
    if (first + cur.dpp - 1 < day) first = dayOfMonth(m, cur.year + 1);
    out.due_day = first;
  }
  if (out.repeat && !out.due_date && !out.due_day) {
    if (out.repeat === 'days' || out.repeat === 'weekly') out.due_date = today();
    else if (day) out.due_day = day;
  }
  if (out.repeat === 'weekly' && out.due_date && /^[0-6]$/.test(String(b.weekday ?? ''))) {
    // Wochentag gewählt: nächster solcher Tag ab dem Datum
    let d = out.due_date;
    for (let i = 0; i < 7 && new Date(d + 'T12:00:00Z').getUTCDay() !== Number(b.weekday); i++) d = addDays(d, 1);
    out.due_date = d;
  }
  return out;
}
function addTask(user, farmId, b, autoKey = null) {
  const f = taskFields(b, farmId);
  if (!f.title) return null;
  const id = Number(db.prepare(`INSERT INTO fs_tasks(farm_id, title, note, field, place_id, assignee_id, due_date, due_day, repeat, repeat_n, auto_key, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.farm_id, f.title, f.note, f.field, f.place_id, f.assignee_id, f.due_date, f.due_day, f.repeat, f.repeat_n,
    autoKey, user ? user.id : null, now()).lastInsertRowid);
  if (f.assignee_id && (!user || f.assignee_id !== user.id)) {
    notify.send(f.assignee_id, 'fshub', { key: 'fs-task-' + id, title: '🚜 Neue Aufgabe für dich', body: `${f.title}${f.due_date || f.due_day ? ' · fällig ' + dueLabel(f) : ''}`, url: `/farming/hof/${f.farm_id || farmId}?tab=aufgaben` });
  }
  return id;
}
function editTask(id, b) {
  const t = task(id);
  if (!t) return;
  const f = taskFields(b, t.farm_id || b.farm_id);
  if (!f.title) return;
  db.prepare(`UPDATE fs_tasks SET title = ?, note = ?, field = ?, place_id = ?, assignee_id = ?, due_date = ?, due_day = ?, repeat = ?, repeat_n = ?, farm_id = ? WHERE id = ?`)
    .run(f.title, f.note, f.field, f.place_id, f.assignee_id, f.due_date, f.due_day, f.repeat, f.repeat_n, b.all_farms === '1' ? 0 : t.farm_id || Number(b.farm_id) || 0, t.id);
}
// Abhaken: regelmäßige Aufgaben bekommen gleich die nächste Runde
function completeTask(id, user) {
  const t = task(id);
  if (!t || t.done_at) return;
  tx(() => {
    db.prepare('UPDATE fs_tasks SET done_at = ?, done_by = ? WHERE id = ?').run(now(), user.id, t.id);
    if (!t.repeat) return;
    const n = t.repeat_n || 1;
    let dd = null, dy = null;
    const base = t.due_date && t.due_date > today() ? t.due_date : today();
    if (t.repeat === 'days') dd = addDays(base, n);
    else if (t.repeat === 'weekly') dd = addDays(t.due_date || base, 7 * n);
    else {
      const day = Math.max(t.due_day || 0, currentDay() || 0) || 1;
      dy = t.repeat === 'gdays' ? day + n : day + n * daysPerPeriod();
    }
    if (dd && dd <= today()) dd = addDays(today(), 1);
    db.prepare(`INSERT INTO fs_tasks(farm_id, title, note, field, place_id, assignee_id, due_date, due_day, repeat, repeat_n, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.farm_id, t.title, t.note, t.field, t.place_id, t.assignee_id, dd, dy, t.repeat, n, t.created_by, now());
  });
}
function reopenTask(id) { db.prepare('UPDATE fs_tasks SET done_at = NULL, done_by = NULL WHERE id = ?').run(Number(id)); }
function removeTask(id) {
  const t = task(id);
  // Aufgabe aus dem Spiel, Problem besteht noch: nur abhaken, sonst legt der nächste Abgleich sie gleich wieder an (src/fslive.js)
  if (t && (t.source === 'game' || t.source === 'auto') && t.game_open) { db.prepare('UPDATE fs_tasks SET done_at = COALESCE(done_at, ?) WHERE id = ?').run(now(), t.id); return; }
  db.prepare('DELETE FROM fs_tasks WHERE id = ?').run(Number(id));
}
// Einmal am Tag: wer eine fällige Aufgabe hat, bekommt eine Erinnerung
function dueReminders() {
  const d = today(), day = currentDay();
  for (const t of db.prepare('SELECT * FROM fs_tasks WHERE done_at IS NULL AND assignee_id IS NOT NULL').all()) {
    if (!isDue(t, day, d)) continue;
    notify.send(t.assignee_id, 'fshub', { key: `fs-due-${t.id}-${t.due_date || t.due_day}`, once: true, title: '🚜 Aufgabe fällig', body: t.title, url: `/farming/hof/${t.farm_id || farmOf(t.assignee_id) || ''}?tab=aufgaben` });
  }
}

// ---------- Vorschläge des Hubs (automatische Aufgaben) ----------
// Alles, was der Hub selbst erkennt. syncAuto() legt daraus Aufgaben an (source 'auto'), wie die Mod aus ihren Meldungen. Was
// die Mod schon prüft (Futter, Felder), lässt der Hub weg, solange sie verbunden ist.
function suggestions(farmId) {
  const m = model();
  const f = m.farms.find(x => x.id === Number(farmId));
  if (!f) return [];
  const out = [];
  const L = require('./fslive'), ls = L.status(), cfg = L.farmSettings(f.id);
  const mod = ls.connected && ls.advisor && /^(3\.(4|[5-9])|[4-9])/.test(ls.mod || '');
  const wear = Number(getSetting('fs_auto_wear', '50')), diesel = Number(getSetting('fs_auto_diesel', '50')), pal = Number(getSetting('fs_auto_pallets', '6'));
  // Paletten im Ausgang: je Ort (oder Stelle bei einem Feld)
  const spots = new Map();
  for (const v of f.pallets) {
    const k = v.where.place ? 'p' + v.where.place : v.where.field ? 'f' + v.where.field : null;
    if (!k) continue;
    if (!spots.has(k)) spots.set(k, { label: v.where.label, n: 0, fills: {} });
    const s = spots.get(k);
    s.n++;
    for (const [t, l] of v.fill) s.fills[t] = (s.fills[t] || 0) + l;
  }
  for (const [k, s] of spots) {
    if (s.n < pal) continue;
    const what = Object.entries(s.fills).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => N.fill(t)).join(', ');
    out.push({ key: `pal:${f.id}:${k}`, sig: String(Math.floor(s.n / 2)), icon: '📦', title: `${s.n} Paletten ${what} abholen (${s.label})`, why: `Ab ${pal} Paletten an einem Ort` });
  }
  const worn = f.fleet.filter(v => v.damage !== null && v.damage >= wear);
  if (worn.length) out.push({ key: `wear:${f.id}`, sig: worn.map(v => v.uid || v.name).sort().join(','), icon: '🔧', title: `Werkstatt: ${worn.length} ${worn.length === 1 ? 'Fahrzeug' : 'Fahrzeuge'} über ${wear} % Verschleiß`, why: worn.slice(0, 4).map(v => `${v.name} ${v.damage} %`).join(', ') + (worn.length > 4 ? ' …' : '') });
  const dry = f.fleet.filter(v => v.diesel !== null && v.diesel < diesel);
  if (dry.length) out.push({ key: `diesel:${f.id}`, sig: dry.map(v => v.uid || v.name).sort().join(','), icon: '⛽', title: `Tanken: ${dry.length} ${dry.length === 1 ? 'Fahrzeug' : 'Fahrzeuge'} unter ${diesel} l Diesel`, why: dry.slice(0, 4).map(v => `${v.name} ${Math.round(v.diesel)} l`).join(', ') });
  if (m.date) {
    for (const p of plans(f.id)) {
      const where = p.field ? `Grundstück ${p.field}` : (p.label || 'Plan');
      if (p.sow_month === m.date.month && p.kind !== 'perm') out.push({ key: `sow:${p.id}:${m.date.year}`, sig: '1', icon: '🌱', title: `${where}: ${p.crop} säen`, why: 'Laut Hofkalender', field: p.field });
      if (p.harvest_month === m.date.month) out.push({ key: `harvest:${p.id}:${m.date.year}`, sig: '1', icon: '🌾', title: `${where}: ${p.crop} ernten`, why: 'Laut Hofkalender', field: p.field });
    }
  }
  for (const d of m.demands) {
    const s = f.stock.find(x => x.fill === d.fill && !x.supply);
    if (!s) continue;
    out.push({ key: `demand:${d.fill}:${d.day}`, sig: '1', icon: '📈', title: `Große Nachfrage ${N.fill(d.fill)} +${Math.round((d.mult - 1) * 100)} %${d.running ? ' (läuft)' : d.day ? ' ab ' + (fmtDay(d.day) || 'Tag ' + d.day) : ''}`, why: `Ihr habt ${Math.round(s.amount).toLocaleString('de-DE')} l` });
  }
  if (getSetting('fs_auto_food', '1') === '1' && !(mod && cfg.stall)) {
    for (const b of f.buildings) if (b.kind === 'husbandry' && b.hasFood && b.food < 1) out.push({ key: `food:${f.id}:${b.idx}`, sig: String((feeds.get('ftp') || {}).at || ''), icon: '🐄', title: `Futter auffüllen: ${b.name}`, why: 'Laut letztem Autosave leer' });
  }
  // Felder laut letztem Autosave: ernten je Frucht, kalken, pflügen, düngen
  if (getSetting('fs_auto_fields', '1') === '1' && !(mod && cfg.fields)) {
    const mine = fieldStates().filter(x => x.owner === f.id && (x.source === 'auto' || x.source === 'patch'));
    const list = xs => xs.map(x => x.id).sort((a, b) => a - b);
    const names = ids => (ids.length === 1 ? 'Grundstück ' : 'Grundstücke ') + ids.join(', ');
    const ripe = new Map();
    for (const x of mine) if (x.state === 'reif') { const k = (x.auto && x.auto.fruit) || x.cropFill || '?'; if (!ripe.has(k)) ripe.set(k, []); ripe.get(k).push(x); }
    for (const [fruit, xs] of ripe) {
      const ids = list(xs);
      out.push({ key: `ernte:${f.id}:${fruit}`, sig: ids.join(','), icon: '🌾', title: `${xs[0].crop || N.fill(fruit)} ernten: ${names(ids)}`, why: 'Laut letztem Autosave erntereif', field: ids.length === 1 ? ids[0] : null });
    }
    for (const [k, icon, verb] of [['kalk', '🪨', 'Kalken'], ['pflug', '🚜', 'Pflügen'], ['duenger', '💧', 'Düngen']]) {
      const xs = mine.filter(x => x.care.some(c => c.key === k));
      if (!xs.length) continue;
      const ids = list(xs);
      out.push({ key: `${k}:${f.id}`, sig: ids.join(','), icon, title: `${verb}: ${names(ids)}`, why: 'Laut letztem Autosave', field: ids.length === 1 ? ids[0] : null });
    }
  }
  return out;
}
// Vorschläge → Aufgaben. Besteht der Anlass nicht mehr, hakt der Hub sie ab. Abgehakt, solange er noch besteht: kommt erst wieder,
// wenn er einmal weg war oder sich geändert hat (sig, z. B. andere Felder). Nach jedem Abruf; beim Seitenaufruf höchstens alle 5 Sekunden.
let lastAuto = 0;
function syncAuto(force = false) {
  if (!force && Date.now() - lastAuto < 5e3) return;
  lastAuto = Date.now();
  const m = model();
  // Früher von Hand übernommene und ausgeblendete (gleicher Anlass) bleiben, wie sie sind
  const hidden = new Map(db.prepare('SELECT key, sig FROM fs_hidden').all().map(r => [r.key, r.sig]));
  const taken = new Set(db.prepare("SELECT auto_key FROM fs_tasks WHERE auto_key IS NOT NULL AND source <> 'auto' AND (done_at IS NULL OR done_at > ?)").all(now() - 86400).map(r => r.auto_key));
  // Erst alles ausrechnen (das kann selbst schreiben, z. B. Früchte), dann in einem Rutsch eintragen
  const lists = m.farms.map(f => [f, suggestions(f.id).filter(x => hidden.get(x.key) !== x.sig && !taken.has(x.key))]);
  tx(() => {
    for (const [f, list] of lists) {
      const keys = new Set(list.map(x => x.key));
      for (const x of list) {
        const title = String(x.title).slice(0, 120), note = String(x.why || '').slice(0, 300);
        const open = db.prepare("SELECT id FROM fs_tasks WHERE source = 'auto' AND auto_key = ? AND farm_id = ? AND done_at IS NULL ORDER BY id DESC").get(x.key, f.id);
        if (open) {
          db.prepare('UPDATE fs_tasks SET title = ?, note = ?, field = ?, auto_sig = ?, game_open = 1 WHERE id = ?').run(title, note, x.field || null, x.sig, open.id);
          continue;
        }
        const seen = db.prepare("SELECT id, auto_sig FROM fs_tasks WHERE source = 'auto' AND auto_key = ? AND farm_id = ? AND game_open = 1 ORDER BY id DESC").get(x.key, f.id);
        if (seen && seen.auto_sig === x.sig) continue;
        if (seen) db.prepare('UPDATE fs_tasks SET game_open = 0 WHERE id = ?').run(seen.id);
        const prev = db.prepare("SELECT assignee_id FROM fs_tasks WHERE source = 'auto' AND auto_key = ? AND assignee_id IS NOT NULL ORDER BY id DESC").get(x.key);
        db.prepare(`INSERT INTO fs_tasks(farm_id, title, note, field, assignee_id, repeat, repeat_n, source, auto_key, auto_sig, game_open, created_at)
          VALUES (?, ?, ?, ?, ?, '', 1, 'auto', ?, ?, 1, ?)`).run(f.id, title, note, x.field || null, prev ? prev.assignee_id : null, x.key, x.sig, now());
      }
      for (const r of db.prepare("SELECT id, auto_key FROM fs_tasks WHERE source = 'auto' AND game_open = 1 AND farm_id = ?").all(f.id)) {
        if (!keys.has(r.auto_key)) db.prepare('UPDATE fs_tasks SET game_open = 0, done_at = COALESCE(done_at, ?) WHERE id = ?').run(now(), r.id);
      }
    }
  });
}
function hideSuggestion(key, sig) {
  db.prepare('INSERT INTO fs_hidden(key, sig, hidden_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET sig = excluded.sig, hidden_at = excluded.hidden_at').run(String(key).slice(0, 200), String(sig).slice(0, 2000), now());
  db.prepare('DELETE FROM fs_hidden WHERE hidden_at < ?').run(now() - 90 * 86400);
}
function takeSuggestion(user, farmId, key) {
  const s = suggestions(farmId).find(x => x.key === key);
  if (!s) return null;
  return addTask(user, farmId, { title: s.title, note: s.why, field: s.field, due: 'today' }, s.key);
}

// ---------- Kalender ----------
// Früchte für Kalender und Karte: aus dem Spiel (src/fscrops.js), nicht mehr von Hand
function crops() { return fscrops.sync(fsexport.current()); }
function crop(id) { return crops().find(c => c.id === Number(id)) || null; }
function plans(farmId) {
  crops();
  return db.prepare(`SELECT p.*, c.name AS crop, c.color, c.kind, c.fill FROM fs_plans p LEFT JOIN fs_crops c ON c.id = p.crop_id
    WHERE p.farm_id = ? ORDER BY p.field IS NULL, p.field, p.id`).all(Number(farmId));
}
function plan(id) { return db.prepare('SELECT * FROM fs_plans WHERE id = ?').get(Number(id)) || null; }
function addPlan(user, farmId, b) {
  const c = crop(b.crop_id);
  if (!c) return null;
  const field = intOr(b.field), label = oneLine(b.label, MAX.name) || null;
  // Nur eins gewählt: das andere aus der Wachstumsdauer der Frucht
  let sow = intOr(b.sow_month), harvest = intOr(b.harvest_month);
  if (sow === null && harvest !== null && c.kind !== 'perm') sow = fscrops.sowFor(c, harvest);
  if (harvest === null && sow !== null && c.kind !== 'perm') harvest = fscrops.harvestFor(c, sow);
  sow = sow ?? c.sowM[0] ?? 0; harvest = harvest ?? c.harvestM[0] ?? 0;
  return Number(db.prepare('INSERT INTO fs_plans(farm_id, field, label, crop_id, sow_month, harvest_month, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(Number(farmId), field, field ? null : (label || c.name), c.id, Math.max(0, Math.min(11, sow)), Math.max(0, Math.min(11, harvest)), clean(b.note, 300) || null, user.id, now()).lastInsertRowid);
}
function removePlan(id) { db.prepare('DELETE FROM fs_plans WHERE id = ?').run(Number(id)); }
// Zellen einer Planzeile: s = säen, g = wächst, h = ernten; über den Jahreswechsel geht es vorne weiter
function planCells(p) {
  const cells = Array(12).fill('');
  if (p.kind === 'perm') { for (let i = 0; i < 12; i++) cells[i] = 'g'; cells[p.harvest_month] = 'h'; return cells; }
  cells[p.sow_month] = 's';
  for (let i = (p.sow_month + 1) % 12, k = 0; i !== p.harvest_month && k < 12; i = (i + 1) % 12, k++) cells[i] = 'g';
  cells[p.harvest_month] = p.harvest_month === p.sow_month ? 's' : 'h';
  return cells;
}
// Hofkalender eines Kalenderjahrs, Januar links bis Dezember rechts, jeder Monat in seine Spieltage geteilt (Tage pro Monat aus
// dem Spielstand). Das Spieljahr beginnt mit dem Frühling (März, auf der Südhalbkugel September): die Monate ab Januar bis
// dahin sind das Ende von Spieljahr N−1. Zellen der Planzeilen: s = säen, g = wächst, h = ernten (gleich für jedes Jahr),
// Punkte = Aufgaben mit Spieltag.
function calendarYear(m) { return m && m.date ? m.date.year + (m.date.month >= N.ORDER[0] ? 1 : 0) : 1; }
function calendar(farmId, year, withRepeat = false) {
  const dpp = daysPerPeriod(), today = currentDay();
  const cols = N.ORDER.map(im => {
    const gy = im >= N.ORDER[0] ? year - 1 : year, first = gy >= 1 ? dayOfMonth(im, gy, dpp) : null;
    return { im, gy, name: N.MONTHS[im], short: N.MONTHS_SHORT[im], days: Array.from({ length: dpp }, (_, d) => ({ dom: d + 1, gday: first ? first + d : null })) };
  });
  const days = cols.flatMap(c => c.days.filter(d => d.gday)).map(d => d.gday);
  const lo = Math.min(...days, Infinity), hi = Math.max(...days, -Infinity);
  const all = db.prepare(`${TASK_SQL} WHERE (t.farm_id = ? OR t.farm_id = 0) AND t.due_day BETWEEN ? AND ?`).all(Number(farmId), lo, hi)
    .filter(t => withRepeat || !t.repeat).map(t => decorate(t));
  const byDay = new Map();
  for (const t of all) { if (!byDay.has(t.due_day)) byDay.set(t.due_day, []); byDay.get(t.due_day).push(t); }
  // Je Planzeile die Zellen in Anzeigereihenfolge, mit Rundung am Anfang (l) und Ende (r) eines Abschnitts
  const rows = plans(farmId).map(p => {
    const pc = planCells(p), flat = cols.flatMap(c => c.days.map(() => pc[c.im]));
    const cells = flat.map((c, i) => (c ? c + (flat[i - 1] !== c ? ' l' : '') + (flat[i + 1] !== c ? ' r' : '') : ''));
    const dots = new Map();
    if (p.field) for (const t of all) if (t.field === p.field) dots.set(t.due_day, (dots.get(t.due_day) || 0) + 1);
    return { ...p, cells, dots };
  });
  return { year, dpp, today, cols, rows, byDay, tasks: all.sort((a, b) => a.due_day - b.due_day || a.id - b.id) };
}

// ---------- Felder und Orte ----------
// Was auf den Grundstücken steht. Je Fleck aus den Dichtekarten (src/fsmap.js, „patch“: Hektar je Frucht, Zustand und
// Pflege), sonst je Feld aus dem letzten Autosave (fields.xml), sonst aus dem Hofkalender, was gerade wachsen müsste.
function cropFor(fruit, cs) {
  if (!fruit) return null;
  const c = cs.find(x => x.name === fruit || x.fill === fruit);
  if (c) return { name: c.label || c.name, color: c.color, fill: c.fill, fruit };
  return { name: N.fill(fruit), color: fscrops.hsl(fruit), fill: fruit, fruit };
}
function fieldCare(a, state) {
  const out = [];
  if (!a || state === 'gras' || state === 'gemaeht') return out;
  if (a.lime === 0) out.push({ key: 'kalk', label: 'Kalk nötig' });
  if (a.plow === 0) out.push({ key: 'pflug', label: 'Pflügen fällig' });
  if ((state === 'gesaet' || state === 'waechst') && a.spray < 2) out.push({ key: 'duenger', label: a.spray === 0 ? 'Nicht gedüngt' : 'Einmal gedüngt' });
  if ((state === 'gesaet' || state === 'waechst') && a.weed > 0) out.push({ key: 'unkraut', label: 'Unkraut' });
  if (a.stone > 0) out.push({ key: 'steine', label: 'Steine' });
  return out;
}
// Pflege je Fleck: was auf mehr als 3 % der Fläche (mindestens 0,05 ha) zu tun ist, mit Hektar
function patchCare(pt) {
  const out = [], min = Math.max(0.05, (pt.ha || 0) * 0.03), c = pt.care || {};
  const add = (key, ha, label) => { if (ha >= min) out.push({ key, ha, label: `${label} (${(Math.round(ha * 10) / 10).toLocaleString('de-DE')} ha)` }); };
  add('kalk', c.kalk || 0, 'Kalk nötig');
  add('pflug', c.pflug || 0, 'Pflügen fällig');
  const sown = ((pt.states || {}).gesaet || 0) + ((pt.states || {}).waechst || 0);
  if (sown >= min) add('duenger', Math.min(sown, (c.duenger1 || 0) + Math.max(0, sown - (c.duenger1 || 0) - (c.duenger2 || 0))), 'Düngen');
  return out;
}
const top = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0] || null;
function fieldStates() {
  const m = model(), cs = crops(), soil = soils(), ex = fsexport.current();
  const fx = ftpFile('fields.xml'), autoAt = fx ? fx.at : 0, liveFields = !!(fx && fx.live);
  // fields.xml nennt Felder; welches Feld auf welchem Grundstück liegt, sagt der Export (sonst gleiche Nummer). Liegen mehrere
  // auf einem Grundstück, zählt das größte.
  const exField = new Map(((ex && ex.fields) || []).map(f => [f.id, f]));
  const auto = new Map();
  for (const a of (fx && fx.list) || []) {
    const ef = exField.get(a.id), land = ef ? ef.farmland ?? a.id : a.id, ha = ef ? ef.ha : 0;
    const cur = auto.get(land);
    if (!cur || ha > cur.ha) auto.set(land, { ...a, ha });
  }
  const patches = ((shapes(m) || {}).ras || {}).parcels || {};
  const planned = new Map();
  for (const f of m.farms) for (const p of plans(f.id)) {
    if (!p.field) continue;
    const cells = planCells(p);
    if (m.month !== null && cells[m.month]) planned.set(p.field, p);
    else if (!planned.has(p.field)) planned.set(p.field, { ...p, future: true });
  }
  return m.fields.map(f => {
    const p = planned.get(f.id) || null, a = auto.get(f.id) || null, pt = patches[f.id] || null;
    const farm = m.farms.find(x => x.id === f.owner) || null;
    let crop = null, state = null, source = null, mix = [], states = [], care = [];
    // Live aus dem Spiel (Mod 3.3) schlägt die Dichtekarten vom letzten Autosave
    if (pt && pt.ha > 0 && !(a && liveFields)) {
      // Je Fleck: alle Früchte und Zustände mit Fläche, die größte bestimmt die Farbe in Listen
      mix = Object.entries(pt.fruits).sort((x, y) => y[1] - x[1]).map(([fruit, ha]) => ({ ...cropFor(fruit, cs), ha }));
      states = Object.entries(pt.states).sort((x, y) => y[1] - x[1]).map(([k, ha]) => ({ key: k, label: (N.STATES[k] || [k])[0], ha }));
      crop = mix[0] || null;
      state = (top(pt.states) || [null])[0];
      care = patchCare(pt);
      source = 'patch';
    } else if (a) {
      crop = cropFor(a.fruit, cs);
      state = N.GROUND[a.ground] || null;
      if (state === 'gesaet' && a.growth >= 2) state = 'waechst';
      care = fieldCare(a, state);
      source = 'auto';
    }
    if (!crop && f.orchard) { crop = cropFor(f.orchard, cs); source = source || 'orchard'; }
    if (!crop && p && !p.future) { crop = { name: p.crop, color: p.color, fill: p.fill }; source = source || 'plan'; }
    return { ...f, farm, plan: p, auto: a, autoAt, live: liveFields && source === 'auto', patch: pt, mix, states, source, soil: soil.get(f.id) || null, crop: crop ? crop.name : null, cropColor: crop ? crop.color : null,
      cropFill: crop ? crop.fill || null : null, state, care, ground: a && a.ground ? N.GROUND_LABEL[a.ground] || N.pretty(a.ground) : null };
  });
}
// Produktionsplaner (src/fsprod.js): Karte, eigene Gebäude, Katalog. Jedes Gebäude kennt seinen Hof.
function planner() {
  const m = model(), ex = fsexport.current();
  const lists = prod.all(ex, ftpFile('placeables.xml'), (x, z) => (Number.isFinite(x) && Number.isFinite(z) ? m.where(x, z).label : null));
  for (const list of Object.values(lists)) for (const b of list) b.farm = b.farmId ? m.farms.find(f => f.id === b.farmId) || null : null;
  return lists;
}
// Kartendaten: Umriss jedes Grundstücks aus dem Export (Kartenmaß 0–1000) und was je Fleck wächst (src/fsmap.js, ras).
// Ohne Export sind die Grundstücke Kreise, ohne Dichtekarten gibt es keine Flecken (dann gilt fields.xml je Feld).
let outlineMem = null;
function shapes(m = model()) {
  const ex = fsexport.current(), size = m.size || 2048;
  const osig = ex ? fsexport.sig(ex) + ':' + size : '-';
  if (!outlineMem || outlineMem.sig !== osig) {
    const out = {};
    for (const [id, pts] of Object.entries(fsexport.outlines(ex))) if (pts.length >= 3) {
      const c = fsmap.labelPoint(pts), P = v => +((v + size / 2) / size * 1000).toFixed(1);
      out[id] = { d: fsmap.polyPath(pts, size), cx: P(c[0]), cy: P(c[1]) };
    }
    outlineMem = { sig: osig, shapes: out };
  }
  let ras = null;
  if (getSetting('fs_shapes', '1') === '1') {
    const f = feeds.get('ftp'), cs = fscrops.list(ex);
    const grid = ex && ex.grid ? { size: ex.grid.size, lab: fsexport.gridLabels(ex) } : null;
    ras = fsmap.load(feeds.FS_DIR, (f && f.files) || {}, {
      mapSize: size, sig: osig + ':' + cs.map(c => c.name + c.density + c.color).join(','), fruits: cs, grid,
      fields: ((ftpFile('fields.xml') || {}).list || []), polys: Object.fromEntries(((ex && ex.fields) || []).map(x => [x.id, x.pts])),
      colorOf: name => (cs.find(c => c.name === name) || {}).color || (/^\?/.test(name) ? '#9aa394' : fscrops.hsl(name)),
      stateColor: k => (N.STATES[k] || [0, '#5aa83c'])[1],
    });
  }
  return { shapes: outlineMem.shapes, ras, game: Object.keys(outlineMem.shapes).length };
}
// Bodenverteilung je Grundstück (von Hand aus dem Spiel abgeschrieben): Prozent je Bodenart und Ertragspotenzial
const SOILS = [['loamy_sand', 'Lehmiger Sand', '#e6be3c'], ['sandy_loam', 'Sandiger Lehm', '#86b56a'], ['loam', 'Lehm', '#a89a8c'], ['silty_clay', 'Schluffiger Ton', '#8f74b8']];
function soils() {
  return new Map(db.prepare('SELECT * FROM fs_soil').all().map(r => {
    const parts = SOILS.map(([k, label, color]) => ({ key: k, label, color, pct: r[k] })).filter(x => x.pct > 0);
    const top = parts.slice().sort((a, b) => b.pct - a.pct)[0] || null;
    return [r.field, { parts, top: top ? top.key : null, yield: r.yield, at: r.updated_at }];
  }));
}
function saveSoil(field, b, userId) {
  const id = intOr(field);
  if (!id || !model().fields.some(f => f.id === id)) return false;
  const pct = v => { const n = Number(String(v ?? '').replace(',', '.').replace('%', '').replace('~', '').trim()); return v === '' || v == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(n, 300)); };
  const vals = [...SOILS.map(([k]) => pct(b[k])), pct(b.yield)];
  if (vals.every(v => v === null)) { db.prepare('DELETE FROM fs_soil WHERE field = ?').run(id); return true; }
  db.prepare(`INSERT INTO fs_soil(field, loamy_sand, sandy_loam, loam, silty_clay, yield, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(field) DO UPDATE SET loamy_sand = excluded.loamy_sand, sandy_loam = excluded.sandy_loam, loam = excluded.loam, silty_clay = excluded.silty_clay,
              yield = excluded.yield, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(id, ...vals, userId || null, now());
  return true;
}
function fieldOwner(fieldId) { const f = model().fields.find(x => x.id === Number(fieldId)); return f ? f.owner : 0; }
function savePlace(id, b) {
  const name = oneLine(b.name, MAX.name), x = Number(b.x), z = Number(b.z);
  if (!name || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const r = Math.max(5, Math.min(300, Number(b.radius) || 30)), farmId = intOr(b.farm_id, 0) || 0;
  if (id) db.prepare('UPDATE fs_places SET name = ?, farm_id = ?, x = ?, z = ?, radius = ? WHERE id = ?').run(name, farmId, x, z, r, Number(id));
  else id = Number(db.prepare('INSERT INTO fs_places(name, farm_id, x, z, radius) VALUES (?, ?, ?, ?, ?)').run(name, farmId, x, z, r).lastInsertRowid);
  invalidate();
  return id;
}
function place(id) { return db.prepare('SELECT * FROM fs_places WHERE id = ?').get(Number(id)) || null; }
function removePlace(id) {
  db.prepare('UPDATE fs_tasks SET place_id = NULL WHERE place_id = ?').run(Number(id));
  db.prepare('DELETE FROM fs_places WHERE id = ?').run(Number(id));
  invalidate();
}
// Paletten eines Hofs, die an keinem Ort stehen, in Haufen (50 m um die Mitte) – daraus lassen sich Orte anlegen
function palletSpots(f) {
  const spots = [];
  for (const v of f.pallets) {
    if (v.where.place || v.x === null) continue;
    let s = spots.find(p => Math.hypot(p.sx / p.n - v.x, p.sz / p.n - v.z) < 50);
    if (!s) spots.push(s = { n: 0, fills: {}, label: v.where.label, sx: 0, sz: 0 });
    s.n++; s.sx += v.x; s.sz += v.z;
    for (const [t, l] of v.fill) s.fills[t] = (s.fills[t] || 0) + l;
  }
  return spots.map(s => ({ ...s, x: Math.round(s.sx / s.n), z: Math.round(s.sz / s.n), fills: Object.entries(s.fills).map(([t, l]) => ({ fill: t, name: N.fill(t), amount: l })) }))
    .sort((a, b) => b.n - a.n);
}

// ---------- Online-Zeiten ----------
function sessionsToday() {
  const start = Math.floor(new Date(today() + 'T00:00:00').getTime() / 1000) - 7200;
  const rows = db.prepare('SELECT name, start_at, end_at FROM fs_sessions WHERE COALESCE(end_at, ?) >= ? ORDER BY start_at').all(now(), start);
  const by = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (!by.has(k)) by.set(k, { name: r.name, minutes: 0, last: 0, online: false });
    const e = by.get(k);
    e.minutes += Math.max(0, ((r.end_at || now()) - Math.max(r.start_at, start)) / 60);
    e.last = Math.max(e.last, r.end_at || now());
    if (!r.end_at) e.online = true;
  }
  return [...by.values()].sort((a, b) => b.last - a.last);
}
function sessionTotals(days = 30) {
  return db.prepare(`SELECT name, COUNT(*) AS n, SUM(COALESCE(end_at, ?) - start_at) AS secs, MAX(COALESCE(end_at, ?)) AS last FROM fs_sessions
    WHERE start_at >= ? GROUP BY name COLLATE NOCASE ORDER BY secs DESC`).all(now(), now(), now() - days * 86400);
}

// ---------- Changelog und Vorschläge ----------
function changelog(limit = 100) {
  return db.prepare('SELECT c.*, u.username, u.display_name FROM fs_changelog c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC, c.id DESC LIMIT ?').all(limit);
}
function addChange(user, b) {
  const title = oneLine(b.title, MAX.title);
  if (!title) return null;
  return Number(db.prepare("INSERT INTO fs_changelog(user_id, kind, title, body, created_at) VALUES (?, 'note', ?, ?, ?)").run(user.id, title, clean(b.body, MAX.body) || null, now()).lastInsertRowid);
}
function removeChange(id) { db.prepare('DELETE FROM fs_changelog WHERE id = ?').run(Number(id)); }
// Updates der Website, die den Hub betreffen (Titel mit „Farming“ in der CHANGELOG.md), kommen einmal von selbst
// in den Changelog. Gemerkt wird jeder übernommene Eintrag, damit ein gelöschter nicht wiederkommt.
function importUpdates(list = require('./changelog').all()) {
  let seen;
  try { seen = new Set(JSON.parse(getSetting('fs_changelog_seen', '[]'))); } catch { seen = new Set(); }
  const ins = db.prepare("INSERT INTO fs_changelog(kind, title, body, created_at) VALUES ('update', ?, ?, ?)");
  let n = 0;
  tx(() => {
    for (const s of list.slice().reverse()) {
      const key = s.date + ' ' + s.title;
      if (!/farming/i.test(s.title) || seen.has(key)) continue;
      const at = s.date && !Number.isNaN(Date.parse(s.date + 'T12:00:00Z')) ? Math.floor(Date.parse(s.date + 'T12:00:00Z') / 1000) : now();
      ins.run(s.title.slice(0, MAX.title), s.items.map(i => '• ' + i).join('\n').slice(0, MAX.body) || null, at);
      seen.add(key);
      n++;
    }
  });
  if (n) setSetting('fs_changelog_seen', JSON.stringify([...seen]));
  return n;
}
function ideas(userId, status = null) {
  const rows = db.prepare(`SELECT s.*, u.username, u.display_name, u.avatar, (SELECT COUNT(*) FROM fs_votes v WHERE v.suggestion_id = s.id) AS votes,
      EXISTS(SELECT 1 FROM fs_votes v WHERE v.suggestion_id = s.id AND v.user_id = ?) AS voted
    FROM fs_suggestions s LEFT JOIN users u ON u.id = s.user_id ${status ? 'WHERE s.status = ?' : ''}
    ORDER BY CASE s.status WHEN 'offen' THEN 0 WHEN 'geplant' THEN 1 WHEN 'umgesetzt' THEN 2 ELSE 3 END, votes DESC, s.created_at DESC`).all(...[userId || 0, ...(status ? [status] : [])]);
  return rows;
}
function idea(id) { return db.prepare('SELECT * FROM fs_suggestions WHERE id = ?').get(Number(id)) || null; }
function addIdea(user, b) {
  const title = oneLine(b.title, MAX.title);
  if (!title) return null;
  const id = Number(db.prepare('INSERT INTO fs_suggestions(user_id, title, body, created_at) VALUES (?, ?, ?, ?)').run(user.id, title, clean(b.body, MAX.body) || null, now()).lastInsertRowid);
  notify.toAdmins('🚜 Neuer Vorschlag zum Farming Hub', title, '/farming/vorschlaege#v' + id, 'fs-idea');
  return id;
}
function editIdea(id, b) {
  const title = oneLine(b.title, MAX.title);
  if (title) db.prepare('UPDATE fs_suggestions SET title = ?, body = ?, updated_at = ? WHERE id = ?').run(title, clean(b.body, MAX.body) || null, now(), Number(id));
}
function answerIdea(id, b) {
  const s = idea(id);
  if (!s) return;
  const status = Object.hasOwn(STATUS, b.status) ? b.status : s.status;
  db.prepare('UPDATE fs_suggestions SET status = ?, answer = ?, updated_at = ? WHERE id = ?').run(status, clean(b.answer, 1000) || null, now(), s.id);
  if (status !== s.status && s.user_id) notify.send(s.user_id, 'fshub', { key: 'fs-idea-' + s.id, title: `🚜 Dein Vorschlag: ${STATUS[status]}`, body: s.title, url: '/farming/vorschlaege#v' + s.id });
}
function removeIdea(id) { db.prepare('DELETE FROM fs_suggestions WHERE id = ?').run(Number(id)); }
function vote(id, userId) {
  if (db.prepare('SELECT 1 FROM fs_votes WHERE suggestion_id = ? AND user_id = ?').get(Number(id), userId)) db.prepare('DELETE FROM fs_votes WHERE suggestion_id = ? AND user_id = ?').run(Number(id), userId);
  else if (idea(id)) db.prepare('INSERT INTO fs_votes(suggestion_id, user_id) VALUES (?, ?)').run(Number(id), userId);
}

// ---------- Preise ----------
function goods(m = model()) {
  const ec = m.economy;
  if (!ec) return [];
  const have = new Map();
  for (const f of m.farms) for (const s of f.stock) have.set(s.fill, (have.get(s.fill) || 0) + s.amount);
  for (const f of m.farms) for (const c of f.cargo) have.set(c.fill, (have.get(c.fill) || 0) + c.amount);
  const cur = m.month;
  return Object.entries(ec.prices).filter(([k]) => !NOT_GOODS.test(k)).map(([k, p]) => {
    const vals = p.map(v => v || 0);
    const best = vals.indexOf(Math.max(...vals));
    const nowP = cur !== null ? vals[cur] : null;
    const next = cur !== null ? vals[(cur + 1) % 12] : null;
    return { fill: k, name: N.fill(k), prices: vals, now: nowP, trend: nowP && next ? Math.round((next - nowP) / nowP * 100) : null, best, bestPrice: vals[best],
      group: CROPS.has(k) ? 'feld' : ANIMAL_GOODS.has(k) ? 'tiere' : 'produkte', have: have.get(k) || 0, demand: ec.demands.find(d => d.fill === k) || null };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ---------- Modliste ----------
const modKey = s => String(s || '').toLowerCase().replace(/^fs\d\d_/, '').replace(/[^a-z0-9]/g, '');
function modCompare(m = model()) {
  const ml = require('./modlists');
  const slug = getSetting('fs_modlist', '');
  const list = slug ? ml.bySlug(slug) : null;
  const items = list ? ml.categories(list.id).flatMap(c => c.rows.map(r => ({ ...r, category: c.name }))) : [];
  const keys = new Map(items.map(i => [modKey(i.name), i]));
  const mods = m.mods.map(x => {
    const it = keys.get(modKey(x.title)) || keys.get(modKey(x.name)) || null;
    if (it) it.matched = true;
    return { ...x, dlc: /^pdlc_/.test(x.name), item: it };
  });
  return { list, mods, missing: items.filter(i => !i.matched) };
}
// Server-Haken der verknüpften Modliste nach dem Server setzen
function syncModlist(m = model()) {
  const { list, mods, missing } = modCompare(m);
  if (!list) return 0;
  const on = new Set(mods.filter(x => x.item).map(x => x.item.id));
  let changed = 0;
  tx(() => {
    for (const it of [...mods.filter(x => x.item).map(x => x.item), ...missing]) {
      const want = on.has(it.id) ? 1 : 0;
      if (!!it.on_server !== !!want) { db.prepare('UPDATE mod_items SET on_server = ? WHERE id = ?').run(want, it.id); changed++; }
    }
  });
  return changed;
}

// ---------- Hintergrund der Übersicht ----------
// Je Karte ein Bild (Seitenverwaltung), liegt als bg-<karte>.<png|jpg|webp> im Datenordner. Läuft eine andere Karte, gilt deren Bild.
const slug = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function mapName() { const live = feeds.liveSave(), ex = fsexport.current(); return (live && live.mapTitle) || (ex && ex.mapTitle) || ''; }
function backgrounds() {
  return fs.readdirSync(feeds.FS_DIR).map(f => /^bg-([a-z0-9-]+)\.(png|jpe?g|webp)$/.exec(f)).filter(Boolean).map(x => ({ key: x[1], file: path.join(feeds.FS_DIR, x[0]), name: x[0] }));
}
function backgroundFile(name = mapName()) { const k = slug(name) || 'karte'; const b = backgrounds().find(x => x.key === k); return b ? b.file : null; }
function saveBackground(buf, ext, name = mapName()) {
  const k = slug(name) || 'karte';
  for (const b of backgrounds()) if (b.key === k) fs.rmSync(b.file, { force: true });
  fs.writeFileSync(path.join(feeds.FS_DIR, `bg-${k}.${ext}`), buf);
}
function removeBackground(key) { for (const b of backgrounds()) if (b.key === key) fs.rmSync(b.file, { force: true }); }

// Konto gelöscht: Mitgliedschaft geht mit (Fremdschlüssel), Aufgaben bleiben ohne Zuständigen
function start() {
  crops();
  importUpdates();
  feeds.start();
  require('./fslive').start();
  checkSave();
  // Uhr: erst nach dem zweiten Abruf weiß der Hub, ob sie läuft
}

module.exports = {
  mapName, backgrounds, backgroundFile, saveBackground, removeBackground, slug,
  STATUS, stations: fsst, fscrops, wiki: fswiki, exportData: () => fsexport.current(), parcelAt: (x, z) => fsexport.parcelAt(fsexport.current(), x, z), REPEAT, MAX, SUPPLIES, DEFAULT_COLORS, enabled, canView, canEditFarm, farmOf, model, invalidate, farm, feed, ftpFile,
  currentDay, setDay, estimateDay, calendarYear, dateOf, dayOfMonth, fmtDay, hhmm, daysPerPeriod, today, accountFor, history, record,
  join, leave, setMember, saveFarm, notes, addNote, note, canChangeNote, editNote, removeNote,
  tasks, openTasks, task, addTask, editTask, completeTask, reopenTask, removeTask, isDue, dueLabel, repeatLabel,
  suggestions, syncAuto, hideSuggestion, takeSuggestion, crops, crop, plans, plan, addPlan, removePlan, planCells, calendar,
  planner, prod, SOILS, soils, saveSoil, fieldStates, fieldOwner, savePlace, place, removePlace, palletSpots, sessionsToday, sessionTotals,
  changelog, addChange, removeChange, importUpdates, shapes, ideas, idea, addIdea, editIdea, answerIdea, removeIdea, vote, goods, modCompare, syncModlist, start,
  _clock: clock, _onStats: onStats,
};
