// 🔔 neben der Uhr: Benachrichtigungen ansehen und als gelesen markieren. Der Desktop fragt jede Minute nach.
(function () {
  'use strict';
  var btn = document.getElementById('notifybtn'), panel = document.getElementById('notifypanel');
  if (!btn || !panel) return;
  var list = document.getElementById('notifylist'), badge = btn.querySelector('.notify-count');
  var CSRF = panel.dataset.csrf, count = Number(badge.textContent) || 0, items = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(ts) {
    var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return 'gerade eben';
    if (s < 3600) return 'vor ' + Math.floor(s / 60) + ' Min.';
    if (s < 86400) return 'vor ' + Math.floor(s / 3600) + ' Std.';
    return new Date(ts * 1000).toLocaleDateString('de-DE');
  }
  function open(url) {
    if (window.RetroDesk) window.RetroDesk.open(url, true); else location.href = url;
  }
  function setCount(n) {
    if (n > count && window.RetroSound) window.RetroSound.play('hinweis');
    count = n;
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : n;
    btn.title = n ? n + ' neue Benachrichtigungen' : 'Benachrichtigungen';
    btn.classList.toggle('has-new', !!n);
  }
  function render() {
    if (!items.length) { list.innerHTML = '<p class="muted notify-empty">Nichts Neues.</p>'; return; }
    list.innerHTML = items.map(function (n) {
      return '<a href="' + esc(n.url) + '" class="notify-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '">' +
        '<b>' + esc(n.title) + (n.count > 1 ? ' <span class="tag">' + n.count + '×</span>' : '') + '</b>' +
        (n.body ? '<span>' + esc(n.body) + '</span>' : '') + '<small>' + ago(n.at) + '</small></a>';
    }).join('');
  }
  function load() {
    return fetch('/api/benachrichtigungen', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { items = j.items || []; setCount(j.unread || 0); if (!panel.hidden) render(); }).catch(function () {});
  }
  function markRead(id) {
    return fetch('/api/benachrichtigungen/gelesen', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify(id ? { id: id } : {}),
    }).then(function (r) { return r.json(); }).then(function (j) { setCount(j.unread || 0); }).catch(function () {});
  }
  function toggle(show) {
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show);
    if (show) { render(); load(); }
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var menu = document.getElementById('startmenu');
    if (menu) menu.classList.remove('open');
    toggle(panel.hidden);
  });
  panel.addEventListener('click', function (e) {
    e.stopPropagation();
    var a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      if (a.dataset.id) {
        markRead(Number(a.dataset.id));
        items.forEach(function (n) { if (n.id === Number(a.dataset.id)) n.read = true; });
      }
      toggle(false);
      open(a.getAttribute('href'));
      return;
    }
    var b = e.target.closest('[data-nact]');
    if (b && b.dataset.nact === 'read') { items.forEach(function (n) { n.read = true; }); render(); markRead(null); }
  });
  document.addEventListener('click', function () { if (!panel.hidden) toggle(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { toggle(false); btn.focus(); } });

  setInterval(function () { if (!document.hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  // Fenster melden sich, wenn sie etwas gelesen haben (z. B. ein Gespräch oder ein Forenthema geöffnet)
  window.addEventListener('message', function (e) { if (e.origin === location.origin && e.data === 'notify:refresh') load(); });
})();
