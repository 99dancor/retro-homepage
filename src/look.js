'use strict';
// Update 100: Aussehen der modernen Seiten (Startseite, Downloads, Duden, Rezepte, Daddelecke, Dioramen, Fußseiten).
// Der Admin stellt alles in der Schublade „🎨 Aussehen der Seite“ ein (public/v3-look-edit.js), die Seite zeigt jede
// Änderung sofort. Gespeichert wird eine Einstellung „site_look“ (JSON). Daraus entsteht ein kleiner <style>-Block mit
// CSS-Variablen im Kopf jeder Seite (views/v3/_head.ejs). Der Desktop (/desktop) bleibt unberührt.
//
//   head:   Symbol (Emoji, Bild, Buchstaben, keins), Titel, Untertitel, Schrift, Farbe, Größe; Kopfleiste (Deckkraft, Scrollen, Suche)
//   bg:     Hintergrund je Bereich, hell und auf Wunsch dunkel getrennt; null = wie die Startseite
//   style:  Vorlage, Akzentfarbe, Ecken, Kachelstil, Abstände, Spalten, Schrift, Schriftgröße
//   extras: Begrüßung, Jahreszeiten-Deko, Hintergrund nach Tageszeit, Hinweis-Leiste, Schnellwahl, Fußzeile, Hintergrund der Mitglieder
//   images: Bildauswahl (hochgeladene Bilder unter /media), aus der Hintergründe, Symbol und Mitglieder wählen
const { db, getSetting, setSetting } = require('./db');

