'use strict';
// Farming Simulator Hub (Startmenü → 🚜 Farming Simulator). Links die Bereiche, rechts der Inhalt. Daten und Regeln: src/fshub.js,
// Abruf der Feeds: src/fsfeeds.js, Einstellungen: Seitenverwaltung → Farming (src/routes/admin.js).
//
//   GET  /farming                 Serverübersicht mit Heute erledigen und Notizen
//   GET  /farming/karte           Karte (Früchte, Wachstum, Boden, Bodenart, Besitz; ?feld=, ?station=, ?fahrzeug= wählt aus)
//   GET  /farming/karte.bild      Kartenbild                             GET /farming/hintergrund.bild  Hintergrund der Übersicht
//   GET  /farming/karte/ebene/<k>.png  Bild je Fleck (Dichtekarten)      GET /farming/symbol/<k>.png  hochgeladenes Symbol
//   GET  /farming/produktion      Produktionsplaner (?bereich=karte|eigene|katalog, ?g=Gebäude, ?p=Produktion, Rechner)
//   GET  /farming/preise          Preise mit Graph und Produktionen (?w=WHEAT)   GET /farming/mods  Modliste und Abgleich
//   GET  /farming/hof/<id>        Hof, ?tab=uebersicht (Kacheln) | inventar | produktion | fahrzeuge | finanzen | kalender | aufgaben
//   GET  /farming/wiki            Wiki: Anbaukalender (?frucht=WHEAT)      GET /farming/wiki/tiere  Tiere (?tier=COW)
//   GET  /farming/changelog       Änderungen am Server und am Hub        GET /farming/vorschlaege Wünsche und Ideen
//   POST …                        Formulare (Notizen, Aufgaben, Pläne, Orte, Bodenverteilung, Hof, Changelog, Vorschläge)
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const auth = require('../auth');
const hub = require('../fshub');
const feeds = require('../fsfeeds');
const N = require('../fsnames');
const fsicons = require('../fsicons');
const { getSetting, setSetting } = require('../db');
const profiles = require('../profiles');

const router = express.Router();
const TABS = { uebersicht: 'Übersicht', inventar: 'Inventar', produktion: 'Produktion', fahrzeuge: 'Fahrzeuge', finanzen: 'Finanzen', kalender: 'Kalender', aufgaben: 'Aufgaben' };
const OK = { notiz: 'Notiz gespeichert.', geloescht: 'Gelöscht.', aufgabe: 'Aufgabe angelegt.', erledigt: 'Erledigt.', gespeichert: 'Gespeichert.', beigetreten: 'Willkommen auf dem Hof!',
  ausgetreten: 'Du gehörst keinem Hof mehr an.', plan: 'In den Hofkalender eingetragen.', ort: 'Ort angelegt.', ausgeblendet: 'Ausgeblendet, bis sich etwas ändert.',
  uebernommen: 'Als Aufgabe übernommen.', vorschlag: 'Danke für deinen Vorschlag!', abgeglichen: 'Server-Haken der Modliste abgeglichen.', berater: 'Gespeichert, die Mod übernimmt es beim nächsten Abgleich.', eintrag: 'Eintrag gespeichert.' };
const limit = auth.rateLimit('farming', 300, 3600);

