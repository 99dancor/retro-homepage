# 💾 Retro-Homepage

Selbst gehostete Homepage im Look von Windows 98 / 2000 – mit Blog, Downloads (z. B. Spielstände),
Modlisten, Linksammlung, Freundebuch, Kontaktformular, eigenen Seiten, einem Bereich für
Browser-Spiele/Apps und einem Admin-Bereich mit Besucherstatistik, Nutzer- und Rechteverwaltung
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
   zwischen – auf dem Raspberry Pi, also meist auf der SD-Karte.

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
| **Blog** | Markdown-Editor mit Toolbar, Bilder hochladen per Button, Drag & Drop oder Strg+V, Vorschau, Tags, Entwürfe, Datum frei wählbar |
| **Downloads** | Mehrere Dateien auf einmal hochladen (mit Fortschrittsanzeige), Kategorien + Spiel, Suche, Download-Zähler |
| **Modlisten** | Pro Spiel, eine Mod pro Zeile: `Name \| Link \| Version \| Notiz`, `*` = optional |
| **Links** | Linksammlung nach Kategorien |
| **Freundebuch** | Mit Name, anonym oder als angemeldeter Nutzer; optional Freischaltung durch dich; Spam-Schutz |
| **Kontakt** | Nachrichten landen im Admin-Postfach, optional E-Mail-Benachrichtigung (SMTP) |
| **Eigene Seiten** | z. B. „Über mich“, erscheinen auf Wunsch im Menü |
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
- **Alles mit eigenem Server** (z. B. Mehrspieler-Quiz mit WebSockets): als eigenen Docker-Container
  auf Unraid laufen lassen, in NPM eine Subdomain anlegen (z. B. `quiz.deine-domain.de`,
  Websockets an) und die Adresse bei der App unter „Externer Dienst“ eintragen. Die App erscheint
  dann im Retro-Fenster unter „Spiele & Apps“.

---

## 4. Lokal entwickeln

```bash
npm install
npm run dev        # http://localhost:3000, Daten landen in ./data
npm test           # Rauchtest: startet den Server und klickt die wichtigsten Wege durch
```

Umgebungsvariablen siehe `.env.example`.
