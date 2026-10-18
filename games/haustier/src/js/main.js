// Einstieg: Spielstand laden, Oberfläche zeichnen, regelmäßig speichern.
import { createStore } from './storage.js';
import { registerVisit, dayKey, newState } from './state.js';
import {
  SPECIES, STATS, ACTIONS, CUDDLE_LOVE, CUDDLE_LEVEL, SLOT_LEVEL, tickAll, tickPet, tickOpts, mood, canDo, doAction,
  adopt, activePet, isUnlocked, unlockText, petSlots, nextSlotHint, cleanName, level, levelProgress,
  availableActions, usableItems, walkLabel,
} from './pets.js';
import { ITEMS, ITEM_LIST, CATEGORIES, usableBy, isFav, isDurable } from './items.js';
import {
  ensureDaily, track, taskProgress, TASK_INFO, actionCoins, addCoins, loginBonus, streakMilestones, levelReward,
  accountBonus, available, relevant, dealOfDay, priceOf, canBuy, buy, wear, setRoom, LOGIN_BONUS, DAILY_CAP, ACCOUNT_BONUS,
  CHECKIN_QUESTIONS, checkIn, checkinDone,
} from './economy.js';
import { petSvg, roomSvg } from './art.js';
import { play as sfx, actionSound, muted, toggleMuted, VOLUME_KEY } from './sound.js';
import { createScene } from './scene.js';
import { TOYS } from './behavior.js';

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
const STATUS_TEXT = {
  local: '💾 Im Browser gespeichert',
  nostore: '⚠️ Speichern im Browser nicht möglich',
  pending: '💾 Ungespeicherte Änderungen …',
  saving: '💾 Speichere im Konto …',
  saved: '✅ Im Konto gespeichert',
  offline: '📴 Offline – wird später im Konto gespeichert',
  error: '⚠️ Speichern fehlgeschlagen – neuer Versuch folgt',
  loggedout: '⚠️ Abgemeldet – bitte neu anmelden, sonst geht Fortschritt verloren',
};
const STAT_NAME = Object.fromEntries(STATS.map((s) => [s.key, s]));
// Was eine Zuneigungsstufe freischaltet
const LEVEL_UNLOCKS = { [CUDDLE_LEVEL]: 'Ihr könnt jetzt kuscheln.', [SLOT_LEVEL]: 'Ein zweiter Tierplatz und der Puzzle-Futterball sind frei.', 8: 'Die Krone gibt es jetzt im Shop.' };

let state = newState();
let view = 'room';        // 'room' | 'adopt' | 'shop' | 'inventory' | 'tasks'
const tab = { shop: 'food', inventory: 'food' };
let picked = null;        // Tierart auf dem Adoptionsbildschirm
let bubble = null;        // Sprechblase oben im Zimmer: { text, until }
const lastAction = {};    // Abklingzeit je Tier und Aktion
let shownRoom = null;     // Hintergrund des gerade gezeichneten Zimmers (null = Zimmer nicht offen)

// Das Zimmer mit allen Tieren, die frei herumlaufen und mit Spielzeug spielen
const scene = createScene({
  state: () => state,
  select: (id) => selectPet(id),
  stroke: (id) => { if (activePet(state).id !== id) selectPet(id); act('pet'); },
  play: (id, itemId) => playWith(id, itemId),
  sound: (n) => sfx(n),
});

const store = createStore({
  savesUrl: config.savesUrl,
  ls: (() => { try { return window.localStorage; } catch { return null; } })(),
  onStatus: ({ status }) => { $('save-status').textContent = STATUS_TEXT[status] || status; },
  onReplace: (s) => { state = s; render(); },
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const coins = (n) => `🪙 ${n.toLocaleString('de-DE')}`;
const effectText = (eff = {}, mult = 1) => Object.entries(eff)
  .map(([k, v]) => `${v > 0 ? '+' : ''}${Math.round(v * (v > 0 ? mult : 1))} ${STAT_NAME[k].label}`).join(', ');
const speciesList = (ids) => ids.map((id) => (SPECIES[id] ? SPECIES[id].name : id)).join(', ');

// ---------- Dialog im Windows-Stil ----------
function dialog(title, html, buttons) {
  const dlg = $('dlg');
  $('dlg-title').textContent = title;
  $('dlg-body').innerHTML = html;
  const actions = $('dlg-actions');
  actions.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.value = b.value; el.textContent = b.label;
    if (b.danger) el.className = 'danger';
    actions.append(el);
  }
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue || buttons[buttons.length - 1].value), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    (dlg.querySelector('input:not([type=radio])') || actions.querySelector('button')).focus();
  });
}

const ok = (title, html) => dialog(title, html, [{ label: 'OK', value: 'ok' }]);

