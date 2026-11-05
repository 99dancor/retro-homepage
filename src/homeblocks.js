'use strict';
// Bausteine der Startseite (Seitenverwaltung → Aussehen → Startseite): an oder aus, Reihenfolge, linke oder rechte Spalte
// und für wen. Gespeichert als JSON in home_blocks; neue Bausteine kommen mit ihrer Vorgabe von selbst dazu.
const { getSetting, setSetting } = require('./db');

const BLOCKS = {
  willkommen: { label: '👋 Willkommen', hint: 'Text der Startseite, Regeln, Kurzer Rundgang', col: 'main', on: true },
  neuigkeiten: { label: '📰 Neuigkeiten', hint: 'Blog, Forum, Downloads und Besucherbuch in einer Liste mit Reitern', col: 'main', on: true },
  schnellstart: { label: '🚀 Schnellstart', hint: 'Programme als große Symbole', col: 'main', on: false },
  dienste: { label: '🗄️ Server-Status', hint: 'Dienste mit „Startseite“, nur was der Besucher sehen darf', col: 'side', on: true },
  update: { label: '🆕 Neu auf der Seite', hint: 'Das letzte Update mit Nummer', col: 'side', on: true },
  mitmachen: { label: '🔑 Mitmachen', hint: 'Anmelden und Registrieren', col: 'side', on: true, for: 'guests' },
  speicher: { label: '💽 Belegter Speicher', hint: 'Wie im Widget „Dienste“, wenn der Besucher ihn sehen darf', col: 'side', on: false },
  besucherbuch: { label: '📖 Zuletzt im Besucherbuch', hint: 'Die letzten drei Einträge', col: 'side', on: false },
};
const FOR = { all: 'Alle', guests: 'Nur Gäste', members: 'Nur Mitglieder' };
const COLS = { main: 'Links (breit)', side: 'Rechts (schmal)' };

function list() {
  let saved = [];
  try { saved = JSON.parse(getSetting('home_blocks', '') || '[]'); } catch { saved = []; }
  const out = [], seen = new Set();
  for (const b of Array.isArray(saved) ? saved : []) {
    if (!b || !Object.hasOwn(BLOCKS, b.key) || seen.has(b.key)) continue;
    seen.add(b.key);
    const d = BLOCKS[b.key];
    out.push({ key: b.key, ...d, on: b.on !== false && b.on !== 0, col: Object.hasOwn(COLS, b.col) ? b.col : d.col, for: Object.hasOwn(FOR, b.for) ? b.for : d.for || 'all' });
  }
  for (const [key, d] of Object.entries(BLOCKS)) if (!seen.has(key)) out.push({ key, ...d, for: d.for || 'all' });
  return out;
}
// Für einen Besucher: { main: [...], side: [...] }
function forViewer(user) {
  const out = { main: [], side: [] };
  for (const b of list()) if (b.on && (b.for === 'all' || (b.for === 'guests' && !user) || (b.for === 'members' && !!user))) out[b.col].push(b.key);
  return out;
}
function save(body) {
  const order = [].concat(body.order || []).filter(k => Object.hasOwn(BLOCKS, k));
  const keys = [...new Set([...order, ...Object.keys(BLOCKS)])];
  setSetting('home_blocks', JSON.stringify(keys.map(key => ({
    key, on: [].concat(body.on || []).includes(key), col: Object.hasOwn(COLS, body['col_' + key]) ? body['col_' + key] : BLOCKS[key].col,
    for: Object.hasOwn(FOR, body['for_' + key]) ? body['for_' + key] : BLOCKS[key].for || 'all',
  }))));
}
function move(key, dir) {
  const l = list(), i = l.findIndex(b => b.key === key), j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  setSetting('home_blocks', JSON.stringify(l.map(b => ({ key: b.key, on: b.on, col: b.col, for: b.for }))));
}

module.exports = { BLOCKS, FOR, COLS, list, forViewer, save, move };
