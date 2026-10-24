// „Konto und Passwort“ (views/konto.ejs): Reiter wie bei Windows, OK / Abbrechen / Übernehmen für alle Formulare mit
// data-save auf einmal, Vorschau der Visitenkarte, ▲▼ und höchstens vier 📌 bei der Statistik, Töne zum Anhören.
(function () {
  'use strict';
  var root = document.getElementById('konto');
  if (!root) return;
  var CSRF = root.dataset.csrf;
  var tabs = [].slice.call(root.querySelectorAll('[role=tab]'));
  var desk = null;
  try { desk = window.parent !== window && window.parent.RetroDesk; } catch (e) { desk = null; }

  // ---------- Reiter (merkt sich den offenen in der Adresse: /konto#privatsphaere) ----------
  function show(name, focus) {
    var t = tabs.filter(function (b) { return b.dataset.tab === name; })[0];
    if (!t) return;
    tabs.forEach(function (b) {
      var on = b === t;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      document.getElementById(b.dataset.tab).hidden = !on;
    });
    if (focus) t.focus();
    // Der Sprung zur Adresse (#privatsphaere) soll nicht die Reiter aus dem Bild schieben
    scrollTo(0, 0);
    try { history.replaceState(null, '', location.pathname + '#' + name); } catch (e) { /* egal */ }
  }
  tabs.forEach(function (b, i) {
    b.addEventListener('click', function () { show(b.dataset.tab); });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      show(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true);
    });
  });
  var hash = location.hash.slice(1);
  if (hash === 'passwort') hash = 'kennwort';
  show(tabs.some(function (b) { return b.dataset.tab === hash; }) ? hash : root.dataset.tab);

  // ---------- Was ist geändert? ----------
  var forms = [].slice.call(root.querySelectorAll('form[data-save]'));
  var dirty = new Set();
  var apply = root.querySelector('[data-k=apply]'), dirtyNote = root.querySelector('[data-dirty]');
  function mark() { apply.disabled = !dirty.size; dirtyNote.hidden = !dirty.size; }
  forms.forEach(function (f) {
    ['input', 'change'].forEach(function (t) { f.addEventListener(t, function () { dirty.add(f); mark(); }); });
    // Enter in einem Textfeld speichert wie „Übernehmen“
    f.addEventListener('submit', function (e) { e.preventDefault(); save(); });
  });

  function say(text, err) {
    var box = root.querySelector('.konto-msg');
    box.innerHTML = '';
    if (!text) return;
    var d = document.createElement('div');
    d.className = 'msg' + (err ? ' err' : '');
    d.textContent = (err ? '⚠ ' : '✔ ') + text;
    box.appendChild(d);
    if (window.RetroSound && err) window.RetroSound.play('fehler');
  }
  function send(f) {
    return fetch(f.action, { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': CSRF, accept: 'application/json' }, body: new URLSearchParams(new FormData(f)) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Das ging gerade nicht.'); e.form = f; throw e; } return j; }); });
  }
  // Alle geänderten Formulare nacheinander; beim ersten Fehler zum Reiter springen
  function save() {
    var list = forms.filter(function (f) { return dirty.has(f); }), msgs = [];
    if (!list.length) return Promise.resolve(true);
    apply.disabled = true;
    return list.reduce(function (p, f) {
      return p.then(function () { return send(f).then(function (j) { dirty.delete(f); if (j.msg) msgs.push(j.msg); }); });
    }, Promise.resolve()).then(function () {
      say(msgs.join(' ') || 'Gespeichert.');
      mark();
      // Neuer Name oder Status: Startmenü und Messenger ziehen beim nächsten Laden nach, die Kontaktliste sofort
      try { if (window.parent.RetroMessenger) window.parent.RetroMessenger.reload(); } catch (e) { /* egal */ }
      return true;
    }, function (err) {
      if (err.form) show(err.form.closest('.tab-page').id);
      say(err.message, true);
      mark();
      return false;
    });
  }
  function closeWin() {
    if (desk && desk.close) desk.close(window);
  }
  root.querySelector('.konto-foot').addEventListener('click', function (e) {
    var b = e.target.closest('[data-k]');
    if (!b) return;
    if (b.dataset.k === 'apply') save();
    else if (b.dataset.k === 'ok') save().then(function (ok) { if (ok) { if (desk) closeWin(); } });
    else if (b.dataset.k === 'cancel') {
      if (dirty.size && !confirm('Änderungen verwerfen?')) return;
      forms.forEach(function (f) { f.reset(); });
      dirty.clear(); mark(); preview();
      if (desk) closeWin(); else location.href = '/einstellungen';
    }
  });
  addEventListener('beforeunload', function (e) { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Profil: Zeichen zählen, Visitenkarte ----------
  var about = document.getElementById('about'), count = root.querySelector('[data-count-for=about]');
  function preview() {
    if (about && count) count.textContent = about.value.length + ' / ' + about.maxLength;
    root.querySelectorAll('[data-preview]').forEach(function (inp) {
      var out = root.querySelector('[data-show=' + inp.dataset.preview + ']');
      if (!out) return;
      var v = inp.value.trim();
      out.textContent = inp.dataset.preview === 'name' ? (v || inp.placeholder) : v ? '„' + v + '“' : '';
    });
  }
  root.addEventListener('input', preview);
  preview();
  // Profilbild: Nach der Auswahl schneidet avatar-crop.js zu und schickt ab; GIFs gehen direkt
  var pic = root.querySelector('form[data-avatar-crop]');
  if (pic && window.DataTransfer) {
    pic.querySelector('[data-upload]').style.display = 'none';
    pic.querySelector('input[type=file]').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f && f.type === 'image/gif') pic.submit();
    });
  }

  // ---------- Statistik ----------
  root.addEventListener('click', function (e) {
    var m = e.target.closest('[data-move]');
    if (m) {
      var g = m.closest('.stat-game'), dir = Number(m.dataset.move);
      var sib = dir < 0 ? g.previousElementSibling : g.nextElementSibling;
      if (sib) { g.parentNode.insertBefore(g, dir < 0 ? sib : sib.nextElementSibling); dirty.add(g.closest('form')); mark(); }
      return;
    }
    var p = e.target.closest('[data-play]');
    if (p && window.RetroSound) {
      var sel = document.getElementById(p.dataset.play), v = sel.value, kind = sel.dataset.soundKind;
      var xp = document.documentElement.classList.contains('theme-xp');
      if (v === 'aus') return;
      window.RetroSound.play(v === 'klassisch' ? (kind === 'nudge' ? 'msgr-summen' : (kind === 'online' ? 'msgr-online-' : 'msgr-') + (xp ? 'icu' : 'dsn')) : 'msgr-' + v);
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.name !== 'pin' || !e.target.checked) return;
    if (root.querySelectorAll('input[name=pin]:checked').length > 4) { e.target.checked = false; alert('In die Vitrine passen höchstens vier Werte.'); }
  });
})();
