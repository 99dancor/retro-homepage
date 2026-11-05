// Admin-Helfer: Baum und „Einstellung suchen“ der Seitenverwaltung, Dienst testen, Adresse kopieren, Upload-Fortschritt,
// readme.txt zurücksetzen, Diagramm-Hover. Der Texteditor steckt in editor.js.
(function () {
  'use strict';
  // ---------- Adresse kopieren ----------
  document.querySelectorAll('[data-copy]').forEach(function (inp) {
    inp.addEventListener('click', function () {
      inp.select();
      if (navigator.clipboard) navigator.clipboard.writeText(inp.value).catch(function () {});
    });
  });

  // ---------- Upload mit Fortschrittsanzeige (für große Dateien) ----------
  document.querySelectorAll('form').forEach(function (form) {
    var out = form.querySelector('[data-progress]');
    if (!out || !window.XMLHttpRequest) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      xhr.upload.addEventListener('progress', function (ev) {
        if (ev.lengthComputable) out.textContent = 'Hochladen… ' + Math.round(ev.loaded / ev.total * 100) + ' %';
      });
      xhr.addEventListener('load', function () {
        if (xhr.status < 400) location.href = xhr.responseURL || location.href;
        else out.textContent = '⚠ Fehler beim Hochladen (' + xhr.status + ')';
      });
      xhr.addEventListener('error', function () { out.textContent = '⚠ Verbindung abgebrochen'; });
      form.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      xhr.send(new FormData(form));
    });
  });

  // ---------- Desktop: ursprüngliche readme.txt einsetzen ----------
  var readmeReset = document.querySelector('[data-readme-reset]');
  if (readmeReset) readmeReset.addEventListener('click', function () {
    var ta = document.querySelector('[name=desk_readme]');
    if (ta.value.trim() && !confirm('Die jetzige readme.txt durch die ursprüngliche Fassung ersetzen? Erst mit „Speichern“ gilt es.')) return;
    ta.value = JSON.parse(document.getElementById('readme-default').textContent);
  });

  // ---------- Baum links: Gruppen auf- und zuklappen (gemerkt im Browser) ----------
  var KEY = 'sv-baum';
  function stored() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function remember(g, open) { var o = stored(); o[g] = open; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* privat */ } }
  function setOpen(li, open) {
    li.setAttribute('aria-expanded', open);
    var b = li.querySelector(':scope > [data-tw]');
    if (b) b.textContent = open ? '−' : '+';
  }
  var memo = stored();
  document.querySelectorAll('.sv-tree [data-group][aria-expanded]').forEach(function (li) {
    var g = li.dataset.group, here = li.querySelector('.cur');
    if (!here && Object.prototype.hasOwnProperty.call(memo, g)) setOpen(li, !!memo[g]);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tw]');
    if (!b) return;
    var li = b.closest('[data-group]'), open = li.getAttribute('aria-expanded') !== 'true';
    setOpen(li, open);
    remember(li.dataset.group, open);
  });
  // Doppelklick auf eine Gruppe klappt sie auf oder zu, wie im Explorer
  document.querySelectorAll('.sv-tree [data-group][aria-expanded] > a').forEach(function (a) {
    a.addEventListener('dblclick', function (e) { e.preventDefault(); a.parentNode.querySelector('[data-tw]').click(); });
  });
  // Am Handy: Auswahlliste statt Baum
  var pick = document.querySelector('[data-sv-select]');
  if (pick) pick.addEventListener('change', function () { if (pick.value) location.href = pick.value; });

  // ---------- Einstellung suchen (Strg+K) ----------
  var box = document.querySelector('[data-sv-search]'), hits = document.getElementById('sv-hits');
  if (box && hits) {
    var index = [];
    try { index = JSON.parse(document.getElementById('sv-index').textContent); } catch (e) { index = []; }
    var norm = function (t) { return String(t).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9 ]+/g, ' '); };
    index.forEach(function (it) { it.hay = norm(it.label + ' ' + it.words); it.head = norm(it.label); });
    var found = [], sel = -1;
    function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function render() {
      hits.innerHTML = found.length ? found.map(function (it, i) {
        return '<a role="option" id="sv-hit-' + i + '" href="' + esc(it.url) + '"' + (i === sel ? ' aria-selected="true" class="sel"' : '') + '><b>' + esc(it.label) + '</b>' +
          (it.words ? '<small>' + esc(it.words.split(' ').slice(0, 6).join(' ')) + '</small>' : '') + '</a>';
      }).join('') : '<p class="muted">Nichts gefunden.</p>';
      hits.hidden = !box.value.trim();
      box.setAttribute('aria-expanded', !hits.hidden);
      if (sel >= 0) box.setAttribute('aria-activedescendant', 'sv-hit-' + sel); else box.removeAttribute('aria-activedescendant');
    }
    function search() {
      var q = norm(box.value).split(' ').filter(Boolean);
      found = !q.length ? [] : index.filter(function (it) { return q.every(function (w) { return it.hay.indexOf(w) >= 0; }); })
        .sort(function (a, b) { return (b.head.indexOf(q[0]) === 0) - (a.head.indexOf(q[0]) === 0) || (b.head.indexOf(q[0]) >= 0) - (a.head.indexOf(q[0]) >= 0); }).slice(0, 8);
      sel = found.length ? 0 : -1;
      render();
    }
    function go(it) {
      if (!it) return;
      var u = new URL(it.url, location.href);
      if (u.pathname === location.pathname) { location.hash = u.hash; flash(); hits.hidden = true; box.blur(); }
      else location.href = it.url;
    }
    box.addEventListener('input', search);
    box.addEventListener('focus', function () { if (box.value.trim()) search(); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!found.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
        render();
      } else if (e.key === 'Enter') { e.preventDefault(); go(found[sel] || found[0]); }
      else if (e.key === 'Escape') { if (box.value) { box.value = ''; search(); } else box.blur(); hits.hidden = true; }
    });
    hits.addEventListener('mousedown', function (e) { e.preventDefault(); });
    hits.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      go(found[Number(a.id.replace('sv-hit-', ''))]);
    });
    box.addEventListener('blur', function () { setTimeout(function () { hits.hidden = true; box.setAttribute('aria-expanded', 'false'); }, 120); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); box.focus(); box.select(); }
    });
  }
  // Sprung auf eine Einstellung (#wartung): kurz hervorheben
  function flash() {
    var id = decodeURIComponent(location.hash.slice(1)), el = id && document.getElementById(id);
    if (!el) return;
    el.classList.remove('sv-flash');
    void el.offsetWidth;
    el.classList.add('sv-flash');
    setTimeout(function () { el.classList.remove('sv-flash'); }, 1800);
  }
  if (location.hash) setTimeout(flash, 50);

  // ---------- Dienste: „Jetzt testen“ mit den Werten im Formular ----------
  document.querySelectorAll('[data-svc-test]').forEach(function (b) {
    var form = b.form, out = form.querySelector('[data-svc-result]');
    b.addEventListener('click', function () {
      if (!form.reportValidity()) return;
      b.disabled = true;
      out.innerHTML = '<span class="led unknown"></span> Frage nach …';
      fetch('/admin/dienste/test', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) })
        .then(function (r) { return r.json(); })
        .then(function (j) { out.innerHTML = '<span class="led ' + j.state + '"></span> '; out.appendChild(document.createTextNode(j.text)); },
          function () { out.textContent = '⚠ Test ging nicht (Verbindung zur Seite?)'; })
        .then(function () { b.disabled = false; });
    });
  });

  // ---------- Kleinigkeiten ----------
  // Ereignisanzeige: Filter wechselt sofort
  document.querySelectorAll('select[data-autosubmit]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
  // Eigenschaften mit Reitern: nach dem Speichern wieder auf demselben Reiter landen
  var props = document.getElementById('props-form');
  if (props) props.addEventListener('submit', function () {
    var t = props.querySelector('[role=tab][aria-selected=true]'), f = props.querySelector('[data-props-tab]');
    if (t && f) f.value = t.getAttribute('aria-controls');
  });
  // Popup-Bilder: Auswahl einer Quelle setzt den passenden Punkt; „Jetzt eins zeigen“ auf dem Desktop
  document.querySelectorAll('.pop-src').forEach(function (src) {
    src.addEventListener('change', function (e) {
      var map = { upload: 'upload', media: 'media', artwork: 'paint' }, v = map[e.target.name];
      var r = v && src.querySelector('input[type=radio][value=' + v + ']');
      if (r && (e.target.value || e.target.files)) r.checked = true;
    });
  });
  var popTest = document.querySelector('[data-popup-test]');
  if (popTest) popTest.addEventListener('click', function () {
    var P = null;
    try { P = window.parent !== window && window.parent.RetroPopups; } catch (e) { P = null; }
    if (P && P.now) P.now();
    else alert('Das geht nur im Fenster auf dem Desktop, wenn es gerade Popup-Bilder für dich gibt (Pool nicht leer, Regeln an, unter 🖥️ → Effekte nicht ausgeschaltet).');
  });

  // ---------- Diagramme: Fadenkreuz + Tooltip (Maus und Tastatur) ----------
  document.querySelectorAll('svg[data-chart]').forEach(function (svg) {
    var data = JSON.parse(svg.getAttribute('data-series'));
    var lines = JSON.parse(svg.getAttribute('data-lines'));
    var ml = +svg.getAttribute('data-ml'), pw = +svg.getAttribute('data-pw'), mt = +svg.getAttribute('data-mt');
    var line = svg.querySelector('.crosshair');
    var tip = svg.parentNode.querySelector('.tooltip');
    var idx = data.length - 1;
    var xOf = function (i) { return ml + (data.length === 1 ? pw / 2 : i * pw / (data.length - 1)); };
    var row = function (cls, value, label) {
      var r = document.createElement('div'); r.className = 'tip-row';
      var k = document.createElement('i'); k.className = 'key ' + cls;
      var b = document.createElement('b'); b.textContent = value;
      var s = document.createElement('span'); s.textContent = ' ' + label;
      r.appendChild(k); r.appendChild(b); r.appendChild(s);
      return r;
    };
    function show(i) {
      idx = Math.max(0, Math.min(data.length - 1, i));
      var d = data[idx], x = xOf(idx);
      line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
      tip.textContent = '';
      var h = document.createElement('div'); h.className = 'tip-head';
      h.textContent = new Date(d.day + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
      tip.appendChild(h);
      lines.forEach(function (l, n) { tip.appendChild(row('k' + (n + 1), Number(d[l.key]).toLocaleString('de-DE'), l.label)); });
      tip.hidden = false;
      var box = svg.getBoundingClientRect(), scale = box.width / svg.viewBox.baseVal.width;
      var left = x * scale + 12;
      if (left + tip.offsetWidth > box.width) left = x * scale - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = (mt * scale + 4) + 'px';
    }
    function hide() { line.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    svg.addEventListener('pointermove', function (e) {
      var box = svg.getBoundingClientRect();
      var vx = (e.clientX - box.left) / box.width * svg.viewBox.baseVal.width;
      show(Math.round((vx - ml) / pw * (data.length - 1)));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', function () { show(idx); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); }
      if (e.key === 'Home') { show(0); e.preventDefault(); }
      if (e.key === 'End') { show(data.length - 1); e.preventDefault(); }
    });
  });
})();
