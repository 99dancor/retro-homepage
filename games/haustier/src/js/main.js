// Einstieg: Spielstand laden, Oberfläche zeichnen, regelmäßig speichern.
// Aufbau wie bei den Kartenspielen: oben die Werkzeugleiste, links die Spielfläche (Zimmer, Ausflug, Besuchen)
// mit ihrer Leiste darunter, rechts das Seitenfach (Tier, Shop, Aufgaben …), unten die Statusleiste, die das
// Desktop-Fenster der Homepage in seinen Rahmen übernimmt.
import { createStore, KEYS, safeLocal } from './storage.js';
import { registerVisit, dayKey, newState } from './state.js';
import {
  SPECIES, STATS, ACTIONS, CUDDLE_LOVE, CUDDLE_LEVEL, SLOT_LEVEL, tickAll, tickPet, tickOpts, mood, canDo, doAction,
  adopt, activePet, isUnlocked, unlockText, petSlots, nextSlotHint, cleanName, level, levelProgress,
  usableItems, walkLabel, walkGear, bowlMeal, HUNGRY,
} from './pets.js';
import { ITEMS, ITEM_LIST, usableBy, isFav, isDurable, owned } from './items.js';
import { PRANKS, deskOptions } from './deskphys.js';
import {
  ensureDaily, track, taskProgress, TASK_INFO, actionCoins, addCoins, loginBonus, streakMilestones, levelReward,
  accountBonus, available, relevant, dealOfDay, priceOf, canBuy, buy, wear, setRoom, LOGIN_BONUS, DAILY_CAP, ACCOUNT_BONUS,
  CHECKIN_QUESTIONS, checkIn, checkinDone, placeItem, unplace, pourFood, fillWater, placedCount,
} from './economy.js';
import { FURN, MAX_ROOM, MAX_DESK, canPlace, furnSvg } from './furniture.js';
import { petSvg, roomSvg } from './art.js';
import { iconSvg, ICON_OF } from './icons.js';
import { play as sfx, actionSound, muted, toggleMuted } from './sound.js';
import { createScene } from './scene.js';
import { TOYS } from './behavior.js';
import { api, createLive } from './live.js';
import { VISITOR_PRIVACY, privacyOf, STICKERS, giftable, applyVisits, visitText, visitReward, playdate } from './visits.js';
import {
  SKILLS, TALENT, DOUBLE_JUMP_LEVEL, PLACES, CONTEST_COINS, PRIZES, skillLevel, skillProgress,
  placeOpen, course, contestCourse, canTrip, canContest, finishTrip, finishContest, claimPrize,
} from './trip.js';
import { createRun, previewRun } from './run.js';

// Adressen der Homepage. Der Server schreibt sie als data-Attribute in <body> (data-login, data-register,
// data-forum); ein leerer Wert heißt: gibt es gerade nicht (z. B. Registrierung geschlossen, Forum aus).
const ds = document.body.dataset;
const config = {
  savesUrl: '/api/saves/haustier',
  loginUrl: ds.login ?? '/login?next=/haustier/',
  registerUrl: ds.register ?? '/register?next=/haustier/',
  forumUrl: ds.forum ?? '/forum/new',
  changelogUrl: 'changelog.md',
};

// Läuft das Spiel in einem Fenster auf dem Desktop der Homepage, öffnen Links zu anderen Seiten
// deren eigenes Fenster, statt das Spiel zu ersetzen.
function desk() {
  try { return window.parent !== window && window.parent.RetroDesk ? window.parent.RetroDesk : null; } catch { return null; }
}
function openLink(href) {
  const u = new URL(href, location.href);
  const d = desk();
  if (d && u.origin === location.origin) d.open(u.pathname + u.search + u.hash, true);
  else window.top.location.href = u.href;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  const d = desk();
  if (!a || !d || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith(location.pathname)) return;
  e.preventDefault();
  if ($('dlg').open) $('dlg').close('link');
  d.open(u.pathname + u.search + u.hash, true);
});

const $ = (id) => document.getElementById(id);
// Kurz in der Statusleiste, ausführlich als Tooltip
const SAVE_TEXT = {
  local: ['💾 Im Browser', 'Im Browser gespeichert'],
  nostore: ['⚠️ Nicht gespeichert', 'Speichern im Browser ist nicht möglich'],
  pending: ['💾 …', 'Ungespeicherte Änderungen'],
  saving: ['💾 Speichere …', 'Speichere im Konto'],
  saved: ['✅ Gespeichert', 'Im Konto gespeichert'],
  offline: ['📴 Offline', 'Offline: wird später im Konto gespeichert'],
  error: ['⚠️ Fehler', 'Speichern fehlgeschlagen, neuer Versuch folgt'],
  loggedout: ['⚠️ Abgemeldet', 'Abgemeldet: bitte neu anmelden, sonst geht Fortschritt verloren'],
};
const STAT_NAME = Object.fromEntries(STATS.map((s) => [s.key, s]));
// Was eine Zuneigungsstufe freischaltet: als Satz nach dem Aufstieg und kurz als Ausblick im Fach
const LEVEL_UNLOCKS = { [CUDDLE_LEVEL]: 'Ihr könnt jetzt kuscheln und in den Wald.', [SLOT_LEVEL]: 'Ein zweiter Tierplatz, der Puzzle-Futterball und der Strand sind frei.', 7: 'Ihr könnt jetzt in die Berge.', 8: 'Die Krone gibt es jetzt im Shop.' };
const LEVEL_NEXT = { [CUDDLE_LEVEL]: 'Kuscheln, Wald', [SLOT_LEVEL]: 'zweiter Tierplatz, Strand', 7: 'Berge', 8: 'Krone' };
// Pflege und die Bilder dazu (dieselben wie bei den Bedürfnissen im Fach)
const ACT_ICON = { pet: 'heart', cuddle: 'heart', feed: 'food_dry', water: 'drop', play: 'toy_ball', sleep: 'zzz', wake: 'star', brush: 'care_brush', bath: 'care_soap', walk: 'paw' };
const NEED_ACT = { love: 'pet', food: 'feed', water: 'water', fun: 'play', rest: 'sleep' };
const NEED_KEYS = ['food', 'water', 'love', 'fun', 'rest'];
const SKILL_ICON = { speed: 'speed', jump: 'jump', nose: 'nose' };
const TO_PLACE = { park: 'in den Park', forest: 'in den Wald', beach: 'an den Strand', mountains: 'in die Berge' };
const SHOP_TABS = [['food', 'Futter'], ['toy', 'Spielzeug'], ['care', 'Pflege'], ['acc', 'Anziehen'], ['room', 'Räume'], ['furn', 'Einrichtung']];
const SMALL = ['hamster', 'rat', 'axolotl'];
const HAND_LOVE = 2;        // Aus der Hand gefüttert: etwas mehr Zuneigung als aus dem Napf

let state = newState();
let view = 'room';        // Spielfläche: 'room' | 'adopt' | 'trip' | 'visit'
let pane = null;          // Seitenfach: null (passend zur Ansicht) | 'shop' | 'tasks'
const shop = { tab: 'food', pick: null, mine: true };
let tryOn = null;         // Accessoire, das das gewählte Tier im Shop anprobiert (nur zum Ansehen)
let tripTab = 'skills';   // Fach beim Ausflug: 'skills' | 'contest'
let tripPlace = 'park';
let picked = null;        // Tierart auf dem Adoptionsbildschirm
let bubble = null;        // Meldung oben im Zimmer: { text, until }
let logLine = null;       // Meldung in der Statusleiste: { text, until }
let checkinLater = 0;     // bis dahin fragt das Tier nicht nach deinem Tag
let started = false;      // Begrüßung vorbei: ab jetzt dürfen Hinweise und Fragen kommen
let homeTab = 'room';     // Einrichten im Fach: 'room' (Zimmer) | 'desk' (Desktop)
let placedNow = null;     // gerade aufgestelltes Teil (beim Einrichten markiert)
const lastAction = {};    // Abklingzeit je Tier und Aktion

// Besuch bei einem anderen Mitglied: { host: { user, name, url }, data: Zimmer vom Server, bring: eigenes Tier oder null }
let visit = null;
let neighbours = null;    // Liste fürs Besuchen (null = wird geladen), oder { error }
let visitBook = [];       // wer zuletzt bei mir war
const foreignCooldown = {};

// Ausflug oder Wettbewerbslauf, der gerade läuft: { mode: 'walk' | 'contest', pet, course, runner }
let trip = null;
let contest = null;       // Tageswettbewerb vom Server: { day, place, top, mine, yesterday } oder { error }

// Live-Zimmer: das eigene, solange man zu Hause ist, sonst das des Gastgebers
const live = createLive({
  change: () => { if (view === 'room') render(); },
  post: () => fetchInbox(),
  join: (m) => {
    if (m.host || m.user === store.user) return;
    sfx('freude');
    const pets = m.pets.map((p) => p.name);
    say(`${m.name} ist ${visit ? 'auch hier' : 'zu Besuch'}${pets.length ? ` und hat ${pets.join(' und ')} dabei` : ''}!`, 6000);
  },
  leave: (m) => { if (!m.host && m.user !== store.user) say(`${m.name} ist wieder gegangen.`, 3500); },
});
const hostMember = () => (visit ? [...live.members.values()].find((m) => m.host) : null);

// Alle Tiere im Zimmer für die Szene: eigene, die des Gastgebers und die anderer Besucher.
// Jedes Mitglied zählt nur einmal, auch wenn es das Zimmer in mehreren Fenstern offen hat.
function roster() {
  const list = [], seen = new Set();
  const remote = (m) => {
    if (seen.has(m.user)) return;
    seen.add(m.user);
    m.pets.forEach((p) => list.push({ key: `${m.sid}:${p.id}`, pet: p, kind: 'remote', owner: m.name, user: m.user, net: p }));
  };
  const cur = activePet(state);
  const own = (p) => list.push({ key: p.id, pet: tryOn && p === cur ? { ...p, acc: { ...p.acc, [ITEMS[tryOn].slot]: tryOn } } : p, kind: 'own' });
  if (visit) {
    const hm = hostMember();
    if (hm) remote(hm);
    else visit.data.pets.forEach((p) => list.push({ key: 'h:' + p.id, pet: p, kind: 'foreign', owner: visit.host.name, user: visit.host.user }));
    seen.add(visit.host.user);
    const mine = state.pets.find((p) => p.id === visit.bring);
    if (mine) own(mine);
  } else state.pets.filter((p) => !isOut(p.id)).forEach(own);
  if (store.user) seen.add(store.user);
  for (const m of live.members.values()) remote(m);
  return list;
}

// Woran ein eigenes Tier gerade denkt: das dringendste Bedürfnis, sobald es knapp wird
function thought(pet) {
  if (pet.sleeping) return null;
  const k = NEED_KEYS.reduce((a, b) => (pet.stats[b] < pet.stats[a] ? b : a));
  return pet.stats[k] < 40 ? k : null;
}
// Das Bedürfnis, um das man sich als Nächstes kümmern sollte (für den Standardknopf der Pflege-Leiste)
const lowestNeed = (pet) => NEED_KEYS.reduce((a, b) => (pet.stats[b] < pet.stats[a] ? b : a));

// Das Zimmer mit allen Tieren, die frei herumlaufen und mit Spielzeug spielen
const scene = createScene({
  roster,
  active: () => (visit ? visit.bring : activePet(state) && activePet(state).id),
  openChest: (r) => openMenu(null, playItems(), { x: r.left, y: r.top, up: true, head: 'Spielzeugkiste' }),
  props: () => (visit ? (visit.data.place || []) : roomProps()),
  tapProp: (id, r) => tapProp(id, r),
  placed: (id, x, y) => { const res = placeItem(state, id, 'room', x, y); if (res.ok) { placedNow = id; store.save(state); render(); } },
  unplace: (id) => takeBack(id),
  bowlWant: (e) => (e.kind === 'own' && !visit ? bowlWant(e.pet) : null),
  eat: (e, kind) => eatAtBowl(e.pet.id, kind),
  gates: () => gateState(),
  gateSet: (side, v) => setGate(side, v),
  mayLeave: (e) => mayLeave(e.pet),
  leave: (e, side, at) => leavePet(e.pet.id, side, at),
  remoteToys: () => [...live.members.values()].filter((m) => m.toy && m.user !== store.user).map((m) => ({ key: m.sid, ...m.toy })),
  thought: (e) => (e.kind === 'own' && !visit ? thought(e.pet) : null),
  need: (e, k) => {
    selectPet(e.pet.id);
    if (k === 'fun') takeToy(null);
    else act(NEED_ACT[k]);
  },
  select: (e) => {
    if (e.kind === 'own') return visit ? null : selectPet(e.pet.id);
    tell(e.key, `${e.pet.name} gehört ${e.owner}. ${e.pet.sleeping ? 'Psst, schläft gerade.' : 'Streich darüber zum Streicheln.'}`, 3500);
  },
  stroke: (e) => {
    if (e.kind !== 'own') return foreign(e, 'pet');
    if (activePet(state).id !== e.pet.id) selectPet(e.pet.id);
    act('pet');
  },
  menu: (e, x, y) => petMenu(e, x, y),
  play: (e, itemId) => (e.kind === 'own' ? playWith(e.pet.id, itemId) : foreign(e, 'play', itemId)),
  sound: (n) => sfx(n),
});

// Ein fremdes Tier streicheln oder mit ihm spielen: landet im Besuchsbuch seines Besitzers
function foreign(e, kind, itemId) {
  const now = Date.now();
  const k = e.key + ':' + kind;
  if (e.pet.sleeping) { tell(e.key, `${e.pet.name} schläft gerade. Psst!`, 2500); return { ok: false }; }
  if (foreignCooldown[k] && now - foreignCooldown[k] < (kind === 'pet' ? 1500 : 2500)) return { ok: true, factor: 1 };
  foreignCooldown[k] = now;
  scene.animate(e.key, kind === 'pet' ? 'pet' : 'none');
  sfx(kind === 'pet' ? 'stimme:' + e.pet.species : 'pop');
  tell(e.key, kind === 'pet' ? `${e.pet.name} ${SPECIES[e.pet.species].sound}.` : `${e.pet.name} spielt mit deinem Spielzeug: ${ITEMS[itemId].name}.`, 3000);
  api.act(e.user, { kind, pet: e.pet.id }).catch(() => {});
  return { ok: true, factor: 1 };
}

// ---------- Einrichtung im Zimmer, Näpfe ----------
const bowlLevel = (id) => (id === 'furn_bowl_food' ? (state.bowls.food ? state.bowls.food.left : 0) : id === 'furn_bowl_water' ? state.bowls.water : undefined);
function propTitle(id) {
  const it = ITEMS[id];
  if (id === 'furn_chest') return 'Spielzeugkiste: Spielzeug herausholen';
  if (id === 'furn_bowl_food') {
    const b = state.bowls.food;
    return b ? `Futternapf: ${ITEMS[b.item].name}, ${Math.round(b.left * 100)} % voll. Antippen zum Nachfüllen.` : 'Futternapf: leer. Antippen und Futter hineinschütten.';
  }
  if (id === 'furn_bowl_water') return `Wassernapf: ${Math.round(state.bowls.water * 100)} % voll. Antippen füllt ihn.`;
  if (FURN[id].station) return `${it.name}: antippen, dann spielt ein Tier damit`;
  if (FURN[id].sleep) return `${it.name}: Schlafplatz`;
  return it.name;
}
function roomProps() {
  return Object.entries(state.place).filter(([, p]) => p.at === 'room').map(([id, p]) => ({
    id, x: p.x, y: p.y, open: id === 'furn_chest' && !!scene.toy, level: bowlLevel(id), title: propTitle(id),
  }));
}

