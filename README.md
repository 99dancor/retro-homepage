# 💾 Retro-Homepage

Selbst gehostete Homepage im Look von Windows 98 / 2000 – mit Blog, Downloads (z. B. Spielstände),
Modlisten, Linksammlung, Forum, Besucherbuch, Kontaktformular, eigenen Seiten, Musik-Player mit
Lobbys zum gemeinsamen Hören, Blackjack und Poker mit Spielgeld, Paint mit Galerie, Quiz für Spieleabende, einem Bereich für Browser-Spiele/Apps und einem Admin-Bereich mit Besucherstatistik, Nutzer- und Rechteverwaltung
und Design-Editor.

Technik: Node.js 22 + Express, SQLite (eingebaut, keine extra Datenbank), serverseitig gerenderte
Seiten, ein einziger Docker-Container. Alle Daten liegen in **einem Ordner** (`/data`).

---

## 1. Installation auf Unraid

Bei jedem Push auf `main` testet GitHub den Code und baut automatisch ein fertiges Docker-Image:
`ghcr.io/99dancor/retro-homepage:latest`. Unraid lädt nur noch dieses Image.

### Variante A: Unraid-Vorlage (empfohlen)

1. Unraid → **Terminal** (oben rechts `>_`) öffnen und die Vorlage herunterladen:

   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-retro-homepage.xml \
     https://raw.githubusercontent.com/99dancor/retro-homepage/main/unraid/retro-homepage.xml
   ```

2. Unraid → **Docker** → **Add Container** → oben bei *Template* **retro-homepage** wählen.
3. Optional ein **Admin-Passwort** eintragen (sonst steht ein zufälliges im Container-Log),
   dann **Apply**.
4. Die Seite läuft unter `http://UNRAID-IP:8080`. Mit `admin` anmelden und unter
   **Mein Konto** das Passwort ändern.

**Updates per Klick:** Unraid → Docker → **Check for Updates** → beim Container **apply update**.
Die Daten bleiben dabei erhalten.

> Meldet Unraid beim ersten Mal „denied“ oder „not found“: auf GitHub unter
> **Profil → Packages → retro-homepage → Package settings → Change visibility** auf **Public** stellen.

### Variante B: Docker Compose

Mit dem Plugin **„Docker Compose Manager“** einen Stack anlegen und den Inhalt von
`docker-compose.yml` einfügen, dann **Compose Up**. Update: **Update Stack**.

### Wenn das Repository privat ist

Dann ist auch das Image privat. Einmalig im Unraid-Terminal anmelden
(Token unter GitHub → Settings → Developer settings → Personal access tokens, Recht `read:packages`):

```bash
docker login ghcr.io -u 99dancor
```

Die Vorlage aus Schritt 1 dann manuell als Datei nach
`/boot/config/plugins/dockerMan/templates-user/my-retro-homepage.xml` kopieren.

### Große Downloads auf einer eigenen Platte

Downloads liegen standardmäßig im Daten-Ordner (bei Unraid meist auf der Cache-SSD). Für Dateien
mit mehreren GB kannst du sie auf die Festplatten im Array legen:

1. Unraid → **Shares** → **Add Share**: Name `homepage-dateien`, *Primary storage* **Array**
   (kein Cache), bei Bedarf eine bestimmte Platte unter *Included disk(s)* wählen.
   SMB-Freigabe für dich einschalten (*SMB Security Settings* → *Export: Yes*, z. B. *Private*).
2. Container stoppen. Falls schon Dateien hochgeladen wurden: den Inhalt von
   `/mnt/user/appdata/retro-homepage/uploads/` in die neue Freigabe verschieben.
3. Container bearbeiten → **Download-Dateien** auf `/mnt/user/homepage-dateien` setzen
   (Compose: die auskommentierte Zeile bei `volumes` aktivieren) → **Apply**.

