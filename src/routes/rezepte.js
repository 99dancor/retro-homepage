'use strict';
// Dancors Deliziösitäten (Version 3.0): das Rezeptbuch. Daten in src/recipes.js, Portionen, Kochmodus und Wecker in public/rezept.js.
//   GET  /rezepte?q=&tag=&zutat=&favoriten=1   Übersicht mit Filtern
//   GET  /rezepte/neu, POST                     Rezept anlegen (Recht „Schreiben“), Bild als multipart
//   POST /rezepte/import                        Rezept von einer Seite übernehmen (füllt nur das Formular)
//   GET  /rezepte/einkauf, POST …               Einkaufsliste des Mitglieds
//   GET  /rezepte/<slug>                        Rezept mit Portionsrechner und Kochmodus
//   POST /rezepte/<slug>/favorit, /einkauf       Merken, Zutaten auf die Einkaufsliste
//   GET  /rezepte/<slug>/bearbeiten, POST, POST /rezepte/<slug>/loeschen
const express = require('express');
const auth = require('../auth');
const up = require('../uploads');
const v3 = require('../v3');
const rz = require('../recipes');
const { mdBlocks } = require('../util');
const { db } = require('../db');

const router = express.Router();
const loc = (req, res) => v3.locals(req, res, 'rezepte');
const needLogin = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));
const writer = (req, res, next) => (rz.canWrite(req.user) ? next() : v3.error(req, res, 403, 'Kein Schreibrecht', 'Rezepte schreiben der Admin und Mitglieder mit dem Recht „Schreiben“.'));
const wantsJson = req => /json/.test(req.get('Accept') || '');
const OK = { neu: 'Rezept angelegt.', gespeichert: 'Gespeichert.', geloescht: 'Rezept gelöscht.' };
// Farbe des Platzhalters, wenn das Rezept kein Bild hat: immer dieselbe je Rezept
const tint = r => 'p' + ([...String(r.slug || r.title || '')].reduce((n, c) => n + c.codePointAt(0), 0) % 8);

router.get('/', (req, res) => {
  const fav = !!req.query.favoriten && !!req.user;
  const view = rz.view(req.user, { q: req.query.q, tag: req.query.tag, zutat: req.query.zutat, fav });
  res.render('v3/rezepte', {
    ...loc(req, res), ...view, tint, canWrite: rz.canWrite(req.user), shopCount: rz.shoppingCount(req.user), ok: OK[req.query.ok] || null,
    title: view.tag ? `${view.tag} – Rezepte` : fav ? 'Favoriten – Rezepte' : 'Dancors Deliziösitäten',
    description: 'Rezepte zum Nachkochen, mit Portionsrechner, Kochmodus und Einkaufsliste.',
  });
});
router.get('/favoriten', (req, res) => res.redirect('/rezepte?favoriten=1'));

// ---------- Anlegen und Bearbeiten ----------
// Das Bild kommt mit dem Formular (multipart). Nur Bilder kommen an, alles andere lässt multer weg.
const imageUpload = (req, res, next) => up.mediaUpload.single('image')(req, res, err => {
  if (!err) return next();
  if (req.file) up.removeQuietly(req.file.path);
  return v3.error(req, res, 413, 'Zu groß', err.code === 'LIMIT_FILE_SIZE' ? 'Das Bild ist zu groß (höchstens 25 MB).' : 'Hochladen fehlgeschlagen.');
});
const dropImage = req => { if (req.file) up.removeQuietly(req.file.path); };
function takeImage(req) {
  if (!req.file) return null;
  const quota = require('../quota');
  if (!req.user.isAdmin && !quota.fits(req.user, req.file.size)) { dropImage(req); throw new Error(quota.fullMessage(req.user)); }
  up.saveMedia([req.file], req.user.id);
  return req.file.filename;
}

function form(req, res, r, extra = {}) {
  const h = r && r.id ? rz.hydrate(r) : null;
  return {
    ...loc(req, res), title: r && r.id ? `${r.title} bearbeiten` : 'Neues Rezept', TAG_IDEAS: rz.TAG_IDEAS, tint,
    r: r || { servings: 4, servings_label: 'Portionen' },
    ingredientsText: h ? rz.ingredientsText(h.ing) : (r && r.ingredients_text) || '',
    stepsText: h ? h.stepList.join('\n') : (r && r.steps_text) || '',
    vis: v3.visForm(req.user, 'recipe', r && r.id ? r : null), err: null, imported: false, ...extra,
  };
}
// Ein Formular, das nicht durchging: was eingegeben war, bleibt stehen
const again = (b, base = {}) => ({ ...base, ...b, intro_md: b.body_md ?? base.intro_md, ingredients_text: b.ingredients_text, steps_text: b.steps_text });

router.get('/neu', needLogin, writer, (req, res) => res.render('v3/rezept-edit', form(req, res, null)));
router.post('/import', needLogin, writer, auth.rateLimit('rezept-import', 30, 3600), async (req, res) => {
  const url = String(req.body.url || '').trim();
  try {
    const f = await rz.importUrl(url);
    res.render('v3/rezept-edit', form(req, res, { ...f, servings_label: 'Portionen', id: null }, { imported: true, ingredientsText: f.ingredients_text, stepsText: f.steps_text }));
  } catch (e) {
    res.status(400).render('v3/rezept-edit', form(req, res, null, { err: e.message || 'Übernehmen hat nicht geklappt.', importUrl: url }));
  }
});
router.post('/neu', needLogin, writer, imageUpload, auth.csrfCheck, (req, res) => {
  const b = req.body;
  let r;
  try { r = rz.create(req.user, b, v3.visibility(req.user, b), takeImage(req)); } catch (e) {
    dropImage(req);
    const v = again(b, { id: null });
    return res.status(400).render('v3/rezept-edit', form(req, res, v, { err: e.message, ingredientsText: v.ingredients_text || '', stepsText: v.steps_text || '' }));
  }
  v3.saveAcl(req.user, 'recipe', r.id, b);
  require('./drafts').consume(req);
  res.redirect('/rezepte/' + r.slug + '?ok=neu');
});

