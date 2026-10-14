'use strict';
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({ gfm: true, breaks: true });

function md(src) {
  return sanitizeHtml(marked.parse(src || ''), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'del', 'details', 'summary']),
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      code: ['class'],
      th: ['align'], td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tag, attrs) => ({ tagName: 'a', attribs: /^https?:/.test(attrs.href || '') ? { ...attrs, rel: 'noopener noreferrer', target: '_blank' } : attrs }),
      img: (tag, attrs) => ({ tagName: 'img', attribs: { ...attrs, loading: 'lazy' } }),
    },
  });
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

function visibilityFrom(body) {
  return Object.hasOwn(VISIBILITY, body.visibility) ? body.visibility : 'public';
}

module.exports = { md, slugify, fmtDate, fmtSize, VISIBILITY, safeUrl, asArray, visibilityFrom };
