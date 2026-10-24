// Gemeinsame Dialoge für den Desktop (public/desk.js) und den Explorer (public/explorer.js): Neu, Verknüpfung erstellen,
// Internetverknüpfung, Eigenschaften, Verschieben, Löschen und das Öffnen eines Eintrags.
// Fremde Websites öffnen immer in einem neuen Tab ohne Referrer, vorher fragt ein kleiner Dialog mit der Domain.
(function () {
  'use strict';
  var W = window.WinUI;
  if (!W) return;
  var esc = W.esc;
  var ICONS = ['🌐', '🔗', '⭐', '🎮', '🕹️', '🎵', '🎬', '📺', '📰', '💬', '🛒', '📚', '🛠️', '🧩', '📷', '🎨', '🏠', '💼', '📁', '❤️', '⚽', '🍕', '✈️', '🐾'];
  var KIND = { folder: 'Dateiordner', text: 'Textdokument', shortcut: 'Verknüpfung', link: 'Internetverknüpfung', sys: 'Verknüpfung (für alle)' };

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privat */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function trusted() { try { return JSON.parse(read('desk-extern-ok') || '[]') || []; } catch (e) { return []; } }

  function iconPicker(cur) {
    return '<div class="icon-pick" role="radiogroup" aria-label="Symbol">' + ICONS.map(function (ic) {
      return '<label><input type="radio" name="icon" value="' + ic + '"' + (ic === cur ? ' checked' : '') + '><span>' + ic + '</span></label>';
    }).join('') + '</div>';
  }
  function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

  // ---------- Öffnen ----------
  function openUrl(url, navigate) {
    var d = W.desk();
    if (d && d.open) d.open(url, navigate !== false); else location.href = url;
  }
  function openExternal(url) {
    var host = hostOf(url);
    function go() { var w = window.open(url, '_blank', 'noopener,noreferrer'); if (w) w.opener = null; }
    if (trusted().indexOf(host) >= 0) return go();
    W.dialog('Website verlassen?', '<div class="ms-about"><span class="ms-about-icon">🌐</span><div><p>Du öffnest eine fremde Website in einem neuen Tab:</p>' +
      '<p class="ext-host"><b>' + esc(host) + '</b></p><p><small>' + esc(url.length > 120 ? url.slice(0, 117) + '…' : url) + '</small></p>' +
      '<label class="inline"><input type="checkbox" name="trust"> Bei dieser Adresse nicht mehr fragen</label></div></div>',
      [{ label: 'Öffnen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r.value !== 'ok') return;
      if (r.form.trust) store('desk-extern-ok', JSON.stringify(trusted().concat(host).slice(-200)));
      go();
    });
  }
  function open(e) {
    if (e.broken) return W.msgbox('Das Ziel dieser Verknüpfung gibt es nicht mehr, oder du darfst es nicht sehen. Ändere es unter Eigenschaften oder lösche die Verknüpfung.', '⚠️', e.name);
    if (e.kind === 'link' || e.external) return openExternal(e.url);
    openUrl(e.url, true);
  }

  // ---------- Neu ----------
  function create(data) { return W.api('POST', '/api/desktop/neu', data).then(function (j) { return j.item; }); }
  function newLink(parent, pos) {
    return W.dialog('Internetverknüpfung erstellen', '<label>Adresse der Website:<input type="url" name="target" class="w100" placeholder="https://" required autofocus></label>' +
      '<label>Name:<input type="text" name="name" class="w100" maxlength="60" placeholder="leer = Name der Domain"></label>' +
      '<label>Symbol:</label>' + iconPicker('🌐') +
      '<p><small>Öffnet immer in einem neuen Tab. Vorher fragt die Seite nach, damit klar ist, dass du sie verlässt.</small></p>',
      [{ label: 'Fertig stellen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }], {
        check: function (v, f) {
          if (v !== 'ok') return null;
          return create(Object.assign({ kind: 'link', target: f.target, name: f.name, icon: f.icon, parent: parent }, pos || {}))
            .then(function (it) { newLink.made = it; return null; }, function (e) { return e.message; });
        },
      }).then(function (r) { var it = r.value === 'ok' ? newLink.made : null; newLink.made = null; return it; });
  }
  // Verknüpfung: Ziel suchen (gleiche Suche wie in der Taskleiste) oder eine Adresse dieser Seite einfügen
  function newShortcut(parent, pos) {
    var timer = 0, picked = null;
    return W.dialog('Verknüpfung erstellen', '<p>Wohin soll die Verknüpfung zeigen? Suche ein Programm, Forenthema, eine Modliste, ein Profil oder einen Download, oder füge eine Adresse dieser Seite ein.</p>' +
      '<label>Ziel:<input type="search" name="target" class="w100" autocomplete="off" required autofocus></label>' +
      '<div class="sunken sc-results" data-results><small class="muted">Tippe mindestens zwei Zeichen.</small></div>' +
      '<label>Name der Verknüpfung:<input type="text" name="name" class="w100" maxlength="60"></label>',
      [{ label: 'Fertig stellen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }], {
        wide: true,
        onOpen: function (form, body) {
          var box = body.querySelector('[data-results]'), inp = form.elements.target, name = form.elements.name;
          inp.addEventListener('input', function () {
            picked = null;
            clearTimeout(timer);
            var q = inp.value.trim();
            if (q.length < 2 || /^(\/|https?:)/.test(q)) { box.innerHTML = '<small class="muted">' + (q.length < 2 ? 'Tippe mindestens zwei Zeichen.' : 'Adresse wird übernommen.') + '</small>'; return; }
            timer = setTimeout(function () {
              W.api('GET', '/api/suche?n=5&q=' + encodeURIComponent(q)).then(function (j) {
                var items = [];
                j.groups.forEach(function (g) { g.items.forEach(function (it) { if (!it.external) items.push({ g: g.label, it: it }); }); });
                box.innerHTML = items.length ? items.map(function (x, i) {
                  return '<button type="button" class="sc-hit" data-i="' + i + '"><span>' + esc(x.it.icon) + '</span> <b>' + esc(x.it.name) + '</b> <small>' + esc(x.g) + '</small></button>';
                }).join('') : '<small class="muted">Nichts gefunden.</small>';
                box.onclick = function (e) {
                  var b = e.target.closest('.sc-hit');
                  if (!b) return;
                  var x = items[Number(b.dataset.i)];
                  picked = x.it;
                  inp.value = x.it.url;
                  if (!name.value) name.value = x.it.name;
                  box.querySelectorAll('.sc-hit').forEach(function (o) { o.classList.toggle('on', o === b); });
                };
              }).catch(function () { box.innerHTML = '<small class="muted">Die Suche ist gerade nicht erreichbar.</small>'; });
            }, 200);
          });
        },
        check: function (v, f) {
          if (v !== 'ok') return null;
          var target = f.target.trim();
          if (/^https?:/i.test(target) && hostOf(target) !== location.hostname) return 'Für fremde Websites nimm Neu → Internetverknüpfung.';
          return create(Object.assign({ kind: 'shortcut', target: target, name: f.name || (picked && picked.name), icon: picked && picked.icon, parent: parent }, pos || {}))
            .then(function (it) { newShortcut.made = it; return null; }, function (e) { return e.message; });
        },
      }).then(function (r) { var it = r.value === 'ok' ? newShortcut.made : null; newShortcut.made = null; return it; });
  }
  function newEntry(kind, parent, pos) {
    if (kind === 'link') return newLink(parent, pos);
    if (kind === 'shortcut') return newShortcut(parent, pos);
    return create(Object.assign({ kind: kind, parent: parent }, pos || {})).catch(function (e) { W.msgbox(e.message, '⚠️'); return null; });
  }
  // Untermenü „Neu“ für Rechtsklick und Werkzeugleiste
  function newMenu() {
    return [{ label: 'Ordner', icon: '📁', act: 'new:folder' }, '-', { label: 'Textdokument', icon: '📄', act: 'new:text' },
      { label: 'Verknüpfung…', icon: '🔗', act: 'new:shortcut' }, { label: 'Internetverknüpfung…', icon: '🌐', act: 'new:link' }];
  }

  // ---------- Eigenschaften ----------
  function update(id, data) { return W.api('POST', '/api/desktop/' + id, data).then(function (j) { return j.item; }); }
  function info(rows) {
    return '<table class="kv props">' + rows.filter(Boolean).map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>';
  }
  function properties(e) {
    var title = 'Eigenschaften von ' + e.name;
    if (e.sys || e.lib) {
      return W.dialog(title, '<div class="ms-about"><span class="ms-about-icon">' + esc(e.icon) + '</span><div>' +
        info([['Art:', esc(e.lib ? 'Datei aus der Bibliothek' : KIND.sys)], ['Ziel:', '<code>' + esc(e.url) + '</code>'],
          e.sys ? ['', '<small>Dieses Symbol hat jeder. Du kannst es vom Desktop nehmen, zurück holst du es unter Systemsteuerung → Desktop.</small>'] : null]) + '</div></div>')
        .then(function () { return null; });
    }
    var made = null, html, check;
    if (e.kind === 'folder') {
      var share = e.share ? e.share.vis : '';
      html = '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(e.name) + '"></label>' +
        '<fieldset class="groupbox"><legend>Freigabe</legend>' +
        [['', 'Nicht freigegeben (nur ich)'], ['friends', 'Für meine Freunde'], ['members', 'Für angemeldete Mitglieder'], ['public', 'Für alle mit dem Link']].map(function (o) {
          return '<label class="inline"><input type="radio" name="share" value="' + o[0] + '"' + (o[0] === share ? ' checked' : '') + '> ' + o[1] + '</label><br>';
        }).join('') +
        (e.share ? '<p><small>Link: <code>' + esc(location.origin + '/ordner/' + e.share.token) + '</code></small></p>' : '') +
        '<p><small>Die Freigabe macht nichts sichtbarer: Wer den Link öffnet, sieht nur, was er ohnehin sehen dürfte. Private Dateien bleiben privat, auch in einem freigegebenen Ordner.</small></p></fieldset>';
      check = function (f) {
        return update(e.id, { name: f.name }).then(function (it) {
          if ((f.share || '') === share) return it;
          return W.api('POST', '/api/desktop/freigabe/' + e.id, { vis: f.share || null }).then(function (j) { return j.item; });
        });
      };
    } else if (e.kind === 'text') {
      html = '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(e.name) + '"></label>' +
        info([['Art:', 'Textdokument'], ['Größe:', W.fmtSize(e.size)], ['Geändert:', W.fmtDate(e.date)]]) +
        '<label>Wer darf es lesen?' + W.visSelect('visibility', e.vis) + '</label>' +
        '<p><small>Adresse zum Teilen: <code>' + esc(location.origin + e.url) + '</code></small></p>';
      check = function (f) { return update(e.id, { name: f.name, visibility: f.visibility }); };
    } else {
      var link = e.kind === 'link';
      html = '<label>Name:<input type="text" name="name" class="w100" maxlength="60" value="' + esc(e.name) + '"></label>' +
        '<label>' + (link ? 'Adresse der Website:' : 'Ziel (Adresse auf dieser Seite):') + '<input type="' + (link ? 'url' : 'text') + '" name="target" class="w100" value="' + esc(e.url) + '"></label>' +
        (e.broken ? '<p class="msg err">✕ Das Ziel gibt es nicht mehr, oder du darfst es nicht sehen.</p>' : '') +
        (link ? '<p><small>Domain: <b>' + esc(hostOf(e.url)) + '</b></small></p>' : '') +
        '<label>Symbol:</label>' + iconPicker(e.icon) +
        (link ? '<label>Wer sieht den Link (in freigegebenen Ordnern und auf deinem Profil)?' + W.visSelect('visibility', e.vis) + '</label>' : '');
      check = function (f) { var d = { name: f.name, target: f.target, icon: f.icon || e.icon }; if (link) d.visibility = f.visibility; return update(e.id, d); };
    }
    return W.dialog(title, html, [{ label: 'OK', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }], {
      wide: e.kind !== 'text',
      check: function (v, f) { if (v !== 'ok') return null; return check(f).then(function (it) { made = it; return null; }, function (err) { return err.message; }); },
    }).then(function (r) { return r.value === 'ok' ? made : null; });
  }

  // ---------- Verschieben und Löschen ----------
  function moveTo(entries, withLib) {
    var own = entries.filter(function (e) { return !e.sys; });
    if (!own.length) return Promise.resolve(false);
    return W.api('GET', '/api/eigene-dateien/ordner').then(function (j) {
      var lib = withLib && own.every(function (e) { return e.lib; });
      return W.dialog('Verschieben nach', '<p>' + (own.length === 1 ? '„' + esc(own[0].name) + '“' : own.length + ' Objekte') + ' verschieben nach:</p>' +
        '<select name="folder" class="w100" size="8">' + (lib ? '<option value="lib">📚 Nur in der Bibliothek (aus allen Ordnern nehmen)</option>' : '') + W.folderOptions(j.tree, -1) + '</select>',
        [{ label: 'Verschieben', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
        if (r.value !== 'ok' || r.form.folder === '') return false;
        return W.api('POST', '/api/desktop/verschieben', { refs: own.map(function (e) { return e.ref; }), folder: r.form.folder === 'lib' ? 'lib' : Number(r.form.folder) })
          .then(function (res) { if (res.error) W.msgbox(res.error, '⚠️'); return true; });
      });
    }).catch(function (e) { W.msgbox(e.message, '⚠️'); return false; });
  }
  function remove(entries) {
    if (!entries.length) return Promise.resolve(false);
    var sys = entries.filter(function (e) { return e.sys; }), folders = entries.filter(function (e) { return e.kind === 'folder'; });
    var what = entries.length === 1 ? '„' + entries[0].name + '“' : entries.length + ' Objekte';
    var text = sys.length === entries.length ? what + ' vom Desktop nehmen? Zurück holst du ' + (sys.length === 1 ? 'es' : 'sie') + ' unter Systemsteuerung → Desktop.'
      : 'Soll ' + what + ' in den Papierkorb verschoben werden?';
    var buttons = [{ label: 'Ja', value: 'ok', primary: true }, { label: 'Nein', value: 'cancel' }];
    if (folders.length) {
      text = (folders.length === 1 ? 'Den Ordner „' + folders[0].name + '“' : folders.length + ' Ordner') + ' löschen? Was soll mit dem Inhalt passieren?';
      buttons = [{ label: 'Alles in den Papierkorb', value: 'ok', primary: true }, { label: 'Inhalt behalten', value: 'keep' }, { label: 'Abbrechen', value: 'cancel' }];
    }
    return W.dialog(sys.length === entries.length ? 'Vom Desktop nehmen' : 'Löschen bestätigen',
      '<div class="ms-about"><span class="ms-about-icon">🗑️</span><div><p>' + esc(text) + '</p>' +
      (folders.length ? '<p><small>„Inhalt behalten“ legt alles, was im Ordner liegt, eine Ebene höher ab. Nur der leere Ordner kommt in den Papierkorb.</small></p>' : '') + '</div></div>', buttons)
      .then(function (r) {
        if (r.value === 'cancel') return false;
        return W.api('POST', '/api/desktop/loeschen', { refs: entries.map(function (e) { return e.ref; }), keep: r.value === 'keep' }).then(function () { return true; });
      }).catch(function (e) { W.msgbox(e.message, '⚠️'); return false; });
  }
  function rename(e, name) {
    if (e.sys || e.lib || !name || name === e.name) return Promise.resolve(null);
    return update(e.id, { name: name }).catch(function (err) { W.msgbox(err.message, '⚠️'); return null; });
  }

  window.DeskUI = { open: open, openExternal: openExternal, openUrl: openUrl, newEntry: newEntry, newMenu: newMenu, properties: properties, moveTo: moveTo, remove: remove, rename: rename, KIND: KIND, ICONS: ICONS };
})();
