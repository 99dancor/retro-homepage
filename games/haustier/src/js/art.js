// Einfache Vektorgrafiken der Tiere, sitzend von vorn. Alle teilen sich Körper, Kopf und Gesicht;
// Ohren, Schwanz und Besonderheiten kommen je Tierart dazu.
//   petSvg(species, colorId, face)   face: 'happy' | 'ok' | 'sad' | 'sleep'
import { SPECIES } from './pets.js';
import { ITEMS } from './items.js';

const LINE = '#2a2a2a';
const rot = (deg, x, y) => `transform="rotate(${deg} ${x} ${y})"`;
const mirror = 'transform="translate(200 0) scale(-1 1)"';

// Teil links zeichnen und gespiegelt rechts wiederholen
const both = (svg) => `<g>${svg}</g><g ${mirror}>${svg}</g>`;

function eyes(face, c, y, dx = 16) {
  const xl = 100 - dx, xr = 100 + dx;
  if (face === 'happy') return `<path d="M${xl - 7},${y + 2} Q${xl},${y - 7} ${xl + 7},${y + 2}" fill="none" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M${xr - 7},${y + 2} Q${xr},${y - 7} ${xr + 7},${y + 2}" fill="none" stroke-width="3.5" stroke-linecap="round"/>`;
  if (face === 'sleep') return `<path d="M${xl - 7},${y} Q${xl},${y + 6} ${xl + 7},${y}" fill="none" stroke-width="3" stroke-linecap="round"/>
    <path d="M${xr - 7},${y} Q${xr},${y + 6} ${xr + 7},${y}" fill="none" stroke-width="3" stroke-linecap="round"/>`;
  const eye = c.eye || '#222';
  const pupil = c.eye ? `<ellipse cx="${xl}" cy="${y}" rx="2" ry="5" fill="#111" stroke="none"/><ellipse cx="${xr}" cy="${y}" rx="2" ry="5" fill="#111" stroke="none"/>` : '';
  const brows = face === 'sad'
    ? `<path d="M${xl - 8},${y - 9} L${xl + 6},${y - 14}" stroke-width="2.5" stroke-linecap="round"/><path d="M${xr + 8},${y - 9} L${xr - 6},${y - 14}" stroke-width="2.5" stroke-linecap="round"/>`
    : '';
  return `${brows}<circle cx="${xl}" cy="${y}" r="7" fill="${eye}" stroke-width="1.5"/><circle cx="${xr}" cy="${y}" r="7" fill="${eye}" stroke-width="1.5"/>${pupil}
    <circle cx="${xl + 2.5}" cy="${y - 2.5}" r="2.2" fill="#fff" stroke="none"/><circle cx="${xr + 2.5}" cy="${y - 2.5}" r="2.2" fill="#fff" stroke="none"/>`;
}

function mouth(face, y) {
  if (face === 'happy') return `<path d="M90,${y} Q100,${y + 10} 110,${y}" fill="none" stroke-width="3" stroke-linecap="round"/>`;
  if (face === 'sad') return `<path d="M91,${y + 6} Q100,${y - 2} 109,${y + 6}" fill="none" stroke-width="3" stroke-linecap="round"/>`;
  if (face === 'sleep') return `<ellipse cx="100" cy="${y + 2}" rx="3.5" ry="2.5" fill="#6a3a3a" stroke-width="1.5"/>`;
  return `<path d="M93,${y + 1} Q100,${y + 5} 107,${y + 1}" fill="none" stroke-width="3" stroke-linecap="round"/>`;
}

const blush = (face, y, dx = 30) => (face === 'happy'
  ? `<ellipse cx="${100 - dx}" cy="${y}" rx="7" ry="4" fill="#ff8fa3" opacity=".55" stroke="none"/><ellipse cx="${100 + dx}" cy="${y}" rx="7" ry="4" fill="#ff8fa3" opacity=".55" stroke="none"/>`
  : '');

const tear = (face, y, dx = 16) => (face === 'sad'
  ? `<path d="M${100 - dx - 4},${y + 8} q-4,8 0,11 q4,-3 0,-11z" fill="#6ec6ff" stroke-width="1"/>`
  : '');

const zzz = (face) => (face === 'sleep'
  ? `<g class="zzz" stroke="none" fill="#334" font-family="Tahoma, sans-serif" font-weight="bold"><text x="150" y="40" font-size="20">Z</text><text x="166" y="24" font-size="14">z</text><text x="178" y="12" font-size="10">z</text></g>`
  : '');

