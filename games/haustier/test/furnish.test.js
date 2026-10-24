import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, migrate } from '../src/js/state.js';
import { adopt, bowlMeal, lowNeeds, needsSentence, FULL } from '../src/js/pets.js';
import { placeItem, unplace, placedCount, pourFood, fillWater, available } from '../src/js/economy.js';
import { FURN, MAX_DESK, canPlace, sleepsIn } from '../src/js/furniture.js';
import { ITEMS, isReward } from '../src/js/items.js';
import { assignBeds } from '../src/js/behavior.js';

const T0 = Date.UTC(2026, 9, 1, 12);

function game(species = 'cat') {
  const s = newState(T0);
  const r = adopt(s, species, null, 'Mimi', T0);
  assert.ok(r.ok, r.text);
  return { s, pet: r.pet };
}

test('Was wo stehen darf: Kiste bleibt im Zimmer, Wurfspielzeug nur draußen', () => {
  assert.equal(canPlace('furn_chest', 'room'), true);
  assert.equal(canPlace('furn_chest', 'desk'), false);
  assert.equal(canPlace('toy_ball', 'room'), false);
  assert.equal(canPlace('toy_ball', 'desk'), true);
  assert.equal(canPlace('furn_bed2', 'room') && canPlace('furn_bed2', 'desk'), true);
  assert.equal(canPlace('food_dry', 'room'), false);
  for (const id of Object.keys(FURN)) assert.ok(ITEMS[id], `${id} fehlt in items.js`);
  assert.equal(sleepsIn('furn_box', 'cat'), true);
  assert.equal(sleepsIn('furn_box', 'dog'), false);
  assert.equal(sleepsIn('care_bed', 'dog'), true);
});

test('Aufstellen bis zur Höchstzahl, Umstellen geht immer', () => {
  const { s } = game();
  const ids = Object.keys(FURN).filter((id) => canPlace(id, 'desk') && canPlace(id, 'room'));
  assert.ok(ids.length > MAX_DESK);
  assert.equal(placeItem(s, ids[0], 'desk', 0.5, 1).ok, false);   // nicht im Besitz
  for (const id of ids) s.inventory[id] = 1;
  for (const id of ids.slice(0, MAX_DESK)) assert.ok(placeItem(s, id, 'desk', 0.5, 1).ok);
  assert.equal(placedCount(s, 'desk'), MAX_DESK);
  const extra = ids[MAX_DESK];
  assert.equal(placeItem(s, extra, 'desk', 0.5, 1).ok, false);
  assert.equal(placeItem(s, ids[0], 'desk', 2, -1).ok, true);      // umstellen, Werte werden begrenzt
  assert.deepEqual(s.place[ids[0]], { at: 'desk', x: 1, y: 0 });
  assert.ok(placeItem(s, extra, 'room', 0.3, 0.3).ok);
  assert.equal(placeItem(s, extra, 'desk', 0.3, 1).ok, false);      // vom Zimmer auf den vollen Desktop
  assert.ok(unplace(s, ids[1]));
  const r = placeItem(s, extra, 'desk', 0.3, 1);
  assert.ok(r.ok && r.moved);
  assert.equal(unplace(s, ids[1]), false);
});

test('Futter in den Napf, Wasser auffüllen', () => {
  const { s } = game();
  s.inventory.food_dry = 1;
  s.inventory.food_milk = 1;
  assert.equal(pourFood(s, 'food_dry').ok, false);                    // kein Napf
  s.inventory.furn_bowl_food = 1;
  s.inventory.furn_bowl_water = 1;
  placeItem(s, 'furn_bowl_food', 'room', 0.3, 0.5);
  assert.equal(pourFood(s, 'food_milk').ok, true);                     // Milch hat auch etwas Futter
  assert.equal(pourFood(s, 'food_dry').ok, false);                     // Napf noch voll
  s.bowls.food = null;
  assert.equal(pourFood(s, 'food_dry').ok, true);
  assert.equal(s.inventory.food_dry, undefined);
  assert.deepEqual(s.bowls.food, { item: 'food_dry', left: 1 });
  assert.equal(fillWater(s).ok, false);                                // kein Wassernapf
  placeItem(s, 'furn_bowl_water', 'desk', 0.5, 1);
  assert.equal(fillWater(s).ok, true);
  assert.equal(s.bowls.water, 1);
  assert.equal(fillWater(s).ok, false);
});