Datenbank, Bilder und Einstellungen bleiben auf der SSD, nur die Download-Dateien wandern aufs Array.
Eine Platte außerhalb des Arrays (Plugin „Unassigned Devices“) geht genauso, z. B. `/mnt/disks/NAME/homepage`.

**Dateien mit vielen GB hochladen:** Statt über den Browser einfach im Heimnetz in den Ordner
`eingang` der Freigabe kopieren (`\\UNRAID\homepage-dateien\eingang`). Unter Admin → Dateien
erscheinen sie dann zum Übernehmen – Kategorie und Sichtbarkeit wählen, fertig.
Das geht ohne Größengrenze und ohne Umweg über den Raspberry Pi.

### Backup

Den Ordner `/mnt/user/appdata/retro-homepage` sichern (z. B. mit dem Plugin „Appdata Backup“).
Darin liegen Datenbank, hochgeladene Dateien, Bilder und Apps. Die Dateien gehören
`nobody:users` (99:100), wie bei Unraid üblich.

---

## 2. Nginx Proxy Manager (auf dem Raspberry Pi 5)

1. NPM öffnen → **Hosts → Proxy Hosts → Add Proxy Host**
2. **Details**
   - Domain Names: `deine-domain.de` (und ggf. `www.deine-domain.de`)
   - Scheme: `http`
   - Forward Hostname / IP: **IP des Unraid-Servers** (z. B. `192.168.178.20`)
   - Forward Port: **8080**
   - ✅ Block Common Exploits
   - ✅ **Websockets Support** (für spätere Mehrspieler-Apps)
3. **SSL**: Let's-Encrypt-Zertifikat anfordern, ✅ Force SSL, ✅ HTTP/2
4. **Advanced** – wichtig für große Dateien. Zeilen von Hand eintippen, jede endet mit `;`:

   ```nginx
   client_max_body_size 0;
   proxy_request_buffering off;
   proxy_buffering off;
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
   ```

   Ohne die beiden `…buffering off`-Zeilen speichert NPM große Uploads und Downloads erst
   zwischen – auf dem Raspberry Pi, also meist auf der SD-Karte. `proxy_buffering off` brauchen
   auch die Musik-Lobbys, Blackjack- und Pokertische, damit Play, Pause, Liedwechsel und Karten sofort bei allen ankommen.
   (Die Seite schickt dafür zusätzlich `X-Accel-Buffering: no` mit.)

5. Im Router die Ports **80 und 443** auf den Raspberry Pi weiterleiten (falls noch nicht
   geschehen). Port 8080 des Unraid-Servers **nicht** ins Internet freigeben.

Die echte Besucher-IP (für Statistik und Spam-Schutz) wird automatisch aus dem
`X-Forwarded-For`-Header des Pi übernommen, weil der Pi im lokalen Netz steht. Wer es
strenger möchte, setzt `TRUST_PROXY` auf die IP des Pi.

> **Ohne HTTPS?** Die Seite funktioniert auch per reinem `http://`. Für Logins übers Internet
> ist HTTPS über NPM aber dringend empfohlen, sonst gehen Passwörter im Klartext durchs Netz.

---

## 3. Funktionen

