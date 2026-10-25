// Startmenü, Uhr, Fenster auf dem Desktop und Kleinkram für Formulare
(function () {
  var body = document.body;
  var framed = window.top !== window;

  var btn = document.getElementById('startbtn'), menu = document.getElementById('startmenu');
  // Klangeffekte aus sound.js (🔊 neben der Uhr); fehlt das Skript, bleibt es still
  function sound(name) { if (window.RetroSound) window.RetroSound.play(name); }
  function closeMenu() { if (menu) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', false); menu.querySelectorAll('.sub.open').forEach(function (s) { s.classList.remove('open'); }); } }
  // Zeitpunkt des letzten Auf- oder Zuklappens: Auf dem Handy verschiebt das Menü sich dabei unter dem Finger,
  // ein Klick direkt danach (z. B. ein doppelt erkanntes Antippen) darf dann keinen Eintrag öffnen
  var toggled = 0, touch = false;
  if (menu) menu.addEventListener('pointerdown', function (e) { touch = e.pointerType !== 'mouse'; }, true);
  if (btn && menu) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
      if (open) sound('menue');
    });
    document.addEventListener('click', closeMenu);
    // Untermenüs per Klick/Antippen auf- und zuklappen, immer nur eins pro Ebene offen (Kartenspiele steckt in Spiele und Apps)
    menu.querySelectorAll('.sub-toggle').forEach(function (t) {
      t.addEventListener('click', function (e) {
        e.stopPropagation();
        var sub = t.parentNode, open = !sub.classList.contains('open');
        menu.querySelectorAll('.sub.open').forEach(function (s) { if (s.contains(sub)) return; s.classList.remove('open'); s.firstElementChild.setAttribute('aria-expanded', false); });
        sub.classList.toggle('open', open); t.setAttribute('aria-expanded', open);
        if (touch) toggled = Date.now();
      });
    });
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

  // Forum: „Zitieren“ hängt den Beitrag als Zitat an die Antwort an
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-quote]');
    var ta = b && document.querySelector('#reply-form textarea[name=body_md]');
    if (!ta) return;
    var quote = '> **' + b.dataset.quoteWho.replace(/[*_\[\]]/g, '') + '** schrieb:\n' +
      b.dataset.quote.trim().split('\n').map(function (l) { return '> ' + l; }).join('\n') + '\n\n';
    ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '\n\n') : '') + quote;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('antworten').scrollIntoView({ block: 'nearest' });
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  });

  // Bereich einer Adresse: erster Pfadteil, "" für die Startseite. Jeder Bereich hat höchstens ein Fenster;
  // eigene Seiten und das Hochladen bekommen jeweils ein eigenes.
  function section(path) { return path.split(/[?#]/)[0].split('/')[1] || ''; }
  function winKey(path) {
    var p = path.split(/[?#]/)[0].split('/');
    if (p[1] === 'p') return 'p/' + p[2];
    if (p[1] === 'files' && p[2] === 'upload') return 'upload';
    // Jedes Textdokument, jede angesehene Datei und jeder freigegebene Ordner bekommt ein eigenes Fenster
    if (p[1] === 'notizblock' && p[2]) return 'notizblock/' + p[2];
    if (p[1] === 'ansehen') return 'ansehen/' + p[2] + '/' + p[3];
    if (p[1] === 'ordner') return 'ordner/' + p[2];
    // Messenger: Kontaktliste, jedes Gespräch und die Suche in eigenen Fenstern
    if (p[1] === 'messenger' && p[2]) return 'messenger/' + p[2] + (p[3] ? '/' + p[3] : '');
    return p[1] || '';
  }
  // Nur echte Seiten öffnen Fenster, keine Downloads, Bilder oder Spieldateien (Benutzernamen dürfen Punkte enthalten)
  function isPage(u) {
    return !/^\/(files\/dl|media|static|uploads|api)\//.test(u.pathname) && !/^\/apps\/[^/]+\/play\//.test(u.pathname) &&
      (!/\.[a-z0-9]{1,5}$/i.test(u.pathname) || /^\/(nutzer|nachrichten|messenger)\//.test(u.pathname));
  }

  // ---------- Inhalt eines Fensters ----------
  if (body.classList.contains('embed') && framed) {
    var desk;
    try { desk = window.parent.RetroDesk; } catch (e) { desk = null; }
    if (!desk) return;
    // Die 🔔 fragt neu nach: Diese Seite hat vielleicht gerade etwas als gelesen markiert
    if (body.dataset.user) window.parent.postMessage('notify:refresh', location.origin);
    // Fehlermeldungen klingen wie bei Windows
    if (document.querySelector('.msg.err, .error-page')) sound('fehler');
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.hasAttribute('download')) return;
      var u = new URL(a.href, location.href);
      // „Ansehen“ in der Seitenverwaltung (target=_blank) öffnet ein Fenster auf dem Desktop statt eines neuen Tabs
      if (a.target && !(a.target === '_blank' && u.origin === location.origin && isPage(u))) return;
      if (u.origin !== location.origin) { a.target = '_blank'; a.rel = 'noopener'; return; }
      // Links in einen anderen Bereich öffnen dessen Fenster, statt dieses umzuleiten
      if (isPage(u) && winKey(u.pathname) !== winKey(location.pathname)) {
        e.preventDefault();
        desk.open(u.pathname + u.search + u.hash, true);
      }
    });
    // Strg+K springt auch aus einem Fenster heraus in die Suche der Taskleiste
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k' && desk.focusSearch && desk.focusSearch()) e.preventDefault();
    });
    return;
  }

  if (!body.classList.contains('desktop')) return;

  // ---------- Desktop mit Fenstern ----------
  var deskEl = document.getElementById('desk'), tasks = document.getElementById('tasks');
  var siteTitle = body.dataset.title, me = body.dataset.user;
  var ICONS = { '': '🏠', blog: '📝', files: '📁', mods: '🧩', links: '🔗', apps: '🎮', haustier: '🐾', forum: '💬', guestbook: '📖',
    contact: '✉️', changelog: '📋', datenschutz: '🔒', p: '📄', login: '🔑', register: '✏️', account: '🔑', konto: '🔑', messenger: '🌼', musik: '🎵', zufall: '🎲', kartenspiele: '🂡', blackjack: '🃏', poker: '♠️', durak: '🎴', uno: '🟥', flip7: '7️⃣', pilli: '🌶️', quiz: '❓', werwolf: '🐺', minesweeper: '💣', kreuzwortraetsel: '📰', sudoku: '🔢',
    nutzer: '👤', paint: '🎨', galerie: '🖼️', admin: '⚙️', 'eigene-dateien': '🗂️', einstellungen: '🛠️', notizblock: '🗒️', suche: '🔍',
    ordner: '📁', ansehen: '🖼️', benachrichtigungen: '🔔' };
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
    var list = wins.slice().sort(function (a, b) { return a.z - b.z; }).map(function (w) {
      // Ein Mini-Player kommt nach dem Neuladen wieder in voller Größe
      var b = w.before;
      return { url: w.url, x: w.el.offsetLeft, y: w.el.offsetTop, w: b ? b.w : w.el.offsetWidth, h: b ? b.h : w.el.offsetHeight,
        min: w.el.classList.contains('min'), max: b ? b.max : w.el.classList.contains('max') };
    });
    try { sessionStorage.setItem('desk', JSON.stringify(list)); } catch (e) { /* privat */ }
  }

  function syncTop() {
    if (!active) { document.title = siteTitle; history.replaceState(null, '', '/'); return; }
    document.title = active.title + ' – ' + siteTitle;
    history.replaceState(null, '', active.url);
  }

  function focus(w) {
    if (w.el.classList.contains('min')) { w.el.classList.remove('min'); keepVisible(w); }
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

  function minimize(w) { w.el.classList.add('min'); sound('minimieren'); if (active === w) focusTopmost(); save(); }
  function toggleMax(w) {
    if (w.before) { w.el.classList.remove('mini'); w.before = null; } // der Mediaplayer merkt das und wird wieder groß
    w.el.classList.toggle('max'); sound('maximieren'); focus(w);
  }
  // Vor dem Schließen dürfen andere noch kurz etwas erledigen (Pixelpfoten: die Tiere laufen heim), höchstens 4 Sekunden
  var closeGuards = [];
  function close(w) {
    if (w.closing) return;
    var waits = [];
    closeGuards.forEach(function (fn) {
      try { var p = fn(w.iframe.contentWindow, w.el); if (p && p.then) waits.push(p); } catch (e) { /* egal */ }
    });
    if (waits.length) {
      w.closing = true;
      w.el.classList.add('closing');
      Promise.race([Promise.all(waits), new Promise(function (r) { setTimeout(r, 4000); })]).then(function () { w.closing = false; closeNow(w); });
      return;
    }
    closeNow(w);
  }
  function closeNow(w) {
    if (wins.indexOf(w) < 0) return;
    sound('schliessen');
    w.el.remove(); w.task.remove();
    wins.splice(wins.indexOf(w), 1);
    if (active === w) focusTopmost();
    save();
  }

  function setTitle(w, title) {
    w.title = title || siteTitle;
    var icon = ICONS[section(w.url)] || '💾';
    w.el.querySelector('.ttl').textContent = w.title;
    w.el.querySelector('iframe').title = w.title;
    // Messenger (Blume bei ICU, Männchen bei DSN) und Kartenspiele haben Bilder als Symbol, siehe .sym-… in retro.css
    var pic = { messenger: 'msgr', kartenspiele: 'karten' }[section(w.url)];
    if (pic) {
      w.el.querySelector('.icon').innerHTML = '<i class="sym sym-' + pic + '" aria-hidden="true"></i>';
      w.task.innerHTML = '<i class="sym sym-' + pic + '" aria-hidden="true"></i> ';
      w.task.appendChild(document.createTextNode(w.title));
    } else {
      w.el.querySelector('.icon').textContent = icon;
      w.task.textContent = icon + ' ' + w.title;
    }
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
    // Lädt ein Mini-Player neu, kommt das Fenster wieder in voller Größe
    if (w.before) window.RetroDesk.mini(w.iframe.contentWindow, false);
    var t = doc.title, suffix = ' – ' + siteTitle;
    if (t.endsWith(suffix)) t = t.slice(0, -suffix.length);
    setTitle(w, t);
    // Seiten wie Paint ändern ihren Titel (z. B. nach dem Speichern): Fenster und Taskleiste ziehen mit
    var tEl = doc.querySelector('title');
    if (tEl && window.MutationObserver) {
      new MutationObserver(function () {
        var nt = doc.title;
        if (nt.endsWith(suffix)) nt = nt.slice(0, -suffix.length);
        setTitle(w, nt);
        if (active === w) syncTop();
      }).observe(tEl, { childList: true, characterData: true, subtree: true });
    }
    doc.addEventListener('pointerdown', function () { closeMenu(); if (active !== w) focus(w); });
    watchStatus(w, doc);
    if (active === w) syncTop();
    save();
  }

  // Statusleiste unten am Fenster: Hat die Seite selbst eine (Mediaplayer, Kartenspiele, Paint …), wandert deren
  // Inhalt in den Fensterrand und sie selbst verschwindet. Dazu kommt, was die Seite in body[data-status] schreibt.
  var statusDefault = template.querySelector('.statusbar').innerHTML;
  function statusSource(doc) {
    var all = doc.querySelectorAll('.statusbar');
    for (var i = all.length - 1; i >= 0; i--) {
      var s = all[i], p = s.parentElement;
      if (!s.closest('dialog, .window') && p && p.getClientRects().length) return s;
    }
    return null;
  }
  function watchStatus(w, doc) {
    var bar = w.el.querySelector('.statusbar'), src = null, queued = false, last = '';
    if (!bar) return;
    doc.documentElement.classList.add('in-desk');
    function sync() {
      queued = false;
      var s = statusSource(doc);
      if (s !== src) { if (src) src.classList.remove('to-window'); src = s; if (src) src.classList.add('to-window'); }
      var html = '';
      if (src) {
        var copy = src.cloneNode(true);
        copy.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
        html = copy.innerHTML;
      }
      var extra = doc.body.dataset.status;
      if (extra) html += '<span class="extra"></span>';
      html += '<span class="net">🌐 Internet</span>';
      if (!src && !extra) html = statusDefault;
      if (html + '|' + extra === last) return;
      last = html + '|' + extra;
      bar.innerHTML = html;
      var ex = bar.querySelector('.extra');
      if (ex) ex.textContent = extra;
    }
    // Beim Schließen oder Verlassen der Seite kann der Beobachter noch einmal feuern, wenn das Fenster schon weg ist
    function queue() { var cw = w.iframe.contentWindow; if (!queued && cw) { queued = true; (cw.requestAnimationFrame || setTimeout)(sync); } }
    if (window.MutationObserver) new MutationObserver(queue).observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'data-status'] });
    sync();
  }

  // Fenster ganz ins Bild holen, z. B. wenn das Browserfenster auf einen kleineren Bildschirm wandert. Größer als der
  // Desktop wird keins; minimierte Fenster kommen dran, sobald sie wieder auftauchen.
  function keepVisible(w) {
    var el = w.el;
    if (mobile.matches || el.classList.contains('max') || el.classList.contains('min')) return;
    var dw = deskEl.clientWidth, dh = deskEl.clientHeight;
    if (!dw || !dh) return;
    if (el.offsetWidth > dw) el.style.width = dw + 'px';
    if (el.offsetHeight > dh) el.style.height = dh + 'px';
    el.style.left = Math.max(0, Math.min(el.offsetLeft, dw - el.offsetWidth)) + 'px';
    el.style.top = Math.max(0, Math.min(el.offsetTop, dh - el.offsetHeight)) + 'px';
  }

  // Kleine Fenster ohne Eintrag in der Taskleiste (Eigenschaften von Anzeige, Offene Lobbys) an der Titelleiste verschieben.
  // Sie bleiben ganz im Bild; mit key merkt sich der Browser den Platz. Auf dem Handy stehen sie fest.
  var panels = [];
  function panelZoom(el) { return parseFloat(getComputedStyle(el).zoom) || 1; }
  function panelArea() {
    var tb = document.querySelector('.taskbar');
    return { w: document.documentElement.clientWidth, h: tb ? tb.getBoundingClientRect().top : innerHeight };
  }
  function setPanel(el, x, y) {
    var z = panelZoom(el), a = panelArea(), w = el.offsetWidth * z, h = el.offsetHeight * z;
    if (!w) return;
    x = Math.max(0, Math.min(x, a.w - w)); y = Math.max(0, Math.min(y, a.h - h));
    el.classList.add('moved');
    el.style.left = x / z + 'px'; el.style.top = y / z + 'px';
    el.style.right = el.style.bottom = 'auto'; el.style.transform = 'none';
  }
  function placePanel(el) {
    var p = panels.filter(function (o) { return o.el === el; })[0];
    if (!p || el.hidden) return;
    if (mobile.matches) { el.classList.remove('moved'); el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = ''; return; }
    var pos = null;
    if (p.key) try { pos = JSON.parse(localStorage.getItem(p.key) || 'null'); } catch (e) { /* privat */ }
    if (pos && isFinite(pos.x) && isFinite(pos.y)) setPanel(el, pos.x, pos.y);
    else if (el.classList.contains('moved')) { var r = el.getBoundingClientRect(); setPanel(el, r.left, r.top); }
  }
  function dragPanel(el, handle, key) {
    panels.push({ el: el, key: key });
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || mobile.matches || e.target.closest('button, a, input, select')) return;
      e.preventDefault();
      var r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      body.classList.add('dragging');
      function move(ev) { setPanel(el, ev.clientX - dx, ev.clientY - dy); }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        body.classList.remove('dragging');
        var now = el.getBoundingClientRect();
        if (key) try { localStorage.setItem(key, JSON.stringify({ x: Math.round(now.left), y: Math.round(now.top) })); } catch (err) { /* privat */ }
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    placePanel(el);
  }
  var fitTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      wins.forEach(keepVisible);
      panels.forEach(function (p) { placePanel(p.el); });
      save();
    }, 100);
  });

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
        var small = w.el.classList.contains('fitted');
        w.el.style.width = Math.max(small ? 120 : 260, ww + dx) + 'px';
        w.el.style.height = Math.max(small ? 120 : 160, wh + dy) + 'px';
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
      // Fenster, die mit ihrem Inhalt mitwachsen (Minesweeper), rasten nach dem Loslassen wieder ein
      if (resize && w.el.classList.contains('scalable')) try { w.iframe.contentWindow.postMessage('desk:resized', location.origin); } catch (err) { /* egal */ }
      save();
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // Fenstergröße beim ersten Öffnen; Haustier-Spiel und Mediaplayer brauchen etwas mehr Platz
  var SIZES = { haustier: [1000, 720], musik: [1080, 700], zufall: [760, 620], kartenspiele: [1080, 760], blackjack: [1000, 680], poker: [1060, 720], durak: [1060, 740], uno: [1060, 740], flip7: [1060, 740], pilli: [1060, 740], quiz: [1040, 700], werwolf: [1000, 720], minesweeper: [180, 300], kreuzwortraetsel: [960, 680], sudoku: [720, 640], konto: [700, 620], paint: [1000, 700], galerie: [900, 640], admin: [1100, 740], 'eigene-dateien': [900, 620],
    einstellungen: [860, 640], notizblock: [660, 500], suche: [760, 580], ansehen: [800, 600], ordner: [820, 580] };
  // Vergrößerte Fensterinhalte (🖥️ → Größe der Oberfläche mit „Fensterinhalte mitskalieren“) brauchen größere Fenster
  function contentZoom() {
    var root = document.documentElement;
    return root.classList.contains('zoomed') && root.classList.contains('zoom-all') ? parseFloat(getComputedStyle(root).getPropertyValue('--zoom')) || 1 : 1;
  }
  // Messenger: schmale Kontaktliste, Gespräche wie ein Chatfenster
  var MSGR = { messenger: [270, 600], 'messenger/mit': [540, 480], 'messenger/finden': [760, 580], 'messenger/anfrage': [540, 340] };
  function sizeFor(url) {
    var k = winKey(url).split('/').slice(0, 2).join('/');
    return MSGR[k] || SIZES[section(url)] || [820, 580];
  }
  function place(el, s, url) {
    var n = wins.length % 8, size = sizeFor(url), z = contentZoom();
    var w = s && s.w || Math.min(Math.round(size[0] * z), deskEl.clientWidth - 40), h = s && s.h || Math.min(Math.round(size[1] * z), deskEl.clientHeight - 40);
    el.style.width = w + 'px'; el.style.height = h + 'px';
    // Die Kontaktliste steht wie bei ICQ am rechten Rand
    var right = !s && winKey(url) === 'messenger';
    el.style.left = (s ? s.x : right ? Math.max(0, deskEl.clientWidth - w - 16) : Math.max(0, Math.min(30 + n * 28, deskEl.clientWidth - w))) + 'px';
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
    if (!w) { w = create(url); sound('oeffnen'); }
    else if (navigate && w.url !== url) { w.iframe.src = url; w.url = url; }
    focus(w);
    return w;
  }
  function byWin(win) { return wins.filter(function (o) { return o.iframe.contentWindow === win; })[0]; }
  // Inhalt eines Fensters auf width × height bringen; Rahmen und Titelleiste kommen dazu
  function sizeTo(w, width, height) {
    var nw = Math.min(width + w.el.offsetWidth - w.iframe.clientWidth, deskEl.clientWidth);
    var nh = Math.min(height + w.el.offsetHeight - w.iframe.clientHeight, deskEl.clientHeight);
    w.el.style.width = nw + 'px'; w.el.style.height = nh + 'px';
    w.el.style.left = Math.max(0, Math.min(w.el.offsetLeft, deskEl.clientWidth - nw)) + 'px';
    w.el.style.top = Math.max(0, Math.min(w.el.offsetTop, deskEl.clientHeight - nh)) + 'px';
  }
  function isAuthWin(w) { var k = winKey(w.url); return k === 'login' || k === 'register'; }
  window.RetroDesk = {
    open: open,
    dragPanel: dragPanel,
    placePanel: placePanel,
    // Adresse des vordersten Fensters (der Messenger fragt, ob ein Gespräch gerade offen ist)
    activeUrl: function () { return active && !active.el.classList.contains('min') ? active.url : null; },
    // Ein Fenster passt sich seinem Inhalt an (Minesweeper je nach Spielfeld), außer es ist maximiert oder auf dem Handy.
    // Mit scalable lässt es sich trotzdem an der Ecke aufziehen, der Inhalt skaliert dann mit.
    fit: function (win, width, height, opts) {
      var w = byWin(win);
      if (!w) return;
      w.el.classList.add('fitted');
      w.el.classList.toggle('scalable', !!(opts && opts.scalable));
      if (mobile.matches || w.el.classList.contains('max')) return;
      // Ist der Inhalt vergrößert, ist er auf dem Bildschirm entsprechend größer
      var z = 1;
      try { z = parseFloat(getComputedStyle(w.iframe.contentDocument.body).zoom) || 1; } catch (e) { /* fremde Seite */ }
      sizeTo(w, Math.round(width * z), Math.round(height * z));
      save();
    },
    // Mini-Player: Das Fenster wird zur Leiste und merkt sich die Größe davor, mit on = false kommt sie wieder
    mini: function (win, on, width, height) {
      var w = byWin(win);
      if (!w || mobile.matches) return false;
      if (on) {
        if (!w.before) w.before = { w: w.el.offsetWidth, h: w.el.offsetHeight, max: w.el.classList.contains('max') };
        w.el.classList.remove('max');
        w.el.classList.add('mini');
        sizeTo(w, width, height);
      } else if (w.before) {
        var b = w.before;
        w.before = null;
        w.el.classList.remove('mini');
        w.el.classList.toggle('max', b.max);
        w.el.style.width = Math.min(b.w, deskEl.clientWidth) + 'px'; w.el.style.height = Math.min(b.h, deskEl.clientHeight) + 'px';
        w.el.style.left = Math.max(0, Math.min(w.el.offsetLeft, deskEl.clientWidth - w.el.offsetWidth)) + 'px';
        w.el.style.top = Math.max(0, Math.min(w.el.offsetTop, deskEl.clientHeight - w.el.offsetHeight)) + 'px';
      }
      save();
      return true;
    },
    // „Beenden“ im Menü eines Fensters
    close: function (win) {
      var w = byWin(win);
      if (w) close(w);
    },
    // Alle Fenster, hinterstes zuerst (Pixelpfoten laufen auf den Titelleisten)
    windows: function () {
      return wins.slice().sort(function (a, b) { return a.z - b.z; }).map(function (w) {
        return { el: w.el, win: w.iframe.contentWindow, iframe: w.iframe, task: w.task, url: w.url, z: w.z, active: active === w,
          min: w.el.classList.contains('min'), max: w.el.classList.contains('max'), closing: !!w.closing };
      });
    },
    focusWin: function (win) { var w = byWin(win); if (w) focus(w); },
    onClose: function (fn) { closeGuards.push(fn); },
  };

  // Pixelpfoten draußen: Tiere und Möbel auf dem Desktop (games/haustier/src/js/desktop.js). Das Spiel lädt die Ebene, wenn es
  // ein Tier herauslässt; stehen schon Möbel auf dem Desktop, kommt sie gleich mit, damit sie auch ohne offenes Spiel dastehen.
  var petsLoad = null;
  window.RetroPets = {
    load: function () {
      if (petsLoad) return petsLoad;
      petsLoad = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.type = 'module'; s.src = '/haustier/js/desktop.js';
        s.onload = function () { if (window.RetroPets.api) resolve(window.RetroPets.api); else { petsLoad = null; reject(new Error('Pixelpfoten fehlt')); } };
        s.onerror = function () { petsLoad = null; s.remove(); reject(new Error('Pixelpfoten konnte nicht geladen werden')); };
        document.head.appendChild(s);
      });
      return petsLoad;
    },
  };
  try {
    var petCopy = JSON.parse(localStorage.getItem('haustier:v1:desk') || 'null');
    if (petCopy && petCopy.items && petCopy.items.length && String(petCopy.user || '') === String(me || '') && !mobile.matches) window.RetroPets.load().catch(function () { /* ohne Möbel */ });
  } catch (e) { /* privat */ }

  // Startmenü öffnet Fenster
  if (menu) menu.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    if (Date.now() - toggled < 400) return;
    closeMenu();
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
  // Gespeicherte Fenster stammen vielleicht von einem größeren Bildschirm
  wins.forEach(keepVisible);
  focus(main);
  // Falls das erste Fenster schon fertig war, bevor dieses Skript lief
  try { if (main.iframe.contentDocument.readyState === 'complete' && main.iframe.contentWindow.location.href !== 'about:blank') onLoad(main); } catch (e) { /* egal */ }
  addEventListener('pagehide', save);
})();
