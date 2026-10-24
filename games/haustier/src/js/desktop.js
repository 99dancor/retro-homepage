// Pixelpfoten draußen: Tiere und Möbel auf dem Desktop der Homepage. Läuft im Desktop selbst, nicht im Spiel-Fenster:
// public/retro.js lädt die Datei als <script type="module"> (window.RetroPets.load). Das Spiel im Fenster verbindet sich
// mit attach(win, hooks) und bleibt Herr über den Spielstand; hier wird nur gezeichnet, bewegt und zurückgemeldet.
//
//   api.attach(win, hooks) -> { ok, reason }      api.detach(win)
//   api.out(visual, at)         ein Tier kommt heraus: at { side: 'l' | 'r' | 'task', u } (Tor links, rechts, Taskleisten-Knopf)
//   api.restore(visual, at)     nach dem Neuladen: at { x, y } als Anteil des Desktops
//   api.update({ pets, items, bowls })   Stand aus dem Spiel (items: Möbel auf dem Desktop [{ id, x, y }])
//   api.call(id) / callAll()    heimrufen          api.furnish(on, sel)   Möbel verschieben
//   api.options(o)              api.minimized() -> Spiel-Fenster minimiert?
//
// hooks (vom Spiel, deskHooks in main.js): pets, gates, back, where, act, eat, fill, bowls, moved, unplace, prank, options,
//   furnish, stopFurnish, sound
//
// Physik und Wege stehen DOM-frei in deskphys.js. Alles bleibt Pixel-Art: ganzzahliger Maßstab U, nie gedreht.
import { petSvg } from './art.js';
import { iconSvg, ICON_OF } from './icons.js';
import { SPECIES } from './pets.js';
import { FURN, furnSvg, bowlSprite, sleepsIn } from './furniture.js';
import { KEYS, safeLocal } from './storage.js';
import {
  deskOptions, prankDue, surfaces, surfaceKey, below, fall, jumpTo, canHop, hopPoints, route, sameSurface, throwVelocity, HARD_THROW,
} from './deskphys.js';

const R = window.RetroDesk;
const doc = document;
const deskEl = doc.getElementById('desk');
const local = safeLocal((() => { try { return window.localStorage; } catch { return null; } })());
const PRANK_KEY = 'haustier:v1:prank';
const TAB = Math.random().toString(36).slice(2);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const px = (v) => Math.round(v) + 'px';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const make = (tag, cls, inner = '') => { const e = doc.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };
const readJSON = (k) => { try { return JSON.parse(local.get(k) || 'null'); } catch { return null; } };
const EMOTE = { '❤️': 'heart', '💤': 'zzz', '♪': 'note', '✨': 'sparkle', '❗': 'bang', '🐾': 'paw', '😄': 'star' };
const SMALL = ['hamster', 'rat', 'axolotl'];

// Aussehen kommt aus dem Spiel; hier nur die Ebenen für Tiere (über den Fenstern) und Möbel (auf dem Desktop)
const css = make('link', '');
css.rel = 'stylesheet'; css.href = '/haustier/css/desk.css';
doc.head.append(css);
const layer = make('div', 'pp-layer');
doc.body.append(layer);
const furnLayer = make('div', 'pp-furn');
deskEl.append(furnLayer);
const ladders = { l: make('div', 'pp-ladder'), r: make('div', 'pp-ladder') };
layer.append(ladders.l, ladders.r);

let game = null;              // { win, hooks }
let U = 2;                    // Größe eines Bildpunkts, wie im Zimmer
let opts = deskOptions(readJSON(KEYS.deskOpts));
let furnishing = null;        // { sel, drag }
let bowls = { food: 0, water: 0 };
const pets = new Map();       // id -> Tier draußen
const things = new Map();     // id -> Möbel oder Spielzeug auf dem Desktop
let geo = { W: 800, floor: 560, top: 0, h: 560 };
let surfs = [];
let wins = [];                // sichtbare Fenster (für Laufflächen)
let maxed = false;            // ein maximiertes Fenster verdeckt den Desktop
let raf = 0, last = 0;
let pointer = { x: -1, y: -1, t: 0 };
let activeAt = Date.now();
let lastPrank = Number(local.get(PRANK_KEY)) || 0;
let beat = 0, whereAt = 0;
const S = () => 48 * U;
const winIds = new WeakMap();
let winSeq = 0;
const winId = (el) => { if (!winIds.has(el)) winIds.set(el, 'w' + ++winSeq); return winIds.get(el); };

// ---------- Geometrie ----------
function measure() {
  const tb = doc.querySelector('.taskbar');
  const floor = tb ? tb.getBoundingClientRect().top : innerHeight;
  const dr = deskEl.getBoundingClientRect();
  geo = { W: doc.documentElement.clientWidth, floor, top: dr.top, h: Math.max(1, floor - dr.top), left: dr.left };
  const list = R && R.windows ? R.windows() : [];
  maxed = list.some((w) => w.max && !w.min);
  wins = list.filter((w) => !w.min && !w.max).map((w) => {
    const r = w.el.getBoundingClientRect();
    return { id: winId(w.el), left: r.left, top: r.top, right: r.right, bottom: r.bottom, z: w.z, w };
  });
  const items = [];
  for (const t of things.values()) {
    if (!t.f.tops || t.toy) continue;
    const b = boxOf(t);
    t.f.tops.forEach((top, k) => items.push({ id: `i:${t.id}:${k}`, left: b.left + 2 * U, right: b.left + b.w - 2 * U, top: b.top + top * U }));
  }
  surfs = surfaces(wins, { floor, width: geo.W, items, minTop: S() * 0.85 });
}
const floorSurf = () => surfs.find((s) => s.kind === 'floor');
const gameWin = () => (game && R && R.windows ? R.windows().find((w) => w.win === game.win) : null);

// Lage eines Möbels in Bildschirmpunkten
function boxOf(t) {
  const w = t.f.w * U, h = t.f.h * U;
  const left = clamp(t.x * geo.W - w / 2, 0, Math.max(0, geo.W - w));
  if (t.toy) return { left: t.b.x - w / 2, top: t.b.y - h, w, h };
  const bottom = t.f.wall ? clamp(geo.top + t.y * geo.h, geo.top + h, geo.floor - 2 * U) : geo.floor;
  return { left, top: bottom - h, w, h };
}

