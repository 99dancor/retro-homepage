// Eckdaten eines Spielstands (views/v3/diorama-edit.ejs): Bilder sortieren und entfernen, neue Bilder mit Vorschau
// (auch per Hineinziehen), Steckbrief- und Mod-Zeilen.
(function () {
  'use strict';
  var form = document.getElementById('di-form');
  if (!form) return;

  // ---------- Zeilen für Steckbrief und Mods ----------
  form.addEventListener('click', function (e) {
    var add = e.target.closest('[data-row-add]');
    if (add) {
      var box = document.getElementById(add.getAttribute('data-row-add')), last = box.lastElementChild;
      if (!last) return;
      var row = last.cloneNode(true);
      row.querySelectorAll('input').forEach(function (i) { i.value = ''; });
      box.appendChild(row);
      row.querySelector('input').focus();
      return;
    }
    var del = e.target.closest('[data-row-del]');
    if (del) {
      var r = del.parentElement;
      if (r.parentElement.children.length > 1) r.remove(); else r.querySelectorAll('input').forEach(function (i) { i.value = ''; });
    }
  });

  // ---------- Bilder ----------
  var grid = document.getElementById('di-imgs'), drop = document.getElementById('di-drop');
  var input = drop && drop.querySelector('input[type=file]');
  var picked = window.DataTransfer ? new DataTransfer() : null;
  var ensureCover = function () {
    if (!form.querySelector('input[name=cover]:checked')) { var first = form.querySelector('input[name=cover]'); if (first) first.checked = true; }
  };
  grid.addEventListener('click', function (e) {
    var b = e.target.closest('[data-img-del]');
    if (!b) return;
    var tile = b.closest('.up');
    if (tile.hasAttribute('data-new') && picked) {
      var idx = Array.prototype.indexOf.call(grid.querySelectorAll('[data-new]'), tile), next = new DataTransfer();
      Array.prototype.forEach.call(picked.files, function (f, i) { if (i !== idx) next.items.add(f); });
      picked = next; input.files = picked.files;
    }
    tile.remove();
    renumber(); ensureCover();
  });
  // Neue Bilder: Vorschau mit Unterschrift und Titelbild-Knopf. Mehrmals wählen sammelt (wenn der Browser es kann).
  var renumber = function () {
    grid.querySelectorAll('[data-new]').forEach(function (t, i) { t.querySelector('input[name=cover]').value = 'new:' + i; });
  };
  var addFiles = function (files) {
    Array.prototype.forEach.call(files, function (f) {
      if (!/^image\//.test(f.type)) return;
      if (picked) picked.items.add(f);
      var t = document.createElement('div');
      t.className = 'up'; t.setAttribute('data-new', '');
      t.innerHTML = '<img alt=""><label class="cv" title="Titelbild"><input type="radio" name="cover"> ★<span> Titelbild</span></label>'
        + '<span class="tb"><span class="newb">neu</span><button type="button" data-img-del title="Bild entfernen" aria-label="Bild entfernen">✕</button></span>'
        + '<input class="cap" type="text" name="new_cap" maxlength="120" placeholder="Unterschrift" aria-label="Unterschrift">';
      t.querySelector('img').src = URL.createObjectURL(f);
      grid.insertBefore(t, drop);
    });
    if (picked) input.files = picked.files;
    renumber(); ensureCover();
  };
  input.addEventListener('change', function () {
    // Ohne DataTransfer ersetzt jede Auswahl die vorige
    if (!picked) grid.querySelectorAll('[data-new]').forEach(function (t) { t.remove(); });
    var files = Array.prototype.slice.call(input.files);
    if (picked) { input.files = picked.files; }
    addFiles(files);
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); drop.classList.add('over'); } });
  });
  drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
  drop.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); drop.classList.remove('over');
    if (picked) addFiles(e.dataTransfer.files);
  });
  // Vorhandene Bilder ziehen zum Sortieren (neue bleiben hinten)
  var dragging = null;
  grid.addEventListener('dragstart', function (e) {
    var t = e.target.closest && e.target.closest('[data-img]');
    if (!t) return;
    dragging = t; t.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ''); } catch (x) { /* alt */ }
  });
  grid.addEventListener('dragover', function (e) {
    if (!dragging) return;
    var over = e.target.closest && e.target.closest('[data-img]');
    e.preventDefault();
    if (!over || over === dragging) return;
    var r = over.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) over.before(dragging); else over.after(dragging);
  });
  grid.addEventListener('dragend', function () { if (dragging) dragging.classList.remove('dragging'); dragging = null; });

})();
