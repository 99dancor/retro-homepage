// Münzen, Login-Bonus, Tagesaufgaben, Meilensteine und Shop (Konzept Abschnitt 5 und 6).
// Reine Funktionen, unter Node testbar.
import { dayKey } from './state.js';
import { ITEMS, ITEM_LIST, isDurable, owned, usableBy } from './items.js';
import { level, maxLevel, usableItems } from './pets.js';

// Münzen pro Aktion; Aktionen bringen höchstens DAILY_CAP Münzen am Tag, damit Dauerklicken nichts bringt
export const ACTION_COINS = { pet: 1, cuddle: 3, feed: 2, water: 1, sleep: 2, play: 3, brush: 2, bath: 3, walk: 5 };
export const DAILY_CAP = 150;
export const LOGIN_BONUS = [20, 25, 30, 35, 40, 50, 100];
export const ACCOUNT_BONUS = 200;
export const DEAL_DISCOUNT = 0.3;
const STREAK_MILESTONES = [[7, 100], [30, 500], [100, 1500]];

// Kleiner, fester Zufall je Tag, damit Angebot und Aufgaben auf allen Geräten gleich sind
function seeded(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function addCoins(state, amount) {
  state.coins += amount;
  state.earned = (state.earned || 0) + amount;
  return amount;
}

// ---------- Tagesaufgaben ----------
// check: (state, counters) -> Fortschritt; eligible: ob die Aufgabe heute sinnvoll ist
const TASKS = [
  { id: 'feed2', text: 'Füttere deine Tiere zweimal', goal: 2, reward: 15, count: 'feed' },
  { id: 'pet5', text: 'Streichle deine Tiere 5-mal', goal: 5, reward: 15, count: 'pet' },
  { id: 'water2', text: 'Gib deinen Tieren 2-mal Wasser', goal: 2, reward: 15, count: 'water' },
  { id: 'play3', text: 'Spiele 3-mal mit deinen Tieren', goal: 3, reward: 20, count: 'play' },
  { id: 'toys2', text: 'Spiele mit 2 verschiedenen Spielzeugen', goal: 2, reward: 25, count: 'toys',
    eligible: (s) => s.pets.some((p) => usableItems(s, p, 'toy').length >= 2) },
  { id: 'cuddle2', text: 'Kuschle 2-mal mit deinen Tieren', goal: 2, reward: 25, count: 'cuddle',
    eligible: (s) => s.pets.some((p) => level(p) >= 3) },
  { id: 'brush1', text: 'Bürste ein Tier', goal: 1, reward: 20, count: 'brush', eligible: (s) => owned(s, 'care_brush') },
  { id: 'walk1', text: 'Geh mit einem Tier Gassi oder auf Ausflug', goal: 1, reward: 25, count: 'walk',
    eligible: (s) => s.pets.some((p) => ['care_leash', 'care_runball'].some((i) => owned(s, i) && usableBy(ITEMS[i], p.species))) },
  { id: 'buy1', text: 'Kaufe etwas im Shop', goal: 1, reward: 15, count: 'buy' },
  { id: 'joy80', text: 'Bring die Erfüllung eines Tieres auf 80', goal: 80, reward: 30,
    check: (s) => Math.round(Math.max(0, ...s.pets.map((p) => p.stats.joy))) },
  { id: 'all60', text: 'Bring alle Werte eines Tieres über 60', goal: 1, reward: 30,
    check: (s) => (s.pets.some((p) => Object.values(p.stats).every((v) => v > 60)) ? 1 : 0) },
];
export const TASK_INFO = Object.fromEntries(TASKS.map((t) => [t.id, t]));

// Sorgt dafür, dass state.daily zum heutigen Tag passt; gibt state.daily zurück
export function ensureDaily(state, now = Date.now()) {
  const day = dayKey(now);
  if (state.daily && state.daily.day === day) return state.daily;
  const rnd = seeded('tasks:' + day + ':' + state.createdAt);
  const pool = TASKS.filter((t) => !t.eligible || t.eligible(state));
  const tasks = [];
  while (tasks.length < 3 && pool.length) tasks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0].id);
  state.daily = { day, actionCoins: 0, counters: {}, toys: [], tasks: tasks.map((id) => ({ id, done: false })) };
  return state.daily;
}

