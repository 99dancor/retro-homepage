// Explorer (Eigene Dateien): Auswählen (Klick, Strg/Umschalt+Klick), Doppelklick öffnet, Rechtsklick fürs Menü,
// Ziehen auf einen Ordner im Baum verschiebt, Entf legt in den Papierkorb, F2 benennt um. Die Seite lädt danach neu.
(function () {
  'use strict';
  var root = document.getElementById('explorer');
  if (!root || !window.WinUI || !window.DeskUI) return;
  var W = window.WinUI, D = window.DeskUI;
  var view = root.dataset.view, here = root.dataset.folder === '' ? null : Number(root.dataset.folder);
  var rows = [].slice.call(root.querySelectorAll('[data-ref]'));
  var selected = [], last = null;
  var statusEl = root.querySelector('[data-status]'), statusText = statusEl ? statusEl.textContent : '';

  function entry(el) {
    var d = el.dataset, m = /^([a-z]+):(\d+)$/.exec(d.ref);
    var e = { ref: d.ref, kind: d.kind, name: d.name, url: d.url, vis: d.vis, el: el, lib: m && m[1] !== 'd', id: m ? Number(m[2]) : null };
    if (d.external) { e.external = true; e.host = d.host; }
    if (d.icon) e.icon = d.icon;
    if (d.token) e.share = { vis: d.share, token: d.token };
    if (el.classList.contains('broken')) e.broken = true;
    return e;
  }
  function reload() { var d = W.desk(); if (d && d.refreshIcons) d.refreshIcons(); location.reload(); }
  function sync() {
    rows.forEach(function (r) { r.classList.toggle('sel', selected.indexOf(r) >= 0); r.setAttribute('aria-selected', selected.indexOf(r) >= 0); });
    var n = selected.length, own = selected.filter(function (r) { return !r.dataset.sys; });
    root.querySelectorAll('[data-ex=delete], [data-ex=move]').forEach(function (b) { b.disabled = !own.length; });
    root.querySelectorAll('[data-ex=restore], [data-ex=purge]').forEach(function (b) { b.disabled = !n; });
    var props = root.querySelector('[data-ex=props]');
    if (props) props.disabled = view === 'folder' ? !(n === 1 || (!n && here)) : n !== 1;
    if (statusEl) statusEl.textContent = n ? n + ' Objekt(e) markiert' : statusText;
  }
  function select(el, e) {
    if (e && (e.ctrlKey || e.metaKey)) {
      var i = selected.indexOf(el);
      if (i >= 0) selected.splice(i, 1); else selected.push(el);
    } else if (e && e.shiftKey && last) {
      var a = rows.indexOf(last), b = rows.indexOf(el);
      selected = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else selected = el ? [el] : [];
    if (el) last = el;
    sync();
  }
  function current() { return selected.map(entry); }
  function openEl(el) { var e = entry(el); if (e.kind === 'folder') location.href = '/eigene-dateien?ordner=' + e.id; else D.open(e); }

  // Klicks: Mit der Maus wählt ein Klick aus, ein Doppelklick öffnet; auf dem Handy öffnet schon das Antippen
  var touch = false;
  root.addEventListener('pointerdown', function (e) { touch = e.pointerType !== 'mouse'; }, true);
  rows.forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('form, input, select, button')) return;
      var a = e.target.closest('a');
      if (view === 'trash') { select(el, e); return; }
      if (touch && a) { e.preventDefault(); openEl(el); return; }
      if (a) e.preventDefault();
      select(el, e);
    });
    el.addEventListener('dblclick', function (e) { if (view !== 'trash' && !e.target.closest('form')) openEl(el); });
    el.addEventListener('contextmenu', function (e) {
      if (e.target.closest('input, select, textarea')) return;
      e.preventDefault();
      if (selected.indexOf(el) < 0) select(el);
      menu(e.clientX, e.clientY);
    });
  });
  var pane = root.querySelector('.ex-pane');
  pane.addEventListener('click', function (e) { if (!e.target.closest('[data-ref], form, a, button')) select(null); });
  pane.addEventListener('contextmenu', function (e) {
    if (e.target.closest('[data-ref], input, select, textarea, a')) return;
    e.preventDefault();
    select(null);
    menu(e.clientX, e.clientY);
  });
  // Langes Drücken auf dem Handy = Rechtsklick
  var pressTimer = 0;
  pane.addEventListener('touchstart', function (e) {
    var el = e.target.closest('[data-ref]'), t = e.touches[0];
    clearTimeout(pressTimer);
    pressTimer = setTimeout(function () { if (el) select(el); else select(null); menu(t.clientX, t.clientY); }, 550);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(function (ev) { pane.addEventListener(ev, function () { clearTimeout(pressTimer); }, { passive: true }); });

  function menu(x, y) {
    var es = current(), one = es.length === 1 ? es[0] : null, items;
    if (view === 'trash') {
      items = es.length ? [{ label: 'Wiederherstellen', act: 'restore', bold: true }, '-', { label: 'Endgültig löschen', act: 'purge' }] : [{ label: 'Papierkorb leeren', act: 'empty', disabled: !rows.length }];
    } else if (!es.length) {
      items = [];
      if (view === 'folder') items.push({ label: 'Neu', sub: D.newMenu() }, '-');
      if (view === 'folder' && root.dataset.upload) items.push({ label: 'Datei hochladen…', act: 'upload' });
      items.push({ label: 'Aktualisieren', act: 'reload' });
      if (view === 'folder' && here) items.push('-', { label: 'Eigenschaften', act: 'folderprops' });
    } else {
      items = [{ label: one && one.kind === 'folder' ? 'Öffnen' : 'Öffnen', act: 'open', bold: true, disabled: !one }];
      if (one && one.external) items.push({ label: 'Adresse kopieren', act: 'copy' });
      items.push('-', { label: 'Verschieben nach…', act: 'move' }, '-', { label: 'Löschen', act: 'delete' });
      if (one && !one.lib) items.push({ label: 'Umbenennen', act: 'rename' });
      if (one && !one.lib) items.push('-', { label: 'Eigenschaften', act: 'props' });
    }
    W.contextMenu(x, y, items, act);
  }
  function act(a) {
    var es = current(), one = es[0];
    if (a.indexOf('new:') === 0) {
      return D.newEntry(a.slice(4), here || 0).then(function (it) {
        if (!it) return;
        if (it.kind === 'text' && W.desk()) D.openUrl(it.url, false);
        reload();
      });
    }
    switch (a) {
      case 'open': if (selected[0]) openEl(selected[0]); break;
      case 'copy': if (navigator.clipboard) navigator.clipboard.writeText(one.url); break;
      case 'move': D.moveTo(es, view === 'lib').then(function (ok) { if (ok) reload(); }); break;
      case 'delete': D.remove(es).then(function (ok) { if (ok) reload(); }); break;
      case 'rename':
        W.dialog('Umbenennen', '<label>Neuer Name:<input type="text" name="name" class="w100" maxlength="60" value="' + W.esc(one.name) + '"></label>',
          [{ label: 'OK', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
          if (r.value === 'ok') D.rename(one, r.form.name.trim()).then(function (it) { if (it) reload(); });
        });
        break;
      case 'props': D.properties(one).then(function (it) { if (it) reload(); }); break;
      case 'folderprops': folderProps(); break;
      case 'upload': location.href = '/files/upload?ordner=' + (here || 0); break;
      case 'reload': location.reload(); break;
      case 'restore': W.api('POST', '/api/desktop/wiederherstellen', { refs: es.map(function (e) { return e.ref; }) }).then(reload, oops); break;
      case 'purge':
        W.confirm((es.length === 1 ? '„' + one.name + '“' : es.length + ' Objekte') + ' endgültig löschen? Das lässt sich nicht rückgängig machen.', '⚠️', 'Endgültig löschen', 'Endgültig löschen')
          .then(function (ok) { if (ok) W.api('POST', '/api/desktop/endgueltig', { refs: es.map(function (e) { return e.ref; }) }).then(reload, oops); });
        break;
      case 'empty':
        W.confirm('Alles im Papierkorb endgültig löschen? Das lässt sich nicht rückgängig machen.', '🗑️', 'Papierkorb leeren', 'Papierkorb leeren')
          .then(function (ok) { if (ok) W.api('POST', '/api/desktop/papierkorb-leeren').then(reload, oops); });
        break;
    }
  }
  function oops(e) { W.msgbox(e.message, '⚠️'); }
  // Eigenschaften des offenen Ordners (Werkzeugleiste, ohne Auswahl)
  function folderProps() {
    if (!root.dataset.entry) return;
    D.properties(JSON.parse(root.dataset.entry)).then(function (it) { if (it) reload(); }, oops);
  }

  // Werkzeugleiste
  root.querySelector('.ex-toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ex]');
    if (!b) return;
    var x = b.dataset.ex;
    if (x === 'back') history.back();
    else if (x === 'up') {
      if (view === 'folder' && here) location.href = '/eigene-dateien?ordner=' + (Number(root.dataset.parent) || 0);
      else location.href = '/eigene-dateien';
    } else if (x === 'new') { var r = b.getBoundingClientRect(); W.contextMenu(r.left, r.bottom, D.newMenu(), act); }
    else if (x === 'tree') { var open = root.classList.toggle('tree-open'); b.setAttribute('aria-expanded', open); }
    else if (x === 'props') { if (selected.length === 1) act('props'); else if (view === 'folder' && here) folderProps(); }
    else act(x);
  });

  // Tastatur
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === 'Delete' && selected.length) { e.preventDefault(); act(view === 'trash' ? 'purge' : 'delete'); }
    else if (e.key === 'F2' && selected.length === 1 && view !== 'trash') { e.preventDefault(); act('rename'); }
    else if (e.key === 'Enter' && selected.length === 1 && view !== 'trash') { e.preventDefault(); openEl(selected[0]); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && rows.length) { e.preventDefault(); selected = rows.slice(); sync(); }
  });

  // Ziehen auf einen Ordner (im Baum, in der Liste oder auf die Kacheln) verschiebt, auf den Papierkorb löscht
  var dragging = null;
  rows.forEach(function (el) {
    if (!el.draggable) return;
    el.addEventListener('dragstart', function (e) {
      if (selected.indexOf(el) < 0) select(el);
      dragging = current();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragging.map(function (d) { return d.name; }).join('\n'));
    });
    el.addEventListener('dragend', function () { dragging = null; root.querySelectorAll('.drop-on').forEach(function (d) { d.classList.remove('drop-on'); }); });
  });
  root.querySelectorAll('[data-drop]').forEach(function (t) {
    t.addEventListener('dragover', function (e) {
      if (!dragging || dragging.some(function (d) { return d.el === t; })) return;
      e.preventDefault(); t.classList.add('drop-on');
    });
    t.addEventListener('dragleave', function () { t.classList.remove('drop-on'); });
    t.addEventListener('drop', function (e) {
      e.preventDefault(); t.classList.remove('drop-on');
      if (!dragging) return;
      var to = t.dataset.drop, list = dragging;
      dragging = null;
      if (to === 'papierkorb') return D.remove(list).then(function (ok) { if (ok) reload(); });
      W.api('POST', '/api/desktop/verschieben', { refs: list.map(function (d) { return d.ref; }), folder: Number(to) || 0 })
        .then(function (r) { if (r.error) W.msgbox(r.error, '⚠️'); reload(); }, oops);
    });
  });
  sync();
})();
