'use strict';
// Seitenverwaltung → Downloads: Link-Vorschläge prüfen und genehmigen, Warteschlange von JDownloader, Download-Regeln
// und Verbindung (src/linkreq.js, src/jdownloader.js). Hängt unter /admin/files, die Admin-Prüfung macht src/routes/admin.js.
const express = require('express');
const { getSetting, setSetting } = require('../db');
const { asArray } = require('../util');
const lr = require('../linkreq');
const jd = require('../jdownloader');
const events = require('../events');

const router = express.Router();
function back(res, url, msg, err) {
  const [p, hash] = url.split('#');
  res.redirect(p + (p.includes('?') ? '&' : '?') + (err ? 'err=' : 'ok=') + encodeURIComponent(msg) + (hash ? '#' + hash : ''));
}
const FILTERS = { offen: '📥 Offen', laufend: '⬇️ Laufend', erledigt: '✅ Erledigt' };

router.use((req, res, next) => {
  res.locals.lrCounts = lr.counts(); res.locals.jdReady = jd.configured();
  // Meldungen zeigt der Seitenkopf (views/partials/head.ejs)
  if (req.query.ok && req.query.ok !== '1') res.locals.flash = String(req.query.ok).slice(0, 300);
  if (req.query.err) res.locals.fehler = String(req.query.err).slice(0, 300);
  next();
});

// ---------- Vorschläge ----------
router.get('/vorschlaege', (req, res) => {
  const f = Object.hasOwn(FILTERS, req.query.f) ? req.query.f : 'offen';
  res.render('admin/linkreq-list', { title: 'Link-Vorschläge', f, FILTERS, list: lr.forAdmin(f), kinds: lr.KINDS });
});
router.post('/vorschlaege/hinzufuegen', async (req, res) => {
  try {
    const ids = await lr.suggest(req.user, req.body);
    back(res, '/admin/files/vorschlaege', ids.length === 1 ? 'Link hinzugefügt.' : ids.length + ' Links hinzugefügt.');
  } catch (e) { back(res, '/admin/files/vorschlaege', e.message, true); }
});
router.get('/vorschlaege/:id', (req, res, next) => {
  const r = lr.detail(req.params.id);
  if (!r) return next();
  const rules = lr.rules();
  res.render('admin/linkreq-detail', { title: 'Vorschlag prüfen', r, rules, kinds: lr.KINDS,
    tooBig: r.bytes_total > rules.maxReqGb * 1024 ** 3 });
});
const one = fn => async (req, res) => {
  const id = Number(req.params.id), url = '/admin/files/vorschlaege/' + id;
  try { const msg = await fn(id, req); back(res, req.body.back === 'liste' ? '/admin/files/vorschlaege' : url, msg); } catch (e) { back(res, url, e.message, true); }
};
router.post('/vorschlaege/:id/pruefen', one(async id => {
  if (!jd.configured()) throw new Error('Erst JDownloader verbinden (Regeln → Verbindung).');
  lr.reopen(id);
  return 'JDownloader prüft den Link. Das dauert meist ein paar Sekunden, bei Playlists länger.';
}));
router.post('/vorschlaege/:id/genehmigen', one(async (id, req) => {
  const b = req.body;
  await lr.approve(id, req.user.id, { chosen: b.chosen !== undefined || b.has_items === '1' ? asArray(b.chosen) : undefined, visibility: b.visibility, title: b.title });
  events.info('Downloads', `Vorschlag ${id} genehmigt`, req.user.id);
  return 'Genehmigt. JDownloader lädt jetzt nur die gewählten Dateien.';
}));
router.post('/vorschlaege/:id/ablehnen', one(async (id, req) => {
  await lr.reject(id, req.user.id, req.body.reason);
  return 'Abgelehnt. Das Mitglied bekommt eine Benachrichtigung.';
}));
router.post('/vorschlaege/:id/abbrechen', one(async id => { await lr.abort(id); return 'Abgebrochen.'; }));

// ---------- Warteschlange ----------
router.get('/warteschlange', async (req, res) => {
  res.render('admin/linkreq-queue', { title: 'Warteschlange', q: await lr.queue() });
});
router.get('/warteschlange.json', async (req, res) => {
  const q = await lr.queue();
  res.json({ items: q.items.map(x => ({ id: x.id, status: x.status, statusLabel: x.statusLabel, pct: x.pct, bytes_done: x.bytes_done, bytes_total: x.bytes_total, eta: x.eta, active: x.active })), state: q.state || null });
});
router.post('/warteschlange/:what', async (req, res) => {
  try {
    if (req.params.what === 'pause') await jd.pause(true);
    else if (req.params.what === 'weiter') { await jd.pause(false); await jd.start(); }
    else return res.status(404).end();
    lr.kick();
    back(res, '/admin/files/warteschlange', req.params.what === 'pause' ? 'Pausiert.' : 'Läuft weiter.');
  } catch (e) { back(res, '/admin/files/warteschlange', e.message, true); }
});

// ---------- Regeln und Verbindung ----------
router.get('/regeln', (req, res) => {
  res.render('admin/linkreq-rules', {
    title: 'Download-Regeln', rules: lr.rules(), lists: { audio: lr.AUDIO_FORMATS, video: lr.VIDEO_FORMATS, res: lr.RESOLUTIONS },
    jdUrl: getSetting('jd_url', ''), jdOut: getSetting('jd_out', '/output'), test: null,
  });
});
router.post('/regeln', (req, res) => {
  lr.saveRules(req.body);
  events.info('Downloads', 'Download-Regeln geändert', req.user.id);
  back(res, '/admin/files/regeln', 'Regeln gespeichert.');
});
router.post('/regeln/verbindung', async (req, res) => {
  const raw = String(req.body.jd_url || '').trim();
  if (raw) {
    let u;
    try { u = new URL(raw); } catch { return back(res, '/admin/files/regeln#verbindung', 'Die Adresse ist ungültig (Beispiel: http://jdownloader2:3128).', true); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return back(res, '/admin/files/regeln#verbindung', 'Nur http:// oder https:// ohne Kennwort.', true);
  }
  setSetting('jd_url', raw.replace(/\/+$/, ''));
  const out = String(req.body.jd_out || '').trim();
  setSetting('jd_out', /^\/[^\0]*$/.test(out) || /^[A-Za-z]:\\/.test(out) ? out.replace(/[\\/]+$/, '') : '/output');
  events.info('Downloads', 'JDownloader-Verbindung geändert', req.user.id);
  if (req.body.test !== '1') return back(res, '/admin/files/regeln#verbindung', 'Verbindung gespeichert.');
  res.render('admin/linkreq-rules', {
    title: 'Download-Regeln', rules: lr.rules(), lists: { audio: lr.AUDIO_FORMATS, video: lr.VIDEO_FORMATS, res: lr.RESOLUTIONS },
    jdUrl: getSetting('jd_url', ''), jdOut: getSetting('jd_out', '/output'), test: raw ? await lr.test() : { ok: false, error: 'Keine Adresse eingetragen.', warn: [] },
  });
});

module.exports = router;
