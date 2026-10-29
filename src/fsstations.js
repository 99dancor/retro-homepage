'use strict';
// Farming Simulator Hub: Stationen auf der Karte (Fabriken, Verkaufsstellen, Tankstellen, Händler …) wie die Hotspots im Spiel.
//
//   Welche es gibt, steht in placeables.xml (src/fsfeeds.js): Kartensymbol (mapIcon_<art>), Art aus der uniqueId, was eine
//   Verkaufsstelle annimmt. Vorplatzierte Stationen haben dort keine Position, die steht nur in der Karte (.dlc, verschlüsselt).
//   Ein Admin setzt sie deshalb einmal je Spielstand per Klick auf die Karte (fs_stations). Selbst gebaute haben ihre Position.
const { db, now } = require('./db');
const prod = require('./fsprod');

// Reihenfolge = Reihenfolge der Filter, Farben angelehnt an die Hotspots im Spiel
const CATS = {
  verkauf: ['Verkaufsstellen', '#b5227a'],
  einkauf: ['Ladestationen', '#2b5fc7'],
  produktion: ['Produktionen', '#1aa9b8'],
  tanken: ['Tankstellen', '#d9822b'],
  haendler: ['Händler', '#c9b21a'],
  sonstiges: ['Sonstiges', '#6f8f3a'],
};
const ICON_NAMES = {
  sanctuary: 'Gnadenhof', rentTrain: 'Zugvermietung', trainNorth: 'Bahnhof', artShop: 'Kunsthändler', railroadSiloNorth: 'Bahnsilo',
  warehouse: 'Lagerhaus', animalDealer: 'Tierhändler', supermarket: 'Supermarkt', hospital: 'Krankenhaus', buyingStationLiquidManure: 'Gülle kaufen',
  buyingStationManure: 'Mist kaufen', logisticsCenter: 'Logistikzentrum', sellingStationStones: 'Steine verkaufen', vehicleShop: 'Fahrzeughändler',
  biogasPlant: 'Biogasanlage', ironMine: 'Eisenmine', gasStationCity: 'Tankstelle (Stadt)', gasStation: 'Tankstelle', electricChargingStation1: 'Ladesäule',
  electricChargingStation2: 'Ladesäule', electricChargingStation: 'Ladesäule', farmersMarket: 'Bauernmarkt', grainElevator: 'Getreidesilo', GCHBGrainElevator: 'Getreidesilo',
  biomethaneStation: 'Biomethan-Tankstelle', researchCenter: 'Forschungszentrum', coffeeProcessingPlant: 'Kaffeeverarbeitung', canningFactory: 'Konservenfabrik',
  paintFactory: 'Farbenfabrik', oilMill: 'Ölmühle', limeStation: 'Kalk kaufen', buyingStationLime: 'Kalk kaufen', buyingStationFertilizer: 'Dünger kaufen',
  buyingStationSeeds: 'Saatgut kaufen', buyingStationHerbicide: 'Herbizid kaufen', buyingStationWater: 'Wasser kaufen', woodSellingStation: 'Holzverkauf',
};

// Art der Station aus Kartensymbol, Typ und Inhalt
function catOf(p, type) {
  const k = (p.icon || '') + ' ' + type;
  if (/gasStation|chargingStation|electricCharging|biomethane|fuelStation/i.test(k)) return 'tanken';
  if (/vehicleShop|sellingStationVehicles|animalDealer|animalTrader/i.test(k)) return 'haendler';
  if (/buyingStation/i.test(k)) return 'einkauf';
  if (p.kind === 'production' || p.productions.length) return 'produktion';
  if (p.sells.length) return 'verkauf';
  return 'sonstiges';
}
function nameOf(p, type) {
  if (p.name) return p.name;
  if (p.icon && ICON_NAMES[p.icon]) return ICON_NAMES[p.icon];
  if (ICON_NAMES[type]) return ICON_NAMES[type];
  return prod.buildingName(p.kind === 'production' || !p.icon ? type : p.icon);
}
const positions = () => new Map(db.prepare('SELECT * FROM fs_stations').all().map(r => [r.uid, r]));

// Alle Stationen mit Position (aus dem Spielstand oder von Hand gesetzt, sonst x/z null). Gleichnamige bekommen eine Nummer.
function list(plc) {
  const pos = positions(), out = [];
  for (const p of plc || []) {
    // Stationen der Karte: ohne Besitzer, oder mit Kartensymbol (gehört zu einem Grundstück, z. B. Biomethan-Tankstelle)
    if (!p.uid || p.kind === 'orchard' || (p.farmId !== 0 && !p.icon)) continue;
    if (p.kind !== 'station' && p.kind !== 'production' && !p.icon && !(p.sells || []).length) continue;
    const s = { ...p, sells: p.sells || [] }, type = prod.typeOf(s), cat = catOf(s, type), own = pos.get(p.uid);
    const x = p.x ?? (own ? own.x : null), z = p.z ?? (own ? own.z : null);
    out.push({ uid: p.uid, type, icon: p.icon || '', name: nameOf(s, type), cat, sells: s.sells, productions: p.productions.map(r => r.id),
      planner: cat === 'produktion' ? type : null, x, z, placed: x !== null && x !== undefined, fixed: p.x !== null && p.x !== undefined });
  }
  const seen = new Map();
  for (const s of out) seen.set(s.name, (seen.get(s.name) || 0) + 1);
  const n = new Map();
  for (const s of out) if (seen.get(s.name) > 1) { n.set(s.name, (n.get(s.name) || 0) + 1); s.name += ' ' + n.get(s.name); }
  const order = Object.keys(CATS);
  return out.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.name.localeCompare(b.name, 'de'));
}

// Position setzen (Weltkoordinaten) oder mit null wieder wegnehmen
function place(uid, x, z, userId) {
  uid = String(uid || '').slice(0, 120);
  if (!uid) return false;
  if (x === null || z === null) { db.prepare('DELETE FROM fs_stations WHERE uid = ?').run(uid); return true; }
  if (![x, z].every(v => Number.isFinite(v) && Math.abs(v) <= 10000)) return false;
  db.prepare(`INSERT INTO fs_stations(uid, x, z, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(uid) DO UPDATE SET x = excluded.x, z = excluded.z, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(uid, Math.round(x * 10) / 10, Math.round(z * 10) / 10, userId || null, now());
  return true;
}

module.exports = { CATS, ICON_NAMES, catOf, list, place, positions };
