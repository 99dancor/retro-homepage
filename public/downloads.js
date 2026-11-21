// Dancors Downloads (views/v3/downloads.ejs): Sortierung wechseln und der Bearbeiten-Modus der Projektkarten
// (über public/v3-edit.js): ziehen, anpinnen, ausblenden, Titel und Text direkt ändern, Symbol, Farbe und Bild.
(function () {
  'use strict';
  // Sortierung: Die Auswahl enthält die fertigen Adressen
  document.querySelectorAll('select[data-go]').forEach(function (s) {
    s.addEventListener('change', function () { location.href = s.value; });
  });

  var dataEl = document.getElementById('dl-edit');
  if (!dataEl || !window.V3Edit) return;
  var data = JSON.parse(dataEl.textContent || '{}');
  var root = document.querySelector('[data-ed-root]');

  function showPin(item, on) {
    var flag = item.querySelector('.flag-b.pin');
    if (flag) flag.hidden = !on;
    item.classList.toggle('pinned', !!on);
  }
  document.querySelectorAll('.pc[data-ed-item]').forEach(function (it) { showPin(it, window.V3Edit.val(it).pin); });

  // 📌 Anpinnen und Lösen: gehört zu den Werten der Karte, Rückgängig nimmt es mit
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

  window.V3Edit.page({
    save: '/downloads/seite',
    upload: '/api/schreiben/bild',
    hint: 'Projekte ziehen, anpinnen oder ausblenden. Titel und Text anklicken und ändern, mit 🎨 Symbol, Farbe und Bild.',
    props: {
      cards: [{ name: 'icon', label: 'Symbol', max: 8 }, { name: 'color', label: 'Farbe', type: 'select', options: data.colors || [] },
        { name: 'cover', label: 'Bild', hint: 'ersetzt das Symbol', type: 'image' }],
    },
    propsTitle: function (item) { var t = item.querySelector('[data-ed-text="title"]'); return (t ? t.textContent : '') || 'Projekt'; },
    applyProps: function (item, v) {
      var art = item.querySelector('.art');
      if (!art) return;
      art.className = art.className.replace(/\bc-\S+/, 'c-' + (v.color || 'dl'));
      art.innerHTML = '';
      if (v.cover) { var img = document.createElement('img'); img.src = v.cover; img.alt = ''; art.appendChild(img); }
      else { var s = document.createElement('span'); s.className = 'emo'; s.textContent = v.icon || '📦'; art.appendChild(s); }
    },
    collect: function (d, el) {
      var pick = function (name, def) { var r = el.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : def; };
      var cards = (d.lists.cards || []);
      return { layout: {
        title: d.texts.title, text: d.texts.text,
        start: pick('ed-start', 'projekte'), look: pick('ed-look', 'gross'), more: !!d.fields.more,
        order: cards.map(function (c) { return c.key; }),
        hidden: cards.filter(function (c) { return c.hidden; }).map(function (c) { return c.key; }),
        cards: cards.filter(function (c) { return c.key !== 'hub'; }).map(function (c) {
          return { key: c.key, title: c.title, summary: c.summary, icon: c.icon, color: c.color, cover: c.cover, pin: !!c.pin };
        }),
      } };
    },
  });
})();
