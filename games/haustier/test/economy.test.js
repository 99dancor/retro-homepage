import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, registerVisit } from '../src/js/state.js';
import { adopt, LEVEL_XP } from '../src/js/pets.js';
import {
  ensureDaily, track, actionCoins, loginBonus, streakMilestones, accountBonus, canBuy, buy, dealOfDay, priceOf, available,
  wear, DAILY_CAP,
} from '../src/js/economy.js';
import { ITEMS, ITEM_LIST } from '../src/js/items.js';
import { petSvg } from '../src/js/art.js';

const T0 = new Date(2026, 9, 15, 12).getTime();
const D = 86400000;

function game() {
  const s = newState(T0);
  adopt(s, 'cat', null, 'Mimi', T0);
  return s;
}

test('Login-Bonus folgt dem 7-Tage-Rhythmus, Tag 7 mit Überraschung', () => {
  const s = game();
  const got = [];
  for (let i = 0; i < 8; i++) {
    registerVisit(s, T0 + i * D);
    got.push(loginBonus(s, T0 + i * D, () => 0));
  }
  assert.deepEqual(got.map((g) => g.coins), [20, 25, 30, 35, 40, 50, 100, 20]);
  assert.ok(got[6].item);
  assert.equal(s.inventory[got[6].item] >= 1, true);
  const m = streakMilestones(s);
  assert.equal(m.length, 1);
  assert.equal(m[0].coins, 100);
  assert.equal(streakMilestones(s).length, 0, 'Meilenstein nur einmal');
});

test('Münzen aus Aktionen sind auf 150 am Tag begrenzt', () => {
  const s = game();
  let total = 0;
  for (let i = 0; i < 100; i++) total += actionCoins(s, 'walk', 1, T0);
  assert.equal(total, DAILY_CAP);
  assert.equal(actionCoins(s, 'walk', 1, T0 + D), 5, 'nächster Tag neu');
});

test('Tagesaufgaben: drei Stück, gleiche Auswahl am selben Tag, Belohnung einmal', () => {
  const s = game();
  const d = ensureDaily(s, T0);
  assert.equal(d.tasks.length, 3);
  const again = JSON.stringify(d.tasks);
  s.daily = null;
  assert.equal(JSON.stringify(ensureDaily(s, T0).tasks), again);
  // Eine Zählaufgabe erzwingen
  s.daily.tasks = [{ id: 'feed2', done: false }];
  const before = s.coins;
  assert.equal(track(s, 'feed', { now: T0 }).length, 0);
  assert.equal(track(s, 'feed', { now: T0 }).length, 1);
  assert.equal(s.coins, before + 15);
  assert.equal(track(s, 'feed', { now: T0 }).length, 0);
});

test('Aufgaben ohne passende Ausrüstung werden nicht gestellt', () => {
  for (let i = 0; i < 40; i++) {
    const s = game();
    const ids = ensureDaily(s, T0 + i * D).tasks.map((t) => t.id);
    assert.ok(!ids.includes('brush1') && !ids.includes('walk1') && !ids.includes('cuddle2'), ids.join());
  }
});

test('Konto-Geschenk gibt es nur einmal', () => {
  const s = game();
  const b = accountBonus(s);
  assert.equal(b.coins, 200);
  assert.equal(s.inventory.acc_homepage, 1);
  assert.equal(accountBonus(s), null);
  assert.equal(canBuy(s, 'acc_homepage').ok, false, 'nicht im Shop');
});

test('Shop: Preis, Angebot des Tages, Sperren und Doppelkauf', () => {
  const s = game();
  s.coins = 1000;
  const deal = dealOfDay(s, T0);
  assert.equal(priceOf(s, ITEMS[deal], T0), Math.round(ITEMS[deal].price * 0.7));
  assert.equal(dealOfDay(s, T0 + 1000), deal, 'den ganzen Tag gleich');
  const r = buy(s, 'toy_yarn', T0);
  assert.ok(r.ok);
  assert.equal(buy(s, 'toy_yarn', T0).ok, false, 'Spielzeug nur einmal');
  assert.ok(buy(s, 'food_tuna', T0).ok && buy(s, 'food_tuna', T0).ok);
  assert.equal(s.inventory.food_tuna, 2);
  assert.equal(canBuy(s, 'acc_crown', T0).ok, false);
  s.pets[0].xp = LEVEL_XP[7];
  assert.equal(available(s, ITEMS.acc_crown, T0).ok, true);
  assert.equal(available(s, ITEMS.acc_santa, T0).ok, false, 'nur im Dezember');
  assert.equal(available(s, ITEMS.acc_santa, new Date(2026, 11, 3).getTime()).ok, true);
  s.coins = 10;
  assert.match(canBuy(s, 'room_garden', T0).reason, /fehlen/);
});

test('Tierplatz kaufen und Räume einrichten', () => {
  const s = game();
  s.coins = 3000;
  assert.ok(buy(s, 'extra_slot', T0).ok);
  assert.equal(s.extraSlots, 1);
  assert.equal(buy(s, 'extra_slot', T0).ok, false);
  assert.ok(buy(s, 'room_garden', T0).ok);
  assert.equal(s.room, 'room_garden');
  assert.equal(canBuy(s, 'room_retro', T0).ok, false);
});

test('Accessoires an- und ablegen, jedes lässt sich an jedem Tier zeichnen', () => {
  const s = game();
  s.inventory.acc_bowtie = 1;
  const pet = s.pets[0];
  assert.ok(wear(s, pet, 'acc_bowtie'));
  assert.equal(pet.acc.neck, 'acc_bowtie');
  wear(s, pet, 'acc_bowtie');
  assert.equal(pet.acc.neck, undefined);
  assert.equal(wear(s, pet, 'acc_crown'), false, 'nicht im Besitz');
  for (const species of ['cat', 'dog', 'rabbit', 'hamster', 'rat', 'fox', 'axolotl', 'dragon']) {
    for (const item of ITEM_LIST.filter((i) => i.cat === 'acc')) {
      const svg = petSvg(species, null, 'happy', { acc: { [item.slot]: item.id } });
      assert.doesNotMatch(svg, /undefined|NaN/, `${species} ${item.id}`);
    }
  }
});

test('Tägliche Fragen: Ja bringt mehr, einmal am Tag, Antworten werden nicht gespeichert', async () => {
  const { checkIn, checkinDone, CHECKIN_YES, CHECKIN_NO, CHECKIN_JOY } = await import('../src/js/economy.js');
  const s = game();
  const joy = s.pets[0].stats.joy;
  const r = checkIn(s, [true, true, false], T0);
  assert.equal(r.coins, 2 * CHECKIN_YES + CHECKIN_NO);
  assert.equal(s.pets[0].stats.joy, joy + 2 * CHECKIN_JOY);
  assert.ok(checkinDone(s, T0));
  assert.equal(checkIn(s, [true, true, true], T0 + 1000).ok, false, 'nur einmal am Tag');
  assert.ok(checkIn(s, [false, false, false], T0 + D).ok, 'am nächsten Tag wieder');
  assert.doesNotMatch(JSON.stringify(s), /survived|selfcare|wellbeing/);
});
