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

  var lib = { tracks: [], playlists: [], me: null, canUpload: false, quota: null }, byId = {};
  var view = 'all', filter = '';
  var PREF_KEY = 'musik-player';
  var prefs = { vis: 'balken', shuffle: false, repeat: 'aus', picture: 'video' };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (e) { /* Standard */ }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* privat */ } }

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
  var VIS_LABEL = { public: 'Öffentlich', members: 'Nur angemeldete Nutzer', private: 'Nur ich (und der Admin)', groups: 'Bestimmte Gruppen (vom Admin)' };
  function visOptions(cur, withGroups) {
    var keys = ['public', 'members', 'private'];
    if (withGroups || cur === 'groups') keys.push('groups');
    return keys.map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + VIS_LABEL[k] + '</option>'; }).join('');
  }
  // Art eines Eintrags: Titel aus der Bibliothek (kind), Lobby-Eintrag (type) oder YouTube-Video ohne Konto
  function isYt(it) { return !!it && (it.type === 'yt' || it.kind === 'youtube'); }
  function isVideo(it) { return !!it && (it.kind === 'video' || it.video === true); }
  function kindBadge(it) {
    return isYt(it) ? '<small class="mp-kind yt">YouTube</small>' : isVideo(it) ? '<small class="mp-kind video">Video</small>' : '<small class="mp-kind">Audio</small>';
  }
  function kindIcon(it) { return isYt(it) ? '▶️' : isVideo(it) ? '🎬' : '🎵'; }
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
  var actx = null, gain = null, analyser = null, freq, wave;
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
      src.connect(analyser); analyser.connect(gain); gain.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount); wave = new Uint8Array(analyser.fftSize);
      media.volume = 1;
    } catch (e) { actx = null; gain = null; analyser = null; }
    applyVolume();
  }
  function applyVolume() {
    var v = Sound.musik();
    if (gain) gain.gain.value = v; else media.volume = v;
    if (yt.ready) { ytCmd('setVolume', [Math.round(v * 100)]); ytCmd(v ? 'unMute' : 'mute'); }
    volEl.value = Math.round(Sound.get().musik * 100);
  }
  Sound.onChange(applyVolume);
  volEl.addEventListener('input', function () { Sound.set({ musik: volEl.value / 100, stumm: false }); });

  // ---------- Bild: Video, Visualisierung oder YouTube ----------
  var vis = window.RetroVis ? window.RetroVis.create($('mp-canvas')) : null;
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
    if (view === 'vis') renderList();
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
      if (!d || !d.mini(window, true, 540, root.offsetHeight + 8)) {
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
  var main = root.querySelector('.mp-main'), center = root.querySelector('.mp-center');
  // Schmales Fenster (Handy): Reiter statt Seitenleisten, aber nicht im Mini-Player und nicht im Theater
  var narrow = window.matchMedia('(max-width: 640px)');
  function layout() { root.classList.toggle('phone', narrow.matches && !root.classList.contains('mini') && !root.classList.contains('theater')); }
  function isPhone() { return root.classList.contains('phone'); }
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  function applySizes() {
    root.style.setProperty('--mp-side', prefs.sideW ? prefs.sideW + 'px' : '');
    root.style.setProperty('--mp-queue', prefs.queueW ? prefs.queueW + 'px' : '');
    root.style.setProperty('--mp-stage', prefs.stageH ? prefs.stageH + 'px' : '');
  }
  function sizeFrom(which, x, y) {
    var m = main.getBoundingClientRect(), c = center.getBoundingClientRect();
    if (which === 'stage') prefs.stageH = Math.round(clamp(y - c.top, 80, c.height - 90));
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
      lib = j; byId = {};
      lib.tracks.forEach(function (t) { byId[t.id] = t; });
      if (/^pl:/.test(view) && !playlist(view)) view = 'all';
      render();
    }).catch(oops);
  }
  function playlist(key) { var id = Number(String(key).slice(3)); return lib.playlists.filter(function (p) { return p.id === id; })[0] || null; }
  function viewTracks(key) {
    var all = lib.tracks;
    if (key === 'musik') return all.filter(function (t) { return t.kind === 'audio'; });
    if (key === 'videos') return all.filter(function (t) { return t.kind === 'video'; });
    if (key === 'youtube') return all.filter(function (t) { return t.kind === 'youtube'; });
    if (key === 'sammlung') return all.filter(function (t) { return t.byAdmin; });
    if (key === 'mitglieder') return all.filter(function (t) { return !t.byAdmin; });
    if (key === 'meine') return all.filter(function (t) { return t.mine; });
    if (/^pl:/.test(key)) { var p = playlist(key); return p ? p.tracks.map(function (id) { return byId[id]; }).filter(Boolean) : []; }
    return all;
  }
  function isLibView(key) { return !/^(now|lobbys|vis)$/.test(key); }
  function filtered(tracks) {
    if (!filter) return tracks;
    var f = filter.toLowerCase();
    return tracks.filter(function (t) { return (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.by || '')).toLowerCase().indexOf(f) >= 0; });
  }

  // Aufgabenleiste links wie beim Media Player 9; auf dem Handy werden daraus Knöpfe im Reiter „Bibliothek“
  function renderSide() {
    var me = lib.me, h = '';
    function item(key, label, n, cls) {
      return '<button type="button" class="mp-nav' + (cls ? ' ' + cls : '') + (view === key ? ' active' : '') + '" data-view="' + esc(key) + '">' + label +
        (n !== undefined ? ' <small>(' + n + ')</small>' : '') + '</button>';
    }
    h += item('now', '▶ Wiedergabe läuft', undefined, 'mp-task mp-desk-only');
    h += item('all', '📚 Medienbibliothek', lib.tracks.length, 'mp-task');
    h += '<div class="mp-sub">' + item('musik', '🎵 Musik', viewTracks('musik').length) + item('videos', '🎬 Videos', viewTracks('videos').length);
    if (CAN_YT) h += item('youtube', '▶️ YouTube-Links', viewTracks('youtube').length);
    h += item('sammlung', '💿 Sammlung', viewTracks('sammlung').length) + item('mitglieder', '👥 Von Mitgliedern', viewTracks('mitglieder').length);
    if (me) h += item('meine', '⭐ Meine Titel', viewTracks('meine').length);
    h += '</div>';
    if (me) {
      var mine = lib.playlists.filter(function (p) { return p.mine; }), other = lib.playlists.filter(function (p) { return !p.mine; });
      h += '<div class="mp-group">📃 Playlists</div><div class="mp-sub">' + mine.map(function (p) { return item('pl:' + p.id, '📃 ' + esc(p.title), p.tracks.length); }).join('') +
        '<button type="button" class="mp-nav" data-act="new-playlist">➕ Neue Playlist …</button>';
      if (other.length) h += other.map(function (p) { return item('pl:' + p.id, '📃 ' + esc(p.title) + ' <small>von ' + esc(p.owner) + '</small>'); }).join('');
      h += '</div>';
    }
    if (CAN_LOBBY && me) {
      h += item('lobbys', '🎧 Lobbys', undefined, 'mp-task mp-desk-only');
      if (lob && lob.state) h += '<div class="mp-sub mp-desk-only">' + item('now', '🔴 ' + esc(lob.state.name) + ' <small>(' + lob.state.listeners.length + ')</small>', undefined, 'mp-lobby-now') + '</div>';
    }
    if (lib.canUpload) h += '<button type="button" class="mp-nav mp-task" data-act="upload">📤 Hochladen</button>';
    if (vis) h += item('vis', '🌈 Visualisierungen', undefined, 'mp-task');
    if (!me) h += '<p class="mp-hint"><a href="/login?next=/musik">Melde dich an</a>, um Playlists anzulegen, Musik und Videos hochzuladen und mit anderen gemeinsam zu hören.</p>';
    if (lib.quota) h += '<p class="mp-hint mp-quota">Speicher: ' + fmtSize(lib.quota.used) + ' von ' + fmtSize(lib.quota.total) + '</p>';
    side.innerHTML = h;
    // „Wiedergabe läuft“ ist auch aktiv, wenn man über die Lobby dorthin kam
    var nowBtns = side.querySelectorAll('[data-view=now]');
    if (nowBtns.length > 1 && view === 'now') nowBtns[0].classList.remove('active');
  }
  side.addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (b) show(b.dataset.view);
  });
  function show(key) {
    if (key === 'lobbys' && !lib.me) key = 'all';
    view = key; filter = '';
    layout();
    if (isPhone()) tab = key === 'now' ? (lob ? 'lobby' : 'queue') : key === 'lobbys' ? 'lobby' : 'lib';
    render();
    if (key === 'lobbys') loadLobbies();
  }
  function render() {
    layout();
    root.dataset.view = view;
    renderTabs(); renderSide(); renderHead(); renderList(); renderQueue(); applyPicture(); updateButtons();
  }

  function totalTime(tracks) { return tracks.reduce(function (n, t) { return n + (t.duration || 0); }, 0); }
  var VIEW_NAME = { all: 'Medienbibliothek', musik: 'Musik', videos: 'Videos', youtube: 'YouTube-Links', sammlung: 'Sammlung', mitglieder: 'Von Mitgliedern hochgeladen', meine: 'Meine Titel' };
  function renderHead() {
    if (view === 'now') { head.innerHTML = infoHead(); return; }
    if (view === 'lobbys') { head.innerHTML = lobbyListHead(); return; }
    if (view === 'vis') { head.innerHTML = '<div class="mp-title"><b>🌈 Visualisierungen</b> <small>wie beim Windows Media Player. Bei Videos schaltet „🌈 Visualisierung“ im Bild um.</small></div>'; return; }
    var tracks = viewTracks(view), p = /^pl:/.test(view) ? playlist(view) : null;
    var h = '<div class="mp-title"><b>' + (p ? '📃 ' + esc(p.title) : esc(VIEW_NAME[view] || '')) + '</b> <small>' + tracks.length + ' Titel' +
      (totalTime(tracks) ? ' · ' + fmt(totalTime(tracks)) : '') + (p ? ' · ' + VIS_LABEL[p.visibility] + (p.mine ? '' : ' · von ' + esc(p.owner)) : '') + '</small></div>';
    h += '<div class="mp-tools"><input type="search" id="mp-filter" placeholder="🔍 Suchen" aria-label="Titel suchen">';
    if (lob) h += '<button type="button" class="small" data-act="lobby-add-view" title="Alle Titel dieser Liste in die Lobby">🎧 Alle in die Lobby</button>';
    else h += '<button type="button" class="small" data-act="play-view">▶ Alle abspielen</button><button type="button" class="small" data-act="queue-view" title="Alle Titel hinten an die Wiedergabeliste hängen">➕ Anhängen</button>';
    if (p && p.mine) h += '<button type="button" class="small" data-act="edit-playlist">✎ Bearbeiten</button><button type="button" class="small danger" data-act="delete-playlist">🗑</button>';
    if (view === 'youtube' && lib.me && CAN_YT) h += '<button type="button" class="small" data-act="yt-save" title="YouTube-Links dauerhaft in der Bibliothek ablegen">💾 Links speichern …</button>';
    h += '</div>';
    if (lob) h += '<p class="mp-hint">🎧 Du bist in einer Lobby: Ein Klick auf einen Titel fügt ihn der Warteschlange der Lobby hinzu.</p>';
    head.innerHTML = h;
    var f = $('mp-filter');
    f.addEventListener('input', function () { filter = f.value.trim(); renderList(); });
  }

  function renderList() {
    if (view === 'now') { list.innerHTML = ''; return; }
    if (view === 'lobbys') { renderLobbies(); return; }
    if (view === 'vis') {
      list.innerHTML = '<div class="mp-picks mp-vis-list">' + VIS_LIST.map(function (m) {
        return '<button type="button" class="mp-nav' + (m.id === prefs.vis ? ' active' : '') + '" data-act="vis-pick" data-vis="' + esc(m.id) + '">🌈 ' + esc(m.name) + '</button>';
      }).join('') + '</div>';
      return;
    }
    var p = /^pl:/.test(view) ? playlist(view) : null, own = p && p.mine;
    var tracks = filtered(viewTracks(view));
    if (!tracks.length) {
      var empty = filter ? 'Nichts gefunden.' : p ? 'Diese Playlist ist noch leer. Füge Titel über 📃 in der Bibliothek hinzu.'
        : view === 'meine' ? (lib.canUpload ? 'Du hast noch nichts hochgeladen. Links über 📤 Hochladen geht es los.' : 'Du hast noch nichts hochgeladen.')
          : view === 'youtube' ? 'Noch keine YouTube-Links gespeichert.' + (lib.me ? ' Oben über 💾 Links speichern oder rechts in der Wiedergabeliste geht es los.' : '')
            : view === 'videos' ? 'Hier gibt es noch keine Videos.' : 'Hier gibt es noch nichts.';
      list.innerHTML = '<p class="mp-empty">' + empty + '</p>';
      return;
    }
    var playingId = lob ? null : current && current.id;
    var rows = tracks.map(function (t, i) {
      var acts = '';
      if (!lob) acts += '<button type="button" class="small" data-act="track-queue" title="An die Wiedergabeliste hängen">➕</button>';
      if (lib.me) acts += '<button type="button" class="small" data-act="to-playlist" title="Zu einer Playlist hinzufügen">📃</button>';
      if (own) acts += '<button type="button" class="small" data-act="pl-up" title="Nach oben">▲</button><button type="button" class="small" data-act="pl-down" title="Nach unten">▼</button>' +
        '<button type="button" class="small" data-act="pl-remove" title="Aus der Playlist nehmen">✕</button>';
      else if (t.canEdit) acts += '<button type="button" class="small" data-act="edit-track" title="Bearbeiten">✎</button><button type="button" class="small danger" data-act="delete-track" title="Löschen">🗑</button>';
      var now = t.id === playingId;
      return '<tr data-id="' + t.id + '" data-i="' + i + '" class="' + (now ? 'playing' : '') + (lob && !t.shareable ? ' locked' : '') + '">' +
        '<td class="num">' + (now ? (isPlaying() ? '🔊' : '⏸') : i + 1) + '</td>' +
        '<td><span class="mp-ico" title="' + (isYt(t) ? 'YouTube' : isVideo(t) ? 'Video' : 'Audio') + '">' + kindIcon(t) + '</span> <button type="button" class="mp-track" data-act="play-track">' + esc(t.title) + '</button>' +
        (t.visibility !== 'public' ? ' <small title="' + VIS_LABEL[t.visibility] + '">' + (t.visibility === 'private' ? '🔒' : '👥') + '</small>' : '') +
        (t.artist ? '<small class="mp-artist">' + esc(t.artist) + '</small>' : '') + '</td>' +
        '<td>' + esc(t.artist) + '</td><td class="num">' + (t.duration ? fmt(t.duration) : '') + '</td>' +
        '<td class="mp-by">' + (t.byAdmin ? '' : userLink(t.by, t.byUser)) + '</td><td class="mp-acts">' + acts + '</td></tr>';
    }).join('');
    list.innerHTML = '<table class="list mp-table"><thead><tr><th class="num">#</th><th>Titel</th><th>Interpret</th><th class="num">Länge</th><th>Von</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'vis-pick') { setVis(b.dataset.vis); return; }
    var tr = e.target.closest('tr[data-id], tr[data-lobby]');
    if (!tr) return;
    var act = b.dataset.act;
    if (tr.dataset.lobby) { if (act === 'join') joinLobby(tr.dataset.lobby); return; }
    var id = Number(tr.dataset.id), t = byId[id], tracks = filtered(viewTracks(view));
    if (act === 'play-track') { if (lob) lobbyAdd({ tracks: [id] }); else playList(tracks, Number(tr.dataset.i)); }
    else if (act === 'track-queue') enqueue([t]);
    else if (act === 'to-playlist') toPlaylist(id);
    else if (act === 'edit-track') editTrack(t);
    else if (act === 'delete-track') deleteTrack(t);
    else if (/^pl-/.test(act)) changePlaylist(playlist(view), Number(tr.dataset.i), act);
  });

  // ---------- Wiedergabe läuft: Angaben zum laufenden Titel und zur Lobby ----------
  function infoHead() {
    var it = playingItem(), h = '<div class="mp-info">';
    if (it) {
      var by = lob ? (it.by ? 'hinzugefügt von ' + userLink(it.by, it.byUser) : '') : it.byAdmin ? '' : it.by ? 'von ' + userLink(it.by, it.byUser) : '';
      h += '<div class="mp-info-title"><b>' + esc(it.title) + '</b> ' + kindBadge(it) + '</div>' +
        '<div class="mp-info-sub">' + [esc(it.artist), esc(it.album), by].filter(Boolean).join(' · ') + '</div>';
    } else if (!lob) {
      h += '<div class="mp-info-title"><b>Gerade läuft nichts.</b></div><div class="mp-info-sub">Wähle links in der Medienbibliothek einen Titel' +
        (CAN_YT ? ' oder füge rechts in der Wiedergabeliste einen YouTube-Link ein' : '') + '.</div>';
    }
    h += '</div>';
    if (lob) h += lobbyHead();
    else if (CAN_LOBBY && lib.me) h += '<p class="mp-hint">🎧 Mit anderen gleichzeitig hören? <button type="button" class="small" data-view-go="lobbys">Lobbys ansehen</button></p>';
    return h;
  }
  head.addEventListener('click', function (e) { var b = e.target.closest('[data-view-go]'); if (b) show(b.dataset.viewGo); });

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
    if (isYt(current)) {
      media.pause(); media.removeAttribute('src'); media.load();
      ytPlayLocal(current);
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
    applyPicture(); renderQueue(); renderList(); updateButtons();
    if (view === 'now') renderHead();
  }
  function nowPlaying() {
    var t = playingItem();
    nowEl.textContent = t ? t.title + (t.artist ? ' – ' + t.artist : '') : '';
    lcdTitle.textContent = t ? t.title + (t.artist ? ' – ' + t.artist : '') : 'Mediaplayer';
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
    media.pause();
    if (media.getAttribute('src')) media.currentTime = 0;
    renderAfterChange();
  }
  function isPlaying() {
    if (lob) return !!(lob.state && lob.state.playing);
    if (isYt(current)) return yt.state === 1 || yt.state === 3;
    return !media.paused;
  }
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
    // Titel aus der Systemsteuerung kennen ihre Länge erst jetzt; der Server erfährt sie mit dem Abspiel-Zähler
    else if (current && !current.duration && isFinite(media.duration)) { current.duration = media.duration; renderQueue(); }
    showTime();
  });
  media.addEventListener('error', function () {
    if (!media.getAttribute('src') || !media.error) return;
    status('⚠ Dieser Titel lässt sich nicht abspielen.');
    if (!lob) setTimeout(skipBroken, 1500);
  });
  function countPlay() {
    if (counted || !current || lob || !current.id) return;
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
    rp.textContent = prefs.repeat === 'einen' ? '🔂' : '🔁';
    rp.title = 'Wiederholen: ' + { aus: 'aus', alle: 'alle', einen: 'diesen Titel' }[prefs.repeat];
    sh.disabled = rp.disabled = !!lob;
    var ctl = !lob || lobbyCanControl();
    ['play', 'stop', 'next', 'prev'].forEach(function (a) { btn(a).disabled = !ctl; });
    seek.disabled = !ctl;
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
    if (root.classList.contains('mini')) lcdTime.textContent = t + ' / ' + fmt(x.d) + (lob && lob.state ? ' · Lobby' : '');
    // YouTube ohne Lobby: nach 30 Sekunden zählt das Video als gehört
    if (!lob && !counted && isYt(current) && x.t > 30) countPlay();
  }
  seek.addEventListener('input', function () { seeking = true; var x = timing(); timeEl.textContent = fmt(seek.value / 1000 * x.d); });
  seek.addEventListener('change', function () {
    seeking = false;
    var x = timing();
    if (x.d) seekTo(seek.value / 1000 * x.d);
  });
  setInterval(function () { if (!looping) showTime(); }, 500);

  // ---------- Wiedergabeliste rechts: eigene oder die der Lobby ----------
  function renderQueue() {
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
    var b = e.target.closest('button[data-act]');
    if (!b || list.contains(b) || qlist.contains(b) || dlg.contains(b)) return;
    var a = b.dataset.act;
    if (a === 'play') playPause();
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
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    var t = b.dataset.tab;
    if (t === 'lib') show(isLibView(view) || view === 'vis' ? view : 'all');
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
      var p = /^pl:/.test(r) && playlist(r);
      if (!p) return;
      post('/musik/playlists/' + p.id, { tracks: p.tracks.concat(id) })
        .then(function () { status('„' + byId[id].title + '“ ist jetzt in „' + p.title + '“.'); return load(); }).catch(oops);
    });
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

  // ---------- Lobbys ----------
  var lob = null, lobbies = [], lobbyTimer = null;
  function lobbyListHead() {
    return '<div class="mp-title"><b>🎧 Lobbys</b> <small>Gemeinsam hören und schauen: Alle in einer Lobby erleben denselben Titel zur selben Zeit.</small></div>' +
      '<div class="mp-tools"><input type="text" id="mp-lobby-name" maxlength="60" placeholder="Name der neuen Lobby">' +
      '<label class="inline"><input type="checkbox" id="mp-lobby-open" checked> Alle dürfen steuern</label>' +
      '<label class="inline"><input type="checkbox" id="mp-lobby-hidden"> Nur mit Link</label>' +
      '<button type="button" class="small" data-act="lobby-create">➕ Lobby öffnen</button><button type="button" class="small" data-act="lobby-refresh" title="Aktualisieren">🔄</button></div>';
  }
  function loadLobbies() {
    clearTimeout(lobbyTimer);
    if (view !== 'lobbys') return;
    req('GET', '/musik/lobbys').then(function (j) { lobbies = j.lobbies; if (view === 'lobbys') renderLobbies(); }).catch(oops);
    lobbyTimer = setTimeout(loadLobbies, 10000);
  }
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
    if (!quiet) { status(msg || 'Lobby verlassen.'); if (view === 'now') view = 'lobbys'; show(view); }
  }
  function onLobbyState(s) {
    if (!lob) return;
    var first = !lob.state;
    lob.state = s;
    lob.offset = s.now - Date.now();
    if (first) status('Du bist in der Lobby „' + s.name + '“.');
    modeEl.textContent = '🎧 ' + s.name + ' · ' + s.listeners.length + ' hören zu';
    renderSide(); renderQueue(); applyPicture(); updateButtons();
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

  function lobbyHead() {
    var s = lob && lob.state;
    if (!s) return '<div class="mp-title"><b>🎧 Lobby</b> <small>verbinde …</small></div>';
    var host = lobbyIsHost();
    return '<div class="mp-lobby"><div class="mp-title"><b>🔴 ' + esc(s.name) + '</b> <small>Gastgeber: ' + esc(s.host) + ' · ' + (s.open ? 'alle dürfen steuern' : 'nur der Gastgeber steuert') +
      '</small></div><div class="mp-users" title="Auf einen Namen klicken für mehr">👥 ' + s.listeners.length + ': ' + s.listeners.map(function (u) {
        return '<button type="button" class="small mp-user' + (lib.me && u.id === lib.me.id ? ' me' : '') + '" data-act="lobby-user" data-user="' + u.id + '">' +
          (u.host ? '👑 ' : u.control ? '🎶 ' : '') + esc(u.name) + '</button>';
      }).join('') + '</div><div class="mp-tools">' +
      '<button type="button" class="small" data-act="lobby-link">🔗 Einladungslink</button>' +
      (host ? '<button type="button" class="small" data-act="lobby-settings">⚙️ Einstellungen</button>' : '') +
      '<button type="button" class="small" data-act="lobby-leave">🚪 Verlassen</button>' +
      (host ? '<button type="button" class="small danger" data-act="lobby-close">✖ Lobby schließen</button>' : '') + '</div>' +
      (lobbyCanControl() ? '<p class="mp-hint">Titel kommen über die Medienbibliothek oder einen YouTube-Link in der Wiedergabeliste dazu.</p>' : '') + '</div>';
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
        .then(function () { show('youtube'); }).catch(oops);
    });
  }

  // ---------- Start ----------
  applyVolume();
  nowPlaying();
  render();
  load().then(function () {
    var want = new URLSearchParams(location.search).get('lobby');
    if (want && CAN_LOBBY) {
      if (lib.me) joinLobby(want); else status('Melde dich an, um der Lobby beizutreten.');
    }
  });
  kick();
  window.addEventListener('pagehide', function () { if (lob) lob.es.close(); if (root.classList.contains('mini')) setMini(false); });
})();
