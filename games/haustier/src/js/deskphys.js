// Rechnen für die Tiere draußen auf dem Desktop, ohne DOM (desktop.js zeichnet, test/deskphys.test.js prüft).
// Koordinaten in Bildschirmpunkten, y wächst nach unten. Ein Tier steht mit den Füßen auf einer Lauffläche:
// der Oberkante eines Fensters, einem Möbelstück oder der Taskleiste (dem Boden).

// Streiche: ab Werk alle an, einzeln abschaltbar (gilt je Gerät, siehe Einstellungen im Spiel)
export const PRANKS = [
  { id: 'bell', label: 'An der Glocke 🔔 läuten', hint: 'klingelt nur, öffnet nichts' },
  { id: 'volume', label: 'Den Ton eine Stufe leiser drehen', hint: 'nie lauter, mit Rückgängig' },
  { id: 'start', label: 'Das Startmenü aufmachen', hint: 'geht nach 4 Sekunden wieder zu' },
  { id: 'tasks', label: 'An Fensterknöpfen in der Taskleiste ziehen', hint: 'nie am aktiven Fenster' },
  { id: 'icons', label: 'Desktop-Symbole beschnuppern', hint: 'wackeln nur, öffnen nichts' },
];
// Wie oft: höchstens einer je gap, und nur, wenn seit idle niemand etwas tut
export const PRANK_RATES = {
  off: { label: 'Aus', gap: Infinity, idle: Infinity },
  rare: { label: 'Selten (alle 3 Stunden)', gap: 3 * 3600e3, idle: 300e3 },
  normal: { label: 'Normal (jede Stunde)', gap: 3600e3, idle: 120e3 },
  often: { label: 'Oft (alle 20 Minuten)', gap: 1200e3, idle: 60e3 },
};
export const PRANK_GAP = PRANK_RATES.normal.gap;
export const PRANK_IDLE = PRANK_RATES.normal.idle;
// Größe draußen: wie im Zimmer oder kleiner (immer ganzzahlig, damit die Pixel scharf bleiben)
export const SIZES = { room: 'Wie im Zimmer', small: 'Kleiner' };
export const deskScale = (u, size) => (size === 'small' ? Math.max(1, Math.round(u / 2)) : u);

export function deskOptions(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pr = r.pranks && typeof r.pranks === 'object' ? r.pranks : {};
  return {
    mouse: r.mouse !== false,
    sound: r.sound !== false,
    pranks: Object.fromEntries(PRANKS.map((p) => [p.id, pr[p.id] !== false])),
    rate: PRANK_RATES[r.rate] ? r.rate : 'normal',
    size: SIZES[r.size] ? r.size : 'room',
    quietDay: typeof r.quietDay === 'string' ? r.quietDay : '',
  };
}

// quiet: „Heute keine Streiche“ oder „Eine Stunde Ruhe“ gilt gerade
export function prankDue({ now, last = 0, active = 0, reduced = false, rate = 'normal', quiet = false }) {
  const r = PRANK_RATES[rate] || PRANK_RATES.normal;
  return !reduced && !quiet && now - last >= r.gap && now - active >= r.idle;
}

// Strecken [a, b] ohne den Teil [c, d]
export function subtract(segs, c, d) {
  const out = [];
  for (const [a, b] of segs) {
    if (d <= a || c >= b) { out.push([a, b]); continue; }
    if (c > a) out.push([a, c]);
    if (d < b) out.push([d, b]);
  }
  return out;
}

// Eine Fläche wiedererkennen, auch wenn sie neu berechnet wurde
export const surfaceKey = (s) => `${s.id}|${Math.round(s.y)}|${Math.round(s.x1)}`;
const key = surfaceKey;

