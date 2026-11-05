'use strict';
// Kurzfassung des neuesten Eintrags aus CHANGELOG.md für die Startseite: Nummer, Datum, Titel und die Stichworte der Punkte.
// Erwartet wird „## Update <N> · <Datum> – <Titel>“ und darunter Punkte wie „- **Stichwort:** Text“. Die Nummer ist die des
// Pull Requests (Update 84 = PR #84); alte Einträge ohne Nummer gehen auch. Die Datei liegt im Image und ändert sich nur
// mit einem Update, darum wird sie nur einmal gelesen.
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'CHANGELOG.md');

// Markdown raus: Links, Code, fett und kursiv
function plain(s) {
  return String(s)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/(^|[\s(„"])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?“"]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Kürzt an einer Wortgrenze und hängt „…“ an
function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '') + '…';
}

// Erster Satz; Abkürzungen wie „z. B.“ oder „bzw.“ beenden keinen Satz
const ABBR = /(^|[\s(])(\p{L}|bzw|ca|ggf|evtl|inkl|vgl|usw|etc|Nr|St|Dr|Mio|Mrd)\.$/u;
function firstSentence(s) {
  const re = /[.!?](?=\s+[\p{Lu}„"])/gu;
  let m;
  while ((m = re.exec(s))) {
    const head = s.slice(0, m.index + 1);
    if (!ABBR.test(head)) return head;
  }
  return s;
}

// Überschrift „Update 84 · 04.11.2026 – Titel“ → { no: 84, date: '04.11.2026', title: 'Titel' }
function heading(line) {
  let head = plain(String(line).replace(/^##\s+/, ''));
  const n = head.match(/^Update\s+(\d{1,5})\s*[·•|:-]\s*/i);
  if (n) head = head.slice(n[0].length);
  const m = head.match(/^(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})\s*[–—-]\s*(.+)$/);
  return { no: n ? Number(n[1]) : null, date: m ? m[1] : '', title: m ? m[2] : head };
}

function parse(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+\S/.test(l));
  if (start < 0) return null;
  const h = heading(lines[start]);
  const raw = [];
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) {
    const b = lines[i].match(/^\s{0,3}[-*+]\s+(.+)$/);
    if (b) raw.push(b[1]);
    else if (/^\s+\S/.test(lines[i]) && raw.length) raw[raw.length - 1] += ' ' + lines[i].trim();
  }
  const items = raw.map(r => {
    // „**Stichwort:** Text“ (Doppelpunkt drinnen oder draußen); ohne Stichwort zählt der Anfang des Punkts
    const lm = r.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    const label = lm ? plain(lm[1]).replace(/:$/, '').trim() : '';
    const rest = plain(lm ? lm[2] : r);
    return { label: label || shorten(firstSentence(rest).replace(/[.!?]$/, ''), 40), text: shorten(firstSentence(rest), 160) };
  }).filter(i => i.label);
  return { no: h.no, date: h.date, title: h.title, items };
}

// Alle Einträge mit vollem Text der Punkte (für den Changelog des Farming Hubs)
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^##\s+\S/.test(line)) {
      const h = heading(line), m = h.date.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})$/);
      cur = { no: h.no, date: m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '', title: h.title, items: [] };
      out.push(cur);
      continue;
    }
    if (!cur || /^#\s/.test(line)) continue;
    const b = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
    if (b) cur.items.push(b[1]);
    else if (/^\s+\S/.test(line) && cur.items.length) cur.items[cur.items.length - 1] += ' ' + line.trim();
  }
  for (const s of out) s.items = s.items.map(plain);
  return out;
}
function all() {
  try { return sections(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

let cached;
function latest() {
  if (cached === undefined) {
    try { cached = parse(fs.readFileSync(FILE, 'utf8')); } catch { cached = null; }
  }
  return cached;
}

// Changelog als HTML: Überschriften mit Nummer als Plakette und Sprungmarke (#update-84), Datum klein dahinter
function toHtml(html) {
  return String(html).replace(/<h2>([\s\S]*?)<\/h2>/g, (m, inner) => {
    const n = inner.match(/^Update\s+(\d{1,5})\s*[·•|:-]\s*/i);
    const rest = n ? inner.slice(n[0].length) : inner;
    const d = rest.match(/^(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})\s*[–—-]\s*([\s\S]+)$/);
    const title = d ? d[2] : rest, date = d ? d[1] : '';
    return `<h2${n ? ` id="update-${n[1]}"` : ''}>${n ? `<span class="upd-no">Update ${n[1]}</span> ` : ''}<span class="upd-t">${title}</span>${date ? ` <small>${date}</small>` : ''}</h2>`;
  });
}

module.exports = { parse, latest, sections, all, heading, toHtml, FILE };
