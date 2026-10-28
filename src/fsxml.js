'use strict';
// Kleiner, nachsichtiger XML-Leser für die Feeds des Farming-Simulator-Servers (src/fsfeeds.js). Die Dateien sind
// schlicht (Elemente, Attribute, etwas Text), aber nicht immer sauber: In Mod-Titeln steht schon mal ein rohes „&“
// oder ein doppelt maskiertes „&amp;#93;“. Statt abzubrechen liest er weiter und lässt Unverständliches stehen.
// Ergebnis: { n: Name, a: { Attribute }, c: [ Kinder ], t: Text }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf('&') < 0) return s;
  const once = v => v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return Object.hasOwn(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
  const r = once(s);
  // „&amp;#93;“ wird beim ersten Mal zu „&#93;“: Zahlen-Entitäten noch einmal auflösen
  return /&#x?[0-9a-f]+;/i.test(r) ? r.replace(/&#(x[0-9a-f]+|\d+);/gi, m => once(m)) : r;
}

function parse(src) {
  src = String(src || '').replace(/^﻿/, '');
  const root = { n: '#root', a: {}, c: [], t: '' };
  const stack = [root];
  const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.t += decode(src.slice(i)); break; }
    if (lt > i) top.t += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); top.t += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const gt = src.indexOf('>', lt);
    if (gt < 0) break;
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      // Schließt bis zum passenden Element; ein verirrtes Ende-Tag ohne Anfang wird übergangen
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].n === name) { stack.length = k; break; }
      continue;
    }
    const selfClose = tag.endsWith('/');
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = body.match(/^\s*([^\s/>]+)/);
    if (!m) { top.t += decode('<' + tag + '>'); continue; }
    const el = { n: m[1], a: {}, c: [], t: '' };
    ATTR.lastIndex = m[0].length;
    let am;
    while ((am = ATTR.exec(body))) el.a[am[1]] = decode(am[3] ?? am[4] ?? am[5] ?? '');
    top.c.push(el);
    if (!selfClose) stack.push(el);
  }
  for (const el of walk(root)) el.t = el.t.trim();
  return root.c.find(c => c.n !== '#text') || root;
}

// Alle Elemente unter el (el eingeschlossen), Tiefe zuerst
function* walk(el) {
  yield el;
  for (const c of el.c) yield* walk(c);
}
const kids = (el, name) => (el ? el.c.filter(c => c.n === name) : []);
const kid = (el, name) => (el ? el.c.find(c => c.n === name) || null : null);
const all = (el, name) => (el ? [...walk(el)].filter(c => c.n === name) : []);
// Text eines Unterelements über einen Pfad: text(save, 'settings', 'timeScale')
function text(el, ...names) {
  for (const nm of names) el = kid(el, nm);
  return el ? el.t : null;
}
const num = (v, d = null) => {
  const x = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(x) ? d : x;
};

module.exports = { parse, decode, walk, kids, kid, all, text, num };