// ---------- Einkaufsliste ----------
router.get('/einkauf', needLogin, (req, res) => {
  const items = rz.shopping(req.user);
  res.render('v3/einkauf', { ...loc(req, res), title: 'Einkaufsliste – Rezepte', items, open: items.filter(i => !i.done), done: items.filter(i => i.done), ok: req.query.ok || null });
});
router.post('/einkauf', needLogin, (req, res) => {
  for (const line of String(req.body.text || '').split(/\r?\n/).slice(0, 30)) rz.addItem(req.user, line);
  res.redirect('/rezepte/einkauf');
});
router.post('/einkauf/haken', needLogin, (req, res) => {
  rz.setDone(req.user, req.body.ids, req.body.done === '1' || req.body.done === true || req.body.done === 'true');
  if (wantsJson(req)) return res.json({ ok: true, open: rz.shoppingCount(req.user) });
  res.redirect('/rezepte/einkauf');
});
router.post('/einkauf/aufraeumen', needLogin, (req, res) => { rz.clearDone(req.user); res.redirect('/rezepte/einkauf'); });
router.post('/einkauf/leeren', needLogin, (req, res) => { rz.clearAll(req.user); res.redirect('/rezepte/einkauf?ok=leer'); });

// ---------- Ein Rezept ----------
function recipe(req, res, next) {
  const r = rz.bySlug(req.params.slug);
  if (!r || !rz.canSee(req.user, r)) return v3.error(req, res, 404, 'Nicht gefunden', 'Dieses Rezept gibt es nicht (oder du darfst es nicht sehen).');
  req.recipe = r;
  next();
}
const editor = (req, res, next) => (rz.canEdit(req.user, req.recipe) ? next() : v3.error(req, res, 403, 'Kein Schreibrecht', 'Rezepte schreiben der Admin und Mitglieder mit dem Recht „Schreiben“.'));

router.get('/:slug', recipe, (req, res) => {
  const r = rz.hydrate(req.recipe);
  const author = r.author_id ? db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(r.author_id) : null;
  const more = rz.visible(req.user).filter(x => x.id !== r.id)
    .map(x => ({ x, n: x.tagList.filter(t => r.tagList.includes(t)).length })).sort((a, b) => b.n - a.n || b.x.created_at - a.x.created_at).slice(0, 4).map(o => o.x);
  let source = null;
  try { source = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, '') : null; } catch { source = null; }
  res.render('v3/rezept', {
    ...loc(req, res), title: r.title, description: r.summary, r, tint, intro: mdBlocks(r.intro_md), steps: r.stepList.map(rz.stepHtml), fmtAmount: rz.fmtAmount,
    fav: rz.isFav(req.user, r), canEdit: rz.canEdit(req.user, r), canDelete: rz.canDelete(req.user, r), author, more, source,
    ok: req.query.ok === 'einkauf' ? `${Number(req.query.n) || 0} Zutaten stehen auf deiner Einkaufsliste.` : OK[req.query.ok] || null,
  });
});
router.post('/:slug/favorit', needLogin, recipe, (req, res) => {
  const on = rz.toggleFav(req.user, req.recipe);
  if (wantsJson(req)) return res.json({ fav: on });
  const back = String(req.body.next || '');
  res.redirect(/^\/rezepte(\/|\?|$)/.test(back) && !back.startsWith('//') ? back : '/rezepte/' + req.recipe.slug);
});
router.post('/:slug/einkauf', needLogin, recipe, (req, res) => {
  const n = rz.addToShopping(req.user, req.recipe, req.body.portionen);
  res.redirect(`/rezepte/${req.recipe.slug}?ok=einkauf&n=${n}`);
});
router.get('/:slug/bearbeiten', needLogin, recipe, editor, (req, res) => res.render('v3/rezept-edit', form(req, res, req.recipe)));
router.post('/:slug/bearbeiten', needLogin, recipe, editor, imageUpload, auth.csrfCheck, (req, res) => {
  const b = req.body, r0 = req.recipe;
  // Fremde Rezepte: Sichtbarkeit bleibt, wie der Autor sie gewählt hat
  const own = req.user.isAdmin || r0.author_id === req.user.id;
  let r;
  try {
    const img = takeImage(req);
    r = rz.update(req.user, r0, b, own ? v3.visibility(req.user, b) : r0.visibility, img || (b.drop_image ? null : undefined));
  } catch (e) {
    dropImage(req);
    const v = again(b, r0);
    return res.status(400).render('v3/rezept-edit', form(req, res, { ...v, id: r0.id, slug: r0.slug, image: r0.image }, { err: e.message, ingredientsText: v.ingredients_text || '', stepsText: v.steps_text || '' }));
  }
  if (own) v3.saveAcl(req.user, 'recipe', r.id, b);
  require('./drafts').consume(req);
  res.redirect('/rezepte/' + r.slug + '?ok=gespeichert');
});
router.post('/:slug/loeschen', needLogin, recipe, (req, res) => {
  if (!rz.canDelete(req.user, req.recipe)) return v3.error(req, res, 403, 'Kein Zugriff', 'Löschen dürfen nur der Autor und der Admin.');
  rz.remove(req.recipe);
  res.redirect('/rezepte?ok=geloescht');
});

module.exports = router;
