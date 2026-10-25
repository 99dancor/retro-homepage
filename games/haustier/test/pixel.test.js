import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, STATS } from '../src/js/pets.js';
import { ITEM_LIST } from '../src/js/items.js';
import { PLACES, OBSTACLES, PICKUPS } from '../src/js/trip.js';
import { petSvg } from '../src/js/art.js';
import { petGrid, gridSvg, grid, dot, ACC_IDS } from '../src/js/pixel.js';
import { iconSvg, iconGrid, hasIcon, ICON_OF } from '../src/js/icons.js';

const filled = (g) => g.px.filter(Boolean).length;

test('Pixel: jedes Tier in jeder Farbe und Stimmung ist 48 × 48 und gut gefüllt', () => {
  for (const [id, sp] of Object.entries(SPECIES)) {
    for (const c of sp.colors) {
      for (const face of ['ok', 'happy', 'sad', 'sleep']) {
        const g = petGrid(id, c, { face });
        assert.equal(g.w, 48);
        assert.equal(g.px.length, 48 * 48);
        const n = filled(g);
        assert.ok(n > 400 && n < 1800, `${id}/${c.id}/${face}: ${n} Punkte`);
      }
      assert.match(petSvg(id, c.id, 'ok', { title: 'Test' }), /aria-label="Test"/);
    }
  }
});

test('Pixel: Accessoires passen auf jedes Tier und verändern das Bild', () => {
  const accs = ITEM_LIST.filter((i) => i.cat === 'acc');
  for (const a of accs) assert.ok(ACC_IDS.includes(a.id), `${a.id} hat kein Pixel-Bild`);
  for (const id of Object.keys(SPECIES)) {
    const plain = petSvg(id, null, 'ok');
    for (const a of accs) {
      const dressed = petSvg(id, null, 'ok', { acc: { [a.slot]: a.id } });
      assert.notEqual(dressed, plain, `${a.id} auf ${id}`);
    }
  }
});

test('Pixel: jeder Gegenstand und alles auf den Ausflügen hat ein eigenes Bild', () => {
  const fallback = iconSvg('star');
  for (const i of ITEM_LIST) {
    assert.ok(hasIcon(i.id), i.id);
    assert.ok(filled(iconGrid(i.id)) > 20, i.id);
  }
  for (const id of [...Object.keys(OBSTACLES), ...Object.keys(PICKUPS), ...Object.keys(PLACES), ...STATS.map((st) => st.key)]) {
    assert.ok(hasIcon(ICON_OF[id] || id), id);
    if (id !== 'joy') assert.notEqual(iconSvg(id), fallback, id);
  }
  // Unbekanntes fällt auf den Stern zurück statt zu fehlen
  assert.equal(iconSvg('gibt-es-nicht'), fallback);
  assert.equal(iconSvg('toy_ball'), iconSvg('toy_ball'));
});

test('Pixel: SVG mit einem Pfad je Farbe und sicherem Namen', () => {
  const g = grid(4, 2);
  dot(g, 0, 0, '#ff0000'); dot(g, 1, 0, '#ff0000'); dot(g, 3, 1, '#00ff00');
  const svg = gridSvg(g, { label: 'Ein "Bild"' });
  assert.match(svg, /viewBox="0 0 4 2"/);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /stroke="#ff0000" d="M0 0\.5h2"/);
  assert.match(svg, /aria-label="Ein &quot;Bild&quot;"/);
  assert.match(gridSvg(grid(2, 2)), /aria-hidden="true"/);
});

test('Stellungen: gleiches Raster, jede sieht anders aus, nichts fällt aus dem Bild', async () => {
  const { petGrid, posed, boxOf, POSES } = await import('../src/js/pixel.js');
  const { SPECIES } = await import('../src/js/pets.js');
  const { petSvg } = await import('../src/js/art.js');
  for (const id of Object.keys(SPECIES)) {
    const g = petGrid(id, SPECIES[id].colors[0], { face: 'ok', acc: {} });
    const n = g.px.filter(Boolean).length;
    for (const pose of POSES) {
      const p = posed(g, pose);
      assert.equal(p.w, g.w); assert.equal(p.h, g.h);
      assert.notDeepEqual(p.px, g.px, `${id} ${pose}`);
      assert.ok(p.px.filter(Boolean).length > n * 0.8, `${id} ${pose} verliert Pixel`);
    }
    const b = boxOf(g);
    assert.ok(b.x1 > b.x0 && b.y1 > b.y0);
    const walk = petSvg(id, SPECIES[id].colors[0].id, 'ok', { walk: true });
    assert.match(walk, /class="pw pw2"/);
    assert.match(walk, /lk lk-l/);
  }
});
