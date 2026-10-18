# 🐾 Pixelpfoten

Eingebautes Haustier-Spiel der Homepage unter `/haustier/` (Startmenü → 🐾 Pixelpfoten, bis Oktober 2026 „Mein Haustier“;
Ordner, Adresse und Spielstand-Schlüssel heißen weiter `haustier`):
Haustier aussuchen, jeden Tag versorgen, Münzen sammeln und im Shop gegen Futter, Spielzeug und
Accessoires tauschen.

Reines HTML/CSS/JavaScript ohne Build-Schritt und ohne eigene Abhängigkeiten.

## Einbau in die Homepage

- `src/routes/games.js` liefert `src/` unter `/haustier/` aus. Direkt aufgerufen kommt wie bei jeder Seite
  der Desktop mit dem Spiel als Fenster. Im Fenster blendet das Spiel seine eigene Titelleiste aus.
- `index.html` bekommt vom Server die Anmeldung und die Adressen der Homepage als data-Attribute an `<body>`
  (Skripte im HTML verbietet die Sicherheitsrichtlinie): `data-user`, `data-login`, `data-register`
  (leer, wenn die Registrierung geschlossen ist) und `data-forum` (leer, wenn das Forum aus ist).
- Links zu anderen Seiten öffnen deren Fenster auf dem Desktop. Nach dem Anmelden lädt der Desktop neu,
  das Spiel holt sich dann den Konto-Spielstand.
- Gespeichert wird über `/api/saves/haustier/main`, ohne Eintrag unter Spiele & Apps (`src/games.js`).
- Im Docker-Image landet nur `src/`.

## Ton

`src/js/sound.js` erzeugt Tierstimmen (eine pro Art) und Effekte mit Web Audio, ohne Tondateien. Die Lautstärke
liest das Spiel aus dem localStorage-Eintrag `lautstaerke` der Homepage (`effekte` 0–1, `stumm`), den der
🔊-Regler neben der Uhr schreibt; der 🔊-Knopf im Spiel schaltet dort `stumm` um. Fehlt der Eintrag, gilt 50 %.

## Spielregeln

Grundlage ist das Konzept in der Projektablage (`haustier/konzept.md`), als „Mischung“ mit dem schon Gebauten.

- **Tiere:** Katze, Hund, Kaninchen, Hamster und Ratte gibt es von Anfang an, je in drei Farben.
  Besondere Tiere schaltet eine Besuchsserie frei: Fuchs ab 3, Axolotl ab 7, Drache ab 14 Tagen in Folge.
- **Werte** von 0 bis 100: Liebe, Spaß, Nahrung, Wasser, Ruhe und Erfüllung. Sie sinken mit der Zeit, auch
  wenn niemand spielt, aber durch Zeit allein nie unter 10. Erfüllung folgt langsam dem Durchschnitt der anderen
  Werte. Jede Art hat eigene Bedürfnisse. Ein Tier stirbt nie, es wird nur traurig.
- **Zuneigungsstufen 1–10:** Jede Pflege bringt Erfahrung, die nie verloren geht. Stufe 3 schaltet Kuscheln frei
  (zusammen mit 70 Liebe), Stufe 5 den zweiten Tierplatz und den Puzzle-Futterball, Stufe 8 die Krone.
  Jede neue Stufe bringt Stufe × 50 Münzen.
- **Tierplätze:** ein Tier zu Beginn, der zweite Platz ab Zuneigungsstufe 5, der dritte für 2.000 Münzen im Shop.
- **Zimmer:** Alle Tiere sind gemeinsam im Zimmer und laufen frei herum (`src/js/scene.js`, Entscheidungen in
  `src/js/behavior.js`): Sie wandern, sitzen, dösen bei wenig Ruhe, besuchen sich (Herzchen) und spielen Fangen.
  Schlafende Tiere gehen ins Körbchen, wenn es eins gibt. Antippen wählt ein Tier aus. Die Bewegung ist nur Anzeige,
  gespeichert werden Positionen nicht. Bei „Bewegung reduzieren“ im System bleiben die Tiere sitzen.
