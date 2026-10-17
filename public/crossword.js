// Tägliches Kreuzworträtsel. Das Gitter sind einfache Kästchen; getippt wird in ein unsichtbares Eingabefeld über
// dem aktiven Kästchen, damit am Handy die Tastatur aufgeht. Die Lösung kennt nur der Server: Prüfen, Aufdecken und
// „gelöst?“ fragen ihn. Ohne Konto bleibt der Stand im Browser (localStorage), mit Konto speichert ihn der Server.
(function () {
  'use strict';
  var root = document.getElementById('cw');
  if (!root) return;
  var CSRF = root.dataset.csrf, ME = root.dataset.user, SITE = root.dataset.site;
  var gridEl = document.getElementById('cw-grid'), board = document.getElementById('cw-board'), input = document.getElementById('cw-input');
  var clueEl = document.getElementById('cw-clue'), timeEl = document.getElementById('cw-time'), dateEl = document.getElementById('cw-date');
  var lists = { a: document.getElementById('cw-across'), d: document.getElementById('cw-down') };
  var menubar = root.querySelector('.cw-menu');
  var desk = null;
  try { if (window.parent !== window && window.parent.RetroDesk) desk = window.parent.RetroDesk; } catch (e) { desk = null; }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clock(s) { s = Math.max(0, s | 0); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function dateText(day, long) {
    return new Date(day + 'T12:00:00Z').toLocaleDateString('de-DE', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }
  function sound(name) { if (window.RetroSound) window.RetroSound.play(name); }

  // ---------- Stand im Browser (ohne Konto der einzige, mit Konto nur die Markierungen) ----------
  var KEY = 'kreuzwortraetsel';
  var store = { days: {} };
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

  // ---------- Rätsel aufbauen ----------
  var S = null;   // Zustand des geladenen Rätsels
  function init(data) {
    var P = data.puzzle, n = P.w * P.h;
    S = { day: data.day, today: data.today, P: P, cells: new Array(n), letters: new Array(n), marks: new Array(n), els: new Array(n),
      cur: { i: -1, dir: 'a' }, seconds: 0, started: false, help: 0, solved: false, gaveUp: false, dirty: false, fullSeen: null };
    P.words.forEach(function (w, wi) {
      for (var k = 0; k < w.len; k++) {
        var i = (w.y + (w.dir === 'd' ? k : 0)) * P.w + w.x + (w.dir === 'a' ? k : 0);
        var c = S.cells[i] || (S.cells[i] = { a: -1, d: -1, num: 0 });
        c[w.dir] = wi;
        if (!k) c.num = w.num;
      }
    });
    for (var i = 0; i < n; i++) { S.letters[i] = S.cells[i] ? '' : '#'; S.marks[i] = ''; }
    // Gespeicherten Stand übernehmen: mit Konto vom Server, sonst aus dem Browser
    var local = store.days[S.day] || {}, prog = data.progress;
    var saved = ME ? prog && prog.letters : local.l;
    if (saved && saved.length === n) for (i = 0; i < n; i++) if (S.cells[i] && /[A-Z]/.test(saved[i])) S.letters[i] = saved[i];
    if (local.r && local.r.length === n) for (i = 0; i < n; i++) if (local.r[i] === '1' && S.cells[i]) S.marks[i] = 'revealed';
    if (ME && prog) { S.seconds = prog.seconds; S.help = prog.help; S.solved = prog.solved; S.gaveUp = prog.gave_up; }
    else if (!ME) { S.seconds = local.s || 0; S.help = local.h || 0; S.solved = !!local.done; S.gaveUp = !!local.g; }
    S.started = S.seconds > 0;
    build();
    var first = P.words[0];
    select(first.y * P.w + first.x, first.dir);
    if (S.solved || S.gaveUp) lock();
    tick(true);
  }

  function build() {
    var P = S.P;
    root.classList.remove('done'); gridEl.classList.remove('solved');
    gridEl.style.gridTemplateColumns = 'repeat(' + P.w + ', var(--cw-cell))';
    gridEl.innerHTML = '';
    for (var i = 0; i < P.w * P.h; i++) {
      var el = document.createElement('div');
      if (S.cells[i]) {
        el.className = 'cw-cell';
        el.dataset.i = i;
        el.setAttribute('role', 'gridcell');
        el.innerHTML = (S.cells[i].num ? '<span class="n">' + S.cells[i].num + '</span>' : '') + '<span class="l"></span>';
      } else el.className = 'cw-void';
      gridEl.appendChild(el);
      S.els[i] = el;
    }
    ['a', 'd'].forEach(function (dir) {
      lists[dir].innerHTML = S.P.words.map(function (w, wi) {
        return w.dir === dir ? '<li data-w="' + wi + '"><b>' + w.num + '</b> ' + esc(w.clue) + ' <small>(' + w.len + ')</small></li>' : '';
      }).join('');
    });
    var archived = S.day !== S.today;
    dateEl.innerHTML = (archived ? '📅 Archiv: ' : '📰 ') + esc(dateText(S.day, true));
    for (i = 0; i < S.letters.length; i++) paint(i);
    layout();
  }

  // Kästchengröße passend zum Fenster
  function layout() {
    if (!S) return;
    var narrow = window.innerWidth < 640;
    root.classList.toggle('narrow', narrow);
    var w = board.clientWidth - 12, h = narrow ? Infinity : board.clientHeight - 12;
    var size = Math.floor(Math.min(w / S.P.w, h / S.P.h));
    size = Math.max(20, Math.min(narrow ? 40 : 46, size || 30));
    root.style.setProperty('--cw-cell', size + 'px');
    placeInput();
  }
  window.addEventListener('resize', layout);

  function paint(i) {
    var el = S.els[i];
    if (!S.cells[i]) return;
    el.querySelector('.l').textContent = S.letters[i];
    el.classList.toggle('wrong', S.marks[i] === 'wrong');
    el.classList.toggle('revealed', S.marks[i] === 'revealed');
  }

  // ---------- Auswahl ----------
  function wordAt(i, dir) { return S.cells[i] ? S.cells[i][dir] : -1; }
  function cellsOfWord(wi) {
    var w = S.P.words[wi], out = [];
    for (var k = 0; k < w.len; k++) out.push((w.y + (w.dir === 'd' ? k : 0)) * S.P.w + w.x + (w.dir === 'a' ? k : 0));
    return out;
  }
  function select(i, dir) {
    if (!S.cells[i]) return;
    if (wordAt(i, dir) < 0) dir = dir === 'a' ? 'd' : 'a';
    S.cur = { i: i, dir: dir };
    highlight();
  }
  function highlight() {
    var wi = wordAt(S.cur.i, S.cur.dir), other = wordAt(S.cur.i, S.cur.dir === 'a' ? 'd' : 'a');
    var inWord = {};
    if (wi >= 0) cellsOfWord(wi).forEach(function (i) { inWord[i] = 1; });
    S.els.forEach(function (el, i) {
      if (!S.cells[i]) return;
      el.classList.toggle('word', !!inWord[i]);
      el.classList.toggle('cur', i === S.cur.i);
    });
    root.querySelectorAll('.cw-list li').forEach(function (li) {
      var n = Number(li.dataset.w);
      li.classList.toggle('active', n === wi);
      li.classList.toggle('cross', n === other);
      // Am Handy stehen die Hinweise unter dem Gitter, dort nicht hinscrollen
      if (n === wi && !root.classList.contains('narrow')) li.scrollIntoView({ block: 'nearest' });
    });
    if (S.solved || S.gaveUp) clueEl.innerHTML = S.solved ? '🎉 <b>Gelöst</b> in ' + clock(S.seconds) + (S.help ? ' (mit Hilfe)' : ' ohne Hilfe') : '👁 Aufgelöst. Morgen gibt es ein neues Rätsel.';
    else if (wi >= 0) {
      var w = S.P.words[wi];
      clueEl.innerHTML = '<b>' + w.num + ' ' + (w.dir === 'a' ? 'waagerecht' : 'senkrecht') + ':</b> ' + esc(w.clue) + ' <small>(' + w.len + ' Buchstaben)</small>';
    }
    markDone();
    placeInput();
  }
  function markDone() {
    root.querySelectorAll('.cw-list li').forEach(function (li) {
      li.classList.toggle('done', cellsOfWord(Number(li.dataset.w)).every(function (i) { return S.letters[i]; }));
    });
  }
  function placeInput() {
    var el = S && S.els[S.cur.i];
    if (!el) return;
    input.style.left = el.offsetLeft + 'px'; input.style.top = el.offsetTop + 'px';
    input.style.width = el.offsetWidth + 'px'; input.style.height = el.offsetHeight + 'px';
  }
  function focusInput() { if (!S.solved && !S.gaveUp) { input.value = ' '; input.focus({ preventScroll: true }); } }

  gridEl.addEventListener('click', function (e) {
    var el = e.target.closest('.cw-cell');
    if (!el) return;
    var i = Number(el.dataset.i);
    if (i === S.cur.i) select(i, S.cur.dir === 'a' ? 'd' : 'a');
    else select(i, S.cur.dir);
    focusInput();
  });
  root.querySelector('.cw-lists').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-w]');
    if (!li) return;
    var cells = cellsOfWord(Number(li.dataset.w)), w = S.P.words[Number(li.dataset.w)];
    var empty = cells.filter(function (i) { return !S.letters[i]; })[0];
    select(empty != null ? empty : cells[0], w.dir);
    focusInput();
  });

  // ---------- Tippen ----------
  function move(step) {
    // Im aktuellen Wort weiter (oder zurück)
    var wi = wordAt(S.cur.i, S.cur.dir);
    if (wi < 0) return;
    var cells = cellsOfWord(wi), k = cells.indexOf(S.cur.i) + step;
    if (k >= 0 && k < cells.length) select(cells[k], S.cur.dir);
  }
  function arrow(dx, dy) {
    var dir = dx ? 'a' : 'd';
    if (dir !== S.cur.dir && wordAt(S.cur.i, dir) >= 0) { select(S.cur.i, dir); return; }
    // Bis zum nächsten Kästchen in dieser Richtung springen, auch über Lücken
    var x = S.cur.i % S.P.w, y = Math.floor(S.cur.i / S.P.w);
    for (x += dx, y += dy; x >= 0 && y >= 0 && x < S.P.w && y < S.P.h; x += dx, y += dy) {
      var i = y * S.P.w + x;
      if (S.cells[i]) { select(i, S.cur.dir); return; }
    }
  }
  function nextWord(step) {
    var order = S.P.words.map(function (w, wi) { return wi; });
    var wi = wordAt(S.cur.i, S.cur.dir), k = order.indexOf(wi);
    var nw = S.P.words[order[(k + step + order.length) % order.length]];
    var cells = cellsOfWord(order[(k + step + order.length) % order.length]);
    var empty = cells.filter(function (i) { return !S.letters[i]; })[0];
    select(empty != null ? empty : cells[0], nw.dir);
  }
  function setLetter(i, ch) {
    if (S.marks[i] === 'revealed' || S.letters[i] === ch) return;
    S.letters[i] = ch; S.marks[i] = '';
    paint(i);
    changed();
  }
  function type(text) {
    if (S.solved || S.gaveUp) return;
    // Umlaute schreibt man im Rätsel aus
    var s = String(text).toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ|ß/g, 'SS').replace(/[^A-Z]/g, '');
    for (var k = 0; k < s.length; k++) {
      start();
      setLetter(S.cur.i, s[k]);
      move(1);
    }
    highlight();
  }
  function backspace() {
    if (S.solved || S.gaveUp) return;
    if (S.letters[S.cur.i] && S.marks[S.cur.i] !== 'revealed') setLetter(S.cur.i, '');
    else { move(-1); if (S.marks[S.cur.i] !== 'revealed') setLetter(S.cur.i, ''); }
    highlight();
  }
  input.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, handled = true;
    if (k === 'ArrowLeft') arrow(-1, 0);
    else if (k === 'ArrowRight') arrow(1, 0);
    else if (k === 'ArrowUp') arrow(0, -1);
    else if (k === 'ArrowDown') arrow(0, 1);
    else if (k === 'Backspace') backspace();
    else if (k === 'Delete') { if (S.marks[S.cur.i] !== 'revealed' && !S.solved && !S.gaveUp) setLetter(S.cur.i, ''); }
    else if (k === 'Tab') nextWord(e.shiftKey ? -1 : 1);
    else if (k === 'Enter') nextWord(1);
    else if (k === ' ') select(S.cur.i, S.cur.dir === 'a' ? 'd' : 'a');
    else if (k === 'Escape') { closeMenu(); input.blur(); }
    else if (k.length === 1 && /[a-zäöüß]/i.test(k)) type(k);
    else handled = false;
    if (handled) { e.preventDefault(); input.value = ' '; }
  });
  // Handy-Tastaturen schicken oft keine Tasten, nur Text: das Feld enthält immer ein Leerzeichen,
  // fehlt es, wurde gelöscht
  input.addEventListener('input', function (e) {
    var v = input.value;
    if (e.inputType === 'deleteContentBackward' || v === '') backspace();
    else type(v.replace(/^ /, ''));
    input.value = ' ';
  });

  // ---------- Zeit und Speichern ----------
  function start() { S.started = true; }
  var lastSave = 0, saveTimer = null;
  setInterval(function () {
    if (!S || !S.started || S.solved || S.gaveUp || document.hidden) return;
    S.seconds++;
    tick();
    // Auch ohne Tippen ab und zu die Zeit sichern
    if (ME && Date.now() - lastSave > 30000) save();
  }, 1000);
  function tick() { timeEl.textContent = '⏱ ' + clock(S.seconds); }

  function local() {
    var d = store.days[S.day] || (store.days[S.day] = {});
    d.r = S.marks.map(function (m) { return m === 'revealed' ? '1' : '0'; }).join('');
    if (!ME) { d.l = lettersString(); d.s = S.seconds; d.h = S.help; d.done = S.solved; d.g = S.gaveUp; }
    saveStore();
  }
  function lettersString() { return S.letters.map(function (c) { return c === '#' ? '#' : c || '-'; }).join(''); }
  function full() { return S.letters.every(function (c) { return c; }); }
  function changed() {
    S.dirty = true;
    local();
    clearTimeout(saveTimer);
    if (full()) save(); else if (ME) saveTimer = setTimeout(save, 1500);
  }
  function save(keepalive) {
    clearTimeout(saveTimer);
    if (!S || S.solved || S.gaveUp) return Promise.resolve();
    local();
    var isFull = full();
    // Ohne Konto muss der Server nur sagen, ob ein volles Gitter stimmt
    if (!ME && !isFull) return Promise.resolve();
    lastSave = Date.now(); S.dirty = false;
    var letters = lettersString(), day = S.day;
    return post('/kreuzwortraetsel/speichern', { day: day, letters: letters, seconds: S.seconds }, keepalive).then(function (r) {
      if (!S || S.day !== day || keepalive) return;
      if (r.seconds != null) { S.seconds = Math.max(S.seconds, r.seconds); tick(); }
      if (r.solved) solvedNow(r);
      else if (isFull && S.fullSeen !== letters) {
        S.fullSeen = letters;
        dialog('Fast geschafft', '<p>Alle Kästchen sind ausgefüllt, aber irgendwo steckt noch ein Fehler.</p><p>Unter <b>Prüfen</b> findest du falsche Buchstaben.</p>', [['ok', 'OK']]);
      }
    }).catch(function () { /* nächster Versuch beim nächsten Tippen */ });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && ME && S && S.dirty) save(true); });
  window.addEventListener('pagehide', function () { if (ME && S && S.started && !S.solved && !S.gaveUp) save(true); });

  function lock() {
    root.classList.add('done');
    gridEl.classList.toggle('solved', S.solved);
    input.blur();
    highlight();
  }
  function solvedNow(r) {
    S.solved = true;
    if (r.seconds != null) S.seconds = r.seconds;
    if (r.help) S.help = Math.max(S.help, 1);
    local();
    lock();
    sound('tusch');
    var text = '<p>Du hast das Kreuzworträtsel vom ' + esc(dateText(S.day, true)) + ' in <b>' + clock(r.seconds != null ? r.seconds : S.seconds) + '</b> gelöst' +
      (S.help || r.help ? ', mit etwas Hilfe.' : ', ganz ohne Hilfe! 💪') + '</p>';
    if (ME && r.rank && r.rank.place) text += '<p>🏆 Platz ' + r.rank.place + ' von ' + r.rank.of + ' an diesem Tag.</p>';
    if (!ME) text += '<p>Mit Konto landet das Rätsel in deinem Profil, zählt für deine Serie und erscheint in der Bestenliste.</p>';
    dialog('🎉 Gelöst!', text, [['best', 'Bestenliste'], ['ok', 'OK']]).then(function (res) { if (res.value === 'best') leaderboard(); });
  }

  // ---------- Prüfen und Aufdecken ----------
  function checkReq(scope) {
    if (S.solved || S.gaveUp) return;
    start();
    var day = S.day;
    post('/kreuzwortraetsel/pruefen', { day: day, letters: lettersString(), scope: scope, cell: S.cur.i, dir: S.cur.dir }).then(function (r) {
      if (!S || S.day !== day) return;
      S.help++;
      (r.wrong || []).forEach(function (i) { S.marks[i] = 'wrong'; paint(i); });
      local();
      var filled = (r.checked || []).filter(function (i) { return S.letters[i]; }).length;
      if (!r.wrong.length) flash(filled ? '✔ Alles richtig, was du geprüft hast.' : 'Da steht noch nichts zum Prüfen.');
      else flash('✘ ' + r.wrong.length + (r.wrong.length === 1 ? ' Buchstabe ist' : ' Buchstaben sind') + ' falsch (rot markiert).');
    }).catch(function () { flash('Prüfen hat nicht geklappt. Bitte später noch einmal.'); });
  }
  function revealReq(scope) {
    if (S.solved || S.gaveUp) return;
    var go = function () {
      start();
      var day = S.day;
      post('/kreuzwortraetsel/aufdecken', { day: day, scope: scope, cell: S.cur.i, dir: S.cur.dir }).then(function (r) {
        if (!S || S.day !== day) return;
        S.help++;
        (r.cells || []).forEach(function (c) {
          if (S.letters[c[0]] !== c[1]) { S.letters[c[0]] = c[1]; S.marks[c[0]] = 'revealed'; }
          else if (S.marks[c[0]] === 'wrong') S.marks[c[0]] = '';
          paint(c[0]);
        });
        if (scope === 'all') {
          S.gaveUp = true;
          local(); lock(); markDone();
          dialog('Aufgelöst', '<p>Hier ist die Lösung. Aufgedeckte Buchstaben sind blau.</p><p>Morgen gibt es ein neues Rätsel!</p>', [['ok', 'OK']]);
          return;
        }
        changed();
        highlight();
      }).catch(function () { flash('Aufdecken hat nicht geklappt. Bitte später noch einmal.'); });
    };
    if (scope !== 'all') return go();
    dialog('Rätsel auflösen', '<p>Wirklich das ganze Rätsel aufdecken?</p><p>Dann zählt es nicht als gelöst' + (ME ? ' und deine Serie reißt ab' : '') + '.</p>',
      [['ja', 'Auflösen'], ['nein', 'Abbrechen']]).then(function (res) { if (res.value === 'ja') go(); });
  }
  var flashTimer = null;
  function flash(text) {
    clueEl.innerHTML = '<span class="cw-flash">' + esc(text) + '</span>';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(highlight, 3500);
  }
  function clearAll() {
    if (S.solved || S.gaveUp) return;
    dialog('Alles löschen', '<p>Alle eingetragenen Buchstaben löschen? Zeit und Hilfen bleiben.</p>', [['ja', 'Löschen'], ['nein', 'Abbrechen']]).then(function (res) {
      if (res.value !== 'ja') return;
      S.letters.forEach(function (c, i) { if (S.cells[i] && S.marks[i] !== 'revealed') { S.letters[i] = ''; S.marks[i] = ''; paint(i); } });
      changed(); highlight();
    });
  }

  // ---------- Laden, Archiv, Bestenliste ----------
  function load(day) {
    if (S && S.dirty && ME) save();
    getJson('/kreuzwortraetsel/raetsel' + (day ? '?day=' + encodeURIComponent(day) : '')).then(init)
      .catch(function () { dialog('Kreuzworträtsel', '<p>Das Rätsel ließ sich nicht laden.</p>', [['ok', 'OK']]); });
  }
  function archive() {
    getJson('/kreuzwortraetsel/archiv').then(function (r) {
      var html = '<p>Die Rätsel der letzten Tage. In die Serie zählt ein Rätsel nur, wenn du es an seinem Tag löst.</p><ul class="ms-board cw-days">' +
        r.days.map(function (d) {
          var st = ME ? d.state : (store.days[d.day] ? (store.days[d.day].done ? 'solved' : store.days[d.day].g ? 'gave_up' : 'started') : null);
          var icon = st === 'solved' ? '✔' : st === 'gave_up' ? '👁' : st === 'started' ? '✏️' : '·';
          return '<li' + (d.day === S.day ? ' class="me"' : '') + '><button type="button" class="link" data-day="' + d.day + '"><span class="num">' + icon + '</span> ' +
            esc(dateText(d.day)) + (d.day === r.today ? ' (heute)' : '') + '</button></li>';
        }).join('') + '</ul><p class="ms-sum">✔ gelöst · ✏️ angefangen · 👁 aufgelöst</p>';
      dialog('Archiv', html, [['ok', 'Schließen']], { ready: function (dlg) {
        dlg.querySelectorAll('[data-day]').forEach(function (b) {
          b.addEventListener('click', function () { dlg.close(''); load(b.dataset.day); });
        });
      } });
    }).catch(function () { /* offline */ });
  }
  function leaderboard() {
    getJson('/kreuzwortraetsel/bestenliste?day=' + encodeURIComponent(S.day)).then(function (r) {
      var html = '<fieldset class="groupbox"><legend>' + esc(dateText(S.day)) + '</legend><ol class="ms-board">' + (r.list.length ? r.list.map(function (e) {
        var n = e.url ? '<a href="' + esc(e.url) + '">' + esc(e.name) + '</a>' : esc(e.name);
        return '<li' + (e.me ? ' class="me"' : '') + '><span class="num">' + clock(e.seconds) + '</span> ' + n + (e.help ? ' <span title="mit Hilfe">💡</span>' : '') + '</li>';
      }).join('') : '<li class="empty">Noch niemand. Sei der Erste!</li>') + '</ol>' +
        '<p class="ms-sum">Ohne Hilfe steht vor mit Hilfe (💡), dann zählt die Zeit. Gelöst haben ' + r.solvers + '.</p></fieldset>';
      if (r.mine && r.mine.solved) {
        var m = r.mine;
        html += '<fieldset class="groupbox"><legend>Deine Statistik</legend><table class="ms-times">' +
          '<tr><td>Gelöst:</td><td class="num">' + m.solved + '</td></tr><tr><td>Davon ohne Hilfe:</td><td class="num">' + m.clean + '</td></tr>' +
          '<tr><td>Aktuelle Serie:</td><td class="num">' + m.streak + (m.streak === 1 ? ' Tag' : ' Tage') + '</td></tr><tr><td>Längste Serie:</td><td class="num">' + m.best_streak + (m.best_streak === 1 ? ' Tag' : ' Tage') + '</td></tr>' +
          (m.best != null ? '<tr><td>Bestzeit ohne Hilfe:</td><td class="num">' + clock(m.best) + '</td></tr>' : '') +
          '<tr><td>Durchschnitt:</td><td class="num">' + clock(m.avg) + '</td></tr></table></fieldset>';
      } else if (!ME) html += '<p class="ms-sum">Melde dich an, damit deine Rätsel in der Bestenliste und im Profil landen.</p>';
      dialog('Bestenliste', html, [['ok', 'OK']], true);
    }).catch(function () { /* offline */ });
  }

  // ---------- Menüs (wie bei Minesweeper) ----------
  var MENUS = {
    raetsel: [
      ['Heutiges Rätsel', '', function () { load(); }],
      ['Archiv…', '', archive],
      ['Bestenliste…', '', leaderboard],
      '-',
      ['Alles löschen', '', clearAll],
      '-',
      ['Beenden', '', quit],
    ],
    pruefen: [
      ['Buchstabe', '', function () { checkReq('cell'); }],
      ['Wort', '', function () { checkReq('word'); }],
      ['Ganzes Rätsel', '', function () { checkReq('all'); }],
    ],
    aufdecken: [
      ['Buchstabe', '', function () { revealReq('cell'); }],
      ['Wort', '', function () { revealReq('word'); }],
      '-',
      ['Ganzes Rätsel auflösen…', '', function () { revealReq('all'); }],
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
  document.addEventListener('pointerdown', function (e) { if (dd && !dd.contains(e.target) && !e.target.closest('.cw-menu')) closeMenu(); });
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
    dialog('Kreuzworträtsel-Hilfe',
      '<p>Jeden Tag um Mitternacht gibt es ein neues Rätsel, für alle Besucher dasselbe.</p>' +
      '<ul><li><b>Klicke</b> auf ein Kästchen oder einen Hinweis und tippe los. Ein zweiter Klick auf dasselbe Kästchen (oder die Leertaste) wechselt zwischen waagerecht und senkrecht.</li>' +
      '<li><b>Pfeiltasten</b> bewegen, <b>Tab</b> und <b>Enter</b> springen zum nächsten Wort, <b>Rücktaste</b> löscht.</li>' +
      '<li><b>Umlaute</b> schreibt man wie in Rätseln üblich aus: Ä = AE, Ö = OE, Ü = UE, ß = SS. Tippst du ä, trägt das Rätsel A und E ein.</li>' +
      '<li><b>Prüfen</b> markiert falsche Buchstaben rot, <b>Aufdecken</b> verrät Buchstaben (blau). Beides zählt als Hilfe. Wer das ganze Rätsel auflöst, hat es nicht gelöst.</li>' +
      '<li>Die <b>Uhr</b> läuft ab dem ersten Buchstaben und hält an, solange das Fenster nicht zu sehen ist.</li></ul>' +
      '<p>' + (ME ? 'Dein Stand wird gespeichert. Gelöste Rätsel, deine Serie und deine Bestzeit stehen im Profil, die schnellsten Löser in der Bestenliste.'
        : 'Ohne Konto bleibt dein Stand in diesem Browser. Mit Konto zählen deine Rätsel im Profil und in der Bestenliste.') + '</p>', [['ok', 'OK']], true);
  }
  function about() {
    dialog('Info über Kreuzworträtsel',
      '<div class="ms-about"><span class="ms-about-icon">📰</span><div><p><b>Tägliches Kreuzworträtsel</b></p>' +
      '<p>Jeden Tag frisch zusammengesetzt von ' + esc(SITE) + ' aus einer eigenen Liste deutscher Wörter.</p></div></div>', [['ok', 'OK']]);
  }

  init(JSON.parse(document.getElementById('cw-data').textContent));
  window.addEventListener('load', layout);
})();
