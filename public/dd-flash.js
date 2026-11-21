// Flash-Spiele der Daddelecke: Ruffle (npm @ruffle-rs/ruffle, ausgeliefert unter /vendor/ruffle) spielt die .swf ab.
(function () {
  'use strict';
  var el = document.getElementById('spiel');
  var R = window.RufflePlayer;
  if (!el || !R) return;
  R.config = { publicPath: '/vendor/ruffle/', autoplay: 'on', unmuteOverlay: 'visible', letterbox: 'on', contextMenu: 'rightClickOnly', showSwfDownload: false, splashScreen: true };
  var player = R.newest().createPlayer();
  player.style.width = '100%';
  player.style.height = '100%';
  el.appendChild(player);
  player.ruffle ? player.ruffle().load(el.getAttribute('data-file')) : player.load(el.getAttribute('data-file'));
})();
