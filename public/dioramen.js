// Dancors Dioramen (views/v3/dioramen.ejs, diorama.ejs): Sortierung, Bearbeiten-Modus der Übersicht (über public/v3-edit.js),
// Bilder groß ansehen mit Blättern, Vorher/Nachher-Regler.
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
      hint: 'Einträge ziehen, anpinnen oder ausblenden. Überschrift, Titel und Kurztext anklicken und ändern.',
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

  // ---------- Bilder groß ansehen ----------
  var gal = Array.prototype.slice.call(document.querySelectorAll('[data-lb]'));
  if (gal.length) {
    var box = null, at = 0;
    var show = function (i) {
      at = (i + gal.length) % gal.length;
      var a = gal[at];
      box.querySelector('img').src = a.getAttribute('href');
      box.querySelector('figcaption').textContent = (a.getAttribute('data-cap') || '') + (gal.length > 1 ? '  ·  ' + (at + 1) + ' / ' + gal.length : '');
    };
    var open = function (i) {
      if (!box) {
        box = document.createElement('dialog');
        box.className = 'di-lb';
        box.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>'
          + '<button type="button" class="nav prev" aria-label="Vorheriges Bild">‹</button><button type="button" class="nav next" aria-label="Nächstes Bild">›</button>'
          + '<button type="button" class="close" aria-label="Schließen">✕</button>';
        document.body.appendChild(box);
        box.querySelector('.prev').addEventListener('click', function () { show(at - 1); });
        box.querySelector('.next').addEventListener('click', function () { show(at + 1); });
        box.querySelector('.close').addEventListener('click', function () { box.close(); });
        box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'FIGURE') box.close(); });
        box.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') show(at - 1); if (e.key === 'ArrowRight') show(at + 1); });
        var x0 = null;
        box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
        box.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1)); x0 = null; });
      }
      box.classList.toggle('one', gal.length < 2);
      show(i);
      box.showModal();
    };
    gal.forEach(function (a, i) { a.addEventListener('click', function (e) { e.preventDefault(); open(i); }); });
    // Großes Bild oben: öffnet das erste Bild
    var hero = document.querySelector('[data-lb-hero]');
    if (hero) hero.addEventListener('click', function (e) { if (e.target.closest('a, button')) return; open(0); });
  }

  // ---------- Vorher/Nachher ----------
  document.querySelectorAll('.cmp').forEach(function (c) {
    var range = c.querySelector('input[type=range]');
    var set = function (v) { c.style.setProperty('--at', v + '%'); };
    set(range.value);
    range.addEventListener('input', function () { set(range.value); });
  });
})();
