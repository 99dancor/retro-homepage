'use strict';
// Farming Simulator Hub: Feldumrisse aus der Karte selbst (map.i3d der Karten-Mod). Dort steht jedes Feld als Vieleck,
// auch die, die noch kein Acker sind (im Spiel kaufbar, aber noch Wiese) und deshalb in densityMap_ground.gdm fehlen.
//
//   i3d: Szene als Baum von Knoten mit translation, rotation (Grad) und scale. Ein Feld ist ein Knoten mit dem Kind
//        „polygonPoints“, dessen Kinder „point1 … n“ die Ecken sind. Die Lage einer Ecke ergibt sich aus allen Eltern.
//   ZIP: Die Karten-Mod liegt gepackt im mods-Ordner und ist oft Hunderte MB groß. Darum liest der Hub erst das
//        Inhaltsverzeichnis am Ende der Datei und holt dann nur die eine i3d-Datei (src/fsfeeds.js, Teil-Downloads).
const zlib = require('node:zlib');

// ---------- i3d ----------
const vec = s => { const p = String(s || '').trim().split(/\s+/).map(Number); return p.length === 3 && p.every(Number.isFinite) ? p : null; };
const attr = (s, k) => { const m = new RegExp(`\\s${k}="([^"]*)"`).exec(s); return m ? m[1] : null; };
// Lage eines Knotens zu seinem Eltern als 3 × 4-Matrix (Zeilen: x, y, z), Drehung in der Reihenfolge X, Y, Z
function local(a) {
  const t = vec(attr(a, 'translation')) || [0, 0, 0], r = (vec(attr(a, 'rotation')) || [0, 0, 0]).map(v => v * Math.PI / 180), s = vec(attr(a, 'scale')) || [1, 1, 1];
  const [cx, cy, cz] = r.map(Math.cos), [sx, sy, sz] = r.map(Math.sin);
  // R = Rz · Ry · Rx
  const R = [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
  return [R[0] * s[0], R[1] * s[1], R[2] * s[2], t[0], R[3] * s[0], R[4] * s[1], R[5] * s[2], t[1], R[6] * s[0], R[7] * s[1], R[8] * s[2], t[2]];
}
function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
  }
  return o;
}
// Alle Felder einer i3d-Datei: [{ name, pts: [[x, z], …] }] in Weltkoordinaten (Mitte der Karte = 0, 0)
function i3dFields(xml) {
  const start = xml.indexOf('<Scene');
  if (start < 0) throw new Error('Keine i3d-Datei (keine <Scene>).');
  const end = xml.indexOf('</Scene>', start);
  const re = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g;
  re.lastIndex = start;
  re.exec(xml);   // <Scene> selbst
  const stack = [], out = [];
  let m;
  while ((m = re.exec(xml)) && (end < 0 || m.index < end)) {
    if (!m[2]) continue;   // Kommentar
    if (m[1]) { stack.pop(); continue; }
    const top = stack[stack.length - 1] || null;
    const node = { name: attr(m[3], 'name') || '', m: top ? mul(top.m, local(m[3])) : local(m[3]), up: top };
    if (top && top.name === 'polygonPoints' && top.field) top.field.pts.push([+node.m[3].toFixed(2), +node.m[11].toFixed(2)]);
    if (node.name === 'polygonPoints' && top) {
      node.field = { name: top.name, pts: [] };
      out.push(node.field);
    }
    if (!m[4]) stack.push(node);
  }
  return out.filter(f => f.pts.length >= 3);
}

