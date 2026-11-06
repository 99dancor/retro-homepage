// Galerie (views/gallery.ejs): Explorer mit Baum, Miniaturen und XP-Aufgabenleiste, Hochladen mit Fortschritt pro Bild,
// Alben anlegen und bearbeiten, Bildbetrachter wie die Windows Bild- und Faxanzeige (blättern, Diashow, zoomen, drehen,
// Infos, Kommentare, Desktophintergrund). Daten kommen als JSON von src/routes/gallery.js.
(function () {
  'use strict';
  var root = document.getElementById('gx');
  if (!root) return;
  var W = window.WinUI, esc = W.esc;
  var $ = function (s, el) { return (el || root).querySelector(s); };
  var tree = $('[data-gx-tree]'), pane = $('[data-gx-pane]'), tasks = $('[data-gx-tasks]'), pathEl = $('[data-gx-path]');
  var statusEl = $('[data-gx-status]'), quotaEl = $('[data-gx-quota]');
  var start = JSON.parse(root.dataset.start || '{}'), maxMb = Number(root.dataset.maxmb) || 60;
  var siteSuffix = document.title.replace(/^[^–]*/, ' ').replace(/^\s+/, ' ');
  var data = null, ort = start.ort || 'alle', q = start.q || '', items = [], sel = [], anchor = null, sortBy = null, backStack = [];
  var narrow = function () { return window.matchMedia('(max-width: 640px)').matches; };
  var VIS = [['private', '🔒 Nur ich'], ['friends', '🤝 Nur Freunde'], ['members', '👥 Mitglieder'], ['public', '🌐 Öffentlich']];
  var VIS_TXT = { private: 'Nur ich', friends: 'Nur Freunde', members: 'Mitglieder', public: 'Öffentlich' };
  var VIS_IC = { private: '🔒', friends: '🤝', members: '👥', public: '🌐' };

  function fmtDay(t) { return t ? new Date(t * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function visSelect(name, cur) {
    return '<select name="' + name + '">' + VIS.map(function (v) { return '<option value="' + v[0] + '"' + (v[0] === cur ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select>';
  }
  function download(url) { var a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
  function hint(text) { statusEl.textContent = text; }
  function fail(e) { W.msgbox(e && e.message ? e.message : String(e), '⚠️'); }

  // ---------- Laden ----------
  function load(nextOrt, nextQ, opts) {
    opts = opts || {};
    if (!opts.keepBack && data && (nextOrt !== ort || nextQ !== q)) backStack.push([ort, q]);
    var keepSel = opts.keepSel ? sel.slice() : [];
    return W.api('GET', '/galerie/api/ansicht?ort=' + encodeURIComponent(nextOrt) + (nextQ ? '&q=' + encodeURIComponent(nextQ) : '')).then(function (d) {
      if (d.node !== ort) sortBy = null;
      data = d; ort = d.node; q = d.q || '';
      items = d.items || [];
      sel = keepSel.filter(function (r) { return items.some(function (it) { return it.ref === r; }); });
      var url = '/galerie' + (ort === 'alle' ? '' : '?ort=' + encodeURIComponent(ort)) + (q ? (ort === 'alle' ? '?' : '&') + 'q=' + encodeURIComponent(q) : '');
      try { history.replaceState(null, '', url); } catch (e) { /* egal */ }
      document.title = 'Galerie' + (d.title && ort !== 'alle' ? ' – ' + d.title : '') + siteSuffix;
      render();
      return d;
    }).catch(function (e) {
      if (opts.fallback !== false && nextOrt !== 'alle') return load('alle', '', { keepBack: true, fallback: false });
      pane.innerHTML = '<p class="msg err">⚠ ' + esc(e.message) + '</p>';
    });
  }
  function reload() { return load(ort, q, { keepBack: true, keepSel: true }); }
  function render() {
    var qi = $('[data-gx-search] input');
    if (qi && document.activeElement !== qi) qi.value = ort === 'suche' ? q : '';
    renderTree(); renderPath(); renderPane(); renderTasks(); renderStatus(); renderToolbar();
  }

  // ---------- Baum ----------
  function node(key, label, n, extra) {
    return '<a href="#" class="ex-node' + (ort === key ? ' current' : '') + '" data-ort="' + esc(key) + '">' + label + (n != null ? ' <small>(' + n + ')</small>' : '') + (extra || '') + '</a>';
  }
  function renderTree() {
    var t = data.tree, h = '<ul class="tree"><li><a href="#" class="ex-node" data-ort="alle">🖼️ <b>Galerie</b></a><ul>';
    h += '<li>' + node('alle', '🗂️ Alle Bilder', t.all) + '</li>';
    h += '<li>' + node('neu', '🆕 Neu hinzugefügt', t.fresh) + '</li>';
    h += '<li>' + node('alben', '📚 Alben', t.albums.length);
    if (t.albums.length) {
      h += '<ul>' + t.albums.map(function (a) {
        return '<li>' + node('a:' + a.id, (a.vis === 'private' ? '🔒 ' : '📁 ') + esc(a.title), a.count, a.shared ? ' <span title="Gemeinsames Album">👥</span>' : '').replace('class="ex-node', 'data-drop-album="' + a.id + '" class="ex-node') + '</li>';
      }).join('') + '</ul>';
    }
    h += '</li>';
    if (t.paint !== null) h += '<li>' + node('paint', '🎨 Paint-Bilder', t.paint) + '</li>';
    if (t.members.length) {
      h += '<li class="ex-group">👥 Von Mitgliedern<ul>' + t.members.map(function (m) { return '<li>' + node('u:' + m.user, '👤 ' + esc(m.name), m.n) + '</li>'; }).join('') + '</ul></li>';
    }
    h += '</ul></li>';
    if (t.mine !== null) h += '<li>' + node('mein', '⭐ Meine Bilder', t.mine) + '<ul><li>' + node('ohne', '🗃️ Ohne Album', t.loose).replace('class="ex-node', 'data-drop-album="0" class="ex-node') + '</li></ul></li>';
    tree.innerHTML = h + '</ul>';
  }
  tree.addEventListener('click', function (e) {
    var a = e.target.closest('[data-ort]');
    if (!a) return;
    e.preventDefault();
    root.classList.remove('tree-open');
    load(a.dataset.ort, '');
  });
  // Bilder auf ein Album im Baum ziehen
  tree.addEventListener('dragover', function (e) {
    var a = e.target.closest('[data-drop-album]');
    if (!a || !dragRefs) return;
    e.preventDefault();
    tree.querySelectorAll('.drop-on').forEach(function (x) { if (x !== a) x.classList.remove('drop-on'); });
    a.classList.add('drop-on');
  });
  tree.addEventListener('dragleave', function (e) { var a = e.target.closest('[data-drop-album]'); if (a) a.classList.remove('drop-on'); });
  tree.addEventListener('drop', function (e) {
    var a = e.target.closest('[data-drop-album]');
    tree.querySelectorAll('.drop-on').forEach(function (x) { x.classList.remove('drop-on'); });
    if (!a || !dragRefs) return;
    e.preventDefault();
    moveTo(dragRefs, Number(a.dataset.dropAlbum));
    dragRefs = null;
  });

  function renderPath() {
    var p = '<a href="#" data-ort="alle">🖼️ Galerie</a>';
    if (ort.indexOf('a:') === 0) p += ' › <a href="#" data-ort="alben">📚 Alben</a> › 📁 ' + esc(data.title);
    else if (ort === 'ohne') p += ' › <a href="#" data-ort="mein">⭐ Meine Bilder</a> › 🗃️ Ohne Album';
    else if (ort.indexOf('u:') === 0) p += ' › 👥 Von Mitgliedern › 👤 ' + esc(data.owner ? data.owner.name : data.title);
    else if (ort === 'suche') p += ' › 🔍 „' + esc(q) + '“';
    else if (ort !== 'alle') p += ' › ' + esc(data.icon) + ' ' + esc(data.title);
    pathEl.innerHTML = p;
  }
  pathEl.addEventListener('click', function (e) { var a = e.target.closest('[data-ort]'); if (a) { e.preventDefault(); load(a.dataset.ort, ''); } });

  // ---------- Mitte ----------
  function sorted() {
    var s = sortBy || (data.album ? 'aufnahme' : 'neu');
    var key = function (it) { return s === 'aufnahme' ? (it.taken || it.date) : it.date; };
    return items.slice().sort(function (a, b) {
      if (s === 'name') return a.title.localeCompare(b.title, 'de', { numeric: true });
      if (s === 'alt' || s === 'aufnahme') return key(a) - key(b) || a.id - b.id;
      return key(b) - key(a) || b.id - a.id;
    });
  }
  function rotStyle(r) { return r ? ' style="transform:rotate(' + r + 'deg)"' : ''; }
  function tile(it) {
    var badge = (it.k === 'p' ? '🎨' : '') + (it.comments ? ' 💬' + it.comments : '') + (it.mine && it.vis === 'private' ? ' 🔒' : '') + (it.pending ? ' ⏳' : '');
    return '<div class="gx-t' + (sel.indexOf(it.ref) >= 0 ? ' sel' : '') + '" tabindex="0" data-ref="' + it.ref + '"' + (it.canEdit ? ' draggable="true"' : '') + ' title="' + esc(it.name + ' · von ' + it.by) + '">' +
      '<div class="fr"><img src="' + esc(it.thumb) + '" alt="" loading="lazy" draggable="false"' + rotStyle(it.rot) + '></div>' +
      '<span>' + esc(it.title) + '</span>' + (badge ? '<small>' + badge + '</small>' : '') + '</div>';
  }
  function albumCard(a) {
    var imgs = a.covers.slice(0, 3).reverse().map(function (src) { return '<img src="' + esc(src) + '" alt="" loading="lazy">'; }).join('');
    return '<a href="#" class="gx-a" data-ort="a:' + a.id + '">' +
      '<div class="st' + (a.covers.length ? '' : ' empty') + '">' + (imgs || '<span>📁</span>') + '</div>' +
      '<b>' + esc(a.title) + '</b><small>' + plural(a.count, 'Bild', 'Bilder') + ' · ' + VIS_IC[a.vis] + ' ' + VIS_TXT[a.vis] + (a.shared ? ' · 👥 gemeinsam' : '') + '<br>von ' + esc(a.by) + '</small></a>';
  }
  function renderPane() {
    var h = '';
    if (data.mode === 'albums') {
      h += '<div class="gx-head"><div><h2>📚 Alben</h2><small>' + plural(data.albums.length, 'Album', 'Alben') + '</small></div><span class="spacer"></span>' +
        (data.canUpload ? '<button type="button" class="small" data-gx="newalbum">📁 Neues Album</button>' : '') + '</div>';
      h += data.albums.length ? '<div class="gx-alb">' + data.albums.map(albumCard).join('') + '</div>'
        : '<p class="muted ex-empty">Noch keine Alben.' + (data.canUpload ? '<br><button type="button" class="small" data-gx="newalbum">📁 Erstes Album anlegen</button>' : '') + '</p>';
      pane.innerHTML = h;
      return;
    }
    var a = data.album, list = sorted();
    var s = sortBy || (a ? 'aufnahme' : 'neu');
    var sortSel = '<label class="gx-sort">Sortieren: <select data-gx-sort>' + [['aufnahme', 'Aufnahmedatum'], ['neu', 'Neueste zuerst'], ['alt', 'Älteste zuerst'], ['name', 'Name']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === s ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
    if (a) {
      var cover = a.covers[0];
      h += '<div class="gx-head">' + (cover ? '<img class="cover" src="' + esc(cover) + '" alt="">' : '<span class="cover none">📁</span>') +
        '<div class="gx-hinfo"><h2>📁 ' + esc(a.title) + '</h2><small>' + plural(a.count, 'Bild', 'Bilder') + ' · von ' + esc(a.by) +
        (a.contributors.length ? ', mit ' + esc(a.contributors.join(', ')) : '') + ' · ' + VIS_IC[a.vis] + ' ' + VIS_TXT[a.vis] +
        (a.shared ? ' · 👥 Andere dürfen hinzufügen' : '') + (a.comments ? '' : ' · Kommentare aus') + '</small>' +
        (a.description ? '<p class="gx-desc">' + esc(a.description) + '</p>' : '') + '</div>' + sortSel + '</div>';
    } else {
      h += '<div class="gx-head"><div class="gx-hinfo"><h2>' + esc(data.icon) + ' ' + esc(ort === 'suche' ? 'Suche nach „' + q + '“' : data.title) + '</h2><small>' + plural(items.length, 'Bild', 'Bilder') + '</small></div>' + sortSel + '</div>';
    }
    if (!list.length) {
      var can = data.canUpload && (!a || a.canAdd) && ort !== 'paint' && ort !== 'suche';
      h += '<p class="muted ex-empty">' + (ort === 'suche' ? 'Nichts gefunden.' : ort === 'paint' ? 'Noch keine Paint-Bilder. Mal eins in 🎨 Paint und speichere es für Mitglieder oder öffentlich.' : 'Hier sind noch keine Bilder.') +
        (can ? '<br><button type="button" class="small" data-gx="upload">📤 Bilder hinzufügen</button>' : '') + (!data.me && ort !== 'suche' ? '<br><small>Angemeldete Mitglieder sehen hier mehr und können eigene Bilder hochladen.</small>' : '') + '</p>';
    } else h += '<div class="gx-grid" data-gx-grid>' + list.map(tile).join('') + '</div>';
    pane.innerHTML = h;
  }
  pane.addEventListener('change', function (e) {
    if (e.target.matches('[data-gx-sort]')) { sortBy = e.target.value; renderPane(); }
  });
  pane.addEventListener('click', function (e) {
    var al = e.target.closest('.gx-a[data-ort]');
    if (al) { e.preventDefault(); load(al.dataset.ort, ''); return; }
  });

  // ---------- Auswahl ----------
  function item(ref) { for (var i = 0; i < items.length; i++) if (items[i].ref === ref) return items[i]; return null; }
  function selected() { return sel.map(item).filter(Boolean); }
  function paintSel() {
    pane.querySelectorAll('.gx-t').forEach(function (el) { el.classList.toggle('sel', sel.indexOf(el.dataset.ref) >= 0); el.setAttribute('aria-selected', sel.indexOf(el.dataset.ref) >= 0); });
    renderTasks(); renderStatus(); renderToolbar();
  }
  function select(ref, e) {
    var order = sorted().map(function (it) { return it.ref; });
    if (e && e.shiftKey && anchor) {
      var i = order.indexOf(anchor), j = order.indexOf(ref);
      sel = order.slice(Math.min(i, j), Math.max(i, j) + 1);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      var k = sel.indexOf(ref);
      if (k >= 0) sel.splice(k, 1); else sel.push(ref);
      anchor = ref;
    } else { sel = ref ? [ref] : []; anchor = ref; }
    paintSel();
  }
  var touch = false;
  pane.addEventListener('pointerdown', function (e) { touch = e.pointerType !== 'mouse'; }, true);
  pane.addEventListener('click', function (e) {
    var t = e.target.closest('.gx-t');
    if (!t) { if (!e.target.closest('button, select, a, label')) select(null); return; }
    if (touch && !e.ctrlKey) { sel = [t.dataset.ref]; paintSel(); openViewer(t.dataset.ref); return; }
    select(t.dataset.ref, e);
  });
  pane.addEventListener('dblclick', function (e) { var t = e.target.closest('.gx-t'); if (t) openViewer(t.dataset.ref); });
  pane.addEventListener('keydown', function (e) {
    var t = e.target.closest('.gx-t');
    if (e.key === 'a' && (e.ctrlKey || e.metaKey) && !e.target.matches('input, textarea, select')) { e.preventDefault(); sel = items.map(function (it) { return it.ref; }); paintSel(); return; }
    if (!t) return;
    if (e.key === 'Enter') { e.preventDefault(); openViewer(t.dataset.ref); }
    else if (e.key === ' ') { e.preventDefault(); select(t.dataset.ref, e); }
    else if (e.key === 'Delete') { e.preventDefault(); if (sel.indexOf(t.dataset.ref) < 0) select(t.dataset.ref); act('delete'); }
    else if (e.key === 'F2') { e.preventDefault(); select(t.dataset.ref); act('rename'); }
    else if (/^Arrow/.test(e.key)) {
      var all = [].slice.call(pane.querySelectorAll('.gx-t')), i = all.indexOf(t);
      var cols = Math.max(1, Math.round(pane.querySelector('[data-gx-grid]').clientWidth / t.offsetWidth));
      var j = i + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols })[e.key];
      if (all[j]) { e.preventDefault(); all[j].focus(); select(all[j].dataset.ref, e.shiftKey ? e : null); }
    }
  });
  pane.addEventListener('contextmenu', function (e) {
    var t = e.target.closest('.gx-t');
    if (!t) return;
    e.preventDefault();
    if (sel.indexOf(t.dataset.ref) < 0) select(t.dataset.ref);
    W.contextMenu(e.clientX, e.clientY, menuFor(selected()), act);
  });
  var dragRefs = null;
  pane.addEventListener('dragstart', function (e) {
    var t = e.target.closest('.gx-t');
    if (!t) return;
    if (sel.indexOf(t.dataset.ref) < 0) select(t.dataset.ref);
    dragRefs = selected().filter(function (it) { return it.canEdit; }).map(function (it) { return it.ref; });
    try { e.dataTransfer.setData('text/plain', dragRefs.join(',')); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* egal */ }
  });
  pane.addEventListener('dragend', function () { setTimeout(function () { dragRefs = null; }, 0); });

  // ---------- Aufgaben rechts ----------
  function box(title, links) {
    links = links.filter(Boolean);
    if (!links.length) return '';
    return '<section class="gx-box"><h4>' + title + '</h4><div>' + links.map(function (l) {
      return '<a href="#" data-act="' + l[0] + '">' + l[1] + '</a>';
    }).join('') + '</div></section>';
  }
  function details(list) {
    var a = data.album, dl = [];
    if (list.length === 1) {
      var it = list[0];
      var h = '<b class="gx-dname">' + esc(it.name) + '</b>';
      if (it.w) dl.push(it.w + ' × ' + it.h + ' · ' + W.fmtSize(it.size));
      if (it.taken) dl.push('Aufgenommen ' + fmtDay(it.taken));
      dl.push((it.k === 'p' ? 'Gemalt von ' : 'Hochgeladen von ') + esc(it.by) + (it.with ? ' mit ' + esc(it.with) : '') + ' am ' + fmtDay(it.date));
      if (it.album && !a) dl.push('📁 ' + esc(it.album.title));
      if (it.k === 'f') dl.push('📍 Ortsangaben entfernt');
      dl.push('Sichtbar für: ' + VIS_IC[it.vis] + ' ' + VIS_TXT[it.vis] + (it.album ? ' (wie das Album)' : ''));
      if (it.comments) dl.push('💬 ' + plural(it.comments, 'Kommentar', 'Kommentare'));
      return h + dl.map(function (x) { return '<span>' + x + '</span>'; }).join('');
    }
    if (list.length > 1) {
      var size = list.reduce(function (n, it) { return n + (it.size || 0); }, 0);
      return '<b>' + plural(list.length, 'Bild', 'Bilder') + ' ausgewählt</b><span>' + W.fmtSize(size) + ' zusammen</span>';
    }
    if (a) {
      return '<b>📁 ' + esc(a.title) + '</b><span>' + plural(a.count, 'Bild', 'Bilder') + '</span><span>Von ' + esc(a.by) + '</span><span>Sichtbar für: ' + VIS_IC[a.vis] + ' ' + VIS_TXT[a.vis] + '</span>' +
        (a.shared ? '<span>👥 Andere Mitglieder dürfen Bilder hinzufügen</span>' : '') + '<span>' + (a.comments ? '💬 Kommentare erlaubt' : 'Kommentare aus') + '</span>';
    }
    return '<b>' + esc(data.icon + ' ' + data.title) + '</b><span>' + (data.mode === 'albums' ? plural(data.albums.length, 'Album', 'Alben') : plural(items.length, 'Bild', 'Bilder')) + '</span>' +
      (data.quota ? '<span>Dein Speicher: ' + W.fmtSize(data.quota.used) + ' von ' + W.fmtSize(data.quota.total) + '</span>' : '');
  }
  function renderTasks() {
    var list = selected(), one = list.length === 1 ? list[0] : null, a = data.album;
    var canAddHere = data.canUpload && ort !== 'paint' && (!a || a.canAdd);
    var mineSel = list.filter(function (it) { return it.canEdit; });
    var h = box('Bildaufgaben', [
      canAddHere && ['upload', '📤 Bilder hinzufügen'],
      items.length && data.mode !== 'albums' && ['show', '▶ Als Diashow anzeigen'],
      a && a.count && ['zip', '⬇ Album herunterladen (ZIP)'],
      one && ['dl', '⬇ Bild herunterladen'],
      one && ['wallpaper', '🖼️ Als Desktophintergrund'],
      one && ['link', '🔗 Link kopieren'],
    ]);
    if (list.length) {
      h += box(one ? 'Dieses Bild' : 'Ausgewählte Bilder', [
        one && ['view', '👁 Ansehen'],
        one && one.paint && ['paint', '🎨 In Paint öffnen'],
        one && one.canEdit && ['rename', '✎ Umbenennen'],
        one && one.canEdit && ['rotr', '↻ Rechts drehen'],
        mineSel.length && data.addable.length && ['move', '📁 In Album verschieben…'],
        list.some(function (it) { return it.canUnalbum; }) && ['unalbum', '📤 Aus dem Album nehmen'],
        one && a && a.canEdit && one.album && one.album.id === a.id && ['cover', '⭐ Als Titelbild des Albums'],
        mineSel.length && ['delete', '🗑 Löschen'],
      ]);
    }
    h += box('Albumaufgaben', [
      data.canUpload && ['newalbum', '📁 Neues Album'],
      a && a.canEdit && ['editalbum', '✎ Album bearbeiten'],
      a && a.canEdit && ['sharealbum', '👥 Wer darf hinzufügen?'],
      a && a.canEdit && ['delalbum', '🗑 Album löschen'],
      !a && ort !== 'alben' && ['go-alben', '📚 Alle Alben'],
    ]);
    h += '<section class="gx-box"><h4>Details</h4><div class="gx-det">' + details(list) + '</div></section>';
    tasks.innerHTML = h;
  }
  tasks.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (!a) return;
    e.preventDefault();
    act(a.dataset.act);
  });
  function renderStatus() {
    var list = selected();
    statusEl.textContent = list.length === 1 ? list[0].name + (list[0].size ? ' · ' + W.fmtSize(list[0].size) : '')
      : list.length ? plural(list.length, 'Bild', 'Bilder') + ' ausgewählt'
      : data.mode === 'albums' ? plural(data.albums.length, 'Album', 'Alben') : plural(items.length, 'Bild', 'Bilder');
    quotaEl.textContent = data.quota ? 'Speicher: ' + W.fmtSize(data.quota.used) + ' von ' + W.fmtSize(data.quota.total) : '';
    quotaEl.hidden = !data.quota;
  }
  function renderToolbar() {
    var a = data.album;
    $('[data-gx=back]').disabled = !backStack.length;
    $('[data-gx=upload]').hidden = !data.canUpload;
    $('[data-gx=newalbum]').hidden = !data.canUpload;
    $('[data-gx-sep]').hidden = !data.canUpload;
    $('[data-gx=show]').disabled = !items.length || data.mode === 'albums';
    $('[data-gx=dl]').disabled = !(sel.length === 1 || (a && a.count && !sel.length));
    $('[data-gx=dl]').textContent = sel.length || !a ? '⬇ Herunterladen' : '⬇ Album (ZIP)';
  }
  root.querySelector('.ex-toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-gx]');
    if (!b) return;
    var what = b.dataset.gx;
    if (what === 'back') { var p = backStack.pop(); if (p) load(p[0], p[1], { keepBack: true }); }
    else if (what === 'tree') { var open = root.classList.toggle('tree-open'); b.setAttribute('aria-expanded', open); }
    else if (what === 'dl') act(sel.length ? 'dl' : 'zip');
    else act(what);
  });
  pane.addEventListener('click', function (e) { var b = e.target.closest('button[data-gx]'); if (b) act(b.dataset.gx); });
  $('[data-gx-search]').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = this.q.value.trim();
    load(v.length >= 2 ? 'suche' : 'alle', v.length >= 2 ? v : '');
  });

  function menuFor(list) {
    var one = list.length === 1 ? list[0] : null, a = data.album, mine = list.filter(function (it) { return it.canEdit; });
    return [
      one && { label: 'Ansehen', act: 'view', bold: true },
      { label: 'Diashow ab hier', act: 'show-here', hidden: !one },
      one && one.paint && { label: 'In Paint öffnen', act: 'paint' },
      '-',
      { label: 'Herunterladen', act: 'dl', hidden: !one },
      { label: 'Als Desktophintergrund', act: 'wallpaper', hidden: !one },
      { label: 'Link kopieren', act: 'link', hidden: !one },
      '-',
      { label: 'Rechts drehen', act: 'rotr', hidden: !(one && one.canEdit) },
      { label: 'Links drehen', act: 'rotl', hidden: !(one && one.canEdit) },
      { label: 'Umbenennen', act: 'rename', key: 'F2', hidden: !(one && one.canEdit) },
      { label: 'In Album verschieben…', act: 'move', hidden: !mine.length || !data.addable.length },
      { label: 'Aus dem Album nehmen', act: 'unalbum', hidden: !list.some(function (it) { return it.canUnalbum; }) },
      { label: 'Als Titelbild des Albums', act: 'cover', hidden: !(one && a && a.canEdit && one.album) },
      '-',
      { label: 'Löschen', act: 'delete', key: 'Entf', hidden: !mine.length },
    ].filter(Boolean);
  }

  // ---------- Aktionen ----------
  function act(what) {
    var list = selected(), one = list.length === 1 ? list[0] : null, a = data.album;
    switch (what) {
      case 'upload': return uploadDialog();
      case 'newalbum': return albumDialog(null).then(function (al) { if (al) load('a:' + al.id, ''); });
      case 'editalbum': case 'sharealbum': return a && albumDialog(a).then(function (al) { if (al) reload(); });
      case 'delalbum': return a && deleteAlbum(a);
      case 'go-alben': return load('alben', '');
      case 'show': return items.length && openViewer((one || sorted()[0]).ref, true);
      case 'show-here': return one && openViewer(one.ref, true);
      case 'view': return one && openViewer(one.ref);
      case 'zip': if (a) download('/galerie/album/' + a.id + '/zip'); return;
      case 'dl': if (one) download(one.dl); return;
      case 'paint': if (one && one.paint) openWin(one.paint); return;
      case 'wallpaper': return one && wallpaper(one);
      case 'link': return one && copyLink(one);
      case 'rename': return one && rename(one);
      case 'rotr': case 'rotl': return one && rotate(one, what === 'rotr' ? 1 : -1);
      case 'move': return moveDialog(list.filter(function (it) { return it.canEdit; }));
      case 'unalbum': return moveTo(list.filter(function (it) { return it.canUnalbum; }).map(function (it) { return it.ref; }), 0);
      case 'cover': return one && a && W.api('POST', '/galerie/album/' + a.id, { cover: one.id }).then(function () { hint('Titelbild gesetzt.'); reload(); }, fail);
      case 'delete': return deletePhotos(list.filter(function (it) { return it.canEdit; }));
    }
  }
  function openWin(url) { var d = W.desk(); if (d && d.open) d.open(url, true); else location.href = url; }
  function linkOf(it) { return location.origin + (it.k === 'p' ? it.page : '/galerie?bild=' + it.id); }
  function copyLink(it) {
    var url = linkOf(it);
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { hint('Link kopiert: ' + url); },
      function () { W.dialog('Link', '<p>Link zum Bild:</p><input type="text" value="' + esc(url) + '" readonly style="width:100%">'); });
  }
  function rename(it) {
    return W.dialog('Umbenennen', '<label>Name des Bildes<br><input type="text" name="title" maxlength="120" value="' + esc(it.title) + '" required style="width:100%"></label>',
      [{ label: 'OK', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r.value !== 'ok' || !r.form.title.trim() || r.form.title.trim() === it.title) return;
      return W.api('POST', '/galerie/foto/' + it.id, { title: r.form.title }).then(function () { return reload(); }, fail);
    });
  }
  function rotate(it, dir) {
    return W.api('POST', '/galerie/foto/' + it.id, { rotate: dir }).then(function (r) {
      Object.assign(it, r.photo);
      var img = pane.querySelector('.gx-t[data-ref="' + it.ref + '"] img');
      if (img) img.style.transform = it.rot ? 'rotate(' + it.rot + 'deg)' : '';
      return it;
    }, fail);
  }
  function albumOptions(cur, withNone) {
    return (withNone ? '<option value="0">— Ohne Album —</option>' : '') + data.addable.map(function (a) {
      return '<option value="' + a.id + '"' + (a.id === cur ? ' selected' : '') + '>' + esc(a.title) + (a.mine ? '' : ' (von ' + esc(a.by) + ')') + '</option>';
    }).join('');
  }
  function moveDialog(list) {
    if (!list.length) return;
    var cur = data.album ? data.album.id : 0;
    return W.dialog('In Album verschieben', '<p>' + plural(list.length, 'Bild', 'Bilder') + ' verschieben nach:</p><select name="album" style="width:100%">' + albumOptions(cur, true) + '</select>',
      [{ label: 'Verschieben', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r.value === 'ok') moveTo(list.map(function (it) { return it.ref; }), Number(r.form.album));
    });
  }
  function moveTo(refs, albumId) {
    var ids = refs.map(item).filter(function (it) { return it && it.k === 'f'; }).map(function (it) { return it.id; });
    if (!ids.length) return;
    return W.api('POST', '/galerie/fotos', { action: 'move', ids: ids, album: albumId }).then(function (r) {
      hint(r.done ? plural(r.done, 'Bild', 'Bilder') + (albumId ? ' verschoben.' : ' aus dem Album genommen.') : 'Nichts verschoben.');
      if (r.error) W.msgbox(r.error, 'ℹ️');
      return reload();
    }, fail);
  }
  function deletePhotos(list) {
    if (!list.length) return;
    var paintOnes = list.filter(function (it) { return it.k === 'p'; });
    list = list.filter(function (it) { return it.k === 'f'; });
    if (!list.length) { W.msgbox('Paint-Bilder löschst du in 🎨 Paint unter Datei → Öffnen.', 'ℹ️'); return; }
    return W.confirm((list.length === 1 ? '„' + list[0].title + '“' : plural(list.length, 'Bild', 'Bilder')) + ' endgültig löschen? Das lässt sich nicht rückgängig machen.' +
      (paintOnes.length ? ' (Paint-Bilder bleiben, die löschst du in Paint.)' : ''), '🗑', 'Löschen', 'Bilder löschen').then(function (ok) {
      if (!ok) return;
      return W.api('POST', '/galerie/fotos', { action: 'delete', ids: list.map(function (it) { return it.id; }) }).then(function (r) {
        hint(plural(r.done, 'Bild', 'Bilder') + ' gelöscht.');
        sel = [];
        return reload();
      }, fail);
    });
  }

  // ---------- Alben ----------
  function albumDialog(al) {
    var v = al || { title: '', description: '', vis: 'members', shared: false, comments: true };
    var html = '<div class="gx-form">' +
      '<label>Name<br><input type="text" name="title" maxlength="80" required value="' + esc(v.title) + '" placeholder="z. B. Urlaub 2026"></label>' +
      '<label>Beschreibung <small class="muted">(freiwillig)</small><br><textarea name="description" rows="3" maxlength="500">' + esc(v.description || '') + '</textarea></label>' +
      '<label>Sichtbar für<br>' + visSelect('visibility', v.vis) + '</label>' +
      '<label class="inline"><input type="checkbox" name="shared"' + (v.shared ? ' checked' : '') + '> 👥 Gemeinsames Album: alle, die es sehen, dürfen Bilder hinzufügen</label>' +
      '<label class="inline"><input type="checkbox" name="comments"' + (v.comments ? ' checked' : '') + '> 💬 Kommentare an den Bildern erlauben</label>' +
      '<p class="muted"><small>Alle Bilder im Album sind so sichtbar wie das Album. Bei „Nur ich“ kann niemand sonst hinzufügen.</small></p></div>';
    var result = null;
    return W.dialog(al ? 'Album bearbeiten' : 'Neues Album', html, [{ label: al ? 'Speichern' : 'Anlegen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }], {
      check: function (value, f) {
        if (value !== 'ok') return null;
        if (!f.title.trim()) return 'Gib dem Album einen Namen.';
        return W.api('POST', al ? '/galerie/album/' + al.id : '/galerie/alben', { title: f.title, description: f.description, visibility: f.visibility, shared: f.shared, comments: f.comments })
          .then(function (r) { result = r.album; return null; }, function (e) { return e.message; });
      },
    }).then(function () { return result; });
  }
  function deleteAlbum(a) {
    return W.dialog('Album löschen', '<div class="ms-about"><span class="ms-about-icon">🗑</span><p>Album „' + esc(a.title) + '“ löschen?</p></div>' +
      '<label class="inline"><input type="checkbox" name="withPhotos"> Die Bilder ' + (a.contributors.length ? 'von ' + esc(a.by) + ' ' : '') + 'darin auch löschen</label>' +
      '<p class="muted"><small>Sonst bleiben sie unter „Meine Bilder → Ohne Album“ ihrer Besitzer, mit der Sichtbarkeit des Albums.' + (a.contributors.length ? ' Bilder anderer Mitglieder bleiben immer bei ihnen.' : '') + '</small></p>',
      [{ label: 'Löschen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }]).then(function (r) {
      if (r.value !== 'ok') return;
      return W.api('POST', '/galerie/album/' + a.id + '/loeschen', { withPhotos: r.form.withPhotos }).then(function () { backStack = []; load('alben', '', { keepBack: true }); }, fail);
    });
  }

  // ---------- Hochladen ----------
  var IMG_RE = /\.(jpe?g|png|gif|webp|heic|heif)$/i;
  function isImage(f) { return /^image\//.test(f.type) || IMG_RE.test(f.name); }
  function decode(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
    return Promise.reject(new Error('alt'));
  }
  function scaled(bmp, max) {
    var s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  function toBlob(c, q) { return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', q); }); }
  // Vorschau (360 px) und, bei großen Fotos, eine mittlere Größe (1600 px) für den Betrachter
  function sizes(file) {
    return decode(file).then(function (bmp) {
      var big = !/gif$/i.test(file.type) && (Math.max(bmp.width, bmp.height) > 2000 || file.size > 2.5 * 1024 * 1024);
      return toBlob(scaled(bmp, 360), 0.82).then(function (thumb) {
        if (!big) { bmp.close && bmp.close(); return { thumb: thumb }; }
        return toBlob(scaled(bmp, 1600), 0.85).then(function (medium) { bmp.close && bmp.close(); return { thumb: thumb, medium: medium }; });
      });
    }).catch(function () { return {}; });
  }
  function send(fd, onProgress, holder) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      holder.xhr = x;
      x.open('POST', '/galerie/hochladen');
      x.setRequestHeader('x-csrf-token', W.csrf());
      x.setRequestHeader('Accept', 'application/json');
      x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var j = {};
        try { j = JSON.parse(x.responseText); } catch (e) { /* kein JSON */ }
        if (x.status >= 200 && x.status < 300) resolve(j);
        else reject(new Error(j.error || (x.status === 413 ? 'Zu groß.' : 'Fehler ' + x.status)));
      };
      x.onerror = function () { reject(new Error('Keine Verbindung.')); };
      x.onabort = function () { reject(new Error('Abgebrochen.')); };
      x.send(fd);
    });
  }
  function uploadDialog(preset) {
    if (!data.canUpload) return W.msgbox('Zum Hochladen melde dich bitte an.', 'ℹ️');
    var queue = [], cancelled = false, holder = {}, uploaded = 0, lastAlbum = null;
    var cur = data.album && data.album.canAdd ? data.album.id : 0;
    var html = '<div class="gx-up">' +
      '<div class="gx-drop" data-up-drop><b>📥 Bilder hierher ziehen</b><br><small>oder</small><br>' +
      '<button type="button" class="small" data-up-pick>🖼️ Bilder auswählen…</button> <button type="button" class="small" data-up-dir>📂 Ganzen Ordner…</button>' +
      '<input type="file" accept="image/*,.heic,.heif" multiple hidden data-up-files><input type="file" multiple hidden webkitdirectory data-up-folder>' +
      '<br><small class="muted">JPG, PNG, GIF, WebP und HEIC (iPhone, wird zu JPG), bis ' + maxMb + ' MB pro Bild.</small></div>' +
      '<div class="gx-uprow"><label>Album<br><select name="album" data-up-album>' + albumOptions(cur, true) + '<option value="new">➕ Neues Album…</option></select></label>' +
      '<label data-up-newname hidden>Name des neuen Albums<br><input type="text" name="newTitle" maxlength="80" placeholder="z. B. Grillabend"></label>' +
      '<label data-up-vis>Sichtbar für<br>' + visSelect('visibility', 'members') + '</label></div>' +
      '<label class="inline"><input type="checkbox" name="keepDate" checked> Aufnahmedatum behalten (Ortsangaben, Kamera und Seriennummer werden immer entfernt)</label>' +
      '<div class="gx-queue" data-up-queue><p class="muted" data-up-empty>Noch keine Bilder ausgewählt.</p></div>' +
      (data.quota ? '<small class="muted">Dein Speicher: ' + W.fmtSize(data.quota.used) + ' von ' + W.fmtSize(data.quota.total) + ' belegt.</small>' : '') + '</div>';
    var dlgEl = null;
    function addFiles(files) {
      var qEl = dlgEl.querySelector('[data-up-queue]'), empty = dlgEl.querySelector('[data-up-empty]');
      [].forEach.call(files, function (f) {
        if (!isImage(f)) return;
        if (queue.some(function (x) { return x.file.name === f.name && x.file.size === f.size; })) return;
        var row = document.createElement('div');
        row.className = 'gx-q';
        row.innerHTML = '<span class="gx-qimg">🖼️</span><span class="gx-qname" title="' + esc(f.webkitRelativePath || f.name) + '">' + esc(f.name) + '<small>' + W.fmtSize(f.size) + '</small></span>' +
          '<span class="gx-bar"><i style="width:0"></i></span><span class="gx-qst">Wartet</span><button type="button" class="small" data-up-x title="Entfernen">×</button>';
        var entry = { file: f, el: row, state: 'wait', prep: null };
        row.querySelector('[data-up-x]').addEventListener('click', function () {
          if (entry.state === 'busy') return;
          queue.splice(queue.indexOf(entry), 1); row.remove();
          if (empty) empty.hidden = queue.length > 0;
        });
        queue.push(entry);
        qEl.appendChild(row);
        if (f.size > maxMb * 1048576) { entry.state = 'error'; setRow(entry, 0, 'Zu groß', true); return; }
        // Vorschau gleich malen; dieselben Bilder gehen später mit hoch
        entry.prep = sizes(f).then(function (s) {
          if (s.thumb) { var u = URL.createObjectURL(s.thumb); row.querySelector('.gx-qimg').innerHTML = '<img src="' + u + '" alt="">'; }
          return s;
        });
      });
      if (empty) empty.hidden = queue.length > 0;
      var n = queue.filter(function (x) { return x.state === 'wait'; }).length;
      var btn = dlgEl.querySelector('.wui-primary');
      if (btn) btn.textContent = n ? plural(n, 'Bild', 'Bilder') + ' hochladen' : 'Hochladen';
    }
    function setRow(entry, pct, text, bad) {
      entry.el.querySelector('.gx-bar i').style.width = Math.round(pct * 100) + '%';
      var st = entry.el.querySelector('.gx-qst');
      st.textContent = text; st.title = text;
      entry.el.classList.toggle('bad', !!bad);
      entry.el.classList.toggle('ok', pct >= 1 && !bad);
    }
    function uploadAll(f) {
      var albumP;
      if (f.album === 'new') {
        if (!f.newTitle.trim()) return Promise.resolve('Gib dem neuen Album einen Namen.');
        albumP = W.api('POST', '/galerie/alben', { title: f.newTitle, visibility: f.visibility, shared: false, comments: true }).then(function (r) {
          data.addable.unshift({ id: r.album.id, title: r.album.title, mine: true, by: r.album.by, vis: r.album.vis });
          var s = dlgEl.querySelector('[data-up-album]');
          s.insertAdjacentHTML('afterbegin', '');
          s.querySelector('option[value="0"]').insertAdjacentHTML('afterend', '<option value="' + r.album.id + '">' + esc(r.album.title) + '</option>');
          s.value = String(r.album.id);
          s.dispatchEvent(new Event('change'));
          return r.album.id;
        });
      } else albumP = Promise.resolve(Number(f.album) || 0);
      var btn = dlgEl.querySelector('.wui-primary');
      if (btn) btn.disabled = true;
      return albumP.then(function (albumId) {
        lastAlbum = albumId;
        var todo = queue.filter(function (x) { return x.state === 'wait'; }), errors = 0, dups = 0;
        return todo.reduce(function (p, entry) {
          return p.then(function () {
            if (cancelled) return;
            entry.state = 'busy';
            setRow(entry, 0, 'Bereite vor…');
            return (entry.prep || Promise.resolve({})).then(function (s) {
              setRow(entry, 0, 'Lädt hoch…');
              var fd = new FormData();
              fd.append('album', String(albumId));
              fd.append('visibility', f.visibility);
              fd.append('keepDate', f.keepDate ? '1' : '0');
              if (s.thumb) fd.append('thumb', s.thumb, 'v.jpg');
              if (s.medium) fd.append('medium', s.medium, 'm.jpg');
              fd.append('file', entry.file, entry.file.name);
              return send(fd, function (pct) { setRow(entry, pct * 0.95, pct >= 1 ? 'Wird verarbeitet…' : Math.round(pct * 100) + ' %'); }, holder);
            }).then(function (r) {
              entry.state = 'done'; uploaded++;
              if (r.dup) dups++;
              setRow(entry, 1, r.dup ? 'Schon da' : '✔ Fertig');
            }, function (e) {
              entry.state = cancelled ? 'wait' : 'error'; errors++;
              setRow(entry, 0, e.message, true);
            });
          });
        }, Promise.resolve()).then(function () {
          if (btn) btn.disabled = false;
          if (cancelled) return null;
          if (errors) {
            queue.forEach(function (x) { if (x.state === 'error') x.state = 'wait'; });
            return plural(errors, 'Bild ging', 'Bilder gingen') + ' nicht (siehe Liste). Mit „Hochladen“ versuchst du sie noch einmal, × nimmt sie heraus.';
          }
          if (dups) hint(plural(dups, 'Bild war', 'Bilder waren') + ' schon da und ' + (dups === 1 ? 'wurde' : 'wurden') + ' übersprungen.');
          return null;
        });
      }, function (e) { if (btn) btn.disabled = false; return e.message; });
    }
    return W.dialog('Bilder hinzufügen', html, [{ label: 'Hochladen', value: 'ok', primary: true }, { label: 'Schließen', value: 'cancel' }], {
      wide: true, select: false,
      onOpen: function (form) {
        dlgEl = form.closest('dialog');
        dlgEl.classList.add('gx-updlg');
        dlgEl.addEventListener('close', function onClose() { cancelled = true; if (holder.xhr) holder.xhr.abort(); dlgEl.removeEventListener('close', onClose); dlgEl.classList.remove('gx-updlg'); }, { once: true });
        var pick = form.querySelector('[data-up-files]'), dir = form.querySelector('[data-up-folder]');
        form.querySelector('[data-up-pick]').addEventListener('click', function () { pick.click(); });
        form.querySelector('[data-up-dir]').addEventListener('click', function () { dir.click(); });
        pick.addEventListener('change', function () { addFiles(pick.files); pick.value = ''; });
        dir.addEventListener('change', function () { addFiles(dir.files); dir.value = ''; });
        var drop = form.querySelector('[data-up-drop]');
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
        drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('on'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
        var albumSel = form.querySelector('[data-up-album]');
        var sync = function () {
          var v = albumSel.value;
          form.querySelector('[data-up-newname]').hidden = v !== 'new';
          // Bilder in einem Album sind so sichtbar wie das Album; die Auswahl gilt nur für Bilder ohne Album und neue Alben
          form.querySelector('[data-up-vis]').hidden = v !== 'new' && v !== '0';
        };
        albumSel.addEventListener('change', sync);
        sync();
        if (preset && preset.length) addFiles(preset);
      },
      check: function (value, f) {
        if (value !== 'ok') return null;
        if (!queue.some(function (x) { return x.state === 'wait'; })) return uploaded ? null : 'Wähle erst Bilder aus.';
        return uploadAll(f);
      },
    }).then(function () {
      if (!uploaded) return;
      hint(plural(uploaded, 'Bild', 'Bilder') + ' hinzugefügt.');
      if (lastAlbum && ort !== 'a:' + lastAlbum) return load('a:' + lastAlbum, '');
      if (!lastAlbum && ort !== 'ohne' && ort !== 'mein' && ort !== 'alle' && ort !== 'neu') return load('ohne', '');
      return reload();
    });
  }
  // Bilder auf das Fenster ziehen öffnet „Bilder hinzufügen“
  var dropzone = $('[data-gx-drop]'), dragDepth = 0;
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  root.addEventListener('dragenter', function (e) { if (!hasFiles(e) || !data || !data.canUpload || document.querySelector('dialog[open]')) return; dragDepth++; dropzone.hidden = false; });
  root.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropzone.hidden = true; });
  root.addEventListener('dragover', function (e) { if (hasFiles(e) && !dropzone.hidden) e.preventDefault(); });
  root.addEventListener('drop', function (e) {
    if (!hasFiles(e) || dropzone.hidden) return;
    e.preventDefault(); dragDepth = 0; dropzone.hidden = true;
    uploadDialog(e.dataTransfer.files);
  });

  // ---------- Desktophintergrund ----------
  function wallpaper(it) {
    var D = window.RetroDisplay;
    if (!D || !D.setWallpaper) return;
    hint('Bereite das Hintergrundbild vor…');
    fetch(it.src, { credentials: 'same-origin' }).then(function (r) { return r.blob(); }).then(function (b) { return createImageBitmap(b); }).then(function (bmp) {
      var maxW = Math.min(2560, Math.round(screen.width * (window.devicePixelRatio || 1))), maxH = Math.min(1600, Math.round(screen.height * (window.devicePixelRatio || 1)));
      var turned = it.rot === 90 || it.rot === 270, w = turned ? bmp.height : bmp.width, h = turned ? bmp.width : bmp.height;
      var s = Math.min(1, Math.max(maxW / w, maxH / h)), c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      var g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2); g.rotate((it.rot || 0) * Math.PI / 180);
      var dw = bmp.width * s, dh = bmp.height * s;
      g.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
      var q = 0.85, url = c.toDataURL('image/jpeg', q);
      while (url.length > 3.5e6 && q > 0.4) { q -= 0.15; url = c.toDataURL('image/jpeg', q); }
      if (D.setWallpaper(url, 'cover')) hint('Als Desktophintergrund gesetzt. Ändern kannst du ihn unter 🖥️ neben der Uhr.');
      else W.msgbox('Das Bild passt nicht in den Speicher des Browsers. Probiere ein kleineres.', '⚠️');
    }).catch(function () { W.msgbox('Das Bild ließ sich nicht als Hintergrund setzen.', '⚠️'); });
  }

  // ---------- Bildbetrachter ----------
  var V = null;
  function openViewer(ref, slideshow) {
    var list = sorted();
    var i = list.findIndex(function (it) { return it.ref === ref; });
    if (i < 0) return;
    if (!V) buildViewer();
    V.list = list; V.i = i; V.el.hidden = false; root.classList.add('gx-viewing');
    show(i);
    if (slideshow) toggleShow(true);
    V.el.focus();
  }
  function closeViewer() {
    if (!V) return;
    toggleShow(false);
    V.el.hidden = true; root.classList.remove('gx-viewing');
    var it = V.list[V.i];
    if (it) { sel = [it.ref]; paintSel(); var t = pane.querySelector('.gx-t[data-ref="' + it.ref + '"]'); if (t) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'nearest' }); } }
  }
  function buildViewer() {
    var el = document.createElement('div');
    el.className = 'gx-view';
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Bildbetrachter');
    el.innerHTML = '<div class="gx-vtop"><span data-v-title></span><span class="spacer"></span><span data-v-count></span><button type="button" class="small" data-v="close" title="Schließen (Esc)">✕ Schließen</button></div>' +
      '<div class="gx-vmid"><div class="gx-stage" data-v-stage><img alt="" data-v-img draggable="false"><span class="gx-vload" data-v-load hidden>Lädt …</span>' +
      '<button type="button" class="gx-vnav prev" data-v="prev" aria-label="Vorheriges Bild">‹</button><button type="button" class="gx-vnav next" data-v="next" aria-label="Nächstes Bild">›</button></div>' +
      '<aside class="gx-side" data-v-side hidden></aside></div>' +
      '<div class="gx-film" data-v-film></div>' +
      '<div class="gx-vbar">' +
      '<button type="button" data-v="prev" title="Vorheriges Bild (←)">◀</button><button type="button" data-v="next" title="Nächstes Bild (→)">▶</button><span class="ex-sep"></span>' +
      '<button type="button" data-v="fit" title="Ganzes Bild (0)">🔲</button><button type="button" data-v="one" title="Originalgröße (1)">1:1</button>' +
      '<button type="button" data-v="zin" title="Vergrößern (+)">🔍+</button><button type="button" data-v="zout" title="Verkleinern (−)">🔍−</button><span class="ex-sep"></span>' +
      '<button type="button" data-v="rotr" title="Rechts drehen (R)">↻</button><button type="button" data-v="rotl" title="Links drehen (L)">↺</button><span class="ex-sep"></span>' +
      '<button type="button" data-v="show" title="Diashow (Leertaste)">▶ Diashow</button><button type="button" data-v="info" title="Infos (I)">ℹ Infos</button>' +
      '<button type="button" data-v="comments" title="Kommentare (K)">💬</button><span class="ex-sep"></span>' +
      '<button type="button" data-v="dl" title="Herunterladen">⬇</button><button type="button" data-v="wall" title="Als Desktophintergrund">🖼️</button>' +
      '<button type="button" data-v="paint" title="In Paint öffnen">🎨</button><button type="button" data-v="del" title="Löschen (Entf)">🗑</button></div>';
    root.appendChild(el);
    V = { el: el, img: el.querySelector('[data-v-img]'), stage: el.querySelector('[data-v-stage]'), side: el.querySelector('[data-v-side]'), film: el.querySelector('[data-v-film]'),
      z: 1, fit: true, px: 0, py: 0, timer: null, panel: null, list: [], i: 0 };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (b) vAct(b.dataset.v);
      var f = e.target.closest('[data-film]');
      if (f) show(Number(f.dataset.film));
    });
    el.addEventListener('keydown', function (e) {
      if (e.target.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
      var k = { ArrowLeft: 'prev', ArrowRight: 'next', Escape: 'close', ' ': 'show', '+': 'zin', '-': 'zout', '0': 'fit', '1': 'one', r: 'rotr', l: 'rotl', i: 'info', k: 'comments', Delete: 'del', Home: 'first', End: 'last' }[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); vAct(k); }
    });
    V.img.addEventListener('load', function () { el.querySelector('[data-v-load]').hidden = true; layout(); });
    V.img.addEventListener('error', function () { el.querySelector('[data-v-load]').textContent = 'Bild lässt sich nicht laden.'; });
    window.addEventListener('resize', function () { if (!el.hidden) layout(); });
    // Mausrad zoomt, Ziehen verschiebt das vergrößerte Bild, Wischen blättert
    V.stage.addEventListener('wheel', function (e) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    var drag = null;
    V.stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, px: V.px, py: V.py, moved: false };
      V.stage.setPointerCapture(e.pointerId);
    });
    V.stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!V.fit || V.z > 1) { V.px = drag.px + dx; V.py = drag.py + dy; place(); }
    });
    V.stage.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (V.fit && V.z === 1 && Math.abs(dx) > 50) vAct(dx < 0 ? 'next' : 'prev');
      else if (!drag.moved && e.pointerType === 'mouse' && e.detail === 2) vAct(V.fit && V.z === 1 ? 'one' : 'fit');
      drag = null;
    });
  }
  function cur() { return V.list[V.i]; }
  function show(i) {
    var n = V.list.length;
    if (!n) return closeViewer();
    V.i = (i + n) % n;
    var it = cur();
    V.z = 1; V.fit = true; V.px = V.py = 0;
    V.el.querySelector('[data-v-load]').hidden = false;
    V.el.querySelector('[data-v-load]').textContent = 'Lädt …';
    V.img.style.visibility = 'hidden';
    V.img.src = it.src;
    V.el.querySelector('[data-v-title]').textContent = it.name + (it.by ? ' · von ' + it.by : '');
    V.el.querySelector('[data-v-count]').textContent = (V.i + 1) + ' von ' + n;
    var has = function (k, on) { V.el.querySelectorAll('[data-v=' + k + ']').forEach(function (b) { b.hidden = !on; }); };
    has('rotr', it.canEdit); has('rotl', it.canEdit); has('del', it.canEdit); has('paint', !!it.paint); has('comments', it.k === 'f');
    has('prev', n > 1); has('next', n > 1); has('show', n > 1);
    // Filmstreifen: das Bild und ein paar Nachbarn
    var from = Math.max(0, Math.min(V.i - 5, n - 11)), h = '';
    for (var j = from; j < Math.min(n, from + 11); j++) {
      var x = V.list[j];
      h += '<button type="button" class="' + (j === V.i ? 'on' : '') + '" data-film="' + j + '" title="' + esc(x.title) + '"><img src="' + esc(x.thumb) + '" alt=""' + rotStyle(x.rot) + '></button>';
    }
    V.film.innerHTML = h;
    // Nächstes Bild schon laden
    if (n > 1) { var pre = new Image(); pre.src = V.list[(V.i + 1) % n].src; }
    if (V.panel) panel(V.panel);
    sel = [it.ref];
  }
  function dims() {
    var it = cur(), w = it.w || V.img.naturalWidth || 1, h = it.h || V.img.naturalHeight || 1;
    return { w: w, h: h };
  }
  function fitScale() {
    var d = dims(), sw = V.stage.clientWidth - 16, sh = V.stage.clientHeight - 16, turned = cur().rot % 180 !== 0;
    var bw = turned ? d.h : d.w, bh = turned ? d.w : d.h;
    return Math.min(1, sw / bw, sh / bh);
  }
  function layout() { place(); V.img.style.visibility = ''; }
  function place() {
    var d = dims(), s = (V.fit ? fitScale() : 1) * V.z;
    V.img.style.width = d.w * s + 'px'; V.img.style.height = d.h * s + 'px';
    V.img.style.transform = 'translate(-50%, -50%) translate(' + V.px + 'px, ' + V.py + 'px) rotate(' + (cur().rot || 0) + 'deg)';
    V.stage.classList.toggle('zoomed', !V.fit || V.z > 1);
  }
  function zoom(f) { V.z = Math.max(0.1, Math.min(16, V.z * f)); if (V.fit && V.z <= 1) { V.px = V.py = 0; } place(); }
  function toggleShow(on) {
    if (!V) return;
    if (on === undefined) on = !V.timer;
    clearInterval(V.timer); V.timer = null;
    if (on && V.list.length > 1) V.timer = setInterval(function () { show(V.i + 1); }, 4000);
    V.el.classList.toggle('slideshow', !!V.timer);
    V.el.querySelectorAll('[data-v=show]').forEach(function (b) { b.textContent = V.timer ? '⏸ Pause' : '▶ Diashow'; });
  }
  function vAct(k) {
    var it = cur();
    switch (k) {
      case 'close': return closeViewer();
      case 'prev': return show(V.i - 1);
      case 'next': return show(V.i + 1);
      case 'first': return show(0);
      case 'last': return show(V.list.length - 1);
      case 'fit': V.fit = true; V.z = 1; V.px = V.py = 0; return place();
      case 'one': V.fit = false; V.z = 1; V.px = V.py = 0; return place();
      case 'zin': return zoom(1.25);
      case 'zout': return zoom(0.8);
      case 'rotr': case 'rotl':
        if (!it.canEdit) return;
        return rotate(it, k === 'rotr' ? 1 : -1).then(function () { place(); var f = V.film.querySelector('.on img'); if (f) f.style.transform = it.rot ? 'rotate(' + it.rot + 'deg)' : ''; });
      case 'show': return toggleShow();
      case 'info': case 'comments': return panel(V.panel === k ? null : k);
      case 'dl': return download(it.dl);
      case 'wall': return wallpaper(it);
      case 'paint': if (it.paint) openWin(it.paint); return;
      case 'del':
        if (!it.canEdit || it.k !== 'f') return;
        return W.confirm('„' + it.title + '“ endgültig löschen?', '🗑', 'Löschen', 'Bild löschen').then(function (ok) {
          if (!ok) return;
          return W.api('POST', '/galerie/foto/' + it.id + '/loeschen', {}).then(function () {
            V.list.splice(V.i, 1);
            items = items.filter(function (x) { return x.ref !== it.ref; });
            if (!V.list.length) { closeViewer(); return reload(); }
            show(V.i);
            reload();
          }, fail);
        });
    }
  }
  function panel(which) {
    V.panel = which;
    V.side.hidden = !which;
    V.el.querySelectorAll('[data-v=info], [data-v=comments]').forEach(function (b) { b.classList.toggle('pressed', b.dataset.v === which); });
    if (!which) { layout(); return; }
    var it = cur();
    if (which === 'info') {
      var dl = [['Name', it.name], ['Größe', it.w ? it.w + ' × ' + it.h + ' Pixel' : ''], ['Datei', W.fmtSize(it.size)]];
      if (it.taken) dl.push(['Aufgenommen', W.fmtDate(it.taken)]);
      dl.push([it.k === 'p' ? 'Gemalt' : 'Hochgeladen', W.fmtDate(it.date)], ['Von', it.by + (it.with ? ' mit ' + it.with : '')]);
      if (it.album) dl.push(['Album', it.album.title]);
      dl.push(['Sichtbar für', VIS_IC[it.vis] + ' ' + VIS_TXT[it.vis]]);
      V.side.innerHTML = '<h3>ℹ Infos</h3><dl>' + dl.filter(function (x) { return x[1]; }).map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
        (it.k === 'f' ? '<p class="muted"><small>📍 Ortsangaben, Kamera und Seriennummer hat der Server beim Hochladen aus der Datei entfernt.</small></p>' : '') +
        '<p><button type="button" class="small" data-v-link>🔗 Link kopieren</button>' + (it.page ? ' <a class="btn small" href="' + esc(it.page) + '">Seite des Bildes</a>' : '') + '</p>';
      V.side.querySelector('[data-v-link]').addEventListener('click', function () { copyLink(it); });
    } else {
      V.side.innerHTML = '<h3>💬 Kommentare</h3><p class="muted">Lädt …</p>';
      W.api('GET', '/galerie/api/foto/' + it.id).then(function (r) { if (cur() === it && V.panel === 'comments') renderComments(it, r.comments, r.photo); }, function (e) { V.side.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; });
    }
    layout();
  }
  function renderComments(it, list, p) {
    var h = '<h3>💬 Kommentare</h3>';
    h += list.length ? '<ul class="gx-comments">' + list.map(function (c) {
      return '<li><b>' + esc(c.by) + '</b> <small class="muted">' + W.fmtDate(c.date) + '</small>' + (c.canDelete ? ' <button type="button" class="gx-cdel" data-c-del="' + c.id + '" title="Löschen">×</button>' : '') + '<p>' + esc(c.body) + '</p></li>';
    }).join('') + '</ul>' : '<p class="muted">Noch keine Kommentare.</p>';
    if (p.canComment) h += '<form class="gx-cform"><textarea name="body" rows="3" maxlength="1000" placeholder="Schreib etwas zu diesem Bild…" required></textarea><button class="small">Senden</button></form>';
    else h += '<p class="muted"><small>' + (p.commentsOff ? 'In diesem Album sind Kommentare ausgeschaltet.' : data.me ? '' : 'Zum Kommentieren melde dich an.') + '</small></p>';
    V.side.innerHTML = h;
    var form = V.side.querySelector('form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      btn.disabled = true;
      W.api('POST', '/galerie/foto/' + it.id + '/kommentare', { body: form.body.value }).then(function (r) {
        it.comments = r.count; renderComments(it, r.comments, p);
        var t = pane.querySelector('.gx-t[data-ref="' + it.ref + '"]');
        if (t) t.outerHTML = tile(it);
      }, function (er) { btn.disabled = false; W.msgbox(er.message, '⚠️'); });
    });
    V.side.querySelectorAll('[data-c-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        W.api('POST', '/galerie/kommentar/' + b.dataset.cDel + '/loeschen', {}).then(function (r) { it.comments = r.comments.length; renderComments(it, r.comments, p); }, fail);
      });
    });
  }

  // ---------- Start ----------
  load(ort, q, { keepBack: true }).then(function () {
    if (start.bild) openViewer('f' + start.bild);
  });
})();
