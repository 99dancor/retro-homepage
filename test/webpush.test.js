'use strict';
// Web Push: Nachricht beim eigenen Test-Push-Dienst annehmen, VAPID-Anmeldung prüfen und wie ein Browser entschlüsseln
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'));
process.env.PUID = '0';
const webpush = require('../src/webpush');

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// Gegenstück zu encrypt(), so wie es der Browser rechnet (RFC 8291)
function decrypt(buf, ua, authSecret) {
  const salt = buf.subarray(0, 16), idlen = buf[20], asPub = buf.subarray(21, 21 + idlen), body = buf.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'Ende-Markierung des letzten Blocks');
  return plain.subarray(0, -1).toString();
}

test('Push wird verschlüsselt, mit VAPID angemeldet und lässt sich entschlüsseln', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  let got;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { got = { headers: req.headers, body: Buffer.concat(chunks) }; res.writeHead(201).end(); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`;
  const sub = { endpoint, p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
  const status = await webpush.send(sub, { title: 'Hallo', body: 'Welt ✓' }, { subject: 'mailto:test@example.org' });
  server.close();
  assert.equal(status, 201);
  assert.equal(got.headers['content-encoding'], 'aes128gcm');
  assert.equal(got.headers.ttl, '86400');
  assert.deepEqual(JSON.parse(decrypt(got.body, ua, authSecret)), { title: 'Hallo', body: 'Welt ✓' });

  // Authorization: vapid t=<JWT>, k=<öffentlicher Schlüssel>; die Signatur passt zum Schlüssel
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(got.headers.authorization);
  assert.ok(m);
  assert.equal(m[2], webpush.publicKey());
  const [h, c, sig] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.equal(claims.sub, 'mailto:test@example.org');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const raw = Buffer.from(m[2], 'base64url');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.equal(webpush.publicKey(), m[2], 'Schlüssel bleibt gleich');
});

test('Haustier-Erinnerung: eine für alle Tiere, ein Push bis gelesen, nachts Ruhe, morgens ein Gruß', async () => {
  const { db, now } = require('../src/db');
  const notify = require('../src/notify');
  const petwatch = require('../src/petwatch');
  const state = await import('../games/haustier/src/js/state.js');
  const pets = await import('../games/haustier/src/js/pets.js');
  db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('tierfreund', 'x', 'user', ?)").run(now());
  const uid = db.prepare("SELECT id FROM users WHERE username = 'tierfreund'").get().id;
  const t = new Date(2026, 9, 16, 19, 0).getTime();
  const H = 3600e3;
  // Spielstand, zuletzt gespeichert um saved; Werte gelten ab t (kein Absinken bis dahin)
  const save = (saved, fn = () => {}) => {
    const s = state.newState(t - 3 * 86400e3);
    s.extraSlots = 1;
    pets.adopt(s, 'cat', 'ginger', 'Mimi', t - 3 * 86400e3);
    pets.adopt(s, 'dog', 'brown', 'Bello', t - 3 * 86400e3);
    s.pets[0].stats = { love: 60, fun: 60, food: 15, water: 12, rest: 60, joy: 50 };
    s.pets[1].stats = { love: 60, fun: 18, food: 60, water: 60, rest: 60, joy: 50 };
    for (const p of s.pets) p.tickAt = t;
    s.visits = { total: 5, streak: 5, best: 5, lastDay: state.dayKey(t - 86400e3) };
    s.updatedAt = saved;
    fn(s);
    return JSON.stringify(s);
  };
  const petRows = () => notify.list(uid, 50).filter(n => n.kind === 'pet');
  const data = save(t - 2 * H);
  petwatch.check(uid, data, t);
  petwatch.check(uid, data, t + 15 * 60e3);
  let rows = petRows();
  assert.equal(rows.length, 1, 'eine Erinnerung für beide Tiere');
  assert.equal(rows[0].title, '🐾 Mimi hat Durst und Hunger, Bello langweilt sich');
  assert.equal(rows[0].count, 1, 'gleicher Stand: nichts Neues');
  const daily = notify.list(uid).filter(n => n.kind === 'daily');
  assert.equal(daily.length, 1);
  assert.match(daily[0].title, /Besuchsserie von 5 Tagen endet um Mitternacht/);

  // Gelesen, aber nicht gespielt: dasselbe kommt erst nach 6 Stunden wieder, etwas Neues sofort
  notify.markRead(uid);
  petwatch.check(uid, data, t + 1 * H);
  assert.equal(petRows().length, 1);
  petwatch.check(uid, save(t - 2 * H, (s) => { s.pets[1].stats.love = 10; }), t + 1.5 * H);
  rows = petRows();
  assert.equal(rows.length, 2, 'Bello fühlt sich jetzt auch einsam');
  assert.match(rows[0].title, /Bello fühlt sich einsam und langweilt sich/);
  // Ungelesen: weitere Änderungen nur still im Text
  petwatch.check(uid, data, t + 2 * H);
  rows = petRows();
  assert.equal(rows.length, 2);
  assert.doesNotMatch(rows[0].title, /einsam/, 'Text angepasst');
  assert.equal(rows[0].count, 1);
  // Spiel geöffnet: die offene Erinnerung gilt als gelesen
  petwatch.seen(uid);
  assert.ok(petRows().every(n => n.read_at));

  // Nachts nichts
  petwatch.check(uid, save(t - 2 * H), new Date(2026, 9, 16, 23, 30).getTime());
  assert.equal(petRows().length, 2);
  // Morgens ein Gruß, einmal
  const morning = new Date(2026, 9, 17, 8, 30).getTime();
  const night = save(t, (s) => { for (const p of s.pets) { p.tickAt = t; p.stats = { love: 80, fun: 80, food: 90, water: 90, rest: 70, joy: 80 }; } s.visits.lastDay = state.dayKey(t); s.visits.streak = 6; });
  petwatch.check(uid, night, morning);
  petwatch.check(uid, night, morning + 15 * 60e3);
  rows = petRows().filter(n => n.key.startsWith('pet:morgen:'));
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /^☀️ Guten Morgen! /);
  assert.match(rows[0].body, /Tag 7 deiner Besuchsserie/);
});

test('Haustier-Erinnerung: Wer aus vollen Näpfen frisst, wird nicht gemeldet', async () => {
  const { db, now } = require('../src/db');
  const notify = require('../src/notify');
  const petwatch = require('../src/petwatch');
  const state = await import('../games/haustier/src/js/state.js');
  const pets = await import('../games/haustier/src/js/pets.js');
  db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('napffreund', 'x', 'user', ?)").run(now());
  const uid = db.prepare("SELECT id FROM users WHERE username = 'napffreund'").get().id;
  const t = new Date(2026, 9, 16, 15, 0).getTime();
  const s = state.newState(t - 86400e3);
  pets.adopt(s, 'cat', 'ginger', 'Mimi', t - 86400e3);
  s.pets[0].stats = { love: 60, fun: 60, food: 15, water: 12, rest: 60, joy: 50 };
  s.pets[0].tickAt = t - 60e3;
  s.inventory.furn_bowl_food = 1; s.inventory.furn_bowl_water = 1;
  s.place = { furn_bowl_food: { at: 'room', x: 0.5, y: 0.5 }, furn_bowl_water: { at: 'desk', x: 0.4, y: 1 } };
  s.bowls = { food: { item: 'food_tuna', left: 1 }, water: 1 };
  s.updatedAt = t - 3600e3;
  petwatch.check(uid, JSON.stringify(s), t);
  assert.equal(notify.list(uid).filter(n => n.kind === 'pet').length, 0);
});
