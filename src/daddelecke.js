'use strict';
// Dancors Daddelecke (/spiele): alle Spiele der Seite an einem Ort, ohne Desktop, dazu mitgebrachte Spiele.
// Eingebaute Spiele laufen als iframe ihrer gewohnten Seite (?embed), im modernen Aussehen (public/play-modern.css).
// Mitgebrachte Spiele stehen in der Tabelle apps (früher „Andere Games“): HTML-Datei, ZIP, Link/Einbettung, DOS (js-dos),
// Flash (Ruffle). Ihre Dateien liegen unter data/apps/<slug> und laufen über /apps/<slug>/play/ (src/routes/public.js).
//
// Aufbau der Seite (Einstellung dd_layout, bearbeitet im Bearbeiten-Modus auf der Seite selbst, public/v3-edit.js):
//   { title, text, today: { daily, tables, fresh, pick }, shelves: [{ id, title, icon, sub, hidden, games: [key] }],
//     games: { key: { title, text, icon, color, cover, hidden } } }
// Schlüssel: eingebaute Spiele wie „sudoku“, mitgebrachte mit ihrem slug, DS-Spiele „ds-<slug>“. Spiele, die in keinem Regal
// stehen (neu hochgeladen, neues DS-Spiel), landen in ihrem Standardregal.
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { db, now, getSetting, setSetting, APPS_DIR } = require('./db');
const auth = require('./auth');

const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const COLORS = {
  blau: 'Blau', gruen: 'Grün', rot: 'Rot', gelb: 'Bernstein', lila: 'Lila', tuerkis: 'Türkis', orange: 'Orange', rosa: 'Rosa', nacht: 'Nacht', grau: 'Grau',
};
const KINDS = {
  html: { icon: '📄', name: 'HTML-Datei', text: 'Ein einzelnes Spiel als .html, alles drin.' },
  zip: { icon: '🗜️', name: 'ZIP-Paket', text: 'HTML5-Spiel mit Ordnern: Unity WebGL, Godot, Construct, GameMaker, Phaser …' },
  link: { icon: '🔗', name: 'Link oder Einbettung', text: 'Adresse oder Einbettungscode, z. B. von itch.io oder einer eigenen Seite.' },
  dos: { icon: '💾', name: 'DOS-Spiel', text: 'ZIP mit dem Spiel oder eine .jsdos-Datei. Läuft mit js-dos, Spielstand bleibt im Browser.' },
  flash: { icon: '⚡', name: 'Flash (.swf)', text: 'Alte Flash-Spiele über Ruffle, ganz ohne Flash Player.' },
};
const ASPECTS = { '16:9': '16:9', '4:3': '4:3', '1:1': 'Quadrat', '9:16': 'Hochkant (Handy)', fill: 'füllt die Seite' };
const CONTROLS = { tastatur: '⌨️ Tastatur', maus: '🖱️ Maus', touch: '👆 Touch', gamepad: '🎮 Gamepad' };
const SCORES = { '': 'Keine Bestenliste', high: 'Mehr Punkte sind besser', low: 'Weniger ist besser (z. B. Zeit)' };

