// Pixel-Bilder (16 × 16) für alle Gegenstände, Werte und Dinge auf den Ausflügen, dazu ein paar größere für die Szene
// (Spielzeugkiste, Körbchen, Laufrad, Tunnel, Kletterseil, Gedankenblase). Ohne DOM, damit es auch unter Node läuft.
//
//   iconGrid(id)          Raster (zwischengespeichert)
//   iconSvg(id, cls)      fertiges <svg>
//   ICON_OF               Symbol für Werte, Aktionen und Ausflugsdinge, die keinen eigenen Gegenstand haben
import { grid, paint, fill, ell, poly, box, tube, and, or, not, inside, dot, stamp, darker, lighter, lineOf, gridSvg, accGrid } from './pixel.js';
import { hasFurn, furnGrid } from './furniture.js';

const I = (c, extra = {}) => ({ fill: c, line: lineOf(c), ...extra });
const hi = (cx, cy, rx, ry, c) => [ell(cx, cy, rx, ry), c];
const G = (fn, w = 16, h = 16) => () => { const g = grid(w, h); fn(g); return g; };

// Fisch nach links schauend, Farben wählbar
function fish(g, body, fin, belly, stripe) {
  paint(g, poly([[10.5, 8.5], [15.2, 4.6], [14.2, 8.5], [15.2, 12.4]]), I(fin));
  paint(g, poly([[5.5, 5.2], [8.5, 3.2], [9.5, 5.6]]), I(fin));
  const b = paint(g, ell(7, 8.5, 6, 3.8), I(body, { hi: hi(5, 7, 3, 1.2, lighter(body, 2)) }));
  fill(g, and(ell(7, 10.6, 5.2, 1.8), inside(b, 16)), belly);
  if (stripe) for (let y = 5; y < 13; y++) if (b[y * 16 + 8]) { dot(g, 8, y, stripe); dot(g, 9, y, stripe); }
  dot(g, 3, 7, '#ffffff'); dot(g, 3, 8, '#1d2440');
}
function bowl(g, color, top) {
  if (top) top(g);
  paint(g, or(and(ell(8, 9.5, 7, 4.8), (x, y) => y > 9), ell(8, 9.5, 7, 1.4)), I(color, { hi: hi(4.5, 11, 1.6, 1.4, lighter(color, 3)) }));
  for (let x = 2; x <= 13; x++) dot(g, x, 9, lighter(color, 2.5));
}
function cup(g, c, x0 = 0) {
  paint(g, or(ell(2.8 + x0, 5.2, 2, 2.2), ell(13.2 + x0, 5.2, 2, 2.2)), I(c, { shade: darker(c) }));
  paint(g, poly([[6 + x0, 13], [10 + x0, 13], [9 + x0, 10], [7 + x0, 10]]), I(c));
  paint(g, and(ell(8 + x0, 3, 5.4, 7), (x, y) => y > 2), I(c, { hi: hi(5.6 + x0, 5, 1, 1.8, lighter(c, 3)) }));
  paint(g, box(4 + x0, 13, 12 + x0, 15), I('#a0643a'));
}
function tree(g, crown, trunk = '#8a5a32') {
  paint(g, box(7, 10, 9, 15), I(trunk));
  paint(g, or(ell(8, 6.5, 5.6, 4.6), ell(5, 8.5, 3.4, 3), ell(11, 8.5, 3.4, 3)), I(crown, { hi: hi(6, 4.5, 2, 1.2, lighter(crown, 2)) }));
}

