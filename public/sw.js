// Service Worker: zeigt Push-Benachrichtigungen an und öffnet beim Antippen die passende Seite.
// Er speichert nichts zwischen und fängt keine Seitenaufrufe ab.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || d.site || 'Neue Benachrichtigung', {
    body: d.body || '',
    icon: '/static/icon.png',
    badge: '/static/icon.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    // Ein offenes Fenster der Seite nach vorne holen, sonst ein neues öffnen
    for (var i = 0; i < list.length; i++) {
      if (new URL(list[i].url).origin === self.location.origin && 'focus' in list[i]) {
        return list[i].focus().then(function (c) { return c.navigate ? c.navigate(url) : c; });
      }
    }
    return self.clients.openWindow(url);
  }));
});
