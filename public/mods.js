// Modlisten: Kategorien ein- und ausklappen (gemerkt pro Besucher), Zeilen-Editor für Listen und Vorschläge.
// Der Editor schickt alles als JSON im versteckten Feld „data“, der Server prüft es noch einmal (src/modlists.js).
(function () {
  'use strict';
  var root = document.getElementById('ml');
  if (!root) return;

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }

  // ---------- Ansicht: Kategorien auf und zu ----------
  var listId = root.getAttribute('data-list');
  var cats = $$('details.ml-cat');
  var allBtn = root.querySelector('[data-ml-all]');
  if (listId && cats.length) {
    var KEY = 'modliste:' + listId;
    var closed = store(KEY) || {};
    cats.forEach(function (d) {
      if (closed[d.getAttribute('data-cat')]) d.open = false;
      d.addEventListener('toggle', function () {
        closed = store(KEY) || {};
        if (d.open) delete closed[d.getAttribute('data-cat')]; else closed[d.getAttribute('data-cat')] = 1;
        store(KEY, closed);
        syncAll();
      });
    });
    var syncAll = function () {
      if (!allBtn) return;
      var allOpen = cats.every(function (d) { return d.open; });
      allBtn.textContent = allOpen ? '⊟ Alle zuklappen' : '⊞ Alle aufklappen';
    };
    if (allBtn) {
      allBtn.hidden = false;
      allBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var open = !cats.every(function (d) { return d.open; });
        cats.forEach(function (d) { d.open = open; });
      });
      syncAll();
    }
  }

  // „Übernehmen“: immer nur ein Menü offen, Klick daneben schließt es
  var takes = $$('details.ml-take');
  takes.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) takes.forEach(function (o) { if (o !== d) o.open = false; });
    });
  });
  document.addEventListener('click', function (e) {
    takes.forEach(function (d) { if (d.open && !d.contains(e.target)) d.open = false; });
  });

  // ---------- Editor (Liste und Vorschläge) ----------
  var form = root.querySelector('[data-ml-form]');
  if (!form) return;
  var isList = form.getAttribute('data-ml-form') === 'list';
  var status = document.querySelector('[data-ml-status]');
  var dirty = false;

  function tpl(name) {
    var t = root.querySelector(name ? 'template[data-ml-tpl="' + name + '"]' : 'template[data-ml-tpl]');
    return t.content.firstElementChild.cloneNode(true);
  }
  function rowsOf(box) { return $$('.ml-edrow:not(.ml-lbls)', box); }
  function addRow(box, after) {
    var row = tpl(isList ? 'row' : '');
    var add = box.querySelector('.ml-addrow');
    box.insertBefore(row, after ? after.nextSibling : add);
    guestToRow(row);
    changed();
    return row;
  }
  function focusField(row, f) { var el = row && row.querySelector('[data-f="' + (f || 'name') + '"]'); if (el) el.focus(); }

  function changed(init) {
    if (!init) dirty = true;
    if (isList) {
      $$('[data-ml-cat]').forEach(function (c) {
        var n = rowsOf(c).length, count = c.querySelector('[data-ml-count]');
        count.textContent = c.classList.contains('folded') ? n + (n === 1 ? ' Mod' : ' Mods') + ', eingeklappt' : '';
      });
    }
    if (status) {
      var mods = rowsOf(root).filter(function (r) { return r.querySelector('[data-f="name"]').value.trim(); }).length;
      var c = isList ? $$('[data-ml-cat]').length : 0;
      status.textContent = (isList ? 'Bearbeiten · ' : 'Vorschläge · ') + mods + (mods === 1 ? ' Mod' : ' Mods') +
        (c > 1 ? ' in ' + c + ' Kategorien' : '') + (init ? '' : ' · ungespeichert');
    }
  }
  form.addEventListener('input', function () { if (!dirty) changed(); dirty = true; });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // Links ohne https:// davor ergänzen, sonst lehnt der Browser das Feld ab
  form.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute('data-f') === 'url' && el.value.trim() && !/^https?:\/\//i.test(el.value.trim())) el.value = 'https://' + el.value.trim().replace(/^\/+/, '');
    if (el.getAttribute('data-f') === 'name') changed();
  });

  // Rückgängig nach dem Entfernen (Zeile oder Kategorie)
  var undo = null, undoBar = document.createElement('div');
  undoBar.className = 'ml-undo';
  undoBar.hidden = true;
  undoBar.innerHTML = '<span></span><button type="button" class="small">↶ Rückgängig</button>';
  form.appendChild(undoBar);
  var undoTimer = null;
  function removed(el, what) {
    undo = { el: el, parent: el.parentNode, next: el.nextSibling };
    el.parentNode.removeChild(el);
    undoBar.firstChild.textContent = what + ' entfernt.';
    undoBar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { undoBar.hidden = true; undo = null; }, 8000);
    changed();
  }
  undoBar.lastChild.addEventListener('click', function () {
    if (!undo) return;
    var add = undo.parent.querySelector(':scope > .ml-addrow');
    undo.parent.insertBefore(undo.el, undo.next && undo.next.parentNode === undo.parent ? undo.next : add);
    undo = null;
    undoBar.hidden = true;
    changed();
  });
  function label(row) { var n = row.querySelector('[data-f="name"]').value.trim(); return n ? '„' + n + '“' : 'Leere Zeile'; }

  form.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-ml-del')) {
      var row = b.closest('.ml-edrow');
      removed(row, label(row));
    } else if (b.hasAttribute('data-ml-add')) {
      focusField(addRow(b.closest('[data-ml-rows]')));
    } else if (b.hasAttribute('data-ml-addcat')) {
      var cat = tpl('cat');
      root.querySelector('[data-ml-cats]').appendChild(cat);
      changed();
      focusField(cat, 'cat');
    } else if (b.hasAttribute('data-ml-delcat')) {
      var box = b.closest('[data-ml-cat]');
      var name = box.querySelector('[data-f="cat"]').value.trim();
      removed(box, name ? 'Kategorie „' + name + '“' : 'Kategorie');
      if (!$$('[data-ml-cat]').length) root.querySelector('[data-ml-cats]').appendChild(tpl('cat'));
    } else if (b.hasAttribute('data-ml-fold')) {
      b.closest('[data-ml-cat]').classList.toggle('folded');
      changed();
    }
  });

  // Enter in einer Zeile: zur nächsten Zeile, in der letzten Zeile gibt es eine neue
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
    var el = e.target, row = el.closest && el.closest('.ml-edrow');
    if (el.getAttribute('data-f') === 'cat') { e.preventDefault(); var first = rowsOf(el.closest('[data-ml-cat]'))[0]; focusField(first || addRow(el.closest('[data-ml-cat]').querySelector('[data-ml-rows]'))); return; }
    if (!row || el.type === 'checkbox') return;
    e.preventDefault();
    var box = row.parentNode, rows = rowsOf(box), i = rows.indexOf(row);
    var f = el.getAttribute('data-f');
    if (i < rows.length - 1) focusField(rows[i + 1], f);
    else if (row.querySelector('[data-f="name"]').value.trim()) focusField(addRow(box, row));
  });

  // ---------- Ziehen zum Verschieben (Zeilen auch in andere Kategorien) ----------
  var drag = null;
  form.addEventListener('pointerdown', function (e) {
    var h = e.target.closest('[data-ml-drag]');
    if (!h || e.button !== 0) return;
    e.preventDefault();
    var kind = h.getAttribute('data-ml-drag');
    drag = { kind: kind, el: kind === 'row' ? h.closest('.ml-edrow') : h.closest('[data-ml-cat]') };
    drag.el.classList.add('ml-dragging');
    h.setPointerCapture(e.pointerId);
  });
  form.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under || drag.el.contains(under)) return;
    if (drag.kind === 'row') {
      var row = under.closest('.ml-edrow:not(.ml-lbls)');
      if (row && row.parentNode) {
        var r = row.getBoundingClientRect();
        row.parentNode.insertBefore(drag.el, e.clientY < r.top + r.height / 2 ? row : row.nextSibling);
        return;
      }
      var box = under.closest('[data-ml-cat]');
      if (box && !box.classList.contains('folded')) {
        var rows = box.querySelector('[data-ml-rows]');
        if (under.closest('.ml-cat-title, .ml-lbls')) rows.insertBefore(drag.el, rows.querySelector('.ml-lbls').nextSibling);
        else rows.insertBefore(drag.el, rows.querySelector('.ml-addrow'));
      }
    } else {
      var cat = under.closest('[data-ml-cat]');
      if (!cat) return;
      var c = cat.getBoundingClientRect();
      cat.parentNode.insertBefore(drag.el, e.clientY < c.top + c.height / 2 ? cat : cat.nextSibling);
    }
  });
  function endDrag() { if (drag) { drag.el.classList.remove('ml-dragging'); drag = null; changed(); } }
  form.addEventListener('pointerup', endDrag);
  form.addEventListener('pointercancel', endDrag);

  // ---------- Aus Text einfügen ----------
  var pasteLink = root.querySelector('[data-ml-paste]'), dlg = root.querySelector('[data-ml-pastedlg]');
  if (pasteLink && dlg && dlg.showModal) {
    pasteLink.hidden = false;
    pasteLink.addEventListener('click', function (e) { e.preventDefault(); dlg.showModal(); dlg.querySelector('textarea').focus(); });
    $$('[data-ml-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
    dlg.querySelector('[data-ml-pasteok]').addEventListener('click', function () {
      var ta = dlg.querySelector('textarea');
      var boxes = $$('[data-ml-cat]'), box = boxes[boxes.length - 1];
      ta.value.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var head = /^#+\s*(.*)$/.exec(line);
        if (head) {
          var empty = rowsOf(box).every(function (r) { return !r.querySelector('[data-f="name"]').value.trim(); }) && !box.querySelector('[data-f="cat"]').value.trim();
          if (!empty) { box = tpl('cat'); root.querySelector('[data-ml-cats]').appendChild(box); }
          box.querySelector('[data-f="cat"]').value = head[1];
          return;
        }
        var on = /^(✔|✓|\[x\])\s*/i.exec(line);
        if (on) line = line.slice(on[0].length);
        var p = line.replace(/^\*\s*/, '').split('|').map(function (s) { return s.trim(); });
        if (!p[0]) return;
        var rows = rowsOf(box), last = rows[rows.length - 1];
        var row = last && !last.querySelector('[data-f="name"]').value.trim() ? last : addRow(box.querySelector('[data-ml-rows]'));
        row.querySelector('[data-f="name"]').value = p[0];
        row.querySelector('[data-f="url"]').value = p[1] && !/^https?:\/\//i.test(p[1]) ? 'https://' + p[1] : (p[1] || '');
        row.querySelector('[data-f="notes"]').value = p.slice(2).filter(Boolean).join(' · ');
        row.querySelector('[data-f="on_server"]').checked = !!on;
      });
      ta.value = '';
      dlg.close();
      changed();
    });
  }

  // ---------- Vorschläge: Name des Gastes ----------
  var guest = form.querySelector('[data-ml-guest]');
  function guestToRow(row) {
    if (!guest) return;
    var who = row.querySelector('.ml-who');
    if (who && !row.hasAttribute('data-id')) who.textContent = (guest.value.trim() || 'Gast') + ' (Gast)';
  }
  if (guest) {
    guest.value = store('modliste-gast') || '';
    guest.addEventListener('input', function () { rowsOf(root).forEach(guestToRow); });
    rowsOf(root).forEach(guestToRow);
  }
  // Beim Vorschlagen gleich eine leere Zeile bereitstellen
  if (!isList) {
    var box = form.querySelector('[data-ml-rows]');
    var fresh = addRow(box);
    dirty = false;
    if (guest && !guest.value) guest.focus(); else focusField(fresh);
  }

  // ---------- Speichern ----------
  form.addEventListener('submit', function () {
    var val = function (row, f) { return row.querySelector('[data-f="' + f + '"]').value.trim(); };
    var data;
    if (isList) {
      data = { categories: $$('[data-ml-cat]').map(function (c) {
        return { name: val(c, 'cat'), rows: rowsOf(c).filter(function (r) { return val(r, 'name'); }).map(function (r) {
          return { name: val(r, 'name'), url: val(r, 'url'), notes: val(r, 'notes'), on_server: r.querySelector('[data-f="on_server"]').checked };
        }) };
      }) };
    } else {
      data = { rows: rowsOf(root).filter(function (r) { return val(r, 'name'); }).map(function (r) {
        return { id: Number(r.getAttribute('data-id')) || 0, name: val(r, 'name'), url: val(r, 'url'), notes: val(r, 'notes') };
      }) };
      if (guest) store('modliste-gast', guest.value.trim());
    }
    form.querySelector('input[name="data"]').value = JSON.stringify(data);
    dirty = false;
  });

  if (isList) changed(true);
  dirty = false;
})();
