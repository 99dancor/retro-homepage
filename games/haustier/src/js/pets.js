// Tiere, Statuswerte und Pflege: reine Funktionen, damit sie unter Node testbar sind.
// Alle Werte laufen von 0 bis 100. Die Zeit läuft auch weiter, während niemand spielt.
import { ITEMS, usableBy, isFav, owned } from './items.js';

export const STATS = [
  { key: 'love', label: 'Liebe', icon: '❤️' },
  { key: 'fun', label: 'Spaß', icon: '🎾' },
  { key: 'food', label: 'Nahrung', icon: '🍖' },
  { key: 'water', label: 'Wasser', icon: '💧' },
  { key: 'rest', label: 'Ruhe', icon: '💤' },
  { key: 'joy', label: 'Erfüllung', icon: '⭐' },
];
const NEEDS = ['love', 'fun', 'food', 'water', 'rest'];

// needs: Faktor auf das Absinken einzelner Werte (1 = normal)
// unlock: Besondere Tiere schaltet eine Besuchsserie frei (beste Serie zählt, bleibt also freigeschaltet)
export const SPECIES = {
  cat: {
    name: 'Katze', icon: '🐱', sound: 'schnurrt zufrieden', hint: 'Unabhängig, braucht etwas weniger Aufmerksamkeit.',
    needs: { love: 0.7 }, names: ['Mimi', 'Luna', 'Felix', 'Minka', 'Tiger'],
    colors: [
      { id: 'ginger', name: 'Rot getigert', main: '#e8a050', belly: '#f8e0c0', accent: '#f4a0a8' },
      { id: 'black', name: 'Schwarz', main: '#3c3c44', belly: '#5c5c66', accent: '#d88090', eye: '#e8c840', faceLine: '#e4e4ec' },
      { id: 'grey', name: 'Grau', main: '#9aa0a8', belly: '#dde0e4', accent: '#f4a0a8' },
    ],
  },
  dog: {
    name: 'Hund', icon: '🐶', sound: 'wedelt mit dem Schwanz', hint: 'Verspielt, will viel beschäftigt werden.',
    needs: { fun: 1.3 }, names: ['Bello', 'Luna', 'Rex', 'Balu', 'Sammy'],
    colors: [
      { id: 'brown', name: 'Braun', main: '#b07840', belly: '#f0d8b0', accent: '#7a4f28' },
      { id: 'spotted', name: 'Weiß-Schwarz', main: '#f4f4f4', belly: '#ffffff', accent: '#3a3a3a' },
      { id: 'golden', name: 'Golden', main: '#e0b060', belly: '#f8e8c0', accent: '#c08a40' },
    ],
  },
  rabbit: {
    name: 'Kaninchen', icon: '🐰', sound: 'mümmelt glücklich', hint: 'Frisst gern und viel.',
    needs: { food: 1.2 }, names: ['Hoppel', 'Flocke', 'Möhrchen', 'Stups', 'Lotte'],
    colors: [
      { id: 'white', name: 'Weiß', main: '#f6f6f6', belly: '#ffffff', accent: '#f4a0b4' },
      { id: 'grey', name: 'Grau', main: '#a8a8a8', belly: '#e2e2e2', accent: '#f4a0b4' },
      { id: 'brown', name: 'Braun', main: '#a0784f', belly: '#e8d4bc', accent: '#f0b0b8' },
    ],
  },
  hamster: {
    name: 'Hamster', icon: '🐹', sound: 'quiekt vergnügt', hint: 'Klein, aber hat immer Hunger.',
    needs: { food: 1.3, water: 0.8 }, names: ['Krümel', 'Pünktchen', 'Nugget', 'Erdnuss', 'Bommel'],
    colors: [
      { id: 'gold', name: 'Goldbraun', main: '#e0a860', belly: '#fbefd8', accent: '#f4a0a8' },
      { id: 'white', name: 'Weiß', main: '#f4f0ea', belly: '#ffffff', accent: '#f4a0a8' },
      { id: 'grey', name: 'Grau', main: '#b0a8a0', belly: '#ece6e0', accent: '#f4a0a8' },
    ],
  },
  rat: {
    name: 'Ratte', icon: '🐭', sound: 'putzt sich zufrieden', hint: 'Schlau und neugierig, langweilt sich schnell.',
    needs: { fun: 1.2 }, names: ['Ratatouille', 'Pip', 'Fips', 'Nala', 'Socke'],
    colors: [
      { id: 'white', name: 'Weiß', main: '#f4f4f0', belly: '#ffffff', accent: '#f0a0b0' },
      { id: 'grey', name: 'Grau', main: '#8c8c92', belly: '#d8d8dc', accent: '#f0a0b0' },
      { id: 'hooded', name: 'Schwarz-Weiß', main: '#44444e', belly: '#f0f0f0', accent: '#f0a0b0', faceLine: '#e4e4ec' },
    ],
  },
  fox: {
    name: 'Fuchs', icon: '🦊', sound: 'keckert fröhlich', hint: 'Besonders: verspielt und anhänglich.',
    needs: { fun: 1.2, love: 1.1 }, names: ['Foxi', 'Rubin', 'Ginger', 'Flinn', 'Kira'],
    unlock: { best: 3 },
    colors: [
      { id: 'red', name: 'Rotfuchs', main: '#e07030', belly: '#ffffff', accent: '#2e2420' },
      { id: 'arctic', name: 'Polarfuchs', main: '#e8eef4', belly: '#ffffff', accent: '#8a96a6' },
      { id: 'silver', name: 'Silberfuchs', main: '#6e737c', belly: '#e8e8e8', accent: '#2a2a30' },
    ],
  },
  axolotl: {
    name: 'Axolotl', icon: '🦎', sound: 'wedelt mit den Kiemen', hint: 'Besonders: braucht vor allem Wasser.',
    needs: { water: 1.5, fun: 0.8 }, names: ['Axel', 'Lotti', 'Blubb', 'Perle', 'Koralle'],
    unlock: { best: 7 },
    colors: [
      { id: 'pink', name: 'Rosa', main: '#f8b4c8', belly: '#fcd8e2', accent: '#e0607e' },
      { id: 'gold', name: 'Gold', main: '#f4d070', belly: '#fae8b0', accent: '#e09a30' },
      { id: 'wild', name: 'Wildfarben', main: '#7a8a68', belly: '#a8b898', accent: '#4a5a3c' },
    ],
  },
  dragon: {
    name: 'Drache', icon: '🐲', sound: 'brummt und pustet kleine Rauchwölkchen', hint: 'Besonders: frisst viel und schläft gern.',
    needs: { food: 1.4, rest: 1.2 }, names: ['Smaragd', 'Funke', 'Glut', 'Nebel', 'Zacke'],
    unlock: { best: 14 },
    colors: [
      { id: 'green', name: 'Grün', main: '#5cb85c', belly: '#d8f0a0', accent: '#f0e0a0' },
      { id: 'purple', name: 'Lila', main: '#9a6ad0', belly: '#e8d8ff', accent: '#f8d870' },
      { id: 'blue', name: 'Blau', main: '#4a90d0', belly: '#cfe8ff', accent: '#f0f0f0' },
    ],
  },
};

