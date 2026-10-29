'use strict';
// Deutsche Namen für den Farming Simulator Hub: Waren (Feed-Kürzel wie WHEAT), Fahrzeugarten, Monate und Wetter.
// Unbekannte Kürzel (z. B. aus Mods) werden lesbar gemacht: „GRAPEJUICE_BULK“ → „Grapejuice Bulk“.

const FILL = {
  WHEAT: 'Weizen', BARLEY: 'Gerste', OAT: 'Hafer', CANOLA: 'Raps', SORGHUM: 'Sorghum', SUNFLOWER: 'Sonnenblumen', SOYBEAN: 'Sojabohnen',
  MAIZE: 'Mais', POTATO: 'Kartoffeln', SUGARBEET: 'Zuckerrüben', BEETROOT: 'Rote Bete', CARROT: 'Karotten', PARSNIP: 'Pastinaken', COTTON: 'Baumwolle',
  RICELONGGRAIN: 'Langkornreis', RICE: 'Reis', GREENBEAN: 'Grüne Bohnen', PEA: 'Erbsen', SPINACH: 'Spinat', SUGARCANE: 'Zuckerrohr', WOOD: 'Holz',
  WOODCHIPS: 'Hackschnitzel', SUGARBEET_CUT: 'Rübenschnitzel', SILAGE: 'Silage', GRASS: 'Gras', MEADOW: 'Wiese', GRASS_WINDROW: 'Gras (Schwad)',
  DRYGRASS: 'Heu', DRYGRASS_WINDROW: 'Heu (Schwad)', STRAW: 'Stroh', GRAPE: 'Trauben', OLIVE: 'Oliven', MILK: 'Milch', GOATMILK: 'Ziegenmilch',
  BUFFALOMILK: 'Büffelmilch', WOOL: 'Wolle', EGG: 'Eier', HONEY: 'Honig', LETTUCE: 'Salat', TOMATO: 'Tomaten', STRAWBERRY: 'Erdbeeren',
  SPRING_ONION: 'Frühlingszwiebeln', NAPACABBAGE: 'Chinakohl', CHILLI: 'Chili', GARLIC: 'Knoblauch', ENOKI: 'Enoki', OYSTER: 'Austernpilze',
  BOARDS: 'Bretter', PLANKS: 'Planken', WOODBEAM: 'Holzbalken', PREFABWALL: 'Fertigwände', FLOUR: 'Mehl', RICEFLOUR: 'Reismehl', BREAD: 'Brot',
  CAKE: 'Kuchen', MILK_BOTTLED: 'Milch (Flaschen)', GOATMILK_BOTTLED: 'Ziegenmilch (Flaschen)', BUFFALOMILK_BOTTLED: 'Büffelmilch (Flaschen)',
  BUTTER: 'Butter', CHEESE: 'Käse', BUFFALOMOZZARELLA: 'Büffelmozzarella', GOATCHEESE: 'Ziegenkäse', CHOCOLATE: 'Schokolade',
  POTATOCHIPS: 'Kartoffelchips', RICEROLLS: 'Reisröllchen', FABRIC: 'Stoff', CLOTHES: 'Kleidung', SUGAR: 'Zucker', CEREAL: 'Müsli',
  FURNITURE: 'Möbel', CARTONROLL: 'Kartonrollen', PAPERROLL: 'Papierrollen', SUNFLOWER_OIL: 'Sonnenblumenöl', CANOLA_OIL: 'Rapsöl',
  OLIVE_OIL: 'Olivenöl', RICE_OIL: 'Reisöl', RAISINS: 'Rosinen', GRAPEJUICE: 'Traubensaft', CEMENT: 'Zement', SEEDS: 'Saatgut', STONE: 'Steine',
  MANURE: 'Mist', LIQUIDMANURE: 'Gülle', DIGESTATE: 'Gärrest', FORAGE: 'Futtermischung', FORAGE_MIXING: 'Futtermischung (Mischen)', WATER: 'Wasser',
  CHAFF: 'Häckselgut', TREESAPLINGS: 'Setzlinge', POPLAR: 'Pappel', DIESEL: 'Diesel', DEF: 'AdBlue', AIR: 'Luft', ELECTRICCHARGE: 'Strom',
  METHANE: 'Methan', ROADSALT: 'Streusalz', BALE_WRAP: 'Ballenfolie', BALE_NET: 'Ballennetz', BALE_TWINE: 'Ballengarn', RICESAPLINGS: 'Reissetzlinge',
  FERTILIZER: 'Dünger', LIQUIDFERTILIZER: 'Flüssigdünger', PIGFOOD: 'Schweinefutter', LIME: 'Kalk', HERBICIDE: 'Herbizid',
  SILAGE_ADDITIVE: 'Siliermittel', MINERAL_FEED: 'Mineralfutter', WEED: 'Unkraut', CHICKEN: 'Hühner', GOAT: 'Ziegen', RYE: 'Roggen',
  TRITICALE: 'Triticale', SPELT: 'Dinkel', WINTERWHEAT: 'Winterweizen', WINTERBARLEY: 'Wintergerste', ALFALFA: 'Luzerne', CLOVER: 'Klee',
  ONION: 'Zwiebeln', FISHFOOD: 'Fischfutter', TROUT: 'Forelle', TROUTYOUNG: 'Jungforellen', SALMON: 'Lachs', SALMONYOUNG: 'Junglachse',
  APPLE: 'Äpfel', PEAR: 'Birnen', APRICOT: 'Aprikosen', PLUM: 'Pflaumen', GREENPEPPER: 'Paprika', CUCUMBER: 'Gurken', WATERMELON: 'Wassermelonen',
  GRAPESEED: 'Traubenkerne', GRAPEMUST: 'Traubenmost', GRAPESEED_OIL: 'Traubenkernöl', TABLEGRAPE: 'Tafeltrauben', COMPOST: 'Kompost',
  MUSTARD: 'Senf', OILSEEDRADISH: 'Ölrettich', SILAGEMAIZE: 'Silomais', MOLASSES: 'Melasse', COAL: 'Kohle', LIQUIDSEEDTREATMENT: 'Saatgutbeize',
  ROUNDBALE: 'Rundballen', SQUAREBALE: 'Quaderballen', CANNED_PEAS: 'Erbsen (Dose)', SPINACH_BAGS: 'Spinat (Beutel)', RICE_BAGS: 'Reis (Säcke)',
  COFFEE: 'Kaffee', BANANA: 'Bananen', ALPACA_WOOL: 'Alpakawolle', APPLEJUICE: 'Apfelsaft', KETCHUP: 'Ketchup', PICKLES: 'Essiggurken', ROPE: 'Seile', BARREL: 'Fässer', BUCKET: 'Eimer',
};
const CATEGORY = {
  TRACTORSS: 'Traktor (klein)', TRACTORSM: 'Traktor (mittel)', TRACTORSL: 'Traktor (groß)', TRUCKS: 'Lkw', CARS: 'Auto', HARVESTERS: 'Mähdrescher',
  FORAGEHARVESTERS: 'Feldhäcksler', GRAPEHARVESTERS: 'Traubenvollernter', RICEHARVESTERS: 'Reisernter', CUTTERS: 'Schneidwerk', CORNHEADERS: 'Maisgebiss',
  FORAGEHARVESTERCUTTERS: 'Häcksler-Vorsatz', CUTTERTRAILERS: 'Schneidwerkswagen', TRAILERS: 'Anhänger', TRAILERSSEMI: 'Auflieger', AUGERWAGONS: 'Überladewagen',
  SLURRYTANKS: 'Güllefass', SLURRYTOOLS: 'Gülletechnik', SLURRYTRANSPORT: 'Gülletransport', FERTILIZERSPREADERS: 'Düngerstreuer', SPRAYERS: 'Spritze',
  SEEDERS: 'Sämaschine', PLANTERS: 'Legemaschine', RICEPLANTERS: 'Reispflanzer', CULTIVATORS: 'Grubber', PLOWS: 'Pflug', POWERHARROWS: 'Kreiselegge',
  SUBSOILERS: 'Tiefenlockerer', WEEDERS: 'Striegel', MOWERS: 'Mähwerk', TEDDERS: 'Wender', WINDROWERS: 'Schwader', BALERSSQUARE: 'Quaderballenpresse',
  BALERSROUND: 'Rundballenpresse', BALELOADERS: 'Ballensammler', MULCHERS: 'Mulcher', LEVELER: 'Schild', SILOCOMPACTION: 'Siloverdichter',
  FRONTLOADERS: 'Frontlader', FRONTLOADERTOOLS: 'Frontlader-Werkzeug', TELELOADERVEHICLES: 'Teleskoplader', TELELOADERTOOLS: 'Teleskoplader-Werkzeug',
  WHEELLOADERVEHICLES: 'Radlader', WHEELLOADERTOOLS: 'Radlader-Werkzeug', WEIGHTS: 'Gewicht', GRAPETOOLS: 'Weinbau-Gerät', GRAPETRAILERS: 'Traubenwagen',
  MISC: 'Sonstiges', PALLETS: 'Palette', PALLETSILAGE: 'Palette', BIGBAGS: 'Big Bag', IBC: 'IBC-Tank', BARRELS: 'Fass',
};
// Monate wie im Spiel: Periode 1 ist der März (EARLY_SPRING)
const MONTHS = ['März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember', 'Januar', 'Februar'];
const MONTHS_SHORT = ['Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez', 'Jan', 'Feb'];
const PERIODS = ['EARLY_SPRING', 'MID_SPRING', 'LATE_SPRING', 'EARLY_SUMMER', 'MID_SUMMER', 'LATE_SUMMER',
  'EARLY_AUTUMN', 'MID_AUTUMN', 'LATE_AUTUMN', 'EARLY_WINTER', 'MID_WINTER', 'LATE_WINTER'];
