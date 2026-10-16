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

test('Haustier-Erinnerung: hungriges Tier und offene Besuchsserie, je einmal am Tag', async () => {
  const { db, now } = require('../src/db');
  const notify = require('../src/notify');
  const petwatch = require('../src/petwatch');
  const state = await import('../games/haustier/src/js/state.js');
  const pets = await import('../games/haustier/src/js/pets.js');
  db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('tierfreund', 'x', 'user', ?)").run(now());
  const uid = db.prepare("SELECT id FROM users WHERE username = 'tierfreund'").get().id;
  const t = new Date(2026, 9, 16, 19, 0).getTime();
  const s = state.newState(t - 3 * 86400e3);
  pets.adopt(s, 'cat', 'ginger', 'Mimi', t - 3 * 86400e3);
  s.visits = { total: 5, streak: 5, best: 5, lastDay: state.dayKey(t - 86400e3) };
  const data = JSON.stringify(s);
  petwatch.check(uid, data, t);
  petwatch.check(uid, data, t + 15 * 60e3);
  const items = notify.list(uid);
  assert.equal(items.filter(n => n.kind === 'daily').length, 1);
  assert.match(items.find(n => n.kind === 'daily').title, /Besuchsserie von 5 Tagen endet um Mitternacht/);
  const pet = items.filter(n => n.kind === 'pet');
  assert.ok(pet.length >= 1, 'nach drei Tagen ohne Pflege braucht Mimi etwas');
  assert.match(pet[0].title, /^🐾 Mimi /);
  assert.equal(new Set(pet.map(n => n.key)).size, pet.length, 'jede Erinnerung nur einmal');
});
