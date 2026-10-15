// Startmenü, Uhr, Fenster auf dem Desktop und Kleinkram für Formulare
(function () {
  var body = document.body;
  var framed = window.top !== window;

  // Systemsteuerung nie in einem Fenster, sondern als ganze Seite öffnen
  if (framed && body.classList.contains('admin')) {
    try { window.parent.RetroDesk.leaving(window); } catch (e) { /* kein Desktop */ }
    window.top.location.href = location.href; return;
  }

  var btn = document.getElementById('startbtn'), menu = document.getElementById('startmenu');
  function closeMenu() { if (menu) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', false); } }
  if (btn && menu) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', closeMenu);
  }
  var clock = document.getElementById('clock');
  function tick() { if (clock) clock.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
  tick(); setInterval(tick, 10000);

  // Bestätigung für Löschen-Buttons
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    el.addEventListener('submit', function (e) { if (!confirm(el.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // Sichtbarkeit: Gruppenauswahl nur zeigen, wenn "Nur bestimmte Gruppen" gewählt ist
  document.querySelectorAll('select[name=visibility]').forEach(function (sel) {
    var box = sel.form && sel.form.querySelector('.group-pick');
    function upd() { if (box) box.style.display = sel.value === 'groups' ? '' : 'none'; }
    sel.addEventListener('change', upd); upd();
  });

  // Bereich einer Adresse: erster Pfadteil, "" für die Startseite. Jeder Bereich hat höchstens ein Fenster;
  // eigene Seiten und das Hochladen bekommen jeweils ein eigenes.
  function section(path) { return path.split(/[?#]/)[0].split('/')[1] || ''; }
  function winKey(path) {
    var p = path.split(/[?#]/)[0].split('/');
    if (p[1] === 'p') return 'p/' + p[2];
    if (p[1] === 'files' && p[2] === 'upload') return 'upload';
    return p[1] || '';
  }
  // Nur echte Seiten öffnen Fenster, keine Downloads, Bilder oder Spieldateien
  function isPage(u) {
    return !/^\/(files\/dl|media|static|uploads|api)\//.test(u.pathname) && !/^\/apps\/[^/]+\/play\//.test(u.pathname) &&
      !/\.[a-z0-9]{1,5}$/i.test(u.pathname);
  }

  // ---------- Inhalt eines Fensters ----------
  if (body.classList.contains('embed') && framed) {
    var desk;
    try { desk = window.parent.RetroDesk; } catch (e) { desk = null; }
    if (!desk) return;
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.target || a.hasAttribute('download')) return;
      var u = new URL(a.href, location.href);
      if (u.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener'; return; }
      if (u.pathname.startsWith('/admin')) { e.preventDefault(); window.top.location.href = u.href; return; }
      // Links in einen anderen Bereich öffnen dessen Fenster, statt dieses umzuleiten
      if (isPage(u) && winKey(u.pathname) !== winKey(location.pathname)) {
        e.preventDefault();
        desk.open(u.pathname + u.search + u.hash, true);
      }
    });
    return;
  }

  if (!body.classList.contains('desktop')) return;

  // ---------- Desktop mit Fenstern ----------
  var deskEl = document.getElementById('desk'), tasks = document.getElementById('tasks');
  var siteTitle = body.dataset.title, me = body.dataset.user;
  var ICONS = { '': '🏠', blog: '📝', files: '📁', mods: '🧩', links: '🔗', apps: '🎮', haustier: '🐾', forum: '💬', guestbook: '📖',
    contact: '✉️', changelog: '📜', p: '📄', login: '🔑', register: '✏️', account: '🔑' };
  var mobile = window.matchMedia('(max-width: 760px)');
  var wins = [], zTop = 10, active = null, reloading = false;
  var template = deskEl.querySelector('.dwin').cloneNode(true);
  template.querySelector('iframe').removeAttribute('src');

  function cleanUrl(loc) {
    var q = new URLSearchParams(loc.search); q.delete('embed');
    var s = q.toString();
    return loc.pathname + (s ? '?' + s : '') + loc.hash;
  }

  function save() {
    if (reloading) return;
    var list = wins.filter(function (w) { return !w.drop; }).sort(function (a, b) { return a.z - b.z; }).map(function (w) {
      return { url: w.url, x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.el.offsetHeight,
        min: w.el.classList.contains('min'), max: w.el.classList.contains('max') };
    });
    try { sessionStorage.setItem('desk', JSON.stringify(list)); } catch (e) { /* privat */ }
  }

  function syncTop() {
    if (!active) { document.title = siteTitle; history.replaceState(null, '', '/'); return; }
    document.title = active.title + ' – ' + siteTitle;
    history.replaceState(null, '', active.url);
  }

  function focus(w) {
    if (w.el.classList.contains('min')) w.el.classList.remove('min');
    w.z = ++zTop; w.el.style.zIndex = w.z;
    active = w;
    wins.forEach(function (o) { o.el.classList.toggle('active', o === w); o.task.classList.toggle('pressed', o === w); });
    syncTop(); save();
  }

  function focusTopmost() {
    var vis = wins.filter(function (o) { return !o.el.classList.contains('min'); }).sort(function (a, b) { return b.z - a.z; });
    if (vis[0]) focus(vis[0]);
    else { active = null; wins.forEach(function (o) { o.el.classList.remove('active'); o.task.classList.remove('pressed'); }); syncTop(); }
  }

  function minimize(w) { w.el.classList.add('min'); if (active === w) focusTopmost(); save(); }
  function toggleMax(w) { w.el.classList.toggle('max'); focus(w); }
  function close(w) {
    w.el.remove(); w.task.remove();
    wins.splice(wins.indexOf(w), 1);
    if (active === w) focusTopmost();
    save();
  }

  function setTitle(w, title) {
    w.title = title || siteTitle;
    var icon = ICONS[section(w.url)] || '💾';
    w.el.querySelector('.ttl').textContent = w.title;
    w.el.querySelector('.icon').textContent = icon;
    w.el.querySelector('iframe').title = w.title;
    w.task.textContent = icon + ' ' + w.title;
    w.task.title = w.title;
  }

  function onLoad(w) {
    var doc;
    try { doc = w.iframe.contentDocument; } catch (e) { return; }
    if (!doc || !doc.body) return;
    // Alter Browser ohne Sec-Fetch-Dest: hat den ganzen Desktop geladen, also Inhalt gezielt anfordern
    if (doc.body.classList.contains('desktop')) {
      var u = new URL(w.iframe.contentWindow.location.href);
      u.searchParams.set('embed', '');
      w.iframe.contentWindow.location.replace(u.href);
      return;
    }
    // An- oder abgemeldet: Desktop neu laden, damit Startmenü und alle Fenster passen
    if (doc.body.classList.contains('embed') && doc.body.dataset.user !== me) {
      var next = cleanUrl(w.iframe.contentWindow.location);
      // Das Anmeldefenster hat seinen Zweck erfüllt; sein Ziel öffnet der neu geladene Desktop
      if (isAuthWin(w)) { close(w); reloading = true; location.href = next; return; }
      w.url = next;
      save(); reloading = true;
      location.href = (active || w).url;
      return;
    }
    w.url = cleanUrl(w.iframe.contentWindow.location);
    var t = doc.title, suffix = ' – ' + siteTitle;
    if (t.endsWith(suffix)) t = t.slice(0, -suffix.length);
    setTitle(w, t);
    doc.addEventListener('pointerdown', function () { closeMenu(); if (active !== w) focus(w); });
    if (active === w) syncTop();
    save();
  }

  function drag(e, w, resize) {
    if (e.button !== 0 || mobile.matches || (!resize && w.el.classList.contains('max'))) return;
    e.preventDefault();
    var sx = e.clientX, sy = e.clientY, x = w.el.offsetLeft, y = w.el.offsetTop, ww = w.el.offsetWidth, wh = w.el.offsetHeight;
    var handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    body.classList.add('dragging');
    function move(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (resize) {
        w.el.style.width = Math.max(260, ww + dx) + 'px';
        w.el.style.height = Math.max(160, wh + dy) + 'px';
      } else {
        w.el.style.left = Math.min(deskEl.clientWidth - 60, Math.max(60 - ww, x + dx)) + 'px';
        w.el.style.top = Math.min(deskEl.clientHeight - 24, Math.max(0, y + dy)) + 'px';
      }
    }
    function up() {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      body.classList.remove('dragging');
      save();
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // Fenstergröße beim ersten Öffnen; das Haustier-Spiel braucht etwas mehr Höhe
  var SIZES = { haustier: [820, 700] };
  function place(el, s, url) {
    var n = wins.length % 8, size = SIZES[section(url)] || [820, 580];
    var w = s && s.w || Math.min(size[0], deskEl.clientWidth - 40), h = s && s.h || Math.min(size[1], deskEl.clientHeight - 40);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.left = (s ? s.x : Math.max(0, Math.min(30 + n * 28, deskEl.clientWidth - w))) + 'px';
    el.style.top = (s ? s.y : Math.max(0, Math.min(28 + n * 28, deskEl.clientHeight - h))) + 'px';
    if (s && s.max) el.classList.add('max');
    if (s && s.min) el.classList.add('min');
  }

  function setup(el, url, s) {
    var w = { el: el, iframe: el.querySelector('iframe'), url: url, title: '', z: ++zTop };
    w.task = document.createElement('button');
    w.task.type = 'button'; w.task.className = 'task';
    tasks.appendChild(w.task);
    el.style.zIndex = w.z;
    place(el, s, url);
    wins.push(w);
    setTitle(w, el.querySelector('.ttl').textContent);
    w.iframe.addEventListener('load', function () { onLoad(w); });
    el.addEventListener('pointerdown', function () { if (active !== w) focus(w); });
    var bar = el.querySelector('.titlebar');
    bar.addEventListener('pointerdown', function (e) { if (!e.target.closest('button')) drag(e, w, false); });
    bar.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) toggleMax(w); });
    el.querySelector('.grip').addEventListener('pointerdown', function (e) { drag(e, w, true); });
    el.querySelector('[data-act=min]').addEventListener('click', function () { minimize(w); });
    el.querySelector('[data-act=max]').addEventListener('click', function () { toggleMax(w); });
    el.querySelector('[data-act=close]').addEventListener('click', function () { close(w); });
    w.task.addEventListener('click', function () {
      if (active === w && !el.classList.contains('min')) minimize(w); else focus(w);
    });
    return w;
  }

  function create(url, s) {
    var el = template.cloneNode(true);
    el.querySelector('.ttl').textContent = 'Lädt…';
    el.dataset.src = url;
    deskEl.appendChild(el);
    var w = setup(el, url, s);
    w.iframe.src = url;
    return w;
  }

  // Fenster öffnen; gibt es den Bereich schon, wird sein Fenster nach vorn geholt
  function open(url, navigate) {
    var k = winKey(url);
    var w = wins.filter(function (o) { return winKey(o.url) === k; })[0];
    if (!w) w = create(url);
    else if (navigate && w.url !== url) { w.iframe.src = url; w.url = url; }
    focus(w);
    return w;
  }
  function isAuthWin(w) { var k = winKey(w.url); return k === 'login' || k === 'register'; }
  window.RetroDesk = {
    open: open,
    // Ein Fenster wechselt in die Systemsteuerung (z. B. nach der Anmeldung als Admin)
    leaving: function (win) {
      wins.forEach(function (w) { if (w.iframe.contentWindow === win && isAuthWin(w)) w.drop = true; });
      save(); reloading = true;
    },
  };

  // Startmenü öffnet Fenster
  if (menu) menu.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || a.getAttribute('href').startsWith('/admin')) return;
    e.preventDefault(); closeMenu();
    open(a.getAttribute('href'), false);
  });

  // Erstes Fenster kommt vom Server, gespeicherte Fenster wiederherstellen
  var first = deskEl.querySelector('.dwin');
  var firstUrl = cleanUrl(new URL(first.dataset.src, location.href));
  var stored = [];
  try { stored = JSON.parse(sessionStorage.getItem('desk') || '[]'); } catch (e) { /* leer */ }
  var firstState = stored.filter(function (s) { return winKey(s.url) === winKey(firstUrl); })[0];
  var main = setup(first, firstUrl, firstState ? Object.assign({}, firstState, { min: false }) : null);
  stored.forEach(function (s) { if (s !== firstState) create(s.url, s); });
  focus(main);
  // Falls das erste Fenster schon fertig war, bevor dieses Skript lief
  try { if (main.iframe.contentDocument.readyState === 'complete' && main.iframe.contentWindow.location.href !== 'about:blank') onLoad(main); } catch (e) { /* egal */ }
  addEventListener('pagehide', save);
})();
