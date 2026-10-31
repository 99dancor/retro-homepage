'use strict';
// Farming Simulator Hub: Kartendaten aus dem Spiel selbst, geschrieben von der Mod „FS25 Hub Link“
// (games/fs25-export/FS25_FarmingHubExport). Die Mod läuft auf dem Spieleserver und legt bei jedem Speichern
// farmingHubExport.xml in den Spielstand-Ordner. Der Hub holt sie per FTP wie die anderen Dateien, oder ein Admin lädt sie
// hoch (Einzelspieler: Konsole „hubExport“).
//
//   Felder       Umriss jedes Felds in Weltkoordinaten, auch Felder, die noch kein Acker sind
//   Grundstücke  Nummer, Mitte, Größe, Preis, Besitzer und die Grundstückskarte (Läufe „Nummer*Länge“ je Zeile).
//                Aus der Karte werden hier Umrisse für jedes Grundstück, dann braucht die XML nicht im Speicher zu bleiben.
//   Gebäude      uniqueId (wie in placeables.xml), Position, Kartensymbol, was sie annehmen oder verkaufen, Rezepte,
//                welche Produktionen laufen und was im Lager liegt (Füllstand und Platz)
//   Waren        (ab Version 2) Name in der Sprache des Spiels, Grundpreis, Gewicht
//   Früchte      (ab Version 2) Wachstumsstufen, Saat- und Erntemonate, Ertrag, Saatgut, Kartenfarbe, Wert in der Dichtekarte
//   Katalog      (ab Version 2) alle Produktionen aus dem Shop mit Preis, Rezepten und Lagerplatz
//   Tiere        (ab 2.4) Tierarten mit Futter, Erzeugnissen, Preisen, Nachwuchs, Futtergruppen (→ src/fswiki.js, wiki.xml),
//                bei jedem Stall Tiere, Produktivität und Füllstände wie im Menü „Tiere“
//
// Warum eine Mod: DLC-Karten liegen verschlüsselt in .dlc-Dateien, das Grundspiel gepackt in .gar. Beides liest der Hub
// nicht, und den Schutz zu umgehen kommt nicht in Frage. Das laufende Spiel kennt alles und darf es weitergeben.
const fs = require('node:fs');
const path = require('node:path');
const X = require('./fsxml');
const fsmap = require('./fsmap');

const FILE = 'farmingHubExport.xml';
const MOD_DIR = path.join(__dirname, '..', 'games', 'fs25-export', 'FS25_FarmingHubExport');
const MOD_NAME = 'FS25_FarmingHubExport';

const num = (v, d = null) => X.num(v, d);
const pts = s => String(s || '').trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));
const fills = s => String(s || '').split(/\s+/).filter(Boolean);

// Grundstückskarte → Umriss je Grundstück in Weltkoordinaten (größte zusammenhängende Fläche).
// Gemeinsame Grenzen werden einmal begradigt, damit Nachbarn genau dieselbe Linie haben (keine Treppen, keine Doppellinien).
const EPS = 1.3;
function parcels(rows, size, mapSize) {
  if (!size || rows.length !== size) return {};
  const lab = labels(rows, size), box = new Map();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const id = lab[y * size + x];
      if (!id) continue;
      const b = box.get(id);
      if (!b) box.set(id, { x0: x, y0: y, x1: x, y1: y });
      else { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; b.y1 = y; }
    }
  }
  const rings = new Map();
  for (const [id, b] of box) { const r = fsmap.outline(lab, size, id, b); if (r) rings.set(id, r); }
  const cell = mapSize / size, out = {};
  for (const [id, ring] of fsmap.simplifyShared(lab, size, rings, EPS)) out[id] = ring.map(([x, y]) => [+(x * cell - mapSize / 2).toFixed(1), +(y * cell - mapSize / 2).toFixed(1)]);
  return out;
}
// Umrisse eines Exports: aus der Grundstückskarte neu berechnet (gemerkt), damit ältere gespeicherte Exporte die begradigten Grenzen bekommen
const outlineCache = new WeakMap();
function outlines(e) {
  const g = e && e.grid;
  if (!g || !g.size || g.rows.length !== g.size) return (e && e.parcels) || {};
  if (!outlineCache.has(g)) outlineCache.set(g, parcels(g.rows, g.size, e.mapSize || 2048));
  return outlineCache.get(g);
}

