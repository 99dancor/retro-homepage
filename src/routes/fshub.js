'use strict';
// Farming Simulator Hub (Startmenü → 🚜 Farming Simulator). Links die Bereiche, rechts der Inhalt. Daten und Regeln: src/fshub.js,
// Abruf der Feeds: src/fsfeeds.js, Einstellungen: Seitenverwaltung → Farming (src/routes/admin.js).
//
//   GET  /farming                 Serverübersicht mit Heute erledigen und Notizen
//   GET  /farming/karte           Karte (Besitz, Früchte, Zustand)        GET /farming/karte.bild  Kartenbild
//   GET  /farming/preise          Preise mit Graph (?w=WHEAT)            GET /farming/mods        Modliste und Abgleich
//   GET  /farming/hof/<id>        Hofübersicht, ?tab=inventar | produktion | fahrzeuge | finanzen | kalender | aufgaben
//   GET  /farming/changelog       Änderungen am Server und am Hub        GET /farming/vorschlaege Wünsche und Ideen
//   POST …                        Formulare (Notizen, Aufgaben, Pläne, Feldmeldungen, Orte, Hof, Changelog, Vorschläge)
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const auth = require('../auth');
const hub = require('../fshub');
const feeds = require('../fsfeeds');
const N = require('../fsnames');
const { getSetting } = require('../db');
const profiles = require('../profiles');

const router = express.Router();
const TABS = { inventar: '📦 Inventar', produktion: '🏭 Produktion', fahrzeuge: '🚜 Fahrzeuge', finanzen: '💶 Finanzen', kalender: '📅 Hofkalender', aufgaben: '✅ Aufgaben' };
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
const helpers = { de, eur, big, liters, ha, ago, mins, when, spark, N, TABS, hhmm: hub.hhmm, fmtDay: hub.fmtDay, STATUS: hub.STATUS, displayName: profiles.displayName };

// ---------- Zugriff ----------
router.use((req, res, next) => {
  if (!hub.enabled()) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Der Farming Simulator Hub ist ausgeschaltet.' });
  if (!hub.canView(req.user)) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  if (req.method === 'GET' && req.path !== '/karte.bild') res.set('Cache-Control', 'no-store');
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

router.get('/karte.bild', (req, res) => {
  const custom = fs.readdirSync(feeds.FS_DIR).find(f => /^map-custom\.(png|jpe?g|webp)$/.test(f));
  const file = custom ? path.join(feeds.FS_DIR, custom) : feeds.MAP_FILE;
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  res.type(custom ? path.extname(custom) : (fs.readFileSync(file).subarray(0, 2).toString('hex') === 'ffd8' ? 'jpg' : 'png')).sendFile(file);
});

router.get('/karte', (req, res) => {
  const m = hub.model();
  const crops = hub.crops();
  const fields = hub.fieldStates();
  const sel = fields.find(f => f.id === Number(req.query.feld)) || null;
  const border = m.configured && !fs.readdirSync(feeds.FS_DIR).some(f => /^map-custom\./.test(f)) ? Number(getSetting('fs_map_border', '25')) || 0 : 0;
  const hasImage = fs.existsSync(feeds.MAP_FILE) || fs.readdirSync(feeds.FS_DIR).some(f => /^map-custom\./.test(f));
  page(req, res, 'map', { title: 'Karte – Farming Simulator', fields, sel, crops, border, hasImage, layer: ['besitz', 'fruechte', 'zustand', 'pflege'].includes(req.query.ansicht) ? req.query.ansicht : 'besitz' });
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
  const tab = Object.hasOwn(TABS, req.query.tab) ? req.query.tab : 'inventar';
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
  if (tab === 'kalender') {
    const cur = m.date ? m.date.year : 1;
    const year = Math.max(1, Math.min(cur + 5, Number(req.query.jahr) || cur));
    data.cal = hub.calendar(f.id, year, req.query.wdh === '1');
    data.withRepeat = req.query.wdh === '1';
    data.crops = hub.crops();
    data.curYear = cur;
    data.fieldList = hub.fieldStates().filter(x => x.owner === f.id).sort((a, b) => a.id - b.id);
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
