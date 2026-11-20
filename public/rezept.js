// Dancors Deliziösitäten (views/v3/rezept*.ejs, einkauf.ejs): Favoriten, Portionsrechner, Kochmodus mit Weckern,
// Einkaufsliste abhaken und Schlagwort-Ideen im Formular. Ohne JavaScript gehen Favoriten und Liste über normale Formulare.
(function () {
  'use strict';
  var csrf = document.body.getAttribute('data-csrf') || '';
  function post(url, data) {
    var body = new URLSearchParams(data || {});
    body.set('_csrf', csrf);
    return fetch(url, { method: 'POST', body: body, credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  // ---------- Drucken ----------
  document.querySelectorAll('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });

  // ---------- Favoriten ohne Neuladen ----------
  document.querySelectorAll('form[data-fav]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = f.querySelector('button');
      post(f.action).then(function (r) {
        b.setAttribute('aria-pressed', r.fav ? 'true' : 'false');
        if (b.hasAttribute('data-fav-label')) b.textContent = r.fav ? '❤ Favorit' : '♡ Merken';
        else { b.textContent = r.fav ? '❤' : '♡'; b.title = r.fav ? 'Aus den Favoriten nehmen' : 'Als Favorit merken'; }
      }).catch(function () { f.submit(); });
    });
  });

  // ---------- Schlagwort-Ideen im Formular ----------
  var tagField = document.querySelector('[data-tags]');
  document.querySelectorAll('[data-tag-idea]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!tagField) return;
      var t = b.getAttribute('data-tag-idea'), have = tagField.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!have.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) have.push(t);
      tagField.value = have.join(', ');
    });
  });

  // ---------- Einkaufsliste abhaken ----------
  document.querySelectorAll('[data-shop-ids]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var li = cb.closest('[data-shop-row]');
      if (li) li.classList.toggle('done', cb.checked);
      post('/rezepte/einkauf/haken', { ids: cb.getAttribute('data-shop-ids'), done: cb.checked ? '1' : '0' }).catch(function () {
        cb.checked = !cb.checked;
        if (li) li.classList.toggle('done', cb.checked);
      });
    });
  });

  // ---------- Mengen wie auf dem Server (src/recipes.js fmtAmount) ----------
  var FR = [[0.5, '½'], [0.25, '¼'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔']];
  function fmt(x, unit) {
    if (x == null || !isFinite(x)) return '';
    if (x <= 0) return '0';
    var whole = Math.floor(x), rest = x - whole, i;
    if (['g', 'ml', 'mg', 'kg', 'l'].indexOf(unit) < 0 || x < 1) {
      for (i = 0; i < FR.length; i++) if (Math.abs(rest - FR[i][0]) < 0.04) return (whole ? whole : '') + FR[i][1];
    }
    if (Math.abs(rest) < 0.04) return String(whole);
    if (Math.abs(1 - rest) < 0.04) return String(whole + 1);
    if ((unit === 'g' || unit === 'ml') && x >= 100) return String(Math.round(x / 5) * 5);
    return (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)).toLocaleString('de-DE');
  }

  var rec = document.querySelector('[data-recipe]');
  if (!rec) return;
  var base = Number(rec.getAttribute('data-servings')) || 4, now = base;
  var out = document.querySelector('[data-portion-out]'), field = document.querySelector('[data-portion-field]'), reset = document.querySelector('[data-portion-reset]');
  var ings = [].slice.call(document.querySelectorAll('[data-ing]')).map(function (li) {
    var a = li.getAttribute('data-a'), a2 = li.getAttribute('data-a2');
    return { li: li, amt: li.querySelector('.amt'), a: a === '' ? null : Number(a), a2: a2 === '' ? null : Number(a2), u: li.getAttribute('data-u') || '', n: li.getAttribute('data-n') || '' };
  });
  function amountOf(i) {
    if (i.a == null) return '';
    var f = now / base;
    return fmt(i.a * f, i.u) + (i.a2 != null ? '–' + fmt(i.a2 * f, i.u) : '') + (i.u ? ' ' + i.u : '');
  }
  function setPortions(n) {
    now = Math.max(1, Math.min(100, n));
    if (out) out.textContent = now;
    if (field) field.value = now;
    if (reset) reset.hidden = now === base;
    ings.forEach(function (i) { i.amt.textContent = amountOf(i); });
  }
  document.querySelectorAll('[data-portion]').forEach(function (b) {
    b.addEventListener('click', function () { setPortions(now + Number(b.getAttribute('data-portion'))); });
  });
  if (reset) reset.addEventListener('click', function () { setPortions(base); });

  // ---------- Wecker ----------
  var box = document.querySelector('[data-timers]'), audio = null;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach(function (t) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.2, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.3);
        o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.3);
      });
    } catch (e) { /* kein Ton */ }
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  }
  function clock(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }
  function addTimer(sec, label) {
    if (!box) return;
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { /* kein Ton */ }
    var end = Date.now() + sec * 1000, paused = null, ring = null;
    var el = document.createElement('div');
    el.className = 'tm';
    el.innerHTML = '<span>⏱</span><span style="display:grid"><b></b><small class="muted"></small></span>' +
      '<button type="button" class="pill small" data-p>Pause</button><button type="button" class="pill small ghost" data-x aria-label="Wecker entfernen">✕</button>';
    el.querySelector('small').textContent = label;
    var t = el.querySelector('b'), pb = el.querySelector('[data-p]');
    box.appendChild(el);
    function left() { return Math.max(0, Math.round(((paused || Date.now()) - end) / -1000)); }
    function tick() {
      var s = left();
      t.textContent = clock(s);
      if (s <= 0 && !ring) {
        el.classList.add('done'); t.textContent = 'Fertig!'; pb.hidden = true;
        beep(); ring = setInterval(beep, 4000);
        clearInterval(iv);
      }
    }
    var iv = setInterval(tick, 500);
    tick();
    pb.addEventListener('click', function () {
      if (paused) { end += Date.now() - paused; paused = null; pb.textContent = 'Pause'; }
      else { paused = Date.now(); pb.textContent = 'Weiter'; }
    });
    el.querySelector('[data-x]').addEventListener('click', function () { clearInterval(iv); clearInterval(ring); el.remove(); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-timer]');
    if (!b) return;
    var li = b.closest('li'), cook = b.closest('[data-cook-box]'), label = b.textContent.replace('⏱', '').trim();
    var n = cook ? cookN + 1 : li && li.parentNode ? [].indexOf.call(li.parentNode.children, li) + 1 : 0;
    addTimer(Number(b.getAttribute('data-timer')), n ? 'Schritt ' + n + ' · ' + label : label);
  });

  // ---------- Kochmodus: ein Schritt je Bildschirm, das Handy bleibt an ----------
  var cookBox = document.querySelector('[data-cook-box]'), steps = [].slice.call(document.querySelectorAll('[data-steps] > li'));
  var cookN = 0, lock = null, opener = null;
  if (!cookBox || !steps.length) return;
  var q = function (s) { return cookBox.querySelector(s); };
  var norm = function (s) { return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); };
  // Welche Zutaten ein Schritt braucht: der Name (oder sein erstes langes Wort) steht im Text
  // oder ein langes Wort aus dem Schritt steckt im Namen („Brühe“ in „Gemüsebrühe“)
  function needs(text) {
    var t = norm(text), tw = t.split(/[^a-zß]+/).filter(function (x) { return x.length >= 5; });
    return ings.filter(function (i) {
      var n = norm(i.n), w = n.split(/[\s-]+/).filter(function (x) { return x.length >= 4; });
      return n && (t.indexOf(n) >= 0 || w.some(function (x) { return t.indexOf(x.slice(0, Math.max(4, x.length - 2))) >= 0; }) ||
        tw.some(function (x) { return n.indexOf(x) >= 0; }));
    });
  }
  function show() {
    var li = steps[cookN];
    q('[data-cook-n]').textContent = 'Schritt ' + (cookN + 1) + ' von ' + steps.length;
    q('[data-cook-text]').innerHTML = li.innerHTML;
    var need = q('[data-cook-need]'), list = needs(li.textContent);
    need.textContent = '';
    if (list.length) {
      var b = document.createElement('b'); b.textContent = 'Dafür: ';
      need.appendChild(b);
      need.appendChild(document.createTextNode(list.map(function (i) { var a = amountOf(i); return (a ? a + ' ' : '') + i.n; }).join(' · ')));
    }
    q('[data-cook-prog]').style.width = ((cookN + 1) / steps.length * 100) + '%';
    q('[data-cook-prev]').disabled = cookN === 0;
    q('[data-cook-next]').textContent = cookN === steps.length - 1 ? '✓ Fertig' : 'Weiter →';
  }
  function wake() {
    if (!('wakeLock' in navigator)) { q('[data-cook-lock]').textContent = ''; return; }
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      q('[data-cook-lock]').textContent = '📱 Bildschirm bleibt an';
      l.addEventListener('release', function () { lock = null; });
    }).catch(function () { q('[data-cook-lock]').textContent = ''; });
  }
  function open() {
    opener = document.activeElement;
    cookBox.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.classList.add('cooking');
    show(); wake();
    q('[data-cook-next]').focus();
  }
  function close() {
    cookBox.hidden = true;
    document.documentElement.style.overflow = '';
    document.documentElement.classList.remove('cooking');
    if (lock) { lock.release().catch(function () {}); lock = null; }
    if (opener && opener.focus) opener.focus();
  }
  function go(d) {
    if (cookN + d >= steps.length) return close();
    cookN = Math.max(0, Math.min(steps.length - 1, cookN + d));
    show();
  }
  document.querySelectorAll('[data-cook]').forEach(function (b) { b.addEventListener('click', open); });
  q('[data-cook-close]').addEventListener('click', close);
  q('[data-cook-prev]').addEventListener('click', function () { go(-1); });
  q('[data-cook-next]').addEventListener('click', function () { go(1); });
  document.addEventListener('keydown', function (e) {
    if (cookBox.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  });
  document.addEventListener('visibilitychange', function () { if (!cookBox.hidden && !lock && document.visibilityState === 'visible') wake(); });
  var x0 = null;
  cookBox.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  cookBox.addEventListener('touchend', function (e) {
    if (x0 == null) return;
    var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60 && !e.target.closest('button')) go(dx < 0 ? 1 : -1);
  });
})();
