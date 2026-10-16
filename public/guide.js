// Kurzer Rundgang auf der Startseite: beim ersten Besuch einmal von selbst, danach über den Knopf.
(function () {
  'use strict';
  var dlg = document.getElementById('guide'), start = document.getElementById('guide-start');
  if (!dlg || !start) return;
  var KEY = 'rundgang-gesehen';
  var user = !!document.body.dataset.user;
  var STEPS = [
    ['👋 Willkommen!', 'Diese Seite sieht aus wie ein Windows-98-Desktop und funktioniert auch so. Der Rundgang dauert keine Minute.'],
    ['🪟 Startmenü', 'Unten links unter <b>Start</b> findest du alles: Blog, Dokumente, Spiele und Apps, Forum, Mitglieder und mehr. Einträge mit ▸ klappen zur Seite auf (am Handy antippen).'],
    ['🗔 Fenster', 'Jede Seite öffnet sich als Fenster. Du kannst sie verschieben, an der Ecke größer ziehen, maximieren und über die Taskleiste wechseln.'],
    ['🔔 Neben der Uhr', 'Die 🔔 zeigt Benachrichtigungen, 🖥️ ändert Farben, Schrift und Hintergrund, 🔊 die Lautstärke.' + (user ? '' : ' Die 🔔 gibt es nach dem Anmelden.')],
    ['🎮 Spielen', 'Blackjack, Paint und mehr stehen unter <b>Spiele und Apps</b>, Mein Haustier direkt im Startmenü. Mit Konto werden Spielstände und Statistik gespeichert.'],
    user ? ['👤 Dein Konto', 'Unter <b>Mein Konto</b> findest du Profil, Nachrichten und die Kontoeinstellungen. Dort stellst du auch ein, welche Benachrichtigungen du bekommst, auf Wunsch als Push aufs Handy.']
      : ['🔑 Mitmachen', 'Mit einem Konto kannst du im Forum schreiben, Freunde finden und Benachrichtigungen bekommen. Anmelden und Registrieren findest du unten im Startmenü.'],
  ];
  var i = 0;
  var box = document.getElementById('guide-step'), back = document.getElementById('guide-back'), next = document.getElementById('guide-next');
  function show() {
    box.innerHTML = '<p class="step-no">Schritt ' + (i + 1) + ' von ' + STEPS.length + '</p><h3>' + STEPS[i][0] + '</h3><p>' + STEPS[i][1] + '</p>';
    back.disabled = i === 0;
    next.textContent = i === STEPS.length - 1 ? 'Fertig' : 'Weiter »';
  }
  function open() { i = 0; show(); dlg.showModal(); try { localStorage.setItem(KEY, '1'); } catch (e) { /* egal */ } }
  back.addEventListener('click', function () { if (i > 0) { i--; show(); } });
  next.addEventListener('click', function () { if (i < STEPS.length - 1) { i++; show(); } else dlg.close(); });
  start.addEventListener('click', open);
  var seen = true;
  try { seen = !!localStorage.getItem(KEY); } catch (e) { seen = true; }
  if (!seen) open();
})();
