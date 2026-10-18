// Besuche bei anderen Mitgliedern: reine Regeln, die das Spiel und der Server (src/pixelpfoten.js) gemeinsam nutzen.
//
// Was Besucher bei fremden Tieren tun, landet auf dem Server im Besuchsbuch (Tabelle pp_visits). Das Spiel des
// Gastgebers holt die Einträge ab, sobald es offen ist, und wendet sie mit applyVisits() auf den eigenen Spielstand an.
// So bleibt der Spielstand wie bisher allein in der Hand seines Besitzers.
import { ITEMS } from './items.js';
import { SPECIES } from './pets.js';
import { dayKey } from './state.js';
import { addCoins } from './economy.js';

// Wer meine Tiere besuchen darf (steht im Spielstand, der Server liest es dort)
export const VISITOR_PRIVACY = { members: 'Alle Mitglieder', friends: 'Nur meine Freunde', none: 'Niemand' };
export const DEFAULT_PRIVACY = 'members';
export const privacyOf = (state) => (state && VISITOR_PRIVACY[state.visitors] ? state.visitors : DEFAULT_PRIVACY);

// Was ein Besucher tun kann und wie oft es am Tag (je Gastgeber) wirkt
//   visit:    vorbeischauen (einmal am Tag, zählt für das Besuchsbuch)
//   pet:      ein Tier streicheln       play: ein Tier hat mit dem Spielzeug des Besuchers gespielt
//   playdate: mit einem eigenen Tier zum Spielen gekommen
//   gift:     Futter dagelassen          sticker: ein Gruß im Besuchsbuch
export const KINDS = {
  visit: { limit: 1, effect: {} },
  pet: { limit: 6, effect: { love: 4, joy: 1 } },
  play: { limit: 6, effect: { fun: 6, love: 2 } },
  playdate: { limit: 1, effect: { fun: 6, joy: 3 } },
  gift: { limit: 3, effect: {} },
  sticker: { limit: 1, effect: { joy: 2 } },
};
export const STICKERS = ['👋', '❤️', '🌟', '🐾', '🎉', '🌸', '🍀', '☕'];

// Futter, das man verschenken kann (aus dem eigenen Inventar)
export const giftable = (id) => !!ITEMS[id] && ITEMS[id].cat === 'food' && ITEMS[id].price <= 60;

// Besucher bekommen Münzen für die ersten Besuche am Tag
export const VISIT_COINS = 10;
export const VISIT_COIN_HOSTS = 3;

const clamp = (v) => Math.max(0, Math.min(100, v));

// Einträge aus dem Besuchsbuch auf den eigenen Spielstand anwenden.
//   entries: [{ id, kind, pet_id, detail, visitor }] (visitor: Anzeigename)
// Gibt eine Zusammenfassung je Besucher zurück: [{ visitor, kinds: [...], pets: [Namen], gifts: [ids], stickers: [...] }]
export function applyVisits(state, entries) {
  const by = new Map();
  for (const e of entries) {
    const k = KINDS[e.kind];
    if (!k) continue;
    const sum = by.get(e.visitor) || { visitor: e.visitor, kinds: [], pets: [], gifts: [], stickers: [], buddies: [] };
    by.set(e.visitor, sum);
    if (!sum.kinds.includes(e.kind)) sum.kinds.push(e.kind);
    // Ein bestimmtes Tier oder (Spielbesuch, Gruß) alle Tiere
    const targets = e.pet_id ? state.pets.filter((p) => p.id === e.pet_id) : ['playdate', 'sticker'].includes(e.kind) ? state.pets : [];
    for (const p of targets) {
      for (const [stat, v] of Object.entries(k.effect)) p.stats[stat] = clamp(p.stats[stat] + v);
      if (e.pet_id && !sum.pets.includes(p.name)) sum.pets.push(p.name);
    }
    if (e.kind === 'gift' && giftable(e.detail)) {
      state.inventory[e.detail] = (state.inventory[e.detail] || 0) + 1;
      sum.gifts.push(e.detail);
    }
    if (e.kind === 'sticker' && STICKERS.includes(e.detail)) sum.stickers.push(e.detail);
    if (e.kind === 'playdate' && e.detail && !sum.buddies.includes(e.detail)) sum.buddies.push(e.detail);
  }
  return [...by.values()];
}