// ---------- Möbel und Spielzeug ----------
function syncThings(items) {
  for (const [id, t] of things) if (!items.some((i) => i.id === id)) { t.el.remove(); things.delete(id); }
  for (const it of items) {
    const f = FURN[it.id];
    if (!f) continue;
    let t = things.get(it.id);
    if (!t) {
      t = { id: it.id, f, toy: !!f.toy, el: make('div', 'pp-thing' + (f.toy ? ' toy' : '') + (f.wall ? ' wall' : '')), sig: '', x: it.x, y: it.y };
      t.el.dataset.thing = it.id;
      if (t.toy) {
        t.b = { x: it.x * geo.W, y: geo.top + it.y * geo.h, vx: 0, vy: 0, mode: 'air', on: null, adx: 0 };
        layer.append(t.el);
      } else furnLayer.append(t.el);
      things.set(it.id, t);
    }
    if (!(furnishing && furnishing.drag && furnishing.drag.id === it.id) && !t.toy) { t.x = it.x; t.y = it.y; }
    drawThing(t);
  }
}
function drawThing(t) {
  const f = t.f;
  const level = f.bowl ? bowls[f.bowl] : 0;
  const sprite = f.bowl ? bowlSprite(f.bowl, level) : t.id;
  const sig = sprite + '|' + !!furnishing + '|' + !!game;
  if (t.sig !== sig) {
    t.sig = sig;
    t.el.innerHTML = (t.toy ? iconSvg(t.id) : t.id === 'toy_wheel' ? furnSvg('toy_wheel', 'pxi w0') + furnSvg('toy_wheel_1', 'pxi w1') : furnSvg(sprite))
      + (furnishing && !t.toy ? '<button type="button" class="pp-x" title="Ins Fach legen" aria-label="Ins Fach legen">×</button>' : '');
    t.el.title = !game ? 'Pixelpfoten öffnen' : furnishing ? 'Ziehen zum Verschieben'
      : f.bowl === 'food' ? 'Futternapf: antippen zum Füllen' : f.bowl === 'water' ? 'Wassernapf: antippen zum Füllen' : '';
  }
  t.el.classList.toggle('sel', !!furnishing && furnishing.sel === t.id);
  t.el.classList.toggle('furnish', !!furnishing);
}
function placeThings() {
  for (const t of things.values()) {
    const b = boxOf(t);
    t.el.style.width = b.w + 'px'; t.el.style.height = b.h + 'px';
    if (t.toy) t.el.style.transform = `translate(${px(b.left)}, ${px(b.top)})`;
    else t.el.style.transform = `translate(${px(b.left - geo.left)}, ${px(b.top - geo.top)})`;
    t.el.style.zIndex = t.f.wall ? 1 : t.f.flat ? 2 : 3;
  }
}

// Ohne offenes Spiel: Möbel aus der Kopie im Browser, damit sie trotzdem dastehen
function showCopy() {
  const c = readJSON(KEYS.desk);
  const me = doc.body.dataset.user || '';
  if (!c || String(c.user || '') !== me || !Array.isArray(c.items)) return;
  U = clamp(Math.round(c.u || 2), 1, 4);
  if (c.bowls) bowls = { food: c.bowls.food || 0, water: c.bowls.water || 0 };
  measure();
  syncThings(c.items);
  for (const t of things.values()) if (t.toy) { t.b.y = geo.floor; t.b.mode = 'stand'; t.b.on = floorSurf(); }
  placeThings();
}

// ---------- Tiere ----------
function makePet(v) {
  const el = make('div', 'pp-pet');
  el.dataset.pet = v.id;
  const body = make('div', 'pp-body'), flip = make('div', 'pp-flip');
  body.append(flip);
  const emote = make('div', 'pp-emote'), name = make('div', 'pp-name');
  el.append(make('div', 'pp-shadow'), body, emote, name);
  layer.append(el);
  const p = {
    id: v.id, v, el, body, flip, emote, name, key: '',
    b: { x: geo.W / 2, y: geo.floor, vx: 0, vy: 0, mode: 'air', on: null, adx: 0 },
    facing: 1, walking: false, goal: null, path: null, until: 0, busyUntil: 0, home: false, ladder: null,
    outAt: Date.now(), stayFor: rand(150e3, 480e3), held: null, thrown: 0, chaseUntil: 0, nextChase: 0, perch: 0, bed: null, emoteUntil: 0,
  };
  pets.set(v.id, p);
  drawPet(p);
  return p;
}
function drawPet(p) {
  const v = p.v;
  const face = p.face || v.face || 'ok';
  const key = [v.species, v.color, face, JSON.stringify(v.acc || {})].join('|');
  if (key !== p.key) {
    p.key = key;
    p.flip.innerHTML = petSvg(v.species, v.color, face, { acc: v.acc || {}, shadow: false, title: `${v.name}, ${SPECIES[v.species] ? SPECIES[v.species].name : ''}` });
  }
  p.name.textContent = v.name;
  p.el.classList.toggle('sleeping', !!v.sleeping);
}
function removePet(p) { p.el.remove(); pets.delete(p.id); if (p.bed) p.bed = null; }

function emote(p, sym, ms = 1600) {
  p.emote.innerHTML = EMOTE[sym] ? iconSvg(EMOTE[sym]) : `<b>${esc(sym)}</b>`;
  p.emote.classList.remove('show'); void p.emote.offsetWidth; p.emote.classList.add('show');
  p.emoteUntil = performance.now() + ms;
}
function floaters(p, delta = {}, coins = 0) {
  const list = Object.entries(delta).filter(([, v]) => v).map(([k, v]) => `${iconSvg(ICON_OF[k] || k)}${v > 0 ? '+' : ''}${v}`);
  if (coins) list.push(`${iconSvg('coin')}+${coins}`);
  list.forEach((html, i) => {
    const f = make('span', 'pp-float', html);
    f.style.left = `${10 + ((i * 27) % 70)}%`;
    f.style.animationDelay = `${i * 120}ms`;
    p.el.append(f);
    setTimeout(() => f.remove(), 1900 + i * 120);
  });
}
function flash(p, cls, ms) {
  p.el.classList.add(cls);
  clearTimeout(p['t_' + cls]);
  p['t_' + cls] = setTimeout(() => p.el.classList.remove(cls), ms);
}
// Kurze Sprechblase über dem Tier (z. B. nach einem Streich)
let sayEl = null, sayTimer = 0;
function say(p, html, ms = 3500, buttons = '') {
  if (sayEl) sayEl.remove();
  sayEl = make('div', 'pp-say', html + buttons);
  sayEl.dataset.pet = p.id;
  layer.append(sayEl);
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { if (sayEl) { sayEl.remove(); sayEl = null; } }, ms);
  placeSay();
  return sayEl;
}
function placeSay() {
  if (!sayEl) return;
  const p = pets.get(sayEl.dataset.pet);
  if (!p) { sayEl.remove(); sayEl = null; return; }
  const w = sayEl.offsetWidth, h = sayEl.offsetHeight;
  const x = clamp(p.b.x - w / 2, 4, geo.W - w - 4), y = Math.max(4, p.b.y - S() - h - 4);
  sayEl.style.transform = `translate(${px(x)}, ${px(y)})`;
  sayEl.style.setProperty('--tail', px(clamp(p.b.x - x, 12, w - 12)));
}
const sound = (n) => { if (opts.sound && game) try { game.hooks.sound(n); } catch { /* Spiel weg */ } };
const hook = (name, ...a) => { if (!game || !game.hooks[name]) return undefined; try { return game.hooks[name](...a); } catch (e) { console.error('Pixelpfoten:', e); return undefined; } };

