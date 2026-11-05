'use strict';
// Popup-Bilder (Seitenverwaltung → Aussehen → Popup-Bilder): keine Werbung, sondern ein Pool aus Bildern, die ab und zu
// als kleines Fenster auf dem Desktop aufgehen – wie früher die Werbefenster, nur zum Spaß. Bilder kommen als Upload,
// aus den Bildern der Seitenverwaltung, aus der Paint-Galerie oder als Vorschlag eines Mitglieds (eigenes Paint-Bild).
// Gezählt wird nur, wie oft ein Bild kam, angeklickt oder geschlossen wurde, ohne Bezug zu Personen. Wann eins kommt,
// entscheidet der Browser (public/popups.js) nach den Regeln hier; abschalten geht im Popup selbst oder unter 🖥️ → Effekte.
const { db, now, getSetting } = require('./db');

const AUDIENCE = { all: 'Gäste und Mitglieder', guests: 'Nur Gäste', members: 'Nur Mitglieder' };
const WEIGHT = { 1: 'selten', 2: 'normal', 3: 'oft' };
const fits = (aud, user) => aud === 'all' || (aud === 'guests' && !user) || (aud === 'members' && !!user);
const IMAGE = /^(\/media\/[a-f0-9]{32}(\.[a-z0-9]{1,10})?|\/paint\/bild\/\d+\.png)$/;

function all() {
  return db.prepare(`SELECT p.*, u.username AS suggested_name, s.name AS service_name FROM popups p
                     LEFT JOIN users u ON u.id = p.suggested_by LEFT JOIN services s ON s.id = p.service_id
                     ORDER BY p.status = 'pending' DESC, p.created_at DESC`).all();
}
const get = id => db.prepare('SELECT * FROM popups WHERE id = ?').get(Number(id)) || null;
const pendingCount = () => db.prepare("SELECT COUNT(*) AS n FROM popups WHERE status = 'pending'").get().n;

function config() {
  const n = (k, d, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(getSetting(k, d))) || Number(d)));
  return {
    on: getSetting('popup_on', '1') === '1', first: n('popup_first', '30', 5, 3600), every: n('popup_every', '15', 1, 1440), max: n('popup_max', '3', 1, 50),
    audience: Object.hasOwn(AUDIENCE, getSetting('popup_audience')) ? getSetting('popup_audience') : 'all',
    mobile: getSetting('popup_mobile', '0') === '1', cheeky: getSetting('popup_cheeky', '0') === '1', suggest: getSetting('popup_suggest', '1') === '1',
  };
}

// Was dieser Besucher bekommen kann: Zeitraum, Zielgruppe, Dienst läuft, Paint-Bild darf er sehen
function eligible(user, t = now()) {
  const c = config();
  if (!c.on || !fits(c.audience, user)) return null;
  const paint = require('./paint'), services = require('./services');
  const list = db.prepare("SELECT * FROM popups WHERE enabled = 1 AND status = 'ok'").all().filter(p =>
    (!p.starts_at || p.starts_at <= t) && (!p.ends_at || p.ends_at > t) && fits(p.audience, user) &&
    (!p.service_id || (services.get(p.service_id) || {}).state === 'up') &&
    (!p.artwork_id || paint.canSee(user, paint.get(p.artwork_id))));
  if (!list.length) return null;
  return {
    first: c.first, every: c.every, max: c.max, mobile: c.mobile, cheeky: c.cheeky,
    items: list.map(p => ({ id: p.id, title: p.title, image: p.image, link: p.link || null, weight: p.weight })),
  };
}

