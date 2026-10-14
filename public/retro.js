// Startmenü und Uhr in der Taskleiste
(function () {
  var btn = document.getElementById('startbtn'), menu = document.getElementById('startmenu');
  if (btn && menu) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); btn.setAttribute('aria-expanded', false); });
  }
  var clock = document.getElementById('clock');
  function tick() { if (clock) clock.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
  tick(); setInterval(tick, 10000);

  // Bestätigung für Löschen-Buttons
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    el.addEventListener('submit', function (e) { if (!confirm(el.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // Sichtbarkeit: Gruppenauswahl nur zeigen, wenn "Nur bestimmte Gruppen" gewählt ist
  document.querySelectorAll('select[name=visibility]').forEach(function (sel) {
    var box = sel.form && sel.form.querySelector('.group-pick');
    function upd() { if (box) box.style.display = sel.value === 'groups' ? '' : 'none'; }
    sel.addEventListener('change', upd); upd();
  });
})();