const recipe = r => ({
  id: r.a.id, name: r.a.name || '', cycles: num(r.a.cyclesPerMonth), cost: num(r.a.costsPerMonth), active: r.a.active === 'true', status: num(r.a.status),
  inputs: X.all(X.kid(r, 'inputs'), 'input').map(i => ({ fill: i.a.fillType, amount: num(i.a.amount, 0) })).filter(i => i.fill),
  outputs: X.all(X.kid(r, 'outputs'), 'output').map(o => ({ fill: o.a.fillType, amount: num(o.a.amount, 0), sell: o.a.sellDirectly === 'true' })).filter(o => o.fill),
});
// Stall (ab 2.4): Tiere, Produktivität, Zustand (Stroh, Wasser, Mist, Gülle, Milch …) und Futter je Gruppe wie im Menü „Tiere“
const husbandry = h => (h ? {
  type: h.a.type || '', animals: num(h.a.animals), max: num(h.a.maxAnimals), productivity: num(h.a.productivity),
  infos: X.kids(h, 'info').map(i => ({ kind: i.a.kind === 'food' ? 'food' : 'condition', title: i.a.title || '', value: num(i.a.value, 0), cap: num(i.a.capacity), ratio: num(i.a.ratio), inverted: i.a.inverted === 'true' })),
  clusters: X.kids(h, 'cluster').map(c => ({ sub: c.a.subType || '', n: num(c.a.num, 0), age: num(c.a.age, 0), health: num(c.a.health), repro: num(c.a.reproduction) })),
} : null);
const periods = s => String(s || '').split(/\s+/).map(Number).filter(p => Number.isInteger(p) && p >= 1 && p <= 12).map(p => p - 1);

function read(xml, at = Math.floor(Date.now() / 1000)) {
  const s = X.parse(xml);
  if (s.n !== 'farmingHubExport') throw new Error('Keine Datei der Mod „FS25 Hub Link“.');
  const mapSize = num(s.a.mapSize, 2048);
  const fields = X.all(s, 'field').map(f => ({ id: num(f.a.id), farmland: num(f.a.farmland), ha: num(f.a.areaHa, 0), x: num(f.a.x), z: num(f.a.z), pts: pts(f.a.pts) }))
    .filter(f => f.id !== null && f.pts.length >= 3);
  const lands = X.kid(s, 'farmlands');
  const farmlands = X.kids(lands, 'farmland').map(f => ({ id: num(f.a.id), area: num(f.a.areaHa, 0), price: num(f.a.price, 0), owner: num(f.a.owner, 0), x: num(f.a.x), z: num(f.a.z), hidden: f.a.hidden === 'true' }))
    .filter(f => f.id !== null);
  const map = X.kid(lands, 'map');
  const grid = map ? { size: num(map.a.size, 0), rows: X.kids(map, 'row').map(r => r.t) } : null;
  const placeables = X.kids(X.kid(s, 'placeables'), 'placeable').map(p => {
    const point = X.kid(p, 'productionPoint');
    return {
      uid: p.a.uniqueId || '', file: p.a.filename || '', type: p.a.type || '', name: p.a.name || '', farmId: num(p.a.farmId, 0), x: num(p.a.x), z: num(p.a.z),
      hotspot: p.a.hotspot || '', price: num(p.a.price), sells: fills(p.a.sells), buys: fills(p.a.buys),
      production: point ? {
        shared: point.a.shared !== 'false',
        recipes: X.kids(point, 'production').map(recipe).filter(r => r.id),
        storage: X.kids(X.kid(point, 'storage'), 'fill').map(f => ({ fill: f.a.fillType, level: num(f.a.level, 0), cap: num(f.a.capacity) })).filter(f => f.fill),
      } : null,
      stall: husbandry(X.kid(p, 'husbandry')),
    };
  });
  // Version 2: Waren, Früchte und der Katalog aller Produktionen aus dem Shop
  const ft = X.kid(s, 'fillTypes');
  const fillTypes = X.kids(ft, 'fillType').filter(f => f.a.name).map(f => ({ name: f.a.name, title: f.a.title || '', price: num(f.a.price), mass: num(f.a.mass), priceTable: f.a.priceTable === 'true' }));
  const fruitTypes = X.kids(X.kid(s, 'fruitTypes'), 'fruitType').filter(f => f.a.name).map(f => ({
    name: f.a.name, index: num(f.a.index), density: num(f.a.density), fill: f.a.fillType || f.a.name, states: num(f.a.growthStates),
    harvestMin: num(f.a.harvestMin), harvestMax: num(f.a.harvestMax), cut: num(f.a.cut), withered: num(f.a.withered), regrows: f.a.regrows === 'true',
    literPerSqm: num(f.a.literPerSqm), seedPerSqm: num(f.a.seedPerSqm), windrow: f.a.windrow || '', color: /^#[0-9a-f]{6}$/i.test(f.a.color || '') ? f.a.color : null,
    sow: periods(f.a.plant), harvest: periods(f.a.harvest), seeding: f.a.noSeeding !== 'true',
  }));
  // Mod bis 2.4 las die Monate falsch aus: jede Frucht „2–12“ zum Säen und Ernten. Dann lieber die Vorlage im Hub nehmen.
  const broken = list => list.length === 11 && list[0] === 1 && list[10] === 11;
  if (fruitTypes.length > 1 && fruitTypes.every(f => broken(f.sow) && broken(f.harvest))) for (const f of fruitTypes) { f.sow = []; f.harvest = []; }
  const catalog = X.kids(X.kid(s, 'catalog'), 'building').filter(b => b.a.filename).map(b => ({
    file: b.a.filename, name: b.a.name || '', price: num(b.a.price), category: b.a.category || '', dlc: b.a.dlc || '', shared: b.a.shared !== 'false', capacity: num(b.a.capacity),
    recipes: X.kids(b, 'production').map(recipe).filter(r => r.id),
    storage: X.kids(X.kid(b, 'storage'), 'capacity').map(c => ({ fill: c.a.fillType, cap: num(c.a.capacity) })).filter(c => c.fill),
  }));
  return {
    version: num(s.a.version, 1), mapId: s.a.mapId || '', mapTitle: s.a.mapTitle || '', mapSize, hemisphere: s.a.hemisphere || '', saveDate: s.a.saveDate || '', day: num(s.a.day), dpp: num(s.a.daysPerPeriod), at,
    fields, farmlands, placeables, grid, parcels: grid ? parcels(grid.rows, grid.size, mapSize) : {},
    language: (ft && ft.a.language) || '', fillTypes, fruitTypes, catalog, animals: require('./fswiki').parse(X.kid(s, 'animals')),
  };
}

