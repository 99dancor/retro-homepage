// Popup-Bilder (src/popups.js): ab und zu geht ein kleines Fenster mit einem Bild aus dem Pool auf, wie früher die
// Werbefenster, nur zum Spaß. Regeln: erstes frühestens nach „first“ Sekunden, danach höchstens alle „every“ Minuten
// (auch über Neuladen hinweg) und höchstens „max“ pro Besuch; nie über Spielen, maximierten Fenstern, Vollbild, dem
// Kinomodus des Mediaplayers oder dem Anmeldebildschirm; auf dem Handy nur, wenn der Admin das will. Abschalten geht im
// Fenster selbst („Nicht mehr zeigen“) oder unter 🖥️ → Effekte. Der Server zählt nur „kam“, „angeklickt“, „geschlossen“.
(function () {
  'use strict';
  var R = window.RetroDesk, W = window.WinUI, deskEl = document.getElementById('desk');
  if (!R || !deskEl || !window.fetch) return;
  var root = document.documentElement;
  var GAMES = ['kartenspiele', 'blackjack', 'poker', 'durak', 'uno', 'flip7', 'pilli', 'quiz', 'werwolf', 'minesweeper', 'kreuzwortraetsel', 'sudoku', 'haustier', 'paint', 'apps'];
  var cfg = null, lastId = null, timer = 0, open = null;
  var mobile = window.matchMedia('(max-width: 760px), (pointer: coarse)');

  function get(k, store) { try { return (store || localStorage).getItem(k); } catch (e) { return null; } }
  function set(k, v, store) { try { (store || localStorage).setItem(k, v); } catch (e) { /* privat */ } }
  function wanted() { return !window.RetroDisplay || window.RetroDisplay.get().popups !== false; }
  function visit() { try { return JSON.parse(get('popups-besuch', sessionStorage) || '{"n":0}'); } catch (e) { return { n: 0 }; } }
  function count(id, what) {
    fetch('/api/popups/' + id + '/' + what, { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': W ? W.csrf() : '' } }).catch(function () { /* egal */ });
  }

  // Darf jetzt eins kommen? Sonst in einer Minute nochmal schauen
  function blocked() {
    if (open || root.classList.contains('logon-on') || document.fullscreenElement || document.hidden) return true;
    if (document.querySelector('.ms-dlg, .wui-menu, #startmenu.open')) return true;
    var ws = R.windows ? R.windows() : [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w.min || w.closing) continue;
      if (w.max) return true;
      if (w.active) {
        var sec = String(w.url || '').split(/[?#]/)[0].split('/')[1] || '';
        if (GAMES.indexOf(sec) >= 0) return true;
        try { if (w.win.document.documentElement.classList.contains('theater') || w.win.document.fullscreenElement) return true; } catch (e) { /* fremd */ }
      }
    }
    return false;
  }
  function pick() {
    var list = cfg.items.filter(function (p) { return p.id !== lastId || cfg.items.length === 1; });
    var sum = list.reduce(function (n, p) { return n + p.weight; }, 0), r = Math.random() * sum;
    for (var i = 0; i < list.length; i++) { r -= list[i].weight; if (r < 0) return list[i]; }
    return list[0];
  }
  function schedule(sec) { clearTimeout(timer); timer = setTimeout(tryShow, Math.max(1, sec) * 1000); }
  function tryShow() {
    if (!cfg || !cfg.items.length || !wanted()) return;
    var v = visit();
    if (v.n >= cfg.max) return;
    var since = (Date.now() - Number(get('popups-zuletzt') || 0)) / 1000;
    if (since < cfg.every * 60) return schedule(cfg.every * 60 - since + 1);
    if (blocked()) return schedule(60);
    show(pick());
    v.n++;
    set('popups-besuch', JSON.stringify(v), sessionStorage);
    set('popups-zuletzt', String(Date.now()));
    schedule(cfg.every * 60 + 1);
  }

  function show(p) {
    lastId = p.id;
    var el = document.createElement('div');
    el.className = 'window pop' + (cfg.cheeky ? ' wobble' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', p.title);
    el.innerHTML = '<div class="titlebar"><span class="ttl"></span><button type="button" class="tb-btn" data-pop="zu" title="Schließen" aria-label="Schließen">×</button></div>' +
      '<div class="body"><button type="button" class="pop-img" data-pop="klick"><img alt=""></button>' +
      '<div class="pf"><button type="button" class="linkish" data-pop="nie">Nicht mehr zeigen</button><span class="sp"></span><small>Popup-Bild · <a href="/datenschutz#popups" data-pop="info">Was ist das?</a></small></div></div>';
    el.querySelector('.ttl').textContent = '🎉 ' + p.title;
    var img = el.querySelector('img');
    img.alt = p.title;
    img.src = p.image;
    if (!p.link) el.querySelector('.pop-img').classList.add('nolink');
    deskEl.appendChild(el);
    open = el;
    // Wie die Werbefenster früher: vor allen offenen Fenstern, und nach einem Klick wieder nach vorn
    if (R && R.raise) { R.raise(el); el.addEventListener('pointerdown', function () { R.raise(el); }); }
    img.addEventListener('load', placeIt);
    img.addEventListener('error', function () { close(); });
    placeIt();
    if (window.RetroSound) window.RetroSound.play('fehler');
    count(p.id, 'zeige');

    var dodged = false;
    el.addEventListener('pointerover', function (e) {
      // Frecher Modus: Der ×-Knopf weicht beim ersten Mal aus
      if (!cfg.cheeky || dodged || !e.target.closest('[data-pop=zu]')) return;
      dodged = true;
      var a = deskEl.getBoundingClientRect(), r = el.getBoundingClientRect();
      el.style.left = Math.max(0, Math.min(a.width - r.width, r.left - a.left + (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 80))) + 'px';
      el.style.top = Math.max(0, Math.min(a.height - r.height, r.top - a.top + (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 60))) + 'px';
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pop]');
      if (!b) return;
      e.preventDefault();
      var what = b.dataset.pop;
      if (what === 'zu') { count(p.id, 'zu'); close(); }
      else if (what === 'klick') {
        if (!p.link) return;
        count(p.id, 'klick');
        close();
        var u = new URL(p.link, location.href);
        if (u.origin === location.origin) R.open(u.pathname + u.search + u.hash, true); else window.open(u.href, '_blank', 'noopener');
      } else if (what === 'nie') {
        count(p.id, 'zu');
        close();
        if (window.RetroDisplay) window.RetroDisplay.patch({ popups: false });
        clearTimeout(timer);
        if (W && W.msgbox) W.msgbox('Popup-Bilder sind jetzt aus. Unter 🖥️ → Effekte schaltest du sie wieder ein.', 'ℹ️', 'Popup-Bilder');
      } else if (what === 'info') { close(); R.open('/datenschutz#popups', true); }
    });
    drag(el, el.querySelector('.titlebar'));
  }
  // Irgendwo auf den Desktop, aber ganz sichtbar
  function placeIt() {
    if (!open) return;
    var a = deskEl.getBoundingClientRect(), w = open.offsetWidth, h = open.offsetHeight;
    if (open.dataset.placed && !open.classList.contains('grow')) return;
    open.dataset.placed = '1';
    open.style.left = Math.round(Math.max(0, (a.width - w) * (0.15 + Math.random() * 0.7))) + 'px';
    open.style.top = Math.round(Math.max(0, (a.height - h) * (0.1 + Math.random() * 0.6))) + 'px';
  }
  function close() { if (open) { open.remove(); open = null; } }
  function drag(el, handle) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      var r = el.getBoundingClientRect(), a = deskEl.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      function move(ev) {
        el.style.left = Math.max(0, Math.min(a.width - r.width, ev.clientX - a.left - dx)) + 'px';
        el.style.top = Math.max(0, Math.min(a.height - r.height, ev.clientY - a.top - dy)) + 'px';
      }
      function up() { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  fetch('/api/popups', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.items || !j.items.length) return;
    if (mobile.matches && !j.mobile) return;
    cfg = j;
    var since = (Date.now() - Number(get('popups-zuletzt') || 0)) / 1000;
    schedule(Math.max(cfg.first, cfg.every * 60 - since));
  }, function () { /* ohne Popups */ });
  window.RetroPopups = { now: function () { if (cfg) { set('popups-zuletzt', '0'); set('popups-besuch', '{"n":0}', sessionStorage); tryShow(); } } };
})();
