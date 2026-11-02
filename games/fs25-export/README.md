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

## Ab 3.7: Plantagen, Ballen, Tracker (`HubLinkWatch.lua`)

**Plantagen** sind Gebäude, keine Felder: `PlaceableVine` (Wein, Oliven) oder eine DLC-Spezialisierung mit denselben
Feldern `fruitType` und `nodes` (Kaffee, Bananen). Jede Reihe hält in `growthValues` die Fläche je Wachstumsstufe;
fehlt der Zwischenspeicher, misst die Mod mit `FSDensityMapUtil.updateVineAreaValues` selbst nach. Meldungen je Plantage:
`orchardHarvest` (Anteil in den Erntestufen ab 10 %), `orchardCut` (Anteil `witheredState` ab 10 %), `orchardSpray`
(Anteil krank ab 1 %). Wo das DLC die Pilzkrankheit führt, ist unbekannt; die Mod sucht eine Stufe der Frucht, einen
Wert oder eine `get…`-Funktion der Plantage mit disease/sick/fungi/infect/blight/pest/health im Namen. Die Live-Datei
schreibt je Plantage `<orchards><orchard … sickFrom=…><debug states specs spec fruit sick/>`, damit der nächste Export
zeigt, wo es steht. Schalter je Hof: `orchard`.

**Ballen** aus `g_currentMission.itemSystem` (`Bale`, ohne Auftragsballen) und aus Ballenlagern
(`spec_objectStorage.objectInfos`). `balesReady`: Ballen, die die Mod gären sah und die jetzt fertig sind, bis jemand
abhakt (Schalter `bales`). `objects`: Ballenlager ab der Silo-Grenze voll. Live-Datei: `<bales><farm id><bale fillType
count liters fermenting fermentPct stored/>`; der Hub zeigt sie im Inventar statt der Ballen aus items.xml.

**Tracker** sammelt der Server alle 10 Sekunden für alle Höfe (`collectTrackers`: `prod`, `stall`, `silo`, `store`,
`bales`, `orchard`, `field`). Jeder Spieler schickt seine Auswahl (`HubLinkTrackEvent`, höchstens 8, alle 5 Minuten neu,
der Server vergisst sie nach 30); der Server hängt die Werte aller Auswahlen (höchstens 30) als `src = 4` an die Liste.
Den Katalog (`HubLinkCatalogEvent`) gibt es nur für den eigenen Hof, solange der Reiter „Tracker“ offen ist. Werte
reisen als kurze Zeichenkette (`i:FLOUR:40:12.0;o:BREAD:95:-1`), der Spieler setzt sie in seiner Sprache zusammen.

**Farben:** Hintergrund aus `HUD.COLOR.BACKGROUND`, erste Hervorhebung aus `HUD.COLOR.ACTIVE`; Deckkraft standardmäßig
wie das Spiel (`alpha = -1` in `hubLinkHud.xml`, `v = 2`; ältere Dateien fangen wieder bei „wie Spiel“ an).
