'use strict';
// Dancors Duden (Version 3.0): Guides, Wiki-Artikel und Linksammlungen. Daten in src/duden.js.
//   GET  /duden?thema=&art=&q=        Übersicht (Themen links)
//   GET  /duden/links                 alle Linksammlungen (früher /links)
//   GET  /duden/beitraege[/<slug>]    Blogbeiträge zum Lesen
//   GET  /duden/neu, POST             Eintrag anlegen (Recht „Schreiben“)
//   GET  /duden/<slug>                Eintrag mit Inhaltsverzeichnis und passenden Einträgen
//   GET  /duden/<slug>/bearbeiten, POST, POST /duden/<slug>/loeschen
const express = require('express');
const v3 = require('../v3');
const duden = require('../duden');
const { mdBlocks } = require('../util');
const { db } = require('../db');

const router = express.Router();
const loc = (req, res) => v3.locals(req, res, 'duden');
const needLogin = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));
const writer = (req, res, next) => (duden.canWrite(req.user) ? next() : v3.error(req, res, 403, 'Kein Schreibrecht', 'Im Duden schreiben der Admin und Mitglieder mit dem Recht „Schreiben“.'));
const OK = { neu: 'Eintrag angelegt.', gespeichert: 'Gespeichert.', geloescht: 'Eintrag gelöscht.' };

function list(req, res, opts, extra = {}) {
  const view = duden.view(req.user, opts);
  const posts = duden.posts(req.user, 5);
  res.render('v3/duden', {
    ...loc(req, res), ...view, view, KINDS: duden.KINDS, posts, canWrite: duden.canWrite(req.user), ok: OK[req.query.ok] || null,
    title: view.topic ? `${view.topic} – Duden` : view.kind ? `${duden.KINDS[view.kind].plural} – Duden` : 'Dancors Duden',
    description: 'Guides, Wiki-Artikel und Linksammlungen von Dancor.', ...extra,
  });
}
router.get('/', (req, res) => list(req, res, { topic: String(req.query.thema || ''), kind: String(req.query.art || ''), q: String(req.query.q || '') }));
router.get('/links', (req, res) => list(req, res, { kind: 'links' }));

// Blogbeiträge im Duden lesen (geschrieben werden sie weiter im Blog der Seitenverwaltung)
router.get('/beitraege', (req, res) => {
  res.render('v3/duden-posts', { ...loc(req, res), title: 'Beiträge – Duden', posts: duden.posts(req.user, 200), view: duden.view(req.user), KINDS: duden.KINDS });
});
router.get('/beitraege/:slug', (req, res) => {
  const p = duden.post(req.user, req.params.slug);
  if (!p) return v3.error(req, res, 404, 'Nicht gefunden', 'Diesen Beitrag gibt es nicht (oder du darfst ihn nicht sehen).');
  res.render('v3/duden-entry', {
    ...loc(req, res), title: p.title, description: p.summary || '', KINDS: duden.KINDS, view: duden.view(req.user),
    e: { kind: 'post', title: p.title, summary: p.summary || '', topic: 'Beiträge', icon: '📝', created_at: p.created_at, updated_at: p.updated_at, tags: p.tags },
    html: mdBlocks(p.body_md), links: [], related: duden.posts(req.user, 6).filter(x => x.slug !== p.slug).map(x => ({ title: x.title, url: '/duden/beitraege/' + x.slug })),
    canEdit: false, canDelete: false, author: null, editor: null, deskUrl: '/blog/' + p.slug, ok: null,
  });
});

function form(req, res, e, extra = {}) {
  return {
    ...loc(req, res), title: e && e.id ? `${e.title} bearbeiten` : 'Neuer Eintrag', KINDS: duden.KINDS, topics: duden.topicList(),
    e: e || { kind: Object.hasOwn(duden.KINDS, req.query.art) ? req.query.art : 'guide', topic: String(req.query.thema || '') },
    linksText: e && e.id ? duden.linksText(e) : (e && e.links_text) || '', vis: v3.visForm(req.user, 'duden', e), err: null, ...extra,
  };
}
router.get('/neu', needLogin, writer, (req, res) => res.render('v3/duden-edit', form(req, res, null)));
router.post('/neu', needLogin, writer, (req, res) => {
  const b = req.body;
  let e;
  try { e = duden.create(req.user, b, v3.visibility(req.user, b)); } catch (err) { return res.status(400).render('v3/duden-edit', form(req, res, { ...b, id: null }, { err: err.message, linksText: b.links_text || '' })); }
  v3.saveAcl(req.user, 'duden', e.id, b);
  require('./drafts').consume(req);
  res.redirect('/duden/' + e.slug + '?ok=neu');
});

function entry(req, res, next) {
  const e = duden.bySlug(req.params.slug);
  if (!e || !duden.canSee(req.user, e)) return v3.error(req, res, 404, 'Nicht gefunden', 'Diesen Eintrag gibt es nicht (oder du darfst ihn nicht sehen).');
  req.entry = e;
  next();
}
const userName = id => (id ? db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(id) : null);

router.get('/:slug', entry, (req, res) => {
  const e = req.entry;
  duden.seen(e);
  res.render('v3/duden-entry', {
    ...loc(req, res), title: e.title, description: e.summary, KINDS: duden.KINDS, view: duden.view(req.user), e,
    html: duden.render(e.body_md, req.user), links: duden.linksOf(req.user, e),
    related: duden.related(req.user, e).map(x => ({ title: x.title, url: '/duden/' + x.slug, icon: x.icon || duden.KINDS[x.kind].icon })),
    canEdit: duden.canEdit(req.user, e), canDelete: duden.canDelete(req.user, e), author: userName(e.author_id), editor: e.editor_id !== e.author_id ? userName(e.editor_id) : null,
    deskUrl: null, ok: OK[req.query.ok] || null,
  });
});
const editor = (req, res, next) => (duden.canEdit(req.user, req.entry) ? next() : v3.error(req, res, 403, 'Kein Schreibrecht', 'Im Duden schreiben der Admin und Mitglieder mit dem Recht „Schreiben“.'));
router.get('/:slug/bearbeiten', needLogin, entry, editor, (req, res) => res.render('v3/duden-edit', form(req, res, req.entry)));
router.post('/:slug/bearbeiten', needLogin, entry, editor, (req, res) => {
  const b = req.body;
  // Fremde Einträge: Sichtbarkeit bleibt, wie der Autor sie gewählt hat
  const own = req.user.isAdmin || req.entry.author_id === req.user.id;
  let e;
  try { e = duden.update(req.user, req.entry, b, own ? v3.visibility(req.user, b) : req.entry.visibility); } catch (err) { return res.status(400).render('v3/duden-edit', form(req, res, { ...req.entry, ...b }, { err: err.message, linksText: b.links_text || '' })); }
  if (own) v3.saveAcl(req.user, 'duden', e.id, b);
  require('./drafts').consume(req);
  res.redirect('/duden/' + e.slug + '?ok=gespeichert');
});
router.post('/:slug/loeschen', needLogin, entry, (req, res) => {
  if (!duden.canDelete(req.user, req.entry)) return v3.error(req, res, 403, 'Kein Zugriff', 'Löschen dürfen nur der Autor und der Admin.');
  duden.remove(req.entry);
  res.redirect('/duden?ok=geloescht');
});

module.exports = router;
