'use strict';
// Farming Simulator Hub (Startmenü → 🚜 Farming Simulator). Links die Bereiche, rechts der Inhalt. Daten und Regeln: src/fshub.js,
// Abruf der Feeds: src/fsfeeds.js, Einstellungen: Seitenverwaltung → Farming (src/routes/admin.js).
//
//   GET  /farming                 Serverübersicht mit Heute erledigen und Notizen
//   GET  /farming/karte           Karte (Früchte, Wachstum, Boden, Besitz) GET /farming/karte.bild  Kartenbild
//   GET  /farming/karte/ebene/<k>.png  Boden-Ebene aus der Dichtekarte     GET /farming/symbol/<k>.png  hochgeladenes Symbol
//   GET  /farming/preise          Preise mit Graph (?w=WHEAT)            GET /farming/mods        Modliste und Abgleich
//   GET  /farming/hof/<id>        Hof, ?tab=uebersicht (Kacheln) | inventar | produktion | fahrzeuge | finanzen | kalender | aufgaben
//   GET  /farming/changelog       Änderungen am Server und am Hub        GET /farming/vorschlaege Wünsche und Ideen
//   POST …                        Formulare (Notizen, Aufgaben, Pläne, Feldmeldungen, Orte, Hof, Changelog, Vorschläge)
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const auth = require('../auth');
const hub = require('../fshub');
const feeds = require('../fsfeeds');
const N = require('../fsnames');
const fsicons = require('../fsicons');
const { getSetting } = require('../db');
const profiles = require('../profiles');

const router = express.Router();
const TABS = { uebersicht: 'Übersicht', inventar: 'Inventar', produktion: 'Produktion', fahrzeuge: 'Fahrzeuge', finanzen: 'Finanzen', kalender: 'Kalender', aufgaben: 'Aufgaben' };
const OK = { notiz: 'Notiz gespeichert.', geloescht: 'Gelöscht.', aufgabe: 'Aufgabe angelegt.', erledigt: 'Erledigt.', gespeichert: 'Gespeichert.', beigetreten: 'Willkommen auf dem Hof!',
  ausgetreten: 'Du gehörst keinem Hof mehr an.', plan: 'In den Hofkalender eingetragen.', gemeldet: 'Danke für die Meldung.', ort: 'Ort angelegt.', ausgeblendet: 'Ausgeblendet, bis sich etwas ändert.',
  uebernommen: 'Als Aufgabe übernommen.', vorschlag: 'Danke für deinen Vorschlag!', abgeglichen: 'Server-Haken der Modliste abgeglichen.', eintrag: 'Eintrag gespeichert.' };
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
const fieldName = f => (f.parcel ? 'Grundstück ' : 'Feld ') + f.id;
const helpers = { fieldName, icon: fsicons.html, geo, frame, de, eur, big, liters, ha, ago, mins, when, spark, N, TABS, hhmm: hub.hhmm, fmtDay: hub.fmtDay, STATUS: hub.STATUS, displayName: profiles.displayName };

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
  page(req, res, 'overview', { columns, players, seen, owned, notes: hub.notes(), editNote: Number(req.query.notiz) || null,
    lastCount: hub.changelog(20).filter(c => c.kind === 'mods' && c.created_at > Date.now() / 1000 - 86400).length });
});

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