- **Spielzeugkiste** unter dem Zimmer, je nach Spielzeug (`TOYS` in `behavior.js`): **Werfen** (Ball, Wollknäuel,
  Quietsche-Ente, Frisbee, Plüschtier, Puzzle-Futterball: ziehen und loslassen; Hund und Fuchs bringen es zurück),
  **Locken** (Federangel, Laserpointer, Knabberstab folgen dem Zeiger), **Seifenblasen** (Tippen pustet sie, sie sinken
  langsam) und **Stationen** (Laufrad, Tunnel, Kletterseil: antippen). Jedes Tier, das das Spielzeug benutzen kann und
  nicht zu müde ist, macht mit. Fängt oder benutzt ein Tier das Spielzeug, zählt das als „Spielen“ mit diesem
  Spielzeug (höchstens alle 2,5 s je Tier); hat es genug davon, verliert es eine Weile das Interesse.
- **Pflege:** Streicheln (auch durch Streichen über das Tier), Kuscheln, Füttern (verbraucht Futter aus dem
  Inventar), Wasser geben (gratis), Spielen (mit Spielzeug aus der Kiste), Bürsten (Bürste, alle 2 Std), Baden (Seife,
  einmal am Tag), Gassi/Ausflug (Leine für Hund und Fuchs, Laufball für Hamster und Ratte, alle 4 Std, mit Chance
  auf ein Fundstück), Schlafen legen und Aufwecken. Wer dasselbe oft hintereinander macht, bewirkt immer
  weniger; das erholt sich mit der Zeit. Jedes Spielzeug ermüdet für sich.
- **Lieblingssachen** (❤️) wirken 50 % stärker, z. B. Thunfisch für Katzen oder der Ball für Hunde.
- **Start:** ein Ball und 5 × Trockenfutter.

## Besuche

Mitglieder besuchen die Tiere anderer Mitglieder, allein oder mit einem eigenen Tier (Menü 🏘️ Besuchen).
Regeln in `src/js/visits.js` (vom Spiel und vom Server genutzt), Server-Teil in `src/pixelpfoten.js` und
`src/routes/pixelpfoten.js` der Homepage unter `/api/pixelpfoten` (nur mit Konto).

- **Wer darf:** `visitors` im Spielstand: `members` (Voreinstellung), `friends` oder `none`. Besucher sehen nur
  Zimmer, Name, Art, Farbe, Accessoires, Stufe und Werte der Tiere (`publicPet`), keine Münzen oder Inventar.
- **Besuchsbuch** (Tabelle `pp_visits`): vorbeischauen (1×), streicheln (6×), spielen (6×), mit eigenem Tier
  (1×), Futter dalassen (3×, Futter bis 60 Münzen aus dem eigenen Inventar), Gruß (1×), jeweils am Tag je
  Gastgeber. Der Spielstand bleibt in der Hand seines Besitzers: Das Spiel des Gastgebers holt die Einträge beim
  Öffnen (und sofort, wenn es offen ist) und rechnet sie mit `applyVisits` ein. Einträge verschwinden nach 30 Tagen.
- **Belohnung:** die ersten drei Gastgeber am Tag bringen je 10 Münzen, das mitgebrachte Tier bekommt einmal je
  Gastgeber und Tag Spaß und Erfüllung (`state.outgoing`).
- **Live-Zimmer:** Server-Sent Events (`GET /api/pixelpfoten/live/<name>`). Jedes Spiel ist für seine eigenen
  Tiere zuständig und schickt ihren Stand fünfmal pro Sekunde (`POST`), solange noch jemand im Zimmer ist; der
  Server prüft ihn (`cleanLivePet`) und reicht ihn weiter. Nur im Arbeitsspeicher, höchstens 8 Leute je Zimmer.
- Ist der Gastgeber nicht live, laufen seine Tiere als Simulation im Zimmer und spielen mit dem Spielzeug des
  Besuchers; im Live-Zimmer laufen sie so, wie sie beim Gastgeber gerade laufen.
- Ist der Gastgeber nicht im Spiel, bekommt er einmal am Tag je Besucher eine Benachrichtigung (`besuch`).

## Wie war dein Tag?

Einmal am Tag drei Ja/Nein-Fragen zum eigenen Wohlbefinden: „Hast du den Tag heute überlebt?“, „Hast du etwas
Gutes für dich getan?“, „Geht es dir gut?“. Ja bringt 10 Münzen und 5 Erfüllung für alle Tiere, Nein 8 Münzen.
Vor dem Antworten nennt das Spiel die Belohnungen bewusst nicht, damit niemand nur wegen der Münzen „Ja“ sagt.
Bei „Geht es dir gut? – Nein“ schlägt das Spiel einen Forumsbeitrag vor, auf Wunsch anonym (das Forum hat
dafür „Anonym veröffentlichen“; nur der Admin sieht dann den Namen).
Gespeichert wird nur der Tag der Antwort, nicht die Antworten.

