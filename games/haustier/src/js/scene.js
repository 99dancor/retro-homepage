// Das Zimmer als lebendige Szene: Alle Tiere laufen frei herum, beschäftigen sich miteinander und spielen
// mit dem Spielzeug, das man herausholt. Nur im Browser; die Entscheidungen stehen in behavior.js.
//
//   const scene = createScene(hooks)
//   scene.mount(roomElement)   Szene ins (neu gezeichnete) Zimmer hängen
//   scene.sync()               Tiere mit dem Spielstand abgleichen (neue Tiere, Laune, Accessoires)
//   scene.useToy(id) / putAway()
//   scene.animate(petId, action, extra)   Pflege sichtbar machen (Napf, Herzchen, Gassi …)
//   scene.floaters(petId, list)            aufsteigende Zahlen über einem Tier
//   scene.snapshot()                       Stand der eigenen Tiere und des Spielzeugs fürs Live-Zimmer
//
// hooks:
//   roster()   alle Tiere im Zimmer: [{ key, pet, kind, owner?, net? }]
//              kind: own (eigenes Tier, läuft hier), foreign (fremdes Tier, läuft hier), remote (läuft bei seinem Besitzer)
//              net:  letzter Live-Stand eines remote-Tieres { x, d, facing, walking, hop, emote, seq, hidden }
//   active()   key des ausgewählten Tieres     bed(): Körbchen zeigen?     remoteToys(): [{ key, id, x, y, d, spin }]
//   select(entry), stroke(entry), play(entry, itemId) -> { ok, factor, fav }, sound(name)
import { SPECIES, mood } from './pets.js';
import { ITEMS } from './items.js';
import { petSvg } from './art.js';
import { TOYS, decide, besides, stepTowards, canCatch, wantsToPlay, speed } from './behavior.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const html = (tag, cls, inner = '') => { const el = document.createElement(tag); el.className = cls; el.innerHTML = inner; return el; };

// Wie lange ein Tier nach einem gefangenen Spielzeug wartet, bevor es wieder zählt
const PLAY_GAP = 2500;
const BORED_MS = 25000;
const BED = { x: 0.13, d: 0.12 };
const MIN_GAP = 0.17;          // so weit (in Zimmerbreiten) halten Tiere Abstand voneinander