// Karte: vier Ansichten wie im Spiel, je Ansicht Einträge zum Ein- und Ausblenden. Jedes Feld trägt seine Farbe und seinen Eintrag je Ansicht,
// das Umschalten macht dann nur noch CSS (public/fshub.css) und public/fshub.js.
const MAP_LAYERS = { fruechte: 'Feldfrüchte', wachstum: 'Wachstum', boden: 'Boden', besitz: 'Besitz' };
const LAYER_ALIAS = { zustand: 'wachstum', pflege: 'boden' };
const NONE = 'rgba(255,255,255,.2)';   // leer oder unbekannt: hell, damit das Feld auf jedem Kartenbild zu sehen ist
const PARCEL = 'rgba(255,255,255,.07)';   // Grundstück ohne Feld (Wiese, Wald, Plantage): nur angedeutet, gestrichelter Rand (fshub.css)
const CARE = [['kalk', 'Kalk nötig', '#e0c52c'], ['pflug', 'Pflügen fällig', '#c8693a'], ['duenger', 'Düngen', '#4b97ec'], ['unkraut', 'Unkraut', '#b062c8'], ['steine', 'Steine', '#9a9a9a']];
// Reihenfolge = Zeichenreihenfolge: was zu tun ist, liegt oben
const RASTER = { duenger: ['Gedüngt', 'linear-gradient(90deg, #4b97ec 50%, #1f4fb8 50%)'], pflug: ['Pflügen fällig', '#c8693a'], kalk: ['Kalk nötig', '#e0c52c'] };
function mapView(fields, m, shp) {
  const raster = shp && shp.layers ? Object.keys(RASTER).filter(k => shp.layers.includes(k)) : [];
  const gs = geo(fields, m, shp).map(g => {
    const care = g.source === 'auto' ? (CARE.find(([k]) => g.care.some(c => c.key === k)) || ['ok', 'Alles erledigt', '#5aa83c']) : null;
    const none = g.parcel ? '-' : '', nc = g.parcel ? PARCEL : NONE;
    return { ...g, layer: {
      fruechte: g.crop ? ['crop:' + g.crop, g.cropColor || '#8fd16a'] : ['crop:' + none, nc],
      wachstum: g.state ? ['state:' + g.state, N.STATES[g.state][1]] : ['state:' + none, nc],
      boden: raster.length ? ['', g.parcel ? PARCEL : 'rgba(20,24,18,.35)'] : care ? ['care:' + care[0], care[2]] : ['care:' + none, nc],
      besitz: g.farm ? ['farm:' + g.farm.id, g.farm.color] : ['farm:0', 'rgba(255,255,255,.22)'],
    } };
  });
  const count = (layer, key) => { const xs = gs.filter(g => g.layer[layer][0] === key); return { n: xs.length, ha: xs.reduce((a, g) => a + (g.area || 0), 0) }; };
  const crops = [...new Map(gs.filter(g => g.crop).map(g => [g.crop, g])).values()];
  const LAND = k => ({ key: k + ':-', label: 'Grundstück ohne Feld', color: PARCEL, parcel: true });
  const groups = {
    fruechte: [...crops.map(g => ({ key: 'crop:' + g.crop, label: g.crop, color: g.cropColor || '#8fd16a', fill: g.cropFill })), { key: 'crop:', label: 'Leer oder unbekannt', color: NONE }, LAND('crop')],
    wachstum: [...Object.entries(N.STATES).map(([k, [l, c]]) => ({ key: 'state:' + k, label: l, color: c })), { key: 'state:', label: 'Unbekannt', color: NONE }, LAND('state')],
    boden: raster.length ? raster.map(k => ({ key: 'ras:' + k, label: RASTER[k][0], color: RASTER[k][1], raster: k }))
      : [...CARE, ['ok', 'Alles erledigt', '#5aa83c']].map(([k, l, c]) => ({ key: 'care:' + k, label: l, color: c })).concat([{ key: 'care:', label: 'Unbekannt (nur mit FTP)', color: NONE }, LAND('care')]),
    besitz: [...m.farms.map(f => ({ key: 'farm:' + f.id, label: f.name, color: f.color })), { key: 'farm:0', label: 'Zu kaufen', color: 'rgba(255,255,255,.22)' }],
  };
  for (const [layer, items] of Object.entries(groups)) {
    for (const it of items) Object.assign(it, it.raster ? { n: null, ha: null } : count(layer, it.key));
    groups[layer] = items.filter(it => it.raster || it.n || it.key.startsWith('farm:'));
    const last = it => (it.key === 'crop:' ? 1 : it.parcel ? 2 : 0);
    if (layer === 'fruechte') groups[layer].sort((a, b) => last(a) - last(b) || b.ha - a.ha);
  }
  return { gs, groups, raster };
}
// Daten je Feld für die Infokarte (public/fshub.js baut sie beim Klick)
function fieldCard(g, req) {
  const a = g.source === 'auto' ? g.auto : null;
  return { id: g.id, parcel: !!g.parcel, ha: g.area, icon: g.crop ? fsicons.html(g.cropFill, g.crop, 's') : '', farm: g.farm ? { id: g.farm.id, name: g.farm.name, color: g.farm.color } : null, price: g.price || null,
    crop: g.crop, fill: g.cropFill, state: g.state ? N.STATES[g.state][0] : null, stateKey: g.state, src: g.source, ground: g.ground, growth: a ? a.growth : null,
    soil: a ? { lime: a.lime, spray: a.spray, plow: !!a.plow, weed: a.weed, stone: a.stone } : null, care: g.care.map(c => c.label), autoAt: a && g.autoAt ? when(g.autoAt) : null,
    report: g.report ? { by: g.report.username || '–', at: when(g.report.updated_at), day: g.report.game_day ? hub.fmtDay(g.report.game_day) : null, crop: g.report.crop_id, cur: g.source === 'report' } : null,
    plan: g.plan ? `${g.plan.crop}, säen ${N.MONTHS[g.plan.sow_month]}, ernten ${N.MONTHS[g.plan.harvest_month]}` : null,
    edit: !!req.user && (!g.farm || hub.canEditFarm(req.user, g.farm.id)) };
}

