'use strict';
// Farming Simulator Hub: was auf den Feldern steht, je Fleck statt je Feld, aus den Dichtekarten des Spielstands (per FTP).
//
//   densityMap_fruits.gdm      Bereich 0: welche Frucht, Bereich 1: Wachstumsstufe (halber Meter je Pixel)
//   densityMap_ground.gdm      Bodenart (Bits 0–3): gepflügt, gegrubbert, gesät, erntereif, Gras … 0 = kein Feldboden
//   infoLayer_limeLevel.grle   Kalk 0–3 (0 = Kalk nötig)         infoLayer_sprayLevel.grle  Dünger 0–2
//   infoLayer_plowLevel.grle   Pflug 0/1 (0 = Pflügen fällig)
//
// Daraus werden durchsichtige Bilder über der Karte, eins je Eintrag der Legende (eine Frucht, ein Zustand, eine Pflege),
// damit sich jeder Eintrag einzeln ein- und ausblenden lässt. Dazu je Grundstück, was wie viel Fläche hat (Grundstückskarte
// aus der Mod „Farming Hub Export“). Welche Zahl in der Dichtekarte welche Frucht ist, sagt die Mod (ab Version 2); sonst
// lernt der Hub es aus fields.xml: Die Zahl, die auf einem Feld mit Weizen am häufigsten vorkommt, ist Weizen.
// Ergebnis und Bilder liegen im Datenordner und werden nur neu gerechnet, wenn sich eine Datei ändert.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// ---------- Dateiformate ----------
// GDM („"MDF“): Kopf mit Größe, Kanälen und Bereichen, danach 32 × 32-Kacheln, je Bereich mit Palette und Bits.
// Gibt die Werte der gewünschten Bereiche zurück (Zeile für Zeile), mit step > 1 nur jedes step-te Pixel (kleinere Bilder).
function readGdm(buf, region = 0, step = 1) {
  const r = readGdmRegions(buf, [region], step);
  return { size: r.size, data: r.data[0], channels: r.channels, bounds: r.bounds };
}
function readGdmRegions(buf, wanted, step = 1) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== '"MDF') throw new Error('Keine GDM-Datei');
  const dimLog = buf[8], chunkLog = buf[9], channels = buf[11], regions = buf[12];
  const bounds = [...buf.subarray(13, 13 + regions - 1)];
  for (const w of wanted) if (w >= regions) throw new Error('Bereich fehlt');
  const full = 1 << (dimLog + chunkLog), cs = 1 << chunkLog, n = full / cs;
  const size = Math.floor(full / step);
  const out = wanted.map(() => new Uint16Array(size * size));
  const slot = new Map(wanted.map((w, i) => [w, i]));
  let p = 16 + (regions - 1);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      for (let r = 0; r < regions; r++) {
        if (p + 2 > buf.length) throw new Error('GDM-Datei ist abgeschnitten');
        const bits = buf[p], pal = buf[p + 1];
        p += 2;
        const palette = pal ? Array.from({ length: pal }, (_, i) => buf.readUInt16LE(p + i * 2)) : null;
        p += pal * 2;
        const nb = bits * cs * cs / 8;
        const k = slot.get(r);
        if (k !== undefined) {
          const o = out[k];
          if (!bits) {
            const v = palette ? palette[0] : 0;
            for (let y = 0; y < cs; y++) {
              const gy = cy * cs + y;
              if (gy % step) continue;
              const row = (gy / step) * size;
              for (let x = 0; x < cs; x += 1) { const gx = cx * cs + x; if (!(gx % step)) o[row + gx / step] = v; }
            }
          } else {
            const mask = (1 << bits) - 1;
            let acc = 0, nacc = 0, q = p;
            for (let i = 0; i < cs * cs; i++) {
              while (nacc < bits) { acc |= buf[q++] << nacc; nacc += 8; }
              const idx = acc & mask;
              acc >>>= bits;
              nacc -= bits;
              const gy = cy * cs + (i >> chunkLog), gx = cx * cs + (i & (cs - 1));
              if (gy % step || gx % step) continue;
              o[(gy / step) * size + gx / step] = palette ? (palette[idx] ?? 0) : idx;
            }
          }
        }
        p += nb;
      }
    }
  }
  if (p > buf.length) throw new Error('GDM-Datei ist abgeschnitten');
  return { size, full, data: out, channels, bounds };
}
// GRLE: Kopf mit Breite und Höhe (in 256ern), danach Lauflängen: ein Byte, folgt dasselbe noch einmal, kommt ein Zähler
// (0xFF heißt +255 und weiter) für weitere Kopien.
function readGrle(buf) {
  if (buf.length < 21 || buf.toString('latin1', 0, 4) !== 'GRLE') throw new Error('Keine GRLE-Datei');
  const w = buf.readUInt16LE(6) * 256, h = buf.readUInt16LE(10) * 256, len = buf.readUInt32LE(17);
  const d = buf.subarray(21, 21 + len), out = new Uint8Array(w * h);
  let i = 0, o = 0;
  while (i < d.length && o < out.length) {
    const v = d[i++];
    out[o++] = v;
    if (i < d.length && d[i] === v) {
      i++;
      let cnt = 0;
      while (i < d.length && d[i] === 0xff) { cnt += 255; i++; }
      cnt += d[i++] ?? 0;
      out.fill(v, o, Math.min(out.length, o + cnt + 1));
      o += cnt + 1;
    }
  }
  return { w, h, data: out };
}