// ---------- Eingebaute Spiele ----------
// prog: Schlüssel in src/programs.js (Aus/Mitglieder), cards: Spiel der Kartentische, members: nur angemeldet spielbar
const CARD = (key, title, icon, text, color) => ({ key, title, icon, color, text, url: '/kartenspiele', prog: 'kartenspiele', cards: key, members: true, wide: true, shelf: 'karten', tags: ['Kartentisch'] });
const BUILTIN = [
  { key: 'sudoku', title: 'Sudoku', icon: '🔢', color: 'blau', url: '/sudoku', prog: 'sudoku', shelf: 'raetsel', text: 'Drei Stück am Tag: leicht, mittel, schwer.', tags: ['Bestenliste'],
    help: 'Jede Zeile, jede Spalte und jeder 3×3-Block enthält 1 bis 9 genau einmal. Ziffern tippen oder mit den Pfeiltasten wandern, N schaltet Notizen.' },
  { key: 'kreuzwortraetsel', title: 'Kreuzworträtsel', icon: '📰', color: 'gelb', url: '/kreuzwortraetsel', prog: 'kreuzwortraetsel', shelf: 'raetsel', text: 'Jeden Tag ein neues Rätsel.', tags: ['Bestenliste'],
    help: 'Feld anklicken und tippen. Ein zweiter Klick wechselt zwischen waagerecht und senkrecht.' },
  { key: 'minesweeper', title: 'Minesweeper', icon: '💣', color: 'grau', url: '/minesweeper', prog: 'minesweeper', shelf: 'raetsel', text: 'Anfänger, Fortgeschrittene, Profis oder eigenes Feld.', tags: ['Bestzeiten'],
    help: 'Linksklick deckt auf, Rechtsklick setzt eine Fahne. Die Zahl sagt, wie viele Minen rundherum liegen.' },
  CARD('blackjack', 'Blackjack', '🃏', 'Gegen die Bank, bis zu 5 am Tisch.', 'gruen'),
  CARD('poker', 'Poker', '♠️', "Texas Hold'em mit Blinds, Spielgeld aus der Kasse.", 'gruen'),
  CARD('durak', 'Durak', '🎴', 'Russischer Klassiker mit Zuwerfen.', 'gruen'),
  CARD('uno', 'UNO', '🟥', 'Mit Hausregeln wie Stapeln oder Ziehen bis es passt.', 'rot'),
  CARD('flip7', 'Flip 7', '7️⃣', 'Zocken bis 7 verschiedene Zahlen.', 'blau'),
  CARD('pilli', 'Pilli Pilli', '🌶️', 'Scharfe Karten, keiner will sie haben.', 'orange'),
  { key: 'quiz', title: 'Quiz', icon: '❓', color: 'rot', url: '/quiz', prog: 'quiz', shelf: 'gemeinsam', text: 'Fragenrunden gegeneinander, auch am Handy.', tags: ['Lobby'], wide: true },
  { key: 'werwolf', title: 'Werwolf', icon: '🐺', color: 'nacht', url: '/werwolf', prog: 'werwolf', shelf: 'gemeinsam', text: 'Am selben Tisch oder online mit Erzähler.', tags: ['lokal', 'online'], wide: true },
  { key: 'haustier', title: 'Pixelpfoten', icon: '🐾', color: 'rosa', url: '/haustier/', prog: 'haustier', shelf: 'gemeinsam', text: 'Dein Haustier: füttern, besuchen, Ausflüge.', tags: ['Spielstand im Konto'], wide: true, retro: true },
];
const BY_KEY = new Map(BUILTIN.map(g => [g.key, g]));
const RESERVED = new Set([...BY_KEY.keys(), 'neu', 'seite', 'bestenlisten', 'apps', 'ds', 'kartenspiele']);

const DEFAULT_SHELVES = [
  { id: 'raetsel', title: 'Rätsel', icon: '🧩', sub: 'jeden Tag neu' },
  { id: 'karten', title: 'Kartenspiele', icon: '🂡', sub: 'mit Freunden am Tisch, Spielgeld aus der Kasse' },
  { id: 'gemeinsam', title: 'Gemeinsam', icon: '🎉', sub: 'für Abende mit mehreren' },
  { id: 'mitgebracht', title: 'Mitgebracht', icon: '🕹️', sub: 'externe Spiele, hier eingebettet' },
  { id: 'ds', title: 'DS-Spiele', icon: '🎮', sub: 'nur für Mitglieder, Spielstand pro Konto' },
];
const DEFAULT = {
  title: 'Dancors Daddelecke',
  text: 'Alle Spiele der Seite an einem Ort, ohne Desktop. Rätsel, Kartentische mit Freunden und mitgebrachte Spiele zum Direkt-Losspielen.',
  today: { daily: true, tables: true, fresh: true, pick: '' },
};