// Standard-Körper: sitzend, Bauch, Pfoten
function body(c, { cy = 145, rx = 48, ry = 40 } = {}) {
  return `<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="${c.main}"/>
    <ellipse cx="100" cy="${cy + 8}" rx="${rx * 0.62}" ry="${ry * 0.66}" fill="${c.belly}" stroke="none"/>
    <ellipse cx="78" cy="${cy + ry - 3}" rx="14" ry="8" fill="${c.main}"/><ellipse cx="122" cy="${cy + ry - 3}" rx="14" ry="8" fill="${c.main}"/>`;
}

// Jede Art: back (ganz hinten), ears (hinter dem Kopf), body, head, front (vor dem Kopf), face
const PARTS = {
  cat(c, face) {
    return {
      back: `<path class="tail" d="M140,170 C178,168 182,120 168,104" fill="none" stroke="${LINE}" stroke-width="16" stroke-linecap="round"/>
             <path class="tail" d="M140,170 C178,168 182,120 168,104" fill="none" stroke="${c.main}" stroke-width="11" stroke-linecap="round"/>`,
      body: body(c),
      head: `<circle cx="100" cy="85" r="42" fill="${c.main}"/>`,
      ears: both(`<path d="M64,64 L66,26 L96,48 Z" fill="${c.main}" stroke-linejoin="round"/><path d="M70,56 L71,36 L87,48 Z" fill="${c.accent}" stroke="none"/>`),
      face: `${eyes(face, c, 82)}<path d="M95,95 L105,95 L100,101 Z" fill="${c.accent}" stroke-width="1.5"/>${mouth(face, 104)}
             ${both('<path d="M58,96 L82,99 M58,106 L82,103" stroke-width="1.5" fill="none"/>')}${blush(face, 98, 32)}`,
    };
  },
  dog(c, face) {
    return {
      back: `<path class="tail wag" d="M142,160 Q172,150 170,124" fill="none" stroke="${LINE}" stroke-width="15" stroke-linecap="round"/>
             <path class="tail wag" d="M142,160 Q172,150 170,124" fill="none" stroke="${c.main}" stroke-width="10" stroke-linecap="round"/>`,
      body: body(c) + (c.id === 'spotted' ? `<ellipse cx="128" cy="132" rx="12" ry="9" fill="${c.accent}" stroke="none"/>` : ''),
      head: `<circle cx="100" cy="85" r="42" fill="${c.main}"/>` + (c.id === 'spotted' ? `<ellipse cx="117" cy="76" rx="15" ry="13" fill="${c.accent}" stroke="none"/>` : ''),
      ears: '',
      front: both(`<ellipse cx="60" cy="86" rx="13" ry="28" fill="${c.accent}" ${rot(18, 60, 86)}/>`),
      face: `${eyes(face, c, 80)}<ellipse cx="100" cy="102" rx="19" ry="13" fill="${c.belly}"/>
             <ellipse cx="100" cy="96" rx="7.5" ry="5.5" fill="#222"/>${mouth(face, 104)}
             ${face === 'happy' ? '<path d="M96,110 q4,12 8,0 z" fill="#ff7a8a" stroke-width="1.5"/>' : ''}${blush(face, 96, 31)}`,
    };
  },
  rabbit(c, face) {
    return {
      back: `<circle cx="148" cy="168" r="13" fill="#fff"/>`,
      body: body(c),
      head: `<circle cx="100" cy="88" r="40" fill="${c.main}"/>`,
      ears: both(`<ellipse cx="80" cy="32" rx="12" ry="34" fill="${c.main}" ${rot(-10, 80, 32)}/><ellipse cx="80" cy="34" rx="6" ry="25" fill="${c.accent}" stroke="none" ${rot(-10, 80, 34)}/>`),
      face: `${eyes(face, c, 86)}<ellipse cx="100" cy="99" rx="5" ry="3.5" fill="${c.accent}" stroke-width="1.5"/>
             ${face === 'sleep' ? '' : '<rect x="95" y="106" width="10" height="9" rx="1.5" fill="#fff" stroke-width="1.5"/><path d="M100,106 v9" stroke-width="1"/>'}
             ${mouth(face === 'sleep' ? 'sleep' : face, 103)}${blush(face, 102, 28)}`,
    };
  },
  hamster(c, face) {
    return {
      back: '',
      body: `<ellipse cx="100" cy="128" rx="64" ry="60" fill="${c.main}"/>
             <ellipse cx="100" cy="146" rx="40" ry="36" fill="${c.belly}" stroke="none"/>
             <ellipse cx="80" cy="185" rx="13" ry="7" fill="${c.accent}"/><ellipse cx="120" cy="185" rx="13" ry="7" fill="${c.accent}"/>
             <ellipse cx="82" cy="150" rx="9" ry="6" fill="${c.accent}"/><ellipse cx="118" cy="150" rx="9" ry="6" fill="${c.accent}"/>`,
      head: '',
      ears: both(`<circle cx="60" cy="74" r="14" fill="${c.main}"/><circle cx="60" cy="74" r="8" fill="${c.accent}" stroke="none"/>`),
      face: `${both(`<ellipse cx="66" cy="118" rx="18" ry="14" fill="${c.belly}" stroke="none"/>`)}
             ${eyes(face, c, 100, 18)}<ellipse cx="100" cy="112" rx="5" ry="3.5" fill="${c.accent}" stroke-width="1.5"/>${mouth(face, 117)}
             ${blush(face, 118, 34)}`,
    };
  },
  rat(c, face) {
    return {
      back: `<path d="M140,172 C185,175 190,135 172,120" fill="none" stroke="${LINE}" stroke-width="8" stroke-linecap="round"/>
             <path d="M140,172 C185,175 190,135 172,120" fill="none" stroke="${c.accent}" stroke-width="4.5" stroke-linecap="round"/>`,
      body: body(c, { cy: 148, rx: 44, ry: 38 }),
      head: `<ellipse cx="100" cy="88" rx="38" ry="36" fill="${c.main}"/><ellipse cx="100" cy="108" rx="20" ry="14" fill="${c.main}"/>`,
      ears: both(`<circle cx="64" cy="58" r="20" fill="${c.main}"/><circle cx="64" cy="58" r="12" fill="${c.accent}" stroke="none"/>`),
      face: `${eyes(face, c, 84, 15)}<circle cx="100" cy="114" r="5" fill="${c.accent}" stroke-width="1.5"/>
             ${both('<path d="M66,108 L88,111 M66,118 L88,115" stroke-width="1.3" fill="none"/>')}${mouth(face, 120)}${blush(face, 100, 28)}`,
    };
  },
  fox(c, face) {
    return {
      back: `<ellipse cx="156" cy="140" rx="22" ry="44" fill="${c.main}" ${rot(35, 156, 140)}/>
             <ellipse cx="176" cy="112" rx="11" ry="15" fill="#fff" ${rot(35, 176, 112)}/>`,
      body: body(c),
      head: `<circle cx="100" cy="86" r="42" fill="${c.main}"/><path d="M60,96 Q100,74 140,96 Q130,124 100,128 Q70,124 60,96 Z" fill="${c.belly}" stroke="none"/>`,
      ears: both(`<path d="M62,66 L60,18 L98,46 Z" fill="${c.main}"/><path d="M61,30 L60,18 L72,27 Z" fill="${c.accent}" stroke="none"/>`),
      face: `${eyes(face, c, 84)}<ellipse cx="100" cy="104" rx="6" ry="4.5" fill="#222"/>${mouth(face, 110)}${blush(face, 100, 30)}`,
    };
  },
  axolotl(c, face) {
    const frond = (y, deg) => `<ellipse cx="44" cy="${y}" rx="14" ry="6" fill="${c.accent}" ${rot(deg, 56, y)}/>`;
    return {
      back: `<path class="tail wag" d="M138,170 C175,175 190,150 186,128 C170,140 160,150 138,152 Z" fill="${c.main}"/>`,
      body: body(c, { cy: 150, rx: 44, ry: 36 }),
      head: `<ellipse cx="100" cy="92" rx="54" ry="40" fill="${c.main}"/>`,
      ears: both(frond(70, 25) + frond(88, 0) + frond(106, -25)),
      face: `${eyes(face, c, 88, 26)}<path d="M74,${face === 'sad' ? 112 : 104} Q100,${face === 'sad' ? 102 : 120} 126,${face === 'sad' ? 112 : 104}" fill="none" stroke-width="3" stroke-linecap="round"/>
             ${blush(face, 102, 38)}`,
    };
  },
  dragon(c, face) {
    return {
      back: `${both(`<path d="M62,120 C30,92 14,104 18,130 C30,124 38,130 40,140 C48,132 56,136 62,146 Z" fill="${c.belly}"/>`)}
             <path d="M140,170 C178,172 186,140 176,118" fill="none" stroke="${LINE}" stroke-width="16" stroke-linecap="round"/>
             <path d="M140,170 C178,172 186,140 176,118" fill="none" stroke="${c.main}" stroke-width="11" stroke-linecap="round"/>
             <path d="M168,110 L186,104 L180,122 Z" fill="${c.main}"/>`,
      body: body(c) + `<path d="M84,128 h32 M82,142 h36 M84,156 h32" stroke-width="1.5" opacity=".5"/>`,
      head: `<circle cx="100" cy="86" r="42" fill="${c.main}"/>`,
      ears: both(`<path d="M74,52 L66,22 L88,46 Z" fill="${c.accent}"/>`) + `<path d="M94,44 L100,32 L106,44 Z" fill="${c.accent}"/>`,
      face: `${eyes(face, c, 82)}<ellipse cx="100" cy="104" rx="20" ry="12" fill="${c.belly}"/>
             <circle cx="93" cy="101" r="2" fill="#222" stroke="none"/><circle cx="107" cy="101" r="2" fill="#222" stroke="none"/>${mouth(face, 108)}${blush(face, 96, 31)}`,
    };
  },
};

