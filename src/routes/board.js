'use strict';
// Forum: angemeldete Nutzer schreiben Themen und Antworten, der Admin moderiert (anpinnen, sperren, löschen).
const express = require('express');
const { db, now, getSetting, tx } = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const up = require('../uploads');
const { md, mdBlocks } = require('../util');

const router = express.Router();
const PER_PAGE = 25;
const MAX_BODY = 20000;

function boardOn(req, res, next) {
  if (getSetting('board_enabled') !== '1') return res.status(404).render('error', { title: 'Forum', message: 'Das Forum ist gerade geschlossen.' });
  if (getSetting('board_members_only') === '1' && !req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}
router.use(boardOn);

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const canEdit = (user, post) => !!user && (user.isAdmin || (post.user_id && post.user_id === user.id));

function loadTopic(req, res, next) {
  const t = db.prepare('SELECT t.*, u.username FROM board_topics t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Thema gibt es nicht (mehr).' });
  req.topic = t;
  next();
}
function loadPost(req, res, next) {
  const p = db.prepare('SELECT * FROM board_posts WHERE id = ?').get(Number(req.params.id));
  if (!p || !canEdit(req.user, p)) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diesen Beitrag gibt es nicht oder du darfst ihn nicht ändern.' });
  req.post = p;
  req.topic = db.prepare('SELECT * FROM board_topics WHERE id = ?').get(p.topic_id);
  req.isFirst = db.prepare('SELECT MIN(id) AS id FROM board_posts WHERE topic_id = ?').get(p.topic_id).id === p.id;
  next();
}
function requireAdmin(req, res, next) { return req.user && req.user.isAdmin ? next() : res.status(403).end(); }

// ---------- Übersicht ----------
router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const total = db.prepare('SELECT COUNT(*) AS n FROM board_topics').get().n;
  const topics = db.prepare(`
    SELECT t.*, u.username,
      (SELECT COUNT(*) FROM board_posts p WHERE p.topic_id = t.id) - 1 AS replies,
      (SELECT lu.username FROM board_posts p LEFT JOIN users lu ON lu.id = p.user_id WHERE p.topic_id = t.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS last_user
    FROM board_topics t LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.pinned DESC, t.last_post_at DESC LIMIT ? OFFSET ?`).all(PER_PAGE, (page - 1) * PER_PAGE);
  res.render('board-list', { title: 'Forum', topics, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total });
});

// ---------- Neues Thema ----------
router.get('/new', auth.requireLogin, (req, res) => res.render('board-new', { title: 'Neues Thema', err: null, form: {} }));
router.post('/new', auth.requireLogin, auth.rateLimit('board', 10, 600), (req, res) => {
  const title = str(req.body.title, 150);
  const body = String(req.body.body_md || '').trim().slice(0, MAX_BODY);
  if (!title || !body) return res.render('board-new', { title: 'Neues Thema', err: 'Bitte Titel und Text ausfüllen.', form: { title, body } });
  const t = now();
  const id = tx(() => {
    const tid = Number(db.prepare('INSERT INTO board_topics(title, user_id, created_at, last_post_at) VALUES (?, ?, ?, ?)').run(title, req.user.id, t, t).lastInsertRowid);
    db.prepare('INSERT INTO board_posts(topic_id, user_id, body_md, created_at) VALUES (?, ?, ?, ?)').run(tid, req.user.id, body, t);
    return tid;
  });
  if (!req.user.isAdmin) mail.notifyQuietly('Neues Thema im Forum: ' + title, `Von: ${req.user.username}\n\n${body}`);
  res.redirect('/forum/t/' + id);
});