function tapProp(id, r) {
  if (id === 'furn_bowl_food') return openMenu(null, pourItems(), { x: r.left, y: r.top, up: true, head: 'Futternapf füllen' });
  if (id === 'furn_bowl_water') return fill();
  log(propTitle(id), 4000);
}
function fill() {
  const r = fillWater(state);
  if (!r.ok) { sfx('nein'); log(r.reason, 4000); return r; }
  sfx('trinken'); store.save(state); render(); say(r.text, 3500);
  return r;
}
function pour(id) {
  const r = pourFood(state, id);
  if (!r.ok) { sfx('nein'); log(r.reason, 4000); return r; }
  sfx('fressen'); store.save(state); render(); say(r.text, 4000);
  return r;
}
// Futter, das in den Napf passt; Lieblingsfutter der meisten Tiere zuerst
function bowlFoods() {
  return Object.keys(state.inventory).filter((id) => ITEMS[id] && ITEMS[id].cat === 'food' && state.inventory[id] > 0 && ITEMS[id].effect.food > 0)
    .sort((a, b) => state.pets.filter((p) => usableBy(ITEMS[b], p.species)).length - state.pets.filter((p) => usableBy(ITEMS[a], p.species)).length
      || ITEMS[a].price - ITEMS[b].price);
}
function pourItems() {
  const b = state.bowls.food;
  const items = bowlFoods().map((id) => {
    const who = state.pets.filter((p) => usableBy(ITEMS[id], p.species)).map((p) => p.name);
    return { icon: iconSvg(id), label: ITEMS[id].name, sub: `× ${state.inventory[id]}`, title: who.length ? `Für ${who.join(', ')}` : 'Mag keins deiner Tiere', run: () => pour(id) };
  });
  if (!items.length) items.push({ label: 'Kein Futter für den Napf', off: true });
  const head = b ? [{ label: `Im Napf: ${ITEMS[b.item].name}, ${Math.round(b.left * 100)} %`, off: true }, '-'] : [];
  return [...head, ...items, '-', { icon: '🛒', label: 'Futter kaufen …', run: () => openShop('food') }];
}
// Will das Tier an einen Napf im Zimmer? (Vorher als im Takt, damit man es fressen sieht)
function bowlWant(pet) {
  if (pet.sleeping) return null;
  const s = pet.stats, b = state.bowls, at = (id) => state.place[id] && state.place[id].at === 'room';
  if (at('furn_bowl_water') && b.water > 0 && s.water < HUNGRY + 15) return 'water';
  if (at('furn_bowl_food') && b.food && b.food.left > 0 && s.food < HUNGRY + 15 && usableBy(ITEMS[b.food.item], pet.species)) return 'food';
  return null;
}
function eatAtBowl(petId, kind) {
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet || pet.sleeping) return null;
  tickPet(pet, Date.now(), tickOpts(state));
  const got = bowlMeal(pet, { bowls: state.bowls, food: kind === 'food', water: kind === 'water', below: HUNGRY + 15 });
  const delta = Object.fromEntries(Object.entries(got).filter(([, v]) => v > 0.5).map(([k, v]) => [k, Math.round(v)]));
  if (!Object.keys(delta).length) return null;
  sfx(kind === 'water' ? 'trinken' : 'fressen');
  floaters(pet, delta);
  store.save(state);
  render();
  return { text: `${pet.name} ${kind === 'water' ? 'trinkt aus dem Napf' : 'frisst aus dem Napf'}.`, delta };
}

// ---------- Käfig: Tore und Tiere auf dem Desktop (public/desk-pets.js) ----------
let pets = null;          // Desktop-Ebene, sobald verbunden
let deskBlocked = '';     // warum keine Tiere raus dürfen (z. B. ein anderer Tab zeigt sie schon)
let deskPending = false;  // Desktop-Ebene lädt noch: Tiere, die draußen sind, bleiben so lange weg
function deskHost() {
  try {
    const w = window.parent;
    if (w === window || !w.RetroPets || w.matchMedia('(max-width: 760px)').matches) return null;
    return w.RetroPets;
  } catch { return null; }
}
const deskReady = () => !!pets && !visit;
const isOut = (id) => !!state.desk.out[id] && (deskPending || !!pets || !!deskBlocked);
const gateState = () => ({ on: deskReady() && view === 'room', l: state.desk.gates.l, r: state.desk.gates.r });
const visualOf = (p) => ({
  id: p.id, name: p.name, species: p.species, color: p.color, acc: p.acc, face: mood(p).face, sleeping: !!p.sleeping,
  need: thought(p), small: SMALL.includes(p.species), stay: state.desk.stay.includes(p.id),
});
function mayLeave(pet) {
  return deskReady() && !pet.sleeping && !state.desk.stay.includes(pet.id) && !isOut(pet.id) && !$('dlg').open;
}
// side: 'l', 'r' oder 'both'; v: 0 zu, 1 halb (nur kleine Tiere), 2 offen
function setGate(side, v) {
  for (const sd of side === 'both' ? ['l', 'r'] : [side]) state.desk.gates[sd] = v;
  sfx('klick');
  store.save(state);
  render();
  const where = side === 'both' ? 'Die Tore sind' : side === 'l' ? 'Das Tor links ist' : 'Das Tor rechts ist';
  log(v === 2 ? `${where} offen: Deine Tiere können auf den Desktop.` : v === 1 ? `${where} halb offen: Nur kleine Tiere passen durch.` : `${where} zu.`, 5000);
}
function leavePet(id, side, at) {
  const pet = state.pets.find((p) => p.id === id);
  if (!pet || !pets) return;
  state.desk.out[id] = { x: 0.5, y: 1 };
  try { pets.out(visualOf(pet), { side, ...(at || {}) }); } catch { delete state.desk.out[id]; return; }
  if (state.activePet === id) log(`${pet.name} ist auf den Desktop gelaufen.`, 5000);
  store.save(state);
  render();
}
// Alle (oder eins) zurück ins Zimmer rufen: Die Desktop-Ebene schickt sie zum Tor und meldet sich mit back()
function callHome(id = null) {
  if (!pets) return;
  try { if (id) pets.call(id); else pets.callAll(); } catch { /* Desktop weg */ }
}
// Was die Desktop-Ebene vom Spiel wissen will und ihm meldet
const deskHooks = {
  pets: () => state.pets.filter((p) => isOut(p.id)).map(visualOf),
  gates: () => {
    const g = view === 'room' && !visit && $('room') ? scene.gateInfo() : null;
    return g && { ...g, l: state.desk.gates.l, r: state.desk.gates.r };
  },
  back(id, side) {
    if (!state.desk.out[id]) return;
    delete state.desk.out[id];
    scene.enter(id, side === 'l' ? 'l' : 'r');
    store.save(state);
    render();
  },
  where(list) {
    let moved = false;
    for (const o of list) if (state.desk.out[o.id]) { state.desk.out[o.id] = { x: +o.x.toFixed(3), y: +o.y.toFixed(3) }; moved = true; }
    if (moved) store.save(state);
  },
  act: (id, kind, extra = {}) => deskAct(id, kind, extra),
  eat: (id, kind) => eatAtBowl(id, kind),
  fill: (kind) => (kind === 'water' ? fill() : bowlFoods().length ? pour(bowlFoods()[0]) : { ok: false, reason: 'Kein Futter für den Napf. Schau im Shop vorbei!' }),
  bowls: () => ({ food: state.bowls.food ? state.bowls.food.left : 0, water: state.bowls.water, item: state.bowls.food && state.bowls.food.item }),
  moved(id, x, y) {
    const r = placeItem(state, id, 'desk', x, y);
    if (r.ok) { store.save(state); render(); }
    return r;
  },
  unplace(id) { unplace(state, id); store.save(state); render(); },
  prank(id, text) {
    const pet = state.pets.find((p) => p.id === id);
    if (pet) { note(text, pet); store.save(state); if (pane === null && view === 'room') render(); }
  },
  options: () => showSettings('desk'),
  furnish: () => openHome('desk'),
  stopFurnish: () => { if (pane === 'home' && homeTab === 'desk') { pane = null; render(); } },
  sound: (n) => sfx(n),
};

// Pflege draußen (Streicheln, Werfen, Spielzeug): gleiche Regeln wie im Zimmer, ohne die Ansicht zu wechseln
const thrown = {};
function deskAct(id, kind, { hard = false, toy = null } = {}) {
  const pet = state.pets.find((p) => p.id === id);
  if (!pet) return { ok: false };
  const now = Date.now();
  tickPet(pet, now, tickOpts(state));
  if (kind === 'throw') {
    // Sanft geworfen macht Spaß (höchstens alle 20 s), zu fest ist das Tier kurz beleidigt
    if (hard) { pet.stats.fun = Math.max(0, pet.stats.fun - 3); store.save(state); return { ok: true, text: `${pet.name} ist kurz beleidigt. Nicht so wild!`, face: 'sad' }; }
    if (thrown[id] && now - thrown[id] < 20000) return { ok: true, text: '' };
    thrown[id] = now;
    pet.stats.fun = Math.min(100, pet.stats.fun + 3);
    store.save(state);
    return { ok: true, text: `${pet.name} fand das lustig!`, face: 'happy' };
  }
  const action = kind === 'play' ? 'play' : 'pet';
  const key = id + ':' + action;
  if (lastAction[key] && now - lastAction[key] < ACTIONS[action].cooldown) return { ok: false };
  const r = doAction(pet, action, state, now, { itemId: toy });
  if (!r.ok) return { ok: false, text: r.text };
  lastAction[key] = now;
  actionSound(action, pet.species).forEach((n, i) => setTimeout(() => sfx(n), i * 350));
  const gained = actionCoins(state, action, r.factor);
  const done = track(state, action, { itemId: r.itemId });
  store.save(state);
  render();
  for (const t of done) setTimeout(() => say(`Aufgabe erledigt: ${t.text} (+${t.reward} Münzen)`, 4500), 600);
  if (r.levelUp) setTimeout(() => sfx('fanfare'), 700);
  return { ok: true, text: r.text, delta: r.delta, coins: gained, factor: r.factor, fav: r.fav };
}

// Kopie der Möbel auf dem Desktop im Browser: So stehen sie auch da, wenn Pixelpfoten zu ist
const local = safeLocal((() => { try { return window.localStorage; } catch { return null; } })());
let deskCopy = '', deskU = 2;
function syncDesk() {
  const items = Object.entries(state.place).filter(([, p]) => p.at === 'desk').map(([id, p]) => ({ id, x: p.x, y: p.y }));
  const g = view === 'room' && !visit ? scene.gateInfo() : null;
  if (g) deskU = g.u;
  const copy = JSON.stringify({ user: ds.user || '', u: deskU, items, bowls: deskHooks.bowls() });
  if (copy !== deskCopy && (deskHost() || deskCopy)) {
    deskCopy = copy;
    if (items.length) local.set(KEYS.desk, copy); else local.remove(KEYS.desk);
  }
  if (!pets) return;
  try { pets.update({ pets: deskHooks.pets(), items, bowls: deskHooks.bowls() }); } catch { /* Desktop weg */ }
}

async function connectDesk() {
  const host = deskHost();
  if (!host) { state.desk.out = {}; return; }
  deskPending = true;
  let api;
  try { api = await host.load(); } catch (e) { console.error('Desktop-Ebene:', e); deskPending = false; render(); return; }
  deskPending = false;
  const r = api.attach(window, deskHooks);
  if (!r || !r.ok) { deskBlocked = (r && r.reason) || 'Gerade nicht möglich.'; render(); return; }
  pets = api;
  for (const [id, at] of Object.entries(state.desk.out)) {
    const p = state.pets.find((x) => x.id === id);
    if (p) pets.restore(visualOf(p), at);
  }
  syncDesk();
  render();
  addEventListener('pagehide', () => { try { pets.detach(window); } catch { /* egal */ } });
}

