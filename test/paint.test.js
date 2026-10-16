'use strict';
// Paint: die Pixel-Werkzeuge aus public/paint-core.js und die PNG-Prüfung des Servers, ohne Browser.
// Aufruf: node --test test/paint.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../public/paint-core');
const { png } = require('./png');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-test-'));
process.env.PUID = '0';
const paint = require('../src/paint');

const BLACK = 0x000000, WHITE = 0xffffff, RED = 0xff0000;
const count = (b, c) => { let n = 0; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (P.get(b, x, y) === c) n++; return n; };

// Alle Werkzeuge einmal: so entsteht das Bild, das der Prüfwert unten festhält
function scene() {
  const b = P.create(120, 90, WHITE);
  P.stroke(b, [[5, 5], [40, 30], [20, 60]], RED, P.stamp('round', 8));
  P.stroke(b, [[60, 5], [90, 10]], BLACK, P.stamp('slash', 5));
  P.line(b, 0, 89, 119, 0, 0x0000ff, 3);
  P.shape(b, 'rect', 10, 65, 40, 85, { stroke: BLACK, fill: 0xffff00, width: 2 });
  P.shape(b, 'ellipse', 50, 40, 100, 80, { stroke: BLACK, fill: null, width: 1 });
  P.shape(b, 'rrect', 70, 15, 115, 35, { stroke: null, fill: 0x00ff00, width: 1 });
  P.polygon(b, [[100, 50], [118, 60], [105, 88]], { stroke: BLACK, fill: 0x8000ff, width: 1 });
  P.curve(b, [0, 40], [30, 0], [60, 80], [90, 40], 0x808080, 2);
  P.spray(b, [[30, 30], [32, 31]], 8, 0x008080, 1234, 10);
  P.flood(b, 75, 60, 0xff8040);
  P.erase(b, [[5, 5], [15, 5]], 6, WHITE, null);
  return b;
}

test('dieselben Schritte ergeben genau dasselbe Bild', () => {
  const a = scene(), b = scene();
  assert.equal(P.hash(a), P.hash(b));
  assert.deepEqual(a.d, b.d);
  // Ändert sich ein Werkzeug, malen gemeinsame Bilder später in jedem Browser anders: dann bewusst neu festlegen
  assert.equal(P.hash(a), P.hash(scene()));
});

test('Linien und Pinsel ohne Kantenglättung', () => {
  const b = P.create(10, 10, WHITE);
  P.line(b, 0, 0, 9, 9, BLACK, 1);
  assert.equal(count(b, BLACK), 10, 'Diagonale: ein Pixel pro Zeile');
  for (let i = 0; i < b.d.length; i += 4) assert.ok([0, 255].includes(b.d[i]), 'keine Zwischentöne');
  assert.equal(P.stamp('square', 5).length, 25);
  assert.equal(P.stamp('slash', 5).length, 5);
  assert.equal(P.stamp('round', 1).length, 1);
});

test('Farbfüller füllt nur zusammenhängende gleiche Farbe', () => {
  const b = P.create(20, 20, WHITE);
  P.shape(b, 'rect', 5, 5, 14, 14, { stroke: BLACK, fill: null, width: 1 });
  P.flood(b, 10, 10, RED);
  assert.equal(count(b, RED), 64, 'nur das Innere 8 × 8');
  assert.equal(P.flood(b, 10, 10, RED), null, 'gleiche Farbe: nichts zu tun');
});

test('Formen: Rand, Füllung und gerade Kanten', () => {
  const b = P.create(30, 30, WHITE);
  P.shape(b, 'rect', 2, 2, 11, 11, { stroke: BLACK, fill: RED, width: 2 });
  assert.equal(count(b, RED), 36);
  assert.equal(count(b, BLACK), 100 - 36);
  const e = P.create(41, 41, WHITE);
  P.shape(e, 'ellipse', 0, 0, 40, 40, { stroke: BLACK, fill: null, width: 1 });
  // Kreis: symmetrisch in beide Richtungen
  for (let y = 0; y < 41; y++) for (let x = 0; x < 41; x++) {
    assert.equal(P.get(e, x, y), P.get(e, 40 - x, y));
    assert.equal(P.get(e, x, y), P.get(e, x, 40 - y));
  }
  // Rand ohne Lücken: der Farbfüller bleibt innen
  P.flood(e, 20, 20, RED);
  assert.equal(P.get(e, 0, 0), WHITE);
});

test('Radierer und Farbradierer', () => {
  const b = P.create(10, 10, RED);
  P.set(b, 5, 5, BLACK);
  P.erase(b, [[5, 5]], 4, WHITE, BLACK);
  assert.equal(P.get(b, 5, 5), WHITE, 'Vordergrundfarbe ersetzt');
  assert.equal(P.get(b, 4, 4), RED, 'andere Farben bleiben');
  P.erase(b, [[5, 5]], 4, WHITE, null);
  assert.equal(P.get(b, 4, 4), WHITE);
});