// ---------- Zahlen ----------
const de = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = n => (n === null || n === undefined ? '–' : de(Math.round(n)) + ' €');
const big = n => (n === null || n === undefined ? '–' : Math.abs(n) >= 1e6 ? de(n / 1e6, 2) + ' Mio €' : Math.abs(n) >= 1e4 ? de(n / 1e3, 1) + ' Tsd €' : eur(n));
const liters = n => de(Math.round(n)) + ' l';
const ha = n => de(n, 1) + ' ha';
function ago(t) {
  if (!t) return 'nie';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 60) return `vor ${s} Sekunden`;
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  return `vor ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'Tag' : 'Tagen'}`;
}
const mins = m => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} Std.${Math.round(m % 60) ? ' ' + Math.round(m % 60) : ''}`);
const when = t => {
  const d = new Date(t * 1000), td = hub.today(), dd = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  if (dd === td) return 'heute, ' + hm;
  if (dd === new Date(Date.now() - 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })) return 'gestern, ' + hm;
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: '2-digit', timeZone: 'Europe/Berlin' }) + ', ' + hm;
};
// Kleiner Liniengraph als SVG-Pfad (Preise, Kontostand)
function spark(values, w, h, pad = 1) {
  const v = values.map(x => (x === null || x === undefined ? null : Number(x)));
  const ok = v.filter(x => x !== null);
  if (!ok.length) return '';
  const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
  return v.map((x, i) => (x === null ? null : `${(pad + i * (w - 2 * pad) / Math.max(1, v.length - 1)).toFixed(1)},${(h - pad - (x - lo) / span * (h - 2 * pad)).toFixed(1)}`))
    .filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p).join(' ');
}
// Felder für SVG-Karten im Maß 0–1000: echte Form aus der Dichtekarte (d), sonst ein Kreis um den Mittelpunkt (halb so groß wie die Fläche,
// sonst überdecken sich die Felder)
function geo(fields, m, shp) {
  const S = m.size || 2048, P = v => (v + S / 2) / S * 1000;
  return fields.map(f => {
    const s = shp && shp.shapes[f.id];
    const r = Math.max(6, 0.55 * Math.sqrt((f.area || 0.5) * 10000 / Math.PI) / S * 1000);
    return { ...f, d: s ? s.d : null, cx: s ? s.cx : +P(f.x).toFixed(1), cy: s ? s.cy : +P(f.z).toFixed(1), r: +r.toFixed(1) };
  });
}
// Ausschnitt um eine Reihe von Feldern (viewBox), mit etwas Rand
function frame(gs, pad = 20) {
  if (!gs.length) return '0 0 1000 1000';
  const x0 = Math.min(...gs.map(g => g.cx - g.r * 1.6)) - pad, x1 = Math.max(...gs.map(g => g.cx + g.r * 1.6)) + pad;
  const y0 = Math.min(...gs.map(g => g.cy - g.r * 1.6)) - pad, y1 = Math.max(...gs.map(g => g.cy + g.r * 1.6)) + pad;
  const w = Math.max(x1 - x0, y1 - y0, 120), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [cx - w / 2, cy - w / 2, w, w].map(v => v.toFixed(0)).join(' ');
}
const fieldName = f => 'Grundstück ' + f.id;
const helpers = { fieldName, icon: fsicons.html, geo, frame, de, eur, big, liters, ha, ago, mins, when, spark, N, TABS, hhmm: hub.hhmm, fmtDay: hub.fmtDay, STATUS: hub.STATUS, displayName: profiles.displayName, recipeName: hub.prod.recipeName };

// ---------- Zugriff ----------
router.use((req, res, next) => {
  if (!hub.enabled()) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Der Farming Simulator Hub ist ausgeschaltet.' });
  if (!hub.canView(req.user)) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  if (req.method === 'GET' && !/^\/(karte\.bild|karte\/ebene\/|symbol\/)/.test(req.path)) res.set('Cache-Control', 'no-store');
  next();
});
const login = (req, res, next) => (req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.get('referer') || '/farming')));
const deny = (res, message) => res.status(403).render('error', { title: 'Kein Zugriff', message });
function back(req, res, fallback, ok) {
  let to = String((req.body && req.body.back) || '');
  if (!/^\/farming(\/|\?|#|$)/.test(to) || to.includes('//')) to = fallback;
  const [p, hash] = to.split('#');
  res.redirect(p.replace(/([?&])ok=[^&]*&?/, '$1').replace(/[?&]$/, '') + (ok ? (p.includes('?') ? '&' : '?') + 'ok=' + ok : '') + (hash ? '#' + hash : ''));
}
function farmParam(req, res, next) {
  const f = hub.farm(req.params.id);
  if (!f) return next('route');
  req.farm = f;
  next();
}
const farmEditor = (req, res, next) => (hub.canEditFarm(req.user, req.farm.id) ? next() : deny(res, 'Das dürfen nur Mitglieder dieses Hofs und Admins.'));

// Gemeinsame Daten aller Seiten: Seitenleiste mit Höfen und Zählern
function page(req, res, view, data) {
  const m = hub.model();
  const due = new Map();
  for (const t of hub.openTasks()) if (t.isDue) for (const f of t.farm_id ? [t.farm_id] : m.farms.map(x => x.id)) due.set(f, (due.get(f) || 0) + 1);
  res.render('fshub/' + view, {
    ...helpers, m, st: m.stats, due, section: view, query: req.query, myFarm: req.user ? hub.farmOf(req.user.id) : null, msg: OK[req.query.ok] || null,
    canEdit: id => hub.canEditFarm(req.user, id), isAdmin: !!(req.user && req.user.isAdmin), backUrl: req.originalUrl.replace(/([?&])ok=[^&]*/, '$1').replace(/[?&]$/, ''),
    title: data.title || 'Farming Simulator', ...data,
  });
}

// ---------- Seiten ----------
router.get('/', (req, res) => {
  const m = hub.model();
  const columns = m.farms.map(f => ({ farm: f, tasks: hub.tasks(f.id).filter(t => t.isDue), auto: hub.suggestions(f.id) }));
  const players = m.players.map(p => {
    const account = hub.accountFor(p.name), fid = account && hub.farmOf(account.id);
    return { ...p, account, farm: fid ? m.farms.find(f => f.id === fid) || null : null, vehicle: m.vehicles.find(v => v.driver === p.name) || null };
  });
  const seen = hub.sessionsToday().map(s => ({ ...s, account: hub.accountFor(s.name) }));
  const owned = m.lands.filter(l => l.owner > 0);
  page(req, res, 'overview', { columns, players, seen, owned, notes: hub.notes(), bg: background(), editNote: Number(req.query.notiz) || null,
    lastCount: hub.changelog(20).filter(c => c.kind === 'mods' && c.created_at > Date.now() / 1000 - 86400).length });
});

// Produktionsplaner: oben die drei Bereiche (Karte, eigene Gebäude, Katalog), links deren Gebäude, rechts das gewählte mit seinen
// Produktionen, Lager, Rezept und Rechner. Alles über die Adresse: bereich, g = Gebäude, p = Produktion, rechnen = 1 mit
// in0 … / zyklen / gleich. Kein JavaScript nötig, nichts zum Eintragen: alles kommt aus dem Spiel.
// Suche: alle Wörter müssen im Gebäude, in einer Produktion, einer Ware oder dem DLC vorkommen
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const searchText = b => norm([b.label, b.name, b.dlc, b.farm && b.farm.name, ...b.recipes.flatMap(r => [r.name, ...r.inputs.map(x => x.name), ...r.outputs.map(x => x.name)])].join(' '));
const matches = (text, q) => norm(q).split(/\s+/).filter(Boolean).every(w => text.includes(w));
helpers.searchText = searchText;
const SIZE = /\s*\((klein|mittel|groß)(?:, ([^)]+))?\)$/i, POWER = /\s+([\d.,]+\s*(?:kW|MW))$/i;
const baseName = label => String(label).replace(SIZE, (m, size, extra) => (extra ? ` (${extra})` : '')).replace(POWER, '').trim();
helpers.baseName = baseName;
// Name der Größe innerhalb der Gruppe: „klein“, „1MW“
const sizeName = b => { const m = SIZE.exec(b.label) || POWER.exec(b.label); return m ? m[1] : 'Standard'; };
helpers.sizeName = sizeName;
helpers.norm = norm;

router.get('/produktion', (req, res) => {
  const full = hub.planner();
  const q = String(req.query.q || '').trim().slice(0, 60);
  const lists = q ? Object.fromEntries(Object.entries(full).map(([k, l]) => [k, l.filter(b => matches(searchText(b), q))])) : full;
  const all = [...full.karte, ...full.eigene, ...full.katalog];
  const picked = all.find(b => b.key === req.query.g) || null;
  const wanted = Object.hasOwn(hub.prod.SECTIONS, req.query.bereich) ? req.query.bereich : null;
  // Bei einer Suche ohne Treffer im Bereich: in den Bereich mit Treffern wechseln
  const firstHit = Object.keys(hub.prod.SECTIONS).find(k => lists[k].length);
  const section = picked ? picked.section : wanted && (!q || lists[wanted].length) ? wanted : q && firstHit ? firstHit
    : lists.eigene.length ? 'eigene' : lists.karte.length ? 'karte' : 'katalog';
  const list = lists[section];
  const sel = picked || list[0] || null;
  const rec = sel ? sel.recipes.find(r => r.id === req.query.p) || sel.recipes.find(r => r.active) || sel.recipes[0] || null : null;
  const dpp = hub.daysPerPeriod();
  let calc = null, form = null;
  if (rec && req.query.rechnen) {
    const n = v => { const x = Number(String(v ?? '').replace(',', '.')); return v === undefined || v === '' || !Number.isFinite(x) || x < 0 ? null : x; };
    form = { amounts: rec.inputs.map((_, i) => n(req.query['in' + i])), cycles: n(req.query.zyklen), shared: Math.max(1, Math.min(99, Math.round(n(req.query.gleich) || 1))) };
    if (form.amounts.some(a => a !== null) || form.cycles !== null) calc = hub.prod.calc(rec, { ...form, shared: sel.mode === 'seriell' ? form.shared : 1, dpp });
  }
  const info = rec && rec.cycles > 0 ? hub.prod.calc(rec, { cycles: 0, shared: 1, dpp }) : null;
  // Tierprodukte als Input (Wolle, Milch, Eier, Gülle …): wie viele ausgewachsene Tiere decken den Bedarf eines vollen Monats
  const herd = rec ? hub.wiki.herd(rec, dpp) : [];
  // Gleiche Art an anderer Stelle: Katalog ↔ Karte ↔ eigene
  // Größen eines Gebäudes (Gewächshaus klein/mittel/groß, Biogasanlage 99 kW … 1 MW) stehen links als ein Eintrag
  const variants = sel ? list.filter(b => b.section === sel.section && (b.dlc || '') === (sel.dlc || '') && baseName(b.label) === baseName(sel.label)).sort((a, b) => (a.price || 0) - (b.price || 0)) : [];
  const same = sel ? all.filter(b => b !== sel && b.type === sel.type && !variants.includes(b)) : [];
  // Katalog gruppiert nach DLC bzw. Shop-Kategorie
  const m = hub.model();
  page(req, res, 'planner', { title: 'Produktionsplaner – Farming Simulator', lists, q, section, list, sel, rec, calc, form, info, herd, dpp, same, variants, SECTIONS: hub.prod.SECTIONS, MODES: hub.prod.MODES,
    station: sel && sel.uid ? m.stations.find(s => s.uid === sel.uid) || null : null, gameData: m.gameData });
});
const plannerUrl = (g, p) => '/farming/produktion?g=' + encodeURIComponent(g || '') + (p ? '&p=' + encodeURIComponent(p) : '');
helpers.plannerUrl = plannerUrl;
const adminPage = (req, res, next) => (req.user && req.user.isAdmin ? next() : deny(res, 'Das dürfen nur Admins.'));

// Kartenbild: das eigene, sonst das vom Server. Die Seite hängt ?v=<Änderungszeit> an, so kommt ein neues Bild sofort.
function mapImage() {
  const custom = fs.readdirSync(feeds.FS_DIR).find(f => /^map-custom\.(png|jpe?g|webp)$/.test(f));
  const file = custom ? path.join(feeds.FS_DIR, custom) : feeds.MAP_FILE;
  try { return { file, custom, v: Math.round(fs.statSync(file).mtimeMs).toString(36) }; } catch { return null; }
}
router.get('/karte.bild', (req, res) => {
  const img = mapImage();
  if (!img) return res.status(404).end();
  const { file, custom } = img;
  res.set('Cache-Control', req.query.v === img.v ? 'private, max-age=604800, immutable' : 'no-cache');
  res.type(custom ? path.extname(custom) : (fs.readFileSync(file).subarray(0, 2).toString('hex') === 'ffd8' ? 'jpg' : 'png')).sendFile(file);
});

// Hintergrund der Übersicht: je Karte ein eigenes Bild (Seitenverwaltung), halb durchsichtig hinter dem Inhalt
function background() {
  const f = hub.backgroundFile();
  try { return f ? { file: f, v: Math.round(fs.statSync(f).mtimeMs).toString(36) } : null; } catch { return null; }
}
router.get('/hintergrund.bild', (req, res) => {
  const bg = background();
  if (!bg) return res.status(404).end();
  res.set('Cache-Control', req.query.v === bg.v ? 'private, max-age=604800, immutable' : 'no-cache').sendFile(bg.file);
});

// Karte: fünf Ansichten wie im Spiel, je Ansicht Einträge zum Ein- und Ausblenden. Grundstücke sind Umrisse aus dem Spiel, was
// darauf wächst, liegt als Bild je Eintrag darüber (je Fleck aus den Dichtekarten, src/fsmap.js). Ohne Dichtekarten färbt der Hub
// jedes Grundstück nach fields.xml ein. Das Umschalten macht nur noch CSS (public/fshub.css) und public/fshub.js.
const MAP_LAYERS = { fruechte: 'Feldfrüchte', wachstum: 'Wachstum', boden: 'Boden', bodenart: 'Bodenart', besitz: 'Besitz' };
const LAYER_ALIAS = { zustand: 'wachstum', pflege: 'boden' };
const NONE = 'rgba(255,255,255,.2)';   // leer oder unbekannt: hell, damit das Grundstück auf jedem Kartenbild zu sehen ist
const CLEAR = 'rgba(0,0,0,0)';         // Ansicht mit Bildern je Fleck: Grundstück nur als Umriss
const SOIL_COLOR = Object.fromEntries(hub.SOILS.map(([k, , c]) => [k, c]));
const CARE = [['kalk', 'Kalk nötig', '#e0c52c'], ['pflug', 'Pflügen fällig', '#c8693a'], ['duenger', 'Düngen', '#4b97ec'], ['unkraut', 'Unkraut', '#b062c8'], ['steine', 'Steine', '#9a9a9a']];
// Bilder der Pflege: Reihenfolge = Zeichenreihenfolge, was zu tun ist, liegt oben
const CARE_RAS = { duenger2: ['Zweimal gedüngt', '#1f4fb8'], duenger1: ['Einmal gedüngt', '#7db8f2'], pflug: ['Pflügen fällig', '#c8693a'], kalk: ['Kalk nötig', '#e0c52c'] };
function mapView(fields, m, shp, crops) {
  const ras = shp && shp.ras && shp.ras.images ? shp.ras : null;
  const img = { fruechte: !!(ras && Object.keys(ras.images.fruits).length), wachstum: !!(ras && Object.keys(ras.images.states).length), boden: !!(ras && Object.keys(ras.images.care).length) };
  const gs = geo(fields, m, shp).map(g => {
    const care = g.source === 'auto' ? (CARE.find(([k]) => g.care.some(c => c.key === k)) || ['ok', 'Alles erledigt', '#5aa83c']) : null;
    return { ...g, layer: {
      fruechte: img.fruechte ? ['', CLEAR] : g.crop ? ['crop:' + g.crop, g.cropColor || '#8fd16a'] : ['crop:', NONE],
      wachstum: img.wachstum ? ['', CLEAR] : g.state ? ['state:' + g.state, N.STATES[g.state][1]] : ['state:', NONE],
      boden: img.boden ? ['', CLEAR] : care ? ['care:' + care[0], care[2]] : ['care:', NONE],
      bodenart: g.soil && g.soil.top ? ['soil:' + g.soil.top, SOIL_COLOR[g.soil.top]] : ['soil:', NONE],
      besitz: g.farm ? ['farm:' + g.farm.id, g.farm.color] : ['farm:0', 'rgba(255,255,255,.22)'],
    } };
  });
  const count = (layer, key) => { const xs = gs.filter(g => g.layer[layer][0] === key); return { n: xs.length, ha: xs.reduce((a, g) => a + (g.area || 0), 0) }; };
  const cropOf = name => { const c = crops.find(x => x.name === name || x.fill === name); return c ? { label: c.label, color: c.color, fill: c.fill } : /^\?\d+$/.test(name) ? { label: 'Unbekannte Frucht ' + name.slice(1), color: '#9aa394', fill: null } : { label: N.fill(name), color: '#8fd16a', fill: name }; };
  const groups = {};
  // Feldfrüchte: je Frucht ein Bild (Fläche in ha), Plantagen als Reihen dazu
  if (img.fruechte) {
    const items = Object.entries(ras.totals.fruits).map(([name, ha]) => ({ key: 'f:' + name, ...cropOf(name), ha, n: null, image: ras.images.fruits[name] }));
    for (const o of m.orchards) if (!items.some(i => i.key === 'f:' + o.type)) items.push({ key: 'f:' + o.type, ...cropOf(o.type), ha: null, n: o.rows.length, rows: true });
    groups.fruechte = items.sort((a, b) => (b.ha || 0) - (a.ha || 0));
  } else {
    const list = [...new Map(gs.filter(g => g.crop).map(g => [g.crop, g])).values()];
    groups.fruechte = [...list.map(g => ({ key: 'crop:' + g.crop, label: g.crop, color: g.cropColor || '#8fd16a', fill: g.cropFill })), { key: 'crop:', label: 'Leer oder unbekannt', color: NONE }];
    for (const o of m.orchards) if (!groups.fruechte.some(i => i.fill === o.type)) groups.fruechte.unshift({ key: 'f:' + o.type, ...cropOf(o.type), n: o.rows.length, rows: true });
  }
  groups.wachstum = img.wachstum ? Object.keys(N.STATES).filter(k => ras.images.states[k]).map(k => ({ key: 's:' + k, label: N.STATES[k][0], color: N.STATES[k][1], ha: ras.totals.states[k], n: null, image: ras.images.states[k] }))
    : [...Object.entries(N.STATES).map(([k, [l, c]]) => ({ key: 'state:' + k, label: l, color: c })), { key: 'state:', label: 'Unbekannt', color: NONE }];
  groups.boden = img.boden ? Object.keys(CARE_RAS).filter(k => ras.images.care[k]).map(k => ({ key: 'c:' + k, label: CARE_RAS[k][0], color: CARE_RAS[k][1], ha: ras.totals.care[k], n: null, image: ras.images.care[k] })).reverse()
    : [...CARE, ['ok', 'Alles erledigt', '#5aa83c']].map(([k, l, c]) => ({ key: 'care:' + k, label: l, color: c })).concat([{ key: 'care:', label: 'Unbekannt (nur mit FTP)', color: NONE }]);
  groups.bodenart = [...hub.SOILS.map(([k, l, c]) => ({ key: 'soil:' + k, label: l, color: c })), { key: 'soil:', label: 'Nicht eingetragen', color: NONE }];
  groups.besitz = [...m.farms.map(f => ({ key: 'farm:' + f.id, label: f.name, color: f.color })), { key: 'farm:0', label: 'Zu kaufen', color: 'rgba(255,255,255,.22)' }];
  for (const [layer, items] of Object.entries(groups)) {
    for (const it of items) if (!it.image && !it.rows) Object.assign(it, count(layer, it.key));
    groups[layer] = items.filter(it => it.image || it.rows || it.n || it.key.startsWith('farm:'));
    if (layer === 'fruechte' && !img.fruechte) groups[layer].sort((a, b) => (a.key === 'crop:') - (b.key === 'crop:') || (b.ha || 0) - (a.ha || 0));
  }
  return { gs, groups, img, ras };
}
// Daten je Grundstück für die Infokarte (public/fshub.js baut sie beim Klick)
function fieldCard(g, req, m, ex) {
  const a = g.source === 'auto' ? g.auto : null;
  const exFields = new Map(((ex && ex.fields) || []).map(f => [f.id, f]));
  const pt = g.patch;
  const here = m.stations.filter(s => s.placed && hub.parcelAt(s.x, s.z) === g.id).map(s => ({ uid: s.uid, name: s.name, cat: s.cat }));
  return { id: g.id, ha: g.area, farm: g.farm ? { id: g.farm.id, name: g.farm.name, color: g.farm.color } : null, price: g.price || null,
    fields: (g.fieldIds || []).map(id => ({ id, ha: exFields.has(id) ? exFields.get(id).ha : null })),
    fieldHa: pt ? pt.ha : null,
    mix: g.mix.map(x => ({ name: x.name, color: x.color, ha: x.ha, icon: x.fill ? fsicons.html(x.fill, x.name, 's') : '' })),
    states: g.states.map(x => ({ label: x.label, color: (N.STATES[x.key] || [0, '#999'])[1], ha: x.ha })),
    crop: g.crop, icon: g.crop && g.cropFill ? fsicons.html(g.cropFill, g.crop, 's') : '', state: g.state ? N.STATES[g.state][0] : null, src: g.source,
    growth: a ? a.growth : null, soil: a ? { lime: a.lime, spray: a.spray, plow: !!a.plow } : null,
    care: g.care.map(c => c.label), autoAt: g.autoAt && (a || pt) ? when(g.autoAt) : null, orchard: g.orchard ? N.fill(g.orchard) : null, soilType: g.soil, stations: here,
    plan: g.plan ? `${g.plan.crop}, säen ${N.MONTHS[g.plan.sow_month]}, ernten ${N.MONTHS[g.plan.harvest_month]}` : null,
    edit: !!req.user && !!g.farm && hub.canEditFarm(req.user, g.farm.id) };
}

// Daten je Station für Markierung und Infokarte (Lage im Kartenmaß 0–1000)
function stationCard(s, m) {
  const S = m.size || 2048, P = v => +((v + S / 2) / S * 1000).toFixed(1);
  const farm = s.farmId ? m.farms.find(f => f.id === s.farmId) : null;
  const goods = list => list.map(f => ({ fill: f, name: N.fill(f), icon: fsicons.html(f, N.fill(f), 's') })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { uid: s.uid, name: s.name, cat: s.cat, catLabel: hub.stations.CATS[s.cat][0], cx: s.placed ? P(s.x) : null, cy: s.placed ? P(s.z) : null, where: s.where,
    farm: farm ? { id: farm.id, name: farm.name } : null, sells: goods(s.sells), buys: goods(s.buys), planner: s.planner, productions: s.productions.length,
    demands: s.demands.map(d => ({ name: N.fill(d.fill), mult: d.mult, running: d.running, day: d.day ? hub.fmtDay(d.day) : null })) };
}
// Daten je Fahrzeug für die Infokarte, mit Link zum Eintrag im Hof
function vehicleCard(v, i, m) {
  const S = m.size || 2048, P = v => +((v + S / 2) / S * 1000).toFixed(1);
  const farm = v.farmId ? m.farms.find(f => f.id === v.farmId) : null;
  return { i, uid: v.uid, name: v.name, cat: v.catName, pallet: v.pallet, cx: P(v.x), cy: P(v.z), driver: v.driver, ai: v.ai, damage: v.damage, diesel: v.diesel, hours: v.hours,
    where: v.where.label, farm: farm ? { id: farm.id, name: farm.name, color: farm.color } : null,
    fill: v.fill.filter(([t]) => !(v.drivable && ['DIESEL', 'DEF', 'AIR'].includes(t))).map(([t, l]) => ({ name: N.fill(t), amount: Math.round(l), icon: fsicons.html(t, N.fill(t), 's') })) };
}

// Kartenbild ausrichten (Admins): Größe in Prozent und Verschiebung in Metern, damit Felder und Bild genau aufeinanderliegen.
// Gehört zum Spielstand (fs_map_fit in src/fssaves.js), weil jede Karte ihr eigenes Bild hat.
function mapFit() {
  let f = {};
  try { f = JSON.parse(getSetting('fs_map_fit', '') || '{}') || {}; } catch { f = {}; }
  const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return { scale: n(f.scale, 100, 50, 200), dx: n(f.dx, 0, -2000, 2000), dz: n(f.dz, 0, -2000, 2000) };
}
// Lage des Bilds im Kartenmaß 0–1000: Rand des Server-Bilds, dann um die Kartenmitte skaliert und verschoben
function imageBox(border, fit, size) {
  const base = 1000 / (1 - 2 * border / 100), w = base * fit.scale / 100;
  return { base: +base.toFixed(2), w: +w.toFixed(2), x: +(500 - w / 2 + fit.dx / size * 1000).toFixed(2), y: +(500 - w / 2 + fit.dz / size * 1000).toFixed(2) };
}
router.post('/karte/ausrichten', login, adminPage, (req, res) => {
  const b = req.body, num = v => Number(String(v ?? '').replace(',', '.'));
  const fit = b.reset ? {} : { scale: num(b.scale), dx: num(b.dx), dz: num(b.dz) };
  setSetting('fs_map_fit', JSON.stringify(fit));
  res.redirect('/farming/karte?ok=gespeichert');
});
router.get('/karte', (req, res) => {
  const m = hub.model();
  const crops = hub.fscrops.list(hub.exportData());
  const fields = hub.fieldStates();
  const shp = hub.shapes(m);
  const view = mapView(fields, m, shp, crops);
  const sel = view.gs.find(f => f.id === Number(req.query.feld)) || null;
  const img = mapImage();
  const border = m.configured && !(img && img.custom) ? Number(getSetting('fs_map_border', '25')) || 0 : 0;
  const hasImage = !!img, mapV = img ? img.v : '';
  const fit = mapFit(), box = imageBox(border, fit, m.size || 2048);
  const want = LAYER_ALIAS[req.query.ansicht] || req.query.ansicht;
  const ex = hub.exportData();
  const vehicles = m.vehicles.map((v, i) => (v.x === null || v.x === undefined ? null : vehicleCard(v, i, m))).filter(Boolean);
  page(req, res, 'map', { title: 'Karte – Farming Simulator', full: true, SOILS: hub.SOILS, ...view, CARE_COLORS: Object.fromEntries(CARE.map(([k, , c]) => [k, c])), sel, crops, border, box, hasImage, mapV, shp, LAYERS: MAP_LAYERS,
    fit: req.user && req.user.isAdmin && hasImage ? fit : null, stations: m.stations.map(s => stationCard(s, m)), STATION_CATS: hub.stations.CATS, vehicles,
    pick: { station: String(req.query.station || ''), vehicle: String(req.query.fahrzeug || '') },
    cards: view.gs.map(g => fieldCard(g, req, m, ex)), layer: Object.hasOwn(MAP_LAYERS, want) ? want : 'fruechte' });
});
// Bilder je Fleck (src/fsmap.js) und hochgeladene Originalsymbole (src/fsicons.js)
router.get('/karte/ebene/:file', (req, res) => {
  const k = /^(ras-[a-zA-Z0-9_-]+\.png)$/.exec(req.params.file);
  const file = k && path.join(feeds.FS_DIR, k[1]);
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400').type('png').sendFile(file);
});
router.get('/symbol/:file', (req, res) => {
  const k = /^([a-z0-9]+)\.png$/.exec(req.params.file);
  const file = k && fsicons.file(k[1]);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=604800').type('png').sendFile(file);
});

router.get('/preise', (req, res) => {
  const m = hub.model();
  const goods = hub.goods(m);
  const filter = ['feld', 'tiere', 'produkte', 'habe'].includes(req.query.f) ? req.query.f : 'alle';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const list = goods.filter(g => (filter === 'alle' || (filter === 'habe' ? g.have > 0 : g.group === filter)) && (!q || matches(norm(g.name + ' ' + g.fill), q)));
  // Ohne Wahl: was ihr am meisten wert auf Lager habt (keine Betriebsmittel), sonst Weizen
  const valued = list.filter(g => g.have > 0 && !hub.SUPPLIES.has(g.fill)).sort((a, b) => b.have * (b.now || b.bestPrice) - a.have * (a.now || a.bestPrice));
  const sel = goods.find(g => g.fill === req.query.w) || valued[0] || list.find(g => g.fill === 'WHEAT') || list[0] || null;
  const holdings = sel ? m.farms.map(f => {
    const s = f.stock.find(x => x.fill === sel.fill), c = f.cargo.filter(x => x.fill === sel.fill).reduce((a, x) => a + x.amount, 0);
    return { farm: f, amount: (s ? s.amount : 0) + c };
  }).filter(h => h.amount > 0) : [];
  // Wo die Ware in Produktionen vorkommt (Katalog und Karte) und wer sie annimmt
  const uses = sel ? hub.prod.uses(hub.planner(), sel.fill) : null;
  const buyers = sel ? m.stations.filter(s => s.sells.includes(sel.fill)) : [];
  const sellers = sel ? m.stations.filter(s => s.buys.includes(sel.fill)) : [];
  page(req, res, 'prices', { title: 'Preise – Farming Simulator', goods: list, filter, q, sel, holdings, all: goods.length, uses, buyers, sellers });
});

// Wiki: Anbaukalender wie im Spiel (?frucht=WHEAT zeigt eine Frucht genauer) und Tiere (?tier=COW)
function wikiCalendar(m) {
  const ex = hub.exportData(), h = hub.wiki.hemisphere(ex, getSetting('fs_hemisphere', ''));
  const seen = new Set();
  const crops = hub.fscrops.list(ex).filter(c => c.planned && (c.sow.length || c.harvest.length) && !seen.has(c.fill) && seen.add(c.fill))
    .map(c => ({ ...c, sowRuns: hub.wiki.runs(c.sow), harvestRuns: hub.wiki.runs(c.harvest) })).sort((a, b) => a.label.localeCompare(b.label, 'de'));
  // Heute als gestrichelte Linie: Monat, Tag im Monat und Uhrzeit
  const d = m.date, now = d ? (N.calPos(d.month) + ((d.dom - 1) + (m.dayTime ? m.dayTime / 864e5 : 0.5)) / d.dpp) / 12 : null;
  return { h, crops, months: hub.wiki.months(), monthsShort: hub.wiki.months(true), now, fromGame: crops.some(c => c.fromGame), ex };
}
router.get('/wiki', (req, res) => {
  const m = hub.model(), cal = wikiCalendar(m);
  const crop = cal.crops.find(c => c.fill === req.query.frucht || c.name === req.query.frucht) || null;
  page(req, res, 'wiki', { title: 'Wiki – Anbaukalender – Farming Simulator', tab: 'anbau', cal, crop });
});
router.get('/wiki/tiere', (req, res) => {
  const m = hub.model(), dpp = hub.daysPerPeriod(), a = hub.wiki.animals(dpp);
  const types = a ? a.types : [];
  const sel = types.find(t => t.type === req.query.tier) || types[0] || null;
  // Wer welche Tierprodukte verarbeitet (Planer): je Erzeugnis die Produktionen, die es brauchen
  const uses = sel ? [...new Set(sel.subs.flatMap(s => s.makes.map(x => x.fill)))].map(fill => ({ fill, name: N.fill(fill), uses: hub.prod.uses(hub.planner(), fill) })) : [];
  page(req, res, 'wiki', { title: 'Wiki – Tiere – Farming Simulator', tab: 'tiere', a, types, sel, uses, dpp, CURVES: hub.wiki.CURVES });
});

router.get('/mods', (req, res) => {
  const m = hub.model();
  const cmp = hub.modCompare(m);
  const canSync = !!cmp.list && !!req.user && (req.user.isAdmin || cmp.list.owner_id === req.user.id);
  page(req, res, 'mods', { title: 'Modliste – Farming Simulator', cmp, canSync, changes: hub.changelog(50).filter(c => c.kind === 'mods').slice(0, 5) });
});

router.get('/hof/:id', farmParam, (req, res) => {
  const f = req.farm, m = hub.model();
  const tab = Object.hasOwn(TABS, req.query.tab) ? req.query.tab : 'uebersicht';
  const open = hub.tasks(f.id), auto = hub.suggestions(f.id);
  const hist = hub.history((f.money !== null ? 'money:' : 'bilanz:') + f.id, 60);
  const yesterday = hub.history('bilanz:' + f.id, 3).filter(h => h.day < hub.today()).pop() || null;
  const data = { title: f.name + ' – Farming Simulator', f, tab, open, auto, yesterday, overdue: open.filter(t => t.overdue).length, places: m.places };
  if (tab === 'fahrzeuge') {
    const sort = ['zustand', 'diesel', 'preis', 'name', 'stunden', 'art'].includes(req.query.sort) ? req.query.sort : 'zustand';
    const by = { zustand: (a, b) => (b.damage ?? -1) - (a.damage ?? -1), diesel: (a, b) => (a.diesel ?? 1e9) - (b.diesel ?? 1e9), preis: (a, b) => b.price - a.price,
      name: (a, b) => a.name.localeCompare(b.name, 'de'), stunden: (a, b) => (b.hours ?? 0) - (a.hours ?? 0), art: (a, b) => a.catName.localeCompare(b.catName, 'de') || a.name.localeCompare(b.name, 'de') };
    const withPallets = req.query.paletten === '1';
    data.list = (withPallets ? f.vehicles : f.fleet).slice().sort(by[sort]);
    data.sort = sort;
    data.withPallets = withPallets;
    data.wear = Number(getSetting('fs_auto_wear', '50'));
  }
  if (tab === 'produktion') {
    data.ownProd = hub.planner().eigene.filter(b => b.farmId === f.id);
    data.spots = hub.palletSpots(f);
    data.placeRows = m.places.filter(p => !p.farm_id || p.farm_id === f.id).map(p => {
      const here = f.pallets.filter(v => v.where.place === p.id);
      const fills = {};
      for (const v of here) for (const [t, l] of v.fill) fills[t] = (fills[t] || 0) + l;
      return { ...p, n: here.length, fills: Object.entries(fills).map(([t, l]) => ({ fill: t, name: N.fill(t), amount: l })).sort((a, b) => b.amount - a.amount),
        hist: hub.history('place:' + p.id, 14) };
    });
  }
  if (tab === 'finanzen') {
    data.hist = hist;
    data.top = f.fleet.slice().sort((a, b) => b.price - a.price).slice(0, 8);
  }
  if (tab === 'uebersicht' || tab === 'kalender') {
    const cur = hub.calendarYear(m);
    const year = tab === 'kalender' ? Math.max(1, Math.min(cur + 5, Number(req.query.jahr) || cur)) : cur;
    data.cal = hub.calendar(f.id, year, tab === 'uebersicht' || req.query.wdh === '1');
    data.withRepeat = req.query.wdh === '1';
    data.crops = hub.crops();
    data.curYear = cur;
    data.allFields = hub.fieldStates();
    data.fieldList = data.allFields.filter(x => x.owner === f.id).sort((a, b) => a.id - b.id);
    if (tab === 'uebersicht') data.shp = hub.shapes(m);
  }
  if (tab === 'aufgaben') {
    data.done = hub.tasks(f.id, { done: true });
    data.editTask = Number(req.query.aufgabe) ? hub.task(req.query.aufgabe) : null;
    data.live = require('../fslive').status();
    data.watch = require('../fslive').farmSettings(f.id);
  }
  page(req, res, 'farm', data);
});

router.get('/changelog', (req, res) => page(req, res, 'changelog', { title: 'Changelog – Farming Simulator', entries: hub.changelog(200) }));
router.get('/vorschlaege', (req, res) => {
  const status = Object.hasOwn(hub.STATUS, req.query.status) ? req.query.status : null;
  page(req, res, 'ideas', { title: 'Vorschläge – Farming Simulator', ideas: hub.ideas(req.user && req.user.id, status), status, editIdea: Number(req.query.bearbeiten) || null });
});

// ---------- Formulare ----------
router.use(limit);

router.post('/notizen', login, (req, res) => { hub.addNote(req.user, req.body.body); back(req, res, '/farming#notizen', 'notiz'); });
router.post('/notizen/:id', login, (req, res) => {
  const n = hub.note(req.params.id);
  if (!hub.canChangeNote(req.user, n)) return deny(res, 'Diese Notiz kann nur ihr Verfasser bearbeiten.');
  hub.editNote(n.id, req.body.body);
  back(req, res, '/farming#notizen', 'notiz');
});
router.post('/notizen/:id/loeschen', login, (req, res) => {
  const n = hub.note(req.params.id);
  if (!hub.canChangeNote(req.user, n)) return deny(res, 'Diese Notiz kann nur ihr Verfasser löschen.');
  hub.removeNote(n.id);
  back(req, res, '/farming#notizen', 'geloescht');
});

router.post('/hof/:id/beitreten', login, farmParam, (req, res) => { hub.join(req.user.id, req.farm.id); res.redirect(`/farming/hof/${req.farm.id}?ok=beigetreten`); });
router.post('/austreten', login, (req, res) => { hub.leave(req.user.id); back(req, res, '/farming', 'ausgetreten'); });
router.post('/hof/:id/name', login, farmParam, (req, res) => {
  if (!req.user.isAdmin && hub.farmOf(req.user.id) !== req.farm.id) return deny(res, 'Den Namen ändern können nur Mitglieder dieses Hofs.');
  hub.saveFarm(req.farm.id, req.user, req.body);
  back(req, res, `/farming/hof/${req.farm.id}`, 'gespeichert');
});

router.post('/hof/:id/aufgaben', login, farmParam, farmEditor, (req, res) => {
  // Kurzform aus dem Hofkalender: repeat=gmonths:12 (jedes Spieljahr)
  const rep = /^(\w+):(\d+)$/.exec(String(req.body.repeat || ''));
  if (rep) Object.assign(req.body, { repeat: rep[1], repeat_n: rep[2] });
  const id = hub.addTask(req.user, req.farm.id, req.body);
  back(req, res, `/farming/hof/${req.farm.id}?tab=aufgaben`, id ? 'aufgabe' : null);
});
function taskParam(req, res, next) {
  const t = hub.task(req.params.id);
  if (!t) return next('route');
  if (!hub.canEditFarm(req.user, t.farm_id || hub.farmOf(req.user.id) || 0) && !(t.farm_id === 0 && req.user)) return deny(res, 'Das dürfen nur Mitglieder dieses Hofs und Admins.');
  req.task = t;
  next();
}
router.post('/aufgaben/:id/erledigt', login, taskParam, (req, res) => { hub.completeTask(req.task.id, req.user); back(req, res, '/farming', 'erledigt'); });
router.post('/aufgaben/:id/wieder', login, taskParam, (req, res) => { hub.reopenTask(req.task.id); back(req, res, '/farming', 'gespeichert'); });
router.post('/aufgaben/:id/loeschen', login, taskParam, (req, res) => { hub.removeTask(req.task.id); back(req, res, '/farming', 'geloescht'); });
router.post('/aufgaben/:id', login, taskParam, (req, res) => { hub.editTask(req.task.id, req.body); back(req, res, '/farming', 'gespeichert'); });

// Produktionsberater der Mod: Prüfungen und Schwellen dieses Hofs (src/fslive.js, geht mit der nächsten Inbox ins Spiel)
router.post('/hof/:id/berater', login, farmParam, farmEditor, (req, res) => {
  const live = require('../fslive');
  live.saveFarm(req.farm.id, req.body);
  live.soon();
  res.redirect(`/farming/hof/${req.farm.id}?tab=aufgaben&ok=berater#berater`);
});
router.post('/hof/:id/vorschlag', login, farmParam, farmEditor, (req, res) => {
  const id = hub.takeSuggestion(req.user, req.farm.id, String(req.body.key || ''));
  back(req, res, `/farming/hof/${req.farm.id}?tab=aufgaben`, id ? 'uebernommen' : null);
});
router.post('/hof/:id/ausblenden', login, farmParam, farmEditor, (req, res) => {
  hub.hideSuggestion(req.body.key, req.body.sig);
  back(req, res, `/farming/hof/${req.farm.id}?tab=aufgaben`, 'ausgeblendet');
});

