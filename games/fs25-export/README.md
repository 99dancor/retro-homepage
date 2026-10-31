# FS25 Hub Link (FS25-Mod, früher „Farming Hub Export“)

Schreibt bei jedem Speichern `farmingHubExport.xml` in den Spielstand-Ordner: Feldumrisse, Grundstücke samt
Grundstückskarte, Positionen der Stationen, Rezepte, laufende Produktionen und Lager der Gebäude, alle Waren mit ihrem
Namen in der Sprache des Spiels, alle Früchte (Wachstumsstufen, Saat- und Erntemonate, Ertrag, Kartenfarbe) und den
Katalog aller Produktionen aus dem Shop.

Version 2 (Farming Hub 3.0) braucht der Hub für Früchte je Fleck, Warennamen und den Produktionsplaner. Eine Datei der
Version 1 liest er weiter, dann fehlen nur diese Teile. Der Farming Hub liest die Datei per FTP
(`src/fsexport.js`) oder als Upload in der Seitenverwaltung.

Die Daten kommen aus dem laufenden Spiel. Die Mod öffnet keine .gar- oder .dlc-Dateien, sie gibt nur weiter, was das Spiel
ohnehin auf seiner Karte zeigt.

Die Website baut das ZIP selbst (Seitenverwaltung → Farming Simulator → „Mod herunterladen“), samt Symbol
`icon_farmingHubExport.dds`. Konsole im Spiel: `hubExport` schreibt die Datei sofort.

## Ab 3.0: Produktionsberater und Austausch mit dem Hub

`FarmingHubLive.lua` prüft auf dem Server alle 10 Sekunden die Gebäude jedes Hofs (Eingänge, Ausgänge, Paletten-Ausgänge,
Ställe, Silos) und schreibt die offenen Probleme alle 30 Sekunden (wenn sich etwas geändert hat, sonst alle 2 Minuten) nach
`modSettings/FS25_FarmingHubExport/<savegameN>/farmingHubLive.xml`. Daneben legt der Hub per FTP `farmingHubInbox.xml` ab:
Einstellungen, offene Aufgaben und Notizen der Website. Die Einstellungen merkt sich die Mod in `farmingHubSettings.xml`.

Konsole: `hubStatus` (Einstellungen, offene Meldungen, Aufgaben und Notizen aus dem Hub), `hubSet export on|off`,
`hubSet advisor on|off`, `hubSet <Hof> <Schlüssel> <Wert>` (Schlüssel: input, inputHours, inputPct, output, outputPct,
pallets, stall, stallPct, stallFullPct, silo, siloPct). Ist der Export aus, schreibt nur noch `hubExport` die Exportdatei.

## Ab 3.1: Overlay im Spiel

`HubLinkHud.lua` zeigt rechts eine dezente Liste im Stil der Spiel-Anzeigen: Meldungen des eigenen Hofs, Aufgaben und
Notizen der Website. Alt+H schaltet klein (4 Einträge) → groß (12, mit Notizen) → aus, Alt+J wählt aus, Alt+K hakt ab.
Tasten lassen sich in der Steuerung ändern; ohne Tasten: `hubHud 0|1|2`, `hubHud pos <x> <y>`, `hubDone <Nr>`.

Die Liste baut der Server und schickt sie an alle Spieler (`HubLinkEvents.lua`). Abhaken geht an den Server, der prüft, ob
der Spieler zum Hof gehört. In der Live-Datei steht es dann unter `<done>` (eigene Nummer je Eintrag), bis der Hub es in
der Inbox unter `<doneAck>` bestätigt. Eine abgehakte Meldung bleibt aus, bis das Problem einmal weg war; eine Hub-Aufgabe
ist im Hub erledigt (mit „im Spiel von …“). Notizen blendet jeder Spieler nur für sich aus (`hubLinkHud.xml`).

Der Ordner- und Dateiname bleibt `FS25_FarmingHubExport`, damit Spielstände und der Austausch-Ordner gleich bleiben.

## Ab 3.2: Maus, Optionen im Spiel, Werte

Sobald der Mauszeiger zu sehen ist (Doppel-Rechtsklick mit „Quick Selector“ oder Alt+J), lässt sich das Overlay am Kopf
verschieben und an der Ecke unten rechts in Breite und Zeilen ziehen. „OK“ hakt ab, „OPTIONEN“ öffnet das Menü: Anzeige
(Zeilen, Schriftgröße, Deckkraft, Werte, Notizen; nur für den Spieler), Prüfungen und Schwellen des eigenen Hofs (für alle
auf dem Hof, gehen an die Website) und Export/Berater (nur Admin). Änderungen gehen als `HubLinkSetEvent` an den Server,
der sie prüft, `rev` hochzählt und die Einstellungen (`HubLinkConfigEvent`) an alle schickt. Jede Zeile zeigt darunter
Füllstand, Prozent und die Grenze, die ausgelöst hat. Gebäudenamen kommen aus der Shop-Liste des Spielers
(`configFileName`), eigene Namen bleiben.

## Ab 3.3: Live-Daten

Die Live-Datei enthält zusätzlich, was der Hub sonst erst nach dem Speichern aus farms.xml, environment.xml und fields.xml
erfährt, in denselben Namen: `<farms>` (Geld, Kredit, Einnahmen und Ausgaben heute und der letzten 4 Tage je Hof),
`<environment>` (Spieltag, Uhrzeit, Tage pro Monat, Temperatur, Wetter mit Vorhersage), `<fields>` (Frucht, Wachstum,
Boden, Kalk, Dünger, Pflug, Walze, Mulch, Unkraut, Steine; alle 2 Minuten neu gelesen) und `<missions>` (Aufträge mit
Typ, Status, Hof, Feld, Frucht, Lohn und Fortschritt). Der Hub nimmt diese Werte, solange die Mod in den letzten
10 Minuten geschrieben hat, sonst wieder den letzten Autosave. Die Live-Datei wird bei jeder Änderung, spätestens alle
2 Minuten geschrieben.

## Ab 3.4: Felder im Produktionsberater

`checkFields` nimmt den Stand der Felder (wie `<fields>`, alle 2 Minuten gelesen) und meldet je Hof eine Aufgabe je Arbeit:
`harvest` (je Frucht, erntereif laut Bodenart oder Wachstum im Erntefenster), `lime` (Kalk 0), `plow` (Pflug 0, nicht
gesät), `fertilize` (gesät, unter 2 Düngestufen), `weed` (gesät, Unkraut). Grünland zählt nicht. `uid` ist `fields`,
`name` die Feldnummern. Abschaltbar je Hof über `fields` (Einstellungen, Optionsmenü, Hof-Reiter „Aufgaben“). Ab dieser
Version lässt der Hub seine eigenen Feld- und Futtervorschläge weg, solange die Mod verbunden ist.

## Ab 3.5: Aussehen

Kästen haben runde Ecken (`box` zeichnet oben und unten schmaler werdende Streifen auf ganzen Pixeln). Das Optionsmenü
hat Reiter (Anzeige, Hof, Server) mit Gruppen. Die Hervorhebungsfarbe (`accent`, 1–6) und die runden Ecken (`round`)
liegen wie die übrigen Anzeige-Einstellungen in `hubLinkHud.xml`.
