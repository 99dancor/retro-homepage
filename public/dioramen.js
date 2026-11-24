// Dancors Dioramas (views/v3/dioramen.ejs, diorama.ejs): Sortierung, Bearbeiten-Modus der Übersicht (über public/v3-edit.js),
// Bilder groß ansehen mit Blättern, Vorher/Nachher-Regler, Kartenpunkte und „Springen zu“ mit Aufleuchten der Kacheln.
(function () {
  'use strict';
  document.querySelectorAll('select[data-go]').forEach(function (s) {
    s.addEventListener('change', function () { location.href = s.value; });
  });

  // ---------- Bearbeiten-Modus der Übersicht ----------
  var root = document.querySelector('[data-ed-root]');
  if (root && window.V3Edit) {
    var showPin = function (item, on) {
      var flag = item.querySelector('.flag-b.pin');
      if (flag) flag.hidden = !on;
      item.classList.toggle('pinned', !!on);
    };
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pin]');
      if (!b || !document.body.classList.contains('editing')) return;
      e.preventDefault();
      var item = b.closest('[data-ed-item]'), v = window.V3Edit.val(item);
      if (window.V3Edit.snap) window.V3Edit.snap();
      v.pin = !v.pin;
      window.V3Edit.setVal(item, v);
      showPin(item, v.pin);
    });
    // „✎ Eintrag“ führt auch im Modus zur Bearbeiten-Seite
    root.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-go]');
      if (a && document.body.classList.contains('editing')) { e.stopPropagation(); location.href = a.href; }
    }, true);
    window.V3Edit.page({
      save: '/dioramen/seite',
      hint: 'Spielstände ziehen, anpinnen oder ausblenden. Überschrift, Titel und Kurztext anklicken und ändern.',
      collect: function (d, el) {
        var pick = function (name, def) { var r = el.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : def; };
        var cards = d.lists.cards || [];
        return { layout: {
          title: d.texts.title, text: d.texts.text, hero: pick('ed-hero', 'pin'), sort: pick('ed-sort', 'eigene'),
          order: cards.map(function (c) { return c.key; }),
          hidden: cards.filter(function (c) { return c.hidden; }).map(function (c) { return c.key; }),
          cards: cards.map(function (c) { return { key: c.key, title: c.title, summary: c.summary, pin: !!c.pin }; }),
        } };
      },
    });
  }

  // Bilder groß ansehen: macht public/v3-bilder.js für alle Seiten (auch neue Kacheln)
  var editing = function () { return document.body.classList.contains('dio-ed'); };
  // Großes Bild oben: öffnet das erste Bild
  var hero = document.querySelector('[data-lb-hero]');
  if (hero) hero.addEventListener('click', function (e) {
    if (e.target.closest('a, button') || editing()) return;
    if (window.V3Bilder) window.V3Bilder.open(0);
  });

  // ---------- Vorher/Nachher ----------
  var initCmp = function (root) {
    (root || document).querySelectorAll('.cmp').forEach(function (c) {
      if (c.hasAttribute('data-ready')) return;
      c.setAttribute('data-ready', '');
      var range = c.querySelector('input[type=range]');
      var set = function (v) { c.style.setProperty('--at', v + '%'); };
      set(range.value);
      range.addEventListener('input', function () { set(range.value); });
    });
  };
  // ---------- Neue Kacheln (Update 106): Zahlen zählen hoch, 360°-Panorama dreht ----------
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // „38“, „2,4 MW“, „1.200 €“: die erste Zahl zählt hoch, der Rest bleibt stehen
  var countUp = function (el) {
    var raw = el.getAttribute('data-count') || '', m = /^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(.*)$/.exec(raw);
    if (!m || still) return;
    var target = Number(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3] : '')), dec = m[3] ? m[3].length : 0, t0 = null;
    var fmt = function (n) { return m[1] + n.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[4]; };
    var step = function (ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / 1100), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(target * e);
      if (k < 1) requestAnimationFrame(step); else el.textContent = raw;
    };
    requestAnimationFrame(step);
  };
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (list) {
    list.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); countUp(en.target); } });
  }, { threshold: 0.4 }) : null;
  var initPano = function (p) {
    var pos = 0, drag = null, last = 0, auto = p.classList.contains('spin') && !still, raf = 0;
    var set = function () { p.style.backgroundPositionX = pos + 'px'; };
    var tick = function (ts) { if (auto && !drag) { pos -= (ts - (last || ts)) * 0.02; set(); } last = ts; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    p.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, p: pos }; auto = false; p.setPointerCapture(e.pointerId); p.classList.add('grab'); });
    p.addEventListener('pointermove', function (e) { if (!drag) return; pos = drag.p + (e.clientX - drag.x); set(); });
    var end = function () { drag = null; p.classList.remove('grab'); };
    p.addEventListener('pointerup', end); p.addEventListener('pointercancel', end);
    p.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); auto = false; pos += e.key === 'ArrowLeft' ? 60 : -60; set(); } });
  };
  var initTiles = function (root) {
    (root || document).querySelectorAll('.knum b[data-count]').forEach(function (b) {
      if (b.hasAttribute('data-ready')) return;
      b.setAttribute('data-ready', '');
      if (io && !editing()) io.observe(b);
    });
    // 3D-Kachel: <model-viewer> erst laden, wenn eine auf der Seite ist (liegt unter /vendor, kein fremder Server)
    if (!window.__mv && (root || document).querySelector('model-viewer')) {
      window.__mv = true;
      var sc = document.createElement('script');
      sc.type = 'module'; sc.src = '/vendor/model-viewer/model-viewer.min.js';
      document.head.appendChild(sc);
    }
    (root || document).querySelectorAll('.kpano').forEach(function (p) {
      if (p.hasAttribute('data-ready')) return;
      p.setAttribute('data-ready', '');
      initPano(p);
    });
  };
  // Hinweispunkte: Antippen öffnet die Erklärung daneben, ein Klick woanders schließt sie
  var closeHot = function (except) {
    document.querySelectorAll('.khot .hp[aria-expanded=true]').forEach(function (b) {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false'); b.nextElementSibling.hidden = true;
    });
  };
  document.addEventListener('click', function (e) {
    var hp = e.target.closest && e.target.closest('.khot .hp');
    if (!hp) { if (!(e.target.closest && e.target.closest('.hbub'))) closeHot(null); return; }
    if (editing()) return;
    var bub = hp.nextElementSibling, open = hp.getAttribute('aria-expanded') !== 'true';
    closeHot(hp);
    hp.setAttribute('aria-expanded', String(open));
    bub.hidden = !open;
    if (open) {
      var x = Number(getComputedStyle(bub).getPropertyValue('--x')), y = Number(getComputedStyle(bub).getPropertyValue('--y'));
      bub.classList.toggle('left', x > 60); bub.classList.toggle('right', x < 40); bub.classList.toggle('up', y > 60);
    }
  });
  // Zeitleiste: Punkt antippen oder Pfeiltasten zeigen den Stand
  var showStep = function (box, i) {
    var steps = box.querySelectorAll('.tstep'), tabs = box.querySelectorAll('.tline button');
    i = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach(function (s, k) { s.classList.toggle('on', k === i); });
    tabs.forEach(function (b, k) { b.setAttribute('aria-selected', String(k === i)); });
    return tabs[i];
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.ktime .tline button');
    if (b && !editing()) showStep(b.closest('.ktime'), Number(b.getAttribute('data-i')));
  });
  document.addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('.ktime .tline button');
    if (!b || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    var t = showStep(b.closest('.ktime'), Number(b.getAttribute('data-i')) + (e.key === 'ArrowLeft' ? -1 : 1));
    if (t) t.focus();
  });
  initCmp();
  initTiles();
  window.DioUI = { initCmp: function (root) { initCmp(root); initTiles(root); } };

  // ---------- Kartenpunkte und „Springen zu“: hinspringen, Kacheln des Bauwerks leuchten kurz ----------
  var toast = document.querySelector('.dio-toast'), toastTimer = null, glowTimer = null;
  var glow = function (els, color) {
    document.querySelectorAll('.kt.glow').forEach(function (k) { k.classList.remove('glow'); });
    clearTimeout(glowTimer);
    els.forEach(function (k) { k.classList.add('glow'); });
    glowTimer = setTimeout(function () { els.forEach(function (k) { k.classList.remove('glow'); }); }, 2600);
  };
  var jumpTo = function (to, fromMap) {
    var tiles, first, name = '', color = '';
    if (to.charAt(0) === 'b') {
      tiles = Array.prototype.slice.call(document.querySelectorAll('.kt[data-bw="' + to + '"]'));
      first = document.getElementById('bw-' + to) ? document.getElementById('bw-' + to).closest('.kt') : tiles[0];
      var head = document.querySelector('.kt.k-head[data-bw="' + to + '"] h2');
      name = head ? head.textContent : (tiles[0] && tiles[0].querySelector('.bwtag') ? tiles[0].querySelector('.bwtag').textContent.replace(/^\d+ · /, '') : '');
    } else {
      first = document.getElementById('k-' + to);
      tiles = first ? [first] : [];
      var h = first && first.querySelector('h3, .kcap');
      name = h ? h.textContent : 'Kachel';
    }
    if (!first) return false;
    color = getComputedStyle(first).getPropertyValue('--bwc');
    first.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    glow(tiles);
    if (toast && fromMap) {
      toast.querySelector('.tx').textContent = name + (tiles.length > 1 ? ' · ' + tiles.length + ' Kacheln' : '');
      toast.style.setProperty('--bwc', color || '');
      toast.querySelector('a').setAttribute('href', '#' + fromMap);
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.hidden = true; }, 7000);
    }
    return true;
  };
  document.addEventListener('click', function (e) {
    if (editing()) return;
    var p = e.target.closest && e.target.closest('.kg .mp[data-to]');
    if (p && p.getAttribute('data-to')) {
      e.preventDefault();
      var map = p.closest('.kt');
      if (jumpTo(p.getAttribute('data-to'), map && map.id)) history.replaceState(null, '', p.getAttribute('href'));
      return;
    }
    var j = e.target.closest && e.target.closest('.jump a[data-bw]');
    if (j) { e.preventDefault(); if (jumpTo(j.getAttribute('data-bw'), null)) history.replaceState(null, '', j.getAttribute('href')); return; }
    var back = e.target.closest && e.target.closest('.dio-toast a');
    if (back) { e.preventDefault(); toast.hidden = true; var m = document.querySelector(back.getAttribute('href')); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  // Mit einer Adresse wie …#bw-b2 (z. B. aus der Suche) leuchtet das Bauwerk beim Öffnen auf
  var hm = /^#bw-(b\d+)$/.exec(location.hash);
  if (hm) setTimeout(function () { jumpTo(hm[1], null); }, 300);
})();
