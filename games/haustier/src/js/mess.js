// Geschäfte und Spuren: Pfützen, Häufchen, Kratzer, Knabberspuren … Regeln und Bilder ohne DOM, damit Zimmer,
// Desktop-Ebene und Tests dieselben haben. Gemütlich bleibt es so: selten, vermeidbar (Streukiste, Kratzbaum, Kauholz),
// nie strafend (Erfüllung sinkt höchstens um PENALTY_MAX und kommt nach dem Putzen sofort zurück).
//
// Spielstand:
//   state.mess      [{ id, kind, at: 'room' | 'desk', x, y, on, win, item, dx, t }]
//                   Zimmer:  x Anteil der Breite, y Tiefe (wie die Möbel)
//                   Desktop: on 'floor' (x Anteil der Breite), 'win' (win: Adresse des Fensters, dx: px vom linken Rand,
//                            verschwindet mit dem Fenster), 'item' (item: Möbel-id, dx: px vom linken Rand des Möbels)
//   state.litter    Füllstand der Streukiste (0 bis LITTER_MAX)
//   state.messDebt  so viel Erfüllung haben die Flecken gerade jedem Tier genommen (kommt beim Putzen zurück)
import { grid, paint, fill, ell, dot, stamp, gridSvg, lineOf, and } from './pixel.js';

export const MESS = {
  pee: { name: 'Pfütze', potty: true, dries: 2 * 3600e3 },
  poo: { name: 'Häufchen', potty: true },
  scratch: { name: 'Kratzer' },
  bite: { name: 'Bissspuren' },
  drool: { name: 'Sabber', dries: 3600e3 },
  dig: { name: 'Erde' },
  nibble: { name: 'Knabberspuren' },
  crumbs: { name: 'Körner' },
  splash: { name: 'Wasserspritzer', dries: 1800e3 },
  soot: { name: 'Rußfleck' },
};
// Spuren je Tierart
export const MARKS = {
  cat: ['scratch'], dog: ['bite', 'drool'], fox: ['dig', 'bite'], rabbit: ['nibble'],
  hamster: ['nibble', 'crumbs'], rat: ['nibble', 'crumbs'], axolotl: ['splash'], dragon: ['soot'],
};
// Möbel, die eine Spur abfangen: Steht es am selben Ort, geht das Tier dorthin, statt etwas anzustellen
export const CATCH = { scratch: 'furn_tree', bite: 'furn_chew', drool: 'furn_chew', nibble: 'furn_chew' };

export const MESS_RATE = 2;        // ungefähr so viele neue Flecken pro Stunde, solange jemand da ist
export const MESS_MAX = 14;        // mehr liegen nie herum
export const PENALTY_FROM = 3;     // ab so vielen Flecken sinkt die Erfüllung …
export const PENALTY_MAX = 10;     // … höchstens um so viel …
export const PENALTY_RATE = 4;     // … und so schnell (Punkte pro Stunde)
export const LITTER_MAX = 5;       // so oft passt die Streukiste, dann will sie geleert werden
export const CLEAN_JOY = 2;        // Putzen freut alle Tiere

// Wahrscheinlichkeit, dass in dtMs ein neuer Fleck dazukommt
export const messChance = (dtMs, rate = MESS_RATE) => 1 - Math.exp((-rate * dtMs) / 3600e3);
// Nachts (22 bis 7 Uhr) entsteht nichts Neues
export const nightTime = (d) => { const h = d.getHours(); return h >= 22 || h < 7; };
// Wie oft trotz Streukiste etwas danebengeht: sinkt mit der Zuneigungsstufe, ab Stufe 6 fast nie
export const missChance = (lvl) => Math.max(0.02, 0.5 - 0.08 * lvl);

// Was stellt ein Tier gleich an? { kind, to }: to = Möbel-id, zu dem es dafür geht (Streukiste, Kratzbaum, Kauholz),
// oder null: dort, wo es gerade ist. placed(id): Steht das Möbel dort, wo das Tier ist?
export function planMess(pet, { potty = true, placed = () => false, litter = 0, lvl = 1 } = {}, rng = Math.random) {
  if (potty && rng() < 0.45) {
    const kind = rng() < 0.6 ? 'pee' : 'poo';
    if (placed('furn_litter') && litter < LITTER_MAX && rng() >= missChance(lvl)) return { kind, to: 'furn_litter' };
    return { kind, to: null };
  }
  const list = MARKS[pet.species] || ['scratch'];
  const kind = list[Math.floor(rng() * list.length)];
  const c = CATCH[kind];
  if (c && placed(c) && rng() < 0.85) return { kind, to: c };
  return { kind, to: null };
}

