// Bearbeiten-Modus für die modernen Seiten (Version 3.0): Texte direkt auf der Seite ändern, Einträge ziehen, sortieren,
// ausblenden, löschen und über einen kleinen Dialog umbenennen. Der Baustein kennt nur Markierungen im HTML;
// was daraus gespeichert wird, sagt die Seite selbst über V3Edit.page({ … }) in ihrem eigenen Skript.
//
//   [data-ed-root]                      Bereich, der bearbeitet wird (einer je Seite)
//   [data-ed-start]                     Knopf „Seite bearbeiten“ (der Balken oben kommt von hier)
//   [data-ed-text="feld"]               Text, der im Modus direkt bearbeitbar ist
//   [data-ed-list="gruppe"]             Liste; Einträge [data-ed-item][data-key] lassen sich in alle Listen derselben Gruppe ziehen
//   [data-ed-handle]                    Griff, an dem ein Eintrag gezogen wird (sonst der ganze Eintrag)
//   [data-ed-up] [data-ed-down]         eins nach oben/unten   [data-ed-hide] ein-/ausblenden   [data-ed-del] löschen
//   [data-ed-props]                     Eigenschaften-Dialog; Felder aus page.props[gruppe], Werte in data-ed-val (JSON)
//   [data-ed-add="vorlage"]             fügt <template id="vorlage"> in die Liste davor (oder data-ed-into) ein
//   [data-ed-only]                      nur im Modus sichtbar        [data-ed-off] nur außerhalb des Modus sichtbar
//   Einstellungen im Modus: Felder [data-ed-field="name"] (input/select/checkbox) innerhalb des Bereichs
(function () {
  'use strict';
  var root = document.querySelector('[data-ed-root]');
  if (!root) { window.V3Edit = { page: function () {} }; return; }
  var body = document.body, csrf = body.getAttribute('data-csrf') || '';
  var page = null, undo = [], bar = null, dirty = false, drag = null;

  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function val(item) { try { return JSON.parse(item.getAttribute('data-ed-val') || '{}'); } catch (e) { return {}; } }
  function setVal(item, v) { item.setAttribute('data-ed-val', JSON.stringify(v)); }
  function editing() { return body.classList.contains('editing'); }

  // ---------- Rückgängig: der ganze Bereich als Schnappschuss ----------
  function snap() {
    undo.push(root.innerHTML);
    if (undo.length > 60) undo.shift();
    dirty = true;
    if (bar) bar.querySelector('[data-ed-undo]').disabled = false;
  }
  function restore() {
    if (!undo.length) return;
    root.innerHTML = undo.pop();
    arm(true);
    if (bar) bar.querySelector('[data-ed-undo]').disabled = !undo.length;
  }

  // ---------- Modus an und aus ----------
  function arm(on) {
    $$('[data-ed-text]').forEach(function (el) {
      if (on) { el.setAttribute('contenteditable', 'plaintext-only'); if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); }
      else el.removeAttribute('contenteditable');
    });
    $$('[data-ed-item]').forEach(function (it) {
      var h = it.querySelector(':scope > [data-ed-handle], :scope > * > [data-ed-handle]');
      (h || it).setAttribute('draggable', on ? 'true' : 'false');
      if (h) it.removeAttribute('draggable');
    });
  }
  function makeBar() {
    bar = document.createElement('div');
    bar.className = 'edit-bar';
    bar.setAttribute('role', 'toolbar');
    bar.innerHTML = '<b><span class="emo">✏️</span> Bearbeiten</b><span class="hint">' + ((page && page.hint) || 'Texte anklicken und ändern, Einträge ziehen, ausblenden oder umbenennen.') + '</span>'
      + '<span class="sp"></span><button type="button" class="pill small" data-ed-undo disabled>↶ Rückgängig</button>'
      + '<button type="button" class="pill small" data-ed-cancel>Abbrechen</button><button type="button" class="pill small pri" data-ed-done>✔ Fertig</button>';
    root.parentNode.insertBefore(bar, root);
    bar.querySelector('[data-ed-undo]').addEventListener('click', restore);
    bar.querySelector('[data-ed-cancel]').addEventListener('click', function () {
      if (dirty && !window.confirm('Änderungen verwerfen?')) return;
      location.reload();
    });
    bar.querySelector('[data-ed-done]').addEventListener('click', save);
  }
  function start() {
    if (editing()) return;
    body.classList.add('editing');
    if (!bar) makeBar(); else bar.hidden = false;
    arm(true);
    var first = $('[data-ed-text]');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  }
  document.querySelectorAll('[data-ed-start]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); start(); }); });
  if (/[?&]bearbeiten(=|&|$)/.test(location.search)) setTimeout(start, 0);
  window.addEventListener('beforeunload', function (e) { if (editing() && dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Speichern: Die Seite macht aus dem Bereich ihre Daten ----------
  function readFields(el) {
    var out = {};
    $$('[data-ed-field]', el).forEach(function (f) {
      out[f.getAttribute('data-ed-field')] = f.type === 'checkbox' ? f.checked : f.value;
    });
    return out;
  }
  // Allgemeine Form: { texte…, felder…, listen: { gruppe: [ { key, hidden, …werte, texte…, listen… } ] } }
  function collect(el) {
    var out = { texts: {}, lists: {} };
    $$('[data-ed-text]', el).forEach(function (t) {
      if (t.closest('[data-ed-item]') !== (el === root ? null : el)) return;
      out.texts[t.getAttribute('data-ed-text')] = (t.innerText || t.textContent || '').replace(/\s+/g, ' ').trim();
    });
    $$('[data-ed-list]', el).forEach(function (list) {
      var owner = list.parentElement && list.parentElement.closest('[data-ed-item]');
      if ((el === root && owner) || (el !== root && owner !== el)) return;
      out.lists[list.getAttribute('data-ed-list')] = $$(':scope > [data-ed-item]', list).map(function (it) {
        var c = collect(it), v = val(it);
        v.key = it.getAttribute('data-key');
        v.hidden = it.hasAttribute('data-hidden');
        Object.keys(c.texts).forEach(function (k) { v[k] = c.texts[k]; });
        Object.keys(c.lists).forEach(function (k) { v[k] = c.lists[k]; });
        return v;
      });
    });
    return out;
  }
  function save() {
    if (!page) return;
    var btn = bar.querySelector('[data-ed-done]');
    btn.disabled = true; btn.textContent = 'Speichert …';
    var data = collect(root);
    data.fields = readFields(root);
    fetch(page.save, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(page.collect ? page.collect(data, root) : data),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Speichern ging nicht (' + r.status + ').'); return j; }); })
      .then(function () { dirty = false; location.href = location.pathname + '?ok=gespeichert'; })
      .catch(function (e) { window.alert(e.message); btn.disabled = false; btn.textContent = '✔ Fertig'; });
  }

  // ---------- Klicks im Modus ----------
  root.addEventListener('click', function (e) {
    if (!editing()) return;
    var t = e.target, item = t.closest('[data-ed-item]');
    var b = t.closest('[data-ed-up], [data-ed-down], [data-ed-hide], [data-ed-del], [data-ed-props], [data-ed-add]');
    if (!b) {
      // Links führen im Modus nirgendwo hin, Texte sollen anklickbar sein
      if (t.closest('a[href]') || t.closest('[data-ed-text]')) e.preventDefault();
      return;
    }
    e.preventDefault();
    item = b.closest('[data-ed-item]');
    if (b.hasAttribute('data-ed-add')) return add(b);
    if (!item) return;
    if (b.hasAttribute('data-ed-props')) return props(item);
    if (b.hasAttribute('data-ed-del')) {
      if (!window.confirm(b.getAttribute('data-ed-del') || 'Wirklich entfernen?')) return;
      snap(); item.remove(); return;
    }
    snap();
    if (b.hasAttribute('data-ed-hide')) { if (item.hasAttribute('data-hidden')) item.removeAttribute('data-hidden'); else item.setAttribute('data-hidden', ''); }
    if (b.hasAttribute('data-ed-up')) { var p = prevItem(item); if (p) p.before(item); }
    if (b.hasAttribute('data-ed-down')) { var n = nextItem(item); if (n) n.after(item); }
  });
  function prevItem(it) { var p = it.previousElementSibling; while (p && !p.hasAttribute('data-ed-item')) p = p.previousElementSibling; return p; }
  function nextItem(it) { var n = it.nextElementSibling; while (n && !n.hasAttribute('data-ed-item')) n = n.nextElementSibling; return n; }
  // Eingabe in Texten: Enter beendet, Schnappschuss beim ersten Tippen
  root.addEventListener('focusin', function (e) { if (editing() && e.target.hasAttribute && e.target.hasAttribute('data-ed-text')) e.target._before = e.target.textContent; });
  root.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!editing() || !t.hasAttribute || !t.hasAttribute('data-ed-text') || t._before === undefined || t._before === t.textContent) return;
    var now = t.innerHTML; t.textContent = t._before; snap(); t.innerHTML = now; delete t._before;
  });
  root.addEventListener('keydown', function (e) {
    if (editing() && e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-ed-text') && !e.target.hasAttribute('data-ed-multiline')) { e.preventDefault(); e.target.blur(); }
  });
  root.addEventListener('change', function (e) { if (editing() && e.target.hasAttribute && e.target.hasAttribute('data-ed-field')) dirty = true; });

  // ---------- Neu aus Vorlage ----------
  function add(b) {
    var tpl = document.getElementById(b.getAttribute('data-ed-add'));
    if (!tpl) return;
    var list = b.getAttribute('data-ed-into') ? document.querySelector(b.getAttribute('data-ed-into')) : b.closest('[data-ed-list]') || b.parentElement.querySelector('[data-ed-list]');
    if (!list) return;
    snap();
    var frag = tpl.content.cloneNode(true), el = frag.firstElementChild;
    var id = 'n' + Date.now().toString(36);
    $$('[data-key="__neu__"]', frag).concat(el.getAttribute('data-key') === '__neu__' ? [el] : []).forEach(function (x) { x.setAttribute('data-key', id); });
    if (b.closest('[data-ed-list]') === list) b.before(frag); else list.appendChild(frag);
    arm(true);
    var t = el.querySelector('[data-ed-text]');
    if (t) { t.focus(); document.getSelection().selectAllChildren(t); }
    if (page && page.added) page.added(el);
  }

  // ---------- Eigenschaften-Dialog ----------
  var dlg = null;
  function props(item) {
    var list = item.closest('[data-ed-list]'), group = list && list.getAttribute('data-ed-list');
    var v = val(item);
    var fields = (page && page.props && page.props[group]) || [];
    if (typeof fields === 'function') fields = fields(item, v);
    if (!fields.length) return;
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'ed-dlg';
      document.body.appendChild(dlg);
    }
    var html = '<form method="dialog"><h3>' + esc((page.propsTitle && page.propsTitle(item, v)) || 'Eigenschaften') + '</h3><div class="ed-fields">';
    fields.forEach(function (f) {
      var cur = v[f.name] === undefined ? '' : v[f.name];
      html += '<label class="f">' + esc(f.label) + (f.hint ? ' <small>' + esc(f.hint) + '</small>' : '');
      if (f.type === 'select') html += '<select name="' + f.name + '">' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      else if (f.type === 'check') html = html.replace(/<label class="f">([^<]*)$/, '<label class="check"><input type="checkbox" name="' + f.name + '"' + (cur ? ' checked' : '') + '> $1');
      else if (f.type === 'image') html += '<span class="ed-img"><img alt="" src="' + esc(cur) + '"' + (cur ? '' : ' hidden') + '><input type="hidden" name="' + f.name + '" value="' + esc(cur) + '"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-up="' + f.name + '"><button type="button" class="pill small" data-img-drop="' + f.name + '"' + (cur ? '' : ' hidden') + '>Bild entfernen</button></span>';
      else if (f.type === 'area') html += '<textarea name="' + f.name + '" rows="3" maxlength="' + (f.max || 300) + '">' + esc(cur) + '</textarea>';
      else html += '<input type="text" name="' + f.name + '" value="' + esc(cur) + '" maxlength="' + (f.max || 120) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
      html += '</label>';
    });
    html += '</div><div class="actions"><button class="pill pri" value="ok">Übernehmen</button><button class="pill" value="">Abbrechen</button></div></form>';
    dlg.innerHTML = html;
    dlg.querySelectorAll('input[type=file][data-up]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (!inp.files[0] || !page.upload) return;
        var fd = new FormData(); fd.append('_csrf', csrf); fd.append('images', inp.files[0]);
        inp.disabled = true;
        fetch(page.upload, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); }).then(function (j) {
            var url = Array.isArray(j) && j[0] && j[0].url;
            if (!url) throw new Error((j && j.error) || 'Hochladen ging nicht.');
            var wrap = inp.closest('.ed-img');
            wrap.querySelector('input[type=hidden]').value = url;
            wrap.querySelector('img').src = url; wrap.querySelector('img').hidden = false;
            wrap.querySelector('[data-img-drop]').hidden = false;
          }).catch(function (e) { window.alert(e.message); }).then(function () { inp.disabled = false; });
      });
    });
    dlg.querySelectorAll('[data-img-drop]').forEach(function (b) {
      b.addEventListener('click', function () { var w = b.closest('.ed-img'); w.querySelector('input[type=hidden]').value = ''; w.querySelector('img').hidden = true; b.hidden = true; });
    });
    dlg.onclose = function () {
      if (dlg.returnValue !== 'ok') return;
      snap();
      var nv = val(item);
      fields.forEach(function (f) {
        var el = dlg.querySelector('[name="' + f.name + '"]');
        if (el) nv[f.name] = f.type === 'check' ? el.checked : el.value.trim();
      });
      setVal(item, nv);
      if (page.applyProps) page.applyProps(item, nv);
    };
    dlg.showModal();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- Ziehen ----------
  root.addEventListener('dragstart', function (e) {
    if (!editing()) return;
    var item = e.target.closest && e.target.closest('[data-ed-item]');
    if (!item || (e.target.closest('[data-ed-text]') && !e.target.hasAttribute('data-ed-handle'))) return;
    var list = item.parentElement;
    drag = { item: item, group: list.getAttribute('data-ed-list'), before: root.innerHTML };
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', item.getAttribute('data-key') || ''); } catch (x) { /* alt */ }
    if (e.target !== item && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(item, 20, 20);
  });
  root.addEventListener('dragover', function (e) {
    if (!drag) return;
    var list = e.target.closest && e.target.closest('[data-ed-list="' + drag.group + '"]');
    if (!list || drag.item.contains(list)) return;
    e.preventDefault();
    var items = $$(':scope > [data-ed-item]', list).filter(function (x) { return x !== drag.item; });
    var grid = getComputedStyle(list).display.indexOf('grid') >= 0 || getComputedStyle(list).flexDirection === 'row';
    var after = null;
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      var before = grid ? (e.clientY < r.top + r.height && (e.clientY < r.top || e.clientX < r.left + r.width / 2)) : e.clientY < r.top + r.height / 2;
      if (before) { after = items[i]; break; }
    }
    var tail = $(':scope > :not([data-ed-item])', list);
    if (after) { if (after.previousElementSibling !== drag.item) after.before(drag.item); }
    else if (tail && tail.parentElement === list) { if (tail.previousElementSibling !== drag.item) tail.before(drag.item); }
    else if (list.lastElementChild !== drag.item) list.appendChild(drag.item);
  });
  root.addEventListener('drop', function (e) { if (drag) e.preventDefault(); });
  root.addEventListener('dragend', function () {
    if (!drag) return;
    drag.item.classList.remove('dragging');
    if (root.innerHTML !== drag.before) {
      undo.push(drag.before); dirty = true;
      if (bar) bar.querySelector('[data-ed-undo]').disabled = false;
    }
    drag = null;
  });

  window.V3Edit = {
    // Die Seite meldet sich an: save (Adresse), collect(data) → zu sendendes JSON, props: { gruppe: [Felder] }, applyProps(item, werte),
    // upload (Adresse für Bilder), hint (Text im Balken)
    page: function (p) { page = p; },
    val: val, setVal: setVal, start: start, snap: snap,
  };
})();