// ---------- PNG (Palette, eine Farbe je Wert, 0 durchsichtig) ----------
function png(w, h, pixels, colors) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const pal = Buffer.alloc(3 * (colors.length + 1)), trns = Buffer.alloc(colors.length + 1, 255);
  trns[0] = 0;
  colors.forEach((c, i) => { const v = parseInt(c.slice(1), 16); pal[3 * (i + 1)] = v >> 16; pal[3 * (i + 1) + 1] = (v >> 8) & 255; pal[3 * (i + 1) + 2] = v & 255; });
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(pixels.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', pal), chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Umrisse (für die Grundstückskarte, src/fsexport.js) ----------
// Umriss einer Fläche: Kanten zwischen innen und außen sammeln, zu Ringen verketten, den größten nehmen
function outline(lab, m, l, box) {
  const next = new Map();
  const add = (x0, y0, x1, y1) => { const k = y0 * (m + 1) + x0; (next.get(k) || next.set(k, []).get(k)).push(y1 * (m + 1) + x1); };
  const at = (x, y) => x >= 0 && y >= 0 && x < m && y < m && lab[y * m + x] === l;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  let best = null, bestArea = 0;
  for (const [start] of next) {
    if (!next.get(start).length) continue;
    const ring = [];
    let k = start;
    while (next.get(k) && next.get(k).length) {
      ring.push(k);
      k = next.get(k).pop();
    }
    if (ring.length < 4) continue;
    const pts = ring.map(v => [v % (m + 1), Math.floor(v / (m + 1))]);
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = pts; }
  }
  return best;
}
// Douglas-Peucker für einen geschlossenen Ring, geteilt an der Ecke, die am weitesten vom Anfang weg ist
function simplify(pts, eps) {
  if (pts.length < 8) return pts;
  let mid = 0, md = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; mid = i; } }
  const ring = pts.concat([pts[0]]), out = [];
  const dp = (a, b) => {
    let far = -1, fd = eps;
    const [ax, ay] = ring[a], [bx, by] = ring[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((ring[i][0] - ax) * dy - (ring[i][1] - ay) * dx) / len; if (d > fd) { fd = d; far = i; } }
    if (far < 0) { out.push(ring[a]); return; }
    dp(a, far); dp(far, b);
  };
  dp(0, mid);
  dp(mid, ring.length - 1);
  return out;
}
// Douglas-Peucker für einen offenen Linienzug (Anfang und Ende bleiben)
function simplifyLine(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, fd = eps;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// Umrisse vieler Flächen auf einmal begradigen, so dass gemeinsame Grenzen bei beiden Nachbarn dieselben Punkte bekommen.
// rings: Map id → Ring aus Pixelecken (wie outline). Jeder Ring wird an den Ecken geteilt, an denen der Nachbar wechselt;
// jedes Grenzstück wird einmal in fester Richtung vereinfacht und von beiden Seiten benutzt.
function simplifyShared(lab, m, rings, eps) {
  const W = m + 1, at = (x, y) => (x >= 0 && y >= 0 && x < m && y < m ? lab[y * m + x] : 0);
  // Nachbar jenseits der Kante p → q (Ring läuft im Uhrzeigersinn in Bildkoordinaten, innen rechts)
  const across = (p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    return dx > 0 ? at(p[0], p[1] - 1) : dy > 0 ? at(p[0], p[1]) : dx < 0 ? at(p[0] - 1, p[1]) : at(p[0] - 1, p[1] - 1);
  };
  const done = new Map(), out = new Map();
  for (const [id, ring] of rings) {
    const n = ring.length, side = ring.map((p, i) => across(p, ring[(i + 1) % n]));
    const cuts = [];
    for (let i = 0; i < n; i++) if (side[i] !== side[(i + n - 1) % n]) cuts.push(i);
    if (cuts.length < 2) { out.set(id, simplify(ring, eps)); continue; }
    const res = [];
    for (let c = 0; c < cuts.length; c++) {
      const a = cuts[c], b = cuts[(c + 1) % cuts.length], piece = [];
      for (let i = a; ; i = (i + 1) % n) { piece.push(ring[i]); if (i === b) break; }
      const ka = ring[a][1] * W + ring[a][0], kb = ring[b][1] * W + ring[b][0];
      const fwd = ka < kb || (ka === kb && id < side[a]);
      const key = (fwd ? ka + ':' + kb : kb + ':' + ka) + ':' + Math.min(id, side[a]) + ':' + Math.max(id, side[a]) + ':' + piece.length;
      let line = done.get(key);
      if (!line) { line = simplifyLine(fwd ? piece : piece.slice().reverse(), eps); done.set(key, line); }
      const use = fwd ? line : line.slice().reverse();
      for (let i = 0; i < use.length - 1; i++) res.push(use[i]);
    }
    out.set(id, res.length >= 3 ? res : simplify(ring, eps));
  }
  return out;
}
// Platz für die Nummer: Mitte der breitesten Strecke im Inneren, über einige waagerechte Linien gesucht (liegt sicher im Vieleck)
function labelPoint(pts) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  let best = null, bw = -1;
  for (let k = 1; k < 12; k++) {
    const y = y0 + (y1 - y0) * k / 12, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    // Mitte der Höhe bevorzugt, damit die Nummer nicht am Rand klebt
    for (let i = 0; i + 1 < xs.length; i += 2) { const w = (xs[i + 1] - xs[i]) * (1 - Math.abs(k - 6) / 12); if (w > bw) { bw = w; best = [(xs[i] + xs[i + 1]) / 2, y]; } }
  }
  return best || pts[0];
}
// Vieleck in Weltkoordinaten → SVG-Pfad im Kartenmaß 0–1000
function polyPath(pts, mapSize) {
  const k = 1000 / mapSize, h = mapSize / 2;
  return 'M' + pts.map(([x, z]) => `${+((x + h) * k).toFixed(1)} ${+((z + h) * k).toFixed(1)}`).join('L') + 'Z';
}

