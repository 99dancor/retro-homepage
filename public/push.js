// Konto und Passwort → Benachrichtigungen: Push-Benachrichtigungen auf diesem Gerät ein- und ausschalten.
// Der Service Worker (/sw.js) zeigt sie an; die Seite schickt sie über den Push-Dienst des Browsers.
(function () {
  'use strict';
  var box = document.getElementById('push');
  if (!box) return;
  var CSRF = box.dataset.csrf, state = document.getElementById('push-state');
  var on = document.getElementById('push-on'), off = document.getElementById('push-off'), test = document.getElementById('push-test');
  var ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  function say(t) { state.textContent = t; state.classList.remove('muted'); }
  function post(url, data) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF }, body: JSON.stringify(data || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status); return j; }); });
  }
  function keyBytes(b64) {
    var s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function label() {
    var ua = navigator.userAgent;
    var os = /Android/.test(ua) ? 'Android' : ios ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    var br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return br + (os ? ' auf ' + os : '');
  }
  function show(sub) {
    on.hidden = !!sub; off.hidden = !sub; test.hidden = !sub;
    say(sub ? '✔ Dieses Gerät bekommt Push-Benachrichtigungen.' : Notification.permission === 'denied'
      ? '⚠ Benachrichtigungen sind für diese Seite im Browser blockiert. Erlaube sie in den Browser-Einstellungen.'
      : 'Dieses Gerät bekommt noch keine Push-Benachrichtigungen.');
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
    document.getElementById('push-ios').hidden = !ios;
    say(ios && !standalone ? 'Auf diesem Gerät geht Push erst, wenn die Seite auf dem Home-Bildschirm liegt.' :
      !window.isSecureContext ? 'Push geht nur über https.' : 'Dieser Browser kann keine Push-Benachrichtigungen.');
    return;
  }
  document.getElementById('push-ios').hidden = !ios || standalone;
  var reg;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (r) { reg = r; return navigator.serviceWorker.ready; })
    .then(function () { return reg.pushManager.getSubscription(); })
    .then(function (sub) {
      show(sub);
      // Abo neu melden, falls der Server es nicht (mehr) kennt
      if (sub) post('/api/push/abo', { subscription: sub.toJSON(), label: label() }).catch(function () {});
    })
    .catch(function (e) { say('Push lässt sich hier nicht einrichten: ' + e.message); });

  on.addEventListener('click', function () {
    on.disabled = true;
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
      return fetch('/api/push/key').then(function (r) { return r.json(); });
    }).then(function (j) {
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(j.key) });
    }).then(function (sub) {
      return post('/api/push/abo', { subscription: sub.toJSON(), label: label() }).then(function () { location.reload(); });
    }).catch(function (e) { say('⚠ ' + e.message); on.disabled = false; });
  });
  off.addEventListener('click', function () {
    reg.pushManager.getSubscription().then(function (sub) {
      if (!sub) return null;
      return post('/api/push/abmelden', { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); });
    }).then(function () { location.reload(); }).catch(function (e) { say('⚠ ' + e.message); });
  });
  test.addEventListener('click', function () {
    test.disabled = true;
    post('/api/push/test').then(function (j) { say(j.sent ? '✔ Test geschickt, er sollte gleich erscheinen.' : '⚠ Der Push-Dienst hat den Test nicht angenommen.'); })
      .catch(function (e) { say('⚠ ' + e.message); }).then(function () { test.disabled = false; });
  });
})();
