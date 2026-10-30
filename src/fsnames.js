'use strict';
// Deutsche Namen für den Farming Simulator Hub: Waren (Feed-Kürzel wie WHEAT), Fahrzeugarten, Monate und Wetter.
// Unbekannte Kürzel (z. B. aus Mods) werden lesbar gemacht: „GRAPEJUICE_BULK“ → „Grapejuice Bulk“.

const FILL = {
  // Feldfrüchte und Ernte
  WHEAT: 'Weizen', BARLEY: 'Gerste', OAT: 'Hafer', RYE: 'Roggen', TRITICALE: 'Triticale', SPELT: 'Dinkel', WINTERWHEAT: 'Winterweizen', WINTERBARLEY: 'Wintergerste',
  CANOLA: 'Raps', SORGHUM: 'Sorghum', SUNFLOWER: 'Sonnenblumen', SOYBEAN: 'Sojabohnen', MAIZE: 'Mais', SILAGEMAIZE: 'Silomais', POTATO: 'Kartoffeln',
  SUGARBEET: 'Zuckerrüben', SUGARBEET_CUT: 'Zuckerrübenschnitzel', BEETROOT: 'Rote Bete', CARROT: 'Karotten', PARSNIP: 'Pastinaken', ONION: 'Zwiebeln',
  ONION_DIRTY: 'Zwiebeln (ungewaschen)', COTTON: 'Baumwolle', RICE: 'Reis', RICELONGGRAIN: 'Langkornreis', GREENBEAN: 'Grüne Bohnen', PEA: 'Erbsen',
  SPINACH: 'Spinat', SUGARCANE: 'Zuckerrohr', GRAPE: 'Trauben', TABLEGRAPE: 'Tafeltrauben', OLIVE: 'Oliven', POPLAR: 'Pappeln', COFFEE: 'Kaffee',
  COFFEECHERRIES: 'Kaffeekirschen', BANANA: 'Bananen', MUSTARD: 'Senf', OILSEEDRADISH: 'Ölrettich', FLOWERINGCATCHCROP: 'Blühende Zwischenfrucht',
  GREENRYE: 'Grünroggen', VETCHRYE: 'Wickroggen', HUMUSACTIVE: 'Humusaktiv', ALFALFA: 'Luzerne', CLOVER: 'Klee', FIELDGRASS: 'Feldgras',
  WHEAT_CUT: 'Weizen (gemäht)', BARLEY_CUT: 'Gerste (gemäht)', OAT_CUT: 'Hafer (gemäht)', RYE_CUT: 'Roggen (gemäht)', TRITICALE_CUT: 'Triticale (gemäht)',
  SPELT_CUT: 'Dinkel (gemäht)', CANOLA_CUT: 'Raps (gemäht)', SOYBEAN_CUT: 'Sojabohnen (gemäht)',
  // Gewächshaus und Garten
  LETTUCE: 'Salat', TOMATO: 'Tomaten', STRAWBERRY: 'Erdbeeren', SPRING_ONION: 'Frühlingszwiebeln', NAPACABBAGE: 'Chinakohl', CHILLI: 'Chilischoten',
  GARLIC: 'Knoblauch', ENOKI: 'Enoki-Pilze', OYSTER: 'Austernpilze', GREENPEPPER: 'Paprika', CUCUMBER: 'Gurken', WATERMELON: 'Wassermelonen',
  APPLE: 'Äpfel', PEAR: 'Birnen', APRICOT: 'Aprikosen', PLUM: 'Pflaumen',
  // Gras, Heu, Stroh, Futter
  GRASS: 'Gras', GRASS_WINDROW: 'Gras', MEADOW: 'Wiese', DRYGRASS: 'Heu', DRYGRASS_WINDROW: 'Heu', STRAW: 'Stroh', CHAFF: 'Häckselgut', SILAGE: 'Silage',
  ALFALFA_WINDROW: 'Luzerne', DRYALFALFA: 'Luzerneheu', DRYALFALFA_WINDROW: 'Luzerneheu', ALFALFA_FERMENTED: 'Luzernesilage', CLOVER_WINDROW: 'Klee',
  DRYCLOVER: 'Kleeheu', DRYCLOVER_WINDROW: 'Kleeheu', CLOVER_FERMENTED: 'Kleesilage', FORAGE: 'Mischration', FORAGE_MIXING: 'Mischration (unfertig)',
  HAY_PELLETS: 'Heupellets', STRAW_PELLETS: 'Strohpellets', PIGFOOD: 'Schweinefutter', PIGFOODWF: 'Schweinefutter', CHICKENFOOD: 'Hühnerfutter',
  MINERAL_FEED: 'Mineralfutter', FISHFOOD: 'Fischfutter',
  ROUNDBALE: 'Rundballen', SQUAREBALE: 'Quaderballen', ROUNDBALE_GRASS: 'Rundballen Gras', ROUNDBALE_DRYGRASS: 'Rundballen Heu', ROUNDBALE_COTTON: 'Rundballen Baumwolle',
  ROUNDBALE_WOOD: 'Rundballen Holz', SQUAREBALE_GRASS: 'Quaderballen Gras', SQUAREBALE_DRYGRASS: 'Quaderballen Heu', SQUAREBALE_COTTON: 'Quaderballen Baumwolle',
  SQUAREBALE_WOOD: 'Quaderballen Holz',
  // Tiere und tierische Erzeugnisse
  MILK: 'Milch', GOATMILK: 'Ziegenmilch', BUFFALOMILK: 'Büffelmilch', WOOL: 'Wolle', ALPACAWOOL: 'Alpakawolle', ALPACAFLEECE: 'Alpakavlies', EGG: 'Eier',
  HONEY: 'Honig', MANURE: 'Mist', SEPARATED_MANURE: 'Separierter Mist', LIQUIDMANURE: 'Gülle', DIGESTATE: 'Gärreste', TROUT: 'Forellen', TROUTYOUNG: 'Jungforellen',
  SALMON: 'Lachse', SALMONYOUNG: 'Junglachse', CHICKEN: 'Hühner', CHICKEN_ROOSTER: 'Hähne', GOAT: 'Ziegen',
  COW_HOLSTEIN: 'Kühe (Holstein)', COW_SWISS_BROWN: 'Kühe (Braunvieh)', COW_ANGUS: 'Kühe (Angus)', COW_LIMOUSIN: 'Kühe (Limousin)', COW_BRAHMAN: 'Kühe (Brahman)',
  COW_HIGHLAND_CATTLE: 'Kühe (Hochlandrind)', COW_WATERBUFFALO: 'Wasserbüffel', PIG_LANDRACE: 'Schweine (Landrasse)', PIG_BLACK_PIED: 'Schweine (Schwarzbunt)',
  PIG_BERKSHIRE: 'Schweine (Berkshire)', SHEEP_LANDRACE: 'Schafe (Landrasse)', SHEEP_STEINSCHAF: 'Schafe (Steinschaf)', SHEEP_SWISS_MOUNTAIN: 'Schafe (Bergschaf)',
  SHEEP_BLACK_WELSH: 'Schafe (Black Welsh)', HORSE_GRAY: 'Pferd (Schimmel)', HORSE_PINTO: 'Pferd (Schecke)', HORSE_PALOMINO: 'Pferd (Palomino)',
  HORSE_CHESTNUT: 'Pferd (Fuchs)', HORSE_BAY: 'Pferd (Brauner)', HORSE_BLACK: 'Pferd (Rappe)', HORSE_SEAL_BROWN: 'Pferd (Schwarzbrauner)', HORSE_DUN: 'Pferd (Falbe)',
  // Holz und Bau
  WOOD: 'Holz', WOODCHIPS: 'Hackschnitzel', BOARDS: 'Bretter', PLANKS: 'Planken', WOODBEAM: 'Holzbalken', PREFABWALL: 'Fertigwände', FURNITURE: 'Möbel',
  CARTONROLL: 'Kartonrollen', PAPERROLL: 'Papierrollen', RESIN: 'Harz', SHINGLEROOF: 'Dachschindeln', ROOFPLATES: 'Dachplatten', CEMENT: 'Zement',
  CEMENTBRICKS: 'Zementsteine', STONE: 'Steine', STONEBIG: 'Große Steine', CASTLEROCK: 'Burgsteine', COAL: 'Kohle', TREESAPLINGS: 'Setzlinge', TREE: 'Baum',
  // Lebensmittel
  FLOUR: 'Mehl', RICEFLOUR: 'Reismehl', BREAD: 'Brot', CAKE: 'Kuchen', SUGAR: 'Zucker', CEREAL: 'Müsli', CHOCOLATE: 'Schokolade', BUTTER: 'Butter',
  CHEESE: 'Käse', GOATCHEESE: 'Ziegenkäse', BUFFALOMOZZARELLA: 'Büffelmozzarella', MILK_BOTTLED: 'Milch (Flaschen)', GOATMILK_BOTTLED: 'Ziegenmilch (Flaschen)',
  BUFFALOMILK_BOTTLED: 'Büffelmilch (Flaschen)', POTATOCHIPS: 'Kartoffelchips', RICEROLLS: 'Reisröllchen', RICE_BAGS: 'Reis (Säcke)', RICE_BOXES: 'Reis (Kartons)',
  SPINACH_BAGS: 'Spinat (Beutel)', CANNED_PEAS: 'Erbsen (Dosen)', JARRED_GREENBEAN: 'Grüne Bohnen (Gläser)', PRESERVEDCARROTS: 'Karotten (Konserven)',
  PRESERVEDPARSNIP: 'Pastinaken (Konserven)', PRESERVEDBEETROOT: 'Rote Bete (Konserven)', FERMENTEDNAPACABBAGE: 'Kimchi', SOUPCANSMIXED: 'Gemüsesuppe (Dosen)',
  SOUPCANSCARROTS: 'Karottensuppe (Dosen)', SOUPCANSPARSNIP: 'Pastinakensuppe (Dosen)', SOUPCANSBEETROOT: 'Rote-Bete-Suppe (Dosen)',
  SOUPCANSPOTATO: 'Kartoffelsuppe (Dosen)', NOODLESOUP: 'Nudelsuppe', ONIONSOUP: 'Zwiebelsuppe', ONIONSALT: 'Zwiebelsalz', ONIONBAG: 'Zwiebeln (Netze)',
  FRIEDONION: 'Röstzwiebeln', KETCHUP: 'Ketchup', PICKLES: 'Essiggurken', RAISINS: 'Rosinen', GRAPEJUICE: 'Traubensaft', GRAPEJUICE_BULK: 'Traubensaft (lose)',
  GRAPEJUICE_PREMIUM: 'Traubensaft (Premium)', GRAPEJUICE_BUBBLE: 'Traubenschorle', GRAPEMUST: 'Traubenmost', GRAPESEED: 'Traubenkerne',
  GRAPESEED_OIL: 'Traubenkernöl', GRAPELEATHER: 'Fruchtleder', APPLEJUICE: 'Apfelsaft', STRAWBERRYJUICE: 'Erdbeersaft', APRICOTJAM: 'Aprikosenmarmelade',
  PLUMJAM: 'Pflaumenmarmelade', SUNFLOWER_OIL: 'Sonnenblumenöl', CANOLA_OIL: 'Rapsöl', OLIVE_OIL: 'Olivenöl', OLIVEOIL: 'Olivenöl', PAINT: 'Farbe', ROASTEDCOFFEE: 'Röstkaffee', ROASTED_COFFEE: 'Röstkaffee', COFFEEBEANS: 'Kaffeebohnen', KIDSCLOTHES: 'Kinderkleidung', RICE_OIL: 'Reisöl', MOLASSES: 'Melasse',
  TIRAMISU: 'Tiramisu',
  // Kaffee, Bananen und Alpakas (Beans and Alpacas)
  COFFEEBAGS: 'Kaffeebohnen (Säcke)', COFFEEPACKED: 'Kaffee (Packungen)', COFFEECAPSULES: 'Kaffeekapseln', COFFEEBEVERAGE: 'Kaffeegetränk',
  COFFEEYOGURT: 'Kaffeejoghurt', BANANABOX: 'Bananen (Kisten)', BANANACAKE: 'Bananenkuchen', BANANACANDY: 'Bananenbonbons', BANANACHIPS: 'Bananenchips',
  BANANAFRIEDBOX: 'Gebratene Bananen', BANANAJAM: 'Bananenmarmelade', BANANAMILK: 'Bananenmilch', ALPACASOCKS: 'Alpakasocken', ALPACAPLUSH: 'Alpaka-Plüschtiere',
  ALPACAPILLOW: 'Alpakakissen', ALPACACHAIR: 'Alpakastühle', ALPACAARMCHAIR: 'Alpakasessel',
  ALPACA_WHITE: 'Alpakas (weiß)', ALPACA_BROWN: 'Alpakas (braun)', ALPACA_GREY: 'Alpakas (grau)', ALPACA_FAWN: 'Alpakas (rehbraun)',
  IRONORE: 'Eisenerz', COPPERORE: 'Kupfererz', FUNGICIDE: 'Fungizid', UMBILICAL_HOSE: 'Schleppschlauch',
  // Textilien und Waren
  FABRIC: 'Stoff', CLOTHES: 'Kleidung', ROPE: 'Seile', POLYESTER: 'Polyester', SHOES: 'Schuhe', BELTS: 'Gürtel', PIGMENTS: 'Pigmente', PAINTBUCKETS: 'Farbeimer',
  BARREL: 'Fässer', BUCKET: 'Eimer', BATHTUB: 'Badewannen', PIANO: 'Klaviere', WAGON: 'Holzwagen', TOYTRACTOR: 'Spielzeugtraktoren',
  // Betriebsmittel
  SEEDS: 'Saatgut', FERTILIZER: 'Dünger', LIQUIDFERTILIZER: 'Flüssigdünger', LIME: 'Kalk', HERBICIDE: 'Herbizid', LIQUIDSEEDTREATMENT: 'Saatgutbeize',
  SILAGE_ADDITIVE: 'Siliermittel', RICESAPLINGS: 'Reissetzlinge', COMPOST: 'Kompost', COMPOSTRAW: 'Kompost (roh)', ORGANICWASTE: 'Bioabfall',
  DIESEL: 'Diesel', DEF: 'AdBlue', METHANE: 'Methan', ELECTRICCHARGE: 'Strom', WATER: 'Wasser', ROADSALT: 'Streusalz', BALE_WRAP: 'Ballenfolie',
  BALE_NET: 'Ballennetz', BALE_TWINE: 'Ballengarn', TARP: 'Plane', AIR: 'Luft', WEED: 'Unkraut', SNOW: 'Schnee', UNKNOWN: 'Unbekannt',
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
// Monate wie im Spiel: Periode 1 ist der Frühlingsanfang, auf der Nordhalbkugel der März, auf der Südhalbkugel der September.
// MONTHS[i] ist der Name von Periode i + 1; ORDER sind die Perioden von Januar bis Dezember für jeden Kalender.
// setHemisphere ändert die Listen an Ort und Stelle, damit jeder, der sie schon hat, die richtigen Namen sieht.
const NAMES = ['März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember', 'Januar', 'Februar'];
const NAMES_SHORT = ['Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez', 'Jan', 'Feb'];
const MONTHS = NAMES.slice(), MONTHS_SHORT = NAMES_SHORT.slice(), ORDER = [];
let hemisphere = 'north';
function setHemisphere(h) {
  hemisphere = h === 'south' ? 'south' : 'north';
  const shift = hemisphere === 'south' ? 6 : 0, jan = (10 + 12 - shift) % 12;
  for (let i = 0; i < 12; i++) {
    MONTHS[i] = NAMES[(i + shift) % 12];
    MONTHS_SHORT[i] = NAMES_SHORT[(i + shift) % 12];
    ORDER[i] = (jan + i) % 12;
  }
}
setHemisphere('north');
// Stelle einer Periode (0–11) im Kalender ab Januar
const calPos = period => ORDER.indexOf(period);
const PERIODS = ['EARLY_SPRING', 'MID_SPRING', 'LATE_SPRING', 'EARLY_SUMMER', 'MID_SUMMER', 'LATE_SUMMER',
  'EARLY_AUTUMN', 'MID_AUTUMN', 'LATE_AUTUMN', 'EARLY_WINTER', 'MID_WINTER', 'LATE_WINTER'];
const WEATHER = { SUN: ['☀️', 'Sonnig'], CLOUDY: ['☁️', 'Bewölkt'], RAIN: ['🌧️', 'Regen'], SNOW: ['🌨️', 'Schnee'], FOG: ['🌫️', 'Nebel'],
  THUNDER: ['⛈️', 'Gewitter'], TWISTER: ['🌪️', 'Sturm'], HAIL: ['🌨️', 'Hagel'] };
// Zustände eines Flecks oder Felds für die Karte (aus Dichtekarten oder fields.xml)
const STATES = {
  gepfluegt: ['Gepflügt', '#8b5a2b'], gegrubbert: ['Gegrubbert / Saatbett', '#b07a46'], gesaet: ['Gesät', '#c9e39a'], waechst: ['Wächst', '#5aa83c'],
  reif: ['Erntereif', '#f2c94c'], geerntet: ['Geerntet', '#d9c79e'], verdorrt: ['Verdorrt', '#8a6a4a'], gras: ['Grünland', '#3f9a3a'], gemaeht: ['Gemäht', '#b5d98a'],
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
// Namen aus dem Spiel (Mod „Farming Hub Export“, Waren in der Sprache des Servers): nur deutsche, und nur für Waren, die hier
// fehlen (Mods, neue DLCs). Die Liste oben geht vor, damit alles gleich heißt.
let gameTitles = new Map();
function setGameTitles(list, language) {
  gameTitles = new Map(String(language || '').toLowerCase() === 'de' ? (list || []).filter(f => f.title && !/^\$l10n/.test(f.title)).map(f => [f.name, f.title]) : []);
}
const fill = code => FILL[code] || gameTitles.get(code) || pretty(code);
const category = code => CATEGORY[code] || pretty(code);

module.exports = { setGameTitles, setHemisphere, hemisphere: () => hemisphere, FILL, CATEGORY, MONTHS, MONTHS_SHORT, ORDER, calPos, PERIODS, WEATHER, STATES, GROUND, GROUND_LABEL, fill, category, pretty };
