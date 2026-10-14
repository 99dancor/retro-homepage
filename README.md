# 💾 Retro-Homepage

Selbst gehostete Homepage im Look von Windows 98 / 2000 – mit Blog, Downloads (z. B. Spielstände),
Modlisten, Linksammlung, Freundebuch, Kontaktformular, eigenen Seiten, einem Bereich für
Browser-Spiele/Apps und einem Admin-Bereich mit Besucherstatistik, Nutzer- und Rechteverwaltung
und Design-Editor.

Technik: Node.js 22 + Express, SQLite (eingebaut, keine extra Datenbank), serverseitig gerenderte
Seiten, ein einziger Docker-Container. Alle Daten liegen in **einem Ordner** (`/data`).

---

## 1. Installation auf Unraid

**Voraussetzung:** Das Plugin **„Docker Compose Manager“** (Unraid → Apps → „Compose Manager“ suchen).

1. Diesen Ordner auf den Unraid-Server kopieren, z. B. nach
   `/mnt/user/appdata/retro-homepage-src/` (per SMB-Freigabe oder `scp`).
2. Unraid → **Docker** → unten **„Add New Stack“** → Name `retro-homepage`.
3. Beim Stack auf das Zahnrad → **„Edit Stack“ → „Compose File“** und den Inhalt von
   `docker-compose.yml` einfügen. Dabei `build: .` ersetzen durch
   `build: /mnt/user/appdata/retro-homepage-src`.
4. Optional ein Admin-Passwort bei `ADMIN_PASSWORD` eintragen (sonst wird beim ersten Start ein
   zufälliges Passwort erzeugt und im Container-Log angezeigt).
5. **„Compose Up“** klicken. Die Seite läuft danach unter `http://UNRAID-IP:8080`.
6. Mit `admin` und dem Passwort anmelden → **Admin-Bereich** → zuerst unter **Mein Konto** das
   Passwort ändern.

Alternativ per Terminal auf dem Unraid-Server:

```bash
cd /mnt/user/appdata/retro-homepage-src
docker compose up -d --build
docker logs retro-homepage      # zeigt ggf. das erzeugte Admin-Passwort
```

**Updates:** neue Dateien in den Ordner kopieren und erneut `docker compose up -d --build`.
Die Daten in `/mnt/user/appdata/retro-homepage` bleiben dabei erhalten.

**Backup:** Den Ordner `/mnt/user/appdata/retro-homepage` sichern (z. B. mit dem Plugin
„Appdata Backup“). Darin liegen Datenbank, hochgeladene Dateien, Bilder und Apps.

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
4. **Advanced** – wichtig, sonst brechen große Uploads (Spielstände, ZIPs) ab:

   ```nginx
   client_max_body_size 0;
   proxy_request_buffering off;
   proxy_read_timeout 600s;
   proxy_send_timeout 600s;
   ```

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
| **Statistik** | Seitenaufrufe & Besucher pro Tag, Top-Seiten, Herkunft, Downloads, Geräte, aktive Mitglieder – ohne Cookies, ohne gespeicherte IPs |
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
- **Alles mit eigenem Server** (z. B. Mehrspieler-Quiz mit WebSockets): als eigenen Docker-Container
  auf Unraid laufen lassen, in NPM eine Subdomain anlegen (z. B. `quiz.deine-domain.de`,
  Websockets an) und die Adresse bei der App unter „Externer Dienst“ eintragen. Die App erscheint
  dann im Retro-Fenster unter „Spiele & Apps“.

---

## 4. Lokal entwickeln

```bash
npm install
npm run dev        # http://localhost:3000, Daten landen in ./data
```

Umgebungsvariablen siehe `.env.example`.
