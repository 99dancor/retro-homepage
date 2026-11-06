'use strict';
// Galerie ohne Browser: Aufnahmedatum lesen, GPS entfernen, Sichtbarkeit von Alben und Bildern, ZIP eines Albums (src/gallery.js).
// Aufruf: node --test test/gallery.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Writable } = require('node:stream');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-test-'));
process.env.PUID = '0';
const gal = require('../src/gallery');
const { db, now } = require('../src/db');

// Kleinstes JPEG (1 × 1 Pixel) mit EXIF: Aufnahmedatum und ein GPS-Block, so wie ein Handy es schreibt
const PIXEL = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
function withExif(jpeg, date) {
  const be16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const entry = (tag, type, count, value) => Buffer.concat([be16(tag), be16(type), be32(count), value]);
  // TIFF-Kopf (8) + IFD0 mit 2 Einträgen (2 + 24 + 4) = 38, Exif-IFD bei 38 mit 1 Eintrag (18) = 56, GPS-IFD bei 56 mit 1 Eintrag (18) = 74, Datum bei 74
  const ifd0 = Buffer.concat([be16(2), entry(0x8769, 4, 1, be32(38)), entry(0x8825, 4, 1, be32(56)), be32(0)]);
  const exif = Buffer.concat([be16(1), entry(0x9003, 2, 20, be32(74)), be32(0)]);
  const gps = Buffer.concat([be16(1), entry(0x0001, 2, 2, Buffer.from('N\0\0\0', 'latin1')), be32(0)]);
  const tiff = Buffer.concat([Buffer.from('MM\0\x2a', 'latin1'), be32(8), ifd0, exif, gps, Buffer.from(date + '\0', 'latin1')]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), be16(body.length + 2), body, jpeg.subarray(2)]);
}

test('Aufnahmedatum aus EXIF, GPS fliegt beim Säubern raus', async () => {
  const img = withExif(PIXEL, '2026:08:14 19:30:05');
  assert.equal(gal.imageType(img), 'jpg');
  const t = gal.exifDate(img);
  assert.ok(t, 'Datum gefunden');
  const d = new Date(t * 1000);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 8, 14, 19, 30]);
  const p = await gal.prepare(img, { keepDate: true });
  assert.equal(p.ext, 'jpg');
  assert.equal(p.taken, t);
  assert.ok(!p.data.includes(Buffer.from('Exif\0\0', 'latin1')), 'kein EXIF-Block mehr');
  assert.equal(p.w, 1);
  const q = await gal.prepare(img, { keepDate: false });
  assert.equal(q.taken, null, 'ohne Haken kein Datum');
  assert.equal(gal.exifDate(PIXEL), null);
  assert.equal(gal.parseExifTime('0000:00:00 00:00:00'), null);
  await assert.rejects(gal.prepare(Buffer.from('<svg></svg>')), /kein Bild/);
});

