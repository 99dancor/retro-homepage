// Einrichtung: Möbel, Näpfe, Deko und Spielzeug, das fest steht. Jedes Teil steht an genau einem Ort:
// im Zimmer, auf dem Desktop der Homepage oder im Fach (state.place, siehe state.js). Ohne DOM, damit Zimmer,
// Desktop-Ebene (public/desk-pets.js) und Tests dieselben Bilder und Regeln haben.
//
//   FURN[id]        { w, h, wall, sleep, seat, bowl, chest, station, climb, hide, tops, flat }
//                   wall:    hängt an der Wand (Zimmer) bzw. bleibt hängen, wo man es loslässt (Desktop)
//                   sleep:   Schlafplatz (true = alle Tiere, sonst Liste der Arten); hide: Tier verschwindet darin
//                   bowl:    'food' | 'water'      chest: Spielzeugkiste      station: Spielzeug, das steht
//                   climb:   Katzen klettern hinauf  tops: Höhen (Bildpunkte von oben), auf denen man auf dem Desktop steht
//                   flat:    liegt flach (Teppich), steht immer hinter den Tieren
//                   toy/desk: Wurfspielzeug, das nur auf dem Desktop liegt (Bild aus icons.js)
//                   seat:    Höhe (Bildpunkte von oben), auf der ein schlafendes Tier liegt
//   furnGrid(id)    Raster          furnSvg(id, cls)   fertiges <svg>
//   placeable(id)   kann aufgestellt werden          MAX_ROOM / MAX_DESK   so viele Teile höchstens
import { grid, paint, fill, ell, poly, box, tube, and, or, not, dot, stamp, lineOf, gridSvg } from './pixel.js';

const I = (c, extra = {}) => ({ fill: c, line: lineOf(c), ...extra });
const hi = (cx, cy, rx, ry, c) => [ell(cx, cy, rx, ry), c];
const G = (fn, w, h) => () => { const g = grid(w, h); fn(g); return g; };

export const MAX_ROOM = 16;
export const MAX_DESK = 12;
const SMALL = ['hamster', 'rat', 'axolotl'];

// Napf: rote oder blaue Schale, Füllstand 0 bis 1 (leer, halb, voll)
function bowl(g, color, light, content) {
  if (content) content(g);
  paint(g, or(and(ell(12, 6, 11, 6), (x, y) => y > 6), ell(12, 6, 11, 2)), I(color, { hi: hi(6, 9, 2, 1.2, light) }));
}
const kibble = (n) => (g) => {
  const spots = [[6, 4], [9, 3], [12, 4], [15, 3], [18, 4], [8, 5], [13, 5], [17, 5], [11, 4]].slice(0, n);
  for (const [x, y] of spots) paint(g, ell(x, y + 1, 1.6, 1.3), I('#a8743e', { shade: null }));
};
function wheel(g, cx, cy, r, frame) {
  const lw = Math.max(0.7, r / 12);
  for (const d of [-1, 1]) paint(g, tube([cx, cy], [cx + d * r * 0.35, cy + r * 0.6], [cx + d * r * 0.62, g.h - 1], lw), I('#7a7a88', { shade: null }));
  const ring = paint(g, and(ell(cx, cy, r, r), not(ell(cx, cy, r - 2.2, r - 2.2))), I('#e05050', { shade: '#b83838' }));
  for (let k = 0; k < 4; k++) {
    const a = ((k * 45 + frame * 22.5) * Math.PI) / 180;
    for (let t = -r + 2; t <= r - 2; t += 0.5) {
      const x = Math.floor(cx + Math.cos(a) * t), y = Math.floor(cy + Math.sin(a) * t);
      if (!ring[y * g.w + x]) dot(g, x, y, '#e8a0a0');
    }
  }
  paint(g, ell(cx, cy, 1.6, 1.6), I('#c03030', { shade: null }));
}
function chest(g, open) {
  paint(g, box(2, 9, 22, 19), I('#a8693a', { hi: [box(3, 10, 21, 11), '#c88a50'] }));
  for (const y of [13, 16]) for (let x = 3; x < 21; x++) dot(g, x, y, '#8a5428');
  if (open) {
    paint(g, poly([[2, 9], [4, 1], [20, 1], [22, 9]]), I('#6a3a1a', { shade: null }));
    stamp(g, 5, 5, ['.rr..yy.bb', 'rrrryyyybbb', '.rr..yy.bbb'], { r: '#e8434f', y: '#ffd23c', b: '#4a90e0' });
  } else {
    paint(g, or(and(ell(12, 9, 10.5, 6), (x, y) => y < 9.5), box(1.5, 7, 22.5, 10)), I('#b8763a', { hi: [box(4, 4, 20, 5), '#d8965a'] }));
  }
  paint(g, box(10.5, open ? 9 : 8, 13.5, 12), I('#ffd23c', { shade: '#e0961e' }));
}
// Bilderrahmen mit Motiv
function frame(g, w, h, wood, motif) {
  paint(g, box(1, 1, w - 1, h - 1), I(wood, { shade: null }));
  motif(g);
}

