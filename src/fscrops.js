'use strict';
// Farming Simulator Hub: Früchte. Was sich anbauen lässt, wann gesät und geerntet wird, Wachstumsstufen, Ertrag und Farbe.
//
// Alles kommt aus dem Spiel (Mod „FS25 Hub Link“ ab Version 2, src/fsexport.js): Saat- und Erntemonate der Karte,
// Stufen, Ertrag und Saatgut je Quadratmeter, die Farbe der Frucht auf der Karte im Spiel. Ohne die Mod gilt der
// FS25-Kalender unten. Von Hand eingetragen wird nichts mehr. Die Tabelle fs_crops hält die Früchte nur, damit Anbaupläne
// (fs_plans.crop_id) ihre Frucht behalten; sie wird hier aus den Daten gefüllt.
const { db, tx } = require('./db');
const N = require('./fsnames');

// FS25-Kalender (Monate 0 = März … 11 = Februar): [Frucht, Farbe, säen, ernten, Art]
// Art: field = Feldfrucht, grass = wächst nach dem Schnitt nach, perm = Dauerkultur (Plantage, Weinberg, Pappeln)
const PRESET = {
  WHEAT: ['#e2c044', [6, 7], [4, 5]], BARLEY: ['#d9b25a', [6, 7], [3, 4]], OAT: ['#e8d48a', [0, 1], [4, 5]], CANOLA: ['#f1e04a', [5, 6], [4, 5]],
  MAIZE: ['#f0a830', [1, 2], [7, 8]], SUNFLOWER: ['#f5c518', [0, 1], [7, 8]], SOYBEAN: ['#b5a642', [1, 2], [7, 8]], POTATO: ['#c49a6c', [0, 1], [5, 6, 7]],
  SUGARBEET: ['#d8d0c0', [0, 1], [7, 8]], SORGHUM: ['#b8562b', [1, 2], [5, 6]], RICE: ['#9fd3c7', [1, 2], [6, 7]], RICELONGGRAIN: ['#b6e0d4', [1, 2], [6, 7]],
  PEA: ['#7cc05a', [0, 1], [4, 5]], GREENBEAN: ['#5aa83c', [1, 2], [5, 6]], CARROT: ['#ef8a2c', [0, 1, 2], [5, 6, 7]], PARSNIP: ['#efe2b8', [0, 1], [6, 7, 8]],
  BEETROOT: ['#a0304a', [0, 1, 2], [5, 6, 7]], SPINACH: ['#3f8a3c', [0, 1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 7, 8]], ONION: ['#e3b07a', [0, 1], [5, 6]],
  COTTON: ['#f2f2ee', [0, 1], [7, 8]], SUGARCANE: ['#8fbf4a', [0, 1], [7, 8]],
  GRASS: ['#6cc04a', [0, 1, 2, 3, 4, 5, 6, 7], [2, 3, 4, 5, 6, 7], 'grass'], MEADOW: ['#5fa83c', [], [2, 3, 4, 5, 6, 7], 'grass'],
  ALFALFA: ['#5fa040', [0, 1, 2], [2, 3, 4, 5, 6], 'grass'], CLOVER: ['#4f9a4a', [0, 1, 2], [2, 3, 4, 5, 6], 'grass'],
  GRAPE: ['#7b3f8c', [], [6, 7], 'perm'], OLIVE: ['#7f8f3a', [], [7, 8], 'perm'], POPLAR: ['#8a9a5a', [], [], 'perm'],
  COFFEE: ['#9b3b2c', [], [6, 7], 'perm'], COFFEECHERRIES: ['#9b3b2c', [], [6, 7], 'perm'], BANANA: ['#e3cf3f', [], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'perm'],
};
// Ware einer Frucht, wo sie anders heißt (sonst gleich)
const PRESET_FILL = { GRASS: 'GRASS_WINDROW', MEADOW: 'GRASS_WINDROW', ALFALFA: 'ALFALFA_WINDROW', CLOVER: 'CLOVER_WINDROW' };
const PERM = new Set(['GRAPE', 'OLIVE', 'POPLAR', 'COFFEE', 'COFFEECHERRIES', 'BANANA', 'TREE']);
const GRASS = new Set(['GRASS', 'MEADOW', 'ALFALFA', 'CLOVER', 'FIELDGRASS']);
// Keine Frucht zum Planen: Unkraut, Deko, Zwischenfrüchte zum Unterpflügen bleiben auf der Karte, aber nicht im Kalender
const NOT_PLANNED = /^(WEED|DECO|UNKNOWN|STONE|.*_DECO)$/;