// ---------- ZIP ----------
const u64 = (b, o) => Number(b.readBigUInt64LE(o));
// Inhaltsverzeichnis finden. tail: die letzten Bytes der Datei, ab Position tailStart. Gibt { offset, size } des
// Verzeichnisses zurück (Zip64 eingeschlossen).
function zipDirectory(tail, tailStart) {
  let e = -1;
  for (let i = tail.length - 22; i >= Math.max(0, tail.length - 22 - 65535); i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Kein ZIP-Inhaltsverzeichnis gefunden.');
  let size = tail.readUInt32LE(e + 12), offset = tail.readUInt32LE(e + 16);
  if (offset === 0xffffffff || size === 0xffffffff) {
    const l = e - 20;
    if (l < 0 || tail.readUInt32LE(l) !== 0x07064b50) throw new Error('Zip64-Verzeichnis fehlt.');
    const z = u64(tail, l + 8) - tailStart;
    if (z < 0 || tail.readUInt32LE(z) !== 0x06064b50) throw new Error('Zip64-Verzeichnis liegt zu weit vorne.');
    size = u64(tail, z + 40); offset = u64(tail, z + 48);
  }
  return { offset, size };
}
// Einträge des Verzeichnisses: [{ name, method, csize, size, offset }]
function zipEntries(dir) {
  const out = [];
  for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50;) {
    const n = dir.readUInt16LE(p + 28), x = dir.readUInt16LE(p + 30), c = dir.readUInt16LE(p + 32);
    const e = { name: dir.toString('utf8', p + 46, p + 46 + n).replace(/\\/g, '/'), method: dir.readUInt16LE(p + 10),
      csize: dir.readUInt32LE(p + 20), size: dir.readUInt32LE(p + 24), offset: dir.readUInt32LE(p + 42) };
    // Zip64: große Werte stehen im Zusatzfeld 0x0001, in dieser Reihenfolge
    for (let q = p + 46 + n; q + 4 <= p + 46 + n + x;) {
      const id = dir.readUInt16LE(q), len = dir.readUInt16LE(q + 2);
      if (id === 1) {
        let r = q + 4;
        if (e.size === 0xffffffff) { e.size = u64(dir, r); r += 8; }
        if (e.csize === 0xffffffff) { e.csize = u64(dir, r); r += 8; }
        if (e.offset === 0xffffffff) e.offset = u64(dir, r);
      }
      q += 4 + len;
    }
    out.push(e);
    p += 46 + n + x + c;
  }
  return out;
}
// Die i3d-Dateien, die am ehesten die Karte sind: größte zuerst, „map“ im Pfad bevorzugt
function mapCandidates(entries) {
  return entries.filter(e => /\.i3d$/i.test(e.name) && e.size > 0)
    .sort((a, b) => (/(^|\/)maps?\//i.test(b.name) - /(^|\/)maps?\//i.test(a.name)) || b.size - a.size).slice(0, 3);
}
// Inhalt eines Eintrags aus seinem lokalen Kopf und den gepackten Daten (local: Bytes ab entry.offset)
function zipData(local, entry) {
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt.');
  const at = 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const raw = local.subarray(at, at + entry.csize);
  if (raw.length < entry.csize) throw new Error('ZIP-Eintrag unvollständig.');
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) + 1024 });
  throw new Error('ZIP-Packart ' + entry.method + ' wird nicht unterstützt.');
}

// ---------- Felder auf der Karte ----------
const area = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function centroid(pts) {
  const a = area(pts);
  if (Math.abs(a) < 1e-6) return pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  let x = 0, z = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], k = p[0] * q[1] - q[0] * p[1]; x += (p[0] + q[0]) * k; z += (p[1] + q[1]) * k; }
  return [x / (6 * a), z / (6 * a)];
}
function inside(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// Jedem Feld aus dem Stats-Feed sein Vieleck zuordnen: das, in dem seine Mitte liegt, sonst das nächste (höchstens 40 m).
// Gibt { [id]: { d, cx, cy, ha, exact: true } } im Kartenmaß 0–1000 zurück.
function matchFields(polys, fields, mapSize) {
  const P = v => +((v + mapSize / 2) / mapSize * 1000).toFixed(1);
  const info = polys.map(p => ({ ...p, c: centroid(p.pts), ha: Math.abs(area(p.pts)) / 10000 }));
  const used = new Set(), out = {};
  const pick = (f, list) => {
    const hits = list.filter(p => !used.has(p) && inside(p.pts, f.x, f.z));
    if (hits.length) return hits.sort((a, b) => a.ha - b.ha)[0];
    let best = null, bd = 40;
    for (const p of list) { if (used.has(p)) continue; const d = Math.hypot(p.c[0] - f.x, p.c[1] - f.z); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  for (const f of fields) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) continue;
    const p = pick(f, info);
    if (!p) continue;
    used.add(p);
    out[f.id] = { d: 'M' + p.pts.map(([x, z]) => `${P(x)} ${P(z)}`).join('L') + 'Z', cx: P(p.c[0]), cy: P(p.c[1]), ha: Math.round(p.ha * 100) / 100, exact: true };
  }
  return out;
}

module.exports = { i3dFields, zipDirectory, zipEntries, mapCandidates, zipData, matchFields, centroid, inside };
