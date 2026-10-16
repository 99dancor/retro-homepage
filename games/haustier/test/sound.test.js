import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVolume, setMuted, actionSound, VOICE_NAMES, VOLUME_KEY } from '../src/js/sound.js';
import { SPECIES, ACTIONS } from '../src/js/pets.js';

function memLocal(init) {
  const m = new Map(init ? [[VOLUME_KEY, init]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('Ton: Lautstärke kommt vom Regler der Homepage', () => {
  assert.deepEqual(readVolume(memLocal()), { effekte: 0.5, stumm: false }, 'ohne Eintrag mittlere Lautstärke');
  assert.deepEqual(readVolume(memLocal('{"musik":0.2,"effekte":0.9}')), { effekte: 0.9, stumm: false });
  assert.deepEqual(readVolume(memLocal('{"effekte":7}')), { effekte: 0.5, stumm: false }, 'Unsinn wird ignoriert');
  assert.deepEqual(readVolume(memLocal('kaputt')), { effekte: 0.5, stumm: false });
});

test('Ton: Stummschalten behält die übrigen Werte der Homepage', () => {
  const ls = memLocal('{"musik":0.3,"effekte":0.6}');
  setMuted(ls, true);
  assert.deepEqual(JSON.parse(ls.m.get(VOLUME_KEY)), { musik: 0.3, effekte: 0.6, stumm: true });
  assert.equal(readVolume(ls).stumm, true);
});

test('Ton: jedes Tier hat eine Stimme, jede Pflege einen Klang', () => {
  for (const sp of Object.keys(SPECIES)) assert.ok(VOICE_NAMES.includes(sp), sp);
  for (const a of Object.keys(ACTIONS)) assert.ok(actionSound(a, 'cat').length, a);
  assert.deepEqual(actionSound('cuddle', 'dragon'), ['stimme:dragon', 'herz']);
});