const hash = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
// Farbe für eine Frucht ohne eigene: aus dem Namen, immer gleich (HSL 55 % / 55 % als #rrggbb)
function hsl(s) {
  const h = hash(s) / 360, L = 0.55, a = 0.55 * Math.min(L, 1 - L);
  const f = n => { const k = (n + h * 12) % 12; return Math.round(255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Alle Früchte: aus dem Spiel, ergänzt um den Kalender oben, wo das Spiel nichts sagt
// ex: Export (fsexport.read) oder null
function list(ex) {
  const game = ex && ex.fruitTypes && ex.fruitTypes.length ? ex.fruitTypes : null;
  const names = game ? game.map(f => f.name) : Object.keys(PRESET);
  return names.map(name => {
    const g = game ? game.find(f => f.name === name) : null, p = PRESET[name] || null;
    const fill = (g && g.fill) || PRESET_FILL[name] || name;
    const kind = PERM.has(name) ? 'perm' : GRASS.has(name) || (g && g.regrows && !p) ? 'grass' : (p && p[3]) || 'field';
    const sow = g && (g.sow.length || g.harvest.length) ? g.sow : p ? p[1] : [];
    const harvest = g && (g.sow.length || g.harvest.length) ? g.harvest : p ? p[2] : [];
    return {
      name, fill, label: N.fill(fill), color: (g && g.color) || (p && p[0]) || hsl(name), kind, sow, harvest, fromGame: !!(g && (g.sow.length || g.harvest.length)),
      density: g ? g.density : null, states: g ? g.states : null, harvestMin: g ? g.harvestMin : null, harvestMax: g ? g.harvestMax : null,
      cut: g ? g.cut : null, withered: g ? g.withered : null, literPerSqm: g ? g.literPerSqm : null, seedPerSqm: g ? g.seedPerSqm : null,
      windrow: g ? g.windrow : '', planned: !NOT_PLANNED.test(name) && (!g || g.seeding || PERM.has(name) || GRASS.has(name)),
    };
  });
}

// fs_crops nach den Daten füllen (je Ware eine Zeile, die Nummer bleibt für die Anbaupläne). Gibt die Liste für den
// Kalender zurück: { id, name, fill, color, kind, sowM, harvestM, … }.
let syncedSig = null;
function sync(ex) {
  const seen = new Set();
  const all = list(ex).filter(c => c.planned && !seen.has(c.fill) && seen.add(c.fill));
  const sig = JSON.stringify(all.map(c => [c.fill, c.label, c.color, c.kind, c.sow, c.harvest]));
  if (sig !== syncedSig) {
    const rows = db.prepare('SELECT id, fill FROM fs_crops').all();
    const byFill = new Map(rows.filter(r => r.fill).map(r => [r.fill, r.id]));
    const ins = db.prepare('INSERT INTO fs_crops(name, fill, color, sow, harvest, kind, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const upd = db.prepare('UPDATE fs_crops SET name = ?, color = ?, sow = ?, harvest = ?, kind = ?, position = ? WHERE id = ?');
    tx(() => all.forEach((c, i) => {
      const vals = [c.label, c.color, c.sow.join(','), c.harvest.join(','), c.kind, i];
      const id = byFill.get(c.fill);
      if (id) upd.run(...vals, id); else ins.run(c.label, c.fill, ...vals.slice(1));
    }));
    syncedSig = sig;
  }
  const info = new Map(all.map(c => [c.fill, c]));
  return db.prepare('SELECT * FROM fs_crops ORDER BY position, name').all().filter(r => info.has(r.fill))
    .map(r => ({ ...info.get(r.fill), id: r.id, name: r.name, sowM: info.get(r.fill).sow, harvestM: info.get(r.fill).harvest }));
}
function forget() { syncedSig = null; }

module.exports = { PRESET, PERM, GRASS, list, sync, forget, hsl };