// ---------- Was wo wächst ----------
// Bodenart (densityMap_ground, Bits 0–3) → Zustand wie in der Legende „Wachstum“
const GROUND_STATE = [null, 'gegrubbert', 'gegrubbert', 'gegrubbert', 'gepfluegt', 'gegrubbert', 'gegrubbert', 'gesaet', 'gesaet', 'gesaet', 'gesaet', 'gesaet', 'reif', 'reif', 'gras', 'gemaeht'];
const STATE_KEYS = ['gepfluegt', 'gegrubbert', 'gesaet', 'waechst', 'reif', 'geerntet', 'verdorrt', 'gras', 'gemaeht'];
// Pflege je Fleck: Wert aus der Ebene → Nummer der Farbe (0 = nichts zu tun)
const CARE = {
  kalk: { file: 'infoLayer_limeLevel.grle', colors: ['#e0c52c'], value: v => (v === 0 ? 1 : 0) },
  duenger: { file: 'infoLayer_sprayLevel.grle', colors: ['#7db8f2', '#1f4fb8'], value: v => (v >= 2 ? 2 : v === 1 ? 1 : 0) },
  pflug: { file: 'infoLayer_plowLevel.grle', colors: ['#c8693a'], value: v => (v === 0 ? 1 : 0) },
};
const FILES = ['densityMap_fruits.gdm', 'densityMap_ground.gdm', ...Object.values(CARE).map(c => c.file)];

