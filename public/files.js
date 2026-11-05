// Downloads als Explorer (views/files.ejs): Auswählen, Details rechts, Doppelklick öffnet (Titel im Mediaplayer, Dateien laden),
// Spaltenköpfe sortieren, das Suchfeld filtert sofort (Enter sucht in allen Bereichen).
(function () {
  'use strict';
  var root = document.getElementById('files-ex');
  if (!root) return;
  var rows = [].slice.call(root.querySelectorAll('tr[data-ref]'));
  var det = root.querySelector('[data-det]'), detStart = det ? det.innerHTML : '';
  var statusEl = root.querySelector('[data-status]'), statusText = statusEl ? statusEl.textContent : '';
  var sel = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function item(el) { try { return JSON.parse(el.dataset.item); } catch (e) { return null; } }
  function size(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toLocaleString('de-DE', { maximumFractionDigits: i ? 1 : 0 }) + ' ' + u[i];
  }
  function date(t) { return t ? new Date(t * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  function len(s) { s = Math.round(s || 0); if (!s) return ''; var m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function desk() { try { return window.parent !== window && window.parent.RetroDesk ? window.parent.RetroDesk : null; } catch (e) { return null; } }
  function openUrl(url) { var d = desk(); if (d && d.open) d.open(url, true); else location.href = url; }
  function download(url) { var a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }

  function details(r) {
    if (!r) return detStart;
    var kind = { file: r.cat, audio: 'Musik', video: 'Video', playlist: 'Playlist' }[r.type];
    var dl = [['Art', kind]];
    if (r.artist) dl.push(['Interpret', r.artist]);
    if (r.album) dl.push(['Album', r.album]);
    if (r.duration) dl.push(['Länge', len(r.duration)]);
    if (r.game) dl.push(['Spiel', r.game]);
    if (r.type === 'playlist') dl.push(['Titel', r.count]);
    else dl.push(['Größe', size(r.size)]);
    if (r.file) dl.push(['Datei', r.file]);
    dl.push([r.type === 'playlist' ? 'Geändert' : 'Hinzugefügt', date(r.date)]);
    if (r.by) dl.push([r.type === 'playlist' ? 'Von' : 'Hochgeladen von', r.by]);
    if (r.visLabel) dl.push(['Sichtbar für', r.visLabel]);
    if (r.type === 'file') dl.push(['Heruntergeladen', r.downloads + '×']);
    if (r.plays) dl.push(['Gespielt', r.plays + '×']);
    var h = '<div class="fx-big">' + esc(r.icon) + '</div><h3>' + esc(r.name) + '</h3>';
    if (r.desc) h += '<p class="fx-desc">' + esc(r.desc) + '</p>';
    h += '<dl>' + dl.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl><p class="fx-acts">';
    if (r.play) h += '<button type="button" class="small" data-fx="play">▶ ' + (r.type === 'playlist' ? 'Öffnen' : 'Abspielen') + '</button> ';
    if (r.dl) h += '<button type="button" class="small" data-fx="dl">⬇ Herunterladen</button> ';
    if (r.view && /\.(txt|md|log|ini|cfg|json|xml|csv|pdf|png|jpe?g|gif|webp)$/i.test(r.file || r.name)) h += '<button type="button" class="small" data-fx="view">👁 Ansehen</button> ';
    if (r.edit) h += '<button type="button" class="small" data-fx="edit">ℹ Eigenschaften</button>';
    return h + '</p>';
  }
  function select(el) {
    sel = el;
    rows.forEach(function (r) { r.classList.toggle('sel', r === el); r.setAttribute('aria-selected', r === el); });
    var r = el && item(el);
    if (det) det.innerHTML = details(r);
    root.querySelector('[data-fx=play]').disabled = !(r && r.play);
    root.querySelector('[data-fx=dl]').disabled = !(r && r.dl);
    root.querySelector('[data-fx=edit]').disabled = !(r && r.edit);
    if (statusEl) statusEl.textContent = r ? r.name + (r.size ? ' · ' + size(r.size) : '') : statusText;
  }
  function act(what) {
    var r = sel && item(sel);
    if (!r) return;
    if (what === 'play' && r.play) openUrl(r.play);
    else if (what === 'dl' && r.dl) download(r.dl);
    else if (what === 'view' && r.view) openUrl(r.view);
    else if (what === 'edit' && r.edit) openUrl(r.edit);
  }

  // Mit der Maus wählt ein Klick aus und ein Doppelklick öffnet; auf dem Handy öffnet schon das Antippen
  var touch = false;
  root.addEventListener('pointerdown', function (e) { touch = e.pointerType !== 'mouse'; }, true);
  rows.forEach(function (el) {
    el.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (touch && a) { e.preventDefault(); select(el); act(item(el).play ? 'play' : 'dl'); return; }
      if (a) e.preventDefault();
      select(el);
    });
    el.addEventListener('dblclick', function () { select(el); act(item(el).play ? 'play' : 'dl'); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); act(item(el).play ? 'play' : 'dl'); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var vis = rows.filter(function (r) { return !r.hidden; }), i = vis.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1);
        if (vis[i]) { vis[i].focus(); select(vis[i]); }
      }
    });
    el.addEventListener('focus', function () { if (sel !== el && !touch) select(el); });
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fx]');
    if (!b || b.tagName === 'INPUT') return;
    var f = b.dataset.fx;
    if (f === 'back') history.back();
    else if (f === 'tree') { var open = root.classList.toggle('tree-open'); b.setAttribute('aria-expanded', open); }
    else act(f);
  });

  // Sortieren per Klick auf den Spaltenkopf (Gruppenzeilen verschwinden dabei)
  var dir = {};
  root.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.title = 'Sortieren';
    th.addEventListener('click', function () {
      var i = Number(th.dataset.sort), d = dir[i] = -(dir[i] || -1);
      var body = th.closest('table').tBodies[0];
      body.querySelectorAll('.fx-grp').forEach(function (g) { g.remove(); });
      rows.slice().sort(function (a, b) {
        var x = a.cells[i], y = b.cells[i];
        var vx = x.dataset.v !== undefined ? Number(x.dataset.v) : x.textContent.trim().toLowerCase();
        var vy = y.dataset.v !== undefined ? Number(y.dataset.v) : y.textContent.trim().toLowerCase();
        return (typeof vx === 'number' ? vx - vy : String(vx).localeCompare(String(vy), 'de')) * d;
      }).forEach(function (r) { body.appendChild(r); });
      root.querySelectorAll('th[data-sort]').forEach(function (t) { t.removeAttribute('aria-sort'); });
      th.setAttribute('aria-sort', d > 0 ? 'ascending' : 'descending');
    });
  });

  // Sofort filtern beim Tippen; Enter schickt die Suche über alle Bereiche ab
  var filter = root.querySelector('[data-fx=filter]');
  if (filter && root.dataset.node !== 'suche') filter.addEventListener('input', function () {
    var q = filter.value.trim().toLowerCase(), n = 0;
    rows.forEach(function (r) { var hit = !q || r.textContent.toLowerCase().indexOf(q) >= 0; r.hidden = !hit; if (hit) n++; });
    root.querySelectorAll('.fx-grp').forEach(function (g) { g.hidden = !!q; });
    if (statusEl) statusEl.textContent = q ? n + ' von ' + rows.length + ' passen' : statusText;
  });
})();
