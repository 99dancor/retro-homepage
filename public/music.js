// Musik-Player (Startmenü → 🎵 Musik): Bibliothek, Playlists, Hochladen, Visualisierungen und Lobbys zum
// gemeinsamen Hören, auch mit YouTube-Videos. Die Daten kommen als JSON von /musik/…, Schreiben geht per POST
// mit dem Formular-Token im Kopf x-csrf-token. Lautstärke und Stummschaltung teilt sich der Player mit dem
// 🔊-Regler neben der Uhr (public/sound.js).
(function () {
  'use strict';
  var root = document.getElementById('mp');
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, CAN_LOBBY = !!root.dataset.lobby, CAN_YT = !!root.dataset.youtube;
  var audio = $('mp-audio'), side = $('mp-side'), list = $('mp-list'), head = $('mp-head'), stage = $('mp-stage');
  var nowEl = $('mp-now'), overlay = $('mp-overlay'), ytBox = $('mp-yt'), statusEl = $('mp-status'), modeEl = $('mp-mode');
  var seek = $('mp-seek'), volEl = $('mp-vol'), timeEl = $('mp-time'), durEl = $('mp-dur'), visSelect = $('mp-vis-select');
  var btn = function (act) { return root.querySelector('.mp-controls [data-act=' + act + ']'); };
  var Sound = window.RetroSound || { musik: function () { return 0.8; }, get: function () { return { musik: 0.8 }; }, set: function () {}, onChange: function () {} };

  var lib = { tracks: [], playlists: [], me: null, canUpload: false, quota: null }, byId = {};
  var view = 'all', filter = '';
  var PREF_KEY = 'musik-player';
  var prefs = { vis: 'balken', shuffle: false, repeat: 'aus' };
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
      var first = dlg.querySelector('input:not([type=checkbox]):not([type=radio]), select');
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
  var actx = null, gain = null, analyser = null, freq, wave;
  function graph() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      var src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
      gain = actx.createGain();
      src.connect(analyser); analyser.connect(gain); gain.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount); wave = new Uint8Array(analyser.fftSize);
      audio.volume = 1;
    } catch (e) { actx = null; gain = null; analyser = null; }
    applyVolume();
  }
  function applyVolume() {
    var v = Sound.musik();
    if (gain) gain.gain.value = v; else audio.volume = v;
    if (yt.ready) { ytCmd('setVolume', [Math.round(v * 100)]); ytCmd(v ? 'unMute' : 'mute'); }
    volEl.value = Math.round(Sound.get().musik * 100);
  }
  Sound.onChange(applyVolume);
  volEl.addEventListener('input', function () { Sound.set({ musik: volEl.value / 100, stumm: false }); });

  // ---------- Visualisierung ----------
  var vis = window.RetroVis ? window.RetroVis.create($('mp-canvas')) : null;
  if (vis) {
    window.RetroVis.list.forEach(function (m) { visSelect.add(new Option(m.name, m.id)); });
    if (!window.RetroVis.list.some(function (m) { return m.id === prefs.vis; })) prefs.vis = 'balken';
    visSelect.value = prefs.vis;
    vis.setMode(prefs.vis);
    visSelect.addEventListener('change', function () { prefs.vis = visSelect.value; vis.setMode(prefs.vis); savePrefs(); });
  }
  var looping = false, idle = 0;
  function frame(t) {
    var active = analyser && !audio.paused && (!lob || currentLobbyItem() && currentLobbyItem().type === 'track');
    if (vis) {
      if (active) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); vis.draw(freq, wave, t / 1000); idle = 0; }
      else { vis.dim(); idle++; }
    }
    showTime();
    if (idle < 90) requestAnimationFrame(frame); else looping = false;
  }
  function kick() { idle = 0; if (!looping) { looping = true; requestAnimationFrame(frame); } }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(function () { status('Vollbild geht hier nicht.'); });
  }
  stage.addEventListener('dblclick', fullscreen);

  // ---------- Bibliothek ----------
  function load() {
    return req('GET', '/musik/bibliothek').then(function (j) {
      lib = j; byId = {};
      lib.tracks.forEach(function (t) { byId[t.id] = t; });
      if (/^pl:/.test(view) && !playlist(view)) view = 'all';
      renderSide(); renderHead(); renderList();
    }).catch(oops);
  }
  function playlist(key) { var id = Number(String(key).slice(3)); return lib.playlists.filter(function (p) { return p.id === id; })[0] || null; }
  function viewTracks(key) {
    var all = lib.tracks;
    if (key === 'sammlung') return all.filter(function (t) { return t.byAdmin; });
    if (key === 'mitglieder') return all.filter(function (t) { return !t.byAdmin; });
    if (key === 'meine') return all.filter(function (t) { return t.mine; });
    if (/^pl:/.test(key)) { var p = playlist(key); return p ? p.tracks.map(function (id) { return byId[id]; }).filter(Boolean) : []; }
    return all;
  }
  function filtered(tracks) {
    if (!filter) return tracks;
    var f = filter.toLowerCase();
    return tracks.filter(function (t) { return (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.by || '')).toLowerCase().indexOf(f) >= 0; });
  }

  function renderSide() {
    var me = lib.me, h = '';
    function item(key, label, n) {
      return '<button type="button" class="mp-nav' + (view === key ? ' active' : '') + '" data-view="' + esc(key) + '">' + label +
        (n !== undefined ? ' <small>(' + n + ')</small>' : '') + '</button>';
    }
    h += '<div class="mp-group">Bibliothek</div>' + item('all', '🎵 Alle Titel', lib.tracks.length) +
      item('sammlung', '💿 Sammlung', viewTracks('sammlung').length) + item('mitglieder', '👥 Von Mitgliedern', viewTracks('mitglieder').length);
    if (me) h += item('meine', '⭐ Meine Titel', viewTracks('meine').length);
    if (me) {
      var mine = lib.playlists.filter(function (p) { return p.mine; }), other = lib.playlists.filter(function (p) { return !p.mine; });
      h += '<div class="mp-group">Meine Playlists</div>' + mine.map(function (p) { return item('pl:' + p.id, '📃 ' + esc(p.title), p.tracks.length); }).join('') +
        '<button type="button" class="mp-nav" data-act="new-playlist">➕ Neue Playlist …</button>';
      if (other.length) h += '<div class="mp-group">Playlists anderer</div>' + other.map(function (p) { return item('pl:' + p.id, '📃 ' + esc(p.title) + ' <small>von ' + esc(p.owner) + '</small>'); }).join('');
    }
    if (CAN_LOBBY) {
      h += '<div class="mp-group">Gemeinsam hören</div>';
      if (lob && lob.state) h += item('lobby', '🔴 ' + esc(lob.state.name), lob.state.listeners.length);
      h += item('lobbys', '🎧 Lobbys');
    }
    if (!me) h += '<p class="mp-hint"><a href="/login?next=/musik">Melde dich an</a>, um Playlists anzulegen, Musik hochzuladen und mit anderen gemeinsam zu hören.</p>';
    side.innerHTML = h;
  }
  side.addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (!b) return;
    show(b.dataset.view);
  });
  function show(key) {
    view = key; filter = '';
    renderSide(); renderHead(); renderList();
    if (key === 'lobbys') loadLobbies();
  }

  function totalTime(tracks) { return tracks.reduce(function (n, t) { return n + (t.duration || 0); }, 0); }
  function renderHead() {
    if (view === 'lobbys') { head.innerHTML = lobbyListHead(); return; }
    if (view === 'lobby') { head.innerHTML = lobbyHead(); return; }
    var tracks = viewTracks(view), p = /^pl:/.test(view) ? playlist(view) : null;
    var names = { all: 'Alle Titel', sammlung: 'Sammlung', mitglieder: 'Von Mitgliedern hochgeladen', meine: 'Meine Titel' };
    var h = '<div class="mp-title"><b>' + (p ? '📃 ' + esc(p.title) : esc(names[view] || '')) + '</b> <small>' + tracks.length + ' Titel' +
      (totalTime(tracks) ? ' · ' + fmt(totalTime(tracks)) : '') + (p ? ' · ' + VIS_LABEL[p.visibility] + (p.mine ? '' : ' · von ' + esc(p.owner)) : '') + '</small></div>';
    h += '<div class="mp-tools"><input type="search" id="mp-filter" placeholder="🔍 Suchen" aria-label="Titel suchen">';
    if (lob) h += '<button type="button" class="small" data-act="lobby-add-view" title="Alle Titel dieser Liste in die Lobby">🎧 Alle in die Lobby</button>';
    else h += '<button type="button" class="small" data-act="play-view">▶ Alle abspielen</button>';
    if (p && p.mine) h += '<button type="button" class="small" data-act="edit-playlist">✎ Bearbeiten</button><button type="button" class="small danger" data-act="delete-playlist">🗑</button>';
    if (view === 'meine' && lib.quota) h += '<small>Speicher: ' + fmtSize(lib.quota.used) + ' von ' + fmtSize(lib.quota.total) + '</small>';
    h += '</div>';
    if (lob) h += '<p class="mp-hint">🎧 Du bist in einer Lobby: Ein Klick auf einen Titel fügt ihn der Warteschlange hinzu.</p>';
    head.innerHTML = h;
    var f = $('mp-filter');
    f.addEventListener('input', function () { filter = f.value.trim(); renderList(); });
  }
  function fmtSize(n) { return n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }

  function renderList() {
    if (view === 'lobbys') { renderLobbies(); return; }
    if (view === 'lobby') { renderQueue(); return; }
    var p = /^pl:/.test(view) ? playlist(view) : null, own = p && p.mine;
    var tracks = filtered(viewTracks(view));
    if (!tracks.length) {
      var empty = filter ? 'Nichts gefunden.' : p ? 'Diese Playlist ist noch leer. Füge Titel über ＋ in der Bibliothek hinzu.'
        : view === 'meine' ? (lib.canUpload ? 'Du hast noch nichts hochgeladen. Oben über 📤 Hochladen geht es los.' : 'Du hast noch nichts hochgeladen.')
          : 'Hier gibt es noch keine Musik.';
      list.innerHTML = '<p class="mp-empty">' + empty + '</p>';
      return;
    }
    var playingId = lob ? null : current && current.id;
    var rows = tracks.map(function (t, i) {
      var acts = '';
      if (lib.me) acts += '<button type="button" class="small" data-act="to-playlist" title="Zu einer Playlist hinzufügen">＋</button>';
      if (own) acts += '<button type="button" class="small" data-act="pl-up" title="Nach oben">▲</button><button type="button" class="small" data-act="pl-down" title="Nach unten">▼</button>' +
        '<button type="button" class="small" data-act="pl-remove" title="Aus der Playlist nehmen">✕</button>';
      else if (t.canEdit) acts += '<button type="button" class="small" data-act="edit-track" title="Bearbeiten">✎</button><button type="button" class="small danger" data-act="delete-track" title="Löschen">🗑</button>';
      return '<tr data-id="' + t.id + '" data-i="' + i + '" class="' + (t.id === playingId ? 'playing' : '') + (lob && !t.shareable ? ' locked' : '') + '">' +
        '<td class="num">' + (t.id === playingId ? (audio.paused ? '⏸' : '🔊') : i + 1) + '</td>' +
        '<td><button type="button" class="mp-track" data-act="play-track">' + esc(t.title) + '</button>' +
        (t.visibility !== 'public' ? ' <small title="' + VIS_LABEL[t.visibility] + '">' + (t.visibility === 'private' ? '🔒' : '👥') + '</small>' : '') + '</td>' +
        '<td>' + esc(t.artist) + '</td><td class="num">' + (t.duration ? fmt(t.duration) : '') + '</td>' +
        '<td class="mp-by">' + (t.byAdmin ? '' : userLink(t.by, t.byUser)) + '</td><td class="mp-acts">' + acts + '</td></tr>';
    }).join('');
    list.innerHTML = '<table class="list mp-table"><thead><tr><th class="num">#</th><th>Titel</th><th>Interpret</th><th class="num">Länge</th><th>Von</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), tr = e.target.closest('tr[data-id], tr[data-key], tr[data-lobby]');
    if (!b || !tr) return;
    var act = b.dataset.act;
    if (tr.dataset.lobby) { if (act === 'join') joinLobby(tr.dataset.lobby); return; }
    if (tr.dataset.key) { lobbyRowAction(act, tr.dataset.key); return; }
    var id = Number(tr.dataset.id), t = byId[id], tracks = filtered(viewTracks(view));
    if (act === 'play-track') { if (lob) lobbyAdd({ tracks: [id] }); else playList(tracks.map(function (x) { return x.id; }), Number(tr.dataset.i)); }
    else if (act === 'to-playlist') toPlaylist(id);
    else if (act === 'edit-track') editTrack(t);
    else if (act === 'delete-track') deleteTrack(t);
    else if (/^pl-/.test(act)) changePlaylist(playlist(view), Number(tr.dataset.i), act);
  });

  // ---------- Eigene Wiedergabe ----------
  var queue = [], order = [], pos = -1, current = null, counted = false;
  function makeOrder(start) {
    order = queue.map(function (x, i) { return i; });
    if (prefs.shuffle) {
      order.splice(start, 1);
      for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = order[i]; order[i] = order[j]; order[j] = x; }
      order.unshift(start);
      pos = 0;
    } else pos = start;
  }
  function playList(ids, start) {
    if (!ids.length) return;
    queue = ids.slice();
    makeOrder(Math.max(0, Math.min(start || 0, ids.length - 1)));
    loadTrack(byId[queue[order[pos]]]);
  }
  function loadTrack(t) {
    if (!t) return;
    current = t; counted = false;
    graph();
    audio.src = '/musik/stream/' + t.id;
    audio.play().catch(function () { /* wartet auf Klick */ });
    status('▶ ' + t.title + (t.artist ? ' – ' + t.artist : ''));
    nowPlaying();
    renderList();
    kick();
  }
  function nowPlaying() {
    var t = lob ? currentLobbyItem() : current;
    nowEl.textContent = t ? t.title + (t.artist ? ' – ' + t.artist : '') : '';
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = t ? new window.MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '' }) : null; } catch (e) { /* alt */ }
    }
  }
  function next(auto) {
    if (lob) { if (!auto) lobbyCtl('next'); return; }
    if (!queue.length) return;
    if (auto && prefs.repeat === 'einen') { audio.currentTime = 0; audio.play(); return; }
    pos++;
    if (pos >= order.length) {
      if (prefs.repeat !== 'alle' && auto) { pos = order.length - 1; stop(); status('Ende der Liste.'); return; }
      makeOrder(prefs.shuffle ? order[Math.floor(Math.random() * order.length)] : 0);
    }
    loadTrack(byId[queue[order[pos]]]);
  }
  function prev() {
    if (lob) { lobbyCtl('prev'); return; }
    if (!current) return;
    if (audio.currentTime > 3 || pos <= 0) { audio.currentTime = 0; return; }
    pos--;
    loadTrack(byId[queue[order[pos]]]);
  }
  function stop() {
    if (lob) { lobbyCtl('pause'); lobbyCtl('seek', { pos: 0 }); return; }
    audio.pause();
    if (audio.src) audio.currentTime = 0;
    renderList();
  }
  function playPause() {
    if (lob) { var s = lob.state; if (s) lobbyCtl(s.playing ? 'pause' : 'play'); return; }
    if (!current) { var ids = filtered(viewTracks(/^(lobby|lobbys)$/.test(view) ? 'all' : view)).map(function (t) { return t.id; }); playList(ids, 0); return; }
    graph();
    if (audio.paused) audio.play().catch(oops); else audio.pause();
  }

  audio.addEventListener('play', function () { updateButtons(); renderListSoon(); kick(); overlay.hidden = true; });
  audio.addEventListener('pause', function () { updateButtons(); renderListSoon(); });
  audio.addEventListener('ended', function () {
    countPlay();
    if (lob) { var it = currentLobbyItem(); if (it) lobbyCtl('ended', { key: it.key }, true); return; }
    next(true);
  });
  audio.addEventListener('timeupdate', function () { if (!counted && audio.currentTime > 30) countPlay(); });
  audio.addEventListener('loadedmetadata', function () {
    if (lob) syncLobby();
    // Titel aus der Systemsteuerung kennen ihre Länge erst jetzt; der Server erfährt sie mit dem Abspiel-Zähler
    else if (current && !current.duration && isFinite(audio.duration)) { current.duration = audio.duration; renderList(); }
    showTime();
  });
  audio.addEventListener('error', function () {
    if (!audio.src || !audio.error) return;
    status('⚠ Dieser Titel lässt sich nicht abspielen.');
    if (!lob) setTimeout(function () { next(true); }, 1500);
  });
  function countPlay() {
    if (counted || !current || lob) return;
    counted = true;
    post('/musik/titel/' + current.id + '/gespielt', { duration: audio.duration || 0 }).catch(function () {});
  }
  var listTimer = null;
  function renderListSoon() { clearTimeout(listTimer); listTimer = setTimeout(renderList, 50); }

  function updateButtons() {
    var playing = lob ? !!(lob.state && lob.state.playing) : !audio.paused;
    var b = btn('play');
    b.textContent = playing ? '⏸' : '▶'; b.title = playing ? 'Pause' : 'Abspielen';
    var sh = btn('shuffle'), rp = btn('repeat');
    sh.setAttribute('aria-pressed', prefs.shuffle); sh.classList.toggle('pressed', prefs.shuffle);
    rp.dataset.mode = prefs.repeat; rp.classList.toggle('pressed', prefs.repeat !== 'aus');
    rp.textContent = prefs.repeat === 'einen' ? '🔂' : '🔁';
    rp.title = 'Wiederholen: ' + { aus: 'aus', alle: 'alle', einen: 'diesen Titel' }[prefs.repeat];
    sh.disabled = rp.disabled = !!lob;
    var ctl = !lob || lobbyCanControl();
    ['play', 'stop', 'next', 'prev'].forEach(function (a) { btn(a).disabled = !ctl; });
    seek.disabled = !ctl;
  }

  // Zeitleiste
  var seeking = false;
  function timing() {
    if (lob) {
      var it = currentLobbyItem();
      if (!it) return { t: 0, d: 0 };
      return { t: lobbyPos(), d: it.duration || (it.type === 'yt' ? yt.duration : audio.duration) || 0 };
    }
    return { t: audio.currentTime || 0, d: isFinite(audio.duration) ? audio.duration : (current && current.duration) || 0 };
  }
  function showTime() {
    var x = timing();
    timeEl.textContent = fmt(Math.min(x.t, x.d || x.t));
    durEl.textContent = fmt(x.d);
    if (!seeking) seek.value = x.d ? Math.round(Math.min(1, x.t / x.d) * 1000) : 0;
  }
  seek.addEventListener('input', function () { seeking = true; var x = timing(); timeEl.textContent = fmt(seek.value / 1000 * x.d); });
  seek.addEventListener('change', function () {
    seeking = false;
    var x = timing(), to = seek.value / 1000 * x.d;
    if (lob) lobbyCtl('seek', { pos: to }); else if (current && x.d) audio.currentTime = to;
  });
  setInterval(function () { if (!looping) showTime(); }, 500);

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b || list.contains(b) || dlg.contains(b)) return;
    var a = b.dataset.act;
    if (a === 'play') playPause();
    else if (a === 'stop') stop();
    else if (a === 'next') next(false);
    else if (a === 'prev') prev();
    else if (a === 'shuffle') { prefs.shuffle = !prefs.shuffle; savePrefs(); if (queue.length && !lob) { var cur = order[pos]; makeOrder(cur); } updateButtons(); }
    else if (a === 'repeat') { prefs.repeat = { aus: 'alle', alle: 'einen', einen: 'aus' }[prefs.repeat] || 'aus'; savePrefs(); updateButtons(); }
    else if (a === 'fullscreen') fullscreen();
    else if (a === 'upload') upload();
    else if (a === 'new-playlist') newPlaylist([]);
    else if (a === 'lobbys') show(lob ? 'lobby' : 'lobbys');
    else if (a === 'play-view') { var ids = filtered(viewTracks(view)).map(function (t) { return t.id; }); if (ids.length) playList(ids, 0); }
    else if (a === 'lobby-add-view') lobbyAdd({ tracks: filtered(viewTracks(view)).map(function (t) { return t.id; }) });
    else if (a === 'edit-playlist') editPlaylist(playlist(view));
    else if (a === 'delete-playlist') deletePlaylist(playlist(view));
    else if (a === 'lobby-create') createLobby();
    else if (a === 'lobby-refresh') loadLobbies();
    else if (a === 'lobby-leave') leaveLobby();
    else if (a === 'lobby-link') copyLink();
    else if (a === 'lobby-settings') lobbySettings();
    else if (a === 'lobby-user') lobbyUser(Number(b.dataset.user));
    else if (a === 'lobby-close') closeLobby();
    else if (a === 'lobby-clear') confirmBox('Warteschlange leeren', 'Alle Lieder aus der Warteschlange nehmen?', 'Leeren').then(function (ok) { if (ok) lobbyCtl('clear'); });
    else if (a === 'yt-add') addYoutube();
    else if (a === 'yt-allow') allowYoutube();
    else if (a === 'unblock') { overlay.hidden = true; graph(); if (lob) syncLobby(); else audio.play().catch(oops); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' || dlg.open || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
    e.preventDefault(); playPause();
  });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', playPause);
      navigator.mediaSession.setActionHandler('pause', playPause);
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('nexttrack', function () { next(false); });
    } catch (e) { /* nicht unterstützt */ }
  }

  // ---------- Hochladen ----------
  function measure(file) {
    return new Promise(function (resolve) {
      var a = new Audio(), url = URL.createObjectURL(file), done = function (d) { URL.revokeObjectURL(url); resolve(d); };
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', function () { done(isFinite(a.duration) ? a.duration : 0); });
      a.addEventListener('error', function () { done(0); });
      setTimeout(function () { done(0); }, 6000);
      a.src = url;
    });
  }
  function upload() {
    var q = lib.quota;
    dialog('📤 Musik hochladen',
      '<label>Audiodateien (MP3, OGG, WAV, FLAC, M4A …):<input type="file" name="files" multiple accept="audio/*,.mp3,.ogg,.oga,.opus,.wav,.flac,.m4a,.aac"></label>' +
      '<label>Wer darf zuhören?<select name="visibility">' + visOptions(lib.me && lib.me.admin ? 'public' : 'members') + '</select></label>' +
      '<p><small>Titel und Interpret kommen aus der Datei oder dem Dateinamen („Interpret - Titel.mp3“) und lassen sich danach ändern.' +
      (q ? ' Pro Titel höchstens 50 MB, insgesamt ' + fmtSize(q.total) + ' (belegt: ' + fmtSize(q.used) + ').' : '') +
      ' Lade nur Musik hoch, die du teilen darfst. Nur öffentliche und für Mitglieder sichtbare Titel lassen sich in Lobbys abspielen.</small></p>',
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
      '<label>Interpret:<input type="text" name="artist" class="w100" maxlength="200" value="' + esc(t.artist) + '"></label>' +
      '<label>Album:<input type="text" name="album" class="w100" maxlength="200" value="' + esc(t.album) + '"></label>' +
      '<label>Wer darf zuhören?<select name="visibility">' + visOptions(t.visibility) + '</select></label>',
      [{ label: 'Speichern', value: 'ok' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r !== 'ok') return;
      post('/musik/titel/' + t.id, { title: field('title'), artist: field('artist'), album: field('album'), visibility: field('visibility') })
        .then(function () { status('Gespeichert.'); return load(); }).catch(oops);
    });
  }
  function deleteTrack(t) {
    confirmBox('Titel löschen', '„' + esc(t.title) + '“ endgültig löschen? Er verschwindet auch aus allen Playlists.', 'Löschen').then(function (ok) {
      if (!ok) return;
      if (current && current.id === t.id) { audio.pause(); audio.removeAttribute('src'); current = null; nowPlaying(); }
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
    dialog('＋ Zur Playlist', html, [{ label: '➕ Neue Playlist …', value: 'new' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
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
    return '<div class="mp-title"><b>🎧 Lobbys</b> <small>Gemeinsam hören: Alle in einer Lobby hören dasselbe Lied zur selben Zeit.</small></div>' +
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

  function joinLobby(id) {
    if (!lib.me) { status('Für Lobbys musst du angemeldet sein.'); return; }
    if (lob && lob.id === id) { show('lobby'); return; }
    if (lob) leaveLobby(true);
    audio.pause(); queue = []; current = null;
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
    view = 'lobby';
    status('Trete der Lobby bei …');
    renderSide(); renderHead(); renderList(); updateButtons();
  }
  function leaveLobby(quiet, msg) {
    if (!lob) return;
    lob.es.close(); clearInterval(lob.timer);
    lob = null;
    audio.pause(); audio.removeAttribute('src'); current = null;
    ytStop();
    overlay.hidden = true;
    nowPlaying();
    if (!quiet) { status(msg || 'Lobby verlassen.'); if (view === 'lobby') view = 'lobbys'; renderSide(); renderHead(); renderList(); updateButtons(); loadLobbies(); }
    modeEl.textContent = '💿 Eigene Wiedergabe';
  }
  function onLobbyState(s) {
    if (!lob) return;
    var first = !lob.state;
    lob.state = s;
    lob.offset = s.now - Date.now();
    if (first) status('Du bist in der Lobby „' + s.name + '“.');
    modeEl.textContent = '🎧 ' + s.name + ' · ' + s.listeners.length + ' hören zu';
    renderSide();
    if (view === 'lobby') { renderHead(); renderList(); }
    updateButtons();
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

  // Bringt Audio oder YouTube-Player auf die Stelle, an der die Lobby gerade ist
  function syncLobby() {
    if (!lob || !lob.state) return;
    var s = lob.state, it = currentLobbyItem();
    if (lob.key !== (it && it.key)) { lob.key = it && it.key; nowPlaying(); }
    if (!it) { audio.pause(); ytStop(); return; }
    var target = lobbyPos();
    if (it.type === 'track') {
      ytStop();
      if (current !== it) { current = it; }
      var src = '/musik/stream/' + it.trackId;
      if (audio.getAttribute('src') !== src) { audio.src = src; return; } // weiter nach loadedmetadata
      if (audio.readyState < 1) return;
      if (it.duration && target >= it.duration) { if (!audio.paused) audio.pause(); return; } // der Server wechselt gleich
      if (Math.abs(audio.currentTime - target) > 0.4) audio.currentTime = target;
      if (s.playing && audio.paused) {
        audio.play().then(function () { overlay.hidden = true; }).catch(function () { blocked(); });
      } else if (!s.playing && !audio.paused) audio.pause();
      kick();
    } else {
      audio.pause();
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
    var h = '<div class="mp-title"><b>🔴 ' + esc(s.name) + '</b> <small>Gastgeber: ' + esc(s.host) + ' · ' + (s.open ? 'alle dürfen steuern' : 'nur der Gastgeber steuert') +
      '</small></div><div class="mp-users" title="Auf einen Namen klicken für mehr">👥 ' + s.listeners.length + ': ' + s.listeners.map(function (u) {
        return '<button type="button" class="small mp-user' + (lib.me && u.id === lib.me.id ? ' me' : '') + '" data-act="lobby-user" data-user="' + u.id + '">' +
          (u.host ? '👑 ' : u.control ? '🎶 ' : '') + esc(u.name) + '</button>';
      }).join('') + '</div><div class="mp-tools">' +
      '<button type="button" class="small" data-act="lobby-link">🔗 Einladungslink</button>' +
      (host ? '<button type="button" class="small" data-act="lobby-settings">⚙️ Einstellungen</button>' : '') +
      (lobbyCanControl() ? '<button type="button" class="small" data-act="lobby-clear">🧹 Leeren</button>' : '') +
      '<button type="button" class="small" data-act="lobby-leave">🚪 Verlassen</button>' +
      (host ? '<button type="button" class="small danger" data-act="lobby-close">✖ Lobby schließen</button>' : '') + '</div>';
    if (lobbyCanControl()) {
      h += '<div class="mp-tools">' + (CAN_YT ? '<input type="text" id="mp-yt-url" class="mp-yt-url" placeholder="YouTube-Link zu einem Video oder einer Playlist einfügen"><button type="button" class="small" data-act="yt-add">＋ YouTube</button>' : '') +
        '<small>Eigene Musik: links einen Bereich oder eine Playlist wählen und Titel anklicken.</small></div>';
    }
    return h;
  }
  function renderQueue() {
    var s = lob && lob.state;
    if (!s) { list.innerHTML = '<p class="mp-empty">Verbinde mit der Lobby …</p>'; return; }
    if (!s.queue.length) { list.innerHTML = '<p class="mp-empty">Die Warteschlange ist leer. Füge Lieder aus deiner Bibliothek' + (CAN_YT ? ' oder von YouTube' : '') + ' hinzu.</p>'; return; }
    var ctl = lobbyCanControl();
    list.innerHTML = '<table class="list mp-table"><thead><tr><th class="num">#</th><th>Titel</th><th>Interpret</th><th class="num">Länge</th><th>Von</th><th></th></tr></thead><tbody>' +
      s.queue.map(function (q, i) {
        var now = i === s.index;
        return '<tr data-key="' + esc(q.key) + '" class="' + (now ? 'playing' : i < s.index ? 'done' : '') + '"><td class="num">' + (now ? (s.playing ? '🔊' : '⏸') : i + 1) + '</td>' +
          '<td><button type="button" class="mp-track" data-act="jump"' + (ctl ? '' : ' disabled') + '>' + esc(q.title) + '</button>' + (q.type === 'yt' ? ' <small class="mp-ytbadge">YouTube</small>' : '') + '</td>' +
          '<td>' + esc(q.artist) + '</td><td class="num">' + (q.duration ? fmt(q.duration) : '') + '</td><td class="mp-by">' + userLink(q.by, q.byUser) + '</td><td class="mp-acts">' +
          (ctl ? '<button type="button" class="small" data-act="up" title="Nach oben">▲</button><button type="button" class="small" data-act="down" title="Nach unten">▼</button><button type="button" class="small" data-act="remove" title="Entfernen">✕</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function lobbyRowAction(act, key) {
    if (act === 'jump') lobbyCtl('jump', { key: key });
    else if (act === 'up' || act === 'down') lobbyCtl('move', { key: key, by: act === 'up' ? -1 : 1 });
    else if (act === 'remove') lobbyCtl('remove', { key: key });
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
  // Klick auf einen Zuhörer: was man mit ihm machen kann
  function lobbyUser(id) {
    var s = lob.state, u = s.listeners.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    var acts = [];
    if (u.user) acts.push({ label: '👤 Profil ansehen', value: 'profile' });
    if (lib.me && lib.me.admin) acts.push({ label: '⚙️ In der Systemsteuerung', value: 'account' });
    if (lobbyIsHost() && !u.host) acts.push(u.control ? { label: '🚫 Player-Rechte entziehen', value: 'revoke' } : { label: '🎶 Player-Rechte geben', value: 'grant' });
    acts.push({ label: 'Schließen', value: 'cancel' });
    dialog('👤 ' + u.name, '<p>' + (u.host ? '👑 Gastgeber dieser Lobby.' : u.control ? '🎶 Darf den Player steuern und Lieder hinzufügen.' : '🎧 Hört nur zu.') + '</p>', acts).then(function (r) {
      if (r === 'profile') openPage(profileUrl(u.user));
      else if (r === 'account') window.open('/admin/users/' + u.id, '_blank');
      else if (r === 'grant' || r === 'revoke') lobbyCtl('rights', { user: u.id, allow: r === 'grant' });
    });
  }
  function lobbySettings() {
    var s = lob.state;
    dialog('⚙️ Lobby-Einstellungen',
      '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(s.name) + '"></label>' +
      '<label class="inline"><input type="checkbox" name="open"' + (s.open ? ' checked' : '') + '> Alle dürfen steuern und Lieder hinzufügen</label><br>' +
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
  var YT = 'https://www.youtube-nocookie.com', YT_KEY = 'youtube-erlaubt', ytOk = false;
  var yt = { frame: null, ready: false, videoId: null, state: -1, time: 0, timeAt: 0, duration: 0, title: '', tries: 0 };
  function ytAllowed() { if (ytOk) return true; try { return localStorage.getItem(YT_KEY) === '1'; } catch (e) { return false; } }
  function ytConsent() {
    ytBox.hidden = true;
    overlay.innerHTML = '<div class="mp-consent"><p><b>▶️ Dieses Lied kommt von YouTube.</b></p><p>Zum Abspielen lädt dein Browser den Player von youtube-nocookie.com. ' +
      'Dabei bekommt YouTube (Google) deine IP-Adresse und Angaben zu deinem Browser. Bei YouTube-Liedern gibt es keine Visualisierung.</p>' +
      '<button type="button" data-act="yt-allow">YouTube laden</button> <label class="inline"><input type="checkbox" id="mp-yt-remember"> Für diesen Browser merken</label></div>';
    overlay.hidden = false;
  }
  function allowYoutube() {
    ytOk = true;
    if ($('mp-yt-remember') && $('mp-yt-remember').checked) { try { localStorage.setItem(YT_KEY, '1'); } catch (e) { /* nur für jetzt */ } }
    overlay.hidden = true;
    if (lob) syncLobby();
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
  }
  function ytSync(it, target, playing) {
    ytBox.hidden = false;
    if (yt.videoId !== it.videoId || !yt.frame) { ytLoad(it.videoId, target); return; }
    if (!yt.ready) return;
    var est = yt.state === 1 ? yt.time + (Date.now() - yt.timeAt) / 1000 : yt.time;
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
  var ytLists = [];
  window.addEventListener('message', function (e) {
    if (e.origin !== YT || typeof e.data !== 'string') return;
    var d;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    var pl = ytLists.filter(function (x) { return x.frame.contentWindow === e.source; })[0];
    if (pl) { if (d.info && d.info.playlist && d.info.playlist.length) pl.done(d.info.playlist); return; }
    if (!yt.frame || e.source !== yt.frame.contentWindow) return;
    if (d.event === 'onReady') { yt.ready = true; applyVolume(); syncLobby(); }
    if (d.event === 'onStateChange') { yt.state = d.info; if (d.info === 0) ytEnded(); }
    if (d.event === 'onError') { status('⚠ Dieses YouTube-Video lässt sich hier nicht abspielen (gesperrt oder gelöscht).'); setTimeout(ytEnded, 2000); }
    if (d.event === 'infoDelivery' && d.info) {
      var i = d.info;
      if (typeof i.currentTime === 'number') { yt.time = i.currentTime; yt.timeAt = Date.now(); }
      if (typeof i.playerState === 'number') { var was = yt.state; yt.state = i.playerState; if (i.playerState === 0 && was !== 0) ytEnded(); }
      if (i.duration) yt.duration = i.duration;
      if (i.videoData && i.videoData.title) yt.title = i.videoData.title;
    }
  });
  function ytEnded() {
    var it = currentLobbyItem();
    if (it && it.type === 'yt' && !lob.ended[it.key]) { lob.ended[it.key] = true; lobbyCtl('ended', { key: it.key }, true); }
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
  function addYoutube() {
    var inp = $('mp-yt-url'), p = parseYoutube(inp.value);
    if (!p.videos.length && !p.lists.length) { status('Das sieht nicht nach einem YouTube-Link aus.'); return; }
    if (p.lists.length && !ytAllowed()) { ytConsent(); status('Zum Einlesen einer Playlist muss der YouTube-Player geladen werden.'); return; }
    status('Lese YouTube-Links …');
    p.lists.reduce(function (chain, id) {
      return chain.then(function (all) { return ytPlaylist(id).then(function (ids) { return all.concat(ids); }); });
    }, Promise.resolve([])).then(function (fromLists) {
      inp.value = '';
      lobbyAdd({ youtube: p.videos.concat(fromLists) });
    }).catch(oops);
  }

  // ---------- Start ----------
  applyVolume();
  updateButtons();
  load().then(function () {
    var want = new URLSearchParams(location.search).get('lobby');
    if (want && CAN_LOBBY) {
      if (lib.me) joinLobby(want); else status('Melde dich an, um der Lobby beizutreten.');
    }
  });
  kick();
  window.addEventListener('pagehide', function () { if (lob) lob.es.close(); });
})();
