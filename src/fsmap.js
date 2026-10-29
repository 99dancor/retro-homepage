'use strict';
// Farming Simulator Hub: echte Feldformen und Boden-Ebenen aus den Dichtekarten des Spielstands (per FTP abgeholt).
//
//   densityMap_ground.gdm      Bodenart je halben Meter (Bits 0–3, 0 = kein Feldboden) → Umriss jedes Felds
//   infoLayer_limeLevel.grle   Kalk 0–3 (0 = Kalk nötig)         infoLayer_sprayLevel.grle  Dünger 0–2
//   infoLayer_plowLevel.grle   Pflug 0/1 (0 = Pflügen fällig)
//
// Ablauf: Bodenart auf halbe Auflösung (2 × 2 Pixel, nur wenn alle vier Feldboden sind, damit schmale Lücken zwischen
// Feldern bleiben), dann wächst jedes Feld von seiner Mitte aus dem Stats-Feed über zusammenhängenden Feldboden. Stoßen
// zwei Felder ohne Lücke aneinander, teilen sie sich die Fläche nach Abstand. Aus jeder Fläche wird ein vereinfachter
// Umriss im Koordinatensystem der Karte (0–1000). Liegt die Mitte nicht auf Feldboden (noch nicht bestellt) oder passt
// die Fläche nicht zur Größe des Grundstücks, bleibt das Feld ein Kreis. Kennt der Hub die Feldumrisse aus der Karte (src/fsfields.js), nimmt er für jedes Feld dessen Vieleck, auch
// ohne Feldboden (noch nicht bestellte Felder). Ergebnis und Ebenen-Bilder liegen im Datenordner und werden nur neu
// gerechnet, wenn sich etwas ändert.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const fsfields = require('./fsfields');

// ---------- Dateiformate ----------
// GDM („"MDF“): Kopf mit Größe, Kanälen und Bereichen, danach 32 × 32-Kacheln, je Bereich mit Palette und Bits.
// Gibt die Werte eines Bereichs als Uint16Array zurück (Zeile für Zeile, size × size).
function readGdm(buf, region = 0) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== '"MDF') throw new Error('Keine GDM-Datei');
  const dimLog = buf[8], chunkLog = buf[9], channels = buf[11], regions = buf[12];
  const bounds = [...buf.subarray(13, 13 + regions - 1)];
  if (region >= regions) throw new Error('Bereich fehlt');
  const size = 1 << (dimLog + chunkLog), cs = 1 << chunkLog, n = size / cs;
  const out = new Uint16Array(size * size);
  let p = 16 + (regions - 1);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      for (let r = 0; r < regions; r++) {
        const bits = buf[p], pal = buf[p + 1];
        p += 2;
        const palette = pal ? Array.from({ length: pal }, (_, i) => buf.readUInt16LE(p + i * 2)) : null;
        p += pal * 2;
        const nb = bits * cs * cs / 8;
        if (r === region) {
          const base = cy * cs * size + cx * cs;
          if (!bits) {
            const v = palette ? palette[0] : 0;
            for (let y = 0; y < cs; y++) out.fill(v, base + y * size, base + y * size + cs);
          } else {
            const mask = (1 << bits) - 1;
            let acc = 0, nacc = 0, q = p;
            for (let i = 0; i < cs * cs; i++) {
              while (nacc < bits) { acc |= buf[q++] << nacc; nacc += 8; }
              const idx = acc & mask;
              acc >>>= bits;
              nacc -= bits;
              out[base + (i >> chunkLog) * size + (i & (cs - 1))] = palette ? (palette[idx] ?? 0) : idx;
            }
          }
        }
        p += nb;
      }
    }
  }
  if (p > buf.length) throw new Error('GDM-Datei ist abgeschnitten');
  return { size, data: out, channels, bounds };
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
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Felder ----------
// Feldboden auf halber Auflösung: eine Zelle zählt nur, wenn alle vier Pixel Feldboden sind
function fieldMask(ground) {
  const n = ground.size, m = n >> 1, g = ground.data, mask = new Uint8Array(m * m);
  for (let y = 0; y < m; y++) {
    const r0 = 2 * y * n, r1 = r0 + n;
    for (let x = 0; x < m; x++) {
      const a = 2 * x;
      if ((g[r0 + a] & 15) && (g[r0 + a + 1] & 15) && (g[r1 + a] & 15) && (g[r1 + a + 1] & 15)) mask[y * m + x] = 1;
    }
  }
  return { size: m, data: mask };
}
// Jedes Feld wächst gleichzeitig von seiner Mitte aus (Breitensuche), so teilen sich aneinanderstoßende Felder die Fläche.
// seeds: [{ id, gx, gy }] in Zellen. Ergebnis: Nummer des Felds je Zelle (Index in seeds + 1).
function grow(mask, seeds, searchCells) {
  const m = mask.size, md = mask.data, lab = new Uint16Array(m * m), q = new Int32Array(m * m);
  let head = 0, tail = 0;
  seeds.forEach((s, i) => {
    let best = -1, bd = Infinity;
    const cx = Math.round(s.gx), cy = Math.round(s.gy);
    for (let dy = -searchCells; dy <= searchCells; dy++) {
      for (let dx = -searchCells; dx <= searchCells; dx++) {
        const x = cx + dx, y = cy + dy, d = dx * dx + dy * dy;
        if (x < 0 || y < 0 || x >= m || y >= m || d >= bd || !md[y * m + x] || lab[y * m + x]) continue;
        best = y * m + x; bd = d;
      }
    }
    if (best >= 0) { lab[best] = i + 1; q[tail++] = best; }
  });
  while (head < tail) {
    const c = q[head++], x = c % m, l = lab[c];
    if (x > 0 && md[c - 1] && !lab[c - 1]) { lab[c - 1] = l; q[tail++] = c - 1; }
    if (x < m - 1 && md[c + 1] && !lab[c + 1]) { lab[c + 1] = l; q[tail++] = c + 1; }
    if (c >= m && md[c - m] && !lab[c - m]) { lab[c - m] = l; q[tail++] = c - m; }
    if (c < m * (m - 1) && md[c + m] && !lab[c + m]) { lab[c + m] = l; q[tail++] = c + m; }
  }
  return lab;
}
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

