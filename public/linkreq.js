'use strict';
// Link-Vorschläge: Art am Link vorerkennen (views/partials/link-form.ejs) und Fortschritt in „Meine Vorschläge“
// bzw. der Warteschlange der Seitenverwaltung nachladen (views/linkreq-mine.ejs, views/admin/linkreq-queue.ejs).
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function size(n) { n = Number(n) || 0; var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(1).replace('.', ',') : n) + ' ' + u[i]; }
  function eta(s) { s = Math.round(Number(s) || 0); if (!s) return ''; if (s < 90) return 'noch etwa ' + s + ' s'; if (s < 5400) return 'noch etwa ' + Math.round(s / 60) + ' min'; return 'noch etwa ' + Math.round(s / 3600) + ' h'; }

  // ---------- Formular ----------
  var form = document.getElementById('lr-form');
  if (form) {
    var urls = form.querySelector('[data-urls]'), found = form.querySelector('[data-found]'), pl = form.querySelector('[data-pl]');
    var privNote = form.querySelector('[data-privnote]'), vis = form.querySelector('[data-vis]');
    var kinds = (form.getAttribute('data-kinds') || '').split(' '), touched = false;
    var AUDIO = /\.(mp3|m4a|aac|opus|ogg|oga|flac|wav)(\?|#|$)/i, VIDEO = /\.(mp4|m4v|webm|mov|mkv)(\?|#|$)/i;
    function info(u) {
      var m;
      try { m = new URL(u); } catch (e) { return null; }
      var yt = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(m.hostname);
      if (yt && m.searchParams.get('list') && (m.pathname === '/playlist' || !m.searchParams.get('v'))) return { kind: 'playlist', icon: '📋', text: 'YouTube-Playlist', sub: 'wird eine eigene Playlist im Mediaplayer, in der Reihenfolge wie bei YouTube' };
      if (yt) return { kind: 'musik', icon: '▶️', text: 'YouTube-Video', sub: 'als Musik nur der Ton, als Video in der erlaubten Qualität' };
      if (AUDIO.test(m.pathname)) return { kind: 'musik', icon: '🎵', text: 'Musikdatei', sub: m.hostname };
      if (VIDEO.test(m.pathname)) return { kind: 'video', icon: '🎬', text: 'Videodatei', sub: m.hostname };
      return { kind: 'datei', icon: '🔗', text: 'Link zu ' + m.hostname.replace(/^www\./, ''), sub: 'JDownloader schaut beim Prüfen nach, was dahinter steckt' };
    }
    function setKind(k) {
      if (kinds.indexOf(k) < 0) return;
      var r = form.querySelector('input[name=kind][value="' + k + '"]');
      if (r) r.checked = true;
    }
    function sync() {
      var k = (form.querySelector('input[name=kind]:checked') || {}).value;
      if (pl) pl.hidden = k !== 'playlist';
      if (privNote) privNote.hidden = k !== 'privat';
      if (vis) vis.hidden = k === 'privat';
    }
    function detect() {
      var list = urls.value.split(/\s+/).filter(Boolean), hits = list.map(info).filter(Boolean);
      if (!hits.length) { found.hidden = true; return; }
      var first = hits[0];
      found.hidden = false;
      found.innerHTML = '<span class="lr-ic" aria-hidden="true">' + first.icon + '</span><span><b>' + esc(hits.length > 1 ? hits.length + ' Links erkannt' : first.text + ' erkannt') +
        '</b><br><small>' + esc(hits.length > 1 ? 'Jeder Link wird ein eigener Vorschlag mit der gewählten Art.' : first.sub) + '</small>' +
        (list.length > hits.length ? '<br><small>⚠ ' + (list.length - hits.length) + ' Zeile(n) sehen nicht wie ein Link aus.</small>' : '') + '</span>';
      if (!touched) { setKind(first.kind); sync(); }
    }
    urls.addEventListener('input', detect);
    form.addEventListener('change', function (e) { if (e.target.name === 'kind') { touched = true; sync(); } });
    detect(); sync();
  }

  // Seiten, die auf JDownloader warten (Vorschlag wird geprüft): nach ein paar Sekunden neu laden
  if (document.querySelector('[data-lr-reload]')) setTimeout(function () { location.reload(); }, 5000);

  // ---------- Fortschritt ----------
  var live = document.querySelector('[data-lr-live]');
  if (live) {
    var src = live.getAttribute('data-lr-live');
    var tick = function () {
      if (!document.querySelector('[data-lr-active]')) return;
      fetch(src, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        var reload = false;
        (d.items || []).forEach(function (x) {
          var el = document.querySelector('[data-lr-id="' + x.id + '"]');
          if (!el) return;
          if (el.getAttribute('data-lr-status') !== x.status) { reload = true; return; }
          var bar = el.querySelector('.up-bar i'), txt = el.querySelector('[data-lr-pct]');
          if (bar) bar.style.width = x.pct + '%';
          if (txt) txt.textContent = x.bytes_total ? x.pct + ' % · ' + size(x.bytes_done) + ' von ' + size(x.bytes_total) + (x.eta ? ' · ' + eta(x.eta) : '') : x.statusLabel;
        });
        if (reload) location.reload();
      }).catch(function () {});
    };
    setInterval(tick, 4000);
  }
})();
