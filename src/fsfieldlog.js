'use strict';
// Feldbuch (ab Mod 3.8): was auf jedem Feld gesät und geerntet wurde, mit Vorschlag für die nächste Frucht.
//
// Quelle sind die Live-Daten der Mod (Stand jedes Felds alle paar Minuten). Der Hub merkt sich den letzten Stand je Feld
// (Einstellung fs_field_last, gehört wie die Einträge zum Spielstand) und trägt ein:
//   gesät     die Frucht des Felds wechselt auf eine andere (nicht leer)
//   geerntet  das Feld war erntereif (HARVEST_READY) und ist es nicht mehr
// Grünland (Gras mähen) zählt nicht.
//
// Fruchtfolge: einfache Ackerbau-Regeln über Fruchtgruppen. Nach Getreide Blattfrucht (Raps, Leguminosen, Hackfrucht),
// nach Blattfrucht Getreide, nie zweimal dieselbe Gruppe außer Getreide (höchstens zweimal), Raps und Hackfrüchte mit Pause.
const { db, now, getSetting, setSetting, tx } = require('./db');
const N = require('./fsnames');

const READY = new Set(['HARVEST_READY', 'HARVEST_READY_OTHER']);
const SKIP = new Set(['GRASS', 'MEADOW', 'POPLAR', 'OILSEEDRADISH']);
const KEEP = 30;

const GROUPS = {
  getreide: { label: 'Getreide', fruits: ['WHEAT', 'BARLEY', 'OAT', 'RYE', 'TRITICALE', 'SORGHUM', 'RICE', 'RICELONGGRAIN', 'SPELT'] },
  mais: { label: 'Mais', fruits: ['MAIZE'] },
  oel: { label: 'Ölfrucht', fruits: ['CANOLA', 'SUNFLOWER'] },
  legum: { label: 'Leguminosen', fruits: ['SOYBEAN', 'PEA', 'GREENBEAN'] },
  hack: { label: 'Hackfrucht', fruits: ['POTATO', 'SUGARBEET', 'CARROT', 'PARSNIP', 'REDBEET', 'ONION', 'SPINACH'] },
  dauer: { label: 'Dauerkultur', fruits: ['SUGARCANE', 'COTTON', 'GRAPE', 'OLIVE', 'COFFEE', 'BANANA'] },
};
const GROUP_OF = {};
for (const [k, g] of Object.entries(GROUPS)) for (const f of g.fruits) GROUP_OF[f] = k;
const groupOf = fruit => GROUP_OF[String(fruit || '').toUpperCase()] || null;

// Nach welcher Gruppe was gut passt (erste = beste), mit Begründung
const AFTER = {
  getreide: [['oel', 'CANOLA', 'Raps lockert die Getreidefolge auf und nutzt den Boden tiefer'], ['legum', 'SOYBEAN', 'Leguminosen bringen Stickstoff für die nächste Frucht'],
    ['hack', 'SUGARBEET', 'Hackfrucht unterbricht Krankheiten des Getreides']],
  mais: [['legum', 'SOYBEAN', 'nach Mais Stickstoff aufbauen'], ['getreide', 'WHEAT', 'Weizen nach Mais geht, besser mit gepflügtem Boden']],
  oel: [['getreide', 'WHEAT', 'Weizen nach Raps ist die klassische Folge mit hohem Ertrag']],
  legum: [['getreide', 'WHEAT', 'Weizen nutzt den Stickstoff der Leguminosen'], ['mais', 'MAIZE', 'Mais nutzt den Stickstoff der Leguminosen']],
  hack: [['getreide', 'WHEAT', 'Getreide nach Hackfrucht, der Boden ist locker und unkrautarm']],
};
// Pause in Ernten, bevor dieselbe Gruppe wiederkommen sollte
const PAUSE = { oel: 3, hack: 3, legum: 3, mais: 1 };

function last() {
  try { return JSON.parse(getSetting('fs_field_last', '') || '{}') || {}; } catch { return {}; }
}