// ---------- Körper: stehen, fallen, mitfahren ----------
// Wer auf einer Titelleiste oder einem Möbel steht, fährt mit; verschwindet die Fläche, fällt er
function anchorLeft(id) {
  if (id === 'floor') return 0;
  if (id.startsWith('i:')) { const t = things.get(id.split(':')[1]); return t ? boxOf(t).left : null; }
  const w = wins.find((o) => o.id === id);
  return w ? w.left : null;
}
function land(b, s) {
  b.mode = 'stand'; b.on = s; b.vx = 0; b.vy = 0; b.skip = null;
  const l = anchorLeft(s.id);
  b.adx = l === null ? 0 : b.x - l;
}
function settle(b) {
  if (b.mode !== 'stand' || !b.on) return;
  const l = anchorLeft(b.on.id);
  if (l === null) { b.mode = 'air'; b.on = null; return; }
  if (b.on.kind !== 'floor') b.x = l + b.adx;
  const s = surfs.find((o) => o.id === b.on.id && b.x >= o.x1 - 1 && b.x <= o.x2 + 1);
  if (!s) { b.mode = 'air'; b.on = null; b.vy = 0; return; }
  b.y = s.y; b.on = s;
  b.x = clamp(b.x, s.x1, s.x2);
}
function airborne(b, dt, half, opt = {}) {
  const s = fall(b, dt, surfs, { width: geo.W, half, ...opt });
  if (s) {
    // Spielzeug springt ein bisschen nach
    if (opt.bounce && b.vy > 320) { b.vy = -b.vy * 0.45; b.y = s.y - 0.5; return null; }
    land(b, s);
  }
  return s;
}
function walkTo(p, x, speed, dt) {
  const d = x - p.b.x, st = speed * dt;
  if (Math.abs(d) <= st) { p.b.x = x; p.walking = false; p.b.adx += d; return true; }
  p.b.x += Math.sign(d) * st; p.b.adx += Math.sign(d) * st;
  p.facing = d > 0 ? 1 : -1;
  p.walking = true;
  return false;
}
const speedOf = (p, run = false) => (run ? 170 : 75) * (U / 2) * (p.v.species === 'axolotl' ? 0.7 : SMALL.includes(p.v.species) ? 1.15 : 1);

// Zum Ziel (Fläche + x): laufen, springen, fallen lassen. true = angekommen
function travel(p, goal, dt, run = false) {
  const b = p.b;
  if (b.mode !== 'stand') return false;
  const target = surfs.find((s) => sameSurface(s, goal.s)) || surfs.find((s) => s.id === goal.s.id && goal.x >= s.x1 && goal.x <= s.x2);
  if (!target) return null;
  goal.s = target;
  if (sameSurface(b.on, target)) return walkTo(p, clamp(goal.x, target.x1, target.x2), speedOf(p, run), dt);
  const path = route(surfs, b.on, target, S());
  if (path && path.length) {
    const next = path[0];
    const pts = hopPoints(b.on, next, S(), b.x);
    if (walkTo(p, pts.from, speedOf(p, run), dt)) jump(p, { x: pts.to, y: next.y });
    return false;
  }
  // Kein Weg nach oben: von hier oben erst einmal herunter (zum näheren Rand und fallen lassen)
  if (b.on.kind !== 'floor') {
    const edge = Math.abs(goal.x - b.on.x1) < Math.abs(goal.x - b.on.x2) ? b.on.x1 - S() * 0.3 : b.on.x2 + S() * 0.3;
    if (walkTo(p, clamp(edge, b.on.x1, b.on.x2), speedOf(p, run), dt)) { b.skip = surfaceKey(b.on); b.mode = 'air'; b.on = null; b.vx = Math.sign(edge - b.x || 1) * 60; b.vy = -120; }
    return false;
  }
  return null;
}
function jump(p, to) {
  const b = p.b;
  const j = jumpTo({ x: b.x, y: b.y }, to, { apex: S() * 0.35 });
  b.skip = to.y > b.y + 2 && b.on ? surfaceKey(b.on) : null;
  b.vx = j.vx; b.vy = j.vy; b.mode = 'air'; b.on = null;
  p.facing = to.x > b.x ? 1 : to.x < b.x ? -1 : p.facing;
  p.walking = false;
}

// ---------- Was ein Tier draußen tut ----------
function decide(p, t) {
  const v = p.v, b = p.b, fl = floorSurf();
  p.goal = null;
  if (p.home) return goHome(p);
  if (maxed) {
    // Ein Fenster füllt den Bildschirm: in die Ecke und dösen
    const i = [...pets.keys()].indexOf(p.id);
    p.goal = { why: 'corner', s: fl, x: geo.W - S() * (0.7 + i * 0.9) };
    return;
  }
  if (v.sleeping) {
    const bed = freeBed(p);
    if (bed) { p.bed = bed.id; p.goal = { why: 'bed', s: fl, x: bed.x * geo.W }; } else { p.until = t + 4000; }
    return;
  }
  if ((v.need === 'food' && bowls.food > 0 && things.has('furn_bowl_food')) || (v.need === 'water' && bowls.water > 0 && things.has('furn_bowl_water'))) {
    const t2 = things.get(v.need === 'food' ? 'furn_bowl_food' : 'furn_bowl_water');
    const bx = boxOf(t2);
    p.goal = { why: 'bowl', kind: v.need, s: fl, x: bx.left + (b.x < bx.left ? -S() * 0.3 : bx.w + S() * 0.3) };
    return;
  }
  // Nach ein paar Minuten draußen geht es von selbst wieder heim, wenn das Tor offen ist
  if (Date.now() - p.outAt > p.stayFor && ladderFor(p)) { p.home = true; return goHome(p); }
  if (reduced()) { p.until = t + rand(5000, 9000); return; }
  const r = Math.random();
  if (r < 0.1 && opts.pranks.icons && sniffIcon(p)) return;
  if (r < 0.32) {
    const up = surfs.filter((s) => s !== b.on && canHop(b.on, s, S()));
    if (up.length) { const s = pick(up); p.goal = { why: 'wander', s, x: rand(s.x1 + S() / 2, Math.max(s.x1 + S() / 2, s.x2 - S() / 2)) }; return; }
  }
  if (r < 0.4) {
    const wheel = things.get('toy_wheel');
    if (wheel && FURN.toy_wheel.station.includes(v.species)) { p.goal = { why: 'wheel', s: fl, x: wheel.x * geo.W }; return; }
  }
  if (r < 0.48 && b.on && b.on.kind !== 'floor') { p.goal = { why: 'wander', s: fl, x: rand(S(), geo.W - S()) }; return; }
  if (r < 0.8 && b.on) { p.goal = { why: 'wander', s: b.on, x: rand(b.on.x1 + S() / 3, Math.max(b.on.x1 + S() / 3, b.on.x2 - S() / 3)) }; return; }
  p.until = t + rand(2000, 5000);
  if (Math.random() < 0.3) emote(p, pick(['♪', '✨', '🐾']));
}