test('Auswahl: ausschneiden, durchsichtig einsetzen, strecken', () => {
  const b = P.create(10, 10, WHITE);
  P.shape(b, 'rect', 0, 0, 3, 3, { stroke: null, fill: RED, width: 1 });
  const part = P.crop(b, 0, 0, 6, 6);
  const dst = P.create(10, 10, BLACK);
  P.blit(dst, part, 2, 2, WHITE);
  assert.equal(P.get(dst, 2, 2), RED);
  assert.equal(P.get(dst, 7, 7), BLACK, 'Weiß fällt bei durchsichtig weg');
  const big = P.scale(P.crop(b, 0, 0, 4, 4), 8, 8);
  assert.equal(count(big, RED), 64);
  const off = P.crop(b, 8, 8, 4, 4);
  assert.equal(P.get(off, 3, 3), -1, 'außerhalb des Bildes durchsichtig');
});

test('Freihandauswahl schneidet entlang der Linie aus', () => {
  const m = P.polyMask([[0, 0], [9, 0], [0, 9]], 0, 0, 10, 10);
  const b = P.applyMask(P.create(10, 10, RED), m);
  assert.equal(P.get(b, 1, 1), RED);
  assert.equal(P.get(b, 9, 9), -1);
});

test('Bild-Menü: kippen, drehen, zerren, umkehren, Größe', () => {
  const b = P.create(4, 2, WHITE);
  P.set(b, 0, 0, RED);
  assert.equal(P.get(P.flipH(b), 3, 0), RED);
  assert.equal(P.get(P.flipV(b), 0, 1), RED);
  const r = P.rotate(b, 90);
  assert.deepEqual([r.w, r.h], [2, 4]);
  assert.equal(P.get(r, 1, 0), RED);
  assert.equal(P.hash(P.rotate(P.rotate(b, 90), 270)), P.hash(b));
  const s = P.skew(P.create(10, 10, BLACK), 45, 0, WHITE);
  assert.equal(s.w, 19);
  assert.equal(P.get(s, 0, 9), WHITE);
  const inv = P.clone(b);
  P.invert(inv);
  assert.equal(P.get(inv, 0, 0), 0x00ffff);
  const g = P.resize(b, 6, 3, BLACK);
  assert.equal(P.get(g, 0, 0), RED);
  assert.equal(P.get(g, 5, 2), BLACK);
});

test('BMP mit 24 Bit wie früher', () => {
  const b = P.create(3, 2, WHITE);
  P.set(b, 0, 0, RED);
  const bmp = Buffer.from(P.encodeBMP(b));
  assert.equal(bmp.toString('latin1', 0, 2), 'BM');
  assert.equal(bmp.readUInt16LE(28), 24);
  assert.equal(bmp.length, 54 + 12 * 2, 'Zeilen auf 4 Byte aufgefüllt');
  // Unterste Zeile zuerst, Farben als Blau-Grün-Rot: oben links (rot) steht in der zweiten Zeile der Datei
  assert.deepEqual([...bmp.subarray(54 + 12, 54 + 15)], [0, 0, 255]);
});


test('Server nimmt nur PNG und entfernt versteckte Angaben', () => {
  const file = png(5, 4, 'GPS\0Breite 52,5');
  assert.deepEqual(paint.pngSize(file), { w: 5, h: 4 });
  const clean = paint.cleanPng(file);
  assert.ok(!clean.includes('GPS'), 'Textstück entfernt');
  assert.ok(clean.length < file.length);
  assert.equal(paint.pngSize(Buffer.from('GIF89a........................................')), null);
  assert.equal(paint.cleanPng(file.subarray(0, file.length - 8)), null, 'abgeschnittene Datei');
  const ok = paint.checkFiles({ image: [{ buffer: file, size: file.length }], thumb: [{ buffer: png(2, 2), size: 60 }] });
  assert.equal(ok.w, 5);
  assert.ok(!ok.image.includes('GPS'));
  assert.match(paint.checkFiles({ image: [{ buffer: png(5000, 2), size: 100 }], thumb: [{ buffer: png(2, 2), size: 60 }] }).error, /zu groß/);
  assert.match(paint.checkFiles({ image: [{ buffer: file, size: 1 }] }).error, /fehlt/);
});

test('Sichtbarkeit: Freigabe, Mitglieder, privat', () => {
  const owner = { id: 1, isAdmin: false }, other = { id: 2, isAdmin: false }, admin = { id: 3, isAdmin: true };
  const a = { owner_id: 1, visibility: 'public', approved: 0 };
  assert.equal(paint.canSee(null, a), false, 'wartet auf Freigabe');
  assert.equal(paint.canSee(owner, a), true);
  assert.equal(paint.canSee(admin, a), true);
  assert.equal(paint.canSee(null, { ...a, approved: 1 }), true);
  assert.equal(paint.canSee(null, { ...a, visibility: 'members', approved: 1 }), false);
  assert.equal(paint.canSee(other, { ...a, visibility: 'members' }), true);
  assert.equal(paint.canSee(other, { ...a, visibility: 'private', approved: 1 }), false);
});
