'use strict';
// Farming Simulator Hub: Stationen auf der Karte (Fabriken, Verkaufsstellen, Tankstellen, Händler …) wie die Hotspots im Spiel.
//
//   Welche es gibt und wo sie stehen, schreibt die Mod „Farming Hub Export“ (src/fsexport.js): Position, Kartensymbol, was
//   eine Verkaufsstelle annimmt und eine Ladestation verkauft. placeables.xml ergänzt das Kartensymbol (mapIcon_<art>).
//   Ohne die Mod kennt der Hub die Stationen, aber nicht ihre Lage (vorplatzierte stehen nur in der Karte selbst).
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
  const k = (p.icon || '') + ' ' + type + ' ' + (p.hotspot || '');
  if (/gasStation|chargingStation|electricCharging|biomethane|methaneGas|fuelStation|FUEL/i.test(k)) return 'tanken';
  if (/vehicleShop|sellingStationVehicles|animalDealer|animalTrader|SHOP|ANIMAL/i.test(k)) return 'haendler';
  if (p.production || (p.productions || []).length || /PRODUCTION/i.test(k)) return 'produktion';
  if (/buyingStation|limeStation/i.test(k) || (p.buys || []).length) return 'einkauf';
  if ((p.sells || []).length) return 'verkauf';
  return 'sonstiges';
}
function nameOf(p, type) {
  if (p.name) return p.name;
  if (p.icon && ICON_NAMES[p.icon]) return ICON_NAMES[p.icon];
  if (ICON_NAMES[type]) return ICON_NAMES[type];
  return prod.buildingName(p.kind === 'production' || !p.icon ? type : p.icon);
}
// Alle Stationen der Karte: ohne Besitzer oder mit Kartensymbol (gehört zu einem Grundstück, z. B. Biomethan-Tankstelle).
// ex: Export (mit Position), plc: placeables.xml (Kartensymbol, ohne Mod die ganze Liste). Gleichnamige bekommen eine Nummer.
function list(ex, plc) {
  const icons = new Map((plc || []).filter(p => p.uid).map(p => [p.uid, p]));
  const src = ex && ex.placeables.length ? ex.placeables.map(p => ({ ...p, icon: (icons.get(p.uid) || {}).icon || '', productions: p.production ? p.production.recipes : [] }))
    : (plc || []).filter(p => p.kind === 'station' || p.kind === 'production').map(p => ({ ...p, buys: [], hotspot: '' }));
  const out = [];
  for (const p of src) {
    if (!p.uid || (p.farmId !== 0 && !p.icon && !p.hotspot && !prod.isPreplaced(p))) continue;
    const s = { ...p, sells: p.sells || [], buys: p.buys || [] }, type = prod.typeOf(s), cat = catOf(s, type);
    const placed = Number.isFinite(p.x) && Number.isFinite(p.z);
    out.push({ uid: p.uid, type, icon: p.icon || '', name: nameOf(s, type), cat, sells: s.sells, buys: s.buys, productions: (p.productions || []).map(r => r.id),
      farmId: p.farmId || 0, planner: cat === 'produktion' ? p.uid : null, x: placed ? p.x : null, z: placed ? p.z : null, placed });
  }
  const seen = new Map();
  for (const s of out) seen.set(s.name, (seen.get(s.name) || 0) + 1);
  const n = new Map();
  for (const s of out) if (seen.get(s.name) > 1) { n.set(s.name, (n.get(s.name) || 0) + 1); s.name += ' ' + n.get(s.name); }
  const order = Object.keys(CATS);
  return out.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.name.localeCompare(b.name, 'de'));
}

module.exports = { CATS, ICON_NAMES, catOf, list };
