// Dancors Daddelecke (views/v3/spiele.ejs, spiel.ejs, spiel-edit.ejs): Bearbeiten-Modus der Übersicht (über public/v3-edit.js),
// Vollbild, Punkte mitgebrachter Spiele, „Schnell spielen“ an den Kartentischen und das Formular „Spiel hinzufügen“.
(function () {
  'use strict';
  var csrf = document.body.getAttribute('data-csrf') || '';
  function postJson(url, data) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin', body: JSON.stringify(data || {}),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }

  // ---------- Übersicht: Bearbeiten-Modus ----------
  var dataEl = document.getElementById('dd-edit');
  if (dataEl && window.V3Edit) {
    var data = JSON.parse(dataEl.textContent || '{}'), base = {};
    (data.games || []).forEach(function (g) { base[g.key] = g; });
    var COLORS = [['blau', 'Blau'], ['gruen', 'Grün'], ['rot', 'Rot'], ['gelb', 'Bernstein'], ['lila', 'Lila'], ['tuerkis', 'Türkis'], ['orange', 'Orange'], ['rosa', 'Rosa'], ['nacht', 'Nacht'], ['grau', 'Grau']];
    window.V3Edit.page({
      save: '/spiele/seite',
      upload: '/api/schreiben/bild',
      hint: 'Texte anklicken und ändern. Spiele und Regale ziehen, mit 🎨 Symbol, Farbe und Bild ändern, mit 🙈 ausblenden.',
      props: {
        shelves: [{ name: 'icon', label: 'Symbol', max: 8 }],
        games: [{ name: 'icon', label: 'Symbol', max: 8 }, { name: 'color', label: 'Farbe', type: 'select', options: COLORS },
          { name: 'cover', label: 'Titelbild', hint: 'ersetzt Symbol und Farbe', type: 'image' }],
      },
      propsTitle: function (item) { var t = item.querySelector('[data-ed-text="title"]'); return (t ? t.textContent : '') || 'Eigenschaften'; },
      applyProps: function (item, v) {
        item.querySelectorAll('[data-show="icon"]').forEach(function (e) { e.textContent = v.icon || '🎲'; });
        if (v.color !== undefined) item.className = item.className.replace(/\bdd-c-\S+/, 'dd-c-' + v.color);
        var cv = item.querySelector('.cv');
        if (cv && v.cover !== undefined) { cv.style.backgroundImage = v.cover ? "url('" + v.cover + "')" : ''; item.classList.toggle('has-cover', !!v.cover); }
      },
      collect: function (d) {
        var f = d.fields, shelves = d.lists.shelves || [], games = {};
        var out = {
          title: d.texts.title, text: d.texts.text,
          today: { daily: f.daily, tables: f.tables, fresh: f.fresh, pick: f.pick },
          shelves: shelves.map(function (s) {
            return { id: s.key, title: s.title, sub: s.sub, icon: s.icon, hidden: s.hidden, games: (s.games || []).map(function (g) {
              var b = base[g.key] || {}, o = {};
              ['title', 'text', 'icon', 'color', 'cover'].forEach(function (k) { if (g[k] !== undefined && String(g[k]) !== String(b[k] == null ? '' : b[k])) o[k] = g[k]; });
              if (g.hidden) o.hidden = true;
              if (Object.keys(o).length) games[g.key] = o;
              return g.key;
            }) };
          }),
        };
        out.games = games;
        return { layout: out };
      },
    });
    // ⚙️ führt im Modus trotzdem zur Bearbeiten-Seite des Spiels
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-go]');
      if (a && document.body.classList.contains('editing')) { e.preventDefault(); e.stopPropagation(); location.href = a.href; }
    }, true);
  }

  // ---------- Spielseite ----------
  var frame = document.querySelector('[data-dd-game]');
  if (frame) {
    var full = document.querySelector('[data-dd-full]'), box = document.querySelector('[data-dd-frame]');
    if (full) {
      full.addEventListener('click', function () {
        var el = box || frame;
        if (document.fullscreenElement) document.exitFullscreen();
        else if (el.requestFullscreen) el.requestFullscreen().catch(function () { location.href = frame.src; });
        else location.href = frame.src;
      });
    }
    // Punkte: das Spiel schickt postMessage({ dancor: 'score', score }) an die Seite
    var scoreUrl = frame.getAttribute('data-dd-score');
    if (scoreUrl) {
      window.addEventListener('message', function (e) {
        if (e.source !== frame.contentWindow) return;
        var m = e.data;
        if (!m || typeof m !== 'object' || m.dancor !== 'score' || typeof m.score !== 'number') return;
        postJson(scoreUrl, { score: m.score }).then(function (j) {
          var b = document.querySelector('[data-dd-board] .lb');
          if (!b || !j.board) return;
          b.innerHTML = '';
          j.board.forEach(function (r, i) {
            var row = document.createElement('div');
            if (r.me) row.className = 'me';
            [['🥇', '🥈', '🥉'][i] || (i + 1) + '.', r.name, r.value].forEach(function (t) { var s = document.createElement('span'); s.textContent = t; row.appendChild(s); });
            b.appendChild(row);
          });
          var note = b.parentNode.querySelector('.note'); if (note) note.remove();
        }).catch(function () { /* nicht angemeldet: dann eben ohne Liste */ });
      });
    }
    // Kartentische: schnell an einen Tisch mit diesem Spiel
    document.querySelectorAll('[data-dd-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        var body = new URLSearchParams({ game: b.getAttribute('data-dd-quick'), _csrf: csrf });
        fetch('/kartenspiele/schnell', { method: 'POST', body: body, credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Das ging gerade nicht.'); return j; }); })
          .then(function (j) { frame.src = '/kartenspiele?embed&look=modern&tisch=' + encodeURIComponent(j.id); })
          .catch(function (e) { window.alert(e.message); })
          .then(function () { b.disabled = false; });
      });
    });
  }

  // ---------- Formular: Art wählen ----------
  var form = document.querySelector('[data-dd-form]');
  if (form) {
    var input = form.querySelector('[data-drop-input]'), nameEl = form.querySelector('[data-drop-name]');
    var ACCEPT = { html: '.html,.htm', zip: '.zip', dos: '.zip,.jsdos', flash: '.swf' };
    var sync = function () {
      var r = form.querySelector('input[name=kind]:checked') || form.querySelector('input[name=kind]');
      var kind = r ? r.value : 'html';
      form.querySelectorAll('.fmt label').forEach(function (l) { l.classList.toggle('sel', !!l.querySelector('input:checked')); });
      form.querySelectorAll('[data-kind-show]').forEach(function (el) { el.hidden = el.getAttribute('data-kind-show').split(' ').indexOf(kind) < 0; });
      form.querySelectorAll('[data-kind-hint]').forEach(function (el) { el.hidden = el.getAttribute('data-kind-hint') !== kind; });
      if (input && ACCEPT[kind]) input.setAttribute('accept', ACCEPT[kind]);
    };
    form.addEventListener('change', function (e) { if (e.target.name === 'kind') sync(); });
    sync();
    if (input) {
      input.addEventListener('change', function () {
        if (!input.files[0]) return;
        nameEl.textContent = input.files[0].name;
        var t = form.querySelector('input[name=title]');
        if (t && !t.value) t.value = input.files[0].name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      });
      var drop = input.closest('.drop');
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('over'); }); });
    }
  }
})();