const store = createStore({
  savesUrl: config.savesUrl,
  ls: (() => { try { return window.localStorage; } catch { return null; } })(),
  onStatus: ({ status }) => {
    const [short, long] = SAVE_TEXT[status] || [status, status];
    const el = $('save-status');
    el.textContent = short; el.title = long;
    if (status === 'loggedout') say(long, 8000);
  },
  onReplace: (s) => { state = s; render(); },
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const num = (n) => n.toLocaleString('de-DE');
const coins = (n) => `${iconSvg('coin')} ${num(n)}`;          // für HTML
const coinsText = (n) => `${num(n)} ${n === 1 ? 'Münze' : 'Münzen'}`;
const effectText = (eff = {}, mult = 1) => Object.entries(eff)
  .map(([k, v]) => `${v > 0 ? '+' : ''}${Math.round(v * (v > 0 ? mult : 1))} ${STAT_NAME[k].label}`).join(', ');
const speciesList = (ids) => ids.map((id) => (SPECIES[id] ? SPECIES[id].name : id)).join(', ');
const days = (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`;
const listNames = (l) => (l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' und ' + l[l.length - 1]);
const bar = (v, cls = '', label = '') => `<span class="bar${cls ? ' ' + cls : ''}"${label ? ` role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}"` : ''}><i style="width:${Math.max(0, Math.min(100, Math.round(v)))}%"></i></span>`;

// Inhalt nur ersetzen, wenn er sich geändert hat: So bleiben Fokus, Bildlauf und laufende Bewegungen erhalten
function put(el, html, sig = html) {
  if (!el || el._sig === sig) return false;
  el._sig = sig;
  el.innerHTML = html;
  return true;
}

// ---------- Dialog im Windows-Stil ----------
function dialog(title, html, buttons) {
  closeMenu();
  const dlg = $('dlg');
  $('dlg-title').textContent = title;
  $('dlg-body').innerHTML = html;
  const actions = $('dlg-actions');
  actions.innerHTML = '';
  // Standardknopf (dicker Rand, Eingabetaste): ausdrücklich gewählt oder der einzige. Esc wählt immer den letzten.
  const def = buttons.find((b) => b.def) || (buttons.length === 1 ? buttons[0] : null);
  for (const b of buttons) {
    const el = document.createElement('button');
    el.value = b.value; el.textContent = b.label;
    el.className = [b.danger ? 'danger' : '', b === def ? 'def' : ''].filter(Boolean).join(' ');
    actions.append(el);
  }
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue || buttons[buttons.length - 1].value), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    (dlg.querySelector('input:not([type=radio])') || actions.querySelector('.def') || actions.querySelector('button')).focus();
  });
}

const ok = (title, html) => dialog(title, html, [{ label: 'OK', value: 'ok' }]);

// ---------- Aufklappmenüs (Pflege-Leiste, Kiste, rechte Maustaste, Mehr) ----------
// items: [{ icon, label, sub, run, off, title, dot } | '-']
let menuItems = [], menuFrom = null;
function openMenu(anchor, items, { x, y, up = false, head = '' } = {}) {
  closeMenu();
  const m = $('menu');
  m.innerHTML = (head ? `<div class="mhead">${esc(head)}</div>` : '') + items.map((it, i) => (it === '-' ? '<hr>'
    : `<button type="button" class="mi" role="menuitem" data-i="${i}"${it.off ? ' disabled' : ''}${it.title ? ` title="${esc(it.title)}"` : ''}>
      <span class="mic" aria-hidden="true">${it.icon || ''}</span><span>${esc(it.label)}</span><small>${it.sub ? esc(it.sub) : ''}${it.dot ? '<i class="dot"></i>' : ''}</small></button>`)).join('');
  menuItems = items;
  m.hidden = false;
  const mw = m.offsetWidth, mh = m.offsetHeight, vw = innerWidth, vh = innerHeight;
  let left = x, top = y;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    left = r.left;
    if (left + mw > vw - 4) left = r.right - mw;
    // Unten im Fenster (Pflege-Leiste) klappt das Menü nach oben auf
    up = up || r.bottom + mh > vh - 4;
    top = up ? r.top - mh : r.bottom;
    menuFrom = anchor;
    anchor.setAttribute('aria-expanded', 'true');
  } else if (up) top = y - mh;
  m.style.left = Math.max(4, Math.min(left, vw - mw - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(top, vh - mh - 4)) + 'px';
  const first = m.querySelector('.mi:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
  sfx('klick');
}
function closeMenu(refocus = false) {
  const m = $('menu');
  if (m.hidden) return;
  m.hidden = true;
  m.innerHTML = '';
  if (menuFrom) { menuFrom.setAttribute('aria-expanded', 'false'); if (refocus) menuFrom.focus(); }
  menuFrom = null;
}
function wireMenu() {
  const m = $('menu');
  m.addEventListener('click', (e) => {
    const b = e.target.closest('.mi');
    if (!b || b.disabled) return;
    const it = menuItems[+b.dataset.i];
    closeMenu();
    if (it && it.run) it.run();
  });
  m.addEventListener('keydown', (e) => {
    const list = [...m.querySelectorAll('.mi:not(:disabled)')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      if (n) list[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % n].focus();
    } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (list.length) list[e.key === 'Home' ? 0 : list.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu();
  });
  document.addEventListener('pointerdown', (e) => {
    if (m.hidden || m.contains(e.target) || (menuFrom && menuFrom.contains(e.target))) return;
    closeMenu();
  }, true);
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('blur', () => closeMenu());
}
// Ein Knopf mit Menü schaltet es auf und zu
function toggleMenu(anchor, build, opts) {
  if (menuFrom === anchor) { closeMenu(); return; }
  openMenu(anchor, build(), opts);
}

// ---------- Oberfläche ----------
function render() {
  if (!state.pets.length) { view = 'adopt'; pane = null; }
  if (view !== 'room') { tryOn = null; if (scene.toy) scene.putAway(); }
  if (pane !== 'shop' || shop.tab !== 'acc') tryOn = null;
  if (pane === 'home' && (visit || view !== 'room')) pane = null;
  bars();
  drawStage();
  drawPane();
  updateNotice();
  syncFurnish();
  syncDesk();
}

// Werkzeugleiste und Statusleiste
function bars() {
  const has = state.pets.length > 0;
  for (const b of document.querySelectorAll('#tbar [data-view]')) {
    const v = b.dataset.view;
    const on = v === 'room' ? (view === 'room' && !visit) || view === 'adopt' : v === 'visit' ? view === 'visit' || !!visit : view === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !has;
  }
  for (const b of document.querySelectorAll('#tbar [data-pane]')) {
    const on = pane === b.dataset.pane;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !has;
  }
  const d = ensureDaily(state);
  const open = d.tasks.filter((t) => !t.done).length + (checkinDone(state) ? 0 : 1);
  $('task-count').textContent = open ? `(${open})` : '';
  const g = $('gates-btn');
  g.hidden = !pets;
  g.disabled = !has || !!visit;
  g.classList.toggle('on', !!pets && (state.desk.gates.l > 0 || state.desk.gates.r > 0));
  const out = state.pets.filter((p) => isOut(p.id)).length;
  g.title = out ? `Tore zum Desktop · ${out} draußen` : 'Tore zum Desktop';
  put($('coins'), coins(state.coins));
  $('streak').textContent = `🔥 ${days(state.visits.streak)}`;
  $('status-log').textContent = statusText();
}

function statusText() {
  if (logLine && logLine.until > Date.now()) return logLine.text;
  if (!state.pets.length) return 'Willkommen bei Pixelpfoten! Such dir ein Tier aus.';
  if (view === 'room' && visit) return hostMember() ? `${visit.host.name} ist gerade auch hier.` : `Zu Besuch bei ${visit.host.name}.`;
  if (view === 'room') return mood(activePet(state)).text;
  if (view === 'trip') return trip ? 'Leertaste oder Tippen zum Springen, Esc bricht ab.' : `Wohin geht es mit ${activePet(state).name}?`;
  if (view === 'visit') return 'Schau bei den Tieren anderer Mitglieder vorbei.';
  if (view === 'adopt') return 'Ein weiteres Tier adoptieren.';
  return '';
}

// Meldung in der Statusleiste (bleibt eine Weile stehen, dann zeigt sie wieder die Laune)
let logTimer = 0;
function log(text, ms = 12000) {
  logLine = { text, until: Date.now() + ms };
  $('status-log').textContent = text;
  clearTimeout(logTimer);
  logTimer = setTimeout(() => { $('status-log').textContent = statusText(); }, ms + 50);
}

// Meldung des Spiels: oben im Zimmer (sonst nur in der Statusleiste)
let bubbleTimer = 0;
function say(text, ms = 4000) {
  bubble = { text, until: Date.now() + ms };
  const el = $('bubble');
  if (el) el.textContent = text;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { const b = $('bubble'); if (b) b.textContent = bubbleText(); }, ms + 50);
  log(text, Math.max(ms, 8000));
}
const bubbleText = () => (bubble && bubble.until > Date.now() ? bubble.text : '');

// Ein Tier sagt etwas: Sprechblase über ihm im Zimmer, dazu in der Statusleiste
function tell(key, text, ms = 4000) {
  if (typeof key === 'object' && key) key = key.id;
  log(text, Math.max(ms, 8000));
  if (view === 'room' && $('room')) scene.speak(key, esc(text), ms);
}

// ---------- Spielfläche ----------
function drawStage() {
  const el = $('screen');
  if (view === 'room') {
    const key = visit ? `v:${visit.host.user}:${visit.data.room}` : state.room;
    const names = roster().map((e) => e.pet.name).join(', ');
    if (put(el, `<div class="room" id="room" aria-label="Zimmer${visit ? ' von ' + esc(visit.host.name) : ''} mit ${esc(names)}">
        ${roomSvg(visit ? visit.data.room : state.room)}<div class="bubble" id="bubble" aria-live="polite"></div></div>
      <div class="dock" id="dock" role="toolbar" aria-label="${visit ? 'Besuch' : 'Pflege'}"></div>`, 'room:' + key)) {
      el.className = 'stage';
      scene.mount($('room'));
    }
    updateRoom();
    return;
  }
  if (view === 'trip') {
    if (trip) { if (put(el, '<div id="run-host" class="run-host"></div>', 'run')) el.className = 'stage'; return; }
    const pet = activePet(state);
    if (!placeOpen(pet, tripPlace)) tripPlace = 'park';
    // Beim Wettbewerb zeigt die Vorschau die Strecke des Tages, sonst den gewählten Ort
    const race = tripTab === 'contest' && store.mode === 'account' && contest && !contest.error ? contest.place : null;
    const place = race || tripPlace;
    const sig = ['trip', pet.id, pet.species, pet.color, JSON.stringify(pet.acc), place, !!race].join('|');
    if (put(el, '<div id="run-host" class="run-host"></div><div class="dock" id="dock" role="toolbar" aria-label="Ausflug"></div>', sig)) {
      el.className = 'stage';
      previewRun($('run-host'), { place, pet, sign: race ? `Wettbewerb: ${PLACES[race].name}` : PLACES[place].name });
    }
    put($('dock'), race ? contestDock(pet) : tripDock(pet));
    return;
  }
  const html = view === 'adopt' ? adoptHtml() : neighboursHtml();
  const sig = view === 'adopt' ? ['adopt', picked, state.pets.length, petSlots(state), state.visits.best].join('|') : html;
  if (put(el, html, sig)) { el.className = 'stage scroll'; el.scrollTop = 0; }
}

// Im offenen Zimmer nur die Teile drumherum erneuern, die Szene mit den Tieren läuft weiter
function updateRoom() {
  $('bubble').textContent = bubbleText();
  put($('dock'), visit ? visitDock() : careDock(activePet(state)));
  $('room').classList.toggle('night', !visit && allAsleep());
  scene.sync();
}

const allAsleep = () => state.pets.length > 0 && state.pets.every((p) => p.sleeping);

// Knopf der Pflege-Leiste: Pixelbild und Beschriftung (auf dem Handy nur das Bild)
const dockBtn = (attrs, icon, label, { def = false, dim = false, more = false, title = label } = {}) =>
  `<button type="button" ${attrs}${def ? ' class="def"' : dim ? ' class="dim"' : ''} title="${esc(title)}"${more ? ' aria-haspopup="menu" aria-expanded="false"' : ''}>${icon} <span class="bl">${esc(label)}</span>${more ? '<span class="arrow" aria-hidden="true">▼</span>' : ''}</button>`;

function careDock(pet) {
  if (pet.sleeping) {
    const awake = state.pets.find((p) => !p.sleeping);
    return dockBtn('data-act="wake"', iconSvg('star'), 'Aufwecken', { def: true })
      + `<span class="note">Psst, ${esc(pet.name)} schläft.${awake ? ` ${esc(awake.name)} ist wach.` : ''}</span>`;
  }
  const low = NEED_ACT[lowestNeed(pet)];
  const can = (a) => canDo(pet, a, state).ok;
  const food = usableItems(state, pet, 'food')[0];
  const toy = toyIds()[0];
  return dockBtn('data-act="pet"', iconSvg('heart'), 'Streicheln', { def: low === 'pet' })
    + dockBtn('data-menu="feed"', iconSvg(food || 'food_dry'), 'Füttern', { def: low === 'feed', dim: !can('feed'), more: true })
    + dockBtn('data-act="water"', iconSvg('drop'), 'Wasser', { def: low === 'water', dim: !can('water'), title: 'Wasser geben' })
    + dockBtn('data-menu="play"', iconSvg(scene.toy || toy || 'toy_ball'), 'Spielen', { def: low === 'play', dim: !toy, more: true })
    + dockBtn('data-act="sleep"', iconSvg('zzz'), 'Schlafen', { def: low === 'sleep', dim: !can('sleep'), title: 'Schlafen legen' })
    + '<span class="tsep"></span>'
    + dockBtn('data-menu="care"', iconSvg('paw'), 'Weiteres', { more: true, title: 'Kuscheln, Bürsten, Baden, Ausflug …' });
}

function visitDock() {
  const brought = state.pets.find((p) => p.id === visit.bring);
  return dockBtn('data-home', iconSvg('house'), 'Nach Hause')
    + '<span class="tsep"></span>'
    + dockBtn('data-menu="bring"', brought ? `<span aria-hidden="true">${SPECIES[brought.species].icon}</span>` : iconSvg('paw'), 'Mitbringen', { more: true, title: 'Eigenes Tier mitbringen' })
    + dockBtn('data-menu="gift"', iconSvg('gift'), 'Schenken', { more: true, title: 'Futter schenken' })
    + dockBtn('data-menu="greet"', iconSvg('note'), 'Gruß', { more: true, dim: visit.greeted, title: visit.greeted ? 'Dein Gruß steht schon im Besuchsbuch' : 'Gruß im Besuchsbuch hinterlassen' })
    + dockBtn('data-menu="play"', iconSvg(scene.toy || toyIds(true)[0] || 'toy_ball'), 'Spielen', { more: true, dim: !toyIds(true).length });
}

// Spielzeug aus der Kiste, mit dem eines der Tiere spielen kann (beim Besuch: alles, was man hat)
function toyIds(all = !!visit) {
  return Object.keys(state.inventory).filter((id) => ITEMS[id] && ITEMS[id].cat === 'toy' && TOYS[id] && state.inventory[id] > 0 && !state.place[id]
    && (all || state.pets.some((p) => usableBy(ITEMS[id], p.species))));
}

// ---------- Menüs der Pflege-Leiste ----------
function feedItems(pet) {
  const ids = usableItems(state, pet, 'food');
  const items = ids.map((id) => {
    const it = ITEMS[id], fav = isFav(it, pet.species);
    return { icon: iconSvg(id), label: it.name + (fav ? ' ❤' : ''), sub: `× ${state.inventory[id]}`, title: effectText(it.effect, fav ? 1.5 : 1), run: () => act('feed', id) };
  });
  if (!items.length) items.push({ label: `Kein Futter für ${pet.name}`, off: true });
  const bowl = [];
  if (state.place.furn_bowl_food) {
    const b = state.bowls.food;
    bowl.push('-', { icon: iconSvg('furn_bowl_food'), label: 'Futternapf füllen …', sub: b ? `${Math.round(b.left * 100)} %` : 'leer', run: () => openMenu(dockAnchor('feed'), pourItems(), { up: true, head: 'Futternapf füllen' }) });
  }
  if (state.place.furn_bowl_water) bowl.push(...(bowl.length ? [] : ['-']), { icon: iconSvg('furn_bowl_water'), label: 'Wassernapf füllen', sub: `${Math.round(state.bowls.water * 100)} %`, run: fill });
  return [...items, ...bowl, '-', { icon: '🛒', label: 'Futter kaufen …', run: () => openShop('food') }];
}
const dockAnchor = (menu) => document.querySelector(`#dock [data-menu="${menu}"]`);

function playItems() {
  const pet = activePet(state);
  const ids = toyIds().sort((a, b) => usableBy(ITEMS[b], pet.species) - usableBy(ITEMS[a], pet.species) || isFav(ITEMS[b], pet.species) - isFav(ITEMS[a], pet.species));
  const items = [];
  if (scene.toy) items.push({ icon: iconSvg('chest'), label: `${ITEMS[scene.toy].name} wegräumen`, run: () => { scene.putAway(); sfx('klick'); render(); } }, '-');
  for (const id of ids) {
    const it = ITEMS[id];
    const mine = visit || usableBy(it, pet.species);
    const tired = (pet.fatigue['play:' + id] || 0) >= 3;
    items.push({
      icon: iconSvg(id), label: it.name + (!visit && isFav(it, pet.species) ? ' ❤' : ''),
      sub: scene.toy === id ? 'draußen' : !mine ? `nicht für ${pet.name}` : tired && !visit ? 'gerade langweilig' : '',
      title: TOYS[id].hint, run: () => takeToy(id),
    });
  }
  if (!ids.length) items.push({ label: 'Noch kein Spielzeug', off: true });
  return [...items, '-', { icon: '🛒', label: 'Spielzeug kaufen …', run: () => openShop('toy') }];
}

// Weitere Pflege: was gesperrt ist, sagt warum und führt notfalls zum Shop
function careItems(pet) {
  const items = [];
  const entry = (a, label, needs) => {
    const c = canDo(pet, a, state);
    if (needs && !owned(state, needs)) return { icon: iconSvg(ACT_ICON[a]), label, sub: 'im Shop', title: `Dafür brauchst du: ${ITEMS[needs].name}`, run: () => openShop('care', needs) };
    const locked = a === 'cuddle' && level(pet) < CUDDLE_LEVEL;
    return { icon: iconSvg(locked ? 'lock' : ACT_ICON[a]), label, sub: locked ? `ab Stufe ${CUDDLE_LEVEL}` : '', off: locked, title: c.ok ? '' : c.reason, run: () => act(a) };
  };
  items.push(entry('cuddle', 'Kuscheln'), entry('brush', 'Bürsten', 'care_brush'), entry('bath', 'Baden', 'care_soap'));
  const gear = walkGear(pet.species);
  items.push(gear && !canTrip(state, pet)
    ? { icon: iconSvg(gear), label: walkLabel(pet.species), sub: 'im Shop', title: `Dafür brauchst du: ${ITEMS[gear].name}`, run: () => openShop('care', gear) }
    : { icon: iconSvg('room_garden'), label: walkLabel(pet.species) + ' …', run: () => act('walk') });
  items.push('-', { icon: '✎', label: 'Umbenennen …', run: rename });
  if (state.pets.length < petSlots(state)) items.push({ icon: '＋', label: 'Weiteres Tier adoptieren …', run: () => goAdopt() });
  return items;
}

// Rechte Maustaste (oder lange drücken) auf ein Tier
function petMenu(e, x, y) {
  if (e.kind !== 'own') {
    openMenu(null, [{ icon: iconSvg('heart'), label: 'Streicheln', off: e.pet.sleeping, run: () => foreign(e, 'pet') }], { x, y, head: `${e.pet.name} · ${e.owner}` });
    return;
  }
  const pet = state.pets.find((p) => p.id === e.pet.id);
  if (!pet || visit) return;
  selectPet(pet.id);
  const items = pet.sleeping ? [{ icon: iconSvg('star'), label: 'Aufwecken', run: () => act('wake') }] : [
    { icon: iconSvg('heart'), label: 'Streicheln', run: () => act('pet') },
    level(pet) >= CUDDLE_LEVEL ? { icon: iconSvg('heart'), label: 'Kuscheln', run: () => act('cuddle') } : { icon: iconSvg('lock'), label: 'Kuscheln', sub: `ab Stufe ${CUDDLE_LEVEL}`, off: true },
    '-', ...feedItems(pet).filter((it) => it !== '-' && it.run && it.label !== 'Futter kaufen …').slice(0, 4),
    '-', { icon: iconSvg('drop'), label: 'Wasser geben', run: () => act('water') }, { icon: iconSvg('zzz'), label: 'Schlafen legen', run: () => act('sleep') },
  ];
  openMenu(null, [...items, '-', { icon: '✎', label: 'Umbenennen …', run: rename }], { x, y, head: pet.name });
}

function bringItems() {
  const opts = [{ id: null, label: 'Niemand', icon: '' }, ...state.pets.map((p) => ({ id: p.id, label: p.name, icon: SPECIES[p.species].icon }))];
  return opts.map((o) => ({ icon: o.icon, label: o.label, sub: (visit.bring || null) === o.id ? '✔' : '', run: () => bringPet(o.id) }));
}

function giftItems() {
  const ids = Object.keys(state.inventory).filter((id) => giftable(id) && state.inventory[id] > 0);
  if (!ids.length) return [{ label: 'Kein Futter zum Verschenken', off: true }, '-', { icon: '🛒', label: 'Futter kaufen …', run: () => openShop('food') }];
  return ids.map((id) => ({ icon: iconSvg(id), label: ITEMS[id].name, sub: `× ${state.inventory[id]}`, run: () => giveGift(id) }));
}

function greetItems() {
  if (visit.greeted) return [{ label: 'Dein Gruß steht schon im Besuchsbuch.', off: true }];
  return STICKERS.map((s) => ({ icon: s, label: `Gruß ${s} dalassen`, run: () => leaveSticker(s) }));
}

// Tore zum Desktop: beide auf einmal, wer raus darf, alle heimrufen. Einzeln geht es am Griff im Zimmer.
function gateItems() {
  const g = state.desk.gates, both = g.l === g.r ? g.l : -1;
  const set = (v) => () => setGate('both', v);
  const items = [
    { icon: '🟩', label: 'Tore öffnen', sub: both === 2 ? '✔' : '', run: set(2) },
    { icon: '🟨', label: 'Halb öffnen', sub: both === 1 ? '✔' : 'nur kleine Tiere', title: 'Hamster, Ratten und Axolotl passen durch', run: set(1) },
    { icon: '🟥', label: 'Tore schließen', sub: both === 0 ? '✔' : '', run: set(0) },
    '-', { label: 'Wer darf raus?', off: true },
    ...state.pets.map((p) => {
      const stay = state.desk.stay.includes(p.id);
      return { icon: SPECIES[p.species].icon, label: p.name, sub: isOut(p.id) ? 'draußen' : stay ? 'bleibt drin' : '✔ darf raus', run: () => toggleStay(p.id) };
    }),
  ];
  const out = state.pets.filter((p) => isOut(p.id));
  items.push('-', { icon: iconSvg('house'), label: out.length > 1 ? 'Alle heimrufen' : 'Heimrufen', sub: out.length ? `${out.length} draußen` : '', off: !out.length, run: () => callHome() });
  items.push({ icon: '🖥️', label: 'Desktop einrichten …', run: () => openHome('desk') }, { icon: '⚙️', label: 'Optionen …', run: () => showSettings('desk') });
  return items;
}
function toggleStay(id) {
  const list = state.desk.stay, i = list.indexOf(id), pet = state.pets.find((p) => p.id === id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
  sfx('klick');
  store.save(state);
  render();
  log(i >= 0 ? `${pet.name} darf auf den Desktop.` : `${pet.name} bleibt im Zimmer.`, 4000);
  if (i < 0 && isOut(id)) callHome(id);
}

function moreItems() {
  const items = [
    { icon: '📜', label: 'Neuigkeiten', dot: !$('news-dot').hidden, run: showNews },
    { icon: '❔', label: 'Hilfe', run: showHelp },
    { icon: muted() ? '🔇' : '🔊', label: muted() ? 'Ton einschalten' : 'Ton ausschalten', run: () => { toggleMuted(); sfx('pop'); } },
    '-', { icon: '⚙️', label: 'Einstellungen …', run: () => showSettings() },
  ];
  if (store.mode !== 'account') {
    items.push('-', { icon: '👤', label: 'Anmelden …', run: () => openLink(config.loginUrl) });
    if (config.registerUrl) items.push({ icon: '🎁', label: 'Konto erstellen …', sub: `+${ACCOUNT_BONUS}`, run: () => openLink(config.registerUrl) });
  }
  return items;
}

// ---------- Seitenfach ----------
function drawPane() {
  const el = $('pane');
  const html = paneHtml();
  el.hidden = !html;
  el.classList.toggle('wide', pane === 'shop');
  if (!html) { put(el, ''); return; }
  const old = el.querySelector('.pane-page');
  const page = old ? old.dataset.page : null, scroll = old ? old.scrollTop : 0;
  const f = document.activeElement && el.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  if (!put(el, html)) return;
  const now = el.querySelector('.pane-page');
  if (now && now.dataset.page === page) now.scrollTop = scroll;
  if (f) { const t = el.querySelector(f); if (t) t.focus({ preventScroll: true }); }
}

// Woran sich ein Bedienelement nach dem Neuzeichnen wiederfinden lässt
function focusKey(el) {
  for (const [k, v] of Object.entries(el.dataset)) return `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${CSS.escape(v)}"]`;
  return el.name ? `[name="${CSS.escape(el.name)}"]` : null;
}

function paneHtml() {
  if (!state.pets.length || view === 'adopt') return '';
  if (pane === 'shop') return shopPane();
  if (pane === 'tasks') return tasksPane();
  if (pane === 'home') return homePane();
  if (view === 'room') return visit ? visitPane() : petPane();
  if (view === 'trip') return tripPane();
  if (view === 'visit') return store.mode === 'account' ? bookPane() : '';
  return '';
}

const paneTabs = (tabs, close = '') => `<div class="tabs" role="tablist">${tabs}</div>${close ? `<button type="button" class="pane-x" data-close title="${esc(close)} schließen" aria-label="${esc(close)} schließen">✕</button>` : ''}`;
const tab = (attrs, label, on) => `<button type="button" class="tab${on ? ' on' : ''}" role="tab" aria-selected="${on}" ${attrs}>${label}</button>`;

function petTabs(withAdd) {
  const cur = activePet(state);
  const tabs = state.pets.map((p) => tab(`data-pet="${p.id}"`, `${SPECIES[p.species].icon} ${esc(p.name)}`, p === cur)).join('');
  if (!withAdd) return tabs;
  const free = state.pets.length < petSlots(state);
  return tabs + `<button type="button" class="tab" data-adopt title="${esc(free ? 'Weiteres Tier adoptieren' : nextSlotHint(state) || 'Kein Platz für ein weiteres Tier')}"${free ? '' : ' aria-disabled="true"'}>＋</button>`;
}

function petPane() {
  const pet = activePet(state);
  const sp = SPECIES[pet.species], m = mood(pet), lp = levelProgress(pet), lvl = level(pet);
  const next = Object.keys(LEVEL_NEXT).map(Number).sort((a, b) => a - b).find((l) => l > lvl);
  const needs = STATS.map(({ key, label }) => {
    const v = Math.round(pet.stats[key]), low = v < 25;
    return `${iconSvg(ICON_OF[key])}<span class="${low ? 'low' : ''}">${label}</span>${bar(v, low ? 'low' : '', label)}`;
  }).join('');
  const worn = ['head', 'neck', 'back'].map((s) => pet.acc[s]).filter((id) => id && ITEMS[id]).map((id) => ITEMS[id].name);
  return paneTabs(petTabs(true)) + `<div class="pane-page" data-page="pet:${pet.id}">
    <div class="pet-card"><div class="portrait">${petSvg(pet.species, pet.color, m.face, { acc: pet.acc, shadow: false, title: pet.name })}</div>
      <div><b>${esc(pet.name)}</b> <button type="button" class="mini" data-rename title="Umbenennen" aria-label="${esc(pet.name)} umbenennen">✎</button>
        <small>${sp.name} · Stufe ${lvl}</small><small>${esc(m.text.slice(pet.name.length + 1))}</small></div></div>
    <div class="love"><span>Zuneigung</span>${bar(lp.need ? (100 * lp.have) / lp.need : 100, 'xp', 'Zuneigung')}<small>${lp.need ? `${lp.have}/${lp.need}` : 'max'}</small></div>
    ${next ? `<small class="unlock">Ab Stufe ${next}: ${esc(LEVEL_NEXT[next])}</small>` : ''}
    <fieldset class="groupbox"><legend>Bedürfnisse</legend><div class="needs">${needs}</div></fieldset>
    <div class="wear"><span>Trägt: ${worn.length ? esc(worn.join(', ')) : 'nichts'}</span><button type="button" class="small" data-dress>Anziehen …</button></div>
    ${diaryHtml(pet)}</div>`;
}

// ---------- Tagebuch: was zuletzt los war ----------
function note(text, pet = null) {
  state.diary = [{ at: Date.now(), text, ...(pet ? { pet: pet.id } : {}) }, ...(state.diary || [])].slice(0, 20);
}
function when(at) {
  const d = new Date(at), now = new Date();
  const day = dayKey(at), today = dayKey(now.getTime()), yesterday = dayKey(now.getTime() - 86400000);
  if (day === today) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (day === yesterday) return 'gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
function diaryHtml(pet) {
  const list = (state.diary || []).filter((e) => !e.pet || e.pet === pet.id).slice(0, 6);
  if (!list.length) return '';
  return `<fieldset class="groupbox"><legend>Tagebuch</legend><ul class="diary">${list.map((e) => `<li><b>${when(e.at)}</b><span>${esc(e.text)}</span></li>`).join('')}</ul></fieldset>`;
}

// ---------- Shop im Fach (ersetzt das Inventar: was man hat, steht mit Häkchen da) ----------
function shopList() {
  const pet = activePet(state);
  return ITEM_LIST.filter((i) => i.cat === shop.tab && relevant(state, i) && (!i.notForSale || owned(state, i.id)))
    .filter((i) => !(i.req && i.req.owns) || available(state, i).ok)
    .filter((i) => !shop.mine || i.cat === 'acc' || i.cat === 'room' || usableBy(i, pet.species));
}

const hasItem = (item) => isDurable(item) && (owned(state, item.id) || (item.id === 'extra_slot' && !!state.extraSlots));

function itemInfo(item) {
  const pet = activePet(state);
  const bits = [];
  if (item.effect) bits.push(effectText(item.effect));
  if (item.note) bits.push(esc(item.note));
  if (item.for) bits.push(`Für: ${speciesList(item.for)}`);
  if (item.except) bits.push(`Nicht für: ${speciesList(item.except)}`);
  if (item.fav) bits.push(isFav(item, pet.species) ? `❤ Liebling von ${esc(pet.name)}` : `❤ Liebling von: ${speciesList(item.fav)}`);
  return bits.map((b) => `<small>${b}</small>`).join('');
}

function shopPick(item) {
  const pet = activePet(state);
  const av = available(state, item), c = canBuy(state, item.id), price = priceOf(state, item);
  const have = state.inventory[item.id] || 0, hasIt = hasItem(item);
  const wearing = item.cat === 'acc' && pet.acc[item.slot] === item.id;
  const pic = item.cat === 'acc' ? petSvg(pet.species, pet.color, 'happy', { acc: { ...pet.acc, [item.slot]: item.id }, shadow: false, title: `${pet.name} mit ${item.name}` })
    : item.cat === 'room' ? roomSvg(item.id) : iconSvg(item.id, 'pxi x4');
  const priceHtml = !item.price ? (item.notForSale ? 'Geschenk' : 'Gratis') : price !== item.price ? `<s>${item.price}</s> ${coins(price)}` : coins(price);
  const btns = [];
  if (!hasIt && !item.notForSale) {
    btns.push(av.ok ? `<button type="button" class="${c.ok ? 'def' : ''}" data-buy="${item.id}" title="${esc(c.ok ? 'Kaufen' : c.reason)}"${c.ok ? '' : ' aria-disabled="true"'}>${item.price ? 'Kaufen' : 'Freischalten'}</button>`
      : `<button type="button" disabled>🔒 ${esc(av.reason)}</button>`);
  }
  if (item.cat === 'acc' && hasIt) btns.push(`<button type="button"${wearing ? '' : ' class="def"'} data-wear="${item.id}">${wearing ? 'Ablegen' : 'Anziehen'}</button>`);
  else if (item.cat === 'acc') btns.push(`<button type="button" data-try="${item.id}" aria-pressed="${tryOn === item.id}">${tryOn === item.id ? 'Ausziehen' : 'Anprobieren'}</button>`);
  if (item.cat === 'room' && hasIt) btns.push(state.room === item.id ? '<span class="owned">✔ eingerichtet</span>' : `<button type="button" class="def" data-room="${item.id}">Einrichten</button>`);
  if (item.cat === 'toy' && hasIt && TOYS[item.id] && !state.place[item.id]) btns.push(`<button type="button" data-take="${item.id}">Herausholen</button>`);
  if (hasIt && FURN[item.id]) btns.push(...placeButtons(item.id));
  let status = '';
  const where = state.place[item.id] ? (state.place[item.id].at === 'room' ? 'steht im Zimmer' : 'steht auf dem Desktop') : '';
  if (hasIt && item.cat !== 'room') status = `<span class="owned">✔ ${wearing ? `${esc(pet.name)} trägt es` : where || 'gehört dir'}</span>`;
  else if (have) status = `<span class="owned">Vorrat: ${have}</span>`;
  else if (av.ok && !c.ok && !item.notForSale) status = `<small>${esc(c.reason)}</small>`;
  return `<div class="shop-pick"><div class="shop-pic">${pic}</div><div class="shop-info"><b>${esc(item.name)}</b>
    <span class="price">${priceHtml}${item.id === dealOfDay(state) ? ' <span class="badge">−30 %</span>' : ''}</span>${itemInfo(item)}${status}
    <div class="row">${btns.join('')}</div></div></div>`;
}

function shopPane() {
  const pet = activePet(state);
  const list = shopList();
  const item = ITEMS[shop.pick] && ITEMS[shop.pick].cat === shop.tab ? ITEMS[shop.pick] : list[0];
  const deal = ITEMS[dealOfDay(state)];
  const icons = list.map((i) => {
    const av = available(state, i), hasIt = hasItem(i), have = state.inventory[i.id] || 0;
    const label = hasIt ? (i.cat === 'room' && state.room === i.id ? '✔ eingerichtet' : '✔ gehört dir') : !av.ok ? '🔒 gesperrt'
      : `${have ? `× ${have} · ` : ''}${i.price ? '🪙 ' + priceOf(state, i) : i.notForSale ? 'Geschenk' : 'gratis'}`;
    return `<button type="button" class="ico${item && i.id === item.id ? ' sel' : ''}${av.ok ? '' : ' locked'}" data-pick="${i.id}" title="${esc(i.name)}" aria-pressed="${!!item && i.id === item.id}">
      ${iconSvg(i.id, 'pxi x2')}<span>${esc(i.name)}${isFav(i, pet.species) ? ' ❤' : ''}</span><small>${label}</small></button>`;
  }).join('');
  const dealBtn = deal && relevant(state, deal)
    ? `<button type="button" class="deal" data-pick="${deal.id}" data-tab-of="${deal.cat}">⭐ Angebot des Tages: ${iconSvg(deal.id)} <b>${esc(deal.name)}</b> <span class="badge">−30 %</span></button>` : '';
  const filter = ['food', 'toy', 'care'].includes(shop.tab)
    ? `<label class="check"><input type="checkbox" data-mine${shop.mine ? ' checked' : ''}> Nur was zu ${esc(pet.name)} passt</label>` : '';
  return paneTabs(SHOP_TABS.map(([id, label]) => tab(`data-stab="${id}"`, label, shop.tab === id)).join(''), 'Shop')
    + `<div class="pane-page" data-page="shop:${shop.tab}">${dealBtn}${item ? shopPick(item) : '<p class="muted">Hier gibt es gerade nichts.</p>'}
      ${filter}<div class="field icons">${icons}</div></div>`;
}

// Aufstellen, umstellen, ins Fach: dieselben Knöpfe im Shop und beim Einrichten
function placeButtons(id, only = null) {
  const p = state.place[id], out = [];
  const to = (at, label, def) => `<button type="button" class="small${def ? ' def' : ''}" data-placeto="${at}:${id}">${label}</button>`;
  if (canPlace(id, 'room') && (!only || only === 'room') && !(p && p.at === 'room')) out.push(to('room', p ? 'Ins Zimmer' : 'Aufstellen', !p && only === 'room'));
  if (canPlace(id, 'desk') && (!only || only === 'desk') && deskReady() && !(p && p.at === 'desk')) out.push(to('desk', p || only !== 'desk' ? 'Auf den Desktop' : 'Aufstellen', !p && only === 'desk'));
  if (p && id !== 'furn_chest') out.push(`<button type="button" class="small" data-unplace="${id}">Ins Fach</button>`);
  return out;
}

// Freier Platz für ein neues Teil: möglichst weit weg von dem, was schon steht
function freeSpot(id, at) {
  const f = FURN[id];
  const taken = Object.entries(state.place).filter(([k, p]) => k !== id && p.at === at && FURN[k] && !!FURN[k].wall === !!f.wall).map(([, p]) => p.x);
  const xs = [0.5, 0.3, 0.7, 0.16, 0.84, 0.4, 0.6, 0.08, 0.92];
  const gap = (x) => (taken.length ? Math.min(...taken.map((t) => Math.abs(t - x))) : 1);
  const x = xs.reduce((b, v) => (gap(v) > gap(b) + 0.01 ? v : b));
  const y = at === 'desk' ? (f.wall ? 0.55 : 1) : f.wall ? 0.75 : f.flat ? 0.55 : 0.12;
  return { x, y };
}

function placeTo(id, at, quiet = false) {
  const spot = state.place[id] && state.place[id].at === at ? state.place[id] : freeSpot(id, at);
  const r = placeItem(state, id, at, spot.x, spot.y);
  if (!r.ok) { if (!quiet) { sfx('nein'); log(r.reason, 5000); } return r; }
  placedNow = id;
  // Spielzeug auf dem Desktop liegt nicht mehr in der Kiste
  if (ITEMS[id].cat === 'toy' && scene.toy === id) scene.putAway();
  store.save(state);
  if (!quiet) { sfx('klick'); log(at === 'room' ? `${ITEMS[id].name} steht jetzt im Zimmer. Zieh es an seinen Platz.` : `${ITEMS[id].name} steht jetzt auf dem Desktop.`, 5000); }
  render();
  return r;
}
function takeBack(id) {
  if (id === 'furn_chest' || !unplace(state, id)) return;
  if (placedNow === id) placedNow = null;
  sfx('klick');
  store.save(state);
  render();
  log(`${ITEMS[id].name} liegt jetzt im Fach.`, 4000);
}

// ---------- Einrichten im Fach: Zimmer und Desktop ----------
function openHome(tab = homeTab) {
  closeMenu();
  if (visit) endVisit();
  if (view !== 'room') { abortTrip(); view = 'room'; }
  homeTab = tab === 'desk' && deskReady() ? 'desk' : 'room';
  pane = 'home';
  render();
}

function homePane() {
  const at = homeTab;
  const desk = deskReady();
  const ids = Object.keys(FURN).filter((id) => canPlace(id, at) && ITEMS[id] && owned(state, id));
  const here = ids.filter((id) => state.place[id] && state.place[id].at === at);
  const max = at === 'room' ? MAX_ROOM : MAX_DESK;
  const row = (id) => {
    const p = state.place[id];
    const where = !p ? 'im Fach' : p.at === 'room' ? 'im Zimmer' : 'auf dem Desktop';
    return `<li class="${p && p.at === at ? 'on' : ''}${placedNow === id ? ' sel' : ''}">${FURN[id].toy ? iconSvg(id, 'pxi furn-ico') : furnSvg(id, 'pxi furn-ico')}<span><b>${esc(ITEMS[id].name)}</b><small>${where}</small></span>
      <span class="row">${placeButtons(id, at).join('')}</span></li>`;
  };
  const sorted = [...here, ...ids.filter((id) => !here.includes(id))];
  const missing = ITEM_LIST.filter((i) => i.cat === 'furn' && !owned(state, i.id) && !i.notForSale).length;
  const tip = at === 'room'
    ? 'Zieh die Sachen im Zimmer an ihren Platz. Mit × wandern sie zurück ins Fach.'
    : 'Zieh die Sachen auf dem Desktop an ihren Platz. Regale rasten an der Wand ein, alles andere steht auf der Taskleiste.';
  const tabs = tab('data-htab="room"', '🏠 Zimmer', at === 'room')
    + (desk ? tab('data-htab="desk"', '🖥️ Desktop', at === 'desk') : '');
  return paneTabs(tabs, 'Einrichten') + `<div class="pane-page" data-page="home:${at}">
    <p class="hint">${tip}</p>
    <small class="muted">${here.length} von ${max} Plätzen belegt.</small>
    ${ids.length ? `<ul class="home-list field">${sorted.map(row).join('')}</ul>` : '<p class="muted">Noch nichts zum Aufstellen.</p>'}
    ${missing ? `<button type="button" class="small" data-gotoshop="furn:">🛒 Mehr Einrichtung im Shop (${missing})</button>` : ''}
    ${!desk ? `<small class="muted">${deskBlocked ? esc(deskBlocked) : 'Auf den Desktop geht es nur am Computer, wenn Pixelpfoten als Fenster auf dem Desktop offen ist.'}</small>` : ''}
    <div class="row end"><button type="button" class="def" data-close>Fertig</button></div></div>`;
}

// Beim Einrichten lassen sich die Teile im Zimmer (oder auf dem Desktop) ziehen
let furnishKey = '';
function syncFurnish() {
  const room = pane === 'home' && homeTab === 'room' && view === 'room' && !visit;
  const desk = pane === 'home' && homeTab === 'desk' && !!pets;
  const key = `${room}|${desk}|${placedNow}`;
  if (key === furnishKey) return;
  furnishKey = key;
  if (room || scene.furnishing) scene.furnish(room, placedNow);
  if (pets) try { pets.furnish(desk, placedNow); } catch { /* Desktop weg */ }
}

// ---------- Aufgaben im Fach ----------
function tasksPane() {
  const d = ensureDaily(state);
  const tasks = d.tasks.map((t) => {
    const info = TASK_INFO[t.id];
    const have = taskProgress(state, t);
    return `<div class="task${t.done ? ' done' : ''}"><span>${t.done ? '✔' : ''}</span><span>${esc(info.text)}</span>
      <span class="task-reward">${coins(info.reward)}</span>${bar(t.done ? 100 : (100 * have) / info.goal, t.done ? 'ok' : '')}
      <small class="task-n">${t.done ? info.goal : Math.min(have, info.goal)}/${info.goal}</small></div>`;
  }).join('');
  const ci = checkinDone(state)
    ? '<div class="task done"><span>✔</span><span>Fragen zu deinem Tag</span><small>erledigt</small></div>'
    : `<div class="task"><span></span><span>Wie war dein Tag? Drei kurze Fragen über dich</span><span></span>
       <button type="button" class="small" data-checkin>Beantworten</button></div>`;
  const cycle = ((Math.max(1, state.visits.streak) - 1) % 7) + 1;
  const bonus = LOGIN_BONUS.map((c, i) => `<div class="bonus-day${i + 1 < cycle ? ' past' : ''}${i + 1 === cycle ? ' today' : ''}">
      <small>Tag ${i + 1}</small><b>${c}</b></div>`).join('');
  return paneTabs(tab('', '📋 Heute', true), 'Aufgaben') + `<div class="pane-page" data-page="tasks">
    <div class="field tasks">${tasks || '<p>Heute keine Aufgaben.</p>'}${ci}</div>
    <small class="muted">Münzen aus Pflege heute: ${d.actionCoins} von ${DAILY_CAP}. Morgen gibt es neue Aufgaben.</small>
    <fieldset class="groupbox"><legend>🔥 ${days(state.visits.streak)} in Folge</legend><div class="bonus">${bonus}</div>
      <small class="muted">Login-Bonus: heute Tag ${cycle}. Nach Tag 7 gibt es ein Geschenk, dann beginnt die Woche von vorn.</small></fieldset>
    ${store.mode === 'guest' ? `<p class="hint">💾 Mit einem Konto bekommst du einmalig ${ACCOUNT_BONUS} Münzen und das Homepage-Halstuch.</p>` : ''}</div>`;
}

// ---------- Besuche ----------
function bookHtml(list, empty) {
  if (!list.length) return `<p class="muted">${empty}</p>`;
  return `<ul class="book">${list.map((b) => `<li><a href="${esc(b.url)}" target="_top">${esc(b.name)}</a> ${esc(b.stickers)}
    ${b.buddy ? `<small>mit ${esc(b.buddy)}</small>` : ''} <small class="muted">${fmtDate(b.at * 1000)}</small></li>`).join('')}</ul>`;
}

function visitPane() {
  const hm = hostMember();
  const pets = visit.data.pets.map((p) => `<li>${petSvg(p.species, p.color, mood(p).face, { acc: p.acc, shadow: false })}
    <span><b>${esc(p.name)}</b><small>${SPECIES[p.species].name} · Stufe ${p.level} · ${mood(p).label}</small></span></li>`).join('');
  return paneTabs(tab('', `🏘️ Bei ${esc(visit.host.name)}`, true)) + `<div class="pane-page" data-page="visit:${esc(visit.host.user)}">
    <p class="hint">${hm ? '🟢 Gerade auch hier, ihr seht euch live.' : 'Gerade nicht online. Was du tust, sieht sie oder er beim nächsten Mal.'}
      <a href="${esc(visit.host.url)}" target="_top">Profil</a></p>
    ${visit.data.away && visit.data.away.length ? `<p class="hint">🖥️ ${esc(listNames(visit.data.away))} ${visit.data.away.length > 1 ? 'sind' : 'ist'} gerade draußen auf dem Desktop unterwegs.</p>` : ''}
    <fieldset class="groupbox"><legend>Tiere</legend><ul class="host-pets">${pets}</ul>
      <small class="muted">Streich über ein Tier zum Streicheln oder spiel mit ihm mit deinem Spielzeug.</small></fieldset>
    <fieldset class="groupbox"><legend>Besuchsbuch</legend>${bookHtml(visit.data.book, 'Du bist heute der erste Besuch.')}</fieldset></div>`;
}

function bookPane() {
  const priv = privacyOf(state);
  const opts = Object.entries(VISITOR_PRIVACY).map(([k, label]) => `<option value="${k}"${priv === k ? ' selected' : ''}>${label}</option>`).join('');
  return paneTabs(tab('', '📖 Besuchsbuch', true)) + `<div class="pane-page" data-page="book">
    <fieldset class="groupbox"><legend>Zuletzt bei dir</legend>${bookHtml(visitBook, 'Noch kein Besuch. Erzähl anderen von deinen Tieren!')}</fieldset>
    <fieldset class="groupbox"><legend>Wer darf mich besuchen?</legend><select name="privacy" aria-label="Wer darf mich besuchen?">${opts}</select>
      <p><small class="muted">Besucher sehen dein Zimmer und deine Tiere mit Namen, Aussehen und Laune, aber keine Münzen und keine Sachen.</small></p></fieldset></div>`;
}

function neighboursHtml() {
  if (store.mode !== 'account') {
    return `<h2>Besuchen</h2><p>Mit einem Konto kannst du die Tiere anderer Mitglieder besuchen, mit ihnen spielen und dein eigenes Tier mitbringen.
      Andere können dann auch dich besuchen.</p><p class="row"><a class="btn def" href="${esc(config.loginUrl)}" target="_top">Anmelden</a>
      ${config.registerUrl ? `<a class="btn" href="${esc(config.registerUrl)}" target="_top">Konto erstellen</a>` : ''}</p>`;
  }
  let list;
  if (!neighbours) list = '<p class="loading">Lade Nachbarn …</p>';
  else if (neighbours.error) list = `<p>⚠️ ${esc(neighbours.error)}</p>`;
  else if (!neighbours.length) list = '<p class="muted">Noch niemand zum Besuchen da. Sobald andere Mitglieder Tiere haben und Besuch erlauben, stehen sie hier.</p>';
  else {
    list = `<div class="neighbours">${neighbours.map((n) => `<button type="button" class="neighbour" data-visit="${esc(n.user)}" title="${esc(n.name)} besuchen">
      <span class="nb-pets">${n.pets.slice(0, 3).map((p) => petSvg(p.species, p.color, 'happy', { acc: p.acc, title: p.name, shadow: false })).join('')}</span>
      <span class="nb-body"><b>${esc(n.name)}</b>${n.live ? ' <span class="badge live">online</span>' : ''}${n.friend ? ' <span class="badge">Freund</span>' : ''}
        <small>${esc(n.pets.map((p) => p.name).join(', '))}</small></span></button>`).join('')}</div>`;
  }
  return `<h2>Besuchen</h2><p class="muted">Schau bei den Tieren anderer Mitglieder vorbei. Wer gerade online ist, sieht dich live.
    Die ersten 3 Besuche am Tag bringen je 10 Münzen.</p>${list}`;
}

async function loadNeighbours() {
  neighbours = null;
  if (view === 'visit') render();
  try { neighbours = (await api.neighbours()).neighbours; } catch (e) { neighbours = { error: e.message }; }
  if (view === 'visit') render();
}

async function startVisit(user) {
  let data;
  try { data = await api.room(user); } catch (e) { sfx('nein'); return ok('Besuchen', `<p>${esc(e.message)}</p>`); }
  scene.putAway();
  visit = { host: data.host, data, bring: null, greeted: false };
  bubble = null;
  live.open(user);
  view = 'room'; pane = null;
  const coinsGot = visitReward(state, user);
  store.save(state);
  api.act(user, { kind: 'visit' }).catch(() => {});
  sfx('freude');
  render();
  say(`Willkommen bei ${data.host.name}!${coinsGot ? ` Für deinen Besuch gibt es ${coinsText(coinsGot)}.` : ''} Wen bringst du mit?`, 6000);
}

function endVisit() {
  if (!visit) return;
  visit = null;
  scene.putAway();
  bubble = null;
  if (store.mode === 'account') live.open(store.user); else live.close();
  view = 'room';
}

function bringPet(id) {
  visit.bring = id || null;
  const pet = state.pets.find((p) => p.id === id);
  render();
  if (!pet) return;
  sfx('stimme:' + pet.species);
  const delta = playdate(state, pet, visit.host.user);
  if (delta) {
    note(`${pet.name} war bei ${visit.host.name} zu Besuch.`, pet);
    store.save(state);
    api.act(visit.host.user, { kind: 'playdate', detail: pet.name }).catch(() => {});
    setTimeout(() => floaters(pet, delta), 300);
    setTimeout(() => tell(pet.id, `${pet.name} ist mitgekommen und freut sich auf die anderen!`, 4000), 50);
  } else setTimeout(() => tell(pet.id, `${pet.name} ist mitgekommen.`, 3000), 50);
}

async function giveGift(id) {
  if (!visit || !state.inventory[id]) return;
  try {
    const res = await api.act(visit.host.user, { kind: 'gift', detail: id });
    if (!res.counted) return say('Heute hast du hier schon genug verschenkt. Morgen wieder!', 3500);
  } catch (e) { return say(e.message, 3500); }
  state.inventory[id] -= 1;
  if (state.inventory[id] <= 0) delete state.inventory[id];
  store.save(state);
  sfx('kaufen');
  say(`${ITEMS[id].name} liegt jetzt bei ${visit.host.name}. Wie lieb von dir!`, 4000);
  render();
}

async function leaveSticker(s) {
  if (!visit || visit.greeted) return;
  visit.greeted = true;
  try { await api.act(visit.host.user, { kind: 'sticker', detail: s }); } catch { /* egal */ }
  sfx('pop');
  say(`Dein Gruß ${s} steht jetzt im Besuchsbuch von ${visit.host.name}.`, 3500);
  try { visit.data.book = (await api.room(visit.host.user)).book; } catch { /* bleibt */ }
  render();
}

// Was Besucher bei meinen Tieren getan haben, in den Spielstand einrechnen
let inboxBusy = false, inboxAgain = false;
let news = null;           // Besuchsmeldung, die gerade angezeigt wird: { until, sums: Map Besucher -> Zusammenfassung }
const union = (a, b) => [...new Set([...a, ...b])];
const mergeVisit = (a, b) => (a ? {
  visitor: a.visitor, kinds: union(a.kinds, b.kinds), pets: union(a.pets, b.pets), gifts: [...a.gifts, ...b.gifts],
  stickers: [...a.stickers, ...b.stickers], buddies: union(a.buddies, b.buddies),
} : b);

async function fetchInbox(announce = true) {
  if (store.mode !== 'account') return [];
  if (inboxBusy) { inboxAgain = true; return []; }
  inboxBusy = true;
  try {
    const d = await api.inbox();
    visitBook = d.book || [];
    if (!d.entries.length) { if (view === 'visit') render(); return []; }
    const sums = applyVisits(state, d.entries);
    for (const s of sums) note(visitText(s));
    store.save(state);
    await api.done(d.entries[d.entries.length - 1].id);
    if (!visit) render();
    // Läuft die letzte Besuchsmeldung noch, kommen neue Handlungen dazu, statt sie zu ersetzen
    if (!news || Date.now() > news.until) news = { sums: new Map() };
    for (const s of sums) news.sums.set(s.visitor, mergeVisit(news.sums.get(s.visitor), s));
    const lines = [...news.sums.values()].map(visitText);
    news.until = Date.now() + 5000 + lines.length * 2000;
    if (announce) say(lines.join(' '), news.until - Date.now());
    return lines;
  } catch { return []; } finally {
    inboxBusy = false;
    if (inboxAgain) { inboxAgain = false; setTimeout(() => fetchInbox(), 300); }
  }
}

// ---------- Ausflüge und Tageswettbewerb ----------
const skillLevels = (pet) => Object.fromEntries(SKILLS.map((s) => [s.key, skillLevel(pet, s.key)]));

function skillsHtml(pet) {
  return SKILLS.map((s) => {
    const l = skillLevel(pet, s.key), pr = skillProgress(pet, s.key);
    const talent = TALENT[pet.species] === s.key ? ' <span class="talent" title="Talent: lernt 25 % schneller">⭐ Talent</span>' : '';
    return `<div class="skill">${iconSvg(SKILL_ICON[s.key])}<span><b>${s.label} ${l}</b>${talent}</span>${bar(pr.need ? (100 * pr.have) / pr.need : 100, 'xp', s.label)}
      <small class="num">${pr.need ? `${pr.have}/${pr.need}` : 'max'}</small><small class="txt">${esc(pet.name)} ${s.text}.</small></div>`;
  }).join('');
}

// Warum gerade kein Ausflug geht (HTML), oder null
function tripBlocker(pet) {
  if (!canTrip(state, pet)) {
    const gear = walkGear(pet.species);
    return `Für Ausflüge braucht ${esc(pet.name)}: <b>${ITEMS[gear].name}</b>. <button type="button" class="small" data-gotoshop="care:${gear}">Zum Shop</button>`;
  }
  const c = canDo(pet, 'walk', state);
  return c.ok ? null : esc(c.reason);
}

function tripDock(pet) {
  const block = tripBlocker(pet);
  const open = placeOpen(pet, tripPlace);
  const go = `<button type="button" class="def" data-trip="${tripPlace}"${open && !block ? '' : ' disabled'} title="${esc(`Mit ${pet.name} ${TO_PLACE[tripPlace]}`)}">▶ <span class="bl">Mit ${esc(pet.name)} ${TO_PLACE[tripPlace]}</span></button>`;
  const places = Object.entries(PLACES).map(([id, p]) => {
    const o = placeOpen(pet, id);
    return `<button type="button"${id === tripPlace ? ' class="pressed"' : ''} data-place="${id}" aria-pressed="${id === tripPlace}"${o ? '' : ' disabled'}
      title="${o ? esc(p.name) : `${esc(p.name)}: ab Zuneigungsstufe ${p.level}`}">${iconSvg(o ? ICON_OF[id] || id : 'lock')} <span class="bl">${esc(p.name)}</span></button>`;
  }).join('');
  return go + '<span class="tsep"></span>' + places + (block ? `<span class="note">${block}</span>` : '');
}

function contestDock(pet) {
  const c = canContest(state, pet);
  const mine = state.contest && state.contest.day === contest.day ? state.contest : null;
  const info = !c.ok ? esc(c.reason)
    : mine ? `Heute beste Runde: <b>${num(mine.best)}</b> (${mine.runs} ${mine.runs === 1 ? 'Lauf' : 'Läufe'})` : 'Kostet etwas Ruhe, Nahrung und Wasser.';
  return `<button type="button" class="def" data-contest${c.ok ? '' : ' disabled'} title="${esc(`Mit ${pet.name} mitlaufen`)}">🏁 <span class="bl">Mitlaufen mit ${esc(pet.name)}</span></button>
    <span class="note">${info}</span>`;
}

function contestHtml() {
  if (store.mode !== 'account') return '<p>Beim Tageswettbewerb laufen alle Mitglieder dieselbe Strecke um die Wette. Mit einem Konto kannst du mitmachen.</p>';
  if (!contest) return '<p class="loading">Wird geladen …</p>';
  if (contest.error) return `<p>⚠️ ${esc(contest.error)}</p>`;
  const cup = (place) => (place <= 3 ? iconSvg('cup' + place) : place + '.');
  const rows = contest.top.length ? contest.top.map((e) => `<tr class="${e.me ? 'me' : ''}"><td>${cup(e.place)}</td>
      <td>${SPECIES[e.pet.species] ? SPECIES[e.pet.species].icon : '🐾'} <b>${esc(e.pet.name)}</b> <small>· ${e.url ? `<a href="${esc(e.url)}" target="_top">${esc(e.name)}</a>` : esc(e.name)}</small></td>
      <td class="num">${num(e.score)}</td></tr>`).join('')
    : '<tr><td colspan="3"><small>Heute ist noch niemand gelaufen. Sei die oder der Erste!</small></td></tr>';
  const meRow = contest.mine && !contest.top.some((e) => e.me)
    ? `<tr class="me"><td>${contest.mine.place}.</td><td><b>${esc(contest.mine.pet)}</b> <small>· du</small></td><td class="num">${num(contest.mine.score)}</td></tr>` : '';
  const y = contest.yesterday && contest.yesterday.top.length
    ? `<p><small>Gestern: ${contest.yesterday.top.map((e) => `${cup(e.place)} ${esc(e.pet.name)} (${esc(e.name)})`).join(' · ')}</small></p>` : '';
  const cups = (state.trophies || []).length
    ? `<p class="trophies" title="Deine Pokale"><small>Deine Pokale:</small> ${state.trophies.slice(-12).map((t) => `<span title="${esc(t.day)}: Platz ${t.place} mit ${esc(t.pet)}">${iconSvg('cup' + t.place)}</span>`).join('')}</p>` : '';
  return `<p>Heute ${TO_PLACE[contest.place]}: alle laufen dieselbe Strecke, die beste Runde zählt. Fürs erste Mitmachen gibt es ${coins(CONTEST_COINS)},
      morgen für die ersten drei Plätze ${PRIZES.map((n) => coins(n)).join(' / ')}.</p>
    <table class="board"><tbody>${rows}${meRow}</tbody></table>${y}${cups}`;
}

function tripPane() {
  const pet = activePet(state);
  const page = tripTab === 'contest' ? contestHtml()
    : `${state.pets.length > 1 ? `<div class="tabs">${petTabs(false)}</div>` : ''}<div class="field skills">${skillsHtml(pet)}</div>
      <small class="muted">Jeder Lauf bringt Erfahrung: übersprungene Hindernisse für die Sprungkraft, Einsammeln für die Spürnase, ein Lauf ohne Stolpern fürs Tempo.
      Ausflüge gehen alle ${Math.round(ACTIONS.walk.wait / 3600000)} Stunden, im Wettbewerb kannst du so oft laufen, wie ${esc(pet.name)} Puste hat.</small>`;
  return paneTabs(tab('data-ttab="skills"', 'Fähigkeiten', tripTab === 'skills') + tab('data-ttab="contest"', '🏆 Wettbewerb', tripTab === 'contest'))
    + `<div class="pane-page" data-page="trip:${tripTab}">${page}</div>`;
}

async function loadContest() {
  if (store.mode !== 'account') return;
  try { contest = await api.contest(); } catch (e) { contest = { error: e.message }; }
  // Preis für gestern abholen
  const y = contest.yesterday;
  if (y && y.mine && y.mine.place <= PRIZES.length) {
    const won = claimPrize(state, y.day, y.mine.place, y.mine.pet);
    if (won) {
      note(`Platz ${y.mine.place} beim Wettbewerb gestern mit ${y.mine.pet}.`);
      store.save(state);
      sfx('fanfare');
      await ok('Pokal!', `<p>${iconSvg('cup' + y.mine.place, 'pxi x2')} Beim Wettbewerb gestern hat <b>${esc(y.mine.pet)}</b> Platz ${y.mine.place} gemacht. Dafür gibt es ${coins(won)}.</p>`);
    }
  }
  if (view === 'trip' && !trip) render();
}

function startTrip(mode, placeId) {
  const pet = activePet(state);
  tickPet(pet, Date.now(), tickOpts(state));
  let c;
  if (mode === 'contest') {
    const can = canContest(state, pet);
    if (!can.ok || !contest || contest.error) { sfx('nein'); return ok('Wettbewerb', `<p>${esc(can.ok ? 'Der Wettbewerb ist gerade nicht erreichbar.' : can.reason)}</p>`); }
    c = contestCourse(contest.day);
  } else {
    if (tripBlocker(pet) || !placeOpen(pet, placeId)) { sfx('nein'); return render(); }
    c = course(placeId, Date.now());
  }
  const p = PLACES[c.place];
  trip = { mode, pet, course: c, runner: null };
  view = 'trip'; pane = null;
  render();
  trip.runner = createRun($('run-host'), {
    pet, course: c, levels: skillLevels(pet), sound: sfx,
    title: mode === 'contest' ? `🏆 Wettbewerb · ${p.name}` : `${p.name} mit ${esc(pet.name)}`,
    onEnd: (r) => endTrip(r),
  });
}

async function endTrip(r) {
  const t = trip;
  trip = null;
  if (!r) { render(); log(`${t.pet.name} läuft lieber ein anderes Mal.`, 4000); return; }
  const pet = t.pet, now = Date.now();
  tickPet(pet, now, tickOpts(state));
  const lines = [];
  let gained = 0, levelUp = null, ups, gains;
  const counts = `${iconSvg('food_bone')} ${r.treat} · ${iconSvg('coin')} ${r.coin} · ${iconSvg('sparkle')} ${r.sniff} · übersprungen ${r.cleared}${r.hits ? ` · gestolpert ${r.hits}` : ''}`;
  const where = PLACES[t.course.place];
  if (t.mode === 'contest') {
    const res = finishContest(state, pet, r, t.course, now);
    ups = res.ups; gains = res.gains; gained = res.coins;
    lines.push(`<p class="big-score">${num(res.score)} Punkte${res.newBest ? ' · neue Bestleistung!' : ''}</p>`, `<p>${counts}</p>`);
    if (res.coins) lines.push(`<p>Fürs Mitmachen: ${coins(res.coins)}</p>`);
    if (res.newBest) {
      note(`Wettbewerb ${TO_PLACE[t.course.place]}: ${num(res.score)} Punkte.`, pet);
      try {
        const s = await api.submit({ day: contest.day, score: res.score, pet: { name: pet.name, species: pet.species, color: pet.color } });
        lines.push(`<p>${iconSvg('cup1')} Du bist heute auf <b>Platz ${s.place}</b>.</p>`);
      } catch (e) { lines.push(`<p>⚠️ ${esc(e.message)}</p>`); }
      loadContest();
    }
  } else {
    const res = finishTrip(state, pet, r, t.course, now);
    if (!res.ok) { store.save(state); render(); return ok('Ausflug', `<p>${esc(res.action.text)}</p>`); }
    ups = res.ups; gains = res.gains; levelUp = res.action.levelUp;
    gained = actionCoins(state, 'walk', 1) + res.coins + res.finds.reduce((n, f) => n + (f.coins || 0), 0);
    lines.push(`<p>${esc(res.action.text)}</p>`, `<p>${counts} · ${res.score} Punkte</p>`);
    if (res.coins) lines.push(`<p>Eingesammelt: ${coins(res.coins)}</p>`);
    if (res.action.found && res.action.found.coins) { gained += addCoins(state, res.action.found.coins); res.finds.push(res.action.found); }
    else if (res.action.found && res.action.found.item) res.finds.push(res.action.found);
    if (res.finds.length) lines.push(`<p>Gefunden: ${res.finds.map((f) => (f.coins ? coins(f.coins) : `${iconSvg(f.item)} ${ITEMS[f.item].name}`)).join(', ')}</p>`);
    lines.push(`<p><small>${effectText(res.action.delta)}</small></p>`);
    for (const x of track(state, 'walk')) lines.push(`<p>✔ Aufgabe erledigt: ${esc(x.text)} (+${x.reward} Münzen)</p>`);
    note(`Ausflug ${TO_PLACE[t.course.place]}, ${num(res.score)} Punkte.`, pet);
  }
  lines.push(`<p><small>Erfahrung: ${SKILLS.map((s) => `${s.label} +${Math.round(gains[s.key] * (TALENT[pet.species] === s.key ? 1.25 : 1))}`).join(' · ')}</small></p>`);
  for (const u of ups) {
    const s = SKILLS.find((x) => x.key === u.key);
    lines.push(`<p>${iconSvg(SKILL_ICON[u.key])} <b>${s.label} ${u.level}!</b> ${u.key === 'jump' && u.level === DOUBLE_JUMP_LEVEL ? `${esc(pet.name)} kann jetzt in der Luft ein zweites Mal springen.` : ''}</p>`);
  }
  store.save(state);
  render();
  sfx(ups.length ? 'fanfare' : 'freude');
  if (gained) setTimeout(() => sfx('muenze'), 400);
  await dialog(t.mode === 'contest' ? 'Wettbewerb' : `Zurück vom Ausflug: ${where.name}`, lines.join(''), [{ label: 'Prima', value: 'ok' }]);
  if (levelUp) await levelUpDialog(pet, levelUp);
}

function abortTrip() {
  if (!trip) return;
  if (trip.runner) trip.runner.stop();
  trip = null;
}

async function levelUpDialog(pet, lvl) {
  const bonus = levelReward(state, lvl);
  note(`${pet.name} hat Stufe ${lvl} erreicht.`, pet);
  store.save(state);
  render();
  sfx('fanfare');
  await dialog('Neue Zuneigungsstufe!', `<p>🎉 <b>${esc(pet.name)}</b> ist jetzt auf <b>Stufe ${lvl}</b>. Dafür gibt es ${coins(bonus)}.</p>
    ${LEVEL_UNLOCKS[lvl] ? `<p>${LEVEL_UNLOCKS[lvl]}</p>` : ''}`, [{ label: 'Juhu!', value: 'ok' }]);
}

// ---------- Adoption ----------
function adoptHtml() {
  const first = state.pets.length === 0;
  const full = state.pets.length >= petSlots(state);
  const intro = first
    ? '<h2>Wähle dein erstes Haustier</h2><p>Um dein Tier musst du dich jeden Tag kümmern. Besondere Tiere schaltest du frei, wenn du oft vorbeischaust.</p>'
    : `<h2>Ein weiteres Tier adoptieren</h2><p>Du hast ${state.pets.length} von ${petSlots(state)} Plätzen belegt.</p>`;
  if (full) {
    const hint = nextSlotHint(state);
    return `<h2>Kein Platz frei</h2><p>${hint || 'Du hast schon die größtmögliche Tierfamilie.'}</p>`;
  }
  if (picked) {
    const sp = SPECIES[picked];
    const colors = sp.colors.map((c, i) => `<label class="color-pick"><input type="radio" name="color" value="${c.id}"${i === 0 ? ' checked' : ''}>
        ${petSvg(picked, c.id, 'happy', { shadow: false })}<span>${c.name}</span></label>`).join('');
    return `<h2>${sp.icon} ${sp.name} adoptieren</h2>
      <form id="adopt-form">
        <fieldset class="groupbox"><legend>Fellfarbe</legend><div class="colors">${colors}</div></fieldset>
        <fieldset class="groupbox"><legend>Name</legend><div class="row">
          <input id="pet-name" maxlength="20" value="${esc(pick(sp.names))}" required aria-label="Name">
          <button type="button" class="small" id="name-dice" title="Anderer Name">🎲</button></div></fieldset>
        <div class="dlg-actions"><button type="submit" class="def">Adoptieren</button><button type="button" id="adopt-back">Zurück</button></div>
      </form>`;
  }
  const cards = Object.entries(SPECIES).map(([id, sp]) => {
    const open = isUnlocked(id, state);
    return `<button type="button" class="card${open ? '' : ' locked'}" data-species="${id}"${open ? '' : ' aria-disabled="true"'}>
      ${petSvg(id, sp.colors[0].id, open ? 'happy' : 'sleep', { shadow: false })}
      <b>${open ? '' : '🔒 '}${sp.name}</b><small>${open ? sp.hint : unlockText(id)}</small></button>`;
  }).join('');
  return `${intro}<div class="cards">${cards}</div>`;
}

function goAdopt() {
  if (state.pets.length >= petSlots(state)) { sfx('nein'); say(nextSlotHint(state) || 'Du hast schon die größtmögliche Tierfamilie.', 5000); return; }
  abortTrip(); endVisit();
  view = 'adopt'; pane = null; picked = null;
  render();
}

function updateNotice() {
  const p = store.prefs();
  // Nicht beim Adoptieren, dort läge die Sprechblase über dem Knopf
  const n = $('guest-notice');
  n.hidden = !started || store.mode !== 'guest' || view === 'adopt' || p.noticeHiddenDay === dayKey(Date.now()) || $('dlg').open;
  if (!n.hidden) n.style.top = Math.round(document.querySelector('#tbar [data-menu=more]').getBoundingClientRect().bottom + 11) + 'px';
}

// Kleine aufsteigende Bilder und Zahlen über dem Tier nach einer Aktion
function floaters(pet, delta, gained = 0) {
  const list = Object.entries(delta).filter(([, v]) => v).map(([k, v]) => [`${iconSvg(ICON_OF[k])}${v > 0 ? '+' : ''}${v}`, v < 0, '']);
  if (gained) list.push([`${iconSvg('coin')}+${gained}`, false, 'coin']);
  scene.floaters(pet.id, list);
}

function selectPet(id) {
  if (!state.pets.some((p) => p.id === id) || state.activePet === id) return;
  state.activePet = id; tryOn = null;
  scene.hush();
  store.save(state);
  render();
}

// Spielen mit dem Spielzeug im Zimmer: Die Szene meldet, wenn ein Tier es gefangen oder benutzt hat
function playWith(petId, itemId) {
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false };
  tickPet(pet, Date.now(), tickOpts(state));
  const r = doAction(pet, 'play', state, Date.now(), { itemId });
  if (!r.ok) { if (pet === activePet(state)) tell(pet.id, r.text, 3000); return { ok: false }; }
  finish(pet, 'play', r, { animate: false });
  return { ok: true, factor: r.factor, fav: r.fav };
}

// Spielzeug aus der Kiste holen (ohne Wahl: das liebste des gewählten Tieres)
function takeToy(id) {
  const pet = activePet(state);
  id ||= usableItems(state, pet, 'toy').find((x) => TOYS[x]);
  if (!id) { sfx('nein'); tell(pet.id, `Du hast kein Spielzeug für ${pet.name}. Schau im Shop vorbei!`, 3500); return; }
  if (view !== 'room') { abortTrip(); view = 'room'; }
  if (pane === 'shop') pane = null;
  render();
  scene.useToy(id);
  sfx('klick');
  render();
  say(TOYS[id].hint, 5000);
}

async function act(action, itemId = null) {
  const pet = activePet(state);
  if (!pet) return;
  if (action === 'play' && !pet.sleeping) return takeToy(itemId);
  // Gassi und Ausflüge haben ihre eigene Szene
  if (action === 'walk') { abortTrip(); pane = null; view = 'trip'; loadContest(); return render(); }
  const key = pet.id + ':' + action;
  const now = Date.now();
  if (lastAction[key] && now - lastAction[key] < ACTIONS[action].cooldown) return;
  tickPet(pet, now, tickOpts(state));
  const check = canDo(pet, action, state, itemId, now);
  if (!check.ok) { sfx('nein'); if (view === 'room') tell(pet.id, check.reason, 3500); else ok(ACTIONS[action].label, `<p>${esc(check.reason)}</p>`); return; }
  const r = doAction(pet, action, state, Date.now(), { itemId });
  if (!r.ok) { sfx('nein'); tell(pet.id, r.text, 3500); return; }
  lastAction[key] = now;
  if (action === 'feed' || action === 'water') {
    // Aus der Hand ist es persönlicher als aus dem Napf
    const before = pet.stats.love;
    pet.stats.love = Math.min(100, pet.stats.love + HAND_LOVE);
    if (pet.stats.love > before) r.delta = { ...r.delta, love: (r.delta.love || 0) + Math.round(pet.stats.love - before) };
  }
  await finish(pet, action, r);
}

// Nach einer gelungenen Aktion: Klänge, Münzen, Aufgaben, Speichern, Anzeige
async function finish(pet, action, r, { animate = true } = {}) {
  actionSound(action, pet.species).forEach((n, i) => setTimeout(() => sfx(n), i * 350));
  let gained = actionCoins(state, action, r.factor);
  const notes = [r.text];
  if (action === 'pet' && pet.acc.neck === 'acc_bell') notes[0] += ' Klingeling!';
  if (r.found && r.found.coins) { gained += addCoins(state, r.found.coins); notes.push(`Fund: ${coinsText(r.found.coins)}!`); }
  if (r.found && r.found.item) { notes.push(`Fund: ${ITEMS[r.found.item].name}!`); note(`Gefunden: ${ITEMS[r.found.item].name}.`, pet); }
  const done = track(state, action, { itemId: r.itemId });
  store.save(state);
  if (view !== 'room') { abortTrip(); view = 'room'; }
  render();
  if (animate) scene.animate(pet.id, action, { itemId: r.itemId, found: r.found });
  tell(pet.id, notes.join(' '), 3500 + notes.length * 1200);
  for (const t of done) setTimeout(() => say(`Aufgabe erledigt: ${t.text} (+${t.reward} Münzen)`, 4500), 600);
  floaters(pet, r.delta, gained);
  if (gained) setTimeout(() => sfx('muenze'), 450);
  if (r.levelUp) {
    setTimeout(() => sfx('fanfare'), 700);
    scene.animate(pet.id, 'levelup');
    await levelUpDialog(pet, r.levelUp);
  }
}

function openShop(tabId, pickId = null) {
  closeMenu();
  if (view !== 'room') { abortTrip(); view = 'room'; }
  pane = 'shop';
  shop.tab = tabId;
  shop.pick = pickId;
  tryOn = null;
  render();
}

async function doBuy(id) {
  const item = ITEMS[id];
  const c = canBuy(state, id);
  if (!c.ok) { sfx('nein'); log(c.reason, 5000); return; }
  if (c.price >= 300) {
    const sure = await dialog('Kaufen?', `<p>${iconSvg(id, 'pxi x2')} <b>${item.name}</b> für ${coins(c.price)} kaufen?</p>`, [{ label: 'Kaufen', value: 'yes', def: true }, { label: 'Abbrechen', value: 'no' }]);
    if (sure !== 'yes') return;
  }
  const r = buy(state, id);
  if (!r.ok) return;
  sfx('kaufen');
  if (isDurable(item)) note(`Neu: ${item.name}.`);
  // Angezogen wird gleich, was man gerade anprobiert hat
  if (item.cat === 'acc' && tryOn === id) { wear(state, activePet(state), id); tryOn = null; }
  store.save(state);
  render();
  // Einrichtung kommt gleich ins Zimmer, solange dort Platz ist
  const placed = item.cat === 'furn' && canPlace(id, 'room') && placeTo(id, 'room', true).ok;
  const where = placed ? ' Es steht schon im Zimmer.' : item.cat === 'furn' ? ' Unter „Einrichten“ stellst du es auf.'
    : item.cat === 'acc' ? (activePet(state).acc[item.slot] === id ? ` ${activePet(state).name} trägt es schon.` : ' Mit „Anziehen“ legst du es an.')
    : item.cat === 'room' ? ' Der Raum ist schon eingerichtet.' : item.cat === 'toy' ? ' Es liegt jetzt in der Spielzeugkiste.'
      : id === 'extra_slot' ? ' Du kannst jetzt ein weiteres Tier adoptieren.' : '';
  say(`Gekauft: ${item.name}.${where}`, 4000);
  for (const t of r.done) setTimeout(() => say(`Aufgabe erledigt: ${t.text} (+${t.reward} Münzen)`, 4500), 1500);
}

async function rename() {
  const pet = activePet(state);
  const r = await dialog('Umbenennen', `<p><label>Neuer Name für ${esc(pet.name)}:<br><input id="rename-input" maxlength="20" value="${esc(pet.name)}"></label></p>`,
    [{ label: 'OK', value: 'ok', def: true }, { label: 'Abbrechen', value: 'cancel' }]);
  const name = cleanName($('rename-input').value);
  if (r !== 'ok' || !name) return;
  pet.name = name;
  store.save(state);
  render();
}

// ---------- Fragen zum eigenen Wohlbefinden ----------
// Das Tier fragt selbst, in einer Sprechblase im Zimmer
function askCheckin() {
  if (!started || view !== 'room' || visit || pane || checkinDone(state) || Date.now() < checkinLater || $('dlg').open || !$('room')) return;
  const pet = activePet(state);
  if (!pet || pet.sleeping || scene.speaking) return;
  scene.speak(pet.id, `Wie war dein Tag? Erzählst du mir davon?<div class="row"><button type="button" class="def" data-ci="yes">Erzählen</button><button type="button" data-ci="later">Später</button></div>`, 20000);
}

async function runCheckin() {
  if (checkinDone(state)) return;
  scene.hush();
  const pet = activePet(state);
  const answers = [];
  for (const [i, q] of CHECKIN_QUESTIONS.entries()) {
    const r = await dialog(`Wie war dein Tag? (${i + 1}/3)`, `<p class="question">${q.text}</p>`,
      [{ label: 'Ja', value: 'yes', def: true }, { label: 'Nein', value: 'no' }, { label: 'Später', value: 'later' }]);
    if (r === 'later') { checkinLater = Date.now() + 30 * 60000; return; }
    answers.push(r === 'yes');
  }
  const res = checkIn(state, answers);
  if (!res.ok) return;
  sfx('freude');
  store.save(state);
  const feelsBad = answers[2] === false;
  render();
  if (pet) tell(pet.id, feelsBad ? `${pet.name} kuschelt sich ganz nah an dich.` : `${pet.name} freut sich mit dir!`, 6000);
  let html = `<p>Danke fürs Beantworten! Du bekommst ${coins(res.coins)}${res.joy ? ` und deine Tiere ${res.joy} Erfüllung` : ''}.</p>`;
  if (!feelsBad) { ok('Danke!', html); return; }
  html += '<p>Schön, dass du ehrlich bist.</p>';
  if (config.forumUrl) {
    html += `<p>Wenn du magst, schreib darüber im <b>Forum</b>. Dort lesen andere mit, die dir zuhören und vielleicht
      Ähnliches kennen. Du kannst auch <b>anonym</b> schreiben, dann sehen andere Mitglieder deinen Namen nicht${store.mode === 'account' ? '' : ' (dafür brauchst du ein Konto)'}.</p>
      <p><a class="btn" href="${esc(config.forumUrl)}" target="_top">✍️ Beitrag im Forum schreiben</a></p>`;
  }
  ok('Danke, dass du es sagst', html);
}

// ---------- Neuigkeiten, Hilfe, Einstellungen ----------
// Kleiner Markdown-Ausschnitt: ## Überschrift, - Liste, **fett**
function changelogHtml(md) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', list = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (line.startsWith('## ')) html += `<h3>${inline(line.slice(3))}</h3>`;
    else if (line.trim() && !line.startsWith('# ')) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

let changelog = null;
async function loadChangelog() {
  if (changelog) return changelog;
  try {
    const r = await fetch(config.changelogUrl, { cache: 'no-cache' });
    const md = r.ok ? await r.text() : '';
    const latest = (md.match(/^## (.+)$/m) || [])[1] || '';
    changelog = { html: changelogHtml(md) || '<p>Noch keine Einträge.</p>', latest };
  } catch { changelog = { html: '<p>Die Neuigkeiten konnten nicht geladen werden.</p>', latest: '' }; }
  return changelog;
}

async function markNews() {
  const c = await loadChangelog();
  $('news-dot').hidden = !c.latest || store.prefs().newsSeen === c.latest;
}

async function showNews() {
  const c = await loadChangelog();
  store.setPrefs({ newsSeen: c.latest });
  $('news-dot').hidden = true;
  ok('Neuigkeiten', `<div class="changelog">${c.html}</div>`);
}

function showHelp() {
  ok('Hilfe', `<p>Kümmere dich jeden Tag um deine Tiere. Die Werte sinken mit der Zeit, auch wenn du nicht da bist,
     aber nie unter 10. Krank wird dein Tier nicht, es wird nur traurig, wenn du es vernachlässigst.</p>
     <ul><li>Deine Tiere laufen frei im Zimmer herum, besuchen sich gegenseitig und spielen Fangen. <b>Tipp ein Tier an</b>, um es auszuwählen,
       oder nimm den Reiter rechts im Fach. Mit der rechten Maustaste (oder lange drücken) gibt es ein Menü.</li>
     <li>Die <b>Pflege-Leiste</b> unter dem Zimmer kümmert sich um das gewählte Tier. Der Knopf mit dem dicken Rand ist das, was gerade am meisten fehlt
       (Eingabetaste). Fehlt einem Tier etwas, zeigt es das in einer <b>Gedankenblase</b>, die du antippen kannst.</li>
     <li><b>Streicheln</b> geht auch, indem du mit der Maus oder dem Finger über ein Tier streichst.</li>
     <li><b>Spielen:</b> Hol ein Spielzeug aus der <b>Spielzeugkiste</b> im Zimmer. Bälle wirfst du, indem du sie ziehst und loslässt,
       Federangel und Laserpointer folgen deiner Maus, Seifenblasen pustest du mit einem Tipp ins Zimmer. Jedes Tier, das gerade Lust hat, macht mit.</li>
     <li><b>Einrichten:</b> Möbel, Betten und Bilder aus dem Shop oder als Belohnung stellst du unter Einrichten auf und ziehst sie an ihren Platz.
       Müde Tiere legen sich von selbst in ein freies Bett. In den <b>Futternapf</b> schüttest du Futter, den <b>Wassernapf</b> füllst du mit einem Klick,
       und wer Hunger oder Durst hat, bedient sich.</li>
     <li><b>Raus auf den Desktop:</b> Im Desktop-Fenster öffnest du unter <b>Tore</b> die Rolltore links und rechts. Dann klettern deine Tiere
       über Strickleitern hinaus, laufen über Fenster und Taskleiste, jagen die Maus und spielen mit allem, was dort steht. Du kannst sie
       hochheben und werfen (nicht zu doll). Mit 🐾 neben der Uhr rufst du sie heim, beim Schließen des Fensters kommen alle von selbst zurück.</li>
     <li><b>Ausflüge:</b> Unter Ausflug läuft dein Tier durch Park, Wald, Strand oder Berge. Tippe oder drück die Leertaste zum Springen,
       sammle Leckerli, Münzen und Schnüffelstellen ein. Dabei werden <b>Tempo, Sprungkraft und Spürnase</b> besser. Im <b>Tageswettbewerb</b> laufen alle dieselbe Strecke um die Wette.</li>
     <li>Jede Pflege bringt <b>Zuneigung</b>. Ab Stufe ${CUDDLE_LEVEL} und ${CUDDLE_LOVE} Liebe könnt ihr <b>kuscheln</b>,
       ab Stufe ${SLOT_LEVEL} gibt es einen zweiten Tierplatz.</li>
     <li>Pflege bringt <b>Münzen</b> (bis ${DAILY_CAP} am Tag), dazu kommen Login-Bonus und Tagesaufgaben.</li>
     <li>Im <b>Shop</b> gibt es Futter, Spielzeug, Pflegesachen, Sachen zum Anziehen und Räume. Was du schon hast, steht dort mit Häkchen;
       unter <b>Anziehen</b> probierst du Sachen an und legst sie an oder ab. Lieblingsfutter und Lieblingsspielzeug (❤) wirken 50 % stärker.</li>
     <li>Zu oft hintereinander dasselbe wirkt schwächer. Lieber öfter am Tag vorbeischauen.</li>
     <li>Einmal am Tag fragt dein Tier nach <b>deinem</b> Tag. Gespeichert wird nur, dass du geantwortet hast, nicht was.</li></ul>
     <p>${store.mode === 'account'
    ? 'Dein Spielstand wird automatisch in deinem Konto gespeichert und ist auf allen Geräten verfügbar.'
    : 'Als Gast wird dein Spielstand nur in diesem Browser gespeichert. Mit einem Konto ist er dauerhaft gesichert und auf allen Geräten verfügbar.'}</p>`);
}

// Was die Tiere draußen anstellen dürfen: gilt nur für dieses Gerät
const deskOpts = () => { try { return deskOptions(JSON.parse(local.get(KEYS.deskOpts) || 'null')); } catch { return deskOptions(null); } };
function deskSettingsHtml() {
  const o = deskOpts();
  const box = (name, label, on, hint = '') => `<label class="check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${esc(label)}${hint ? ` <small class="muted">${esc(hint)}</small>` : ''}</label>`;
  return `<fieldset class="groupbox"><legend>🖥️ Draußen auf dem Desktop</legend>
    ${box('o:mouse', 'Tiere jagen den Mauszeiger', o.mouse)}
    ${box('o:sound', 'Geräusche der Tiere', o.sound)}
    <p><small>Streiche (höchstens einer pro Stunde, nur wenn du eine Weile nichts tust):</small></p>
    ${PRANKS.map((p) => box('p:' + p.id, p.label, o.pranks[p.id], p.hint)).join('')}
    <p><small class="muted">Gilt nur für dieses Gerät. Bei „Bewegung reduzieren“ im System gibt es keine Streiche.</small></p></fieldset>`;
}
function readDeskSettings() {
  const o = deskOpts();
  for (const el of $('dlg-body').querySelectorAll('input[type=checkbox]')) {
    const [k, id] = el.name.split(':');
    if (k === 'o') o[id] = el.checked; else if (k === 'p') o.pranks[id] = el.checked;
  }
  local.set(KEYS.deskOpts, JSON.stringify(o));
  if (pets) try { pets.options(o); } catch { /* Desktop weg */ }
}

async function showSettings(focus = '') {
  const where = store.mode === 'account' ? `im Konto <b>${esc(store.user)}</b>` : 'nur in diesem Browser (Gast)';
  const desk = !!deskHost();
  const r = await dialog('Einstellungen',
    `${desk && focus === 'desk' ? deskSettingsHtml() : ''}<fieldset class="groupbox"><legend>Spielstand</legend>
      <p>Gespeichert ${where}.<br>Angefangen am ${fmtDate(state.createdAt)}.<br>
      Besuchstage: ${state.visits.total} · beste Serie: ${state.visits.best}<br>
      Insgesamt verdient: ${coins(state.earned || 0)}</p></fieldset>${desk && focus !== 'desk' ? deskSettingsHtml() : ''}`,
    [{ label: 'Spielstand zurücksetzen …', value: 'reset', danger: true }, { label: 'OK', value: 'close', def: true }]);
  if (desk) readDeskSettings();
  if (r !== 'reset') return;
  const sure = await dialog('Spielstand zurücksetzen',
    '<p>⚠️ Dein ganzer Fortschritt geht verloren, auch deine Tiere und Münzen. Das kann nicht rückgängig gemacht werden.</p>',
    [{ label: 'Ja, alles löschen', value: 'yes', danger: true }, { label: 'Abbrechen', value: 'no', def: true }]);
  if (sure !== 'yes') return;
  const hadBonus = state.accountBonus;
  state = store.reset();
  state.accountBonus = hadBonus;   // das Konto-Geschenk gibt es nur einmal
  registerVisit(state);
  store.save(state);
  abortTrip(); endVisit();
  view = 'adopt'; pane = null; picked = null; bubble = null;
  render();
}

// ---------- Eingaben ----------
function wire() {
  wireMenu();
  $('login-link').href = config.loginUrl;
  $('register-link').href = config.registerUrl;
  $('register-link').hidden = !config.registerUrl;
  const later = () => { store.setPrefs({ noticeHiddenDay: dayKey(Date.now()) }); updateNotice(); };
  $('notice-later').addEventListener('click', later);
  $('notice-close').addEventListener('click', later);
  window.addEventListener('resize', updateNotice);

  $('tbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.menu === 'more') return toggleMenu(b, moreItems);
    if (b.dataset.menu === 'gates') return toggleMenu(b, gateItems, { head: 'Tore zum Desktop' });
    if (!state.pets.length) return;
    sfx('klick');
    if (b.dataset.view) {
      closeMenu();
      abortTrip();
      const v = b.dataset.view;
      // Ein Klick auf Besuchen während eines Besuchs führt zurück zur Nachbarliste
      if (visit) endVisit();
      view = v; pane = null; picked = null;
      if (v === 'visit' && store.mode === 'account') loadNeighbours();
      if (v === 'trip') loadContest();
      return render();
    }
    if (b.dataset.pane === 'home' && pane !== 'home') return openHome();
    if (b.dataset.pane) {
      const p = b.dataset.pane;
      if (pane === p) pane = null;
      else { pane = p; if (view !== 'room') { abortTrip(); view = 'room'; } }
      return render();
    }
  });

  const screen = $('screen');
  screen.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.ci) { scene.hush(); if (d.ci === 'yes') runCheckin(); else checkinLater = Date.now() + 30 * 60000; return; }
    if (d.act) return act(d.act);
    if (d.menu) {
      const pet = activePet(state);
      const build = { feed: () => feedItems(pet), play: playItems, care: () => careItems(pet), bring: bringItems, gift: giftItems, greet: greetItems }[d.menu];
      if (build) toggleMenu(t, build, { up: true, head: d.menu === 'feed' ? `${pet.name} aus der Hand füttern` : '' });
      return;
    }
    if (d.gotoshop) { const [c, id] = d.gotoshop.split(':'); return openShop(c, id); }
    if ('home' in d) { endVisit(); return render(); }
    if (d.place) { tripPlace = d.place; sfx('klick'); return render(); }
    if (d.trip) return startTrip('walk', d.trip);
    if ('contest' in d) return startTrip('contest');
    if (d.visit) return startVisit(d.visit);
    if (d.species) {
      if (!isUnlocked(d.species, state)) return ok('Noch gesperrt', `<p>🔒 ${SPECIES[d.species].name}: ${unlockText(d.species)} freigeschaltet. Schau jeden Tag vorbei!</p>`);
      picked = d.species; return render();
    }
    if (t.id === 'adopt-back') { picked = null; return render(); }
    if (t.id === 'name-dice') { $('pet-name').value = pick(SPECIES[picked].names); return; }
  });
  screen.addEventListener('submit', (e) => {
    e.preventDefault();
    const color = screen.querySelector('input[name=color]:checked');
    const r = adopt(state, picked, color && color.value, $('pet-name').value);
    if (!r.ok) { ok('Adoptieren', `<p>${esc(r.text)}</p>`); return; }
    view = 'room'; picked = null;
    ensureDaily(state);
    note(`${r.pet.name} ist eingezogen.`, r.pet);
    store.save(state);
    sfx('stimme:' + r.pet.species);
    render();
    const welcome = state.pets.length === 1 ? ' In der Spielzeugkiste liegt schon ein Ball, und etwas Trockenfutter ist auch da.' : '';
    say(`${r.pet.name} ist bei dir eingezogen! Streichle ${r.pet.name}, damit ihr euch kennenlernt.${welcome}`, 9000);
  });

  const side = $('pane');
  side.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.pet) { selectPet(d.pet); return; }
    if ('adopt' in d) return goAdopt();
    if ('rename' in d) return rename();
    if ('dress' in d) {
      const pet = activePet(state);
      return openShop('acc', ['head', 'neck', 'back'].map((s) => pet.acc[s]).find(Boolean) || null);
    }
    if ('close' in d) { pane = null; placedNow = null; return render(); }
    if (d.stab) { shop.tab = d.stab; shop.pick = null; tryOn = null; sfx('klick'); return render(); }
    if (d.pick) { if (d.tabOf) shop.tab = d.tabOf; shop.pick = d.pick; if (tryOn && tryOn !== d.pick) tryOn = null; return render(); }
    if (d.buy) return doBuy(d.buy);
    if (d.try) { tryOn = tryOn === d.try ? null : d.try; sfx('klick'); return render(); }
    if (d.wear) {
      const pet = activePet(state);
      wear(state, pet, d.wear); tryOn = null;
      store.save(state); sfx('klick');
      render();
      log(pet.acc[ITEMS[d.wear].slot] === d.wear ? `${pet.name} trägt jetzt: ${ITEMS[d.wear].name}.` : `${ITEMS[d.wear].name} abgelegt.`, 5000);
      return;
    }
    if (d.room) { setRoom(state, d.room); store.save(state); sfx('klick'); return render(); }
    if (d.take) return takeToy(d.take);
    if (d.placeto) { const [at, id] = d.placeto.split(':'); return placeTo(id, at); }
    if (d.unplace) return takeBack(d.unplace);
    if (d.htab) { homeTab = d.htab; placedNow = null; sfx('klick'); return render(); }
    if ('checkin' in d) return runCheckin();
    if (d.ttab) { tripTab = d.ttab; if (tripTab === 'contest' && !contest) loadContest(); return render(); }
    if (d.gotoshop) { const [c, id] = d.gotoshop.split(':'); return openShop(c, id || null); }
  });
  side.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-mine]')) { shop.mine = t.checked; shop.pick = null; return render(); }
    if (t.name === 'privacy' && VISITOR_PRIVACY[t.value]) {
      state.visitors = t.value;
      store.save(state);
      store.flush();
      sfx('klick');
      log(`Besuchen dürfen dich jetzt: ${VISITOR_PRIVACY[t.value]}.`, 5000);
    }
  });

  // Eingabetaste: der Standardknopf der Leiste unter der Spielfläche (was dem Tier gerade am meisten fehlt)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.repeat || $('dlg').open || !$('menu').hidden) return;
    const a = document.activeElement;
    if (a && a !== document.body && !$('screen').contains(a)) return;
    if (a && a.closest && a.closest('button, a, input, select, textarea')) return;
    const def = document.querySelector('#dock .def:not(:disabled)');
    if (def) { e.preventDefault(); def.click(); }
  });

}

