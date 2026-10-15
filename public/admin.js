// Admin-Helfer: Adresse kopieren, Upload-Fortschritt, Diagramm-Hover. Der Texteditor steckt in editor.js.
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
