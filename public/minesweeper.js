// Minesweeper wie bei Windows 98: Spielfeld, Zähler und Smiley sind Pixelgrafik auf einem Canvas, gezeichnet in
// Originalgröße (16 × 16 Pixel pro Feld) und ganzzahlig vergrößert, wenn das Fenster größer ist.
// Mit Konto meldet die Seite Start und Ende jedes Spiels an /minesweeper (Profil und Bestzeiten), ohne Konto bleiben
// die Bestzeiten wie früher „auf diesem Computer“ (localStorage).
(function () {
  'use strict';
  var root = document.getElementById('ms');
  if (!root) return;
  var CSRF = root.dataset.csrf, ME = root.dataset.user, SITE = root.dataset.site;
  var LEVELS = JSON.parse(root.dataset.levels), LIMITS = JSON.parse(root.dataset.limits);
  var ORDER = ['beginner', 'intermediate', 'expert'];
  var canvas = document.getElementById('ms-canvas'), ctx = canvas.getContext('2d');
  var menubar = root.querySelector('.ms-menu');

  // Desktop drumherum: Fenstergröße anpassen, Dialoge als eigene Fenster darüber, „Beenden“ schließt das Fenster
  var desk = null, hostDoc = document;
  try { if (window.parent !== window && window.parent.RetroDesk) { desk = window.parent.RetroDesk; hostDoc = window.parent.document; } } catch (e) { desk = null; }

  function sound(name) { if (prefs.sound && window.RetroSound) window.RetroSound.play(name); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- Einstellungen (wie früher in der winmine.ini) ----------
  var KEY = 'minesweeper';
  var prefs = { level: 'beginner', w: 9, h: 9, m: 10, marks: true, color: true, sound: false, best: {} };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* privat */ }
  if (prefs.level !== 'custom' && !LEVELS[prefs.level]) prefs.level = 'beginner';
  function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* privat */ } }
  function localBest(k) { var b = prefs.best && prefs.best[k]; return b && b.s > 0 && b.s < 1000 ? b : { s: 999, name: 'Anonym' }; }

  // ---------- Pixelgrafik ----------
  var C = { bg: '#c0c0c0', hi: '#ffffff', lo: '#808080', k: '#000000', r: '#ff0000', y: '#ffff00',
    n: [null, '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'] };
  function sprite(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'); draw(x); return c;
  }
  function rect(x, l, t, w, h, col) { x.fillStyle = col; x.fillRect(l, t, w, h); }
  // Bitmap aus Textzeilen: jedes Zeichen ein Pixel, '.' bleibt frei
  function bitmap(x, ox, oy, rows, map) {
    rows.forEach(function (row, y) {
      for (var i = 0; i < row.length; i++) if (map[row[i]]) rect(x, ox + i, oy + y, 1, 1, map[row[i]]);
    });
  }
  // Erhabener oder vertiefter Rand mit schrägen Ecken wie bei Windows
  function bevel(x, l, t, w, h, d, tl, br) {
    for (var i = 0; i < d; i++) {
      rect(x, l + i, t + i, w - 2 * i - 1, 1, tl); rect(x, l + i, t + i, 1, h - 2 * i - 1, tl);
      rect(x, l + i + 1, t + h - 1 - i, w - 2 * i - 1, 1, br); rect(x, l + w - 1 - i, t + i + 1, 1, h - 2 * i - 1, br);
    }
  }

  var DIGITS = {
    1: ['....##....', '...###....', '..####....', '.#####....', '...###....', '...###....', '...###....', '...###....', '.#######..', '.#######..'],
    2: ['..######..', '.########.', '.###..###.', '......###.', '....####..', '..####....', '.###......', '.###......', '.#########', '.#########'],
    3: ['.########.', '.#########', '.......###', '.......###', '...######.', '...######.', '.......###', '.......###', '.#########', '.########.'],
    4: ['..###.###.', '..###.###.', '.###..###.', '.###..###.', '.#########', '.#########', '......###.', '......###.', '......###.', '......###.'],
    5: ['.#########', '.#########', '.###......', '.###......', '.########.', '.#########', '.......###', '.......###', '.#########', '.########.'],
    6: ['..#######.', '.########.', '.###......', '.###......', '.########.', '.#########', '.###...###', '.###...###', '.#########', '..#######.'],
    7: ['.#########', '.#########', '.......###', '......###.', '.....###..', '.....###..', '....###...', '....###...', '....###...', '....###...'],
    8: ['..#######.', '.#########', '.###...###', '.###...###', '..#######.', '..#######.', '.###...###', '.###...###', '.#########', '..#######.'],
  };
  var MINE = ['......#......', '......#......', '..#.#####.#..', '...#######...', '..#ww######..', '..#ww######..', '#############',
    '..#########..', '..#########..', '...#######...', '..#.#####.#..', '......#......', '......#......'];
  var FLAG = ['', '', '', '.......rr', '.....rrrr', '....rrrrr', '.....rrrr', '.......rr', '........k', '........k', '......kkkk', '....kkkkkkkk', '....kkkkkkkk'];
  var QUEST = ['', '', '', '......kkkk', '.....kk..kk', '.....kk..kk', '........kk', '.......kk', '.......kk', '', '.......kk', '.......kk'];

  function hiddenCell(x) { rect(x, 0, 0, 16, 16, C.bg); bevel(x, 0, 0, 16, 16, 2, C.hi, C.lo); }
  function openCell(x) { rect(x, 0, 0, 16, 16, C.bg); rect(x, 0, 0, 16, 1, C.lo); rect(x, 0, 0, 1, 16, C.lo); }
  var S = {
    hidden: sprite(16, 16, hiddenCell),
    open: sprite(16, 16, openCell),
    flag: sprite(16, 16, function (x) { hiddenCell(x); bitmap(x, 0, 0, FLAG, { r: C.r, k: C.k }); }),
    quest: sprite(16, 16, function (x) { hiddenCell(x); bitmap(x, 0, 0, QUEST, { k: C.k }); }),
    questDown: sprite(16, 16, function (x) { openCell(x); bitmap(x, 1, 1, QUEST, { k: C.k }); }),
    mine: sprite(16, 16, function (x) { openCell(x); bitmap(x, 2, 2, MINE, { '#': C.k, w: C.hi }); }),
    boom: sprite(16, 16, function (x) { openCell(x); rect(x, 1, 1, 15, 15, C.r); bitmap(x, 2, 2, MINE, { '#': C.k, w: C.hi }); }),
    wrong: sprite(16, 16, function (x) {
      openCell(x); bitmap(x, 2, 2, MINE, { '#': C.k, w: C.hi });
      for (var i = 3; i <= 12; i++) { rect(x, i, i, 2, 1, C.r); rect(x, 15 - i - 1, i, 2, 1, C.r); }
    }),
    num: [null],
  };
  for (var d = 1; d <= 8; d++) {
    (function (d) { S.num[d] = sprite(16, 16, function (x) { openCell(x); bitmap(x, 3, 3, DIGITS[d], { '#': C.n[d] }); }); })(d);
  }

  // Siebensegment-Ziffern der Zähler (13 × 23)
  var SEG = {
    a: [[1, 2, 10], [2, 3, 9], [3, 4, 8]], g: [[10, 3, 9], [11, 2, 10], [12, 3, 9]], d: [[19, 4, 8], [20, 3, 9], [21, 2, 10]],
    f: [[1, 2, 10], [2, 3, 9], [3, 4, 8]], b: [[11, 2, 10], [10, 3, 9], [9, 4, 8]],
    e: [[1, 12, 20], [2, 13, 19], [3, 14, 18]], c: [[11, 12, 20], [10, 13, 19], [9, 14, 18]],
  };
  var LIT = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
  function led(ch) {
    return sprite(13, 23, function (x) {
      rect(x, 0, 0, 13, 23, C.k);
      'abcdefg'.split('').forEach(function (s) {
        var col = LIT[ch].indexOf(s) >= 0 ? C.r : '#480000';
        SEG[s].forEach(function (p) {
          if ('agd'.indexOf(s) >= 0) rect(x, p[1], p[0], p[2] - p[1] + 1, 1, col);   // waagrecht: Zeile, von, bis
          else rect(x, p[0], p[1], 1, p[2] - p[1] + 1, col);                        // senkrecht: Spalte, von, bis
        });
      });
    });
  }
  var LED = {};
  '0123456789-'.split('').forEach(function (ch) { LED[ch] = led(ch); });

  // Smiley: gelber Kreis (17 × 17) mit Gesicht
  var FACES = {
    smile: { eyes: [[5, 5], [6, 5], [5, 6], [6, 6], [10, 5], [11, 5], [10, 6], [11, 6]], mouth: [[4, 10], [12, 10], [5, 11], [11, 11], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12]] },
    oh: { eyes: [[5, 5], [6, 5], [5, 6], [6, 6], [10, 5], [11, 5], [10, 6], [11, 6]], mouth: [[7, 10], [8, 10], [9, 10], [6, 11], [10, 11], [6, 12], [10, 12], [7, 13], [8, 13], [9, 13]] },
    dead: { eyes: [[4, 4], [6, 4], [5, 5], [4, 6], [6, 6], [10, 4], [12, 4], [11, 5], [10, 6], [12, 6]], mouth: [[6, 11], [7, 11], [8, 11], [9, 11], [10, 11], [5, 12], [11, 12], [4, 13], [12, 13]] },
    cool: { eyes: [[1, 5], [2, 5], [14, 5], [15, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5],
      [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [4, 7], [5, 7], [6, 7], [10, 7], [11, 7], [12, 7]],
    mouth: [[4, 10], [12, 10], [5, 11], [11, 11], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12]] },
  };
  function face(kind, down) {
    return sprite(26, 26, function (x) {
      rect(x, 0, 0, 26, 26, C.lo);
      rect(x, 1, 1, 24, 24, C.bg);
      if (down) { rect(x, 1, 1, 24, 1, C.lo); rect(x, 1, 1, 1, 24, C.lo); }
      else bevel(x, 1, 1, 24, 24, 2, C.hi, C.lo);
      var o = down ? 5 : 4;
      var inside = function (i, j) { return i >= 0 && j >= 0 && i < 17 && j < 17 && (i - 8) * (i - 8) + (j - 8) * (j - 8) <= 72.25; };
      for (var j = 0; j < 17; j++) for (var i = 0; i < 17; i++) {
        if (!inside(i, j)) continue;
        var edge = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
        rect(x, o + i, o + j, 1, 1, edge ? C.k : C.y);
      }
      FACES[kind].eyes.concat(FACES[kind].mouth).forEach(function (p) { rect(x, o + p[0], o + p[1], 1, 1, C.k); });
    });
  }
  var FACE = {};
  Object.keys(FACES).forEach(function (k) { FACE[k] = face(k, false); });
  var FACE_DOWN = face('smile', true);

  // ---------- Spiel ----------
  // st: 0 verdeckt, 1 aufgedeckt, 2 Fahne, 3 Fragezeichen
  var g = null, W = 0, H = 0, timer = null, scale = prefs.scale > 0 ? prefs.scale : 1;
  var press = [], faceDown = false, faceOh = false;
  var startReq = null;

  function size() {
    if (prefs.level === 'custom') return { w: prefs.w, h: prefs.h, m: prefs.m };
    return LEVELS[prefs.level];
  }
  function newGame() {
    var s = size(), resized = !g || g.w !== s.w || g.h !== s.h;
    clearInterval(timer); timer = null;
    g = { w: s.w, h: s.h, m: s.m, mine: new Uint8Array(s.w * s.h), st: new Uint8Array(s.w * s.h), n: new Uint8Array(s.w * s.h),
      phase: 'ready', time: 0, flags: 0, opened: 0, boom: -1 };
    // Minen liegen schon vor dem ersten Klick; trifft der erste Klick eine, wandert sie in das erste freie Feld oben links
    var placed = 0;
    while (placed < g.m) {
      var i = Math.floor(Math.random() * g.mine.length);
      if (!g.mine[i]) { g.mine[i] = 1; placed++; }
    }
    count();
    startReq = null;
    press = []; faceDown = false; faceOh = false;
    W = 20 + 16 * g.w; H = 63 + 16 * g.h;
    canvas.width = W; canvas.height = H;
    if (resized) fitWindow();
    layout();
  }
  function count() {
    for (var i = 0; i < g.n.length; i++) {
      var c = 0;
      around(i, function (j) { c += g.mine[j]; });
      g.n[i] = c;
    }
  }
  function around(i, fn) {
    var x = i % g.w, y = (i - x) / g.w;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h) fn(ny * g.w + nx);
    }
  }

  function begin(i) {
    if (g.mine[i]) {
      for (var j = 0; j < g.mine.length; j++) if (!g.mine[j]) { g.mine[j] = 1; break; }
      g.mine[i] = 0;
      count();
    }
    g.phase = 'playing';
    g.time = 1;
    sound('ms-tick');
    timer = setInterval(function () {
      if (g.time < 999) { g.time++; sound('ms-tick'); draw(); }
    }, 1000);
    if (ME) startReq = post('/minesweeper/start', { w: g.w, h: g.h, m: g.m }).catch(function () { return null; });
  }

  function open(i) {
    var todo = [i];
    while (todo.length) {
      var k = todo.pop();
      if (g.st[k] === 1 || g.st[k] === 2) continue;
      g.st[k] = 1; g.opened++;
      if (!g.n[k]) around(k, function (j) { if (g.st[j] !== 1 && g.st[j] !== 2) todo.push(j); });
    }
  }
  function reveal(i) {
    if (g.phase !== 'ready' && g.phase !== 'playing') return;
    if (g.st[i] === 1 || g.st[i] === 2) return;
    if (g.phase === 'ready') begin(i);
    if (g.mine[i]) return lose(i);
    open(i);
    checkWin();
  }
  // Beide Maustasten (oder die mittlere) auf einer Zahl: stimmen die Fahnen drumherum, deckt das alle anderen Nachbarn auf
  function chord(i) {
    if (g.phase !== 'playing' || g.st[i] !== 1 || !g.n[i]) return;
    var flags = 0;
    around(i, function (j) { if (g.st[j] === 2) flags++; });
    if (flags !== g.n[i]) return;
    var hit = -1;
    around(i, function (j) {
      if (g.st[j] === 2 || g.st[j] === 1) return;
      if (g.mine[j]) { if (hit < 0) hit = j; } else open(j);
    });
    if (hit >= 0) return lose(hit);
    checkWin();
  }
  function mark(i) {
    if (g.phase !== 'ready' && g.phase !== 'playing') return;
    var s = g.st[i];
    if (s === 1) return;
    if (s === 0) { g.st[i] = 2; g.flags++; }
    else if (s === 2) { g.flags--; g.st[i] = prefs.marks ? 3 : 0; }
    else g.st[i] = 0;
    draw();
  }

  function stop() { clearInterval(timer); timer = null; }
  function lose(i) {
    stop();
    g.phase = 'lost'; g.boom = i;
    sound('ms-boom');
    draw();
    report(false);
  }
  function checkWin() {
    if (g.opened !== g.w * g.h - g.m) return;
    stop();
    g.phase = 'won';
    for (var i = 0; i < g.mine.length; i++) if (g.mine[i]) g.st[i] = 2;
    g.flags = g.m;
    sound('ms-sieg');
    draw();
    report(true);
  }

  // ---------- Ergebnis ----------
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': CSRF } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok ? j : Promise.reject(j); }); });
  }
  function report(won) {
    var level = prefs.level, secs = g.time;
    if (ME) {
      if (!startReq) return;
      startReq.then(function (ok) {
        if (!ok) return null;
        return post('/minesweeper/ergebnis', { won: won, seconds: secs });
      }).then(function (r) {
        if (!r || !r.personal) return;
        var text = '<p>Sie haben die schnellste Zeit für die Stufe ' + esc(LEVELS[r.level].name) + ': <b>' + r.seconds + ' Sekunden</b>.</p>' +
          (r.record ? '<p>🏆 Das ist der neue Rekord auf ' + esc(SITE) + '!</p>' : '<p>Das ist deine neue Bestzeit.</p>');
        dialog('Gratulation', text, [['ok', 'OK']]).then(bestTimes);
      }).catch(function () { /* Verbindung weg: dieses Spiel zählt dann nicht */ });
      return;
    }
    if (!won || level === 'custom' || secs >= localBest(level).s) return;
    // Wie im Original: Name eintragen, danach die Bestzeiten zeigen
    dialog('Neue Bestzeit', '<p>Sie haben die schnellste Zeit für die Stufe ' + esc(LEVELS[level].name) + '.<br>Bitte geben Sie Ihren Namen ein.</p>' +
      '<p><input type="text" name="spieler" maxlength="32" value="' + esc(prefs.lastName || 'Anonym') + '" style="width:100%"></p>', [['ok', 'OK']])
      .then(function (r) {
        var name = (r.form.spieler.value || '').trim().slice(0, 32) || 'Anonym';
        prefs.best[level] = { s: secs, name: name }; prefs.lastName = name;
        savePrefs();
        bestTimes();
      });
  }

  // ---------- Zeichnen ----------
  function draw() {
    rect(ctx, 0, 0, W, H, C.bg);
    bevel(ctx, 0, 0, W, H, 3, C.hi, C.lo);
    bevel(ctx, 9, 9, W - 14, 37, 2, C.lo, C.hi);
    bevel(ctx, 9, 52, W - 14, H - 57, 3, C.lo, C.hi);
    counter(16, 15, g.phase === 'won' ? 0 : g.m - g.flags);
    counter(W - 54, 15, g.time);
    var fk = g.phase === 'won' ? 'cool' : g.phase === 'lost' ? 'dead' : faceOh ? 'oh' : 'smile';
    ctx.drawImage(faceDown ? FACE_DOWN : FACE[fk], faceX(), 14);
    var over = g.phase === 'lost';
    for (var i = 0; i < g.st.length; i++) {
      var x = i % g.w, y = (i - x) / g.w, s = g.st[i], img;
      if (s === 1) img = g.n[i] ? S.num[g.n[i]] : S.open;
      else if (over && i === g.boom) img = S.boom;
      else if (over && g.mine[i] && s !== 2) img = S.mine;
      else if (over && s === 2 && !g.mine[i]) img = S.wrong;
      else if (s === 2) img = S.flag;
      else if (press.indexOf(i) >= 0) img = s === 3 ? S.questDown : S.open;
      else img = s === 3 ? S.quest : S.hidden;
      ctx.drawImage(img, 12 + x * 16, 55 + y * 16);
    }
  }
  function counter(x, y, v) {
    v = Math.max(-99, Math.min(999, v));
    var s = v < 0 ? '-' + String(-v).padStart(2, '0') : String(v).padStart(3, '0');
    rect(ctx, x, y, 41, 25, C.hi); rect(ctx, x, y, 40, 1, C.lo); rect(ctx, x, y, 1, 24, C.lo);
    for (var i = 0; i < 3; i++) ctx.drawImage(LED[s[i]], x + 1 + i * 13, y + 1);
  }
  function faceX() { return Math.floor((W - 23) / 2); }

  // Fenster an das Spielfeld anpassen. Zieht man das Fenster an der Ecke größer oder kleiner, wächst das Spielfeld mit
  // (in Schritten von 5 %); nach dem Loslassen rastet das Fenster auf das Spielfeld ein und merkt sich die Größe.
  function fitWindow() {
    if (desk && desk.fit) desk.fit(window, Math.round(W * scale), menubar.offsetHeight + Math.round(H * scale), { scalable: true });
  }
  function layout() {
    var aw = document.documentElement.clientWidth, ah = document.documentElement.clientHeight - menubar.offsetHeight;
    var s = Math.min(aw / W, ah / H);
    scale = Math.min(6, Math.max(0.5, Math.floor(s * 20 + 0.001) / 20));
    canvas.style.width = Math.round(W * scale) + 'px'; canvas.style.height = Math.round(H * scale) + 'px';
    draw();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.data !== 'desk:resized') return;
    layout();
    prefs.scale = scale; savePrefs();
    fitWindow();
  });

  // ---------- Maus und Finger ----------
  function hit(e) {
    var r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    var fx = faceX();
    if (x >= fx && x < fx + 26 && y >= 14 && y < 40) return { face: true };
    var cx = Math.floor((x - 12) / 16), cy = Math.floor((y - 55) / 16);
    if (x >= 12 && y >= 55 && cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) return { cell: cy * g.w + cx };
    return {};
  }
  var mode = null, cur = -1, pid = null, longTimer = null;
  var live = function () { return g.phase === 'ready' || g.phase === 'playing'; };
  function pressFor(i) {
    press = [];
    if (i < 0 || !live()) return;
    var add = function (j) { if (g.st[j] === 0 || g.st[j] === 3) press.push(j); };
    if (mode === 'chord') { add(i); around(i, add); }
    else if (mode === 'left' || mode === 'touch') add(i);
  }
  function update(e) {
    var h = hit(e);
    if (mode === 'face') { faceDown = !!h.face; draw(); return; }
    cur = h.cell != null ? h.cell : -1;
    pressFor(cur);
    draw();
  }
  function reset() {
    mode = null; pid = null; cur = -1; press = []; faceDown = false; faceOh = false;
    clearTimeout(longTimer);
    draw();
  }
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    closeMenu();
    if (pid != null && e.pointerId !== pid) return;
    e.preventDefault();
    var h = hit(e);
    if (e.pointerType === 'mouse' && mode && pid === e.pointerId) return;
    pid = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* alter Browser */ }
    if (h.face) {
      if (e.button !== 0) { pid = null; return; }
      mode = 'face'; faceDown = true; draw(); return;
    }
    if (h.cell == null || !live()) { mode = 'none'; return; }
    if (e.pointerType !== 'mouse') {
      mode = 'touch';
      faceOh = true; update(e);
      // Lange drücken setzt eine Fahne
      longTimer = setTimeout(function () {
        if (mode !== 'touch' || cur < 0) return;
        mark(cur);
        if (navigator.vibrate) navigator.vibrate(25);
        mode = 'none'; press = []; faceOh = false; draw();
      }, 400);
      return;
    }
    var b = e.buttons;
    if ((b & 4) || ((b & 1) && (b & 2))) mode = 'chord';
    else if (b & 1) mode = 'left';
    else if (b & 2) { mode = 'right'; mark(h.cell); return; }
    else { mode = 'none'; return; }
    faceOh = true;
    update(e);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pid || !mode) return;
    if (e.pointerType === 'mouse') {
      var b = e.buttons;
      // Zweite Taste dazu: aus Links oder Rechts wird der Doppelklick auf eine Zahl
      if ((mode === 'left' && (b & 2)) || (mode === 'right' && (b & 1))) { mode = 'chord'; faceOh = true; }
      // Eine der beiden Tasten losgelassen: Doppelklick auslösen, danach bis zum Loslassen nichts mehr
      else if (mode === 'chord' && !(b & 4) && !((b & 1) && (b & 2))) {
        var at = hit(e).cell;
        if (at != null) chord(at);
        mode = 'none'; press = []; faceOh = false; draw();
        return;
      }
    }
    if (mode === 'touch') {
      var before = cur;
      update(e);
      if (cur !== before) clearTimeout(longTimer);
      return;
    }
    if (mode === 'left' || mode === 'chord' || mode === 'face') update(e);
  });
  function up(e) {
    if (e.pointerId !== pid) return;
    var h = hit(e), m = mode;
    clearTimeout(longTimer);
    if (e.type === 'pointerup') {
      if (m === 'face' && h.face) { reset(); newGame(); return; }
      if (h.cell != null && live()) {
        if (m === 'left') reveal(h.cell);
        else if (m === 'chord') chord(h.cell);
        else if (m === 'touch') { if (g.st[h.cell] === 1) chord(h.cell); else reveal(h.cell); }
      }
    }
    reset();
  }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  // Mittlere Taste: kein Scrollrad-Modus
  canvas.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'F2') { e.preventDefault(); closeMenu(); newGame(); }
    else if (e.key === 'F1') { e.preventDefault(); closeMenu(); help(); }
    else if (e.key === 'Escape') closeMenu();
  });

  // ---------- Menüs ----------
  function setLevel(k) { prefs.level = k; savePrefs(); newGame(); }
  var MENUS = {
    spiel: [
      ['Neu', 'F2', newGame],
      '-',
      ['Anfänger', '', function () { setLevel('beginner'); }, function () { return prefs.level === 'beginner'; }],
      ['Fortgeschrittene', '', function () { setLevel('intermediate'); }, function () { return prefs.level === 'intermediate'; }],
      ['Profis', '', function () { setLevel('expert'); }, function () { return prefs.level === 'expert'; }],
      ['Benutzerdefiniert…', '', custom, function () { return prefs.level === 'custom'; }],
      '-',
      ['Marken (?)', '', function () { prefs.marks = !prefs.marks; savePrefs(); }, function () { return prefs.marks; }],
      ['Farbe', '', function () { prefs.color = !prefs.color; savePrefs(); applyColor(); }, function () { return prefs.color; }],
      ['Sound', '', function () { prefs.sound = !prefs.sound; savePrefs(); }, function () { return prefs.sound; }],
      '-',
      ['Bestzeiten…', '', bestTimes],
      '-',
      ['Beenden', '', quit],
    ],
    hilfe: [
      ['Inhalt', 'F1', help],
      '-',
      ['Info', '', about],
    ],
  };
  var dd = null, openKey = null;
  function closeMenu() {
    if (dd) dd.remove();
    dd = null; openKey = null;
    menubar.querySelectorAll('.ms-mtop').forEach(function (b) { b.classList.remove('open'); });
  }
  function showMenu(key) {
    closeMenu();
    var b = menubar.querySelector('[data-menu="' + key + '"]');
    b.classList.add('open'); openKey = key;
    // Das Menü hängt am Desktop, damit es wie im Original über den Fensterrand hinausragen darf
    dd = hostDoc.createElement('div');
    dd.className = 'ms-dd'; dd.setAttribute('role', 'menu');
    MENUS[key].forEach(function (it) {
      if (it === '-') { dd.appendChild(hostDoc.createElement('hr')); return; }
      var row = hostDoc.createElement('button');
      row.type = 'button'; row.className = 'ms-mi'; row.setAttribute('role', 'menuitem');
      if (it[3] && it[3]()) row.classList.add('chk');
      row.innerHTML = '<span>' + esc(it[0]) + '</span><span>' + esc(it[1]) + '</span>';
      row.addEventListener('click', function () { closeMenu(); it[2](); });
      dd.appendChild(row);
    });
    var fr = hostDoc !== document && window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 }, br = b.getBoundingClientRect();
    dd.style.position = 'fixed'; dd.style.zIndex = 100000;
    dd.style.left = (fr.left + br.left) + 'px'; dd.style.top = (fr.top + br.bottom) + 'px';
    hostDoc.body.appendChild(dd);
  }
  menubar.addEventListener('click', function (e) {
    var b = e.target.closest('.ms-mtop');
    if (!b) return;
    e.stopPropagation();
    if (openKey === b.dataset.menu) closeMenu(); else showMenu(b.dataset.menu);
  });
  menubar.addEventListener('mouseover', function (e) {
    var b = e.target.closest('.ms-mtop');
    if (b && openKey && openKey !== b.dataset.menu) showMenu(b.dataset.menu);
  });
  document.addEventListener('click', function (e) { if (dd && !e.target.closest('.ms-menu')) closeMenu(); });
  function outside(e) { if (dd && !dd.contains(e.target)) closeMenu(); }
  if (hostDoc !== document) hostDoc.addEventListener('pointerdown', outside, true);

  function applyColor() { root.classList.toggle('mono', !prefs.color); }
  function quit() {
    if (desk && desk.close) desk.close(window);
    else location.href = '/';
  }

  // ---------- Dialoge: eigene kleine Fenster über dem Desktop, wie bei Windows ----------
  var dialogs = [];
  function dialog(title, html, buttons, wide) {
    return new Promise(function (resolve) {
      var dlg = hostDoc.createElement('dialog');
      dlg.className = 'window ms-dlg' + (wide ? ' wide' : '');
      dlg.innerHTML = '<div class="titlebar"><span class="ttl">' + esc(title) + '</span><button type="button" class="tb-btn" aria-label="Schließen">×</button></div>' +
        '<form method="dialog" class="body" novalidate><div class="ms-dlg-body">' + html + '</div><div class="actions">' +
        buttons.map(function (b) { return '<button value="' + b[0] + '"' + (b[2] ? ' formnovalidate' : '') + '>' + esc(b[1]) + '</button>'; }).join(' ') + '</div></form>';
      var form = dlg.querySelector('form');
      dlg.querySelector('.tb-btn').addEventListener('click', function () { dlg.close(''); });
      // Links (z. B. Profile in der Bestenliste) öffnen ein Fenster auf dem Desktop
      dlg.addEventListener('click', function (e) {
        var a = e.target.closest('a[href]');
        if (!a) return;
        e.preventDefault(); dlg.close('');
        if (desk) desk.open(a.getAttribute('href'), true); else location.href = a.href;
      });
      dlg.addEventListener('close', function () {
        dialogs.splice(dialogs.indexOf(dlg), 1);
        dlg.remove();
        resolve({ value: dlg.returnValue, form: form });
      });
      hostDoc.body.appendChild(dlg);
      dialogs.push(dlg);
      dlg._form = form;
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      var input = dlg.querySelector('input');
      if (input) { input.focus(); input.select(); }
      if (wide && wide.ready) wide.ready(dlg);
    });
  }
  window.addEventListener('pagehide', function () {
    dialogs.slice().forEach(function (d) { d.remove(); });
    closeMenu();
    if (hostDoc !== document) hostDoc.removeEventListener('pointerdown', outside, true);
  });

  function custom() {
    var s = size();
    var field = function (n, label, v) { return '<label class="ms-field">' + label + ' <input type="number" name="' + n + '" value="' + v + '" min="0" max="999"></label>'; };
    dialog('Benutzerdefiniertes Spielfeld', field('h', 'Höhe:', s.h) + field('w', 'Breite:', s.w) + field('m', 'Minen:', s.m), [['ok', 'OK'], ['', 'Abbrechen', true]])
      .then(function (r) {
        if (r.value !== 'ok') return;
        // Wie im Original: zu kleine oder große Werte werden still auf die Grenzen gesetzt
        var n = function (k, min, max) { var v = parseInt(r.form[k].value, 10); return Math.max(min, Math.min(max, isNaN(v) ? min : v)); };
        var h = n('h', LIMITS.hMin, LIMITS.hMax), w = n('w', LIMITS.wMin, LIMITS.wMax), m = n('m', LIMITS.mMin, (w - 1) * (h - 1));
        prefs.level = 'custom'; prefs.w = w; prefs.h = h; prefs.m = m;
        savePrefs(); newGame();
      });
  }

  function bestTimes() {
    var shown = prefs.level === 'custom' ? 'beginner' : prefs.level;
    fetch('/minesweeper/bestzeiten', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (data) {
        var mine = '<table class="ms-times">' + ORDER.map(function (k) {
          var t, who = '';
          if (ME) { t = data && data.mine && data.mine.best[k]; t = t == null ? '—' : t + ' Sekunden'; }
          else { var b = localBest(k); t = b.s + ' Sekunden'; who = esc(b.name); }
          return '<tr><td>' + esc(LEVELS[k].name) + ':</td><td class="num">' + t + '</td><td>' + who + '</td></tr>';
        }).join('') + '</table>';
        var html = '<fieldset class="groupbox"><legend>' + (ME ? 'Deine Bestzeiten' : 'Auf diesem Computer') + '</legend>' + mine;
        if (ME && data && data.mine && data.mine.games) {
          var s = data.mine;
          html += '<p class="ms-sum">Gespielt: ' + s.games + ' · Gewonnen: ' + s.wins + ' (' + Math.round(s.wins / s.games * 100) + ' %)<br>Aktuelle Siegesserie: ' + s.streak + ' · Längste: ' + s.best_streak + '</p>';
        } else if (!ME) html += '<p class="ms-sum">Melde dich an, damit deine Zeiten im Profil und in der Bestenliste landen.</p>';
        html += '</fieldset>';
        if (data) {
          html += '<fieldset class="groupbox"><legend>Bestenliste von ' + esc(SITE) + '</legend><div class="ms-tabs" role="tablist">' +
            ORDER.map(function (k) { return '<button type="button" role="tab" data-level="' + k + '" aria-selected="' + (k === shown) + '">' + esc(LEVELS[k].name) + '</button>'; }).join('') + '</div>' +
            ORDER.map(function (k) {
              var list = data.levels[k] || [];
              return '<ol class="ms-board" data-level="' + k + '"' + (k === shown ? '' : ' hidden') + '>' + (list.length ? list.map(function (e) {
                var n = e.url ? '<a href="' + esc(e.url) + '">' + esc(e.name) + '</a>' : esc(e.name);
                return '<li' + (e.me ? ' class="me"' : '') + '><span class="num">' + e.seconds + ' s</span> ' + n + '</li>';
              }).join('') : '<li class="empty">Noch niemand. Sei der Erste!</li>') + '</ol>';
            }).join('') + '</fieldset>';
        }
        var buttons = ME ? [['ok', 'OK']] : [['reset', 'Bestzeiten löschen'], ['ok', 'OK']];
        dialog('Bestzeiten', html, buttons, { ready: function (dlg) {
          dlg.querySelectorAll('.ms-tabs button').forEach(function (b) {
            b.addEventListener('click', function () {
              dlg.querySelectorAll('.ms-tabs button').forEach(function (o) { o.setAttribute('aria-selected', o === b); });
              dlg.querySelectorAll('.ms-board').forEach(function (l) { l.hidden = l.dataset.level !== b.dataset.level; });
            });
          });
        } }).then(function (r) {
          if (r.value === 'reset') { prefs.best = {}; savePrefs(); bestTimes(); }
        });
      });
  }

  function help() {
    dialog('Minesweeper-Hilfe',
      '<p><b>Ziel:</b> Alle Felder ohne Mine aufdecken, so schnell wie möglich.</p>' +
      '<ul><li><b>Linksklick</b> deckt ein Feld auf. Ist es eine Mine, ist das Spiel verloren. Der erste Klick trifft nie eine Mine.</li>' +
      '<li>Eine <b>Zahl</b> sagt, wie viele Minen in den acht Feldern drumherum liegen.</li>' +
      '<li><b>Rechtsklick</b> setzt eine Fahne auf eine vermutete Mine, ein zweiter ein Fragezeichen (wenn „Marken (?)“ an ist), ein dritter nimmt es wieder weg.</li>' +
      '<li><b>Beide Maustasten</b> (oder die mittlere) auf einer Zahl decken alle Nachbarn auf, wenn genug Fahnen drumherum stehen.</li>' +
      '<li>Am Handy: <b>Tippen</b> deckt auf, <b>lange drücken</b> setzt eine Fahne, Tippen auf eine Zahl deckt die Nachbarn auf.</li>' +
      '<li>Links oben steht, wie viele Minen noch fehlen, rechts die Zeit. Der Smiley startet ein neues Spiel (oder F2).</li></ul>' +
      '<p>Mit Konto landen deine Spiele, Siege und Bestzeiten im Profil und in der Bestenliste.</p>', [['ok', 'OK']], true);
  }
  function about() {
    dialog('Info über Minesweeper',
      '<div class="ms-about"><span class="ms-about-icon">💣</span><div><p><b>Minesweeper</b></p>' +
      '<p>Nachgebaut für ' + esc(SITE) + ' nach dem Vorbild von Windows 98.<br>Das Original stammt von Robert Donner und Curt Johnson.</p></div></div>', [['ok', 'OK']]);
  }

  applyColor();
  newGame();
  // Erst wenn der Desktop das Fenster eingerichtet hat, stimmt seine Größe
  window.addEventListener('load', function () { fitWindow(); layout(); });
})();
