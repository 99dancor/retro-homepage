'use strict';
// Symbole für Erzeugnisse im Farming Simulator Hub. Eigene Zeichnungen im Stil des Spiels (views/fshub/_icons.ejs),
// je Kürzel eine Form und eine Farbe. Lädt ein Admin in der Seitenverwaltung die Originale als PNG hoch (einzeln oder als
// ZIP, Namen wie hud_fill_wheat.png oder wheat.png), ersetzen sie die eigenen. Die Originale gehören GIANTS und liegen
// nur im Datenordner des Servers, nie im Repo.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');

const DIR = path.join(DATA_DIR, 'fshub', 'icons');
fs.mkdirSync(DIR, { recursive: true });

// Kürzel → [Form, Farbe]. Formen: siehe _icons.ejs (g-…)
const GLYPH = {
  WHEAT: ['grain', '#e3b34c'], BARLEY: ['grain', '#cfa968'], OAT: ['grain', '#d8cfa0'], RYE: ['grain', '#c9a35a'], TRITICALE: ['grain', '#d6b15e'],
  SPELT: ['grain', '#d2a96b'], WINTERWHEAT: ['grain', '#e3b34c'], WINTERBARLEY: ['grain', '#cfa968'], SORGHUM: ['grain', '#c0633a'],
  RICE: ['rice', '#e9e2c4'], RICELONGGRAIN: ['rice', '#f1ead0'], RICE_BAGS: ['sack', '#e9e2c4'], RICEFLOUR: ['sack', '#f3efe2'], RICESAPLINGS: ['sapling', '#7cc242'],
  CANOLA: ['flower', '#f1df3a'], SUNFLOWER: ['sunflower', '#f2b81d'], MUSTARD: ['flower', '#e6c93a'], OILSEEDRADISH: ['flower', '#d9e3a0'],
  SOYBEAN: ['bean', '#c3b45c'], GREENBEAN: ['bean', '#6fb045'], PEA: ['pea', '#86c04e'], CANNED_PEAS: ['box', '#86c04e'],
  MAIZE: ['corn', '#f0c434'], SILAGEMAIZE: ['corn', '#a9b440'], POTATO: ['potato', '#c9a06a'], POTATOCHIPS: ['box', '#e7c45a'],
  SUGARBEET: ['beet', '#e6c9b0'], SUGARBEET_CUT: ['beet', '#d8b896'], BEETROOT: ['beet', '#a0304a'], CARROT: ['carrot', '#ef8a2c'], PARSNIP: ['carrot', '#efe2b8'],
  ONION: ['onion', '#e3b07a'], SPRING_ONION: ['onion', '#9fd06a'], GARLIC: ['onion', '#f0ece0'],
  SPINACH: ['leafveg', '#3f8a3c'], SPINACH_BAGS: ['sack', '#3f8a3c'], LETTUCE: ['leafveg', '#8fd16a'], NAPACABBAGE: ['leafveg', '#c8e39a'],
  TOMATO: ['fruit', '#e0452f'], STRAWBERRY: ['fruit', '#e0304a'], CHILLI: ['fruit', '#d8302a'], GREENPEPPER: ['fruit', '#4fa83a'], CUCUMBER: ['fruit', '#5a9a3a'],
  WATERMELON: ['fruit', '#4a9a4a'], APPLE: ['fruit', '#d8463a'], PEAR: ['fruit', '#c8c040'], APRICOT: ['fruit', '#f0a040'], PLUM: ['fruit', '#7a3a8a'],
  GRAPE: ['grape', '#7b3f8c'], TABLEGRAPE: ['grape', '#9bc24a'], RAISINS: ['grape', '#6a4030'], OLIVE: ['olive', '#7f8f3a'],
  COTTON: ['cotton', '#f2f2ee'], SUGARCANE: ['cane', '#8fbf4a'], ENOKI: ['mushroom', '#f0ead8'], OYSTER: ['mushroom', '#c8b8a0'],
  GRASS: ['leaf', '#7cc242'], GRASS_WINDROW: ['leaf', '#7cc242'], MEADOW: ['leaf', '#6cb03a'], ALFALFA: ['leaf', '#5fa040'], CLOVER: ['leaf', '#4f9a4a'],
  DRYGRASS: ['hay', '#d8c07a'], DRYGRASS_WINDROW: ['hay', '#d8c07a'], STRAW: ['hay', '#e8d28a'], CHAFF: ['hay', '#b8b04a'], SILAGE: ['silage', '#9fae4a'],
  FORAGE: ['silage', '#b8a050'], FORAGE_MIXING: ['silage', '#b8a050'], ROUNDBALE: ['bale', '#d8c07a'], SQUAREBALE: ['bale', '#e8d28a'],
  MILK: ['bottle', '#f2f2ee'], GOATMILK: ['bottle', '#f4f0e4'], BUFFALOMILK: ['bottle', '#f0ece0'], MILK_BOTTLED: ['bottle', '#f2f2ee'],
  GOATMILK_BOTTLED: ['bottle', '#f4f0e4'], BUFFALOMILK_BOTTLED: ['bottle', '#f0ece0'], EGG: ['egg', '#f0e0c0'], WOOL: ['wool', '#f0ece0'], HONEY: ['jar', '#f0b030'],
  BUTTER: ['box', '#f2df8a'], CHEESE: ['cheese', '#f2c94c'], GOATCHEESE: ['cheese', '#f4ecd0'], BUFFALOMOZZARELLA: ['cheese', '#f8f6ee'],
  MANURE: ['heap', '#7a5a3a'], LIQUIDMANURE: ['drop', '#6e5a3c'], DIGESTATE: ['drop', '#8a6a48'], COMPOST: ['heap', '#5a4a30'],
  WATER: ['drop', '#4b97ec'], DIESEL: ['fuel', '#d2b04a'], DEF: ['fuel', '#4b97ec'], METHANE: ['flame', '#8fb6e6'], ELECTRICCHARGE: ['bolt', '#f2d23a'],
  SEEDS: ['sack', '#b7d48a'], FERTILIZER: ['sack', '#8fb6e6'], LIQUIDFERTILIZER: ['drop', '#5fa0e0'], LIME: ['sack', '#e9e6dc'], HERBICIDE: ['drop', '#d86a3a'],
  LIQUIDSEEDTREATMENT: ['drop', '#c060a0'], SILAGE_ADDITIVE: ['drop', '#e0c040'], MINERAL_FEED: ['sack', '#d0c8b0'], PIGFOOD: ['sack', '#c8a070'],
  FISHFOOD: ['sack', '#c8b070'], TREESAPLINGS: ['sapling', '#5fa040'], POPLAR: ['log', '#b8a070'], ROADSALT: ['sack', '#f0f0f0'],
  BALE_WRAP: ['roll', '#f0f0f0'], BALE_NET: ['roll', '#e8e0c8'], BALE_TWINE: ['roll', '#f0d060'],
  WOOD: ['log', '#a87a4a'], WOODCHIPS: ['heap', '#c8a070'], BOARDS: ['plank', '#d0a060'], PLANKS: ['plank', '#d8b070'], WOODBEAM: ['plank', '#b88a50'],
  PREFABWALL: ['plank', '#c8b090'], FURNITURE: ['box', '#a87a4a'], CARTONROLL: ['roll', '#c8a070'], PAPERROLL: ['roll', '#f0ece0'],
  FLOUR: ['sack', '#f3efe2'], BREAD: ['bread', '#d8a060'], CAKE: ['cake', '#f0c0a0'], SUGAR: ['sack', '#f8f8f8'], CEREAL: ['box', '#e8c060'],
  CHOCOLATE: ['box', '#7a4a2a'], RICEROLLS: ['box', '#f0ead0'], FABRIC: ['roll', '#9ab0d8'], CLOTHES: ['shirt', '#7a9ad0'], ROPE: ['roll', '#c8a060'],
  SUNFLOWER_OIL: ['bottle', '#f2c030'], CANOLA_OIL: ['bottle', '#e8d040'], OLIVE_OIL: ['bottle', '#a0a040'], RICE_OIL: ['bottle', '#f0e0a0'],
  GRAPESEED_OIL: ['bottle', '#b0a040'], GRAPEJUICE: ['bottle', '#7b3f8c'], APPLEJUICE: ['bottle', '#e8b040'], GRAPEMUST: ['bottle', '#8a4a7a'],
  KETCHUP: ['bottle', '#d0302a'], PICKLES: ['jar', '#7a9a3a'], MOLASSES: ['drop', '#4a2a1a'], CEMENT: ['sack', '#b0b0b0'], STONE: ['stone', '#a0a0a0'],
  COAL: ['stone', '#3a3a3a'], TROUT: ['fish', '#9ab0a0'], TROUTYOUNG: ['fish', '#b0c8b8'], SALMON: ['fish', '#e8906a'], SALMONYOUNG: ['fish', '#f0b090'],
  CHICKEN: ['egg', '#f0e0c0'], GOAT: ['wool', '#e0d8c8'], WEED: ['leaf', '#a0b040'],
  // Feld und Futter (FS25)
  COFFEE: ['coffee', '#6a3a22'], COFFEECHERRIES: ['fruit', '#b8322a'], BANANA: ['banana', '#f0d23a'], POPLAR: ['log', '#b8a070'], TREE: ['sapling', '#4f8a3a'],
  FLOWERINGCATCHCROP: ['flower', '#c8a0e0'], GREENRYE: ['grain', '#8fb84a'], VETCHRYE: ['leaf', '#7a9a4a'], HUMUSACTIVE: ['leaf', '#6a8a3a'], FIELDGRASS: ['leaf', '#7cc242'],
  ONION_DIRTY: ['onion', '#c8955a'], WHEAT_CUT: ['grain', '#c9a24a'], BARLEY_CUT: ['grain', '#b8975a'], OAT_CUT: ['grain', '#c8bf90'], RYE_CUT: ['grain', '#b8934a'],
  TRITICALE_CUT: ['grain', '#c6a14e'], SPELT_CUT: ['grain', '#c2995b'], CANOLA_CUT: ['flower', '#d8c83a'], SOYBEAN_CUT: ['bean', '#b3a44c'],
  ALFALFA_WINDROW: ['leaf', '#5fa040'], DRYALFALFA: ['hay', '#c8c070'], DRYALFALFA_WINDROW: ['hay', '#c8c070'], ALFALFA_FERMENTED: ['silage', '#8f9e3a'],
  CLOVER_WINDROW: ['leaf', '#4f9a4a'], DRYCLOVER: ['hay', '#b8c070'], DRYCLOVER_WINDROW: ['hay', '#b8c070'], CLOVER_FERMENTED: ['silage', '#7f9e4a'],
  HAY_PELLETS: ['pellet', '#c8b060'], STRAW_PELLETS: ['pellet', '#e0c878'], PIGFOODWF: ['sack', '#c8a070'], CHICKENFOOD: ['sack', '#d8c088'],
  ROUNDBALE_GRASS: ['bale', '#8fbf4a'], ROUNDBALE_DRYGRASS: ['bale', '#d8c07a'], ROUNDBALE_COTTON: ['bale', '#f2f2ee'], ROUNDBALE_WOOD: ['bale', '#a87a4a'],
  SQUAREBALE_GRASS: ['bale', '#8fbf4a'], SQUAREBALE_DRYGRASS: ['bale', '#d8c07a'], SQUAREBALE_COTTON: ['bale', '#f2f2ee'], SQUAREBALE_WOOD: ['bale', '#a87a4a'],
  SEPARATED_MANURE: ['heap', '#8a6a48'], COMPOSTRAW: ['heap', '#6a5a3a'], ORGANICWASTE: ['heap', '#6a7a3a'], CHICKEN_ROOSTER: ['egg', '#e0c0a0'],
  // Tiere und Alpakas
  ALPACAWOOL: ['wool', '#e8dcc4'], ALPACAFLEECE: ['wool', '#d8c0a0'], ALPACASOCKS: ['shirt', '#c8a882'], ALPACAPLUSH: ['alpaca', '#e8dcc4'],
  ALPACAPILLOW: ['box', '#e0d0b8'], ALPACACHAIR: ['chair', '#b89870'], ALPACAARMCHAIR: ['chair', '#a07850'],
  // Lebensmittel
  COFFEEBAGS: ['sack', '#7a4a2a'], COFFEEPACKED: ['box', '#6a3a22'], COFFEECAPSULES: ['can', '#8a5a3a'], COFFEEBEVERAGE: ['cup', '#8a5a3a'], COFFEEYOGURT: ['jar', '#c8a07a'],
  BANANABOX: ['box', '#f0d23a'], BANANACAKE: ['cake', '#f0d070'], BANANACANDY: ['box', '#f8e070'], BANANACHIPS: ['box', '#e8c050'], BANANAFRIEDBOX: ['box', '#d8a040'],
  BANANAJAM: ['jar', '#f0c840'], BANANAMILK: ['bottle', '#f8ec9a'], TIRAMISU: ['cake', '#a07050'], RICE_BOXES: ['box', '#e9e2c4'],
  JARRED_GREENBEAN: ['jar', '#6fb045'], PRESERVEDCARROTS: ['jar', '#ef8a2c'], PRESERVEDPARSNIP: ['jar', '#efe2b8'], PRESERVEDBEETROOT: ['jar', '#a0304a'],
  FERMENTEDNAPACABBAGE: ['jar', '#d8503a'], SOUPCANSMIXED: ['can', '#c87a3a'], SOUPCANSCARROTS: ['can', '#ef8a2c'], SOUPCANSPARSNIP: ['can', '#e8dcb0'],
  SOUPCANSBEETROOT: ['can', '#a0304a'], SOUPCANSPOTATO: ['can', '#c9a06a'], NOODLESOUP: ['cup', '#e8c060'], ONIONSOUP: ['can', '#c8955a'], ONIONSALT: ['jar', '#f0e8d8'],
  ONIONBAG: ['sack', '#e3b07a'], FRIEDONION: ['box', '#b8783a'], STRAWBERRYJUICE: ['bottle', '#e0304a'], APRICOTJAM: ['jar', '#f0a040'], PLUMJAM: ['jar', '#7a3a8a'],
  GRAPEJUICE_BULK: ['drop', '#7b3f8c'], GRAPEJUICE_PREMIUM: ['bottle', '#5a2a6a'], GRAPEJUICE_BUBBLE: ['bottle', '#9a5aaa'], GRAPESEED: ['bean', '#6a4030'],
  GRAPELEATHER: ['box', '#7b3f8c'],
  // Waren und Bau
  PIGMENTS: ['heap', '#c8504a'], PAINTBUCKETS: ['bucket', '#3a7ad8'], BUCKET: ['bucket', '#a0a0a0'], BARREL: ['can', '#8a6040'], BATHTUB: ['box', '#f0f0f0'],
  PIANO: ['box', '#2a2a2a'], WAGON: ['box', '#a87a4a'], TOYTRACTOR: ['box', '#d8302a'], POLYESTER: ['roll', '#c0d0e8'], SHOES: ['shirt', '#6a4a2a'],
  BELTS: ['roll', '#7a5030'], RESIN: ['drop', '#d89a2a'], SHINGLEROOF: ['plank', '#8a4a3a'], ROOFPLATES: ['plank', '#9aa0a8'], CEMENTBRICKS: ['stone', '#b8b8b8'],
  STONEBIG: ['stone', '#909090'], CASTLEROCK: ['stone', '#a89880'], TARP: ['roll', '#3a6a3a'],
};
const LIQUID = /MILK|OIL|JUICE|WATER|MANURE|MUST|SYRUP|LIQUID|DIGESTATE|DIESEL|FUEL|BEER|WINE/;
const key = s => String(s || '').toLowerCase().replace(/\.(png|webp|jpe?g)$/, '').replace(/^hud_fill_/, '').replace(/^hud_/, '').replace(/[^a-z0-9]/g, '');

