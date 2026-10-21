// Ton für die ganze Seite: Lautstärke für Musik und Effekte (🔊 neben der Uhr) und kleine Klangeffekte.
// Die Lautstärke liegt nur im Browser (localStorage "lautstaerke"). Alle Fenster lesen denselben Wert,
// der Musik-Player und das Haustier-Spiel hören über das storage-Ereignis mit, wenn er sich ändert.
// Die Effekte sind eigene, im Browser erzeugte Klänge (Web Audio), keine Tondateien.
(function () {
  'use strict';
  var KEY = 'lautstaerke';
  var DEFAULTS = { musik: 0.8, effekte: 0.5, stumm: false };
  var listeners = [];

  function num(v, d) { v = Number(v); return v >= 0 && v <= 1 ? v : d; }
  function clean(p) {
    p = p || {};
    return { musik: num(p.musik, DEFAULTS.musik), effekte: num(p.effekte, DEFAULTS.effekte), stumm: p.stumm === true };
  }
  function load() { try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return clean(null); } }
  var vol = load();
  function emit() { listeners.forEach(function (fn) { try { fn(api.get()); } catch (e) { /* weiter */ } }); }
  function set(p) {
    vol = clean(Object.assign({}, vol, p));
    try { localStorage.setItem(KEY, JSON.stringify(vol)); } catch (e) { /* privat: gilt bis zum Neuladen */ }
    emit();
  }
  // Änderungen aus anderen Fenstern (iframes) und Tabs
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) { vol = load(); emit(); } });

  // ---------- Klangeffekte ----------
  var ctx = null, out = null;
  function audio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) { ctx = new AC(); out = ctx.createGain(); out.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Ein Ton mit kurzer Hüllkurve, optional mit Tonhöhen-Gleiten
  function tone(c, t, o) {
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.d);
    var peak = o.v || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.a || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + o.d + 0.02);
  }
  function noise(c, t, o) {
    var len = Math.ceil(c.sampleRate * o.d), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = o.filter || 'bandpass'; f.frequency.value = o.f || 2000; f.Q.value = o.q || 1;
    g.gain.setValueAtTime(o.v || 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t);
  }
  function chord(c, t, notes, o) { notes.forEach(function (f, i) { tone(c, t + i * (o.step || 0), Object.assign({}, o, { f: f })); }); }

  var SOUNDS = {
    menue: function (c, t) { noise(c, t, { d: 0.03, f: 3500, q: 2, v: 0.25 }); tone(c, t, { f: 1800, d: 0.04, v: 0.08 }); },
    klick: function (c, t) { noise(c, t, { d: 0.02, f: 2500, q: 3, v: 0.2 }); },
    oeffnen: function (c, t) { tone(c, t, { f: 523, d: 0.09, type: 'triangle', v: 0.25 }); tone(c, t + 0.06, { f: 784, d: 0.14, type: 'triangle', v: 0.22 }); },
    schliessen: function (c, t) { tone(c, t, { f: 784, d: 0.08, type: 'triangle', v: 0.22 }); tone(c, t + 0.06, { f: 523, d: 0.14, type: 'triangle', v: 0.2 }); },
    minimieren: function (c, t) { tone(c, t, { f: 880, to: 330, d: 0.16, v: 0.18 }); },
    maximieren: function (c, t) { tone(c, t, { f: 330, to: 880, d: 0.16, v: 0.18 }); },
    fehler: function (c, t) { chord(c, t, [311, 415], { d: 0.45, type: 'triangle', v: 0.22 }); },
    hinweis: function (c, t) { chord(c, t, [1047, 1568], { d: 0.6, v: 0.16, step: 0.09 }); },
    ding: function (c, t) { tone(c, t, { f: 1319, d: 0.5, v: 0.22 }); tone(c, t, { f: 2637, d: 0.25, v: 0.06 }); },
    // Zufallsgenerator: Würfel klappern und ein kleiner Tusch zum Ergebnis
    wuerfel: function (c, t) { noise(c, t, { d: 0.025, f: 1800, q: 4, v: 0.22 }); noise(c, t + 0.035, { d: 0.02, f: 2600, q: 4, v: 0.15 }); },
    // Blackjack: Karte wird ausgeteilt, Chips klimpern
    karte: function (c, t) { noise(c, t, { d: 0.05, f: 4200, q: 1.2, v: 0.18 }); noise(c, t + 0.03, { d: 0.03, f: 1500, q: 2, v: 0.1 }); },
    chips: function (c, t) { [0, 0.045, 0.085].forEach(function (o, i) { tone(c, t + o, { f: 2900 + i * 350, d: 0.05, type: 'triangle', v: 0.09 }); }); },
    // Tusch: Zufallsgenerator und Blackjack
    tusch: function (c, t) { chord(c, t, [523, 659, 784], { d: 0.12, type: 'square', v: 0.07, step: 0.09 }); chord(c, t + 0.3, [523, 659, 784, 1047], { d: 0.7, type: 'square', v: 0.06 }); },
    // Werwolf: Heulen zur Nacht, Hahn bzw. heller Klang zum Morgen
    heulen: function (c, t) { tone(c, t, { f: 300, to: 560, d: 0.6, a: 0.25, v: 0.16 }); tone(c, t + 0.55, { f: 560, to: 360, d: 1.1, a: 0.05, v: 0.14 }); },
    morgen: function (c, t) { chord(c, t, [659, 784, 988, 1319], { d: 0.35, type: 'triangle', v: 0.12, step: 0.12 }); },
    // Minesweeper: Uhr tickt, Mine explodiert, gewonnen
    'ms-tick': function (c, t) { tone(c, t, { f: 1400, d: 0.03, type: 'square', v: 0.05 }); },
    'ms-boom': function (c, t) { noise(c, t, { d: 0.6, f: 400, q: 0.7, filter: 'lowpass', v: 0.6 }); tone(c, t, { f: 120, to: 40, d: 0.5, type: 'sawtooth', v: 0.15 }); },
    'ms-sieg': function (c, t) { chord(c, t, [523, 659, 784, 1047], { d: 0.16, type: 'square', v: 0.07, step: 0.11 }); },
    anmelden: function (c, t) { chord(c, t, [392, 523, 659, 784], { d: 0.9, type: 'triangle', v: 0.14, step: 0.11 }); },
    // Kartenspiele: Gläser stoßen an
    prost: function (c, t) { [0, 0.07].forEach(function (o, i) { tone(c, t + o, { f: 2350 + i * 410, d: 0.35, v: 0.1 }); tone(c, t + o, { f: 5300 + i * 700, d: 0.12, v: 0.03 }); }); },
  };

  function play(name) {
    // In einem Fenster spielt der Desktop den Klang: dort hat der Browser sicher schon einen Klick gesehen
    if (window.top !== window) {
      try { if (window.parent.RetroSound && window.parent.RetroSound !== api) return window.parent.RetroSound.play(name); } catch (e) { /* fremde Seite */ }
    }
    var level = vol.stumm ? 0 : vol.effekte;
    if (!level || !SOUNDS[name]) return;
    var c = audio();
    if (!c) return;
    out.gain.value = level;
    try { SOUNDS[name](c, c.currentTime + 0.01); } catch (e) { /* alter Browser */ }
  }

  var api = window.RetroSound = {
    get: function () { return { musik: vol.musik, effekte: vol.effekte, stumm: vol.stumm }; },
    set: set,
    // tatsächliche Lautstärke 0..1 für Musik und Effekte
    musik: function () { return vol.stumm ? 0 : vol.musik; },
    effekte: function () { return vol.stumm ? 0 : vol.effekte; },
    onChange: function (fn) { listeners.push(fn); },
    play: play,
  };

  // ---------- Lautstärke neben der Uhr ----------
  function wire() {
    var btn = document.getElementById('volumebtn'), panel = document.getElementById('volumepanel');
    if (!btn || !panel) return;
    var inputs = { musik: panel.querySelector('[name=musik]'), effekte: panel.querySelector('[name=effekte]') };
    var mute = panel.querySelector('[name=stumm]');
    function icon() {
      var v = api.get(), loud = Math.max(v.musik, v.effekte);
      btn.textContent = v.stumm || !loud ? '🔇' : loud < 0.4 ? '🔉' : '🔊';
    }
    function show() {
      var v = api.get();
      for (var k in inputs) {
        inputs[k].value = Math.round(v[k] * 100);
        var o = inputs[k].parentNode.querySelector('output');
        if (o) o.textContent = Math.round(v[k] * 100) + ' %';
      }
      mute.checked = v.stumm;
      panel.classList.toggle('muted', v.stumm);
      icon();
    }
    function toggle(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open);
      if (open) { show(); inputs.musik.focus(); }
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(panel.hidden); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { if (!panel.hidden) toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { toggle(false); btn.focus(); } });
    Object.keys(inputs).forEach(function (k) {
      inputs[k].addEventListener('input', function () { var p = {}; p[k] = inputs[k].value / 100; set(p); });
    });
    // Probe-Klang beim Loslassen des Effekt-Reglers, wie bei Windows
    inputs.effekte.addEventListener('change', function () { play('ding'); });
    mute.addEventListener('change', function () { set({ stumm: mute.checked }); });
    api.onChange(show);
    show();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
