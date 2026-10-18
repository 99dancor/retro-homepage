// Werwolf (Startmenü → Spiele und Apps → 🐺 Werwolf): Startauswahl, Warteraum und Spiel.
// Den Raum schickt der Server per Server-Sent Events (/werwolf/<code>/events) als „state“ mit allem, was diese Person
// wissen darf. Eingaben gehen per POST mit dem Formular-Token im Kopf x-csrf-token. Rollen, Nacht und Stimmen zählt
// der Server. Im lokalen Modus liest ein Gerät auf Wunsch vor (Sprachausgabe des Browsers, nichts geht ins Netz).
(function () {
  'use strict';
  var root = document.getElementById('ww');
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  var CSRF = root.dataset.csrf, MEMBER = !!root.dataset.member, MYNAME = root.dataset.name;
  var EMOJIS = root.dataset.emojis.split(' '), COLORS = root.dataset.colors.split(' ');
  var ROLES = JSON.parse(root.dataset.roles);
  var ORDER = ['werwolf', 'seherin', 'hexe', 'jaeger', 'amor', 'beschuetzer'];
  var CAUSE = { wolf: 'von den Werwölfen geholt', gift: 'vergiftet', dorf: 'vom Dorf verurteilt', jaeger: 'vom Jäger erschossen', liebe: 'vor Kummer gestorben', weg: 'hat das Dorf verlassen' };
  var main = $('ww-main'), nav = $('ww-nav'), statusEl = $('ww-status'), dlg = $('ww-dlg');
  var Sound = window.RetroSound || { play: function () {} };

  var code = null, es = null, S = null, recvAt = 0, startData = null, pollTimer = null;
  var chatTab = 'dorf', lastSaid = '', lastPhaseKey = '', reveal = false, wake = null, chatSeen = 0;

  // ---------- Kleinkram ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function status(text) { statusEl.textContent = text; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
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
  function act(body) { return req('POST', '/werwolf/' + code, body).catch(oops); }
  function dialog(title, html, buttons) {
    $('ww-dlg-title').textContent = title;
    $('ww-dlg-body').innerHTML = html;
    var acts = $('ww-dlg-actions');
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
      var first = dlg.querySelector('input:not([type=checkbox]):not([type=radio])');
      if (first) first.focus();
    });
  }
  function field(name) { var el = dlg.querySelector('[name=' + name + ']'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; }
  // Inhalt tauschen, ohne dass das Feld, in dem man gerade tippt, den Fokus verliert
  function patch(el, html) {
    if (el.__html === html) return;
    el.__html = html;
    var a = document.activeElement, keep = null, scroll = {};
    if (a && el.contains(a) && a.dataset && a.dataset.k) keep = { k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd };
    el.querySelectorAll('[data-scroll]').forEach(function (s) { scroll[s.dataset.scroll] = { top: s.scrollTop, end: s.scrollTop + s.clientHeight >= s.scrollHeight - 4 }; });
    el.innerHTML = html;
    el.querySelectorAll('[data-scroll]').forEach(function (s) { var o = scroll[s.dataset.scroll]; s.scrollTop = !o || o.end ? s.scrollHeight : o.top; });
    if (keep) {
      var n = el.querySelector('[data-k="' + keep.k + '"]');
      if (n) { n.focus(); try { if (keep.s != null) n.setSelectionRange(keep.s, keep.e); } catch (e) { /* egal */ } }
    }
  }
  function av(p, size) {
    size = size || 28;
    var st = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.6) + 'px;';
    if (p.avatar) return '<img class="qz-av" src="' + esc(p.avatar) + '" alt="" width="' + size + '" height="' + size + '">';
    var ch = p.emoji || (Array.from(p.name || '?')[0] || '?').toUpperCase();
    return '<span class="qz-av" style="' + st + 'background:' + esc(p.color || '#5d6d7e') + '" aria-hidden="true">' + esc(ch) + '</span>';
  }
  function player(pid) { return S && S.players.filter(function (p) { return p.pid === pid; })[0] || { name: '?', pid: pid }; }
  function pname(pid) { return esc(player(pid).name); }
  function roleTag(role, short) { var r = ROLES[role]; return r ? '<span class="ww-role r-' + role + '">' + r.icon + (short ? '' : ' ' + esc(r.name)) + '</span>' : ''; }
  function clock(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function msLeft() { return S && S.ms ? Math.max(0, S.ms - (Date.now() - recvAt)) : 0; }
  function timerHtml() { return S.ms ? '<span class="qz-time ww-clock" id="ww-clock">' + clock(msLeft()) + '</span>' : ''; }
  setInterval(function () {
    var el = $('ww-clock');
    if (el && S) { var l = msLeft(); el.textContent = clock(l); el.classList.toggle('warn', l < 10000); }
  }, 250);

  // ---------- Erzähler: liest im lokalen Modus vor, was am Tisch passiert ----------
  var VOICE = 'werwolf-erzaehler';
  function narratorOn() { var v = store(VOICE); return v === null ? !!(S && S.isHost && S.mode === 'lokal') : !!v; }
  function speak(text) {
    if (!text || !narratorOn() || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.rate = 0.95;
      var vol = window.RetroSound && RetroSound.effekte ? RetroSound.effekte() : 1;
      u.volume = Math.max(0.2, vol);
      var de = speechSynthesis.getVoices().filter(function (v) { return /^de/i.test(v.lang); })[0];
      if (de) u.voice = de;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* ohne Stimme geht es auch */ }
  }
  function plain(pid) { return player(pid).name; }
  function newsText(list) {
    if (!list.length) return '';
    return list.map(function (n) {
      var p = player(n.pid), r = p.role && ROLES[p.role];
      return p.name + ' ist ' + CAUSE[n.cause] + (r ? ' und war ' + r.name : '') + '.';
    }).join(' ');
  }
  // Was sagt der Erzähler, wenn eine neue Phase beginnt?
  function story(s) {
    var town = s.name;
    switch (s.phase) {
      case 'roles': return 'Willkommen in ' + town + '. Jeder schaut sich jetzt heimlich seine Rolle an und tippt dann auf Verstanden.';
      case 'night':
        if (s.step === 2) return 'Die Nacht ist noch nicht vorbei. Schaut noch einmal auf euer Handy und tippt eure Aufgabe an.';
        return (s.verdict ? (s.verdict.pid ? newsText(s.news) + ' ' : 'Das Dorf hat niemanden verurteilt. ') : '') +
          'Es wird Nacht in ' + town + '. Ab jetzt redet niemand mehr. Jeder schaut nur auf sein eigenes Handy und erledigt seine Aufgabe.';
      case 'day': {
        var text = 'Der Morgen graut über ' + town + '. ' + (s.news.length ? newsText(s.news) : 'Heute Nacht ist niemand gestorben.');
        if (s.mode === 'lokal') text += ' Redet jetzt miteinander: Wer von euch ist ein Werwolf?';
        return text;
      }
      case 'vote': return 'Zeit für die Abstimmung. Stimmt auf euren Handys ab, wer verurteilt werden soll.';
      case 'hunter': return newsText(s.news) + ' ' + plain(s.hunter) + ' war der Jäger und schießt noch ein letztes Mal.';
      case 'end': return { dorf: 'Alle Werwölfe sind tot. Das Dorf hat gewonnen!', wolf: 'Die Werwölfe haben das Dorf überrannt. Die Werwölfe haben gewonnen!', liebe: 'Nur das Liebespaar ist übrig. Die Liebe hat gewonnen!', niemand: 'Niemand hat überlebt.', abbruch: 'Das Spiel wurde abgebrochen.' }[s.winner] || '';
      default: return '';
    }
  }

  // Bildschirm im lokalen Spiel wach halten, damit das Handy nicht mitten in der Nacht ausgeht
  function keepAwake(onoff) {
    if (onoff && !wake && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {});
    if (!onoff && wake) { wake.release().catch(function () {}); wake = null; }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S && S.mode === 'lokal' && running()) keepAwake(true); });
  function running() { return S && S.phase !== 'lobby' && S.phase !== 'end'; }

  // ---------- Startseite ----------
  function showStart() {
    code = null; S = null;
    if (es) { es.close(); es = null; }
    keepAwake(false);
    try { history.replaceState(null, '', '/werwolf'); } catch (e) { /* egal */ }
    document.title = 'Werwolf';
    root.classList.remove('ww-dark');
    nav.innerHTML = '<a href="#" data-nav="start" class="active">🐺 Werwolf</a><a href="#" data-nav="rules">📖 Regeln</a><span class="spacer"></span><span class="qz-me">' +
      (MEMBER ? '👤 ' + esc(MYNAME) : '👤 Gast · <a href="/login?next=/werwolf">Anmelden</a>') + '</span>';
    loadStart();
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!code && !document.hidden) loadStart(); }, 5000);
  }
  function loadStart() {
    return req('GET', '/werwolf/raeume').then(function (j) { startData = j; if (!code) renderStart(); }).catch(oops);
  }
  function renderStart() {
    var j = startData;
    var rows = j.rooms.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + (r.mode === 'online' ? '🌐 Online' : '🏠 Lokal') + '</td><td>' + esc(r.host) + '</td><td class="num">' + r.players + '</td><td>' + esc(r.status) +
        (!r.guests && !MEMBER ? ' <small>(nur Mitglieder)</small>' : '') + '</td><td class="qz-acts"><button type="button" class="small" data-enter="' + esc(r.code) + '">Beitreten</button></td></tr>';
    }).join('');
    var mine = j.mine.map(function (r) { return '<button type="button" class="small" data-enter="' + esc(r.code) + '">' + (r.host ? '👑 ' : '🙋 ') + esc(r.name) + ' (' + esc(r.code) + ')</button>'; }).join(' ');
    var canCreate = MEMBER || j.guestsAllowed;
    patch(main, '<div class="qz-pad">' +
      '<div class="qz-choice">' +
      '<button type="button" class="qz-big" data-act="create" data-mode="lokal"' + (canCreate ? '' : ' disabled') + '><span class="ico">🏠</span>Lokal spielen<small>Alle sitzen zusammen, jeder mit seinem Handy</small></button>' +
      '<button type="button" class="qz-big" data-act="create" data-mode="online"' + (canCreate ? '' : ' disabled') + '><span class="ico">🌐</span>Online spielen<small>Jeder von zu Hause, mit Chat</small></button></div>' +
      '<form class="qz-codeform" id="ww-codeform">Raumcode: <input type="text" id="ww-code" data-k="code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="K7QX"> <button>Beitreten</button></form>' +
      (mine ? '<p class="qz-center">Zurück in: ' + mine + '</p>' : '') +
      '<fieldset class="groupbox"><legend>Offene Dörfer</legend>' +
      (rows ? '<table class="list"><thead><tr><th>Dorf</th><th>Modus</th><th>Gastgeber</th><th class="num">Spieler</th><th>Stand</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="qz-empty">Gerade ist kein Dorf offen. Mach eins auf und schick den anderen den Link.</p>') +
      (!canCreate ? '<p><small>Zum Eröffnen musst du <a href="/login?next=/werwolf">angemeldet</a> sein.</small></p>' : '') + '</fieldset>' +
      '<fieldset class="groupbox"><legend>So läuft es lokal</legend><ol class="ww-how">' +
      '<li>Einer macht einen Raum auf, alle anderen scannen den QR-Code oder geben den Code ein. Ein Konto braucht niemand.</li>' +
      '<li>Jeder schaut sich auf seinem Handy heimlich seine Rolle an.</li>' +
      '<li>Nachts tippen <b>alle</b> gleichzeitig etwas an: Werwölfe ihr Opfer, die Seherin eine Person … und wer keine Aufgabe hat, seinen Verdacht. So verrät niemand durch Tippen, wer er ist.</li>' +
      '<li>Am Tag redet ihr am Tisch und stimmt dann auf den Handys ab. Das Gerät des Gastgebers liest als Erzähler vor (🔊 oben ein- oder ausschalten).</li></ol></fieldset></div>');
    status(j.rooms.length + (j.rooms.length === 1 ? ' offenes Dorf' : ' offene Dörfer'));
  }
  function guestFields() {
    var g = store('werwolf-gast') || {};
    var emo = g.emoji && EMOJIS.indexOf(g.emoji) >= 0 ? g.emoji : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    return '<label class="qz-row"><span>Dein Name</span><input name="pname" maxlength="24" required value="' + esc(g.name || '') + '"></label>' +
      '<div class="qz-row"><span>Bild</span><div class="qz-pick" id="ww-emo">' + EMOJIS.map(function (e) {
        return '<button type="button" data-emo="' + e + '" aria-pressed="' + (e === emo) + '">' + av({ emoji: e, color: g.color || COLORS[1] }, 30) + '</button>';
      }).join('') + '</div></div><input type="hidden" name="emoji" value="' + esc(emo) + '">';
  }
  dlg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-emo]');
    if (!b) return;
    dlg.querySelectorAll('[data-emo]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    dlg.querySelector('[name=emoji]').value = b.dataset.emo;
  });
  function rememberGuest() { if (!MEMBER) store('werwolf-gast', { name: field('pname'), emoji: field('emoji') }); }
  function createRoom(mode) {
    dialog(mode === 'online' ? '🌐 Online-Dorf eröffnen' : '🏠 Lokales Dorf eröffnen',
      '<label class="qz-row"><span>Name des Dorfs</span><input name="name" maxlength="40" placeholder="Wolfsbach"></label>' +
      (MEMBER ? '' : guestFields()) +
      '<label class="inline"><input type="checkbox" name="hidden"> Nicht in der Liste zeigen (nur mit Code oder Link)</label><br>' +
      '<label class="inline"><input type="checkbox" name="guests" checked> Gäste ohne Konto dürfen mitspielen</label>',
      [{ value: 'ok', label: 'Eröffnen' }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) {
      if (v !== 'ok') return;
      rememberGuest();
      req('POST', '/werwolf/raeume', { name: field('name'), mode: mode, hidden: field('hidden'), guests: field('guests'), playerName: field('pname'), emoji: field('emoji') })
        .then(function (j) { enter(j.code); }).catch(oops);
    });
  }
  function enter(c) {
    c = String(c || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{4}$/.test(c)) return oops(new Error('Der Code hat vier Zeichen.'));
    req('GET', '/werwolf/' + c + '/info').then(function (info) {
      if (info.joined) return connect(c);
      if (info.member) return req('POST', '/werwolf/' + c + '/beitreten', {}).then(function () { connect(c); });
      if (!info.guests) return oops(new Error('In diesem Dorf spielen nur angemeldete Mitglieder mit.'));
      return dialog('🙋 ' + info.name + ' beitreten', guestFields(), [{ value: 'ok', label: 'Beitreten' }, { value: 'cancel', label: 'Abbrechen' }]).then(function (v) {
        if (v !== 'ok') { if (!startData) showStart(); return; }
        rememberGuest();
        return req('POST', '/werwolf/' + c + '/beitreten', { name: field('pname'), emoji: field('emoji') }).then(function () { connect(c); });
      });
    }).catch(function (e) { oops(e); if (!startData) showStart(); });
  }

  // ---------- Live-Verbindung ----------
  function connect(c) {
    code = c;
    clearInterval(pollTimer);
    try { history.replaceState(null, '', '/werwolf/' + c); } catch (e) { /* egal */ }
    if (es) es.close();
    es = new EventSource('/werwolf/' + c + '/events');
    es.addEventListener('state', function (ev) { S = JSON.parse(ev.data); recvAt = Date.now(); render(); });
    es.addEventListener('closed', function (ev) { es.close(); es = null; status(JSON.parse(ev.data).message); showStart(); });
    es.onerror = function () { if (es && es.readyState === 2) { es = null; status('Verbindung verloren.'); showStart(); } else status('Verbindung wird wiederhergestellt …'); };
    status('Verbinde …');
  }

  // ---------- Raum ----------
  function render() {
    var s = S;
    document.title = 'Werwolf – ' + s.name;
    var key = s.game + ':' + s.phase + ':' + s.step + ':' + s.day;
    if (key !== lastPhaseKey) {
      if (lastPhaseKey) {
        speak(story(s));
        if (s.phase === 'night' && s.step === 1) Sound.play('heulen');
        else if (s.phase === 'day') Sound.play('morgen');
        else if (s.phase === 'end') Sound.play('tusch');
        else Sound.play('hinweis');
      }
      lastPhaseKey = key; reveal = false;
    }
    keepAwake(s.mode === 'lokal' && running());
    root.classList.toggle('ww-dark', s.phase === 'night');
    var me = player(s.me);
    nav.innerHTML = '<a href="#" data-nav="start">🐺 Werwolf</a><a href="#" data-nav="rules">📖 Regeln</a>' +
      '<a href="#" data-nav="voice" title="Erzähler liest vor">' + (narratorOn() ? '🔊 Erzähler an' : '🔈 Erzähler aus') + '</a>' +
      '<span class="spacer"></span><span class="qz-me">' + (s.mode === 'online' ? '🌐' : '🏠') + ' ' + esc(s.name) + ' · <span class="qz-code small">' + esc(s.code) + '</span></span>' +
      '<a href="#" data-nav="leave">🚪 Verlassen</a>';
    var stage = { lobby: lobby, roles: roles, night: night, day: day, vote: vote, hunter: hunter, end: end }[s.phase](s);
    var side = '<div class="ww-side">' + people(s) + (s.mode === 'online' ? chat(s) : '') + '</div>';
    patch(main, '<div class="ww-play"><div class="ww-stage">' + stage + '</div>' + side + '</div>');
    var alive = s.players.filter(function (p) { return p.alive && !p.left; }).length;
    status(s.phase === 'lobby' ? s.players.length + ' im Dorf' : s.phase === 'end' ? 'Spiel vorbei' : (me.alive ? '' : '💀 Du bist tot · ') + alive + ' leben noch');
  }

  function people(s) {
    var rows = s.players.map(function (p) {
      var bits = [];
      if (p.host) bits.push('<span title="Gastgeber">👑</span>');
      // Lokal sieht der Nachbar mit: Rudel und Liebespaar nur, solange man die Rolle aufdeckt
      var secret = s.mode === 'lokal' && !reveal && p.alive && s.phase !== 'end';
      if (p.lover && !secret) bits.push('<span title="Verliebt">💘</span>');
      if (p.role && (!p.alive || p.pid !== s.me || s.phase === 'end') && !secret) bits.push(roleTag(p.role, true));
      var st = p.left ? 'weg' : p.seen ? '✔' : p.done ? '✔' : p.ready ? '🙋' : '';
      var nm = '<span class="qz-name">' + esc(p.name) + '</span>' + (p.guest ? ' <span class="qz-guest">(Gast)</span>' : '') + (p.pid === s.me ? ' <span class="qz-guest">(du)</span>' : '');
      return '<li class="' + (p.alive ? '' : 'dead') + (p.online ? '' : ' off') + '"><a href="#" class="qz-userlink" data-who="' + esc(p.pid) + '">' + av(p, 24) + ' ' + nm + '</a>' +
        '<span class="ww-bits">' + bits.join('') + (st ? ' <small>' + st + '</small>' : '') + '</span></li>';
    }).join('');
    return '<div class="qz-head">Dorfbewohner (' + s.players.length + ')</div><ul class="ww-people">' + rows + '</ul>';
  }

  function chat(s) {
    var tabs = ['dorf', 'wolf', 'tot'].filter(function (c) { return s.chat.some(function (m) { return m.ch === c; }) || s.canWrite.indexOf(c) >= 0 || c === 'dorf'; });
    if (tabs.indexOf(chatTab) < 0) chatTab = s.canWrite[0] || 'dorf';
    if (s.phase === 'night' && s.canWrite.indexOf('wolf') >= 0 && chatTab === 'dorf') chatTab = 'wolf';
    var names = { dorf: '🏘️ Dorf', wolf: '🐺 Wölfe', tot: '💀 Tote' };
    var msgs = s.chat.filter(function (m) { return m.ch === chatTab; }).map(function (m) {
      return '<div class="ww-msg' + (m.pid === s.me ? ' mine' : '') + '"><b>' + esc(m.name) + ':</b> ' + esc(m.text) + '</div>';
    }).join('') || '<p class="qz-empty"><small>Noch nichts geschrieben.</small></p>';
    var can = s.canWrite.indexOf(chatTab) >= 0;
    return '<div class="qz-head">Chat</div><div class="ww-tabs">' + tabs.map(function (c) {
      return '<button type="button" class="small' + (c === chatTab ? ' on' : '') + '" data-tab="' + c + '">' + names[c] + '</button>';
    }).join('') + '</div><div class="ww-chat" data-scroll="chat">' + msgs + '</div>' +
      (can ? '<form class="ww-say" id="ww-say"><input data-k="say" maxlength="300" autocomplete="off" placeholder="Nachricht …"><button>➤</button></form>'
        : '<p class="ww-note"><small>' + (s.phase === 'night' ? 'Nachts schläft das Dorf.' : 'Hier kannst du gerade nicht schreiben.') + '</small></p>');
  }

  function rolesBox(s) {
    var edit = s.isHost;
    var set = ORDER.map(function (k) {
      var r = ROLES[k], n = s.roles[k] || 0;
      var ctl = edit ? '<input type="number" min="' + (k === 'werwolf' ? 1 : 0) + '" max="' + (k === 'werwolf' ? 10 : 1) + '" value="' + n + '" data-role="' + k + '" class="ww-n">' : '<b>' + n + '</b>';
      return '<tr><td>' + r.icon + ' ' + esc(r.name) + '</td><td class="num">' + ctl + '</td><td class="ww-desc"><small>' + esc(r.text) + '</small></td></tr>';
    }).join('');
    return '<fieldset class="groupbox"><legend>Rollen</legend>' +
      (edit ? '<label class="inline"><input type="checkbox" data-set="auto"' + (s.auto ? ' checked' : '') + '> Automatisch nach Spielerzahl</label>' : (s.auto ? '<p><small>Rollen passen sich der Spielerzahl an.</small></p>' : '')) +
      '<table class="list ww-roles">' + set + '<tr><td>' + ROLES.dorf.icon + ' Dorfbewohner</td><td class="num"><b>Rest</b></td><td class="ww-desc"><small>' + esc(ROLES.dorf.text) + '</small></td></tr></table>' +
      '<p>Im Spiel: ' + esc(s.set) + '</p></fieldset>';
  }
  function optsBox(s) {
    var o = s.opts, dis = s.isHost ? '' : ' disabled';
    var num = function (k, label, min, max, hint) { return '<label class="qz-row"><span>' + label + '</span><input type="number" min="' + min + '" max="' + max + '" value="' + o[k] + '" data-opt="' + k + '"' + dis + ' style="width:70px"> s' + (hint ? ' <small>' + hint + '</small>' : '') + '</label>'; };
    var chk = function (k, label) { return '<label class="inline"><input type="checkbox" data-opt="' + k + '"' + (o[k] ? ' checked' : '') + dis + '> ' + label + '</label><br>'; };
    return '<fieldset class="groupbox"><legend>Regeln</legend>' +
      '<div class="qz-row"><span>Modus</span><select data-set="mode"' + dis + '><option value="lokal"' + (s.mode === 'lokal' ? ' selected' : '') + '>🏠 Lokal (am selben Tisch)</option><option value="online"' + (s.mode === 'online' ? ' selected' : '') + '>🌐 Online (mit Chat)</option></select></div>' +
      num('night', 'Nacht', 15, 600) + num('talk', 'Reden am Tag', 0, 1800, '0 = bis alle bereit sind') + num('vote', 'Abstimmung', 15, 600) +
      chk('reveal', 'Rolle von Toten aufdecken') + chk('deadSee', 'Tote sehen alle Rollen und schauen zu') + chk('witchSelf', 'Hexe darf sich selbst heilen') + '</fieldset>';
  }
  function lobby(s) {
    var link = location.origin + '/werwolf/' + s.code;
    var invite = '<fieldset class="groupbox qz-invite ww-invite"><legend>Einladen</legend><div class="qz-center"><div class="qz-code">' + esc(s.code) + '</div>' +
      '<img class="qz-qr" src="/werwolf/' + esc(s.code) + '/qr.svg" width="148" height="148" alt="QR-Code zum Beitreten">' +
      '<input class="qz-link" readonly value="' + esc(link) + '" onclick="this.select()"></div></fieldset>';
    var start = s.isHost ? '<div class="qz-startrow">' + (s.problem ? '<span class="qz-err">' + esc(s.problem) + '</span>' : '') +
      '<button type="button" data-act="start"' + (s.problem ? ' disabled' : '') + '>▶ Spiel starten</button></div>'
      : '<p class="qz-center">Warte, bis ' + esc(player(s.players.filter(function (p) { return p.host; })[0].pid).name) + ' das Spiel startet …</p>';
    return '<div class="ww-lobby"><div>' + rolesBox(s) + optsBox(s) + start + '</div><div class="ww-lobby-right">' + invite +
      (s.mode === 'lokal' ? '<p class="ww-tip">🏠 Lokal: Legt die Handys so, dass niemand auf fremde Bildschirme schaut. Geredet wird am Tisch.</p>'
        : '<p class="ww-tip">🌐 Online: Am Tag redet ihr im Dorf-Chat, die Werwölfe haben nachts ihren eigenen Chat.</p>') + '</div></div>';
  }

  function card(role, hidden) {
    var r = ROLES[role];
    if (hidden) return '<button type="button" class="ww-card back" data-act="peek" title="Gedrückt halten"><span class="ico">🂠</span><b>Gedrückt halten</b><small>zum Ansehen deiner Rolle</small></button>';
    return '<div class="ww-card r-' + role + '"><span class="ico">' + r.icon + '</span><b>' + esc(r.name) + '</b><small>' + esc(r.text) + '</small></div>';
  }
  function myCard(s) {
    var m = s.mine, hide = s.mode === 'lokal' && !reveal;
    var wolves = m.role === 'werwolf' ? s.players.filter(function (p) { return p.role === 'werwolf' && p.pid !== s.me; }) : [];
    return '<div class="ww-cardrow">' + card(m.role, hide) + '</div>' +
      (!hide && wolves.length ? '<p class="qz-center">Deine Rudel-Mitglieder: ' + wolves.map(function (p) { return '<b>' + esc(p.name) + '</b>'; }).join(', ') + '</p>' : '');
  }
  function roles(s) {
    var seen = player(s.me).seen;
    var n = s.players.filter(function (p) { return p.seen || p.left; }).length;
    return '<div class="ww-head"><h2>🎭 Deine Rolle</h2></div>' + myCard(s) +
      '<p class="qz-center">' + (seen ? '✔ Warte auf die anderen (' + n + ' von ' + s.players.length + ')' :
        '<button type="button" class="ww-go" data-act="seen">Verstanden</button>') + '</p>' +
      (s.isHost ? '<p class="qz-center"><button type="button" class="small" data-act="skip">Nicht mehr warten</button></p>' : '');
  }
  function notes(s) {
    var list = (s.mine.notes || []).slice().reverse();
    return list.length ? '<div class="ww-notes">' + list.map(function (n) { return '<div>' + esc(n.text) + '</div>'; }).join('') + '</div>' : '';
  }
  var TASK = {
    wolf: ['🐺 Wen holt ihr heute Nacht?', 'Die anderen Werwölfe sehen, wen du antippst. Bei Gleichstand entscheidet das Los.'],
    seherin: ['🔮 Wessen Rolle willst du sehen?', 'Du erfährst die Rolle sofort nach dem Bestätigen.'],
    schutz: ['🛡️ Wen beschützt du heute Nacht?', 'Nicht zweimal hintereinander dieselbe Person.'],
    amor: ['💘 Wer soll sich verlieben?', 'Tippe zwei Personen an, du darfst auch dich selbst nehmen.'],
    verdacht: ['🤔 Wen verdächtigst du?', 'Am Morgen erfährt das Dorf, wer nachts am meisten verdächtigt wurde. Alle tippen nachts etwas an, damit niemand auffällt.'],
    vertrauen: ['🤝 Wem vertraust du am meisten?', 'Das bleibt geheim und hat keine Folgen. Es sorgt nur dafür, dass alle gleich lange tippen.'],
    vote: ['⚖️ Wer soll verurteilt werden?', 'Die Abstimmung ist offen: alle sehen, wer wen wählt. Bei Gleichstand stirbt niemand.'],
    jaeger: ['🏹 Wen nimmst du mit?', 'Dein letzter Schuss.'],
  };
  function targets(s, t) {
    var m = s.mine, wp = s.wolfPicks || {}, votes = s.votes || {};
    var list = s.players.filter(function (p) { return p.alive && !p.left; });
    return '<div class="ww-grid">' + list.map(function (p) {
      var allowed = { wolf: p.role !== 'werwolf', seherin: p.pid !== s.me, verdacht: p.pid !== s.me, vertrauen: p.pid !== s.me, vote: p.pid !== s.me, jaeger: p.pid !== s.me, hexe: p.pid !== s.me,
        schutz: p.pid !== m.lastProtected, amor: true }[t];
      var on = m.target === p.pid || m.target2 === p.pid;
      var marks = '';
      if (t === 'wolf' || (!m.alive && s.wolfPicks)) {
        var by = Object.keys(wp).filter(function (w) { return wp[w] === p.pid; });
        if (by.length) marks += '<span class="ww-marks">🐺 ' + by.map(pname).join(', ') + '</span>';
      }
      if (s.phase === 'vote') {
        var v = Object.keys(votes).filter(function (x) { return votes[x] === p.pid; });
        if (v.length) marks += '<span class="ww-marks">' + v.length + ' · ' + v.map(pname).join(', ') + '</span>';
      }
      return '<button type="button" class="ww-target' + (on ? ' on' : '') + '" data-pick="' + esc(p.pid) + '"' + (allowed && !(m.done && t !== 'vote') ? '' : ' disabled') + '>' +
        av(p, 34) + '<span class="nm">' + esc(p.name) + (p.pid === s.me ? ' (du)' : '') + '</span>' + marks + '</button>';
    }).join('') + '</div>';
  }
  function progressLine(s) {
    var a = s.players.filter(function (p) { return p.alive && !p.left; });
    var n = a.filter(function (p) { return p.done; }).length;
    return '<p class="qz-center"><small>' + n + ' von ' + a.length + ' fertig</small></p>';
  }
  function taskBox(s) {
    var m = s.mine, t = m.task;
    if (!m.alive && t !== 'jaeger') return '<div class="ww-dead"><span class="ico">💀</span><p>Du bist tot und schaust nur noch zu.' + (s.mode === 'lokal' ? ' Bitte nichts verraten!' : '') + '</p></div>';
    if (!t) return '<p class="qz-center">Warte …</p>';
    if (t === 'hexe') {
      var v = m.victim ? player(m.victim) : null;
      var canHeal = m.potions.heal && v && (s.opts.witchSelf || m.victim !== s.me);
      return '<h3>🧪 Die Werwölfe holen ' + (v ? '<b>' + esc(v.name) + '</b>' + (m.victim === s.me ? ' (dich!)' : '') : 'heute niemanden') + '.</h3>' +
        (m.done ? '' : '<p>' + (m.potions.heal ? (canHeal ? '<label class="inline ww-potion"><input type="checkbox" data-heal' + (m.heal ? ' checked' : '') + '> 💚 Heiltrank benutzen und ' + esc(v.name) + ' retten</label>'
          : '💚 Den Heiltrank kannst du gerade nicht einsetzen.') : '💚 Heiltrank schon verbraucht.') + '</p>' +
        (m.potions.poison ? '<p>☠️ Gifttrank: tippe jemanden an, der stirbt (nochmal antippen hebt es auf).</p>' + targets(s, 'hexe') : '<p>☠️ Gifttrank schon verbraucht.</p>')) +
        doneRow(s, true);
    }
    var txt = TASK[t];
    return '<h3>' + txt[0] + '</h3><p><small>' + esc(txt[1]) + '</small></p>' + targets(s, t) +
      (t === 'vote' ? '<p class="qz-center"><button type="button" class="small' + (m.target === 'skip' ? ' on' : '') + '" data-pick="skip">Enthalten</button></p>' : '') + doneRow(s, false);
  }
  function doneRow(s, optional) {
    var m = s.mine;
    if (m.done) return '<p class="qz-center ww-ok">✔ Entschieden. Warte auf die anderen …</p>' + (s.phase === 'vote' ? '<p class="qz-center"><small>Du kannst deine Stimme noch ändern.</small></p>' : '');
    var ready = optional || m.target && (m.task !== 'amor' || m.target2);
    return '<p class="qz-center"><button type="button" class="ww-go" data-act="done"' + (ready ? '' : ' disabled') + '>' + (optional && !m.heal && !m.target ? 'Nichts tun' : 'Bestätigen') + '</button></p>';
  }
  function verdictLine(s) {
    if (!s.verdict) return '';
    if (!s.verdict.pid) return '<div class="qz-banner">⚖️ ' + (s.verdict.tie ? 'Gleichstand: niemand wurde verurteilt.' : 'Das Dorf hat niemanden verurteilt.') + '</div>';
    return '';
  }
  function newsBox(s) {
    if (!s.news.length) return '';
    return '<div class="ww-news">' + s.news.map(function (n) {
      var p = player(n.pid);
      return '<div class="ww-death">' + av(p, 30) + ' <span><b>' + esc(p.name) + '</b> ist ' + CAUSE[n.cause] + '.' + (p.role ? ' ' + roleTag(p.role) : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function head(title, s) { return '<div class="ww-head"><h2>' + title + '</h2>' + timerHtml() + '</div>'; }
  function night(s) {
    var title = '🌙 Nacht ' + (s.day + 1) + (s.step === 2 ? ' · noch einmal' : '');
    return head(title, s) + (s.step === 1 ? verdictLine(s) + newsBox(s) : '') + mineMini(s) + taskBox(s) + progressLine(s) +
      (s.isHost ? '<p class="qz-center"><button type="button" class="small" data-act="skip">Nicht mehr warten</button></p>' : '');
  }
  // Rolle klein oben (lokal verdeckt: antippen zeigt sie)
  function mineMini(s) {
    var r = ROLES[s.mine.role];
    if (s.mode === 'lokal' && !reveal) return '<p class="ww-mini"><button type="button" class="small" data-act="peek">🂠 Rolle zeigen (halten)</button></p>' + notes(s);
    return '<p class="ww-mini">' + r.icon + ' Du bist <b>' + esc(r.name) + '</b>' + (s.mode === 'lokal' ? ' <small>(loslassen verdeckt)</small>' : '') + '</p>' + notes(s);
  }
  function day(s) {
    var me = player(s.me), a = s.players.filter(function (p) { return p.alive && !p.left; });
    var ready = a.filter(function (p) { return p.ready; }).length;
    return head('☀️ Tag ' + s.day, s) + (s.news.length ? newsBox(s) : '<div class="qz-banner ok">🌅 Heute Nacht ist niemand gestorben.</div>') +
      (s.suspect ? '<p>🤔 Nachts am meisten verdächtigt: <b>' + pname(s.suspect) + '</b></p>' : '') +
      mineMini(s) +
      '<div class="ww-talk">' + (s.mode === 'lokal' ? '<p>🗣️ Redet jetzt am Tisch: Wer von euch ist ein Werwolf?</p>' : '<p>💬 Redet im Dorf-Chat: Wer von euch ist ein Werwolf?</p>') +
      (me.alive ? '<button type="button" class="ww-go" data-act="ready">' + (me.ready ? '✔ Bereit (zurücknehmen)' : '🙋 Bereit zur Abstimmung') + '</button>' : '') +
      '<p><small>' + ready + ' von ' + a.length + ' bereit. Wenn mehr als die Hälfte bereit ist, geht es zur Abstimmung.</small></p>' +
      (s.isHost ? '<button type="button" class="small" data-act="skip">Abstimmung jetzt starten</button>' : '') + '</div>';
  }
  function vote(s) { return head('⚖️ Abstimmung · Tag ' + s.day, s) + mineMini(s) + taskBox(s) + progressLine(s) + (s.isHost ? '<p class="qz-center"><button type="button" class="small" data-act="skip">Abstimmung beenden</button></p>' : ''); }
  function hunter(s) {
    var h = player(s.hunter);
    return head('🏹 Der Jäger schießt', s) + newsBox(s) +
      (s.mine.task === 'jaeger' ? taskBox(s) : '<p class="qz-center">' + esc(h.name) + ' war der Jäger und nimmt noch jemanden mit …</p>');
  }
  function end(s) {
    var W = { dorf: ['🏘️', 'Das Dorf hat gewonnen!'], wolf: ['🐺', 'Die Werwölfe haben gewonnen!'], liebe: ['💘', 'Das Liebespaar hat gewonnen!'], niemand: ['🪦', 'Niemand hat überlebt.'], abbruch: ['⏹️', 'Spiel abgebrochen'] }[s.winner];
    var won = (s.winners || []).indexOf(s.me) >= 0;
    var rows = s.players.map(function (p) {
      return '<tr class="' + (p.alive ? '' : 'dead') + '"><td>' + av(p, 22) + ' ' + esc(p.name) + (p.lover ? ' 💘' : '') + '</td><td>' + roleTag(p.role) + '</td><td>' +
        (p.alive ? 'lebt' : 'Tag ' + p.died.day + ': ' + CAUSE[p.died.cause]) + '</td><td>' + ((s.winners || []).indexOf(p.pid) >= 0 ? '🏆' : '') + '</td></tr>';
    }).join('');
    return '<div class="ww-win"><span class="ico">' + W[0] + '</span><h2>' + W[1] + '</h2>' + (s.winner !== 'abbruch' ? '<p>' + (won ? '🏆 Du hast gewonnen!' : 'Du hast leider verloren.') + '</p>' : '') + '</div>' +
      '<table class="list ww-endtab"><thead><tr><th>Name</th><th>Rolle</th><th>Schicksal</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<details class="ww-log"><summary>Spielverlauf</summary><ol>' + (s.log || []).map(function (l) { return '<li>' + (l.day ? '<small>Tag ' + l.day + ':</small> ' : '') + esc(l.text) + '</li>'; }).join('') + '</ol></details>' +
      (s.isHost ? '<p class="qz-startrow"><button type="button" data-act="lobby">↩ Zurück in den Warteraum</button><button type="button" data-act="start">▶ Neue Runde</button></p>' : '<p class="qz-center">Der Gastgeber kann eine neue Runde starten.</p>');
  }

  // ---------- Eingaben ----------
  function settings(b) { return act(Object.assign({ action: 'settings' }, b)); }
  main.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.role) { var roles = {}; main.querySelectorAll('[data-role]').forEach(function (x) { roles[x.dataset.role] = Number(x.value); }); settings({ roles: roles }); }
    else if (t.dataset.opt) { var o = {}; o[t.dataset.opt] = t.type === 'checkbox' ? t.checked : Number(t.value); settings({ opts: o }); }
    else if (t.dataset.set === 'auto') settings({ auto: t.checked });
    else if (t.dataset.set === 'mode') settings({ mode: t.value });
    else if (t.hasAttribute('data-heal')) act({ action: 'pick', heal: t.checked });
  });
  main.addEventListener('click', function (e) {
    var b = e.target.closest('button, a');
    if (!b) return;
    if (b.dataset.enter) return enter(b.dataset.enter);
    if (b.dataset.tab) { chatTab = b.dataset.tab; main.__html = ''; return render(); }
    if (b.dataset.who) { e.preventDefault(); return whoMenu(e, b.dataset.who); }
    if (b.dataset.pick) {
      var m = S.mine, same = m.target === b.dataset.pick && m.task !== 'amor';
      Sound.play('klick');
      return act({ action: 'pick', target: same && m.task === 'hexe' ? null : b.dataset.pick });
    }
    var a = b.dataset.act;
    if (!a || a === 'peek') return;
    if (a === 'create') return createRoom(b.dataset.mode);
    if (a === 'done') return act({ action: 'done' }).then(function () { Sound.play('ding'); });
    act({ action: a });
  });
  // Rolle nur zeigen, solange man drückt (lokal schauen sonst die Nachbarn mit)
  function peek(on) { if (reveal !== on) { reveal = on; if (S) { main.__html = ''; render(); } } }
  main.addEventListener('pointerdown', function (e) { if (e.target.closest('[data-act=peek]')) { e.preventDefault(); peek(true); } });
  document.addEventListener('pointerup', function () { if (reveal && S && S.mode === 'lokal') peek(false); });
  document.addEventListener('pointercancel', function () { if (reveal && S && S.mode === 'lokal') peek(false); });
  main.addEventListener('contextmenu', function (e) { if (e.target.closest('.ww-card, [data-act=peek]')) e.preventDefault(); });
  main.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'ww-codeform') return enter($('ww-code').value);
    if (e.target.id === 'ww-say') {
      var inp = e.target.querySelector('input'), text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      act({ action: 'chat', ch: chatTab, text: text });
    }
  });
  function whoMenu(e, pid) {
    var p = player(pid), items = [];
    if (S.isHost && pid !== S.me && !p.left) {
      items.push({ label: '👑 Zum Gastgeber machen', run: function () { act({ action: 'host', pid: pid }); } });
      if (!running()) items.push({ label: '🚫 Aus dem Raum nehmen', run: function () { act({ action: 'kick', pid: pid }); } });
    }
    if (p.user && window.RetroUserMenu) return RetroUserMenu.open(e, p.user, { items: items });
    if (!items.length) return;
    dialog(p.name, '<p>' + esc(p.name) + ' spielt als Gast mit.</p>', items.map(function (it, i) { return { value: String(i), label: it.label }; }).concat([{ value: 'cancel', label: 'Abbrechen' }]))
      .then(function (v) { if (items[v]) items[v].run(); });
  }
  nav.addEventListener('click', function (e) {
    var a = e.target.closest('[data-nav]');
    if (!a) return;
    e.preventDefault();
    var n = a.dataset.nav;
    if (n === 'start') return code ? showStart() : null;
    if (n === 'rules') return rules();
    if (n === 'voice') { store(VOICE, !narratorOn()); if (narratorOn()) speak('Der Erzähler ist da.'); else if (window.speechSynthesis) speechSynthesis.cancel(); return render(); }
    if (n === 'leave') {
      var msg = running() && player(S.me).alive ? 'Wenn du jetzt gehst, scheidest du aus dem Spiel aus.' : 'Raum verlassen?';
      return dialog('🚪 Verlassen', '<p>' + msg + '</p>' + (S.isHost ? '<p><small>Ein anderer Spieler wird Gastgeber. „Raum schließen“ beendet ihn für alle.</small></p>' : ''),
        [{ value: 'leave', label: 'Verlassen' }].concat(S.isHost ? [{ value: 'close', label: 'Raum schließen', danger: true }] : [], running() && S.isHost ? [{ value: 'abort', label: 'Spiel abbrechen' }] : [], [{ value: 'cancel', label: 'Abbrechen' }]))
        .then(function (v) {
          if (v === 'leave' || v === 'close') act({ action: v }).then(function () { showStart(); });
          if (v === 'abort') act({ action: 'abort' });
        });
    }
  });
  function rules() {
    dialog('📖 Regeln', '<div class="ww-rules"><p>Im Dorf haben sich Werwölfe versteckt. Jede Nacht holen sie jemanden, jeden Tag verurteilt das Dorf einen Verdächtigen. ' +
      'Das Dorf gewinnt, wenn alle Werwölfe tot sind. Die Werwölfe gewinnen, sobald sie so viele sind wie der Rest.</p><table class="list">' +
      ['werwolf', 'dorf'].concat(ORDER.slice(1)).map(function (k) { return '<tr><td>' + ROLES[k].icon + ' <b>' + esc(ROLES[k].name) + '</b></td><td>' + esc(ROLES[k].text) + '</td></tr>'; }).join('') +
      '</table><p><b>Nachts</b> tippen alle auf ihrem Handy etwas an, auch wer keine Fähigkeit hat. So erkennt am Tisch niemand, wer gerade handelt. <b>Am Tag</b> wird geredet und dann offen abgestimmt; bei Gleichstand stirbt niemand.</p></div>',
      [{ value: 'ok', label: 'OK' }]);
  }
  window.addEventListener('beforeunload', function () { if (es) es.close(); });

  if (root.dataset.code) enter(root.dataset.code);
  else showStart();
})();