// ---------- Hochgeladen ----------
const uploadFile = () => path.join(require('./fsfeeds').FS_DIR, 'hub-export.json');
let mem = null;
function uploaded() {
  try {
    const f = uploadFile(), t = fs.statSync(f).mtimeMs;
    if (!mem || mem.t !== t) mem = { t, data: JSON.parse(fs.readFileSync(f, 'utf8')) };
    return mem.data;
  } catch { mem = null; return null; }
}
function upload(buf) {
  const data = read(buf.toString('utf8'));
  // Mit Zeitpunkt, damit ein neuer Upload den älteren Export vom FTP schlägt (current nimmt den neuesten)
  fs.writeFileSync(uploadFile(), JSON.stringify({ ...data, source: 'upload', at: require('./db').now() }));
  mem = null;
  return data;
}
function removeUpload() { fs.rmSync(uploadFile(), { force: true }); mem = null; }

// Der neueste Export (FTP oder hochgeladen), der zur Karte des laufenden Spielstands passt
function current() {
  const feeds = require('./fsfeeds');
  const f = feeds.get('ftp'), ftp = f && f.files && f.files[FILE] ? { ...f.files[FILE], source: 'ftp' } : null;
  const live = feeds.liveSave();
  const fits = e => e && (!live || !e.mapTitle || e.mapTitle === live.mapTitle);
  const list = [ftp, uploaded()].filter(fits).sort((a, b) => (b.at || 0) - (a.at || 0));
  return list[0] || null;
}
// Für Seitenverwaltung und Status: was da ist, ohne die großen Listen
function summary(e) {
  if (!e) return null;
  const prods = e.placeables.filter(p => p.production);
  return { source: e.source, mapTitle: e.mapTitle, saveDate: e.saveDate, at: e.at, fields: e.fields.length, farmlands: e.farmlands.length, parcels: Object.keys(e.parcels).length,
    stations: e.placeables.filter(p => p.x !== null).length, productions: prods.length, recipes: prods.reduce((a, p) => a + p.production.recipes.length, 0),
    version: e.version || 1, fillTypes: (e.fillTypes || []).length, fruitTypes: (e.fruitTypes || []).length, catalog: (e.catalog || []).length,
    animals: e.animals ? e.animals.types.length : 0, stalls: e.placeables.filter(p => p.stall).length };
}
const sig = e => (e ? `${e.source}:${e.at}:${e.fields.length}:${Object.keys(e.parcels).length}` : '-');

