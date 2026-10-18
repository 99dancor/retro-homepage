// Tägliches Sudoku mit drei Stufen. Getippt wird mit der Tastatur oder dem Ziffernfeld neben dem Gitter (am Handy
// darunter). Die Lösung kennt nur der Server: Prüfen, Aufdecken und „gelöst?“ fragen ihn. Doppelte Ziffern in einer
// Reihe, Spalte oder einem Block markiert die Seite selbst, das braucht keine Lösung und zählt nicht als Hilfe.
// Ohne Konto bleibt der Stand im Browser (localStorage), mit Konto speichert ihn der Server.
(function () {
  'use strict';
  var root = document.getElementById('sd');
  if (!root) return;
  var CSRF = root.dataset.csrf, ME = root.dataset.user, SITE = root.dataset.site;
  var gridEl = document.getElementById('sd-grid'), board = document.getElementById('sd-board'), padEl = document.getElementById('sd-pad');
  var statusEl = document.getElementById('sd-status'), timeEl = document.getElementById('sd-time'), dateEl = document.getElementById('sd-date');
  var tabsEl = document.getElementById('sd-tabs'), notesBtn = document.getElementById('sd-notes');
  var menubar = root.querySelector('.sd-menu');
  var desk = null;
  try { if (window.parent !== window && window.parent.RetroDesk) desk = window.parent.RetroDesk; } catch (e) { desk = null; }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clock(s) { s = Math.max(0, s | 0); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function dateText(day, long) {
    return new Date(day + 'T12:00:00Z').toLocaleDateString('de-DE', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }
  function sound(name) { if (window.RetroSound) window.RetroSound.play(name); }

  // Reihen, Spalten und Blöcke: PEERS[i] sind die 20 Felder, die keine gleiche Ziffer haben dürfen
  var PEERS = [];
  for (var p = 0; p < 81; p++) {
    var r0 = Math.floor(p / 9), c0 = p % 9, list = [];
    for (var q = 0; q < 81; q++) {
      var r1 = Math.floor(q / 9), c1 = q % 9;
      if (q !== p && (r1 === r0 || c1 === c0 || (Math.floor(r1 / 3) === Math.floor(r0 / 3) && Math.floor(c1 / 3) === Math.floor(c0 / 3)))) list.push(q);
    }
    PEERS.push(list);
  }

  // ---------- Stand im Browser (ohne Konto der einzige, mit Konto nur Notizen und Markierungen) ----------
  var KEY = 'sudoku';
  var store = { level: 'leicht', days: {} };
  try { Object.assign(store, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* privat */ }
  if (!store.days || typeof store.days !== 'object') store.days = {};
  function saveStore() {
    // Nur die letzten 40 Tage behalten
    var keys = Object.keys(store.days).sort();
    while (keys.length > 40) delete store.days[keys.shift()];
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* privat */ }
  }

  function post(url, body, keepalive) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', body: JSON.stringify(body), keepalive: !!keepalive,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': CSRF } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok ? j : Promise.reject(j); }); });
  }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r); });
  }

  // ---------- Sudokus aufbauen ----------
  var G = null;            // geladener Tag mit allen drei Stufen
  var L = null;            // die gerade gewählte Stufe
  var notesMode = false;
  function init(data) {
    if (L && L.dirty && ME) save();
    G = { day: data.day, today: data.today, levels: {}, keys: Object.keys(data.levels) };
    var day = store.days[data.day] || {};
    G.keys.forEach(function (k) {
      var d = data.levels[k], local = day[k] || {}, prog = d.progress;
      var lv = { key: k, name: d.name, givens: d.givens, digits: new Array(81), notes: new Array(81), marks: new Array(81), sel: -1, undo: [],
        seconds: 0, started: false, help: 0, solved: false, gaveUp: false, dirty: false, fullSeen: null };
      var saved = ME ? prog && prog.digits : local.d;
      for (var i = 0; i < 81; i++) {
        lv.digits[i] = d.givens[i] !== '-' ? d.givens[i] : saved && /[1-9]/.test(saved[i] || '') ? saved[i] : '';
        lv.notes[i] = local.n && local.n.length === 243 ? parseInt(local.n.substr(i * 3, 3), 16) || 0 : 0;
        lv.marks[i] = local.r && local.r[i] === '1' && d.givens[i] === '-' ? 'revealed' : '';
        if (lv.digits[i]) lv.notes[i] = 0;
      }
      if (ME && prog) { lv.seconds = prog.seconds; lv.help = prog.help; lv.solved = prog.solved; lv.gaveUp = prog.gave_up; }
      else if (!ME) { lv.seconds = local.s || 0; lv.help = local.h || 0; lv.solved = !!local.done; lv.gaveUp = !!local.g; }
      lv.started = lv.seconds > 0;
      lv.sel = d.givens.indexOf('-');
      G.levels[k] = lv;
    });
    var archived = G.day !== G.today;
    dateEl.innerHTML = (archived ? '📅 Archiv: ' : '') + esc(dateText(G.day, !root.classList.contains('narrow')));
    pick(G.levels[store.level] ? store.level : G.keys[0]);
  }

  function pick(key) {
    if (L && L !== G.levels[key] && L.dirty && ME) save();
    L = G.levels[key];
    store.level = key; saveStore();
    tabs();
    build();
    tick();
  }
  function tabs() {
    tabsEl.innerHTML = G.keys.map(function (k) {
      var lv = G.levels[k], mark = lv.solved ? ' ✔' : lv.gaveUp ? ' 👁' : '';
      return '<button type="button" role="tab" data-level="' + k + '" aria-selected="' + (lv === L) + '"' + (lv === L ? ' class="on"' : '') + '>' + esc(lv.name) + mark + '</button>';
    }).join('');
  }
  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-level]');
    if (b && G.levels[b.dataset.level] !== L) pick(b.dataset.level);
  });

  function build() {
    gridEl.innerHTML = '';
    for (var i = 0; i < 81; i++) {
      var el = document.createElement('div'), r = Math.floor(i / 9), c = i % 9;
      el.className = 'sd-cell' + (c % 3 === 2 && c < 8 ? ' br' : '') + (r % 3 === 2 && r < 8 ? ' bb' : '') + (L.givens[i] !== '-' ? ' given' : '');
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      el.innerHTML = '<span class="v"></span><span class="nt">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (d) { return '<i>' + d + '</i>'; }).join('') + '</span>';
      gridEl.appendChild(el);
    }
    padEl.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (d) {
      return '<button type="button" data-d="' + d + '"><b>' + d + '</b><small></small></button>';
    }).join('');
    root.classList.toggle('done', L.solved || L.gaveUp);
    gridEl.classList.toggle('solved', L.solved);
    paintAll();
    layout();
  }

  // Kästchengröße passend zum Fenster
  function layout() {
    if (!L) return;
    var narrow = window.innerWidth < 560;
    root.classList.toggle('narrow', narrow);
    // Abzüglich Innenabstand und dicker Ränder des Gitters
    var w = board.clientWidth - 20, h = narrow ? Infinity : board.clientHeight - 20;
    var size = Math.floor(Math.min(w, h) / 9);
    size = Math.max(26, Math.min(60, size || 40));
    root.style.setProperty('--sd-cell', size + 'px');
  }
  window.addEventListener('resize', layout);

  function paintAll() {
    var sel = L.sel, selD = sel >= 0 ? L.digits[sel] : '';
    var house = {};
    if (sel >= 0) PEERS[sel].forEach(function (j) { house[j] = 1; });
    var count = {};
    for (var i = 0; i < 81; i++) {
      var el = gridEl.children[i], d = L.digits[i];
      if (d) count[d] = (count[d] || 0) + 1;
      var clash = !!d && PEERS[i].some(function (j) { return L.digits[j] === d; });
      el.querySelector('.v').textContent = d;
      var nt = el.querySelector('.nt');
      nt.hidden = !!d || !L.notes[i];
      if (!nt.hidden) for (var k = 0; k < 9; k++) nt.children[k].classList.toggle('on', !!(L.notes[i] & (1 << (k + 1))));
      el.classList.toggle('cur', i === sel);
      el.classList.toggle('house', !!house[i]);
      el.classList.toggle('same', !!selD && d === selD && i !== sel);
      el.classList.toggle('clash', clash);
      el.classList.toggle('wrong', L.marks[i] === 'wrong');
      el.classList.toggle('revealed', L.marks[i] === 'revealed');
    }
    padEl.querySelectorAll('button').forEach(function (b) {
      var left = 9 - (count[b.dataset.d] || 0);
      b.querySelector('small').textContent = left > 0 ? left : '';
      b.classList.toggle('used', left <= 0);
      b.disabled = L.solved || L.gaveUp;
    });
    notesBtn.setAttribute('aria-pressed', String(notesMode));
    notesBtn.classList.toggle('on', notesMode);
    status();
  }
  function status() {
    if (flashing) return;
    var free = L.digits.filter(function (d) { return !d; }).length;
    if (L.solved) statusEl.innerHTML = '🎉 <b>' + esc(L.name) + ' gelöst</b> in ' + clock(L.seconds) + (L.help ? ' (mit Hilfe)' : ' ohne Hilfe');
    else if (L.gaveUp) statusEl.innerHTML = '👁 Aufgelöst. Morgen gibt es neue Sudokus.';
    else statusEl.innerHTML = '<b>' + esc(L.name) + '</b> · noch ' + free + (free === 1 ? ' Feld' : ' Felder') + ' frei' + (notesMode ? ' · ✏️ Notizen an' : '');
  }

  // ---------- Eingabe ----------
  function editable(i) { return i >= 0 && L.givens[i] === '-' && L.marks[i] !== 'revealed' && !L.solved && !L.gaveUp; }
  function select(i) { if (i >= 0 && i < 81) { L.sel = i; paintAll(); } }
  // Eine Aktion kann mehrere Felder ändern (Ziffer + Notizen der Nachbarn); Rückgängig nimmt sie als Ganzes zurück
  function apply(changes) {
    if (!changes.length) return;
    L.undo.push(changes.map(function (c) { return [c[0], L.digits[c[0]], L.notes[c[0]], L.marks[c[0]]]; }));
    if (L.undo.length > 200) L.undo.shift();
    changes.forEach(function (c) { L.digits[c[0]] = c[1]; L.notes[c[0]] = c[2]; if (c[3] != null) L.marks[c[0]] = c[3]; });
    L.started = true;
    paintAll();
    changed();
  }
  function enter(d, asNote) {
    var i = L.sel;
    if (!editable(i)) return;
    if (asNote || notesMode) {
      if (L.digits[i]) return;
      apply([[i, '', L.notes[i] ^ (1 << d)]]);
      return;
    }
    d = String(d);
    if (L.digits[i] === d) { apply([[i, '', 0, '']]); return; }
    var changes = [[i, d, 0, '']], bit = 1 << Number(d);
    // Die Ziffer aus den Notizen der Nachbarn streichen
    PEERS[i].forEach(function (j) { if (!L.digits[j] && L.notes[j] & bit) changes.push([j, '', L.notes[j] & ~bit]); });
    apply(changes);
  }
  function erase() {
    var i = L.sel;
    if (!editable(i)) return;
    if (L.digits[i]) apply([[i, '', 0, '']]);
    else if (L.notes[i]) apply([[i, '', 0]]);
  }
  function undo() {
    if (L.solved || L.gaveUp || !L.undo.length) return;
    L.undo.pop().forEach(function (c) { L.digits[c[0]] = c[1]; L.notes[c[0]] = c[2]; L.marks[c[0]] = c[3]; });
    paintAll();
    changed();
  }
  function toggleNotes() { notesMode = !notesMode; paintAll(); }
  function arrow(dx, dy) {
    var i = L.sel < 0 ? 0 : L.sel, r = (Math.floor(i / 9) + dy + 9) % 9, c = (i % 9 + dx + 9) % 9;
    select(r * 9 + c);
  }

  gridEl.addEventListener('click', function (e) {
    var el = e.target.closest('.sd-cell');
    if (el) select(Number(el.dataset.i));
  });
  padEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-d]');
    if (b) enter(Number(b.dataset.d));
  });
  notesBtn.addEventListener('click', toggleNotes);
  document.getElementById('sd-erase').addEventListener('click', erase);
  document.getElementById('sd-undo').addEventListener('click', undo);
  document.addEventListener('keydown', function (e) {
    if (!L || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, digit = /^(Digit|Numpad)([1-9])$/.exec(e.code || ''), handled = true;
    if (digit) enter(Number(digit[2]), e.shiftKey);
    else if (/^[1-9]$/.test(k)) enter(Number(k));
    else if (k === 'ArrowLeft') arrow(-1, 0);
    else if (k === 'ArrowRight') arrow(1, 0);
    else if (k === 'ArrowUp') arrow(0, -1);
    else if (k === 'ArrowDown') arrow(0, 1);
    else if (k === 'Backspace' || k === 'Delete' || k === '0') erase();
    else if (k === 'n' || k === 'N') toggleNotes();
    else handled = false;
    if (handled) e.preventDefault();
  });

  // ---------- Zeit und Speichern ----------
  var lastSave = 0, saveTimer = null;
  setInterval(function () {
    if (!L || !L.started || L.solved || L.gaveUp || document.hidden) return;
    L.seconds++;
    tick();
    // Auch ohne Tippen ab und zu die Zeit sichern
    if (ME && Date.now() - lastSave > 30000) save();
  }, 1000);
  function tick() { timeEl.textContent = '⏱ ' + clock(L.seconds); }

  function local(lv) {
    lv = lv || L;
    var day = store.days[G.day] || (store.days[G.day] = {});
    var d = day[lv.key] || (day[lv.key] = {});
    d.n = lv.notes.map(function (m) { return ('00' + (m || 0).toString(16)).slice(-3); }).join('');
    d.r = lv.marks.map(function (m) { return m === 'revealed' ? '1' : '0'; }).join('');
    if (!ME) { d.d = digitsString(lv); d.s = lv.seconds; d.h = lv.help; d.done = lv.solved; d.g = lv.gaveUp; }
    saveStore();
  }
  function digitsString(lv) { return (lv || L).digits.map(function (c) { return c || '-'; }).join(''); }
  function full() { return L.digits.every(function (c) { return c; }); }
  function changed() {
    L.dirty = true;
    local();
    clearTimeout(saveTimer);
    if (full()) save(); else if (ME) saveTimer = setTimeout(save, 1500);
  }
  function save(keepalive) {
    clearTimeout(saveTimer);
    var lv = L;
    if (!lv || lv.solved || lv.gaveUp) return Promise.resolve();
    local(lv);
    var isFull = lv.digits.every(function (c) { return c; });
    // Ohne Konto muss der Server nur sagen, ob ein volles Gitter stimmt
    if (!ME && !isFull) return Promise.resolve();
    lastSave = Date.now(); lv.dirty = false;
    var digits = digitsString(lv), day = G.day;
    return post('/sudoku/speichern', { day: day, level: lv.key, digits: digits, seconds: lv.seconds }, keepalive).then(function (r) {
      if (keepalive || !G || G.day !== day || G.levels[lv.key] !== lv) return;
      if (r.seconds != null) { lv.seconds = Math.max(lv.seconds, r.seconds); if (lv === L) tick(); }
      if (r.solved) solvedNow(lv, r);
      else if (isFull && lv.fullSeen !== digits && lv === L) {
        lv.fullSeen = digits;
        var clashes = gridEl.querySelectorAll('.clash').length;
        dialog('Fast geschafft', '<p>Alle Felder sind ausgefüllt, aber irgendwo steckt noch ein Fehler.</p><p>' +
          (clashes ? 'Rot markierte Ziffern kommen in einer Reihe, Spalte oder einem Block doppelt vor.' : 'Unter <b>Prüfen</b> findest du falsche Ziffern.') + '</p>', [['ok', 'OK']]);
      }
    }).catch(function () { /* nächster Versuch beim nächsten Tippen */ });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && ME && L && L.dirty) save(true); });
  window.addEventListener('pagehide', function () { if (ME && L && L.started && !L.solved && !L.gaveUp) save(true); });

  function solvedNow(lv, r) {
    lv.solved = true;
    if (r.seconds != null) lv.seconds = r.seconds;
    if (r.help) lv.help = Math.max(lv.help, 1);
    local(lv);
    if (lv !== L) return;
    root.classList.add('done'); gridEl.classList.add('solved');
    tabs(); paintAll(); tick();
    sound('tusch');
    var text = '<p>Du hast das Sudoku <b>' + esc(lv.name) + '</b> vom ' + esc(dateText(G.day, true)) + ' in <b>' + clock(lv.seconds) + '</b> gelöst' +
      (lv.help ? ', mit etwas Hilfe.' : ', ganz ohne Hilfe! 💪') + '</p>';
    if (ME && r.rank && r.rank.place) text += '<p>🏆 Platz ' + r.rank.place + ' von ' + r.rank.of + ' an diesem Tag.</p>';
    var next = G.keys.filter(function (k) { return !G.levels[k].solved && !G.levels[k].gaveUp; })[0];
    if (!ME) text += '<p>Mit Konto landet das Sudoku in deinem Profil, zählt für deine Serie und erscheint in der Bestenliste.</p>';
    var buttons = [['best', 'Bestenliste']];
    if (next) buttons.push(['next', 'Weiter mit ' + G.levels[next].name]);
    buttons.push(['ok', 'OK']);
    dialog('🎉 Gelöst!', text, buttons).then(function (res) {
      if (res.value === 'best') leaderboard();
      else if (res.value === 'next') pick(next);
    });
  }

  // ---------- Prüfen und Aufdecken ----------
  function checkReq(scope) {
    if (L.solved || L.gaveUp) return;
    if (scope === 'cell' && (L.sel < 0 || L.givens[L.sel] !== '-')) { flash('Wähle zuerst ein Feld, das du selbst ausgefüllt hast.'); return; }
    L.started = true;
    var lv = L, day = G.day;
    post('/sudoku/pruefen', { day: day, level: lv.key, digits: digitsString(lv), scope: scope, cell: lv.sel }).then(function (r) {
      if (!G || G.day !== day) return;
      lv.help++;
      (r.wrong || []).forEach(function (i) { lv.marks[i] = 'wrong'; });
      local(lv);
      if (lv !== L) return;
      paintAll();
      var filled = (r.checked || []).filter(function (i) { return lv.digits[i]; }).length;
      if (!r.wrong.length) flash(filled ? '✔ Alles richtig, was du geprüft hast.' : 'Da steht noch nichts zum Prüfen.');
      else flash('✘ ' + r.wrong.length + (r.wrong.length === 1 ? ' Ziffer ist' : ' Ziffern sind') + ' falsch (durchgestrichen).');
    }).catch(function () { flash('Prüfen hat nicht geklappt. Bitte später noch einmal.'); });
  }
  // Tipp: das freie Feld, in das am wenigsten Ziffern passen, also das leichteste nächste Feld
  function easiest() {
    var best = -1, bestN = 10;
    for (var i = 0; i < 81; i++) {
      if (L.digits[i]) continue;
      var used = {};
      PEERS[i].forEach(function (j) { if (L.digits[j]) used[L.digits[j]] = 1; });
      var n = 9 - Object.keys(used).length;
      if (n < bestN) { best = i; bestN = n; }
    }
    return best;
  }
  function revealReq(scope, hint) {
    if (L.solved || L.gaveUp) return;
    if (hint) {
      var i = easiest();
      if (i < 0) { flash('Alle Felder sind ausgefüllt. Prüfe, wo der Fehler steckt.'); return; }
      L.sel = i;
    } else if (scope === 'cell' && !editable(L.sel)) { flash('Wähle zuerst ein freies Feld.'); return; }
    var go = function () {
      L.started = true;
      var lv = L, day = G.day;
      post('/sudoku/aufdecken', { day: day, level: lv.key, scope: scope, cell: lv.sel }).then(function (r) {
        if (!G || G.day !== day) return;
        lv.help++;
        lv.undo = [];
        (r.cells || []).forEach(function (c) {
          if (lv.digits[c[0]] !== c[1]) { lv.digits[c[0]] = c[1]; lv.notes[c[0]] = 0; lv.marks[c[0]] = 'revealed'; }
          else if (lv.marks[c[0]] === 'wrong') lv.marks[c[0]] = '';
        });
        if (scope === 'all') {
          lv.gaveUp = true;
          local(lv);
          if (lv !== L) return;
          root.classList.add('done'); tabs(); paintAll();
          dialog('Aufgelöst', '<p>Hier ist die Lösung. Aufgedeckte Ziffern sind grün.</p><p>Morgen gibt es neue Sudokus!</p>', [['ok', 'OK']]);
          return;
        }
        if (lv === L) { paintAll(); changed(); }
      }).catch(function () { flash('Aufdecken hat nicht geklappt. Bitte später noch einmal.'); });
    };
    if (scope !== 'all') return go();
    dialog('Sudoku auflösen', '<p>Wirklich das ganze Sudoku (' + esc(L.name) + ') aufdecken?</p><p>Dann zählt es nicht als gelöst' +
      (ME ? '. Deine Serie hält, wenn du heute ein anderes Sudoku löst' : '') + '.</p>',
      [['ja', 'Auflösen'], ['nein', 'Abbrechen']]).then(function (res) { if (res.value === 'ja') go(); });
  }
  var flashTimer = null, flashing = false;
  function flash(text) {
    flashing = true;
    statusEl.innerHTML = '<span class="sd-flash">' + esc(text) + '</span>';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashing = false; status(); }, 3500);
  }
  function clearAll() {
    if (L.solved || L.gaveUp) return;
    dialog('Alles löschen', '<p>Alle eingetragenen Ziffern und Notizen löschen? Zeit und Hilfen bleiben.</p>', [['ja', 'Löschen'], ['nein', 'Abbrechen']]).then(function (res) {
      if (res.value !== 'ja') return;
      var changes = [];
      for (var i = 0; i < 81; i++) if (editable(i) && (L.digits[i] || L.notes[i])) changes.push([i, '', 0, '']);
      apply(changes);
    });
  }

  // ---------- Laden, Archiv, Bestenliste ----------
  function load(day) {
    getJson('/sudoku/raetsel' + (day ? '?day=' + encodeURIComponent(day) : '')).then(init)
      .catch(function () { dialog('Sudoku', '<p>Das Sudoku ließ sich nicht laden.</p>', [['ok', 'OK']]); });
  }
  function archive() {
    getJson('/sudoku/archiv').then(function (r) {
      var icon = function (st) { return st === 'solved' ? '✔' : st === 'gave_up' ? '👁' : st === 'started' ? '✏️' : '·'; };
      var html = '<p>Die Sudokus der letzten Tage. In die Serie zählt ein Tag nur, wenn du an ihm selbst mindestens ein Sudoku löst.</p>' +
        '<table class="sd-days"><tr><th></th>' + G.keys.map(function (k) { return '<th>' + esc(G.levels[k].name) + '</th>'; }).join('') + '</tr>' +
        r.days.map(function (d) {
          var local = store.days[d.day] || {};
          return '<tr' + (d.day === G.day ? ' class="me"' : '') + '><td><button type="button" class="link" data-day="' + d.day + '">' +
            esc(dateText(d.day)) + (d.day === r.today ? ' (heute)' : '') + '</button></td>' +
            G.keys.map(function (k) {
              var st = ME ? d.state[k] : local[k] ? (local[k].done ? 'solved' : local[k].g ? 'gave_up' : local[k].s ? 'started' : null) : null;
              return '<td class="num">' + icon(st) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</table><p class="ms-sum">✔ gelöst · ✏️ angefangen · 👁 aufgelöst</p>';
      dialog('Archiv', html, [['ok', 'Schließen']], { ready: function (dlg) {
        dlg.querySelectorAll('[data-day]').forEach(function (b) {
          b.addEventListener('click', function () { dlg.close(''); load(b.dataset.day); });
        });
      } });
    }).catch(function () { /* offline */ });
  }
  function leaderboard() {
    var lv = L;
    getJson('/sudoku/bestenliste?day=' + encodeURIComponent(G.day) + '&level=' + encodeURIComponent(lv.key)).then(function (r) {
      var html = '<fieldset class="groupbox"><legend>' + esc(lv.name) + ' · ' + esc(dateText(G.day)) + '</legend><ol class="ms-board">' + (r.list.length ? r.list.map(function (e) {
        var n = e.url ? '<a href="' + esc(e.url) + '">' + esc(e.name) + '</a>' : esc(e.name);
        return '<li' + (e.me ? ' class="me"' : '') + '><span class="num">' + clock(e.seconds) + '</span> ' + n + (e.help ? ' <span title="mit Hilfe">💡</span>' : '') + '</li>';
      }).join('') : '<li class="empty">Noch niemand. Sei der Erste!</li>') + '</ol>' +
        '<p class="ms-sum">Ohne Hilfe steht vor mit Hilfe (💡), dann zählt die Zeit. Gelöst haben ' + r.solvers + '.</p></fieldset>';
      if (r.mine && r.mine.solved) {
        var m = r.mine, days = function (n) { return n + (n === 1 ? ' Tag' : ' Tage'); };
        html += '<fieldset class="groupbox"><legend>Deine Statistik</legend><table class="ms-times">' +
          '<tr><td>Gelöst:</td><td class="num">' + m.solved + '</td></tr><tr><td>Davon ohne Hilfe:</td><td class="num">' + m.clean + '</td></tr>' +
          '<tr><td>Aktuelle Serie:</td><td class="num">' + days(m.streak) + '</td></tr><tr><td>Längste Serie:</td><td class="num">' + days(m.best_streak) + '</td></tr>' +
          G.keys.map(function (k) {
            var t = m.levels[k];
            return t && t.best != null ? '<tr><td>Bestzeit ' + esc(G.levels[k].name) + ':</td><td class="num">' + clock(t.best) + '</td></tr>' : '';
          }).join('') + '</table></fieldset>';
      } else if (!ME) html += '<p class="ms-sum">Melde dich an, damit deine Sudokus in der Bestenliste und im Profil landen.</p>';
      dialog('Bestenliste', html, [['ok', 'OK']], true);
    }).catch(function () { /* offline */ });
  }

  // ---------- Menüs (wie bei Minesweeper) ----------
  var MENUS = {
    spiel: [
      ['Heutige Sudokus', '', function () { load(); }],
      ['Archiv…', '', archive],
      ['Bestenliste…', '', leaderboard],
      '-',
      ['Notizen an/aus', 'N', toggleNotes],
      ['Rückgängig', 'Strg+Z', undo],
      ['Alles löschen', '', clearAll],
      '-',
      ['Beenden', '', quit],
    ],
    pruefen: [
      ['Feld', '', function () { checkReq('cell'); }],
      ['Ganzes Sudoku', '', function () { checkReq('all'); }],
    ],
    aufdecken: [
      ['Tipp (leichtestes Feld)', '', function () { revealReq('cell', true); }],
      ['Gewähltes Feld', '', function () { revealReq('cell'); }],
      '-',
      ['Ganzes Sudoku auflösen…', '', function () { revealReq('all'); }],
    ],
    hilfe: [
      ['Anleitung', 'F1', help],
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
    dd = document.createElement('div');
    dd.className = 'ms-dd'; dd.setAttribute('role', 'menu');
    MENUS[key].forEach(function (it) {
      if (it === '-') { dd.appendChild(document.createElement('hr')); return; }
      var row = document.createElement('button');
      row.type = 'button'; row.className = 'ms-mi'; row.setAttribute('role', 'menuitem');
      row.innerHTML = '<span>' + esc(it[0]) + '</span><span>' + esc(it[1]) + '</span>';
      row.addEventListener('click', function () { closeMenu(); it[2](); });
      dd.appendChild(row);
    });
    var br = b.getBoundingClientRect();
    dd.style.position = 'fixed'; dd.style.zIndex = 1000;
    dd.style.left = br.left + 'px'; dd.style.top = br.bottom + 'px';
    document.body.appendChild(dd);
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
  document.addEventListener('pointerdown', function (e) { if (dd && !dd.contains(e.target) && !e.target.closest('.sd-menu')) closeMenu(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F1') { e.preventDefault(); closeMenu(); help(); }
    else if (e.key === 'Escape') closeMenu();
  });
  function quit() {
    if (desk && desk.close) desk.close(window);
    else location.href = '/';
  }

  // ---------- Dialoge ----------
  function dialog(title, html, buttons, wide) {
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'window ms-dlg' + (wide ? ' wide' : '');
      dlg.innerHTML = '<div class="titlebar"><span class="ttl">' + esc(title) + '</span><button type="button" class="tb-btn" aria-label="Schließen">×</button></div>' +
        '<form method="dialog" class="body"><div class="ms-dlg-body">' + html + '</div><div class="actions">' +
        buttons.map(function (b) { return '<button value="' + b[0] + '">' + esc(b[1]) + '</button>'; }).join(' ') + '</div></form>';
      dlg.querySelector('.tb-btn').addEventListener('click', function () { dlg.close(''); });
      // Profile in der Bestenliste öffnen ein Fenster auf dem Desktop
      dlg.addEventListener('click', function (e) {
        var a = e.target.closest('a[href]');
        if (!a) return;
        e.preventDefault(); dlg.close('');
        if (desk) desk.open(a.getAttribute('href'), true); else location.href = a.href;
      });
      dlg.addEventListener('close', function () { dlg.remove(); resolve({ value: dlg.returnValue }); });
      document.body.appendChild(dlg);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      if (wide && wide.ready) wide.ready(dlg);
    });
  }
  function help() {
    dialog('Sudoku-Hilfe',
      '<p>Jeden Tag um Mitternacht gibt es drei neue Sudokus, <b>Leicht</b>, <b>Mittel</b> und <b>Schwer</b>, für alle Besucher dieselben. Jedes hat genau eine Lösung, die sich ohne Raten finden lässt.</p>' +
      '<ul><li>Fülle das Gitter so, dass in jeder <b>Reihe</b>, jeder <b>Spalte</b> und jedem <b>3×3-Block</b> die Ziffern 1 bis 9 genau einmal stehen.</li>' +
      '<li><b>Klicke</b> auf ein Feld und tippe eine Ziffer, oder nimm das Ziffernfeld. Die kleine Zahl darauf zeigt, wie oft die Ziffer noch fehlt. <b>Pfeiltasten</b> bewegen, <b>Rücktaste</b> oder <b>0</b> löscht.</li>' +
      '<li><b>Notizen</b> (✏️ oder Taste N, am PC auch Umschalt + Ziffer) tragen kleine Merkziffern ein. Setzt du eine Ziffer, verschwindet sie aus den Notizen der Nachbarfelder.</li>' +
      '<li>Doppelte Ziffern in einer Reihe, Spalte oder einem Block werden <b>rot</b>. Das ist keine Hilfe und kostet nichts.</li>' +
      '<li><b>Prüfen</b> streicht falsche Ziffern durch, <b>Aufdecken</b> verrät Ziffern (grün). Beides zählt als Hilfe. Wer das ganze Sudoku auflöst, hat es nicht gelöst.</li>' +
      '<li>Die <b>Uhr</b> läuft für jede Stufe einzeln ab der ersten Eingabe und hält an, solange das Fenster nicht zu sehen ist.</li></ul>' +
      '<p>' + (ME ? 'Dein Stand wird gespeichert. Gelöste Sudokus, deine Serie (Tage mit mindestens einem gelösten Sudoku) und deine Bestzeiten stehen im Profil, die schnellsten Löser in der Bestenliste.'
        : 'Ohne Konto bleibt dein Stand in diesem Browser. Mit Konto zählen deine Sudokus im Profil und in der Bestenliste.') + '</p>', [['ok', 'OK']], true);
  }
  function about() {
    dialog('Info über Sudoku',
      '<div class="ms-about"><span class="ms-about-icon">🔢</span><div><p><b>Tägliches Sudoku</b></p>' +
      '<p>Jeden Tag frisch erzeugt von ' + esc(SITE) + '. Drei Stufen, eine Lösung, kein Raten.</p></div></div>', [['ok', 'OK']]);
  }

  init(JSON.parse(document.getElementById('sd-data').textContent));
  window.addEventListener('load', layout);
})();
