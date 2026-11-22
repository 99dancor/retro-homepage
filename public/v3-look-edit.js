// Update 100: Schublade „🎨 Aussehen der Seite“ (nur Admin). Reiter Kopfzeile, Hintergrund, Stil, Extras.
// Jede Änderung zeigt die Seite sofort: Das CSS kommt von POST /aussehen/vorschau (src/look.js baut es wie beim Speichern),
// Kopfleiste, Begrüßung, Hinweis und Fußzeile ändert das Skript direkt. „Speichern“ schreibt POST /aussehen.
(function () {
  'use strict';
  var body = document.body, root = document.documentElement, csrf = body.getAttribute('data-csrf') || '';
  var D = null, S = null, saved = '', hist = [], tab = 'kopf', area = null, mode = 'light', box = null, sc = null, timer = null, themeBefore = null;

  // ---------- kleine Helfer ----------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'on') for (var ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
      else if (k === 'style') e.style.cssText = attrs[k];
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function req(url, data, raw) {
    var o = { method: 'POST', credentials: 'same-origin', headers: { Accept: raw ? 'text/css' : 'application/json', 'X-CSRF-Token': csrf } };
    if (data instanceof FormData) o.body = data; else { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(data); }
    return fetch(url, o).then(function (r) {
      if (raw) return r.ok ? r.text() : Promise.reject(new Error('Vorschau fehlgeschlagen'));
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Fehler'); return j; });
    });
  }
  var media = function (f) { return '/media/' + f; };

  // ---------- Änderungen: merken, Vorschau, Rückgängig ----------
  var lastPush = 0;
  function change(fn, rerender) {
    var now = Date.now();
    if (now - lastPush > 600) { hist.push(JSON.stringify(S)); if (hist.length > 80) hist.shift(); }
    lastPush = now;
    fn();
    preview();
    if (rerender) draw();
    box.querySelector('[data-undo]').disabled = !hist.length;
  }
  function undo() {
    if (!hist.length) return;
    S = JSON.parse(hist.pop());
    preview(); draw();
    box.querySelector('[data-undo]').disabled = !hist.length;
  }
  function preview() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      req('/aussehen/vorschau', S, true).then(function (css) {
        document.getElementById('lk-style').textContent = css;
        if (window.LookSlides) window.LookSlides();
      }).catch(function () { /* nächster Versuch beim nächsten Regler */ });
    }, 120);
    dom();
  }

  // Was nicht per CSS geht: Klassen, Symbol und Titel, Schnellwahl, Begrüßung, Hinweis, Fußzeile, Deko
  function dom() {
    var st = S.style, hd = S.head, ex = S.extras, cls = body.className.split(/\s+/).filter(function (c) { return !/^lk-(tile|cols|bar|nosearch|daytime|onecolor|tgrad|mine)/.test(c); });
    cls.push('lk-tile-' + st.tile, 'lk-cols-' + st.cols, 'lk-bar-' + hd.scroll);
    if (!hd.search) cls.push('lk-nosearch');
    if (ex.daytime) cls.push('lk-daytime');
    if (!st.keepTiles) cls.push('lk-onecolor');
    if (/^linear/.test(D.titleColors[hd.tcolor] || '')) cls.push('lk-tgrad');
    body.className = cls.join(' ');
    // Symbol und Titel
    var logo = document.querySelector('.v3-logo');
    if (logo) {
      logo.textContent = '';
      var ic = hd.icon;
      if (ic.kind !== 'none') {
        var mk = el('span', { class: 'mk lk-k-' + ic.kind + (ic.shape === 'frei' ? ' lk-free' : '') + (ic.kind === 'emoji' ? ' emo' : ''), 'aria-hidden': 'true' });
        if (ic.kind === 'image' && ic.image) mk.appendChild(el('img', { src: media(ic.image), alt: '' }));
        else mk.textContent = ic.kind === 'letters' ? ic.letters : ic.emoji;
        logo.appendChild(mk);
      }
      logo.appendChild(el('span', { class: 'tt' }, [el('b', { text: hd.title || D.siteName }), hd.sub ? el('small', { text: hd.sub }) : null]));
    }
    // Schnellwahl der Bereiche oder der Brotkrumen-Hinweis
    var top = document.querySelector('.v3-top'), quick = document.querySelector('.v3-quick'), crumb = document.querySelector('.v3-crumb');
    if (top && ex.quick && !quick) {
      var cur = (body.className.match(/lk-a-(\w+)/) || [])[1];
      quick = el('nav', { class: 'v3-quick', 'aria-label': 'Bereiche' }, D.navAreas.map(function (a) { return el('a', { href: a.url, title: a.name, class: a.key === cur ? 'on' : null }, [el('span', { class: 'emo', text: a.icon }), el('span', { class: 'qn', text: ' ' + a.name })]); }));
      logo.after(quick);
    }
    if (quick) quick.hidden = !ex.quick;
    if (crumb) crumb.hidden = ex.quick;
    // Begrüßung
    var g = document.querySelector('[data-lk-greet]');
    if (g) g.hidden = !ex.greet;
    // Hinweis-Leiste
    var n = document.querySelector('.lk-notice');
    if (ex.notice.on && ex.notice.text) {
      if (!n) { n = el('div', { class: 'lk-notice', role: 'status' }, [el('span'), el('button', { type: 'button', text: '✕', 'aria-label': 'Hinweis schließen' })]); top && top.before(n); }
      n.hidden = false; n.className = 'lk-notice t-' + ex.notice.tone; n.querySelector('span').textContent = ex.notice.text;
    } else if (n) n.hidden = true;
    // Fußzeile
    var foot = document.querySelector('.v3-foot');
    if (foot) {
      var own = foot.querySelector('.lk-own');
      if (ex.foot) { if (!own) { own = el('span', { class: 'lk-own' }); foot.prepend(own); } own.textContent = ex.foot; } else if (own) own.remove();
    }
    // Deko (nur wenn gerade Deko-Zeit ist)
    if (D.seasonNow) {
      if (ex.season) body.setAttribute('data-lk-season', D.seasonNow); else body.removeAttribute('data-lk-season');
      if (window.LookDeko) window.LookDeko();
    }
  }

  // ---------- Bausteine ----------
  function field(label, ctrl, val) {
    return el('div', { class: 'row' }, [el('label', { text: label }), ctrl, val !== undefined ? el('span', { class: 'v', text: val }) : null]);
  }
  function range(label, get, set, min, max, fmt, step) {
    var v = el('span', { class: 'v', text: fmt(get()) });
    var inp = el('input', { type: 'range', min: min, max: max, step: step || 1, value: get(), 'aria-label': label });
    inp.addEventListener('input', function () { var x = Number(inp.value); change(function () { set(x); }); v.textContent = fmt(x); });
    return el('div', { class: 'row' }, [el('label', { text: label }), inp, v]);
  }
  function seg(label, opts, get, set, rerender) {
    var s = el('div', { class: 'seg' + (opts.length > 4 ? ' many' : ''), role: 'radiogroup', 'aria-label': label });
    opts.forEach(function (o) {
      var b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(get() === o[0]), class: get() === o[0] ? 'on' : null, text: o[1] });
      b.addEventListener('click', function () { change(function () { set(o[0]); }, true); });
      s.appendChild(b);
    });
    return label ? el('div', { class: 'row' }, [el('label', { text: label }), s]) : s;
  }
  function check(label, get, set, rerender) {
    var i = el('input', { type: 'checkbox' }); i.checked = !!get();
    i.addEventListener('change', function () { change(function () { set(i.checked); }, rerender); });
    return el('label', { class: 'chk' }, [i, ' ' + label]);
  }
  function text(label, get, set, max, ph) {
    var i = el('input', { type: 'text', value: get(), maxlength: max, placeholder: ph || '' });
    i.addEventListener('input', function () { change(function () { set(i.value); }); });
    return field(label, i);
  }
  function swatches(map, get, set, labels, extra) {
    var w = el('div', { class: 'sw' });
    if (extra) setTimeout(function () { w.appendChild(extra); });
    Object.keys(map).forEach(function (k) {
      var b = el('button', { type: 'button', class: get() === k ? 'on' : null, title: (labels && labels[k]) || k, 'aria-label': (labels && labels[k]) || k });
      b.style.background = map[k] === '' ? 'var(--heading)' : map[k] && map[k] !== 'transparent' ? map[k] : 'repeating-conic-gradient(#ccd 0 25%, #fff 0 50%) 0 0 / 10px 10px';
      b.addEventListener('click', function () { change(function () { set(k); }, true); });
      w.appendChild(b);
    });
    return w;
  }
  function colorPick(get, set, allowEmpty, emptyLabel) {
    var wrap = el('span', { class: 'cpick' });
    var i = el('input', { type: 'color', value: get() || '#888888' });
    i.addEventListener('input', function () { change(function () { set(i.value); }); });
    wrap.appendChild(i);
    if (allowEmpty) {
      var b = el('button', { type: 'button', class: 'pill small' + (get() ? '' : ' on'), text: emptyLabel || 'Standard' });
      b.addEventListener('click', function () { change(function () { set(''); }, true); });
      wrap.appendChild(b);
    }
    return wrap;
  }
  function group(title, kids) { return el('fieldset', null, [el('legend', { text: title })].concat(kids)); }
  function hint(t) { return el('p', { class: 'hint', text: t }); }

  // Bildauswahl: Vorschaubilder, eins oder mehrere wählen, hochladen, löschen
  function thumbs(opts) {
    var w = el('div', { class: 'thumbs' + (opts.square ? ' sq' : '') });
    if (opts.none) {
      var n = el('button', { type: 'button', class: 'none' + (!opts.isOn('') ? '' : ' on'), text: opts.none });
      n.addEventListener('click', function () { change(function () { opts.pick(''); }, true); });
      w.appendChild(n);
    }
    S.images.forEach(function (im) {
      var on = opts.isOn(im.f), order = opts.order ? opts.order(im.f) : 0;
      var b = el('button', { type: 'button', class: on ? 'on' : null, title: im.name || '', 'aria-label': im.name || 'Bild', 'aria-pressed': String(on) });
      b.style.backgroundImage = 'url("' + media(im.f) + '")';
      if (order) b.appendChild(el('em', { text: String(order) }));
      b.addEventListener('click', function () { change(function () { opts.pick(im.f); }, true); });
      var x = el('span', { class: 'del', title: 'Aus der Bildauswahl nehmen', text: '✕', role: 'button', tabindex: '0' });
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('Bild aus der Auswahl nehmen?')) return;
        req('/aussehen/bild/loeschen', { f: im.f }).then(function (r) { S.images = r.images; draw(); }).catch(function (err) { alert(err.message); });
      });
      b.appendChild(x);
      w.appendChild(b);
    });
    var up = el('label', { class: 'up', title: 'Bild hochladen' }, ['＋', el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif', multiple: true, hidden: true })]);
    up.querySelector('input').addEventListener('change', function () { upload(this.files, opts.pick, !opts.order); this.value = ''; });
    w.appendChild(up);
    return w;
  }
  // Große Bilder vor dem Hochladen im Browser verkleinern (längste Seite 2560 px), GIFs bleiben wie sie sind
  function shrink(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve({ blob: file, w: 0, h: 0 });
    return createImageBitmap(file).then(function (bmp) {
      var max = 2560, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (s === 1 && file.size < 3 * 1024 * 1024) return { blob: file, w: bmp.width, h: bmp.height };
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res) {
        c.toBlob(function (b) { res({ blob: b || file, w: c.width, h: c.height, name: file.name.replace(/\.\w+$/, '') + '.jpg' }); }, 'image/jpeg', 0.86);
      });
    }).catch(function () { return { blob: file, w: 0, h: 0 }; });
  }
  function upload(files, pick, single) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var st = box.querySelector('[data-status]');
    st.textContent = 'Lädt hoch …';
    list.reduce(function (p, file, i) {
      return p.then(function () {
        return shrink(file).then(function (r) {
          var fd = new FormData();
          fd.append('w', r.w); fd.append('h', r.h); fd.append('_csrf', csrf);
          fd.append('image', r.blob, r.name || file.name);
          return req('/aussehen/bild', fd).then(function (res) {
            S.images = res.images;
            if (pick && (!single || i === 0)) { hist.push(JSON.stringify(S)); pick(res.f); }
          });
        });
      });
    }, Promise.resolve()).then(function () { st.textContent = 'Hochgeladen ✓'; preview(); draw(); setTimeout(function () { st.textContent = ''; }, 2500); })
      .catch(function (e) { st.textContent = ''; alert(e.message); draw(); });
  }

  // ---------- Reiter ----------
  var EMOJIS = ['🪟', '🌾', '🚜', '🏡', '🎮', '🕹️', '⭐', '🦊', '🐾', '🍀', '🌻', '🔥', '🛠️', '🎨', '📦', '🌙'];
  function tabKopf() {
    var h = S.head, ic = h.icon, out = [];
    var sym = [seg('Art', [['emoji', 'Emoji'], ['image', 'Bild'], ['letters', 'Text'], ['none', 'Keins']], function () { return ic.kind; }, function (v) { ic.kind = v; })];
    if (ic.kind === 'emoji') {
      sym.push(text('Emoji', function () { return ic.emoji; }, function (v) { ic.emoji = Array.from(v.trim()).slice(0, 2).join('') || '🪟'; }, 16));
      var g = el('div', { class: 'ico' });
      EMOJIS.forEach(function (e) {
        var b = el('button', { type: 'button', class: 'emo' + (ic.emoji === e ? ' on' : ''), text: e });
        b.addEventListener('click', function () { change(function () { ic.emoji = e; }, true); });
        g.appendChild(b);
      });
      sym.push(g);
    }
    if (ic.kind === 'image') {
      sym.push(thumbs({ square: true, isOn: function (f) { return ic.image === f; }, pick: function (f) { ic.image = f; } }));
      sym.push(hint('Am besten ein quadratisches Bild. Mit „Frei“ wird es ohne Fläche und Zuschnitt gezeigt.'));
    }
    if (ic.kind === 'letters') sym.push(text('Buchstaben', function () { return ic.letters; }, function (v) { ic.letters = v.slice(0, 3) || 'D'; }, 3));
    if (ic.kind !== 'none') {
      sym.push(seg('Form', [['quadrat', 'Eckig'], ['eckig', 'Abgerundet'], ['rund', 'Rund'], ['kreis', 'Kreis'], ['frei', 'Frei']], function () { return ic.shape; }, function (v) { ic.shape = v; }));
      sym.push(range('Größe', function () { return ic.size; }, function (v) { ic.size = v; }, 20, 56, function (v) { return v + ' px'; }));
      if (ic.shape !== 'frei') sym.push(field('Grundfarbe', swatches(D.iconColors, function () { return ic.color; }, function (v) { ic.color = v; }, { akzent: 'Akzentfarbe', keine: 'ohne' })));
      sym.push(check('Auch als Browser-Symbol und Handy-App-Symbol nehmen', function () { return ic.favicon; }, function (v) { ic.favicon = v; }));
    }
    out.push(group('Symbol', sym));
    out.push(group('Titelzeile', [
      text('Titel', function () { return h.title || D.siteName; }, function (v) { h.title = v.slice(0, 40); }, 40),
      text('Untertitel', function () { return h.sub; }, function (v) { h.sub = v.slice(0, 60); }, 60, 'z. B. Daddeln · Basteln · Bauern'),
      seg('Schrift', Object.keys(D.fonts).map(function (k) { return [k, D.fonts[k]]; }), function () { return h.font; }, function (v) { h.font = v; }),
      field('Titelfarbe', swatches(D.titleColors, function () { return h.tcolor; }, function (v) { h.tcolor = v; }, { auto: 'wie Überschriften', akzent: 'Akzentfarbe', weiss: 'Weiß' })),
      range('Titelgröße', function () { return h.tsize; }, function (v) { h.tsize = v; }, 14, 32, function (v) { return v + ' px'; }),
    ]));
    out.push(group('Kopfleiste', [
      range('Deckkraft', function () { return h.bar; }, function (v) { h.bar = v; }, 0, 100, function (v) { return v + ' %'; }),
      seg('Beim Scrollen', [['sticky', 'Bleibt oben'], ['static', 'Scrollt mit'], ['shrink', 'Wird klein']], function () { return h.scroll; }, function (v) { h.scroll = v; }),
      check('Schnellwahl der Bereiche neben dem Titel', function () { return S.extras.quick; }, function (v) { S.extras.quick = v; }),
      check('Suchfeld zeigen', function () { return h.search; }, function (v) { h.search = v; }),
    ]));
    out.push(hint('Gilt auf allen Seiten außer dem Desktop. Der Titel ist auch der Name der Seite im Browser-Reiter.'));
    return out;
  }

  function cfg() {
    var a = S.bg[area];
    if (!a) return null;
    if (mode === 'dark') return a.dark;
    return a.light;
  }
  function tabBg() {
    var out = [];
    var chips = el('div', { class: 'scope', role: 'tablist' });
    Object.keys(D.areas).forEach(function (k) {
      var own = k === 'home' || !!S.bg[k];
      var b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === area), class: (k === area ? 'on' : '') + (own ? '' : ' inh'), text: D.areas[k].icon + ' ' + D.areas[k].name + (own ? '' : ' · wie Startseite') });
      b.addEventListener('click', function () { area = k; draw(); });
      chips.appendChild(b);
    });
    out.push(chips);
    var cur = (body.className.match(/lk-a-(\w+)/) || [])[1];
    if (area !== cur && cur) out.push(hint('Die Vorschau zeigt den Bereich, in dem du gerade bist (' + D.areas[cur].name + '). Für ' + D.areas[area].name + ' erst speichern und dort nachsehen.'));
    if (area !== 'home') {
      out.push(check('Eigener Hintergrund für ' + D.areas[area].name, function () { return !!S.bg[area]; }, function (v) {
        S.bg[area] = v ? copy(S.bg.home) : null;
      }, true));
      if (!S.bg[area]) { out.push(hint('Übernimmt den Hintergrund der Startseite.')); return out; }
    }
    // Hell und dunkel
    out.push(seg('Für', [['light', '☀️ Hell'], ['dark', '🌙 Dunkel']], function () { return mode; }, function (v) { mode = v; root.dataset.theme = v; }));
    if (mode === 'dark') {
      out.push(check('Dunkel eigener Hintergrund (sonst wie hell)', function () { return !!S.bg[area].dark; }, function (v) {
        S.bg[area].dark = v ? copy(S.bg[area].light) : null;
      }, true));
      if (!S.bg[area].dark) return out;
    }
    var b = cfg();
    var kinds = [['gradient', 'Verlauf'], ['color', 'Farbe'], ['image', 'Bild'], ['slides', 'Diashow']];
    var art = [seg('Art', kinds, function () { return b.kind; }, function (v) {
      b.kind = v;
      // Mit Bild: Kacheln gleich etwas durchsichtig, damit es gut aussieht
      if ((v === 'image' || v === 'slides') && b.glass === 100) { b.glass = 78; b.veil = Math.max(b.veil, 15); }
      if (v === 'image' && !b.image && S.images[0]) b.image = S.images[0].f;
    })];
    if (b.kind === 'gradient') {
      art.push(field('Farbe 1', colorPick(function () { return b.c1; }, function (v) { b.c1 = v; }, true)));
      art.push(field('Farbe 2', colorPick(function () { return b.c2; }, function (v) { b.c2 = v; }, true)));
      art.push(hint('Standard = die Farben der Vorlage im Reiter Stil.'));
    }
    if (b.kind === 'color') art.push(field('Farbe', colorPick(function () { return b.color; }, function (v) { b.color = v; })));
    if (b.kind === 'image') {
      art.push(thumbs({ isOn: function (f) { return b.image === f; }, pick: function (f) { b.image = f; } }));
      if (S.extras.daytime) {
        art.push(el('div', { class: 'sub' }, [el('b', { text: '🌆 Abendbild (17–21 Uhr)' }), thumbs({ none: 'wie Tag', isOn: function (f) { return b.evening === f; }, pick: function (f) { b.evening = b.evening === f ? '' : f; } })]));
        art.push(el('div', { class: 'sub' }, [el('b', { text: '🌙 Nachtbild (21–6 Uhr)' }), thumbs({ none: 'wie Abend', isOn: function (f) { return b.night === f; }, pick: function (f) { b.night = b.night === f ? '' : f; } })]));
      }
    }
    if (b.kind === 'slides') {
      art.push(thumbs({ isOn: function (f) { return b.images.indexOf(f) >= 0; }, order: function (f) { return b.images.indexOf(f) + 1; }, pick: function (f) {
        var i = b.images.indexOf(f);
        if (i >= 0) b.images.splice(i, 1); else b.images.push(f);
      } }));
      art.push(hint('Bilder anklicken, die Zahl ist die Reihenfolge.'));
      art.push(range('Wechsel alle', function () { return b.interval; }, function (v) { b.interval = v; }, 5, 120, function (v) { return v + ' s'; }));
    }
    if (b.kind === 'image' || b.kind === 'slides') {
      var first = b.kind === 'image' ? b.image : b.images[0];
      if (first) {
        var fp = el('div', { class: 'focus', title: 'Klick = wichtigste Stelle im Bild' }, [el('i'), el('em', { text: 'Klick = wichtigste Stelle im Bild' })]);
        fp.style.backgroundImage = 'url("' + media(first) + '")';
        fp.style.setProperty('--fx', b.fx + '%'); fp.style.setProperty('--fy', b.fy + '%');
        fp.addEventListener('click', function (e) {
          var r = fp.getBoundingClientRect();
          var x = Math.round((e.clientX - r.left) / r.width * 100), y = Math.round((e.clientY - r.top) / r.height * 100);
          change(function () { b.fx = x; b.fy = y; });
          fp.style.setProperty('--fx', x + '%'); fp.style.setProperty('--fy', y + '%');
        });
        art.push(fp);
      }
      art.push(seg('Größe', [['cover', 'Füllen'], ['contain', 'Ganz'], ['tile', 'Kacheln']], function () { return b.size; }, function (v) { b.size = v; }));
      art.push(check('Bild bleibt beim Scrollen stehen', function () { return b.fixed; }, function (v) { b.fixed = v; }));
    }
    out.push(group('Bild', art));
    if (b.kind !== 'gradient') {
      out.push(group('Regler', [
        range('Sichtbarkeit', function () { return b.op; }, function (v) { b.op = v; }, 0, 100, function (v) { return v + ' %'; }),
        range('Unschärfe', function () { return b.blur; }, function (v) { b.blur = v; }, 0, 30, function (v) { return v + ' px'; }),
        range('Helligkeit', function () { return b.bright; }, function (v) { b.bright = v; }, -60, 60, function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '± ') + Math.abs(v); }),
        range('Farbkraft', function () { return b.sat; }, function (v) { b.sat = v; }, 0, 200, function (v) { return v + ' %'; }),
        range('Schleier', function () { return b.veil; }, function (v) { b.veil = v; }, 0, 90, function (v) { return v + ' %'; }),
        field('Schleierfarbe', colorPick(function () { return b.veilColor; }, function (v) { b.veilColor = v; }, true, 'wie Seite')),
      ]));
    }
    out.push(group('Kacheln und Kästen', [
      range('Deckkraft', function () { return b.glass; }, function (v) { b.glass = v; }, 20, 100, function (v) { return v + ' %'; }),
      range('Milchglas', function () { return b.glassBlur; }, function (v) { b.glassBlur = v; }, 0, 30, function (v) { return v + ' px'; }),
      hint('Unter 100 % scheint der Hintergrund durch, Überschriften bekommen einen leichten Schein.'),
    ]));
    return out;
  }

  function tabStil() {
    var st = S.style, out = [];
    var vl = el('div', { class: 'vl' });
    var addPreset = function (key, p, isCustom, idx) {
      var on = isCustom ? false : st.preset === key && st.accent === (p.accent || '') && st.radius === p.radius && st.tile === p.tile && st.font === p.font;
      var colors = p.grad ? 'linear-gradient(90deg,' + (p.accent || '#1f62d6') + ',' + p.grad.l[0] + ' 60%,' + p.grad.l[1] + ')' : 'linear-gradient(90deg,' + (p.accent || p.bar || '#1f62d6') + ',#bfe0ff)';
      var b = el('button', { type: 'button', class: on ? 'on' : null }, [el('i', { style: 'background:' + colors }), el('b', { text: p.label || p.name })]);
      b.addEventListener('click', function () {
        change(function () {
          if (isCustom) { Object.assign(st, copy(p.style)); return; }
          st.preset = key; st.accent = p.accent || ''; st.radius = p.radius; st.tile = p.tile; st.font = p.font;
        }, true);
      });
      if (isCustom) {
        var x = el('span', { class: 'del', text: '✕', title: 'Vorlage löschen', role: 'button' });
        x.addEventListener('click', function (e) { e.stopPropagation(); change(function () { S.custom.splice(idx, 1); }, true); });
        b.appendChild(x);
        b.querySelector('i').style.background = 'linear-gradient(90deg,' + (p.style.accent || '#1f62d6') + ',#e8eef7)';
      }
      vl.appendChild(b);
    };
    Object.keys(D.presets).forEach(function (k) { addPreset(k, D.presets[k], false); });
    (S.custom || []).forEach(function (c, i) { addPreset('', c, true, i); });
    var keep = el('button', { type: 'button', class: 'pill small', text: '＋ Als eigene Vorlage merken' });
    keep.addEventListener('click', function () {
      var name = prompt('Name der Vorlage?', 'Meine Vorlage');
      if (!name) return;
      change(function () { S.custom = (S.custom || []).concat([{ name: name.slice(0, 30), style: copy(st) }]).slice(-8); }, true);
    });
    out.push(group('Vorlagen', [vl, hint('Eine Vorlage stellt Farbe, Ecken, Kachelstil, Schrift und die Verlaufsfarben des Hintergrunds ein. Danach frei ändern.'), keep]));
    var acc = { '': 'linear-gradient(135deg,#1f62d6,#4f97ff)', '#2f8f3a': '#2f8f3a', '#cf8a0c': '#cf8a0c', '#d8432f': '#d8432f', '#6b4fd6': '#6b4fd6', '#0b7676': '#0b7676', '#d1508a': '#d1508a', '#14213d': '#14213d' };
    out.push(group('Farben', [
      field('Akzentfarbe', swatches(acc, function () { return st.accent; }, function (v) { st.accent = v; }, { '': 'Standard (Blau)' }, colorPick(function () { return st.accent; }, function (v) { st.accent = v; }))),
      check('Kachelfarben behalten (jede Kachel ihre eigene)', function () { return st.keepTiles; }, function (v) { st.keepTiles = v; }),
    ]));
    out.push(group('Form', [
      range('Ecken', function () { return st.radius; }, function (v) { st.radius = v; }, 0, 28, function (v) { return v === 0 ? 'eckig' : v + ' px'; }),
      seg('Kachelstil', [['gloss', 'Glanz'], ['flat', 'Flach'], ['glass', 'Glas'], ['outline', 'Umriss']], function () { return st.tile; }, function (v) { st.tile = v; }),
      seg('Abstände', [['eng', 'Eng'], ['normal', 'Normal'], ['luftig', 'Luftig']], function () { return st.gap; }, function (v) { st.gap = v; }),
      seg('Spalten', [['2', '2'], ['3', '3'], ['4', '4'], ['auto', 'auto']], function () { return st.cols; }, function (v) { st.cols = v; }),
    ]));
    var fonts = Object.keys(D.fonts).filter(function (k) { return k !== 'pixel'; }).map(function (k) { return [k, D.fonts[k]]; });
    out.push(group('Schrift', [
      seg('Schrift', fonts, function () { return st.font; }, function (v) { st.font = v; }),
      range('Größe', function () { return st.fsize; }, function (v) { st.fsize = v; }, 85, 130, function (v) { return v + ' %'; }),
      hint('Es werden nur Schriften genommen, die auf dem Gerät schon da sind. Nichts wird aus dem Netz geladen.'),
    ]));
    return out;
  }

  function tabExtras() {
    var ex = S.extras, out = [hint('Jedes Extra einzeln an und aus. Besucher schalten Schnee und Diashow unten in der Fußzeile unter „✨ Effekte“ für sich ab, bei „Bewegung reduzieren“ im System ruht beides.')];
    var row = function (emo, title, desc, get, set, more) {
      var t = el('input', { type: 'checkbox', class: 'tg', role: 'switch', 'aria-label': title }); t.checked = !!get();
      t.addEventListener('change', function () { change(function () { set(t.checked); }, true); });
      return el('div', { class: 'idea' }, [el('span', { class: 'emo', text: emo }), el('div', null, [el('b', { text: title }), el('p', { text: desc })].concat(more || [])), t]);
    };
    var seasonHint = D.seasonNow ? 'Gerade dran: ' + { schnee: 'Schnee', laub: 'Laub', blueten: 'Blüten', konfetti: 'Konfetti' }[D.seasonNow] + '.' : 'Gerade ist keine Deko-Zeit.';
    out.push(row('☀️', 'Begrüßung je Tageszeit', '„Guten Morgen, Name“ über dem Titel der Startseite, Gäste bekommen „Hallo!“.', function () { return ex.greet; }, function (v) { ex.greet = v; }));
    out.push(row('❄️', 'Jahreszeiten-Deko', 'Dezember und Januar Schnee, Oktober und November Laub, im April Blüten, an Silvester Konfetti. ' + seasonHint, function () { return ex.season; }, function (v) { ex.season = v; }));
    out.push(row('🌗', 'Hintergrund nach Tageszeit', 'Im Reiter Hintergrund bei „Bild“ ein Abend- und ein Nachtbild wählen, es wechselt von selbst.', function () { return ex.daytime; }, function (v) { ex.daytime = v; }));
    var n = ex.notice;
    var nMore = n.on ? [
      el('input', { type: 'text', value: n.text, maxlength: 200, placeholder: 'z. B. Server am Montag ab 20 Uhr offline', 'aria-label': 'Text', on: { input: function () { var v = this.value; change(function () { n.text = v; }); } } }),
      el('div', { class: 'row2' }, [el('label', { text: 'bis einschließlich' }), el('input', { type: 'date', value: n.until, on: { change: function () { var v = this.value; change(function () { n.until = v; }); } } }),
        seg('', [['info', 'Info'], ['warn', 'Achtung'], ['ok', 'Gut']], function () { return n.tone; }, function (v) { n.tone = v; })]),
    ] : [];
    out.push(row('📣', 'Hinweis-Leiste oben', 'Ganz oben auf allen Seiten, mit Ablaufdatum. Besucher können sie wegklicken.', function () { return n.on; }, function (v) { n.on = v; }, nMore));
    out.push(row('🧭', 'Schnellwahl in der Kopfzeile', 'Die Bereiche als kleine Reiter neben dem Titel (auf breiten Bildschirmen).', function () { return ex.quick; }, function (v) { ex.quick = v; }));
    var fMore = [el('input', { type: 'text', value: ex.foot, maxlength: 120, placeholder: 'z. B. Mit ❤️ und Kaffee auf Unraid gebaut', 'aria-label': 'Text in der Fußzeile', on: { input: function () { var v = this.value; change(function () { ex.foot = v; }); } } })];
    out.push(el('div', { class: 'idea' }, [el('span', { class: 'emo', text: '👣' }), el('div', null, [el('b', { text: 'Fußzeile mit eigenem Text' }), el('p', { text: 'Leer lassen für keinen Text.' })].concat(fMore)), el('span')]));
    out.push(row('🎴', 'Mitglieder wählen ihren Hintergrund', 'Im Kontomenü unter „🖼️ Mein Hintergrund“, aus deiner Bildauswahl, nur für sich selbst.', function () { return ex.memberBg; }, function (v) { ex.memberBg = v; }));
    return out;
  }

  var TABS = [['kopf', 'Kopfzeile', tabKopf], ['bg', 'Hintergrund', tabBg], ['stil', 'Stil', tabStil], ['extras', 'Extras', tabExtras]];
  function draw() {
    var y = sc ? sc.scrollTop : 0;
    box.querySelectorAll('.tabs button').forEach(function (b) { var on = b.getAttribute('data-tab') === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    sc.textContent = '';
    TABS.filter(function (t) { return t[0] === tab; })[0][2]().forEach(function (n) { sc.appendChild(n); });
    sc.scrollTop = y;
  }

  // ---------- Öffnen, Speichern, Schließen ----------
  function close(force) {
    if (!force && JSON.stringify(S) !== saved && !confirm('Änderungen verwerfen?')) return;
    if (JSON.stringify(S) !== saved) { saved = JSON.stringify(S); location.reload(); return; }
    box.remove(); box = null;
    body.classList.remove('lk-drawer');
    if (themeBefore === null) delete root.dataset.theme; else root.dataset.theme = themeBefore;
  }
  function save() {
    var b = box.querySelector('[data-save]');
    b.disabled = true; b.textContent = 'Speichert …';
    req('/aussehen', S).then(function () { saved = JSON.stringify(S); location.reload(); })
      .catch(function (e) { b.disabled = false; b.textContent = 'Speichern'; alert(e.message); });
  }
  function open() {
    if (box) return;
    fetch('/aussehen/daten', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (d) {
      D = d; S = copy(d.look); saved = JSON.stringify(S); hist = [];
      area = (body.className.match(/lk-a-(\w+)/) || [])[1] || 'home';
      themeBefore = root.dataset.theme || null;
      mode = (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light';
      body.classList.remove('lk-mine');
      box = el('aside', { class: 'lk-ax', role: 'dialog', 'aria-label': 'Aussehen der Seite' }, [
        el('div', { class: 'ah' }, [el('span', { class: 'emo', text: '🎨' }), el('h2', { text: 'Aussehen der Seite' }), el('button', { type: 'button', class: 'pill small x', 'aria-label': 'Schließen', text: '✕', on: { click: function () { close(); } } })]),
        el('div', { class: 'tabs', role: 'tablist' }, TABS.map(function (t) {
          return el('button', { type: 'button', role: 'tab', 'data-tab': t[0], text: t[1], on: { click: function () { tab = t[0]; draw(); sc.scrollTop = 0; } } });
        })),
        sc = el('div', { class: 'sc' }),
        el('div', { class: 'af' }, [
          el('button', { type: 'button', class: 'pill small', 'data-undo': true, disabled: true, text: '↶ Rückgängig', on: { click: undo } }),
          el('span', { class: 'sp', 'data-status': true, 'aria-live': 'polite' }),
          el('button', { type: 'button', class: 'pill small', text: 'Abbrechen', on: { click: function () { close(); } } }),
          el('button', { type: 'button', class: 'pill small pri', 'data-save': true, text: 'Speichern', on: { click: save } }),
        ]),
      ]);
      body.appendChild(box);
      body.classList.add('lk-drawer');
      draw();
      dom();
    }).catch(function () { alert('Die Einstellungen ließen sich nicht laden.'); });
  }
  document.addEventListener('keydown', function (e) {
    if (!box) return;
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
  });
  window.addEventListener('beforeunload', function (e) { if (box && S && JSON.stringify(S) !== saved) { e.preventDefault(); e.returnValue = ''; } });

  window.LookEdit = { open: open };
})();