export function createScene(hooks) {
  const layer = html('div', 'scene');
  const actors = new Map();        // key -> Darsteller (key = Tier-id bei eigenen Tieren)
  const ghosts = new Map();        // Spielzeug anderer im Live-Zimmer
  let host = null, raf = 0, last = 0;
  let geo = { W: 400, H: 300, top: 200, near: 280, far: 214 };
  let toy = null;                  // herausgeholtes Spielzeug
  let lure = null;                 // Zeiger für Federangel, Laser und Knabberstab: { x, y } in px
  const bubbles = [];
  let bed = null;
  let drag = null;                 // gehaltenes Wurfspielzeug: { id, samples }
  let stroke = null;               // Streicheln: { id, x, y, dist, moved }

  // ---------- Geometrie ----------
  // Der Zimmerhintergrund ist 400 × 300 groß, unten ausgerichtet und füllt die Fläche (slice); der Boden beginnt bei 186
  function measure() {
    const W = layer.clientWidth || 400, H = layer.clientHeight || 300;
    const k = Math.max(W / 400, H / 300);
    const top = H - 114 * k;
    geo = { W, H, top, far: top + 16, near: H - 24 };
  }
  const feetY = (d) => geo.far + d * (geo.near - geo.far);
  const depthAt = (y) => clamp((y - geo.far) / (geo.near - geo.far), 0, 1);
  const scaleAt = (d) => 0.66 + 0.34 * d;
  const baseSize = () => clamp(Math.min(geo.W * 0.36, geo.H * 0.5), 80, 200);
  const sizeOf = (a) => baseSize() * scaleAt(a.d);

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
      id: entry.key, entry, el, body, flip, shadow, emote, name, seq: 0, lastEmote: '', netSeq: net ? net.seq : 0,
      x: net ? net.x : n === 1 ? 0.5 : 0.22 + (0.56 * i) / Math.max(1, n - 1), d: net ? net.d : 0.55 + (i % 2) * 0.25,
      facing: 1, hop: 0, hopV: 0, walking: false, plan: null, until: 0, key: '',
      face: null, busyUntil: 0, nextPlay: 0, bored: {}, carry: false, hidden: false,
      emoteUntil: 0, tiltUntil: 0, blink: rand(0, 4).toFixed(2),
    };
  }

  function sync() {
    const list = hooks.roster();
    for (const [key, a] of actors) {
      if (!list.some((e) => e.key === key)) { a.el.remove(); actors.delete(key); if (toy && toy.user === key) toy.user = null; }
    }
    list.forEach((e, i) => {
      const a = actors.get(e.key);
      if (a) a.entry = e;
      else actors.set(e.key, makeActor(e, i, list.length));
    });
    const active = hooks.active();
    const mine = list.filter((e) => e.kind === 'own').length;
    for (const a of actors.values()) {
      const p = a.entry.pet;
      // Live-Tiere zeigen das Gesicht, das ihr Besitzer sieht
      const face = a.face || (a.entry.kind === 'remote' && a.entry.net ? (a.entry.net.face || 'ok') : mood(p).face);
      const key = [p.species, p.color, face, JSON.stringify(p.acc), a.shine > Date.now()].join('|');
      if (key !== a.key) {
        a.key = key;
        a.flip.innerHTML = petSvg(p.species, p.color, face, { title: `${p.name}, ${SPECIES[p.species].name}`, acc: p.acc, shine: a.shine > Date.now(), shadow: false });
        a.flip.firstChild.style.setProperty('--blink', a.blink + 's');
      }
      a.name.textContent = a.entry.owner ? `${p.name} · ${a.entry.owner}` : p.name;
      a.el.classList.toggle('active', a.id === active && (mine > 1 || list.length > mine));
      a.el.classList.toggle('happy', face === 'happy');
      a.el.classList.toggle('guest', a.entry.kind !== 'own');
    }
    drawBed(hooks.bed());
  }

  function drawBed(has) {
    if (!has) { if (bed) { bed.remove(); bed = null; } return; }
    if (!bed) {
      bed = html('div', 'sc-bed', `<svg viewBox="0 0 120 50" aria-hidden="true"><ellipse cx="60" cy="30" rx="58" ry="19" fill="#b8763a" stroke="#6a4020" stroke-width="2.5"/>
        <ellipse cx="60" cy="26" rx="46" ry="12" fill="#f4d9e6" stroke="#6a4020" stroke-width="2"/><path d="M12,30 q48,22 96,0" fill="none" stroke="#8a5428" stroke-width="2"/></svg>`);
      bed.title = 'Körbchen';
      layer.prepend(bed);
    }
  }

  function say(a, symbol, ms = 1600) {
    a.seq++; a.lastEmote = symbol;
    a.emote.textContent = symbol;
    a.emote.classList.remove('show'); void a.emote.offsetWidth; a.emote.classList.add('show');
    a.emoteUntil = performance.now() + ms;
  }

  function hop(a, v = 1) { if (a.hop <= 0.5) a.hopV = 260 * v * (geo.H / 380); }

  // ---------- Spielzeug ----------
  function useToy(id) {
    putAway();
    const t = TOYS[id];
    if (!t) return;
    measure();
    toy = { id, ...t, x: geo.W * 0.5, y: feetY(0.85) - 10, vx: 0, vy: 0, d: 0.85, spin: 0, fresh: false, carriedBy: null, el: null, speed: 0 };
    if (t.kind === 'throw') {
      toy.el = html('div', 'sc-toy throw', `<span>${ITEMS[id].icon}</span>`);
      toy.el.title = t.hint;
    } else if (t.kind === 'station') {
      const a = actors.get(hooks.active()) || [...actors.values()][0];
      toy.x = a && a.x < 0.5 ? geo.W * 0.78 : geo.W * 0.22;
      toy.d = 0.3;
      toy.el = html('div', 'sc-toy station ' + id, stationSvg(id));
      toy.el.title = t.hint;
    }
    if (toy.el) layer.append(toy.el);
    layer.classList.add('toy-' + t.kind);
  }

  function putAway() {
    if (toy && toy.el) toy.el.remove();
    if (toy) layer.classList.remove('toy-' + toy.kind);
    for (const b of bubbles.splice(0)) b.el.remove();
    for (const a of actors.values()) { a.carry = false; if (a.hidden) { a.hidden = false; a.el.style.opacity = ''; } }
    toy = null; lure = null; drawLure();
  }

  function stationSvg(id) {
    if (id === 'toy_wheel') {
      return `<svg viewBox="0 0 100 110" aria-hidden="true"><path d="M50,55 L20,108 M50,55 L80,108" stroke="#666" stroke-width="5"/>
        <g class="wheel"><circle cx="50" cy="55" r="44" fill="rgba(255,255,255,.35)" stroke="#e05050" stroke-width="6"/>
        ${[0, 45, 90, 135].map((d) => `<path d="M50,13 V97" stroke="#e0a0a0" stroke-width="3" transform="rotate(${d} 50 55)"/>`).join('')}
        <circle cx="50" cy="55" r="6" fill="#c03030"/></g></svg>`;
    }
    if (id === 'toy_tunnel') {
      return `<svg viewBox="0 0 120 70" aria-hidden="true"><path d="M8,66 V40 Q8,6 60,6 Q112,6 112,40 V66 Z" fill="#4a9ad8" stroke="#24507a" stroke-width="3"/>
        ${[30, 60, 90].map((x) => `<path d="M${x},7 V66" stroke="#2e6ea8" stroke-width="3"/>`).join('')}
        <ellipse cx="14" cy="50" rx="10" ry="16" fill="#1a2e40"/><ellipse cx="106" cy="50" rx="10" ry="16" fill="#1a2e40"/></svg>`;
    }
    return `<svg viewBox="0 0 40 160" aria-hidden="true"><path class="rope" d="M20,0 Q26,40 20,80 T20,150" fill="none" stroke="#b08850" stroke-width="7" stroke-linecap="round"/>
      ${[30, 60, 90, 120].map((y) => `<circle cx="20" cy="${y}" r="7" fill="#c89a60" stroke="#7a5428" stroke-width="2"/>`).join('')}</svg>`;
  }

  function drawLure() {
    let el = layer.querySelector('.sc-lure');
    if (!lure || !toy || toy.kind !== 'lure') { if (el) el.remove(); return; }
    if (!el) {
      el = html('div', 'sc-lure ' + toy.id, toy.id === 'toy_laser' ? '<i class="dot"></i>'
        : `<svg class="line" aria-hidden="true"><line/></svg><span>${ITEMS[toy.id].icon}</span>`);
      layer.append(el);
    }
    el.style.transform = `translate(${lure.x}px, ${lure.y}px)`;
    const line = el.querySelector('line');
    if (line) {
      // Schnur der Federangel vom oberen Rand bis zur Feder
      const sx = clamp(lure.x + 70, 0, geo.W) - lure.x, sy = -lure.y;
      line.setAttribute('x1', 0); line.setAttribute('y1', 0); line.setAttribute('x2', sx); line.setAttribute('y2', sy);
    }
  }

  function blow(x, y) {
    for (let i = 0; i < 4; i++) {
      const r = rand(9, 16) * (geo.H / 380);
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
    if (r.factor < 0.5) { say(a, '😑', 2200); a.bored[toy.id] = now + BORED_MS; } else say(a, r.fav ? '😍' : '♪');
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
    separate(all.filter(local), dt, now);
    draw(now);
    raf = requestAnimationFrame(tick);
  }

  function stepActor(a, p, all, dt, now) {
    if (now < a.busyUntil) { a.walking = false; return; }
    const others = all.filter((o) => o !== a && !o.hidden).map((o) => ({ key: o.id, pet: o.entry.pet, x: o.x, d: o.d, a: o }));

    // Schlafen: ins Körbchen, falls vorhanden, sonst dort, wo es gerade ist
    if (p.sleeping) {
      a.carry = false;
      if (bed) {
        const sleepers = [...actors.values()].filter((o) => local(o) && o.entry.pet.sleeping);
        const i = sleepers.indexOf(a);
        const spot = { x: BED.x + (i - (sleepers.length - 1) / 2) * 0.07, d: BED.d + (i % 2) * 0.05 };
        if (move(a, spot, speed(p) * 0.8, dt)) a.walking = false;
      } else a.walking = false;
      return;
    }

    if (toy && playToy(a, p, others, dt, now)) return;

    // Eigene Pläne: herumlaufen, sitzen, Freunde besuchen, Fangen spielen
    if (!a.plan || now > a.until) {
      const plan = reduced() ? { type: 'sit', ms: 4000 } : decide({ pet: p, x: a.x, d: a.d }, others);
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
          // Angekommen: einander anschauen, beschnuppern, Herzchen
          a.facing = o.x > a.x ? 1 : -1;
          if (!o.walking && local(o)) o.facing = -a.facing;
          say(a, pick(['❤️', '💕', '👋', '😊'])); setTimeout(() => say(o, pick(['❤️', '💕', '😊'])), 450);
          hop(a, 0.5);
          a.plan = { type: 'sit' }; a.until = now + rand(2500, 4000);
          if (local(o) && o.plan && ['wander', 'sit', 'look'].includes(o.plan.type)) { o.plan = { type: 'sit' }; o.until = now + 2500; }
        }
        break;
      }
      default: a.walking = false;
    }
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
        const fa = now < a.busyUntil ? 0 : now < b.busyUntil ? 2 : 1, fb = 2 - fa;
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
          toy.x = a.x * geo.W + a.facing * sizeOf(a) * 0.25; toy.d = a.d; toy.y = feetY(a.d) - toy.size * 0.5; toy.vx = toy.vy = 0;
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
      const size = sizeOf(a);
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
      const s = sizeOf(a);
      toy.x = a.x * geo.W + a.facing * s * 0.06; toy.y = feetY(a.d) - s * 0.42 - a.hop; toy.d = a.d;
      return;
    }
    const g = 1500 * (geo.H / 380) * (toy.glide && toy.vy > 0 && Math.abs(toy.vx) > 150 ? 0.3 : 1);
    toy.vy += g * dt;
    toy.x += toy.vx * dt; toy.y += toy.vy * dt;
    const r = toy.size / 2, ground = feetY(toy.d) - r;
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
  function draw(now) {
    for (const a of actors.values()) {
      const s = sizeOf(a);
      const fy = feetY(a.d);
      let lift = a.hop;
      if (a.el.classList.contains('climb')) lift += Math.sin(((now % 2400) / 2400) * Math.PI) * geo.H * 0.32;
      a.el.style.width = a.el.style.height = s + 'px';
      a.el.style.transform = `translate(${(a.x * geo.W - s / 2).toFixed(1)}px, ${(fy - s).toFixed(1)}px)`;
      a.el.style.zIndex = String(10 + Math.round(a.d * 100));
      const t = now / 1000;
      const sway = a.walking ? Math.sin(t * 14 + a.blink * 3) * 5 : 0;
      const bob = a.walking ? Math.abs(Math.sin(t * 14 + a.blink * 3)) * s * 0.03 : 0;
      a.body.style.transform = `translateY(${(-lift - bob).toFixed(1)}px) rotate(${sway.toFixed(1)}deg)`;
      a.flip.style.transform = `scaleX(${a.facing})`;
      a.shadow.style.transform = `scale(${clamp(1 - lift / (s * 1.4), 0.4, 1).toFixed(2)})`;
      a.el.classList.toggle('walking', a.walking);
      a.el.classList.toggle('tilt', now < a.tiltUntil);
      if (a.emoteUntil && now > a.emoteUntil) { a.emote.classList.remove('show'); a.emoteUntil = 0; }
    }
    if (toy && toy.el && toy.kind === 'throw') {
      const s = toy.size * (geo.H / 380) * scaleAt(toy.d);
      toy.el.style.fontSize = s + 'px';
      toy.el.style.transform = `translate(${toy.x - s / 2}px, ${toy.y - s / 2}px) rotate(${toy.spin.toFixed(0)}deg)`;
      toy.el.style.zIndex = String(11 + Math.round(toy.d * 100));
      toy.el.classList.toggle('carried', !!toy.carriedBy);
    }
    if (toy && toy.el && toy.kind === 'station') {
      const s = toy.size * (geo.H / 380);
      toy.el.style.width = s + 'px';
      const y = toy.id === 'toy_rope' ? 0 : feetY(toy.d) - s * (toy.id === 'toy_wheel' ? 1.1 : 0.58);
      toy.el.style.transform = `translate(${toy.x - s / 2}px, ${y}px)`;
      toy.el.style.zIndex = String(toy.id === 'toy_tunnel' ? 12 + Math.round(toy.d * 100) : 9 + Math.round(toy.d * 100));
    }
    if (bed) {
      const s = baseSize() * scaleAt(BED.d) * 1.25;
      bed.style.width = s + 'px';
      bed.style.transform = `translate(${BED.x * geo.W - s / 2}px, ${feetY(BED.d) - s * 0.3}px)`;
    }
    for (const b of bubbles) b.el.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px)`;
    drawGhosts();
  }

  // Spielzeug, mit dem andere im Live-Zimmer gerade spielen (nur zum Ansehen)
  function drawGhosts() {
    const list = hooks.remoteToys();
    for (const [key, el] of ghosts) if (!list.some((t) => t.key === key)) { el.remove(); ghosts.delete(key); }
    for (const t of list) {
      let el = ghosts.get(t.key);
      if (!el || el.dataset.id !== t.id) {
        if (el) el.remove();
        el = html('div', 'sc-toy ghost', t.id === 'toy_laser' ? '<i class="dot"></i>' : `<span>${ITEMS[t.id].icon}</span>`);
        el.dataset.id = t.id;
        layer.append(el);
        ghosts.set(t.key, el);
      }
      const s = (TOYS[t.id] ? TOYS[t.id].size : 26) * (geo.H / 380) * scaleAt(t.d);
      el.style.fontSize = s + 'px';
      el.style.transform = `translate(${t.x * geo.W - s / 2}px, ${t.y * geo.H - s / 2}px) rotate(${Math.round(t.spin)}deg)`;
      el.style.zIndex = String(11 + Math.round(t.d * 100));
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

  layer.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const p = pos(e);
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
      stroke = { id: petEl.dataset.pet, x: e.clientX, y: e.clientY, dist: 0, moved: 0 };
      layer.setPointerCapture?.(e.pointerId);
      return;
    }
    if (toy && toy.kind === 'bubbles') { blow(p.x, p.y); return; }
    if (toy && toy.kind === 'lure') { lure = p; drawLure(); layer.setPointerCapture?.(e.pointerId); }
  });

  layer.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (drag) {
      toy.x = clamp(p.x, 0, geo.W); toy.y = clamp(p.y, 0, geo.H);
      if (p.y > geo.far) toy.d = depthAt(p.y + toy.size / 2);
      drag.samples.push({ ...p, t: e.timeStamp });
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
      return;
    }
    if (stroke) {
      const dd = Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y);
      stroke.dist += dd; stroke.moved += dd; stroke.x = e.clientX; stroke.y = e.clientY;
      if (stroke.dist > 140) { stroke.dist = 0; const a = actors.get(stroke.id); if (a) hooks.stroke(a.entry); }
      return;
    }
    if (toy && toy.kind === 'lure' && (e.pointerType === 'mouse' || e.buttons)) { lure = p; drawLure(); }
  });

  const up = (e) => {
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
      if (stroke.moved < 8) { const a = actors.get(stroke.id); if (a) hooks.select(a.entry); }
      stroke = null;
    }
    if (toy && toy.kind === 'lure' && e.pointerType !== 'mouse') { lure = null; drawLure(); }
  };
  layer.addEventListener('pointerup', up);
  layer.addEventListener('pointercancel', up);
  layer.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && toy && toy.kind === 'lure') { lure = null; drawLure(); } });

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
        const icon = action === 'water' ? '💧' : (ITEMS[extra.itemId] || {}).icon || '🍖';
        const bowl = html('div', 'sc-bowl', `<span>${icon}</span>`);
        const s = sizeOf(a);
        bowl.style.width = s * 0.42 + 'px';
        bowl.style.transform = `translate(${a.x * geo.W + a.facing * s * 0.32 - s * 0.21}px, ${feetY(a.d) - s * 0.2}px)`;
        bowl.style.zIndex = String(11 + Math.round(a.d * 100));
        layer.append(bowl);
        a.busyUntil = now + 1900; a.walking = false;
        flash(a, 'eating', 1900);
        setTimeout(() => bowl.classList.add('gone'), 1700);
        setTimeout(() => bowl.remove(), 2100);
        break;
      }
      case 'pet': say(a, '❤️', 1200); hop(a, 0.35); break;
      case 'cuddle': say(a, '💞', 1800); flash(a, 'squish', 900); break;
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
    list.forEach(([text, minus, extra], i) => {
      const el = document.createElement('span');
      el.className = 'floater' + (minus ? ' minus' : '') + (extra ? ' ' + extra : '');
      el.textContent = text;
      el.style.left = `${10 + ((i * 27) % 70)}%`;
      el.style.animationDelay = `${i * 120}ms`;
      a.el.append(el);
      setTimeout(() => el.remove(), 1800 + i * 120);
    });
  }

  function mount(el) {
    host = el;
    if (layer.parentNode !== el) el.append(layer);
    sync();
    if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && host && !raf) raf = requestAnimationFrame(tick); });

  return {
    mount, sync, useToy, putAway, animate, floaters, snapshot,
    get toy() { return toy ? toy.id : null; },
    actorAt: (id) => actors.get(id),
  };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
