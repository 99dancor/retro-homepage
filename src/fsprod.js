'use strict';
// Farming Simulator Hub: Produktionsplaner. Drei Bereiche:
//
//   Karte     Produktionen, die zur Karte gehören (vorplatziert), mit Besitzer und Lage. Ziel beim Klick aufs Kartensymbol.
//   Eigene    Gebäude, die ein Hof selbst gebaut hat, mit Lager (Füllstand und Platz beim letzten Speichern) und welche
//             Produktionen laufen.
//   Katalog   alle Produktionen, die man im Shop kaufen kann, mit Preis und Rezepten.
//
// Alles kommt aus dem Spiel (Mod „FS25 Hub Link“, src/fsexport.js): Rezepte, Zyklen und Kosten pro Monat, ob sich die
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
// Gebäude, wie sie ein englischer Server nennt (Shop-Name) → deutsch wie im Spiel
const NAMES_EN = {
  'Bakery': 'Bäckerei', 'Biogas Plant': 'Biogasanlage', 'Canning Factory': 'Konservenfabrik', 'Carpentry': 'Tischlerei', 'Cement Factory': 'Zementwerk',
  'Cereal Factory': 'Müslifabrik', 'Coffee Processing Plant': 'Kaffeeverarbeitung', 'Coffee Roastery': 'Kaffeerösterei', 'Coffee Shop': 'Café', 'Cooper': 'Böttcherei',
  'Dairy': 'Molkerei', 'Grain Mill': 'Getreidemühle', 'Grape Processing Unit': 'Traubenverarbeitung', 'Oil Mill': 'Ölmühle', 'Paint Production': 'Farbenfabrik',
  'Paper Factory': 'Papierfabrik', 'Pigment Factory': 'Pigmentfabrik', 'Potato Processing Plant': 'Kartoffelverarbeitung', 'Preserved Food Factory': 'Konservenfabrik',
  'Rope Maker': 'Seilerei', 'Sawmill': 'Sägewerk', 'Soup Factory': 'Suppenfabrik', 'Spinnery': 'Spinnerei', 'Sugar Mill': 'Zuckerfabrik', 'Tailor Shop': 'Schneiderei',
  'Banana Drying Station': 'Bananentrocknung', 'Banana Washing Station': 'Bananenwäsche', 'Fish Food Factory': 'Fischfutterfabrik', 'Fish Lake': 'Fischteich',
  'Quarry': 'Steinbruch', 'Stone Mason': 'Steinmetz', 'Vegetable Processing Plant': 'Gemüseverarbeitung', 'Windmill': 'Windmühle', 'Young Fish Breeding': 'Jungfischzucht',
  'Liquid Manure Dryer': 'Gülletrockner', 'Apple Orchard': 'Apfelplantage', 'Apricot Orchard': 'Aprikosenplantage', 'Pear Orchard': 'Birnenplantage', 'Plum Orchard': 'Pflaumenplantage',
  'Fruit and Vegetable Processing Plant': 'Obst- und Gemüseverarbeitung', 'Pellet Heat Plant': 'Pelletheizwerk', 'Greenhouse For Rice Saplings': 'Gewächshaus für Reissetzlinge',
  'Pigsty': 'Schweinestall', 'Cowshed': 'Kuhstall', 'Cow Barn': 'Kuhstall', 'Chicken Coop': 'Hühnerstall', 'Sheep Pasture': 'Schafweide', 'Goat Pasture': 'Ziegenweide',
  'Horse Stable': 'Pferdestall', 'Alpaca Pasture': 'Alpakaweide', 'Buffalo Barn': 'Büffelstall', 'Beehive': 'Bienenstock',
  'Glass Greenhouse': 'Glasgewächshaus', 'Mushroom Greenhouse': 'Pilzgewächshaus', 'Tarp Greenhouse': 'Foliengewächshaus', 'Greenhouse - Advanced': 'Gewächshaus (modern)',
};
const SIZE_EN = { Small: 'klein', Medium: 'mittel', Large: 'groß' };
// Englischer Name → deutsch: ganzer Name, sonst ohne Größe (Small/Medium/Large) bzw. Zusatz in Klammern und Leistung (99kW)
function germanBuilding(name) {
  if (NAMES_EN[name]) return NAMES_EN[name];
  const m = /^(Small|Medium|Large) (.+?)( \((.+)\))?$/.exec(name);
  if (m && NAMES_EN[m[2]]) return `${NAMES_EN[m[2]]} (${SIZE_EN[m[1]]}${m[4] ? ', ' + (N.FILL[m[4].toUpperCase()] || m[4]) : ''})`;
  const p = /^(.+?) \(([^)]+)\)$/.exec(name);
  if (p && NAMES_EN[p[1]]) return `${NAMES_EN[p[1]]} (${SIZE_EN[p[2][0].toUpperCase() + p[2].slice(1).toLowerCase()] || p[2]})`;
  const k = /^(.+?) (\d+\s*k?MW|\d+\s*kW)$/i.exec(name);
  if (k && NAMES_EN[k[1]]) return `${NAMES_EN[k[1]]} ${k[2]}`;
  return null;
}
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
// Name aus dem Spiel nur, wenn es deutsch spricht (de) und keine Platzhalter drinstehen; sonst nach dem Erzeugnis
function recipe(r, de) {
  const inputs = rows(r.inputs), outputs = rows(r.outputs);
  const game = r.name && !/^\$l10n|%s/.test(r.name) ? r.name : null;
  return { id: r.id, name: de && game ? game : outputs.length ? outputs[0].name : game || recipeName(r.id), fromGame: !!(de && game), cycles: r.cycles > 0 ? r.cycles : null,
    cost: r.cost ?? null, inputs, outputs, active: !!r.active, complete: r.cycles > 0 && outputs.length > 0 };
}
// Mehrere Rezepte eines Gebäudes mit gleichem Namen (Brot aus Mehl, Brot aus Reismehl): um die Zutaten ergänzen, die sie unterscheiden
function distinct(recipes) {
  const groups = new Map();
  for (const r of recipes) if (!r.fromGame) groups.set(r.name, [...(groups.get(r.name) || []), r]);
  for (const [name, list] of groups) {
    if (list.length < 2) continue;
    const all = list.map(r => new Set(r.inputs.map(x => x.fill)));
    const owns = list.map(r => r.inputs.filter(x => !all.every(s => s.has(x.fill))));
    // Ein Rezept ohne eigene Zutat ist das Grundrezept und behält den schlichten Namen
    const plain = owns.filter(o => !o.length).length === 1;
    list.forEach((r, i) => {
      const own = owns[i];
      r.name = own.length ? `${name} aus ${own.map(x => x.name).join(' + ')}` : plain ? name : `${name} ${i + 1}`;
    });
  }
  return recipes;
}
const modeOf = (shared, n) => (n > 1 ? (shared ? 'seriell' : 'parallel') : '');