function arrive(p, t) {
  const g = p.goal;
  p.goal = null;
  p.walking = false;
  if (!g) return;
  if (g.why === 'corner') { p.until = t + 6000; emote(p, '💤', 2000); return; }
  if (g.why === 'bed') { const bed = things.get(p.bed); p.perch = bed && bed.f.seat ? bed.f.h - bed.f.seat - 2 : 0; p.until = t + 8000; return; }
  if (g.why === 'bowl') {
    const t2 = things.get(g.kind === 'food' ? 'furn_bowl_food' : 'furn_bowl_water');
    if (t2) p.facing = boxOf(t2).left + boxOf(t2).w / 2 > p.b.x ? 1 : -1;
    const r = hook('eat', p.id, g.kind);
    if (r) { flash(p, 'eating', 1900); p.busyUntil = t + 1900; floaters(p, r.delta); }
    p.until = t + 2500;
    return;
  }
  if (g.why === 'wheel') {
    const w = things.get('toy_wheel');
    if (!w) return;
    w.el.classList.add('spin'); flash(p, 'running', 2600); p.busyUntil = t + 2600;
    setTimeout(() => { w.el.classList.remove('spin'); const r = hook('act', p.id, 'play', { toy: 'toy_wheel' }); if (r && r.ok) { emote(p, '♪'); floaters(p, r.delta, r.coins); } }, 2600);
    p.until = t + 3500;
    return;
  }
  if (g.why === 'icon') {
    g.icon.classList.add('pp-sniff'); setTimeout(() => g.icon.classList.remove('pp-sniff'), 1300);
    p.facing = g.icon.getBoundingClientRect().left + 20 > p.b.x ? 1 : -1;
    emote(p, '✨', 1200); p.busyUntil = t + 1300; p.until = t + 2500;
    return;
  }
  if (g.why === 'prank') { doPrank(p, g.prank); return; }
  if (g.why === 'ladder') { climbIn(p, g.side); return; }
  if (g.why === 'door') { goInside(p, g.side); return; }
  p.until = t + rand(1500, 4000);
}

function freeBed(p) {
  const taken = new Set([...pets.values()].filter((o) => o !== p && o.bed).map((o) => o.bed));
  if (p.bed && things.has(p.bed)) return things.get(p.bed);
  return [...things.values()].find((t) => t.f.sleep && !taken.has(t.id) && sleepsIn(t.id, p.v.species)) || null;
}

// Desktop-Symbole in Reichweite (auf Augenhöhe und auf derselben Fläche) beschnuppern: wackeln nur, öffnen nichts
function sniffIcon(p) {
  const b = p.b, s = S();
  const icons = [...doc.querySelectorAll('#deskicons .dicon')].filter((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    return r.width && r.bottom > b.y - s * 1.4 && r.bottom < b.y + 6 && cx > b.on.x1 && cx < b.on.x2 && !coveredAt(cx, r.top + r.height / 2);
  });
  if (!icons.length) return false;
  const el = pick(icons), r = el.getBoundingClientRect();
  p.goal = { why: 'icon', icon: el, s: b.on, x: r.left + r.width / 2 + (b.x < r.left ? -s * 0.35 : s * 0.35) };
  return true;
}
const coveredAt = (x, y) => wins.some((w) => x >= w.left && x <= w.right && y >= w.top && y <= w.bottom);

// ---------- Tor, Strickleiter, Taskleiste ----------
// Die Leiter hängt außen am Fensterrand, an der Schwelle des Tores, und reicht nur bis zur nächsten Fläche darunter
let ladderPos = { l: null, r: null };
function placeLadders() {
  ladderPos = { l: null, r: null };
  const gw = gameWin();
  const g = gw && !gw.min ? hook('gates') : null;
  if (g) {
    U = clamp(Math.round(g.u || U), 1, 4);
    const fr = gw.iframe.getBoundingClientRect(), wr = gw.el.getBoundingClientRect();
    const lw = 15 * U;
    for (const side of ['l', 'r']) {
      if (!(g[side] > 0) && ![...pets.values()].some((p) => p.ladder && p.ladder.side === side)) continue;
      const x = clamp(side === 'l' ? wr.left - lw / 2 + U : wr.right + lw / 2 - U, lw / 2, geo.W - lw / 2);
      const top = fr.top + g.y;
      if (top >= geo.floor - 4) continue;
      const bottom = below(surfs, x, top + 2);
      ladderPos[side] = { side, x, top, bottom: bottom ? bottom.y : geo.floor, s: bottom, open: g[side] };
    }
  }
  for (const side of ['l', 'r']) {
    const lp = ladderPos[side], el = ladders[side];
    el.hidden = !lp;
    if (!lp) continue;
    const lw = 15 * U;
    el.style.width = lw + 'px'; el.style.height = px(lp.bottom - lp.top);
    el.style.backgroundSize = `${lw}px ${8 * U}px`;
    el.style.transform = `translate(${px(lp.x - lw / 2)}, ${px(lp.top)})`;
  }
}
const ladderUrl = () => `url("data:image/svg+xml,${encodeURIComponent(furnSvg('ladder', ''))}")`;
for (const el of Object.values(ladders)) el.style.backgroundImage = ladderUrl();

// Passt das Tier durch ein offenes Tor? Dann über die Leiter heim
function ladderFor(p) {
  const fits = (lp) => lp && (lp.open === 2 || (lp.open === 1 && SMALL.includes(p.v.species)) || p.home);
  const opts2 = ['l', 'r'].map((s) => ladderPos[s]).filter(fits);
  if (!opts2.length) return null;
  return opts2.reduce((a, c) => (Math.abs(c.x - p.b.x) < Math.abs(a.x - p.b.x) ? c : a));
}
function goHome(p) {
  const gw = gameWin();
  if (!gw) return;
  if (gw.min) {
    // Minimiert: Der Knopf in der Taskleiste ist die Tür
    const r = gw.task.getBoundingClientRect();
    p.goal = { why: 'door', side: 'task', s: floorSurf(), x: r.left + r.width / 2 };
    return;
  }
  const lp = ladderFor(p);
  if (lp && lp.s) { p.goal = { why: 'ladder', side: lp.side, s: lp.s, x: lp.x }; return; }
  // Kein Tor zu sehen (z. B. beim Ausflug): einfach zum Fenster
  const wr = gw.el.getBoundingClientRect();
  const x = clamp(wr.left + S() * 0.6, S() / 2, geo.W - S() / 2);
  const s = below(surfs, x, Math.min(geo.floor, wr.bottom) - 1) || floorSurf();
  p.goal = { why: 'door', side: 'l', s, x };
}
function climbIn(p, side) {
  const lp = ladderPos[side];
  if (!lp) { p.until = 0; return; }
  p.ladder = { side, dir: -1 };
  p.b.mode = 'ladder'; p.b.on = null; p.b.x = lp.x;
}
function goInside(p, side) {
  p.el.classList.add('pp-in');
  p.b.mode = 'gone';
  setTimeout(() => backHome(p, side === 'task' ? 'r' : side), 350);
}
function backHome(p, side) {
  if (!pets.has(p.id)) return;
  removePet(p);
  hook('back', p.id, side);
  if (homing && !pets.size) { homing(); homing = null; }
  trayUpdate();
}

