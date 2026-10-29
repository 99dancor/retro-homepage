'use strict';
// Kurzfassung des neuesten Eintrags aus CHANGELOG.md für die Startseite: Datum, Titel und die Stichworte der Punkte.
// Erwartet wird „## <Datum> – <Titel>“ und darunter Punkte wie „- **Stichwort:** Text“. Die Datei liegt im Image
// und ändert sich nur mit einem Update, darum wird sie nur einmal gelesen.
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

function parse(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+\S/.test(l));
  if (start < 0) return null;
  const head = plain(lines[start].replace(/^##\s+/, ''));
  const m = head.match(/^(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})\s*[–—-]\s*(.+)$/);
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
  return { date: m ? m[1] : '', title: m ? m[2] : head, items };
}

// Alle Einträge mit vollem Text der Punkte (für den Changelog des Farming Hubs)
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^##\s+\S/.test(line)) {
      const head = plain(line.replace(/^##\s+/, ''));
      const m = head.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})\s*[–—-]\s*(.+)$/);
      cur = { date: m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '', title: m ? m[4] : head, items: [] };
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

module.exports = { parse, latest, sections, all, FILE };
