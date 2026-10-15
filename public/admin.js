// Admin-Helfer: Markdown-Editor mit Bild-Upload, Vorschau, Upload-Fortschritt, Diagramm-Hover.
(function () {
  'use strict';
  var csrfInput = document.querySelector('input[name=_csrf]');
  var csrf = csrfInput ? csrfInput.value : '';

  // ---------- Markdown-Editor ----------
  function insertAt(ta, before, after) {
    var s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
    ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + sel.length;
  }

  function uploadImages(files, ta, status) {
    var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
    if (!list.length) return;
    var fd = new FormData();
    fd.append('_csrf', csrf);
    list.forEach(function (f) { fd.append('images', f, f.name || 'bild.png'); });
    status.textContent = 'Lade ' + list.length + ' Bild(er) hoch…';
    fetch('/admin/media', { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (saved) {
        var md = saved.map(function (m) { return '![' + m.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '') + '](' + m.url + ')'; }).join('\n');
        insertAt(ta, md + '\n', '');
        status.textContent = '✔ Bild eingefügt';
      })
      .catch(function (e) { status.textContent = '⚠ Upload fehlgeschlagen (' + e.message + ')'; });
  }

  document.querySelectorAll('[data-editor]').forEach(function (ed) {
    var ta = ed.querySelector('textarea');
    var status = ed.querySelector('[data-status]');
    var prev = ed.querySelector('[data-preview-box]');
    var lib = ed.querySelector('[data-library-box]');

    ed.querySelectorAll('[data-md]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-md').replace(/\\n/g, '\n').split('|');
        insertAt(ta, parts[0], parts[1] || '');
      });
    });
    ed.querySelector('[data-upload]').addEventListener('change', function (e) { uploadImages(e.target.files, ta, status); e.target.value = ''; });
    ta.addEventListener('paste', function (e) {
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); uploadImages(files, ta, status); }
    });
    ta.addEventListener('dragover', function (e) { e.preventDefault(); });
    ta.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); uploadImages(e.dataTransfer.files, ta, status); }
    });

    ed.querySelector('[data-preview]').addEventListener('click', function () {
      if (!prev.hidden) { prev.hidden = true; return; }
      var body = new URLSearchParams({ _csrf: csrf, md: ta.value });
      fetch('/admin/preview', { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (r) { return r.text(); })
        .then(function (html) { prev.innerHTML = html; prev.hidden = false; }); // serverseitig bereinigt
    });

    ed.querySelector('[data-library]').addEventListener('click', function () {
      if (!lib.hidden) { lib.hidden = true; return; }
      lib.hidden = false;
      var listEl = lib.querySelector('[data-library-list]');
      fetch('/admin/media.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (items) {
        listEl.textContent = '';
        if (!items.length) { listEl.textContent = 'Noch keine Bilder hochgeladen.'; return; }
        items.forEach(function (m) {
          var fig = document.createElement('figure');
          var img = document.createElement('img');
          img.src = m.url; img.alt = ''; img.loading = 'lazy';
          var btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'small'; btn.textContent = 'Einfügen';
          btn.addEventListener('click', function () { insertAt(ta, '![' + m.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '') + '](' + m.url + ')\n', ''); });
          var cap = document.createElement('div');
          cap.textContent = m.name;
          fig.appendChild(img); fig.appendChild(cap); fig.appendChild(btn);
          listEl.appendChild(fig);
        });
      });
    });
  });

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