router.post('/hof/:id/plan', login, farmParam, farmEditor, (req, res) => {
  const id = hub.addPlan(req.user, req.farm.id, req.body);
  back(req, res, `/farming/hof/${req.farm.id}?tab=kalender`, id ? 'plan' : null);
});
router.post('/plan/:id/loeschen', login, (req, res, next) => {
  const p = hub.plan(req.params.id);
  if (!p) return next('route');
  if (!hub.canEditFarm(req.user, p.farm_id)) return deny(res, 'Das dürfen nur Mitglieder dieses Hofs und Admins.');
  hub.removePlan(p.id);
  back(req, res, `/farming/hof/${p.farm_id}?tab=kalender`, 'geloescht');
});

// Bodenverteilung je Grundstück (nur Admins, Formular in der Infokarte): steht in keiner Datei des Spielstands
router.post('/boden/:id', login, adminPage, (req, res) => {
  const ok = hub.saveSoil(req.params.id, req.body, req.user.id);
  hub.invalidate();
  res.redirect('/farming/karte?ansicht=bodenart&feld=' + encodeURIComponent(req.params.id) + (ok ? '&ok=gespeichert' : ''));
});
router.post('/hof/:id/ort', login, farmParam, farmEditor, (req, res) => {
  const id = hub.savePlace(null, { ...req.body, farm_id: req.farm.id });
  back(req, res, `/farming/hof/${req.farm.id}?tab=produktion`, id ? 'ort' : null);
});
router.post('/ort/:id/loeschen', login, (req, res, next) => {
  const p = hub.place(req.params.id);
  if (!p) return next('route');
  if (!(req.user.isAdmin || (p.farm_id && hub.canEditFarm(req.user, p.farm_id)))) return deny(res, 'Diesen Ort löschen können Mitglieder seines Hofs und Admins.');
  hub.removePlace(p.id);
  back(req, res, '/farming', 'geloescht');
});

