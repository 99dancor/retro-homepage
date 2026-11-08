// Mediaplayer (Startmenü → 🎵 Mediaplayer): Musik, Videos und YouTube-Links, Playlists, Hochladen, Visualisierungen und
// Lobbys zum gemeinsamen Hören. Aufbau wie beim Media Player 9: links die Aufgabenleiste, in der Mitte das Bild (Video oder
// Visualisierung), rechts die Wiedergabeliste. Die Daten kommen als JSON von /musik/…, Schreiben geht per POST mit dem
// Formular-Token im Kopf x-csrf-token. Lautstärke und Stummschaltung teilt sich der Player mit dem 🔊-Regler neben der Uhr
// (public/sound.js).
(function () {
  'use strict';
  var root = document.getElementById('mp');
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, CAN_LOBBY = !!root.dataset.lobby, CAN_YT = !!root.dataset.youtube;
  var media = $('mp-media'), side = $('mp-side'), list = $('mp-list'), head = $('mp-head'), stage = $('mp-stage');
  var qhead = $('mp-qhead'), qlist = $('mp-qlist'), qtools = $('mp-qtools');
  var nowEl = $('mp-now'), overlay = $('mp-overlay'), ytBox = $('mp-yt'), statusEl = $('mp-status'), modeEl = $('mp-mode');
  var seek = $('mp-seek'), volEl = $('mp-vol'), timeEl = $('mp-time'), durEl = $('mp-dur'), visSelect = $('mp-vis-select');
  var lcdTitle = $('mp-lcd-title'), lcdTime = $('mp-lcd-time');
  var btn = function (act) { return root.querySelector('[data-act=' + act + ']'); };
  var Sound = window.RetroSound || { musik: function () { return 0.8; }, get: function () { return { musik: 0.8 }; }, set: function () {}, onChange: function () {} };

  var lib = { tracks: [], playlists: [], radio: [], me: null, canUpload: false, quota: null }, byId = {};
  var view = 'all', filter = '';
  var PREF_KEY = 'musik-player';
  var prefs = { vis: 'balken', shuffle: false, repeat: 'aus', picture: 'video' };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (e) { /* Standard */ }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* privat */ } }

  // ---------- Aussehen (Skins) ----------
  // Ein Skin ist nur CSS (public/music.css, .mp[data-skin=…]). Mitglieder haben ihre Wahl am Konto (POST /musik/einstellungen,
  // src/usersettings.js → player), Gäste im Browser. Ohne eigene Wahl gilt die Vorgabe der Seite (Seitenverwaltung).
  var SKINS = [
    { id: 'klassisch', name: 'Klassisch', sub: 'wie der Desktop (98 oder XP)' },
    { id: 'vlc-hell', name: 'VLC hell', sub: 'schlicht, orange Akzente' },
    { id: 'vlc-dunkel', name: 'VLC dunkel', sub: 'wie VLC hell, nur dunkel' },
    { id: 'mediaplayer', name: 'Media Player', sub: 'schwarzes Glas, Reiter oben' },
    { id: 'winamp', name: 'Winamp', sub: 'grüne Anzeige, Fenster gestapelt' }
  ];
  var MEMBER = !!root.dataset.player, SKIN_DEFAULT = root.dataset.skinDefault || 'klassisch';
  var player = { skin: null, side: {}, shut: [], eq: { on: false, g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
  try { Object.assign(player, MEMBER ? JSON.parse(root.dataset.player) : prefs.player || {}); } catch (e) { /* Vorgaben */ }
  function skinOk(id) { return SKINS.some(function (k) { return k.id === id; }); }
  function skin() { return skinOk(player.skin) ? player.skin : skinOk(SKIN_DEFAULT) ? SKIN_DEFAULT : 'klassisch'; }
  function sideMode() { return player.side[skin()] || 'open'; }
  var playerTimer = null;
  function savePlayer() {
    prefs.player = player; savePrefs();
    if (!MEMBER) return;
    clearTimeout(playerTimer);
    playerTimer = setTimeout(function () { post('/musik/einstellungen', player).catch(function () { /* bleibt im Browser */ }); }, 600);
  }

  // ---------- Kleinkram ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function status(text) { statusEl.textContent = text; }
  function req(method, url, body) {
    var opts = { method: method, headers: { 'x-csrf-token': CSRF, accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
        return j;
      });
    });
  }
  var post = function (url, body) { return req('POST', url, body || {}); };
  function oops(e) { status('⚠ ' + e.message); }
  var VIS_LABEL = { public: 'Öffentlich', members: 'Nur angemeldete Nutzer', friends: 'Nur meine Freunde', private: 'Nur ich (und der Admin)', groups: 'Bestimmte Gruppen (vom Admin)' };
  function visOptions(cur, withGroups) {
    var keys = ['public', 'members', 'friends', 'private'];
    if (withGroups || cur === 'groups') keys.push('groups');
    return keys.map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + VIS_LABEL[k] + '</option>'; }).join('');
  }
  // Art eines Eintrags: Titel aus der Bibliothek (kind), Lobby-Eintrag (type) oder YouTube-Video ohne Konto
  function isYt(it) { return !!it && (it.type === 'yt' || it.kind === 'youtube'); }
  function isVideo(it) { return !!it && (it.kind === 'video' || it.video === true); }
  function isRadio(it) { return !!it && it.radio === true; }
  function kindBadge(it) {
    return isJf(it) ? '<small class="mp-kind video">Jellyfin</small>' : isRadio(it) ? '<small class="mp-kind radio">Radio</small>' : isYt(it) ? '<small class="mp-kind yt">YouTube</small>' : isVideo(it) ? '<small class="mp-kind video">Video</small>' : '<small class="mp-kind">Audio</small>';
  }
  function kindIcon(it) { return isRadio(it) ? '📻' : isYt(it) ? '▶️' : isVideo(it) ? '🎬' : '🎵'; }
  function fmtSize(n) { return n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }

  // ---------- Dialog ----------
  var dlg = $('mp-dlg');
  function dialog(title, html, buttons) {
    $('mp-dlg-title').textContent = title;
    $('mp-dlg-body').innerHTML = html;
    var acts = $('mp-dlg-actions');
    acts.innerHTML = '';
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.value = b.value; el.textContent = b.label;
      if (b.danger) el.className = 'danger';
      acts.appendChild(el);
    });
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function () { resolve(dlg.returnValue || 'cancel'); }, { once: true });
      dlg.returnValue = '';
      dlg.showModal();
      var first = dlg.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea');
      if (first) first.focus();
    });
  }
  // Profile öffnen sich als eigenes Fenster auf dem Desktop: retro.js fängt Klicks auf Links ab
  function profileUrl(name) { return '/nutzer/' + encodeURIComponent(name); }
  function userLink(name, user) { return user ? '<a href="' + profileUrl(user) + '">' + esc(name || user) + '</a>' : esc(name || ''); }
  function openPage(url) { var a = document.createElement('a'); a.href = url; document.body.appendChild(a); a.click(); a.remove(); }
  function field(name) { var el = dlg.querySelector('[name=' + name + ']'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; }
  function confirmBox(title, text, yes) {
    return dialog(title, '<p>' + text + '</p>', [{ label: yes, value: 'ok', danger: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) { return r === 'ok'; });
  }

  // ---------- Ton: Web Audio für Visualisierung und Lautstärke ----------
  // Musik und Videos laufen über dasselbe <video>-Element; bei Musik bleibt es unsichtbar
  var actx = null, gain = null, analyser = null, freq, wave, eqNodes = [];
  var EQ_FREQ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  function applyEq() {
    eqNodes.forEach(function (b, i) { b.gain.value = player.eq.on ? player.eq.g[i] || 0 : 0; });
  }
  function graph() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      var src = actx.createMediaElementSource(media);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
      gain = actx.createGain();
      // Equalizer vor der Messung, damit die Visualisierung zeigt, was man hört
      eqNodes = EQ_FREQ.map(function (f, i) {
        var b = actx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_FREQ.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1;
        return b;
      });
      var last = src;
      eqNodes.forEach(function (b) { last.connect(b); last = b; });
      last.connect(analyser); analyser.connect(gain); gain.connect(actx.destination);
      applyEq();
      freq = new Uint8Array(analyser.frequencyBinCount); wave = new Uint8Array(analyser.fftSize);
      media.volume = 1;
    } catch (e) { actx = null; gain = null; analyser = null; }
    applyVolume();
  }
  function applyVolume() {
    var v = Sound.musik();
    if (gain) gain.gain.value = v; else media.volume = v;
    if (yt.ready) { ytCmd('setVolume', [Math.round(v * 100)]); ytCmd(v ? 'unMute' : 'mute'); }
    var pct = Math.round(Sound.get().musik * 100);
    volEl.value = pct; waVol.value = pct;
    volEl.style.setProperty('--v', pct + '%');
    $('mp-volpct').textContent = pct + ' %';
  }
  var waVol = $('mp-wa-vol');
  Sound.onChange(applyVolume);
  volEl.addEventListener('input', function () { Sound.set({ musik: volEl.value / 100, stumm: false }); });
  waVol.addEventListener('input', function () { Sound.set({ musik: waVol.value / 100, stumm: false }); });

  // ---------- Bild: Video, Visualisierung oder YouTube ----------
  var vis = window.RetroVis ? window.RetroVis.create($('mp-canvas')) : null;
  // kleines Spektrum in der Winamp-Anzeige
  var waVis = window.RetroVis ? window.RetroVis.create($('mp-wa-spec')) : null;
  if (waVis) waVis.setMode('balken');
  var VIS_LIST = window.RetroVis ? window.RetroVis.list : [];
  if (vis) {
    VIS_LIST.forEach(function (m) { visSelect.add(new Option(m.name, m.id)); });
    if (!VIS_LIST.some(function (m) { return m.id === prefs.vis; })) prefs.vis = 'balken';
    visSelect.value = prefs.vis;
    vis.setMode(prefs.vis);
    visSelect.addEventListener('change', function () { setVis(visSelect.value); });
  } else visSelect.hidden = true;
  function setVis(id) {
    prefs.vis = id; visSelect.value = id;
    if (vis) vis.setMode(id);
    if (isVideo(playingItem())) prefs.picture = 'vis';
    savePrefs(); applyPicture(); kick();
  }
  function playingItem() { return lob ? currentLobbyItem() : current; }
  var showsVideo = false;
  function applyPicture() {
    var it = playingItem(), y = isYt(it), v = isVideo(it);
    showsVideo = v && prefs.picture !== 'vis';
    stage.dataset.kind = y ? 'yt' : showsVideo ? 'video' : 'vis';
    var bv = btn('pic-video'), bz = btn('pic-vis');
    bv.disabled = !(v || y); bz.disabled = y;
    bv.setAttribute('aria-pressed', String(y || showsVideo)); bv.classList.toggle('pressed', y || showsVideo);
    bz.setAttribute('aria-pressed', String(!y && !showsVideo)); bz.classList.toggle('pressed', !y && !showsVideo);
    bz.title = y ? 'Bei YouTube-Videos gibt es keine Visualisierung' : 'Visualisierung statt Bild zeigen';
  }
  var looping = false, idle = 0;
  function frame(t) {
    var it = playingItem();
    var active = analyser && !media.paused && it && !isYt(it) && !showsVideo;
    if (vis) {
      if (active) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); vis.draw(freq, wave, t / 1000); idle = 0; }
      else { vis.dim(); idle++; }
    }
    if (waVis && skin() === 'winamp' && !root.classList.contains('phone')) {
      if (analyser && !media.paused && it && !isYt(it)) { if (!active) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); } waVis.draw(freq, wave, t / 1000); idle = 0; }
      else waVis.dim();
    }
    showTime();
    if (idle < 90) requestAnimationFrame(frame); else looping = false;
  }
  function kick() { idle = 0; if (!looping) { looping = true; requestAnimationFrame(frame); } }

  // ---------- Theater, Vollbild und Mini-Player ----------
  var idleTimer = null, fsTheater = false;
  function setTheater(on) {
    root.classList.toggle('theater', on);
    layout();
    var b = btn('theater');
    b.setAttribute('aria-pressed', String(on)); b.classList.toggle('pressed', on);
    if (on) setMini(false);
    wake();
  }
  // Im Theater blenden sich Steuerung und Knöpfe aus, wenn die Maus eine Weile still steht
  function wake() {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    if (root.classList.contains('theater')) idleTimer = setTimeout(function () { if (isPlaying()) root.classList.add('idle'); }, 2500);
  }
  root.addEventListener('pointermove', wake);
  root.addEventListener('pointerdown', wake);
  function fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    // Der ganze Player geht ins Vollbild, im Theater-Aufbau mit der Steuerung unten
    if (root.requestFullscreen) {
      root.requestFullscreen().then(function () {
        if (!root.classList.contains('theater')) { fsTheater = true; setTheater(true); }
      }).catch(function () { status('Vollbild geht hier nicht.'); });
    } else if (showsVideo && media.webkitEnterFullscreen) media.webkitEnterFullscreen(); // iPhone kann nur Videos ins Vollbild holen
    else setTheater(!root.classList.contains('theater'));
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && fsTheater) { fsTheater = false; setTheater(false); }
  });
  // Mini-Player: Das Desktop-Fenster (public/retro.js) schrumpft auf eine Leiste und merkt sich die Größe davor
  function desk() { try { return window.parent !== window && window.parent.RetroDesk && window.parent.RetroDesk.mini ? window.parent.RetroDesk : null; } catch (e) { return null; } }
  if (!desk()) root.classList.add('no-mini');
  function setMini(on) {
    if (on === root.classList.contains('mini')) return;
    var d = desk();
    if (on) {
      if (document.fullscreenElement) document.exitFullscreen();
      if (root.classList.contains('theater')) setTheater(false);
      root.classList.add('mini'); document.body.classList.add('mp-mini');
      layout();
      if (!d || !d.mini(window, true, 540, root.offsetHeight + (skin() === 'klassisch' ? 8 : 0))) {
        root.classList.remove('mini'); document.body.classList.remove('mp-mini');
        layout();
        status('Den Mini-Player gibt es nur auf dem großen Bildschirm.');
        return;
      }
    } else {
      root.classList.remove('mini'); document.body.classList.remove('mp-mini');
      layout();
      if (d) d.mini(window, false);
    }
    showTime();
  }
  // Wird das kleine Fenster aufgezogen oder maximiert, geht es von selbst zurück in den großen Aufbau
  window.addEventListener('resize', function () { if (root.classList.contains('mini') && window.innerHeight > 220) setMini(false); });

  // ---------- Ziehleisten: Aufgabenleiste, Wiedergabeliste, Höhe des Bilds ----------

  // Schmales Fenster (Handy): Reiter statt Seitenleisten, aber nicht im Mini-Player und nicht im Theater
  var narrow = window.matchMedia('(max-width: 640px)');
  function layout() {
    root.classList.toggle('phone', narrow.matches && !root.classList.contains('mini') && !root.classList.contains('theater'));
    if (!isPhone()) root.classList.remove('drawer');
    root.dataset.skin = skin();
    showSkin(skin());
    var sm = sideMode();
    ['open', 'rail', 'closed'].forEach(function (m) { root.classList.toggle('side-' + m, sm === m); });
    root.classList.toggle('big', /^vlc/.test(skin()) && !!prefs.big);
  }
  function isPhone() { return root.classList.contains('phone'); }
  // Das Symbol des Mediaplayers (retro.css .sym-player) folgt dem Skin: hier, auf dem Desktop und in allen offenen Fenstern
  function showSkin(s) {
    var docs = [document];
    try {
      if (window.parent !== window && window.parent.document) {
        docs.push(window.parent.document);
        window.parent.document.querySelectorAll('iframe').forEach(function (f) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) { /* fremd */ } });
      }
    } catch (e) { /* fremd */ }
    docs.forEach(function (d) { if (d.documentElement.getAttribute('data-mp-skin') !== s) d.documentElement.setAttribute('data-mp-skin', s); });
  }
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  function applySizes() {
    root.style.setProperty('--mp-side', prefs.sideW ? prefs.sideW + 'px' : '');
    root.style.setProperty('--mp-queue', prefs.queueW ? prefs.queueW + 'px' : '');
    root.style.setProperty('--mp-stage', prefs.stageH ? prefs.stageH + 'px' : '');
  }
  function sizeFrom(which, x, y) {
    // .mp-main und .mp-center haben keine eigene Box (display: contents): gemessen wird am Player und am Bild
    var m = root.getBoundingClientRect(), c = stage.getBoundingClientRect(), ctl = root.querySelector('.mp-controls').getBoundingClientRect();
    if (which === 'stage') prefs.stageH = Math.round(clamp(y - c.top, 80, ctl.top - c.top - 120));
    else if (which === 'queue') prefs.queueW = Math.round(clamp(m.right - x, 160, m.width * 0.5));
    else prefs.sideW = Math.round(clamp(x - m.left, 110, m.width * 0.4));
    applySizes();
  }
  var SIZE_KEY = { side: 'sideW', queue: 'queueW', stage: 'stageH' };
  root.querySelectorAll('.mp-split').forEach(function (bar) {
    var which = bar.dataset.split;
    bar.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('dragging'); document.body.classList.add('mp-dragging');
      document.body.style.cursor = getComputedStyle(bar).cursor;
    });
    bar.addEventListener('pointermove', function (e) { if (bar.hasPointerCapture(e.pointerId)) sizeFrom(which, e.clientX, e.clientY); });
    function end() {
      if (!bar.classList.contains('dragging')) return;
      bar.classList.remove('dragging'); document.body.classList.remove('mp-dragging'); document.body.style.cursor = '';
      savePrefs();
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', function () { delete prefs[SIZE_KEY[which]]; applySizes(); savePrefs(); });
    // Mit Pfeiltasten geht es auch ohne Maus
    bar.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: -20, ArrowUp: -20, ArrowRight: 20, ArrowDown: 20 }[e.key];
      if (!d) return;
      e.preventDefault();
      var r = bar.getBoundingClientRect();
      sizeFrom(which, r.left + r.width / 2 + d, r.top + r.height / 2 + d);
      savePrefs();
    });
  });
  applySizes();

  // Klick ins Bild oder Video: Wiedergabe/Pause (wie im Media Player), Doppelklick: Vollbild.
  // Der Klick wartet kurz, damit ein Doppelklick nicht zweimal umschaltet.
  var clickTimer = null;
  stage.addEventListener('click', function (e) {
    if (e.target.closest('button, input, select, label, a')) return;
    if (root.classList.contains('mini')) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(playPause, 250);
  });
  stage.addEventListener('dblclick', function (e) {
    if (e.target.closest('button, input, select, label, a') || root.classList.contains('mini')) return;
    clearTimeout(clickTimer); fullscreen();
  });

  // ---------- Bibliothek ----------
  function load() {
    return req('GET', '/musik/bibliothek').then(function (j) {
      lib = j; byId = {}; lib.radio = lib.radio || [];
      lib.tracks.forEach(function (t) { byId[t.id] = t; });
      if (/^pl:/.test(view) && !playlist(view)) view = 'all';
      render();
    }).catch(oops);
  }
  function playlist(key) { var id = Number(String(key).slice(3)); return lib.playlists.filter(function (p) { return p.id === id; })[0] || null; }
  // Ansichten: all (alles), sammlung, mitglieder, meine, pl:<id>; dazu now (Wiedergabe läuft) und lobbys.
  // Musik, Videos und YouTube sind keine eigenen Ansichten mehr, sondern ein Filter über jeder Liste (kindF).
  var kindF = '';
  // Bereich „Privat“ (nur für freigeschaltete Konten): eigene Ansicht, in den anderen Listen nicht dabei
  function viewTracks(key) {
    var all = lib.tracks.filter(function (t) { return key === 'privat' ? t.privat : !t.privat; });
    if (key === 'privat') return all;
    if (key === 'sammlung') return all.filter(function (t) { return t.byAdmin; });
    if (key === 'mitglieder') return all.filter(function (t) { return !t.byAdmin; });
    if (key === 'meine') return all.filter(function (t) { return t.mine; });
    if (/^pl:/.test(key)) { var p = playlist(key); return p ? p.tracks.map(function (id) { return byId[id]; }).filter(Boolean) : []; }
    return all;
  }
  function isLibView(key) { return !/^(now|lobbys|radio)$/.test(key) && !isJfView(key); }
  function filtered(tracks) {
    if (kindF) tracks = tracks.filter(function (t) { return (t.kind || 'audio') === kindF; });
    if (!filter) return tracks;
    var f = filter.toLowerCase();
    return tracks.filter(function (t) { return (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.by || '')).toLowerCase().indexOf(f) >= 0; });
  }
  // Media Player zeigt die Bibliothek nach Alben gruppiert (Playlists behalten ihre Reihenfolge)
  function grouped() { return skin() === 'mediaplayer' && !/^pl:/.test(view); }
  function albumOf(t) { return t.kind === 'youtube' ? 'YouTube' : t.album || (t.kind === 'video' ? 'Videos' : 'Ohne Album'); }
  function listTracks() {
    var tracks = filtered(viewTracks(view));
    if (!grouped()) return tracks;
    return tracks.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) {
      var x = albumOf(a.t).localeCompare(albumOf(b.t), 'de');
      return x || a.i - b.i;
    }).map(function (x) { return x.t; });
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }

  // ---------- Seitenleiste ----------
  // Gruppen Bibliothek, Playlists und Lobbys, einzeln zuklappbar; drei Breiten: offen, schmal (nur Symbole) und zu.
  // Auf dem Handy liegt sie als Schublade hinter ☰.
  var VIEW_NAME = { all: 'Alles', sammlung: 'Sammlung', mitglieder: 'Von Mitgliedern hochgeladen', meine: 'Meine Titel', privat: 'Privat', radio: 'Radio' };
  function navBtn(o) {
    return '<button type="button" class="mp-nav' + (o.cls ? ' ' + o.cls : '') + (o.on ? ' active' : '') + '"' + (o.go ? ' data-go="' + esc(o.go) + '"' : '') +
      (o.act ? ' data-act="' + o.act + '"' : '') + (o.lobby ? ' data-lobby="' + esc(o.lobby) + '"' : '') + (o.radio ? ' data-radio="' + o.radio + '"' : '') + (o.drop ? ' data-drop="' + esc(o.drop) + '"' : '') +
      ' title="' + esc(o.title || o.label) + '">' + (o.live ? '<span class="mp-live"></span>' : '<span class="ic">' + o.ic + '</span>') + '<span class="t">' + esc(o.label) +
      (o.who ? ' <span class="who">' + esc(o.who) + '</span>' : '') + '</span>' + (o.n !== undefined ? '<small class="n">' + o.n + '</small>' : '') + '</button>';
  }
  function groups() {
    var me = lib.me, out = [];
    var libItems = [{ ic: '📚', label: 'Alles', go: 'all', n: viewTracks('all').length }, { ic: '💿', label: 'Sammlung', go: 'sammlung', n: viewTracks('sammlung').length },
      { ic: '👥', label: 'Von Mitgliedern', go: 'mitglieder', n: viewTracks('mitglieder').length }];
    if (me) libItems.push({ ic: '⭐', label: 'Meine Titel', go: 'meine', n: viewTracks('meine').length });
    if (lib.tracks.some(function (t) { return t.privat; })) libItems.push({ ic: '🔞', label: 'Privat', go: 'privat', n: viewTracks('privat').length });
    libItems.forEach(function (o) { o.on = view === o.go; });
    out.push({ id: 'lib', ic: '📚', label: 'Bibliothek', items: libItems });
    var jg = jfGroup();
    if (jg) out.push(jg);
    // Internetradio: Sender aus der Bibliothek, eintragen darf, wer hochladen darf
    if (lib.radio.length || lib.canUpload) {
      out.push({ id: 'radio', ic: '📻', label: 'Radio', add: lib.canUpload ? 'radio-add' : '', addTitle: 'Sender hinzufügen', badge: lib.radio.length,
        items: [{ ic: '📻', label: 'Alle Sender', go: 'radio', n: lib.radio.length, on: view === 'radio' }].concat(lib.radio.slice(0, 12).map(function (s) {
          return { ic: '▸', label: s.name, act: 'radio-play', radio: s.id, on: !!current && current.sid === s.id, cls: 'mp-sub1', title: s.name + ' abspielen' };
        })) });
    }
    if (me) {
      var mine = lib.playlists.filter(function (p) { return p.mine; }), other = lib.playlists.filter(function (p) { return !p.mine; });
      out.push({ id: 'pl', ic: '📃', label: 'Playlists', add: 'new-playlist', addTitle: 'Neue Playlist', badge: lib.playlists.length,
        items: mine.map(function (p) { return { ic: '📃', label: p.title, go: 'pl:' + p.id, n: p.tracks.length, on: view === 'pl:' + p.id, drop: 'pl:' + p.id }; }),
        empty: mine.length ? '' : 'Noch keine eigene Playlist.',
        sub: other.length ? 'Von anderen' : '', subItems: other.map(function (p) { return { ic: '📃', label: p.title, who: 'von ' + p.owner, go: 'pl:' + p.id, n: p.tracks.length, on: view === 'pl:' + p.id }; }) });
    }
    if (CAN_LOBBY && me) {
      var li = lobbies.map(function (l) {
        var here = lob && lob.id === l.id;
        return { ic: '🎧', live: here, label: l.name, who: l.host, n: '👥 ' + l.listeners, lobby: l.id, drop: here ? 'lobby' : '', title: l.name + ' – ' + (l.now ? '▶ ' + l.now : 'Pause') + (here ? ' (du bist drin)' : '') };
      });
      if (lob && lob.state && !lobbies.some(function (l) { return l.id === lob.id; })) li.unshift({ live: true, label: lob.state.name, n: '👥 ' + lob.state.listeners.length, lobby: lob.id, drop: 'lobby' });
      li.push({ ic: '📋', label: 'Alle Lobbys', go: 'lobbys', on: view === 'lobbys' });
      out.push({ id: 'lob', ic: '🎧', label: 'Lobbys', add: 'lobby-new', addTitle: 'Lobby öffnen', badge: lobbies.length, live: !!lob, items: li });
    }
    return out;
  }
  function renderSide() {
    var me = lib.me, mode = isPhone() ? 'open' : sideMode(), h = '', nowOn = view === 'now';
    side.classList.toggle('rail', mode === 'rail');
    if (mode === 'rail') {
      h += '<button type="button" class="mp-rb mp-sb-tg" data-act="side-open" title="Seitenleiste aufklappen">»</button>';
      h += '<button type="button" class="mp-rb' + (nowOn ? ' active' : '') + '" data-go="now" data-drop="queue" title="Wiedergabe läuft">▶' + (lob ? '<span class="mp-live"></span>' : '') + '</button>';
      groups().forEach(function (g) {
        var on = g.items.some(function (o) { return o.on; });
        h += '<div class="mp-rb' + (on ? ' active' : '') + '" tabindex="0" aria-label="' + g.label + '">' + g.ic + (g.live ? '<span class="mp-live"></span>' : g.badge ? '<span class="badge">' + g.badge + '</span>' : '') +
          '<div class="mp-fly"><div class="mp-fly-in"><div class="mp-fly-h">' + g.label + (g.add ? '<button type="button" class="mp-grp-add" data-act="' + g.add + '" title="' + g.addTitle + '">＋</button>' : '') + '</div>' +
          '<div class="mp-grp-body">' + g.items.map(navBtn).join('') + (g.subItems && g.subItems.length ? '<div class="mp-grp-sub">' + g.sub + '</div>' + g.subItems.map(navBtn).join('') : '') + '</div></div></div></div>';
      });
      h += '<div class="mp-rail-foot">' + (lib.canUpload ? '<button type="button" class="mp-rb" data-act="upload" title="Hochladen">📤</button>' : '') +
        '<button type="button" class="mp-rb" data-act="skin-pop" title="Aussehen">🎨</button></div>';
      side.innerHTML = h;
      return;
    }
    h += '<div class="mp-sb-top"><span>Navigation</span>' + (isPhone() ? '' : '<button type="button" class="mp-sb-tg" data-act="side-rail" title="Seitenleiste verkleinern">«</button>') + '</div>';
    h += navBtn({ ic: '▶', label: 'Wiedergabe läuft', go: 'now', on: nowOn, cls: 'strong', drop: 'queue' });
    if (lob && lob.state) h += navBtn({ live: true, label: lob.state.name, go: 'now', n: '👥 ' + lob.state.listeners.length, cls: 'mp-sub1', drop: 'lobby', title: 'Deine Lobby' });
    groups().forEach(function (g) {
      var shut = player.shut.indexOf(g.id) >= 0;
      h += '<div class="mp-grp' + (shut ? ' shut' : '') + '"><div class="mp-grp-head"><button type="button" class="mp-grp-tg" data-act="grp" data-grp="' + g.id + '" aria-expanded="' + !shut + '">' +
        (shut ? '▸ ' : '▾ ') + g.label + '</button>' + (g.add ? '<button type="button" class="mp-grp-add" data-act="' + g.add + '" title="' + g.addTitle + '">＋</button>' : '') + '</div>' +
        '<div class="mp-grp-body">' + g.items.map(navBtn).join('') + (g.empty ? '<p class="mp-hint">' + g.empty + '</p>' : '') +
        (g.subItems && g.subItems.length ? '<div class="mp-grp-sub">' + g.sub + '</div>' + g.subItems.map(navBtn).join('') : '') + '</div></div>';
    });
    if (!me) h += '<p class="mp-hint"><a href="/login?next=/musik">Melde dich an</a>, um Playlists anzulegen, Musik und Videos hochzuladen und mit anderen gemeinsam zu hören.</p>';
    var cur = SKINS.filter(function (k) { return k.id === skin(); })[0];
    h += '<div class="mp-sb-foot">' + (lib.canUpload ? '<button type="button" class="small" data-act="upload">📤 Hochladen</button>' : '') +
      (lib.quota ? '<div class="mp-quota"><span>Speicher: ' + fmtSize(lib.quota.used) + ' von ' + fmtSize(lib.quota.total) + '</span><div class="bar"><i style="width:' +
        Math.min(100, Math.round(lib.quota.used / Math.max(1, lib.quota.total) * 100)) + '%"></i></div></div>' : '') +
      navBtn({ ic: '🎨', label: 'Aussehen: ' + cur.name, act: 'skin-pop', n: '▾', title: 'Aussehen des Players wählen' }) + '</div>';
    side.innerHTML = h;
  }
  function show(key) {
    if (key === 'lobbys' && !lib.me) key = 'all';
    if (key === 'now' && isPhone() && !lob) key = 'all';
    // Privat ist vor allem Videos: dort startet die Ansicht mit dem Filter Videos und zeigt Kacheln
    if (key === 'privat' && view !== 'privat' && viewTracks('privat').some(isVideo)) kindF = 'video';
    else if (view === 'privat' && key !== 'privat' && kindF === 'video') kindF = '';
    if (key !== view) JF.det = null;
    view = key; filter = '';
    if (key !== 'now' && skin().indexOf('vlc') === 0 && prefs.big) { prefs.big = false; savePrefs(); }
    root.classList.remove('drawer');
    layout();
    if (isPhone()) tab = key === 'now' ? (lob ? 'lobby' : 'queue') : key === 'lobbys' ? 'lobby' : 'lib';
    render();
    if (key === 'lobbys') loadLobbies();
    if (isJfView(key)) jfEnter(key);
  }
  function render() {
    layout();
    root.dataset.view = view;
    jfBrowse();
    renderTabs(); renderSide(); renderTop(); renderHead(); renderList(); renderQueue(); renderLobbyBar(); applyPicture(); updateButtons(); nowWa();
  }

  function totalTime(tracks) { return tracks.reduce(function (n, t) { return n + (t.duration || 0); }, 0); }
  // Media Player: Reiter oben und Pfadzeile
  function renderTop() {
    var s = skin();
    if (s !== 'mediaplayer') { $('mp-wtop').innerHTML = ''; $('mp-crumb').innerHTML = ''; return; }
    var lobView = view === 'lobbys';
    $('mp-wtop').innerHTML = '<div class="mp-wtabs" role="tablist"><button type="button" data-go="now" class="' + (view === 'now' ? 'on' : '') + '">Wiedergabe läuft</button>' +
      '<button type="button" data-go="all" class="' + (isLibView(view) ? 'on' : '') + '">Bibliothek</button>' +
      (jfGroup() ? '<button type="button" data-go="jf:start" class="' + (isJfView() ? 'on' : '') + '">' + esc(JF.st.name || 'Jellyfin') + '</button>' : '') +
      (CAN_LOBBY && lib.me ? '<button type="button" data-go="lobbys" class="' + (lobView ? 'on' : '') + '">Lobbys</button>' : '') +
      (lib.canUpload ? '<button type="button" data-act="upload">Hochladen</button>' : '') + '</div><button type="button" class="mp-wskin" data-act="skin-pop" title="Aussehen">🎨</button>';
    var p = /^pl:/.test(view) ? playlist(view) : null;
    var path = isJfView() ? [(JF.st && JF.st.name) || 'Jellyfin', JF_VIEWS[view] || (JF.show ? JF.show.name : 'Serie')] : view === 'now' ? ['Wiedergabe läuft'] : lobView ? ['Lobbys'] : view === 'radio' ? ['Radio'] : p ? ['Playlists', p.title] : ['Bibliothek', VIEW_NAME[view] || ''];
    if (kindF) path.push({ audio: 'Musik', video: 'Videos', youtube: 'YouTube' }[kindF]);
    $('mp-crumb').innerHTML = (view !== 'now' ? '<button type="button" class="small" data-act="side-toggle" title="Navigationsbereich ein- oder ausblenden">☰</button>' : '') +
      '<span class="path">Musik<i>▸</i>' + path.map(esc).join('<i>▸</i>') + '</span>';
  }
  function chips() {
    var opts = [['', 'Alle'], ['audio', '🎵 Musik'], ['video', '🎬 Videos']];
    if (CAN_YT) opts.push(['youtube', '▶️ YouTube']);
    return '<span class="mp-chips" role="group" aria-label="Art">' + opts.map(function (o) {
      return '<button type="button" data-act="kind" data-kind="' + o[0] + '" class="' + (kindF === o[0] ? 'on' : '') + '" aria-pressed="' + (kindF === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</span>';
  }
  function sideBtn() {
    return sideMode() === 'closed' && !isPhone() && skin() !== 'mediaplayer' ? '<button type="button" class="small" data-act="side-open" title="Seitenleiste zeigen">☰</button> ' : '';
  }
  function renderHead() {
    if (isJfView()) { jfHead(); return; }
    if (view === 'now') { head.innerHTML = infoHead(); return; }
    if (view === 'lobbys') { head.innerHTML = lobbyListHead(); return; }
    if (view === 'radio') { radioHead(); return; }
    var tracks = filtered(viewTracks(view)), p = /^pl:/.test(view) ? playlist(view) : null;
    var h = '<div class="mp-title">' + sideBtn() + '<b>' + (p ? '📃 ' + esc(p.title) : esc(VIEW_NAME[view] || '')) + '</b> <small>' + tracks.length + ' Titel' +
      (totalTime(tracks) ? ' · ' + fmt(totalTime(tracks)) : '') + (p ? ' · ' + VIS_LABEL[p.visibility] + (p.mine ? '' : ' · von ' + esc(p.owner)) : '') + '</small></div>';
    h += '<div class="mp-tools">' + chips() + '<input type="search" id="mp-filter" placeholder="🔍 Suchen" aria-label="Titel suchen" value="' + esc(filter) + '">';
    if (lob) h += '<button type="button" class="small" data-act="lobby-add-view" title="Alle Titel dieser Liste in die Lobby">🎧 Alle in die Lobby</button>';
    else h += '<button type="button" class="small" data-act="play-view">▶ Alle abspielen</button><button type="button" class="small" data-act="queue-view" title="Alle Titel hinten an die Wiedergabeliste hängen">➕ Anhängen</button>';
    if (p && p.mine) h += '<button type="button" class="small" data-act="edit-playlist">✎ Bearbeiten</button><button type="button" class="small danger" data-act="delete-playlist">🗑</button>';
    if (kindF === 'youtube' && lib.me && CAN_YT) h += '<button type="button" class="small" data-act="yt-save" title="YouTube-Links dauerhaft in der Bibliothek ablegen">💾 Links speichern …</button>';
    h += '</div>';
    if (lob) h += '<p class="mp-hint">🎧 Du bist in einer Lobby: Ein Klick auf einen Titel fügt ihn der Warteschlange der Lobby hinzu.</p>';
    head.innerHTML = h;
    var f = $('mp-filter');
    f.addEventListener('input', function () { filter = f.value.trim(); renderList(); });
  }

  function renderList() {
    if (isJfView()) { jfList(); return; }
    if (view === 'now') { list.innerHTML = ''; return; }
    if (view === 'lobbys') { renderLobbies(); return; }
    if (view === 'radio') { renderRadio(); return; }
    if (view === 'privat' && kindF === 'video' && listTracks().length) { renderTiles(listTracks()); return; }
    var p = /^pl:/.test(view) ? playlist(view) : null, own = p && p.mine;
    var tracks = listTracks();
    if (!tracks.length) {
      var empty = filter || kindF ? 'Nichts gefunden.' : p ? 'Diese Playlist ist noch leer. Füge Titel über 📃 in der Bibliothek hinzu oder ziehe sie auf die Playlist in der Seitenleiste.'
        : view === 'meine' ? (lib.canUpload ? 'Du hast noch nichts hochgeladen. Über 📤 Hochladen geht es los.' : 'Du hast noch nichts hochgeladen.') : 'Hier gibt es noch nichts.';
      list.innerHTML = '<p class="mp-empty">' + empty + '</p>';
      return;
    }
    var playingId = lob ? null : current && current.id, group = grouped(), lastAlbum = null;
    var rows = tracks.map(function (t, i) {
      var acts = '', pre = '';
      if (group && albumOf(t) !== lastAlbum) {
        lastAlbum = albumOf(t);
        pre = '<tr class="mp-grp-row"><td colspan="6"><span class="mp-art" style="--h:' + hue(lastAlbum) + '">' + kindIcon(t) + '</span><b>' + esc(lastAlbum) + '</b> <small>' + esc(t.artist) + '</small></td></tr>';
      }
      if (!lob) acts += '<button type="button" class="small" data-act="track-queue" title="An die Wiedergabeliste hängen">➕</button>';
      if (lib.me) acts += '<button type="button" class="small" data-act="to-playlist" title="Zu einer Playlist hinzufügen">📃</button>';
      if (own) acts += '<button type="button" class="small" data-act="pl-up" title="Nach oben">▲</button><button type="button" class="small" data-act="pl-down" title="Nach unten">▼</button>' +
        '<button type="button" class="small" data-act="pl-remove" title="Aus der Playlist nehmen">✕</button>';
      else if (t.canEdit) acts += '<button type="button" class="small" data-act="edit-track" title="Bearbeiten">✎</button><button type="button" class="small danger" data-act="delete-track" title="Löschen">🗑</button>';
      var now = t.id === playingId;
      return pre + '<tr data-id="' + t.id + '" data-i="' + i + '" draggable="true" class="' + (now ? 'playing' : '') + (lob && !t.shareable ? ' locked' : '') + '">' +
        '<td class="num">' + (now ? (isPlaying() ? '🔊' : '⏸') : i + 1) + '</td>' +
        '<td><span class="mp-ico" title="' + (isYt(t) ? 'YouTube' : isVideo(t) ? 'Video' : 'Audio') + '">' + kindIcon(t) + '</span> <button type="button" class="mp-track" data-act="play-track">' + esc(t.title) + '</button>' +
        (t.visibility !== 'public' ? ' <small title="' + VIS_LABEL[t.visibility] + '">' + (t.visibility === 'private' ? '🔒' : t.visibility === 'friends' ? '🤝' : '👥') + '</small>' : '') +
        (t.artist ? '<small class="mp-artist">' + esc(t.artist) + '</small>' : '') + '</td>' +
        '<td>' + esc(t.artist) + '</td><td class="num">' + (t.duration ? fmt(t.duration) : '') + '</td>' +
        '<td class="mp-by">' + (t.byAdmin ? '' : userLink(t.by, t.byUser)) + '</td><td class="mp-acts">' + acts + '</td></tr>';
    }).join('');
    list.innerHTML = '<table class="list mp-table"><thead><tr><th class="num">#</th><th>Titel</th><th>Interpret</th><th class="num">Länge</th><th>Von</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var tr = e.target.closest('tr[data-id], tr[data-lobby], tr[data-radio]');
    if (!tr) return;
    var act = b.dataset.act;
    if (tr.dataset.radio) { radioAct(act, Number(tr.dataset.radio)); return; }
    if (tr.dataset.lobby) { if (act === 'join') joinLobby(tr.dataset.lobby); return; }
    var id = Number(tr.dataset.id), t = byId[id], tracks = listTracks();
    if (act === 'play-track') { if (lob) lobbyAdd({ tracks: [id] }); else playList(tracks, Number(tr.dataset.i)); }
    else if (act === 'track-queue') enqueue([t]);
    else if (act === 'to-playlist') toPlaylist(id);
    else if (act === 'edit-track') editTrack(t);
    else if (act === 'delete-track') deleteTrack(t);
    else if (/^pl-/.test(act)) changePlaylist(playlist(view), Number(tr.dataset.i), act);
  });

  // Titel auf eine Playlist, die Wiedergabeliste oder die eigene Lobby in der Seitenleiste ziehen
  var dragId = null;
  list.addEventListener('dragstart', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-id]');
    if (!tr) return;
    dragId = Number(tr.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
    try { e.dataTransfer.setData('text/plain', byId[dragId] ? byId[dragId].title : ''); } catch (err) { /* alt */ }
  });
  list.addEventListener('dragend', function () { dragId = null; side.querySelectorAll('.drop-ok').forEach(function (x) { x.classList.remove('drop-ok'); }); });
  side.addEventListener('dragover', function (e) {
    var t = dragId && e.target.closest('[data-drop]');
    if (!t || !t.dataset.drop) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    t.classList.add('drop-ok');
  });
  side.addEventListener('dragleave', function (e) { var t = e.target.closest('[data-drop]'); if (t) t.classList.remove('drop-ok'); });
  side.addEventListener('drop', function (e) {
    var t = e.target.closest('[data-drop]'), id = dragId;
    if (!t || !id || !byId[id]) return;
    e.preventDefault(); t.classList.remove('drop-ok');
    var d = t.dataset.drop;
    if (d === 'queue') { if (lob) lobbyAdd({ tracks: [id] }); else enqueue([byId[id]]); }
    else if (d === 'lobby') lobbyAdd({ tracks: [id] });
    else if (/^pl:/.test(d)) addToPlaylist(playlist(d), id);
  });

  // ---------- Wiedergabe läuft: Angaben zum laufenden Titel ----------
  function infoHead() {
    var it = playingItem(), h = '<div class="mp-info">' + sideBtn();
    if (it) {
      var by = lob ? (it.by ? 'hinzugefügt von ' + userLink(it.by, it.byUser) : '') : it.byAdmin ? '' : it.by ? 'von ' + userLink(it.by, it.byUser) : '';
      h += '<div class="mp-info-title"><b>' + esc(it.title) + '</b> ' + kindBadge(it) + '</div>' +
        '<div class="mp-info-sub">' + [esc(it.artist), esc(it.album), by].filter(Boolean).join(' · ') + '</div>';
    } else if (!lob) {
      h += '<div class="mp-info-title"><b>Gerade läuft nichts.</b></div><div class="mp-info-sub">Wähle in der Medienbibliothek einen Titel' +
        (CAN_YT ? ' oder füge in der Wiedergabeliste einen YouTube-Link ein' : '') + '.</div>';
    }
    h += '</div>';
    if (!lob && CAN_LOBBY && lib.me) h += '<p class="mp-hint">🎧 Mit anderen gleichzeitig hören? <button type="button" class="small" data-go="lobbys">Lobbys ansehen</button></p>';
    return h;
  }

  // ---------- Eigene Wiedergabe ----------
  // Die Wiedergabeliste hält Titel aus der Bibliothek und YouTube-Videos (auch ohne Konto); jeder Eintrag hat einen eigenen Schlüssel
  var queue = [], cur = -1, current = null, counted = false, played = {}, back = [], qSeq = 0;
  function qItem(t) { return Object.assign({}, t, { key: 'q' + (++qSeq) }); }
  function playList(tracks, start) {
    if (!tracks.length) return;
    queue = tracks.map(qItem); played = {}; back = [];
    playAt(clamp(start || 0, 0, queue.length - 1));
  }
  // Hinten anhängen; läuft gerade nichts, startet der erste neue Titel
  function enqueue(tracks) {
    if (!tracks.length) return;
    var start = queue.length;
    tracks.forEach(function (t) { queue.push(qItem(t)); });
    status(tracks.length === 1 ? '„' + tracks[0].title + '“ steht in der Wiedergabeliste.' : tracks.length + ' Titel stehen in der Wiedergabeliste.');
    if (!current || !isPlaying()) playAt(start); else renderQueue();
  }
  function playAt(i) {
    if (!queue[i]) return;
    if (current && cur !== i) back.push(cur);
    cur = i; current = queue[i]; counted = false; played[current.key] = true;
    graph();
    overlay.hidden = true;
    if (JF.play) jfDetach();
    if (isJf(current)) {
      ytStop();
      jfStart(current);
    } else if (isYt(current)) {
      media.pause(); media.removeAttribute('src'); media.load();
      ytPlayLocal(current);
    } else if (isRadio(current)) {
      ytStop();
      media.src = '/musik/radio/' + current.sid + '/stream';
      media.play().catch(function () { /* wartet auf Klick */ });
    } else {
      ytStop();
      media.src = '/musik/stream/' + current.id;
      media.play().catch(function () { /* wartet auf Klick */ });
    }
    status('▶ ' + current.title + (current.artist ? ' – ' + current.artist : ''));
    nowPlaying();
    renderAfterChange();
    kick();
  }
  function renderAfterChange() {
    jfBrowse(); applyPicture(); renderQueue(); renderList(); updateButtons();
    if (view === 'now') renderHead();
  }
  // Der laufende Titel steht dauerhaft unten im Fensterrand (public/retro.js), daneben die Meldungen
  function nowStatus() {
    var t = playingItem();
    if (t) document.body.dataset.status = (isPlaying() ? '▶ ' : '⏸ ') + t.title + (t.artist ? ' – ' + t.artist : '');
    else delete document.body.dataset.status;
  }
  // Winamp: Lauftext, Art und Quelle in der grünen Anzeige
  var waTime = $('mp-wa-time'), waState = $('mp-wa-state'), waTitle = $('mp-wa-title');
  function nowWa() {
    var t = playingItem(), q = lob ? (lob.state ? lob.state.index : -1) : cur;
    var txt = t ? (q + 1) + '. ' + (t.artist ? t.artist + ' - ' : '') + t.title + (t.duration ? ' (' + fmt(t.duration) + ')' : '') + '  ***  ' : 'Mediaplayer  ***  ';
    if (waTitle.textContent !== txt) waTitle.textContent = txt;
    $('mp-wa-kind').textContent = !t ? '---' : isRadio(t) ? 'RADIO' : isYt(t) ? 'YOUTUBE' : isVideo(t) ? 'VIDEO' : 'AUDIO';
    $('mp-wa-src').textContent = lob ? 'LOBBY' : 'EIGENE';
    $('mp-wa-ml').classList.toggle('on', sideMode() !== 'closed');
    root.querySelectorAll('[data-act=eq]').forEach(function (b) { b.classList.toggle('on', !!player.eq.on); });
  }
  function nowPlaying() {
    var t = playingItem();
    nowEl.textContent = t ? t.title + (t.artist ? ' – ' + t.artist : '') : '';
    lcdTitle.textContent = t ? t.title + (t.artist ? ' – ' + t.artist : '') : 'Mediaplayer';
    nowStatus();
    nowWa();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = t ? new window.MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '' }) : null; } catch (e) { /* alt */ }
    }
  }
  function nextIndex(auto) {
    if (!queue.length) return -1;
    if (prefs.shuffle) {
      var all = queue.map(function (x, i) { return i; }), left = all.filter(function (i) { return !played[queue[i].key]; });
      if (!left.length) {
        if (auto && prefs.repeat !== 'alle') return -1;
        played = {};
        left = all.filter(function (i) { return i !== cur; });
        if (!left.length) left = [cur];
      }
      return left[Math.floor(Math.random() * left.length)];
    }
    if (cur + 1 < queue.length) return cur + 1;
    return !auto || prefs.repeat === 'alle' ? 0 : -1;
  }
  function next(auto) {
    if (lob) { if (!auto) lobbyCtl('next'); return; }
    if (!queue.length) return;
    if (auto && prefs.repeat === 'einen' && current) { restart(); return; }
    var i = nextIndex(auto);
    if (i < 0) { stop(); status('Ende der Wiedergabeliste.'); return; }
    playAt(i);
  }
  // Kaputter Titel: weiter zum nächsten, auch bei „diesen Titel wiederholen“
  function skipBroken() {
    var i = nextIndex(true);
    if (i < 0 || i === cur) { stop(); return; }
    playAt(i);
  }
  function restart() {
    if (isYt(current)) { ytDone = false; ytCmd('seekTo', [0, true]); ytCmd('playVideo'); }
    else { media.currentTime = 0; media.play().catch(function () {}); }
  }
  function prev() {
    if (lob) { lobbyCtl('prev'); return; }
    if (!current) return;
    if (timing().t > 3) { seekTo(0); return; }
    var i = prefs.shuffle && back.length ? back.pop() : cur - 1;
    if (i < 0 || !queue[i]) { seekTo(0); return; }
    var keep = back.slice();
    playAt(i);
    if (prefs.shuffle) back = keep;
  }
  function stop() {
    if (lob) { lobbyCtl('pause'); lobbyCtl('seek', { pos: 0 }); return; }
    if (isYt(current)) { ytCmd('pauseVideo'); ytCmd('seekTo', [0, true]); }
    if (JF.play) jfReport(JF.play, { stop: true });
    media.pause();
    if (media.getAttribute('src')) media.currentTime = 0;
    renderAfterChange();
  }
  function isPlaying() {
    if (lob) return !!(lob.state && lob.state.playing);
    if (isYt(current)) return yt.state === 1 || yt.state === 3;
    return !media.paused;
  }
  // Für die Pixelpfoten auf dem Desktop (games/haustier/src/js/desktop.js): Läuft hörbar Musik, und wie laut ist der
  // Bass gerade (0 bis 1)? Bei YouTube gibt es keinen Ton zum Messen, dann null: Die Tiere tanzen nach festem Takt.
  var bass = null;
  window.RetroMusic = {
    playing: function () { return isPlaying() && Sound.musik() > 0; },
    level: function () {
      if (!analyser || media.paused || (current && isYt(current))) return null;
      if (!bass) bass = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bass);
      var sum = 0;
      for (var i = 1; i < 9; i++) sum += bass[i];
      return sum / 8 / 255;
    },
  };
  function playPause() {
    if (lob) { var s = lob.state; if (s) lobbyCtl(s.playing ? 'pause' : 'play'); return; }
    if (!current) {
      if (queue.length) { playAt(clamp(cur, 0, queue.length - 1)); return; }
      var tracks = filtered(viewTracks(isLibView(view) ? view : 'all'));
      if (tracks.length) playList(tracks, 0); else status('Die Wiedergabeliste ist leer.');
      return;
    }
    graph();
    if (isYt(current)) {
      if (!yt.frame) ytPlayLocal(current);
      else if (isPlaying()) ytCmd('pauseVideo'); else ytCmd('playVideo');
      return;
    }
    if (media.paused) media.play().catch(oops); else media.pause();
  }
  function seekTo(to) {
    if (lob) { lobbyCtl('seek', { pos: to }); return; }
    if (!current) return;
    if (isYt(current)) { ytCmd('seekTo', [to, true]); yt.time = to; yt.timeAt = Date.now(); }
    else media.currentTime = to;
  }

  media.addEventListener('play', function () { updateButtons(); renderSoon(); kick(); overlay.hidden = true; });
  media.addEventListener('pause', function () { updateButtons(); renderSoon(); });
  media.addEventListener('ended', function () {
    countPlay();
    if (lob) { var it = currentLobbyItem(); if (it) lobbyCtl('ended', { key: it.key }, true); return; }
    next(true);
  });
  media.addEventListener('timeupdate', function () { if (!counted && media.currentTime > 30) countPlay(); });
  media.addEventListener('loadedmetadata', function () {
    if (lob) syncLobby();
    // Titel aus der Seitenverwaltung kennen ihre Länge erst jetzt; der Server erfährt sie mit dem Abspiel-Zähler
    else if (current && !current.duration && isFinite(media.duration)) { current.duration = media.duration; renderQueue(); }
    showTime();
  });
  media.addEventListener('error', function () {
    if (!media.getAttribute('src') || !media.error) return;
    if (isRadio(current)) { status('⚠ Der Sender „' + current.title + '“ ist gerade nicht erreichbar.'); return; }
    status('⚠ Dieser Titel lässt sich nicht abspielen.');
    if (!lob) setTimeout(skipBroken, 1500);
  });
  function countPlay() {
    if (counted || !current || lob || !current.id || isRadio(current)) return;
    counted = true;
    var d = isYt(current) ? yt.duration : media.duration;
    post('/musik/titel/' + current.id + '/gespielt', { duration: d || 0 }).catch(function () {});
  }
  var renderTimer = null;
  function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(function () { renderList(); renderQueue(); }, 50); }

  function updateButtons() {
    var playing = isPlaying();
    var b = btn('play');
    b.classList.toggle('on', playing); b.title = playing ? 'Pause' : 'Abspielen'; b.setAttribute('aria-label', b.title);
    var sh = btn('shuffle'), rp = btn('repeat');
    sh.setAttribute('aria-pressed', prefs.shuffle); sh.classList.toggle('pressed', prefs.shuffle);
    rp.dataset.mode = prefs.repeat; rp.classList.toggle('pressed', prefs.repeat !== 'aus');
    rp.title = 'Wiederholen: ' + { aus: 'aus', alle: 'alle', einen: 'diesen Titel' }[prefs.repeat];
    sh.disabled = rp.disabled = !!lob;
    var ctl = !lob || lobbyCanControl();
    ['play', 'stop', 'next', 'prev'].forEach(function (a) { btn(a).disabled = !ctl; });
    seek.disabled = !ctl;
    nowStatus();
    if (!playing) root.classList.remove('idle');
  }

  // Zeitleiste
  var seeking = false;
  function ytNow() { return yt.state === 1 ? yt.time + (Date.now() - yt.timeAt) / 1000 : yt.time; }
  function timing() {
    if (lob) {
      var it = currentLobbyItem();
      if (!it) return { t: 0, d: 0 };
      return { t: lobbyPos(), d: it.duration || (it.type === 'yt' ? yt.duration : media.duration) || 0 };
    }
    if (isYt(current)) return { t: ytNow(), d: yt.duration || current.duration || 0 };
    return { t: media.currentTime || 0, d: isFinite(media.duration) ? media.duration : (current && current.duration) || 0 };
  }
  function showTime() {
    var x = timing(), t = fmt(Math.min(x.t, x.d || x.t));
    timeEl.textContent = t;
    durEl.textContent = fmt(x.d);
    if (!seeking) seek.value = x.d ? Math.round(Math.min(1, x.t / x.d) * 1000) : 0;
    seek.style.setProperty('--p', seek.value / 10 + '%');
    if (skin() === 'winamp') {
      var sec = Math.max(0, Math.floor(Math.min(x.t, x.d || x.t)));
      waTime.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      waState.textContent = isPlaying() ? '▶' : playingItem() ? '❚❚' : '■';
    }
    if (root.classList.contains('mini') || skin() === 'mediaplayer') lcdTime.textContent = t + ' / ' + fmt(x.d) + (lob && lob.state ? ' · Lobby' : '');
    // YouTube ohne Lobby: nach 30 Sekunden zählt das Video als gehört
    if (!lob && !counted && isYt(current) && x.t > 30) countPlay();
  }
  seek.addEventListener('input', function () { seeking = true; var x = timing(); timeEl.textContent = fmt(seek.value / 1000 * x.d); seek.style.setProperty('--p', seek.value / 10 + '%'); });
  seek.addEventListener('change', function () {
    seeking = false;
    var x = timing();
    if (x.d) seekTo(seek.value / 1000 * x.d);
  });
  setInterval(function () { if (!looping) showTime(); }, 500);

  // ---------- Wiedergabeliste rechts: eigene oder die der Lobby ----------
  function renderQueue() {
    if (isJfView() && JF.det && jfSidePanel()) { jfRenderDetails(); return; }
    var s = lob && lob.state, items = lob ? (s ? s.queue : []) : queue, at = lob ? (s ? s.index : -1) : (current ? cur : -1);
    var ctl = !lob || lobbyCanControl(), playing = isPlaying();
    qhead.innerHTML = '<b>Wiedergabeliste</b> <small>' + (lob ? '🔴 ' + (s ? esc(s.name) : 'Lobby') : 'Eigene Wiedergabe') + ' · ' + items.length + ' Titel' +
      (totalTime(items) ? ' · ' + fmt(totalTime(items)) : '') + '</small>';
    if (lob && !s) qlist.innerHTML = '<p class="mp-empty">Verbinde mit der Lobby …</p>';
    else if (!items.length) {
      qlist.innerHTML = '<p class="mp-empty">' + (lob ? 'Die Warteschlange der Lobby ist leer. Klicke in der Medienbibliothek auf Titel' : 'Die Wiedergabeliste ist leer. Klicke in der Medienbibliothek auf einen Titel') +
        (CAN_YT && ctl ? ' oder füge unten einen YouTube-Link ein' : '') + '.</p>';
    } else {
      qlist.innerHTML = items.map(function (q, i) {
        var now = i === at;
        return '<div class="mp-qrow' + (now ? ' playing' : lob && i < at ? ' done' : '') + '" data-i="' + i + '" data-key="' + esc(q.key) + '">' +
          '<span class="num">' + (now ? (playing ? '🔊' : '⏸') : i + 1) + '</span>' +
          '<button type="button" class="mp-track" data-act="q-jump"' + (ctl ? '' : ' disabled') + ' title="' + esc(q.title + (q.artist ? ' – ' + q.artist : '')) + '">' + esc(q.title) +
          (q.artist ? ' <small>– ' + esc(q.artist) + '</small>' : '') + '</button>' + kindBadge(q) +
          '<span class="dur">' + (q.duration ? fmt(q.duration) : '') + '</span>' +
          (ctl ? '<span class="mp-acts"><button type="button" class="small" data-act="q-up" title="Nach oben">▲</button><button type="button" class="small" data-act="q-down" title="Nach unten">▼</button>' +
            '<button type="button" class="small" data-act="q-remove" title="Entfernen">✕</button></span>' : '') + '</div>';
      }).join('');
    }
    var h = '';
    if (CAN_YT && ctl) {
      h += '<div class="mp-ytfield"><input type="text" id="mp-yt-url" class="mp-yt-url" placeholder="YouTube-Link (Video oder Playlist)" aria-label="YouTube-Link einfügen">' +
        '<button type="button" class="small" data-act="yt-add" title="' + (lob ? 'In die Warteschlange der Lobby' : 'An die Wiedergabeliste hängen') + '">＋ YouTube</button></div>';
    }
    if (ctl) {
      h += '<div class="mp-qbtns"><button type="button" class="small" data-act="q-shuffle" title="Alles nach dem laufenden Titel neu mischen">🔀 Mischen</button>' +
        (lib.me ? '<button type="button" class="small" data-act="q-save" title="Als Playlist speichern">💾 Speichern</button>' : '') +
        '<button type="button" class="small" data-act="q-clear" title="Wiedergabeliste leeren">🧹 Leeren</button></div>';
    } else if (lob) h += '<p class="mp-hint">Nur der Gastgeber und Zuhörer mit Player-Rechten ändern die Warteschlange.</p>';
    // Ein halb getippter Link bleibt beim Neuzeichnen stehen
    var old = $('mp-yt-url'), typed = old ? old.value : '', focused = old && document.activeElement === old;
    qtools.innerHTML = h;
    var inp = $('mp-yt-url');
    if (inp) {
      inp.value = typed;
      if (focused) inp.focus();
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addYoutube(); } });
    }
  }
  qlist.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), row = e.target.closest('.mp-qrow');
    if (!b || !row) return;
    var act = b.dataset.act, i = Number(row.dataset.i);
    if (lob) {
      var key = row.dataset.key;
      if (act === 'q-jump') lobbyCtl('jump', { key: key });
      else if (act === 'q-up' || act === 'q-down') lobbyCtl('move', { key: key, by: act === 'q-up' ? -1 : 1 });
      else if (act === 'q-remove') lobbyCtl('remove', { key: key });
      return;
    }
    if (act === 'q-jump') playAt(i);
    else if (act === 'q-up' || act === 'q-down') {
      var j = act === 'q-up' ? i - 1 : i + 1;
      if (j < 0 || j >= queue.length) return;
      var x = queue[i]; queue[i] = queue[j]; queue[j] = x;
      if (cur === i) cur = j; else if (cur === j) cur = i;
      back = [];
      renderQueue();
    } else if (act === 'q-remove') {
      queue.splice(i, 1);
      back = [];
      if (i < cur) cur--;
      else if (i === cur) {
        if (queue[cur]) { current = null; playAt(cur); return; }
        stopOwn();
      }
      renderQueue();
    }
  });
  // Eigene Wiedergabe ganz anhalten (Liste leer oder laufender Titel entfernt)
  function stopOwn() {
    if (JF.play) jfDetach();
    media.pause(); media.removeAttribute('src'); media.load();
    ytStop();
    current = null; cur = Math.min(cur, queue.length - 1);
    nowPlaying(); renderAfterChange();
  }
  function shuffleQueue() {
    if (lob) { lobbyCtl('shuffle'); return; }
    var rest = queue.splice(cur + 1);
    for (var i = rest.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = rest[i]; rest[i] = rest[j]; rest[j] = x; }
    queue = queue.concat(rest);
    back = [];
    renderQueue();
    status('Gemischt.');
  }
  function clearQueue() {
    if (lob) {
      confirmBox('Warteschlange leeren', 'Alle Titel aus der Warteschlange der Lobby nehmen?', 'Leeren').then(function (ok) { if (ok) lobbyCtl('clear'); });
      return;
    }
    queue = []; cur = -1; played = {}; back = [];
    stopOwn();
  }
  // Wiedergabeliste als Playlist speichern. YouTube-Videos, die noch nicht in der Bibliothek sind, kommen dabei hinein.
  function saveQueue() {
    var items = lob ? (lob.state ? lob.state.queue : []) : queue;
    if (!items.length) { status('Die Wiedergabeliste ist leer.'); return; }
    dialog('💾 Wiedergabeliste speichern',
      '<label>Name der Playlist:<input type="text" name="title" class="w100" maxlength="100" value="' + esc(lob && lob.state ? lob.state.name : '') + '"></label>' +
      '<label>Wer darf sie sehen?<select name="visibility">' + visOptions('private') + '</select></label>' +
      '<p><small>YouTube-Videos werden dafür auch als Links in deiner Bibliothek gespeichert, mit derselben Sichtbarkeit.</small></p>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      var title = (field('title') || '').trim(), visibility = field('visibility');
      if (r !== 'ok' || !title) return;
      var ytIds = items.filter(function (it) { return isYt(it) && !it.id; }).map(function (it) { return it.videoId; });
      status('Speichere …');
      (ytIds.length ? post('/musik/youtube', { ids: ytIds, save: true, visibility: visibility }) : Promise.resolve({ tracks: [] })).then(function (j) {
        var byVideo = {};
        j.tracks.forEach(function (t) { byVideo[t.videoId] = t.id; });
        var ids = items.map(function (it) { return it.type === 'track' ? it.trackId : it.id || byVideo[it.videoId]; }).filter(Boolean);
        return post('/musik/playlists', { title: title, visibility: visibility, tracks: ids });
      }).then(function (j) {
        status('Playlist „' + title + '“ gespeichert.');
        return load().then(function () { if (!isPhone()) show('pl:' + j.id); });
      }).catch(oops);
    });
  }

  root.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go && root.contains(go)) { closePop(); show(go.dataset.go); return; }
    var lj = e.target.closest('[data-lobby]');
    if (lj && side.contains(lj)) { closePop(); joinLobby(lj.dataset.lobby); return; }
    var b = e.target.closest('button[data-act]');
    if (!b) { if (!e.target.closest('.mp-pop, .mp-eq')) closePop(); return; }
    if (list.contains(b) || qlist.contains(b) || dlg.contains(b)) return;
    var a = b.dataset.act;
    if (a !== 'menu' && a !== 'skin-pop') closePop();
    if (a === 'menu') openMenu(b);
    else if (a === 'skin-pop') openSkins(b);
    else if (a === 'skin') setSkin(b.dataset.skin);
    else if (a === 'radio-add') addStation();
    else if (a === 'radio-play') { if (isPhone()) root.classList.remove('drawer'); radioAct('play', Number(b.dataset.radio)); }
    else if (a === 'vis-pick') setVis(b.dataset.vis);
    else if (a === 'side-rail') setSide('rail');
    else if (a === 'side-open') setSide('open');
    else if (a === 'side-toggle' || a === 'side-cycle') setSide(sideMode() === 'closed' ? 'open' : 'closed');
    else if (a === 'grp') toggleGroup(b.dataset.grp);
    else if (a === 'drawer') { root.classList.toggle('drawer'); renderSide(); loadLobbies(); }
    else if (a === 'kind') { kindF = b.dataset.kind; renderTop(); renderHead(); renderList(); }
    else if (a === 'big') { prefs.big = !prefs.big; savePrefs(); if (prefs.big && view !== 'now') view = 'now'; render(); }
    else if (a === 'eq') toggleEq();
    else if (a === 'lobby-new') { show('lobbys'); setTimeout(function () { var n = $('mp-lobby-name'); if (n) n.focus(); }, 0); }
    else if (a === 'play') playPause();
    else if (a === 'stop') stop();
    else if (a === 'next') next(false);
    else if (a === 'prev') prev();
    else if (a === 'shuffle') { prefs.shuffle = !prefs.shuffle; played = {}; if (current) played[current.key] = true; savePrefs(); updateButtons(); }
    else if (a === 'repeat') { prefs.repeat = { aus: 'alle', alle: 'einen', einen: 'aus' }[prefs.repeat] || 'aus'; savePrefs(); updateButtons(); }
    else if (a === 'fullscreen') fullscreen();
    else if (a === 'theater') setTheater(!root.classList.contains('theater'));
    else if (a === 'mini') setMini(true);
    else if (a === 'mini-off') setMini(false);
    else if (a === 'pic-video' || a === 'pic-vis') { prefs.picture = a === 'pic-vis' ? 'vis' : 'video'; savePrefs(); applyPicture(); kick(); }
    else if (a === 'upload') upload();
    else if (a === 'new-playlist') newPlaylist([]);
    else if (a === 'play-view') playList(filtered(viewTracks(view)), 0);
    else if (a === 'queue-view') enqueue(filtered(viewTracks(view)));
    else if (a === 'lobby-add-view') lobbyAdd({ tracks: filtered(viewTracks(view)).map(function (t) { return t.id; }) });
    else if (a === 'edit-playlist') editPlaylist(playlist(view));
    else if (a === 'delete-playlist') deletePlaylist(playlist(view));
    else if (a === 'q-shuffle') shuffleQueue();
    else if (a === 'q-save') saveQueue();
    else if (a === 'q-clear') clearQueue();
    else if (a === 'lobby-create') createLobby();
    else if (a === 'lobby-refresh') loadLobbies();
    else if (a === 'lobby-list') show('lobbys');
    else if (a === 'lobby-leave') leaveLobby();
    else if (a === 'lobby-link') copyLink();
    else if (a === 'lobby-settings') lobbySettings();
    else if (a === 'lobby-user') lobbyUser(Number(b.dataset.user), e);
    else if (a === 'lobby-close') closeLobby();
    else if (a === 'yt-add') addYoutube();
    else if (a === 'yt-save') saveYoutube();
    else if (a === 'yt-allow') allowYoutube();
    else if (a === 'unblock') { overlay.hidden = true; graph(); if (lob) syncLobby(); else if (isYt(current)) ytPlayLocal(current); else media.play().catch(oops); }
  });
  document.addEventListener('keydown', function (e) {
    if (dlg.open) return;
    if (e.key === 'Escape' && root.classList.contains('theater') && !document.fullscreenElement) { setTheater(false); return; }
    if (e.key !== ' ' || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
    e.preventDefault(); wake(); playPause();
  });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', playPause);
      navigator.mediaSession.setActionHandler('pause', playPause);
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('nexttrack', function () { next(false); });
    } catch (e) { /* nicht unterstützt */ }
  }

  // ---------- Aussehen, Seitenleiste, Menüs ----------
  function setSkin(id) {
    if (!skinOk(id)) return;
    if (document.fullscreenElement) document.exitFullscreen();
    player.skin = id; savePlayer();
    render(); kick();
    status('Aussehen: ' + SKINS.filter(function (k) { return k.id === id; })[0].name);
  }
  function setSide(mode) {
    player.side[skin()] = mode; savePlayer();
    render(); loadLobbies();
  }
  function toggleGroup(id) {
    var i = player.shut.indexOf(id);
    if (i >= 0) player.shut.splice(i, 1); else player.shut.push(id);
    savePlayer(); renderSide();
    if (id === 'lob') loadLobbies();
  }
  // Ein Aufklappmenü am Knopf: Einträge sind Knöpfe mit data-act, der Klick-Verteiler oben führt sie aus
  var pop = $('mp-pop'), popFor = null;
  function closePop() {
    if (pop.hidden) return;
    pop.hidden = true; pop.innerHTML = '';
    if (popFor) popFor.classList.remove('open');
    popFor = null;
  }
  function showPop(anchor, html) {
    if (popFor === anchor && !pop.hidden) { closePop(); return; }
    closePop();
    pop.innerHTML = html; pop.hidden = false; popFor = anchor; anchor.classList.add('open');
    var r = anchor.getBoundingClientRect(), m = root.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = r.left - m.left, top = r.bottom - m.top + 2;
    if (left + w > m.width - 4) left = Math.max(4, m.width - w - 4);
    if (top + h > m.height - 4) top = Math.max(4, r.top - m.top - h - 2);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    var first = pop.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  function popItem(o) {
    if (o === '-') return '<hr>';
    return '<button type="button" data-act="' + o.act + '"' + (o.data || '') + (o.off ? ' disabled' : '') + '><span class="chk">' + (o.on ? '✓' : '') + '</span>' + o.label +
      (o.key ? '<span class="key">' + o.key + '</span>' : '') + '</button>';
  }
  function openSkins(anchor) {
    if (pop.contains(anchor)) { anchor = popFor; closePop(); }
    var h = '<div class="ph">🎨 Aussehen des Players</div>' + SKINS.map(function (k) {
      return '<button type="button" data-act="skin" data-skin="' + k.id + '" class="' + (k.id === skin() ? 'cur' : '') + '"><span class="sw sw-' + k.id + '"></span><span>' + k.name +
        '<span class="sub">' + k.sub + '</span></span></button>';
    }).join('');
    if (VIS_LIST.length) h += '<hr><div class="ph">🌈 Visualisierung</div>' + VIS_LIST.map(function (m) { return popItem({ act: 'vis-pick', data: ' data-vis="' + esc(m.id) + '"', label: esc(m.name), on: m.id === prefs.vis }); }).join('');
    h += '<hr><p class="mp-hint">' + (MEMBER ? 'Gilt auf allen deinen Geräten.' : 'Gilt in diesem Browser.') + '</p>';
    showPop(anchor, h);
  }
  // Menüleiste (VLC)
  var MENUS = {
    medien: function () {
      return [{ act: 'upload', label: '📤 Hochladen …', off: !lib.canUpload }, { act: 'yt-save', label: '💾 YouTube-Links speichern …', off: !lib.me || !CAN_YT },
        { act: 'new-playlist', label: '📃 Neue Playlist …', off: !lib.me }, '-', { act: 'q-save', label: 'Wiedergabeliste speichern …', off: !lib.me }, { act: 'q-clear', label: 'Wiedergabeliste leeren' }];
    },
    wiedergabe: function () {
      return [{ act: 'play', label: isPlaying() ? 'Pause' : 'Abspielen', key: 'Leertaste' }, { act: 'stop', label: 'Stopp' }, { act: 'prev', label: 'Zurück' }, { act: 'next', label: 'Weiter' }, '-',
        { act: 'shuffle', label: 'Zufällige Reihenfolge', on: prefs.shuffle, off: !!lob }, { act: 'repeat', label: 'Wiederholen: ' + { aus: 'aus', alle: 'alle', einen: 'diesen Titel' }[prefs.repeat], off: !!lob }];
    },
    audio: function () { return [{ act: 'eq', label: 'Equalizer …', on: player.eq.on }]; },
    ansicht: function () {
      var m = sideMode();
      return [{ act: 'side-open', label: 'Seitenleiste offen', on: m === 'open' }, { act: 'side-rail', label: 'Seitenleiste schmal', on: m === 'rail' }, { act: 'side-toggle', label: 'Seitenleiste aus', on: m === 'closed' }, '-',
        { act: 'big', label: 'Großes Bild statt Liste', on: !!prefs.big }, { act: 'theater', label: 'Theater' }, { act: 'fullscreen', label: 'Vollbild' }, { act: 'mini', label: 'Mini-Player', off: root.classList.contains('no-mini') }, '-',
        { act: 'skin-pop', label: '🎨 Aussehen …' }];
    },
    lobby: function () {
      return [{ act: 'lobby-new', label: 'Lobby öffnen …' }, { act: 'lobby-list', label: 'Alle Lobbys' }, '-',
        { act: 'lobby-link', label: '🔗 Einladungslink', off: !lob }, { act: 'lobby-settings', label: '⚙️ Einstellungen', off: !lob || !lobbyIsHost() }, { act: 'lobby-leave', label: '🚪 Verlassen', off: !lob }];
    },
  };
  function openMenu(b) {
    var items = MENUS[b.dataset.menu] ? MENUS[b.dataset.menu]() : [];
    showPop(b, items.map(popItem).join(''));
  }
  root.querySelector('.mp-menubar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-menu]');
    if (!b) return;
    e.stopPropagation();
    if (popFor === b && !pop.hidden) closePop(); else openMenu(b);
  });
  // Skin-Auswahl öffnet sich aus dem 🎨-Knopf; Escape schließt Menüs
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePop(); if (!eqBox.hidden) toggleEq(); } });

  // ---------- Equalizer (Web Audio, wirkt nicht auf YouTube) ----------
  var eqBox = $('mp-eq');
  var EQ_PRESETS = { flach: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0], hoehen: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7], pop: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1],
    rock: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5], klassik: [4, 3, 2, 1, 0, 0, 0, 1, 3, 4], sprache: [-4, -3, -1, 2, 4, 4, 3, 1, -1, -3] };
  var EQ_NAMES = { flach: 'Flach', bass: 'Mehr Bass', hoehen: 'Mehr Höhen', pop: 'Pop', rock: 'Rock', klassik: 'Klassik', sprache: 'Sprache' };
  function eqLabel(f) { return f >= 1000 ? f / 1000 + 'k' : String(f); }
  function renderEq() {
    var g = player.eq.g;
    var preset = Object.keys(EQ_PRESETS).filter(function (k) { return EQ_PRESETS[k].every(function (v, i) { return v === g[i]; }); })[0] || '';
    eqBox.classList.toggle('off', !player.eq.on);
    eqBox.innerHTML = '<div class="eq-tb"><span>🎚 Equalizer</span><button type="button" data-act="eq" title="Schließen" aria-label="Schließen">×</button></div>' +
      '<div class="eq-row"><label class="inline"><input type="checkbox" id="mp-eq-on"' + (player.eq.on ? ' checked' : '') + '> An</label>' +
      '<select id="mp-eq-preset" aria-label="Voreinstellung"><option value="">Eigene</option>' + Object.keys(EQ_PRESETS).map(function (k) {
        return '<option value="' + k + '"' + (k === preset ? ' selected' : '') + '>' + EQ_NAMES[k] + '</option>';
      }).join('') + '</select></div><div class="eq-bands">' + EQ_FREQ.map(function (f, i) {
        return '<label class="eq-band" title="' + eqLabel(f) + 'Hz: ' + g[i] + ' dB"><input type="range" class="vertical" min="-12" max="12" step="1" value="' + g[i] + '" data-band="' + i + '" aria-label="' + eqLabel(f) + ' Hertz">' + eqLabel(f) + '</label>';
      }).join('') + '</div><p class="eq-note">−12 bis +12 dB. Wirkt auf Musik und Videos aus der Bibliothek, nicht auf YouTube.</p>';
  }
  function toggleEq() {
    eqBox.hidden = !eqBox.hidden;
    if (!eqBox.hidden) { renderEq(); graph(); }
  }
  eqBox.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.band !== undefined) {
      player.eq.g[Number(t.dataset.band)] = Number(t.value);
      if (!player.eq.on) { player.eq.on = true; $('mp-eq-on').checked = true; eqBox.classList.remove('off'); }
      t.parentNode.title = eqLabel(EQ_FREQ[t.dataset.band]) + 'Hz: ' + t.value + ' dB';
      var p = $('mp-eq-preset');
      p.value = Object.keys(EQ_PRESETS).filter(function (k) { return EQ_PRESETS[k].every(function (v, i) { return v === player.eq.g[i]; }); })[0] || '';
    }
    applyEq(); savePlayer(); nowWa();
  });
  eqBox.addEventListener('change', function (e) {
    if (e.target.id === 'mp-eq-on') { player.eq.on = e.target.checked; eqBox.classList.toggle('off', !player.eq.on); }
    else if (e.target.id === 'mp-eq-preset' && EQ_PRESETS[e.target.value]) { player.eq.g = EQ_PRESETS[e.target.value].slice(); player.eq.on = true; renderEq(); }
    applyEq(); savePlayer(); nowWa();
  });

  // ---------- Handy: Reiter statt Seitenleisten ----------
  var tab = 'queue';
  function renderTabs() {
    root.dataset.tab = tab;
    root.querySelectorAll('.mp-tabs [data-tab]').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on)); b.classList.toggle('pressed', on);
    });
  }
  root.querySelector('.mp-tabs').addEventListener('click', function (e) {
    if (e.target.closest('[data-act=drawer]')) return;
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    var t = b.dataset.tab;
    if (t === 'lib') show(isLibView(view) ? view : 'all');
    else if (t === 'lobby') show(lob ? 'now' : 'lobbys');
    else { tab = 'queue'; renderTabs(); }
  });
  // Wechsel zwischen schmal und breit: Die Ansicht „Wiedergabe läuft“ gibt es auf dem Handy im Reiter „Lobby“
  narrow.addEventListener('change', function () {
    layout();
    if (isPhone()) { if (view === 'now' && !lob) view = 'all'; tab = view === 'now' || view === 'lobbys' ? 'lobby' : 'queue'; }
    render();
  });

  // ---------- Hochladen ----------
  function measure(file) {
    return new Promise(function (resolve) {
      var a = document.createElement('video'), url = URL.createObjectURL(file), done = function (d) { URL.revokeObjectURL(url); resolve(d); };
      a.preload = 'metadata'; a.muted = true;
      a.addEventListener('loadedmetadata', function () { done(isFinite(a.duration) ? a.duration : 0); });
      a.addEventListener('error', function () { done(0); });
      setTimeout(function () { done(0); }, 6000);
      a.src = url;
    });
  }
  function upload() {
    var q = lib.quota;
    dialog('📤 Musik und Videos hochladen',
      '<label>Dateien (MP3, OGG, WAV, FLAC, M4A, MP4, WebM …):<input type="file" name="files" multiple accept="audio/*,video/*,.mp3,.ogg,.oga,.opus,.wav,.flac,.m4a,.aac,.mp4,.m4v,.webm,.ogv,.mov"></label>' +
      '<label>Wer darf zusehen und zuhören?<select name="visibility">' + visOptions(lib.me && lib.me.admin ? 'public' : 'members') + '</select></label>' +
      '<p><small>Titel und Interpret kommen aus der Datei oder dem Dateinamen („Interpret - Titel.mp3“) und lassen sich danach ändern.' +
      (q ? ' Pro Datei höchstens ' + q.fileMb + ' MB, insgesamt ' + fmtSize(q.total) + ' (belegt: ' + fmtSize(q.used) + ').' : '') +
      ' Videos spielen am besten als MP4 (H.264) oder WebM. Lade nur hoch, was du teilen darfst. Nur öffentliche und für Mitglieder sichtbare Titel lassen sich in Lobbys abspielen.</small></p>',
      [{ label: 'Hochladen', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      var files = Array.prototype.slice.call(dlg.querySelector('[name=files]').files), visibility = field('visibility');
      if (r !== 'ok' || !files.length) return;
      var i = 0, ok = 0, errors = [];
      (function one() {
        if (i >= files.length) {
          status(ok + ' von ' + files.length + ' hochgeladen.' + (errors.length ? ' ⚠ ' + errors.join(' · ') : ''));
          load().then(function () { show('meine'); });
          return;
        }
        var f = files[i++];
        status('Lade ' + i + ' von ' + files.length + ' hoch: ' + f.name + ' …');
        measure(f).then(function (d) {
          var fd = new FormData();
          fd.append('visibility', visibility); fd.append('duration', d); fd.append('file', f);
          var x = new XMLHttpRequest();
          x.open('POST', '/musik/hochladen');
          x.setRequestHeader('x-csrf-token', CSRF);
          x.upload.addEventListener('progress', function (ev) { if (ev.lengthComputable) status('Lade ' + i + ' von ' + files.length + ' hoch: ' + f.name + ' … ' + Math.round(ev.loaded / ev.total * 100) + ' %'); });
          x.addEventListener('load', function () {
            var j = {}; try { j = JSON.parse(x.responseText); } catch (e) { /* leer */ }
            if (x.status < 400) ok++; else errors.push(f.name + ': ' + (j.error || 'Fehler ' + x.status));
            one();
          });
          x.addEventListener('error', function () { errors.push(f.name + ': Verbindung abgebrochen'); one(); });
          x.send(fd);
        });
      })();
    });
  }

  function editTrack(t) {
    dialog('✎ Titel bearbeiten',
      '<label>Titel:<input type="text" name="title" class="w100" maxlength="200" value="' + esc(t.title) + '"></label>' +
      '<label>' + (isYt(t) ? 'Kanal' : 'Interpret') + ':<input type="text" name="artist" class="w100" maxlength="200" value="' + esc(t.artist) + '"></label>' +
      '<label>Album:<input type="text" name="album" class="w100" maxlength="200" value="' + esc(t.album) + '"></label>' +
      '<label>Wer darf zusehen und zuhören?<select name="visibility">' + visOptions(t.visibility) + '</select></label>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      post('/musik/titel/' + t.id, { title: field('title'), artist: field('artist'), album: field('album'), visibility: field('visibility') })
        .then(function () { status('Gespeichert.'); return load(); }).catch(oops);
    });
  }
  function deleteTrack(t) {
    confirmBox('Titel löschen', '„' + esc(t.title) + '“ endgültig löschen? Er verschwindet auch aus allen Playlists.', 'Löschen').then(function (ok) {
      if (!ok) return;
      if (current && current.id === t.id) stopOwn();
      queue = queue.filter(function (q) { return q.id !== t.id || q === current; });
      cur = current ? queue.indexOf(current) : Math.min(cur, queue.length - 1);
      post('/musik/titel/' + t.id + '/loeschen').then(function () { status('Gelöscht.'); return load(); }).catch(oops);
    });
  }

  // ---------- Playlists ----------
  function newPlaylist(tracks) {
    if (!lib.me) { status('Bitte melde dich an, um Playlists anzulegen.'); return Promise.resolve(); }
    return dialog('📃 Neue Playlist',
      '<label>Name:<input type="text" name="title" class="w100" maxlength="100"></label>' +
      '<label>Wer darf sie sehen?<select name="visibility">' + visOptions('private') + '</select></label>',
      [{ label: 'Anlegen', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok' || !field('title').trim()) return;
      return post('/musik/playlists', { title: field('title'), visibility: field('visibility'), tracks: tracks })
        .then(function (j) { status('Playlist angelegt.'); return load().then(function () { show('pl:' + j.id); }); }).catch(oops);
    });
  }
  function toPlaylist(id) {
    var mine = lib.playlists.filter(function (p) { return p.mine; });
    var html = mine.length ? '<p>In welche Playlist?</p><div class="mp-picks">' + mine.map(function (p) {
      return '<button value="pl:' + p.id + '">📃 ' + esc(p.title) + ' <small>(' + p.tracks.length + ')</small></button>';
    }).join('') + '</div>' : '<p>Du hast noch keine Playlist.</p>';
    dialog('📃 Zur Playlist', html, [{ label: '➕ Neue Playlist …', value: 'new' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r === 'new') return newPlaylist([id]);
      addToPlaylist(/^pl:/.test(r) && playlist(r), id);
    });
  }
  function addToPlaylist(p, id) {
    if (!p || !p.mine) return;
    post('/musik/playlists/' + p.id, { tracks: p.tracks.concat(id) })
      .then(function () { status('„' + byId[id].title + '“ ist jetzt in „' + p.title + '“.'); return load(); }).catch(oops);
  }
  function changePlaylist(p, i, act) {
    var ids = filtered(viewTracks(view)).map(function (t) { return t.id; });
    if (filter) { status('Zum Sortieren erst die Suche leeren.'); return; }
    if (act === 'pl-remove') ids.splice(i, 1);
    else {
      var j = act === 'pl-up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      var x = ids[i]; ids[i] = ids[j]; ids[j] = x;
    }
    post('/musik/playlists/' + p.id, { tracks: ids }).then(load).catch(oops);
  }
  function editPlaylist(p) {
    dialog('✎ Playlist bearbeiten',
      '<label>Name:<input type="text" name="title" class="w100" maxlength="100" value="' + esc(p.title) + '"></label>' +
      '<label>Wer darf sie sehen?<select name="visibility">' + visOptions(p.visibility) + '</select></label>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      post('/musik/playlists/' + p.id, { title: field('title'), visibility: field('visibility') }).then(load).catch(oops);
    });
  }
  function deletePlaylist(p) {
    confirmBox('Playlist löschen', '„' + esc(p.title) + '“ löschen? Die Titel selbst bleiben erhalten.', 'Löschen').then(function (ok) {
      if (ok) post('/musik/playlists/' + p.id + '/loeschen').then(function () { view = 'all'; return load(); }).catch(oops);
    });
  }

  // ---------- Privat: Videos als Kacheln ----------
  // Vorschaubild ist ein Bild aus dem Video (Medienfragment #t=…), geladen erst, wenn die Kachel sichtbar wird
  var tileIo = null;
  function renderTiles(tracks) {
    var playingId = lob ? null : current && current.id;
    list.innerHTML = '<div class="mp-tiles">' + tracks.map(function (t, i) {
      var at = Math.max(1, Math.round((t.duration || 20) * 0.2));
      return '<div class="mp-tile' + (t.id === playingId ? ' playing' : '') + '" data-id="' + t.id + '" data-i="' + i + '">' +
        '<button type="button" class="mp-tthumb" data-act="tile-play" title="Abspielen"><video muted playsinline preload="none" data-src="/musik/stream/' + t.id + '#t=' + at + '"></video>' +
        '<span class="mp-tplay" aria-hidden="true">' + (t.id === playingId && isPlaying() ? '🔊' : '▶') + '</span>' + (t.duration ? '<span class="mp-tlen">' + fmt(t.duration) + '</span>' : '') + '</button>' +
        '<div class="mp-tname" title="' + esc(t.title) + '">' + esc(t.title) + '</div>' +
        '<div class="mp-tacts">' + (!lob ? '<button type="button" class="small" data-act="tile-queue" title="An die Wiedergabeliste hängen">➕</button>' : '') +
        (lib.me ? '<button type="button" class="small" data-act="tile-pl" title="Zu einer Playlist hinzufügen">📃</button>' : '') +
        (t.canEdit ? '<button type="button" class="small" data-act="tile-edit" title="Bearbeiten">✎</button>' : '') + '</div></div>';
    }).join('') + '</div>';
    var vids = [].slice.call(list.querySelectorAll('video[data-src]'));
    function loadV(v) { if (!v.src) { v.preload = 'metadata'; v.src = v.dataset.src; } }
    if (tileIo) tileIo.disconnect();
    if ('IntersectionObserver' in window) {
      tileIo = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { loadV(x.target); tileIo.unobserve(x.target); } }); }, { rootMargin: '200px' });
      vids.forEach(function (v) { tileIo.observe(v); });
    } else vids.forEach(loadV);
  }
  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act^=tile-]'), tile = b && b.closest('.mp-tile');
    if (!tile) return;
    var id = Number(tile.dataset.id), a = b.dataset.act;
    if (a === 'tile-play') { if (lob) lobbyAdd({ tracks: [id] }); else playList(listTracks(), Number(tile.dataset.i)); }
    else if (a === 'tile-queue') enqueue([byId[id]]);
    else if (a === 'tile-pl') toPlaylist(id);
    else if (a === 'tile-edit') editTrack(byId[id]);
  });

  // ---------- Internetradio ----------
  // Sender sind Name und Stream-Adresse (src/radio.js); der Ton kommt über den Server, damit Equalizer und Visualisierung greifen
  var RADIO_VIS = { public: 'Öffentlich', members: 'Nur angemeldete Nutzer', private: 'Nur ich (und der Admin)' };
  function station(id) { return lib.radio.filter(function (s) { return s.id === id; })[0] || null; }
  function radioItem(s) { return { radio: true, id: 'radio:' + s.id, sid: s.id, title: s.name, artist: s.host || '', album: 'Radio', duration: 0 }; }
  function radioHead() {
    head.innerHTML = '<div class="mp-title">' + sideBtn() + '<b>📻 Radio</b> <small>' + lib.radio.length + ' Sender · live, ohne Spulen</small></div>' +
      '<div class="mp-tools">' + (lib.canUpload ? '<button type="button" class="small" data-act="radio-add">➕ Sender hinzufügen …</button>' : '') +
      (lib.radio.length ? '' : '<span class="mp-hint">Noch keine Sender.' + (lib.canUpload ? ' Füge den Link eines Internetradios ein, z. B. eine .mp3-, .aac-, .pls- oder .m3u-Adresse.' : '') + '</span>') + '</div>' +
      (lob ? '<p class="mp-hint">🎧 Radio läuft nur in der eigenen Wiedergabe, nicht in einer Lobby.</p>' : '');
  }
  function renderRadio() {
    if (!lib.radio.length) { list.innerHTML = '<p class="mp-empty">Hier gibt es noch keine Sender.</p>'; return; }
    var playing = !lob && isRadio(current) ? current.sid : null;
    list.innerHTML = '<table class="list mp-table mp-radio"><thead><tr><th class="num">#</th><th>Sender</th><th>Adresse</th><th class="num">Gehört</th><th>Von</th><th></th></tr></thead><tbody>' +
      lib.radio.map(function (s, i) {
        var now = s.id === playing, acts = '';
        if (s.canEdit) acts = '<button type="button" class="small" data-act="radio-edit" title="Bearbeiten">✎</button><button type="button" class="small danger" data-act="radio-delete" title="Löschen">🗑</button>';
        return '<tr data-radio="' + s.id + '" class="' + (now ? 'playing' : '') + '"><td class="num">' + (now ? (isPlaying() ? '🔊' : '⏸') : i + 1) + '</td>' +
          '<td><span class="mp-ico" title="Radio">📻</span> <button type="button" class="mp-track" data-act="play">' + esc(s.name) + '</button>' +
          (s.visibility !== 'public' ? ' <small title="' + RADIO_VIS[s.visibility] + '">' + (s.visibility === 'private' ? '🔒' : '👥') + '</small>' : '') + '</td>' +
          '<td><small>' + esc(s.host) + '</small></td><td class="num">' + (s.plays || 0) + '</td><td class="mp-by">' + userLink(s.by, s.byUser) + '</td><td class="mp-acts">' + acts + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function radioAct(act, id) {
    var s = station(id);
    if (!s) return;
    if (act === 'play') {
      if (lob) { status('Radio läuft nur in der eigenen Wiedergabe. Verlasse dafür die Lobby.'); return; }
      // Ein Sender ersetzt die Wiedergabeliste nicht: er kommt nach vorn und läuft, bis man etwas anderes wählt
      var i = queue.findIndex(function (q) { return isRadio(q) && q.sid === id; });
      if (i < 0) { queue.splice(cur + 1, 0, qItem(radioItem(s))); i = cur + 1; }
      playAt(i);
    } else if (act === 'radio-edit') stationDialog(s);
    else if (act === 'radio-delete') {
      confirmBox('Sender löschen', '„' + esc(s.name) + '“ aus dem Radio löschen?', 'Löschen').then(function (ok) {
        if (!ok) return;
        if (isRadio(current) && current.sid === id) stopOwn();
        post('/musik/radio/' + id + '/loeschen').then(function (j) { lib.radio = j.radio; status('Gelöscht.'); render(); }).catch(oops);
      });
    }
  }
  function addStation() { if (lib.canUpload) stationDialog(null); }
  function stationDialog(s) {
    var vis = s ? s.visibility : lib.me && lib.me.admin ? 'public' : 'members';
    dialog(s ? '✎ Sender bearbeiten' : '📻 Sender hinzufügen',
      '<label>Name:<input type="text" name="name" class="w100" maxlength="80" value="' + esc(s ? s.name : '') + '" placeholder="z. B. Lieblingssender"></label>' +
      '<label>Stream-Link:<input type="url" name="url" class="w100" maxlength="500" placeholder="' + (s ? 'bisheriger Link: ' + esc(s.host) : 'https://… (.mp3, .aac, .pls, .m3u)') + '"></label>' +
      '<p><small>Den Link findest du meist auf der Seite des Senders unter „Webradio“, „Stream“ oder „Winamp/VLC“. Playlist-Dateien (.pls, .m3u) werden aufgelöst.' +
      (s ? ' Leer lassen, um den bisherigen Link zu behalten.' : '') + '</small></p>' +
      '<label>Wer darf zuhören?<select name="visibility">' + Object.keys(RADIO_VIS).map(function (k) { return '<option value="' + k + '"' + (k === vis ? ' selected' : '') + '>' + RADIO_VIS[k] + '</option>'; }).join('') + '</select></label>',
      [{ label: s ? 'Speichern' : 'Hinzufügen', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      var body = { name: field('name'), url: field('url'), visibility: field('visibility') };
      if (!s && !String(body.url || '').trim()) { status('⚠ Bitte einen Stream-Link einfügen.'); return; }
      status('Prüfe den Sender …');
      post(s ? '/musik/radio/' + s.id : '/musik/radio', body).then(function (j) {
        lib.radio = j.radio; status(s ? 'Gespeichert.' : 'Sender „' + body.name + '“ hinzugefügt.');
        if (!s) view = 'radio';
        render();
      }).catch(oops);
    });
  }

  // ---------- Lobbys ----------
  var lob = null, lobbies = [], lobbyTimer = null;
  function lobbyListHead() {
    return '<div class="mp-title"><b>🎧 Lobbys</b> <small>Gemeinsam hören und schauen: Alle in einer Lobby erleben denselben Titel zur selben Zeit.</small></div>' +
      '<div class="mp-tools"><input type="text" id="mp-lobby-name" maxlength="60" placeholder="Name der neuen Lobby">' +
      '<label class="inline"><input type="checkbox" id="mp-lobby-open" checked> Alle dürfen steuern</label>' +
      '<label class="inline"><input type="checkbox" id="mp-lobby-hidden"> Nur mit Link</label>' +
      '<button type="button" class="small" data-act="lobby-create">➕ Lobby öffnen</button><button type="button" class="small" data-act="lobby-refresh" title="Aktualisieren">🔄</button></div>';
  }
  // Offene Lobbys: alle 10 s in der Ansicht „Alle Lobbys“, sonst alle 15 s, solange die Gruppe in der Seitenleiste sichtbar ist
  function lobbiesShown() {
    if (!CAN_LOBBY || !lib.me || document.hidden) return false;
    if (view === 'lobbys') return true;
    var m = isPhone() ? (root.classList.contains('drawer') ? 'open' : 'closed') : sideMode();
    return m === 'rail' || (m === 'open' && player.shut.indexOf('lob') < 0);
  }
  function loadLobbies() {
    clearTimeout(lobbyTimer);
    if (!lobbiesShown()) return;
    req('GET', '/musik/lobbys').then(function (j) {
      var before = JSON.stringify(lobbies);
      lobbies = j.lobbies;
      if (view === 'lobbys') renderLobbies();
      if (JSON.stringify(lobbies) !== before) { renderSide(); renderTop(); }
    }).catch(function (e) { if (view === 'lobbys') oops(e); });
    lobbyTimer = setTimeout(loadLobbies, view === 'lobbys' ? 10000 : 15000);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loadLobbies(); });
  function renderLobbies() {
    if (!lobbies.length) { list.innerHTML = '<p class="mp-empty">Gerade ist keine Lobby offen. Öffne oben eine und lade andere mit dem Link ein.</p>'; return; }
    list.innerHTML = '<table class="list mp-table"><thead><tr><th>Lobby</th><th>Gastgeber</th><th class="num">👥</th><th>Läuft gerade</th><th></th></tr></thead><tbody>' +
      lobbies.map(function (l) {
        return '<tr data-lobby="' + esc(l.id) + '"><td><b>' + esc(l.name) + '</b>' + (l.hidden ? ' <small>🔗 nur mit Link</small>' : '') + '</td><td>' + esc(l.host) +
          '</td><td class="num">' + l.listeners + '</td><td>' + esc(l.now || '–') + '</td><td class="mp-acts"><button type="button" class="small" data-act="join">' +
          (lob && lob.id === l.id ? 'Ansehen' : 'Beitreten') + '</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function createLobby() {
    post('/musik/lobbys', { name: $('mp-lobby-name').value, open: $('mp-lobby-open').checked, hidden: $('mp-lobby-hidden').checked })
      .then(function (j) { joinLobby(j.id); }).catch(oops);
  }

  // In der Lobby ruht die eigene Wiedergabeliste; nach dem Verlassen geht es dort weiter
  function joinLobby(id) {
    if (!lib.me) { status('Für Lobbys musst du angemeldet sein.'); return; }
    if (lob && lob.id === id) { show('now'); return; }
    if (lob) leaveLobby(true);
    media.pause(); ytStop(); current = null;
    graph();
    lob = { id: id, state: null, offset: 0, key: null, meta: {}, ended: {} };
    lob.es = new EventSource('/musik/lobby/' + encodeURIComponent(id) + '/events');
    lob.es.addEventListener('state', function (e) { onLobbyState(JSON.parse(e.data)); });
    lob.es.addEventListener('ping', function (e) { if (lob) lob.offset = JSON.parse(e.data).now - Date.now(); });
    lob.es.addEventListener('closed', function () { leaveLobby(false, 'Die Lobby wurde geschlossen.'); });
    lob.es.addEventListener('error', function () {
      if (!lob) return;
      if (lob.es.readyState === 2) leaveLobby(false, 'Die Lobby gibt es nicht mehr.');
      else status('Verbindung zur Lobby unterbrochen, verbinde neu …');
    });
    lob.timer = setInterval(syncLobby, 1500);
    clearTimeout(lobbyTimer);
    status('Trete der Lobby bei …');
    show('now');
  }
  function leaveLobby(quiet, msg) {
    if (!lob) return;
    lob.es.close(); clearInterval(lob.timer);
    lob = null;
    media.pause(); media.removeAttribute('src'); media.load(); current = null;
    ytStop();
    overlay.hidden = true;
    nowPlaying();
    modeEl.textContent = '💿 Eigene Wiedergabe';
    renderLobbyBar(); nowWa();
    if (!quiet) { status(msg || 'Lobby verlassen.'); if (view === 'now') view = 'lobbys'; show(view); }
  }
  function onLobbyState(s) {
    if (!lob) return;
    var first = !lob.state;
    lob.state = s;
    lob.offset = s.now - Date.now();
    if (first) status('Du bist in der Lobby „' + s.name + '“.');
    modeEl.textContent = '🎧 ' + s.name + ' · ' + s.listeners.length + ' hören zu';
    renderSide(); renderQueue(); renderLobbyBar(); applyPicture(); updateButtons(); nowWa();
    if (view === 'now') renderHead();
    if (isLibView(view)) renderList();
    syncLobby();
  }
  function currentLobbyItem() { return lob && lob.state ? lob.state.queue[lob.state.index] || null : null; }
  function lobbyPos() { var s = lob.state; return s.playing ? Math.max(0, (Date.now() + lob.offset - s.startedAt) / 1000) : s.pausedPos; }
  function lobbyIsHost() { var s = lob && lob.state; return !!s && !!lib.me && (s.hostId === lib.me.id || lib.me.admin); }
  function lobbyCanControl() {
    var s = lob && lob.state;
    if (!s || !lib.me) return false;
    if (lobbyIsHost()) return true;
    var me = s.listeners.filter(function (u) { return u.id === lib.me.id; })[0];
    return me ? me.control : s.open;
  }
  function lobbyCtl(action, extra, quiet) {
    if (!lob) return Promise.resolve();
    return post('/musik/lobby/' + encodeURIComponent(lob.id), Object.assign({ action: action }, extra || {})).catch(function (e) { if (!quiet) oops(e); });
  }
  function lobbyAdd(what) {
    if (!lob) return;
    status('Füge hinzu …');
    post('/musik/lobby/' + encodeURIComponent(lob.id), Object.assign({ action: 'add' }, what)).then(function (j) { status(j.msg); }).catch(oops);
  }

  // Bringt Video oder YouTube-Player auf die Stelle, an der die Lobby gerade ist
  function syncLobby() {
    if (!lob || !lob.state) return;
    var s = lob.state, it = currentLobbyItem();
    if (lob.key !== (it && it.key)) { lob.key = it && it.key; nowPlaying(); applyPicture(); if (view === 'now') renderHead(); }
    if (!it) { media.pause(); ytStop(); return; }
    var target = lobbyPos();
    if (it.type === 'track') {
      ytStop();
      var src = '/musik/stream/' + it.trackId;
      if (media.getAttribute('src') !== src) { media.src = src; return; } // weiter nach loadedmetadata
      if (media.readyState < 1) return;
      if (it.duration && target >= it.duration) { if (!media.paused) media.pause(); return; } // der Server wechselt gleich
      if (Math.abs(media.currentTime - target) > 0.4) media.currentTime = target;
      if (s.playing && media.paused) {
        media.play().then(function () { overlay.hidden = true; }).catch(function () { blocked(); });
      } else if (!s.playing && !media.paused) media.pause();
      kick();
    } else {
      media.pause();
      if (!CAN_YT) { status('YouTube ist auf dieser Seite ausgeschaltet.'); return; }
      if (!ytAllowed()) { ytConsent(); return; }
      ytSync(it, target, s.playing);
    }
  }
  function blocked() {
    overlay.innerHTML = '<button type="button" data-act="unblock">🔈 Klicken zum Mithören</button>';
    overlay.hidden = false;
  }

  // Lobby-Leiste: in jeder Ansicht sichtbar, solange man in einer Lobby ist
  var lobbyBar = $('mp-lobbybar');
  function renderLobbyBar() {
    var s = lob && lob.state;
    lobbyBar.hidden = !lob;
    if (!lob) { lobbyBar.innerHTML = ''; return; }
    if (!s) { lobbyBar.innerHTML = '<span class="mp-live"></span><span class="lb-name">Lobby</span><span class="lb-meta">verbinde …</span>'; return; }
    var host = lobbyIsHost();
    lobbyBar.innerHTML = '<span class="mp-live" title="Du bist in dieser Lobby"></span><span class="lb-name">' + esc(s.name) + '</span><span class="lb-meta">Gastgeber ' + esc(s.host) + ' · ' +
      (s.open ? 'alle dürfen steuern' : 'nur der Gastgeber steuert') + '</span><span class="lb-users" title="Auf einen Namen klicken für mehr">' + s.listeners.map(function (u) {
        return '<button type="button" class="mp-user' + (lib.me && u.id === lib.me.id ? ' me' : '') + '" data-act="lobby-user" data-user="' + u.id + '">' +
          (u.host ? '👑 ' : u.control ? '🎶 ' : '') + esc(u.name) + '</button>';
      }).join('') + '</span><span class="lb-acts"><button type="button" class="small" data-act="lobby-link">🔗 Einladen</button>' +
      (host ? '<button type="button" class="small" data-act="lobby-settings" title="Einstellungen der Lobby">⚙️</button>' : '') +
      '<button type="button" class="small" data-act="lobby-leave">🚪 Verlassen</button>' +
      (host ? '<button type="button" class="small danger" data-act="lobby-close" title="Lobby für alle schließen">✖</button>' : '') + '</span>';
  }
  function copyLink() {
    var url = location.origin + '/musik?lobby=' + encodeURIComponent(lob.id);
    dialog('🔗 Einladungslink', '<p>Schick diesen Link an andere Mitglieder. Wer ihn öffnet, landet direkt in der Lobby.</p><input type="text" class="w100" name="link" readonly value="' + esc(url) + '">',
      [{ label: 'Kopieren', value: 'copy' }, { label: 'Schließen', value: 'cancel' }]).then(function (r) {
      if (r === 'copy' && navigator.clipboard) navigator.clipboard.writeText(url).then(function () { status('Link kopiert.'); }).catch(function () {});
    });
    var inp = dlg.querySelector('[name=link]');
    inp.select();
  }
  // Klick auf einen Zuhörer: dasselbe Nutzermenü wie am Blackjack-Tisch (public/usermenu.js), dazu die Player-Rechte
  function lobbyUser(id, e) {
    var s = lob.state, u = s.listeners.filter(function (x) { return x.id === id; })[0];
    if (!u || !u.user) return;
    var items = [];
    if (lobbyIsHost() && !u.host) items.push(u.control ? { label: '🚫 Player-Rechte entziehen', run: function () { lobbyCtl('rights', { user: u.id, allow: false }); } }
      : { label: '🎶 Player-Rechte geben', run: function () { lobbyCtl('rights', { user: u.id, allow: true }); } });
    var note = u.host ? '👑 Gastgeber dieser Lobby' : u.control ? '🎶 Darf den Player steuern und Titel hinzufügen' : '🎧 Hört zu';
    if (window.RetroUserMenu) window.RetroUserMenu.open(e, u.user, { note: note, items: items });
    else openPage(profileUrl(u.user));
  }
  function lobbySettings() {
    var s = lob.state;
    dialog('⚙️ Lobby-Einstellungen',
      '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(s.name) + '"></label>' +
      '<label class="inline"><input type="checkbox" name="open"' + (s.open ? ' checked' : '') + '> Alle dürfen steuern und Titel hinzufügen</label><br>' +
      '<label class="inline"><input type="checkbox" name="hidden"' + (s.hidden ? ' checked' : '') + '> Nicht in der Liste zeigen (nur mit Link)</label>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r === 'ok') lobbyCtl('settings', { name: field('name'), open: field('open'), hidden: field('hidden') });
    });
  }
  function closeLobby() {
    confirmBox('Lobby schließen', 'Die Lobby für alle schließen?', 'Schließen').then(function (ok) { if (ok) lobbyCtl('close'); });
  }

  // ---------- YouTube ----------
  // Ohne das Skript von YouTube: Der eingebettete Player lässt sich auch per postMessage steuern.
  // Geladen wird er erst nach einem Klick, denn dabei erfährt YouTube (Google) die IP-Adresse.
  var YT = 'https://www.youtube-nocookie.com', YT_KEY = 'youtube-erlaubt', ytOk = false, ytDone = false;
  var yt = { frame: null, ready: false, videoId: null, state: -1, time: 0, timeAt: 0, duration: 0, title: '', tries: 0 };
  function ytAllowed() { if (ytOk) return true; try { return localStorage.getItem(YT_KEY) === '1'; } catch (e) { return false; } }
  function ytConsent() {
    ytBox.hidden = true;
    overlay.innerHTML = '<div class="mp-consent"><p><b>▶️ Dieser Titel kommt von YouTube.</b></p><p>Zum Abspielen lädt dein Browser den Player von youtube-nocookie.com. ' +
      'Dabei bekommt YouTube (Google) deine IP-Adresse und Angaben zu deinem Browser. Bei YouTube-Videos gibt es keine Visualisierung.</p>' +
      '<button type="button" data-act="yt-allow">YouTube laden</button> <label class="inline"><input type="checkbox" id="mp-yt-remember"> Für diesen Browser merken</label></div>';
    overlay.hidden = false;
  }
  function allowYoutube() {
    ytOk = true;
    if ($('mp-yt-remember') && $('mp-yt-remember').checked) { try { localStorage.setItem(YT_KEY, '1'); } catch (e) { /* nur für jetzt */ } }
    overlay.hidden = true;
    if (lob) syncLobby(); else if (isYt(current)) ytPlayLocal(current);
  }
  function ytCmd(func, args, frame) {
    var f = frame || yt.frame;
    if (f && f.contentWindow) f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [], id: 1, channel: 'widget' }), YT);
  }
  function listen(frame, isReady) {
    var n = 0;
    (function again() {
      if (isReady() || n++ > 40 || !frame.contentWindow) return;
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT);
      setTimeout(again, 250);
    })();
  }
  function ytUrl(path, params) {
    var q = Object.assign({ enablejsapi: 1, playsinline: 1, rel: 0, iv_load_policy: 3, origin: location.origin }, params);
    return YT + '/embed/' + path + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
  }
  function ytLoad(videoId, start) {
    yt.videoId = videoId; yt.duration = 0; yt.title = ''; yt.time = start; yt.timeAt = Date.now(); yt.state = -1;
    if (yt.frame && yt.ready) { ytCmd('loadVideoById', [{ videoId: videoId, startSeconds: start }]); return; }
    if (yt.frame) yt.frame.remove();
    yt.ready = false;
    var f = yt.frame = document.createElement('iframe');
    f.title = 'YouTube-Player';
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.src = ytUrl(videoId, { autoplay: 1, controls: 0, disablekb: 1, start: Math.floor(start) });
    f.addEventListener('load', function () { listen(f, function () { return yt.ready || yt.frame !== f; }); });
    ytBox.innerHTML = '';
    ytBox.appendChild(f);
    // Durchsichtige Scheibe über dem Video: sonst schluckt der YouTube-Player den Klick und pausiert nur bei sich,
    // die Lobby spielt dann gleich weiter
    var shield = document.createElement('div');
    shield.className = 'mp-yt-shield';
    ytBox.appendChild(shield);
  }
  // Eigene Wiedergabe: YouTube-Video von vorn
  function ytPlayLocal(it) {
    ytDone = false;
    if (!CAN_YT) { status('YouTube ist auf dieser Seite ausgeschaltet.'); return; }
    if (!ytAllowed()) { ytConsent(); return; }
    ytBox.hidden = false;
    if (yt.frame && yt.videoId === it.videoId) { ytCmd('seekTo', [0, true]); ytCmd('playVideo'); }
    else ytLoad(it.videoId, 0);
  }
  function ytSync(it, target, playing) {
    ytBox.hidden = false;
    if (yt.videoId !== it.videoId || !yt.frame) { ytLoad(it.videoId, target); return; }
    if (!yt.ready) return;
    var est = ytNow();
    if (playing) {
      if (yt.state !== 1 && yt.state !== 3) ytCmd('playVideo');
      if (Math.abs(est - target) > 2.5) ytCmd('seekTo', [target, true]);
    } else {
      if (yt.state === 1 || yt.state === 3) ytCmd('pauseVideo');
      if (Math.abs(yt.time - target) > 1.5) ytCmd('seekTo', [target, true]);
    }
    // Länge (und notfalls Titel) an die Lobby melden, damit sie das nächste Lied pünktlich startet
    if (yt.duration && (!it.duration || it.guessed) && !lob.meta[it.key]) {
      lob.meta[it.key] = true;
      lobbyCtl('meta', { key: it.key, duration: yt.duration, title: yt.title }, true);
    }
  }
  function ytStop() {
    if (yt.frame && yt.ready) ytCmd('pauseVideo');
    ytBox.hidden = true;
  }
  // Länge und Titel vom YouTube-Player übernehmen (eigene Wiedergabe)
  function ytLearned() {
    if (lob || !isYt(current)) return;
    var changed = false;
    if (yt.duration && !current.duration) { current.duration = Math.round(yt.duration); changed = true; }
    if (yt.title && current.guessed) { current.title = yt.title; current.guessed = false; nowPlaying(); changed = true; }
    if (changed) { renderQueue(); if (view === 'now') renderHead(); }
  }
  var ytLists = [];
  window.addEventListener('message', function (e) {
    if (e.origin !== YT || typeof e.data !== 'string') return;
    var d;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    var pl = ytLists.filter(function (x) { return x.frame.contentWindow === e.source; })[0];
    if (pl) { if (d.info && d.info.playlist && d.info.playlist.length) pl.done(d.info.playlist); return; }
    if (!yt.frame || e.source !== yt.frame.contentWindow) return;
    var was = yt.state;
    if (d.event === 'onReady') { yt.ready = true; applyVolume(); syncLobby(); }
    if (d.event === 'onStateChange') yt.state = d.info;
    if (d.event === 'onError') {
      status('⚠ Dieses YouTube-Video lässt sich hier nicht abspielen (gesperrt oder gelöscht).');
      setTimeout(function () { if (lob) ytEnded(); else if (isYt(current) && !ytDone) { ytDone = true; skipBroken(); } }, 2000);
    }
    if (d.event === 'infoDelivery' && d.info) {
      var i = d.info;
      if (typeof i.currentTime === 'number') { yt.time = i.currentTime; yt.timeAt = Date.now(); }
      if (typeof i.playerState === 'number') yt.state = i.playerState;
      if (i.duration) yt.duration = i.duration;
      if (i.videoData && i.videoData.title) yt.title = i.videoData.title;
      ytLearned();
    }
    if (yt.state !== was) {
      if (yt.state === 0) ytEnded();
      if (!lob) { updateButtons(); renderSoon(); }
    }
  });
  function ytEnded() {
    if (lob) {
      var it = currentLobbyItem();
      if (it && it.type === 'yt' && !lob.ended[it.key]) { lob.ended[it.key] = true; lobbyCtl('ended', { key: it.key }, true); }
      return;
    }
    if (!isYt(current) || ytDone) return;
    ytDone = true;
    countPlay();
    next(true);
  }
  // Videos einer YouTube-Playlist liest ein unsichtbarer Player aus
  function ytPlaylist(listId) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe'), entry;
      f.className = 'mp-yt-probe'; f.title = 'YouTube-Playlist';
      f.src = ytUrl('videoseries', { list: listId, autoplay: 0, mute: 1 });
      var timer = setTimeout(function () { finish(null); }, 15000);
      function finish(ids) {
        clearTimeout(timer); f.remove();
        ytLists.splice(ytLists.indexOf(entry), 1);
        if (ids) resolve(ids); else reject(new Error('Die YouTube-Playlist ließ sich nicht lesen. Ist sie öffentlich?'));
      }
      entry = { frame: f, done: finish, ready: false };
      ytLists.push(entry);
      f.addEventListener('load', function () { listen(f, function () { return ytLists.indexOf(entry) < 0; }); });
      document.body.appendChild(f);
    });
  }
  function parseYoutube(text) {
    var videos = [], lists = [];
    String(text).split(/\s+/).filter(Boolean).forEach(function (tok) {
      if (/^[\w-]{11}$/.test(tok)) { videos.push(tok); return; }
      var u;
      try { u = new URL(/^https?:/i.test(tok) ? tok : 'https://' + tok); } catch (e) { return; }
      if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(u.hostname)) return;
      var list = u.searchParams.get('list'), v = u.searchParams.get('v');
      var m = u.hostname.replace(/^www\./, '') === 'youtu.be' ? u.pathname.match(/^\/([\w-]{11})/) : u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (list && /^[\w-]{10,64}$/.test(list)) lists.push(list);
      else if (v && /^[\w-]{11}$/.test(v)) videos.push(v);
      else if (m) videos.push(m[1]);
    });
    return { videos: videos, lists: lists };
  }
  // Links (auch Playlists) in Video-Kennungen auflösen
  function youtubeIds(text) {
    var p = parseYoutube(text);
    if (!p.videos.length && !p.lists.length) return Promise.reject(new Error('Das sieht nicht nach einem YouTube-Link aus.'));
    if (p.lists.length && !ytAllowed()) { ytConsent(); return Promise.reject(new Error('Zum Einlesen einer Playlist muss der YouTube-Player geladen werden.')); }
    status('Lese YouTube-Links …');
    return p.lists.reduce(function (chain, id) {
      return chain.then(function (all) { return ytPlaylist(id).then(function (ids) { return all.concat(ids); }); });
    }, Promise.resolve([])).then(function (fromLists) { return p.videos.concat(fromLists); });
  }
  // YouTube-Link in die Wiedergabeliste: in der Lobby für alle, sonst nur hier im Browser (ohne zu speichern)
  function addYoutube() {
    var inp = $('mp-yt-url');
    if (!inp) return;
    youtubeIds(inp.value).then(function (ids) {
      if (lob) { inp.value = ''; lobbyAdd({ youtube: ids }); return; }
      return post('/musik/youtube', { ids: ids, save: false }).then(function (j) {
        var box = $('mp-yt-url');
        if (box) box.value = '';
        enqueue(j.items.map(function (it) { return { kind: 'youtube', videoId: it.videoId, title: it.title, artist: it.artist, duration: 0, guessed: it.guessed }; }));
      });
    }).catch(oops);
  }
  // YouTube-Links dauerhaft in der Bibliothek ablegen
  function saveYoutube() {
    dialog('💾 YouTube-Links speichern',
      '<label>Links zu Videos oder Playlists (mehrere mit Leerzeichen oder Zeilenumbruch trennen):<textarea name="links" class="w100" rows="4"></textarea></label>' +
      '<label>Wer darf sie sehen?<select name="visibility">' + visOptions('members') + '</select></label>' +
      '<p><small>Gespeichert werden nur die Video-Kennung, der Titel und der Kanal. Abgespielt wird über youtube-nocookie.com.</small></p>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      var text = field('links'), visibility = field('visibility');
      if (r !== 'ok' || !text.trim()) return;
      youtubeIds(text).then(function (ids) { return post('/musik/youtube', { ids: ids, save: true, visibility: visibility }); })
        .then(function (j) { status(j.tracks.length + ' YouTube-' + (j.tracks.length === 1 ? 'Link' : 'Links') + ' in der Bibliothek.'); return load(); })
        .then(function () { kindF = 'youtube'; show('all'); }).catch(oops);
    });
  }

  // ---------- Jellyfin (src/jellyfin.js) ----------
  // Eigene Gruppe in der Seitenleiste mit den Ansichten jf:start, jf:weiter, jf:neu, jf:filme, jf:serien, jf:liste, jf:suche
  // und jf:serie:<id>. Cover kommen als Kacheln in die Liste, rechts stehen statt der Wiedergabeliste die Angaben zum
  // gewählten Titel (Skins ohne rechte Spalte zeigen sie als Dialog). Abgespielt wird im normalen Bild, über hls.js,
  // wenn Jellyfin umwandeln muss; Fortschritt und „gesehen“ gehen ins eigene Jellyfin-Konto.
  var JF = { st: null, data: {}, items: {}, det: null, q: '', sort: 'neu', filter: '', genre: '', genres: {}, show: null, season: null, eps: null, hls: null, play: null, saved: 0, busy: false };
  var JF_VIEWS = { 'jf:start': 'Start', 'jf:weiter': 'Weiterschauen', 'jf:neu': 'Neu hinzugefügt', 'jf:filme': 'Filme', 'jf:serien': 'Serien', 'jf:liste': 'Meine Liste', 'jf:suche': 'Suche' };
  var JF_SORT = { neu: 'Neu hinzugefügt', name: 'Name', jahr: 'Jahr', bewertung: 'Bewertung', zufall: 'Zufällig' };
  var JF_RATES = [[0, 'Auto (20 Mbit/s)'], [8e6, '8 Mbit/s (1080p)'], [4e6, '4 Mbit/s (720p)'], [2e6, '2 Mbit/s (sparsam)']];
  function isJfView(key) { return /^jf:/.test(key === undefined ? view : key); }
  function isJf(it) { return !!it && !!it.jf; }
  function jfLoad() { return req('GET', '/jellyfin/status').then(function (s) { JF.st = s; }).catch(function () { JF.st = null; }); }
  function jfImg(id, w) { return '/jellyfin/bild/' + id + '?w=' + (w || 240); }
  function jfRemember(list) { (list || []).forEach(function (x) { JF.items[x.id] = x; }); return list || []; }
  function jfEp(x) { return x.season != null ? 'S' + x.season + ' F' + (x.episode != null ? x.episode : '?') : ''; }
  function jfTitle(x) { return x.type === 'Episode' ? x.series + ' – ' + jfEp(x) + ' ' + x.name : x.name; }
  function jfYears(x) { return x.year ? x.year + (x.type === 'Series' ? (x.endYear && x.endYear !== x.year ? '–' + x.endYear : x.status === 'Continuing' ? '–' : '') : '') : ''; }
  function jfMin(sec) { var m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + ' Std. ' + (m % 60) + ' Min.' : m + ' Min.'; }
  function jfGroup() {
    var s = JF.st;
    if (!s || !s.on || (!s.browse && !s.canRequest && s.state !== 'pending')) return null;
    var c = (JF.data.home && JF.data.home.counts) || {}, items = [];
    if (s.browse) {
      items.push({ ic: '🏠', label: 'Start', go: 'jf:start' });
      if (s.play) items.push({ ic: '⏯️', label: 'Weiterschauen', go: 'jf:weiter' });
      items.push({ ic: '🆕', label: 'Neu hinzugefügt', go: 'jf:neu' }, { ic: '🎞️', label: 'Filme', go: 'jf:filme', n: c.movies }, { ic: '📺', label: 'Serien', go: 'jf:serien', n: c.series });
      if (s.play) items.push({ ic: '⭐', label: 'Meine Liste', go: 'jf:liste' });
    }
    if (!s.play && (s.canRequest || s.state === 'pending')) items.push({ ic: '🔑', label: s.state === 'pending' ? 'Anfrage liegt beim Admin' : 'Zugang anfragen …', act: 'jf-request' });
    if (s.app) items.push({ ic: '📱', label: 'Jellyfin-App …', act: 'jf-app' });
    items.forEach(function (o) { o.on = !!o.go && (view === o.go || (o.go === 'jf:serien' && /^jf:serie:/.test(view))); });
    return { id: 'jf', ic: '🎬', label: s.name || 'Jellyfin', items: items, badge: s.play ? '' : '🔒' };
  }

  // Daten zur Ansicht holen und zeichnen
  function jfQuery(key) {
    var q = { sort: JF.sort, filter: JF.filter, genre: JF.genre, q: JF.q };
    if (key === 'jf:filme') q.type = 'Movie';
    else if (key === 'jf:serien') q.type = 'Series';
    else if (key === 'jf:neu') { q.type = 'all'; q.sort = 'neu'; q.filter = ''; q.genre = ''; q.q = ''; }
    else if (key === 'jf:liste') { q.type = 'all'; q.filter = 'liste'; q.genre = ''; }
    else if (key === 'jf:suche') { q.type = 'all'; q.genre = ''; q.filter = ''; }
    return q;
  }
  function jfEnter(key, more) {
    if (key === 'jf:start' || key === 'jf:weiter') {
      JF.busy = !JF.data.home; renderList();
      return req('GET', '/jellyfin/start').then(function (d) {
        jfRemember(d.movies); jfRemember(d.episodes); jfRemember(d.resume);
        JF.data.home = d; JF.busy = false;
        if (view === key) { renderSide(); renderHead(); renderList(); }
      }).catch(function (e) { JF.busy = false; oops(e); renderList(); });
    }
    var m = /^jf:serie:(\w+)$/.exec(key);
    if (m) return jfSeries(m[1]);
    var q = jfQuery(key), old = more && JF.data[key];
    q.start = old ? old.items.length : 0;
    var qs = Object.keys(q).filter(function (k) { return q[k] !== '' && q[k] != null; }).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    if (!old) { JF.busy = true; renderList(); }
    if ((key === 'jf:filme' || key === 'jf:serien') && !JF.genres[q.type]) {
      req('GET', '/jellyfin/genres?type=' + q.type).then(function (g) { JF.genres[q.type] = g.genres; if (view === key) renderHead(); }).catch(function () {});
    }
    return req('GET', '/jellyfin/liste?' + qs).then(function (d) {
      jfRemember(d.items);
      JF.data[key] = old ? { items: old.items.concat(d.items), total: d.total } : d;
      JF.busy = false;
      if (view === key) { renderHead(); renderList(); }
    }).catch(function (e) { JF.busy = false; oops(e); renderList(); });
  }
  function jfSeries(id) {
    JF.busy = true; renderList();
    return req('GET', '/jellyfin/titel/' + id).then(function (d) {
      JF.show = d; JF.det = d;
      var s = (d.next && d.seasons.filter(function (x) { return x.id === d.next.seasonId; })[0]) || d.seasons[0];
      return jfSeason(s ? s.id : '');
    }).catch(function (e) { JF.busy = false; oops(e); renderList(); });
  }
  function jfSeason(sid) {
    JF.season = sid;
    return req('GET', '/jellyfin/folgen/' + JF.show.id + (sid ? '?staffel=' + sid : '')).then(function (d) {
      JF.eps = jfRemember(d.items); JF.busy = false;
      if (/^jf:serie:/.test(view)) { renderHead(); renderList(); renderQueue(); }
    });
  }
  function jfCounts() {
    var c = JF.data.home && JF.data.home.counts;
    return c ? c.movies + ' Filme · ' + c.series + ' Serien' : '';
  }
  function jfHead() {
    var s = JF.st || {}, h;
    if (/^jf:serie:/.test(view)) {
      var x = JF.show;
      h = '<div class="mp-title">' + sideBtn() + '<button type="button" class="small" data-go="jf:serien">◀ Serien</button> <b>📺 ' + esc(x ? x.name : 'Serie') + '</b> <small>' +
        (x ? [x.seasons.length + (x.seasons.length === 1 ? ' Staffel' : ' Staffeln'), jfYears(x), x.age].filter(Boolean).join(' · ') : '') + '</small></div>';
      if (x) {
        h += '<div class="mp-tools"><span class="mp-chips" role="group" aria-label="Staffel">' + x.seasons.map(function (z) {
          return '<button type="button" data-act="jf-season" data-id="' + z.id + '" class="' + (JF.season === z.id ? 'on' : '') + '">' + esc(z.name) + '</button>';
        }).join('') + '</span>';
        if (s.play && x.next) h += '<button type="button" class="small" data-act="jf-play" data-id="' + x.next.id + '">▶ Weiter mit ' + esc(jfEp(x.next)) + '</button>';
        if (s.play && JF.eps && JF.eps.length) h += '<button type="button" class="small" data-act="jf-queue-season">➕ Staffel anhängen</button>';
        h += '</div>';
      }
      head.innerHTML = h;
      return;
    }
    var key = view, d = JF.data[key], title = { 'jf:start': '🎬 ' + esc(s.name || 'Jellyfin'), 'jf:weiter': '⏯️ Weiterschauen', 'jf:neu': '🆕 Neu hinzugefügt', 'jf:filme': '🎞️ Filme', 'jf:serien': '📺 Serien', 'jf:liste': '⭐ Meine Liste', 'jf:suche': '🔍 Suche' }[key];
    var sub = key === 'jf:start' ? jfCounts() : d ? d.total + ' Titel' : '';
    h = '<div class="mp-title">' + sideBtn() + '<b>' + title + '</b> <small>' + esc(sub) + '</small></div><div class="mp-tools">';
    if (key === 'jf:filme' || key === 'jf:serien') {
      var type = key === 'jf:filme' ? 'Movie' : 'Series';
      if (s.play) h += '<span class="mp-chips" role="group" aria-label="Filter">' + [['', 'Alle'], ['ungesehen', 'Ungesehen'], ['liste', '⭐ Meine Liste']].map(function (o) {
        return '<button type="button" data-act="jf-filter" data-v="' + o[0] + '" class="' + (JF.filter === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</span>';
      h += '<input type="search" id="jf-q" placeholder="🔍 Suchen" aria-label="Suchen" value="' + esc(JF.q) + '">' +
        '<select id="jf-genre" aria-label="Genre"><option value="">Genre: alle</option>' + (JF.genres[type] || []).map(function (g) { return '<option' + (JF.genre === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select>' +
        '<select id="jf-sort" aria-label="Sortieren">' + Object.keys(JF_SORT).map(function (k) { return '<option value="' + k + '"' + (JF.sort === k ? ' selected' : '') + '>Sortieren: ' + JF_SORT[k] + '</option>'; }).join('') + '</select>';
    } else h += '<input type="search" id="jf-q" placeholder="🔍 Filme und Serien durchsuchen" aria-label="Filme und Serien durchsuchen" value="' + esc(key === 'jf:suche' ? JF.q : '') + '">';
    if (!s.play && s.browse) h += '<span class="mp-hint jf-lock">🔒 ' + (s.state === 'pending' ? 'Deine Anfrage liegt beim Admin.' : s.canRequest ? 'Zum Abspielen <button type="button" class="small" data-act="jf-request">Zugang anfragen …</button>' : 'Abspielen geht nur mit Freigabe.') + '</span>';
    head.innerHTML = h + '</div>';
    var qi = $('jf-q'), timer = null;
    if (qi) qi.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        JF.q = qi.value.trim();
        if (key === 'jf:filme' || key === 'jf:serien') { delete JF.data[key]; jfEnter(key); }
        else if (JF.q) { delete JF.data['jf:suche']; if (view !== 'jf:suche') show('jf:suche'); else jfEnter('jf:suche'); setTimeout(function () { var n = $('jf-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0); }
      }, 350);
    });
    ['jf-genre', 'jf-sort'].forEach(function (idn) {
      var el = $(idn);
      if (el) el.addEventListener('change', function () { if (idn === 'jf-genre') JF.genre = el.value; else JF.sort = el.value; delete JF.data[key]; jfEnter(key); });
    });
  }
  function jfIsNew(x) { return x.added && Date.now() / 1000 - x.added < 7 * 86400; }
  function jfCard(x, wide) {
    var prog = x.pos && x.runtime ? Math.max(2, Math.min(100, Math.round(x.pos / x.runtime * 100))) : 0;
    var img = x.type === 'Episode' && !wide ? x.seriesImg || x.img : x.img;
    var name = x.type === 'Episode' ? (wide ? x.series + ' · ' + jfEp(x) : x.series) : x.name;
    var sub = x.type === 'Episode' ? (wide ? x.name : jfEp(x) + ' ' + x.name) : wide && x.runtime && x.pos ? 'noch ' + jfMin(x.runtime - x.pos) : jfYears(x);
    return '<button type="button" class="jf-card' + (JF.det && JF.det.id === x.id ? ' sel' : '') + '" data-act="jf-open" data-id="' + x.id + '" title="' + esc(jfTitle(x)) + '">' +
      '<span class="jf-poster' + (wide ? ' wide' : '') + '" style="--h:' + hue(x.series || x.name) + '">' + '<span class="jf-pt">' + esc(x.series || x.name) + '</span>' +
      (img ? '<img loading="lazy" alt="" src="' + jfImg(img, wide ? 400 : 240) + '">' : '') +
      (x.played ? '<span class="seen" title="Gesehen">✓</span>' : x.unplayed ? '<span class="cnt" title="Ungesehene Folgen">' + x.unplayed + '</span>' : '') +
      (jfIsNew(x) ? '<span class="new">NEU</span>' : '') + (prog ? '<span class="bar"><i style="width:' + prog + '%"></i></span>' : '') + '</span>' +
      '<span class="t">' + esc(name) + '</span><span class="y">' + esc(String(sub || '')) + '</span></button>';
  }
  function jfList() {
    if (JF.busy) { list.innerHTML = '<p class="mp-empty">Lade von Jellyfin …</p>'; return; }
    if (/^jf:serie:/.test(view)) { jfEpisodes(); return; }
    if (view === 'jf:start' || view === 'jf:weiter') {
      var d = JF.data.home;
      if (!d) { list.innerHTML = '<p class="mp-empty">Lade von Jellyfin …</p>'; return; }
      if (view === 'jf:weiter') {
        list.innerHTML = d.resume.length ? '<div class="jf-grid wide">' + d.resume.map(function (x) { return jfCard(x, true); }).join('') + '</div>' : '<p class="mp-empty">Nichts angefangen. Such dir was aus! 🍿</p>';
        return;
      }
      var row = function (ic, title, items, wide, go) {
        return items.length ? '<div class="jf-row-h">' + ic + ' ' + title + (go ? '<button type="button" class="small" data-go="' + go + '">Alle ›</button>' : '') + '</div><div class="jf-row' + (wide ? ' wide' : '') + '">' + items.map(function (x) { return jfCard(x, wide); }).join('') + '</div>' : '';
      };
      list.innerHTML = '<div class="jf-home">' + row('⏯️', 'Weiterschauen', d.resume, true, d.resume.length > 4 ? 'jf:weiter' : '') + row('🆕', 'Neue Filme', d.movies, false, 'jf:filme') + row('📺', 'Neue Folgen', d.episodes, false, 'jf:serien') + '</div>' ||
        '<p class="mp-empty">In Jellyfin ist noch nichts.</p>';
      return;
    }
    var dd = JF.data[view];
    if (!dd) { list.innerHTML = '<p class="mp-empty">Lade von Jellyfin …</p>'; return; }
    if (!dd.items.length) { list.innerHTML = '<p class="mp-empty">' + (view === 'jf:liste' ? 'Auf deiner Liste steht noch nichts. Merk dir Titel mit ⭐.' : 'Nichts gefunden.') + '</p>'; return; }
    list.innerHTML = '<div class="jf-grid">' + dd.items.map(function (x) { return jfCard(x, false); }).join('') + '</div>' +
      (dd.items.length < dd.total ? '<p class="jf-more"><button type="button" class="small" data-act="jf-more">Mehr laden (' + (dd.total - dd.items.length) + ' weitere)</button></p>' : '');
  }
  function jfEpisodes() {
    var s = JF.st || {}, eps = JF.eps || [], playingId = isJf(current) ? current.jfId : null;
    if (!eps.length) { list.innerHTML = '<p class="mp-empty">In dieser Staffel ist nichts.</p>'; return; }
    list.innerHTML = '<table class="list mp-table jf-ep"><thead><tr><th class="num">#</th><th></th><th>Folge</th><th class="num">Länge</th><th></th></tr></thead><tbody>' + eps.map(function (x) {
      var prog = x.pos && x.runtime ? Math.max(2, Math.min(100, Math.round(x.pos / x.runtime * 100))) : 0, now = x.id === playingId;
      return '<tr class="' + (now ? 'playing' : JF.det && JF.det.id === x.id ? 'sel' : '') + '" data-act="jf-open" data-id="' + x.id + '"><td class="num">' + (now ? (isPlaying() ? '🔊' : '⏸') : x.episode != null ? x.episode : '') + '</td>' +
        '<td class="thumb"><span class="jf-poster wide" style="--h:' + hue(x.name) + '">' + (x.img ? '<img loading="lazy" alt="" src="' + jfImg(x.img, 200) + '">' : '') +
        (prog ? '<span class="bar"><i style="width:' + prog + '%"></i></span>' : '') + '</span></td>' +
        '<td><b>' + esc(x.name) + '</b><div class="d">' + esc(x.overview.slice(0, 220)) + '</div></td><td class="num">' + (x.runtime ? fmt(x.runtime) : '') + '</td>' +
        '<td class="nowrap">' + (x.played ? '✓ ' : '') + (s.play ? '<button type="button" class="small" data-act="jf-play" data-id="' + x.id + '" title="Abspielen">▶</button>' : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  // Angaben zum gewählten Titel: rechts in der Spalte der Wiedergabeliste, sonst als Dialog
  function jfDetailHtml(x) {
    var s = JF.st || {}, h = '<div class="jf-det">';
    h += '<span class="jf-poster" style="--h:' + hue(x.series || x.name) + '"><span class="jf-pt">' + esc(x.series || x.name) + '</span>' + (x.img ? '<img alt="" src="' + jfImg(x.img, 320) + '">' : '') +
      (x.pos && x.runtime ? '<span class="bar"><i style="width:' + Math.max(2, Math.round(x.pos / x.runtime * 100)) + '%"></i></span>' : '') + (s.play ? '' : '<span class="lock">🔒</span>') + '</span>';
    h += '<h3>' + esc(x.type === 'Episode' ? x.name : x.name) + '</h3>';
    if (x.type === 'Episode') h += '<div class="meta">' + esc(x.series + ' · ' + jfEp(x)) + '</div>';
    h += '<div class="meta">' + [jfYears(x), x.runtime ? jfMin(x.runtime) : '', x.age, x.rating ? '★ ' + String(x.rating).replace('.', ',') : '', x.type === 'Series' && x.count ? x.count + ' Staffeln' : ''].filter(Boolean).map(esc).join(' · ') + '</div>';
    var tags = (x.genres || []).slice();
    if (x.video) { if (x.video.height >= 2000) tags.push('4K'); else if (x.video.height >= 1000) tags.push('HD'); if (x.video.hdr) tags.push(x.video.hdr); }
    if (tags.length) h += '<div class="tags">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>';
    if (x.overview) h += '<p>' + esc(x.overview) + '</p>';
    if (x.type === 'Series' && s.play) h += '<table><tr><td>Weiter mit</td><td>' + (x.next ? esc(jfEp(x.next) + ' „' + x.next.name + '“') + (x.next.pos ? ' (ab ' + fmt(x.next.pos) + ')' : '') : 'alles gesehen 🎉') + '</td></tr></table>';
    return h + '</div>';
  }
  function jfActsHtml(x) {
    var s = JF.st || {}, h = '<div class="jf-acts">';
    if (!s.play) {
      if (s.canRequest) h += '<button type="button" class="big" data-act="jf-request">🔑 Zugang anfragen …</button><div class="jf-note">Ansehen können nur freigegebene Mitglieder.</div>';
      else if (s.state === 'pending') h += '<div class="jf-note">⏳ Deine Anfrage liegt beim Admin.</div>';
      else h += '<div class="jf-note">' + (lib.me ? 'Ansehen geht nur mit Freigabe.' : '<a href="/login?next=/musik%23jellyfin">Melde dich an</a>, um Zugang anzufragen.') + '</div>';
      return h + '</div>';
    }
    if (x.type === 'Series') {
      if (!/^jf:serie:/.test(view)) h += '<button type="button" class="big" data-go="jf:serie:' + x.id + '">📺 Folgen ansehen</button>';
      if (x.next) h += '<button type="button"' + (/^jf:serie:/.test(view) ? ' class="big"' : '') + ' data-act="jf-play" data-id="' + x.next.id + '">▶ Weiter mit ' + esc(jfEp(x.next)) + '</button>';
    } else {
      if (x.pos > 30) h += '<button type="button" class="big" data-act="jf-play" data-id="' + x.id + '">▶ Fortsetzen bei ' + fmt(x.pos) + '</button><button type="button" data-act="jf-play" data-from="0" data-id="' + x.id + '">⏮ Von vorn abspielen</button>';
      else h += '<button type="button" class="big" data-act="jf-play" data-id="' + x.id + '">▶ Abspielen</button>';
      h += '<button type="button" data-act="jf-enqueue" data-id="' + x.id + '">➕ An die Wiedergabeliste</button>';
      h += '<button type="button" data-act="jf-seen" data-id="' + x.id + '">' + (x.played ? '↩ Als ungesehen markieren' : '✓ Als gesehen markieren') + '</button>';
    }
    h += '<button type="button" data-act="jf-fav" data-id="' + x.id + '">' + (x.fav ? '⭐ Von meiner Liste nehmen' : '☆ Auf meine Liste') + '</button>';
    if (x.app) h += '<a class="btn" href="' + esc(x.app) + '" target="_blank" rel="noopener">↗ In Jellyfin öffnen</a>';
    return h + '</div>';
  }
  function jfSidePanel() { return getComputedStyle($('mp-queue')).display !== 'none' && $('mp-queue').offsetWidth > 150; }
  function jfRenderDetails() {
    var x = JF.det;
    qhead.innerHTML = '<b>Details</b> <button type="button" class="small jf-close" data-act="jf-close" title="Zur Wiedergabeliste">✕</button>';
    qlist.innerHTML = jfDetailHtml(x);
    qtools.innerHTML = jfActsHtml(x);
  }
  function jfOpen(id) {
    var x = JF.items[id];
    if (x && x.type === 'Series' && !/^jf:serie:/.test(view)) { show('jf:serie:' + id); return; }
    var panel = jfSidePanel();
    if (x) { JF.det = x; if (panel) { renderQueue(); renderList(); } }
    req('GET', '/jellyfin/titel/' + id).then(function (d) {
      JF.items[id] = Object.assign(JF.items[id] || {}, d); JF.det = JF.items[id];
      if (panel) { renderQueue(); renderList(); return; }
      dialog(d.type === 'Episode' ? d.series : d.name, jfDetailHtml(d) + jfActsHtml(d), [{ label: 'Schließen', value: 'cancel' }]);
    }).catch(oops);
  }

  // Zugang anfragen und App-Zugangsdaten
  function jfRequest() {
    var s = JF.st || {};
    if (!lib.me) { openPage('/login?next=' + encodeURIComponent('/musik#jellyfin')); return; }
    if (s.state === 'pending') { dialog('🎬 Zugang zu ' + esc(s.name), '<p>Deine Anfrage liegt beim Admin. Du bekommst eine Benachrichtigung, sobald er entschieden hat.</p>', [{ label: 'OK', value: 'ok' }]); return; }
    if (!s.canRequest) { status('Gerade kannst du nicht noch einmal fragen.'); return; }
    dialog('🎬 Zugang zu ' + esc(s.name) + ' anfragen', '<p>Der Admin bekommt deine Anfrage als Benachrichtigung. Sagt er ja, kannst du hier im Mediaplayer Filme und Serien ansehen, mit eigenem Fortschritt.</p>' +
      '<label>Nachricht an den Admin (freiwillig):<textarea name="message" class="w100" rows="3" maxlength="300"></textarea></label>' +
      '<label class="inline"><input type="checkbox" name="app"> Zugangsdaten auch für die Jellyfin-App (Fernseher, Handy)</label>',
    [{ label: 'Anfrage senden', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      post('/jellyfin/anfragen', { message: field('message') || '', app: !!field('app') }).then(function () {
        status('Anfrage gesendet.'); return jfLoad().then(render);
      }).catch(oops);
    });
  }
  function jfApp() {
    post('/jellyfin/app-zugang', {}).then(function (a) {
      var body = '<p>Damit meldest du dich in der Jellyfin-App (Fernseher, Handy, Tablet) oder im Browser an:</p><table class="jf-cred">' +
        '<tr><td>Server</td><td><code>' + esc(a.url) + '</code></td></tr><tr><td>Benutzer</td><td><code>' + esc(a.name) + '</code></td></tr>' +
        '<tr><td>Passwort</td><td>' + (a.pw ? '<code>' + esc(a.pw) + '</code><br><small>Schreib es dir auf: Es wird nur dieses eine Mal angezeigt.</small>' : '<small>schon angezeigt' + (a.canReset ? ', unten kannst du ein neues erzeugen' : ' (dein eigenes Jellyfin-Passwort)') + '</small>') + '</td></tr></table>' +
        '<p><small>Was du in der App schaust, landet im selben Fortschritt wie hier.</small></p>';
      var btns = [{ label: 'Schließen', value: 'cancel' }];
      if (a.canReset) btns.unshift({ label: '🔄 Neues Passwort', value: 'reset' });
      return dialog('📱 Jellyfin-App', body, btns).then(function (r) {
        if (r !== 'reset') return;
        return confirmBox('Neues Passwort', 'Ein neues Passwort erzeugen? Angemeldete Apps müssen sich danach neu anmelden.', 'Erzeugen').then(function (ok) {
          if (!ok) return;
          return post('/jellyfin/app-passwort', {}).then(function (j) {
            dialog('📱 Neues Passwort', '<p>Dein neues Passwort für Jellyfin:</p><p><code class="jf-pw">' + esc(j.pw) + '</code></p><p><small>Wird nur jetzt angezeigt.</small></p>', [{ label: 'OK', value: 'ok' }]);
          });
        });
      });
    }).catch(oops);
  }

  // ---------- Jellyfin: abspielen ----------
  function jfQItem(x, from) {
    return { jf: true, jfId: x.id, title: jfTitle(x), artist: x.type === 'Episode' ? '' : jfYears(x) ? String(jfYears(x)) : '', album: x.type === 'Episode' ? x.series : '',
      duration: x.runtime || 0, kind: 'video', video: true, resume: from === 0 ? 0 : x.pos || 0 };
  }
  function jfPlay(id, from) {
    var x = JF.items[id];
    if (!x) return;
    if (lob) { status('In einer Lobby läuft Jellyfin nicht. Verlass die Lobby, um das hier anzusehen.'); return; }
    var list2 = [x];
    // Folge: die übrigen Folgen der Staffel kommen dahinter
    if (x.type === 'Episode' && JF.eps) {
      var i = JF.eps.map(function (e) { return e.id; }).indexOf(id);
      if (i >= 0) list2 = JF.eps.slice(i);
    }
    var items = list2.map(function (e, k) { return jfQItem(e, k === 0 ? from : 0); });
    if (current && !isJf(current) && queue.length > 1) { enqueue(items.slice(0, 1)); playAt(queue.length - 1); return; }
    playList(items, 0);
    if (!isPhone()) show('now');
  }
  function jfCodecs() {
    var c = [], v = document.createElement('video');
    if (v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')) c.push('hevc');
    if (v.canPlayType('video/mp4; codecs="av01.0.05M.08"')) c.push('av1');
    if (v.canPlayType('video/webm; codecs="vp9"')) c.push('vp9');
    return c;
  }
  var hlsLoad = null;
  function jfHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsLoad) hlsLoad = new Promise(function (resolve) {
      var s = document.createElement('script'); s.src = '/jellyfin/hls.js';
      s.onload = function () { resolve(window.Hls || null); }; s.onerror = function () { hlsLoad = null; resolve(null); };
      document.head.appendChild(s);
    });
    return hlsLoad;
  }
  function jfDetach(keepReport) {
    var p = JF.play;
    if (p && !keepReport && !p.ended) jfReport(p, media.ended ? { done: true, stop: true, pos: 0 } : { stop: true });
    if (JF.hls) { try { JF.hls.destroy(); } catch (e) { /* weg */ } JF.hls = null; }
    media.querySelectorAll('track').forEach(function (t) { t.remove(); });
    JF.play = null;
    renderModes();
  }
  function jfReport(p, o) {
    if (!p || !p.it) return;
    var pos = o && o.pos != null ? o.pos : media.currentTime || 0;
    if (pos > 0) p.it.resume = pos;
    var x = JF.items[p.it.jfId];
    if (x) { if (o && o.done) { x.played = true; x.pos = 0; } else if (pos > 5) x.pos = pos; }
    fetch('/jellyfin/fortschritt/' + p.it.jfId, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify({ pos: Math.floor(pos), done: !!(o && o.done), stop: !!(o && o.stop), session: p.p.session }) }).catch(function () {});
    p.saved = Date.now();
  }
  function jfStart(it, opts) {
    jfDetach();
    opts = opts || {};
    var at = opts.at != null ? opts.at : it.resume || 0;
    media.pause(); media.removeAttribute('src'); media.load();
    status('Lade „' + it.title + '“ von Jellyfin …');
    var body = { bitrate: prefs.jfRate || 0, codecs: jfCodecs() };
    if (opts.audio != null) body.audio = opts.audio;
    if (opts.sub != null && opts.sub >= 0 && !opts.textSub) body.sub = opts.sub;
    post('/jellyfin/abspielen/' + it.jfId, body).then(function (p) {
      if (current !== it) return;
      JF.play = { it: it, p: p, saved: Date.now(), sub: opts.sub != null ? opts.sub : -1, audio: p.audioIndex };
      var go = function () {
        p.subs.filter(function (s) { return s.text; }).forEach(function (s) {
          var t = document.createElement('track'); t.kind = 'subtitles'; t.label = s.label; t.src = s.url; t.dataset.index = s.index; media.appendChild(t);
        });
        jfSubs(JF.play.sub);
        media.play().catch(function () { /* wartet auf Klick */ });
      };
      if (p.mode === 'hls' && !media.canPlayType('application/vnd.apple.mpegurl')) {
        jfHls().then(function (Hls) {
          if (current !== it) return;
          if (!Hls || !Hls.isSupported()) { status('⚠ Dieser Browser kann den Jellyfin-Stream nicht abspielen.'); return; }
          var h = new Hls({ enableWorker: false, startPosition: at > 5 ? at : -1, maxBufferLength: 40, backBufferLength: 60 });
          JF.hls = h;
          h.on(Hls.Events.ERROR, function (ev, d) {
            if (!d.fatal) return;
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
            else { status('⚠ Jellyfin-Stream abgebrochen.'); jfDetach(); }
          });
          h.loadSource(p.url); h.attachMedia(media);
          h.on(Hls.Events.MANIFEST_PARSED, go);
        });
      } else {
        media.src = p.url;
        if (at > 5) media.addEventListener('loadedmetadata', function () { try { media.currentTime = at; } catch (e) { /* noch nicht */ } }, { once: true });
        go();
      }
      status('▶ ' + it.title + ' · ' + (p.mode === 'direct' ? 'direkt von Jellyfin' + (p.video ? ' (' + p.video + ')' : '') : 'von Jellyfin umgewandelt' + (p.video ? ' (Original: ' + p.video + ')' : '')));
      renderModes();
    }).catch(function (e) { if (current === it) oops(e); });
  }
  // Untertitel: Text-Untertitel als Spur im Browser, Bild-Untertitel brennt Jellyfin ins Video (neu laden an derselben Stelle)
  function jfSubs(idx) {
    var p = JF.play;
    if (!p) return;
    p.sub = idx;
    Array.prototype.forEach.call(media.textTracks, function (t, i) {
      var el = media.querySelectorAll('track')[i];
      t.mode = el && Number(el.dataset.index) === idx ? 'showing' : 'disabled';
    });
  }
  function jfSwitch(o) {
    var p = JF.play;
    if (!p) return;
    var at = media.currentTime || 0, it = p.it;
    if (o.sub !== undefined) {
      var s = p.p.subs.filter(function (z) { return z.index === o.sub; })[0];
      if (o.sub < 0 || (s && s.text)) { if (p.p.burn) jfStart(it, { at: at, audio: p.audio, sub: o.sub, textSub: true }); else jfSubs(o.sub); renderModes(); return; }
      jfStart(it, { at: at, audio: p.audio, sub: o.sub });
      return;
    }
    if (o.audio !== undefined) { jfStart(it, { at: at, audio: o.audio, sub: p.sub, textSub: !p.p.burn }); return; }
    if (o.rate !== undefined) { prefs.jfRate = o.rate; savePrefs(); jfStart(it, { at: at, audio: p.audio, sub: p.sub, textSub: !p.p.burn }); }
  }
  // Ton, Untertitel und Qualität oben im Bild, solange ein Jellyfin-Titel läuft
  function renderModes() {
    var box = root.querySelector('.mp-modes'), old = $('mp-jfmodes');
    if (old) old.remove();
    var p = JF.play;
    if (!p || !box) return;
    var h = '<span id="mp-jfmodes" class="mp-jfmodes">';
    if (p.p.audio.length > 1) h += '<select data-jf="audio" title="Ton" aria-label="Ton">' + p.p.audio.map(function (a) { return '<option value="' + a.index + '"' + (a.index === p.audio ? ' selected' : '') + '>🔈 ' + esc(a.label) + '</option>'; }).join('') + '</select>';
    if (p.p.subs.length) h += '<select data-jf="sub" title="Untertitel" aria-label="Untertitel"><option value="-1">💬 Untertitel aus</option>' + p.p.subs.map(function (s) { return '<option value="' + s.index + '"' + (s.index === p.sub ? ' selected' : '') + '>💬 ' + esc(s.label) + '</option>'; }).join('') + '</select>';
    h += '<select data-jf="rate" title="Qualität" aria-label="Qualität">' + JF_RATES.map(function (r) { return '<option value="' + r[0] + '"' + ((prefs.jfRate || 0) === r[0] ? ' selected' : '') + '>⚙️ ' + r[1] + '</option>'; }).join('') + '</select></span>';
    box.insertAdjacentHTML('afterbegin', h);
    $('mp-jfmodes').addEventListener('change', function (e) {
      var k = e.target.dataset.jf, v = Number(e.target.value);
      jfSwitch(k === 'audio' ? { audio: v } : k === 'sub' ? { sub: v } : { rate: v });
    });
  }
  media.addEventListener('timeupdate', function () { var p = JF.play; if (p && !media.paused && Date.now() - p.saved > 15000) jfReport(p); });
  media.addEventListener('pause', function () { var p = JF.play; if (p && !media.ended && media.currentTime > 5) jfReport(p); });
  media.addEventListener('ended', function () { var p = JF.play; if (p) { p.ended = true; jfReport(p, { done: true, stop: true, pos: 0 }); } }, true);
  window.addEventListener('pagehide', function () { var p = JF.play; if (p && !p.ended) jfReport(p, { stop: true }); });

  // Klicks auf Jellyfin-Knöpfe, vor den übrigen Klicks des Players (der Dialog liegt außerhalb von #mp)
  function jfAct(b) {
    var a = b.dataset.act, id = b.dataset.id;
    if (dlg.open && dlg.contains(b)) dlg.close('cancel');
    if (a === 'jf-open') jfOpen(id);
    else if (a === 'jf-play') jfPlay(id, b.dataset.from === '0' ? 0 : undefined);
    else if ((a === 'jf-enqueue' || a === 'jf-queue-season') && lob) status('In einer Lobby läuft Jellyfin nicht.');
    else if (a === 'jf-enqueue') { if (JF.items[id]) enqueue([jfQItem(JF.items[id])]); }
    else if (a === 'jf-queue-season') enqueue((JF.eps || []).map(function (x) { return jfQItem(x); }));
    else if (a === 'jf-season') { JF.busy = true; renderList(); jfSeason(id).catch(oops); }
    else if (a === 'jf-filter') { JF.filter = b.dataset.v; delete JF.data[view]; jfEnter(view); }
    else if (a === 'jf-more') jfEnter(view, true);
    else if (a === 'jf-close') { JF.det = null; renderQueue(); renderList(); }
    else if (a === 'jf-request') jfRequest();
    else if (a === 'jf-app') jfApp();
    else if (a === 'jf-fav' || a === 'jf-seen') {
      var x = JF.items[id];
      if (!x) return;
      var p = a === 'jf-fav' ? post('/jellyfin/merken/' + id, { on: !x.fav }) : post('/jellyfin/fortschritt/' + id, { done: !x.played, pos: 0 });
      p.then(function () {
        if (a === 'jf-fav') { x.fav = !x.fav; delete JF.data['jf:liste']; } else { x.played = !x.played; x.pos = 0; }
        if (JF.det && JF.det.id === id) JF.det = x;
        if (isJfView()) { renderQueue(); renderList(); }
      }).catch(oops);
    }
  }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act^="jf-"]');
    if (!b || !root.contains(b)) return;
    e.stopPropagation();
    jfAct(b);
  }, true);
  dlg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act^="jf-"], [data-go^="jf:"]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.go) { dlg.close('cancel'); show(b.dataset.go); return; }
    jfAct(b);
  });
  // Cover, die Jellyfin nicht hat: das Bild verschwindet, die farbige Kachel mit Namen bleibt (CSP erlaubt kein onerror="…")
  function jfImgError(e) { if (e.target.tagName === 'IMG' && e.target.closest('.jf-poster')) e.target.remove(); }
  root.addEventListener('error', jfImgError, true);
  dlg.addEventListener('error', jfImgError, true);
  // Klassisch: In den Jellyfin-Ansichten weicht das Bild den Kacheln, solange kein Video läuft
  function jfBrowse() { root.classList.toggle('jf-browse', isJfView() && !(current && isVideo(current) && !lob && isPlaying())); }
  media.addEventListener('play', jfBrowse);
  media.addEventListener('pause', jfBrowse);

  // ---------- Start ----------
  applyVolume();
  nowPlaying();
  render();
  Promise.all([load(), jfLoad()]).then(function () {
    // Aus der Benachrichtigung zur Zugangsanfrage: /musik#jellyfin öffnet gleich die Übersicht
    if (JF.st && JF.st.on) { if (location.hash === '#jellyfin' && jfGroup()) show('jf:start'); else render(); }
    var q = new URLSearchParams(location.search), want = q.get('lobby');
    // Aus Eigene Dateien und vom Desktop: ?titel=ID stellt den Titel in die Wiedergabeliste, ?playlist=ID zeigt die Playlist
    var tid = Number(q.get('titel')), pid = Number(q.get('playlist'));
    if (tid && byId[tid]) enqueue([byId[tid]]);
    if (pid && playlist('pl:' + pid)) show('pl:' + pid);
    loadLobbies();
    if (want && CAN_LOBBY) {
      if (lib.me) joinLobby(want); else status('Melde dich an, um der Lobby beizutreten.');
    }
  });
  kick();
  window.addEventListener('pagehide', function () { if (lob) lob.es.close(); if (root.classList.contains('mini')) setMini(false); });
})();