// ---------- Oberfläche ----------
function render() {
  $('coins').textContent = state.coins.toLocaleString('de-DE');
  $('streak').textContent = `🔥 ${state.visits.streak} ${state.visits.streak === 1 ? 'Tag' : 'Tage'}`;
  $('account-status').textContent = store.mode === 'account' ? '👤 ' + store.user : '👤 Gast';
  if (!state.pets.length) view = 'adopt';
  const d = ensureDaily(state);
  const open = d.tasks.filter((t) => !t.done).length;
  $('task-count').textContent = open ? `(${open})` : '✓';
  document.querySelectorAll('#menubar [data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view || (view === 'adopt' && b.dataset.view === 'room'));
    b.disabled = !state.pets.length && b.dataset.view !== 'room';
  });
  if (view !== 'room' && scene.toy) scene.putAway();
  if (view === 'room' && shownRoom === state.room && $('room')) updateRoom();
  else {
    const html = { adopt: adoptHtml, shop: shopHtml, inventory: inventoryHtml, tasks: tasksHtml }[view] || roomHtml;
    $('screen').innerHTML = html();
    shownRoom = view === 'room' ? state.room : null;
    if (shownRoom) scene.mount($('room'));
  }
  updateNotice();
}

// Im offenen Zimmer nur die Teile drumherum erneuern, die Szene mit den Tieren läuft weiter
function updateRoom() {
  $('pet-tabs').innerHTML = petTabs();
  $('checkin-slot').innerHTML = checkinBanner();
  $('bubble').textContent = bubbleText();
  $('toybox').innerHTML = toyboxHtml();
  $('side').innerHTML = sideHtml(activePet(state));
  $('room').classList.toggle('night', allAsleep());
  scene.sync();
}

function petTabs() {
  const free = state.pets.length < petSlots(state);
  const cur = activePet(state);
  const tabs = state.pets.map((p) => `<button type="button" class="tab${view === 'room' && p === cur ? ' active' : ''}" data-pet="${p.id}">
      ${SPECIES[p.species].icon} ${esc(p.name)}</button>`).join('');
  const add = free && state.pets.length
    ? `<button type="button" class="tab${view === 'adopt' ? ' active' : ''}" data-goto="adopt">➕ Adoptieren</button>` : '';
  if (state.pets.length < 2 && !add) return '';
  return `<div class="tabs" role="tablist">${tabs}${add}</div>`;
}

function catTabs(which, cats) {
  return `<div class="tabs" role="tablist">${cats.map((c) => `<button type="button" class="tab${tab[which] === c.id ? ' active' : ''}" data-tab="${which}:${c.id}">${c.icon} ${c.label}</button>`).join('')}</div>`;
}

function statBars(pet) {
  return STATS.map(({ key, label, icon }) => {
    const v = Math.round(pet.stats[key]);
    return `<div class="stat"><span class="stat-label">${icon} ${label}</span>
      <span class="bar${v < 25 ? ' low' : ''}" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><i style="width:${v}%"></i></span>
      <span class="stat-val">${v}</span></div>`;
  }).join('');
}

function actionButtons(pet) {
  return availableActions(pet, state).map((a) => {
    const c = canDo(pet, a, state);
    const locked = a === 'cuddle' && level(pet) < CUDDLE_LEVEL;
    const label = a === 'walk' ? walkLabel(pet.species) : ACTIONS[a].label;
    const icon = a === 'walk' && walkLabel(pet.species) === 'Ausflug' ? '🔵' : ACTIONS[a].icon;
    return `<button type="button" class="act${c.ok ? '' : ' unavailable'}" data-act="${a}" title="${esc(c.ok ? label : c.reason)}">
      <span class="act-icon" aria-hidden="true">${locked ? '🔒' : icon}</span>${label}${a === 'feed' ? ' …' : ''}</button>`;
  }).join('');
}

const allAsleep = () => state.pets.length > 0 && state.pets.every((p) => p.sleeping);

function bubbleText() {
  const pet = activePet(state);
  return bubble && bubble.until > Date.now() ? bubble.text : mood(pet).text;
}

function checkinBanner() {
  const pet = activePet(state);
  return checkinDone(state) ? '' : `<div class="checkin-banner"><span>💬 <b>Wie war dein Tag?</b> ${esc(pet.name)} möchte wissen, wie es dir geht. Drei kurze Fragen über dich.</span>
      <button type="button" class="small" data-checkin>Fragen beantworten</button></div>`;
}

// Spielzeug, mit dem mindestens eines der Tiere spielen kann
function toyboxHtml() {
  const ids = Object.keys(state.inventory).filter((id) => ITEMS[id] && ITEMS[id].cat === 'toy' && TOYS[id] && state.inventory[id] > 0
    && state.pets.some((p) => usableBy(ITEMS[id], p.species)));
  if (!ids.length) return '';
  const cur = scene.toy;
  const pet = activePet(state);
  const btns = ids.map((id) => {
    const it = ITEMS[id];
    const fav = isFav(it, pet.species) ? ' ❤️' : '';
    return `<button type="button" class="toy-btn${cur === id ? ' active' : ''}" data-toy="${id}" title="${esc(it.name + fav)}" aria-label="${esc(it.name)}" aria-pressed="${cur === id}">${it.icon}</button>`;
  }).join('');
  const hint = cur ? `<b>${esc(ITEMS[cur].name)}:</b> ${esc(TOYS[cur].hint)}` : 'Hol ein Spielzeug heraus und spiel mit deinen Tieren. Wer gerade Lust hat, macht mit.';
  return `<fieldset class="groupbox"><legend>🧸 Spielzeugkiste</legend><div class="toy-row">${btns}</div>
    <div class="toy-foot"><small class="toy-hint">${hint}</small>${cur ? '<button type="button" class="small" data-toy="">📦 Wegräumen</button>' : ''}</div></fieldset>`;
}