// ---------- Aussehen wie der Desktop: Windows 98 oder XP (🖥️ → Darstellung) ----------
function followTheme() {
  let src = null;
  try { if (window.parent !== window) src = window.parent.document.documentElement; } catch { src = null; }
  if (!src) return;
  const copy = () => { for (const c of ['theme-xp', 'xp-oliv', 'xp-silber', 'scheme-nacht']) document.documentElement.classList.toggle(c, src.classList.contains(c)); };
  copy();
  new MutationObserver(copy).observe(src, { attributes: true, attributeFilter: ['class'] });
}

// ---------- Ablauf ----------
// Beim Öffnen und beim Zurückkehren: Zeit nachrechnen, Tagesbesuch zählen. Gibt Meldungen für Dialoge zurück.
function arrive() {
  const away = tickAll(state);
  const msgs = [];
  if (registerVisit(state)) {
    const b = loginBonus(state);
    let html = `<p>🔥 <b>${days(state.visits.streak)} in Folge!</b></p><p>Täglicher Bonus (Tag ${b.day} von 7): ${coins(b.coins)}</p>`;
    if (b.item) html += `<p>${iconSvg('gift')} Überraschung: ${iconSvg(b.item)} ${ITEMS[b.item].name}</p>`;
    for (const m of streakMilestones(state)) html += `<p>${iconSvg('cup1')} ${m.text} Extra: ${coins(m.coins)}</p>`;
    msgs.push([state.visits.total === 1 ? 'Willkommen!' : 'Willkommen zurück!', html]);
    store.save(state);
  }
  ensureDaily(state);
  const pet = activePet(state);
  if (pet && away >= 3 && !pet.sleeping) setTimeout(() => tell(pet.id, `${pet.name} hat dich vermisst! ${mood(pet).text}`, 6000), 400);
  return msgs;
}

