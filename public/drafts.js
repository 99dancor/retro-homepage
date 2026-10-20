// Entwürfe für Forum und Blog: „💾 Entwurf speichern“ legt Titel, Text und die übrigen Felder des Formulars
// im Konto ab (src/routes/drafts.js), „📂 Entwürfe laden“ holt sie zurück. Nach dem ersten Speichern sichert
// das Formular Änderungen nach kurzer Pause von selbst. Strg+S speichert sofort. ?entwurf=<id> lädt beim Öffnen.
(function () {
  'use strict';
  if (window.__draftsLoaded) return;
  window.__draftsLoaded = true;

  var API = '/api/entwuerfe';
  var AUTOSAVE_MS = 5000;
  var SKIP = { _csrf: 1, id: 1, draft_id: 1, title: 1, body_md: 1 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function fmt(ts) {
    var d = new Date(ts * 1000), today = new Date().toDateString() === d.toDateString();
    var time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return today ? 'heute ' + time : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + time;
  }

  document.querySelectorAll('[data-drafts]').forEach(function (bar) {
    var form = bar.closest('form');
    if (!form) return;
    var kind = bar.getAttribute('data-drafts');
    var place = bar.getAttribute('data-draft-place') || 'new';
    var csrf = (form.querySelector('input[name=_csrf]') || {}).value || '';
    var idInput = form.querySelector('input[name=draft_id]');
    var titleInput = form.querySelector('input[name=title]');
    var ta = form.querySelector('textarea[name=body_md]');
    var status = bar.querySelector('[data-draft-status]');
    var panel = bar.querySelector('[data-draft-panel]');
    var countEl = bar.querySelector('[data-draft-count]');
    var timer = null, saving = false, again = false, submitting = false;

    function say(text, isErr) { status.textContent = text; status.className = isErr ? 'err' : 'muted'; }
    function api(path, body) {
      var opt = { headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' };
      if (body) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
      return fetch(API + path, opt).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.message || (r.status === 401 ? 'Bitte erst anmelden.' : 'Das hat nicht geklappt.'));
          return j;
        });
      });
    }

    // ---------- Formular lesen und füllen ----------
    function fields() {
      var out = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        var n = el.name, t = el.type;
        if (!n || SKIP[n] || !/^[a-z_]{1,40}$/i.test(n) || t === 'file' || t === 'hidden' || t === 'submit' || t === 'button') return;
        var group = form.querySelectorAll('[name="' + n + '"]').length > 1;
        if (t === 'checkbox') {
          if (group) { out[n] = out[n] || []; if (el.checked) out[n].push(el.value); }
          else out[n] = el.checked ? el.value : '';
        } else if (t === 'radio') {
          if (!(n in out)) out[n] = '';
          if (el.checked) out[n] = el.value;
        } else if (t === 'select-multiple') {
          out[n] = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
        } else out[n] = el.value;
      });
      return out;
    }
    function state() { return { title: titleInput ? titleInput.value : '', body_md: ta ? ta.value : '', fields: fields() }; }
    function fill(d) {
      if (titleInput) titleInput.value = d.title || '';
      var f = d.fields || {};
      Array.prototype.forEach.call(form.elements, function (el) {
        var n = el.name;
        if (!n || SKIP[n] || !(n in f)) return;
        var v = f[n], list = Array.isArray(v) ? v : [v];
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = list.indexOf(el.value) >= 0;
        else if (el.type === 'select-multiple') Array.prototype.forEach.call(el.options, function (o) { o.selected = list.indexOf(o.value) >= 0; });
        else if (el.type !== 'file' && el.type !== 'hidden') el.value = list[0] == null ? '' : list[0];
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      if (ta) { ta.value = d.body_md || ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
      idInput.value = d.id;
      saved = JSON.stringify(state());
    }
    var saved = JSON.stringify(state());   // Stand beim Öffnen bzw. beim letzten Speichern
    function dirty() { return JSON.stringify(state()) !== saved; }

    // ---------- Speichern ----------
    function save(auto) {
      clearTimeout(timer);
      if (submitting) return;
      if (saving) { again = true; return; }
      var s = state();
      if (!s.title.trim() && !s.body_md.trim()) { if (!auto) say('Es gibt noch nichts zu speichern.', true); return; }
      saving = true;
      if (!auto) say('Speichere…');
      var snap = JSON.stringify(s);
      api('', { id: Number(idInput.value) || undefined, kind: kind, place: place, title: s.title, body_md: s.body_md, fields: s.fields }).then(function (r) {
        var first = !idInput.value;
        idInput.value = r.id;
        saved = snap;
        say('💾 Entwurf gespeichert (' + fmt(r.updated_at) + ')' + (first ? '. Änderungen werden ab jetzt von selbst gesichert.' : ''));
        if (first) refreshCount();
        if (!panel.hidden) showList();
      }, function (e) { say('⚠ ' + e.message, true); }).then(function () {
        saving = false;
        if (again) { again = false; save(true); }
      });
    }
    function schedule() {
      if (!idInput.value || submitting) return;
      clearTimeout(timer);
      if (dirty()) { say('Ungespeicherte Änderungen…'); timer = setTimeout(function () { save(true); }, AUTOSAVE_MS); }
    }
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    form.addEventListener('submit', function () { submitting = true; clearTimeout(timer); });
    // Wer die Seite verlässt, bevor die Pause um ist: letzten Stand noch mitschicken
    window.addEventListener('pagehide', function () {
      if (!idInput.value || submitting || saving || !dirty()) return;
      clearTimeout(timer);
      var s = state();
      try {
        fetch(API, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(idInput.value), kind: kind, place: place, title: s.title, body_md: s.body_md, fields: s.fields }) });
      } catch (e) { /* zu groß für keepalive: dann bleibt der letzte Stand */ }
    });
    form.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    });
    bar.querySelector('[data-draft-save]').addEventListener('click', function () { save(false); });

    // ---------- Laden ----------
    function load(id) {
      say('Lade Entwurf…');
      return api('/' + id).then(function (d) {
        fill(d);
        say('📂 Entwurf von ' + fmt(d.updated_at) + ' geladen.');
        panel.hidden = true;
      }, function (e) { say('⚠ ' + (e.message === 'Das hat nicht geklappt.' ? 'Diesen Entwurf gibt es nicht mehr.' : e.message), true); });
    }
    function refreshCount(list) {
      var done = function (l) { countEl.textContent = l.length ? ' (' + l.length + ')' : ''; return l; };
      return list ? Promise.resolve(done(list)) : api('?art=' + kind).then(done, function () { return []; });
    }
    function showList() {
      return api('?art=' + kind).then(function (list) {
        refreshCount(list);
        if (!list.length) { panel.innerHTML = '<p class="muted" style="margin:4px">Noch keine Entwürfe. „💾 Entwurf speichern“ legt den aktuellen Text hier ab.</p>'; return; }
        panel.innerHTML = list.map(function (d) {
          var cur = String(d.id) === idInput.value;
          return '<div class="draft-item' + (cur ? ' current' : '') + '" data-id="' + d.id + '">' +
            '<div class="draft-text"><b>' + esc(d.title || '(ohne Titel)') + '</b>' + (cur ? ' <small style="display:inline">(gerade offen)</small>' : '') +
            '<small class="muted">' + esc(d.where) + ' · ' + fmt(d.updated_at) + '</small>' +
            (d.snippet ? '<small class="muted">' + esc(d.snippet) + '</small>' : '') + '</div>' +
            '<button type="button" class="small" data-load title="' + (d.place === place ? 'In dieses Formular laden' : 'Dort öffnen, wofür der Entwurf gedacht ist') + '">' +
            (d.place === place ? '📂 Laden' : '↗ Öffnen') + '</button>' +
            '<button type="button" class="small danger" data-del title="Entwurf löschen">🗑</button></div>';
        }).join('');
        panel._list = list;
      }, function (e) { panel.innerHTML = '<p class="err" style="margin:4px">⚠ ' + esc(e.message) + '</p>'; });
    }
    bar.querySelector('[data-draft-open]').addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { panel.innerHTML = '<p class="muted" style="margin:4px">Lade…</p>'; showList(); }
    });
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('button'), item = e.target.closest('[data-id]');
      if (!btn || !item) return;
      var id = item.getAttribute('data-id');
      var d = (panel._list || []).filter(function (x) { return String(x.id) === id; })[0];
      if (btn.hasAttribute('data-del')) {
        if (!confirm('Entwurf „' + ((d && d.title) || '(ohne Titel)') + '“ löschen?')) return;
        api('/' + id + '/delete', {}).then(function () {
          if (idInput.value === id) { idInput.value = ''; clearTimeout(timer); say('Entwurf gelöscht. Der Text im Formular bleibt.'); }
          showList();
        }, function (er) { say('⚠ ' + er.message, true); });
        return;
      }
      if (dirty() && idInput.value !== id && !confirm('Deine ungespeicherten Änderungen hier gehen verloren. Trotzdem weiter?')) return;
      // Ein Entwurf für eine andere Stelle (z. B. eine Antwort in einem anderen Thema) öffnet dort
      if (d && d.place !== place) { submitting = true; clearTimeout(timer); location.href = d.url; return; }
      load(id);
    });

    // ---------- Start ----------
    var m = /[?&]entwurf=(\d+)/.exec(location.search);
    if (m) {
      load(m[1]).then(function () { refreshCount(); });
      try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])entwurf=\d+&?/, '$1').replace(/[?&]$/, '') + location.hash); } catch (e) { /* egal */ }
    } else refreshCount();
  });
})();