function sideHtml(pet) {
  const m = mood(pet);
  const sp = SPECIES[pet.species];
  const lp = levelProgress(pet);
  return `<div class="pet-head"><b>${sp.icon} ${esc(pet.name)}</b> <button type="button" class="small" data-rename title="Umbenennen">✏️</button>
      <small>${sp.name} · ${m.label}</small></div>
    <fieldset class="groupbox"><legend>Zuneigung</legend>
      <div class="stat"><span class="stat-label">💞 Stufe ${level(pet)}</span>
        <span class="bar xp"><i style="width:${lp.need ? Math.round((100 * lp.have) / lp.need) : 100}%"></i></span>
        <span class="stat-val small-val">${lp.need ? `${lp.have}/${lp.need}` : 'max'}</span></div>
    </fieldset>
    <fieldset class="groupbox"><legend>Werte</legend>${statBars(pet)}</fieldset>
    <fieldset class="groupbox"><legend>Pflege</legend><div class="actions">${actionButtons(pet)}</div></fieldset>`;
}

function roomHtml() {
  const pet = activePet(state);
  const sp = SPECIES[pet.species];
  const hint = state.pets.length > 1 ? 'Tipp ein Tier an, um es auszuwählen. ' : '';
  return `<div id="pet-tabs">${petTabs()}</div><div id="checkin-slot">${checkinBanner()}</div>
    <div class="room-layout">
      <div class="room-col">
        <div class="room${allAsleep() ? ' night' : ''}" id="room" title="${hint}Mit gedrückter Maus oder dem Finger über ein Tier streichen zum Streicheln" aria-label="Zimmer mit ${esc(state.pets.map((p) => p.name).join(', '))}, ausgewählt: ${esc(pet.name)} (${sp.name})">
          ${roomSvg(state.room)}
          <div class="bubble" id="bubble" aria-live="polite">${esc(bubbleText())}</div>
        </div>
        <div id="toybox">${toyboxHtml()}</div>
      </div>
      <div class="side" id="side">${sideHtml(pet)}</div>
    </div>`;
}

function adoptHtml() {
  const first = state.pets.length === 0;
  const full = state.pets.length >= petSlots(state);
  const intro = first
    ? '<h1>Wähle dein erstes Haustier</h1><p>Um dein Tier musst du dich jeden Tag kümmern. Besondere Tiere schaltest du frei, wenn du oft vorbeischaust.</p>'
    : `<h1>Ein weiteres Tier adoptieren</h1><p>Du hast ${state.pets.length} von ${petSlots(state)} Plätzen belegt.</p>`;
  if (full) {
    const hint = nextSlotHint(state);
    return `${petTabs()}<h1>Kein Platz frei</h1><p>${hint || 'Du hast schon die größtmögliche Tierfamilie.'}</p>`;
  }
  if (picked) {
    const sp = SPECIES[picked];
    const colors = sp.colors.map((c, i) => `<label class="color-pick"><input type="radio" name="color" value="${c.id}"${i === 0 ? ' checked' : ''}>
        ${petSvg(picked, c.id, 'happy')}<span>${c.name}</span></label>`).join('');
    return `${petTabs()}<h1>${sp.icon} ${sp.name} adoptieren</h1>
      <form id="adopt-form">
        <fieldset class="groupbox"><legend>Fellfarbe</legend><div class="colors">${colors}</div></fieldset>
        <fieldset class="groupbox"><legend>Name</legend>
          <input id="pet-name" maxlength="20" value="${esc(pick(sp.names))}" required>
          <button type="button" class="small" id="name-dice" title="Anderer Name">🎲</button></fieldset>
        <div class="dlg-actions"><button type="button" id="adopt-back">« Zurück</button><button type="submit">🏠 Adoptieren</button></div>
      </form>`;
  }
  const cards = Object.entries(SPECIES).map(([id, sp]) => {
    const open = isUnlocked(id, state);
    return `<button type="button" class="card${open ? '' : ' locked'}" data-species="${id}"${open ? '' : ' aria-disabled="true"'}>
      ${petSvg(id, sp.colors[0].id, open ? 'happy' : 'sleep')}
      <b>${open ? '' : '🔒 '}${sp.name}</b><small>${open ? sp.hint : unlockText(id)}</small></button>`;
  }).join('');
  return `${petTabs()}${intro}<div class="cards">${cards}</div>`;
}

// Bild eines Gegenstands: Accessoires am aktiven Tier, Räume als Mini-Raum, sonst das Symbol
function itemPic(item) {
  const pet = activePet(state);
  if (item.cat === 'acc' && pet) return `<span class="item-pic">${petSvg(pet.species, pet.color, 'happy', { acc: { ...pet.acc, [item.slot]: item.id } })}</span>`;
  if (item.cat === 'room') return `<span class="item-pic room-pic">${roomSvg(item.id)}</span>`;
  return `<span class="item-pic item-emoji" aria-hidden="true">${item.icon}</span>`;
}

