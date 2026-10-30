'use strict';
// Farming Simulator Hub: Wiki. Zwei Teile:
//
//   Anbaukalender  Saat- und Erntemonate jeder Frucht wie im Spiel (Daten aus dem Export, src/fscrops.js). Auf der Südhalbkugel
//                  (z. B. Catuaí) ist Monat 1 der September statt der März. Jeder Kalender beginnt trotzdem mit Januar.
//   Tiere          Jede Tierart mit ihren Unterarten: was ein Tier je nach Alter frisst, trinkt, an Stroh braucht und liefert
//                  (Milch, Wolle, Eier, Mist, Gülle), was es kostet, wann es Nachwuchs bekommt, die Futtergruppen mit ihrem
//                  Anteil an der Leistung, Mischungen und die Ställe aus dem Shop.
//
// Die Tierdaten liefert die Mod „Farming Hub Export“ ab 2.4. Sie ändern sich nur mit Spielupdates und DLCs, deshalb legt der Hub
// sie als eigene, schlichte Datei ab: DATA_DIR/fshub/wiki.xml. Kommt ein Export mit anderen Tierdaten, wird sie neu geschrieben.
// Admins können sie in der Seitenverwaltung herunterladen und eine eigene hochladen (die bleibt dann, bis sie gelöscht wird).
//
// Werte im Spiel: Kurven über das Alter in Monaten. Futter, Wasser, Stroh und Erzeugnisse stehen „pro Tag“; das Spiel rechnet
// jede Spielstunde ein 24stel davon, mal timeAdjustment. Ein Monat hat 24 × Tage-pro-Monat Stunden, also gilt pro Monat:
// Wert × timeAdjustment × Tage pro Monat. Das alles bei voller Produktivität (gut gefüttert, sauber, Wasser da).
const fs = require('node:fs');
const path = require('node:path');
const X = require('./fsxml');
const N = require('./fsnames');

const num = (v, d = null) => X.num(v, d);
const list = s => String(s || '').split(/\s+/).filter(Boolean);
const pts = s => String(s || '').trim().split(/\s+/).map(p => p.split(':').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);

// Deutsche Namen der Tierarten (das Spiel auf dem Server spricht Englisch)
const TYPES = { COW: 'Kühe', PIG: 'Schweine', SHEEP: 'Schafe und Ziegen', GOAT: 'Ziegen', HORSE: 'Pferde', CHICKEN: 'Hühner', ALPACA: 'Alpakas',
  WATERBUFFALO: 'Wasserbüffel', BUFFALO: 'Wasserbüffel', BEE: 'Bienen', DUCK: 'Enten', RABBIT: 'Kaninchen' };
const typeName = (t, title) => TYPES[t] || title || N.pretty(t);
// Was eine Kurve ist: [Name, Einheit, Seite]
const CURVES = {
  food: ['Futter', 'l', 'in'], water: ['Wasser', 'l', 'in'], straw: ['Stroh', 'l', 'in'],
  milk: ['Milch', 'l', 'out'], pallets: ['Paletten', 'l', 'out'], fleece: ['Vlies je Schur', 'l', 'out'], manure: ['Mist', 'l', 'out'], liquidManure: ['Gülle', 'l', 'out'],
  buy: ['Kaufpreis', '€', 'price'], sell: ['Verkaufspreis', '€', 'price'], transport: ['Transport', '€', 'price'],
};
const OUT_FILL = { manure: 'MANURE', liquidManure: 'LIQUIDMANURE', fleece: 'ALPACAFLEECE' };
// Erzeugnisse: Milch, Paletten (Wolle, Eier, Ziegenmilch) und alles, was die Mod ab 2.6 sonst mit Ware liefert (z. B. Alpakavlies)
const outputs = s => Object.entries(s.curves).filter(([k, c]) => c.fill && (!CURVES[k] || CURVES[k][2] === 'out'));
const goods = s => outputs(s).filter(([k]) => k !== 'manure' && k !== 'liquidManure');