// ---------- Streiche ----------
const PRANK_TARGETS = {
  bell: () => doc.getElementById('notifybtn'),
  volume: () => doc.getElementById('volumebtn'),
  start: () => doc.getElementById('startbtn'),
  tasks: () => {
    const list = (R.windows ? R.windows() : []).filter((w) => !w.active && !w.min && w.win !== (game && game.win));
    return list.length ? pick(list).task : null;
  },
};
function planPrank(t) {
  if (!game || furnishing || maxed || !prankDue({ now: Date.now(), last: lastPrank, active: activeAt, reduced: reduced() })) return;
  const ids = Object.keys(PRANK_TARGETS).filter((k) => opts.pranks[k] && PRANK_TARGETS[k]());
  const p = [...pets.values()].find((o) => !o.v.sleeping && !o.home && o.b.mode === 'stand' && (!o.goal || o.goal.why === 'wander'));
  if (!ids.length || !p) return;
  const id = pick(ids), el = PRANK_TARGETS[id]();
  const r = el.getBoundingClientRect();
  lastPrank = Date.now();
  local.set(PRANK_KEY, String(lastPrank));
  p.goal = { why: 'prank', prank: { id, el }, s: floorSurf(), x: r.left + r.width / 2 };
  p.until = t + 30000;
}
function doPrank(p, { id, el }) {
  const t = performance.now();
  if (Date.now() - activeAt < 3000 || !el.isConnected) return;   // wer gerade etwas tut, wird nicht gestört
  flash(p, 'pounce', 500); p.busyUntil = t + 900; p.until = t + 2500;
  el.classList.add('pp-wiggle'); setTimeout(() => el.classList.remove('pp-wiggle'), 900);
  const name = esc(p.v.name);
  if (id === 'bell') {
    if (window.RetroSound) window.RetroSound.play('ding');
    say(p, `Klingeling! ${name} hat die Glocke gefunden.`, 3500);
    hook('prank', p.id, `${p.v.name} hat draußen an der Glocke geläutet.`);
  } else if (id === 'volume') {
    const S0 = window.RetroSound;
    if (!S0) return;
    const before = S0.get();
    const step = (v) => Math.max(0, Math.round((v - 0.1) * 10) / 10);
    if (before.stumm || (!before.musik && !before.effekte)) return;
    S0.set({ musik: step(before.musik), effekte: step(before.effekte) });
    const box = say(p, `${name} hat den Ton etwas leiser gedreht.`, 9000, '<div class="row"><button type="button" class="small" data-undo>Rückgängig</button></div>');
    box.querySelector('[data-undo]').addEventListener('click', () => { S0.set({ musik: before.musik, effekte: before.effekte }); box.remove(); sayEl = null; });
    hook('prank', p.id, `${p.v.name} hat draußen den Ton leiser gedreht.`);
  } else if (id === 'start') {
    const menu = doc.getElementById('startmenu');
    if (menu && !menu.classList.contains('open')) el.click();
    const at = activeAt;
    setTimeout(() => { if (menu && menu.classList.contains('open') && activeAt === at) el.click(); }, 4000);
    say(p, `${name} schaut mal ins Startmenü.`, 3500);
    hook('prank', p.id, `${p.v.name} hat draußen das Startmenü aufgemacht.`);
  } else if (id === 'tasks') {
    el.click();
    say(p, `${name} zieht an einem Fenster.`, 3500);
    hook('prank', p.id, `${p.v.name} hat draußen an einem Fensterknopf gezogen.`);
  }
  sound('stimme:' + p.v.species);
}

// ---------- Takt ----------
function tick(ts) {
  raf = 0;
  const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
  last = ts;
  const t = performance.now();
  measure();
  placeLadders();
  for (const p of pets.values()) stepPet(p, dt, t);
  for (const th of things.values()) if (th.toy) stepToy(th, dt, t);
  separate();
  draw(t);
  planPrank(t);
  if (game && Date.now() - whereAt > 15000) report();
  if (pets.size || [...things.values()].some((th) => th.toy && th.b.mode !== 'stand') || furnishing) raf = requestAnimationFrame(tick);
  else { last = 0; placeThings(); }
}
function wake() { if (!raf && !doc.hidden) raf = requestAnimationFrame(tick); }