// Alle Gebäude in drei Bereichen. ex: Export (oder null), plc: placeables.xml (Fallback ohne Mod und für Füllstände),
// where(x, z) → Lage als Text, catalogName(file) für den Namen aus dem Shop
function all(ex, plc, where = () => null) {
  const out = { karte: [], eigene: [], katalog: [] };
  const cat = new Map(((ex && ex.catalog) || []).map(b => [b.file, b]));
  // Spricht das Spiel nicht deutsch, gelten unsere Namen; eigene Namen, die ein Spieler vergeben hat, bleiben
  const de = !ex || !ex.language || /^de/i.test(ex.language);
  const nameOf = (game, type) => (game ? (de ? game : germanBuilding(game) || (NAMES[type] && !NAMES_EN[game] ? NAMES[type] : null) || game) : buildingName(type));
  const place = (p, section) => {
    const type = typeOf(p), c = cat.get(p.file);
    const name = nameOf(p.name || (c && c.name), type);
    const recipes = distinct(p.recipes.map(r => recipe(r, de)));
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
    // Gleiche Gebäude in mehreren Fassungen (Bäckerei für jede Region der Grundspielkarten): nur einmal
    const seen = new Set();
    for (const c of cat.values()) {
      const recipes = distinct(c.recipes.map(r => recipe(r, de)));
      // Regionale Fassungen unterscheiden sich oft nur in der Taktzahl; es zählt die erste (Grundspiel vor DLC)
      const sig = [c.name, c.dlc, c.price, recipes.map(r => r.id).join(',')].join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.katalog.push({ key: 'k:' + c.file, section: 'katalog', type: typeOf({ file: c.file }), file: c.file, name: nameOf(c.name, typeOf({ file: c.file })) + (/productionPointsSmall/i.test(c.file) ? ' (klein)' : ''),
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

module.exports = { NAMES, MODES, germanBuilding, SECTIONS, typeOf, buildingName, recipeName, isPreplaced, all, uses, calc };
