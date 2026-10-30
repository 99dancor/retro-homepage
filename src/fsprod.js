'use strict';
// Farming Simulator Hub: Produktionsplaner. Drei Bereiche:
//
//   Karte     Produktionen, die zur Karte gehören (vorplatziert), mit Besitzer und Lage. Ziel beim Klick aufs Kartensymbol.
//   Eigene    Gebäude, die ein Hof selbst gebaut hat, mit Lager (Füllstand und Platz beim letzten Speichern) und welche
//             Produktionen laufen.
//   Katalog   alle Produktionen, die man im Shop kaufen kann, mit Preis und Rezepten.
//
// Alles kommt aus dem Spiel (Mod „Farming Hub Export“, src/fsexport.js): Rezepte, Zyklen und Kosten pro Monat, ob sich die
// Produktionen eines Gebäudes die Zyklen teilen (seriell) oder jede für sich läuft (parallel). Ohne die Mod kennt der Hub aus
// placeables.xml nur Gebäude und Namen der Produktionen. Von Hand eingetragen wird nichts.
const N = require('./fsnames');

const NAMES = {
  bakery: 'Bäckerei', carpentry: 'Tischlerei', coffeeDryingPlant: 'Kaffeetrocknung', coffeeRoastery: 'Kaffeerösterei', coffeeShop: 'Café',
  dairy: 'Molkerei', oilPlant: 'Ölmühle', oilMill: 'Ölmühle', paperFactory: 'Papierfabrik', pigmentFactory: 'Pigmentfabrik', spinnery: 'Spinnerei',
  sugarMill: 'Zuckerfabrik', cannedFoodFactory: 'Konservenfabrik', tailorShop: 'Schneiderei', paintProductionFactory: 'Farbenfabrik', sawmill: 'Sägewerk',
  grainMill: 'Getreidemühle', cementFactory: 'Zementwerk', cerealFactory: 'Müslifabrik', ropeMaker: 'Seilerei', preservedFoodFactory: 'Konservenfabrik',
  riceMill: 'Reismühle', grapeProcessing: 'Traubenverarbeitung', winery: 'Weingut', greenhouse: 'Gewächshaus', compostPlant: 'Kompostanlage',
  bga1mw: 'Biogasanlage', sanctuary: 'Gnadenhof',
};
const MODES = { parallel: 'Parallel', seriell: 'Seriell' };
const SECTIONS = { karte: 'Auf der Karte', eigene: 'Eigene Gebäude', katalog: 'Katalog' };

// Art eines Gebäudes: Dateiname der Placeable-XML, bei vorplatzierten aus der uniqueId (preplaced_bakery_<hash>)
function typeOf(p) {
  const file = String(p.file || '').split('/').pop().replace(/\.xml$/i, '');
  if (file && !/^mapIcon_/i.test(file)) return file;
  const m = /^preplaced_(.+?)_[0-9a-f]{16,}$/i.exec(p.uid || '');
  return m ? m[1] : file || 'gebaeude';
}
const words = s => String(s).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
function buildingName(type) {
  if (NAMES[type]) return NAMES[type];
  if (/^bga|biogas/i.test(type)) return 'Biogasanlage';
  return N.pretty(words(type).toUpperCase().replace(/ /g, '_'));
}
// Produktion ohne Namen aus dem Spiel: als Ware bekannt (bread → Brot), sonst lesbar gemacht (bananaCake → Banana Cake)
function recipeName(id) {
  const code = String(id).toUpperCase();
  if (N.FILL[code]) return N.FILL[code];
  return words(id).replace(/\b\w/g, c => c.toUpperCase());
}
const isPreplaced = p => /^preplaced_/i.test(p.uid || '');
const rows = list => (list || []).filter(x => x.fill && x.amount > 0).map(x => ({ fill: x.fill, name: N.fill(x.fill), amount: x.amount, sell: !!x.sell }));
function recipe(r) {
  const inputs = rows(r.inputs), outputs = rows(r.outputs);
  return { id: r.id, name: r.name && !/^\$l10n/.test(r.name) ? r.name : recipeName(r.id), cycles: r.cycles > 0 ? r.cycles : null, cost: r.cost ?? null,
    inputs, outputs, active: !!r.active, complete: r.cycles > 0 && outputs.length > 0 };
}
const modeOf = (shared, n) => (n > 1 ? (shared ? 'seriell' : 'parallel') : '');