// Ankerpunkte je Art für Accessoires: Kopf (oben, Breite), Augen (Höhe, Abstand), Hals (Höhe, Breite), Körper
const ANCHOR = {
  cat: { top: 44, w: 84, eyeY: 82, dx: 16, neckY: 123, neckW: 62, body: [145, 48, 40] },
  dog: { top: 44, w: 84, eyeY: 80, dx: 16, neckY: 123, neckW: 62, body: [145, 48, 40] },
  rabbit: { top: 49, w: 80, eyeY: 86, dx: 16, neckY: 125, neckW: 58, body: [145, 48, 40] },
  hamster: { top: 67, w: 92, eyeY: 100, dx: 18, neckY: 142, neckW: 92, body: [128, 64, 62], sweater: [162, 56, 26] },
  rat: { top: 53, w: 76, eyeY: 84, dx: 15, neckY: 125, neckW: 56, body: [148, 44, 38] },
  fox: { top: 45, w: 84, eyeY: 84, dx: 16, neckY: 125, neckW: 62, body: [145, 48, 40] },
  axolotl: { top: 53, w: 100, eyeY: 88, dx: 26, neckY: 131, neckW: 64, body: [150, 44, 36] },
  dragon: { top: 45, w: 84, eyeY: 82, dx: 16, neckY: 123, neckW: 62, body: [145, 48, 40] },
};

