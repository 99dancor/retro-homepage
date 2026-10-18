// Lauf-Minispiel für Ausflüge und den Tageswettbewerb: zeichnet einen Lauf aus trip.js mit requestAnimationFrame.
// Die Regeln (Bewegung, Zusammenstöße, Punkte) stehen in trip.js, hier geht es nur um Bild, Ton und Eingabe.
//
//   createRun(host, { pet, course, levels, title, sound, onEnd })
//     onEnd(run | null): run ist der fertige Lauf aus trip.js, null wenn abgebrochen
//   Gibt { stop() } zurück.
import { newRun, stepRun, scoreOf, PLACES, OBSTACLES, PICKUPS } from './trip.js';
import { petSvg } from './art.js';

const STEP = 1 / 120;          // feste Schrittweite, damit der Lauf auf jedem Bildschirm gleich läuft
const VIEW_H = 300;            // Strecken-Einheiten pro Bildhöhe

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// Hügel im Hintergrund und Weg im Vordergrund, nebeneinander gekachelt
function hillsSvg(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120" viewBox="0 0 600 120">
    <path d="M0,120 V70 Q60,30 130,62 T260,50 T400,66 T520,40 T600,70 V120 Z" fill="${p.hills}"/>
    <path d="M0,120 V92 Q80,70 170,90 T340,84 T480,94 T600,92 V120 Z" fill="${p.hills}" opacity=".6"/></svg>`;
}
function groundSvg(p) {
  const tufts = [40, 170, 310, 450, 560].map((x) => `<path d="M${x},10 l4,-8 l3,8 l4,-6 l2,6" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80" viewBox="0 0 600 80">
    <rect width="600" height="80" fill="${p.ground}"/><rect y="14" width="600" height="20" fill="${p.path}"/>
    <path d="M0,24 h600" stroke="rgba(0,0,0,.08)" stroke-width="3" stroke-dasharray="26 34"/>${tufts}</svg>`;
}

export function createRun(host, { pet, course, levels, title = '', sound = () => {}, onEnd }) {
  const p = PLACES[course.place];
  host.innerHTML = `<div class="run" tabindex="0" role="application" aria-label="Lauf: ${title}. Leertaste oder Tippen zum Springen.">
      <div class="run-hills"></div><div class="run-ground"></div><div class="run-things"></div>
      <div class="run-pet sp running"><div class="sp-body">${petSvg(pet.species, pet.color, 'happy', { acc: pet.acc, shadow: false })}</div></div>
      <div class="run-hud"><span class="run-title">${title}</span>
        <span class="run-bar"><i></i></span>
        <span class="run-count">${PICKUPS.treat.icon} <b data-c="treat">0</b> ${PICKUPS.coin.icon} <b data-c="coin">0</b> ${PICKUPS.sniff.icon} <b data-c="sniff">0</b></span>
        <span class="run-score">0</span></div>
      <div class="run-msg">Bereit?</div>
      <button type="button" class="small run-quit">✖ Abbrechen</button>
    </div>`;
  const el = host.firstElementChild;
  el.style.setProperty('--sky1', p.sky[0]);
  el.style.setProperty('--sky2', p.sky[1]);
  const q = (s) => el.querySelector(s);
  const hills = q('.run-hills'), ground = q('.run-ground'), layer = q('.run-things'), petEl = q('.run-pet');
  const msg = q('.run-msg'), bar = q('.run-bar i'), scoreEl = q('.run-score');
  hills.style.backgroundImage = svgUrl(hillsSvg(p));
  ground.style.backgroundImage = svgUrl(groundSvg(p));

  const r = newRun(course, levels);
  const els = new Map();       // id -> Element der sichtbaren Dinge
  let raf = 0, last = 0, acc = 0, jump = false, startAt = 0, ended = false, finishedAt = 0, go = false;
  let W = 600, H = 300, k = 1, groundY = 234, petX = 130;

  const measure = () => {
    W = el.clientWidth || 600; H = el.clientHeight || 300;
    k = H / VIEW_H; groundY = H * 0.78; petX = Math.min(W * 0.22, 160 * k);
  };
  measure();

  function thingEl(t) {
    const d = document.createElement('div');
    if (t.kind === 'obstacle') {
      const o = OBSTACLES[t.type];
      d.className = 'run-thing obstacle ' + t.type;
      d.textContent = o.icon;
      d.style.width = o.w * k + 'px';
      d.style.fontSize = Math.max(o.w, o.h) * 0.95 * k + 'px';
      if (t.type === 'puddle') d.textContent = '';
    } else {
      d.className = 'run-thing pickup ' + t.type;
      d.textContent = PICKUPS[t.type].icon;
      d.style.fontSize = 28 * k + 'px';
    }
    layer.append(d);
    return d;
  }

  function float(text, cls = '') {
    const f = document.createElement('div');
    f.className = 'run-float ' + cls;
    f.textContent = text;
    f.style.left = petX + 'px';
    f.style.top = groundY - (r.y + 110) * k + 'px';
    el.append(f);
    setTimeout(() => f.remove(), 1000);
  }

  function draw() {
    const view0 = r.x - petX / k - 80, view1 = r.x + (W - petX) / k + 80;
    for (const t of course.things) {
      if (t.x > view1) break;
      let d = els.get(t.id);
      if (t.x < view0) { if (d) { d.remove(); els.delete(t.id); } continue; }
      if (!d) { if (t.kind === 'pickup' && r.taken.has(t.id)) continue; d = thingEl(t); els.set(t.id, d); }
      const sx = petX + (t.x - r.x) * k;
      d.style.transform = `translate(${sx}px, ${groundY - t.y * k}px)`;
    }
    hills.style.backgroundPositionX = `${-r.x * 0.25 * k}px`;
    ground.style.backgroundPositionX = `${-r.x * k}px`;
    const s = 84 * k;
    petEl.style.width = s + 'px';
    petEl.style.transform = `translate(${petX - s / 2}px, ${groundY - s - r.y * k + s * 0.06}px) rotate(${r.y > 0 ? Math.max(-12, Math.min(12, -r.vy / 60)) : 0}deg)`;
    petEl.classList.toggle('air', r.y > 0);
    bar.style.width = Math.min(100, (100 * r.x) / course.length) + '%';
    scoreEl.textContent = scoreOf(r, course).toLocaleString('de-DE');
  }

  function handle(ev) {
    for (const e of ev) {
      if (e.type === 'jump') sound('sprung');
      if (e.type === 'pickup') {
        const d = els.get(e.thing.id);
        if (d) { d.classList.add('taken'); setTimeout(() => { d.remove(); els.delete(e.thing.id); }, 400); }
        q(`[data-c="${e.thing.type}"]`).textContent = r[e.thing.type];
        float(`+${PICKUPS[e.thing.type].points}`, e.thing.type);
        sound(e.thing.type === 'coin' ? 'muenze' : 'pop');
      }
      if (e.type === 'hit') {
        const d = els.get(e.thing.id);
        if (d) d.classList.add('hit');
        petEl.classList.remove('stumble'); void petEl.offsetWidth; petEl.classList.add('stumble');
        float('Autsch!', 'hit');
        sound('stolpern');
      }
      if (e.type === 'finish') { finishedAt = performance.now(); msg.textContent = '🏁 Ziel!'; msg.hidden = false; sound('ziel'); }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (now < startAt) {
      const n = Math.ceil((startAt - now) / 700);
      if (msg.textContent !== String(n)) { msg.textContent = String(n); sound('klick'); }
      draw();
      return;
    }
    if (!r.done) {
      if (!go) { go = true; msg.textContent = 'Los!'; setTimeout(() => { if (!finishedAt) msg.hidden = true; }, 500); }
      acc += dt;
      while (acc >= STEP && !r.done) {
        handle(stepRun(r, course, STEP, jump));
        jump = false;
        acc -= STEP;
      }
    } else {
      // Nach dem Ziel läuft das Tier aus dem Bild
      r.x += 180 * dt;
      if (!ended && now - finishedAt > 900) { ended = true; stop(); onEnd(r); return; }
    }
    draw();
  }

  const press = () => { if (performance.now() >= startAt && !r.done) jump = true; };
  const onKey = (e) => {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); if (!e.repeat) press(); }
    if (e.key === 'Escape') quit();
  };
  const onDown = (e) => { if (e.button > 0 || e.target.closest('.run-quit')) return; e.preventDefault(); press(); };
  function quit() { if (ended) return; ended = true; stop(); onEnd(null); }
  function stop() {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', measure);
  }

  el.addEventListener('pointerdown', onDown);
  q('.run-quit').addEventListener('click', quit);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', measure);
  el.focus({ preventScroll: true });
  startAt = performance.now() + 2100;
  raf = requestAnimationFrame(frame);
  return { stop: () => { ended = true; stop(); }, run: r };
}