// Welche Zahl in der Dichtekarte welche Frucht ist: aus der Mod, sonst aus fields.xml gelernt (häufigste Zahl je Feld).
// fruits: [{ name, density }], fields: [{ id, fruit }] aus fields.xml, polys: { feldId: [[x, z], …] } aus dem Export.
function fruitValues(fruitIdx, size, mapSize, fruits, fields, polys) {
  const game = new Map();
  for (const f of fruits) if (Number.isInteger(f.density) && f.density > 0) game.set(f.density, f.name);
  const learned = learnValues(fruitIdx, size, mapSize, fields, polys);
  // Die Zahlen der Mod gelten, solange fields.xml ihnen nicht überwiegend widerspricht (andere Spielversion, andere Zählung)
  if (game.size) {
    const checked = [...learned];
    const wrong = checked.filter(([v, name]) => game.get(v) !== name).length;
    if (!checked.length || wrong * 2 <= checked.length) return { map: game, learned: false };
  }
  return { map: learned, learned: true };
}
function learnValues(fruitIdx, size, mapSize, fields, polys) {
  const map = new Map();
  const votes = new Map();
  for (const f of fields || []) {
    const pts = polys[f.id];
    if (!f.fruit || !pts || pts.length < 3) continue;
    const count = new Map();
    let all = 0;
    forPixelsIn(pts, size, mapSize, i => { const v = fruitIdx[i]; if (v) { count.set(v, (count.get(v) || 0) + 1); all++; } });
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < all * 0.5) continue;
    const v = votes.get(top[0]) || new Map();
    v.set(f.fruit, (v.get(f.fruit) || 0) + top[1]);
    votes.set(top[0], v);
  }
  for (const [value, v] of votes) map.set(value, [...v].sort((a, b) => b[1] - a[1])[0][0]);
  return map;
}
// Alle Pixel (Raster size × size über die ganze Karte) innerhalb eines Vielecks in Weltkoordinaten, Zeile für Zeile
function forPixelsIn(pts, size, mapSize, fn) {
  const k = size / mapSize, h = mapSize / 2;
  const P = pts.map(([x, z]) => [(x + h) * k, (z + h) * k]);
  const y0 = Math.max(0, Math.floor(Math.min(...P.map(p => p[1])))), y1 = Math.min(size - 1, Math.ceil(Math.max(...P.map(p => p[1]))));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5, xs = [];
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + (cy - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      for (let x = Math.max(0, Math.ceil(xs[j] - 0.5)); x <= Math.min(size - 1, Math.floor(xs[j + 1] - 0.5)); x++) fn(y * size + x);
    }
  }
}

// Wachstumsstufe → Zustand, wenn die Mod die Stufen der Frucht kennt (sonst nur die Bodenart)
function growthState(fruit, g, ground) {
  if (fruit && g) {
    if (fruit.cut && g === fruit.cut) return 'geerntet';
    if (fruit.withered && g === fruit.withered) return 'verdorrt';
    if (fruit.harvestMin && g >= fruit.harvestMin && (!fruit.harvestMax || g <= fruit.harvestMax)) return 'reif';
    if (fruit.harvestMin && g < fruit.harvestMin) return g >= 2 ? 'waechst' : 'gesaet';
  }
  const s = GROUND_STATE[ground & 15];
  return s === 'gesaet' && g >= 2 ? 'waechst' : s;
}