// Kopfschmuck in einem Raster: Mitte oben am Kopf = (0,0), Kopfbreite 84
const HEAD = {
  acc_beanie: '<path d="M-40,14 Q-42,-26 0,-28 Q42,-26 40,14 Z" fill="#3a6fd8"/><rect x="-43" y="4" width="86" height="13" rx="6" fill="#2a55b0"/><circle cx="0" cy="-30" r="8" fill="#fff"/>',
  acc_partyhat: '<path d="M-20,8 L0,-50 L20,8 Z" fill="#ff6fae"/><path d="M-13,-12 L13,-12 M-7,-30 L7,-30" stroke="#fff" stroke-width="4"/><circle cx="0" cy="-52" r="6" fill="#ffd84a"/>',
  acc_crown: '<path d="M-26,8 L-26,-20 L-13,-6 L0,-26 L13,-6 L26,-20 L26,8 Z" fill="#f4c430"/><circle cx="0" cy="-2" r="4" fill="#e03050" stroke-width="1.5"/><circle cx="-15" cy="1" r="3" fill="#3080e0" stroke-width="1.5"/><circle cx="15" cy="1" r="3" fill="#3080e0" stroke-width="1.5"/>',
  acc_santa: '<path d="M-38,8 Q-14,-50 36,-32 L32,-22 Q2,-30 38,8 Z" fill="#d82828"/><rect x="-43" y="2" width="86" height="13" rx="6" fill="#fff"/><circle cx="35" cy="-29" r="7" fill="#fff"/>',
  acc_bow: '<g transform="translate(22 8)"><path d="M0,0 L-15,-11 L-15,11 Z" fill="#ff5c8a"/><path d="M0,0 L15,-11 L15,11 Z" fill="#ff5c8a"/><circle r="4.5" fill="#e0306a"/></g>',
  acc_flowers: [-150, -125, -100, -80, -55, -30].map((deg, i) => {
    const a = (deg * Math.PI) / 180, x = 42 * Math.cos(a), y = 42 + 42 * Math.sin(a);
    const c = ['#ff8fb8', '#fff27a', '#ffffff'][i % 3];
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${c}" stroke-width="1.5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#f0a020" stroke="none"/>`;
  }).join(''),
};

