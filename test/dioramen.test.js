'use strict';
// Dancors Dioramen (src/dioramen.js): Aufbau der Seite, Steckbrief und Mods aus dem Formular, Lageplan-Nummern,
// Sichtbarkeit, oben groß, Karten in den Downloads.
// Aufruf: node --test test/dioramen.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dio-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.PUID = '0';
const { db, now, UPLOAD_DIR } = require('../src/db');
const dio = require('../src/dioramen');
test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); setImmediate(() => process.exit(process.exitCode || 0)); });

let nextId = 0;
function user(opts = {}) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', ?, ?)").run('u' + ++nextId, opts.admin ? 'admin' : 'user', now()).lastInsertRowid);
  return { id, username: 'u' + nextId, isAdmin: !!opts.admin, canWrite: !!opts.admin || !!opts.write, groups: [] };
}
const admin = user({ admin: true });
function fakeFile(name, size = 10) {
  const stored = 't' + Math.random().toString(36).slice(2) + '.zip';
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.alloc(size));
  return { originalname: name, filename: stored, size, mimetype: 'application/zip' };
}

test('Aufbau: Vorgaben, nur gültige Schlüssel, Texte gekürzt', () => {
  const l = dio.normalize({ title: 'x'.repeat(200), hero: 'quatsch', sort: 'neu', order: ['d1', 'd1', 'p3', 'hub', 'd22'], hidden: ['<b>', 'd5'] });
  assert.equal(l.title.length, 80);
  assert.equal(l.hero, 'pin');
  assert.equal(l.sort, 'neu');
  assert.deepEqual(l.order, ['d1', 'd22']);
  assert.deepEqual(l.hidden, ['d5']);
  assert.equal(dio.normalize(null).title, 'Dancors Dioramen');
});

test('Steckbrief und Mods: leere Zeilen weg, Links nur http(s) oder hier', () => {
  assert.deepEqual(dio.factsFrom({ fact_k: ['Spielzeit', '', 'Felder'], fact_v: ['212 h', 'egal', '38'] }), [['Spielzeit', '212 h'], ['Felder', '38']]);
  assert.deepEqual(dio.factsFrom({ fact_k: 'Eine', fact_v: 'Zeile' }), [['Eine', 'Zeile']]);
  const m = dio.modsFrom({ mod_name: ['A', 'B', 'C', ''], mod_ver: ['1', '2', '3', '4'], mod_url: ['javascript:alert(1)', 'https://x.org/m', '/downloads/abc', 'https://y'] });
  assert.deepEqual(m, [{ name: 'A', ver: '1', url: '' }, { name: 'B', ver: '2', url: 'https://x.org/m' }, { name: 'C', ver: '3', url: '/downloads/abc' }]);
  assert.equal(dio.modsFrom({ mod_name: 'D', mod_url: '//boese.example' })[0].url, '');
});

test('Anlegen: Adresse, Bauwerk gehört nur zu einem Spielstand', () => {
  const hof = dio.create(admin, { kind: 'spielstand', title: 'Hof Lindenau', game: 'FS25' });
  assert.equal(hof.slug, 'hof-lindenau');
  assert.equal(dio.create(admin, { title: 'Hof Lindenau' }).slug, 'hof-lindenau-2');
  assert.equal(dio.create(admin, { title: 'Neu' }).slug, 'neu-1', 'reservierte Adresse');
  const stall = dio.create(admin, { kind: 'bauwerk', title: 'Stall', parent_id: hof.id });
  assert.equal(stall.parent_id, hof.id);
  const turm = dio.create(admin, { kind: 'bauwerk', title: 'Turm', parent_id: stall.id });
  assert.equal(turm.parent_id, null, 'ein Bauwerk ist kein Spielstand');
  assert.equal(dio.create(admin, { kind: 'spielstand', title: 'S', parent_id: hof.id }).parent_id, null);
  assert.throws(() => dio.create(admin, { title: '  ' }), /Titel/);
  // Wird der Spielstand ein Bauwerk, hängt nichts mehr an ihm
  dio.update(admin, dio.byId(hof.id), { kind: 'bauwerk', title: 'Hof Lindenau' });
  assert.equal(dio.byId(stall.id).parent_id, null);
});

test('Lageplan: nur eigene Bauwerke, Werte zwischen 0 und 100', () => {
  const hof = dio.create(admin, { kind: 'spielstand', title: 'Plan-Hof' });
  const a = dio.create(admin, { kind: 'bauwerk', title: 'A', parent_id: hof.id });
  const fremd = dio.create(admin, { kind: 'bauwerk', title: 'Fremd' });
  const out = dio.setPins(hof, JSON.stringify({ [a.id]: [150, -3.456], [fremd.id]: [10, 10], x: [1, 1] }));
  assert.deepEqual(out, { [a.id]: [100, 0] });
  assert.deepEqual(dio.pins(dio.byId(hof.id)), { [a.id]: [100, 0] });
  assert.deepEqual(dio.setPins(hof, 'kein json'), {});
});

