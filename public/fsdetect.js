// Farming Simulator Hub: Felder im Kartenbild erkennen (für Karten, deren Feldumrisse der Hub nicht lesen kann, z. B. DLC).
// Von jeder Feldmitte aus wächst eine Fläche über Pixel, die der Farbe an der Mitte ähneln und auf keiner Kante liegen
// (Feldgrenzen, Wege, Waldrand). Die Farbschwelle steigt, bis die
// Fläche zu groß wird oder plötzlich in die Nachbarschaft ausläuft; genommen wird die letzte gute. Danach werden Löcher
// gefüllt, schmale Ausläufer abgeschnitten und der Umriss vereinfacht. Läuft im Browser (public/fshub-umriss.js) und
// zum Testen in Node (test/fshub.test.js).
(function (root) {
  'use strict';

  // Weichzeichnen (Kasten, Radius r) je Farbkanal
  function blur(img, r) {
    var w = img.width, h = img.height, d = img.data, out = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
    var tmp = new Float32Array(w * h);
    for (var c = 0; c < 3; c++) {
      for (var y = 0; y < h; y++) {
        var s = 0, n = 0;
        for (var x = -r; x < w; x++) {
          if (x + r < w) { s += d[(y * w + x + r) * 4 + c]; n++; }
          if (x - r - 1 >= 0) { s -= d[(y * w + x - r - 1) * 4 + c]; n--; }
          if (x >= 0) tmp[y * w + x] = s / n;
        }
      }
      var o = out[c];
      for (var x2 = 0; x2 < w; x2++) {
        var s2 = 0, n2 = 0;
        for (var y2 = -r; y2 < h; y2++) {
          if (y2 + r < h) { s2 += tmp[(y2 + r) * w + x2]; n2++; }
          if (y2 - r - 1 >= 0) { s2 -= tmp[(y2 - r - 1) * w + x2]; n2--; }
          if (y2 >= 0) o[y2 * w + x2] = s2 / n2;
        }
      }
    }
    return out;
  }

  // Kantenstärke je Pixel aus dem Originalbild (nicht weichgezeichnet, damit dünne Feldgrenzen und Wege erhalten bleiben)
  function edges(img) {
    var w = img.width, h = img.height, d = img.data, g = new Float32Array(w * h);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x, m = 0;
        for (var c = 0; c < 3; c++) {
          var v = Math.abs(d[(i + 1) * 4 + c] - d[(i - 1) * 4 + c]) + Math.abs(d[(i + w) * 4 + c] - d[(i - w) * 4 + c]);
          if (v > m) m = v;
        }
        g[i] = m;
      }
    }
    return g;
  }
  // Schwelle für Kanten: deutlich über der Unruhe rund um die Mitte (Ackerfurchen, Grasmuster)
  function edgeLimit(g, w, h, start) {
    var vals = [], x0 = start % w, y0 = (start / w) | 0;
    for (var dy = -5; dy <= 5; dy++) for (var dx = -5; dx <= 5; dx++) { var x = x0 + dx, y = y0 + dy; if (x >= 0 && y >= 0 && x < w && y < h) vals.push(g[y * w + x]); }
    vals.sort(function (a, b) { return a - b; });
    var med = vals[vals.length >> 1] || 0;
    return Math.max(28, Math.min(90, med * 2.5 + 20));
  }

  // Ruhigste Stelle nahe der Mitte (wenig Farbunterschied zu den Nachbarn), damit die Mitte nicht auf einem Weg liegt
  function settle(ch, w, h, x0, y0, rad) {
    var best = null, bv = Infinity;
    for (var dy = -rad; dy <= rad; dy++) {
      for (var dx = -rad; dx <= rad; dx++) {
        var x = x0 + dx, y = y0 + dy;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
        var i = y * w + x, v = 0;
        for (var c = 0; c < 3; c++) { var a = ch[c]; v += Math.abs(a[i] - a[i - 2]) + Math.abs(a[i] - a[i + 2]) + Math.abs(a[i] - a[i - 2 * w]) + Math.abs(a[i] - a[i + 2 * w]); }
        v += (dx * dx + dy * dy) * 0.08;
        if (v < bv) { bv = v; best = i; }
      }
    }
    return best;
  }

  // Fläche ab start: Pixel mit Farbabstand < t zur Startfarbe, frei (owner 0). Bricht bei mehr als max Pixeln ab.
  function flood(ch, w, h, owner, start, t, max, mark, stamp, eg, elim) {
    var r0 = ch[0][start], g0 = ch[1][start], b0 = ch[2][start], t2 = t * t;
    var q = [start], n = 0;
    mark[start] = stamp;
    while (n < q.length) {
      var i = q[n++];
      if (q.length > max) return null;
      var x = i % w;
      var nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
      for (var k = 0; k < 4; k++) {
        var j = nb[k];
        if (j < 0 || mark[j] === stamp || owner[j] || eg[j] > elim) continue;
        var dr = ch[0][j] - r0, dg = ch[1][j] - g0, db = ch[2][j] - b0;
        if (dr * dr + dg * dg + db * db < t2) { mark[j] = stamp; q.push(j); }
      }
    }
    return q;
  }

  // Maske in einem Ausschnitt: Löcher füllen, einmal abtragen und wieder auftragen (schneidet dünne Ausläufer ab),
  // nur den Teil behalten, der die Mitte enthält
  function clean(pix, w, start) {
    var x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, i, k;
    for (k = 0; k < pix.length; k++) { i = pix[k]; var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1, m = new Uint8Array(bw * bh);
    for (k = 0; k < pix.length; k++) { i = pix[k]; m[((i / w | 0) - y0) * bw + (i % w - x0)] = 1; }
    // Außen von den Rändern aus fluten, was übrig bleibt, ist innen
    var out = new Uint8Array(bw * bh), q = [], n = 0;
    for (var bx = 0; bx < bw; bx++) { q.push(bx, (bh - 1) * bw + bx); }
    for (var by = 0; by < bh; by++) { q.push(by * bw, by * bw + bw - 1); }
    q.forEach(function (p) { out[p] = 1; });
    while (n < q.length) {
      var p = q[n++], px = p % bw;
      var nb = [px > 0 ? p - 1 : -1, px < bw - 1 ? p + 1 : -1, p >= bw ? p - bw : -1, p < bw * (bh - 1) ? p + bw : -1];
      for (var j = 0; j < 4; j++) { var o = nb[j]; if (o >= 0 && !out[o] && !m[o]) { out[o] = 1; q.push(o); } }
    }
    for (k = 0; k < m.length; k++) m[k] = out[k] ? 0 : 1;
    var morph = function (src, keep) {
      var dst = new Uint8Array(src.length);
      for (var yy = 1; yy < bh - 1; yy++) {
        for (var xx = 1; xx < bw - 1; xx++) {
          var c = yy * bw + xx, s = src[c - 1] + src[c + 1] + src[c - bw] + src[c + bw];
          dst[c] = keep ? (src[c] && s === 4 ? 1 : 0) : (src[c] || s ? 1 : 0);
        }
      }
      return dst;
    };
    var opened = morph(morph(m, true), false);
    // Zusammenhängender Teil um die Mitte
    var sx = start % w - x0, sy = (start / w | 0) - y0, s0 = sy * bw + sx;
    if (!opened[s0]) {
      var bd = Infinity;
      for (k = 0; k < opened.length; k++) if (opened[k]) { var ddx = k % bw - sx, ddy = (k / bw | 0) - sy, dd = ddx * ddx + ddy * ddy; if (dd < bd) { bd = dd; s0 = k; } }
      if (bd === Infinity) return null;
    }
    var part = new Uint8Array(bw * bh);
    q = [s0]; n = 0; part[s0] = 1;
    while (n < q.length) {
      var c2 = q[n++], cx = c2 % bw;
      var nb2 = [cx > 0 ? c2 - 1 : -1, cx < bw - 1 ? c2 + 1 : -1, c2 >= bw ? c2 - bw : -1, c2 < bw * (bh - 1) ? c2 + bw : -1];
      for (var j2 = 0; j2 < 4; j2++) { var o2 = nb2[j2]; if (o2 >= 0 && opened[o2] && !part[o2]) { part[o2] = 1; q.push(o2); } }
    }
    return { m: part, x0: x0, y0: y0, bw: bw, bh: bh, n: q.length };
  }

  // Umriss einer Maske: Kanten zwischen innen und außen zu Ringen verketten, den längsten nehmen
  function outline(r) {
    var bw = r.bw, bh = r.bh, m = r.m, next = {}, W = bw + 1;
    var at = function (x, y) { return x >= 0 && y >= 0 && x < bw && y < bh && m[y * bw + x] === 1; };
    var add = function (a, b) { (next[a] || (next[a] = [])).push(b); };
    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) {
        if (!at(x, y)) continue;
        if (!at(x, y - 1)) add(y * W + x, y * W + x + 1);
        if (!at(x + 1, y)) add(y * W + x + 1, (y + 1) * W + x + 1);
        if (!at(x, y + 1)) add((y + 1) * W + x + 1, (y + 1) * W + x);
        if (!at(x - 1, y)) add((y + 1) * W + x, y * W + x);
      }
    }
    var best = null;
    Object.keys(next).forEach(function (s) {
      var k = Number(s), ring = [];
      while (next[k] && next[k].length) { ring.push(k); k = next[k].pop(); }
      if (ring.length > 3 && (!best || ring.length > best.length)) best = ring;
    });
    return best && best.map(function (v) { return [v % W + r.x0, Math.floor(v / W) + r.y0]; });
  }
  function simplify(pts, eps) {
    if (pts.length < 8) return pts;
    var mid = 0, md = 0, i;
    for (i = 1; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; mid = i; } }
    var ring = pts.concat([pts[0]]), out = [];
    var dp = function (a, b) {
      var far = -1, fd = eps, ax = ring[a][0], ay = ring[a][1], dx = ring[b][0] - ax, dy = ring[b][1] - ay, len = Math.hypot(dx, dy) || 1;
      for (var j = a + 1; j < b; j++) { var e = Math.abs((ring[j][0] - ax) * dy - (ring[j][1] - ay) * dx) / len; if (e > fd) { fd = e; far = j; } }
      if (far < 0) { out.push(ring[a]); return; }
      dp(a, far); dp(far, b);
    };
    dp(0, mid); dp(mid, ring.length - 1);
    return out;
  }

  // img: { width, height, data (RGBA) }. seeds: [{ id, x, y, max, min }] in Pixeln (max/min: erlaubte Größe in Pixeln).
  // Gibt { [id]: [[x, y], …] } in Pixeln zurück; Felder ohne gute Fläche fehlen.
  function detect(img, seeds, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, ch = blur(img, opts.blur || 1), eg = edges(img);
    var owner = new Int32Array(w * h), mark = new Int32Array(w * h), stamp = 0, out = {};
    var steps = opts.steps || [10, 14, 18, 23, 28, 34, 40];
    // Kleine Felder zuerst, dann laufen große nicht in sie hinein
    seeds.slice().sort(function (a, b) { return a.max - b.max; }).forEach(function (s) {
      var x = Math.round(s.x), y = Math.round(s.y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      var start = settle(ch, w, h, x, y, opts.settle || 4);
      if (start === null || owner[start]) return;
      var good = null, prev = 0, elim = edgeLimit(eg, w, h, start);
      for (var k = 0; k < steps.length; k++) {
        var pix = flood(ch, w, h, owner, start, steps[k], s.max, mark, ++stamp, eg, elim);
        if (!pix) break;
        if (good && prev >= s.min && pix.length > prev * 1.5) break;   // plötzlich viel größer: ausgelaufen
        good = pix; prev = pix.length;
      }
      if (!good || good.length < s.min) return;
      var r = clean(good, w, start);
      if (!r || r.n < s.min) return;
      for (var yy = 0; yy < r.bh; yy++) for (var xx = 0; xx < r.bw; xx++) if (r.m[yy * r.bw + xx]) owner[(yy + r.y0) * w + xx + r.x0] = s.id;
      var ring = outline(r);
      if (ring) out[s.id] = simplify(ring, opts.eps || 0.9);
    });
    return out;
  }

  var api = { detect: detect, blur: blur, edges: edges, simplify: simplify };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FSDetect = api;
})(this);
