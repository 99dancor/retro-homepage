'use strict';
// Die Programme des Startmenüs an einem Ort: Das Startmenü (views/partials/startmenu.ejs) zeichnet sie,
// die Suche in der Taskleiste findet sie, und der Desktop legt aus ihnen Verknüpfungen an.
// Einträge: [Schlüssel, Adresse, Beschriftung] oder [Gruppe, Beschriftung, [Einträge]] → Untermenü wie bei Windows 98

function menu(user) {
  return [['blog', '/blog', '📝 Blog'],
    ['dokumente', '📂 Dokumente', [...(user ? [['eigene-dateien', '/eigene-dateien', '🗂️ Eigene Dateien'], ['notizblock', '/notizblock', '🗒️ Notizblock']] : []), ...(user && user.canUpload ? [['upload', '/files/upload', '📤 Hinzufügen']] : []), ['files', '/files', '📁 Downloads'], ['mods', '/mods', '🧩 Modlisten'], ['links', '/links', '🔗 Links'], ['galerie', '/galerie', '🖼️ Galerie']]],
    ['spiele', '🎮 Spiele und Apps', [['kartenspiele', '/kartenspiele', '🂡 Kartenspiele'], ['quiz', '/quiz', '❓ Quiz'], ['werwolf', '/werwolf', '🐺 Werwolf'], ['minesweeper', '/minesweeper', '💣 Minesweeper'], ['kreuzwortraetsel', '/kreuzwortraetsel', '📰 Kreuzworträtsel'], ['sudoku', '/sudoku', '🔢 Sudoku'], ['paint', '/paint', '🎨 Paint'], ['zufall', '/zufall', '🎲 Zufallsgenerator'], ['musik', '/musik', '📀 Mediaplayer'], ['apps', '/apps', '🕹️ Andere Games']]],
    ['haustier', '/haustier/', '🐾 Pixelpfoten'], ['farming', '/farming', '🚜 Farming Simulator'], ['board', '/forum', '💬 Forum'], ['nutzer', '/messenger', '🌼 Messenger'], ['guestbook', '/guestbook', '📖 Besucherbuch'], ['contact', '/contact', '✉️ Kontakt']];
}

// Symbole, die als Bild gezeichnet werden (retro.css .sym-…): Der Messenger zeigt je nach Design die ICU-Blume oder die
// DSN-Männchen, der Mediaplayer das Zeichen des gewählten Player-Skins (<html data-mp-skin>), die Kartenspiele eine
// richtige Spielkarte. Das Zeichen bleibt im Text (z. B. beim Ziehen auf den Desktop) und
// dient als Ersatz, wo kein Bild hinkommt. Gegenstück im Browser: WinUI.ico (public/winui.js).
const IMG = { '🌼': 'msgr', '🂡': 'karten', '📀': 'player' };
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function ico(icon) {
  return IMG[icon] ? `<i class="sym sym-${IMG[icon]}" aria-hidden="true">${icon}</i>` : escHtml(icon);
}
// Beschriftung „🌼 Messenger“ als HTML, mit Bild-Symbol wo es eins gibt
function labelHtml(label) {
  const sp = label.indexOf(' ');
  return sp > 0 ? ico(label.slice(0, sp)) + escHtml(label.slice(sp)) : escHtml(label);
}