function stepPet(p, dt, t) {
  const b = p.b;
  if (b.mode === 'held' || b.mode === 'gone') return;
  if (b.mode === 'ladder') {
    const lp = ladderPos[p.ladder.side];
    if (!lp) { b.mode = 'air'; p.ladder = null; return; }
    b.x = lp.x;
    b.y += p.ladder.dir * 80 * (U / 2) * dt;
    p.walking = true;
    if (p.ladder.dir > 0 && b.y >= lp.bottom) { b.y = lp.bottom; p.ladder = null; if (lp.s) land(b, lp.s); else b.mode = 'air'; p.walking = false; p.until = t + 800; }
    else if (p.ladder.dir < 0 && b.y <= lp.top) { b.y = lp.top; backHome(p, lp.side); }
    return;
  }
  if (b.mode === 'air') {
    const s = airborne(b, dt, S() * 0.3, { ceil: S() * 0.9 });
    if (s && p.thrown) {
      const hard = p.thrown > HARD_THROW;
      p.thrown = 0;
      const r = hook('act', p.id, 'throw', { hard });
      if (r && r.text) say(p, esc(r.text), 2500);
      emote(p, hard ? '❗' : '😄');
      if (r && r.face) { p.face = r.face; p.key = ''; setTimeout(() => { p.face = null; p.key = ''; }, 2500); }
      flash(p, 'squish', 500);
      p.until = t + 1500;
    }
    return;
  }
  settle(b);
  if (b.mode !== 'stand') return;
  if (t < p.busyUntil) { p.walking = false; return; }
  if (p.v.sleeping && !p.home) {
    // Schläft: aufs Bett, wenn eins frei ist, sonst hier
    if (!p.goal && (!p.bed || !things.has(p.bed))) { p.bed = null; const bed = freeBed(p); if (bed) { p.bed = bed.id; p.goal = { why: 'bed', s: floorSurf(), x: bed.x * geo.W }; } }
    if (p.goal && p.goal.why === 'bed') { const r = travel(p, p.goal, dt * 0.7); if (r) arrive(p, t); else if (r === null) p.goal = null; }
    else p.walking = false;
    if (t > p.emoteUntil + 2500) emote(p, '💤', 2000);
    return;
  }
  if (p.bed) { p.bed = null; p.perch = 0; }
  // Spielzeug, das fliegt oder rollt, wird gejagt
  const toy = [...things.values()].find((th) => th.toy && th.fresh);
  if (toy && !p.home && !(p.goal && ['prank', 'bowl'].includes(p.goal.why))) {
    if (chaseToy(p, toy, dt, t)) return;
  }
  // Mauszeiger jagen
  if (opts.mouse && !p.home && !reduced() && (!p.goal || p.goal.why === 'wander' || p.goal.why === 'mouse')) {
    const near = Math.abs(pointer.x - b.x) < 320 && Math.abs(pointer.y - b.y) < 220 && Date.now() - pointer.t < 1200;
    if (near && t > p.nextChase && (!p.goal || p.goal.why !== 'mouse')) { p.goal = { why: 'mouse', s: b.on, x: pointer.x }; p.chaseUntil = t + 5000; emote(p, '❗', 700); }
    if (p.goal && p.goal.why === 'mouse') {
      p.goal.x = clamp(pointer.x, b.on.x1, b.on.x2);
      if (Math.hypot(pointer.x - b.x, pointer.y - (b.y - S() / 2)) < S() * 0.6) { hopUp(p, 0.6); flash(p, 'pounce', 400); p.goal = null; p.nextChase = t + 15000; p.until = t + 1200; return; }
      if (t > p.chaseUntil) { p.goal = null; p.nextChase = t + 15000; }
      else { walkTo(p, p.goal.x, speedOf(p, true), dt); return; }
    }
  }
  if (!p.goal && t > p.until) decide(p, t);
  if (p.goal) {
    const r = travel(p, p.goal, dt, p.home || p.goal.why === 'prank');
    if (r === true) arrive(p, t);
    else if (r === null) { p.goal = null; p.until = t + 2000; }
  } else p.walking = false;
}
function hopUp(p, k = 1) { if (p.b.mode === 'stand') { p.b.mode = 'air'; p.b.on = null; p.b.vy = -520 * k * (U / 2); } }

function chaseToy(p, toy, dt, t) {
  const tb = toy.b, b = p.b;
  if (toy.carried) return false;
  const s = tb.mode === 'stand' ? tb.on : below(surfs, tb.x, tb.y);
  if (!s) return false;
  if (sameSurface(s, b.on) || tb.mode === 'air') {
    walkTo(p, clamp(tb.x, b.on.x1, b.on.x2), speedOf(p, true), dt);
    if (Math.abs(tb.x - b.x) < S() * 0.35 && tb.y > b.y - S() * 0.9 && tb.y <= b.y + 4) {
      toy.fresh = false; toy.carried = p.id;
      const r = hook('act', p.id, 'play', { toy: toy.id });
      if (r && r.ok) { emote(p, '♪'); floaters(p, r.delta, r.coins); } else emote(p, '💤', 900);
      setTimeout(() => { toy.carried = null; tb.mode = 'air'; tb.vx = p.facing * 80; tb.vy = -150; toy.resting = 0; wake(); }, 1200);
      p.until = t + 1500;
    } else if (tb.mode === 'air' && Math.abs(tb.x - b.x) < S() * 0.6 && tb.y < b.y - S() * 0.6 && tb.y > b.y - S() * 2) hopUp(p, 0.8);
    return true;
  }
  if (canHop(b.on, s, S())) { p.goal = { why: 'toy', s, x: tb.x }; return false; }
  return false;
}

function stepToy(th, dt, t) {
  const b = th.b;
  if (th.carried) {
    const p = pets.get(th.carried);
    if (!p) { th.carried = null; return; }
    b.x = p.b.x + p.facing * S() * 0.25; b.y = p.b.y - S() * 0.3; b.mode = 'carried';
    return;
  }
  if (b.mode === 'held') return;
  if (b.mode === 'air' || b.mode === 'carried') {
    if (b.mode === 'carried') b.mode = 'air';
    const s = airborne(b, dt, 8 * U, { bounce: 0.6, ceil: 16 * U });
    if (s && b.mode === 'stand') { b.vx = th.roll || 0; th.roll = 0; }
    return;
  }
  // Rollt aus
  if (b.vx) { b.x += b.vx * dt; b.adx += b.vx * dt; b.vx *= Math.pow(0.04, dt); if (Math.abs(b.vx) < 6) b.vx = 0; }
  settle(b);
  if (b.mode === 'stand' && !b.vx && !th.resting) {
    th.resting = t;
    setTimeout(() => { if (th.resting === t) th.fresh = false; }, 5000);
    hook('moved', th.id, +(b.x / geo.W).toFixed(3), +((b.y - geo.top) / geo.h).toFixed(3));
  }
}

// Tiere auf derselben Fläche halten etwas Abstand (Schlafende bleiben liegen)
function separate() {
  // Wer läuft, darf vorbei; nur wer steht oder liegt, rückt zur Seite
  const list = [...pets.values()].filter((p) => p.b.mode === 'stand' && !p.walking);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      if (!sameSurface(a.b.on, c.b.on)) continue;
      const d = c.b.x - a.b.x, gap = S() * 0.75;
      if (Math.abs(d) >= gap || (a.bed && c.bed)) continue;
      const push = (gap - Math.abs(d)) * 0.08 * (d >= 0 ? 1 : -1);
      // Wer im Bett liegt, bleibt liegen; sonst rücken beide auseinander, auch im Schlaf
      if (!a.bed) { a.b.x -= push; a.b.adx -= push; }
      if (!c.bed) { c.b.x += push; c.b.adx += push; }
    }
  }
}

function draw(t) {
  const s = S();
  for (const p of pets.values()) {
    drawPet(p);
    const lift = p.perch && !p.walking && p.v.sleeping ? p.perch * U : 0;
    const step = p.walking ? (Math.floor(t / 120) % 2) * U : 0;
    p.el.style.width = p.el.style.height = s + 'px';
    p.el.style.transform = `translate(${px(p.b.x - s / 2)}, ${px(p.b.y - s - lift)})`;
    p.body.style.transform = `translateY(${-step}px)`;
    p.flip.style.transform = `scaleX(${p.facing})`;
    p.el.classList.toggle('walking', p.walking);
    p.el.classList.toggle('held', p.b.mode === 'held');
    p.el.classList.toggle('climb', p.b.mode === 'ladder');
    if (p.emoteUntil && t > p.emoteUntil) { p.emote.classList.remove('show'); p.emoteUntil = 0; }
  }
  for (const th of things.values()) drawThing(th);
  placeThings();
  placeSay();
}

function report() {
  whereAt = Date.now();
  const list = [...pets.values()].filter((p) => p.b.mode === 'stand').map((p) => ({ id: p.id, x: p.b.x / geo.W, y: (p.b.y - geo.top) / geo.h }));
  if (list.length) hook('where', list);
}