// ---------- Tierplätze und Zuneigungsstufen ----------
// Platz 2: ein Tier auf Zuneigungsstufe 5. Platz 3: im Shop für Münzen.
export const MAX_PETS = 3;
export const SLOT_LEVEL = 5;

// Gesamte Erfahrung, ab der eine Stufe erreicht ist (Stufe 1 bis 10). Sie sinkt nie.
export const LEVEL_XP = [0, 30, 80, 150, 250, 380, 540, 730, 950, 1200];
const ACTION_XP = { pet: 2, cuddle: 4, feed: 2, water: 1, play: 3, sleep: 1, brush: 3, bath: 3, walk: 5 };

export function level(pet) {
  let l = 1;
  while (l < LEVEL_XP.length && pet.xp >= LEVEL_XP[l]) l++;
  return l;
}

// Fortschritt innerhalb der Stufe als { have, need } (need = null auf der höchsten Stufe)
export function levelProgress(pet) {
  const l = level(pet);
  if (l >= LEVEL_XP.length) return { have: 0, need: null };
  return { have: pet.xp - LEVEL_XP[l - 1], need: LEVEL_XP[l] - LEVEL_XP[l - 1] };
}

export const maxLevel = (state) => state.pets.reduce((m, p) => Math.max(m, level(p)), 0);

