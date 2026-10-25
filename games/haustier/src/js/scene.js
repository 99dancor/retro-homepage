// Das Zimmer als lebendige Szene: Alle Tiere laufen frei herum, beschäftigen sich miteinander und spielen
// mit dem Spielzeug, das man herausholt. Nur im Browser; die Entscheidungen stehen in behavior.js.
//
//   const scene = createScene(hooks)
//   scene.mount(roomElement)   Szene ins (neu gezeichnete) Zimmer hängen
//   scene.sync()               Tiere mit dem Spielstand abgleichen (neue Tiere, Laune, Accessoires)
//   scene.useToy(id) / putAway()
//   scene.animate(petId, action, extra)   Pflege sichtbar machen (Napf, Herzchen, Gassi …)
//   scene.floaters(petId, list)            aufsteigende Zahlen über einem Tier: [[html, minus, cls]]
//   scene.speak(key, html, ms) / hush()    Sprechblase über einem Tier (ms = 0: bleibt, bis hush)
//   scene.snapshot()                       Stand der eigenen Tiere und des Spielzeugs fürs Live-Zimmer
//   scene.enter(key, side)                 ein Tier kommt durchs Tor ('l' | 'r') vom Desktop zurück
//   scene.furnish(on, sel)                 Einrichten: Teile verschieben, × legt sie ins Fach (sel: gerade aufgestellt)
//   scene.gateInfo()                       Lage der Tore im Fenster (für die Strickleiter auf dem Desktop)
//   scene.mess(key, plan) -> bool          ein Tier macht im Zimmer ein Geschäft oder eine Spur (plan aus mess.js planMess)
//   scene.shot()                           Schnappschuss fürs Fotoalbum (Format wie auf dem Desktop, siehe photo.js)
//
// hooks:
//   roster()   alle Tiere im Zimmer: [{ key, pet, kind, owner?, net? }]
//              kind: own (eigenes Tier, läuft hier), foreign (fremdes Tier, läuft hier), remote (läuft bei seinem Besitzer)
//              net:  letzter Live-Stand eines remote-Tieres { x, d, facing, walking, hop, emote, seq, hidden }
//   active()   key des ausgewählten Tieres     bed(): Körbchen zeigen?     remoteToys(): [{ key, id, x, y, d, spin }]
//   chest()    Spielzeugkiste zeigen?           openChest(rect): Kiste angetippt
//   thought(entry) -> Wert, an den das Tier gerade denkt (Gedankenblase), oder null;  need(entry, key): Blase angetippt
//   select(entry), stroke(entry), menu(entry, x, y), play(entry, itemId) -> { ok, factor, fav }, sound(name)
//   props()    aufgestellte Einrichtung im Zimmer: [{ id, x, y, level?, open?, title? }] (Lage wie state.place)
//   tapProp(id, rect)       Teil angetippt (Kiste, Napf …)      placed(id, x, y) / unplace(id): beim Einrichten
//   bowlWant(entry) -> 'food' | 'water' | null: will an den Napf     eat(entry, kind): frisst oder trinkt dort
//   gates() -> { on, l, r }  Tore (0 zu, 1 halb, 2 offen)           gateSet(side, v): am Griff gezogen
//   mayLeave(entry)          darf raus      leave(entry, side, at): ist durchs Tor (at: Fußpunkt im Fenster in px)
//   marks() -> [{ id, kind, x, y }]  Flecken im Zimmer (y: Tiefe)      clean(id): weggewischt
//   messed(entry, kind, at, to)      Geschäft gemacht: at { x, y } im Zimmer oder to (Möbel, das es abgefangen hat)
//   social(entry, kind)              gerauft, gekuschelt, getanzt ('romp' | 'snuggle' | 'dance') -> { ok, delta }
//   music() -> { playing(), level() } | null   Musik im Mediaplayer (zum Tanzen)      first(kind): zum ersten Mal
//
// Alles ist Pixel-Art: Tiere 48 × 48, Spielzeug 16 × 16, immer im selben ganzzahligen Maßstab und nie gedreht.
import { SPECIES, mood } from './pets.js';
import { petSvg } from './art.js';
import { iconSvg, ICON_OF } from './icons.js';
import { TOYS, decide, besides, stepTowards, canCatch, wantsToPlay, speed, assignBeds, social } from './behavior.js';
import { FURN, furnSvg, bowlSprite } from './furniture.js';
import { MESS, messSvg, messSize, messPose, messMs } from './mess.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const html = (tag, cls, inner = '') => { const el = document.createElement(tag); el.className = cls; el.innerHTML = inner; return el; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Wie lange ein Tier nach einem gefangenen Spielzeug wartet, bevor es wieder zählt
const PLAY_GAP = 2500;
const BORED_MS = 25000;
const MIN_GAP = 0.17;          // so weit (in Zimmerbreiten) halten Tiere Abstand voneinander
const GATE_D = 0.32;           // Tiefe, auf der die Tore im Fensterrand sitzen
const SMALL = ['hamster', 'rat', 'axolotl'];   // passen auch durchs halb offene Tor
// Spielzeug, das im Zimmer steht: Bild und Größe in Bildpunkten
const STATION = { toy_wheel: ['wheel0', 36, 40], toy_tunnel: ['tunnel', 44, 26], toy_rope: ['rope', 12, 56] };
// Gefühle als kleine Pixelbilder (alles andere bleibt Zeichen)
const EMOTE = {
  '❤️': 'heart', '💕': 'heart', '💞': 'heart', '😍': 'heart', '💤': 'zzz', '😴': 'zzz', '♪': 'note', '😊': 'note', '👋': 'note',
  '✨': 'sparkle', '❗': 'bang', '🎁': 'gift', '🐾': 'paw', '😄': 'star', '🎉': 'star', '☀️': 'star', '🫧': 'drop',
};
const emoteHtml = (s) => (EMOTE[s] ? iconSvg(EMOTE[s]) : `<b>${esc(s)}</b>`);
const DANCE = ['stretch', 'walk1', 'crouch', 'walk2'];   // Tanzschritte, einer pro Schlag
const WIPE = 60;                                        // so weit (px) reibt man über einen Fleck, bis er weg ist

