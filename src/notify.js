'use strict';
// Benachrichtigungen: landen hinter der 🔔 neben der Uhr, auf der Startseite und auf Wunsch als Push auf Handy
// oder Browser. Was ein Mitglied bekommt, stellt es unter Konto und Passwort → Benachrichtigungen je Art ein.
const { db, now, getSetting } = require('./db');
const webpush = require('./webpush');

// Arten: Name in den Einstellungen, Vorgabe für Glocke und Push, nur für Admins?
const KINDS = {
  friend: { label: '👥 Freundschaftsanfragen', site: true, push: true },
  pm: { label: '💬 Nachrichten im Messenger (ICU/DSN)', site: true, push: true },
  invite: { label: '🎲 Einladungen zu Spielen und Lobbys', site: true, push: true },
  board: { label: '💬 Antworten in abonnierten Forenthemen', site: true, push: true },
  highscore: { label: '🏆 Geknackte Rekorde', site: true, push: true },
  pet: { label: '🐾 Deine Pixelpfoten brauchen dich', site: true, push: true },
  besuch: { label: '🏘️ Besuch bei deinen Pixelpfoten', site: true, push: false },
  modliste: { label: '💡 Vorschläge zu deinen Modlisten', site: true, push: false },
  daily: { label: '📅 Tägliche Aktionen (Besuchsserie, Tagesfrage)', site: true, push: false },
  fshub: { label: '🚜 Farming Simulator Hub (Aufgaben, Server, Vorschläge)', site: true, push: false },
  admin: { label: '⚙️ Admin-Hinweise (Freigaben, Kontakt, Registrierungen)', site: true, push: true, admin: true },
};
const KEEP = 100;            // so viele Benachrichtigungen bleiben je Konto höchstens
const KEEP_READ_DAYS = 30;   // gelesene verschwinden nach 30 Tagen

function kindsFor(user) {
  return Object.entries(KINDS).filter(([, k]) => !k.admin || (user && (user.isAdmin || user.role === 'admin')));
}
// Einstellungen eines Kontos: { pm: { site: true, push: false }, … }, fehlende Arten mit Vorgabe
function prefs(userId) {
  const row = db.prepare('SELECT notify_prefs FROM users WHERE id = ?').get(userId);
  let saved = {};
  try { saved = JSON.parse(row && row.notify_prefs) || {}; } catch { saved = {}; }
  const out = {};
  for (const [k, d] of Object.entries(KINDS)) {
    const s = saved[k] || {};
    out[k] = { site: typeof s.site === 'boolean' ? s.site : d.site, push: typeof s.push === 'boolean' ? s.push : d.push };
  }
  return out;
}
function savePrefs(userId, body) {
  const out = {};
  for (const k of Object.keys(KINDS)) out[k] = { site: body['site_' + k] === '1', push: body['push_' + k] === '1' };
  db.prepare('UPDATE users SET notify_prefs = ? WHERE id = ?').run(JSON.stringify(out), userId);
}

// Neue Benachrichtigung. Mit key fasst sie eine ungelesene gleiche zusammen (z. B. mehrere Nachrichten
// derselben Person) und zählt mit. once: nichts tun, wenn es diesen key schon einmal gab (gelesen oder nicht).
// at: Zeitpunkt in Sekunden (nur für Tests und Nachrechnungen, sonst jetzt). Gibt true zurück, wenn etwas ankam.
function send(userId, kind, { key = null, title, body = '', url = '/', once = false, at = null }) {
  if (!userId || !Object.hasOwn(KINDS, kind)) return false;
  const user = db.prepare('SELECT id, role, disabled FROM users WHERE id = ?').get(userId);
  if (!user || user.disabled || (KINDS[kind].admin && user.role !== 'admin')) return false;
  if (once && key && db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND key = ?').get(userId, key)) return false;
  const p = prefs(userId)[kind];
  if (p.site) {
    const t = at || now();
    const open = key && db.prepare('SELECT id, count FROM notifications WHERE user_id = ? AND key = ? AND read_at IS NULL').get(userId, key);
    if (open) db.prepare('UPDATE notifications SET title = ?, body = ?, url = ?, count = count + 1, created_at = ? WHERE id = ?').run(title, body, url, t, open.id);
    else db.prepare('INSERT INTO notifications(user_id, kind, key, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, kind, key, title, body, url, t);
  } else if (once && key) {
    // Auch ohne Anzeige merken, dass es sie gab, damit Push nicht jedes Mal neu kommt
    db.prepare('INSERT INTO notifications(user_id, kind, key, title, body, url, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, kind, key, title, body, url, at || now(), at || now());
  }
  if (p.push) pushTo(userId, { title, body, url, tag: key || kind });
  return p.site || p.push;
}
function toAdmins(title, body, url, key = null) {
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled = 0").all()) send(a.id, 'admin', { title, body, url, key });
}

function list(userId, limit = 20) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY read_at IS NOT NULL, created_at DESC, id DESC LIMIT ?').all(userId, limit);
}
function unread(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}
function markRead(userId, id = null) {
  if (id) db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL').run(now(), userId, id);
  else db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), userId);
}
// Wer die Sache selbst ansieht (Gespräch, Forenthema), braucht den Hinweis nicht mehr
function readKey(userId, key) {
  if (userId) db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND key = ? AND read_at IS NULL').run(now(), userId, key);
}
function remove(userId, id = null) {
  if (id) db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').run(userId, id);
  else db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
}

// ---------- Push ----------
function devices(userId) {
  return db.prepare('SELECT id, label, created_at, last_used FROM push_subs WHERE user_id = ? ORDER BY created_at').all(userId);
}
function addDevice(userId, sub, label) {
  const ep = String(sub && sub.endpoint || ''), k = (sub && sub.keys) || {};
  if (!/^https:\/\/[^\s]{1,1000}$/.test(ep) || !/^[A-Za-z0-9_-]{80,100}$/.test(k.p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(k.auth || '')) return false;
  if (db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(userId).n >= 20) return false;
  db.prepare(`INSERT INTO push_subs(user_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`)
    .run(userId, ep, k.p256dh, k.auth, String(label || '').slice(0, 60) || null, now());
  return true;
}
function removeDevice(userId, id) { db.prepare('DELETE FROM push_subs WHERE user_id = ? AND id = ?').run(userId, id); }
function removeEndpoint(userId, endpoint) { db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint || '')); }

function pushTo(userId, data) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
  if (!subs.length) return Promise.resolve(0);
  const mail = getSetting('notify_email');
  const msg = { ...data, site: getSetting('site_title') };
  return Promise.all(subs.map(s => webpush.send(s, msg, { subject: mail ? 'mailto:' + mail : 'mailto:admin@localhost' }).then(status => {
    if (status === 404 || status === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id);
    else if (status < 300) db.prepare('UPDATE push_subs SET last_used = ? WHERE id = ?').run(now(), s.id);
    else console.error('Push abgelehnt:', status, new URL(s.endpoint).host);
    return status < 300 ? 1 : 0;
  }).catch(e => { console.error('Push fehlgeschlagen:', e.message); return 0; }))).then(r => r.reduce((a, b) => a + b, 0));
}

function cleanup() {
  db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?').run(now() - KEEP_READ_DAYS * 86400);
  db.prepare(`DELETE FROM notifications WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS r
              FROM notifications) WHERE r > ?)`).run(KEEP);
}

module.exports = { KINDS, kindsFor, prefs, savePrefs, send, toAdmins, list, unread, markRead, readKey, remove, devices, addDevice, removeDevice, removeEndpoint, pushTo, cleanup };
