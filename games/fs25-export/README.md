# Farming Hub Export (FS25-Mod)

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
