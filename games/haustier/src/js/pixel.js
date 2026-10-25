// Pixel-Grafik aus Formen: Teile werden von hinten nach vorn in ein Raster gemalt. Jedes Teil bekommt eine Kontur
// (außen dunkel, innen in der Schattenfarbe des Teils dahinter), unten rechts einen Schatten und oben links ein Licht.
// Gesichter sind feste Pixelmuster, alle Farben eines Tieres entstehen aus main, belly und accent seiner Fellfarbe.
// Läuft im Browser und unter Node (der Kartentisch der Homepage zeigt das Tier), ohne DOM.
//
//   petGrid(species, color, { face, blink, tail, acc })   Tier in einem 48 × 48-Raster
//   gridSvg(g, { cls, label, layers })                     Raster als SVG, je Farbe ein Pfad
//   ACC_IDS                                                Accessoires, die gezeichnet werden können
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Farben ----------
function hex2rgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgb2hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h / 360 + 1 / 3) * 255, f(h / 360) * 255, f(h / 360 - 1 / 3) * 255];
}
// Schatten werden kühler (Richtung Violett), Lichter wärmer
function shift(c, dl, target, amt, ds) {
  let [h, s, l] = rgb2hsl(hex2rgb(c));
  if (s < 0.06) { h = target; s = Math.max(s, 0.04); }
  const d = ((target - h + 540) % 360) - 180;
  h = (h + Math.sign(d) * Math.min(Math.abs(d), amt) + 360) % 360;
  return rgb2hex(hsl2rgb([h, clamp(s + ds, 0, 1), clamp(l + dl, 0, 1)]));
}
export const darker = (c, k = 1) => shift(c, -0.11 * k, 255, 10 * k, 0.05 * k);
export const lighter = (c, k = 1) => shift(c, 0.07 * k, 50, 6 * k, 0);
// Kontur: deutlich dunkler als die Fläche, auch bei dunklem Fell
export function lineOf(c) {
  const [, , l] = rgb2hsl(hex2rgb(c));
  return shift(c, Math.min(-0.2, 0.22 - l), 265, 28, 0.12);
}

// ---------- Raster und Formen ----------
// px: Farbe je Pixel (null = leer). own: Schattenfarbe des Teils, dem das Pixel gehört (für Innenlinien)
export const grid = (w, h) => ({ w, h, px: new Array(w * h).fill(null), own: new Array(w * h).fill(null) });
function mask(g, fn) {
  const m = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (fn(x + 0.5, y + 0.5)) m[y * g.w + x] = 1;
  return m;
}
const at = (g, m, x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h && m[y * g.w + x] === 1;
// Formen bekommen Pixelmitten (x + 0.5, y + 0.5)
export const ell = (cx, cy, rx, ry, deg = 0) => {
  const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return (x, y) => {
    const dx = x - cx, dy = y - cy, u = dx * co + dy * si, v = -dx * si + dy * co;
    return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
  };
};
export const poly = (pts) => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const box = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
// Dicker Strich entlang einer quadratischen Kurve (Schwänze, Henkel)
export const tube = (p0, p1, p2, r0, r1 = r0) => {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1], r0 + (r1 - r0) * t]);
  }
  return (x, y) => pts.some(([px, py, r]) => (x - px) ** 2 + (y - py) ** 2 <= r * r);
};
export const and = (...fs) => (x, y) => fs.every((f) => f(x, y));
export const or = (...fs) => (x, y) => fs.some((f) => f(x, y));
export const not = (a) => (x, y) => !a(x, y);
// Form, die nur innerhalb eines schon gemalten Teils liegt
export const inside = (m, w) => (x, y) => m[Math.floor(y) * w + Math.floor(x)] === 1;