export function taskProgress(state, task) {
  const t = TASK_INFO[task.id], d = state.daily;
  if (t.check) return Math.min(t.goal, t.check(state));
  if (t.count === 'toys') return Math.min(t.goal, d.toys.length);
  return Math.min(t.goal, d.counters[t.count] || 0);
}

// Zählt ein Ereignis für die Tagesaufgaben. Gibt neu erledigte Aufgaben zurück (Münzen schon gutgeschrieben).
export function track(state, event, { itemId = null, now = Date.now() } = {}) {
  const d = ensureDaily(state, now);
  if (event) d.counters[event] = (d.counters[event] || 0) + 1;
  if (event === 'play' && itemId && !d.toys.includes(itemId)) d.toys.push(itemId);
  const done = [];
  for (const task of d.tasks) {
    if (task.done) continue;
    if (taskProgress(state, task) >= TASK_INFO[task.id].goal) {
      task.done = true;
      addCoins(state, TASK_INFO[task.id].reward);
      done.push(TASK_INFO[task.id]);
    }
  }
  return done;
}

// Münzen für eine Pflegeaktion (mit Tagesgrenze). factor: schwächer bei Wiederholung
export function actionCoins(state, action, factor = 1, now = Date.now()) {
  const d = ensureDaily(state, now);
  const want = Math.round((ACTION_COINS[action] || 0) * factor);
  const got = Math.max(0, Math.min(want, DAILY_CAP - d.actionCoins));
  d.actionCoins += got;
  return addCoins(state, got);
}

// ---------- Besuche und Meilensteine ----------
// Login-Bonus am ersten Besuch des Tages (nach registerVisit). Gibt { day, coins, item } zurück.
export function loginBonus(state, now = Date.now(), rng = Math.random) {
  const day = ((state.visits.streak - 1) % 7) + 1;
  const coins = addCoins(state, LOGIN_BONUS[day - 1]);
  let item = null;
  if (day === 7) {
    // Überraschung: ein Spielzeug oder Accessoire, das noch fehlt, sonst Leckerli
    const open = ITEM_LIST.filter((i) => (i.cat === 'toy' || i.cat === 'acc') && !i.req && !i.notForSale && !owned(state, i.id) && i.price <= 150);
    item = open.length ? open[Math.floor(rng() * open.length)].id : 'food_treat';
    state.inventory[item] = (state.inventory[item] || 0) + (item === 'food_treat' ? 3 : 1);
  }
  return { day, coins, item };
}

// Einmalige Belohnungen für Serien. Gibt Liste { text, coins } zurück.
export function streakMilestones(state) {
  const out = [];
  for (const [days, coins] of STREAK_MILESTONES) {
    const key = 'streak' + days;
    if (state.visits.streak >= days && !state.milestones[key]) {
      state.milestones[key] = true;
      out.push({ text: `${days} Tage in Folge!`, coins: addCoins(state, coins) });
    }
  }
  return out;
}

export function levelReward(state, newLevel) {
  return addCoins(state, newLevel * 50);
}

// Konto-Geschenk: einmal 200 Münzen und das Homepage-Halstuch
export function accountBonus(state) {
  if (state.accountBonus) return null;
  state.accountBonus = true;
  state.inventory.acc_homepage = 1;
  return { coins: addCoins(state, ACCOUNT_BONUS), item: 'acc_homepage' };
}

// ---------- Shop ----------
// Ist der Gegenstand gerade zu haben? { ok, reason }
export function available(state, item, now = Date.now()) {
  const r = item.req || {};
  if (r.level && maxLevel(state) < r.level) return { ok: false, reason: `Ab Zuneigungsstufe ${r.level}` };
  if (r.best && state.visits.best < r.best) return { ok: false, reason: `Ab ${r.best} Tagen in Folge` };
  if (r.months && !r.months.includes(new Date(now).getMonth() + 1)) {
    return { ok: false, reason: r.months.length === 1 && r.months[0] === 12 ? 'Nur im Dezember' : 'Nur im Frühling' };
  }
  if (r.owns && !state.pets.some((p) => p.species === r.owns)) return { ok: false, reason: 'Kommt mit dem Drachen' };
  return { ok: true };
}

