// Update 103: Bilder groß ansehen auf allen modernen Seiten (wie bei den Dioramen).
// Öffnet [data-lb]-Links, Links auf Bilder aus /media und Bilder in Texten (.prose) in einem Fenster über der Seite,
// mit Blättern (Pfeile, Tasten, Wischen) durch alle Bilder der Seite. Im Bearbeiten-Modus bleibt alles aus.
(function () {
  'use strict';
  var IMG = /\/media\/[a-f0-9]{32}\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;
  var body = document.body;
  var editing = function () { return body.classList.contains('dio-ed') || body.classList.contains('editing'); };
  // Was gilt als Bild: [data-lb], <a href="/media/…bild">, <img> in .prose ohne eigenen Link
  var srcOf = function (n) {
    if (n.tagName === 'IMG') return n.currentSrc || n.src;
    return n.getAttribute('href');
  };
  var capOf = function (n) {
    if (n.hasAttribute('data-cap')) return n.getAttribute('data-cap') || '';
    var img = n.tagName === 'IMG' ? n : n.querySelector('img');
    return (img && (img.getAttribute('alt') || img.getAttribute('title'))) || '';
  };
  var pick = function (n) {
    if (!n || !n.closest) return null;
    var a = n.closest('[data-lb]');
    if (a) return a;
    a = n.closest('a[href]');
    if (a) return IMG.test(a.getAttribute('href')) && !a.hasAttribute('download') ? a : null;
    if (n.tagName === 'IMG' && n.closest('.prose') && !n.closest('.no-lb')) return n;
    return null;
  };
  var all = function () {
    var out = [];
    document.querySelectorAll('[data-lb], a[href*="/media/"], .prose img').forEach(function (n) {
      var p = pick(n);
      if (p === n && out.indexOf(n) < 0 && !n.closest('[hidden]:not([data-lb])') && !n.closest('dialog')) out.push(n);
    });
    return out;
  };

  var gal = [], box = null, at = 0;
  var show = function (i) {
    at = (i + gal.length) % gal.length;
    var n = gal[at], cap = capOf(n);
    box.querySelector('img').src = srcOf(n);
    box.querySelector('img').alt = cap;
    box.querySelector('figcaption').textContent = cap + (gal.length > 1 ? (cap ? '  ·  ' : '') + (at + 1) + ' / ' + gal.length : '');
  };
  var build = function () {
    box = document.createElement('dialog');
    box.className = 'v3-lb';
    box.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>'
      + '<button type="button" class="nav prev" aria-label="Vorheriges Bild">‹</button><button type="button" class="nav next" aria-label="Nächstes Bild">›</button>'
      + '<button type="button" class="close" aria-label="Schließen">✕</button>';
    body.appendChild(box);
    box.querySelector('.prev').addEventListener('click', function () { show(at - 1); });
    box.querySelector('.next').addEventListener('click', function () { show(at + 1); });
    box.querySelector('.close').addEventListener('click', function () { box.close(); });
    box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'FIGURE') box.close(); });
    box.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') show(at - 1); if (e.key === 'ArrowRight') show(at + 1); });
    var x0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1)); x0 = null; });
  };
  // open(Element) oder open(Nummer)
  var open = function (which) {
    gal = all();
    if (!gal.length) return;
    var i = typeof which === 'number' ? which : gal.indexOf(which);
    if (i < 0) { gal.unshift(which); i = 0; }
    if (!box) build();
    box.classList.toggle('one', gal.length < 2);
    show(i);
    if (!box.open) box.showModal();
  };
  window.V3Bilder = { open: open };

  // Bilder in Texten zeigen, dass man sie anklicken kann
  document.querySelectorAll('.prose img').forEach(function (img) { if (pick(img) === img) img.classList.add('lb-zoom'); });

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || editing()) return;
    var n = pick(e.target);
    if (!n) return;
    e.preventDefault();
    open(n);
  });
})();