const SPRITES = {
  care_bed: G((g) => {
    paint(g, ell(30, 13, 29, 6.6), I('#b8763a', { hi: [ell(14, 10.5, 7, 1.4), '#d8965a'] }));
    paint(g, ell(30, 11.5, 23, 3.8), I('#f4c6d8', { shade: '#e0a8c0', hi: hi(22, 10.5, 6, 1, '#fde4ee') }));
    for (let x = 4; x < 56; x += 4) dot(g, x, 16, '#8a5428');
  }, 60, 20),
  furn_bed2: G((g) => {
    paint(g, ell(30, 13, 29, 6.6), I('#5a7ab8', { hi: [ell(14, 10.5, 7, 1.4), '#8aa4d8'] }));
    paint(g, ell(30, 11.5, 23, 3.8), I('#e8f0ff', { shade: '#c0d0f0', hi: hi(22, 10.5, 6, 1, '#ffffff') }));
    for (let x = 6; x < 56; x += 6) dot(g, x, 16, '#3a5a98');
  }, 60, 20),
  furn_cushion: G((g) => {
    paint(g, or(ell(14, 6, 13, 3.6), box(2, 5, 26, 9)), I('#e86a8a', { hi: hi(9, 4.5, 5, 1, '#ffa0b8') }));
    for (let x = 4; x < 25; x += 3) dot(g, x, 8, '#b84868');
  }, 28, 11),
  furn_heart: G((g) => {
    paint(g, or(ell(14, 7, 13, 4), box(2, 6, 26, 10)), I('#f4c430', { hi: hi(9, 5.5, 5, 1, '#fff0a0') }));
    stamp(g, 10, 4, ['.rr.rr.', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], { r: '#e8434f' });
  }, 28, 12),
  furn_box: G((g) => {
    paint(g, box(2, 6, 26, 21), I('#c89a5a', { hi: [box(3, 7, 10, 8), '#e0b878'] }));
    paint(g, poly([[2, 6], [0.5, 1.5], [10, 3.5], [11, 6]]), I('#d8aa68'));
    paint(g, poly([[26, 6], [27.5, 1], [18, 3.5], [17, 6]]), I('#d8aa68'));
    fill(g, box(11, 6, 17, 21), '#b88a4a');
    fill(g, box(4, 12, 9, 13), '#8a6230'); fill(g, box(4, 14, 7, 15), '#8a6230');
  }, 28, 22),
  furn_house: G((g) => {
    paint(g, box(3, 9, 25, 22), I('#e8b0c8', { hi: [box(4, 10, 10, 11), '#fbd0e0'] }));
    paint(g, poly([[0.5, 10], [14, 0.5], [27.5, 10]]), I('#c84a6a', { hi: [poly([[5, 8], [14, 2], [12, 6]]), '#e8708a'] }));
    paint(g, and(ell(14, 22, 4.4, 7), box(9, 14, 19, 22)), { fill: '#3a2030', outline: false, shade: null });
    paint(g, ell(21, 13.5, 1.8, 1.8), { fill: '#3a2030', outline: false, shade: null });
  }, 28, 23),
  furn_tree: G((g) => {
    paint(g, box(4, 50, 30, 56), I('#c8b48a', { hi: [box(5, 51, 14, 52), '#e0d0a8'] }));
    paint(g, box(13, 10, 19, 50), I('#d8c08a'));
    for (let y = 12; y < 50; y += 3) for (let x = 13; x < 19; x++) dot(g, x, y, '#b89c64');
    paint(g, box(20, 30, 25, 50), I('#d8c08a'));
    for (let y = 32; y < 50; y += 3) for (let x = 20; x < 25; x++) dot(g, x, y, '#b89c64');
    paint(g, or(box(1, 27, 31, 31), ell(16, 27, 15, 1.6)), I('#7a8ad0', { hi: [box(3, 27, 12, 28), '#a8b4ec'] }));
    paint(g, or(box(4, 7, 28, 11), ell(16, 7, 12, 1.6)), I('#7a8ad0', { hi: [box(6, 7, 14, 8), '#a8b4ec'] }));
    paint(g, tube([27, 11], [28, 15], [28, 19], 0.5), I('#e8e0d0', { shade: null }));
    paint(g, ell(28, 21, 2.4, 2.4), I('#f05a7a', { hi: hi(27.3, 20.3, 0.8, 0.8, '#ff9ab0') }));
  }, 32, 56),
  furn_shelf: G((g) => {
    paint(g, box(0, 1, 44, 6), I('#a8743e', { hi: [box(1, 2, 20, 3), '#c89058'] }));
    paint(g, poly([[5, 6], [9, 6], [5, 12]]), I('#7a7a86'));
    paint(g, poly([[35, 6], [39, 6], [39, 12]]), I('#7a7a86'));
  }, 44, 13),
  furn_plant: G((g) => {
    paint(g, poly([[3, 19], [15, 19], [13.5, 29], [4.5, 29]]), I('#c8643c', { hi: [box(5, 20, 7, 26), '#e88a5a'] }));
    paint(g, box(2, 17, 16, 20), I('#d8744a'));
    paint(g, or(ell(9, 9, 3, 8, 0), ell(4.5, 12, 2.4, 6, -30), ell(13.5, 12, 2.4, 6, 30), ell(9, 3.5, 2.2, 3.4)), I('#3a9a4a', { hi: hi(8, 7, 0.8, 3, '#6cc86a') }));
  }, 18, 30),
  furn_lamp: G((g) => {
    paint(g, poly([[3, 1], [13, 1], [16, 11], [0, 11]]), I('#f4d478', { hi: [box(4, 2, 7, 9), '#fff0b0'] }));
    paint(g, box(7, 11, 9, 46), I('#5a5a66', { shade: null }));
    paint(g, ell(8, 46, 6, 1.6), I('#5a5a66'));
  }, 16, 48),
  furn_rug: G((g) => {
    paint(g, ell(32, 3, 31, 2.6), I('#4a6ab0', { hi: hi(20, 2, 8, 0.6, '#7a96d8') }));
    for (let x = 6; x < 60; x += 4) dot(g, x, 3, '#e8c060');
  }, 64, 6),
  furn_frame: G((g) => frame(g, 32, 24, '#b8863e', (gg) => {
    fill(gg, box(4, 4, 28, 20), '#9ad8ff');
    fill(gg, poly([[4, 20], [12, 10], [18, 16], [22, 12], [28, 20]]), '#4aa04a');
    fill(gg, ell(23, 8, 2.5, 2.5), '#ffe060');
  }), 32, 24),
  furn_star: G((g) => frame(g, 32, 24, '#8a5aa8', (gg) => {
    fill(gg, box(4, 4, 28, 20), '#2a2a5a');
    for (const [x, y] of [[7, 7], [24, 6], [9, 16], [26, 17], [20, 15]]) dot(gg, x, y, '#ffffff');
    fill(gg, poly([[16, 5], [18, 10], [23, 10], [19, 13], [20.5, 18], [16, 15], [11.5, 18], [13, 13], [9, 10], [14, 10]]), '#ffd23c');
  }), 32, 24),
  furn_badge: G((g) => {
    paint(g, poly([[6, 12], [3, 23], [7, 20], [9, 24], [11, 13]]), I('#3a6ad8'));
    paint(g, poly([[14, 12], [17, 23], [13, 20], [11, 24], [9, 13]]), I('#d84a4a'));
    paint(g, ell(10, 8, 7, 7), I('#f4c430', { hi: hi(8, 6, 2, 2, '#fff0a0') }));
    fill(g, ell(10, 8, 3.5, 3.5), '#e0a820');
    stamp(g, 9, 6, ['.7', '7.', '7.'], { 7: '#a06a00' });
  }, 20, 25),
  furn_cert: G((g) => {
    paint(g, box(1, 1, 29, 21), I('#f8f0d8', { shade: '#e0d4b0' }));
    for (const y of [6, 9, 12]) for (let x = 6; x < 24; x++) if (x % 5) dot(g, x, y, '#8a7a5a');
    fill(g, box(6, 3, 24, 4), '#3a5aa8');
    paint(g, ell(22, 16, 3.4, 3.4), I('#e8434f', { shade: null }));
    paint(g, poly([[20, 18], [19, 22], [21, 21], [22, 22.5]]), I('#e8434f', { shade: null }));
  }, 30, 23),
  furn_bowl_food: G((g) => bowl(g, '#d84a4a', '#f08080', null), 24, 13),
  furn_bowl_water: G((g) => bowl(g, '#4a86e0', '#8ab8f8', null), 24, 13),
  furn_chest: G((g) => chest(g, false), 24, 20),
  toy_wheel: G((g) => wheel(g, 18, 18, 16, 0), 36, 40),
  toy_tunnel: G((g) => {
    paint(g, and(ell(22, 26, 21, 24), (x, y) => y < 25.5), I('#4a9ad8', { shade: '#2e6ea8', hi: hi(12, 8, 4, 2, '#8ac8f0') }));
    for (const x of [9, 16, 22, 28, 35]) for (let y = 2; y < 26; y++) if (g.px[y * 44 + x] === '#4a9ad8') dot(g, x, y, '#2e6ea8');
    paint(g, and(ell(5, 18, 3.6, 8), (x, y) => y < 25.5), { fill: '#1a2e40', outline: false, shade: null });
    paint(g, and(ell(39, 18, 3.6, 8), (x, y) => y < 25.5), { fill: '#1a2e40', outline: false, shade: null });
  }, 44, 26),
};
// Zusätzliche Stellungen: volle Näpfe, offene Kiste, zweites Bild des Laufrads, Strickleiter am Tor
const EXTRA = {
  bowl_food_half: G((g) => bowl(g, '#d84a4a', '#f08080', kibble(4)), 24, 13),
  bowl_food_full: G((g) => bowl(g, '#d84a4a', '#f08080', kibble(9)), 24, 13),
  bowl_water_half: G((g) => { bowl(g, '#4a86e0', '#8ab8f8', null); fill(g, ell(12, 7, 8, 0.8), '#8ad0ff'); }, 24, 13),
  bowl_water_full: G((g) => { bowl(g, '#4a86e0', '#8ab8f8', null); fill(g, ell(12, 6, 9, 1.2), '#8ad0ff'); dot(g, 9, 6, '#ffffff'); }, 24, 13),
  furn_chest_open: G((g) => chest(g, true), 24, 20),
  toy_wheel_1: G((g) => wheel(g, 18, 18, 16, 1), 36, 40),
  ladder: G((g) => {
    for (const x of [1, 12]) paint(g, box(x, 0, x + 1.5, 8), I('#b08050', { shade: null }));
    paint(g, box(1, 4, 14, 6), I('#d8a868'));
  }, 15, 8),
};

