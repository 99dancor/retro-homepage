// Formular eines Dioramas (views/v3/diorama-edit.ejs): Felder je Art zeigen, Bilder sortieren und entfernen, neue Bilder mit
// Vorschau (auch per Hineinziehen), Steckbrief- und Mod-Zeilen, Nummern auf dem Lageplan setzen.
(function () {
  'use strict';
  var form = document.getElementById('di-form');
  if (!form) return;

  // ---------- Art: Spielstand oder Bauwerk ----------
  var kind = function () { var r = form.querySelector('input[name=kind]:checked'); return r ? r.value : 'spielstand'; };
  var showKind = function () {
    var k = kind();
    form.querySelectorAll('[data-only]').forEach(function (el) { el.hidden = el.getAttribute('data-only') !== k; });
    form.querySelectorAll('.typsel label').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); });
  };
  form.querySelectorAll('input[name=kind]').forEach(function (r) { r.addEventListener('change', showKind); });
  showKind();

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

  // ---------- Lageplan: Nummern setzen ----------
  var plan = document.getElementById('di-plan'), pinsInput = document.getElementById('di-pins'), pick = document.getElementById('di-pick');
  if (plan && pinsInput && pick) {
    var pins = {};
    try { pins = JSON.parse(pinsInput.value || '{}') || {}; } catch (x) { pins = {}; }
    var current = null;
    var choose = function (id) {
      current = id;
      pick.querySelectorAll('[data-kid]').forEach(function (b) { b.classList.toggle('pri', b.getAttribute('data-kid') === id); });
      plan.classList.toggle('armed', !!id);
    };
    var draw = function (id) {
      var el = plan.querySelector('[data-pin="' + id + '"]'), p = pins[id];
      el.hidden = !p;
      if (p) { el.style.left = p[0] + '%'; el.style.top = p[1] + '%'; }
      pick.querySelector('[data-kid="' + id + '"] .set').hidden = !p;
      pinsInput.value = JSON.stringify(pins);
    };
    pick.addEventListener('click', function (e) {
      var b = e.target.closest('[data-kid]');
      if (!b) return;
      var id = b.getAttribute('data-kid');
      if (current === id && pins[id]) { delete pins[id]; draw(id); choose(null); return; }
      choose(id);
    });
    plan.addEventListener('click', function (e) {
      if (!current) return;
      var img = plan.querySelector('img'), r = img.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      pins[current] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
      draw(current);
      // Weiter zum nächsten Bauwerk ohne Nummer
      var next = Array.prototype.find.call(pick.querySelectorAll('[data-kid]'), function (b) { return !pins[b.getAttribute('data-kid')]; });
      choose(next ? next.getAttribute('data-kid') : null);
    });
  }
})();
