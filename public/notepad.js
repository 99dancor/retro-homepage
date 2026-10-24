// Notizblock: reiner Text wie beim Windows-Editor. Gespeichert wird in der Datenbank (src/desk.js), höchstens so viele
// Zeichen, wie die Seitenverwaltung erlaubt. Ungespeicherte Änderungen hält der Browser als Entwurf fest (localStorage),
// falls das Fenster zugeht, bevor gespeichert ist.
(function () {
  'use strict';
  var root = document.getElementById('np');
  if (!root || !window.WinUI) return;
  var W = window.WinUI, esc = W.esc;
  var doc = JSON.parse(root.dataset.doc), MAX = Number(root.dataset.max) || 10000, member = !!root.dataset.user;
  var ta = document.getElementById('np-text'), posEl = document.getElementById('np-pos'), countEl = document.getElementById('np-count'), visEl = document.getElementById('np-vis');
  var saved = ta.value, dirty = false;
  var VIS = { private: '🔒 Nur ich', friends: '⭐ Nur Freunde', members: '👥 Angemeldete', public: '🌐 Öffentlich' };
  var draftKey = 'notizblock-entwurf:' + (doc.id || 'neu');
  var canEdit = !doc.readonly;
  var mine = doc.mine && typeof doc.id === 'number';

  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* privat */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var prefs = {};
  try { prefs = JSON.parse(read('notizblock') || '{}') || {}; } catch (e) { prefs = {}; }
  function applyPrefs() {
    root.classList.toggle('np-wrap', prefs.wrap !== false);
    root.dataset.size = prefs.size || 'normal';
  }
  applyPrefs();

  var siteTitle = document.title.split(' – ').slice(2).join(' – ');
  function title() {
    document.title = (dirty ? '*' : '') + doc.name + ' – Notizblock' + (siteTitle ? ' – ' + siteTitle : '');
  }
  function status() {
    var v = ta.value, i = ta.selectionStart || 0, before = v.slice(0, i), line = before.split('\n').length;
    posEl.textContent = 'Zeile ' + line + ', Spalte ' + (i - before.lastIndexOf('\n'));
    countEl.textContent = v.length.toLocaleString('de-DE') + ' / ' + MAX.toLocaleString('de-DE') + ' Zeichen';
    countEl.classList.toggle('np-over', v.length > MAX);
    visEl.textContent = doc.readme ? '📄 Für alle' : doc.id ? VIS[doc.vis] || '' : 'Nicht gespeichert';
  }
  function setDirty(d) { dirty = d; title(); }
  var draftTimer = 0;
  ta.addEventListener('input', function () {
    setDirty(ta.value !== saved);
    status();
    if (!canEdit) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { store(draftKey, dirty ? JSON.stringify({ body: ta.value, t: Date.now() }) : null); }, 500);
  });
  ['keyup', 'click', 'select'].forEach(function (ev) { ta.addEventListener(ev, status); });

  // Entwurf von früher anbieten
  var draftBar = document.getElementById('np-draft'), draft = null;
  try { draft = canEdit ? JSON.parse(read(draftKey) || 'null') : null; } catch (e) { draft = null; }
  if (draft && typeof draft.body === 'string' && draft.body !== saved) {
    draftBar.querySelector('b').textContent = new Date(draft.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    draftBar.hidden = false;
  } else store(draftKey, null);
  draftBar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-draft]');
    if (!b) return;
    if (b.dataset.draft === 'load') { ta.value = draft.body; setDirty(ta.value !== saved); status(); }
    else store(draftKey, null);
    draftBar.hidden = true;
    ta.focus();
  });

  function refreshDesk() { var d = W.desk(); if (d && d.refreshIcons) d.refreshIcons(); }
  function tooLong() {
    if (ta.value.length <= MAX) return false;
    W.msgbox('Das Dokument hat ' + ta.value.length.toLocaleString('de-DE') + ' Zeichen, erlaubt sind ' + MAX.toLocaleString('de-DE') + '. Kürze den Text, oder kopiere den Rest in ein zweites Dokument (Datei → Neu).', '⚠️', 'Notizblock');
    return true;
  }
  function done(item, newDoc) {
    saved = ta.value;
    store(draftKey, null);
    if (newDoc) {
      draftKey = 'notizblock-entwurf:' + item.id;
      doc = { id: item.id, name: item.name, vis: item.vis, mine: true, readonly: false, folder: item.parent };
      mine = true; canEdit = true; ta.readOnly = false;
      history.replaceState(null, '', '/notizblock/' + item.id + (location.search || ''));
    } else { doc.name = item.name; doc.vis = item.vis; }
    setDirty(false); status(); refreshDesk();
  }
  function save() {
    if (!member) return W.msgbox('Zum Speichern melde dich bitte an.', '🔑', 'Notizblock');
    if (!mine || !canEdit) return saveAs();
    if (tooLong()) return;
    return W.api('POST', '/api/notizblock/' + doc.id, { body: ta.value }).then(function (j) { done(j.item, false); })
      .catch(function (e) { W.msgbox(e.message, '⚠️', 'Notizblock'); });
  }
  function saveAs() {
    if (!member) return W.msgbox('Zum Speichern melde dich bitte an.', '🔑', 'Notizblock');
    if (tooLong()) return;
    return W.api('GET', '/api/eigene-dateien/ordner').then(function (j) {
      var name = mine ? doc.name.replace(/(\.txt)?$/i, ' (Kopie).txt') : /\.txt$/i.test(doc.name) ? doc.name : doc.name + '.txt';
      if (!doc.id) name = 'Neues Textdokument.txt';
      return W.dialog('Speichern unter', '<label>Dateiname:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(name) + '"></label>' +
        '<label>Speichern in:<select name="parent" class="w100">' + W.folderOptions(j.tree, mine ? doc.folder : 0) + '</select></label>' +
        '<label>Wer darf es lesen?' + W.visSelect('visibility', mine ? doc.vis : 'private') + '</label>',
        [{ label: 'Speichern', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }], {
          check: function (v, f) {
            if (v !== 'ok') return null;
            return W.api('POST', '/api/desktop/neu', { kind: 'text', name: f.name, parent: Number(f.parent) || 0, visibility: f.visibility, body: ta.value })
              .then(function (r) { done(r.item, true); return null; }, function (e) { return e.message; });
          },
        });
    }).catch(function (e) { W.msgbox(e.message, '⚠️', 'Notizblock'); });
  }
  function leave(go) {
    if (!dirty) return go();
    W.dialog('Notizblock', '<div class="ms-about"><span class="ms-about-icon">⚠️</span><p>Der Text in „' + esc(doc.name) + '“ wurde geändert. Änderungen speichern?</p></div>',
      [{ label: 'Speichern', value: 'save', primary: true }, { label: 'Nicht speichern', value: 'drop' }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r.value === 'drop') { store(draftKey, null); dirty = false; go(); }
      else if (r.value === 'save') { var p = save(); if (p && p.then) p.then(function () { if (!dirty) go(); }); }
    });
  }
  function openDialog() {
    if (!member) return W.msgbox('Eigene Textdokumente gibt es mit einem Konto.', '🔑', 'Notizblock');
    W.api('GET', '/api/eigene-dateien/texte').then(function (j) {
      if (!j.texts.length) return W.msgbox('Du hast noch keine Textdokumente.', 'ℹ️', 'Öffnen');
      var list = j.texts.map(function (t) {
        return '<label class="np-open"><input type="radio" name="id" value="' + t.id + '"' + (t.id === doc.id ? ' checked' : '') + '> 📄 ' + esc(t.name) + ' <small>' + W.fmtDate(t.date) + '</small></label>';
      }).join('');
      return W.dialog('Öffnen', '<div class="sunken np-open-list">' + list + '</div><p><small>' + j.texts.length + ' von ' + j.limits.texts + ' Textdokumenten</small></p>',
        [{ label: 'Öffnen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r.value === 'ok' && r.form.id) leave(function () { location.href = '/notizblock/' + r.form.id; });
      });
    }).catch(function (e) { W.msgbox(e.message, '⚠️', 'Notizblock'); });
  }
  function properties() {
    var size = new Blob([saved]).size;
    var where = !doc.id ? 'Noch nicht gespeichert' : doc.readme ? 'Desktop von allen' : doc.folder ? 'In einem Ordner' : 'Desktop';
    var html = '<table class="kv"><tr><td>Art:</td><td>Textdokument</td></tr><tr><td>Ort:</td><td>' + esc(where) + '</td></tr>' +
      '<tr><td>Größe:</td><td>' + W.fmtSize(size) + ', ' + saved.length.toLocaleString('de-DE') + ' Zeichen</td></tr></table>';
    if (!mine) return W.dialog('Eigenschaften von ' + doc.name, html);
    W.dialog('Eigenschaften von ' + doc.name, '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(doc.name) + '"></label>' + html +
      '<label>Wer darf es lesen?' + W.visSelect('visibility', doc.vis) + '</label>' +
      '<p><small>Andere öffnen das Dokument über seine Adresse: <code>' + esc(location.origin + '/notizblock/' + doc.id) + '</code></small></p>',
      [{ label: 'OK', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }], {
        check: function (v, f) {
          if (v !== 'ok') return null;
          return W.api('POST', '/api/desktop/' + doc.id, { name: f.name, visibility: f.visibility })
            .then(function (r) { doc.name = r.item.name; doc.vis = r.item.vis; title(); status(); refreshDesk(); return null; }, function (e) { return e.message; });
        },
      });
  }
  function insert(text) {
    if (!canEdit) return;
    ta.focus();
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
  function act(a) {
    ta.focus();
    switch (a) {
      case 'new': leave(function () { location.href = '/notizblock'; }); break;
      case 'open': openDialog(); break;
      case 'save': save(); break;
      case 'saveas': saveAs(); break;
      case 'props': properties(); break;
      case 'quit': leave(function () { var d = W.desk(); if (d && d.close) d.close(window); }); break;
      case 'undo': document.execCommand('undo'); break;
      case 'cut': document.execCommand('cut'); break;
      case 'copy': document.execCommand('copy'); break;
      case 'paste':
        if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(insert, function () { W.msgbox('Der Browser erlaubt das Einfügen nur mit Strg+V.', 'ℹ️', 'Notizblock'); });
        break;
      case 'del': if (canEdit) insert(''); break;
      case 'all': ta.select(); break;
      case 'date': insert(new Date().toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })); break;
      case 'wrap': prefs.wrap = prefs.wrap === false; store('notizblock', JSON.stringify(prefs)); applyPrefs(); break;
      case 'small': case 'normal': case 'big': prefs.size = a; store('notizblock', JSON.stringify(prefs)); applyPrefs(); break;
      case 'about':
        W.dialog('Info über Notizblock', '<div class="ms-about"><span class="ms-about-icon">🗒️</span><div><p><b>Notizblock</b></p><p>Reiner Text, bis zu ' + MAX.toLocaleString('de-DE') +
          ' Zeichen pro Dokument. Gespeichert wird an deinem Konto, wer mitlesen darf, stellst du unter Datei → Eigenschaften ein.</p></div></div>');
        break;
    }
  }
  var ro = !canEdit;
  W.menubar(document.getElementById('np-menu'), [
    { label: 'Datei', items: function () {
      return [{ label: 'Neu', act: 'new' }, { label: 'Öffnen…', act: 'open', key: 'Strg+O', disabled: !member }, { label: 'Speichern', act: 'save', key: 'Strg+S', disabled: !member || doc.readme },
        { label: 'Speichern unter…', act: 'saveas', disabled: !member }, '-', { label: 'Eigenschaften', act: 'props', disabled: !doc.id }, '-', { label: 'Beenden', act: 'quit' }];
    } },
    { label: 'Bearbeiten', items: function () {
      return [{ label: 'Rückgängig', act: 'undo', key: 'Strg+Z', disabled: ro }, '-', { label: 'Ausschneiden', act: 'cut', key: 'Strg+X', disabled: ro }, { label: 'Kopieren', act: 'copy', key: 'Strg+C' },
        { label: 'Einfügen', act: 'paste', key: 'Strg+V', disabled: ro }, { label: 'Löschen', act: 'del', key: 'Entf', disabled: ro }, '-',
        { label: 'Alles markieren', act: 'all', key: 'Strg+A' }, { label: 'Uhrzeit/Datum', act: 'date', key: 'F5', disabled: ro }];
    } },
    { label: 'Format', items: function () {
      return [{ label: 'Zeilenumbruch', act: 'wrap', checked: prefs.wrap !== false }, '-',
        { label: 'Schrift klein', act: 'small', checked: prefs.size === 'small' }, { label: 'Schrift normal', act: 'normal', checked: !prefs.size || prefs.size === 'normal' }, { label: 'Schrift groß', act: 'big', checked: prefs.size === 'big' }];
    } },
    { label: '?', items: [{ label: 'Info über Notizblock', act: 'about' }] },
  ], act);
  ta.readOnly = ro;

  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); openDialog(); }
    else if (e.key === 'F5' && document.activeElement === ta && canEdit) { e.preventDefault(); act('date'); }
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  title(); status();
  if (canEdit) { ta.focus(); ta.setSelectionRange(0, 0); }
})();
