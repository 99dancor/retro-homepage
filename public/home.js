// Startseite: Reiter der Neuigkeiten (Alles, Blog, Forum, Downloads, Besucherbuch). „Alles“ zeigt die acht neuesten,
// ein Reiter alles von seiner Art, dazu unten der Link zur ganzen Liste. Ohne JavaScript steht „Alles“ da.
(function () {
  'use strict';
  var bar = document.querySelector('[data-feed-tabs]'), list = document.querySelector('[data-feed-list]');
  if (!bar || !list) return;
  var tabs = [].slice.call(bar.querySelectorAll('[role=tab]'));
  function show(t, focus) {
    var kind = t.dataset.feed;
    tabs.forEach(function (b) { var on = b === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    [].forEach.call(list.children, function (li) { li.hidden = kind ? li.dataset.kind !== kind : !li.hasAttribute('data-top'); });
    document.querySelectorAll('[data-more]').forEach(function (a) { a.hidden = a.dataset.more !== kind; });
    if (focus) t.focus();
  }
  tabs.forEach(function (b, i) {
    b.addEventListener('click', function () { show(b); });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
})();
