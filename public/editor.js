// Texteditor: Markdown links, Live-Vorschau rechts. Bilder in der Vorschau anklicken, um Lage und Größe
// zu ändern, an der Ecke ziehen für eine freie Größe, auf einen anderen Absatz ziehen zum Verschieben.
// Alles landet als normales Markdown im Textfeld: ![Text](/media/x.png "rechts 40%")
(function () {
  'use strict';
  if (window.__editorLoaded) return;
  window.__editorLoaded = true;

  var IMG_RE = /!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g;
  var OPT_RE = /^\s*(links|rechts|mitte)?\s*(?:(\d{1,3})\s*%)?\s*$/i;
  var MODE_KEY = 'editor-mode';

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function parseOpts(title) {
    var m = OPT_RE.exec(title || '');
    if (!m || (!m[1] && !m[2])) return { pos: null, width: null, title: title || '' };
    return { pos: m[1] ? m[1].toLowerCase() : null, width: m[2] ? Number(m[2]) : null, title: '' };
  }
  function buildImg(alt, url, pos, width, title) {
    var t = [pos || '', width ? width + '%' : ''].join(' ').trim() || title || '';
    return '![' + String(alt || '').replace(/[\[\]\n]/g, '') + '](' + url + (t ? ' "' + t.replace(/"/g, '') + '"' : '') + ')';
  }
  // k-tes Markdown-Bild mit dieser Adresse im Text
  function findImg(src, url, k) {
    IMG_RE.lastIndex = 0;
    var m, n = 0;
    while ((m = IMG_RE.exec(src))) {
      if (m[2] !== url) continue;
      if (n++ === k) {
        var o = parseOpts(m[3]);
        return { index: m.index, length: m[0].length, alt: m[1], url: m[2], pos: o.pos, width: o.width, title: o.title };
      }
    }
    return null;
  }
  function altFromName(name) { return String(name || 'Bild').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, ''); }

  document.querySelectorAll('[data-editor]').forEach(function (ed) {
    var form = ed.closest('form');
    var csrfInput = (form || document).querySelector('input[name=_csrf]');
    var csrf = csrfInput ? csrfInput.value : '';
    var ta = ed.querySelector('textarea');
    var status = ed.querySelector('[data-status]');
    var prev = ed.querySelector('[data-preview-box]');
    var lib = ed.querySelector('[data-library-box]');
    var uploadUrl = ed.getAttribute('data-upload-url');
    var previewUrl = ed.getAttribute('data-preview-url');
    var libraryUrl = ed.getAttribute('data-library-url');
    var selected = null; // { url, k }
    var timer = null, seq = 0;

    // ---------- Text einfügen ----------
    function setValue(v, selStart, selEnd) {
      ta.value = v;
      if (selStart !== undefined) { ta.selectionStart = selStart; ta.selectionEnd = selEnd === undefined ? selStart : selEnd; }
      ta.dispatchEvent(new Event('input'));
    }
    function insertAt(before, after) {
      var s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
      ta.focus();
      setValue(ta.value.slice(0, s) + before + sel + after + ta.value.slice(e), s + before.length, s + before.length + sel.length);
    }
    // Zeilenformat (Überschrift, Liste, Zitat) auf alle markierten Zeilen
    function prefixLines(prefix) {
      var v = ta.value, s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1, e = ta.selectionEnd;
      var lines = v.slice(s, e).split('\n');
      var out = lines.map(function (l, i) { return (prefix === '1. ' ? (i + 1) + '. ' : prefix) + l; }).join('\n');
      ta.focus();
      setValue(v.slice(0, s) + out + v.slice(e), s, s + out.length);
    }
    // Block auf eigener Zeile mit Leerzeile davor und danach
    function insertBlock(text) {
      var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      var pre = v.slice(0, s), post = v.slice(e);
      var lead = !pre || /\n\n$/.test(pre) ? '' : /\n$/.test(pre) ? '\n' : '\n\n';
      var tail = /^\n\n/.test(post) ? '' : /^\n/.test(post) ? '\n' : '\n\n';
      var ins = lead + text + tail;
      ta.focus();
      setValue(pre + ins + post, s + ins.length);
    }

    ed.querySelectorAll('[data-md]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-md').replace(/\\n/g, '\n').split('|');
        insertAt(parts[0], parts[1] || '');
      });
    });
    ed.querySelectorAll('[data-line]').forEach(function (b) {
      b.addEventListener('click', function () { prefixLines(b.getAttribute('data-line')); });
    });
    ed.querySelectorAll('[data-block]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-block');
        var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
        if (kind === 'hr') insertBlock('---');
        if (kind === 'table') insertBlock('| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Text | Text |');
        if (kind === 'mitte' || kind === 'rechts') insertBlock('<div class="' + kind + '">\n\n' + (sel || 'Text') + '\n\n</div>');
        if (kind === 'clear') insertBlock('<div class="clear"></div>');
        if (kind === 'details') insertBlock('<details>\n<summary>Mehr anzeigen</summary>\n\n' + (sel || 'Versteckter Text') + '\n\n</details>');
      });
    });

    // ---------- Bilder hochladen ----------
    function uploadImages(files) {
      var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
      if (!list.length || !uploadUrl) return;
      var fd = new FormData();
      fd.append('_csrf', csrf);
      list.forEach(function (f) { fd.append('images', f, f.name || 'bild.png'); });
      status.textContent = 'Lade ' + list.length + ' Bild(er) hoch…';
      fetch(uploadUrl, { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (saved) {
          if (!saved.length) throw new Error('kein Bild');
          insertBlock(saved.map(function (m) { return buildImg(altFromName(m.name), m.url, null, null); }).join('\n\n'));
          status.textContent = '✔ Bild eingefügt – in der Vorschau anklicken, um es anzupassen';
        })
        .catch(function (e) { status.textContent = '⚠ Upload fehlgeschlagen (' + e.message + ')'; });
    }
    var up = ed.querySelector('[data-upload]');
    if (up) up.addEventListener('change', function (e) { uploadImages(e.target.files); e.target.value = ''; });
    ta.addEventListener('paste', function (e) {
      var files = e.clipboardData && e.clipboardData.files;
      if (uploadUrl && files && files.length) { e.preventDefault(); uploadImages(files); }
    });
    ta.addEventListener('dragover', function (e) { e.preventDefault(); });
    ta.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      if (Array.prototype.indexOf.call(e.dataTransfer.types, 'text/x-bild') >= 0) { e.preventDefault(); return; }
      if (e.dataTransfer.files.length) { e.preventDefault(); uploadImages(e.dataTransfer.files); }
    });

    var libBtn = ed.querySelector('[data-library]');
    if (libBtn) libBtn.addEventListener('click', function () {
      if (!lib.hidden) { lib.hidden = true; return; }
      lib.hidden = false;
      var listEl = lib.querySelector('[data-library-list]');
      fetch(libraryUrl, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (items) {
        listEl.textContent = '';
        if (!items.length) { listEl.textContent = 'Noch keine Bilder hochgeladen.'; return; }
        items.forEach(function (m) {
          var fig = document.createElement('figure');
          var img = document.createElement('img');
          img.src = m.url; img.alt = ''; img.loading = 'lazy';
          var btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'small'; btn.textContent = 'Einfügen';
          btn.addEventListener('click', function () { insertBlock(buildImg(altFromName(m.name), m.url, null, null)); });
          var cap = document.createElement('div');
          cap.textContent = m.name;
          fig.appendChild(img); fig.appendChild(cap); fig.appendChild(btn);
          listEl.appendChild(fig);
        });
      });
    });

    // ---------- Ansicht: Text / Beides / Vorschau ----------
    var modeBtns = ed.querySelectorAll('[data-mode]');
    function setMode(mode) {
      ed.setAttribute('data-view', mode);
      modeBtns.forEach(function (b) { b.classList.toggle('pressed', b.getAttribute('data-mode') === mode); });
      prev.hidden = mode === 'text';
      if (mode !== 'text') render();
      store(MODE_KEY, mode);
    }
    modeBtns.forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });

    // ---------- Live-Vorschau ----------
    var content = prev.querySelector('[data-preview-content]');
    function render() {
      if (prev.hidden) return;
      var my = ++seq;
      var body = new URLSearchParams({ _csrf: csrf, md: ta.value });
      fetch(previewUrl, { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (html) {
          if (my !== seq) return;
          content.innerHTML = html; // serverseitig bereinigt
          prepareImages();
          if (selected) select(findPreviewImg(selected.url, selected.k));
        })
        .catch(function (e) { if (my === seq) content.textContent = '⚠ Vorschau nicht möglich (' + e.message + ')'; });
    }
    ta.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(render, 350); });
    content.addEventListener('click', function (e) {
      if (e.target.closest('a')) e.preventDefault(); // Links in der Vorschau nicht öffnen
      if (e.target.tagName === 'IMG') return;
      select(null);
    });

    // ---------- Bilder in der Vorschau bearbeiten ----------
    var tools = prev.querySelector('[data-img-tools]');
    var handle = prev.querySelector('[data-img-handle]');

    function previewImgs() { return Array.prototype.slice.call(content.querySelectorAll('img')); }
    // Gleiches Bild kann mehrfach vorkommen: k zählt Vorkommen derselben Adresse
    function keyOf(img) {
      var url = img.getAttribute('src'), k = 0;
      previewImgs().some(function (o) { if (o === img) return true; if (o.getAttribute('src') === url) k++; return false; });
      return { url: url, k: k };
    }
    function findPreviewImg(url, k) {
      var n = 0;
      return previewImgs().filter(function (o) { return o.getAttribute('src') === url && n++ === k; })[0] || null;
    }
    function prepareImages() {
      previewImgs().forEach(function (img) {
        var key = keyOf(img);
        if (!findImg(ta.value, key.url, key.k)) return; // z. B. als HTML eingefügt: nicht bearbeitbar
        img.classList.add('editable');
        img.draggable = true;
        img.title = 'Klicken zum Anpassen, ziehen zum Verschieben';
        img.addEventListener('click', function (e) { e.preventDefault(); select(img); });
        img.addEventListener('dragstart', function (e) {
          select(img);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/x-bild', JSON.stringify(key));
        });
        img.addEventListener('load', place);
      });
    }

    function select(img) {
      previewImgs().forEach(function (o) { o.classList.remove('selected'); });
      if (!img) { selected = null; tools.hidden = true; handle.hidden = true; return; }
      selected = keyOf(img);
      var info = findImg(ta.value, selected.url, selected.k);
      if (!info) { select(null); return; }
      img.classList.add('selected');
      tools.hidden = false; handle.hidden = false;
      tools.querySelectorAll('[data-pos]').forEach(function (b) { b.classList.toggle('pressed', (b.getAttribute('data-pos') || null) === info.pos); });
      tools.querySelectorAll('[data-width]').forEach(function (b) { b.classList.toggle('pressed', Number(b.getAttribute('data-width')) === (info.width || 0)); });
      ta.setSelectionRange(info.index, info.index + info.length);
      place();
    }
    function selectedImg() { return selected && findPreviewImg(selected.url, selected.k); }
    // Werkzeugleiste über dem Bild, Griff an der unteren rechten Ecke
    function place() {
      var img = selectedImg();
      if (!img || tools.hidden) return;
      var top = img.offsetTop, left = img.offsetLeft;
      tools.style.top = Math.max(0, top - tools.offsetHeight - 4) + 'px';
      tools.style.left = Math.max(0, Math.min(left, prev.clientWidth - tools.offsetWidth - 4)) + 'px';
      handle.style.top = (top + img.offsetHeight - 7) + 'px';
      handle.style.left = (left + img.offsetWidth - 7) + 'px';
    }
    window.addEventListener('resize', place);

    function updateImg(change) {
      if (!selected) return;
      var v = ta.value, info = findImg(v, selected.url, selected.k);
      if (!info) return;
      var o = { alt: info.alt, pos: info.pos, width: info.width };
      for (var key in change) o[key] = change[key];
      var text = buildImg(o.alt, info.url, o.pos, o.width, info.title);
      setValue(v.slice(0, info.index) + text + v.slice(info.index + info.length));
      clearTimeout(timer); render();
    }
    tools.querySelectorAll('[data-pos]').forEach(function (b) {
      b.addEventListener('click', function () { updateImg({ pos: b.getAttribute('data-pos') || null }); });
    });
    tools.querySelectorAll('[data-width]').forEach(function (b) {
      b.addEventListener('click', function () { updateImg({ width: Number(b.getAttribute('data-width')) || null }); });
    });
    tools.querySelector('[data-alt]').addEventListener('click', function () {
      var info = selected && findImg(ta.value, selected.url, selected.k);
      if (!info) return;
      var alt = prompt('Bildbeschreibung (wird angezeigt, wenn das Bild nicht lädt, und vorgelesen):', info.alt);
      if (alt !== null) updateImg({ alt: alt });
    });
    tools.querySelector('[data-remove]').addEventListener('click', function () {
      var info = selected && findImg(ta.value, selected.url, selected.k);
      if (!info || !confirm('Bild aus dem Text entfernen? (Die Datei bleibt in der Bibliothek.)')) return;
      var r = cutRange(ta.value, info);
      select(null);
      setValue(r.text);
      clearTimeout(timer); render();
    });

    // Bild entfernen; steht es allein in seiner Zeile, verschwindet die Zeile mit
    function cutRange(v, info) {
      var rs = info.index, re = info.index + info.length;
      var ls = v.lastIndexOf('\n', rs - 1) + 1, le = v.indexOf('\n', re);
      if (le < 0) le = v.length;
      if (!v.slice(ls, rs).trim() && !v.slice(re, le).trim()) { rs = ls; re = Math.min(v.length, le + 1); }
      var left = v.slice(0, rs), right = v.slice(re);
      // höchstens eine Leerzeile stehen lassen
      var a = (left.match(/\n*$/) || [''])[0].length, b = (right.match(/^\n*/) || [''])[0].length;
      var keepB = Math.min(b, Math.max(0, 2 - a));
      if (!left) keepB = 0;
      return { text: left + right.slice(b - keepB), start: rs, removed: (re - rs) + (b - keepB) };
    }

    // Bild vor (before) oder hinter einen Block der Vorschau setzen
    function moveImg(key, block, before) {
      var v = ta.value, info = findImg(v, key.url, key.k);
      if (!info || !block) return;
      var from = Number(block.getAttribute('data-from')), to = Number(block.getAttribute('data-to'));
      var at = before ? from : to;
      if (at > info.index && at < info.index + info.length) return;
      var imgText = v.substr(info.index, info.length);
      var cut = cutRange(v, info);
      if (at >= cut.start) at = Math.max(cut.start, at - cut.removed);
      var pre = cut.text.slice(0, at), post = cut.text.slice(at);
      var lead = !pre || /\n\n$/.test(pre) ? '' : /\n$/.test(pre) ? '\n' : '\n\n';
      var tail = /^\n\n/.test(post) || !post ? '' : /^\n/.test(post) ? '\n' : '\n\n';
      setValue(pre + lead + imgText + tail + post);
      // Das verschobene Bild bleibt ausgewählt (Vorkommen derselben Adresse neu zählen)
      var k = 0, pos = pre.length + lead.length;
      IMG_RE.lastIndex = 0;
      var m;
      while ((m = IMG_RE.exec(ta.value)) && m.index < pos) if (m[2] === key.url) k++;
      selected = { url: key.url, k: k };
      clearTimeout(timer); render();
    }
    function blockOf(el) { return el && el.closest ? el.closest('.md-block') : null; }
    // Obere oder untere Hälfte des sichtbaren Inhalts (ohne Platz, den ein umflossenes Bild darüber freihält)
    function upperHalf(block, y) {
      var a = (block.firstElementChild || block).getBoundingClientRect(), b = (block.lastElementChild || block).getBoundingClientRect();
      return y < (a.top + b.bottom) / 2;
    }
    function siblingBlock(block, dir) {
      var b = block;
      do { b = dir < 0 ? b.previousElementSibling : b.nextElementSibling; } while (b && !b.classList.contains('md-block'));
      return b;
    }
    tools.querySelectorAll('[data-move]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var img = selectedImg(), block = blockOf(img);
        if (!block) return;
        var dir = Number(btn.getAttribute('data-move'));
        // Steht das Bild allein im Block, an den Nachbarblock vorbei, sonst erst aus dem eigenen Absatz heraus
        var alone = !block.textContent.trim() && block.querySelectorAll('img').length === 1;
        var target = alone ? siblingBlock(block, dir) : block;
        if (target) moveImg(keyOf(img), target, dir < 0);
      });
    });

    var dropMark = null;
    function clearDrop() { if (dropMark) dropMark.classList.remove('drop-before', 'drop-after'); dropMark = null; }
    content.addEventListener('dragover', function (e) {
      if (Array.prototype.indexOf.call(e.dataTransfer.types, 'text/x-bild') < 0) return;
      var block = blockOf(e.target);
      if (!block) return;
      e.preventDefault();
      var before = upperHalf(block, e.clientY);
      clearDrop();
      dropMark = block;
      block.classList.add(before ? 'drop-before' : 'drop-after');
    });
    content.addEventListener('dragleave', function (e) { if (!content.contains(e.relatedTarget)) clearDrop(); });
    content.addEventListener('drop', function (e) {
      var data = e.dataTransfer.getData('text/x-bild');
      if (!data) return;
      e.preventDefault();
      var block = blockOf(e.target);
      clearDrop();
      if (!block) return;
      moveImg(JSON.parse(data), block, upperHalf(block, e.clientY));
    });
    content.addEventListener('dragend', clearDrop);

    // Größe frei ziehen (in 5-%-Schritten der Textbreite)
    handle.addEventListener('pointerdown', function (e) {
      var img = selectedImg();
      if (!img) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var startX = e.clientX, startW = img.offsetWidth, full = (blockOf(img) || content).clientWidth || 1, pct = null;
      var info = findImg(ta.value, selected.url, selected.k);
      var right = info && info.pos === 'rechts';
      function move(ev) {
        var w = startW + (right ? startX - ev.clientX : ev.clientX - startX);
        pct = Math.max(5, Math.min(100, Math.round(w / full * 20) * 5));
        img.style.width = pct + '%';
        status.textContent = 'Breite: ' + pct + ' %';
        place();
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (pct) updateImg({ width: pct });
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    ed.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selected) select(null); });

    var wide = window.matchMedia('(min-width: 900px)').matches;
    setMode(store(MODE_KEY) || (wide ? 'split' : 'text'));
  });
})();