// Was hier niemand benutzen kann, braucht der Shop nicht zu zeigen (z. B. Leine ohne Hund oder Fuchs)
export function relevant(state, item) {
  if (!item.for || !state.pets.length) return true;
  return state.pets.some((p) => usableBy(item, p.species));
}

export function dealOfDay(state, now = Date.now()) {
  const rnd = seeded('deal:' + dayKey(now));
  const pool = ITEM_LIST.filter((i) => ['food', 'toy', 'acc'].includes(i.cat) && !i.req && !i.notForSale && i.price >= 10);
  return pool[Math.floor(rnd() * pool.length)].id;
}

export function priceOf(state, item, now = Date.now()) {
  return item.id === dealOfDay(state, now) ? Math.round(item.price * (1 - DEAL_DISCOUNT)) : item.price;
}

export function canBuy(state, id, now = Date.now()) {
  const item = ITEMS[id];
  if (!item || item.notForSale) return { ok: false, reason: 'Nicht zu kaufen.' };
  const av = available(state, item, now);
  if (!av.ok) return av;
  if (id === 'extra_slot' && state.extraSlots) return { ok: false, reason: 'Schon gekauft.' };
  if (isDurable(item) && id !== 'extra_slot' && owned(state, id)) return { ok: false, reason: 'Hast du schon.' };
  const price = priceOf(state, item, now);
  if (state.coins < price) return { ok: false, reason: `Dir fehlen noch ${price - state.coins} Münzen.` };
  return { ok: true, price };
}

export function buy(state, id, now = Date.now()) {
  const c = canBuy(state, id, now);
  if (!c.ok) return { ok: false, text: c.reason };
  state.coins -= c.price;
  if (id === 'extra_slot') state.extraSlots = 1;
  else state.inventory[id] = (state.inventory[id] || 0) + 1;
  // Kostenlose Räume (freigeschaltet) gleich einrichten
  if (ITEMS[id].cat === 'room') state.room = id;
  return { ok: true, price: c.price, done: track(state, 'buy', { now }) };
}

// ---------- Accessoires und Räume ----------
export function wear(state, pet, id) {
  const item = ITEMS[id];
  if (!item || item.cat !== 'acc' || !owned(state, id)) return false;
  if (pet.acc[item.slot] === id) delete pet.acc[item.slot];
  else pet.acc[item.slot] = id;
  return true;
}

export function setRoom(state, id) {
  if (!ITEMS[id] || ITEMS[id].cat !== 'room' || !owned(state, id)) return false;
  state.room = id;
  return true;
}

// ---------- Tägliche Fragen zum eigenen Wohlbefinden ----------
// Einmal am Tag drei Ja/Nein-Fragen. Ja bringt Münzen und Erfüllung für alle Tiere, Nein etwas weniger Münzen.
// Gespeichert wird nur, DASS geantwortet wurde, nicht die Antworten selbst.
export const CHECKIN_QUESTIONS = [
  { id: 'survived', text: 'Hast du den Tag heute überlebt?' },
  { id: 'selfcare', text: 'Hast du etwas Gutes für dich getan?' },
  { id: 'wellbeing', text: 'Geht es dir gut?' },
];
export const CHECKIN_YES = 10;
export const CHECKIN_NO = 8;
export const CHECKIN_JOY = 5;

export const checkinDone = (state, now = Date.now()) => state.checkinDay === dayKey(now);

// answers: Liste von true/false in der Reihenfolge der Fragen. Gibt { ok, coins, joy } zurück.
export function checkIn(state, answers, now = Date.now()) {
  if (checkinDone(state, now)) return { ok: false, coins: 0, joy: 0 };
  if (!Array.isArray(answers) || answers.length !== CHECKIN_QUESTIONS.length) return { ok: false, coins: 0, joy: 0 };
  const yes = answers.filter(Boolean).length;
  const coins = yes * CHECKIN_YES + (answers.length - yes) * CHECKIN_NO;
  const joy = yes * CHECKIN_JOY;
  for (const p of state.pets) p.stats.joy = Math.min(100, p.stats.joy + joy);
  addCoins(state, coins);
  state.checkinDay = dayKey(now);
  return { ok: true, coins, joy };
}
