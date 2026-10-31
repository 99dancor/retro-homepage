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