function itemInfo(item) {
  const bits = [];
  if (item.effect) bits.push(effectText(item.effect));
  if (item.note) bits.push(esc(item.note));
  if (item.for) bits.push(`Für: ${speciesList(item.for)}`);
  if (item.except) bits.push(`Nicht für: ${speciesList(item.except)}`);
  if (item.fav) bits.push(`❤️ Liebling von: ${speciesList(item.fav)}`);
  return bits.join('<br>');
}

function shopCard(item, deal = false) {
  const av = available(state, item);
  const c = canBuy(state, item.id);
  const price = priceOf(state, item);
  const have = state.inventory[item.id] || 0;
  const hasIt = isDurable(item) && (have > 0 || (item.id === 'extra_slot' && state.extraSlots));
  const status = hasIt ? '<span class="owned">✓ Im Inventar</span>' : have ? `<span class="owned">Im Inventar: ${have}</span>` : '';
  const priceHtml = price !== item.price ? `<s>${item.price}</s> <b>${coins(price)}</b>` : `<b>${item.price ? coins(price) : 'Gratis'}</b>`;
  const btn = !av.ok ? `<button type="button" class="small" disabled>🔒 ${av.reason}</button>`
    : hasIt ? ''
      : `<button type="button" class="small${c.ok ? '' : ' unavailable'}" data-buy="${item.id}" title="${esc(c.ok ? 'Kaufen' : c.reason)}">${item.price ? 'Kaufen' : 'Freischalten'}</button>`;
  return `<div class="item${deal ? ' deal' : ''}${av.ok ? '' : ' locked'}">${itemPic(item)}
    <div class="item-body"><b>${item.name}</b>${deal ? ' <span class="badge">−30 %</span>' : ''}<small>${itemInfo(item)}</small>
    <div class="item-foot">${priceHtml} ${status} ${btn}</div></div></div>`;
}

function shopHtml() {
  const dealId = dealOfDay(state);
  const items = ITEM_LIST.filter((i) => i.cat === tab.shop && !i.notForSale && relevant(state, i))
    .filter((i) => !(i.req && i.req.owns) || available(state, i).ok);
  return `<h1>🛒 Shop</h1>
    <fieldset class="groupbox"><legend>⭐ Angebot des Tages</legend>${shopCard(ITEMS[dealId], true)}</fieldset>
    ${catTabs('shop', CATEGORIES)}<div class="items">${items.map((i) => shopCard(i)).join('')}</div>`;
}

function inventoryHtml() {
  const pet = activePet(state);
  const ids = Object.keys(state.inventory).filter((id) => ITEMS[id] && ITEMS[id].cat === tab.inventory && state.inventory[id] > 0);
  const cards = ids.map((id) => {
    const item = ITEMS[id];
    const n = state.inventory[id];
    const can = usableBy(item, pet.species);
    const nope = `<small>Nichts für ${esc(pet.name)}</small>`;
    let btn = '';
    if (item.cat === 'food') btn = can ? `<button type="button" class="small" data-use="feed:${id}">Füttern</button>` : nope;
    if (item.cat === 'toy') btn = can ? `<button type="button" class="small" data-use="play:${id}">Spielen</button>` : nope;
    if (item.cat === 'acc') btn = `<button type="button" class="small" data-wear="${id}">${pet.acc[item.slot] === id ? 'Ablegen' : 'Anlegen'}</button>`;
    if (item.cat === 'room') btn = state.room === id ? '<span class="owned">✓ Eingerichtet</span>' : `<button type="button" class="small" data-room="${id}">Einrichten</button>`;
    const fav = isFav(item, pet.species) ? ' <span title="Lieblingssache">❤️</span>' : '';
    return `<div class="item">${itemPic(item)}<div class="item-body"><b>${item.name}</b>${fav}${!isDurable(item) ? ` <span class="badge">× ${n}</span>` : ''}
      <small>${itemInfo(item)}</small><div class="item-foot">${btn}</div></div></div>`;
  }).join('');
  const empty = `<p class="muted">Hier ist noch nichts. <button type="button" class="small" data-goto="shop">Zum Shop</button></p>`;
  return `<h1>🎒 Inventar</h1><p>Benutzen, anlegen und einrichten für <b>${esc(pet.name)}</b>.</p>
    ${catTabs('inventory', CATEGORIES)}<div class="items">${cards || empty}</div>`;
}

