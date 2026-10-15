import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, parse, serialize } from '../src/js/state.js';
import { SPECIES, adopt, tickPet, doAction, canDo, mood, isUnlocked, petSlots, CUDDLE_LOVE, LEVEL_XP, level, FLOOR } from '../src/js/pets.js';
import { petSvg } from '../src/js/art.js';

const H = 3600000;
const T0 = Date.UTC(2026, 9, 1, 12);

function withPet(species = 'cat') {
  const s = newState(T0);
  const r = adopt(s, species, null, 'Testi', T0);
  assert.ok(r.ok);
  return { s, pet: r.pet };
}

test('Adoption: Starttier, Startausstattung, gesperrte Tiere und Plätze', () => {
  const s = newState(T0);
  assert.equal(adopt(s, 'dragon', null, 'X', T0).ok, false);
  assert.ok(adopt(s, 'dog', 'golden', '<b>Bello</b>', T0).ok);
  assert.equal(s.pets[0].name, 'bBello/b');
  assert.equal(s.pets[0].color, 'golden');
  assert.equal(s.inventory.toy_ball, 1);
  assert.equal(s.inventory.food_dry, 5);
  assert.equal(adopt(s, 'cat', null, 'Mimi', T0).ok, false, 'nur ein Platz am Anfang');
  s.pets[0].xp = LEVEL_XP[4];   // Stufe 5
  assert.equal(level(s.pets[0]), 5);
  assert.equal(petSlots(s), 2);
  assert.ok(adopt(s, 'cat', null, 'Mimi', T0).ok);
  assert.equal(s.inventory.food_dry, 5, 'Startausstattung nur einmal');
  s.extraSlots = 1;
  assert.equal(petSlots(s), 3);
  s.visits.best = 3;
  assert.ok(isUnlocked('fox', s));
  assert.ok(!isUnlocked('axolotl', s));
});

test('Zeit: Werte sinken, auch über Tage, aber nie unter 0', () => {
  const { pet } = withPet();
  const before = { ...pet.stats };
  tickPet(pet, T0 + 4 * H);
  assert.ok(pet.stats.food < before.food && pet.stats.water < before.water && pet.stats.fun < before.fun);
  tickPet(pet, T0 + 30 * 24 * H);
  for (const v of Object.values(pet.stats)) assert.ok(v >= 0 && v <= 100);
  assert.equal(pet.stats.food, FLOOR, 'durch Zeit nie unter 10');
  assert.equal(mood(pet).face === 'sad' || pet.sleeping, true);
});

test('Zeit: rückwärts laufende Uhr ändert nichts', () => {
  const { pet } = withPet();
  const before = JSON.stringify(pet.stats);
  assert.equal(tickPet(pet, T0 - H), 0);
  assert.equal(JSON.stringify(pet.stats), before);
});

test('Schlaf: erholt sich und wacht von selbst auf; erschöpft schläft es ein', () => {
  const { s, pet } = withPet();
  pet.stats.rest = 20;
  assert.ok(doAction(pet, 'sleep', s, T0).ok);
  assert.equal(canDo(pet, 'feed', s).ok, false);
  tickPet(pet, T0 + 4 * H);
  assert.equal(pet.sleeping, false);
  assert.ok(pet.stats.rest > 90, String(pet.stats.rest));
  pet.stats.rest = 11;
  tickPet(pet, T0 + 5 * H);
  assert.equal(pet.sleeping, true);
});

test('Kuscheln erst ab Stufe 3 und hoher Liebe', () => {
  const { s, pet } = withPet();
  pet.stats.love = 100;
  assert.equal(doAction(pet, 'cuddle', s, T0).ok, false);
  pet.xp = LEVEL_XP[2];
  pet.stats.love = CUDDLE_LOVE - 1;
  assert.equal(doAction(pet, 'cuddle', s, T0).ok, false);
  pet.stats.love = CUDDLE_LOVE;
  assert.equal(doAction(pet, 'cuddle', s, T0).ok, true);
});

test('Pflege bringt Erfahrung, Wiederholung immer weniger', () => {
  const { s, pet } = withPet();
  const r = doAction(pet, 'pet', s, T0);
  assert.equal(r.xp, 2);
  for (let i = 0; i < 8; i++) doAction(pet, 'pet', s, T0);
  assert.equal(doAction(pet, 'pet', s, T0).xp, 0);
});