test('Bilder: Reihenfolge, Unterschriften, Titelbild, neue Bilder hinten', () => {
  const d = dio.create(admin, { title: 'Bilderhof' });
  dio.setImages(d, { cover: 'new:1', new_cap: ['eins', 'zwei'] }, ['a.png', 'b.png']);
  let x = dio.byId(d.id);
  assert.deepEqual(dio.images(x), [{ f: 'a.png', cap: 'eins' }, { f: 'b.png', cap: 'zwei' }]);
  assert.equal(x.cover, 'b.png');
  // b nach vorne, a raus, eine neue dazu; fremde Namen werden ignoriert
  dio.setImages(x, { img: ['b.png', '../etc.png', 'gibtsnicht.png'], 'cap_b.png': 'Zwei!', cover: 'a.png' }, ['c.png']);
  x = dio.byId(d.id);
  assert.deepEqual(dio.images(x).map(i => i.f), ['b.png', 'c.png']);
  assert.equal(dio.images(x)[0].cap, 'Zwei!');
  assert.equal(x.cover, 'b.png', 'entferntes Titelbild: das erste Bild');
});

test('Übersicht: Sichtbarkeit, Filter, oben groß, ausgeblendet', () => {
  db.exec('DELETE FROM dioramen');
  const gast = null, anna = user({ write: true }), bert = user();
  const a = dio.create(admin, { kind: 'spielstand', title: 'Alpha', game: 'FS25', pinned: 1 });
  const b = dio.create(anna, { kind: 'bauwerk', title: 'Beta', game: 'Minecraft' }, { visibility: 'members' });
  const c = dio.create(anna, { kind: 'bauwerk', title: 'Gamma', game: 'FS25' }, { visibility: 'private' });
  let v = dio.view(gast);
  assert.equal(v.hero.title, 'Alpha');
  assert.deepEqual(v.cards.map(r => r.title), [], 'Beta nur für Mitglieder, Gamma privat');
  v = dio.view(bert);
  assert.deepEqual(v.cards.map(r => r.title), ['Beta']);
  v = dio.view(anna);
  assert.deepEqual(v.cards.map(r => r.title).sort(), ['Beta', 'Gamma'], 'eigene private Einträge');
  assert.ok(dio.canEdit(anna, c) && !dio.canEdit(bert, c) && !dio.canEdit(anna, a));
  v = dio.view(admin, { spiel: 'FS25' });
  assert.equal(v.hero, null, 'gefiltert ohne großen Eintrag');
  assert.deepEqual(v.cards.map(r => r.title), ['Alpha', 'Gamma']);
  assert.deepEqual(dio.view(admin, { typ: 'bauwerk' }).cards.map(r => r.title).sort(), ['Beta', 'Gamma']);
  // Ausblenden und Reihenfolge im Bearbeiten-Modus
  dio.saveLayout({ order: ['d' + c.id, 'd' + b.id], hidden: ['d' + b.id], hero: 'aus', cards: [{ key: 'd' + a.id, title: 'Alpha 2', summary: 'Neu', pin: false }] });
  assert.equal(dio.byId(a.id).title, 'Alpha 2');
  assert.equal(dio.byId(a.id).pinned, 0);
  assert.deepEqual(dio.view(bert).cards.map(r => r.title), ['Alpha 2'], 'Beta ausgeblendet');
  const arr = dio.view(admin);
  assert.ok(arr.canArrange);
  assert.deepEqual(arr.cards.map(r => r.title), ['Alpha 2', 'Gamma', 'Beta'], 'noch nicht einsortierte (neue) zuerst, dann die eigene Reihenfolge');
  assert.equal(dio.stats(admin).bauwerk, 1, 'ausgeblendete zählen nicht');
  assert.match(dio.search(bert, 'alpha')[0].url, /^\/dioramen\/alpha$/);
  assert.equal(dio.search(gast, 'gamma').length, 0);
});

test('Dateien und Downloads-Karten', () => {
  db.exec('DELETE FROM dioramen');
  const d = dio.create(admin, { kind: 'spielstand', title: 'Mit Datei', in_downloads: 1 });
  const ohne = dio.create(admin, { kind: 'spielstand', title: 'Ohne Haken' });
  assert.equal(dio.downloadCards(null).length, 0, 'ohne Datei keine Karte');
  dio.addFile(admin, d, fakeFile('a.zip', 100), { version: '1.0' });
  const id2 = dio.addFile(admin, d, fakeFile('b.zip', 300), { version: '1.1', changes: '- neu' });
  dio.addFile(admin, ohne, fakeFile('c.zip'), {});
  const cards = dio.downloadCards(null);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].dl, '/dioramen/dl/' + id2);
  assert.equal(cards[0].version, '1.1');
  // In Dancors Downloads steht die Karte, die Dateien selbst nicht
  const dl = require('../src/downloads').view(null, 'projekte', '');
  assert.ok(dl.cards.some(c => c.dio && c.title === 'Mit Datei'));
  assert.equal(require('../src/downloads').view(null, 'alle', '').rows.filter(r => r.type === 'file').length, 0);
  // Löschen nimmt die Dateien mit
  const stored = dio.files(d).map(f => f.stored_name);
  dio.remove(dio.byId(d.id));
  assert.ok(stored.every(s => !fs.existsSync(path.join(UPLOAD_DIR, s))));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dio_files WHERE dio_id = ?').get(d.id).n, 0);
});