export function createScene(hooks) {
  const layer = html('div', 'scene');
  const actors = new Map();        // key -> Darsteller (key = Tier-id bei eigenen Tieren)
  const ghosts = new Map();        // Spielzeug anderer im Live-Zimmer
  let host = null, raf = 0, last = 0;
  let geo = { W: 400, H: 300, top: 200, near: 280, far: 214, u: 2 };
  let toy = null;                  // herausgeholtes Spielzeug
  let lure = null;                 // Zeiger für Federangel, Laser und Knabberstab: { x, y } in px
  const bubbles = [];
  const props = new Map();         // aufgestellte Einrichtung: id -> { id, f, el, x, y, level, user }
  const entering = new Map();      // Tiere, die gleich durchs Tor zurückkommen: key -> Seite
  let furnishing = null;           // Einrichten: { sel, drag }
  let gates = { on: false, l: 0, r: 0 };
  const gateEls = {};
  let gateDrag = null;             // Griff eines Tores: { side, y0, v0 }
  let speech = null;               // Sprechblase: { key, el, until }
  let drag = null;                 // gehaltenes Wurfspielzeug: { id, samples }
  let stroke = null;               // Streicheln: { id, x, y, dist, moved, timer }
  let slow = 0;                    // Takt beim Stromsparen (setTimeout statt requestAnimationFrame)
  let ptr = { x: 0, y: 0, t: 0 };  // Mauszeiger im Zimmer (die Augen folgen ihm)
  const marks = new Map();         // Flecken: id -> { m, el }
  let rub = null;                  // Wegwischen: { id, x, y, dist }
  const groove = { on: 0, next: 0, beatAt: 0, avg: 0, m: null, checkAt: 0 };
  const romps = [];                // Staubwolken { el, x, d, until }

  // ---------- Geometrie ----------
  // Der Zimmerhintergrund ist 400 × 300 groß, unten ausgerichtet und füllt die Fläche (slice); der Boden beginnt bei 186.
  // u: Größe eines Bildpunkts in px, ganzzahlig, damit die Pixel scharf bleiben
  function measure() {
    const W = layer.clientWidth || 400, H = layer.clientHeight || 300;
    const k = Math.max(W / 400, H / 300);
    const top = H - 114 * k;
    const u = clamp(Math.round(Math.min(W * 0.24, H * 0.32) / 48), 1, 5);
    geo = { W, H, top, far: top + 16, near: H - 24, u };
  }
  const feetY = (d) => geo.far + d * (geo.near - geo.far);
  const depthAt = (y) => clamp((y - geo.far) / (geo.near - geo.far), 0, 1);
  const sizeOf = () => 48 * geo.u;
  const toyPx = () => 16 * geo.u;
  const toyR = () => 7 * geo.u;
  const z = (d, add = 10) => String(add + Math.round(d * 100));
  const px = (v) => Math.round(v) + 'px';

  // ---------- Tiere ----------
  const petOf = (key) => { const a = actors.get(key); return a ? a.entry.pet : null; };
  const local = (a) => a.entry.kind !== 'remote';

  function makeActor(entry, i, n) {
    const el = html('div', 'sp');
    el.dataset.pet = entry.key;
    const shadow = html('div', 'sp-shadow');
    const body = html('div', 'sp-body');
    const flip = html('div', 'sp-flip');
    body.append(flip);
    const emote = html('div', 'sp-emote');
    const name = html('div', 'sp-name');
    el.append(shadow, body, emote, name);
    layer.append(el);
    const net = entry.net;
    return {
      id: entry.key, entry, el, body, flip, shadow, emote, name, think: null, thinkKey: null, seq: 0, lastEmote: '', netSeq: net ? net.seq : 0,
      x: net ? net.x : n === 1 ? 0.5 : 0.22 + (0.56 * i) / Math.max(1, n - 1), d: net ? net.d : 0.55 + (i % 2) * 0.25,
      facing: 1, hop: 0, hopV: 0, walking: false, plan: null, until: 0, key: '',
      face: null, busyUntil: 0, nextPlay: 0, bored: {}, carry: false, hidden: false, moodFace: 'ok', pose: null, poseUntil: 0, dance: null, snug: 0,
      emoteUntil: 0, tiltUntil: 0, blink: rand(0, 4).toFixed(2),
      bed: null, spot: null, perch: 0, tucked: false,   // Schlafplatz: id des Betts, Ziel, Höhe darauf, im Haus versteckt
    };
  }

  function sync() {
    const list = hooks.roster();
    for (const [key, a] of actors) {
      if (!list.some((e) => e.key === key)) {
        a.el.remove(); actors.delete(key);
        if (toy && toy.user === key) toy.user = null;
        if (speech && speech.key === key) hush();
      }
    }
    list.forEach((e, i) => {
      const a = actors.get(e.key);
      if (a) a.entry = e;
      else {
        const n = makeActor(e, i, list.length);
        actors.set(e.key, n);
        const side = entering.get(e.key);
        if (side) {
          // Kommt vom Desktop: steht im Tor und läuft ein Stück herein
          entering.delete(e.key);
          n.x = side === 'l' ? -0.06 : 1.06; n.d = GATE_D; n.facing = side === 'l' ? 1 : -1;
          n.plan = { type: 'wander', x: side === 'l' ? rand(0.15, 0.35) : rand(0.65, 0.85), d: rand(0.3, 0.7) }; n.until = performance.now() + 6000;
        }
      }
    });
    const active = hooks.active();
    const mine = list.filter((e) => e.kind === 'own').length;
    for (const a of actors.values()) {
      const p = a.entry.pet;
      // Live-Tiere zeigen das Gesicht, das ihr Besitzer sieht
      a.moodFace = a.entry.kind === 'remote' && a.entry.net ? (a.entry.net.face || 'ok') : mood(p).face;
      const face = a.face || a.moodFace;
      paint(a, performance.now());
      a.name.textContent = a.entry.owner ? `${p.name} · ${a.entry.owner}` : p.name;
      a.el.classList.toggle('active', a.id === active && (mine > 1 || list.length > mine));
      a.el.classList.toggle('happy', face === 'happy');
      a.el.classList.toggle('guest', a.entry.kind !== 'own');
      drawThought(a, hooks.thought ? hooks.thought(a.entry) : null);
    }
    drawProps();
    drawGates();
    drawMarks();
  }

  // Bild eines Tieres in seiner Stellung (pixel.js POSES); neu gezeichnet wird nur, wenn sich etwas ändert
  function poseOf(a, now) {
    if (!local(a)) return 'stand';
    if (now < a.poseUntil && a.pose) return a.pose;
    if (a.el.classList.contains('eating')) return 'eat';
    if (a.hopV > 0) return 'stretch';
    return 'stand';
  }
  function paint(a, now) {
    const p = a.entry.pet, face = a.face || a.moodFace, pose = poseOf(a, now), shine = a.shine > Date.now();
    const key = [p.species, p.color, face, pose, JSON.stringify(p.acc), shine].join('|');
    if (key === a.key) return;
    a.key = key;
    a.flip.innerHTML = petSvg(p.species, p.color, face, { title: `${p.name}, ${SPECIES[p.species].name}`, acc: p.acc, shine, shadow: false, pose, walk: pose === 'stand' });
    a.flip.firstChild.style.setProperty('--blink', a.blink + 's');
  }
  function posing(a, pose, ms, face = null) {
    a.pose = pose; a.poseUntil = performance.now() + ms;
    if (face) { a.face = face; clearTimeout(a.faceTimer); a.faceTimer = setTimeout(() => { a.face = null; }, ms); }
  }
  // Augen zum Mauszeiger (im Bild gespiegelt, wenn das Tier nach links schaut)
  function gaze(a, now) {
    if (a.entry.pet.sleeping || now - ptr.t > 4000) return '';
    const dx = ptr.x - a.x * geo.W;
    if (Math.abs(dx) < sizeOf() * 0.4) return '';
    return dx * a.facing > 0 ? 'r' : 'l';
  }

  // ---------- Flecken: Pfützen, Häufchen und Spuren (mess.js) ----------
  function drawMarks() {
    const list = hooks.marks ? hooks.marks() : [];
    for (const [id, k] of marks) if (!list.some((m) => m.id === id)) { k.el.remove(); marks.delete(id); }
    for (const m of list) {
      if (marks.has(m.id)) { marks.get(m.id).m = m; continue; }
      const el = html('div', 'sc-mark', messSvg(m.kind));
      el.dataset.mark = m.id;
      el.title = `${MESS[m.kind].name}: mit der Maus wegwischen`;
      layer.prepend(el);
      marks.set(m.id, { m, el });
    }
  }
  function placeMarks() {
    const u = geo.u;
    for (const { m, el } of marks.values()) {
      const sz = messSize(m.kind), w = sz.w * u, h = sz.h * u;
      el.style.width = w + 'px'; el.style.height = h + 'px';
      el.style.transform = `translate(${px(clamp((m.x ?? 0.5) * geo.W - w / 2, 0, geo.W - w))}, ${px(feetY(m.y ?? 0.7) - h + (m.kind === 'pee' ? 2 : 1) * u)})`;
      el.style.zIndex = 7;
    }
  }
  function wiped(id) {
    const k = marks.get(id);
    if (!k) return;
    const r = k.el.getBoundingClientRect(), lr = layer.getBoundingClientRect();
    const sp = html('div', 'sc-sparkle', messSvg('sparkle')), s = 14 * geo.u;
    sp.style.width = sp.style.height = s + 'px';
    sp.style.transform = `translate(${px(r.left - lr.left + r.width / 2 - s / 2)}, ${px(r.top - lr.top + r.height / 2 - s / 2)})`;
    layer.append(sp);
    setTimeout(() => sp.remove(), 700);
    k.el.remove(); marks.delete(id);
    if (hooks.clean) hooks.clean(id);
  }
  // Ein Tier macht sein Geschäft oder seine Spur: zur Streukiste (zum Kratzbaum, Kauholz) oder gleich hier
  function mess(key, plan) {
    const a = actors.get(key);
    if (!a || !local(a) || a.entry.pet.sleeping || a.hidden || a.dance || (a.plan && ['out', 'bowl', 'prop', 'mess'].includes(a.plan.type))) return false;
    const b = plan.to && props.get(plan.to);
    a.plan = b ? { type: 'mess', plan, x: b.x, d: Math.min(1, b.y + 0.02) }
      : { type: 'mess', plan: { ...plan, to: null }, x: clamp(a.x + rand(-0.1, 0.1), 0.08, 0.92), d: clamp(a.d + rand(-0.1, 0.1), 0, 1) };
    a.until = performance.now() + 15000;
    return true;
  }
  function doMess(a, plan, now) {
    const ms = messMs(plan.kind);
    posing(a, messPose(plan.kind, a.entry.pet.species), ms);
    if (plan.kind === 'scratch' || plan.kind === 'dig') flash(a, 'running', ms);
    a.busyUntil = now + ms; a.walking = false;
    a.plan = { type: 'wander', x: clamp(a.x + (Math.random() < 0.5 ? -0.12 : 0.12), 0.08, 0.92), d: a.d }; a.until = now + ms + 4000;
    setTimeout(() => { if (actors.get(a.id) === a && hooks.messed) hooks.messed(a.entry, plan.kind, plan.to ? null : { x: +a.x.toFixed(3), y: +a.d.toFixed(3) }, plan.to); }, ms);
  }

  // ---------- Miteinander: raufen, kuscheln, tanzen ----------
  const reward = (a, kind) => {
    const r = hooks.social && a.entry.kind === 'own' ? hooks.social(a.entry, kind) : null;
    if (r && r.ok && r.delta) floaters(a.id, Object.entries(r.delta).filter(([, v]) => v).map(([k, v]) => [`${iconSvg(ICON_OF[k] || k)}+${v}`, false]));
  };
  function romp(a, o, now) {
    const ms = reduced() ? 1200 : 2600;
    const el = html('div', 'sc-cloud', messSvg('fight0') + messSvg('fight1'));
    layer.append(el);
    const r = { el, x: (a.x + o.x) / 2, d: Math.max(a.d, o.d), until: now + ms };
    romps.push(r);
    for (const x of [a, o]) { x.hidden = true; x.el.style.opacity = '0'; x.busyUntil = now + ms; x.plan = { type: 'sit' }; x.until = now + ms + 1500; }
    hooks.sound('stimme:' + a.entry.pet.species);
    setTimeout(() => {
      el.remove(); romps.splice(romps.indexOf(r), 1);
      [[a, -1], [o, 1]].forEach(([x, dir]) => {
        x.hidden = false; x.el.style.opacity = '';
        x.x = clamp(r.x + dir * 0.09, 0.06, 0.94); x.facing = -dir;
        hop(x, 0.6); say(x, pick(['✨', '😄', '❗']), 1200);
        reward(x, 'romp');
      });
      if (hooks.first) hooks.first('romp');
    }, ms);
  }
  function snuggle(a, o, now) {
    const ms = 4500;
    a.facing = o.x > a.x ? 1 : -1; o.facing = -a.facing;
    o.d = a.d;
    for (const x of [a, o]) { posing(x, 'lean', ms, 'happy'); x.busyUntil = now + ms; x.snug = now + ms; x.plan = { type: 'sit' }; x.until = now + ms + 800; say(x, '💞', 1800); }
    if (hooks.first) hooks.first('snuggle');
    setTimeout(() => { for (const x of [a, o]) if (actors.get(x.id) === x) { reward(x, 'snuggle'); say(x, '❤️', 1200); } }, ms);
  }
  // Läuft im Mediaplayer Musik, tanzen die Tiere ab und zu (der erste Tanz nach 20 bis 90 Sekunden, dann alle 10 bis 20 Minuten)
  function stepMusic(now) {
    if (now > groove.checkAt) { groove.checkAt = now + 1000; groove.m = hooks.music && !reduced() && !furnishing ? hooks.music() : null; }
    const m = groove.m;
    const dancers = [...actors.values()].filter((a) => a.dance);
    if (!m) { if (groove.on) { groove.on = 0; for (const a of dancers) endDance(a, true); } return; }
    if (!groove.on) { groove.on = now; groove.next = now + rand(20e3, 90e3); }
    if (!dancers.length) {
      if (now < groove.next) return;
      const list = [...actors.values()].filter((a) => a.entry.kind === 'own' && !a.entry.pet.sleeping && !a.hidden && now > a.busyUntil && (!a.plan || ['sit', 'wander', 'look'].includes(a.plan.type)));
      if (!list.length) { groove.next = now + 30e3; return; }
      const lead = pick(list);
      for (const a of list) if (a === lead || Math.random() < 0.4) { a.dance = { until: now + rand(20e3, 40e3), n: 0 }; a.plan = null; a.walking = false; say(a, '♪', 1400); }
      if (hooks.first) hooks.first('dance');
      return;
    }
    let lvl = null;
    try { lvl = m.level(); } catch { /* weg */ }
    let hit;
    if (lvl === null || lvl === undefined) hit = now - groove.beatAt > 600;
    else { groove.avg = groove.avg * 0.94 + lvl * 0.06; hit = (lvl > groove.avg * 1.15 && lvl > 0.18 && now - groove.beatAt > 320) || now - groove.beatAt > 900; }
    if (hit) {
      groove.beatAt = now;
      for (const a of dancers) {
        const n = ++a.dance.n;
        a.pose = DANCE[n % DANCE.length]; a.poseUntil = now + 900;
        if (n % 4 === 0) a.facing = -a.facing;
        if (n % 2) hop(a, 0.25);
        if (n % 8 === 0) say(a, '♪', 1200);
      }
    }
    let left = 0;
    for (const a of dancers) { if (now > a.dance.until || a.entry.pet.sleeping) endDance(a, false); else left++; }
    if (!left) groove.next = now + rand(10, 20) * 60e3;
  }
  function endDance(a, stopped) {
    a.dance = null;
    if (stopped) { posing(a, 'bow', 1300); a.busyUntil = performance.now() + 1300; } else say(a, '✨', 1200);
    reward(a, 'dance');
  }

  // Schnappschuss: Tiere, Möbel und Flecken in Bildpunkten (Boden bei floor)
  function shot() {
    if (!layer.isConnected) return null;
    const u = geo.u, k = (v) => Math.round(v / u);
    const list = [...actors.values()].filter((a) => !a.hidden && !a.tucked);
    if (!list.length) return null;
    const now = performance.now();
    return {
      w: k(geo.W), h: k(geo.H), floor: k(geo.top), depth: true,
      pets: list.sort((a, b) => a.d - b.d).map((a) => ({
        name: a.entry.pet.name, species: a.entry.pet.species, color: a.entry.pet.color, acc: a.entry.pet.acc || {}, face: a.face || a.moodFace,
        pose: poseOf(a, now), facing: a.facing, x: k(a.x * geo.W), y: k(feetY(a.d) - a.hop),
      })),
      things: [...props.values()].sort((a, b) => propBox(a).z - propBox(b).z).map((p) => { const b = propBox(p); return { id: p.f.bowl ? bowlSprite(p.f.bowl, p.level) : p.id, x: k(b.left), y: k(b.top) }; }),
      marks: [...marks.values()].map(({ m }) => ({ kind: m.kind, x: k((m.x ?? 0.5) * geo.W), y: k(feetY(m.y ?? 0.7)) })),
    };
  }

  // Gedankenblase über dem Kopf: woran das Tier gerade denkt (zum Antippen)
  function drawThought(a, need) {
    if (need === a.thinkKey) return;
    a.thinkKey = need;
    if (a.think) { a.think.remove(); a.think = null; }
    if (!need) return;
    a.think = html('div', 'sp-think', iconSvg('think') + iconSvg(ICON_OF[need] || need));
    a.think.title = `${a.entry.pet.name} denkt an: ${{ love: 'Streicheleinheiten', fun: 'Spielen', food: 'Futter', water: 'Wasser', rest: 'Schlaf' }[need] || need}`;
    a.el.append(a.think);
  }

  // ---------- Einrichtung ----------
  function drawProps() {
    const list = hooks.props ? hooks.props() : [];
    for (const [id, p] of props) {
      if (list.some((q) => q.id === id)) continue;
      p.el.remove(); props.delete(id);
      for (const a of actors.values()) if (a.bed === id) { a.bed = null; a.spot = null; }
    }
    for (const q of list) {
      const f = FURN[q.id];
      if (!f || f.desk) continue;
      let p = props.get(q.id);
      if (!p) {
        p = { id: q.id, f, el: html('div', 'sc-prop'), sig: '', user: null };
        p.el.dataset.prop = q.id;
        layer.prepend(p.el);
        props.set(q.id, p);
      }
      if (!(furnishing && furnishing.drag && furnishing.drag.id === q.id)) { p.x = q.x; p.y = q.y; }
      p.level = q.level;
      const sprite = f.bowl ? bowlSprite(f.bowl, q.level) : q.id === 'furn_chest' && q.open ? 'furn_chest_open' : q.id;
      const sig = sprite + '|' + !!furnishing;
      if (p.sig !== sig) {
        p.sig = sig;
        p.el.innerHTML = (q.id === 'toy_wheel' ? furnSvg('toy_wheel', 'pxi w0') + furnSvg('toy_wheel_1', 'pxi w1') : furnSvg(sprite))
          + (furnishing && !f.chest ? '<button type="button" class="sc-x" title="Ins Fach legen" aria-label="Ins Fach legen">×</button>' : '');
      }
      p.el.title = furnishing ? 'Ziehen zum Verschieben' : q.title || '';
      p.el.classList.toggle('wall', !!f.wall);
      p.el.classList.toggle('flat', !!f.flat);
      p.el.classList.toggle('use', !!(f.chest || f.bowl || f.station));
      p.el.classList.toggle('sel', !!furnishing && furnishing.sel === q.id);
    }
  }

  // Lage eines Teils in px: links, oben, Breite, Höhe, Ebene
  function propBox(p) {
    const u = geo.u, w = p.f.w * u, h = p.f.h * u;
    const left = clamp(p.x * geo.W - w / 2, 0, Math.max(0, geo.W - w));
    if (p.f.wall) {
      const bottom = clamp(p.y * geo.top, h + 2 * u, geo.top - u);
      return { left, top: bottom - h, w, h, z: 4 };
    }
    const fy = feetY(p.y);
    return { left, top: p.f.flat ? fy - h / 2 : fy - h + 2 * u, w, h, z: p.f.flat ? 6 : 9 + Math.round(p.y * 100) };
  }

  // Schlafplätze: Betten, Kissen und (für manche Arten) Karton und Hamsterhaus
  function spots() {
    const out = [];
    for (const p of props.values()) {
      if (!p.f.sleep) continue;
      out.push({ id: p.id, x: p.x, d: Math.min(1, p.y + 0.01), sleep: p.f.sleep, hide: !!p.f.hide, lift: p.f.seat ? p.f.h - p.f.seat - 2 : 0 });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  function assignSleep() {
    const sleepers = [...actors.values()].filter((o) => local(o) && o.entry.pet.sleeping && o.plan?.type !== 'out')
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((o) => ({ key: o.id, species: o.entry.pet.species, bed: o.bed }));
    const got = assignBeds(sleepers, spots(), MIN_GAP);
    for (const a of actors.values()) {
      const spot = got.get(a.id);
      if (spot === undefined) { if (a.bed || a.tucked) wakeUp(a); continue; }
      if (spot && spot.id !== a.bed) { a.perch = 0; untuck(a); }
      a.bed = spot ? spot.id : null;
      a.spot = spot;
    }
  }
  function untuck(a) { if (a.tucked) { a.tucked = false; a.el.style.opacity = ''; } }
  function wakeUp(a) { a.bed = null; a.spot = null; a.perch = 0; untuck(a); }

  // ---------- Tore im Fensterrand ----------
  function drawGates() {
    gates = hooks.gates ? hooks.gates() : { on: false, l: 0, r: 0 };
    for (const side of ['l', 'r']) {
      let el = gateEls[side];
      if (!gates.on) { if (el) { el.remove(); delete gateEls[side]; } continue; }
      if (!el) {
        el = gateEls[side] = html('div', 'sc-gate ' + side, '<i class="hole"></i><i class="shutter"><b class="grip" title="Ziehen: Tor auf oder zu"></b></i><i class="roll"></i>');
        el.dataset.gate = side;
        layer.append(el);
      }
      el.dataset.v = gates[side];
      el.title = ['Tor zu', 'Tor halb offen: nur kleine Tiere passen durch', 'Tor offen'][gates[side]];
    }
  }
  const gateOpenFor = (p, side) => gates.on && (gates[side] === 2 || (gates[side] === 1 && SMALL.includes(p.species)));
  function placeGates() {
    const u = geo.u, h = 58 * u, w = 7 * u, bottom = feetY(GATE_D) + 2 * u;
    for (const side of ['l', 'r']) {
      const el = gateEls[side];
      if (!el) continue;
      const v = gateDrag && gateDrag.side === side ? gateDrag.v : gates[side];
      el.style.width = w + 'px'; el.style.height = h + 'px';
      el.style.transform = `translate(${px(side === 'l' ? 0 : geo.W - w)}, ${px(bottom - h)})`;
      el.style.setProperty('--u', u + 'px');
      el.style.setProperty('--shut', px((1 - v / 2) * (h - 6 * u) + 2 * u));
    }
  }
  // Wo die Tore im Fenster sitzen (Fußpunkt der Schwelle), für Strickleiter und Übergabe
  function gateInfo() {
    if (!layer.isConnected) return null;
    const r = layer.getBoundingClientRect();
    return { left: r.left, right: r.left + geo.W, y: r.top + feetY(GATE_D), u: geo.u, size: sizeOf() };
  }

  function say(a, symbol, ms = 1600) {
    a.seq++; a.lastEmote = symbol;
    a.emote.innerHTML = emoteHtml(symbol);
    a.emote.classList.remove('show'); void a.emote.offsetWidth; a.emote.classList.add('show');
    a.emoteUntil = performance.now() + ms;
  }

  function hop(a, v = 1) { if (a.hop <= 0.5) a.hopV = 260 * v * (geo.H / 380); }

  // ---------- Sprechblase ----------
  function speak(key, inner, ms = 4000) {
    hush();
    if (!actors.has(key) || !layer.isConnected) return null;
    const el = html('div', 'sc-say', inner);
    layer.append(el);
    speech = { key, el, until: ms ? performance.now() + ms : Infinity };
    placeSpeech(performance.now());
    return el;
  }
  function hush(key) {
    if (!speech || (key && speech.key !== key)) return;
    speech.el.remove();
    speech = null;
  }
  function placeSpeech(now) {
    const a = speech && actors.get(speech.key);
    if (!a || now > speech.until) { hush(); return; }
    const el = speech.el, w = el.offsetWidth, h = el.offsetHeight, s = sizeOf();
    const cx = a.x * geo.W;
    const left = clamp(cx - w / 2, 4, Math.max(4, geo.W - w - 4));
    const top = Math.max(4, feetY(a.d) - s - a.hop - h + s * 0.08);
    el.style.transform = `translate(${px(left)}, ${px(top)})`;
    el.style.setProperty('--tail', px(clamp(cx - left, 12, w - 12)));
  }

  // ---------- Spielzeug ----------
  function useToy(id) {
    putAway();
    const t = TOYS[id];
    if (!t) return;
    measure();
    toy = { id, ...t, x: geo.W * 0.5, y: feetY(0.85) - toyPx() / 2, vx: 0, vy: 0, d: 0.85, spin: 0, fresh: false, carriedBy: null, el: null, speed: 0 };
    if (t.kind === 'throw') {
      toy.el = html('div', 'sc-toy throw ' + id, iconSvg(id));
      toy.el.title = t.hint;
    } else if (t.kind === 'station') {
      const a = actors.get(hooks.active()) || [...actors.values()][0];
      toy.x = a && a.x < 0.5 ? geo.W * 0.74 : geo.W * 0.28;
      toy.d = 0.3;
      toy.el = html('div', 'sc-toy station ' + id, id === 'toy_wheel' ? iconSvg('wheel0', 'w0') + iconSvg('wheel1', 'w1') : id === 'toy_rope' ? '' : iconSvg(STATION[id][0]));
      if (id === 'toy_rope') toy.el.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(iconSvg('rope'))}")`;
      toy.el.title = t.hint;
    }
    if (toy.el) layer.append(toy.el);
    layer.classList.add('toy-' + t.kind);
    drawProps();
  }

  function putAway() {
    if (toy && toy.el) toy.el.remove();
    if (toy) layer.classList.remove('toy-' + toy.kind);
    for (const b of bubbles.splice(0)) b.el.remove();
    for (const a of actors.values()) { a.carry = false; if (a.hidden) { a.hidden = false; a.el.style.opacity = ''; } }
    toy = null; lure = null; drawLure();
    drawProps();
  }

  function drawLure() {
    let el = layer.querySelector('.sc-lure');
    if (!lure || !toy || toy.kind !== 'lure') { if (el) el.remove(); return; }
    if (!el) {
      el = html('div', 'sc-lure ' + toy.id, toy.id === 'toy_laser' ? '<i class="dot"></i>'
        : `<svg class="line" aria-hidden="true"><line/></svg>${iconSvg(toy.id)}`);
      layer.append(el);
    }
    el.style.setProperty('--s', toyPx() + 'px');
    el.style.transform = `translate(${px(lure.x)}, ${px(lure.y)})`;
    const line = el.querySelector('line');
    if (line) {
      // Schnur der Federangel vom oberen Rand bis zur Feder
      const sx = clamp(lure.x + 70, 0, geo.W) - lure.x, sy = -lure.y;
      line.setAttribute('x1', 0); line.setAttribute('y1', 0); line.setAttribute('x2', sx); line.setAttribute('y2', sy);
    }
  }

  function blow(x, y) {
    for (let i = 0; i < 4; i++) {
      const r = Math.round(rand(4, 7)) * geo.u;
      const el = html('div', 'sc-bubble');
      el.style.width = el.style.height = 2 * r + 'px';
      layer.append(el);
      bubbles.push({ x: x + rand(-10, 10), y: y + rand(-6, 6), vx: rand(-50, 50), vy: rand(-45, -15), r, t: 0, life: rand(6, 9), el, wob: rand(0, 6) });
    }
    hooks.sound('pop');
  }

  // Ein Tier hat etwas gefangen oder benutzt: zählt als Spielen (höchstens alle PLAY_GAP ms je Tier)
  function played(a, now) {
    if (now < a.nextPlay) return null;
    a.nextPlay = now + PLAY_GAP;
    const r = hooks.play(a.entry, toy.id) || { ok: false };
    if (!r.ok) { say(a, '💤'); a.bored[toy.id] = now + BORED_MS; return r; }
    if (r.factor < 0.5) { say(a, '…', 2200); a.bored[toy.id] = now + BORED_MS; } else say(a, r.fav ? '😍' : '♪');
    return r;
  }

  const bored = (a, now) => (toy && a.bored[toy.id] > now);

  // ---------- Ablauf ----------
  function tick(t) {
    raf = 0;
    if (!host || !layer.isConnected) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    measure();
    const now = performance.now();
    const all = [...actors.values()];
    stepToy(dt, now);
    stepBubbles(dt);
    stepMusic(now);
    assignSleep();
    for (const a of all) {
      const p = a.entry.pet;
      if (!local(a)) { stepRemote(a, dt); continue; }
      stepActor(a, p, all, dt, now);
      // Springen
      if (a.hopV || a.hop > 0) {
        a.hop += a.hopV * dt; a.hopV -= 900 * (geo.H / 380) * dt;
        if (a.hop <= 0) { a.hop = 0; a.hopV = 0; }
      }
    }
    separate(all.filter((a) => local(a) && a.plan?.type !== 'out' && !(a.snug > now)), dt, now);
    draw(now);
    // Stromsparen: Schlafen alle und ist nichts los, reichen 8 Bilder pro Sekunde
    const still = all.length && all.every((a) => local(a) && a.entry.pet.sleeping && !a.walking && !a.hop) && !toy && !speech && !furnishing && !rub;
    if (still) slow = setTimeout(() => { slow = 0; tick(performance.now()); }, 125);
    else raf = requestAnimationFrame(tick);
  }
  function kick() { if (slow) { clearTimeout(slow); slow = 0; } if (!raf && host) raf = requestAnimationFrame(tick); }

  function stepActor(a, p, all, dt, now) {
    if (furnishing) { a.walking = false; return; }   // beim Einrichten warten alle
    if (a.dance) { a.walking = false; return; }
    if (now < a.busyUntil) { a.walking = false; return; }
    const others = all.filter((o) => o !== a && !o.hidden && !o.tucked).map((o) => ({ key: o.id, pet: o.entry.pet, x: o.x, d: o.d, a: o }));

    // Schlafen: jedes Tier auf seinen eigenen Platz (Bett, Kissen, Haus), sonst dort, wo es gerade ist
    if (p.sleeping) {
      a.carry = false;
      if (a.spot) {
        if (move(a, a.spot, speed(p) * 0.8, dt)) {
          a.walking = false;
          a.perch = a.spot.lift || 0;
          if (a.spot.hide && !a.tucked) { a.tucked = true; a.el.style.opacity = '0'; }
        } else { a.perch = 0; untuck(a); }
      } else a.walking = false;
      return;
    }
    if (a.bed || a.tucked) wakeUp(a);

    if (toy && playToy(a, p, others, dt, now)) return;

    // Eigene Pläne: herumlaufen, sitzen, Freunde besuchen, Fangen spielen, an den Napf, durchs Tor
    if (!a.plan || now > a.until) {
      const plan = reduced() ? { type: 'sit', ms: 4000 } : ownPlan(a, p) || decide({ pet: p, x: a.x, d: a.d }, others);
      a.plan = plan; a.until = now + plan.ms;
      if (plan.type === 'look') a.tiltUntil = now + plan.ms;
      if (plan.type === 'nap') say(a, '💤', plan.ms);
      if (plan.type === 'chase') {
        const o = actors.get(plan.with);
        if (o && local(o) && !(o.plan && o.plan.type === 'flee')) {
          // Wer angestupst wird, rennt weg, der andere hinterher
          o.plan = { type: 'flee', x: a.x > 0.5 ? rand(0.1, 0.35) : rand(0.65, 0.9), d: rand(0.1, 0.9) }; o.until = now + plan.ms;
          say(a, '♪'); say(o, '❗', 900);
        }
      }
    }
    const pl = a.plan;
    switch (pl.type) {
      case 'wander': if (move(a, pl, speed(p), dt)) { a.plan = { type: 'sit' }; a.until = now + rand(1500, 4000); } break;
      case 'flee': if (move(a, pl, speed(p, 'run'), dt)) { a.plan = { type: 'sit' }; a.until = now + 2000; } break;
      case 'visit': case 'chase': {
        const o = actors.get(pl.with);
        if (!o || o.hidden || petOf(o.id).sleeping) { a.plan = null; break; }
        const target = pl.type === 'chase' ? { x: o.x, d: o.d } : besides(o);
        if (pl.type === 'chase' && Math.abs(o.x - a.x) < 0.09 && Math.abs(o.d - a.d) < 0.2) {
          // Erwischt! Beide hüpfen vor Freude
          hop(a); say(a, '😄');
          if (local(o)) { hop(o, 0.8); say(o, '😄'); o.plan = { type: 'sit' }; o.until = now + 2500; }
          a.plan = { type: 'sit' }; a.until = now + 2500;
          break;
        }
        if (move(a, target, speed(p, pl.type === 'chase' ? 'run' : 'walk'), dt) && pl.type === 'visit') {
          // Angekommen: raufen, kuscheln oder einander anschauen, beschnuppern, Herzchen
          const both = a.entry.kind === 'own' && o.entry.kind === 'own' && now > o.busyUntil && !o.dance;
          const kind = both ? social(p.species, o.entry.pet.species, { evening: new Date().getHours() >= 19 }) : null;
          if (kind === 'romp') { romp(a, o, now); break; }
          if (kind === 'snuggle') { snuggle(a, o, now); break; }
          a.facing = o.x > a.x ? 1 : -1;
          if (!o.walking && local(o)) o.facing = -a.facing;
          say(a, pick(['❤️', '💕', '👋', '😊'])); setTimeout(() => say(o, pick(['❤️', '💕', '😊'])), 450);
          hop(a, 0.5);
          a.plan = { type: 'sit' }; a.until = now + rand(2500, 4000);
          if (local(o) && o.plan && ['wander', 'sit', 'look'].includes(o.plan.type)) { o.plan = { type: 'sit' }; o.until = now + 2500; }
        }
        break;
      }
      case 'out': {
        // Durchs offene Tor auf den Desktop
        if (!gateOpenFor(p, pl.side) || !(hooks.mayLeave && hooks.mayLeave(a.entry))) { a.plan = null; break; }
        if (move(a, { x: pl.side === 'l' ? -0.07 : 1.07, d: GATE_D }, speed(p, 'run'), dt)) {
          const g = gateInfo();
          a.plan = { type: 'sit' }; a.until = now + 3000;
          if (g && hooks.leave) hooks.leave(a.entry, pl.side, { x: pl.side === 'l' ? g.left : g.right, y: g.y, facing: pl.side === 'l' ? -1 : 1, u: g.u });
        }
        break;
      }
      case 'bowl': {
        const b = props.get(pl.id);
        if (!b) { a.plan = null; break; }
        const side = a.x < b.x ? -1 : 1;
        if (move(a, { x: clamp(b.x + side * (b.f.w * geo.u / geo.W) * 0.55, 0.06, 0.94), d: Math.min(1, b.y + 0.03) }, speed(p), dt)) {
          a.facing = -side;
          a.busyUntil = now + 1900; flash(a, 'eating', 1900);
          if (hooks.eat) hooks.eat(a.entry, pl.kind);
          a.plan = { type: 'sit' }; a.until = now + 2500;
        }
        break;
      }
      case 'mess': if (move(a, pl, speed(p), dt)) doMess(a, pl.plan, now); break;
      case 'prop': {
        const b = props.get(pl.id);
        if (!b || (b.user && b.user !== a.id)) { a.plan = null; break; }
        b.user = a.id;
        if (move(a, { x: b.x, d: Math.min(1, b.y + 0.02) }, speed(p, pl.play ? 'run' : 'walk'), dt)) usePropNow(a, b, pl.play, now);
        break;
      }
      default: a.walking = false;
    }
  }

  // Eigene Wünsche vor dem Zufall: Hunger oder Durst und ein voller Napf, ab und zu raus, ab und zu ein Möbel
  function ownPlan(a, p) {
    const want = hooks.bowlWant ? hooks.bowlWant(a.entry) : null;
    if (want) {
      const b = [...props.values()].find((x) => x.f.bowl === want);
      if (b) return { type: 'bowl', id: b.id, kind: want, ms: 12000 };
    }
    if (gates.on && a.entry.kind === 'own' && hooks.mayLeave && hooks.mayLeave(a.entry) && Math.random() < 0.18) {
      const sides = ['l', 'r'].filter((sd) => gateOpenFor(p, sd));
      if (sides.length) return { type: 'out', side: sides[Math.floor(Math.random() * sides.length)], ms: 20000 };
    }
    if (Math.random() < 0.12) {
      const b = [...props.values()].filter((x) => !x.user && fitsProp(x, p));
      if (b.length) return { type: 'prop', id: pick(b).id, ms: 15000 };
    }
    return null;
  }
  const fitsProp = (b, p) => (b.f.station && b.f.station.includes(p.species)) || (b.f.climb && b.f.climb.includes(p.species))
    || (b.f.hide && !b.f.station && Array.isArray(b.f.sleep) && b.f.sleep.includes(p.species));

  // Ein Möbel benutzen: Laufrad drehen, durch den Tunnel, Kratzbaum hinauf, kurz im Karton verschwinden.
  // play: angetippt, zählt als Spielen
  function usePropNow(a, b, play, now) {
    const id = b.id, ms = id === 'toy_tunnel' ? 1400 : 2600;
    a.plan = { type: 'sit' }; a.until = now + ms + 1500;
    a.busyUntil = now + ms;
    if (id === 'toy_wheel') { b.el.classList.add('spin'); flash(a, 'running', ms); } else if (b.f.climb) flash(a, 'climb', ms);
    else {
      a.hidden = true; a.el.style.opacity = '0';
      const out = b.x + (a.x < 0.5 ? 0.16 : -0.16);
      setTimeout(() => { a.hidden = false; a.el.style.opacity = ''; if (id === 'toy_tunnel') a.x = clamp(out, 0.08, 0.92); hop(a, 0.6); }, ms - 200);
    }
    setTimeout(() => {
      b.el.classList.remove('spin');
      if (b.user === a.id) b.user = null;
      if (play && hooks.play) {
        const r = hooks.play(a.entry, id) || { ok: false };
        if (!r.ok) say(a, '💤'); else say(a, r.factor < 0.5 ? '…' : r.fav ? '😍' : '♪');
      }
    }, ms);
  }

  // Ein Möbel angetippt: das gewählte Tier (oder ein anderes, das Lust hat) spielt damit
  function tapProp(b) {
    if (b.user) { const a = actors.get(b.user); if (a && b.id === 'toy_wheel') a.busyUntil += 600; return; }
    const act = hooks.active();
    const order = [...actors.values()].filter((o) => o.entry.kind === 'own').sort((x, y) => (y.id === act) - (x.id === act));
    const a = order.find((o) => wantsToPlay(o.entry.pet, b.id) && fitsProp(b, o.entry.pet));
    if (!a) { if (order[0]) say(order[0], '😴'); return; }
    a.plan = { type: 'prop', id: b.id, play: true }; a.until = performance.now() + 15000;
    b.user = a.id;
    say(a, '❗', 800);
  }

  // Live-Tiere: sanft zum letzten gemeldeten Stand gleiten
  function stepRemote(a, dt) {
    const n = a.entry.net;
    if (!n) return;
    const k = Math.min(1, dt * 8);
    if (Math.abs(n.x - a.x) > 0.5) a.x = n.x; else a.x += (n.x - a.x) * k;
    a.d += (n.d - a.d) * k;
    a.facing = n.facing; a.walking = n.walking;
    a.hop = n.hop * (geo.H / 380); a.hopV = 0;
    if (n.hidden !== a.hidden) { a.hidden = n.hidden; a.el.style.opacity = n.hidden ? '0' : ''; }
    if (n.seq !== a.netSeq) { a.netSeq = n.seq; if (n.emote) say(a, n.emote); }
  }

  // Tiere schieben sich sanft auseinander, statt übereinander zu stehen
  function separate(all, dt, now) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.hidden || b.hidden) continue;
        const dx = b.x - a.x, dd = b.d - a.d;
        if (Math.abs(dx) >= MIN_GAP || Math.abs(dd) >= 0.25) continue;
        const sign = dx > 0 || (dx === 0 && i % 2) ? 1 : -1;
        const push = (MIN_GAP - Math.abs(dx)) * Math.min(1, dt * 3);
        // Schlafende bleiben liegen, wer wach ist, weicht aus
        const sa = a.entry.pet.sleeping, sb = b.entry.pet.sleeping;
        if (sa && sb) continue;
        const fa = sa || now < a.busyUntil ? 0 : sb || now < b.busyUntil ? 2 : 1, fb = 2 - fa;
        a.x = clamp(a.x - sign * push * fa / 2, 0.06, 0.94);
        b.x = clamp(b.x + sign * push * fb / 2, 0.06, 0.94);
      }
    }
  }

  // Bewegt ein Tier Richtung Ziel; true = angekommen
  function move(a, target, v, dt) {
    const r = stepTowards({ x: a.x, d: a.d }, target, v * dt);
    if (Math.abs(r.x - a.x) > 0.0005) a.facing = r.x > a.x ? 1 : -1;
    a.x = r.x; a.d = r.d;
    a.walking = !r.arrived;
    return r.arrived;
  }

  // Spielen mit dem herausgeholten Spielzeug. true = das Tier ist damit beschäftigt
  function playToy(a, p, others, dt, now) {
    const want = wantsToPlay(p, toy.id, new Set(bored(a, now) ? [a.id] : []));
    if (toy.kind === 'throw') {
      if (toy.carriedBy === a.id) {
        // Hunde und Füchse bringen das Spielzeug zurück, andere lassen es nach kurzer Zeit fallen
        const fetcher = ['dog', 'fox'].includes(p.species);
        if (!fetcher || move(a, { x: 0.5, d: 1 }, speed(p, 'run'), dt)) {
          if (!fetcher && now < a.dropAt) { a.walking = false; return true; }
          toy.carriedBy = null; toy.fresh = false; a.carry = false;
          toy.x = a.x * geo.W + a.facing * sizeOf() * 0.25; toy.d = a.d; toy.y = feetY(a.d) - toyR(); toy.vx = toy.vy = 0;
          if (fetcher) { say(a, '🐾'); hop(a, 0.6); }
        }
        return true;
      }
      if (!want) return false;
      if (toy.carriedBy || drag || !toy.fresh) {
        // Wartet aufs nächste Werfen und schaut gespannt zum Spielzeug
        a.walking = false;
        const tx = toy.carriedBy ? actors.get(toy.carriedBy).x : toy.x / geo.W;
        a.facing = tx > a.x ? 1 : -1;
        if (drag && Math.random() < dt * 0.8) hop(a, 0.45);
        return true;
      }
      const tpos = { x: toy.x / geo.W, d: toy.d, air: (feetY(toy.d) - toy.y) / geo.H };
      move(a, { x: tpos.x, d: tpos.d }, speed(p, 'chase'), dt);
      if (Math.abs(tpos.x - a.x) < 0.1 && tpos.air > 0.06 && tpos.air < 0.3) hop(a, 0.9);
      if (canCatch({ x: a.x, d: a.d }, tpos, 0.08 + a.hop / geo.H)) {
        toy.carriedBy = a.id; toy.fresh = false; a.carry = true; a.dropAt = now + 1300;
        played(a, now);
      }
      return true;
    }
    if (toy.kind === 'lure') {
      if (!want) return false;
      if (!lure) { a.walking = false; return true; }
      const d = lure.y > geo.far ? depthAt(lure.y) : a.d;
      const air = (feetY(d) - lure.y) / geo.H;
      const tpos = { x: lure.x / geo.W, d, air };
      if (now < a.nextPlay - PLAY_GAP + 900) { a.walking = false; return true; }   // kurz verschnaufen nach dem Fang
      move(a, tpos, speed(p, 'chase') * (toy.id === 'toy_stick' ? 0.5 : 1), dt);
      if (Math.abs(tpos.x - a.x) < 0.09 && air > 0.08 && air < 0.38 && toy.id !== 'toy_stick') hop(a, 1);
      if (canCatch({ x: a.x, d: a.d }, tpos, 0.1 + a.hop / geo.H)) {
        const r = played(a, now);
        if (r && r.ok) {
          if (toy.gnaw) { a.busyUntil = now + 1600; flash(a, 'eating', 1600); }
          else { hop(a, 0.7); flash(a, 'pounce', 500); }
        }
      }
      return true;
    }
    if (toy.kind === 'bubbles') {
      if (!want || !bubbles.length) { if (want) a.walking = false; return want && bubbles.length > 0; }
      const ax = a.x * geo.W;
      const b = bubbles.reduce((m, x) => (Math.abs(x.x - ax) < Math.abs(m.x - ax) ? x : m));
      move(a, { x: b.x / geo.W, d: a.d }, speed(p, 'chase') * 0.8, dt);
      const size = sizeOf();
      const headY = feetY(a.d) - size * 0.75 - a.hop;
      if (Math.abs(b.x - ax) < size * 0.3 && b.y < headY + size * 0.3) hop(a, clamp((feetY(a.d) - b.y) / (size * 1.2), 0.5, 1.2));
      if (Math.abs(b.x - ax) < size * 0.32 && Math.abs(b.y - headY) < size * 0.35) {
        pop(b); flash(a, 'pounce', 400);
        if (now >= a.nextPlay) played(a, now); else say(a, '✨', 700);
      }
      return true;
    }
    if (toy.kind === 'station') {
      if (toy.user !== a.id) {
        if (want && !toy.user) { a.walking = false; a.facing = toy.x / geo.W > a.x ? 1 : -1; return true; }
        return false;
      }
      const spot = { x: toy.x / geo.W, d: toy.d + 0.02 };
      if (!toy.using) {
        if (move(a, spot, speed(p, 'run'), dt)) { toy.using = now; useStation(a, now); }
        return true;
      }
      return true;
    }
    return false;
  }

  function useStation(a, now) {
    const id = toy.id;
    if (id === 'toy_wheel') {
      toy.el.classList.add('spin');
      a.busyUntil = now + 2600; flash(a, 'running', 2600);
    } else if (id === 'toy_tunnel') {
      // Rein, verschwinden, auf der anderen Seite wieder raus
      a.busyUntil = now + 1400;
      a.hidden = true; a.el.style.opacity = '0';
      const out = toy.x / geo.W + (a.x < 0.5 ? 0.16 : -0.16);
      setTimeout(() => { a.x = clamp(out, 0.08, 0.92); a.hidden = false; a.el.style.opacity = ''; hop(a, 0.6); }, 1100);
    } else {
      a.busyUntil = now + 2400; flash(a, 'climb', 2400);
    }
    setTimeout(() => {
      if (!toy || toy.id !== id) return;
      toy.el.classList.remove('spin');
      played(a, performance.now());
      toy.user = null; toy.using = 0;
    }, id === 'toy_tunnel' ? 1300 : 2500);
  }

  function stepToy(dt, now) {
    if (!toy || toy.kind !== 'throw' || drag) return;
    if (toy.carriedBy) {
      const a = actors.get(toy.carriedBy);
      if (!a) { toy.carriedBy = null; return; }
      const s = sizeOf();
      toy.x = a.x * geo.W + a.facing * s * 0.06; toy.y = feetY(a.d) - s * 0.42 - a.hop; toy.d = a.d;
      return;
    }
    const g = 1500 * (geo.H / 380) * (toy.glide && toy.vy > 0 && Math.abs(toy.vx) > 150 ? 0.3 : 1);
    toy.vy += g * dt;
    toy.x += toy.vx * dt; toy.y += toy.vy * dt;
    const r = toyR(), ground = feetY(toy.d) - r;
    if (toy.x < r) { toy.x = r; toy.vx = Math.abs(toy.vx) * 0.7; }
    if (toy.x > geo.W - r) { toy.x = geo.W - r; toy.vx = -Math.abs(toy.vx) * 0.7; }
    if (toy.y < r) { toy.y = r; toy.vy = Math.abs(toy.vy) * 0.5; }
    if (toy.y >= ground) {
      toy.y = ground;
      if (toy.vy > 160) { toy.vy = -toy.vy * toy.bounce; if (toy.vy < -200) hooks.sound('pop'); } else toy.vy = 0;
      toy.vx *= Math.pow(toy.roll, dt * 60);
      if (Math.abs(toy.vx) < 4) toy.vx = 0;
    }
    toy.spin += (toy.vx * dt * 180) / (Math.PI * r);
  }

  function stepBubbles(dt) {
    for (const b of [...bubbles]) {
      b.t += dt;
      // Seifenblasen steigen kurz auf und sinken dann langsam zu Boden, wo die Tiere sie erwischen
      b.vy = Math.min(b.vy + 14 * dt, 30);
      if (b.y > feetY(1) - b.r) { b.y = feetY(1) - b.r; b.t = Math.max(b.t, b.life - 0.3); }
      b.x += (b.vx + Math.sin(b.t * 2 + b.wob) * 25) * dt; b.vx *= 0.99;
      b.y += b.vy * dt;
      if (b.t > b.life || b.y < -b.r) pop(b, b.t > b.life);
    }
  }

  function pop(b, burst = true) {
    const i = bubbles.indexOf(b);
    if (i >= 0) bubbles.splice(i, 1);
    if (!burst) { b.el.remove(); return; }
    b.el.classList.add('pop');
    setTimeout(() => b.el.remove(), 250);
    hooks.sound('pop');
  }

  function flash(a, cls, ms) {
    a.el.classList.add(cls);
    clearTimeout(a['t_' + cls]);
    a['t_' + cls] = setTimeout(() => a.el.classList.remove(cls), ms);
  }

  // ---------- Zeichnen ----------
  // Bewegung immer in ganzen Bildpunkten: Pixel-Art wird verschoben, nie gedreht oder weich skaliert
  function draw(now) {
    const u = geo.u, s = sizeOf();
    layer.classList.toggle('speaking', !!speech);   // solange eins spricht, ruhen die Gedankenblasen
    for (const a of actors.values()) {
      const fy = feetY(a.d);
      let lift = a.hop + (a.perch && !a.walking ? a.perch * u : 0);
      if (a.el.classList.contains('climb')) lift += Math.sin(((now % 2400) / 2400) * Math.PI) * geo.H * 0.32;
      paint(a, now);
      const look = gaze(a, now);
      a.el.classList.toggle('look-l', look === 'l');
      a.el.classList.toggle('look-r', look === 'r');
      a.el.style.width = a.el.style.height = s + 'px';
      a.el.style.transform = `translate(${px(a.x * geo.W - s / 2)}, ${px(fy - s)})`;
      a.el.style.zIndex = z(a.d);
      a.body.style.transform = `translateY(${-Math.round(lift / u) * u}px)`;
      a.flip.style.transform = `scaleX(${a.facing})`;
      a.shadow.style.transform = `scale(${(Math.round(clamp(1 - lift / (s * 1.4), 0.4, 1) * 4) / 4).toFixed(2)})`;
      a.el.classList.toggle('walking', a.walking);
      a.el.classList.toggle('tilt', now < a.tiltUntil);
      a.el.classList.toggle('talking', !!speech && speech.key === a.id);
      if (a.emoteUntil && now > a.emoteUntil) { a.emote.classList.remove('show'); a.emoteUntil = 0; }
    }
    if (toy && toy.el && toy.kind === 'throw') {
      const t = toyPx();
      toy.el.style.width = toy.el.style.height = t + 'px';
      toy.el.style.transform = `translate(${px(toy.x - t / 2)}, ${px(toy.y - t / 2)}) rotate(${(Math.round(toy.spin / 90) * 90) % 360}deg)`;
      toy.el.style.zIndex = z(toy.d, 11);
      toy.el.classList.toggle('carried', !!toy.carriedBy);
    }
    if (toy && toy.el && toy.kind === 'station') {
      const [, w, h] = STATION[toy.id];
      toy.el.style.width = w * u + 'px';
      if (toy.id === 'toy_rope') {
        // Das Seil hängt von der Decke bis knapp über den Boden
        const y1 = feetY(toy.d) - 12 * u;
        toy.el.style.height = px(y1);
        toy.el.style.backgroundSize = `${w * u}px ${h * u}px`;
        toy.el.style.transform = `translate(${px(toy.x - (w * u) / 2)}, 0)`;
      } else {
        toy.el.style.height = h * u + 'px';
        toy.el.style.transform = `translate(${px(toy.x - (w * u) / 2)}, ${px(feetY(toy.d) - h * u * (toy.id === 'toy_wheel' ? 1 : 0.8))})`;
      }
      toy.el.style.zIndex = z(toy.d, toy.id === 'toy_tunnel' ? 12 : 9);
    }
    for (const p of props.values()) {
      const b = propBox(p);
      p.el.style.width = b.w + 'px'; p.el.style.height = b.h + 'px';
      p.el.style.transform = `translate(${px(b.left)}, ${px(b.top)})`;
      p.el.style.zIndex = b.z;
    }
    placeGates();
    placeMarks();
    for (const r of romps) {
      const w = 64 * u, h = 46 * u, j = (Math.floor(now / 90) % 3 - 1) * u;
      r.el.style.width = w + 'px'; r.el.style.height = h + 'px';
      r.el.style.transform = `translate(${px(r.x * geo.W - w / 2 + j)}, ${px(feetY(r.d) - h + u)})`;
      r.el.style.zIndex = z(r.d, 11);
    }
    for (const b of bubbles) b.el.style.transform = `translate(${px(b.x - b.r)}, ${px(b.y - b.r)})`;
    if (speech) placeSpeech(now);
    drawGhosts();
  }

  // Spielzeug, mit dem andere im Live-Zimmer gerade spielen (nur zum Ansehen)
  function drawGhosts() {
    const list = hooks.remoteToys();
    for (const [key, el] of ghosts) if (!list.some((t) => t.key === key)) { el.remove(); ghosts.delete(key); }
    const t16 = toyPx();
    for (const t of list) {
      let el = ghosts.get(t.key);
      if (!el || el.dataset.id !== t.id) {
        if (el) el.remove();
        el = html('div', 'sc-toy ghost', t.id === 'toy_laser' ? '<i class="dot"></i>' : iconSvg(t.id));
        el.dataset.id = t.id;
        layer.append(el);
        ghosts.set(t.key, el);
      }
      el.style.width = el.style.height = t16 + 'px';
      el.style.transform = `translate(${px(t.x * geo.W - t16 / 2)}, ${px(t.y * geo.H - t16 / 2)}) rotate(${(Math.round(t.spin / 90) * 90) % 360}deg)`;
      el.style.zIndex = z(t.d, 11);
    }
  }

  // Stand der eigenen Tiere (und des Spielzeugs) für die anderen im Live-Zimmer
  function snapshot() {
    const pets = [];
    for (const a of actors.values()) {
      if (a.entry.kind !== 'own') continue;
      const p = a.entry.pet;
      pets.push({
        id: p.id, name: p.name, species: p.species, color: p.color, acc: p.acc, face: a.face || mood(p).face, sleeping: !!p.sleeping,
        x: +a.x.toFixed(3), d: +a.d.toFixed(3), facing: a.facing, walking: a.walking, hop: Math.round((a.hop * 380) / geo.H),
        emote: a.lastEmote, seq: a.seq, hidden: a.hidden,
      });
    }
    let t = null;
    if (toy && toy.kind === 'throw') t = { id: toy.id, x: toy.x / geo.W, y: toy.y / geo.H, d: toy.d, spin: toy.spin };
    else if (toy && toy.kind === 'lure' && lure) t = { id: toy.id, x: lure.x / geo.W, y: lure.y / geo.H, d: depthAt(lure.y), spin: 0 };
    return { pets, toy: t };
  }

  // ---------- Maus und Finger ----------
  const pos = (e) => { const r = layer.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const entryOf = (el) => { const a = el && actors.get(el.dataset.pet); return a ? a.entry : null; };

  layer.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (e.target.closest('.sc-say')) return;
    const think = e.target.closest('.sp-think');
    if (think) {
      const a = actors.get(think.closest('.sp').dataset.pet);
      e.preventDefault();
      if (a && a.thinkKey) hooks.need(a.entry, a.thinkKey);
      return;
    }
    const p = pos(e);
    const markEl = e.target.closest('.sc-mark');
    if (markEl && marks.has(markEl.dataset.mark) && !furnishing) {
      e.preventDefault();
      rub = { id: markEl.dataset.mark, x: e.clientX, y: e.clientY, dist: WIPE / 3 };
      markEl.classList.add('rub');
      layer.setPointerCapture?.(e.pointerId);
      kick();
      return;
    }
    const grip = e.target.closest('.sc-gate .grip');
    if (grip) {
      const side = grip.closest('.sc-gate').dataset.gate;
      gateDrag = { side, y0: p.y, v0: gates[side], v: gates[side] };
      layer.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const propEl = e.target.closest('.sc-prop');
    if (propEl && props.has(propEl.dataset.prop)) {
      const b = props.get(propEl.dataset.prop);
      e.preventDefault();
      if (furnishing) {
        if (e.target.closest('.sc-x')) { hooks.unplace(b.id); return; }
        const box = propBox(b);
        furnishing.sel = b.id;
        furnishing.drag = { id: b.id, dx: p.x - (box.left + box.w / 2), dy: p.y - (box.top + box.h), moved: 0 };
        drawProps();
        layer.setPointerCapture?.(e.pointerId);
        return;
      }
      if (b.f.chest) { hooks.openChest(propEl.getBoundingClientRect()); return; }
      if (b.f.station) { tapProp(b); return; }
      if (hooks.tapProp) hooks.tapProp(b.id, propEl.getBoundingClientRect());
      if (!b.f.bowl && !b.f.station && !b.f.chest) {
        // Deko: das nächste Tier schaut kurz hin
        const a = [...actors.values()].filter(local).sort((x, y) => Math.abs(x.x - b.x) - Math.abs(y.x - b.x))[0];
        if (a && !a.entry.pet.sleeping) { a.facing = b.x > a.x ? 1 : -1; say(a, '✨', 900); }
      }
      return;
    }
    if (toy && toy.el && toy.kind === 'throw' && !toy.carriedBy && e.target.closest('.sc-toy')) {
      drag = { samples: [{ ...p, t: e.timeStamp }] };
      toy.vx = toy.vy = 0;
      layer.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (toy && toy.kind === 'station' && e.target.closest('.sc-toy')) { tapStation(); return; }
    const petEl = e.target.closest('.sp');
    if (petEl) {
      stroke = { id: petEl.dataset.pet, x: e.clientX, y: e.clientY, dist: 0, moved: 0, timer: 0 };
      // Lange drücken öffnet das Menü des Tieres (wie die rechte Maustaste)
      if (e.pointerType !== 'mouse') {
        const st = stroke;
        st.timer = setTimeout(() => {
          if (stroke !== st || st.moved > 8) return;
          st.menu = true;
          const en = entryOf(petEl);
          if (en && hooks.menu) hooks.menu(en, st.x, st.y);
        }, 550);
      }
      layer.setPointerCapture?.(e.pointerId);
      return;
    }
    if (toy && toy.kind === 'bubbles') { blow(p.x, p.y); return; }
    if (toy && toy.kind === 'lure') { lure = p; drawLure(); layer.setPointerCapture?.(e.pointerId); }
  });

  layer.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (e.pointerType === 'mouse') { ptr = { x: p.x, y: p.y, t: performance.now() }; kick(); }
    if (rub) {
      rub.dist += Math.hypot(e.clientX - rub.x, e.clientY - rub.y); rub.x = e.clientX; rub.y = e.clientY;
      if (rub.dist >= WIPE) { const id = rub.id; rub = null; wiped(id); }
      return;
    }
    if (gateDrag) {
      // Griff hoch: auf, runter: zu (rastet bei zu, halb und offen ein)
      const h = 58 * geo.u;
      gateDrag.v = clamp(gateDrag.v0 + ((gateDrag.y0 - p.y) / (h * 0.5)), 0, 2);
      placeGates();
      return;
    }
    if (furnishing && furnishing.drag) {
      const fd = furnishing.drag, b = props.get(fd.id);
      if (!b) return;
      fd.moved += 1;
      const cx = p.x - fd.dx, by = p.y - fd.dy;
      b.x = clamp(cx / geo.W, 0.02, 0.98);
      b.y = b.f.wall ? clamp(by / geo.top, 0.1, 1) : depthAt(by - 2 * geo.u);
      draw(performance.now());
      return;
    }
    if (drag) {
      toy.x = clamp(p.x, 0, geo.W); toy.y = clamp(p.y, 0, geo.H);
      if (p.y > geo.far) toy.d = depthAt(p.y + toyR());
      drag.samples.push({ ...p, t: e.timeStamp });
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
      return;
    }
    if (stroke) {
      if (stroke.menu) return;
      const dd = Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y);
      stroke.dist += dd; stroke.moved += dd; stroke.x = e.clientX; stroke.y = e.clientY;
      if (stroke.dist > 140) { stroke.dist = 0; const a = actors.get(stroke.id); if (a) hooks.stroke(a.entry); }
      return;
    }
    if (toy && toy.kind === 'lure' && (e.pointerType === 'mouse' || e.buttons)) { lure = p; drawLure(); }
  });

  const up = (e) => {
    if (rub) {
      const k = marks.get(rub.id);
      if (k) k.el.classList.remove('rub');
      if (rub.dist >= WIPE) wiped(rub.id);
      rub = null;
      return;
    }
    if (gateDrag) {
      const g = gateDrag;
      gateDrag = null;
      const v = Math.round(g.v);
      if (v !== g.v0 && hooks.gateSet) hooks.gateSet(g.side, v); else placeGates();
      return;
    }
    if (furnishing && furnishing.drag) {
      const fd = furnishing.drag, b = props.get(fd.id);
      furnishing.drag = null;
      if (b && fd.moved && hooks.placed) hooks.placed(b.id, +b.x.toFixed(3), +b.y.toFixed(3));
      return;
    }
    if (drag) {
      const s = drag.samples, a = s[0], b = s[s.length - 1];
      const ms = Math.max(16, b.t - a.t);
      const k = 1000 / ms;
      toy.vx = clamp((b.x - a.x) * k, -1600, 1600); toy.vy = clamp((b.y - a.y) * k, -1600, 1600);
      toy.fresh = true; drag = null;
      // Geworfen wird vom Boden aus: liegt der Zeiger über dem Boden, landet das Spielzeug in der Zimmermitte
      if (toy.y < geo.far) toy.d = Math.max(toy.d, 0.4);
      hooks.sound('klick');
    }
    if (stroke) {
      clearTimeout(stroke.timer);
      if (stroke.moved < 8 && !stroke.menu && e.type === 'pointerup') { const a = actors.get(stroke.id); if (a) hooks.select(a.entry); }
      stroke = null;
    }
    if (toy && toy.kind === 'lure' && e.pointerType !== 'mouse') { lure = null; drawLure(); }
  };
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
  layer.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && toy && toy.kind === 'lure') { lure = null; drawLure(); } });
  layer.addEventListener('contextmenu', (e) => {
    const en = entryOf(e.target.closest('.sp'));
    if (!en || !hooks.menu) return;
    e.preventDefault();
    hooks.menu(en, e.clientX, e.clientY);
  });

  function tapStation() {
    if (toy.user) {
      // Laufrad: noch mal anschubsen verlängert den Lauf
      if (toy.id === 'toy_wheel' && toy.using) { const a = actors.get(toy.user); if (a) a.busyUntil += 600; }
      return;
    }
    const now = performance.now();
    const act = hooks.active();
    const order = [...actors.values()].filter(local).sort((x, y) => (y.id === act) - (x.id === act));
    const a = order.find((o) => wantsToPlay(o.entry.pet, toy.id, new Set(bored(o, now) ? [o.id] : [])));
    if (!a) {
      const any = order[0];
      if (any) say(any, '😴');
      return;
    }
    toy.user = a.id; toy.using = 0;
    say(a, '❗', 800);
  }

  // ---------- Pflege sichtbar machen ----------
  function animate(petId, action, extra = {}) {
    const a = actors.get(petId);
    if (!a) return;
    const now = performance.now();
    a.plan = null;
    switch (action) {
      case 'feed': case 'water': {
        const u = geo.u, s = sizeOf();
        const bowl = html('div', 'sc-bowl', iconSvg(action === 'water' ? 'drop' : extra.itemId || 'food_dry'));
        bowl.style.width = bowl.style.height = 16 * u + 'px';
        bowl.style.transform = `translate(${px(a.x * geo.W + a.facing * s * 0.34 - 8 * u)}, ${px(feetY(a.d) - 15 * u)})`;
        bowl.style.zIndex = z(a.d, 11);
        layer.append(bowl);
        a.busyUntil = now + 1900; a.walking = false;
        flash(a, 'eating', 1900);
        setTimeout(() => bowl.classList.add('gone'), 1700);
        setTimeout(() => bowl.remove(), 2100);
        break;
      }
      case 'pet': say(a, '❤️', 1200); if (!a.entry.pet.sleeping) posing(a, 'lean', 1200, 'happy'); break;
      case 'cuddle': say(a, '💞', 1800); posing(a, 'lean', 1800, 'happy'); break;
      case 'brush': a.shine = Date.now() + 3000; a.key = ''; sync(); say(a, '✨', 1800); a.busyUntil = now + 1200; setTimeout(sync, 3100); break;
      case 'bath': say(a, '🫧', 2200); flash(a, 'bath', 2200); a.busyUntil = now + 2200; break;
      case 'walk': {
        // Raus zur Tür und mit dem Fundstück wiederkommen
        a.plan = { type: 'flee', x: 1.15, d: 0.4 }; a.until = now + 2200;
        setTimeout(() => { a.x = -0.12; a.plan = { type: 'flee', x: 0.4, d: 0.7 }; a.until = performance.now() + 2500; say(a, extra.found ? '🎁' : '😊', 2000); }, 2300);
        break;
      }
      case 'sleep': a.face = null; say(a, '💤', 1500); break;
      case 'wake': hop(a, 0.6); say(a, '☀️', 1500); break;
      case 'levelup': hop(a, 1.2); say(a, '🎉', 2500); break;
    }
  }

  function floaters(petId, list) {
    const a = actors.get(petId);
    if (!a) return;
    list.forEach(([inner, minus, extra], i) => {
      const el = document.createElement('span');
      el.className = 'floater' + (minus ? ' minus' : '') + (extra ? ' ' + extra : '');
      el.innerHTML = inner;
      el.style.left = `${10 + ((i * 27) % 70)}%`;
      el.style.animationDelay = `${i * 120}ms`;
      a.el.append(el);
      setTimeout(() => el.remove(), 1800 + i * 120);
    });
  }

  function mount(el) {
    host = el;
    if (layer.parentNode !== el) el.append(layer);
    measure();
    sync();
    if (!raf && !slow) { last = 0; raf = requestAnimationFrame(tick); }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && host && !raf && !slow) raf = requestAnimationFrame(tick); });

  // Ein Tier kommt vom Desktop zurück: sync() setzt es ins Tor
  function enter(key, side) { entering.set(key, side === 'l' ? 'l' : 'r'); }

  function furnish(on, sel = null) {
    furnishing = on ? { sel, drag: null } : null;
    layer.classList.toggle('furnish', !!on);
    for (const p of props.values()) p.sig = '';
    drawProps();
  }

  return {
    mount, sync, useToy, putAway, animate, floaters, snapshot, speak, hush, enter, furnish, gateInfo, mess, shot,
    get furnishing() { return !!furnishing; },
    get toy() { return toy ? toy.id : null; },
    get speaking() { return speech ? speech.key : null; },
    actorAt: (id) => actors.get(id),
  };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