test('Füttern verbraucht Futter, Lieblingsfutter wirkt stärker, Fremdes wird abgelehnt', () => {
  const { s, pet } = withPet('cat');
  pet.stats.food = 20;
  s.inventory = { food_dry: 1, food_tuna: 1, food_hay: 1 };
  assert.equal(canDo(pet, 'feed', s, 'food_hay').ok, false);
  const r = doAction(pet, 'feed', s, T0, { itemId: 'food_tuna' });
  assert.ok(r.fav);
  assert.equal(r.delta.food, 60);
  assert.equal(s.inventory.food_tuna, undefined);
  pet.stats.food = 20;
  doAction(pet, 'feed', s, T0);
  assert.equal(s.inventory.food_dry, undefined);
  assert.equal(canDo(pet, 'feed', s).ok, false, 'kein passendes Futter mehr');
});

test('Bürsten, Baden und Gassi brauchen Ausrüstung und haben Wartezeiten', () => {
  const { s, pet } = withPet('dog');
  assert.equal(canDo(pet, 'brush', s).ok, false);
  s.inventory.care_brush = 1;
  assert.ok(doAction(pet, 'brush', s, T0).ok);
  assert.equal(canDo(pet, 'brush', s, null, T0 + H).ok, false);
  assert.ok(canDo(pet, 'brush', s, null, T0 + 2 * H + 1).ok);
  s.inventory.care_soap = 1;
  assert.ok(doAction(pet, 'bath', s, T0).ok);
  assert.equal(s.inventory.care_soap, undefined, 'Seife verbraucht');
  s.inventory.care_runball = 1;
  assert.equal(canDo(pet, 'walk', s, null, T0).ok, false, 'Laufball passt nicht zum Hund');
  s.inventory.care_leash = 1;
  const w = doAction(pet, 'walk', s, T0, { rng: () => 0.1 });
  assert.ok(w.ok && w.found && w.found.coins >= 5);
});

test('Satt und ohne Durst wird abgelehnt', () => {
  const { s, pet } = withPet();
  pet.stats.food = 96; pet.stats.water = 99;
  assert.equal(doAction(pet, 'feed', s, T0).ok, false);
  assert.equal(doAction(pet, 'water', s, T0).ok, false);
  pet.stats.food = 40;
  const r = doAction(pet, 'feed', s, T0);
  assert.equal(r.delta.food, 20, "Trockenfutter");
});

test('Wiederholtes Streicheln wirkt schwächer und erholt sich mit der Zeit', () => {
  const { s, pet } = withPet();
  const gains = [];
  for (let i = 0; i < 6; i++) { const before = pet.stats.love; doAction(pet, 'pet', s, T0); gains.push(pet.stats.love - before); }
  assert.ok(gains[5] < gains[0] / 2, gains.join(','));
  tickPet(pet, T0 + 2 * H);
  const before = pet.stats.love;
  doAction(pet, 'pet', s, T0 + 2 * H);
  assert.ok(pet.stats.love - before >= 5.9);
});

test('Spielen braucht Spielzeug und Ruhe', () => {
  const { s, pet } = withPet();
  s.inventory = {};
  assert.equal(canDo(pet, 'play', s).ok, false);
  s.inventory.toy_ball = 1;
  s.inventory.toy_yarn = 1;
  assert.equal(canDo(pet, 'play', s, 'toy_yarn').ok, true, 'Katze mag Wollknäuel');
  pet.stats.rest = 10;
  assert.equal(canDo(pet, 'play', s).ok, false);
  pet.stats.rest = 60;
  const r = doAction(pet, 'play', s, T0);
  assert.ok(r.ok && r.delta.fun > 0 && r.delta.rest < 0);
});

test('Erfüllung folgt langsam dem Wohlbefinden', () => {
  const { pet } = withPet();
  Object.assign(pet.stats, { love: 100, fun: 100, food: 100, water: 100, rest: 100, joy: 0 });
  tickPet(pet, T0 + 2 * H);
  assert.ok(pet.stats.joy > 5 && pet.stats.joy < 30, String(pet.stats.joy));
});

test('Spielstand mit Tieren übersteht Speichern und Laden; kaputte Tiere fliegen raus', () => {
  const { s } = withPet('rabbit');
  s.pets.push({ id: 'x', species: 'einhorn' });
  const back = parse(serialize(s));
  assert.equal(back.pets.length, 1);
  assert.equal(back.pets[0].species, 'rabbit');
  assert.equal(back.activePet, back.pets[0].id);
});

test('Jede Tierart lässt sich in jeder Farbe und Stimmung zeichnen', () => {
  for (const [id, sp] of Object.entries(SPECIES)) {
    for (const c of sp.colors) for (const f of ['happy', 'ok', 'sad', 'sleep']) {
      const svg = petSvg(id, c.id, f);
      assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
      assert.doesNotMatch(svg, /undefined|NaN/);
    }
  }
});
