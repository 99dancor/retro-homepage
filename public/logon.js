// Anmeldebildschirm (views/partials/logon.ejs): bei jedem Laden des Desktops Anmelden, Registrieren oder als Gast weiter.
// War man auf diesem Gerät schon angemeldet, steht nur das eigene Konto als Kachel da (Name, Anzeigename, Profilbild im
// localStorage, kein Kennwort). Die Formulare gehen per fetch an POST /login und /register, wie die alten Fenster.
// Dazu der Abmelden-Dialog aus dem Startmenü. Läuft im <head>, damit der Desktop nicht erst aufblitzt.
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'anmeldung-konto';   // localStorage: zuletzt angemeldetes Konto { u, n, a, id, admin }
  var SKIP = 'anmeldung-weiter'; // sessionStorage: nach An- oder Abmelden einmal ohne Bildschirm laden
  var MODE = 'anmeldung-modus';  // sessionStorage: nach „Benutzer wechseln“ gleich „Anderer Benutzer…“ öffnen

  function take(k) { try { var v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch (e) { return null; } }
  function put(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* privater Modus */ } }
  var skip = take(SKIP) === '1';
  var startMode = take(MODE);
  if (!skip) root.classList.add('logon-on');

  var el, tiles, me, reg, csrf, next = '', mode = '', busy = false;

  function stored() {
    try { var k = JSON.parse(localStorage.getItem(KEY) || 'null'); return k && typeof k.u === 'string' ? k : null; } catch (e) { return null; }
  }
  function remember(k) {
    try { localStorage.setItem(KEY, JSON.stringify({ u: k.u, n: k.n || k.u, a: k.a || '', id: k.id || 0, admin: !!k.admin })); } catch (e) { /* egal */ }
  }
  function forget() { try { localStorage.removeItem(KEY); } catch (e) { /* egal */ } }
  function sound(n) { try { if (window.RetroSound) window.RetroSound.play(n); } catch (e) { /* stumm */ } }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'cls') e.className = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function avatar(k) {
    if (k.a && /^[\w.-]+$/.test(k.a)) return h('img', { src: '/avatar/' + k.a, alt: '' });
    var s = h('span', { cls: 'lg-letter', text: (Array.from(k.n || k.u)[0] || '?').toUpperCase() });
    s.style.background = 'hsl(' + ((k.id || 0) * 47 % 360) + ',45%,42%)';
    return s;
  }
  function icon(ch, cls) { return h('span', { cls: 'lg-sym ' + cls, text: ch }); }

  // ---------- Kacheln ----------
  function field(label, name, type, auto, value) {
    var id = 'lg-' + name + '-' + Math.random().toString(36).slice(2, 7);
    return h('div', { cls: 'lg-field' }, [h('label', { for: id, text: label }),
      h('input', { id: id, name: name, type: type, autocomplete: auto, value: value || null, maxlength: type === 'password' ? 200 : 32, spellcheck: 'false', autocapitalize: 'off' })]);
  }
  function form(kind, fields, k) {
    var f = h('form', { cls: 'lg-form', 'data-form': kind, novalidate: true }, fields);
    var row = h('div', { cls: 'lg-row' }, [h('button', { type: 'submit', cls: 'lg-go', title: kind === 'register' ? 'Konto anlegen' : 'Anmelden', 'aria-label': kind === 'register' ? 'Konto anlegen' : 'Anmelden', text: '➜' })]);
    if (kind !== 'register') row.appendChild(h('button', { type: 'button', cls: 'lg-help', 'data-help': true, title: 'Kennworthinweis', 'aria-label': 'Kennworthinweis', text: '?' }));
    if (kind === 'known') row.appendChild(h('button', { type: 'button', cls: 'lg-link', 'data-forget': true, text: 'Nicht mehr merken' }));
    // Das letzte Kennwortfeld bekommt den Knopf daneben, wie bei XP
    var last = f.querySelectorAll('.lg-field');
    last[last.length - 1].classList.add('lg-last');
    last[last.length - 1].appendChild(row);
    f.appendChild(h('div', { cls: 'lg-caps', hidden: true, text: '⇪ Die Feststelltaste ist aktiviert.' }));
    f.appendChild(h('div', { cls: 'lg-balloon', role: 'alert', hidden: true }, [h('b'), h('span')]));
    if (k) f.dataset.user = k.u;
    return f;
  }
  function tile(kind, pic, name, sub, frm) {
    var t = h('div', { cls: 'lg-tile', 'data-kind': kind, tabindex: '0', role: 'button', 'aria-expanded': frm ? 'false' : null }, [
      h('span', { cls: 'lg-pic' }, [pic]),
      h('span', { cls: 'lg-txt' }, [h('span', { cls: 'lg-name', text: name }), sub ? h('small', { text: sub }) : null, frm || null]),
    ]);
    return t;
  }
  function build() {
    var k = me || stored();
    tiles.textContent = '';
    el.querySelector('[data-hint]').textContent = k ? 'Klicken Sie auf Ihren Benutzernamen, um sich anzumelden.' : 'Wie möchten Sie weitermachen?';
    el.querySelector('[data-intro]').textContent = k ? 'Wählen Sie Ihr Konto, um sich anzumelden.' : 'Melden Sie sich an, legen Sie ein Konto an oder machen Sie als Gast weiter.';
    if (me) tiles.appendChild(tile('me', avatar(k), k.n, k.admin ? 'Angemeldet · Administrator' : 'Angemeldet'));
    else if (k) {
      tiles.appendChild(tile('known', avatar(k), k.n, k.admin ? 'Administrator' : '', form('known', [
        h('input', { type: 'text', name: 'username', value: k.u, autocomplete: 'username', hidden: true }),
        field('Kennwort eingeben:', 'password', 'password', 'current-password'),
      ], k)));
    }
    tiles.appendChild(tile('other', icon('👤', 'user'), k ? 'Anderer Benutzer…' : 'Anmelden', '', form('other', [
      field('Benutzername:', 'username', 'text', 'username'),
      field('Kennwort:', 'password', 'password', 'current-password'),
    ])));
    if (reg) {
      tiles.appendChild(tile('register', icon('＋', 'neu'), k ? 'Neues Konto' : 'Registrieren', '', form('register', [
        field('Benutzername:', 'username', 'text', 'username'),
        field('Kennwort (mind. 8 Zeichen):', 'password', 'password', 'new-password'),
        field('Kennwort wiederholen:', 'password2', 'password', 'new-password'),
      ])));
    }
    tiles.appendChild(tile('guest', icon('➜', 'gast'), 'Als Gast weiter', me ? 'Meldet ' + k.n + ' ab' : ''));
  }

  function select(t) {
    tiles.querySelectorAll('.lg-tile.sel').forEach(function (o) { if (o !== t) { o.classList.remove('sel'); o.setAttribute('aria-expanded', 'false'); } });
    if (!t) return;
    t.classList.add('sel'); t.setAttribute('aria-expanded', 'true');
    var inp = [].filter.call(t.querySelectorAll('input:not([hidden])'), function (i) { return !i.value; })[0] || t.querySelector('input:not([hidden])');
    if (inp) setTimeout(function () { inp.focus(); }, 0);
  }
  function activate(t) {
    var kind = t.dataset.kind;
    if (kind === 'me') return enter();
    if (kind === 'guest') return guest();
    if (!t.classList.contains('sel')) { sound('klick'); select(t); }
  }

  // ---------- Anmelden, Registrieren, Gast ----------
  function target() {
    var t = next || (location.pathname + location.search);
    return /^\/(login|register)\b/.test(t) || !/^\/(?![/\\])/.test(t) ? '/' : t;
  }
  function post(url, data) {
    data._csrf = csrf;
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok && !j.error) j.error = r.status === 429 ? 'Zu viele Versuche. Bitte warten Sie einige Minuten.' : r.status === 403 ? 'Die Seite ist abgelaufen. Bitte laden Sie sie neu.' : 'Das ging gerade nicht.';
          return j;
        });
      }, function () { return { error: 'Keine Verbindung zum Server.' }; });
  }
  function balloon(f, title, text) {
    var b = f.querySelector('.lg-balloon');
    b.querySelector('b').textContent = title;
    b.querySelector('span').textContent = text;
    b.hidden = false;
  }
  function submit(f) {
    if (busy) return;
    var kind = f.dataset.form, v = function (n) { var i = f.querySelector('[name=' + n + ']'); return i ? i.value : ''; };
    f.querySelector('.lg-balloon').hidden = true;
    if (!v('username').trim()) { balloon(f, 'Benutzername fehlt', 'Bitte geben Sie Ihren Benutzernamen ein.'); f.querySelector('[name=username]').focus(); return; }
    if (!v('password')) { balloon(f, 'Kennwort fehlt', 'Bitte geben Sie Ihr Kennwort ein.'); f.querySelector('[name=password]').focus(); return; }
    var data = { username: v('username').trim(), password: v('password'), next: target() };
    if (kind === 'register') data.password2 = v('password2');
    busy = true; el.classList.add('busy');
    post(kind === 'register' ? '/register' : '/login', data).then(function (j) {
      busy = false; el.classList.remove('busy');
      if (j.ok) {
        remember(j.user);
        welcome(j.user.n);
        put(SKIP, '1');
        setTimeout(function () { location.href = j.next || '/'; }, 1100);
        return;
      }
      sound('fehler');
      if (kind === 'register') balloon(f, 'Konto nicht angelegt', j.error);
      else balloon(f, 'Anmeldung nicht möglich', j.error + ' Achten Sie auf Groß- und Kleinschreibung. Mit „?“ sehen Sie Ihren Kennworthinweis.');
      var pw = f.querySelector('[name=password]');
      if (kind !== 'register') { pw.value = ''; pw.focus(); }
    });
  }
  function help(f) {
    var u = f.dataset.user || ((f.querySelector('[name=username]') || {}).value || '').trim();
    if (!u) { balloon(f, 'Kennworthinweis', 'Bitte geben Sie zuerst Ihren Benutzernamen ein.'); return; }
    fetch('/api/kennworthinweis?u=' + encodeURIComponent(u), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { error: true }; })
      .catch(function () { return { error: true }; })
      .then(function (j) {
        if (j.error) return balloon(f, 'Kennworthinweis', 'Der Hinweis lässt sich gerade nicht abrufen. Bitte versuchen Sie es gleich noch einmal.');
        if (j.hint) balloon(f, 'Kennworthinweis', j.hint);
        else balloon(f, 'Kennworthinweis', 'Für dieses Konto ist kein Hinweis hinterlegt. Kennwort vergessen? Wenden Sie sich an den Admin der Seite.');
      });
  }
  function welcome(name) {
    el.querySelector('[data-wname]').textContent = name ? ', ' + name : '';
    el.classList.add('welcome');
    sound('anmelden');
  }
  function enter() {
    welcome(me && me.n);
    setTimeout(hide, 800);
  }
  function guest() {
    if (me) {
      sound('abmelden');
      post('/logout', {}).then(function () { put(SKIP, '1'); location.href = target(); });
      return;
    }
    if (/^\/(login|register)\b/.test(location.pathname)) { put(SKIP, '1'); location.href = '/'; return; }
    hide();
  }

  function setInert(on) {
    ['desk', 'startmenu'].forEach(function (id) { var e = document.getElementById(id); if (e) e.inert = on; });
    document.querySelectorAll('body > .taskbar').forEach(function (e) { e.inert = on; });
  }
  function show(opts) {
    opts = opts || {};
    next = opts.next || '';
    mode = opts.mode || '';
    build();
    el.classList.remove('out', 'welcome', 'busy');
    root.classList.add('logon-on');
    setInert(true);
    var pick = null;
    if (mode === 'register') pick = tiles.querySelector('[data-kind=register]');
    else if (mode === 'login') pick = tiles.querySelector('[data-kind=known]') || (me ? null : tiles.querySelector('[data-kind=other]'));
    else if (mode === 'other') pick = tiles.querySelector('[data-kind=other]');
    if (pick) select(pick);
    else setTimeout(function () { var f = tiles.querySelector('.lg-tile'); if (f) f.focus(); }, 0);
  }
  function hide() {
    el.classList.add('out');
    setTimeout(function () {
      root.classList.remove('logon-on');
      el.classList.remove('out', 'welcome');
      setInert(false);
    }, 300);
  }

  // ---------- Abmelden aus dem Startmenü ----------
  function logoff() {
    var title = 'Bei ' + document.body.dataset.title + ' abmelden';
    var emb = el.querySelector('.lg-emb').cloneNode(true);
    var box = h('div', { cls: 'lg-off', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('div', { cls: 'lg-offbox' }, [
        h('div', { cls: 'titlebar' }, [h('span', { cls: 'ttl', text: title }), emb]),
        h('div', { cls: 'lg-offbody' }, [
          h('p', { cls: 'lg-offq', text: 'Möchten Sie sich wirklich abmelden?' }),
          h('div', { cls: 'lg-offbtns' }, [
            h('button', { type: 'button', 'data-off': 'switch' }, [icon('⇄', 'neu'), h('span', { text: 'Benutzer wechseln' })]),
            h('button', { type: 'button', 'data-off': 'logout' }, [icon('⏻', 'gast'), h('span', { text: 'Abmelden' })]),
          ]),
          h('div', { cls: 'lg-offfoot' }, [h('button', { type: 'button', 'data-off': 'cancel', text: 'Abbrechen' })]),
        ]),
      ]),
    ]);
    var dim = h('div', { cls: 'lg-offdim' });
    document.body.appendChild(dim); document.body.appendChild(box);
    setInert(true);
    function done() { dim.remove(); box.remove(); setInert(false); document.removeEventListener('keydown', esc, true); }
    function esc(e) { if (e.key === 'Escape') { e.preventDefault(); done(); } }
    document.addEventListener('keydown', esc, true);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-off]');
      if (!b) return;
      var what = b.dataset.off;
      if (what === 'cancel') return done();
      box.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
      sound('abmelden');
      if (what === 'switch') put(MODE, 'other');
      post('/logout', {}).then(function () { setTimeout(function () { location.href = '/'; }, 400); });
    });
    box.querySelector('[data-off=logout]').focus();
  }

  // Schalter unten links: wechselt zwischen Windows 98 und XP, wie „Design“ unter Anzeige → Darstellung
  function designSwitch() {
    var b = el.querySelector('[data-lg-theme]'), D = window.RetroDisplay;
    if (!b || !D) { if (b) b.hidden = true; return; }
    function label() {
      var xp = root.classList.contains('theme-xp');
      b.querySelector('[data-lg-theme-text]').textContent = xp ? 'Zu Windows 98 wechseln' : 'Zu Windows XP wechseln';
      b.title = 'Design der Seite für dieses Gerät';
    }
    b.addEventListener('click', function () {
      var xp = !root.classList.contains('theme-xp');
      D.patch(xp ? { design: 'xp', scheme: 'seite', colors: {} } : { design: '98', scheme: 'seite', colors: {} });
      sound('menue');
      label();
    });
    label();
  }

  function init() {
    el = document.getElementById('logon');
    if (!el) return;
    tiles = el.querySelector('[data-tiles]');
    csrf = document.body.dataset.csrf;
    reg = el.dataset.reg === '1';
    try { me = el.dataset.me ? JSON.parse(el.dataset.me) : null; } catch (e) { me = null; }
    if (me) remember(me);
    el.querySelector('[data-host]').textContent = location.host;
    designSwitch();

    tiles.addEventListener('click', function (e) {
      var t = e.target.closest('.lg-tile');
      if (!t) return;
      var f = e.target.closest('.lg-form');
      if (f) {
        if (e.target.closest('[data-help]')) help(f);
        else if (e.target.closest('[data-forget]')) { forget(); build(); select(tiles.querySelector('[data-kind=other]')); }
        return;
      }
      activate(t);
    });
    tiles.addEventListener('keydown', function (e) {
      if (e.target.classList.contains('lg-tile') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(e.target); }
      if (e.key === 'Escape') { var s = tiles.querySelector('.lg-tile.sel'); select(null); if (s) s.focus(); }
    });
    tiles.addEventListener('submit', function (e) { e.preventDefault(); submit(e.target); });
    ['keydown', 'keyup'].forEach(function (ev) {
      tiles.addEventListener(ev, function (e) {
        if (!e.getModifierState || e.target.type !== 'password') return;
        var c = e.target.form && e.target.form.querySelector('.lg-caps');
        if (c) c.hidden = !e.getModifierState('CapsLock');
      });
    });
    // Startmenü → abmelden: statt sofort abzumelden erst der Dialog
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (f.closest && f.closest('#startmenu') && /\/logout$/.test(f.getAttribute('action') || '')) {
        e.preventDefault();
        var m = document.getElementById('startmenu');
        if (m) m.classList.remove('open');
        logoff();
      }
    }, true);

    window.RetroLogon = { show: show };
    var q = new URLSearchParams(location.search);
    var path = location.pathname.replace(/\/$/, '');
    if (path === '/login' || path === '/register') {
      if (skip) { root.classList.add('logon-on'); }
      show({ mode: path.slice(1), next: q.get('next') || '' });
    } else if (root.classList.contains('logon-on')) show({ mode: startMode || '' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