function tasksHtml() {
  const d = ensureDaily(state);
  const tasks = d.tasks.map((t) => {
    const info = TASK_INFO[t.id];
    const have = taskProgress(state, t);
    const pct = Math.round((100 * have) / info.goal);
    return `<div class="task${t.done ? ' done' : ''}"><span class="task-check">${t.done ? '✅' : '⬜'}</span>
      <div class="task-body"><b>${info.text}</b><span class="bar"><i style="width:${t.done ? 100 : pct}%"></i></span></div>
      <span class="task-reward">${coins(info.reward)}</span></div>`;
  }).join('');
  const cycle = ((Math.max(1, state.visits.streak) - 1) % 7) + 1;
  const days = LOGIN_BONUS.map((c, i) => `<div class="bonus-day${i + 1 < cycle ? ' past' : ''}${i + 1 === cycle ? ' today' : ''}">
      <small>Tag ${i + 1}</small><b>${c}</b>${i === 6 ? '<small>+ 🎁</small>' : ''}</div>`).join('');
  const ci = checkinDone(state)
    ? '<div class="task done"><span class="task-check">✅</span><div class="task-body"><b>Fragen zu deinem Tag beantwortet</b><small>Morgen gibt es neue.</small></div></div>'
    : `<div class="task"><span class="task-check">💬</span><div class="task-body"><b>Wie war dein Tag?</b><small>Drei kurze Fragen über dich</small></div>
       <button type="button" class="small" data-checkin>Beantworten</button></div>`;
  return `<h1>📋 Tagesaufgaben</h1><div class="tasks">${ci}${tasks || '<p>Heute keine Aufgaben.</p>'}</div>
    <p class="muted">Morgen gibt es neue Aufgaben. Münzen aus Pflege heute: ${d.actionCoins} von ${DAILY_CAP}.</p>
    <fieldset class="groupbox"><legend>🔥 Login-Bonus (${state.visits.streak} ${state.visits.streak === 1 ? 'Tag' : 'Tage'} in Folge)</legend>
      <div class="bonus">${days}</div><small>Komm jeden Tag vorbei. Nach Tag 7 beginnt die Woche von vorn, die Serie zählt weiter.</small></fieldset>
    ${store.mode === 'guest' ? `<p class="notice-inline">💾 Mit einem Konto bekommst du einmalig ${ACCOUNT_BONUS} Münzen und das Homepage-Halstuch.</p>` : ''}`;
}

function updateNotice() {
  const p = store.prefs();
  $('guest-notice').hidden = store.mode !== 'guest' || p.noticeHiddenDay === dayKey(Date.now());
}

function say(text, ms = 4000) {
  bubble = { text, until: Date.now() + ms };
  const el = $('bubble');
  if (el) el.textContent = text;
}

// Kleine aufsteigende Symbole und Zahlen über dem Tier nach einer Aktion
function floaters(pet, delta, gained = 0) {
  const list = Object.entries(delta).filter(([, v]) => v).map(([k, v]) => [`${STAT_NAME[k].icon} ${v > 0 ? '+' : ''}${v}`, v < 0, '']);
  if (gained) list.push([`🪙 +${gained}`, false, 'coin']);
  scene.floaters(pet.id, list);
}

function selectPet(id) {
  if (!state.pets.some((p) => p.id === id) || state.activePet === id) return;
  state.activePet = id; bubble = null;
  store.save(state);
  render();
}

// Spielen mit dem Spielzeug im Zimmer: Die Szene meldet, wenn ein Tier es gefangen oder benutzt hat
function playWith(petId, itemId) {
  const pet = state.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false };
  tickPet(pet, Date.now(), tickOpts(state));
  const r = doAction(pet, 'play', state, Date.now(), { itemId });
  if (!r.ok) { if (pet === activePet(state)) say(r.text, 3000); return { ok: false }; }
  finish(pet, 'play', r, { animate: false });
  return { ok: true, factor: r.factor, fav: r.fav };
}

// Spielzeug aus der Kiste holen (für das gewählte Tier das liebste zuerst)
function takeToy(id) {
  const pet = activePet(state);
  const ids = usableItems(state, pet, 'toy').filter((x) => TOYS[x]);
  id ||= ids[0];
  if (!id) { sfx('nein'); say(`Du hast kein Spielzeug für ${pet.name}. Schau im Shop vorbei!`, 3500); return; }
  view = 'room';
  render();
  scene.useToy(id);
  sfx('klick');
  say(TOYS[id].hint, 5000);
  render();
}

// Futter oder Spielzeug auswählen
async function pickItem(pet, action) {
  const cat = ACTIONS[action].item;
  const ids = usableItems(state, pet, cat);
  if (ids.length <= 1) return ids[0] || null;
  const rows = ids.map((id) => {
    const it = ITEMS[id], fav = isFav(it, pet.species);
    const tired = cat === 'toy' && (pet.fatigue['play:' + id] || 0) >= 3 ? ' <small>(gerade langweilig)</small>' : '';
    return `<button class="pick" value="${id}"><span class="item-emoji">${it.icon}</span><span><b>${it.name}</b>${fav ? ' ❤️' : ''}${tired}
      <small>${effectText(it.effect, fav ? 1.5 : 1)}${cat === 'food' ? ` · noch ${state.inventory[id]}` : ''}</small></span></button>`;
  }).join('');
  const r = await dialog(action === 'feed' ? `Was bekommt ${pet.name}?` : `Womit spielt ${pet.name}?`, `<div class="picks">${rows}</div>`,
    [{ label: 'Abbrechen', value: 'cancel' }]);
  return ids.includes(r) ? r : null;
}

async function act(action, itemId = null) {
  const pet = activePet(state);
  if (!pet) return;
  if (action === 'play' && !pet.sleeping) return takeToy(itemId);
  const key = pet.id + ':' + action;
  const now = Date.now();
  if (lastAction[key] && now - lastAction[key] < ACTIONS[action].cooldown) return;
  tickPet(pet, now, tickOpts(state));
  const check = canDo(pet, action, state, itemId, now);
  if (!check.ok) { sfx('nein'); if (view === 'room') say(check.reason, 3500); else ok(ACTIONS[action].label, `<p>${esc(check.reason)}</p>`); return; }
  if (ACTIONS[action].item && !itemId) {
    itemId = await pickItem(pet, action);
    if (!itemId) return;
  }
  const r = doAction(pet, action, state, Date.now(), { itemId });
  if (!r.ok) { sfx('nein'); say(r.text, 3500); return; }
  lastAction[key] = now;
  await finish(pet, action, r);
}