const ICONS = {
  // ---------- Futter ----------
  food_dry: G((g) => bowl(g, '#4a86e0', (gg) => {
    paint(gg, and(ell(8, 8.6, 5.6, 3.6), (x, y) => y < 9.5), I('#c98a4b', { shade: '#a5683a' }));
    [[5, 7], [7, 6], [9, 7], [11, 7], [6, 8], [8, 8], [10, 6]].forEach(([x, y]) => dot(gg, x, y, '#e8b070'));
    [[6, 6], [8, 7], [10, 8], [12, 8]].forEach(([x, y]) => dot(gg, x, y, '#8a5530'));
  })),
  food_wet: G((g) => {
    paint(g, or(box(3, 5, 13, 14), ell(8, 14, 5, 1.5)), I('#b8c0cc', { hi: [box(4, 6, 5, 13), '#e6eaf0'] }));
    fill(g, box(3, 8, 13, 12), '#f08a2c');
    fill(g, box(3, 8, 13, 9), '#ffb466');
    stamp(g, 6, 9, ['.ff.f', 'fffff', '.ff.f'], { f: '#ffffff' });
    paint(g, ell(8, 5, 5, 1.6), I('#d8dee6', { shade: null }));
    dot(g, 6, 5, '#ffffff'); dot(g, 7, 5, '#ffffff');
  }),
  food_hay: G((g) => {
    for (const [x, d] of [[4.5, -18], [6.5, -8], [8.5, 0], [10.5, 8], [12, 18]]) paint(g, ell(x, 8.5, 1.4, 6.2, d), I('#e8c860', { shade: '#c8a440', rim: 1 }));
    paint(g, box(3, 8, 14, 10), I('#b06a30'));
    [[5, 4], [9, 3], [11, 5], [6, 13], [10, 13]].forEach(([x, y]) => dot(g, x, y, '#fff09a'));
  }),
  food_carrot: G((g) => {
    paint(g, ell(10, 3.6, 1.4, 3.2, 30), I('#5cb84a'));
    paint(g, ell(12.3, 4.6, 1.3, 3, 62), I('#4aa03e'));
    paint(g, poly([[3, 14.5], [8.6, 4.6], [12, 8]]), I('#f08a2c', { hi: hi(8, 7, 1.2, 1.4, '#ffb466') }));
    [[6, 10], [8, 8], [5, 12]].forEach(([x, y]) => dot(g, x, y, '#c4641c'));
  }),
  food_seeds: G((g) => {
    for (const [x, y, d] of [[5, 9, -30], [10.5, 6.5, 20], [10, 12, 70]]) {
      const m = paint(g, ell(x, y, 2.2, 3.8, d), I('#4a4452', { hi: hi(x - 0.6, y - 1, 0.6, 1.2, '#6a6476') }));
      for (let k = -3; k <= 3; k++) {
        const a = (d * Math.PI) / 180, px = Math.round(x - 0.5 - Math.sin(a) * k), py = Math.round(y - 0.5 + Math.cos(a) * k);
        if (m[py * 16 + px]) dot(g, px, py, '#e8e0d0');
      }
    }
  }),
  food_cheese: G((g) => {
    paint(g, poly([[2, 12.5], [2, 8], [12, 3.5], [14.5, 6], [14.5, 12.5]]), I('#ffd23c', { shade: '#e8a820', hi: hi(5, 9, 2, 0.8, '#fff09a') }));
    paint(g, poly([[2, 8], [12, 3.5], [14.5, 6], [2.5, 8.5]]), I('#ffe680', { shade: null }));
    [[5, 11], [9, 9], [12, 11], [10, 12], [7, 9]].forEach(([x, y], i) => { dot(g, x, y, '#d89a20'); if (i < 3) dot(g, x + 1, y, '#c08418'); });
  }),
  food_tuna: G((g) => fish(g, '#6a86a8', '#4a6488', '#d8e4f0', null)),
  food_fish: G((g) => fish(g, '#f08a2c', '#d0661c', '#ffd0a0', '#ffffff')),
  food_bone: G((g) => {
    paint(g, or(ell(3.6, 6, 2.4, 2.4), ell(3.6, 10, 2.4, 2.4), ell(12.4, 6, 2.4, 2.4), ell(12.4, 10, 2.4, 2.4), box(3.5, 6.4, 12.5, 9.6)), I('#f3ead2', { shade: '#d6c7a2', hi: hi(3, 5, 1, 1, '#ffffff') }));
  }),
  food_apple: G((g) => {
    paint(g, tube([8, 4], [8.5, 2.5], [9.5, 1.5], 0.6), I('#8a5a32', { shade: null }));
    paint(g, ell(11, 3, 2.2, 1.2, -25), I('#5cb84a'));
    const a = paint(g, or(ell(5.8, 9, 4.6, 5), ell(10.2, 9, 4.6, 5)), I('#e8434f', { shade: '#c22c3c', hi: hi(5, 7, 1.4, 1.6, '#ff8f98') }));
    // Angeschnitten: helle Schnittfläche rechts
    fill(g, and(inside(a, 16), poly([[9, 6], [15, 6], [15, 14], [9, 14]])), '#fff4d8', '#f0e0b0');
    dot(g, 11, 9, '#6a3a20'); dot(g, 11, 11, '#6a3a20');
  }),
  food_treat: G((g) => {
    paint(g, ell(8, 8.5, 6.6, 6.2), I('#d9a050', { shade: '#b87e3a', hi: hi(5, 5.5, 2.4, 1.2, '#efc27a') }));
    [[5, 7], [9, 5], [10, 9], [6, 11], [11, 12], [8, 8]].forEach(([x, y]) => { dot(g, x, y, '#5a3220'); dot(g, x + 1, y, '#7a4a2c'); });
  }),
  food_milk: G((g) => {
    paint(g, or(box(4.5, 5, 11.5, 15), poly([[4.5, 5.5], [6, 2.5], [10, 2.5], [11.5, 5.5]])), I('#f4f4f8', { line: '#5a6a8a', shade: '#d6dae6', hi: [box(5.5, 6, 6.5, 14), '#ffffff'] }));
    paint(g, box(6, 0.5, 10, 2.5), I('#3a62d8'));
    fill(g, box(4.5, 8, 11.5, 12), '#7fb0f8');
    stamp(g, 6, 9, ['.ww.', 'wwww'], { w: '#ffffff' });
  }),
  food_fireberry: G((g) => {
    paint(g, tube([8, 5], [9, 3], [11, 2], 0.6), I('#4f9e48', { shade: null }));
    for (const [x, y] of [[5, 9], [11, 9], [8, 12]]) paint(g, ell(x, y, 3, 3), I('#d8343c', { shade: '#a8202c', hi: hi(x - 1, y - 1, 0.8, 0.8, '#ff9a6a') }));
    stamp(g, 6, 0, ['..f.', '.fof', '.fo.'], { f: '#ff7a1a', o: '#ffd23c' });
  }),
  food_cake: G((g) => {
    const s = paint(g, poly([[1.5, 14.5], [1.5, 8], [14.5, 4], [14.5, 14.5]]), I('#ffffff', { line: '#7a4a3a', shade: null }));
    [['#ff5a6a', 8], ['#ffd23c', 10], ['#5cc85c', 12], ['#4a90e0', 14]].forEach(([c, y]) => fill(g, and(inside(s, 16), (x, yy) => yy > y - 2 && yy <= y), c));
    fill(g, and(inside(s, 16), poly([[1.5, 9], [1.5, 8], [14.5, 4], [14.5, 5.5]])), '#fff4f8');
    paint(g, ell(11, 3, 1.8, 1.8), I('#e8334a', { hi: hi(10.5, 2.5, 0.5, 0.5, '#ff9aa8') }));
  }),

  // ---------- Spielzeug ----------
  toy_ball: G((g) => {
    const b = paint(g, ell(8, 8.5, 6.6, 6.6), I('#e8434f', { shade: '#c22c3c' }));
    paint(g, and((x, y) => Math.abs(y - 8.5 - (x - 8) * 0.55) < 1.5, inside(b, 16)), { fill: '#fff4e0', outline: false, shade: '#e8d6b6' });
    fill(g, and(ell(5.5, 5.5, 1.6, 1.1), inside(b, 16)), '#ff8f98');
    dot(g, 5, 5, '#ffffff');
  }),
  toy_yarn: G((g) => {
    const b = paint(g, ell(7.6, 8.2, 6.2, 6.2), I('#f06aa0', { shade: '#cc4a82', hi: hi(5, 5.5, 2, 1.2, '#ff9cc4') }));
    [6.5, 9.2, 12].forEach((r) => fill(g, and((x, y) => Math.abs(Math.hypot(x - 1.5, y - 15) - r) < 0.55, inside(b, 16)), '#b33c72'));
    [[13, 12], [14, 13], [14, 14], [13, 15], [12, 15]].forEach(([x, y]) => dot(g, x, y, '#cc4a82'));
  }),
  toy_duck: G((g) => {
    paint(g, ell(8.6, 10.6, 6, 3.8), I('#ffd23c', { shade: '#e8a820' }));
    paint(g, poly([[11.5, 8], [15, 7.2], [13.6, 10]]), I('#ffd23c', { shade: '#e8a820' }));
    paint(g, ell(5.6, 5.6, 3.4, 3.2), I('#ffd23c', { shade: '#e8a820', hi: hi(4.6, 4.4, 1.2, 0.8, '#fff09a') }));
    paint(g, ell(2, 6.6, 1.8, 1), I('#f08a2c'));
    dot(g, 5, 5, '#1d2440');
    for (let x = 7; x <= 11; x++) dot(g, x, 10, '#e8a820');
  }),
  toy_feather: G((g) => {
    paint(g, tube([1.5, 15], [5, 12], [8, 9], 0.7), I('#b08850', { shade: null }));
    paint(g, ell(10.5, 5.5, 2.6, 5.4, 40), I('#4ac0c8', { shade: '#2a98a8', hi: hi(9.5, 4, 0.8, 2, '#a8f0f0') }));
    for (let k = 0; k < 6; k++) dot(g, 8 + k, 8 - k, '#1e6a78');
    paint(g, ell(13.5, 2.5, 1.4, 1.4), I('#ff6fae'));
  }),
  toy_wheel: G((g) => wheel(g, 8, 7, 6, 0, true)),
  toy_rope: G((g) => {
    paint(g, tube([8, 0], [5, 8], [8, 15.5], 1.4), I('#c89a60', { shade: '#a07840' }));
    for (const y of [4, 9, 13]) paint(g, ell(6.6 + (y === 9 ? -0.8 : 0), y, 2.4, 1.6), I('#b08050'));
  }),
  toy_stick: G((g) => {
    paint(g, tube([2, 13], [8, 8], [14, 3], 2), I('#b07a48', { shade: '#8a5a32', hi: hi(6, 9, 1, 0.6, '#d8a070') }));
    paint(g, ell(13.6, 3.4, 1.8, 1.8), I('#e8c8a0', { shade: null }));
    dot(g, 13, 3, '#b07a48');
    [[5, 10], [9, 7]].forEach(([x, y]) => { dot(g, x, y, '#6a4020'); dot(g, x + 1, y - 1, '#6a4020'); });
  }),
  toy_tunnel: G((g) => {
    paint(g, and(ell(8, 13, 7.4, 10), (x, y) => y < 14.5), I('#4a9ad8', { shade: '#2e6ea8', hi: hi(5, 5, 1.6, 1.2, '#8ac8f0') }));
    for (const x of [4, 8, 12]) for (let y = 3; y < 15; y++) if (g.px[y * 16 + x] === '#4a9ad8') dot(g, x, y, '#2e6ea8');
    paint(g, and(ell(8, 14.5, 3.6, 6), (x, y) => y < 14.5), I('#1a2e40', { shade: null, outline: false }));
  }),
  toy_frisbee: G((g) => {
    paint(g, ell(8, 9, 7, 3.6), I('#ff8a2a', { shade: '#d0661c' }));
    paint(g, ell(8, 8.2, 4.6, 2), I('#ffb466', { shade: null }));
    fill(g, ell(8, 8.2, 2.4, 0.9), '#ff8a2a');
  }),
  toy_laser: G((g) => {
    paint(g, tube([2, 13], [5, 10], [8, 7], 1.4), I('#6a7080', { hi: hi(4, 11, 0.6, 0.6, '#a8b0c0') }));
    paint(g, ell(8.4, 6.6, 1.4, 1.4), I('#3a3a48', { shade: null }));
    for (let k = 1; k < 5; k++) dot(g, 8 + k, 6 - k, k % 2 ? '#ff5050' : '#ff9090');
    paint(g, ell(13.6, 1.8, 1.4, 1.4), { fill: '#ff2020', line: '#ff9090', shade: null });
  }),
  toy_bubbles: G((g) => {
    paint(g, tube([2, 15], [3, 12], [5, 9], 0.6), I('#e8434f', { shade: null }));
    paint(g, and(ell(6, 7, 2.4, 2.4), not(ell(6, 7, 1.2, 1.2))), I('#e8434f', { shade: null }));
    for (const [x, y, r] of [[11, 5, 3.4], [12.5, 11.5, 2.2], [6.5, 2.5, 1.6]]) {
      paint(g, ell(x, y, r, r), { fill: '#d8f2ff', line: '#6ab8e8', shade: '#c0e4fa' });
      dot(g, Math.floor(x - r / 2), Math.floor(y - r / 2), '#ffffff');
    }
  }),
  toy_plush: G((g) => {
    for (const x of [3.5, 12.5]) paint(g, ell(x, 3.5, 2.2, 2.2), I('#b07840'));
    paint(g, ell(8, 12, 5, 4), I('#b07840'));
    paint(g, ell(8, 6.5, 5.4, 4.6), I('#c88a50', { hi: hi(6, 4.5, 1.6, 1, '#e0a870') }));
    paint(g, ell(8, 8.4, 2.4, 1.6), I('#f0d8b0', { shade: null }));
    dot(g, 6, 6, '#2b2233'); dot(g, 10, 6, '#2b2233'); dot(g, 7, 8, '#4a2a20'); dot(g, 8, 8, '#4a2a20');
    fill(g, ell(8, 12.5, 2.4, 2), '#f0d8b0');
  }),
  toy_puzzle: G((g) => {
    const b = paint(g, ell(8, 8.5, 6.6, 6.6), I('#4a90e0'));
    fill(g, and(inside(b, 16), (x, y) => x > 8 && y < 8.5), '#5cc85c', '#4aa03e');
    fill(g, and(inside(b, 16), (x, y) => x <= 8 && y >= 8.5), '#ffd23c', '#e8a820');
    fill(g, and(inside(b, 16), (x, y) => x > 8 && y >= 8.5), '#e8434f', '#c22c3c');
    for (const [x, y] of [[5, 5], [11, 12]]) { dot(g, x, y, '#2a2a3a'); dot(g, x + 1, y, '#2a2a3a'); }
    dot(g, 4, 4, '#ffffff');
  }),

  // ---------- Pflege ----------
  care_brush: G((g) => {
    paint(g, tube([2, 14], [5, 11], [8, 8], 1.2), I('#b07a48'));
    paint(g, ell(11, 5, 4.4, 2.6, -45), I('#d84a6a', { hi: hi(10, 4, 1.2, 0.6, '#ff8aa0') }));
    for (const [x, y] of [[9, 2], [11, 2], [13, 4], [14, 6], [12, 1]]) { dot(g, x, y, '#5a4a40'); }
  }),
  care_soap: G((g) => {
    paint(g, poly([[2, 9], [9, 6], [14, 8.5], [14, 11], [7, 14], [2, 11.5]]), I('#9ad8f0', { shade: '#6ab0d0' }));
    fill(g, poly([[2.5, 9.2], [9, 6.6], [13.5, 8.6], [7, 11.2]]), '#c6ecfa');
    paint(g, ell(11.5, 3.5, 2.2, 2.2), { fill: '#e8f6ff', line: '#6aa8c8', shade: null });
    paint(g, ell(5.5, 3, 1.4, 1.4), { fill: '#e8f6ff', line: '#6aa8c8', shade: null });
    dot(g, 11, 2, '#ffffff');
  }),
  care_leash: G((g) => {
    paint(g, and(ell(5, 5, 4, 4), not(ell(5, 5, 2, 2))), I('#d8343c', { shade: '#a8202c' }));
    paint(g, tube([8, 8], [10, 12], [13, 11], 0.9), I('#d8343c', { shade: null }));
    paint(g, ell(13.5, 12.5, 1.8, 2.2), I('#c0c8d4', { hi: hi(13, 12, 0.5, 0.5, '#ffffff') }));
  }),
  care_runball: G((g) => {
    paint(g, ell(8, 8.5, 6.6, 6.6), { fill: '#bfe6ff', line: '#3a7ab8', shade: '#9acef0', hi: hi(5, 5.5, 2, 1.2, '#ffffff') });
    for (const [x, y] of [[8, 4], [12, 8], [8, 13], [4, 9], [10, 6], [6, 11]]) dot(g, x, y, '#3a7ab8');
    fill(g, box(7, 1, 9, 2.5), '#3a7ab8');
  }),
  care_harness: G((g) => {
    // Laufshirt mit Schärpe, wie das Symbol im Shop
    const shirt = paint(g, poly([[3, 15], [3, 6], [5.5, 1], [6.5, 1], [8, 4], [9.5, 1], [10.5, 1], [13, 6], [13, 15]]), I('#3aa8d8', { hi: [box(4, 7, 5, 14), '#7ad0f0'] }));
    fill(g, and(inside(shirt, 16), (x, y) => Math.abs(y - (17 - x)) < 1.2), '#ffd23c');
    fill(g, and(inside(shirt, 16), (x, y) => y > 13.5), '#2a88b8');
  }),
  care_travelglass: G((g) => {
    paint(g, box(3, 4, 13, 15), { fill: '#dff4ff', line: '#5a8ab0', shade: '#c4e4f8' });
    fill(g, box(3, 8, 13, 15), '#6ab8f0', '#4a98d8');
    paint(g, box(2.5, 2, 13.5, 4), I('#d8343c'));
    dot(g, 5, 9, '#ffffff'); dot(g, 9, 11, '#ffffff'); dot(g, 4, 5, '#ffffff'); dot(g, 4, 6, '#ffffff');
  }),
  care_bed: G((g) => {
    paint(g, ell(8, 10, 7.4, 4.4), I('#b8763a', { hi: hi(4, 8, 2, 0.8, '#d8965a') }));
    paint(g, ell(8, 9, 5, 2.4), I('#f4c6d8', { shade: '#e0a8c0' }));
  }),
  extra_slot: G((g) => {
    paint(g, box(3, 8, 13, 15), I('#f4d6a0'));
    paint(g, poly([[0.5, 8.5], [8, 1.5], [15.5, 8.5]]), I('#d0483c'));
    paint(g, box(7, 11, 10, 15), I('#8a5a32'));
    stamp(g, 4, 10, ['bb', 'bb'], { b: '#7fb8e0' });
    stamp(g, 11, 2, ['.h.', 'hhh', '.h.'], { h: '#ff4f78' });
  }),

  // ---------- Räume ----------
  room_living: G((g) => {
    paint(g, box(1, 6, 15, 12), I('#c05050', { hi: [box(3, 7, 13, 8), '#e07070'] }));
    paint(g, box(0, 8, 3, 13), I('#a83c3c'));
    paint(g, box(13, 8, 16, 13), I('#a83c3c'));
    paint(g, box(2, 10, 14, 13), I('#d86060'));
    dot(g, 2, 14, '#5a3020'); dot(g, 13, 14, '#5a3020');
  }),
  room_garden: G((g) => tree(g, '#5cb84a')),
  room_kids: G((g) => {
    paint(g, box(1, 8, 7.5, 14.5), I('#e05050'));
    paint(g, box(8.5, 8, 15, 14.5), I('#4080e0'));
    paint(g, box(4.5, 1.5, 11, 8), I('#40b060'));
    stamp(g, 3, 10, ['a'], { a: '#ffffff' }); stamp(g, 11, 10, ['b'], { b: '#ffffff' });
  }),
  room_beach: G((g) => {
    paint(g, box(7.5, 6, 8.5, 15), I('#8a6a40', { shade: null }));
    paint(g, and(ell(8, 7, 7.4, 5.6), (x, y) => y < 7), I('#ff6060', { shade: '#d84040' }));
    for (let x = 1; x < 16; x++) for (let y = 1; y < 7; y++) if (g.px[y * 16 + x] === '#ff6060' && Math.floor(x / 2.5) % 2) dot(g, x, y, '#ffffff');
    fill(g, box(0, 14, 16, 16), '#f3dca0');
  }),
  room_retro: G((g) => {
    paint(g, box(2, 1.5, 14, 11), I('#d8d0b8'));
    paint(g, box(3.5, 3, 12.5, 9.5), { fill: '#000080', line: '#3a3a3a', shade: null });
    stamp(g, 4, 4, ['ww.www', 'w', '', 'ww'], { w: '#c0c0c0' });
    paint(g, box(1, 12, 15, 15), I('#d8d0b8'));
    dot(g, 12, 13, '#40b040');
  }),
  room_cave: G((g) => {
    paint(g, poly([[0.5, 15], [5.5, 4], [10.5, 4], [15.5, 15]]), I('#6a5a5a', { hi: hi(5, 8, 1, 2, '#8a7a7a') }));
    fill(g, poly([[5.5, 4], [10.5, 4], [9.5, 6.5], [6.5, 6.5]]), '#ff7a1a');
    stamp(g, 5, 0, ['..o..o', '.o.oo.', 'oo..o.'], { o: '#ffb23c' });
    fill(g, poly([[7, 6.5], [9, 6.5], [10, 11], [6.5, 11]]), '#ff9a3a');
  }),

  // ---------- Werte, Anzeigen ----------
  heart: G((g) => {
    paint(g, or(ell(5.4, 6.4, 3.6, 3.4), ell(10.6, 6.4, 3.6, 3.4), poly([[2, 7.4], [14, 7.4], [8, 14]])), I('#ff4f78', { shade: '#d83462', hi: hi(4.4, 5, 1.2, 0.9, '#ffb0c4') }));
  }),
  drop: G((g) => {
    paint(g, or(ell(8, 10, 4.6, 4.4), poly([[3.8, 9.4], [8, 1.5], [12.2, 9.4]])), I('#4fb0f0', { shade: '#2a8ad0', hi: hi(6.2, 9, 1, 1.8, '#bfe6ff') }));
  }),
  zzz: G((g) => {
    stamp(g, 6, 1, ['llllll', '...ll.', '..ll..', '.ll...', 'llllll'], { l: '#5a5ab0' });
    stamp(g, 1, 8, ['llll', '..l.', '.l..', 'llll'], { l: '#7a7ad0' });
    stamp(g, 10, 10, ['lll', '.l.', 'lll'], { l: '#9a9ae0' });
  }),
  star: G((g) => {
    const pts = [];
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 3.1 : 7.2; pts.push([8 + Math.cos(a) * r, 8.6 + Math.sin(a) * r]); }
    paint(g, poly(pts), I('#ffd23c', { shade: '#e8a020', hi: hi(6, 6.5, 1.2, 1, '#fff4a8') }));
  }),
  coin: G((g) => {
    paint(g, ell(8, 8.5, 6, 6), I('#ffc83a', { shade: '#e0961e', hi: hi(5.5, 6, 1.4, 1, '#fff2a8') }));
    fill(g, ell(8, 8.5, 3.4, 3.4), '#f0aa28');
    [[8, 7], [8, 8], [8, 9], [7, 7], [7, 10], [8, 10], [9, 10]].forEach(([x, y]) => dot(g, x, y, '#fff2a8'));
  }),
  cup1: G((g) => cup(g, '#ffcc33')),
  cup2: G((g) => cup(g, '#c8d0dc')),
  cup3: G((g) => cup(g, '#d8925a')),
  lock: G((g) => {
    paint(g, and(ell(8, 6, 4, 4.6), not(ell(8, 6, 2, 2.8)), (x, y) => y < 7.5), I('#a8b0c0', { shade: null }));
    paint(g, box(3, 7, 13, 15), I('#ffc83a', { shade: '#e0961e' }));
    stamp(g, 7, 9, ['kk', 'kk', '.k'], { k: '#6a4a10' });
  }),
  note: G((g) => {
    paint(g, or(ell(4.6, 12, 2.6, 2), ell(11.6, 10.5, 2.6, 2), box(6.2, 3, 7.4, 12), box(13.2, 1.5, 14.4, 10.5), poly([[6.2, 3], [14.4, 1], [14.4, 3.5], [6.2, 5.5]])), I('#5a4ab0', { shade: null }));
  }),
  sparkle: G((g) => {
    stamp(g, 1, 2, ['....o....', '....o....', '...oyo...', '...oWo...', 'ooyyWyyoo', '...oWo...', '...oyo...', '....o....', '....o....'], { o: '#e8a020', y: '#ffd23c', W: '#fffbe0' });
    stamp(g, 10, 9, ['..o..', '.oyo.', 'oyWyo', '.oyo.', '..o..'], { o: '#e8a020', y: '#ffd23c', W: '#fffbe0' });
    stamp(g, 12, 1, ['.o.', 'oWo', '.o.'], { o: '#e8a020', W: '#fffbe0' });
  }),
  bang: G((g) => {
    paint(g, or(poly([[6, 1], [10, 1], [9, 10], [7, 10]]), ell(8, 13, 1.8, 1.8)), I('#e8334a'));
  }),
  gift: G((g) => {
    paint(g, box(2, 7, 14, 15), I('#e8434f'));
    paint(g, box(1, 5, 15, 8), I('#ff6a6a'));
    fill(g, box(7, 5, 9, 15), '#ffd23c');
    stamp(g, 4, 1, ['.yy..yy.', 'y..yy..y', '.yyyyyy.'], { y: '#ffd23c' });
  }),
  house: G((g) => {
    paint(g, box(3, 8, 13, 15), I('#f4d6a0'));
    paint(g, poly([[0.5, 8.5], [8, 1.5], [15.5, 8.5]]), I('#d0483c'));
    paint(g, box(7, 11, 10, 15), I('#8a5a32'));
    stamp(g, 4, 10, ['bb', 'bb'], { b: '#7fb8e0' });
  }),
  paw: G((g) => {
    paint(g, ell(8, 11, 4, 3.4), I('#6a4a3a'));
    for (const [x, y] of [[3.5, 6.5], [6.5, 4], [9.5, 4], [12.5, 6.5]]) paint(g, ell(x, y, 1.7, 2), I('#6a4a3a'));
  }),
  speed: G((g) => {
    paint(g, poly([[9, 1], [3, 9], [8, 9], [6, 15], [13, 6], [8, 6], [11, 1]]), I('#ffd23c', { shade: '#e8a020' }));
  }),
  jump: G((g) => {
    paint(g, poly([[8, 1], [14, 7], [10.5, 7], [10.5, 10], [5.5, 10], [5.5, 7], [2, 7]]), I('#5cc85c', { shade: '#3a9a3a' }));
    for (const y of [12, 14]) for (let x = 5; x < 11; x++) dot(g, x, y, y === 12 ? '#3a9a3a' : '#9ad884');
  }),
  nose: G((g) => {
    paint(g, or(ell(5.6, 7, 3, 2.6), ell(10.4, 7, 3, 2.6), poly([[3, 8], [13, 8], [8, 13]])), I('#3a2a30', { hi: hi(5, 6, 1, 0.6, '#8a7080') }));
    dot(g, 7, 8, '#1a1015'); dot(g, 9, 8, '#1a1015');
    for (const [x, y] of [[2, 2], [8, 1], [14, 2]]) dot(g, x, y, '#a8a0b0');
  }),

  // ---------- Ausflüge: Hindernisse und Orte ----------
  stone: G((g) => {
    paint(g, or(ell(8, 11, 6.6, 4.2), ell(6, 9, 3.6, 3)), I('#9aa0a8', { hi: hi(5, 8, 1.6, 1, '#c8ccd2') }));
  }),
  rock: G((g) => {
    paint(g, poly([[0.5, 15.5], [3, 6], [7, 1.5], [11, 4], [15.5, 15.5]]), I('#8a8a94', { hi: hi(5, 7, 1.4, 2.4, '#b8b8c2') }));
    fill(g, poly([[5.5, 3.5], [7, 1.5], [9.5, 3]]), '#ffffff');
  }),
  bush: G((g) => {
    paint(g, or(ell(8, 10, 7, 5), ell(5, 7, 3.6, 3.4), ell(10.5, 6.5, 4, 3.6)), I('#4f9e48', { hi: hi(5, 5.5, 1.4, 1, '#8ad070') }));
    [[4, 11], [9, 9], [12, 12]].forEach(([x, y]) => dot(g, x, y, '#ff6f8a'));
  }),
  log: G((g) => {
    paint(g, box(2, 7, 14, 14), I('#a0683a', { hi: [box(3, 8, 12, 9), '#c08850'] }));
    paint(g, ell(13.5, 10.5, 2.4, 3.4), I('#e8c89a', { shade: null }));
    dot(g, 13, 10, '#b08860'); dot(g, 13, 11, '#b08860');
    for (const x of [5, 9]) dot(g, x, 11, '#6a4020');
  }),
  mushroom: G((g) => {
    paint(g, box(6, 9, 10, 15), I('#f4ead8'));
    paint(g, and(ell(8, 9.5, 7, 7), (x, y) => y < 9.5), I('#e8343c', { shade: '#b8202c' }));
    [[5, 5], [9, 4], [12, 7], [3, 8], [8, 7]].forEach(([x, y]) => dot(g, x, y, '#ffffff'));
  }),
  castle: G((g) => {
    paint(g, or(box(2, 7, 14, 15), box(1, 4, 5, 8), box(11, 4, 15, 8), box(6, 2, 10, 7)), I('#e8c878', { hi: [box(3, 8, 4, 14), '#f8e0a0'] }));
    stamp(g, 6, 0, ['l...', 'lff.', 'l...'], { l: '#6a4a20', f: '#e8343c' });
    paint(g, box(7, 11, 9.5, 15), I('#a07838', { shade: null }));
  }),
  crab: G((g) => {
    for (const d of [-1, 1]) {
      paint(g, ell(8 + d * 6, 4.5, 2, 2.2), I('#e8434f'));
      for (const k of [0, 2, 4]) dot(g, 8 + d * (4 + k / 2), 12 + (k > 2 ? 1 : 0), '#a8202c');
    }
    paint(g, ell(8, 9.5, 5.6, 3.6), I('#e8434f', { hi: hi(6, 8, 1.4, 0.8, '#ff8f98') }));
    stamp(g, 6, 5, ['w..w', 'k..k'], { w: '#ffffff', k: '#1d2440' });
  }),
  shell: G((g) => {
    const s = paint(g, or(and(ell(8, 11, 7, 8), (x, y) => y < 12), poly([[6, 12], [10, 12], [9, 15], [7, 15]])), I('#ffb0c4', { shade: '#e88aa8' }));
    for (const a of [-50, -25, 0, 25, 50]) for (let r = 3; r < 9; r++) {
      const x = Math.round(8 + Math.sin((a * Math.PI) / 180) * r - 0.5), y = Math.round(12 - Math.cos((a * Math.PI) / 180) * r - 0.5);
      if (s[y * 16 + x]) dot(g, x, y, '#d87098');
    }
  }),
  snowman: G((g) => {
    paint(g, ell(8, 11.5, 5, 4.2), { fill: '#ffffff', line: '#7a8aa8', shade: '#dfe6f4' });
    paint(g, ell(8, 5.5, 3.6, 3.2), { fill: '#ffffff', line: '#7a8aa8', shade: '#dfe6f4' });
    dot(g, 7, 5, '#1d2440'); dot(g, 9, 5, '#1d2440');
    stamp(g, 8, 6, ['oo'], { o: '#f08a2c' });
    paint(g, box(4.5, 8, 11.5, 9.5), I('#d8343c', { shade: null }));
    dot(g, 8, 11, '#1d2440'); dot(g, 8, 13, '#1d2440');
  }),
  puddle: G((g) => {
    paint(g, ell(8, 13.5, 7.6, 1.9), I('#4fb0f0', { shade: null, hi: hi(5.5, 13, 2.2, 0.5, '#bfe6ff') }));
    dot(g, 11, 13, '#bfe6ff');
  }),
  forest: G((g) => {
    paint(g, box(7, 12, 9, 15.5), I('#8a5a32'));
    paint(g, or(poly([[8, 0.5], [12, 6], [4, 6]]), poly([[8, 3.5], [13.5, 10], [2.5, 10]]), poly([[8, 6.5], [15, 13], [1, 13]])), I('#2f8a4a', { hi: hi(6, 6, 0.8, 2, '#5cb86a') }));
  }),
  mountains: G((g) => {
    paint(g, poly([[0.5, 15], [6, 3], [10, 9], [12, 6], [15.5, 15]]), I('#7a8aa0', { hi: hi(5, 7, 1, 2, '#a8b4c8') }));
    fill(g, poly([[4, 7.5], [6, 3], [8.2, 6.5], [7, 7.5], [6, 6.5]]), '#ffffff');
  }),

  // ---------- Größere Bilder für die Szene ----------
  chest: G((g) => chest(g, false), 24, 20),
  chest_open: G((g) => chest(g, true), 24, 20),
  bed: G((g) => {
    paint(g, ell(30, 13, 29, 6.6), I('#b8763a', { hi: [ell(14, 10.5, 7, 1.4), '#d8965a'] }));
    paint(g, ell(30, 11.5, 23, 3.8), I('#f4c6d8', { shade: '#e0a8c0', hi: hi(22, 10.5, 6, 1, '#fde4ee') }));
    for (let x = 4; x < 56; x += 4) dot(g, x, 16, '#8a5428');
  }, 60, 20),
  wheel0: G((g) => wheel(g, 18, 18, 16, 0, true), 36, 40),
  wheel1: G((g) => wheel(g, 18, 18, 16, 1, true), 36, 40),
  tunnel: G((g) => {
    paint(g, and(ell(22, 26, 21, 24), (x, y) => y < 25.5), I('#4a9ad8', { shade: '#2e6ea8', hi: hi(12, 8, 4, 2, '#8ac8f0') }));
    for (const x of [9, 16, 22, 28, 35]) for (let y = 2; y < 26; y++) if (g.px[y * 44 + x] === '#4a9ad8') dot(g, x, y, '#2e6ea8');
    paint(g, and(ell(5, 18, 3.6, 8), (x, y) => y < 25.5), { fill: '#1a2e40', outline: false, shade: null });
    paint(g, and(ell(39, 18, 3.6, 8), (x, y) => y < 25.5), { fill: '#1a2e40', outline: false, shade: null });
  }, 44, 26),
  rope: G((g) => {
    paint(g, tube([5, 0], [8, 28], [5, 55], 1.6), I('#c89a60', { shade: '#a07840' }));
    for (const y of [12, 24, 36, 48]) paint(g, ell(6.6, y, 3, 2.2), I('#b08050'));
  }, 12, 56),
  think: G((g) => {
    paint(g, or(ell(12, 9.5, 11, 9)), { fill: '#ffffff', line: '#3b3550', shade: '#e6e2f0' });
    paint(g, ell(3.5, 20.5, 2.2, 2), { fill: '#ffffff', line: '#3b3550', shade: null });
    paint(g, ell(1.5, 23.5, 1.2, 1.1), { fill: '#ffffff', line: '#3b3550', shade: null });
  }, 24, 25),
};

