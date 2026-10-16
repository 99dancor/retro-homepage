'use strict';
// PNG lesen und schreiben ohne Zusatzpakete (zlib ist eingebaut), für die Bilder der Paint-Lobbys.
// Bilder sind wie in public/paint-core.js { w, h, d } mit RGBA-Bytes.
// Lesen kann es, was Browser beim Speichern erzeugen: 8 Bit je Kanal, Graustufen, RGB, Palette, mit oder ohne Alpha,
// ohne Zeilensprung (interlace). Alles andere gibt null.
const zlib = require('node:zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), t = Buffer.from(type, 'latin1');
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// Schreibt RGB, wenn alles deckend ist, sonst RGBA. Jede Zeile mit Filter „Sub“, das packt Gemaltes gut.
function encode(b) {
  let alpha = false;
  for (let i = 3; i < b.d.length; i += 4) if (b.d[i] !== 255) { alpha = true; break; }
  const ch = alpha ? 4 : 3, row = b.w * ch, raw = Buffer.alloc((row + 1) * b.h);
  for (let y = 0; y < b.h; y++) {
    const o = y * (row + 1);
    raw[o] = 1;
    for (let x = 0; x < b.w; x++) {
      const s = (y * b.w + x) * 4;
      for (let c = 0; c < ch; c++) {
        const v = b.d[s + c], left = x ? b.d[s + c - 4] : 0;
        raw[o + 1 + x * ch + c] = (v - left) & 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(b.w, 0); ihdr.writeUInt32BE(b.h, 4);
  ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
// maxPixels schützt vor Dateien, die beim Entpacken riesig werden
function decode(buf, maxPixels = 4000 * 4000) {
  if (!Buffer.isBuffer(buf) || buf.length < 45 || !buf.subarray(0, 8).equals(SIG)) return null;
  let i = 8, w = 0, h = 0, type = -1, palette = null, trns = null;
  const idat = [];
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i), t = buf.toString('latin1', i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (i + 12 + len > buf.length) return null;
    if (t === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || ![0, 2, 3, 4, 6].includes(type)) return null;
      if (!w || !h || w * h > maxPixels) return null;
    } else if (t === 'PLTE') palette = data;
    else if (t === 'tRNS') trns = data;
    else if (t === 'IDAT') idat.push(data);
    else if (t === 'IEND') break;
    i += 12 + len;
  }
  if (!w || !idat.length || (type === 3 && !palette)) return null;
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], row = w * ch;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (row + 1) * h + 1 }); } catch { return null; }
  if (raw.length < (row + 1) * h) return null;
  const out = { w, h, d: new Uint8ClampedArray(w * h * 4) }, cur = Buffer.alloc(row), prev = Buffer.alloc(row);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)], line = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1));
    if (f > 4) return null;
    for (let x = 0; x < row; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      cur[x] = (line[x] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      let r, g, bl, al = 255;
      if (type === 0) { r = g = bl = cur[s]; if (trns && trns.length >= 2 && trns.readUInt16BE(0) === cur[s]) al = 0; }
      else if (type === 4) { r = g = bl = cur[s]; al = cur[s + 1]; }
      else if (type === 2) { r = cur[s]; g = cur[s + 1]; bl = cur[s + 2]; if (trns && trns.length >= 6 && trns.readUInt16BE(0) === r && trns.readUInt16BE(2) === g && trns.readUInt16BE(4) === bl) al = 0; }
      else if (type === 6) { r = cur[s]; g = cur[s + 1]; bl = cur[s + 2]; al = cur[s + 3]; }
      else { const p = cur[s]; r = palette[p * 3] || 0; g = palette[p * 3 + 1] || 0; bl = palette[p * 3 + 2] || 0; if (trns && p < trns.length) al = trns[p]; }
      out.d[o] = r; out.d[o + 1] = g; out.d[o + 2] = bl; out.d[o + 3] = al;
    }
    cur.copy(prev);
  }
  return out;
}

// Vorschaubild höchstens 240 × 180: verkleinert wird mit Mittelwert, vergrößert mit ganzen Faktoren (bleibt pixelig)
function thumb(b, maxW = 240, maxH = 180) {
  let s = Math.min(maxW / b.w, maxH / b.h);
  if (s >= 1) s = Math.floor(s);
  const w = Math.max(1, Math.round(b.w * s)), h = Math.max(1, Math.round(b.h * s));
  const out = { w, h, d: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * b.h / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * b.h / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * b.w / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * b.w / w));
      let r = 0, g = 0, bl = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * b.w + xx) * 4; r += b.d[i]; g += b.d[i + 1]; bl += b.d[i + 2]; n++; }
      const o = (y * w + x) * 4;
      out.d[o] = r / n; out.d[o + 1] = g / n; out.d[o + 2] = bl / n; out.d[o + 3] = 255;
    }
  }
  return out;
}

module.exports = { encode, decode, thumb, crc32 };