router.get('/karte', (req, res) => {
  const m = hub.model();
  const crops = hub.crops();
  const fields = hub.fieldStates();
  const shp = hub.shapes(m);
  const view = mapView(fields, m, shp);
  const sel = view.gs.find(f => f.id === Number(req.query.feld)) || null;
  const img = mapImage();
  const border = m.configured && !(img && img.custom) ? Number(getSetting('fs_map_border', '25')) || 0 : 0;
  const hasImage = !!img, mapV = img ? img.v : '';
  const want = LAYER_ALIAS[req.query.ansicht] || req.query.ansicht;
  // Für den Umriss-Editor (Admins): Kartenmaß, Lage des Bilds, je Feld Mitte, Größe und woher die Form kommt
  const editor = req.user && req.user.isAdmin ? { size: m.size || 2048, img: hasImage ? { off: -border / 100 * (1000 / (1 - 2 * border / 100)), w: 1000 / (1 - 2 * border / 100), src: '/farming/karte.bild?v=' + mapV } : null,
    fields: view.gs.map(g => ({ id: g.id, cx: g.cx, cy: g.cy, r: g.r, ha: g.area || 0, parcel: !!g.parcel, src: g.d ? (shp.shapes[g.id] || {}).src || 'boden' : 'kreis' })) } : null;
  page(req, res, 'map', { title: 'Karte – Farming Simulator', full: true, editor, ...view, CARE_COLORS: Object.fromEntries(CARE.map(([k, , c]) => [k, c])), sel, crops, border, hasImage, mapV, shp, LAYERS: MAP_LAYERS,
    cards: view.gs.map(g => fieldCard(g, req)), layer: Object.hasOwn(MAP_LAYERS, want) ? want : 'fruechte' });
});
// Boden-Ebenen aus der Dichtekarte (src/fsmap.js) und hochgeladene Originalsymbole (src/fsicons.js)
router.get('/karte/ebene/:file', (req, res) => {
  const k = /^([a-z]+)\.png$/.exec(req.params.file);
  const file = k && Object.hasOwn(RASTER, k[1]) && path.join(feeds.FS_DIR, `layer-${k[1]}.png`);
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
  const list = goods.filter(g => filter === 'alle' || (filter === 'habe' ? g.have > 0 : g.group === filter));
  // Ohne Wahl: was ihr am meisten wert auf Lager habt (keine Betriebsmittel), sonst Weizen
  const valued = list.filter(g => g.have > 0 && !hub.SUPPLIES.has(g.fill)).sort((a, b) => b.have * (b.now || b.bestPrice) - a.have * (a.now || a.bestPrice));
  const sel = goods.find(g => g.fill === req.query.w) || valued[0] || list.find(g => g.fill === 'WHEAT') || list[0] || null;
  const holdings = sel ? m.farms.map(f => {
    const s = f.stock.find(x => x.fill === sel.fill), c = f.cargo.filter(x => x.fill === sel.fill).reduce((a, x) => a + x.amount, 0);
    return { farm: f, amount: (s ? s.amount : 0) + c };
  }).filter(h => h.amount > 0) : [];
  page(req, res, 'prices', { title: 'Preise – Farming Simulator', goods: list, filter, sel, holdings, all: goods.length });
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

// Feld melden: Frucht und Zustand. Darf, wem das Feld gehört (zu kaufende Felder: alle Mitglieder).
router.post('/feld/:id', login, (req, res) => {
  const owner = hub.fieldOwner(req.params.id);
  if (owner && !hub.canEditFarm(req.user, owner)) return deny(res, 'Dieses Feld melden nur Mitglieder des Hofs, dem es gehört.');
  hub.reportField(req.user, req.params.id, req.body);
  back(req, res, `/farming/karte?feld=${Number(req.params.id)}`, 'gemeldet');
});

// Feldumrisse (nur Admins, public/fshub-umriss.js): erkannt aus dem Kartenbild oder von Hand, als JSON in data
const adminOnly = (req, res, next) => (req.user && req.user.isAdmin ? next() : res.status(403).json({ ok: false, error: 'Nur für Admins.' }));
router.post('/umrisse', login, adminOnly, (req, res) => {
  let d;
  try { d = JSON.parse(String(req.body.data || '')); } catch { return res.status(400).json({ ok: false, error: 'Daten unlesbar.' }); }
  if (d.replace === 'bild') hub.removeOutlines('bild');
  const n = hub.saveOutlines(d.fields, d.source, req.user.id);
  hub.invalidate();
  res.json({ ok: true, n });
});
router.post('/umrisse/:id/loeschen', login, adminOnly, (req, res) => {
  if (req.params.id === 'bild') hub.removeOutlines('bild'); else hub.removeOutline(req.params.id);
  hub.invalidate();
  res.json({ ok: true });
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