// ---------- Seitenverwaltung → Programme ----------
// Eine Zeile pro Programm: für wen (Alle, Mitglieder, Aus), im Startmenü, auf dem Desktop, Eigenschaften. „Für“ schreibt
// in die Schalter, die die Programme schon immer lesen (quiz_enabled, board_members_only …). Programme ohne eigene Schalter
// merken es sich in prog_access; für sie sperrt gate() unten die Adressen (Aus: weg, Mitglieder: erst anmelden).
const FOR = { all: 'Alle', members: 'Mitglieder', off: 'Aus' };
const GROUPS = { spiele: 'Spiele', raetsel: 'Rätsel', werkzeuge: 'Werkzeuge', mitmachen: 'Mitmachen', inhalte: 'Inhalte' };
const S = () => require('./db');
const flag = (k, d = '1') => S().getSetting(k, d) === '1';
const put = (k, on) => S().setSetting(k, on ? '1' : '0');
function access() { try { return JSON.parse(S().getSetting('prog_access', '{}')) || {}; } catch { return {}; } }
function setAccess(key, v) { const a = access(); if (v === 'all') delete a[key]; else a[key] = v; S().setSetting('prog_access', JSON.stringify(a)); }
// Programme mit eigenen Schaltern: lesen und schreiben; alle anderen nutzen prog_access (generic)
const TWO = (on, guests) => ({
  get: () => (!flag(on) ? 'off' : flag(guests) ? 'all' : 'members'),
  set: v => { put(on, v !== 'off'); if (v !== 'off') put(guests, v === 'all'); },
});
const CARDS = ['bj', 'pk', 'dk', 'uno', 'f7', 'pp'];
const CATALOG = [
  // own: Das Programm prüft „nur Mitglieder“ selbst (zeigt Gästen eine Anmeldebitte), gateOff: Aus sperrt trotzdem die Adressen
  { key: 'kartenspiele', group: 'spiele', note: '6 Spiele und Kasse', props: '/admin/programme/kartenspiele', opts: ['members', 'off'], own: true, gateOff: true, prefixes: ['/kartenspiele', '/blackjack', '/poker', '/durak', '/uno', '/flip7', '/pilli'],
    get: () => (flag('ks_enabled') && CARDS.some(c => flag(c + '_enabled')) ? 'members' : 'off'), set: v => put('ks_enabled', v !== 'off') },
  { key: 'quiz', group: 'spiele', props: '/admin/quiz', own: true, ...TWO('quiz_enabled', 'quiz_guests') },
  { key: 'werwolf', group: 'spiele', props: '/admin/werwolf', own: true, ...TWO('ww_enabled', 'ww_guests') },
  { key: 'haustier', group: 'spiele', prefixes: ['/haustier'] },
  { key: 'farming', group: 'spiele', props: '/admin/farming', own: true,
    get: () => (!flag('fs_enabled') ? 'off' : S().getSetting('fs_view', 'members') === 'public' ? 'all' : 'members'),
    set: v => { put('fs_enabled', v !== 'off'); if (v !== 'off') S().setSetting('fs_view', v === 'all' ? 'public' : 'members'); } },
  { key: 'apps', group: 'spiele', note: 'hochgeladene HTML5-Spiele', props: '/admin/apps', prefixes: ['/apps'] },
  { key: 'kreuzwortraetsel', group: 'raetsel', props: '/admin/programme/raetsel', prefixes: ['/kreuzwortraetsel'] },
  { key: 'sudoku', group: 'raetsel', props: '/admin/programme/raetsel#sudoku', prefixes: ['/sudoku'] },
  { key: 'minesweeper', group: 'raetsel', props: '/admin/programme/raetsel#minesweeper', prefixes: ['/minesweeper'] },
  { key: 'paint', group: 'werkzeuge', note: 'speichern nur mit Konto', props: '/admin/paint', own: true, ...TWO('paint_enabled', 'paint_guests') },
  { key: 'galerie', group: 'werkzeuge', props: '/admin/paint', prefixes: ['/galerie'],
    get: () => (!flag('paint_gallery') ? 'off' : access().galerie === 'members' ? 'members' : 'all'),
    set: v => { put('paint_gallery', v !== 'off'); setAccess('galerie', v === 'members' ? 'members' : 'all'); } },
  { key: 'musik', group: 'werkzeuge', props: '/admin/programme/mediaplayer', prefixes: ['/musik'] },
  { key: 'zufall', group: 'werkzeuge', prefixes: ['/zufall'] },
  { key: 'board', group: 'mitmachen', note: 'schreiben nur mit Konto', props: '/admin/programme/forum', own: true,
    get: () => (!flag('board_enabled') ? 'off' : flag('board_members_only', '0') ? 'members' : 'all'),
    set: v => { put('board_enabled', v !== 'off'); if (v !== 'off') put('board_members_only', v === 'members'); } },
  { key: 'nutzer', group: 'mitmachen', opts: ['members', 'off'], own: true, gateOff: true, prefixes: ['/messenger'] },
  { key: 'guestbook', group: 'mitmachen', props: '/admin/programme/besucherbuch', prefixes: ['/guestbook'],
    get: () => (!flag('guestbook_enabled') ? 'off' : access().guestbook === 'members' ? 'members' : 'all'),
    set: v => { put('guestbook_enabled', v !== 'off'); setAccess('guestbook', v === 'members' ? 'members' : 'all'); } },
  { key: 'contact', group: 'mitmachen', prefixes: ['/contact'],
    get: () => (!flag('contact_enabled') ? 'off' : access().contact === 'members' ? 'members' : 'all'),
    set: v => { put('contact_enabled', v !== 'off'); setAccess('contact', v === 'members' ? 'members' : 'all'); } },
  { key: 'blog', group: 'inhalte', props: '/admin/posts', prefixes: ['/blog'] },
  { key: 'files', group: 'inhalte', props: '/admin/files', prefixes: ['/files'] },
  { key: 'mods', group: 'inhalte', props: '/admin/mods', prefixes: ['/mods'] },
  { key: 'links', group: 'inhalte', props: '/admin/links', prefixes: ['/links'] },
].map(p => ({ opts: ['all', 'members', 'off'], prefixes: [], ...p }));
const BY_KEY = new Map(CATALOG.map(p => [p.key, p]));
function state(key) {
  const p = BY_KEY.get(key);
  if (!p) return 'all';
  if (p.get) return p.get();
  const v = access()[key];
  return v === 'off' || v === 'members' ? v : p.opts.includes('all') ? 'all' : 'members';
}
function setState(key, v) {
  const p = BY_KEY.get(key);
  if (!p || !p.opts.includes(v)) return false;
  if (p.set) p.set(v); else setAccess(key, v === (p.opts.includes('all') ? 'all' : 'members') ? 'all' : v);
  return true;
}
// Alle Zeilen für die Seite Programme, mit Name und Symbol aus dem Startmenü
function catalog() {
  const names = new Map(flat({ canUpload: true }).map(p => [p.key, p]));
  return CATALOG.map(p => ({ ...p, name: (names.get(p.key) || {}).name || p.key, icon: (names.get(p.key) || {}).icon || '▫️', url: (names.get(p.key) || {}).url || '/', state: state(p.key) }));
}
// Sperre für die Adressen der Programme ohne eigene Prüfung: Aus → Hinweis, Mitglieder → erst anmelden. Admins kommen immer durch.
function gate(req, res, next) {
  if (req.method !== 'GET' || (req.user && req.user.isAdmin)) return next();
  const p = CATALOG.find(c => (!c.own || c.gateOff) && c.prefixes.some(x => req.path === x || req.path.startsWith(x + '/')));
  if (!p) return next();
  const st = state(p.key);
  if (p.own && st !== 'off') return next();
  if (st === 'off') return res.status(404).render('error', { title: 'Ausgeschaltet', message: 'Dieses Programm ist gerade ausgeschaltet.' });
  if (st === 'members' && !req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

// Abgeschaltete Bereiche (Seitenverwaltung) verschwinden aus Startmenü, Suche und Desktop, „nur Mitglieder“ für Gäste auch
function off(l) {
  const out = {
    guestbook: !l.guestbookEnabled, board: !l.boardEnabled, kartenspiele: !l.cardsEnabled, paint: !l.paintEnabled,
    quiz: !l.quizEnabled, werwolf: !l.werwolfEnabled, galerie: !l.galleryEnabled, contact: !l.contactEnabled, farming: !l.farmingVisible,
  };
  for (const p of CATALOG) {
    const st = state(p.key);
    if (p.own) { if (st === 'off') out[p.key] = true; continue; }
    if (st === 'off' || (st === 'members' && !l.user)) out[p.key] = true;
  }
  return out;
}

// Alle Programme flach und ungefiltert: { key, url, icon, name, group }
function flat(user) {
  const out = [];
  (function walk(entries, group) {
    for (const e of entries) {
      if (Array.isArray(e[2])) { walk(e[2], e[1].replace(/^\S+\s/, '')); continue; }
      const [key, url, label] = e, sp = label.indexOf(' ');
      out.push({ key, url, icon: label.slice(0, sp), name: label.slice(sp + 1), group: group || '' });
    }
  })(menu(user), '');
  return out;
}
// Nur die sichtbaren. l sind die res.locals einer Seite.
function list(l) {
  const hidden = l.navHidden || [], offs = off(l);
  const out = flat(l.user).filter(p => !(hidden.includes(p.key) || offs[p.key]));
  out.push({ key: 'einstellungen', url: '/einstellungen', icon: '🛠️', name: 'Systemsteuerung', group: '' });
  if (l.user && l.user.isAdmin) out.push({ key: 'admin', url: '/admin', icon: '⚙️', name: 'Seitenverwaltung', group: '' });
  return out;
}

module.exports = { menu, off, flat, list, ico, labelHtml, FOR, GROUPS, CATALOG, catalog, state, setState, gate, access };