// Alle Gebäude in drei Bereichen. ex: Export (oder null), plc: placeables.xml (Fallback ohne Mod und für Füllstände),
// where(x, z) → Lage als Text, catalogName(file) für den Namen aus dem Shop
function all(ex, plc, where = () => null) {
  const out = { karte: [], eigene: [], katalog: [] };
  const cat = new Map(((ex && ex.catalog) || []).map(b => [b.file, b]));
  const place = (p, section) => {
    const type = typeOf(p), c = cat.get(p.file);
    const name = p.name || (c && c.name) || buildingName(type);
    const recipes = p.recipes.map(recipe);
    return { key: p.uid, section, type, file: p.file, name, price: p.price || (c && c.price) || null, mode: modeOf(p.shared, recipes.length),
      recipes, storage: p.storage || [], farmId: p.farmId || 0, x: p.x, z: p.z, where: where(p.x, p.z), catalog: c ? 'k:' + c.file : null, uid: p.uid };
  };
  if (ex && ex.placeables.some(p => p.production)) {
    for (const p of ex.placeables) {
      if (!p.production || !p.production.recipes.length) continue;
      const storage = p.production.storage.map(s => ({ fill: s.fill, name: N.fill(s.fill), level: s.level, cap: s.cap }));
      const b = place({ ...p, recipes: p.production.recipes, shared: p.production.shared, storage }, isPreplaced(p) || !p.farmId ? 'karte' : 'eigene');
      out[b.section].push(b);
    }
  } else {
    // Ohne Mod: nur, was placeables.xml weiß (Gebäude, Namen der Produktionen, ob sie laufen, Lagerstand)
    for (const p of plc || []) {
      if (p.kind !== 'production' || !p.productions.length) continue;
      const storage = p.fills.filter(([sec]) => /production/i.test(sec)).map(([, fill, level]) => ({ fill, name: N.fill(fill), level, cap: null }));
      const b = place({ ...p, recipes: p.productions.map(r => ({ id: r.id, active: r.on })), shared: true, storage }, isPreplaced(p) || !p.farmId ? 'karte' : 'eigene');
      out[b.section].push(b);
    }
  }
  if (cat.size) {
    for (const c of cat.values()) {
      const recipes = c.recipes.map(recipe);
      out.katalog.push({ key: 'k:' + c.file, section: 'katalog', type: typeOf({ file: c.file }), file: c.file, name: c.name || buildingName(typeOf({ file: c.file })),
        price: c.price, mode: modeOf(c.shared, recipes.length), recipes, storage: c.storage.map(s => ({ fill: s.fill, name: N.fill(s.fill), level: null, cap: s.cap })),
        capacity: c.capacity, category: c.category, dlc: c.dlc });
    }
  } else {
    // Mod Version 1: Katalog aus den Gebäuden, die es auf der Karte gibt (je Art eins)
    const seen = new Set();
    for (const b of [...out.karte, ...out.eigene]) {
      if (seen.has(b.type)) continue;
      seen.add(b.type);
      out.katalog.push({ ...b, key: 'k:' + (b.file || b.type), section: 'katalog', storage: b.storage.map(s => ({ ...s, level: null })), farmId: 0, where: null, x: null, z: null });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  out.karte.sort(byName);
  out.eigene.sort((a, b) => a.farmId - b.farmId || byName(a, b));
  // Katalog: Grundspiel zuerst, dann je DLC bzw. Mod
  out.katalog.sort((a, b) => !!a.dlc - !!b.dlc || String(a.dlc || '').localeCompare(String(b.dlc || ''), 'de') || byName(a, b));
  // Gleich benannte Gebäude auf der Karte (zwei Biogasanlagen): mit Lage oder Nummer unterscheiden
  for (const list of [out.karte, out.eigene]) {
    const n = new Map();
    for (const b of list) n.set(b.name, (n.get(b.name) || 0) + 1);
    const k = new Map();
    for (const b of list) if (n.get(b.name) > 1) { k.set(b.name, (k.get(b.name) || 0) + 1); b.label = b.where ? `${b.name} (${b.where})` : `${b.name} ${k.get(b.name)}`; }
  }
  for (const list of Object.values(out)) for (const b of list) b.label = b.label || b.name;
  return out;
}

// Wo eine Ware in Produktionen vorkommt: { input: [{ building, recipe }], output: […] }. Katalog zuerst (je Art eins), dazu
// Gebäude der Karte, die es im Shop nicht gibt.
function uses(sections, fill) {
  const out = { input: [], output: [] };
  const seen = new Set();
  const add = b => {
    for (const r of b.recipes) {
      for (const side of ['input', 'output']) {
        if (!(side === 'input' ? r.inputs : r.outputs).some(x => x.fill === fill)) continue;
        const k = side + '|' + b.type + '|' + r.id;
        if (seen.has(k)) continue;
        seen.add(k);
        out[side].push({ building: b, recipe: r, amount: (side === 'input' ? r.inputs : r.outputs).find(x => x.fill === fill).amount });
      }
    }
  };
  for (const b of sections.katalog) add(b);
  for (const b of [...sections.karte, ...sections.eigene]) add(b);
  return out;
}

// ---------- Rechner ----------
// amounts: verfügbare Menge je Input (gleiche Reihenfolge wie recipe.inputs). cycles: gewünschte Zyklen (ohne Inputs).
// shared: wie viele Produktionen im seriellen Gebäude gleichzeitig laufen (teilen sich die Zyklen). dpp: Spieltage pro Monat.
function calc(recipe, { amounts = [], cycles = null, shared = 1, dpp = 1 } = {}) {
  const ins = recipe.inputs.filter(x => x.amount > 0);
  let n;
  if (ins.length && amounts.some(a => a !== null && a !== undefined)) {
    n = Math.min(...ins.map(x => { const a = amounts[recipe.inputs.indexOf(x)]; return Math.floor((a > 0 ? a : 0) / x.amount + 1e-9); }));
  } else n = Math.max(0, Math.floor(cycles || 0));
  const per = recipe.cycles > 0 ? recipe.cycles / Math.max(1, shared) : null;
  const months = per ? n / per : null;
  return {
    cycles: n,
    used: recipe.inputs.map((x, i) => ({ ...x, need: x.amount * n, have: amounts[i] ?? null, left: amounts[i] != null ? Math.max(0, amounts[i] - x.amount * n) : null })),
    made: recipe.outputs.map(x => ({ ...x, total: x.amount * n })),
    months, days: months !== null ? months * dpp : null, cost: months !== null && recipe.cost ? months * recipe.cost : null,
    perMonth: per, perYear: per ? per * 12 : null, perDay: per ? per / Math.max(1, dpp) : null,
  };
}

module.exports = { NAMES, MODES, SECTIONS, typeOf, buildingName, recipeName, isPreplaced, all, uses, calc };
