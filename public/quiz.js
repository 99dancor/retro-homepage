// Quiz (Startmenü → Spiele und Apps → ❓ Quiz): Startauswahl, Räume, Spieler- und Spielleiter-Oberfläche.
// Den Raum schickt der Server per Server-Sent Events (/quiz/<code>/events): „state“ mit allem, was diese Person
// sehen darf, und „input“ für getippte Antworten (an den Spielleiter, beim Buzzer an alle). Eingaben gehen per
// POST mit dem Formular-Token im Kopf x-csrf-token. Timer, Buzzer-Reihenfolge und Wertung macht der Server.
(function () {
  'use strict';
  var root = document.getElementById('qz');
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, MEMBER = !!root.dataset.member, MYNAME = root.dataset.name;
  var EMOJIS = root.dataset.emojis.split(' '), COLORS = root.dataset.colors.split(' ');
  var DEF = JSON.parse(root.dataset.defaults);
  var main = $('qz-main'), nav = $('qz-nav'), statusEl = $('qz-status'), keysEl = $('qz-keys'), dlg = $('qz-dlg'), fileInput = $('qz-file');
  var Sound = window.RetroSound || { play: function () {} };
  var TYPE = { buzzer: '🔴 Buzzer', mc: '🔤 Multiple Choice', tf: '✅ Wahr/Falsch', estimate: '📏 Schätzen', text: '✏️ Freitext' };
  var LETTERS = ['A', 'B', 'C', 'D'];
  var ESTIMATE = { all: 'Nächster bekommt alles', top3: 'Top 3 (100 / 60 / 30 %)', scaled: 'Nach Abstand gestaffelt' };

  var code = null, es = null, S = null, recvAt = 0, startData = null, pollTimer = null;
  var myText = '', myTextQ = null, availAt = 0, availKey = '';
  var selId = null, edit = null, editKey = '', lastCur = null, givePts = 10, inputs = {};
  var lastPhase = '', lastTick = -1;

  // ---------- Kleinkram ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pts(n) { n = Number(n) || 0; return (n < 0 ? '−' : n > 0 ? '+' : '±') + Math.abs(n).toLocaleString('de-DE'); }
  function num(n) { return (Number(n) || 0).toLocaleString('de-DE'); }
  function status(text) { statusEl.textContent = text; }
  function req(method, url, body) {
    var opts = { method: method, headers: { 'x-csrf-token': CSRF, accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Fehler ' + r.status); e.data = j; throw e; }
        return j;
      });
    });
  }
  function oops(e) { status('⚠ ' + e.message); Sound.play('fehler'); }
  function act(body) { return req('POST', '/quiz/' + code, body).catch(oops); }
  function dialog(title, html, buttons) {
    $('qz-dlg-title').textContent = title;
    $('qz-dlg-body').innerHTML = html;
    var acts = $('qz-dlg-actions');
    acts.innerHTML = '';
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.value = b.value; el.innerHTML = b.label;
      if (b.danger) el.className = 'danger';
      acts.appendChild(el);
    });
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function () { resolve(dlg.returnValue || 'cancel'); }, { once: true });
      dlg.returnValue = '';
      if (dlg.open) dlg.close();
      dlg.showModal();
      var first = dlg.querySelector('input:not([type=checkbox]):not([type=radio]), select');
      if (first) first.focus();
    });
  }
  function field(name) { var el = dlg.querySelector('[name=' + name + ']'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; }
  // Nach Eingaben fragen, die nachfolgenden Tastendrücke stören nicht; trailing: der letzte Stand geht immer raus
  function throttle(fn, ms) {
    var t = null, last = 0, args = null;
    return function () {
      args = arguments;
      var wait = ms - (Date.now() - last);
      if (wait <= 0) { clearTimeout(t); t = null; last = Date.now(); fn.apply(null, args); }
      else if (!t) t = setTimeout(function () { t = null; last = Date.now(); fn.apply(null, args); }, wait);
    };
  }
  // Inhalt tauschen, ohne dass das Feld, in dem man gerade tippt, den Fokus oder die Schreibmarke verliert
  function patch(el, html) {
    var a = document.activeElement, keep = null, scroll = {};
    if (a && el.contains(a) && a.dataset && a.dataset.k) keep = { k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd };
    el.querySelectorAll('[data-scroll]').forEach(function (s) { scroll[s.dataset.scroll] = s.scrollTop; });
    el.innerHTML = html;
    el.querySelectorAll('[data-scroll]').forEach(function (s) { if (scroll[s.dataset.scroll]) s.scrollTop = scroll[s.dataset.scroll]; });
    if (keep) {
      var n = el.querySelector('[data-k="' + keep.k + '"]');
      if (n) { n.focus(); try { if (keep.s != null) n.setSelectionRange(keep.s, keep.e); } catch (e) { /* select, Zahl */ } }
    }
  }
  function typing() { var a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio'; }

  function av(p, size) {
    size = size || 28;
    var st = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.6) + 'px;';
    if (p.avatar) return '<img class="qz-av" src="' + esc(p.avatar) + '" alt="" width="' + size + '" height="' + size + '">';
    var ch = p.emoji || (Array.from(p.name || '?')[0] || '?').toUpperCase();
    return '<span class="qz-av" style="' + st + 'background:' + esc(p.color || '#5d6d7e') + '" aria-hidden="true">' + esc(ch) + '</span>';
  }
  function who(p, opts) {
    opts = opts || {};
    var name = '<span class="qz-name">' + esc(p.name) + '</span>' + (p.guest ? ' <span class="qz-guest">(Gast)</span>' : '');
    if (p.user) return '<a href="#" class="userlink qz-userlink" data-user="' + esc(p.user) + '" data-pid="' + esc(p.pid) + '">' + name + '</a>';
    return '<span class="qz-userlink" data-pid="' + esc(p.pid) + '"' + (opts.host ? ' role="button" tabindex="0"' : '') + '>' + name + '</span>';
  }
  function player(pid) { return S && S.players.filter(function (p) { return p.pid === pid; })[0] || { name: '?', pid: pid }; }
  function deltaHtml(d) { return '<span class="qz-d ' + (d > 0 ? 'plus' : d < 0 ? 'minus' : 'zero') + '">' + pts(d) + '</span>'; }

  // ---------- Startseite ----------
  function showStart() {
    code = null; S = null;
    if (es) { es.close(); es = null; }
    try { history.replaceState(null, '', '/quiz'); } catch (e) { /* egal */ }
    document.title = 'Quiz';
    nav.innerHTML = '<a href="#" data-nav="start" class="active">❓ Quiz</a><span class="spacer"></span><span class="qz-me">' + (MEMBER ? '👤 ' + esc(MYNAME) : '👤 Gast · <a href="/login?next=/quiz">Anmelden</a>') + '</span>';
    keysEl.textContent = '';
    loadStart();
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!code && !document.hidden) loadStart(); }, 5000);
  }
  function loadStart() {
    return req('GET', '/quiz/raeume').then(function (j) { startData = j; if (!code) renderStart(); }).catch(oops);
  }
  function renderStart() {
    var j = startData;
    var rows = j.rooms.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b>' + (r.title ? '<br><small>' + esc(r.title) + '</small>' : '') + '</td><td>' + esc(r.host) + '</td><td class="num">' + r.players + '</td><td>' + esc(r.status) +
        (r.locked ? ' 🔒' : '') + (!r.guests && !MEMBER ? ' <small>(nur Mitglieder)</small>' : '') + '</td><td class="qz-acts"><button type="button" class="small" data-enter="' + esc(r.code) + '">Beitreten</button></td></tr>';
    }).join('');
    var mine = j.mine.map(function (r) { return '<button type="button" class="small" data-enter="' + esc(r.code) + '">' + (r.host ? '🎤 ' : '🙋 ') + esc(r.name) + ' (' + esc(r.code) + ')</button>'; }).join(' ');
    patch(main, '<div class="qz-pad">' +
      '<div class="qz-choice"><button type="button" class="qz-big" data-act="create"' + (j.canHost ? '' : ' disabled title="Räume eröffnen ist gerade nicht erlaubt"') + '><span class="ico">🎤</span>Quiz erstellen<small>Raum als Spielleiter öffnen</small></button>' +
      '<button type="button" class="qz-big" data-act="focus-code"><span class="ico">🙋</span>Raum beitreten<small>als Spieler mitraten</small></button></div>' +
      '<form class="qz-codeform" id="qz-codeform">Raumcode: <input type="text" id="qz-code" data-k="code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="K7QX"> <button>Beitreten</button></form>' +
      (mine ? '<p class="qz-center">Zurück in: ' + mine + '</p>' : '') +
      '<fieldset class="groupbox"><legend>Offene Räume</legend>' +
      (rows ? '<table class="list"><thead><tr><th>Raum</th><th>Spielleiter</th><th class="num">Spieler</th><th>Stand</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="qz-empty">Gerade ist kein Raum offen. Mach einen auf und schick den anderen den Link.</p>') +
      '<p><small>Versteckte Räume stehen nicht in der Liste, dort kommt man nur über den Einladungslink oder den Code hinein.' +
      (!j.canHost && !MEMBER ? ' Zum Eröffnen eines Raums musst du <a href="/login?next=/quiz">angemeldet</a> sein.' : '') + '</small></p></fieldset></div>');
    status(j.rooms.length + (j.rooms.length === 1 ? ' offener Raum' : ' offene Räume'));
  }
  function createRoom() {
    var d = DEF;
    dialog('🎤 Quiz erstellen',
      '<label class="qz-row"><span>Name des Raums</span><input name="name" maxlength="60" placeholder="z. B. Freitagsquiz"></label>' +
      (MEMBER ? '' : '<label class="qz-row"><span>Dein Name</span><input name="hostName" maxlength="24" required></label><p><small>Ohne Anmeldung kannst du live spielen. Fragen auf dem Server speichern geht nur angemeldet, du kannst sie aber als Datei mitnehmen.</small></p>') +
      '<label class="inline"><input type="checkbox" name="list" checked> In der Liste offener Räume zeigen</label><br>' +
      '<label class="inline"><input type="checkbox" name="guests" checked> Gäste ohne Konto dürfen mitspielen</label>' +
      '<p><small>Zeiten und Punkte stellst du gleich im Warteraum ein (Standard: ' + d.time + ' s, richtig ' + pts(d.right) + ', falsch ' + pts(d.wrong) + ').</small></p>',
      [{ value: 'ok', label: '<b>Raum öffnen</b>' }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) {
      if (v !== 'ok') return;
      req('POST', '/quiz/raeume', { name: field('name'), hostName: field('hostName'), hidden: !field('list'), guests: field('guests') })
        .then(function (j) { enter(j.code); })
        .catch(function (e) { oops(e); if (e.data && e.data.login) location.href = '/login?next=/quiz'; });
    });
  }

  // ---------- Raum betreten ----------
  function enter(c) {
    c = String(c || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return oops(new Error('Ein Raumcode hat vier Zeichen.'));
    req('GET', '/quiz/' + c + '/info').then(function (info) {
      if (info.isHost || info.joined) return connect(info.code);
      if (MEMBER) return join(info, {});
      if (!info.guests) {
        return dialog('🙋 Raum beitreten', '<p>In <b>„' + esc(info.name) + '“</b> spielen nur angemeldete Mitglieder mit.</p>',
          [{ value: 'login', label: 'Anmelden' }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) { if (v === 'login') location.href = '/login?next=/quiz/' + info.code; });
      }
      guestDialog(info);
    }).catch(function (e) { oops(e); if (!code) showStart(); });
  }
  function guestDialog(info, err) {
    var pick = EMOJIS[Math.floor(Math.random() * EMOJIS.length)], color = COLORS[Math.floor(Math.random() * COLORS.length)];
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('quiz-gast')) || {}; } catch (e) { /* privat */ }
    if (EMOJIS.indexOf(saved.emoji) >= 0) pick = saved.emoji;
    if (COLORS.indexOf(saved.color) >= 0) color = saved.color;
    var html = (err ? '<p class="qz-err">⚠ ' + esc(err) + '</p>' : '') +
      '<p style="margin-top:0"><b>' + esc(info.host) + '</b> spielt <b>„' + esc(info.name) + '“</b>. ' + (info.players === 1 ? 'Ein Spieler ist' : num(info.players) + ' Spieler sind') + ' schon da.</p>' +
      '<label class="qz-row"><span>Dein Name</span><input name="name" maxlength="24" value="' + esc(saved.name || '') + '" required></label>' +
      '<div class="qz-row"><span>Dein Bild</span><div class="qz-pick" id="qz-pick-emoji">' + EMOJIS.map(function (e) {
        return '<button type="button" class="qz-av" data-emoji="' + e + '" aria-pressed="' + (e === pick) + '" style="background:' + color + '">' + e + '</button>';
      }).join('') + '</div></div>' +
      '<div class="qz-row"><span>Farbe</span><div class="qz-pick" id="qz-pick-color">' + COLORS.map(function (c) {
        return '<button type="button" class="qz-swatch" data-color="' + c + '" aria-pressed="' + (c === color) + '" style="background:' + c + '" aria-label="Farbe"></button>';
      }).join('') + '</div></div>' +
      '<p><small>Du erscheinst als <b>(Gast)</b>. Mitglied? <a href="/login?next=/quiz/' + esc(info.code) + '">Anmelden</a>, dann spielst du mit deinem Profilbild und die Punkte zählen in deiner Statistik.</small></p>';
    var p = dialog('🙋 Raum beitreten', html, [{ value: 'ok', label: '<b>Beitreten</b>' }, { value: 'cancel', label: 'Abbrechen' }]);
    dlg.onclick = function (e) {
      var b = e.target.closest('[data-emoji],[data-color]');
      if (!b) return;
      if (b.dataset.emoji) pick = b.dataset.emoji;
      if (b.dataset.color) { color = b.dataset.color; dlg.querySelectorAll('[data-emoji]').forEach(function (x) { x.style.background = color; }); }
      dlg.querySelectorAll('[data-emoji]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.emoji === pick)); });
      dlg.querySelectorAll('[data-color]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.color === color)); });
    };
    p.then(function (v) {
      dlg.onclick = null;
      if (v !== 'ok') { if (!code) showStart(); return; }
      var name = field('name');
      try { localStorage.setItem('quiz-gast', JSON.stringify({ name: name, emoji: pick, color: color })); } catch (e) { /* privat */ }
      join(info, { name: name, emoji: pick, color: color });
    });
  }
  function join(info, data) {
    req('POST', '/quiz/' + info.code + '/beitreten', data).then(function () { Sound.play('oeffnen'); connect(info.code); })
      .catch(function (e) {
        if (!MEMBER && !e.data.login && /Namen/.test(e.message)) return guestDialog(info, e.message);
        oops(e);
        if (!code) showStart();
      });
  }
  function connect(c) {
    clearInterval(pollTimer);
    if (es) es.close();
    code = c; S = null; selId = null; edit = null; editKey = ''; lastCur = null; inputs = {}; myText = ''; myTextQ = null;
    try { history.replaceState(null, '', '/quiz/' + c); } catch (e) { /* egal */ }
    main.innerHTML = '<p class="qz-empty">Verbinde …</p>';
    es = new EventSource('/quiz/' + c + '/events');
    es.addEventListener('state', function (e) { onState(JSON.parse(e.data)); });
    es.addEventListener('input', function (e) { onInput(JSON.parse(e.data)); });
    es.addEventListener('closed', function (e) {
      var m = JSON.parse(e.data).message;
      if (es) es.close();
      es = null;
      dialog('❓ Quiz', '<p>' + esc(m) + '</p>', [{ value: 'ok', label: 'OK' }]).then(showStart);
    });
    es.onerror = function () {
      if (!es) return;
      status('⚠ Verbindung weg, verbinde neu …');
      if (es.readyState === 2) {   // Server sagt nein (Raum weg oder nicht mehr dabei)
        es = null;
        req('GET', '/quiz/' + c + '/info').then(function () { enter(c); }).catch(function (err) { dialog('❓ Quiz', '<p>' + esc(err.message) + '</p>', [{ value: 'ok', label: 'OK' }]).then(showStart); });
      }
    };
    es.onopen = function () { status('Verbunden.'); };
  }

  // ---------- Live-Daten ----------
  function onState(s) {
    var prev = S;
    var before = prev && prev.isHost && s.isHost ? prev.questions.map(function (q) { return q.id; }) : null;
    S = s; recvAt = performance.now();
    document.title = 'Quiz – ' + s.name;
    if (s.isHost) inputs = s.inputs || {};
    var q = s.q;
    if (!s.isHost && q && (myTextQ !== q.id + ':' + s.cur)) { myTextQ = q.id + ':' + s.cur; myText = s.my && s.my.input || ''; }
    if (!s.isHost && s.my && s.phase === 'open' && q && (q.type === 'estimate' || q.type === 'text') && document.activeElement && document.activeElement.dataset.k !== 'answer') myText = s.my.answer || '';
    // Seit wann ist der Buzzer frei? Danach misst der Browser die eigene Reaktionszeit
    var key = s.phase === 'open' && q && q.type === 'buzzer' && s.buzz && !s.buzz.answering && s.timer && !s.timer.paused ? s.cur + ':' + s.buzz.tried.length + ':' + q.id : '';
    if (key && key !== availKey) availAt = performance.now();
    availKey = key;
    sounds(prev, s);
    if (s.isHost && s.cur !== lastCur) { lastCur = s.cur; var cq = s.questions[s.cur]; if (cq) selId = cq.id; }
    // Nach „➕ Frage“ die neue gleich zum Bearbeiten auswählen
    if (before && s.questions.length === before.length + 1 && prev.cur === s.cur) {
      var fresh = s.questions.filter(function (q) { return before.indexOf(q.id) < 0; })[0];
      if (fresh && fresh.id !== (s.questions[s.cur] || {}).id) { selId = fresh.id; editKey = ''; }
    }
    render();
  }
  function sounds(a, b) {
    if (!a) return;
    if (a.phase !== b.phase) {
      if (b.phase === 'open') Sound.play('oeffnen');
      if (b.phase === 'reveal') Sound.play(b.result && b.result.rights && b.result.rights.length ? 'ding' : 'hinweis');
      if (b.phase === 'end') Sound.play('tusch');
    }
    var ab = a.buzz && a.buzz.answering, bb = b.buzz && b.buzz.answering;
    if (bb && bb !== ab) Sound.play('hinweis');
    if (a.phase === 'open' && b.phase === 'open' && ab && !bb && b.buzz) Sound.play('fehler');
  }
  function onInput(d) {
    inputs[d.pid] = d.text;
    if (S && S.buzz && S.buzz.answering === d.pid) S.buzz.text = d.text;
    document.querySelectorAll('[data-live="' + d.pid + '"]').forEach(function (el) { el.textContent = d.text || ''; el.classList.toggle('empty', !d.text); });
  }
  function timeLeft() {
    if (!S || !S.timer) return 0;
    return S.timer.paused ? S.timer.left : Math.max(0, S.timer.left - (performance.now() - recvAt));
  }
  setInterval(function () {
    var el = main.querySelectorAll('[data-timer]');
    if (!el.length || !S || !S.timer) return;
    var left = timeLeft(), sec = Math.ceil(left / 1000), total = S.timer.total || 1;
    el.forEach(function (t) {
      var d = t.querySelector('.qz-time'), bar = t.querySelector('.qz-bar i');
      if (d) { d.textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); d.classList.toggle('warn', sec <= 5); d.classList.toggle('paused', !!S.timer.paused); }
      if (bar) { bar.style.width = Math.max(0, Math.min(100, left / total * 100)) + '%'; bar.classList.toggle('warn', sec <= 5); }
    });
    if (!S.timer.paused && sec <= 5 && sec > 0 && sec !== lastTick) Sound.play('klick');
    lastTick = sec;
  }, 100);

  function render() {
    if (!S) return;
    renderNav();
    if (S.isHost) renderHost(); else renderPlayer();
  }
  function renderNav() {
    var h = '';
    if (S.isHost) {
      h = '<a href="#" data-act="new-quiz">📄 Neues Quiz</a><a href="#" data-act="load">📂 Quiz laden</a><a href="#" data-act="save">💾 Speichern</a><a href="#" data-act="room">⚙️ Raum</a><a href="#" data-act="close-room">🚪 Raum schließen</a>';
    } else {
      h = '<a href="#" data-act="leave">🚪 Raum verlassen</a>';
    }
    h += '<span class="spacer"></span><span class="qz-me">' + (S.isHost ? '🎤 ' : '') + 'Raum <b>' + esc(S.code) + '</b> · ' + esc(S.name) +
      ' · <a href="#" data-act="copy-link">📋 Einladungslink</a></span>';
    if (nav.innerHTML !== h) nav.innerHTML = h;
  }

  // ---------- Punktestand ----------
  function scoreboard(host) {
    var showHas = S.phase === 'open' || S.phase === 'judge';
    var rows = S.players.map(function (p, i) {
      var rank = i && p.score === S.players[i - 1].score ? '' : (i + 1);
      var st = showHas ? '<span class="qz-st" title="' + (p.has ? 'hat geantwortet' : 'noch nichts') + '">' + (p.has ? '✔' : '…') + '</span>' : '';
      return '<div class="qz-p' + (!host && p.pid === S.me ? ' me' : '') + (p.online ? '' : ' off') + '"><span class="qz-rank">' + rank + '</span>' + av(p) +
        '<span class="qz-nm">' + who(p, { host: host }) + (p.pid === S.me ? ' <small>(du)</small>' : '') + (p.online ? '' : ' <small title="nicht verbunden">📴</small>') + '</span>' + st +
        deltaHtml(p.delta) + '<b class="qz-pts">' + num(p.score) + '</b>' +
        (host ? '<button type="button" class="mini" data-give="' + esc(p.pid) + '" title="Punkte aus dem Feld oben geben">+</button>' : '') + '</div>';
    }).join('');
    var head = '<div class="qz-head">🏆 Punkte</div>';
    var give = host ? '<div class="qz-give"><label>Punkte <input type="number" id="qz-give" data-k="give" value="' + givePts + '" style="width:64px"></label>' +
      '<button type="button" class="small" data-give="all">An alle</button><button type="button" class="small" data-act="undo"' + (S.canUndo ? '' : ' disabled') + ' title="Letzte Punktevergabe zurücknehmen">↩ Rückgängig</button></div>' : '';
    return '<div class="qz-side">' + head + give + '<div class="qz-score" data-scroll="score">' + (rows || '<p class="qz-empty">Noch niemand da.</p>') + '</div></div>';
  }
  function timerHtml(big) {
    if (!S.timer) return '';
    var left = timeLeft(), sec = Math.ceil(left / 1000);
    return '<div class="qz-timer' + (big ? ' big' : '') + '" data-timer><div class="qz-bar"><i style="width:' + Math.max(0, Math.min(100, left / (S.timer.total || 1) * 100)) + '%"></i></div>' +
      '<div class="qz-time' + (sec <= 5 ? ' warn' : '') + '">' + Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2) + '</div></div>';
  }
  function questionBox(q, extra) {
    var meta = '<span>Frage ' + (S.cur + 1) + (S.count > S.cur + 1 ? ' von ' + S.count : '') + '</span><span>' + TYPE[q.type] + '</span>';
    if (q.type !== 'estimate') meta += '<span>✔ ' + pts(q.right) + (q.type !== 'buzzer' || q.wrong ? ' · ✖ ' + pts(q.wrong) : '') + (q.type === 'buzzer' && q.others ? ' · andere bei falsch ' + pts(q.others) : '') + '</span>';
    else meta += '<span>bis ' + pts(q.right) + '</span>';
    return '<div class="qz-q"><div class="meta">' + meta + '</div><div class="text">' + (esc(q.text) || '<span class="qz-dim">…</span>') + (extra || '') + '</div></div>';
  }

  // ---------- Spieler ----------
  function renderPlayer() {
    var q = S.q, body = '';
    if (S.phase === 'lobby') {
      body = '<div class="qz-wait"><div class="qz-bigicon">⏳</div><h2>Warteraum</h2><p><b>' + esc(S.host.name) + '</b> startet das Quiz gleich.' + (S.host.online ? '' : ' <small>(Spielleiter gerade nicht verbunden)</small>') + '</p>' +
        '<p>Andere einladen: Code <b class="qz-code small">' + esc(S.code) + '</b> oder <a href="#" data-act="copy-link">Link kopieren</a></p></div>';
    } else if (S.phase === 'end') {
      body = endHtml(false);
    } else if (!q) {
      body = '<div class="qz-wait"><div class="qz-bigicon">✍️</div><p>' + esc(S.host.name) + ' bereitet die nächste Frage vor …</p></div>';
    } else if (S.phase === 'prep') {
      body = questionBox(q, '<span class="qz-caret"></span>') + optionsPreview(q) + '<p class="qz-center qz-dim">Gleich geht es los …</p>';
    } else if (S.phase === 'open') {
      body = questionBox(q) + timerHtml(true) + answerArea(q);
    } else if (S.phase === 'judge') {
      var mine = S.my && S.my.answer;
      body = questionBox(q) + '<div class="qz-banner">⚖️ ' + esc(S.host.name) + ' wertet die Antworten …' + (mine !== null && mine !== undefined && mine !== '' ? ' Deine Antwort: <b>' + esc(q.options ? q.options[mine] : mine) + '</b>' : '') + '</div>';
    } else if (S.phase === 'reveal') {
      body = questionBox(q) + revealHtml(q, false);
    }
    patch(main, '<div class="qz-play"><div class="qz-col" data-scroll="col">' + body + '</div>' + scoreboard(false) + '</div>');
    keysEl.textContent = q && S.phase === 'open' ? (q.type === 'buzzer' ? 'Leertaste = Buzzer' : q.type === 'mc' ? 'Tasten 1–4 oder A–D' : q.type === 'tf' ? 'W = Wahr · F = Falsch' : '') : '';
    status(S.phase === 'lobby' ? 'Im Warteraum · Spielleiter: ' + S.host.name : 'Spielleiter: ' + S.host.name);
  }
  function optionsPreview(q) {
    if (!q.options) return '';
    return '<div class="qz-mc preview">' + q.options.map(function (o, i) { return o ? '<div class="qz-opt"><span class="letter l' + i + '">' + LETTERS[i] + '</span>' + esc(o) + '</div>' : ''; }).join('') + '</div>';
  }
  function answerArea(q) {
    var my = S.my || {};
    if (q.type === 'mc' || q.type === 'tf') {
      var labels = q.type === 'tf' ? ['W', 'F'] : LETTERS;
      return '<div class="qz-mc">' + q.options.map(function (o, i) {
        if (!o) return '';
        var on = my.answer === i;
        return '<button type="button" class="qz-opt' + (on ? ' pressed' : my.answer !== null && my.answer !== undefined ? ' dim' : '') + '" data-answer="' + i + '"><span class="letter l' + (q.type === 'tf' ? i * 3 : i) + '">' + labels[i] + '</span>' + esc(o) + '</button>';
      }).join('') + '</div>' + (my.answer !== null && my.answer !== undefined ? '<div class="qz-banner">✔ Deine Antwort <b>' + labels[my.answer] + '</b> ist abgegeben. Bis die Zeit um ist, kannst du noch wechseln.</div>' : '');
    }
    if (q.type === 'estimate' || q.type === 'text') {
      return '<div class="qz-guess"><div class="inp"><input type="' + (q.type === 'estimate' ? 'text" inputmode="decimal' : 'text') + '" data-k="answer" id="qz-answer" value="' + esc(myText) + '" maxlength="' + (q.type === 'estimate' ? 30 : 200) + '" autocomplete="off" placeholder="' + (q.type === 'estimate' ? 'Deine Schätzung' : 'Deine Antwort') + '">' +
        (q.unit ? '<span>' + esc(q.unit) + '</span>' : '') + '</div><small>Wird beim Tippen übertragen. Es zählt der Stand, wenn die Zeit um ist. Die Antworten der anderen siehst du bei der Auflösung.</small></div>';
    }
    // Buzzer
    var b = S.buzz || { queue: [], tried: [] };
    var meQueued = b.queue.indexOf(S.me), meTried = b.tried.indexOf(S.me) >= 0;
    if (b.answering === S.me) {
      return '<div class="qz-banner hot">🔔 <b>Du bist dran!</b> Sag die Antwort laut oder tipp sie hier ein:</div>' +
        '<div class="qz-guess"><div class="inp"><input type="text" data-k="buzz-answer" id="qz-answer" value="' + esc(myText) + '" maxlength="200" autocomplete="off" placeholder="Deine Antwort"></div></div>';
    }
    var html = '';
    if (b.answering) {
      var a = player(b.answering);
      html += '<div class="qz-banner hot">' + av(a) + ' <b>' + esc(a.name) + ' hat gebuzzert!</b></div>' +
        '<div class="qz-said"><small>' + esc(a.name) + ' sagt:</small> <span data-live="' + esc(a.pid) + '" class="' + (b.text ? '' : 'empty') + '">' + esc(b.text) + '</span></div>';
    }
    var can = !meTried && meQueued < 0 && !(S.timer && S.timer.paused && !b.answering);
    var label = meTried ? 'Für diese Frage gesperrt' : meQueued >= 0 ? 'Du bist Nr. ' + (meQueued + (b.answering ? 2 : 1)) + ' in der Reihe' : b.answering ? 'Liegt ' + esc(player(b.answering).name) + ' falsch, bist du als Nächster dran.' : 'Leertaste oder Knopf drücken';
    html += '<div class="qz-buzz"><button type="button" class="qz-buzzer' + (can ? '' : ' locked') + '" data-act="buzz"' + (can ? '' : ' disabled') + '>' + (b.answering && can ? 'ANSTELLEN' : 'BUZZ') + '</button><div>' + label + '</div></div>';
    return html;
  }

  // ---------- Auflösung ----------
  function revealHtml(q, host) {
    var r = S.result || {}, html = '';
    var correct = r.correct ? r.correct.text : null;
    html += '<div class="qz-banner ok">' + (correct ? 'Richtig: <b>' + esc(correct) + '</b>' : q.type === 'buzzer' ? 'Auflösung' : 'Ohne hinterlegte Lösung') + '</div>';
    if (r.kind === 'buzzer' || q.type === 'buzzer') {
      html += '<p class="qz-center">' + (r.by ? av(player(r.by)) + ' <b>' + esc(player(r.by).name) + '</b> wusste es!' : 'Diesmal wusste es niemand.') + '</p>';
    } else if (q.type === 'mc' || q.type === 'tf') {
      var by = {};
      (r.answers || []).forEach(function (a) { (by[a.value] = by[a.value] || []).push(a.pid); });
      html += '<div class="qz-mc">' + q.options.map(function (o, i) {
        if (!o) return '';
        var list = by[i] || [], mine = !host && S.my && S.my.answer === i;
        return '<div class="qz-opt' + (r.correct && r.correct.index === i ? ' right' : list.length ? ' wrong' : ' dim') + (mine ? ' mine' : '') + '"><span class="letter l' + (q.type === 'tf' ? i * 3 : i) + '">' + (q.type === 'tf' ? (i ? 'F' : 'W') : LETTERS[i]) + '</span>' +
          '<span class="qz-otext">' + esc(o) + '</span><span class="qz-who">' + list.map(function (pid) { return av(player(pid), 20); }).join('') + ' <b>' + list.length + '</b></span></div>';
      }).join('') + '</div>';
    } else if (q.type === 'estimate') {
      html += estimateLine(r) + '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Schätzung</th><th class="num">Abstand</th><th class="num">Punkte</th></tr></thead><tbody>' +
        (r.answers || []).map(function (a) {
          var p = player(a.pid);
          return '<tr' + (!host && a.pid === S.me ? ' class="me"' : '') + '><td>' + (['', '🥇', '🥈', '🥉'][a.rank] || a.rank) + '</td><td>' + esc(p.name) + (p.guest ? ' <span class="qz-guest">(Gast)</span>' : '') + '</td><td class="num">' + num(a.value) +
            '</td><td class="num">' + (a.dist === null ? '–' : num(a.dist)) + '</td><td class="num">' + deltaHtml(a.points || 0) + '</td></tr>';
        }).join('') + '</tbody></table>' + (r.answers && r.answers.length ? '' : '<p class="qz-empty">Niemand hat geschätzt.</p>');
    } else if (q.type === 'text') {
      html += '<table class="list"><tbody>' + (r.answers || []).map(function (a) {
        var p = player(a.pid);
        return '<tr' + (!host && a.pid === S.me ? ' class="me"' : '') + '><td>' + (a.ok ? '✔' : '✖') + '</td><td>' + esc(p.name) + '</td><td>' + esc(a.value) + '</td></tr>';
      }).join('') + '</tbody></table>' + (r.answers && r.answers.length ? '' : '<p class="qz-empty">Niemand hat geantwortet.</p>');
    }
    if (r.explain) html += '<div class="qz-explain">💡 ' + esc(r.explain) + '</div>';
    return html;
  }
  function estimateLine(r) {
    var list = r.answers || [];
    if (r.target === null || r.target === undefined || !list.length) return '';
    var vals = list.map(function (a) { return a.value; }).concat([r.target]);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var W = 560, x = function (v) { return 14 + (v - lo) / (hi - lo) * (W - 28); };
    var marks = list.map(function (a, i) {
      var p = player(a.pid), ch = p.emoji || (Array.from(p.name || '?')[0] || '?').toUpperCase();
      return '<text x="' + x(a.value).toFixed(1) + '" y="' + (40 - (i % 2) * 16) + '" text-anchor="middle" font-size="15">' + esc(ch) + '</text>';
    }).join('');
    return '<div class="sunken qz-line"><svg viewBox="0 0 ' + W + ' 86" width="100%" font-family="Arial, sans-serif" font-size="11">' +
      '<line x1="14" y1="50" x2="' + (W - 14) + '" y2="50" stroke="currentColor" stroke-width="2"/>' + marks +
      '<line x1="' + x(r.target).toFixed(1) + '" y1="14" x2="' + x(r.target).toFixed(1) + '" y2="62" stroke="#138a13" stroke-width="3"/>' +
      '<text x="' + x(r.target).toFixed(1) + '" y="80" text-anchor="middle" fill="#138a13" font-weight="bold">' + esc(num(r.target)) + ' ✔</text></svg></div>';
  }
  function endHtml(host) {
    var a = S.awards || { places: [] }, ps = S.players;
    var top = ps.slice(0, 3), order = [1, 0, 2], heights = [165, 120, 85], colors = ['#d4a017', '#a8a8a8', '#b06a2a'];
    var podium = '<div class="qz-podium">' + order.map(function (i) {
      var p = top[i];
      if (!p) return '<div class="col"></div>';
      var place = (a.places.filter(function (x) { return x.pid === p.pid; })[0] || {}).place || i + 1;
      return '<div class="col">' + (place === 1 ? '<span class="crown">👑</span>' : '') + av(p, 56) + '<b>' + esc(p.name) + '</b>' + (p.guest ? '<span class="qz-guest">(Gast)</span>' : '') +
        '<span>' + num(p.score) + ' Punkte</span><div class="blk" style="height:' + heights[i] + 'px;background:' + colors[place - 1 > 2 ? 2 : place - 1] + '">' + place + '</div></div>';
    }).join('') + '</div>';
    var rest = ps.slice(3).map(function (p, i) {
      var place = (a.places.filter(function (x) { return x.pid === p.pid; })[0] || {}).place || i + 4;
      return '<tr' + (!host && p.pid === S.me ? ' class="me"' : '') + '><td>' + place + '</td><td>' + esc(p.name) + (p.guest ? ' <span class="qz-guest">(Gast)</span>' : '') + '</td><td class="num">' + num(p.score) + '</td><td class="num">' + p.right + '/' + a.asked + '</td></tr>';
    }).join('');
    var aw = [];
    if (a.fastest) aw.push('⚡ Schnellster Buzzer: <b>' + esc(player(a.fastest.pid).name) + '</b> (' + (a.fastest.ms / 1000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' s)');
    if (a.estimator) aw.push('🎯 Am besten geschätzt: <b>' + esc(player(a.estimator.pid).name) + '</b> (' + a.estimator.wins + '× am nächsten)');
    if (a.hardest) aw.push('😬 Schwerste Frage: Nr. ' + a.hardest.q + ', ' + (a.hardest.right === 1 ? 'nur 1 richtig' : a.hardest.right ? a.hardest.right + ' richtig' : 'niemand richtig'));
    return '<h2 class="qz-center">🎉 ' + (S.title ? '„' + esc(S.title) + '“' : 'Das Quiz') + ' ist vorbei!</h2>' + podium +
      '<div class="qz-endgrid' + (rest && aw.length ? '' : ' one') + '">' + (rest ? '<table class="list"><thead><tr><th>#</th><th>Spieler</th><th class="num">Punkte</th><th class="num">Richtig</th></tr></thead><tbody>' + rest + '</tbody></table>' : '') +
      (aw.length ? '<div class="sunken qz-awards">' + aw.join('<br>') + '</div>' : '') + '</div>' +
      (host ? '<div class="actions qz-center"><button type="button" data-act="again">🔁 Nochmal spielen</button><button type="button" data-act="save">💾 Fragen speichern</button><button type="button" data-act="close-room">🚪 Raum schließen</button></div>' : '');
  }

  // ---------- Spielleiter ----------
  function curQ() { return S.questions[S.cur] || null; }
  function selIndex() {
    for (var i = 0; i < S.questions.length; i++) if (S.questions[i].id === selId) return i;
    return -1;
  }
  function renderHost() {
    if (S.phase === 'lobby') return renderLobby();
    if (S.phase === 'end') {
      patch(main, '<div class="qz-play"><div class="qz-col" data-scroll="col">' + endHtml(true) + '</div>' + scoreboard(true) + '</div>');
      status('Quiz beendet · Ergebnisse gespeichert');
      return;
    }
    var si = selIndex();
    if (si < 0) { si = Math.max(0, S.cur); selId = S.questions[si] && S.questions[si].id; }
    var sq = S.questions[si];
    // Den Bearbeiten-Stand nur übernehmen, wenn eine andere Frage gewählt wurde: sonst tippt man gegen das Echo an
    var key = sq ? sq.id + ':' + sq.type : '';
    if (key !== editKey) { edit = sq ? JSON.parse(JSON.stringify(sq)) : null; editKey = key; }
    var list = S.questions.map(function (q, i) {
      var done = i < S.cur, cur = i === S.cur;
      return '<button type="button" class="qz-li' + (q.id === selId ? ' sel' : '') + (done ? ' done' : '') + (cur ? ' cur' : '') + '" data-sel="' + q.id + '">' +
        (cur ? '▶' : done ? '✔' : '&nbsp;') + ' ' + (i + 1) + ' ' + TYPE[q.type].split(' ')[0] + ' ' + (esc(q.text.slice(0, 60)) || '<i>(leer)</i>') + '</button>';
    }).join('');
    var left = '<div class="qz-gm-left"><div class="qz-list" data-scroll="list">' + list + '</div>' +
      '<div class="qz-listbtns"><button type="button" class="small" data-act="insert" title="Neue Frage nach der gewählten">➕ Frage</button>' +
      '<button type="button" class="small" data-act="up" title="Nach oben">⬆</button><button type="button" class="small" data-act="down" title="Nach unten">⬇</button>' +
      '<button type="button" class="small danger" data-act="del" title="Gewählte Frage löschen">🗑</button></div>' +
      (si !== S.cur && S.phase !== 'open' ? '<button type="button" class="small" data-act="goto">⏩ Diese Frage als nächste</button>' : '') + '</div>';
    var mid = '<div class="qz-gm-mid" data-scroll="mid">' + editor(si) + (si === S.cur ? live() : '<div class="qz-banner">Du bearbeitest Frage ' + (si + 1) + '. Gerade läuft Frage ' + (S.cur + 1) + '. <a href="#" data-act="sel-cur">Zur laufenden Frage</a></div>' + live()) + '</div>';
    patch(main, '<div class="qz-gm">' + left + mid + scoreboard(true) + '</div>');
    var bz = S.buzz;
    keysEl.textContent = bz && bz.answering ? 'R richtig · F falsch' : S.phase === 'reveal' ? 'N nächste Frage' : S.phase === 'prep' ? 'Enter in keinem Feld: freigeben' : '';
    var online = S.players.filter(function (p) { return p.online; }).length;
    status('Frage ' + (S.cur + 1) + ' von ' + S.count + ' · ' + online + ' von ' + S.players.length + ' Spielern verbunden');
  }
  function editor(si) {
    var q = edit, d = S.defaults;
    if (!q) return '';
    var locked = si === S.cur && S.phase !== 'prep';
    var ph = function (k, dk) { return ' placeholder="' + (d[dk || k] === undefined ? '' : d[dk || k]) + '" title="Leer lassen = Standard des Raums (' + d[dk || k] + ')"'; };
    var v = function (k) { return q[k] === null || q[k] === undefined ? '' : esc(q[k]); };
    var h = '<div class="qz-edit"><div class="qz-erow"><b>Frage ' + (si + 1) + '</b>' + (si === S.cur && S.phase !== 'prep' ? ' <span class="qz-live">● LIVE</span>' : si === S.cur && !q.hidden ? ' <span class="qz-live">● Spieler sehen mit</span>' : '') +
      '<span class="spacer"></span>Typ <select data-f="type" data-k="f-type"' + (locked ? ' disabled' : '') + '>' + Object.keys(TYPE).map(function (t) { return '<option value="' + t + '"' + (q.type === t ? ' selected' : '') + '>' + TYPE[t] + '</option>'; }).join('') + '</select></div>' +
      '<textarea data-f="text" data-k="f-text" rows="3" maxlength="600" placeholder="Frage eintippen …">' + esc(q.text) + '</textarea>';
    if (q.type === 'mc') {
      h += '<div class="qz-opts">' + [0, 1, 2, 3].map(function (i) {
        return '<label class="qz-ans"><input type="radio" name="qz-correct" data-f="correct" value="' + i + '"' + (q.correct === i ? ' checked' : '') + ' title="richtige Antwort"><span class="letter l' + i + '">' + LETTERS[i] + '</span>' +
          '<input type="text" data-f="options" data-i="' + i + '" data-k="f-opt' + i + '" maxlength="160" value="' + esc(q.options[i]) + '" placeholder="Antwort ' + LETTERS[i] + '"></label>';
      }).join('') + '<small>Punkt links = richtige Antwort (nur du siehst sie). Ohne Punkt wählst du sie nach Ablauf der Zeit.</small></div>';
    } else if (q.type === 'tf') {
      h += '<div class="qz-erow">Richtig ist: <label class="inline"><input type="radio" name="qz-correct" data-f="correct" value="0"' + (q.correct === 0 ? ' checked' : '') + '> Wahr</label> <label class="inline"><input type="radio" name="qz-correct" data-f="correct" value="1"' + (q.correct === 1 ? ' checked' : '') + '> Falsch</label></div>';
    } else if (q.type === 'estimate') {
      h += '<div class="qz-erow"><span class="lbl">Richtige Zahl</span><input type="text" inputmode="decimal" data-f="answer" data-k="f-answer" value="' + esc(q.answer) + '" style="width:120px">' +
        '<span>Einheit</span><input type="text" data-f="unit" data-k="f-unit" value="' + esc(q.unit) + '" maxlength="30" style="width:90px" placeholder="z. B. km">' +
        '<span>Wertung</span><select data-f="estimate" data-k="f-est"><option value="">Standard (' + esc(ESTIMATE[d.estimate]) + ')</option>' +
        Object.keys(ESTIMATE).map(function (k) { return '<option value="' + k + '"' + (q.estimate === k ? ' selected' : '') + '>' + ESTIMATE[k] + '</option>'; }).join('') + '</select></div>';
    } else {
      h += '<div class="qz-erow"><span class="lbl">Richtige Antwort</span><input type="text" data-f="answer" data-k="f-answer" value="' + esc(q.answer) + '" maxlength="200" style="flex:1" placeholder="' + (q.type === 'text' ? 'mehrere mit | trennen, z. B. Mel B|Mel C' : 'nur du siehst sie') + '"></div>';
    }
    h += '<div class="qz-erow"><span class="lbl">Punkte</span>✔ <input type="number" data-f="right" data-k="f-right" value="' + v('right') + '"' + ph('right') + ' style="width:74px">' +
      (q.type !== 'estimate' ? ' ✖ <input type="number" data-f="wrong" data-k="f-wrong" value="' + v('wrong') + '"' + ph('wrong') + ' style="width:74px">' : '') +
      (q.type === 'buzzer' ? ' <span title="Bei einer falschen Antwort bekommen alle anderen Spieler diese Punkte">andere bei falsch</span> <input type="number" data-f="others" data-k="f-others" value="' + v('others') + '"' + ph('others') + ' style="width:64px">' : '') + '</div>' +
      '<div class="qz-erow"><span class="lbl">Zeit</span>' + (q.type === 'buzzer' ? 'Buzzern' : 'Antworten') + ' <input type="number" data-f="time" data-k="f-time" min="3" max="600" value="' + v('time') + '"' + ph('time', q.type === 'buzzer' ? 'buzzTime' : 'time') + ' style="width:90px"> s' +
      (q.type === 'buzzer' ? ' · nach dem Buzzern <input type="number" data-f="answerTime" data-k="f-at" min="3" max="600" value="' + v('answerTime') + '"' + ph('answerTime') + ' style="width:90px"> s' : '') + '</div>' +
      (q.type === 'buzzer' ? '<div class="qz-erow"><label class="inline"><input type="checkbox" data-f="rebuzz"' + ((q.rebuzz === null ? d.rebuzz : q.rebuzz) ? ' checked' : '') + '> Nach falscher Antwort dürfen die anderen nochmal buzzern</label></div>' : '') +
      '<details class="qz-more"' + (q.explain || q.note ? ' open' : '') + '><summary>Erklärung und Notiz</summary>' +
      '<div class="qz-erow"><span class="lbl">Erklärung danach</span><input type="text" data-f="explain" data-k="f-explain" maxlength="400" value="' + esc(q.explain) + '" style="flex:1" placeholder="sehen alle bei der Auflösung"></div>' +
      '<div class="qz-erow"><span class="lbl">Notiz für dich</span><input type="text" data-f="note" data-k="f-note" maxlength="300" value="' + esc(q.note) + '" style="flex:1" placeholder="nur du siehst sie"></div></details>' +
      (si >= S.cur && !(si === S.cur && S.phase !== 'prep') ? '<label class="inline"><input type="checkbox" data-f="hidden"' + (q.hidden ? ' checked' : '') + '> Verdeckt vorbereiten (sonst sehen die Spieler beim Tippen mit, sobald die Frage dran ist)</label>' : '') +
      '</div>';
    return h;
  }
  function live() {
    var q = curQ(), b = S.buzz, h = '<fieldset class="groupbox qz-live-box"><legend>';
    if (!q) return '';
    if (S.phase === 'prep') {
      return h + 'Frage ' + (S.cur + 1) + ' vorbereiten</legend><p>Wenn die Frage fertig ist: freigeben. Dann startet der Timer' + (q.type === 'buzzer' ? ' und der Buzzer ist frei' : '') + '.</p>' +
        '<div class="actions"><button type="button" class="qz-go" data-act="open">▶ Frage freigeben</button><button type="button" data-act="skip">⏭ Überspringen</button><button type="button" data-act="end">🏁 Quiz beenden</button></div></fieldset>';
    }
    if (S.phase === 'open') {
      h += (q.type === 'buzzer' ? (b && b.answering ? 'Antwortet gerade' : 'Buzzer offen') : 'Antworten') + '</legend>' + timerHtml(false);
      if (q.type === 'buzzer') {
        var order = (S.queueMs || []).slice();
        var rows = '';
        if (b.answering) rows += buzzRow(b.answering, '▶', S.firstMs, true);
        order.forEach(function (x, i) { rows += buzzRow(x.pid, (i + 2) + '.', x.ms, false); });
        b.tried.forEach(function (pid) { if (pid !== b.answering) rows += '<div class="qz-gp tried">✖ ' + av(player(pid), 22) + ' ' + esc(player(pid).name) + ' <small>lag falsch</small></div>'; });
        h += rows || '<p class="qz-empty">Noch hat niemand gebuzzert.</p>';
        if (b.answering) {
          var e = q, d = S.defaults, rp = e.right === null ? d.right : e.right, wp = e.wrong === null ? d.wrong : e.wrong, op = e.others === null ? d.others : e.others;
          h += '<div class="actions qz-judge"><button type="button" class="ok" data-act="right">✔ Richtig (' + pts(rp) + ' ' + esc(player(b.answering).name) + ')</button>' +
            '<button type="button" class="no" data-act="wrong">✖ Falsch (' + pts(wp) + (op ? ', alle anderen ' + pts(op) : '') + ')</button></div>';
        }
      } else {
        h += '<div class="qz-inputs">' + S.players.map(function (p) {
          var a = inputs[p.pid];
          var shown = a === null || a === undefined || a === '' ? '' : q.type === 'mc' || q.type === 'tf' ? (q.type === 'tf' ? ['Wahr', 'Falsch'][a] : LETTERS[a] + ': ' + q.options[a]) : a;
          return '<div class="qz-gp">' + av(p, 22) + '<span class="qz-gpn">' + esc(p.name) + '</span><span class="qz-ansbox' + (shown ? '' : ' empty') + '" data-live="' + esc(p.pid) + '">' + esc(shown) + '</span></div>';
        }).join('') + '</div>';
      }
      var paused = S.timer && S.timer.paused;
      h += '<div class="actions">' + (paused ? '<button type="button" data-act="resume">▶ Weiter</button>' : '<button type="button" data-act="pause">⏸ Anhalten</button>') +
        '<button type="button" data-act="addtime">⏱ +10 s</button><button type="button" data-act="reveal">👁 Auflösen</button><button type="button" data-act="skip">⏭ Überspringen</button></div></fieldset>';
      return h;
    }
    if (S.phase === 'judge') {
      if (q.type === 'text') {
        h += 'Antworten abhaken</legend><div class="qz-inputs">' + S.players.map(function (p) {
          var a = inputs[p.pid];
          if (a === null || a === undefined || a === '') return '';
          var ok = !!(S.marks || {})[p.pid];
          return '<div class="qz-gp">' + av(p, 22) + '<span class="qz-gpn">' + esc(p.name) + '</span><span class="qz-ansbox">' + esc(a) + '</span>' +
            '<button type="button" class="mini' + (ok ? ' pressed ok' : '') + '" data-mark="' + esc(p.pid) + '" data-ok="1">✔</button><button type="button" class="mini' + (!ok ? ' pressed no' : '') + '" data-mark="' + esc(p.pid) + '" data-ok="">✖</button></div>';
        }).join('') + '</div><div class="actions"><button type="button" class="qz-go" data-act="score">✔ Werten und auflösen</button></div></fieldset>';
        return h;
      }
      return h + 'Welche Antwort ist richtig?</legend><div class="actions">' + (q.type === 'tf' ? ['Wahr', 'Falsch'] : q.options).map(function (o, i) {
        return o ? '<button type="button" data-pick="' + i + '">' + (q.type === 'tf' ? '' : LETTERS[i] + ': ') + esc(o) + '</button>' : '';
      }).join('') + '</div></fieldset>';
    }
    // reveal
    return h + 'Auflösung</legend>' + revealHtml(publicQ(q), true) +
      '<div class="actions"><button type="button" class="qz-go" data-act="next">▶ Nächste Frage' + (S.cur + 1 < S.count ? ' (' + (S.cur + 2) + ')' : ' (neu)') + '</button><button type="button" data-act="end">🏁 Quiz beenden</button></div></fieldset>';
  }
  function publicQ(q) { return { type: q.type, options: q.type === 'tf' ? ['Wahr', 'Falsch'] : q.options, text: q.text }; }
  function buzzRow(pid, n, ms, active) {
    var p = player(pid);
    return '<div class="qz-gp' + (active ? ' buzzed' : '') + '"><b class="qz-n">' + n + '</b>' + av(p, 22) + '<span class="qz-gpn">' + esc(p.name) + '</span>' +
      '<span class="qz-ansbox' + (inputs[pid] ? '' : ' empty') + '" data-live="' + esc(pid) + '">' + esc(inputs[pid] || (active ? '' : 'wartet')) + '</span>' +
      (ms !== null && ms !== undefined ? '<small>' + (ms / 1000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' s</small>' : '') + '</div>';
  }
  function renderLobby() {
    var d = S.defaults, link = location.origin + '/quiz/' + S.code;
    var players = S.players.map(function (p) {
      return '<div class="qz-p' + (p.online ? '' : ' off') + '">' + av(p) + '<span class="qz-nm">' + who(p, { host: true }) + (p.online ? '' : ' <small>📴</small>') + '</span>' +
        '<button type="button" class="mini" data-kick="' + esc(p.pid) + '" title="Aus dem Raum nehmen">✖</button></div>';
    }).join('');
    var num2 = function (k, min, max) { return '<input type="number" data-d="' + k + '" data-k="d-' + k + '" min="' + min + '" max="' + max + '" value="' + d[k] + '" style="width:70px">'; };
    patch(main, '<div class="qz-lobby">' +
      '<fieldset class="groupbox qz-invite"><legend>Einladen</legend><div class="qz-code">' + esc(S.code) + '</div>' +
      '<img class="qz-qr" src="/quiz/' + esc(S.code) + '/qr.svg" alt="QR-Code zum Beitreten" width="150" height="150">' +
      '<input type="text" value="' + esc(link) + '" readonly class="qz-link" onfocus="this.select()">' +
      '<div class="actions"><button type="button" class="small" data-act="copy-link">📋 Link kopieren</button></div><hr>' +
      '<label class="inline"><input type="checkbox" data-room="list"' + (S.hidden ? '' : ' checked') + '> In der Raumliste zeigen</label><br>' +
      '<label class="inline"><input type="checkbox" data-room="guests"' + (S.guests ? ' checked' : '') + '> Gäste ohne Konto erlauben</label><br>' +
      '<label class="inline"><input type="checkbox" data-room="locked"' + (S.locked ? ' checked' : '') + '> Beitritt nach dem Start sperren</label></fieldset>' +
      '<div class="qz-lobby-right"><fieldset class="groupbox"><legend>Im Warteraum (' + S.players.length + ')</legend><div class="qz-score" data-scroll="score">' + (players || '<p class="qz-empty">Noch niemand da. Schick den Link oder zeig den QR-Code.</p>') + '</div></fieldset>' +
      '<fieldset class="groupbox"><legend>Standard für jede Frage</legend>' +
      '<div class="qz-erow"><span class="lbl">Zeit zum Antworten</span>' + num2('time', 3, 600) + ' s</div>' +
      '<div class="qz-erow"><span class="lbl">Buzzer</span>' + num2('buzzTime', 3, 600) + ' s zum Buzzern, ' + num2('answerTime', 3, 600) + ' s zum Antworten</div>' +
      '<div class="qz-erow"><span class="lbl">Punkte</span>richtig ' + num2('right', -10000, 10000) + ' falsch ' + num2('wrong', -10000, 10000) + '</div>' +
      '<div class="qz-erow"><span class="lbl">Buzzer falsch</span>alle anderen bekommen ' + num2('others', -10000, 10000) + ' Punkte</div>' +
      '<div class="qz-erow"><span class="lbl">Schätzfragen</span><select data-d="estimate" data-k="d-estimate">' + Object.keys(ESTIMATE).map(function (k) { return '<option value="' + k + '"' + (d.estimate === k ? ' selected' : '') + '>' + ESTIMATE[k] + '</option>'; }).join('') + '</select></div>' +
      '<label class="inline"><input type="checkbox" data-d="rebuzz"' + (d.rebuzz ? ' checked' : '') + '> Nach falscher Buzzer-Antwort dürfen die anderen nochmal</label></fieldset>' +
      '<div class="qz-startrow"><span>' + (S.count ? '📚 ' + (S.title ? '„' + esc(S.title) + '“, ' : '') + S.count + (S.count === 1 ? ' Frage' : ' Fragen') + ' geladen' : 'Keine Fragen geladen: du legst sie spontan an. <a href="#" data-act="load">📂 Quiz laden</a>') + '</span>' +
      '<button type="button" class="qz-go" data-act="start">▶ Quiz starten</button></div></div></div>');
    keysEl.textContent = '';
    status('Raum offen · ' + S.players.length + ' Spieler' + (S.players.some(function (p) { return p.guest; }) ? ' · ' + S.players.filter(function (p) { return p.guest; }).length + ' Gäste' : ''));
  }

  // ---------- Eingaben ----------
  // Gesendet wird immer der aktuelle Stand der bearbeiteten Frage, auch beim verspäteten letzten Paket
  function editIndex() { for (var i = 0; edit && i < S.questions.length; i++) if (S.questions[i].id === edit.id) return i; return -1; }
  function pushEdit() { var i = editIndex(); if (i >= 0) act({ action: 'edit', index: i, q: editFields() }); }
  var sendEdit = throttle(pushEdit, 120);
  var sendInput = throttle(function (text) { req('POST', '/quiz/' + code, { action: 'input', text: text }).catch(oops); }, 100);
  var sendDefaults = throttle(function (d) { act({ action: 'settings', defaults: d }); }, 300);
  function editFields() {
    var out = {};
    ['type', 'text', 'options', 'answer', 'correct', 'unit', 'right', 'wrong', 'others', 'time', 'answerTime', 'estimate', 'rebuzz', 'note', 'explain', 'hidden'].forEach(function (k) { out[k] = edit[k]; });
    return out;
  }
  function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
  main.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.k === 'answer' || t.dataset.k === 'buzz-answer') { myText = t.value; sendInput(t.value); return; }
    if (t.id === 'qz-give') { givePts = Number(t.value) || 0; return; }
    if (t.id === 'qz-code') { t.value = t.value.toUpperCase(); return; }
    if (t.dataset.d && t.type !== 'checkbox') {
      var dd = {}; dd[t.dataset.d] = t.type === 'number' ? numOrNull(t.value) : t.value;
      if (dd[t.dataset.d] !== null) { Object.assign(S.defaults, dd); sendDefaults(Object.assign({}, S.defaults)); }
      return;
    }
    if (t.dataset.f && edit && t.type !== 'radio' && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
      var f = t.dataset.f;
      if (f === 'options') edit.options[Number(t.dataset.i)] = t.value;
      else if (['right', 'wrong', 'others', 'time', 'answerTime'].indexOf(f) >= 0) edit[f] = numOrNull(t.value);
      else edit[f] = t.value;
      sendEdit();
    }
  });
  main.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.room) {
      var b = { action: 'settings' };
      if (t.dataset.room === 'list') b.hidden = !t.checked; else b[t.dataset.room] = t.checked;
      return act(b);
    }
    if (t.dataset.d && (t.type === 'checkbox' || t.tagName === 'SELECT')) {
      S.defaults[t.dataset.d] = t.type === 'checkbox' ? t.checked : t.value;
      return sendDefaults(Object.assign({}, S.defaults));
    }
    if (!t.dataset.f || !edit) return;
    var f = t.dataset.f;
    if (f === 'type') { edit.type = t.value; editKey = ''; act({ action: 'edit', index: editIndex(), q: { type: t.value } }); return; }
    if (f === 'correct') edit.correct = Number(t.value);
    else if (f === 'rebuzz' || f === 'hidden') edit[f] = t.checked;
    else if (f === 'estimate') edit.estimate = t.value || null;
    else return;
    pushEdit();
  });
  main.addEventListener('submit', function (e) {
    if (e.target.id === 'qz-codeform') { e.preventDefault(); enter($('qz-code').value); }
  });
  function hostMenu(e, pid) {
    var p = player(pid);
    var items = [
      { label: '➕ ' + givePts + ' Punkte geben', run: function () { act({ action: 'give', pid: pid, points: givePts }); } },
      { label: '✖ Aus dem Raum nehmen', danger: true, run: function () { kick(pid); } },
    ];
    if (p.user && window.RetroUserMenu) return window.RetroUserMenu.open(e, p.user, { note: 'Im Quiz: ' + num(p.score) + ' Punkte', items: items });
    dialog(p.name + ' (Gast)', '<p>' + num(p.score) + ' Punkte, ' + p.right + ' richtig.</p>', [{ value: 'give', label: '➕ ' + givePts + ' Punkte' }, { value: 'kick', label: '✖ Rauswerfen', danger: true }, { value: 'cancel', label: 'Schließen' }])
      .then(function (v) { if (v === 'give') items[0].run(); if (v === 'kick') kick(pid); });
  }
  function kick(pid) {
    var p = player(pid);
    dialog('Spieler entfernen', '<p><b>' + esc(p.name) + '</b> aus dem Raum nehmen? Er kann danach nicht wieder beitreten.</p>', [{ value: 'ok', label: 'Entfernen', danger: true }, { value: 'cancel', label: 'Abbrechen' }])
      .then(function (v) { if (v === 'ok') act({ action: 'kick', pid: pid }); });
  }
  function buzzNow() {
    if (!S || S.isHost || !S.q || S.q.type !== 'buzzer' || S.phase !== 'open') return;
    Sound.play('klick');
    req('POST', '/quiz/' + code, { action: 'buzz', ms: Math.round(performance.now() - availAt) }).catch(oops);
  }
  function moveSel(dir) {
    var i = selIndex(), j = i + dir;
    if (i < 0 || j < 0 || j >= S.questions.length) return;
    act({ action: 'move', from: i, to: j });
  }
  main.addEventListener('click', function (e) {
    var t = e.target.closest('button, a, [data-pid]');
    if (!t || t.disabled) return;
    var d = t.dataset;
    if (d.enter) return enter(d.enter);
    if (d.answer !== undefined) { if (S && S.my) S.my.answer = Number(d.answer); render(); return act({ action: 'answer', value: Number(d.answer) }); }
    if (d.give) { if (!givePts) return oops(new Error('Trag oben eine Punktzahl ein.')); return act({ action: 'give', pid: d.give, points: givePts }); }
    if (d.kick) return kick(d.kick);
    if (d.mark) return act({ action: 'mark', pid: d.mark, ok: !!d.ok });
    if (d.pick !== undefined) return act({ action: 'pick', index: Number(d.pick) });
    if (d.sel) { selId = d.sel; editKey = ''; return render(); }
    if (d.pid && S && S.isHost && t.classList.contains('qz-userlink')) { e.preventDefault(); return hostMenu(e, d.pid); }
    if (d.user && window.RetroUserMenu) { e.preventDefault(); return window.RetroUserMenu.open(e, d.user); }
    if (d.act) { e.preventDefault(); return doAct(d.act); }
  });
  nav.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act],[data-nav]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.nav === 'start') return code ? null : showStart();
    doAct(a.dataset.act);
  });
  function doAct(a) {
    switch (a) {
      case 'create': return createRoom();
      case 'focus-code': { var c = $('qz-code'); if (c) { c.focus(); if (c.value.length === 4) enter(c.value); } return; }
      case 'buzz': return buzzNow();
      case 'copy-link': {
        var link = location.origin + '/quiz/' + S.code;
        var done = function () { status('📋 Link kopiert: ' + link); };
        if (navigator.clipboard) return navigator.clipboard.writeText(link).then(done, function () { prompt('Einladungslink:', link); });
        return prompt('Einladungslink:', link);
      }
      case 'leave':
        return dialog('Raum verlassen', '<p>Den Raum verlassen? Deine Punkte sind dann weg. Fenster schließen geht auch, dann kommst du mit deinen Punkten wieder rein.</p>',
          [{ value: 'ok', label: 'Verlassen', danger: true }, { value: 'cancel', label: 'Bleiben' }]).then(function (v) {
          if (v === 'ok') req('POST', '/quiz/' + code, { action: 'leave' }).then(showStart, oops);
        });
      case 'close-room':
        return dialog('Raum schließen', '<p>Den Raum für alle schließen?' + (S.phase !== 'end' && S.phase !== 'lobby' ? ' Das Quiz läuft noch; mit „🏁 Quiz beenden“ gibt es vorher einen Endstand.' : '') + '</p>',
          [{ value: 'ok', label: 'Schließen', danger: true }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) { if (v === 'ok') act({ action: 'close' }); });
      case 'room':
        return dialog('⚙️ Raum', '<label class="qz-row"><span>Name</span><input name="name" maxlength="60" value="' + esc(S.name) + '"></label>' +
          '<label class="inline"><input type="checkbox" name="list"' + (S.hidden ? '' : ' checked') + '> In der Raumliste zeigen</label><br>' +
          '<label class="inline"><input type="checkbox" name="guests"' + (S.guests ? ' checked' : '') + '> Gäste ohne Konto erlauben</label><br>' +
          '<label class="inline"><input type="checkbox" name="locked"' + (S.locked ? ' checked' : '') + '> Beitritt nach dem Start sperren</label>',
          [{ value: 'ok', label: 'Übernehmen' }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) {
          if (v === 'ok') act({ action: 'settings', name: field('name'), hidden: !field('list'), guests: field('guests'), locked: field('locked') });
        });
      case 'new-quiz':
        return dialog('📄 Neues Quiz', '<p>Alle Fragen in diesem Raum verwerfen und neu anfangen? Die Punkte bleiben.</p>', [{ value: 'ok', label: 'Neu anfangen', danger: true }, { value: 'cancel', label: 'Abbrechen' }])
          .then(function (v) { if (v === 'ok') { editKey = ''; act({ action: 'new' }); } });
      case 'load': fileInput.value = ''; return fileInput.click();
      case 'save': return saveFile();
      case 'start': return act({ action: 'start' });
      case 'open': return act({ action: 'open' });
      case 'reveal': return act({ action: 'reveal' });
      case 'right': return act({ action: 'right' });
      case 'wrong': return act({ action: 'wrong' });
      case 'score': return act({ action: 'score' });
      case 'next': return act({ action: 'next' });
      case 'skip': return act({ action: 'skip' });
      case 'pause': return act({ action: 'pause' });
      case 'resume': return act({ action: 'resume' });
      case 'addtime': return act({ action: 'addtime', seconds: 10 });
      case 'undo': return act({ action: 'undo' });
      case 'again': return act({ action: 'again' });
      case 'end':
        return dialog('🏁 Quiz beenden', '<p>Jetzt den Endstand zeigen?</p>', [{ value: 'ok', label: 'Beenden' }, { value: 'cancel', label: 'Weiterspielen' }])
          .then(function (v) { if (v === 'ok') act({ action: 'end' }); });
      case 'insert': return act({ action: 'insert', at: selIndex() + 1 });
      case 'up': return moveSel(-1);
      case 'down': return moveSel(1);
      case 'del': {
        var k = selIndex();
        if (k === S.cur) return oops(new Error('Die laufende Frage kann man nicht löschen.'));
        return act({ action: 'delete', index: k }).then(function () { selId = S.questions[S.cur] && S.questions[S.cur].id; editKey = ''; });
      }
      case 'goto': return act({ action: 'goto', index: selIndex() });
      case 'sel-cur': selId = curQ() && curQ().id; editKey = ''; return render();
    }
  }
  // Datei: dasselbe Format zum Speichern und Laden
  function saveFile() {
    var data = { format: 'retro-quiz', version: 1, title: S.title || S.name, defaults: S.defaults, questions: S.questions.map(function (q) { var c = Object.assign({}, q); delete c.id; return c; }) };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (data.title || 'quiz').replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    status('💾 ' + S.questions.length + ' Fragen als Datei gespeichert.');
  }
  fileInput.addEventListener('change', function () {
    var f = fileInput.files[0];
    if (!f) return;
    f.text().then(function (t) {
      var d = JSON.parse(t);
      if (!d || !Array.isArray(d.questions)) throw new Error('Das ist keine Quiz-Datei.');
      return dialog('📂 Quiz laden', '<p><b>' + esc(d.title || f.name) + '</b> mit ' + d.questions.length + ' Fragen laden?' + (S.questions.length ? ' Die Fragen im Raum werden ersetzt, die Punkte bleiben.' : '') + '</p>',
        [{ value: 'ok', label: 'Laden' }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) {
        if (v === 'ok') { editKey = ''; lastCur = null; act({ action: 'load', title: d.title, defaults: d.defaults, questions: d.questions }).then(function () { status('📂 ' + d.questions.length + ' Fragen geladen.'); }); }
      });
    }).catch(function (e) { oops(e instanceof SyntaxError ? new Error('Die Datei lässt sich nicht lesen.') : e); });
  });

  document.addEventListener('keydown', function (e) {
    if (!S || dlg.open || e.ctrlKey || e.metaKey || e.altKey || typing()) return;
    var k = e.key.toLowerCase();
    if (S.isHost) {
      if (S.buzz && S.buzz.answering && (k === 'r' || k === 'f')) { e.preventDefault(); return doAct(k === 'r' ? 'right' : 'wrong'); }
      if (S.phase === 'reveal' && k === 'n') { e.preventDefault(); return doAct('next'); }
      if (S.phase === 'prep' && k === 'enter') { e.preventDefault(); return doAct('open'); }
      return;
    }
    if (S.phase !== 'open' || !S.q) return;
    if (S.q.type === 'buzzer' && (k === ' ' || k === 'enter')) { e.preventDefault(); return buzzNow(); }
    var idx = S.q.type === 'mc' ? ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : ['a', 'b', 'c', 'd'].indexOf(k) : S.q.type === 'tf' ? ['w', 'f'].indexOf(k) : -1;
    if (S.q.type === 'tf' && idx < 0) idx = ['1', '2'].indexOf(k);
    if (idx >= 0 && S.q.options[idx]) { e.preventDefault(); S.my.answer = idx; render(); act({ action: 'answer', value: idx }); }
  });

  if (root.dataset.code) enter(root.dataset.code); else showStart();
})();