// Halsschmuck: Mitte vorne am Hals = (0,0), Halsbreite 60
const NECK = {
  collar: (c) => `<rect x="-30" y="-5" width="60" height="10" rx="5" fill="${c}"/><circle cx="0" cy="9" r="4.5" fill="#f4c430" stroke-width="1.5"/>`,
  acc_bell: '<rect x="-30" y="-5" width="60" height="10" rx="5" fill="#d03030"/><circle cx="0" cy="10" r="7" fill="#f4c430"/><path d="M-3,13 h6" stroke-width="1.5"/>',
  acc_bowtie: '<path d="M0,0 L-18,-10 L-18,10 Z" fill="#c02040"/><path d="M0,0 L18,-10 L18,10 Z" fill="#c02040"/><rect x="-4" y="-5" width="8" height="10" rx="2" fill="#901030"/>',
  acc_scarf: '<path d="M-14,0 L14,0 L0,28 Z" fill="#e8a020"/><rect x="-32" y="-6" width="64" height="11" rx="5" fill="#f0b030"/><path d="M-26,-1 h52" stroke="#c07010" stroke-width="2"/>',
  acc_homepage: '<path d="M-15,0 L15,0 L0,30 Z" fill="#008080"/><rect x="-32" y="-6" width="64" height="11" rx="5" fill="#008080"/><rect x="-6" y="4" width="12" height="10" fill="#fff" stroke-width="1.2"/><rect x="-6" y="4" width="12" height="3" fill="#000080" stroke="none"/>',
};

function headAcc(id, a) {
  if (id === 'acc_sunglasses') {
    const k = a.dx / 16;
    return `<g transform="translate(100 ${a.eyeY}) scale(${k})"><rect x="-27" y="-8" width="22" height="15" rx="5" fill="#111"/><rect x="5" y="-8" width="22" height="15" rx="5" fill="#111"/>
      <path d="M-5,-3 Q0,-7 5,-3" fill="none" stroke-width="2.5"/><path d="M-22,-4 l6,-2 M10,-4 l6,-2" stroke="#fff" stroke-width="2" opacity=".6"/></g>`;
  }
  return HEAD[id] ? `<g transform="translate(100 ${a.top}) scale(${(a.w / 84).toFixed(3)})">${HEAD[id]}</g>` : '';
}

function neckAcc(id, a) {
  const shape = id.startsWith('acc_collar') ? NECK.collar(ITEMS[id].color) : NECK[id];
  return shape ? `<g transform="translate(100 ${a.neckY}) scale(${(a.neckW / 60).toFixed(3)})">${shape}</g>` : '';
}

function backAcc(id, a, layer) {
  const [cy, rx, ry] = a.body;
  if (id === 'acc_sweater' && layer === 'over') {
    const [sy, sx, sr] = a.sweater || [cy - 4, rx * 0.97, ry * 0.8];
    return `<ellipse cx="100" cy="${sy}" rx="${sx}" ry="${sr}" fill="#c84040"/>
      <path d="M${100 - sx * 0.82},${sy + 8} H${100 + sx * 0.82} M${100 - sx * 0.88},${sy - 6} H${100 + sx * 0.88}" stroke="#f0d0d0" stroke-width="4" opacity=".8"/>`;
  }
  if (id === 'acc_cape' && layer === 'behind') {
    return `<path d="M${100 - rx * 0.7},${a.neckY} Q${100 - rx * 1.4},${cy + ry} ${100 - rx * 1.25},${cy + ry + 4} L${100 + rx * 1.25},${cy + ry + 4} Q${100 + rx * 1.4},${cy + ry} ${100 + rx * 0.7},${a.neckY} Z" fill="#8030c0"/>`;
  }
  if (id === 'acc_wings' && layer === 'behind') {
    const wing = `<path d="M${100 - rx * 0.6},${cy - ry * 0.4} C${100 - rx * 2},${cy - ry * 1.6} ${100 - rx * 2.1},${cy + ry * 0.2} ${100 - rx * 0.7},${cy + ry * 0.3} Z" fill="#fff"/>
      <path d="M${100 - rx * 1.2},${cy - ry * 0.5} q-10,10 -6,24 M${100 - rx * 1.55},${cy - ry * 0.6} q-8,12 -4,26" fill="none" stroke="#a8c8f0" stroke-width="2"/>`;
    return both(wing);
  }
  return '';
}

