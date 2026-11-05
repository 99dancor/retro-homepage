// Changelog (views/changelog.ejs): Suche in den Einträgen. Jede Überschrift samt Punkten darunter ist ein Update;
// Treffer im Titel, in der Nummer („83“) oder im Text lassen es stehen, der Rest wird ausgeblendet.
(function () {
  'use strict';
  var box = document.getElementById('changelog'), q = document.getElementById('cl-q'), out = document.getElementById('cl-n');
  if (!box || !q) return;
  var groups = [], cur = null;
  [].slice.call(box.children).forEach(function (el) {
    if (el.tagName === 'H2') { cur = { head: el, els: [el], text: '' }; groups.push(cur); }
    else if (cur) cur.els.push(el);
  });
  groups.forEach(function (g) { g.text = fold(g.els.map(function (e) { return e.textContent; }).join(' ')); });
  function fold(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss'); }
  q.closest('.cl-search').hidden = false;
  q.addEventListener('input', function () {
    var words = fold(q.value).split(/\s+/).filter(Boolean), n = 0;
    groups.forEach(function (g) {
      var on = words.every(function (w) { return /^\d+$/.test(w) ? g.head.id === 'update-' + w || g.text.indexOf(w) >= 0 : g.text.indexOf(w) >= 0; });
      g.els.forEach(function (e) { e.hidden = !on; });
      if (on) n++;
    });
    out.textContent = words.length ? (n === 1 ? '1 Update' : n + ' Updates') : '';
  });
})();
