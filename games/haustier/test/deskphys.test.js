import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRANKS, PRANK_GAP, PRANK_IDLE, deskOptions, prankDue, subtract, surfaces, surfaceAt, below, surfaceKey,
  fall, jumpTo, canHop, hopPoints, route, throwVelocity,
} from '../src/js/deskphys.js';

const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, `${a} ist nicht ungefähr ${b}`);

test('Streiche sind ab Werk alle an und einzeln abschaltbar', () => {
  const o = deskOptions(undefined);
  assert.equal(o.mouse, true);
  assert.equal(o.sound, true);
  for (const p of PRANKS) assert.equal(o.pranks[p.id], true);
  const off = deskOptions({ sound: false, pranks: { bell: false } });
  assert.equal(off.sound, false);
  assert.equal(off.mouse, true);
  assert.equal(off.pranks.bell, false);
  assert.equal(off.pranks.volume, true);
  assert.deepEqual(deskOptions('kaputt'), o);
});

test('Ein Streich nur nach Ruhe und höchstens einmal pro Stunde', () => {
  const now = 50e6;
  assert.equal(prankDue({ now, last: 0, active: now - PRANK_IDLE - 1 }), true);
  assert.equal(prankDue({ now, last: 0, active: now - 60e3 }), false);
  assert.equal(prankDue({ now, last: now - PRANK_GAP / 2, active: 0 }), false);
  assert.equal(prankDue({ now, last: 0, active: 0, reduced: true }), false);
});

test('Strecken abziehen', () => {
  assert.deepEqual(subtract([[0, 100]], 20, 30), [[0, 20], [30, 100]]);
  assert.deepEqual(subtract([[0, 100]], -5, 200), []);
  assert.deepEqual(subtract([[0, 100]], 100, 200), [[0, 100]]);
});

test('Laufflächen: vordere Fenster schneiden Kanten ab, Möbel liegen unter allen Fenstern', () => {
  const wins = [
    { id: 'a', left: 100, right: 400, top: 200, bottom: 500, z: 1 },
    { id: 'b', left: 300, right: 600, top: 100, bottom: 400, z: 2 },
  ];
  const items = [
    { id: 'kissen', left: 350, right: 380, top: 650 },
    { id: 'regal', left: 320, right: 360, top: 300 },   // steckt hinter Fenster b
  ];
  const list = surfaces(wins, { floor: 700, width: 1000, items });
  const of = (id) => list.filter((s) => s.id === id).map((s) => [s.x1, s.x2]);
  assert.deepEqual(of('floor'), [[0, 1000]]);
  assert.deepEqual(of('a'), [[106, 300]]);
  assert.deepEqual(of('b'), [[306, 594]]);
  assert.deepEqual(of('kissen'), [[350, 380]]);
  assert.deepEqual(of('regal'), []);
  // Zu weit oben ragt ein Tier aus dem Bild: die Fläche zählt nicht, schneidet aber weiter ab
  const high = surfaces(wins, { floor: 700, width: 1000, items, minTop: 150 });
  assert.deepEqual(high.filter((s) => s.id === 'b'), []);
  assert.deepEqual(high.filter((s) => s.id === 'a').map((s) => [s.x1, s.x2]), [[106, 300]]);
  assert.equal(surfaceAt(list, 200, 200).id, 'a');
  assert.equal(surfaceAt(list, 350, 200), null);
  assert.equal(below(list, 200, 150).id, 'a');
  assert.equal(below(list, 800, 150).id, 'floor');
});

function drop(b, list, opts = {}) {
  for (let i = 0; i < 400; i++) {
    const hit = fall(b, 1 / 60, list, { width: 1000, half: 10, ...opts });
    if (hit) return hit;
  }
  return null;
}

test('Fallen: landet auf der nächsten Fläche, mit skip durch sie hindurch', () => {
  const win = { id: 'a', kind: 'win', y: 200, x1: 100, x2: 300 };
  const list = [{ id: 'floor', kind: 'floor', y: 700, x1: 0, x2: 1000 }, win];
  const b = { x: 200, y: 150, vx: 0, vy: 0 };
  assert.equal(drop(b, list).id, 'a');
  assert.equal(b.y, 200);
  const c = { x: 200, y: 200, vx: 0, vy: 0, skip: surfaceKey(win) };
  assert.equal(drop(c, list).id, 'floor');
  assert.equal(c.y, 700);
  assert.equal(c.skip, null);
  // Nie durch den Boden, auch bei großem Schritt
  const d = { x: 900, y: 690, vx: 0, vy: 5000 };
  assert.equal(fall(d, 0.1, list, { width: 1000 }).id, 'floor');
  assert.equal(d.y, 700);
});

test('Fallen: prallt oben und an den Rändern ab', () => {
  const list = [{ id: 'floor', kind: 'floor', y: 700, x1: 0, x2: 1000 }];
  const b = { x: 500, y: 10, vx: 0, vy: -3000 };
  fall(b, 1 / 60, list, { width: 1000, ceil: 0 });
  assert.equal(b.y, 0);
  assert.ok(b.vy > 0);
  const s = { x: 995, y: 300, vx: 2000, vy: 0 };
  fall(s, 1 / 60, list, { width: 1000, half: 20 });
  assert.equal(s.x, 980);
  assert.ok(s.vx < 0);
});

test('Sprungbogen trifft das Ziel', () => {
  const a = { x: 0, y: 700 }, b = { x: 100, y: 600 };
  const j = jumpTo(a, b, { apex: 30 });
  const g = 1800;
  near(a.x + j.vx * j.t, b.x);
  near(a.y + j.vy * j.t + (g * j.t * j.t) / 2, b.y);
  assert.ok(j.vy < 0);
});

test('Wege über Sprünge, unerreichbar ist null', () => {
  const S = 48;
  const floor = { id: 'floor', kind: 'floor', y: 700, x1: 0, x2: 1000 };
  const a = { id: 'a', kind: 'win', y: 600, x1: 100, x2: 300 };
  const c = { id: 'c', kind: 'win', y: 520, x1: 350, x2: 500 };
  const d = { id: 'd', kind: 'win', y: 100, x1: 600, x2: 900 };
  const list = [floor, a, c, d];
  assert.equal(canHop(floor, a, S), true);
  assert.equal(canHop(floor, c, S), false);
  assert.equal(canHop(d, floor, S), true);    // hinunter geht immer
  assert.deepEqual(route(list, floor, c, S).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(route(list, a, a, S), []);
  assert.equal(route(list, floor, d, S), null);
});

test('Hinunter springt ein Tier über den näheren Rand', () => {
  const S = 48;
  const a = { id: 'a', kind: 'win', y: 200, x1: 100, x2: 400 };
  const floor = { id: 'floor', kind: 'floor', y: 700, x1: 0, x2: 1000 };
  const l = hopPoints(a, floor, S, 150);
  assert.ok(l.from <= a.x1 + 5);
  assert.ok(l.to < a.x1);
  const r = hopPoints(a, floor, S, 380);
  assert.ok(r.from >= a.x2 - 5);
  assert.ok(r.to > a.x2);
  // Hinauf: Landepunkt liegt auf der Zielfläche
  const up = hopPoints(floor, a, S, 600);
  assert.ok(up.to >= a.x1 && up.to <= a.x2);
});

test('Wurfgeschwindigkeit aus den letzten Zeigerpunkten', () => {
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, t: 0 }]), { vx: 0, vy: 0 });
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 100, y: -50, t: 100 }]), { vx: 1000, vy: -500 });
  assert.equal(throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 1000, y: 0, t: 100 }]).vx, 2400);
});
