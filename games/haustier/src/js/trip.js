// Ausflüge, Fähigkeiten und der Tageswettbewerb: reine Regeln, die das Spiel und der Server (src/pixelpfoten.js)
// gemeinsam nutzen.
//
// Ein Ausflug ist ein kurzes Lauf-Minispiel: Das Tier läuft von selbst nach rechts, Tippen oder die Leertaste lässt
// es springen. Hindernisse überspringen, Leckerli und Münzen einsammeln, an Schnüffelstellen etwas finden.
// Die Strecke entsteht aus einem Startwert (seed), deshalb läuft beim Wettbewerb an einem Tag jeder dieselbe.
// stepRun() rechnet einen Schritt der Bewegung, damit sich der Lauf ohne Browser testen lässt (run.js zeichnet ihn).
import { level, doAction, walkItem } from './pets.js';
import { ITEMS, usableBy } from './items.js';
import { dayKey } from './state.js';
import { addCoins } from './economy.js';

// ---------- Fähigkeiten ----------
// Jedes Tier hat drei Fähigkeiten, Stufe 1 bis 10. Erfahrung gibt es bei Ausflügen und im Wettbewerb.
export const SKILLS = [
  { key: 'speed', label: 'Tempo', icon: '💨', text: 'läuft schneller und kommt nach dem Stolpern schneller wieder in Fahrt' },
  { key: 'jump', label: 'Sprungkraft', icon: '🦘', text: 'springt höher und weiter, ab Stufe 4 auch ein zweites Mal in der Luft' },
  { key: 'nose', label: 'Spürnase', icon: '👃', text: 'sammelt aus größerem Abstand ein und findet mehr an Schnüffelstellen' },
];
export const SKILL_XP = [0, 20, 50, 90, 140, 200, 270, 350, 440, 540];
export const DOUBLE_JUMP_LEVEL = 4;
// Worin eine Tierart besonders gut ist: diese Fähigkeit lernt sie 25 % schneller
export const TALENT = { dog: 'speed', cat: 'jump', rabbit: 'jump', hamster: 'nose', rat: 'nose', fox: 'nose', axolotl: 'speed', dragon: 'jump' };

export const skillXp = (pet, key) => (pet.skills && pet.skills[key]) || 0;

export function skillLevel(pet, key) {
  const xp = skillXp(pet, key);
  let l = 1;
  while (l < SKILL_XP.length && xp >= SKILL_XP[l]) l++;
  return l;
}

// Fortschritt innerhalb der Stufe als { have, need } (need = null auf der höchsten Stufe)
export function skillProgress(pet, key) {
  const l = skillLevel(pet, key), xp = skillXp(pet, key);
  if (l >= SKILL_XP.length) return { have: 0, need: null };
  return { have: xp - SKILL_XP[l - 1], need: SKILL_XP[l] - SKILL_XP[l - 1] };
}

// Erfahrung gutschreiben. gains: { speed, jump, nose }. Gibt die neuen Stufen zurück: [{ key, level }]
export function addSkillXp(pet, gains) {
  pet.skills ||= {};
  const ups = [];
  for (const { key } of SKILLS) {
    const g = Math.round((gains[key] || 0) * (TALENT[pet.species] === key ? 1.25 : 1));
    if (g <= 0) continue;
    const before = skillLevel(pet, key);
    pet.skills[key] = skillXp(pet, key) + g;
    const after = skillLevel(pet, key);
    if (after > before) ups.push({ key, level: after });
  }
  return ups;
}

