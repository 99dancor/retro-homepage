// Texteditor mit zwei Ansichten: „Modern“ schreibt man direkt im fertigen Text (wie in einem Textprogramm),
// „Markdown“ zeigt den Quelltext. Gespeichert wird immer Markdown im Textfeld; Modern rechnet den Text bei jeder
// Änderung zurück. Bilder in Modern anklicken, um Lage und Größe zu ändern, an der Ecke ziehen für eine freie Größe.
// Bildoptionen stehen als Titel im Markdown: ![Text](/media/x.png "rechts 40%")
(function () {
  'use strict';
  if (window.__editorLoaded) return;
  window.__editorLoaded = true;

  var OPT_RE = /^\s*(links|rechts|mitte)?\s*(?:(\d{1,3})\s*%)?\s*$/i;
  var MODE_KEY = 'editor-mode';

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function buildImg(alt, url, pos, width, title) {
    var t = [pos || '', width ? width + '%' : ''].join(' ').trim() || title || '';
    return '![' + String(alt || '').replace(/[\[\]\n]/g, '') + '](' + url + (t ? ' "' + t.replace(/"/g, '') + '"' : '') + ')';
  }
  function altFromName(name) { return String(name || 'Bild').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, ''); }
  function escHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- HTML → Markdown (für die Ansicht „Modern“) ----------
  var BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|HR|TABLE|DETAILS|SUMMARY|FIGURE|SECTION|ARTICLE|HEADER|FOOTER)$/;
  function imgMd(img) {
    var cls = (img.className.match(/bild-(links|rechts|mitte)/) || [])[1] || null;
    var w = /^(\d{1,3})%$/.exec(img.style.width || '');
    var o = OPT_RE.exec(img.getAttribute('title') || '');
    return buildImg(img.getAttribute('alt') || '', img.getAttribute('src') || '', cls, w ? Number(w[1]) : null, o && (o[1] || o[2]) ? '' : img.getAttribute('title') || '');
  }
  function escText(t) {
    return t.replace(/\\/g, '\\\\').replace(/([*_`~\[\]])/g, '\\$1').replace(/</g, '&lt;');
  }
  // Inline-Inhalt eines Elements; Leerzeichen am Rand wandern aus Fett/Kursiv heraus, sonst greift Markdown nicht
  function wrap(mark, inner) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
  }
  function inline(node) {
    var out = '';
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += escText(n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'BR') out += '\n';
      else if (tag === 'STRONG' || tag === 'B') out += wrap('**', inline(n));
      else if (tag === 'EM' || tag === 'I') out += wrap('*', inline(n));
      else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') out += wrap('~~', inline(n));
      else if (tag === 'CODE') out += '`' + n.textContent.replace(/`/g, '') + '`';
      else if (tag === 'A') { var t = inline(n).trim(); out += n.getAttribute('href') ? '[' + (t || n.getAttribute('href')) + '](' + n.getAttribute('href') + ')' : t; }
      else if (tag === 'IMG') out += imgMd(n);
      else if (BLOCK.test(tag)) out += (out && !/\n$/.test(out) ? '\n' : '') + inline(n) + '\n';
      else out += inline(n);
    });
    return out;
  }
  function para(text) {
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/^\n+|\s+$/g, '').replace(/^ +/, '');
    // Absatz, der wie eine Überschrift, Liste oder ein Zitat anfängt, bleibt normaler Text
    return text.replace(/^(#{1,6}\s|>|[-+]\s|\d+\.\s)/gm, '\\$1');
  }
  function list(el, depth) {
    var ordered = el.tagName === 'OL', n = Number(el.getAttribute('start')) || 1, lines = [];
    Array.prototype.forEach.call(el.children, function (li) {
      if (li.tagName !== 'LI') return;
      var marker = ordered ? (n++) + '. ' : '- ', pad = new Array(marker.length + 1).join(' ');
      var text = '', subs = [];
      li.childNodes.forEach(function (c) {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) subs.push(list(c, depth + 1));
        else if (c.nodeType === 1 && c.tagName === 'P') text += (text ? '\n' : '') + inline(c);
        else { var tmp = document.createElement('span'); tmp.appendChild(c.cloneNode(true)); text += inline(tmp); }
      });
      var body = para(text).split('\n').join('\n' + pad);
      lines.push(marker + body + (subs.length ? '\n' + subs.join('\n').replace(/^/gm, pad) : ''));
    });
    return lines.join('\n');
  }
  function table(el) {
    var rows = Array.prototype.slice.call(el.querySelectorAll('tr'));
    if (!rows.length) return '';
    var cells = rows.map(function (r) {
      return Array.prototype.map.call(r.children, function (c) { return inline(c).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim() || ' '; });
    });
    var cols = Math.max.apply(null, cells.map(function (r) { return r.length; }));
    var head = rows[0].children;
    var sep = [];
    for (var i = 0; i < cols; i++) {
      var a = head[i] && head[i].getAttribute('align');
      sep.push(a === 'center' ? ':---:' : a === 'right' ? '---:' : '---');
    }
    var line = function (r) { while (r.length < cols) r.push(' '); return '| ' + r.join(' | ') + ' |'; };
    return [line(cells[0]), '| ' + sep.join(' | ') + ' |'].concat(cells.slice(1).map(line)).join('\n');
  }
  function blocks(node) {
    var out = [], run = document.createElement('span');
    function flush() {
      if (!run.childNodes.length) return;
      var t = para(inline(run));
      if (t) out.push(t);
      run = document.createElement('span');
    }
    Array.prototype.slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK.test(n.tagName))) { run.appendChild(n.cloneNode(true)); return; }
      if (n.nodeType !== 1) return;
      flush();
      var tag = n.tagName, md = '';
      // Chrome steckt neue Listen und Zitate gern in den <p>, in dem man gerade stand
      var nested = Array.prototype.some.call(n.children, function (c) { return BLOCK.test(c.tagName); });
      if (tag === 'P' && !nested) md = para(inline(n));
      else if (/^H[1-6]$/.test(tag)) { var h = inline(n).replace(/\n/g, ' ').trim(); md = h ? new Array(Number(tag[1]) + 1).join('#') + ' ' + h : ''; }
      else if (tag === 'UL' || tag === 'OL') md = list(n, 0);
      else if (tag === 'BLOCKQUOTE') md = blocks(n).split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n');
      else if (tag === 'PRE') { var code = n.querySelector('code'), lang = code && (code.className.match(/language-(\S+)/) || [])[1]; md = '```' + (lang || '') + '\n' + n.textContent.replace(/\n$/, '') + '\n```'; }
      else if (tag === 'HR') md = '---';
      else if (tag === 'TABLE') md = table(n);
      else if (tag === 'DETAILS') {
        var sum = n.querySelector('summary'), rest = n.cloneNode(true);
        var s2 = rest.querySelector('summary'); if (s2) s2.remove();
        md = '<details>\n<summary>' + escHtml(sum ? sum.textContent.trim() : 'Mehr anzeigen') + '</summary>\n\n' + blocks(rest) + '\n\n</details>';
      } else if (tag === 'DIV' && /\b(mitte|rechts)\b/.test(n.className)) md = '<div class="' + n.className.match(/\b(mitte|rechts)\b/)[1] + '">\n\n' + blocks(n) + '\n\n</div>';
      else if (tag === 'DIV' && /\bclear\b/.test(n.className)) md = '<div class="clear"></div>';
      else md = blocks(n); // md-block aus der Vorschau, <div> vom Browser beim Tippen und alles andere: nur der Inhalt
      if (md.trim()) out.push(md);
    });
    flush();
    return out.join('\n\n');
  }
  window.RetroEditor = { toMarkdown: function (el) { return blocks(el); } };

  document.querySelectorAll('[data-editor]').forEach(function (ed) {
    var form = ed.closest('form');
    var csrfInput = (form || document).querySelector('input[name=_csrf]');
    var csrf = csrfInput ? csrfInput.value : '';
    var ta = ed.querySelector('textarea');
    var status = ed.querySelector('[data-status]');
    var prev = ed.querySelector('[data-preview-box]');
    var content = prev.querySelector('[data-preview-content]');
    var lib = ed.querySelector('[data-library-box]');
    var uploadUrl = ed.getAttribute('data-upload-url');
    var previewUrl = ed.getAttribute('data-preview-url');
    var libraryUrl = ed.getAttribute('data-library-url');
    var mode = 'markdown', seq = 0, syncTimer = null, dirty = false, syncing = false, range = null, selected = null;
    var modern = function () { return mode === 'modern'; };

    // ---------- Markdown-Ansicht: Text einfügen ----------
    function setValue(v, selStart, selEnd) {
      ta.value = v;
      if (selStart !== undefined) { ta.selectionStart = selStart; ta.selectionEnd = selEnd === undefined ? selStart : selEnd; }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
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

    // ---------- Modern: im fertigen Text schreiben ----------
    // Markierung merken, damit Knöpfe, Dialoge und Bild-Uploads an der richtigen Stelle einfügen
    document.addEventListener('selectionchange', function () {
      var s = window.getSelection();
      if (s.rangeCount && content.contains(s.getRangeAt(0).commonAncestorContainer)) range = s.getRangeAt(0).cloneRange();
    });
    function restore() {
      content.focus();
      if (!range) return;
      var s = window.getSelection();
      s.removeAllRanges(); s.addRange(range);
    }
    function exec(cmd, arg) { restore(); document.execCommand(cmd, false, arg === undefined ? null : arg); changed(); }
    function blockTag() {
      var s = window.getSelection(), n = s.rangeCount ? s.getRangeAt(0).startContainer : null;
      while (n && n !== content) { if (n.nodeType === 1 && BLOCK.test(n.tagName) && n.tagName !== 'DIV') return n.tagName; n = n.parentNode; }
      return '';
    }
    function selectedHtml() {
      if (!range || range.collapsed) return '';
      var d = document.createElement('div'); d.appendChild(range.cloneContents());
      return d.innerHTML;
    }
    function insertHtml(html) { exec('insertHTML', html); }
    function command(cmd) {
      restore();
      var tag = blockTag();
      if (cmd === 'h2' || cmd === 'h3' || cmd === 'blockquote') exec('formatBlock', tag === cmd.toUpperCase() ? 'p' : cmd);
      else if (cmd === 'link') {
        var url = prompt('Adresse des Links:', 'https://');
        if (!url || url === 'https://') return;
        if (range && !range.collapsed) exec('createLink', url);
        else insertHtml('<a href="' + escHtml(url) + '">' + escHtml(url) + '</a>');
      } else if (cmd === 'code') {
        var text = range ? range.toString() : '';
        if (text && text.indexOf('\n') < 0) insertHtml('<code>' + escHtml(text) + '</code>&#8203;');
        else exec('formatBlock', tag === 'PRE' ? 'p' : 'pre');
      } else exec(cmd);
    }
    function block(kind) {
      var sel = selectedHtml();
      if (kind === 'hr') exec('insertHorizontalRule');
      if (kind === 'table') insertHtml('<table><thead><tr><th>Spalte 1</th><th>Spalte 2</th></tr></thead><tbody><tr><td>Text</td><td>Text</td></tr></tbody></table><p><br></p>');
      if (kind === 'mitte' || kind === 'rechts') insertHtml('<div class="' + kind + '"><p>' + (sel || 'Text') + '</p></div><p><br></p>');
      if (kind === 'clear') insertHtml('<div class="clear"></div><p><br></p>');
      if (kind === 'details') insertHtml('<details open><summary>Mehr anzeigen</summary><p>' + (sel || 'Versteckter Text') + '</p></details><p><br></p>');
    }

    // Änderung in Modern: kurz warten, dann als Markdown ins Textfeld (das wird abgeschickt und als Entwurf gesichert)
    function changed() { dirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(sync, 300); place(); }
    function sync() {
      clearTimeout(syncTimer);
      if (!dirty) return;
      dirty = false;
      syncing = true;
      setValue(blocks(content));
      syncing = false;
    }
    content.addEventListener('input', changed);
    if (form) form.addEventListener('submit', sync, true);
    // Links im Text nicht öffnen
    content.addEventListener('click', function (e) {
      if (e.target.closest('a')) e.preventDefault();
      if (e.target.tagName === 'IMG') { e.preventDefault(); select(e.target); } else select(null);
    });

    // Aus dem Markdown neu aufbauen (beim Umschalten, Zitieren im Forum oder Laden eines Entwurfs)
    function render() {
      var my = ++seq;
      var body = new URLSearchParams({ _csrf: csrf, md: ta.value });
      fetch(previewUrl, { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (html) {
          if (my !== seq) return;
          content.innerHTML = html || '<p><br></p>'; // serverseitig bereinigt
          dirty = false;
          select(null);
        })
        .catch(function (e) { if (my === seq) status.textContent = '⚠ Text lässt sich nicht anzeigen (' + e.message + '). Schalte auf Markdown.'; });
    }
    ta.addEventListener('input', function () { if (!syncing && modern()) render(); });

    // ---------- Knöpfe ----------
    ed.querySelectorAll('[data-md]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (modern()) return command(b.getAttribute('data-cmd'));
        var parts = b.getAttribute('data-md').replace(/\\n/g, '\n').split('|');
        insertAt(parts[0], parts[1] || '');
      });
    });
    ed.querySelectorAll('[data-line]').forEach(function (b) {
      b.addEventListener('click', function () { if (modern()) command(b.getAttribute('data-cmd')); else prefixLines(b.getAttribute('data-line')); });
    });
    ed.querySelectorAll('[data-block]').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-block');
        if (modern()) return block(kind);
        var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
        if (kind === 'hr') insertBlock('---');
        if (kind === 'table') insertBlock('| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Text | Text |');
        if (kind === 'mitte' || kind === 'rechts') insertBlock('<div class="' + kind + '">\n\n' + (sel || 'Text') + '\n\n</div>');
        if (kind === 'clear') insertBlock('<div class="clear"></div>');
        if (kind === 'details') insertBlock('<details>\n<summary>Mehr anzeigen</summary>\n\n' + (sel || 'Versteckter Text') + '\n\n</details>');
      });
    });
    // Knöpfe nehmen dem Text nicht den Fokus (sonst ist die Markierung weg)
    ed.querySelector('.editor-tools').addEventListener('mousedown', function (e) { if (modern() && e.target.closest('button')) e.preventDefault(); });

    // ---------- Bilder hochladen ----------
    function insertImages(saved) {
      if (modern()) insertHtml(saved.map(function (m) { return '<p><img src="' + escHtml(m.url) + '" alt="' + escHtml(altFromName(m.name)) + '"></p>'; }).join('') + '<p><br></p>');
      else insertBlock(saved.map(function (m) { return buildImg(altFromName(m.name), m.url, null, null); }).join('\n\n'));
    }
    function uploadImages(files) {
      var list = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
      if (!list.length || !uploadUrl) return;
      var fd = new FormData();
      fd.append('_csrf', csrf);
      list.forEach(function (f) { fd.append('images', f, f.name || 'bild.png'); });
      status.textContent = 'Lade ' + list.length + ' Bild(er) hoch…';
      fetch(uploadUrl, { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (r) {
          // Voller Speicher: Der Server sagt, was zu tun ist
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || r.status); });
          return r.json();
        })
        .then(function (saved) {
          if (!saved.length) throw new Error('kein Bild');
          insertImages(saved);
          status.textContent = modern() ? '✔ Bild eingefügt – anklicken, um es anzupassen' : '✔ Bild eingefügt';
        })
        .catch(function (e) { status.textContent = '⚠ Upload fehlgeschlagen (' + e.message + ')'; });
    }
    var up = ed.querySelector('[data-upload]');
    if (up) up.addEventListener('change', function (e) { uploadImages(e.target.files); e.target.value = ''; });
    [ta, content].forEach(function (el) {
      el.addEventListener('paste', function (e) {
        var files = e.clipboardData && e.clipboardData.files;
        if (uploadUrl && files && files.length) { e.preventDefault(); uploadImages(files); return; }
        // In Modern nur Text und einfache Formatierung übernehmen, keine fremden Farben und Schriften
        if (el === content && e.clipboardData) {
          var html = e.clipboardData.getData('text/html');
          if (!html) return;
          e.preventDefault();
          var d = document.createElement('div');
          d.innerHTML = html;
          d.querySelectorAll('script, style, meta, link, iframe, object').forEach(function (x) { x.remove(); });
          d.querySelectorAll('*').forEach(function (x) { x.removeAttribute('style'); x.removeAttribute('class'); x.removeAttribute('id'); });
          insertHtml(d.innerHTML);
        }
      });
      el.addEventListener('dragover', function (e) { if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault(); });
      el.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); uploadImages(e.dataTransfer.files); }
      });
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
          btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
          btn.addEventListener('click', function () { insertImages([m]); });
          var cap = document.createElement('div');
          cap.textContent = m.name;
          fig.appendChild(img); fig.appendChild(cap); fig.appendChild(btn);
          listEl.appendChild(fig);
        });
      });
    });

    // ---------- Bilder in Modern bearbeiten ----------
    var tools = prev.querySelector('[data-img-tools]');
    var handle = prev.querySelector('[data-img-handle]');
    function posOf(img) { return (img.className.match(/bild-(links|rechts|mitte)/) || [])[1] || null; }
    function widthOf(img) { var m = /^(\d{1,3})%$/.exec(img.style.width || ''); return m ? Number(m[1]) : null; }
    function select(img) {
      if (selected) selected.classList.remove('selected');
      selected = img && content.contains(img) ? img : null;
      tools.hidden = handle.hidden = !selected;
      if (!selected) return;
      selected.classList.add('selected');
      tools.querySelectorAll('[data-pos]').forEach(function (b) { b.classList.toggle('pressed', (b.getAttribute('data-pos') || null) === posOf(selected)); });
      tools.querySelectorAll('[data-width]').forEach(function (b) { b.classList.toggle('pressed', Number(b.getAttribute('data-width')) === (widthOf(selected) || 0)); });
      place();
    }
    // Werkzeugleiste über dem Bild, Griff an der unteren rechten Ecke
    function place() {
      if (!selected || tools.hidden) return;
      if (!content.contains(selected)) { select(null); return; }
      var pr = prev.getBoundingClientRect(), r = selected.getBoundingClientRect();
      var top = r.top - pr.top + prev.scrollTop, left = r.left - pr.left + prev.scrollLeft;
      tools.style.top = Math.max(0, top - tools.offsetHeight - 4) + 'px';
      tools.style.left = Math.max(0, Math.min(left, prev.clientWidth - tools.offsetWidth - 4)) + 'px';
      handle.style.top = (top + r.height - 7) + 'px';
      handle.style.left = (left + r.width - 7) + 'px';
    }
    window.addEventListener('resize', place);
    content.addEventListener('load', place, true);
    function setImg(change) {
      if (!selected) return;
      if ('pos' in change) {
        selected.classList.remove('bild-links', 'bild-rechts', 'bild-mitte');
        if (change.pos) selected.classList.add('bild-' + change.pos);
      }
      if ('width' in change) selected.style.width = change.width ? change.width + '%' : '';
      if ('alt' in change) selected.setAttribute('alt', change.alt);
      changed();
      select(selected);
    }
    tools.addEventListener('mousedown', function (e) { e.preventDefault(); });
    tools.querySelectorAll('[data-pos]').forEach(function (b) {
      b.addEventListener('click', function () { setImg({ pos: b.getAttribute('data-pos') || null }); });
    });
    tools.querySelectorAll('[data-width]').forEach(function (b) {
      b.addEventListener('click', function () { setImg({ width: Number(b.getAttribute('data-width')) || null }); });
    });
    tools.querySelector('[data-alt]').addEventListener('click', function () {
      if (!selected) return;
      var alt = prompt('Bildbeschreibung (wird angezeigt, wenn das Bild nicht lädt, und vorgelesen):', selected.getAttribute('alt') || '');
      if (alt !== null) setImg({ alt: alt });
    });
    tools.querySelector('[data-remove]').addEventListener('click', function () {
      if (!selected || !confirm('Bild aus dem Text entfernen? (Die Datei bleibt gespeichert.)')) return;
      var img = selected;
      select(null);
      var p = img.parentNode;
      img.remove();
      if (p !== content && !p.textContent.trim() && !p.querySelector('img')) p.remove();
      changed();
    });
    // Einen Absatz nach oben oder unten: das Bild bekommt einen eigenen Absatz vor bzw. hinter dem Nachbarn
    function topBlock(el) { while (el && el.parentNode !== content) el = el.parentNode; return el; }
    tools.querySelectorAll('[data-move]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var img = selected, blk = topBlock(img);
        if (!blk) return;
        var dir = Number(btn.getAttribute('data-move'));
        var alone = !blk.textContent.trim() && blk.querySelectorAll('img').length === 1;
        var target = alone ? (dir < 0 ? blk.previousElementSibling : blk.nextElementSibling) : blk;
        if (!target) return;
        var p = document.createElement('p');
        img.parentNode.removeChild(img);
        p.appendChild(img);
        if (alone) blk.remove();
        content.insertBefore(p, dir < 0 ? target : target.nextSibling);
        changed();
        select(img);
      });
    });
    // Größe frei ziehen (in 5-%-Schritten der Textbreite)
    handle.addEventListener('pointerdown', function (e) {
      var img = selected;
      if (!img) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var startX = e.clientX, startW = img.offsetWidth, full = (topBlock(img) || content).clientWidth || 1, pct = null;
      var right = posOf(img) === 'rechts';
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
        if (pct) setImg({ width: pct });
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    ed.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selected) select(null); });

    // ---------- Ansicht: Modern / Markdown ----------
    var modeBtns = ed.querySelectorAll('[data-mode]');
    function setMode(m) {
      if (m === mode && ed.hasAttribute('data-view')) return;
      if (modern()) sync();
      mode = m;
      ed.setAttribute('data-view', m);
      modeBtns.forEach(function (b) { b.classList.toggle('pressed', b.getAttribute('data-mode') === m); b.setAttribute('aria-pressed', b.getAttribute('data-mode') === m); });
      ed.querySelectorAll('[data-help]').forEach(function (h) { h.hidden = h.getAttribute('data-help') !== m; });
      prev.hidden = !modern();
      ta.hidden = modern();
      select(null);
      if (modern()) render();
      store(MODE_KEY, m);
    }
    modeBtns.forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* alter Browser */ }
    setMode(store(MODE_KEY) === 'markdown' ? 'markdown' : 'modern');
  });
})();