## Changelog

`src/changelog.md` im selben Format wie das Changelog der Homepage (`## TT.MM.JJJJ – Titel`, darunter `- `-Punkte).
Das Spiel zeigt es unter 📜 an und markiert neue Einträge mit einem roten Punkt. Bei jeder Änderung oben einen
Eintrag ergänzen.

## Münzen und Shop

- **Pflege** bringt 1–5 Münzen je Aktion, höchstens 150 am Tag.
- **Login-Bonus** im 7-Tage-Rhythmus: 20, 25, 30, 35, 40, 50, 100 + Überraschung. Serien von 7/30/100 Tagen
  bringen einmalig 100/500/1.500 extra.
- **Tagesaufgaben:** jeden Tag drei, passend zur Ausrüstung (15–30 Münzen).
- **Konto-Geschenk:** einmalig 200 Münzen und das Homepage-Halstuch.
- **Shop** mit Futter, Spielzeug, Pflege, Accessoires (Kopf, Hals, Rücken) und Räumen, dazu jeden Tag ein Angebot
  mit 30 % Rabatt. Manches gibt es erst ab einer Stufe, einer Serie oder nur zu einer Jahreszeit.
- **Inventar** zum Benutzen, An- und Ablegen und Einrichten.

Noch nicht dabei (laut Konzept „später“): Tricks, Igel, Pinguin, Panda, Einhorn, Abzeichen und saisonale Events.
Gegenstände nur für diese Tiere (Bambus, Igelhandschuh, Eisscholle) fehlen deshalb noch.

Die Zahlen stehen oben in `src/js/pets.js`, `src/js/economy.js` und `src/js/items.js` und lassen sich dort anpassen.

## Spielstand

| Wer | Wo gespeichert |
| --- | --- |
| Gast | nur im Browser (`localStorage`). Das Spiel zeigt einen Hinweis, dass ein Konto den Stand dauerhaft und geräteübergreifend sichert. |
| Angemeldet | im Konto über die Spielstand-Schnittstelle der Homepage (`/api/saves/haustier/main`), dazu eine lokale Kopie für kurze Verbindungsabbrüche |

- Meldet sich jemand an, der vorher als Gast gespielt hat, wird der Gast-Stand ins Konto übernommen.
  Haben beide Stände Fortschritt, fragt das Spiel, welcher bleiben soll.
- Änderungen werden gebündelt hochgeladen und spätestens beim Verlassen der Seite gesichert.
- Kehrt man zum Tab zurück, holt das Spiel einen neueren Stand von einem anderen Gerät.
- Nach einem Start ohne Netz gewinnt beim späteren Abgleich der Kontostand, falls er sich inzwischen
  geändert hat, damit nie echter Fortschritt überschrieben wird.

## Lokal ausprobieren

Im Hauptordner der Homepage:

```bash
npm run dev     # http://localhost:3000/haustier/
npm test        # Rauchtest der Homepage und Tests des Spiels (games/haustier/test)
```

## Aufbau

```
src/index.html      Oberfläche
src/changelog.md    Neuigkeiten für Spieler
src/css/game.css    Windows-98-Look, übernimmt die Farben aus /theme.css der Homepage
src/js/state.js     Spielstand (reine Funktionen)
src/js/pets.js      Tierarten, Werte, Zeit und Pflege (reine Funktionen)
src/js/items.js     alle Gegenstände (Futter, Spielzeug, Pflege, Accessoires, Räume)
src/js/economy.js   Münzen, Login-Bonus, Tagesaufgaben, Shop
src/js/art.js       Vektorgrafiken der Tiere (mit Gruppen für Augen, Ohren, Kopf, Pfoten, Schwanz), Accessoires und Räume
src/js/behavior.js  Verhalten im Zimmer und Spielzeugarten (reine Funktionen)
src/js/scene.js     Zimmer-Szene: Tiere, Spielzeug, Napf, Animationen, Tiere anderer Mitglieder
src/js/visits.js    Regeln für Besuche (reine Funktionen, auch vom Server genutzt)
src/js/live.js      Verbindung zum Server: Nachbarn, Besuchsbuch, Live-Zimmer
src/js/storage.js   Laden/Speichern für Gäste und Konten
src/js/main.js      Ablauf und Oberfläche
test/               Tests (node --test)
```
