// Dienste auf dem Desktop: Widget „Dienste“ (wie „Offene Lobbys“, mit belegtem Speicher), 🗄️ neben der Uhr mit Liste und
// Sprechblase, wenn ein Dienst ausfällt, und im Fenster /dienste der Knopf „Sag Bescheid“. Die Daten kommen aus /api/dienste
// (src/routes/status.js); dort steht nur, was die Seitenverwaltung für diesen Besucher freigegeben hat.
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* privat */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function csrf() { var el = document.querySelector('[data-csrf]'); return el ? el.getAttribute('data-csrf') : ''; }
  function post(url, data) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify(data || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Fehler'); return j; }); });
  }

  // ---------- Im Fenster /dienste: „Sag Bescheid“ ----------
  if (!document.body.classList.contains('desktop')) {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-watch]');
      if (!b) return;
      var on = b.getAttribute('aria-pressed') !== 'true';
      b.disabled = true;
      post('/api/dienste/' + b.dataset.watch + '/bescheid', { on: on }).then(function () {
        b.setAttribute('aria-pressed', on);
        b.textContent = on ? '🔔 Sage ich dir' : '🔔 Sag Bescheid';
        b.title = on ? 'Du bekommst eine Benachrichtigung, sobald er wieder läuft. Nochmal klicken nimmt das zurück.' : '';
      }, function (err) { alert(err.message); }).then(function () { b.disabled = false; });
    });
    return;
  }

  // ---------- Desktop ----------
  var R = window.RetroDesk, W = window.WinUI;
  var widget = document.getElementById('svcwidget'), tray = document.getElementById('svctray'), panel = document.getElementById('svcpanel');
  if (!widget && !tray) return;
  var data = {};
  try { data = JSON.parse(document.getElementById('desk-daten').textContent); } catch (e) { /* ohne */ }
  var me = data.me, timer = 0, last = null, known = {};
  // Gäste blenden das Widget im Browser aus, Mitglieder am Konto (Rechtsklick auf den Desktop oder Systemsteuerung → Desktop)
  var on = !!data.svcWidget && (me || read('dienste-widget') !== 'aus');
  try { known = JSON.parse(sessionStorage.getItem('dienste-zustand') || '{}') || {}; } catch (e) { known = {}; }

  function time() { return 'Stand ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
  function ico(i) { return W ? W.ico(i) : esc(i); }
  function row(s) {
    return '<div class="svc-row" data-state="' + esc(s.state) + '"><span class="led ' + esc(s.state) + '" aria-hidden="true"></span><span class="ic">' + ico(s.icon) + '</span>' +
      '<span class="nm" title="' + esc(s.name) + '">' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>' : esc(s.name)) + '</span>' +
      '<small class="tx" title="' + esc(s.text) + '">' + esc(s.text) + '</small></div>';
  }
  function disk(d) {
    return '<div class="disk"><span>' + esc(d.label) + '</span>' + (d.total ? '<span class="disk-bar" role="img" aria-label="' + d.pct + ' Prozent belegt"><i style="width:' + d.pct + '%"></i></span>' +
      '<small>' + esc(d.usedText) + ' / ' + esc(d.totalText) + '</small>' : '<small>' + esc(d.freeText) + ' frei</small>') + '</div>';
  }
  function draw(j) {
    last = j;
    var forWidget = j.services.filter(function (s) { return s.show.indexOf('widget') >= 0; });
    var forTray = j.services.filter(function (s) { return s.show.indexOf('tray') >= 0; });
    if (widget) {
      var list = widget.querySelector('[data-list]'), disks = widget.querySelector('[data-disks]');
      var down = forWidget.filter(function (s) { return s.state === 'down'; }).length;
      widget.querySelector('[data-n]').textContent = forWidget.length ? (down ? '(' + down + ' offline)' : '') : '';
      list.hidden = !forWidget.length;
      list.innerHTML = forWidget.map(row).join('');
      disks.hidden = !(j.storage && j.storage.length);
      disks.innerHTML = j.storage && j.storage.length ? '<div class="lob-group">💽 Belegter Speicher</div>' + j.storage.map(disk).join('') : '';
      widget.querySelector('[data-time]').textContent = time();
      if (!forWidget.length && !(j.storage && j.storage.length)) widget.hidden = true;
      place();
    }
    if (tray) {
      var bad = forTray.filter(function (s) { return s.state === 'down'; });
      tray.querySelector('.dot').hidden = !bad.length;
      tray.title = bad.length ? 'Dienste: ' + bad.length + ' offline' : 'Dienste: alles erreichbar';
      if (panel) {
        panel.querySelector('[data-list]').innerHTML = forTray.map(row).join('') || '<p class="lob-empty">Nichts zu zeigen.</p>';
        panel.querySelector('[data-time]').textContent = time();
      }
      // Sprechblase wie bei Windows, wenn ein Dienst seit dem letzten Blick ausgefallen ist (einmal pro Ausfall und Sitzung)
      var fresh = bad.filter(function (s) { return known[s.id] !== 'down:' + s.since; });
      forTray.forEach(function (s) { known[s.id] = s.state + ':' + s.since; });
      try { sessionStorage.setItem('dienste-zustand', JSON.stringify(known)); } catch (e) { /* privat */ }
      if (fresh.length) balloon(fresh);
    }
  }
  function balloon(list) {
    var old = document.querySelector('.balloon');
    if (old) old.remove();
    var b = document.createElement('div');
    b.className = 'balloon';
    b.setAttribute('role', 'status');
    b.innerHTML = '<button type="button" class="x" aria-label="Schließen">×</button><b>⚠️ ' + (list.length === 1 ? esc(list[0].name) + ' ist offline' : list.length + ' Dienste sind offline') + '</b>' +
      list.map(function (s) { return esc(s.name) + ': ' + esc(s.text); }).join('<br>') + (me ? '<br><small>Unter „Alle Dienste“ sagt dir die Seite Bescheid, wenn er wieder da ist.</small>' : '');
    document.body.appendChild(b);
    var r = tray.getBoundingClientRect();
    b.style.right = Math.max(6, window.innerWidth - r.right - 110) + 'px';
    var t = setTimeout(function () { b.remove(); }, 12000);
    b.addEventListener('click', function (e) { clearTimeout(t); b.remove(); if (!e.target.closest('.x')) togglePanel(true); });
  }
  function poll() {
    clearTimeout(timer);
    if (!document.hidden) {
      fetch('/api/dienste', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) draw(j); }, function () { /* nächstes Mal */ });
    }
    timer = setTimeout(poll, 60000);
  }

  // ---------- Widget ----------
  // Steht „Offene Lobbys“ oben rechts, rückt das Widget darunter, solange man es nicht selbst verschoben hat
  var phone = window.matchMedia('(max-width: 760px)');
  function place() {
    var lw = document.getElementById('lobbywidget');
    // Handy: beide unten über die ganze Breite, die Lobbys sitzen auf den Diensten
    if (lw) lw.style.bottom = phone.matches && widget && !widget.hidden ? (widget.offsetHeight + 14) + 'px' : '';
    if (phone.matches) { if (widget) widget.style.top = ''; return; }
    if (!widget || widget.hidden || widget.classList.contains('moved')) return;
    widget.style.top = lw && !lw.hidden && !lw.classList.contains('moved') ? (lw.offsetTop + lw.offsetHeight + 8) + 'px' : '';
  }
  function state() {
    if (!widget) return;
    widget.hidden = !on;
    if (!on) return;
    var min = read('dienste-widget-min') === '1';
    widget.classList.toggle('collapsed', min);
    widget.querySelector('[data-sw=min]').setAttribute('aria-expanded', !min);
    if (last) draw(last);
    if (R && R.placePanel) R.placePanel(widget);
    place();
  }
  if (widget) {
    if (R && R.dragPanel) R.dragPanel(widget, widget.querySelector('.titlebar'), 'dienste-widget-pos');
    widget.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sw=min]');
      if (b) {
        var min = widget.classList.toggle('collapsed');
        b.setAttribute('aria-expanded', !min);
        store('dienste-widget-min', min ? '1' : null);
        return;
      }
      var a = e.target.closest('a[data-open]');
      if (a && R) { e.preventDefault(); R.open(a.getAttribute('href'), true); }
    });
    // Rechtsklick auf den Desktop → „Dienste zeigen“ (public/desk.js)
    window.addEventListener('dienste:widget', function (e) {
      on = !!e.detail;
      if (!me) store('dienste-widget', on ? null : 'aus');
      state();
    });
    window.addEventListener('resize', place);
    new MutationObserver(place).observe(document.getElementById('lobbywidget') || widget, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }

  // ---------- 🗄️ neben der Uhr ----------
  function togglePanel(open) {
    if (!panel) return;
    if (open === undefined) open = panel.hidden;
    panel.hidden = !open;
    tray.setAttribute('aria-expanded', open);
    if (open && R && R.placePanel) R.placePanel(panel);
  }
  if (tray && panel) {
    tray.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); });
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var a = e.target.closest('a[data-open]');
      if (a && R) { e.preventDefault(); togglePanel(false); R.open(a.getAttribute('href'), true); }
    });
    document.addEventListener('click', function () { if (!panel.hidden) togglePanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { togglePanel(false); tray.focus(); } });
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  window.RetroDienste = { widgetOn: function () { return on; } };
  state();
  poll();
})();
