'use strict';
// Web Push ohne Zusatzpaket: VAPID-Anmeldung (RFC 8292) und verschlüsselte Nachricht (RFC 8291, aes128gcm).
// Die Schlüssel der Seite entstehen beim ersten Bedarf und liegen in den Einstellungen.
const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');

const b64u = b => Buffer.from(b).toString('base64url');

function vapidKeys() {
  let pub = getSetting('vapid_public'), priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    pub = b64u(ecdh.getPublicKey()); priv = b64u(ecdh.getPrivateKey());
    setSetting('vapid_public', pub); setSetting('vapid_private', priv);
  }
  return { pub, priv };
}
const publicKey = () => vapidKeys().pub;

function signingKey({ pub, priv }) {
  const raw = Buffer.from(pub, 'base64url');
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: priv }, format: 'jwk' });
}
// Kurzlebige Anmeldung beim Push-Dienst des Browsers (JWT mit ES256)
function vapidHeader(endpoint, subject) {
  const keys = vapidKeys();
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: signingKey(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.pub}`;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// Verschlüsselt die Nachricht für genau dieses Gerät (p256dh und auth kommen vom Browser)
function encrypt(payload, p256dh, authSecret) {
  const uaPub = Buffer.from(p256dh, 'base64url'), auth = Buffer.from(authSecret, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

// Gibt den HTTP-Status zurück. 404 und 410 heißen: Gerät abgemeldet, Abo löschen.
async function send(sub, data, { ttl = 24 * 3600, subject = 'mailto:admin@localhost' } = {}) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal', Authorization: vapidHeader(sub.endpoint, subject) },
    body: encrypt(JSON.stringify(data), sub.p256dh, sub.auth),
    signal: AbortSignal.timeout(10000),
  });
  return res.status;
}

module.exports = { publicKey, send, encrypt, vapidHeader };