// Titel aus dem Spiel (Futtergruppen, Zustand im Stall) kommen in der Sprache des Servers: englische auf Deutsch, „(80%)“ bleibt
const TITLES = {
  'total mixed ration': 'Totalmischration', tmr: 'Totalmischration', hay: 'Heu', silage: 'Silage', grass: 'Gras', meadow: 'Weide', pasture: 'Weide',
  'base food': 'Grundfutter', basefood: 'Grundfutter', grain: 'Getreide', protein: 'Eiweiß', 'root crops': 'Hackfrüchte', 'earth fruits': 'Hackfrüchte',
  'earth fruit': 'Hackfrüchte', roots: 'Hackfrüchte', 'mineral feed': 'Mineralfutter', 'chicken food': 'Hühnerfutter', 'pig food': 'Schweinefutter',
  food: 'Futter', water: 'Wasser', straw: 'Stroh', manure: 'Mist', slurry: 'Gülle', 'liquid manure': 'Gülle', milk: 'Milch', 'goat milk': 'Ziegenmilch',
  'buffalo milk': 'Büffelmilch', wool: 'Wolle', 'alpaca wool': 'Alpakawolle', eggs: 'Eier', egg: 'Eier', cleanliness: 'Sauberkeit', productivity: 'Produktivität',
  'total capacity': 'Gesamtkapazität', 'total capacity (effectiveness)': 'Gesamtkapazität (Effektivität)', oat: 'Hafer', oats: 'Hafer', alfalfa: 'Luzerne', clover: 'Klee',
};
function title(t) {
  const m = /^(.*?)\s*(\(\s*\d+\s*%\s*\))?$/.exec(String(t || '').trim());
  const de = TITLES[(m[1] || '').toLowerCase()];
  return de ? de + (m[2] ? ' ' + m[2].replace(/\s+/g, '') : '') : String(t || '');
}

