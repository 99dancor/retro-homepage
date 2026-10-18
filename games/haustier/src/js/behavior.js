// Verhalten der Tiere im Zimmer: reine Funktionen, damit sie unter Node testbar sind.
// Positionen sind relativ: x von 0 (links) bis 1 (rechts), d (Tiefe) von 0 (hinten) bis 1 (vorn).
import { ITEMS, usableBy } from './items.js';
import { mood } from './pets.js';

// Wie man mit einem Spielzeug spielt
//   throw:   ziehen und loslassen zum Werfen, die Tiere jagen hinterher
//   lure:    folgt der Maus oder dem Finger, die Tiere jagen danach
//   bubbles: Tippen pustet Seifenblasen, die Tiere springen danach
//   station: steht im Zimmer, Antippen lässt ein Tier damit spielen
//   bounce: wie stark es springt, roll: rollt am Boden weiter, size: Größe in px (bei 1 = normaler Zimmergröße)
export const TOYS = {
  toy_ball: { kind: 'throw', bounce: 0.62, roll: 0.985, size: 26, hint: 'Zieh den Ball und lass ihn los, um ihn zu werfen.' },
  toy_yarn: { kind: 'throw', bounce: 0.3, roll: 0.99, size: 28, hint: 'Zieh das Wollknäuel und lass es rollen.' },
  toy_duck: { kind: 'throw', bounce: 0.45, roll: 0.95, size: 28, hint: 'Wirf die Quietsche-Ente durchs Zimmer.' },
  toy_frisbee: { kind: 'throw', bounce: 0.2, roll: 0.9, size: 34, glide: true, hint: 'Wirf die Frisbee, sie segelt ein Stück.' },
  toy_plush: { kind: 'throw', bounce: 0.15, roll: 0.85, size: 34, hint: 'Wirf das Plüschtier, dann wird gekuschelt.' },
  toy_puzzle: { kind: 'throw', bounce: 0.4, roll: 0.97, size: 30, hint: 'Roll den Futterball, dein Tier holt sich die Leckerlis raus.' },
  toy_feather: { kind: 'lure', size: 30, hint: 'Beweg die Federangel mit der Maus oder dem Finger.' },
  toy_laser: { kind: 'lure', size: 12, hint: 'Führ den Laserpunkt durchs Zimmer.' },
  toy_stick: { kind: 'lure', size: 30, gnaw: true, hint: 'Halte den Knabberstab hin, dein Tier knabbert daran.' },
  toy_bubbles: { kind: 'bubbles', size: 26, hint: 'Tipp ins Zimmer, um Seifenblasen zu pusten.' },
  toy_wheel: { kind: 'station', size: 90, hint: 'Tipp das Laufrad an und dreh es mit Schwung.' },
  toy_tunnel: { kind: 'station', size: 100, hint: 'Tipp den Tunnel an, dann flitzt dein Tier hindurch.' },
  toy_rope: { kind: 'station', size: 110, hint: 'Tipp das Seil an, dann klettert dein Tier hinauf.' },
};

export const toyKind = (id) => (TOYS[id] ? TOYS[id].kind : null);

// Bleibt ein Tier stehen, wenn es diesen Abstand (relativ zur Zimmerbreite) erreicht hat
export const ARRIVE = 0.02;
// So nah muss ein Tier an ein Spielzeug, um es zu fangen
export const CATCH_X = 0.07;
export const CATCH_D = 0.25;

// Geschwindigkeit in Zimmerbreiten pro Sekunde, abhängig von Laune und Absicht
export function speed(pet, purpose = 'walk') {
  const m = mood(pet);
  const base = purpose === 'chase' ? 0.42 : purpose === 'run' ? 0.3 : 0.11;
  if (m.face === 'sad') return base * 0.55;
  if (m.face === 'happy') return base * 1.15;
  return base;
}

// Wer will gerade mitspielen? Wache Tiere, die das Spielzeug benutzen können und nicht zu müde sind.
//   bored: Tier-ids, die gerade genug von diesem Spielzeug haben
export function wantsToPlay(pet, itemId, bored = new Set()) {
  if (pet.sleeping || bored.has(pet.id)) return false;
  if (!ITEMS[itemId] || !usableBy(ITEMS[itemId], pet.species)) return false;
  return pet.stats.rest >= 15;
}

const clamp01 = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// Nächster Zug eines Tieres, das gerade nichts zu tun hat.
//   me:     { pet, x, d }
//   others: dieselbe Form für die anderen Tiere, dazu key (Schlüssel in der Szene, sonst gilt pet.id).
//           Tiere anderer Mitglieder im Live-Zimmer haben keine Werte (stats) und spielen nicht Fangen.
//   rng:    Zufall (für Tests austauschbar)
// Gibt { type, x?, d?, with?, ms } zurück. type: sleep | sit | look | wander | visit | chase | nap
export function decide(me, others, rng = Math.random) {
  const { pet } = me;
  if (pet.sleeping) return { type: 'sleep', ms: 4000 };
  const m = mood(pet);
  const awake = others.filter((o) => !o.pet.sleeping);
  const r = rng();
  // Müde Tiere dösen eher, traurige sitzen eher herum
  if (pet.stats.rest < 25 && r < 0.5) return { type: 'nap', ms: 5000 + rng() * 4000 };
  if (m.face === 'sad' && r < 0.55) return { type: 'sit', ms: 3000 + rng() * 3000 };
  if (awake.length && r < (m.face === 'happy' ? 0.42 : 0.3)) {
    const o = awake[Math.floor(rng() * awake.length)];
    // Gute Laune und genug Energie: Fangen spielen statt nur Hallo sagen
    const id = o.key ?? o.pet.id;
    if (pet.stats.fun < 85 && pet.stats.rest > 40 && o.pet.stats && o.pet.stats.rest > 40 && rng() < 0.35) return { type: 'chase', with: id, ms: 3500 };
    return { type: 'visit', with: id, ms: 6000 };
  }
  if (r < 0.75) return { type: 'wander', x: clamp01(0.1 + rng() * 0.8), d: clamp01(rng()), ms: 7000 };
  if (r < 0.88) return { type: 'look', ms: 1800 + rng() * 1500 };
  return { type: 'sit', ms: 2500 + rng() * 3000 };
}

// Platz neben einem anderen Tier (links oder rechts davon, je nachdem, wo mehr Platz ist)
export function besides(other, gap = 0.2) {
  const side = other.x > 0.5 ? -1 : 1;
  return { x: clamp01(other.x + side * gap, 0.08, 0.92), d: other.d };
}

// Einen Schritt Richtung Ziel. Gibt { x, d, arrived } zurück.
export function stepTowards(pos, target, dist) {
  const dx = target.x - pos.x, dd = (target.d - pos.d) * 0.5;   // Tiefe zählt nur halb (wirkt sonst zu schnell)
  const len = Math.hypot(dx, dd);
  if (len <= Math.max(ARRIVE, dist)) return { x: target.x, d: target.d, arrived: true };
  return { x: pos.x + (dx / len) * dist, d: pos.d + ((dd / len) * dist) / 0.5, arrived: false };
}

// Erreicht das Tier das Spielzeug? toy: { x, d, air } (air: Höhe über dem Boden in Zimmerhöhen)
export function canCatch(pos, toy, reach = 0.18) {
  return Math.abs(pos.x - toy.x) < CATCH_X && Math.abs(pos.d - toy.d) < CATCH_D && (toy.air || 0) < reach;
}