// Laufflächen: die sichtbaren Teile der Fensteroberkanten und Möbel, dazu der Boden.
//   wins:  [{ id, left, top, right, bottom, z }] sichtbare Fenster (nicht minimiert, nicht maximiert)
//   items: [{ id, left, right, top }] Oberkanten von Möbeln auf dem Desktop (liegen unter allen Fenstern)
// Ein Fenster weiter vorn, das über die Kante reicht, schneidet sie ab.
// minTop: Flächen so weit oben, dass ein Tier darauf aus dem Bild ragen würde, zählen nicht
export function surfaces(wins, { floor, width, items = [], margin = 6, min = 20, minTop = 0 }) {
  const out = [{ id: 'floor', kind: 'floor', y: floor, x1: 0, x2: width }];
  const covered = (segs, y, z) => {
    for (const o of wins) {
      if (o.z <= z || o.top > y || o.bottom < y) continue;
      segs = subtract(segs, o.left, o.right);
    }
    return segs;
  };
  for (const w of wins) {
    if (w.top >= floor - 8 || w.top < minTop) continue;
    for (const [a, b] of covered([[Math.max(0, w.left + margin), Math.min(width, w.right - margin)]], w.top, w.z)) {
      if (b - a >= min) out.push({ id: w.id, kind: 'win', y: w.top, x1: a, x2: b });
    }
  }
  for (const it of items) {
    if (it.top >= floor - 2 || it.top < minTop) continue;
    for (const [a, b] of covered([[it.left, it.right]], it.top, -Infinity)) {
      if (b - a >= min / 2) out.push({ id: it.id, kind: 'item', y: it.top, x1: a, x2: b });
    }
  }
  return out;
}

// Lauffläche genau unter den Füßen (y gleich, x drin)
export function surfaceAt(list, x, y, id = null, tol = 1.5) {
  return list.find((s) => (id === null || s.id === id) && Math.abs(s.y - y) <= tol && x >= s.x1 && x <= s.x2) || null;
}

// Die nächste Lauffläche unter einem Punkt (der Boden fängt immer auf)
export function below(list, x, y, tol = 1) {
  let best = null;
  for (const s of list) {
    if (s.y < y - tol || x < s.x1 || x > s.x2) continue;
    if (!best || s.y < best.y) best = s;
  }
  return best || list.find((s) => s.kind === 'floor') || null;
}

// Fallen, Fliegen, Landen. b: { x, y, vx, vy, skip? }, half: halbe Breite (für die Bildschirmränder), ceil: höchster Fußpunkt
// (oben am Bildschirm prallt es ab). b.skip: Fläche, durch die der Körper hindurch nach unten will (beim Absprung).
// Gibt die Lauffläche zurück, auf der der Körper gelandet ist, sonst null.
export const GRAVITY = 1800;
export function fall(b, dt, list, { width, half = 0, g = GRAVITY, bounce = 0.35, ceil = -400 } = {}) {
  const y0 = b.y;
  b.vy += g * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < half) { b.x = half; b.vx = Math.abs(b.vx) * bounce; }
  if (width && b.x > width - half) { b.x = width - half; b.vx = -Math.abs(b.vx) * bounce; }
  if (b.y < ceil) { b.y = ceil; b.vy = Math.abs(b.vy) * bounce; }
  if (b.vy < 0) return null;
  let hit = null;
  for (const s of list) {
    if (y0 > s.y + 0.5 || b.y < s.y || b.x < s.x1 || b.x > s.x2) continue;
    if (b.skip && key(s) === b.skip) continue;
    if (!hit || s.y < hit.y) hit = s;
  }
  if (!hit) {
    // Nie durch den Boden
    const fl = list.find((s) => s.kind === 'floor');
    if (fl && b.y > fl.y) hit = fl;
  }
  if (hit) { b.y = hit.y; b.skip = null; }
  return hit;
}