// ---------- Maus und Finger ----------
layer.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  if (e.target.closest('.pp-say')) return;
  const petEl = e.target.closest('.pp-pet');
  const toyEl = e.target.closest('.pp-thing.toy');
  if (!petEl && !toyEl) return;
  e.preventDefault();
  const obj = petEl ? pets.get(petEl.dataset.pet) : things.get(toyEl.dataset.thing);
  if (!obj) return;
  const b = obj.b;
  const grab = { obj, pet: !!petEl, dx: b.x - e.clientX, dy: b.y - e.clientY, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], moved: 0, x0: e.clientX, y0: e.clientY };
  const el = petEl || toyEl;
  el.setPointerCapture(e.pointerId);
  const move = (ev) => {
    grab.moved = Math.max(grab.moved, Math.hypot(ev.clientX - grab.x0, ev.clientY - grab.y0));
    if (grab.moved > 6 && b.mode !== 'held') {
      // Hochgehoben
      if (grab.pet && obj.ladder) obj.ladder = null;
      b.mode = 'held'; b.on = null;
      if (grab.pet) { obj.goal = null; emote(obj, '❗', 900); }
    }
    if (b.mode === 'held') {
      b.x = clamp(ev.clientX + grab.dx, 0, geo.W); b.y = clamp(ev.clientY + grab.dy, 0, geo.floor);
      grab.samples.push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp });
      while (grab.samples.length > 2 && ev.timeStamp - grab.samples[0].t > 90) grab.samples.shift();
      wake();
    }
  };
  const up = (ev) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    if (b.mode === 'held') {
      const v = throwVelocity(grab.samples);
      b.vx = v.vx; b.vy = v.vy; b.mode = 'air';
      if (grab.pet) { obj.thrown = Math.max(1, Math.hypot(v.vx, v.vy)); }
      else { obj.fresh = true; obj.resting = 0; obj.roll = v.vx * 0.5; }
      wake();
      return;
    }
    if (ev.type !== 'pointerup') return;
    // Angetippt: streicheln (Tier) oder anstupsen (Spielzeug)
    if (grab.pet) {
      const r = hook('act', obj.id, 'pet');
      if (r && r.ok) { emote(obj, '❤️', 1200); floaters(obj, r.delta, r.coins); hopUp(obj, 0.35); }
      else if (r && r.text) say(obj, esc(r.text), 2500);
    } else if (b.mode === 'stand') { b.mode = 'air'; b.on = null; b.vy = -420; b.vx = rand(-160, 160); obj.fresh = true; obj.resting = 0; wake(); }
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
});
layer.addEventListener('contextmenu', (e) => {
  const petEl = e.target.closest('.pp-pet');
  if (!petEl || !window.WinUI) return;
  e.preventDefault();
  const p = pets.get(petEl.dataset.pet);
  if (!p) return;
  window.WinUI.contextMenu(e.clientX, e.clientY, [
    { label: `Streicheln`, icon: '❤️', act: 'pet' },
    { label: 'Heimrufen', icon: '🏠', act: 'home' },
    '-', { label: 'Pixelpfoten öffnen', icon: '🐾', act: 'open' },
  ], (act) => {
    if (act === 'pet') { const r = hook('act', p.id, 'pet'); if (r && r.ok) { emote(p, '❤️'); floaters(p, r.delta, r.coins); } }
    if (act === 'home') call(p.id);
    if (act === 'open') openGame();
  });
});

// Möbel: antippen (Napf füllen) oder beim Einrichten ziehen
furnLayer.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pp-thing');
  if (!el || e.button > 0) return;
  const th = things.get(el.dataset.thing);
  if (!th) return;
  e.preventDefault();
  if (!game) { openGame(); return; }
  if (furnishing) {
    if (e.target.closest('.pp-x')) { hook('unplace', th.id); return; }
    furnishing.sel = th.id;
    const box = boxOf(th);
    const fd = furnishing.drag = { id: th.id, dx: e.clientX - (box.left + box.w / 2), dy: e.clientY - (box.top + box.h), x: th.x, y: th.y, moved: 0 };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      fd.moved++;
      th.x = clamp((ev.clientX - fd.dx) / geo.W, 0.02, 0.98);
      // Regale und Bilder hängen an der Wand und rasten alle 8 Punkte ein
      if (th.f.wall) th.y = clamp(Math.round((ev.clientY - fd.dy - geo.top) / 8) * 8 / geo.h, 0.05, 1);
      wake();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      furnishing.drag = null;
      if (!fd.moved) return;
      const r = hook('moved', th.id, +th.x.toFixed(3), +(th.f.wall ? th.y : 1).toFixed(3));
      if (r && !r.ok) { th.x = fd.x; th.y = fd.y; }
      wake();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return;
  }
  if (th.f.bowl) {
    const r = hook('fill', th.f.bowl);
    const p = [...pets.values()][0];
    if (r && p) say(p, esc(r.ok ? r.text : r.reason), 3000);
    return;
  }
  // Deko: das nächste Tier schaut hin
  const p = [...pets.values()].filter((o) => !o.v.sleeping).sort((a, c) => Math.abs(a.b.x - th.x * geo.W) - Math.abs(c.b.x - th.x * geo.W))[0];
  if (p) { p.facing = th.x * geo.W > p.b.x ? 1 : -1; emote(p, '✨', 900); }
});

// Was Nutzer tun (auch in den Fenstern): Streiche nur, wenn eine Weile niemand etwas macht; Mauszeiger zum Jagen
const seenWins = new WeakSet();
function busy(e, off) {
  activeAt = Date.now();
  if (e.type === 'pointermove' && e.pointerType === 'mouse') pointer = { x: e.clientX + (off ? off.left : 0), y: e.clientY + (off ? off.top : 0), t: Date.now() };
}
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) doc.addEventListener(ev, (e) => busy(e, null), { capture: true, passive: true });
setInterval(() => {
  for (const w of R && R.windows ? R.windows() : []) {
    try {
      const cw = w.win;
      if (!cw || seenWins.has(cw.document)) continue;
      seenWins.add(cw.document);
      for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) cw.document.addEventListener(ev, (e) => busy(e, w.iframe.getBoundingClientRect()), { capture: true, passive: true });
    } catch { /* fremde Seite */ }
  }
}, 3000);
addEventListener('resize', () => { measure(); placeThings(); wake(); });
doc.addEventListener('visibilitychange', () => { if (!doc.hidden) wake(); });