export function isUnlocked(speciesId, state) {
  const u = SPECIES[speciesId].unlock;
  return !u || state.visits.best >= u.best;
}

export function unlockText(speciesId) {
  const u = SPECIES[speciesId].unlock;
  return u ? `Ab ${u.best} Tagen in Folge` : '';
}

export function petSlots(state) {
  const byLevel = state.pets.some((p) => level(p) >= SLOT_LEVEL) ? 1 : 0;
  return Math.min(MAX_PETS, 1 + byLevel + (state.extraSlots || 0));
}

// Hinweis, wie man den nächsten Platz bekommt, oder null
export function nextSlotHint(state) {
  if (petSlots(state) >= MAX_PETS) return null;
  const hints = [];
  if (!state.pets.some((p) => level(p) >= SLOT_LEVEL)) hints.push(`Bring ein Tier auf Zuneigungsstufe ${SLOT_LEVEL}`);
  if (!state.extraSlots) hints.push(`kaufe einen Tierplatz im Shop`);
  return hints.join(' oder ') + '.';
}

let idCounter = 0;
export function newPet(speciesId, colorId, name, now = Date.now()) {
  const sp = SPECIES[speciesId];
  const color = sp.colors.find((c) => c.id === colorId) ? colorId : sp.colors[0].id;
  return {
    id: `p${now.toString(36)}${(idCounter++).toString(36)}`,
    species: speciesId, color, name: cleanName(name) || sp.names[0], adoptedAt: now,
    stats: { love: 30, fun: 60, food: 60, water: 60, rest: 80, joy: 40 },
    sleeping: false, tickAt: now, fatigue: {}, xp: 0, cooldowns: {}, acc: {},
  };
}

export function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
}

// ---------- Zeit ----------
// Absinken pro Stunde, wach und schlafend. Ruhe steigt im Schlaf.
const RATE_AWAKE = { food: 3.5, water: 4.5, fun: 3, rest: 2, love: 0.5 };
const RATE_ASLEEP = { food: 1.5, water: 2, fun: 0.5, rest: -30, love: 0.2 };
export const FLOOR = 10;      // durch Zeit allein sinkt kein Wert unter 10
const JOY_PULL = 0.08;        // Erfüllung nähert sich pro Stunde um 8 % dem Durchschnitt der anderen Werte
const FATIGUE_RECOVER = 4;    // so viele "Wiederholungen" baut ein Tier pro Stunde wieder ab
const STEP_MS = 10 * 60 * 1000;

const clamp = (v) => Math.max(0, Math.min(100, v));