// fields: [{ id, x, z, area (ha) }], mapSize in Metern. Gibt { [id]: { d, cx, cy, ha } } im Kartenmaß 0–1000 zurück.
function buildShapes(groundBuf, fields, mapSize) {
  const ground = readGdm(groundBuf, 0);
  const mask = fieldMask(ground);
  const m = mask.size, cell = mapSize / m, k = 1000 / m;
  const seeds = fields.filter(f => Number.isFinite(f.x) && Number.isFinite(f.z)).map(f => ({ ...f, gx: (f.x + mapSize / 2) / cell, gy: (f.z + mapSize / 2) / cell }));
  // Die Mitte muss auf Feldboden liegen (bis 4 m daneben): sonst ist das Feld noch nicht bestellt und bliebe nicht leer,
  // sondern bekäme ein Stück vom Nachbarfeld
  const lab = grow(mask, seeds, Math.max(1, Math.ceil(4 / cell)));
  // Ausdehnung und Größe je Feld
  const box = seeds.map(() => ({ x0: m, y0: m, x1: -1, y1: -1, n: 0, sx: 0, sy: 0 }));
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      const l = lab[y * m + x];
      if (!l) continue;
      const b = box[l - 1];
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      b.n++; b.sx += x; b.sy += y;
    }
  }
  const out = {};
  seeds.forEach((s, i) => {
    const b = box[i];
    if (!b.n) return;
    const ha = b.n * cell * cell / 10000;
    // Viel größer als das Grundstück: ist in Nachbarflächen gelaufen, lieber Kreis
    if (s.area > 0 && (ha > s.area * 1.6 + 0.3)) return;
    // Viel kleiner als das Grundstück: nur ein Rest am Rand, lieber Kreis
    if (ha < 0.05 || (s.area > 0 && ha < s.area * 0.25)) return;
    const ring = outline(lab, m, i + 1, b);
    if (!ring) return;
    const pts = simplify(ring, 0.9);
    out[s.id] = {
      d: 'M' + pts.map(([x, y]) => `${+(x * k).toFixed(1)} ${+(y * k).toFixed(1)}`).join('L') + 'Z',
      cx: +((b.sx / b.n + 0.5) * k).toFixed(1), cy: +((b.sy / b.n + 0.5) * k).toFixed(1), ha: Math.round(ha * 100) / 100,
    };
  });
  return { shapes: out, lab, size: m, seeds };
}

// Ebenen-Bild in 1024 × 1024 (oder kleiner bei kleinen Karten): nur Zellen, die zu einem bekannten Feld gehören
const LAYERS = {
  kalk: { file: 'infoLayer_limeLevel.grle', colors: ['#e0c52c'], value: v => (v === 0 ? 1 : 0) },
  duenger: { file: 'infoLayer_sprayLevel.grle', colors: ['#4b97ec', '#1f4fb8'], value: v => (v >= 2 ? 2 : v === 1 ? 1 : 0) },
  pflug: { file: 'infoLayer_plowLevel.grle', colors: ['#c8693a'], value: v => (v === 0 ? 1 : 0) },
};
function layerPng(key, grleBuf, lab, m) {
  const L = LAYERS[key], g = readGrle(grleBuf);
  const r = Math.min(1024, m), px = new Uint8Array(r * r);
  for (let y = 0; y < r; y++) {
    const ly = Math.floor((y + 0.5) * m / r), gy = Math.floor((y + 0.5) * g.h / r);
    for (let x = 0; x < r; x++) {
      if (!lab[ly * m + Math.floor((x + 0.5) * m / r)]) continue;
      px[y * r + x] = L.value(g.data[gy * g.w + Math.floor((x + 0.5) * g.w / r)]);
    }
  }
  return png(r, r, px, L.colors);
}