router.post('/changelog', login, (req, res) => {
  if (!req.user.isAdmin) return deny(res, 'Einträge im Changelog schreiben Admins.');
  hub.addChange(req.user, req.body);
  back(req, res, '/farming/changelog', 'eintrag');
});
router.post('/changelog/:id/loeschen', login, (req, res) => {
  if (!req.user.isAdmin) return deny(res, 'Einträge im Changelog löschen Admins.');
  hub.removeChange(req.params.id);
  back(req, res, '/farming/changelog', 'geloescht');
});

router.post('/vorschlaege', login, auth.rateLimit('farming-idee', 20, 3600), (req, res) => {
  const id = hub.addIdea(req.user, req.body);
  back(req, res, '/farming/vorschlaege' + (id ? '#v' + id : ''), id ? 'vorschlag' : null);
});
function ideaParam(req, res, next) {
  const s = hub.idea(req.params.id);
  if (!s) return next('route');
  req.idea = s;
  next();
}
router.post('/vorschlaege/:id', login, ideaParam, (req, res) => {
  if (!(req.user.isAdmin || (req.idea.user_id === req.user.id && req.idea.status === 'offen'))) return deny(res, 'Bearbeiten kann nur, wer den Vorschlag gemacht hat, solange er offen ist.');
  hub.editIdea(req.idea.id, req.body);
  back(req, res, '/farming/vorschlaege#v' + req.idea.id, 'gespeichert');
});
router.post('/vorschlaege/:id/antwort', login, ideaParam, (req, res) => {
  if (!req.user.isAdmin) return deny(res, 'Den Stand eines Vorschlags setzen Admins.');
  hub.answerIdea(req.idea.id, req.body);
  back(req, res, '/farming/vorschlaege#v' + req.idea.id, 'gespeichert');
});
router.post('/vorschlaege/:id/stimme', login, ideaParam, (req, res) => { hub.vote(req.idea.id, req.user.id); back(req, res, '/farming/vorschlaege#v' + req.idea.id); });
router.post('/vorschlaege/:id/loeschen', login, ideaParam, (req, res) => {
  if (!(req.user.isAdmin || req.idea.user_id === req.user.id)) return deny(res, 'Löschen kann nur, wer den Vorschlag gemacht hat.');
  hub.removeIdea(req.idea.id);
  back(req, res, '/farming/vorschlaege', 'geloescht');
});

router.post('/mods/abgleichen', login, (req, res) => {
  const cmp = hub.modCompare();
  if (!cmp.list || !(req.user.isAdmin || cmp.list.owner_id === req.user.id)) return deny(res, 'Abgleichen kann der Besitzer der Modliste oder ein Admin.');
  hub.syncModlist();
  back(req, res, '/farming/mods', 'abgeglichen');
});

module.exports = router;