// Hochgeladene Originale: einmal einlesen, nach dem Hochladen neu
let uploaded = null;
function list() {
  if (!uploaded) {
    uploaded = new Map();
    for (const f of fs.readdirSync(DIR)) if (/\.png$/.test(f)) { try { uploaded.set(f.slice(0, -4), Math.floor(fs.statSync(path.join(DIR, f)).mtimeMs / 1000)); } catch { /* weg */ } }
  }
  return uploaded;
}
function glyph(code) {
  const c = String(code || '').toUpperCase();
  return GLYPH[c] || (LIQUID.test(c) ? ['drop', '#9aa394'] : ['box', '#9aa394']);
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// HTML für ein Symbol. name: Titel beim Überfahren, size: s (klein) oder m
function html(code, name = '', size = 'm') {
  const k = key(code), up = list().get(k), t = name ? ` title="${esc(name)}"` : '';
  if (up) return `<img class="fi fi-${size} up" src="/farming/symbol/${k}.png?v=${up}" alt=""${t}>`;
  const [g, color] = glyph(code);
  return `<span class="fi fi-${size}" style="--c:${color}"${t} aria-hidden="true"><svg><use href="#g-${g}"/></svg></span>`;
}
// Hochladen: PNG-Dateien oder ZIPs mit PNGs. Gibt die Zahl der gespeicherten Symbole zurück.
function save(files) {
  let n = 0;
  const put = (name, buf) => {
    if (!/\.png$/i.test(name) || buf.length > 2 * 1024 * 1024 || buf.subarray(0, 4).toString('hex') !== '89504e47') return;
    const k = key(path.basename(name));
    if (!k) return;
    fs.writeFileSync(path.join(DIR, k + '.png'), buf);
    n++;
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.originalname)) {
      const AdmZip = require('adm-zip');
      for (const e of new AdmZip(f.buffer).getEntries()) if (!e.isDirectory && e.header.size < 2 * 1024 * 1024) put(e.entryName, e.getData());
    } else put(f.originalname, f.buffer);
  }
  uploaded = null;
  return n;
}
function clear() {
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });
  uploaded = null;
}
function file(k) {
  const clean = key(k);
  return clean && list().has(clean) ? path.join(DIR, clean + '.png') : null;
}

function forget() { uploaded = null; }

module.exports = { GLYPH, glyph, html, key, list, save, clear, file, forget, DIR };