// Teil malen. o: { fill, line, shade, deep, outline, inner, rim, hi: [Form, Farbe] }
//   rim: 1 = Schatten nur an der Kante unten rechts (dünne Teile), sonst zwei Pixel breit unten
export function paint(g, fn, o) {
  const m = mask(g, fn), w = g.w;
  const fill = o.fill, shade = o.shade === undefined ? darker(fill) : o.shade, deep = o.deep || darker(fill, 2.2);
  const line = o.line || lineOf(fill);
  if (o.outline !== false) {
    for (let y = 0; y < g.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m[i]) continue;
      if (!(at(g, m, x - 1, y) || at(g, m, x + 1, y) || at(g, m, x, y - 1) || at(g, m, x, y + 1))) continue;
      const own = g.own[i];
      if (own === null || own === 'line') { g.px[i] = line; g.own[i] = 'line'; } else if (o.inner !== false) g.px[i] = own;
    }
  }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!m[i]) continue;
    let c = fill;
    if (shade && (!at(g, m, x + 1, y + 1) || (o.rim !== 1 && !at(g, m, x, y + 2)))) c = shade;
    if (o.hi && c === fill && o.hi[0](x + 0.5, y + 0.5)) c = o.hi[1];
    g.px[i] = c; g.own[i] = deep;
  }
  return m;
}
// Fläche ohne Kontur und ohne Schatten (Flecken, Innenohren, Muster)
export const fill = (g, fn, c, shade = null) => paint(g, fn, { fill: c, outline: false, shade });
export function dot(g, x, y, c) { if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.px[y * g.w + x] = c; }
// Muster aus Zeichen: '.' oder ' ' frei, sonst Schlüssel in pal
export function stamp(g, x0, y0, rows, pal, flip = false) {
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.' || ch === ' ') return;
    const c = pal[ch];
    if (c) dot(g, flip ? x0 + r.length - 1 - x : x0 + x, y0 + y, c);
  }));
}
// Raster auf die belegten Pixel zuschneiden (quadratisch, mit Rand)
export function crop(g, pad = 1) {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.px[y * g.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return grid(1, 1);
  const s = Math.max(x1 - x0, y1 - y0) + 1 + 2 * pad;
  const ox = x0 - pad - Math.floor((s - 2 * pad - (x1 - x0 + 1)) / 2), oy = y0 - pad - Math.floor((s - 2 * pad - (y1 - y0 + 1)) / 2);
  const out = grid(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const sx = x + ox, sy = y + oy;
    if (sx >= 0 && sy >= 0 && sx < g.w && sy < g.h) out.px[y * s + x] = g.px[sy * g.w + sx];
  }
  return out;
}

// ---------- SVG ----------
// Je Farbe ein Pfad aus waagrechten Strichen (eine Zeile = ein Strich der Breite 1). only: Menge der Pixel-Indizes
export function paths(g, only = null) {
  const by = new Map();
  for (let y = 0; y < g.h; y++) {
    let x = 0;
    while (x < g.w) {
      const i = y * g.w + x, c = g.px[i];
      if (!c || (only && !only.has(i))) { x++; continue; }
      let n = 1;
      while (x + n < g.w && g.px[i + n] === c && (!only || only.has(i + n))) n++;
      by.set(c, (by.get(c) || '') + `M${x} ${y}.5h${n}`);
      x += n;
    }
  }
  let out = '';
  for (const [c, d] of by) out += `<path stroke="${c}" d="${d}"/>`;
  return out;
}
// layers: [[Klasse, Raster, Pixelmenge | null], …] statt des einen Rasters
export function gridSvg(g, { cls = 'pxi', label = '', layers = null, extra = '' } = {}) {
  const body = layers ? layers.map(([c, lg, only]) => `<g class="${c}">${paths(lg, only)}</g>`).join('') : g.px ? paths(g) : '';
  const aria = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 ${g.w} ${g.h}" ${aria} shape-rendering="crispEdges" fill="none" stroke-width="1" xmlns="http://www.w3.org/2000/svg">${body}${extra}</svg>`;
}

// ---------- Gesichter ----------
const EYES = {
  ok: ['.ee.', 'ewwe', 'ewee', 'eeee', 'eeLe', '.ee.'],
  happy: ['.ee.', 'e..e', '....'],
  sleep: ['....', 'e..e', '.ee.'],
  blink: ['....', 'eeee', '....'],
  sad: ['.ee.', 'eeee', 'ewee', 'ewee', 'eeLe', '.ee.'],
};
function eyes(g, P, kind, lx, y, gap) {
  const rows = EYES[kind] || EYES.ok;
  const pal = { e: P.eye, w: '#ffffff', L: P.eyeLight };
  const off = kind === 'happy' || kind === 'sleep' || kind === 'blink' ? 1 : 0;
  stamp(g, lx, y + off, rows, pal);
  stamp(g, lx + gap, y + off, rows, pal);
  if (P.pupil && (kind === 'ok' || kind === 'sad')) {
    // Katzenaugen: farbige Iris, schmale Pupille
    for (const x of [lx, lx + gap]) { for (let k = 1; k < 5; k++) dot(g, x + 2, y + k, P.pupil); dot(g, x + 1, y + 1, '#ffffff'); }
  }
}
function blush(g, P, lx, rx, y, w = 3) {
  for (let k = 0; k < w; k++) { dot(g, lx + k, y, P.blush); dot(g, rx + k, y, P.blush); }
}

function face(g, P, s, o) {
  const f = s.face;
  const kind = f === 'happy' || f === 'sleep' ? f : s.blink ? 'blink' : f === 'sad' ? 'sad' : 'ok';
  eyes(g, P, kind, o.lx + (kind === 'ok' || kind === 'sad' ? s.look || 0 : 0), o.ey, o.gap);
  const ny = o.ny, m = P.mouth, n = P.nose;
  if (o.kind === 'axolotl') {
    if (f === 'sad') stamp(g, 20, ny, ['..mmmm..', '.m....m.'], { m });
    else stamp(g, 18, ny, ['m..........m', '.m........m.', '..mmmmmmmm..'], { m });
  } else if (o.kind === 'dog') {
    stamp(g, 21, ny - 1, ['.nnnnnn.', 'nnwnnnnn', '.nnnnnn.', '...mm...'], { n: '#2b2233', w: '#8a7f99', m });
    if (f === 'happy') stamp(g, 20, ny + 3, ['m..mm..m', '.mm..mm.', '...tt...', '...tt...'], { m, t: '#ff7f97' });
    else if (f === 'sad') stamp(g, 21, ny + 3, ['..mm..', '.m..m.'], { m });
    else stamp(g, 20, ny + 3, ['m..mm..m', '.mm..mm.'], { m });
  } else if (o.kind === 'rabbit' || o.kind === 'hamster' || o.kind === 'rat') {
    stamp(g, 23, ny, ['nn'], { n });
    if (f === 'sad') stamp(g, 22, ny + 1, ['.mm.', 'm..m'], { m });
    else stamp(g, 21, ny + 1, ['..mm..', 'mm..mm'], { m });
    if (o.kind === 'rabbit' && f !== 'sad') stamp(g, 23, ny + 3, ['ww'], { w: '#ffffff' });
  } else if (o.kind === 'dragon') {
    stamp(g, 20, ny, ['n......n'], { n: darker(P.main, 2) });
    if (f === 'sad') stamp(g, 21, ny + 2, ['..mm..', '.m..m.'], { m });
    else stamp(g, 19, ny + 2, ['m........m', '.mmmmmmmm.', f === 'happy' ? '..w.......' : '..........'], { m, w: '#ffffff' });
  } else {
    // Katze, Fuchs: Näschen und „ω“
    stamp(g, 23, ny, ['nn'], { n });
    if (f === 'sad') stamp(g, 22, ny + 2, ['.mm.', 'm..m'], { m });
    else if (f === 'happy') stamp(g, 20, ny + 1, ['m..mm..m', '.mm..mm.', '...pp...'], { m, p: '#ff7f97' });
    else stamp(g, 20, ny + 1, ['...mm...', '.mm..mm.'], { m });
  }
  if (f !== 'sad') blush(g, P, o.lx - 3, o.lx + o.gap + 4, o.blushY, 3);
  if (f === 'happy') blush(g, P, o.lx - 2, o.lx + o.gap + 5, o.blushY + 1, 1);
  if (f === 'sad') { dot(g, o.lx - 1, o.ey + 6, '#79c8ff'); dot(g, o.lx - 1, o.ey + 7, '#79c8ff'); dot(g, o.lx - 2, o.ey + 8, '#4fa8ef'); }
}

// ---------- Paletten ----------
// Besondere Zeichnungen einzelner Fellfarben
const MARKS = { 'cat:ginger': 'stripes', 'dog:spotted': 'spot' };
function palette(species, c) {
  const main = c.main, belly = c.belly, acc = c.accent;
  return {
    main, belly, acc, line: lineOf(main), mainHi: lighter(main),
    eye: c.eye || '#2b2233', eyeLight: c.eye ? lighter(c.eye, 2) : '#7d6f99', pupil: c.eye ? '#1a1520' : null,
    blush: '#ff8fa8', nose: darker(acc.toLowerCase() === '#ffffff' ? '#f4a0a8' : acc, 0.6), mouth: lineOf(main),
    face: c.faceLine || null, mark: MARKS[species + ':' + c.id] || null,
  };
}

// ---------- Arten ----------
// Jede Art zeichnet in ein 48 × 48-Raster. s: { face, blink, tail (-1 … 1), onBody(g, P, Körper) }
const H = (P, extra = {}) => ({ fill: P.main, line: P.line, ...extra });
const headHi = (cx, cy, rx, ry, P) => [ell(cx - rx * 0.35, cy - ry * 0.45, rx * 0.45, ry * 0.3), P.mainHi];
const belly = (g, P, body, shape) => paint(g, and(shape, inside(body, g.w)), { fill: P.belly, outline: false, shade: darker(P.belly, 0.6) });

function catLike(g, P, s, kind) {
  const fox = kind === 'fox', tw = s.tail * 4;
  if (fox) {
    paint(g, ell(36 + tw * 0.5, 34, 6.5, 11, 28 + tw * 6), H(P));
    fill(g, ell(38.5 + tw * 1.1, 25.5, 3.4, 3.6, 28), P.belly);
  } else {
    paint(g, tube([30, 42], [45, 42], [41 + tw, 26], 2.6, 2.2), H(P, { rim: 1 }));
  }
  const body = paint(g, ell(24, 37.5, 10.5, 8.6), H(P));
  belly(g, P, body, ell(24, 40, 6.2, 6.4));
  if (s.onBody) s.onBody(g, P, body);
  // Ohren hinter dem Kopf
  const earL = fox ? [[9, 15], [10.5, 0.5], [21.5, 8]] : [[10, 14], [12, 2], [21, 8.5]];
  const earR = earL.map(([x, y]) => [48 - x, y]);
  paint(g, poly(earL), H(P, { rim: 1 }));
  paint(g, poly(earR), H(P, { rim: 1 }));
  const [a, t, c] = earL;
  const inL = [[a[0] + 2.6, a[1] - 1.8], [t[0] + 1, t[1] + 4.2], [c[0] - 2.8, c[1] + 0.6]];
  fill(g, poly(inL), fox ? P.belly : P.acc);
  fill(g, poly(inL.map(([x, y]) => [48 - x, y])), fox ? P.belly : P.acc);
  if (fox) { fill(g, and(poly(earL), (x, y) => y < 5), P.acc); fill(g, and(poly(earR), (x, y) => y < 5), P.acc); }
  const hy = 18;
  const head = paint(g, ell(24, hy, 14.2, 11.4), H(P, { hi: headHi(24, hy, 14.2, 11.4, P) }));
  const onHead = (fn) => and(fn, inside(head, g.w));
  if (fox) {
    paint(g, onHead(or(poly([[9, 19], [22, 21], [24, 30], [12, 27]]), poly([[39, 19], [26, 21], [24, 30], [36, 27]]))), { fill: P.belly, outline: false, shade: darker(P.belly, 0.5) });
  }
  if (P.mark === 'stripes') {
    const st = darker(P.main, 1.1);
    [[23, 8], [24, 8], [23, 9], [24, 9], [23, 10], [24, 10], [19, 9], [19, 10], [28, 9], [28, 10], [20, 8], [27, 8],
      [10, 17], [11, 17], [10, 19], [11, 19], [36, 17], [37, 17], [36, 19], [37, 19]].forEach(([x, y]) => dot(g, x, y, st));
  }
  if (P.face) fill(g, onHead(ell(24, hy + 6, 7, 4.5)), P.face);
  face(g, P, s, { lx: 15, gap: 14, ey: 16, ny: 22, blushY: 23, kind });
}

const SPECIES = {
  cat(g, P, s) { catLike(g, P, s, 'cat'); },
  fox(g, P, s) { catLike(g, P, s, 'fox'); },
  dog(g, P, s) {
    const tw = s.tail * 5;
    paint(g, tube([31, 40], [39, 38], [39 + tw, 29], 2.4), H(P, { rim: 1 }));
    const body = paint(g, ell(24, 37.5, 10.8, 8.6), H(P));
    belly(g, P, body, ell(24, 40, 6.4, 6.3));
    if (s.onBody) s.onBody(g, P, body);
    const hy = 18;
    const head = paint(g, ell(24, hy, 13.6, 11.6), H(P, { hi: headHi(24, hy, 13.6, 11.6, P) }));
    const onHead = (fn) => and(fn, inside(head, g.w));
    if (P.mark === 'spot') fill(g, onHead(ell(17, hy - 1, 5.6, 5.2)), P.acc);
    paint(g, onHead(ell(24, hy + 6.2, 6.8, 4.6)), { fill: P.belly, outline: false, shade: darker(P.belly, 0.5) });
    // Schlappohren vor dem Kopf
    paint(g, ell(11.2, hy + 1, 3.8, 8.2, 14), { fill: P.acc, line: P.line });
    paint(g, ell(36.8, hy + 1, 3.8, 8.2, -14), { fill: P.acc, line: P.line });
    face(g, P, s, { lx: 16, gap: 12, ey: 13, ny: 21, blushY: 22, kind: 'dog' });
  },
  rabbit(g, P, s) {
    paint(g, ell(35.5 + s.tail * 0.6, 42, 3.4, 3.2), { fill: '#ffffff', line: P.line, shade: '#e6e2ee' });
    const body = paint(g, ell(24, 38, 10.4, 8.4), H(P));
    belly(g, P, body, ell(24, 40.5, 6.2, 6));
    if (s.onBody) s.onBody(g, P, body);
    const tilt = s.face === 'sad' ? 12 : 0;
    paint(g, ell(18 - tilt * 0.2, 9.5, 3.7, 9, -8 - tilt), H(P, { rim: 1 }));
    paint(g, ell(30 + tilt * 0.2, 9.5, 3.7, 9, 8 + tilt), H(P, { rim: 1 }));
    fill(g, ell(18 - tilt * 0.2, 10.5, 1.6, 6.4, -8 - tilt), P.acc);
    fill(g, ell(30 + tilt * 0.2, 10.5, 1.6, 6.4, 8 + tilt), P.acc);
    const hy = 21.5;
    const head = paint(g, ell(24, hy, 13.4, 10.4), H(P, { hi: headHi(24, hy, 13.4, 10.4, P) }));
    fill(g, and(or(ell(19.5, hy + 5.5, 4.5, 3.3), ell(28.5, hy + 5.5, 4.5, 3.3)), inside(head, g.w)), P.belly);
    face(g, P, s, { lx: 15, gap: 14, ey: 19, ny: 25, blushY: 25, kind: 'rabbit' });
  },
  hamster(g, P, s) {
    paint(g, ell(13.5, 15.5, 3.8, 3.8), H(P, { rim: 1 }));
    paint(g, ell(34.5, 15.5, 3.8, 3.8), H(P, { rim: 1 }));
    fill(g, ell(13.5, 15.8, 1.8, 1.8), P.acc);
    fill(g, ell(34.5, 15.8, 1.8, 1.8), P.acc);
    paint(g, ell(17, 45, 3.4, 2), H(P, { fill: P.acc }));
    paint(g, ell(31, 45, 3.4, 2), H(P, { fill: P.acc }));
    const blob = paint(g, ell(24, 31, 16.6, 14.3), H(P, { hi: [ell(17, 21, 5.5, 3), P.mainHi] }));
    belly(g, P, blob, or(ell(24, 37.5, 11, 8.5), ell(13, 30, 5, 4.2), ell(35, 30, 5, 4.2)));
    if (s.onBody) s.onBody(g, P, blob);
    // Sonnenblumenkern zwischen den Pfötchen
    stamp(g, 23, 32, ['.ss.', 'swss', 'swss', '.ss.'], { s: '#4a3f52', w: '#d8d0c0' });
    paint(g, ell(21.2, 35, 2, 1.6), { fill: P.main, line: P.line, shade: null });
    paint(g, ell(26.8, 35, 2, 1.6), { fill: P.main, line: P.line, shade: null });
    face(g, P, s, { lx: 15, gap: 14, ey: 22, ny: 28, blushY: 29, kind: 'hamster' });
  },
  rat(g, P, s) {
    const tw = s.tail * 3;
    paint(g, tube([31, 44], [44, 46], [44 + tw, 34], 1.2, 0.8), { fill: P.acc, line: P.line, rim: 1 });
    const body = paint(g, ell(24, 37.5, 10, 8.6), H(P));
    belly(g, P, body, ell(24, 40, 6, 6.3));
    if (s.onBody) s.onBody(g, P, body);
    paint(g, ell(12, 11, 6, 6), H(P, { rim: 1 }));
    paint(g, ell(36, 11, 6, 6), H(P, { rim: 1 }));
    fill(g, ell(12.5, 11.5, 3.6, 3.6), P.acc);
    fill(g, ell(35.5, 11.5, 3.6, 3.6), P.acc);
    const hy = 19.5;
    const head = paint(g, or(ell(24, hy, 12.8, 10.4), ell(24, hy + 5, 7.4, 6.2)), H(P, { hi: headHi(24, hy, 12.8, 10.4, P) }));
    if (P.face) fill(g, and(ell(24, hy + 6, 6.5, 5), inside(head, g.w)), P.face);
    face(g, P, s, { lx: 15, gap: 14, ey: 17, ny: 24, blushY: 23, kind: 'rat' });
  },
  axolotl(g, P, s) {
    const tw = s.tail * 3;
    paint(g, ell(36 + tw * 0.4, 40, 8, 3.4, -22 - tw * 5), H(P, { fill: P.belly }));
    const body = paint(g, ell(24, 38, 9.6, 8), H(P));
    belly(g, P, body, ell(24, 40.5, 5.6, 5.6));
    if (s.onBody) s.onBody(g, P, body);
    paint(g, ell(18.5, 44.5, 3, 2), H(P));
    paint(g, ell(29.5, 44.5, 3, 2), H(P));
    // Kiemen
    const hy = 21;
    for (const d of [-1, 1]) {
      paint(g, ell(24 + d * 15.5, hy - 7.5, 2.4, 5, d * 42), { fill: P.acc, line: P.line, rim: 1 });
      paint(g, ell(24 + d * 17.5, hy - 2, 2.4, 5, d * 72), { fill: P.acc, line: P.line, rim: 1 });
      paint(g, ell(24 + d * 17, hy + 4, 2.2, 4.4, d * 108), { fill: P.acc, line: P.line, rim: 1 });
    }
    paint(g, ell(24, hy, 15, 10.6), H(P, { hi: headHi(24, hy, 15, 10.6, P) }));
    face(g, P, s, { lx: 14, gap: 16, ey: 18, ny: 25, blushY: 25, kind: 'axolotl' });
  },
  dragon(g, P, s) {
    const tw = s.tail * 4;
    paint(g, tube([31, 43], [43, 44], [43 + tw, 33], 2.8, 1.4), H(P, { rim: 1 }));
    paint(g, poly([[42 + tw, 34], [46 + tw, 30], [45 + tw, 36]]), { fill: P.acc, line: P.line });
    // Flügel
    paint(g, poly([[16, 32], [5, 24], [7, 30], [4, 33], [9, 36], [15, 38]]), { fill: darker(P.main, 0.6), line: P.line, rim: 1 });
    paint(g, poly([[32, 32], [43, 24], [41, 30], [44, 33], [39, 36], [33, 38]]), { fill: darker(P.main, 0.6), line: P.line, rim: 1 });
    const body = paint(g, ell(24, 37.5, 10.4, 8.6), H(P));
    const bel = and(ell(24, 40, 6, 6.4), inside(body, g.w));
    paint(g, bel, { fill: P.belly, outline: false, shade: darker(P.belly, 0.6) });
    for (const y of [37, 40, 43]) for (let x = 20; x <= 27; x++) if (bel(x + 0.5, y + 0.5)) dot(g, x, y, darker(P.belly, 1));
    if (s.onBody) s.onBody(g, P, body);
    const hy = 19;
    paint(g, poly([[15, 11], [13, 2], [20, 9]]), { fill: P.acc, line: P.line, rim: 1 });
    paint(g, poly([[33, 11], [35, 2], [28, 9]]), { fill: P.acc, line: P.line, rim: 1 });
    paint(g, poly([[10, 18], [3, 13], [10, 22]]), H(P, { rim: 1 }));
    paint(g, poly([[38, 18], [45, 13], [38, 22]]), H(P, { rim: 1 }));
    const head = paint(g, or(ell(24, hy, 13.6, 10.8), ell(24, hy + 5, 9, 6)), H(P, { hi: headHi(24, hy, 13.6, 10.8, P) }));
    fill(g, and(ell(24, hy + 6.5, 7.6, 4.2), inside(head, g.w)), P.belly);
    face(g, P, s, { lx: 15, gap: 14, ey: 15, ny: 22, blushY: 22, kind: 'dragon' });
  },
};

// ---------- Accessoires ----------
// Ankerpunkte je Art: Oberkante des Kopfes, Platz der Schleife, Hals, Augen (Höhe, linkes Auge, Abstand)
const KEYS = {
  cat: { headTop: 7, bowX: 29, neckY: 28, eyeY: 15, eyeX: 15, gap: 14 },
  fox: { headTop: 7, bowX: 29, neckY: 28, eyeY: 15, eyeX: 15, gap: 14 },
  dog: { headTop: 7, bowX: 28, neckY: 28, eyeY: 12, eyeX: 16, gap: 12 },
  rabbit: { headTop: 12, bowX: 30, neckY: 30, eyeY: 18, eyeX: 15, gap: 14 },
  hamster: { headTop: 17, bowX: 28, neckY: 32, eyeY: 21, eyeX: 15, gap: 14 },
  rat: { headTop: 10, bowX: 29, neckY: 29, eyeY: 16, eyeX: 15, gap: 14 },
  axolotl: { headTop: 11, bowX: 28, neckY: 30, eyeY: 17, eyeX: 14, gap: 16 },
  dragon: { headTop: 9, bowX: 28, neckY: 29, eyeY: 14, eyeX: 15, gap: 14 },
};

// Halsband in der Farbe c (18 Pixel breit, mittig), mit Marke oder ohne (fürs Glöckchen)
function collar(g, k, c, tag = true) {
  const rows = ['.llllllllllllllll.', 'lccccccccccccccccl', tag ? '.lllllllyylllllll.' : '.llllllllllllllll.'];
  if (tag) rows.push('.......lyyl.......', '........ll........');
  stamp(g, 15, k.neckY, rows, { l: darker(c, 2.4), c, y: '#ffd23c' });
}
function scarf(g, k, pal) {
  stamp(g, 14, k.neckY - 1, ['.llllllllllllllllll.', 'lnnnnnnnnnnnnnnnnnnl', 'lnwnnwnnwnnwnnwnnwnl', '.lllllllnnnlllllll..',
    '.......lnwnl........', '.......lnnnl........', '........lll.........'], pal);
}
function sweater(g, shape, top, outline) {
  paint(g, shape, { fill: '#c84848', line: '#5a1420', outline, shade: '#a03040' });
  for (let x = 0; x < 48; x++) {
    if (g.px[(top + 1) * 48 + x] === '#c84848') dot(g, x, top + 1, '#a03040');
    for (const y of [top + 5, top + 9]) if (g.px[y * 48 + x] === '#c84848') dot(g, x, y, '#f4d0d0');
  }
}
// head | neck | back (back: behind = vor dem Tier gemalt, body = über dem Körper)
const ACC = {
  acc_collar_red: { slot: 'neck', draw(g, P, k) { collar(g, k, '#d8343c'); } },
  acc_collar_blue: { slot: 'neck', draw(g, P, k) { collar(g, k, '#3a62d8'); } },
  acc_collar_green: { slot: 'neck', draw(g, P, k) { collar(g, k, '#34a048'); } },
  acc_bell: {
    slot: 'neck', draw(g, P, k) {
      collar(g, k, '#d8343c', false);
      paint(g, ell(24, k.neckY + 4, 2.6, 2.6), { fill: '#ffd23c', line: '#8a5a00', shade: '#e09a1c', hi: [ell(23, k.neckY + 3, 0.8, 0.8), '#fff2a8'] });
      dot(g, 23, k.neckY + 5, '#8a5a00'); dot(g, 24, k.neckY + 5, '#8a5a00');
    },
  },
  acc_bowtie: {
    slot: 'neck', draw(g, P, k) {
      stamp(g, 18, k.neckY - 1, ['ll........ll', 'lrrl....lrrl', 'lrrrllllrrrl', 'lrrrlkklrrrl', 'lrrrllllrrrl', 'lrrl....lrrl', 'll........ll'],
        { l: '#5a0a1e', r: '#c8203c', k: '#8a1028' });
      dot(g, 19, k.neckY + 1, '#f0607a');
    },
  },
  acc_scarf: { slot: 'neck', draw(g, P, k) { scarf(g, k, { l: '#8a4a08', n: '#f0a020', w: '#ffe08a' }); } },
  acc_homepage: {
    slot: 'neck', draw(g, P, k) {
      scarf(g, k, { l: '#003c3c', n: '#008080', w: '#008080' });
      // Kleines Fenster auf dem Zipfel
      stamp(g, 21, k.neckY + 3, ['bbbbbb', 'bttttb', 'bwwwwb', 'bwwwwb', 'bbbbbb'], { b: '#003c3c', t: '#000080', w: '#ffffff' });
    },
  },
  acc_bow: {
    slot: 'head', draw(g, P, k) {
      stamp(g, k.bowX, k.headTop - 2, ['ll...ll', 'lpp.ppl', 'lpPkPpl', 'lpp.ppl', 'll...ll'], { l: '#8f2050', p: '#ff79b0', P: '#ffb3d2', k: '#d0407e' });
    },
  },
  acc_crown: {
    slot: 'head', draw(g, P, k) {
      stamp(g, 18, k.headTop - 4, ['.l...l..l...', 'lyl.lyllyl.l', 'lyylyyyyylyl', 'lyyyyrryyyyl', 'lybyyrryybyl', 'llllllllllll'],
        { l: '#8a5a00', y: '#ffd23c', r: '#e8334a', b: '#3a8ae8' });
    },
  },
  acc_beanie: {
    slot: 'head', draw(g, P, k) {
      const t = k.headTop;
      paint(g, and(ell(24, t + 4, 10.5, 9), (x, y) => y < t + 4), { fill: '#3a6fd8', line: '#16306e', hi: [ell(19.5, t - 2, 2.6, 1.6), '#6a98f0'] });
      for (let x = 16; x <= 32; x += 3) for (let y = t - 3; y < t + 3; y++) if (g.px[y * 48 + x] === '#3a6fd8') dot(g, x, y, '#2a55b0');
      paint(g, box(13.5, t + 2.5, 34.5, t + 5.5), { fill: '#2a55b0', line: '#16306e', shade: '#1e4290' });
      paint(g, ell(24, t - 5.5, 2.4, 2.2), { fill: '#ffffff', line: '#8a96b0', shade: '#dfe4f0' });
    },
  },
  acc_partyhat: {
    slot: 'head', draw(g, P, k) {
      const t = k.headTop, cone = poly([[18.5, t + 3], [24, t - 6], [29.5, t + 3]]);
      paint(g, cone, { fill: '#ff6fae', line: '#8f2050', shade: '#e0508e' });
      for (let x = 17; x <= 31; x++) for (let y = t - 6; y <= t + 3; y++) if (cone(x + 0.5, y + 0.5) && (x + y) % 5 === 0) dot(g, x, y, '#ffe36a');
      paint(g, ell(24, t - 6.5, 1.8, 1.8), { fill: '#ffd84a', line: '#8a5a00', shade: null });
    },
  },
  acc_santa: {
    slot: 'head', draw(g, P, k) {
      const t = k.headTop;
      paint(g, poly([[13, t + 3], [20, t - 6], [30, t - 7], [36, t - 2], [35, t + 3]]), { fill: '#d82828', line: '#6a0c0c', hi: [ell(19, t - 2, 3, 1.5), '#f05a5a'] });
      paint(g, box(12, t + 1.5, 36, t + 4.5), { fill: '#ffffff', line: '#8a96b0', shade: '#dfe4f0' });
      paint(g, ell(37, t - 1, 2.4, 2.4), { fill: '#ffffff', line: '#8a96b0', shade: '#dfe4f0' });
    },
  },
  acc_flowers: {
    slot: 'head', draw(g, P, k) {
      const t = k.headTop;
      paint(g, tube([12, t + 6], [24, t - 3], [36, t + 6], 0.8), { fill: '#4f9e48', line: '#22501e', shade: null });
      [[13, t + 5, '#ff8fb8'], [18, t + 1, '#fff27a'], [24, t, '#ffffff'], [30, t + 1, '#ff8fb8'], [35, t + 5, '#fff27a']].forEach(([x, y, c]) => {
        stamp(g, x - 1, y - 1, ['.p.', 'pyp', '.p.'], { p: c, y: '#f0a020' });
      });
    },
  },
  acc_sunglasses: {
    slot: 'head', draw(g, P, k) {
      const y = k.eyeY, gap = '.'.repeat(Math.max(0, k.gap - 6));
      stamp(g, k.eyeX - 1, y + 1, ['bbbbbb' + 'b'.repeat(k.gap - 6) + 'bbbbbb', 'bggggb' + gap + 'bggggb', 'bggwgb' + gap + 'bggwgb', '.bbbb.' + gap + '.bbbb.'],
        { b: '#1c1c24', g: '#3a3a52', w: '#9aa0c8' });
    },
  },
  acc_sweater: {
    slot: 'back',
    body(g, P, k, body) { sweater(g, and(inside(body, g.w), (x, y) => y > k.neckY + 1), k.neckY + 1, false); },
    icon(g) { sweater(g, and(ell(24, 37.5, 10.5, 8.6), (x, y) => y > 29), 29, true); },
  },
  acc_cape: {
    slot: 'back', behind(g, P, k) {
      paint(g, poly([[16, k.neckY - 2], [32, k.neckY - 2], [39.5, 47], [8.5, 47]]), { fill: '#8030c0', line: '#3a1060', hi: [box(10, 40, 13, 47), '#9a50d8'] });
    },
    draw(g, P, k) { stamp(g, 22, k.neckY - 1, ['lyyl', 'lyyl'], { l: '#5a3a00', y: '#ffd23c' }); },
  },
  acc_wings: {
    slot: 'back', behind(g) {
      for (const d of [-1, 1]) {
        const wing = paint(g, or(ell(24 + d * 12.5, 23, 5, 9, d * 38), ell(24 + d * 17.5, 21, 3.2, 6.5, d * 52),
          ell(24 + d * 13, 31, 3, 2.6), ell(24 + d * 16.5, 29.5, 2.8, 2.4), ell(24 + d * 19.5, 26.5, 2.4, 2.2)), { fill: '#ffffff', line: '#6a86b8', shade: '#dce6f8' });
        for (const [dx, dy] of [[13, 27], [15, 25], [17, 23], [14, 23], [16, 21]]) { const x = 24 + d * dx - (d < 0 ? 1 : 0); if (wing[dy * 48 + x]) dot(g, x, dy, '#b8c8e8'); }
      }
    },
  },
};
export const ACC_IDS = Object.keys(ACC);

export function petGrid(species, color, s = {}) {
  s = { face: 'ok', blink: false, tail: 0, acc: {}, ...s };
  const g = grid(48, 48);
  const P = palette(species, color);
  const k = KEYS[species];
  const list = Object.values(s.acc || {}).filter((id) => ACC[id]);
  for (const id of list) if (ACC[id].behind) ACC[id].behind(g, P, k);
  const bodies = list.filter((id) => ACC[id].body);
  SPECIES[species](g, P, { ...s, onBody: bodies.length ? (gg, PP, body) => bodies.forEach((id) => ACC[id].body(gg, PP, k, body)) : null });
  // Erst der Hals, dann der Kopf darüber
  for (const slot of ['back', 'neck', 'head']) for (const id of list) if (ACC[id].slot === slot && ACC[id].draw) ACC[id].draw(g, P, k);
  return g;
}

// ---------- Stellungen ----------
// Aus dem einen Bild von vorn werden weitere Stellungen, indem Teile des Rasters um ganze Bildpunkte verschoben werden:
// Pfote heben, ducken, strecken, Kopf senken, lehnen. So bekommen alle Arten jede Stellung, ohne eigene Zeichnung.
// box: Rahmen des Grundbilds (boxOf), damit Schwanz- und Augenebenen genau gleich verschoben werden.
export const POSES = ['walk1', 'walk2', 'crouch', 'stretch', 'eat', 'lean', 'bow', 'leg'];
export function boxOf(g) {
  let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.px[y * g.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? { x0: 0, y0: 0, x1: g.w - 1, y1: g.h - 1, cx: g.w / 2, h: g.h } : { x0, y0, x1, y1, cx: (x0 + x1 + 1) / 2, h: y1 - y0 + 1 };
}
// Teil des Rasters (sel(x, y)) um dx, dy verschieben; es liegt danach über dem Rest
function moveRegion(g, sel, dx, dy) {
  const out = grid(g.w, g.h);
  const moved = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.px[y * g.w + x];
    if (!c) continue;
    if (sel(x, y)) moved.push([x + dx, y + dy, c]); else out.px[y * g.w + x] = c;
  }
  for (const [x, y, c] of moved) if (x >= 0 && y >= 0 && x < g.w && y < g.h) out.px[y * g.w + x] = c;
  return out;
}
// Jede Zeile um ihren eigenen Versatz verschieben (Lehnen)
function shear(g, off) {
  const out = grid(g.w, g.h);
  for (let y = 0; y < g.h; y++) {
    const d = off(y);
    for (let x = 0; x < g.w; x++) { const c = g.px[y * g.w + x], nx = x + d; if (c && nx >= 0 && nx < g.w) out.px[y * g.w + nx] = c; }
  }
  return out;
}
export function posed(g, pose, b = boxOf(g)) {
  if (!pose || pose === 'stand') return g;
  const feet = b.y1 - 5, mid = Math.round(b.y0 + b.h * 0.58), head = Math.round(b.y0 + b.h * 0.45);
  switch (pose) {
    case 'walk1': return moveRegion(g, (x, y) => y >= feet && x < b.cx, 0, -2);
    case 'walk2': return moveRegion(g, (x, y) => y >= feet && x >= b.cx, 0, -2);
    case 'crouch': return moveRegion(g, (x, y) => y < mid, 0, 3);
    case 'eat': return moveRegion(g, (x, y) => y < head, 1, 4);
    case 'stretch': {
      // Oberkörper zwei Punkte hoch, die Lücke füllt die Zeile darunter
      const out = moveRegion(g, (x, y) => y < mid, 0, -2);
      for (const y of [mid - 2, mid - 1]) for (let x = 0; x < g.w; x++) if (!out.px[y * g.w + x]) out.px[y * g.w + x] = g.px[mid * g.w + x];
      return out;
    }
    case 'lean': return shear(g, (y) => Math.max(0, Math.round(((b.y1 - y) * 3) / b.h)));
    case 'bow': return moveRegion(moveRegion(g, (x, y) => y < head, 2, 3), (x, y) => y >= feet && x < b.cx, 0, -1);
    case 'leg': return shear(moveRegion(g, (x, y) => y >= feet - 2 && x < b.cx, -1, -5), (y) => (y < mid ? 1 : 0));
    default: return g;
  }
}

// Accessoire allein, für Shop und Menüs
export function accGrid(id) {
  const g = grid(48, 48);
  const a = ACC[id];
  if (!a) return g;
  const P = palette('cat', { main: '#9aa0a8', belly: '#dde0e4', accent: '#f4a0a8' });
  if (a.icon) a.icon(g, P, KEYS.cat);
  else {
    if (a.behind) a.behind(g, P, KEYS.cat);
    if (a.draw) a.draw(g, P, KEYS.cat);
  }
  return crop(g);
}