| Bereich | Was geht |
|---|---|
| **Blog** | Editor mit Live-Vorschau, Bilder hochladen per Button, Drag & Drop oder Strg+V; Bilder in der Vorschau anklicken für Lage (links/mittig/rechts, Text fließt drumherum) und Größe, an der Ecke ziehen, per Drag & Drop verschieben; Tags, Entwürfe, Datum frei wählbar |
| **Downloads** | Mehrere Dateien auf einmal hochladen (mit Fortschrittsanzeige), Kategorien + Spiel, Suche, Download-Zähler |
| **Modlisten** | Pro Spiel, eine Mod pro Zeile: `Name \| Link \| Version \| Notiz`, `*` = optional |
| **Links** | Linksammlung nach Kategorien |
| **Forum** | Angemeldete Nutzer erstellen Themen und antworten (mit Bildern), auf Wunsch anonym (nur der Admin sieht den Namen), bearbeiten/löschen eigene Beiträge; Admin pinnt an, schließt und löscht. Unter Einstellungen abschaltbar oder nur für Mitglieder lesbar |
| **Changelog** | Im Startmenü, Inhalt aus `CHANGELOG.md` (wird mit jedem Update ergänzt) |
| **Datenschutz** | Im Startmenü unter `/datenschutz`: in einfacher Sprache, was über Besucher gespeichert wird, mit aufklappbaren Code-Ausschnitten und Screenshots der Admin-Ansicht. Die Ausschnitte liest der Server aus dem laufenden Code (Anker in `src/privacy.js`); wer neue Daten speichert, ergänzt Seite und Anker |
| **Darstellung** | Knopf 🖥️ neben der Uhr öffnet „Eigenschaften von Anzeige“: Hintergrund (Farbe, Muster, eigenes Bild), alle Design-Vorlagen plus Dunkel/Hoher Kontrast, Einzelfarben, Schriftart und -größe, Lauftext, Desktop-Elemente, eigenes CSS. Gilt pro Browser (localStorage, eigenes Bild als verkleinerte data:-Adresse), nichts geht an den Server. Vorlagen und Schriften kommen aus `src/themes.js`, die das Admin-Design mitbenutzt |
| **Besucherbuch** | Mit Name, anonym oder als angemeldeter Nutzer; optional Freischaltung durch dich; Spam-Schutz |
| **Kontakt** | Nachrichten landen im Admin-Postfach, optional E-Mail-Benachrichtigung (SMTP) |
| **Eigene Seiten** | z. B. „Über mich“, erscheinen auf Wunsch im Menü |
| **Musik** | Player im Startmenü unter `/musik` im Stil des Windows Media Player: Bibliothek (deine Sammlung und Uploads der Mitglieder), Suche, Zufall/Wiederholen, Playlists der Mitglieder (privat, für Mitglieder oder öffentlich), 8 Visualisierungen nach Art der XP-Klassiker (Balken, Oszilloskop, Ozeannebel, Feuersturm, Ambiente, Batterie, Stacheln, Musikfarben) mit Vollbild. Du lädst unter Admin → Musik hoch und vergibst Sichtbarkeit inkl. Gruppen; Mitglieder laden im Player hoch (wer darf und wie viel Speicher, unter Einstellungen). Titel/Interpret kommen aus den ID3-Tags oder dem Dateinamen |
| **Musik-Lobbys** | Mitglieder öffnen eine Lobby und hören dieselbe Warteschlange gleichzeitig (Live-Verbindung per Server-Sent Events). Eigene Titel, Playlists und YouTube-Videos oder -Playlists hinzufügen; Gastgeber legt fest, ob alle steuern dürfen, und kann die Lobby verstecken (nur mit Einladungslink). YouTube läuft über youtube-nocookie.com und erst nach einem Klick; unter Einstellungen abschaltbar. Lobbys leben nur im Arbeitsspeicher |
| **Ton** | Knopf 🔊 neben der Uhr: Lautstärke für Musik und Effekte, „Ton aus“. Fenster öffnen/schließen, Startmenü und Fehlermeldungen klingen wie bei Windows (eigene, im Browser erzeugte Klänge), das Haustier-Spiel hat Tierstimmen und Effekte |
| **Mein Haustier** | Eingebautes Spiel unter `/haustier/` (Startmenü): Haustier aussuchen, täglich versorgen, Münzen verdienen und im Shop ausgeben. Gäste spielen im Browser, mit Konto wird im Konto gespeichert. Details in [`games/haustier/README.md`](games/haustier/README.md) |
| **Blackjack** | Eingebautes Kartenspiel unter `/blackjack` (Startmenü) für angemeldete Mitglieder: Tische mit bis zu 5 Plätzen und Zuschauern, live per Server-Sent Events; gemischt und gegeben wird auf dem Server. Spielgeld: Start mit 1.000 €, Nachkaufen ohne Limit unter 200 €. Bilanz (Chips minus alles Eingekaufte), Bestenliste und Zahlen im Profil. Buy-in, Nachkauf-Grenze, Decks, Soft-17-Regel und Bedenkzeit unter Einstellungen; Bestenliste oder einzelne Bilanzen zurücksetzbar |
| **Poker** | Texas Hold'em ohne Limit unter `/poker` (Startmenü → Spiele und Apps) für angemeldete Mitglieder: Tische mit 2 bis 6 Plätzen, Blinds pro Tisch, Zuschauer, live per Server-Sent Events. Jeder Browser bekommt nur die eigenen Handkarten, fremde erst im Showdown; Nebenpots bei All-in. Buy-in, Nachkauf-Grenze und Bilanz wie bei Blackjack (Tabelle `pk_sessions`), Bestenliste und Profil-Karte. Admin: Einstellungen → Poker. |
| **Paint** | Nachbau von Paint aus Windows 98 unter `/paint` (Startmenü): alle 16 Werkzeuge mit ihren Pinselgrößen, 28er-Farbpalette und „Farben bearbeiten“, Auswahl verschieben, strecken und durchsichtig einsetzen, Bilder einfügen (Zwischenablage, Ziehen, Datei), Kippen/Drehen, Strecken/Zerren, Attribute, Zoom mit Raster, Rückgängig. Gäste malen und laden herunter (PNG, BMP, JPG); Mitglieder speichern im Konto (privat, für Mitglieder oder öffentlich) und setzen Bilder als Hintergrund. Öffentliche Bilder stehen in der 🖼️ Galerie und im Profil. Lobbys zum gemeinsamen Malen mit Live-Zeigern, Chat, eigenem Rückgängig, Malrechten vom Gastgeber, Entwurf beim Ersteller und Mitmalern beim Speichern („Gemeinsam gemalt“). Speicher pro Mitglied, Höchstgröße, Gäste, Galerie, Lobbys und Freigabe durch den Admin unter Admin → Paint |
| **Quiz** | Quiz-Abende unter `/quiz` (Startmenü → Spiele): Raum eröffnen, Mitspieler kommen per Code, Einladungslink oder QR-Code (Mitglieder mit Avatar, Gäste mit Namen und Bild). Fragetypen Buzzer, Multiple Choice, Wahr/Falsch, Schätzen (mit Einheit, automatische Wertung nach Nähe) und Freitext. Der Spielleiter baut Fragen vorher oder spontan, sieht Eingaben live beim Tippen, wertet mit Richtig/Falsch, vergibt Extrapunkte und kann rückgängig machen; Punkte, Timer und Buzzer-Reihenfolge rechnet der Server. Mitglieder speichern Quizze im Konto und laden sie aus einer Liste (eigene und geteilte), dazu Datei-Export. Ergebnisse im Profil; Wer eröffnen darf, Gäste und Grenzen unter Admin → Quiz |
| **Spiele & Apps** | HTML5-Spiele als ZIP hochladen (Godot, Unity WebGL, Phaser, eigenes JS …) oder externe Dienste einbetten |
| **Design** | Farben, Hintergrundbild (kacheln/füllen/zentriert), Schrift, Lauftext, Besucherzähler, eigenes CSS, 5 Vorlagen |
| **Statistik** | Seitenaufrufe & Besucher pro Tag, Top-Seiten, Herkunft, Geräte, aktive Mitglieder – ohne Cookies, ohne gespeicherte IPs |
| **Download-Statistik** | Pro Datei: Downloads, verschiedene Personen, vollständig/abgebrochen, übertragene Datenmenge, Verlauf, Uhrzeit, Herkunft, Mitglieder, letzte Vorgänge; freier Speicher |
| **Nutzer & Rechte** | Nutzer anlegen/sperren, Admin-Rolle, Upload-Recht, Gruppen; jede Datei/jeder Beitrag/jede Liste/Seite/App hat eine Sichtbarkeit: öffentlich · nur angemeldete · nur bestimmte Gruppen · nur Admin |

