// Klänge für Pixelpfoten: Tierstimmen und Effekte, alles im Browser erzeugt (Web Audio), ohne Tondateien.
// Die Lautstärke kommt vom 🔊-Regler der Homepage (localStorage "lautstaerke": effekte 0–1, stumm).
// Läuft das Spiel allein, gilt eine mittlere Lautstärke.
export const VOLUME_KEY = 'lautstaerke';

export function readVolume(ls) {
  try {
    const v = JSON.parse(ls.getItem(VOLUME_KEY)) || {};
    const fx = Number(v.effekte);
    return { effekte: fx >= 0 && fx <= 1 ? fx : 0.5, stumm: v.stumm === true };
  } catch { return { effekte: 0.5, stumm: false }; }
}
export function setMuted(ls, stumm) {
  let v = {};
  try { v = JSON.parse(ls.getItem(VOLUME_KEY)) || {}; } catch { /* neu */ }
  try { ls.setItem(VOLUME_KEY, JSON.stringify({ ...v, stumm })); } catch { /* privat */ }
}

const ls = (() => { try { return window.localStorage; } catch { return null; } })();
let ctx = null, out = null;
function audio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  if (!ctx) { ctx = new AC(); out = ctx.createGain(); out.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Bausteine
function tone(c, t, { f, to, d, type = 'sine', v = 0.3, a = 0.01, vib = 0, filter }) {
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + d);
  if (vib) {
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = vib; lg.gain.value = f * 0.04;
    lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + d + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  let node = osc;
  if (filter) {
    const fl = c.createBiquadFilter();
    fl.type = filter.type || 'lowpass'; fl.frequency.setValueAtTime(filter.f, t); fl.Q.value = filter.q || 1;
    if (filter.to) fl.frequency.exponentialRampToValueAtTime(filter.to, t + d);
    osc.connect(fl); node = fl;
  }
  node.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + d + 0.05);
}
function noise(c, t, { d, f = 2000, to, q = 1, v = 0.2, type = 'bandpass', a = 0.005 }) {
  const len = Math.ceil(c.sampleRate * d), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (to) fl.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(fl); fl.connect(g); g.connect(out);
  src.start(t);
}
const notes = (c, t, list, o) => list.forEach((f, i) => tone(c, t + i * (o.step || 0.1), { ...o, f }));

// Tierstimmen
const VOICES = {
  cat: (c, t) => {
    tone(c, t, { f: 520, to: 760, d: 0.18, type: 'sawtooth', v: 0.12, filter: { f: 900, to: 2200, q: 4 } });
    tone(c, t + 0.17, { f: 760, to: 430, d: 0.35, type: 'sawtooth', v: 0.12, filter: { f: 2200, to: 800, q: 4 } });
  },
  dog: (c, t) => [0, 0.22].forEach((o) => { tone(c, t + o, { f: 260, to: 150, d: 0.13, type: 'square', v: 0.12, filter: { f: 1100, q: 2 } }); noise(c, t + o, { d: 0.08, f: 900, v: 0.12 }); }),
  rabbit: (c, t) => { [0, 0.09, 0.18].forEach((o) => noise(c, t + o, { d: 0.05, f: 5000, q: 3, v: 0.12 })); tone(c, t + 0.32, { f: 90, to: 50, d: 0.12, v: 0.4 }); },
  hamster: (c, t) => [0, 0.12].forEach((o) => tone(c, t + o, { f: 2600, to: 3400, d: 0.07, v: 0.12 })),
  rat: (c, t) => [0, 0.1, 0.2].forEach((o) => tone(c, t + o, { f: 3000, to: 2400, d: 0.06, v: 0.11 })),
  fox: (c, t) => [0, 0.2].forEach((o) => tone(c, t + o, { f: 700, to: 1200, d: 0.12, type: 'sawtooth', v: 0.1, filter: { f: 1800, q: 3 } })),
  axolotl: (c, t) => [0, 0.14, 0.26].forEach((o, i) => tone(c, t + o, { f: 300 + i * 120, to: 900 + i * 200, d: 0.1, v: 0.2 })),
  dragon: (c, t) => { tone(c, t, { f: 110, to: 70, d: 0.9, type: 'sawtooth', v: 0.18, vib: 9, filter: { f: 600, to: 250, q: 2 } }); noise(c, t, { d: 0.9, f: 500, to: 200, type: 'lowpass', v: 0.25, a: 0.08 }); },
};

