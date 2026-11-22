// Dancors Dioramen (views/v3/dioramen.ejs, diorama.ejs): Sortierung, Bearbeiten-Modus der Übersicht (über public/v3-edit.js),
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
  initCmp();
  window.DioUI = { initCmp: initCmp };

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
