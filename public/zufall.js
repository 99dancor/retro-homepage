// Zufallsgenerator (Startmenü → 🎲 Zufallsgenerator): Zahlen, Wörter und Teamauslosung mit Animation.
// Läuft komplett im Browser, nichts davon geht an den Server oder bleibt gespeichert.
(function () {
  'use strict';
  var root = document.getElementById('zufall');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var busy = false;

  // ---------- Zufall ----------
  // crypto statt Math.random, und ohne Modulo-Verzerrung
  function randInt(n) {
    if (n <= 1) return 0;
    var max = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= max);
    return buf[0] % n;
  }
  function between(a, b) { return a + randInt(b - a + 1); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = randInt(i + 1), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function pick(arr) { return arr[randInt(arr.length)]; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduced.matches ? 0 : ms); }); }
  function sound(name) { if (window.RetroSound) window.RetroSound.play(name); }
  function clampInt(el, lo, hi) {
    var v = Math.round(Number(el.value));
    if (!isFinite(v)) v = lo;
    v = Math.max(lo, Math.min(hi, v));
    el.value = v;
    return v;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---------- Reiter ----------
  root.querySelector('.tabs').addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (!t) return;
    root.querySelectorAll('[role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b === t); });
    root.querySelectorAll('.tab-page').forEach(function (pg) { pg.hidden = pg.dataset.page !== t.dataset.tab; });
  });

  // ---------- Namensfelder ----------
  function syncNames(box, count, label) {
    var inputs = box.querySelectorAll('input');
    for (var i = inputs.length; i < count; i++) {
      var inp = el('input');
      inp.type = 'text'; inp.maxLength = 40; inp.placeholder = label + ' ' + (i + 1);
      inp.setAttribute('aria-label', 'Name für ' + label + ' ' + (i + 1));
      box.appendChild(inp);
    }
    for (var j = inputs.length - 1; j >= count; j--) inputs[j].remove();
  }
  function names(box, label) {
    return Array.prototype.map.call(box.querySelectorAll('input'), function (inp, i) { return inp.value.trim() || label + ' ' + (i + 1); });
  }
  var playersEl = $('zf-players'), teamsEl = $('zf-teams');
  var playerBox = $('zf-player-names'), teamBox = $('zf-team-names');
  function refreshNames() {
    syncNames(playerBox, clampInt(playersEl, 2, 100), 'Spieler');
    syncNames(teamBox, clampInt(teamsEl, 2, 20), 'Team');
  }
  playersEl.addEventListener('change', refreshNames);
  teamsEl.addEventListener('change', refreshNames);
  refreshNames();
  root.querySelector('[data-clear=teams]').addEventListener('click', function () {
    root.querySelectorAll('.zf-names input').forEach(function (i) { i.value = ''; });
  });

  // ---------- Teams auslosen ----------
  var TEAM_COLORS = ['#c0392b', '#2471a3', '#229954', '#d68910', '#7d3c98', '#17a589', '#ca6f1e', '#2e4053', '#c71585', '#6b8e23'];
  var TEAM_ICONS = ['🦊', '🐻', '🦉', '🐸', '🦄', '🐙', '🦁', '🐧', '🐢', '🦖', '🐝', '🦈', '🐲', '🦩', '🐺', '🦔', '🐼', '🐨', '🦀', '🐬'];

  async function drawTeams() {
    var stage = $('zf-team-stage');
    var players = names(playerBox, 'Spieler'), teamNames = names(teamBox, 'Team');
    var t = teamNames.length;
    // Gemischte Spieler reihum auf die Teams verteilen; welches Team bei ungerader Zahl mehr bekommt, ist auch Zufall
    var order = shuffle(players.slice()), teamOrder = shuffle(teamNames.map(function (_, i) { return i; }));
    var icons = shuffle(TEAM_ICONS.slice());
    stage.textContent = '';

    // 1. Lostopf: alle Karten wirbeln durcheinander
    var pot = el('div', 'zf-pot');
    pot.appendChild(el('div', 'zf-pot-label', '🎩 Lostopf'));
    var cards = players.map(function (n) { var c = el('span', 'zf-card', n); pot.appendChild(c); return c; });
    stage.appendChild(pot);
    if (!reduced.matches) {
      pot.classList.add('shake');
      for (var r = 0; r < 8; r++) {
        sound('wuerfel');
        // ein paar Karten tauschen sichtbar die Plätze
        for (var k = 0; k < Math.max(2, cards.length / 3); k++) {
          var a = pick(cards), b = pick(cards);
          if (a !== b) pot.insertBefore(a, b);
        }
        cards.forEach(function (c) { c.style.transform = 'rotate(' + (randInt(31) - 15) + 'deg) translateY(' + (randInt(11) - 5) + 'px)'; });
        await wait(140);
      }
      cards.forEach(function (c) { c.style.transform = ''; });
      pot.classList.remove('shake');
    }

    // 2. Teamkästen aufbauen
    var grid = el('div', 'zf-teamgrid'), lists = [];
    teamNames.forEach(function (name, i) {
      var box = el('div', 'zf-team');
      box.style.setProperty('--team', TEAM_COLORS[i % TEAM_COLORS.length]);
      var head = el('div', 'zf-team-head');
      head.appendChild(el('span', 'zf-team-icon', icons[i % icons.length]));
      head.appendChild(el('span', null, name));
      var count = el('span', 'zf-team-count', '0');
      head.appendChild(count);
      box.appendChild(head);
      var ul = el('ol', 'zf-team-list');
      box.appendChild(ul);
      grid.appendChild(box);
      lists.push({ box: box, ul: ul, count: count, n: 0 });
    });
    stage.appendChild(grid);

    // 3. Karten fliegen nacheinander in ihr Team (FLIP: von alter zu neuer Position animieren)
    var step = Math.max(60, Math.min(380, 3500 / order.length));
    var byName = cards.slice();
    for (var p = 0; p < order.length; p++) {
      var team = lists[teamOrder[p % t]];
      var idx = byName.findIndex(function (c) { return c.textContent === order[p]; });
      var card = byName.splice(idx, 1)[0];
      var from = card.getBoundingClientRect();
      var li = el('li');
      li.appendChild(card);
      team.ul.appendChild(li);
      team.count.textContent = ++team.n;
      if (!reduced.matches) {
        var to = card.getBoundingClientRect();
        card.animate([
          { transform: 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(1.3) rotate(-12deg)' },
          { transform: 'translate(0,0) scale(1) rotate(0)' },
        ], { duration: Math.min(500, step * 1.6), easing: 'cubic-bezier(.3,1.4,.6,1)' });
        team.box.animate([{ transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 200 });
        sound('klick');
      }
      await wait(step);
    }
    pot.remove();
    grid.classList.add('done');
    sound('tusch');
    confetti();
  }

  // ---------- Zahlen ----------
  async function drawNumbers() {
    var stage = $('zf-number-stage');
    var lo = Math.round(Number($('zf-min').value)), hi = Math.round(Number($('zf-max').value));
    if (!isFinite(lo)) lo = 1;
    if (!isFinite(hi)) hi = 100;
    if (lo > hi) { var s = lo; lo = hi; hi = s; }
    lo = Math.max(lo, -1e9); hi = Math.min(hi, 1e9);
    $('zf-min').value = lo; $('zf-max').value = hi;
    var span = hi - lo + 1, count = clampInt($('zf-count'), 1, 100), unique = $('zf-unique').checked;
    stage.textContent = '';
    if (unique && count > span) {
      stage.appendChild(el('p', 'zf-error', 'Zwischen ' + lo + ' und ' + hi + ' gibt es nur ' + span + ' verschiedene Zahlen.'));
      sound('fehler');
      return;
    }
    var result = [], seen = {};
    while (result.length < count) {
      var v = between(lo, hi);
      if (unique && seen[v]) continue;
      seen[v] = true; result.push(v);
    }
    var boxes = result.map(function () { var b = el('span', 'zf-number', '?'); stage.appendChild(b); return b; });
    await rattle(boxes, result, function () { return between(lo, hi); });
    if (count > 1) stage.appendChild(el('p', 'zf-sum', 'Summe: ' + result.reduce(function (a, b) { return a + b; }, 0)));
    sound('tusch');
    confetti(count === 1 ? 60 : 30);
  }

  // Zählwerk: alle Felder rattern, dann bleibt eins nach dem anderen stehen
  async function rattle(boxes, finals, fake) {
    if (reduced.matches) { boxes.forEach(function (b, i) { b.textContent = finals[i]; b.classList.add('hit'); }); return; }
    var stopped = 0, tick = 0, total = 12 + Math.min(boxes.length, 10) * 3;
    while (stopped < boxes.length) {
      tick++;
      for (var i = stopped; i < boxes.length; i++) boxes[i].textContent = fake();
      if (tick % 2) sound('wuerfel');
      // nach einer Anlaufphase bleibt alle paar Takte ein Feld stehen
      if (tick > 12 && (tick - 12) % 3 === 0 || tick > total) {
        boxes[stopped].textContent = finals[stopped];
        boxes[stopped].classList.add('hit');
        sound('ding');
        stopped++;
      }
      await wait(Math.min(160, 40 + tick * 4));
    }
  }

  // ---------- Wörter ----------
  var WORDS = ('Apfel,Banane,Gitarre,Elefant,Regenschirm,Leuchtturm,Pirat,Rakete,Schneemann,Zahnbürste,Kaktus,Drache,Fahrrad,Burg,Vulkan,' +
    'Pinguin,Zauberer,Eisbär,Brille,Hubschrauber,Kühlschrank,Schatzkarte,Ritter,Roboter,Feuerwehr,Giraffe,Trampolin,Wolkenkratzer,Bumerang,' +
    'Teekanne,Schildkröte,Fernseher,Schlagzeug,Kompass,Igel,Mikrofon,Achterbahn,Zelt,Diamant,Briefkasten,Krokodil,Schneeflocke,Laterne,' +
    'Ballon,Känguru,Kartoffel,Zirkus,Detektiv,Meerjungfrau,Gespenst,Wikinger,Tornado,Uhr,Leiter,Hängematte,Kran,Papagei,Tintenfisch,' +
    'Lagerfeuer,Bratpfanne,Seilbahn,Gartenzwerg,Kerze,Maulwurf,Hai,Weihnachtsmann,Osterhase,Schaukel,Waschmaschine,Kamel,Zahnarzt,Mond,' +
    'Fußball,Sandburg,Staubsauger,Pyramide,Joystick,Diskette,Gameboy,Tamagotchi,Walkman,Kassette,Modem,Faxgerät,Dinosaurier,Einhorn,' +
    'Koala,Flamingo,Ananas,Popcorn,Pizza,Brezel,Sushi,Donut,Wassermelone,Zitrone,Eule,Fledermaus,Schmetterling,Spinne,Schnecke,' +
    'Feuerwerk,Regenbogen,Gewitter,Insel,Wüste,Dschungel,Iglu,Windmühle,Brücke,Tunnel,U-Boot,Segelboot,Traktor,Zug,Flugzeug,Astronaut,' +
    'Koch,Clown,Ninja,Cowboy,Vampir,Mumie,Zombie,König,Prinzessin,Hexe,Besen,Zauberstab,Krone,Schwert,Schild,Kanone,Anker,Flaschenpost')
    .split(',');

  // Die eigene Liste braucht man nur, solange sie ausgewählt ist
  root.querySelectorAll('input[name=zf-words]').forEach(function (r) {
    r.addEventListener('change', function () { $('zf-wordlist').hidden = r.value === 'eingebaut' && r.checked; });
  });

  function ownWords() {
    return $('zf-wordlist').value.split(/[\n,;]+/).map(function (w) { return w.trim(); }).filter(Boolean);
  }
  async function drawWords() {
    var stage = $('zf-word-stage');
    var builtIn = root.querySelector('input[name=zf-words]:checked').value === 'eingebaut';
    var list = builtIn ? WORDS : ownWords();
    // doppelte Einträge zählen nur einmal
    list = list.filter(function (w, i) { return list.indexOf(w) === i; });
    stage.textContent = '';
    if (!list.length) {
      stage.appendChild(el('p', 'zf-error', 'Schreib erst ein paar Wörter in die Liste oder nimm die eingebauten Wörter.'));
      sound('fehler');
      return;
    }
    var count = Math.min(clampInt($('zf-wcount'), 1, 50), list.length);
    var result = shuffle(list.slice()).slice(0, count);
    var boxes = result.map(function () { var b = el('span', 'zf-word', '…'); stage.appendChild(b); return b; });
    await rattle(boxes, result, function () { return pick(list); });
    sound('tusch');
    confetti(30);
  }

  // ---------- Konfetti ----------
  var canvas = $('zf-confetti'), raf = 0;
  function confetti(amount) {
    if (reduced.matches || !canvas.getContext) return;
    var ctx = canvas.getContext('2d'), w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight;
    var bits = [], n = amount || 120;
    for (var i = 0; i < n; i++) {
      bits.push({
        x: w / 2 + (randInt(201) - 100), y: h * 0.35,
        vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        s: 5 + randInt(6), c: pick(TEAM_COLORS.concat(['#ffd700', '#ff69b4', '#00ced1'])),
      });
    }
    cancelAnimationFrame(raf);
    var start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, w, h);
      var alive = false;
      bits.forEach(function (b) {
        b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        if (b.y < h + 20) alive = true;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (alive && now - start < 4000) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    })(start);
  }

  // ---------- Knöpfe ----------
  var ACTIONS = { teams: drawTeams, zahl: drawNumbers, wort: drawWords };
  root.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-go]');
    if (!b || busy) return;
    busy = true;
    root.querySelectorAll('[data-go]').forEach(function (x) { x.disabled = true; });
    try { await ACTIONS[b.dataset.go](); }
    finally {
      busy = false;
      root.querySelectorAll('[data-go]').forEach(function (x) { x.disabled = false; });
    }
  });
    root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    // in einem Namensfeld springt Enter ins nächste Feld, sonst wird ausgelost
    var next = e.target.closest('.zf-names') && e.target.nextElementSibling;
    if (next) return next.focus();
    var page = e.target.closest('.tab-page'), go = page && page.querySelector('[data-go]');
    if (e.target.type === 'number') e.target.dispatchEvent(new Event('change'));
    if (go) go.click();
  });
})();