// ---------- Thema lesen und antworten ----------
router.get('/t/:id', loadTopic, (req, res) => {
  const t = req.topic;
  const total = db.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE topic_id = ?').get(t.id).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = req.query.page === 'last' ? pages : Math.min(pages, Math.max(1, Number(req.query.page) || 1));
  const posts = db.prepare(`SELECT p.*, u.username, u.role FROM board_posts p LEFT JOIN users u ON u.id = p.user_id
                            WHERE p.topic_id = ? ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`).all(t.id, PER_PAGE, (page - 1) * PER_PAGE);
  const firstId = db.prepare('SELECT MIN(id) AS id FROM board_posts WHERE topic_id = ?').get(t.id).id;
  for (const p of posts) { p.html = md(p.body_md); p.editable = canEdit(req.user, p); p.first = p.id === firstId; }
  res.render('board-topic', { title: t.title, topic: t, posts, page, pages, err: req.query.err || null });
});
router.post('/t/:id/reply', auth.requireLogin, auth.rateLimit('board', 10, 600), loadTopic, (req, res) => {
  const t = req.topic;
  if (t.locked && !req.user.isAdmin) return res.redirect(`/forum/t/${t.id}?err=` + encodeURIComponent('Dieses Thema ist geschlossen.'));
  const body = String(req.body.body_md || '').trim().slice(0, MAX_BODY);
  if (!body) return res.redirect(`/forum/t/${t.id}?page=last`);
  const ts = now();
  const pid = tx(() => {
    const id = db.prepare('INSERT INTO board_posts(topic_id, user_id, body_md, created_at) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, body, ts).lastInsertRowid;
    db.prepare('UPDATE board_topics SET last_post_at = ? WHERE id = ?').run(ts, t.id);
    return id;
  });
  res.redirect(`/forum/t/${t.id}?page=last#b${pid}`);
});

// ---------- Beitrag bearbeiten / löschen (Verfasser oder Admin) ----------
router.get('/p/:id/edit', auth.requireLogin, loadPost, (req, res) => {
  res.render('board-edit', { title: 'Beitrag bearbeiten', post: req.post, topic: req.topic, isFirst: req.isFirst, err: null });
});
router.post('/p/:id/edit', auth.requireLogin, loadPost, (req, res) => {
  const body = String(req.body.body_md || '').trim().slice(0, MAX_BODY);
  const title = str(req.body.title, 150);
  if (!body || (req.isFirst && !title)) {
    return res.render('board-edit', { title: 'Beitrag bearbeiten', post: { ...req.post, body_md: body }, topic: { ...req.topic, title }, isFirst: req.isFirst, err: 'Bitte nichts leer lassen.' });
  }
  tx(() => {
    db.prepare('UPDATE board_posts SET body_md = ?, edited_at = ? WHERE id = ?').run(body, now(), req.post.id);
    if (req.isFirst) db.prepare('UPDATE board_topics SET title = ? WHERE id = ?').run(title, req.topic.id);
  });
  res.redirect(`/forum/t/${req.topic.id}?page=${pageOf(req.post)}#b${req.post.id}`);
});
// Der erste Beitrag eines Themas löscht das ganze Thema. Nutzer dürfen das nur, solange niemand geantwortet hat.
router.post('/p/:id/delete', auth.requireLogin, loadPost, (req, res) => {
  const t = req.topic;
  if (req.isFirst) {
    const others = db.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE topic_id = ? AND (user_id IS NULL OR user_id != ?)').get(t.id, req.user.id).n;
    if (others && !req.user.isAdmin) return res.redirect(`/forum/t/${t.id}?err=` + encodeURIComponent('Auf dein Thema wurde schon geantwortet. Du kannst den Text bearbeiten, aber nicht mehr löschen.'));
    db.prepare('DELETE FROM board_topics WHERE id = ?').run(t.id);
    return res.redirect('/forum');
  }
  tx(() => {
    db.prepare('DELETE FROM board_posts WHERE id = ?').run(req.post.id);
    const last = db.prepare('SELECT MAX(created_at) AS ts FROM board_posts WHERE topic_id = ?').get(t.id).ts;
    db.prepare('UPDATE board_topics SET last_post_at = ? WHERE id = ?').run(last || t.created_at, t.id);
  });
  res.redirect(`/forum/t/${t.id}`);
});
function pageOf(post) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM board_posts WHERE topic_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))')
    .get(post.topic_id, post.created_at, post.created_at, post.id).n;
  return Math.floor(n / PER_PAGE) + 1;
}

// ---------- Moderation ----------
router.post('/t/:id/pin', requireAdmin, loadTopic, (req, res) => {
  db.prepare('UPDATE board_topics SET pinned = 1 - pinned WHERE id = ?').run(req.topic.id);
  res.redirect('/forum/t/' + req.topic.id);
});
router.post('/t/:id/lock', requireAdmin, loadTopic, (req, res) => {
  db.prepare('UPDATE board_topics SET locked = 1 - locked WHERE id = ?').run(req.topic.id);
  res.redirect('/forum/t/' + req.topic.id);
});
router.post('/t/:id/delete', requireAdmin, loadTopic, (req, res) => {
  db.prepare('DELETE FROM board_topics WHERE id = ?').run(req.topic.id);
  res.redirect('/forum');
});

// ---------- Editor: Vorschau und Bilder ----------
router.post('/preview', auth.requireLogin, (req, res) => res.type('html').send(mdBlocks(String(req.body.md || '').slice(0, MAX_BODY))));
router.post('/media', (req, res, next) => (req.user ? next() : res.status(401).json([])), auth.rateLimit('board-media', 30, 3600),
  up.boardMediaUpload.array('images'), auth.csrfCheck, (req, res) => res.json(up.saveMedia(req.files, req.user.id)));

module.exports = router;