// Neuer Stand aus den Live-Daten: Ereignisse eintragen, Stand merken
function record(fields, day) {
  if (!Array.isArray(fields) || !fields.length) return 0;
  const prev = last();
  const first = !Object.keys(prev).length;
  const next = {};
  const put = db.prepare('INSERT INTO fs_fieldlog(field, event, fruit, game_day, created_at) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  tx(() => {
    for (const f of fields) {
      if (f.id === null || f.id === undefined) continue;
      const cur = { fruit: f.fruit || null, ground: f.ground || null };
      next[f.id] = cur;
      const p = prev[f.id];
      if (first || !p) continue;
      if (p.ground && READY.has(p.ground) && !READY.has(cur.ground || '') && p.fruit && !SKIP.has(p.fruit)) {
        put.run(f.id, 'harvest', p.fruit, day || null, now());
        n++;
      }
      if (cur.fruit && cur.fruit !== p.fruit && !SKIP.has(cur.fruit) && !READY.has(cur.ground || '')) {
        put.run(f.id, 'sow', cur.fruit, day || null, now());
        n++;
      }
    }
    setSetting('fs_field_last', JSON.stringify(next));
    if (n) db.prepare('DELETE FROM fs_fieldlog WHERE id IN (SELECT id FROM fs_fieldlog f WHERE (SELECT COUNT(*) FROM fs_fieldlog g WHERE g.field = f.field AND g.id > f.id) >= ?)').run(KEEP);
  });
  return n;
}

function entries(field) {
  return db.prepare('SELECT event, fruit, game_day, created_at FROM fs_fieldlog WHERE field = ? ORDER BY id DESC LIMIT ?').all(Number(field), KEEP);
}

// Fruchtfolge: aus den Früchten (neueste zuerst; die aktuelle Frucht des Felds zählt als neueste)
function suggest(fruits) {
  const list = fruits.map(f => String(f || '').toUpperCase()).filter(f => f && !SKIP.has(f));
  if (!list.length) return null;
  const g0 = groupOf(list[0]);
  if (!g0) return null;
  if (g0 === 'dauer') return { fruit: null, text: 'Dauerkultur, keine Fruchtfolge nötig', why: '' };
  const groups = list.map(groupOf);
  const cereals = groups.findIndex(g => g !== 'getreide');
  const cerealRun = cereals < 0 ? groups.length : cereals;
  let opts = AFTER[g0] || [];
  // Getreide nach einmal Getreide (nicht Mais) ist noch in Ordnung, ab dem zweiten Mal Blattfrucht
  if (g0 === 'getreide' && cerealRun === 1 && list[0] === 'WHEAT') opts = [...opts, ['getreide', 'BARLEY', 'Gerste nach Weizen geht einmal, danach Blattfrucht']];
  for (const [g, fruit, why] of opts) {
    const pause = PAUSE[g] || 0;
    const recent = groups.slice(0, pause).includes(g);
    if (!recent) return { fruit, group: g, text: `${N.fill(fruit)} (${GROUPS[g].label})`, why };
  }
  const [g, fruit, why] = opts[opts.length - 1] || [];
  return g ? { fruit, group: g, text: `${N.fill(fruit)} (${GROUPS[g].label})`, why } : null;
}

// Für die Infokarte: Einträge lesbar und der Vorschlag
function card(field, currentFruit, fmtDay) {
  const rows = entries(field);
  const harvested = rows.filter(r => r.event === 'harvest').map(r => r.fruit);
  const fruits = currentFruit && !SKIP.has(currentFruit) && currentFruit !== harvested[0] ? [currentFruit, ...harvested] : harvested;
  return {
    log: rows.slice(0, 8).map(r => ({ what: `${r.event === 'harvest' ? 'geerntet' : 'gesät'}: ${N.fill(r.fruit)}`, when: (r.game_day && fmtDay && fmtDay(r.game_day)) || '' })),
    next: suggest(fruits),
  };
}

module.exports = { record, entries, suggest, card, groupOf, GROUPS };
