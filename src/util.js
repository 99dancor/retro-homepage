'use strict';
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({ gfm: true, breaks: true });

// Bildoptionen stehen im Titel des Markdown-Bildes: ![Text](/media/x.png "rechts 40%")
// Lage: links | rechts | mitte, Breite in Prozent der Textbreite. Der Editor schreibt das selbst.
const IMG_OPTS = /^\s*(links|rechts|mitte)?\s*(?:(\d{1,3})\s*%)?\s*$/i;
function imageOptions(title) {
  const m = IMG_OPTS.exec(title || '');
  if (!m || (!m[1] && !m[2])) return null;
  const width = m[2] ? Math.min(100, Math.max(5, Number(m[2]))) : null;
  return { pos: m[1] ? m[1].toLowerCase() : null, width };
}

const SANITIZE = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'del', 'details', 'summary']),
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class', 'style'],
    div: ['class'],
    code: ['class'],
    th: ['align'], td: ['align'],
  },
  allowedClasses: { img: ['bild-links', 'bild-rechts', 'bild-mitte'], div: ['mitte', 'rechts', 'clear'] },
  allowedStyles: { img: { width: [/^\d{1,3}%$/] } },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: (tag, attrs) => ({ tagName: 'a', attribs: /^https?:/.test(attrs.href || '') ? { ...attrs, rel: 'noopener noreferrer', target: '_blank' } : attrs }),
    img: (tag, attrs) => {
      const a = { ...attrs, loading: 'lazy' };
      const o = imageOptions(a.title);
      if (o) {
        delete a.title;
        if (o.pos) a.class = 'bild-' + o.pos;
        if (o.width) a.style = `width:${o.width}%`;
      }
      return { tagName: 'img', attribs: a };
    },
  },
};
const clean = html => sanitizeHtml(html, SANITIZE);

function md(src) {
  return clean(marked.parse(src || ''));
}

// Vorschau für den Editor: jeder Markdown-Block steht in einem eigenen <div> mit seiner Position im Text.
// So kann der Editor Bilder per Ziehen an einen anderen Absatz verschieben.
function mdBlocks(src) {
  src = String(src || '');
  const tokens = marked.lexer(src);
  if (tokens.reduce((n, t) => n + t.raw.length, 0) !== src.length) return md(src); // Text wurde umgeformt: ohne Blöcke
  let pos = 0, from = 0, depth = 0, group = [];
  let out = '';
  for (const t of tokens) {
    if (!group.length) from = pos;
    pos += t.raw.length;
    if (t.type === 'space' && !depth) continue;
    group.push(t);
    // Ein <div class="mitte"> … </div> über mehrere Absätze bleibt ein Block
    if (t.type === 'html') depth = Math.max(0, depth + (t.raw.match(/<(div|details)\b/gi) || []).length - (t.raw.match(/<\/(div|details)>/gi) || []).length);
    if (depth) continue;
    const list = Object.assign(group, { links: tokens.links });
    out += `<div class="md-block" data-from="${from}" data-to="${pos}">${clean(marked.parser(list))}</div>`;
    group = [];
  }
  if (group.length) out += `<div class="md-block" data-from="${from}" data-to="${pos}">${clean(marked.parser(Object.assign(group, { links: tokens.links })))}</div>`;
  return out;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'eintrag';
}

function fmtDate(ts, withTime = false) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: process.env.TZ || 'Europe/Berlin' }) +
    (withTime ? ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Berlin' }) : '');
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0).replace('.', ',') + ' ' + u[i];
}

const VISIBILITY = {
  public: 'Öffentlich',
  members: 'Nur angemeldete Nutzer',
  groups: 'Nur bestimmte Gruppen',
  private: 'Nur Admin',
};

function safeUrl(u) {
  u = String(u || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

function asArray(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }

// Dateien und Titel von Mitgliedern können zusätzlich „Nur Freunde“ sein (Freunde dessen, der sie hochgeladen hat)
const FRIENDS_LABEL = 'Nur Freunde des Hochladenden';
function visibilityFrom(body, owned = false) {
  if (owned && body.visibility === 'friends') return 'friends';
  return Object.hasOwn(VISIBILITY, body.visibility) ? body.visibility : 'public';
}

module.exports = { md, mdBlocks, imageOptions, slugify, fmtDate, fmtSize, VISIBILITY, FRIENDS_LABEL, safeUrl, asArray, visibilityFrom };