export function petSvg(speciesId, colorId, face = 'ok', { title = '', acc = {}, shine = false } = {}) {
  const sp = SPECIES[speciesId];
  const c = sp.colors.find((x) => x.id === colorId) || sp.colors[0];
  const p = PARTS[speciesId](c, face);
  const a = ANCHOR[speciesId];
  const back = acc.back ? backAcc(acc.back, a, 'behind') : '';
  const over = acc.back ? backAcc(acc.back, a, 'over') : '';
  const sparkle = shine ? '<g class="sparkle" stroke="none" fill="#fff8b0"><path d="M40,60 l4,10 l10,4 l-10,4 l-4,10 l-4,-10 l-10,-4 l10,-4z"/><path d="M160,120 l3,7 l7,3 l-7,3 l-3,7 l-3,-7 l-7,-3 l7,-3z"/><path d="M150,40 l2,5 l5,2 l-5,2 l-2,5 l-2,-5 l-5,-2 l5,-2z"/></g>' : '';
  return `<svg class="pet-svg species-${speciesId} face-${face}" viewBox="0 0 200 200" role="img" aria-label="${title || sp.name}" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="100" cy="190" rx="58" ry="7" fill="rgba(0,0,0,.15)"/>
    <g stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round">
      ${p.back}${back}${p.ears}${p.body}${over}${p.head}${p.front || ''}<g class="face" stroke="${c.faceLine || LINE}">${p.face}${tear(face, 82)}</g>
      ${acc.neck ? neckAcc(acc.neck, a) : ''}${acc.head ? headAcc(acc.head, a) : ''}
    </g>${sparkle}${zzz(face)}</svg>`;
}

// Kleines Bild eines Accessoires für Shop und Inventar
export function accSvg(id) {
  const item = ITEMS[id];
  const a = { top: 60, w: 84, eyeY: 100, dx: 16, neckY: 96, neckW: 60, body: [120, 48, 40] };
  let inner;
  if (item.slot === 'head') inner = id === 'acc_sunglasses' ? headAcc(id, a) : `<g transform="translate(0 0)">${headAcc(id, a)}</g>`;
  else if (item.slot === 'neck') inner = neckAcc(id, a);
  else inner = backAcc(id, a, 'behind') + backAcc(id, a, 'over');
  const vb = item.slot === 'head' ? '40 0 120 110' : item.slot === 'neck' ? '55 70 90 70' : '0 60 200 120';
  return `<svg class="acc-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><g stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round">${inner}</g></svg>`;
}

// ---------- Räume ----------
// Hintergründe in einem 400 × 300-Raster, Boden ab y = 186
const ROOMS = {
  room_living: `<rect width="400" height="186" fill="#fdf3dc"/><rect y="186" width="400" height="114" fill="#d9b98a"/>
    <path d="M0,215 H400 M0,250 H400 M0,285 H400" stroke="#c4a274" stroke-width="2"/>
    <rect x="30" y="34" width="80" height="70" fill="#bfe6ff" stroke="#8a6a40" stroke-width="6"/><path d="M70,34 V104 M30,69 H110" stroke="#8a6a40" stroke-width="4"/>
    <rect x="290" y="46" width="70" height="50" fill="#f6d06a" stroke="#8a6a40" stroke-width="5"/><circle cx="325" cy="71" r="12" fill="#e07050"/>
    <ellipse cx="200" cy="262" rx="130" ry="24" fill="#c0504d" opacity=".55"/>`,
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
