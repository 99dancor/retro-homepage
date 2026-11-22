// Version 3.0: gewähltes Farbschema (hell/dunkel) setzen, bevor die Seite gezeichnet wird. Wird ohne defer geladen.
try { var t = localStorage.getItem('v3-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* privat */ }
// Update 100: Tageszeit für „Hintergrund nach Tageszeit“ (Abend 17–21 Uhr, Nacht 21–6 Uhr), als Klasse an <html>
(function () { var h = new Date().getHours(); document.documentElement.classList.add(h >= 17 && h < 21 ? 'lk-t-e' : h >= 21 || h < 6 ? 'lk-t-n' : 'lk-t-d'); })();