const SOUNDS = {
  klick: (c, t) => noise(c, t, { d: 0.02, f: 2500, q: 3, v: 0.15 }),
  pop: (c, t) => tone(c, t, { f: 600, to: 1200, d: 0.07, v: 0.18 }),
  nein: (c, t) => notes(c, t, [220, 175], { d: 0.16, type: 'square', v: 0.08, step: 0.13, filter: { f: 900 } }),
  muenze: (c, t) => { tone(c, t, { f: 1760, d: 0.08, type: 'triangle', v: 0.18 }); tone(c, t + 0.07, { f: 2349, d: 0.35, type: 'triangle', v: 0.18 }); },
  fressen: (c, t) => [0, 0.14, 0.28, 0.42].forEach((o) => noise(c, t + o, { d: 0.07, f: 1800 + Math.random() * 1200, q: 1.5, v: 0.3 })),
  trinken: (c, t) => [0, 0.16, 0.32].forEach((o) => tone(c, t + o, { f: 380, to: 880, d: 0.09, v: 0.22 })),
  spielen: (c, t) => { tone(c, t, { f: 180, to: 620, d: 0.25, v: 0.2, vib: 14 }); tone(c, t + 0.28, { f: 160, to: 500, d: 0.2, v: 0.15, vib: 14 }); },
  buersten: (c, t) => [0, 0.25].forEach((o) => noise(c, t + o, { d: 0.22, f: 3000, to: 6000, type: 'highpass', v: 0.12, a: 0.06 })),
  baden: (c, t) => { for (let i = 0; i < 7; i++) tone(c, t + i * 0.08 + Math.random() * 0.04, { f: 500 + Math.random() * 700, to: 1200 + Math.random() * 800, d: 0.06, v: 0.14 }); },
  gassi: (c, t) => [0, 0.2, 0.4, 0.6].forEach((o, i) => { tone(c, t + o, { f: i % 2 ? 95 : 110, to: 60, d: 0.09, v: 0.35 }); noise(c, t + o, { d: 0.04, f: 1200, v: 0.06 }); }),
  schlafen: (c, t) => notes(c, t, [784, 659, 523, 392], { d: 0.45, type: 'triangle', v: 0.12, step: 0.28 }),
  aufwachen: (c, t) => notes(c, t, [523, 659, 784, 1047], { d: 0.18, type: 'triangle', v: 0.14, step: 0.08 }),
  herz: (c, t) => notes(c, t, [1319, 1760], { d: 0.4, v: 0.1, step: 0.09 }),
  fanfare: (c, t) => { notes(c, t, [523, 659, 784], { d: 0.16, type: 'square', v: 0.07, step: 0.12, filter: { f: 2500 } }); notes(c, t + 0.38, [523, 659, 784, 1047], { d: 0.7, type: 'triangle', v: 0.1, step: 0 }); },
  kaufen: (c, t) => { noise(c, t, { d: 0.05, f: 3000, q: 2, v: 0.2 }); notes(c, t + 0.06, [1568, 2093], { d: 0.45, v: 0.12, step: 0.05 }); },
  freude: (c, t) => notes(c, t, [659, 784, 988, 1319], { d: 0.35, v: 0.1, step: 0.09 }),
};

// Spielt einen Effekt oder mit "stimme:<art>" die Stimme eines Tiers
export function play(name) {
  if (!ls) return;
  const vol = readVolume(ls);
  if (vol.stumm || !vol.effekte) return;
  const fn = name.startsWith('stimme:') ? VOICES[name.slice(7)] : SOUNDS[name];
  if (!fn) return;
  const c = audio();
  if (!c) return;
  out.gain.value = vol.effekte;
  try { fn(c, c.currentTime + 0.01); } catch { /* alter Browser */ }
}

// Ton aus/an für den Knopf im Spiel (derselbe Wert wie „Ton aus“ an der Homepage)
export function muted() { return ls ? readVolume(ls).stumm : false; }
export function toggleMuted() { if (ls) setMuted(ls, !muted()); }

// Für die Aktion passende Klänge
const ACTION_SOUNDS = { feed: 'fressen', water: 'trinken', play: 'spielen', brush: 'buersten', bath: 'baden', walk: 'gassi', sleep: 'schlafen', wake: 'aufwachen' };
export function actionSound(action, species) {
  if (action === 'pet') return ['stimme:' + species];
  if (action === 'cuddle') return ['stimme:' + species, 'herz'];
  return ACTION_SOUNDS[action] ? [ACTION_SOUNDS[action]] : [];
}
export const SOUND_NAMES = Object.keys(SOUNDS);
export const VOICE_NAMES = Object.keys(VOICES);
