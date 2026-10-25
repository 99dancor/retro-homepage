// Grafik der Tiere und Räume. Die Tiere sind Pixel-Bilder (pixel.js) als SVG, damit sie überall scharf bleiben
// und auch der Server sie zeichnen kann (Kartentisch der Homepage). Die Räume sind noch Vektorgrafiken.
//   petSvg(species, colorId, face, opts)   face: 'happy' | 'ok' | 'sad' | 'sleep'
//   accSvg(id)                              ein Accessoire allein
//   roomSvg(id)                             Hintergrund eines Zimmers
import { SPECIES } from './pets.js';
import { petGrid, gridSvg, paths, grid, stamp, ell, paint, posed, boxOf } from './pixel.js';
import { iconSvg } from './icons.js';

// Farbe aufhellen (to = '#ffffff') oder abdunkeln (to = '#000000'), t von 0 bis 1
export function mix(hex, to, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = n(hex), b = n(to);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Ein Tier besteht aus Ebenen: was sich nie ändert, drei Stellungen des Schwanzes, die Augen offen und zu, und die
// Augen nach links, Mitte und rechts. Die Szene blendet sie per CSS um (Wedeln, Blinzeln, Hinschauen), ohne neu zu zeichnen.
//   opts.title: Name fürs Vorlesen   opts.acc: { head, neck, back }   opts.shine: glitzert (nach dem Bürsten)
//   opts.shadow: Schatten unter dem Tier (die Szene zeichnet ihn selbst, damit er beim Springen am Boden bleibt)
//   opts.pose: Stellung (pixel.js POSES)   opts.walk: drei Bilder fürs Laufen (Klassen pw0, pw1, pw2, per CSS im Wechsel)
const cache = new Map();
function layers(speciesId, color, face, acc, pose = 'stand') {
  const key = [speciesId, color.id, face, acc.head, acc.neck, acc.back, pose].join('|');
  if (cache.has(key)) return cache.get(key);
  const raw = petGrid(speciesId, color, { face, acc });
  const b = boxOf(raw);
  const P = (s) => posed(petGrid(speciesId, color, { face, acc, ...s }), pose, b);
  const base = posed(raw, pose, b);
  const tails = [-1, 1].map((tail) => P({ tail }));
  const open = face === 'ok' || face === 'sad';
  const shut = open ? P({ blink: true }) : null;
  const looks = open ? [-1, 1].map((look) => P({ look })) : null;
  const n = base.px.length, T = new Set(), E = new Set();
  for (let i = 0; i < n; i++) {
    if (tails.some((t) => t.px[i] !== base.px[i])) T.add(i);
    else if ((shut && shut.px[i] !== base.px[i]) || (looks && looks.some((l) => l.px[i] !== base.px[i]))) E.add(i);
  }
  const still = new Set();
  for (let i = 0; i < n; i++) if (!T.has(i) && !E.has(i)) still.add(i);
  const eyes = !E.size ? '' : looks
    ? `<g class="px-e px-open"><g class="lk lk-c">${paths(base, E)}</g><g class="lk lk-l">${paths(looks[0], E)}</g><g class="lk lk-r">${paths(looks[1], E)}</g></g><g class="px-e px-shut">${paths(shut, E)}</g>`
    : `<g class="px-e px-open">${paths(base, E)}</g><g class="px-e px-shut">${paths(shut, E)}</g>`;
  const out = `<g class="px">${paths(base, still)}</g>`
    + (T.size ? `<g class="px-t px-t0">${paths(tails[0], T)}</g><g class="px-t px-t1">${paths(base, T)}</g><g class="px-t px-t2">${paths(tails[1], T)}</g>` : '')
    + eyes;
  if (cache.size > 300) cache.clear();
  cache.set(key, out);
  return out;
}
// Schlaf-Z und Glitzern als kleine Pixelmuster
const ZZZ = (() => { const g = grid(48, 48); stamp(g, 39, 0, ['zzzz', '..z.', '.z..', 'zzzz'], { z: '#5a5ab0' }); stamp(g, 44, 5, ['zzz', '.z.', 'zzz'], { z: '#7a7ad0' }); return paths(g); })();
const SHINE = (() => {
  const g = grid(48, 48);
  for (const [x, y, r] of [[6, 8, 2], [41, 22, 1], [38, 5, 1], [9, 34, 1]]) for (let k = -r; k <= r; k++) { stamp(g, x + k, y, ['s'], { s: '#fff3a0' }); stamp(g, x, y + k, ['s'], { s: '#fff3a0' }); }
  return paths(g);
})();
const SHADOW = (() => { const g = grid(48, 48); paint(g, ell(24, 46.5, 13, 1.6), { fill: 'rgba(40,20,30,.16)', outline: false, shade: null }); return paths(g); })();

export function petSvg(speciesId, colorId, face = 'ok', { title = '', acc = {}, shine = false, shadow = true, pose = 'stand', walk = false } = {}) {
  const sp = SPECIES[speciesId];
  const color = sp.colors.find((x) => x.id === colorId) || sp.colors[0];
  const extra = (face === 'sleep' ? `<g class="zzz">${ZZZ}</g>` : '') + (shine ? `<g class="sparkle">${SHINE}</g>` : '');
  const a = acc || {};
  const body = walk && (!pose || pose === 'stand')
    ? ['stand', 'walk1', 'walk2'].map((ps, i) => `<g class="pw pw${i}">${layers(speciesId, color, face, a, ps)}</g>`).join('')
    : layers(speciesId, color, face, a, pose);
  return gridSvg({ w: 48, h: 48 }, {
    cls: `pet-svg species-${speciesId} face-${face}${walk ? ' walkable' : ''}`, label: title || sp.name,
    extra: (shadow ? `<g class="px-shadow">${SHADOW}</g>` : '') + body + extra,
  });
}

// Kleines Bild eines Accessoires für Shop und Menüs
export const accSvg = (id) => iconSvg(id, 'pxi acc-svg');

// ---------- Räume ----------
// Hintergründe in einem 400 × 300-Raster, Boden ab y = 186
const ROOMS = {
  room_living: `<rect width="400" height="186" fill="#fdf3dc"/><rect y="186" width="400" height="114" fill="#d9b98a"/>
    <path d="M0,215 H400 M0,250 H400 M0,285 H400" stroke="#c4a274" stroke-width="2"/>
    <rect x="30" y="34" width="80" height="70" fill="#bfe6ff" stroke="#8a6a40" stroke-width="6"/><path d="M70,34 V104 M30,69 H110" stroke="#8a6a40" stroke-width="4"/>
    <rect x="290" y="46" width="70" height="50" fill="#f6d06a" stroke="#8a6a40" stroke-width="5"/><circle cx="325" cy="71" r="12" fill="#e07050"/>
    <ellipse cx="200" cy="262" rx="130" ry="24" fill="#c0504d" opacity=".55"/><ellipse cx="200" cy="262" rx="112" ry="18" fill="none" stroke="#e8c0a0" stroke-width="2" stroke-dasharray="6 5" opacity=".7"/>
    <rect y="178" width="400" height="9" fill="#efe2c4" stroke="#c4a274" stroke-width="1.5"/>
    <path d="M30,34 h80 v70 h-80z" fill="url(#lvsun)" opacity=".5"/><defs><linearGradient id="lvsun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <g stroke="#2a2a2a" stroke-width="1.5" transform="translate(-232 0)"><path d="M372,186 l-6,-28 h28 l-6,28z" fill="#c8643c"/>
      <path d="M380,158 q-18,-22 -6,-44 M380,158 q2,-30 16,-40 M380,158 q-4,-20 -20,-26" fill="none" stroke="#3f8a3a" stroke-width="5" stroke-linecap="round"/></g>`,
  room_garden: `<rect width="400" height="186" fill="#bfe6ff"/><circle cx="340" cy="50" r="26" fill="#ffd84a"/>
    <g fill="#fff"><ellipse cx="90" cy="50" rx="34" ry="14"/><ellipse cx="115" cy="42" rx="22" ry="14"/><ellipse cx="230" cy="76" rx="26" ry="10"/></g>
    <g fill="#fff" stroke="#c8c8c8" stroke-width="2">${[20, 70, 120, 270, 320, 370].map((x) => `<path d="M${x - 10},186 V140 L${x},128 L${x + 10},140 V186 Z"/>`).join('')}</g>
    <rect y="150" width="400" height="8" fill="#fff"/><rect y="186" width="400" height="114" fill="#7cc65a"/>
    <g>${[[40, 230, '#ff7aa8'], [90, 270, '#ffd84a'], [330, 240, '#ff7aa8'], [365, 280, '#fff']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="7" fill="${c}"/><circle cx="${x}" cy="${y}" r="2.5" fill="#f0a020"/>`).join('')}</g>`,
  room_kids: `<rect width="400" height="186" fill="#e8f0ff"/>
    <g fill="#ffd84a">${[[50, 40], [140, 90], [260, 30], [350, 110], [210, 140]].map(([x, y]) => `<path d="M${x},${y - 9} l3,6 l7,1 l-5,5 l1,7 l-6,-3 l-6,3 l1,-7 l-5,-5 l7,-1z"/>`).join('')}</g>
    <rect y="186" width="400" height="114" fill="#f2c6d8"/>
    <g stroke="#2a2a2a" stroke-width="2"><rect x="320" y="226" width="30" height="30" fill="#e05050"/><rect x="350" y="226" width="30" height="30" fill="#4080e0"/><rect x="335" y="196" width="30" height="30" fill="#40b060"/></g>
    <circle cx="50" cy="262" r="16" fill="#ff9f40" stroke="#2a2a2a" stroke-width="2"/>`,
  room_beach: `<defs><linearGradient id="sky" x2="0" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#d8f0ff"/></linearGradient></defs>
    <rect width="400" height="150" fill="url(#sky)"/><circle cx="70" cy="56" r="24" fill="#ffd84a"/>
    <rect y="140" width="400" height="48" fill="#3fa7d6"/><path d="M0,156 q20,-8 40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0 t40,0" fill="none" stroke="#bfe8ff" stroke-width="3"/>
    <rect y="186" width="400" height="114" fill="#f3dca0"/>
    <path d="M330,186 V100" stroke="#8a6a40" stroke-width="5"/><path d="M280,110 Q330,60 380,110 Z" fill="#ff6060" stroke="#2a2a2a" stroke-width="2"/>
    <path d="M40,270 l10,-6 l10,6 l-4,10 h-12z" fill="#ff9f80" stroke="#2a2a2a" stroke-width="2"/>`,
  room_retro: `<rect width="400" height="186" fill="#008080"/>
    <g font-family="Tahoma, sans-serif" font-size="11" fill="#fff" text-anchor="middle">
      ${[[50, 46, '💻', 'Arbeitsplatz'], [50, 106, '🗑️', 'Papierkorb'], [130, 46, '📁', 'Spiele']].map(([x, y, i, t]) => `<text x="${x}" y="${y + 18}" font-size="24">${i}</text><text x="${x}" y="${y + 36}">${t}</text>`).join('')}</g>
    <rect y="186" width="400" height="114" fill="#a0a0a0"/><rect y="186" width="400" height="10" fill="#c0c0c0"/>
    <g stroke="#2a2a2a" stroke-width="2"><rect x="290" y="96" width="90" height="74" rx="4" fill="#d8d0b8"/><rect x="300" y="106" width="70" height="50" fill="#000080"/>
      <rect x="315" y="170" width="40" height="10" fill="#c8c0a8"/><rect x="280" y="180" width="110" height="10" fill="#d8d0b8"/></g>
    <text x="335" y="136" font-family="Courier New, monospace" font-size="10" fill="#fff" text-anchor="middle">C:\&gt;_</text>`,
  room_cave: `<rect width="400" height="186" fill="#3a2e34"/>
    <g fill="#55424a">${[30, 90, 150, 240, 300, 370].map((x, i) => `<path d="M${x - 18},0 L${x},${40 + (i % 3) * 18} L${x + 18},0 Z"/>`).join('')}</g>
    <g fill="#7ad8ff" opacity=".8"><path d="M60,140 l8,-16 l8,16 l-8,8z"/><path d="M330,120 l6,-12 l6,12 l-6,6z"/></g>
    <rect y="186" width="400" height="114" fill="#5a4038"/><ellipse cx="200" cy="300" rx="240" ry="40" fill="#ff7a30" opacity=".35"/>
    <g fill="#f4c430" stroke="#2a2a2a" stroke-width="2"><ellipse cx="330" cy="250" rx="30" ry="10"/><circle cx="318" cy="244" r="6"/><circle cx="334" cy="240" r="6"/><circle cx="346" cy="246" r="6"/></g>`,
};

export function roomSvg(id) {
  return `<svg class="room-bg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${ROOMS[id] || ROOMS.room_living}</svg>`;
}