// Sprung von a nach b über einen Bogen, der apex über dem höheren Punkt liegt: Startgeschwindigkeit und Dauer
export function jumpTo(a, b, { g = GRAVITY, apex = 30 } = {}) {
  const top = Math.min(a.y, b.y) - apex;
  const up = a.y - top, down = b.y - top;
  const vy = -Math.sqrt(2 * g * up);
  const t = Math.sqrt((2 * up) / g) + Math.sqrt((2 * down) / g);
  return { vx: (b.x - a.x) / t, vy, t };
}

// Wie weit ein Tier springen kann (size: Größe des Tieres in px): hinauf etwa 2,4 Körper, zur Seite 3,
// hinunter beliebig weit (wer runter will, lässt sich fallen)
export const JUMP_UP = 2.4, JUMP_SIDE = 3;
const gapOf = (a, b) => Math.max(0, b.x1 - a.x2, a.x1 - b.x2);
export function canHop(a, b, size) {
  if (a === b) return false;
  const up = a.y - b.y;
  return up <= size * JUMP_UP && gapOf(a, b) <= size * JUMP_SIDE && Math.abs(up) > 2;
}
// Absprung- und Landepunkt für einen Sprung von Fläche a nach Fläche b, ein halbes Tier vom Rand entfernt.
// Nach unten geht es über den näheren Rand von a, damit das Tier nicht durch a hindurch fällt.
export function hopPoints(a, b, size, near = null) {
  const pad = Math.min(size / 2, (b.x2 - b.x1) / 2);
  const clampB = (x) => Math.max(b.x1 + pad, Math.min(b.x2 - pad, x));
  let from = near === null ? (a.x1 + a.x2) / 2 : near;
  if (b.y > a.y) {
    const lo = Math.max(a.x1, b.x1), hi = Math.min(a.x2, b.x2);
    if (lo < hi) {
      // b liegt (teilweise) unter a: über den Rand, der näher liegt und unter dem b weitergeht
      const left = b.x1 < a.x1 - size * 0.4, right = b.x2 > a.x2 + size * 0.4;
      const goLeft = left && (!right || from - a.x1 <= a.x2 - from);
      if (left || right) return { from: goLeft ? a.x1 + 2 : a.x2 - 2, to: clampB(goLeft ? a.x1 - size * 0.6 : a.x2 + size * 0.6) };
    }
  }
  let to = clampB(from);
  const padA = Math.min(size / 3, (a.x2 - a.x1) / 2);
  const take = Math.max(a.x1 + padA, Math.min(a.x2 - padA, to));
  if (Math.abs(take - to) > size * JUMP_SIDE) to = clampB(take);
  return { from: take, to };
}

// Weg von Fläche zu Fläche (Breitensuche über Sprünge): Liste der Flächen ab der nächsten, [] wenn schon da, null wenn unerreichbar
export function route(list, from, to, size) {
  if (!from || !to) return null;
  if (key(from) === key(to)) return [];
  const prev = new Map([[key(from), null]]);
  const queue = [from];
  while (queue.length) {
    const s = queue.shift();
    for (const n of list) {
      const k = key(n);
      if (prev.has(k) || !canHop(s, n, size)) continue;
      prev.set(k, s);
      if (k === key(to)) {
        const path = [n];
        for (let p = s; p && key(p) !== key(from); p = prev.get(key(p))) path.unshift(p);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}
export const sameSurface = (a, b) => !!a && !!b && key(a) === key(b);

// Geschwindigkeit beim Loslassen aus den letzten Zeigerpunkten [{ x, y, t }] (t in ms)
export function throwVelocity(samples, cap = 2400) {
  if (!samples || samples.length < 2) return { vx: 0, vy: 0 };
  const a = samples[0], b = samples[samples.length - 1];
  const k = 1000 / Math.max(16, b.t - a.t);
  const c = (v) => Math.max(-cap, Math.min(cap, v));
  return { vx: c((b.x - a.x) * k), vy: c((b.y - a.y) * k) };
}
export const HARD_THROW = 1500;     // ab dieser Wurfgeschwindigkeit ist das Tier beleidigt