// Laufrad: Ring, Speichen (zwei Stellungen für die Drehung) und Ständer
function wheel(g, cx, cy, r, frame, stand = false) {
  if (stand) {
    const lw = Math.max(0.7, r / 12);
    for (const d of [-1, 1]) paint(g, tube([cx, cy], [cx + d * r * 0.35, cy + r * 0.6], [cx + d * r * 0.62, g.h - 1], lw), I('#7a7a88', { shade: null }));
  }
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
  const w = 24;
  paint(g, box(2, 9, 22, 19), I('#a8693a', { hi: [box(3, 10, 21, 11), '#c88a50'] }));
  for (const y of [13, 16]) for (let x = 3; x < 21; x++) dot(g, x, y, '#8a5428');
  if (open) {
    paint(g, poly([[2, 9], [4, 1], [20, 1], [22, 9]]), I('#6a3a1a', { shade: null }));
    stamp(g, 5, 5, ['.rr..yy.bb', 'rrrryyyybbb', '.rr..yy.bbb'], { r: '#e8434f', y: '#ffd23c', b: '#4a90e0' });
  } else {
    paint(g, or(and(ell(12, 9, 10.5, 6), (x, y) => y < 9.5), box(1.5, 7, 22.5, 10)), I('#b8763a', { hi: [box(4, 4, 20, 5), '#d8965a'] }));
  }
  paint(g, box(10.5, open ? 9 : 8, 13.5, open ? 12 : 12), I('#ffd23c', { shade: '#e0961e' }));
  for (let x = 0; x < w; x++) if (!g.px[18 * w + x] && x > 2 && x < 21) dot(g, x, 19, 'rgba(0,0,0,.15)');
}