function step(pet, hours, sp, opts) {
  const s = pet.stats;
  const rate = pet.sleeping ? RATE_ASLEEP : RATE_AWAKE;
  for (const k of NEEDS) {
    let r = rate[k];
    if (r > 0) {
      r *= (sp.needs && sp.needs[k]) || 1;
      if (k === 'rest' && opts.bed) r *= 0.8;
      // Hungrige oder durstige Tiere fühlen sich schneller vernachlässigt
      if (k === 'love' && (s.food < 20 || s.water < 20)) r *= 2;
      if (s[k] > FLOOR) s[k] = Math.max(FLOOR, s[k] - r * hours);
    } else {
      s[k] = clamp(s[k] - r * hours);
    }
  }
  const mean = NEEDS.reduce((a, k) => a + s[k], 0) / NEEDS.length;
  s.joy = clamp(s.joy + (mean - s.joy) * Math.min(1, JOY_PULL * hours));
  if (pet.sleeping && s.rest >= 100) pet.sleeping = false;
  else if (!pet.sleeping && s.rest <= FLOOR) pet.sleeping = true; // schläft vor Erschöpfung von selbst ein
  for (const k of Object.keys(pet.fatigue)) {
    pet.fatigue[k] = Math.max(0, pet.fatigue[k] - FATIGUE_RECOVER * hours);
    if (pet.fatigue[k] === 0) delete pet.fatigue[k];
  }
}

// Bringt ein Tier auf den Stand von "now". Gibt die vergangenen Stunden zurück.
//   opts.bed: Körbchen vorhanden (Ruhe sinkt langsamer)
export function tickPet(pet, now = Date.now(), opts = {}) {
  const sp = SPECIES[pet.species];
  const from = pet.tickAt || now;
  if (now <= from) { pet.tickAt = Math.max(from, now); return 0; }
  let t = from;
  while (t < now) {
    const dt = Math.min(STEP_MS, now - t);
    step(pet, dt / 3600000, sp, opts);
    t += dt;
  }
  pet.tickAt = now;
  return (now - from) / 3600000;
}

export const tickOpts = (state) => ({ bed: owned(state, 'care_bed') });

export function tickAll(state, now = Date.now()) {
  let away = 0;
  const opts = tickOpts(state);
  for (const p of state.pets) away = Math.max(away, tickPet(p, now, opts));
  return away;
}

// ---------- Stimmung ----------
const NEED_TEXT = {
  food: ['hungrig', 'hat Hunger'], water: ['durstig', 'hat Durst'], fun: ['gelangweilt', 'langweilt sich'],
  rest: ['müde', 'ist müde'], love: ['einsam', 'fühlt sich einsam'],
};

export function mood(pet) {
  const s = pet.stats;
  if (pet.sleeping) return { face: 'sleep', key: 'sleep', label: 'schläft', text: `${pet.name} schläft tief und fest.` };
  const lowest = NEEDS.reduce((a, k) => (s[k] < s[a] ? k : a), NEEDS[0]);
  if (s[lowest] < 25) return { face: 'sad', key: lowest, label: NEED_TEXT[lowest][0], text: `${pet.name} ${NEED_TEXT[lowest][1]}.` };
  const avg = (NEEDS.reduce((a, k) => a + s[k], 0) + s.joy) / (NEEDS.length + 1);
  if (avg >= 70) return { face: 'happy', key: 'happy', label: 'glücklich', text: `${pet.name} ist rundum glücklich!` };
  if (s[lowest] < 45) return { face: 'ok', key: lowest, label: NEED_TEXT[lowest][0], text: `${pet.name} ${NEED_TEXT[lowest][1]} – ein bisschen zumindest.` };
  return { face: 'ok', key: 'ok', label: 'zufrieden', text: `${pet.name} ist zufrieden.` };
}

// ---------- Aktionen ----------
export const CUDDLE_LOVE = 70;
export const CUDDLE_LEVEL = 3;
const H = 3600000;

