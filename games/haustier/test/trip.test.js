import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState } from '../src/js/state.js';
import { adopt, canDo } from '../src/js/pets.js';
import { ITEM_LIST } from '../src/js/items.js';
import {
  SKILLS, SKILL_XP, PLACES, OBSTACLES, course, contestCourse, newRun, stepRun, scoreOf, maxScore, runSpeed, jumpSpeed, GRAVITY,
  skillLevel, skillProgress, addSkillXp, placeOpen, canTrip, finishTrip, finishContest, claimPrize, canContest, seeded,
  CONTEST_COINS, PRIZES, TRIP_COIN_CAP, DOUBLE_JUMP_LEVEL,
} from '../src/js/trip.js';

const T0 = Date.UTC(2026, 9, 1, 12);
const H = 3600000;

function withPet(species = 'dog') {
  const s = newState(T0);
  s.visits.best = 14;   // alle Tierarten freigeschaltet
  const r = adopt(s, species, null, 'Balu', T0);
  assert.ok(r.ok);
  return { s, pet: r.pet };
}

// Läuft eine Strecke ab; jump(r, c) entscheidet je Schritt, ob gesprungen wird
function play(c, levels, jump = () => false) {
  const r = newRun(c, levels);
  let n = 0;
  while (!r.done && n++ < 100000) stepRun(r, c, 1 / 120, jump(r, c));
  return r;
}
// Springt kurz vor jedem Hindernis
const bot = (r, c) => {
  if (r.y > 0) return false;
  const sp = runSpeed(c.place, r.lv.speed);
  return c.things.some((t) => t.kind === 'obstacle' && !r.passed.has(t.id) && t.x - r.x > sp * 0.22 && t.x - r.x < sp * 0.24);
};

test('Strecken sind je Startwert gleich und je Tag verschieden', () => {
  assert.deepEqual(course('park', 'abc'), course('park', 'abc'));
  assert.notDeepEqual(course('park', 'abc').things, course('park', 'abd').things);
  assert.deepEqual(contestCourse('2026-10-18'), contestCourse('2026-10-18'));
  for (const id of Object.keys(PLACES)) {
    const c = course(id, 7);
    assert.equal(c.place, id);
    assert.ok(c.things.some((t) => t.kind === 'obstacle') && c.things.some((t) => t.kind === 'pickup'));
    assert.ok(c.things.every((t, i) => i === 0 || t.x >= c.things[i - 1].x), 'nach x sortiert');
    assert.ok(c.things.filter((t) => t.type === 'sniff').length <= 3);
    for (const t of c.things.filter((x) => x.kind === 'obstacle')) assert.ok(PLACES[id].obstacles.includes(t.type) && OBSTACLES[t.type]);
  }
  assert.equal(course('gibtsnicht', 1).place, 'park');
  const a = seeded(5), b = seeded(5);
  assert.equal(a(), b());
});

test('Springen: Wer nie springt, stolpert über jedes Hindernis, wer rechtzeitig springt, kommt sauber durch', () => {
  const c = course('forest', 'test');
  const obstacles = c.things.filter((t) => t.kind === 'obstacle').length;
  const lazy = play(c, {});
  assert.equal(lazy.hits, obstacles);
  assert.equal(lazy.cleared, 0);
  const good = play(c, {}, bot);
  assert.equal(good.hits, 0);
  assert.equal(good.cleared, obstacles);
  assert.ok(good.t < lazy.t, 'Stolpern kostet Zeit');
  assert.ok(scoreOf(good, c) > scoreOf(lazy, c));
  // Sprunghöhe reicht über das höchste Hindernis
  const top = jumpSpeed(1) ** 2 / (2 * GRAVITY);
  assert.ok(top > Math.max(...Object.values(OBSTACLES).map((o) => o.h)) + 20);
});

test('Doppelsprung ab Sprungkraft 4, Tempo macht schneller, Punkte bleiben unter dem Höchstwert', () => {
  const c = course('park', 'x');
  const r = newRun(c, { jump: 1 });
  stepRun(r, c, 1 / 60, true);
  stepRun(r, c, 1 / 60, false);
  assert.equal(stepRun(r, c, 1 / 60, true).filter((e) => e.type === 'jump').length, 0, 'kein zweiter Sprung');
  const r4 = newRun(c, { jump: DOUBLE_JUMP_LEVEL });
  stepRun(r4, c, 1 / 60, true);
  stepRun(r4, c, 1 / 60, false);
  assert.equal(stepRun(r4, c, 1 / 60, true)[0].type, 'jump');
  const slow = play(c, { speed: 1 }, bot), fast = play(c, { speed: 10, nose: 10 }, bot);
  assert.ok(fast.t < slow.t);
  for (const id of Object.keys(PLACES)) {
    const cc = course(id, 'max');
    const best = play(cc, { speed: 10, jump: 10, nose: 10 }, bot);
    assert.ok(scoreOf(best, cc) <= maxScore(cc), id);
    assert.ok(scoreOf(best, cc) > maxScore(cc) * 0.6, `${id}: guter Lauf kommt nah heran`);
  }
});