// Nach einer gelungenen Aktion: Klänge, Münzen, Aufgaben, Speichern, Anzeige
async function finish(pet, action, r, { animate = true } = {}) {
  actionSound(action, pet.species).forEach((n, i) => setTimeout(() => sfx(n), i * 350));
  let gained = actionCoins(state, action, r.factor);
  const notes = [r.text];
  if (action === 'pet' && pet.acc.neck === 'acc_bell') notes[0] += ' 🔔 Klingeling!';
  if (r.found && r.found.coins) { gained += addCoins(state, r.found.coins); notes.push(`Fund: ${r.found.coins} Münzen!`); }
  if (r.found && r.found.item) notes.push(`Fund: ${ITEMS[r.found.item].icon} ${ITEMS[r.found.item].name}!`);
  for (const t of track(state, action, { itemId: r.itemId })) notes.push(`✅ Aufgabe erledigt: ${t.text} (+${t.reward} Münzen)`);
  store.save(state);
  view = 'room';
  bubble = { text: notes.join(' '), until: Date.now() + 4000 + notes.length * 1500 };
  render();
  if (animate) scene.animate(pet.id, action, { itemId: r.itemId, found: r.found });
  floaters(pet, r.delta, gained);
  if (gained) setTimeout(() => sfx('muenze'), 450);
  if (r.levelUp) {
    setTimeout(() => sfx('fanfare'), 700);
    scene.animate(pet.id, 'levelup');
    const bonus = levelReward(state, r.levelUp);
    store.save(state);
    render();
    await dialog('Neue Zuneigungsstufe!', `<p>🎉 <b>${esc(pet.name)}</b> ist jetzt auf <b>Stufe ${r.levelUp}</b>. Dafür gibt es ${coins(bonus)}.</p>
      ${LEVEL_UNLOCKS[r.levelUp] ? `<p>${LEVEL_UNLOCKS[r.levelUp]}</p>` : ''}`, [{ label: 'Juhu!', value: 'ok' }]);
  }
}

async function doBuy(id) {
  const item = ITEMS[id];
  const c = canBuy(state, id);
  if (!c.ok) { sfx('nein'); ok('Shop', `<p>${esc(c.reason)}</p>`); return; }
  if (c.price >= 300) {
    const sure = await dialog('Kaufen?', `<p>${item.icon} <b>${item.name}</b> für ${coins(c.price)} kaufen?</p>`, [{ label: 'Kaufen', value: 'yes' }, { label: 'Abbrechen', value: 'no' }]);
    if (sure !== 'yes') return;
  }
  const r = buy(state, id);
  if (!r.ok) return;
  sfx('kaufen');
  store.save(state);
  render();
  const extra = r.done.map((t) => `<p>✅ Aufgabe erledigt: ${t.text} (+${t.reward} Münzen)</p>`).join('');
  const where = item.cat === 'acc' ? ' Leg es im Inventar an.' : item.cat === 'room' ? ' Der Raum ist schon eingerichtet.'
    : id === 'extra_slot' ? ' Du kannst jetzt ein weiteres Tier adoptieren.' : '';
  ok('Gekauft', `<p>${item.icon} <b>${item.name}</b> ist jetzt in deinem Inventar.${where}</p>${extra}`);
}