const WEATHER = { SUN: ['☀️', 'Sonnig'], CLOUDY: ['☁️', 'Bewölkt'], RAIN: ['🌧️', 'Regen'], SNOW: ['🌨️', 'Schnee'], FOG: ['🌫️', 'Nebel'],
  THUNDER: ['⛈️', 'Gewitter'], TWISTER: ['🌪️', 'Sturm'], HAIL: ['🌨️', 'Hagel'] };
// Zustände eines Felds für die Karte (gemeldet von Mitgliedern)
const STATES = {
  gepfluegt: ['Gepflügt', '#8b5a2b'], gegrubbert: ['Gegrubbert / Saatbett', '#b07a46'], gesaet: ['Gesät', '#c9e39a'], waechst: ['Wächst', '#5aa83c'],
  reif: ['Erntereif', '#f2c94c'], geerntet: ['Geerntet', '#d9c79e'], gras: ['Grünland', '#3f9a3a'], gemaeht: ['Gemäht', '#b5d98a'],
  kalk: ['Kalk nötig', '#e8e8e8'], brach: ['Brach', '#a0a0a0'],
};
// Bodenart aus fields.xml (groundType) → Zustand auf der Karte; gesät wird ab Wachstumsstufe 2 zu „wächst“
const GROUND = {
  PLOWED: 'gepfluegt', CULTIVATED: 'gegrubbert', STUBBLE_TILLAGE: 'gegrubbert', SEEDBED: 'gegrubbert', ROLLED_SEEDBED: 'gegrubbert', RIDGE: 'gegrubbert',
  ROLLER_LINES: 'gegrubbert', SOWN: 'gesaet', DIRECT_SOWN: 'gesaet', PLANTED: 'gesaet', RIDGE_SOWN: 'gesaet',
  HARVEST_READY: 'reif', HARVEST_READY_OTHER: 'reif', GRASS: 'gras', GRASS_CUT: 'gemaeht',
};
const GROUND_LABEL = {
  PLOWED: 'gepflügt', CULTIVATED: 'gegrubbert', STUBBLE_TILLAGE: 'Stoppeln bearbeitet', SEEDBED: 'Saatbett', ROLLED_SEEDBED: 'Saatbett gewalzt', RIDGE: 'Dämme',
  ROLLER_LINES: 'gewalzt', SOWN: 'gesät', DIRECT_SOWN: 'direkt gesät', PLANTED: 'gepflanzt', RIDGE_SOWN: 'Dämme gesät',
  HARVEST_READY: 'erntereif', HARVEST_READY_OTHER: 'erntereif', GRASS: 'Grünland', GRASS_CUT: 'gemäht',
};

const pretty = code => String(code || '').toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const fill = code => FILL[code] || pretty(code);
const category = code => CATEGORY[code] || pretty(code);

module.exports = { FILL, CATEGORY, MONTHS, MONTHS_SHORT, PERIODS, WEATHER, STATES, GROUND, GROUND_LABEL, fill, category, pretty };
