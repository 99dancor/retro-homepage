'use strict';
// Seitenverwaltung 2.0 (Baum in src/adminnav.js): Übersicht, Programme mit Eigenschaften, Dienste, Aussehen (Startseite,
// Laufband, Popup-Bilder), Postfach und System (Allgemein, Anmelden, E-Mail, Ereignisanzeige, Info). Inhalte, Mitglieder,
// Design, Desktop und die Programme mit eigener Seite (Quiz, Werwolf, Paint, Farming) stehen weiter in src/routes/admin.js.
// Jede Seite speichert nur ihre eigenen Schalter: Ein Häkchen, das auf einer Seite fehlt, schaltet woanders nichts aus.
const express = require('express');
const { db, now, getSetting, setSetting } = require('../db');
const auth = require('../auth');
const up = require('../uploads');
const { asArray } = require('../util');
const programs = require('../programs');
const services = require('../services');
const ticker = require('../ticker');
const popups = require('../popups');
const events = require('../events');
const homeblocks = require('../homeblocks');
const changelog = require('../changelog');

const router = express.Router();
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const flag = (b, k) => setSetting(k, b[k] === '1' ? '1' : '0');
const num = (b, k, min, max, d) => {
  const n = Math.round(Number(b[k]));
  setSetting(k, String(Number.isFinite(n) && b[k] !== '' ? Math.min(max, Math.max(min, n)) : d));
};
const pick = (b, k, allowed) => { if (allowed.includes(b[k])) setSetting(k, b[k]); };
const settings = keys => Object.fromEntries(keys.map(k => [k, getSetting(k, '')]));
// Fehler zurück auf die Seite (?fehler=…), Erfolg mit ?ok=1 (Meldung „Gespeichert.“ aus src/routes/admin.js)
const fail = (res, url, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + 'fehler=' + encodeURIComponent(msg));
router.use((req, res, next) => { res.locals.fehler = req.query.fehler ? String(req.query.fehler).slice(0, 300) : null; next(); });
// Datum für <input type="datetime-local"> in Ortszeit der Seite (Gegenstück: ticker.when / popups.when)
const dtLocal = require('../util').localInput;
function period(a, b) {
  const f = t => new Date(t * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Berlin' });
  if (!a && !b) return 'immer';
  if (a && b) return f(a) + ' – ' + f(b);
  return a ? 'ab ' + f(a) : 'bis ' + f(b);
}
router.use((req, res, next) => { res.locals.period = period; res.locals.dtLocal = dtLocal; next(); });

// ---------- Übersicht ----------
router.get('/', (req, res) => {
  const c = res.locals.counts, need = [];
  const list = services.all();
  for (const s of list.filter(x => x.enabled && x.state === 'down')) need.push({ icon: '🔴', text: `${s.name} ist offline ${services.since(s.state_since)}`, url: `/admin/dienste/${s.id}`, level: 'err' });
  if (c.unread) need.push({ icon: '✉️', text: c.unread === 1 ? 'Eine ungelesene Nachricht' : `${c.unread} ungelesene Nachrichten`, url: '/admin/messages' });
  if (c.pending) need.push({ icon: '📖', text: c.pending === 1 ? 'Ein Besucherbuch-Eintrag wartet' : `${c.pending} Besucherbuch-Einträge warten`, url: '/admin/guestbook' });
  if (c.paint) need.push({ icon: '🎨', text: c.paint === 1 ? 'Ein Paint-Bild wartet auf Freigabe' : `${c.paint} Paint-Bilder warten auf Freigabe`, url: '/admin/freigaben' });
  if (c.popups) need.push({ icon: '💬', text: c.popups === 1 ? 'Ein Vorschlag für ein Popup-Bild' : `${c.popups} Vorschläge für Popup-Bilder`, url: '/admin/freigaben#popups' });
  const ev = events.counts(86400);
  if (ev.error) need.push({ icon: '⛔', text: ev.error === 1 ? 'Ein Fehler in den letzten 24 Stunden' : `${ev.error} Fehler in den letzten 24 Stunden`, url: '/admin/ereignisse?level=error', level: 'err' });
  if (res.locals.maintOn) need.push({ icon: '🚧', text: 'Der Wartungsmodus ist an: Besucher sehen nur die Wartungsseite', url: '/admin/settings#wartung', level: 'warn' });
  const disks = services.disks();
  for (const d of disks) if (d.total && d.used / d.total > 0.9) need.push({ icon: '💽', text: `Platte „${d.label}“ ist zu ${Math.round(d.used / d.total * 100)} % voll`, url: '/admin/speicher#platten', level: 'warn' });
  const today = require('../analytics').stats(1).totals;
  res.render('admin/overview', {
    title: 'Übersicht', need,
    services: list.map(s => ({ ...s, text: services.summary(s, true), bars: services.bars(s.id, 24) })),
    today: { views: (today.views || 0) - (today.downloads || 0), visitors: today.visitors || 0, downloads: today.downloads || 0, online: require('../messenger').onlineCount() },
    disks, update: changelog.latest(), ev,
    members: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get().n,
    newest: db.prepare('SELECT id, username, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 3').all(),
  });
});
router.post('/statistik', (req, res) => {
  num(req.body, 'analytics_retention_days', 7, 3650, 365);
  res.redirect('/admin/statistik?ok=1#aufbewahren');
});

// ---------- System ----------
router.get('/settings', (req, res) => res.render('admin/settings', { title: 'Allgemein', s: settings(['site_title', 'site_tagline', 'maint_on', 'maint_text']) }));
router.post('/settings', (req, res) => {
  const b = req.body, was = getSetting('maint_on', '0');
  if ('site_title' in b) setSetting('site_title', str(b.site_title, 100) || 'Meine Homepage');
  if ('site_tagline' in b) setSetting('site_tagline', str(b.site_tagline, 200));
  if ('maint_form' in b) {
    flag(b, 'maint_on');
    setSetting('maint_text', String(b.maint_text || '').slice(0, 5000));
    const on = getSetting('maint_on');
    if (on !== was) events.warn('System', on === '1' ? 'Wartungsmodus eingeschaltet' : 'Wartungsmodus ausgeschaltet', req.user.id);
  }
  res.redirect('/admin/settings?ok=1' + ('maint_form' in b ? '#wartung' : ''));
});
router.get('/anmelden', (req, res) => res.render('admin/anmelden', { title: 'Anmelden', s: { registration_open: getSetting('registration_open', '0'), logon_screen: getSetting('logon_screen', '1') } }));
router.post('/anmelden', (req, res) => {
  flag(req.body, 'registration_open');
  flag(req.body, 'logon_screen');
  res.redirect('/admin/anmelden?ok=1');
});
const MAIL_KEYS = ['notify_email', 'smtp_from', 'smtp_host', 'smtp_port', 'smtp_user'];
router.get('/email', (req, res) => {
  const s = settings([...MAIL_KEYS, 'smtp_secure']);
  s.smtp_pass_set = !!getSetting('smtp_pass');
  res.render('admin/email', { title: 'E-Mail', s, mailMsg: req.query.mail ? String(req.query.mail).slice(0, 300) : null });
});
router.post('/email', (req, res) => {
  const b = req.body;
  for (const k of MAIL_KEYS) if (k in b) setSetting(k, str(b[k], 300));
  flag(b, 'smtp_secure');
  if (b.smtp_pass) setSetting('smtp_pass', String(b.smtp_pass).slice(0, 500));
  if (b.smtp_pass_clear) setSetting('smtp_pass', '');
  res.redirect('/admin/email?ok=1');
});
router.get('/ereignisse', (req, res) => {
  const level = Object.hasOwn(events.LEVELS, req.query.level) ? req.query.level : '';
  const source = str(req.query.quelle, 40);
  res.render('admin/ereignisse', { title: 'Ereignisanzeige', list: events.list({ level, source }), level, source, sources: events.sources(), levels: events.LEVELS, ev: events.counts(86400) });
});
router.post('/ereignisse/leeren', (req, res) => {
  events.clear();
  events.info('System', 'Ereignisanzeige geleert', req.user.id);
  res.redirect('/admin/ereignisse?ok=1');
});
router.get('/info', (req, res) => {
  const fs = require('node:fs'), { DATA_DIR } = require('../db');
  let dbSize = 0;
  for (const f of ['site.db', 'site.db-wal']) { try { dbSize += fs.statSync(require('node:path').join(DATA_DIR, f)).size; } catch { /* fehlt */ } }
  res.render('admin/info', {
    title: 'Info und Updates', update: changelog.latest(), recent: changelog.all().slice(0, 6),
    sys: { node: process.version, uptime: Math.floor(process.uptime()), dbSize, tz: process.env.TZ || 'Europe/Berlin', started: Math.floor(Date.now() / 1000 - process.uptime()) },
  });
});

// ---------- Programme ----------
const DESK_SYS = ['eigene-dateien', 'papierkorb', 'readme'];
const navHidden = () => new Set((getSetting('nav_hidden') || '').split(',').filter(Boolean));
const deskOn = () => (getSetting('desk_defaults') || '').split(',').map(k => k.trim()).filter(Boolean);
// Zeilen eines Formulars speichern: rows = Schlüssel auf der Seite, for_KEY, nav[] (Startmenü), desk[] (Desktop)
function saveRows(keys, b) {
  const known = new Set(programs.CATALOG.map(p => p.key)), rows = asArray(keys).filter(k => known.has(k));
  if (!rows.length) return;
  const nav = new Set(asArray(b.nav)), desk = new Set(asArray(b.desk)), hidden = navHidden();
  let on = deskOn();
  for (const k of rows) {
    if (b['for_' + k]) programs.setState(k, b['for_' + k]);
    if (nav.has(k)) hidden.delete(k); else hidden.add(k);
    if (desk.has(k) && !on.includes(k)) on.push(k);
    if (!desk.has(k)) on = on.filter(x => x !== k);
  }
  setSetting('nav_hidden', [...hidden].join(','));
  setSetting('desk_defaults', on.join(','));
}
function rowsFor(keys) {
  const cat = programs.catalog(), hidden = navHidden(), desk = deskOn();
  return (keys ? keys.map(k => cat.find(p => p.key === k)).filter(Boolean) : cat).map(p => ({ ...p, inNav: !hidden.has(p.key), onDesk: desk.includes(p.key) }));
}
router.get('/programme', (req, res) => {
  res.render('admin/programme', { title: 'Programme', rows: rowsFor(), groups: programs.GROUPS, FOR: programs.FOR });
});
router.post('/programme', (req, res) => {
  saveRows(req.body.rows, req.body);
  events.info('Programme', 'Programme geändert', req.user.id);
  res.redirect('/admin/programme?ok=1');
});

// Eigenschaften: die Programme ohne eigene Seite in der Seitenverwaltung
const CARD_TURNS = [['bj', '🃏', 'Blackjack'], ['pk', '♠️', 'Poker'], ['dk', '🎴', 'Durak'], ['uno', '🟥', 'UNO'], ['f7', '7️⃣', 'Flip 7'], ['pp', '🌶️', 'Pilli Pilli']];
const SKINS = { klassisch: 'Klassisch (wie der Desktop)', 'vlc-hell': 'VLC hell', 'vlc-dunkel': 'VLC dunkel', mediaplayer: 'Media Player', winamp: 'Winamp' };
const PROPS = {
  kartenspiele: { title: 'Kartenspiele', progs: ['kartenspiele'],
    keys: ['ks_buyin', 'ks_rebuy_below', 'bj_decks', 'bj_h17', ...CARD_TURNS.flatMap(([p]) => [p + '_enabled', p + '_turn'])],
    save(b) {
      num(b, 'ks_buyin', 1, 1000000, 1000);
      num(b, 'ks_rebuy_below', 0, 1000000, 0);
      num(b, 'bj_decks', 1, 8, 6);
      flag(b, 'bj_h17');
      for (const [p] of CARD_TURNS) { flag(b, p + '_enabled'); num(b, p + '_turn', 5, 300, 30); }
    } },
  raetsel: { title: 'Rätsel', progs: ['kreuzwortraetsel', 'sudoku', 'minesweeper'], keys: ['cw_words'],
    save(b) { if (typeof b.cw_words === 'string') setSetting('cw_words', b.cw_words.replace(/\r\n?/g, '\n').slice(0, 20000)); } },
  mediaplayer: { title: 'Mediaplayer', progs: ['musik'], keys: ['music_upload', 'music_skin', 'lobby_enabled', 'youtube_enabled'],
    save(b) {
      pick(b, 'music_upload', ['members', 'upload', 'admin']);
      pick(b, 'music_skin', require('../usersettings').PLAYER_SKINS);
      flag(b, 'lobby_enabled');
      flag(b, 'youtube_enabled');
    } },
  forum: { title: 'Forum', progs: ['board'], keys: [], save() {} },
  besucherbuch: { title: 'Besucherbuch', progs: ['guestbook', 'contact'], keys: ['guestbook_moderation'], save(b) { flag(b, 'guestbook_moderation'); } },
};
router.get('/programme/:key', (req, res, next) => {
  const P = Object.hasOwn(PROPS, req.params.key) && PROPS[req.params.key];
  if (!P) return next();
  const s = settings(P.keys);
  if (req.params.key === 'kartenspiele') for (const [p] of CARD_TURNS) if (s[p + '_enabled'] === '') s[p + '_enabled'] = '1';
  res.render('admin/prog-props', { title: P.title, key: req.params.key, s, rows: rowsFor(P.progs), FOR: programs.FOR, turns: CARD_TURNS, skins: SKINS });
});
router.post('/programme/:key', (req, res, next) => {
  const P = Object.hasOwn(PROPS, req.params.key) && PROPS[req.params.key];
  if (!P) return next();
  saveRows(req.body.rows, req.body);
  P.save(req.body);
  res.redirect(`/admin/programme/${req.params.key}?ok=1` + (/^[a-z]+$/.test(req.body.tab || '') ? '#' + req.body.tab : ''));
});

// ---------- Dienste ----------
router.get('/dienste', (req, res) => {
  const list = services.all().map(s => ({ ...s, text: services.summary(s, true), bars: services.bars(s.id, 24), up7: services.uptime(s.id) }));
  res.render('admin/dienste', {
    title: 'Dienste', list, KINDS: services.KINDS, VIS: services.VIS, SHOW: services.SHOW,
    s: settings(['svc_widget', 'svc_storage', 'svc_storage_for']), disks: services.disks(), storage: services.storage(req.user, { all: true }),
  });
});
router.post('/dienste/widget', (req, res) => {
  const b = req.body;
  flag(b, 'svc_widget');
  flag(b, 'svc_storage');
  pick(b, 'svc_storage_for', ['public', 'members', 'admin']);
  const cfg = {};
  for (const d of services.disks()) cfg[d.key] = { label: str(b['label_' + d.key], 40) || undefined, on: b['disk_' + d.key] === '1' };
  setSetting('svc_disks', JSON.stringify(cfg));
  res.redirect('/admin/dienste?ok=1#widget');
});
router.get('/dienste/neu', (req, res) => {
  const kind = Object.hasOwn(services.KINDS, req.query.art) ? req.query.art : null;
  if (!kind) return res.render('admin/dienst-neu', { title: 'Neuer Dienst', KINDS: services.KINDS });
  const K = services.KINDS[kind];
  res.render('admin/dienst-edit', {
    title: 'Neuer Dienst: ' + K.name, svc: { id: 0, kind, name: K.name, icon: K.icon, config: { port: K.port, slow: 2000 }, visibility: 'members', show: ['home', 'widget', 'tray'], every: 60, notify_down: 1, enabled: 1 },
    K, VIS: services.VIS, SHOW: services.SHOW, history: null,
  });
});
function history(id) {
  const t = now(), from = t - 7 * 86400;
  const rows = db.prepare('SELECT at, state, ms FROM service_checks WHERE service_id = ? AND at >= ? ORDER BY at').all(id, from);
  const changes = [];
  let prev = null;
  for (const r of rows) { if (r.state !== prev) changes.push(r); prev = r.state; }
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const a = t - (i + 1) * 86400, z = t - i * 86400, d = rows.filter(r => r.at >= a && r.at < z);
    days.push({ at: z, n: d.length, pct: d.length ? Math.round(d.filter(r => r.state !== 'down').length / d.length * 1000) / 10 : null,
      ms: d.filter(r => r.ms != null).length ? Math.round(d.filter(r => r.ms != null).reduce((n, r) => n + r.ms, 0) / d.filter(r => r.ms != null).length) : null });
  }
  return { changes: changes.reverse().slice(0, 25), days, bars: services.bars(id, 24), up1: services.uptime(id, 86400), up7: services.uptime(id), watchers: db.prepare('SELECT COUNT(*) AS n FROM service_watch WHERE service_id = ?').get(id).n };
}
router.get('/dienste/:id', (req, res, next) => {
  const s = services.get(req.params.id);
  if (!s) return next();
  res.render('admin/dienst-edit', { title: s.name, svc: { ...s, text: services.summary(s, true) }, K: services.KINDS[s.kind], VIS: services.VIS, SHOW: services.SHOW, history: history(s.id) });
});
router.post('/dienste/speichern', (req, res) => {
  const id = Number(req.body.id) || 0;
  const r = services.save(id, req.body, req.user.id);
  if (r.error) return fail(res, id ? `/admin/dienste/${id}` : `/admin/dienste/neu?art=${encodeURIComponent(req.body.kind || '')}`, r.error);
  res.redirect(`/admin/dienste/${r.id}?ok=1`);
});
// „Jetzt testen“: prüft mit den Werten im Formular, ohne zu speichern. Antwort ohne Schlüssel.
router.post('/dienste/test', async (req, res) => {
  const id = Number(req.body.id) || 0, kind = Object.hasOwn(services.KINDS, req.body.kind) ? req.body.kind : 'http';
  const r = await services.test(req.body, id);
  const fake = { kind, enabled: 1, state: r.state, state_since: null, info: { ...(r.info || {}), error: r.error }, last_ms: r.ms ?? null };
  res.json({ state: r.state, label: services.STATES[r.state] || r.state, text: r.state === 'down' ? 'Offline: ' + (r.error || 'keine Antwort') : services.summary(fake, true) });
});
router.post('/dienste/:id/pruefen', async (req, res) => {
  await services.checkOne(Number(req.params.id)).catch(() => {});
  res.redirect(String(req.body.back || '').startsWith('/admin/') ? req.body.back : `/admin/dienste/${Number(req.params.id)}?ok=1`);
});
router.post('/dienste/:id/loeschen', (req, res) => {
  services.remove(req.params.id, req.user.id);
  res.redirect('/admin/dienste?ok=1');
});
router.post('/dienste/:id/:dir', (req, res, next) => {
  if (!['hoch', 'runter'].includes(req.params.dir)) return next();
  services.move(req.params.id, req.params.dir === 'hoch' ? 'up' : 'down');
  res.redirect('/admin/dienste#d' + Number(req.params.id));
});