async function rename() {
  const pet = activePet(state);
  const r = await dialog('Umbenennen', `<p><label>Neuer Name für ${esc(pet.name)}:<br><input id="rename-input" maxlength="20" value="${esc(pet.name)}"></label></p>`,
    [{ label: 'OK', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]);
  const name = cleanName($('rename-input').value);
  if (r !== 'ok' || !name) return;
  pet.name = name;
  store.save(state);
  render();
}

// ---------- Fragen zum eigenen Wohlbefinden ----------
async function runCheckin() {
  if (checkinDone(state)) return;
  const pet = activePet(state);
  const answers = [];
  for (const [i, q] of CHECKIN_QUESTIONS.entries()) {
    const r = await dialog(`Wie war dein Tag? (${i + 1}/3)`, `<p class="question">${q.text}</p>`,
      [{ label: 'Ja', value: 'yes' }, { label: 'Nein', value: 'no' }, { label: 'Später', value: 'later' }]);
    if (r === 'later') return;
    answers.push(r === 'yes');
  }
  const res = checkIn(state, answers);
  if (!res.ok) return;
  sfx('freude');
  store.save(state);
  const feelsBad = answers[2] === false;
  bubble = pet ? { text: feelsBad ? `${pet.name} kuschelt sich ganz nah an dich.` : `${pet.name} freut sich mit dir!`, until: Date.now() + 6000 } : null;
  render();
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

// ---------- Neuigkeiten ----------
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
  ok('📜 Neuigkeiten', `<div class="changelog">${c.html}</div>`);
}

function wire() {
  $('login-link').href = config.loginUrl;
  $('register-link').href = config.registerUrl;
  $('register-link').hidden = !config.registerUrl;
  $('notice-later').addEventListener('click', () => { store.setPrefs({ noticeHiddenDay: dayKey(Date.now()) }); updateNotice(); });
  $('menubar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || !state.pets.length) return;
    sfx('klick');
    view = b.dataset.view; picked = null; render();
  });

  const screen = $('screen');
  screen.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.act) return act(d.act);
    if (d.use) { const [a, id] = d.use.split(':'); return a === 'play' ? takeToy(id) : act(a, id); }
    if (d.toy !== undefined) {
      if (!d.toy || d.toy === scene.toy) { scene.putAway(); sfx('klick'); bubble = null; return render(); }
      return takeToy(d.toy);
    }
    if (d.buy) return doBuy(d.buy);
    if (d.wear) { wear(state, activePet(state), d.wear); store.save(state); return render(); }
    if (d.room) { setRoom(state, d.room); store.save(state); return render(); }
    if (d.tab) { const [w, c] = d.tab.split(':'); tab[w] = c; return render(); }
    if (d.pet) { state.activePet = d.pet; view = 'room'; picked = null; bubble = null; store.save(state); return render(); }
    if (d.goto) { view = d.goto; picked = null; return render(); }
    if (d.species) {
      if (!isUnlocked(d.species, state)) return ok('Noch gesperrt', `<p>🔒 ${SPECIES[d.species].name}: ${unlockText(d.species)} freigeschaltet. Schau jeden Tag vorbei!</p>`);
      picked = d.species; return render();
    }
    if (t.id === 'adopt-back') { picked = null; return render(); }
    if (t.id === 'name-dice') { $('pet-name').value = pick(SPECIES[picked].names); return; }
    if ('rename' in d) return rename();
    if ('checkin' in d) return runCheckin();
  });
  screen.addEventListener('submit', (e) => {
    e.preventDefault();
    const color = screen.querySelector('input[name=color]:checked');
    const r = adopt(state, picked, color && color.value, $('pet-name').value);
    if (!r.ok) { ok('Adoptieren', `<p>${esc(r.text)}</p>`); return; }
    view = 'room'; picked = null;
    ensureDaily(state);
    store.save(state);
    sfx('stimme:' + r.pet.species);
    const welcome = state.pets.length === 1 ? ' Im Inventar liegen schon ein Ball und etwas Trockenfutter.' : '';
    bubble = { text: `${r.pet.name} ist bei dir eingezogen! Streichle ${r.pet.name}, damit ihr euch kennenlernt.${welcome}`, until: Date.now() + 9000 };
    render();
  });

  document.querySelector('[data-open=news]').addEventListener('click', showNews);
  // Ton an/aus: derselbe Schalter wie „Ton aus“ am 🔊-Regler der Homepage
  const soundBtn = document.querySelector('[data-open=sound]');
  const showSound = () => { const m = muted(); soundBtn.textContent = m ? '🔇' : '🔊'; soundBtn.title = m ? 'Ton einschalten' : 'Ton ausschalten'; };
  soundBtn.addEventListener('click', () => { toggleMuted(); showSound(); sfx('pop'); });
  window.addEventListener('storage', (e) => { if (e.key === VOLUME_KEY) showSound(); });
  showSound();
  document.querySelector('[data-open=help]').addEventListener('click', () => ok('Hilfe',
    `<p>Kümmere dich jeden Tag um dein Haustier. Die Werte sinken mit der Zeit, auch wenn du nicht da bist,
     aber nie unter 10. Krank wird dein Tier nicht, es wird nur traurig, wenn du es vernachlässigst.</p>
     <ul><li>Deine Tiere laufen frei im Zimmer herum, besuchen sich gegenseitig und spielen Fangen. <b>Tipp ein Tier an</b>, um es auszuwählen.</li>
     <li><b>Streicheln</b> geht auch, indem du mit der Maus oder dem Finger über ein Tier streichst.</li>
     <li><b>Spielen:</b> Hol ein Spielzeug aus der <b>Spielzeugkiste</b> unter dem Zimmer. Bälle wirfst du, indem du sie ziehst und loslässt,
       Federangel und Laserpointer folgen deiner Maus, Seifenblasen pustest du mit einem Tipp ins Zimmer. Jedes Tier, das gerade Lust hat, macht mit.</li>
     <li>Jede Pflege bringt <b>Zuneigung</b>. Ab Stufe ${CUDDLE_LEVEL} und ${CUDDLE_LOVE} Liebe könnt ihr <b>kuscheln</b>,
       ab Stufe ${SLOT_LEVEL} gibt es einen zweiten Tierplatz.</li>
     <li>Pflege bringt <b>Münzen</b> (bis ${DAILY_CAP} am Tag), dazu kommen Login-Bonus und Tagesaufgaben.</li>
     <li>Im <b>Shop</b> gibt es Futter, Spielzeug, Pflegesachen, Accessoires und Räume. Lieblingsfutter und
       Lieblingsspielzeug (❤️) wirken 50 % stärker.</li>
     <li>Zu oft hintereinander dasselbe wirkt schwächer. Lieber öfter am Tag vorbeischauen.</li>
     <li>Einmal am Tag gibt es drei kurze Fragen zu <b>deinem</b> Tag. Gespeichert wird nur, dass du geantwortet hast, nicht was.</li></ul>
     <p>${store.mode === 'account'
       ? 'Dein Spielstand wird automatisch in deinem Konto gespeichert und ist auf allen Geräten verfügbar.'
       : 'Als Gast wird dein Spielstand nur in diesem Browser gespeichert. Mit einem Konto ist er dauerhaft gesichert und auf allen Geräten verfügbar.'}</p>`));

  document.querySelector('[data-open=settings]').addEventListener('click', async () => {
    const where = store.mode === 'account' ? `im Konto <b>${esc(store.user)}</b>` : 'nur in diesem Browser (Gast)';
    const r = await dialog('Einstellungen',
      `<fieldset class="groupbox"><legend>Spielstand</legend>
        <p>Gespeichert ${where}.<br>Angefangen am ${fmtDate(state.createdAt)}.<br>
        Besuchstage: ${state.visits.total} · beste Serie: ${state.visits.best}<br>
        Insgesamt verdient: ${coins(state.earned || 0)}</p></fieldset>`,
      [{ label: 'Spielstand zurücksetzen …', value: 'reset', danger: true }, { label: 'Schließen', value: 'close' }]);
    if (r !== 'reset') return;
    const sure = await dialog('Spielstand zurücksetzen',
      '<p>⚠️ Dein ganzer Fortschritt geht verloren, auch deine Tiere und Münzen. Das kann nicht rückgängig gemacht werden.</p>',
      [{ label: 'Ja, alles löschen', value: 'yes', danger: true }, { label: 'Abbrechen', value: 'no' }]);
    if (sure !== 'yes') return;
    const hadBonus = state.accountBonus;
    state = store.reset();
    state.accountBonus = hadBonus;   // das Konto-Geschenk gibt es nur einmal
    registerVisit(state);
    store.save(state);
    view = 'adopt'; picked = null; bubble = null;
    render();
  });
}