// ---------- Lesen und Schreiben ----------
// <animals> aus dem Export oder aus wiki.xml → Daten
function parse(el) {
  if (!el) return null;
  const types = X.kids(el, 'animal').filter(a => a.a.type).map(a => {
    const food = X.kid(a, 'food');
    return {
      type: a.a.type, title: a.a.title || '', consumption: String((food && food.a.consumption) || '').toUpperCase(),
      groups: X.kids(food, 'group').map(g => ({ title: g.a.title || '', weight: num(g.a.productionWeight, 0), eat: num(g.a.eatWeight, 0), fills: list(g.a.fillTypes) })),
      mixtures: X.kids(food, 'mixture').filter(m => m.a.fillType).map(m => ({ fill: m.a.fillType, parts: X.kids(m, 'ingredient').map(i => ({ weight: num(i.a.weight, 0), fills: list(i.a.fillTypes) })) })),
      subs: X.kids(a, 'subType').filter(s => s.a.name).map(s => {
        const r = X.kid(s, 'reproduction'), curves = {};
        for (const c of X.kids(s, 'curve')) if (c.a.kind) curves[c.a.kind] = { fill: c.a.fillType || OUT_FILL[c.a.kind] || null, pts: pts(c.a.pts) };
        return {
          name: s.a.name, fill: s.a.fillType || s.a.name, title: s.a.title || '', gender: s.a.gender || '', breed: s.a.breed || '', fleeceRegrowth: num(s.a.fleeceRegrowth),
          repro: r ? { minAge: num(r.a.minAgeMonth), duration: num(r.a.durationMonth), minHealth: num(r.a.minHealth), none: r.a.none === 'true' } : null, curves,
        };
      }),
    };
  });
  return {
    ta: num(el.a.timeAdjustment, 1), types,
    recipes: X.kids(el, 'recipe').filter(r => r.a.fillType).map(r => ({ fill: r.a.fillType, parts: X.kids(r, 'ingredient').map(i => ({ title: i.a.title || '', min: num(i.a.min, 0), max: num(i.a.max, 0), fills: list(i.a.fillTypes) })) })),
    stalls: X.kids(el, 'stall').filter(s => s.a.type).map(s => ({ name: s.a.name || '', type: s.a.type, file: s.a.filename || '', price: num(s.a.price), max: num(s.a.maxAnimals), food: num(s.a.foodCapacity), dlc: s.a.dlc || '' })),
  };
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = o => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const ptsText = p => p.map(([a, v]) => `${+a.toFixed(3)}:${+v.toFixed(3)}`).join(' ');
// Daten → wiki.xml (gleiche Form wie der Teil <animals> im Export)
function toXml(d, meta = {}) {
  const out = ['<?xml version="1.0" encoding="utf-8"?>', `<farmingWiki${attrs({ version: 1, source: meta.source, mapTitle: meta.mapTitle, saved: meta.saved })}>`,
    `  <animals${attrs({ timeAdjustment: d.ta })}>`];
  for (const t of d.types) {
    out.push(`    <animal${attrs({ type: t.type, title: t.title })}>`);
    out.push(`      <food${attrs({ consumption: t.consumption })}>`);
    for (const g of t.groups) out.push(`        <group${attrs({ title: g.title, productionWeight: g.weight, eatWeight: g.eat, fillTypes: g.fills.join(' ') })}/>`);
    for (const m of t.mixtures) {
      out.push(`        <mixture${attrs({ fillType: m.fill })}>`);
      for (const p of m.parts) out.push(`          <ingredient${attrs({ weight: p.weight, fillTypes: p.fills.join(' ') })}/>`);
      out.push('        </mixture>');
    }
    out.push('      </food>');
    for (const s of t.subs) {
      out.push(`      <subType${attrs({ name: s.name, fillType: s.fill, title: s.title, gender: s.gender, breed: s.breed, fleeceRegrowth: s.fleeceRegrowth })}>`);
      if (s.repro) out.push(`        <reproduction${attrs({ minAgeMonth: s.repro.minAge, durationMonth: s.repro.duration, minHealth: s.repro.minHealth, none: s.repro.none ? 'true' : null })}/>`);
      for (const [kind, c] of Object.entries(s.curves)) out.push(`        <curve${attrs({ kind, fillType: OUT_FILL[kind] ? null : c.fill, pts: ptsText(c.pts) })}/>`);
      out.push('      </subType>');
    }
    out.push('    </animal>');
  }
  for (const r of d.recipes) {
    out.push(`    <recipe${attrs({ fillType: r.fill })}>`);
    for (const p of r.parts) out.push(`      <ingredient${attrs({ title: p.title, min: p.min, max: p.max, fillTypes: p.fills.join(' ') })}/>`);
    out.push('    </recipe>');
  }
  for (const s of d.stalls) out.push(`    <stall${attrs({ name: s.name, type: s.type, filename: s.file, price: s.price, maxAnimals: s.max, foodCapacity: s.food, dlc: s.dlc })}/>`);
  out.push('  </animals>', '</farmingWiki>', '');
  return out.join('\n');
}

// ---------- Ablage ----------
const file = () => path.join(require('./fsfeeds').FS_DIR, 'wiki.xml');
let mem = null;
function stored() {
  try {
    const f = file(), t = fs.statSync(f).mtimeMs;
    if (!mem || mem.t !== t) {
      const s = X.parse(fs.readFileSync(f, 'utf8'));
      mem = { t, data: { ...parse(X.kid(s, 'animals')), source: s.a.source || '', mapTitle: s.a.mapTitle || '', saved: s.a.saved || '' } };
    }
    return mem.data;
  } catch { mem = null; return null; }
}
const core = d => JSON.stringify({ ta: d.ta, types: d.types, recipes: d.recipes, stalls: d.stalls });
function write(d, meta) { fs.writeFileSync(file(), toXml(d, meta)); mem = null; }
// Tierdaten eines Exports übernehmen, wenn sie neu sind. Eine hochgeladene Datei bleibt, bis ein Admin sie löscht.
function sync(ex) {
  const a = ex && ex.animals;
  if (!a || !a.types.length) return false;
  const cur = stored();
  if (cur && (cur.source === 'upload' || core(cur) === core(a))) return false;
  write(a, { source: 'export', mapTitle: ex.mapTitle, saved: ex.saveDate });
  return true;
}
// Hochladen: wiki.xml oder gleich die farmingHubExport.xml
function upload(buf) {
  const s = X.parse(buf.toString('utf8'));
  if (s.n !== 'farmingWiki' && s.n !== 'farmingHubExport') throw new Error('Keine wiki.xml und keine farmingHubExport.xml.');
  const d = parse(X.kid(s, 'animals'));
  if (!d || !d.types.length) throw new Error('In der Datei stehen keine Tiere (die Mod „Farming Hub Export“ liefert sie ab Version 2.4).');
  write(d, { source: 'upload', mapTitle: s.a.mapTitle || '', saved: s.a.saved || s.a.saveDate || '' });
  return d;
}
function remove() { fs.rmSync(file(), { force: true }); mem = null; }
function download() { try { return fs.readFileSync(file()); } catch { return null; } }

// ---------- Rechnen ----------
// Wert einer Kurve bei einem Alter (linear zwischen den Stützpunkten, außen der Randwert). Zwei Punkte mit gleichem Alter sind
// ein Sprung wie im Spiel: Milch „12:0 12:150“ heißt ab 12 Monaten 150, darum gilt bei gleichem Alter der letzte Punkt.
function at(p, age) {
  if (!p || !p.length) return null;
  let k = -1;
  for (let i = 0; i < p.length; i++) if (p[i][0] <= age) k = i;
  if (k < 0) return p[0][1];
  if (k === p.length - 1) return p[k][1];
  const [a0, v0] = p[k], [a1, v1] = p[k + 1];
  return a1 === a0 ? v1 : v0 + (v1 - v0) * (age - a0) / (a1 - a0);
}
// Faktor „pro Tag“ im Spiel → pro Monat
const monthFactor = (d, dpp) => (d && d.ta ? d.ta : 1) * Math.max(1, dpp || 1);
// Ausgewachsen: ab wann das Tier am meisten liefert (Erzeugnis), sonst ab wann es Nachwuchs bekommen kann, sonst der letzte Stützpunkt
function adultAge(s) {
  const out = (goods(s)[0] || [])[1];
  if (out && out.pts.length) { const max = Math.max(...out.pts.map(p => p[1])); return out.pts.find(p => p[1] >= max - 1e-9)[0]; }
  if (s.repro && s.repro.minAge) return s.repro.minAge;
  const food = s.curves.food;
  return food && food.pts.length ? food.pts[food.pts.length - 1][0] : 12;
}
// Die Ware, die ein Tier liefert, mit Menge pro Monat bei einem Alter
function products(s, age, f) {
  const out = [];
  for (const [kind, c] of outputs(s)) {
    // Vlies (Alpakas): die Kurve ist die Menge bei vollem Vlies, davon wächst pro Tag fleeceRegrowth nach
    const v = at(c.pts, age) * (kind === 'fleece' ? s.fleeceRegrowth || 0 : 1);
    if (v > 0) out.push({ kind, fill: c.fill, name: N.fill(c.fill), perMonth: v * f, ...(kind === 'fleece' ? { perShear: at(c.pts, age) } : {}) });
  }
  return out;
}
// Ausgewählte Alter für Tabellen: alle Stützpunkte der Kurven, höchstens 8
function ages(s) {
  const set = new Set([0]);
  for (const c of Object.values(s.curves)) for (const [a] of c.pts) if (a <= 120) set.add(a);
  const all = [...set].sort((a, b) => a - b);
  if (all.length <= 8) return all;
  const step = (all.length - 1) / 7;
  return [...new Set(Array.from({ length: 8 }, (_, i) => all[Math.round(i * step)]))];
}

// Wiki-Daten für die Seiten: Tierarten mit deutschen Namen, je Unterart die Werte als ausgewachsenes Tier pro Monat
function animals(dpp) {
  const d = stored();
  if (!d) return null;
  const f = monthFactor(d, dpp);
  const types = d.types.map(t => ({
    ...t, label: typeName(t.type, t.title),
    groups: t.groups.map(g => ({ ...g, label: title(g.title) || g.fills.map(N.fill).join(', ') })),
    recipes: d.recipes.filter(r => t.mixtures.some(m => m.fill === r.fill) || t.groups.some(g => g.fills.includes(r.fill))).map(r => ({ ...r, parts: r.parts.map(p => ({ ...p, label: title(p.title) || p.fills.map(N.fill).join(', ') })) })),
    stalls: d.stalls.filter(s => s.type === t.type).sort((a, b) => (a.price || 0) - (b.price || 0)),
    subs: t.subs.map(s => {
      const adult = adultAge(s);
      const per = k => (s.curves[k] ? (at(s.curves[k].pts, adult) || 0) * f : null);
      return {
        ...s, label: N.FILL[s.fill] || (s.title && !/^\$l10n/.test(s.title) ? s.title : N.pretty(s.name)), adult,
        needs: { food: per('food'), water: per('water'), straw: per('straw') }, makes: products(s, adult, f),
        buy: s.curves.buy ? at(s.curves.buy.pts, adult) : null, buyYoung: s.curves.buy ? at(s.curves.buy.pts, 0) : null, sell: s.curves.sell ? at(s.curves.sell.pts, adult) : null,
        table: ages(s).map(age => ({ age, ...Object.fromEntries(Object.entries(s.curves).map(([k, c]) => [k, (at(c.pts, age) || 0) * (CURVES[k] && CURVES[k][2] === 'price' ? 1 : f)])) })),
      };
    }),
  }));
  return { ...d, types, factor: f };
}

// Welche Tiere eine Ware liefern: fill → [{ type, sub, perMonth, adult }]
function producers(dpp) {
  const a = animals(dpp), out = new Map();
  if (!a) return out;
  for (const t of a.types) {
    for (const s of t.subs) {
      for (const p of s.makes) {
        if (!out.has(p.fill)) out.set(p.fill, []);
        out.get(p.fill).push({ type: t.type, typeLabel: t.label, sub: s.name, label: s.label, perMonth: p.perMonth, adult: s.adult, kind: p.kind });
      }
    }
  }
  return out;
}
// Produktionsplaner: Wie viele ausgewachsene Tiere decken die Inputs eines Rezepts, wenn es den ganzen Monat läuft?
// rec: { cycles, inputs: [{ fill, amount, name }] } · Ergebnis je Input mit Tieren: { fill, name, need, options: [{ label, n, perMonth }] }
function herd(rec, dpp) {
  if (!rec || !(rec.cycles > 0)) return [];
  const prod = producers(dpp);
  return rec.inputs.filter(i => prod.has(i.fill)).map(i => {
    const need = i.amount * rec.cycles;
    const options = prod.get(i.fill).filter(p => p.perMonth > 0).map(p => ({ ...p, n: Math.ceil(need / p.perMonth - 1e-9) }));
    // Gleiche Leistung (Rassen einer Art): ein Eintrag mit allen Namen
    const merged = [];
    for (const o of options.sort((a, b) => a.n - b.n)) {
      const m = merged.find(x => x.type === o.type && Math.abs(x.perMonth - o.perMonth) < 1e-6);
      if (m) m.labels.push(o.label); else merged.push({ ...o, labels: [o.label] });
    }
    return { fill: i.fill, name: i.name || N.fill(i.fill), need, options: merged };
  }).filter(x => x.options.length);
}

// ---------- Stall in der Hofübersicht ----------
// Was im Stall steht wie im Menü „Tiere“: aus dem Export (ab Mod 2.4, mit Platz und Balken), sonst aus placeables.xml (nur
// Füllstände, Futter nach den Gruppen des Wikis sortiert). fills: [{ fill, name, amount, food, sec }], subs: Unterarten im Stall
function stall(game, fills, subs) {
  const row = i => ({ title: title(i.title), value: i.value, cap: i.cap, ratio: i.ratio ?? (i.cap ? i.value / i.cap : null), inverted: !!i.inverted });
  if (game && game.infos && game.infos.length) {
    return { fromGame: true, type: game.type, animals: game.animals, max: game.max, productivity: game.productivity,
      condition: game.infos.filter(i => i.kind === 'condition').map(row), food: game.infos.filter(i => i.kind === 'food').map(row) };
  }
  const d = stored(), have = new Set(subs || []);
  const t = d && d.types.find(x => x.subs.some(s => have.has(s.name) || have.has(s.fill)));
  const food = (fills || []).filter(f => f.food), sum = xs => xs.reduce((a, f) => a + f.amount, 0);
  return {
    fromGame: false, type: t ? t.type : '', animals: null, max: null, productivity: null,
    condition: (fills || []).filter(f => !f.food).map(f => ({ title: f.name, value: f.amount, cap: null, ratio: null })),
    food: t && t.groups.length
      ? t.groups.map(g => ({ title: `${title(g.title) || g.fills.map(N.fill).join(', ')} (${Math.round(g.weight * 100)}%)`, value: sum(food.filter(f => g.fills.includes(f.fill))), cap: null, ratio: null }))
      : food.map(f => ({ title: f.name, value: f.amount, cap: null, ratio: null })),
  };
}

// ---------- Anbaukalender ----------
// Halbkugel: Einstellung (nord/sued) vor dem Export, sonst bekannte Karten der Südhalbkugel
const SOUTH_MAPS = /beansAndAlpacas/i;
function hemisphere(ex, setting) {
  if (setting === 'nord') return 'north';
  if (setting === 'sued') return 'south';
  if (ex && (ex.hemisphere === 'south' || ex.hemisphere === 'north')) return ex.hemisphere;
  return ex && SOUTH_MAPS.test(ex.mapId || '') ? 'south' : 'north';
}
// Monatsnamen von Januar bis Dezember (N.setHemisphere ist dann schon gesetzt)
function months(short = false) {
  return N.ORDER.map(p => (short ? N.MONTHS_SHORT : N.MONTHS)[p]);
}
// Spielmonate (0–11) → zusammenhängende Balken [Stelle ab Januar, Länge], am Jahreswechsel geteilt wie im Spiel
function runs(ms) {
  const on = new Set(ms.map(N.calPos)), out = [];
  for (let i = 0; i < 12; i++) {
    if (!on.has(i) || on.has(i - 1)) continue;
    let n = 1;
    while (i + n < 12 && on.has(i + n)) n++;
    out.push([i, n]);
  }
  return out;
}

module.exports = { TYPES, CURVES, title, stall, parse, toXml, stored, sync, upload, remove, download, file, at, adultAge, animals, producers, herd, hemisphere, months, runs, monthFactor, typeName, products };
