// Profilbild zuschneiden (Mein Konto → Profil): Nach der Dateiauswahl wählt man einen quadratischen Ausschnitt,
// der Browser rechnet ihn auf 256 × 256 Pixel herunter und schickt nur das (der Server nimmt nur quadratische Bilder).
// GIFs bleiben, wie sie sind, sonst wäre die Bewegung weg; die Seite zeigt sie mittig quadratisch.
(function () {
  'use strict';
  var W = window.WinUI, form = document.querySelector('form[data-avatar-crop]');
  if (!W || !form || !window.DataTransfer || !HTMLCanvasElement.prototype.toBlob) return;
  var input = form.querySelector('input[type=file]'), OUT = 256, MAXZ = 5;

  // Als data:-Adresse, die erlaubt die Content-Security-Policy für Bilder (blob: nicht)
  function load(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader(), img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      r.onload = function () { img.src = r.result; };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function crop(img, type) {
    var iw = img.naturalWidth, ih = img.naturalHeight, z = 1, cx = iw / 2, cy = ih / 2;
    var area, view, p96, p32, zoom, A = 0, B = 0, dpr = window.devicePixelRatio || 1;
    var scale = function () { return B / Math.min(iw, ih) * z; };
    var half = function () { return Math.min(iw, ih) / z / 2; };
    function clamp() {
      var h = half();
      cx = Math.min(iw - h, Math.max(h, cx));
      cy = Math.min(ih - h, Math.max(h, cy));
    }
    function draw() {
      clamp();
      var s = scale(), c = view.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, A, A);
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, A / 2 - cx * s, A / 2 - cy * s, iw * s, ih * s);
      [p96, p32].forEach(function (p) { render(p, p.width); });
    }
    function render(canvas, size) {
      var c = canvas.getContext('2d'), h = half();
      c.imageSmoothingQuality = 'high';
      c.clearRect(0, 0, size, size);
      if (type !== 'image/png') { c.fillStyle = '#fff'; c.fillRect(0, 0, size, size); }
      c.drawImage(img, cx - h, cy - h, h * 2, h * 2, 0, 0, size, size);
    }
    function setZoom(nz) {
      z = Math.min(MAXZ, Math.max(1, nz));
      zoom.value = z;
      draw();
    }
    function wire(f, body) {
      area = body.querySelector('.crop-area'); view = area.querySelector('canvas');
      p96 = body.querySelector('[data-p96]'); p32 = body.querySelector('[data-p32]'); zoom = body.querySelector('[data-zoom]');
      A = area.clientWidth; B = A * 0.8;
      view.width = Math.round(A * dpr); view.height = Math.round(A * dpr);
      var drag = null;
      area.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, y: e.clientY, cx: cx, cy: cy };
        area.setPointerCapture(e.pointerId);
      });
      area.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var s = scale();
        cx = drag.cx - (e.clientX - drag.x) / s; cy = drag.cy - (e.clientY - drag.y) / s;
        draw();
      });
      area.addEventListener('pointerup', function () { drag = null; });
      area.addEventListener('pointercancel', function () { drag = null; });
      area.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      area.addEventListener('keydown', function (e) {
        var step = 10 / scale(), k = e.key;
        if (k === 'ArrowLeft') cx -= step; else if (k === 'ArrowRight') cx += step;
        else if (k === 'ArrowUp') cy -= step; else if (k === 'ArrowDown') cy += step;
        else if (k === '+' || k === '=') z *= 1.1;
        else if (k === '-') z /= 1.1;
        else return;
        e.preventDefault();
        setZoom(z);
      });
      zoom.addEventListener('input', function () { setZoom(Number(zoom.value)); });
      draw();
      area.focus();
    }
    var html = '<div class="crop-dlg"><div class="crop-wrap">' +
      '<div class="crop-area" tabindex="0" role="img" aria-label="Ausschnitt: ziehen oder Pfeiltasten verschieben, Mausrad, Regler oder Plus und Minus vergrößern"><canvas></canvas><div class="crop-box"></div></div>' +
      '<div class="crop-side"><b>Vorschau</b><div class="crop-prev"><canvas width="96" height="96" data-p96></canvas><canvas width="32" height="32" data-p32></canvas></div>' +
      '<label class="crop-zoom">🔍<input type="range" min="1" max="' + MAXZ + '" step="0.01" value="1" data-zoom aria-label="Vergrößern"></label>' +
      '<small>Ziehen verschiebt den Ausschnitt, Mausrad oder Regler vergrößert. So erscheint dein Bild überall auf der Seite.</small></div>' +
      '</div></div>';
    return W.dialog('Profilbild zuschneiden', html, [{ label: 'Übernehmen', value: 'ok', primary: true }, { label: 'Abbrechen', value: 'cancel' }],
      { wide: true, select: false, onOpen: wire }).then(function (r) {
      if (r.value !== 'ok') return null;
      var out = document.createElement('canvas');
      out.width = out.height = OUT;
      render(out, OUT);
      return new Promise(function (resolve) { out.toBlob(resolve, type, 0.9); });
    });
  }

  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (!f || f.type === 'image/gif') return;
    // Durchsichtiges bleibt als PNG, Fotos werden JPEG
    var type = /png|webp/.test(f.type) ? 'image/png' : 'image/jpeg';
    load(f).then(function (img) {
      return crop(img, type).then(function (blob) {
        if (!blob) { input.value = ''; return; }
        var dt = new DataTransfer();
        dt.items.add(new File([blob], 'profilbild.' + (type === 'image/png' ? 'png' : 'jpg'), { type: type }));
        input.files = dt.files;
        form.submit();
      });
    }, function () {
      input.value = '';
      W.msgbox('Dieses Bild kann dein Browser nicht öffnen. Versuch es mit PNG oder JPEG.', '⚠️', 'Profilbild');
    });
  });
})();
