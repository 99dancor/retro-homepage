// Bausteine wie bei Windows für Desktop, Notizblock, Explorer und Systemsteuerung: Menüleisten, Rechtsklick-Menüs,
// Dialoge und Meldungen. Optik aus retro.css (.ms-menu, .ms-dd, .ms-dlg), im XP-Design passt sie sich von selbst an.
// Menüeinträge: { label, act, key, disabled, checked, bold, sub: [...] } oder '-' als Trennlinie.
(function () {
  'use strict';
  var doc = document;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function csrf() {
    var el = doc.querySelector('[data-csrf]');
    return el ? el.getAttribute('data-csrf') : '';
  }
  // JSON an den Server; Fehler kommen als Error mit der Meldung des Servers
  function api(method, url, data) {
    var opts = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (data !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(data); }
    if (method !== 'GET') opts.headers['x-csrf-token'] = csrf();
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || (r.status === 401 ? 'Bitte melde dich an.' : 'Das hat nicht geklappt (' + r.status + ').'));
        return j;
      });
    });
  }

  // ---------- Menüs ----------
  var openMenus = [];
  function closeMenus(from) {
    while (openMenus.length > (from || 0)) { var m = openMenus.pop(); m.el.remove(); if (m.onClose) m.onClose(); }
  }
  function build(items, onAct, level) {
    var box = doc.createElement('div');
    box.className = 'ms-dd wui-menu';
    box.setAttribute('role', 'menu');
    items.forEach(function (it) {
      if (it === '-') { box.appendChild(doc.createElement('hr')); return; }
      if (!it || it.hidden) return;
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ms-mi' + (it.checked ? ' chk' : '') + (it.sub ? ' wui-sub' : '') + (it.bold ? ' wui-bold' : '');
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      b.innerHTML = '<span>' + (it.icon ? esc(it.icon) + ' ' : '') + esc(it.label) + '</span>' + (it.key ? '<span>' + esc(it.key) + '</span>' : '');
      if (it.sub) {
        var open = function () {
          if (b.disabled) return;
          closeMenus(level + 1);
          var r = b.getBoundingClientRect();
          show(it.sub, r.right - 3, r.top - 3, onAct, level + 1, r.left + 3);
        };
        b.addEventListener('mouseenter', open);
        b.addEventListener('click', function (e) { e.stopPropagation(); open(); });
      } else {
        b.addEventListener('mouseenter', function () { closeMenus(level + 1); });
        b.addEventListener('click', function (e) { e.stopPropagation(); closeMenus(0); onAct(it.act, it); });
      }
      box.appendChild(b);
    });
    return box;
  }
  // Menü an x/y; passt es nicht nach rechts oder unten, klappt es zur anderen Seite (altX: linke Kante des Eltern-Menüs)
  function show(items, x, y, onAct, level, altX) {
    level = level || 0;
    closeMenus(level);
    var box = build(items, onAct, level);
    box.style.position = 'fixed'; box.style.left = '0'; box.style.top = '0'; box.style.visibility = 'hidden';
    box.classList.add('wui-pop');
    doc.body.appendChild(box);
    var w = box.offsetWidth, h = box.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    // Ist die Seite oder das Menü vergrößert (🖥️ → Größe der Oberfläche), rechnen Mauspunkte in echten Pixeln, left/top im vergrößerten Maß
    var z = (parseFloat(getComputedStyle(doc.body).zoom) || 1) * (parseFloat(getComputedStyle(box).zoom) || 1);
    w *= z; h *= z;
    var left = x + w > vw ? (altX !== undefined ? altX - w : vw - w - 2) : x;
    var top = y + h > vh ? Math.max(2, vh - h - 2) : y;
    box.style.left = Math.max(2, left) / z + 'px'; box.style.top = top / z + 'px'; box.style.visibility = '';
    openMenus.push({ el: box });
    var first = box.querySelector('.ms-mi:not([disabled])');
    if (first && !level) first.focus({ preventScroll: true });
    return box;
  }
  function contextMenu(x, y, items, onAct) {
    show(items, x, y, onAct, 0);
  }
  doc.addEventListener('pointerdown', function (e) { if (openMenus.length && !e.target.closest('.wui-pop')) closeMenus(0); }, true);
  doc.addEventListener('keydown', function (e) {
    if (!openMenus.length) return;
    var box = openMenus[openMenus.length - 1].el, items = [].slice.call(box.querySelectorAll('.ms-mi:not([disabled])'));
    var i = items.indexOf(doc.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenus(openMenus.length - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'ArrowRight' && doc.activeElement.classList.contains('wui-sub')) { e.preventDefault(); doc.activeElement.click(); var sub = openMenus[openMenus.length - 1].el.querySelector('.ms-mi'); if (sub) sub.focus(); }
    else if (e.key === 'ArrowLeft' && openMenus.length > 1) { e.preventDefault(); closeMenus(openMenus.length - 1); }
  });
  window.addEventListener('blur', function () { closeMenus(0); });

  // Menüleiste wie im Notizblock: menus = [{ label: 'Datei', items: [...] }], items darf eine Funktion sein (frisch beim Öffnen)
  function menubar(el, menus, onAct) {
    el.classList.add('ms-menu');
    el.setAttribute('role', 'menubar');
    var cur = null;
    menus.forEach(function (m) {
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'ms-mtop'; b.textContent = m.label; b.setAttribute('aria-haspopup', 'true');
      function open() {
        el.querySelectorAll('.ms-mtop').forEach(function (o) { o.classList.remove('open'); });
        b.classList.add('open'); cur = b;
        var r = b.getBoundingClientRect();
        show(typeof m.items === 'function' ? m.items() : m.items, r.left, r.bottom, onAct, 0);
        openMenus[0].onClose = function () { b.classList.remove('open'); if (cur === b) cur = null; };
      }
      b.addEventListener('click', function (e) { e.stopPropagation(); if (cur === b) closeMenus(0); else open(); });
      b.addEventListener('mouseenter', function () { if (cur && cur !== b) open(); });
      el.appendChild(b);
    });
  }

  // ---------- Dialoge ----------
  var dlg = null;
  function dialogEl() {
    if (dlg) return dlg;
    dlg = doc.createElement('dialog');
    dlg.className = 'window ms-dlg wui-dlg';
    dlg.innerHTML = '<div class="titlebar"><span class="ttl"></span><button type="button" class="tb-btn" data-x aria-label="Schließen">×</button></div>' +
      '<form method="dialog" class="body"><div class="wui-body"></div><p class="msg err" data-err hidden></p><div class="actions"></div></form>';
    doc.body.appendChild(dlg);
    return dlg;
  }
  // buttons: [{ label, value, primary }]. check(value, form) darf eine Fehlermeldung liefern, dann bleibt der Dialog offen.
  // Ergebnis: { value, form } (form = Formularfelder als Objekt), Schließen per × oder Esc ergibt value 'cancel'.
  function dialog(title, html, buttons, opts) {
    opts = opts || {};
    var d = dialogEl();
    d.classList.toggle('wide', !!opts.wide);
    d.querySelector('.ttl').textContent = title;
    var bodyEl = d.querySelector('.wui-body'), err = d.querySelector('[data-err]'), acts = d.querySelector('.actions');
    bodyEl.innerHTML = html;
    err.hidden = true;
    acts.innerHTML = '';
    (buttons || [{ label: 'OK', value: 'ok', primary: true }]).forEach(function (b) {
      var el = doc.createElement('button');
      el.type = b.value === 'cancel' ? 'button' : 'submit';
      el.value = b.value; el.textContent = b.label;
      if (b.primary) el.className = 'wui-primary';
      if (b.value === 'cancel') el.addEventListener('click', function () { finish('cancel'); });
      acts.appendChild(el);
    });
    var form = d.querySelector('form');
    return new Promise(function (resolve) {
      function values() {
        var o = {};
        [].forEach.call(form.elements, function (f) {
          if (!f.name) return;
          if (f.type === 'checkbox') o[f.name] = f.checked;
          else if (f.type === 'radio') { if (f.checked) o[f.name] = f.value; }
          else o[f.name] = f.value;
        });
        return o;
      }
      function finish(value) {
        form.removeEventListener('submit', onSubmit);
        d.querySelector('[data-x]').onclick = null;
        d.oncancel = null;
        if (d.open) d.close();
        resolve({ value: value, form: values() });
      }
      function onSubmit(e) {
        e.preventDefault();
        var value = e.submitter ? e.submitter.value : 'ok';
        var problem = opts.check ? opts.check(value, values(), form) : null;
        if (problem && problem.then) {
          problem.then(function (p) { if (p) { err.textContent = p; err.hidden = false; } else finish(value); });
          return;
        }
        if (problem) { err.textContent = problem; err.hidden = false; return; }
        finish(value);
      }
      form.addEventListener('submit', onSubmit);
      d.querySelector('[data-x]').onclick = function () { finish('cancel'); };
      d.oncancel = function (e) { e.preventDefault(); finish('cancel'); };
      d.showModal();
      if (opts.onOpen) opts.onOpen(form, bodyEl);
      var focus = form.querySelector('[autofocus]') || form.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select') || acts.querySelector('button');
      if (focus) { focus.focus(); if (focus.select && opts.select !== false) focus.select(); }
    });
  }
  function msgbox(text, icon, title) {
    return dialog(title || doc.title.split(' – ')[0] || 'Hinweis', '<div class="ms-about"><span class="ms-about-icon">' + esc(icon || 'ℹ️') + '</span><p>' + esc(text) + '</p></div>');
  }
  function confirmBox(text, icon, yes, title) {
    return dialog(title || 'Bestätigen', '<div class="ms-about"><span class="ms-about-icon">' + esc(icon || '❓') + '</span><p>' + esc(text) + '</p></div>',
      [{ label: yes || 'Ja', value: 'ok', primary: true }, { label: 'Nein', value: 'cancel' }]).then(function (r) { return r.value === 'ok'; });
  }
  // Sichtbarkeit als Auswahl
  var VIS = [['private', 'Nur ich'], ['friends', 'Nur Freunde'], ['members', 'Angemeldete'], ['public', 'Öffentlich']];
  function visSelect(name, cur) {
    return '<select name="' + name + '">' + VIS.map(function (v) { return '<option value="' + v[0] + '"' + (v[0] === cur ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select>';
  }
  // Ordnerbaum als eingerückte Auswahl (für „Speichern unter“ und „Verschieben nach“)
  function folderOptions(tree, cur) {
    var out = '<option value="0"' + (!cur ? ' selected' : '') + '>🖥️ Desktop</option>';
    (function walk(list, d) {
      list.forEach(function (f) {
        out += '<option value="' + f.id + '"' + (f.id === cur ? ' selected' : '') + '>' + new Array(d + 2).join('   ') + '📁 ' + esc(f.name) + '</option>';
        walk(f.children, d + 1);
      });
    })(tree || [], 0);
    return out;
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' Byte';
    if (n < 1048576) return (n / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' KB';
    if (n < 1073741824) return (n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
    return (n / 1073741824).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' GB';
  }
  function fmtDate(t) { return t ? new Date(t * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  // Der Desktop außen herum (oder null, wenn die Seite allein läuft)
  function desk() { try { return window.parent !== window && window.parent.RetroDesk ? window.parent.RetroDesk : window.RetroDesk || null; } catch (e) { return null; } }

  window.WinUI = {
    esc: esc, api: api, csrf: csrf, contextMenu: contextMenu, closeMenus: closeMenus, menubar: menubar, dialog: dialog,
    msgbox: msgbox, confirm: confirmBox, visSelect: visSelect, VIS: VIS, folderOptions: folderOptions, fmtSize: fmtSize, fmtDate: fmtDate, desk: desk,
  };
})();