// ---------- Zwischenspeicher ----------
// dir: Datenordner des Hubs. files: { name: { sig } } aus dem FTP-Stand, fields und mapSize aus dem Modell.
let mem = null;
function signature(files, fields, mapSize, outlines) {
  const h = crypto.createHash('sha1');
  h.update(String(mapSize) + ';' + ((outlines && outlines.sig) || '-'));
  for (const n of ['densityMap_ground.gdm', ...Object.values(LAYERS).map(l => l.file)]) h.update(n + '=' + ((files[n] && files[n].sig) || '-') + ';');
  for (const f of fields) h.update(`${f.id}:${Math.round(f.x)}:${Math.round(f.z)}${f.parcel ? "p" : ""};`);
  return h.digest('hex').slice(0, 16);
}
// outlines: { sig, polys } aus der Karte oder null. own: { sig, polys: { id: [[x, z], …] } } aus fs_outlines (gehen vor).
function load(dir, files, fields, mapSize, outlines = null, own = null) {
  const ground = !!files['densityMap_ground.gdm'] && fs.existsSync(path.join(dir, 'sg-densityMap_ground.gdm'));
  const polys = outlines && outlines.polys && outlines.polys.length ? outlines.polys : null;
  const mine = own && own.polys && Object.keys(own.polys).length ? own : null;
  if ((!ground && !polys && !mine) || !fields.length) return null;
  const sig = signature(ground ? files : {}, fields, mapSize, { sig: ((polys && outlines.sig) || '-') + '/' + ((mine && mine.sig) || '-') });
  if (mem && mem.sig === sig) return mem;
  const store = path.join(dir, 'shapes.json');
  try {
    const saved = JSON.parse(fs.readFileSync(store, 'utf8'));
    if (saved.sig === sig) { mem = saved; return mem; }
  } catch { /* noch nichts gerechnet */ }
  try {
    const t = Date.now();
    // Grundstücke ohne Feld haben keinen Feldboden und kein Feld-Vieleck, dort fände die Suche nur den Nachbarn
    const real = fields.filter(f => !f.parcel);
    const r = ground ? buildShapes(fs.readFileSync(path.join(dir, 'sg-densityMap_ground.gdm')), real, mapSize) : { shapes: {} };
    const exact = polys ? fsfields.matchFields(polys, real, mapSize) : {};
    const shapes = {};
    for (const [id, s] of Object.entries(r.shapes)) shapes[id] = { ...s, src: 'boden' };
    for (const [id, s] of Object.entries(exact)) shapes[id] = { ...s, src: 'karte' };
    const ids = new Set(fields.map(f => String(f.id)));
    for (const [id, pts] of Object.entries((mine && mine.polys) || {})) if (ids.has(String(id)) && pts.pts.length >= 3) shapes[id] = { ...fsfields.polyShape(pts.pts, mapSize), src: pts.source };
    const layers = [];
    for (const [key, L] of Object.entries(LAYERS)) {
      const file = path.join(dir, 'sg-' + L.file);
      if (!ground || !files[L.file] || !fs.existsSync(file)) { fs.rmSync(path.join(dir, `layer-${key}.png`), { force: true }); continue; }
      try { fs.writeFileSync(path.join(dir, `layer-${key}.png`), layerPng(key, fs.readFileSync(file), r.lab, r.size)); layers.push(key); } catch (e) { console.error('Farming Hub, Ebene', key, e.message); }
    }
    mem = { sig, at: Math.floor(Date.now() / 1000), ms: Date.now() - t, shapes, layers, exact: Object.keys(exact).length };
    fs.writeFileSync(store, JSON.stringify(mem));
    return mem;
  } catch (e) {
    console.error('Farming Hub, Feldformen:', e.message);
    mem = { sig, at: Math.floor(Date.now() / 1000), shapes: {}, layers: [], error: e.message };
    return mem;
  }
}
function forget() { mem = null; }

module.exports = { readGdm, readGrle, png, fieldMask, grow, outline, simplify, buildShapes, layerPng, LAYERS, load, forget, signature };
