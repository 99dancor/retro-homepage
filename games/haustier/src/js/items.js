// Alle Gegenstände aus dem Konzept (/mnt/project-files/haustier/konzept.md, Abschnitt 6 und 7).
// Gegenstände nur für Tiere, die es noch nicht gibt (Pinguin, Panda, Igel, Einhorn), fehlen vorerst.
//
//   cat:        food | toy | care | acc | room | extra
//   for:        Tierarten, die es benutzen können (fehlt = alle); except: alle außer diesen
//   fav:        Lieblingssache dieser Arten, wirkt 50 % stärker
//   effect:     Änderungen der Werte beim Benutzen
//   req:        { level } Zuneigungsstufe eines Tieres, { best } beste Serie, { months } nur in diesen Monaten,
//               { owns } Tierart muss im Besitz sein; notForSale: nur als Geschenk
//   consumable: wird beim Benutzen verbraucht (Futter, Seife)
//   slot:       Accessoire-Platz head | neck | back

export const CATEGORIES = [
  { id: 'food', label: 'Futter', icon: '🍖' },
  { id: 'toy', label: 'Spielzeug', icon: '🎾' },
  { id: 'care', label: 'Pflege', icon: '🧼' },
  { id: 'acc', label: 'Accessoires', icon: '🎀' },
  { id: 'room', label: 'Räume', icon: '🖼️' },
];