test('Sichtbarkeit: Album bestimmt, Freunde, Besitzer und Admin', () => {
  const mk = name => Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', 'user', ?)").run(name, now()).lastInsertRowid);
  const anna = mk('anna'), bernd = mk('bernd'), carl = mk('carl');
  db.prepare('INSERT INTO friends(user_id, friend_id, accepted, created_at) VALUES (?, ?, 1, ?)').run(anna, bernd, now());
  const U = id => ({ id, isAdmin: false });
  const album = vis => Number(db.prepare('INSERT INTO gal_albums(owner_id, title, visibility, shared, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(anna, 'A ' + vis, vis, now(), now()).lastInsertRowid);
  const photo = (owner, albumId, vis) => Number(db.prepare(`INSERT INTO gal_photos(owner_id, album_id, title, stored_name, ext, size, visibility, created_at)
    VALUES (?, ?, 'x', ?, 'jpg', 1, ?, ?)`).run(owner, albumId, 'a'.repeat(32), vis, now()).lastInsertRowid);
  const fr = album('friends'), pub = album('public'), priv = album('private');
  const inFriends = photo(carl, fr, 'public');      // Carl legt ein Bild in Annas Freunde-Album: es gilt das Album
  const inPub = photo(anna, pub, 'private');
  const inPriv = photo(anna, priv, 'public');
  const loose = photo(bernd, null, 'members');
  const sees = (user, id) => gal.canSeePhoto(user, gal.getPhoto(id));
  assert.ok(sees(U(bernd), inFriends), 'Freund der Albumbesitzerin');
  assert.ok(!sees(null, inFriends), 'Gast nicht');
  assert.ok(sees(U(carl), inFriends), 'eigenes Bild immer');
  assert.ok(sees(null, inPub), 'öffentliches Album für Gäste');
  assert.ok(!sees(U(bernd), inPriv), 'privates Album nur für die Besitzerin');
  assert.ok(sees({ id: 999, isAdmin: true }, inPriv), 'Admin sieht alles');
  assert.ok(sees(U(carl), loose) && !sees(null, loose), 'ohne Album: eigene Einstellung');
  // SQL-Liste und Einzelprüfung stimmen überein
  for (const user of [null, U(anna), U(bernd), U(carl)]) {
    const listed = gal.photos(user).map(p => p.id).sort();
    const single = [inFriends, inPub, inPriv, loose].filter(id => sees(user, id)).sort();
    assert.deepEqual(listed, single, 'Liste für ' + (user ? user.id : 'Gast'));
  }
  // Hinzufügen: gemeinsames Album für alle, die es sehen; privates nie für andere
  assert.ok(gal.canAddTo(U(bernd), gal.getAlbum(fr)));
  assert.ok(!gal.canAddTo(U(carl), gal.getAlbum(fr)), 'Carl ist kein Freund');
  assert.ok(!gal.canAddTo(U(bernd), gal.getAlbum(priv)));
  assert.ok(!gal.canAddTo(null, gal.getAlbum(pub)));
  // Fremde Bilder: Albumbesitzerin darf sie aus dem Album nehmen, aber nicht ändern
  assert.ok(gal.canRemoveFromAlbum(U(anna), gal.getPhoto(inFriends)));
  assert.ok(!gal.canEditPhoto(U(anna), gal.getPhoto(inFriends)));
});

test('Album als ZIP: gültiges Archiv mit allen Dateien', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-zip-'));
  const files = [['a.jpg', 'Hallo Welt'], ['a.jpg', 'Zweite Datei mit gleichem Namen'], ['ö ü.png', Buffer.alloc(70000, 7)]].map(([name, body], i) => {
    fs.writeFileSync(path.join(dir, String(i)), body);
    return { path: path.join(dir, String(i)), name, time: 1786000000 };
  });
  const chunks = [];
  const res = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); } });
  res.set = () => res; res.attachment = () => res;
  const done = new Promise(r => res.on('finish', r));
  gal.zipTo(res, files, 'Album.zip');
  await done;
  const zip = Buffer.concat(chunks);
  // Ende des zentralen Verzeichnisses lesen und alle Einträge prüfen
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0);
  const n = zip.readUInt16LE(eocd + 10), cd = zip.readUInt32LE(eocd + 16);
  assert.equal(n, 3);
  const names = [];
  for (let i = 0, o = cd; i < n; i++) {
    assert.equal(zip.readUInt32LE(o), 0x02014b50);
    const crc = zip.readUInt32LE(o + 16), size = zip.readUInt32LE(o + 20), nl = zip.readUInt16LE(o + 28), el = zip.readUInt16LE(o + 30), cl = zip.readUInt16LE(o + 32), lo = zip.readUInt32LE(o + 42);
    const name = zip.toString('utf8', o + 46, o + 46 + nl);
    names.push(name);
    const lnl = zip.readUInt16LE(lo + 26), lel = zip.readUInt16LE(lo + 28), data = zip.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + size);
    assert.equal(zlib.crc32(data) >>> 0, crc >>> 0, 'CRC von ' + name);
    o += 46 + nl + el + cl;
  }
  assert.deepEqual(names, ['a.jpg', 'a (2).jpg', 'ö ü.png']);
});