// ---------- Ablauf ----------
// Beim Öffnen und beim Zurückkehren: Zeit nachrechnen, Tagesbesuch zählen. Gibt Meldungen für Dialoge zurück.
function arrive() {
  const away = tickAll(state);
  const msgs = [];
  if (registerVisit(state)) {
    const b = loginBonus(state);
    let html = `<p>🔥 <b>${state.visits.streak} ${state.visits.streak === 1 ? 'Tag' : 'Tage'} in Folge!</b></p><p>Täglicher Bonus (Tag ${b.day} von 7): ${coins(b.coins)}</p>`;
    if (b.item) html += `<p>🎁 Überraschung: ${ITEMS[b.item].icon} ${ITEMS[b.item].name}</p>`;
    for (const m of streakMilestones(state)) html += `<p>🏆 ${m.text} Extra: ${coins(m.coins)}</p>`;
    msgs.push([state.visits.total === 1 ? 'Willkommen!' : 'Willkommen zurück!', html]);
    store.save(state);
  }
  ensureDaily(state);
  const pet = activePet(state);
  if (pet && away >= 3 && !pet.sleeping) bubble = { text: `${pet.name} hat dich vermisst! ${mood(pet).text}`, until: Date.now() + 6000 };
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
  return [['Danke für dein Konto!', `<p>🎁 Als Dankeschön bekommst du ${coins(b.coins)} und das exklusive <b>💾 Homepage-Halstuch</b>.
    Du findest es im Inventar unter Accessoires.</p>`]];
}

async function start() {
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
      [{ label: 'Gast-Spielstand', value: 'guest' }, { label: 'Konto-Spielstand', value: 'account' }]);
    const bonusTaken = state.accountBonus;
    state = await store.resolveConflict(choice);
    if (bonusTaken) state.accountBonus = true;  // das Konto-Geschenk gibt es auch nach dem Tausch nur einmal
  } else if (r.imported) {
    msgs.push(['Spielstand übernommen', '<p>✅ Dein Gast-Spielstand ist jetzt in deinem Konto gesichert und auf allen Geräten verfügbar.</p>']);
  }

  msgs.push(...claimAccountBonus(), ...arrive());
  render();
  markNews();
  await showAll(msgs);
  render();

  // Speichern beim Verlassen, Abgleich beim Zurückkehren (z. B. nach Spielen auf dem Handy)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { store.flush(true); return; }
    const newer = await store.refresh();
    if (newer) state = newer;
    const m = arrive();
    if (!$('dlg').open && !picked) render();
    if (m.length && !$('dlg').open) { await showAll(m); render(); }
  });
  window.addEventListener('pagehide', () => { store.flush(true); });
  // Werte sinken weiter, solange das Spiel offen ist; Fehlgeschlagenes Speichern wiederholen
  setInterval(() => {
    tickAll(state);
    if (view === 'room' && state.pets.length && !$('dlg').open) render();
  }, 60000);
  setInterval(() => { if (store.dirty) store.flush(); }, 30000);
}

start().catch((e) => {
  console.error(e);
  $('screen').innerHTML = '<p>⚠️ Das Spiel konnte nicht gestartet werden. Bitte lade die Seite neu.</p>';
});
