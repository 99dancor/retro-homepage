'use strict';
// Farming Simulator Hub: Produktionsplaner. Welche Produktionsgebäude es gibt, was sie kosten, was ihre Produktionen
// brauchen und liefern, und ein Rechner: aus so viel Input wird so viel Output in so vielen Zyklen.
//
//   Gebäude und Produktionen kommen aus placeables.xml (FTP): jedes Gebäude mit <productionPoint> und seinen
//   <production id="…">, vorplatzierte mit Kaufpreis. Rezepte, Zyklen pro Monat, Kosten und ob die Produktionen
//   parallel oder seriell laufen, stehen nur in den Spieldateien (.gar/.dlc). Die trägt ein Admin im Planer nach.
//   Parallel: jede aktive Produktion hat ihre vollen Zyklen. Seriell: alle aktiven teilen sich die Zyklen des Gebäudes.
const { db, now } = require('./db');
const N = require('./fsnames');

const NAMES = {
  bakery: 'Bäckerei', carpentry: 'Tischlerei', coffeeDryingPlant: 'Kaffeeverarbeitung', coffeeRoastery: 'Kaffeerösterei', coffeeShop: 'Café',
  dairy: 'Molkerei', oilPlant: 'Ölmühle', oilMill: 'Ölmühle', paperFactory: 'Papierfabrik', pigmentFactory: 'Pigmentfabrik', spinnery: 'Spinnerei',
  sugarMill: 'Zuckerfabrik', cannedFoodFactory: 'Konservenfabrik', tailorShop: 'Schneiderei', paintProductionFactory: 'Farbenfabrik', sawmill: 'Sägewerk',
  grainMill: 'Getreidemühle', cementFactory: 'Zementwerk', cerealFactory: 'Müslifabrik', ropeMaker: 'Seilerei', preservedFoodFactory: 'Konservenfabrik',
  riceMill: 'Reismühle', grapeProcessing: 'Traubenverarbeitung', winery: 'Weingut', greenhouse: 'Gewächshaus', compostPlant: 'Kompostanlage',
};
const MODES = { parallel: 'Parallel', seriell: 'Seriell' };
const MAX_ROWS = { in: 6, out: 4 };

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
// Produktion: als Ware bekannt (bread → Brot), sonst lesbar gemacht (bananaCake → Banana Cake)
function recipeName(id) {
  const code = String(id).toUpperCase();
  if (N.FILL[code]) return N.FILL[code];
  return words(id).replace(/\b\w/g, c => c.toUpperCase());
}
// Ware aus der Eingabe: Kürzel (WHEAT) oder deutscher Name (Weizen) → Kürzel, sonst nur der Name
const BY_NAME = new Map(Object.entries(N.FILL).map(([k, v]) => [v.toLowerCase(), k]));
function fillOf(text) {
  const t = String(text || '').trim().slice(0, 40);
  if (!t) return null;
  const code = t.toUpperCase().replace(/\s+/g, '_');
  if (N.FILL[code]) return { fill: code, name: N.FILL[code] };
  const k = BY_NAME.get(t.toLowerCase());
  return k ? { fill: k, name: N.FILL[k] } : { fill: null, name: t };
}

// ---------- Abgleich mit dem Spielstand ----------
let synced = null;
function sync(plc) {
  const sig = plc ? plc.length + ':' + plc.reduce((a, p) => a + p.productions.length, 0) : '';
  if (!plc || synced === sig) return;
  const addB = db.prepare('INSERT OR IGNORE INTO fs_prod_buildings(key, name, price, updated_at) VALUES (?, ?, ?, ?)');
  const price = db.prepare('UPDATE fs_prod_buildings SET price = ? WHERE key = ? AND price IS NULL');
  const addR = db.prepare('INSERT OR IGNORE INTO fs_prod_recipes(building, id, name, position) VALUES (?, ?, ?, ?)');
  for (const p of plc) {
    if (p.kind !== 'production' || !p.productions.length) continue;
    const key = typeOf(p);
    addB.run(key, buildingName(key), p.price > 0 ? p.price : null, now());
    if (p.price > 0) price.run(p.price, key);
    p.productions.forEach((r, i) => addR.run(key, r.id, recipeName(r.id), i));
  }
  synced = sig;
}

