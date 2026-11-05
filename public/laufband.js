// Laufband oben über dem Desktop (views/desktop.ejs, src/ticker.js). Die Meldungen laufen von rechts nach links; bei
// „Anhalten“ unter 🖥️ → Effekte oder wenn das System weniger Bewegung wünscht, wechseln sie stattdessen alle paar Sekunden.
// × blendet es aus, bis etwas Neues kommt, oder ganz (dann wie 🖥️ → Effekte → Ausblenden). Gemerkt wird das nur im
// Browser (localStorage „laufband“), der Server erfährt davon nichts.
(function () {
  'use strict';
  var el = document.getElementById('ticker'), R = window.RetroDesk, W = window.WinUI;
  if (!el) return;
  var root = document.documentElement, run = el.querySelector('.run'), box = el.querySelector('.items');
  var KEY = 'laufband', SPEED = { langsam: 45, normal: 75, schnell: 120 };
  var paused = false, rotTimer = 0, rotIdx = 0, items = [];
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function read() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function write(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* privat */ } }
  // Fingerabdruck der Meldungen: Ändert sich etwas, kommt ein „bis es Neues gibt“ ausgeblendetes Laufband wieder
  function hash() {
    var s = box.textContent, h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function display() { return window.RetroDisplay ? window.RetroDisplay.get() : { marquee: 'an', tickSpeed: 'normal' }; }

  function visible() {
    var d = display();
    var on = d.marquee !== 'aus' && read() !== 'bis:' + hash();
    el.hidden = !on;
    document.body.classList.toggle('has-tick', on);
    return on;
  }
  function stopRotate() { clearInterval(rotTimer); rotTimer = 0; el.classList.remove('rotate'); items.forEach(function (x) { x.classList.remove('cur'); }); }
  function layout() {
    stopRotate();
    box.style.animation = 'none';
    items = [].slice.call(box.children).filter(function (x) { return x.tagName !== 'I'; });
    if (!visible()) return;
    var d = display();
    // Wechseln statt laufen: „Anhalten“ in den Effekten oder weniger Bewegung im System
    if (d.marquee === 'still' || motion.matches) {
      el.classList.add('rotate');
      rotIdx = rotIdx % Math.max(1, items.length);
      show(rotIdx);
      if (items.length > 1) rotTimer = setInterval(function () { if (!paused) show(rotIdx = (rotIdx + 1) % items.length); }, 6000);
      return;
    }
    var w = run.clientWidth, cw = box.scrollWidth;
    var speed = SPEED[d.tickSpeed] || SPEED.normal;
    box.style.setProperty('--tk-from', w + 'px');
    box.style.setProperty('--tk-to', -cw + 'px');
    box.style.animation = 'tick-run ' + Math.max(6, (w + cw) / speed).toFixed(1) + 's linear infinite';
    box.style.animationPlayState = paused ? 'paused' : 'running';
  }
  function show(i) { items.forEach(function (x, n) { x.classList.toggle('cur', n === i); }); }

  // Neue Meldungen vom Server alle zwei Minuten
  function draw(list) {
    var old = hash();
    box.textContent = '';
    list.forEach(function (it, i) {
      if (i) { var sep = document.createElement('i'); sep.setAttribute('aria-hidden', 'true'); sep.textContent = '+++'; box.appendChild(sep); }
      var a = document.createElement(it.url ? 'a' : 'span');
      if (it.url) a.href = it.url;
      a.textContent = it.text;
      box.appendChild(a);
    });
    if (hash() !== old) layout();
  }
  function poll() {
    if (!document.hidden) {
      fetch('/api/laufband', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.items && j.items.length) draw(j.items); }, function () { /* nächstes Mal */ });
    }
    setTimeout(poll, 120000);
  }

  el.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var u = new URL(a.href, location.href);
      e.preventDefault();
      if (u.origin !== location.origin) window.open(u.href, '_blank', 'noopener');
      else if (R) R.open(u.pathname + u.search + u.hash, true);
      return;
    }
    var b = e.target.closest('[data-tk]');
    if (!b) return;
    if (b.dataset.tk === 'pause') {
      paused = !paused;
      box.style.animationPlayState = paused ? 'paused' : 'running';
      b.textContent = paused ? '▶' : '❚❚';
      b.title = paused ? 'Weiterlaufen lassen' : 'Anhalten';
      b.setAttribute('aria-label', paused ? 'Laufband weiterlaufen lassen' : 'Laufband anhalten');
    } else if (b.dataset.tk === 'menu' && W) {
      var r = b.getBoundingClientRect();
      W.contextMenu(Math.max(0, r.right - 300), r.bottom, [
        { label: 'Ausblenden, bis es etwas Neues gibt', act: 'bis', bold: true },
        { label: 'Immer ausblenden', act: 'immer' },
        '-',
        { label: 'Einstellungen… (🖥️ → Effekte)', act: 'effekte' },
      ], function (act) {
        if (act === 'bis') { write('bis:' + hash()); layout(); }
        else if (act === 'immer') { if (window.RetroDisplay) window.RetroDisplay.patch({ marquee: 'aus' }); write(''); layout(); }
        else if (act === 'effekte') openEffects();
      });
    }
  });
  function openEffects() {
    var btn = document.getElementById('displaybtn'), panel = document.getElementById('displaypanel');
    if (!btn || !panel) return;
    if (panel.hidden) btn.click();
    var tab = panel.querySelector('[data-tab=effekte]');
    if (tab) tab.click();
  }

  window.addEventListener('darstellung:angewendet', layout);
  window.addEventListener('resize', function () { clearTimeout(layout.t); layout.t = setTimeout(layout, 200); });
  if (motion.addEventListener) motion.addEventListener('change', layout);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) layout(); });
  layout();
  setTimeout(poll, 120000);
})();