// ---------- Postfach (Nachrichten, Besucherbuch, Freigaben) ----------
router.get('/postfach', (req, res) => {
  const c = res.locals.counts;
  res.redirect(c.unread ? '/admin/messages' : c.pending ? '/admin/guestbook' : c.paint || c.popups ? '/admin/freigaben' : '/admin/messages');
});
router.get('/freigaben', (req, res) => {
  const paintList = db.prepare(`SELECT a.*, u.username, u.display_name FROM artworks a JOIN users u ON u.id = a.owner_id
                                WHERE a.visibility = 'public' AND a.approved = 0 ORDER BY a.updated_at DESC LIMIT 100`).all();
  res.render('admin/freigaben', { title: 'Freigaben', paintList, popupList: popups.all().filter(p => p.status === 'pending') });
});
router.post('/freigaben/paint/:id/:what', (req, res, next) => {
  if (!['ok', 'weg'].includes(req.params.what)) return next();
  if (req.params.what === 'ok') db.prepare('UPDATE artworks SET approved = 1 WHERE id = ?').run(Number(req.params.id));
  else require('./paint').adminDelete(req.params.id);
  res.redirect('/admin/freigaben?ok=1');
});

// ---------- Aussehen → Startseite ----------
router.get('/startseite', (req, res) => {
  res.render('admin/startseite', { title: 'Startseite', home_md: getSetting('home_md', ''), blocks: homeblocks.list(), FOR: homeblocks.FOR, COLS: homeblocks.COLS });
});
router.post('/startseite/text', (req, res) => {
  setSetting('home_md', String(req.body.home_md || '').slice(0, 20000));
  res.redirect('/admin/startseite?ok=1#text');
});
router.post('/startseite/bausteine', (req, res) => {
  homeblocks.save(req.body);
  const [key, dir] = String(req.body.move || '').split(':');
  if (key && (dir === 'up' || dir === 'down')) homeblocks.move(key, dir);
  res.redirect('/admin/startseite?ok=1#bausteine');
});

