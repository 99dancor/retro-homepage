'use strict';
// Startseite mit Kacheln (Version 3.0, views/v3/portal.ejs). Die Kacheln legt der Admin in der Seitenverwaltung an
// (Aussehen → Startseite (Kacheln), views/admin/kacheln.ejs): sortieren, ausblenden, nur für Mitglieder, eigene dazu.
// Die fünf festen Kacheln zeigen unten kleine Angaben aus ihrem Bereich (Anzahl, das Neueste, Server online).
const { getSetting, setSetting } = require('./db');

const COLORS = { desk: 'Türkis', dl: 'Blau', du: 'Bernstein', de: 'Rot', fs: 'Grün', x: 'Lila', di: 'Erde', gray: 'Grau' };
const SHOW = { all: 'alle', members: 'nur Mitglieder', off: 'ausgeblendet' };
const BUILTIN = {
  desktop: { kicker: 'Dancors', title: 'Desktop', icon: '🖥️', color: 'desk', url: '/desktop', text: 'Der Retro-Desktop: Kartenspiele, Minesweeper, Messenger, Forum, Mediaplayer, Paint und Pixelpfoten.' },
  downloads: { kicker: 'Dancors', title: 'Downloads', icon: '📦', color: 'dl', url: '/downloads', text: 'Widget, Tools, Spielstände und mehr. Mit Version, Anleitung und Änderungen.' },
  duden: { kicker: 'Dancors', title: 'Duden', icon: '📚', color: 'du', url: '/duden', text: 'Guides, Wiki und Linksammlungen: Server, Netzwerk, Spiele und was sonst nützt.' },
  spiele: { kicker: 'Dancors', title: 'Daddelecke', icon: '🕹️', color: 'x', url: '/spiele', text: 'Sudoku, Minesweeper, Kartentische und mitgebrachte Spiele. Direkt hier spielen, ohne Desktop.' },
  rezepte: { kicker: 'Dancors', title: 'Deliziösitäten', icon: '🍝', color: 'de', url: '/rezepte', text: 'Das Rezeptbuch. Portionen umrechnen, Schritt für Schritt kochen, Zutaten auf die Einkaufsliste.' },
  hub: { kicker: 'Farming Simulator 25', title: 'Dancors Dreschplatz', icon: '🚜', color: 'fs', url: '/farming', text: 'Höfe, Karte, Planer und Preise vom Server. Die Hub-Link-Mod gibt es direkt im Hub.' },
  dioramen: { kicker: 'Dancors', title: 'Dioramas', icon: '🏡', color: 'di', url: '/dioramen', text: 'Spielstände, Bauprojekte, Sammlungen und mehr zum Anschauen: mit Bildern, Steckbrief und Download.' },
};
const ORDER = Object.keys(BUILTIN);
const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const okUrl = u => (/^\/(?![/\\])/.test(u) || /^https:\/\//i.test(u) ? u : '');

function normalize(list) {
  const seen = new Set(), out = [];
  for (let t of Array.isArray(list) ? list : []) {
    const key = str(t && t.key, 40);
    if (!key || seen.has(key) || (!BUILTIN[key] && !/^k\d+$/.test(key))) continue;
    seen.add(key);
    const b = BUILTIN[key] || {};
    // Update 106: alte Standardnamen der Dioramas-Kachel werden zum neuen (selbst geschriebene bleiben)
    if (key === 'dioramen' && t.title === 'Dioramen') t = { ...t, title: b.title };
    if (key === 'dioramen' && t.text === 'Spielstände und Bauwerke zum Anschauen und Herunterladen: Höfe, Ställe, Burgen. Mit Bildern, Steckbrief und Download.') t = { ...t, text: b.text };
    out.push({
      key, builtin: !!BUILTIN[key],
      kicker: str(t.kicker, 40) || (t.kicker === '' ? '' : b.kicker || ''), title: str(t.title, 60) || b.title || 'Kachel',
      icon: [...str(t.icon, 8)].slice(0, 2).join('') || b.icon || '⭐', color: Object.hasOwn(COLORS, t.color) ? t.color : b.color || 'x',
      url: b.url || okUrl(str(t.url, 500)) || '/', text: str(t.text, 300) || b.text || '',
      show: Object.hasOwn(SHOW, t.show) ? t.show : 'all', wide: t.wide === undefined ? !!b.wide : !!t.wide,
    });
  }
  // Feste Kacheln, die (noch) fehlen, kommen hinten dazu
  for (const key of ORDER) if (!seen.has(key)) out.push({ key, builtin: true, ...BUILTIN[key], wide: !!BUILTIN[key].wide, show: 'all' });
  return out.slice(0, 24);
}
function tiles() {
  let raw = null;
  try { raw = JSON.parse(getSetting('portal_tiles', 'null')); } catch { raw = null; }
  return normalize(raw || ORDER.map(key => ({ key })));
}
const save = list => setSetting('portal_tiles', JSON.stringify(normalize(list).map(({ builtin, ...t }) => t)));

// Kleine Angaben je Bereich
function meta(key, user) {
  try {
    if (key === 'desktop') {
      const u = require('./changelog').latest();
      return u ? [`Update ${u.no}`, u.title.length > 34 ? u.title.slice(0, 33) + '…' : u.title] : [];
    }
    if (key === 'downloads') { const s = require('./downloads').stats(user); return [`${s.count} ${s.count === 1 ? 'Download' : 'Downloads'}`, s.latest && 'neu: ' + s.latest.title]; }
    if (key === 'duden') { const s = require('./duden').stats(user); return [`${s.count} ${s.count === 1 ? 'Eintrag' : 'Einträge'}`, s.latest && 'neu: ' + s.latest.title]; }
    if (key === 'spiele') return require('./daddelecke').meta(user);
    if (key === 'dioramen') return require('./dioramen').meta(user);
    if (key === 'rezepte') { const s = require('./recipes').stats(user); return [`${s.count} ${s.count === 1 ? 'Rezept' : 'Rezepte'}`, s.latest && 'neu: ' + s.latest.title]; }
    if (key === 'hub') {
      const hub = require('./hub'), st = hub.serverStatus(), out = [];
      if (st && st.data && st.okAt && Date.now() / 1000 - st.okAt < Math.max(180, st.interval * 3)) {
        const n = (st.data.players || []).length;
        out.push({ dot: 'up', text: n ? `online · ${n} ${n === 1 ? 'Spieler' : 'Spieler'}` : 'online' });
        if (st.data.map) out.push(String(st.data.map).slice(0, 30));
      } else if (st) out.push({ dot: 'off', text: 'Server aus' });
      out.push('Hub Link ' + hub.modVersion());
      return out;
    }
  } catch { /* Angaben sind nur Beiwerk */ }
  return [];
}
const cut = (s, n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Kacheln für einen Besucher: ausgeblendete weg, „nur Mitglieder“ für Gäste mit Schloss (führt zur Anmeldung)
function forViewer(user, locals, { edit = false } = {}) {
  const hub = require('./hub');
  const programs = require('./programs'), PROG = { downloads: 'files', duden: 'duden', rezepte: 'rezepte' };
  return tiles().filter(t => edit || t.show !== 'off').flatMap(t => {
    let locked = t.show === 'members' && !user;
    // Bereiche, die unter Programme ausgeschaltet oder auf Mitglieder gestellt sind
    if (PROG[t.key]) {
      const st = programs.state(PROG[t.key]);
      if (st === 'off' && !(user && user.isAdmin)) return [];
      if (st === 'members' && !user) locked = true;
    }
    if (t.key === 'hub') {
      if (!hub.enabled() || (locals.navHidden || []).includes('farming')) return [];
      if (!hub.canView(user)) locked = true;
    }
    const m = meta(t.key, user).filter(Boolean).map(x => (typeof x === 'string' ? { text: cut(x) } : x));
    return [{ ...t, locked, href: locked ? '/login?next=' + encodeURIComponent(t.url) : t.url, meta: m }];
  });
}

// „Zuletzt neu“: Downloads, Duden, Rezepte und Blog gemischt
function recent(user, limit = 6) {
  const out = [];
  const add = (kind, label, list) => list.forEach(r => out.push({ ...r, kind, label }));
  try { add('dl', 'Download', require('./downloads').recent(user, limit)); } catch { /* leer */ }
  try { add('du', 'Duden', require('./duden').recent(user, limit)); } catch { /* leer */ }
  try { add('de', 'Rezept', require('./recipes').recent(user, limit)); } catch { /* leer */ }
  try { add('di', 'Diorama', require('./dioramen').recent(user, limit)); } catch { /* leer */ }
  try { add('blog', 'Beitrag', require('./duden').posts(user, limit).map(p => ({ title: p.title, url: '/duden/beitraege/' + p.slug, at: p.created_at }))); } catch { /* leer */ }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

// Suche über alle Bereiche (/finden): Downloads, Duden (mit Blog), Rezepte und die Programme des Desktops
function search(user, q, locals) {
  q = str(q, 100);
  if (!q) return [];
  const k = q.toLowerCase(), programs = require('./programs'), off = programs.off(locals);
  const progs = programs.flat(user).filter(p => !off[p.key] && !(locals.navHidden || []).includes(p.key) && p.name.toLowerCase().includes(k))
    .slice(0, 6).map(p => ({ kind: 'desk', icon: p.icon, title: p.name, text: 'Programm im Desktop' + (p.group ? ' · ' + p.group : ''), url: p.url }));
  let games = [];
  try { games = require('./daddelecke').search(user, q, locals); } catch { games = []; }
  return [...require('./downloads').search(user, q), ...require('./duden').search(user, q), ...require('./recipes').search(user, q), ...require('./dioramen').search(user, q), ...games, ...progs];
}

// Bearbeiten-Modus auf der Startseite (public/v3-edit.js, public/portal-edit.js): Begrüßung und Kacheln in einem Rutsch
function saveEdit(data) {
  const d = data && typeof data === 'object' ? data : {};
  if (typeof d.title === 'string') setSetting('portal_title', str(d.title, 80));
  if (typeof d.text === 'string') setSetting('portal_text', str(d.text, 300));
  if (Array.isArray(d.tiles)) save(d.tiles.map(t => ({ ...t, key: /^n[0-9a-z]+$/.test(String(t.key)) ? 'k' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10) : t.key })));
}
const hero = () => ({
  title: getSetting('portal_title', 'Willkommen bei Dancor'),
  text: getSetting('portal_text', 'Such dir einen Bereich aus. Der Retro-Desktop wartet hinter der ersten Kachel.'),
});

module.exports = { COLORS, SHOW, BUILTIN, tiles, save, saveEdit, normalize, forViewer, recent, search, hero, meta };
