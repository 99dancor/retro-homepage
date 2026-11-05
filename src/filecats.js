'use strict';
// Kategorien der Downloads als feste Liste (Seitenverwaltung → Inhalte → Downloads → Kategorien) statt Freitext.
// Jede Kategorie hat ein Symbol, Endungen, an denen das Hochladen sie erkennt, und ob „Spiel“ dazugehört.
// Kategorien, die noch an alten Dateien hängen, aber nicht in der Liste stehen, erscheinen trotzdem (mit 📁).
const path = require('node:path');
const { db, getSetting, setSetting } = require('./db');

const DEFAULTS = [
  { name: 'Allgemein', icon: '📦', ext: [], game: false },
  { name: 'Spielstände', icon: '💾', ext: ['sav', 'save'], game: true },
  { name: 'Mods', icon: '🧩', ext: [], game: true },
  { name: 'Tools', icon: '🛠️', ext: ['exe', 'msi'], game: false },
  { name: 'Dokumente', icon: '📄', ext: ['pdf', 'doc', 'docx', 'odt', 'txt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'csv', 'md'], game: false },
  { name: 'Bilder', icon: '🖼️', ext: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'], game: false },
  { name: 'Archive', icon: '🗜️', ext: ['zip', '7z', 'rar', 'tar', 'gz', 'iso'], game: false },
];
// Programme und Skripte nehmen wir von Mitgliedern nicht an (der Admin darf, z. B. für Tools)
const BLOCKED_DEFAULT = 'exe msi bat cmd com scr pif ps1 vbs vbe wsf hta jar apk dmg lnk reg cpl msc';

const clean = s => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
const extList = v => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/))
  .map(e => String(e).toLowerCase().replace(/^\./, '').replace(/[^a-z0-9]/g, '').slice(0, 10)).filter(Boolean))].slice(0, 40);

function stored() {
  try {
    const raw = JSON.parse(getSetting('file_categories', 'null'));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch { /* Standard */ }
  return null;
}
function normalize(list) {
  const seen = new Set(), out = [];
  for (const c of list || []) {
    const name = clean(c && c.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, icon: [...String(c.icon || '📁')].slice(0, 2).join('') || '📁', ext: extList(c.ext), game: !!c.game });
  }
  if (!out.some(c => c.name === 'Allgemein')) out.unshift({ ...DEFAULTS[0] });
  return out.slice(0, 60);
}

// Die Liste aus der Seitenverwaltung, ergänzt um Kategorien, die nur noch an Dateien hängen
function list() {
  const base = normalize(stored() || DEFAULTS);
  const known = new Set(base.map(c => c.name.toLowerCase()));
  for (const r of db.prepare('SELECT DISTINCT category FROM files').all()) {
    if (r.category && !known.has(r.category.toLowerCase())) { base.push({ name: r.category, icon: '📁', ext: [], game: false, loose: true }); known.add(r.category.toLowerCase()); }
  }
  return base;
}
function save(next) { setSetting('file_categories', JSON.stringify(normalize(next))); }

// Umbenennen nimmt die Dateien mit, Löschen legt sie unter „Allgemein“
function rename(from, to) {
  from = clean(from); to = clean(to);
  if (!from || !to || from === to) return;
  save(list().filter(c => !c.loose || c.name === from).map(c => (c.name === from ? { ...c, name: to } : c)));
  db.prepare('UPDATE files SET category = ? WHERE category = ?').run(to, from);
}
function remove(name) {
  name = clean(name);
  if (!name || name === 'Allgemein') return;
  save(list().filter(c => !c.loose && c.name !== name));
  db.prepare("UPDATE files SET category = 'Allgemein' WHERE category = ?").run(name);
}

const extOf = name => path.extname(String(name || '')).toLowerCase().replace(/^\./, '');
// Vorschlag für eine Datei nach ihrer Endung
function guess(filename, cats = list()) {
  const e = extOf(filename);
  const hit = e && cats.find(c => c.ext.includes(e));
  return hit ? hit.name : 'Allgemein';
}
function iconOf(name, cats = list()) {
  const c = cats.find(x => x.name === name);
  return c ? c.icon : '📁';
}
// Gültige Kategorie aus einem Formular (unbekannte Namen landen unter „Allgemein“)
function pick(name, cats = list()) {
  const n = clean(name);
  const c = n && cats.find(x => x.name.toLowerCase() === n.toLowerCase());
  return c ? c.name : 'Allgemein';
}

function blockedExt() { return extList(getSetting('upload_blocked_ext', BLOCKED_DEFAULT)); }
function isBlocked(user, filename) { return !(user && user.isAdmin) && blockedExt().includes(extOf(filename)); }

module.exports = { DEFAULTS, BLOCKED_DEFAULT, list, save, rename, remove, guess, iconOf, pick, extList, extOf, blockedExt, isBlocked };