test('Fähigkeiten: Stufen, Talent und Fortschritt', () => {
  const { pet } = withPet('cat');
  assert.equal(skillLevel(pet, 'jump'), 1);
  assert.deepEqual(skillProgress(pet, 'jump'), { have: 0, need: SKILL_XP[1] });
  const ups = addSkillXp(pet, { jump: 16, nose: 16 });
  assert.equal(pet.skills.jump, 20, 'Katzen lernen Sprungkraft 25 % schneller');
  assert.equal(pet.skills.nose, 16);
  assert.deepEqual(ups, [{ key: 'jump', level: 2 }]);
  addSkillXp(pet, { speed: 10000 });
  assert.equal(skillLevel(pet, 'speed'), 10);
  assert.equal(skillProgress(pet, 'speed').need, null);
  assert.equal(SKILLS.length, 3);
});

test('Ausrüstung: jede Tierart kann auf Ausflug, Drachen ohne Ausrüstung', () => {
  for (const sp of ['cat', 'rabbit', 'axolotl', 'hamster', 'dog']) {
    const { s, pet } = withPet(sp);
    assert.ok(!canTrip(s, pet), sp);
    const gear = ITEM_LIST.find((i) => i.cat === 'care' && i.note && /Gassi|Ausflug/.test(i.note) && (!i.for || i.for.includes(sp)));
    s.inventory[gear.id] = 1;
    assert.ok(canTrip(s, pet), sp);
  }
  const { s, pet } = withPet('fox');
  assert.match(canDo(pet, 'walk', s).reason, /Leine/);
  assert.ok(placeOpen(pet, 'park') && !placeOpen(pet, 'forest'));
  const d = newState(T0);
  d.visits.best = 14;
  assert.ok(canTrip(d, adopt(d, 'dragon', null, 'Funke', T0).pet));
});

test('Ausflug: Wirkung wie Gassi, dazu Münzen, Leckerli, Funde und Erfahrung', () => {
  const { s, pet } = withPet('dog');
  s.inventory.care_leash = 1;
  pet.stats.food = 40;
  const c = course('park', 1);
  const r = play(c, {}, bot);
  r.coin = 50; r.sniff = 3; r.treat = 4;
  const coins = s.coins;
  const res = finishTrip(s, pet, r, c, T0, () => 0.2);
  assert.ok(res.ok);
  assert.equal(res.coins, TRIP_COIN_CAP, 'eingesammelte Münzen sind gedeckelt');
  assert.equal(res.finds.length, 3);
  assert.ok(res.finds.every((f) => f.coins >= 3));
  assert.equal(s.coins, coins + TRIP_COIN_CAP + res.finds.reduce((n, f) => n + f.coins, 0));
  assert.ok(pet.stats.food > 40);
  assert.ok(pet.skills.jump > 0 && pet.skills.nose > 0 && pet.skills.speed > 0);
  // Danach erst wieder in 4 Stunden
  assert.equal(finishTrip(s, pet, r, c, T0 + H).ok, false);
  assert.ok(canDo(pet, 'walk', s, null, T0 + 4 * H + 1).ok || pet.stats.rest < 20);
});

test('Wettbewerb: kostet Puste, bringt einmal am Tag Münzen, merkt sich die Bestleistung', () => {
  const { s, pet } = withPet('dog');
  assert.equal(canContest(s, pet).ok, false, 'ohne Ausrüstung');
  s.inventory.care_leash = 1;
  assert.ok(canContest(s, pet).ok);
  const c = contestCourse('2026-10-01');
  const good = play(c, {}, bot), bad = play(c, {});
  const rest = pet.stats.rest, coins = s.coins;
  const a = finishContest(s, pet, good, c, T0);
  assert.ok(a.newBest && a.coins === CONTEST_COINS);
  assert.equal(pet.stats.rest, rest - 6);
  const b = finishContest(s, pet, bad, c, T0 + 1000);
  assert.ok(!b.newBest && b.coins === 0);
  assert.equal(b.best, a.score);
  assert.equal(s.coins, coins + CONTEST_COINS);
  assert.equal(s.contest.runs, 2);
  pet.stats.rest = 10;
  assert.equal(canContest(s, pet).ok, false);
  // Preis für gestern nur einmal
  assert.equal(claimPrize(s, '2026-09-30', 1, 'Balu'), PRIZES[0]);
  assert.equal(claimPrize(s, '2026-09-30', 1, 'Balu'), 0);
  assert.equal(claimPrize(s, '2026-09-29', 4, 'Balu'), 0);
  assert.deepEqual(s.trophies, [{ day: '2026-09-30', place: 1, pet: 'Balu' }]);
});