// ---------- Ausflugsziele und Strecke ----------
//   level:   Zuneigungsstufe, ab der das Ziel offen ist
//   speed:   Faktor auf das Lauftempo, density: wie dicht Hindernisse und Sachen liegen
export const PLACES = {
  park: { name: 'Park', icon: '🌳', level: 1, length: 7000, speed: 1, density: 1, obstacles: ['puddle', 'stone', 'bush'],
    sky: ['#8fd0ff', '#e4f5ff'], hills: '#9ed67a', ground: '#6cbf4a', path: '#d9b77a' },
  forest: { name: 'Wald', icon: '🌲', level: 3, length: 8000, speed: 1.05, density: 1.15, obstacles: ['log', 'stone', 'mushroom'],
    sky: ['#a8d8c0', '#eaf6ea'], hills: '#3f8a4a', ground: '#4f9a3c', path: '#a07a4a' },
  beach: { name: 'Strand', icon: '🏖️', level: 5, length: 8500, speed: 1.1, density: 1.25, obstacles: ['castle', 'crab', 'shell'],
    sky: ['#6cc4f4', '#dff3ff'], hills: '#3fa7d6', ground: '#f0d890', path: '#e6c878' },
  mountains: { name: 'Berge', icon: '⛰️', level: 7, length: 9500, speed: 1.15, density: 1.35, obstacles: ['rock', 'snowman', 'log'],
    sky: ['#9cc0e8', '#f2f6ff'], hills: '#8a98b0', ground: '#e8eef4', path: '#c8d0dc' },
};
// w: Breite, h: Höhe, über die das Tier springen muss
export const OBSTACLES = {
  puddle: { icon: '💧', name: 'Pfütze', w: 64, h: 12 },
  stone: { icon: '🪨', name: 'Stein', w: 40, h: 34 },
  bush: { icon: '🌿', name: 'Busch', w: 44, h: 40 },
  log: { icon: '🪵', name: 'Baumstamm', w: 56, h: 36 },
  mushroom: { icon: '🍄', name: 'Pilz', w: 36, h: 38 },
  castle: { icon: '🏰', name: 'Sandburg', w: 48, h: 48 },
  crab: { icon: '🦀', name: 'Krabbe', w: 40, h: 28 },
  shell: { icon: '🐚', name: 'Muschel', w: 32, h: 24 },
  rock: { icon: '🪨', name: 'Felsen', w: 50, h: 46 },
  snowman: { icon: '☃️', name: 'Schneemann', w: 44, h: 52 },
};
export const PICKUPS = {
  treat: { icon: '🦴', name: 'Leckerli', points: 10 },
  coin: { icon: '🪙', name: 'Münze', points: 5 },
  sniff: { icon: '✨', name: 'Schnüffelstelle', points: 15 },
};
const CLEAR_POINTS = 5, HIT_POINTS = -10, TIME_POINTS = 4;
export const MAX_SNIFFS = 3;

// Bewegung (Pixel und Sekunden)
export const BASE_SPEED = 240;
export const GRAVITY = 2000;
export const JUMP_SPEED = 640;
const START_X = 600;           // Anlauf bis zum ersten Hindernis
const PET_HALF = 18;            // halbe Breite des Tieres für Zusammenstöße
const STUMBLE_MS = 900;

export function placeOpen(pet, id) {
  return !!PLACES[id] && level(pet) >= PLACES[id].level;
}

// Aus einem Text eine Zahl für den Zufall (FNV-1a)
export function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Zufall mit Startwert (mulberry32), liefert immer dieselbe Folge
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Strecke für ein Ziel. Gibt { place, length, things: [{ id, x, kind: 'obstacle'|'pickup', type, y, w, h }] } zurück.
export function course(placeId, seed) {
  const p = PLACES[placeId] || PLACES.park;
  const rng = seeded(typeof seed === 'number' ? seed : seedOf(String(seed)));
  const things = [];
  let x = START_X, id = 0, sniffs = 0;
  const add = (t) => things.push({ id: id++, ...t });
  while (x < p.length - 500) {
    if (rng() < 0.58) {
      const type = p.obstacles[Math.floor(rng() * p.obstacles.length)];
      const o = OBSTACLES[type];
      add({ kind: 'obstacle', type, x, y: 0, w: o.w, h: o.h });
      // Über manchen Hindernissen schwebt ein Leckerli, das man im Sprung erwischt
      if (rng() < 0.4) add({ kind: 'pickup', type: 'treat', x, y: o.h + 50 });
    } else {
      const n = 3 + Math.floor(rng() * 3);
      const type = rng() < 0.55 ? 'treat' : 'coin';
      const arc = rng() < 0.4;
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) : 0.5;
        add({ kind: 'pickup', type, x: x + i * 46, y: arc ? Math.round(Math.sin(k * Math.PI) * 80) : 0 });
      }
      if (sniffs < MAX_SNIFFS && rng() < 0.3) { sniffs++; add({ kind: 'pickup', type: 'sniff', x: x + n * 46 + 60, y: 0 }); }
      x += n * 46;
    }
    x += Math.round((340 + rng() * 380) / p.density);
  }
  return { place: placeId in PLACES ? placeId : 'park', length: p.length, things };
}

// Tageswettbewerb: jeden Tag ein anderes Ziel, für alle dieselbe Strecke
export function contestCourse(day) {
  const ids = Object.keys(PLACES);
  return course(ids[seedOf('ort:' + day) % ids.length], 'wettbewerb:' + day);
}