const when = v => require('./util').fromLocalInput(v);
function fields(b) {
  const link = String(b.link || '').trim().slice(0, 500);
  if (link && !/^(\/(?![/\\])|https?:\/\/)\S*$/i.test(link)) return { error: 'Der Link muss mit / (Seite hier) oder http(s):// beginnen.' };
  const sid = Number(b.service_id) || null;
  return {
    title: String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Herzlichen Glückwunsch!',
    link: link || null, weight: [1, 2, 3].includes(Number(b.weight)) ? Number(b.weight) : 2,
    starts_at: when(b.starts_at), ends_at: when(b.ends_at), audience: Object.hasOwn(AUDIENCE, b.audience) ? b.audience : 'all',
    service_id: sid && db.prepare('SELECT 1 FROM services WHERE id = ?').get(sid) ? sid : null, enabled: b.enabled === '0' ? 0 : 1,
  };
}
// Neues Bild: image ist /media/… (Upload oder Bilder) oder ein Paint-Bild (artwork)
function add({ image, source, artworkId = null, suggestedBy = null, status = 'ok' }, b = {}) {
  if (!IMAGE.test(String(image || ''))) return { error: 'Bitte ein Bild wählen.' };
  const f = fields(b);
  if (f.error) return f;
  const id = Number(db.prepare(`INSERT INTO popups(title, image, link, weight, starts_at, ends_at, audience, service_id, enabled, status, source, artwork_id, suggested_by, created_at)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(f.title, image, f.link, f.weight, f.starts_at, f.ends_at, f.audience, f.service_id, f.enabled, status, source, artworkId, suggestedBy, now()).lastInsertRowid);
  return { id };
}
function update(id, b) {
  const f = fields(b);
  if (f.error) return f;
  db.prepare('UPDATE popups SET title=?, link=?, weight=?, starts_at=?, ends_at=?, audience=?, service_id=?, enabled=? WHERE id=?')
    .run(f.title, f.link, f.weight, f.starts_at, f.ends_at, f.audience, f.service_id, f.enabled, Number(id));
  return { id: Number(id) };
}
function remove(id) { db.prepare('DELETE FROM popups WHERE id = ?').run(Number(id)); }
function approve(id) { db.prepare("UPDATE popups SET status = 'ok' WHERE id = ?").run(Number(id)); }

// Vorschlag eines Mitglieds: ein eigenes Paint-Bild, das öffentlich ist. Der Admin schaltet es frei.
function suggest(user, artworkId) {
  const paint = require('./paint'), a = paint.get(artworkId);
  if (!config().suggest) return { error: 'Vorschläge sind gerade ausgeschaltet.' };
  if (!user || !a || a.owner_id !== user.id) return { error: 'Du kannst nur eigene Bilder vorschlagen.' };
  if (a.visibility !== 'public') return { error: 'Stell das Bild zuerst auf „öffentlich“, damit es alle sehen dürfen.' };
  if (!a.approved || a.draft) return { error: 'Das Bild wartet noch auf die Freigabe für die Galerie.' };
  if (db.prepare('SELECT 1 FROM popups WHERE artwork_id = ?').get(a.id)) return { error: 'Dieses Bild ist schon vorgeschlagen.' };
  const r = add({ image: `/paint/bild/${a.id}.png`, source: 'paint', artworkId: a.id, suggestedBy: user.id, status: 'pending' }, { title: a.title });
  if (r.id) require('./notify').toAdmins('💬 Vorschlag für ein Popup-Bild', `„${a.title}“ von ${user.name}`, '/admin/popups', 'admin:popup');
  return r;
}
const suggested = artworkId => !!db.prepare('SELECT 1 FROM popups WHERE artwork_id = ?').get(Number(artworkId));

// Zähler ohne Personenbezug: kam (shown), angeklickt (clicks), geschlossen (closed)
function count(id, what) {
  const col = { zeige: 'shown', klick: 'clicks', zu: 'closed' }[what];
  if (col) db.prepare(`UPDATE popups SET ${col} = ${col} + 1 WHERE id = ? AND status = 'ok'`).run(Number(id));
  return !!col;
}

module.exports = { AUDIENCE, WEIGHT, IMAGE, all, get, pendingCount, config, eligible, add, update, remove, approve, suggest, suggested, count, when };
