'use strict';
// Update 100: Aussehen der Seite (src/look.js): Werte bereinigen, CSS bauen, Begrüßung, Jahreszeit
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
const look = require('../src/look');

const IMG = '0123456789abcdef0123456789abcdef.jpg';

test('Vorgaben ändern nichts am bisherigen Aussehen', () => {
  const l = look.get();
  assert.equal(l.style.preset, 'himmel');
  const css = look.css(l);
  assert.doesNotMatch(css, /--accent|--lk-img|--lk-card|--bg-glow/);
});

test('normalize: nur erlaubte Werte, Zahlen in Grenzen, Bilder nur als Mediennamen', () => {
  const l = look.normalize({
    head: { icon: { kind: 'hack', size: 999, shape: 'x', color: 'lila', emoji: '🐾🐾🐾' }, title: 'a'.repeat(99), tcolor: '<b>', bar: -5 },
    style: { accent: 'red', radius: 99, tile: 'glass', cols: 7, font: 'pixel' },
    bg: { home: { light: { kind: 'image', image: '../../etc/passwd', op: 400, blur: -3, glass: 5, images: [IMG, 'x'] } }, spiele: { light: { kind: 'color', color: '#ABCDEF' } }, quatsch: {} },
    extras: { notice: { on: true, text: 'Hi', until: 'morgen', tone: 'rot' } },
  });
  assert.equal(l.head.icon.kind, 'emoji');
  assert.equal(l.head.icon.size, 56);
  assert.equal(l.head.icon.shape, 'eckig');
  assert.equal(l.head.icon.color, 'lila');
  assert.equal([...l.head.icon.emoji].length, 2);
  assert.equal(l.head.title.length, 40);
  assert.equal(l.head.tcolor, 'auto');
  assert.equal(l.head.bar, 0);
  assert.equal(l.style.accent, '');
  assert.equal(l.style.radius, 28);
  assert.equal(l.style.cols, '3');
  assert.equal(l.style.font, 'standard', 'Pixel nur für den Titel');
  const b = l.bg.home.light;
  assert.equal(b.image, '');
  assert.deepEqual(b.images, [IMG]);
  assert.equal(b.op, 100); assert.equal(b.blur, 0); assert.equal(b.glass, 20);
  assert.equal(l.bg.spiele.light.color, '#abcdef');
  assert.equal(l.bg.duden, null, 'ohne eigenen Hintergrund: wie Startseite');
  assert.ok(!('quatsch' in l.bg));
  assert.deepEqual(l.extras.notice, { on: true, text: 'Hi', until: '', tone: 'info' });
});