export const runSpeed = (placeId, speedLevel) => BASE_SPEED * (PLACES[placeId] || PLACES.park).speed * (1 + 0.03 * (speedLevel - 1));
export const jumpSpeed = (jumpLevel) => JUMP_SPEED * (1 + 0.025 * (jumpLevel - 1));
export const pickRadius = (noseLevel) => 38 + 5 * (noseLevel - 1);
// Zeit, die ein Tier mit Tempo 1 ohne Stolpern braucht; wer schneller ist, bekommt Zeitpunkte
export const parTime = (c) => c.length / runSpeed(c.place, 1);

// Ein neuer Lauf. levels: { speed, jump, nose }
export function newRun(c, levels = {}) {
  const lv = { speed: 1, jump: 1, nose: 1, ...levels };
  return {
    t: 0, x: 0, y: 0, vy: 0, airJumps: 0, slowUntil: 0, done: false, lv,
    treat: 0, coin: 0, sniff: 0, cleared: 0, hits: 0, jumps: 0, taken: new Set(), passed: new Set(),
  };
}

// Einen Schritt weiterrechnen. dt in Sekunden, jump: in diesem Schritt wurde gedrückt.
// Gibt Ereignisse zurück: { type: 'jump' | 'pickup' | 'clear' | 'hit' | 'finish', thing? }
export function stepRun(r, c, dt, jump = false) {
  const ev = [];
  if (r.done) return ev;
  dt = Math.min(dt, 0.05);
  if (jump) {
    if (r.y <= 0) { r.vy = jumpSpeed(r.lv.jump); r.airJumps = r.lv.jump >= DOUBLE_JUMP_LEVEL ? 1 : 0; r.jumps++; ev.push({ type: 'jump' }); }
    else if (r.airJumps > 0) { r.airJumps--; r.vy = jumpSpeed(r.lv.jump) * 0.85; r.jumps++; ev.push({ type: 'jump', air: true }); }
  }
  r.t += dt;
  const slow = r.t * 1000 < r.slowUntil ? 0.45 + 0.03 * (r.lv.speed - 1) : 1;
  r.x += runSpeed(c.place, r.lv.speed) * slow * dt;
  if (r.y > 0 || r.vy > 0) {
    r.y += r.vy * dt;
    r.vy -= GRAVITY * dt;
    if (r.y <= 0) { r.y = 0; r.vy = 0; }
  }
  const reach = pickRadius(r.lv.nose);
  for (const t of c.things) {
    if (t.x > r.x + 120) break;
    if (t.kind === 'obstacle') {
      if (r.passed.has(t.id)) continue;
      const near = Math.abs(t.x - r.x) < t.w / 2 + PET_HALF;
      if (near && r.y < t.h - 4) {
        r.passed.add(t.id); r.hits++;
        r.slowUntil = r.t * 1000 + STUMBLE_MS;
        ev.push({ type: 'hit', thing: t });
      } else if (r.x - PET_HALF > t.x + t.w / 2) {
        r.passed.add(t.id); r.cleared++;
        ev.push({ type: 'clear', thing: t });
      }
    } else if (!r.taken.has(t.id) && Math.hypot(t.x - r.x, t.y + 20 - (r.y + 35)) < reach) {
      r.taken.add(t.id); r[t.type]++;
      ev.push({ type: 'pickup', thing: t });
    }
  }
  if (r.x >= c.length) { r.done = true; ev.push({ type: 'finish' }); }
  return ev;
}

// Zeitpunkte gibt es erst im Ziel
export function timeBonus(r, c) {
  if (!r.done) return 0;
  return Math.max(0, Math.round((parTime(c) - r.t) * TIME_POINTS));
}

export function scoreOf(r, c) {
  const s = r.treat * PICKUPS.treat.points + r.coin * PICKUPS.coin.points + r.sniff * PICKUPS.sniff.points
    + r.cleared * CLEAR_POINTS + r.hits * HIT_POINTS + timeBonus(r, c);
  return Math.max(0, s);
}

// Mehr Punkte kann auf dieser Strecke niemand holen (prüft der Server bei Wettbewerbsergebnissen)
export function maxScore(c) {
  let s = 0;
  for (const t of c.things) s += t.kind === 'obstacle' ? CLEAR_POINTS : PICKUPS[t.type].points;
  const fastest = c.length / runSpeed(c.place, SKILL_XP.length);
  return s + Math.ceil((parTime(c) - fastest) * TIME_POINTS) + 1;
}

// Erfahrung für die Fähigkeiten aus einem Lauf
export function runGains(r) {
  return {
    speed: 6 + (r.hits === 0 ? 6 : 0) + Math.min(6, Math.floor(r.cleared / 3)),
    jump: r.cleared * 2,
    nose: r.treat + r.coin + r.sniff * 4,
  };
}