// effect: Grundwirkung (bei Futter und Spielzeug kommt die Wirkung des Gegenstands dazu)
// tiring: wiederholt sich die Aktion schnell, wirkt sie schwächer
// wait: echte Wartezeit bis zur nächsten Benutzung (wird gespeichert)
// item: wählt einen Gegenstand aus dem Inventar
export const ACTIONS = {
  pet: { label: 'Streicheln', icon: '✋', cooldown: 1500, tiring: true, effect: { love: 6, fun: 2, joy: 1 } },
  cuddle: { label: 'Kuscheln', icon: '🤗', cooldown: 4000, tiring: true, effect: { love: 10, rest: 4, joy: 3 } },
  feed: { label: 'Füttern', icon: '🍖', cooldown: 1500, item: 'food', effect: { joy: 1 } },
  water: { label: 'Wasser geben', icon: '💧', cooldown: 2000, effect: { water: 40 } },
  play: { label: 'Spielen', icon: '🎾', cooldown: 3000, tiring: true, item: 'toy', effect: { love: 3, rest: -5, food: -4, water: -4, joy: 2 } },
  brush: { label: 'Bürsten', icon: '🪮', cooldown: 2000, wait: 2 * H, needs: 'care_brush', effect: { love: 8, joy: 2 } },
  bath: { label: 'Baden', icon: '🛁', cooldown: 2000, wait: 24 * H, needs: 'care_soap', effect: { joy: 10, love: -3 } },
  walk: { label: 'Gassi gehen', icon: '🦮', cooldown: 2000, wait: 4 * H, effect: { fun: 20, rest: -10, love: 2, joy: 2 } },
  sleep: { label: 'Schlafen legen', icon: '🛏️', cooldown: 1000, effect: {} },
  wake: { label: 'Aufwecken', icon: '⏰', cooldown: 1000, effect: {} },
};

// Gassi mit Leine (Hund, Fuchs), Ausflug im Laufball (Hamster, Ratte)
export function walkItem(state, species) {
  return ['care_leash', 'care_runball'].find((id) => owned(state, id) && usableBy(ITEMS[id], species)) || null;
}
export const walkLabel = (species) => (['hamster', 'rat'].includes(species) ? 'Ausflug' : 'Gassi gehen');

// Welche Aktionen das Tier überhaupt anbietet (ohne passende Ausrüstung bleiben Bürsten, Baden und Gassi weg)
export function availableActions(pet, state) {
  if (pet.sleeping) return ['wake'];
  const list = ['pet', 'cuddle', 'feed', 'water', 'play'];
  if (owned(state, 'care_brush')) list.push('brush');
  if (owned(state, 'care_soap') || pet.cooldowns.bath > Date.now()) list.push('bath');
  if (walkItem(state, pet.species)) list.push('walk');
  list.push('sleep');
  return list;
}

// Futter und Spielzeug im Inventar, die dieses Tier benutzen kann (Lieblingssachen zuerst)
export function usableItems(state, pet, cat) {
  return Object.keys(state.inventory)
    .filter((id) => ITEMS[id] && ITEMS[id].cat === cat && state.inventory[id] > 0 && usableBy(ITEMS[id], pet.species))
    .sort((a, b) => isFav(ITEMS[b], pet.species) - isFav(ITEMS[a], pet.species) || ITEMS[a].price - ITEMS[b].price);
}