// Eigenschaften der Teile. tops: Bildpunkte von oben, auf denen ein Tier auf dem Desktop stehen kann
export const FURN = {
  care_bed: { sleep: true, seat: 11 },
  furn_bed2: { sleep: true, seat: 11 },
  furn_cushion: { sleep: true, seat: 5 },
  furn_heart: { sleep: true, seat: 5 },
  furn_box: { sleep: ['cat', 'hamster', 'rat', 'rabbit', 'fox'], hide: true, tops: [1] },
  furn_house: { sleep: SMALL, hide: true, tops: [2] },
  furn_tree: { climb: ['cat', 'fox', 'rat'], tops: [7, 27] },
  furn_shelf: { wall: true, tops: [1] },
  furn_plant: {},
  furn_lamp: {},
  furn_rug: { flat: true },
  furn_frame: { wall: true },
  furn_star: { wall: true },
  furn_badge: { wall: true },
  furn_cert: { wall: true },
  furn_bowl_food: { bowl: 'food' },
  furn_bowl_water: { bowl: 'water' },
  furn_chest: { chest: true, room: true },   // bleibt im Zimmer
  toy_wheel: { station: ['hamster', 'rat'] },
  toy_tunnel: { station: ['rabbit', 'rat', 'hamster'], hide: true },
  // Wurfspielzeug liegt nur auf dem Desktop herum (im Zimmer holt man es aus der Kiste)
  toy_ball: { toy: true, desk: true }, toy_yarn: { toy: true, desk: true }, toy_duck: { toy: true, desk: true },
  toy_frisbee: { toy: true, desk: true }, toy_plush: { toy: true, desk: true }, toy_puzzle: { toy: true, desk: true },
};
for (const [id, f] of Object.entries(FURN)) {
  const g = SPRITES[id] ? SPRITES[id]() : { w: 16, h: 16 };
  f.w = g.w; f.h = g.h;
}