// ---------- Ausrüstung ----------
// Gassi und Ausflüge brauchen Ausrüstung (Leine, Laufball, Geschirr, Reiseglas); Drachen fliegen einfach los.
export const canTrip = (state, pet) => !!walkItem(state, pet.species);

// ---------- Ausflug ----------
export const TRIP_COIN_CAP = 30;

// Ausflug beendet: Wirkung wie Gassi (Pflege, Wartezeit, Zuneigung), dazu Münzen, Leckerli, Funde und Fähigkeiten.
// Gibt { ok, action, coins, finds, gains, ups, score } zurück (action: Ergebnis von doAction, coins: eingesammelte
// Münzen; Münzen von Schnüffelstellen stehen in finds).
export function finishTrip(state, pet, r, c, now = Date.now(), rng = Math.random) {
  const action = doAction(pet, 'walk', state, now, { rng });
  if (!action.ok) return { ok: false, action };
  const coins = addCoins(state, Math.min(TRIP_COIN_CAP, r.coin * 2));
  if (r.treat) {
    const before = pet.stats.food;
    pet.stats.food = Math.min(100, before + Math.min(15, r.treat));
    action.delta.food = (action.delta.food || 0) + Math.round(pet.stats.food - before);
  }
  const finds = [];
  const foods = Object.values(ITEMS).filter((x) => x.cat === 'food' && !x.req && usableBy(x, pet.species));
  for (let i = 0; i < Math.min(MAX_SNIFFS, r.sniff); i++) {
    if (rng() < 0.5) { const n = 3 + Math.floor(rng() * 6); addCoins(state, n); finds.push({ coins: n }); }
    else { const id = foods[Math.floor(rng() * foods.length)].id; state.inventory[id] = (state.inventory[id] || 0) + 1; finds.push({ item: id }); }
  }
  const gains = runGains(r);
  const ups = addSkillXp(pet, gains);
  return { ok: true, action, coins, finds, gains, ups, score: scoreOf(r, c) };
}

// ---------- Tageswettbewerb ----------
export const CONTEST_COST = { rest: -6, food: -3, water: -4 };
export const CONTEST_COINS = 15;        // fürs erste Mitmachen am Tag
export const PRIZES = [100, 60, 40];     // für Platz 1 bis 3 am Vortag

export function canContest(state, pet) {
  if (!canTrip(state, pet)) return { ok: false, reason: 'Dafür braucht dein Tier Ausrüstung für Ausflüge (im Shop unter Pflege).' };
  if (pet.sleeping) return { ok: false, reason: `${pet.name} schläft gerade.` };
  if (pet.stats.rest < 20) return { ok: false, reason: `${pet.name} ist zu müde für den Wettbewerb.` };
  return { ok: true };
}

// Wettbewerbslauf beendet. Gibt { score, best, newBest, coins, gains, ups, delta } zurück.
export function finishContest(state, pet, r, c, now = Date.now()) {
  const day = dayKey(now);
  const delta = {};
  for (const [k, v] of Object.entries(CONTEST_COST)) {
    const before = pet.stats[k];
    pet.stats[k] = Math.max(0, before + v);
    delta[k] = Math.round(pet.stats[k] - before);
  }
  if (!state.contest || state.contest.day !== day) state.contest = { day, best: 0, pet: null, runs: 0, paid: false };
  const ct = state.contest;
  const score = scoreOf(r, c);
  const newBest = score > ct.best;
  if (newBest) { ct.best = score; ct.pet = pet.id; }
  ct.runs++;
  let coins = 0;
  if (!ct.paid) { ct.paid = true; coins = addCoins(state, CONTEST_COINS); }
  const g = runGains(r);
  const gains = { speed: Math.ceil(g.speed / 2), jump: Math.ceil(g.jump / 2), nose: Math.ceil(g.nose / 2) };
  const ups = addSkillXp(pet, gains);
  return { score, best: ct.best, newBest, coins, gains, ups, delta };
}

// Preis für einen Platz auf dem Treppchen abholen (einmal je Tag). Gibt die Münzen zurück (0 = nichts zu holen).
export function claimPrize(state, day, place, petName = '') {
  if (!(place >= 1 && place <= PRIZES.length)) return 0;
  state.trophies ||= [];
  if (state.trophies.some((t) => t.day === day)) return 0;
  state.trophies.push({ day, place, pet: String(petName).slice(0, 20) });
  return addCoins(state, PRIZES[place - 1]);
}

export const TROPHY = ['🥇', '🥈', '🥉'];
