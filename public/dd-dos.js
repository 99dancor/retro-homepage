// DOS-Spiele der Daddelecke: js-dos (npm js-dos, ausgeliefert unter /vendor/js-dos) startet das .jsdos-Paket des Spiels.
// Die Emulatoren kommen von dieser Seite, nicht aus dem Netz. Spielstände hält js-dos im Browser (IndexedDB).
(function () {
  'use strict';
  var el = document.getElementById('spiel');
  if (!el || !window.Dos) return;
  window.Dos(el, {
    url: el.getAttribute('data-file'), pathPrefix: '/vendor/js-dos/emulators/', autoStart: true, noCloud: true,
    kiosk: false, thinSidebar: true, theme: 'dark', mouseCapture: false,
  });
})();
