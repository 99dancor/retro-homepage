import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState } from '../src/js/state.js';
import { adopt } from '../src/js/pets.js';
import { ITEM_LIST } from '../src/js/items.js';
import { TOYS, decide, besides, stepTowards, canCatch, wantsToPlay, speed } from '../src/js/behavior.js';
import { petSvg, mix } from '../src/js/art.js';

const T0 = Date.UTC(2026, 9, 1, 12);

function pets(...species) {
  const s = newState(T0);
  s.extraSlots = 1;
  return species.map((sp) => {
    s.pets.forEach((p) => { p.xp = 300; });   // Platz 2 über Zuneigungsstufe 5
    const r = adopt(s, sp, null, sp, T0);
    assert.ok(r.ok, r.text);
    return r.pet;
  });
}
// Feste Zufallsfolge
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('Jedes Spielzeug aus dem Shop hat eine Spielart im Zimmer', () => {
  for (const it of ITEM_LIST.filter((i) => i.cat === 'toy')) {
    assert.ok(TOYS[it.id], `${it.id} fehlt in TOYS`);
    assert.match(TOYS[it.id].kind, /^(throw|lure|bubbles|station)$/);
    assert.ok(TOYS[it.id].hint);
  }
});

test('Schlafende Tiere schlafen weiter, müde dösen, andere besuchen sich', () => {
  const [dog, cat] = pets('dog', 'cat');
  dog.sleeping = true;
  assert.equal(decide({ pet: dog, x: 0.5, d: 0.5 }, []).type, 'sleep');
  dog.sleeping = false;
  dog.stats.rest = 20;
  assert.equal(decide({ pet: dog, x: 0.5, d: 0.5 }, [], seq(0.1, 0.5)).type, 'nap');
  dog.stats.rest = 80;
  const other = { pet: cat, x: 0.2, d: 0.4 };
  const v = decide({ pet: dog, x: 0.7, d: 0.6 }, [other], seq(0.1, 0, 0.9));
  assert.equal(v.type, 'visit');
  assert.equal(v.with, cat.id);
  // Gute Laune und viel Energie: Fangen spielen
  const c = decide({ pet: dog, x: 0.7, d: 0.6 }, [other], seq(0.1, 0, 0.1));
  assert.equal(c.type, 'chase');
  // Ein schlafendes Tier wird nicht besucht
  cat.sleeping = true;
  assert.notEqual(decide({ pet: dog, x: 0.7, d: 0.6 }, [other], seq(0.1, 0, 0.9)).type, 'visit');
});

test('Herumlaufen bleibt im Zimmer', () => {
  const [dog] = pets('dog');
  for (const r of [0.5, 0.6, 0.7]) {
    const v = decide({ pet: dog, x: 0.5, d: 0.5 }, [], seq(r, 0, 1));
    if (v.type !== 'wander') continue;
    assert.ok(v.x >= 0.1 && v.x <= 0.9 && v.d >= 0 && v.d <= 1);
  }
});

test('Schritte, Platz neben einem Freund und Fangen', () => {
  let p = { x: 0.1, d: 0.5 };
  let n = 0;
  while (!(p = stepTowards(p, { x: 0.8, d: 0.9 }, 0.05)).arrived) n++;
  assert.ok(n > 5 && n < 30);
  assert.deepEqual([p.x, p.d], [0.8, 0.9]);
  const b = besides({ x: 0.9, d: 0.3 });
  assert.ok(b.x < 0.9 && b.x >= 0.08);
  assert.equal(b.d, 0.3);
  assert.ok(canCatch({ x: 0.5, d: 0.5 }, { x: 0.52, d: 0.55, air: 0 }));
  assert.ok(!canCatch({ x: 0.5, d: 0.5 }, { x: 0.52, d: 0.55, air: 0.5 }));
  assert.ok(!canCatch({ x: 0.5, d: 0.5 }, { x: 0.7, d: 0.5, air: 0 }));
});

test('Mitspielen nur mit passendem Spielzeug, wach und nicht zu müde', () => {
  const [dog, cat] = pets('dog', 'cat');
  assert.ok(wantsToPlay(dog, 'toy_ball'));
  assert.ok(!wantsToPlay(dog, 'toy_laser'));        // nur für Katzen
  assert.ok(wantsToPlay(cat, 'toy_laser'));
  assert.ok(!wantsToPlay(cat, 'toy_ball', new Set([cat.id])));
  cat.stats.rest = 10;
  assert.ok(!wantsToPlay(cat, 'toy_laser'));
  dog.sleeping = true;
  assert.ok(!wantsToPlay(dog, 'toy_ball'));
  // Traurige Tiere sind langsamer, Jagen ist schneller als Gehen
  assert.ok(speed(cat, 'chase') > speed(cat, 'walk'));
});

test('Grafik: eigene Verlaufs-ids je Bild und Gruppen für Animationen', () => {
  const a = petSvg('cat', 'ginger', 'ok'), b = petSvg('cat', 'ginger', 'ok');
  const id = (s) => s.match(/radialGradient id="([^"]+)"/)[1];
  assert.notEqual(id(a), id(b));
  for (const cls of ['eyes', 'ears', 'head', 'torso', 'paws', 'tail']) assert.match(a, new RegExp(`class="${cls}`));
  assert.doesNotMatch(petSvg('dog', null, 'happy', { shadow: false }), /rgba\(0,0,0,\.15\)/);
  assert.equal(mix('#808080', '#ffffff', 0.5), '#c0c0c0');
  assert.equal(mix('#808080', '#000000', 1), '#000000');
});