// Rechnet alles: Bilder je Legendeneintrag nach dir/ras-*.png, Flächen je Grundstück und je Eintrag.
// ctx: { mapSize, fruits: [{ name, density, cut, withered, harvestMin, harvestMax }], fields (fields.xml), polys, grid: { size, lab } }
function build(dir, ctx) {
  const mapSize = ctx.mapSize || 2048;
  const fruitsBuf = fs.readFileSync(path.join(dir, 'sg-densityMap_fruits.gdm'));
  const groundFile = path.join(dir, 'sg-densityMap_ground.gdm');
  // Halbe Auflösung bei 4096er Karten: ein Pixel je Meter reicht und spart Speicher
  const head = 1 << (fruitsBuf[8] + fruitsBuf[9]);
  const step = Math.max(1, Math.round(head / Math.min(head, 2048)));
  const fr = readGdmRegions(fruitsBuf, [0, 1], step);
  const R = fr.size, fruitIdx = fr.data[0], growth = fr.data[1];
  let ground = null;
  if (fs.existsSync(groundFile)) {
    const gb = fs.readFileSync(groundFile), gfull = 1 << (gb[8] + gb[9]);
    const g = readGdm(gb, 0, Math.max(1, Math.round(gfull / R)));
    if (g.size === R) ground = g.data;
  }
  const care = {};
  for (const [k, c] of Object.entries(CARE)) {
    const f = path.join(dir, 'sg-' + c.file);
    if (fs.existsSync(f)) { try { care[k] = readGrle(fs.readFileSync(f)); } catch (e) { console.error('Farming Hub, Ebene', k, e.message); } }
  }
  const { map: values, learned } = fruitValues(fruitIdx, R, mapSize, ctx.fruits || [], ctx.fields || [], ctx.polys || {});
  const byName = new Map((ctx.fruits || []).map(f => [f.name, f]));
  const grid = ctx.grid && ctx.grid.lab ? ctx.grid : null;
  const pxHa = (mapSize / R) ** 2 / 10000;

  // Je Pixel: Nummer der Frucht (1…), des Zustands (1…) und je Pflege der Farbe
  const fruitNames = [], fruitNo = new Map();
  const fruitOf = v => {
    // Zahlen ohne bekannte Frucht sind Bewuchs und Deko der Karte (Wiesen, Büsche): gehören nicht auf die Karte
    const name = v && values.get(v);
    if (!name) return 0;
    if (!fruitNo.has(name)) { fruitNames.push(name); fruitNo.set(name, fruitNames.length); }
    return fruitNo.get(name);
  };
  const fPix = new Uint8Array(R * R), sPix = new Uint8Array(R * R), cPix = Object.fromEntries(Object.keys(care).map(k => [k, new Uint8Array(R * R)]));
  const parcels = {};
  const totals = { fruits: {}, states: {}, care: {} };
  const put = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const i = y * R + x;
      const gt = ground ? ground[i] & 15 : 0, fv = fruitIdx[i];
      if (!gt && !fv) continue;
      const no = fruitOf(fv);
      const name = no ? fruitNames[no - 1] : null;
      const state = growthState(name && byName.get(name), fv ? growth[i] : 0, gt);
      fPix[i] = no;
      if (state) sPix[i] = STATE_KEYS.indexOf(state) + 1;
      const pid = grid ? grid.lab[Math.floor(y * grid.size / R) * grid.size + Math.floor(x * grid.size / R)] : 0;
      const pc = pid ? (parcels[pid] = parcels[pid] || { px: 0, fruits: {}, states: {}, care: {} }) : null;
      if (pc) pc.px++;
      if (name) { put(totals.fruits, name); if (pc) put(pc.fruits, name); }
      if (state) { put(totals.states, state); if (pc) put(pc.states, state); }
      // Pflege nur auf Ackerboden, nicht auf Grünland
      if (gt && gt < 14) {
        for (const [k, g] of Object.entries(care)) {
          const v = CARE[k].value(g.data[Math.floor(y * g.h / R) * g.w + Math.floor(x * g.w / R)]);
          if (!v) continue;
          cPix[k][i] = v;
          const key = k === 'duenger' ? (v === 1 ? 'duenger1' : 'duenger2') : k;
          put(totals.care, key);
          if (pc) put(pc.care, key);
        }
      }
    }
  }
  // Bilder: eins je Frucht, Zustand und Pflege, jedes nur so groß wie seine Flecken (boxes: Lage im Kartenmaß 0–1000).
  // Kleine Bilder statt vieler kartengroßer halten die Karte beim Zoomen und Verschieben flüssig. Alte Bilder weg.
  for (const f of fs.readdirSync(dir)) if (/^ras-.*\.png$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const boxes = {};
  const write = (file, pix, keep, colors) => {
    let x0 = R, y0 = R, x1 = -1, y1 = -1;
    for (let y = 0; y < R; y++) {
      const row = y * R;
      for (let x = 0; x < R; x++) {
        if (!keep(pix[row + x])) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return false;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = pix[(y + y0) * R + x + x0]; out[y * w + x] = keep(v) ? (colors.length > 1 ? v : 1) : 0; }
    fs.writeFileSync(path.join(dir, file), png(w, h, out, colors));
    const k = 1000 / R;
    boxes[file] = [+(x0 * k).toFixed(2), +(y0 * k).toFixed(2), +(w * k).toFixed(2), +(h * k).toFixed(2)];
    return true;
  };
  const slug = s => String(s).replace(/[^A-Za-z0-9_]/g, '_');
  const images = { fruits: {}, states: {}, care: {} };
  fruitNames.forEach((name, i) => {
    const file = `ras-f-${slug(name)}.png`;
    if (write(file, fPix, v => v === i + 1, [ctx.colorOf ? ctx.colorOf(name) : '#8fd16a'])) images.fruits[name] = file;
  });
  STATE_KEYS.forEach((k, i) => {
    if (!totals.states[k]) return;
    const file = `ras-s-${k}.png`;
    if (write(file, sPix, v => v === i + 1, [ctx.stateColor ? ctx.stateColor(k) : '#5aa83c'])) images.states[k] = file;
  });
  for (const k of Object.keys(care)) {
    if (k === 'duenger') {
      // Dünger: einmal und zweimal gedüngt als eigene Einträge
      for (const lvl of [1, 2]) {
        if (!totals.care['duenger' + lvl]) continue;
        const file = `ras-c-duenger${lvl}.png`;
        if (write(file, cPix[k], v => v === lvl, [CARE.duenger.colors[lvl - 1]])) images.care['duenger' + lvl] = file;
      }
    } else if (totals.care[k]) {
      const file = `ras-c-${k}.png`;
      if (write(file, cPix[k], v => v > 0, CARE[k].colors)) images.care[k] = file;
    }
  }
  // Pixel → Hektar
  const ha = o => Object.fromEntries(Object.entries(o).map(([k, n]) => [k, Math.round(n * pxHa * 100) / 100]));
  for (const p of Object.values(parcels)) { p.ha = Math.round(p.px * pxHa * 100) / 100; delete p.px; p.fruits = ha(p.fruits); p.states = ha(p.states); p.care = ha(p.care); }
  return { size: R, learned, values: Object.fromEntries(values), images, boxes, totals: { fruits: ha(totals.fruits), states: ha(totals.states), care: ha(totals.care) }, parcels };
}

// ---------- Zwischenspeicher ----------
// files: { name: { sig } } aus dem FTP-Stand. Ohne densityMap_fruits.gdm gibt es nichts je Fleck (null).
let mem = null;
function signature(files, extra) {
  const h = crypto.createHash('sha1');
  h.update(String(extra || ''));
  for (const n of FILES) h.update(n + '=' + ((files[n] && files[n].sig) || '-') + ';');
  return h.digest('hex').slice(0, 16);
}
function load(dir, files, ctx) {
  if (!files['densityMap_fruits.gdm'] || !fs.existsSync(path.join(dir, 'sg-densityMap_fruits.gdm'))) return null;
  const sig = signature(files, ctx.sig);
  if (mem && mem.sig === sig) return mem;
  const store = path.join(dir, 'patches.json');
  try {
    const saved = JSON.parse(fs.readFileSync(store, 'utf8'));
    if (saved.sig === sig && saved.boxes && Object.values(saved.images || {}).every(g => Object.values(g).every(f => fs.existsSync(path.join(dir, f))))) { mem = saved; return mem; }
  } catch { /* noch nichts gerechnet */ }
  try {
    const t = Date.now();
    mem = { sig, at: Math.floor(Date.now() / 1000), ...build(dir, ctx), ms: Date.now() - t };
  } catch (e) {
    console.error('Farming Hub, Dichtekarten:', e.message);
    mem = { sig, at: Math.floor(Date.now() / 1000), images: { fruits: {}, states: {}, care: {} }, totals: { fruits: {}, states: {}, care: {} }, parcels: {}, error: e.message };
  }
  fs.writeFileSync(store, JSON.stringify(mem));
  return mem;
}
function forget() { mem = null; }

module.exports = { readGdm, readGdmRegions, readGrle, png, outline, simplify, simplifyLine, simplifyShared, labelPoint, polyPath, forPixelsIn, fruitValues, growthState, build, load, forget, signature, FILES, CARE, STATE_KEYS, GROUND_STATE };