// ---------- 🐾 in der Taskleiste ----------
let trayBtn = null;
function trayUpdate() {
  const tray = doc.querySelector('.taskbar .tray');
  const show = !!game && pets.size > 0;
  if (!show) { if (trayBtn) { trayBtn.remove(); trayBtn = null; } return; }
  if (!trayBtn && tray) {
    trayBtn = make('button', 'tray-btn pp-tray', '🐾<span class="pp-count"></span>');
    trayBtn.type = 'button';
    trayBtn.setAttribute('aria-label', 'Pixelpfoten draußen');
    tray.insertBefore(trayBtn, doc.getElementById('clock'));
    trayBtn.addEventListener('click', (e) => { e.stopPropagation(); trayMenu(); });
  }
  if (!trayBtn) return;
  trayBtn.querySelector('.pp-count').textContent = pets.size;
  trayBtn.title = `Pixelpfoten: ${[...pets.values()].map((p) => p.v.name).join(', ')} draußen`;
}
function trayMenu() {
  if (!window.WinUI || !trayBtn) return;
  const r = trayBtn.getBoundingClientRect();
  const list = [...pets.values()];
  const items = list.map((p) => ({ label: `${p.v.name} heimrufen`, icon: SPECIES[p.v.species] ? SPECIES[p.v.species].icon : '🐾', act: 'call:' + p.id }));
  if (list.length > 1) items.push({ label: 'Alle heimrufen', icon: '🏠', act: 'all' });
  items.push('-', { label: 'Pixelpfoten öffnen', icon: '🐾', act: 'open' }, { label: 'Desktop einrichten …', icon: '🛋️', act: 'furnish' }, { label: 'Optionen …', icon: '⚙️', act: 'options' });
  window.WinUI.contextMenu(r.left, r.top - 8 - (items.length * 24), items, (act) => {
    if (act.startsWith('call:')) call(act.slice(5));
    else if (act === 'all') callAll();
    else if (act === 'open') openGame();
    else if (act === 'furnish') { openGame(); hook('furnish'); }
    else if (act === 'options') { openGame(); hook('options'); }
  });
}
function openGame() {
  if (game) R.focusWin(game.win); else R.open('/haustier/', false);
}

// ---------- Schnittstelle fürs Spiel ----------
let homing = null;
function attach(win, hooks) {
  if (game && game.win !== win) return { ok: false, reason: 'Pixelpfoten ist schon in einem anderen Fenster draußen.' };
  const other = readJSON(KEYS.deskTab);
  if (other && other.tab !== TAB && Date.now() - other.at < 15000) return { ok: false, reason: 'Deine Tiere sind gerade in einem anderen Tab auf dem Desktop.' };
  game = { win, hooks };
  opts = deskOptions(readJSON(KEYS.deskOpts));
  const heart = () => local.set(KEYS.deskTab, JSON.stringify({ tab: TAB, at: Date.now() }));
  heart();
  clearInterval(beat);
  beat = setInterval(heart, 5000);
  for (const th of things.values()) th.sig = '';
  measure();
  wake();
  return { ok: true };
}
function detach(win) {
  if (!game || (win && game.win !== win)) return;
  report();
  game = null;
  clearInterval(beat);
  local.remove(KEYS.deskTab);
  for (const p of [...pets.values()]) removePet(p);
  for (const th of things.values()) th.sig = '';
  trayUpdate();
  placeLadders();
  furnish(false);
  wake();
}
function out(v, at = {}) {
  measure();
  if (at.u) U = clamp(Math.round(at.u), 1, 4);
  placeLadders();
  const p = pets.get(v.id) || makePet(v);
  p.v = v; p.home = false; p.outAt = Date.now(); p.goal = null;
  const lp = ladderPos[at.side];
  if (lp) {
    p.b.x = lp.x; p.b.y = lp.top; p.b.mode = 'ladder'; p.ladder = { side: at.side, dir: 1 };
    p.facing = at.side === 'l' ? -1 : 1;
  } else {
    // Aus dem Knopf in der Taskleiste (oder ohne Tor): hüpft heraus
    const gw = gameWin();
    const r = gw ? (at.side === 'task' || gw.min ? gw.task : gw.el).getBoundingClientRect() : { left: geo.W / 2, width: 0 };
    p.b.x = clamp(r.left + r.width / 2, S() / 2, geo.W - S() / 2); p.b.y = geo.floor;
    p.b.mode = 'air'; p.b.vy = -620 * (U / 2); p.b.vx = rand(-120, 120);
  }
  sound('stimme:' + v.species);
  trayUpdate();
  wake();
}
function restore(v, at = {}) {
  measure();
  const p = pets.get(v.id) || makePet(v);
  p.v = v;
  p.b.x = clamp((Number(at.x) || 0.5) * geo.W, S() / 2, geo.W - S() / 2);
  p.b.y = clamp(geo.top + (Number(at.y) || 1) * geo.h, geo.top + S(), geo.floor) - 2;
  p.b.mode = 'air'; p.b.vy = 0;
  trayUpdate();
  wake();
}
function update({ pets: list = [], items = [], bowls: bw = null } = {}) {
  if (bw) bowls = { food: bw.food || 0, water: bw.water || 0 };
  for (const v of list) { const p = pets.get(v.id); if (p) p.v = v; }
  for (const p of [...pets.values()]) if (!list.some((v) => v.id === p.id)) removePet(p);
  measure();
  syncThings(items);
  trayUpdate();
  wake();
}
function call(id) {
  const p = pets.get(id);
  if (!p) return;
  p.home = true; p.goal = null; p.until = 0; p.busyUntil = 0;
  emote(p, '❗', 900);
  wake();
}
function callAll() { for (const id of pets.keys()) call(id); }
function furnish(on, sel = null) {
  furnishing = on ? { sel, drag: null } : null;
  furnLayer.classList.toggle('furnish', !!on);
  banner(on);
  for (const th of things.values()) th.sig = '';
  wake();
}
// Hinweis beim Einrichten des Desktops, mit „Fertig“
let bannerEl = null;
function banner(on) {
  if (!on) { if (bannerEl) { bannerEl.remove(); bannerEl = null; } return; }
  if (bannerEl) return;
  bannerEl = make('div', 'window pp-banner', '<div class="body">🛋️ <b>Desktop einrichten:</b> Zieh die Sachen an ihren Platz, × legt sie zurück ins Fach. <button type="button" class="small">Fertig</button></div>');
  bannerEl.querySelector('button').addEventListener('click', () => hook('stopFurnish'));
  layer.append(bannerEl);
}

// Das Spiel-Fenster schließt: Alle Tiere laufen heim, dann geht es zu (retro.js wartet höchstens 4 Sekunden)
if (R && R.onClose) {
  R.onClose((win) => {
    if (!game || win !== game.win || !pets.size) return null;
    return new Promise((resolve) => {
      homing = resolve;
      callAll();
      setTimeout(() => {
        for (const p of [...pets.values()]) backHome(p, 'l');
        if (homing) { homing(); homing = null; }
      }, 3500);
    });
  });
}

window.RetroPets.api = {
  attach, detach, out, restore, update, call, callAll, furnish,
  options(o) { opts = deskOptions(o); },
  minimized() { const gw = gameWin(); return !!gw && gw.min; },
};
showCopy();
