// Version 3.0: gewähltes Farbschema (hell/dunkel) setzen, bevor die Seite gezeichnet wird. Wird ohne defer geladen.
try { var t = localStorage.getItem('v3-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* privat */ }
