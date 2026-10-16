// Paint (Startmenü → 🎨 Paint): Nachbau von Paint aus Windows 98. Die Pixel rechnet public/paint-core.js,
// hier liegen Werkzeugleiste, Menüs, Dialoge, Auswahl, Zwischenablage, Speichern und Öffnen.
// Einstellungen (Palette, eigene Farben, Ansicht, Werkzeug-Optionen) liegen nur im Browser unter localStorage "paint".
(function () {
  'use strict';
  var P = window.PaintCore;
  var root = document.getElementById('paint');
  if (!root || !P) return;

  var CSRF = root.dataset.csrf, SITE = root.dataset.site || '';
  var ME = root.dataset.user ? { id: Number(root.dataset.user), name: root.dataset.username } : null;
  var CAN_SAVE = root.dataset.save === '1', GALLERY = root.dataset.gallery === '1';
  var MAX_W = Number(root.dataset.maxw) || 2000, MAX_H = Number(root.dataset.maxh) || 2000;
  var PREF_KEY = 'paint';
  var $ = function (sel, el) { return (el || root).querySelector(sel); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  // ---------- Einstellungen im Browser ----------
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREF_KEY)); } catch (e) { /* leer */ }
    p = p && typeof p === 'object' ? p : {};
    var hexList = function (l, n, d) { return Array.isArray(l) && l.length === n && l.every(function (c) { return typeof c === 'number' && c >= 0 && c <= 0xffffff; }) ? l : d; };
    var o = p.opts || {};
    return {
      palette: hexList(p.palette, 28, P.PALETTE.slice()),
      custom: hexList(p.custom, 16, new Array(16).fill(0xffffff)),
      view: Object.assign({ tools: true, colors: true, status: true, text: true }, p.view || {}),
      grid: !!p.grid,
      size: Array.isArray(p.size) ? [clamp(p.size[0] | 0, 1, MAX_W), clamp(p.size[1] | 0, 1, MAX_H)] : [640, 480],
      opts: {
        brush: clamp(o.brush | 0, 0, 11), eraser: clamp(o.eraser == null ? 1 : o.eraser | 0, 0, 3), spray: clamp(o.spray | 0, 0, 2),
        width: clamp(o.width | 0, 0, 4), fill: clamp(o.fill | 0, 0, 2), transparent: !!o.transparent, zoom: clamp(o.zoom == null ? 2 : o.zoom | 0, 0, 3),
        font: typeof o.font === 'string' ? o.font : 'Arial', fontSize: clamp(o.fontSize || 16, 6, 96), bold: !!o.bold, italic: !!o.italic, underline: !!o.underline,
      },
    };
  }
  var prefs = loadPrefs();
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* voll oder gesperrt */ } }

  // ---------- Zustand ----------
  var img, committed, imgData;           // Bild, Stand nach dem letzten fertigen Schritt, ImageData für die Anzeige
  var doc = { id: null, title: 'unbenannt', visibility: 'private', mine: true, dirty: false };
  var fg = 0x000000, bg = 0xffffff;
  var tool = 'pencil', lastTool = 'pencil';
  var zoom = 1;
  var undo = [], redo = [], HISTORY = 20, HISTORY_BYTES = 160e6;
  var sel = null;        // schwebende Auswahl
  var clip = null;       // eigene Zwischenablage (falls der Browser keine Bilder hergibt)
  var busy = null;       // laufende Aktion mit der Maus
  var textBox = null;    // offenes Textfeld
  var multi = null;      // Vieleck oder Kurve in Arbeit
  var seed = (Date.now() & 0xffff) * 7919;

  var stage = $('.pt-stage'), sheet = $('.pt-sheet'), cv = $('#pt-canvas'), ov = $('#pt-overlay');
  var ctx = cv.getContext('2d'), octx = ov.getContext('2d');
  var frame = $('.pt-selframe'), gridEl = $('.pt-grid'), sizer = $('.pt-sizer');
  var statusText = $('[data-status=text]'), statusPos = $('[data-status=pos]'), statusSize = $('[data-status=size]');
  var DEFAULT_HINT = 'Hilfe gibt es im Menü ? unter Hilfethemen.';

  // ---------- Bild anzeigen ----------
  function setImage(b, keepHistory) {
    img = b;
    committed = P.clone(b);
    imgData = new ImageData(img.d, img.w, img.h);
    cv.width = ov.width = img.w; cv.height = ov.height = img.h;
    if (!keepHistory) { undo = []; redo = []; }
    applyZoom();
    refresh();
  }
  function refresh(r) {
    if (!r) { ctx.putImageData(imgData, 0, 0); return; }
    r = P.clip(r.x1 !== undefined ? r : { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 }, img);
    if (r) ctx.putImageData(imgData, 0, 0, r.x, r.y, r.w, r.h);
  }
  function applyZoom() {
    var w = img.w * zoom + 'px', h = img.h * zoom + 'px';
    cv.style.width = ov.style.width = gridEl.style.width = w;
    cv.style.height = ov.style.height = gridEl.style.height = h;
    sheet.style.width = w; sheet.style.height = h;
    gridEl.hidden = !(prefs.grid && zoom >= 4);
    gridEl.style.backgroundSize = zoom + 'px ' + zoom + 'px';
    placeSizer();
    drawSel();
    if (textBox) placeText();
    statusSize.textContent = sel ? sel.w + ' × ' + sel.h : img.w + ' × ' + img.h;
  }
  function setZoom(z, cx, cy) {
    var old = zoom;
    zoom = z;
    applyZoom();
    if (cx != null) {
      stage.scrollLeft = cx * z - stage.clientWidth / 2;
      stage.scrollTop = cy * z - stage.clientHeight / 2;
    } else if (old !== z) { stage.scrollLeft = stage.scrollLeft * z / old; stage.scrollTop = stage.scrollTop * z / old; }
  }

  // ---------- Rückgängig ----------
  // Ein Schritt merkt sich nur das geänderte Rechteck vorher und nachher, bei neuer Größe das ganze Bild
  function bytes(e) { return e.full ? e.before.d.length + e.after.d.length : e.before.d.length * 2; }
  function commit(box) {
    var r = box && P.clip(box, img);
    if (!r && box !== 'full') return;
    var e;
    if (box === 'full' || committed.w !== img.w || committed.h !== img.h) e = { full: true, before: committed, after: P.clone(img) };
    else e = { r: r, before: P.crop(committed, r.x, r.y, r.w, r.h), after: P.crop(img, r.x, r.y, r.w, r.h) };
    undo.push(e);
    redo = [];
    var total = 0;
    for (var i = undo.length - 1; i >= 0; i--) { total += bytes(undo[i]); if (undo.length - i > HISTORY || total > HISTORY_BYTES) { undo.splice(0, i + 1); break; } }
    if (e.full) committed = P.clone(img); else P.blit(committed, e.after, r.x, r.y);
    doc.dirty = true;
    updateTitle();
  }
  function step(from, to, back) {
    cancelMulti();
    dropSel(false);
    var e = from.pop();
    if (!e) return;
    to.push(e);
    if (e.full) { setImage(P.clone(back ? e.before : e.after), true); return; }
    var part = back ? e.before : e.after;
    // Durchsichtige Pixel kommen im Bild nicht vor, blit reicht
    P.blit(img, part, e.r.x, e.r.y); P.blit(committed, part, e.r.x, e.r.y);
    refresh(e.r);
    doc.dirty = true;
  }
  function doUndo() { if (textBox) return closeText(false); if (multi) return cancelMulti(); if (sel && !sel.lifted) return dropSel(false); step(undo, redo, true); }
  function doRedo() { step(redo, undo, false); }

  // ---------- Werkzeuge ----------
  var TOOLS = [
    ['free', 'Freihandauswahl', 'Wählt einen beliebig geformten Bereich aus, um ihn zu verschieben, zu kopieren oder zu bearbeiten.'],
    ['select', 'Auswahl', 'Wählt einen rechteckigen Bereich aus, um ihn zu verschieben, zu kopieren oder zu bearbeiten.'],
    ['eraser', 'Radierer/Farbradierer', 'Radiert mit der Hintergrundfarbe. Mit der rechten Maustaste wird nur die Vordergrundfarbe ersetzt.'],
    ['fill', 'Farbfüller', 'Füllt einen Bereich mit der Zeichenfarbe.'],
    ['pick', 'Farbe auswählen', 'Übernimmt eine Farbe aus dem Bild als Zeichenfarbe.'],
    ['zoom', 'Lupe', 'Ändert die Vergrößerung.'],
    ['pencil', 'Stift', 'Zeichnet eine Freihandlinie, ein Pixel breit.'],
    ['brush', 'Pinsel', 'Zeichnet mit einem Pinsel der gewählten Form und Größe.'],
    ['spray', 'Sprühdose', 'Sprüht in der gewählten Größe.'],
    ['text', 'Text', 'Fügt Text in das Bild ein.'],
    ['line', 'Linie', 'Zeichnet eine gerade Linie. Mit Umschalt waagerecht, senkrecht oder im 45°-Winkel.'],
    ['curve', 'Kurve', 'Zeichnet eine Kurve: Linie ziehen, dann bis zu zweimal zum Biegen ziehen.'],
    ['rect', 'Rechteck', 'Zeichnet ein Rechteck. Mit Umschalt ein Quadrat.'],
    ['poly', 'Vieleck', 'Zeichnet ein Vieleck: Ecken anklicken, Doppelklick schließt es.'],
    ['ellipse', 'Ellipse', 'Zeichnet eine Ellipse. Mit Umschalt einen Kreis.'],
    ['rrect', 'Abgerundetes Rechteck', 'Zeichnet ein abgerundetes Rechteck. Mit Umschalt ein Quadrat.'],
  ];
  var TOOL_INFO = {};
  TOOLS.forEach(function (t) { TOOL_INFO[t[0]] = { name: t[1], hint: t[2] }; });
  var BRUSHES = [];
  ['round', 'square', 'slash', 'backslash'].forEach(function (s) { P.BRUSH_SIZES.forEach(function (n) { BRUSHES.push([s, n]); }); });
  var ERASER = [4, 6, 8, 10], SPRAY = [4, 8, 12], ZOOMS = [1, 2, 6, 8];
  var WIDTH = function () { return prefs.opts.width + 1; };
  var cursorFor = { pencil: 'crosshair', brush: 'crosshair', spray: 'crosshair', line: 'crosshair', curve: 'crosshair', rect: 'crosshair', poly: 'crosshair', ellipse: 'crosshair', rrect: 'crosshair', free: 'crosshair', select: 'crosshair', fill: 'cell', pick: 'copy', zoom: 'zoom-in', text: 'text', eraser: 'cell' };

  function setTool(t) {
    if (t === tool) return;
    finishAll();
    if (t === 'pick' || t === 'zoom') lastTool = tool === 'pick' || tool === 'zoom' ? lastTool : tool;
    tool = t;
    root.querySelectorAll('.pt-tool').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); b.setAttribute('aria-pressed', b.dataset.tool === t); });
    sheet.style.cursor = cursorFor[t] || 'crosshair';
    renderOptions();
    $('.pt-fontbar').hidden = !(t === 'text' && prefs.view.text);
    hint(TOOL_INFO[t].hint);
  }
  function renderOptions() {
    var box = $('.pt-opts'), o = prefs.opts, h = '';
    var item = function (key, i, on, inner, title) { return '<button type="button" class="o' + (on ? ' on' : '') + '" data-opt="' + key + '" data-val="' + i + '" title="' + (title || '') + '">' + inner + '</button>'; };
    box.className = 'pt-opts';
    if (tool === 'brush') {
      box.classList.add('grid');
      BRUSHES.forEach(function (b, i) {
        var s = b[1], st = 'width:' + s + 'px;height:' + s + 'px;';
        if (b[0] === 'round') st += 'border-radius:50%;';
        if (b[0] === 'slash' || b[0] === 'backslash') st = 'width:' + Math.max(2, Math.round(s * 1.4)) + 'px;height:1px;transform:rotate(' + (b[0] === 'slash' ? -45 : 45) + 'deg);';
        h += item('brush', i, o.brush === i, '<i style="' + st + '"></i>');
      });
    } else if (tool === 'eraser') {
      ERASER.forEach(function (s, i) { h += item('eraser', i, o.eraser === i, '<i style="width:' + s + 'px;height:' + s + 'px"></i>', s + ' Pixel'); });
    } else if (tool === 'spray') {
      SPRAY.forEach(function (s, i) { h += item('spray', i, o.spray === i, '<b class="dots s' + i + '"></b>', 'Größe ' + (i + 1)); });
    } else if (tool === 'line' || tool === 'curve') {
      for (var i = 0; i < 5; i++) h += item('width', i, o.width === i, '<i style="width:28px;height:' + (i + 1) + 'px"></i>', (i + 1) + ' Pixel');
    } else if (tool === 'rect' || tool === 'poly' || tool === 'ellipse' || tool === 'rrect') {
      ['Nur Rand', 'Rand und Füllung', 'Nur Füllung'].forEach(function (t, i) { h += item('fill', i, o.fill === i, '<i class="fillmode f' + i + '"></i>', t); });
      h += '<span class="sep"></span>';
      for (var j = 0; j < 5; j++) h += item('width', j, o.width === j, '<i style="width:24px;height:' + (j + 1) + 'px"></i>', 'Rand ' + (j + 1) + ' Pixel');
      box.classList.add('tall');
    } else if (tool === 'select' || tool === 'free' || tool === 'text') {
      h += item('transparent', 0, !o.transparent, '<i class="selmode opaque"></i>', 'Deckend: der Hintergrund kommt mit');
      h += item('transparent', 1, o.transparent, '<i class="selmode trans"></i>', 'Durchsichtig: die Hintergrundfarbe fällt weg');
    } else if (tool === 'zoom') {
      ZOOMS.forEach(function (z, i) { h += item('zoom', i, o.zoom === i, z + 'x'); });
    }
    box.innerHTML = h;
  }
  $('.pt-opts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-opt]');
    if (!b) return;
    var k = b.dataset.opt, v = Number(b.dataset.val);
    prefs.opts[k] = k === 'transparent' ? v === 1 : v;
    savePrefs();
    renderOptions();
    if (k === 'transparent') { if (sel) drawSel(); if (textBox) styleText(); }
    if (k === 'zoom') setZoom(ZOOMS[v]);
  });

  // ---------- Farben ----------
  function renderColors() {
    $('.pt-cur .fg').style.background = P.toHex(fg);
    $('.pt-cur .bg').style.background = P.toHex(bg);
    // Zwei Reihen wie im Original: oben 14, unten 14. Die Knöpfe bleiben stehen, damit Doppelklicks ankommen.
    var pal = $('.pt-pal');
    if (!pal.children.length) pal.innerHTML = prefs.palette.map(function (c, i) { return '<button type="button" data-i="' + i + '"></button>'; }).join('');
    prefs.palette.forEach(function (c, i) { var b = pal.children[i]; b.style.background = P.toHex(c); b.title = P.toHex(c); });
    if (textBox) styleText();
    if (sel && prefs.opts.transparent) drawSel();
  }
  $('.pt-pal').addEventListener('pointerdown', function (e) {
    var b = e.target.closest('[data-i]');
    if (!b) return;
    var c = prefs.palette[Number(b.dataset.i)];
    if (e.button === 2) bg = c; else fg = c;
    renderColors();
  });
  $('.pt-pal').addEventListener('dblclick', function (e) { var b = e.target.closest('[data-i]'); if (b) editColors(Number(b.dataset.i)); });
  $('.pt-pal').addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // Auf dem Handy gibt es keinen Rechtsklick: Tippen auf das Farbkästchen tauscht Vorder- und Hintergrundfarbe
  $('.pt-cur').addEventListener('click', function () { var t = fg; fg = bg; bg = t; renderColors(); });

  // ---------- Status ----------
  function hint(t) { statusText.textContent = t || DEFAULT_HINT; }
  function updateTitle() {
    var t = (doc.title || 'unbenannt') + ' – Paint';
    document.title = t + (SITE ? ' – ' + SITE : '');
    $('[data-doc]').textContent = doc.id ? (doc.dirty ? '✱ ungespeichert' : '💾 gespeichert') : '';
  }

  // ---------- Maus ----------
  function pos(e) {
    var r = cv.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / zoom), Math.floor((e.clientY - r.top) / zoom)];
  }
  function inImg(p) { return p[0] >= 0 && p[1] >= 0 && p[0] < img.w && p[1] < img.h; }
  function colors(e) { return e.button === 2 ? [bg, fg] : [fg, bg]; }

  // Vorschau beim Ziehen von Formen: vor jedem Neuzeichnen den alten Stand wiederherstellen
  function restore(box) {
    var r = box && P.clip(box, img);
    if (!r) return;
    for (var y = r.y; y < r.y + r.h; y++) img.d.set(committed.d.subarray((y * img.w + r.x) * 4, (y * img.w + r.x + r.w) * 4), (y * img.w + r.x) * 4);
    refresh(r);
  }
  function constrain(a, b, square) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (square) { var m = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + (dx < 0 ? -m : m), a[1] + (dy < 0 ? -m : m)]; }
    // Linie: auf 0°, 45° oder 90° einrasten
    var ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.max(Math.abs(dx), Math.abs(dy));
    if (Math.abs(Math.cos(ang)) > 0.9 || Math.abs(Math.sin(ang)) > 0.9) return Math.abs(Math.cos(ang)) > 0.9 ? [b[0], a[1]] : [a[0], b[1]];
    return [a[0] + Math.sign(dx) * len, a[1] + Math.sign(dy) * len];
  }
  function shapeOpts(c) {
    var m = prefs.opts.fill;
    return { stroke: m === 2 ? null : c[0], fill: m === 0 ? null : m === 1 ? c[1] : c[0], width: WIDTH() };
  }

  sheet.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  sheet.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.target.closest('.pt-h, .pt-sizer, .pt-text')) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    var p = pos(e), c = colors(e);
    if (textBox) { closeText(true); if (tool === 'text') return; }
    // Klick in die schwebende Auswahl verschiebt sie, daneben wird sie abgesetzt
    if (sel && (tool === 'select' || tool === 'free' || sel.pasted)) {
      if (p[0] >= sel.x && p[1] >= sel.y && p[0] < sel.x + sel.w && p[1] < sel.y + sel.h) return startMove(e, p);
      dropSel(true);
      if (tool !== 'select' && tool !== 'free') return;
    }
    sheet.setPointerCapture(e.pointerId);
    var t = tool;
    if (t === 'pencil' || t === 'brush') {
      var st = t === 'pencil' ? P.stamp('square', 1) : P.stamp(BRUSHES[prefs.opts.brush][0], BRUSHES[prefs.opts.brush][1]);
      busy = { t: t, last: p, box: P.stroke(img, [p], c[0], st), st: st, c: c[0] };
      refresh(busy.box);
    } else if (t === 'eraser') {
      var only = e.button === 2 ? fg : null;
      busy = { t: t, last: p, size: ERASER[prefs.opts.eraser], only: only };
      busy.box = P.erase(img, [p], busy.size, bg, only);
      refresh(busy.box);
    } else if (t === 'spray') {
      var r = SPRAY[prefs.opts.spray];
      busy = { t: t, p: p, r: r, c: c[0], box: P.emptyBox() };
      var puff = function () { var b = P.spray(img, [busy.p], r, busy.c, seed++, Math.round(r * 1.2)); P.merge(busy.box, b); refresh(b); };
      puff();
      busy.timer = setInterval(puff, 35);
    } else if (t === 'fill') {
      if (!inImg(p)) return;
      var fb = P.flood(img, p[0], p[1], c[0]);
      if (fb) { refresh(fb); commit(fb); }
    } else if (t === 'pick') {
      if (!inImg(p)) return;
      var got = P.get(img, p[0], p[1]);
      if (e.button === 2) bg = got; else fg = got;
      renderColors();
      setTool(lastTool);
    } else if (t === 'zoom') {
      var z = ZOOMS[prefs.opts.zoom];
      setZoom(zoom === z || e.button === 2 ? 1 : z, p[0], p[1]);
      setTool(lastTool);
    } else if (t === 'line' || t === 'rect' || t === 'ellipse' || t === 'rrect') {
      busy = { t: t, a: p, b: p, c: c, prev: null };
      previewShape(e);
    } else if (t === 'curve') {
      if (!multi) { multi = { t: 'curve', pts: [p, p, p, p], stage: 0, c: c }; busy = { t: 'curve' }; previewCurve(); }
      else { multi.stage++; busy = { t: 'curve' }; bendCurve(p); }
    } else if (t === 'poly') {
      if (!multi) { multi = { t: 'poly', pts: [p, p], c: c, box: null }; busy = { t: 'poly' }; previewPoly(); }
      else {
        var first = multi.pts[0];
        if (Math.abs(p[0] - first[0]) <= 3 && Math.abs(p[1] - first[1]) <= 3 && multi.pts.length > 2) { multi.pts.pop(); finishPoly(); return; }
        multi.pts[multi.pts.length - 1] = p; multi.pts.push(p); busy = { t: 'poly' }; previewPoly();
      }
    } else if (t === 'select') {
      busy = { t: t, a: p, b: p };
      showFrame(p[0], p[1], 1, 1);
    } else if (t === 'free') {
      busy = { t: t, pts: [p] };
      octx.clearRect(0, 0, ov.width, ov.height);
    } else if (t === 'text') {
      busy = { t: t, a: p, b: p };
      showFrame(p[0], p[1], 1, 1);
    }
  });
  sheet.addEventListener('pointermove', function (e) {
    var p = pos(e);
    statusPos.textContent = inImg(p) ? p[0] + ', ' + p[1] : '';
    if (!busy) { if (multi && multi.t === 'poly' && multi.pts.length > 1) { multi.pts[multi.pts.length - 1] = e.shiftKey ? constrain(multi.pts[multi.pts.length - 2], p) : p; previewPoly(); } return; }
    var t = busy.t;
    if (t === 'pencil' || t === 'brush') {
      var b = P.stroke(img, [busy.last, p], busy.c, busy.st);
      P.merge(busy.box, b); refresh(b); busy.last = p;
    } else if (t === 'eraser') {
      var eb = P.erase(img, [busy.last, p], busy.size, bg, busy.only);
      P.merge(busy.box, eb); refresh(eb); busy.last = p;
    } else if (t === 'spray') busy.p = p;
    else if (t === 'line' || t === 'rect' || t === 'ellipse' || t === 'rrect') { busy.b = p; previewShape(e); }
    else if (t === 'curve') { if (multi.stage === 0) { multi.pts[3] = e.shiftKey ? constrain(multi.pts[0], p) : p; multi.pts[1] = multi.pts[0]; multi.pts[2] = multi.pts[3]; previewCurve(); } else bendCurve(p); }
    else if (t === 'poly') { multi.pts[multi.pts.length - 1] = e.shiftKey ? constrain(multi.pts[multi.pts.length - 2], p) : p; previewPoly(); }
    else if (t === 'select' || t === 'text') {
      busy.b = p;
      var n = rectOf(busy.a, p);
      showFrame(n.x, n.y, n.w, n.h);
      statusSize.textContent = n.w + ' × ' + n.h;
    } else if (t === 'free') {
      var last = busy.pts[busy.pts.length - 1];
      if (last[0] !== p[0] || last[1] !== p[1]) busy.pts.push(p);
      drawLasso(busy.pts);
    }
  });
  function endPointer(e) {
    if (!busy) return;
    var b = busy, t = b.t;
    busy = null;
    if (t === 'pencil' || t === 'brush' || t === 'eraser') commit(b.box);
    else if (t === 'spray') { clearInterval(b.timer); commit(b.box); }
    else if (t === 'line' || t === 'rect' || t === 'ellipse' || t === 'rrect') { if (b.prev) commit(b.prev); }
    else if (t === 'curve') { if (multi.stage >= 2) finishCurve(); }
    else if (t === 'select') {
      var n = rectOf(b.a, b.b);
      hideFrame();
      if (n.w > 1 || n.h > 1) makeSel(n.x, n.y, n.w, n.h, null);
    } else if (t === 'free') {
      octx.clearRect(0, 0, ov.width, ov.height);
      if (b.pts.length > 2) {
        var box = P.emptyBox();
        b.pts.forEach(function (q) { P.growXY(box, q[0], q[1]); });
        var r = P.clip(box, img);
        if (r) makeSel(r.x, r.y, r.w, r.h, P.polyMask(b.pts, r.x, r.y, r.w, r.h));
      }
    } else if (t === 'text') {
      var tr = rectOf(b.a, b.b);
      hideFrame();
      openText(tr.x, tr.y, Math.max(tr.w, 60), Math.max(tr.h, prefs.opts.fontSize + 8));
    }
  }
  sheet.addEventListener('pointerup', endPointer);
  sheet.addEventListener('pointercancel', endPointer);
  sheet.addEventListener('pointerleave', function () { if (!busy) statusPos.textContent = ''; });
  sheet.addEventListener('dblclick', function () { if (multi && multi.t === 'poly') { multi.pts.pop(); finishPoly(); } });

  function rectOf(a, b) {
    var x0 = clamp(Math.min(a[0], b[0]), 0, img.w - 1), y0 = clamp(Math.min(a[1], b[1]), 0, img.h - 1);
    var x1 = clamp(Math.max(a[0], b[0]), 0, img.w - 1), y1 = clamp(Math.max(a[1], b[1]), 0, img.h - 1);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function previewShape(e) {
    var b = busy;
    if (b.prev) restore(b.prev);
    var end = e.shiftKey ? constrain(b.a, b.b, b.t !== 'line') : b.b;
    var box = b.t === 'line' ? P.line(img, b.a[0], b.a[1], end[0], end[1], b.c[0], WIDTH()) : P.shape(img, b.t, b.a[0], b.a[1], end[0], end[1], shapeOpts(b.c));
    b.prev = { x0: box.x0 - 1, y0: box.y0 - 1, x1: box.x1 + 1, y1: box.y1 + 1 };
    refresh(b.prev);
    statusSize.textContent = (Math.abs(end[0] - b.a[0]) + 1) + ' × ' + (Math.abs(end[1] - b.a[1]) + 1);
  }
  function previewCurve() {
    if (multi.box) restore(multi.box);
    var q = multi.pts, box = P.curve(img, q[0], q[1], q[2], q[3], multi.c[0], WIDTH());
    multi.box = { x0: box.x0 - 1, y0: box.y0 - 1, x1: box.x1 + 1, y1: box.y1 + 1 };
    refresh(multi.box);
  }
  function bendCurve(p) {
    if (multi.stage === 1) { multi.pts[1] = p; multi.pts[2] = p; } else multi.pts[2] = p;
    previewCurve();
  }
  function finishCurve() { var box = multi.box; multi = null; if (box) commit(box); }
  function previewPoly() {
    if (multi.box) restore(multi.box);
    var box = P.stroke(img, multi.pts, multi.c[0], P.pen(WIDTH()));
    multi.box = { x0: box.x0 - 1, y0: box.y0 - 1, x1: box.x1 + 1, y1: box.y1 + 1 };
    refresh(multi.box);
  }
  function finishPoly() {
    var m = multi;
    multi = null;
    if (m.box) restore(m.box);
    if (m.pts.length < 2) return;
    var box = P.polygon(img, m.pts, shapeOpts(m.c));
    box = { x0: box.x0 - 3, y0: box.y0 - 3, x1: box.x1 + 3, y1: box.y1 + 3 };
    refresh(box);
    commit(box);
  }
  function cancelMulti() { if (multi) { if (multi.box) restore(multi.box); multi = null; } }
  // Vieleck mit Rand: Kurve und Vieleck schließen ab, wenn man das Werkzeug wechselt
  function finishAll() {
    if (busy) endPointer();
    if (multi) { if (multi.t === 'poly') { multi.pts.pop(); finishPoly(); } else if (multi.stage >= 1) finishCurve(); else cancelMulti(); }
    if (textBox) closeText(true);
    if (sel) dropSel(true);
  }

  // ---------- Auswahl ----------
  function showFrame(x, y, w, h) {
    frame.hidden = false;
    frame.style.left = x * zoom + 'px'; frame.style.top = y * zoom + 'px';
    frame.style.width = w * zoom + 'px'; frame.style.height = h * zoom + 'px';
    frame.classList.toggle('handles', !!sel);
  }
  function hideFrame() { frame.hidden = true; }
  function drawLasso(pts) {
    octx.clearRect(0, 0, ov.width, ov.height);
    octx.fillStyle = '#000';
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
      for (var k = 0; k <= n; k++) { var x = Math.round(a[0] + (b[0] - a[0]) * k / n), y = Math.round(a[1] + (b[1] - a[1]) * k / n); if ((x + y) % 4 < 2) octx.fillRect(x, y, 1, 1); }
    }
  }
  // Eine Auswahl bleibt erst an ihrem Platz. Wird sie bewegt, gestreckt oder gelöscht, wird sie „angehoben“:
  // An ihrer alten Stelle bleibt die Hintergrundfarbe, wie im Original.
  function makeSel(x, y, w, h, mask, bmp, pasted) {
    var b = bmp || P.crop(img, x, y, w, h);
    if (mask) P.applyMask(b, mask);
    sel = { src: bmp ? null : { x: x, y: y, w: w, h: h, mask: mask }, bmp: b, x: x, y: y, w: w, h: h, lifted: !!bmp, pasted: !!pasted, box: P.emptyBox() };
    if (sel.lifted) P.merge(sel.box, { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 });
    drawSel();
  }
  function lift() {
    if (!sel || sel.lifted) return;
    var s = sel.src;
    P.fillRect(img, s.x, s.y, s.w, s.h, bg, s.mask);
    P.merge(sel.box, { x0: s.x, y0: s.y, x1: s.x + s.w - 1, y1: s.y + s.h - 1 });
    sel.lifted = true;
    refresh(s);
  }
  // Bild der Auswahl in ihrer jetzigen Größe, bei „durchsichtig“ ohne die Hintergrundfarbe
  function selBitmap() {
    var b = sel.w === sel.bmp.w && sel.h === sel.bmp.h ? sel.bmp : P.scale(sel.bmp, sel.w, sel.h);
    return b;
  }
  function drawSel() {
    octx.clearRect(0, 0, ov.width, ov.height);
    if (!sel) { hideFrame(); statusSize.textContent = img ? img.w + ' × ' + img.h : ''; return; }
    if (sel.lifted) {
      var b = selBitmap(), show = P.clone(b);
      if (prefs.opts.transparent) for (var i = 0; i < show.d.length; i += 4) if ((show.d[i] << 16 | show.d[i + 1] << 8 | show.d[i + 2]) === bg) show.d[i + 3] = 0;
      octx.putImageData(new ImageData(show.d, show.w, show.h), sel.x, sel.y);
    }
    showFrame(sel.x, sel.y, sel.w, sel.h);
    statusSize.textContent = sel.w + ' × ' + sel.h;
  }
  function stampSel() {
    var b = selBitmap();
    P.blit(img, b, sel.x, sel.y, prefs.opts.transparent ? bg : null);
    P.merge(sel.box, { x0: sel.x, y0: sel.y, x1: sel.x + sel.w - 1, y1: sel.y + sel.h - 1 });
    refresh({ x: sel.x, y: sel.y, w: sel.w, h: sel.h });
  }
  // Absetzen (place) oder verwerfen. Eine nicht angehobene Auswahl ändert nichts.
  function dropSel(place) {
    if (!sel) return;
    if (sel.lifted && place) stampSel();
    var box = sel.lifted ? sel.box : null;
    sel = null;
    drawSel();
    if (box) commit(box);
  }
  function startMove(e, p) {
    var copy = e.ctrlKey, smear = e.shiftKey;
    // Strg: Kopie bleibt liegen. Umschalt: zieht eine Spur hinter sich her.
    if (copy && sel.lifted) stampSel();
    if (!sel.lifted) { if (copy) sel.lifted = true; else lift(); P.merge(sel.box, { x0: sel.src.x, y0: sel.src.y, x1: sel.src.x + sel.src.w - 1, y1: sel.src.y + sel.src.h - 1 }); }
    sheet.setPointerCapture(e.pointerId);
    var dx = p[0] - sel.x, dy = p[1] - sel.y;
    var move = function (ev) {
      var q = pos(ev);
      sel.x = q[0] - dx; sel.y = q[1] - dy;
      if (smear) stampSel();
      drawSel();
      statusPos.textContent = sel.x + ', ' + sel.y;
    };
    var up = function () { sheet.removeEventListener('pointermove', move); sheet.removeEventListener('pointerup', up); sheet.removeEventListener('pointercancel', up); };
    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', up);
    sheet.addEventListener('pointercancel', up);
  }
  // Anfasser: strecken in alle Richtungen
  frame.addEventListener('pointerdown', function (e) {
    var h = e.target.closest('.pt-h');
    if (!h || !sel) return;
    e.preventDefault(); e.stopPropagation();
    lift();
    var dir = h.dataset.dir, start = pos(e), o = { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
    h.setPointerCapture(e.pointerId);
    var move = function (ev) {
      var q = pos(ev), dx = q[0] - start[0], dy = q[1] - start[1];
      var x = o.x, y = o.y, w = o.w, hh = o.h;
      if (dir.indexOf('e') >= 0) w = Math.max(1, o.w + dx);
      if (dir.indexOf('s') >= 0) hh = Math.max(1, o.h + dy);
      if (dir.indexOf('w') >= 0) { w = Math.max(1, o.w - dx); x = o.x + o.w - w; }
      if (dir.indexOf('n') >= 0) { hh = Math.max(1, o.h - dy); y = o.y + o.h - hh; }
      if (ev.shiftKey) { var f = Math.max(w / o.w, hh / o.h); w = Math.round(o.w * f); hh = Math.round(o.h * f); if (dir.indexOf('w') >= 0) x = o.x + o.w - w; if (dir.indexOf('n') >= 0) y = o.y + o.h - hh; }
      sel.x = x; sel.y = y; sel.w = w; sel.h = hh;
      drawSel();
    };
    var up = function () { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  });

  function selectAll() { finishAll(); setTool('select'); makeSel(0, 0, img.w, img.h, null); }
  function deleteSel() { if (!sel) return; lift(); sel.lifted = true; var box = sel.box; sel = null; drawSel(); commit(box); }
  function copySel(cut) {
    if (!sel) return;
    var b = sel.lifted ? selBitmap() : sel.bmp;
    clip = P.clone(b);
    toBlob(clip, 'image/png').then(function (blob) {
      if (navigator.clipboard && window.ClipboardItem) navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(function () { /* nur eigene Zwischenablage */ });
    });
    if (cut) deleteSel();
  }
  function pasteBitmap(b, at) {
    finishAll();
    if (b.w > img.w || b.h > img.h) {
      return msgbox('Das eingefügte Bild ist größer als das Bild. Soll das Bild vergrößert werden?', '❓', ['Ja', 'Nein', 'Abbrechen']).then(function (r) {
        if (r === 'Abbrechen') return;
        if (r === 'Ja') { img = P.resize(img, clamp(Math.max(b.w, img.w), 1, MAX_W), clamp(Math.max(b.h, img.h), 1, MAX_H), bg); setImage(img, true); commit('full'); }
        place();
      });
    }
    place();
    function place() {
      setTool('select');
      var x = at ? at[0] : Math.floor(stage.scrollLeft / zoom), y = at ? at[1] : Math.floor(stage.scrollTop / zoom);
      makeSel(x, y, b.w, b.h, null, b, true);
      hint('Ziehen verschiebt das eingefügte Bild, die Anfasser strecken es (mit Umschalt im Seitenverhältnis). Klick daneben setzt es ab.');
    }
  }
  function decodeFile(file) {
    if (!file || !/^image\//.test(file.type)) return Promise.reject(new Error('Das ist kein Bild.'));
    return createImageBitmap(file).then(function (bm) {
      var w = bm.width, h = bm.height, s = Math.min(1, MAX_W / w, MAX_H / h);
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var x = c.getContext('2d');
      x.drawImage(bm, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data;
      // Halb durchsichtige Pixel gegen Weiß, ganz durchsichtige bleiben durchsichtig (schweben dann wie „durchsichtig“)
      for (var i = 0; i < d.length; i += 4) {
        var a = d[i + 3];
        if (a && a < 255) { var f = a / 255; d[i] = d[i] * f + 255 * (1 - f); d[i + 1] = d[i + 1] * f + 255 * (1 - f); d[i + 2] = d[i + 2] * f + 255 * (1 - f); d[i + 3] = a < 128 ? 0 : 255; }
      }
      return { w: w, h: h, d: new Uint8ClampedArray(d.buffer) };
    });
  }
  function pasteFromClipboard() {
    if (navigator.clipboard && navigator.clipboard.read) {
      return navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var type = items[i].types.find(function (t) { return /^image\//.test(t); });
          if (type) return items[i].getType(type).then(function (blob) { return decodeFile(new File([blob], 'x', { type: type })); }).then(function (b) { pasteBitmap(b); });
        }
        if (clip) pasteBitmap(P.clone(clip));
      }).catch(function () { if (clip) pasteBitmap(P.clone(clip)); else hint('Zum Einfügen Strg+V drücken (der Browser gibt die Zwischenablage nur so her).'); });
    }
    if (clip) pasteBitmap(P.clone(clip));
  }
  document.addEventListener('paste', function (e) {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    var items = e.clipboardData && e.clipboardData.items;
    for (var i = 0; items && i < items.length; i++) {
      if (/^image\//.test(items[i].type)) {
        e.preventDefault();
        decodeFile(items[i].getAsFile()).then(function (b) { pasteBitmap(b); }, function () { /* kein Bild */ });
        return;
      }
    }
    if (clip) { e.preventDefault(); pasteBitmap(P.clone(clip)); }
  });
  stage.addEventListener('dragover', function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  stage.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    var p = pos(e);
    decodeFile(f).then(function (b) { pasteBitmap(b, [clamp(p[0], 0, img.w - 1), clamp(p[1], 0, img.h - 1)]); }, function (err) { msgbox(err.message, '⚠️'); });
  });
  function pickFile(cb) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', function () { if (inp.files[0]) cb(inp.files[0]); });
    inp.click();
  }

  // ---------- Text ----------
  function openText(x, y, w, h) {
    var ta = document.createElement('textarea');
    ta.className = 'pt-text';
    ta.spellcheck = false;
    sheet.appendChild(ta);
    textBox = { el: ta, x: x, y: y, w: Math.min(w, img.w - x), h: Math.min(h, img.h - y) };
    placeText(); styleText();
    $('.pt-fontbar').hidden = !prefs.view.text;
    setTimeout(function () { ta.focus(); }, 0);
  }
  function placeText() {
    var t = textBox.el.style;
    t.left = textBox.x * zoom + 'px'; t.top = textBox.y * zoom + 'px';
    t.width = textBox.w * zoom + 'px'; t.height = textBox.h * zoom + 'px';
    styleText();
  }
  function fontCss(scale) {
    var o = prefs.opts;
    return (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + o.fontSize * scale + 'px "' + o.font + '", sans-serif';
  }
  function styleText() {
    if (!textBox) return;
    var t = textBox.el.style;
    t.font = fontCss(zoom);
    t.lineHeight = Math.round(prefs.opts.fontSize * 1.2) * zoom + 'px';
    t.textDecoration = prefs.opts.underline ? 'underline' : 'none';
    t.color = P.toHex(fg);
    t.background = prefs.opts.transparent ? 'transparent' : P.toHex(bg);
  }
  // Text wird mit der Schrift des Browsers gezeichnet und dann hart gerastert: halb gedeckte Pixel werden
  // ganz oder gar nicht gesetzt, damit er so pixelig wirkt wie früher
  function closeText(apply) {
    var tb = textBox;
    textBox = null;
    $('.pt-fontbar').hidden = !(tool === 'text' && prefs.view.text);
    var text = tb.el.value;
    tb.el.remove();
    if (!apply || !text.trim()) return;
    var o = prefs.opts, lh = Math.round(o.fontSize * 1.2);
    var c = document.createElement('canvas');
    c.width = tb.w; c.height = tb.h;
    var x = c.getContext('2d');
    x.font = fontCss(1);
    x.textBaseline = 'top';
    x.fillStyle = '#000';
    var lines = [];
    text.split('\n').forEach(function (para) {
      var words = para.split(/(\s+)/), cur = '';
      words.forEach(function (wd) {
        if (cur && x.measureText(cur + wd).width > tb.w - 2) { lines.push(cur); cur = wd.trimStart(); } else cur += wd;
      });
      lines.push(cur);
    });
    lines.forEach(function (l, i) {
      var y = 1 + i * lh;
      x.fillText(l, 1, y + Math.round((lh - o.fontSize) / 2));
      if (o.underline) x.fillRect(1, y + Math.round((lh + o.fontSize) / 2), x.measureText(l).width, Math.max(1, Math.round(o.fontSize / 14)));
    });
    var d = x.getImageData(0, 0, tb.w, tb.h).data;
    if (!o.transparent) P.fillRect(img, tb.x, tb.y, tb.w, tb.h, bg);
    for (var j = 0; j < tb.h; j++) for (var i = 0; i < tb.w; i++) if (d[(j * tb.w + i) * 4 + 3] >= 128) P.set(img, tb.x + i, tb.y + j, fg);
    var box = { x0: tb.x, y0: tb.y, x1: tb.x + tb.w - 1, y1: tb.y + tb.h - 1 };
    refresh(box);
    commit(box);
  }
  var fontbar = $('.pt-fontbar');
  fontbar.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'font') prefs.opts.font = t.value;
    if (t.name === 'size') prefs.opts.fontSize = clamp(Number(t.value) || 16, 6, 96);
    savePrefs(); styleText();
    if (textBox) textBox.el.focus();
  });
  fontbar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-style]');
    if (!b) return;
    var k = b.dataset.style;
    prefs.opts[k] = !prefs.opts[k];
    b.classList.toggle('on', prefs.opts[k]);
    savePrefs(); styleText();
    if (textBox) textBox.el.focus();
  });
  function syncFontbar() {
    fontbar.querySelector('[name=font]').value = prefs.opts.font;
    fontbar.querySelector('[name=size]').value = String(prefs.opts.fontSize);
    fontbar.querySelectorAll('[data-style]').forEach(function (b) { b.classList.toggle('on', !!prefs.opts[b.dataset.style]); });
  }

  // ---------- Leinwand-Größe mit der Maus ----------
  var HANDLE_POS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], w: [0, 0.5], e: [1, 0.5], sw: [0, 1], s: [0.5, 1], se: [1, 1] };
  function placeSizer() {
    sizer.querySelectorAll('.pt-h').forEach(function (h) {
      var f = HANDLE_POS[h.dataset.dir];
      h.style.left = Math.round(f[0] * img.w * zoom) + (f[0] === 1 ? 1 : f[0] === 0 ? -4 : -1) + 'px';
      h.style.top = Math.round(f[1] * img.h * zoom) + (f[1] === 1 ? 1 : f[1] === 0 ? -4 : -1) + 'px';
    });
  }
  sizer.addEventListener('pointerdown', function (e) {
    var h = e.target.closest('.pt-h[data-live]');
    if (!h) return;
    e.preventDefault();
    finishAll();
    var dir = h.dataset.dir, sx = e.clientX, sy = e.clientY, w = img.w, hh = img.h, out = $('.pt-resize');
    h.setPointerCapture(e.pointerId);
    out.hidden = false;
    var nw = w, nh = hh;
    var move = function (ev) {
      if (dir !== 's') nw = clamp(Math.round(w + (ev.clientX - sx) / zoom), 1, MAX_W);
      if (dir !== 'e') nh = clamp(Math.round(hh + (ev.clientY - sy) / zoom), 1, MAX_H);
      out.style.width = nw * zoom + 'px'; out.style.height = nh * zoom + 'px';
      statusSize.textContent = nw + ' × ' + nh;
    };
    var up = function () {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
      out.hidden = true;
      if (nw !== img.w || nh !== img.h) resizeTo(nw, nh);
    };
    move(e);
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  });
  function resizeTo(w, h) {
    setImage(P.resize(img, w, h, bg), true);
    commit('full');
    prefs.size = [w, h]; savePrefs();
  }

  // ---------- Bild-Menü ----------
  // Mit Auswahl wirken die Befehle nur auf die Auswahl, sonst auf das ganze Bild
  function transform(fn) {
    if (sel) {
      lift();
      var b = fn(selBitmap());
      sel.bmp = b; sel.w = b.w; sel.h = b.h;
      drawSel();
      return;
    }
    finishAll();
    setImage(fn(img), true);
    commit('full');
  }
  function flipRotate() {
    dialog('Kippen/Drehen', '<fieldset class="groupbox"><legend>Kippen oder drehen</legend>' +
      '<label class="inline"><input type="radio" name="m" value="h" checked> Horizontal kippen</label><br>' +
      '<label class="inline"><input type="radio" name="m" value="v"> Vertikal kippen</label><br>' +
      '<label class="inline"><input type="radio" name="m" value="r"> Drehen um</label>' +
      '<div style="padding-left:24px"><label class="inline"><input type="radio" name="a" value="90" checked> 90°</label><br><label class="inline"><input type="radio" name="a" value="180"> 180°</label><br><label class="inline"><input type="radio" name="a" value="270"> 270°</label></div></fieldset>',
    ['OK', 'Abbrechen']).then(function (r) {
      if (r.button !== 'OK') return;
      var m = r.form.m.value, a = Number(r.form.a.value);
      transform(function (b) { return m === 'h' ? P.flipH(b) : m === 'v' ? P.flipV(b) : P.rotate(b, a); });
    });
  }
  function stretchSkew() {
    dialog('Strecken und Zerren', '<fieldset class="groupbox"><legend>Strecken</legend>' +
      '<label class="inline">↔ Horizontal: <input type="number" name="sx" value="100" min="1" max="500" style="width:64px"> %</label><br>' +
      '<label class="inline">↕ Vertikal: <input type="number" name="sy" value="100" min="1" max="500" style="width:64px"> %</label></fieldset>' +
      '<fieldset class="groupbox"><legend>Zerren</legend>' +
      '<label class="inline">▱ Horizontal: <input type="number" name="ax" value="0" min="-89" max="89" style="width:64px"> Grad</label><br>' +
      '<label class="inline">⏢ Vertikal: <input type="number" name="ay" value="0" min="-89" max="89" style="width:64px"> Grad</label></fieldset>',
    ['OK', 'Abbrechen']).then(function (r) {
      if (r.button !== 'OK') return;
      var f = r.form, sx = clamp(Number(f.sx.value) || 100, 1, 500), sy = clamp(Number(f.sy.value) || 100, 1, 500);
      var ax = clamp(Number(f.ax.value) || 0, -89, 89), ay = clamp(Number(f.ay.value) || 0, -89, 89);
      transform(function (b) {
        var out = sx !== 100 || sy !== 100 ? P.scale(b, clamp(Math.round(b.w * sx / 100), 1, MAX_W), clamp(Math.round(b.h * sy / 100), 1, MAX_H)) : b;
        if (ax || ay) out = P.skew(out, ax, ay, bg);
        if (out.w > MAX_W || out.h > MAX_H) out = P.crop(out, 0, 0, Math.min(out.w, MAX_W), Math.min(out.h, MAX_H));
        return out === b ? P.clone(b) : out;
      });
    });
  }
  function invertColors() {
    if (sel) { lift(); var b = selBitmap(); P.invert(b); sel.bmp = b; drawSel(); return; }
    finishAll();
    P.invert(img); refresh();
    commit({ x0: 0, y0: 0, x1: img.w - 1, y1: img.h - 1 });
  }
  function attributes() {
    dialog('Attribute', '<p><small>Gespeichert: ' + (doc.id ? esc(doc.title) : 'noch nicht') + '</small></p>' +
      '<div class="row"><label>Breite <input type="number" name="w" min="1" max="' + MAX_W + '" value="' + img.w + '" style="width:80px"></label>' +
      '<label>Höhe <input type="number" name="h" min="1" max="' + MAX_H + '" value="' + img.h + '" style="width:80px"></label></div>' +
      '<p><small>Einheit: Pixel · höchstens ' + MAX_W + ' × ' + MAX_H + '</small></p>' +
      '<fieldset class="groupbox"><legend>Farben</legend><label class="inline"><input type="radio" name="c" value="bw"> Schwarzweiß</label> <label class="inline"><input type="radio" name="c" value="color" checked> Farbe</label></fieldset>',
    ['OK', 'Abbrechen', 'Standard']).then(function (r) {
      if (r.button === 'Abbrechen') return;
      var w = r.button === 'Standard' ? 640 : clamp(Number(r.form.w.value) || img.w, 1, MAX_W);
      var h = r.button === 'Standard' ? 480 : clamp(Number(r.form.h.value) || img.h, 1, MAX_H);
      finishAll();
      if (w !== img.w || h !== img.h) resizeTo(w, h);
      if (r.form.c.value === 'bw') { P.monochrome(img); refresh(); commit('full'); }
    });
  }
  function clearImage() {
    if (sel) return deleteSel();
    finishAll();
    P.clear(img, bg); refresh();
    commit({ x0: 0, y0: 0, x1: img.w - 1, y1: img.h - 1 });
  }
  function cropToSel() {
    if (!sel) return;
    var b = sel.lifted ? selBitmap() : sel.bmp, keep = P.clone(b);
    sel = null; drawSel();
    for (var i = 3; i < keep.d.length; i += 4) if (!keep.d[i]) { keep.d[i - 3] = bg >> 16 & 255; keep.d[i - 2] = bg >> 8 & 255; keep.d[i - 1] = bg & 255; keep.d[i] = 255; }
    setImage(keep, true);
    commit('full');
  }

  // ---------- Farben bearbeiten ----------
  // Der alte Windows-Farbdialog: Grundfarben, eigene Farben, Farbfeld mit Farbton/Sättigung und Helligkeitsleiste
  var BASIC = [0xff8080, 0xffff80, 0x80ff80, 0x00ff80, 0x80ffff, 0x0080ff, 0xff80c0, 0xff80ff, 0xff0000, 0xffff00, 0x80ff00, 0x00ff40, 0x00ffff, 0x0080c0, 0x8080c0, 0xff00ff,
    0x804040, 0xff8040, 0x00ff00, 0x008080, 0x004080, 0x8080ff, 0x800040, 0xff0080, 0x800000, 0xff8000, 0x008000, 0x008040, 0x0000ff, 0x0000a0, 0x800080, 0x8000ff,
    0x400000, 0x804000, 0x004000, 0x004040, 0x000080, 0x000040, 0x400040, 0x400080, 0x000000, 0x808000, 0x808040, 0x808080, 0x408080, 0xc0c0c0, 0x400040, 0xffffff];
  function hsl2rgb(h, s, l) { // 0..240 wie bei Windows
    h /= 240; s /= 240; l /= 240;
    var f = function (p, q, t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var r = s ? f(p, q, h + 1 / 3) : l, g = s ? f(p, q, h) : l, b = s ? f(p, q, h - 1 / 3) : l;
    return Math.round(r * 255) << 16 | Math.round(g * 255) << 8 | Math.round(b * 255);
  }
  function rgb2hsl(c) {
    var r = (c >> 16 & 255) / 255, g = (c >> 8 & 255) / 255, b = (c & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [Math.round(h * 240) % 240, Math.round(s * 240), Math.round(l * 240)];
  }
  function editColors(index) {
    var slot = index == null ? null : index, start = slot == null ? fg : prefs.palette[slot], cur = start, customPick = 0;
    var cells = function (list, name) { return list.map(function (c, i) { return '<button type="button" class="cd-cell" data-' + name + '="' + i + '" style="background:' + P.toHex(c) + '"></button>'; }).join(''); };
    var body = '<div class="cd"><div class="cd-left"><div>Grundfarben:</div><div class="cd-grid">' + cells(BASIC, 'basic') + '</div>' +
      '<div>Benutzerdefinierte Farben:</div><div class="cd-grid cd-custom">' + cells(prefs.custom, 'custom') + '</div></div>' +
      '<div class="cd-right"><div class="cd-spec-wrap"><canvas class="cd-spec" width="180" height="150"></canvas><i class="cd-cross"></i></div><canvas class="cd-lum" width="12" height="150"></canvas><i class="cd-arrow">◀</i>' +
      '<div class="cd-fields"><div class="cd-prev"></div><div class="cd-num">' +
      '<label>Farbton: <input type="number" name="h" min="0" max="239"></label><label>Rot: <input type="number" name="r" min="0" max="255"></label>' +
      '<label>Sätt.: <input type="number" name="s" min="0" max="240"></label><label>Grün: <input type="number" name="g" min="0" max="255"></label>' +
      '<label>Hell.: <input type="number" name="l" min="0" max="240"></label><label>Blau: <input type="number" name="b" min="0" max="255"></label></div></div>' +
      '<button type="button" data-add class="w100">Farben hinzufügen</button></div></div>';
    var dlg = dialog('Farben bearbeiten', body, ['OK', 'Abbrechen'], 'cd-dialog');
    var box = dlg.el, f = box.querySelector('form');
    var spec = box.querySelector('.cd-spec'), lum = box.querySelector('.cd-lum'), sctx = spec.getContext('2d'), lctx = lum.getContext('2d');
    var data = sctx.createImageData(180, 150);
    for (var y = 0; y < 150; y++) for (var x = 0; x < 180; x++) {
      var c = hsl2rgb(x / 180 * 240, 240 - y / 150 * 240, 120), i = (y * 180 + x) * 4;
      data.data[i] = c >> 16 & 255; data.data[i + 1] = c >> 8 & 255; data.data[i + 2] = c & 255; data.data[i + 3] = 255;
    }
    sctx.putImageData(data, 0, 0);
    var hsl = rgb2hsl(cur);
    function show(fromHsl) {
      if (fromHsl) cur = hsl2rgb(hsl[0], hsl[1], hsl[2]); else hsl = rgb2hsl(cur);
      f.h.value = hsl[0]; f.s.value = hsl[1]; f.l.value = hsl[2];
      f.r.value = cur >> 16 & 255; f.g.value = cur >> 8 & 255; f.b.value = cur & 255;
      box.querySelector('.cd-prev').style.background = P.toHex(cur);
      var cross = box.querySelector('.cd-cross').style;
      cross.left = hsl[0] / 240 * 180 + 'px'; cross.top = (240 - hsl[1]) / 240 * 150 + 'px';
      for (var yy = 0; yy < 150; yy++) { lctx.fillStyle = P.toHex(hsl2rgb(hsl[0], hsl[1], 240 - yy / 150 * 240)); lctx.fillRect(0, yy, 12, 1); }
      box.querySelector('.cd-arrow').style.top = (240 - hsl[2]) / 240 * 150 - 7 + 'px';
    }
    show(false);
    var drag = function (el, fn) {
      el.addEventListener('pointerdown', function (e) {
        el.setPointerCapture(e.pointerId); fn(e);
        var mv = function (ev) { fn(ev); }, up = function () { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
    };
    drag(spec, function (e) { var r = spec.getBoundingClientRect(); hsl[0] = clamp(Math.round((e.clientX - r.left) / 180 * 240), 0, 239); hsl[1] = clamp(Math.round(240 - (e.clientY - r.top) / 150 * 240), 0, 240); if (hsl[2] === 0 || hsl[2] === 240) hsl[2] = 120; show(true); });
    drag(lum, function (e) { var r = lum.getBoundingClientRect(); hsl[2] = clamp(Math.round(240 - (e.clientY - r.top) / 150 * 240), 0, 240); show(true); });
    f.addEventListener('input', function (e) {
      var n = e.target.name;
      if ('hsl'.indexOf(n) >= 0) { hsl = [clamp(+f.h.value | 0, 0, 239), clamp(+f.s.value | 0, 0, 240), clamp(+f.l.value | 0, 0, 240)]; show(true); }
      else if ('rgb'.indexOf(n) >= 0) { cur = clamp(+f.r.value | 0, 0, 255) << 16 | clamp(+f.g.value | 0, 0, 255) << 8 | clamp(+f.b.value | 0, 0, 255); show(false); }
    });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.cd-cell');
      if (b && b.dataset.basic) { cur = BASIC[+b.dataset.basic]; show(false); }
      if (b && b.dataset.custom) { customPick = +b.dataset.custom; cur = prefs.custom[customPick]; show(false); }
      if (e.target.closest('[data-add]')) {
        prefs.custom[customPick] = cur;
        box.querySelectorAll('.cd-custom .cd-cell')[customPick].style.background = P.toHex(cur);
        customPick = (customPick + 1) % 16;
        savePrefs();
      }
    });
    dlg.done.then(function (r) {
      if (r.button !== 'OK') return;
      if (slot != null) prefs.palette[slot] = cur;
      fg = cur;
      savePrefs(); renderColors();
    });
  }
  // Palette als Datei: eine Zeile pro Farbe (#rrggbb), leicht zu lesen und zu bearbeiten
  function savePalette() { download(new Blob([prefs.palette.map(P.toHex).join('\n') + '\n'], { type: 'text/plain' }), 'palette.pal'); }
  function loadPalette() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.pal,.txt,text/plain';
    inp.addEventListener('change', function () {
      var file = inp.files[0];
      if (!file) return;
      file.text().then(function (t) {
        var list = (t.match(/#?[0-9a-f]{6}\b/gi) || []).map(P.fromHex);
        if (list.length < 28) return msgbox('Die Datei enthält keine Palette mit 28 Farben.', '⚠️');
        prefs.palette = list.slice(0, 28); savePrefs(); renderColors();
      });
    });
    inp.click();
  }

  // ---------- Dateien ----------
  function toCanvas(b) {
    var c = document.createElement('canvas');
    c.width = b.w; c.height = b.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b.d), b.w, b.h), 0, 0);
    return c;
  }
  function toBlob(b, type) {
    if (type === 'image/bmp') return Promise.resolve(new Blob([P.encodeBMP(b)], { type: type }));
    var c = toCanvas(b);
    if (type === 'image/jpeg') { var x = c.getContext('2d'); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
    return new Promise(function (res) { c.toBlob(res, type, 0.92); });
  }
  function thumbBlob() {
    var s = Math.min(240 / img.w, 180 / img.h), big = toCanvas(img), c = document.createElement('canvas');
    if (s >= 1) s = Math.floor(s);
    c.width = Math.max(1, Math.round(img.w * s)); c.height = Math.max(1, Math.round(img.h * s));
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = s < 1;
    x.drawImage(big, 0, 0, c.width, c.height);
    return new Promise(function (res) { c.toBlob(res, 'image/png'); });
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  var safeName = function (s) { return String(s || 'unbenannt').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'unbenannt'; };
  function downloadDialog() {
    finishAll();
    dialog('Auf meinem PC speichern', '<label>Dateiname<input type="text" name="name" class="w100" value="' + esc(safeName(doc.title)) + '"></label>' +
      '<fieldset class="groupbox"><legend>Dateityp</legend>' +
      '<label class="inline"><input type="radio" name="t" value="png" checked> PNG (empfohlen)</label><br>' +
      '<label class="inline"><input type="radio" name="t" value="bmp"> 24-Bit-Bitmap (BMP), wie früher</label><br>' +
      '<label class="inline"><input type="radio" name="t" value="jpg"> JPEG</label></fieldset>',
    ['Speichern', 'Abbrechen']).then(function (r) {
      if (r.button !== 'Speichern') return;
      var t = r.form.t.value, type = { png: 'image/png', bmp: 'image/bmp', jpg: 'image/jpeg' }[t];
      toBlob(img, type).then(function (blob) { download(blob, safeName(r.form.name.value) + '.' + t); });
    });
  }

  function api(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'x-csrf-token': CSRF, accept: 'application/json' }, opts.json ? { 'content-type': 'application/json' } : {});
    return fetch(url, { method: opts.method || (opts.body || opts.json ? 'POST' : 'GET'), headers: headers, body: opts.json ? JSON.stringify(opts.json) : opts.body, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Das hat nicht geklappt (' + r.status + ').'); return j; }); });
  }
  var VIS = { public: '🌐 öffentlich' + (GALLERY ? ' (auch in der Galerie)' : ''), members: '👥 alle angemeldeten Mitglieder', private: '🔒 nur ich' };
  function visSelect(v) { return '<select name="vis" class="w100">' + Object.keys(VIS).map(function (k) { return '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + VIS[k] + '</option>'; }).join('') + '</select>'; }
  function needLogin(what) {
    return msgbox(what + ' geht nur mit Konto. Melde dich an (das Bild bleibt hier offen, bis du das Fenster schließt) oder speichere es mit „Auf meinem PC speichern“ als Datei.', 'ℹ️', ['Anmelden', 'Auf meinem PC speichern…', 'Abbrechen']).then(function (r) {
      if (r === 'Anmelden') window.open('/login?next=' + encodeURIComponent('/paint'), '_blank');
      if (r === 'Auf meinem PC speichern…') downloadDialog();
    });
  }
  function save(asNew) {
    finishAll();
    if (!ME) return needLogin('Speichern');
    if (!CAN_SAVE) return msgbox('Speichern ist für dein Konto nicht freigeschaltet. Du kannst das Bild aber auf deinem PC speichern.', 'ℹ️', ['Auf meinem PC speichern…', 'OK']).then(function (r) { if (r !== 'OK') downloadDialog(); });
    if (doc.id && doc.mine && !asNew) return upload('/paint/bild/' + doc.id + '/bild', null);
    return dialog('Speichern unter', '<label>Titel<input type="text" name="title" maxlength="80" class="w100" value="' + esc(doc.title === 'unbenannt' ? '' : doc.title) + '" required></label>' +
      '<label>Wer darf es sehen?</label>' + visSelect(doc.visibility || 'private') +
      '<p><small>Gespeichert wird es unter „Meine Bilder“ (Datei → Öffnen). Ändern kannst du Titel und Sichtbarkeit dort unter „Eigenschaften“.</small></p>',
    ['Speichern', 'Auf meinem PC speichern…', 'Abbrechen']).then(function (r) {
      if (r.button === 'Auf meinem PC speichern…') return downloadDialog();
      if (r.button !== 'Speichern') return;
      var title = r.form.title.value.trim() || 'unbenannt';
      return upload('/paint/bilder', { title: title, visibility: r.form.vis.value });
    });
  }
  function upload(url, meta) {
    hint('Speichere …');
    return Promise.all([toBlob(img, 'image/png'), thumbBlob()]).then(function (blobs) {
      var fd = new FormData();
      if (meta) { fd.append('title', meta.title); fd.append('visibility', meta.visibility); }
      fd.append('image', blobs[0], 'bild.png');
      fd.append('thumb', blobs[1], 'vorschau.png');
      return api(url, { body: fd });
    }).then(function (j) {
      openedDoc(j.artwork);
      hint('Gespeichert: ' + j.artwork.title + (j.note ? ' · ' + j.note : ''));
    }).catch(function (e) { hint(); msgbox(e.message, '⚠️'); });
  }
  function openedDoc(a) {
    doc = { id: a.id, title: a.title, visibility: a.visibility, mine: a.mine, dirty: false };
    updateTitle();
    if (history.replaceState) history.replaceState(null, '', '/paint?bild=' + a.id);
  }
  // Fragt bei ungespeicherten Änderungen nach, wie Paint es tat
  function confirmDiscard() {
    if (!doc.dirty || (!undo.length && !doc.id)) return Promise.resolve(true);
    return msgbox('Sollen die Änderungen in „' + (doc.title || 'unbenannt') + '“ gespeichert werden?', '⚠️', ['Ja', 'Nein', 'Abbrechen']).then(function (r) {
      if (r === 'Abbrechen') return false;
      if (r === 'Nein') return true;
      return Promise.resolve(save()).then(function () { return !doc.dirty; });
    });
  }
  function newImage() {
    finishAll();
    confirmDiscard().then(function (ok) {
      if (!ok) return;
      setImage(P.create(prefs.size[0], prefs.size[1], 0xffffff));
      doc = { id: null, title: 'unbenannt', visibility: 'private', mine: true, dirty: false };
      updateTitle();
      if (history.replaceState) history.replaceState(null, '', '/paint');
    });
  }
  function loadArtwork(a) {
    return fetch('/paint/bild/' + a.id + '.png', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('Das Bild gibt es nicht (mehr).');
      return r.blob();
    }).then(function (blob) { return decodeFile(new File([blob], 'bild.png', { type: 'image/png' })); }).then(function (b) {
      for (var i = 3; i < b.d.length; i += 4) b.d[i] = 255;
      setImage(b);
      openedDoc(a);
    });
  }
  function openFromPc() {
    pickFile(function (file) {
      decodeFile(file).then(function (b) {
        for (var i = 0; i < b.d.length; i += 4) if (!b.d[i + 3]) { b.d[i] = b.d[i + 1] = b.d[i + 2] = 255; b.d[i + 3] = 255; }
        setImage(b);
        doc = { id: null, title: file.name.replace(/\.[^.]+$/, '').slice(0, 80), visibility: 'private', mine: true, dirty: true };
        updateTitle();
      }, function (e) { msgbox(e.message, '⚠️'); });
    });
  }
  function openDialog(tab) {
    finishAll();
    tab = tab || (ME ? 'mine' : 'gallery');
    var tabs = (ME ? '<button type="button" class="tab" data-tab="mine">Meine Bilder</button>' : '') + (GALLERY ? '<button type="button" class="tab" data-tab="gallery">Galerie</button>' : '');
    var dlg = dialog('Öffnen', '<div class="tabs">' + tabs + '</div><div class="tabpane"><div class="pt-files" data-files><p>Lade …</p></div></div>',
      ['Öffnen', 'Vom PC öffnen…', 'Abbrechen'], 'open-dialog');
    var box = dlg.el, list = box.querySelector('[data-files]'), items = [], chosen = null;
    var extra = document.createElement('div');
    extra.className = 'actions pt-file-actions';
    extra.innerHTML = '<button type="button" data-a="png" class="small">⬇ PNG</button><button type="button" data-a="tile" class="small">🖼️ Als Hintergrund</button>' +
      '<button type="button" data-a="props" class="small" data-mine>Eigenschaften…</button><button type="button" data-a="del" class="small danger" data-mine>Löschen</button><span data-info class="muted"></span>';
    list.parentNode.appendChild(extra);
    function pick(a) {
      chosen = a;
      list.querySelectorAll('figure').forEach(function (f) { f.classList.toggle('sel', a && Number(f.dataset.id) === a.id); });
      extra.querySelectorAll('button').forEach(function (b) { b.disabled = !a || (b.hasAttribute('data-mine') && !a.mine); });
      extra.querySelector('[data-info]').textContent = a ? a.w + ' × ' + a.h + ' · ' + VIS[a.visibility].split(' (')[0] + (a.pending ? ' · wartet auf Freigabe' : '') : '';
    }
    function load(t) {
      tab = t;
      box.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
      list.innerHTML = '<p>Lade …</p>';
      api('/paint/bilder?tab=' + t).then(function (j) {
        items = j.artworks;
        var quota = j.quota ? '<p class="pt-quota"><small>Belegt: ' + (j.quota.used / 1048576).toFixed(1) + ' MB von ' + Math.round(j.quota.total / 1048576) + ' MB</small></p>' : '';
        list.innerHTML = quota + (items.length ? '<div class="pt-thumbs">' + items.map(function (a) {
          return '<figure data-id="' + a.id + '" tabindex="0"><img src="/paint/bild/' + a.id + '/vorschau.png?v=' + a.updated + '" alt="" loading="lazy"><b>' + esc(a.title) + '</b>' +
            '<small>' + (t === 'gallery' ? 'von ' + esc(a.by) + ' · ' : '') + esc(a.date) + '</small></figure>';
        }).join('') + '</div>' : '<p class="muted">' + (t === 'mine' ? 'Noch keine gespeicherten Bilder. Mal etwas und wähle Datei → Speichern.' : 'Noch keine öffentlichen Bilder.') + '</p>');
        pick(null);
      }).catch(function (e) { list.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; });
    }
    box.addEventListener('click', function (e) {
      var tb = e.target.closest('.tab');
      if (tb) return load(tb.dataset.tab);
      var fig = e.target.closest('figure[data-id]');
      if (fig) return pick(items.find(function (a) { return a.id === Number(fig.dataset.id); }));
      var act = e.target.closest('[data-a]');
      if (!act || !chosen) return;
      var a = chosen, k = act.dataset.a;
      if (k === 'png') { var l = document.createElement('a'); l.href = '/paint/bild/' + a.id + '.png?download=1'; l.click(); }
      if (k === 'tile') fetch('/paint/bild/' + a.id + '.png').then(function (r) { return r.blob(); }).then(function (bl) { return blobToDataUrl(bl); }).then(function (u) { wallpaper(u, 'tile'); });
      if (k === 'props') props(a).then(function () { load(tab); });
      if (k === 'del') msgbox('„' + a.title + '“ endgültig löschen?', '⚠️', ['Ja', 'Nein']).then(function (r) {
        if (r !== 'Ja') return;
        api('/paint/bild/' + a.id + '/loeschen', { json: {} }).then(function () {
          if (doc.id === a.id) { doc.id = null; doc.dirty = true; updateTitle(); }
          load(tab);
        }).catch(function (er) { msgbox(er.message, '⚠️'); });
      });
    });
    list.addEventListener('dblclick', function (e) { var fig = e.target.closest('figure[data-id]'); if (fig) dlg.close('Öffnen'); });
    load(tab);
    dlg.done.then(function (r) {
      if (r.button === 'Vom PC öffnen…') return confirmDiscard().then(function (ok) { if (ok) openFromPc(); });
      if (r.button !== 'Öffnen' || !chosen) return;
      var a = chosen;
      confirmDiscard().then(function (ok) {
        if (ok) loadArtwork(a).then(function () { if (!a.mine) { doc.id = null; doc.title = a.title; doc.dirty = false; updateTitle(); hint('Fremdes Bild: Speichern legt eine eigene Kopie an.'); } }, function (e) { msgbox(e.message, '⚠️'); });
      });
    });
  }
  function props(a) {
    return dialog('Eigenschaften', '<label>Titel<input type="text" name="title" maxlength="80" class="w100" value="' + esc(a.title) + '"></label><label>Wer darf es sehen?</label>' + visSelect(a.visibility),
      ['OK', 'Abbrechen']).then(function (r) {
      if (r.button !== 'OK') return;
      return api('/paint/bild/' + a.id, { json: { title: r.form.title.value, visibility: r.form.vis.value } }).then(function (j) {
        if (doc.id === a.id) { doc.title = j.artwork.title; doc.visibility = j.artwork.visibility; updateTitle(); }
        if (j.note) msgbox(j.note, 'ℹ️');
      }, function (e) { msgbox(e.message, '⚠️'); });
    });
  }

  // ---------- Hintergrundbild (wie „Als Hintergrund“ im Original) ----------
  function blobToDataUrl(blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); }); }
  function wallpaper(url, mode) {
    var D = window.RetroDisplay;
    if (!D || !D.setWallpaper) return;
    if (D.setWallpaper(url, mode)) hint('Als Hintergrundbild gesetzt. Ändern oder entfernen kannst du es unter 🖥️ neben der Uhr.');
    else msgbox('Das Bild ist zu groß für ein Hintergrundbild. Probiere es mit einem kleineren Bild.', '⚠️');
  }
  function setWallpaper(mode) { finishAll(); wallpaper(toCanvas(img).toDataURL('image/png'), mode); }

  // ---------- Dialoge ----------
  var modal = $('.pt-modal');
  function dialog(title, body, buttons, cls) {
    var el = document.createElement('div');
    el.className = 'window pt-dialog' + (cls ? ' ' + cls : '');
    el.setAttribute('role', 'dialog');
    el.innerHTML = '<div class="titlebar"><span class="ttl">' + esc(title) + '</span><button type="button" class="tb-btn" data-x title="Schließen">×</button></div>' +
      '<form class="body" novalidate>' + body + '<div class="actions pt-dlg-buttons">' + buttons.map(function (b, i) { return '<button type="' + (i === 0 ? 'submit' : 'button') + '" value="' + esc(b) + '">' + esc(b) + '</button>'; }).join('') + '</div></form>';
    modal.hidden = false;
    modal.appendChild(el);
    var f = el.querySelector('form'), resolve;
    var done = new Promise(function (r) { resolve = r; });
    function close(btn) { el.remove(); if (!modal.children.length) { modal.hidden = true; stage.focus({ preventScroll: true }); } resolve({ button: btn, form: f }); }
    f.addEventListener('submit', function (e) { e.preventDefault(); close(buttons[0]); });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.pt-dlg-buttons button[type=button]');
      if (b) close(b.value);
      if (e.target.closest('[data-x]')) close(buttons[buttons.length - 1]);
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(buttons[buttons.length - 1]); } });
    setTimeout(function () { var inp = el.querySelector('input[type=text], input[type=number]') || el.querySelector('button[type=submit]'); if (inp) inp.focus(); }, 0);
    var api_ = { el: el, done: done, close: close, then: function (a, b) { return done.then(a, b); } };
    return api_;
  }
  function msgbox(text, icon, buttons) {
    buttons = buttons || ['OK'];
    return dialog('Paint', '<div class="pt-msg"><span class="pt-msg-icon">' + (icon || 'ℹ️') + '</span><p>' + esc(text) + '</p></div>', buttons, 'msgbox').then(function (r) { return r.button; });
  }
  function about() {
    dialog('Info über Paint', '<div class="pt-msg"><span class="pt-msg-icon">🎨</span><div><p><b>Paint</b><br>Nachbau von Paint aus Windows 98 für ' + esc(SITE) + '.</p>' +
      '<p><small>Gemalt wird Pixel für Pixel ohne Kantenglättung, wie damals. Nichts davon stammt von Microsoft.</small></p></div></div>', ['OK']);
  }
  function helpTopics() {
    dialog('Hilfethemen: Paint', '<div class="pt-help">' +
      '<p><b>Malen:</b> Linke Maustaste malt mit der Vordergrundfarbe, rechte mit der Hintergrundfarbe. Farben wählst du unten in der Palette (links/rechts klicken), doppelt klicken ändert eine Farbe.</p>' +
      '<p><b>Formen:</b> Unter der Werkzeugleiste stellst du Rand, Füllung und Linienstärke ein. Umschalt gibt gerade Linien, Quadrate und Kreise. Vieleck: Ecken anklicken, Doppelklick schließt. Kurve: Linie ziehen, dann zweimal zum Biegen ziehen.</p>' +
      '<p><b>Auswahl:</b> Ziehen verschiebt, mit Strg bleibt eine Kopie liegen, mit Umschalt zieht sie eine Spur. Die Anfasser strecken. „Durchsichtig“ lässt die Hintergrundfarbe weg. Pfeiltasten schieben um ein Pixel.</p>' +
      '<p><b>Bilder einfügen:</b> Strg+V, Datei ins Bild ziehen oder Bearbeiten → Einfügen aus Datei.</p>' +
      '<p><b>Tastenkürzel:</b> Strg+Z rückgängig, Strg+Y wiederholen, Strg+A alles markieren, Strg+C/X/V, Entf, Strg+S speichern, Strg+O öffnen, Strg+R kippen/drehen, Strg+I Farben umkehren, Strg+E Attribute, Strg+G Raster, Strg+F Bild anzeigen. Strg+N, Strg+T und Strg+W gehören im Browser dem Browser und gehen hier nicht.</p>' +
      '<p><b>Speichern:</b> Mit Konto unter Datei → Speichern auf dieser Seite, ohne Konto als Datei auf deinem PC (PNG, BMP oder JPEG).</p></div>', ['OK'], 'help-dialog');
  }
  function zoomDialog() {
    dialog('Benutzerdefinierter Zoom', '<p>Aktueller Zoom: ' + zoom * 100 + ' %</p><fieldset class="groupbox"><legend>Zoom auf</legend>' +
      [1, 2, 4, 6, 8].map(function (z) { return '<label class="inline"><input type="radio" name="z" value="' + z + '"' + (z === zoom ? ' checked' : '') + '> ' + z * 100 + ' %</label>'; }).join(' ') + '</fieldset>',
    ['OK', 'Abbrechen']).then(function (r) { if (r.button === 'OK' && r.form.z.value) setZoom(Number(r.form.z.value)); });
  }
  // Bild anzeigen: ganzes Bild ohne Fenster, Klick oder Taste schließt
  function viewBitmap() {
    finishAll();
    var v = document.createElement('div');
    v.className = 'pt-viewer';
    v.appendChild(toCanvas(img));
    document.body.appendChild(v);
    var close = function () { v.remove(); document.removeEventListener('keydown', close, true); };
    v.addEventListener('click', close);
    setTimeout(function () { document.addEventListener('keydown', close, true); }, 0);
  }

  // ---------- Menüs ----------
  var on = function (k) { return !!prefs.view[k]; };
  var MENUS = [
    ['Datei', [
      ['Neu', '', newImage],
      ['Öffnen…', 'Strg+O', function () { openDialog(); }],
      ['Speichern', 'Strg+S', function () { save(false); }],
      ['Speichern unter…', '', function () { save(true); }],
      ['Auf meinem PC speichern…', '', downloadDialog],
      '-',
      ['Drucken…', '', function () { finishAll(); viewBitmap(); setTimeout(function () { window.print(); document.querySelectorAll('.pt-viewer').forEach(function (v) { v.remove(); }); }, 50); }],
      '-',
      ['Als Hintergrund (Fläche)', '', function () { setWallpaper('tile'); }],
      ['Als Hintergrund (zentriert)', '', function () { setWallpaper('center'); }],
    ]],
    ['Bearbeiten', [
      ['Rückgängig', 'Strg+Z', doUndo, function () { return !undo.length && !sel && !multi && !textBox; }],
      ['Wiederholen', 'Strg+Y', doRedo, function () { return !redo.length; }],
      '-',
      ['Ausschneiden', 'Strg+X', function () { copySel(true); }, function () { return !sel; }],
      ['Kopieren', 'Strg+C', function () { copySel(false); }, function () { return !sel; }],
      ['Einfügen', 'Strg+V', pasteFromClipboard],
      ['Auswahl löschen', 'Entf', deleteSel, function () { return !sel; }],
      ['Alles markieren', 'Strg+A', selectAll],
      '-',
      ['Kopieren nach…', '', function () { var b = sel.lifted ? selBitmap() : sel.bmp; toBlob(b, 'image/png').then(function (bl) { download(bl, 'auswahl.png'); }); }, function () { return !sel; }],
      ['Einfügen aus…', '', function () { pickFile(function (f) { decodeFile(f).then(function (b) { pasteBitmap(b); }, function (e) { msgbox(e.message, '⚠️'); }); }); }],
    ]],
    ['Ansicht', [
      ['Werkzeugleiste', '', function () { toggleView('tools'); }, null, function () { return on('tools'); }],
      ['Farbpalette', '', function () { toggleView('colors'); }, null, function () { return on('colors'); }],
      ['Statusleiste', '', function () { toggleView('status'); }, null, function () { return on('status'); }],
      ['Textsymbolleiste', '', function () { toggleView('text'); }, null, function () { return on('text'); }],
      '-',
      ['Zoom', '', [
        ['Normale Größe', '', function () { setZoom(1); }, null, function () { return zoom === 1; }],
        ['Große Größe', '', function () { setZoom(4); }, null, function () { return zoom === 4; }],
        ['Benutzerdefiniert…', '', zoomDialog],
        '-',
        ['Raster anzeigen', 'Strg+G', toggleGrid, function () { return zoom < 4; }, function () { return prefs.grid; }],
      ]],
      ['Bild anzeigen', 'Strg+F', viewBitmap],
    ]],
    ['Bild', [
      ['Kippen/Drehen…', 'Strg+R', flipRotate],
      ['Strecken/Zerren…', '', stretchSkew],
      ['Farben umkehren', 'Strg+I', invertColors],
      ['Attribute…', 'Strg+E', attributes],
      ['Bild löschen', '', clearImage],
      ['Zuschneiden auf Auswahl', '', cropToSel, function () { return !sel; }],
      '-',
      ['Undurchsichtig zeichnen', '', function () { prefs.opts.transparent = !prefs.opts.transparent; savePrefs(); renderOptions(); drawSel(); styleText(); }, null, function () { return !prefs.opts.transparent; }],
    ]],
    ['Farben', [
      ['Palette bearbeiten…', '', function () { editColors(null); }],
      ['Palette speichern…', '', savePalette],
      ['Palette laden…', '', loadPalette],
      ['Palette zurücksetzen', '', function () { prefs.palette = P.PALETTE.slice(); savePrefs(); renderColors(); }],
    ]],
    ['?', [
      ['Hilfethemen', '', helpTopics],
      '-',
      ['Info über Paint', '', about],
    ]],
  ];
  var menubar = $('.pt-menu'), openMenu = null;
  MENUS.forEach(function (m, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pt-mtop';
    b.dataset.menu = i;
    b.innerHTML = m[0] === '?' ? '?' : '<u>' + esc(m[0][0]) + '</u>' + esc(m[0].slice(1));
    menubar.insertBefore(b, menubar.querySelector('.spacer'));
  });
  function buildMenu(items, x, y) {
    var el = document.createElement('div');
    el.className = 'pt-dd';
    el.setAttribute('role', 'menu');
    items.forEach(function (it) {
      if (it === '-') { el.appendChild(document.createElement('hr')); return; }
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'pt-mi';
      var dis = it[3] && it[3](), chk = it[4] && it[4]();
      if (dis) row.disabled = true;
      if (chk) row.classList.add('chk');
      if (Array.isArray(it[2])) row.classList.add('sub');
      row.innerHTML = '<span>' + esc(it[0]) + '</span><span>' + esc(it[1]) + '</span>';
      row._item = it;
      el.appendChild(row);
    });
    el.style.left = x + 'px'; el.style.top = y + 'px';
    root.appendChild(el);
    var r = el.getBoundingClientRect();
    if (r.right > innerWidth) el.style.left = Math.max(0, innerWidth - r.width - 2) + 'px';
    return el;
  }
  function closeMenus() {
    root.querySelectorAll('.pt-dd').forEach(function (m) { m.remove(); });
    menubar.querySelectorAll('.pt-mtop').forEach(function (b) { b.classList.remove('open'); });
    openMenu = null;
    hint(TOOL_INFO[tool].hint);
  }
  function showMenu(i) {
    closeMenus();
    var b = menubar.querySelector('[data-menu="' + i + '"]'), r = b.getBoundingClientRect(), rr = root.getBoundingClientRect();
    b.classList.add('open');
    openMenu = i;
    buildMenu(MENUS[i][1], r.left - rr.left, r.bottom - rr.top);
  }
  menubar.addEventListener('click', function (e) {
    var b = e.target.closest('.pt-mtop');
    if (!b) return;
    if (openMenu === Number(b.dataset.menu)) closeMenus(); else { finishAll(); showMenu(Number(b.dataset.menu)); }
  });
  menubar.addEventListener('mouseover', function (e) { var b = e.target.closest('.pt-mtop'); if (b && openMenu != null && openMenu !== Number(b.dataset.menu)) showMenu(Number(b.dataset.menu)); });
  root.addEventListener('click', function (e) {
    var row = e.target.closest('.pt-mi');
    if (row) {
      var it = row._item;
      if (Array.isArray(it[2])) return;
      closeMenus();
      it[2]();
      return;
    }
    if (openMenu != null && !e.target.closest('.pt-menu, .pt-dd')) closeMenus();
  });
  root.addEventListener('mouseover', function (e) {
    var row = e.target.closest('.pt-mi');
    if (!row) return;
    hint(row._item[0].replace('…', ''));
    var dd = row.parentNode;
    // Untermenü öffnen, andere Untermenüs dieser Ebene schließen
    root.querySelectorAll('.pt-dd').forEach(function (m) { if (m._parent === dd && m._from !== row) m.remove(); });
    if (Array.isArray(row._item[2]) && !row._open) {
      var r = row.getBoundingClientRect(), rr = root.getBoundingClientRect();
      var sub = buildMenu(row._item[2], r.right - rr.left - 2, r.top - rr.top - 3);
      sub._parent = dd; sub._from = row;
      row._open = sub;
      var obs = new MutationObserver(function () { if (!sub.isConnected) { row._open = null; obs.disconnect(); } });
      obs.observe(root, { childList: true });
    }
  });
  document.addEventListener('pointerdown', function (e) { if (openMenu != null && !e.target.closest('.pt-menu, .pt-dd')) closeMenus(); });

  function toggleView(k) {
    prefs.view[k] = !prefs.view[k];
    savePrefs();
    applyView();
  }
  function applyView() {
    $('.pt-left').hidden = !prefs.view.tools;
    $('.pt-bottom').hidden = !prefs.view.colors;
    $('.pt-status').hidden = !prefs.view.status;
    $('.pt-fontbar').hidden = !((tool === 'text' || textBox) && prefs.view.text);
  }
  function toggleGrid() { prefs.grid = !prefs.grid; savePrefs(); applyZoom(); }

  // ---------- Werkzeugleiste ----------
  $('.pt-tools').addEventListener('click', function (e) { var b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('.pt-tools').addEventListener('mouseover', function (e) { var b = e.target.closest('[data-tool]'); if (b) hint(TOOL_INFO[b.dataset.tool].hint); });
  $('.pt-tools').addEventListener('mouseleave', function () { hint(TOOL_INFO[tool].hint); });

  // ---------- Tastatur ----------
  document.addEventListener('keydown', function (e) {
    if (!modal.hidden || document.querySelector('.pt-viewer')) return;
    var typing = e.target.closest && e.target.closest('input, textarea, select');
    if (typing && !(textBox && e.target === textBox.el && e.key === 'Escape')) return;
    var k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    var run = function (fn) { e.preventDefault(); closeMenus(); fn(); };
    if (e.key === 'Escape') {
      if (openMenu != null) return closeMenus();
      if (textBox) return run(function () { closeText(false); });
      if (busy && busy.prev) { restore(busy.prev); busy = null; return; }
      if (multi) return run(cancelMulti);
      if (sel) return run(function () { dropSel(true); });
      return;
    }
    if (ctrl && !e.altKey) {
      var map = { z: doUndo, y: doRedo, a: selectAll, c: function () { copySel(false); }, x: function () { copySel(true); },
        s: function () { save(false); }, o: function () { openDialog(); }, r: flipRotate, i: invertColors, e: attributes, g: toggleGrid, f: viewBitmap };
      if (k === 'v') return; // das paste-Ereignis übernimmt
      if (map[k]) return run(map[k]);
      return;
    }
    if (e.key === 'Delete') return run(deleteSel);
    if (sel && /^Arrow/.test(e.key)) {
      return run(function () {
        lift();
        sel.x += e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        sel.y += e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        drawSel();
      });
    }
  });

  // ---------- Start ----------
  renderColors();
  syncFontbar();
  applyView();
  setTool('pencil');
  hint();
  var startId = Number(new URLSearchParams(location.search).get('bild'));
  setImage(P.create(prefs.size[0], prefs.size[1], 0xffffff));
  updateTitle();
  if (startId) {
    api('/paint/bilder/' + startId).then(function (j) {
      return loadArtwork(j.artwork).then(function () {
        if (!j.artwork.mine) { doc.id = null; doc.title = j.artwork.title; updateTitle(); hint('Fremdes Bild: Speichern legt eine eigene Kopie an.'); }
      });
    }).catch(function (e) { msgbox(e.message, '⚠️'); });
  }
  // Für Tests und den Rauchtest im Browser
  window.RetroPaint = { get image() { return img; }, P: P, setTool: setTool, commit: commit, refresh: refresh, get doc() { return doc; } };
}());