const list = [
  // Futter (Verbrauchsgut)
  { id: 'food_dry', cat: 'food', name: 'Trockenfutter', icon: '🥣', price: 5, effect: { food: 20 } },
  { id: 'food_wet', cat: 'food', name: 'Nassfutter', icon: '🥫', price: 10, effect: { food: 35 }, for: ['cat', 'dog', 'fox'] },
  { id: 'food_hay', cat: 'food', name: 'Heu', icon: '🌾', price: 4, effect: { food: 20 }, for: ['rabbit', 'hamster'] },
  { id: 'food_carrot', cat: 'food', name: 'Karotte', icon: '🥕', price: 6, effect: { food: 25 }, for: ['rabbit', 'hamster', 'rat'], fav: ['rabbit'] },
  { id: 'food_seeds', cat: 'food', name: 'Sonnenblumenkerne', icon: '🌻', price: 6, effect: { food: 20 }, for: ['hamster', 'rat'], fav: ['hamster'] },
  { id: 'food_cheese', cat: 'food', name: 'Käsewürfel', icon: '🧀', price: 8, effect: { food: 25 }, for: ['rat', 'hamster'], fav: ['rat'] },
  { id: 'food_tuna', cat: 'food', name: 'Thunfisch', icon: '🐟', price: 12, effect: { food: 40 }, for: ['cat'], fav: ['cat'] },
  { id: 'food_bone', cat: 'food', name: 'Knochen', icon: '🦴', price: 12, effect: { food: 30, fun: 5 }, for: ['dog', 'fox'], fav: ['dog'] },
  { id: 'food_apple', cat: 'food', name: 'Apfelstück', icon: '🍎', price: 5, effect: { food: 15 }, except: ['cat'] },
  { id: 'food_treat', cat: 'food', name: 'Leckerli', icon: '🍪', price: 8, effect: { food: 10, love: 5 } },
  { id: 'food_milk', cat: 'food', name: 'Milch', icon: '🥛', price: 6, effect: { water: 25, food: 5 }, for: ['cat'] },
  { id: 'food_fish', cat: 'food', name: 'Fisch', icon: '🐠', price: 10, effect: { food: 35 }, for: ['cat', 'axolotl'] },
  { id: 'food_fireberry', cat: 'food', name: 'Feuerbeeren', icon: '🫐', price: 20, effect: { food: 50 }, for: ['dragon'], fav: ['dragon'] },
  { id: 'food_cake', cat: 'food', name: 'Regenbogenkuchen', icon: '🎂', price: 50, effect: { food: 60, joy: 10 }, req: { best: 30 } },

  // Spielzeug (hält für immer)
  { id: 'toy_ball', cat: 'toy', name: 'Ball', icon: '⚽', price: 40, effect: { fun: 15 }, fav: ['dog'] },
  { id: 'toy_yarn', cat: 'toy', name: 'Wollknäuel', icon: '🧶', price: 40, effect: { fun: 15 }, for: ['cat', 'fox'], fav: ['cat'] },
  { id: 'toy_duck', cat: 'toy', name: 'Quietsche-Ente', icon: '🦆', price: 50, effect: { fun: 15 }, for: ['dog', 'axolotl'] },
  { id: 'toy_feather', cat: 'toy', name: 'Federangel', icon: '🪶', price: 60, effect: { fun: 20 }, for: ['cat'] },
  { id: 'toy_wheel', cat: 'toy', name: 'Laufrad', icon: '🎡', price: 80, effect: { fun: 20, rest: -5 }, for: ['hamster', 'rat'], fav: ['hamster'] },
  { id: 'toy_rope', cat: 'toy', name: 'Kletterseil', icon: '🪢', price: 70, effect: { fun: 20 }, for: ['rat', 'hamster'], fav: ['rat'] },
  { id: 'toy_stick', cat: 'toy', name: 'Holzknabberstab', icon: '🪵', price: 30, effect: { fun: 10, food: 5 }, for: ['rabbit', 'hamster'], fav: ['rabbit'] },
  { id: 'toy_tunnel', cat: 'toy', name: 'Tunnel', icon: '🕳️', price: 90, effect: { fun: 20 }, for: ['rabbit', 'rat'] },
  { id: 'toy_frisbee', cat: 'toy', name: 'Frisbee', icon: '🥏', price: 100, effect: { fun: 25 }, for: ['dog', 'fox'] },
  { id: 'toy_laser', cat: 'toy', name: 'Laserpointer', icon: '🔦', price: 120, effect: { fun: 25 }, for: ['cat'] },
  { id: 'toy_bubbles', cat: 'toy', name: 'Seifenblasen', icon: '🫧', price: 60, effect: { fun: 15 } },
  { id: 'toy_plush', cat: 'toy', name: 'Kuschel-Plüschtier', icon: '🧸', price: 80, effect: { fun: 10, rest: 10 } },
  { id: 'toy_puzzle', cat: 'toy', name: 'Puzzle-Futterball', icon: '🧩', price: 150, effect: { fun: 20, food: 5 }, req: { level: 5 } },

  // Pflege (hält für immer, außer Seife)
  { id: 'care_brush', cat: 'care', name: 'Bürste', icon: '🪮', price: 50, note: 'Schaltet „Bürsten“ frei.' },
  { id: 'care_soap', cat: 'care', name: 'Seife', icon: '🧼', price: 15, consumable: true, note: 'Für „Baden“, wird verbraucht.' },
  { id: 'care_leash', cat: 'care', name: 'Leine', icon: '🦮', price: 60, for: ['dog', 'fox'], note: 'Schaltet „Gassi“ frei.' },
  { id: 'care_runball', cat: 'care', name: 'Laufball', icon: '🔵', price: 60, for: ['hamster', 'rat'], note: 'Schaltet „Ausflug“ frei.' },
  { id: 'care_bed', cat: 'care', name: 'Körbchen', icon: '🧺', price: 120, note: 'Ruhe sinkt 20 % langsamer.' },
  { id: 'extra_slot', cat: 'care', name: 'Weiterer Tierplatz', icon: '🏡', price: 2000, note: 'Platz für ein drittes Tier.' },

  // Accessoires (nur Aussehen, jedes Tier trägt je Platz eins)
  { id: 'acc_collar_red', cat: 'acc', slot: 'neck', name: 'Halsband rot', icon: '🔴', price: 30, color: '#d03030' },
  { id: 'acc_collar_blue', cat: 'acc', slot: 'neck', name: 'Halsband blau', icon: '🔵', price: 30, color: '#3060d0' },
  { id: 'acc_collar_green', cat: 'acc', slot: 'neck', name: 'Halsband grün', icon: '🟢', price: 30, color: '#30a040' },
  { id: 'acc_bowtie', cat: 'acc', slot: 'neck', name: 'Fliege', icon: '🎀', price: 50 },
  { id: 'acc_bell', cat: 'acc', slot: 'neck', name: 'Glöckchen', icon: '🔔', price: 40, note: 'Klingelt beim Streicheln.' },
  { id: 'acc_scarf', cat: 'acc', slot: 'neck', name: 'Halstuch', icon: '🧣', price: 60 },
  { id: 'acc_homepage', cat: 'acc', slot: 'neck', name: 'Homepage-Halstuch', icon: '💾', price: 0, notForSale: true, note: 'Geschenk für alle mit Konto.' },
  { id: 'acc_bow', cat: 'acc', slot: 'head', name: 'Schleife', icon: '🎀', price: 40 },
  { id: 'acc_beanie', cat: 'acc', slot: 'head', name: 'Mütze', icon: '🧢', price: 70 },
  { id: 'acc_sunglasses', cat: 'acc', slot: 'head', name: 'Sonnenbrille', icon: '🕶️', price: 90 },
  { id: 'acc_partyhat', cat: 'acc', slot: 'head', name: 'Partyhut', icon: '🥳', price: 60 },
  { id: 'acc_crown', cat: 'acc', slot: 'head', name: 'Krone', icon: '👑', price: 500, req: { level: 8 } },
  { id: 'acc_flowers', cat: 'acc', slot: 'head', name: 'Blumenkranz', icon: '🌸', price: 80, req: { months: [3, 4, 5] } },
  { id: 'acc_santa', cat: 'acc', slot: 'head', name: 'Weihnachtsmütze', icon: '🎅', price: 100, req: { months: [12] } },
  { id: 'acc_sweater', cat: 'acc', slot: 'back', name: 'Pullover', icon: '🧥', price: 120 },
  { id: 'acc_cape', cat: 'acc', slot: 'back', name: 'Umhang', icon: '🦸', price: 150 },
  { id: 'acc_wings', cat: 'acc', slot: 'back', name: 'Engelsflügel', icon: '🪽', price: 300, req: { best: 30 } },

  // Räume (Hintergründe)
  { id: 'room_living', cat: 'room', name: 'Wohnzimmer', icon: '🛋️', price: 0, notForSale: true, note: 'Von Anfang an da.' },
  { id: 'room_garden', cat: 'room', name: 'Garten', icon: '🌳', price: 300 },
  { id: 'room_kids', cat: 'room', name: 'Kinderzimmer', icon: '🧸', price: 400 },
  { id: 'room_beach', cat: 'room', name: 'Strand', icon: '🏖️', price: 600 },
  { id: 'room_retro', cat: 'room', name: 'Retro-PC-Ecke', icon: '💾', price: 0, req: { best: 7 } },
  { id: 'room_cave', cat: 'room', name: 'Drachenhöhle', icon: '🌋', price: 0, req: { owns: 'dragon' } },
];

export const ITEMS = Object.fromEntries(list.map((i) => [i.id, i]));
export const ITEM_LIST = list;

// Darf diese Tierart den Gegenstand benutzen?
export function usableBy(item, species) {
  if (item.for && !item.for.includes(species)) return false;
  if (item.except && item.except.includes(species)) return false;
  return true;
}

export const isFav = (item, species) => !!(item.fav && item.fav.includes(species));
export const isDurable = (item) => item.cat !== 'food' && !item.consumable;
export const owned = (state, id) => (state.inventory[id] || 0) > 0;
