'use strict';
// Rezeptbuch (src/recipes.js): Zutatenzeilen lesen, Mengen schön schreiben, Wecker in Schritten, Rezept von einer Seite
// übernehmen (schema.org/Recipe) und die Einkaufsliste, die gleiche Zutaten zusammenzählt.
// Aufruf: node --test test/recipes.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.PUID = '0';
const { db, now } = require('../src/db');
const rz = require('../src/recipes');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('Zutatenzeilen: Menge, Bereich, Bruch, Einheit, Hinweis, Überschrift', () => {
  assert.deepEqual(rz.parseLine('1 1/2 EL Zucker, fein'), { a: 1.5, a2: null, u: 'EL', n: 'Zucker', note: 'fein' });
  assert.deepEqual(rz.parseLine('½ Bund Petersilie (glatt)'), { a: 0.5, a2: null, u: 'Bund', n: 'Petersilie', note: 'glatt' });
  assert.deepEqual(rz.parseLine('2-3 Zehen Knoblauch'), { a: 2, a2: 3, u: 'Zehen', n: 'Knoblauch', note: '' });
  assert.deepEqual(rz.parseLine('250g Mehl'), { a: 250, a2: null, u: 'g', n: 'Mehl', note: '' });
  assert.deepEqual(rz.parseLine('0,5 l Milch'), { a: 0.5, a2: null, u: 'l', n: 'Milch', note: '' });
  assert.deepEqual(rz.parseLine('3 Eier'), { a: 3, a2: null, u: '', n: 'Eier', note: '' });
  assert.deepEqual(rz.parseLine('Salz und Pfeffer'), { a: null, a2: null, u: '', n: 'Salz und Pfeffer', note: '' });
  assert.deepEqual(rz.parseLine('Für den Teig:'), { g: 'Für den Teig' });
  assert.equal(rz.parseLine('   '), null);
  assert.equal(rz.parseIngredients('a\n\nb\n- c').length, 3);
  assert.equal(rz.ingredientText(rz.parseLine('1 1/2 EL Zucker, fein')), '1½ EL Zucker, fein');
});

test('Mengen: Brüche bei Löffeln, glatte Gramm, Komma', () => {
  assert.equal(rz.fmtAmount(1.5, 'EL'), '1½');
  assert.equal(rz.fmtAmount(0.25, ''), '¼');
  assert.equal(rz.fmtAmount(2 / 3, 'TL'), '⅔');
  assert.equal(rz.fmtAmount(1.5, 'kg'), '1,5');
  assert.equal(rz.fmtAmount(333.33, 'g'), '335');
  assert.equal(rz.fmtAmount(12.4, ''), '12');
  assert.equal(rz.fmtAmount(null), '');
});

test('Schritte: Zeiten werden Wecker, Text bleibt sicher', () => {
  const h = rz.stepHtml('<b>Teig</b> 10 Minuten ruhen, dann 1–2 Std. backen und 30 Sek. warten');
  assert.match(h, /^&lt;b&gt;Teig&lt;\/b&gt;/);
  assert.match(h, /data-timer="600"[^>]*>⏱ 10 Minuten</);
  assert.match(h, /data-timer="7200"/);
  assert.match(h, /data-timer="30"/);
  assert.equal(rz.parseSteps('1. Erst\n2) Dann\n\n- Zuletzt').join('|'), 'Erst|Dann|Zuletzt');
});

test('Übernehmen: schema.org/Recipe aus JSON-LD, auch in @graph', () => {
  const ld = {
    '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', name: 'Seite' }, {
      '@type': ['Recipe'], name: 'Käsespätzle &amp; Zwiebeln', description: '<p>Allgäuer Art</p>', recipeYield: ['4', '4 Portionen'],
      prepTime: 'PT30M', cookTime: 'PT1H15M', recipeIngredient: ['500 g Mehl', '5 Eier'], keywords: 'Käse, schnell', recipeCategory: 'Hauptgericht',
      recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Teig rühren.' }, { '@type': 'HowToStep', text: 'Schaben.' }] }],
    }],
  };
  const html = `<html><head><script type="application/ld+json">{kaputt</script><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`;
  const r = rz.fromJsonLd(html, 'https://example.org/spaetzle');
  assert.equal(r.title, 'Käsespätzle & Zwiebeln');
  assert.equal(r.summary, 'Allgäuer Art');
  assert.equal(r.servings, 4);
  assert.equal(r.prep_min, 30);
  assert.equal(r.cook_min, 75);
  assert.equal(r.ingredients_text, '500 g Mehl\n5 Eier');
  assert.equal(r.steps_text, 'Teig rühren.\nSchaben.');
  assert.equal(r.tags, 'Hauptgericht, Käse, schnell');
  assert.equal(r.source_url, 'https://example.org/spaetzle');
  assert.equal(rz.fromJsonLd('<html>kein Rezept</html>'), null);
  assert.equal(rz.isoMinutes('P1DT2H'), 26 * 60);
});

test('Einkaufsliste: Portionen umgerechnet, gleiche Zutaten zusammen, abhaken', () => {
  const u = { id: Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('koch', 'x', 'user', ?)").run(now()).lastInsertRowid), isAdmin: false, canWrite: true };
  const a = rz.create(u, { title: 'Salat', servings: '4', ingredients_text: '1 kg Kartoffeln\n1 Zwiebel\n2 EL Essig\nSalz' }, 'public');
  const b = rz.create(u, { title: 'Kuchen', servings: '2', ingredients_text: '2 Zwiebeln\n200 g Mehl' }, 'public');
  assert.equal(rz.addToShopping(u, a, 8), 4);
  rz.addToShopping(u, b, 2);
  assert.equal(rz.addItem(u, '1 Prise Salz'), true);
  assert.equal(rz.addItem(u, 'Für den Teig:'), false);
  const list = rz.shopping(u), by = n => list.find(i => i.name === n);
  assert.equal(by('Kartoffeln').amountText, '2');
  assert.equal(by('Zwiebel').amountText, '4', 'Einzahl und Mehrzahl zählen zusammen');
  assert.deepEqual(by('Zwiebel').from.map(f => f.title).sort(), ['Kuchen', 'Salat']);
  assert.equal(by('Essig').amountText, '4');
  assert.equal(list.filter(i => /^Salz/.test(i.name)).length, 2, 'ohne Menge und mit Prise bleiben getrennt');
  rz.setDone(u, by('Zwiebel').ids.join(','), true);
  assert.equal(rz.shopping(u).find(i => i.name === 'Zwiebel').done, true);
  assert.equal(rz.shoppingCount(u), list.length - 1);
  rz.clearDone(u);
  assert.equal(rz.shopping(u).some(i => i.name === 'Zwiebel'), false);
  // Rezept löschen: Liste behält die Zutaten, Favoriten gehen mit
  assert.equal(rz.toggleFav(u, a), true);
  rz.remove(a);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recipe_favs').get().n, 0);
  assert.ok(rz.shopping(u).some(i => i.name === 'Kartoffeln'));
});