// ---------- Anwenden ----------
// Grundstück, zu dem ein Punkt gehört (Weltkoordinaten), aus der Grundstückskarte; 0 = keins
function parcelAt(e, x, z) {
  const g = e && e.grid, lab = gridLabels(e);
  if (!lab || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const S = e.mapSize || 2048, c = Math.floor((x + S / 2) / S * g.size), r = Math.floor((z + S / 2) / S * g.size);
  return c < 0 || r < 0 || c >= g.size || r >= g.size ? 0 : lab[r * g.size + c];
}
// Grundstücksnummer je Zelle der Grundstückskarte (size × size), gemerkt je Export (nicht im Export selbst, der wird als JSON gespeichert)
const labCache = new WeakMap();
function gridLabels(e) {
  const g = e && e.grid;
  if (!g || !g.size || g.rows.length !== g.size) return null;
  if (!labCache.has(g)) labCache.set(g, labels(g.rows, g.size));
  return labCache.get(g);
}
function labels(rows, size) {
  const lab = new Uint16Array(size * size);
  rows.forEach((row, y) => {
    let x = 0;
    for (const run of String(row).trim().split(/\s+/)) {
      const [id, len] = run.split('*').map(Number);
      if (!Number.isFinite(id) || !(len > 0)) continue;
      const end = Math.min(size, x + len);
      if (id > 0 && id < 255) lab.fill(id, y * size + x, y * size + end);
      x = end;
    }
  });
  return lab;
}
// Positionen aus dem Spiel für Gebäude aus placeables.xml, die dort keine haben (vorplatzierte)
function withPositions(plc, e) {
  if (!plc || !e) return plc;
  const pos = new Map(e.placeables.filter(p => p.uid && p.x !== null).map(p => [p.uid, p]));
  return plc.map(p => ((p.x === null || p.x === undefined) && pos.has(p.uid) ? { ...p, x: pos.get(p.uid).x, z: pos.get(p.uid).z, fromGame: true } : p));
}

// ---------- Die Mod zum Herunterladen ----------
// Symbol 256 × 256 als unkomprimiertes DDS (BGRA): grünes Feld mit hellem Pfeil nach oben
function icon() {
  const n = 256, head = Buffer.alloc(128);
  head.write('DDS ', 0);
  head.writeUInt32LE(124, 4); head.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x8, 8); head.writeUInt32LE(n, 12); head.writeUInt32LE(n, 16); head.writeUInt32LE(n * 4, 20);
  head.writeUInt32LE(32, 76); head.writeUInt32LE(0x41, 80); head.writeUInt32LE(32, 88);
  head.writeUInt32LE(0x00ff0000, 92); head.writeUInt32LE(0x0000ff00, 96); head.writeUInt32LE(0x000000ff, 100); head.writeUInt32LE(0xff000000, 104);
  head.writeUInt32LE(0x1000, 108);
  const px = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const stripe = Math.floor((x + y) / 24) % 2, arrow = (y >= 60 && y < 130 && Math.abs(x - 128) < (y - 50)) || (y >= 130 && y < 200 && Math.abs(x - 128) < 26);
      const [r, g, b] = arrow ? [246, 241, 214] : stripe ? [74, 128, 46] : [92, 150, 58];
      const o = (y * n + x) * 4;
      px[o] = b; px[o + 1] = g; px[o + 2] = r; px[o + 3] = 255;
    }
  }
  return Buffer.concat([head, px]);
}
function modZip() {
  const zip = new (require('adm-zip'))();
  for (const f of fs.readdirSync(MOD_DIR)) zip.addFile(f, fs.readFileSync(path.join(MOD_DIR, f)));
  zip.addFile('icon_farmingHubExport.dds', icon());
  return zip.toBuffer();
}

module.exports = { FILE, MOD_NAME, read, parcels, outlines, labels, gridLabels, parcelAt, upload, uploaded, removeUpload, current, summary, sig, withPositions, modZip, icon };
