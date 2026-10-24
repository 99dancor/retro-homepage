// Systemsteuerung: Anzeige und Sounds öffnen die Fenster neben der Uhr auf dem Desktop, ▲▼ sortiert die Spiele,
// höchstens vier 📌 für die Vitrine. Nach dem Speichern der Desktop-Einstellungen lädt der Desktop seine Symbole neu.
(function () {
  'use strict';
  var root = document.getElementById('cpl');
  if (!root) return;
  function top() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-panel]');
    if (b) {
      var t = top(), btn = t && t.document.getElementById(b.dataset.panel);
      if (btn) { e.stopPropagation(); btn.click(); } else alert('Das geht über die Knöpfe neben der Uhr unten rechts.');
      return;
    }
    var m = e.target.closest('[data-move]');
    if (m) {
      var g = m.closest('.stat-game'), dir = Number(m.dataset.move);
      var sib = dir < 0 ? g.previousElementSibling : g.nextElementSibling;
      if (sib) g.parentNode.insertBefore(g, dir < 0 ? sib : sib.nextElementSibling);
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.name !== 'pin' || !e.target.checked) return;
    var on = root.querySelectorAll('input[name=pin]:checked');
    if (on.length > 4) { e.target.checked = false; alert('In die Vitrine passen höchstens vier Werte.'); }
  });
  // Nach dem Speichern: Desktop frisch laden (die Seite kommt mit ?ok zurück)
  if (/[?&]ok/.test(location.search) && document.querySelector('[data-desk-refresh]')) {
    var t = top();
    try { if (t && t.RetroDesk && t.RetroDesk.refreshIcons) t.RetroDesk.refreshIcons(); } catch (err) { /* egal */ }
  }
})();
