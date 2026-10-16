// Nutzermenü: Klick auf einen Namen (z. B. in Musik-Lobbys und am Blackjack-Tisch) öffnet ein kleines Menü wie
// ein Kontextmenü unter Windows: Profil ansehen, Freundschaft, Nachricht schreiben und was die Seite dazugibt.
// Aufruf: RetroUserMenu.open(event, 'benutzername', { note: 'Text', items: [{ label: '…', run: fn }] })
(function () {
  'use strict';
  var menu = null, CSRF = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function csrf() {
    if (CSRF) return CSRF;
    var el = document.querySelector('[data-csrf]');
    return (CSRF = el ? el.dataset.csrf : '');
  }
  // Links laufen über retro.js und öffnen so ein eigenes Fenster auf dem Desktop
  function openPage(url) { var a = document.createElement('a'); a.href = url; document.body.appendChild(a); a.click(); a.remove(); }
  function close() { if (menu) { menu.remove(); menu = null; } }
  document.addEventListener('pointerdown', function (e) { if (menu && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('blur', close);

  var FRIEND = {
    none: [{ action: 'add', label: '➕ Als Freund hinzufügen' }],
    sent: [{ action: 'cancel', label: '⏳ Anfrage zurückziehen' }],
    received: [{ action: 'accept', label: '✔ Freundschaft annehmen' }, { action: 'decline', label: '✖ Anfrage ablehnen' }],
    friends: [{ action: 'remove', label: '💔 Freund entfernen', confirm: true }],
  };
  function friend(info, action, done) {
    fetch(info.url + '/freund', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'x-csrf-token': csrf(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'action=' + encodeURIComponent(action),
    }).then(function (r) { return r.json(); }).then(function (j) { done(j.msg || 'Das ging gerade nicht.'); })
      .catch(function () { done('Das ging gerade nicht.'); });
  }

  function place(x, y) {
    var r = menu.getBoundingClientRect(), W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    menu.style.left = Math.max(2, Math.min(x, W - r.width - 2)) + 'px';
    menu.style.top = Math.max(2, Math.min(y, H - r.height - 2)) + 'px';
  }
  function render(info, opts, x, y, flash) {
    var rows = [], acts = [];
    function item(label, run, cls) { acts.push(run); rows.push('<button type="button" class="menu-item' + (cls ? ' ' + cls : '') + '" data-i="' + (acts.length - 1) + '">' + esc(label) + '</button>'); }
    var head = '<div class="um-head">' + (info.avatar ? '<img class="avatar" src="' + esc(info.avatar) + '" alt="" width="32" height="32">' :
      '<span class="avatar avatar-letter" style="width:32px;height:32px;font-size:18px;background:hsl(' + (info.id * 47 % 360) + ',45%,42%)">' + esc(([].concat(Array.from(info.name))[0] || '?').toUpperCase()) + '</span>') +
      '<div><b>' + esc(info.name) + '</b><br><small>@' + esc(info.user) + (info.admin ? ' · Admin' : '') + (info.relation === 'friends' ? ' · ⭐ Freund' : '') + '</small></div></div>';
    if (opts.note) head += '<div class="um-note">' + esc(opts.note) + '</div>';
    if (flash) head += '<div class="um-note um-flash">✔ ' + esc(flash) + '</div>';
    item(info.visible ? '👤 Profil ansehen' : '👤 Profil (nicht sichtbar)', function () { openPage(info.url); });
    if (info.me && info.relation !== 'self') {
      (FRIEND[info.relation] || []).forEach(function (f) {
        item(f.label, function () {
          if (f.confirm && !confirm(info.name + ' aus deinen Freunden entfernen?')) return false;
          friend(info, f.action, function (msg) { load(opts.username, opts, x, y, msg); });
          return false;
        });
      });
      if (info.canMessage) item('💌 Nachricht schreiben', function () { openPage('/nachrichten/' + encodeURIComponent(info.user)); });
    }
    var extra = (opts.items || []).filter(Boolean);
    if (extra.length) {
      rows.push('<hr>');
      extra.forEach(function (it) { item(it.label, it.run, it.danger ? 'danger' : ''); });
    }
    if (info.me && info.me.admin && info.relation !== 'self') {
      rows.push('<hr>');
      item('⚙️ In der Systemsteuerung', function () { window.open('/admin/users/' + info.id, '_blank'); });
    }
    menu.innerHTML = head + '<div class="um-items">' + rows.join('') + '</div>';
    menu.onclick = function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      if (acts[Number(b.dataset.i)]() !== false) close();
    };
    place(x, y);
    var first = menu.querySelector('.menu-item');
    if (first) first.focus();
  }
  function load(username, opts, x, y, flash) {
    fetch('/api/nutzer/' + encodeURIComponent(username), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        if (!menu) return;
        if (info.error) { menu.innerHTML = '<div class="um-note">' + esc(info.error) + '</div>'; return; }
        render(info, opts, x, y, flash);
      })
      .catch(function () { if (menu) menu.innerHTML = '<div class="um-note">Konnte nicht laden.</div>'; });
  }
  function open(e, username, opts) {
    if (e && e.preventDefault) e.preventDefault();
    close();
    opts = Object.assign({}, opts || {}, { username: username });
    var x = 20, y = 20;
    if (e && e.clientX != null && (e.clientX || e.clientY)) { x = e.clientX; y = e.clientY; }
    else if (e && e.target && e.target.getBoundingClientRect) { var r = e.target.getBoundingClientRect(); x = r.left; y = r.bottom; }
    menu = document.createElement('div');
    menu.className = 'usermenu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="um-note">Lädt …</div>';
    document.body.appendChild(menu);
    place(x, y);
    load(username, opts, x, y);
  }
  window.RetroUserMenu = { open: open, close: close };
})();