// ---------- Mitgebrachte Spiele (Tabelle apps) ----------
const appKey = a => a.slug;
const appUrl = a => (a.kind === 'link' ? a.external_url : `/apps/${a.slug}/play/${a.entry || 'index.html'}`);
function canSeeApp(user, a) {
  if (!a) return false;
  if (!a.approved && !(user && (user.isAdmin || user.id === a.author_id))) return false;
  return auth.canSee(user, 'app', a);
}
const canAdd = user => !!user && (user.isAdmin || !!user.canWrite);
const canEditApp = (user, a) => !!user && !!a && (user.isAdmin || (!!user.canWrite && a.author_id === user.id));
const appBySlug = slug => db.prepare('SELECT * FROM apps WHERE slug = ?').get(String(slug));
function appsFor(user) {
  const v = auth.visibilitySql(user, 'app', 'a');
  return db.prepare(`SELECT a.* FROM apps a WHERE ${v.sql} ORDER BY a.created_at DESC`).all(...v.params).filter(a => canSeeApp(user, a));
}
function pending() {
  return db.prepare('SELECT a.*, u.username AS author FROM apps a LEFT JOIN users u ON u.id = a.author_id WHERE a.approved = 0 ORDER BY a.updated_at DESC').all();
}

// Eingebettete Adresse aus einem Link oder Einbettungscode (<iframe src="…">). Nur https.
function embedUrl(input) {
  const s = String(input || '').trim();
  const m = s.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  const u = (m ? m[1] : s).replace(/&amp;/g, '&').trim();
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

// Slug für ein neues Spiel: nicht wie ein eingebautes Spiel, nicht „ds-…“
function slugFor(title) {
  const base = String(title || 'spiel').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'spiel';
  let slug = base, i = 2;
  while (RESERVED.has(slug) || slug.startsWith('ds-') || db.prepare('SELECT 1 FROM apps WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
  return slug;
}

// Spielerseiten für DOS und Flash: kleine HTML-Datei im Ordner des Spiels, die js-dos bzw. Ruffle von dieser Seite lädt
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function playerHtml(kind, file, title) {
  const head = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>`;
  const css = '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#spiel{width:100%;height:100%}</style>';
  if (kind === 'dos') {
    return `${head}<link rel="stylesheet" href="/vendor/js-dos/js-dos.css">${css}</head><body><div id="spiel" data-file="${esc(file)}"></div>`
      + '<script src="/vendor/js-dos/js-dos.js"></script><script src="/static/dd-dos.js"></script></body></html>';
  }
  return `${head}${css}</head><body><div id="spiel" data-file="${esc(file)}"></div><script src="/vendor/ruffle/ruffle.js"></script><script src="/static/dd-flash.js"></script></body></html>`;
}

// DOS: aus einem ZIP mit dem Spiel ein .jsdos-Paket machen (dosbox.conf mit Startbefehl). Eine .jsdos-Datei bleibt, wie sie ist.
function dosBundle(dir, cmd) {
  const names = fs.readdirSync(dir);
  if (names.some(n => n.toLowerCase().endsWith('.jsdos'))) return names.find(n => n.toLowerCase().endsWith('.jsdos'));
  const zip = new AdmZip();
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n), r = rel ? rel + '/' + n : n;
      if (fs.statSync(p).isDirectory()) walk(p, r);
      else if (!/\.(br|gz)$/.test(n) && n !== 'index.html') zip.addFile(r, fs.readFileSync(p));
    }
  };
  walk(dir, '');
  const exe = cleanCmd(cmd) || guessExe(zip.getEntries().map(e => e.entryName));
  const conf = ['[sdl]', 'autolock=true', '', '[cpu]', 'core=auto', 'cycles=auto', '', '[autoexec]', 'echo off', 'mount c .', 'c:',
    ...exe.split(/\s*;\s*/).filter(Boolean), ''].join('\n');
  zip.addFile('.jsdos/dosbox.conf', Buffer.from(conf));
  zip.writeZip(path.join(dir, 'spiel.jsdos'));
  return 'spiel.jsdos';
}
const cleanCmd = c => String(c || '').replace(/[^\w .:\\/;-]/g, '').trim().slice(0, 200);
function guessExe(names) {
  const exe = names.filter(n => /\.(exe|com|bat)$/i.test(n) && !/install|setup|config/i.test(n));
  exe.sort((a, b) => a.split('/').length - b.split('/').length);
  const e = exe[0];
  if (!e) return '';
  const parts = e.split('/');
  const file = parts.pop();
  return [...parts.map(p => 'cd ' + p), file].join(';');
}

// ---------- Aufbau der Seite ----------
function rawLayout() {
  try { return JSON.parse(getSetting('dd_layout', 'null')) || {}; } catch { return {}; }
}
function cleanGameOverride(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (str(o.title, 60)) out.title = str(o.title, 60);
  if (str(o.text, 200)) out.text = str(o.text, 200);
  const icon = [...str(o.icon, 8)].slice(0, 2).join('');
  if (icon) out.icon = icon;
  if (Object.hasOwn(COLORS, o.color)) out.color = o.color;
  if (/^\/media\/[\w.-]+$/.test(String(o.cover || ''))) out.cover = o.cover;
  if (o.hidden) out.hidden = true;
  return out;
}
// Fester Platz für jedes Spiel, das (noch) in keinem Regal steht
function defaultShelf(key) {
  const b = BY_KEY.get(key);
  if (b) return b.shelf;
  return key.startsWith('ds-') ? 'ds' : 'mitgebracht';
}
function normalize(raw, allKeys) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const today = raw.today && typeof raw.today === 'object' ? raw.today : {};
  const out = {
    title: str(raw.title, 80) || DEFAULT.title,
    text: raw.text === '' ? '' : str(raw.text, 400) || DEFAULT.text,
    today: {
      daily: today.daily === undefined ? true : !!today.daily, tables: today.tables === undefined ? true : !!today.tables,
      fresh: today.fresh === undefined ? true : !!today.fresh, pick: str(today.pick, 80),
    },
    shelves: [], games: {},
  };
  const seenShelf = new Set(), placed = new Set();
  const shelves = Array.isArray(raw.shelves) ? raw.shelves : DEFAULT_SHELVES;
  for (const s of shelves.slice(0, 30)) {
    if (!s || typeof s !== 'object') continue;
    let id = str(s.id, 30).replace(/[^\w-]/g, '');
    if (!id || seenShelf.has(id)) id = 'r' + Math.random().toString(36).slice(2, 8);
    seenShelf.add(id);
    const games = [];
    for (const k of (Array.isArray(s.games) ? s.games : []).map(k => str(k, 80))) {
      if (k && !placed.has(k) && (!allKeys || allKeys.has(k))) { placed.add(k); games.push(k); }
    }
    out.shelves.push({ id, title: str(s.title, 60) || 'Regal', icon: [...str(s.icon, 8)].slice(0, 2).join('') || '🎲', sub: str(s.sub, 120), hidden: !!s.hidden, games });
  }
  // Standardregale, die es nie gab, kommen nur bei der ersten Einrichtung dazu (danach hat der Admin sie vielleicht gelöscht)
  if (!out.shelves.length) out.shelves = DEFAULT_SHELVES.map(s => ({ ...s, hidden: false, games: [] }));
  // Spiele ohne Regal: in ihr Standardregal, sonst ins letzte
  for (const k of allKeys || []) {
    if (placed.has(k)) continue;
    const want = defaultShelf(k);
    let sh = out.shelves.find(s => s.id === want);
    if (!sh) {
      const d = DEFAULT_SHELVES.find(s => s.id === want);
      sh = d ? { ...d, hidden: false, games: [] } : out.shelves[out.shelves.length - 1];
      if (d) out.shelves.push(sh);
    }
    sh.games.push(k);
  }
  const games = raw.games && typeof raw.games === 'object' ? raw.games : {};
  for (const [k, o] of Object.entries(games)) {
    const c = cleanGameOverride(o);
    if (Object.keys(c).length && (!allKeys || allKeys.has(k))) out.games[str(k, 80)] = c;
  }
  return out;
}
// Alle Schlüssel, die es gibt (für den Admin: auch ausgeschaltete Programme und nicht freigegebene Spiele)
function allKeys() {
  const keys = new Set(BUILTIN.map(g => g.key));
  for (const a of db.prepare('SELECT slug FROM apps').all()) keys.add(a.slug);
  try { for (const g of require('./ds').all()) keys.add('ds-' + g.slug); } catch { /* ohne DS */ }
  return keys;
}
const layout = () => normalize(rawLayout(), allKeys());
function saveLayout(input) {
  const l = normalize(input, allKeys());
  setSetting('dd_layout', JSON.stringify(l));
  return l;
}
// Ein Spiel in ein Regal stellen (beim Hinzufügen)
function place(key, shelfId) {
  const l = layout();
  for (const s of l.shelves) s.games = s.games.filter(k => k !== key);
  const sh = l.shelves.find(s => s.id === shelfId) || l.shelves.find(s => s.id === defaultShelf(key)) || l.shelves[l.shelves.length - 1];
  if (sh) sh.games.push(key);
  saveLayout(l);
}
function unplace(key) {
  const l = rawLayout();
  if (Array.isArray(l.shelves)) for (const s of l.shelves) if (Array.isArray(s.games)) s.games = s.games.filter(k => k !== key);
  if (l.games) delete l.games[key];
  setSetting('dd_layout', JSON.stringify(l));
}

// ---------- Spiele für einen Besucher ----------
function progState(key) {
  try { return require('./programs').state(key); } catch { return 'all'; }
}
function cardOn(id) {
  try { return require('./kartenspiele').games().some(g => g.id === id); } catch { return false; }
}
// Ein Spiel als Karte: Daten des Spiels + Änderungen aus dem Bearbeiten-Modus. Ergebnis null, wenn es der Besucher nicht sieht.
function builtinFor(user, g, locals, admin) {
  let st = progState(g.prog);
  if ((locals.navHidden || []).includes(g.prog)) st = 'off';
  if (g.cards && !cardOn(g.cards)) st = 'off';
  if (st === 'off' && !admin) return null;
  const locked = !user && (st === 'members' || g.members);
  return { ...g, kind: 'builtin', src: g.url, off: st === 'off', locked, playUrl: '/spiele/' + g.key };
}
function appCard(a) {
  const k = KINDS[a.kind] || KINDS.zip;
  const tags = [k.name];
  if (a.controls) tags.push(...String(a.controls).split(',').filter(c => CONTROLS[c]).map(c => CONTROLS[c].split(' ').slice(1).join(' ')));
  return {
    key: appKey(a), title: a.title, icon: a.icon || '🕹️', color: a.color || 'lila', cover: a.cover || '', text: a.description || '', tags,
    kind: a.kind || 'zip', app: a, src: appUrl(a), playUrl: '/spiele/' + a.slug, pending: !a.approved, wide: a.aspect === 'fill',
    created: a.created_at, fresh: !!a.fresh,
  };
}
function dsCard(g) {
  return { key: 'ds-' + g.slug, title: g.title, icon: g.icon || '🎮', color: 'tuerkis', text: g.description || 'DS-Spiel, Spielstand in deinem Konto.', tags: ['DS'],
    kind: 'ds', src: '/ds/' + g.slug, playUrl: '/spiele/ds-' + g.slug, members: true, wide: true, retro: true };
}
// Alle Spiele, die der Besucher sieht (Admin: alle, ausgeschaltete gekennzeichnet), als Map Schlüssel → Karte
function cards(user, locals) {
  const admin = !!(user && user.isAdmin), out = new Map();
  for (const g of BUILTIN) { const c = builtinFor(user, g, locals, admin); if (c) out.set(g.key, c); }
  const appsSt = progState('apps');
  if (appsSt !== 'off' || admin) {
    for (const a of admin ? db.prepare('SELECT * FROM apps').all() : appsFor(user)) {
      const c = appCard(a);
      c.locked = !user && appsSt === 'members';
      c.off = appsSt === 'off';
      out.set(c.key, c);
    }
  }
  const dsSt = progState('ds');
  if (dsSt !== 'off' || admin) {
    try {
      const ds = require('./ds');
      for (const g of admin ? ds.all() : ds.visibleTo(user)) out.set('ds-' + g.slug, { ...dsCard(g), off: dsSt === 'off' });
      // Gäste sehen, dass es DS-Spiele gibt (mit Schloss), aber nicht welche, die nur Gruppen sehen
      if (!user) for (const g of ds.all().filter(x => x.visibility === 'public')) out.set('ds-' + g.slug, { ...dsCard(g), locked: true });
    } catch { /* ohne DS */ }
  }
  return out;
}
function decorate(card, ov) {
  if (!ov) return card;
  return { ...card, title: ov.title || card.title, text: ov.text || card.text, icon: ov.icon || card.icon, color: ov.color || card.color, cover: ov.cover || card.cover || '', hidden: !!ov.hidden, ov };
}

// Die Übersicht: Regale mit Karten. edit: auch Ausgeblendetes (für den Bearbeiten-Modus)
function view(user, locals, { edit = false } = {}) {
  const l = layout(), all = cards(user, locals);
  const shelves = [];
  for (const s of l.shelves) {
    if (s.hidden && !edit) continue;
    const games = s.games.map(k => all.get(k) && decorate(all.get(k), l.games[k])).filter(g => g && (edit || (!g.hidden && !g.off)));
    if (!games.length && !edit) continue;
    shelves.push({ ...s, games });
  }
  return { layout: l, shelves, all };
}
function card(user, locals, key) {
  const c = cards(user, locals).get(key);
  return c ? decorate(c, layout().games[key]) : null;
}

// ---------- „Heute“ oben ----------
function today(user, locals, v) {
  const out = [], t = v.layout.today, find = k => { const c = v.all.get(k); return c && !c.off ? decorate(c, v.layout.games[k]) : null; };
  if (t.daily && find('sudoku')) {
    const sd = require('./sudoku'), day = sd.today();
    let text = 'Drei neue Rätsel: leicht, mittel und schwer.', chips = [];
    if (user) {
      const rows = db.prepare('SELECT level, seconds FROM sd_progress WHERE user_id = ? AND day = ? AND solved_at IS NOT NULL AND gave_up = 0').all(user.id, day);
      const done = rows.map(r => sd.LEVELS[r.level] && sd.LEVELS[r.level].name).filter(Boolean);
      text = done.length === 3 ? 'Alle drei gelöst. Stark!' : done.length ? `${done.join(' und ')} ${done.length === 1 ? 'ist' : 'sind'} gelöst, ${3 - done.length} ${3 - done.length === 1 ? 'wartet' : 'warten'} noch.` : 'Noch keins gelöst. Leicht ist in ein paar Minuten drin.';
      const tot = sd.userTotals(user.id);
      if (tot.streak) chips.push(`🔥 Serie ${tot.streak} ${tot.streak === 1 ? 'Tag' : 'Tage'}`);
      chips.push(`${done.length} von 3`);
    }
    out.push({ kicker: 'Heute · ' + new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: process.env.TZ || 'Europe/Berlin' }),
      title: 'Sudoku des Tages', text, chips, icon: '🔢', color: 'blau', url: '/spiele/sudoku' });
  }
  if (t.tables && user) {
    try {
      const tables = require('./kartenspiele').list(user).filter(x => x.game !== 'lobby' && x.players < x.seats && find(x.game));
      const tb = tables[0];
      if (tb) {
        out.push({ kicker: tb.live ? 'Runde läuft' : 'Gerade offen', title: `${tb.title} bei ${tb.host}`, text: `${tb.players} von ${tb.seats} Plätzen belegt.`,
          chips: [`● ${tb.seats - tb.players} ${tb.seats - tb.players === 1 ? 'Platz' : 'Plätze'} frei`], icon: tb.icon, color: 'gruen', url: `/spiele/${tb.game}?tisch=${encodeURIComponent(tb.id)}` });
      }
    } catch { /* nur Beiwerk */ }
  }
  const pick = t.pick && find(t.pick);
  if (pick) out.push({ kicker: '⭐ Spiel der Woche', title: pick.title, text: pick.text, chips: [], icon: pick.icon, color: pick.color, cover: pick.cover, url: pick.playUrl });
  if (t.fresh) {
    const fresh = [...v.all.values()].filter(c => c.app && c.fresh && !c.pending && !c.off && c.key !== t.pick).sort((a, b) => b.created - a.created)[0];
    if (fresh) {
      const g = decorate(fresh, v.layout.games[fresh.key]);
      out.push({ kicker: 'Neu dabei', title: g.title, text: g.text, chips: [require('./v3').ago(fresh.created)], icon: g.icon, color: g.color, cover: g.cover, url: g.playUrl });
    }
  }
  return out.slice(0, 3);
}

// Kleine Angaben auf den Karten: offene Tische je Kartenspiel, Sudoku-Stand
function live(user) {
  const out = {};
  if (!user) return out;
  try {
    for (const t of require('./kartenspiele').list(user)) {
      if (t.game === 'lobby') continue;
      const o = out[t.game] || (out[t.game] = { tables: 0, players: 0 });
      o.tables++; o.players += t.players;
    }
  } catch { /* nur Beiwerk */ }
  try {
    const sd = require('./sudoku');
    const n = db.prepare('SELECT COUNT(*) AS n FROM sd_progress WHERE user_id = ? AND day = ? AND solved_at IS NOT NULL AND gave_up = 0').get(user.id, sd.today()).n;
    out.sudoku = { solved: n };
  } catch { /* nur Beiwerk */ }
  return out;
}

// ---------- Bestenlisten an der Seite ----------
const us = () => require('./usersettings');
const fmtTime = s => (s == null ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
function boards(user, card) {
  const out = [];
  const rows = (slug, list, val, n = 5) => us().boardList(slug, list, user).slice(0, n).map(r => ({ name: r.name, me: !!user && r.id === user.id, value: val(r), help: r.help > 0 }));
  try {
    if (card.key === 'sudoku') {
      const sd = require('./sudoku'), day = sd.today();
      for (const lv of sd.LEVEL_KEYS) out.push({ title: 'Heute · ' + sd.LEVELS[lv].name, rows: rows('sudoku', sd.leaderboard(day, lv, 30), r => fmtTime(r.seconds), 3) });
    } else if (card.key === 'kreuzwortraetsel') {
      const cw = require('./crossword');
      out.push({ title: 'Heute', rows: rows('kreuzwortraetsel', cw.leaderboard(cw.today(), 30), r => fmtTime(r.seconds)) });
    } else if (card.key === 'minesweeper') {
      const ms = require('./minesweeper');
      for (const lv of Object.keys(ms.LEVELS)) out.push({ title: ms.LEVELS[lv].name, rows: rows('minesweeper', ms.bestTimes(lv, 20), r => fmtTime(r.seconds), 3) });
    } else if (card.cards && user) {
      const k = require('./kasse');
      out.push({ title: 'Kasse · Bilanz', rows: us().boardList('kartenspiele', k.leaderboard(), user).slice(0, 5).map(r => ({ name: r.name, me: r.id === user.id, value: (r.net >= 0 ? '+' : '−') + Math.abs(r.net).toLocaleString('de-DE') + ' €' })) });
    } else if (card.app && card.app.score_mode) {
      out.push({ title: 'Bestenliste', rows: scoreBoard(card.app, user, 10) });
    }
  } catch (e) { console.error('Daddelecke-Bestenliste:', e.message); }
  return out.some(b => b.rows.length) || card.app ? out.filter(b => b.rows.length || card.app) : out.slice(0, 1);
}
function tablesFor(user, game) {
  if (!user) return [];
  try { return require('./kartenspiele').list(user).filter(t => t.game === game).slice(0, 5); } catch { return []; }
}

// ---------- Punkte mitgebrachter Spiele ----------
// Das Spiel schickt per postMessage { dancor: 'score', score: 123 } an die Seite, public/daddelecke.js meldet sie hier.
// Manipulierbar wie jede Bestenliste im Browser, deshalb nur ein Spaß. Je Konto zählt der beste Wert.
function addScore(a, user, score) {
  const n = Number(score);
  if (!a.score_mode || !Number.isFinite(n) || Math.abs(n) > 1e12) return false;
  db.prepare('INSERT INTO dd_scores(app_id, user_id, score, created_at) VALUES (?, ?, ?, ?)').run(a.id, user.id, Math.round(n * 1000) / 1000, now());
  return true;
}
function scoreBoard(a, user, limit = 10) {
  const best = a.score_mode === 'low' ? 'MIN' : 'MAX', ord = a.score_mode === 'low' ? 'ASC' : 'DESC';
  const list = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility, ${best}(s.score) AS score
                           FROM dd_scores s JOIN users u ON u.id = s.user_id WHERE s.app_id = ? AND u.disabled = 0
                           GROUP BY u.id ORDER BY score ${ord} LIMIT 50`).all(a.id);
  return us().boardList('app-' + a.slug, list, user).slice(0, limit).map(r => ({ name: r.name, me: !!user && r.id === user.id, value: Number(r.score).toLocaleString('de-DE') }));
}

// Für die Startseiten-Kachel: kleine Angaben
function meta(user) {
  const out = [];
  try {
    const lv = live(user);
    const tables = Object.values(lv).reduce((n, o) => n + (o.tables || 0), 0);
    if (tables) out.push({ dot: 'up', text: `${tables} ${tables === 1 ? 'Tisch' : 'Tische'} offen` });
    if (lv.sudoku) out.push(`Sudoku: ${lv.sudoku.solved} von 3 gelöst`);
    if (!out.length) out.push(`${[...cards(user, { navHidden: [] }).values()].filter(c => !c.off).length} Spiele`);
  } catch { /* nur Beiwerk */ }
  return out;
}

// Suche (/finden)
function search(user, q, locals) {
  const k = str(q, 100).toLowerCase();
  if (!k) return [];
  const v = view(user, locals);
  const hits = [];
  for (const s of v.shelves) for (const g of s.games) if ((g.title + ' ' + g.text).toLowerCase().includes(k)) hits.push({ kind: 'dd', icon: g.icon, title: g.title, text: 'Daddelecke · ' + s.title, url: g.playUrl });
  return hits.slice(0, 8);
}

module.exports = {
  BUILTIN, BY_KEY, KINDS, COLORS, ASPECTS, CONTROLS, SCORES, DEFAULT_SHELVES,
  layout, saveLayout, normalize, place, unplace, view, card, cards, today, live, boards, tablesFor, meta, search,
  appBySlug, appsFor, canSeeApp, canAdd, canEditApp, pending, embedUrl, slugFor, playerHtml, dosBundle, guessExe, cleanCmd, addScore, scoreBoard, fmtTime,
  APPS_DIR,
};