let seq = 0;
export function addMess(state, m, now = Date.now()) {
  state.mess ||= [];
  if (!MESS[m.kind] || state.mess.length >= MESS_MAX) return null;
  const it = { id: 'm' + now.toString(36) + (seq++ % 1296).toString(36), kind: m.kind, at: m.at === 'room' ? 'room' : 'desk', t: now };
  for (const k of ['x', 'y', 'dx']) if (typeof m[k] === 'number' && Number.isFinite(m[k])) it[k] = k === 'dx' ? Math.round(m[k]) : Math.max(0, Math.min(1, m[k]));
  if (it.at === 'desk') {
    it.on = ['floor', 'win', 'item'].includes(m.on) ? m.on : 'floor';
    if (it.on === 'win') it.win = String(m.win || '');
    if (it.on === 'item') it.item = String(m.item || '');
  }
  state.mess.push(it);
  return it;
}
export function cleanMess(state, id) {
  const i = (state.mess || []).findIndex((m) => m.id === id);
  if (i < 0) return null;
  return state.mess.splice(i, 1)[0];
}
// Pfützen, Sabber und Spritzer trocknen von selbst. Gibt die Zahl der getrockneten Flecken zurück
export function dryUp(state, now = Date.now()) {
  const before = (state.mess || []).length;
  state.mess = (state.mess || []).filter((m) => !(MESS[m.kind].dries && now - m.t > MESS[m.kind].dries));
  return before - state.mess.length;
}

// Erfüllung und Sauberkeit: ab PENALTY_FROM Flecken sinkt sie langsam, höchstens um PENALTY_MAX. Sind es wieder weniger,
// bekommt jedes Tier sofort zurück, was es verloren hat. Gibt 'down', 'back' oder null zurück.
export function messMood(state, hours) {
  const n = (state.mess || []).length;
  state.messDebt = Math.max(0, Number(state.messDebt) || 0);
  if (n >= PENALTY_FROM) {
    const d = Math.min(PENALTY_MAX - state.messDebt, PENALTY_RATE * Math.max(0, hours));
    if (d <= 0) return null;
    for (const p of state.pets) p.stats.joy = Math.max(0, p.stats.joy - d);
    state.messDebt += d;
    return 'down';
  }
  if (state.messDebt > 0) {
    for (const p of state.pets) p.stats.joy = Math.min(100, p.stats.joy + state.messDebt);
    state.messDebt = 0;
    return 'back';
  }
  return null;
}
// Sauberkeit in Worten (für das Fach): Zahl der Flecken
export const cleanText = (n) => (n === 0 ? 'Alles sauber' : n === 1 ? 'Ein Fleck zum Wegwischen' : `${n} Flecken zum Wegwischen`);

