// Visualisierungen für den Musik-Player, frei nachempfunden den Klassikern aus dem Windows Media Player der XP-Zeit
// (Balken und Wellen, Ambiente, Batterie, Stacheln, Musikfarben). Alles eigener Code, gezeichnet auf einem <canvas>.
// Jede Visualisierung bekommt pro Bild das Frequenzspektrum (0–255 je Band) und die Wellenform (128 = Ruhe).
(function () {
  'use strict';
  var TAU = Math.PI * 2;

  // Mittelwert über logarithmisch verteilte Bänder: tiefe Töne bekommen so genauso viel Platz wie hohe
  function bands(freq, n, maxBin) {
    var out = new Array(n), top = Math.min(freq.length, maxBin || Math.floor(freq.length * 0.72));
    for (var i = 0; i < n; i++) {
      var a = Math.floor(Math.pow(top, i / n)), b = Math.max(a + 1, Math.floor(Math.pow(top, (i + 1) / n)));
      var s = 0;
      for (var j = a; j < b; j++) s += freq[j];
      out[i] = s / (b - a) / 255;
    }
    return out;
  }
  function level(freq, from, to) { var s = 0; for (var i = from; i < to; i++) s += freq[i]; return s / (to - from) / 255; }
  function fade(ctx, w, h, a) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,0,0,' + a + ')'; ctx.fillRect(0, 0, w, h); }

  // Rückkopplung: das letzte Bild verschoben, gedreht oder vergrößert wieder einzeichnen
  function feedback(v, o) {
    var ctx = v.ctx, w = v.w, h = v.h;
    v.bctx.clearRect(0, 0, w, h);
    v.bctx.drawImage(v.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = o.alpha;
    ctx.translate(w / 2 + (o.dx || 0), h / 2 + (o.dy || 0));
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.scale || 1, o.scale || 1);
    ctx.drawImage(v.buf, -w / 2, -h / 2);
    ctx.restore();
  }

  var MODES = [
    { id: 'balken', name: 'Balken und Wellen: Balken', draw: function (v, freq) {
      var ctx = v.ctx, w = v.w, h = v.h, n = Math.max(12, Math.min(64, Math.floor(w / (12 * v.dpr))));
      var b = bands(freq, n), bw = w / n;
      fade(ctx, w, h, 1);
      if (!v.peaks || v.peaks.length !== n) v.peaks = new Array(n).fill(0);
      var g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#00c000'); g.addColorStop(0.55, '#e0e000'); g.addColorStop(1, '#ff2000');
      for (var i = 0; i < n; i++) {
        var bh = Math.min(1, b[i] * 1.15) * h * 0.92;
        ctx.fillStyle = g;
        // Segmente wie bei einer LED-Anzeige
        for (var y = 0; y < bh; y += 6 * v.dpr) ctx.fillRect(i * bw + 1, h - y - 4 * v.dpr, bw - 3, 4 * v.dpr);
        v.peaks[i] = Math.max(bh, v.peaks[i] - h * 0.008);
        ctx.fillStyle = '#fff';
        ctx.fillRect(i * bw + 1, h - v.peaks[i] - 6 * v.dpr, bw - 3, 2 * v.dpr);
      }
    } },
    { id: 'scope', name: 'Balken und Wellen: Oszilloskop', draw: function (v, freq, wave) {
      var ctx = v.ctx, w = v.w, h = v.h;
      fade(ctx, w, h, 0.35);
      ctx.strokeStyle = '#40ff40'; ctx.lineWidth = 2 * v.dpr; ctx.shadowColor = '#00ff00'; ctx.shadowBlur = 8 * v.dpr;
      ctx.beginPath();
      for (var i = 0; i < wave.length; i += 2) {
        var x = i / (wave.length - 1) * w, y = h / 2 + (wave[i] - 128) / 128 * h * 0.45;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    } },
    { id: 'ozean', name: 'Balken und Wellen: Ozeannebel', draw: function (v, freq, wave, t) {
      var ctx = v.ctx, w = v.w, h = v.h;
      feedback(v, { alpha: 0.9, scale: 1.012, dy: -2 * v.dpr });
      var hue = 185 + Math.sin(t * 0.3) * 25;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'hsla(' + hue + ',90%,40%,0.12)';
      ctx.beginPath(); ctx.moveTo(0, h * 0.7);
      for (var i = 0; i < wave.length; i += 8) ctx.lineTo(i / (wave.length - 1) * w, h * 0.7 + (wave[i] - 128) / 128 * h * 0.35);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'hsla(' + (hue + 20) + ',100%,75%,0.8)'; ctx.lineWidth = 1.5 * v.dpr; ctx.stroke();
    } },
    { id: 'feuer', name: 'Balken und Wellen: Feuersturm', draw: function (v, freq) {
      var ctx = v.ctx, w = v.w, h = v.h, n = 48, b = bands(freq, n), bw = w / 2 / n;
      feedback(v, { alpha: 0.86, scale: 1.01, dy: -4 * v.dpr });
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < n; i++) {
        var e = b[i], bh = e * h * 0.7;
        ctx.fillStyle = 'hsla(' + (5 + e * 40) + ',100%,' + (25 + e * 25) + '%,0.35)';
        ctx.fillRect(w / 2 + i * bw, h - bh, bw - 1, bh);
        ctx.fillRect(w / 2 - (i + 1) * bw, h - bh, bw - 1, bh);
      }
    } },
    { id: 'ambiente', name: 'Ambiente: Wirbel', draw: function (v, freq, wave, t) {
      var ctx = v.ctx, w = v.w, h = v.h, bass = level(freq, 1, 12);
      feedback(v, { alpha: 0.94, scale: 1.025, rot: 0.01 + bass * 0.03 });
      ctx.globalCompositeOperation = 'lighter';
      var r = Math.min(w, h) * (0.12 + bass * 0.12), hue = (t * 40) % 360;
      ctx.lineWidth = 2 * v.dpr;
      ctx.strokeStyle = 'hsla(' + hue + ',100%,60%,0.9)';
      ctx.beginPath();
      for (var i = 0; i <= 128; i++) {
        var a = i / 128 * TAU, s = wave[(i * 16) % wave.length] - 128, rr = r + s / 128 * r * 0.8;
        var x = w / 2 + Math.cos(a) * rr, y = h / 2 + Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    } },
    { id: 'batterie', name: 'Batterie: Kaleidoskop', draw: function (v, freq, wave, t) {
      var ctx = v.ctx, w = v.w, h = v.h, mid = level(freq, 12, 120);
      feedback(v, { alpha: 0.9, scale: 0.985, rot: -0.02 - mid * 0.02 });
      ctx.globalCompositeOperation = 'lighter';
      var len = Math.min(w, h) * 0.48, hue = (t * 60) % 360;
      ctx.save(); ctx.translate(w / 2, h / 2);
      for (var k = 0; k < 6; k++) {
        ctx.rotate(TAU / 6);
        ctx.strokeStyle = 'hsla(' + ((hue + k * 25) % 360) + ',100%,60%,0.7)';
        ctx.lineWidth = 1.5 * v.dpr;
        for (var m = -1; m <= 1; m += 2) {
          ctx.beginPath();
          for (var i = 0; i < 64; i++) {
            var x = i / 63 * len, y = m * (wave[i * 8] - 128) / 128 * len * 0.4;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    } },
    { id: 'stacheln', name: 'Stacheln', draw: function (v, freq, wave, t) {
      var ctx = v.ctx, w = v.w, h = v.h, n = 96, b = bands(freq, n / 2), bass = level(freq, 1, 10);
      fade(ctx, w, h, 0.3);
      ctx.globalCompositeOperation = 'lighter';
      var r0 = Math.min(w, h) * (0.08 + bass * 0.08), r1 = Math.min(w, h) * 0.46;
      ctx.lineWidth = 3 * v.dpr; ctx.lineCap = 'round';
      for (var i = 0; i < n; i++) {
        var e = b[i < n / 2 ? i : n - 1 - i], a = i / n * TAU + t * 0.2;
        ctx.strokeStyle = 'hsla(' + ((i / n * 360 + t * 50) % 360) + ',100%,' + (40 + e * 30) + '%,0.9)';
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
        ctx.lineTo(w / 2 + Math.cos(a) * (r0 + e * (r1 - r0)), h / 2 + Math.sin(a) * (r0 + e * (r1 - r0)));
        ctx.stroke();
      }
    } },
    { id: 'farben', name: 'Musikfarben', draw: function (v, freq, wave, t) {
      var ctx = v.ctx, w = v.w, h = v.h, cols = 16, rows = 9, b = bands(freq, cols * rows);
      fade(ctx, w, h, 0.18);
      var cw = w / cols, ch = h / rows;
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
        // benachbarte Felder bekommen verschiedene Bänder, damit es flackert wie das Original
        var e = b[(x * 7 + y * 11) % b.length];
        if (e < 0.15) continue;
        ctx.fillStyle = 'hsla(' + ((x * 22 + y * 9 + t * 30) % 360) + ',95%,' + (25 + e * 45) + '%,' + Math.min(1, e * 1.2) + ')';
        ctx.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
      }
    } },
  ];

  function create(canvas) {
    var v = { canvas: canvas, ctx: canvas.getContext('2d'), buf: document.createElement('canvas'), mode: MODES[0], w: 0, h: 0, dpr: 1 };
    v.bctx = v.buf.getContext('2d');
    function resize() {
      var r = canvas.getBoundingClientRect();
      // Höchstens 1280 Bildpunkte breit, sonst kommt älteres Gerät im Vollbild nicht mit
      v.dpr = Math.min(window.devicePixelRatio || 1, 1.5, 1280 / Math.max(1, r.width));
      var w = Math.max(1, Math.round(r.width * v.dpr)), h = Math.max(1, Math.round(r.height * v.dpr));
      if (w === v.w && h === v.h) return;
      canvas.width = v.buf.width = v.w = w;
      canvas.height = v.buf.height = v.h = h;
      v.ctx.fillStyle = '#000'; v.ctx.fillRect(0, 0, w, h);
    }
    return {
      resize: resize,
      setMode: function (id) {
        v.mode = MODES.filter(function (m) { return m.id === id; })[0] || MODES[0];
        v.peaks = null;
        v.ctx.globalCompositeOperation = 'source-over'; v.ctx.fillStyle = '#000'; v.ctx.fillRect(0, 0, v.w, v.h);
      },
      draw: function (freq, wave, t) {
        resize();
        v.ctx.save();
        v.mode.draw(v, freq, wave, t);
        v.ctx.restore();
        v.ctx.globalCompositeOperation = 'source-over'; v.ctx.globalAlpha = 1;
      },
      // langsam ausblenden, wenn nichts läuft
      dim: function () { resize(); fade(v.ctx, v.w, v.h, 0.08); },
    };
  }

  window.RetroVis = { list: MODES.map(function (m) { return { id: m.id, name: m.name }; }), create: create };
})();