const parse = s => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
function recipes(key) {
  return db.prepare('SELECT * FROM fs_prod_recipes WHERE building = ? ORDER BY position, name').all(key)
    .map(r => ({ ...r, inputs: parse(r.inputs), outputs: parse(r.outputs), complete: r.cycles > 0 && parse(r.outputs).length > 0 }));
}
// Alle Gebäude mit ihren Produktionen und wo sie auf der Karte stehen (instances: aus placeables.xml)
function buildings(plc, where = () => null) {
  sync(plc);
  const inst = new Map();
  for (const p of plc || []) {
    if (p.kind !== 'production' || !p.productions.length) continue;
    const k = typeOf(p);
    if (!inst.has(k)) inst.set(k, []);
    inst.get(k).push({ farmId: p.farmId, where: where(p.x, p.z), on: p.productions.filter(r => r.on).map(r => r.id), fills: p.fills });
  }
  return db.prepare('SELECT * FROM fs_prod_buildings ORDER BY name').all().map(b => {
    const rs = recipes(b.key);
    return { ...b, recipes: rs, instances: inst.get(b.key) || [], done: rs.filter(r => r.complete).length };
  });
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

// ---------- Bearbeiten (Admins) ----------
// Zahl aus dem Formular: 1.500,5, 370.000 oder 1500.5
const numOr = (v, max = 1e9) => { const t = String(v ?? '').trim(), n = Number(t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
  return v === '' || v == null || !Number.isFinite(n) || n < 0 ? null : Math.min(n, max); };
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function building(key) { return db.prepare('SELECT * FROM fs_prod_buildings WHERE key = ?').get(String(key)) || null; }
function saveBuilding(key, b) {
  const name = text(b.name, 60);
  const mode = Object.hasOwn(MODES, b.mode) ? b.mode : '';
  if (!key) {
    if (!name) return null;
    key = 'eigen-' + Date.now().toString(36);
    db.prepare('INSERT INTO fs_prod_buildings(key, name, price, mode, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(key, name, numOr(b.price), mode, text(b.note, 300), now());
    return key;
  }
  if (!building(key)) return null;
  db.prepare('UPDATE fs_prod_buildings SET name = COALESCE(NULLIF(?, \'\'), name), price = ?, mode = ?, note = ?, updated_at = ? WHERE key = ?')
    .run(name, numOr(b.price), mode, text(b.note, 300), now(), key);
  return key;
}
function removeBuilding(key) { db.prepare('DELETE FROM fs_prod_buildings WHERE key = ?').run(String(key)); }
// Zeilen aus dem Formular: in_fill_0, in_amount_0 … (Ware als Name oder Kürzel, Menge je Zyklus)
function rows(b, side) {
  const out = [];
  for (let i = 0; i < MAX_ROWS[side]; i++) {
    const f = fillOf(b[`${side}_fill_${i}`]), a = numOr(b[`${side}_amount_${i}`], 1e7);
    if (f && a > 0) out.push({ ...f, amount: a });
  }
  return out;
}
function saveRecipe(key, id, b) {
  if (!building(key)) return null;
  const name = text(b.name, 60);
  const cur = id && db.prepare('SELECT * FROM fs_prod_recipes WHERE building = ? AND id = ?').get(key, String(id));
  if (id && !cur) return null;
  if (!cur && !name) return null;
  const vals = [name || cur.name, numOr(b.cycles, 1e6), numOr(b.cost), JSON.stringify(rows(b, 'in')), JSON.stringify(rows(b, 'out'))];
  if (cur) db.prepare('UPDATE fs_prod_recipes SET name = ?, cycles = ?, cost = ?, inputs = ?, outputs = ? WHERE building = ? AND id = ?').run(...vals, key, cur.id);
  else {
    id = 'eigen-' + Date.now().toString(36);
    const pos = (db.prepare('SELECT MAX(position) AS p FROM fs_prod_recipes WHERE building = ?').get(key).p ?? -1) + 1;
    db.prepare('INSERT INTO fs_prod_recipes(building, id, name, cycles, cost, inputs, outputs, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(key, id, ...vals, pos);
  }
  db.prepare('UPDATE fs_prod_buildings SET updated_at = ? WHERE key = ?').run(now(), key);
  return cur ? cur.id : id;
}
function removeRecipe(key, id) { db.prepare('DELETE FROM fs_prod_recipes WHERE building = ? AND id = ?').run(String(key), String(id)); }

module.exports = { NAMES, MODES, MAX_ROWS, typeOf, buildingName, recipeName, fillOf, sync, buildings, recipes, calc, building, saveBuilding, removeBuilding, saveRecipe, removeRecipe, forget: () => { synced = null; } };