// ---------- Bilder ----------
const I = (c, extra = {}) => ({ fill: c, line: lineOf(c), ...extra });
const G = (fn, w, h) => () => { const g = grid(w, h); fn(g); return g; };
const SPRITES = {
  pee: G((g) => { paint(g, ell(8, 2.5, 7.5, 2.2), I('#f4dc5c', { shade: '#e0c23c' })); dot(g, 5, 1, '#fff8c8'); dot(g, 6, 1, '#fff8c8'); }, 16, 5),
  poo: G((g) => {
    paint(g, ell(6, 8, 5.5, 2.3), I('#8a5a2b'));
    paint(g, ell(6, 5.5, 4, 2), I('#9a6634'));
    paint(g, ell(6, 3, 2.4, 1.7), I('#a87240'));
    dot(g, 6, 1, '#a87240'); dot(g, 4, 5, '#c89060'); dot(g, 5, 2, '#c89060');
  }, 12, 11),
  scratch: G((g) => {
    for (const k of [0, 3, 6]) for (let i = 0; i < 7; i++) { dot(g, 2 + k + i, 1 + i, '#fffaf0'); dot(g, 2 + k + i, 2 + i, '#7a7064'); }
  }, 16, 10),
  bite: G((g) => {
    for (const [x, y] of [[1, 1], [3, 0], [5, 0], [7, 0], [9, 1]]) { dot(g, x, y, '#5a5048'); dot(g, x, y + 1, '#fffaf0'); }
    for (const [x, y] of [[2, 4], [4, 5], [6, 5], [8, 4]]) { dot(g, x, y, '#5a5048'); dot(g, x, y - 1, '#fffaf0'); }
  }, 11, 7),
  drool: G((g) => { paint(g, ell(4, 2, 3.4, 1.4), I('#d8f0ff', { shade: '#b0d8f0' })); paint(g, ell(10, 3, 1.6, 1), I('#d8f0ff', { shade: null })); }, 13, 5),
  dig: G((g) => {
    paint(g, ell(8, 4, 7, 2.4), I('#7a5230'));
    for (const [x, y] of [[2, 1], [13, 1], [5, 0], [11, 0]]) paint(g, ell(x, y + 1, 1.2, 1), I('#8a6038', { shade: null }));
    dot(g, 6, 3, '#9a7048'); dot(g, 10, 4, '#9a7048');
  }, 17, 7),
  nibble: G((g) => {
    stamp(g, 0, 0, ['.w..w..w..w.', 'wwwwwwwwwwww', 'w.ww.ww.ww.w'], { w: '#d8b888' });
    for (const [x, y] of [[2, 4], [6, 5], [9, 4]]) dot(g, x, y, '#c09860');
  }, 12, 6),
  crumbs: G((g) => { for (const [x, y] of [[1, 2], [4, 1], [6, 3], [9, 2], [12, 1], [11, 3]]) stamp(g, x, y, ['ss', 'sw'], { s: '#3a3440', w: '#e8e0d0' }); }, 15, 5),
  splash: G((g) => {
    for (const [x, y, r] of [[3, 3, 1.6], [8, 2, 2.2], [13, 4, 1.4], [10, 5, 1]]) paint(g, ell(x, y, r, r * 0.8), I('#8ad0ff', { shade: '#5ab0e8' }));
    dot(g, 7, 1, '#ffffff');
  }, 16, 7),
  soot: G((g) => {
    paint(g, ell(8, 4, 7.4, 3.4), { fill: '#3a3438', line: '#2a2428', shade: null });
    fill(g, and(ell(8, 4, 4.5, 2), ell(7, 3.6, 4.5, 2)), '#4a4448');
    for (const [x, y] of [[1, 1], [15, 2], [3, 7]]) dot(g, x, y, '#5a5458');
  }, 17, 8),
  // Rauferei: eine Staubwolke mit Pfoten, Sternchen und Ohren, in zwei Bildern
  fight0: G((g) => cloud(g, 0), 64, 46),
  fight1: G((g) => cloud(g, 1), 64, 46),
  sparkle: G((g) => { stamp(g, 0, 0, ['...w...', '...w...', '.w.w.w.', 'wwwwwww', '.w.w.w.', '...w...', '...w...'], { w: '#fff6a0' }); }, 7, 7),
};
function cloud(g, f) {
  // Groß genug, dass zwei Tiere darin verschwinden (64 × 44)
  const k = 1.6;
  const puffs = f ? [[9, 15, 7], [18, 10, 8], [28, 12, 7.5], [32, 19, 6], [20, 19, 9], [8, 21, 5]] : [[10, 13, 7.5], [19, 9, 7], [29, 13, 8], [31, 20, 6], [19, 19, 9], [9, 20, 6]];
  for (const [x, y, r] of puffs) paint(g, ell(x * k, y * k + 2, r * k, r * k * 0.85), { fill: '#f4f0ec', line: '#8a8088', shade: '#d8d0d4' });
  // Pfote, Ohr, Schwanz und Sternchen schauen heraus
  const P = (x, y) => [Math.round(x * k), Math.round(y * k)];
  const paw = f ? P(3, 8) : P(34, 6);
  paint(g, ell(paw[0], paw[1] + 2, 3.4, 3), I('#e8a070'));
  stamp(g, paw[0] - 3, paw[1] - 2, ['w.w.w.w'], { w: '#e8a070' });
  const ear = f ? P(30, 2) : P(7, 3);
  stamp(g, ear[0], ear[1], ['...e...', '..eee..', '.eeeee.', 'eeeeeee'], { e: '#c88a50' });
  const tail = f ? P(33, 24) : P(2, 22);
  stamp(g, tail[0], tail[1], ['tt....', '.ttt..', '...ttt', '....tt'], { t: '#a86a3a' });
  const star = ['...y...', '..yyy..', 'yyyyyyy', '.yyyyy.', '..y.y..'];
  const s1 = f ? P(16, 0) : P(22, 0);
  stamp(g, s1[0], s1[1], star, { y: '#ffd23c' });
  const s2 = f ? P(25, 23) : P(12, 24);
  stamp(g, s2[0], s2[1], ['.y.', 'yyy', '.y.'], { y: '#ffd23c' });
}
const cache = new Map();
export const messGrid = (kind) => { if (!cache.has(kind)) cache.set(kind, (SPRITES[kind] || SPRITES.poo)()); return cache.get(kind); };
const svgs = new Map();
export function messSvg(kind) {
  if (!svgs.has(kind)) svgs.set(kind, gridSvg(messGrid(kind), { cls: 'pxi mess-svg' }));
  return svgs.get(kind);
}
// Wie hoch ein Fleck übersteht (Bildpunkte über dem Boden; Häufchen stehen, Pfützen liegen)
export const messSize = (kind) => { const g = messGrid(kind); return { w: g.w, h: g.h }; };

// Wie ein Tier sein Geschäft oder seine Spur macht (Stellung aus pixel.js POSES): Hunde und Füchse heben das Bein
const MESS_POSE = { pee: 'crouch', poo: 'crouch', scratch: 'stretch', bite: 'eat', drool: 'eat', dig: 'bow', nibble: 'eat', crumbs: 'eat', splash: 'bow', soot: 'stretch' };
export const messPose = (kind, species) => (kind === 'pee' && (species === 'dog' || species === 'fox') ? 'leg' : MESS_POSE[kind] || 'crouch');
export const messMs = (kind) => (kind === 'scratch' || kind === 'dig' ? 1800 : 1400);