// Nicht jedes Ding hat einen eigenen Gegenstand: Werte, Fähigkeiten und Ausflugsdinge zeigen ein passendes Bild
export const ICON_OF = {
  love: 'heart', fun: 'toy_ball', food: 'food_dry', water: 'drop', rest: 'zzz', joy: 'star',
  treat: 'food_bone', sniff: 'sparkle', coins: 'coin', park: 'room_garden', beach: 'room_beach',
  puddle: 'puddle', stone: 'stone', bush: 'bush', log: 'log', mushroom: 'mushroom', castle: 'castle', crab: 'crab', shell: 'shell', rock: 'rock', snowman: 'snowman',
};
const cache = new Map();
export function iconGrid(id) {
  id = ICON_OF[id] || id;
  if (cache.has(id)) return cache.get(id);
  let g;
  if (ICONS[id]) g = ICONS[id]();
  else if (id.startsWith('acc_')) g = accGrid(id);
  else if (hasFurn(id)) g = furnGrid(id);   // Einrichtung: das große Bild, im Shop verkleinert
  else g = ICONS.star();
  cache.set(id, g);
  return g;
}
export const hasIcon = (id) => !!(ICONS[ICON_OF[id] || id] || String(id).startsWith('acc_') || hasFurn(id));

const svgCache = new Map();
export function iconSvg(id, cls = 'pxi') {
  const key = id + '|' + cls;
  if (!svgCache.has(key)) svgCache.set(key, gridSvg(iconGrid(id), { cls }));
  return svgCache.get(key);
}