test('Hungrige und durstige Tiere bedienen sich am Napf, satte nicht', () => {
  const { pet } = game('cat');
  const bowls = { food: { item: 'food_dry', left: 1 }, water: 1 };
  pet.stats.food = 90;
  pet.stats.water = 90;
  assert.deepEqual(bowlMeal(pet, { bowls, food: true, water: true }), { food: 0, water: 0 });
  pet.stats.food = 20;
  pet.stats.water = 10;
  const got = bowlMeal(pet, { bowls, food: true, water: true });
  assert.ok(got.food > 0 && got.water > 0);
  assert.ok(pet.stats.food <= FULL && pet.stats.water <= FULL);
  assert.ok(bowls.water < 1);
  // Der Napf reicht für eine Portion (20 Futter), danach ist er leer
  pet.stats.food = 0;
  bowlMeal(pet, { bowls, food: true });
  assert.equal(bowls.food, null);
  // Heu frisst die Katze nicht
  const hay = { food: { item: 'food_hay', left: 1 }, water: 0 };
  pet.stats.food = 10;
  assert.equal(bowlMeal(pet, { bowls: hay, food: true }).food, 0);
});

test('Jedes schlafende Tier bekommt ein eigenes Bett', () => {
  const spots = [{ id: 'care_bed', x: 0.2, d: 0.3, sleep: true }, { id: 'furn_box', x: 0.6, d: 0.3, sleep: ['cat'] }];
  const m = assignBeds([{ key: 'a', species: 'dog', bed: null }, { key: 'b', species: 'cat', bed: 'furn_box' }], spots);
  assert.equal(m.get('a').id, 'care_bed');
  assert.equal(m.get('b').id, 'furn_box');
  // Zwei Hunde, ein passendes Bett: der zweite legt sich daneben, nicht hinein
  const two = assignBeds([{ key: 'a', species: 'dog' }, { key: 'c', species: 'dog' }], spots);
  assert.equal(two.get('a').id, 'care_bed');
  assert.equal(two.get('c').id, null);
  assert.ok(Math.abs(two.get('c').x - two.get('a').x) > 0.1);
  assert.equal(assignBeds([{ key: 'a', species: 'dog' }], []).get('a'), null);
});

test('Belohnungen: Urkunde für einen Pokal, Sternenhimmel nach 15 Tagesaufgaben', () => {
  const { s } = game();
  assert.equal(isReward(ITEMS.furn_cert), true);
  assert.equal(isReward(ITEMS.furn_bowl_food), false);
  assert.equal(available(s, ITEMS.furn_cert).ok, false);
  s.trophies = [{ day: '2026-10-01' }];
  assert.equal(available(s, ITEMS.furn_cert).ok, true);
  s.tasksDone = 3;
  assert.match(available(s, ITEMS.furn_star).reason, /3 geschafft/);
  s.tasksDone = 15;
  assert.equal(available(s, ITEMS.furn_star).ok, true);
});

test('Alte Spielstände bekommen Kiste und Körbchen ins Zimmer, kaputte Werte werden repariert', () => {
  const { s, pet } = game();
  delete s.place;
  delete s.bowls;
  delete s.inventory.furn_chest;
  s.inventory.care_bed = 1;
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.equal(m.place.furn_chest.at, 'room');
  assert.equal(m.place.care_bed.at, 'room');
  assert.deepEqual(m.bowls, { food: null, water: 0 });
  assert.equal(m.tasksDone, 0);
  const raw = JSON.parse(JSON.stringify(m));
  raw.place.furn_chest = { at: 'desk', x: 0.5, y: 1 };      // die Kiste darf nicht raus
  raw.place.furn_lamp = { at: 'desk', x: 0.5, y: 1 };       // nicht im Besitz
  raw.bowls = { food: { item: 'toy_ball', left: 1 }, water: 7 };
  raw.desk = { gates: { l: 2, r: 9 }, stay: [pet.id, 'weg'], out: { [pet.id]: { x: 0.4, y: 1 }, weg: { x: 0, y: 0 } } };
  const n = migrate(raw);
  assert.equal(n.place.furn_chest, undefined);
  assert.equal(n.place.furn_lamp, undefined);
  assert.deepEqual(n.bowls, { food: null, water: 1 });
  assert.deepEqual(n.desk.gates, { l: 2, r: 0 });
  assert.deepEqual(n.desk.stay, [pet.id]);
  assert.deepEqual(Object.keys(n.desk.out), [pet.id]);
});

test('Mehrere Bedürfnisse in einem Satz', () => {
  const { pet } = game();
  Object.assign(pet.stats, { food: 10, water: 20, rest: 5, fun: 80, love: 80 });
  assert.deepEqual(lowNeeds(pet), ['rest', 'food', 'water']);
  assert.equal(needsSentence(pet, ['food', 'water', 'rest']), 'Mimi hat Hunger und Durst und ist müde');
  assert.equal(needsSentence(pet, ['love']), 'Mimi fühlt sich einsam');
});
