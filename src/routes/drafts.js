'use strict';
// Entwürfe für Forum und Blog. Die Formulare (public/drafts.js) speichern hier Titel, Text und die übrigen Felder
// und laden sie wieder. Forenentwürfe hat jedes Konto für sich, Blogentwürfe nur der Admin.
//
//   GET  /api/entwuerfe?art=forum|blog   -> [{ id, kind, place, where, url, title, snippet, updated_at }]
//   GET  /api/entwuerfe/<id>             -> { id, kind, place, title, body_md, fields, updated_at }
//   POST /api/entwuerfe                  <- { id?, kind, place, title, body_md, fields }  -> { id, updated_at }
//   POST /api/entwuerfe/<id>/delete
//
// Wird ein Formular abgeschickt, schickt es draft_id mit, und consume() löscht den Entwurf.
const express = require('express');
const { db, now } = require('../db');

const router = express.Router();
const MAX_DRAFTS = 50;
const MAX_BODY = { forum: 20000, blog: 500000 };
const MAX_FIELDS = 5000;
const PLACE_RE = { forum: /^(new|reply:\d+|edit:\d+)$/, blog: /^(new|post:\d+)$/ };

router.use(express.json({ limit: '1mb' }));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.status(401).json({ error: 'login' });
  next();
});

const allowed = (user, kind) => kind === 'forum' || (kind === 'blog' && user.isAdmin);

// Wofür der Entwurf war und wo man weiterschreibt. Gibt es das Thema oder den Beitrag nicht mehr, geht es ins leere Formular.
function describe(d) {
  const [what, ref] = d.place.split(':');
  const q = 'entwurf=' + d.id;
  if (d.kind === 'blog') {
    const p = what === 'post' && db.prepare('SELECT id, title FROM posts WHERE id = ?').get(Number(ref));
    return p ? { where: `Blogbeitrag „${p.title}“`, url: `/admin/posts/${p.id}?${q}` } : { where: 'Neuer Blogbeitrag', url: '/admin/posts/new?' + q };
  }
  if (what === 'reply') {
    const t = db.prepare('SELECT id, title FROM board_topics WHERE id = ?').get(Number(ref));
    if (t) return { where: `Antwort in „${t.title}“`, url: `/forum/t/${t.id}?page=last&${q}#antworten` };
  }
  if (what === 'edit') {
    const p = db.prepare('SELECT p.id, t.title FROM board_posts p JOIN board_topics t ON t.id = p.topic_id WHERE p.id = ?').get(Number(ref));
    if (p) return { where: `Änderung in „${p.title}“`, url: `/forum/p/${p.id}/edit?${q}` };
  }
  return { where: 'Neues Thema', url: '/forum/new?' + q };
}

function list(userId, kind) {
  return db.prepare('SELECT id, kind, place, title, substr(body_md, 1, 200) AS body, updated_at FROM drafts WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC, id DESC')
    .all(userId, kind).map(d => {
      const text = d.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼️').replace(/[#*_>`~\[\]]/g, '').replace(/\s+/g, ' ').trim();
      return { id: d.id, kind: d.kind, place: d.place, title: d.title || '', snippet: text.length > 120 ? text.slice(0, 120) + '…' : text, updated_at: d.updated_at, ...describe(d) };
    });
}
const count = (userId, kind) => db.prepare('SELECT COUNT(*) AS n FROM drafts WHERE user_id = ? AND kind = ?').get(userId, kind).n;

// Nach dem Abschicken ist der Entwurf erledigt
function consume(req) {
  const id = Number(req.body && req.body.draft_id);
  if (id && req.user) db.prepare('DELETE FROM drafts WHERE id = ? AND user_id = ?').run(id, req.user.id);
}

router.get('/', (req, res) => {
  const kind = req.query.art === 'blog' ? 'blog' : 'forum';
  if (!allowed(req.user, kind)) return res.status(403).json({ error: 'admin' });
  res.json(list(req.user.id, kind));
});

router.get('/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!d || !allowed(req.user, d.kind)) return res.status(404).json({ error: 'not found' });
  let fields = {};
  try { fields = JSON.parse(d.fields || '{}'); } catch { /* kaputt = leer */ }
  res.json({ id: d.id, kind: d.kind, place: d.place, title: d.title || '', body_md: d.body_md, fields, updated_at: d.updated_at });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'blog' ? 'blog' : 'forum';
  if (!allowed(req.user, kind)) return res.status(403).json({ error: 'admin' });
  const place = PLACE_RE[kind].test(String(b.place)) ? String(b.place) : 'new';
  const title = String(b.title ?? '').trim().slice(0, 150);
  const body = String(b.body_md ?? '').slice(0, MAX_BODY[kind]);
  // Nur einfache Werte (Text oder Liste von Texten) aus den übrigen Formularfeldern
  const fields = {};
  if (b.fields && typeof b.fields === 'object') {
    for (const [k, v] of Object.entries(b.fields).slice(0, 30)) {
      if (!/^[a-z_]{1,40}$/i.test(k)) continue;
      fields[k] = Array.isArray(v) ? v.slice(0, 50).map(x => String(x).slice(0, 500)) : String(v).slice(0, 500);
    }
  }
  const json = JSON.stringify(fields);
  if (json.length > MAX_FIELDS) return res.status(413).json({ error: 'fields' });
  if (!title && !body.trim()) return res.status(400).json({ error: 'leer', message: 'Es gibt noch nichts zu speichern.' });
  const t = now();
  const id = Number(b.id);
  if (id && db.prepare('UPDATE drafts SET place = ?, title = ?, body_md = ?, fields = ?, updated_at = ? WHERE id = ? AND user_id = ? AND kind = ?')
    .run(place, title, body, json, t, id, req.user.id, kind).changes) return res.json({ id, updated_at: t });
  if (count(req.user.id, kind) >= MAX_DRAFTS) return res.status(409).json({ error: 'voll', message: `Du hast schon ${MAX_DRAFTS} Entwürfe. Lösch erst einen alten.` });
  const nid = Number(db.prepare('INSERT INTO drafts(user_id, kind, place, title, body_md, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, kind, place, title, body, json, t, t).lastInsertRowid);
  res.json({ id: nid, updated_at: t });
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM drafts WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  // Aus einer Liste als normales Formular abgeschickt: zurück zur Liste
  const back = String((req.body && req.body.back) || '');
  if (/^\/(?!\/)/.test(back)) return res.redirect(back);
  res.json({ ok: true });
});

module.exports = { router, consume, list, count };
