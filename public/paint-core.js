// Paint: alle Werkzeuge als reine Pixel-Rechnung, ohne Kantenglättung wie im Paint von Windows 98.
// Jedes Werkzeug setzt genau festgelegte Pixel, darum ergibt derselbe Befehl in jedem Browser (und auf dem
// Server) exakt dasselbe Bild. Läuft im Browser (window.PaintCore) und in Node (require), ohne DOM.
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PaintCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Bild ----------
  // Ein Bild ist { w, h, d } mit d als RGBA-Bytes (Uint8ClampedArray, wie ImageData).
  // Farben sind Zahlen 0xRRGGBB. Durchsichtige Pixel (Alpha 0) gibt es nur in Auswahlen.
  function create(w, h, color) {
    var b = { w: w, h: h, d: new Uint8ClampedArray(w * h * 4) };
    clear(b, color == null ? 0xffffff : color);
    return b;
  }
  function clone(b) { return { w: b.w, h: b.h, d: new Uint8ClampedArray(b.d) }; }
  function clear(b, color) {
    var r = color >> 16 & 255, g = color >> 8 & 255, bl = color & 255, d = b.d;
    for (var i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = bl; d[i + 3] = 255; }
  }
  function get(b, x, y) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) return -1;
    var i = (y * b.w + x) * 4;
    return b.d[i + 3] ? (b.d[i] << 16 | b.d[i + 1] << 8 | b.d[i + 2]) : -1;
  }
  function set(b, x, y, c) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
    var i = (y * b.w + x) * 4;
    b.d[i] = c >> 16 & 255; b.d[i + 1] = c >> 8 & 255; b.d[i + 2] = c & 255; b.d[i + 3] = 255;
  }
  function hspan(b, x0, x1, y, c) {
    if (y < 0 || y >= b.h) return;
    if (x0 < 0) x0 = 0;
    if (x1 >= b.w) x1 = b.w - 1;
    for (var x = x0; x <= x1; x++) set(b, x, y, c);
  }
  var toHex = function (c) { return '#' + (0x1000000 + (c & 0xffffff)).toString(16).slice(1); };
  var fromHex = function (s) { return parseInt(String(s).replace('#', ''), 16) & 0xffffff; };

  // Ausschnitt; außerhalb des Bildes durchsichtig
  function crop(b, x, y, w, h) {
    var out = { w: w, h: h, d: new Uint8ClampedArray(w * h * 4) };
    for (var j = 0; j < h; j++) {
      var sy = y + j;
      if (sy < 0 || sy >= b.h) continue;
      var sx0 = Math.max(0, x), sx1 = Math.min(b.w, x + w);
      if (sx1 <= sx0) continue;
      out.d.set(b.d.subarray((sy * b.w + sx0) * 4, (sy * b.w + sx1) * 4), (j * w + (sx0 - x)) * 4);
    }
    return out;
  }
  // Ein Bild auf ein anderes setzen. transparent: diese Farbe wird ausgelassen (Auswahl „durchsichtig“)
  function blit(dst, src, x, y, transparent) {
    var tr = transparent == null ? -1 : transparent;
    for (var j = 0; j < src.h; j++) {
      var dy = y + j;
      if (dy < 0 || dy >= dst.h) continue;
      for (var i = 0; i < src.w; i++) {
        var dx = x + i;
        if (dx < 0 || dx >= dst.w) continue;
        var si = (j * src.w + i) * 4;
        if (!src.d[si + 3]) continue;
        var c = src.d[si] << 16 | src.d[si + 1] << 8 | src.d[si + 2];
        if (c === tr) continue;
        var di = (dy * dst.w + dx) * 4;
        dst.d[di] = src.d[si]; dst.d[di + 1] = src.d[si + 1]; dst.d[di + 2] = src.d[si + 2]; dst.d[di + 3] = 255;
      }
    }
  }
  // Rechteck mit einer Farbe füllen (z. B. die Stelle, von der eine Auswahl weggezogen wird)
  function fillRect(b, x, y, w, h, c, mask) {
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      if (mask && !mask.d[(j * mask.w + i) * 4 + 3]) continue;
      set(b, x + i, y + j, c);
    }
  }

  // ---------- Zufall (Sprühdose) ----------
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = s + 0x6D2B79F5 >>> 0;
      var t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- Pinselspitzen ----------
  // Wie im Original: Kreis, Quadrat, Schrägstrich / und \, je groß, mittel, klein
  var BRUSH_SIZES = [8, 5, 2];
  var stampCache = {};
  function stamp(shape, size) {
    var key = shape + size;
    if (stampCache[key]) return stampCache[key];
    var pts = [], i, j;
    if (size <= 1) pts.push([0, 0]);
    else if (shape === 'square') {
      var o = Math.floor((size - 1) / 2);
      for (j = 0; j < size; j++) for (i = 0; i < size; i++) pts.push([i - o, j - o]);
    } else if (shape === 'slash' || shape === 'backslash') {
      var h = Math.floor((size - 1) / 2);
      for (i = 0; i < size; i++) pts.push(shape === 'slash' ? [i - h, h - i] : [i - h, i - h]);
    } else {
      // Kreis über die Pixelmitten
      var r = size / 2, c = (size - 1) / 2, off = Math.floor(c);
      for (j = 0; j < size; j++) for (i = 0; i < size; i++) {
        var dx = i - c, dy = j - c;
        if (dx * dx + dy * dy <= r * r - 0.25) pts.push([i - off, j - off]);
      }
    }
    stampCache[key] = pts;
    return pts;
  }
  // Rund für Linien und Formränder der Stärke w
  var pen = function (w) { return w <= 1 ? stamp('square', 1) : w === 2 ? stamp('square', 2) : stamp('round', w); };

  function bresenham(x0, y0, x1, y1, fn) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
    for (;;) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  // Ein Linienzug mit einer Spitze. Gibt das betroffene Rechteck zurück.
  function stroke(b, pts, c, st) {
    var box = emptyBox();
    var put = function (x, y) {
      for (var k = 0; k < st.length; k++) set(b, x + st[k][0], y + st[k][1], c);
      grow(box, x, y, st);
    };
    if (pts.length === 1) put(pts[0][0] | 0, pts[0][1] | 0);
    for (var i = 1; i < pts.length; i++) bresenham(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], put);
    return box;
  }
  function line(b, x0, y0, x1, y1, c, w) { return stroke(b, [[x0, y0], [x1, y1]], c, pen(w || 1)); }

  // Radierer: Quadrat in der Hintergrundfarbe. Mit only gesetzt (Rechtsklick, „Farbradierer“)
  // werden nur Pixel dieser Farbe ersetzt.
  function erase(b, pts, size, bg, only) {
    var st = stamp('square', size), box = emptyBox();
    var put = function (x, y) {
      for (var k = 0; k < st.length; k++) {
        var px = x + st[k][0], py = y + st[k][1];
        if (only == null || get(b, px, py) === only) set(b, px, py, bg);
      }
      grow(box, x, y, st);
    };
    if (pts.length === 1) put(pts[0][0] | 0, pts[0][1] | 0);
    for (var i = 1; i < pts.length; i++) bresenham(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], put);
    return box;
  }

  // Sprühdose: an jedem Punkt count Pixel im Kreis mit Radius r, Zufall aus seed
  function spray(b, pts, r, c, seed, count) {
    var rand = rng(seed), box = emptyBox();
    for (var i = 0; i < pts.length; i++) {
      for (var n = 0; n < count; n++) {
        var dx, dy;
        do { dx = Math.round((rand() * 2 - 1) * r); dy = Math.round((rand() * 2 - 1) * r); } while (dx * dx + dy * dy > r * r);
        set(b, pts[i][0] + dx, pts[i][1] + dy, c);
      }
      growXY(box, pts[i][0] - r, pts[i][1] - r); growXY(box, pts[i][0] + r, pts[i][1] + r);
    }
    return box;
  }

  // Farbfüller: alle zusammenhängenden Pixel genau gleicher Farbe (4er-Nachbarschaft)
  function flood(b, x, y, c) {
    x |= 0; y |= 0;
    var target = get(b, x, y);
    if (target < 0 || target === c) return null;
    var box = emptyBox(), stack = [x, y], w = b.w, h = b.h;
    while (stack.length) {
      var py = stack.pop(), px = stack.pop();
      if (get(b, px, py) !== target) continue;
      var l = px, r = px;
      while (l > 0 && get(b, l - 1, py) === target) l--;
      while (r < w - 1 && get(b, r + 1, py) === target) r++;
      for (var i = l; i <= r; i++) {
        set(b, i, py, c);
        if (py > 0 && get(b, i, py - 1) === target) stack.push(i, py - 1);
        if (py < h - 1 && get(b, i, py + 1) === target) stack.push(i, py + 1);
      }
      growXY(box, l, py); growXY(box, r, py);
    }
    return box;
  }

  // ---------- Formen ----------
  // Rechteck, Ellipse und abgerundetes Rechteck werden zeilenweise beschrieben: span(y) liefert [links, rechts]
  // für die Pixelmitten in der Form. Der Rand der Stärke w ist die Form ohne die um w eingerückte Form.
  function norm(x0, y0, x1, y1) { return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]; }
  function shapeSpan(kind, x0, y0, x1, y1) {
    if (x1 < x0 || y1 < y0) return function () { return null; };
    var w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (kind === 'rect') return function (y) { return y < y0 || y > y1 ? null : [x0, x1]; };
    if (kind === 'ellipse') {
      var a = w / 2, bb = h / 2, cx = x0 + a, cy = y0 + bb;
      return function (y) {
        if (y < y0 || y > y1) return null;
        var dy = (y + 0.5 - cy) / bb, q = 1 - dy * dy;
        if (q < 0) return null;
        var half = a * Math.sqrt(q), l = Math.ceil(cx - half - 0.5), r = Math.floor(cx + half - 0.5);
        if (r < l) { l = r = Math.floor(cx); }
        return [Math.max(x0, l), Math.min(x1, r)];
      };
    }
    // Abgerundetes Rechteck: Ecken als Viertelkreise mit festem Radius wie im Original
    var rad = Math.min(8, w / 2, h / 2);
    return function (y) {
      if (y < y0 || y > y1) return null;
      var py = y + 0.5, d = 0;
      if (py < y0 + rad) d = rad - Math.sqrt(Math.max(0, rad * rad - Math.pow(y0 + rad - py, 2)));
      else if (py > y1 + 1 - rad) d = rad - Math.sqrt(Math.max(0, rad * rad - Math.pow(py - (y1 + 1 - rad), 2)));
      var l = Math.ceil(x0 + d - 0.5 + 0.0001), r = Math.floor(x1 + 1 - d - 0.5 - 0.0001);
      if (r < l) { l = r = Math.floor((x0 + x1) / 2); }
      return [Math.max(x0, l), Math.min(x1, r)];
    };
  }
  // opts: { stroke: Farbe oder null, fill: Farbe oder null, width }
  function shape(b, kind, ax, ay, bx, by, opts) {
    var n = norm(ax, ay, bx, by), x0 = n[0], y0 = n[1], x1 = n[2], y1 = n[3];
    var w = Math.max(1, opts.width || 1);
    var outer = shapeSpan(kind, x0, y0, x1, y1), inner = shapeSpan(kind, x0 + w, y0 + w, x1 - w, y1 - w);
    for (var y = y0; y <= y1; y++) {
      var o = outer(y);
      if (!o) continue;
      var i = opts.stroke == null ? o : inner(y);
      if (opts.stroke == null) { hspan(b, o[0], o[1], y, opts.fill); continue; }
      if (!i) { hspan(b, o[0], o[1], y, opts.stroke); continue; }
      // Rand mindestens w breit, damit steile Stellen keine Lücken haben
      var le = Math.max(i[0] - 1, o[0] + w - 1), ri = Math.min(i[1] + 1, o[1] - w + 1);
      if (le >= ri - 1) { hspan(b, o[0], o[1], y, opts.stroke); continue; }
      hspan(b, o[0], le, y, opts.stroke);
      hspan(b, ri, o[1], y, opts.stroke);
      if (opts.fill != null) hspan(b, le + 1, ri - 1, y, opts.fill);
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // Vieleck: Füllung nach der Gerade-Ungerade-Regel über die Pixelmitten, Rand als Linienzug
  function polygon(b, pts, opts) {
    var box = emptyBox(), i;
    for (i = 0; i < pts.length; i++) growXY(box, pts[i][0], pts[i][1]);
    var fillC = opts.fill;
    if (fillC != null && pts.length > 2) {
      for (var y = box.y0; y <= box.y1; y++) {
        var py = y + 0.5, xs = [];
        for (i = 0; i < pts.length; i++) {
          var p = pts[i], q = pts[(i + 1) % pts.length];
          var ya = p[1] + 0.5, yb = q[1] + 0.5;
          if ((ya <= py && yb > py) || (yb <= py && ya > py)) xs.push(p[0] + 0.5 + (py - ya) / (yb - ya) * (q[0] - p[0]));
        }
        xs.sort(function (m, n) { return m - n; });
        for (var k = 0; k + 1 < xs.length; k += 2) {
          var l = Math.ceil(xs[k] - 0.5), r = Math.floor(xs[k + 1] - 0.5);
          if (r >= l) hspan(b, l, r, y, fillC);
        }
      }
    }
    if (opts.stroke != null) {
      var ring = pts.concat([pts[0]]);
      var sb = stroke(b, ring, opts.stroke, pen(opts.width || 1));
      merge(box, sb);
    }
    return box;
  }

  // Kurve: Bézier mit zwei Stützpunkten, in kurze gerade Stücke zerlegt
  function bezierPoints(p0, p1, p2, p3) {
    var len = Math.abs(p1[0] - p0[0]) + Math.abs(p1[1] - p0[1]) + Math.abs(p2[0] - p1[0]) + Math.abs(p2[1] - p1[1]) + Math.abs(p3[0] - p2[0]) + Math.abs(p3[1] - p2[1]);
    var n = Math.max(2, Math.min(400, Math.ceil(len / 3))), out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push([Math.round(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]),
        Math.round(u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1])]);
    }
    return out;
  }
  function curve(b, p0, p1, p2, p3, c, w) { return stroke(b, bezierPoints(p0, p1, p2, p3), c, pen(w || 1)); }

  // ---------- Bild-Menü ----------
  function flipH(b) {
    var out = clone(b);
    for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) copyPx(b, x, y, out, b.w - 1 - x, y);
    return out;
  }
  function flipV(b) {
    var out = { w: b.w, h: b.h, d: new Uint8ClampedArray(b.d.length) }, row = b.w * 4;
    for (var y = 0; y < b.h; y++) out.d.set(b.d.subarray(y * row, (y + 1) * row), (b.h - 1 - y) * row);
    return out;
  }
  function rotate(b, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (deg === 180) return flipV(flipH(b));
    if (deg !== 90 && deg !== 270) return clone(b);
    var out = { w: b.h, h: b.w, d: new Uint8ClampedArray(b.d.length) };
    for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) {
      if (deg === 90) copyPx(b, x, y, out, b.h - 1 - y, x);
      else copyPx(b, x, y, out, y, b.w - 1 - x);
    }
    return out;
  }
  // Strecken auf eine neue Größe, nächster Nachbar
  function scale(b, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var out = { w: w, h: h, d: new Uint8ClampedArray(w * h * 4) };
    for (var y = 0; y < h; y++) {
      var sy = Math.min(b.h - 1, Math.floor((y + 0.5) * b.h / h));
      for (var x = 0; x < w; x++) copyPx(b, Math.min(b.w - 1, Math.floor((x + 0.5) * b.w / w)), sy, out, x, y);
    }
    return out;
  }
  // Zerren um ax (waagerecht) und ay (senkrecht) Grad, frei werdende Fläche in Hintergrundfarbe
  function skewH(b, deg, bg) {
    var t = Math.tan(deg * Math.PI / 180), add = Math.round(Math.abs(t) * (b.h - 1));
    var out = create(b.w + add, b.h, bg);
    for (var y = 0; y < b.h; y++) {
      var sh = Math.round(t * y) + (t < 0 ? add : 0);
      out.d.set(b.d.subarray(y * b.w * 4, (y + 1) * b.w * 4), (y * out.w + sh) * 4);
    }
    return out;
  }
  function skewV(b, deg, bg) {
    var t = Math.tan(deg * Math.PI / 180), add = Math.round(Math.abs(t) * (b.w - 1));
    var out = create(b.w, b.h + add, bg);
    for (var x = 0; x < b.w; x++) {
      var sh = Math.round(t * x) + (t < 0 ? add : 0);
      for (var y = 0; y < b.h; y++) copyPx(b, x, y, out, x, y + sh);
    }
    return out;
  }
  function skew(b, ax, ay, bg) {
    var out = ax ? skewH(b, ax, bg) : b;
    if (ay) out = skewV(out, ay, bg);
    return out === b ? clone(b) : out;
  }
  function invert(b, box) {
    var x0 = box ? box.x : 0, y0 = box ? box.y : 0, w = box ? box.w : b.w, h = box ? box.h : b.h;
    for (var y = Math.max(0, y0); y < Math.min(b.h, y0 + h); y++) for (var x = Math.max(0, x0); x < Math.min(b.w, x0 + w); x++) {
      var i = (y * b.w + x) * 4;
      if (!b.d[i + 3]) continue;
      b.d[i] = 255 - b.d[i]; b.d[i + 1] = 255 - b.d[i + 1]; b.d[i + 2] = 255 - b.d[i + 2];
    }
  }
  // Leinwand vergrößern oder verkleinern, oben links bleibt stehen
  function resize(b, w, h, bg) {
    var out = create(w, h, bg);
    blit(out, crop(b, 0, 0, Math.min(w, b.w), Math.min(h, b.h)), 0, 0);
    return out;
  }
  // Schwarzweiß wie unter „Attribute“: hell wird weiß, dunkel schwarz
  function monochrome(b) {
    for (var i = 0; i < b.d.length; i += 4) {
      var l = 0.299 * b.d[i] + 0.587 * b.d[i + 1] + 0.114 * b.d[i + 2], v = l >= 128 ? 255 : 0;
      b.d[i] = b.d[i + 1] = b.d[i + 2] = v;
    }
  }
  function copyPx(src, sx, sy, dst, dx, dy) {
    var si = (sy * src.w + sx) * 4, di = (dy * dst.w + dx) * 4;
    dst.d[di] = src.d[si]; dst.d[di + 1] = src.d[si + 1]; dst.d[di + 2] = src.d[si + 2]; dst.d[di + 3] = src.d[si + 3];
  }

  // Freihandauswahl: Maske aus einem Vieleck (Alpha 255 innen)
  function polyMask(pts, x, y, w, h) {
    var m = { w: w, h: h, d: new Uint8ClampedArray(w * h * 4) };
    var local = pts.map(function (p) { return [p[0] - x, p[1] - y]; });
    polygon(m, local, { stroke: 0, fill: 0, width: 1 });
    return m;
  }
  function applyMask(b, m) {
    for (var i = 3; i < b.d.length; i += 4) if (!m.d[i]) b.d[i] = 0;
    return b;
  }

  // ---------- Rechtecke ----------
  function emptyBox() { return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; }
  function growXY(box, x, y) {
    if (x < box.x0) box.x0 = x; if (y < box.y0) box.y0 = y;
    if (x > box.x1) box.x1 = x; if (y > box.y1) box.y1 = y;
  }
  function grow(box, x, y, st) {
    var m = 0;
    for (var k = 0; k < st.length; k++) m = Math.max(m, Math.abs(st[k][0]), Math.abs(st[k][1]));
    growXY(box, x - m, y - m); growXY(box, x + m, y + m);
  }
  function merge(a, b) { if (b && b.x1 >= b.x0) { growXY(a, b.x0, b.y0); growXY(a, b.x1, b.y1); } return a; }
  // In ein Rechteck { x, y, w, h } innerhalb des Bildes umrechnen, oder null
  function clip(box, b) {
    if (!box || box.x1 < box.x0) return null;
    var x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
    var x1 = Math.min(b.w - 1, Math.ceil(box.x1)), y1 = Math.min(b.h - 1, Math.ceil(box.y1));
    return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---------- Dateien ----------
  // BMP mit 24 Bit, wie Paint 98 es speicherte
  function encodeBMP(b) {
    var rowSize = Math.ceil(b.w * 3 / 4) * 4, size = 54 + rowSize * b.h;
    var buf = new Uint8Array(size), v = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4d;
    v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
    v.setInt32(18, b.w, true); v.setInt32(22, b.h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
    v.setUint32(34, rowSize * b.h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
    for (var y = 0; y < b.h; y++) {
      var o = 54 + (b.h - 1 - y) * rowSize;
      for (var x = 0; x < b.w; x++) {
        var i = (y * b.w + x) * 4, a = b.d[i + 3] / 255;
        // Durchsichtiges wird weiß
        buf[o++] = Math.round(b.d[i + 2] * a + 255 * (1 - a));
        buf[o++] = Math.round(b.d[i + 1] * a + 255 * (1 - a));
        buf[o++] = Math.round(b.d[i] * a + 255 * (1 - a));
      }
    }
    return buf;
  }
  // Kurze Prüfsumme über das Bild (für Tests und später zum Abgleich in Lobbys)
  function hash(b) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < b.d.length; i++) { h ^= b.d[i]; h = Math.imul(h, 16777619) >>> 0; }
    return (h >>> 0).toString(16) + ':' + b.w + 'x' + b.h;
  }

  // Die 28 Farben der Palette von Windows 98
  var PALETTE = [0x000000, 0x808080, 0x800000, 0x808000, 0x008000, 0x008080, 0x000080, 0x800080, 0x808040, 0x004040, 0x0080ff, 0x004080, 0x8000ff, 0x804000,
    0xffffff, 0xc0c0c0, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffff80, 0x00ff80, 0x80ffff, 0x8080ff, 0xff0080, 0xff8040];

  return {
    create: create, clone: clone, clear: clear, get: get, set: set, crop: crop, blit: blit, fillRect: fillRect,
    stamp: stamp, pen: pen, BRUSH_SIZES: BRUSH_SIZES, stroke: stroke, line: line, erase: erase, spray: spray, flood: flood,
    shape: shape, polygon: polygon, curve: curve, bezierPoints: bezierPoints,
    flipH: flipH, flipV: flipV, rotate: rotate, scale: scale, skew: skew, invert: invert, resize: resize, monochrome: monochrome,
    polyMask: polyMask, applyMask: applyMask,
    emptyBox: emptyBox, growXY: growXY, merge: merge, clip: clip,
    encodeBMP: encodeBMP, hash: hash, rng: rng, toHex: toHex, fromHex: fromHex, PALETTE: PALETTE,
  };
}));
