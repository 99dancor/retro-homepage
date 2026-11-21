// Bearbeiten-Modus der Startseite (views/v3/portal.ejs) über den Baustein public/v3-edit.js:
// Begrüßung direkt ändern, Kacheln ziehen, ausblenden, über 🎨 Symbol, Farbe, Größe, „für wen“ und bei eigenen Kacheln die Adresse.
(function () {
  'use strict';
  if (!window.V3Edit) return;
  var COLORS = [['desk', 'Türkis'], ['dl', 'Blau'], ['du', 'Bernstein'], ['de', 'Rot'], ['fs', 'Grün'], ['x', 'Lila'], ['gray', 'Grau']];
  var base = [{ name: 'icon', label: 'Symbol', max: 8 }, { name: 'color', label: 'Farbe', type: 'select', options: COLORS },
    { name: 'show', label: 'Für wen', type: 'select', options: [['all', 'alle'], ['members', 'nur Mitglieder (Gäste sehen ein Schloss)']] },
    { name: 'wide', label: 'Breit (halbe Zeile statt ein Drittel)', type: 'check' }];
  window.V3Edit.page({
    save: '/startseite',
    hint: 'Überschrift und Kacheltexte anklicken und ändern, Kacheln ziehen, mit 🎨 Farbe und Größe, mit 🙈 ausblenden.',
    props: { tiles: function (item, v) { return v.builtin ? base : base.concat([{ name: 'url', label: 'Adresse', hint: '/seite oder https://…', max: 500 }]); } },
    propsTitle: function (item) { var t = item.querySelector('[data-ed-text="title"]'); return t ? t.textContent : 'Kachel'; },
    applyProps: function (item, v) {
      item.querySelectorAll('[data-show="icon"]').forEach(function (e) { e.textContent = v.icon || '⭐'; });
      item.className = item.className.replace(/\bc-\S+/, 'c-' + (v.color || 'x'));
      item.classList.toggle('wide', !!v.wide);
      if (!v.builtin && v.url) item.setAttribute('href', v.url);
    },
    collect: function (d) {
      return {
        title: d.texts.title, text: d.texts.text,
        tiles: (d.lists.tiles || []).map(function (t) {
          return { key: t.key, icon: t.icon, color: t.color, wide: !!t.wide, show: t.hidden ? 'off' : (t.show || 'all'), kicker: t.kicker || '', title: t.title, text: t.text, url: t.url };
        }),
      };
    },
  });
})();
