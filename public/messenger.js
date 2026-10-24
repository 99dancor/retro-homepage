// Messenger-Fenster (views/messenger.ejs): Kontaktliste und Gespräch. Live-Ereignisse kommen von der Verbindung des
// Desktops (public/messenger-hub.js, window.RetroMessenger im Elternfenster); ohne Desktop baut die Seite eine eigene auf.
// Im XP-Design heißt alles „ICU“, im 98-Design „DSN“; die Optik steckt in retro.css.
(function () {
  'use strict';
  var root = document.getElementById('msgr') || document.getElementById('chat');
  if (!root) { menuOnly(); return; }
  var CSRF = root.dataset.csrf, ME = root.dataset.me;
  if (!ME) return;

  var hub = null;
  try { hub = window.parent !== window && window.parent.RetroMessenger; } catch (e) { hub = null; }
  var desk = null;
  try { desk = window.parent !== window && window.parent.RetroDesk; } catch (e) { desk = null; }

  function xp() { return document.documentElement.classList.contains('theme-xp'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chatUrl(user) { return '/messenger/mit/' + encodeURIComponent(user); }
  function profileUrl(user) { return '/nutzer/' + encodeURIComponent(user); }
  function go(url) { if (desk) desk.open(url, true); else location.href = url; }
  function post(url, data) {
    var form = new URLSearchParams();
    Object.keys(data || {}).forEach(function (k) { if (data[k] != null) form.append(k, data[k]); });
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': CSRF, accept: 'application/json' }, body: form })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Das ging gerade nicht.'); return j; }); });
  }
  function stLabel(s) { return s === 'dnd' ? (xp() ? 'Nicht stören' : 'Beschäftigt') : ({ online: 'Online', away: 'Abwesend', invisible: 'Unsichtbar' })[s] || 'Offline'; }

  // Live-Ereignisse: vom Desktop oder (Seite direkt aufgerufen) über eine eigene Verbindung
  var handlers = [];
  function listen(fn) { handlers.push(fn); }
  function dispatch(type, d) { handlers.forEach(function (fn) { fn(type, d); }); }
  if (hub) {
    var off = hub.on(dispatch);
    addEventListener('pagehide', off);
  } else if (window.EventSource) {
    var es = new EventSource('/api/messenger/stream?c=' + Math.random().toString(36).slice(2, 12));
    ['hallo', 'ich', 'ungelesen', 'nachricht', 'gelesen', 'tippt', 'einstellungen'].forEach(function (t) {
      es.addEventListener(t, function (e) { var d = {}; try { d = JSON.parse(e.data); } catch (err) { /* leer */ } dispatch(t === 'hallo' ? 'ich' : t, d); });
    });
    es.addEventListener('kontakte', function () {
      fetch('/api/messenger/kontakte', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) dispatch('kontakte-daten', d); }).catch(function () {});
    });
    addEventListener('pagehide', function () { es.close(); });
  }
  function touched() { if (hub && hub.touched) hub.touched(); }
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, touched, { passive: true }); });
  function setStatus(status, msg) {
    if (hub) return hub.setStatus(status, msg);
    return post('/api/messenger/status', { status: status, msg: msg }).then(function (d) { dispatch('ich', d); return d; });
  }

  // Fenstertitel je nach Design; der Desktop übernimmt ihn (der Teil nach „ – “ ist der Seitenname)
  var title0 = document.title, suffix = '';
  var site = root.dataset.site || '';
  if (site && title0.endsWith(' – ' + site)) suffix = ' – ' + site;
  function setTitle(t) { if (document.title !== t + suffix) document.title = t + suffix; }

  // ---------- Kleine Menüs (Status, ICU-Menü, Einladen, Rechtsklick) ----------
  var pop = null;
  function closeMenu() { if (pop) { pop.remove(); pop = null; } }
  function menu(anchor, items, at) {
    closeMenu();
    pop = document.createElement('div');
    pop.className = 'msgr-menu window';
    pop.setAttribute('role', 'menu');
    items.forEach(function (it) {
      if (!it) { pop.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.innerHTML = it.html;
      if (it.checked) b.classList.add('checked');
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); it.run(); });
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    var r = at || anchor.getBoundingClientRect();
    var x = at ? at.x : r.left, y = at ? at.y : r.bottom;
    // Unten im Fenster (ICU-Leiste) klappt das Menü nach oben auf
    if (y + pop.offsetHeight > innerHeight - 4) y = Math.max(4, (at ? at.y : r.top) - pop.offsetHeight);
    pop.style.left = Math.max(4, Math.min(x, innerWidth - pop.offsetWidth - 4)) + 'px';
    pop.style.top = y + 'px';
    var first = pop.querySelector('button:not([disabled])');
    if (first) first.focus();
    pop.addEventListener('keydown', function (e) {
      var list = [].slice.call(pop.querySelectorAll('button:not([disabled])')), i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    });
  }
  document.addEventListener('click', function (e) { if (pop && !pop.contains(e.target)) closeMenu(); });
  function statusMenu(anchor, me) {
    menu(anchor, ['online', 'away', 'dnd', 'invisible'].map(function (s) {
      return { html: '<i class="st st-' + s + '"></i> ' + stLabel(s), checked: me && me.chosen === s, run: function () { setStatus(s).catch(alert); } };
    }).concat([null, { html: '💭 Statusnachricht …', run: function () { editStatusMsg(); } }]));
  }

  if (root.id === 'msgr') contactList(); else chatWindow();

  // ================= Kontaktliste =================
  var editStatusMsg = function () {};
  function contactList() {
    var raw = {};
    try { raw = JSON.parse(document.getElementById('msgr-daten').textContent); } catch (e) { /* leer */ }
    var data = raw.data, me = data.me, sel = null;
    var list = document.getElementById('msgrlist');
    var closed = {};
    try { closed = JSON.parse(localStorage.getItem('msgr-zu') || '{}'); } catch (e) { /* privat */ }

    function avatar(c, size) {
      if (c.avatar) return '<img class="avatar" src="' + esc(c.avatar) + '" alt="" width="' + size + '" height="' + size + '">';
      return '<span class="avatar avatar-letter" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.55) + 'px;background:hsl(' + ((c.id || 0) * 47 % 360) + ',45%,42%)">' + esc((Array.from(c.name || '?')[0] || '?').toUpperCase()) + '</span>';
    }
    function sub(c) {
      if (c.activity) return c.activity.icon + ' ' + esc(c.activity.what) + ' „' + esc(c.activity.name) + '“';
      if (c.msg) return '„' + esc(c.msg) + '“';
      if (c.status === 'offline' && c.lastSeen) return 'zuletzt ' + esc(c.lastSeen);
      return '';
    }
    function row(c, kind) {
      var s = sub(c);
      return '<div class="msgr-c' + (sel === c.user ? ' sel' : '') + (c.unread ? ' has-unread' : '') + '" role="option" tabindex="-1" aria-selected="' + (sel === c.user) + '" data-user="' + esc(c.user) + '" data-kind="' + kind + '">' +
        '<i class="st st-' + (kind === 'wait' ? 'wait' : c.status || 'offline') + '"></i>' +
        '<span class="only-98 av">' + avatar(c, 22) + '</span>' +
        '<span class="nm"><b>' + esc(c.name) + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</span>' +
        (c.unread ? '<span class="un" title="' + c.unread + ' ungelesen">✉️' + (c.unread > 1 ? c.unread : '') + '</span>' : '') + '</div>';
    }
    function group(key, label, items, kind) {
      if (!items.length && key !== 'online' && key !== 'offline') return '';
      var zu = !!closed[key];
      return '<div class="msgr-g' + (zu ? ' zu' : '') + '"><button type="button" class="msgr-gh" data-group="' + key + '" aria-expanded="' + !zu + '">' +
        '<span class="tw">' + (zu ? '▸' : '▾') + '</span> ' + label + ' (' + items.length + ')</button>' +
        (zu ? '' : items.map(function (c) { return row(c, kind); }).join('')) + '</div>';
    }
    function render() {
      var on = data.contacts.filter(function (c) { return c.status !== 'offline'; });
      var offl = data.contacts.filter(function (c) { return c.status === 'offline'; });
      var html = '';
      if (!data.contacts.length && !data.sent.length && !data.others.length) {
        html = '<p class="msgr-empty">Noch keine Kontakte.<br><a href="/messenger/finden">🔍 Mitglieder finden</a> und als Freund hinzufügen.</p>';
      }
      html += group('wait', 'Warten auf Antwort', data.sent.map(function (s) { return { user: s.user, name: s.name, status: 'offline' }; }), 'wait');
      if (data.contacts.length) html += group('online', 'Online', on, 'c') + group('offline', 'Offline', offl, 'c');
      html += group('others', 'Nicht in der Liste', data.others, 'c');
      var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#msgrlist') ? sel : null;
      list.innerHTML = html;
      if (focused) { var el = rowOf(focused); if (el) el.focus(); }
      var n = function (sel2, v) { root.querySelectorAll('[data-count=' + sel2 + '] .cnt').forEach(function (c) { c.textContent = v; c.hidden = !v; }); };
      n('unread', data.unread); n('requests', data.requests.length);
      var line = root.querySelector('[data-statusline]');
      if (line) line.textContent = on.length + ' von ' + data.contacts.length + ' online';
      var ul = root.querySelector('[data-unreadline]');
      if (ul) ul.textContent = '✉️ ' + data.unread;
      showMe();
    }
    function showMe() {
      root.querySelectorAll('[data-me-status]').forEach(function (el) { el.textContent = stLabel(me.status); });
      root.querySelectorAll('[data-me-icon]').forEach(function (el) { el.className = 'st st-' + me.status; });
      var nm = root.querySelector('[data-me-name]');
      if (nm) nm.textContent = me.name;
      var b = root.querySelector('.msgr-statusmsg');
      if (b && !b.querySelector('input')) b.textContent = me.msg ? '„' + me.msg + '“' : 'Statusnachricht eingeben …';
      setTitle(xp() ? 'ICU – ' + me.name : 'DSN Messenger');
    }
    function rowOf(user) { return [].filter.call(list.querySelectorAll('.msgr-c'), function (r) { return r.dataset.user === user; })[0]; }
    function select(user) {
      sel = user;
      list.querySelectorAll('.msgr-c').forEach(function (r) { var on = r.dataset.user === user; r.classList.toggle('sel', on); r.setAttribute('aria-selected', on); });
      var r = rowOf(user);
      if (r) { r.focus(); r.scrollIntoView({ block: 'nearest' }); }
    }
    function openRow(r) {
      if (!r) return;
      go(r.dataset.kind === 'wait' ? '/messenger/anfrage/' + encodeURIComponent(r.dataset.user) : chatUrl(r.dataset.user));
    }
    function find(user) {
      return data.contacts.concat(data.others).filter(function (c) { return c.user === user; })[0];
    }

    list.addEventListener('click', function (e) {
      var g = e.target.closest('.msgr-gh');
      if (g) {
        closed[g.dataset.group] = !closed[g.dataset.group];
        try { localStorage.setItem('msgr-zu', JSON.stringify(closed)); } catch (err) { /* privat */ }
        render(); return;
      }
      var r = e.target.closest('.msgr-c');
      if (r) select(r.dataset.user);
    });
    list.addEventListener('dblclick', function (e) { openRow(e.target.closest('.msgr-c')); });
    list.addEventListener('contextmenu', function (e) {
      var r = e.target.closest('.msgr-c');
      if (!r) return;
      e.preventDefault();
      select(r.dataset.user);
      var c = find(r.dataset.user);
      if (r.dataset.kind === 'wait') {
        menu(r, [{ html: '⏳ Anfrage ansehen', run: function () { openRow(r); } }, { html: '👤 Profil ansehen', run: function () { go(profileUrl(r.dataset.user)); } }], { x: e.clientX, y: e.clientY });
        return;
      }
      menu(r, [
        { html: '<b>💬 Nachricht senden</b>', run: function () { openRow(r); } },
        { html: '👤 Profil ansehen', run: function () { go(profileUrl(r.dataset.user)); } },
        c && c.activity ? { html: c.activity.icon + ' Mitspielen: ' + esc(c.activity.name), run: function () { go(c.activity.url); } } : null,
      ].filter(function (x) { return x !== null; }), { x: e.clientX, y: e.clientY });
    });
    list.addEventListener('keydown', function (e) {
      var rows = [].slice.call(list.querySelectorAll('.msgr-c')), i = rows.indexOf(rowOf(sel));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        select(rows[i].dataset.user);
      } else if (e.key === 'Enter' && sel) { e.preventDefault(); openRow(rowOf(sel)); }
    });

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-menu], [data-act]');
      if (!b) return;
      var what = b.dataset.menu || b.dataset.act;
      if (what === 'status') { e.stopPropagation(); statusMenu(b, me); }
      else if (what === 'main') {
        e.stopPropagation();
        menu(b, [
          { html: '🔍 Mitglieder finden / hinzufügen', run: function () { go('/messenger/finden'); } },
          { html: '📜 Nachrichtenverlauf', run: function () { go('/messenger/verlauf'); } },
          { html: '👥 Anfragen (' + data.requests.length + ')', disabled: !data.requests.length, run: function () { requests(b); } },
          null,
          { html: '👤 Mein Profil', run: function () { go(profileUrl(ME)); } },
          { html: '✏️ Profil bearbeiten', run: function () { go('/konto?reiter=profil'); } },
          { html: '🔔 Töne und Hinweise', run: function () { go('/konto?reiter=benachrichtigungen#benachrichtigungen'); } },
          { html: '🔒 Privatsphäre', run: function () { go('/konto?reiter=privatsphaere#privatsphaere'); } },
        ]);
      } else if (what === 'requests') { e.stopPropagation(); requests(b); }
      else if (what === 'statusmsg') editStatusMsg();
      else if (what === 'write') { if (sel) openRow(rowOf(sel)); else go('/messenger/finden'); }
    });
    function requests(anchor) {
      if (!data.requests.length) { menu(anchor, [{ html: 'Keine offenen Anfragen', disabled: true, run: function () {} }]); return; }
      menu(anchor, data.requests.map(function (r) {
        return { html: '❔ <b>' + esc(r.name) + '</b>' + (r.note ? ' <small>„' + esc(r.note.length > 40 ? r.note.slice(0, 40) + '…' : r.note) + '“</small>' : ''), run: function () { go('/messenger/anfrage/' + encodeURIComponent(r.user)); } };
      }));
    }

    // Statusnachricht direkt in der Liste bearbeiten: Enter speichert, Esc bricht ab
    editStatusMsg = function () {
      var b = root.querySelector('.msgr-statusmsg');
      if (!b || b.querySelector('input')) return;
      b.innerHTML = '';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 80; inp.value = me.msg || ''; inp.placeholder = 'Was machst du gerade?';
      inp.setAttribute('aria-label', 'Statusnachricht');
      b.appendChild(inp);
      inp.focus(); inp.select();
      var done = false;
      function finish(save) {
        if (done) return;
        done = true;
        var v = inp.value.trim();
        b.textContent = '…';
        if (save && v !== (me.msg || '')) setStatus(undefined, v).catch(function (err) { alert(err.message); showMe(); });
        else { b.textContent = ''; showMe(); }
      }
      inp.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') finish(false);
      });
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('blur', function () { finish(true); });
    };

    listen(function (type, d) {
      if (type === 'kontakte-daten') { data = d; me = Object.assign({}, me, d.me); render(); }
      else if (type === 'ich') { me = Object.assign({}, me, d); showMe(); }
      else if (type === 'ungelesen') { data.unread = d.n || 0; render(); }
      else if (type === 'nachricht' && d.from !== ME) {
        // Neue Nachricht: Zähler am Kontakt sofort hochsetzen, die genaue Liste kommt gleich vom Desktop
        var c = find(d.partner);
        if (c) { c.unread = (c.unread || 0) + (d.kind === 'nudge' ? 0 : 1); render(); }
        else if (hub) hub.reload();
      } else if (type === 'gelesen') { /* nur für Gespräche */ }
    });
    // Nach dem Design-Wechsel stimmen Titel und Wörter wieder
    new MutationObserver(function () { render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (hub && hub.state().contacts) { data = hub.state().contacts; me = Object.assign({}, me, data.me); }
    render();
  }

  // ================= Gespräch =================
  function chatWindow() {
    var partner = root.dataset.partner, name = root.dataset.name, myName = root.dataset.myname;
    var hist = document.getElementById('hist'), form = document.getElementById('sendform');
    var box = form && form.querySelector('textarea');
    var typingEl = root.querySelector('[data-typing]'), readEl = root.querySelector('[data-readstate]');
    var cardEl = root.querySelector('[data-card]');
    var lastDay = '', pendingRead = false, typingTimer = null, sentTyping = 0;
    var days = hist.querySelectorAll('.sys.day');
    if (days.length) lastDay = days[days.length - 1].textContent;

    function title() { setTitle(xp() ? name + ' – ICU-Gespräch' : name + ' – Unterhaltung'); }
    title();
    new MutationObserver(title).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    function bottom() { hist.scrollTop = hist.scrollHeight; }
    bottom();
    // Bilder (Avatare) laden später: dann noch einmal ans Ende
    addEventListener('load', bottom);

    function day(t) { return '— ' + new Date(t * 1000).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }) + ' —'; }
    function hm(t) { return new Date(t * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }); }
    function add(x) {
      if (document.getElementById('n' + x.id)) return;
      var empty = hist.querySelector('[data-empty]');
      if (empty) empty.remove();
      var near = hist.scrollHeight - hist.scrollTop - hist.clientHeight < 60;
      var d = day(x.at);
      if (d !== lastDay) { lastDay = d; var s = document.createElement('div'); s.className = 'sys day'; s.textContent = d; hist.appendChild(s); }
      var mine = x.from === ME, el = document.createElement('div');
      el.id = 'n' + x.id;
      if (x.kind === 'nudge') {
        el.className = 'sys nudge';
        el.textContent = '📳 ' + (mine ? 'Du hast ' + name + ' angestupst.' : name + ' hat dich angestupst!');
      } else if (x.kind === 'invite' && x.meta) {
        el.className = 'sys invite';
        el.innerHTML = esc(x.meta.icon) + ' ' + esc(mine ? 'Du hast ' + name : name + ' hat dich') + ' eingeladen: ' + esc(x.meta.what) + ' „' + esc(x.meta.name) + '“' +
          (mine ? '' : ' · <a href="' + esc(x.meta.url) + '">Beitreten</a>');
      } else {
        el.className = 'm ' + (mine ? 'me' : 'them');
        el.dataset.id = x.id;
        el.innerHTML = '<div class="h"><b>' + esc(mine ? myName : name) + '</b><span class="only-98"> sagt</span> <small>' + hm(x.at) + '</small></div><p></p>';
        el.querySelector('p').textContent = x.body;
      }
      hist.appendChild(el);
      if (near || mine) bottom();
      if (mine && x.kind === 'text' && readEl) readEl.textContent = '✔ gesendet';
    }
    // Ist dieses Gespräch gerade vorn? Dann gilt Neues als gelesen.
    function visible() {
      if (document.hidden) return false;
      if (!desk) return document.hasFocus();
      var u = desk.activeUrl && desk.activeUrl();
      return !!u && u.split(/[?#]/)[0] === location.pathname;
    }
    function markRead() {
      if (!pendingRead || !visible()) return;
      pendingRead = false;
      post(chatUrl(partner) + '/gelesen', {}).catch(function () {});
    }
    ['focus', 'pointerdown', 'keydown'].forEach(function (t) { addEventListener(t, function () { setTimeout(markRead, 50); }); });
    document.addEventListener('visibilitychange', markRead);

    function showCard(c) {
      if (!cardEl || !c) return;
      var bits = ['<i class="st st-' + esc(c.status) + '" aria-hidden="true"></i> ' + esc(stLabel(c.status))];
      if (c.activity) bits.push(esc(c.activity.icon + ' ' + c.activity.what + ' „' + c.activity.name + '“'));
      if (c.msg) bits.push('„' + esc(c.msg) + '“');
      if (c.lastSeen) bits.push('zuletzt ' + esc(c.lastSeen));
      bits.push((xp() ? 'ICU ' : 'DSN ') + esc(String(c.number).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')));
      cardEl.innerHTML = bits.join(' · ');
      if (typingEl && !typingEl.dataset.on) typingEl.textContent = c.status === 'offline' ? name + ' ist offline. Die Nachricht kommt an, sobald ' + name + ' wieder da ist.' : ' ';
    }

    listen(function (type, d) {
      if (type === 'nachricht' && d.partner === partner) {
        add(d);
        if (d.from !== ME) {
          stopTyping();
          pendingRead = true; markRead();
        }
      } else if (type === 'tippt' && d.partner === partner) {
        typingEl.dataset.on = '1';
        typingEl.textContent = '✍️ ' + name + (xp() ? ' tippt gerade …' : ' schreibt eine Nachricht …');
        clearTimeout(typingTimer);
        typingTimer = setTimeout(stopTyping, 6000);
      } else if (type === 'gelesen' && d.partner === partner) {
        if (readEl && readEl.textContent) readEl.textContent = '✔✔ gelesen';
      } else if (type === 'kontakte-daten') {
        showCard(d.contacts.concat(d.others).filter(function (c) { return c.user === partner; })[0]);
      }
    });
    function stopTyping() {
      clearTimeout(typingTimer);
      if (!typingEl || !typingEl.dataset.on) return;
      delete typingEl.dataset.on;
      typingEl.textContent = ' ';
    }

    if (form && box) {
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      });
      box.addEventListener('input', function () {
        if (!box.value.trim() || Date.now() - sentTyping < 4000) return;
        sentTyping = Date.now();
        post(chatUrl(partner) + '/tippt', {}).catch(function () {});
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = box.value.trim();
        if (!text) return;
        var btn = form.querySelector('button');
        btn.disabled = true;
        post(form.action, { body: text }).then(function (j) {
          box.value = '';
          sentTyping = 0;
          add(j.message);
        }).catch(function (err) { alert(err.message); }).then(function () { btn.disabled = false; box.focus(); });
      });
      setTimeout(function () { box.focus(); }, 0);
    }

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'nudge') {
        b.disabled = true;
        post(chatUrl(partner) + '/anstupsen', {}).then(function (j) { add(j.message); }).catch(function (err) { alert(err.message); })
          .then(function () { setTimeout(function () { b.disabled = false; }, 3000); });
      } else if (b.dataset.act === 'invite') {
        e.stopPropagation();
        fetch('/api/messenger/einladen', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
          if (!j.lobbies || !j.lobbies.length) {
            menu(b, [{ html: 'Du sitzt gerade an keinem Tisch und in keiner Lobby.', disabled: true, run: function () {} }, { html: '🎲 Offene Lobbys ansehen', run: function () { go('/kartenspiele'); } }]);
            return;
          }
          menu(b, j.lobbies.map(function (l) {
            return { html: esc(l.icon) + ' ' + esc(l.what) + ' „' + esc(l.name) + '“', run: function () {
              post(chatUrl(partner) + '/einladen', { url: l.url }).then(function (r) { add(r.message); }).catch(function (err) { alert(err.message); });
            } };
          }));
        }).catch(function () {});
      }
    });
    // Vom Profil aus „🎲 Einladen“: Menü gleich öffnen
    var inv = root.querySelector('[data-act=invite]');
    if (inv && /[?&]einladen/.test(location.search)) setTimeout(function () { inv.click(); }, 100);
  }

  // Seiten ohne Liste oder Gespräch (Verlauf, Finden, Anfrage): nichts weiter zu tun
  function menuOnly() {}
})();
