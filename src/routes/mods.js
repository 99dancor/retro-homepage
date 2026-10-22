'use strict';
// Modlisten (Startmenü → Dokumente → 🧩 Modlisten). Anlegen darf jedes Mitglied, bearbeiten Besitzer und Admin,
// Vorschläge je nach Liste alle (auch Gäste), nur Angemeldete oder niemand. Daten und Regeln: src/modlists.js.
//
//   GET  /mods                                  Übersicht nach Spiel
//   GET  /mods/neu              POST /mods/neu  neue Liste
//   GET  /mods/<slug>                           Ansicht; ?bearbeiten = Editor, ?vorschlaege = Vorschläge bearbeiten
//   POST /mods/<slug>/speichern | /loeschen
//   POST /mods/<slug>/vorschlaege               <- data: { rows: [{ id?, name, url, notes }] }, known: ids beim Laden
//   POST /mods/<slug>/vorschlaege/<id>/uebernehmen
//   GET  /mods/<slug>/verlauf   POST /mods/<slug>/verlauf/<id>/zurueck
const express = require('express');
const auth = require('../auth');
const ml = require('../modlists');

const router = express.Router();

const OK = { neu: 'Modliste angelegt.', gespeichert: 'Gespeichert.', vorschlaege: 'Vorschläge gespeichert.', uebernommen: 'In die Liste übernommen.',
  zurueck: 'Vorschläge zurückgesetzt.', geloescht: 'Modliste gelöscht.' };
const locals = { MAX: ml.MAX, VIS: ml.VIS, VIS_LABEL: ml.VIS_LABEL, SUGGESTIONS: ml.SUGGESTIONS };

// Gäste dürfen Vorschläge seltener ändern als Mitglieder (Schutz vor Spam, gezählt im Arbeitsspeicher pro IP)
const guestLimit = auth.rateLimit('mods-gast', 20, 3600);
const memberLimit = auth.rateLimit('mods', 120, 3600);
const suggLimit = (req, res, next) => (req.user ? memberLimit : guestLimit)(req, res, next);
const createLimit = auth.rateLimit('mods-neu', 20, 3600);

function load(req, res, next) {
  const list = ml.bySlug(req.params.slug);
  if (!list || !auth.canSee(req.user, 'modlist', list)) return next('route');
  req.list = list;
  next();
}
function editor(req, res, next) {
  if (!ml.canEdit(req.user, req.list)) return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Diese Modliste dürfen nur ihr Besitzer und der Admin bearbeiten.' });
  next();
}
const actorOf = (req, guestName) => (req.user ? { id: req.user.id, name: req.user.name, guest: false } : { id: null, name: guestName, guest: true });

function renderEdit(res, list, err = null, cats = null) {
  res.render('mod-edit', { title: list.id ? `${list.title} bearbeiten` : 'Neue Modliste', ...locals, list, err,
    cats: cats || (list.id ? ml.categories(list.id) : []), games: ml.gameNames() });
}
function renderList(req, res, extra = {}) {
  const list = req.list;
  res.render('mod-detail', {
    title: list.title, ...locals, list,
    cats: ml.categories(list.id), sugg: ml.suggestions(list.id), log: ml.log(list.id, 1),
    canEdit: ml.canEdit(req.user, list), canSuggest: ml.canSuggest(req.user, list),
    suggEdit: false, openSugg: false, msg: OK[req.query.ok] || null, err: null, ...extra,
  });
}

router.get('/', (req, res) => {
  const games = ml.overview(req.user);
  res.render('mods-list', { title: 'Modlisten', games, total: games.reduce((n, g) => n + g.lists.length, 0), VIS_LABEL: ml.VIS_LABEL, msg: OK[req.query.ok] || null });
});

router.get('/neu', auth.requireLogin, (req, res) => renderEdit(res, { visibility: 'public', suggestions: 'all' }));
router.post('/neu', auth.requireLogin, createLimit, (req, res) => {
  const list = ml.save(null, req.user, req.body);
  res.redirect(`/mods/${list.slug}?ok=neu`);
});

router.get('/:slug', load, (req, res) => {
  const list = req.list;
  if ('bearbeiten' in req.query) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (ml.canEdit(req.user, list)) return renderEdit(res, list);
  }
  const suggEdit = 'vorschlaege' in req.query && ml.canSuggest(req.user, list);
  if ('vorschlaege' in req.query && !suggEdit && !req.user && list.suggestions === 'members') return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  renderList(req, res, { suggEdit, openSugg: 'ok' in req.query && ['vorschlaege', 'uebernommen', 'zurueck'].includes(req.query.ok) });
});

router.post('/:slug/speichern', load, editor, (req, res) => {
  ml.save(req.list, req.user, req.body);
  res.redirect(`/mods/${req.list.slug}?ok=gespeichert`);
});
router.post('/:slug/loeschen', load, editor, (req, res) => {
  ml.remove(req.list);
  res.redirect('/mods?ok=geloescht');
});

router.post('/:slug/vorschlaege', load, suggLimit, (req, res) => {
  const list = req.list;
  if (!ml.canSuggest(req.user, list)) return res.status(403).render('error', { title: 'Kein Zugriff', message: list.suggestions === 'members' ? 'Vorschläge zu dieser Liste können nur angemeldete Mitglieder machen.' : 'Für diese Liste sind Vorschläge ausgeschaltet.' });
  // Unsichtbares Feld: füllen nur Spam-Programme aus
  if (req.body.website) return res.redirect(`/mods/${list.slug}?ok=vorschlaege#vorschlaege`);
  const guestName = String(req.body.guest_name || '').replace(/\s+/g, ' ').trim().slice(0, ml.MAX.guest);
  if (!req.user && !guestName) {
    return renderList(req, res.status(400), { suggEdit: true, err: 'Bitte gib einen Namen an, damit man sieht, von wem der Vorschlag kommt.' });
  }
  const data = ml.parseJson(req.body.data) || {};
  data.known = String(req.body.known || '').split(',');
  const actor = actorOf(req, guestName);
  const r = ml.saveSuggestions(list, actor, data);
  ml.announce(list, actor, r.names);
  res.redirect(`/mods/${list.slug}?ok=vorschlaege#vorschlaege`);
});

router.post('/:slug/vorschlaege/:id/uebernehmen', load, editor, (req, res) => {
  const category = req.body.category === '__neu__' ? req.body.new_category : req.body.category;
  ml.take(req.list, req.params.id, category, actorOf(req));
  res.redirect(`/mods/${req.list.slug}?ok=uebernommen#vorschlaege`);
});

router.get('/:slug/verlauf', load, (req, res, next) => {
  const canEdit = ml.canEdit(req.user, req.list);
  if (req.list.suggestions === 'off' && !canEdit) return next('route');
  res.render('mod-log', { title: `Verlauf – ${req.list.title}`, list: req.list, log: ml.log(req.list.id), canEdit, msg: OK[req.query.ok] || null });
});
router.post('/:slug/verlauf/:id/zurueck', load, editor, (req, res) => {
  ml.restore(req.list, req.params.id, actorOf(req));
  res.redirect(`/mods/${req.list.slug}?ok=zurueck#vorschlaege`);
});

module.exports = router;
