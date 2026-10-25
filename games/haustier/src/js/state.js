// Spielstand: reine Funktionen ohne Browser-Abhängigkeiten, damit sie auch unter Node testbar sind.
import { SPECIES, STATS, starterInventory } from './pets.js';
import { ITEMS } from './items.js';
import { canPlace } from './furniture.js';
import { MESS, MESS_MAX, LITTER_MAX, PENALTY_MAX } from './mess.js';
import { cleanShot } from './photo.js';

export const VERSION = 1;
export const ALBUM_MAX = 24;      // so viele Fotos hat das Album

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
    visitors: 'members',    // wer meine Tiere besuchen darf: members | friends | none (siehe visits.js)
    outgoing: null,         // eigene Besuche heute: { day, hosts, playdates } für die Besuchsbelohnung
    diary: [],              // Tagebuch im Seitenfach, neueste zuerst: [{ at, text, pet? }]
    place: {},              // aufgestellte Einrichtung: id -> { at: 'room' | 'desk', x, y } (x, y als Anteil, siehe unten)
    bowls: { food: null, water: 0 },   // Näpfe: food { item, left } (left: Rest einer Portion, 0 bis 1), water 0 bis 1
    desk: { gates: { l: 0, r: 0 }, stay: [], out: {} },   // Käfig: Tore (0 zu, 1 halb, 2 offen), wer drinbleibt, wer draußen ist
    tasksDone: 0,           // insgesamt erledigte Tagesaufgaben (für Belohnungen)
    mess: [],               // Pfützen, Häufchen und Spuren (siehe mess.js)
    litter: 0,              // Füllstand der Streukiste
    messDebt: 0,            // so viel Erfüllung kosten die Flecken gerade jedes Tier (kommt beim Putzen zurück)
    prefs: { potty: true }, // Einstellungen fürs ganze Konto: Geschäfte ja oder nein
    album: [],              // Fotoalbum: [{ at, text, shot }] (shot: Stellung der Tiere, siehe photo.js)
    seen: {},               // Erstes Mal: Tore offen, Tipps draußen, erster Tanz … (für Hinweise und Fotos)
  };
}

// Wo Einrichtung steht (state.place[id]):
//   Zimmer, Boden:  x = Anteil der Breite, y = Tiefe (0 hinten an der Wand, 1 vorn)
//   Zimmer, Wand:   x = Anteil der Breite, y = Anteil der Wandhöhe (0 oben, 1 unten am Boden)
//   Desktop:        x = Mitte als Anteil der Breite, y = Unterkante als Anteil der Höhe über der Taskleiste
export const DEFAULT_PLACE = { furn_chest: { at: 'room', x: 0.87, y: 0.06 }, care_bed: { at: 'room', x: 0.13, y: 0.12 } };
const unit = (v, d = 0.5) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

function fixPlace(raw, inventory) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, p] of Object.entries(raw)) {
    if (!p || !canPlace(id, p.at) || !(inventory[id] > 0)) continue;
    out[id] = { at: p.at, x: unit(p.x), y: unit(p.y, p.at === 'desk' ? 1 : 0.5) };
  }
  return out;
}

function fixDesk(raw, pets) {
  const ids = new Set(pets.map((p) => p.id));
  const d = raw && typeof raw === 'object' ? raw : {};
  const gate = (v) => (v === 1 || v === 2 ? v : 0);
  const out = {};
  if (d.out && typeof d.out === 'object') {
    for (const [id, o] of Object.entries(d.out)) if (ids.has(id) && o) out[id] = { x: unit(o.x), y: unit(o.y, 1) };
  }
  return {
    gates: { l: gate(d.gates && d.gates.l), r: gate(d.gates && d.gates.r) },
    stay: Array.isArray(d.stay) ? d.stay.filter((id) => ids.has(id)) : [],
    out,
  };
}

function fixBowls(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const food = b.food && ITEMS[b.food.item] && ITEMS[b.food.item].cat === 'food' && b.food.left > 0
    ? { item: b.food.item, left: unit(b.food.left, 0) } : null;
  return { food, water: unit(b.water, 0) };
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
  s.diary = Array.isArray(s.diary) ? s.diary.filter((e) => e && typeof e.text === 'string' && typeof e.at === 'number').slice(0, 20) : [];
  // Spielstände aus der Zeit vor dem Shop bekommen die Startausstattung nachgereicht
  if (s.pets.length && !s.starterGiven) starterInventory(s);
  // Seit es Einrichtung gibt, sind Spielzeugkiste und Körbchen Gegenstände, die im Zimmer stehen
  if (s.pets.length && !s.inventory.furn_chest) s.inventory.furn_chest = 1;
  const firstPlace = !raw.place;
  s.place = fixPlace(raw.place, s.inventory);
  if (firstPlace) for (const [id, p] of Object.entries(DEFAULT_PLACE)) if (s.inventory[id] > 0) s.place[id] = { ...p };
  s.bowls = fixBowls(raw.bowls);
  s.desk = fixDesk(raw.desk, s.pets);
  if (typeof s.tasksDone !== 'number' || !(s.tasksDone >= 0)) s.tasksDone = 0;
  s.mess = Array.isArray(raw.mess) ? raw.mess.filter((m) => m && MESS[m.kind] && typeof m.id === 'string' && typeof m.t === 'number').slice(0, MESS_MAX) : [];
  s.litter = typeof raw.litter === 'number' ? Math.max(0, Math.min(LITTER_MAX, Math.round(raw.litter))) : 0;
  s.messDebt = typeof raw.messDebt === 'number' ? Math.max(0, Math.min(PENALTY_MAX, raw.messDebt)) : 0;
  s.prefs = { potty: !(raw.prefs && raw.prefs.potty === false) };
  s.album = (Array.isArray(raw.album) ? raw.album : []).filter((e) => e && typeof e.at === 'number').map((e) => ({ at: e.at, text: String(e.text || '').slice(0, 120), shot: cleanShot(e.shot) }))
    .filter((e) => e.shot).slice(0, ALBUM_MAX);
  s.seen = raw.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen) ? raw.seen : {};
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
