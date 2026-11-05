// Fenster „Hinzufügen“ (views/upload.ejs): Dateien hineinziehen oder auswählen, pro Datei das Ziel wählen
// (Mediaplayer oder eine Kategorie der Downloads) und einzeln hochladen, mit Fortschritt und Abbrechen je Datei.
(function () {
  'use strict';
  var form = document.getElementById('up-form');
  if (!form || !window.FormData || !window.XMLHttpRequest) return;
  var D = form.dataset;
  var cats = JSON.parse(D.cats || '[]'), blocked = (D.blocked || '').split(' ').filter(Boolean);
  var music = D.music ? JSON.parse(D.music) : null, maxMb = Number(D.max) || 0, preset = D.preset || 'Allgemein';
  var csrf = form.querySelector('[name=_csrf]').value, ordner = form.querySelector('[name=ordner]');
  var drop = form.querySelector('[data-drop]'), pick = form.querySelector('[data-pick]'), table = form.querySelector('[data-list]');
  var body = table.tBodies[0], sum = form.querySelector('[data-sum]'), go = form.querySelector('[data-go]');
  var gameBox = form.querySelector('[data-gamebox]');
  var items = [], busy = false;
  form.noValidate = true;
  pick.required = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function size(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toLocaleString('de-DE', { maximumFractionDigits: i ? 1 : 0 }) + ' ' + u[i];
  }
  function ext(name) { var m = /\.([^.]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; }
  function guess(name) {
    var e = ext(name), hit = cats.filter(function (c) { return c.ext.indexOf(e) >= 0; })[0];
    return hit ? hit.name : preset;
  }
  function catOf(name) { return cats.filter(function (c) { return c.name === name; })[0] || cats[0]; }
  function canMusic(f) { return music && music.ext.indexOf(ext(f.name)) >= 0 && (!music.mb || f.size <= music.mb * 1048576); }
  function isVideo(f) { return music && music.video.indexOf(ext(f.name)) >= 0 && !/^audio\//.test(f.type); }

  function options(it) {
    var h = '';
    if (canMusic(it.file)) h += '<option value="music"' + (it.target === 'music' ? ' selected' : '') + '>' + (isVideo(it.file) ? '🎬 Mediaplayer · Videos' : '🎵 Mediaplayer · Musik') + '</option>';
    cats.forEach(function (c) { h += '<option value="k:' + esc(c.name) + '"' + (it.target === 'k:' + c.name ? ' selected' : '') + '>' + esc(c.icon) + ' Downloads · ' + esc(c.name) + '</option>'; });
    return h;
  }
  function add(list) {
    [].forEach.call(list, function (f) {
      var it = { file: f, status: 'wait', xhr: null };
      if (blocked.indexOf(ext(f.name)) >= 0) it.status = 'blocked';
      else if (maxMb && f.size > maxMb * 1048576) it.status = 'big';
      it.target = canMusic(f) ? 'music' : 'k:' + guess(f.name);
      var tr = document.createElement('tr');
      it.el = tr;
      items.push(it);
      body.appendChild(tr);
      row(it);
    });
    table.hidden = !items.length;
    refresh();
  }
  function icon(it) { return it.target === 'music' ? (isVideo(it.file) ? '🎬' : '🎵') : catOf(it.target.slice(2)).icon; }
  function row(it) {
    var tr = it.el;
    tr.className = it.status === 'blocked' || it.status === 'big' ? 'blocked' : '';
    var where, prog;
    if (it.status === 'blocked') { where = '<td colspan="2"><small>Programme und Skripte (.' + esc(ext(it.file.name)) + ') werden nicht angenommen</small></td>'; prog = ''; }
    else if (it.status === 'big') { where = '<td colspan="2"><small>Zu groß (höchstens ' + maxMb + ' MB)</small></td>'; prog = ''; }
    else {
      where = '<td>' + (it.status === 'wait' ? '<select aria-label="Ziel für ' + esc(it.file.name) + '">' + options(it) + '</select>' : esc(it.label || '')) + '</td>';
      var pct = it.pct || 0;
      prog = '<td><span class="up-bar"><i style="width:' + (it.status === 'done' ? 100 : pct) + '%"></i></span> ' +
        ({ wait: 'bereit', run: pct + ' %', done: '✔', fail: '⚠', stop: 'abgebrochen' }[it.status] || '') + '</td>';
    }
    tr.innerHTML = '<td class="up-name">' + icon(it) + ' ' + esc(it.file.name) + (it.error ? '<br><small class="err">' + esc(it.error) + '</small>' : '') +
      (it.status === 'done' && it.open ? '<br><small><a href="' + esc(it.open) + '">Öffnen</a></small>' : '') + '</td>' +
      '<td class="num">' + size(it.file.size) + '</td>' + where + prog +
      '<td>' + (it.status === 'done' ? '' : '<button type="button" class="small" title="' + (it.status === 'run' ? 'Abbrechen' : 'Entfernen') + '">✖</button>') + '</td>';
    var sel = tr.querySelector('select');
    if (sel) sel.addEventListener('change', function () { it.target = sel.value; row(it); refresh(); });
    var x = tr.querySelector('button');
    if (x) x.addEventListener('click', function () {
      if (it.status === 'run' && it.xhr) { it.xhr.abort(); return; }
      items.splice(items.indexOf(it), 1); tr.remove(); table.hidden = !items.length; refresh();
    });
  }
  function ready() { return items.filter(function (it) { return it.status === 'wait'; }); }
  function refresh() {
    var r = ready(), done = items.filter(function (it) { return it.status === 'done'; }).length;
    var total = r.reduce(function (n, it) { return n + it.file.size; }, 0);
    var tooFull = D.space !== '' && total > Number(D.space);
    if (busy) sum.textContent = done + ' von ' + items.filter(function (it) { return it.status !== 'blocked' && it.status !== 'big'; }).length + ' fertig';
    else if (r.length) sum.textContent = r.length + (r.length === 1 ? ' Datei' : ' Dateien') + ' · ' + size(total) + (tooFull ? ' · passt nicht mehr in deinen Speicher' : '');
    else sum.textContent = done ? '✔ Fertig: ' + done + (done === 1 ? ' Datei' : ' Dateien') + ' hochgeladen.' : '';
    go.disabled = busy || !r.length;
    gameBox.hidden = !items.some(function (it) { return it.target.indexOf('k:') === 0 && catOf(it.target.slice(2)).game; });
  }

  function send(url, fd, it) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      it.xhr = x;
      x.open('POST', url);
      x.setRequestHeader('Accept', 'application/json');
      x.setRequestHeader('x-csrf-token', csrf);
      x.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        var p = Math.min(99, Math.round(e.loaded / e.total * 100));
        if (p !== it.pct) { it.pct = p; var b = it.el.querySelector('.up-bar i'); if (b) b.style.width = p + '%'; var c = it.el.cells[3]; if (c && c.lastChild) c.lastChild.textContent = ' ' + p + ' %'; }
      };
      x.onload = function () {
        var j = {};
        try { j = JSON.parse(x.responseText); } catch (e) { /* keine Antwort */ }
        if (x.status >= 200 && x.status < 300) resolve(j); else reject(new Error(j.error || 'Hochladen fehlgeschlagen (' + x.status + ').'));
      };
      x.onerror = function () { reject(new Error('Verbindung unterbrochen.')); };
      x.onabort = function () { var e = new Error('abgebrochen'); e.aborted = true; reject(e); };
      x.send(fd);
    });
  }
  function moveToFolder(ref) {
    if (!ordner) return Promise.resolve();
    return fetch('/api/desktop/verschieben', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ refs: [ref], folder: ordner.value }) }).catch(function () {});
  }
  function upload(it) {
    var fd = new FormData(), vis = form.querySelector('[name=visibility]').value;
    it.status = 'run'; it.pct = 0;
    if (it.target === 'music') {
      it.label = isVideo(it.file) ? '🎬 Mediaplayer · Videos' : '🎵 Mediaplayer · Musik';
      fd.append('visibility', vis);
      fd.append('file', it.file, it.file.name);
      row(it);
      return send('/musik/hochladen', fd, it).then(function (j) {
        it.open = '/musik?titel=' + j.track.id;
        return moveToFolder('titel:' + j.track.id);
      });
    }
    var cat = it.target.slice(2);
    it.label = catOf(cat).icon + ' Downloads · ' + cat;
    ['visibility', 'game', 'description'].forEach(function (k) { var el = form.querySelector('[name=' + k + ']'); if (el) fd.append(k, el.value); });
    fd.append('category', cat);
    if (ordner) fd.append('ordner', ordner.value);
    fd.append('files', it.file, it.file.name);
    row(it);
    return send('/files/upload', fd, it).then(function () { it.open = '/files?ort=' + encodeURIComponent('k:' + cat); });
  }
  function next() {
    var it = ready()[0];
    if (!it) { busy = false; refresh(); return; }
    upload(it).then(function () { it.status = 'done'; }, function (e) { it.status = e.aborted ? 'stop' : 'fail'; it.error = e.aborted ? '' : e.message; })
      .then(function () { it.xhr = null; row(it); refresh(); next(); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !ready().length) return;
    busy = true;
    refresh();
    next();
  });
  pick.addEventListener('change', function () { add(pick.files); pick.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('drop-on'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); if (t === 'drop' || !e.relatedTarget) drop.classList.remove('drop-on'); });
  });
  document.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) add(e.dataTransfer.files); });
  window.addEventListener('beforeunload', function (e) { if (busy) { e.preventDefault(); e.returnValue = ''; } });
  refresh();
})();
