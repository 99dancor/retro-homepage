// Nintendo-DS-Spiele im Fenster (views/ds.ejs): startet das Spiel ohne Emulator-Oberfläche. Der Emulator ist der
// melonDS-Kern (libretro, als WebAssembly aus dem EmulatorJS-Projekt, GPL-3.0; im Image unter /static/ds-core/,
// siehe Dockerfile). Diese Datei ist der ganze Rahmen drumherum: ROM laden, Spielstand vom Server holen und
// zurückschreiben, Tastatur, Gamepad und Touch-Tasten. Die ROM liegt nur auf dem Server (src/ds.js) und wird nur an
// angemeldete Mitglieder ausgeliefert.
(function () {
  'use strict';
  var root = document.getElementById('ds');
  if (!root) return;
  var D = root.dataset;
  var canvas = document.getElementById('ds-canvas');
  var stage = root.querySelector('.ds-stage');
  var loadBox = document.getElementById('ds-load');
  var loadText = document.getElementById('ds-load-text');
  var loadBar = document.getElementById('ds-load-bar');
  var statusEl = document.getElementById('ds-status');

  // ---------- Tasten ----------
  // libretro-Nummern der DS-Tasten (RETRO_DEVICE_ID_JOYPAD_*)
  var PAD = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11 };
  var NAMES = { a: 'A', b: 'B', x: 'X', y: 'Y', l: 'L', r: 'R', start: 'Start', select: 'Select', up: '↑', down: '↓', left: '←', right: '→' };
  // Wie beim PC-Port von Animal Crossing: nach Lage der Tasten (KeyboardEvent.code), also auf jedem Layout gleich
  var DEFAULT_KEYS = { a: 'KeyX', b: 'KeyZ', x: 'KeyS', y: 'KeyA', l: 'KeyQ', r: 'KeyW', start: 'Enter', select: 'ShiftRight',
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  var KEY_STORE = 'ds-keys';
  function loadKeys() {
    var k = Object.assign({}, DEFAULT_KEYS);
    try { Object.assign(k, JSON.parse(localStorage.getItem(KEY_STORE) || '{}')); } catch (e) { /* ohne Speicher: Standard */ }
    return k;
  }
  var keys = loadKeys();
  function keyLabel(code) {
    if (!code) return '–';
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓')
      .replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ShiftRight', 'Umschalt rechts')
      .replace('ShiftLeft', 'Umschalt links').replace('Enter', 'Eingabe').replace('Space', 'Leertaste')
      .replace('Backspace', 'Rücktaste').replace('ControlLeft', 'Strg links').replace('ControlRight', 'Strg rechts');
  }

  var M = null;        // das Emscripten-Modul des Kerns
  var fn = {};         // seine Funktionen
  var running = false;
  var paused = false;
  var muted = false;
  // Mehrere Quellen (Tastatur, Gamepad, Touch-Tasten) drücken dieselbe DS-Taste: gezählt, damit Loslassen an einer
  // Stelle die Taste nicht für die andere löst
  var held = {};
  function press(name, src, on) {
    var id = PAD[name];
    if (id == null) return;
    var h = held[name] || (held[name] = {});
    var was = Object.keys(h).length > 0;
    if (on) h[src] = 1; else delete h[src];
    var now = Object.keys(h).length > 0;
    if (was !== now && running) fn.input(0, id, now ? 1 : 0);
    lastInput = Date.now();
  }
  function releaseAll() {
    Object.keys(held).forEach(function (n) { Object.keys(held[n]).forEach(function (s) { press(n, s, false); }); });
  }

  // ---------- Laden ----------
  function setLoad(text, frac) {
    loadText.textContent = text;
    if (frac == null) loadBar.removeAttribute('value'); else loadBar.value = Math.round(frac * 100);
  }
  function fail(msg) {
    loadBox.hidden = false;
    loadBox.classList.add('ds-failed');
    setLoad(msg, 0);
    status('');
  }
  function status(t) { if (statusEl) statusEl.textContent = t; }

  function fetchBytes(url, onProgress) {
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 404 ? 'Das Spiel wurde nicht gefunden.' : 'Laden fehlgeschlagen (' + res.status + ').');
      var total = +res.headers.get('content-length') || 0;
      if (!res.body || !total || !onProgress) return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      var reader = res.body.getReader(), parts = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(got), o = 0;
            parts.forEach(function (p) { out.set(p, o); o += p.length; });
            return out;
          }
          parts.push(r.value); got += r.value.length; onProgress(got / total);
          return pump();
        });
      }
      return pump();
    });
  }
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('Der Emulator fehlt auf dem Server.')); };
      document.head.appendChild(s);
    });
  }

  // ---------- Spielstand ----------
  // Der Server zählt die Fassungen (rev). Geschrieben wird nur auf die Fassung, die dieses Fenster geladen hat: Spielt
  // jemand gleichzeitig auf einem anderen Gerät, gewinnt nicht still das ältere Fenster.
  var save = { rev: 0, hash: '', busy: false, conflict: false, lastOk: 0 };
  function hashOf(bytes) {
    // FNV-1a über alle Bytes: nur um zu merken, ob sich etwas geändert hat
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) + ':' + bytes.length;
  }
  // Die Kerne schreiben den Spielstand selbst (melonDS: game.sav, DeSmuME: game.dsv), nicht über RetroArch: also im
  // Spielstand-Ordner nach game.* suchen
  var SAVE_DIR = '/data/saves';
  function saveFiles(dir) {
    var out = [];
    try {
      M.FS.readdir(dir).forEach(function (f) {
        if (f === '.' || f === '..') return;
        var q = dir + '/' + f, st = M.FS.stat(q);
        if (M.FS.isDir(st.mode)) out = out.concat(saveFiles(q));
        else if (/^game\.(sav|dsv|srm)$/.test(f) && st.size > 0) out.push({ path: q, size: st.size, mtime: +st.mtime });
      });
    } catch (e) { /* Ordner fehlt */ }
    return out;
  }
  function readSave() {
    try { fn.flushSave(); } catch (e) { /* noch kein Spielstand */ }
    var f = saveFiles(SAVE_DIR).sort(function (a, b) { return b.mtime - a.mtime || b.size - a.size; })[0];
    try { return f ? M.FS.readFile(f.path) : null; } catch (e) { return null; }
  }
  function syncSave(why) {
    if (!running || save.busy || save.conflict || !D.save) return Promise.resolve(false);
    var bytes = readSave();
    if (!bytes || !bytes.length) return Promise.resolve(false);
    var h = hashOf(bytes);
    if (h === save.hash) return Promise.resolve(false);
    save.busy = true;
    return fetch(D.save, {
      method: 'POST', credentials: 'same-origin', keepalive: why === 'close' && bytes.length < 60000,
      headers: { 'Content-Type': 'application/octet-stream', 'x-csrf-token': D.csrf, 'x-save-rev': String(save.rev) },
      body: bytes,
    }).then(function (res) {
      if (res.status === 409) {
        save.conflict = true;
        status('⚠ Spielstand wurde woanders geändert – hier wird nicht mehr gespeichert');
        showConflict();
        return false;
      }
      if (!res.ok) { status('⚠ Spielstand konnte nicht gesichert werden'); return false; }
      return res.json().then(function (j) {
        save.rev = j.rev; save.hash = h; save.lastOk = Date.now();
        status('Spielstand gesichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
        return true;
      });
    }).catch(function () { status('⚠ Keine Verbindung – Spielstand wird später gesichert'); return false; })
      .then(function (r) { save.busy = false; return r; });
  }
  // Der Kern schreibt den Spielstand erst 2 bis 3 Sekunden nach dem Speichern im Spiel in seine Datei. Wer kurz nach
  // einer Eingabe das Fenster schließt, hat vielleicht gerade gespeichert: dann bis zu 3,5 Sekunden darauf warten.
  var lastInput = 0;
  function closeSync() {
    var until = Date.now() + (Date.now() - lastInput < 8000 ? 3500 : 0);
    function again() {
      return syncSave('close').then(function (sent) {
        if (sent || Date.now() >= until || save.conflict) return sent;
        return new Promise(function (r) { setTimeout(r, 400); }).then(again);
      });
    }
    return again();
  }
  function showConflict() {
    var d = document.getElementById('ds-conflict');
    if (d && d.showModal && !d.open) d.showModal();
  }

  // ---------- Start ----------
  function coreOptions() {
    var o = {
      melonds_screen_layout: 'Top/Bottom',
      melonds_screen_gap: '0',
      melonds_touch_mode: 'Touch',
      melonds_boot_directly: 'enabled',
      melonds_use_fw_settings: 'disabled',
      melonds_language: D.lang || 'German',
      melonds_console_mode: 'DS',
      melonds_randomize_mac_address: 'disabled',
    };
    return Object.keys(o).map(function (k) { return k + ' = "' + o[k] + '"\n'; }).join('');
  }
  function retroarchCfg() {
    return [
      'savefile_directory = "/data/saves"',
      'sort_savefiles_enable = false',
      'sort_savefiles_by_content_enable = false',
      'screenshot_directory = "/"',
      'video_gpu_screenshot = false',
      'autosave_interval = 10',
      'block_sram_overwrite = false',
      'video_vsync = true',
      'video_smooth = false',
      'video_font_enable = false',
      'menu_enable_widgets = false',
      'audio_latency = 64',
      'pause_nonactive = false',
      'input_auto_game_focus = 0',
      'config_save_on_exit = false',
      'savestate_auto_save = false',
      'savestate_auto_load = false',
    ].join('\n') + '\n';
  }
  function mkdirs(path) {
    var cur = '';
    path.split('/').slice(1, -1).forEach(function (p) { cur += '/' + p; try { M.FS.mkdir(cur); } catch (e) { /* gibt es schon */ } });
  }
  function writeFile(path, data) { mkdirs(path); M.FS.writeFile(path, data); }

  function start() {
    if (typeof window.EJS_Runtime !== 'function') return Promise.reject(new Error('Der Emulator fehlt auf dem Server.'));
    var romP = fetchBytes(D.rom, function (f) { setLoad('Spiel wird geladen …', f); });
    var saveP = !D.save ? Promise.resolve(null) : fetch(D.save, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      if (res.status === 204) { save.rev = +res.headers.get('x-save-rev') || 0; return null; }
      if (!res.ok) throw new Error('Der Spielstand konnte nicht geladen werden (' + res.status + ').');
      save.rev = +res.headers.get('x-save-rev') || 0;
      return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    });
    var modP = window.EJS_Runtime({
      noInitialRun: true,
      canvas: canvas,
      parent: stage,
      arguments: [], preRun: [], postRun: [],
      print: D.debug ? console.log.bind(console) : function () {}, printErr: D.debug ? console.log.bind(console) : function () {},
      totalDependencies: 0,
      locateFile: function (f) { return f.endsWith('.wasm') ? D.wasm : f; },
      callbacks: { setupCoreSettingFile: function (p) { writeFile(p, coreOptions()); } },
      getSavExt: function () { return '.sav'; },
    });
    return Promise.all([romP, saveP, modP]).then(function (r) {
      var rom = r[0], sav = r[1];
      M = r[2];
      fn = {
        input: M.cwrap('simulate_input', 'null', ['number', 'number', 'number']),
        flushSave: M.cwrap('cmd_savefiles', '', []),
        loop: M.cwrap('toggleMainLoop', 'null', ['number']),
        keyboard: M.cwrap('ejs_set_keyboard_enabled', 'null', ['number']),
        options: M.cwrap('get_core_options', 'string', []),
      };
      setLoad('Spiel startet …', null);
      writeFile('/home/web_user/.config/retroarch/retroarch.cfg', retroarchCfg());
      writeFile('/game.nds', rom);
      mkdirs('/data/saves/x');
      if (sav) writeFile(SAVE_DIR + '/game.' + (D.saveExt || 'sav'), sav);
      if (sav) save.hash = hashOf(sav);
      M.callMain(D.debug ? ['-v', '/game.nds'] : ['/game.nds']);
      M.resumeMainLoop();
      try { fn.keyboard(0); } catch (e) { /* ältere Kerne */ }
      running = true;
      loadBox.hidden = true;
      root.classList.add('ds-running');
      status(sav ? 'Spielstand geladen' : (D.save ? 'Neues Spiel – der Spielstand wird automatisch gesichert' : ''));
      canvas.focus();
      setInterval(function () { syncSave('timer'); }, 10000);
      pollPads();
    });
  }

  // ---------- Tastatur ----------
  var byCode = {};
  function indexKeys() { byCode = {}; Object.keys(keys).forEach(function (n) { if (keys[n]) byCode[keys[n]] = n; }); }
  indexKeys();
  var binding = null; // Taste wird gerade neu belegt (Dialog)
  function onKey(e) {
    if (binding) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && e.target !== canvas) return;
    var n = byCode[e.code];
    if (!n) return;
    e.preventDefault();
    if (e.repeat) return;
    press(n, 'kb', e.type === 'keydown');
    resumeAudio();
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  window.addEventListener('blur', releaseAll);

  // Ton: Der Kern legt seinen AudioContext selbst an (OpenAL). Damit Stummschalten und Anhalten ihn erreichen, merkt sich
  // die Seite jeden, der entsteht. Browser starten Ton erst nach einer Eingabe: dann weiterlaufen lassen.
  var audioCtxs = [];
  (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var Wrapped = function (o) { var c = o === undefined ? new AC() : new AC(o); audioCtxs.push(c); return c; };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped;
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
  })();
  function audioOn(on) {
    audioCtxs.forEach(function (c) { try { if (on && c.state === 'suspended') c.resume(); else if (!on && c.state === 'running') c.suspend(); } catch (e) { /* egal */ } });
  }
  function resumeAudio() { if (!muted && !paused) audioOn(true); }
  root.addEventListener('pointerdown', function () { resumeAudio(); if (canvas !== document.activeElement) canvas.focus({ preventScroll: true }); });

  // ---------- Gamepad ----------
  // Nach Lage wie beim DS: rechts A, unten B, links Y, oben X (Standard-Belegung der Gamepad-API)
  var PAD_BTN = { 0: 'b', 1: 'a', 2: 'y', 3: 'x', 4: 'l', 5: 'r', 6: 'l', 7: 'r', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  function pollPads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var on = {};
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) continue;
      p.buttons.forEach(function (b, j) { if (PAD_BTN[j] && (b.pressed || b.value > 0.5)) on[PAD_BTN[j]] = 1; });
      var ax = p.axes || [];
      if (ax[0] < -0.5) on.left = 1; if (ax[0] > 0.5) on.right = 1;
      if (ax[1] < -0.5) on.up = 1; if (ax[1] > 0.5) on.down = 1;
    }
    Object.keys(PAD).forEach(function (n) {
      var was = !!(held[n] && held[n].pad);
      if (!!on[n] !== was) { press(n, 'pad', !!on[n]); if (on[n]) resumeAudio(); }
    });
    requestAnimationFrame(pollPads);
  }

  // ---------- Touch-Tasten (Handy/Tablet) ----------
  var touchPad = document.getElementById('ds-touchpad');
  if (touchPad) {
    var active = {}; // pointerId → Tastenname
    function btnAt(x, y) {
      var el = document.elementFromPoint(x, y);
      var b = el && el.closest && el.closest('[data-btn]');
      return b && touchPad.contains(b) ? b : null;
    }
    function setBtn(id, b) {
      var old = active[id];
      var name = b ? b.dataset.btn : null;
      if (old === name) return;
      if (old) { press(old, 't' + id, false); var ob = touchPad.querySelector('[data-btn="' + old + '"]'); if (ob) ob.classList.remove('on'); }
      if (name) { press(name, 't' + id, true); b.classList.add('on'); if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* egal */ } }
      if (name) active[id] = name; else delete active[id];
    }
    touchPad.addEventListener('pointerdown', function (e) {
      var b = btnAt(e.clientX, e.clientY);
      if (!b) return;
      e.preventDefault();
      resumeAudio();
      try { touchPad.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      setBtn(e.pointerId, b);
    });
    touchPad.addEventListener('pointermove', function (e) { if (active[e.pointerId] !== undefined) setBtn(e.pointerId, btnAt(e.clientX, e.clientY)); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) {
      touchPad.addEventListener(t, function (e) { setBtn(e.pointerId, null); });
    });
    touchPad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  var isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (isTouch) root.classList.add('ds-touch');

  // ---------- Menü ----------
  function toggleFullscreen() {
    var el = stage;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
  }
  function setPaused(p) {
    if (!running) return;
    paused = p;
    releaseAll();
    try { fn.loop(p ? 0 : 1); } catch (e) { /* egal */ }
    audioOn(!p && !muted);
    root.classList.toggle('ds-paused', p);
    status(p ? 'Angehalten' : '');
    if (p) syncSave('pause');
    if (!p) canvas.focus({ preventScroll: true });
  }
  function setMuted(m) {
    muted = m;
    audioOn(!m && !paused);
    var it = document.querySelector('[data-act="mute"]');
    if (it) it.classList.toggle('chk', m);
    status(m ? 'Ton aus' : 'Ton an');
  }
  var menuBar = root.querySelector('.ds-menu');
  var openMenu = null;
  function closeMenus() { if (openMenu) { openMenu.hidden = true; openMenu.previousElementSibling.classList.remove('open'); openMenu = null; } }
  if (menuBar) {
    menuBar.addEventListener('click', function (e) {
      var top = e.target.closest('.ds-mtop');
      if (top) {
        var m = top.nextElementSibling;
        var was = openMenu === m;
        closeMenus();
        if (!was) { m.hidden = false; top.classList.add('open'); openMenu = m; }
        return;
      }
      var it = e.target.closest('[data-act]');
      if (!it) return;
      closeMenus();
      act(it.dataset.act);
      canvas.focus({ preventScroll: true });
    });
    document.addEventListener('pointerdown', function (e) { if (openMenu && !menuBar.contains(e.target)) closeMenus(); });
  }
  function act(a) {
    if (a === 'pause') setPaused(!paused);
    else if (a === 'mute') setMuted(!muted);
    else if (a === 'full') toggleFullscreen();
    else if (a === 'save') {
      status('Spielstand wird gesichert …');
      syncSave('manual').then(function (r) { if (!r && !save.conflict) status(save.lastOk ? 'Spielstand ist aktuell' : 'Noch kein Spielstand im Spiel gespeichert'); });
    } else if (a === 'keys') openKeys();
    else if (a === 'help') { var d = document.getElementById('ds-help'); if (d) d.showModal(); }
  }

  // Tastenbelegung (nur in diesem Browser gespeichert)
  function openKeys() {
    var d = document.getElementById('ds-keys');
    if (!d) return;
    var list = d.querySelector('.ds-keylist');
    list.innerHTML = '';
    Object.keys(NAMES).forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'ds-keyrow';
      var l = document.createElement('span'); l.textContent = NAMES[n];
      var b = document.createElement('button'); b.type = 'button'; b.textContent = keyLabel(keys[n]); b.dataset.k = n;
      row.appendChild(l); row.appendChild(b); list.appendChild(row);
    });
    if (!d.open) d.showModal();
  }
  var keysDlg = document.getElementById('ds-keys');
  if (keysDlg) {
    keysDlg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-k]');
      if (b) {
        if (binding) binding.btn.textContent = keyLabel(keys[binding.name]);
        binding = { name: b.dataset.k, btn: b };
        b.textContent = 'Taste drücken …';
        return;
      }
      if (e.target.closest('[data-reset]')) {
        keys = Object.assign({}, DEFAULT_KEYS);
        try { localStorage.removeItem(KEY_STORE); } catch (x) { /* egal */ }
        indexKeys(); binding = null; openKeys();
      }
    });
    keysDlg.addEventListener('keydown', function (e) {
      if (!binding) return;
      e.preventDefault(); e.stopPropagation();
      if (e.code !== 'Escape') {
        // dieselbe Taste nicht zweimal belegen
        Object.keys(keys).forEach(function (n) { if (keys[n] === e.code) keys[n] = ''; });
        keys[binding.name] = e.code;
        try { localStorage.setItem(KEY_STORE, JSON.stringify(keys)); } catch (x) { /* nur für diese Sitzung */ }
        indexKeys();
      }
      binding = null;
      openKeys();
    }, true);
    keysDlg.addEventListener('close', function () { binding = null; releaseAll(); canvas.focus({ preventScroll: true }); });
  }

  // Fenster schließen oder Seite verlassen: vorher noch sichern. Der Desktop fragt per Nachricht (retro.js)
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') syncSave('hidden'); });
  window.addEventListener('pagehide', function () { syncSave('close'); });
  canvas.addEventListener('pointerdown', function () { lastInput = Date.now(); });
  // Der Desktop wartet beim Schließen des Fensters kurz, bis der letzte Stand gesichert ist (RetroDesk.onClose in retro.js)
  try {
    if (window.parent !== window && window.parent.RetroDesk && window.parent.RetroDesk.onClose) {
      window.parent.RetroDesk.onClose(function (win) { if (win === window) return closeSync(); });
    }
  } catch (e) { /* nicht im Desktop */ }
  // Schließen-Kreuze der Dialoge (ohne Inline-Skript, die Seite erlaubt keins)
  document.querySelectorAll('dialog [data-close]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });
  // Kurztasten wie im Menü angeschrieben, solange sie keine Spieltaste sind
  document.addEventListener('keydown', function (e) {
    if (binding || byCode[e.code] || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector('dialog[open]')) return;
    var a = { F1: 'help', KeyM: 'mute', Pause: 'pause', KeyP: 'pause' }[e.code];
    if (!a) return;
    e.preventDefault();
    act(a);
  });
  window.DSPlayer = { sync: syncSave, press: press, state: function () { return { running: running, rev: save.rev, hash: save.hash, conflict: save.conflict }; },
    options: function () { try { return fn.options(); } catch (e) { return ''; } }, readSave: readSave,
    frames: function () { try { return M.cwrap('get_current_frame_count', 'number', [])(); } catch (e) { return -1; } } };

  setLoad('Spiel wird geladen …', 0);
  loadScript(D.core).then(start).catch(function (e) { fail(e && e.message ? e.message : 'Das Spiel konnte nicht gestartet werden.'); });
})();