### E-Mail-Benachrichtigung einrichten
Admin → Einstellungen → „E-Mail-Benachrichtigung“. Beispiele:

| Anbieter | Server | Port | SSL/TLS direkt |
|---|---|---|---|
| Gmail (App-Passwort nötig) | smtp.gmail.com | 465 | ✅ |
| GMX | mail.gmx.net | 587 | ❌ |
| web.de | smtp.web.de | 587 | ❌ |
| Outlook/Hotmail | smtp-mail.outlook.com | 587 | ❌ |

Danach „Test-E-Mail senden“.

### Spiele & Apps hosten
- **Statische Spiele/Apps:** Build als ZIP hochladen. Liegt alles in einem Unterordner, wird das
  automatisch erkannt. Vorkomprimierte Unity-Dateien (`.br`, `.gz`) werden korrekt ausgeliefert.
  Große Dateien (z. B. Godots `.wasm`) komprimiert die Seite nach dem Hochladen selbst im
  Hintergrund und liefert sie dann komprimiert aus (38 MB → etwa 7 MB).
- **Spielstände im Konto:** Spiele können für angemeldete Nutzer speichern. Sie liegen unter
  **Mein Konto → Meine Spielstände** und lassen sich dort löschen. Schnittstelle für das Spiel
  (`<app>` ist der Kurzname aus der Adresse `/apps/<app>`, `<platz>` z. B. `slot_1`):
  - `GET /api/saves/<app>`: Liste der Plätze, ohne Login `401`
  - `GET /api/saves/<app>/<platz>`: `{ "data": "…" }`, `404` wenn leer
  - `PUT /api/saves/<app>/<platz>` mit JSON `{ "data": "…" }` (höchstens 5 MB, 20 Plätze je Spiel)
  - `DELETE /api/saves/<app>/<platz>`
