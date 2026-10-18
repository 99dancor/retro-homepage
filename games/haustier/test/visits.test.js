import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState } from '../src/js/state.js';
import { adopt } from '../src/js/pets.js';
import {
  privacyOf, applyVisits, visitText, visitReward, playdate, giftable, publicPet, cleanLivePet, cleanLiveToy,
  VISIT_COINS, VISIT_COIN_HOSTS, KINDS,
} from '../src/js/visits.js';

const T0 = Date.UTC(2026, 9, 1, 12);

function withPets() {
  const s = newState(T0);
  s.extraSlots = 1;
  for (const sp of ['dog', 'cat']) {
    s.pets.forEach((p) => { p.xp = 300; });
    assert.ok(adopt(s, sp, null, sp === 'dog' ? 'Balu' : 'Luna', T0).ok);
  }
  for (const p of s.pets) p.stats = { food: 50, fun: 50, love: 50, joy: 50, rest: 50, clean: 50 };
  return s;
}

test('Besuchs-Einstellung: Voreinstellung und unbekannte Werte', () => {
  assert.equal(privacyOf(newState(T0)), 'members');
  assert.equal(privacyOf({ visitors: 'friends' }), 'friends');
  assert.equal(privacyOf({ visitors: 'none' }), 'none');
  assert.equal(privacyOf({ visitors: 'alle' }), 'members');
  assert.equal(privacyOf(null), 'members');
});

test('Besuchsbuch-Einträge wirken auf die Tiere und landen in einer Zusammenfassung je Besucher', () => {
  const s = withPets();
  const [balu, luna] = s.pets;
  const food = s.inventory.food_dry || 0;
  const sums = applyVisits(s, [
    { kind: 'visit', visitor: 'Anna' },
    { kind: 'pet', pet_id: balu.id, visitor: 'Anna' },
    { kind: 'pet', pet_id: balu.id, visitor: 'Anna' },
    { kind: 'gift', detail: 'food_dry', visitor: 'Anna' },
    { kind: 'gift', detail: 'acc_crown', visitor: 'Anna' },     // kein Futter: zählt nicht
    { kind: 'sticker', detail: '🌟', visitor: 'Bernd' },
    { kind: 'playdate', detail: 'Hoppel', visitor: 'Bernd' },
    { kind: 'hack', visitor: 'Bernd' },
  ]);
  assert.equal(balu.stats.love, 50 + 2 * KINDS.pet.effect.love);
  assert.equal(luna.stats.love, 50);
  assert.equal(luna.stats.joy, 50 + KINDS.sticker.effect.joy + KINDS.playdate.effect.joy);
  assert.equal(s.inventory.food_dry, food + 1);
  assert.equal(sums.length, 2);
  assert.deepEqual(sums[0].pets, ['Balu']);
  assert.equal(visitText(sums[0]), 'Anna hat Balu gestreichelt und dir 🥣 Trockenfutter dagelassen.');
  assert.equal(visitText(sums[1]), 'Bernd hat Hoppel zum Spielen mitgebracht und einen Gruß hinterlassen 🌟.');
  assert.equal(visitText(applyVisits(s, [{ kind: 'visit', visitor: 'Cem' }])[0]), 'Cem hat bei dir vorbeigeschaut.');
  // Werte bleiben bei 100
  for (let i = 0; i < 30; i++) applyVisits(s, [{ kind: 'pet', pet_id: balu.id, visitor: 'Anna' }]);
  assert.equal(balu.stats.love, 100);
});

test('Münzen für die ersten Besuche am Tag, Spielbesuch einmal je Gastgeber', () => {
  const s = withPets();
  const coins = s.coins;
  assert.equal(visitReward(s, 'anna', T0), VISIT_COINS);
  assert.equal(visitReward(s, 'anna', T0), 0);
  for (let i = 1; i < VISIT_COIN_HOSTS; i++) visitReward(s, 'host' + i, T0);
  assert.equal(visitReward(s, 'noch-einer', T0), 0);
  assert.equal(s.coins, coins + VISIT_COINS * VISIT_COIN_HOSTS);
  assert.equal(visitReward(s, 'anna', T0 + 86400000), VISIT_COINS);   // neuer Tag
  const pet = s.pets[0];
  assert.deepEqual(playdate(s, pet, 'anna', T0 + 86400000), KINDS.playdate.effect);
  assert.equal(playdate(s, pet, 'anna', T0 + 86400000), null);
  assert.ok(playdate(s, pet, 'bernd', T0 + 86400000));
});

test('Besucher sehen nur die öffentliche Ansicht, Live-Stände werden bereinigt', () => {
  const s = withPets();
  s.pets[0].stats.love = 77.6;
  const pub = publicPet(s.pets[0], 3);
  assert.deepEqual(Object.keys(pub).sort(), ['acc', 'color', 'id', 'level', 'name', 'sleeping', 'species', 'stats']);
  assert.equal(pub.stats.love, 78);
  assert.ok(giftable('food_dry'));
  assert.ok(!giftable('toy_ball'));
  assert.equal(cleanLivePet({ species: 'drache' }), null);
  assert.equal(cleanLivePet('x'), null);
  const p = cleanLivePet({
    id: 'a'.repeat(50), name: '<b>Balu</b>\n', species: 'dog', color: 'lila', acc: { head: 'acc_crown', neck: 'acc_crown' },
    x: 9, d: -1, facing: 5, face: 'evil', emote: '❤️❤️❤️', seq: 'x', extra: 'weg',
  });
  assert.equal(p.id.length, 30);
  assert.equal(p.name, 'bBalu/b');
  assert.equal(p.x, 1.2);
  assert.equal(p.d, 0);
  assert.equal(p.facing, 1);
  assert.equal(p.face, 'ok');
  assert.equal(p.seq, 0);
  assert.equal(p.acc.head, 'acc_crown');
  assert.equal(p.acc.neck, undefined);
  assert.equal(p.extra, undefined);
  assert.equal(cleanLiveToy({ id: 'food_dry' }), null);
  assert.deepEqual(cleanLiveToy({ id: 'toy_ball', x: 2, y: 0.5, d: 0.5, spin: 1, evil: 1 }), { id: 'toy_ball', x: 1, y: 0.5, d: 0.5, spin: 1 });
});
