// Update 100: Aussehen der Seite im Browser (src/look.js liefert die Werte als CSS-Variablen und Klassen).
// Diashow, Jahreszeiten-Deko, kleine Kopfleiste beim Scrollen, Hinweis-Leiste schließen, „Mein Hintergrund“ für Mitglieder
// und der Knopf „🎨 Aussehen“ für den Admin (lädt public/v3-look-edit.js erst beim Klick).
(function () {
  'use strict';
  var body = document.body, root = document.documentElement;
  var csrf = body.getAttribute('data-csrf') || '';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function fxOn() { return store('v3-fx') !== 'aus'; }

  // ---------- Hinweis-Leiste: einmal schließen, bis es einen neuen Hinweis gibt ----------
  var note = document.querySelector('[data-lk-notice]');
  if (note) {
    var nid = note.getAttribute('data-lk-notice');
    if (store('v3-hinweis') === nid) note.hidden = true;
    note.querySelector('button').addEventListener('click', function () { note.hidden = true; store('v3-hinweis', nid); });
  }

  // ---------- Kopfleiste wird beim Scrollen klein ----------
  if (body.classList.contains('lk-bar-shrink')) {
    var small = false;
    var onScroll = function () { var s = window.scrollY > 40; if (s !== small) { small = s; body.classList.toggle('lk-small', s); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Diashow: Bilder aus --lk-slides blenden langsam über ----------
  var layer = document.querySelector('.lk-bg'), timer = null;
  function slides() {
    if (!layer) return;
    clearInterval(timer); timer = null;
    layer.querySelectorAll('.lk-slide').forEach(function (n) { n.remove(); });
    var cs = getComputedStyle(layer), raw = cs.getPropertyValue('--lk-slides').trim().replace(/^["']|["']$/g, '');
    var list = raw && raw !== 'none' ? raw.split(/\s+/).filter(function (f) { return /^[a-f0-9]{32}\.[a-z]+$/.test(f); }) : [];
    if (list.length < 2) return;
    showFx();
    if (reduce || !fxOn()) return;
    var sec = Math.max(5, parseInt(cs.getPropertyValue('--lk-int'), 10) || 30), n = 0;
    var nodes = list.slice(1).map(function (f) {
      var i = document.createElement('i');
      i.className = 'lk-slide';
      i.style.backgroundImage = 'url("/media/' + f + '")';
      layer.appendChild(i);
      return i;
    });
    timer = setInterval(function () {
      if (document.hidden) return;
      n = (n + 1) % list.length;
      nodes.forEach(function (x, k) { x.classList.toggle('on', k === n - 1); });
    }, sec * 1000);
  }
  window.LookSlides = slides;
  slides();
  // Hell/dunkel umgeschaltet: Diashow neu lesen (dunkel kann eigene Bilder haben)
  new MutationObserver(function () { slides(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- Effekte an/aus (Fußzeile), merkt sich der Browser ----------
  var fxBox = document.querySelector('[data-lk-fx]');
  function showFx() { if (fxBox) fxBox.closest('label').hidden = false; }
  if (fxBox) {
    fxBox.checked = fxOn();
    fxBox.addEventListener('change', function () { store('v3-fx', fxBox.checked ? null : 'aus'); slides(); deko(); });
  }

  // ---------- Jahreszeiten-Deko: Schnee, Laub, Blüten, Konfetti ----------
  var canvas = null, raf = 0;
  function deko() {
    var kind = body.getAttribute('data-lk-season');
    if (canvas) { cancelAnimationFrame(raf); canvas.remove(); canvas = null; }
    if (!kind || body.classList.contains('framed')) return;
    showFx();
    if (reduce || !fxOn()) return;
    canvas = document.createElement('canvas');
    canvas.className = 'lk-deko';
    canvas.setAttribute('aria-hidden', 'true');
    body.appendChild(canvas);
    var ctx = canvas.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), parts = [];
    var COLORS = { laub: ['#d9822b', '#c4512a', '#e0a83a', '#9c5a24'], blueten: ['#ffd1e3', '#ffc0d6', '#fff0f6'], konfetti: ['#ff5a5f', '#ffd23f', '#3bceac', '#4f97ff', '#a98bff'] };
    function size() { W = canvas.width = innerWidth * dpr; H = canvas.height = innerHeight * dpr; canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px'; }
    size();
    window.addEventListener('resize', size);
    var count = Math.round(Math.min(90, innerWidth / (kind === 'schnee' ? 16 : 28)));
    function make(top) {
      var c = COLORS[kind] || ['#fff'];
      return { x: Math.random() * W, y: top ? Math.random() * H : -20 * dpr, r: (kind === 'schnee' ? 1.5 + Math.random() * 2.5 : 4 + Math.random() * 4) * dpr,
        vy: (kind === 'schnee' ? 0.4 + Math.random() * 0.8 : 0.7 + Math.random() * 1.1) * dpr, vx: (Math.random() - 0.5) * 0.6 * dpr, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.06, c: c[Math.floor(Math.random() * c.length)] };
    }
    for (var k = 0; k < count; k++) parts.push(make(true));
    function step() {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p, i) {
        p.y += p.vy; p.a += p.va; p.x += p.vx + Math.sin(p.a) * 0.4 * dpr;
        if (p.y > H + 20 * dpr) parts[i] = make(false);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        if (kind === 'schnee') { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 6.28); ctx.fill(); }
        else if (kind === 'konfetti') ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        else { ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r / 2, 0, 0, 6.28); ctx.fill(); }
        ctx.restore();
      });
    }
    step();
  }
  window.LookDeko = deko;
  deko();

  // ---------- Mein Hintergrund (Mitglieder) ----------
  function post(url, data) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Fehler'); return j; }); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lk-mine]');
    if (!b) return;
    e.preventDefault();
    fetch('/aussehen/bilder', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (d) {
      var dlg = document.createElement('dialog');
      dlg.className = 'lk-mine-dlg';
      dlg.innerHTML = '<h2>🖼️ Mein Hintergrund</h2><p class="muted" style="margin:0">Such dir ein Bild aus. Das sehen nur du und nur auf den Seiten ohne Desktop.</p><div class="lk-mine-grid"></div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="pill" data-close>Schließen</button></div>';
      var grid = dlg.querySelector('.lk-mine-grid');
      var choose = function (f) { post('/aussehen/mein', { bg: f }).then(function () { location.reload(); }).catch(function (err) { alert(err.message); }); };
      var std = document.createElement('button');
      std.type = 'button'; std.textContent = 'Wie vorgegeben'; if (!d.mine) std.className = 'on';
      std.addEventListener('click', function () { choose(''); });
      grid.appendChild(std);
      (d.images || []).forEach(function (im) {
        var x = document.createElement('button');
        x.type = 'button'; x.title = im.name || ''; x.style.backgroundImage = 'url("' + im.url + '")'; x.setAttribute('aria-label', im.name || 'Bild');
        if (d.mine === im.f) x.className = 'on';
        x.addEventListener('click', function () { choose(im.f); });
        grid.appendChild(x);
      });
      dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
      dlg.addEventListener('close', function () { dlg.remove(); });
      body.appendChild(dlg);
      dlg.showModal();
    });
  });

  // ---------- Admin: „🎨 Aussehen der Seite“ öffnet die Schublade ----------
  if (!body.hasAttribute('data-lk-admin')) return;
  var loading = false;
  function openEditor() {
    if (window.LookEdit) return window.LookEdit.open();
    if (loading) return;
    loading = true;
    var s = document.createElement('script');
    s.src = body.getAttribute('data-lk-admin');
    s.onload = function () { loading = false; window.LookEdit && window.LookEdit.open(); };
    document.head.appendChild(s);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lk-edit]');
    if (!b) return;
    e.preventDefault();
    var m = b.closest('.v3-menu'); if (m) m.hidden = true;
    openEditor();
  });
  if (/[?&]aussehen=1\b/.test(location.search)) openEditor();
})();