// ---------- Aussehen → Laufband ----------
router.get('/laufband', (req, res) => {
  const s = settings(['ticker_on', 'ticker_style', 'ticker_label', 'ticker_auto']);
  const edit = req.query.edit ? db.prepare('SELECT * FROM ticker_items WHERE id = ?').get(Number(req.query.edit)) : null;
  res.render('admin/laufband', {
    title: 'Laufband', s, auto: s.ticker_auto.split(','), items: ticker.own(), edit, STYLES: ticker.STYLES, AUTO: ticker.AUTO, AUDIENCE: ticker.AUDIENCE,
    preview: ticker.items(req.user, res.locals), active: ticker.active,
  });
});
router.post('/laufband', (req, res) => {
  const b = req.body;
  flag(b, 'ticker_on');
  pick(b, 'ticker_style', Object.keys(ticker.STYLES));
  setSetting('ticker_label', str(b.ticker_label, 30));
  setSetting('ticker_auto', asArray(b.auto).filter(k => Object.hasOwn(ticker.AUTO, k)).join(','));
  res.redirect('/admin/laufband?ok=1');
});
router.post('/laufband/meldung', (req, res) => {
  const id = Number(req.body.id) || 0, r = ticker.save(id, req.body);
  if (r.error) return fail(res, '/admin/laufband' + (id ? '?edit=' + id : ''), r.error);
  res.redirect('/admin/laufband?ok=1#meldungen');
});
router.post('/laufband/:id/loeschen', (req, res) => {
  ticker.remove(req.params.id);
  res.redirect('/admin/laufband?ok=1#meldungen');
});
router.post('/laufband/:id/:dir', (req, res, next) => {
  if (!['hoch', 'runter'].includes(req.params.dir)) return next();
  ticker.move(req.params.id, req.params.dir === 'hoch' ? 'up' : 'down');
  res.redirect('/admin/laufband#meldungen');
});