// Ein Satz je Besucher, z. B. „Anna hat Balu gestreichelt und dir 🥕 Karotte dagelassen.“
export function visitText(sum) {
  const bits = [];
  if (sum.kinds.includes('pet')) bits.push(`${list(sum.pets) || 'deine Tiere'} gestreichelt`);
  if (sum.kinds.includes('play')) bits.push('mit deinen Tieren gespielt');
  if (sum.buddies.length) bits.push(`${list(sum.buddies)} zum Spielen mitgebracht`);
  if (sum.gifts.length) bits.push(`dir ${list(sum.gifts.map((id) => `${ITEMS[id].icon} ${ITEMS[id].name}`))} dagelassen`);
  if (sum.stickers.length) bits.push(`einen Gruß hinterlassen ${sum.stickers.join('')}`);
  return bits.length ? `${sum.visitor} hat ${list(bits)}.` : `${sum.visitor} hat bei dir vorbeigeschaut.`;
}

function list(items) {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' und ' + items[items.length - 1];
}

// Münzen für den Besucher: die ersten VISIT_COIN_HOSTS Gastgeber am Tag bringen je VISIT_COINS
//   host: Benutzername des Gastgebers. Gibt die Münzen zurück (0, wenn heute schon belohnt).
export function visitReward(state, host, now = Date.now()) {
  const day = dayKey(now);
  if (!state.outgoing || state.outgoing.day !== day) state.outgoing = { day, hosts: [], playdates: [] };
  const o = state.outgoing;
  if (o.hosts.includes(host)) return 0;
  o.hosts.push(host);
  return o.hosts.length <= VISIT_COIN_HOSTS ? addCoins(state, VISIT_COINS) : 0;
}

// Das mitgebrachte Tier hat Spaß beim Spielbesuch (einmal am Tag je Gastgeber). Gibt die Änderung zurück oder null.
export function playdate(state, pet, host, now = Date.now()) {
  const day = dayKey(now);
  if (!state.outgoing || state.outgoing.day !== day) state.outgoing = { day, hosts: [], playdates: [] };
  const o = state.outgoing;
  o.playdates ||= [];
  if (o.playdates.includes(host)) return null;
  o.playdates.push(host);
  const delta = {};
  for (const [stat, v] of Object.entries(KINDS.playdate.effect)) {
    const before = pet.stats[stat];
    pet.stats[stat] = clamp(before + v);
    delta[stat] = Math.round(pet.stats[stat] - before);
  }
  return delta;
}

// Öffentliche Ansicht eines Tieres für Besucher (ohne Inventar, Münzen usw.)
export function publicPet(p, level) {
  const stats = {};
  for (const [k, v] of Object.entries(p.stats || {})) stats[k] = Math.round(v);
  return { id: p.id, name: p.name, species: p.species, color: p.color, acc: p.acc || {}, stats, sleeping: !!p.sleeping, level };
}

// Live-Stand eines Tieres prüfen, bevor der Server ihn weiterreicht. Gibt null zurück, wenn es kein Tier ist.
export function cleanLivePet(raw) {
  if (!raw || typeof raw !== 'object' || !SPECIES[raw.species]) return null;
  const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  const acc = {};
  for (const slot of ['head', 'neck', 'back']) {
    const id = raw.acc && raw.acc[slot];
    if (ITEMS[id] && ITEMS[id].slot === slot) acc[slot] = id;
  }
  const color = SPECIES[raw.species].colors.some((c) => c.id === raw.color) ? raw.color : SPECIES[raw.species].colors[0].id;
  return {
    id: str(raw.id, 30), name: str(raw.name, 20) || SPECIES[raw.species].names[0], species: raw.species, color, acc,
    face: ['happy', 'ok', 'sad', 'sleep'].includes(raw.face) ? raw.face : 'ok', sleeping: !!raw.sleeping,
    x: num(raw.x, -0.2, 1.2, 0.5), d: num(raw.d, 0, 1, 0.5), facing: raw.facing === -1 ? -1 : 1, walking: !!raw.walking,
    hop: num(raw.hop, 0, 400), emote: str(raw.emote, 4), seq: num(raw.seq, 0, 1e9), hidden: !!raw.hidden,
  };
}

// Spielzeug, das ein Mitglied im Live-Zimmer gerade benutzt (nur zum Anzeigen bei den anderen)
export function cleanLiveToy(raw) {
  if (!raw || typeof raw !== 'object' || !ITEMS[raw.id] || ITEMS[raw.id].cat !== 'toy') return null;
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  return { id: raw.id, x: num(raw.x, 0, 1), y: num(raw.y, 0, 1), d: num(raw.d, 0, 1), spin: num(raw.spin, -1e6, 1e6) };
}