const BG_AREAS = {
  home: { icon: '🏠', name: 'Startseite' }, downloads: { icon: '📦', name: 'Downloads' }, duden: { icon: '📚', name: 'Duden' },
  rezepte: { icon: '🍝', name: 'Rezepte' }, spiele: { icon: '🕹️', name: 'Daddelecke' }, dioramen: { icon: '🏡', name: 'Dioramen' },
  footer: { icon: '📄', name: 'Fußseiten' },
};
const FONTS = {
  standard: { label: 'Standard', stack: '' },
  rund: { label: 'Rund', stack: '"Nunito", "Quicksand", "Varela Round", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif' },
  serif: { label: 'Serif', stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif' },
  xp: { label: 'XP', stack: 'Tahoma, Verdana, "Segoe UI", sans-serif' },
  retro: { label: 'Retro', stack: '"MS Sans Serif", "Microsoft Sans Serif", Tahoma, Geneva, sans-serif' },
  pixel: { label: 'Pixel', stack: '"Press Start 2P", "VT323", "Lucida Console", "Courier New", monospace' },
};
const ICON_COLORS = {
  blau: 'linear-gradient(180deg, #5fa3ff, #1d5fd1)', gruen: 'linear-gradient(180deg, #9cd14a, #3f7a1e)', rot: 'linear-gradient(180deg, #ff7a63, #d8432f)',
  lila: 'linear-gradient(180deg, #a98bff, #6b4fd6)', gelb: 'linear-gradient(180deg, #f2b33d, #cf8a0c)', tuerkis: 'linear-gradient(180deg, #14a3a3, #0b7676)',
  dunkel: 'linear-gradient(180deg, #2a3650, #14213d)', akzent: 'var(--accent)', keine: 'transparent',
};
const TITLE_COLORS = {
  auto: '', akzent: 'var(--accent)', wiese: 'linear-gradient(90deg, #3f7a1e, #8cc63f)', himmel: 'linear-gradient(90deg, #1d5fd1, #8f6bff)',
  feuer: 'linear-gradient(90deg, #d8432f, #f2a33d)', weiss: '#ffffff',
};
const PRESETS = {
  himmel: { label: 'Himmel', accent: '', radius: 16, tile: 'gloss', font: 'standard', grad: null, bar: '#1f62d6' },
  wiese: { label: 'Wiese', accent: '#2f8f3a', radius: 22, tile: 'gloss', font: 'standard', grad: { l: ['#cdeeb4', '#fff1b8'], d: ['#1e3a1a', '#3a3414'] }, bar: '#2f8f3a' },
  abendrot: { label: 'Abendrot', accent: '#d8432f', radius: 18, tile: 'gloss', font: 'standard', grad: { l: ['#ffd2b8', '#ffe7a8'], d: ['#4a2018', '#4a3414'] }, bar: '#d8432f' },
  winter: { label: 'Winter', accent: '#3f6f8f', radius: 14, tile: 'flat', font: 'standard', grad: { l: ['#dbe6f0', '#eef3f8'], d: ['#1c2836', '#232a33'] }, bar: '#47604f' },
  luna: { label: 'Luna (XP)', accent: '#245edb', radius: 8, tile: 'gloss', font: 'xp', grad: { l: ['#bcd4ff', '#cfe9c0'], d: ['#12285a', '#173a24'] }, bar: '#245edb' },
  klassik: { label: '98 Klassik', accent: '#000080', radius: 0, tile: 'flat', font: 'retro', grad: { l: ['#9fd3d3', '#d4d0c8'], d: ['#0a3a3a', '#2a2a2a'] }, bar: '#008080' },
};
const KINDS = ['gradient', 'color', 'image', 'slides'];
const SIZES = ['cover', 'contain', 'tile'];
const TILE_STYLES = ['gloss', 'flat', 'glass', 'outline'];
const GAPS = { eng: 10, normal: 16, luftig: 24 };
const COLS = ['2', '3', '4', 'auto'];
const SHAPES = ['quadrat', 'eckig', 'rund', 'kreis', 'frei'];
const ICON_KINDS = ['emoji', 'image', 'letters', 'none'];

const HEX = /^#[0-9a-f]{6}$/i;
const MEDIA = /^[a-f0-9]{32}\.(png|jpe?g|gif|webp|avif)$/;
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (list, v, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const hex = (v, d = '') => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
const img = v => (MEDIA.test(String(v || '')) ? String(v) : '');

const BG_DEFAULT = {
  kind: 'gradient', c1: '', c2: '', color: '', image: '', images: [], evening: '', night: '', fx: 50, fy: 50, size: 'cover', fixed: true,
  op: 100, blur: 0, bright: 0, sat: 100, veil: 0, veilColor: '', glass: 100, glassBlur: 10, interval: 30,
};
const DEFAULTS = {
  head: {
    icon: { kind: 'emoji', emoji: '🪟', image: '', letters: 'D', shape: 'eckig', size: 30, color: 'blau', favicon: false },
    title: '', sub: '', font: 'standard', tcolor: 'auto', tsize: 19, bar: 74, scroll: 'sticky', search: true,
  },
  style: { preset: 'himmel', accent: '', keepTiles: true, radius: 16, tile: 'gloss', gap: 'normal', cols: '3', font: 'standard', fsize: 100 },
  // Wie im Konzept beschlossen: alles an, nur Jahreszeiten-Deko aus (Diashow ist eine Art des Hintergrunds und erst da, wenn man sie wählt)
  extras: { greet: true, season: false, daytime: true, notice: { on: false, text: '', until: '', tone: 'info' }, quick: true, foot: '', memberBg: true },
  bg: { home: { light: BG_DEFAULT, dark: null } },
  images: [],
};

function cleanBg(b) {
  const d = BG_DEFAULT;
  if (!b || typeof b !== 'object') return { ...d, images: [] };
  return {
    kind: pick(KINDS, b.kind, d.kind), c1: hex(b.c1), c2: hex(b.c2), color: hex(b.color),
    image: img(b.image), images: (Array.isArray(b.images) ? b.images : []).map(img).filter(Boolean).slice(0, 12),
    evening: img(b.evening), night: img(b.night),
    fx: num(b.fx, 0, 100, 50), fy: num(b.fy, 0, 100, 50), size: pick(SIZES, b.size, 'cover'), fixed: bool(b.fixed, true),
    op: num(b.op, 0, 100, 100), blur: num(b.blur, 0, 30, 0), bright: num(b.bright, -60, 60, 0), sat: num(b.sat, 0, 200, 100),
    veil: num(b.veil, 0, 90, 0), veilColor: hex(b.veilColor), glass: num(b.glass, 20, 100, 100), glassBlur: num(b.glassBlur, 0, 30, 10),
    interval: num(b.interval, 5, 600, 30),
  };
}
function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const h = r.head || {}, ic = h.icon || {}, s = r.style || {}, e = r.extras || {}, n = e.notice || {};
  const D = DEFAULTS;
  const bg = {};
  for (const k of Object.keys(BG_AREAS)) {
    const a = r.bg && r.bg[k];
    if (k !== 'home' && !a) { bg[k] = null; continue; }
    bg[k] = { light: cleanBg(a && a.light), dark: a && a.dark ? cleanBg(a.dark) : null };
  }
  const known = new Set();
  const images = (Array.isArray(r.images) ? r.images : []).filter(i => i && img(i.f) && !known.has(i.f) && known.add(i.f))
    .map(i => ({ f: i.f, name: str(i.name, 80), w: num(i.w, 0, 20000, 0), h: num(i.h, 0, 20000, 0) })).slice(0, 60);
  return {
    head: {
      icon: {
        kind: pick(ICON_KINDS, ic.kind, D.head.icon.kind), emoji: [...str(ic.emoji, 16)].slice(0, 2).join('') || D.head.icon.emoji,
        image: img(ic.image), letters: str(ic.letters, 3) || 'D', shape: pick(SHAPES, ic.shape, 'eckig'), size: num(ic.size, 20, 56, 30),
        color: Object.hasOwn(ICON_COLORS, ic.color) ? ic.color : 'blau', favicon: bool(ic.favicon, false),
      },
      title: str(h.title, 40), sub: str(h.sub, 60), font: Object.hasOwn(FONTS, h.font) ? h.font : 'standard',
      tcolor: Object.hasOwn(TITLE_COLORS, h.tcolor) ? h.tcolor : 'auto', tsize: num(h.tsize, 14, 32, 19), bar: num(h.bar, 0, 100, 74),
      scroll: pick(['sticky', 'static', 'shrink'], h.scroll, 'sticky'), search: bool(h.search, true),
    },
    style: {
      preset: Object.hasOwn(PRESETS, s.preset) ? s.preset : 'eigen', accent: hex(s.accent), keepTiles: bool(s.keepTiles, true),
      radius: num(s.radius, 0, 28, 16), tile: pick(TILE_STYLES, s.tile, 'gloss'), gap: Object.hasOwn(GAPS, s.gap) ? s.gap : 'normal',
      cols: pick(COLS, String(s.cols), '3'), font: Object.hasOwn(FONTS, s.font) && s.font !== 'pixel' ? s.font : 'standard', fsize: num(s.fsize, 85, 130, 100),
    },
    extras: {
      greet: bool(e.greet, D.extras.greet), season: bool(e.season, false), daytime: bool(e.daytime, D.extras.daytime),
      notice: { on: bool(n.on, false), text: str(n.text, 200), until: /^\d{4}-\d{2}-\d{2}$/.test(String(n.until || '')) ? n.until : '', tone: pick(['info', 'warn', 'ok'], n.tone, 'info') },
      quick: bool(e.quick, D.extras.quick), foot: str(e.foot, 120), memberBg: bool(e.memberBg, D.extras.memberBg),
    },
    bg, images,
    custom: (Array.isArray(r.custom) ? r.custom : []).filter(c => c && str(c.name, 30)).slice(0, 8).map(c => {
      const cs = c.style || {};
      return { name: str(c.name, 30), style: {
        preset: Object.hasOwn(PRESETS, cs.preset) ? cs.preset : 'himmel', accent: hex(cs.accent), keepTiles: bool(cs.keepTiles, true), radius: num(cs.radius, 0, 28, 16),
        tile: pick(TILE_STYLES, cs.tile, 'gloss'), gap: Object.hasOwn(GAPS, cs.gap) ? cs.gap : 'normal', cols: pick(COLS, String(cs.cols), '3'),
        font: Object.hasOwn(FONTS, cs.font) && cs.font !== 'pixel' ? cs.font : 'standard', fsize: num(cs.fsize, 85, 130, 100) } };
    }),
  };
}
function raw0() { try { return JSON.parse(getSetting('site_look', 'null')); } catch { return null; } }

let cache = null;
function get() {
  if (!cache) {
    const raw = raw0();
    cache = normalize(raw || { style: { preset: 'himmel' } });
    if (!raw) cache.style.preset = 'himmel';
  }
  return cache;
}
function save(data, user) {
  const old = get();
  const next = normalize({ ...data, images: data && Array.isArray(data.images) ? data.images : old.images });
  // Bilder nur aus der eigenen Bildauswahl
  const lib = new Set(next.images.map(i => i.f));
  const keep = f => (lib.has(f) ? f : '');
  for (const a of Object.values(next.bg)) for (const b of a ? [a.light, a.dark].filter(Boolean) : []) {
    b.image = keep(b.image); b.evening = keep(b.evening); b.night = keep(b.night); b.images = b.images.filter(f => lib.has(f));
  }
  next.head.icon.image = keep(next.head.icon.image);
  setSetting('site_look', JSON.stringify(next));
  if (next.head.title) setSetting('portal_name', next.head.title);
  cache = null;
  if (user) require('./events').info('Aussehen', `${user.name || 'Admin'} hat das Aussehen der Seite geändert.`);
  return get();
}
function addImage(f, name, w, h) {
  const l = get();
  if (!img(f)) return l;
  const images = [{ f, name: str(name, 80), w: num(w, 0, 20000, 0), h: num(h, 0, 20000, 0) }, ...l.images.filter(i => i.f !== f)].slice(0, 60);
  setSetting('site_look', JSON.stringify({ ...l, images }));
  cache = null;
  return get();
}
function removeImage(f) {
  const l = get();
  const images = l.images.filter(i => i.f !== f);
  setSetting('site_look', JSON.stringify({ ...l, images }));
  cache = null;
  return get();
}

// Welcher Hintergrund-Bereich gilt für eine Seite: Bereich der Kopfleiste, die Startseite, sonst die Fußseiten
function areaOf(area, path) {
  if (area && Object.hasOwn(BG_AREAS, area) && area !== 'footer') return area;
  if (path === '/' || path === '') return 'home';
  return 'footer';
}
// Hintergrund-Einstellung, die für einen Bereich gilt (geerbt von der Startseite, wenn er keinen eigenen hat)
const bgFor = (l, area) => l.bg[area] || l.bg.home;

// ---------- CSS ----------
const url = f => `url("/media/${f}")`;
const pct = n => n + '%';
const fontStack = k => (FONTS[k] && FONTS[k].stack) || '';
function bgVars(b, grad) {
  const v = [];
  const c1 = b.c1 || (grad && grad[0]), c2 = b.c2 || (grad && grad[1]);
  if (c1) v.push(`--bg-glow-1:${c1}`);
  if (c2) v.push(`--bg-glow-2:${c2}`);
  const first = b.kind === 'slides' ? b.images[0] || b.image : b.kind === 'image' ? b.image : '';
  if (b.kind === 'color' && b.color) v.push(`--lk-img:linear-gradient(${b.color}, ${b.color})`);
  if (first) {
    v.push(`--lk-img:${url(first)}`, `--lk-pos:${b.fx}% ${b.fy}%`);
    v.push(`--lk-size:${b.size === 'tile' ? 'auto' : b.size}`, `--lk-rep:${b.size === 'tile' ? 'repeat' : 'no-repeat'}`);
    if (b.kind === 'image' && b.evening) v.push(`--lk-img-e:${url(b.evening)}`);
    if (b.kind === 'image' && b.night) v.push(`--lk-img-n:${url(b.night)}`);
    if (b.kind === 'slides' && b.images.length > 1) v.push(`--lk-slides:"${b.images.join(' ')}"`, `--lk-int:${b.interval}`);
    if (!b.fixed) v.push('--lk-attach:absolute');
  }
  if (first || (b.kind === 'color' && b.color)) {
    if (b.op !== 100) v.push(`--lk-op:${b.op / 100}`);
    if (b.blur) v.push(`--lk-blur:${b.blur}px`);
    if (b.bright) v.push(`--lk-bright:${(100 + b.bright) / 100}`);
    if (b.sat !== 100) v.push(`--lk-sat:${b.sat / 100}`);
    if (b.veil) v.push(`--lk-veil:color-mix(in srgb, ${b.veilColor || 'var(--bg)'} ${b.veil}%, transparent)`);
  }
  if (b.glass < 100) {
    const g = `color-mix(in srgb, var(--surface) ${pct(b.glass)}, transparent)`;
    v.push(`--lk-card:${g}`, `--lk-hero-bg:${g}`, '--lk-hero-pad:20px 24px', '--lk-hero-mt:24px', '--lk-hero-bd:1px solid color-mix(in srgb, var(--line) 70%, transparent)');
    if (b.glassBlur) v.push(`--lk-bf:blur(${b.glassBlur}px)`);
    v.push('--lk-halo:0 0 2px var(--bg), 0 0 10px var(--bg), 0 0 18px var(--bg)');
  }
  return v;
}
const DARK_GLOW = ['#17305a', '#173a24'];
const RESET = ['--lk-img', '--lk-img-e', '--lk-img-n', '--lk-slides', '--lk-int', '--lk-op', '--lk-blur', '--lk-bright', '--lk-sat', '--lk-veil',
  '--lk-card', '--lk-bf', '--lk-hero-bd', '--lk-hero-bg', '--lk-hero-pad', '--lk-hero-mt', '--lk-halo', '--lk-attach', '--lk-pos', '--lk-size', '--lk-rep'].map(v => v + ':initial');
const DARK = sel => [`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) :is(${sel}) {`, '} }', `:root[data-theme="dark"] :is(${sel}) {`, '}'];

function css(l) {
  const out = [];
  const st = l.style, hd = l.head, pre = PRESETS[st.preset];
  const grad = pre && pre.grad;
  // Akzentfarbe: alles Abgeleitete per color-mix, damit hell und dunkel passen
  if (st.accent) {
    out.push(`html:root:root{--accent:${st.accent};--accent-2:color-mix(in srgb, ${st.accent} 72%, #fff);--accent-line:color-mix(in srgb, ${st.accent} 80%, #000);`
      + `--accent-soft:color-mix(in srgb, ${st.accent} 14%, var(--surface));--accent-soft-line:color-mix(in srgb, ${st.accent} 38%, var(--surface));`
      + `--heading:color-mix(in srgb, ${st.accent} 55%, var(--text));}`);
  }
  const body = [];
  if (st.radius !== 16) body.push(`--radius:${st.radius}px`, `--lk-r:${st.radius}px`);
  if (st.gap !== 'normal') body.push(`--lk-gap:${GAPS[st.gap]}px`);
  if (fontStack(st.font)) body.push(`--font:${fontStack(st.font)}`, `--font-display:${fontStack(st.font)}`);
  if (st.fsize !== 100) body.push(`--lk-zoom:${st.fsize / 100}`);
  if (hd.bar !== 74) body.push(`--lk-barbg:color-mix(in srgb, var(--surface) ${hd.bar}%, transparent)`);
  if (!st.keepTiles) body.push(`--lk-tilebg:linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, #fff), var(--accent))`);
  // Symbol und Titel
  const ic = hd.icon;
  body.push(`--lk-mk:${ic.size}px`, `--lk-mkr:${{ quadrat: '0', eckig: Math.round(ic.size * 0.27) + 'px', rund: Math.round(ic.size * 0.4) + 'px', kreis: '50%', frei: '0' }[ic.shape]}`);
  body.push(`--lk-mkbg:${ic.shape === 'frei' ? 'transparent' : ICON_COLORS[ic.color]}`);
  if (hd.tsize !== 19) body.push(`--lk-tsize:${hd.tsize}px`);
  if (fontStack(hd.font)) body.push(`--lk-tfont:${fontStack(hd.font)}`);
  const tc = TITLE_COLORS[hd.tcolor];
  if (tc && tc.startsWith('linear')) body.push(`--lk-tgrad:${tc}`);
  else if (tc) body.push(`--lk-tcol:${tc}`);
  out.push(`body.v3{${body.join(';')}}`);

  // Hintergründe: jede eigene Einstellung für ihre Bereiche, die übrigen erben von der Startseite
  const groups = {};
  for (const k of Object.keys(BG_AREAS)) {
    const src = l.bg[k] ? k : 'home';
    (groups[src] = groups[src] || []).push(k);
  }
  for (const [src, areas] of Object.entries(groups)) {
    const a = l.bg[src], sel = areas.map(k => `body.v3.lk-a-${k}`).join(', ');
    const lv = bgVars(a.light, grad && grad.l);
    if (lv.length) out.push(`${sel}{${lv.join(';')}}`);
    // Dunkel: eigene Werte (vorher alles Helle zurücksetzen) oder dieselben mit dunklen Verlaufsfarben
    let dv;
    if (a.dark) dv = RESET.concat(bgVars(a.dark, (grad && grad.d) || DARK_GLOW));
    else {
      dv = [];
      const lc = [a.light.c1, a.light.c2];
      if (lc[0] || lc[1] || grad) {
        const g = lc.map((c, i) => (c ? `color-mix(in srgb, ${c} 28%, #0f1522)` : grad ? grad.d[i] : DARK_GLOW[i]));
        dv.push(`--bg-glow-1:${g[0]}`, `--bg-glow-2:${g[1]}`);
      }
    }
    if (dv.length) { const d = DARK(sel); out.push(d[0] + dv.join(';') + d[1], d[2] + dv.join(';') + d[3]); }
  }
  return out.join('\n');
}

// ---------- Für die Seite ----------
const TZ = () => process.env.TZ || 'Europe/Berlin';
function hourNow() { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ() }).format(new Date())) % 24 || 0; }
function greeting(user, h = hourNow()) {
  const [e, t] = h >= 5 && h < 11 ? ['☀️', 'Guten Morgen'] : h >= 11 && h < 17 ? ['👋', 'Hallo'] : h >= 17 && h < 22 ? ['🌆', 'Guten Abend'] : ['🌙', 'Gute Nacht'];
  return { emoji: e, text: user ? `${t}, ${user.name}` : t === 'Hallo' ? 'Hallo!' : t + '!' };
}
function noticeActive(n) {
  if (!n.on || !n.text) return false;
  if (!n.until) return true;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ() });
  return today <= n.until;
}
// Bild, das sich ein Mitglied als Hintergrund ausgesucht hat (nur aus der Bildauswahl, nur wenn erlaubt)
function memberBg(user, l = get()) {
  if (!user || !l.extras.memberBg) return '';
  try {
    const mine = require('./usersettings').get(user.id, 'look');
    return mine.bg && l.images.some(i => i.f === mine.bg) ? mine.bg : '';
  } catch { return ''; }
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

// Werte für views/v3/_head.ejs und _foot.ejs
function forPage(user, area, path) {
  const l = get();
  const a = areaOf(area, path);
  const mine = memberBg(user, l);
  let style = css(l);
  if (mine) {
    const ag = bgFor(l, a).light.glass;
    const g = ag < 100 ? ag : 80;
    style += `\nhtml:root body.v3.lk-mine.lk-mine{--lk-img:${url(mine)};--lk-img-e:initial;--lk-img-n:initial;--lk-slides:initial;--lk-pos:50% 50%;--lk-size:cover;--lk-rep:no-repeat;`
      + `--lk-op:1;--lk-card:color-mix(in srgb, var(--surface) ${g}%, transparent);--lk-bf:blur(10px);--lk-hero-bg:color-mix(in srgb, var(--surface) ${g}%, transparent);--lk-hero-pad:20px 24px;--lk-hero-mt:24px;--lk-hero-bd:1px solid color-mix(in srgb, var(--line) 70%, transparent);`
      + '--lk-halo:0 0 2px var(--bg), 0 0 10px var(--bg), 0 0 18px var(--bg)}';
  }
  const st = l.style, hd = l.head;
  const cls = [`lk-a-${a}`, `lk-tile-${st.tile}`, `lk-cols-${st.cols}`, `lk-bar-${hd.scroll}`];
  if (!hd.search) cls.push('lk-nosearch');
  if (mine) cls.push('lk-mine');
  if (!st.keepTiles) cls.push('lk-onecolor');
  if ((TITLE_COLORS[hd.tcolor] || '').startsWith('linear')) cls.push('lk-tgrad');
  if (l.extras.daytime) cls.push('lk-daytime');
  const n = l.extras.notice;
  const icon = hd.icon;
  return {
    siteLook: l, lookArea: a, lookCss: style, lookClass: cls.join(' '),
    lookHead: {
      kind: icon.kind, emoji: icon.emoji, image: icon.image ? '/media/' + icon.image : '', letters: icon.letters,
      title: hd.title || getSetting('portal_name', 'dancor.org'), sub: hd.sub,
    },
    lookFavicon: icon.favicon && icon.kind !== 'none' ? (icon.kind === 'image' && icon.image ? '/media/' + icon.image : '/aussehen/symbol.svg?v=' + hash(icon.kind + icon.emoji + icon.letters + icon.color + icon.shape)) : '',
    lookNotice: noticeActive(n) ? { text: n.text, tone: n.tone, id: hash(n.text + n.until) } : null,
    lookFoot: l.extras.foot, lookQuick: l.extras.quick, lookSeason: l.extras.season ? season() : '',
    lookMine: mine, lookMemberBg: !!(user && l.extras.memberBg && l.images.length),
  };
}
// Jahreszeiten-Deko: Schnee im Dezember und Januar, Laub im Oktober und November, Konfetti an Silvester und Neujahr
function season(d = new Date()) {
  const md = d.toLocaleDateString('sv-SE', { timeZone: TZ() }).slice(5);
  if (md === '12-31' || md === '01-01') return 'konfetti';
  const m = Number(md.slice(0, 2));
  if (m === 12 || m === 1) return 'schnee';
  if (m === 10 || m === 11) return 'laub';
  if (m === 4 && Number(md.slice(3)) <= 21) return 'blueten';
  return '';
}

// Browser-Symbol aus Emoji oder Buchstaben (das hochgeladene Bild wird direkt genommen)
function symbolSvg(l = get()) {
  const ic = l.head.icon;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const g = (ICON_COLORS[ic.color] || '').match(/#[0-9a-f]{6}/gi) || [];
  const r = { quadrat: 0, eckig: 14, rund: 20, kreis: 32, frei: 0 }[ic.shape];
  const fill = ic.shape === 'frei' || ic.color === 'keine' ? 'none' : g.length ? 'url(#g)' : (getAccent(l) || '#1f62d6');
  const txt = ic.kind === 'letters' ? `<text x="32" y="43" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${ic.letters.length > 2 ? 22 : 30}" fill="#fff">${esc(ic.letters)}</text>`
    : `<text x="32" y="45" text-anchor="middle" font-size="${ic.shape === 'frei' ? 52 : 36}">${esc(ic.emoji)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${g.length ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g[0]}"/><stop offset="1" stop-color="${g[1] || g[0]}"/></linearGradient></defs>` : ''}`
    + `<rect width="64" height="64" rx="${r}" fill="${fill}"/>${txt}</svg>`;
}
const getAccent = l => l.style.accent;

// Für die Schublade: alles, was sie zum Zeichnen braucht
function editorData() {
  return {
    look: get(), areas: BG_AREAS, presets: PRESETS, fonts: Object.fromEntries(Object.entries(FONTS).map(([k, f]) => [k, f.label])),
    iconColors: ICON_COLORS, titleColors: TITLE_COLORS, bgDefault: BG_DEFAULT, siteName: getSetting('portal_name', 'dancor.org'),
    navAreas: require('./v3').AREAS, seasonNow: season(),
  };
}
// Bild aus der Bildauswahl noch irgendwo in Gebrauch?
function imageUsed(f, l = get()) {
  if (l.head.icon.image === f) return true;
  return Object.values(l.bg).some(a => a && [a.light, a.dark].filter(Boolean).some(b => b.image === f || b.evening === f || b.night === f || b.images.includes(f)));
}
const mediaExists = f => !!db.prepare('SELECT 1 FROM media WHERE stored_name = ?').get(f);

module.exports = {
  BG_AREAS, FONTS, PRESETS, ICON_COLORS, TITLE_COLORS, BG_DEFAULT, DEFAULTS, normalize, get, save, addImage, removeImage, areaOf, bgFor,
  css, forPage, greeting, season, symbolSvg, editorData, imageUsed, mediaExists, noticeActive, memberBg,
};