// ---------- Aussehen → Popup-Bilder ----------
router.get('/popups', (req, res) => {
  const edit = req.query.edit ? popups.get(req.query.edit) : null;
  res.render('admin/popups', {
    title: 'Popup-Bilder', cfg: popups.config(), list: popups.all(), edit, AUDIENCE: popups.AUDIENCE, WEIGHT: popups.WEIGHT,
    media: db.prepare("SELECT stored_name, original_name FROM media WHERE mime LIKE 'image/%' ORDER BY created_at DESC LIMIT 80").all(),
    art: db.prepare(`SELECT a.id, a.title, u.username FROM artworks a JOIN users u ON u.id = a.owner_id
                     WHERE a.visibility = 'public' AND a.approved = 1 ORDER BY a.updated_at DESC LIMIT 80`).all(),
    svcList: services.all().map(s => ({ id: s.id, name: s.name, icon: s.icon })),
  });
});
router.post('/popups/einstellungen', (req, res) => {
  const b = req.body;
  for (const k of ['popup_on', 'popup_mobile', 'popup_cheeky', 'popup_suggest']) flag(b, k);
  num(b, 'popup_first', 5, 3600, 30);
  num(b, 'popup_every', 1, 1440, 15);
  num(b, 'popup_max', 1, 50, 3);
  pick(b, 'popup_audience', Object.keys(popups.AUDIENCE));
  res.redirect('/admin/popups?ok=1');
});
router.post('/popups/neu', up.mediaUpload.single('upload'), auth.csrfCheck, (req, res) => {
  const b = req.body;
  let image = null, source = b.source, artworkId = null;
  if (req.file) { image = up.saveMedia([req.file], req.user.id)[0].url; source = 'upload'; }
  else if (b.media && (b.source !== 'paint' || !b.artwork)) {
    if (/^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$/.test(b.media) && db.prepare('SELECT 1 FROM media WHERE stored_name = ?').get(b.media)) { image = '/media/' + b.media; source = 'media'; }
  } else if (b.artwork) {
    const a = db.prepare("SELECT id, title FROM artworks WHERE id = ? AND visibility = 'public' AND approved = 1").get(Number(b.artwork));
    if (a) { image = `/paint/bild/${a.id}.png`; artworkId = a.id; source = 'paint'; if (!str(b.title)) b.title = a.title; }
  }
  if (!image) return fail(res, '/admin/popups', 'Bitte ein Bild hochladen oder aus den Bildern oder der Galerie wählen.');
  const r = popups.add({ image, source: source || 'upload', artworkId }, b);
  if (r.error) return fail(res, '/admin/popups', r.error);
  res.redirect('/admin/popups?ok=1#pool');
});
router.post('/popups/:id', (req, res) => {
  const r = popups.update(req.params.id, req.body);
  if (r.error) return fail(res, '/admin/popups?edit=' + Number(req.params.id), r.error);
  res.redirect('/admin/popups?ok=1#pool');
});
router.post('/popups/:id/freigeben', (req, res) => {
  popups.approve(req.params.id);
  res.redirect(String(req.body.back || '').startsWith('/admin/') ? req.body.back : '/admin/popups?ok=1#pool');
});
router.post('/popups/:id/loeschen', (req, res) => {
  popups.remove(req.params.id);
  res.redirect(String(req.body.back || '').startsWith('/admin/') ? req.body.back : '/admin/popups?ok=1#pool');
});

module.exports = router;
