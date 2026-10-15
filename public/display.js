// Darstellung: jeder Besucher richtet sich die Seite wie seinen eigenen Desktop ein (🖥️ neben der Uhr).
// Alles liegt nur im Browser (localStorage "darstellung", ein eigenes Bild unter "darstellung-bild")
// und wird nie an den Server geschickt. Läuft schon im <head>, damit nichts in falschen Farben aufblitzt:
// Farben, Schrift, Hintergrund und eigenes CSS landen in einem <style> am Ende des <head>.
(function () {
  'use strict';
  var KEY = 'darstellung', IMG_KEY = 'darstellung-bild';
  var root = document.documentElement;
  var data = { presets: {}, fonts: {} };
  try { data = JSON.parse(document.getElementById('darstellung-daten').textContent); } catch (e) { /* ohne Vorlagen */ }

  var SIZES = ['normal', 'gross', 'sehr-gross'], SCHEMES = ['seite', 'nacht', 'kontrast'];
  var MARQUEE = ['an', 'still', 'aus'], MODES = ['tile', 'cover', 'center'];
  var COLORS = { desktop: '--desktop', win: '--win', titleFrom: '--title-from', titleTo: '--title-to', text: '--text', link: '--link' };
  // Muster liegen über der Hintergrundfarbe
  var PATTERNS = {
    karo: 'repeating-conic-gradient(rgba(0,0,0,.16) 0 25%, transparent 0 50%) 0 0 / 24px 24px',
    streifen: 'repeating-linear-gradient(45deg, rgba(255,255,255,.14) 0 8px, transparent 8px 16px)',
    punkte: 'radial-gradient(rgba(255,255,255,.3) 1.5px, transparent 2px) 0 0 / 14px 14px',
    raster: 'linear-gradient(rgba(0,0,0,.18) 1px, transparent 1px) 0 0 / 20px 20px, linear-gradient(90deg, rgba(0,0,0,.18) 1px, transparent 1px) 0 0 / 20px 20px',
    wellen: 'radial-gradient(circle at 50% 100%, transparent 9px, rgba(255,255,255,.14) 10px 12px, transparent 13px) 0 0 / 28px 14px',
  };
  var DEFAULTS = { size: 'normal', scheme: 'seite', colors: {}, font: '', bg: 'seite', bgMode: 'tile', marquee: 'an', widgets: true, css: '' };
  var HEX = /^#[0-9a-f]{6}$/i, IMG = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

  var pick = function (list, v, d) { return list.indexOf(v) >= 0 ? v : d; };
  function clean(p) {
    p = p || {};
    var colors = {};
    for (var k in COLORS) if (p.colors && HEX.test(p.colors[k])) colors[k] = p.colors[k].toLowerCase();
    return {
      size: pick(SIZES, p.size, 'normal'),
      scheme: pick(SCHEMES, p.scheme, 'seite'),
      colors: colors,
      font: Object.prototype.hasOwnProperty.call(data.fonts, p.font) ? p.font : '',
      bg: p.bg === 'seite' || p.bg === 'kein' || p.bg === 'bild' || PATTERNS[p.bg] ? p.bg : 'seite',
      bgMode: pick(MODES, p.bgMode, 'tile'),
      // "still" stammt aus der ersten Fassung mit nur einem Häkchen
      marquee: pick(MARQUEE, p.marquee, p.still === true ? 'still' : 'an'),
      widgets: p.widgets !== false,
      css: typeof p.css === 'string' ? p.css.slice(0, 20000) : '',
    };
  }
  function isDefault(p) { return JSON.stringify(p) === JSON.stringify(clean(DEFAULTS)); }

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function load() { var p; try { p = JSON.parse(read(KEY)); } catch (e) { p = null; } return clean(p); }
  function loadImage() { var v = read(IMG_KEY); return v && IMG.test(v) ? v : ''; }
  // Gibt bei Erfolg true zurück; ein zu großes Bild lehnt der Browser ab
  function save(p, img) {
    try {
      if (isDefault(p)) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(p));
      if (img && p.bg === 'bild') localStorage.setItem(IMG_KEY, img); else localStorage.removeItem(IMG_KEY);
      return true;
    } catch (e) { return false; }
  }

  function cssFor(p, img) {
    var out = [], vars = [];
    for (var k in p.colors) vars.push(COLORS[k] + ':' + p.colors[k]);
    if (p.font) vars.push('--font:' + data.fonts[p.font].stack);
    if (vars.length) out.push(':root:root{' + vars.join(';') + '}');
    var bg = [];
    if (p.bg === 'kein') bg = ['background-image:none'];
    else if (PATTERNS[p.bg]) bg = ['background:' + PATTERNS[p.bg] + ', var(--desktop)'];
    else if (p.bg === 'bild' && img) {
      bg = ['background-image:url("' + img + '")'].concat(
        p.bgMode === 'cover' ? ['background-size:cover', 'background-position:center', 'background-repeat:no-repeat', 'background-attachment:fixed']
          : p.bgMode === 'center' ? ['background-size:auto', 'background-position:center', 'background-repeat:no-repeat', 'background-attachment:fixed']
            : ['background-size:auto', 'background-position:0 0', 'background-repeat:repeat']);
    }
    if (bg.length) out.push('html:root body:not(.embed){' + bg.map(function (d) { return d + ' !important'; }).join(';') + '}');
    if (p.marquee === 'aus') out.push('marquee{display:none !important}');
    if (!p.widgets) out.push('.desk-widget{display:none !important}');
    if (p.css) out.push(p.css.replace(/<\/?style/gi, ''));
    return out.join('\n');
  }

  function apply(p, img) {
    p = p || load();
    if (img === undefined) img = loadImage();
    SIZES.forEach(function (s) { root.classList.toggle('fs-' + s, s === p.size && s !== 'normal'); });
    SCHEMES.forEach(function (s) { root.classList.toggle('scheme-' + s, s === p.scheme && s !== 'seite'); });
    root.classList.toggle('still', p.marquee !== 'an');
    var el = document.getElementById('darstellung-css');
    if (!el) {
      el = document.createElement('style');
      el.id = 'darstellung-css';
      (document.head || root).appendChild(el);
    }
    var text = cssFor(p, img);
    if (el.textContent !== text) el.textContent = text;
    if (document.body) {
      document.querySelectorAll('marquee').forEach(function (m) { try { if (p.marquee === 'still') m.stop(); else m.start(); } catch (e) { /* egal */ } });
    }
  }
  apply();
  // Eigenes CSS soll auch nach Stylesheets wirken, die erst später im <head> stehen
  document.addEventListener('DOMContentLoaded', function () { var el = document.getElementById('darstellung-css'); if (el) document.head.appendChild(el); apply(); });
  window.RetroDisplay = { apply: apply };
  // Andere Fenster (iframes) übernehmen eine gespeicherte Änderung sofort
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === IMG_KEY || e.key === null) apply(); });

  // ---------- Fenster „Eigenschaften von Anzeige“ ----------
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('displaybtn'), panel = document.getElementById('displaypanel');
    if (!btn || !panel) return;
    var form = panel.querySelector('form'), f = form.elements;
    var errBox = panel.querySelector('[data-error]'), info = panel.querySelector('[data-bild-info]');
    var saved, savedImg, cur, curImg;

    function toHex(v) {
      v = String(v || '').trim();
      if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      return HEX.test(v) ? v.toLowerCase() : '#000000';
    }
    function error(msg) { errBox.textContent = msg || ''; errBox.hidden = !msg; }
    // Vorschau hier und in allen Fenstern, ohne zu speichern
    function preview() {
      apply(cur, curImg);
      document.querySelectorAll('iframe').forEach(function (fr) {
        try { if (fr.contentWindow.RetroDisplay) fr.contentWindow.RetroDisplay.apply(cur, ''); } catch (e) { /* fremde Seite */ }
      });
    }
    function fill() {
      var cs = getComputedStyle(root);
      for (var k in COLORS) f[k].value = toHex(cs.getPropertyValue(COLORS[k]));
      f.bg.value = cur.bg; f.bgMode.value = cur.bgMode; f.font.value = cur.font; f.size.value = cur.size;
      f.marquee.value = cur.marquee; f.widgets.checked = cur.widgets;
      if (document.activeElement !== f.css) f.css.value = cur.css;
      info.textContent = curImg ? 'Eigenes Bild gewählt' : '';
    }
    function update(change) { change(cur); cur = clean(cur); preview(); fill(); }

    function open() {
      saved = load(); savedImg = loadImage();
      cur = clean(saved); curImg = savedImg;
      error(''); fill();
      panel.hidden = false; btn.setAttribute('aria-expanded', true);
      panel.querySelector('[role=tab][aria-selected=true]').focus();
    }
    function close(keep) {
      if (!keep) { cur = saved; curImg = savedImg; preview(); }
      panel.hidden = true; btn.setAttribute('aria-expanded', false);
    }
    function commit() {
      if (!save(cur, curImg)) { error('Der Browser hat nicht genug Platz zum Speichern. Nimm ein kleineres Bild.'); return false; }
      saved = clean(cur); savedImg = curImg; error('');
      return true;
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById('startmenu');
      if (menu) menu.classList.remove('open');
      if (panel.hidden) open(); else close(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { close(false); btn.focus(); } });
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var t = e.target.closest('button, a[href]');
      if (!t) return;
      if (t.dataset.tab) {
        panel.querySelectorAll('[role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b === t); });
        panel.querySelectorAll('.tab-page').forEach(function (pg) { pg.hidden = pg.dataset.page !== t.dataset.tab; });
      } else if (t.dataset.act === 'cancel') close(false);
      else if (t.dataset.act === 'apply') commit();
      else if (t.dataset.act === 'reset') { curImg = ''; update(function (p) { for (var k in DEFAULTS) p[k] = DEFAULTS[k]; p.colors = {}; }); }
      else if (t.dataset.scheme) update(function (p) { p.scheme = t.dataset.scheme; p.colors = {}; });
      else if (t.dataset.preset && data.presets[t.dataset.preset]) update(function (p) { p.scheme = 'seite'; p.colors = Object.assign({}, data.presets[t.dataset.preset]); });
      else if (t.matches('a[href]') && window.RetroDesk) {
        // Links öffnen auf dem Desktop ein eigenes Fenster
        e.preventDefault(); close(false);
        window.RetroDesk.open(t.getAttribute('href'), false);
      }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (commit()) close(true); });
    form.addEventListener('input', function (e) {
      var n = e.target.name;
      if (COLORS[n]) update(function (p) { p.colors[n] = e.target.value; });
      else if (n === 'css') update(function (p) { p.css = e.target.value; });
    });
    form.addEventListener('change', function (e) {
      var n = e.target.name;
      if (n === 'bild') return readImage(e.target);
      if (n === 'bg' && e.target.value === 'bild' && !curImg) { f.bild.click(); fill(); return; }
      if (['bg', 'bgMode', 'font', 'size', 'marquee'].indexOf(n) >= 0) update(function (p) { p[n] = e.target.value; });
      else if (n === 'widgets') update(function (p) { p.widgets = e.target.checked; });
    });

    // Eigenes Bild: verkleinert und als data:-Adresse im Browser abgelegt, nie hochgeladen
    function readImage(input) {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) return error('Das ist kein Bild.');
      var reader = new FileReader();
      reader.onload = function () {
        var src = String(reader.result);
        var im = new Image();
        im.onload = function () {
          var url = src;
          var max = 1920, scale = Math.min(1, max / Math.max(im.width, im.height));
          // Kleine Bilder (z. B. Kachelmuster) bleiben unverändert, große werden als JPEG verkleinert
          if (src.length > 600000 || scale < 1 || !IMG.test(src)) {
            var c = document.createElement('canvas');
            c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            url = c.toDataURL('image/jpeg', 0.85);
            if (url.length > 2500000) url = c.toDataURL('image/jpeg', 0.6);
          }
          if (url.length > 3500000) return error('Das Bild ist zu groß.');
          error('');
          curImg = url;
          update(function (p) { p.bg = 'bild'; if (scale < 1 || im.width > 400) p.bgMode = p.bgMode === 'tile' ? 'cover' : p.bgMode; });
        };
        im.onerror = function () { error('Das Bild lässt sich nicht lesen.'); };
        im.src = src;
      };
      reader.readAsDataURL(file);
    }
  });
})();