test('css: Bereiche erben von der Startseite, dunkel eigen oder mit dunklen Verlaufsfarben', () => {
  const l = look.normalize({
    style: { preset: 'wiese', accent: '#2f8f3a', radius: 0, gap: 'luftig', fsize: 110 },
    bg: { home: { light: { kind: 'image', image: IMG, glass: 70, glassBlur: 8, veil: 20, bright: -10 } }, spiele: { light: { kind: 'color', color: '#112233' }, dark: { kind: 'gradient' } } },
  });
  const css = look.css(l);
  assert.match(css, /html:root:root\{--accent:#2f8f3a;/);
  assert.match(css, /--radius:0px/);
  assert.match(css, /--lk-gap:24px/);
  assert.match(css, /--lk-zoom:1\.1/);
  assert.match(css, /body\.v3\.lk-a-home, body\.v3\.lk-a-downloads, body\.v3\.lk-a-duden, body\.v3\.lk-a-rezepte, body\.v3\.lk-a-dioramen, body\.v3\.lk-a-footer\{/);
  assert.match(css, new RegExp(`--lk-img:url\\("/media/${IMG}"\\)`));
  assert.match(css, /--lk-card:color-mix\(in srgb, var\(--surface\) 70%, transparent\)/);
  assert.match(css, /--lk-bf:blur\(8px\)/);
  assert.match(css, /--lk-bright:0\.9/);
  assert.match(css, /--lk-veil:color-mix\(in srgb, var\(--bg\) 20%, transparent\)/);
  assert.match(css, /body\.v3\.lk-a-spiele\{--bg-glow-1:#cdeeb4;--bg-glow-2:#fff1b8;--lk-img:linear-gradient\(#112233, #112233\)/);
  assert.match(css, /:root\[data-theme="dark"\] :is\(body\.v3\.lk-a-spiele\) \{--lk-img:initial;[^}]*--bg-glow-1:#1e3a1a/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) :is\(body\.v3\.lk-a-home/);
  assert.doesNotMatch(css, /<\//);
});

test('css: Abend- und Nachtbild, Diashow', () => {
  const l = look.normalize({ bg: { home: { light: { kind: 'image', image: IMG, evening: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', night: '' } }, dioramen: { light: { kind: 'slides', images: [IMG, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp'], interval: 12 } } } });
  const css = look.css(l);
  assert.match(css, /--lk-img-e:url\("\/media\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\.png"\)/);
  assert.doesNotMatch(css, /--lk-img-n/);
  assert.match(css, /--lk-slides:"0123456789abcdef0123456789abcdef\.jpg bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\.webp";--lk-int:12/);
});

test('Bereich einer Seite, Begrüßung, Jahreszeit, Hinweis mit Ablauf', () => {
  assert.equal(look.areaOf('spiele', '/spiele'), 'spiele');
  assert.equal(look.areaOf('', '/'), 'home');
  assert.equal(look.areaOf('', '/changelog'), 'footer');
  assert.equal(look.areaOf('quatsch', '/x'), 'footer');
  assert.deepEqual(look.greeting({ name: 'Dancor' }, 7), { emoji: '☀️', text: 'Guten Morgen, Dancor' });
  assert.deepEqual(look.greeting(null, 13), { emoji: '👋', text: 'Hallo!' });
  assert.deepEqual(look.greeting(null, 23), { emoji: '🌙', text: 'Gute Nacht!' });
  assert.equal(look.season(new Date('2026-12-10T12:00:00Z')), 'schnee');
  assert.equal(look.season(new Date('2026-12-31T12:00:00Z')), 'konfetti');
  assert.equal(look.season(new Date('2026-10-10T12:00:00Z')), 'laub');
  assert.equal(look.season(new Date('2026-07-10T12:00:00Z')), '');
  assert.equal(look.noticeActive({ on: true, text: 'x', until: '2000-01-01' }), false);
  assert.equal(look.noticeActive({ on: true, text: 'x', until: '2999-01-01' }), true);
  assert.equal(look.noticeActive({ on: true, text: '', until: '' }), false);
});

test('Browser-Symbol aus Buchstaben ist maskiert', () => {
  const l = look.normalize({ head: { icon: { kind: 'letters', letters: '<&"', shape: 'kreis', color: 'gruen' } } });
  const svg = look.symbolSvg(l);
  assert.match(svg, /&lt;&amp;&quot;<\/text>/);
  assert.match(svg, /rx="32"/);
  assert.match(svg, /stop-color="#9cd14a"/);
});

test('Speichern nimmt nur Bilder aus der eigenen Bildauswahl', () => {
  look.addImage(IMG, 'Wiese', 1600, 900);
  const l = look.save({ ...look.get(), head: { ...look.get().head, title: 'Test', icon: { kind: 'image', image: 'cccccccccccccccccccccccccccccccc.png' } },
    bg: { home: { light: { kind: 'image', image: IMG, evening: 'dddddddddddddddddddddddddddddddd.png' } } } });
  assert.equal(l.bg.home.light.image, IMG);
  assert.equal(l.bg.home.light.evening, '');
  assert.equal(l.head.icon.image, '');
  assert.ok(look.imageUsed(IMG));
  assert.equal(require('../src/db').getSetting('portal_name'), 'Test');
});
