// Spielstand: reine Funktionen ohne Browser-Abhängigkeiten, damit sie auch unter Node testbar sind.
import { SPECIES, STATS, starterInventory } from './pets.js';
import { ITEMS } from './items.js';

export const VERSION = 1;

// Kalendertag in lokaler Zeit als "JJJJ-MM-TT"
export function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Ganze Kalendertage zwischen zwei Tagesschlüsseln (unabhängig von Sommerzeit)
export function daysBetween(fromKey, toKey) {
  const utc = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(toKey) - utc(fromKey)) / 86400000);
}

export function newState(now = Date.now()) {
  return {
    version: VERSION,
    createdAt: now,
    updatedAt: now,
    coins: 0,
    pets: [],
    activePet: null,
    inventory: {},          // Gegenstand -> Anzahl (siehe items.js)
    room: 'room_living',
    visits: { total: 0, streak: 0, best: 0, lastDay: null },
    earned: 0,              // insgesamt verdiente Münzen
    extraSlots: 0,          // gekaufte Tierplätze
    accountBonus: false,    // Konto-Geschenk schon erhalten
    starterGiven: false,
    milestones: {},         // einmalige Belohnungen, z. B. "streak7"
    daily: null,            // Tagesaufgaben und Münzen aus Aktionen des aktuellen Tages
    checkinDay: null,       // Tag, an dem die Fragen zum Wohlbefinden zuletzt beantwortet wurden
  };
}

// Alte oder unvollständige Spielstände auf den aktuellen Aufbau bringen.
// Gibt null zurück, wenn die Daten kein Spielstand sind.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.version !== 'number' || raw.version > VERSION) return null;
  const base = newState(typeof raw.createdAt === 'number' ? raw.createdAt : Date.now());
  const s = { ...base, ...raw, visits: { ...base.visits, ...(raw.visits || {}) } };
  s.pets = Array.isArray(s.pets) ? s.pets.map(fixPet).filter(Boolean) : [];
  if (!s.pets.some((p) => p.id === s.activePet)) s.activePet = s.pets.length ? s.pets[0].id : null;
  if (!s.inventory || typeof s.inventory !== 'object') s.inventory = {};
  if (typeof s.coins !== 'number' || !(s.coins >= 0)) s.coins = 0;
  if (typeof s.updatedAt !== 'number') s.updatedAt = s.createdAt;
  if (!s.milestones || typeof s.milestones !== 'object') s.milestones = {};
  if (!ITEMS[s.room]) s.room = 'room_living';
  // Spielstände aus der Zeit vor dem Shop bekommen die Startausstattung nachgereicht
  if (s.pets.length && !s.starterGiven) starterInventory(s);
  s.version = VERSION;
  return s;
}

// Ein Tier aus gespeicherten Daten prüfen und fehlende Werte ergänzen
function fixPet(p) {
  if (!p || typeof p !== 'object' || !SPECIES[p.species] || typeof p.id !== 'string') return null;
  const stats = {};
  for (const { key } of STATS) {
    const v = p.stats && p.stats[key];
    stats[key] = typeof v === 'number' && v >= 0 && v <= 100 ? v : 50;
  }
  return {
    ...p, stats, name: typeof p.name === 'string' && p.name ? p.name : SPECIES[p.species].names[0],
    sleeping: !!p.sleeping, tickAt: typeof p.tickAt === 'number' ? p.tickAt : Date.now(),
    fatigue: p.fatigue && typeof p.fatigue === 'object' ? p.fatigue : {},
    cooldowns: p.cooldowns && typeof p.cooldowns === 'object' ? p.cooldowns : {},
    acc: p.acc && typeof p.acc === 'object' ? p.acc : {},
    xp: typeof p.xp === 'number' && p.xp >= 0 ? p.xp : 0,
  };
}

export function parse(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return migrate(JSON.parse(text)); } catch { return null; }
}

export function serialize(state) {
  return JSON.stringify(state);
}

// Ein Spielstand ohne jeden Fortschritt muss beim Anmelden nicht nachgefragt werden
export function isEmpty(state) {
  return !state || (state.pets.length === 0 && state.coins === 0);
}

// Täglichen Besuch zählen. Gibt zurück, ob heute der erste Besuch ist.
export function registerVisit(state, now = Date.now()) {
  const today = dayKey(now);
  const v = state.visits;
  if (v.lastDay === today) return false;
  const gap = v.lastDay ? daysBetween(v.lastDay, today) : null;
  v.streak = gap === 1 ? v.streak + 1 : 1;
  v.best = Math.max(v.best, v.streak);
  v.total += 1;
  v.lastDay = today;
  return true;
}
