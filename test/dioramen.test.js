'use strict';
// Dancors Dioramen (src/dioramen.js): Aufbau der Seite, Steckbrief und Mods aus dem Formular, Kacheln und Bauwerke,
// Umzug aus Update 98, Sichtbarkeit, Suche, oben groß, Karten in den Downloads.
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

test('Anlegen: Adresse, Startkacheln mit dem ersten Text', () => {
  const hof = dio.create(admin, { title: 'Hof Lindenau', game: 'FS25', body_md: 'Hallo' });
  assert.equal(hof.slug, 'hof-lindenau');
  assert.equal(dio.create(admin, { title: 'Hof Lindenau' }).slug, 'hof-lindenau-2');
  assert.equal(dio.create(admin, { title: 'Neu' }).slug, 'neu-1', 'reservierte Adresse');
  assert.throws(() => dio.create(admin, { title: '  ' }), /Titel/);
  const t = dio.tiles(hof);
  assert.deepEqual(t.map(x => x.type), ['text', 'dl', 'facts', 'mods']);
  assert.equal(t[0].md, 'Hallo');
});

test('Kacheln: Raster, Arten, Bauwerke, Kartenziele', () => {
  const blds = dio.normBuildings([{ id: 'b1', name: 'Stall', color: 'lila' }, { id: 'b1', name: 'doppelt' }, { id: 'x', name: 'falsch' }, { id: 'b2', name: '  ' }, { id: 'b3', name: 'Silo', color: 'quatsch' }]);
  assert.deepEqual(blds.map(b => b.id), ['b1', 'b3']);
  assert.equal(blds[0].color, 'lila');
  assert.ok(Object.hasOwn(dio.COLORS, blds[1].color));
  const t = dio.normTiles([
    { id: 't1', type: 'text', x: 11, y: 0, w: 5, h: 99, md: 'x', bw: 'b1' },
    { id: 't2', type: 'head', x: 1, y: 3, w: 12, h: 2 },               // Überschrift ohne Bauwerk fällt weg
    { id: 't3', type: 'img', x: 1, y: 2, w: 3, h: 3, f: '../boese.png', bw: 'b9' },
    { id: 't4', type: 'map', x: 1, y: 9, w: 8, h: 8, f: 'k.png', points: [{ x: 150, y: 20, to: 'b1' }, { x: 5, y: 5, to: 't99' }, { x: 'a', y: 1 }] },
    { id: 't5', type: 'video', x: 1, y: 20, url: 'javascript:alert(1)' },
    { id: 't6', type: 'quatsch' }, { id: 't1', type: 'text' },
  ], blds);
  assert.deepEqual(t.map(x => x.id), ['t1', 't3', 't4', 't5']);
  assert.deepEqual([t[0].x, t[0].y, t[0].w, t[0].h, t[0].bw], [8, 1, 5, 40, 'b1'], 'passt ins Raster');
  assert.equal(t[1].f, null); assert.equal(t[1].bw, null);
  assert.deepEqual(t[2].points, [{ x: 100, y: 20, label: '', to: 'b1' }, { x: 5, y: 5, label: '', to: '' }]);
  assert.equal(t[3].url, '');
  assert.equal(dio.videoInfo('https://youtu.be/dQw4w9WgXcQ').thumb, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  // Überdecken: die spätere Kachel rutscht nach unten, Lücken bleiben
  const s = dio.settle([{ id: 'a', x: 1, y: 1, w: 6, h: 4 }, { id: 'b', x: 4, y: 2, w: 6, h: 2 }, { id: 'c', x: 1, y: 20, w: 2, h: 2 }]);
  assert.deepEqual(s.map(x => [x.id, x.y]), [['a', 1], ['b', 5], ['c', 20]]);
});

test('Gestalten speichern: Dateien eines gelöschten Bauwerks gehören wieder dem Spielstand', () => {
  const d = dio.create(admin, { title: 'Baukasten' });
  dio.saveTiles(d, { buildings: [{ id: 'b1', name: 'Stall' }], tiles: [{ id: 't1', type: 'head', bw: 'b1', x: 1, y: 1, w: 12, h: 2 }, { id: 't2', type: 'dl', bw: 'b1', x: 1, y: 2, w: 6, h: 6 }] });
  let x = dio.byId(d.id);
  assert.deepEqual(dio.tiles(x).map(t => [t.id, t.y]), [['t1', 1], ['t2', 3]], 'überdeckte Kachel rutscht nach unten');
  const fid = dio.addFile(admin, x, fakeFile('stall.zip'), { file_bw: 'b1' });
  assert.equal(dio.fileById(fid).bw, 'b1');
  assert.equal(dio.addFile(admin, x, fakeFile('x.zip'), { file_bw: 'b7' }) && dio.files(x)[0].bw, null, 'unbekanntes Bauwerk');
  const pg = dio.page(null, x);
  assert.equal(pg.tiles.find(r => r.t.type === 'dl').files.length, 1, 'Download-Kachel des Bauwerks zeigt nur seine Datei');
  dio.saveTiles(x, { buildings: [], tiles: [] });
  assert.equal(dio.fileById(fid).bw, null);
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

test('Übersicht: Sichtbarkeit, Filter, Suche auch nach Bauwerken, oben groß, ausgeblendet', () => {
  db.exec('DELETE FROM dioramen');
  const gast = null, anna = user({ write: true }), bert = user();
  const a = dio.create(admin, { title: 'Alpha', game: 'FS25', pinned: 1 });
  const b = dio.create(anna, { title: 'Beta', game: 'Minecraft' }, { visibility: 'members' });
  const c = dio.create(anna, { title: 'Gamma', game: 'FS25' }, { visibility: 'private' });
  dio.saveTiles(a, { buildings: [{ id: 'b1', name: 'Kuhstall' }], tiles: [{ id: 't1', type: 'head', bw: 'b1', x: 1, y: 1, w: 12, h: 2 }] });
  let v = dio.view(gast);
  assert.equal(v.hero.title, 'Alpha');
  assert.deepEqual(v.hero.buildings.map(x => x.name), ['Kuhstall']);
  assert.deepEqual(v.cards.map(r => r.title), [], 'Beta nur für Mitglieder, Gamma privat');
  v = dio.view(bert);
  assert.deepEqual(v.cards.map(r => r.title), ['Beta']);
  v = dio.view(anna);
  assert.deepEqual(v.cards.map(r => r.title).sort(), ['Beta', 'Gamma'], 'eigene private Spielstände');
  assert.ok(dio.canEdit(anna, c) && !dio.canEdit(bert, c) && !dio.canEdit(anna, a));
  v = dio.view(admin, { spiel: 'FS25' });
  assert.equal(v.hero, null, 'gefiltert ohne großen Eintrag');
  assert.deepEqual(v.cards.map(r => r.title), ['Alpha', 'Gamma']);
  assert.deepEqual(dio.view(gast, { q: 'kuhst' }).cards.map(r => r.title), ['Alpha'], 'findet das Bauwerk');
  assert.equal(dio.view(admin).counts.bauwerk, 1);
  const hit = dio.search(gast, 'kuhstall');
  assert.deepEqual(hit.map(h => h.url), ['/dioramen/alpha#bw-b1']);
  // Ausblenden und Reihenfolge im Bearbeiten-Modus
  dio.saveLayout({ order: ['d' + c.id, 'd' + b.id], hidden: ['d' + b.id], hero: 'aus', cards: [{ key: 'd' + a.id, title: 'Alpha 2', summary: 'Neu', pin: false }] });
  assert.equal(dio.byId(a.id).title, 'Alpha 2');
  assert.equal(dio.byId(a.id).pinned, 0);
  assert.deepEqual(dio.view(bert).cards.map(r => r.title), ['Alpha 2'], 'Beta ausgeblendet');
  const arr = dio.view(admin);
  assert.ok(arr.canArrange);
  assert.deepEqual(arr.cards.map(r => r.title), ['Alpha 2', 'Gamma', 'Beta'], 'noch nicht einsortierte (neue) zuerst, dann die eigene Reihenfolge');
  assert.equal(dio.stats(admin).spielstand, 2, 'ausgeblendete zählen nicht');
  assert.match(dio.search(bert, 'alpha')[0].url, /^\/dioramen\/alpha$/);
  assert.equal(dio.search(gast, 'gamma').length, 0);
});

test('Umzug aus Update 98: Bauwerke wandern mit Bildern, Dateien und Kartenpunkt in ihren Spielstand', () => {
  db.exec('DELETE FROM dioramen');
  const t = now();
  const ins = (o) => Number(db.prepare(`INSERT INTO dioramen(slug, kind, parent_id, title, summary, body_md, images, cover, plan, pins, before_img, after_img, mods, facts, visibility, author_id, created_at, updated_at, tiles_v)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, 0)`).run(o.slug, o.kind, o.parent || null, o.title, o.summary || '', o.body || '', JSON.stringify(o.images || []), o.cover || null,
    o.plan || null, JSON.stringify(o.pins || {}), o.before || null, o.after || null, JSON.stringify(o.mods || []), JSON.stringify(o.facts || []), admin.id, t, t).lastInsertRowid);
  const hof = ins({ slug: 'althof', kind: 'spielstand', title: 'Althof', body: 'Text vom Hof', images: [{ f: 'h1.png', cap: '' }, { f: 'h2.png', cap: '' }], plan: 'plan.png', mods: [{ name: 'Seasons' }] });
  const stall = ins({ slug: 'altstall', kind: 'bauwerk', parent: hof, title: 'Altstall', summary: 'Für Kühe', body: 'Stalltext', images: [{ f: 's1.png', cap: 'vorne' }], before: 'v.png', after: 'n.png', facts: [['Größe', '40 m']], mods: [{ name: 'seasons' }, { name: 'Zäune' }] });
  ins({ slug: 'burg', kind: 'bauwerk', title: 'Burg', body: 'Allein' });
  db.prepare('UPDATE dioramen SET pins = ? WHERE id = ?').run(JSON.stringify({ [stall]: [30, 40] }), hof);
  db.prepare("INSERT INTO dio_files(dio_id, original_name, stored_name, size, created_at) VALUES (?, 'stall.zip', 'x1', 5, ?)").run(stall, t);
  dio.migrate();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dioramen').get().n, 2, 'der Stall ist kein eigener Eintrag mehr');
  const h = dio.byId(hof);
  assert.deepEqual(dio.buildings(h).map(b => [b.id, b.name, b.text]), [['b1', 'Altstall', 'Für Kühe']]);
  const tl = dio.tiles(h);
  const types = tl.map(x => x.type + (x.bw ? ':' + x.bw : ''));
  for (const want of ['text', 'dl', 'gal', 'map', 'facts', 'mods', 'head:b1', 'img:b1', 'text:b1', 'cmp:b1', 'dl:b1']) assert.ok(types.includes(want), want + ' fehlt: ' + types.join(' '));
  assert.deepEqual(tl.find(x => x.type === 'map').points, [{ x: 30, y: 40, label: '', to: 'b1' }]);
  assert.match(tl.find(x => x.type === 'text' && x.bw === 'b1').md, /Stalltext[\s\S]*\*\*Größe:\*\* 40 m/);
  assert.deepEqual(dio.mods(h).map(m => m.name), ['Seasons', 'Zäune'], 'Mods ohne Doppelte');
  assert.ok(dio.images(h).some(i => i.f === 's1.png'));
  assert.equal(db.prepare("SELECT bw, dio_id FROM dio_files WHERE stored_name = 'x1'").get().bw, 'b1');
  assert.deepEqual({ ...dio.moved('altstall') }.bw, 'b1');
  const burg = dio.bySlug('burg');
  assert.equal(burg.kind, 'spielstand');
  assert.deepEqual(dio.buildings(burg).map(b => b.name), ['Burg'], 'allein stehendes Bauwerk wird ein Beitrag mit einem Bauwerk');
  assert.equal(dio.migrate(), 0, 'nur einmal');
});

test('Dateien und Downloads-Karten', () => {
  db.exec('DELETE FROM dioramen');
  const d = dio.create(admin, { title: 'Mit Datei', in_downloads: 1 });
  const ohne = dio.create(admin, { title: 'Ohne Haken' });
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