export function waitText(ms) {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} Std ${r} Min` : `${h} Std`;
}

// Darf die Aktion gerade ausgeführt werden? { ok, reason }. itemId: gewähltes Futter oder Spielzeug
export function canDo(pet, action, state, itemId = null, now = Date.now()) {
  const s = pet.stats, n = pet.name, a = ACTIONS[action];
  if (!a) return { ok: false, reason: '?' };
  if (action === 'wake') return pet.sleeping ? { ok: true } : { ok: false, reason: `${n} ist wach.` };
  if (pet.sleeping) return { ok: false, reason: `${n} schläft gerade. Psst!` };
  if (a.wait && pet.cooldowns[action] > now) return { ok: false, reason: `${a.label}: wieder möglich in ${waitText(pet.cooldowns[action] - now)}.` };
  if (a.needs && !owned(state, a.needs)) return { ok: false, reason: `Dafür brauchst du: ${ITEMS[a.needs].name} (im Shop).` };
  if (a.item) {
    const items = usableItems(state, pet, a.item);
    if (!items.length) return { ok: false, reason: a.item === 'food' ? `Du hast kein Futter für ${n}. Schau im Shop vorbei!` : `Du hast kein Spielzeug für ${n}.` };
    if (itemId && !items.includes(itemId)) return { ok: false, reason: `${n} kann damit nichts anfangen.` };
  }
  switch (action) {
    case 'cuddle':
      if (level(pet) < CUDDLE_LEVEL) return { ok: false, reason: `Kuscheln geht ab Zuneigungsstufe ${CUDDLE_LEVEL}. ${n} ist auf Stufe ${level(pet)}.` };
      return s.love >= CUDDLE_LOVE ? { ok: true } : { ok: false, reason: `${n} ist gerade nicht zum Kuscheln aufgelegt. Ab ${CUDDLE_LOVE} Liebe geht es.` };
    case 'feed': {
      // Abgelehnt wird nur, wenn alles, was das Futter auffüllt, schon voll ist
      const eff = itemId ? ITEMS[itemId].effect : { food: 1 };
      const fills = Object.keys(eff).filter((k) => eff[k] > 0 && k !== 'joy' && k !== 'love');
      return fills.some((k) => s[k] < 95) ? { ok: true } : { ok: false, reason: `${n} ist satt.` };
    }
    case 'water': return s.water < 95 ? { ok: true } : { ok: false, reason: `${n} hat keinen Durst.` };
    case 'play': return s.rest >= 15 ? { ok: true } : { ok: false, reason: `${n} ist zu müde zum Spielen.` };
    case 'walk':
      if (!walkItem(state, pet.species)) return { ok: false, reason: `Dafür brauchst du eine Leine oder einen Laufball.` };
      return s.rest >= 20 ? { ok: true } : { ok: false, reason: `${n} ist zu müde für einen Ausflug.` };
    case 'sleep': return s.rest < 80 ? { ok: true } : { ok: false, reason: `${n} ist noch gar nicht müde.` };
    default: return { ok: true };
  }
}

// Führt eine Aktion aus (vorher tickPet aufrufen). Gibt { ok, text, delta, factor, xp, levelUp, fav, found } zurück.
//   itemId: Futter oder Spielzeug (sonst das erste passende)
//   rng:    Zufall für Fundstücke beim Gassi (für Tests austauschbar)
export function doAction(pet, action, state, now = Date.now(), { itemId = null, rng = Math.random } = {}) {
  const check = canDo(pet, action, state, itemId, now);
  if (!check.ok) return { ok: false, text: check.reason, delta: {} };
  const a = ACTIONS[action], sp = SPECIES[pet.species], n = pet.name;
  if (a.item && !itemId) itemId = usableItems(state, pet, a.item)[0];
  const item = itemId ? ITEMS[itemId] : null;
  const fav = !!item && isFav(item, pet.species);
  const fKey = action === 'play' ? 'play:' + itemId : action;   // jedes Spielzeug ermüdet für sich
  const reps = a.tiring ? pet.fatigue[fKey] || 0 : 0;
  const factor = a.tiring ? Math.max(0.2, 1 - 0.15 * reps) : 1;

  const effect = { ...a.effect };
  if (item && item.effect) for (const [k, v] of Object.entries(item.effect)) effect[k] = (effect[k] || 0) + (fav && v > 0 ? v * 1.5 : v);
  const delta = {};
  for (const [k, v] of Object.entries(effect)) {
    const before = pet.stats[k];
    // Nur das Gute lässt nach, der Aufwand (z. B. Ruhe beim Spielen) bleibt gleich
    pet.stats[k] = clamp(before + (v > 0 ? v * factor : v));
    delta[k] = Math.round(pet.stats[k] - before);
  }
  if (a.tiring) pet.fatigue[fKey] = reps + 1;
  if (a.wait) pet.cooldowns[action] = now + a.wait;
  if (item && (item.cat === 'food' || item.consumable)) state.inventory[itemId] -= 1;
  if (a.needs && ITEMS[a.needs].consumable) state.inventory[a.needs] -= 1;
  for (const k of Object.keys(state.inventory)) if (state.inventory[k] <= 0) delete state.inventory[k];
  pet.tickAt = now;

  const before = level(pet);
  const xp = Math.round((ACTION_XP[action] || 0) * factor);
  pet.xp += xp;
  const levelUp = level(pet) > before ? level(pet) : null;

  let text, found = null;
  const it = item ? item.name : '';
  switch (action) {
    case 'pet': text = factor < 0.5 ? `${n} hat erstmal genug gestreichelt.` : `${n} ${sp.sound}.`; break;
    case 'cuddle': text = factor < 0.5 ? `${n} möchte gerade lieber etwas Abstand.` : `${n} kuschelt sich ganz fest an dich.`; break;
    case 'feed': text = fav ? `${it}! ${n} liebt das über alles.` : `${n} frisst genüsslich: ${it}.`; break;
    case 'water': text = `${n} trinkt ein paar Schlucke.`; break;
    case 'play':
      text = factor < 0.5 ? `${n} hat vom ${it} erstmal genug. Wie wär's mit etwas anderem?`
        : fav ? `${it}! ${n} ist ganz aus dem Häuschen.` : `${n} spielt begeistert: ${it}.`;
      break;
    case 'brush': text = `${n} glänzt jetzt richtig schön.`; break;
    case 'bath': text = `${n} ist blitzsauber, aber ein bisschen beleidigt.`; break;
    case 'walk': {
      const r = rng();
      if (r < 0.3) found = { coins: 5 + Math.floor(rng() * 11) };
      else if (r < 0.5) {
        const foods = Object.values(ITEMS).filter((x) => x.cat === 'food' && !x.req && usableBy(x, pet.species));
        found = { item: foods[Math.floor(rng() * foods.length)].id };
      }
      const where = walkLabel(pet.species) === 'Ausflug' ? 'vom Ausflug' : 'vom Spaziergang';
      text = found ? `${n} kommt ${where} zurück und hat etwas gefunden!` : `${n} kommt glücklich ${where} zurück.`;
      if (found && found.item) state.inventory[found.item] = (state.inventory[found.item] || 0) + 1;
      break;
    }
    case 'sleep': pet.sleeping = true; text = `${n} rollt sich ein und schläft ein. Gute Nacht!`; break;
    case 'wake': {
      pet.sleeping = false;
      if (pet.stats.rest < 50) { pet.stats.love = clamp(pet.stats.love - 3); delta.love = -3; text = `${n} ist noch ganz verschlafen und etwas grummelig.`; }
      else text = `${n} streckt sich und ist wach.`;
      break;
    }
  }
  return { ok: true, text, delta, factor, xp, levelUp, fav, found, itemId };
}

// Startausstattung: ein Ball und 5 × Trockenfutter
export function starterInventory(state) {
  state.inventory = state.inventory || {};
  if (!state.starterGiven) {
    state.inventory.toy_ball = 1;
    state.inventory.food_dry = (state.inventory.food_dry || 0) + 5;
    state.inventory.room_living = 1;
    state.starterGiven = true;
  }
}

export function adopt(state, speciesId, colorId, name, now = Date.now()) {
  if (!SPECIES[speciesId]) return { ok: false, text: 'Unbekanntes Tier.' };
  if (!isUnlocked(speciesId, state)) return { ok: false, text: `${SPECIES[speciesId].name}: ${unlockText(speciesId)} freigeschaltet.` };
  if (state.pets.length >= petSlots(state)) return { ok: false, text: 'Kein freier Platz für ein weiteres Tier.' };
  const pet = newPet(speciesId, colorId, name, now);
  state.pets.push(pet);
  state.activePet = pet.id;
  starterInventory(state);
  return { ok: true, pet };
}

export function activePet(state) {
  return state.pets.find((p) => p.id === state.activePet) || state.pets[0] || null;
}
