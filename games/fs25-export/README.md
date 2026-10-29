# Farming Hub Export (FS25-Mod)

Schreibt bei jedem Speichern `farmingHubExport.xml` in den Spielstand-Ordner: Feldumrisse, Grundstücke samt
Grundstückskarte, Positionen der Stationen und die Rezepte der Produktionen. Der Farming Hub liest die Datei per FTP
(`src/fsexport.js`) oder als Upload in der Seitenverwaltung.

Die Daten kommen aus dem laufenden Spiel. Die Mod öffnet keine .gar- oder .dlc-Dateien, sie gibt nur weiter, was das Spiel
ohnehin auf seiner Karte zeigt.

Die Website baut das ZIP selbst (Seitenverwaltung → Farming Simulator → „Mod herunterladen“), samt Symbol
`icon_farmingHubExport.dds`. Konsole im Spiel: `hubExport` schreibt die Datei sofort.