- **Spielstatistik im Profil:** Mit Konto zählt die Seite selbst, wie oft ein Spiel gestartet wurde.
  Weitere Zahlen meldet das Spiel; sie erscheinen im Profil unter „Spielstatistik“:
  - `GET /api/stats/<app>`: `{ "stats": { "Siege": 3, … } }`, ohne Login `401`
  - `PATCH /api/stats/<app>` mit JSON, z. B. `{ "add": { "Siege": 1 }, "max": { "Höchster Gewinn": 250 } }`.
    `add` zählt hoch, `max`/`min` behalten den größten/kleinsten Wert, `set` überschreibt.
    Namen: bis 40 Zeichen (Buchstaben, Zahlen, Leerzeichen, `_ . : ' ( ) -`), höchstens 50 je Spiel;
    „Gestartet“ ist der Zähler der Seite.
- **Alles mit eigenem Server** (z. B. Mehrspieler-Quiz mit WebSockets): als eigenen Docker-Container
  auf Unraid laufen lassen, in NPM eine Subdomain anlegen (z. B. `quiz.deine-domain.de`,
  Websockets an) und die Adresse bei der App unter „Externer Dienst“ eintragen. Die App erscheint
  dann im Retro-Fenster unter „Spiele & Apps“.

---

## 4. Lokal entwickeln

```bash
npm install
npm run dev        # http://localhost:3000, Daten landen in ./data
npm test           # Rauchtest (startet den Server und klickt die wichtigsten Wege durch), Blackjack- und Poker-Regeln, Paint-Werkzeuge, Paint-Lobbys, Quiz-Wertung und Tests des Haustier-Spiels
```

Das Haustier-Spiel liegt in `games/haustier/src` (HTML/CSS/JS ohne Build-Schritt) und läuft lokal unter
http://localhost:3000/haustier/.

Umgebungsvariablen siehe `.env.example`.