export const placeable = (id) => !!FURN[id];
// Wo das Teil stehen darf
export const canPlace = (id, at) => !!FURN[id] && ((at === 'desk' && !FURN[id].room) || (at === 'room' && !FURN[id].desk));
// Darf diese Art hier schlafen?
export const sleepsIn = (id, species) => { const s = FURN[id] && FURN[id].sleep; return s === true || (Array.isArray(s) && s.includes(species)); };

const cache = new Map();
export function furnGrid(id) {
  if (!cache.has(id)) cache.set(id, (SPRITES[id] || EXTRA[id] || SPRITES.furn_box)());
  return cache.get(id);
}
export const hasFurn = (id) => !!(SPRITES[id] || EXTRA[id]) && !(FURN[id] && FURN[id].toy);

const svgCache = new Map();
export function furnSvg(id, cls = 'pxi') {
  const key = id + '|' + cls;
  if (!svgCache.has(key)) svgCache.set(key, gridSvg(furnGrid(id), { cls }));
  return svgCache.get(key);
}

// Bild eines Napfes je nach Füllstand (0 bis 1)
export function bowlSprite(kind, level) {
  if (!(level > 0)) return kind === 'food' ? 'furn_bowl_food' : 'furn_bowl_water';
  return `bowl_${kind}_${level > 0.5 ? 'full' : 'half'}`;
}