async function showAll(msgs) {
  for (const [title, html] of msgs) await dialog(title, html, [{ label: 'Prima', value: 'ok' }]);
}

function claimAccountBonus() {
  if (store.mode !== 'account') return [];
  const b = accountBonus(state);
  if (!b) return [];
  store.save(state);
  return [['Danke für dein Konto!', `<p>${iconSvg('acc_homepage', 'pxi x2')} Als Dankeschön bekommst du ${coins(b.coins)} und das exklusive <b>Homepage-Halstuch</b>.
    Du findest es im Shop unter Anziehen.</p>`]];
}

async function start() {
  followTheme();
  wire();
  const r = await store.load();
  state = r.state;
  const msgs = [];

  if (r.conflict) {
    const g = r.conflict.guest, a = r.conflict.account;
    const desc = (s) => `${s.pets.length ? s.pets.map((p) => esc(p.name)).join(', ') : 'noch kein Tier'}, ${coins(s.coins)}, zuletzt gespielt ${fmtDate(s.updatedAt)}`;
    const choice = await dialog('Zwei Spielstände gefunden',
      `<p>In diesem Browser gibt es noch einen Gast-Spielstand. Welchen möchtest du behalten?</p>
       <p><b>Konto:</b> ${desc(a)}<br><b>Gast:</b> ${desc(g)}</p>
       <p><small>Der andere wird gelöscht.</small></p>`,
      [{ label: 'Gast-Spielstand', value: 'guest' }, { label: 'Konto-Spielstand', value: 'account', def: true }]);
    const bonusTaken = state.accountBonus;
    state = await store.resolveConflict(choice);
    if (bonusTaken) state.accountBonus = true;  // das Konto-Geschenk gibt es auch nach dem Tausch nur einmal
  } else if (r.imported) {
    msgs.push(['Spielstand übernommen', '<p>✔ Dein Gast-Spielstand ist jetzt in deinem Konto gesichert und auf allen Geräten verfügbar.</p>']);
  }

  msgs.push(...claimAccountBonus(), ...arrive());
  if (store.mode === 'account') {
    live.open(store.user);
    const lines = await fetchInbox(false);
    if (lines.length) msgs.push(['Besuch war da!', lines.map((l) => `<p>${iconSvg('paw')} ${esc(l)}</p>`).join('')]);
  }
  render();
  connectDesk();
  markNews();
  await showAll(msgs);
  started = true;
  render();
  setTimeout(askCheckin, 8000);

  // Speichern beim Verlassen, Abgleich beim Zurückkehren (z. B. nach Spielen auf dem Handy)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { store.flush(true); return; }
    const newer = await store.refresh();
    if (newer) state = newer;
    fetchInbox();
    const m = arrive();
    if (!$('dlg').open && !picked) render();
    if (m.length && !$('dlg').open) { await showAll(m); render(); }
  });
  window.addEventListener('pagehide', () => { store.flush(true); });
  // Werte sinken weiter, solange das Spiel offen ist; Fehlgeschlagenes Speichern wiederholen
  setInterval(() => {
    tickAll(state);
    if (view === 'room' && state.pets.length && !$('dlg').open) { render(); askCheckin(); }
  }, 60000);
  setInterval(() => { if (store.dirty) store.flush(); }, 30000);
  // Ist das Fenster minimiert, kommt ab und zu ein Tier über seinen Knopf in der Taskleiste heraus
  setInterval(() => {
    if (!pets || visit || !pets.minimized() || Math.random() > 0.35) return;
    const g = state.desk.gates;
    const can = state.pets.filter((p) => mayLeave(p) && (Math.max(g.l, g.r) === 2 || (Math.max(g.l, g.r) === 1 && SMALL.includes(p.species))));
    if (can.length) leavePet(pick(can).id, 'task');
  }, 60000);
  // Live-Zimmer: Stand der eigenen Tiere an die anderen Anwesenden
  setInterval(() => { if (view === 'room' && live.connected && live.members.size) live.send(scene.snapshot()); }, 200);
}

start().catch((e) => {
  console.error(e);
  $('screen').innerHTML = '<p>⚠️ Das Spiel konnte nicht gestartet werden. Bitte lade die Seite neu.</p>';
});
